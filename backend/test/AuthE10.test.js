// E10-1: autenticacion. (1) email_verified en modo OBSERVAR / EXIGIR (aud, usuario inexistente / inactivo, nunca el token ni el valor crudo). (2) acceso efectivo con tipo. (3) cache v2, invalidacion
// inmediata y tombstone. (4) compatibilidad: usuarios actuales (hoja SIN columnas de E10), sesiones existentes. Modulos reales; Google y las hojas, falsos.
const { crearEntornoE10, filaDe, COLS_ACTUALES, PERMISOS_DE_SIEMPRE, ADMIN1 } = require('./e10Entorno');

let E;
const tokeninfo = (extra) => {
  global.UrlFetchApp.fetch.mockReturnValue({
    getResponseCode: () => 200,
    getContentText: () => JSON.stringify(Object.assign({ aud: global.GOOGLE_CLIENT_ID, email: 'interno@x.com', name: 'Interno', email_verified: 'true' }, extra || {}))
  });
};
const sinCampo = (campo) => {
  global.UrlFetchApp.fetch.mockReturnValue({
    getResponseCode: () => 200,
    getContentText: () => { const o = { aud: global.GOOGLE_CLIENT_ID, email: 'interno@x.com', name: 'Interno', email_verified: 'true' }; delete o[campo]; return JSON.stringify(o); }
  });
};
const login = () => E.Auth.handleLogin('un-id-token-secreto-1234567890');
const filasHistorial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());
beforeEach(() => { E = crearEntornoE10(); tokeninfo(); });

describe('email_verified: categorias seguras', () => {
  test.each([
    [true, 'VERDADERO'], ['true', 'VERDADERO'], [false, 'FALSO'], ['false', 'FALSO'], [undefined, 'AUSENTE'], [null, 'AUSENTE'], ['', 'AUSENTE'],
    ['TRUE', 'OTRO'], ['1', 'OTRO'], [1, 'OTRO'], [0, 'OTRO'], ['si', 'OTRO'], [{}, 'OTRO'], [[], 'OTRO']
  ])('%j -> %s', (valor, categoria) => {
    expect(E.Auth.authService_clasificarEmailVerified(valor)).toBe(categoria);
  });
});

describe('modo OBSERVAR (rollout inicial: propiedad ausente o OBSERVAR)', () => {
  test.each([[true], ['true'], [false], ['false'], [null], ['TRUE'], ['1'], [{}]])('email_verified %j: el login NO se bloquea y entra un usuario activo', (valor) => {
    tokeninfo({ email_verified: valor });
    const r = login();
    expect(r.status).toBe('ok');
    expect(r.data.email).toBe('interno@x.com');
  });

  test('email_verified AUSENTE del token: tampoco se bloquea', () => {
    sinCampo('email_verified');
    expect(login().status).toBe('ok');
  });

  test.each([
    ['true', 'EMAIL_VERIFIED_VERDADERO'], [true, 'EMAIL_VERIFIED_VERDADERO'], ['false', 'EMAIL_VERIFIED_FALSO'], [false, 'EMAIL_VERIFIED_FALSO'], ['x', 'EMAIL_VERIFIED_OTRO']
  ])('registra en Historial SOLO la categoria (%j -> %s)', (valor, resultado) => {
    tokeninfo({ email_verified: valor });
    login();
    expect(filasHistorial()).toContainEqual(['interno@x.com', 'login', null, resultado]);
  });

  test('ausente -> categoria AUSENTE', () => {
    sinCampo('email_verified');
    login();
    expect(filasHistorial()).toContainEqual(['interno@x.com', 'login', null, 'EMAIL_VERIFIED_AUSENTE']);
  });

  test('NUNCA se guarda el token, el idToken ni el valor crudo de la claim', () => {
    tokeninfo({ email_verified: 'valor-crudo-raro-xyz' });
    login();
    const todo = JSON.stringify(filasHistorial()) + JSON.stringify(global.Logger.log.mock.calls);
    expect(todo).not.toContain('un-id-token-secreto-1234567890');
    expect(todo).not.toContain('valor-crudo-raro-xyz');
    expect(todo).not.toMatch(/idToken|sessionToken/i);
  });

  test('modo explicito OBSERVAR se comporta igual que la propiedad ausente', () => {
    global.__propiedades.EMAIL_VERIFIED_MODO = 'OBSERVAR';
    tokeninfo({ email_verified: 'false' });
    expect(login().status).toBe('ok');
  });

  test('valor invalido de la propiedad: OBSERVAR (no bloquea) y el login deja visible el modo invalido', () => {
    global.__propiedades.EMAIL_VERIFIED_MODO = 'OBSERBAR';
    tokeninfo({ email_verified: 'false' });
    expect(login().status).toBe('ok');
    expect(filasHistorial()).toContainEqual(['interno@x.com', 'login', null, 'EMAIL_VERIFIED_FALSO_MODO_INVALIDO']);
  });

  test('la respuesta del login conserva emailVerified normalizado a booleano', () => {
    tokeninfo({ email_verified: 'true' });
    expect(login().data.emailVerified).toBe(true);
    tokeninfo({ email_verified: 'false' });
    expect(login().data.emailVerified).toBe(false);
  });
});

describe('modo EXIGIR', () => {
  beforeEach(() => { global.__propiedades.EMAIL_VERIFIED_MODO = 'EXIGIR'; });

  test.each([['true'], [true]])('email_verified %j: entra', (valor) => {
    tokeninfo({ email_verified: valor });
    expect(login().status).toBe('ok');
  });

  test.each([['false'], [false], [null], [''], ['TRUE'], ['1'], [1], ['si'], [{}], [[]]])('email_verified %j: EMAIL_NO_VERIFICADO, sin sesion', (valor) => {
    tokeninfo({ email_verified: valor });
    const r = login();
    expect(r).toMatchObject({ status: 'error', code: 'EMAIL_NO_VERIFICADO' });
    expect(r.data).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain('sessionToken');
  });

  test('email_verified ausente del token: EMAIL_NO_VERIFICADO', () => {
    sinCampo('email_verified');
    expect(login()).toMatchObject({ status: 'error', code: 'EMAIL_NO_VERIFICADO' });
  });

  test('se audita el rechazo con un codigo fijo (nunca el valor crudo)', () => {
    tokeninfo({ email_verified: 'raro' });
    login();
    expect(filasHistorial()).toContainEqual(['interno@x.com', 'login', null, 'EMAIL_NO_VERIFICADO']);
    expect(JSON.stringify(filasHistorial())).not.toContain('raro');
  });

  test('el rechazo ocurre ANTES de consultar la hoja Usuarios (ni siquiera revela si el usuario existe)', () => {
    tokeninfo({ email: 'inexistente@x.com', email_verified: 'false' });
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    expect(login()).toMatchObject({ code: 'EMAIL_NO_VERIFICADO' });
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
  });

  test('usuario inexistente o inactivo con email verificado: USER_DISABLED (como siempre)', () => {
    tokeninfo({ email: 'inexistente@x.com' });
    expect(login()).toMatchObject({ code: 'USER_DISABLED' });
    tokeninfo({ email: 'baja@x.com' });
    expect(login()).toMatchObject({ code: 'USER_DISABLED' });
  });

  test('el mensaje del error no incluye el valor crudo ni el token', () => {
    tokeninfo({ email_verified: 'valor-crudo-raro' });
    expect(JSON.stringify(login())).not.toMatch(/valor-crudo-raro|un-id-token-secreto/);
  });

  test('checkSession no se toca: una sesion ya emitida sigue valida aunque el modo sea EXIGIR', () => {
    const token = E.Auth.createSessionToken('interno@x.com');
    expect(E.Auth.handleCheckSession(token).status).toBe('ok');
  });
});

describe('orden de chequeos del login y casos de entrada', () => {
  test('aud invalido: UNAUTHORIZED aunque el modo sea EXIGIR; no consulta la hoja', () => {
    global.__propiedades.EMAIL_VERIFIED_MODO = 'EXIGIR';
    tokeninfo({ aud: 'otro-client-id', email_verified: 'true' });
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    expect(login()).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
  });

  test.each([[undefined], [null], [''], ['   '], [42], [{}]])('token sin email valido (%j): UNAUTHORIZED, sin consultar la hoja', (email) => {
    tokeninfo({ email });
    if (email === undefined) { sinCampo('email'); }
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    expect(login()).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
  });

  test('tokeninfo distinto de 200 y red caida: igual que antes', () => {
    global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 400, getContentText: () => JSON.stringify({ error: 'invalid_token' }) });
    expect(login()).toMatchObject({ code: 'UNAUTHORIZED' });
    global.UrlFetchApp.fetch.mockImplementation(() => { throw new Error('red'); });
    expect(login()).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  test('sin idToken: UNAUTHORIZED sin llamar a Google', () => {
    expect(E.Auth.handleLogin('')).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test('el email verificado y activo de un usuario del catalogo recibe TODOS los ids de permisos del catalogo', () => {
    const r = login();
    expect(Object.keys(r.data.permisos).sort()).toEqual(global.permisosCatalogo_ids().sort());
  });
});

describe('acceso efectivo con tipo', () => {
  test('un EXTERNO activo inicia sesion y conserva EXACTAMENTE sus permisos (tipo no concede ni quita)', () => {
    tokeninfo({ email: 'externo@x.com' });
    const r = login();
    expect(r.status).toBe('ok');
    expect(global.permisosCatalogo_aLista(r.data.permisos)).toEqual(['perfil', 'perfil_subir', 'ubicacion', 'mapa']);
  });

  test('E10_GESTION_EXTERNOS_ACTIVO apagado NO afecta el acceso de un externo existente (el flag gobierna solo las altas nuevas)', () => {
    expect(global.__propiedades.E10_GESTION_EXTERNOS_ACTIVO).toBeUndefined();
    tokeninfo({ email: 'externo@x.com' });
    expect(login().status).toBe('ok');
    expect(E.Auth.hasPermission('externo@x.com', 'perfil_subir')).toBe(true);
  });

  test('un administrador INTERNO tiene usuarios_admin efectivo; el mismo usuario pasado a EXTERNO en la hoja lo pierde', () => {
    expect(E.Auth.hasPermission(ADMIN1, 'usuarios_admin')).toBe(true);
    const idx = E.hojas.Usuarios.filas[0].indexOf('tipo');
    E.hojas.Usuarios.filas[1][idx] = 'EXTERNO';
    E.cache.estado.store = {};
    expect(E.Auth.hasPermission(ADMIN1, 'usuarios_admin')).toBe(false);
    expect(E.Auth.hasPermission(ADMIN1, 'perfil')).toBe(true);
  });

  test('tipo vacio o invalido en la hoja: usuarios_admin no es efectivo y el resto del acceso no cambia', () => {
    const idx = E.hojas.Usuarios.filas[0].indexOf('tipo');
    E.hojas.Usuarios.filas[1][idx] = '';
    E.cache.estado.store = {};
    expect(E.Auth.hasPermission(ADMIN1, 'usuarios_admin')).toBe(false);
    expect(E.Auth.isUserActive(ADMIN1)).toBe(true);
    expect(E.Auth.hasPermission(ADMIN1, 'datos')).toBe(true);
  });
});

describe('compatibilidad: usuarios actuales (hoja SIN las columnas de E10) y sesiones existentes', () => {
  let C;
  beforeEach(() => {
    C = crearEntornoE10({ header: COLS_ACTUALES, usuarios: [{ email: 'interno@x.com', nombre: 'Interno', permisos: ['perfil', 'datos', 'ubicacion', 'ne', 'fotos', 'ubicacion_corregir'] }, { email: 'baja@x.com', estado: 'inactivo', permisos: ['perfil'] }] });
    tokeninfo();
  });

  test('el login de un usuario actual funciona igual (hoja sin tipo/version/mapa/usuarios_admin) y recibe sus permisos', () => {
    const r = C.Auth.handleLogin('t');
    expect(r.status).toBe('ok');
    expect(global.permisosCatalogo_aLista(r.data.permisos)).toEqual(['perfil', 'datos', 'ubicacion', 'ubicacion_corregir', 'ne', 'fotos']);
    expect(r.data.permisos.mapa).toBe(false);                 // fail-closed: la columna todavia no existe
    expect(r.data.permisos.usuarios_admin).toBe(false);
  });

  test('inactivo e inexistente: USER_DISABLED como siempre', () => {
    tokeninfo({ email: 'baja@x.com' });
    expect(C.Auth.handleLogin('t').code).toBe('USER_DISABLED');
    tokeninfo({ email: 'nadie@x.com' });
    expect(C.Auth.handleLogin('t').code).toBe('USER_DISABLED');
  });

  test('una sesion existente (token de antes) sigue valida: checkSession devuelve los permisos del catalogo', () => {
    const token = C.Auth.createSessionToken('interno@x.com');
    const r = C.Auth.handleCheckSession(token);
    expect(r.status).toBe('ok');
    expect(r.data.email).toBe('interno@x.com');
    expect(r.data.permisos.perfil).toBe(true);
    expect(Object.keys(r.data.permisos)).toHaveLength(17);
    expect(JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).permisos).toBeUndefined();
  });

  test('el token no cambio de forma: solo email, iat y exp (los permisos nunca viajan en el token)', () => {
    const token = C.Auth.createSessionToken('interno@x.com');
    expect(Object.keys(JSON.parse(Buffer.from(token.split('.')[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString())).sort()).toEqual(['email', 'exp', 'iat']);
  });
});

describe('cache v2, invalidacion inmediata y tombstone', () => {
  const clave = (email) => 'user_access_v2_' + email;
  const tomb = (email) => 'user_access_inv_' + email;

  test('un usuario activo se cachea con la clave v2 (los permisos efectivos); las entradas viejas user_access_<email> nunca se leen', () => {
    E.cache.put('user_access_interno@x.com', JSON.stringify({ active: true, permisos: { usuarios_admin: true }, nombre: 'VIEJO' }));
    const a = E.Auth.getUserAccess('interno@x.com');
    expect(a.nombre).toBe('Interno Consulta');
    expect(a.permisos.usuarios_admin).toBe(false);
    expect(JSON.parse(E.cache.get(clave('interno@x.com'))).active).toBe(true);
  });

  test('solo se cachea lo positivo: inexistente e inactivo no quedan en cache', () => {
    E.Auth.getUserAccess('nadie@x.com');
    E.Auth.getUserAccess('baja@x.com');
    expect(E.cache.get(clave('nadie@x.com'))).toBeNull();
    expect(E.cache.get(clave('baja@x.com'))).toBeNull();
  });

  test('sin invalidar, un cambio manual en la hoja tarda hasta el TTL (comportamiento aceptado para ediciones manuales)', () => {
    E.Auth.getUserAccess('interno@x.com');
    const idx = E.hojas.Usuarios.filas[0].indexOf('estado');
    E.hojas.Usuarios.filas[3][idx] = 'inactivo';
    expect(E.Auth.isUserActive('interno@x.com')).toBe(true);        // cacheado
  });

  test('authService_invalidarAcceso: borra la clave, deja un tombstone corto y el cambio se ve en la SIGUIENTE request', () => {
    E.Auth.getUserAccess('interno@x.com');
    const idx = E.hojas.Usuarios.filas[0].indexOf('estado');
    E.hojas.Usuarios.filas[3][idx] = 'inactivo';
    expect(E.Auth.authService_invalidarAcceso('Interno@X.com')).toEqual({ ok: true });
    expect(E.cache.get(clave('interno@x.com'))).toBeNull();
    expect(E.cache.get(tomb('interno@x.com'))).toBe('1');
    expect(E.Auth.isUserActive('interno@x.com')).toBe(false);
  });

  test('quitar un permiso, agregarlo y desactivar son efectivos en la siguiente request', () => {
    const header = E.hojas.Usuarios.filas[0];
    const fila = E.hojas.Usuarios.filas[3];
    expect(E.Auth.hasPermission('interno@x.com', 'datos')).toBe(true);
    fila[header.indexOf('datos')] = 'NO';
    E.Auth.authService_invalidarAcceso('interno@x.com');
    expect(E.Auth.hasPermission('interno@x.com', 'datos')).toBe(false);
    E.cache.avanzar(20);
    fila[header.indexOf('fotos')] = 'SI';
    E.Auth.authService_invalidarAcceso('interno@x.com');
    expect(E.Auth.hasPermission('interno@x.com', 'fotos')).toBe(true);
    fila[header.indexOf('estado')] = 'inactivo';
    E.Auth.authService_invalidarAcceso('interno@x.com');
    expect(E.Auth.isUserActive('interno@x.com')).toBe(false);
  });

  test('TOMBSTONE: mientras existe, getUserAccess lee la hoja y NO vuelve a cachear (cierra la carrera de una request en vuelo)', () => {
    E.Auth.authService_invalidarAcceso('interno@x.com');
    E.Auth.getUserAccess('interno@x.com');
    E.Auth.getUserAccess('interno@x.com');
    expect(E.cache.get(clave('interno@x.com'))).toBeNull();
    E.cache.avanzar(16);                                               // vence el tombstone (15 s)
    E.Auth.getUserAccess('interno@x.com');
    expect(E.cache.get(clave('interno@x.com'))).not.toBeNull();
  });

  test('carrera real: una request lee la hoja ANTES del cambio, el admin invalida, y la request intenta cachear el valor viejo DESPUES: no queda cacheado', () => {
    const original = global.sheetUserRepository_getUserStatus;
    let invalido = false;
    global.sheetUserRepository_getUserStatus = (email) => {
      const r = original(email);
      if (!invalido) { invalido = true; E.Auth.authService_invalidarAcceso(email); }       // el admin invalida mientras esta request ya leyo
      return r;
    };
    E.Auth.getUserAccess('interno@x.com');
    expect(E.cache.get(clave('interno@x.com'))).toBeNull();
    global.sheetUserRepository_getUserStatus = original;
  });

  test('invalidar no lanza si el cache no esta disponible (devuelve ok:false)', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('cache caido'); } };
    expect(E.Auth.authService_invalidarAcceso('interno@x.com')).toEqual({ ok: false });
  });

  test('invalidar solo afecta al usuario indicado', () => {
    E.Auth.getUserAccess('interno@x.com');
    E.Auth.getUserAccess('externo@x.com');
    E.Auth.authService_invalidarAcceso('interno@x.com');
    expect(E.cache.get(clave('externo@x.com'))).not.toBeNull();
  });
});

describe('fail-closed del esquema', () => {
  test('falta la columna estado: nadie esta activo', () => {
    const C = crearEntornoE10({ header: COLS_ACTUALES.filter((c) => c !== 'estado'), usuarios: [{ email: 'interno@x.com', permisos: ['perfil'] }] });
    expect(C.Auth.isUserActive('interno@x.com')).toBe(false);
  });

  test('falta la columna de un permiso: nadie lo tiene; los demas no cambian', () => {
    const C = crearEntornoE10({ header: COLS_ACTUALES.filter((c) => c !== 'ne'), usuarios: [{ email: 'interno@x.com', permisos: PERMISOS_DE_SIEMPRE }] });
    expect(C.Auth.hasPermission('interno@x.com', 'ne')).toBe(false);
    expect(C.Auth.hasPermission('interno@x.com', 'perfil')).toBe(true);
  });

  test('falta la hoja Usuarios: la lectura lanza (el doPost lo traduce a SERVICE_UNAVAILABLE), nunca da acceso', () => {
    const C = crearEntornoE10();
    delete C.hojas.Usuarios;
    expect(() => C.Auth.getUserAccess('interno@x.com')).toThrow(/No existe una hoja/);
  });
});
