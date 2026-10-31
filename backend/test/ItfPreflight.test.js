// E9-7: herramientas manuales de rollout (ItfPreflight.js): el preflight de SOLO LECTURA (booleanos y contadores, jamas ids / URL / secreto / emails), el interruptor guardado (itfE9Encender solo con el preflight en
// verde; itfE9Apagar siempre) y la medicion. Todo con Apps Script falso: nada toca Google.
const fs = require('fs');
const path = require('path');
const { crearEntorno } = require('./itfEntorno');
const { instalarSheetsFalsos } = require('./fakeSheets');

const P = require('../src/ItfPreflight');
const R = require('../src/ItfEventosRepository');

const OK_ESTADO = () => ({
  interruptor: null,
  carpetaLegacy: { configurada: true, accesible: true },
  legacyVariantes: { consultados: 3, unicos: 3 },
  hoja: { existe: true, esquemaOk: true, filas: 0 },
  usuarios: { hoja: true, columnas: { perfil_subir: true, perfil_validar: true }, activosConSubir: 0, activosConValidar: 0 },
  storage: { configurado: true, codigo: 'ITF_NOT_FOUND' }
});

describe('evaluar (puro)', () => {
  test('todo en verde: listo para encender, y el interruptor apagado no cambia eso', () => {
    const r = P.itfPreflight_evaluar(OK_ESTADO());
    expect(r.listoParaEncender).toBe(true);
    expect(r.interruptor).toBe('APAGADO');
    expect(r.items.map((i) => i.id)).toEqual(['carpeta_legacy', 'legacy_variantes_mayusculas', 'hoja_itfeventos', 'usuarios_hoja', 'usuarios_columna_perfil_subir', 'usuarios_columna_perfil_validar', 'storage_configurado', 'storage_itf']);
    expect(r.items.every((i) => i.ok)).toBe(true);
  });

  test.each([
    ['sin carpeta legacy', (e) => { e.carpetaLegacy.configurada = false; }, 'carpeta_legacy'],
    ['carpeta legacy inaccesible', (e) => { e.carpetaLegacy.accesible = false; }, 'carpeta_legacy'],
    ['el lookup de variantes (.JPG) no las resuelve como UNICO', (e) => { e.legacyVariantes.unicos = 2; }, 'legacy_variantes_mayusculas'],
    ['el lookup de variantes no se consulto', (e) => { delete e.legacyVariantes; }, 'legacy_variantes_mayusculas'],
    ['sin hoja ItfEventos', (e) => { e.hoja.existe = false; }, 'hoja_itfeventos'],
    ['hoja con esquema inesperado', (e) => { e.hoja.esquemaOk = false; }, 'hoja_itfeventos'],
    ['Usuarios ilegible', (e) => { e.usuarios.hoja = false; }, 'usuarios_hoja'],
    ['sin columna perfil_subir', (e) => { e.usuarios.columnas.perfil_subir = false; }, 'usuarios_columna_perfil_subir'],
    ['sin columna perfil_validar', (e) => { e.usuarios.columnas.perfil_validar = false; }, 'usuarios_columna_perfil_validar'],
    ['storage sin URL / secreto', (e) => { e.storage.configurado = false; }, 'storage_configurado'],
    ['storage sin acciones de ITF o sin raiz', (e) => { e.storage.codigo = 'ITF_STORAGE_NO_CONFIGURADO'; }, 'storage_itf'],
    ['storage caido', (e) => { e.storage.codigo = 'SERVICE_UNAVAILABLE'; }, 'storage_itf'],
    ['storage no consultado', (e) => { e.storage.codigo = null; }, 'storage_itf'],
    ['storage responde algo inesperado (un archivo que no existe NO puede existir)', (e) => { e.storage.codigo = 'RESPUESTA_INESPERADA'; }, 'storage_itf']
  ])('%s -> NO listo (solo ese item falla)', (_n, rompe, id) => {
    const e = OK_ESTADO();
    rompe(e);
    const r = P.itfPreflight_evaluar(e);
    expect(r.listoParaEncender).toBe(false);
    expect(r.items.filter((i) => !i.ok).map((i) => i.id)).toEqual([id]);
  });

  test('una entrada vacia o rara nunca da "listo" (fail-closed)', () => {
    [undefined, null, {}, 'x', 5, { hoja: {} }].forEach((e) => expect(P.itfPreflight_evaluar(e).listoParaEncender).toBe(false));
  });

  test('el interruptor esta ENCENDIDO solo con el valor exacto "SI"; cualquier otro valor o ausente = APAGADO', () => {
    ['NO', '', 'si', 'Si', ' SI', 'SI ', 'true', '1', null, undefined].forEach((v) => {
      const e = OK_ESTADO();
      e.interruptor = v;
      expect(P.itfPreflight_evaluar(e).interruptor).toBe('APAGADO');
    });
    const e = OK_ESTADO();
    e.interruptor = 'SI';
    expect(P.itfPreflight_evaluar(e).interruptor).toBe('ENCENDIDO');
  });

  test('contadores: solo cantidades', () => {
    const e = OK_ESTADO();
    e.hoja.filas = 7;
    e.usuarios.activosConSubir = 1;
    e.usuarios.activosConValidar = 2;
    expect(P.itfPreflight_evaluar(e).contadores).toEqual({ eventos: 7, usuariosActivosConPerfilSubir: 1, usuariosActivosConPerfilValidar: 2 });
  });

  test('conteo de usuarios: solo activos con perfil=SI y la columna = SI (exacto); sin columna = 0; sin datos = 0', () => {
    const data = [
      ['email', 'nombre', 'estado', 'perfil', 'perfil_subir', 'perfil_validar'],
      ['a@x.com', 'A', 'activo', 'SI', 'SI', 'NO'],
      ['b@x.com', 'B', 'activo', 'SI', ' si ', 'SI'],
      ['c@x.com', 'C', 'inactivo', 'SI', 'SI', 'SI'],
      ['d@x.com', 'D', 'activo', 'NO', 'SI', 'SI'],
      ['e@x.com', 'E', 'activo', 'SI', 'true', '1']
    ];
    expect(P.itfPreflight_cuantosActivosCon(data, 'perfil_subir')).toBe(2);
    expect(P.itfPreflight_cuantosActivosCon(data, 'perfil_validar')).toBe(1);
    expect(P.itfPreflight_cuantosActivosCon(data, 'columna_que_no_existe')).toBe(0);
    expect(P.itfPreflight_cuantosActivosCon([], 'perfil_subir')).toBe(0);
    expect(P.itfPreflight_cuantosActivosCon(null, 'perfil_subir')).toBe(0);
    expect(P.itfPreflight_columnasDeUsuarios(data)).toEqual({ perfil_subir: true, perfil_validar: true });
    expect(P.itfPreflight_columnasDeUsuarios([['email', 'estado', 'perfil']])).toEqual({ perfil_subir: false, perfil_validar: false });
    expect(P.itfPreflight_columnasDeUsuarios([['email', ' PERFIL_SUBIR ']])).toEqual({ perfil_subir: true, perfil_validar: false });
    expect(P.itfPreflight_columnasDeUsuarios(null)).toEqual({ perfil_subir: false, perfil_validar: false });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('preflight y interruptor contra Apps Script falso', () => {
  const SECRETOS = ['FOLDER-ID-LEGACY-SECRETO', 'SPREADSHEET-ID-SECRETO', 'https://script.google.com/macros/s/URL-SECRETA-DEL-STORAGE/exec', 'secreto-compartido-de-32-caracteres-o-mas-xxxx'];
  let E;
  let props;
  let setProperty;
  let llamadasStorage;
  let hojas;

  function montar(cfg) {
    const c = Object.assign({ hojaItfEventos: true, columnas: true, storage: 'ok', carpeta: true, filasEventos: 0 }, cfg || {});
    E = crearEntorno({ props: { FOLDER_ID: SECRETOS[0], FOTOS_STORAGE_URL: SECRETOS[2], FOTOS_STORAGE_SECRET: SECRETOS[3] } });
    Object.assign(global, P);
    props = E.props;
    setProperty = jest.fn((k, v) => { props[k] = v; });
    global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: setProperty }) };
    global.getFolderId = () => (c.carpeta ? SECRETOS[0] : (() => { throw new Error('FOLDER_ID no configurado'); })());
    global.getFotosStorageUrl = () => { if (!props.FOTOS_STORAGE_URL) { throw new Error('FOTOS_STORAGE_URL no configurado en Script Properties'); } return props.FOTOS_STORAGE_URL; };
    global.getFotosStorageSecret = () => props.FOTOS_STORAGE_SECRET;
    const nombresDrive = ['15-1082.JPG', '15-1024.JPG', '15-0997.JPG', '14-0001.jpg'].concat(c.variantesAmbiguas ? ['15-1082.jpg'] : []);
    const mkArchivo = (n) => ({ getId: () => 'id-' + n, getName: () => n, getBlob: () => ({ getBytes: () => [1] }) });
    const itera = (lista) => { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; };
    global.DriveApp = {
      getFolderById: jest.fn((id) => {
        if (id !== SECRETOS[0]) { throw new Error('no existe'); }
        return {
          getFilesByName: (n) => itera(nombresDrive.filter((x) => x === n).map(mkArchivo)),
          searchFiles: (q) => { const m = /^title contains '([^']+)'/.exec(q); return itera(nombresDrive.filter((x) => x.toLowerCase().indexOf(m[1].toLowerCase()) >= 0).map(mkArchivo)); }
        };
      })
    };
    const cabeceraUsuarios = ['email', 'nombre', 'estado', 'perfil'].concat(c.columnas ? ['perfil_subir', 'perfil_validar'] : []);
    const filaUsuario = (email, v) => ['email'.length ? email : '', 'Persona', 'activo', 'SI'].concat(c.columnas ? [v, v] : []);
    const inicial = { Usuarios: [cabeceraUsuarios, filaUsuario('smoke@example.com', 'SI'), filaUsuario('otra@example.com', 'NO')] };
    if (c.hojaItfEventos) { inicial.ItfEventos = [R.ITF_EVENTOS_COLUMNAS.concat([])]; for (let i = 0; i < c.filasEventos; i += 1) { inicial.ItfEventos.push(new Array(17).fill('')); } }
    hojas = instalarSheetsFalsos(inicial);
    global.getSpreadsheetId = () => SECRETOS[1];
    llamadasStorage = [];
    global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
      llamadasStorage.push({ accion, payload });
      if (c.storage === 'ok') { throw new Error('storage devolvio error: NOT_FOUND'); }
      if (c.storage === 'sin-acciones') { throw new Error('storage devolvio error: UNKNOWN_ACTION'); }
      if (c.storage === 'sin-raiz') { throw new Error('storage devolvio error: INTERNAL ITF_ROOT_FOLDER_ID no configurado'); }
      throw new Error('socket hang up');
    });
    global.Logger = { log: jest.fn() };
  }
  const salida = () => global.Logger.log.mock.calls.map((c) => String(c[0])).join('\n');
  const instantanea = () => JSON.stringify(hojas, (k, v) => (typeof v === 'function' ? undefined : v));

  test('todo listo: preflight en verde; consulta UNA accion de storage (metaItf de un archivo inexistente) y nada mas', () => {
    montar();
    const r = global.preflightItfE9();
    expect(r.listoParaEncender).toBe(true);
    expect(r.interruptor).toBe('APAGADO');
    expect(llamadasStorage).toHaveLength(1);
    expect(llamadasStorage[0].accion).toBe('metaItf');
    expect(r.contadores).toEqual({ eventos: 0, usuariosActivosConPerfilSubir: 1, usuariosActivosConPerfilValidar: 1 });
  });

  test('SOLO LECTURA: no escribe propiedades, no inserta hojas, no cambia ninguna celda, no toca Drive mas que abrir la carpeta, no llama a ningun otro endpoint del storage', () => {
    montar({ filasEventos: 3 });
    const antes = instantanea();
    const insertSheet = jest.spyOn(global.SpreadsheetApp.openById(), 'insertSheet');
    global.preflightItfE9();
    expect(setProperty).not.toHaveBeenCalled();
    expect(instantanea()).toBe(antes);
    expect(insertSheet).not.toHaveBeenCalled();
    expect(llamadasStorage.map((l) => l.accion)).toEqual(['metaItf']);
    expect(Object.keys(global.DriveApp)).toEqual(['getFolderById']);
  });

  test('NO expone ids de Drive, la URL, el secreto, el id del spreadsheet ni emails: ni en el resultado ni en el Logger', () => {
    montar();
    const r = global.preflightItfE9();
    const todo = JSON.stringify(r) + salida();
    SECRETOS.forEach((s) => expect(todo).not.toContain(s));
    expect(todo).not.toMatch(/@|docs\.google|drive\.google|script\.google/);
    montar({ storage: 'caido', hojaItfEventos: false, columnas: false, carpeta: false });
    const r2 = global.preflightItfE9();
    SECRETOS.forEach((s) => expect(JSON.stringify(r2) + salida()).not.toContain(s));
  });

  test.each([
    ['sin la hoja ItfEventos', { hojaItfEventos: false }, 'hoja_itfeventos'],
    ['sin columnas en Usuarios', { columnas: false }, 'usuarios_columna_perfil_subir'],
    ['storage sin acciones de ITF (todavia es la version vieja)', { storage: 'sin-acciones' }, 'storage_itf'],
    ['storage sin ITF_ROOT_FOLDER_ID', { storage: 'sin-raiz' }, 'storage_itf'],
    ['storage caido', { storage: 'caido' }, 'storage_itf'],
    ['sin carpeta legacy', { carpeta: false }, 'carpeta_legacy'],
    ['un pozo con .JPG que ademas tiene .jpg (ambiguo): el lookup no lo da por UNICO', { variantesAmbiguas: true }, 'legacy_variantes_mayusculas']
  ])('%s: el preflight lo dice y NO queda listo', (_n, cfg, id) => {
    montar(cfg);
    const r = global.preflightItfE9();
    expect(r.listoParaEncender).toBe(false);
    expect(r.items.find((i) => i.id === id).ok).toBe(false);
  });

  test('sin FOTOS_STORAGE_URL ni secreto: storage_configurado falla y NO se hace ninguna llamada', () => {
    montar();
    delete props.FOTOS_STORAGE_URL;
    const r = global.preflightItfE9();
    expect(r.items.find((i) => i.id === 'storage_configurado').ok).toBe(false);
    expect(llamadasStorage).toHaveLength(0);
  });

  test('una hoja ItfEventos con esquema roto se informa y NO se toca', () => {
    montar();
    hojas.ItfEventos.filas[0] = ['otra', 'cosa'];
    const antes = instantanea();
    const r = global.preflightItfE9();
    expect(r.items.find((i) => i.id === 'hoja_itfeventos')).toMatchObject({ ok: false });
    expect(instantanea()).toBe(antes);
  });

  test('itfE9Encender con el preflight EN VERDE: pone SI y E9 queda activo', () => {
    montar();
    expect(global.itfService_e9Activo()).toBe(false);
    expect(global.itfE9Encender()).toEqual({ encendido: true });
    expect(setProperty).toHaveBeenCalledWith('ITF_E9_ACTIVO', 'SI');
    expect(global.itfService_e9Activo()).toBe(true);
  });

  test.each([
    ['sin hoja', { hojaItfEventos: false }],
    ['sin columnas', { columnas: false }],
    ['storage sin acciones', { storage: 'sin-acciones' }],
    ['storage caido', { storage: 'caido' }]
  ])('itfE9Encender con el preflight en ROJO (%s): NO enciende, NO escribe nada y dice por que', (_n, cfg) => {
    montar(cfg);
    const r = global.itfE9Encender();
    expect(r.encendido).toBe(false);
    expect(r.motivo).toBe('PREFLIGHT_NO_OK');
    expect(r.pendientes.length).toBeGreaterThan(0);
    expect(setProperty).not.toHaveBeenCalled();
    expect(global.itfService_e9Activo()).toBe(false);
    expect(salida()).toMatch(/NO SE ENCENDIO/);
  });

  test('itfE9Apagar: SIEMPRE funciona (aun con todo en rojo) y es el rollback inmediato; no toca la hoja ni el storage', () => {
    montar();
    global.itfE9Encender();
    expect(global.itfService_e9Activo()).toBe(true);
    montar({ hojaItfEventos: false, storage: 'caido', columnas: false });
    props.ITF_E9_ACTIVO = 'SI';
    const antes = instantanea();
    llamadasStorage.length = 0;
    expect(global.itfE9Apagar()).toEqual({ encendido: false });
    expect(setProperty).toHaveBeenCalledWith('ITF_E9_ACTIVO', 'NO');
    expect(global.itfService_e9Activo()).toBe(false);
    expect(instantanea()).toBe(antes);
    expect(llamadasStorage).toHaveLength(0);
    expect(salida()).toMatch(/No se borro ningun evento ni documento/);
  });

  test('apagado de verdad: con el interruptor en NO / ausente los endpoints de E9 responden ITF_E9_INACTIVO sin tocar hoja ni storage', () => {
    montar();
    global.itfE9Encender();
    global.itfE9Apagar();
    const Api = require('../src/Api');
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'smoke@example.com' });
    global.isUserActive.mockReturnValue(true);
    global.hasPermission.mockReturnValue(true);
    global.getUserAccess.mockReturnValue({ nombre: 'Smoke' });
    llamadasStorage.length = 0;
    const leer = jest.spyOn(global, 'itfEventosRepository_leerTodos');
    expect(Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' }).code).toBe('ITF_E9_INACTIVO');
    expect(Api.handleGetMisPropuestasItf('t', { action: 'getMisPropuestasItf', sessionToken: 't' }).code).toBe('ITF_E9_INACTIVO');
    expect(leer).not.toHaveBeenCalled();
    expect(llamadasStorage).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('medicion', () => {
  test('hash de 100 KB, 500 KB, 1 MB y 3 MB y disponibilidad de 1 y 500 pozos, en ese orden, con el reloj inyectado', () => {
    let reloj = 0;
    const llamadas = [];
    const r = P.itfPreflight_medir({
      ahora: () => { reloj += 10; return reloj; },
      sha256: (bytes) => { llamadas.push(['hash', bytes.length]); return 'x'; },
      disponibilidad: (ids) => { llamadas.push(['disp', ids.length, ids[0], ids[ids.length - 1]]); return {}; }
    });
    expect(r.hash.map((h) => h.tamano.split(' (')[0])).toEqual(['100 KB', '500 KB', '1 MB', '3 MB', '12 MB']);
    expect(llamadas.filter((l) => l[0] === 'hash').map((l) => l[1])).toEqual([100 * 1024, 500 * 1024, 1024 * 1024, 3 * 1024 * 1024, 12 * 1024 * 1024]);
    expect(r.disponibilidad.map((d) => d.consulta)).toEqual(['1 pozo', '500 pozos', '500 pozos (otra vez)']);
    expect(llamadas.filter((l) => l[0] === 'disp').map((l) => l.slice(1))).toEqual([[1, '14-0001', '14-0001'], [500, '14-0001', '14-0500'], [500, '14-0001', '14-0500']]);
    [].concat(r.hash, r.disponibilidad).forEach((x) => expect(x.ms).toBe(10));
  });

  test('cada medicion informa si un legacy de ese tamano es registrable y si una propuesta nueva lo aceptaria: 12 MB = legacy SI, propuesta NO (limites separados)', () => {
    const r = P.itfPreflight_medir({ ahora: () => 1, sha256: () => 'x', disponibilidad: () => ({}) });
    expect(r.hash.map((h) => [h.tamano.split(' (')[0], h.legacyRegistrable, h.propuestaNuevaAceptada])).toEqual([
      ['100 KB', true, true], ['500 KB', true, true], ['1 MB', true, true], ['3 MB', true, true], ['12 MB', true, false]
    ]);
  });
  test('si un hash falla (p. ej. memoria con 12 MB) se informa error:true y la medicion sigue', () => {
    const r = P.itfPreflight_medir({ ahora: () => 1, sha256: (b) => { if (b.length > 5 * 1024 * 1024) { throw new Error('memoria'); } return 'x'; }, disponibilidad: () => ({}) });
    expect(r.hash.map((h) => h.error === true)).toEqual([false, false, false, false, true]);
    expect(r.disponibilidad).toHaveLength(3);
  });

  test('los bytes sinteticos son bytes con signo (como los de Apps Script) y del largo pedido', () => {
    const b = P.itfPreflight_bytesSinteticos(1000);
    expect(b).toHaveLength(1000);
    b.forEach((v) => { expect(v).toBeGreaterThanOrEqual(-128); expect(v).toBeLessThanOrEqual(127); });
  });

  test('medirRendimientoItfE9 usa el hash y el indice reales y deja el informe en el Logger (sin ids)', () => {
    const e = crearEntorno({ archivos: [{ id: 'legacy-14-0001', name: '14-0001.jpg', bytes: [1, 2, 3] }] });
    Object.assign(global, P);
    global.Logger = { log: jest.fn() };
    const r = global.medirRendimientoItfE9();
    expect(r.hash).toHaveLength(5);
    expect(r.disponibilidad).toHaveLength(3);
    expect(global.Logger.log.mock.calls.join('')).not.toMatch(/legacy-14-0001/);
    expect(e).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('lo que el preflight NO hace (el codigo no puede: no tiene como)', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '../src/ItfPreflight.js'), 'utf8').replace(/\r\n/g, '\n');
  const codigo = fuente.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const sinEncenderApagar = codigo.replace(/function itfE9Encender\(\) \{[\s\S]*?\n\}\n/, '').replace(/function itfE9Apagar\(\) \{[\s\S]*?\n\}\n/, '');

  test('ningun trigger, sharing, carpeta nueva, permiso, correo ni Telegram', () => {
    expect(codigo).not.toMatch(/ScriptApp|newTrigger|setSharing|addEditor|addViewer|addCommenter|createFolder|createFile|setTrashed|moveTo|removeFile|UrlFetchApp|MailApp|GmailApp|insertSheet|deleteSheet|setValues|setValue\(|appendRow|clear\(|CacheService/);
  });

  test('solo itfE9Encender / itfE9Apagar escriben una propiedad; el preflight y la medicion no', () => {
    expect(sinEncenderApagar).not.toMatch(/setProperty|setProperties|deleteProperty|deleteAllProperties/);
    expect(codigo.match(/setProperty\(/g)).toHaveLength(2);
  });

  test('no la llama ningun archivo vivo de la app (ni Api.js, ni el frontend, ni sw.js, ni gas.js)', () => {
    ['backend/src/Api.js', 'backend/src/Config.js', 'backend/src/ItfService.js', 'js/app.js', 'js/api.js', 'sw.js', 'scripts/gas/gas.js'].forEach((f) => {
      const t = fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');
      expect(t).not.toMatch(/preflightItfE9|itfE9Encender|itfE9Apagar|medirRendimientoItfE9|ItfPreflight/);
    });
  });

  test('el interruptor sigue siendo la propiedad que lee el servicio (ITF_E9_ACTIVO) y no hay otra fuente', () => {
    const servicio = fs.readFileSync(path.join(__dirname, '../src/ItfService.js'), 'utf8');
    expect(servicio).toContain("var ITF_E9_PROPIEDAD = 'ITF_E9_ACTIVO';");
    expect(servicio).toMatch(/getProperty\(ITF_E9_PROPIEDAD\) === 'SI'/);
    expect(P.ITF_PREFLIGHT_PROPIEDAD).toBe('ITF_E9_ACTIVO');
  });
});
