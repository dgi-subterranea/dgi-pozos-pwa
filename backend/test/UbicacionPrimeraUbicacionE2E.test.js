// E4-1 de punta a punta con el codigo REAL del backend (Api -> permisos -> UbicacionCorreccionService -> repositorio con hojas en memoria -> PozoExistenciaService -> padron y
// carpeta ITF de un Drive en memoria): la PRIMERA UBICACION de un pozo, tanto en el padron sin coordenadas como FUERA del padron pero conocido por otra fuente institucional.
// Solo se simulan la sesion/usuarios, Sheets, Drive, el Historial y la fuente NE.
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const W = '04-0263';                    // en el padron, con coordenada
const W_SIN = '04-0100';                // en el padron, sin coordenada
const W_REVISAR = '04-0200';            // en el padron, fuentes en desacuerdo
const W_ITF = '04-0777';                // FUERA del padron, con ITF (el caso 14-0123)
const W_NE = '04-0888';                 // FUERA del padron, con punto NE
const W_NADA = '04-0999';               // FUERA del padron y sin ninguna evidencia
const W_PREVIA = '04-0555';             // FUERA del padron, sin ITF ni NE, pero con una correccion previa en la hoja

const OFICIAL = { estado: 'unica', fuente: 'reportePozos', x: 2500000, y: 6350000, lat: -32.9, lon: -68.8 };
const registro = (wellId, resuelta) => ({
  wellId,
  identificacion: { departamento: 'Guaymallen' },
  titularidad: { titular: 'TITULAR RESERVADO' },
  ubicacion: { coordenadas: resuelta.lat ? { x: resuelta.x, y: resuelta.y } : null, coordenadasProvincia: [], ubicacionResuelta: resuelta }
});
const padron04 = (extra) => JSON.stringify(Object.assign({
  [W]: registro(W, OFICIAL),
  [W_SIN]: registro(W_SIN, { estado: 'sinCoordenadas' }),
  [W_REVISAR]: registro(W_REVISAR, { estado: 'revisar', distanciaMaxima: 300 })
}, extra || {}));
const METADATA = JSON.stringify({ generadoEl: '2026-09-14T12:58:36-03:00', fuente: { archivo: 'Reporte Pozos 09_2026.csv', periodo: '2026-09' } });

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'carla@x.com': { nombre: 'Carla', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'valeria@x.com': { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_validar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { ubicacion: true } },
  'sinubic@x.com': { nombre: 'Sin', permisos: { perfil: true, datos: true } }
};

// Drive en memoria: SOLO lectura. getFilesByName(nombre) devuelve el archivo si existe (el padron .json y los <wellId>.jpg de la carpeta ITF).
function crearDrive(archivos) {
  const escrituras = [];
  const estricto = (obj, nombre) => new Proxy(obj, {
    get(t, p) {
      if (p in t) { return t[p]; }
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'asymmetricMatch') { return undefined; }
      return () => { escrituras.push(nombre + '.' + String(p)); throw new Error('ESCRITURA PROHIBIDA: ' + String(p)); };
    }
  });
  const iter = (lista) => { let i = 0; return estricto({ hasNext: () => i < lista.length, next: () => lista[i++] }, 'iterador'); };
  const archivo = (texto) => estricto({ getBlob: () => estricto({ getDataAsString: () => texto }, 'blob') }, 'archivo');
  const consultas = [];
  const carpeta = estricto({
    getFilesByName: (n) => { consultas.push(n); if (archivos.__falla && /\.jpg$/.test(n)) { throw new Error('Drive caido'); } return iter(archivos[n] !== undefined ? [archivo(archivos[n])] : []); }
  }, 'carpeta');
  return { escrituras, consultas, archivos, DriveApp: estricto({ getFolderById: () => carpeta }, 'DriveApp') };
}

// RELOJ CONTROLADO. El backend toma el instante con `new Date()`; con el reloj real dos llamadas seguidas pueden recibir el MISMO milisegundo y entonces el desempate (orden de
// propuesta) decide en vez del instante de la validacion: el resultado dependia de la velocidad de la maquina. Se falsea SOLO Date (ningun timer: nada de esperas) y cada llamada a la
// API avanza el reloj un paso fijo, como pasa en la realidad (dos acciones nunca caen en el mismo instante). Un test que necesita un instante exacto lo fija con `enInstante`
// y, si necesita que dos acciones compartan instante, congela el avance con `congelarReloj`.
const RELOJ_INICIAL = Date.UTC(2026, 9, 21, 15, 0, 0);
const PASO_RELOJ_MS = 1000;
let relojAvanza = true;
const enInstante = (ms) => jest.setSystemTime(new Date(ms));
const congelarReloj = () => { relojAvanza = false; };
const TIMERS_REALES = ['hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
  'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'];

let Api;
let Repo;
let hojas;
let drive;
let historial;
let ne;
let lock;

beforeEach(() => {
  jest.useFakeTimers({ now: RELOJ_INICIAL, doNotFake: TIMERS_REALES });             // solo Date
  relojAvanza = true;
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };

  Api = require('../src/Api');
  const RegistryRepo = require('../src/RegistryRepository');
  const RegistryService = require('../src/RegistryService');
  Repo = require('../src/UbicacionCorreccionRepository');
  const Service = require('../src/UbicacionCorreccionService');
  const DriveProfile = require('../src/DriveProfileRepository');
  Object.assign(global, RegistryRepo, RegistryService, Repo, Service, DriveProfile);
  global.getRegistryFolderId = () => 'REGISTRO_E2E';
  global.getFolderId = () => 'ITF_E2E';

  drive = crearDrive({ '04.json': padron04(), 'metadata.json': METADATA, [W_ITF + '.jpg']: 'jpg-sin-leer' });
  global.DriveApp = drive.DriveApp;
  ne = { [W_NE]: { found: true, punto: { wellId: W_NE, coordenadas: { lat: -32.7, lon: -68.5 } } } };
  global.nivelesEstaticosRepository_getPunto = jest.fn((id) => ne[id] || { found: false });

  hojas = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS] });
  lock = { waits: 0 };
  global.LockService = { getScriptLock: () => ({ waitLock: () => { lock.waits += 1; }, releaseLock: () => {} }) };

  historial = [];
  global.logHistoryEvent = jest.fn((email, accion, wellId, resultado) => { historial.push([email, accion, wellId, resultado]); });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);
});

afterEach(() => {
  jest.useRealTimers();
});

const post = (usuario, cuerpo) => (relojAvanza ? enInstante(Date.now() + PASO_RELOJ_MS) : null, JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ sessionToken: 'tok-' + usuario }, cuerpo)) } }).text));
let n = 0;
const rid = () => 'e4-req-' + String(++n).padStart(8, '0');
const norte = (m) => Math.round((OFICIAL.lat + m / 111195) * 1e6) / 1e6;      // la hoja guarda 6 decimales
const OBS = 'Pozo de la red ITF que no figura en el padron actual.';
const proponer = (usuario, wellId, extra) => post(usuario, Object.assign({
  action: 'proponerCorreccionUbicacion', wellId, lat: norte(80), lon: OFICIAL.lon, metodo: 'GPS_ACTUAL', precisionGpsM: 9, observacion: '', clientRequestId: rid()
}, extra || {}));
const accionId = (action, usuario, id, motivo) => post(usuario, { action, correccionId: id, motivo });
const validar = (u, id) => accionId('validarCorreccionUbicacion', u, id, '');
const rechazar = (u, id, m) => accionId('rechazarCorreccionUbicacion', u, id, m || 'no coincide');
const revertir = (u, id, m) => accionId('revertirCorreccionUbicacion', u, id, m || 'error');
const porPozo = (u, wellId) => post(u, { action: 'getCorreccionesUbicacionPozo', wellId });
const ubicacion = (u, wellId) => post(u, { action: 'getWellLocation', wellId });
const registroDe = (u, wellId) => post(u, { action: 'getWellRecord', wellId });
const validadas = () => post('lector@x.com', { action: 'getUbicacionesValidadas' }).data.ubicaciones;
const cols = () => hojas.UbicacionCorrecciones.filas[0];
const fila = (i) => hojas.UbicacionCorrecciones.filas[i === undefined ? hojas.UbicacionCorrecciones.filas.length - 1 : i];
const celda = (nombre, i) => fila(i)[cols().indexOf(nombre)];
const filasEscritas = () => hojas.UbicacionCorrecciones.filas.length - 1;

describe('SNAPSHOT de Irrigacion: tres situaciones', () => {
  test('A. EN PADRON CON COORDENADA: comportamiento de siempre (coordenada, estado, fuente, distancia)', () => {
    const r = proponer('ana@x.com', W);
    expect(r.status).toBe('ok');
    expect([celda('irrEstado'), celda('irrFuente'), celda('padronPeriodo')]).toEqual(['unica', 'reportePozos', '2026-09']);
    expect(Number(celda('irrLat'))).toBeCloseTo(-32.9, 6);
    expect(Number(celda('distanciaM'))).toBeGreaterThan(70);
    expect(r.data.correccion.irrigacion).toMatchObject({ estado: 'unica', fuente: 'reportePozos' });
    expect(r.data.correccion).toMatchObject({ primeraUbicacion: false, candidataPrimeraUbicacion: false });
  });

  test('B. EN PADRON SIN COORDENADA: irrLat/irrLon vacios, sinCoordenadas, sin distancia ni advertencia; la observacion sigue siendo OPCIONAL', () => {
    const r = proponer('ana@x.com', W_SIN, { observacion: '' });
    expect(r.status).toBe('ok');
    expect([celda('irrLat'), celda('irrLon'), celda('irrEstado'), celda('distanciaM'), celda('advertenciaDistancia'), celda('padronPeriodo')]).toEqual(['', '', 'sinCoordenadas', '', '', '2026-09']);
    expect(r.data.correccion).toMatchObject({ distanciaM: null, advertenciaDistancia: false, irrigacion: { lat: null, lon: null, estado: 'sinCoordenadas' }, primeraUbicacion: false, candidataPrimeraUbicacion: true });
  });

  test('C. FUERA DEL PADRON pero existe por ITF: noEnPadron, sin coordenada, irrFuente vacia, periodo del padron actual, sin distancia ni advertencia', () => {
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS });
    expect(r.status).toBe('ok');
    expect([celda('wellId'), celda('irrLat'), celda('irrLon'), celda('irrEstado'), celda('irrFuente'), celda('padronPeriodo'), celda('distanciaM'), celda('advertenciaDistancia')])
      .toEqual([W_ITF, '', '', 'noEnPadron', '', '2026-09', '', '']);
    expect(r.data.correccion).toMatchObject({ estado: 'PROPUESTA', distanciaM: null, advertenciaDistancia: false, irrigacion: { lat: null, lon: null, estado: 'noEnPadron', fuente: '', padronPeriodo: '2026-09' }, primeraUbicacion: false, candidataPrimeraUbicacion: true });
  });

  test('C. FUERA DEL PADRON pero existe por NE: igual (la coordenada del punto NE NO se usa como Irrigacion)', () => {
    const r = proponer('ana@x.com', W_NE, { observacion: OBS });
    expect(r.status).toBe('ok');
    expect([celda('irrLat'), celda('irrLon'), celda('irrEstado')]).toEqual(['', '', 'noEnPadron']);
    expect(JSON.stringify(r)).not.toMatch(/-32\.7|-68\.5/);
  });

  test('C. FUERA DEL PADRON con una correccion previa como unica evidencia: se puede seguir corrigiendo', () => {
    // la primera ubicacion se creo cuando existia el ITF; despues el ITF desaparece
    expect(proponer('ana@x.com', W_ITF, { observacion: OBS }).status).toBe('ok');
    delete drive.archivos[W_ITF + '.jpg'];
    global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };           // vence el cache de 10 minutos
    const r = proponer('ana@x.com', W_ITF, { observacion: 'Segunda toma', lat: norte(95) });
    expect(r.status).toBe('ok');
    expect(celda('irrEstado')).toBe('noEnPadron');
  });

  test('C. no hay inventos: la propuesta guarda la coordenada ingresada y NINGUNA otra (ni irrLat/irrLon, ni distancia)', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    const f = fila();
    expect(cols().map((c, i) => [c, f[i]]).filter(([c]) => ['irrLat', 'irrLon', 'distanciaM'].indexOf(c) !== -1).every(([, v]) => v === '')).toBe(true);
    expect(Number(celda('lat'))).toBeCloseTo(norte(80), 6);
  });

  test('no existe en ninguna fuente: WELL_NOT_FOUND y no se escribe nada', () => {
    const r = proponer('ana@x.com', W_NADA, { observacion: OBS });
    expect(r).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(filasEscritas()).toBe(0);
  });

  test('una fuente no se pudo verificar y ninguna confirma: SERVICE_UNAVAILABLE (un error de Drive no es "no existe") y no se escribe nada', () => {
    drive.archivos.__falla = true;
    const r = proponer('ana@x.com', W_NADA, { observacion: OBS });
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(filasEscritas()).toBe(0);
  });

  test('la evidencia de existencia queda en Logger (sin datos personales) y NO en la hoja', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    const logs = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(logs).toContain('el pozo ' + W_ITF + ' no figura en el padron; existe por ITF');
    expect(logs).not.toMatch(/ana@x\.com/);
    expect(JSON.stringify(hojas.UbicacionCorrecciones.filas)).not.toMatch(/ITF'|"ITF"/);
  });

  test('el padron se consulta una sola vez por propuesta y la carpeta ITF solo por nombre de archivo (nunca se lee el JPG)', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    expect(drive.consultas.filter((x) => x === W_ITF + '.jpg')).toHaveLength(1);
    expect(drive.escrituras).toEqual([]);
  });
});

describe('OBSERVACION: obligatoria solo fuera del padron', () => {
  test.each([[''], ['   '], ['\n\t ']])('noEnPadron con observacion %j: OBSERVACION_REQUERIDA con el mensaje humano y no se escribe nada', (obs) => {
    const r = proponer('ana@x.com', W_ITF, { observacion: obs });
    expect(r).toMatchObject({ status: 'error', code: 'OBSERVACION_REQUERIDA', message: 'Indicá por qué se incorpora una ubicación para un pozo que no figura en el padrón actual.' });
    expect(filasEscritas()).toBe(0);
  });

  test('noEnPadron SIN el campo observacion: tambien se exige', () => {
    const r = post('ana@x.com', { action: 'proponerCorreccionUbicacion', wellId: W_ITF, lat: norte(80), lon: OFICIAL.lon, metodo: 'GPS_ACTUAL', precisionGpsM: 9, clientRequestId: rid() });
    expect(r).toMatchObject({ status: 'error', code: 'OBSERVACION_REQUERIDA' });
  });

  test('con observacion se guarda (y queda escrita tal cual en la hoja)', () => {
    expect(proponer('ana@x.com', W_ITF, { observacion: OBS }).status).toBe('ok');
    expect(celda('observacion')).toBe(OBS);
  });

  test.each([['sinCoordenadas', W_SIN], ['revisar', W_REVISAR]])('pozo del padron (%s): observacion OPCIONAL', (_e, wellId) => {
    expect(proponer('ana@x.com', wellId, { observacion: '' }).status).toBe('ok');
  });

  test('no se aplican reglas de distancia: un punto lejano (a mas de 1 km del centro de todo) se acepta sin advertencia', () => {
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS, lat: -33.9, lon: -68.2 });
    expect(r.status).toBe('ok');
    expect(r.data.correccion).toMatchObject({ distanciaM: null, advertenciaDistancia: false });
  });

  test('con observacion obligatoria la regla de 250 m del padron sigue intacta (pozo en el padron lejos de Irrigacion exige observacion)', () => {
    const r = proponer('ana@x.com', W, { lat: norte(400), observacion: '' });
    expect(r).toMatchObject({ status: 'error', code: 'OBSERVACION_REQUERIDA' });
    expect(r.message).toMatch(/250 m/);
  });

  test('un reintento idempotente de una propuesta ya guardada NO vuelve a exigir nada ni a escribir otra fila', () => {
    const id = rid();
    expect(proponer('ana@x.com', W_ITF, { observacion: OBS, clientRequestId: id }).status).toBe('ok');
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS, clientRequestId: id });
    expect(r).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(filasEscritas()).toBe(1);
  });
});

describe('PERMISOS (no se amplian)', () => {
  test('corregir + validar: la primera ubicacion se AUTOVALIDA y pasa a V', () => {
    const r = proponer('carla@x.com', W_ITF, { observacion: OBS });
    expect(r).toMatchObject({ status: 'ok', data: { autoValidada: true, correccion: { estado: 'VALIDADA', primeraUbicacion: true } } });
    expect(validadas()).toEqual([expect.objectContaining({ wellId: W_ITF, lat: norte(80) })]);
  });

  test('corregir sin validar: queda PROPUESTA y NO cambia nada operativo', () => {
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS });
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(r.data.autoValidada).toBeUndefined();
    expect(validadas()).toEqual([]);
  });

  test('validar sin corregir: NO puede originar una (PERMISSION_DENIED) pero SI validar la ajena', () => {
    expect(proponer('valeria@x.com', W_ITF, { observacion: OBS })).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(filasEscritas()).toBe(0);
    const id = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    const v = validar('valeria@x.com', id);
    expect(v).toMatchObject({ status: 'ok', data: { correccion: { estado: 'VALIDADA', primeraUbicacion: true } } });
    expect(validadas().map((u) => u.wellId)).toEqual([W_ITF]);
  });

  test.each([['lector@x.com'], ['sinubic@x.com']])('%s (solo ubicacion / sin ubicacion) no puede proponer, ni siquiera para un pozo fuera del padron', (u) => {
    expect(proponer(u, W_ITF, { observacion: OBS })).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(filasEscritas()).toBe(0);
    expect(drive.consultas.filter((c) => /\.jpg$/.test(c))).toEqual([]);              // sin permiso ni siquiera se verifica la existencia
  });

  test('un usuario sin sesion o con token invalido no llega a verificar nada', () => {
    const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify({ action: 'proponerCorreccionUbicacion', sessionToken: 'basura', wellId: W_ITF }) } }).text);
    expect(r.status).toBe('error');
    expect(drive.consultas.filter((c) => /\.jpg$/.test(c))).toEqual([]);
  });

  test('una validada por quien no es autor, y rechazar la propia sigue vedado (las reglas de siempre no cambian)', () => {
    const id = proponer('carla@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    expect(rechazar('carla@x.com', id)).toMatchObject({ status: 'error' });
  });
});

describe('getWellLocation de un pozo FUERA del padron', () => {
  test('fuera del padron + ITF => ok con la vista minima noEnPadron (sin coordenadas, sin ficha) y queda auditado', () => {
    const r = ubicacion('lector@x.com', W_ITF);
    expect(r).toEqual({ status: 'ok', data: { wellId: W_ITF, coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'noEnPadron' } } });
    expect(historial).toContainEqual(['lector@x.com', 'getWellLocation', W_ITF, 'OK_NO_EN_PADRON']);
  });

  test('fuera del padron + NE => ok noEnPadron', () => {
    expect(ubicacion('lector@x.com', W_NE)).toMatchObject({ status: 'ok', data: { ubicacionResuelta: { estado: 'noEnPadron' } } });
  });

  test('fuera del padron + correccion previa => ok noEnPadron', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    delete drive.archivos[W_ITF + '.jpg'];
    global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };
    expect(ubicacion('lector@x.com', W_ITF)).toMatchObject({ status: 'ok', data: { ubicacionResuelta: { estado: 'noEnPadron' } } });
  });

  test('fuera del padron sin ninguna evidencia => WELL_LOCATION_NOT_FOUND (como siempre)', () => {
    expect(ubicacion('lector@x.com', W_NADA)).toMatchObject({ status: 'error', code: 'WELL_LOCATION_NOT_FOUND' });
    expect(historial).toContainEqual(['lector@x.com', 'getWellLocation', W_NADA, 'WELL_LOCATION_NOT_FOUND']);
  });

  test('indeterminado (el ITF no se pudo consultar y nadie mas confirma) => SERVICE_UNAVAILABLE, no NOT_FOUND', () => {
    drive.archivos.__falla = true;
    expect(ubicacion('lector@x.com', W_NADA)).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
  });

  test('un pozo del padron sigue devolviendo SU ubicacion real (el fallback no lo toca) y sin consultar ITF ni NE', () => {
    const r = ubicacion('lector@x.com', W);
    expect(r.status).toBe('ok');
    expect(r.data.ubicacionResuelta).toMatchObject({ estado: 'unica', lat: -32.9 });
    expect(drive.consultas.filter((c) => /\.jpg$/.test(c))).toEqual([]);
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
  });

  test('un pozo del padron SIN coordenadas sigue siendo sinCoordenadas (no noEnPadron)', () => {
    expect(ubicacion('lector@x.com', W_SIN).data.ubicacionResuelta.estado).toBe('sinCoordenadas');
  });

  test('getWellRecord NO cambia: el pozo fuera del padron sigue sin ficha (WELL_RECORD_NOT_FOUND)', () => {
    const permisos = Object.assign({}, USUARIOS['lector@x.com'].permisos, { datos: true });
    USUARIOS['lector@x.com'].permisos = permisos;
    expect(registroDe('lector@x.com', W_ITF)).toMatchObject({ status: 'error', code: 'WELL_RECORD_NOT_FOUND' });
  });

  test('sin el permiso ubicacion: PERMISSION_DENIED y no se verifica nada (el orden de chequeos no cambia)', () => {
    expect(ubicacion('sinubic@x.com', W_ITF)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(drive.consultas.filter((c) => /\.jpg$/.test(c))).toEqual([]);
  });

  test('wellId invalido: INVALID_WELL_ID antes de cualquier verificacion', () => {
    expect(ubicacion('lector@x.com', '04-777')).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
    expect(ubicacion('lector@x.com', '25-0001')).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
    expect(drive.consultas.filter((c) => /\.jpg$/.test(c))).toEqual([]);
  });

  test('un pozo fuera del padron NO se vuelve "del padron" por ser consultado: las decisiones sobre fuentes registrales siguen exigiendo padron', () => {
    const Decisiones = require('../src/UbicacionFuenteDecisionesService');
    expect(Decisiones.ubicacionFuenteDecisionesService_padron(W_ITF)).toMatchObject({ ok: false });
  });
});

describe('PRIMERA UBICACION: dos marcas distintas, derivadas del log append-only (sin columna nueva)', () => {
  // {correccionId: [primeraUbicacion, candidataPrimeraUbicacion]} de la lectura por pozo (la que ve cualquier usuario con `ubicacion`)
  const marcas = (wellId) => new Map(porPozo('lector@x.com', wellId).data.historial.map((c) => [c.correccionId, [c.primeraUbicacion, c.candidataPrimeraUbicacion]]));
  const flags = (c) => [c.primeraUbicacion, c.candidataPrimeraUbicacion];
  const SIN = [false, false];
  // instante (ISO) del evento `evento` de una correccion, tal cual quedo en el log append-only
  const celdaDeEvento = (correccionId, evento) => {
    const log = hojas.UbicacionCorreccionesLog.filas;
    const c = log[0];
    const f = log.slice(1).filter((r) => r[c.indexOf('correccionId')] === correccionId && r[c.indexOf('evento')] === evento).pop();
    const ts = f[c.indexOf('timestamp')];
    return ts instanceof Date ? ts.toISOString() : String(ts);
  };

  test('no hay columna nueva: el esquema de las hojas es el mismo', () => {
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS).not.toContain('primeraUbicacion');
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS).not.toContain('candidataPrimeraUbicacion');
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS).toContain('irrEstado');
  });

  test('las dos marcas son booleanos en TODA vista de correccion (payload minimo: nada interno mas)', () => {
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion;
    expect(typeof r.primeraUbicacion).toBe('boolean');
    expect(typeof r.candidataPrimeraUbicacion).toBe('boolean');
    expect(Object.keys(r).filter((k) => /primera|candidata/i.test(k)).sort()).toEqual(['candidataPrimeraUbicacion', 'primeraUbicacion']);
  });

  test('A. primera PENDIENTE: candidata = true, primera = false (en la respuesta, en la lectura por pozo y en la cola de la bandeja)', () => {
    const r = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion;
    expect(flags(r)).toEqual([false, true]);
    expect(flags(porPozo('lector@x.com', W_ITF).data.pendientes[0])).toEqual([false, true]);
    const cola = post('valeria@x.com', { action: 'getCorreccionesUbicacionPendientes' });
    expect(cola.data.pendientes.map((c) => [c.correccionId, ...flags(c)])).toEqual([[r.correccionId, false, true]]);
  });

  test('dos propuestas pendientes de un pozo sin V historica son AMBAS candidatas; ninguna es primera todavia', () => {
    const p1 = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion;
    const p2 = proponer('ana@x.com', W_ITF, { observacion: 'otra', lat: norte(100) }).data.correccion;
    expect([flags(p1), flags(p2)]).toEqual([[false, true], [false, true]]);
    expect([...marcas(W_ITF).values()]).toEqual([[false, true], [false, true]]);
  });

  // La regla (derivada del log): manda el INSTANTE del evento VALIDADA; solo si dos VALIDADA tienen exactamente el mismo instante desempata el orden de propuesta.
  describe('que validacion es la primera: el instante manda; el orden de propuesta solo desempata un empate exacto', () => {
    const propuestas = () => ({
      viejo: proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId,
      nuevo: proponer('ana@x.com', W_ITF, { observacion: 'otra', lat: norte(100) }).data.correccion.correccionId
    });

    test.each([
      ['se valida PRIMERO la propuesta mas NUEVA', 'nuevo', 'viejo'],
      ['se valida PRIMERO la propuesta mas ANTIGUA', 'viejo', 'nuevo']
    ])('A. tiempos distintos (%s): la que recibio VALIDADA en T1 es la primera, la otra (T2 > T1) no; el orden de propuesta no altera nada', (n, primero, segundo) => {
      const ids = propuestas();
      const T1 = RELOJ_INICIAL + 60 * 60 * 1000;
      const T2 = T1 + 5 * 60 * 1000;
      congelarReloj();
      enInstante(T1);
      expect(flags(validar('valeria@x.com', ids[primero]).data.correccion)).toEqual([true, false]);
      expect(celdaDeEvento(ids[primero], 'VALIDADA')).toBe(new Date(T1).toISOString());
      let m = marcas(W_ITF);
      expect(m.get(ids[primero])).toEqual([true, false]);
      expect(m.get(ids[segundo])).toEqual(SIN);                                         // sigue pendiente, pero ya hubo una V: ni primera ni candidata
      enInstante(T2);
      expect(flags(validar('valeria@x.com', ids[segundo]).data.correccion)).toEqual(SIN);        // validada despues (T2 > T1): no es la primera
      expect(celdaDeEvento(ids[segundo], 'VALIDADA')).toBe(new Date(T2).toISOString());
      m = marcas(W_ITF);
      expect(m.get(ids[primero])).toEqual([true, false]);                                // la primera conserva la marca (aunque la supere la otra)
      expect(m.get(ids[segundo])).toEqual(SIN);
    });

    test('B. MISMO MILISEGUNDO: ambas VALIDADA con exactamente el mismo instante -> desempata el orden de propuesta y gana la propuesta MAS ANTIGUA (regla de desempate)', () => {
      const ids = propuestas();
      const T = RELOJ_INICIAL + 60 * 60 * 1000;
      congelarReloj();
      enInstante(T);
      expect(flags(validar('valeria@x.com', ids.nuevo).data.correccion)).toEqual([true, false]);       // validada primero (sola, todavia es la primera)
      expect(flags(validar('valeria@x.com', ids.viejo).data.correccion)).toEqual([true, false]);       // mismo instante exacto: la mas antigua pasa a ser la primera
      expect(celdaDeEvento(ids.nuevo, 'VALIDADA')).toBe(celdaDeEvento(ids.viejo, 'VALIDADA'));          // el empate es real: el mismo instante
      const m = marcas(W_ITF);
      expect(m.get(ids.viejo)).toEqual([true, false]);
      expect(m.get(ids.nuevo)).toEqual(SIN);                                                          // la mas nueva ya no lo es: ocurrio en el mismo instante, despues en el orden de propuesta
    });
  });

  test('B. primera RECHAZADA: ni primera ni candidata (resuelta); no consume el concepto: la siguiente vuelve a ser candidata y, validada, la primera', () => {
    const p1 = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    expect(flags(rechazar('valeria@x.com', p1).data.correccion)).toEqual(SIN);
    expect(marcas(W_ITF).get(p1)).toEqual(SIN);
    const p2 = proponer('ana@x.com', W_ITF, { observacion: OBS, lat: norte(120) }).data.correccion;
    expect(flags(p2)).toEqual([false, true]);
    expect(flags(validar('valeria@x.com', p2.correccionId).data.correccion)).toEqual([true, false]);
    expect(marcas(W_ITF).get(p1)).toEqual(SIN);                                         // la rechazada nunca fue ni sera la primera
  });

  test('C. primera VALIDADA (por un validador): primera = true; ya no es candidata (esta resuelta)', () => {
    const id = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    expect(flags(validar('valeria@x.com', id).data.correccion)).toEqual([true, false]);
    expect(flags(porPozo('lector@x.com', W_ITF).data.vigente)).toEqual([true, false]);
    expect(validadas().map((u) => u.wellId)).toEqual([W_ITF]);
  });

  test('D. primera AUTOVALIDADA: primera = true (no existio ninguna VALIDADA anterior)', () => {
    const r = proponer('carla@x.com', W_ITF, { observacion: OBS });
    expect(r.data.autoValidada).toBe(true);
    expect(r.data.correccion).toMatchObject({ estado: 'VALIDADA', primeraUbicacion: true, candidataPrimeraUbicacion: false });
    expect(flags(porPozo('lector@x.com', W_ITF).data.vigente)).toEqual([true, false]);
  });

  test('E. primera validada y luego REVERTIDA: SIGUE siendo historicamente la primera; el pozo ya no tiene candidata (la marca no vuelve a quedar disponible)', () => {
    const v1 = proponer('carla@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    expect(flags(revertir('valeria@x.com', v1).data.correccion)).toEqual([true, false]);       // y la respuesta de revertir ya lo dice
    expect(validadas()).toEqual([]);                                                            // revertida: ya no es operativa...
    expect(marcas(W_ITF).get(v1)).toEqual([true, false]);                                       // ...pero fue la primera
    const p2 = proponer('ana@x.com', W_ITF, { observacion: OBS, lat: norte(90) }).data.correccion;
    expect(flags(p2)).toEqual(SIN);                                                             // G. segunda propuesta tras una V historica: ni candidata ni primera
    expect(flags(validar('valeria@x.com', p2.correccionId).data.correccion)).toEqual(SIN);      // H. segunda V: no es primera
    expect(flags(proponer('carla@x.com', W_ITF, { observacion: 'otra', lat: norte(60) }).data.correccion)).toEqual(SIN);
    expect([...marcas(W_ITF).values()].filter(([primera]) => primera)).toHaveLength(1);          // una sola primera en toda la historia
    expect(marcas(W_ITF).get(v1)).toEqual([true, false]);
  });

  test('F. primera validada y luego SUPERADA por otra: solo la primera conserva primeraUbicacion (respuesta y relectura); la que la supera no', () => {
    const v1 = proponer('carla@x.com', W_ITF, { observacion: OBS }).data.correccion;
    const v2 = proponer('carla@x.com', W_ITF, { observacion: 'La mueve', lat: norte(150) }).data;
    expect(v2.supersedidas).toEqual([v1.correccionId]);
    expect(flags(v2.correccion)).toEqual(SIN);                                                  // H. segunda V
    const m = marcas(W_ITF);
    expect(m.get(v1.correccionId)).toEqual([true, false]);
    expect(m.get(v2.correccion.correccionId)).toEqual(SIN);
    expect(porPozo('lector@x.com', W_ITF).data.historial.find((c) => c.correccionId === v1.correccionId).estado).toBe('SUPERADA');
  });

  test('G. una propuesta sobre un pozo con una V VIGENTE: ni candidata ni primera', () => {
    proponer('carla@x.com', W_ITF, { observacion: OBS });
    const p2 = proponer('ana@x.com', W_ITF, { observacion: 'Correccion de la anterior', lat: norte(140) }).data.correccion;
    expect(flags(p2)).toEqual(SIN);
  });

  test('H. toda V posterior a la primera es false, tambien por la cola de pendientes y al releer', () => {
    proponer('carla@x.com', W_ITF, { observacion: OBS });
    const p2 = proponer('ana@x.com', W_ITF, { observacion: 'x', lat: norte(70) }).data.correccion.correccionId;
    const cola = post('valeria@x.com', { action: 'getCorreccionesUbicacionPendientes' });
    expect(cola.data.pendientes.map((c) => [c.correccionId, ...flags(c)])).toEqual([[p2, false, false]]);
    expect(flags(validar('valeria@x.com', p2).data.correccion)).toEqual(SIN);
  });

  test('un pozo del padron sin coordenadas: la primera que llega a V lo es; despues, ninguna', () => {
    const p1 = proponer('ana@x.com', W_SIN).data.correccion;
    expect(flags(p1)).toEqual([false, true]);
    expect(flags(validar('valeria@x.com', p1.correccionId).data.correccion)).toEqual([true, false]);
    expect(flags(proponer('ana@x.com', W_SIN, { lat: norte(60) }).data.correccion)).toEqual(SIN);
  });

  test('un pozo del padron CON coordenada, o con fuentes en desacuerdo (revisar), nunca tiene estas marcas: tenia ubicaciones', () => {
    expect(flags(proponer('ana@x.com', W).data.correccion)).toEqual(SIN);
    expect(flags(proponer('ana@x.com', W_REVISAR).data.correccion)).toEqual(SIN);
    expect(flags(proponer('carla@x.com', W, { lat: norte(60) }).data.correccion)).toEqual(SIN);        // ni autovalidada
  });

  test('las correcciones de OTRO pozo no influyen', () => {
    proponer('carla@x.com', W_NE, { observacion: OBS });
    expect(flags(proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion)).toEqual([false, true]);
  });

  test('un reintento idempotente devuelve las mismas marcas', () => {
    const id = rid();
    const a = proponer('ana@x.com', W_ITF, { observacion: OBS, clientRequestId: id }).data.correccion;
    const b = proponer('ana@x.com', W_ITF, { observacion: OBS, clientRequestId: id }).data;
    expect(b.duplicada).toBe(true);
    expect(flags(b.correccion)).toEqual(flags(a));
    const c = proponer('carla@x.com', W_NE, { observacion: OBS, clientRequestId: 'idem-0000001' }).data.correccion;
    expect(flags(proponer('carla@x.com', W_NE, { observacion: OBS, clientRequestId: 'idem-0000001' }).data.correccion)).toEqual(flags(c));
  });

  test('las marcas son del HISTORIAL: no cambian al releer ni por eventos que no son una validacion (rechazar otra propuesta)', () => {
    const p1 = proponer('ana@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    validar('valeria@x.com', p1);
    const antes = JSON.stringify([...marcas(W_ITF)]);
    const p2 = proponer('ana@x.com', W_ITF, { observacion: 'Otra', lat: norte(70) }).data.correccion.correccionId;
    rechazar('valeria@x.com', p2);
    expect(marcas(W_ITF).get(p1)).toEqual([true, false]);
    expect(JSON.parse(antes).find(([id]) => id === p1)[1]).toEqual([true, false]);
  });

  test('J. filas historicas SIN irrEstado ni irrLat (hojas viejas) o con log vacio no rompen la vista ni la derivacion (fail-safe: false)', () => {
    const f = new Array(cols().length).fill('');
    cols().forEach((c, i) => { if (c === 'correccionId') { f[i] = '11111111-1111-4111-8111-111111111111'; } if (c === 'wellId') { f[i] = W_ITF; } if (c === 'lat') { f[i] = norte(50); } if (c === 'lon') { f[i] = OFICIAL.lon; } if (c === 'metodo') { f[i] = 'GPS_ACTUAL'; } if (c === 'timestamp') { f[i] = new Date(2026, 0, 1); } });
    hojas.UbicacionCorrecciones.filas.push(f);
    const r = porPozo('lector@x.com', W_ITF);
    expect(r.status).toBe('ok');
    expect(r.data.historial[0]).toMatchObject({ estado: 'INCONSISTENTE', primeraUbicacion: false, candidataPrimeraUbicacion: false });
  });

  describe('funciones puras (esPrimeraUbicacion / esCandidataPrimeraUbicacion): historial, orden y fail-safe', () => {
    const S = () => require('../src/UbicacionCorreccionService');
    const T0 = '2026-10-01T10:00:00.000Z';
    const T1 = '2026-10-01T11:00:00.000Z';
    const T2 = '2026-10-01T12:00:00.000Z';
    const base = { wellId: W_ITF, irrLat: null, irrLon: null, irrEstado: 'noEnPadron' };
    const ev = (evento, timestamp) => ({ evento, timestamp, motivo: '' });
    const corr = (id, orden, estado, eventos, extra) => Object.assign({}, base, { correccionId: id, orden, estado, timestamp: T0, eventos }, extra || {});
    const primera = (c, lista) => S().ubicacionCorreccionService_esPrimeraUbicacion(c, lista);
    const candidata = (c, lista) => S().ubicacionCorreccionService_esCandidataPrimeraUbicacion(c, lista);
    const validada = (id, orden, tv, extra) => corr(id, orden, 'VALIDADA', [ev('PROPUESTA', T0), ev('VALIDADA', tv)], extra);
    const pendiente = (id, orden, extra) => corr(id, orden, 'PROPUESTA', [ev('PROPUESTA', T0)], extra);

    test('primera: necesita un evento VALIDADA propio; pendiente, rechazada, sin eventos -> false', () => {
      expect(primera(pendiente('c', 0), [])).toBe(false);
      expect(primera(corr('c', 0, 'RECHAZADA', [ev('PROPUESTA', T0), ev('RECHAZADA', T1)]), [])).toBe(false);
      expect(primera(corr('c', 0, 'PROPUESTA', []), [])).toBe(false);
      expect(primera(validada('c', 0, T1), [])).toBe(true);
    });

    test('primera: el estado ACTUAL no importa, el hecho ya ocurrio (VALIDADA, REVERTIDA y SUPERADA conservan la marca)', () => {
      expect(primera(validada('c', 0, T1), [])).toBe(true);
      expect(primera(corr('c', 0, 'REVERTIDA', [ev('PROPUESTA', T0), ev('VALIDADA', T1), ev('REVERTIDA', T2)]), [])).toBe(true);
      expect(primera(corr('c', 0, 'SUPERADA', [ev('PROPUESTA', T0), ev('VALIDADA', T1), ev('SUPERADA', T2)]), [])).toBe(true);
    });

    test('primera: una V POSTERIOR no lo es (aunque la anterior este revertida o superada); la anterior no pierde la marca por la posterior', () => {
      const v1 = corr('v1', 0, 'REVERTIDA', [ev('PROPUESTA', T0), ev('VALIDADA', T0), ev('REVERTIDA', T1)]);
      const v2 = validada('v2', 1, T2);
      expect(primera(v2, [v1, v2])).toBe(false);
      expect(primera(v1, [v1, v2])).toBe(true);
    });

    test('primera: gana la validacion MAS TEMPRANA, no la propuesta mas antigua (se valido primero la propuesta posterior)', () => {
      const p1 = validada('p1', 0, T2);                         // propuesta antes, validada despues
      const p2 = validada('p2', 1, T1);                         // propuesta despues, validada ANTES
      expect(primera(p2, [p1, p2])).toBe(true);
      expect(primera(p1, [p1, p2])).toBe(false);
    });

    test('I. MISMO INSTANTE: decide el orden de propuesta (`orden`); sin `orden` no se puede probar que fuera despues y no se afirma', () => {
      const a = validada('a', 0, T1);
      const b = validada('b', 1, T1);
      expect(primera(a, [a, b])).toBe(true);
      expect(primera(b, [a, b])).toBe(false);
      const sinOrden = (c) => Object.assign({}, c, { orden: undefined });
      expect(primera(sinOrden(a), [sinOrden(a), sinOrden(b)])).toBe(false);
      expect(primera(sinOrden(b), [sinOrden(a), sinOrden(b)])).toBe(false);
    });

    test('primera: una correccion nunca se cuenta a si misma (su propia VALIDADA no le quita la marca), con o sin `orden`', () => {
      expect(primera(validada('c', undefined, T1), [validada('c', undefined, T1)])).toBe(true);
      expect(primera(validada('c', 0, T1), [validada('c', 0, T1)])).toBe(true);
    });

    test('primera: un snapshot CON punto o con fuentes en desacuerdo nunca; sinCoordenadas y noEnPadron si', () => {
      ['unica', 'corroborada', 'revisar', 'revisarGrave', 'dudosoLeve', '', undefined].forEach((irrEstado) => {
        expect(primera(validada('c', 0, T1, { irrEstado }), [])).toBe(false);
        expect(candidata(pendiente('c', 0, { irrEstado }), [])).toBe(false);
      });
      expect(primera(validada('c', 0, T1, { irrLat: -32.9, irrLon: -68.8, irrEstado: 'sinCoordenadas' }), [])).toBe(false);
      ['sinCoordenadas', 'noEnPadron'].forEach((irrEstado) => {
        expect(primera(validada('c', 0, T1, { irrEstado }), [])).toBe(true);
        expect(candidata(pendiente('c', 0, { irrEstado }), [])).toBe(true);
      });
    });

    test('candidata: solo una PROPUESTA pendiente; rechazada, validada, superada o revertida -> false', () => {
      expect(candidata(pendiente('c', 0), [])).toBe(true);
      expect(candidata(corr('c', 0, 'RECHAZADA', [ev('PROPUESTA', T0), ev('RECHAZADA', T1)]), [])).toBe(false);
      ['VALIDADA', 'SUPERADA', 'REVERTIDA'].forEach((estado) => expect(candidata(corr('c', 0, estado, [ev('PROPUESTA', T0), ev('VALIDADA', T1)]), [])).toBe(false));
    });

    test('candidata: false si ALGUNA correccion del pozo llego jamas a VALIDADA (vigente, revertida o superada); las rechazadas y pendientes ajenas no cuentan', () => {
      const c = pendiente('c', 9);
      expect(candidata(c, [c, pendiente('p', 0), corr('r', 1, 'RECHAZADA', [ev('PROPUESTA', T0), ev('RECHAZADA', T1)])])).toBe(true);
      ['VALIDADA', 'REVERTIDA', 'SUPERADA'].forEach((estado) => {
        const d = corr('d', 0, estado, [ev('PROPUESTA', T0), ev('VALIDADA', T1), ev(estado, T2)]);
        expect(candidata(c, [d, c])).toBe(false);
      });
    });

    test('J. FAIL-SAFE: una correccion propia INCONSISTENTE no es primera ni candidata', () => {
      expect(primera(validada('c', 0, T1, { estado: 'INCONSISTENTE' }), [])).toBe(false);
      expect(candidata(pendiente('c', 0, { estado: 'INCONSISTENTE' }), [])).toBe(false);
    });

    test('J. FAIL-SAFE: una ajena INCONSISTENTE con un VALIDADA cuenta (el hecho ocurrio aunque su cadena no sea valida); sin VALIDADA no hay nada que contar', () => {
      const rota = corr('d', 0, 'INCONSISTENTE', [ev('VALIDADA', T0)]);                 // sin PROPUESTA inicial
      const c = validada('c', 1, T1);
      expect(primera(c, [rota, c])).toBe(false);
      expect(candidata(pendiente('p', 1), [rota, pendiente('p', 1)])).toBe(false);
      const sinValidada = corr('e', 0, 'INCONSISTENTE', []);
      expect(primera(c, [sinValidada, c])).toBe(true);
      expect(candidata(pendiente('p', 1), [sinValidada, pendiente('p', 1)])).toBe(true);
    });

    test('J. FAIL-SAFE: un VALIDADA ajeno sin instante legible cuenta como anterior; uno propio sin instante legible no se afirma', () => {
      [null, undefined, ''].forEach((ts) => {
        const d = corr('d', 0, 'VALIDADA', [ev('VALIDADA', ts)]);
        expect(primera(validada('c', 1, T1), [d, validada('c', 1, T1)])).toBe(false);
      });
      [null, undefined, ''].forEach((ts) => expect(primera(corr('c', 0, 'VALIDADA', [ev('VALIDADA', ts)]), [])).toBe(false));
      expect(primera(corr('c', 0, 'VALIDADA', [ev('VALIDADA', T1), ev('VALIDADA', '')]), [])).toBe(false);
    });

    test('J. entradas rotas no lanzan: lista nula, elementos nulos, eventos nulos', () => {
      const c = validada('c', 0, T1);
      expect(primera(c, null)).toBe(true);
      expect(primera(c, [null, undefined, c])).toBe(true);
      expect(primera(c, [Object.assign({}, base, { correccionId: 'd', eventos: [null, undefined, ev('VALIDADA', T0)] })])).toBe(false);
      expect(primera(null, [])).toBe(false);
      expect(candidata(null, [])).toBe(false);
      expect(candidata(pendiente('p', 0), null)).toBe(true);
      expect(candidata(pendiente('p', 0), [null, undefined])).toBe(true);
    });

    test('marcasPrimeraUbicacion agrupa por pozo: una V de otro pozo no afecta', () => {
      const a = validada('a', 0, T1, { wellId: W_ITF });
      const b = validada('b', 1, T1, { wellId: W_NE });
      const c = pendiente('c', 2, { wellId: W_NE });
      const m = S().ubicacionCorreccionService_marcasPrimeraUbicacion([a, b, c]);
      expect(Object.keys(m.primeras).sort()).toEqual(['a', 'b']);
      expect(Object.keys(m.candidatas)).toEqual([]);                    // W_NE ya tuvo una V
    });
  });
});

describe('V sin base registral y composicion con el resto de la app', () => {
  test('una primera ubicacion VALIDADA de un pozo fuera del padron sale en getUbicacionesValidadas con el payload minimo (sin autor, observacion ni snapshot)', () => {
    proponer('carla@x.com', W_ITF, { observacion: OBS });
    const v = validadas();
    expect(v).toHaveLength(1);
    expect(Object.keys(v[0]).sort()).toEqual(['lat', 'lon', 'vts', 'wellId']);
    expect(JSON.stringify(v)).not.toMatch(/carla|Pozo de la red|noEnPadron/);
  });

  test('el frontend compone sin base + V -> V (el pozo aparece en el dataset operativo, con base null y sin D/C/R)', () => {
    proponer('carla@x.com', W_ITF, { observacion: OBS });
    const uop = require('../../js/ubicacionOperativaLogic.js');
    const { pozos } = uop.ubicacionOperativaLogic_aplicarCapas([], [], validadas());
    expect(pozos).toHaveLength(1);
    expect(pozos[0]).toMatchObject({ wellId: W_ITF, estado: 'V', fuente: 'CAMPO', base: null });
    // y la ficha: sin padron ni decisiones, la V es el punto operativo
    const r = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W_ITF, ubicacionResuelta: { estado: 'noEnPadron' }, vigente: porPozo('lector@x.com', W_ITF).data.vigente, decisiones: null });
    expect(r).toMatchObject({ operativo: true, codigo: 'V', respaldoRegistral: null, registral: null });
  });

  test('una propuesta PENDIENTE no aparece en ninguna capa operativa', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    const uop = require('../../js/ubicacionOperativaLogic.js');
    expect(uop.ubicacionOperativaLogic_aplicarCapas([], [], validadas()).pozos).toEqual([]);
  });

  test('el estado noEnPadron lo conoce el dominio de la ficha sin romper (estado de padron desconocido hasta E4-2: sin punto, sin inventar)', () => {
    const uop = require('../../js/ubicacionOperativaLogic.js');
    const r = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W_ITF, ubicacionResuelta: { estado: 'noEnPadron' }, vigente: null, decisiones: null });
    expect(r).toMatchObject({ operativo: false, codigo: null, lat: null, lon: null });
  });
});

describe('REINDEXADO FUTURO: el padron incorpora el pozo despues de una primera ubicacion', () => {
  function nuevoPadronConElPozo() {
    drive.archivos['04.json'] = padron04({ [W_ITF]: registro(W_ITF, { estado: 'unica', fuente: 'reportePozos', x: 2500100, y: 6350100, lat: -32.89, lon: -68.79 }) });
    global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };           // un reindexado nuevo: cache vencido
  }

  test('la V sigue ganando, el historial NO cambia y la fila historica conserva noEnPadron para siempre', () => {
    const v1 = proponer('carla@x.com', W_ITF, { observacion: OBS }).data.correccion;
    const antes = JSON.stringify(hojas.UbicacionCorrecciones.filas);
    nuevoPadronConElPozo();
    expect(JSON.stringify(hojas.UbicacionCorrecciones.filas)).toBe(antes);              // nada se reescribe
    expect(validadas().map((u) => [u.wellId, u.lat])).toEqual([[W_ITF, norte(80)]]);      // V sigue vigente
    const lectura = porPozo('lector@x.com', W_ITF).data;
    expect(lectura.vigente).toMatchObject({ correccionId: v1.correccionId, primeraUbicacion: true, irrigacion: { estado: 'noEnPadron', lat: null } });
    expect(celda('irrEstado', 1)).toBe('noEnPadron');
  });

  test('getWellLocation ya devuelve la ubicacion REAL del padron (ya no es noEnPadron) y las nuevas propuestas se miden contra ella', () => {
    proponer('carla@x.com', W_ITF, { observacion: OBS });
    nuevoPadronConElPozo();
    expect(ubicacion('lector@x.com', W_ITF).data.ubicacionResuelta).toMatchObject({ estado: 'unica', lat: -32.89 });
    const r = proponer('ana@x.com', W_ITF, { observacion: '', lat: -32.8905, lon: -68.79 });
    expect(r.status).toBe('ok');
    expect(r.data.correccion.irrigacion).toMatchObject({ estado: 'unica', lat: -32.89 });
    expect(r.data.correccion).toMatchObject({ primeraUbicacion: false, candidataPrimeraUbicacion: false });          // ni sin punto previo, ni sin V
  });

  test('si se revierte la V, el pozo vuelve a la resolucion registral NUEVA (composicion E3), no a "sin ubicacion"', () => {
    const v1 = proponer('carla@x.com', W_ITF, { observacion: OBS }).data.correccion.correccionId;
    nuevoPadronConElPozo();
    expect(revertir('valeria@x.com', v1).status).toBe('ok');
    expect(validadas()).toEqual([]);
    const uop = require('../../js/ubicacionOperativaLogic.js');
    const base = [{ wellId: W_ITF, lat: -32.89, lon: -68.79, estado: 'D', cuenca: 'X', profundidad: null, tramosFiltrantes: [], surgencia: null }];
    expect(uop.ubicacionOperativaLogic_aplicarCapas(base, [], validadas()).pozos[0]).toMatchObject({ wellId: W_ITF, estado: 'D', lat: -32.89 });
  });
});

describe('compatibilidad y alcance', () => {
  test('NE operativo intacto: el punto NE solo se consulta para probar existencia (getPunto) y nada de NE se escribe ni se usa como coordenada', () => {
    proponer('ana@x.com', W_NE, { observacion: OBS });
    expect(global.nivelesEstaticosRepository_getPunto).toHaveBeenCalledWith(W_NE);
    expect(drive.escrituras).toEqual([]);
    ['NivelesEstaticosService.js', 'NivelesEstaticosRepository.js', 'MapaNEService.js'].forEach((f) => {
      expect(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).not.toMatch(/pozoExistencia|noEnPadron/);
    });
  });

  test('RegistryService / RegistryRepository no cambian: el helper vive aparte y el padron sigue siendo de solo lectura', () => {
    ['RegistryService.js', 'RegistryRepository.js'].forEach((f) => {
      expect(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).not.toMatch(/pozoExistencia|noEnPadron/);
    });
    expect(drive.escrituras).toEqual([]);
  });

  test('las decisiones y sugerencias sobre fuentes registrales no conocen el helper (siguen exigiendo padron)', () => {
    ['UbicacionFuenteDecisionesService.js', 'UbicacionFuenteSugerenciasService.js', 'UbicacionFuenteDecisionesLogic.js'].forEach((f) => {
      expect(fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')).not.toMatch(/pozoExistencia|noEnPadron/);
    });
  });

  test('la hoja no necesita migracion: irrEstado es texto libre y irrLat/irrLon ya aceptan vacio (se escribe y se vuelve a leer igual)', () => {
    proponer('ana@x.com', W_ITF, { observacion: OBS });
    const leida = Repo.ubicacionCorreccionRepository_listarCorrecciones()[0];
    expect(leida).toMatchObject({ wellId: W_ITF, irrLat: null, irrLon: null, irrEstado: 'noEnPadron', distanciaM: null, advertenciaDistancia: false });
  });
});
