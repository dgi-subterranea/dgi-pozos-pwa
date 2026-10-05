const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Handlers del modulo Reemplazos v1. ReemplazoService/Repository estan
// fakeados (ver appsScriptFakes.js): aca solo se prueba la capa Api -
// orden de chequeos (sesion -> wellId -> permiso -> contenido), gating
// EXCLUSIVO por "reemplazo", identidad que sale solo de la sesion y
// auditoria. La logica de negocio se prueba en ReemplazoService.test.js.
beforeEach(() => {
  installAppsScriptFakes();
  global.ContentService = {
    MimeType: { JSON: 'json' },
    createTextOutput: (text) => ({ setMimeType: () => ({ text }) })
  };
});

function sesion(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'sesion@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.getUserAccess.mockReturnValue({ active: true, nombre: 'Nombre Sesion', permisos: permisos || { reemplazo: true } });
  global.hasPermission.mockImplementation((email, modulo) => !!(permisos || { reemplazo: true })[modulo]);
}

const CON = { perfil: false, datos: false, ubicacion: false, ne: false, reemplazo: true };
const SIN = { perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: false };

describe('permiso reemplazo gatea los 3 endpoints (lectura y escritura)', () => {
  test('reemplazo=NO: PERMISSION_DENIED en estado, historial y registro; nada se lee ni se escribe', () => {
    sesion(SIN);
    const e = Api.handleGetEstadoReemplazo('tok', '04-0263');
    const h = Api.handleGetHistorialReemplazo('tok', '04-0263');
    const r = Api.handleRegistrarEvaluacionReemplazo('tok', '04-0263', 'APTO', '', '', '');
    [e, h, r].forEach((res) => {
      expect(res.status).toBe('error');
      expect(res.code).toBe('PERMISSION_DENIED');
    });
    expect(global.reemplazoService_getEstado).not.toHaveBeenCalled();
    expect(global.reemplazoService_getHistorial).not.toHaveBeenCalled();
    expect(global.reemplazoService_registrar).not.toHaveBeenCalled();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'registrarEvaluacionReemplazo', '04-0263', 'PERMISSION_DENIED');
  });

  test('columna ausente / permiso no concedido (hasPermission false): PERMISSION_DENIED', () => {
    sesion({ perfil: true });
    expect(Api.handleGetEstadoReemplazo('tok', '04-0263').code).toBe('PERMISSION_DENIED');
  });

  test('solo "reemplazo" cuenta: perfil/datos/ubicacion/ne=SI sin reemplazo no alcanza', () => {
    sesion({ perfil: true, datos: true, ubicacion: true, ne: true });
    expect(Api.handleGetHistorialReemplazo('tok', '04-0263').code).toBe('PERMISSION_DENIED');
  });

  test('reemplazo=SI sin ningun otro permiso: accede', () => {
    sesion(CON);
    global.reemplazoService_getEstado.mockReturnValue({ wellId: '04-0263', estado: 'SIN_EVALUAR', ultimaEvaluacion: null });
    expect(Api.handleGetEstadoReemplazo('tok', '04-0263').status).toBe('ok');
  });

  test('sesion invalida: UNAUTHORIZED; usuario deshabilitado: USER_DISABLED (antes que el permiso)', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(Api.handleGetEstadoReemplazo('x', '04-0263').code).toBe('UNAUTHORIZED');
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'a@x.com' });
    global.isUserActive.mockReturnValue(false);
    expect(Api.handleRegistrarEvaluacionReemplazo('x', '04-0263', 'APTO').code).toBe('USER_DISABLED');
  });
});

describe('validacion de wellId (mismo formato actual)', () => {
  test.each(['4-0263', '04-026', 'AB-0263', '20-0263', '00-0263', '', null, undefined])('wellId %p: INVALID_WELL_ID en los 3 endpoints', (wellId) => {
    sesion(CON);
    expect(Api.handleGetEstadoReemplazo('tok', wellId).code).toBe('INVALID_WELL_ID');
    expect(Api.handleGetHistorialReemplazo('tok', wellId).code).toBe('INVALID_WELL_ID');
    expect(Api.handleRegistrarEvaluacionReemplazo('tok', wellId, 'APTO', '', '', '').code).toBe('INVALID_WELL_ID');
    expect(global.reemplazoService_registrar).not.toHaveBeenCalled();
  });
});

describe('getEstadoReemplazo / getHistorialReemplazo', () => {
  test('devuelve el estado calculado por el servicio, sin auditar el caso OK', () => {
    sesion(CON);
    const data = { wellId: '04-0263', estado: 'APTO', ultimaEvaluacion: { evaluacionId: 'x' } };
    global.reemplazoService_getEstado.mockReturnValue(data);
    const r = Api.handleGetEstadoReemplazo('tok', '04-0263');
    expect(r).toEqual({ status: 'ok', data });
    expect(global.reemplazoService_getEstado).toHaveBeenCalledWith('04-0263');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('historial devuelto tal como lo ordena el servicio', () => {
    sesion(CON);
    const data = { wellId: '04-0263', evaluaciones: [{ evaluacionId: 'b' }, { evaluacionId: 'a' }] };
    global.reemplazoService_getHistorial.mockReturnValue(data);
    expect(Api.handleGetHistorialReemplazo('tok', '04-0263')).toEqual({ status: 'ok', data });
  });

  test('falla del servicio/Sheets: SERVICE_UNAVAILABLE y se audita', () => {
    sesion(CON);
    global.reemplazoService_getEstado.mockImplementation(() => { throw new Error('boom'); });
    const r = Api.handleGetEstadoReemplazo('tok', '04-0263');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'getEstadoReemplazo', '04-0263', 'SERVICE_UNAVAILABLE');
  });
});

describe('registrarEvaluacionReemplazo', () => {
  test('identidad de la sesion + hoja Usuarios, contenido del cliente; devuelve la evaluacion creada', () => {
    sesion(CON);
    const evaluacion = { evaluacionId: 'nuevo', estado: 'NO_APTO' };
    global.reemplazoService_registrar.mockReturnValue({ ok: true, evaluacion });

    const r = Api.handleRegistrarEvaluacionReemplazo('tok', '04-0263', 'NO_APTO', 'SECO', 'obs', 'INA 2055');

    expect(r).toEqual({ status: 'ok', data: { evaluacion } });
    expect(global.reemplazoService_registrar).toHaveBeenCalledWith('sesion@example.com', 'Nombre Sesion', '04-0263', {
      estado: 'NO_APTO', motivo: 'SECO', observacion: 'obs', puntoNEReferencia: 'INA 2055'
    });
  });

  test('UNA fila de Historial por evaluacion creada (OK), sin duplicar registerWellSearch ni Telegram', () => {
    sesion(CON);
    global.reemplazoService_registrar.mockReturnValue({ ok: true, evaluacion: {} });
    Api.handleRegistrarEvaluacionReemplazo('tok', '04-0263', 'APTO', '', '', '');
    expect(global.logHistoryEvent).toHaveBeenCalledTimes(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'registrarEvaluacionReemplazo', '04-0263', 'OK');
    expect(global.searchHistoryService_registerSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test.each([
    ['INVALID_ESTADO'], ['INVALID_MOTIVO'], ['MOTIVO_REQUERIDO'], ['OBSERVACION_REQUERIDA'],
    ['ESTADO_MOTIVO_INCOMPATIBLE'], ['INVALID_OBSERVACION'], ['INVALID_PUNTO_NE']
  ])('error de validacion %s del servicio se devuelve tal cual y se audita', (code) => {
    sesion(CON);
    global.reemplazoService_registrar.mockReturnValue({ ok: false, code, message: 'm' });
    const r = Api.handleRegistrarEvaluacionReemplazo('tok', '04-0263', 'X', 'Y', '', '');
    expect(r).toEqual({ status: 'error', code, message: 'm' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'registrarEvaluacionReemplazo', '04-0263', code);
  });

  test('falla al escribir (lock/Sheets): SERVICE_UNAVAILABLE', () => {
    sesion(CON);
    global.reemplazoService_registrar.mockImplementation(() => { throw new Error('lock timeout'); });
    const r = Api.handleRegistrarEvaluacionReemplazo('tok', '04-0263', 'APTO', '', '', '');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('doPost: email/nombre/timestamp/evaluacionId enviados por el frontend se ignoran', () => {
    sesion(CON);
    global.reemplazoService_registrar.mockReturnValue({ ok: true, evaluacion: {} });
    Api.doPost({ postData: { contents: JSON.stringify({
      action: 'registrarEvaluacionReemplazo', sessionToken: 'tok', wellId: '04-0263',
      estado: 'APTO', motivo: '', observacion: '', puntoNEReferencia: '',
      email: 'impostor@x.com', nombre: 'Impostor', timestamp: '1999-01-01', evaluacionId: 'forzado', usuario: 'otro'
    }) } });
    const [email, nombre, wellId, datos] = global.reemplazoService_registrar.mock.calls[0];
    expect(email).toBe('sesion@example.com');
    expect(nombre).toBe('Nombre Sesion');
    expect(wellId).toBe('04-0263');
    expect(Object.keys(datos).sort()).toEqual(['estado', 'motivo', 'observacion', 'puntoNEReferencia']);
  });

  test('doPost enruta las 3 acciones', () => {
    sesion(CON);
    global.reemplazoService_getEstado.mockReturnValue({ estado: 'SIN_EVALUAR' });
    global.reemplazoService_getHistorial.mockReturnValue({ evaluaciones: [] });
    global.reemplazoService_registrar.mockReturnValue({ ok: true, evaluacion: {} });
    const llamar = (body) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
    expect(llamar({ action: 'getEstadoReemplazo', sessionToken: 't', wellId: '04-0263' }).status).toBe('ok');
    expect(llamar({ action: 'getHistorialReemplazo', sessionToken: 't', wellId: '04-0263' }).status).toBe('ok');
    expect(llamar({ action: 'registrarEvaluacionReemplazo', sessionToken: 't', wellId: '04-0263', estado: 'APTO' }).status).toBe('ok');
  });
});
