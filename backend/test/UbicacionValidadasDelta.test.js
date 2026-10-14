// getUbicacionesValidadas (Etapa 2 del PUNTO OPERATIVO): el delta de ubicaciones VALIDADAS vigentes + su cache (CacheService, 120 s) + la invalidacion.
// Reglas bajo prueba: UNA sola interpretacion de la cadena de estados (la misma que getPorPozo), payload minimo {wellId, lat, lon, vts}, cualquier usuario ACTIVO,
// invalidacion solo cuando cambia la vigente (auto-validar, validar, revertir) y nunca a costa de la operacion principal.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const OperativaLogic = require('../../js/ubicacionOperativaLogic');

const raiz = path.join(__dirname, '..', '..');
const apiFrontend = fs.readFileSync(path.join(raiz, 'js', 'api.js'), 'utf8');

const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const norte = (grados) => OFICIAL.lat + grados;
const USUARIOS = {
  'ana@x.com': { nombre: 'Ana Pérez', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'carla@x.com': { nombre: 'Carla Directa', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'val@x.com': { nombre: 'Valeria Validadora', permisos: { ubicacion: true, ubicacion_validar: true } },
  'nada@x.com': { nombre: 'Sin Permisos', permisos: {} }
};

let Api;
let S;
let Repo;
let hojas;
let ctxFrontend;
let cache;
let lecturas;
let reloj;       // Date.now controlado: la marca de invalidacion usa el margen de 2 s, asi que despues de escribir hay que "dejar pasar" tiempo para que una lectura pueda cachear
const calmar = () => { reloj += 60000; };

// CacheService falso con espias: guarda ttl, cuenta llamadas y permite hacerlo fallar.
function crearCache() {
  const store = {};
  const c = {
    store,
    falla: { get: false, put: false, remove: false },
    get: jest.fn((k) => { if (c.falla.get) { throw new Error('cache get caido'); } return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }),
    put: jest.fn((k, v, ttl) => { if (c.falla.put) { throw new Error('cache put caido'); } store[k] = v; c.ttl = c.ttl || {}; c.ttl[k] = ttl; }),
    remove: jest.fn((k) => { if (c.falla.remove) { throw new Error('cache remove caido'); } delete store[k]; })
  };
  return c;
}

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  Repo = require('../src/UbicacionCorreccionRepository');
  S = require('../src/UbicacionCorreccionService');
  Object.assign(global, Repo, S);
  hojas = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS] });
  global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  global.registryService_getWellLocation = jest.fn((id) => (/^14-/.test(id) ? { found: true, location: { wellId: id, ubicacionResuelta: OFICIAL } } : { found: false }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
  global.logHistoryEvent = jest.fn();
  global.getUbicacionesValidadasReal = undefined;
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);
  reloj = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => reloj);
  cache = crearCache();
  global.CacheService = { getScriptCache: () => cache };
  // cuenta las lecturas REALES de la hoja de correcciones (una por calculo del delta)
  const listarOriginal = Repo.ubicacionCorreccionRepository_listarCorrecciones;
  lecturas = 0;
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { lecturas += 1; return listarOriginal(); });
  ctxFrontend = vm.createContext({
    JSON, Object,
    fetch: (url, opciones) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(Api.doPost({ postData: { contents: opciones.body } }).text)) })
  });
  vm.runInContext(apiFrontend, ctxFrontend);
});

afterEach(() => { jest.restoreAllMocks(); });

let n = 0;
const datos = (wellIdIdx, extra) => {
  n += 1;
  return Object.assign({ clientRequestId: 'delta-' + String(n).padStart(8, '0'), metodo: 'PUNTO_EN_MAPA', lat: norte(0.0002 + (wellIdIdx || 0) * 0.00001), lon: OFICIAL.lon, precisionGpsM: null, observacion: '' }, extra || {});
};
const pozo = (i) => '14-' + String(i).padStart(4, '0');
const proponer = (email, i, extra, opciones) => S.ubicacionCorreccionService_proponer(email || 'ana@x.com', USUARIOS[email || 'ana@x.com'].nombre, pozo(i || 1), datos(i, extra), opciones);
const auto = (i, extra) => proponer('carla@x.com', i, extra, { autoValidar: true });
const idDe = (r) => { expect(r.ok).toBe(true); return r.correccion.correccionId; };
const validar = (id) => S.ubicacionCorreccionService_validar('val@x.com', 'Valeria Validadora', id, '');
const rechazar = (id) => S.ubicacionCorreccionService_rechazar('val@x.com', 'Valeria Validadora', id, 'No coincide');
const revertir = (id) => S.ubicacionCorreccionService_revertir('val@x.com', 'Valeria Validadora', id, 'Se equivoco');
const delta = () => S.ubicacionCorreccionService_getUbicacionesValidadas();
const KEY = () => S.UBICACION_VALIDADAS_CACHE_KEY;
const claves = (o) => Object.keys(o).sort();

// ---------------------------------------------------------------------------------------------------------------- consistencia (derivadas armadas a mano)
let seq = 0;
// una correccion con su cadena de eventos: eventos = [['PROPUESTA', ts], ['VALIDADA', ts], ...]
function cadena(wellId, lat, lon, tsPropuesta, eventos, extra) {
  seq += 1;
  const id = '00000000-0000-4000-8000-' + String(seq).padStart(12, '0');
  return {
    c: Object.assign({ correccionId: id, wellId: wellId, lat: lat, lon: lon, metodo: 'PUNTO_EN_MAPA', timestamp: tsPropuesta, emailPropone: 'ana@x.com', nombrePropone: 'Ana Pérez', observacion: 'obs secreta' }, extra || {}),
    e: eventos.map(([ev, ts]) => ({ correccionId: id, evento: ev, timestamp: ts, email: 'val@x.com', nombre: 'Valeria Validadora', motivo: 'motivo secreto' }))
  };
}
const derivar = (cadenas) => S.ubicacionCorreccionService_derivar(cadenas.map((x) => x.c), [].concat(...cadenas.map((x) => x.e)));
const delDerivadas = (cadenas) => S.ubicacionCorreccionService_ubicacionesValidadas(derivar(cadenas));
const VALIDADA = (ts) => [['PROPUESTA', ts], ['VALIDADA', ts]];

describe('delta: que correcciones generan ubicacion', () => {
  const T = (d) => '2026-10-' + String(d).padStart(2, '0') + 'T10:00:00.000Z';

  test('una VALIDADA -> UN delta, con wellId, lat, lon y vts', () => {
    const r = delDerivadas([cadena('14-0001', -33.3, -69.1, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(2)]])]);
    expect(r).toEqual([{ wellId: '14-0001', lat: -33.3, lon: -69.1, vts: T(2) }]);
  });

  test('vts es el timestamp del evento VALIDADA (cuando paso a ser vigente), NO el de la propuesta', () => {
    const r = delDerivadas([cadena('14-0001', -33.3, -69.1, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(9)]])]);
    expect(r[0].vts).toBe(T(9));
    expect(r[0].vts).not.toBe(T(1));
  });

  test('varias historicas + UNA vigente -> solo la vigente', () => {
    const r = delDerivadas([
      cadena('14-0001', -33.1, -69.1, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['SUPERADA', T(3)]]),
      cadena('14-0001', -33.2, -69.2, T(2), [['PROPUESTA', T(2)], ['RECHAZADA', T(2)]]),
      cadena('14-0001', -33.3, -69.3, T(3), [['PROPUESTA', T(3)], ['VALIDADA', T(3)]]),
      cadena('14-0001', -33.4, -69.4, T(4), [['PROPUESTA', T(4)]])
    ]);
    expect(r).toEqual([{ wellId: '14-0001', lat: -33.3, lon: -69.3, vts: T(3) }]);
  });

  test.each([
    ['SUPERADA', [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['SUPERADA', T(2)]]],
    ['REVERTIDA', [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['REVERTIDA', T(2)]]],
    ['PROPUESTA', [['PROPUESTA', T(1)]]],
    ['RECHAZADA', [['PROPUESTA', T(1)], ['RECHAZADA', T(2)]]],
    ['INCONSISTENTE (sin eventos)', []],
    ['INCONSISTENTE (sin PROPUESTA inicial)', [['VALIDADA', T(1)]]],
    ['INCONSISTENTE (salto imposible)', [['PROPUESTA', T(1)], ['REVERTIDA', T(2)]]]
  ])('%s -> no genera delta', (_n, eventos) => {
    expect(delDerivadas([cadena('14-0001', -33.3, -69.1, T(1), eventos)])).toEqual([]);
  });

  test('una REVERTIDA no revive a la SUPERADA anterior: el pozo queda sin delta (vuelve a su base)', () => {
    const r = delDerivadas([
      cadena('14-0001', -33.1, -69.1, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['SUPERADA', T(2)]]),
      cadena('14-0001', -33.2, -69.2, T(2), [['PROPUESTA', T(2)], ['VALIDADA', T(2)], ['REVERTIDA', T(3)]])
    ]);
    expect(r).toEqual([]);
  });

  test('dos VALIDADA inconsistentes del mismo pozo -> UN solo delta: la mas reciente (por fecha de propuesta; empate: la fila posterior)', () => {
    const r = delDerivadas([cadena('14-0001', -33.1, -69.1, T(1), VALIDADA(T(1))), cadena('14-0001', -33.2, -69.2, T(5), VALIDADA(T(5)))]);
    expect(r).toEqual([{ wellId: '14-0001', lat: -33.2, lon: -69.2, vts: T(5) }]);
    const invertido = delDerivadas([cadena('14-0001', -33.2, -69.2, T(5), VALIDADA(T(5))), cadena('14-0001', -33.1, -69.1, T(1), VALIDADA(T(1)))]);
    expect(invertido).toEqual([{ wellId: '14-0001', lat: -33.2, lon: -69.2, vts: T(5) }]);
    const empate = delDerivadas([cadena('14-0001', -33.1, -69.1, T(1), VALIDADA(T(1))), cadena('14-0001', -33.2, -69.2, T(1), VALIDADA(T(1)))]);
    expect(empate).toHaveLength(1);
    expect(empate[0].lat).toBe(-33.2);
  });

  test('un wellId nunca produce dos deltas, aunque tenga muchas VALIDADA inconsistentes', () => {
    const r = delDerivadas([1, 2, 3, 4, 5].map((d) => cadena('14-0001', -33 - d / 10, -69, T(d), VALIDADA(T(d)))));
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBeCloseTo(-33.5, 5);
  });

  test('coordenadas invalidas (no numericas, NaN, null) o fuera de Mendoza NO salen; las validas de otros pozos si', () => {
    const r = delDerivadas([
      cadena('14-0001', 'x', -69.1, T(1), VALIDADA(T(1))),
      cadena('14-0002', NaN, -69.1, T(1), VALIDADA(T(1))),
      cadena('14-0003', null, null, T(1), VALIDADA(T(1))),
      cadena('14-0004', 10, 10, T(1), VALIDADA(T(1))),
      cadena('14-0005', -40, -69.1, T(1), VALIDADA(T(1))),
      cadena('14-0006', -33.3, -60, T(1), VALIDADA(T(1))),
      cadena('14-0007', -33.3, -69.1, T(1), VALIDADA(T(1)))
    ]);
    expect(r.map((d) => d.wellId)).toEqual(['14-0007']);
  });

  test('una vigente invalida NO hace que salga otra correccion mas vieja del mismo pozo (no se "rescata" una anterior)', () => {
    const r = delDerivadas([
      cadena('14-0001', -33.1, -69.1, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['SUPERADA', T(5)]]),
      cadena('14-0001', 'x', -69.2, T(5), VALIDADA(T(5)))
    ]);
    expect(r).toEqual([]);
  });

  test('orden de salida DETERMINISTA: por wellId, sin importar el orden de la hoja', () => {
    const c = [['14-0300'], ['14-0010'], ['04-0002'], ['14-0100']].map(([w], i) => cadena(w, -33 - i / 100, -69, T(1 + i), VALIDADA(T(1 + i))));
    const a = delDerivadas(c).map((d) => d.wellId);
    expect(a).toEqual(['04-0002', '14-0010', '14-0100', '14-0300']);
    expect(delDerivadas(c.slice().reverse()).map((d) => d.wellId)).toEqual(a);
  });

  test('payload SIN campos sensibles: solo wellId, lat, lon y vts (ni autor, observacion, metodo, motivo, ids, coordenada original, distancia ni snapshot)', () => {
    const c = cadena('14-0001', -33.3, -69.1, T(1), VALIDADA(T(2)), {
      metodo: 'COORDENADAS_GMS', coordenadaOriginalTexto: "33° 20' 51\" S", crsOriginal: 'GMS_WGS84', distanciaM: 50, irrLat: -33, irrLon: -69, irrEstado: 'unica', irrFuente: 'reportePozos', padronPeriodo: '2026-09',
      precisionGpsM: 9, clientRequestId: 'secreto-1234', advertenciaDistancia: false
    });
    const r = delDerivadas([c]);
    expect(claves(r[0])).toEqual(['lat', 'lon', 'vts', 'wellId']);
    expect(JSON.stringify(r)).not.toMatch(/Ana|Valeria|@|secret|GMS|EPSG|0000-4000|reportePozos|2026-09|distancia|metodo|motivo|observ/i);
  });

  test('entradas raras no rompen: sin derivadas, null, lista vacia', () => {
    [undefined, null, []].forEach((v) => expect(S.ubicacionCorreccionService_ubicacionesValidadas(v)).toEqual([]));
  });

  test('EQUIVALENCIA con getPorPozo: la correccion que elige el delta es EXACTAMENTE la vigente de getPorPozo, en todos los escenarios mezclados', () => {
    const cadenas = [
      cadena('14-0001', -33.11, -69.11, T(1), VALIDADA(T(1))),
      cadena('14-0001', -33.12, -69.12, T(5), VALIDADA(T(5))),                                                  // dos VALIDADA: gana T(5)
      cadena('14-0002', -33.21, -69.21, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['SUPERADA', T(2)]]),
      cadena('14-0002', -33.22, -69.22, T(2), VALIDADA(T(2))),
      cadena('14-0003', -33.31, -69.31, T(1), [['PROPUESTA', T(1)], ['VALIDADA', T(1)], ['REVERTIDA', T(2)]]),
      cadena('14-0004', -33.41, -69.41, T(1), [['PROPUESTA', T(1)]]),
      cadena('14-0005', -33.51, -69.51, T(3), VALIDADA(T(3))),
      cadena('14-0005', -33.52, -69.52, T(3), VALIDADA(T(3))),                                                  // empate de fecha: decide el orden de la hoja
      cadena('14-0006', -33.61, -69.61, T(1), []),
      cadena('14-0007', -33.71, -69.71, T(1), [['PROPUESTA', T(1)], ['RECHAZADA', T(1)]])
    ];
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => cadenas.map((x) => x.c));
    global.ubicacionCorreccionRepository_listarEventos = jest.fn(() => [].concat(...cadenas.map((x) => x.e)));
    const porWell = {};
    S.ubicacionCorreccionService_getUbicacionesValidadas().ubicaciones.forEach((d) => { porWell[d.wellId] = d; });
    ['14-0001', '14-0002', '14-0003', '14-0004', '14-0005', '14-0006', '14-0007'].forEach((w) => {
      const vigente = S.ubicacionCorreccionService_getPorPozo('ana@x.com', w).vigente;
      if (vigente) {
        expect(porWell[w]).toBeDefined();
        expect([porWell[w].lat, porWell[w].lon]).toEqual([vigente.lat, vigente.lon]);
      } else {
        expect(porWell[w]).toBeUndefined();
      }
    });
    expect(Object.keys(porWell).sort()).toEqual(['14-0001', '14-0002', '14-0005']);
  });

  test('elegirVigente es la rutina que usa getPorPozo (una sola interpretacion)', () => {
    const derivadas = derivar([cadena('14-0001', -33.1, -69.1, T(1), VALIDADA(T(1))), cadena('14-0001', -33.2, -69.2, T(2), VALIDADA(T(2)))]);
    expect(S.ubicacionCorreccionService_elegirVigente(derivadas).lat).toBe(-33.2);
    expect(S.ubicacionCorreccionService_elegirVigente([])).toBeNull();
    expect(S.ubicacionCorreccionService_elegirVigente(null)).toBeNull();
    const fuente = fs.readFileSync(path.join(raiz, 'backend', 'src', 'UbicacionCorreccionService.js'), 'utf8');
    const porPozo = fuente.slice(fuente.indexOf('function ubicacionCorreccionService_getPorPozo'), fuente.indexOf('function ubicacionCorreccionService_getPendientes'));
    expect(porPozo).toContain('ubicacionCorreccionService_elegirVigente(delPozo)');
    expect(porPozo).not.toMatch(/estado === 'VALIDADA'/);
  });
});

// ---------------------------------------------------------------------------------------------------------------- flujo real (hojas en memoria)
describe('delta con el flujo real (propuestas, validar, revertir)', () => {
  test('sin correcciones: lista vacia', () => {
    expect(delta()).toEqual({ ubicaciones: [] });
  });

  test('propuesta pendiente: no sale; al validarla, sale con su lat/lon; vts es la hora del evento VALIDADA de la hoja de log', () => {
    const id = idDe(proponer('ana@x.com', 1));
    expect(delta().ubicaciones).toEqual([]);
    expect(validar(id).ok).toBe(true);
    const r = delta().ubicaciones;
    expect(r).toHaveLength(1);
    expect(claves(r[0])).toEqual(['lat', 'lon', 'vts', 'wellId']);
    expect(r[0].wellId).toBe('14-0001');
    const filaValidada = hojas.UbicacionCorreccionesLog.filas.slice(1).filter((f) => f[0] === id && f[2] === 'VALIDADA')[0];
    expect(new Date(r[0].vts).getTime()).toBe(new Date(filaValidada[1]).getTime());
  });

  test('validar otra del mismo pozo: la anterior pasa a SUPERADA y el delta es la nueva (un solo delta por pozo)', () => {
    const a = idDe(auto(1));
    const b = idDe(proponer('ana@x.com', 1, { lat: norte(0.0004) }));
    expect(delta().ubicaciones).toHaveLength(1);
    expect(delta().ubicaciones[0].lat).toBe(norte(0.0002 + 0.00001));
    expect(validar(b).ok).toBe(true);
    const r = delta().ubicaciones;
    expect(r).toHaveLength(1);
    expect(r[0].lat).toBe(norte(0.0004));
    expect(a).not.toBe(b);
  });

  test('revertir: el pozo deja de aparecer (vuelve a su base)', () => {
    const id = idDe(auto(1));
    expect(delta().ubicaciones).toHaveLength(1);
    expect(revertir(id).ok).toBe(true);
    expect(delta().ubicaciones).toEqual([]);
  });

  test('rechazar no genera delta ni quita el vigente', () => {
    const vigente = idDe(auto(1));
    const otra = idDe(proponer('ana@x.com', 1, { lat: norte(0.0005) }));
    expect(rechazar(otra).ok).toBe(true);
    const r = delta().ubicaciones;
    expect(r).toHaveLength(1);
    expect(vigente).toBeTruthy();
  });

  test('varios pozos: un delta por pozo, ordenados por wellId', () => {
    [3, 1, 2].forEach((i) => auto(i));
    expect(delta().ubicaciones.map((d) => d.wellId)).toEqual(['14-0001', '14-0002', '14-0003']);
  });
});

// ---------------------------------------------------------------------------------------------------------------- cache
describe('cache del delta (CacheService, 120 s)', () => {
  test('la primera llamada lee la hoja y llena el cache; la segunda usa el cache SIN leer la hoja', () => {
    auto(1);
    calmar();
    lecturas = 0;
    const a = delta();
    expect(lecturas).toBe(1);
    expect(cache.put).toHaveBeenCalledWith(KEY(), expect.any(String), expect.any(Number));
    const b = delta();
    expect(lecturas).toBe(1);
    expect(b).toEqual(a);
  });

  test('clave versionada y TTL de 120 segundos', () => {
    auto(1);
    calmar();
    delta();
    expect(KEY()).toBe('ubicaciones_validadas_v1');
    expect(S.UBICACION_VALIDADAS_CACHE_SEGUNDOS).toBe(120);
    expect(cache.ttl[KEY()]).toBe(120);
  });

  test('lo cacheado es el payload YA sanitizado: solo {ubicaciones:[{wellId, lat, lon, vts}]}', () => {
    auto(1, { observacion: 'observacion secreta que no debe quedar en el cache' });
    calmar();
    delta();
    const guardado = JSON.parse(cache.store[KEY()]);
    expect(claves(guardado)).toEqual(['ubicaciones']);
    expect(claves(guardado.ubicaciones[0])).toEqual(['lat', 'lon', 'vts', 'wellId']);
    expect(cache.store[KEY()]).not.toMatch(/Carla|@|secreta|PUNTO_EN_MAPA/);
  });

  test('validar INVALIDA: la siguiente lectura reconstruye desde la hoja e incluye lo nuevo', () => {
    const id = idDe(proponer('ana@x.com', 1));
    delta();
    expect(cache.store[KEY()]).toBeDefined();
    expect(validar(id).ok).toBe(true);
    expect(cache.remove).toHaveBeenCalledWith(KEY());
    expect(cache.store[KEY()]).toBeUndefined();
    lecturas = 0;
    expect(delta().ubicaciones).toHaveLength(1);
    expect(lecturas).toBe(1);
  });

  test('auto-validar INVALIDA', () => {
    delta();
    cache.remove.mockClear();
    expect(auto(1).ok).toBe(true);
    expect(cache.remove).toHaveBeenCalledWith(KEY());
    expect(delta().ubicaciones).toHaveLength(1);
  });

  test('el reintento que COMPLETA una auto-validacion cortada tambien invalida', () => {
    // la correccion quedo escrita sin eventos (corte entre las dos hojas): se arma a mano en la hoja y se reintenta con el mismo clientRequestId
    const d = datos(1);
    const r1 = S.ubicacionCorreccionService_proponer('carla@x.com', 'Carla Directa', pozo(1), d, { autoValidar: true });
    expect(r1.ok).toBe(true);
    hojas.UbicacionCorreccionesLog.filas.length = 1;                      // se pierden los eventos: queda INCONSISTENTE
    expect(delta().ubicaciones).toEqual([]);
    cache.remove.mockClear();
    const r2 = S.ubicacionCorreccionService_proponer('carla@x.com', 'Carla Directa', pozo(1), d, { autoValidar: true });
    expect(r2).toMatchObject({ ok: true, curada: true, autoValidada: true });
    expect(cache.remove).toHaveBeenCalledWith(KEY());
    expect(delta().ubicaciones).toHaveLength(1);
  });

  test('revertir INVALIDA', () => {
    const id = idDe(auto(1));
    delta();
    cache.remove.mockClear();
    expect(revertir(id).ok).toBe(true);
    expect(cache.remove).toHaveBeenCalledWith(KEY());
    expect(delta().ubicaciones).toEqual([]);
  });

  test('rechazar NO invalida (no cambia la vigente): ni remove ni marca, y la siguiente lectura sigue siendo del cache', () => {
    auto(1);
    const otra = idDe(proponer('ana@x.com', 1, { lat: norte(0.0005) }));
    calmar();
    delta();
    expect(cache.store[KEY()]).toBeDefined();
    cache.remove.mockClear();
    cache.put.mockClear();
    expect(rechazar(otra).ok).toBe(true);
    expect(cache.remove).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
    lecturas = 0;
    delta();
    expect(lecturas).toBe(0);
  });

  test('una propuesta normal (sin auto-validar) NO invalida; tampoco un reenvio idempotente', () => {
    auto(1);
    delta();
    cache.remove.mockClear();
    cache.put.mockClear();
    const d = datos(2);
    expect(S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana Pérez', pozo(2), d).ok).toBe(true);
    expect(S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana Pérez', pozo(2), d).duplicada).toBe(true);
    expect(cache.remove).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  test('operaciones que fallan (transicion invalida, motivo faltante) no invalidan: no escribieron nada', () => {
    const id = idDe(auto(1));
    delta();
    cache.remove.mockClear();
    expect(validar(id).ok).toBe(false);                                                         // ya esta VALIDADA: INVALID_TRANSITION
    expect(revertir(id).ok).toBe(true);                                                          // este si cambia
    cache.remove.mockClear();
    expect(S.ubicacionCorreccionService_revertir('val@x.com', 'V', id, '').ok).toBe(false);      // sin motivo / ya revertida
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('la invalidacion ocurre DESPUES de la escritura confirmada: al invalidar, la hoja ya contiene el evento', () => {
    const id = idDe(proponer('ana@x.com', 1));
    let eventosAlInvalidar = null;
    cache.remove.mockImplementation((k) => { if (k === KEY()) { eventosAlInvalidar = hojas.UbicacionCorreccionesLog.filas.slice(1).filter((f) => f[0] === id).map((f) => f[2]); } });
    validar(id);
    expect(eventosAlInvalidar).toEqual(['PROPUESTA', 'VALIDADA']);
  });

  test('si CacheService FALLA (get, put o remove), la operacion principal NO se rompe y el delta sale igual (de la hoja)', () => {
    cache.falla.get = true;
    cache.falla.put = true;
    cache.falla.remove = true;
    const id = idDe(proponer('ana@x.com', 1));
    const v = validar(id);
    expect(v.ok).toBe(true);
    expect(auto(2).ok).toBe(true);
    expect(delta().ubicaciones.map((d) => d.wellId)).toEqual(['14-0001', '14-0002']);
    expect(global.Logger.log).toHaveBeenCalled();
  });

  test('si CacheService.getScriptCache LANZA: se sigue sin cache (delta correcto, validar ok)', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('servicio caido'); } };
    const id = idDe(proponer('ana@x.com', 1));
    expect(validar(id).ok).toBe(true);
    expect(delta().ubicaciones).toHaveLength(1);
    expect(S.ubicacionCorreccionService_invalidarUbicacionesValidadas()).toBe(false);
  });

  test('un valor corrupto en el cache se descarta y se recalcula (sin romper)', () => {
    auto(1);
    calmar();
    cache.store[KEY()] = '{no es json';
    expect(delta().ubicaciones).toHaveLength(1);
    cache.store[KEY()] = JSON.stringify({ otra: 'cosa' });
    expect(delta().ubicaciones).toHaveLength(1);
    expect(JSON.parse(cache.store[KEY()]).ubicaciones).toHaveLength(1);
  });

  test('payload de mas de 90.000 caracteres: NO se cachea (limite de 100 KB de CacheService) pero se devuelve completo', () => {
    const muchas = [];
    for (let i = 0; i < 1500; i += 1) {
      const w = String(1 + (i % 19)).padStart(2, '0') + '-' + String(i + 1).padStart(4, '0');
      muchas.push(cadena(w, -33.3 - i * 1e-6, -69.1, '2026-10-01T10:00:00.000Z', VALIDADA('2026-10-02T10:00:00.000Z')));
    }
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => muchas.map((x) => x.c));
    global.ubicacionCorreccionRepository_listarEventos = jest.fn(() => [].concat(...muchas.map((x) => x.e)));
    const r = delta();
    expect(r.ubicaciones).toHaveLength(1500);
    expect(JSON.stringify(r).length).toBeGreaterThan(90000);
    expect(cache.put).not.toHaveBeenCalledWith(KEY(), expect.anything(), expect.anything());
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).toMatch(/supera el limite/);
  });

  test('un payload de tamano normal SI se cachea (el limite no deja el cache apagado)', () => {
    auto(1);
    calmar();
    delta();
    expect(cache.store[KEY()]).toBeDefined();
    expect(cache.store[KEY()].length).toBeLessThan(90000);
  });
});

describe('carrera lector / escritor', () => {
  test('si se invalida MIENTRAS un lector calcula, el lector NO guarda su resultado (posiblemente viejo) en el cache', () => {
    auto(1);
    const original = global.ubicacionCorreccionRepository_listarCorrecciones;
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => {
      const viejo = original();
      S.ubicacionCorreccionService_invalidarUbicacionesValidadas();         // un escritor valida y invalida justo despues de que el lector leyo
      return viejo;
    });
    cache.put.mockClear();
    const r = delta();
    expect(r.ubicaciones).toHaveLength(1);
    expect(cache.put).not.toHaveBeenCalledWith(KEY(), expect.anything(), expect.anything());
    expect(cache.store[KEY()]).toBeUndefined();
  });

  test('despues del margen, la siguiente lectura reconstruye y vuelve a cachear', () => {
    auto(1);
    const original = global.ubicacionCorreccionRepository_listarCorrecciones;
    S.ubicacionCorreccionService_invalidarUbicacionesValidadas();
    global.ubicacionCorreccionRepository_listarCorrecciones = original;
    delta();
    expect(cache.store[KEY()]).toBeUndefined();            // dentro del margen: se calcula pero no se guarda
    calmar();
    delta();
    expect(cache.store[KEY()]).toBeDefined();
  });

  test('un lector que empieza en el mismo instante de la invalidacion tampoco cachea (margen conservador por relojes)', () => {
    auto(1);
    cache.remove(KEY());
    S.ubicacionCorreccionService_invalidarUbicacionesValidadas();
    cache.put.mockClear();
    delta();
    expect(cache.put).not.toHaveBeenCalledWith(KEY(), expect.anything(), expect.anything());
  });
});

// ---------------------------------------------------------------------------------------------------------------- permisos y contrato (Api + js/api.js reales)
describe('endpoint getUbicacionesValidadas: permisos y contrato frontend/backend', () => {
  const llamar = (usuario) => ctxFrontend.apiGetUbicacionesValidadas(usuario === null ? 'tok-fantasma@x.com' : 'tok-' + usuario);

  test('cliente: apiGetUbicacionesValidadas manda action + sessionToken y NADA mas', () => {
    const llamadas = [];
    const ctx = vm.createContext({ JSON, Object, fetch: (u, o) => { llamadas.push(JSON.parse(o.body)); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); } });
    vm.runInContext(apiFrontend, ctx);
    ctx.apiGetUbicacionesValidadas('tok-x');
    expect(llamadas).toEqual([{ action: 'getUbicacionesValidadas', sessionToken: 'tok-x' }]);
  });

  test.each([['ana@x.com'], ['carla@x.com'], ['val@x.com'], ['nada@x.com']])('CUALQUIER usuario activo puede llamarlo (%s), tenga o no ubicacion / ubicacion_corregir / ubicacion_validar', async (u) => {
    auto(1);
    const r = await llamar(u);
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['ubicaciones']);
    expect(r.data.ubicaciones).toHaveLength(1);
  });

  test('sin permiso de modulo alguno (nada@x.com) recibe el mismo contenido que un validador', async () => {
    auto(1);
    auto(2);
    expect(await llamar('nada@x.com')).toEqual(await llamar('val@x.com'));
  });

  test('sesion invalida -> UNAUTHORIZED; usuario inactivo -> USER_DISABLED; ninguno consulta las hojas', async () => {
    auto(1);
    lecturas = 0;
    expect(await llamar(null)).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    global.verifySessionToken.mockImplementation(() => ({ valid: true, email: 'inactivo@x.com' }));
    global.isUserActive.mockImplementation(() => false);
    expect(await ctxFrontend.apiGetUbicacionesValidadas('tok-inactivo@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
    expect(lecturas).toBe(0);
    expect(cache.get).not.toHaveBeenCalledWith(KEY());
  });

  test('sin sessionToken -> UNAUTHORIZED', async () => {
    expect(await ctxFrontend.apiGetUbicacionesValidadas(undefined)).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(await ctxFrontend.apiGetUbicacionesValidadas('')).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
  });

  test('si el servicio falla: SERVICE_UNAVAILABLE (el cliente cae a la base); no se cachea el error', async () => {
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { throw new Error('Sheets caido'); });
    expect(await llamar('nada@x.com')).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(cache.store[KEY()]).toBeUndefined();
  });

  test('CONTRATO: {ubicaciones:[{wellId, lat, lon, vts}]} con tipos exactos y vts ISO', async () => {
    auto(1);
    auto(2);
    const r = await llamar('nada@x.com');
    expect(r.data.ubicaciones).toHaveLength(2);
    r.data.ubicaciones.forEach((d) => {
      expect(claves(d)).toEqual(['lat', 'lon', 'vts', 'wellId']);
      expect(d.wellId).toMatch(/^\d{2}-\d{4}$/);
      expect(typeof d.lat).toBe('number');
      expect(typeof d.lon).toBe('number');
      expect(d.vts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  test('SEGURIDAD: la respuesta completa no trae emails, nombres, observaciones, metodo, motivos, ids ni la coordenada original ingresada', async () => {
    auto(1, { observacion: 'Observacion privada del agente', metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } }, lat: -33.3476500, lon: -69.1454500 });
    const crudo = JSON.stringify(await llamar('nada@x.com'));
    expect(crudo).not.toMatch(/@|Carla|Ana|Valeria|privada|COORDENADAS|GMS|GPS_ACTUAL|PUNTO_EN_MAPA|motivo|Validada automaticamente|EPSG|[0-9a-f]{8}-[0-9a-f]{4}-4|irr|distancia|padron|clientRequestId|correccionId/i);
  });

  test('el endpoint devuelve la MISMA ubicacion que getCorreccionesUbicacionPozo expone como vigente, sin sumar nada que ese endpoint no daria', async () => {
    auto(1);
    const delPozo = (await ctxFrontend.apiGetCorreccionesUbicacionPozo('tok-val@x.com', '14-0001')).data.vigente;
    const d = (await llamar('nada@x.com')).data.ubicaciones[0];
    expect([d.lat, d.lon]).toEqual([delPozo.lat, delPozo.lon]);
    expect(d.vts).toBe(delPozo.resolucion.timestamp);
  });

  test('la accion esta ruteada en doPost y su UNICO consumidor es mapaDataset_obtener (el mapa, Cerca Mio, seleccion y reemplazos la heredan de ahi)', () => {
    const fuenteApi = fs.readFileSync(path.join(raiz, 'backend', 'src', 'Api.js'), 'utf8');
    expect(fuenteApi).toContain("body.action === 'getUbicacionesValidadas'");
    expect(fs.readFileSync(path.join(raiz, 'js', 'mapaDataset.js'), 'utf8')).toMatch(/apiGetUbicacionesValidadas\(sessionToken\)/);
    ['js/mapa.js', 'js/cercaMio.js', 'js/seleccion.js', 'js/buscarReemplazo.js', 'js/app.js', 'js/ubicacionCorreccion.js', 'js/ubicacionValidacion.js'].forEach((f) => {
      expect(fs.readFileSync(path.join(raiz, f), 'utf8')).not.toMatch(/getUbicacionesValidadas|apiGetUbicacionesValidadas|ubicacionOperativaLogic/);
    });
  });

  test('COMPATIBILIDAD con el modulo puro del punto operativo: el overlay acepta el payload tal cual, sin descartar nada', async () => {
    auto(1);
    auto(2);
    const r = await llamar('nada@x.com');
    const base = [{ wellId: '14-0001', lat: OFICIAL.lat, lon: OFICIAL.lon, estado: 'D', cuenca: 'X', profundidad: 10, tramosFiltrantes: [], surgencia: null }];
    const out = OperativaLogic.ubicacionOperativaLogic_aplicarOverlay(base, r.data.ubicaciones);
    expect(out.resumen).toMatchObject({ recibidas: 2, aplicadas: 2, nuevos: 1, descartadas: [] });
    expect(out.pozos[0].estado).toBe('V');
    expect(out.pozos[0].base).toEqual({ lat: OFICIAL.lat, lon: OFICIAL.lon, estado: 'D' });
    expect(out.pozos[1].wellId).toBe('14-0002');
  });
});
