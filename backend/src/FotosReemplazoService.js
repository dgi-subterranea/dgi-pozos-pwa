// FotosReemplazoService: logica de negocio de las fotos de una evaluacion
// de reemplazo (Reemplazos v2). No sabe nada de HTTP (Api.js), de Sheets
// (FotosReemplazoRepository.js) ni de como se habla con el storage
// (FotosStorageClient.js).
//
// Arquitectura transaccional: la evaluacion se guarda PRIMERO (v1) y las
// fotos se suben DESPUES, una por request. Una foto que falla nunca
// deshace la evaluacion ni las otras fotos; el frontend reintenta solo las
// que fallaron.
//
// Privacidad: las fotos pueden mostrar instalaciones, domicilios o
// personas. Nunca hay URL publica ni link compartible; el frontend recibe
// metadata sanitizada (sin email ni driveFileId) y la imagen solo a
// traves de getFotoReemplazo (gateado por "reemplazo", proxy por este
// backend). El archivo es SIEMPRE un JPEG que el navegador re-codifico con
// canvas (sin EXIF/GPS) - aca se vuelve a validar tipo, firma binaria y
// tamano, sin confiar en el navegador.
var FOTOS_MAX_POR_EVALUACION = 5;
var FOTOS_MAX_BYTES = 2 * 1024 * 1024;       // JPEG ya comprimido (1600px, q~0.72 ronda 0.2-0.6 MB)
var FOTOS_THUMB_MAX_BYTES = 60 * 1024;       // miniatura ~256px
var FOTOS_MIME_PERMITIDO = 'image/jpeg';
var FOTOS_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var FOTOS_BASE64_REGEX = /^[A-Za-z0-9+\/]+={0,2}$/;
var FOTOS_THUMB_CACHE_SEG = 21600;
var FOTOS_THUMB_CACHE_MAX_CHARS = 95000;     // CacheService: 100 KB por valor

function fotosService_error(code, message) {
  return { ok: false, code: code, message: message };
}

// Logging seguro: el mensaje de un error de red del storage puede traer su
// URL (o ids largos). Antes de loguearlo se tapan las URLs y cualquier tramo
// largo con pinta de base64/id, y se recorta. Nunca se loguea base64,
// secreto, URL del storage, driveFileId ni email.
function fotosService_limpiar(mensaje) {
  return String(mensaje).replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9+\/=_-]{16,}/g, '[...]').substring(0, 160);
}

// Bytes que representa un base64 (sin decodificarlo entero).
function fotosService_bytesDeBase64(b64) {
  var len = b64.length;
  var pad = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
  return Math.floor(len * 3 / 4) - pad;
}

// Firma binaria de JPEG (FF D8 FF) leyendo solo los primeros bytes.
function fotosService_esJpeg(b64) {
  try {
    var bytes = Utilities.base64Decode(b64.substring(0, 16));
    return bytes.length >= 3 && (bytes[0] & 0xff) === 0xff && (bytes[1] & 0xff) === 0xd8 && (bytes[2] & 0xff) === 0xff;
  } catch (err) {
    return false;
  }
}

// Valida el contenido de una subida (no identidad ni evaluacion).
// {ok:true, valores} | {ok:false, code, message}
function fotosService_validarSubida(evaluacionId, nombreArchivo, mimeType, imagenBase64, thumbBase64) {
  if (typeof evaluacionId !== 'string' || !FOTOS_UUID_REGEX.test(evaluacionId)) {
    return fotosService_error('INVALID_EVALUACION_ID', 'evaluacionId invalido');
  }
  if (typeof nombreArchivo !== 'string' || nombreArchivo.length === 0 || nombreArchivo.length > 200) {
    return fotosService_error('INVALID_NOMBRE_ARCHIVO', 'nombreArchivo invalido');
  }
  if (mimeType !== FOTOS_MIME_PERMITIDO) {
    return fotosService_error('INVALID_MIME', 'solo se aceptan imagenes ' + FOTOS_MIME_PERMITIDO);
  }
  if (typeof imagenBase64 !== 'string' || imagenBase64.length === 0 || !FOTOS_BASE64_REGEX.test(imagenBase64)) {
    return fotosService_error('INVALID_IMAGEN', 'imagen invalida');
  }
  if (fotosService_bytesDeBase64(imagenBase64) > FOTOS_MAX_BYTES) {
    return fotosService_error('FILE_TOO_LARGE', 'la foto supera ' + FOTOS_MAX_BYTES + ' bytes');
  }
  if (!fotosService_esJpeg(imagenBase64)) {
    return fotosService_error('INVALID_IMAGEN', 'el archivo no es un JPEG');
  }
  if (typeof thumbBase64 !== 'string' || thumbBase64.length === 0 || !FOTOS_BASE64_REGEX.test(thumbBase64)) {
    return fotosService_error('INVALID_THUMB', 'miniatura invalida');
  }
  if (fotosService_bytesDeBase64(thumbBase64) > FOTOS_THUMB_MAX_BYTES) {
    return fotosService_error('INVALID_THUMB', 'la miniatura supera ' + FOTOS_THUMB_MAX_BYTES + ' bytes');
  }
  if (!fotosService_esJpeg(thumbBase64)) {
    return fotosService_error('INVALID_THUMB', 'la miniatura no es un JPEG');
  }
  return { ok: true };
}

// Nombre de archivo en el storage: SOLO ids validados (UUID/DD-PPPP) - el
// nombre que manda el navegador no se usa (podria llevar datos personales).
// La verdad sobre el archivo es driveFileId, nunca este nombre.
function fotosService_nombreArchivo(wellId, evaluacionId, fotoId) {
  return wellId + '_' + evaluacionId + '_' + fotoId + '.jpg';
}

// Metadata que sale hacia el frontend: sin email ni driveFileId ni nombre.
function fotosService_sanitizar(foto) {
  return {
    fotoId: foto.fotoId,
    evaluacionId: foto.evaluacionId,
    wellId: foto.wellId,
    timestamp: foto.timestamp,
    mimeType: foto.mimeType,
    tamanoBytes: foto.tamanoBytes
  };
}

function fotosService_ordenarAscendente(fotos) {
  return fotos
    .map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      var diff = new Date(a.f.timestamp).getTime() - new Date(b.f.timestamp).getTime();
      return diff !== 0 ? diff : a.i - b.i;
    })
    .map(function (x) { return x.f; });
}

function fotosService_listarPorEvaluacion(evaluacionId) {
  return {
    evaluacionId: evaluacionId,
    fotos: fotosService_ordenarAscendente(fotosRepository_listarPorEvaluacionId(evaluacionId)).map(fotosService_sanitizar)
  };
}

function fotosService_listarPorPozo(wellId) {
  return {
    wellId: wellId,
    fotos: fotosService_ordenarAscendente(fotosRepository_listarPorWellId(wellId)).map(fotosService_sanitizar)
  };
}

// Sube UNA foto a una evaluacion existente. email viene SIEMPRE de la
// sesion. {ok:true, foto} | {ok:false, code, message}
function fotosService_subir(email, wellId, evaluacionId, datos) {
  var d = datos || {};
  var validacion = fotosService_validarSubida(evaluacionId, d.nombreArchivo, d.mimeType, d.imagenBase64, d.thumbBase64);
  if (!validacion.ok) {
    return validacion;
  }

  var evaluacion = reemplazoRepository_buscarPorEvaluacionId(evaluacionId);
  if (!evaluacion) {
    return fotosService_error('EVALUACION_NOT_FOUND', 'no existe la evaluacion');
  }
  if (evaluacion.wellId !== wellId) {
    return fotosService_error('EVALUACION_WELLID_MISMATCH', 'la evaluacion pertenece a otro pozo');
  }
  // Trabajo colaborativo de campo (decision de producto): CUALQUIER usuario
  // con reemplazo=SI puede agregar fotos a cualquier evaluacion valida, sin
  // ventana temporal. FotosReemplazo.email/nombre identifica a quien subio
  // ESA foto, no a quien creo la evaluacion.

  if (fotosRepository_contarPorEvaluacionId(evaluacionId) >= FOTOS_MAX_POR_EVALUACION) {
    return fotosService_error('FOTO_LIMIT', 'maximo ' + FOTOS_MAX_POR_EVALUACION + ' fotos por evaluacion');
  }

  var fotoId = Utilities.getUuid();
  var nombre = fotosService_nombreArchivo(wellId, evaluacionId, fotoId);

  var almacenada;
  try {
    almacenada = fotosStorageClient_subir({
      fotoId: fotoId,
      wellId: wellId,
      evaluacionId: evaluacionId,
      nombreArchivo: nombre,
      mimeType: d.mimeType,
      imagenBase64: d.imagenBase64,
      thumbBase64: d.thumbBase64
    });
  } catch (err) {
    Logger.log('Storage de fotos no disponible: ' + fotosService_limpiar(err));
    return fotosService_error('STORAGE_UNAVAILABLE', 'no se pudo guardar la foto');
  }

  var foto = {
    timestamp: new Date(),
    fotoId: fotoId,
    evaluacionId: evaluacionId,
    wellId: wellId,
    email: email,
    driveFileId: almacenada.driveFileId,
    nombreArchivo: nombre,
    mimeType: d.mimeType,
    tamanoBytes: almacenada.tamanoBytes
  };

  var registrada;
  try {
    registrada = fotosRepository_agregarSiHayCupo(foto, FOTOS_MAX_POR_EVALUACION);
  } catch (err) {
    fotosService_descartarSilencioso(almacenada.driveFileId);
    throw err;
  }
  if (!registrada) {
    fotosService_descartarSilencioso(almacenada.driveFileId);
    return fotosService_error('FOTO_LIMIT', 'maximo ' + FOTOS_MAX_POR_EVALUACION + ' fotos por evaluacion');
  }

  return {
    ok: true,
    foto: fotosService_sanitizar({
      fotoId: fotoId, evaluacionId: evaluacionId, wellId: wellId,
      timestamp: foto.timestamp.toISOString(), mimeType: d.mimeType, tamanoBytes: almacenada.tamanoBytes
    })
  };
}

// Compensacion: el archivo quedo en el storage pero no en la hoja. Se manda
// a la papelera del storage; si eso tambien falla solo se loguea (quedaria
// un archivo huerfano, nunca visible desde la app).
function fotosService_descartarSilencioso(driveFileId) {
  try {
    fotosStorageClient_descartar(driveFileId);
  } catch (err) {
    Logger.log('No se pudo descartar una foto huerfana: ' + fotosService_limpiar(err));
  }
}

// Imagen (miniatura o completa) de una foto, por fotoId. El navegador
// nunca manda un driveFileId: se resuelve aca desde la hoja. Las
// miniaturas se cachean (CacheService, 6 h, por fotoId) - el permiso se
// valida igual en CADA request, antes de llegar aca. Las completas no se
// cachean (superan el limite del cache).
function fotosService_obtenerImagen(fotoId, variante) {
  if (typeof fotoId !== 'string' || !FOTOS_UUID_REGEX.test(fotoId)) {
    return fotosService_error('INVALID_FOTO_ID', 'fotoId invalido');
  }
  if (variante !== 'thumb' && variante !== 'full') {
    return fotosService_error('INVALID_VARIANTE', 'variante invalida');
  }

  var cache = CacheService.getScriptCache();
  var claveCache = 'fotothumb_' + fotoId;
  // Una miniatura en cache solo se guardo DESPUES de verificar que la foto
  // existe en la hoja (y v1 no borra fotos), y fotoId es un UUID: un hit
  // evita releer la hoja entera por cada miniatura de un historial.
  if (variante === 'thumb') {
    var cacheada = cache.get(claveCache);
    if (cacheada) {
      return { ok: true, imagen: { fotoId: fotoId, variante: variante, mimeType: FOTOS_MIME_PERMITIDO, imagenBase64: cacheada } };
    }
  }
  var foto = fotosRepository_buscarPorFotoId(fotoId);
  if (!foto) {
    return fotosService_error('FOTO_NOT_FOUND', 'no existe la foto');
  }

  var r;
  try {
    r = fotosStorageClient_obtener(foto.driveFileId, variante);
  } catch (err) {
    Logger.log('Storage de fotos no disponible: ' + fotosService_limpiar(err));
    return fotosService_error('STORAGE_UNAVAILABLE', 'no se pudo leer la foto');
  }
  if (variante === 'thumb' && r.imagenBase64.length <= FOTOS_THUMB_CACHE_MAX_CHARS) {
    cache.put(claveCache, r.imagenBase64, FOTOS_THUMB_CACHE_SEG);
  }
  return { ok: true, imagen: { fotoId: fotoId, variante: variante, mimeType: r.mimeType, imagenBase64: r.imagenBase64 } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_MAX_POR_EVALUACION,
    FOTOS_MAX_BYTES,
    FOTOS_THUMB_MAX_BYTES,
    fotosService_bytesDeBase64,
    fotosService_validarSubida,
    fotosService_nombreArchivo,
    fotosService_sanitizar,
    fotosService_listarPorEvaluacion,
    fotosService_listarPorPozo,
    fotosService_subir,
    fotosService_obtenerImagen
  };
}
