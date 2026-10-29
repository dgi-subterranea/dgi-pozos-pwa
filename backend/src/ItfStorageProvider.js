// ItfStorageProvider (E9-3 contrato, E9-4 implementacion real): el storage de los documentos E9 (propuestas y vigentes que NO son el legacy). Vive en la SEGUNDA cuenta de Google, en una raiz
// PROPIA y aislada (ItfPropuestas, ver storage/src/StorageDrive.js), nunca en la carpeta legacy FOLDER_ID y nunca mezclado con las fotos. ItfService.js recibe un proveedor por inyeccion (tests con
// uno falso); el orquestador NUNCA llama a DriveApp para los documentos E9: todo pasa por este contrato, asi el cliente de lectura no sabe si un ITF viene de la carpeta legacy o del storage E9.
//
// AUTENTICACION backend -> storage: la MISMA firma HMAC-SHA256 que ya usa Fotos (fotosStorageClient_llamar: mismo secreto FOTOS_STORAGE_SECRET y misma URL FOTOS_STORAGE_URL, nonce, ventana de
// +-5 min, respuesta firmada). No hay un segundo esquema de autenticacion. Las acciones son ESPECIFICAS (putItf / getItf / metaItf / trashItf): ninguna operacion generica sobre Drive.
//
// storageRef: referencia INTERNA y opaca del documento en el storage (hoy es lo que se guarda en la columna `storageFileId` de ItfEventos). Backend-only: jamas sale en un DTO ni llega al navegador.
//
// Metodos (todos devuelven un objeto; ninguno lanza para un caso "esperable": un fallo es {ok:false, code}):
//   guardarPropuesta({documentoId, bytes, mimeType}) -> {ok:true, storageRef} | {ok:false, code}
//       Guarda el archivo ya validado (JPEG / PNG, magic bytes, tamano) con un NOMBRE GENERADO a partir del documentoId (UUID del servidor): nunca el nombre original, un wellId ni un hash. Idempotente
//       por documentoId (si se reintenta devuelve el mismo archivo). Se llama ANTES de escribir ITF_PROPUESTO y FUERA del lock.
//   leerDocumento(storageRef) -> {ok:true, bytes, mimeType} | {ok:false, code}
//       Para getProfile, la descarga y el ZIP cuando el vigente es un documento E9, y para ver un historico / una propuesta pendiente (validador).
//   obtenerMetadata(storageRef) -> {ok:true, bytes, mimeType} | {ok:false, code}
//       Tamano y tipo sin descargar el contenido (control de integridad barato).
//   eliminarTemporal(storageRef) -> {ok:true} | {ok:false, code}
//       COMPENSACION. Si guardarPropuesta funciono pero el evento ITF_PROPUESTO no se pudo escribir (o resulto reintento / duplicado), el archivo no puede quedar huerfano en silencio: el orquestador
//       llama a esto para retirarlo (papelera, no borrado fisico). Es el UNICO caso en que E9 quita un archivo, y solo uno que ninguna fila referencia.
//
// Codigos: ITF_STORAGE_NO_CONFIGURADO (falta la URL / el secreto, o el storage desplegado todavia no tiene las acciones de ITF), ITF_NOT_FOUND, INVALID_ARCHIVO (el storage rechazo el contenido),
// SERVICE_UNAVAILABLE (cualquier otra falla). Nunca se devuelve el texto de un error (podria llevar rutas o ids).
var ITF_STORAGE_METODOS = ['guardarPropuesta', 'leerDocumento', 'obtenerMetadata', 'eliminarTemporal'];
var ITF_STORAGE_NO_CONFIGURADO = 'ITF_STORAGE_NO_CONFIGURADO';
var ITF_STORAGE_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Verdadero si es un objeto con los 4 metodos del contrato.
function itfStorage_esProveedor(p) {
  return !!p && typeof p === 'object' && ITF_STORAGE_METODOS.every(function (m) { return typeof p[m] === 'function'; });
}

// Proveedor "apagado": todo falla cerrado con un codigo claro (no toca Drive, ni la segunda cuenta, ni nada).
function itfStorage_noConfigurado() {
  function falla() {
    return { ok: false, code: ITF_STORAGE_NO_CONFIGURADO };
  }
  return { guardarPropuesta: falla, leerDocumento: falla, obtenerMetadata: falla, eliminarTemporal: falla };
}

// Arma el objeto que Api.js ya sabe usar para responder una imagen (getBytes / getContentType), a partir de lo que devuelve leerDocumento. Mismo contrato que el blob de Drive del legacy.
function itfStorage_comoBlob(bytes, mimeType) {
  return {
    getBytes: function () { return bytes; },
    getContentType: function () { return mimeType; }
  };
}

// Traduce lo que lanza el cliente del storage a un codigo estable. Solo mira el CODIGO que el storage informa (mayusculas) o que falte la configuracion; nunca devuelve el texto.
function itfStorage_codigoDeError(err) {
  var texto = String(err && err.message !== undefined ? err.message : err);
  if (/FOTOS_STORAGE_URL|FOTOS_STORAGE_SECRET|no configurado|is not defined/i.test(texto)) {
    return ITF_STORAGE_NO_CONFIGURADO;
  }
  var m = /storage devolvio error: ([A-Z_]+)/.exec(texto);
  var code = m ? m[1] : '';
  if (code === 'UNKNOWN_ACTION' || (code === 'INTERNAL' && /ITF_ROOT_FOLDER_ID/.test(texto))) {
    return ITF_STORAGE_NO_CONFIGURADO;               // el storage desplegado todavia no tiene las acciones / la raiz de ITF
  }
  if (code === 'NOT_FOUND') {
    return 'ITF_NOT_FOUND';
  }
  if (/^(INVALID_|MALFORMED|DOCUMENTO_EXISTENTE_DISTINTO)/.test(code)) {
    return 'INVALID_ARCHIVO';
  }
  return 'SERVICE_UNAVAILABLE';
}

// Proveedor REAL: habla con el Web App de storage por el cliente HMAC de Fotos. `llamar(accion, payload)` es inyectable (tests); por defecto fotosStorageClient_llamar.
function itfStorage_crearReal(llamar) {
  var fn = typeof llamar === 'function' ? llamar : function (accion, payload) {
    if (typeof fotosStorageClient_llamar !== 'function') {
      throw new Error('storage no configurado');
    }
    return fotosStorageClient_llamar(accion, payload);
  };
  function seguro(accion) {
    try {
      return accion();
    } catch (err) {
      return { ok: false, code: itfStorage_codigoDeError(err) };
    }
  }
  function refValida(ref) {
    return typeof ref === 'string' && ref.length > 0;
  }
  return {
    guardarPropuesta: function (p) {
      var d = p !== null && typeof p === 'object' ? p : {};
      if (typeof d.documentoId !== 'string' || !ITF_STORAGE_UUID_REGEX.test(d.documentoId) || !d.bytes || typeof d.bytes.length !== 'number' || d.bytes.length === 0 ||
          ITF_MIME_PERMITIDOS.indexOf(d.mimeType) < 0) {
        return { ok: false, code: 'INVALID_ARCHIVO' };
      }
      return seguro(function () {
        var r = fn('putItf', { documentoId: d.documentoId, mimeType: d.mimeType, imagenBase64: Utilities.base64Encode(d.bytes) });
        return refValida(r.driveFileId) ? { ok: true, storageRef: r.driveFileId } : { ok: false, code: 'SERVICE_UNAVAILABLE' };
      });
    },
    leerDocumento: function (ref) {
      if (!refValida(ref)) {
        return { ok: false, code: 'ITF_NOT_FOUND' };
      }
      return seguro(function () {
        var r = fn('getItf', { driveFileId: ref });
        return typeof r.imagenBase64 === 'string' ? { ok: true, bytes: Utilities.base64Decode(r.imagenBase64), mimeType: r.mimeType } : { ok: false, code: 'SERVICE_UNAVAILABLE' };
      });
    },
    obtenerMetadata: function (ref) {
      if (!refValida(ref)) {
        return { ok: false, code: 'ITF_NOT_FOUND' };
      }
      return seguro(function () {
        var r = fn('metaItf', { driveFileId: ref });
        return { ok: true, bytes: r.tamanoBytes, mimeType: r.mimeType };
      });
    },
    eliminarTemporal: function (ref) {
      if (!refValida(ref)) {
        return { ok: false, code: 'ITF_NOT_FOUND' };
      }
      return seguro(function () {
        fn('trashItf', { driveFileId: ref });
        return { ok: true };
      });
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_STORAGE_METODOS,
    ITF_STORAGE_NO_CONFIGURADO,
    itfStorage_esProveedor,
    itfStorage_noConfigurado,
    itfStorage_comoBlob,
    itfStorage_codigoDeError,
    itfStorage_crearReal
  };
}
