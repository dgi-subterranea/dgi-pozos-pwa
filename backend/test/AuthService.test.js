const { installAppsScriptFakes } = require('./appsScriptFakes');

// AuthService declara isUserActive/verifySessionToken en su propio scope
// de modulo (CommonJS), asi que cuando handleLogin/handleCheckSession las
// llaman internamente usan las funciones reales de este archivo, no los
// fakes globales - los fakes globales solo importan para llamadas desde
// OTROS archivos (ver Api.test.js). Por eso acá se prueba el
// comportamiento real end-to-end, no solo mocks.
const AuthService = require('../src/AuthService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('handleLogin', () => {
  test('login valido: usuario activo, devuelve sessionToken', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({
        aud: global.GOOGLE_CLIENT_ID,
        email: 'user@example.com',
        name: 'Usuario Ejemplo',
        email_verified: 'true'
      })
    });
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });

    const result = AuthService.handleLogin('un-id-token-cualquiera');

    expect(result.status).toBe('ok');
    expect(result.data.email).toBe('user@example.com');
    expect(typeof result.data.sessionToken).toBe('string');
    expect(result.data.sessionToken.split('.').length).toBe(2);
  });

  test('token de Google invalido (tokeninfo responde distinto de 200): UNAUTHORIZED', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 400,
      getContentText: () => JSON.stringify({ error: 'invalid_token' })
    });

    const result = AuthService.handleLogin('token-invalido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('token valido para Google pero de otra app (aud distinto): UNAUTHORIZED', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ aud: 'otra-app.apps.googleusercontent.com', email: 'user@example.com' })
    });

    const result = AuthService.handleLogin('token-de-otra-app');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('login con usuario deshabilitado en la allowlist: USER_DISABLED, no emite sessionToken', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ aud: global.GOOGLE_CLIENT_ID, email: 'deshabilitado@example.com' })
    });
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false });

    const result = AuthService.handleLogin('token-de-usuario-deshabilitado');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
    expect(result.data).toBeUndefined();
  });

  test('login exitoso devuelve los permisos efectivos del usuario, nunca dentro del sessionToken', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => JSON.stringify({ aud: global.GOOGLE_CLIENT_ID, email: 'user@example.com' })
    });
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: true, datos: true, ubicacion: false, ne: false }
    });

    const result = AuthService.handleLogin('un-id-token-cualquiera');

    expect(result.data.permisos).toEqual({ perfil: true, datos: true, ubicacion: false, ne: false });

    const payloadB64 = result.data.sessionToken.split('.')[0];
    const payload = JSON.parse(global.Utilities.base64DecodeWebSafe(payloadB64).toString('utf8'));
    expect(payload.permisos).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat']);
  });
});

describe('isUserActive', () => {
  test('usuario encontrado y activo devuelve true', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });
    expect(AuthService.isUserActive('user@example.com')).toBe(true);
  });

  test('usuario encontrado pero no activo devuelve false', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false });
    expect(AuthService.isUserActive('inactivo@example.com')).toBe(false);
  });

  test('usuario inexistente en la allowlist devuelve false', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: false, active: false });
    expect(AuthService.isUserActive('desconocido@example.com')).toBe(false);
  });

  test('usuario activo: la segunda llamada no vuelve a consultar la hoja (queda cacheado)', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });
    AuthService.isUserActive('user@example.com');
    AuthService.isUserActive('user@example.com');
    expect(global.sheetUserRepository_getUserStatus).toHaveBeenCalledTimes(1);
  });

  test('usuario inexistente: NO queda cacheado, cada llamada vuelve a consultar la hoja', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: false, active: false });
    AuthService.isUserActive('desconocido@example.com');
    AuthService.isUserActive('desconocido@example.com');
    expect(global.sheetUserRepository_getUserStatus).toHaveBeenCalledTimes(2);
  });

  test('usuario inactivo: NO queda cacheado, cada llamada vuelve a consultar la hoja', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false });
    AuthService.isUserActive('inactivo@example.com');
    AuthService.isUserActive('inactivo@example.com');
    expect(global.sheetUserRepository_getUserStatus).toHaveBeenCalledTimes(2);
  });

  test('alta inmediata: usuario inexistente y luego agregado como activo entra en el intento siguiente, sin esperar el TTL', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValueOnce({ found: false, active: false });
    expect(AuthService.isUserActive('nuevo@example.com')).toBe(false);

    global.sheetUserRepository_getUserStatus.mockReturnValueOnce({ found: true, active: true });
    expect(AuthService.isUserActive('nuevo@example.com')).toBe(true);

    expect(global.sheetUserRepository_getUserStatus).toHaveBeenCalledTimes(2);
  });
});

describe('getUserAccess / hasPermission', () => {
  const permisosCompletos = { perfil: true, datos: true, ubicacion: true, ne: true };

  test('usuario completo: hasPermission true para los 4 modulos', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true, permisos: permisosCompletos });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(true);
  });

  test('usuario solo Perfil: hasPermission true solo para perfil', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: true, datos: false, ubicacion: false, ne: false }
    });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(false);
  });

  test('usuario Perfil + Datos: ubicacion y ne siguen en false', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: true, datos: true, ubicacion: false, ne: false }
    });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(true);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(false);
  });

  test('Ubicacion sin Datos: combinacion valida, cada permiso es independiente', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: false, datos: false, ubicacion: true, ne: false }
    });
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(true);
  });

  test('NE sin Datos: combinacion valida', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: false, datos: false, ubicacion: false, ne: true }
    });
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(true);
  });

  test('permiso "NO": false', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: false, datos: true, ubicacion: false, ne: false }
    });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(false);
  });

  test('permisos ausentes/vacios en la respuesta del repositorio: fail-closed, todo false', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(false);
  });

  test('modulo invalido/desconocido: false, no lanza error', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true, permisos: permisosCompletos });
    expect(AuthService.hasPermission('user@example.com', 'modulo_que_no_existe')).toBe(false);
  });

  test('usuario inactivo aunque tenga los 4 permisos en SI: hasPermission false para todos', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false, permisos: permisosCompletos });
    expect(AuthService.hasPermission('user@example.com', 'perfil')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ubicacion')).toBe(false);
    expect(AuthService.hasPermission('user@example.com', 'ne')).toBe(false);
  });

  test('usuario inexistente en la hoja: hasPermission false, sin lanzar error', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: false, active: false, permisos: {} });
    expect(AuthService.hasPermission('desconocido@example.com', 'perfil')).toBe(false);
  });

  test('permisos se cachean junto con el estado activo (una sola consulta a la hoja para ambos)', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true, permisos: permisosCompletos });
    AuthService.isUserActive('user@example.com');
    AuthService.hasPermission('user@example.com', 'datos');
    AuthService.hasPermission('user@example.com', 'ne');
    expect(global.sheetUserRepository_getUserStatus).toHaveBeenCalledTimes(1);
  });

  test('cambio de permisos compatible con sesion existente: el token no cambia, hasPermission refleja el nuevo valor apenas vence el cache', () => {
    const token = AuthService.createSessionToken('user@example.com');

    global.sheetUserRepository_getUserStatus.mockReturnValueOnce({
      found: true, active: true, permisos: { perfil: true, datos: false, ubicacion: false, ne: false }
    });
    expect(AuthService.hasPermission('user@example.com', 'datos')).toBe(false);

    // El mismo token sigue siendo valido - la sesion nunca dependio de
    // los permisos, solo de la identidad/expiracion.
    const stillValid = AuthService.verifySessionToken(token);
    expect(stillValid.valid).toBe(true);
    expect(stillValid.email).toBe('user@example.com');
    // El payload del token nunca tuvo permisos, no hay nada que migrar.
    expect(stillValid.permisos).toBeUndefined();
  });
});

describe('createSessionToken + verifySessionToken', () => {
  test('un token recien creado es valido', () => {
    const token = AuthService.createSessionToken('user@example.com');
    const result = AuthService.verifySessionToken(token);
    expect(result.valid).toBe(true);
    expect(result.email).toBe('user@example.com');
  });

  test('token con la firma alterada es rechazado', () => {
    const token = AuthService.createSessionToken('user@example.com');
    const tampered = token + 'x';
    const result = AuthService.verifySessionToken(tampered);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('firma invalida');
  });

  test('token con exp en el pasado es rechazado', () => {
    const payload = JSON.stringify({ email: 'user@example.com', iat: 1000, exp: 1000 });
    const payloadB64 = global.Utilities.base64EncodeWebSafe(payload);
    const signature = AuthService.signPayload(payloadB64);
    const expiredToken = payloadB64 + '.' + signature;

    const result = AuthService.verifySessionToken(expiredToken);

    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expirado');
  });

  test('token con formato invalido (sin punto) es rechazado', () => {
    const result = AuthService.verifySessionToken('esto-no-es-un-token');
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('formato invalido');
  });
});

describe('handleCheckSession', () => {
  test('sesion valida y usuario activo -> ok, renueva el sessionToken (rolling/sliding)', () => {
    // iat se trunca a segundos (Math.floor(Date.now()/1000)): sin avanzar
    // el reloj, crear dos tokens en el mismo segundo daria el mismo
    // payload y por lo tanto el mismo token, aunque la renovacion sea
    // igualmente correcta. Se avanza el tiempo (sin salir de fake timers
    // hasta el final, para no invalidar despues la verificacion por
    // exp) para que la diferencia sea observable, como pasaria en un
    // caso real (login y luego, mas tarde, un checkSession).
    jest.useFakeTimers({ doNotFake: ['nextTick'] });
    jest.setSystemTime(new Date());
    const token = AuthService.createSessionToken('user@example.com');

    jest.setSystemTime(new Date(Date.now() + 24 * 60 * 60 * 1000));
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });

    const result = AuthService.handleCheckSession(token);

    expect(result.status).toBe('ok');
    expect(result.data.email).toBe('user@example.com');
    expect(typeof result.data.sessionToken).toBe('string');
    expect(result.data.sessionToken).not.toBe(token);

    const renewed = AuthService.verifySessionToken(result.data.sessionToken);
    expect(renewed.valid).toBe(true);
    expect(renewed.email).toBe('user@example.com');

    jest.useRealTimers();
  });

  test('el sessionToken renovado vale por otros 30 dias (2592000s)', () => {
    const token = AuthService.createSessionToken('user@example.com');
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });

    const result = AuthService.handleCheckSession(token);

    const payloadB64 = result.data.sessionToken.split('.')[0];
    const payload = JSON.parse(global.Utilities.base64DecodeWebSafe(payloadB64).toString('utf8'));
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
  });

  test('sesion valida pero usuario deshabilitado -> USER_DISABLED, no emite sessionToken nuevo', () => {
    const token = AuthService.createSessionToken('user@example.com');
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false });

    const result = AuthService.handleCheckSession(token);

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
    expect(result.data).toBeUndefined();
  });

  test('token invalido -> UNAUTHORIZED', () => {
    const result = AuthService.handleCheckSession('token-truchisimo');
    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('checkSession devuelve los permisos vigentes (pueden haber cambiado desde el login original)', () => {
    const token = AuthService.createSessionToken('user@example.com');
    global.sheetUserRepository_getUserStatus.mockReturnValue({
      found: true, active: true, permisos: { perfil: true, datos: false, ubicacion: true, ne: false }
    });

    const result = AuthService.handleCheckSession(token);

    expect(result.data.permisos).toEqual({ perfil: true, datos: false, ubicacion: true, ne: false });
  });
});
