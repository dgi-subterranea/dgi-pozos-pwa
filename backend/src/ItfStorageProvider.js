// ItfStorageProvider (E9-3): CONTRATO del storage de los documentos E9 (propuestas y vigentes que NO son el legacy). Todavia NO existe una implementacion real: E9-3 no modifica la segunda cuenta
// ni sube nada. ItfService.js recibe un proveedor por inyeccion (tests con uno falso); en produccion, hasta que E9-4 lo implemente, el proveedor por defecto es itfStorage_noConfigurado().
// El orquestador NUNCA llama a DriveApp para los documentos E9: todo pasa por este contrato, asi el cliente de lectura no sabe si un ITF viene de la carpeta legacy o del storage E9.
//
// storageRef: referencia INTERNA y opaca del documento en el storage (hoy es lo que se guarda en la columna `storageFileId` de ItfEventos). Backend-only: jamas sale en un DTO.
//
// Metodos (todos devuelven un objeto; ninguno lanza para un caso "esperable": un fallo es {ok:false, code}):
//   guardarPropuesta({bytes, mimeType, nombreSugerido}) -> {ok:true, storageRef} | {ok:false, code}
//       Guarda el archivo ya validado (JPEG/PNG, magic bytes, tamano, hash) con un NOMBRE GENERADO (nunca el original) y en una raiz privada. Se llama ANTES de escribir ITF_PROPUESTO.
//   leerDocumento(storageRef) -> {ok:true, bytes, mimeType} | {ok:false, code}
//       Para getProfile, la descarga y el ZIP cuando el vigente es un documento E9, y para ver un historico / una propuesta pendiente (validador).
//   obtenerMetadata(storageRef) -> {ok:true, bytes, mimeType} | {ok:false, code}
//       Tamano y tipo sin descargar el contenido (control de integridad barato).
//   eliminarTemporal(storageRef) -> {ok:true} | {ok:false, code}
//       COMPENSACION. Si guardarPropuesta funciono pero el evento ITF_PROPUESTO no se pudo escribir (o resulto reintento / duplicado), el archivo no puede quedar huerfano en silencio: el orquestador
//       llama a esto para retirarlo (mover a la papelera, no borrado fisico). Es el UNICO caso en que E9 quita un archivo, y solo uno que ninguna fila referencia.
var ITF_STORAGE_METODOS = ['guardarPropuesta', 'leerDocumento', 'obtenerMetadata', 'eliminarTemporal'];
var ITF_STORAGE_NO_CONFIGURADO = 'ITF_STORAGE_NO_CONFIGURADO';

// Verdadero si es un objeto con los 4 metodos del contrato.
function itfStorage_esProveedor(p) {
  return !!p && typeof p === 'object' && ITF_STORAGE_METODOS.every(function (m) { return typeof p[m] === 'function'; });
}

// Proveedor por defecto mientras no exista storage E9: todo falla cerrado con un codigo claro (no toca Drive, ni la segunda cuenta, ni nada).
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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ITF_STORAGE_METODOS, ITF_STORAGE_NO_CONFIGURADO, itfStorage_esProveedor, itfStorage_noConfigurado, itfStorage_comoBlob };
}
