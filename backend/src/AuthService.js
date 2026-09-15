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
// ya documentado como aceptado.
//
// Los permisos por modulo (perfil/datos/ubicacion/ne) viajan en el MISMO
// objeto cacheado que el estado activo/inactivo, con la misma regla
// asimetrica: solo se cachean junto a un usuario activo. Esto significa
// que otorgar O quitar un permiso a un usuario ya activo (y por lo tanto
// ya cacheado) puede tardar hasta USER_STATUS_CACHE_SECONDS en
// reflejarse - mismo trade-off que ya existia para activo/inactivo,
// ahora extendido a permisos. Nunca se guardan permisos en el
// sessionToken (ver createSessionToken) - el token sigue siendo pura
// identidad, los permisos se recalculan (con este cache) en cada
// request.
function getUserAccess(email) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'user_access_' + String(email).trim().toLowerCase();

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached);
  }

  var status = sheetUserRepository_getUserStatus(email);
  // Fail-closed tambien si el repositorio no trajo permisos por algun
  // motivo (forma inesperada, columna faltante que ademas rompio el
  // objeto entero, etc.) - nunca se asume acceso por ausencia de dato.
  var permisosVacios = { perfil: false, datos: false, ubicacion: false, ne: false };
  var access = {
    active: status.found && status.active,
    permisos: (status.found && status.permisos) ? status.permisos : permisosVacios
  };
  if (access.active) {
    cache.put(cacheKey, JSON.stringify(access), USER_STATUS_CACHE_SECONDS);
  }
  return access;
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
      emailVerified: tokenInfo.email_verified === 'true' || tokenInfo.email_verified === true,
      sessionToken: sessionToken,
      permisos: access.permisos
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isUserActive,
    getUserAccess,
    hasPermission,
    signPayload,
    createSessionToken,
    verifySessionToken,
    handleCheckSession,
    handleLogin
  };
}
