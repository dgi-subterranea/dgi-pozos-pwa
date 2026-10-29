// Unica funcion/archivo que sabe que existira la hoja "ItfEventos" en Sheets (mismo spreadsheet que Usuarios/Historial/FotosPozos/FotosPozoEventos).
//
// E9-2: ITF colaborativos (propuesta -> validacion -> vigente). APPEND-ONLY: una fila = un EVENTO inmutable; nunca se edita ni se borra una fila desde la app. No hay columna de estado: el estado de
// cada documento y del pozo se DERIVA de los eventos (ItfDominioService.js). Este archivo NO decide nada de eso: solo lee, escribe y arma la secuencia.
//
// ESTADO DE ESTA ETAPA: la hoja NO existe en produccion y NADA de este archivo se llama desde Api.js. setupItfEventosSheet esta escrita y probada pero NO se ejecuta hasta el rollout (E9-8).
// Una lectura nunca crea la hoja.
//
// Esquema (17 columnas, en este orden; el orden REAL de la hoja puede variar: se buscan por el texto del encabezado):
//   eventoId | secuencia | evento | documentoId | wellId | documentoReemplazadoId | mimeType | bytes | sha256 | storageFileId | nombreOriginal | motivoCodigo | motivoTexto | email | nombre | timestampUtc | clientRequestId
//   - Funcionales
//       eventoId               UUID v4 del EVENTO (lo genera el servidor).
//       secuencia              entero GLOBAL y monotono (max + 1, asignado bajo lock al escribir). Es el UNICO orden entre eventos: la fecha no se usa jamas para ordenar.
//       evento                 ITF_PROPUESTO | ITF_APROBADO | ITF_RECHAZADO | ITF_RETIRADO | ITF_REVERTIDO | ITF_LEGACY_REGISTRADO (exacto; cualquier otro valor es un evento desconocido).
//       documentoId            UUID v4 OPACO del documento (lo genera el servidor al proponer; estable toda la historia) o LEGACY:<wellId> (identificador logico del ITF legacy). Jamas un id de Drive, un hash o un nombre.
//       wellId                 DD-PPPP. Va en TODOS los eventos (el servidor lo copia de la propuesta); la derivacion exige que coincida con el pozo del documento.
//       documentoReemplazadoId solo en ITF_APROBADO (si reemplaza al vigente) e ITF_REVERTIDO (si desplaza al vigente): el documento que deja de ser vigente. Vacio en el resto.
//       mimeType, bytes, sha256, storageFileId, nombreOriginal
//                              la METADATA inmutable del documento: SOLO en ITF_PROPUESTO (y en ITF_LEGACY_REGISTRADO, que es la huella del archivo legacy). Vacios en cualquier otro evento:
//                              un evento posterior jamas puede cambiarla. storageFileId es del backend: NUNCA sale hacia el cliente.
//       motivoCodigo/Texto     catalogos del dominio (rechazo / reemplazo / retiro y reversion). Vacios en propuesta, registro del legacy y primera aprobacion.
//   - Auditoria (salen de la SESION; el cliente nunca los manda)
//       email, nombre          quien escribio el evento. email normalizado (minuscula): sirve para la idempotencia y para marcar la autoaprobacion, y NUNCA sale hacia el cliente.
//       timestampUtc           ISO 8601 UTC con milisegundos y Z, guardado como TEXTO.
//   - Internos
//       clientRequestId        idempotencia de la escritura, unico por usuario (mismo patron que Observaciones y Fotos). Vacio en ITF_LEGACY_REGISTRADO.
//   Lo que NO se guarda a proposito: base64 / imagen, URLs, estado (derivado), contenido del archivo.
//
// Las columnas se buscan por el TEXTO del encabezado (trim / minuscula): reordenarlas a mano no rompe nada. Si falta CUALQUIERA de las 17 (o hay una repetida) se lanza error (fail-closed).
// Todas las columnas de texto se escriben como TEXTO PLANO ('@'): un nombre de archivo o un motivo que empiece con "=" nunca se evalua. `secuencia` y `bytes` van con formato '0'.
//
// LECTURA: la hoja es chica (una fila por accion institucional, no por pozo): se lee COMPLETA en UNA llamada (itfEventosRepository_leerTodos) y se agrupa en memoria. Es tambien la lectura que
// exige la derivacion, porque la integridad (eventoId / secuencia duplicados, documentos que apuntan a otro pozo) es GLOBAL. Las lecturas por pozo / por documento / pendientes son
// filtros CRUDOS sobre esa lectura: para el ESTADO hay que derivar sobre todos los eventos.
//
// Concurrencia: las funciones de escritura NO toman el lock; el Service las llama dentro de itfEventosRepository_conLock (el mismo lock de script que el resto de las hojas), que
// serializa buscar-por-clientRequestId -> derivar -> secuencia -> escribir. Un evento que necesita el registro previo del legacy se escribe JUNTO con el: una sola operacion.
var ITF_EVENTOS_HOJA = 'ItfEventos';
var ITF_EVENTOS_COLUMNAS = [
  'eventoId', 'secuencia', 'evento', 'documentoId', 'wellId', 'documentoReemplazadoId', 'mimeType', 'bytes', 'sha256', 'storageFileId', 'nombreOriginal',
  'motivoCodigo', 'motivoTexto', 'email', 'nombre', 'timestampUtc', 'clientRequestId'
];
var ITF_EVENTOS_FORMATOS_NUMERICOS = { secuencia: '0', bytes: '0' };
var ITF_EVENTOS_LOCK_TIMEOUT_MS = 10000;
var ITF_EVENTOS_MAX_COINCIDENCIAS = 2;
var ITF_EVENTOS_UUID_REGEX_I = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function itfEventosRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  ITF_EVENTOS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes, repetidas}. Una columna repetida tambien es un esquema inesperado (no se sabria cual leer).
function itfEventosRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = itfEventosRepository_indiceColumnas(header);
  var faltantes = ITF_EVENTOS_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = ITF_EVENTOS_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function itfEventosRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function itfEventosRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Numero de una celda; vacio o no numerico -> null (la derivacion lo marca como invalido, no se corrige en silencio).
function itfEventosRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (itfEventosRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

// `bytes`: vacio -> '' ; numero o texto de solo digitos -> numero ; cualquier otra cosa se deja TAL CUAL (texto) para que la derivacion la rechace: un valor roto jamas se vuelve "vacio".
function itfEventosRepository_bytes(row, indices) {
  var v = row[indices.bytes];
  if (itfEventosRepository_esVacio(v) || String(v).trim() === '') {
    return '';
  }
  if (typeof v === 'number') {
    return v;
  }
  var t = String(v).trim();
  return /^\d+$/.test(t) ? Number(t) : t;
}

// El timestamp se guarda como texto ISO UTC. Si alguien reformateo la columna y Sheets lo convirtio en fecha, se lee igual (ISO).
function itfEventosRepository_timestamp(row, indices) {
  var v = row[indices.timestampUtc];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Id de documento: un UUID va en minuscula; LEGACY:<wellId> y todo lo demas, TAL CUAL (un valor raro lo rechaza la derivacion).
function itfEventosRepository_idDocumento(row, indices, nombre) {
  var t = itfEventosRepository_texto(row, indices, nombre);
  return ITF_EVENTOS_UUID_REGEX_I.test(t) ? t.toLowerCase() : t;
}

// Fila -> evento "crudo" (sin interpretar). eventoId y los ids de documento van en minuscula si son UUID, el email tambien; `evento`, `motivoCodigo`, `sha256` y `mimeType` van TAL CUAL (un valor
// que no sea exacto es desconocido o invalido y lo decide la derivacion). `fila` es el numero de fila de la hoja (solo para diagnostico).
function itfEventosRepository_eventoDesdeFila(row, indices, numeroFila) {
  function t(n) { return itfEventosRepository_texto(row, indices, n); }
  return {
    fila: numeroFila,
    eventoId: t('eventoId').toLowerCase(),
    secuencia: itfEventosRepository_numero(row, indices, 'secuencia'),
    evento: t('evento'),
    documentoId: itfEventosRepository_idDocumento(row, indices, 'documentoId'),
    wellId: t('wellId'),
    documentoReemplazadoId: itfEventosRepository_idDocumento(row, indices, 'documentoReemplazadoId'),
    mimeType: t('mimeType'),
    bytes: itfEventosRepository_bytes(row, indices),
    sha256: t('sha256'),
    storageFileId: t('storageFileId'),
    nombreOriginal: t('nombreOriginal'),
    motivoCodigo: t('motivoCodigo'),
    motivoTexto: t('motivoTexto'),
    email: t('email').toLowerCase(),
    nombre: t('nombre'),
    timestampUtc: itfEventosRepository_timestamp(row, indices),
    clientRequestId: t('clientRequestId')
  };
}

function itfEventosRepository_filaVacia(row) {
  return (row || []).every(function (v) { return itfEventosRepository_esVacio(v) || String(v).trim() === ''; });
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function itfEventosRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  ITF_EVENTOS_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = itfEventosRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

// Formato de cada celda de la fila: TEXTO PLANO ('@') en todas (tambien en las columnas desconocidas) salvo `secuencia` y `bytes` ('0').
function itfEventosRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  ITF_EVENTOS_COLUMNAS.forEach(function (nombre) {
    if (ITF_EVENTOS_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = ITF_EVENTOS_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// Siguiente secuencia (max + 1) a partir de las columnas eventoId y secuencia (en el orden de la hoja). PURA. FALLA CERRADO: nada se "arregla" en silencio. Cada fila de datos tiene que ser
// TOTALMENTE vacia en esas dos columnas (se salta) o tener un eventoId Y una secuencia entera >= 1 (un numero, o un texto de solo digitos), y NINGUNA secuencia puede figurar en dos filas.
// Una secuencia vacia, de texto, cero, negativa, fraccionaria o repetida, o una secuencia sin eventoId (o al reves), hace imposible garantizar el invariante: {ok:false, motivo} (el motivo
// nombra solo numeros de fila y de secuencia, nunca contenido). Sin corrupcion: {ok:true, siguiente: max + 1}.
function itfEventosRepository_calcularSiguienteSecuencia(ids, secuencias) {
  var max = 0;
  var filaDe = {};
  var lista = secuencias || [];
  for (var i = 0; i < lista.length; i++) {
    var id = itfEventosRepository_esVacio((ids || [])[i]) ? '' : String(ids[i]).trim();
    var crudo = lista[i];
    var vacia = itfEventosRepository_esVacio(crudo) || String(crudo).trim() === '';
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

// Eventos crudos -> {wellId: [eventos]}, en el orden recibido. Los que no tienen un wellId usable se agrupan bajo la clave '' (la derivacion los marca como invalidos). PURA.
function itfEventosRepository_agruparPorPozo(eventos) {
  var grupos = {};
  (eventos || []).forEach(function (e) {
    var clave = typeof e.wellId === 'string' ? e.wellId : '';
    (grupos[clave] = grupos[clave] || []).push(e);
  });
  return grupos;
}

// Los eventos que tocan a UN pozo: los que llevan su wellId y tambien todo evento que referencie (documentoId / documentoReemplazadoId) un documento PROPUESTO en ese pozo, aunque su propio
// wellId sea otro: la integridad del pozo depende de ellos. PURA (filtro CRUDO: para el estado hay que derivar sobre TODOS los eventos).
function itfEventosRepository_filtrarPorPozo(eventos, wellId) {
  var propios = {};
  (eventos || []).forEach(function (e) {
    if (e.wellId === wellId && e.evento === 'ITF_PROPUESTO' && e.documentoId !== '') {
      propios[e.documentoId] = true;
    }
  });
  return (eventos || []).filter(function (e) {
    return e.wellId === wellId || propios[e.documentoId] === true || (e.documentoReemplazadoId !== '' && propios[e.documentoReemplazadoId] === true);
  });
}

// Los eventos que mencionan a UN documento (como documento o como el reemplazado). PURA.
function itfEventosRepository_filtrarPorDocumento(eventos, documentoId) {
  return (eventos || []).filter(function (e) { return e.documentoId === documentoId || e.documentoReemplazadoId === documentoId; });
}

// Propuestas SIN ningun evento que las cierre (aprobacion, rechazo o retiro del mismo documento): candidatas a "pendientes". Lectura CRUDA: la verdad (si el pozo es derivable, si la
// propuesta sigue pendiente) la decide la derivacion. PURA.
function itfEventosRepository_filtrarPropuestasSinCerrar(eventos) {
  var cerradas = {};
  (eventos || []).forEach(function (e) {
    if (e.evento === 'ITF_APROBADO' || e.evento === 'ITF_RECHAZADO' || e.evento === 'ITF_RETIRADO') {
      cerradas[e.documentoId] = true;
    }
  });
  return (eventos || []).filter(function (e) { return e.evento === 'ITF_PROPUESTO' && cerradas[e.documentoId] !== true; });
}

// --- Acceso a Sheets ---

// La hoja y su esquema. LANZA si la hoja no existe, esta vacia o tiene un esquema inesperado (fail-closed: nunca se crea ni se repara sola).
function itfEventosRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(ITF_EVENTOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + ITF_EVENTOS_HOJA + '" en el spreadsheet configurado (correr setupItfEventosSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + ITF_EVENTOS_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = itfEventosRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + ITF_EVENTOS_HOJA + '" tiene un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: itfEventosRepository_indiceColumnas(header), ancho: header.length };
}

// TODOS los eventos de la hoja, en el orden de las filas, en UNA lectura. {eventos}: cada uno "crudo" (ver eventoDesdeFila). Las filas totalmente vacias a mitad de hoja se saltan.
function itfEventosRepository_leerTodos() {
  var hoja = itfEventosRepository_hoja();
  var data = hoja.sheet.getDataRange().getValues();
  var eventos = [];
  for (var i = 1; i < data.length; i++) {
    if (itfEventosRepository_filaVacia(data[i])) {
      continue;
    }
    eventos.push(itfEventosRepository_eventoDesdeFila(data[i], hoja.indices, i + 1));
  }
  return { eventos: eventos };
}

// Los eventos que tocan a UN pozo (ver filtrarPorPozo). Una sola lectura de la hoja. wellId tal cual (DD-PPPP).
function itfEventosRepository_listarPorPozo(wellId) {
  return { eventos: itfEventosRepository_filtrarPorPozo(itfEventosRepository_leerTodos().eventos, wellId) };
}

// Los eventos que mencionan a UN documento. Una sola lectura de la hoja. documentoId en minuscula (UUID) o LEGACY:<wellId>.
function itfEventosRepository_listarPorDocumento(documentoId) {
  return { eventos: itfEventosRepository_filtrarPorDocumento(itfEventosRepository_leerTodos().eventos, documentoId) };
}

// Todos los eventos agrupados por pozo (ver agruparPorPozo). Una sola lectura de la hoja.
function itfEventosRepository_listarAgrupadosPorPozo() {
  return { porPozo: itfEventosRepository_agruparPorPozo(itfEventosRepository_leerTodos().eventos) };
}

// Propuestas sin cerrar (ver filtrarPropuestasSinCerrar): la base de la cola "ITF pendientes". Una sola lectura de la hoja (sin N+1).
function itfEventosRepository_listarPropuestasPendientes() {
  return { eventos: itfEventosRepository_filtrarPropuestasSinCerrar(itfEventosRepository_leerTodos().eventos) };
}

// Todos los valores de UNA columna de datos (sin el encabezado), en una sola lectura. [] si la hoja no tiene filas de datos.
function itfEventosRepository_leerColumna(hoja, nombre) {
  var n = hoja.sheet.getLastRow() - 1;
  if (n <= 0) {
    return [];
  }
  return hoja.sheet.getRange(2, hoja.indices[nombre] + 1, n, 1).getValues().map(function (f) { return f[0]; });
}

// Siguiente secuencia de la hoja. LANZA si no se puede calcular con seguridad (el que escribe no escribe nada). Llamar SOLO dentro de itfEventosRepository_conLock.
function itfEventosRepository_siguienteSecuencia(hoja) {
  var r = itfEventosRepository_calcularSiguienteSecuencia(
    itfEventosRepository_leerColumna(hoja, 'eventoId'), itfEventosRepository_leerColumna(hoja, 'secuencia'));
  if (!r.ok) {
    throw new Error('No se puede calcular la secuencia de forma segura en "' + ITF_EVENTOS_HOJA + '": ' + r.motivo + ' (no se escribio nada)');
  }
  return r.siguiente;
}

// Los eventos que ya usaron el clientRequestId de un usuario (en CUALQUIER evento: el id es por usuario, no por tipo de evento). Lee 2 columnas completas (email y clientRequestId) y despues
// SOLO las filas que coinciden. Devuelve {total, eventos}: `total` son todas las coincidencias y `eventos` las primeras 2 (con 2 ya se sabe que es una inconsistencia: la idempotencia exige UNA).
// emailNormalizado: minuscula y sin espacios. NO decide nada: la decision es del Service.
function itfEventosRepository_buscarPorClientRequestId(emailNormalizado, clientRequestId) {
  var hoja = itfEventosRepository_hoja();
  var emails = itfEventosRepository_leerColumna(hoja, 'email');
  if (emails.length === 0) {
    return { total: 0, eventos: [] };
  }
  var reqs = itfEventosRepository_leerColumna(hoja, 'clientRequestId');
  var filas = [];
  for (var i = 0; i < reqs.length; i++) {
    if (itfEventosRepository_esVacio(reqs[i]) || String(reqs[i]).trim() !== clientRequestId) {
      continue;
    }
    if (String(itfEventosRepository_esVacio(emails[i]) ? '' : emails[i]).trim().toLowerCase() === emailNormalizado) {
      filas.push(i + 2);
    }
  }
  var eventos = filas.slice(0, ITF_EVENTOS_MAX_COINCIDENCIAS).map(function (numero) {
    return itfEventosRepository_eventoDesdeFila(hoja.sheet.getRange(numero, 1, 1, hoja.ancho).getValues()[0], hoja.indices, numero);
  });
  return { total: filas.length, eventos: eventos };
}

// Escribe UNO O VARIOS eventos CONSECUTIVOS al final de la hoja, en una sola operacion: asigna la `secuencia` (max + 1, max + 2, ... FALLA CERRADO) y los escribe con formato de texto plano
// ANTES de los valores. Llamar SOLO dentro de itfEventosRepository_conLock. Los eventos ya vienen validados y armados por el Service (todos los campos menos `secuencia`, que fija este archivo).
// LANZA, sin escribir nada, si la lista esta vacia, si la hoja falta o esta mal o si la secuencia no se puede calcular. Devuelve los eventos escritos (con su secuencia).
function itfEventosRepository_escribirEventos(eventos) {
  if (!Array.isArray(eventos) || eventos.length === 0) {
    throw new Error('itfEventosRepository_escribirEventos: no hay eventos para escribir');
  }
  var hoja = itfEventosRepository_hoja();
  var primeraSecuencia = itfEventosRepository_siguienteSecuencia(hoja);
  var escritos = eventos.map(function (evento, i) {
    var escrito = {};
    ITF_EVENTOS_COLUMNAS.forEach(function (nombre) { escrito[nombre] = evento[nombre]; });
    escrito.secuencia = primeraSecuencia + i;
    return escrito;
  });
  var filas = escritos.map(function (e) { return itfEventosRepository_filaDesdeObjeto(e, hoja.indices, hoja.ancho); });
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, filas.length, hoja.ancho);
  var formatos = itfEventosRepository_formatosDeFila(hoja.indices, hoja.ancho);
  rango.setNumberFormats(filas.map(function () { return formatos.slice(); }));      // texto plano ANTES de los valores
  rango.setValues(filas);
  SpreadsheetApp.flush();
  return escritos;
}

// Escribe UN evento (ver escribirEventos). Devuelve el evento escrito (con su secuencia).
function itfEventosRepository_escribirEvento(evento) {
  return itfEventosRepository_escribirEventos([evento])[0];
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera.
function itfEventosRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(ITF_EVENTOS_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script, y SOLO en el rollout (E9-8): NO se ejecuta en E9-2. IDEMPOTENTE: crea la hoja con su encabezado si no existe; si ya existe SOLO
// la valida (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No la llama ninguna lectura. Devuelve 'CREADA' o 'YA_EXISTE'.
function setupItfEventosSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(ITF_EVENTOS_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + ITF_EVENTOS_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = itfEventosRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + ITF_EVENTOS_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + ITF_EVENTOS_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(ITF_EVENTOS_HOJA);
  sheet.getRange(1, 1, 1, ITF_EVENTOS_COLUMNAS.length).setValues([ITF_EVENTOS_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + ITF_EVENTOS_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_EVENTOS_HOJA,
    ITF_EVENTOS_COLUMNAS,
    ITF_EVENTOS_FORMATOS_NUMERICOS,
    ITF_EVENTOS_LOCK_TIMEOUT_MS,
    ITF_EVENTOS_MAX_COINCIDENCIAS,
    itfEventosRepository_indiceColumnas,
    itfEventosRepository_planEsquema,
    itfEventosRepository_eventoDesdeFila,
    itfEventosRepository_filaVacia,
    itfEventosRepository_filaDesdeObjeto,
    itfEventosRepository_formatosDeFila,
    itfEventosRepository_calcularSiguienteSecuencia,
    itfEventosRepository_agruparPorPozo,
    itfEventosRepository_filtrarPorPozo,
    itfEventosRepository_filtrarPorDocumento,
    itfEventosRepository_filtrarPropuestasSinCerrar,
    itfEventosRepository_hoja,
    itfEventosRepository_leerTodos,
    itfEventosRepository_listarPorPozo,
    itfEventosRepository_listarPorDocumento,
    itfEventosRepository_listarAgrupadosPorPozo,
    itfEventosRepository_listarPropuestasPendientes,
    itfEventosRepository_leerColumna,
    itfEventosRepository_siguienteSecuencia,
    itfEventosRepository_buscarPorClientRequestId,
    itfEventosRepository_escribirEventos,
    itfEventosRepository_escribirEvento,
    itfEventosRepository_conLock,
    setupItfEventosSheet
  };
}
