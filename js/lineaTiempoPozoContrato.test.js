// CONTRATO Linea de tiempo (E6-1) <-> backend REAL de hoy. El modelo puro (js/lineaTiempoPozoLogic.js) se alimenta con los payloads que devuelven los endpoints de verdad (Api.doPost ->
// permisos -> servicios -> repositorios sobre hojas en memoria), generados con flujos reales (proponer / validar / revertir / rechazar, decisiones sobre fuentes, evaluaciones de reemplazo,
// observaciones con alta y anulacion). Fija ademas las CLAVES exactas de cada payload: si el backend agrega o cambia un campo (un email, una secuencia, una fecha de alta de las fotos...)
// este archivo falla y obliga a revisar el modelo. No modifica nada del backend: es solo un test.
const T = require('../backend/test/decisionesFuentesHelper');
const { instalarSheetsFalsos } = require('../backend/test/fakeSheets');
const L = require('./lineaTiempoPozoLogic');

const W = '14-0001';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const norte = (grados) => OFICIAL.lat + grados;

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana Corrige', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'todo@x.com': { nombre: 'Todo Poderoso', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true, reemplazo: true, observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'val@x.com': { nombre: 'Valeria Validadora', permisos: { ubicacion: true, ubicacion_validar: true } },
  'marta@x.com': { nombre: 'Marta Evalua', permisos: { reemplazo: true } },
  'beto@x.com': { nombre: 'Beto Observa', permisos: { observaciones: true, observaciones_agregar: true } },
  'mod@x.com': { nombre: 'Moderadora Obs', permisos: { observaciones: true, observaciones_anular: true } },
  'lector@x.com': { nombre: 'Lector Total', permisos: { ubicacion: true, reemplazo: true, observaciones: true } },
  'soloobs@x.com': { nombre: 'Solo Observaciones', permisos: { observaciones: true } },
  'nada@x.com': { nombre: 'Sin Permisos', permisos: {} }
};
const EMAILS = Object.keys(USUARIOS);

let ctx;
let hojas;
let filasReemplazo;
let n = 0;
const nuevoRid = (p) => p + '-' + String(++n).padStart(8, '0');
const post = (cuerpo) => JSON.parse(ctx.Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).text);
const leer = (accion, usuario, extra) => post(Object.assign({ action: accion, sessionToken: 'tok-' + usuario, wellId: W }, extra || {}));
const claves = (o) => Object.keys(o).sort();

beforeEach(() => {
  n = 0;
  ctx = T.armar();
  const CorrRepo = require('../backend/src/UbicacionCorreccionRepository');
  const ObsRepo = require('../backend/src/ObservacionesPozoRepository');
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
  // el padron falso de la ayuda (coordenadas de las fuentes) mas la ubicacion de Irrigacion que usan las correcciones
  global.registryService_getWellLocation = jest.fn((id) => (ctx.padron[id] ? { found: true, location: { wellId: id, ...JSON.parse(JSON.stringify(ctx.padron[id])), ubicacionResuelta: OFICIAL } } : { found: false }));
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[String(t).slice(4)] ? { valid: true, email: String(t).slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);
  // Reemplazo: el servicio y las funciones puras del repositorio son los REALES; solo la hoja es una lista en memoria (el acceso a Sheets de ese repositorio no se exporta)
  filasReemplazo = [];
  const indices = ReRepo.reemplazoRepository_indiceColumnas(ReRepo.REEMPLAZO_COLUMNAS);
  global.reemplazoRepository_listarPorWellId = (w) => filasReemplazo.map((f) => ReRepo.reemplazoRepository_evaluacionDesdeFila(f, indices)).filter((e) => e.wellId === w);
  global.reemplazoRepository_agregar = (ev) => { filasReemplazo.push(ReRepo.reemplazoRepository_filaDesdeEvaluacion(ev, indices, ReRepo.REEMPLAZO_COLUMNAS.length)); };
});

afterEach(() => { jest.restoreAllMocks(); });

// --- flujos reales ---
const proponer = (usuario, extra) => post(Object.assign({
  action: 'proponerCorreccionUbicacion', sessionToken: 'tok-' + usuario, wellId: W, lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'Se midio con el celular', clientRequestId: nuevoRid('corr')
}, extra || {}));
const resolver = (accion, usuario, correccionId, motivo) => post({ action: accion, sessionToken: 'tok-' + usuario, correccionId, motivo });
const idDe = (r) => r.data.correccion.correccionId;

// Una historia completa de ubicacion: C1 validada por Val y luego revertida, C2 y C3 autovalidadas y superadas, C4 rechazada, C5 autovalidada (vigente) y C6 pendiente.
function historiaDeUbicacion() {
  const c1 = idDe(proponer('ana@x.com', { lat: norte(0.0001), observacion: 'Primera propuesta de Ana' }));
  const c2 = idDe(proponer('todo@x.com', { lat: norte(0.0002) }));
  const c3 = idDe(proponer('todo@x.com', { lat: norte(0.0003) }));
  expect(resolver('validarCorreccionUbicacion', 'val@x.com', c1).status).toBe('ok');                            // supera a C3 (la vigente)
  expect(resolver('revertirCorreccionUbicacion', 'val@x.com', c1, 'Se verifico y no era la ubicacion').status).toBe('ok');
  const c4 = idDe(proponer('ana@x.com', { lat: norte(0.0004), observacion: 'Segunda propuesta de Ana' }));
  expect(resolver('rechazarCorreccionUbicacion', 'val@x.com', c4, 'Fuera de lugar').status).toBe('ok');
  const c5 = idDe(proponer('todo@x.com', { lat: norte(0.0005) }));
  const c6 = idDe(proponer('ana@x.com', { lat: norte(0.0006), observacion: 'Pendiente de revisar' }));
  return { c1, c2, c3, c4, c5, c6 };
}

describe('Ubicacion: correcciones (flujo real)', () => {
  test('todos los estados reales producen eventos validos; las VALIDADAS superadas/revertidas no se fabrican', () => {
    const ids = historiaDeUbicacion();
    const respuesta = leer('getCorreccionesUbicacionPozo', 'lector@x.com');
    expect(respuesta.status).toBe('ok');
    const estados = {};
    respuesta.data.historial.forEach((c) => { estados[c.correccionId] = c.estado; });
    expect(estados).toEqual({ [ids.c1]: 'REVERTIDA', [ids.c2]: 'SUPERADA', [ids.c3]: 'SUPERADA', [ids.c4]: 'RECHAZADA', [ids.c5]: 'VALIDADA', [ids.c6]: 'PROPUESTA' });

    const r = L.lineaTiempoPozoLogic_normalizarCorrecciones(respuesta.data, W);
    expect(r.ok).toBe(true);
    expect(r.omitidos).toEqual([]);
    expect(r.eventos.length).toBe(11);                                                                        // 6 propuestas + 5 eventos terminales (la pendiente no tiene)
    r.eventos.forEach((e) => expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(true));
    const porTipo = {};
    r.eventos.forEach((e) => { porTipo[e.tipo] = (porTipo[e.tipo] || 0) + 1; });
    expect(porTipo).toEqual({ UBICACION_PROPUESTA: 6, UBICACION_VALIDADA: 1, UBICACION_SUPERADA: 2, UBICACION_REVERTIDA: 1, UBICACION_RECHAZADA: 1 });
    expect(r.eventos.find((e) => e.tipo === 'UBICACION_VALIDADA').id).toBe('UBICACION:' + ids.c5 + ':VALIDADA');                  // solo la vigente tiene UBICACION_VALIDADA
    expect(r.eventos.filter((e) => e.tipo === 'UBICACION_PROPUESTA').map((e) => e.estado).sort()).toEqual(['PROPUESTA', 'RECHAZADA', 'REVERTIDA', 'SUPERADA', 'SUPERADA', 'VALIDADA']);
  });

  test('los instantes y los nombres de los eventos salen del payload tal cual (ISO UTC del backend)', () => {
    const ids = historiaDeUbicacion();
    const data = leer('getCorreccionesUbicacionPozo', 'lector@x.com').data;
    const r = L.lineaTiempoPozoLogic_normalizarCorrecciones(data, W);
    data.historial.forEach((c) => {
      expect(c.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);                          // el formato REAL ya es el canonico
      expect(r.eventos.find((e) => e.id === 'UBICACION:' + c.correccionId + ':PROPUESTA')).toMatchObject({ timestamp: c.timestamp, nombre: c.nombrePropone });
      if (c.resolucion) {
        expect(r.eventos.find((e) => e.id === 'UBICACION:' + c.correccionId + ':' + c.estado)).toMatchObject({ timestamp: c.resolucion.timestamp, nombre: c.resolucion.nombre });
      }
    });
    expect(r.eventos.find((e) => e.id === 'UBICACION:' + ids.c1 + ':REVERTIDA').detalle).toBe('Se verifico y no era la ubicacion');
    expect(r.eventos.find((e) => e.id === 'UBICACION:' + ids.c4 + ':RECHAZADA').detalle).toBe('Fuera de lugar');
  });

  test('una autovalidacion produce propuesta y validacion del mismo instante, y la validacion queda arriba', () => {
    const c = idDe(proponer('todo@x.com'));
    const data = leer('getCorreccionesUbicacionPozo', 'lector@x.com').data;
    const t = L.lineaTiempoPozoLogic_armar({ UBICACION: { estado: 'OK', data: { correcciones: data } } }, W);
    const propios = t.eventos.filter((e) => e.id.indexOf(c) !== -1).map((e) => e.tipo);
    expect(propios).toEqual(['UBICACION_VALIDADA', 'UBICACION_PROPUESTA']);
  });

  test('CLAVES del payload fijadas: el historial de correcciones trae exactamente estos campos (sin emails ni ids internos)', () => {
    historiaDeUbicacion();
    const data = leer('getCorreccionesUbicacionPozo', 'lector@x.com').data;
    expect(claves(data)).toEqual(['historial', 'pendientes', 'vigente', 'wellId']);
    data.historial.forEach((c) => {
      expect(claves(c)).toEqual(['advertenciaDistancia', 'candidataPrimeraUbicacion', 'coordenadaOriginalTexto', 'correccionId', 'crsOriginal', 'distanciaM', 'estado', 'irrigacion', 'lat', 'lon', 'metodo', 'nombrePropone',
        'observacion', 'precisionGpsM', 'primeraUbicacion', 'propia', 'resolucion', 'timestamp', 'wellId']);
      if (c.resolucion) {
        expect(claves(c.resolucion)).toEqual(['evento', 'motivo', 'nombre', 'timestamp']);
      }
    });
    EMAILS.forEach((e) => expect(JSON.stringify(data)).not.toContain(e));
  });

  test('el payload de otro usuario produce los mismos eventos (la linea de tiempo no depende de `propia`)', () => {
    historiaDeUbicacion();
    const a = L.lineaTiempoPozoLogic_normalizarCorrecciones(leer('getCorreccionesUbicacionPozo', 'lector@x.com').data, W);
    const b = L.lineaTiempoPozoLogic_normalizarCorrecciones(leer('getCorreccionesUbicacionPozo', 'ana@x.com').data, W);
    expect(b).toEqual(a);
  });

  test('sin permiso `ubicacion` el backend responde PERMISSION_DENIED: no hay payload que normalizar', () => {
    historiaDeUbicacion();
    expect(leer('getCorreccionesUbicacionPozo', 'soloobs@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(leer('getCorreccionesUbicacionPozo', 'soloobs@x.com').data).toBeUndefined();
  });

  test('un pozo sin correcciones devuelve una lista vacia valida', () => {
    const data = leer('getCorreccionesUbicacionPozo', 'lector@x.com').data;
    expect(data.historial).toEqual([]);
    expect(L.lineaTiempoPozoLogic_normalizarCorrecciones(data, W)).toEqual({ ok: true, eventos: [], omitidos: [] });
  });
});

describe('Ubicacion: decisiones sobre fuentes (flujo real)', () => {
  const decidir = (extra) => {
    const r = ctx.S.ubicacionFuenteDecisionesService_decidir('val@x.com', USUARIOS['val@x.com'].nombre, T.solicitud(extra));
    ctx.calmar();
    return r;
  };
  const secuenciaCompleta = () => {
    expect(decidir({ accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(decidir({ accion: 'DESCARTAR', fuenteTipo: 'IRRIGACION', x: T.P_IRR2.x, y: T.P_IRR2.y, motivo: 'Esta a 170 m del pozo', versionVista: 1 }).ok).toBe(true);
    expect(decidir({ accion: 'QUITAR_ACEPTACION', versionVista: 2 }).ok).toBe(true);
    expect(decidir({ accion: 'RESTAURAR', fuenteTipo: 'IRRIGACION', x: T.P_IRR2.x, y: T.P_IRR2.y, versionVista: 3 }).ok).toBe(true);
  };

  test('las cuatro decisiones reales producen sus cuatro tipos, con instante, nombre y motivo', () => {
    secuenciaCompleta();
    const data = leer('getDecisionesFuentesPozo', 'lector@x.com').data;
    expect(data.integro).toBe(true);
    const r = L.lineaTiempoPozoLogic_normalizarDecisiones(data, W);
    expect(r.ok).toBe(true);
    expect(r.omitidos).toEqual([]);
    expect(r.eventos.map((e) => e.tipo)).toEqual(['FUENTE_ACEPTADA', 'FUENTE_DESCARTADA', 'FUENTE_ACEPTACION_QUITADA', 'FUENTE_RESTAURADA']);
    expect(r.eventos.map((e) => e.metadata.fuenteTipo)).toEqual(['REPORTE_POZOS', 'IRRIGACION', 'REPORTE_POZOS', 'IRRIGACION']);
    expect(r.eventos.map((e) => e.nombre)).toEqual(Array(4).fill('Valeria Validadora'));
    expect(r.eventos[1].detalle).toBe('Esta a 170 m del pozo');
    const ts = r.eventos.map((e) => e.timestamp);
    expect(ts).toEqual(ts.slice().sort());                                                                     // el reloj avanzo 60 s por decision
    expect(new Set(ts).size).toBe(4);
    const t = L.lineaTiempoPozoLogic_armar({ UBICACION: { estado: 'OK', data: { decisiones: data } } }, W);
    expect(t.eventos.map((e) => e.tipo)).toEqual(['FUENTE_RESTAURADA', 'FUENTE_ACEPTACION_QUITADA', 'FUENTE_DESCARTADA', 'FUENTE_ACEPTADA']);
  });

  test('CLAVES del payload fijadas: historial de decisiones (sin email; trae x/y y secuencia, que el modelo NO copia)', () => {
    secuenciaCompleta();
    const data = leer('getDecisionesFuentesPozo', 'lector@x.com').data;
    expect(claves(data)).toEqual(['fuentes', 'historial', 'integro', 'obsoletas', 'padronPeriodo', 'resolucion', 'version', 'wellId']);
    data.historial.forEach((h) => {
      expect(claves(h)).toEqual(['descartaLaAceptada', 'evento', 'fuenteTipo', 'motivo', 'nombre', 'obsoleta', 'quitaAceptacion', 'reemplazaA', 'reemplazadaPor', 'secuencia', 'timestampUtc', 'x', 'y']);
      expect(h.timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
    EMAILS.forEach((e) => expect(JSON.stringify(data)).not.toContain(e));
    const salida = JSON.stringify(L.lineaTiempoPozoLogic_normalizarDecisiones(data, W));
    expect(salida).not.toMatch(/2486460|6310651|2486590|6310541/);
  });

  test('log NO integro: el backend devuelve historial vacio y el modelo no inventa eventos', () => {
    secuenciaCompleta();
    const cols = ctx.columnas;
    const fila = ctx.fila(0);
    const mala = Object.assign({}, fila, { decisionId: 'dec-' + 'x'.repeat(8), secuencia: 99, evento: 'RESTAURADA', fuenteTipo: 'IRRIGACION', x: T.P_IRR1.x, y: T.P_IRR1.y });      // RESTAURAR una fuente que nunca fue descartada
    hojas.UbicacionFuenteDecisiones.filas.push(cols.map((c) => (mala[c] === undefined ? '' : mala[c])));
    ctx.cache.store = {};
    const data = leer('getDecisionesFuentesPozo', 'lector@x.com').data;
    expect(data.integro).toBe(false);
    expect(data.historial).toEqual([]);
    expect(L.lineaTiempoPozoLogic_normalizarDecisiones(data, W)).toEqual({ ok: true, eventos: [], omitidos: [{ codigo: 'HISTORIAL_NO_INTEGRO', cantidad: 1 }] });
  });

  test('BLOQUEO para E6-2: un pozo FUERA del padron responde WELL_NOT_FOUND en decisiones, mientras las correcciones del mismo pozo funcionan (el cargador debe tratarlo como "sin decisiones")', () => {
    const fuera = '14-0999';
    expect(leer('getDecisionesFuentesPozo', 'lector@x.com', { wellId: fuera })).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    const correcciones = leer('getCorreccionesUbicacionPozo', 'lector@x.com', { wellId: fuera });
    expect(correcciones.status).toBe('ok');
    expect(L.lineaTiempoPozoLogic_normalizarCorrecciones(correcciones.data, fuera)).toEqual({ ok: true, eventos: [], omitidos: [] });
    const t = L.lineaTiempoPozoLogic_armar({ UBICACION: { estado: 'OK', data: { correcciones: correcciones.data } } }, fuera);        // la parte de decisiones puede faltar
    expect(t.fuentes.UBICACION.estado).toBe('VACIA');
  });

  test('sin decisiones: historial vacio, integro y valido', () => {
    const data = leer('getDecisionesFuentesPozo', 'lector@x.com').data;
    expect(data.integro).toBe(true);
    expect(L.lineaTiempoPozoLogic_normalizarDecisiones(data, W)).toEqual({ ok: true, eventos: [], omitidos: [] });
  });
});

describe('Reemplazo (flujo real)', () => {
  const evaluar = (usuario, estado, motivo, observacion) => post({ action: 'registrarEvaluacionReemplazo', sessionToken: 'tok-' + usuario, wellId: W, estado, motivo, observacion, puntoNEReferencia: 'INA 2055' });

  test('cada evaluacion real es un evento; el historial completo, no solo el estado vigente', () => {
    expect(evaluar('marta@x.com', 'NO_APTO', 'SIN_ACCESO', 'Portón cerrado con candado').status).toBe('ok');
    expect(evaluar('marta@x.com', 'DUDOSO', 'POZO_NO_LOCALIZADO', '').status).toBe('ok');
    expect(evaluar('todo@x.com', 'APTO', 'APTO_SIN_OBSERVACIONES', 'Se midio sin problemas').status).toBe('ok');
    const respuesta = leer('getHistorialReemplazo', 'lector@x.com');
    expect(respuesta.status).toBe('ok');
    expect(claves(respuesta.data)).toEqual(['evaluaciones', 'wellId']);
    const r = L.lineaTiempoPozoLogic_normalizarReemplazo(respuesta.data, W);
    expect(r.ok).toBe(true);
    expect(r.omitidos).toEqual([]);
    expect(r.eventos.length).toBe(3);
    expect(r.eventos.map((e) => e.tipo).sort()).toEqual(['REEMPLAZO_APTO', 'REEMPLAZO_DUDOSO', 'REEMPLAZO_NO_APTO']);
    expect(r.eventos.find((e) => e.tipo === 'REEMPLAZO_NO_APTO')).toMatchObject({ detalle: 'Portón cerrado con candado', nombre: 'Marta Evalua', metadata: { motivo: 'SIN_ACCESO' }, estado: 'NO_APTO' });
    expect(r.eventos.find((e) => e.tipo === 'REEMPLAZO_APTO')).toMatchObject({ nombre: 'Todo Poderoso' });
    r.eventos.forEach((e) => {
      expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(true);
      expect(e.id).toMatch(/^REEMPLAZO:[0-9a-f-]{36}$/);
    });
    expect(JSON.stringify(r)).not.toContain('INA 2055');
  });

  test('CLAVES del payload fijadas: cada evaluacion trae exactamente estos campos (sin email)', () => {
    evaluar('marta@x.com', 'APTO', 'APTO_SIN_OBSERVACIONES', '');
    const data = leer('getHistorialReemplazo', 'lector@x.com').data;
    data.evaluaciones.forEach((e) => {
      expect(claves(e)).toEqual(['estado', 'evaluacionId', 'motivo', 'nombre', 'observacion', 'puntoNEReferencia', 'timestamp', 'wellId']);
      expect(e.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
    EMAILS.forEach((e) => expect(JSON.stringify(data)).not.toContain(e));
  });

  test('un pozo sin evaluaciones devuelve una lista vacia valida (SIN_EVALUAR no es un evento)', () => {
    const data = leer('getHistorialReemplazo', 'lector@x.com').data;
    expect(data.evaluaciones).toEqual([]);
    expect(L.lineaTiempoPozoLogic_normalizarReemplazo(data, W)).toEqual({ ok: true, eventos: [], omitidos: [] });
  });
});

describe('Observaciones (flujo real)', () => {
  const agregar = (usuario, texto) => post({ action: 'agregarObservacionPozo', sessionToken: 'tok-' + usuario, wellId: W, texto, clientRequestId: nuevoRid('obs') });
  const anular = (usuario, observacionId, motivo) => post({ action: 'anularObservacionPozo', sessionToken: 'tok-' + usuario, observacionId, motivo, clientRequestId: nuevoRid('anu') });
  const TEXTO_ANULADA = 'TEXTO-QUE-SOLO-VE-EL-MODERADOR-DE-UNA-ANULADA';

  function historia() {
    const a = agregar('beto@x.com', 'Acceso por el camino de tierra, portón azul');
    const b = agregar('todo@x.com', TEXTO_ANULADA);
    expect(a.status).toBe('ok');
    expect(b.status).toBe('ok');
    expect(anular('mod@x.com', b.data.observacion.observacionId, 'Cargada en el pozo equivocado').status).toBe('ok');
    return { a: a.data.observacion.observacionId, b: b.data.observacion.observacionId };
  }

  test('alta + anulacion reales: AGREGADA y ANULADA, sin el texto de la anulada', () => {
    const ids = historia();
    const data = leer('getObservacionesPozo', 'lector@x.com').data;
    const r = L.lineaTiempoPozoLogic_normalizarObservaciones(data, W);
    expect(r.ok).toBe(true);
    expect(r.omitidos).toEqual([]);
    expect(r.eventos.map((e) => e.id).sort()).toEqual([`OBSERVACION:${ids.a}:ALTA`, `OBSERVACION:${ids.b}:ALTA`, `OBSERVACION:${ids.b}:ANULADA`].sort());
    expect(r.eventos.find((e) => e.id === `OBSERVACION:${ids.a}:ALTA`)).toMatchObject({ detalle: 'Acceso por el camino de tierra, portón azul', estado: 'ACTIVA', nombre: 'Beto Observa' });
    expect(r.eventos.find((e) => e.id === `OBSERVACION:${ids.b}:ANULADA`)).toMatchObject({ detalle: 'Cargada en el pozo equivocado', nombre: 'Moderadora Obs', estado: 'ANULADA' });
    expect(JSON.stringify(r)).not.toContain(TEXTO_ANULADA);
  });

  test('el moderador SI recibe el texto de la anulada en el payload; la linea de tiempo es identica y sigue sin el', () => {
    historia();
    const lector = leer('getObservacionesPozo', 'lector@x.com').data;
    const moderador = leer('getObservacionesPozo', 'mod@x.com').data;
    expect(JSON.stringify(lector)).not.toContain(TEXTO_ANULADA);
    expect(JSON.stringify(moderador)).toContain(TEXTO_ANULADA);                                               // el guard de abajo tiene sentido: el dato sensible llega
    const a = L.lineaTiempoPozoLogic_normalizarObservaciones(lector, W);
    const b = L.lineaTiempoPozoLogic_normalizarObservaciones(moderador, W);
    expect(b).toEqual(a);
    expect(JSON.stringify(b)).not.toContain(TEXTO_ANULADA);
  });

  test('CLAVES del payload fijadas: la observacion no trae email, secuencia ni clientRequestId', () => {
    historia();
    const data = leer('getObservacionesPozo', 'mod@x.com').data;
    expect(claves(data)).toEqual(['activas', 'anuladas', 'cursor', 'hayMas', 'observaciones', 'total', 'wellId']);
    data.observaciones.forEach((o) => {
      expect(claves(o)).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'puedeAnular', 'texto', 'timestamp', 'wellId']);
      expect(o.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      if (o.anulacion) {
        expect(claves(o.anulacion)).toEqual(['motivo', 'nombre', 'timestamp']);
      }
    });
    EMAILS.forEach((e) => expect(JSON.stringify(data)).not.toContain(e));
  });

  test('paginado por cursor: la linea de tiempo de dos paginas reales no duplica y suma las observaciones', () => {
    for (let i = 1; i <= 3; i += 1) {
      expect(agregar('beto@x.com', 'Observacion numero ' + i).status).toBe('ok');
    }
    const p1 = leer('getObservacionesPozo', 'lector@x.com', { limit: 2 }).data;
    expect(p1.hayMas).toBe(true);
    expect(p1.observaciones.length).toBe(2);
    const p2 = leer('getObservacionesPozo', 'lector@x.com', { limit: 2, antesDeSecuencia: p1.cursor }).data;
    const e1 = L.lineaTiempoPozoLogic_normalizarObservaciones(p1, W).eventos;
    const e2 = L.lineaTiempoPozoLogic_normalizarObservaciones(p2, W).eventos;
    expect(L.lineaTiempoPozoLogic_deduplicar(e1.concat(e2, e1)).length).toBe(3);
  });

  test('sin permiso `observaciones` el backend responde PERMISSION_DENIED', () => {
    historia();
    expect(leer('getObservacionesPozo', 'marta@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });
});

describe('Fotos: por que NO estan en la linea de tiempo v1', () => {
  const S = require('../backend/src/FotosPozosService');
  const cruda = {
    fotoId: '11111111-2222-4333-8444-555555555555', timestampRegistro: '2026-10-08T16:43:00.000Z', wellId: W, monitoringId: '', fuente: 'RELEVAMIENTO_2018', tipoFoto: 'OTRA', fechaFotoValor: '2018',
    fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'CARPETA', observacion: 'Vista general', estadoVinculo: 'CONFIRMADO', vinculoMetodo: 'AUTO', gpsLat: -33.3, gpsLon: -69.1, gpsOrigen: 'EXIF',
    emailUsuarioCarga: 'secreto@x.com', loteImportacion: 'produccion_final', sha1Original: 'a'.repeat(40), procesamiento: 'SCRIPT', mimeType: 'image/jpeg', tamanoBytes: 1000, ancho: 1600, alto: 1200,
    tamanoOriginalBytes: 4000, driveFileId: 'drive-id', driveThumbId: 'drive-thumb', estado: 'ACTIVA'
  };

  test('CLAVES del payload fijadas: la galeria NO expone fecha de alta (timestampRegistro) ni autor; solo la fecha de la FOTO (parcial)', () => {
    const f = S.fotosPozosService_sanitizar(cruda);
    expect(claves(f)).toEqual(['alto', 'ancho', 'fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fotoId', 'fuente', 'observacion', 'tieneGps', 'tipoFoto']);
    expect(JSON.stringify(f)).not.toMatch(/secreto@x\.com|2026-10-08|timestampRegistro|produccion_final|drive-id/);
  });

  test('la fecha que SI viaja es la de la foto, con precision parcial o desconocida: no demuestra una incorporacion al sistema', () => {
    expect(S.fotosPozosService_sanitizar(cruda)).toMatchObject({ fechaFotoValor: '2018', fechaFotoPrecision: 'ANIO' });
    expect(S.FOTOS_POZOS_PRECISIONES).toEqual(expect.arrayContaining(['DIA', 'MES', 'ANIO', 'DESCONOCIDA']));
    expect(L.lineaTiempoPozoLogic_normalizarFuente('FOTOS', { total: 1, fotos: [S.fotosPozosService_sanitizar(cruda)] }, W).ok).toBe(false);
    expect(Object.keys(L.LINEA_TIEMPO_TIPOS).some((t) => /FOTO/.test(t))).toBe(false);
  });
});

describe('Armado con las tres fuentes reales y permisos reales', () => {
  // lo mismo que hara el cargador de E6-2: cada respuesta del backend se traduce a la entrada de la fuente
  const entrada = (respuesta, conversor) => {
    if (respuesta.status === 'ok') { return { estado: 'OK', data: conversor ? conversor(respuesta.data) : respuesta.data }; }
    return { estado: respuesta.code === 'PERMISSION_DENIED' ? 'SIN_PERMISO' : 'ERROR' };
  };
  const cargar = (usuario) => {
    const decisiones = leer('getDecisionesFuentesPozo', usuario);
    const correcciones = leer('getCorreccionesUbicacionPozo', usuario);
    return L.lineaTiempoPozoLogic_armar({
      UBICACION: correcciones.status === 'ok' && decisiones.status === 'ok'
        ? { estado: 'OK', data: { correcciones: correcciones.data, decisiones: decisiones.data } }
        : (correcciones.code === 'PERMISSION_DENIED' ? { estado: 'SIN_PERMISO' } : { estado: 'ERROR' }),
      REEMPLAZO: entrada(leer('getHistorialReemplazo', usuario)),
      OBSERVACIONES: entrada(leer('getObservacionesPozo', usuario))
    }, W);
  };

  function poblar() {
    historiaDeUbicacion();
    ctx.S.ubicacionFuenteDecisionesService_decidir('val@x.com', 'Valeria Validadora', T.solicitud({ accion: 'ACEPTAR', versionVista: 0 }));
    post({ action: 'registrarEvaluacionReemplazo', sessionToken: 'tok-marta@x.com', wellId: W, estado: 'APTO', motivo: 'APTO_SIN_OBSERVACIONES', observacion: '' });
    post({ action: 'agregarObservacionPozo', sessionToken: 'tok-beto@x.com', wellId: W, texto: 'Pozo con bomba nueva', clientRequestId: nuevoRid('obs') });
  }

  test('un usuario con los tres permisos ve las tres fuentes mezcladas y ordenadas', () => {
    poblar();
    const t = cargar('lector@x.com');
    expect(t.parcial).toBe(false);
    expect(Object.keys(t.fuentes).map((f) => t.fuentes[f].estado)).toEqual(['OK', 'OK', 'OK']);
    expect(new Set(t.eventos.map((e) => e.fuente))).toEqual(new Set(['UBICACION', 'REEMPLAZO', 'OBSERVACIONES']));
    const ts = t.eventos.map((e) => e.timestamp);
    expect(ts).toEqual(ts.slice().sort().reverse());
    expect(t.eventos.length).toBe(11 + 1 + 1 + 1);
    t.eventos.forEach((e) => expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(true));
  });

  test('solo `observaciones`: las otras dos fuentes son SIN_PERMISO (no es un fallo) y solo se ven observaciones', () => {
    poblar();
    const t = cargar('soloobs@x.com');
    expect(t.fuentes.UBICACION.estado).toBe('SIN_PERMISO');
    expect(t.fuentes.REEMPLAZO.estado).toBe('SIN_PERMISO');
    expect(t.fuentes.OBSERVACIONES.estado).toBe('OK');
    expect(t.parcial).toBe(false);
    expect(new Set(t.eventos.map((e) => e.fuente))).toEqual(new Set(['OBSERVACIONES']));
  });

  test('solo `reemplazo` y solo `ubicacion`: cada uno ve unicamente su fuente', () => {
    poblar();
    const r = cargar('marta@x.com');
    expect(r.fuentes.REEMPLAZO.estado).toBe('OK');
    expect(new Set(r.eventos.map((e) => e.fuente))).toEqual(new Set(['REEMPLAZO']));
    const u = cargar('val@x.com');
    expect(u.fuentes.UBICACION.estado).toBe('OK');
    expect(new Set(u.eventos.map((e) => e.fuente))).toEqual(new Set(['UBICACION']));
  });

  test('sin ningun permiso: linea de tiempo vacia, todas SIN_PERMISO, sin "parcial"', () => {
    poblar();
    const t = cargar('nada@x.com');
    expect(t.eventos).toEqual([]);
    expect(Object.keys(t.fuentes).map((f) => t.fuentes[f].estado)).toEqual(['SIN_PERMISO', 'SIN_PERMISO', 'SIN_PERMISO']);
    expect(t.parcial).toBe(false);
  });

  test('una fuente que cae (la hoja de observaciones desaparece): ERROR y parcial, las otras siguen', () => {
    poblar();
    delete hojas.ObservacionesPozo;
    const t = cargar('lector@x.com');
    expect(t.fuentes.OBSERVACIONES.estado).toBe('ERROR');
    expect(t.parcial).toBe(true);
    expect(t.fuentes.UBICACION.estado).toBe('OK');
    expect(t.fuentes.REEMPLAZO.estado).toBe('OK');
    expect(t.eventos.length).toBe(11 + 1 + 1);                                                     // correcciones + una decision + una evaluacion (las observaciones cayeron)
  });

  test('nada sensible sale: ni emails, ni tokens, ni ids de pedido, ni coordenadas', () => {
    poblar();
    const salida = JSON.stringify(cargar('lector@x.com'));
    EMAILS.forEach((e) => expect(salida).not.toContain(e));
    ['tok-', 'clientRequestId', 'req-0', 'corr-0', 'obs-0', String(OFICIAL.lat).slice(0, 7), String(OFICIAL.lon).slice(0, 7), 'secuencia'].forEach((s) => expect(salida).not.toContain(s));
  });
});
