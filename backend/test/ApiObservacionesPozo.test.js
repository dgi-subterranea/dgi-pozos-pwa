// getObservacionesPozo (E5-1) por doPost, con el codigo REAL (Api -> permisos -> ObservacionesPozoService -> repositorio con hoja en memoria). Solo se simulan la sesion/usuarios, Sheets y el
// Historial. Permisos fail-closed y orden de chequeos, NO verifica existencia del pozo, privacidad de las anuladas, paginacion, hoja ausente o mal formada, y que no escribe nada.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Api;
let Repo;
let hojas;

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

const USUARIOS = {
  'lector@x.com': { nombre: 'Lector', permisos: { observaciones: true } },
  'mod@x.com': { nombre: 'Moderadora', permisos: { observaciones: true, observaciones_anular: true } },
  'ana@x.com': { nombre: 'Ana', permisos: { observaciones: true, observaciones_agregar: true } },
  'todo@x.com': { nombre: 'Todo', permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'sinver@x.com': { nombre: 'Sin ver', permisos: { observaciones_agregar: true, observaciones_anular: true } },
  'ubic@x.com': { nombre: 'Solo ubicacion', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true, datos: true, perfil: true } },
  'nada@x.com': { nombre: 'Nada', permisos: {} },
  'baja@x.com': { nombre: 'Baja', permisos: { observaciones: true, observaciones_anular: true }, inactivo: true }
};

const COLUMNAS = require('../src/ObservacionesPozoRepository').OBSERVACIONES_POZO_COLUMNAS;          // constante: sirve antes de armar el entorno
const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-' + n }, extra || {}));
const anula = (n, id, extra) => fila(Object.assign({ observacionId: uuid(id), evento: 'ANULADA', wellId: W, motivo: 'Tenia un dato personal', email: 'mod@x.com', nombre: 'Moderadora', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-a-' + n }, extra || {}));

function armar(filas, opciones) {
  const o = opciones || {};
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  Repo = require('../src/ObservacionesPozoRepository');
  const Service = require('../src/ObservacionesPozoService');
  Object.assign(global, Repo, Service);
  hojas = instalarSheetsFalsos(o.sinHoja ? {} : { ObservacionesPozo: [o.header || Repo.OBSERVACIONES_POZO_COLUMNAS].concat(filas || []) });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e] && USUARIOS[e].inactivo !== true, nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true && USUARIOS[e].permisos[m] === true);
  // la existencia y las otras fuentes NO deben consultarse en una lectura
  global.pozoExistenciaService_verificar = jest.fn(() => { throw new Error('la lectura de observaciones no verifica existencia'); });
  global.registryService_getWellLocation = jest.fn(() => { throw new Error('no debe leer el padron'); });
  global.driveProfileRepository_existe = jest.fn(() => { throw new Error('no debe consultar el ITF'); });
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => { throw new Error('no debe consultar NE'); });
}

const post = (cuerpo) => JSON.parse(Api.doPost({ postData: { contents: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) } }).text);
const leer = (extra, usuario) => post(Object.assign({ action: 'getObservacionesPozo', sessionToken: 'tok-' + (usuario || 'lector@x.com'), wellId: W }, extra || {}));
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());

beforeEach(() => { armar([alta(1), alta(2), anula(3, 2)]); });
afterEach(() => { jest.restoreAllMocks(); });

describe('enrutado por doPost', () => {
  test('getObservacionesPozo existe y responde; una accion parecida sigue siendo "accion desconocida"', () => {
    expect(leer().status).toBe('ok');
    expect(post({ action: 'getObservacionPozo', sessionToken: 'tok-lector@x.com', wellId: W })).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: expect.stringMatching(/accion desconocida/) });
    expect(post({ action: 'anularObservacionPozo', sessionToken: 'tok-ana@x.com' }).message).toMatch(/accion desconocida/);                     // la anulacion llega en E5-3
    expect(post({ action: 'editarObservacionPozo', sessionToken: 'tok-ana@x.com' }).message).toMatch(/accion desconocida/);                     // y no hay edicion
  });

  test('las acciones de siempre no cambiaron', () => {
    global.reemplazoService_getEstado.mockReturnValue({ wellId: W, estado: 'SIN_EVALUAR' });
    global.hasPermission.mockImplementation(() => true);
    expect(post({ action: 'getEstadoReemplazo', sessionToken: 'tok-lector@x.com', wellId: W }).status).toBe('ok');
  });
});

describe('permisos: fail-closed y orden de chequeos', () => {
  test.each([
    ['lector (observaciones)', 'lector@x.com'], ['moderadora (observaciones + anular)', 'mod@x.com'], ['quien agrega (observaciones + agregar)', 'ana@x.com'], ['todos', 'todo@x.com']
  ])('%s: puede leer', (n, usuario) => {
    expect(leer({}, usuario).status).toBe('ok');
  });

  test.each([
    ['solo agregar y anular, SIN observaciones', 'sinver@x.com'], ['permisos de ubicacion / datos / perfil, sin observaciones', 'ubic@x.com'], ['sin ningun permiso', 'nada@x.com']
  ])('%s -> PERMISSION_DENIED, sin datos, y queda en Historial', (n, usuario) => {
    const r = leer({}, usuario);
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(r.data).toBeUndefined();
    expect(historial()).toContainEqual([usuario, 'getObservacionesPozo', W, 'PERMISSION_DENIED']);
  });

  test.each([
    ['usuario inactivo (aunque tenga todo)', 'baja@x.com', 'USER_DISABLED'],
    ['token invalido', 'nadie@x.com', 'UNAUTHORIZED']
  ])('%s -> %s', (n, usuario, code) => {
    expect(leer({}, usuario)).toMatchObject({ status: 'error', code });
  });

  test('token vacio o ausente -> UNAUTHORIZED', () => {
    expect(post({ action: 'getObservacionesPozo', sessionToken: '', wellId: W }).code).toBe('UNAUTHORIZED');
    expect(post({ action: 'getObservacionesPozo', wellId: W }).code).toBe('UNAUTHORIZED');
  });

  test('el formato del wellId se valida DESPUES de la sesion y ANTES del permiso', () => {
    expect(post({ action: 'getObservacionesPozo', sessionToken: 'tok-nada@x.com', wellId: 'x' }).code).toBe('INVALID_WELL_ID');
    expect(post({ action: 'getObservacionesPozo', sessionToken: 'tok-nadie@x.com', wellId: 'x' }).code).toBe('UNAUTHORIZED');
  });

  test.each([['x'], ['99-0001'], ['00-0001'], ['14-001'], ['14-00001'], [''], [null], [undefined], [['14-0001']], [{ a: 1 }], [14]])('wellId invalido %j -> INVALID_WELL_ID', (w) => {
    expect(leer({ wellId: w })).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
  });

  test('un permiso en la hoja Usuarios que no es exactamente verdadero no habilita (fail-closed en el codigo)', () => {
    ['SI', 'si', 1, 'true', 'x', null, undefined].forEach((v) => {
      USUARIOS['raro@x.com'] = { nombre: 'Raro', permisos: { observaciones: v } };
      expect(leer({}, 'raro@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    });
    delete USUARIOS['raro@x.com'];
  });
});

describe('NO verifica existencia: pozo desconocido -> lista vacia', () => {
  test('un pozo que no existe en ninguna fuente y sin filas: ok, lista vacia', () => {
    const r = leer({ wellId: '14-9999' });
    expect(r).toEqual({ status: 'ok', data: { wellId: '14-9999', total: 0, activas: 0, anuladas: 0, hayMas: false, cursor: null, observaciones: [] } });
  });

  test('no se consulta ninguna fuente de existencia (padron, ITF, NE, PozoExistenciaService)', () => {
    leer({ wellId: '14-9999' });
    leer();
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
    expect(global.driveProfileRepository_existe).not.toHaveBeenCalled();
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
  });

  test('las observaciones NO son evidencia de existencia: leer un pozo con observaciones no cambia nada en las demas fuentes', () => {
    leer();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });
});

describe('respuesta: contrato minimo y privacidad', () => {
  test('campos de la respuesta y de cada observacion: lista blanca exacta, mas reciente primero', () => {
    const r = leer();
    expect(Object.keys(r.data).sort()).toEqual(['activas', 'anuladas', 'cursor', 'hayMas', 'observaciones', 'total', 'wellId']);
    expect(r.data).toMatchObject({ wellId: W, total: 2, activas: 1, anuladas: 1, hayMas: false, cursor: null });
    expect(r.data.observaciones.map((o) => o.observacionId)).toEqual([uuid(2), uuid(1)]);
    r.data.observaciones.forEach((o) => expect(Object.keys(o).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'texto', 'timestamp', 'wellId']));
  });

  test('el email NUNCA sale, ni secuencia ni clientRequestId (con ningun usuario)', () => {
    ['lector@x.com', 'mod@x.com', 'todo@x.com'].forEach((u) => {
      const texto = JSON.stringify(leer({}, u));
      expect(texto).not.toMatch(/@/);
      expect(texto).not.toMatch(/secuencia|clientRequestId|req-/);
    });
  });

  test('anulada + lector: texto null, pero si el motivo y quien anulo; activa + lector: el texto', () => {
    const r = leer({}, 'lector@x.com');
    const anulada = r.data.observaciones.find((o) => o.estado === 'ANULADA');
    const activa = r.data.observaciones.find((o) => o.estado === 'ACTIVA');
    expect(anulada.texto).toBeNull();
    expect(anulada.anulacion).toEqual({ nombre: 'Moderadora', timestamp: ISO, motivo: 'Tenia un dato personal' });
    expect(activa.texto).toBe('Texto 1');
  });

  test('anulada + observaciones_anular: el texto original (auditoria)', () => {
    const anulada = leer({}, 'mod@x.com').data.observaciones.find((o) => o.estado === 'ANULADA');
    expect(anulada.texto).toBe('Texto 2');
    expect(leer({}, 'todo@x.com').data.observaciones.find((o) => o.estado === 'ANULADA').texto).toBe('Texto 2');
  });

  test('observaciones_agregar NO da acceso al texto de las anuladas (solo observaciones_anular)', () => {
    expect(leer({}, 'ana@x.com').data.observaciones.find((o) => o.estado === 'ANULADA').texto).toBeNull();
  });

  test('el cliente NO puede pedirse ser moderador: moderador / email / permisos en el cuerpo se ignoran', () => {
    const r = leer({ moderador: true, email: 'mod@x.com', permisos: { observaciones_anular: true }, esModerador: true }, 'lector@x.com');
    expect(r.data.observaciones.find((o) => o.estado === 'ANULADA').texto).toBeNull();
  });

  test('autor: nombre de la hoja; si falta, la etiqueta neutra "Usuario"', () => {
    armar([alta(1, { nombre: '' }), alta(2, { nombre: 'ana@x.com' }), alta(3, { nombre: 'Ana Pérez' })]);
    expect(leer().data.observaciones.map((o) => o.nombre)).toEqual(['Ana Pérez', 'Usuario', 'Usuario']);
  });
});

describe('paginacion por el endpoint', () => {
  beforeEach(() => {
    const filas = [];
    for (let i = 1; i <= 130; i += 1) { filas.push(alta(i)); }
    armar(filas);
  });

  test('por defecto 50; hayMas y cursor', () => {
    const r = leer();
    expect(r.data.observaciones).toHaveLength(50);
    expect(r.data).toMatchObject({ total: 130, activas: 130, anuladas: 0, hayMas: true, cursor: 81 });
  });

  test('limit acotado a 100; limit chico', () => {
    expect(leer({ limit: 500 }).data.observaciones).toHaveLength(100);
    expect(leer({ limit: 3 }).data.observaciones.map((o) => o.observacionId)).toEqual([uuid(130), uuid(129), uuid(128)]);
  });

  test('recorrido completo con el cursor: sin duplicados, en orden descendente', () => {
    const vistos = [];
    let cursor;
    let paginas = 0;
    do {
      const r = leer(cursor === undefined ? {} : { antesDeSecuencia: cursor });
      r.data.observaciones.forEach((o) => vistos.push(o.observacionId));
      cursor = r.data.cursor;
      paginas += 1;
    } while (cursor !== null);
    expect(paginas).toBe(3);
    expect(vistos).toHaveLength(130);
    expect(new Set(vistos).size).toBe(130);
    expect(vistos[0]).toBe(uuid(130));
    expect(vistos[129]).toBe(uuid(1));
  });

  test.each([[0], [-1], [1.5], ['5'], [{}]])('limit %j -> INVALID_LIMIT (y queda en Historial)', (limit) => {
    expect(leer({ limit: limit })).toMatchObject({ status: 'error', code: 'INVALID_LIMIT' });
    expect(historial()).toContainEqual(['lector@x.com', 'getObservacionesPozo', W, 'INVALID_LIMIT']);
  });

  test.each([[0], [-1], [2.5], ['5'], [true]])('antesDeSecuencia %j -> INVALID_CURSOR', (c) => {
    expect(leer({ antesDeSecuencia: c })).toMatchObject({ status: 'error', code: 'INVALID_CURSOR' });
  });

  test('estable: llegan observaciones nuevas entre la pagina 1 y la 2, y la pagina 2 no cambia', () => {
    const p1 = leer({ limit: 10 });
    hojas.ObservacionesPozo.filas.push(alta(131), alta(132));
    const p2 = leer({ limit: 10, antesDeSecuencia: p1.data.cursor });
    expect(p2.data.observaciones.map((o) => o.observacionId)).toEqual(Array.from({ length: 10 }, (_, i) => uuid(120 - i)));
    expect(p2.data.total).toBe(132);                                         // los totales si reflejan lo nuevo (son globales del pozo)
  });
});

describe('hoja ausente o mal formada: error controlado, nada se crea ni se repara', () => {
  test('hoja inexistente -> SERVICE_UNAVAILABLE (queda en Historial) y NO se crea', () => {
    armar([], { sinHoja: true });
    const r = leer();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(r.data).toBeUndefined();
    expect(historial()).toContainEqual(['lector@x.com', 'getObservacionesPozo', W, 'SERVICE_UNAVAILABLE']);
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('encabezado con una columna faltante -> SERVICE_UNAVAILABLE y la hoja no se toca', () => {
    armar([alta(1)], { header: Repo.OBSERVACIONES_POZO_COLUMNAS.filter((c) => c !== 'secuencia') });
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    expect(leer()).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
  });

  test('una hoja vacia (solo encabezado): ok con lista vacia', () => {
    armar([]);
    expect(leer().data).toMatchObject({ total: 0, observaciones: [] });
  });
});

describe('Historial y efectos: una lectura OK no escribe nada', () => {
  test('lectura OK: ninguna fila en Historial', () => {
    leer();
    leer({}, 'mod@x.com');
    expect(historial()).toEqual([]);
  });

  test('la hoja de observaciones no se modifica por leer', () => {
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    leer();
    leer({ limit: 1 }, 'mod@x.com');
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
  });

  test('eventos inconsistentes en la hoja no rompen la lectura ni muestran lo oculto', () => {
    armar([
      alta(1, { texto: 'oculta' }), anula(2, 1, { secuencia: '', timestampUtc: 'x', wellId: '', motivo: '', nombre: '' }),
      anula(3, 77), fila({ wellId: W }), alta(4, { evento: 'EDITADA' }), alta(5)
    ]);
    const r = leer({}, 'lector@x.com');
    expect(r.status).toBe('ok');
    expect(JSON.stringify(r)).not.toContain('oculta');
    expect(r.data.observaciones.map((o) => [o.observacionId, o.estado])).toEqual([[uuid(5), 'ACTIVA'], [uuid(1), 'ANULADA']]);
  });
});

describe('E5-1: identidad y secuencia duplicadas en la hoja (se oculta, nunca se elige)', () => {
  test('por el endpoint: las ambiguas no salen (ni para quien modera), los totales solo cuentan lo retornable y lo sano sigue completo', () => {
    armar([
      alta(1, { texto: 'sana uno' }),
      alta(2, { observacionId: uuid(50), texto: 'ambigua A' }), alta(3, { observacionId: uuid(50), texto: 'ambigua B' }),
      alta(4, { secuencia: 9, texto: 'colision A' }), alta(5, { secuencia: 9, texto: 'colision B' }),
      alta(6, { texto: 'sana seis' }), anula(10, 6)
    ]);
    ['lector@x.com', 'mod@x.com'].forEach((u) => {
      const r = leer({}, u);
      expect(r.status).toBe('ok');
      expect(JSON.stringify(r)).not.toMatch(/ambigua [AB]|colision [AB]/);
      expect(r.data).toMatchObject({ total: 2, activas: 1, anuladas: 1, hayMas: false });
      expect(r.data.observaciones.map((o) => [o.observacionId, o.estado])).toEqual([[uuid(6), 'ANULADA'], [uuid(1), 'ACTIVA']]);
    });
    expect(historial()).toEqual([]);                                                    // el diagnostico va a Logger, no a Historial
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toMatch(/ID_DUPLICADO ids=\[00000000-0000-4000-8000-000000000050\]/);
    expect(log).toMatch(/SECUENCIA_DUPLICADA/);
    expect(log).not.toMatch(/ambigua [AB]|colision [AB]|sana uno|sana seis|@/);
  });

  test('una ANULADA cuya secuencia choca con otro evento NO expone el texto de la observacion que anula (ni como activa ni al moderador)', () => {
    armar([alta(1, { texto: 'confidencial' }), alta(2), anula(7, 1), alta(3, { secuencia: 7 })]);
    ['lector@x.com', 'mod@x.com', 'todo@x.com'].forEach((u) => {
      const r = leer({}, u);
      expect(JSON.stringify(r)).not.toContain('confidencial');
      expect(r.data.observaciones.map((o) => o.observacionId)).toEqual([uuid(2)]);
    });
  });

  test('paginacion con una secuencia corrupta en el medio: sin duplicados ni perdidas, cursor estricto', () => {
    const filas = [];
    for (let i = 1; i <= 12; i += 1) { filas.push(i === 6 ? alta(60, { secuencia: 6 }) : alta(i)); }
    filas.push(alta(61, { secuencia: 6 }));
    armar(filas);
    const vistas = [];
    let cursor;
    do {
      const r = leer(Object.assign({ limit: 4 }, cursor === undefined ? {} : { antesDeSecuencia: cursor }));
      r.data.observaciones.forEach((o) => vistas.push(o.observacionId));
      cursor = r.data.cursor;
    } while (cursor !== null);
    expect(vistas).toEqual([12, 11, 10, 9, 8, 7, 5, 4, 3, 2, 1].map(uuid));
    expect(leer({ antesDeSecuencia: 6 }).data.observaciones.map((o) => o.observacionId)).toEqual([5, 4, 3, 2, 1].map(uuid));
  });
});
