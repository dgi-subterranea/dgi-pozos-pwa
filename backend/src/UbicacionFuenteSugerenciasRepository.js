// Unica funcion/archivo que sabe que existe la hoja "UbicacionFuenteSugerencias" en Sheets (mismo spreadsheet que Usuarios/Historial/UbicacionCorrecciones/UbicacionFuenteDecisiones).
//
// SUGERENCIAS de usuarios SIN autoridad para decidir sobre las fuentes registrales de un pozo (aceptar / descartar / restaurar), APPEND-ONLY: una fila = un EVENTO
// inmutable; nunca se edita ni se borra una fila desde la app. Una sugerencia NO es una decision: no cambia el estado de ninguna fuente, ni el punto operativo, ni los mapas.
// Solo la APROBACION de un validador produce una decision real, y la produce en OTRA hoja (UbicacionFuenteDecisiones) con la misma logica de dominio que decidirFuenteUbicacion.
// El estado de cada sugerencia se DERIVA de sus eventos (UbicacionFuenteSugerenciasService.js): no hay columnas mutables (estado actual, resuelta por, resuelta en).
//
// Esquema (14 columnas; las minimas necesarias para auditar y derivar):
//   sugerenciaId | secuencia | evento | wellId | fuenteTipo | x | y | accionSugerida | motivo | email | nombre | timestampUtc | clientRequestId | versionVista
//   - sugerenciaId      UUID v4 de la SUGERENCIA (lo genera el servidor en la PROPUESTA; los eventos de resolucion lo repiten).
//   - secuencia         entero GLOBAL y monotono (max + 1 bajo lock). Es el UNICO orden: la fecha no se usa jamas para ordenar.
//   - evento            PROPUESTA | APROBADA | RECHAZADA | CANCELADA | OBSOLETA.
//   - wellId, fuenteTipo, x, y   la IDENTIDAD canonica de la fuente, la MISMA de UbicacionFuenteDecisiones (wellId + tipo + x + y a 3 decimales). Los eventos de resolucion
//                       la repiten (copiada de la PROPUESTA) para que cada fila se entienda sola; si no coincide con la PROPUESTA la sugerencia se marca inconsistente.
//   - accionSugerida    ACEPTAR | DESCARTAR | RESTAURAR (QUITAR_ACEPTACION no se puede sugerir).
//   - motivo            PROPUESTA: razon de quien sugiere (obligatoria al DESCARTAR). RECHAZADA: razon del rechazo (obligatoria). APROBADA / CANCELADA / OBSOLETA: opcional.
//   - email, nombre     de la SESION de quien genera ESE evento (el proponente en la PROPUESTA, el validador en APROBADA/RECHAZADA, el autor en CANCELADA). email normalizado.
//   - timestampUtc      ISO 8601 UTC con milisegundos y Z, guardado como TEXTO.
//   - clientRequestId   idempotencia, unico por usuario (compartido por todos los eventos que ese usuario genera).
//   - versionVista      la version del pozo (secuencia maxima de sus decisiones) que tenia quien genero el evento. En la PROPUESTA es informativa: al aprobar NO se confia en ella.
//   Lo que NO se guarda a proposito (se deriva o ya existe en otra hoja): el estado actual, quien/cuando resolvio (es el evento mismo), padronPeriodo, lat/lon, la clave,
//   la etiqueta de la fuente y el id de la decision generada: la decision que crea una aprobacion lleva clientRequestId = 'sug-' + sugerenciaId, asi que el vinculo se
//   deduce sin una columna mas (si hiciera falta un dia, se AGREGAN columnas al final: el esquema tolera columnas extra).
//
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase insensible). Si falta o se repite CUALQUIERA de las 14 se lanza error (fail-closed: nunca se escribe en una
// hoja con un esquema que no se reconoce). Texto plano ('@') salvo las numericas: un motivo que empiece con "=" nunca se evalua como formula.
//
// Concurrencia: las funciones de escritura NO toman el lock; el Service las llama dentro de ubicacionFuenteDecisionesRepository_conLock (el MISMO lock de script que las
// decisiones y las correcciones): asi aprobar (leer -> decidir -> escribir la decision -> escribir el evento) es una sola seccion critica.
var UBICACION_FUENTE_SUGERENCIAS_HOJA = 'UbicacionFuenteSugerencias';
var UBICACION_FUENTE_SUGERENCIAS_COLUMNAS = [
  'sugerenciaId', 'secuencia', 'evento', 'wellId', 'fuenteTipo', 'x', 'y', 'accionSugerida', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista'
];
// columna -> formato de numero con que se escribe (el resto va como texto plano)
var UBICACION_FUENTE_SUGERENCIAS_FORMATOS_NUMERICOS = { secuencia: '0', x: '0.000', y: '0.000', versionVista: '0' };

// --- Logica pura (testeable sin SpreadsheetApp) ---

function ubicacionFuenteSugerenciasRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes:[...], repetidas:[...]}. Una columna repetida tambien es un esquema inesperado (no se sabria cual escribir).
function ubicacionFuenteSugerenciasRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = ubicacionFuenteSugerenciasRepository_indiceColumnas(header);
  var faltantes = UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function ubicacionFuenteSugerenciasRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function ubicacionFuenteSugerenciasRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Numero de una celda; vacio o no numerico -> null (el Service lo marca como corrupto, no se corrige en silencio).
function ubicacionFuenteSugerenciasRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (ubicacionFuenteSugerenciasRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

// El timestamp se guarda como texto ISO UTC. Si alguien reformateo la columna y Sheets lo convirtio en fecha, se lee igual (ISO) para no perder el dato.
function ubicacionFuenteSugerenciasRepository_timestamp(row, indices) {
  var v = row[indices.timestampUtc];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Fila -> evento "crudo" (sin interpretar). La validez de contenido es del Service (ufs_problemaDeEvento), no de aca. 
function ubicacionFuenteSugerenciasRepository_eventoDesdeFila(row, indices) {
  function t(n) { return ubicacionFuenteSugerenciasRepository_texto(row, indices, n); }
  function num(n) { return ubicacionFuenteSugerenciasRepository_numero(row, indices, n); }
  return {
    sugerenciaId: t('sugerenciaId'),
    secuencia: num('secuencia'),
    evento: t('evento'),
    wellId: t('wellId'),
    fuenteTipo: t('fuenteTipo'),
    x: num('x'),
    y: num('y'),
    accionSugerida: t('accionSugerida'),
    motivo: t('motivo'),
    email: t('email'),
    nombre: t('nombre'),
    timestampUtc: ubicacionFuenteSugerenciasRepository_timestamp(row, indices),
    clientRequestId: t('clientRequestId'),
    versionVista: num('versionVista')
  };
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function ubicacionFuenteSugerenciasRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = ubicacionFuenteSugerenciasRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

function ubicacionFuenteSugerenciasRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.forEach(function (nombre) {
    if (UBICACION_FUENTE_SUGERENCIAS_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = UBICACION_FUENTE_SUGERENCIAS_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// --- Acceso a Sheets ---

function ubicacionFuenteSugerenciasRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(UBICACION_FUENTE_SUGERENCIAS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + UBICACION_FUENTE_SUGERENCIAS_HOJA + '" en el spreadsheet configurado (correr setupUbicacionFuenteSugerenciasSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + UBICACION_FUENTE_SUGERENCIAS_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = ubicacionFuenteSugerenciasRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + UBICACION_FUENTE_SUGERENCIAS_HOJA + '" no tiene el esquema esperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: ubicacionFuenteSugerenciasRepository_indiceColumnas(header), ancho: header.length };
}

// Todos los eventos, en el orden de la hoja (que NO es el orden de aplicacion: el orden lo da `secuencia`). Una fila totalmente vacia se salta; una fila a medias NO
// (el Service la marca como corrupta: nada se descarta en silencio).
function ubicacionFuenteSugerenciasRepository_listar() {
  var hoja = ubicacionFuenteSugerenciasRepository_hoja();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var vacia = data[i].every(function (v) { return ubicacionFuenteSugerenciasRepository_esVacio(v) || String(v).trim() === ''; });
    if (!vacia) {
      resultado.push(ubicacionFuenteSugerenciasRepository_eventoDesdeFila(data[i], hoja.indices));
    }
  }
  return resultado;
}

// Agrega UNA fila al final. Llamar SOLO dentro de ubicacionFuenteDecisionesRepository_conLock.
function ubicacionFuenteSugerenciasRepository_agregar(evento) {
  var hoja = ubicacionFuenteSugerenciasRepository_hoja();
  var fila = ubicacionFuenteSugerenciasRepository_filaDesdeObjeto(evento, hoja.indices, hoja.ancho);
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, 1, hoja.ancho);
  rango.setNumberFormats([ubicacionFuenteSugerenciasRepository_formatosDeFila(hoja.indices, hoja.ancho)]);
  rango.setValues([fila]);
  SpreadsheetApp.flush();
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > setupUbicacionFuenteSugerenciasSheet). IDEMPOTENTE: crea la hoja con su encabezado si no existe;
// si ya existe SOLO la valida (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No se ejecuta sola en ningun lado.
// Devuelve 'CREADA' o 'YA_EXISTE'.
function setupUbicacionFuenteSugerenciasSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(UBICACION_FUENTE_SUGERENCIAS_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + UBICACION_FUENTE_SUGERENCIAS_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = ubicacionFuenteSugerenciasRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + UBICACION_FUENTE_SUGERENCIAS_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + UBICACION_FUENTE_SUGERENCIAS_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(UBICACION_FUENTE_SUGERENCIAS_HOJA);
  sheet.getRange(1, 1, 1, UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.length).setValues([UBICACION_FUENTE_SUGERENCIAS_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + UBICACION_FUENTE_SUGERENCIAS_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_FUENTE_SUGERENCIAS_HOJA,
    UBICACION_FUENTE_SUGERENCIAS_COLUMNAS,
    UBICACION_FUENTE_SUGERENCIAS_FORMATOS_NUMERICOS,
    ubicacionFuenteSugerenciasRepository_indiceColumnas,
    ubicacionFuenteSugerenciasRepository_planEsquema,
    ubicacionFuenteSugerenciasRepository_esVacio,
    ubicacionFuenteSugerenciasRepository_eventoDesdeFila,
    ubicacionFuenteSugerenciasRepository_filaDesdeObjeto,
    ubicacionFuenteSugerenciasRepository_formatosDeFila,
    ubicacionFuenteSugerenciasRepository_hoja,
    ubicacionFuenteSugerenciasRepository_listar,
    ubicacionFuenteSugerenciasRepository_agregar,
    setupUbicacionFuenteSugerenciasSheet
  };
}
