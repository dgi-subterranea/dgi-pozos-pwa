const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Endpoints de fotos de Reemplazos v2 (capa Api): gating EXCLUSIVO por
// "reemplazo" para lectura y escritura, orden de chequeos, auditoria sin
// ruido y que nunca salgan email/driveFileId. La logica de negocio esta en
// FotosReemplazo.test.js.
const W = '04-0263';
const EV = '22222222-2222-4222-8222-222222222222';
const FOTO = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  installAppsScriptFakes();
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
});

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'sesion@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}

const CON = { reemplazo: true };
const llamadas = {
  subir: () => Api.handleSubirFotoReemplazo('t', W, EV, 'a.jpg', 'image/jpeg', 'AAAA', 'BBBB'),
  listarEvaluacion: () => Api.handleGetFotosReemplazo('t', EV),
  listarPozo: () => Api.handleGetFotosReemplazoPozo('t', W),
  obtener: () => Api.handleGetFotoReemplazo('t', FOTO, 'thumb')
};

describe('permiso reemplazo gatea las fotos (lectura y escritura)', () => {
  test.each(Object.keys(llamadas))('reemplazo=NO: %s -> PERMISSION_DENIED y nada se lee ni se escribe', (k) => {
    como({ perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: false });
    const r = llamadas[k]();
    expect(r.status).toBe('error');
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(global.fotosService_subir).not.toHaveBeenCalled();
    expect(global.fotosService_listarPorEvaluacion).not.toHaveBeenCalled();
    expect(global.fotosService_listarPorPozo).not.toHaveBeenCalled();
    expect(global.fotosService_obtenerImagen).not.toHaveBeenCalled();
  });

  test('columna ausente (hasPermission false): PERMISSION_DENIED', () => {
    como({});
    expect(llamadas.obtener().code).toBe('PERMISSION_DENIED');
  });

  test('reemplazo=SI sin ningun otro permiso: accede a todo', () => {
    como(CON);
    global.fotosService_subir.mockReturnValue({ ok: true, foto: { fotoId: FOTO } });
    global.fotosService_listarPorEvaluacion.mockReturnValue({ evaluacionId: EV, fotos: [] });
    global.fotosService_listarPorPozo.mockReturnValue({ wellId: W, fotos: [] });
    global.fotosService_obtenerImagen.mockReturnValue({ ok: true, imagen: { fotoId: FOTO } });
    Object.keys(llamadas).forEach((k) => expect(llamadas[k]().status).toBe('ok'));
  });

  test('sesion invalida / usuario inactivo: UNAUTHORIZED / USER_DISABLED antes del permiso', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(llamadas.obtener().code).toBe('UNAUTHORIZED');
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'a@x.com' });
    global.isUserActive.mockReturnValue(false);
    expect(llamadas.subir().code).toBe('USER_DISABLED');
  });

  test('permiso denegado se audita en Historial (patron general)', () => {
    como({});
    llamadas.subir();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoReemplazo', W, 'PERMISSION_DENIED');
  });
});

describe('subirFotoReemplazo', () => {
  beforeEach(() => como(CON));

  test.each(['4-0263', '20-0263', '', null])('wellId invalido %p: INVALID_WELL_ID', (w) => {
    expect(Api.handleSubirFotoReemplazo('t', w, EV, 'a.jpg', 'image/jpeg', 'AAAA', 'BBBB').code).toBe('INVALID_WELL_ID');
    expect(global.fotosService_subir).not.toHaveBeenCalled();
  });

  test('identidad SOLO de la sesion; el body del cliente no puede inyectar email', () => {
    global.fotosService_subir.mockReturnValue({ ok: true, foto: {} });
    Api.doPost({ postData: { contents: JSON.stringify({
      action: 'subirFotoReemplazo', sessionToken: 't', wellId: W, evaluacionId: EV, nombreArchivo: 'a.jpg',
      mimeType: 'image/jpeg', imagenBase64: 'AAAA', thumbBase64: 'BBBB', email: 'impostor@x.com', driveFileId: 'FORZADO'
    }) } });
    const args = global.fotosService_subir.mock.calls[0];
    expect(args[0]).toBe('sesion@example.com');
    expect(Object.keys(args[3]).sort()).toEqual(['imagenBase64', 'mimeType', 'nombreArchivo', 'thumbBase64']);
  });

  test('OK: devuelve {foto} y NO escribe fila de Historial por foto (sin ruido), sin Telegram', () => {
    global.fotosService_subir.mockReturnValue({ ok: true, foto: { fotoId: FOTO } });
    expect(llamadas.subir()).toEqual({ status: 'ok', data: { foto: { fotoId: FOTO } } });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test.each(['EVALUACION_NOT_FOUND', 'EVALUACION_WELLID_MISMATCH', 'FOTO_LIMIT', 'INVALID_MIME', 'FILE_TOO_LARGE', 'INVALID_IMAGEN', 'STORAGE_UNAVAILABLE'])('error %s se devuelve tal cual y se audita', (code) => {
    global.fotosService_subir.mockReturnValue({ ok: false, code, message: 'm' });
    expect(llamadas.subir()).toEqual({ status: 'error', code, message: 'm' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'subirFotoReemplazo', W, code);
  });

  test('excepcion del servicio (Sheets/lock): SERVICE_UNAVAILABLE', () => {
    global.fotosService_subir.mockImplementation(() => { throw new Error('boom'); });
    expect(llamadas.subir().code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('lectura de fotos', () => {
  beforeEach(() => como(CON));

  test('getFotosReemplazo: evaluacionId debe ser UUID', () => {
    expect(Api.handleGetFotosReemplazo('t', 'no-uuid').code).toBe('INVALID_EVALUACION_ID');
    expect(Api.handleGetFotosReemplazo('t', undefined).code).toBe('INVALID_EVALUACION_ID');
    expect(global.fotosService_listarPorEvaluacion).not.toHaveBeenCalled();
  });

  test('getFotosReemplazoPozo: wellId invalido rechazado', () => {
    expect(Api.handleGetFotosReemplazoPozo('t', '99-9999').code).toBe('INVALID_WELL_ID');
  });

  test('metadata devuelta tal cual la sanitiza el servicio (sin email ni driveFileId)', () => {
    const data = { wellId: W, fotos: [{ fotoId: FOTO, evaluacionId: EV, wellId: W, timestamp: 't', mimeType: 'image/jpeg', tamanoBytes: 1 }] };
    global.fotosService_listarPorPozo.mockReturnValue(data);
    const r = llamadas.listarPozo();
    expect(JSON.stringify(r)).not.toMatch(/email|driveFileId|@/);
    expect(r.data).toEqual(data);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('getFotoReemplazo: errores del servicio mapeados; STORAGE_UNAVAILABLE se audita, FOTO_NOT_FOUND no', () => {
    global.fotosService_obtenerImagen.mockReturnValue({ ok: false, code: 'FOTO_NOT_FOUND', message: 'm' });
    expect(llamadas.obtener().code).toBe('FOTO_NOT_FOUND');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    global.fotosService_obtenerImagen.mockReturnValue({ ok: false, code: 'STORAGE_UNAVAILABLE', message: 'm' });
    expect(llamadas.obtener().code).toBe('STORAGE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'getFotoReemplazo', null, 'STORAGE_UNAVAILABLE');
  });

  test('getFotoReemplazo OK: imagen en base64 por el backend (proxy), nunca una URL', () => {
    global.fotosService_obtenerImagen.mockReturnValue({ ok: true, imagen: { fotoId: FOTO, variante: 'thumb', mimeType: 'image/jpeg', imagenBase64: 'QUJD' } });
    const r = llamadas.obtener();
    expect(r.data.imagenBase64).toBe('QUJD');
    expect(JSON.stringify(r)).not.toMatch(/https?:|drive\.google/);
  });

  test('doPost enruta las 4 acciones', () => {
    global.fotosService_subir.mockReturnValue({ ok: true, foto: {} });
    global.fotosService_listarPorEvaluacion.mockReturnValue({ fotos: [] });
    global.fotosService_listarPorPozo.mockReturnValue({ fotos: [] });
    global.fotosService_obtenerImagen.mockReturnValue({ ok: true, imagen: {} });
    const call = (b) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(b) } }).text).status;
    expect(call({ action: 'subirFotoReemplazo', sessionToken: 't', wellId: W, evaluacionId: EV })).toBe('ok');
    expect(call({ action: 'getFotosReemplazo', sessionToken: 't', evaluacionId: EV })).toBe('ok');
    expect(call({ action: 'getFotosReemplazoPozo', sessionToken: 't', wellId: W })).toBe('ok');
    expect(call({ action: 'getFotoReemplazo', sessionToken: 't', fotoId: FOTO, variante: 'thumb' })).toBe('ok');
  });
});
