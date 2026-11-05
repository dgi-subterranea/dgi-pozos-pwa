// AuthService: identidad y sesion. No sabe nada de HTTP (eso es Api.js) ni
// de Drive/Sheets (eso son los repositorios).

// Sesion rolling/sliding: cada token dura 30 dias (2592000s), pero
// handleCheckSession reemite uno nuevo con otros 30 dias cada vez que
// se valida con exito (ver mas abajo). En la practica el usuario queda
// logueado mientras abra la app con alguna frecuencia razonable, y
// pierde la sesion solo si pasa 30 dias completos sin usarla o si
// toca "Salir". Antes de esto el valor era 43200s (12h), que en uso
// real resultaba demasiado corto: obligaba a reloguearse con Google
// tras unos pocos dias sin abrir la app.
var SESSION_TTL_SECONDS = 2592000;

// Cuanto tiempo, como maximo, puede tardar en notarse que alguien fue
// deshabilitado en la hoja "Usuarios" (evita golpear Sheets en cada
// request; CacheService puede desalojar antes, nunca despues).
var USER_STATUS_CACHE_SECONDS = 300;

// Solo se cachea el resultado POSITIVO (usuario encontrado y activo). Un
// usuario inexistente o inactivo nunca queda en cache, a proposito: dar
// de alta o reactivar a alguien en la hoja "Usuarios" tiene que surtir
// efecto en el intento siguiente, no esperar hasta que venza el cache.
// La contrapartida es asimetrica y deliberada: deshabilitar a alguien
// que YA estaba cacheado como activo puede tardar hasta
// USER_STATUS_CACHE_SECONDS en notarse (ese caso si sigue cacheado) -
// ya documentado como aceptado PARA LAS EDICIONES MANUALES DE LA HOJA.
//
// E10-1: los cambios hechos desde la ADMINISTRACION (UsuariosAdminService) invalidan el cache del usuario
// afectado al instante (authService_invalidarAcceso: remove + tombstone corto), asi que una baja, quitar o
// agregar un permiso surte efecto en la SIGUIENTE request.
//
// Los permisos (los ids de PermisosCatalogo, fuente unica) viajan en el MISMO objeto cacheado que el estado
// activo/inactivo, con la misma regla asimetrica: solo se cachean junto a un usuario activo. Nunca se
// guardan permisos en el sessionToken (ver createSessionToken) - el token sigue siendo pura identidad,
// los permisos se recalculan (con este cache) en cada request. Los permisos son los EFECTIVOS
// (UsuariosDominio): un permiso no aplicable a EXTERNO (usuarios_admin) solo vale para un INTERNO.
//
// Cache v2: la clave lleva version porque el objeto cacheado cambio de forma (tipo, version); las entradas
// viejas (user_access_<email>) expiran solas y nunca se leen.
var USER_ACCESS_CACHE_PREFIJO = 'user_access_v2_';
var USER_ACCESS_CACHE_PREFIJO_VIEJO = 'user_access_';
var USER_ACCESS_TOMBSTONE_PREFIJO = 'user_access_inv_';
// El tombstone cubre la ventana en la que una request que ya leyo la hoja ANTES de un cambio administrativo
// podria guardar en el cache el valor viejo DESPUES del remove. Mientras existe, getUserAccess lee la hoja
// y NO escribe el cache.
var USER_ACCESS_TOMBSTONE_SECONDS = 15;

function authService_claveCache(prefijo, email) {
  return prefijo + String(email).trim().toLowerCase();
}

function getUserAccess(email) {
  var cache = CacheService.getScriptCache();
  var cacheKey = authService_claveCache(USER_ACCESS_CACHE_PREFIJO, email);

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached);
  }

  var status = sheetUserRepository_getUserStatus(email);
  // Fail-closed tambien si el repositorio no trajo permisos por algun
  // motivo (forma inesperada, columna faltante que ademas rompio el
  // objeto entero, etc.) - nunca se asume acceso por ausencia de dato.
  // nombre viaja en el MISMO objeto cacheado (misma lectura de Sheets
  // que ya trae estado/permisos) - se usa para notificaciones de
  // Telegram (ver NotificationService.js), no requiere una consulta
  // aparte. Mismo trade-off de cache que el resto: un cambio de nombre
  // en la hoja para un usuario ya activo puede tardar hasta
  // USER_STATUS_CACHE_SECONDS en reflejarse.
  var access = usuariosDominio_accesoEfectivo(status);
  if (access.active && cache.get(authService_claveCache(USER_ACCESS_TOMBSTONE_PREFIJO, email)) === null) {
    cache.put(cacheKey, JSON.stringify(access), USER_STATUS_CACHE_SECONDS);
  }
  return access;
}

// Invalida AL INSTANTE el acceso cacheado de un usuario (cambios administrativos): borra la clave y deja un
// tombstone corto para que ninguna request en vuelo vuelva a cachear el valor viejo. Nunca lanza: devuelve
// {ok:false} si el cache no esta disponible (el cambio ya esta escrito: en el peor caso rige el TTL).
function authService_invalidarAcceso(email) {
  try {
    var cache = CacheService.getScriptCache();
    cache.put(authService_claveCache(USER_ACCESS_TOMBSTONE_PREFIJO, email), '1', USER_ACCESS_TOMBSTONE_SECONDS);
    cache.remove(authService_claveCache(USER_ACCESS_CACHE_PREFIJO, email));
    cache.remove(authService_claveCache(USER_ACCESS_CACHE_PREFIJO_VIEJO, email));
    return { ok: true };
  } catch (err) {
    return { ok: false };
  }
}

function isUserActive(email) {
  return getUserAccess(email).active;
}

// Fail-closed: si el modulo no existe en access.permisos (no deberia
// pasar, pero por las dudas) o el usuario no esta activo, false.
function hasPermission(email, modulo) {
  var access = getUserAccess(email);
  if (!access.active) {
    return false;
  }
  return access.permisos[modulo] === true;
}

function signPayload(payloadB64) {
  var rawSignature = Utilities.computeHmacSha256Signature(payloadB64, getSessionSecret());
  return Utilities.base64EncodeWebSafe(rawSignature);
}

function createSessionToken(email) {
  var now = Math.floor(Date.now() / 1000);
  var payload = JSON.stringify({ email: email, iat: now, exp: now + SESSION_TTL_SECONDS });
  var payloadB64 = Utilities.base64EncodeWebSafe(payload);
  return payloadB64 + '.' + signPayload(payloadB64);
}

function verifySessionToken(token) {
  if (!token || token.indexOf('.') === -1) {
    return { valid: false, reason: 'formato invalido' };
  }
  var parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, reason: 'formato invalido' };
  }
  var payloadB64 = parts[0];
  var signature = parts[1];

  if (signPayload(payloadB64) !== signature) {
    return { valid: false, reason: 'firma invalida' };
  }

  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(payloadB64)).getDataAsString());
  } catch (err) {
    return { valid: false, reason: 'payload corrupto' };
  }

  var now = Math.floor(Date.now() / 1000);
  if (!payload.exp || now > payload.exp) {
    return { valid: false, reason: 'expirado' };
  }

  return { valid: true, email: payload.email };
}

function handleCheckSession(sessionToken) {
  var result = verifySessionToken(sessionToken);
  if (!result.valid) {
    return { status: 'error', code: 'UNAUTHORIZED', message: 'sessionToken invalido: ' + result.reason };
  }
  var access = getUserAccess(result.email);
  if (!access.active) {
    return { status: 'error', code: 'USER_DISABLED', message: 'usuario no habilitado: ' + result.email };
  }
  // Renovacion silenciosa (rolling/sliding): cada checkSession exitoso
  // reemite un token nuevo con otros SESSION_TTL_SECONDS, para que un
  // uso periodico de la app mantenga la sesion viva indefinidamente sin
  // volver a pasar por Google. El frontend reemplaza el token guardado
  // con este. Los permisos NUNCA viajan dentro del token - se recalculan
  // (con cache) en cada request, ver getUserAccess.
  var newSessionToken = createSessionToken(result.email);
  return {
    status: 'ok',
    data: {
      email: result.email,
      sessionToken: newSessionToken,
      permisos: access.permisos,
      message: 'sesion validada localmente, sin llamar a Google'
    }
  };
}

// Categoria SEGURA de la claim email_verified (nunca el valor crudo): 'VERDADERO' | 'FALSO' | 'AUSENTE' | 'OTRO'.
// tokeninfo devuelve las claims como CADENAS ("true"), asi que se acepta la cadena exacta 'true' y el booleano true; igual con false.
function authService_clasificarEmailVerified(valor) {
  if (valor === true || valor === 'true') {
    return 'VERDADERO';
  }
  if (valor === false || valor === 'false') {
    return 'FALSO';
  }
  if (valor === undefined || valor === null || valor === '') {
    return 'AUSENTE';
  }
  return 'OTRO';
}

function handleLogin(idToken) {
  if (!idToken) {
    return { status: 'error', code: 'UNAUTHORIZED', message: 'falta idToken' };
  }

  var url = 'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken);
  var httpResponse;
  try {
    httpResponse = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo contactar a Google: ' + err.toString() };
  }

  if (httpResponse.getResponseCode() !== 200) {
    return { status: 'error', code: 'UNAUTHORIZED', message: 'tokeninfo rechazo el token: ' + httpResponse.getContentText() };
  }

  var tokenInfo = JSON.parse(httpResponse.getContentText());

  if (tokenInfo.aud !== GOOGLE_CLIENT_ID) {
    logHistoryEvent(tokenInfo.email, 'login', null, 'UNAUTHORIZED');
    return { status: 'error', code: 'UNAUTHORIZED', message: 'aud no coincide con nuestro client id' };
  }

  // Sin email no hay identidad: nunca se consulta la hoja con undefined.
  if (typeof tokenInfo.email !== 'string' || tokenInfo.email.trim() === '') {
    return { status: 'error', code: 'UNAUTHORIZED', message: 'el token no trae email' };
  }

  // E10-1: email_verified. OBSERVAR (estado inicial del rollout, y valor por defecto): NO bloquea; registra solo la CATEGORIA segura en Historial
  // (nunca el token, el idToken ni el valor crudo). EXIGIR: todo valor distinto de verdadero -> EMAIL_NO_VERIFICADO, sin sesion. Se evalua ANTES de consultar la hoja Usuarios.
  var verificado = authService_clasificarEmailVerified(tokenInfo.email_verified);
  var modo = e10Flags_emailVerifiedModo();
  if (modo.modo === 'EXIGIR') {
    if (verificado !== 'VERDADERO') {
      logHistoryEvent(tokenInfo.email, 'login', null, 'EMAIL_NO_VERIFICADO');
      return { status: 'error', code: 'EMAIL_NO_VERIFICADO', message: 'el email de la cuenta de Google no esta verificado' };
    }
  } else {
    logHistoryEvent(tokenInfo.email, 'login', null, 'EMAIL_VERIFIED_' + verificado + (modo.origen === 'INVALIDO' ? '_MODO_INVALIDO' : ''));
  }

  var access = getUserAccess(tokenInfo.email);
  if (!access.active) {
    logHistoryEvent(tokenInfo.email, 'login', null, 'USER_DISABLED');
    return { status: 'error', code: 'USER_DISABLED', message: 'usuario no habilitado: ' + tokenInfo.email };
  }

  var sessionToken = createSessionToken(tokenInfo.email);
  logHistoryEvent(tokenInfo.email, 'login', null, 'OK');

  return {
    status: 'ok',
    data: {
      email: tokenInfo.email,
      name: tokenInfo.name || null,
      emailVerified: verificado === 'VERDADERO',
      sessionToken: sessionToken,
      permisos: access.permisos
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isUserActive,
    getUserAccess,
    authService_invalidarAcceso,
    authService_clasificarEmailVerified,
    USER_ACCESS_CACHE_PREFIJO,
    USER_ACCESS_TOMBSTONE_PREFIJO,
    hasPermission,
    signPayload,
    createSessionToken,
    verifySessionToken,
    handleCheckSession,
    handleLogin
  };
}
