// Unica funcion/archivo que sabe que existen las hojas "UbicacionCorrecciones" y
// "UbicacionCorreccionesLog" en Sheets (mismo spreadsheet que Usuarios/Historial).
//
// Correcciones de ubicacion de pozos, APPEND-ONLY. Nunca se edita ni se borra una fila desde la app y el padron
// original (Drive) jamas se escribe: una correccion es solo una fila aqui, y su estado es DERIVADO del log.
//
// UbicacionCorrecciones (una fila por propuesta, inmutable):
//   correccionId | wellId | lat | lon | metodo | precisionGpsM | observacion | emailPropone | nombrePropone | timestamp |
//   irrLat | irrLon | irrEstado | irrFuente | padronPeriodo | distanciaM | advertenciaDistancia | clientRequestId
// UbicacionCorreccionesLog (una fila por evento, inmutable):
//   correccionId | timestamp | evento | email | nombre | motivo
//
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase insensible): reordenarlas a mano no rompe nada. Si falta
// alguna se lanza error (fail-closed: nunca se escribe en una hoja con un esquema que no se reconoce). Las columnas de texto se
// escriben como TEXTO PLANO ('@'): una observacion que empiece con "=" o "+" nunca se evalua como formula. Las numericas
// (coordenadas, precision, distancia) se escriben como numeros con formato fijo, sin depender de la configuracion regional.
//
// Concurrencia: las funciones de escritura de este archivo NO toman el lock; el Service las llama dentro de
// ubicacionCorreccionRepository_conLock (que serializa leer -> decidir -> escribir). LockService no es reentrante de forma
// confiable, por eso el lock vive en un solo lugar.
var UBICACION_CORRECCIONES_HOJA = 'UbicacionCorrecciones';
var UBICACION_CORRECCIONES_LOG_HOJA = 'UbicacionCorreccionesLog';
var UBICACION_CORRECCIONES_COLUMNAS = [
  'correccionId', 'wellId', 'lat', 'lon', 'metodo', 'precisionGpsM', 'observacion', 'emailPropone', 'nombrePropone', 'timestamp',
  'irrLat', 'irrLon', 'irrEstado', 'irrFuente', 'padronPeriodo', 'distanciaM', 'advertenciaDistancia', 'clientRequestId'
];
var UBICACION_CORRECCIONES_LOG_COLUMNAS = ['correccionId', 'timestamp', 'evento', 'email', 'nombre', 'motivo'];
// columna -> formato de numero con que se escribe (el resto va como texto, salvo timestamp)
var UBICACION_CORRECCIONES_FORMATOS_NUMERICOS = {
  lat: '0.000000', lon: '0.000000', irrLat: '0.000000', irrLon: '0.000000', precisionGpsM: '0.0', distanciaM: '0.0'
};
var UBICACION_CORRECCIONES_FORMATO_FECHA = 'yyyy-mm-dd hh:mm:ss';
var UBICACION_CORRECCIONES_LOCK_TIMEOUT_MS = 10000;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function ubicacionCorreccionRepository_indiceColumnas(headerRow, columnas) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  columnas.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

function ubicacionCorreccionRepository_columnasFaltantes(indices, columnas) {
  return columnas.filter(function (nombre) { return indices[nombre] < 0; });
}

function ubicacionCorreccionRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function ubicacionCorreccionRepository_filaDesdeObjeto(objeto, indices, anchoHeader, columnas) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  columnas.forEach(function (nombre) {
    var valor = objeto[nombre];
    if (nombre === 'advertenciaDistancia') {
      valor = valor === true || valor === 'SI' ? 'SI' : '';
    }
    fila[indices[nombre]] = ubicacionCorreccionRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

function ubicacionCorreccionRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function ubicacionCorreccionRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (ubicacionCorreccionRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

function ubicacionCorreccionRepository_fechaIso(row, indices) {
  var ts = row[indices.timestamp];
  var fecha = ts instanceof Date ? ts : new Date(ts);
  return isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

// Fila -> correccion "cruda" (timestamp ISO o null; numeros o null; advertenciaDistancia boolean). La validez de contenido
// es del Service, no de aca.
function ubicacionCorreccionRepository_correccionDesdeFila(row, indices) {
  function t(n) { return ubicacionCorreccionRepository_texto(row, indices, n); }
  function num(n) { return ubicacionCorreccionRepository_numero(row, indices, n); }
  return {
    correccionId: t('correccionId'),
    wellId: t('wellId'),
    lat: num('lat'),
    lon: num('lon'),
    metodo: t('metodo'),
    precisionGpsM: num('precisionGpsM'),
    observacion: t('observacion'),
    emailPropone: t('emailPropone'),
    nombrePropone: t('nombrePropone'),
    timestamp: ubicacionCorreccionRepository_fechaIso(row, indices),
    irrLat: num('irrLat'),
    irrLon: num('irrLon'),
    irrEstado: t('irrEstado'),
    irrFuente: t('irrFuente'),
    padronPeriodo: t('padronPeriodo'),
    distanciaM: num('distanciaM'),
    advertenciaDistancia: t('advertenciaDistancia').toUpperCase() === 'SI',
    clientRequestId: t('clientRequestId')
  };
}

function ubicacionCorreccionRepository_eventoDesdeFila(row, indices) {
  function t(n) { return ubicacionCorreccionRepository_texto(row, indices, n); }
  return {
    correccionId: t('correccionId'),
    timestamp: ubicacionCorreccionRepository_fechaIso(row, indices),
    evento: t('evento'),
    email: t('email'),
    nombre: t('nombre'),
    motivo: t('motivo')
  };
}

function ubicacionCorreccionRepository_formatosDeFila(indices, ancho, columnas) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  columnas.forEach(function (nombre) {
    if (nombre === 'timestamp') {
      formatos[indices[nombre]] = UBICACION_CORRECCIONES_FORMATO_FECHA;
    } else if (UBICACION_CORRECCIONES_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = UBICACION_CORRECCIONES_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// --- Acceso a Sheets ---

function ubicacionCorreccionRepository_abrirHoja(nombreHoja, columnas, nombreSetup) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(nombreHoja);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + nombreHoja + '" en el spreadsheet configurado (correr ' + nombreSetup + ')');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + nombreHoja + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = ubicacionCorreccionRepository_indiceColumnas(header, columnas);
  var faltantes = ubicacionCorreccionRepository_columnasFaltantes(indices, columnas);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + nombreHoja + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  return { sheet: sheet, indices: indices, ancho: header.length, columnas: columnas };
}

function ubicacionCorreccionRepository_hojaCorrecciones() {
  return ubicacionCorreccionRepository_abrirHoja(UBICACION_CORRECCIONES_HOJA, UBICACION_CORRECCIONES_COLUMNAS, 'setupUbicacionCorreccionesSheets');
}

function ubicacionCorreccionRepository_hojaLog() {
  return ubicacionCorreccionRepository_abrirHoja(UBICACION_CORRECCIONES_LOG_HOJA, UBICACION_CORRECCIONES_LOG_COLUMNAS, 'setupUbicacionCorreccionesSheets');
}

// Todas las correcciones, en el orden de la hoja. Lee la hoja completa: a la escala esperada (cientos o miles de filas)
// es una lectura barata, y evita un indice/cache que podria quedar desfasado respecto de una escritura reciente.
function ubicacionCorreccionRepository_listarCorrecciones() {
  var hoja = ubicacionCorreccionRepository_hojaCorrecciones();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var c = ubicacionCorreccionRepository_correccionDesdeFila(data[i], hoja.indices);
    if (c.correccionId) {
      resultado.push(c);
    }
  }
  return resultado;
}

// Todos los eventos, en el orden de la hoja (que es el orden en que ocurrieron: el estado vigente es el ULTIMO).
function ubicacionCorreccionRepository_listarEventos() {
  var hoja = ubicacionCorreccionRepository_hojaLog();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var e = ubicacionCorreccionRepository_eventoDesdeFila(data[i], hoja.indices);
    if (e.correccionId) {
      resultado.push(e);
    }
  }
  return resultado;
}

// Escribe 1..n filas CONTIGUAS con un solo setValues (si algo falla a mitad, no queda la mitad de un grupo de eventos).
function ubicacionCorreccionRepository_agregarFilas(hoja, objetos) {
  if (!objetos.length) {
    return;
  }
  var filas = objetos.map(function (o) {
    return ubicacionCorreccionRepository_filaDesdeObjeto(o, hoja.indices, hoja.ancho, hoja.columnas);
  });
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, filas.length, hoja.ancho);
  var formato = ubicacionCorreccionRepository_formatosDeFila(hoja.indices, hoja.ancho, hoja.columnas);
  rango.setNumberFormats(filas.map(function () { return formato; }));
  rango.setValues(filas);
  SpreadsheetApp.flush();
}

// Llamar SOLO dentro de ubicacionCorreccionRepository_conLock.
function ubicacionCorreccionRepository_agregarCorreccion(correccion) {
  ubicacionCorreccionRepository_agregarFilas(ubicacionCorreccionRepository_hojaCorrecciones(), [correccion]);
}

// Llamar SOLO dentro de ubicacionCorreccionRepository_conLock.
function ubicacionCorreccionRepository_agregarEventos(eventos) {
  ubicacionCorreccionRepository_agregarFilas(ubicacionCorreccionRepository_hojaLog(), eventos);
}

// Creacion de una correccion: la fila y su evento inicial PROPUESTA, en DOS hojas. NO es atomico (Sheets no tiene transacciones entre
// hojas) y no finge serlo. Lo que si hace para achicar la ventana: abre y verifica AMBAS hojas (existencia, encabezado, columnas) antes
// de escribir la primera, de modo que el motivo mas probable de un corte (una hoja inexistente o con el esquema roto) falla sin
// haber escrito nada. Si igual se corta entre las dos escrituras, la correccion queda sin eventos y el reintento con el mismo
// clientRequestId agrega el PROPUESTA faltante (ver UbicacionCorreccionService.js). Llamar SOLO dentro de conLock.
function ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion, evento) {
  var hojaCorrecciones = ubicacionCorreccionRepository_hojaCorrecciones();
  var hojaLog = ubicacionCorreccionRepository_hojaLog();
  ubicacionCorreccionRepository_agregarFilas(hojaCorrecciones, [correccion]);
  ubicacionCorreccionRepository_agregarFilas(hojaLog, [evento]);
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera.
function ubicacionCorreccionRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(UBICACION_CORRECCIONES_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > setupUbicacionCorreccionesSheets) para crear las dos
// hojas con su encabezado exacto. No toca una hoja que ya existe y NO modifica la hoja Usuarios (las columnas de permisos
// ubicacion_corregir y ubicacion_validar se agregan a mano ahi).
function setupUbicacionCorreccionesSheets() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  [[UBICACION_CORRECCIONES_HOJA, UBICACION_CORRECCIONES_COLUMNAS], [UBICACION_CORRECCIONES_LOG_HOJA, UBICACION_CORRECCIONES_LOG_COLUMNAS]].forEach(function (par) {
    if (spreadsheet.getSheetByName(par[0])) {
      Logger.log('La hoja ' + par[0] + ' ya existe, no se modifico.');
      return;
    }
    var sheet = spreadsheet.insertSheet(par[0]);
    sheet.getRange(1, 1, 1, par[1].length).setValues([par[1]]);
    sheet.setFrozenRows(1);
    Logger.log('Hoja ' + par[0] + ' creada.');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_CORRECCIONES_HOJA,
    UBICACION_CORRECCIONES_LOG_HOJA,
    UBICACION_CORRECCIONES_COLUMNAS,
    UBICACION_CORRECCIONES_LOG_COLUMNAS,
    ubicacionCorreccionRepository_indiceColumnas,
    ubicacionCorreccionRepository_columnasFaltantes,
    ubicacionCorreccionRepository_filaDesdeObjeto,
    ubicacionCorreccionRepository_correccionDesdeFila,
    ubicacionCorreccionRepository_eventoDesdeFila,
    ubicacionCorreccionRepository_listarCorrecciones,
    ubicacionCorreccionRepository_listarEventos,
    ubicacionCorreccionRepository_agregarCorreccion,
    ubicacionCorreccionRepository_agregarEventos,
    ubicacionCorreccionRepository_agregarCorreccionConEvento,
    ubicacionCorreccionRepository_conLock,
    setupUbicacionCorreccionesSheets
  };
}
