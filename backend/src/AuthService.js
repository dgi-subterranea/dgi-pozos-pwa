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

function isUserActive(email) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'user_active_' + String(email).trim().toLowerCase();

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return cached === 'true';
  }

  var status = sheetUserRepository_getUserStatus(email);
  var active = status.found && status.active;
  cache.put(cacheKey, active ? 'true' : 'false', USER_STATUS_CACHE_SECONDS);
  return active;
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
  if (!isUserActive(result.email)) {
    return { status: 'error', code: 'USER_DISABLED', message: 'usuario no habilitado: ' + result.email };
  }
  // Renovacion silenciosa (rolling/sliding): cada checkSession exitoso
  // reemite un token nuevo con otros SESSION_TTL_SECONDS, para que un
  // uso periodico de la app mantenga la sesion viva indefinidamente sin
  // volver a pasar por Google. El frontend reemplaza el token guardado
  // con este.
  var newSessionToken = createSessionToken(result.email);
  return {
    status: 'ok',
    data: {
      email: result.email,
      sessionToken: newSessionToken,
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

  if (!isUserActive(tokenInfo.email)) {
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
      sessionToken: sessionToken
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isUserActive, signPayload, createSessionToken, verifySessionToken, handleCheckSession, handleLogin };
}
