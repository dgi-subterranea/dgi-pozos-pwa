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
  'lector@x.com': { nombre: 'Lector', permisos: { ubicacion: true } }
};

// Campos de la vista de correccion que el BACKEND entrega (congelados: si cambian, hay que revisar el frontend a proposito).
const CAMPOS_VISTA = ['advertenciaDistancia', 'correccionId', 'distanciaM', 'estado', 'irrigacion', 'lat', 'lon', 'metodo', 'nombrePropone', 'observacion', 'precisionGpsM', 'propia', 'resolucion', 'timestamp', 'wellId'];
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
  });
});
