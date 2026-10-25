// CONTRATO del cargador de la Linea de tiempo (E6-2) <-> backend REAL de hoy: los wrappers reales de js/api.js (ejecutados de verdad) hablan con Api.doPost -> permisos -> servicios ->
// repositorios sobre hojas en memoria, y el cargador (js/lineaTiempoPozoLoader.js) los consume con el modelo real (js/lineaTiempoPozoLogic.js). Cubre la paginacion real por cursor
// (limit 100), el tope de 500, WELL_NOT_FOUND real de decisiones, los permisos que decide el backend, los errores de sesion reales y la caida de una hoja. No modifica el backend.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const T = require('../backend/test/decisionesFuentesHelper');
const { instalarSheetsFalsos } = require('../backend/test/fakeSheets');
const L = require('./lineaTiempoPozoLogic');
const M = require('./lineaTiempoPozoLoader');

const W = '14-0001';
const FUERA = '14-0999';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const TODOS = { ubicacion: true, reemplazo: true, observaciones: true };

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana Corrige', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'todo@x.com': { nombre: 'Todo Poderoso', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true, reemplazo: true, observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'val@x.com': { nombre: 'Valeria Validadora', permisos: { ubicacion: true, ubicacion_validar: true } },
  'marta@x.com': { nombre: 'Marta Evalua', permisos: { reemplazo: true } },
  'mod@x.com': { nombre: 'Moderadora Obs', permisos: { observaciones: true, observaciones_anular: true } },
  'lector@x.com': { nombre: 'Lector Total', permisos: { ubicacion: true, reemplazo: true, observaciones: true } },
  'soloobs@x.com': { nombre: 'Solo Observaciones', permisos: { observaciones: true } },
  'nada@x.com': { nombre: 'Sin Permisos', permisos: {} },
  'baja@x.com': { nombre: 'Usuario de Baja', permisos: { ubicacion: true, reemplazo: true, observaciones: true }, inactivo: true }
};
const EMAILS = Object.keys(USUARIOS);

let ctx;
let hojas;
let filasReemplazo;
let api;
let pedidos;
let alPedir;
let n = 0;
let ObsRepo;
const nuevoRid = (p) => p + '-' + String(++n).padStart(8, '0');
const post = (cuerpo) => JSON.parse(ctx.Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).text);
const uuid = (i) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');

beforeEach(() => {
  n = 0;
  pedidos = [];
  alPedir = null;
  ctx = T.armar();
  const CorrRepo = require('../backend/src/UbicacionCorreccionRepository');
  ObsRepo = require('../backend/src/ObservacionesPozoRepository');
  const ObsSvc = require('../backend/src/ObservacionesPozoService');
  const PozoEx = require('../backend/src/PozoExistenciaService');
  const ReSvc = require('../backend/src/ReemplazoService');
  const ReRepo = require('../backend/src/ReemplazoRepository');
  Object.assign(global, CorrRepo, ObsRepo, ObsSvc, PozoEx, ReSvc, ReRepo);
  hojas = instalarSheetsFalsos({
    UbicacionCorrecciones: [CorrRepo.UBICACION_CORRECCIONES_COLUMNAS],
    UbicacionCorreccionesLog: [CorrRepo.UBICACION_CORRECCIONES_LOG_COLUMNAS],
    UbicacionFuenteDecisiones: [ctx.Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS],
    ObservacionesPozo: [ObsRepo.OBSERVACIONES_POZO_COLUMNAS]
  });
  ctx.hojas = hojas;
  global.registryService_getWellLocation = jest.fn((id) => (ctx.padron[id] ? { found: true, location: { wellId: id, ...JSON.parse(JSON.stringify(ctx.padron[id])), ubicacionResuelta: OFICIAL } } : { found: false }));
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[String(t).slice(4)] ? { valid: true, email: String(t).slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e] && USUARIOS[e].inactivo !== true, nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true && USUARIOS[e].permisos[m] === true);
  filasReemplazo = [];
  const indices = ReRepo.reemplazoRepository_indiceColumnas(ReRepo.REEMPLAZO_COLUMNAS);
  global.reemplazoRepository_listarPorWellId = (w) => filasReemplazo.map((f) => ReRepo.reemplazoRepository_evaluacionDesdeFila(f, indices)).filter((e) => e.wellId === w);
  global.reemplazoRepository_agregar = (ev) => { filasReemplazo.push(ReRepo.reemplazoRepository_filaDesdeEvaluacion(ev, indices, ReRepo.REEMPLAZO_COLUMNAS.length)); };

  // el js/api.js REAL, con un fetch que entra por Api.doPost (cada pedido queda registrado)
  const contexto = vm.createContext({
    JSON, Object,
    fetch: (url, opciones) => {
      const cuerpo = JSON.parse(opciones.body);
      pedidos.push(cuerpo);
      if (alPedir) { alPedir(cuerpo); }
      return Promise.resolve({ json: () => Promise.resolve(JSON.parse(ctx.Api.doPost({ postData: { contents: opciones.body } }).text)) });
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'api.js'), 'utf8'), contexto);
  api = {
    correcciones: contexto.apiGetCorreccionesUbicacionPozo,
    decisiones: contexto.apiGetDecisionesFuentesPozo,
    reemplazo: contexto.apiGetHistorialReemplazo,
    observaciones: contexto.apiGetObservacionesPozo
  };
});

afterEach(() => { jest.restoreAllMocks(); });

const cargar = (usuario, permisos, pozo) => M.lineaTiempoPozoLoader_crear({ api, logica: L }).cargar('tok-' + usuario, pozo || W, permisos || TODOS);
const accion = (nombre) => pedidos.filter((p) => p.action === nombre);

// observaciones sembradas directamente en la hoja (secuencia 1..cantidad, una ALTA cada una)
function sembrarObservaciones(cantidad, extra) {
  const cols = ObsRepo.OBSERVACIONES_POZO_COLUMNAS;
  const fila = (o) => cols.map((c) => (o[c] === undefined ? '' : o[c]));
  for (let i = 1; i <= cantidad; i += 1) {
    hojas.ObservacionesPozo.filas.push(fila({ observacionId: uuid(i), evento: 'ALTA', wellId: W, texto: 'Observacion sembrada ' + i, email: 'ana@x.com', nombre: 'Ana', timestampUtc: '2026-10-20T15:00:00.000Z', secuencia: i, clientRequestId: 'seed-' + String(i).padStart(8, '0') }));
  }
  (extra || []).forEach((o) => hojas.ObservacionesPozo.filas.push(fila(o)));
}
const anulacion = (secuencia, deObservacion, extra) => Object.assign({ observacionId: uuid(deObservacion), evento: 'ANULADA', wellId: W, motivo: 'Cargada por error', email: 'mod@x.com', nombre: 'Moderadora Obs', timestampUtc: '2026-10-22T10:00:00.000Z', secuencia, clientRequestId: 'seedanu-' + String(secuencia).padStart(8, '0') }, extra || {});

function poblar() {
  const propuesta = (usuario, lat, obs) => post({ action: 'proponerCorreccionUbicacion', sessionToken: 'tok-' + usuario, wellId: W, lat: OFICIAL.lat + lat, lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: obs || 'Se midio con el celular', clientRequestId: nuevoRid('corr') });
  propuesta('todo@x.com', 0.0002);
  propuesta('ana@x.com', 0.0003, 'Pendiente de revisar');
  ctx.S.ubicacionFuenteDecisionesService_decidir('val@x.com', 'Valeria Validadora', T.solicitud({ accion: 'ACEPTAR', versionVista: 0 }));
  post({ action: 'registrarEvaluacionReemplazo', sessionToken: 'tok-marta@x.com', wellId: W, estado: 'APTO', motivo: 'APTO_SIN_OBSERVACIONES', observacion: '' });
  const a = post({ action: 'agregarObservacionPozo', sessionToken: 'tok-todo@x.com', wellId: W, texto: 'Acceso por camino de tierra', clientRequestId: nuevoRid('obs') });
  const b = post({ action: 'agregarObservacionPozo', sessionToken: 'tok-todo@x.com', wellId: W, texto: 'TEXTO-QUE-SOLO-VE-EL-MODERADOR', clientRequestId: nuevoRid('obs') });
  post({ action: 'anularObservacionPozo', sessionToken: 'tok-mod@x.com', observacionId: b.data.observacion.observacionId, motivo: 'Pozo equivocado', clientRequestId: nuevoRid('anu') });
  return { a, b };
}

describe('carga real con los wrappers reales de api.js', () => {
  test('las tres fuentes reales, con todos los permisos: todo OK, completa, ordenada y con los 4 pedidos iniciales', async () => {
    poblar();
    const r = await cargar('lector@x.com');
    expect(r.auth).toBeNull();
    expect(Object.keys(r.fuentes).map((k) => r.fuentes[k].estado)).toEqual(['OK', 'OK', 'OK']);
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
    expect(r.puedeVer).toBe(true);
    expect(r.fuentes.ubicacion.cantidadEventos).toBe(2 + 2 + 0 + 1 - 1 + 1 - 1 + 0);                          // 2 propuestas + 1 validacion (autovalidada) + 1 decision = 4
    expect(r.fuentes.reemplazo.cantidadEventos).toBe(1);
    expect(r.fuentes.observaciones.cantidadEventos).toBe(3);                                                  // 2 altas + 1 anulacion
    const ts = r.eventos.map((e) => e.timestamp);
    expect(ts).toEqual(ts.slice().sort().reverse());
    expect(accion('getCorreccionesUbicacionPozo').length).toBe(1);
    expect(accion('getDecisionesFuentesPozo').length).toBe(1);
    expect(accion('getHistorialReemplazo').length).toBe(1);
    expect(accion('getObservacionesPozo').length).toBe(1);
    expect(accion('getObservacionesPozo')[0].limit).toBe(100);
    expect(accion('getObservacionesPozo')[0].antesDeSecuencia).toBeUndefined();
  });

  test('nada sensible sale: ni emails, ni tokens, ni ids de pedido, ni el texto de la anulada (aunque lo reciba un moderador)', async () => {
    poblar();
    for (const usuario of ['lector@x.com', 'todo@x.com']) {
      const salida = JSON.stringify(await cargar(usuario));
      EMAILS.forEach((e) => expect(salida).not.toContain(e));
      ['tok-', 'clientRequestId', 'req-0', 'TEXTO-QUE-SOLO-VE-EL-MODERADOR', 'secuencia'].forEach((s) => expect(salida).not.toContain(s));
    }
  });

  test('la linea de tiempo de un moderador y de un lector (observaciones_anular) es la misma', async () => {
    poblar();
    const a = await M.lineaTiempoPozoLoader_crear({ api, logica: L }).cargar('tok-mod@x.com', W, { observaciones: true });
    const b = await M.lineaTiempoPozoLoader_crear({ api, logica: L }).cargar('tok-soloobs@x.com', W, { observaciones: true });
    expect(a.eventos).toEqual(b.eventos);
    expect(a.eventos.length).toBe(3);
  });
});

describe('paginacion real de Observaciones', () => {
  test('230 observaciones + anulaciones de las mas viejas: 3 paginas (100, 100, 30), todo cargado y la anulacion de una antigua incluida', async () => {
    sembrarObservaciones(230, [anulacion(231, 1), anulacion(232, 2)]);
    const r = await cargar('soloobs@x.com', { observaciones: true });
    const llamadas = accion('getObservacionesPozo');
    expect(llamadas.length).toBe(3);
    expect(llamadas.map((p) => p.limit)).toEqual([100, 100, 100]);
    expect(llamadas[0].antesDeSecuencia).toBeUndefined();
    expect(llamadas[1].antesDeSecuencia).toBeGreaterThan(llamadas[2].antesDeSecuencia);                       // los cursores bajan
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', paginas: 3, cargadas: 230, cantidadEventos: 232, motivoParcial: null });
    const anuladas = r.eventos.filter((e) => e.tipo === 'OBSERVACION_ANULADA');
    expect(anuladas.length).toBe(2);                                                                          // las anulaciones de las observaciones 1 y 2 (en la ultima pagina)
    expect(r.eventos.find((e) => e.id === 'OBSERVACION:' + uuid(1) + ':ALTA')).toMatchObject({ estado: 'ANULADA', detalle: null });
    expect(r.completa).toBe(true);
    expect(new Set(r.eventos.map((e) => e.id)).size).toBe(r.eventos.length);
  });

  test('exactamente 500 observaciones reales: 5 paginas, OK y completa', async () => {
    sembrarObservaciones(500);
    const r = await cargar('soloobs@x.com', { observaciones: true });
    expect(accion('getObservacionesPozo').length).toBe(5);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', paginas: 5, cargadas: 500, cantidadEventos: 500 });
    expect(r.completa).toBe(true);
  });

  test('620 observaciones reales: se corta en 500 con PARCIAL LIMIT_REACHED, sin pedir una 6ta pagina', async () => {
    sembrarObservaciones(620);
    const r = await cargar('soloobs@x.com', { observaciones: true });
    expect(accion('getObservacionesPozo').length).toBe(5);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'LIMIT_REACHED', paginas: 5, cargadas: 500, cantidadEventos: 500 });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
    // se cargaron las 500 MAS RECIENTES
    expect(r.eventos.some((e) => e.id === 'OBSERVACION:' + uuid(620) + ':ALTA')).toBe(true);
    expect(r.eventos.some((e) => e.id === 'OBSERVACION:' + uuid(120) + ':ALTA')).toBe(false);
  });

  test('un cambio concurrente entre paginas (se anula una observacion todavia no leida): sin duplicados y la anulada llega ANULADA', async () => {
    sembrarObservaciones(150);
    alPedir = (cuerpo) => {
      if (cuerpo.action === 'getObservacionesPozo' && cuerpo.antesDeSecuencia !== undefined && !alPedir.hecho) {
        alPedir.hecho = true;
        hojas.ObservacionesPozo.filas.push(ObsRepo.OBSERVACIONES_POZO_COLUMNAS.map((c) => anulacion(151, 10)[c] === undefined ? '' : anulacion(151, 10)[c]));
      }
    };
    const r = await cargar('soloobs@x.com', { observaciones: true });
    expect(accion('getObservacionesPozo').length).toBe(2);
    expect(r.eventos.find((e) => e.id === 'OBSERVACION:' + uuid(10) + ':ALTA')).toMatchObject({ estado: 'ANULADA', detalle: null });
    expect(new Set(r.eventos.map((e) => e.id)).size).toBe(r.eventos.length);
  });

  test('una hoja de observaciones sin datos: VACIA', async () => {
    const r = await cargar('soloobs@x.com', { observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'VACIA', paginas: 1, cargadas: 0 });
  });
});

describe('Ubicacion real: WELL_NOT_FOUND y subfuentes', () => {
  test('un pozo FUERA del padron: decisiones responde WELL_NOT_FOUND real y la fuente queda VACIA y completa, sin fallo', async () => {
    const r = await cargar('lector@x.com', { ubicacion: true }, FUERA);
    expect(accion('getDecisionesFuentesPozo')[0].wellId).toBe(FUERA);
    expect(r.fuentes.ubicacion.estado).toBe('VACIA');
    expect(r.fuentes.ubicacion.partes.decisiones.estado).toBe('VACIA');
    expect(r.fuentes.ubicacion.partes.correcciones.estado).toBe('VACIA');
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
  });

  test('un pozo fuera del padron CON una correccion propuesta: OK con ese evento (las decisiones inexistentes no molestan)', async () => {
    global.driveProfileRepository_existe = jest.fn((id) => id === FUERA);                                      // el pozo existe solo por su ITF (caso 14-0123)
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
    const p = post({ action: 'proponerCorreccionUbicacion', sessionToken: 'tok-ana@x.com', wellId: FUERA, lat: OFICIAL.lat, lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'Pozo conocido por el ITF', clientRequestId: nuevoRid('corr') });
    expect(p.status).toBe('ok');
    const r = await cargar('lector@x.com', { ubicacion: true }, FUERA);
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'OK', cantidadEventos: 1 });
    expect(r.completa).toBe(true);
  });

  test('la hoja de decisiones desaparece: PARCIAL SUBFUENTE_DECISIONES conservando las correcciones', async () => {
    poblar();
    delete hojas.UbicacionFuenteDecisiones;
    ctx.cache.store = {};
    const r = await cargar('lector@x.com', { ubicacion: true });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'SUBFUENTE_DECISIONES', codigoError: 'SERVICE_UNAVAILABLE' });
    expect(r.fuentes.ubicacion.cantidadEventos).toBe(3);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
  });
});

describe('permisos reales (el backend manda)', () => {
  test('el frontend cree que puede todo pero el backend solo autoriza observaciones: lo demas queda SIN_PERMISO, no es un fallo, y la carga es completa', async () => {
    poblar();
    const r = await cargar('soloobs@x.com', TODOS);
    expect(r.fuentes.ubicacion.estado).toBe('SIN_PERMISO');
    expect(r.fuentes.reemplazo.estado).toBe('SIN_PERMISO');
    expect(r.fuentes.observaciones.estado).toBe('OK');
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
    expect(r.eventos.every((e) => e.fuente === 'OBSERVACIONES')).toBe(true);
  });

  test('sin ningun permiso en el backend: todo SIN_PERMISO, completa=false, parcial=false, sin eventos', async () => {
    poblar();
    const r = await cargar('nada@x.com', TODOS);
    expect(Object.keys(r.fuentes).map((k) => r.fuentes[k].estado)).toEqual(['SIN_PERMISO', 'SIN_PERMISO', 'SIN_PERMISO']);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
    expect(r.eventos).toEqual([]);
    expect(r.auth).toBeNull();
  });

  test('sin permisos en el frontend ni un solo pedido sale', async () => {
    poblar();
    pedidos.length = 0;
    const r = await cargar('lector@x.com', {});
    expect(pedidos).toEqual([]);
    expect(r.puedeVer).toBe(false);
  });
});

describe('errores de sesion reales', () => {
  test('token invalido: UNAUTHORIZED real, senal global y sin eventos (no es ERROR de fuente)', async () => {
    poblar();
    const r = await M.lineaTiempoPozoLoader_crear({ api, logica: L }).cargar('token-roto', W, TODOS);
    expect(r.auth).toBe('UNAUTHORIZED');
    expect(r.eventos).toEqual([]);
    expect(Object.keys(r.fuentes).map((k) => r.fuentes[k].estado)).not.toContain('ERROR');
  });

  test('usuario dado de baja: USER_DISABLED real', async () => {
    poblar();
    const r = await cargar('baja@x.com');
    expect(r.auth).toBe('USER_DISABLED');
    expect(r.eventos).toEqual([]);
  });
});

describe('fallos reales de una fuente', () => {
  test('la hoja de observaciones desaparece: ERROR SERVICE_UNAVAILABLE en esa fuente, parcial, y las demas siguen', async () => {
    poblar();
    delete hojas.ObservacionesPozo;
    const r = await cargar('lector@x.com');
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'ERROR', codigoError: 'SERVICE_UNAVAILABLE', cantidadEventos: 0 });
    expect(r.fuentes.ubicacion.estado).toBe('OK');
    expect(r.fuentes.reemplazo.estado).toBe('OK');
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
    expect(r.eventos.length).toBe(5);
    expect(JSON.stringify(r)).not.toMatch(/No existe una hoja|spreadsheet/i);                                  // el mensaje tecnico del backend no sale
  });

  test('wellId desconocido para el backend en reemplazo / observaciones (pozo sin datos): VACIA, no error', async () => {
    const r = await cargar('lector@x.com', { reemplazo: true, observaciones: true }, FUERA);
    expect(r.fuentes.reemplazo.estado).toBe('VACIA');
    expect(r.fuentes.observaciones.estado).toBe('VACIA');
    expect(r.completa).toBe(true);
  });
});
