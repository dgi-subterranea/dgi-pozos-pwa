// Unica funcion/archivo que sabe que existe la hoja "UbicacionFuenteDecisiones" en Sheets (mismo spreadsheet que Usuarios/Historial/UbicacionCorrecciones).
//
// Decisiones sobre las FUENTES REGISTRALES de ubicacion de un pozo (aceptar / descartar / quitar la aceptacion / restaurar), APPEND-ONLY: una fila = un evento
// inmutable; nunca se edita ni se borra una fila desde la app y el padron original (Drive) jamas se escribe. El estado vigente se DERIVA de los eventos
// (UbicacionFuenteDecisionesLogic.js, copia exacta del dominio del frontend). NO es una correccion de campo: no comparte hojas ni estados con UbicacionCorrecciones.
//
// Esquema (14 columnas; las minimas necesarias para auditar y derivar):
//   decisionId | secuencia | wellId | fuenteTipo | x | y | evento | motivo | email | nombre | timestampUtc | clientRequestId | versionVista | padronPeriodo
//   - decisionId        UUID v4 del evento (lo genera el servidor).
//   - secuencia         entero GLOBAL y monotono (max + 1, asignado bajo lock). Es el UNICO orden: la fecha no se usa jamas para ordenar.
//   - wellId, fuenteTipo, x, y   la IDENTIDAD de la fuente (wellId + tipo + x + y a 3 decimales) y, a la vez, el snapshot de su coordenada original.
//                       No se guarda lat/lon (derivable de x/y), ni la clave (derivable), ni la etiqueta «Irrigacion (2)» (posicional, no es identidad).
//   - evento            ACEPTADA | DESCARTADA | ACEPTACION_QUITADA | RESTAURADA.
//   - motivo            texto plano (obligatorio al descartar).
//   - email, nombre     de la SESION (nunca del cliente). email normalizado: sirve para la idempotencia por usuario; nombre es la foto del nombre al decidir.
//   - timestampUtc      ISO 8601 UTC con milisegundos y Z, guardado como TEXTO (p. ej. 2026-10-14T14:32:10.123Z): no depende del formato regional de Sheets.
//   - clientRequestId   idempotencia, unico por usuario.
//   - versionVista      la version del pozo (secuencia maxima) que el cliente tenia al decidir: auditoria + comparacion de reintentos idempotentes.
//   - padronPeriodo     periodo del padron con el que se decidio (contexto para entender una decision que luego queda obsoleta por un reindexado).
//   Lo que NO se guarda a proposito: el punto operativo resultante (se re-deriva reproduciendo hasta esa secuencia), SUPERADA / REEVALUADA / causaDecisionId (el
//   reemplazo de la aceptada anterior se deduce del orden), lat/lon, etiquetas.
//
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase insensible): reordenarlas a mano no rompe nada. Si falta CUALQUIERA de las 14 se lanza
// error (fail-closed: nunca se escribe en una hoja con un esquema que no se reconoce). Las columnas de texto se escriben como TEXTO PLANO ('@'): un motivo que
// empiece con "=" o "+" nunca se evalua como formula. Las numericas, con formato fijo.
//
// Concurrencia: las funciones de escritura de este archivo NO toman el lock; el Service las llama dentro de ubicacionFuenteDecisionesRepository_conLock (que
// serializa leer -> decidir -> escribir). Es el mismo lock de script que usan las correcciones.
var UBICACION_FUENTE_DECISIONES_HOJA = 'UbicacionFuenteDecisiones';
var UBICACION_FUENTE_DECISIONES_COLUMNAS = [
  'decisionId', 'secuencia', 'wellId', 'fuenteTipo', 'x', 'y', 'evento', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista', 'padronPeriodo'
];
// columna -> formato de numero con que se escribe (el resto va como texto plano)
var UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS = { secuencia: '0', x: '0.000', y: '0.000', versionVista: '0' };
var UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS = 10000;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function ubicacionFuenteDecisionesRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  UBICACION_FUENTE_DECISIONES_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes:[...], repetidas:[...]}. Una columna repetida tambien es un esquema inesperado (no se sabria cual escribir).
function ubicacionFuenteDecisionesRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = ubicacionFuenteDecisionesRepository_indiceColumnas(header);
  var faltantes = UBICACION_FUENTE_DECISIONES_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = UBICACION_FUENTE_DECISIONES_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function ubicacionFuenteDecisionesRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function ubicacionFuenteDecisionesRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Numero de una celda; vacio o no numerico -> null (el dominio lo marca como corrupto, no se corrige en silencio).
function ubicacionFuenteDecisionesRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (ubicacionFuenteDecisionesRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

// El timestamp se guarda como texto ISO UTC. Si alguien reformateo la columna y Sheets lo convirtio en fecha, se lee igual (ISO) para no perder el dato.
function ubicacionFuenteDecisionesRepository_timestamp(row, indices) {
  var v = row[indices.timestampUtc];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Fila -> evento "crudo" (sin interpretar). La validez de contenido es del dominio (ufd_problemaDeEvento), no de aca.
function ubicacionFuenteDecisionesRepository_decisionDesdeFila(row, indices) {
  function t(n) { return ubicacionFuenteDecisionesRepository_texto(row, indices, n); }
  function num(n) { return ubicacionFuenteDecisionesRepository_numero(row, indices, n); }
  return {
    decisionId: t('decisionId'),
    secuencia: num('secuencia'),
    wellId: t('wellId'),
    fuenteTipo: t('fuenteTipo'),
    x: num('x'),
    y: num('y'),
    evento: t('evento'),
    motivo: t('motivo'),
    email: t('email'),
    nombre: t('nombre'),
    timestampUtc: ubicacionFuenteDecisionesRepository_timestamp(row, indices),
    clientRequestId: t('clientRequestId'),
    versionVista: num('versionVista'),
    padronPeriodo: t('padronPeriodo')
  };
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function ubicacionFuenteDecisionesRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  UBICACION_FUENTE_DECISIONES_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = ubicacionFuenteDecisionesRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

function ubicacionFuenteDecisionesRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  UBICACION_FUENTE_DECISIONES_COLUMNAS.forEach(function (nombre) {
    if (UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// --- Acceso a Sheets ---

function ubicacionFuenteDecisionesRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(UBICACION_FUENTE_DECISIONES_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + UBICACION_FUENTE_DECISIONES_HOJA + '" en el spreadsheet configurado (correr setupUbicacionFuenteDecisionesSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + UBICACION_FUENTE_DECISIONES_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = ubicacionFuenteDecisionesRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + UBICACION_FUENTE_DECISIONES_HOJA + '" no tiene el esquema esperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: ubicacionFuenteDecisionesRepository_indiceColumnas(header), ancho: header.length };
}

// Todas las decisiones, en el orden de la hoja (que NO es el orden de aplicacion: el orden lo da `secuencia`). Lee la hoja completa: a la escala esperada
// (decenas o cientos de filas) es una lectura barata y evita un indice que podria quedar desfasado respecto de una escritura reciente. Una fila totalmente
// vacia se salta; una fila a medias NO (el dominio la marca como corrupta: nada se descarta en silencio).
function ubicacionFuenteDecisionesRepository_listar() {
  var hoja = ubicacionFuenteDecisionesRepository_hoja();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var vacia = data[i].every(function (v) { return ubicacionFuenteDecisionesRepository_esVacio(v) || String(v).trim() === ''; });
    if (!vacia) {
      resultado.push(ubicacionFuenteDecisionesRepository_decisionDesdeFila(data[i], hoja.indices));
    }
  }
  return resultado;
}

// Agrega UNA fila al final. Llamar SOLO dentro de ubicacionFuenteDecisionesRepository_conLock.
function ubicacionFuenteDecisionesRepository_agregar(decision) {
  var hoja = ubicacionFuenteDecisionesRepository_hoja();
  var fila = ubicacionFuenteDecisionesRepository_filaDesdeObjeto(decision, hoja.indices, hoja.ancho);
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, 1, hoja.ancho);
  rango.setNumberFormats([ubicacionFuenteDecisionesRepository_formatosDeFila(hoja.indices, hoja.ancho)]);
  rango.setValues([fila]);
  SpreadsheetApp.flush();
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera.
function ubicacionFuenteDecisionesRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > setupUbicacionFuenteDecisionesSheet). IDEMPOTENTE: crea la hoja con su encabezado si no existe;
// si ya existe SOLO la valida (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No se ejecuta sola en ningun lado.
// Devuelve 'CREADA' o 'YA_EXISTE'.
function setupUbicacionFuenteDecisionesSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(UBICACION_FUENTE_DECISIONES_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + UBICACION_FUENTE_DECISIONES_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = ubicacionFuenteDecisionesRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + UBICACION_FUENTE_DECISIONES_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + UBICACION_FUENTE_DECISIONES_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(UBICACION_FUENTE_DECISIONES_HOJA);
  sheet.getRange(1, 1, 1, UBICACION_FUENTE_DECISIONES_COLUMNAS.length).setValues([UBICACION_FUENTE_DECISIONES_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + UBICACION_FUENTE_DECISIONES_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_FUENTE_DECISIONES_HOJA,
    UBICACION_FUENTE_DECISIONES_COLUMNAS,
    UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS,
    UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS,
    ubicacionFuenteDecisionesRepository_indiceColumnas,
    ubicacionFuenteDecisionesRepository_planEsquema,
    ubicacionFuenteDecisionesRepository_decisionDesdeFila,
    ubicacionFuenteDecisionesRepository_filaDesdeObjeto,
    ubicacionFuenteDecisionesRepository_formatosDeFila,
    ubicacionFuenteDecisionesRepository_hoja,
    ubicacionFuenteDecisionesRepository_listar,
    ubicacionFuenteDecisionesRepository_agregar,
    ubicacionFuenteDecisionesRepository_conLock,
    setupUbicacionFuenteDecisionesSheet
  };
}
