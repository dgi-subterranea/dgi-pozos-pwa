// ItfArchivoLogic (E9-2): validadores PUROS del archivo de un ITF propuesto. No sabe nada de HTTP, de Sheets, de Drive ni del storage: recibe bytes y devuelve un veredicto.
// Documento de diseno: docs/itf-colaborativos.md.
//
// ESTADO DE ESTA ETAPA: NADA de esto se llama desde Api.js todavia (no hay endpoint de subida). E9-3 lo usa al recibir una propuesta.
//
// FORMATOS DE E9 v1: SOLO image/jpeg e image/png. NO hay PDF (decision de E9-1: no se asume que exista un PDF institucional original accesible; si mas adelante se demuestra, sera una
// evolucion explicita). El MIME declarado y el nombre NO alcanzan: se verifican los BYTES REALES (magic bytes) y tienen que coincidir con el MIME declarado.
//   JPEG  FF D8 FF                                            (inicio de imagen + marcador)
//   PNG   89 50 4E 47 0D 0A 1A 0A + chunk IHDR de 13 bytes   (firma + primer chunk obligatorio)
// Esto NO es un antivirus ni garantiza que la imagen se vea entera: detecta archivos vacios, de otro formato o con la cabecera rota. No hay OCR ni interpretacion del contenido.
//
// DOS LIMITES DE TAMANO, SEPARADOS (no se mezclan nunca):
//   A. PROPUESTA NUEVA: ITF_ARCHIVO_BYTES_MAX = 3 MB. Aplica SOLO a lo que sube una persona (navegador -> backend -> storage). Validador: itfArchivo_validarPropuesta.
//   B. LEGACY EXISTENTE: ITF_LEGACY_BYTES_MAX = 20 MB. Es un tope DEFENSIVO para las operaciones que cargan los bytes completos de un archivo institucional existente (registrar su huella antes de
//      reemplazarlo / retirarlo / restaurarlo, y verificarla). La auditoria real midio 17.364 archivos con un maximo de 11,54 MB (42 sobre 3 MB): 20 MB deja margen y no hay recodificacion ni movimiento.
//      Validador: itfArchivo_validarLegacy. Nunca se le aplica el limite A.
//
// TAMANO MAXIMO DE UNA PROPUESTA: 3 MB (3.145.728 bytes), el mismo tope que el storage de Fotos (storage/src/StorageDrive.js). Evidencia (E9-1): los ITF de la carpeta de consulta (THUMB) son derivados
// comprimidos de unos 37-170 KB (escaneos originales de ~6668x5191 reducidos a ~2958x2303, calidad 52); 3 MB deja un margen amplio para una foto de celular sin obligar a mandar un
// escaneo gigante por una API que transporta todo en base64 dentro de JSON. Si algun dia hace falta mas, se sube aca (y en el storage) con una decision explicita.
//
// BYTES DE APPS SCRIPT: Blob.getBytes() y Utilities.computeDigest() devuelven bytes CON SIGNO (-128..127): todo se enmascara con & 0xFF. Tambien se aceptan Uint8Array / Buffer / Array
// de enteros 0..255, que es lo que usan los tests.
var ITF_MIME_PERMITIDOS = ['image/jpeg', 'image/png'];
var ITF_ARCHIVO_BYTES_MAX = 3 * 1024 * 1024;
var ITF_LEGACY_BYTES_MAX = 20 * 1024 * 1024;
var ITF_SHA256_REGEX = /^[0-9a-f]{64}$/;
var ITF_STORAGE_ID_REGEX = /^[A-Za-z0-9_-]{10,200}$/;
var ITF_NOMBRE_ORIGINAL_MAX = 150;
var ITF_NOMBRE_ORIGINAL_NEUTRO = 'sin-nombre';

function itfArchivo_error(code, message) {
  return { ok: false, code: code, message: message };
}

// Byte sin signo en la posicion i (o -1 si no existe).
function itfArchivo_byte(bytes, i) {
  var v = bytes[i];
  return typeof v === 'number' && isFinite(v) ? (v & 0xFF) : -1;
}

function itfArchivo_esListaDeBytes(bytes) {
  if (bytes === null || bytes === undefined || typeof bytes === 'string') {
    return false;
  }
  return Array.isArray(bytes) || (typeof bytes === 'object' && typeof bytes.length === 'number' && bytes.length >= 0 && Math.floor(bytes.length) === bytes.length);
}

// 'image/jpeg' | 'image/png' | null segun los BYTES (nunca segun el nombre ni el MIME declarado).
function itfArchivo_detectarFormato(bytes) {
  if (!itfArchivo_esListaDeBytes(bytes)) {
    return null;
  }
  if (bytes.length >= 3 && itfArchivo_byte(bytes, 0) === 0xFF && itfArchivo_byte(bytes, 1) === 0xD8 && itfArchivo_byte(bytes, 2) === 0xFF) {
    return 'image/jpeg';
  }
  var firmaPng = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  var ihdr = [0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52];      // longitud 13 + "IHDR"
  if (bytes.length >= 16) {
    var esPng = true;
    for (var i = 0; i < 8; i++) {
      if (itfArchivo_byte(bytes, i) !== firmaPng[i] || itfArchivo_byte(bytes, 8 + i) !== ihdr[i]) {
        esPng = false;
        break;
      }
    }
    if (esPng) {
      return 'image/png';
    }
  }
  return null;
}

// Veredicto de un archivo: entrada {mimeType, bytes}. Orden de los controles (el primero que falla manda):
//   INVALID_ARCHIVO (no son bytes) -> ARCHIVO_VACIO -> ARCHIVO_DEMASIADO_GRANDE -> MIME_NO_PERMITIDO (incluye application/pdf) -> FORMATO_NO_RECONOCIDO (magic bytes) -> MIME_NO_COINCIDE.
// {ok:true, mimeType (el detectado), bytes (el largo real)} | {ok:false, code, message} (sin eco del contenido).
function itfArchivo_validarPropuesta(entrada) {
  var e = entrada !== null && typeof entrada === 'object' ? entrada : {};
  if (!itfArchivo_esListaDeBytes(e.bytes)) {
    return itfArchivo_error('INVALID_ARCHIVO', 'el archivo no es una secuencia de bytes');
  }
  if (e.bytes.length === 0) {
    return itfArchivo_error('ARCHIVO_VACIO', 'el archivo esta vacio');
  }
  if (e.bytes.length > ITF_ARCHIVO_BYTES_MAX) {
    return itfArchivo_error('ARCHIVO_DEMASIADO_GRANDE', 'el archivo supera el maximo de ' + ITF_ARCHIVO_BYTES_MAX + ' bytes');
  }
  var declarado = typeof e.mimeType === 'string' ? e.mimeType.trim().toLowerCase() : '';
  if (ITF_MIME_PERMITIDOS.indexOf(declarado) < 0) {
    return itfArchivo_error('MIME_NO_PERMITIDO', 'solo se aceptan imagenes JPEG o PNG');
  }
  var detectado = itfArchivo_detectarFormato(e.bytes);
  if (detectado === null) {
    return itfArchivo_error('FORMATO_NO_RECONOCIDO', 'el contenido no es una imagen JPEG o PNG valida');
  }
  if (detectado !== declarado) {
    return itfArchivo_error('MIME_NO_COINCIDE', 'el tipo declarado no coincide con el contenido');
  }
  return { ok: true, mimeType: detectado, bytes: e.bytes.length };
}

// Nombre historico del validador de PROPUESTAS (limite de 3 MB): se conserva para no romper a quien ya lo llama. Para un archivo legacy existente NO se usa (ver itfArchivo_validarLegacy).
function itfArchivo_validar(entrada) {
  return itfArchivo_validarPropuesta(entrada);
}

// Veredicto de un archivo LEGACY EXISTENTE (solo para registrar su huella): entrada {bytes}. JPEG o PNG real por magic bytes, no vacio y como maximo ITF_LEGACY_BYTES_MAX (tope defensivo, NO el de 3 MB
// de las propuestas). Fail-closed: lo que no cumple se rechaza con LEGACY_FORMATO_INVALIDO y un mensaje explicito (el codigo existente del catalogo; no se inventa otro).
// {ok:true, mimeType (el detectado), bytes (el largo real)} | {ok:false, code:'LEGACY_FORMATO_INVALIDO', message}.
function itfArchivo_validarLegacy(entrada) {
  var e = entrada !== null && typeof entrada === 'object' ? entrada : {};
  var invalido = function (mensaje) { return itfArchivo_error('LEGACY_FORMATO_INVALIDO', mensaje); };
  if (!itfArchivo_esListaDeBytes(e.bytes)) {
    return invalido('el archivo legacy no es una secuencia de bytes');
  }
  if (e.bytes.length === 0) {
    return invalido('el archivo legacy esta vacio');
  }
  if (e.bytes.length > ITF_LEGACY_BYTES_MAX) {
    return invalido('el archivo legacy supera el limite defensivo de ' + ITF_LEGACY_BYTES_MAX + ' bytes');
  }
  var detectado = itfArchivo_detectarFormato(e.bytes);
  if (detectado === null) {
    return invalido('el archivo legacy no es una imagen JPEG o PNG valida');
  }
  return { ok: true, mimeType: detectado, bytes: e.bytes.length };
}

// SHA-256 en hexadecimal minuscula (64 caracteres) de los bytes REALES. `calcularDigest` es inyectable (los tests usan crypto de Node); por defecto, el de Apps Script:
// Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes). Lanza si el digest no tiene 32 bytes: un hash dudoso nunca se escribe.
// El hash sirve para deduplicacion exacta, idempotencia e integridad; NUNCA es un identificador publico ni el documentoId.
function itfArchivo_sha256Hex(bytes, calcularDigest) {
  if (!itfArchivo_esListaDeBytes(bytes)) {
    throw new Error('itfArchivo_sha256Hex: se esperaban bytes');
  }
  var fn = typeof calcularDigest === 'function'
    ? calcularDigest
    : function (b) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b); };
  var digest = fn(bytes);
  if (!itfArchivo_esListaDeBytes(digest) || digest.length !== 32) {
    throw new Error('itfArchivo_sha256Hex: el digest no tiene 32 bytes');
  }
  var hex = '';
  for (var i = 0; i < 32; i++) {
    hex += ('0' + itfArchivo_byte(digest, i).toString(16)).slice(-2);
  }
  return hex;
}

// Nombre original del archivo, SOLO para mostrar y auditar (jamas para guardar: el storage usa nombres generados). Una linea, sin controles, sin ruta, acotado; 'sin-nombre' si no queda nada.
function itfArchivo_nombreOriginal(nombre) {
  var n = typeof nombre === 'string' ? nombre : '';
  n = n
    .replace(/\r\n|\r|\n|\u0085|\u2028|\u2029/g, ' ')
    .replace(/[\u0000-\u0008\u000A-\u001F\u007F-\u0084\u0086-\u009F\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  n = n.replace(/\t/g, ' ');
  n = n.split(/[\\/]/).pop().replace(/\s+/g, ' ').trim();
  if (Array.from(n).length > ITF_NOMBRE_ORIGINAL_MAX) {
    n = Array.from(n).slice(0, ITF_NOMBRE_ORIGINAL_MAX).join('').trim();
  }
  return n === '' ? ITF_NOMBRE_ORIGINAL_NEUTRO : n;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_MIME_PERMITIDOS,
    ITF_ARCHIVO_BYTES_MAX,
    ITF_LEGACY_BYTES_MAX,
    ITF_SHA256_REGEX,
    ITF_STORAGE_ID_REGEX,
    ITF_NOMBRE_ORIGINAL_MAX,
    ITF_NOMBRE_ORIGINAL_NEUTRO,
    itfArchivo_detectarFormato,
    itfArchivo_validar,
    itfArchivo_validarPropuesta,
    itfArchivo_validarLegacy,
    itfArchivo_sha256Hex,
    itfArchivo_nombreOriginal
  };
}
