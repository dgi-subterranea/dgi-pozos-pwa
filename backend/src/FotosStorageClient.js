// Cliente del Web App de STORAGE de fotos (proyecto de Apps Script aparte,
// desplegado por una segunda cuenta de Google - ver storage/). El
// navegador NUNCA habla con el storage: Frontend -> backend principal ->
// storage. Autenticacion servicio-a-servicio con HMAC-SHA256:
//
//   sig = HMAC_SHA256(secreto, 'v1\n' + accion + '\n' + ts + '\n' + nonce + '\n' + payload)
//
// - secreto: FOTOS_STORAGE_SECRET, el MISMO en Script Properties de ambos
//   proyectos (nunca viaja por la red, nunca llega al frontend);
// - ts: segundos epoch del emisor; el receptor rechaza fuera de +-5 min;
// - nonce: UUID unico por llamada; el receptor lo recuerda 10 min y rechaza
//   repetidos (proteccion contra replay);
// - payload: el JSON de la operacion como STRING (se firma exactamente lo
//   que se envia, sin ambiguedad de serializacion).
// La respuesta del storage tambien viene firmada (accion 'response', mismo
// nonce que la solicitud): el principal rechaza una respuesta sin firma
// valida, vencida o de otra solicitud.
var FOTOS_STORAGE_VERSION = 'v1';
var FOTOS_STORAGE_TOLERANCIA_SEG = 300;

function fotosStorageClient_hex(bytes) {
  var hex = '';
  for (var i = 0; i < bytes.length; i++) {
    hex += ('0' + (bytes[i] & 0xff).toString(16)).slice(-2);
  }
  return hex;
}

function fotosStorageClient_firmar(secret, accion, ts, nonce, payload) {
  var mensaje = FOTOS_STORAGE_VERSION + '\n' + accion + '\n' + ts + '\n' + nonce + '\n' + payload;
  return fotosStorageClient_hex(Utilities.computeHmacSha256Signature(mensaje, secret));
}

// Comparacion en tiempo constante (no corta en la primera diferencia).
function fotosStorageClient_igualesConstante(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function fotosStorageClient_armarSolicitud(accion, payloadObj, secret, ahoraSeg, nonce) {
  var payload = JSON.stringify(payloadObj);
  return {
    v: FOTOS_STORAGE_VERSION,
    action: accion,
    ts: ahoraSeg,
    nonce: nonce,
    payload: payload,
    sig: fotosStorageClient_firmar(secret, accion, ahoraSeg, nonce, payload)
  };
}

// Valida la respuesta firmada del storage. {ok:true, data} (data = payload
// ya parseado: {status, code?, ...}) o {ok:false, reason}.
function fotosStorageClient_verificarRespuesta(respuesta, secret, nonceEsperado, ahoraSeg) {
  if (!respuesta || typeof respuesta !== 'object' || typeof respuesta.payload !== 'string' || typeof respuesta.sig !== 'string') {
    return { ok: false, reason: 'RESPUESTA_SIN_FIRMA' };
  }
  if (respuesta.nonce !== nonceEsperado) {
    return { ok: false, reason: 'NONCE_DISTINTO' };
  }
  var ts = Number(respuesta.ts);
  if (!isFinite(ts) || Math.abs(ahoraSeg - ts) > FOTOS_STORAGE_TOLERANCIA_SEG) {
    return { ok: false, reason: 'RESPUESTA_VENCIDA' };
  }
  var esperada = fotosStorageClient_firmar(secret, 'response', respuesta.ts, respuesta.nonce, respuesta.payload);
  if (!fotosStorageClient_igualesConstante(esperada, respuesta.sig)) {
    return { ok: false, reason: 'FIRMA_INVALIDA' };
  }
  try {
    return { ok: true, data: JSON.parse(respuesta.payload) };
  } catch (err) {
    return { ok: false, reason: 'PAYLOAD_ILEGIBLE' };
  }
}

// Llamada completa. Lanza Error (message = motivo tecnico, sin secreto ni
// payload) si el storage no responde, responde mal o devuelve error; el
// Service lo traduce a STORAGE_UNAVAILABLE.
function fotosStorageClient_llamar(accion, payloadObj) {
  var secret = getFotosStorageSecret();
  var nonce = Utilities.getUuid();
  var ahora = Math.floor(Date.now() / 1000);
  var solicitud = fotosStorageClient_armarSolicitud(accion, payloadObj, secret, ahora, nonce);

  var http = UrlFetchApp.fetch(getFotosStorageUrl(), {
    method: 'post',
    contentType: 'text/plain;charset=utf-8',
    payload: JSON.stringify(solicitud),
    muteHttpExceptions: true,
    followRedirects: true
  });
  if (http.getResponseCode() !== 200) {
    throw new Error('storage HTTP ' + http.getResponseCode());
  }
  var cuerpo;
  try {
    cuerpo = JSON.parse(http.getContentText());
  } catch (err) {
    throw new Error('storage respondio algo que no es JSON');
  }
  var verificada = fotosStorageClient_verificarRespuesta(cuerpo, secret, nonce, Math.floor(Date.now() / 1000));
  if (!verificada.ok) {
    throw new Error('respuesta del storage rechazada: ' + verificada.reason);
  }
  if (verificada.data.status !== 'ok') {
    throw new Error('storage devolvio error: ' + (verificada.data.code || 'desconocido'));
  }
  return verificada.data;
}

// datos: {fotoId, wellId, evaluacionId, nombreArchivo, mimeType,
// imagenBase64, thumbBase64}. Devuelve {driveFileId, tamanoBytes}.
function fotosStorageClient_subir(datos) {
  var r = fotosStorageClient_llamar('putFoto', datos);
  return { driveFileId: r.driveFileId, tamanoBytes: r.tamanoBytes };
}

// variante: 'thumb' | 'full'. Devuelve {mimeType, imagenBase64}.
function fotosStorageClient_obtener(driveFileId, variante) {
  var r = fotosStorageClient_llamar('getFoto', { driveFileId: driveFileId, variante: variante });
  return { mimeType: r.mimeType, imagenBase64: r.imagenBase64 };
}

// SOLO compensacion interna (la foto subio pero no se pudo registrar):
// manda el archivo a la papelera del storage. No es un "borrar foto" del
// usuario - esa funcion no existe en v1.
function fotosStorageClient_descartar(driveFileId) {
  fotosStorageClient_llamar('trashFoto', { driveFileId: driveFileId });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    fotosStorageClient_hex,
    fotosStorageClient_firmar,
    fotosStorageClient_igualesConstante,
    fotosStorageClient_armarSolicitud,
    fotosStorageClient_verificarRespuesta,
    fotosStorageClient_llamar,
    fotosStorageClient_subir,
    fotosStorageClient_obtener,
    fotosStorageClient_descartar
  };
}
