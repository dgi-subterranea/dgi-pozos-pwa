// UbicacionCorreccionService: logica de negocio de las correcciones de ubicacion de pozos (etapa backend base).
//
// Una correccion es la ubicacion OBSERVADA EN CAMPO de un pozo, distinta de la que tiene Irrigacion. Nunca reemplaza ni
// modifica el padron: la coordenada de Irrigacion queda como "snapshot" dentro de la propia correccion (la toma el backend al
// proponer; el cliente no puede imponerla) y el estado se DERIVA del ultimo evento del log (append-only, ver
// UbicacionCorreccionRepository.js).
//
// Estados / eventos: PROPUESTA -> VALIDADA | RECHAZADA ; VALIDADA -> SUPERADA | REVERTIDA. RECHAZADA, SUPERADA y REVERTIDA
// son terminales. Una sola VALIDADA vigente por pozo: validar una nueva marca SUPERADA a la anterior en el mismo paso.
//
// INCONSISTENTE no es un estado del flujo sino una condicion DETECTADA: una correccion cuyo log no es una cadena valida (sin
// eventos, sin PROPUESTA inicial, transiciones imposibles, eventos desconocidos). Falla CERRADO: no figura como pendiente ni
// como vigente, no se puede validar/rechazar/revertir y se informa aparte. La unica salida es el autocurado de proponer().
//
// Escritura en DOS hojas (correccion + evento PROPUESTA): Sheets no tiene transacciones entre hojas, asi que NO es atomica. Se
// reduce la ventana (ambas hojas se verifican ANTES de escribir la primera) y se cubre el resto con el reintento: ver proponer().
//
// email/nombre llegan SIEMPRE de la sesion (Api.js) - este servicio nunca los toma de datos del cliente. Los permisos se chequean
// en Api.js; aca solo las reglas que dependen del contenido (p. ej. quien propone no puede validar su propia propuesta).
// Las respuestas hacia el cliente NUNCA incluyen emails: solo nombres y un booleano "propia".
//
// Todo lo sensible se recalcula aca (distancia, snapshot, banderas, estado); lo que mande el cliente fuera de la lista
// blanca de campos se ignora (ver Api.js).
var UBICACION_CORR_METODOS = ['GPS_ACTUAL', 'PUNTO_EN_MAPA'];          // catalogo extensible: agregar aca (y su regla en validarPropuesta)
var UBICACION_CORR_EVENTOS = ['PROPUESTA', 'VALIDADA', 'RECHAZADA', 'SUPERADA', 'REVERTIDA'];
var UBICACION_CORR_TRANSICIONES = {
  PROPUESTA: ['VALIDADA', 'RECHAZADA'],
  VALIDADA: ['SUPERADA', 'REVERTIDA'],
  RECHAZADA: [],
  SUPERADA: [],
  REVERTIDA: []
};
var UBICACION_CORR_ESTADO_INCONSISTENTE = 'INCONSISTENTE';
var UBICACION_CORR_MOTIVO_AUTOCURADO = 'Evento inicial completado por un reintento (la correccion se habia escrito sin su evento)';
var UBICACION_CORR_GPS_PRECISION_MAX_M = 50;
var UBICACION_CORR_OBSERVACION_DESDE_M = 250;     // MAS de esta distancia a la ubicacion de Irrigacion: observacion obligatoria
var UBICACION_CORR_ADVERTENCIA_DESDE_M = 1000;    // MAS de esta distancia: bandera de advertencia fuerte (no bloquea)
var UBICACION_CORR_OBSERVACION_MAX = 300;
var UBICACION_CORR_MOTIVO_MAX = 300;
var UBICACION_CORR_PENDIENTES_MAX = 200;
// Caja geografica de Mendoza con ~5 km de margen (norte -32.0, sur -37.6, oeste -70.6, este -66.5). Es una regla gruesa y
// deliberada: bloquea lo claramente ajeno (otras provincias, Chile, el oceano, lat/lon invertidos, 0,0) sin exigir un poligono
// provincial; un punto de una provincia vecina pegado al limite puede pasar y lo decide quien valida.
var UBICACION_CORR_MENDOZA_BBOX = { latMin: -37.65, latMax: -31.95, lonMin: -70.65, lonMax: -66.45 };
var UBICACION_CORR_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
var UBICACION_CORR_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var UBICACION_CORR_ESTADOS_CON_COORDENADA = { corroborada: true, unica: true };

function ubicacionCorreccionService_error(code, message, extra) {
  var r = { ok: false, code: code, message: message };
  if (extra) {
    Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  }
  return r;
}

function ubicacionCorreccionService_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

function ubicacionCorreccionService_redondear(valor, decimales) {
  var f = Math.pow(10, decimales);
  return Math.round(valor * f) / f;
}

function ubicacionCorreccionService_esNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

// Distancia en metros entre dos puntos WGS84 (haversine), con 1 decimal.
function ubicacionCorreccionService_distanciaMetros(lat1, lon1, lat2, lon2) {
  var R = 6371008.8;
  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad;
  var dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return ubicacionCorreccionService_redondear(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 1);
}

function ubicacionCorreccionService_dentroDeMendoza(lat, lon) {
  var b = UBICACION_CORR_MENDOZA_BBOX;
  return lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Validacion de CONTENIDO de una propuesta (sin leer nada de Sheets ni del padron). Devuelve {ok, valores} o {ok:false, code,
// message}. La observacion obligatoria segun la distancia se decide despues, cuando ya se conoce la ubicacion de Irrigacion.
function ubicacionCorreccionService_validarPropuesta(datos) {
  var d = datos || {};

  if (typeof d.clientRequestId !== 'string' || !UBICACION_CORR_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return ubicacionCorreccionService_error('INVALID_CLIENT_REQUEST_ID', 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)');
  }
  if (UBICACION_CORR_METODOS.indexOf(d.metodo) === -1) {
    return ubicacionCorreccionService_error('INVALID_METODO', 'metodo invalido (' + UBICACION_CORR_METODOS.join(' | ') + ')');
  }
  if (!ubicacionCorreccionService_esNumero(d.lat) || !ubicacionCorreccionService_esNumero(d.lon)) {
    return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'lat y lon deben ser numeros');
  }
  if (d.lat < -90 || d.lat > 90 || d.lon < -180 || d.lon > 180 || (d.lat === 0 && d.lon === 0)) {
    return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'coordenadas fuera de rango');
  }
  var lat = ubicacionCorreccionService_redondear(d.lat, 6);
  var lon = ubicacionCorreccionService_redondear(d.lon, 6);
  if (!ubicacionCorreccionService_dentroDeMendoza(lat, lon)) {
    return ubicacionCorreccionService_error('FUERA_DE_MENDOZA', 'La ubicacion queda fuera de Mendoza');
  }

  var precision = null;
  if (d.metodo === 'GPS_ACTUAL') {
    if (!ubicacionCorreccionService_esNumero(d.precisionGpsM) || d.precisionGpsM <= 0) {
      return ubicacionCorreccionService_error('INVALID_PRECISION', 'GPS_ACTUAL requiere la precision del GPS (precisionGpsM, en metros)');
    }
    if (d.precisionGpsM > UBICACION_CORR_GPS_PRECISION_MAX_M) {
      return ubicacionCorreccionService_error('PRECISION_INSUFICIENTE',
        'La precision del GPS (± ' + Math.round(d.precisionGpsM) + ' m) supera los ' + UBICACION_CORR_GPS_PRECISION_MAX_M +
        ' m: no se puede guardar como ubicacion actual. Probá a cielo abierto o elegí el punto en el mapa.');
    }
    precision = ubicacionCorreccionService_redondear(d.precisionGpsM, 1);
  } else if (d.precisionGpsM !== null && d.precisionGpsM !== undefined) {
    return ubicacionCorreccionService_error('INVALID_PRECISION', 'PUNTO_EN_MAPA no lleva precision de GPS');
  }

  var observacion = '';
  if (d.observacion !== null && d.observacion !== undefined) {
    if (typeof d.observacion !== 'string') {
      return ubicacionCorreccionService_error('INVALID_OBSERVACION', 'observacion debe ser texto');
    }
    observacion = d.observacion.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
    if (observacion.length > UBICACION_CORR_OBSERVACION_MAX) {
      return ubicacionCorreccionService_error('INVALID_OBSERVACION', 'observacion de hasta ' + UBICACION_CORR_OBSERVACION_MAX + ' caracteres');
    }
  }

  return {
    ok: true,
    valores: { clientRequestId: d.clientRequestId, metodo: d.metodo, lat: lat, lon: lon, precisionGpsM: precision, observacion: observacion }
  };
}

function ubicacionCorreccionService_validarMotivo(motivo, obligatorio) {
  var m = '';
  if (motivo !== null && motivo !== undefined) {
    if (typeof motivo !== 'string') {
      return ubicacionCorreccionService_error('INVALID_MOTIVO', 'motivo debe ser texto');
    }
    m = motivo.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  }
  if (m.length > UBICACION_CORR_MOTIVO_MAX) {
    return ubicacionCorreccionService_error('INVALID_MOTIVO', 'motivo de hasta ' + UBICACION_CORR_MOTIVO_MAX + ' caracteres');
  }
  if (obligatorio && m === '') {
    return ubicacionCorreccionService_error('INVALID_MOTIVO', 'el motivo es obligatorio');
  }
  return { ok: true, motivo: m };
}

// Snapshot de la ubicacion de Irrigacion VIGENTE en el padron al momento de proponer. Solo hay coordenada oficial cuando el
// padron la resolvio (corroborada / unica): con fuentes en desacuerdo (revisar*) o sin datos no hay "la" coordenada oficial y
// irrLat / irrLon quedan nulos (el estado igual queda registrado). Si el pozo no existe en el padron no se propone (fail-closed).
function ubicacionCorreccionService_snapshotIrrigacion(wellId) {
  var res = registryService_getWellLocation(wellId);
  if (!res || !res.found) {
    return ubicacionCorreccionService_error('WELL_NOT_FOUND', 'no se encontro el pozo ' + wellId + ' en el padron');
  }
  var resuelta = (res.location && res.location.ubicacionResuelta) || { estado: 'sinCoordenadas' };
  var estado = typeof resuelta.estado === 'string' ? resuelta.estado : 'sinCoordenadas';
  var tieneCoordenada = UBICACION_CORR_ESTADOS_CON_COORDENADA[estado] === true &&
    ubicacionCorreccionService_esNumero(resuelta.lat) && ubicacionCorreccionService_esNumero(resuelta.lon);
  var periodo = '';
  try {
    var meta = registryService_getMetadata();
    if (meta && meta.found && meta.metadata && meta.metadata.periodo) {
      periodo = String(meta.metadata.periodo);
    }
  } catch (err) {
    periodo = '';
  }
  return {
    ok: true,
    snapshot: {
      irrLat: tieneCoordenada ? ubicacionCorreccionService_redondear(resuelta.lat, 6) : null,
      irrLon: tieneCoordenada ? ubicacionCorreccionService_redondear(resuelta.lon, 6) : null,
      irrEstado: estado,
      irrFuente: resuelta.fuente ? String(resuelta.fuente) : (estado === 'corroborada' ? 'VARIAS_FUENTES' : ''),
      padronPeriodo: periodo
    }
  };
}

// --- Estado derivado ---

// El log de una correccion es valido solo si es una cadena del flujo: empieza con PROPUESTA y cada evento sigue a su anterior segun
// UBICACION_CORR_TRANSICIONES. Sin eventos, sin PROPUESTA inicial, eventos desconocidos o saltos imposibles = invalida.
function ubicacionCorreccionService_cadenaValida(evs) {
  if (!evs.length) {
    return false;
  }
  var previo = null;
  for (var i = 0; i < evs.length; i++) {
    var actual = evs[i].evento;
    if (UBICACION_CORR_EVENTOS.indexOf(actual) === -1) {
      return false;
    }
    if (previo === null ? actual !== 'PROPUESTA' : UBICACION_CORR_TRANSICIONES[previo].indexOf(actual) === -1) {
      return false;
    }
    previo = actual;
  }
  return true;
}

// correcciones (hoja) + eventos (log, en orden) -> correcciones con estado. El estado es el ULTIMO evento SI el log de esa
// correccion es una cadena valida; si no (incluida una correccion sin ningun evento) es INCONSISTENTE: nunca se supone PROPUESTA.
// Los eventos de un correccionId que no existe en la hoja de correcciones se ignoran (no hay nada que gobernar).
function ubicacionCorreccionService_derivar(correcciones, eventos) {
  var porId = {};
  (eventos || []).forEach(function (e) {
    (porId[e.correccionId] = porId[e.correccionId] || []).push(e);
  });
  return (correcciones || []).map(function (c, indice) {
    var evs = porId[c.correccionId] || [];
    var ultimo = evs.length ? evs[evs.length - 1] : null;
    var valida = ubicacionCorreccionService_cadenaValida(evs);
    var derivada = {};
    Object.keys(c).forEach(function (k) { derivada[k] = c[k]; });
    derivada.estado = valida ? ultimo.evento : UBICACION_CORR_ESTADO_INCONSISTENTE;
    derivada.eventos = evs;
    derivada.ultimoEvento = valida ? ultimo : null;
    derivada.orden = indice;
    return derivada;
  });
}

// Vista hacia el cliente: SIN emails. "propia" dice si la propuso quien consulta (para ocultar el boton de validar).
function ubicacionCorreccionService_vista(c, emailSolicitante) {
  var u = c.ultimoEvento;
  var resuelta = u && u.evento !== 'PROPUESTA';
  return {
    correccionId: c.correccionId,
    wellId: c.wellId,
    lat: c.lat,
    lon: c.lon,
    metodo: c.metodo,
    precisionGpsM: c.precisionGpsM,
    observacion: c.observacion,
    nombrePropone: c.nombrePropone,
    timestamp: c.timestamp,
    distanciaM: c.distanciaM,
    advertenciaDistancia: c.advertenciaDistancia === true,
    irrigacion: { lat: c.irrLat, lon: c.irrLon, estado: c.irrEstado, fuente: c.irrFuente, padronPeriodo: c.padronPeriodo },
    estado: c.estado,
    resolucion: resuelta ? { evento: u.evento, nombre: u.nombre, timestamp: u.timestamp, motivo: u.motivo } : null,
    propia: !!emailSolicitante && ubicacionCorreccionService_normalizarEmail(c.emailPropone) === ubicacionCorreccionService_normalizarEmail(emailSolicitante)
  };
}

function ubicacionCorreccionService_masReciente(a, b) {
  var ta = a.timestamp || '';
  var tb = b.timestamp || '';
  if (ta !== tb) {
    return ta < tb ? 1 : -1;
  }
  return b.orden - a.orden;
}

function ubicacionCorreccionService_leerDerivadas() {
  return ubicacionCorreccionService_derivar(ubicacionCorreccionRepository_listarCorrecciones(), ubicacionCorreccionRepository_listarEventos());
}

// Correcciones de un pozo: vigente (la VALIDADA), pendientes (PROPUESTA) e historial completo, todo del mas nuevo al mas viejo.
function ubicacionCorreccionService_getPorPozo(email, wellId) {
  var delPozo = ubicacionCorreccionService_leerDerivadas().filter(function (c) { return c.wellId === wellId; });
  delPozo.sort(ubicacionCorreccionService_masReciente);
  function v(c) { return ubicacionCorreccionService_vista(c, email); }
  var vigentes = delPozo.filter(function (c) { return c.estado === 'VALIDADA'; });
  return {
    wellId: wellId,
    vigente: vigentes.length ? v(vigentes[0]) : null,
    pendientes: delPozo.filter(function (c) { return c.estado === 'PROPUESTA'; }).map(v),
    historial: delPozo.map(v)
  };
}

// Cola de validacion: todas las PROPUESTA de la provincia, las mas viejas primero (tope UBICACION_CORR_PENDIENTES_MAX).
function ubicacionCorreccionService_getPendientes(email) {
  var derivadas = ubicacionCorreccionService_leerDerivadas();
  var pendientes = derivadas.filter(function (c) { return c.estado === 'PROPUESTA'; });
  pendientes.sort(function (a, b) { return -ubicacionCorreccionService_masReciente(a, b); });
  return {
    total: pendientes.length,
    inconsistentes: derivadas.filter(function (c) { return c.estado === UBICACION_CORR_ESTADO_INCONSISTENTE; }).length,
    pendientes: pendientes.slice(0, UBICACION_CORR_PENDIENTES_MAX).map(function (c) { return ubicacionCorreccionService_vista(c, email); })
  };
}

// --- Escrituras ---

function ubicacionCorreccionService_mismaSolicitud(existente, v, wellId) {
  return existente.wellId === wellId && existente.metodo === v.metodo &&
    Math.abs(existente.lat - v.lat) < 1e-9 && Math.abs(existente.lon - v.lon) < 1e-9;
}

function ubicacionCorreccionService_buscarPorClientRequestId(derivadas, emailNormalizado, clientRequestId) {
  for (var i = 0; i < derivadas.length; i++) {
    var c = derivadas[i];
    if (c.clientRequestId === clientRequestId && ubicacionCorreccionService_normalizarEmail(c.emailPropone) === emailNormalizado) {
      return c;
    }
  }
  return null;
}

// Una correccion ya existente para (usuario, clientRequestId): decide que responder.
//  - con otro contenido -> IDEMPOTENCY_CONFLICT (nunca se "cura" una solicitud distinta);
//  - log inconsistente CON eventos -> INCONSISTENT_STATE (fail-closed: no se toca nada);
//  - sin ningun evento (corte entre las dos escrituras) -> AUTOCURADO: se agrega el PROPUESTA faltante, sin duplicar la correccion.
//    Solo se llama con el lock tomado cuando hay que escribir. El evento lleva la fecha ORIGINAL de la propuesta y un motivo que
//    deja constancia de que lo completo un reintento;
//  - estado consistente -> reenvio idempotente (duplicada:true).
function ubicacionCorreccionService_atenderExistente(existente, v, wellId, email, emailN, nombre) {
  if (!ubicacionCorreccionService_mismaSolicitud(existente, v, wellId)) {
    return ubicacionCorreccionService_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido', { wellId: wellId });
  }
  var curada = false;
  if (existente.estado === UBICACION_CORR_ESTADO_INCONSISTENTE) {
    if (existente.eventos.length > 0) {
      return ubicacionCorreccionService_error('INCONSISTENT_STATE', 'el historial de la correccion es inconsistente: requiere revision manual', { wellId: existente.wellId });
    }
    var cuando = existente.timestamp ? new Date(existente.timestamp) : new Date();
    ubicacionCorreccionRepository_agregarEventos([{
      correccionId: existente.correccionId, timestamp: cuando, evento: 'PROPUESTA', email: emailN, nombre: nombre || '', motivo: UBICACION_CORR_MOTIVO_AUTOCURADO
    }]);
    existente = ubicacionCorreccionService_buscarPorClientRequestId(ubicacionCorreccionService_leerDerivadas(), emailN, v.clientRequestId);
    curada = true;
  }
  return { ok: true, correccion: ubicacionCorreccionService_vista(existente, email), duplicada: true, curada: curada };
}

// Propone una correccion. Devuelve {ok:true, correccion, duplicada, curada} o {ok:false, code, message}.
//
// IDEMPOTENTE por (usuario, clientRequestId): repetir la misma solicitud devuelve la ya creada (duplicada:true) sin escribir otra
// fila, aunque el padron haya cambiado entretanto; reutilizar el id con OTRO contenido es IDEMPOTENCY_CONFLICT.
//
// ESCRITURA PARCIAL: la creacion normal escribe la correccion y despues su evento PROPUESTA en OTRA hoja; Sheets no ofrece
// atomicidad entre hojas. Para achicar la ventana, ambas hojas se abren y verifican ANTES de escribir la primera (si falta una hoja o
// una columna no se escribe nada). Si aun asi se corta entre las dos escrituras, la correccion queda sin eventos = INCONSISTENTE
// (fail-closed, no es una propuesta valida) hasta que el MISMO usuario reintente con el MISMO clientRequestId: ese reintento
// agrega el PROPUESTA faltante (curada:true) sin duplicar la correccion.
function ubicacionCorreccionService_proponer(email, nombre, wellId, datos) {
  var validacion = ubicacionCorreccionService_validarPropuesta(datos);
  if (!validacion.ok) {
    return validacion;
  }
  var v = validacion.valores;
  var emailN = ubicacionCorreccionService_normalizarEmail(email);

  // Camino rapido (sin lock): si la solicitud ya se proceso en forma consistente, se responde sin tocar el padron ni la hoja.
  // Una correccion SIN eventos pasa al camino con lock (autocurado). El snapshot solo hace falta para una correccion NUEVA.
  var previa = ubicacionCorreccionService_buscarPorClientRequestId(ubicacionCorreccionService_leerDerivadas(), emailN, v.clientRequestId);
  if (previa && !(previa.estado === UBICACION_CORR_ESTADO_INCONSISTENTE && previa.eventos.length === 0)) {
    return ubicacionCorreccionService_atenderExistente(previa, v, wellId, email, emailN, nombre);
  }

  var s = null;
  var distanciaM = null;
  if (!previa) {
    var snap = ubicacionCorreccionService_snapshotIrrigacion(wellId);
    if (!snap.ok) {
      return snap;
    }
    s = snap.snapshot;
    if (s.irrLat !== null && s.irrLon !== null) {
      distanciaM = ubicacionCorreccionService_distanciaMetros(s.irrLat, s.irrLon, v.lat, v.lon);
    }
    if (distanciaM !== null && distanciaM > UBICACION_CORR_OBSERVACION_DESDE_M && v.observacion === '') {
      return ubicacionCorreccionService_error('OBSERVACION_REQUERIDA',
        'La ubicacion propuesta esta a ' + Math.round(distanciaM) + ' m de la de Irrigacion: indicá el motivo en la observacion (obligatoria a mas de ' +
        UBICACION_CORR_OBSERVACION_DESDE_M + ' m).', { distanciaM: distanciaM });
    }
  }

  return ubicacionCorreccionRepository_conLock(function () {
    // Dentro del lock se vuelve a leer: otra ejecucion pudo escribir mientras se esperaba.
    var existente = ubicacionCorreccionService_buscarPorClientRequestId(ubicacionCorreccionService_leerDerivadas(), emailN, v.clientRequestId);
    if (existente) {
      return ubicacionCorreccionService_atenderExistente(existente, v, wellId, email, emailN, nombre);
    }
    if (s === null) {
      // la correccion que se iba a curar desaparecio entre lecturas (no deberia pasar en una hoja append-only): no se inventa nada
      return ubicacionCorreccionService_error('SERVICE_RETRY', 'reintentá la solicitud');
    }

    var ahora = new Date();
    var correccion = {
      correccionId: Utilities.getUuid(),
      wellId: wellId,
      lat: v.lat,
      lon: v.lon,
      metodo: v.metodo,
      precisionGpsM: v.precisionGpsM,
      observacion: v.observacion,
      emailPropone: emailN,
      nombrePropone: nombre || '',
      timestamp: ahora,
      irrLat: s.irrLat,
      irrLon: s.irrLon,
      irrEstado: s.irrEstado,
      irrFuente: s.irrFuente,
      padronPeriodo: s.padronPeriodo,
      distanciaM: distanciaM,
      advertenciaDistancia: distanciaM !== null && distanciaM > UBICACION_CORR_ADVERTENCIA_DESDE_M,
      clientRequestId: v.clientRequestId
    };
    var evento = { correccionId: correccion.correccionId, timestamp: ahora, evento: 'PROPUESTA', email: emailN, nombre: nombre || '', motivo: '' };
    ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion, evento);

    var iso = ahora.toISOString();
    var derivada = ubicacionCorreccionService_derivar(
      [Object.assign({}, correccion, { timestamp: iso })],
      [Object.assign({}, evento, { timestamp: iso })]
    )[0];
    return { ok: true, correccion: ubicacionCorreccionService_vista(derivada, email), duplicada: false, curada: false };
  });
}

var UBICACION_CORR_ACCIONES = {
  validar: { hasta: 'VALIDADA', motivoObligatorio: false },
  rechazar: { hasta: 'RECHAZADA', motivoObligatorio: true },
  revertir: { hasta: 'REVERTIDA', motivoObligatorio: true }
};

// validar / rechazar / revertir: UNA sola rutina para que las transiciones y el lock sean identicos. Los errores incluyen el
// wellId de la correccion (cuando se la encontro) para la auditoria. Quien propone no puede VALIDAR su propia propuesta (y
// tampoco puede RECHAZARLA: rechazar es de quien valida). Validar escribe, en UNA sola escritura contigua, SUPERADA para la validada anterior del mismo
// pozo (si hay) y despues VALIDADA para la nueva.
function ubicacionCorreccionService_resolver(accion, email, nombre, correccionId, motivo) {
  var regla = UBICACION_CORR_ACCIONES[accion];
  if (!regla) {
    return ubicacionCorreccionService_error('INVALID_ACCION', 'accion invalida');
  }
  if (typeof correccionId !== 'string' || !UBICACION_CORR_UUID_REGEX.test(correccionId)) {
    return ubicacionCorreccionService_error('INVALID_CORRECCION_ID', 'correccionId invalido');
  }
  var m = ubicacionCorreccionService_validarMotivo(motivo, regla.motivoObligatorio);
  if (!m.ok) {
    return m;
  }
  var emailN = ubicacionCorreccionService_normalizarEmail(email);

  return ubicacionCorreccionRepository_conLock(function () {
    var derivadas = ubicacionCorreccionService_leerDerivadas();
    var objetivo = null;
    derivadas.forEach(function (c) { if (c.correccionId === correccionId) { objetivo = c; } });
    if (!objetivo) {
      return ubicacionCorreccionService_error('CORRECCION_NOT_FOUND', 'no se encontro la correccion');
    }
    var extra = { wellId: objetivo.wellId };
    if (objetivo.estado === UBICACION_CORR_ESTADO_INCONSISTENTE) {
      return ubicacionCorreccionService_error('INCONSISTENT_STATE',
        'el historial de la correccion es inconsistente: no se puede ' + accion + ' (requiere revision manual)', extra);
    }
    if (UBICACION_CORR_TRANSICIONES[objetivo.estado].indexOf(regla.hasta) === -1) {
      return ubicacionCorreccionService_error('INVALID_TRANSITION',
        'no se puede pasar de ' + objetivo.estado + ' a ' + regla.hasta, extra);
    }
    var esPropia = ubicacionCorreccionService_normalizarEmail(objetivo.emailPropone) === emailN;
    if (accion === 'validar' && esPropia) {
      return ubicacionCorreccionService_error('SELF_VALIDATION', 'quien propone una correccion no puede validarla', extra);
    }
    if (accion === 'rechazar' && esPropia) {
      // RECHAZADA es una decision de quien valida: el autor no retira su propia propuesta por esta via (un retiro por el autor, si
      // se quisiera, seria un evento aparte).
      return ubicacionCorreccionService_error('SELF_REJECTION', 'quien propone una correccion no puede rechazarla', extra);
    }

    var ahora = new Date();
    var eventos = [];
    var supersedidas = [];
    if (accion === 'validar') {
      derivadas.forEach(function (c) {
        if (c.wellId === objetivo.wellId && c.estado === 'VALIDADA' && c.correccionId !== objetivo.correccionId) {
          supersedidas.push(c.correccionId);
          eventos.push({
            correccionId: c.correccionId, timestamp: ahora, evento: 'SUPERADA', email: emailN, nombre: nombre || '',
            motivo: 'Superada por la correccion ' + objetivo.correccionId
          });
        }
      });
    }
    eventos.push({ correccionId: objetivo.correccionId, timestamp: ahora, evento: regla.hasta, email: emailN, nombre: nombre || '', motivo: m.motivo });
    ubicacionCorreccionRepository_agregarEventos(eventos);

    var iso = ahora.toISOString();
    var vistaFinal = Object.assign({}, objetivo, {
      estado: regla.hasta,
      ultimoEvento: { correccionId: objetivo.correccionId, timestamp: iso, evento: regla.hasta, email: emailN, nombre: nombre || '', motivo: m.motivo }
    });
    return { ok: true, correccion: ubicacionCorreccionService_vista(vistaFinal, email), supersedidas: supersedidas };
  });
}

function ubicacionCorreccionService_validar(email, nombre, correccionId, motivo) {
  return ubicacionCorreccionService_resolver('validar', email, nombre, correccionId, motivo);
}

function ubicacionCorreccionService_rechazar(email, nombre, correccionId, motivo) {
  return ubicacionCorreccionService_resolver('rechazar', email, nombre, correccionId, motivo);
}

function ubicacionCorreccionService_revertir(email, nombre, correccionId, motivo) {
  return ubicacionCorreccionService_resolver('revertir', email, nombre, correccionId, motivo);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_CORR_METODOS,
    UBICACION_CORR_EVENTOS,
    UBICACION_CORR_TRANSICIONES,
    UBICACION_CORR_ESTADO_INCONSISTENTE,
    UBICACION_CORR_GPS_PRECISION_MAX_M,
    UBICACION_CORR_OBSERVACION_DESDE_M,
    UBICACION_CORR_ADVERTENCIA_DESDE_M,
    UBICACION_CORR_OBSERVACION_MAX,
    UBICACION_CORR_MENDOZA_BBOX,
    UBICACION_CORR_PENDIENTES_MAX,
    ubicacionCorreccionService_distanciaMetros,
    ubicacionCorreccionService_dentroDeMendoza,
    ubicacionCorreccionService_validarPropuesta,
    ubicacionCorreccionService_snapshotIrrigacion,
    ubicacionCorreccionService_derivar,
    ubicacionCorreccionService_vista,
    ubicacionCorreccionService_getPorPozo,
    ubicacionCorreccionService_getPendientes,
    ubicacionCorreccionService_proponer,
    ubicacionCorreccionService_validar,
    ubicacionCorreccionService_rechazar,
    ubicacionCorreccionService_revertir
  };
}
