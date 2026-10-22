// Unica funcion/archivo que sabe que existe la hoja "ObservacionesPozo" en Sheets (mismo spreadsheet que Usuarios/Historial/UbicacionCorrecciones).
//
// Observaciones generales de un pozo (E5): contexto humano y auditable (acceso, estado fisico, lo que informa el propietario...), INDEPENDIENTE de la evaluacion de reemplazo, las
// correcciones de ubicacion, las fotos, el ITF y los niveles estaticos. APPEND-ONLY: una fila = un EVENTO inmutable; nunca se edita ni se borra una fila desde la app. No hay columna
// de estado: el estado (ACTIVA / ANULADA) se DERIVA de los eventos (ObservacionesPozoService.js). Una sola hoja: no hay escritura entre hojas, asi que no existe autocurado.
//
// Esquema (11 columnas, en este orden; el orden REAL de la hoja puede variar: se buscan por el texto del encabezado):
//   observacionId | evento | wellId | texto | categoria | motivo | email | nombre | timestampUtc | secuencia | clientRequestId
//   - Funcionales
//       observacionId   UUID v4 de la OBSERVACION (lo genera el servidor). Una ALTA lo crea; la ANULADA lo REFERENCIA.
//       evento          ALTA | ANULADA.
//       wellId          DD-PPPP. En una ANULADA es una copia del pozo de la alta (el servidor lo copia al escribir, E5-3).
//       texto           solo en ALTA: el texto de la observacion (texto libre, plano; hasta 1000 caracteres, lo exige la escritura).
//       categoria       RESERVADA, siempre vacia en el MVP (el servidor escribe vacio; una entrada que traiga una categoria no soportada se RECHAZA, no se ignora). Sin catalogo todavia.
//       motivo          solo en ANULADA: el motivo de la anulacion (obligatorio al anular).
//   - Auditoria (salen de la SESION; el cliente nunca los manda)
//       email, nombre   quien escribio el evento. email normalizado (sirve para la idempotencia y para "anular lo propio"); NUNCA sale hacia el cliente. nombre es la foto del nombre.
//       timestampUtc    ISO 8601 UTC con milisegundos y Z, guardado como TEXTO (no depende del formato regional de Sheets).
//   - Internos
//       secuencia       entero GLOBAL y monotono (max + 1, asignado bajo lock al escribir). Es el UNICO orden y el cursor de paginacion: la fecha no se usa jamas para ordenar.
//       clientRequestId idempotencia de la escritura, unico por usuario (E5-2 / E5-3).
//   Lo que NO se guarda a proposito: estado (derivado), versionVista, fuente de existencia del pozo (queda en Logger, sin texto), adjuntos, visibilidad publica.
//
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase insensible): reordenarlas a mano no rompe nada. Si falta CUALQUIERA de las 11 (o hay una repetida) se lanza
// error (fail-closed: nunca se lee ni se escribe una hoja con un esquema que no se reconoce). Una hoja inexistente tambien lanza: NO se crea sola durante una lectura; la crea
// setupObservacionesPozoSheet, que se corre a mano UNA vez. Las columnas de texto se escribiran como TEXTO PLANO ('@'): un texto que empiece con "=" o "+" nunca se evalua.
//
// LECTURA por pozo (E5-1) - estrategia en lotes, sin N+1 (ver observacionesPozoRepository_listarEventosDelPozo):
//   - hoja chica (hasta OBSERVACIONES_POZO_FILAS_LECTURA_COMPLETA filas de datos): UNA lectura de todo el rango y se filtra en memoria;
//   - hoja grande: UNA lectura de las 3 columnas de IDENTIDAD (observacionId, evento, wellId) de todas las filas (sin los textos, que son lo pesado), se eligen las filas del pozo (y
//     toda ANULADA que referencie una alta del pozo, aunque su wellId este roto) y se leen SOLO esas filas en a lo sumo OBSERVACIONES_POZO_MAX_RANGOS rangos.
//
// ESCRITURA (E5-2: la ALTA; E5-3: la ANULADA). Una ALTA es UNA fila escrita de una sola vez (setValues de una fila), con el formato de texto plano ('@') puesto ANTES de los
// valores en todas las columnas menos `secuencia` ('0'): un texto que empiece con "=", "+", "-" o "@" queda como texto, jamas se evalua como formula (mismo patron que el resto de las hojas).
// La `secuencia` la calcula este archivo (max + 1) y es de FALLAR CERRADO: es un invariante estructural (orden global, cursor de paginacion: un entero unico y monotono), asi que si la hoja
// ya esta corrupta (una secuencia ilegible, <= 0, fraccionaria o REPETIDA) no se escribe nada: ver calcularSiguienteSecuencia.
//
// Concurrencia: las funciones de escritura de este archivo NO toman el lock; el Service las llama dentro de observacionesPozoRepository_conLock (mismo lock de script que usan las
// correcciones y las decisiones), que serializa buscar-por-clientRequestId -> secuencia -> escribir. LockService no es reentrante de forma confiable: el lock vive en un solo lugar.
var OBSERVACIONES_POZO_HOJA = 'ObservacionesPozo';
var OBSERVACIONES_POZO_COLUMNAS = [
  'observacionId', 'evento', 'wellId', 'texto', 'categoria', 'motivo', 'email', 'nombre', 'timestampUtc', 'secuencia', 'clientRequestId'
];
var OBSERVACIONES_POZO_COLUMNAS_IDENTIDAD = ['observacionId', 'evento', 'wellId'];
var OBSERVACIONES_POZO_EVENTOS = ['ALTA', 'ANULADA'];
// columna -> formato de numero con que se escribe (el resto va como texto plano)
var OBSERVACIONES_POZO_FORMATOS_NUMERICOS = { secuencia: '0' };
var OBSERVACIONES_POZO_LOCK_TIMEOUT_MS = 10000;
// Hasta esta cantidad de filas de datos se lee todo de una vez (una llamada); por encima se usa la lectura selectiva.
var OBSERVACIONES_POZO_FILAS_LECTURA_COMPLETA = 2000;
// Lectura selectiva: se unen en un mismo rango las filas separadas por hasta GAP filas, y nunca se hacen mas de MAX_RANGOS lecturas de filas.
var OBSERVACIONES_POZO_GAP_MAX = 40;
var OBSERVACIONES_POZO_MAX_RANGOS = 5;
var OBSERVACIONES_POZO_MAX_FILAS_POR_ID = 10;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function observacionesPozoRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  OBSERVACIONES_POZO_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes:[...], repetidas:[...]}. Una columna repetida tambien es un esquema inesperado (no se sabria cual leer).
function observacionesPozoRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = observacionesPozoRepository_indiceColumnas(header);
  var faltantes = OBSERVACIONES_POZO_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = OBSERVACIONES_POZO_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function observacionesPozoRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function observacionesPozoRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Numero de una celda; vacio o no numerico -> null (el servicio lo marca como inconsistente, no se corrige en silencio).
function observacionesPozoRepository_numero(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (observacionesPozoRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

// El timestamp se guarda como texto ISO UTC. Si alguien reformateo la columna y Sheets lo convirtio en fecha, se lee igual (ISO) para no perder el dato.
function observacionesPozoRepository_timestamp(row, indices) {
  var v = row[indices.timestampUtc];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Identidad minima de una fila (la unica que se lee de TODAS las filas en una hoja grande). evento en mayuscula y observacionId en minuscula, ya normalizados.
function observacionesPozoRepository_identidadDeFila(row, indices) {
  return {
    observacionId: observacionesPozoRepository_texto(row, indices, 'observacionId').toLowerCase(),
    evento: observacionesPozoRepository_texto(row, indices, 'evento').toUpperCase(),
    wellId: observacionesPozoRepository_texto(row, indices, 'wellId')
  };
}

// Fila -> evento "crudo" (sin interpretar). La validez de contenido es del servicio (derivar), no de aca. `fila` es el numero de fila de la hoja (solo para diagnostico).
function observacionesPozoRepository_eventoDesdeFila(row, indices, numeroFila) {
  function t(n) { return observacionesPozoRepository_texto(row, indices, n); }
  var identidad = observacionesPozoRepository_identidadDeFila(row, indices);
  return {
    fila: numeroFila,
    observacionId: identidad.observacionId,
    evento: identidad.evento,
    wellId: identidad.wellId,
    texto: t('texto'),
    categoria: t('categoria'),
    motivo: t('motivo'),
    email: t('email').toLowerCase(),
    nombre: t('nombre'),
    timestampUtc: observacionesPozoRepository_timestamp(row, indices),
    secuencia: observacionesPozoRepository_numero(row, indices, 'secuencia'),
    clientRequestId: t('clientRequestId')
  };
}

// Numeros de fila (de la hoja, base 1; la 1 es el encabezado) que hay que leer para un pozo, ordenados. identidades[i] corresponde a la fila i + 2.
//   - toda fila cuyo wellId es el del pozo (sea cual sea su evento: lo desconocido lo descarta el servicio);
//   - toda fila que REFERENCIE (mismo observacionId) una ALTA del pozo, aunque su wellId este vacio o roto. Una ANULADA con el wellId danado tiene que seguir ocultando la
//     observacion que anula: si no se leyera, la observacion reapareceria como activa.
function observacionesPozoRepository_filasDeInteres(identidades, wellId) {
  var idsDelPozo = {};
  (identidades || []).forEach(function (x) {
    if (x && x.wellId === wellId && x.evento === 'ALTA' && x.observacionId !== '') {
      idsDelPozo[x.observacionId] = true;
    }
  });
  var filas = [];
  (identidades || []).forEach(function (x, i) {
    if (x && (x.wellId === wellId || (x.observacionId !== '' && idsDelPozo[x.observacionId] === true))) {
      filas.push(i + 2);
    }
  });
  return filas;
}

// Agrupa numeros de fila (ordenados, sin repetir) en rangos [{desde, hasta}] (inclusivos): une las filas separadas por hasta gapMax filas y, si aun quedan mas de maxRangos,
// sigue uniendo los rangos con el hueco mas chico hasta llegar al tope. Asi las llamadas a Sheets quedan acotadas (nunca una por fila) y lo que se lee de mas es lo minimo.
function observacionesPozoRepository_planificarLectura(filas, gapMax, maxRangos) {
  var lista = filas || [];
  if (lista.length === 0) {
    return [];
  }
  var tope = Math.max(1, maxRangos || 1);
  var rangos = [];
  var desde = lista[0];
  var hasta = lista[0];
  for (var i = 1; i < lista.length; i++) {
    if (lista[i] - hasta - 1 <= gapMax) {
      hasta = lista[i];
    } else {
      rangos.push({ desde: desde, hasta: hasta });
      desde = lista[i];
      hasta = lista[i];
    }
  }
  rangos.push({ desde: desde, hasta: hasta });
  while (rangos.length > tope) {
    var mejor = 0;
    var mejorHueco = rangos[1].desde - rangos[0].hasta;
    for (var j = 1; j < rangos.length - 1; j++) {
      var hueco = rangos[j + 1].desde - rangos[j].hasta;
      if (hueco < mejorHueco) {
        mejorHueco = hueco;
        mejor = j;
      }
    }
    rangos.splice(mejor, 2, { desde: rangos[mejor].desde, hasta: rangos[mejor + 1].hasta });
  }
  return rangos;
}

function observacionesPozoRepository_filaVacia(row) {
  return (row || []).every(function (v) { return observacionesPozoRepository_esVacio(v) || String(v).trim() === ''; });
}

// --- Acceso a Sheets ---

// La hoja y su esquema. LANZA si la hoja no existe, esta vacia o tiene un esquema inesperado (fail-closed: nunca se crea ni se repara sola).
function observacionesPozoRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(OBSERVACIONES_POZO_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + OBSERVACIONES_POZO_HOJA + '" en el spreadsheet configurado (correr setupObservacionesPozoSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + OBSERVACIONES_POZO_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = observacionesPozoRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + OBSERVACIONES_POZO_HOJA + '" no tiene el esquema esperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: observacionesPozoRepository_indiceColumnas(header), ancho: header.length };
}

// Una pasada de lectura. Devuelve {eventos, modo, filasConsultadas, rangos} o {inconsistente:true} si la hoja cambio entre las dos lecturas (una fila que ya no es la que se vio).
function observacionesPozoRepository_leerPasada(hoja, wellId) {
  var sheet = hoja.sheet;
  var indices = hoja.indices;
  var ultima = sheet.getLastRow();
  var n = ultima - 1;                                       // filas de datos (la 1 es el encabezado)
  if (n <= 0) {
    return { eventos: [], modo: 'VACIA', filasConsultadas: 0, rangos: 0 };
  }

  if (n <= OBSERVACIONES_POZO_FILAS_LECTURA_COMPLETA) {
    var todo = sheet.getRange(2, 1, n, hoja.ancho).getValues();
    var identidadesChicas = todo.map(function (row) { return observacionesPozoRepository_identidadDeFila(row, indices); });
    var elegidas = {};
    observacionesPozoRepository_filasDeInteres(identidadesChicas, wellId).forEach(function (f) { elegidas[f] = true; });
    var eventosChicos = [];
    todo.forEach(function (row, i) {
      if (elegidas[i + 2] === true) {
        eventosChicos.push(observacionesPozoRepository_eventoDesdeFila(row, indices, i + 2));
      }
    });
    return { eventos: eventosChicos, modo: 'COMPLETA', filasConsultadas: n, rangos: 1 };
  }

  // Hoja grande: 1) identidad de TODAS las filas, en una sola lectura de las columnas observacionId / evento / wellId (rango contiguo que las abarca);
  var posiciones = OBSERVACIONES_POZO_COLUMNAS_IDENTIDAD.map(function (c) { return indices[c]; });
  var primera = Math.min.apply(null, posiciones);
  var ancho = Math.max.apply(null, posiciones) - primera + 1;
  var bloque = sheet.getRange(2, primera + 1, n, ancho).getValues();
  var rel = {};
  OBSERVACIONES_POZO_COLUMNAS_IDENTIDAD.forEach(function (c) { rel[c] = indices[c] - primera; });
  var identidades = bloque.map(function (row) { return observacionesPozoRepository_identidadDeFila(row, rel); });
  // 2) las filas del pozo, planificadas en pocos rangos;
  var filas = observacionesPozoRepository_filasDeInteres(identidades, wellId);
  var rangos = observacionesPozoRepository_planificarLectura(filas, OBSERVACIONES_POZO_GAP_MAX, OBSERVACIONES_POZO_MAX_RANGOS);
  // 3) se leen esas filas completas y se verifica que cada una siga siendo la que se vio (la hoja es append-only: si no coincide, alguien la reordeno a mano).
  var elegidasGrandes = {};
  filas.forEach(function (f) { elegidasGrandes[f] = true; });
  var eventos = [];
  var consultadas = 0;
  for (var k = 0; k < rangos.length; k++) {
    var alto = rangos[k].hasta - rangos[k].desde + 1;
    var valores = sheet.getRange(rangos[k].desde, 1, alto, hoja.ancho).getValues();
    consultadas += alto;
    for (var r = 0; r < valores.length; r++) {
      var numero = rangos[k].desde + r;
      var visto = identidades[numero - 2];
      var leido = observacionesPozoRepository_identidadDeFila(valores[r], indices);
      if (!visto || visto.observacionId !== leido.observacionId || visto.evento !== leido.evento || visto.wellId !== leido.wellId) {
        return { inconsistente: true };
      }
      if (elegidasGrandes[numero] === true) {
        eventos.push(observacionesPozoRepository_eventoDesdeFila(valores[r], indices, numero));
      }
    }
  }
  return { eventos: eventos, modo: 'SELECTIVA', filasConsultadas: n + consultadas, rangos: rangos.length };
}

// Todos los eventos que conciernen a un pozo (ver observacionesPozoRepository_filasDeInteres), en el orden de la hoja (que NO es el orden de aplicacion: el orden lo da `secuencia`).
// NO verifica que el pozo exista: sin filas devuelve una lista vacia. Una fila totalmente vacia se salta; una fila a medias NO (el servicio la marca como inconsistente).
// Devuelve {eventos, modo, filasConsultadas, rangos}. LANZA si la hoja falta o esta mal, o si cambio mientras se leia (un reintento y despues error: nunca datos mezclados).
function observacionesPozoRepository_listarEventosDelPozo(wellId) {
  var hoja = observacionesPozoRepository_hoja();
  for (var intento = 0; intento < 2; intento++) {
    var r = observacionesPozoRepository_leerPasada(hoja, wellId);
    if (r.inconsistente !== true) {
      return r;
    }
  }
  throw new Error('La hoja "' + OBSERVACIONES_POZO_HOJA + '" cambio mientras se leia (reintentar)');
}

// --- Escritura de la ALTA (E5-2) ---

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function observacionesPozoRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  OBSERVACIONES_POZO_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = observacionesPozoRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

// Formato de cada celda de la fila: TEXTO PLANO ('@') en todas (tambien en las columnas desconocidas) salvo `secuencia` ('0').
function observacionesPozoRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  OBSERVACIONES_POZO_COLUMNAS.forEach(function (nombre) {
    if (OBSERVACIONES_POZO_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = OBSERVACIONES_POZO_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// Todos los valores de UNA columna de datos (sin el encabezado), en una sola lectura. [] si la hoja no tiene filas de datos.
function observacionesPozoRepository_leerColumna(hoja, nombre) {
  var n = hoja.sheet.getLastRow() - 1;
  if (n <= 0) {
    return [];
  }
  return hoja.sheet.getRange(2, hoja.indices[nombre] + 1, n, 1).getValues().map(function (f) { return f[0]; });
}

// Siguiente secuencia (max + 1) a partir de las columnas observacionId y secuencia (en el orden de la hoja). PURA.
// FALLA CERRADO: no se "arregla" nada en silencio (no se renumera, no se elige una de las repetidas, no se sigue escribiendo sobre una corrupcion estructural). Cada fila de datos tiene
// que ser TOTALMENTE vacia en esas dos columnas (se salta) o tener un observacionId Y una secuencia entera >= 1 (un numero, o un texto de solo digitos), y NINGUNA secuencia puede
// figurar en dos filas (dos eventos distintos con la misma secuencia, sean ALTA o ANULADA, son una hoja corrupta). Una secuencia vacia, de texto, cero, negativa, fraccionaria o repetida, o
// una secuencia sin observacionId, hace imposible garantizar el invariante: {ok:false, motivo} (el motivo nombra solo numeros de fila y de secuencia, nunca contenido). Detectar repetidas no
// cuesta otra lectura: ya se recorren todas las secuencias para calcular el maximo. Sin corrupcion: {ok:true, siguiente: max + 1}.
function observacionesPozoRepository_calcularSiguienteSecuencia(ids, secuencias) {
  var max = 0;
  var filaDe = {};                                      // secuencia -> primera fila que la usa
  var lista = secuencias || [];
  for (var i = 0; i < lista.length; i++) {
    var id = observacionesPozoRepository_esVacio((ids || [])[i]) ? '' : String(ids[i]).trim();
    var crudo = lista[i];
    var vacia = observacionesPozoRepository_esVacio(crudo) || String(crudo).trim() === '';
    if (id === '' && vacia) {
      continue;
    }
    if (vacia || id === '') {
      return { ok: false, motivo: 'la fila ' + (i + 2) + ' tiene ' + (vacia ? 'observacionId sin secuencia' : 'secuencia sin observacionId') };
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

// Siguiente secuencia de la hoja. LANZA si no se puede calcular con seguridad (el que escribe no escribe nada). Llamar SOLO dentro de observacionesPozoRepository_conLock.
function observacionesPozoRepository_siguienteSecuencia(hoja) {
  var r = observacionesPozoRepository_calcularSiguienteSecuencia(
    observacionesPozoRepository_leerColumna(hoja, 'observacionId'), observacionesPozoRepository_leerColumna(hoja, 'secuencia'));
  if (!r.ok) {
    throw new Error('No se puede calcular la secuencia de forma segura en "' + OBSERVACIONES_POZO_HOJA + '": ' + r.motivo + ' (no se escribio nada)');
  }
  return r.siguiente;
}

// Los eventos que ya usaron el clientRequestId de un usuario (en CUALQUIER evento de la hoja: el id es por usuario, no por tipo de evento). Lee 2 columnas completas (email y
// clientRequestId) y despues SOLO las filas que coinciden. Devuelve {total, eventos}: `total` son todas las coincidencias y `eventos` las primeras 2 (con 2 ya se sabe que es una
// inconsistencia: la idempotencia exige UNA). emailNormalizado: minuscula y sin espacios. NO verifica nada mas: la decision es del Service.
function observacionesPozoRepository_buscarPorClientRequestId(emailNormalizado, clientRequestId) {
  var hoja = observacionesPozoRepository_hoja();
  var emails = observacionesPozoRepository_leerColumna(hoja, 'email');
  if (emails.length === 0) {
    return { total: 0, eventos: [] };
  }
  var reqs = observacionesPozoRepository_leerColumna(hoja, 'clientRequestId');
  var filas = [];
  for (var i = 0; i < reqs.length; i++) {
    if (observacionesPozoRepository_esVacio(reqs[i]) || String(reqs[i]).trim() !== clientRequestId) {
      continue;
    }
    if (String(observacionesPozoRepository_esVacio(emails[i]) ? '' : emails[i]).trim().toLowerCase() === emailNormalizado) {
      filas.push(i + 2);
    }
  }
  var eventos = filas.slice(0, 2).map(function (numero) {
    return observacionesPozoRepository_eventoDesdeFila(hoja.sheet.getRange(numero, 1, 1, hoja.ancho).getValues()[0], hoja.indices, numero);
  });
  return { total: filas.length, eventos: eventos };
}

// Todas las filas (cualquier evento) de UNA observacion: las que llevan ese observacionId (en minuscula, sin espacios). Lee la columna observacionId completa y despues SOLO las filas que
// coinciden. Devuelve {total, eventos}: `total` son todas las coincidencias y `eventos` las primeras OBSERVACIONES_POZO_MAX_FILAS_POR_ID (una observacion sana tiene 1 ALTA y a lo sumo una
// ANULADA; con muchas mas es una inconsistencia y el Service no sigue). NO interpreta nada: la decision es del Service. Es la busqueda de la anulacion: el wellId NO lo trae el cliente,
// sale de la ALTA que se encuentra aca.
function observacionesPozoRepository_buscarPorObservacionId(observacionId) {
  var hoja = observacionesPozoRepository_hoja();
  var ids = observacionesPozoRepository_leerColumna(hoja, 'observacionId');
  var filas = [];
  for (var i = 0; i < ids.length; i++) {
    if (!observacionesPozoRepository_esVacio(ids[i]) && String(ids[i]).trim().toLowerCase() === observacionId) {
      filas.push(i + 2);
    }
  }
  var eventos = filas.slice(0, OBSERVACIONES_POZO_MAX_FILAS_POR_ID).map(function (numero) {
    return observacionesPozoRepository_eventoDesdeFila(hoja.sheet.getRange(numero, 1, 1, hoja.ancho).getValues()[0], hoja.indices, numero);
  });
  return { total: filas.length, eventos: eventos };
}

// Escribe UN evento al final de la hoja: asigna la `secuencia` (max + 1, FALLA CERRADO) y lo escribe en una sola operacion, con formato de texto plano ANTES de los valores. Llamar SOLO
// dentro de observacionesPozoRepository_conLock. `evento` trae todos los campos menos `secuencia`, que la fija este archivo. LANZA, sin escribir nada, si la hoja falta o esta mal o si la
// secuencia no se puede calcular. Devuelve el evento escrito (con su secuencia).
function observacionesPozoRepository_escribirEvento(evento) {
  var hoja = observacionesPozoRepository_hoja();
  evento.secuencia = observacionesPozoRepository_siguienteSecuencia(hoja);
  var fila = observacionesPozoRepository_filaDesdeObjeto(evento, hoja.indices, hoja.ancho);
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, 1, hoja.ancho);
  rango.setNumberFormats([observacionesPozoRepository_formatosDeFila(hoja.indices, hoja.ancho)]);      // texto plano ANTES de los valores
  rango.setValues([fila]);
  SpreadsheetApp.flush();
  return evento;
}

// Agrega UNA fila ALTA. `alta` ya viene validada y normalizada por el Service: {observacionId, wellId, texto, email, nombre, timestampUtc, clientRequestId}; `evento`, `categoria` y `motivo`
// los fija este archivo (ALTA, vacio, vacio) y `secuencia` tambien: el cliente nunca elige ninguno.
function observacionesPozoRepository_agregarAlta(alta) {
  return observacionesPozoRepository_escribirEvento({
    observacionId: alta.observacionId,
    evento: 'ALTA',
    wellId: alta.wellId,
    texto: alta.texto,
    categoria: '',
    motivo: '',
    email: alta.email,
    nombre: alta.nombre || '',
    timestampUtc: alta.timestampUtc,
    clientRequestId: alta.clientRequestId
  });
}

// Agrega UNA fila ANULADA (E5-3). `anulada` ya viene validada por el Service: {observacionId (el de la ALTA original), wellId (copiado de esa ALTA), motivo, email, nombre,
// timestampUtc, clientRequestId}. `evento`, `texto` y `categoria` los fija este archivo (ANULADA, vacio, vacio): NUNCA se copia el texto original a la fila de anulacion.
function observacionesPozoRepository_agregarAnulada(anulada) {
  return observacionesPozoRepository_escribirEvento({
    observacionId: anulada.observacionId,
    evento: 'ANULADA',
    wellId: anulada.wellId,
    texto: '',
    categoria: '',
    motivo: anulada.motivo,
    email: anulada.email,
    nombre: anulada.nombre || '',
    timestampUtc: anulada.timestampUtc,
    clientRequestId: anulada.clientRequestId
  });
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera. La usan las escrituras (E5-2: agregar; E5-3: anular).
function observacionesPozoRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(OBSERVACIONES_POZO_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > setupObservacionesPozoSheet). IDEMPOTENTE: crea la hoja con su encabezado si no existe; si ya existe SOLO la
// valida (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No se ejecuta sola en ningun lado y NO la llama ninguna lectura.
// Devuelve 'CREADA' o 'YA_EXISTE'.
function setupObservacionesPozoSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(OBSERVACIONES_POZO_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + OBSERVACIONES_POZO_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = observacionesPozoRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + OBSERVACIONES_POZO_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + OBSERVACIONES_POZO_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(OBSERVACIONES_POZO_HOJA);
  sheet.getRange(1, 1, 1, OBSERVACIONES_POZO_COLUMNAS.length).setValues([OBSERVACIONES_POZO_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + OBSERVACIONES_POZO_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OBSERVACIONES_POZO_HOJA,
    OBSERVACIONES_POZO_COLUMNAS,
    OBSERVACIONES_POZO_COLUMNAS_IDENTIDAD,
    OBSERVACIONES_POZO_EVENTOS,
    OBSERVACIONES_POZO_FORMATOS_NUMERICOS,
    OBSERVACIONES_POZO_LOCK_TIMEOUT_MS,
    OBSERVACIONES_POZO_FILAS_LECTURA_COMPLETA,
    OBSERVACIONES_POZO_GAP_MAX,
    OBSERVACIONES_POZO_MAX_RANGOS,
    OBSERVACIONES_POZO_MAX_FILAS_POR_ID,
    observacionesPozoRepository_indiceColumnas,
    observacionesPozoRepository_planEsquema,
    observacionesPozoRepository_identidadDeFila,
    observacionesPozoRepository_eventoDesdeFila,
    observacionesPozoRepository_filasDeInteres,
    observacionesPozoRepository_planificarLectura,
    observacionesPozoRepository_filaVacia,
    observacionesPozoRepository_hoja,
    observacionesPozoRepository_listarEventosDelPozo,
    observacionesPozoRepository_filaDesdeObjeto,
    observacionesPozoRepository_formatosDeFila,
    observacionesPozoRepository_leerColumna,
    observacionesPozoRepository_calcularSiguienteSecuencia,
    observacionesPozoRepository_siguienteSecuencia,
    observacionesPozoRepository_buscarPorClientRequestId,
    observacionesPozoRepository_buscarPorObservacionId,
    observacionesPozoRepository_escribirEvento,
    observacionesPozoRepository_agregarAlta,
    observacionesPozoRepository_agregarAnulada,
    observacionesPozoRepository_conLock,
    setupObservacionesPozoSheet
  };
}
