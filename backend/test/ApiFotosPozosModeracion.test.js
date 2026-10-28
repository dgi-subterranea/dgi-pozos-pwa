// E8-3, capa Api de la moderacion de fotos de pozos: gates exactos (`=== true`, siempre con `fotos`), orden sesion -> permisos -> contenido, lista blanca de campos en doPost (el cliente NUNCA manda
// entidad, estado, email, nombre ni la foto de una resolucion), identidad solo de la sesion + hoja Usuarios, auditoria resumida en Historial (sin motivo, sin fotoId, un reintento idempotente no
// escribe otra fila), errores estables, sin oraculo y SERVICE_UNAVAILABLE si la hoja de eventos no responde. La logica de negocio esta en FotosPozosModeracionOperaciones.test.js.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

const FOTO = '11111111-1111-4111-8111-111111111111';
const SOL = '22222222-2222-4222-8222-222222222222';
const CRID = 'req-12345678';
const EMAIL = 'sesion@example.com';

const OPS = ['ejecutar', 'historial', 'cola', 'imagen'];

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  global.getUserAccess.mockReturnValue({ nombre: 'Moderadora Uno' });
  global.fotosPozosModeracionOps_ejecutar = jest.fn().mockReturnValue({
    ok: true, duplicada: false, evento: { eventoId: SOL, evento: 'RETIRADA', fotoId: FOTO, solicitudId: '', resolucion: '' }, entidad: { tipo: 'WELL', id: '14-0001' }, cacheInvalidado: []
  });
  global.fotosPozosModeracionOps_historial = jest.fn().mockReturnValue({ ok: true, foto: { fotoId: FOTO }, estado: { estado: 'ACTIVA' }, eventos: [], extra: 'no sale' });
  global.fotosPozosModeracionOps_cola = jest.fn().mockReturnValue({ ok: true, total: 0, items: [], hayMas: false, cursor: null, extra: 'no sale' });
  global.fotosPozosModeracionOps_imagen = jest.fn().mockReturnValue({ ok: true, imagen: { fotoId: FOTO, variante: 'thumb', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
});

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}
const MODERADOR = { fotos: true, fotos_moderar: true };
const CARGA = { fotos: true, fotos_carga: true };

const escrituras = {
  solicitarRetiroFotoPozo: { handler: () => Api.handleSolicitarRetiroFotoPozo('t', { fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID }), accion: 'SOLICITAR_RETIRO', ok: CARGA, requiere: ['fotos', 'fotos_carga'] },
  retirarFotoPozo: { handler: () => Api.handleRetirarFotoPozo('t', { fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID }), accion: 'RETIRAR', ok: MODERADOR, requiere: ['fotos', 'fotos_moderar'] },
  resolverRetiroFotoPozo: { handler: () => Api.handleResolverRetiroFotoPozo('t', { solicitudId: SOL, resolucion: 'APROBADO', clientRequestId: CRID }), accion: 'RESOLVER_RETIRO', ok: MODERADOR, requiere: ['fotos', 'fotos_moderar'] },
  reponerFotoPozo: { handler: () => Api.handleReponerFotoPozo('t', { fotoId: FOTO, clientRequestId: CRID }), accion: 'REPONER', ok: MODERADOR, requiere: ['fotos', 'fotos_moderar'] }
};
const lecturas = {
  getHistorialFotoPozo: () => Api.handleGetHistorialFotoPozo('t', FOTO),
  getFotosPozosPendientesModeracion: () => Api.handleGetFotosPozosPendientesModeracion('t', 10, undefined),
  getFotoPozoModeracion: () => Api.handleGetFotoPozoModeracion('t', FOTO, 'thumb')
};
const nadaSeEjecuto = () => OPS.forEach((o) => { expect(global['fotosPozosModeracionOps_' + o]).not.toHaveBeenCalled(); });

describe('gates exactos de permiso', () => {
  test.each(Object.keys(escrituras))('%s: sin sesion valida -> UNAUTHORIZED y nada se ejecuta', (k) => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(escrituras[k].handler().code).toBe('UNAUTHORIZED');
    nadaSeEjecuto();
  });

  test.each(Object.keys(escrituras))('%s: usuario inactivo -> USER_DISABLED', (k) => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
    global.isUserActive.mockReturnValue(false);
    expect(escrituras[k].handler().code).toBe('USER_DISABLED');
    nadaSeEjecuto();
  });

  test('solicitar retiro: fotos + fotos_carga; ni solo uno, ni fotos_moderar, ni valores truthy', () => {
    const h = escrituras.solicitarRetiroFotoPozo.handler;
    [{ fotos: true }, { fotos_carga: true }, { fotos_moderar: true }, { fotos: true, fotos_moderar: true }, { fotos_carga: true, fotos_moderar: true }, {}].forEach((p) => {
      como(p);
      expect(h()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    });
    nadaSeEjecuto();
    como(CARGA);
    expect(h().status).toBe('ok');
  });

  test.each(['retirarFotoPozo', 'resolverRetiroFotoPozo', 'reponerFotoPozo'])('%s: fotos + fotos_moderar; fotos_carga o fotos_moderar solos NO alcanzan', (k) => {
    const h = escrituras[k].handler;
    [{ fotos_moderar: true }, { fotos: true }, { fotos: true, fotos_carga: true }, { fotos_carga: true, fotos_moderar: true }, { fotos: false, fotos_moderar: true }, {}].forEach((p) => {
      como(p);
      expect(h()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    });
    nadaSeEjecuto();
    como(MODERADOR);
    expect(h().status).toBe('ok');
  });

  test.each(Object.keys(lecturas))('%s: fotos + fotos_moderar; sin fotos o sin fotos_moderar -> PERMISSION_DENIED y no se lee nada', (k) => {
    [{ fotos_moderar: true }, { fotos: true }, { fotos: true, fotos_carga: true }, { fotos_moderar: true, fotos_carga: true }, {}].forEach((p) => {
      como(p);
      expect(lecturas[k]()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    });
    nadaSeEjecuto();
    como(MODERADOR);
    expect(lecturas[k]().status).toBe('ok');
  });

  test('un permiso en valor truthy que NO es true (hasPermission devuelve "SI" / 1) no habilita', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
    global.isUserActive.mockReturnValue(true);
    global.hasPermission.mockReturnValue('SI');
    expect(escrituras.retirarFotoPozo.handler().code).toBe('PERMISSION_DENIED');
    global.hasPermission.mockReturnValue(1);
    expect(lecturas.getHistorialFotoPozo().code).toBe('PERMISSION_DENIED');
    nadaSeEjecuto();
  });

  test('el permiso denegado se audita en Historial sin motivo ni fotoId', () => {
    como({ fotos: true });
    escrituras.retirarFotoPozo.handler();
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'retirarFotoPozo', null, 'PERMISSION_DENIED');
    expect(JSON.stringify(global.logHistoryEvent.mock.calls)).not.toMatch(new RegExp(FOTO + '|DUPLICADA'));
  });

  test('un no-moderador recibe el MISMO error para una foto que existe y para una que no (la Api no consulta nada antes del permiso)', () => {
    como(CARGA);
    const a = Api.handleRetirarFotoPozo('t', { fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID });
    const b = Api.handleRetirarFotoPozo('t', { fotoId: '33333333-3333-4333-8333-333333333333', motivoCodigo: 'DUPLICADA', clientRequestId: CRID });
    expect(a).toEqual(b);
    nadaSeEjecuto();
  });
});

describe('escrituras: identidad y datos al servicio', () => {
  test.each(Object.keys(escrituras))('%s: pasa al servicio la accion de dominio, el email y el nombre de la SESION y los permisos reales', (k) => {
    como(escrituras[k].ok);
    escrituras[k].handler();
    const [datos, sesion] = global.fotosPozosModeracionOps_ejecutar.mock.calls[0];
    expect(datos.accion).toBe(escrituras[k].accion);
    expect(sesion.email).toBe(EMAIL);
    expect(sesion.nombre).toBe('Moderadora Uno');
    expect(sesion.permisos).toEqual({ fotos: true, fotos_carga: escrituras[k].ok.fotos_carga === true, fotos_moderar: escrituras[k].ok.fotos_moderar === true });
  });

  test('el email del body, el nombre del body y cualquier entidad del cliente se ignoran', () => {
    como(CARGA);
    Api.handleSolicitarRetiroFotoPozo('t', { fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID, email: 'falso@x.com', nombre: 'Falso', wellId: '99-9999', entidadId: '99-9999' });
    const [datos, sesion] = global.fotosPozosModeracionOps_ejecutar.mock.calls[0];
    expect(sesion.email).toBe(EMAIL);
    expect(JSON.stringify([datos, sesion])).not.toMatch(/falso|99-9999/i);
  });

  test.each([
    ['handleSolicitarRetiroFotoPozo', CARGA, { fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID }, ['clientRequestId', 'fotoId', 'motivoCodigo']],
    ['handleRetirarFotoPozo', MODERADOR, { fotoId: FOTO, motivoCodigo: 'DUPLICADA', motivoTexto: 'texto', clientRequestId: CRID }, ['clientRequestId', 'fotoId', 'motivoCodigo', 'motivoTexto']],
    ['handleResolverRetiroFotoPozo', MODERADOR, { solicitudId: SOL, resolucion: 'APROBADO', clientRequestId: CRID }, ['clientRequestId', 'resolucion', 'solicitudId']],
    ['handleReponerFotoPozo', MODERADOR, { fotoId: FOTO, clientRequestId: CRID }, ['clientRequestId', 'fotoId']]
  ])('%s: el handler tambien aplica la lista blanca (llamado directo, sin pasar por doPost)', (handler, permisos, validos, esperados) => {
    como(permisos);
    const intruso = { email: 'falso@x.com', nombre: 'Falso', wellId: '99-9999', monitoringId: 'INA 999', estado: 'RETIRADA', secuencia: 7, timestampUtc: '2000-01-01T00:00:00.000Z', entidadTipo: 'WELL', entidadId: '99-9999', eventoId: 'x' };
    // una resolucion no lleva fotoId ni motivo y una reposicion no lleva motivo: el servicio real los rechazaria; aca se verifica que NUNCA lleguen
    if (handler === 'handleResolverRetiroFotoPozo') { intruso.fotoId = FOTO; intruso.motivoCodigo = 'DUPLICADA'; intruso.motivoTexto = 'x'; }
    if (handler === 'handleReponerFotoPozo') { intruso.motivoCodigo = 'DUPLICADA'; intruso.solicitudId = SOL; }
    if (handler === 'handleSolicitarRetiroFotoPozo') { intruso.solicitudId = SOL; intruso.resolucion = 'APROBADO'; }
    Api[handler]('t', Object.assign({}, validos, intruso));
    const [datos, sesion] = global.fotosPozosModeracionOps_ejecutar.mock.calls[0];
    expect(Object.keys(datos).filter((k) => k !== 'accion').sort()).toEqual(esperados);
    expect(JSON.stringify([datos, sesion])).not.toMatch(/falso|99-9999|INA 999|RETIRADA|2000-01-01/i);
    expect(sesion.email).toBe(EMAIL);
  });

  test('doPost: lista blanca de campos por accion (estado, solicitudId, entidad, email, nombre, secuencia del cliente se descartan)', () => {
    como(CARGA);
    const extra = { estado: 'RETIRADA', entidadTipo: 'WELL', entidadId: '99-9999', wellId: '99-9999', email: 'falso@x.com', nombre: 'Falso', secuencia: 1, eventoId: 'x', driveFileId: 'D', resolucion: 'APROBADO', solicitudId: SOL };
    const post = (body) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ sessionToken: 't' }, body, extra)) } }).text);
    expect(post({ action: 'solicitarRetiroFotoPozo', fotoId: FOTO, motivoCodigo: 'OTRO', motivoTexto: 'no es', clientRequestId: CRID }).status).toBe('ok');
    expect(Object.keys(global.fotosPozosModeracionOps_ejecutar.mock.calls[0][0]).sort()).toEqual(['accion', 'clientRequestId', 'fotoId', 'motivoCodigo', 'motivoTexto']);

    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockClear();
    post({ action: 'retirarFotoPozo', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID });
    expect(Object.keys(global.fotosPozosModeracionOps_ejecutar.mock.calls[0][0]).sort()).toEqual(['accion', 'clientRequestId', 'fotoId', 'motivoCodigo', 'motivoTexto']);
    global.fotosPozosModeracionOps_ejecutar.mockClear();
    post({ action: 'resolverRetiroFotoPozo', solicitudId: SOL, resolucion: 'RECHAZADO', clientRequestId: CRID });
    expect(Object.keys(global.fotosPozosModeracionOps_ejecutar.mock.calls[0][0]).sort()).toEqual(['accion', 'clientRequestId', 'resolucion', 'solicitudId']);
    global.fotosPozosModeracionOps_ejecutar.mockClear();
    post({ action: 'reponerFotoPozo', fotoId: FOTO, clientRequestId: CRID });
    expect(Object.keys(global.fotosPozosModeracionOps_ejecutar.mock.calls[0][0]).sort()).toEqual(['accion', 'clientRequestId', 'fotoId']);
    const todo = JSON.stringify(global.fotosPozosModeracionOps_ejecutar.mock.calls);
    expect(todo).not.toMatch(/falso|99-9999|DRIVE|"D"|RETIRADA/);
  });

  test('body vacio / datos no objeto: no revienta, el servicio decide el error', () => {
    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockReturnValue({ ok: false, code: 'INVALID_FOTO_ID', message: 'm' });
    expect(Api.handleRetirarFotoPozo('t', undefined).code).toBe('INVALID_FOTO_ID');
    expect(Api.handleReponerFotoPozo('t', null).code).toBe('INVALID_FOTO_ID');
  });
});

describe('escrituras: respuesta y auditoria', () => {
  test('retirar / reponer: {fotoId, duplicada}; sin evento interno, email, secuencia ni claves de cache', () => {
    como(MODERADOR);
    expect(escrituras.retirarFotoPozo.handler()).toEqual({ status: 'ok', data: { fotoId: FOTO, duplicada: false } });
    expect(escrituras.reponerFotoPozo.handler()).toEqual({ status: 'ok', data: { fotoId: FOTO, duplicada: false } });
  });

  test('solicitar devuelve solicitudId = eventoId del evento; resolver devuelve solicitudId y resolucion', () => {
    como(CARGA);
    global.fotosPozosModeracionOps_ejecutar.mockReturnValue({ ok: true, duplicada: false, evento: { eventoId: SOL, evento: 'RETIRO_SOLICITADO', fotoId: FOTO, solicitudId: '', resolucion: '' }, entidad: { tipo: 'WELL', id: '14-0001' }, cacheInvalidado: [] });
    expect(escrituras.solicitarRetiroFotoPozo.handler()).toEqual({ status: 'ok', data: { fotoId: FOTO, duplicada: false, solicitudId: SOL } });
    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockReturnValue({ ok: true, duplicada: false, evento: { eventoId: 'e', evento: 'RETIRO_RESUELTO', fotoId: FOTO, solicitudId: SOL, resolucion: 'APROBADO' }, entidad: { tipo: 'WELL', id: '14-0001' }, cacheInvalidado: [] });
    expect(escrituras.resolverRetiroFotoPozo.handler()).toEqual({ status: 'ok', data: { fotoId: FOTO, duplicada: false, solicitudId: SOL, resolucion: 'APROBADO' } });
  });

  test('exito: UNA fila de Historial con accion + entidad + OK; sin motivo, sin fotoId, sin email adicional', () => {
    como(MODERADOR);
    escrituras.retirarFotoPozo.handler();
    expect(global.logHistoryEvent).toHaveBeenCalledTimes(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'retirarFotoPozo', '14-0001', 'OK');
    expect(JSON.stringify(global.logHistoryEvent.mock.calls)).not.toMatch(new RegExp(FOTO + '|DUPLICADA|motivo'));
  });

  test('un reintento idempotente (duplicada) responde OK sin escribir otra fila de Historial', () => {
    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockReturnValue({ ok: true, duplicada: true, evento: { eventoId: SOL, evento: 'RETIRADA', fotoId: FOTO, solicitudId: '', resolucion: '' }, entidad: null, cacheInvalidado: [] });
    expect(escrituras.retirarFotoPozo.handler()).toEqual({ status: 'ok', data: { fotoId: FOTO, duplicada: true } });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('no se manda ninguna notificacion (Telegram) ni se busca el pozo', () => {
    como(MODERADOR);
    escrituras.retirarFotoPozo.handler();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test.each(['INVALID_REQUEST', 'INVALID_ACCION', 'INVALID_FOTO_ID', 'INVALID_MOTIVO', 'INVALID_MOTIVO_TEXTO', 'INVALID_CLIENT_REQUEST_ID', 'INVALID_RESOLUCION', 'FOTO_NOT_FOUND', 'SOLICITUD_NOT_FOUND', 'SOLICITUD_YA_ABIERTA', 'SOLICITUD_ABIERTA', 'SOLICITUD_YA_RESUELTA',
    'FOTO_YA_RETIRADA', 'FOTO_NO_RETIRADA', 'REPOSICION_NO_PERMITIDA', 'ESTADO_NO_DERIVABLE', 'IDEMPOTENCY_CONFLICT', 'INCONSISTENT_STATE', 'PERMISSION_DENIED'])('error de negocio %s: se devuelve tal cual y se audita sin datos de la foto', (code) => {
    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockReturnValue({ ok: false, code: code, message: 'm' });
    expect(escrituras.retirarFotoPozo.handler()).toEqual({ status: 'error', code: code, message: 'm' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'retirarFotoPozo', null, code);
  });

  test('excepcion (hoja de eventos faltante o rota, lock, Sheets caido): SERVICE_UNAVAILABLE con mensaje fijo, sin detalle tecnico en la respuesta', () => {
    como(MODERADOR);
    global.fotosPozosModeracionOps_ejecutar.mockImplementation(() => { throw new Error('No existe la hoja "FotosPozoEventos" https://docs.google.com/spreadsheets/d/SECRETO'); });
    const r = escrituras.retirarFotoPozo.handler();
    expect(r.status).toBe('error');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|FotosPozoEventos|docs\.google/);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'retirarFotoPozo', null, 'SERVICE_UNAVAILABLE');
    expect(JSON.stringify(global.logHistoryEvent.mock.calls)).not.toMatch(/SECRETO|DUPLICADA/);
  });

  test('el log tecnico no incluye el motivoTexto del usuario', () => {
    como(CARGA);
    global.fotosPozosModeracionOps_ejecutar.mockImplementation(() => { throw new Error('fallo'); });
    Api.handleSolicitarRetiroFotoPozo('t', { fotoId: FOTO, motivoCodigo: 'OTRO', motivoTexto: 'TEXTO PRIVADO DEL USUARIO', clientRequestId: CRID });
    expect(JSON.stringify(global.Logger.log.mock.calls)).not.toContain('TEXTO PRIVADO');
  });
});

describe('lecturas de moderador', () => {
  beforeEach(() => como(MODERADOR));

  test('historial: pasa el fotoId y devuelve SOLO {foto, estado, eventos}', () => {
    expect(Api.handleGetHistorialFotoPozo('t', FOTO)).toEqual({ status: 'ok', data: { foto: { fotoId: FOTO }, estado: { estado: 'ACTIVA' }, eventos: [] } });
    expect(global.fotosPozosModeracionOps_historial).toHaveBeenCalledWith(FOTO);
  });

  test('cola: pasa limit y cursor y devuelve SOLO {total, items, hayMas, cursor}', () => {
    expect(Api.handleGetFotosPozosPendientesModeracion('t', 20, 7)).toEqual({ status: 'ok', data: { total: 0, items: [], hayMas: false, cursor: null } });
    expect(global.fotosPozosModeracionOps_cola).toHaveBeenCalledWith(20, 7);
  });

  test('imagen de moderacion: devuelve solo la imagen', () => {
    expect(Api.handleGetFotoPozoModeracion('t', FOTO, 'thumb')).toEqual({ status: 'ok', data: { fotoId: FOTO, variante: 'thumb', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
    expect(global.fotosPozosModeracionOps_imagen).toHaveBeenCalledWith(FOTO, 'thumb');
  });

  test('lectura OK no escribe Historial ni dispara Telegram', () => {
    Object.keys(lecturas).forEach((k) => lecturas[k]());
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test.each([['getHistorialFotoPozo', 'historial'], ['getFotosPozosPendientesModeracion', 'cola'], ['getFotoPozoModeracion', 'imagen']])('%s: error de validacion o inexistencia se devuelve sin auditar', (k, op) => {
    global['fotosPozosModeracionOps_' + op].mockReturnValue({ ok: false, code: 'FOTO_NOT_FOUND', message: 'm' });
    expect(lecturas[k]()).toEqual({ status: 'error', code: 'FOTO_NOT_FOUND', message: 'm' });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('imagen: STORAGE_UNAVAILABLE se audita', () => {
    global.fotosPozosModeracionOps_imagen.mockReturnValue({ ok: false, code: 'STORAGE_UNAVAILABLE', message: 'm' });
    lecturas.getFotoPozoModeracion();
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'getFotoPozoModeracion', null, 'STORAGE_UNAVAILABLE');
  });

  test.each([['getHistorialFotoPozo', 'historial'], ['getFotosPozosPendientesModeracion', 'cola'], ['getFotoPozoModeracion', 'imagen']])('%s: si la hoja de eventos no se puede leer -> SERVICE_UNAVAILABLE auditado y sin detalle', (k, op) => {
    global['fotosPozosModeracionOps_' + op].mockImplementation(() => { throw new Error('No existe la hoja "FotosPozoEventos"'); });
    const r = lecturas[k]();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('FotosPozoEventos');
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, k, null, 'SERVICE_UNAVAILABLE');
  });

  test('doPost enruta las tres lecturas', () => {
    const post = (body) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ sessionToken: 't' }, body)) } }).text);
    expect(post({ action: 'getHistorialFotoPozo', fotoId: FOTO, email: 'x@x.com' }).status).toBe('ok');
    expect(post({ action: 'getFotosPozosPendientesModeracion', limit: 5, cursor: 3, estado: 'x' }).status).toBe('ok');
    expect(global.fotosPozosModeracionOps_cola).toHaveBeenLastCalledWith(5, 3);
    expect(post({ action: 'getFotoPozoModeracion', fotoId: FOTO, variante: 'full' }).status).toBe('ok');
    expect(global.fotosPozosModeracionOps_imagen).toHaveBeenLastCalledWith(FOTO, 'full');
  });
});

describe('lecturas de galeria existentes: fail-closed si la hoja de eventos no responde', () => {
  beforeEach(() => como({ fotos: true }));
  test('getFotosPozo / getFotoPozo / getResumenFotosPozos: una excepcion del servicio es SERVICE_UNAVAILABLE (nunca una galeria sin moderar)', () => {
    global.fotosPozosService_listar.mockImplementation(() => { throw new Error('hoja FotosPozoEventos'); });
    global.fotosPozosService_obtenerImagen.mockImplementation(() => { throw new Error('hoja FotosPozoEventos'); });
    global.fotosPozosService_resumen.mockImplementation(() => { throw new Error('hoja FotosPozoEventos'); });
    expect(Api.handleGetFotosPozo('t', '04-0263', '', 'recientes').code).toBe('SERVICE_UNAVAILABLE');
    expect(Api.handleGetFotoPozo('t', FOTO, 'thumb').code).toBe('SERVICE_UNAVAILABLE');
    expect(Api.handleGetResumenFotosPozos('t').code).toBe('SERVICE_UNAVAILABLE');
  });

  test('un permiso de moderacion NO abre el endpoint normal de imagen para nadie: getFotoPozo sigue exigiendo solo fotos', () => {
    como({ fotos_moderar: true });
    expect(Api.handleGetFotoPozo('t', FOTO, 'thumb').code).toBe('PERMISSION_DENIED');
  });
});
