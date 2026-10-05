// Autenticacion servicio-a-servicio del STORAGE: valida que cada solicitud
// venga del backend principal (firma HMAC-SHA256 con el secreto
// compartido), no este vencida y no sea un replay. Debe coincidir
// byte a byte con backend/src/FotosStorageClient.js (hay un test cruzado).
//
//   sig = HMAC_SHA256(secreto, 'v1\n' + accion + '\n' + ts + '\n' + nonce + '\n' + payload)
//
// Orden de chequeos (el nonce se recuerda SOLO despues de validar la firma,
// para que un atacante sin secreto no pueda "gastar" nonces):
//   estructura -> version -> ventana de tiempo (+-5 min) -> firma -> replay.
var STORAGE_AUTH_VERSION = 'v1';
var STORAGE_AUTH_TOLERANCIA_SEG = 300;
var STORAGE_AUTH_NONCE_TTL_SEG = 600;

function storageAuth_hex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

function storageAuth_firmar(secret, accion, ts, nonce, payload) {
  var mensaje = STORAGE_AUTH_VERSION + '\n' + accion + '\n' + ts + '\n' + nonce + '\n' + payload;
  return storageAuth_hex(Utilities.computeHmacSha256Signature(mensaje, secret));
}

function storageAuth_igualesConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// cache: objeto estilo CacheService (get/put). Devuelve
// {ok:true, accion, payload, nonce} | {ok:false, code}.
function storageAuth_verificarSolicitud(body, secret, ahoraSeg, cache) {
  if (!body || typeof body !== 'object' || typeof body.action !== 'string' || typeof body.payload !== 'string' ||
      typeof body.sig !== 'string' || typeof body.nonce !== 'string') {
    return { ok: false, code: 'MALFORMED' };
  }
  if (body.v !== STORAGE_AUTH_VERSION) {
    return { ok: false, code: 'BAD_VERSION' };
  }
  if (body.nonce.length < 16 || body.nonce.length > 64 || !/^[A-Za-z0-9-]+$/.test(body.nonce)) {
    return { ok: false, code: 'MALFORMED' };
  }
  var ts = Number(body.ts);
  if (!isFinite(ts) || Math.abs(ahoraSeg - ts) > STORAGE_AUTH_TOLERANCIA_SEG) {
    return { ok: false, code: 'EXPIRED' };
  }
  var esperada = storageAuth_firmar(secret, body.action, body.ts, body.nonce, body.payload);
  if (!storageAuth_igualesConstante(esperada, body.sig)) {
    return { ok: false, code: 'BAD_SIGNATURE' };
  }
  var claveNonce = 'nonce_' + body.nonce;
  if (cache.get(claveNonce) !== null) {
    return { ok: false, code: 'REPLAY' };
  }
  cache.put(claveNonce, '1', STORAGE_AUTH_NONCE_TTL_SEG);

  var payload;
  try {
    payload = JSON.parse(body.payload);
  } catch (err) {
    return { ok: false, code: 'MALFORMED' };
  }
  return { ok: true, accion: body.action, payload: payload, nonce: body.nonce };
}

// Respuesta firmada (accion 'response', mismo nonce que la solicitud).
function storageAuth_firmarRespuesta(secret, nonce, dataObj, ahoraSeg) {
  var payload = JSON.stringify(dataObj);
  return {
    v: STORAGE_AUTH_VERSION,
    ts: ahoraSeg,
    nonce: nonce,
    payload: payload,
    sig: storageAuth_firmar(secret, 'response', ahoraSeg, nonce, payload)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    storageAuth_hex,
    storageAuth_firmar,
    storageAuth_igualesConstante,
    storageAuth_verificarSolicitud,
    storageAuth_firmarRespuesta
  };
}
