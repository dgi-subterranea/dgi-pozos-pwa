const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Handlers de correcciones de ubicacion. El servicio esta fakeado (ver appsScriptFakes.js): aca solo se prueba la capa Api -
// permisos FAIL-CLOSED (ubicacion + ubicacion_corregir para proponer; ubicacion + ubicacion_validar para la cola, validar,
// rechazar y revertir; ubicacion para leer), orden de chequeos (sesion -> wellId -> permiso -> contenido), identidad que sale solo de
// la sesion, lista blanca de campos en doPost y auditoria en Historial. La logica de negocio vive en UbicacionCorreccionService.test.js.
const W = '04-0263';
const ID = '11111111-1111-4111-8111-111111111111';
const CUERPO = { wellId: W, lat: -32.9, lon: -68.8, metodo: 'GPS_ACTUAL', precisionGpsM: 12, observacion: 'ok', clientRequestId: 'req-00000001' };

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ setMimeType: () => ({ text }) }) };
});

function sesion(permisos, activo) {
  const p = permisos || {};
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'sesion@example.com' });
  global.isUserActive.mockReturnValue(activo !== false);
  global.getUserAccess.mockReturnValue({ active: activo !== false, nombre: 'Nombre Sesion', permisos: p });
  global.hasPermission.mockImplementation((email, modulo) => activo !== false && p[modulo] === true);
}

const vista = { correccionId: ID, wellId: W, estado: 'PROPUESTA' };
function servicioOk() {
  global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: true, correccion: vista, duplicada: false });
  global.ubicacionCorreccionService_getPorPozo.mockReturnValue({ wellId: W, vigente: null, pendientes: [], historial: [] });
  global.ubicacionCorreccionService_getPendientes.mockReturnValue({ total: 0, pendientes: [] });
  ['validar', 'rechazar', 'revertir'].forEach((a) => global['ubicacionCorreccionService_' + a].mockReturnValue({ ok: true, correccion: vista, supersedidas: [] }));
}

const llamadas = {
  proponer: () => Api.handleProponerCorreccionUbicacion('tok', CUERPO),
  getPozo: () => Api.handleGetCorreccionesUbicacionPozo('tok', W),
  pendientes: () => Api.handleGetCorreccionesUbicacionPendientes('tok'),
  validar: () => Api.handleValidarCorreccionUbicacion('tok', ID, 'ok'),
  rechazar: () => Api.handleRechazarCorreccionUbicacion('tok', ID, 'no coincide'),
  revertir: () => Api.handleRevertirCorreccionUbicacion('tok', ID, 'error')
};
const exige = {
  proponer: ['ubicacion', 'ubicacion_corregir'],
  getPozo: ['ubicacion'],
  pendientes: ['ubicacion', 'ubicacion_validar'],
  validar: ['ubicacion', 'ubicacion_validar'],
  rechazar: ['ubicacion', 'ubicacion_validar'],
  revertir: ['ubicacion', 'ubicacion_validar']
};
const servicioDe = {
  proponer: 'ubicacionCorreccionService_proponer',
  getPozo: 'ubicacionCorreccionService_getPorPozo',
  pendientes: 'ubicacionCorreccionService_getPendientes',
  validar: 'ubicacionCorreccionService_validar',
  rechazar: 'ubicacionCorreccionService_rechazar',
  revertir: 'ubicacionCorreccionService_revertir'
};
const accionDe = {
  proponer: 'proponerCorreccionUbicacion', getPozo: 'getCorreccionesUbicacionPozo', pendientes: 'getCorreccionesUbicacionPendientes',
  validar: 'validarCorreccionUbicacion', rechazar: 'rechazarCorreccionUbicacion', revertir: 'revertirCorreccionUbicacion'
};
const NOMBRES = Object.keys(llamadas);
const PERMISOS = ['ubicacion', 'ubicacion_corregir', 'ubicacion_validar'];

function subconjuntos() {
  const out = [];
  for (let m = 0; m < 8; m++) {
    const set = {};
    PERMISOS.forEach((p, i) => { if (m & (1 << i)) { set[p] = true; } });
    out.push(set);
  }
  return out;
}

describe('matriz de permisos (fail-closed): cada endpoint exige EXACTAMENTE sus permisos', () => {
  NOMBRES.forEach((nombre) => {
    subconjuntos().forEach((set) => {
      const permitido = exige[nombre].every((p) => set[p] === true);
      const titulo = nombre + ' con {' + Object.keys(set).join(', ') + '}: ' + (permitido ? 'accede' : 'PERMISSION_DENIED');
      test(titulo, () => {
        servicioOk();
        sesion(Object.assign({ perfil: true, datos: true, ne: true, reemplazo: true, fotos: true, fotos_carga: true }, set));
        const r = llamadas[nombre]();
        if (permitido) {
          expect(r.status).toBe('ok');
          expect(global[servicioDe[nombre]]).toHaveBeenCalledTimes(1);
        } else {
          expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
          expect(global[servicioDe[nombre]]).not.toHaveBeenCalled();
          expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', accionDe[nombre], nombre === 'proponer' || nombre === 'getPozo' ? W : null, 'PERMISSION_DENIED');
        }
      });
    });
  });

  test('ninguno de los otros permisos (perfil, datos, ne, reemplazo, fotos...) alcanza', () => {
    servicioOk();
    sesion({ perfil: true, datos: true, ne: true, reemplazo: true, fotos: true, fotos_carga: true });
    NOMBRES.forEach((n) => expect(llamadas[n]().code).toBe('PERMISSION_DENIED'));
  });

  test('un permiso desconocido / ausente de la sesion es false (hasPermission nunca asume acceso)', () => {
    servicioOk();
    sesion({ ubicacion: true, ubicacion_corregir: 'SI', ubicacion_validar: 1 });
    expect(llamadas.proponer().code).toBe('PERMISSION_DENIED');
    expect(llamadas.validar().code).toBe('PERMISSION_DENIED');
  });

  test('los permisos nuevos no abren los endpoints viejos: sin "ubicacion", corregir+validar no leen la ubicacion', () => {
    sesion({ ubicacion_corregir: true, ubicacion_validar: true });
    expect(Api.handleGetWellLocation('tok', W).code).toBe('PERMISSION_DENIED');
  });

  test('proponer y validar son independientes: corregir=SI no valida; validar=SI no propone', () => {
    servicioOk();
    sesion({ ubicacion: true, ubicacion_corregir: true });
    expect(llamadas.proponer().status).toBe('ok');
    expect(llamadas.validar().code).toBe('PERMISSION_DENIED');
    expect(llamadas.pendientes().code).toBe('PERMISSION_DENIED');
    sesion({ ubicacion: true, ubicacion_validar: true });
    expect(llamadas.validar().status).toBe('ok');
    expect(llamadas.proponer().code).toBe('PERMISSION_DENIED');
  });
});

describe('sesion y usuario activo', () => {
  test.each(NOMBRES)('%s: sesion invalida = UNAUTHORIZED (antes que cualquier permiso)', (n) => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(llamadas[n]().code).toBe('UNAUTHORIZED');
    expect(global[servicioDe[n]]).not.toHaveBeenCalled();
  });

  test.each(NOMBRES)('%s: usuario deshabilitado = USER_DISABLED aunque tenga todos los permisos', (n) => {
    sesion({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true }, false);
    expect(llamadas[n]().code).toBe('USER_DISABLED');
    expect(global[servicioDe[n]]).not.toHaveBeenCalled();
  });
});

describe('formato de wellId (mismo criterio que el resto)', () => {
  test.each(['4-0263', '04-026', 'AB-0263', '20-0263', '00-0263', '', null, undefined])('wellId %p: INVALID_WELL_ID en proponer y en la lectura por pozo, antes que el permiso', (wellId) => {
    sesion({});                                  // ni siquiera tiene permisos
    expect(Api.handleProponerCorreccionUbicacion('tok', Object.assign({}, CUERPO, { wellId })).code).toBe('INVALID_WELL_ID');
    expect(Api.handleGetCorreccionesUbicacionPozo('tok', wellId).code).toBe('INVALID_WELL_ID');
    expect(global.ubicacionCorreccionService_proponer).not.toHaveBeenCalled();
  });
});

describe('identidad y lista blanca de campos (por doPost)', () => {
  const post = (cuerpo) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).text);

  test('proponer: la identidad sale de la sesion y los campos ajenos (email, snapshot, estado, distancia) NO llegan al servicio', () => {
    servicioOk();
    sesion({ ubicacion: true, ubicacion_corregir: true });
    const r = post({
      action: 'proponerCorreccionUbicacion', sessionToken: 'tok', ...CUERPO,
      email: 'otro@x.com', nombre: 'Falso', emailPropone: 'otro@x.com', nombrePropone: 'Falso', timestamp: '2000-01-01', correccionId: 'x',
      irrLat: 1, irrLon: 2, irrEstado: 'corroborada', irrFuente: 'x', padronPeriodo: '1999-01', distanciaM: 0, advertenciaDistancia: false, estado: 'VALIDADA'
    });
    expect(r.status).toBe('ok');
    expect(global.ubicacionCorreccionService_proponer).toHaveBeenCalledWith('sesion@example.com', 'Nombre Sesion', W, {
      lat: -32.9, lon: -68.8, metodo: 'GPS_ACTUAL', precisionGpsM: 12, observacion: 'ok', clientRequestId: 'req-00000001'
    });
  });

  test.each(['validar', 'rechazar', 'revertir'])('%s: usa la identidad de la sesion; solo correccionId y motivo del cliente', (n) => {
    servicioOk();
    sesion({ ubicacion: true, ubicacion_validar: true });
    const r = post({ action: accionDe[n] + '', sessionToken: 'tok', correccionId: ID, motivo: 'm', email: 'otro@x.com', nombre: 'Falso' });
    expect(r.status).toBe('ok');
    expect(global[servicioDe[n]]).toHaveBeenCalledWith('sesion@example.com', 'Nombre Sesion', ID, 'm');
  });

  test('las 6 acciones estan ruteadas en doPost', () => {
    servicioOk();
    sesion({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true });
    NOMBRES.forEach((n) => {
      const r = post({ action: accionDe[n], sessionToken: 'tok', wellId: W, correccionId: ID, motivo: 'm', ...CUERPO });
      expect(r.status).toBe('ok');
    });
  });

  test('una accion desconocida sigue fallando como antes', () => {
    expect(post({ action: 'borrarCorreccionUbicacion', sessionToken: 'tok' }).code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('respuestas', () => {
  test('proponer devuelve {correccion, duplicada}; resolver devuelve {correccion, supersedidas}', () => {
    servicioOk();
    global.ubicacionCorreccionService_validar.mockReturnValue({ ok: true, correccion: vista, supersedidas: ['a', 'b'] });
    sesion({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true });
    expect(llamadas.proponer().data).toEqual({ correccion: vista, duplicada: false, curada: false });
    expect(llamadas.validar().data).toEqual({ correccion: vista, supersedidas: ['a', 'b'] });
    expect(llamadas.rechazar().data).toEqual({ correccion: vista, supersedidas: [] });
    expect(llamadas.getPozo().data.wellId).toBe(W);
    expect(llamadas.pendientes().data).toEqual({ total: 0, pendientes: [] });
  });

  test('errores de negocio: code + message; OBSERVACION_REQUERIDA suma la distancia calculada', () => {
    sesion({ ubicacion: true, ubicacion_corregir: true });
    global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: false, code: 'OBSERVACION_REQUERIDA', message: 'falta', distanciaM: 412.5 });
    expect(llamadas.proponer()).toEqual({ status: 'error', code: 'OBSERVACION_REQUERIDA', message: 'falta', distanciaM: 412.5 });
    global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: false, code: 'PRECISION_INSUFICIENTE', message: 'GPS malo' });
    expect(llamadas.proponer()).toEqual({ status: 'error', code: 'PRECISION_INSUFICIENTE', message: 'GPS malo' });
  });

  test('si el servicio falla: SERVICE_UNAVAILABLE (y no se pierde la auditoria)', () => {
    sesion({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true });
    NOMBRES.forEach((n) => global[servicioDe[n]].mockImplementation(() => { throw new Error('Sheets caido'); }));
    NOMBRES.forEach((n) => {
      expect(llamadas[n]()).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'proponerCorreccionUbicacion', W, 'SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'validarCorreccionUbicacion', null, 'SERVICE_UNAVAILABLE');
  });
});

describe('auditoria en Historial', () => {
  beforeEach(() => sesion({ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true }));

  test('propuesta, validacion, rechazo y reversion OK dejan una fila cada una (con el wellId de la correccion)', () => {
    servicioOk();
    llamadas.proponer();
    llamadas.validar();
    llamadas.rechazar();
    llamadas.revertir();
    const filas = global.logHistoryEvent.mock.calls;
    expect(filas).toEqual([
      ['sesion@example.com', 'proponerCorreccionUbicacion', W, 'OK'],
      ['sesion@example.com', 'validarCorreccionUbicacion', W, 'OK'],
      ['sesion@example.com', 'rechazarCorreccionUbicacion', W, 'OK'],
      ['sesion@example.com', 'revertirCorreccionUbicacion', W, 'OK']
    ]);
  });

  test('un reenvio idempotente (duplicada) NO vuelve a auditarse', () => {
    global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: true, correccion: vista, duplicada: true });
    expect(llamadas.proponer().data.duplicada).toBe(true);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('un reintento que AUTOCURA una escritura parcial queda en Historial como AUTOCURADA (y la respuesta lo indica)', () => {
    global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: true, correccion: vista, duplicada: true, curada: true });
    const r = llamadas.proponer();
    expect(r.data).toEqual({ correccion: vista, duplicada: true, curada: true });
    expect(global.logHistoryEvent).toHaveBeenCalledTimes(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'proponerCorreccionUbicacion', W, 'AUTOCURADA');
  });

  test('las lecturas OK no se auditan (alta frecuencia, sin efectos)', () => {
    servicioOk();
    llamadas.getPozo();
    llamadas.pendientes();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test.each([
    ['validar', 'INVALID_TRANSITION'], ['validar', 'SELF_VALIDATION'], ['rechazar', 'INVALID_TRANSITION'], ['revertir', 'INVALID_TRANSITION'],
    ['validar', 'CORRECCION_NOT_FOUND'], ['rechazar', 'INVALID_MOTIVO'], ['rechazar', 'SELF_REJECTION'], ['validar', 'INCONSISTENT_STATE'],
    ['rechazar', 'INCONSISTENT_STATE'], ['revertir', 'INCONSISTENT_STATE']
  ])('%s: el error %s se audita con el wellId de la correccion (o null si no se encontro)', (n, code) => {
    global[servicioDe[n]].mockReturnValue({ ok: false, code, message: 'x', wellId: code === 'CORRECCION_NOT_FOUND' || code === 'INVALID_MOTIVO' ? undefined : W });
    const r = llamadas[n]();
    expect(r).toMatchObject({ status: 'error', code });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', accionDe[n], code === 'CORRECCION_NOT_FOUND' || code === 'INVALID_MOTIVO' ? null : W, code);
  });

  test('proponer: los errores de validacion se auditan con el wellId', () => {
    global.ubicacionCorreccionService_proponer.mockReturnValue({ ok: false, code: 'FUERA_DE_MENDOZA', message: 'x' });
    llamadas.proponer();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('sesion@example.com', 'proponerCorreccionUbicacion', W, 'FUERA_DE_MENDOZA');
  });

  test('sin Telegram ni notificaciones (ninguna accion de esta etapa avisa a nadie)', () => {
    servicioOk();
    NOMBRES.forEach((n) => llamadas[n]());
    expect(global.telegramRepository_sendMessage).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });
});
