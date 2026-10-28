// Unica funcion/archivo que sabe que existira la hoja "FotosPozoEventos" en Sheets (mismo spreadsheet que Usuarios/Historial/FotosPozos/ObservacionesPozo).
//
// E8-2: moderacion de las fotos de la galeria general (FotosPozos). APPEND-ONLY: una fila = un EVENTO inmutable; nunca se edita ni se borra una fila desde la app. No hay columna de
// estado: el estado de la foto (ACTIVA / RETIRADA) y el de cada solicitud (ABIERTA / APROBADA / RECHAZADA) se DERIVAN de los eventos (FotosPozosModeracionService.js), siempre ENCIMA del
// estado base que ya trae FotosPozos (columna `estado`: ACTIVA / OCULTA). Este archivo NO decide nada de eso: solo lee, escribe y arma la secuencia.
//
// ESTADO DE ESTA ETAPA: la hoja NO existe en produccion y NADA de este archivo se llama desde Api.js todavia (E8-3 cablea los endpoints). setupFotosPozoEventosSheet esta escrita pero NO se
// ejecuta hasta el rollout (E8-6). Una lectura nunca crea la hoja.
//
// Esquema (14 columnas, en este orden; el orden REAL de la hoja puede variar: se buscan por el texto del encabezado):
//   eventoId | secuencia | evento | fotoId | entidadTipo | entidadId | solicitudId | resolucion | motivoCodigo | motivoTexto | email | nombre | timestampUtc | clientRequestId
//   - Funcionales
//       eventoId        UUID v4 del EVENTO (lo genera el servidor). El eventoId de un RETIRO_SOLICITADO es, a la vez, el id de la SOLICITUD: una RETIRO_RESUELTO lo referencia en solicitudId.
//       secuencia       entero GLOBAL y monotono (max + 1, asignado bajo lock al escribir). Es el UNICO orden entre eventos: la fecha no se usa jamas para ordenar.
//       evento          RETIRO_SOLICITADO | RETIRADA | RETIRO_RESUELTO | REPUESTA (exacto, mayusculas; cualquier otro valor es un evento desconocido).
//       fotoId          UUID de la foto en FotosPozos (la autoridad para localizarla). En una RETIRO_RESUELTO es una copia de la de la solicitud: el servidor la copia, el cliente no la manda.
//       entidadTipo     WELL (la entidad es un wellId: pozo de Provincia o punto NE con numero de pozo) | MONITORING (punto NE especial sin wellId). Es la identidad canonica que ya usa Fotos:
//                       wellId si lo tiene, si no monitoringId.
//       entidadId       el wellId (DD-PPPP) o el monitoringId.
//       solicitudId     solo en RETIRO_RESUELTO: el eventoId de la RETIRO_SOLICITADO que resuelve. Vacio en los demas.
//       resolucion      solo en RETIRO_RESUELTO: APROBADO | RECHAZADO. Vacio en los demas.
//       motivoCodigo    solo en RETIRO_SOLICITADO y RETIRADA: codigo del catalogo (obligatorio). Vacio en RETIRO_RESUELTO y REPUESTA.
//       motivoTexto     solo en RETIRO_SOLICITADO y RETIRADA: texto normalizado de 3 a 300 caracteres (obligatorio si el codigo es OTRO; opcional en el resto).
//   - Auditoria (salen de la SESION; el cliente nunca los manda)
//       email, nombre   quien escribio el evento. email normalizado (minuscula): sirve para la idempotencia y NUNCA sale hacia el cliente; la autorizacion es por email / permisos, jamas por nombre.
//       timestampUtc    ISO 8601 UTC con milisegundos y Z, guardado como TEXTO.
//   - Internos
//       clientRequestId idempotencia de la escritura, unico por usuario (mismo patron que Observaciones y las correcciones).
//   Lo que NO se guarda a proposito: payloads, ids de Drive, URLs, imagen / base64, estado (derivado), coordenadas.
//
// Las columnas se buscan por el TEXTO del encabezado (trim / minuscula): reordenarlas a mano no rompe nada. Si falta CUALQUIERA de las 14 (o hay una repetida) se lanza error (fail-closed).
// Todas las columnas de texto se escriben como TEXTO PLANO ('@'): un motivo que empiece con "=" nunca se evalua. `secuencia` va con formato '0'.
//
// LECTURA: la hoja de eventos es chica (una fila por accion de moderacion, no por foto): se lee COMPLETA en UNA llamada (fotosPozoEventosRepository_leerTodos) y se agrupa en memoria. Esa
// es tambien la lectura de la futura cola de moderacion (sin N+1) y la que exige la derivacion, porque la integridad (eventoId / secuencia duplicados, resoluciones que apuntan a otra
// foto) es GLOBAL. Si algun dia la hoja creciera mucho, la lectura selectiva por foto (como Observaciones) se agrega SIN cambiar el contrato de este archivo.
//
// Concurrencia: las funciones de escritura NO toman el lock; el Service las llama dentro de fotosPozoEventosRepository_conLock (el mismo lock de script que el resto de las hojas), que
// serializa buscar-por-clientRequestId -> derivar -> secuencia -> escribir.
var FOTOS_POZO_EVENTOS_HOJA = 'FotosPozoEventos';
var FOTOS_POZO_EVENTOS_COLUMNAS = [
  'eventoId', 'secuencia', 'evento', 'fotoId', 'entidadTipo', 'entidadId', 'solicitudId', 'resolucion',
  'motivoCodigo', 'motivoTexto', 'email', 'nombre', 'timestampUtc', 'clientRequestId'
];
var FOTOS_POZO_EVENTOS_FORMATOS_NUMERICOS = { secuencia: '0' };
var FOTOS_POZO_EVENTOS_LOCK_TIMEOUT_MS = 10000;
var FOTOS_POZO_EVENTOS_MAX_COINCIDENCIAS = 2;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function fotosPozoEventosRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  FOTOS_POZO_EVENTOS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes, repetidas}. Una columna repetida tambien es un esquema inesperado (no se sabria cual leer).
function fotosPozoEventosRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = fotosPozoEventosRepository_indiceColumnas(header);
  var faltantes = FOTOS_POZO_EVENTOS_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = FOTOS_POZO_EVENTOS_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function fotosPozoEventosRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function fotosPozoEventosRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Numero de una celda; vacio o no numerico -> null (la derivacion lo marca como invalido, no se corrige en silencio).
function fotosPozoEventosRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (fotosPozoEventosRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

// El timestamp se guarda como texto ISO UTC. Si alguien reformateo la columna y Sheets lo convirtio en fecha, se lee igual (ISO).
function fotosPozoEventosRepository_timestamp(row, indices) {
  var v = row[indices.timestampUtc];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Fila -> evento "crudo" (sin interpretar). Los ids van en minuscula (eventoId, fotoId, solicitudId) y el email tambien; `evento`, `resolucion`, `motivoCodigo` y `entidadTipo` van TAL CUAL
// (sin pasar a mayuscula: un valor que no sea exacto es desconocido y lo decide la derivacion). `fila` es el numero de fila de la hoja (solo para diagnostico).
function fotosPozoEventosRepository_eventoDesdeFila(row, indices, numeroFila) {
  function t(n) { return fotosPozoEventosRepository_texto(row, indices, n); }
  return {
    fila: numeroFila,
    eventoId: t('eventoId').toLowerCase(),
    secuencia: fotosPozoEventosRepository_numero(row, indices, 'secuencia'),
    evento: t('evento'),
    fotoId: t('fotoId').toLowerCase(),
    entidadTipo: t('entidadTipo'),
    entidadId: t('entidadId'),
    solicitudId: t('solicitudId').toLowerCase(),
    resolucion: t('resolucion'),
    motivoCodigo: t('motivoCodigo'),
    motivoTexto: t('motivoTexto'),
    email: t('email').toLowerCase(),
    nombre: t('nombre'),
    timestampUtc: fotosPozoEventosRepository_timestamp(row, indices),
    clientRequestId: t('clientRequestId')
  };
}

function fotosPozoEventosRepository_filaVacia(row) {
  return (row || []).every(function (v) { return fotosPozoEventosRepository_esVacio(v) || String(v).trim() === ''; });
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function fotosPozoEventosRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  FOTOS_POZO_EVENTOS_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = fotosPozoEventosRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

// Formato de cada celda de la fila: TEXTO PLANO ('@') en todas (tambien en las columnas desconocidas) salvo `secuencia` ('0').
function fotosPozoEventosRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  FOTOS_POZO_EVENTOS_COLUMNAS.forEach(function (nombre) {
    if (FOTOS_POZO_EVENTOS_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = FOTOS_POZO_EVENTOS_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// Siguiente secuencia (max + 1) a partir de las columnas eventoId y secuencia (en el orden de la hoja). PURA. FALLA CERRADO: nada se "arregla" en silencio. Cada fila de datos tiene que ser
// TOTALMENTE vacia en esas dos columnas (se salta) o tener un eventoId Y una secuencia entera >= 1 (un numero, o un texto de solo digitos), y NINGUNA secuencia puede figurar en dos filas.
// Una secuencia vacia, de texto, cero, negativa, fraccionaria o repetida, o una secuencia sin eventoId (o al reves), hace imposible garantizar el invariante: {ok:false, motivo} (el motivo
// nombra solo numeros de fila y de secuencia, nunca contenido). Sin corrupcion: {ok:true, siguiente: max + 1}.
function fotosPozoEventosRepository_calcularSiguienteSecuencia(ids, secuencias) {
  var max = 0;
  var filaDe = {};
  var lista = secuencias || [];
  for (var i = 0; i < lista.length; i++) {
    var id = fotosPozoEventosRepository_esVacio((ids || [])[i]) ? '' : String(ids[i]).trim();
    var crudo = lista[i];
    var vacia = fotosPozoEventosRepository_esVacio(crudo) || String(crudo).trim() === '';
    if (id === '' && vacia) {
      continue;
    }
    if (vacia || id === '') {
      return { ok: false, motivo: 'la fila ' + (i + 2) + ' tiene ' + (vacia ? 'eventoId sin secuencia' : 'secuencia sin eventoId') };
    }
    var n = typeof crudo === 'number' ? crudo : (/^\d+$/.test(String(crudo).trim()) ? Number(String(crudo).trim()) : NaN);
    if (!isFinite(n) || Math.floor(n) !== n || n < 1) {
      return { ok: false, motivo: 'la secuencia de la fila ' + (i + 2) + ' no es un entero >= 1' };
    }
    if (filaDe[n] !== undefined) {
      return { ok: false, motivo: 'la secuencia ' + n + ' figura en mas de una fila (filas ' + filaDe[n] + ' y ' + (i + 2) + ')' };
    }
    filaDe[n] = i + 2;
    if (n > max) {
      max = n;
    }
  }
  if (max >= Number.MAX_SAFE_INTEGER - 1) {
    return { ok: false, motivo: 'la secuencia maxima no se puede incrementar de forma segura' };
  }
  return { ok: true, siguiente: max + 1 };
}

// --- Acceso a Sheets ---

// La hoja y su esquema. LANZA si la hoja no existe, esta vacia o tiene un esquema inesperado (fail-closed: nunca se crea ni se repara sola).
function fotosPozoEventosRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(FOTOS_POZO_EVENTOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + FOTOS_POZO_EVENTOS_HOJA + '" en el spreadsheet configurado (correr setupFotosPozoEventosSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + FOTOS_POZO_EVENTOS_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = fotosPozoEventosRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + FOTOS_POZO_EVENTOS_HOJA + '" tiene un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: fotosPozoEventosRepository_indiceColumnas(header), ancho: header.length };
}

// TODOS los eventos de la hoja, en el orden de las filas, en UNA lectura. {eventos}: cada uno "crudo" (ver eventoDesdeFila). Las filas totalmente vacias a mitad de hoja se saltan.
function fotosPozoEventosRepository_leerTodos() {
  var hoja = fotosPozoEventosRepository_hoja();
  var data = hoja.sheet.getDataRange().getValues();
  var eventos = [];
  for (var i = 1; i < data.length; i++) {
    if (fotosPozoEventosRepository_filaVacia(data[i])) {
      continue;
    }
    eventos.push(fotosPozoEventosRepository_eventoDesdeFila(data[i], hoja.indices, i + 1));
  }
  return { eventos: eventos };
}

// Los eventos que tocan a UNA foto: los que llevan su fotoId y tambien toda RETIRO_RESUELTO que referencie (por solicitudId) una solicitud de esa foto, aunque su propio fotoId este
// roto o sea de otra foto: la integridad de una foto depende de ellos. Una sola lectura de la hoja. fotoId en minuscula.
function fotosPozoEventosRepository_listarPorFoto(fotoId) {
  var todos = fotosPozoEventosRepository_leerTodos().eventos;
  var solicitudesDeLaFoto = {};
  todos.forEach(function (e) {
    if (e.fotoId === fotoId && e.evento === 'RETIRO_SOLICITADO' && e.eventoId !== '') {
      solicitudesDeLaFoto[e.eventoId] = true;
    }
  });
  return {
    eventos: todos.filter(function (e) {
      return e.fotoId === fotoId || (e.solicitudId !== '' && solicitudesDeLaFoto[e.solicitudId] === true);
    })
  };
}

// Solicitudes de retiro SIN ninguna RETIRO_RESUELTO que las referencie (candidatas a "abiertas"). Es una lectura CRUDA: la verdad (si la foto es derivable, si esta retirada) la decide la
// derivacion del Service. Una sola lectura de la hoja: es la base de la cola global de moderacion.
function fotosPozoEventosRepository_listarSolicitudesSinResolver() {
  var todos = fotosPozoEventosRepository_leerTodos().eventos;
  var resueltas = {};
  todos.forEach(function (e) {
    if (e.evento === 'RETIRO_RESUELTO' && e.solicitudId !== '') {
      resueltas[e.solicitudId] = true;
    }
  });
  return {
    eventos: todos.filter(function (e) { return e.evento === 'RETIRO_SOLICITADO' && resueltas[e.eventoId] !== true; })
  };
}

// Todos los valores de UNA columna de datos (sin el encabezado), en una sola lectura. [] si la hoja no tiene filas de datos.
function fotosPozoEventosRepository_leerColumna(hoja, nombre) {
  var n = hoja.sheet.getLastRow() - 1;
  if (n <= 0) {
    return [];
  }
  return hoja.sheet.getRange(2, hoja.indices[nombre] + 1, n, 1).getValues().map(function (f) { return f[0]; });
}

// Siguiente secuencia de la hoja. LANZA si no se puede calcular con seguridad (el que escribe no escribe nada). Llamar SOLO dentro de fotosPozoEventosRepository_conLock.
function fotosPozoEventosRepository_siguienteSecuencia(hoja) {
  var r = fotosPozoEventosRepository_calcularSiguienteSecuencia(
    fotosPozoEventosRepository_leerColumna(hoja, 'eventoId'), fotosPozoEventosRepository_leerColumna(hoja, 'secuencia'));
  if (!r.ok) {
    throw new Error('No se puede calcular la secuencia de forma segura en "' + FOTOS_POZO_EVENTOS_HOJA + '": ' + r.motivo + ' (no se escribio nada)');
  }
  return r.siguiente;
}

// Los eventos que ya usaron el clientRequestId de un usuario (en CUALQUIER evento: el id es por usuario, no por tipo de evento). Lee 2 columnas completas (email y clientRequestId) y despues
// SOLO las filas que coinciden. Devuelve {total, eventos}: `total` son todas las coincidencias y `eventos` las primeras 2 (con 2 ya se sabe que es una inconsistencia: la idempotencia exige UNA).
// emailNormalizado: minuscula y sin espacios. NO decide nada: la decision es del Service.
function fotosPozoEventosRepository_buscarPorClientRequestId(emailNormalizado, clientRequestId) {
  var hoja = fotosPozoEventosRepository_hoja();
  var emails = fotosPozoEventosRepository_leerColumna(hoja, 'email');
  if (emails.length === 0) {
    return { total: 0, eventos: [] };
  }
  var reqs = fotosPozoEventosRepository_leerColumna(hoja, 'clientRequestId');
  var filas = [];
  for (var i = 0; i < reqs.length; i++) {
    if (fotosPozoEventosRepository_esVacio(reqs[i]) || String(reqs[i]).trim() !== clientRequestId) {
      continue;
    }
    if (String(fotosPozoEventosRepository_esVacio(emails[i]) ? '' : emails[i]).trim().toLowerCase() === emailNormalizado) {
      filas.push(i + 2);
    }
  }
  var eventos = filas.slice(0, FOTOS_POZO_EVENTOS_MAX_COINCIDENCIAS).map(function (numero) {
    return fotosPozoEventosRepository_eventoDesdeFila(hoja.sheet.getRange(numero, 1, 1, hoja.ancho).getValues()[0], hoja.indices, numero);
  });
  return { total: filas.length, eventos: eventos };
}

// Escribe UN evento al final de la hoja: asigna la `secuencia` (max + 1, FALLA CERRADO) y lo escribe en una sola operacion, con formato de texto plano ANTES de los valores. Llamar SOLO
// dentro de fotosPozoEventosRepository_conLock. `evento` ya viene validado y armado por el Service (todos los campos menos `secuencia`, que fija este archivo). LANZA, sin escribir nada, si
// la hoja falta o esta mal o si la secuencia no se puede calcular. Devuelve el evento escrito (con su secuencia).
function fotosPozoEventosRepository_escribirEvento(evento) {
  var hoja = fotosPozoEventosRepository_hoja();
  var escrito = {};
  FOTOS_POZO_EVENTOS_COLUMNAS.forEach(function (nombre) { escrito[nombre] = evento[nombre]; });
  escrito.secuencia = fotosPozoEventosRepository_siguienteSecuencia(hoja);
  var fila = fotosPozoEventosRepository_filaDesdeObjeto(escrito, hoja.indices, hoja.ancho);
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, 1, hoja.ancho);
  rango.setNumberFormats([fotosPozoEventosRepository_formatosDeFila(hoja.indices, hoja.ancho)]);      // texto plano ANTES de los valores
  rango.setValues([fila]);
  SpreadsheetApp.flush();
  return escrito;
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera.
function fotosPozoEventosRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(FOTOS_POZO_EVENTOS_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script, y SOLO en el rollout (E8-6): NO se ejecuta en E8-2. IDEMPOTENTE: crea la hoja con su encabezado si no existe; si ya existe SOLO
// la valida (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No la llama ninguna lectura. Devuelve 'CREADA' o 'YA_EXISTE'.
function setupFotosPozoEventosSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(FOTOS_POZO_EVENTOS_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + FOTOS_POZO_EVENTOS_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = fotosPozoEventosRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + FOTOS_POZO_EVENTOS_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + FOTOS_POZO_EVENTOS_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(FOTOS_POZO_EVENTOS_HOJA);
  sheet.getRange(1, 1, 1, FOTOS_POZO_EVENTOS_COLUMNAS.length).setValues([FOTOS_POZO_EVENTOS_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + FOTOS_POZO_EVENTOS_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_POZO_EVENTOS_HOJA,
    FOTOS_POZO_EVENTOS_COLUMNAS,
    FOTOS_POZO_EVENTOS_FORMATOS_NUMERICOS,
    FOTOS_POZO_EVENTOS_LOCK_TIMEOUT_MS,
    FOTOS_POZO_EVENTOS_MAX_COINCIDENCIAS,
    fotosPozoEventosRepository_indiceColumnas,
    fotosPozoEventosRepository_planEsquema,
    fotosPozoEventosRepository_eventoDesdeFila,
    fotosPozoEventosRepository_filaVacia,
    fotosPozoEventosRepository_filaDesdeObjeto,
    fotosPozoEventosRepository_formatosDeFila,
    fotosPozoEventosRepository_calcularSiguienteSecuencia,
    fotosPozoEventosRepository_hoja,
    fotosPozoEventosRepository_leerTodos,
    fotosPozoEventosRepository_listarPorFoto,
    fotosPozoEventosRepository_listarSolicitudesSinResolver,
    fotosPozoEventosRepository_leerColumna,
    fotosPozoEventosRepository_siguienteSecuencia,
    fotosPozoEventosRepository_buscarPorClientRequestId,
    fotosPozoEventosRepository_escribirEvento,
    fotosPozoEventosRepository_conLock,
    setupFotosPozoEventosSheet
  };
}
