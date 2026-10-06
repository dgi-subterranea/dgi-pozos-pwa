const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Endpoints de la galeria general de fotos de pozos (capa Api): gates
// INDEPENDIENTES (fotos = ver, fotos_carga = cargar; ninguno ligado a reemplazo),
// fail-closed, orden de chequeos, lista blanca de campos en la subida, auditoria
// sin ruido y que nunca salgan ids de Drive / emails / secretos. La logica de
// negocio esta en FotosPozosService.test.js.
const W = '04-0263';
const FOTO = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  installAppsScriptFakes();
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  global.fotosPozosService_listar.mockReturnValue({ ok: true, entidad: W, total: 1, fotos: [{ fotoId: FOTO }] });
  global.fotosPozosService_obtenerImagen.mockReturnValue({ ok: true, imagen: { fotoId: FOTO, variante: 'thumb', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
  global.fotosPozosService_resumen.mockReturnValue({ [W]: 1 });
  global.fotosPozosService_subir.mockReturnValue({ ok: true, foto: { fotoId: FOTO }, duplicada: false });
});

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'sesion@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}

const llamadas = {
  listar: () => Api.handleGetFotosPozo('t', W, '', 'recientes'),
  imagen: () => Api.handleGetFotoPozo('t', FOTO, 'thumb'),
  resumen: () => Api.handleGetResumenFotosPozos('t')
};
const subir = (extra) => Api.handleSubirFotoPozo('t', Object.assign({ wellId: W, mimeType: 'image/jpeg', imagenBase64: 'AAAA', thumbBase64: 'BBBB' }, extra || {}));
const noSeLeyoNada = () => {
  expect(global.fotosPozosService_listar).not.toHaveBeenCalled();
  expect(global.fotosPozosService_obtenerImagen).not.toHaveBeenCalled();
  expect(global.fotosPozosService_resumen).not.toHaveBeenCalled();
};

describe('permiso "fotos" gatea la lectura', () => {
  test.each(Object.keys(llamadas))('fotos=NO: %s -> PERMISSION_DENIED y nada se lee', (k) => {
    como({ perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: true, fotos: false, fotos_carga: true });
    const r = llamadas[k]();
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    noSeLeyoNada();
  });

  test('columna ausente (hasPermission false): PERMISSION_DENIED', () => {
    como({});
    expect(llamadas.listar().code).toBe('PERMISSION_DENIED');
    expect(llamadas.resumen().code).toBe('PERMISSION_DENIED');
  });

  test('fotos=SI sin ningun otro permiso: lee todo', () => {
    como({ fotos: true });
    Object.keys(llamadas).forEach((k) => expect(llamadas[k]().status).toBe('ok'));
  });

  test('fotos_carga=SI NO da lectura: no ve la galeria, ni el resumen, ni imagenes ("no revelar si un pozo tiene fotos")', () => {
    como({ fotos_carga: true });
    Object.keys(llamadas).forEach((k) => expect(llamadas[k]().code).toBe('PERMISSION_DENIED'));
    noSeLeyoNada();
  });

  test('reemplazo=SI tampoco: las fotos generales no estan atadas a reemplazo', () => {
    como({ reemplazo: true, ne: true, perfil: true, datos: true, ubicacion: true });
    Object.keys(llamadas).forEach((k) => expect(llamadas[k]().code).toBe('PERMISSION_DENIED'));
    expect(subir().code).toBe('PERMISSION_DENIED');
  });
});

describe('permiso "fotos_carga" gatea la subida', () => {
  test('fotos_carga=NO (aunque tenga fotos y reemplazo): PERMISSION_DENIED y el servicio nunca se llama', () => {
    como({ fotos: true, reemplazo: true, fotos_carga: false });
    expect(subir()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(global.fotosPozosService_subir).not.toHaveBeenCalled();
  });

  test('fotos_carga=SI sin fotos: puede subir (y la respuesta es solo la metadata de SU foto)', () => {
    como({ fotos_carga: true });
    const r = subir();
    expect(r.status).toBe('ok');
    expect(r.data).toEqual({ foto: { fotoId: FOTO }, duplicada: false });
    expect(global.fotosPozosService_listar).not.toHaveBeenCalled();
    expect(global.fotosPozosService_resumen).not.toHaveBeenCalled();
  });

  test('sesion invalida / usuario inactivo: UNAUTHORIZED / USER_DISABLED antes del permiso', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(subir().code).toBe('UNAUTHORIZED');
    expect(llamadas.listar().code).toBe('UNAUTHORIZED');
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'a@x.com' });
    global.isUserActive.mockReturnValue(false);
    expect(subir().code).toBe('USER_DISABLED');
    expect(llamadas.resumen().code).toBe('USER_DISABLED');
    expect(global.fotosPozosService_subir).not.toHaveBeenCalled();
  });
});

describe('subirFotoPozo', () => {
  beforeEach(() => como({ fotos_carga: true }));

  test('la identidad sale SOLO de la sesion; el servicio recibe el email de la sesion', () => {
    subir({ emailUsuarioCarga: 'falso@x.com', email: 'falso@x.com' });
    expect(global.fotosPozosService_subir.mock.calls[0][0]).toBe('sesion@example.com');
    expect(JSON.stringify(global.fotosPozosService_subir.mock.calls[0][1])).not.toContain('falso@x.com');
  });

  test('doPost: lista blanca de campos (estado, driveFileId, lote, gpsOrigen... del cliente se ignoran)', () => {
    const body = {
      action: 'subirFotoPozo', sessionToken: 't', wellId: W, monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
      fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO', observacion: 'x', gps: { lat: -33, lon: -68 },
      mimeType: 'image/jpeg', imagenBase64: 'AAAA', thumbBase64: 'BBBB', sha1Original: 'a'.repeat(40), procesamiento: 'NAVEGADOR', tamanoOriginalBytes: 5,
      estado: 'OCULTA', estadoVinculo: 'POR_REVISAR', driveFileId: 'INVENTADO', driveThumbId: 'INVENTADO', gpsOrigen: 'EXIF_ORIGINAL', loteImportacion: 'LOTE', emailUsuarioCarga: 'falso@x.com', fotoId: FOTO, vinculoMetodo: 'MANUAL'
    };
    const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
    expect(r.status).toBe('ok');
    const recibido = global.fotosPozosService_subir.mock.calls[0][1];
    expect(Object.keys(recibido).sort()).toEqual(['fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fuente', 'gps', 'imagenBase64', 'mimeType', 'monitoringId', 'observacion', 'procesamiento', 'sha1Original', 'tamanoOriginalBytes', 'thumbBase64', 'tipoFoto', 'wellId']);
    expect(JSON.stringify(recibido)).not.toMatch(/INVENTADO|OCULTA|POR_REVISAR|EXIF_ORIGINAL|LOTE|falso@x\.com|MANUAL/);
  });

  test('exito OK: una fila de Historial con la entidad y SIN foto ni ids de Drive', () => {
    subir();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoPozo', W, 'OK');
    expect(JSON.stringify(global.logHistoryEvent.mock.calls)).not.toMatch(/AAAA|BBBB|DRIVE/);
  });

  test('punto NE especial: Historial registra el monitoringId', () => {
    subir({ wellId: '', monitoringId: 'INA 2055' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoPozo', 'INA 2055', 'OK');
  });

  test('duplicada (mismo archivo ya subido): ok con duplicada=true y sin fila nueva en Historial', () => {
    global.fotosPozosService_subir.mockReturnValue({ ok: true, foto: { fotoId: FOTO }, duplicada: true });
    const r = subir();
    expect(r.data.duplicada).toBe(true);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test.each(['INVALID_ENTIDAD', 'ENTIDAD_NOT_FOUND', 'INVALID_FECHA', 'INVALID_IMAGEN', 'FILE_TOO_LARGE', 'STORAGE_UNAVAILABLE'])('error de negocio %s: se devuelve y se audita', (code) => {
    global.fotosPozosService_subir.mockReturnValue({ ok: false, code, message: 'm' });
    expect(subir()).toEqual({ status: 'error', code, message: 'm' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoPozo', W, code);
  });

  test('excepcion del servicio (p. ej. Sheets caido): SERVICE_UNAVAILABLE auditado', () => {
    global.fotosPozosService_subir.mockImplementation(() => { throw new Error('Sheets no responde'); });
    expect(subir().code).toBe('SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoPozo', W, 'SERVICE_UNAVAILABLE');
  });

  test('permiso denegado se audita en Historial con la entidad', () => {
    como({});
    subir();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoPozo', W, 'PERMISSION_DENIED');
  });

  test('body vacio o sin entidad: no revienta; el servicio decide el error', () => {
    global.fotosPozosService_subir.mockReturnValue({ ok: false, code: 'INVALID_ENTIDAD', message: 'm' });
    expect(Api.handleSubirFotoPozo('t', undefined).code).toBe('INVALID_ENTIDAD');
    expect(Api.handleSubirFotoPozo('t', { wellId: { x: 1 } }).code).toBe('INVALID_ENTIDAD');
  });
});

describe('lecturas', () => {
  beforeEach(() => como({ fotos: true }));

  test('getFotosPozo entrega solo lo que devuelve el servicio (entidad, total, fotos) y pasa la entidad y el orden', () => {
    const r = Api.handleGetFotosPozo('t', W, '', 'antiguas');
    expect(r).toEqual({ status: 'ok', data: { entidad: W, total: 1, fotos: [{ fotoId: FOTO }] } });
    expect(global.fotosPozosService_listar).toHaveBeenCalledWith(W, '', 'antiguas');
  });

  test('getFotosPozo de un punto NE especial', () => {
    Api.handleGetFotosPozo('t', '', 'INA 2055', undefined);
    expect(global.fotosPozosService_listar).toHaveBeenCalledWith('', 'INA 2055', undefined);
  });

  test('lectura OK no escribe en Historial ni dispara nada mas (ni Telegram)', () => {
    llamadas.listar(); llamadas.imagen(); llamadas.resumen();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test('error de validacion de entidad: se devuelve sin auditar (no es un fallo del servicio)', () => {
    global.fotosPozosService_listar.mockReturnValue({ ok: false, code: 'INVALID_ENTIDAD', message: 'm' });
    expect(Api.handleGetFotosPozo('t', '', '', undefined).code).toBe('INVALID_ENTIDAD');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('imagen: STORAGE_UNAVAILABLE se audita, FOTO_NOT_FOUND no', () => {
    global.fotosPozosService_obtenerImagen.mockReturnValue({ ok: false, code: 'FOTO_NOT_FOUND', message: 'm' });
    expect(llamadas.imagen().code).toBe('FOTO_NOT_FOUND');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    global.fotosPozosService_obtenerImagen.mockReturnValue({ ok: false, code: 'STORAGE_UNAVAILABLE', message: 'm' });
    llamadas.imagen();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'getFotoPozo', null, 'STORAGE_UNAVAILABLE');
  });

  test('excepciones del servicio: SERVICE_UNAVAILABLE auditado en las tres lecturas', () => {
    ['fotosPozosService_listar', 'fotosPozosService_obtenerImagen', 'fotosPozosService_resumen'].forEach((n) => {
      global[n].mockImplementation(() => { throw new Error('boom'); });
    });
    Object.keys(llamadas).forEach((k) => expect(llamadas[k]().code).toBe('SERVICE_UNAVAILABLE'));
    expect(global.logHistoryEvent).toHaveBeenCalledTimes(3);
  });

  test('resumen: payload minimo {clave: n}', () => {
    expect(llamadas.resumen()).toEqual({ status: 'ok', data: { [W]: 1 } });
  });
});

describe('ninguna respuesta de la capa Api puede traer secretos, ids de Drive ni emails', () => {
  test('aunque el servicio (por un bug) devolviera de mas, Api solo reenvia lo declarado', () => {
    como({ fotos: true, fotos_carga: true });
    global.fotosPozosService_listar.mockReturnValue({ ok: true, entidad: W, total: 1, fotos: [{ fotoId: FOTO }], driveFileId: 'DRIVE_X', secreto: 'S' });
    const r = JSON.stringify(Api.handleGetFotosPozo('t', W, '', undefined));
    expect(r).not.toMatch(/DRIVE_X|secreto/);
    global.fotosPozosService_subir.mockReturnValue({ ok: true, foto: { fotoId: FOTO }, duplicada: false, driveFileId: 'DRIVE_X' });
    expect(JSON.stringify(subir())).not.toContain('DRIVE_X');
  });
});

describe('doPost enruta las 4 acciones nuevas', () => {
  test.each([
    ['getFotosPozo', { wellId: W }],
    ['getFotoPozo', { fotoId: FOTO, variante: 'thumb' }],
    ['getResumenFotosPozos', {}],
    ['subirFotoPozo', { wellId: W }]
  ])('%s', (action, extra) => {
    como({ fotos: true, fotos_carga: true });
    const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ action, sessionToken: 't' }, extra)) } }).text);
    expect(r.status).toBe('ok');
  });
});
