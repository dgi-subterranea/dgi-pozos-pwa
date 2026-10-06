// Logica PURA de las fotos de una evaluacion de reemplazo (sin DOM, sin
// canvas, sin red) - la testea Jest (js/reemplazoFotosLogic.test.js).
// js/reemplazoFotos.js es el controlador (canvas, inputs, cola de subida).
//
// LIMITES (v2) y por que:
//  - 5 fotos por evaluacion: alcanza para registrar el estado de un pozo
//    (instalacion, acceso, boca, entorno) sin inflar la cuenta de storage.
//  - 15 MB por archivo ORIGINAL: una foto de iPhone/Android de 12-48 MP
//    pesa 2-8 MB; 15 MB deja margen sin aceptar videos ni archivos
//    enormes que podrian colgar el canvas del celular.
//  - 1600 px de lado mayor, JPEG calidad 0.72 (escalera 0.72 -> 0.62 -> 0.52):
//    legible en pantalla de campo, tipicamente 0.2-0.6 MB.
//  - 1.5 MB comprimido (objetivo del navegador) / 2 MB (tope duro del
//    backend): una foto que ni a calidad 0.52 baja de 1.5 MB se rechaza.
//  - miniatura de 256 px (~10-20 KB) para el historial: el historial NO
//    descarga imagenes grandes.
//  - 1 foto por request, cola SECUENCIAL: Apps Script atiende pocas
//    ejecuciones en paralelo y cada subida hace 2 viajes (backend ->
//    storage); en paralelo se compiten por el lock de la hoja.
var REEMPLAZO_FOTOS_MAX = 5;
var REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES = 15 * 1024 * 1024;
var REEMPLAZO_FOTOS_MAX_DIM = 1600;
var REEMPLAZO_FOTOS_THUMB_DIM = 256;
var REEMPLAZO_FOTOS_CALIDADES = [0.72, 0.62, 0.52];
var REEMPLAZO_FOTOS_THUMB_CALIDAD = 0.6;
var REEMPLAZO_FOTOS_OBJETIVO_BYTES = 1.5 * 1024 * 1024;

// Dimensiones destino: mantiene proporcion, el lado mayor <= max, nunca
// agranda una imagen chica.
function reemplazoFotosLogic_dimensiones(ancho, alto, max) {
  if (!(ancho > 0) || !(alto > 0)) {
    return { ancho: 0, alto: 0 };
  }
  var limite = max || REEMPLAZO_FOTOS_MAX_DIM;
  var mayor = Math.max(ancho, alto);
  if (mayor <= limite) {
    return { ancho: Math.round(ancho), alto: Math.round(alto) };
  }
  var factor = limite / mayor;
  return { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)) };
}

// Siguiente calidad a probar tras comprimir a "calidadActual" y obtener
// "bytes": null si ya cabe en el objetivo o si no quedan calidades.
function reemplazoFotosLogic_siguienteCalidad(calidadActual, bytes, objetivoBytes) {
  var objetivo = objetivoBytes || REEMPLAZO_FOTOS_OBJETIVO_BYTES;
  if (bytes <= objetivo) {
    return null;
  }
  var i = REEMPLAZO_FOTOS_CALIDADES.indexOf(calidadActual);
  return (i >= 0 && i + 1 < REEMPLAZO_FOTOS_CALIDADES.length) ? REEMPLAZO_FOTOS_CALIDADES[i + 1] : null;
}

// Tipos que se intentan decodificar en el navegador. HEIC/HEIF se
// intentan, pero su compatibilidad depende del navegador/dispositivo y esta
// PENDIENTE DE VALIDACION en un iPhone real (no se asume ninguna conversion
// automatica). Si el navegador no puede decodificarlos, el controlador
// informa un error amigable por foto; no se usa ninguna libreria HEIC.
var REEMPLAZO_FOTOS_TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

// {ok:true} | {ok:false, code}. cantidadActual = fotos ya en la lista.
function reemplazoFotosLogic_validarArchivo(archivo, cantidadActual) {
  if (cantidadActual >= REEMPLAZO_FOTOS_MAX) {
    return { ok: false, code: 'LIMITE_FOTOS' };
  }
  if (!archivo) {
    return { ok: false, code: 'SIN_ARCHIVO' };
  }
  var tipo = String(archivo.type || '').toLowerCase();
  // Algunos navegadores entregan type vacio para HEIC: se deja pasar si la
  // extension lo indica; el decode decide.
  var nombre = String(archivo.name || '').toLowerCase();
  var porExtension = /\.(jpe?g|png|webp|heic|heif)$/.test(nombre);
  if (REEMPLAZO_FOTOS_TIPOS.indexOf(tipo) < 0 && !(tipo === '' && porExtension)) {
    return { ok: false, code: 'TIPO_NO_SOPORTADO' };
  }
  if (!(archivo.size > 0)) {
    return { ok: false, code: 'ARCHIVO_VACIO' };
  }
  if (archivo.size > REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES) {
    return { ok: false, code: 'ORIGINAL_MUY_GRANDE' };
  }
  return { ok: true };
}

function reemplazoFotosLogic_formatearBytes(bytes) {
  if (!(bytes >= 0)) {
    return '—';
  }
  if (bytes < 1024) {
    return Math.round(bytes) + ' B';
  }
  if (bytes < 1024 * 1024) {
    return (bytes / 1024).toFixed(0) + ' KB';
  }
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// "data:image/jpeg;base64,XXXX" -> "XXXX"
function reemplazoFotosLogic_base64DeDataUrl(dataUrl) {
  var i = String(dataUrl || '').indexOf(',');
  return i >= 0 ? dataUrl.substring(i + 1) : '';
}

var REEMPLAZO_FOTOS_MENSAJES = {
  LIMITE_FOTOS: 'Máximo ' + REEMPLAZO_FOTOS_MAX + ' fotos por evaluación.',
  SIN_ARCHIVO: 'No se pudo leer el archivo.',
  TIPO_NO_SOPORTADO: 'Formato no soportado. Usá una foto JPEG, PNG o WebP.',
  ARCHIVO_VACIO: 'El archivo está vacío.',
  ORIGINAL_MUY_GRANDE: 'La foto pesa más de ' + (REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES / (1024 * 1024)) + ' MB.',
  DECODIFICAR: 'No se pudo abrir esta imagen en tu navegador. Probá con otra foto o con otro formato (JPEG).',
  COMPRIMIR_GRANDE: 'La foto sigue muy pesada incluso comprimida. Probá con otra.',
  // codigos del backend
  PERMISSION_DENIED: 'No tenés permiso para subir fotos.',
  EVALUACION_NOT_FOUND: 'La evaluación ya no existe.',
  EVALUACION_WELLID_MISMATCH: 'La evaluación pertenece a otro pozo.',
  FOTO_LIMIT: 'La evaluación ya tiene el máximo de fotos.',
  FILE_TOO_LARGE: 'La foto es demasiado pesada.',
  INVALID_MIME: 'Formato de imagen no válido.',
  INVALID_IMAGEN: 'La imagen no es válida.',
  INVALID_THUMB: 'La miniatura no es válida.',
  STORAGE_UNAVAILABLE: 'El almacenamiento de fotos no está disponible. Reintentá en unos minutos.',
  SERVICE_UNAVAILABLE: 'No se pudo subir la foto. Reintentá.',
  RED: 'Sin conexión. Reintentá.'
};

function reemplazoFotosLogic_mensajeError(code) {
  return REEMPLAZO_FOTOS_MENSAJES[code] || 'No se pudo subir la foto. Reintentá.';
}

// Una subida fallida muestra SIEMPRE el codigo real que devolvio el backend
// (o RED si ni respondio): el mensaje amigable es generico y ocultaba la
// causa. Es una linea corta para soporte, sin datos de la imagen.
function reemplazoFotosLogic_textoCodigo(codigo) {
  return codigo ? 'Código: ' + codigo : '';
}

// Items de la cola. estado: 'procesando' | 'lista' | 'error' | 'pendiente'
// (guardada la evaluacion, esperando turno) | 'subiendo' | 'subida' |
// 'fallida'. Devuelve el primer item que toca subir (cola secuencial) o
// null. Una fallida NO se reintenta sola: solo con accion explicita.
function reemplazoFotosLogic_siguienteASubir(items) {
  for (var i = 0; i < items.length; i++) {
    if (items[i].estado === 'pendiente') {
      return items[i];
    }
  }
  return null;
}

function reemplazoFotosLogic_hayEnCurso(items) {
  return items.some(function (it) { return it.estado === 'subiendo' || it.estado === 'pendiente' || it.estado === 'procesando'; });
}

// Resumen de la subida: {total, subidas, fallidas, enCurso}
function reemplazoFotosLogic_resumenSubida(items) {
  var r = { total: items.length, subidas: 0, fallidas: 0, enCurso: 0 };
  items.forEach(function (it) {
    if (it.estado === 'subida') { r.subidas += 1; }
    else if (it.estado === 'fallida') { r.fallidas += 1; }
    else if (it.estado === 'subiendo' || it.estado === 'pendiente') { r.enCurso += 1; }
  });
  return r;
}

// Fotos que se suben al guardar: las 'lista' (procesadas bien).
function reemplazoFotosLogic_listasParaSubir(items) {
  return items.filter(function (it) { return it.estado === 'lista'; });
}

// Agrupa la metadata de fotos de un pozo por evaluacion (sin mezclar).
function reemplazoFotosLogic_agruparPorEvaluacion(fotos) {
  var mapa = {};
  (fotos || []).forEach(function (f) {
    if (!mapa[f.evaluacionId]) {
      mapa[f.evaluacionId] = [];
    }
    mapa[f.evaluacionId].push(f);
  });
  return mapa;
}

// Indice vecino del visor (circular).
function reemplazoFotosLogic_vecino(indice, total, direccion) {
  if (total <= 0) {
    return 0;
  }
  return (indice + direccion + total) % total;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REEMPLAZO_FOTOS_MAX,
    REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES,
    REEMPLAZO_FOTOS_MAX_DIM,
    REEMPLAZO_FOTOS_THUMB_DIM,
    REEMPLAZO_FOTOS_CALIDADES,
    REEMPLAZO_FOTOS_OBJETIVO_BYTES,
    reemplazoFotosLogic_dimensiones,
    reemplazoFotosLogic_siguienteCalidad,
    reemplazoFotosLogic_validarArchivo,
    reemplazoFotosLogic_formatearBytes,
    reemplazoFotosLogic_base64DeDataUrl,
    reemplazoFotosLogic_mensajeError,
    reemplazoFotosLogic_textoCodigo,
    reemplazoFotosLogic_siguienteASubir,
    reemplazoFotosLogic_hayEnCurso,
    reemplazoFotosLogic_resumenSubida,
    reemplazoFotosLogic_listasParaSubir,
    reemplazoFotosLogic_agruparPorEvaluacion,
    reemplazoFotosLogic_vecino
  };
}
