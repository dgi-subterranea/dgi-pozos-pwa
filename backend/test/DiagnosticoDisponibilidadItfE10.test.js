// diagnosticoDisponibilidadItfE10: evidencia directa de que la consulta de UN pozo no toca el indice, no recorre THUMB y no toma el ScriptLock. Modulos reales (Auth, Api, indices, Drive repo); Google falso.
const fs = require('fs');
const path = require('path');
const { crearEntornoE10, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');
const { crearDrive } = require('./itfEntorno');

let E;
let Diag;
const archivo = (id, name) => ({ id: id, name: name, bytes: [-1, -40, -1, 1, 2, 3] });

function armar(archivos, opciones) {
  E = crearEntornoE10({ usuarios: [{ email: 'completo@x.com', nombre: 'Completo', permisos: PERMISOS_DE_SIEMPRE.concat(['mapa']) }, { email: 'sinperfil@x.com', nombre: 'S', permisos: ['datos'] }] });
  global.Utilities.sleep = jest.fn();
  global.LockService = { getScriptLock: () => ({ waitLock: jest.fn(), releaseLock: jest.fn() }), getUserLock: () => ({}), getDocumentLock: () => ({}) };
  const drive = crearDrive(archivos);
  drive.estado.caseInsensitive = true;
  ['ItfIndiceReconstruccion', 'ItfAvailabilityService', 'ItfLegacyProvider', 'DriveProfileRepository', 'ProfileService', 'PozoExistenciaService', 'Api'].forEach((m) => Object.assign(global, require('../src/' + m)));
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  global.itfService_e9Activo = () => (opciones && opciones.e9) === true;
  // como itfService_disponibilidad: UNICO -> true, NO -> false, el resto se omite
  global.itfService_disponibilidad = (ids) => { const est = global.itfLegacy_disponibilidad(ids); const out = {}; Object.keys(est).forEach((w) => { if (est[w] === 'UNICO') { out[w] = true; } else if (est[w] === 'NO') { out[w] = false; } }); return out; };
  global.createSessionToken = E.Auth.createSessionToken;
  Diag = require('../src/DiagnosticoDisponibilidadItfE10');
  return drive;
}

describe.each([[false], [true]])('consulta individual sin indice (E9 %s)', (e9) => {
  test('3 pozos: respuesta ok y booleana; 0 lecturas/escrituras/borrados del indice, 0 recorridos de THUMB, 0 locks', () => {
    const drive = armar([archivo('a', '07-0002.jpg'), archivo('b', '08-0003.jpg')], { e9 });
    const r = Diag.diagnosticoDisponibilidadItfE10();
    expect(r.pozos.map((p) => p.wellId)).toEqual(Diag.DIAG_DISP_E10_POZOS);
    r.pozos.forEach((p) => {
      expect(p.resultado).toBe('OK');
      expect(p.respuesta.status).toBe('ok');
      expect(p.accesosAlIndice).toEqual({ lecturas: 0, escrituras: 0, borrados: 0 });
      expect(p.recorridosThumb).toBe(0);
      expect(p.locksTomados).toBe(0);
      expect(p.historialSuprimido).toBeGreaterThan(0);
      expect(typeof p.duracionMs).toBe('number');
    });
    expect(r.pozos.find((p) => p.wellId === '08-0003').respuesta.data).toEqual({ '08-0003': true });
    expect(r.pozos.find((p) => p.wellId === '07-0001').respuesta.data).toEqual({ '07-0001': false });
    expect(r.consultaIndividualSinIndice).toBe(true);
    expect(drive.calls.getFiles).toBe(0);
    expect(r.estadoIndiceAntes.indiceE9.departamentosEnCache).toBe(0);
    expect(r.estadoIndiceDespues.indiceE9.departamentosEnCache).toBe(0);
    expect(r.estadoIndiceDespues.indiceAntiguo.departamentosEnCache).toBe(0);
  });

  test('con el indice CALIENTE la evidencia es la misma (0 accesos al indice): no depende de la temperatura', () => {
    armar([archivo('a', '08-0003.jpg')], { e9 });
    for (let d = 1; d <= 19; d += 1) { const k = String(d).padStart(2, '0'); CacheService.getScriptCache().put('itf_leg_v2_' + k, '{"u":[],"a":[],"n":[]}', 3600); CacheService.getScriptCache().put('itf_idx_' + k, '[]', 3600); }
    const r = Diag.diagnosticoDisponibilidadItfE10();
    expect(r.estadoIndiceAntes.indiceE9.departamentosEnCache).toBe(19);
    expect(r.consultaIndividualSinIndice).toBe(true);
    expect(r.pozos.find((p) => p.wellId === '08-0003').respuesta.data).toEqual({ '08-0003': true });     // refleja Drive, no el indice viejo
  });
});

describe('la evidencia DETECTA un camino que use el indice (sensibilidad)', () => {
  test('si la consulta de 1 pozo pasara por el indice: cuenta lecturas/escrituras, lock y el recorrido (bloqueado) y NO da por limpia la corrida', () => {
    armar([archivo('a', '08-0003.jpg')], { e9: false });
    global.profileService_checkDisponibilidad = (ids) => { global.itfAvailabilityService_asegurarIndice(['08']); return { [ids[0]]: true }; };
    const r = Diag.diagnosticoDisponibilidadItfE10();
    const p = r.pozos[0];
    expect(p.recorridosThumb).toBeGreaterThan(0);
    expect(p.locksTomados).toBeGreaterThan(0);
    expect(p.accesosAlIndice.lecturas + p.accesosAlIndice.escrituras).toBeGreaterThan(0);
    expect(p.respuesta.status).toBe('error');                       // el recorrido bloqueado LANZA: nunca se escribio un indice vacio
    expect(r.consultaIndividualSinIndice).toBe(false);
    expect(r.estadoIndiceDespues.indiceAntiguo.departamentosEnCache).toBe(0);
  });
});

describe('observadores: se restauran siempre y se verifican antes de llamar al handler', () => {
  test('quedan restaurados (mismas referencias) al terminar', () => {
    armar([], { e9: false });
    const antes = { c: global.CacheService, l: global.LockService, t: global.driveProfileRepository_listarArchivosThumb, h: global.logHistoryEvent };
    Diag.diagnosticoDisponibilidadItfE10();
    expect(global.CacheService).toBe(antes.c);
    expect(global.LockService).toBe(antes.l);
    expect(global.driveProfileRepository_listarArchivosThumb).toBe(antes.t);
    expect(global.logHistoryEvent).toBe(antes.h);
  });

  test('tambien si la funcion interna lanza', () => {
    armar([], { e9: false });
    const antes = { c: global.CacheService, l: global.LockService, t: global.driveProfileRepository_listarArchivosThumb, h: global.logHistoryEvent };
    expect(() => Diag.diagDispE10_observando({ indice: {}, locks: 0, recorridosThumb: 0, historialSuprimido: 0 }, () => { throw new Error('boom'); })).toThrow('boom');
    expect(global.CacheService).toBe(antes.c);
    expect(global.LockService).toBe(antes.l);
    expect(global.driveProfileRepository_listarArchivosThumb).toBe(antes.t);
    expect(global.logHistoryEvent).toBe(antes.h);
  });

  test('si un observador no se puede instalar, NO se llama al handler', () => {
    armar([], { e9: false });
    const original = global.logHistoryEvent;
    Object.defineProperty(global, 'logHistoryEvent', { value: original, writable: false, configurable: true });
    try {
      const doPostEspia = jest.spyOn(global, 'doPost');
      const r = Diag.diagnosticoDisponibilidadItfE10();
      expect(r.pozos.every((p) => p.resultado === 'OBSERVADORES_NO_INSTALADOS')).toBe(true);
      expect(doPostEspia).not.toHaveBeenCalled();
      expect(r.consultaIndividualSinIndice).toBe(false);
      doPostEspia.mockRestore();
    } finally {
      Object.defineProperty(global, 'logHistoryEvent', { value: original, writable: true, configurable: true });
    }
  });

  test('el envoltorio del cache delega TODO (mismos valores) y solo cuenta claves de indices', () => {
    armar([], { e9: false });
    const real = CacheService.getScriptCache();
    const registro = { indice: {} };
    const w = Diag.diagDispE10_envolverCache(real, registro);
    w.put('otra_clave', 'x', 60);
    w.put('itf_idx_01', '[]', 60);
    expect(w.get('otra_clave')).toBe('x');
    expect(real.get('itf_idx_01')).toBe('[]');
    w.get('itf_leg_v2_rebuilding');
    w.remove('itf_idx_01');
    expect(real.get('itf_idx_01')).toBeNull();
    expect(registro.indice).toEqual({ escrituras: 1, lecturas: 1, borrados: 1 });
  });
});

describe('casos limite y privacidad', () => {
  test('sin usuario con perfil: no se llama a ningun handler', () => {
    E = crearEntornoE10({ usuarios: [{ email: 'sinperfil@x.com', nombre: 'S', permisos: ['datos'] }] });
    ['ItfIndiceReconstruccion', 'ItfAvailabilityService', 'ItfLegacyProvider', 'DriveProfileRepository', 'ProfileService', 'Api'].forEach((m) => Object.assign(global, require('../src/' + m)));
    global.createSessionToken = E.Auth.createSessionToken;
    Diag = require('../src/DiagnosticoDisponibilidadItfE10');
    const r = Diag.diagnosticoDisponibilidadItfE10();
    expect(r.pozos).toEqual([]);
    expect(r.notas.join(' ')).toMatch(/SIN_USUARIO_CON_PERFIL/);
  });

  test('no imprime el token ni el email completo', () => {
    armar([archivo('a', '08-0003.jpg')], { e9: false });
    const lineas = [];
    global.Logger = { log: jest.fn((m) => lineas.push(String(m))) };
    const r = Diag.diagnosticoDisponibilidadItfE10();
    const todo = JSON.stringify(r) + lineas.join('\n');
    expect(todo).not.toMatch(/completo@x\.com/);
    expect(r.usuario).toBe('c***@x.com');
    expect(todo).not.toMatch(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  });

  test('un error inesperado no rompe la ejecucion (queda en el informe)', () => {
    armar([], { e9: false });
    global.sheetUserRepository_listarConPermisos = () => { throw new Error('hoja caida'); };
    const r = Diag.diagnosticoDisponibilidadItfE10();
    expect(r.error.mensaje).toMatch(/hoja caida/);
  });
});

describe('guarda sobre el texto del archivo', () => {
  const texto = fs.readFileSync(path.join(__dirname, '..', 'src', 'DiagnosticoDisponibilidadItfE10.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test.each([
    ['UrlFetchApp'], ['PropertiesService'], ['ScriptApp'], ['MailApp'], ['GmailApp'], ['DriveApp'], ['SpreadsheetApp'], ['appendRow'], ['setValue'], ['setValues'], ['insertSheet'], ['deleteRow'],
    ['notificationService_'], ['searchHistoryService_'], ['sheetSearchHistoryRepository'], ['telegramRepository_sendMessage'], ['getSessionSecret'], ['getTelegram'], ['itfAvailabilityService_reconstruirIndice\\('], ['itfLegacy_reconstruirIndice\\(']
  ])('el archivo no contiene %s', (patron) => {
    expect(texto).not.toMatch(new RegExp(patron));
  });
});
