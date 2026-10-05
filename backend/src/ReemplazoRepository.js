// Unica funcion/archivo que sabe que existe una hoja "EvaluacionesReemplazo"
// en Sheets (mismo spreadsheet que Usuarios/Busquedas/Historial).
// Modulo Reemplazos v1: historial APPEND-ONLY de evaluaciones de aptitud
// de un pozo como candidato a reemplazar un pozo de monitoreo
// problematico. Nunca se edita ni se borra una fila desde la app: una
// evaluacion nueva es SIEMPRE una fila nueva.
//
// Columnas (header exacto, fila 1):
//   timestamp | evaluacionId | wellId | email | nombre | estado | motivo | observacion | puntoNEReferencia
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase
// insensible), igual que la hoja Usuarios - reordenarlas a mano en la hoja
// no rompe nada. Si falta alguna, se lanza error (fail-closed: nunca se
// escribe en una hoja con un esquema que no se reconoce).
var REEMPLAZO_HOJA = 'EvaluacionesReemplazo';
var REEMPLAZO_COLUMNAS = ['timestamp', 'evaluacionId', 'wellId', 'email', 'nombre', 'estado', 'motivo', 'observacion', 'puntoNEReferencia'];
var REEMPLAZO_LOCK_TIMEOUT_MS = 10000;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function reemplazoRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  REEMPLAZO_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

function reemplazoRepository_columnasFaltantes(indices) {
  return REEMPLAZO_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
}

// Arma la fila a escribir respetando el orden REAL de las columnas de la
// hoja (anchoHeader de ancho; las columnas desconocidas quedan vacias).
function reemplazoRepository_filaDesdeEvaluacion(evaluacion, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  REEMPLAZO_COLUMNAS.forEach(function (nombre) {
    var valor = evaluacion[nombre];
    fila[indices[nombre]] = (valor === null || valor === undefined) ? '' : valor;
  });
  return fila;
}

// Fila de la hoja -> evaluacion "cruda" del repositorio (timestamp ISO o
// null si la celda no es una fecha valida). La validacion de contenido
// (estado/motivo validos) es del Service, no de aca.
function reemplazoRepository_evaluacionDesdeFila(row, indices) {
  function texto(nombre) {
    var v = row[indices[nombre]];
    return (v === null || v === undefined) ? '' : String(v).trim();
  }
  var ts = row[indices.timestamp];
  var fecha = ts instanceof Date ? ts : new Date(ts);
  return {
    timestamp: isNaN(fecha.getTime()) ? null : fecha.toISOString(),
    evaluacionId: texto('evaluacionId'),
    wellId: texto('wellId'),
    email: texto('email'),
    nombre: texto('nombre'),
    estado: texto('estado'),
    motivo: texto('motivo'),
    observacion: texto('observacion'),
    puntoNEReferencia: texto('puntoNEReferencia')
  };
}

// --- Acceso a Sheets ---

function reemplazoRepository_abrirHoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(REEMPLAZO_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + REEMPLAZO_HOJA + '" en el spreadsheet configurado (correr setupEvaluacionesReemplazoSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + REEMPLAZO_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = reemplazoRepository_indiceColumnas(header);
  var faltantes = reemplazoRepository_columnasFaltantes(indices);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + REEMPLAZO_HOJA + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  return { sheet: sheet, indices: indices, ancho: header.length };
}

// Todas las evaluaciones de un pozo, en el orden de la hoja (sin
// ordenar - el orden cronologico es decision del Service). Lee la hoja
// completa: a la escala esperada (miles de filas como mucho) es una sola
// lectura barata, y evita un indice/cache que podria quedar desfasado
// respecto de una escritura reciente.
function reemplazoRepository_listarPorWellId(wellId) {
  var hoja = reemplazoRepository_abrirHoja();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var ev = reemplazoRepository_evaluacionDesdeFila(data[i], hoja.indices);
    if (ev.wellId === wellId) {
      resultado.push(ev);
    }
  }
  return resultado;
}

// Append de UNA fila. LockService (lock de script) serializa escrituras
// concurrentes: se escribe con formato texto previo, lo que requiere
// conocer la fila destino, y dos usuarios guardando a la vez podrian
// elegir la misma "proxima fila" y pisarse. Todas las columnas menos
// timestamp se escriben como TEXTO PLANO: una observacion que empiece con
// "=" o "+" nunca se evalua como formula.
function reemplazoRepository_agregar(evaluacion) {
  var hoja = reemplazoRepository_abrirHoja();
  var lock = LockService.getScriptLock();
  lock.waitLock(REEMPLAZO_LOCK_TIMEOUT_MS);
  try {
    var fila = reemplazoRepository_filaDesdeEvaluacion(evaluacion, hoja.indices, hoja.ancho);
    var numeroFila = hoja.sheet.getLastRow() + 1;
    var rango = hoja.sheet.getRange(numeroFila, 1, 1, hoja.ancho);
    var formatos = [];
    for (var c = 0; c < hoja.ancho; c++) {
      formatos.push(c === hoja.indices.timestamp ? 'yyyy-mm-dd hh:mm:ss' : '@');
    }
    rango.setNumberFormats([formatos]);
    rango.setValues([fila]);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar >
// setupEvaluacionesReemplazoSheet) para crear la hoja con su encabezado
// exacto. No toca una hoja que ya existe.
function setupEvaluacionesReemplazoSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  if (spreadsheet.getSheetByName(REEMPLAZO_HOJA)) {
    Logger.log('La hoja ' + REEMPLAZO_HOJA + ' ya existe, no se modifico.');
    return;
  }
  var sheet = spreadsheet.insertSheet(REEMPLAZO_HOJA);
  sheet.getRange(1, 1, 1, REEMPLAZO_COLUMNAS.length).setValues([REEMPLAZO_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + REEMPLAZO_HOJA + ' creada.');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REEMPLAZO_COLUMNAS,
    reemplazoRepository_indiceColumnas,
    reemplazoRepository_columnasFaltantes,
    reemplazoRepository_filaDesdeEvaluacion,
    reemplazoRepository_evaluacionDesdeFila
  };
}
