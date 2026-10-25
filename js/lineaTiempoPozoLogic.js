// Modelo PURO de la "Linea de tiempo del pozo" (E6-1): convierte los payloads YA AUTORIZADOS que devuelven los endpoints de lectura de Ubicacion, Reemplazo y Observaciones en una lista
// unica de eventos comparables (normalizar, validar, deduplicar, ordenar, filtrar). Sin DOM, sin red, sin API, sin controladores, sin dependencias de otros archivos: se prueba con Jest
// (js/lineaTiempoPozoLogic.test.js). La carga por fuente y la pantalla son etapas posteriores (E6-2 / E6-3).
//
// FUENTES (inventario de contratos y decisiones: docs/linea-tiempo-pozo.md):
//   UBICACION       getCorreccionesUbicacionPozo (historial[]) + getDecisionesFuentesPozo (historial[]), ambos con el permiso `ubicacion`.
//   REEMPLAZO       getHistorialReemplazo (evaluaciones[]), permiso `reemplazo`.
//   OBSERVACIONES   getObservacionesPozo (observaciones[], paginado), permiso `observaciones`.
//   FOTOS           NO esta en v1: getFotosPozo no devuelve fecha de alta (timestampRegistro) ni autor; solo la fecha de la FOTO (parcial, a veces desconocida). Un FOTO_AGREGADA no se puede demostrar.
//   Sugerencias de fuente: tampoco (su vista depende de QUIEN pregunta: el no validador ve solo las suyas, el validador solo las pendientes), asi que no formarian un historial coherente.
//
// REGLA CENTRAL DE PRIVACIDAD: la linea de tiempo NUNCA muestra mas que el modulo fuente. Cada evento se construye con una LISTA BLANCA a partir del payload autorizado: no se copia ningun
// objeto crudo, y todo lo demas (email, clientRequestId, secuencia, sessionToken, ids de Drive, coordenadas, textos que el backend oculta, campos desconocidos) se descarta aca. Una
// observacion ANULADA nunca conserva su texto, lo mande o no el payload (el backend lo manda null a quien no modera). Nada se reconstruye desde caches ni desde otro objeto.
//
// EVENTOS vs ESTADO: solo se emiten hechos que el payload permite demostrar. Un estado derivado no se convierte en evento. Ejemplo: una correccion SUPERADA o REVERTIDA paso por VALIDADA,
// pero el payload solo trae el ultimo evento: el instante de esa VALIDADA no se conoce, asi que NO se fabrica un UBICACION_VALIDADA (si se emiten la propuesta y el evento terminal).
//
// FECHAS: unica via lineaTiempoPozoLogic_normalizarTimestamp. Acepta solo ISO 8601 con zona EXPLICITA (Z u offset) y la lleva a UTC canonico `AAAA-MM-DDTHH:MM:SS.mmmZ` (ancho fijo, asi que
// comparar los strings es comparar los instantes). Sin zona, con espacio en vez de T, numeros, Date, anios fuera de 2000..2100 o fechas imposibles: invalido (nunca se adivina la zona).
// Un evento sin fecha valida se OMITE (queda contado en `omitidos`); no se inventa ninguna fecha.
//
// ORDEN: mas reciente primero. Empates: rango causal del tipo (p. ej. VALIDADA antes que PROPUESTA en el mismo instante), fuente, tipo y por ultimo id DESCENDENTE. No depende del orden de llegada.
//
// FALLOS PARCIALES: una fuente no permitida, vacia o caida no invalida la linea de tiempo; lineaTiempoPozoLogic_armar devuelve el estado de cada fuente y los eventos de las demas.
//
// Compatibilidad: ES5 (sin lookbehind ni sintaxis nueva, como el resto del frontend); Array.from solo para contar code points, igual que observacionesPozoLogic.js.

var LINEA_TIEMPO_FUENTES = { UBICACION: 'UBICACION', REEMPLAZO: 'REEMPLAZO', OBSERVACIONES: 'OBSERVACIONES' };
var LINEA_TIEMPO_ORDEN_FUENTES = ['UBICACION', 'REEMPLAZO', 'OBSERVACIONES'];

// Catalogo de tipos: fuente, titulo FIJO (nunca lleva datos) y rango causal para desempatar eventos del mismo instante (mayor = ocurre despues; en la lista va primero).
//   Ubicacion: una autovalidacion escribe PROPUESTA -> [SUPERADA de la anterior] -> VALIDADA en el mismo instante.
var LINEA_TIEMPO_TIPOS = {
  UBICACION_PROPUESTA: { fuente: 'UBICACION', titulo: 'Ubicación propuesta', rango: 0 },
  UBICACION_RECHAZADA: { fuente: 'UBICACION', titulo: 'Ubicación rechazada', rango: 1 },
  UBICACION_SUPERADA: { fuente: 'UBICACION', titulo: 'Ubicación reemplazada por otra posterior', rango: 1 },
  UBICACION_REVERTIDA: { fuente: 'UBICACION', titulo: 'Ubicación revertida', rango: 1 },
  UBICACION_VALIDADA: { fuente: 'UBICACION', titulo: 'Ubicación validada en campo', rango: 2 },
  FUENTE_ACEPTADA: { fuente: 'UBICACION', titulo: 'Fuente de ubicación aceptada', rango: 0 },
  FUENTE_DESCARTADA: { fuente: 'UBICACION', titulo: 'Fuente de ubicación descartada', rango: 0 },
  FUENTE_ACEPTACION_QUITADA: { fuente: 'UBICACION', titulo: 'Aceptación de fuente quitada', rango: 0 },
  FUENTE_RESTAURADA: { fuente: 'UBICACION', titulo: 'Fuente de ubicación restaurada', rango: 0 },
  REEMPLAZO_APTO: { fuente: 'REEMPLAZO', titulo: 'Evaluación de reemplazo: apto', rango: 0 },
  REEMPLAZO_NO_APTO: { fuente: 'REEMPLAZO', titulo: 'Evaluación de reemplazo: no apto', rango: 0 },
  REEMPLAZO_DUDOSO: { fuente: 'REEMPLAZO', titulo: 'Evaluación de reemplazo: dudoso', rango: 0 },
  OBSERVACION_AGREGADA: { fuente: 'OBSERVACIONES', titulo: 'Observación agregada', rango: 0 },
  OBSERVACION_ANULADA: { fuente: 'OBSERVACIONES', titulo: 'Observación anulada', rango: 1 }
};

// Estados posibles de cada fuente en un armado: OK (hay eventos), VACIA (llego bien pero sin eventos), SIN_PERMISO (el usuario no la ve: no es un fallo), ERROR (fallo o payload mal formado),
// NO_CARGADA (todavia no se pidio / no hay dato).
var LINEA_TIEMPO_ESTADOS_FUENTE = { OK: 'OK', VACIA: 'VACIA', SIN_PERMISO: 'SIN_PERMISO', ERROR: 'ERROR', NO_CARGADA: 'NO_CARGADA' };

var LINEA_TIEMPO_ANIO_MIN = 2000;
var LINEA_TIEMPO_ANIO_MAX = 2100;
var LINEA_TIEMPO_DETALLE_MAX = 140;
var LINEA_TIEMPO_NOMBRE_MAX = 80;
var LINEA_TIEMPO_NOMBRE_NEUTRO = 'Usuario';

var LINEA_TIEMPO_REGEX_WELL_ID = /^\d{2}-\d{4}$/;
var LINEA_TIEMPO_REGEX_ID = /^[A-Za-z0-9_-]{8,64}$/;
var LINEA_TIEMPO_REGEX_CODIGO = /^[A-Z][A-Z0-9_]{0,39}$/;
var LINEA_TIEMPO_REGEX_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/;

var LINEA_TIEMPO_METODOS_UBICACION = ['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2'];
var LINEA_TIEMPO_ESTADOS_CORRECCION = ['PROPUESTA', 'VALIDADA', 'RECHAZADA', 'SUPERADA', 'REVERTIDA'];
var LINEA_TIEMPO_TIPO_POR_RESOLUCION = { VALIDADA: 'UBICACION_VALIDADA', RECHAZADA: 'UBICACION_RECHAZADA', SUPERADA: 'UBICACION_SUPERADA', REVERTIDA: 'UBICACION_REVERTIDA' };
var LINEA_TIEMPO_TIPO_POR_DECISION = { ACEPTADA: 'FUENTE_ACEPTADA', DESCARTADA: 'FUENTE_DESCARTADA', ACEPTACION_QUITADA: 'FUENTE_ACEPTACION_QUITADA', RESTAURADA: 'FUENTE_RESTAURADA' };
var LINEA_TIEMPO_FUENTES_PADRON = ['REPORTE_POZOS', 'IRRIGACION'];
var LINEA_TIEMPO_TIPO_POR_EVALUACION = { APTO: 'REEMPLAZO_APTO', NO_APTO: 'REEMPLAZO_NO_APTO', DUDOSO: 'REEMPLAZO_DUDOSO' };
var LINEA_TIEMPO_ESTADOS_OBSERVACION = ['ACTIVA', 'ANULADA'];

// Claves permitidas de `metadata` por tipo (lista blanca; todo lo demas, rechazado por lineaTiempoPozoLogic_esEventoValido).
var LINEA_TIEMPO_METADATA_PERMITIDA = {
  UBICACION_PROPUESTA: ['metodo'],
  UBICACION_VALIDADA: ['primeraUbicacion'],
  FUENTE_ACEPTADA: ['fuenteTipo', 'obsoleta'],
  FUENTE_DESCARTADA: ['fuenteTipo', 'obsoleta'],
  FUENTE_ACEPTACION_QUITADA: ['fuenteTipo', 'obsoleta'],
  FUENTE_RESTAURADA: ['fuenteTipo', 'obsoleta'],
  REEMPLAZO_APTO: ['motivo'],
  REEMPLAZO_NO_APTO: ['motivo'],
  REEMPLAZO_DUDOSO: ['motivo']
};

function lineaTiempoPozoLogic_tieneClave(objeto, clave) {
  return Object.prototype.hasOwnProperty.call(objeto, clave);
}

function lineaTiempoPozoLogic_esObjeto(valor) {
  return valor !== null && typeof valor === 'object' && !Array.isArray(valor);
}

function lineaTiempoPozoLogic_enLista(lista, valor) {
  return typeof valor === 'string' && lista.indexOf(valor) !== -1;
}

// --- Fechas ---

// ISO 8601 con zona explicita -> `AAAA-MM-DDTHH:MM:SS.mmmZ` (UTC) o null. Valida el calendario (31 de febrero, hora 24, minuto 60 y segundo 60 son invalidos) y el rango de anios.
function lineaTiempoPozoLogic_normalizarTimestamp(valor) {
  if (typeof valor !== 'string') {
    return null;
  }
  var m = LINEA_TIEMPO_REGEX_TIMESTAMP.exec(valor);
  if (!m) {
    return null;
  }
  var anio = parseInt(m[1], 10);
  var mes = parseInt(m[2], 10);
  var dia = parseInt(m[3], 10);
  var hora = parseInt(m[4], 10);
  var minuto = parseInt(m[5], 10);
  var segundo = parseInt(m[6], 10);
  var ms = m[7] ? parseInt((m[7] + '00').slice(0, 3), 10) : 0;
  if (mes < 1 || mes > 12 || minuto > 59 || segundo > 59) {
    return null;
  }
  // Date.UTC desborda lo imposible (31 de febrero, hora 24, anios 0..99 que toma como 19xx): si el calendario no vuelve identico, la fecha era invalida. El rango de anios se
  // controla una sola vez, sobre el instante FINAL (ya con el offset aplicado).
  var base = new Date(Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms));
  if (base.getUTCFullYear() !== anio || base.getUTCMonth() !== mes - 1 || base.getUTCDate() !== dia) {
    return null;
  }
  var desplazamiento = 0;
  if (m[8] !== 'Z') {
    var oh = parseInt(m[8].slice(1, 3), 10);
    var om = parseInt(m[8].slice(4, 6), 10);
    if (oh > 23 || om > 59) {
      return null;
    }
    desplazamiento = (m[8].charAt(0) === '-' ? -1 : 1) * (oh * 60 + om);
  }
  var instante = base.getTime() - desplazamiento * 60000;
  var salida = new Date(instante);
  var anioSalida = salida.getUTCFullYear();
  if (anioSalida < LINEA_TIEMPO_ANIO_MIN || anioSalida > LINEA_TIEMPO_ANIO_MAX) {
    return null;
  }
  return salida.toISOString();
}

// --- Texto ---

// Quita los surrogates sueltos (UTF-16 invalido) y conserva los pares validos (sin lookbehind: error de sintaxis en Safari < 16.4).
function lineaTiempoPozoLogic_sinSurrogatesSueltos(s) {
  var salida = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      var n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n >= 0xDC00 && n <= 0xDFFF) {
        salida += s.charAt(i) + s.charAt(i + 1);
        i += 1;
      }
    } else if (c < 0xDC00 || c > 0xDFFF) {
      salida += s.charAt(i);
    }
  }
  return salida;
}

// Texto libre de la fuente -> extracto de UNA linea (espacios y saltos colapsados, sin caracteres de control ni de direccion, sin surrogates sueltos, maximo `maximo` code points con "…")
// o null si queda vacio / no es un string. NO escapa HTML: el valor es texto plano y la interfaz debe mostrarlo con textContent (o escapar), como en las demas pantallas.
function lineaTiempoPozoLogic_limpiarTexto(valor, maximo) {
  if (typeof valor !== 'string') {
    return null;
  }
  var limite = typeof maximo === 'number' && maximo >= 2 ? Math.floor(maximo) : LINEA_TIEMPO_DETALLE_MAX;
  var texto = lineaTiempoPozoLogic_sinSurrogatesSueltos(valor)
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\s\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
    .replace(/ {2,}/g, ' ')
    .replace(/^ +| +$/g, '');
  if (texto === '') {
    return null;
  }
  var puntos = Array.from(texto);
  if (puntos.length > limite) {
    return puntos.slice(0, limite - 1).join('').replace(/ +$/, '') + '…';
  }
  return texto;
}

// Nombre visible de quien actuo: igual que las fuentes, vacio o con "@" (un email colado en el nombre) se muestra como el neutro "Usuario".
function lineaTiempoPozoLogic_nombreVisible(valor) {
  var nombre = lineaTiempoPozoLogic_limpiarTexto(valor, LINEA_TIEMPO_NOMBRE_MAX);
  return nombre === null || nombre.indexOf('@') !== -1 ? LINEA_TIEMPO_NOMBRE_NEUTRO : nombre;
}

// --- Construccion de eventos (lista blanca) ---

function lineaTiempoPozoLogic_crearEvento(id, tipo, timestamp, nombre, detalle, estado, metadata) {
  var definicion = LINEA_TIEMPO_TIPOS[tipo];
  return {
    id: id,
    fuente: definicion.fuente,
    tipo: tipo,
    timestamp: timestamp,
    nombre: lineaTiempoPozoLogic_nombreVisible(nombre),
    titulo: definicion.titulo,
    detalle: lineaTiempoPozoLogic_limpiarTexto(detalle, LINEA_TIEMPO_DETALLE_MAX),
    estado: estado === undefined ? null : estado,
    metadata: metadata || {}
  };
}

// Contador de omitidos por codigo -> [{codigo, cantidad}] ordenado por codigo (determinista).
function lineaTiempoPozoLogic_contarOmitidos(codigos) {
  var cuenta = {};
  codigos.forEach(function (c) { cuenta[c] = (cuenta[c] || 0) + 1; });
  return Object.keys(cuenta).sort().map(function (c) { return { codigo: c, cantidad: cuenta[c] }; });
}

// Valida el payload de una fuente: objeto, `wellId` pedido y devuelto coinciden (si el payload lo trae), y la lista pedida es un array. null = valido; si no, el codigo del problema.
function lineaTiempoPozoLogic_problemaDePayload(data, wellId, clave) {
  if (typeof wellId !== 'string' || !LINEA_TIEMPO_REGEX_WELL_ID.test(wellId)) {
    return 'WELL_ID_INVALIDO';
  }
  if (!lineaTiempoPozoLogic_esObjeto(data) || !Array.isArray(data[clave])) {
    return 'PAYLOAD_INVALIDO';
  }
  if (data.wellId !== undefined && data.wellId !== wellId) {
    return 'WELL_ID_DISTINTO';
  }
  return null;
}

function lineaTiempoPozoLogic_resultadoFallido(codigo) {
  return { ok: false, eventos: [], omitidos: [{ codigo: codigo, cantidad: 1 }] };
}

// --- Ubicacion: correcciones (UbicacionCorrecciones) ---
// Fuente: getCorreccionesUbicacionPozo -> {wellId, vigente, pendientes, historial}. SOLO `historial` (lista completa de correcciones del pozo; `vigente` y `pendientes` son subconjuntos de ella).
// Cada correccion aporta UBICACION_PROPUESTA (instante de la propuesta) y, si ya se resolvio, un evento terminal con el instante del ULTIMO evento (`resolucion`). Una autovalidacion produce
// los dos. El payload no trae el instante de una VALIDADA posterior superada o revertida: ese hecho no se emite.
function lineaTiempoPozoLogic_normalizarCorrecciones(data, wellId) {
  var problema = lineaTiempoPozoLogic_problemaDePayload(data, wellId, 'historial');
  if (problema) {
    return lineaTiempoPozoLogic_resultadoFallido(problema);
  }
  var eventos = [];
  var omitidos = [];
  data.historial.forEach(function (c) {
    if (!lineaTiempoPozoLogic_esObjeto(c) || typeof c.correccionId !== 'string' || !LINEA_TIEMPO_REGEX_ID.test(c.correccionId)) {
      omitidos.push('ITEM_INVALIDO');
      return;
    }
    if (c.wellId !== wellId) {
      omitidos.push('WELL_ID_DISTINTO');
      return;
    }
    if (c.estado === 'INCONSISTENTE') {
      omitidos.push('ESTADO_INCONSISTENTE');
      return;
    }
    if (!lineaTiempoPozoLogic_enLista(LINEA_TIEMPO_ESTADOS_CORRECCION, c.estado)) {
      omitidos.push('ESTADO_DESCONOCIDO');
      return;
    }
    var propuesta = lineaTiempoPozoLogic_normalizarTimestamp(c.timestamp);
    if (propuesta === null) {
      omitidos.push('TIMESTAMP_INVALIDO');
    } else {
      var metodo = lineaTiempoPozoLogic_enLista(LINEA_TIEMPO_METODOS_UBICACION, c.metodo) ? c.metodo : null;
      eventos.push(lineaTiempoPozoLogic_crearEvento('UBICACION:' + c.correccionId + ':PROPUESTA', 'UBICACION_PROPUESTA', propuesta, c.nombrePropone, c.observacion, c.estado, { metodo: metodo }));
    }
    if (c.estado === 'PROPUESTA') {
      if (c.resolucion !== null && c.resolucion !== undefined) {
        omitidos.push('RESOLUCION_INCONSISTENTE');
      }
      return;
    }
    var r = c.resolucion;
    if (!lineaTiempoPozoLogic_esObjeto(r) || r.evento !== c.estado) {
      omitidos.push('RESOLUCION_INCONSISTENTE');
      return;
    }
    var instante = lineaTiempoPozoLogic_normalizarTimestamp(r.timestamp);
    if (instante === null) {
      omitidos.push('TIMESTAMP_INVALIDO');
      return;
    }
    var metadata = c.estado === 'VALIDADA' && c.primeraUbicacion === true ? { primeraUbicacion: true } : {};
    eventos.push(lineaTiempoPozoLogic_crearEvento('UBICACION:' + c.correccionId + ':' + c.estado, LINEA_TIEMPO_TIPO_POR_RESOLUCION[c.estado], instante, r.nombre, r.motivo, c.estado, metadata));
  });
  return { ok: true, eventos: eventos, omitidos: lineaTiempoPozoLogic_contarOmitidos(omitidos) };
}

// --- Ubicacion: decisiones sobre fuentes (UbicacionFuenteDecisiones) ---
// Fuente: getDecisionesFuentesPozo -> {wellId, integro, historial[]...}: `historial` YA es un evento por fila (append-only). Si el log del pozo no es integro el backend devuelve historial vacio
// y NINGUNA decision aplica: no hay eventos que mostrar (se informa como omitido HISTORIAL_NO_INTEGRO). La coordenada de la fuente (x, y) no se copia.
function lineaTiempoPozoLogic_normalizarDecisiones(data, wellId) {
  var problema = lineaTiempoPozoLogic_problemaDePayload(data, wellId, 'historial');
  if (problema) {
    return lineaTiempoPozoLogic_resultadoFallido(problema);
  }
  if (data.integro !== true) {
    return { ok: true, eventos: [], omitidos: [{ codigo: 'HISTORIAL_NO_INTEGRO', cantidad: 1 }] };
  }
  var eventos = [];
  var omitidos = [];
  data.historial.forEach(function (h) {
    if (!lineaTiempoPozoLogic_esObjeto(h) || typeof h.secuencia !== 'number' || Math.floor(h.secuencia) !== h.secuencia || h.secuencia < 1 || h.secuencia > 999999999) {
      omitidos.push('ITEM_INVALIDO');
      return;
    }
    if (!lineaTiempoPozoLogic_tieneClave(LINEA_TIEMPO_TIPO_POR_DECISION, h.evento)) {
      omitidos.push('EVENTO_DESCONOCIDO');
      return;
    }
    var instante = lineaTiempoPozoLogic_normalizarTimestamp(h.timestampUtc);
    if (instante === null) {
      omitidos.push('TIMESTAMP_INVALIDO');
      return;
    }
    var metadata = { fuenteTipo: lineaTiempoPozoLogic_enLista(LINEA_TIEMPO_FUENTES_PADRON, h.fuenteTipo) ? h.fuenteTipo : null };
    if (h.obsoleta === true) {
      metadata.obsoleta = true;
    }
    var id = 'DECISION:' + wellId + ':' + ('000000000' + h.secuencia).slice(-9);
    eventos.push(lineaTiempoPozoLogic_crearEvento(id, LINEA_TIEMPO_TIPO_POR_DECISION[h.evento], instante, h.nombre, h.motivo, null, metadata));
  });
  return { ok: true, eventos: eventos, omitidos: lineaTiempoPozoLogic_contarOmitidos(omitidos) };
}

// --- Reemplazo ---
// Fuente: getHistorialReemplazo -> {wellId, evaluaciones[]}: una fila = una evaluacion (append-only). El estado vigente es la ultima y NO se emite aparte. El motivo es un codigo del catalogo
// (la interfaz lo etiqueta); la observacion libre sale como `detalle` (extracto). El punto NE de referencia no se copia.
function lineaTiempoPozoLogic_normalizarReemplazo(data, wellId) {
  var problema = lineaTiempoPozoLogic_problemaDePayload(data, wellId, 'evaluaciones');
  if (problema) {
    return lineaTiempoPozoLogic_resultadoFallido(problema);
  }
  var eventos = [];
  var omitidos = [];
  data.evaluaciones.forEach(function (ev) {
    if (!lineaTiempoPozoLogic_esObjeto(ev)) {
      omitidos.push('ITEM_INVALIDO');
      return;
    }
    if (ev.wellId !== wellId) {
      omitidos.push('WELL_ID_DISTINTO');
      return;
    }
    if (!lineaTiempoPozoLogic_tieneClave(LINEA_TIEMPO_TIPO_POR_EVALUACION, ev.estado)) {
      omitidos.push('ESTADO_DESCONOCIDO');
      return;
    }
    var instante = lineaTiempoPozoLogic_normalizarTimestamp(ev.timestamp);
    if (instante === null) {
      omitidos.push('TIMESTAMP_INVALIDO');
      return;
    }
    // sin evaluacionId usable, clave determinista con campos estables (pozo, instante, estado): sin texto libre ni indices
    var id = typeof ev.evaluacionId === 'string' && LINEA_TIEMPO_REGEX_ID.test(ev.evaluacionId)
      ? 'REEMPLAZO:' + ev.evaluacionId
      : 'REEMPLAZO:' + wellId + ':' + instante + ':' + ev.estado;
    var motivo = typeof ev.motivo === 'string' && LINEA_TIEMPO_REGEX_CODIGO.test(ev.motivo) ? ev.motivo : null;
    eventos.push(lineaTiempoPozoLogic_crearEvento(id, LINEA_TIEMPO_TIPO_POR_EVALUACION[ev.estado], instante, ev.nombre, ev.observacion, ev.estado, { motivo: motivo }));
  });
  return { ok: true, eventos: eventos, omitidos: lineaTiempoPozoLogic_contarOmitidos(omitidos) };
}

// --- Observaciones ---
// Fuente: getObservacionesPozo -> {wellId, ..., observaciones[]} (una PAGINA). Cada observacion aporta OBSERVACION_AGREGADA y, si esta ANULADA, OBSERVACION_ANULADA (con el instante, el nombre y el
// motivo de la anulacion). El texto de la observacion solo se conserva si esta ACTIVA: en una ANULADA se descarta SIEMPRE, aunque el payload lo traiga (un moderador lo recibe; la linea
// de tiempo es un subconjunto estricto de lo que muestra el modulo). Sin secuencia, sin categoria, sin puedeAnular.
function lineaTiempoPozoLogic_normalizarObservaciones(data, wellId) {
  var problema = lineaTiempoPozoLogic_problemaDePayload(data, wellId, 'observaciones');
  if (problema) {
    return lineaTiempoPozoLogic_resultadoFallido(problema);
  }
  var eventos = [];
  var omitidos = [];
  data.observaciones.forEach(function (o) {
    if (!lineaTiempoPozoLogic_esObjeto(o) || typeof o.observacionId !== 'string' || !LINEA_TIEMPO_REGEX_ID.test(o.observacionId)) {
      omitidos.push('ITEM_INVALIDO');
      return;
    }
    if (o.wellId !== wellId) {
      omitidos.push('WELL_ID_DISTINTO');
      return;
    }
    if (!lineaTiempoPozoLogic_enLista(LINEA_TIEMPO_ESTADOS_OBSERVACION, o.estado)) {
      omitidos.push('ESTADO_DESCONOCIDO');
      return;
    }
    var anulada = o.estado === 'ANULADA';
    var alta = lineaTiempoPozoLogic_normalizarTimestamp(o.timestamp);
    if (alta === null) {
      omitidos.push('TIMESTAMP_INVALIDO');
    } else {
      eventos.push(lineaTiempoPozoLogic_crearEvento('OBSERVACION:' + o.observacionId + ':ALTA', 'OBSERVACION_AGREGADA', alta, o.nombre, anulada ? null : o.texto, o.estado, {}));
    }
    if (!anulada) {
      return;
    }
    var a = o.anulacion;
    var baja = lineaTiempoPozoLogic_esObjeto(a) ? lineaTiempoPozoLogic_normalizarTimestamp(a.timestamp) : null;
    if (baja === null) {
      omitidos.push(lineaTiempoPozoLogic_esObjeto(a) ? 'TIMESTAMP_INVALIDO' : 'ANULACION_AUSENTE');
      return;
    }
    eventos.push(lineaTiempoPozoLogic_crearEvento('OBSERVACION:' + o.observacionId + ':ANULADA', 'OBSERVACION_ANULADA', baja, a.nombre, a.motivo, 'ANULADA', {}));
  });
  return { ok: true, eventos: eventos, omitidos: lineaTiempoPozoLogic_contarOmitidos(omitidos) };
}

// Ubicacion = correcciones + decisiones de fuentes (dos endpoints, un mismo permiso). `data` = {correcciones: <payload>, decisiones: <payload>}; cada parte puede faltar (null/undefined = esa
// parte no se cargo) y si una viene mal formada la otra sigue valiendo. ok=false solo si NINGUNA parte es utilizable.
function lineaTiempoPozoLogic_normalizarUbicacion(data, wellId) {
  if (!lineaTiempoPozoLogic_esObjeto(data)) {
    return lineaTiempoPozoLogic_resultadoFallido('PAYLOAD_INVALIDO');
  }
  var partes = [];
  if (data.correcciones !== undefined && data.correcciones !== null) {
    partes.push(lineaTiempoPozoLogic_normalizarCorrecciones(data.correcciones, wellId));
  }
  if (data.decisiones !== undefined && data.decisiones !== null) {
    partes.push(lineaTiempoPozoLogic_normalizarDecisiones(data.decisiones, wellId));
  }
  var buenas = partes.filter(function (p) { return p.ok; });
  if (buenas.length === 0) {
    return partes.length ? partes[0] : lineaTiempoPozoLogic_resultadoFallido('PAYLOAD_INVALIDO');
  }
  var eventos = [];
  var codigos = [];
  partes.forEach(function (p) {
    p.eventos.forEach(function (e) { eventos.push(e); });
    p.omitidos.forEach(function (o) { for (var i = 0; i < o.cantidad; i++) { codigos.push(o.codigo); } });
  });
  return { ok: true, eventos: eventos, omitidos: lineaTiempoPozoLogic_contarOmitidos(codigos) };
}

// Normaliza el payload autorizado de UNA fuente. Nunca lanza. Devuelve {ok, eventos, omitidos}.
function lineaTiempoPozoLogic_normalizarFuente(fuente, data, wellId) {
  if (fuente === LINEA_TIEMPO_FUENTES.UBICACION) {
    return lineaTiempoPozoLogic_normalizarUbicacion(data, wellId);
  }
  if (fuente === LINEA_TIEMPO_FUENTES.REEMPLAZO) {
    return lineaTiempoPozoLogic_normalizarReemplazo(data, wellId);
  }
  if (fuente === LINEA_TIEMPO_FUENTES.OBSERVACIONES) {
    return lineaTiempoPozoLogic_normalizarObservaciones(data, wellId);
  }
  return lineaTiempoPozoLogic_resultadoFallido('FUENTE_DESCONOCIDA');
}

// --- Validacion, dedupe, orden, filtro ---

// Un evento es valido solo si tiene exactamente la forma del modelo: ids y catalogo, fecha canonica, textos, estado y `metadata` con claves de la lista blanca de su tipo. Sirve de red de
// seguridad: lo que no cumpla no entra a la linea de tiempo aunque venga de otro lado.
function lineaTiempoPozoLogic_esEventoValido(e) {
  if (!lineaTiempoPozoLogic_esObjeto(e)) {
    return false;
  }
  var claves = Object.keys(e).sort().join(',');
  if (claves !== 'detalle,estado,fuente,id,metadata,nombre,timestamp,tipo,titulo') {
    return false;
  }
  if (typeof e.id !== 'string' || e.id === '' || e.id.length > 120) {
    return false;
  }
  if (!lineaTiempoPozoLogic_tieneClave(LINEA_TIEMPO_TIPOS, e.tipo) || LINEA_TIEMPO_TIPOS[e.tipo].fuente !== e.fuente || LINEA_TIEMPO_TIPOS[e.tipo].titulo !== e.titulo) {
    return false;
  }
  if (typeof e.timestamp !== 'string' || lineaTiempoPozoLogic_normalizarTimestamp(e.timestamp) !== e.timestamp) {
    return false;
  }
  if (typeof e.nombre !== 'string' || e.nombre === '' || (e.detalle !== null && (typeof e.detalle !== 'string' || e.detalle === '')) || (e.estado !== null && typeof e.estado !== 'string')) {
    return false;
  }
  if (!lineaTiempoPozoLogic_esObjeto(e.metadata)) {
    return false;
  }
  var permitidas = lineaTiempoPozoLogic_tieneClave(LINEA_TIEMPO_METADATA_PERMITIDA, e.tipo) ? LINEA_TIEMPO_METADATA_PERMITIDA[e.tipo] : [];
  return Object.keys(e.metadata).every(function (k) {
    var v = e.metadata[k];
    return permitidas.indexOf(k) !== -1 && (v === null || typeof v === 'string' || typeof v === 'boolean');
  });
}

// Avance del estado de la ENTIDAD afectada (una correccion o una observacion solo avanza: PROPUESTA -> VALIDADA -> terminal; ACTIVA -> ANULADA). Sirve para que dos lecturas del mismo evento
// (p. ej. la alta de una observacion leida antes y despues de anularse) se resuelvan igual sin importar el orden en que lleguen. Un estado ausente o desconocido avanza 0.
var LINEA_TIEMPO_AVANCE_ESTADO = { PROPUESTA: 0, ACTIVA: 0, VALIDADA: 1, RECHAZADA: 2, SUPERADA: 2, REVERTIDA: 2, ANULADA: 2 };

function lineaTiempoPozoLogic_avance(evento) {
  return typeof evento.estado === 'string' && lineaTiempoPozoLogic_tieneClave(LINEA_TIEMPO_AVANCE_ESTADO, evento.estado) ? LINEA_TIEMPO_AVANCE_ESTADO[evento.estado] : 0;
}

// Deduplica por `id`. Ante el mismo id gana el evento de MAYOR avance de estado (una observacion anulada nunca vuelve a mostrarse activa con su texto por una lectura vieja) y, a igual avance, la
// ULTIMA aparicion (el llamador pasa las cargas en orden, la mas reciente al final). Conserva la posicion de la primera aparicion. Descarta lo que no sea un evento valido. No ordena.
function lineaTiempoPozoLogic_deduplicar(eventos) {
  var porId = {};
  var orden = [];
  (Array.isArray(eventos) ? eventos : []).forEach(function (e) {
    if (!lineaTiempoPozoLogic_esEventoValido(e)) {
      return;
    }
    if (!lineaTiempoPozoLogic_tieneClave(porId, e.id)) {
      orden.push(e.id);
      porId[e.id] = e;
    } else if (lineaTiempoPozoLogic_avance(e) >= lineaTiempoPozoLogic_avance(porId[e.id])) {
      porId[e.id] = e;
    }
  });
  return orden.map(function (id) { return porId[id]; });
}

// Comparador total: instante descendente; empate -> rango causal descendente -> fuente ascendente -> tipo ascendente -> id descendente. Los timestamps son canonicos (ancho fijo): el
// orden de strings es el orden cronologico.
function lineaTiempoPozoLogic_comparar(a, b) {
  if (a.timestamp !== b.timestamp) {
    return a.timestamp < b.timestamp ? 1 : -1;
  }
  var ra = LINEA_TIEMPO_TIPOS[a.tipo].rango;
  var rb = LINEA_TIEMPO_TIPOS[b.tipo].rango;
  if (ra !== rb) {
    return ra < rb ? 1 : -1;
  }
  if (a.fuente !== b.fuente) {
    return a.fuente < b.fuente ? -1 : 1;
  }
  if (a.tipo !== b.tipo) {
    return a.tipo < b.tipo ? -1 : 1;
  }
  if (a.id !== b.id) {
    return a.id < b.id ? 1 : -1;
  }
  return 0;
}

// Copia ordenada del mas reciente al mas viejo. No muta la entrada y descarta lo invalido.
function lineaTiempoPozoLogic_ordenar(eventos) {
  return (Array.isArray(eventos) ? eventos : []).filter(lineaTiempoPozoLogic_esEventoValido).sort(lineaTiempoPozoLogic_comparar);
}

// fuentes: undefined/null -> todos los eventos; un nombre o un array -> solo esas fuentes (un array vacio, o nombres desconocidos, no deja ninguno). Conserva el orden recibido.
function lineaTiempoPozoLogic_filtrarPorFuente(eventos, fuentes) {
  var lista = Array.isArray(eventos) ? eventos : [];
  if (fuentes === undefined || fuentes === null) {
    return lista.slice();
  }
  var pedidas = Array.isArray(fuentes) ? fuentes : [fuentes];
  return lista.filter(function (e) { return !!e && pedidas.indexOf(e.fuente) !== -1; });
}

// --- Armado de la linea de tiempo ---

// entradas: {UBICACION|REEMPLAZO|OBSERVACIONES: {estado: 'OK'|'SIN_PERMISO'|'ERROR', data}}; una fuente que falte esta NO_CARGADA. Solo 'OK' lee `data` (el payload ya autorizado). Una entrada
// 'OK' con payload mal formado pasa a ERROR. Claves ajenas (p. ej. FOTOS) se ignoran. Devuelve
//   {wellId, eventos (dedupe + orden), fuentes: {F: {estado, cantidad, omitidos[]}}, parcial}
// `parcial` = alguna fuente fallo o no se cargo (SIN_PERMISO y VACIA no son un fallo). Nunca lanza.
function lineaTiempoPozoLogic_armar(entradas, wellId) {
  var todos = [];
  var fuentes = {};
  LINEA_TIEMPO_ORDEN_FUENTES.forEach(function (fuente) {
    var entrada = lineaTiempoPozoLogic_esObjeto(entradas) && lineaTiempoPozoLogic_tieneClave(entradas, fuente) ? entradas[fuente] : null;
    var resumen = { estado: LINEA_TIEMPO_ESTADOS_FUENTE.NO_CARGADA, cantidad: 0, omitidos: [] };
    if (lineaTiempoPozoLogic_esObjeto(entrada)) {
      if (entrada.estado === 'SIN_PERMISO') {
        resumen.estado = LINEA_TIEMPO_ESTADOS_FUENTE.SIN_PERMISO;
      } else if (entrada.estado === 'OK') {
        var r = lineaTiempoPozoLogic_normalizarFuente(fuente, entrada.data, wellId);
        resumen.omitidos = r.omitidos;
        if (r.ok) {
          resumen.cantidad = r.eventos.length;
          resumen.estado = r.eventos.length ? LINEA_TIEMPO_ESTADOS_FUENTE.OK : LINEA_TIEMPO_ESTADOS_FUENTE.VACIA;
          r.eventos.forEach(function (e) { todos.push(e); });
        } else {
          resumen.estado = LINEA_TIEMPO_ESTADOS_FUENTE.ERROR;
        }
      } else {
        resumen.estado = LINEA_TIEMPO_ESTADOS_FUENTE.ERROR;
      }
    }
    fuentes[fuente] = resumen;
  });
  var eventos = lineaTiempoPozoLogic_ordenar(lineaTiempoPozoLogic_deduplicar(todos));
  // la cantidad de cada fuente es la de eventos que SOBREVIVEN al dedupe
  LINEA_TIEMPO_ORDEN_FUENTES.forEach(function (fuente) {
    if (fuentes[fuente].estado === LINEA_TIEMPO_ESTADOS_FUENTE.OK || fuentes[fuente].estado === LINEA_TIEMPO_ESTADOS_FUENTE.VACIA) {
      fuentes[fuente].cantidad = lineaTiempoPozoLogic_filtrarPorFuente(eventos, fuente).length;
    }
  });
  var parcial = LINEA_TIEMPO_ORDEN_FUENTES.some(function (fuente) {
    return fuentes[fuente].estado === LINEA_TIEMPO_ESTADOS_FUENTE.ERROR || fuentes[fuente].estado === LINEA_TIEMPO_ESTADOS_FUENTE.NO_CARGADA;
  });
  return { wellId: typeof wellId === 'string' ? wellId : null, eventos: eventos, fuentes: fuentes, parcial: parcial };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LINEA_TIEMPO_FUENTES,
    LINEA_TIEMPO_ORDEN_FUENTES,
    LINEA_TIEMPO_TIPOS,
    LINEA_TIEMPO_ESTADOS_FUENTE,
    LINEA_TIEMPO_ANIO_MIN,
    LINEA_TIEMPO_ANIO_MAX,
    LINEA_TIEMPO_DETALLE_MAX,
    LINEA_TIEMPO_NOMBRE_MAX,
    LINEA_TIEMPO_NOMBRE_NEUTRO,
    LINEA_TIEMPO_METADATA_PERMITIDA,
    lineaTiempoPozoLogic_normalizarTimestamp,
    lineaTiempoPozoLogic_sinSurrogatesSueltos,
    lineaTiempoPozoLogic_limpiarTexto,
    lineaTiempoPozoLogic_nombreVisible,
    lineaTiempoPozoLogic_normalizarCorrecciones,
    lineaTiempoPozoLogic_normalizarDecisiones,
    lineaTiempoPozoLogic_normalizarReemplazo,
    lineaTiempoPozoLogic_normalizarObservaciones,
    lineaTiempoPozoLogic_normalizarUbicacion,
    lineaTiempoPozoLogic_normalizarFuente,
    lineaTiempoPozoLogic_esEventoValido,
    LINEA_TIEMPO_AVANCE_ESTADO,
    lineaTiempoPozoLogic_deduplicar,
    lineaTiempoPozoLogic_comparar,
    lineaTiempoPozoLogic_ordenar,
    lineaTiempoPozoLogic_filtrarPorFuente,
    lineaTiempoPozoLogic_armar
  };
}
