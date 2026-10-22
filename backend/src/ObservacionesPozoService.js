// ObservacionesPozoService: logica de las observaciones generales de un pozo (E5). No sabe nada de HTTP (Api.js) ni de Sheets (ObservacionesPozoRepository.js). En E5-1 solo LEE:
// deriva el estado de cada observacion desde los eventos de la hoja, decide que se le muestra a quien consulta (privacidad de las anuladas) y pagina. La escritura (alta y anulacion)
// llega en E5-2 / E5-3. Las observaciones son contexto humano y auditable: NO cambian la ubicacion, el estado registral, la evaluacion de reemplazo, las fotos, el ITF ni los NE.
//
// Modelo (ver el repositorio para el esquema): una fila = un EVENTO inmutable.
//   - ALTA     crea una observacion (observacionId, wellId, texto, secuencia...).
//   - ANULADA  REFERENCIA una observacion por su observacionId (con el motivo). No es una observacion independiente.
//   Estado DERIVADO: ACTIVA mientras no la referencie ninguna ANULADA; ANULADA si la referencia alguna. No hay columna de estado.
//
// DERIVACION fail-safe. Principio: ante una inconsistencia el backend NUNCA elige en silencio y NUNCA hace aparecer contenido que debe seguir oculto. Si una observacion es AMBIGUA
// (compiten dos filas por su identidad o se rompe la unicidad de la secuencia) se OCULTA ENTERA (no se devuelve, ni siquiera como anulada, y no cuenta en los totales); si dudar
// es cuestion de privacidad, se oculta antes que mostrar. Criterio exacto:
//   - evento desconocido (ni ALTA ni ANULADA) / fila rota ......... se ignora (EVENTO_DESCONOCIDO / FILA_ROTA).
//   - observacionId que no es un UUID ............................. se ignora (ID_INVALIDO): no se puede relacionar con nada.
//   - IDENTIDAD DUPLICADA: dos o mas ALTA con el mismo observacionId (aunque tengan otro texto, otra secuencia o sean de otro pozo; basta que la fila tenga un UUID: una fila de
//     contenido invalido tambien compite) ........................ ninguna se devuelve (ID_DUPLICADO). NO se elige la de menor secuencia, ni la primera, ni la ultima. Una ANULADA que refiera ese
//                                                                  id no selecciona ni hace reaparecer ninguna: la observacion sigue oculta.
//   - SECUENCIA DUPLICADA: dos eventos (ALTA o ANULADA, de observaciones iguales o distintas) con la misma secuencia ..... la secuencia es el orden global y el cursor: tiene que ser unica.
//     Ante la colision se OCULTAN todas las observaciones que dependen de esos eventos (la de cada ALTA involucrada y la que anula cada ANULADA involucrada) (SECUENCIA_DUPLICADA).
//     La fila nunca sustituye a la secuencia. Las observaciones sanas no se tocan: siguen con una secuencia inequivoca. La unicidad se exige entre los eventos que concurren en la
//     lectura del pozo (sus filas y las anulaciones que las referencian); una colision con un evento de OTRO pozo que no concurre no afecta a este (su cursor sigue inequivoco) y la
//     garantiza quien escribe (E5-2: max + 1 bajo lock).
//   - ALTA invalida (wellId mal formado, texto vacio o secuencia que no es un entero >= 1) .. se ignora (ALTA_INVALIDA): no se muestra contenido dudoso.
//   - ANULADA que referencia una ALTA existente (y no ambigua) ... la observacion queda ANULADA, SIN importar el resto de la fila: aunque su secuencia, fecha, motivo o wellId esten
//                                                                  rotos, o la anulacion figure ANTES del alta (ANULACION_ANTERIOR_AL_ALTA): sin una anulacion el texto saldria a la luz.
//   - varias ANULADA de una misma observacion .................... sigue anulada (nunca "des-anula"); informa autor y motivo la primera (menor secuencia; una sin secuencia valida va
//                                                                  despues). Dos con la misma secuencia son una colision (arriba). Las demas se ignoran (ANULACION_DUPLICADA).
//   - ANULADA cuyo observacionId no tiene ALTA ................... se ignora (ANULACION_HUERFANA). No es una observacion.
// Cada inconsistencia queda en Logger como CODIGO + observacionId + filas + secuencias (solo identificadores: nunca el texto, el motivo ni el email).
var OBSERVACIONES_POZO_ESTADOS = { ACTIVA: 'ACTIVA', ANULADA: 'ANULADA' };
var OBSERVACIONES_POZO_LIMITE_DEFECTO = 50;
var OBSERVACIONES_POZO_LIMITE_MAX = 100;
// Nombre que se muestra cuando falta el nombre del autor (o es un email): nunca el email. Mismo criterio que EvaluacionesReemplazo.
var OBSERVACIONES_POZO_NOMBRE_NEUTRO = 'Usuario';
var OBSERVACIONES_POZO_WELLID_REGEX = /^\d{2}-\d{4}$/;
var OBSERVACIONES_POZO_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function observacionesPozoService_error(code, message) {
  return { ok: false, code: code, message: message };
}

function observacionesPozoService_log(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Observaciones: ' + mensaje);
  }
}

// --- Normalizacion de valores ---

function observacionesPozoService_texto(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Entero >= 1 o null (un numero que no es entero, o negativo, o cero, o texto, no es una secuencia).
function observacionesPozoService_secuencia(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 1 ? v : null;
}

// ISO 8601 o null.
function observacionesPozoService_fechaIso(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  var d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// El nombre que se le muestra al cliente: el de la hoja, o uno neutro si falta o parece un email.
function observacionesPozoService_nombreVisible(nombre) {
  var n = observacionesPozoService_texto(nombre);
  return n === '' || n.indexOf('@') !== -1 ? OBSERVACIONES_POZO_NOMBRE_NEUTRO : n;
}

// --- Derivacion pura ---

// eventos: lista de eventos "crudos" del repositorio ({fila, observacionId, evento, wellId, texto, categoria, motivo, email, nombre, timestampUtc, secuencia}).
// Devuelve {observaciones, activas, anuladas, ocultas, inconsistencias}:
//   - observaciones: SOLO las derivadas sin ambiguedad, ordenadas por secuencia DESCENDENTE (la mas reciente primero), cada una
//     {observacionId, wellId, secuencia, texto, categoria, email, nombre, timestamp, estado, anulacion: null | {nombre, timestamp, motivo}}. Cada una tiene una secuencia UNICA.
//   - activas / anuladas: cuentan solo esas (nunca un objeto ambiguo u oculto).
//   - ocultas: los observacionId que se ocultaron por ambiguedad (diagnostico).
//   - inconsistencias: [{codigo, observacionIds, filas, secuencias}] (solo identificadores).
// Es de uso INTERNO (trae el email y el texto de las anuladas): lo que sale hacia el cliente lo arma observacionesPozoService_vista.
function observacionesPozoService_derivar(eventos) {
  var inconsistencias = [];
  function incons(codigo, ids, filas, secuencias) {
    inconsistencias.push({
      codigo: codigo,
      observacionIds: ids || [],
      filas: (filas || []).filter(function (f) { return typeof f === 'number'; }),
      secuencias: (secuencias || []).filter(function (x) { return typeof x === 'number'; })
    });
  }

  // 1) parseo: lo que no se puede relacionar con nada se ignora.
  var parseados = [];
  (eventos || []).forEach(function (e, orden) {
    if (!e || typeof e !== 'object') {
      incons('FILA_ROTA');
      return;
    }
    var fila = typeof e.fila === 'number' ? e.fila : null;
    var evento = observacionesPozoService_texto(e.evento).toUpperCase();
    if (evento !== 'ALTA' && evento !== 'ANULADA') {
      incons('EVENTO_DESCONOCIDO', [], [fila]);
      return;
    }
    var id = observacionesPozoService_texto(e.observacionId).toLowerCase();
    if (!OBSERVACIONES_POZO_UUID_REGEX.test(id)) {
      incons('ID_INVALIDO', [], [fila]);
      return;
    }
    parseados.push({
      orden: orden,
      fila: fila,
      evento: evento,
      observacionId: id,
      wellId: observacionesPozoService_texto(e.wellId),
      texto: observacionesPozoService_texto(e.texto),
      categoria: observacionesPozoService_texto(e.categoria),
      motivo: observacionesPozoService_texto(e.motivo),
      email: observacionesPozoService_texto(e.email).toLowerCase(),
      nombre: observacionesPozoService_texto(e.nombre),
      timestamp: observacionesPozoService_fechaIso(e.timestampUtc),
      secuencia: observacionesPozoService_secuencia(e.secuencia)
    });
  });
  var altas = parseados.filter(function (x) { return x.evento === 'ALTA'; });
  var anulaciones = parseados.filter(function (x) { return x.evento === 'ANULADA'; });
  var ocultas = {};                                     // observacionId -> true: ambigua, no se devuelve

  // 2) IDENTIDAD: dos o mas ALTA con el mismo observacionId -> ninguna (no se elige entre ellas).
  var altasPorId = {};
  altas.forEach(function (a) { (altasPorId[a.observacionId] = altasPorId[a.observacionId] || []).push(a); });
  Object.keys(altasPorId).forEach(function (id) {
    var lista = altasPorId[id];
    if (lista.length >= 2) {
      ocultas[id] = true;
      incons('ID_DUPLICADO', [id], lista.map(function (a) { return a.fila; }), lista.map(function (a) { return a.secuencia; }));
    }
  });

  // 3) SECUENCIA: unica entre TODOS los eventos. Una colision oculta las observaciones que dependen de los eventos involucrados (la de cada ALTA y la que anula cada ANULADA).
  var porSecuencia = {};
  parseados.forEach(function (x) {
    if (x.secuencia !== null) {
      (porSecuencia[x.secuencia] = porSecuencia[x.secuencia] || []).push(x);
    }
  });
  Object.keys(porSecuencia).forEach(function (sec) {
    var lista = porSecuencia[sec];
    if (lista.length < 2) {
      return;
    }
    var ids = [];
    lista.forEach(function (x) {
      ocultas[x.observacionId] = true;
      if (ids.indexOf(x.observacionId) === -1) {
        ids.push(x.observacionId);
      }
    });
    incons('SECUENCIA_DUPLICADA', ids, lista.map(function (x) { return x.fila; }), [Number(sec)]);
  });

  // 4) ALTAS sin ambiguedad -> observaciones (una ALTA de contenido invalido no se muestra).
  var porId = {};
  var observaciones = [];
  Object.keys(altasPorId).forEach(function (id) {
    var lista = altasPorId[id];
    if (lista.length !== 1 || ocultas[id] === true) {
      return;
    }
    var a = lista[0];
    if (!OBSERVACIONES_POZO_WELLID_REGEX.test(a.wellId) || a.texto === '' || a.secuencia === null) {
      incons('ALTA_INVALIDA', [id], [a.fila], [a.secuencia]);
      return;
    }
    var obs = {
      observacionId: a.observacionId,
      wellId: a.wellId,
      secuencia: a.secuencia,
      texto: a.texto,
      categoria: a.categoria,
      email: a.email,
      nombre: a.nombre,
      timestamp: a.timestamp,
      estado: OBSERVACIONES_POZO_ESTADOS.ACTIVA,
      anulacion: null
    };
    porId[id] = obs;
    observaciones.push(obs);
  });

  // 5) ANULADAS: basta UNA que referencie para anular (aunque su fila este rota o figure antes del alta). La que informa autor y motivo es la primera (menor secuencia; sin secuencia
  // valida va despues; luego el orden de la hoja). Las de una observacion oculta no hacen nada: la observacion sigue oculta.
  anulaciones.sort(function (a, b) {
    var sa = a.secuencia === null ? Infinity : a.secuencia;
    var sb = b.secuencia === null ? Infinity : b.secuencia;
    return sa !== sb ? (sa < sb ? -1 : 1) : a.orden - b.orden;
  });
  anulaciones.forEach(function (n) {
    if (ocultas[n.observacionId] === true) {
      return;
    }
    var obs = porId[n.observacionId];
    if (!obs) {
      incons('ANULACION_HUERFANA', [n.observacionId], [n.fila], [n.secuencia]);
      return;
    }
    if (obs.estado === OBSERVACIONES_POZO_ESTADOS.ANULADA) {
      incons('ANULACION_DUPLICADA', [n.observacionId], [n.fila], [n.secuencia]);
      return;
    }
    if (n.secuencia !== null && n.secuencia < obs.secuencia) {
      incons('ANULACION_ANTERIOR_AL_ALTA', [n.observacionId], [n.fila], [n.secuencia, obs.secuencia]);
    }
    if (n.wellId !== '' && n.wellId !== obs.wellId) {
      incons('ANULACION_OTRO_POZO', [n.observacionId], [n.fila], [n.secuencia]);
    }
    obs.estado = OBSERVACIONES_POZO_ESTADOS.ANULADA;
    obs.anulacion = { nombre: n.nombre, timestamp: n.timestamp, motivo: n.motivo };
  });

  observaciones.sort(function (a, b) { return b.secuencia - a.secuencia; });
  var activas = 0;
  var anuladas = 0;
  observaciones.forEach(function (o) {
    if (o.estado === OBSERVACIONES_POZO_ESTADOS.ANULADA) { anuladas++; } else { activas++; }
  });
  return { observaciones: observaciones, activas: activas, anuladas: anuladas, ocultas: Object.keys(ocultas), inconsistencias: inconsistencias };
}

// --- Privacidad: lo que sale hacia el cliente ---

// Una observacion derivada -> lo que ve quien consulta. LISTA BLANCA de campos: nada de email, secuencia, clientRequestId ni datos tecnicos.
//   - texto: el de una ACTIVA siempre; el de una ANULADA solo para quien puede anular (moderador); para el resto es null (se conserva en la hoja para la auditoria).
//   - nombre: solo el nombre (neutro si falta o parece un email).
//   - anulacion: quien, cuando y por que se anulo (el motivo lo ve cualquiera que pueda leer observaciones).
//   - categoria: reservada: null mientras no exista un catalogo.
function observacionesPozoService_vista(obs, opciones) {
  var moderador = !!opciones && opciones.moderador === true;
  var anulada = obs.estado === OBSERVACIONES_POZO_ESTADOS.ANULADA;
  var motivo = obs.anulacion ? observacionesPozoService_texto(obs.anulacion.motivo) : '';
  return {
    observacionId: obs.observacionId,
    wellId: obs.wellId,
    estado: obs.estado,
    texto: anulada && !moderador ? null : obs.texto,
    categoria: obs.categoria === '' ? null : obs.categoria,
    nombre: observacionesPozoService_nombreVisible(obs.nombre),
    timestamp: obs.timestamp,
    anulacion: anulada ? {
      nombre: observacionesPozoService_nombreVisible(obs.anulacion.nombre),
      timestamp: obs.anulacion.timestamp,
      motivo: motivo === '' ? null : motivo
    } : null
  };
}

// --- Paginacion por cursor (secuencia) ---

// limit: sin valor -> 50; un entero >= 1 (por encima de 100 se acota a 100); cualquier otra cosa -> INVALID_LIMIT.
// antesDeSecuencia: sin valor -> primera pagina; un entero >= 1; cualquier otra cosa -> INVALID_CURSOR.
function observacionesPozoService_normalizarParametros(limit, antesDeSecuencia) {
  var lim = OBSERVACIONES_POZO_LIMITE_DEFECTO;
  if (limit !== undefined && limit !== null) {
    if (typeof limit !== 'number' || !isFinite(limit) || Math.floor(limit) !== limit || limit < 1) {
      return observacionesPozoService_error('INVALID_LIMIT', 'limit debe ser un entero entre 1 y ' + OBSERVACIONES_POZO_LIMITE_MAX);
    }
    lim = Math.min(limit, OBSERVACIONES_POZO_LIMITE_MAX);
  }
  var antes = null;
  if (antesDeSecuencia !== undefined && antesDeSecuencia !== null) {
    if (typeof antesDeSecuencia !== 'number' || !isFinite(antesDeSecuencia) || Math.floor(antesDeSecuencia) !== antesDeSecuencia || antesDeSecuencia < 1) {
      return observacionesPozoService_error('INVALID_CURSOR', 'antesDeSecuencia debe ser un entero >= 1');
    }
    antes = antesDeSecuencia;
  }
  return { ok: true, limit: lim, antes: antes };
}

// observaciones: derivadas, ordenadas por secuencia descendente (sin repetir). Una pagina = las `limit` mas recientes con secuencia < antes. Estable: una observacion nueva tiene una secuencia
// MAYOR, asi que nunca entra en una pagina ya pedida ni desplaza a las de la siguiente (no hay offset). cursor = la secuencia a pasar como antesDeSecuencia, solo si hay mas.
function observacionesPozoService_pagina(observaciones, limit, antes) {
  var candidatas = antes === null ? observaciones : observaciones.filter(function (o) { return o.secuencia < antes; });
  var items = candidatas.slice(0, limit);
  var hayMas = candidatas.length > limit;
  return { items: items, hayMas: hayMas, cursor: hayMas ? items[items.length - 1].secuencia : null };
}

// --- Lectura ---

var OBSERVACIONES_POZO_LOG_MAX_DETALLES = 10;

// Diagnostico tecnico para Logger: el codigo, el pozo consultado (confiable: lo valido el endpoint), los observacionId y las filas / secuencias afectadas. SOLO identificadores: nunca el
// texto, el motivo, el nombre ni el email. Acota la cantidad de detalles para no inundar el log.
function observacionesPozoService_logInconsistencias(wellId, derivado) {
  var lineas = derivado.inconsistencias.slice(0, OBSERVACIONES_POZO_LOG_MAX_DETALLES).map(function (i) {
    return i.codigo + ' ids=[' + i.observacionIds.join(',') + '] filas=[' + i.filas.join(',') + '] secuencias=[' + i.secuencias.join(',') + ']';
  });
  var mas = derivado.inconsistencias.length - lineas.length;
  observacionesPozoService_log('el pozo ' + wellId + ' tiene ' + derivado.inconsistencias.length + ' eventos inconsistentes (se ignoran u ocultan ' + derivado.ocultas.length + ' observaciones ambiguas): ' +
    lineas.join('; ') + (mas > 0 ? '; y ' + mas + ' mas' : ''));
}

// Observaciones de un pozo. NO verifica que el pozo exista (un pozo sin filas devuelve una lista vacia: leer no sirve de oraculo de existencia).
//   parametros: {limit, antesDeSecuencia};  opciones: {moderador} (observaciones_anular, lo decide Api.js).
// Devuelve {ok:true, data:{wellId, total, activas, anuladas, hayMas, cursor, observaciones[]}} o {ok:false, code, message}. total / activas / anuladas son GLOBALES del pozo (no de la pagina)
// y cuentan SOLO las observaciones derivadas sin ambiguedad (las ocultas por inconsistencia no suman): salen de los mismos eventos que ya hubo que leer, asi que no cuestan una lectura
// extra. LANZA si la hoja no se puede leer (Api.js lo traduce).
function observacionesPozoService_getObservaciones(wellId, parametros, opciones) {
  var p = parametros || {};
  var normalizados = observacionesPozoService_normalizarParametros(p.limit, p.antesDeSecuencia);
  if (!normalizados.ok) {
    return normalizados;
  }
  var lectura = observacionesPozoRepository_listarEventosDelPozo(wellId);
  var derivado = observacionesPozoService_derivar(lectura.eventos);
  if (derivado.inconsistencias.length > 0) {
    observacionesPozoService_logInconsistencias(wellId, derivado);
  }
  // solo las del pozo pedido (una alta duplicada bajo otro pozo no se cuela)
  var delPozo = derivado.observaciones.filter(function (o) { return o.wellId === wellId; });
  var activas = delPozo.filter(function (o) { return o.estado === OBSERVACIONES_POZO_ESTADOS.ACTIVA; }).length;
  var pagina = observacionesPozoService_pagina(delPozo, normalizados.limit, normalizados.antes);
  var moderador = !!opciones && opciones.moderador === true;
  return {
    ok: true,
    data: {
      wellId: wellId,
      total: delPozo.length,
      activas: activas,
      anuladas: delPozo.length - activas,
      hayMas: pagina.hayMas,
      cursor: pagina.cursor,
      observaciones: pagina.items.map(function (o) { return observacionesPozoService_vista(o, { moderador: moderador }); })
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OBSERVACIONES_POZO_ESTADOS,
    OBSERVACIONES_POZO_LIMITE_DEFECTO,
    OBSERVACIONES_POZO_LIMITE_MAX,
    OBSERVACIONES_POZO_NOMBRE_NEUTRO,
    OBSERVACIONES_POZO_WELLID_REGEX,
    OBSERVACIONES_POZO_UUID_REGEX,
    observacionesPozoService_nombreVisible,
    observacionesPozoService_derivar,
    observacionesPozoService_vista,
    observacionesPozoService_normalizarParametros,
    observacionesPozoService_pagina,
    observacionesPozoService_getObservaciones
  };
}
