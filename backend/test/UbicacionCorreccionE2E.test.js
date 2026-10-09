// De punta a punta con el codigo REAL de todos los eslabones de esta etapa:
//   Api.doPost -> handlers (permisos ubicacion / ubicacion_corregir / ubicacion_validar)
//   -> UbicacionCorreccionService -> UbicacionCorreccionRepository (hojas en memoria, LockService)
//   -> RegistryService / RegistryRepository REALES leyendo el padron de un Drive en memoria que es SOLO LECTURA:
//      cualquier intento de escribir en el padron (createFile, setContent, setTrashed...) lanza y queda registrado.
// Solo se simulan la sesion/usuarios, Sheets, Drive y la hoja Historial (logHistoryEvent).
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const W = '04-0263';
const W_SIN = '04-0100';
const W_REVISAR = '04-0200';

const OFICIAL = { estado: 'unica', fuente: 'reportePozos', x: 2500000, y: 6350000, lat: -32.9, lon: -68.8 };
const registro = (wellId, resuelta) => ({
  wellId,
  identificacion: { departamento: 'Guaymallen' },
  titularidad: { titular: 'TITULAR RESERVADO' },
  ubicacion: { coordenadas: resuelta.lat ? { x: resuelta.x, y: resuelta.y } : null, coordenadasProvincia: [], ubicacionResuelta: resuelta }
});
const PADRON_04 = JSON.stringify({
  [W]: registro(W, OFICIAL),
  [W_SIN]: registro(W_SIN, { estado: 'sinCoordenadas' }),
  [W_REVISAR]: registro(W_REVISAR, { estado: 'revisar', distanciaMaxima: 300 })
});
const METADATA = JSON.stringify({ generadoEl: '2026-09-14T12:58:36-03:00', fuente: { archivo: 'Reporte Pozos 09_2026.csv', periodo: '2026-09' } });

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'beto@x.com': { nombre: 'Beto', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'valeria@x.com': { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_validar: true } },
  'carla@x.com': { nombre: 'Carla', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { ubicacion: true } },
  'inactivo@x.com': { nombre: 'Inactivo', activo: false, permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } }
};

function crearDriveSoloLectura(archivos) {
  const escrituras = [];
  const estricto = (obj, nombre) => new Proxy(obj, {
    get(t, p) {
      if (p in t) { return t[p]; }
      if (typeof p === 'symbol' || p === 'then' || p === 'toJSON' || p === 'asymmetricMatch') { return undefined; }
      return () => { escrituras.push(nombre + '.' + String(p)); throw new Error('ESCRITURA PROHIBIDA en el padron: ' + String(p)); };
    }
  });
  const iter = (lista) => { let i = 0; return estricto({ hasNext: () => i < lista.length, next: () => lista[i++] }, 'iterador'); };
  const archivo = (texto) => estricto({ getBlob: () => estricto({ getDataAsString: () => texto }, 'blob') }, 'archivo');
  const carpeta = estricto({ getFilesByName: (n) => iter(archivos[n] !== undefined ? [archivo(archivos[n])] : []) }, 'carpeta');
  return { escrituras, DriveApp: estricto({ getFolderById: () => carpeta }, 'DriveApp') };
}

let Api;
let hojas;
let drive;
let historial;
let respuestas;
let lock;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };

  Api = require('../src/Api');
  const RegistryRepo = require('../src/RegistryRepository');
  const RegistryService = require('../src/RegistryService');
  const Repo = require('../src/UbicacionCorreccionRepository');
  const Service = require('../src/UbicacionCorreccionService');
  Object.assign(global, RegistryRepo, RegistryService, Repo, Service);
  global.getRegistryFolderId = () => 'REGISTRO_E2E';

  drive = crearDriveSoloLectura({ '04.json': PADRON_04, 'metadata.json': METADATA });
  global.DriveApp = drive.DriveApp;

  hojas = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS] });
  lock = { waits: 0, releases: 0 };
  global.LockService = { getScriptLock: () => ({ waitLock: () => { lock.waits += 1; }, releaseLock: () => { lock.releases += 1; } }) };

  historial = [];
  respuestas = [];
  global.logHistoryEvent = jest.fn((email, accion, wellId, resultado) => { historial.push([email, accion, wellId, resultado]); });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].activo !== false);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e] && USUARIOS[e].activo !== false, nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].activo !== false && USUARIOS[e].permisos[m] === true);
});

const post = (usuario, cuerpo) => {
  const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ sessionToken: 'tok-' + usuario }, cuerpo)) } }).text);
  respuestas.push(r);
  return r;
};
let n = 0;
const rid = () => 'e2e-req-' + String(++n).padStart(8, '0');
const norte = (m) => OFICIAL.lat + m / 111195;
const proponer = (usuario, extra, wellId) => post(usuario, Object.assign({
  action: 'proponerCorreccionUbicacion', wellId: wellId || W, lat: norte(80), lon: OFICIAL.lon, metodo: 'GPS_ACTUAL', precisionGpsM: 9, observacion: '', clientRequestId: rid()
}, extra || {}));
const accionId = (action, usuario, id, motivo) => post(usuario, { action, correccionId: id, motivo });
const validar = (u, id, m) => accionId('validarCorreccionUbicacion', u, id, m);
const rechazar = (u, id, m) => accionId('rechazarCorreccionUbicacion', u, id, m);
const revertir = (u, id, m) => accionId('revertirCorreccionUbicacion', u, id, m);
const porPozo = (u, wellId) => post(u, { action: 'getCorreccionesUbicacionPozo', wellId: wellId || W });
const celdas = (hoja, nombre) => hojas[hoja].filas.slice(1).map((f) => f[hojas[hoja].filas[0].indexOf(nombre)]);

describe('ciclo de vida completo por la API real', () => {
  test('proponer -> auto-validacion bloqueada -> validar -> otra propuesta supera a la vigente -> revertir', () => {
    // 1) Ana propone (GPS 9 m, a ~80 m de Irrigacion)
    const a = proponer('ana@x.com', { observacion: 'Boca corrida' });
    expect(a.status).toBe('ok');
    expect(a.data.duplicada).toBe(false);
    expect(a.data.correccion).toMatchObject({ wellId: W, estado: 'PROPUESTA', metodo: 'GPS_ACTUAL', precisionGpsM: 9, nombrePropone: 'Ana', propia: true });
    const idA = a.data.correccion.correccionId;

    // 2) Ana no puede validar (sin el permiso); Carla (con ambos) tampoco puede validar la suya
    expect(validar('ana@x.com', idA).code).toBe('PERMISSION_DENIED');
    const c = proponer('carla@x.com', {});
    expect(validar('carla@x.com', c.data.correccion.correccionId).code).toBe('SELF_VALIDATION');
    expect(rechazar('carla@x.com', c.data.correccion.correccionId, 'La retiro yo').code).toBe('SELF_REJECTION');   // el autor no rechaza la suya
    expect(rechazar('valeria@x.com', c.data.correccion.correccionId, 'No coincide con la boca').status).toBe('ok');

    // 3) Valeria valida
    const v = validar('valeria@x.com', idA, 'Confirmado con fotos');
    expect(v.status).toBe('ok');
    expect(v.data.correccion).toMatchObject({ estado: 'VALIDADA', resolucion: { evento: 'VALIDADA', nombre: 'Valeria', motivo: 'Confirmado con fotos' } });
    expect(porPozo('lector@x.com').data.vigente.correccionId).toBe(idA);

    // 4) Beto propone otra y Valeria la valida: la de Ana queda SUPERADA
    const b = proponer('beto@x.com', { observacion: 'Segunda visita' });
    const idB = b.data.correccion.correccionId;
    const v2 = validar('valeria@x.com', idB);
    expect(v2.data.supersedidas).toEqual([idA]);
    const estado = porPozo('lector@x.com').data;
    expect(estado.vigente.correccionId).toBe(idB);
    expect(estado.historial.find((x) => x.correccionId === idA).estado).toBe('SUPERADA');
    expect(estado.historial.filter((x) => x.estado === 'VALIDADA')).toHaveLength(1);

    // 5) se revierte la vigente: queda sin vigente y la superada NO revive
    expect(revertir('valeria@x.com', idB, 'Era otro pozo').status).toBe('ok');
    const final = porPozo('lector@x.com').data;
    expect(final.vigente).toBeNull();
    expect(final.historial.find((x) => x.correccionId === idA).estado).toBe('SUPERADA');
    expect(final.historial.find((x) => x.correccionId === idB).estado).toBe('REVERTIDA');
    expect(final.historial.find((x) => x.correccionId === c.data.correccion.correccionId).estado).toBe('RECHAZADA');

    // el log es append-only y conserva TODO, en orden
    expect(celdas('UbicacionCorreccionesLog', 'evento')).toEqual(['PROPUESTA', 'PROPUESTA', 'RECHAZADA', 'VALIDADA', 'PROPUESTA', 'SUPERADA', 'VALIDADA', 'REVERTIDA']);
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(4);        // encabezado + 3 propuestas
  });

  test('auditoria en Historial: propuesta, validacion, rechazo, reversion, permiso denegado y transicion invalida', () => {
    const a = proponer('ana@x.com');
    const id = a.data.correccion.correccionId;
    validar('ana@x.com', id);                                       // PERMISSION_DENIED
    validar('valeria@x.com', id);
    validar('valeria@x.com', id);                                   // INVALID_TRANSITION
    revertir('valeria@x.com', id, 'x');
    const b = proponer('beto@x.com');
    rechazar('valeria@x.com', b.data.correccion.correccionId, 'no');
    expect(historial).toEqual([
      ['ana@x.com', 'proponerCorreccionUbicacion', W, 'OK'],
      ['ana@x.com', 'validarCorreccionUbicacion', null, 'PERMISSION_DENIED'],
      ['valeria@x.com', 'validarCorreccionUbicacion', W, 'OK'],
      ['valeria@x.com', 'validarCorreccionUbicacion', W, 'INVALID_TRANSITION'],
      ['valeria@x.com', 'revertirCorreccionUbicacion', W, 'OK'],
      ['beto@x.com', 'proponerCorreccionUbicacion', W, 'OK'],
      ['valeria@x.com', 'rechazarCorreccionUbicacion', W, 'OK']
    ]);
  });
});

describe('el padron original NUNCA se escribe', () => {
  test('todo el ciclo no hace ninguna escritura en Drive y el padron sigue devolviendo la coordenada de Irrigacion', () => {
    const id = proponer('ana@x.com', { lat: norte(200), observacion: 'x' }).data.correccion.correccionId;
    validar('valeria@x.com', id);
    proponer('beto@x.com');
    revertir('valeria@x.com', id, 'x');
    expect(drive.escrituras).toEqual([]);

    // la ubicacion oficial (Ubicacion Irrigacion) sigue intacta, incluso con una correccion VALIDADA en curso
    const id2 = proponer('beto@x.com', { lat: norte(300), observacion: 'y' }).data.correccion.correccionId;
    validar('valeria@x.com', id2);
    const loc = Api.handleGetWellLocation('tok-ana@x.com', W);
    expect(loc.status).toBe('ok');
    expect(loc.data.ubicacionResuelta).toEqual(OFICIAL);
    expect(drive.escrituras).toEqual([]);
  });

  test('si algo intentara escribir en el padron, el Drive de la prueba lo detecta (control del propio test)', () => {
    expect(() => global.DriveApp.getFolderById('x').createFile('x')).toThrow(/ESCRITURA PROHIBIDA/);
    expect(drive.escrituras).toEqual(['carpeta.createFile']);
  });
});

describe('snapshot de Irrigacion desde el backend', () => {
  test('lo que mande el cliente sobre la ubicacion oficial se ignora; se guarda lo que dice el padron', () => {
    const r = proponer('ana@x.com', { irrLat: 1, irrLon: 2, irrEstado: 'corroborada', irrFuente: 'inventada', padronPeriodo: '1999-01', distanciaM: 0, estado: 'VALIDADA' });
    expect(r.status).toBe('ok');
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(celdas('UbicacionCorrecciones', 'irrLat')).toEqual([-32.9]);
    expect(celdas('UbicacionCorrecciones', 'irrLon')).toEqual([-68.8]);
    expect(celdas('UbicacionCorrecciones', 'irrEstado')).toEqual(['unica']);
    expect(celdas('UbicacionCorrecciones', 'irrFuente')).toEqual(['reportePozos']);
    expect(celdas('UbicacionCorrecciones', 'padronPeriodo')).toEqual(['2026-09']);
    expect(celdas('UbicacionCorrecciones', 'distanciaM')[0]).toBeGreaterThan(75);
  });

  test.each([[W_SIN, 'sinCoordenadas'], [W_REVISAR, 'revisar']])('pozo %s (%s): se puede proponer, distanciaM vacia y snapshot con lat/lon vacios', (wellId, estado) => {
    const r = proponer('ana@x.com', { lat: -34.2, lon: -69.1, observacion: '' }, wellId);
    expect(r.status).toBe('ok');
    expect(r.data.correccion.distanciaM).toBeNull();
    expect(celdas('UbicacionCorrecciones', 'irrLat')).toEqual(['']);
    expect(celdas('UbicacionCorrecciones', 'irrEstado')).toEqual([estado]);
    expect(celdas('UbicacionCorrecciones', 'distanciaM')).toEqual(['']);
  });

  test('pozo inexistente en el padron: WELL_NOT_FOUND y no se escribe nada', () => {
    const r = proponer('ana@x.com', {}, '04-0999');
    expect(r).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(1);
    expect(hojas.UbicacionCorreccionesLog.filas).toHaveLength(1);
  });
});

describe('validaciones de punta a punta', () => {
  test('GPS con mas de 50 m de precision: PRECISION_INSUFICIENTE, nada guardado y auditado', () => {
    const r = proponer('ana@x.com', { precisionGpsM: 63 });
    expect(r).toMatchObject({ status: 'error', code: 'PRECISION_INSUFICIENTE' });
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(1);
    expect(historial).toContainEqual(['ana@x.com', 'proponerCorreccionUbicacion', W, 'PRECISION_INSUFICIENTE']);
  });

  test('punto fuera de Mendoza: FUERA_DE_MENDOZA', () => {
    expect(proponer('ana@x.com', { lat: -34.6037, lon: -58.3816 }).code).toBe('FUERA_DE_MENDOZA');
    expect(proponer('ana@x.com', { lat: -33.4489, lon: -70.6693 }).code).toBe('FUERA_DE_MENDOZA');
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(1);
  });

  test('mas de 250 m sin observacion: OBSERVACION_REQUERIDA con la distancia; con observacion se guarda; a mas de 1 km queda la advertencia', () => {
    const sin = proponer('ana@x.com', { lat: norte(400), observacion: '' });
    expect(sin).toMatchObject({ status: 'error', code: 'OBSERVACION_REQUERIDA' });
    expect(sin.distanciaM).toBeGreaterThan(390);
    const con = proponer('ana@x.com', { lat: norte(400), observacion: 'La boca esta en el otro extremo del lote' });
    expect(con.status).toBe('ok');
    expect(con.data.correccion.advertenciaDistancia).toBe(false);
    const lejos = proponer('ana@x.com', { lat: norte(3000), observacion: 'Coordenada historica equivocada' });
    expect(lejos.status).toBe('ok');
    expect(lejos.data.correccion.advertenciaDistancia).toBe(true);
    expect(celdas('UbicacionCorrecciones', 'advertenciaDistancia')).toEqual(['', 'SI']);
  });

  test('observacion de 301 caracteres y metodo/clientRequestId invalidos', () => {
    expect(proponer('ana@x.com', { observacion: 'a'.repeat(301) }).code).toBe('INVALID_OBSERVACION');
    expect(proponer('ana@x.com', { metodo: 'MANUAL' }).code).toBe('INVALID_METODO');
    expect(proponer('ana@x.com', { clientRequestId: '' }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(proponer('ana@x.com', { metodo: 'PUNTO_EN_MAPA', precisionGpsM: 5 }).code).toBe('INVALID_PRECISION');
    expect(proponer('ana@x.com', { metodo: 'PUNTO_EN_MAPA', precisionGpsM: null }).status).toBe('ok');
  });
});

describe('reversion por la API real', () => {
  test('quien propuso (y hoy tiene ubicacion_validar) revierte lo que valido OTRO: queda auditada con usuario, nombre, fecha y motivo', () => {
    const id = proponer('carla@x.com', { observacion: 'ok' }).data.correccion.correccionId;
    expect(validar('carla@x.com', id).code).toBe('SELF_VALIDATION');
    expect(validar('valeria@x.com', id).status).toBe('ok');
    expect(revertir('carla@x.com', id, '').code).toBe('INVALID_MOTIVO');                  // motivo obligatorio
    const r = revertir('carla@x.com', id, 'Era el pozo de al lado');
    expect(r.status).toBe('ok');
    expect(r.data.correccion).toMatchObject({ estado: 'REVERTIDA', resolucion: { evento: 'REVERTIDA', nombre: 'Carla', motivo: 'Era el pozo de al lado' } });

    const fila = hojas.UbicacionCorreccionesLog.filas[hojas.UbicacionCorreccionesLog.filas.length - 1];
    const cols = hojas.UbicacionCorreccionesLog.filas[0];
    expect(fila[cols.indexOf('evento')]).toBe('REVERTIDA');
    expect(fila[cols.indexOf('email')]).toBe('carla@x.com');
    expect(fila[cols.indexOf('nombre')]).toBe('Carla');
    expect(fila[cols.indexOf('motivo')]).toBe('Era el pozo de al lado');
    expect(fila[cols.indexOf('timestamp')]).toBeInstanceOf(Date);
    expect(historial).toContainEqual(['carla@x.com', 'revertirCorreccionUbicacion', W, 'OK']);
    expect(historial).toContainEqual(['carla@x.com', 'revertirCorreccionUbicacion', null, 'INVALID_MOTIVO']);   // el motivo se valida antes de buscar la correccion
  });

  test('sin ubicacion_validar hoy, aunque haya sido quien propuso, NO puede revertir', () => {
    const id = proponer('ana@x.com').data.correccion.correccionId;
    validar('valeria@x.com', id);
    expect(revertir('ana@x.com', id, 'quiero deshacerlo')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(porPozo('lector@x.com').data.vigente.correccionId).toBe(id);
  });
});

describe('escritura parcial por la API real', () => {
  function fallarLogUnaVez() {
    const hoja = hojas.UbicacionCorreccionesLog;
    const original = hoja.getRange.bind(hoja);
    let fallo = false;
    hoja.getRange = (f, c, nf, nc) => {
      const r = original(f, c, nf, nc);
      return Object.assign({}, r, { setValues: (v) => { if (!fallo) { fallo = true; throw new Error('Sheets rechazo la escritura'); } return r.setValues(v); } });
    };
  }

  test('corte entre la correccion y su evento: SERVICE_UNAVAILABLE; queda inconsistente; el reintento (mismo clientRequestId) autocura', () => {
    fallarLogUnaVez();
    const cuerpo = { clientRequestId: 'corte-entre-hojas-01', observacion: 'ok' };
    const primero = proponer('ana@x.com', cuerpo);
    expect(primero).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
    expect(hojas.UbicacionCorreccionesLog.filas).toHaveLength(1);

    // mientras tanto NO es una propuesta valida: no aparece en la cola ni se puede validar
    const cola = post('valeria@x.com', { action: 'getCorreccionesUbicacionPendientes' });
    expect(cola.data).toMatchObject({ total: 0, inconsistentes: 1 });
    const id = celdas('UbicacionCorrecciones', 'correccionId')[0];
    expect(validar('valeria@x.com', id)).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(porPozo('lector@x.com').data.historial[0].estado).toBe('INCONSISTENTE');

    // el reintento cura
    const reintento = proponer('ana@x.com', cuerpo);
    expect(reintento.status).toBe('ok');
    expect(reintento.data).toMatchObject({ duplicada: true, curada: true });
    expect(reintento.data.correccion).toMatchObject({ correccionId: id, estado: 'PROPUESTA' });
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);                 // sin duplicar la correccion
    expect(celdas('UbicacionCorreccionesLog', 'evento')).toEqual(['PROPUESTA']);
    expect(historial.filter((h) => h[1] === 'proponerCorreccionUbicacion').map((h) => h[3])).toEqual(['SERVICE_UNAVAILABLE', 'AUTOCURADA']);
    expect(validar('valeria@x.com', id).status).toBe('ok');
  });
});

describe('idempotencia y concurrencia', () => {
  test('el mismo clientRequestId repetido por la API crea UNA sola correccion y se audita una sola vez', () => {
    const cuerpo = { clientRequestId: 'reintento-por-red-01' };
    const a = proponer('ana@x.com', cuerpo);
    const b = proponer('ana@x.com', cuerpo);
    expect(a.data.duplicada).toBe(false);
    expect(b.data.duplicada).toBe(true);
    expect(b.data.correccion.correccionId).toBe(a.data.correccion.correccionId);
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
    expect(hojas.UbicacionCorreccionesLog.filas).toHaveLength(2);
    expect(historial.filter((h) => h[1] === 'proponerCorreccionUbicacion' && h[3] === 'OK')).toHaveLength(1);
  });

  test('las escrituras toman y liberan el lock una vez cada una', () => {
    const a = proponer('ana@x.com');
    validar('valeria@x.com', a.data.correccion.correccionId);
    expect(lock).toEqual({ waits: 2, releases: 2 });
  });

  test('si la hoja de correcciones no existe: SERVICE_UNAVAILABLE indicando el setup, sin escribir nada', () => {
    instalarSheetsFalsos({});
    global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
    const r = proponer('ana@x.com');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.message).toMatch(/setupUbicacionCorreccionesSheets/);
  });
});

describe('seguridad', () => {
  test('usuario deshabilitado o sin sesion: nada (aunque tenga todos los permisos)', () => {
    expect(proponer('inactivo@x.com').code).toBe('USER_DISABLED');
    expect(post('desconocido@x.com', { action: 'getCorreccionesUbicacionPendientes' }).code).toBe('UNAUTHORIZED');
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(1);
  });

  test('quien solo tiene "ubicacion" lee las correcciones del pozo pero no propone ni ve la cola de validacion', () => {
    proponer('ana@x.com');
    expect(porPozo('lector@x.com').status).toBe('ok');
    expect(proponer('lector@x.com').code).toBe('PERMISSION_DENIED');
    expect(post('lector@x.com', { action: 'getCorreccionesUbicacionPendientes' }).code).toBe('PERMISSION_DENIED');
  });

  test('la cola de validacion la ve quien valida, con nombres y el booleano "propia" (nunca emails)', () => {
    proponer('ana@x.com');
    proponer('carla@x.com');
    const cola = post('carla@x.com', { action: 'getCorreccionesUbicacionPendientes' });
    expect(cola.status).toBe('ok');
    expect(cola.data.total).toBe(2);
    expect(cola.data.pendientes.map((p) => [p.nombrePropone, p.propia])).toEqual([['Ana', false], ['Carla', true]]);
  });

  test('ninguna respuesta de toda la prueba contiene un email ni el titular del padron', () => {
    const a = proponer('ana@x.com', { observacion: 'ok' });
    validar('valeria@x.com', a.data.correccion.correccionId);
    proponer('beto@x.com');
    post('valeria@x.com', { action: 'getCorreccionesUbicacionPendientes' });
    porPozo('lector@x.com');
    validar('carla@x.com', a.data.correccion.correccionId);
    proponer('ana@x.com', { precisionGpsM: 80 });
    const todo = JSON.stringify(respuestas);
    expect(todo).not.toMatch(/@/);
    expect(todo).not.toContain('TITULAR RESERVADO');
    expect(todo).not.toContain('emailPropone');
  });
});
