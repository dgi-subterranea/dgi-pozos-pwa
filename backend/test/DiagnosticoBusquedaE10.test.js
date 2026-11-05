// diagnosticoBusquedaE10 (E10-1): herramienta manual de medicion del flujo de busqueda. Se prueba que (1) mide cada etapa con la forma documentada, (2) NO tiene efectos (ninguna hoja, ningun
// Telegram, ningun Historial, nada de Busquedas), (3) restaura SIEMPRE lo que reemplaza, (4) si no puede apagar los efectos no llama a ningun handler, (5) un fallo de una etapa no corta las demas y
// (6) no imprime tokens ni el email completo. Modulos reales (catalogo, dominio, repositorios, AuthService, Api, existencia); Google y las hojas, falsos.
const fs = require('fs');
const path = require('path');
const { crearEntornoE10, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');

const POZO = '04-0263';
let E;
let Diag;

function usuarios() {
  const todos = PERMISOS_DE_SIEMPRE.concat(['mapa']);
  return [
    { email: 'sin4@x.com', nombre: 'Sin cuatro', permisos: ['perfil', 'mapa'] },
    { email: 'completo@x.com', nombre: 'Completo', permisos: todos },
    { email: 'baja@x.com', nombre: 'Baja', estado: 'inactivo', permisos: todos }
  ];
}

beforeEach(() => {
  E = crearEntornoE10({ usuarios: usuarios() });
  Object.assign(global, require('../src/PozoExistenciaService'));
  Object.assign(global, require('../src/Api'));
  Diag = require('../src/DiagnosticoBusquedaE10');
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  global.registryService_getWellRecord.mockReturnValue({ found: true, record: { wellId: POZO } });
  global.registryService_getWellLocation.mockReturnValue({ found: true, location: { lat: -32.8, lon: -68.7 } });
  global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto: { id: POZO } });
  global.itfService_disponibilidad.mockReturnValue({ [POZO]: { estado: 'SI' } });
  global.profileService_checkDisponibilidad.mockReturnValue({ [POZO]: true });
  global.mapaService_getPozos.mockReturnValue({ found: true, pozos: [{ wellId: POZO, lat: -32.8, lon: -68.7, estado: 'C' }], metadata: null });
});

const NOMBRES_ESPERADOS = [
  'usuario.elegir_con_4_permisos_de_busqueda',
  'usuario.elegir_pozo_del_dataset_del_mapa',
  'acceso.cache_v2_lectura',
  'acceso.tombstone_lectura',
  'acceso.hoja_usuarios_getUserStatus',
  'acceso.efectivo_usuariosDominio',
  'acceso.getUserAccess_x1',
  'acceso.getUserAccess_x4_como_las_4_lecturas',
  'sesion.firmar_y_verificar_token',
  'lectura.getItfAvailability',
  'lectura.getWellRecord',
  'lectura.getWellLocation',
  'lectura.getMonitoringPoint',
  'existencia.padron_ubicacion',
  'existencia.pozoExistenciaService_verificar'
];

describe('diagnosticoBusquedaE10: medicion por etapas', () => {
  test('sin parametros elige usuario y pozo, corre TODAS las etapas en orden y no hay errores', () => {
    const r = Diag.diagnosticoBusquedaE10_ejecutar();
    expect(r.etapas.map((e) => e.etapa)).toEqual(NOMBRES_ESPERADOS);
    expect(r.errores).toEqual([]);
    expect(r.lentas).toEqual([]);
    expect(r.respuestasConError).toEqual([]);
    expect(r.soloLectura).toBe(true);
    expect(r.wellId).toBe(POZO);
    r.etapas.forEach((e) => {
      expect(typeof e.inicioMs).toBe('number');
      expect(typeof e.duracionMs).toBe('number');
      expect(e.resultado).toBe('OK');
      expect(e.forma).not.toBeNull();
    });
    expect(typeof r.totalMs).toBe('number');
  });

  test('las 4 lecturas pasan por el handler real (doPost) y devuelven ok; informan forma (status, bytes), no contenido', () => {
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    ['lectura.getItfAvailability', 'lectura.getWellRecord', 'lectura.getWellLocation', 'lectura.getMonitoringPoint'].forEach((n) => {
      const e = r.etapas.find((x) => x.etapa === n);
      expect(e.forma.status).toBe('ok');
      expect(e.forma.bytes).toBeGreaterThan(0);
    });
    expect(global.registryService_getWellRecord).toHaveBeenCalledWith(POZO);
  });

  test('mide el cache v2 (acierto despues de getUserAccess) y la existencia del pozo', () => {
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    const existencia = r.etapas.find((x) => x.etapa === 'existencia.pozoExistenciaService_verificar');
    expect(existencia.forma.tipo).toBe('objeto');
    expect(E.cache.claves().some((k) => k === 'user_access_v2_completo@x.com')).toBe(true);
  });

  test('los parametros mandan: el pozo y el usuario indicados se usan sin elegir nada', () => {
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    expect(r.etapas.map((e) => e.etapa)).not.toContain('usuario.elegir_con_4_permisos_de_busqueda');
    expect(r.etapas.map((e) => e.etapa)).not.toContain('usuario.elegir_pozo_del_dataset_del_mapa');
    expect(global.mapaService_getPozos).not.toHaveBeenCalled();
  });
});

describe('diagnosticoBusquedaE10: SIN efectos', () => {
  test('no escribe hojas, no manda Telegram, no escribe Historial ni Busquedas, no notifica', () => {
    const antes = JSON.stringify(Object.keys(E.hojas).map((n) => [n, E.hojas[n].filas]));
    const historial = global.logHistoryEvent;
    const telegram = global.telegramRepository_sendMessage;
    const r = Diag.diagnosticoBusquedaE10_ejecutar();
    expect(JSON.stringify(Object.keys(E.hojas).map((n) => [n, E.hojas[n].filas]))).toBe(antes);
    expect(historial).not.toHaveBeenCalled();
    expect(telegram).not.toHaveBeenCalled();
    expect(global.searchHistoryService_registerSearch).not.toHaveBeenCalled();
    expect(global.sheetSearchHistoryRepository_logSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    // los handlers SI intentaron auditar: queda a la vista cuantos intentos se suprimieron
    expect(r.efectosSuprimidos.logHistoryEvent).toBeGreaterThan(0);
    expect(r.efectosSuprimidos.telegramRepository_sendMessage).toBe(0);
  });

  test('restaura las funciones reemplazadas (mismas referencias) al terminar', () => {
    const historial = global.logHistoryEvent;
    const telegram = global.telegramRepository_sendMessage;
    Diag.diagnosticoBusquedaE10_ejecutar();
    expect(global.logHistoryEvent).toBe(historial);
    expect(global.telegramRepository_sendMessage).toBe(telegram);
  });

  test('restaura tambien si la funcion interna lanza', () => {
    const historial = global.logHistoryEvent;
    expect(() => Diag.diagBusqE10_sinEfectos(() => { throw new Error('boom'); })).toThrow('boom');
    expect(global.logHistoryEvent).toBe(historial);
  });

  test('si el reemplazo NO queda instalado no se llama a ningun handler', () => {
    const original = global.logHistoryEvent;
    Object.defineProperty(global, 'logHistoryEvent', { value: original, writable: false, configurable: true });
    try {
      const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
      expect(r.notas.join(' ')).toMatch(/EFECTOS_NO_SUPRIMIBLES/);
      expect(r.etapas.filter((e) => e.etapa.indexOf('lectura.') === 0)).toEqual([]);
      expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(global, 'logHistoryEvent', { value: original, writable: true, configurable: true });
    }
  });

  test('NO llama a registerWellSearch ni a sus efectos', () => {
    const doPostEspia = jest.spyOn(global, 'doPost');
    Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    const acciones = doPostEspia.mock.calls.map((c) => JSON.parse(c[0].postData.contents).action);
    expect(acciones).toEqual(['getItfAvailability', 'getWellRecord', 'getWellLocation', 'getMonitoringPoint']);
    doPostEspia.mockRestore();
  });
});

describe('diagnosticoBusquedaE10: errores, lentitud y casos limite', () => {
  test('una etapa que falla se informa y NO corta las demas', () => {
    global.registryService_getWellLocation.mockImplementation(() => { throw new Error('padron caido https://script.google.com/macros/s/AKfycbxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx/exec'); });
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    expect(r.etapas.map((e) => e.etapa)).toEqual(expect.arrayContaining(NOMBRES_ESPERADOS.slice(2)));
    const e = r.etapas.find((x) => x.etapa === 'existencia.padron_ubicacion');
    expect(e.resultado).toBe('ERROR');
    expect(e.error.mensaje).not.toMatch(/AKfycb|https?:/);
    expect(r.errores).toContain('existencia.padron_ubicacion');
  });

  test('una respuesta status:error se marca RESPUESTA_ERROR (no ERROR)', () => {
    global.registryService_getWellRecord.mockReturnValue({ found: false });
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    const e = r.etapas.find((x) => x.etapa === 'lectura.getWellRecord');
    expect(e.resultado).toBe('RESPUESTA_ERROR');
    expect(r.respuestasConError).toContain('lectura.getWellRecord');
  });

  test('TIMEOUT_LOGICO: una etapa que supera el umbral se marca (el resultado se conserva)', () => {
    const ctx = { t0: Date.now(), umbral: -1, etapas: [] };
    const r = Diag.diagBusqE10_etapa(ctx, 'x', () => ({ a: 1 }));
    expect(r.ok).toBe(true);
    expect(ctx.etapas[0].resultado).toBe('TIMEOUT_LOGICO');
  });

  test('una etapa que lanza queda ERROR con error seguro y no relanza', () => {
    const ctx = { t0: Date.now(), umbral: 5000, etapas: [] };
    const r = Diag.diagBusqE10_etapa(ctx, 'x', () => { throw new TypeError('x'.repeat(500)); });
    expect(r.ok).toBe(false);
    expect(ctx.etapas[0].resultado).toBe('ERROR');
    expect(ctx.etapas[0].error.tipo).toBe('TypeError');
    expect(ctx.etapas[0].error.mensaje.length).toBeLessThanOrEqual(160);
  });

  test('escribe "inicio <etapa>" en el Logger ANTES de correrla (si se cuelga, es el ultimo renglon)', () => {
    const orden = [];
    global.Logger = { log: jest.fn((m) => orden.push('log:' + m)) };
    const ctx = { t0: Date.now(), umbral: 5000, etapas: [] };
    Diag.diagBusqE10_etapa(ctx, 'mi.etapa', () => { orden.push('corre'); return {}; });
    expect(orden).toEqual(['log:[diagBusqE10] inicio mi.etapa', 'corre']);
  });

  test('sin usuario con los 4 permisos de busqueda: informa SIN_DATOS_DE_PRUEBA y no llama a ningun handler', () => {
    E = crearEntornoE10({ usuarios: [{ email: 'sin4@x.com', nombre: 'S', permisos: ['perfil', 'mapa'] }] });
    Object.assign(global, require('../src/PozoExistenciaService'));
    Object.assign(global, require('../src/Api'));
    global.mapaService_getPozos.mockReturnValue({ found: true, pozos: [{ wellId: POZO }] });
    const r = Diag.diagnosticoBusquedaE10_ejecutar();
    expect(r.notas.join(' ')).toMatch(/SIN_DATOS_DE_PRUEBA/);
    expect(r.etapas.filter((e) => e.etapa.indexOf('lectura.') === 0)).toEqual([]);
  });

  test('usuario inactivo: no se llama a los handlers', () => {
    const r = Diag.diagnosticoBusquedaE10(POZO, 'baja@x.com');
    expect(r.notas.join(' ')).toMatch(/USUARIO_NO_ACTIVO/);
    expect(r.etapas.filter((e) => e.etapa.indexOf('lectura.') === 0)).toEqual([]);
  });

  test('sin pozo en el dataset del mapa: SIN_DATOS_DE_PRUEBA', () => {
    global.mapaService_getPozos.mockReturnValue({ found: true, pozos: [] });
    const r = Diag.diagnosticoBusquedaE10('', '');
    expect(r.notas.join(' ')).toMatch(/SIN_DATOS_DE_PRUEBA/);
  });

  test('un error inesperado del dataset del mapa no rompe la ejecucion', () => {
    global.mapaService_getPozos.mockImplementation(() => { throw new Error('mapa caido'); });
    const r = Diag.diagnosticoBusquedaE10('', '');
    expect(r.errores).toContain('usuario.elegir_pozo_del_dataset_del_mapa');
  });
});

describe('diagnosticoBusquedaE10: privacidad', () => {
  test('el informe y el Logger no contienen el token ni el email completo', () => {
    const lineas = [];
    global.Logger = { log: jest.fn((m) => lineas.push(String(m))) };
    const r = Diag.diagnosticoBusquedaE10(POZO, 'completo@x.com');
    const todo = JSON.stringify(r) + lineas.join('\n');
    expect(todo).not.toMatch(/completo@x\.com/);
    expect(r.usuario).toBe('c***@x.com');
    expect(todo).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(lineas[lineas.length - 1]).toBe(JSON.stringify(r));
  });

  test('mascara', () => {
    expect(Diag.diagBusqE10_mascara('federico@gmail.com')).toBe('f***@gmail.com');
    expect(Diag.diagBusqE10_mascara('sin-arroba')).toBe('***');
    expect(Diag.diagBusqE10_mascara('')).toBe('***');
  });
});

describe('diagnosticoBusquedaE10: guarda sobre el texto del archivo', () => {
  const texto = fs.readFileSync(path.join(__dirname, '..', 'src', 'DiagnosticoBusquedaE10.js'), 'utf8')
    .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test.each([
    ['UrlFetchApp'], ['PropertiesService'], ['LockService'], ['ScriptApp'], ['MailApp'], ['GmailApp'], ['DriveApp'], ['SpreadsheetApp'],
    ['appendRow'], ['setValue'], ['setValues'], ['insertSheet'], ['deleteRow'], ['\\.put\\('], ['\\.remove\\('], ['handleRegisterWellSearch'], ['notificationService_'],
    ['searchHistoryService_'], ['sheetSearchHistoryRepository'], ['telegramRepository_sendMessage\\('], ['getSessionSecret'], ['getTelegram']
  ])('el archivo no contiene %s', (patron) => {
    expect(texto).not.toMatch(new RegExp(patron));
  });
});
