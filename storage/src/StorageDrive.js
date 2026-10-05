// Acceso a Drive de la cuenta de STORAGE. Estructura:
//   FotosReemplazo/            (carpeta raiz, FOTOS_ROOT_FOLDER_ID)
//     2026/                    (una carpeta por anio: nunca miles de
//       04-0263_<evalId>_<fotoId>.jpg          archivos en una sola)
//       04-0263_<evalId>_<fotoId>_thumb.jpg    (miniatura, ver abajo)
// - los archivos son PRIVADOS (nunca se comparten ni hay links publicos);
// - la miniatura es un segundo archivo cuyo id queda en la DESCRIPCION del
//   archivo principal ('thumb:<id>'): asi la hoja del backend principal
//   solo necesita UN driveFileId por foto;
// - get/trash solo operan sobre archivos que cuelgan de la carpeta raiz:
//   aunque una llamada firmada pidiera otro id de la cuenta, se rechaza.
var STORAGE_MAX_BYTES = 3 * 1024 * 1024;
var STORAGE_THUMB_MAX_BYTES = 80 * 1024;
var STORAGE_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var STORAGE_WELLID_REGEX = /^\d{2}-\d{4}$/;
var STORAGE_NOMBRE_REGEX = /^[A-Za-z0-9_-]{1,120}\.jpg$/;
var STORAGE_BASE64_REGEX = /^[A-Za-z0-9+\/]+={0,2}$/;
var STORAGE_DRIVE_ID_REGEX = /^[A-Za-z0-9_-]{10,100}$/;

function storageDrive_bytesDeBase64(b64) {
  var pad = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
  return Math.floor(b64.length * 3 / 4) - pad;
}

function storageDrive_esJpeg(b64) {
  try {
    var bytes = Utilities.base64Decode(b64.substring(0, 16));
    return bytes.length >= 3 && (bytes[0] & 0xff) === 0xff && (bytes[1] & 0xff) === 0xd8 && (bytes[2] & 0xff) === 0xff;
  } catch (err) {
    return false;
  }
}

function storageDrive_validarPut(p) {
  if (!p || typeof p !== 'object') { return 'MALFORMED'; }
  if (typeof p.fotoId !== 'string' || !STORAGE_UUID_REGEX.test(p.fotoId)) { return 'INVALID_FOTO_ID'; }
  if (typeof p.evaluacionId !== 'string' || !STORAGE_UUID_REGEX.test(p.evaluacionId)) { return 'INVALID_EVALUACION_ID'; }
  if (typeof p.wellId !== 'string' || !STORAGE_WELLID_REGEX.test(p.wellId)) { return 'INVALID_WELL_ID'; }
  if (typeof p.nombreArchivo !== 'string' || !STORAGE_NOMBRE_REGEX.test(p.nombreArchivo)) { return 'INVALID_NOMBRE'; }
  if (p.mimeType !== 'image/jpeg') { return 'INVALID_MIME'; }
  if (typeof p.imagenBase64 !== 'string' || !STORAGE_BASE64_REGEX.test(p.imagenBase64) ||
      storageDrive_bytesDeBase64(p.imagenBase64) > STORAGE_MAX_BYTES || !storageDrive_esJpeg(p.imagenBase64)) { return 'INVALID_IMAGEN'; }
  if (typeof p.thumbBase64 !== 'string' || !STORAGE_BASE64_REGEX.test(p.thumbBase64) ||
      storageDrive_bytesDeBase64(p.thumbBase64) > STORAGE_THUMB_MAX_BYTES || !storageDrive_esJpeg(p.thumbBase64)) { return 'INVALID_THUMB'; }
  return null;
}

function storageDrive_carpetaAnio(raiz, anio) {
  var nombre = String(anio);
  var it = raiz.getFoldersByName(nombre);
  return it.hasNext() ? it.next() : raiz.createFolder(nombre);
}

// True si el archivo cuelga de una carpeta hija directa de la raiz.
function storageDrive_estaBajoRaiz(file, rootId) {
  var padres = file.getParents();
  while (padres.hasNext()) {
    var padre = padres.next();
    if (padre.getId() === rootId) {
      return true;
    }
    var abuelos = padre.getParents();
    while (abuelos.hasNext()) {
      if (abuelos.next().getId() === rootId) {
        return true;
      }
    }
  }
  return false;
}

// Guarda foto + miniatura. Idempotente por nombre: si ya existe un archivo
// con ese nombre en la carpeta del anio (reintento tras una respuesta
// perdida) devuelve el existente en vez de duplicar. anio = anio actual
// del servidor.
function storageDrive_putFoto(p, anio) {
  var error = storageDrive_validarPut(p);
  if (error) {
    return { status: 'error', code: error };
  }
  var raiz = DriveApp.getFolderById(getStorageRootFolderId());
  var carpeta = storageDrive_carpetaAnio(raiz, anio);

  var existentes = carpeta.getFilesByName(p.nombreArchivo);
  if (existentes.hasNext()) {
    var ya = existentes.next();
    return { status: 'ok', driveFileId: ya.getId(), tamanoBytes: ya.getSize() };
  }

  var bytes = Utilities.base64Decode(p.imagenBase64);
  var archivo = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', p.nombreArchivo));
  var nombreThumb = p.nombreArchivo.replace(/\.jpg$/, '_thumb.jpg');
  var thumb = carpeta.createFile(Utilities.newBlob(Utilities.base64Decode(p.thumbBase64), 'image/jpeg', nombreThumb));
  archivo.setDescription('thumb:' + thumb.getId());
  try {
    archivo.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
    thumb.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  } catch (err) {
    // El dominio puede restringir setSharing; los archivos nuevos ya nacen
    // privados (solo el propietario), asi que no es un error.
  }
  return { status: 'ok', driveFileId: archivo.getId(), tamanoBytes: archivo.getSize() };
}

function storageDrive_abrirArchivoSeguro(driveFileId) {
  if (typeof driveFileId !== 'string' || !STORAGE_DRIVE_ID_REGEX.test(driveFileId)) {
    return null;
  }
  var rootId = getStorageRootFolderId();
  var file;
  try {
    file = DriveApp.getFileById(driveFileId);
  } catch (err) {
    return null;
  }
  return storageDrive_estaBajoRaiz(file, rootId) ? file : null;
}

function storageDrive_getFoto(p) {
  if (!p || (p.variante !== 'thumb' && p.variante !== 'full')) {
    return { status: 'error', code: 'INVALID_VARIANTE' };
  }
  var archivo = storageDrive_abrirArchivoSeguro(p.driveFileId);
  if (!archivo) {
    return { status: 'error', code: 'NOT_FOUND' };
  }
  var objetivo = archivo;
  if (p.variante === 'thumb') {
    var desc = archivo.getDescription() || '';
    var m = /^thumb:([A-Za-z0-9_-]{10,100})$/.exec(desc);
    var thumb = m ? storageDrive_abrirArchivoSeguro(m[1]) : null;
    if (thumb) {
      objetivo = thumb;
    }
    // sin miniatura (no deberia pasar): se devuelve la completa
  }
  var blob = objetivo.getBlob();
  return { status: 'ok', mimeType: blob.getContentType(), imagenBase64: Utilities.base64Encode(blob.getBytes()) };
}

// Solo compensacion del backend principal (foto subida pero no
// registrada): papelera, nunca borrado definitivo.
function storageDrive_trashFoto(p) {
  var archivo = storageDrive_abrirArchivoSeguro(p && p.driveFileId);
  if (!archivo) {
    return { status: 'error', code: 'NOT_FOUND' };
  }
  var desc = archivo.getDescription() || '';
  var m = /^thumb:([A-Za-z0-9_-]{10,100})$/.exec(desc);
  if (m) {
    var thumb = storageDrive_abrirArchivoSeguro(m[1]);
    if (thumb) {
      thumb.setTrashed(true);
    }
  }
  archivo.setTrashed(true);
  return { status: 'ok' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    storageDrive_validarPut,
    storageDrive_putFoto,
    storageDrive_getFoto,
    storageDrive_trashFoto,
    storageDrive_estaBajoRaiz
  };
}
