// CONTRATO frontend <-> backend de las correcciones de ubicacion, contra el codigo REAL de hoy (el repo, que es lo desplegado: ver docs): el frontend
// (js/api.js ejecutado de verdad + js/ubicacionCorreccionLogic.js) habla con Api.doPost -> servicio -> repositorio sobre hojas en memoria. Si un nombre de
// campo, de accion, de permiso o de codigo de error cambia de un lado y no del otro, falla aca en vez de romper en silencio en el celular.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const F = require('../../js/ubicacionCorreccionLogic');

const raiz = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const apiFrontend = leer('js', 'api.js');
const fuenteApi = leer('backend', 'src', 'Api.js');
const fuenteServicio = leer('backend', 'src', 'UbicacionCorreccionService.js');

const W = '14-0001';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const norte = (grados) => OFICIAL.lat + grados;
const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'carla@x.com': { nombre: 'Carla', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { ubicacion: true } },
  'val@x.com': { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_validar: true } }
};

// Campos de la vista de correccion que el BACKEND entrega (congelados: si cambian, hay que revisar el frontend a proposito).
// Etapa 2 (coordenadas ingresadas) suma coordenadaOriginalTexto y crsOriginal: vacios ('') en GPS_ACTUAL, PUNTO_EN_MAPA y filas historicas. El frontend actual NO los lee.
const CAMPOS_VISTA = ['advertenciaDistancia', 'candidataPrimeraUbicacion', 'coordenadaOriginalTexto', 'correccionId', 'crsOriginal', 'distanciaM', 'estado', 'irrigacion', 'lat', 'lon', 'metodo', 'nombrePropone', 'observacion', 'precisionGpsM', 'primeraUbicacion', 'propia', 'resolucion', 'timestamp', 'wellId'];
// (Desde la Etapa 4 el frontend conoce TODOS los metodos y errores del backend: ya no hay listas temporales de "solo backend".)
const CAMPOS_RESOLUCION = ['evento', 'motivo', 'nombre', 'timestamp'];

let Api;
let hojas;
let ctxFrontend;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  const Repo = require('../src/UbicacionCorreccionRepository');
  const Service = require('../src/UbicacionCorreccionService');
  Object.assign(global, Repo, Service);
  hojas = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS] });
  global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  global.registryService_getWellLocation = jest.fn((id) => (id === W ? { found: true, location: { wellId: id, ubicacionResuelta: OFICIAL } } : { found: false }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
  global.logHistoryEvent = jest.fn();
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);

  // js/api.js REAL: su fetch llama a Api.doPost del backend real (mismo cuerpo, mismo JSON de vuelta).
  ctxFrontend = vm.createContext({
    JSON, Object,
    fetch: (url, opciones) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(Api.doPost({ postData: { contents: opciones.body } }).text)) })
  });
  vm.runInContext(apiFrontend, ctxFrontend);
});

let n = 0;
// payload tal como lo arma el frontend (construirPayload) -> apiProponerCorreccionUbicacion -> backend
const proponer = (usuario, valores, extra) => {
  n += 1;
  const v = Object.assign({ lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, valores || {});
  const payload = F.ubicacionCorreccionLogic_construirPayload(W, v, 'contrato-' + String(n).padStart(8, '0'));
  return ctxFrontend.apiProponerCorreccionUbicacion('tok-' + usuario, Object.assign(payload, extra || {}));
};
const leerPozo = (usuario) => ctxFrontend.apiGetCorreccionesUbicacionPozo('tok-' + usuario, W);
const claves = (o) => Object.keys(o).sort();

// Registra las propiedades que el frontend LEE de un objeto: si lee una que el backend no trae, el contrato esta roto.
function espiar(obj, leidas, prefijo) {
  if (obj === null || typeof obj !== 'object') { return obj; }
  return new Proxy(obj, {
    get(t, p) {
      if (typeof p === 'string') { leidas.add((prefijo || '') + p); }
      const v = t[p];
      // objetos y arrays se envuelven tambien (vigente, cada pendiente, cada item del historial); resolucion/irrigacion llevan su propio prefijo
      return v && typeof v === 'object' ? espiar(v, leidas, p === 'resolucion' || p === 'irrigacion' ? p + '.' : (prefijo || '')) : v;
    }
  });
}

describe('proponerCorreccionUbicacion: lo que devuelve HOY el backend', () => {
  test('usuario con corregir y SIN validar: {correccion, duplicada, curada}, correccion PROPUESTA, sin autoValidada; el frontend lo muestra como pendiente', async () => {
    const r = await proponer('ana@x.com');
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['correccion', 'curada', 'duplicada']);
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(r.data.autoValidada).toBeUndefined();
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('pendiente');
    expect(F.ubicacionCorreccionLogic_mensajeResultado('pendiente')).toBe('Corrección enviada para validación.');
  });

  test('usuario con corregir Y validar: la correccion nace VALIDADA y el backend suma autoValidada:true + supersedidas (el flag EXISTE hoy)', async () => {
    const r = await proponer('carla@x.com');
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['autoValidada', 'correccion', 'curada', 'duplicada', 'supersedidas']);
    expect(r.data.autoValidada).toBe(true);
    expect(r.data.supersedidas).toEqual([]);
    expect(r.data.correccion.estado).toBe('VALIDADA');
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('validada');
    expect(F.ubicacionCorreccionLogic_mensajeResultado('validada')).toBe('Ubicación corregida y validada.');
  });

  test('si ya habia una vigente, supersedidas trae su id (nombre y forma del campo fijados)', async () => {
    const primera = await proponer('carla@x.com');
    const segunda = await proponer('carla@x.com', { lat: norte(0.0004) });
    expect(segunda.data.autoValidada).toBe(true);
    expect(segunda.data.supersedidas).toEqual([primera.data.correccion.correccionId]);
    const lectura = (await leerPozo('lector@x.com')).data;
    expect(lectura.vigente.correccionId).toBe(segunda.data.correccion.correccionId);
    expect(lectura.historial.find((c) => c.correccionId === primera.data.correccion.correccionId).estado).toBe('SUPERADA');
  });

  test('el frontend NO depende del flag: sin autoValidada/supersedidas (forma v36) el resultado sale igual, por correccion.estado', async () => {
    const validada = JSON.parse(JSON.stringify(await proponer('carla@x.com')));
    delete validada.data.autoValidada;
    delete validada.data.supersedidas;
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(validada)).toBe('validada');
    const pendiente = JSON.parse(JSON.stringify(await proponer('ana@x.com')));
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(pendiente)).toBe('pendiente');
  });

  test('la vista de la correccion tiene EXACTAMENTE los campos acordados (y resolucion {evento, nombre, timestamp, motivo} cuando existe)', async () => {
    const pend = await proponer('ana@x.com');
    expect(claves(pend.data.correccion)).toEqual(CAMPOS_VISTA);
    expect(pend.data.correccion.resolucion).toBeNull();
    const val = await proponer('carla@x.com');
    expect(claves(val.data.correccion)).toEqual(CAMPOS_VISTA);
    expect(claves(val.data.correccion.resolucion)).toEqual(CAMPOS_RESOLUCION);
    expect(claves(val.data.correccion.irrigacion)).toEqual(['estado', 'fuente', 'lat', 'lon', 'padronPeriodo']);
  });

  test('la vista no trae emails ni datos de otras personas (solo nombres)', async () => {
    const r = await proponer('carla@x.com', { observacion: 'ok' });
    expect(JSON.stringify(r)).not.toMatch(/@/);
    expect(JSON.stringify(r)).not.toMatch(/emailPropone/);
  });

  test('un reenvio con el mismo clientRequestId devuelve duplicada:true sin autoValidada (no vuelve a validar)', async () => {
    const valores = { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' };
    const payload = F.ubicacionCorreccionLogic_construirPayload(W, valores, 'reintento-0000001');
    const a = await ctxFrontend.apiProponerCorreccionUbicacion('tok-carla@x.com', payload);
    const b = await ctxFrontend.apiProponerCorreccionUbicacion('tok-carla@x.com', payload);
    expect(a.data.duplicada).toBe(false);
    expect(b.data.duplicada).toBe(true);
    expect(b.data.autoValidada).toBeUndefined();
    expect(b.data.correccion.correccionId).toBe(a.data.correccion.correccionId);
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(b)).toBe('validada');
    expect(hojas.UbicacionCorreccionesLog.filas.slice(1).map((f) => f[2])).toEqual(['PROPUESTA', 'VALIDADA']);
  });
});

describe('payload del frontend aceptado por el backend (nombres de campo)', () => {
  test('lo que arma construirPayload llega completo a la hoja: lat, lon, metodo, precisionGpsM, observacion y clientRequestId', async () => {
    await proponer('ana@x.com', { lat: norte(0.0003), lon: -69.1455, metodo: 'GPS_ACTUAL', precisionGpsM: 9.46, observacion: '  nota de campo  ' });
    const cab = hojas.UbicacionCorrecciones.filas[0];
    const fila = hojas.UbicacionCorrecciones.filas[1];
    const col = (n) => fila[cab.indexOf(n)];
    expect(col('wellId')).toBe(W);
    expect(col('lat')).toBeCloseTo(norte(0.0003), 6);
    expect(col('lon')).toBe(-69.1455);
    expect(col('metodo')).toBe('GPS_ACTUAL');
    expect(col('precisionGpsM')).toBe(9.5);
    expect(col('observacion')).toBe('nota de campo');
    expect(col('clientRequestId')).toMatch(/^contrato-/);
    expect(col('emailPropone')).toBe('ana@x.com');                         // la identidad sale de la sesion
  });

  test('PUNTO_EN_MAPA con precisionGpsM null (como lo manda el frontend) es valido', async () => {
    expect((await proponer('ana@x.com', { metodo: 'PUNTO_EN_MAPA', precisionGpsM: null })).status).toBe('ok');
  });

  test('campos de identidad / estado que alguien agregue por fuera del payload son ignorados por el backend (el frontend tampoco los manda)', async () => {
    const r = await proponer('ana@x.com', null, { email: 'otro@x.com', nombre: 'Falso', autoValidar: true, estado: 'VALIDADA', distanciaM: 0 });
    // apiProponerCorreccionUbicacion los descarta (lista blanca) y, aunque llegaran, el backend toma todo de la sesion
    expect(r.status).toBe('ok');
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(r.data.correccion.nombrePropone).toBe('Ana');
    expect(hojas.UbicacionCorrecciones.filas[1][hojas.UbicacionCorrecciones.filas[0].indexOf('emailPropone')]).toBe('ana@x.com');
  });
});

describe('getCorreccionesUbicacionPozo: lo que devuelve HOY el backend', () => {
  test('{wellId, vigente, pendientes, historial}: todos existen, aun sin correcciones', async () => {
    const r = await leerPozo('lector@x.com');
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['historial', 'pendientes', 'vigente', 'wellId']);
    expect(r.data).toMatchObject({ wellId: W, vigente: null, pendientes: [], historial: [] });
  });

  test('con una vigente y una pendiente: tipos y campos exactos; vigente y pendientes son vistas completas', async () => {
    await proponer('carla@x.com');
    await proponer('ana@x.com');
    const r = await leerPozo('lector@x.com');
    expect(claves(r.data)).toEqual(['historial', 'pendientes', 'vigente', 'wellId']);
    expect(claves(r.data.vigente)).toEqual(CAMPOS_VISTA);
    expect(r.data.vigente.estado).toBe('VALIDADA');
    expect(Array.isArray(r.data.pendientes)).toBe(true);
    expect(r.data.pendientes).toHaveLength(1);
    expect(claves(r.data.pendientes[0])).toEqual(CAMPOS_VISTA);
    expect(r.data.pendientes[0].estado).toBe('PROPUESTA');
    expect(r.data.historial).toHaveLength(2);
    r.data.historial.forEach((c) => expect(claves(c)).toEqual(CAMPOS_VISTA));
  });

  test('un lector (solo "ubicacion") puede leer; la lectura no trae emails', async () => {
    await proponer('carla@x.com');
    const r = await leerPozo('lector@x.com');
    expect(r.status).toBe('ok');
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });

  test('el frontend pinta la seccion con una lectura REAL del backend (nombres, coordenadas, estados)', async () => {
    await proponer('carla@x.com', { observacion: 'Boca corrida' });
    await proponer('ana@x.com', { lat: norte(0.0005), observacion: 'Segunda visita' });
    const r = await leerPozo('lector@x.com');
    const h = F.ubicacionCorreccionLogic_htmlSeccion(r.data, { puedeCorregir: false });
    expect(h).toContain('Validada en campo');
    expect(h).toContain('Carla');
    expect(h).toContain('Correcciones pendientes de validación (1)');          // hay vigente Y pendiente: ambas se ven
    expect(h).toContain('Ana');
    expect(h).toContain('Boca corrida');
    expect(h).toContain('Historial de correcciones (2)');
    expect(h).toContain('Elegida en mapa');
    expect(h).not.toContain('btn-ubic-corr-abrir');
  });

  test('el frontend solo LEE campos que el backend entrega (vista, resolucion y respuesta de lectura)', async () => {
    await proponer('carla@x.com', { observacion: 'a' });
    await proponer('ana@x.com', { observacion: 'b' });
    const lectura = (await leerPozo('lector@x.com')).data;
    const leidas = new Set();
    F.ubicacionCorreccionLogic_htmlSeccion(espiar(JSON.parse(JSON.stringify(lectura)), leidas), { puedeCorregir: true });
    const permitidos = new Set(['vigente', 'pendientes', 'historial', 'length', 'forEach', 'map', 'slice', 'sort', ...CAMPOS_VISTA, ...CAMPOS_RESOLUCION.map((c) => 'resolucion.' + c)]);
    const desconocidas = [...leidas].filter((k) => !permitidos.has(k) && !/^\d+$/.test(k) && k !== 'constructor' && k !== 'then' && k !== 'toJSON');
    expect(desconocidas).toEqual([]);
    expect(leidas.has('nombrePropone')).toBe(true);
    expect(leidas.has('distanciaM')).toBe(true);
  });

  test('el flujo de guardado del frontend contra el backend real: guardar -> relee -> pinta lo que dice el backend', async () => {
    const flujo = F.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: (payload) => ctxFrontend.apiProponerCorreccionUbicacion('tok-carla@x.com', payload),
      leer: (wellId) => ctxFrontend.apiGetCorreccionesUbicacionPozo('tok-carla@x.com', wellId),
      generarId: () => F.ubicacionCorreccionLogic_nuevoClientRequestId()
    });
    const r = await flujo.guardar(W, { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: { lat: OFICIAL.lat, lon: OFICIAL.lon } });
    expect(r).toMatchObject({ tipo: 'ok', resultado: 'validada', mensaje: 'Ubicación corregida y validada.', lecturaFallida: false });
    expect(r.lectura.vigente.correccionId).toBe(r.correccion.correccionId);
    const ana = F.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: (payload) => ctxFrontend.apiProponerCorreccionUbicacion('tok-ana@x.com', payload),
      leer: (wellId) => ctxFrontend.apiGetCorreccionesUbicacionPozo('tok-ana@x.com', wellId),
      generarId: () => F.ubicacionCorreccionLogic_nuevoClientRequestId()
    });
    const p = await ana.guardar(W, { lat: norte(0.0004), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: { lat: OFICIAL.lat, lon: OFICIAL.lon } });
    expect(p).toMatchObject({ tipo: 'ok', resultado: 'pendiente', mensaje: 'Corrección enviada para validación.' });
    expect(p.lectura.pendientes).toHaveLength(1);
  });
});

describe('contrato de errores', () => {
  test('observacion obligatoria: el backend responde OBSERVACION_REQUERIDA con distanciaM y el frontend la usa en su mensaje', async () => {
    const r = await proponer('ana@x.com', { lat: norte(0.003) });
    expect(r).toMatchObject({ status: 'error', code: 'OBSERVACION_REQUERIDA' });
    expect(typeof r.distanciaM).toBe('number');
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code, r)).toContain('(a ' + F.ubicacionCorreccionLogic_formatearDistancia(r.distanciaM) + ' de Irrigación)');
  });

  test('errores reales del backend y su mensaje especifico en el frontend', async () => {
    const generico = F.ubicacionCorreccionLogic_mensajeError('__nunca__');
    const casos = [
      [await proponer('ana@x.com', { lat: 10, lon: 10 }), 'FUERA_DE_MENDOZA'],
      [await proponer('ana@x.com', { metodo: 'GPS_ACTUAL', precisionGpsM: 80 }), 'PRECISION_INSUFICIENTE'],
      [await proponer('lector@x.com'), 'PERMISSION_DENIED'],
      [await ctxFrontend.apiProponerCorreccionUbicacion('tok-desconocido@x.com', { wellId: W }), 'UNAUTHORIZED']
    ];
    casos.forEach(([resp, code]) => {
      expect(resp).toMatchObject({ status: 'error', code: code });
      expect(F.ubicacionCorreccionLogic_mensajeError(resp.code, resp)).not.toBe(generico);
    });
  });

  test('IDEMPOTENCY_CONFLICT real: mismo clientRequestId con otro contenido', async () => {
    const base = { lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' };
    await ctxFrontend.apiProponerCorreccionUbicacion('tok-ana@x.com', F.ubicacionCorreccionLogic_construirPayload(W, Object.assign({ lat: norte(0.0002) }, base), 'conflicto-0000001'));
    const r = await ctxFrontend.apiProponerCorreccionUbicacion('tok-ana@x.com', F.ubicacionCorreccionLogic_construirPayload(W, Object.assign({ lat: norte(0.0004) }, base), 'conflicto-0000001'));
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code)).toBe(F.UCORR_MENSAJES_ERROR.IDEMPOTENCY_CONFLICT);
  });

  test('WELL_NOT_FOUND real: pozo que el padron no conoce', async () => {
    const payload = F.ubicacionCorreccionLogic_construirPayload('14-9999', { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, 'sinpozo-00000001');
    const r = await ctxFrontend.apiProponerCorreccionUbicacion('tok-ana@x.com', payload);
    expect(r).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code)).toBe(F.UCORR_MENSAJES_ERROR.WELL_NOT_FOUND);
  });

  test('TODO codigo de error que el servicio puede devolver al proponer tiene mensaje propio en el frontend', () => {
    const SOLO_RESOLVER = ['INVALID_ACCION', 'INVALID_CORRECCION_ID', 'CORRECCION_NOT_FOUND', 'INVALID_TRANSITION', 'SELF_REJECTION', 'INVALID_MOTIVO'];
    const delServicio = [...new Set([...fuenteServicio.matchAll(/ubicacionCorreccionService_error\(\s*'([A-Z_]+)'/g)].map((m) => m[1]))].filter((c) => SOLO_RESOLVER.indexOf(c) === -1);
    expect(delServicio.length).toBeGreaterThan(8);
    const generico = F.ubicacionCorreccionLogic_mensajeError('__nunca__');
    const sinMensaje = delServicio.filter((c) => F.ubicacionCorreccionLogic_mensajeError(c, { distanciaM: 300 }) === generico);
    expect(sinMensaje).toEqual([]);
    ['PERMISSION_DENIED', 'UNAUTHORIZED', 'USER_DISABLED', 'SERVICE_UNAVAILABLE', 'INVALID_WELL_ID'].forEach((c) => expect(F.ubicacionCorreccionLogic_mensajeError(c)).not.toBe(generico));
  });

  test('todo codigo con mensaje en el frontend existe en el backend (no quedan mensajes huerfanos de un codigo renombrado)', () => {
    const backend = ['Api.js', 'UbicacionCorreccionService.js', 'AuthService.js', 'RegistryService.js'].map((f) => leer('backend', 'src', f)).join('\n');
    const huerfanos = Object.keys(F.UCORR_MENSAJES_ERROR).filter((c) => backend.indexOf("'" + c + "'") === -1);
    expect(huerfanos).toEqual([]);
  });
});

describe('contrato de acciones y permisos', () => {
  test('las acciones que llama el frontend estan ruteadas en doPost del backend', () => {
    const acciones = [...apiFrontend.matchAll(/callBackend\('(proponerCorreccionUbicacion|getCorreccionesUbicacionPozo)'/g)].map((m) => m[1]);
    expect(acciones.sort()).toEqual(['getCorreccionesUbicacionPozo', 'proponerCorreccionUbicacion']);
    acciones.forEach((a) => expect(fuenteApi).toContain("body.action === '" + a + "'"));
  });

  test('los permisos que mira el frontend existen en el modelo del backend (Usuarios / login) con esos nombres exactos', () => {
    const usuarios = leer('backend', 'src', 'SheetUserRepository.js');
    const auth = leer('backend', 'src', 'AuthService.js');
    ['ubicacion', 'ubicacion_corregir'].forEach((p) => {
      expect(usuarios).toMatch(new RegExp("USUARIOS_COLUMNAS_PERMISO = \\[[^\\]]*'" + p + "'"));
      expect(auth).toMatch(new RegExp(p + ': false'));
    });
    const front = leer('js', 'ubicacionCorreccionLogic.js');
    expect(front).toContain('permisos.ubicacion === true && permisos.ubicacion_corregir === true');
  });

  test('el backend exige exactamente esos permisos al proponer y "ubicacion" al leer', () => {
    expect(fuenteApi).toMatch(/validarPermisosTodos\(session, 'proponerCorreccionUbicacion', d\.wellId, \['ubicacion', 'ubicacion_corregir'\]\)/);
    expect(fuenteApi).toMatch(/validarPermiso\(session, 'getCorreccionesUbicacionPozo', wellId, 'ubicacion'\)/);
  });

  test('el login real devuelve los permisos de correccion como booleanos que el frontend interpreta', () => {
    const auth = leer('backend', 'src', 'AuthService.js');
    expect(auth).toMatch(/ubicacion_corregir: false, ubicacion_validar: false/);
    expect(F.ubicacionCorreccionLogic_puedeCorregir({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: false })).toBe(true);
  });

  test('el frontend usa los umbrales del backend (50 m GPS, 250 m observacion, 1 km advertencia, 300 caracteres)', () => {
    const S = require('../src/UbicacionCorreccionService');
    expect(F.UCORR_GPS_PRECISION_MAX_M).toBe(S.UBICACION_CORR_GPS_PRECISION_MAX_M);
    expect(F.UCORR_OBSERVACION_DESDE_M).toBe(S.UBICACION_CORR_OBSERVACION_DESDE_M);
    expect(F.UCORR_ADVERTENCIA_DESDE_M).toBe(S.UBICACION_CORR_ADVERTENCIA_DESDE_M);
    expect(F.UCORR_OBSERVACION_MAX).toBe(S.UBICACION_CORR_OBSERVACION_MAX);
    expect(F.UCORR_METODOS).toEqual(S.UBICACION_CORR_METODOS);
    expect(F.UCORR_SISTEMAS_COORDENADAS.map((x) => x.metodo)).toEqual(S.UBICACION_CORR_METODOS_COORDENADAS);
  });

  test('la distancia que calcula el frontend coincide con la del backend (mismo haversine)', async () => {
    const S = require('../src/UbicacionCorreccionService');
    [[0.0002, 0], [0.003, 0.001], [0.01, -0.01]].forEach(([dLat, dLon]) => {
      const lat = norte(dLat);
      const lon = OFICIAL.lon + dLon;
      expect(F.ubicacionCorreccionLogic_distanciaMetros(OFICIAL.lat, OFICIAL.lon, lat, lon)).toBe(S.ubicacionCorreccionService_distanciaMetros(OFICIAL.lat, OFICIAL.lon, lat, lon));
    });
    const r = await proponer('carla@x.com', { lat: norte(0.0002) });
    expect(r.data.correccion.distanciaM).toBe(F.ubicacionCorreccionLogic_evaluarPropuesta({ lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: OFICIAL }).distanciaM);
  });

  test('los estados con coordenada oficial del frontend son los que el backend usa para el snapshot', () => {
    expect(fuenteServicio).toMatch(/UBICACION_CORR_ESTADOS_CON_COORDENADA = \{ corroborada: true, unica: true \}/);
    expect(F.ubicacionCorreccionLogic_irrigacionDeUbicacion({ ubicacionResuelta: { estado: 'corroborada', lat: 1, lon: 2 } })).not.toBeNull();
    expect(F.ubicacionCorreccionLogic_irrigacionDeUbicacion({ ubicacionResuelta: { estado: 'revisar', lat: 1, lon: 2 } })).toBeNull();
  });

  test('las etiquetas del frontend cubren todos los estados y metodos que el backend define', () => {
    const S = require('../src/UbicacionCorreccionService');
    S.UBICACION_CORR_EVENTOS.concat([S.UBICACION_CORR_ESTADO_INCONSISTENTE]).forEach((e) => {
      expect(F.ubicacionCorreccionLogic_etiquetaEstado(e)).not.toBe('Estado desconocido');
    });
    S.UBICACION_CORR_METODOS.forEach((m) => expect(F.ubicacionCorreccionLogic_etiquetaMetodo(m)).not.toBe(m));
    // un metodo realmente desconocido se muestra con su codigo (no rompe el historial)
    expect(F.ubicacionCorreccionLogic_etiquetaMetodo('METODO_FUTURO')).toBe('METODO_FUTURO');
  });
});

describe('indicador de pendientes contra el backend REAL (getCorreccionesUbicacionPendientes + validar / rechazar)', () => {
  const accion = (usuario, action, extra) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ action: action, sessionToken: 'tok-' + usuario }, extra || {})) } }).text);
  function indicador(usuario) {
    const est = { pintados: [], sesion: 0 };
    const permisos = USUARIOS[usuario] ? USUARIOS[usuario].permisos : {};
    const b = F.ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: () => ({ sessionToken: 'tok-' + usuario, permisos: permisos, onSessionExpired: () => { est.sesion += 1; }, onUserDisabled: () => {} }),
      consultar: (token) => ctxFrontend.apiGetCorreccionesUbicacionPendientes(token),
      pintar: (t) => { est.pintados.push(t); }
    });
    return { b, est };
  }

  test('el backend devuelve {total, inconsistentes, pendientes[]} y el frontend solo usa total (entero)', async () => {
    await proponer('ana@x.com');
    const r = await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com');
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['inconsistentes', 'pendientes', 'total']);
    expect(r.data.total).toBe(1);
    expect(F.ubicacionCorreccionLogic_totalDePendientes(r)).toBe(1);
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });

  test('la accion existe en doPost con los permisos que el frontend asume (ubicacion + ubicacion_validar)', () => {
    expect(apiFrontend).toContain("callBackend('getCorreccionesUbicacionPendientes'");
    expect(fuenteApi).toContain("body.action === 'getCorreccionesUbicacionPendientes'");
    expect(fuenteApi).toMatch(/validarPermisosTodos\(session, 'getCorreccionesUbicacionPendientes', null, \['ubicacion', 'ubicacion_validar'\]\)/);
    expect(F.ubicacionCorreccionLogic_puedeValidar({ ubicacion: true, ubicacion_validar: true })).toBe(true);
  });

  test('quien NO valida recibe PERMISSION_DENIED del backend (y el frontend ni siquiera pregunta)', async () => {
    for (const u of ['ana@x.com', 'lector@x.com']) {
      expect(await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-' + u)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      const { b, est } = indicador(u);
      expect((await b.refrescar()).tipo).toBe('sin_permiso');
      expect(est.pintados[est.pintados.length - 1]).toBeNull();
    }
  });

  test('flujo completo: 3 propuestas -> indicador 3 -> validar una -> 2 -> rechazar otra -> 1 (con las acciones reales del backend)', async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await proponer('ana@x.com', { lat: norte(0.0002 * (i + 1)) })).data.correccion.correccionId);
    }
    const { b, est } = indicador('val@x.com');
    expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 3 });
    expect(F.ubicacionCorreccionLogic_textoBadgePendientes(b.total())).toBe('Correcciones pendientes: 3');

    expect(accion('val@x.com', 'validarCorreccionUbicacion', { correccionId: ids[0], motivo: 'ok' }).status).toBe('ok');
    expect(await b.alResolver()).toEqual({ tipo: 'ok', total: 2 });

    expect(accion('val@x.com', 'rechazarCorreccionUbicacion', { correccionId: ids[1], motivo: 'No coincide' }).status).toBe('ok');
    expect(await b.alResolver()).toEqual({ tipo: 'ok', total: 1 });

    expect(accion('val@x.com', 'rechazarCorreccionUbicacion', { correccionId: ids[2], motivo: 'Tampoco' }).status).toBe('ok');
    expect(await b.alResolver()).toEqual({ tipo: 'ok', total: 0 });
    expect(est.pintados).toEqual([3, 2, 1, 0]);
    expect(F.ubicacionCorreccionLogic_textoBadgePendientes(0)).toBe('');
  });

  test('una correccion directa de quien corrige y valida NO suma pendientes', async () => {
    await proponer('carla@x.com');
    const { b } = indicador('val@x.com');
    expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 0 });
  });

  test('quien tiene corregir Y validar tambien ve el indicador (sus propias propuestas directas no cuentan)', async () => {
    await proponer('ana@x.com');
    const { b } = indicador('carla@x.com');
    expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 1 });
  });

  test('token invalido (sesion vencida): el backend responde UNAUTHORIZED y el indicador avisa a la app', async () => {
    const est = { sesion: 0 };
    const b = F.ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: () => ({ sessionToken: 'tok-fantasma@x.com', permisos: { ubicacion: true, ubicacion_validar: true }, onSessionExpired: () => { est.sesion += 1; } }),
      consultar: (t) => ctxFrontend.apiGetCorreccionesUbicacionPendientes(t),
      pintar: () => {}
    });
    expect(await b.refrescar()).toEqual({ tipo: 'sesion' });
    expect(est.sesion).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Etapa 2: coordenadas ingresadas (COORDENADAS_GMS / COORDENADAS_POSGAR94_AR2). Aca se fija el contrato del BACKEND (forma del payload, campos nuevos de la vista, errores nuevos) llamando a callBackend (el mismo transporte que usa api.js) -> Api.doPost.
// (La Etapa 3 ya sumo coordenadaOriginal a la lista blanca de js/api.js y los mensajes de error; los tests de abajo cubren el frontend real.)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('Etapa 2: contrato de las coordenadas ingresadas (backend real)', () => {
  const GMS = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };       // = OFICIAL
  const POSGAR = { x: 2500000, y: 6350000 };
  let m = 0;
  const wire = (usuario, cuerpo) => {
    m += 1;
    return ctxFrontend.callBackend('proponerCorreccionUbicacion', Object.assign({ sessionToken: 'tok-' + usuario, wellId: W, clientRequestId: 'coord-' + String(m).padStart(8, '0'), observacion: 'se midio en campo' }, cuerpo));
  };

  test('la lista blanca de doPost para proponer es EXACTAMENTE esta (el campo nuevo es coordenadaOriginal; coordenadaOriginalTexto y crsOriginal NO se leen del cliente)', () => {
    const bloque = fuenteApi.slice(fuenteApi.indexOf("body.action === 'proponerCorreccionUbicacion'"), fuenteApi.indexOf("body.action === 'getCorreccionesUbicacionPozo'"));
    const campos = [...bloque.matchAll(/^\s+(\w+): body\.\w+,?$/gm)].map((x) => x[1]).sort();
    expect(campos).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(bloque.replace(/\/\/.*$/gm, '')).not.toMatch(/coordenadaOriginalTexto|crsOriginal/);
  });

  test('COORDENADAS_GMS: payload {metodo, coordenadaOriginal:{lat:{g,m,s,h}, lon:{g,m,s,h}}} (+ lat/lon de preview opcionales) -> correccion con los campos nuevos', async () => {
    const r = await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS });
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['correccion', 'curada', 'duplicada']);
    expect(claves(r.data.correccion)).toEqual(CAMPOS_VISTA);
    expect(r.data.correccion).toMatchObject({
      metodo: 'COORDENADAS_GMS', estado: 'PROPUESTA', lat: -33.34765, lon: -69.14545, precisionGpsM: null,
      crsOriginal: 'GMS_WGS84', coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O'
    });
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('pendiente');
    const conPreview = await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS, lat: -33.34765, lon: -69.14545 });
    expect(conPreview.status).toBe('ok');
  });

  test('COORDENADAS_POSGAR94_AR2: payload {metodo, coordenadaOriginal:{x (Este), y (Norte)}} -> texto canonico y EPSG:22182; con permiso de validar nace VALIDADA', async () => {
    const r = await wire('carla@x.com', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: POSGAR });
    expect(r.status).toBe('ok');
    expect(claves(r.data)).toEqual(['autoValidada', 'correccion', 'curada', 'duplicada', 'supersedidas']);
    expect(r.data.correccion).toMatchObject({
      metodo: 'COORDENADAS_POSGAR94_AR2', estado: 'VALIDADA', crsOriginal: 'EPSG:22182', coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00',
      lat: -32.992946, lon: -69
    });
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('validada');
  });

  test('la lectura por pozo trae los campos nuevos en vigente, pendientes e historial; GPS / mapa / filas historicas los traen vacios', async () => {
    await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS });
    await wire('ana@x.com', { metodo: 'PUNTO_EN_MAPA', lat: norte(0.0002), lon: OFICIAL.lon });
    await wire('carla@x.com', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: POSGAR });
    const r = await leerPozo('lector@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.historial).toHaveLength(3);
    r.data.historial.forEach((c) => expect(claves(c)).toEqual(CAMPOS_VISTA));
    const por = {};
    r.data.historial.forEach((c) => { por[c.metodo] = c; });
    expect(por.PUNTO_EN_MAPA).toMatchObject({ coordenadaOriginalTexto: '', crsOriginal: '' });
    expect(por.COORDENADAS_GMS.crsOriginal).toBe('GMS_WGS84');
    expect(r.data.vigente.metodo).toBe('COORDENADAS_POSGAR94_AR2');
    expect(JSON.stringify(r)).not.toMatch(/@/);
  });

  test('el frontend conoce y pinta COORDENADAS_POSGAR94_AR2: etiqueta, texto canonico y sistema', async () => {
    const r = await wire('ana@x.com', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: POSGAR });
    expect(r.status).toBe('ok');
    expect(F.ubicacionCorreccionLogic_etiquetaMetodo(r.data.correccion.metodo)).toBe('Coordenadas POSGAR 94 / Argentina 2');
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('pendiente');
    const html = F.ubicacionCorreccionLogic_htmlTarjeta(r.data.correccion, { modo: 'pendiente' });
    expect(html).toContain('Coordenadas POSGAR 94 / Argentina 2');
    expect(html).toContain('Coordenada ingresada');
    expect(html).toContain('X(Este)=2500000.00, Y(Norte)=6350000.00');
    expect(html).toContain('POSGAR 94 / Argentina 2 · EPSG:22182');
  });

  describe('errores nuevos (code, message y, si corresponde, detalle y campo)', () => {
    test.each([
      ['GMS minutos fuera de rango', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: Object.assign({}, GMS.lat, { m: 60 }), lon: GMS.lon } }, { code: 'COORDENADA_INVALIDA', detalle: 'MINUTOS_FUERA_DE_RANGO', campo: 'lat.m' }],
      ['GMS sin hemisferio', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: GMS.lat, lon: Object.assign({}, GMS.lon, { h: '' }) } }, { code: 'COORDENADA_INVALIDA', detalle: 'HEMISFERIO_REQUERIDO', campo: 'lon.h' }],
      ['GMS hemisferio equivocado', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: Object.assign({}, GMS.lat, { h: 'N' }), lon: GMS.lon } }, { code: 'FUERA_DE_MENDOZA' }],
      ['POSGAR X/Y invertidos', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: 6350000, y: 2500000 } }, { code: 'XY_INVERTIDOS' }],
      ['POSGAR Este fuera de rango', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: 100, y: 6350000 } }, { code: 'COORDENADA_INVALIDA', detalle: 'ESTE_FUERA_DE_RANGO', campo: 'x' }],
      ['POSGAR fuera de la caja de Mendoza', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: 2300000, y: 5800000 } }, { code: 'FUERA_DE_MENDOZA' }],
      ['lat/lon del cliente que no coinciden', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS, lat: -33.0, lon: -69.0 }, { code: 'COORDENADA_INCONSISTENTE' }],
      ['sin coordenadaOriginal', { metodo: 'COORDENADAS_GMS' }, { code: 'INVALID_COORDENADA_ORIGINAL' }],
      ['coordenadaOriginal con claves de mas', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: 2500000, y: 6350000, z: 0 } }, { code: 'INVALID_COORDENADA_ORIGINAL' }],
      ['coordenadaOriginal en un metodo que no la lleva', { metodo: 'PUNTO_EN_MAPA', lat: norte(0.0002), lon: OFICIAL.lon, coordenadaOriginal: POSGAR }, { code: 'INVALID_COORDENADA_ORIGINAL' }]
    ])('%s', async (_n, cuerpo, esperado) => {
      const r = await wire('ana@x.com', cuerpo);
      expect(r).toMatchObject(Object.assign({ status: 'error' }, esperado));
      expect(typeof r.message).toBe('string');
      expect(claves(r).every((k) => ['status', 'code', 'message', 'detalle', 'campo', 'distanciaM'].indexOf(k) !== -1)).toBe(true);
      if (esperado.detalle === undefined) { expect(r.detalle).toBeUndefined(); }
      const leida = await leerPozo('lector@x.com');
      expect(leida.data.historial).toHaveLength(0);
    });

    test('el mensaje de error no repite lo que escribio la persona (nada del payload vuelve en la respuesta)', async () => {
      const r = await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: Object.assign({}, GMS.lat, { s: 'SECRETO-123' }), lon: GMS.lon } });
      expect(r.code).toBe('COORDENADA_INVALIDA');
      expect(JSON.stringify(r)).not.toContain('SECRETO');
    });

    test('permisos: quien no tiene ubicacion_corregir (lector, o solo validador) recibe PERMISSION_DENIED tambien con los metodos nuevos', async () => {
      for (const u of ['lector@x.com', 'val@x.com']) {
        const r = await wire(u, { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS });
        expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      }
      expect((await leerPozo('lector@x.com')).data.historial).toHaveLength(0);
    });

    test('hoja todavia en 18 columnas: los metodos viejos andan y los nuevos responden ESQUEMA_DESACTUALIZADO (sin escribir)', async () => {
      const Repo = require('../src/UbicacionCorreccionRepository');
      hojas.UbicacionCorrecciones.filas[0] = Repo.UBICACION_CORRECCIONES_COLUMNAS_V1.slice();
      expect((await wire('ana@x.com', { metodo: 'PUNTO_EN_MAPA', lat: norte(0.0002), lon: OFICIAL.lon })).status).toBe('ok');
      const r = await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS });
      expect(r).toMatchObject({ status: 'error', code: 'ESQUEMA_DESACTUALIZADO' });
      expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Etapa 3: el FRONTEND REAL (js/ubicacionCorreccionLogic.js + js/api.js + js/coordenadasConversion.js) contra el BACKEND REAL (Api.doPost -> servicio -> hojas).
// Fija el contrato de "Ingresar coordenadas (GMS)": payload, lat/lon SIN redondear (tolerancia metrica de 2 cm del backend), campos nuevos de la vista y errores.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('Etapa 3: contrato del frontend GMS contra el backend real', () => {
  let w = 0;
  const wire = (usuario, cuerpo) => {
    w += 1;
    return ctxFrontend.callBackend('proponerCorreccionUbicacion', Object.assign({ sessionToken: 'tok-' + usuario, wellId: W, clientRequestId: 'e3wire-' + String(w).padStart(8, '0'), observacion: 'x' }, cuerpo));
  };
  const entrada = (lat, lon) => ({ lat: Object.assign({ g: '', m: '', s: '', h: 'S' }, lat), lon: Object.assign({ g: '', m: '', s: '', h: 'O' }, lon) });
  const ENTRADA_OFICIAL = entrada({ g: '33', m: '20', s: '51,54' }, { g: '69', m: '8', s: '43,62' });       // = OFICIAL (lo que tipea una persona: con coma)
  let k = 0;
  // exactamente lo que hace el controlador: evaluar los campos -> valores -> construirPayload -> apiProponerCorreccionUbicacion
  function payloadGms(ent, extra) {
    const ev = F.ubicacionCorreccionLogic_evaluarEntradaGms(ent);
    expect(ev.estado).toBe('valido');
    k += 1;
    const valores = Object.assign({
      lat: ev.derivado.latExacta, lon: ev.derivado.lonExacta, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: 'medido en campo',
      coordenadaOriginal: ev.original, irrigacion: OFICIAL
    }, extra || {});
    expect(F.ubicacionCorreccionLogic_evaluarPropuesta(valores).ok).toBe(true);
    return { ev, payload: F.ubicacionCorreccionLogic_construirPayload(W, valores, 'etapa3-' + String(k).padStart(8, '0')) };
  }
  const enviar = (usuario, payload) => ctxFrontend.apiProponerCorreccionUbicacion('tok-' + usuario, payload);

  test('el payload del frontend para COORDENADAS_GMS llega al backend y se guarda: texto canonico, CRS, lat/lon derivados por el backend', async () => {
    const { payload } = payloadGms(ENTRADA_OFICIAL);
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    const r = await enviar('ana@x.com', payload);
    expect(r.status).toBe('ok');
    expect(r.data.correccion).toMatchObject({
      metodo: 'COORDENADAS_GMS', estado: 'PROPUESTA', lat: -33.34765, lon: -69.14545, crsOriginal: 'GMS_WGS84', coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O'
    });
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('pendiente');
  });

  test('el backend permite EXACTAMENTE los campos que arma el frontend (la lista blanca de doPost incluye coordenadaOriginal y nada de coordenadaOriginalTexto / crsOriginal)', () => {
    const bloque = fuenteApi.slice(fuenteApi.indexOf("body.action === 'proponerCorreccionUbicacion'"), fuenteApi.indexOf("body.action === 'getCorreccionesUbicacionPozo'"));
    const permitidos = [...bloque.matchAll(/^\s+(\w+): body\.\w+,?$/gm)].map((x) => x[1]);
    const { payload } = payloadGms(ENTRADA_OFICIAL);
    Object.keys(payload).forEach((c) => expect(permitidos).toContain(c));
    expect(permitidos).not.toContain('coordenadaOriginalTexto');
    expect(permitidos).not.toContain('crsOriginal');
  });

  test('el frontend manda lat/lon SIN redondear: aun cuando el redondeo a 6 decimales quedaria a 5,4 cm, el backend acepta el valor exacto', async () => {
    const fino = entrada({ g: '33', m: '20', s: '51,541764' }, { g: '69', m: '8', s: '43,62' });
    const { ev, payload } = payloadGms(fino);
    expect(ev.derivado.lat).toBe(-33.34765);
    expect(payload.lat).not.toBe(ev.derivado.lat);                    // el payload lleva la conversion exacta
    const r = await enviar('ana@x.com', payload);
    expect(r.status).toBe('ok');
    expect(r.data.correccion.lat).toBe(-33.34765);                    // y el backend persiste el valor redondeado a 6 decimales
  });

  test('si un cliente redondeara lat/lon a 6 decimales (a 5,4 cm del exacto), el backend lo rechaza: COORDENADA_INCONSISTENTE con mensaje amigable en el frontend', async () => {
    const fino = entrada({ g: '33', m: '20', s: '51,541764' }, { g: '69', m: '8', s: '43,62' });
    const { ev, payload } = payloadGms(fino);
    const redondeado = Object.assign({}, payload, { lat: ev.derivado.lat, lon: ev.derivado.lon });
    const r = await enviar('ana@x.com', redondeado);
    expect(r).toMatchObject({ status: 'error', code: 'COORDENADA_INCONSISTENTE' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code, r)).toMatch(/no coincide con el punto calculado/);
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code, r)).not.toMatch(/COORDENADA/);
  });

  test('con la coordenada original adulterada (otro segundo) y el lat/lon de antes, el backend responde COORDENADA_INCONSISTENTE', async () => {
    const { payload } = payloadGms(ENTRADA_OFICIAL);
    const adulterado = JSON.parse(JSON.stringify(payload));
    adulterado.coordenadaOriginal.lat.s = 10;
    expect(await enviar('ana@x.com', adulterado)).toMatchObject({ status: 'error', code: 'COORDENADA_INCONSISTENTE' });
  });

  test('CONTRATO NUMERICO: 150 coordenadas GMS dentro de Mendoza -> el backend acepta cada payload del frontend y guarda EXACTAMENTE el lat/lon que el frontend muestra', async () => {
    let semilla = 2026;
    const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
    for (let i = 0; i < 150; i += 1) {
      const lat = 32 + Math.floor(azar() * 5);                                   // 32..36 S
      const lon = 67 + Math.floor(azar() * 3);                                   // 67..69 O
      const e = entrada({ g: String(lat), m: String(Math.floor(azar() * 60)), s: (azar() * 59.9999).toFixed(4).replace('.', i % 2 ? ',' : '.') },
        { g: String(lon), m: String(Math.floor(azar() * 60)), s: (azar() * 59.9999).toFixed(4) });
      const ev = F.ubicacionCorreccionLogic_evaluarEntradaGms(e);
      if (ev.estado !== 'valido') { continue; }
      const { payload } = payloadGms(e, { irrigacion: null, observacion: 'muestra ' + i });
      const r = await enviar('carla@x.com', payload);
      expect(r.status).toBe('ok');
      expect([r.data.correccion.lat, r.data.correccion.lon]).toEqual([ev.derivado.lat, ev.derivado.lon]);
      expect(r.data.correccion.coordenadaOriginalTexto).toBe(ev.textoOriginal);
    }
  });

  test('lo que el frontend marca como invalido, el backend tambien lo rechaza (mismas reglas, mismo modulo): ningun invalido llega a guardarse', async () => {
    const invalidos = [
      entrada({ g: '33', m: '60' }, { g: '69' }), entrada({ g: '33', s: '60' }, { g: '69' }), entrada({ g: '33,5' }, { g: '69' }),
      entrada({ g: '33', h: 'N' }, { g: '69' }), entrada({ g: '33' }, { g: '69', h: 'E' }), entrada({ g: '34', m: '36' }, { g: '58', m: '22' }), entrada({ g: '91' }, { g: '69' })
    ];
    for (const e of invalidos) {
      expect(F.ubicacionCorreccionLogic_evaluarEntradaGms(e).estado).toBe('invalido');
      const original = { lat: { g: e.lat.g, m: e.lat.m, s: e.lat.s, h: e.lat.h }, lon: { g: e.lon.g, m: e.lon.m, s: e.lon.s, h: e.lon.h } };
      const r = await wire('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: original });
      expect(r.status).toBe('error');
      expect(['COORDENADA_INVALIDA', 'FUERA_DE_MENDOZA']).toContain(r.code);
    }
    expect((await leerPozo('lector@x.com')).data.historial).toHaveLength(0);
  });

  test('un punto ARRASTRADO (PUNTO_EN_MAPA) se guarda sin coordenadaOriginal, con campos nuevos vacios', async () => {
    const valores = { lat: -33.3470000123, lon: -69.1450000456, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: OFICIAL };
    expect(F.ubicacionCorreccionLogic_evaluarPropuesta(valores).ok).toBe(true);
    const payload = F.ubicacionCorreccionLogic_construirPayload(W, valores, 'arrastre-00000001');
    expect(payload).not.toHaveProperty('coordenadaOriginal');
    const r = await enviar('ana@x.com', payload);
    expect(r.status).toBe('ok');
    expect(r.data.correccion).toMatchObject({ metodo: 'PUNTO_EN_MAPA', lat: -33.347, lon: -69.145, coordenadaOriginalTexto: '', crsOriginal: '' });
  });

  test('el mismo clientRequestId reenviado (reintento) no duplica; con otro segundo el frontend genera otro id y se guarda aparte', async () => {
    const { payload } = payloadGms(ENTRADA_OFICIAL);
    const a = await enviar('ana@x.com', payload);
    const b = await enviar('ana@x.com', payload);
    expect(b.data.duplicada).toBe(true);
    expect(b.data.correccion.correccionId).toBe(a.data.correccion.correccionId);
    const otra = payloadGms(entrada({ g: '33', m: '20', s: '52' }, { g: '69', m: '8', s: '43,62' })).payload;
    expect(otra.clientRequestId).not.toBe(payload.clientRequestId);
    expect((await enviar('ana@x.com', otra)).data.duplicada).toBe(false);
  });

  test('la ficha pinta lo que devuelve el backend: "Coordenadas GMS / WGS84", el valor original aparte y las filas viejas sin cambios', async () => {
    await wire('ana@x.com', { metodo: 'PUNTO_EN_MAPA', lat: norte(0.0002), lon: OFICIAL.lon });
    await enviar('carla@x.com', payloadGms(ENTRADA_OFICIAL).payload);
    const lectura = (await leerPozo('lector@x.com')).data;
    const html = F.ubicacionCorreccionLogic_htmlSeccion(lectura, { puedeCorregir: false });
    expect(html).toContain('Coordenadas GMS / WGS84');
    expect(html).toContain('Coordenada ingresada');
    expect(html).toContain('GMS / WGS84');
    expect(html).toContain('-33.34765, -69.14545');
    expect(html).toContain('Elegida en mapa');
    expect(html.match(/Coordenada ingresada/g)).toHaveLength(2);        // la vigente y su fila del historial; la corrección por mapa no suma
  });

  test('hoja todavia en 18 columnas: el frontend recibe ESQUEMA_DESACTUALIZADO con un mensaje amigable (y GPS / mapa siguen guardando)', async () => {
    const Repo = require('../src/UbicacionCorreccionRepository');
    hojas.UbicacionCorrecciones.filas[0] = Repo.UBICACION_CORRECCIONES_COLUMNAS_V1.slice();
    const r = await enviar('ana@x.com', payloadGms(ENTRADA_OFICIAL).payload);
    expect(r).toMatchObject({ status: 'error', code: 'ESQUEMA_DESACTUALIZADO' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code)).toMatch(/todavía no está disponible/);
    const mapa = await enviar('ana@x.com', F.ubicacionCorreccionLogic_construirPayload(W, { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, 'sinmigrar-00000001'));
    expect(mapa.status).toBe('ok');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Etapa 4: POSGAR 94 / Argentina 2. El FRONTEND REAL (logica + api.js + modulo de conversion) contra el BACKEND REAL.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('Etapa 4: contrato del frontend POSGAR contra el backend real', () => {
  const fixturePosgar = require('../../js/fixtures/posgar94_ar2_vectores.json');
  const BackConv = require('../src/CoordenadasConversion');
  let k4 = 0;
  let w4 = 0;
  const wire = (usuario, cuerpo) => {
    w4 += 1;
    return ctxFrontend.callBackend('proponerCorreccionUbicacion', Object.assign({ sessionToken: 'tok-' + usuario, wellId: W, clientRequestId: 'e4wire-' + String(w4).padStart(8, '0'), observacion: 'x' }, cuerpo));
  };
  const posgarOficial = () => { const p = BackConv.coordenadas_wgs84APosgar(OFICIAL.lat, OFICIAL.lon); return { x: Math.round(p.este * 100) / 100, y: Math.round(p.norte * 100) / 100 }; };
  // exactamente lo que hace el controlador: evaluar los campos -> valores -> construirPayload -> apiProponerCorreccionUbicacion
  function payloadPosgar(entrada, extra) {
    const ev = F.ubicacionCorreccionLogic_evaluarEntradaPosgar(entrada);
    expect(ev.estado).toBe('valido');
    k4 += 1;
    const valores = Object.assign({
      lat: ev.derivado.latExacta, lon: ev.derivado.lonExacta, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null, observacion: 'planilla de campo',
      coordenadaOriginal: ev.original, irrigacion: OFICIAL
    }, extra || {});
    expect(F.ubicacionCorreccionLogic_evaluarPropuesta(valores).ok).toBe(true);
    return { ev, payload: F.ubicacionCorreccionLogic_construirPayload(W, valores, 'etapa4-' + String(k4).padStart(8, '0')) };
  }
  const enviar = (usuario, payload) => ctxFrontend.apiProponerCorreccionUbicacion('tok-' + usuario, payload);
  const ENTRADA = () => { const p = posgarOficial(); return { x: String(p.x).replace('.', ','), y: String(p.y).replace('.', ',') }; };

  test('el payload del frontend para POSGAR llega al backend y se guarda: texto canonico, CRS EPSG:22182 y lat/lon derivados', async () => {
    const { payload, ev } = payloadPosgar(ENTRADA());
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(Object.keys(payload.coordenadaOriginal).sort()).toEqual(['x', 'y']);
    const r = await enviar('ana@x.com', payload);
    expect(r.status).toBe('ok');
    const p = posgarOficial();
    expect(r.data.correccion).toMatchObject({
      metodo: 'COORDENADAS_POSGAR94_AR2', estado: 'PROPUESTA', crsOriginal: 'EPSG:22182', precisionGpsM: null,
      coordenadaOriginalTexto: 'X(Este)=' + p.x.toFixed(2) + ', Y(Norte)=' + p.y.toFixed(2), lat: ev.derivado.lat, lon: ev.derivado.lon
    });
    expect(F.ubicacionCorreccionLogic_resultadoDeRespuesta(r)).toBe('pendiente');
  });

  test('con permiso de validar nace VALIDADA y la ficha la pinta con "Coordenadas POSGAR 94 / Argentina 2", la coordenada ingresada y el sistema', async () => {
    const { payload } = payloadPosgar(ENTRADA());
    const r = await enviar('carla@x.com', payload);
    expect(r.data.correccion.estado).toBe('VALIDADA');
    const lectura = (await leerPozo('lector@x.com')).data;
    const html = F.ubicacionCorreccionLogic_htmlSeccion(lectura, { puedeCorregir: false });
    expect(html).toContain('Coordenadas POSGAR 94 / Argentina 2');
    expect(html).toContain('Coordenada ingresada');
    expect(html).toContain('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(html).toMatch(/X\(Este\)=\d+\.\d\d, Y\(Norte\)=\d+\.\d\d/);
  });

  test('los formatos habituales (entero, punto, coma, miles, formato argentino) dan el MISMO punto y el mismo texto canonico en el backend', async () => {
    const formatos = [['2500000.5', '6350000.25'], ['2500000,5', '6350000,25'], ['2.500.000,50', '6.350.000,25'], ['2500000,50', '6350000.25']];
    const vistos = [];
    for (const [x, y] of formatos) {
      const { payload } = payloadPosgar({ x, y }, { irrigacion: null });
      const r = await enviar('carla@x.com', payload);
      expect(r.status).toBe('ok');
      vistos.push([r.data.correccion.lat, r.data.correccion.lon, r.data.correccion.coordenadaOriginalTexto]);
    }
    vistos.forEach((v) => expect(v).toEqual(vistos[0]));
    expect(vistos[0][2]).toBe('X(Este)=2500000.50, Y(Norte)=6350000.25');
  });

  test('lat/lon de MAXIMA precision: el backend acepta el valor exacto del frontend; el redondeado a 6 decimales puede quedar a mas de 2 cm y se rechaza', async () => {
    // busca un X/Y cuyo redondeo a 6 decimales quede a MAS de 2 cm de la conversion exacta
    let caso = null;
    for (let i = 0; i < 60 && !caso; i += 1) {
      const e = F.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: String(2450000 + i * 1.37), y: String(6200000 + i * 2.11) });
      if (e.estado !== 'valido') { continue; }
      const dist = F.ubicacionCorreccionLogic_distanciaMetros(e.derivado.latExacta, e.derivado.lonExacta, e.derivado.lat, e.derivado.lon);
      if (dist > 0.04) { caso = { x: String(2450000 + i * 1.37), y: String(6200000 + i * 2.11) }; }
    }
    expect(caso).not.toBeNull();
    const { payload, ev } = payloadPosgar(caso, { irrigacion: null, observacion: 'x' });
    expect((await enviar('ana@x.com', payload)).status).toBe('ok');
    const redondeado = Object.assign({}, payload, { clientRequestId: 'etapa4-redondeado1', lat: ev.derivado.lat, lon: ev.derivado.lon });
    const r = await enviar('ana@x.com', redondeado);
    expect(r).toMatchObject({ status: 'error', code: 'COORDENADA_INCONSISTENTE' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code)).toMatch(/no coincide con el punto calculado/);
  });

  test('CONTRATO NUMERICO: los vectores de pyproj que caen en Mendoza -> el backend guarda EXACTAMENTE el lat/lon que el frontend muestra', async () => {
    let guardados = 0;
    for (const v of fixturePosgar.posgar) {
      const ev = F.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: String(v.x), y: String(v.y) });
      if (ev.estado !== 'valido') { continue; }
      const { payload } = payloadPosgar({ x: String(v.x), y: String(v.y) }, { irrigacion: null, observacion: 'vector pyproj' });
      const r = await enviar('carla@x.com', payload);
      expect(r.status).toBe('ok');
      expect([r.data.correccion.lat, r.data.correccion.lon]).toEqual([ev.derivado.lat, ev.derivado.lon]);
      expect(Math.abs(r.data.correccion.lat - v.lat)).toBeLessThanOrEqual(5.1e-7);          // y contra pyproj (a 6 decimales)
      expect(Math.abs(r.data.correccion.lon - v.lon)).toBeLessThanOrEqual(5.1e-7);
      guardados += 1;
    }
    expect(guardados).toBeGreaterThanOrEqual(30);
  });

  test('X/Y invertidos: el frontend NO deja armar el payload; si alguien lo manda igual, el backend responde XY_INVERTIDOS y NO guarda; tras "Intercambiar" se guarda', async () => {
    const inv = { x: '6.350.000', y: '2.500.000' };
    expect(F.ubicacionCorreccionLogic_evaluarEntradaPosgar(inv)).toMatchObject({ estado: 'invalido', invertido: true });
    const crudo = await wire('ana@x.com', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: 6350000, y: 2500000 } });
    expect(crudo).toMatchObject({ status: 'error', code: 'XY_INVERTIDOS' });
    expect(F.ubicacionCorreccionLogic_mensajeError(crudo.code)).toMatch(/X e Y están intercambiados/);
    expect((await leerPozo('lector@x.com')).data.historial).toHaveLength(0);
    const { payload } = payloadPosgar(F.ubicacionCorreccionLogic_intercambiarXY(inv), { irrigacion: null });
    expect(payload.coordenadaOriginal).toEqual({ x: 2500000, y: 6350000 });
    expect((await enviar('ana@x.com', payload)).status).toBe('ok');
  });

  test('lo que el frontend marca invalido, el backend tambien lo rechaza (mismas reglas, mismo modulo)', async () => {
    const invalidos = [{ x: 'abc', y: '6350000' }, { x: '100', y: '6350000' }, { x: '2500000', y: '5000000' }, { x: '2300000', y: '5800000' }, { x: '6350000', y: '2500000' }];
    for (const e of invalidos) {
      expect(F.ubicacionCorreccionLogic_evaluarEntradaPosgar(e).estado).toBe('invalido');
      const r = await wire('ana@x.com', { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: e });
      expect(r.status).toBe('error');
      expect(['COORDENADA_INVALIDA', 'FUERA_DE_MENDOZA', 'XY_INVERTIDOS']).toContain(r.code);
    }
    expect((await leerPozo('lector@x.com')).data.historial).toHaveLength(0);
  });

  test('un punto ARRASTRADO desde POSGAR se guarda como PUNTO_EN_MAPA, sin coordenadaOriginal y con los campos nuevos vacios', async () => {
    const valores = { lat: -33.3470000123, lon: -69.1450000456, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: OFICIAL };
    const payload = F.ubicacionCorreccionLogic_construirPayload(W, valores, 'arrastre4-00000001');
    expect(payload).not.toHaveProperty('coordenadaOriginal');
    const r = await enviar('ana@x.com', payload);
    expect(r.data.correccion).toMatchObject({ metodo: 'PUNTO_EN_MAPA', coordenadaOriginalTexto: '', crsOriginal: '' });
  });

  test('idempotencia: reenviar el mismo payload no duplica; cambiar X da otro clientRequestId y otra fila', async () => {
    const { payload } = payloadPosgar(ENTRADA(), { irrigacion: null });
    const a = await enviar('ana@x.com', payload);
    const b = await enviar('ana@x.com', payload);
    expect(b.data.duplicada).toBe(true);
    expect(b.data.correccion.correccionId).toBe(a.data.correccion.correccionId);
    const e = ENTRADA();
    const otro = payloadPosgar({ x: String(Number(e.x.replace(',', '.')) + 5).replace('.', ','), y: e.y }, { irrigacion: null }).payload;
    expect(otro.clientRequestId).not.toBe(payload.clientRequestId);
    expect((await enviar('ana@x.com', otro)).data.duplicada).toBe(false);
  });

  test('GMS y POSGAR del MISMO punto con el mismo clientRequestId son solicitudes distintas (IDEMPOTENCY_CONFLICT)', async () => {
    const pos = payloadPosgar(ENTRADA(), { irrigacion: null }).payload;
    const gms = F.ubicacionCorreccionLogic_construirPayload(W, {
      lat: OFICIAL.lat, lon: OFICIAL.lon, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: 'planilla de campo',
      coordenadaOriginal: { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } }
    }, pos.clientRequestId);
    expect((await enviar('ana@x.com', pos)).status).toBe('ok');
    expect(await enviar('ana@x.com', gms)).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('hoja todavia en 18 columnas: ESQUEMA_DESACTUALIZADO con mensaje amigable (y GMS tambien); GPS / mapa siguen guardando', async () => {
    const Repo = require('../src/UbicacionCorreccionRepository');
    hojas.UbicacionCorrecciones.filas[0] = Repo.UBICACION_CORRECCIONES_COLUMNAS_V1.slice();
    const r = await enviar('ana@x.com', payloadPosgar(ENTRADA()).payload);
    expect(r).toMatchObject({ status: 'error', code: 'ESQUEMA_DESACTUALIZADO' });
    expect(F.ubicacionCorreccionLogic_mensajeError(r.code)).toMatch(/todavía no está disponible/);
    const mapa = await enviar('ana@x.com', F.ubicacionCorreccionLogic_construirPayload(W, { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, 'sinmigrar4-0000001'));
    expect(mapa.status).toBe('ok');
  });

  test('permisos: sin ubicacion_corregir (lector, solo validador) el backend responde PERMISSION_DENIED tambien con POSGAR', async () => {
    for (const u of ['lector@x.com', 'val@x.com']) {
      expect(await enviar(u, payloadPosgar(ENTRADA()).payload)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    }
  });

  test('regresion: GMS, GPS y mapa siguen guardando con el frontend real y los mismos campos de siempre', async () => {
    const gmsEv = F.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '51,54', h: 'S' }, lon: { g: '69', m: '8', s: '43,62', h: 'O' } });
    const gms = F.ubicacionCorreccionLogic_construirPayload(W, { lat: gmsEv.derivado.latExacta, lon: gmsEv.derivado.lonExacta, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: '', coordenadaOriginal: gmsEv.original }, 'regr4-gms-0000001');
    expect((await enviar('ana@x.com', gms)).data.correccion.crsOriginal).toBe('GMS_WGS84');
    const gps = F.ubicacionCorreccionLogic_construirPayload(W, { lat: norte(0.0001), lon: OFICIAL.lon, metodo: 'GPS_ACTUAL', precisionGpsM: 8, observacion: '' }, 'regr4-gps-0000001');
    expect(Object.keys(gps)).not.toContain('coordenadaOriginal');
    expect((await enviar('ana@x.com', gps)).data.correccion).toMatchObject({ metodo: 'GPS_ACTUAL', precisionGpsM: 8, crsOriginal: '' });
    const mapa = F.ubicacionCorreccionLogic_construirPayload(W, { lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, 'regr4-map-0000001');
    expect((await enviar('carla@x.com', mapa)).data.correccion).toMatchObject({ metodo: 'PUNTO_EN_MAPA', estado: 'VALIDADA' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Nombres humanos UNIFICADOS (UI / historial / email / modulo de conversion): una sola forma de llamar a cada metodo y a cada sistema.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('etiquetas humanas consistentes entre frontend, email y modulo de conversion', () => {
  const Notif = () => require('../src/UbicacionCorreccionNotificacion');
  const Conv = () => require('../../js/coordenadasConversion');
  const vistaDe = (metodo, crs, texto) => ({ wellId: W, metodo, crsOriginal: crs, coordenadaOriginalTexto: texto, nombrePropone: 'Ana', estado: 'PROPUESTA', distanciaM: 1 });
  const CASOS = [
    ['COORDENADAS_GMS', 'GMS_WGS84', "33° 20' 51.54\" S, 69° 8' 43.62\" O", 'Coordenadas GMS / WGS84', 'GMS / WGS84'],
    ['COORDENADAS_POSGAR94_AR2', 'EPSG:22182', 'X(Este)=2500000.00, Y(Norte)=6350000.00', 'Coordenadas POSGAR 94 / Argentina 2', 'POSGAR 94 / Argentina 2 · EPSG:22182']
  ];

  test.each(CASOS)('%s: el nombre del metodo y del sistema son los mismos en la ficha, el email y la lista de sistemas', (metodo, crs, texto, nombreMetodo, nombreSistema) => {
    expect(F.ubicacionCorreccionLogic_etiquetaMetodo(metodo)).toBe(nombreMetodo);
    expect(F.ubicacionCorreccionLogic_etiquetaCrs(crs)).toBe(nombreSistema);
    expect(F.ubicacionCorreccionLogic_sistemaPorMetodo(metodo).etiquetaLarga).toBe(nombreSistema);
    const email = Notif().ubicacionCorreccionNotificacion_armarMensaje(vistaDe(metodo, crs, texto), '').cuerpo;
    expect(email).toContain('Método: ' + nombreMetodo + '\n');
    expect(email).toContain('Valor ingresado: ' + texto + '\n');
    expect(email).toContain('Sistema: ' + nombreSistema + '\n');
    const ficha = F.ubicacionCorreccionLogic_htmlTarjeta(vistaDe(metodo, crs, texto), { modo: 'historial' });
    expect(ficha).toContain(nombreMetodo);
    expect(ficha).toContain('<dt>Sistema</dt>');
    expect(ficha).toContain(nombreSistema);
  });

  test('el modulo de conversion usa el mismo nombre de sistema POSGAR que la UI (· EPSG:22182), en frontend y en backend', () => {
    expect(Conv().COORD_POSGAR_ETIQUETA).toBe('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(require('../src/CoordenadasConversion').COORD_POSGAR_ETIQUETA).toBe('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(Conv().COORD_POSGAR_ETIQUETA).toBe(F.UCORR_SISTEMAS_COORDENADAS.filter((s) => s.id === 'POSGAR')[0].etiquetaLarga);
  });

  test('GPS y mapa conservan sus nombres de siempre y no suman "Sistema" ni "Valor ingresado" en el email', () => {
    expect(F.ubicacionCorreccionLogic_etiquetaMetodo('GPS_ACTUAL')).toBe('GPS');
    expect(F.ubicacionCorreccionLogic_etiquetaMetodo('PUNTO_EN_MAPA')).toBe('Elegida en mapa');
    ['GPS_ACTUAL', 'PUNTO_EN_MAPA'].forEach((m) => {
      const email = Notif().ubicacionCorreccionNotificacion_armarMensaje(vistaDe(m, '', ''), '').cuerpo;
      expect(email).not.toContain('Sistema:');
      expect(email).not.toContain('Valor ingresado:');
    });
  });

  test('los textos fijos de la convencion son los mismos en HTML, logica y selector: X / Este, Y / Norte, GMS / WGS84, EPSG:22182', () => {
    const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
    expect(html).toContain('X / Este');
    expect(html).toContain('Y / Norte');
    expect(html).toContain('>GMS / WGS84</button>');
    expect(html).toContain('POSGAR 94 / Argentina 2</strong> · EPSG:22182');
    expect(html).toContain(F.UCORR_TEXTO_AYUDA_XY);
    expect(F.UCORR_TEXTO_AYUDA_XY).toBe('En esta aplicación se ingresa X = Este e Y = Norte.');
  });

  test('los codigos internos NO cambiaron', () => {
    expect(F.UCORR_METODOS).toEqual(['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2']);
    expect(Object.keys(F.UCORR_ETIQUETAS_CRS).sort()).toEqual(['EPSG:22182', 'GMS_WGS84']);
    expect(require('../src/CoordenadasConversion').COORD_CRS_GMS).toBe('GMS_WGS84');
    expect(require('../src/CoordenadasConversion').COORD_CRS_POSGAR94_AR2).toBe('EPSG:22182');
  });
});
