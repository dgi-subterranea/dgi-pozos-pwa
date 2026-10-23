// ObservacionesPozoService: logica de las observaciones generales de un pozo (E5). No sabe nada de HTTP (Api.js) ni de Sheets (ObservacionesPozoRepository.js). LEE (E5-1): deriva el
// estado de cada observacion desde los eventos de la hoja, decide que se le muestra a quien consulta (privacidad de las anuladas) y pagina. AGREGA (E5-2): valida y normaliza el texto,
// verifica la existencia del pozo, es idempotente y escribe una fila ALTA bajo lock. ANULA (E5-3): agrega una fila ANULADA que referencia la ALTA (dueno o moderador, motivo obligatorio,
// idempotente, sin verificar existencia). Nunca se edita ni se borra una fila. Las observaciones son contexto humano y auditable: NO cambian la ubicacion, el estado registral, la evaluacion de reemplazo, las fotos, el ITF ni los NE.
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
//   - puedeAnular (E5-6b): booleano ESTRICTO, solo una SENAL para la interfaz (no reemplaza la autorizacion real de anularObservacionPozo). Lo calcula observacionesPozoService_capacidadAnular
//     con la sesion y los permisos ACTUALES (opciones.sesion = {email, permisos}); sin sesion -> false. No expone el email ni si el usuario es autor o moderador: solo el booleano.
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
    puedeAnular: observacionesPozoService_capacidadAnular(obs, opciones && opciones.sesion),
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
//   parametros: {limit, antesDeSecuencia};  opciones: {moderador (observaciones_anular, lo decide Api.js), sesion: {email, permisos:{observaciones, agregar, anular}} (para puedeAnular)}.
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
      observaciones: pagina.items.map(function (o) { return observacionesPozoService_vista(o, { moderador: moderador, sesion: opciones ? opciones.sesion : undefined }); })
    }
  };
}

// --- Alta (E5-2) ---
//
// agregarObservacionPozo. Orden: validar la entrada (texto, categoria, clientRequestId) -> camino rapido de idempotencia (sin lock) -> EXISTENCIA del pozo -> lock { volver a comprobar
// la idempotencia -> secuencia -> escribir UNA fila ALTA }. email / nombre llegan de la SESION (Api.js); observacionId, timestampUtc y secuencia los genera el servidor: el cliente no
// elige ninguno. Los errores y los logs nunca llevan el texto de la observacion.
var OBSERVACIONES_POZO_TEXTO_MIN = 3;
var OBSERVACIONES_POZO_TEXTO_MAX = 1000;
var OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

// NORMALIZACION del texto (la regla exacta; todo lo demas se conserva tal cual: Unicode, emoji, acentos, espacios internos y lineas en blanco):
//   1. Saltos de linea: CRLF, CR solo, NEL (U+0085), LS (U+2028) y PS (U+2029) pasan a "\n".
//   2. El tabulador pasa a UN espacio (no se borra: no se pegan palabras).
//   3. Se ELIMINAN los caracteres de control incompatibles con texto plano: los C0 salvo "\n" (U+0000-0008, 000B, 000C, 000E-001F), DEL y los C1 (U+007F-0084, 0086-009F), los controles
//      direccionales explicitos que pueden alterar como se ve el texto (U+202A-202E, U+2066-2069) y el BOM / espacio de ancho cero sin separacion (U+FEFF), y los surrogates sueltos (UTF-16
//      invalido). NO se tocan U+200D / U+200C (necesarios en emoji compuestos), los selectores de variacion, ni U+200E / U+200F (marcas de direccion de escrituras RTL).
//   4. Se recortan los extremos (trim). NO se colapsan espacios internos ni saltos de linea.
// El largo se cuenta en CARACTERES UNICOS (code points: un emoji es 1), DESPUES de normalizar. Devuelve el texto normalizado o null si no es un string.
function observacionesPozoService_normalizarTexto(texto) {
  if (typeof texto !== 'string') {
    return null;
  }
  return texto
    .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim();
}

function observacionesPozoService_largoTexto(texto) {
  return Array.from(texto).length;
}

// Valida y normaliza la entrada de un alta: {texto, categoria, clientRequestId}. {ok:true, valores:{texto, categoria, clientRequestId}} o {ok:false, code, message} (sin eco del contenido).
//   - INVALID_TEXTO: ausente, null, no es un string, vacio, solo espacios / controles, menos de 3 o mas de 1000 caracteres (ya normalizado).
//   - INVALID_CATEGORIA: la categoria esta RESERVADA (sin catalogo): solo se admite ausente, null, "" o solo espacios (se normaliza a vacio, igual que el trim del resto de los campos);
//     cualquier otro valor (un texto, un numero, false, 0, un objeto, una lista) se RECHAZA: no se ignora en silencio ni se coacciona.
//   - INVALID_CLIENT_REQUEST_ID: obligatorio, 8 a 64 caracteres: letras, numeros, guion y guion bajo (el mismo patron que correcciones y decisiones).
function observacionesPozoService_validarAlta(datos) {
  var d = datos || {};
  var texto = observacionesPozoService_normalizarTexto(d.texto);
  if (texto === null || texto === '') {
    return observacionesPozoService_error('INVALID_TEXTO', 'el texto de la observacion es obligatorio');
  }
  var largo = observacionesPozoService_largoTexto(texto);
  if (largo < OBSERVACIONES_POZO_TEXTO_MIN) {
    return observacionesPozoService_error('INVALID_TEXTO', 'el texto debe tener al menos ' + OBSERVACIONES_POZO_TEXTO_MIN + ' caracteres');
  }
  if (largo > OBSERVACIONES_POZO_TEXTO_MAX) {
    return observacionesPozoService_error('INVALID_TEXTO', 'el texto admite hasta ' + OBSERVACIONES_POZO_TEXTO_MAX + ' caracteres');
  }
  var c = d.categoria;
  if (c !== undefined && c !== null && !(typeof c === 'string' && c.trim() === '')) {
    return observacionesPozoService_error('INVALID_CATEGORIA', 'las observaciones todavia no admiten categorias');
  }
  if (typeof d.clientRequestId !== 'string' || !OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return observacionesPozoService_error('INVALID_CLIENT_REQUEST_ID', 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)');
  }
  return { ok: true, valores: { texto: texto, categoria: '', clientRequestId: d.clientRequestId } };
}

function observacionesPozoService_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

// Una observacion derivada -> la respuesta de un alta. Mismo contrato que la lectura (sin email, sin secuencia).
function observacionesPozoService_vistaAlta(obs, sesion) {
  return observacionesPozoService_vista(obs, { moderador: false, sesion: sesion });
}

// Ya hay un evento para (usuario, clientRequestId): decide que responder.
//   - mas de una coincidencia, o una que no es una ALTA con un observacionId valido -> INCONSISTENT_STATE (no se elige, no se escribe nada);
//   - un evento de OTRO tipo (p. ej. una anulacion) con ese id -> IDEMPOTENCY_CONFLICT (el id ya se uso para otra cosa);
//   - con otro contenido (wellId, texto normalizado o categoria) -> IDEMPOTENCY_CONFLICT. El timestamp y la secuencia NO cuentan;
//   - mismo contenido -> reenvio idempotente: se devuelve la observacion YA creada (duplicada:true), con su estado de hoy segun el modelo de lectura; NO se escribe otra fila, no se
//     consume otra secuencia y Api.js no vuelve a escribir en Historial. Si el modelo de lectura no la devuelve (ambigua / oculta) -> INCONSISTENT_STATE.
function observacionesPozoService_atenderExistente(busqueda, wellId, valores, sesion) {
  if (busqueda.total !== 1 || busqueda.eventos.length !== 1) {
    return observacionesPozoService_error('INCONSISTENT_STATE', 'el clientRequestId figura mas de una vez: requiere revision manual');
  }
  var e = busqueda.eventos[0];
  if (e.evento !== 'ALTA') {
    return observacionesPozoService_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido');
  }
  if (!OBSERVACIONES_POZO_UUID_REGEX.test(e.observacionId)) {
    return observacionesPozoService_error('INCONSISTENT_STATE', 'la observacion existente no es valida: requiere revision manual');
  }
  if (e.wellId !== wellId || e.texto !== valores.texto || e.categoria !== valores.categoria) {
    return observacionesPozoService_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido');
  }
  var derivado = observacionesPozoService_derivar(observacionesPozoRepository_listarEventosDelPozo(wellId).eventos);
  var obs = null;
  derivado.observaciones.forEach(function (o) { if (o.observacionId === e.observacionId) { obs = o; } });
  if (obs === null) {
    return observacionesPozoService_error('INCONSISTENT_STATE', 'la observacion existente no se puede determinar: requiere revision manual');
  }
  return { ok: true, duplicada: true, observacion: observacionesPozoService_vistaAlta(obs, sesion) };
}

// Agrega una observacion a un pozo. Devuelve {ok:true, duplicada, observacion} o {ok:false, code, message}. LANZA si la hoja no se puede leer / escribir, o si la secuencia no se puede
// calcular con seguridad (Api.js lo traduce a SERVICE_UNAVAILABLE; en ese caso NO se escribio nada). `email` y `nombre` son los de la SESION.
// EXISTENCIA: pozoExistenciaService_verificar (el UNICO lugar que lo decide; no se duplica su logica; las observaciones NO son una de sus fuentes). Solo se escribe si existe;
// WELL_NOT_FOUND si ninguna fuente lo conoce; SERVICE_UNAVAILABLE si no se pudo verificar y ninguna lo confirmo. Un reenvio idempotente se resuelve ANTES: no vuelve a verificar.
// ORDEN dentro del lock: 1) volver a comprobar la idempotencia: si el (usuario, clientRequestId) ya identifica INEQUIVOCAMENTE una ALTA con el mismo contenido, se devuelve (duplicada:true) y
// NO se escribe ni se consume secuencia, aunque la hoja tenga una corrupcion no relacionada; 2) recien si hace falta una NUEVA escritura se valida la integridad GLOBAL de las secuencias
// (ilegibles, <= 0, fraccionarias o repetidas -> SERVICE_UNAVAILABLE sin escribir); 3) max + 1; 4) una sola fila. Si el propio clientRequestId es ambiguo, INCONSISTENT_STATE.
function observacionesPozoService_agregar(email, nombre, wellId, datos, permisos) {
  var validacion = observacionesPozoService_validarAlta(datos);
  if (!validacion.ok) {
    return validacion;
  }
  var valores = validacion.valores;
  var emailN = observacionesPozoService_normalizarEmail(email);
  var sesion = { email: emailN, permisos: permisos };                // para puedeAnular de la respuesta: la MISMA regla que la lectura, con los permisos de hoy

  // camino rapido (sin lock): la solicitud ya se proceso
  var previa = observacionesPozoRepository_buscarPorClientRequestId(emailN, valores.clientRequestId);
  if (previa.total > 0) {
    return observacionesPozoService_atenderExistente(previa, wellId, valores, sesion);
  }

  var existencia = pozoExistenciaService_verificar(wellId);
  if (!existencia.existe) {
    if (existencia.indeterminado) {
      return observacionesPozoService_error('SERVICE_UNAVAILABLE', 'no se pudo verificar si el pozo existe: intenta de nuevo en unos minutos');
    }
    return observacionesPozoService_error('WELL_NOT_FOUND', 'no se encontro el pozo ' + wellId);
  }

  return observacionesPozoRepository_conLock(function () {
    // dentro del lock se vuelve a comprobar: otra ejecucion pudo escribir mientras se esperaba
    var enLock = observacionesPozoRepository_buscarPorClientRequestId(emailN, valores.clientRequestId);
    if (enLock.total > 0) {
      return observacionesPozoService_atenderExistente(enLock, wellId, valores, sesion);
    }
    var escrita = observacionesPozoRepository_agregarAlta({
      observacionId: Utilities.getUuid(),
      wellId: wellId,
      texto: valores.texto,
      email: emailN,
      nombre: observacionesPozoService_texto(nombre),
      timestampUtc: new Date().toISOString(),
      clientRequestId: valores.clientRequestId
    });
    return {
      ok: true,
      duplicada: false,
      observacion: observacionesPozoService_vistaAlta({
        observacionId: escrita.observacionId,
        wellId: escrita.wellId,
        secuencia: escrita.secuencia,
        texto: escrita.texto,
        categoria: '',
        email: escrita.email,
        nombre: escrita.nombre,
        timestamp: escrita.timestampUtc,
        estado: OBSERVACIONES_POZO_ESTADOS.ACTIVA,
        anulacion: null
      }, sesion)
    };
  });
}

// --- Anulacion (E5-3) ---
//
// anularObservacionPozo. Una anulacion NO borra ni edita nada: agrega una fila ANULADA que REFERENCIA la observacion (la ALTA original se conserva para la auditoria). El cliente manda
// SOLO observacionId, motivo y clientRequestId: el wellId sale de la ALTA original (autoridad), el autor y la fecha de la sesion y del servidor. Orden: validar la entrada -> localizar la
// ALTA (inequivoca y derivable) -> AUTORIZAR con los permisos ACTUALES -> idempotencia -> transicion -> lock { repetir todo, integridad de secuencias, max + 1, una fila }.
//   PERMISOS (fail-closed; observaciones SIEMPRE es necesario, y el nombre jamas decide la propiedad):
//     - moderador: observaciones + observaciones_anular -> puede anular la observacion de CUALQUIER autor (incluso si el email historico es invalido);
//     - autor: observaciones + observaciones_agregar Y el email normalizado de la sesion == el email normalizado guardado en la ALTA -> anula la PROPIA. Si no se puede determinar con
//       seguridad que es propia (email vacio, sin forma de email o distinto) NO se trata como propia.
//   La idempotencia NUNCA es un bypass de permisos: un reintento pasa por la misma autorizacion con los permisos de HOY (sin permiso, PERMISSION_DENIED aunque ya haya anulado); y la respuesta de un
//   reintento se RECONSTRUYE con los permisos de hoy (quien no tiene observaciones_anular recibe el texto original en null aunque su primera respuesta lo trajera).
//   NO verifica la existencia del pozo (la ALTA ya la demostro: una observacion existente se puede anular aunque el pozo ya no figure en ninguna fuente).
var OBSERVACIONES_POZO_MOTIVO_MIN = 3;
var OBSERVACIONES_POZO_MOTIVO_MAX = 300;
var OBSERVACIONES_POZO_EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;

// Valida y normaliza la entrada de una anulacion: {observacionId, motivo, clientRequestId}. El motivo usa la MISMA normalizacion que el texto (ver observacionesPozoService_normalizarTexto)
// con largo de 3 a 300 caracteres unicos. {ok:true, valores} o {ok:false, code, message}: INVALID_OBSERVACION_ID / INVALID_MOTIVO / INVALID_CLIENT_REQUEST_ID, sin eco del contenido.
function observacionesPozoService_validarAnulacion(datos) {
  var d = datos || {};
  var id = typeof d.observacionId === 'string' ? d.observacionId.trim().toLowerCase() : '';
  if (!OBSERVACIONES_POZO_UUID_REGEX.test(id)) {
    return observacionesPozoService_error('INVALID_OBSERVACION_ID', 'observacionId invalido');
  }
  var motivo = observacionesPozoService_normalizarTexto(d.motivo);
  if (motivo === null || motivo === '') {
    return observacionesPozoService_error('INVALID_MOTIVO', 'el motivo de la anulacion es obligatorio');
  }
  var largo = observacionesPozoService_largoTexto(motivo);
  if (largo < OBSERVACIONES_POZO_MOTIVO_MIN) {
    return observacionesPozoService_error('INVALID_MOTIVO', 'el motivo debe tener al menos ' + OBSERVACIONES_POZO_MOTIVO_MIN + ' caracteres');
  }
  if (largo > OBSERVACIONES_POZO_MOTIVO_MAX) {
    return observacionesPozoService_error('INVALID_MOTIVO', 'el motivo admite hasta ' + OBSERVACIONES_POZO_MOTIVO_MAX + ' caracteres');
  }
  if (typeof d.clientRequestId !== 'string' || !OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return observacionesPozoService_error('INVALID_CLIENT_REQUEST_ID', 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)');
  }
  return { ok: true, valores: { observacionId: id, motivo: motivo, clientRequestId: d.clientRequestId } };
}

// ¿La observacion es del usuario de la sesion? SOLO por el email normalizado (minuscula, sin espacios): el nombre no cuenta. Si el email de la ALTA o el de la sesion falta o no tiene forma
// de email, NO se puede afirmar que es propia: false.
function observacionesPozoService_esPropia(emailSesion, emailAlta) {
  var a = observacionesPozoService_normalizarEmail(emailSesion);
  var b = observacionesPozoService_normalizarEmail(emailAlta);
  return OBSERVACIONES_POZO_EMAIL_REGEX.test(a) && a === b;                  // iguales y con forma de email: el de la ALTA tambien la tiene
}

// Localiza la observacion objetivo: busca por observacionId, exige UNA sola ALTA inequivoca, toma de ella el wellId y la DERIVA con el modelo de lectura (E5-1). Devuelve
//   {ok:true, wellId, obs} (obs = la derivada, con estado ACTIVA o ANULADA y el email de la ALTA) o {ok:false, code, message, wellId?}:
//   - OBSERVACION_NOT_FOUND: ninguna ALTA lleva ese id (una ANULADA huerfana no es una observacion);
//   - INCONSISTENT_STATE: varias ALTA, demasiadas filas, wellId ilegible, o la observacion no es derivable sin ambiguedad (identidad o secuencia duplicadas, contenido invalido): fail-closed.
function observacionesPozoService_resolverObjetivo(observacionId) {
  var busqueda = observacionesPozoRepository_buscarPorObservacionId(observacionId);
  var altas = busqueda.eventos.filter(function (e) { return e.evento === 'ALTA'; });
  if (altas.length === 0 && busqueda.total === busqueda.eventos.length) {
    return observacionesPozoService_error('OBSERVACION_NOT_FOUND', 'no se encontro la observacion');
  }
  if (busqueda.total > busqueda.eventos.length || altas.length !== 1 || !OBSERVACIONES_POZO_WELLID_REGEX.test(altas[0].wellId)) {
    return observacionesPozoService_error('INCONSISTENT_STATE', 'la observacion tiene un historial inconsistente: requiere revision manual');
  }
  var wellId = altas[0].wellId;
  var derivado = observacionesPozoService_derivar(observacionesPozoRepository_listarEventosDelPozo(wellId).eventos);
  var obs = null;
  derivado.observaciones.forEach(function (o) { if (o.observacionId === observacionId && o.wellId === wellId) { obs = o; } });
  if (obs === null) {
    var r = observacionesPozoService_error('INCONSISTENT_STATE', 'la observacion no se puede determinar sin ambiguedad: requiere revision manual');
    r.wellId = wellId;
    return r;
  }
  return { ok: true, wellId: wellId, obs: obs };
}

// ¿Puede el usuario anular esta observacion? permisos: {observaciones, agregar, anular} (booleanos, solo `=== true`).
function observacionesPozoService_puedeAnular(emailN, permisos, obs) {
  if (permisos.observaciones !== true) {
    return false;
  }
  if (permisos.anular === true) {
    return true;
  }
  return permisos.agregar === true && observacionesPozoService_esPropia(emailN, obs.email);
}

// puedeAnular (E5-6b): ¿puede la sesion anular ESTA observacion? Solo una ACTIVA y con la MISMA regla que usa anularObservacionPozo para autorizar (observacionesPozoService_puedeAnular):
// observaciones === true Y (observaciones_anular === true, o observaciones_agregar === true con el email normalizado de la sesion igual al de la ALTA). Booleano estricto; ANULADA, sin sesion,
// sin permisos o con valores no booleanos -> false. Nunca usa el nombre. Es solo una senal para la interfaz: la autorizacion real se vuelve a decidir al anular.
function observacionesPozoService_capacidadAnular(obs, sesion) {
  if (!obs || obs.estado !== OBSERVACIONES_POZO_ESTADOS.ACTIVA || !sesion || !sesion.permisos) {
    return false;
  }
  return observacionesPozoService_puedeAnular(sesion.email, sesion.permisos, obs) === true;                 // esPropia normaliza los dos emails
}

// La observacion derivada con su estado de HOY -> la respuesta, con los permisos de HOY: el texto original solo para quien tiene observaciones_anular (tambien el autor sin ese permiso lo recibe
// en null: no hay excepcion por autoria). puedeAnular se recalcula con la sesion de HOY (una anulada siempre false).
function observacionesPozoService_vistaAnulacion(obs, permisos, emailN) {
  return observacionesPozoService_vista(obs, { moderador: permisos.anular === true, sesion: { email: emailN, permisos: permisos } });
}

// Ya hay un evento para (usuario, clientRequestId): {ok:true, duplicada:true, ...} si es EXACTAMENTE esta misma anulacion; si no, conflicto.
//   - mas de una coincidencia -> INCONSISTENT_STATE (no se elige);
//   - un evento que no es una ANULADA (p. ej. una ALTA), de otra observacion o con otro motivo -> IDEMPOTENCY_CONFLICT;
//   - la misma anulacion -> duplicada:true con la observacion en su estado de hoy. Una anulacion que referencia a la observacion SIEMPRE la deja ANULADA en el modelo de lectura (y si la
//     colision de secuencias la oculta, el objetivo ya fallo antes de llegar aca): no hay un caso "existe la anulacion pero la observacion figura activa", asi que no se comprueba.
function observacionesPozoService_atenderAnulacionExistente(busqueda, objetivo, valores, permisos, emailN) {
  if (busqueda.total !== 1 || busqueda.eventos.length !== 1) {
    return observacionesPozoService_error('INCONSISTENT_STATE', 'el clientRequestId figura mas de una vez: requiere revision manual');
  }
  var e = busqueda.eventos[0];
  if (e.evento !== 'ANULADA' || e.observacionId !== valores.observacionId || e.motivo !== valores.motivo) {
    var c = observacionesPozoService_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido');
    c.wellId = objetivo.wellId;
    return c;
  }
  return { ok: true, duplicada: true, wellId: objetivo.wellId, observacion: observacionesPozoService_vistaAnulacion(objetivo.obs, permisos, emailN) };
}

// Rechazo de autorizacion de quien NO es moderador: SIEMPRE el mismo codigo y el mismo mensaje hacia afuera, sea cual sea la causa (el id no existe, es ajena, no se puede verificar la propiedad
// o la observacion no es derivable), para que el endpoint no sirva de oraculo de observacionId. La causa tecnica va a Logger como etiqueta fija (jamas texto, motivo, email ni nombre).
function observacionesPozoService_denegar(wellId, causa) {
  observacionesPozoService_log('anulacion denegada (' + causa + ')');
  var d = observacionesPozoService_error('PERMISSION_DENIED', 'no podes anular esta observacion');
  if (wellId) {
    d.wellId = wellId;                                                   // solo para el Historial interno; la respuesta no lo lleva
  }
  return d;
}

// Una pasada de decision (fuera del lock y otra vez dentro): objetivo -> autorizacion (permisos de hoy) -> idempotencia -> transicion. Devuelve un error, un reintento valido
// ({ok:true, duplicada:true}) o {ok:true, escribir:true, objetivo}. La idempotencia va DESPUES de la autorizacion (nunca un bypass) y ANTES de la transicion (un reintento de una anulacion ya
// hecha no es "ya anulada").
// MODERADOR (observaciones_anular): ve el estado real del objetivo (OBSERVACION_NOT_FOUND / INCONSISTENT_STATE). QUIEN SOLO ANULA LO PROPIO (agregar): el objetivo se resuelve internamente
// para comprobar la propiedad, pero hacia afuera todo lo que no sea "propia e inequivoca" (inexistente, ajena, email historico no verificable, ambigua) es PERMISSION_DENIED (fail-closed).
function observacionesPozoService_decidirAnulacion(emailN, permisos, valores) {
  var moderador = permisos.anular === true;
  var objetivo = observacionesPozoService_resolverObjetivo(valores.observacionId);
  if (!objetivo.ok) {
    return moderador ? objetivo : observacionesPozoService_denegar(objetivo.wellId, objetivo.code === 'OBSERVACION_NOT_FOUND' ? 'NO_ENCONTRADA' : 'NO_DERIVABLE');
  }
  if (!observacionesPozoService_puedeAnular(emailN, permisos, objetivo.obs)) {
    return observacionesPozoService_denegar(objetivo.wellId, OBSERVACIONES_POZO_EMAIL_REGEX.test(observacionesPozoService_normalizarEmail(objetivo.obs.email)) ? 'AJENA' : 'PROPIEDAD_NO_VERIFICABLE');
  }
  var previa = observacionesPozoRepository_buscarPorClientRequestId(emailN, valores.clientRequestId);
  if (previa.total > 0) {
    return observacionesPozoService_atenderAnulacionExistente(previa, objetivo, valores, permisos, emailN);
  }
  if (objetivo.obs.estado === OBSERVACIONES_POZO_ESTADOS.ANULADA) {
    var t = observacionesPozoService_error('INVALID_TRANSITION', 'la observacion ya esta anulada');
    t.wellId = objetivo.wellId;
    return t;
  }
  return { ok: true, escribir: true, objetivo: objetivo };
}

// Anula una observacion. `email` / `nombre` son los de la SESION; `permisos`: {observaciones, agregar, anular} (booleanos que decide Api.js). Devuelve {ok:true, duplicada, wellId, observacion}
// o {ok:false, code, message, wellId?} (wellId solo si ya se conocia, para el Historial). LANZA si la hoja no se puede leer / escribir o si la secuencia no se puede calcular con seguridad
// (Api.js lo traduce a SERVICE_UNAVAILABLE; en ese caso NO se escribio nada).
// Doble anulacion: una observacion ya anulada -> INVALID_TRANSITION (salvo el reintento de esa misma anulacion); dos anulaciones simultaneas: solo escribe la primera en tomar el lock, la otra
// relee dentro del lock, ve la transicion y falla. Orden dentro del lock: repetir objetivo / autorizacion / idempotencia; reintento valido -> devolver sin escribir; recien si hace falta escribir, la
// integridad global de las secuencias (SERVICE_UNAVAILABLE sin escribir) -> max + 1 -> una sola fila ANULADA.
function observacionesPozoService_anular(email, nombre, datos, permisos) {
  var p = permisos || {};
  if (p.observaciones !== true || (p.anular !== true && p.agregar !== true)) {
    return observacionesPozoService_error('PERMISSION_DENIED', 'sin permiso para anular observaciones');
  }
  var validacion = observacionesPozoService_validarAnulacion(datos);
  if (!validacion.ok) {
    return validacion;
  }
  var valores = validacion.valores;
  var emailN = observacionesPozoService_normalizarEmail(email);

  var primera = observacionesPozoService_decidirAnulacion(emailN, p, valores);
  if (primera.ok !== true || primera.escribir !== true) {
    return primera;
  }

  return observacionesPozoRepository_conLock(function () {
    // dentro del lock se vuelve a decidir: otra ejecucion pudo anularla, escribir este mismo pedido o cambiar el estado mientras se esperaba
    var enLock = observacionesPozoService_decidirAnulacion(emailN, p, valores);
    if (enLock.ok !== true || enLock.escribir !== true) {
      return enLock;
    }
    var objetivo = enLock.objetivo;
    var escrita = observacionesPozoRepository_agregarAnulada({
      observacionId: objetivo.obs.observacionId,
      wellId: objetivo.wellId,                                        // el wellId sale de la ALTA original, nunca del cliente
      motivo: valores.motivo,
      email: emailN,
      nombre: observacionesPozoService_texto(nombre),
      timestampUtc: new Date().toISOString(),
      clientRequestId: valores.clientRequestId
    });
    var anulada = Object.assign({}, objetivo.obs, {
      estado: OBSERVACIONES_POZO_ESTADOS.ANULADA,
      anulacion: { nombre: escrita.nombre, timestamp: escrita.timestampUtc, motivo: escrita.motivo }
    });
    return { ok: true, duplicada: false, wellId: objetivo.wellId, observacion: observacionesPozoService_vistaAnulacion(anulada, p, emailN) };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OBSERVACIONES_POZO_ESTADOS,
    OBSERVACIONES_POZO_MOTIVO_MIN,
    OBSERVACIONES_POZO_MOTIVO_MAX,
    observacionesPozoService_validarAnulacion,
    observacionesPozoService_esPropia,
    observacionesPozoService_resolverObjetivo,
    observacionesPozoService_puedeAnular,
    observacionesPozoService_capacidadAnular,
    observacionesPozoService_decidirAnulacion,
    observacionesPozoService_anular,
    OBSERVACIONES_POZO_TEXTO_MIN,
    OBSERVACIONES_POZO_TEXTO_MAX,
    OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX,
    observacionesPozoService_normalizarTexto,
    observacionesPozoService_largoTexto,
    observacionesPozoService_validarAlta,
    observacionesPozoService_normalizarEmail,
    observacionesPozoService_atenderExistente,
    observacionesPozoService_agregar,
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
