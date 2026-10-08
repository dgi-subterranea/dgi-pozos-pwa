// Punto de entrada HTTP del STORAGE de fotos. Web App "Ejecutar como: yo
// (la segunda cuenta)" + "Quien tiene acceso: cualquier persona" (hace
// falta para que UrlFetchApp del backend principal pueda llamarlo sin
// OAuth): por eso NINGUNA operacion se ejecuta sin una solicitud firmada
// valida (ver StorageAuth.js). Un GET o un POST sin firma no revelan nada.
// Acciones: putFoto, getFoto, trashFoto (Reemplazos) y putFotoPozo, putFotosPozoLote (varias fotos por solicitud), getFotoPozo,
// trashFotoPozo (galeria general de pozos, otra raiz de Drive).
function doGet() {
  return ContentService.createTextOutput('ok').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var salida;
  try {
    salida = storageApi_procesar(e && e.postData ? e.postData.contents : null);
  } catch (err) {
    // Nunca se devuelve el detalle del error (podria incluir rutas o ids).
    salida = { status: 'error', code: 'INTERNAL' };
  }
  return ContentService.createTextOutput(JSON.stringify(salida)).setMimeType(ContentService.MimeType.JSON);
}

// Devuelve el cuerpo a enviar: respuesta firmada si la solicitud era
// valida; si no, un error SIN firmar y sin detalle (no ayuda a un atacante).
function storageApi_procesar(contenido) {
  var body;
  try {
    body = JSON.parse(contenido);
  } catch (err) {
    return { status: 'error', code: 'MALFORMED' };
  }
  var secret = getStorageSecret();
  var ahora = Math.floor(Date.now() / 1000);
  var auth = storageAuth_verificarSolicitud(body, secret, ahora, CacheService.getScriptCache());
  if (!auth.ok) {
    return { status: 'error', code: 'UNAUTHORIZED' };
  }

  var resultado;
  if (auth.accion === 'putFoto') {
    resultado = storageDrive_putFoto(auth.payload, new Date().getFullYear());
  } else if (auth.accion === 'getFoto') {
    resultado = storageDrive_getFoto(auth.payload);
  } else if (auth.accion === 'trashFoto') {
    resultado = storageDrive_trashFoto(auth.payload);
  } else if (auth.accion === 'putFotoPozo') {
    resultado = storageDrive_putFotoPozo(auth.payload);
  } else if (auth.accion === 'putFotosPozoLote') {
    resultado = storageDrive_putFotosPozoLote(auth.payload);
  } else if (auth.accion === 'getFotoPozo') {
    resultado = storageDrive_getFotoPozo(auth.payload);
  } else if (auth.accion === 'trashFotoPozo') {
    resultado = storageDrive_trashFotoPozo(auth.payload);
  } else {
    resultado = { status: 'error', code: 'UNKNOWN_ACTION' };
  }
  return storageAuth_firmarRespuesta(secret, auth.nonce, resultado, Math.floor(Date.now() / 1000));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { doGet, doPost, storageApi_procesar };
}
