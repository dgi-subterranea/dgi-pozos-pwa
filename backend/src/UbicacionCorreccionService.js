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
// en Api.js; aca solo las reglas que dependen del contenido (p. ej. quien propone no puede RECHAZAR su propia propuesta).
//
// Quien propone y ademas tiene ubicacion_validar corrige DIRECTAMENTE (no necesita la validacion de otra persona): Api.js se lo indica con
// opciones.autoValidar y proponer() deja la correccion vigente en la MISMA operacion bajo lock, con los mismos eventos de siempre
// (PROPUESTA -> [SUPERADA de la anterior] -> VALIDADA, todos a nombre de ese usuario, en UNA escritura contigua del log). Quien tiene
// ubicacion_validar tambien puede validar una propuesta propia ya existente.
// Las respuestas hacia el cliente NUNCA incluyen emails: solo nombres y un booleano "propia".
//
// Todo lo sensible se recalcula aca (distancia, snapshot, banderas, estado); lo que mande el cliente fuera de la lista
// blanca de campos se ignora (ver Api.js).
// Catalogo de metodos (extensible: agregar aca y su regla en validarPropuesta). GPS_ACTUAL y PUNTO_EN_MAPA traen lat/lon del cliente; los dos
// COORDENADAS_* traen el valor ORIGINAL tipeado (coordenadaOriginal) y el backend DERIVA lat/lon de el: nunca confia en el WGS84 del cliente.
var UBICACION_CORR_METODOS_COORDENADAS = ['COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2'];
var UBICACION_CORR_METODOS = ['GPS_ACTUAL', 'PUNTO_EN_MAPA'].concat(UBICACION_CORR_METODOS_COORDENADAS);
// Forma EXACTA permitida de coordenadaOriginal (cualquier clave de mas se rechaza): GMS {lat:{g,m,s,h}, lon:{g,m,s,h}}; POSGAR {x, y} (x = Este, y = Norte).
var UBICACION_CORR_COORD_ORIGINAL_FORMA = {
  COORDENADAS_GMS: { claves: ['lat', 'lon'], subclaves: ['g', 'm', 's', 'h'] },
  COORDENADAS_POSGAR94_AR2: { claves: ['x', 'y'], subclaves: null }
};
var UBICACION_CORR_COORD_VALOR_MAX_CARACTERES = 40;
// Diferencia maxima (en metros) entre el lat/lon que PUEDE mandar el cliente (preview) y el que recalcula el backend desde el valor original. Es una
// distancia METRICA (haversine) entre el valor que manda el cliente TAL CUAL y la conversion del backend SIN redondear: el redondeo a 6 decimales
// (hasta ~5,5 cm de diferencia) es solo de persistencia / vista y NUNCA interviene en esta decision. Por eso un cliente honesto manda su conversion con
// toda la precision (no el valor ya redondeado).
var UBICACION_CORR_COORD_TOLERANCIA_M = 0.02;
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
var UBICACION_CORR_MOTIVO_AUTOVALIDACION = 'Validada automaticamente al crearla: quien la creo tiene permiso para validar ubicaciones';
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

// Distancia en metros entre dos puntos WGS84 (haversine), SIN redondear (para comparar a escala de centimetros).
function ubicacionCorreccionService_distanciaMetrosExacta(lat1, lon1, lat2, lon2) {
  var R = 6371008.8;
  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad;
  var dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Distancia en metros entre dos puntos WGS84 (haversine), con 1 decimal.
function ubicacionCorreccionService_distanciaMetros(lat1, lon1, lat2, lon2) {
  return ubicacionCorreccionService_redondear(ubicacionCorreccionService_distanciaMetrosExacta(lat1, lon1, lat2, lon2), 1);
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
  var lat;
  var lon;
  var coordenadaOriginalTexto = '';
  var crsOriginal = '';
  if (UBICACION_CORR_METODOS_COORDENADAS.indexOf(d.metodo) !== -1) {
    // Metodos por coordenadas ingresadas: lat/lon salen SIEMPRE de recalcular el valor original (el del cliente, si vino, solo se compara).
    var derivada = ubicacionCorreccionService_derivarDeCoordenadaOriginal(d);
    if (!derivada.ok) {
      return derivada;
    }
    lat = derivada.lat;
    lon = derivada.lon;
    coordenadaOriginalTexto = derivada.coordenadaOriginalTexto;
    crsOriginal = derivada.crsOriginal;
  } else {
    if (d.coordenadaOriginal !== null && d.coordenadaOriginal !== undefined) {
      return ubicacionCorreccionService_error('INVALID_COORDENADA_ORIGINAL', d.metodo + ' no lleva coordenadaOriginal');
    }
    if (!ubicacionCorreccionService_esNumero(d.lat) || !ubicacionCorreccionService_esNumero(d.lon)) {
      return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'lat y lon deben ser numeros');
    }
    if (d.lat < -90 || d.lat > 90 || d.lon < -180 || d.lon > 180 || (d.lat === 0 && d.lon === 0)) {
      return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'coordenadas fuera de rango');
    }
    lat = ubicacionCorreccionService_redondear(d.lat, 6);
    lon = ubicacionCorreccionService_redondear(d.lon, 6);
    if (!ubicacionCorreccionService_dentroDeMendoza(lat, lon)) {
      return ubicacionCorreccionService_error('FUERA_DE_MENDOZA', 'La ubicacion queda fuera de Mendoza');
    }
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
    return ubicacionCorreccionService_error('INVALID_PRECISION', d.metodo + ' no lleva precision de GPS');
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
    valores: {
      clientRequestId: d.clientRequestId, metodo: d.metodo, lat: lat, lon: lon, precisionGpsM: precision, observacion: observacion,
      coordenadaOriginalTexto: coordenadaOriginalTexto, crsOriginal: crsOriginal
    }
  };
}

// --- Metodos por coordenadas ingresadas (COORDENADAS_GMS / COORDENADAS_POSGAR94_AR2) ---

function ubicacionCorreccionService_esObjetoPlano(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Un valor tipeado llega como numero o texto corto (o vacio, donde el modulo lo permite); cualquier otra cosa (objeto, arreglo, booleano, texto enorme) es de forma
// invalida. soloTexto (el hemisferio): ni siquiera un numero.
function ubicacionCorreccionService_valorOriginalValido(v, soloTexto) {
  if (v === null || v === undefined || (typeof v === 'number' && soloTexto !== true)) {
    return true;
  }
  return typeof v === 'string' && v.length <= UBICACION_CORR_COORD_VALOR_MAX_CARACTERES;
}

function ubicacionCorreccionService_clavesPermitidas(objeto, permitidas) {
  return Object.keys(objeto).every(function (k) { return permitidas.indexOf(k) !== -1; });
}

// Forma de coordenadaOriginal segun el metodo. null = forma correcta; si no, el mensaje. Estricta: sin claves de mas ni de menos, para que el contrato con el cliente sea unico.
function ubicacionCorreccionService_errorDeFormaOriginal(metodo, original) {
  var forma = UBICACION_CORR_COORD_ORIGINAL_FORMA[metodo];
  if (!ubicacionCorreccionService_esObjetoPlano(original)) {
    return metodo + ' requiere coordenadaOriginal (objeto con ' + forma.claves.join(' y ') + ')';
  }
  if (!ubicacionCorreccionService_clavesPermitidas(original, forma.claves) || forma.claves.some(function (k) { return !(k in original); })) {
    return 'coordenadaOriginal de ' + metodo + ' lleva exactamente: ' + forma.claves.join(', ');
  }
  for (var i = 0; i < forma.claves.length; i++) {
    var parte = original[forma.claves[i]];
    if (forma.subclaves === null) {
      if (!ubicacionCorreccionService_valorOriginalValido(parte)) {
        return 'coordenadaOriginal.' + forma.claves[i] + ' debe ser un numero o un texto';
      }
    } else {
      if (!ubicacionCorreccionService_esObjetoPlano(parte) || !ubicacionCorreccionService_clavesPermitidas(parte, forma.subclaves)) {
        return 'coordenadaOriginal.' + forma.claves[i] + ' lleva solo: ' + forma.subclaves.join(', ');
      }
      for (var j = 0; j < forma.subclaves.length; j++) {
        if (!ubicacionCorreccionService_valorOriginalValido(parte[forma.subclaves[j]], forma.subclaves[j] === 'h')) {
          return 'coordenadaOriginal.' + forma.claves[i] + '.' + forma.subclaves[j] + (forma.subclaves[j] === 'h' ? ' debe ser un texto' : ' debe ser un numero o un texto');
        }
      }
    }
  }
  return null;
}

// Errores del modulo de conversion -> respuesta del servicio. Los generales mantienen su codigo (XY_INVERTIDOS, FUERA_DE_MENDOZA: el mismo que ya existia
// para los otros metodos); el resto sale como COORDENADA_INVALIDA con el codigo fino en "detalle" y el campo en "campo" (p. ej. lat.m, x).
function ubicacionCorreccionService_errorDeConversion(metodo, evaluacion) {
  var errores = evaluacion.errores || {};
  if (errores.general) {
    if (errores.general.codigo === 'XY_INVERTIDOS') {
      return ubicacionCorreccionService_error('XY_INVERTIDOS', errores.general.mensaje);
    }
    if (errores.general.codigo === 'FUERA_DE_MENDOZA') {
      return ubicacionCorreccionService_error('FUERA_DE_MENDOZA', errores.general.mensaje);
    }
    return ubicacionCorreccionService_error('COORDENADA_INVALIDA', errores.general.mensaje, { detalle: errores.general.codigo });
  }
  var campos = metodo === 'COORDENADAS_GMS' ? ['lat', 'lon'] : ['x', 'y'];
  for (var i = 0; i < campos.length; i++) {
    var e = errores[campos[i]];
    if (e) {
      var campo = metodo === 'COORDENADAS_GMS' ? campos[i] + '.' + e.campo : campos[i];
      return ubicacionCorreccionService_error('COORDENADA_INVALIDA', e.mensaje, { detalle: e.codigo, campo: campo });
    }
  }
  return ubicacionCorreccionService_error('COORDENADA_INVALIDA', 'La coordenada ingresada no es valida');
}

// lat/lon (opcionales) que mando el cliente como preview: si vienen deben ser numeros y estar a no mas de UBICACION_CORR_COORD_TOLERANCIA_M (2 cm) de lo que
// recalculo el backend. latBackend/lonBackend son la conversion SIN redondear; el valor del cliente se usa sin redondear.
function ubicacionCorreccionService_errorDePreviewCliente(d, latBackend, lonBackend) {
  var sinLat = d.lat === null || d.lat === undefined;
  var sinLon = d.lon === null || d.lon === undefined;
  if (sinLat && sinLon) {
    return null;
  }
  if (!ubicacionCorreccionService_esNumero(d.lat) || !ubicacionCorreccionService_esNumero(d.lon)) {
    return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'lat y lon deben ser numeros');
  }
  if (d.lat < -90 || d.lat > 90 || d.lon < -180 || d.lon > 180) {
    return ubicacionCorreccionService_error('INVALID_COORDENADAS', 'coordenadas fuera de rango');
  }
  var difM = ubicacionCorreccionService_distanciaMetrosExacta(latBackend, lonBackend, d.lat, d.lon);
  if (difM > UBICACION_CORR_COORD_TOLERANCIA_M) {
    return ubicacionCorreccionService_error('COORDENADA_INCONSISTENTE',
      'Las coordenadas enviadas no coinciden con el valor ingresado. Volvé a ingresar la coordenada.');
  }
  return null;
}

// COORDENADAS_*: valida la forma de coordenadaOriginal, la RECALCULA con el modulo de conversion del backend (CoordenadasConversion.js) y compara con el
// preview del cliente. Devuelve {ok, lat, lon, coordenadaOriginalTexto, crsOriginal} (lat/lon a 6 decimales, dentro de la caja de Mendoza) o el error.
// El texto canonico y el CRS los genera el backend: jamas se aceptan del cliente.
function ubicacionCorreccionService_derivarDeCoordenadaOriginal(d) {
  var errorForma = ubicacionCorreccionService_errorDeFormaOriginal(d.metodo, d.coordenadaOriginal);
  if (errorForma !== null) {
    return ubicacionCorreccionService_error('INVALID_COORDENADA_ORIGINAL', errorForma);
  }
  var ev = d.metodo === 'COORDENADAS_GMS' ? coordenadas_evaluarGms(d.coordenadaOriginal) : coordenadas_evaluarPosgar(d.coordenadaOriginal);
  if (!ev.ok) {
    return ubicacionCorreccionService_errorDeConversion(d.metodo, ev);
  }
  if (!ubicacionCorreccionService_esNumero(ev.lat) || !ubicacionCorreccionService_esNumero(ev.lon) || !ubicacionCorreccionService_dentroDeMendoza(ev.lat, ev.lon)) {
    return ubicacionCorreccionService_error('FUERA_DE_MENDOZA', 'La ubicacion queda fuera de Mendoza');
  }
  var errorPreview = ubicacionCorreccionService_errorDePreviewCliente(d, ev.latExacta, ev.lonExacta);
  if (errorPreview !== null) {
    return errorPreview;
  }
  return { ok: true, lat: ev.lat, lon: ev.lon, coordenadaOriginalTexto: ev.textoOriginal, crsOriginal: ev.crsOriginal };
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
    coordenadaOriginalTexto: c.coordenadaOriginalTexto || '',
    crsOriginal: c.crsOriginal || '',
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
  var vigente = ubicacionCorreccionService_elegirVigente(delPozo);
  return {
    wellId: wellId,
    vigente: vigente ? v(vigente) : null,
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

// --- Ubicaciones validadas vigentes (delta del PUNTO OPERATIVO: getUbicacionesValidadas) ---
// Una sola interpretacion de la cadena de estados: se parte de ubicacionCorreccionService_leerDerivadas() (la misma que usan getPorPozo y la cola) y la VIGENTE de un
// pozo se elige con ubicacionCorreccionService_elegirVigente(), la MISMA rutina que usa getPorPozo. Solo una correccion en estado VALIDADA genera delta: SUPERADA,
// REVERTIDA, RECHAZADA, PROPUESTA e INCONSISTENTE no.
// Payload MINIMO (lo recibe cualquier usuario activo, igual que getMapaPozos): {wellId, lat, lon, vts}. Nada de autor, observacion, metodo, motivo, ids, coordenada
// original, distancia ni snapshot del padron: es la ubicacion final que reemplaza a la base que esos mismos usuarios ya ven.
// vts = timestamp del evento VALIDADA vigente (la hoja UbicacionCorreccionesLog, columna `timestamp`): el instante en que esa ubicacion paso a ser la vigente. No es
// la fecha de la propuesta.
var UBICACION_VALIDADAS_CACHE_KEY = 'ubicaciones_validadas_v1';
var UBICACION_VALIDADAS_INVAL_KEY = 'ubicaciones_validadas_v1_inval';
var UBICACION_VALIDADAS_CACHE_SEGUNDOS = 120;
var UBICACION_VALIDADAS_INVAL_SEGUNDOS = 180;
var UBICACION_VALIDADAS_CACHE_MAX_CARACTERES = 90000;      // CacheService admite 100 KB por valor: pasado esto no se cachea (se calcula en cada llamada)
var UBICACION_VALIDADAS_MARGEN_CARRERA_MS = 2000;

// De una lista de correcciones derivadas DE UN MISMO POZO, la vigente: la VALIDADA mas reciente (misma regla que getPorPozo: orden de masReciente). null si no hay.
function ubicacionCorreccionService_elegirVigente(delPozo) {
  var ordenadas = (delPozo || []).slice().sort(ubicacionCorreccionService_masReciente);
  var vigentes = ordenadas.filter(function (c) { return c.estado === 'VALIDADA'; });
  return vigentes.length ? vigentes[0] : null;
}

function ubicacionCorreccionService_isoDe(valor) {
  if (valor instanceof Date) {
    return isNaN(valor.getTime()) ? '' : valor.toISOString();
  }
  return typeof valor === 'string' ? valor : '';
}

// derivadas -> [{wellId, lat, lon, vts}] ordenado por wellId. Coordenadas invalidas (no numericas o fuera de Mendoza) no salen.
function ubicacionCorreccionService_ubicacionesValidadas(derivadas) {
  var porPozo = {};
  (derivadas || []).forEach(function (c) {
    if (c.estado === 'VALIDADA') {
      (porPozo[c.wellId] = porPozo[c.wellId] || []).push(c);
    }
  });
  var salida = [];
  Object.keys(porPozo).sort().forEach(function (wellId) {
    var c = ubicacionCorreccionService_elegirVigente(porPozo[wellId]);
    if (!c || !ubicacionCorreccionService_esNumero(c.lat) || !ubicacionCorreccionService_esNumero(c.lon) || !ubicacionCorreccionService_dentroDeMendoza(c.lat, c.lon)) {
      return;
    }
    var vts = ubicacionCorreccionService_isoDe(c.ultimoEvento ? c.ultimoEvento.timestamp : null) || ubicacionCorreccionService_isoDe(c.timestamp);
    salida.push({ wellId: wellId, lat: c.lat, lon: c.lon, vts: vts });
  });
  return salida;
}

function ubicacionCorreccionService_logCache(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Ubicaciones validadas (cache): ' + mensaje);
  }
}

// El cache nunca es indispensable: si CacheService falla se sigue sin el.
function ubicacionCorreccionService_cacheValidadas() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    ubicacionCorreccionService_logCache('CacheService no disponible: ' + String(err));
    return null;
  }
}

// Se llama DESPUES de que la escritura que cambia la vigente quedo confirmada (SpreadsheetApp.flush dentro del repositorio). NUNCA lanza: si falla, la operacion
// principal sigue y el TTL (120 s) acota el desfasaje. Ademas deja una marca con la hora de la invalidacion: un lector que empezo a calcular ANTES de ella no guarda su
// resultado (posiblemente viejo) en el cache (ver getUbicacionesValidadas).
function ubicacionCorreccionService_invalidarUbicacionesValidadas() {
  var cache = ubicacionCorreccionService_cacheValidadas();
  if (!cache) {
    return false;
  }
  var ok = true;
  try {
    cache.put(UBICACION_VALIDADAS_INVAL_KEY, String(Date.now()), UBICACION_VALIDADAS_INVAL_SEGUNDOS);
  } catch (err) {
    ok = false;
    ubicacionCorreccionService_logCache('no se pudo marcar la invalidacion: ' + String(err));
  }
  try {
    cache.remove(UBICACION_VALIDADAS_CACHE_KEY);
  } catch (err) {
    ok = false;
    ubicacionCorreccionService_logCache('no se pudo invalidar: ' + String(err));
  }
  return ok;
}

// {ubicaciones: [{wellId, lat, lon, vts}]}. Primero el cache (contenido ya sanitizado); si no esta, se calcula desde las hojas y se guarda 120 s.
function ubicacionCorreccionService_getUbicacionesValidadas() {
  var cache = ubicacionCorreccionService_cacheValidadas();
  if (cache) {
    try {
      var crudo = cache.get(UBICACION_VALIDADAS_CACHE_KEY);
      if (crudo !== null && crudo !== undefined) {
        var parseado = JSON.parse(crudo);
        if (parseado && Array.isArray(parseado.ubicaciones)) {
          return parseado;
        }
      }
    } catch (err) {
      ubicacionCorreccionService_logCache('lectura de cache invalida, se recalcula: ' + String(err));
    }
  }

  var inicio = Date.now();
  var payload = { ubicaciones: ubicacionCorreccionService_ubicacionesValidadas(ubicacionCorreccionService_leerDerivadas()) };

  if (cache) {
    try {
      var marca = cache.get(UBICACION_VALIDADAS_INVAL_KEY);
      var invalidadaDuranteElCalculo = marca !== null && marca !== undefined && Number(marca) >= inicio - UBICACION_VALIDADAS_MARGEN_CARRERA_MS;
      var json = JSON.stringify(payload);
      if (invalidadaDuranteElCalculo) {
        ubicacionCorreccionService_logCache('se invalido mientras se calculaba: no se guarda');
      } else if (json.length > UBICACION_VALIDADAS_CACHE_MAX_CARACTERES) {
        ubicacionCorreccionService_logCache('payload de ' + json.length + ' caracteres: supera el limite de CacheService, no se guarda');
      } else {
        cache.put(UBICACION_VALIDADAS_CACHE_KEY, json, UBICACION_VALIDADAS_CACHE_SEGUNDOS);
      }
    } catch (err) {
      ubicacionCorreccionService_logCache('no se pudo guardar: ' + String(err));
    }
  }
  return payload;
}

// --- Escrituras ---

// Eventos que dejan VIGENTE a una correccion: SUPERADA para la VALIDADA anterior del mismo pozo (si hay) y despues VALIDADA para esta. Es la misma
// secuencia para validar() y para la creacion auto-validada. derivadas = estado actual (leido DENTRO del lock).
function ubicacionCorreccionService_eventosDeValidacion(derivadas, correccionId, wellId, ahora, emailN, nombre, motivo) {
  var eventos = [];
  var supersedidas = [];
  derivadas.forEach(function (c) {
    if (c.wellId === wellId && c.estado === 'VALIDADA' && c.correccionId !== correccionId) {
      supersedidas.push(c.correccionId);
      eventos.push({
        correccionId: c.correccionId, timestamp: ahora, evento: 'SUPERADA', email: emailN, nombre: nombre || '',
        motivo: 'Superada por la correccion ' + correccionId
      });
    }
  });
  eventos.push({ correccionId: correccionId, timestamp: ahora, evento: 'VALIDADA', email: emailN, nombre: nombre || '', motivo: motivo || '' });
  return { eventos: eventos, supersedidas: supersedidas };
}

// Misma solicitud = mismo pozo, metodo y punto WGS84 Y el mismo valor ORIGINAL canonico: dos coordenadas distintas que dan el mismo punto (o el mismo
// punto escrito en GMS y en POSGAR) NO son necesariamente la misma solicitud. En los metodos viejos ambos campos son '' (filas historicas incluidas).
function ubicacionCorreccionService_mismaSolicitud(existente, v, wellId) {
  return existente.wellId === wellId && existente.metodo === v.metodo &&
    Math.abs(existente.lat - v.lat) < 1e-9 && Math.abs(existente.lon - v.lon) < 1e-9 &&
    (existente.coordenadaOriginalTexto || '') === (v.coordenadaOriginalTexto || '') &&
    (existente.crsOriginal || '') === (v.crsOriginal || '');
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
//  - estado consistente -> reenvio idempotente (duplicada:true). NUNCA agrega eventos: un reintento no puede producir una segunda VALIDADA, ni
//    validar una PROPUESTA que ya estaba escrita (esa la valida quien corresponda con validar()).
//  - autocurado + auto (quien reintenta tiene hoy ubicacion_validar): ademas del PROPUESTA faltante se escribe, en la MISMA escritura, la
//    validacion (SUPERADA/VALIDADA): es completar la creacion directa que se habia cortado.
function ubicacionCorreccionService_atenderExistente(existente, v, wellId, email, emailN, nombre, auto) {
  if (!ubicacionCorreccionService_mismaSolicitud(existente, v, wellId)) {
    return ubicacionCorreccionService_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido', { wellId: wellId });
  }
  var curada = false;
  var supersedidas = null;
  if (existente.estado === UBICACION_CORR_ESTADO_INCONSISTENTE) {
    if (existente.eventos.length > 0) {
      return ubicacionCorreccionService_error('INCONSISTENT_STATE', 'el historial de la correccion es inconsistente: requiere revision manual', { wellId: existente.wellId });
    }
    var cuando = existente.timestamp ? new Date(existente.timestamp) : new Date();
    var aEscribir = [{
      correccionId: existente.correccionId, timestamp: cuando, evento: 'PROPUESTA', email: emailN, nombre: nombre || '', motivo: UBICACION_CORR_MOTIVO_AUTOCURADO
    }];
    if (auto === true) {
      var val = ubicacionCorreccionService_eventosDeValidacion(
        ubicacionCorreccionService_leerDerivadas(), existente.correccionId, existente.wellId, new Date(), emailN, nombre, UBICACION_CORR_MOTIVO_AUTOVALIDACION);
      aEscribir = aEscribir.concat(val.eventos);
      supersedidas = val.supersedidas;
    }
    ubicacionCorreccionRepository_agregarEventos(aEscribir);
    if (auto === true) {
      ubicacionCorreccionService_invalidarUbicacionesValidadas();       // la escritura ya incluye una VALIDADA: cambio la vigente
    }
    existente = ubicacionCorreccionService_buscarPorClientRequestId(ubicacionCorreccionService_leerDerivadas(), emailN, v.clientRequestId);
    curada = true;
  }
  var r = { ok: true, correccion: ubicacionCorreccionService_vista(existente, email), duplicada: true, curada: curada };
  if (supersedidas !== null) {
    r.autoValidada = true;
    r.supersedidas = supersedidas;
  }
  return r;
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
//
// opciones.autoValidar === true (lo decide Api.js: el usuario tiene ubicacion_corregir Y ubicacion_validar): la correccion nace VIGENTE. Dentro del
// mismo lock se escriben PROPUESTA, SUPERADA de la anterior (si hay) y VALIDADA, todos a nombre del mismo usuario, en una sola escritura contigua del
// log. Idempotencia: el reenvio de esa misma solicitud devuelve lo ya creado (duplicada:true) y NO agrega ningun evento (jamas una segunda VALIDADA).
// La respuesta suma autoValidada:true y supersedidas solo cuando ESTA llamada dejo vigente la correccion.
function ubicacionCorreccionService_proponer(email, nombre, wellId, datos, opciones) {
  var auto = !!opciones && opciones.autoValidar === true;
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
    // Un metodo COORDENADAS_* guarda el valor original: si la hoja todavia es V1 (sin migrar) se rechaza ANTES de tocar el padron o el lock; nunca se
    // descarta ese valor en silencio. GPS_ACTUAL / PUNTO_EN_MAPA no lo necesitan y siguen funcionando en una hoja V1.
    if (v.crsOriginal !== '' && !ubicacionCorreccionRepository_esquemaCorreccionesV2()) {
      return ubicacionCorreccionService_error('ESQUEMA_DESACTUALIZADO',
        'El servidor todavia no esta preparado para guardar coordenadas ingresadas (falta actualizar la hoja de correcciones). Avisá al administrador.');
    }
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
    var derivadasEnLock = ubicacionCorreccionService_leerDerivadas();
    var existente = ubicacionCorreccionService_buscarPorClientRequestId(derivadasEnLock, emailN, v.clientRequestId);
    if (existente) {
      return ubicacionCorreccionService_atenderExistente(existente, v, wellId, email, emailN, nombre, auto);
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
      clientRequestId: v.clientRequestId,
      coordenadaOriginalTexto: v.coordenadaOriginalTexto,
      crsOriginal: v.crsOriginal
    };
    var evento = { correccionId: correccion.correccionId, timestamp: ahora, evento: 'PROPUESTA', email: emailN, nombre: nombre || '', motivo: '' };
    var aEscribir = [evento];
    var supersedidas = [];
    if (auto) {
      var val = ubicacionCorreccionService_eventosDeValidacion(derivadasEnLock, correccion.correccionId, wellId, ahora, emailN, nombre, UBICACION_CORR_MOTIVO_AUTOVALIDACION);
      aEscribir = aEscribir.concat(val.eventos);
      supersedidas = val.supersedidas;
    }
    ubicacionCorreccionRepository_agregarCorreccionConEventos(correccion, aEscribir);
    if (auto) {
      ubicacionCorreccionService_invalidarUbicacionesValidadas();       // nacio VALIDADA (y supersedio a la anterior): cambio la vigente
    }

    var iso = ahora.toISOString();
    var derivada = ubicacionCorreccionService_derivar(
      [Object.assign({}, correccion, { timestamp: iso })],
      aEscribir.filter(function (e) { return e.correccionId === correccion.correccionId; }).map(function (e) { return Object.assign({}, e, { timestamp: iso }); })
    )[0];
    var resp = { ok: true, correccion: ubicacionCorreccionService_vista(derivada, email), duplicada: false, curada: false };
    if (auto) {
      resp.autoValidada = true;
      resp.supersedidas = supersedidas;
    }
    return resp;
  });
}

var UBICACION_CORR_ACCIONES = {
  validar: { hasta: 'VALIDADA', motivoObligatorio: false },
  rechazar: { hasta: 'RECHAZADA', motivoObligatorio: true },
  revertir: { hasta: 'REVERTIDA', motivoObligatorio: true }
};

// validar / rechazar / revertir: UNA sola rutina para que las transiciones y el lock sean identicos. Los errores incluyen el
// wellId de la correccion (cuando se la encontro) para la auditoria. Quien tiene ubicacion_validar PUEDE validar una propuesta propia ya
// existente (no hay restriccion de autoria al validar); lo que sigue vedado es RECHAZAR la propia (rechazar es una decision sobre lo de otro).
// Validar escribe, en UNA sola escritura contigua, SUPERADA para la validada anterior del mismo pozo (si hay) y despues VALIDADA para la nueva.
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
    if (accion === 'rechazar' && esPropia) {
      // RECHAZADA es una decision de quien valida: el autor no retira su propia propuesta por esta via (un retiro por el autor, si
      // se quisiera, seria un evento aparte).
      return ubicacionCorreccionService_error('SELF_REJECTION', 'quien propone una correccion no puede rechazarla', extra);
    }

    var ahora = new Date();
    var eventos;
    var supersedidas = [];
    if (accion === 'validar') {
      var val = ubicacionCorreccionService_eventosDeValidacion(derivadas, objetivo.correccionId, objetivo.wellId, ahora, emailN, nombre, m.motivo);
      eventos = val.eventos;
      supersedidas = val.supersedidas;
    } else {
      eventos = [{ correccionId: objetivo.correccionId, timestamp: ahora, evento: regla.hasta, email: emailN, nombre: nombre || '', motivo: m.motivo }];
    }
    ubicacionCorreccionRepository_agregarEventos(eventos);
    if (accion === 'validar' || accion === 'revertir') {
      ubicacionCorreccionService_invalidarUbicacionesValidadas();       // rechazar no cambia la vigente: no invalida
    }

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
    UBICACION_CORR_METODOS_COORDENADAS,
    UBICACION_CORR_COORD_TOLERANCIA_M,
    UBICACION_CORR_EVENTOS,
    UBICACION_CORR_TRANSICIONES,
    UBICACION_CORR_ESTADO_INCONSISTENTE,
    UBICACION_CORR_GPS_PRECISION_MAX_M,
    UBICACION_CORR_OBSERVACION_DESDE_M,
    UBICACION_CORR_ADVERTENCIA_DESDE_M,
    UBICACION_CORR_OBSERVACION_MAX,
    UBICACION_CORR_MENDOZA_BBOX,
    UBICACION_CORR_PENDIENTES_MAX,
    UBICACION_VALIDADAS_CACHE_KEY,
    UBICACION_VALIDADAS_CACHE_SEGUNDOS,
    ubicacionCorreccionService_distanciaMetros,
    ubicacionCorreccionService_distanciaMetrosExacta,
    ubicacionCorreccionService_dentroDeMendoza,
    ubicacionCorreccionService_validarPropuesta,
    ubicacionCorreccionService_snapshotIrrigacion,
    ubicacionCorreccionService_derivar,
    ubicacionCorreccionService_vista,
    ubicacionCorreccionService_getPorPozo,
    ubicacionCorreccionService_getPendientes,
    ubicacionCorreccionService_elegirVigente,
    ubicacionCorreccionService_ubicacionesValidadas,
    ubicacionCorreccionService_getUbicacionesValidadas,
    ubicacionCorreccionService_invalidarUbicacionesValidadas,
    ubicacionCorreccionService_proponer,
    ubicacionCorreccionService_validar,
    ubicacionCorreccionService_rechazar,
    ubicacionCorreccionService_revertir
  };
}
