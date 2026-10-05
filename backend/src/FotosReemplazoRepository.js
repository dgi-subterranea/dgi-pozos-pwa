// Unica funcion/archivo que sabe que existe una hoja "FotosReemplazo" en
// Sheets (mismo spreadsheet que Usuarios/Busquedas/Historial/
// EvaluacionesReemplazo). Una fila por foto subida a una evaluacion de
// reemplazo; APPEND-ONLY (v1 no borra ni edita fotos).
//
// Columnas (header exacto, fila 1):
//   timestamp | fotoId | evaluacionId | wellId | email | driveFileId | nombreArchivo | mimeType | tamanoBytes
// - la imagen NUNCA se guarda aca (ni base64 ni URL): vive en Drive de la
//   cuenta de STORAGE y driveFileId es la unica referencia; driveFileId no
//   sale hacia el frontend (ver FotosReemplazoService.js);
// - columnas por texto de encabezado (reordenar a mano no rompe), error si
//   falta alguna (fail-closed), todo como texto plano salvo timestamp y
//   tamanoBytes.
var FOTOS_HOJA = 'FotosReemplazo';
var FOTOS_COLUMNAS = ['timestamp', 'fotoId', 'evaluacionId', 'wellId', 'email', 'driveFileId', 'nombreArchivo', 'mimeType', 'tamanoBytes'];
var FOTOS_LOCK_TIMEOUT_MS = 10000;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function fotosRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  FOTOS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

function fotosRepository_columnasFaltantes(indices) {
  return FOTOS_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
}

function fotosRepository_filaDesdeFoto(foto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  FOTOS_COLUMNAS.forEach(function (nombre) {
    var valor = foto[nombre];
    fila[indices[nombre]] = (valor === null || valor === undefined) ? '' : valor;
  });
  return fila;
}

function fotosRepository_fotoDesdeFila(row, indices) {
  function texto(nombre) {
    var v = row[indices[nombre]];
    return (v === null || v === undefined) ? '' : String(v).trim();
  }
  var ts = row[indices.timestamp];
  var fecha = ts instanceof Date ? ts : new Date(ts);
  var tamano = Number(row[indices.tamanoBytes]);
  return {
    timestamp: isNaN(fecha.getTime()) ? null : fecha.toISOString(),
    fotoId: texto('fotoId'),
    evaluacionId: texto('evaluacionId'),
    wellId: texto('wellId'),
    email: texto('email'),
    driveFileId: texto('driveFileId'),
    nombreArchivo: texto('nombreArchivo'),
    mimeType: texto('mimeType'),
    tamanoBytes: isFinite(tamano) ? tamano : 0
  };
}

// --- Acceso a Sheets ---

function fotosRepository_abrirHoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(FOTOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + FOTOS_HOJA + '" en el spreadsheet configurado (correr setupFotosReemplazoSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + FOTOS_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = fotosRepository_indiceColumnas(header);
  var faltantes = fotosRepository_columnasFaltantes(indices);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + FOTOS_HOJA + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  return { sheet: sheet, indices: indices, ancho: header.length };
}

function fotosRepository_leerTodas(hoja) {
  var data = hoja.sheet.getDataRange().getValues();
  var fotos = [];
  for (var i = 1; i < data.length; i++) {
    fotos.push(fotosRepository_fotoDesdeFila(data[i], hoja.indices));
  }
  return fotos;
}

function fotosRepository_listarPorEvaluacionId(evaluacionId) {
  return fotosRepository_leerTodas(fotosRepository_abrirHoja()).filter(function (f) { return f.evaluacionId === evaluacionId; });
}

function fotosRepository_listarPorWellId(wellId) {
  return fotosRepository_leerTodas(fotosRepository_abrirHoja()).filter(function (f) { return f.wellId === wellId; });
}

function fotosRepository_buscarPorFotoId(fotoId) {
  var todas = fotosRepository_leerTodas(fotosRepository_abrirHoja());
  for (var i = 0; i < todas.length; i++) {
    if (todas[i].fotoId === fotoId) {
      return todas[i];
    }
  }
  return null;
}

function fotosRepository_contarPorEvaluacionId(evaluacionId) {
  return fotosRepository_listarPorEvaluacionId(evaluacionId).length;
}

// Append de UNA fila bajo LockService, re-chequeando el cupo DENTRO del
// lock: dos subidas simultaneas de la misma evaluacion no pueden pasarse
// del maximo. Devuelve true si escribio, false si ya no habia cupo (el
// Service descarta entonces el archivo ya subido al storage).
function fotosRepository_agregarSiHayCupo(foto, maximoPorEvaluacion) {
  var hoja = fotosRepository_abrirHoja();
  var lock = LockService.getScriptLock();
  lock.waitLock(FOTOS_LOCK_TIMEOUT_MS);
  try {
    var existentes = fotosRepository_leerTodas(hoja).filter(function (f) { return f.evaluacionId === foto.evaluacionId; });
    if (existentes.length >= maximoPorEvaluacion) {
      return false;
    }
    var fila = fotosRepository_filaDesdeFoto(foto, hoja.indices, hoja.ancho);
    var numeroFila = hoja.sheet.getLastRow() + 1;
    var rango = hoja.sheet.getRange(numeroFila, 1, 1, hoja.ancho);
    var formatos = [];
    for (var c = 0; c < hoja.ancho; c++) {
      if (c === hoja.indices.timestamp) {
        formatos.push('yyyy-mm-dd hh:mm:ss');
      } else if (c === hoja.indices.tamanoBytes) {
        formatos.push('0');
      } else {
        formatos.push('@');
      }
    }
    rango.setNumberFormats([formatos]);
    rango.setValues([fila]);
    SpreadsheetApp.flush();
    return true;
  } finally {
    lock.releaseLock();
  }
}

// Correr manualmente desde el editor de Apps Script. IDEMPOTENTE: si la
// hoja ya existe y tiene el encabezado exacto, no hace nada; si existe con
// otro encabezado, NO la toca y avisa (nunca pisa datos).
function setupFotosReemplazoSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(FOTOS_HOJA);
  if (existente) {
    var lastCol = existente.getLastColumn();
    var header = lastCol > 0 ? existente.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var faltantes = fotosRepository_columnasFaltantes(fotosRepository_indiceColumnas(header));
    if (faltantes.length === 0) {
      Logger.log('La hoja ' + FOTOS_HOJA + ' ya existe con su encabezado, no se modifico.');
    } else {
      Logger.log('La hoja ' + FOTOS_HOJA + ' existe pero le faltan columnas (' + faltantes.join(', ') + '). No se modifico: revisarla a mano.');
    }
    return;
  }
  var sheet = spreadsheet.insertSheet(FOTOS_HOJA);
  sheet.getRange(1, 1, 1, FOTOS_COLUMNAS.length).setValues([FOTOS_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + FOTOS_HOJA + ' creada.');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_COLUMNAS,
    fotosRepository_indiceColumnas,
    fotosRepository_columnasFaltantes,
    fotosRepository_filaDesdeFoto,
    fotosRepository_fotoDesdeFila
  };
}
