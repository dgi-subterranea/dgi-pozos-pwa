// Correcciones de ubicacion de pozos (frontend, etapa 1: ficha individual): logica PURA, sin DOM, sin red, sin Leaflet - todo lo que se
// puede testear con Jest. El controlador DOM (js/ubicacionCorreccion.js) solo cablea esto con el modal, el GPS, el mapa y js/api.js.
//
// Principios:
//  - El backend es la autoridad (permisos, distancia, observacion obligatoria, snapshot de Irrigacion, estado final). Lo que se calcula
//    aca (distancia, "observacion obligatoria", advertencia de 1 km) es SOLO guia de UX y usa las mismas reglas que el backend.
//  - La coordenada oficial de Irrigacion es inmutable: nada de este modulo la modifica ni la oculta; una correccion es otro dato.
//  - Del cliente solo salen los campos de construirPayload(): jamas email, nombre, autoValidar, distancia, estado ni datos de Irrigacion.
//  - La UI no decide el estado final: lo informa el backend (data.correccion.estado) y despues se relee la ficha.
var UCORR_GPS_PRECISION_MAX_M = 50;
var UCORR_OBSERVACION_DESDE_M = 250;      // MAS de esta distancia a Irrigacion: observacion obligatoria
var UCORR_ADVERTENCIA_DESDE_M = 1000;     // MAS de esta distancia: advertencia fuerte (no bloquea)
var UCORR_OBSERVACION_MAX = 300;
var UCORR_METODOS = ['GPS_ACTUAL', 'PUNTO_EN_MAPA'];
var UCORR_ESTADOS_CON_COORDENADA = { corroborada: true, unica: true };      // igual que el backend: solo ahi hay "la" coordenada oficial
var UCORR_TEXTO_ADVERTENCIA_1KM = 'La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.';
var UCORR_TEXTO_NO_REEMPLAZA = 'La corrección no reemplaza ni modifica la ubicación de Irrigación: son datos separados.';
var UCORR_CODIGOS_SESION = ['UNAUTHORIZED', 'USER_DISABLED'];
var UCORR_MENDOZA_CENTRO = { lat: -34.6, lon: -68.6, zoom: 7 };

var UCORR_ETIQUETAS_ESTADO = {
  PROPUESTA: 'Pendiente',
  VALIDADA: 'Validada en campo',
  RECHAZADA: 'Rechazada',
  SUPERADA: 'Reemplazada por una corrección posterior',
  REVERTIDA: 'Revertida',
  INCONSISTENTE: 'Inconsistente'
};
var UCORR_ETIQUETAS_METODO = { PUNTO_EN_MAPA: 'Elegida en mapa', GPS_ACTUAL: 'GPS' };

// --- Permisos ---

// Fail-closed: solo el valor EXACTO true de ambos permisos (nada de "SI", 1, ausente o truthy). El backend vuelve a validar.
function ubicacionCorreccionLogic_puedeCorregir(permisos) {
  return !!permisos && permisos.ubicacion === true && permisos.ubicacion_corregir === true;
}

// Fail-closed: ver y validar la cola exige los DOS permisos (igual que el backend: getCorreccionesUbicacionPendientes pide ubicacion + ubicacion_validar).
function ubicacionCorreccionLogic_puedeValidar(permisos) {
  return !!permisos && permisos.ubicacion === true && permisos.ubicacion_validar === true;
}

// --- Numeros, distancia, formato ---

function ubicacionCorreccionLogic_esNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

function ubicacionCorreccionLogic_redondear(valor, decimales) {
  var f = Math.pow(10, decimales);
  return Math.round(valor * f) / f;
}

// Haversine en metros (mismo radio que el backend), con 1 decimal.
function ubicacionCorreccionLogic_distanciaMetros(lat1, lon1, lat2, lon2) {
  var R = 6371008.8;
  var rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad;
  var dLon = (lon2 - lon1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return ubicacionCorreccionLogic_redondear(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 1);
}

// 22.2 -> "22,2 m"; 120 -> "120 m"; 1430 -> "1,4 km"; 12500 -> "12,5 km"
function ubicacionCorreccionLogic_formatearDistancia(metros) {
  if (!ubicacionCorreccionLogic_esNumero(metros)) {
    return '';
  }
  if (metros >= 1000) {
    return String(ubicacionCorreccionLogic_redondear(metros / 1000, 1)).replace('.', ',') + ' km';
  }
  return String(ubicacionCorreccionLogic_redondear(metros, 1)).replace('.', ',') + ' m';
}

// Coordenada tal como esta, hasta 6 decimales y sin ceros de relleno: -33.34745
function ubicacionCorreccionLogic_formatearCoord(n) {
  return ubicacionCorreccionLogic_esNumero(n) ? String(ubicacionCorreccionLogic_redondear(n, 6)) : '';
}

function ubicacionCorreccionLogic_formatearCoordenadas(lat, lon) {
  return ubicacionCorreccionLogic_formatearCoord(lat) + ', ' + ubicacionCorreccionLogic_formatearCoord(lon);
}

// ISO -> "12/10/2026 14:05" en hora local del dispositivo ('' si no es una fecha valida)
function ubicacionCorreccionLogic_formatearFecha(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d.getTime())) {
    return '';
  }
  var dos = function (n) { return (n < 10 ? '0' : '') + n; };
  return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
}

function ubicacionCorreccionLogic_urlGoogleMaps(lat, lon) {
  return 'https://www.google.com/maps?q=' + ubicacionCorreccionLogic_formatearCoord(lat) + ',' + ubicacionCorreccionLogic_formatearCoord(lon);
}

function ubicacionCorreccionLogic_etiquetaEstado(estado) {
  return UCORR_ETIQUETAS_ESTADO[estado] || 'Estado desconocido';
}

function ubicacionCorreccionLogic_etiquetaMetodo(metodo) {
  return UCORR_ETIQUETAS_METODO[metodo] || String(metodo || '');
}

// --- Ubicacion de Irrigacion (la oficial) ---

// getWellLocation devuelve {ubicacionResuelta:{estado, lat, lon, ...}}. Solo corroborada/unica tienen coordenada oficial; con fuentes en
// desacuerdo o sin datos NO hay "la" coordenada (igual que el backend) y no se calcula distancia.
function ubicacionCorreccionLogic_irrigacionDeUbicacion(location) {
  var r = location && location.ubicacionResuelta;
  if (!r || UCORR_ESTADOS_CON_COORDENADA[r.estado] !== true) {
    return null;
  }
  if (!ubicacionCorreccionLogic_esNumero(r.lat) || !ubicacionCorreccionLogic_esNumero(r.lon)) {
    return null;
  }
  return { lat: r.lat, lon: r.lon, estado: r.estado };
}

// --- Visibilidad del modulo Ubicacion en el hub ---
// El permiso de CORREGIR controla el boton "Corregir ubicacion"; el de VER ("ubicacion") controla la informacion. Un pozo sin coordenada oficial
// igual muestra el modulo si hay algo para ver (una correccion registrada: vigente, pendiente o en el historial) o algo para hacer (corregir).

// Hay coordenada oficial utilizable por el modulo (el padron la resolvio o hay fuentes en desacuerdo que un tecnico debe revisar).
function ubicacionCorreccionLogic_oficialDisponible(location) {
  var r = location && location.ubicacionResuelta;
  return !!r && r.estado !== 'sinCoordenadas';
}

// lectura: data de getCorreccionesUbicacionPozo ({vigente, pendientes, historial}) o null
function ubicacionCorreccionLogic_tieneCorrecciones(lectura) {
  return !!lectura && (!!lectura.vigente || (lectura.pendientes || []).length > 0 || (lectura.historial || []).length > 0);
}

// o: {ubicacionFound, location, permisos, correcciones}. ubicacionFound = el backend dejo leer la ubicacion (implica permiso "ubicacion").
function ubicacionCorreccionLogic_ofrecerModulo(o) {
  var d = o || {};
  if (!d.ubicacionFound) {
    return false;
  }
  return ubicacionCorreccionLogic_oficialDisponible(d.location) ||
    ubicacionCorreccionLogic_puedeCorregir(d.permisos) ||
    ubicacionCorreccionLogic_tieneCorrecciones(d.correcciones);
}

// ¿Hace falta preguntar por correcciones al buscar el pozo? Solo cuando el pozo NO tiene coordenada oficial y el modulo no se ofreceria igual
// (quien puede corregir ya lo ve): es el unico caso en que "hay una correccion" cambia si la tarjeta aparece.
function ubicacionCorreccionLogic_necesitaConsultarCorrecciones(o) {
  var d = o || {};
  return !!d.ubicacionFound && !ubicacionCorreccionLogic_oficialDisponible(d.location) && !!d.permisos && d.permisos.ubicacion === true &&
    !ubicacionCorreccionLogic_puedeCorregir(d.permisos);
}

// --- GPS ---

// accuracy de la Geolocation API en metros. Invalida (no numerica, 0, negativa) o > 50 m: NO se puede guardar.
function ubicacionCorreccionLogic_evaluarGps(accuracy) {
  if (!ubicacionCorreccionLogic_esNumero(accuracy) || accuracy <= 0) {
    return { valido: false, motivo: 'invalida', precisionM: null, mensaje: 'No pudimos medir la precisión del GPS. Probá a cielo abierto e intentá nuevamente.' };
  }
  if (accuracy > UCORR_GPS_PRECISION_MAX_M) {
    return {
      valido: false, motivo: 'insuficiente', precisionM: accuracy,
      mensaje: 'La precisión actual es de ' + Math.round(accuracy) + ' m. Necesitamos ' + UCORR_GPS_PRECISION_MAX_M + ' m o menos para guardar.'
    };
  }
  return { valido: true, motivo: null, precisionM: ubicacionCorreccionLogic_redondear(accuracy, 1), mensaje: '' };
}

// --- Evaluacion de la propuesta (reglas de UX, el backend manda) ---

// o: {lat, lon, metodo, precisionGpsM, observacion, irrigacion:{lat,lon}|null}
// Devuelve {ok, errores:{punto?, gps?, observacion?}, distanciaM|null, observacionObligatoria, advertenciaFuerte, observacion}
function ubicacionCorreccionLogic_evaluarPropuesta(o) {
  var d = o || {};
  var errores = {};
  var res = { ok: false, errores: errores, distanciaM: null, observacionObligatoria: false, advertenciaFuerte: false, observacion: '' };

  if (!ubicacionCorreccionLogic_esNumero(d.lat) || !ubicacionCorreccionLogic_esNumero(d.lon) || d.lat < -90 || d.lat > 90 || d.lon < -180 || d.lon > 180 || (d.lat === 0 && d.lon === 0)) {
    errores.punto = 'Elegí un punto válido.';
  }
  if (UCORR_METODOS.indexOf(d.metodo) === -1) {
    errores.punto = 'Elegí cómo indicar la ubicación.';
  } else if (d.metodo === 'GPS_ACTUAL') {
    var g = ubicacionCorreccionLogic_evaluarGps(d.precisionGpsM);
    if (!g.valido) {
      errores.gps = g.mensaje;
    }
  }

  var obs = typeof d.observacion === 'string' ? d.observacion.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim() : '';
  res.observacion = obs;
  if (obs.length > UCORR_OBSERVACION_MAX) {
    errores.observacion = 'La observación admite hasta ' + UCORR_OBSERVACION_MAX + ' caracteres.';
  }

  if (!errores.punto && d.irrigacion && ubicacionCorreccionLogic_esNumero(d.irrigacion.lat) && ubicacionCorreccionLogic_esNumero(d.irrigacion.lon)) {
    res.distanciaM = ubicacionCorreccionLogic_distanciaMetros(
      d.irrigacion.lat, d.irrigacion.lon, ubicacionCorreccionLogic_redondear(d.lat, 6), ubicacionCorreccionLogic_redondear(d.lon, 6));
    res.observacionObligatoria = res.distanciaM > UCORR_OBSERVACION_DESDE_M;
    res.advertenciaFuerte = res.distanciaM > UCORR_ADVERTENCIA_DESDE_M;
    if (res.observacionObligatoria && obs === '') {
      errores.observacion = 'La ubicación propuesta está a ' + ubicacionCorreccionLogic_formatearDistancia(res.distanciaM) +
        ' de la ubicación de Irrigación: indicá el motivo en la observación (obligatoria a más de ' + UCORR_OBSERVACION_DESDE_M + ' m).';
    }
  }
  res.ok = Object.keys(errores).length === 0;
  return res;
}

// --- Payload: LISTA BLANCA de lo que el cliente manda ---

// Exactamente: wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId. Nada mas (ni aunque 'valores' traiga mas).
function ubicacionCorreccionLogic_construirPayload(wellId, valores, clientRequestId) {
  var v = valores || {};
  return {
    wellId: wellId,
    lat: ubicacionCorreccionLogic_redondear(v.lat, 6),
    lon: ubicacionCorreccionLogic_redondear(v.lon, 6),
    metodo: v.metodo,
    precisionGpsM: v.metodo === 'GPS_ACTUAL' ? ubicacionCorreccionLogic_redondear(v.precisionGpsM, 1) : null,
    observacion: typeof v.observacion === 'string' ? v.observacion.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim() : '',
    clientRequestId: clientRequestId
  };
}

// Mismo contenido <=> misma firma (todo salvo clientRequestId).
function ubicacionCorreccionLogic_firmaPayload(p) {
  return JSON.stringify([p.wellId, p.lat, p.lon, p.metodo, p.precisionGpsM, p.observacion]);
}

// 8 a 64 caracteres [A-Za-z0-9_-] (lo que exige el backend). aleatorio: funcion opcional para tests.
function ubicacionCorreccionLogic_nuevoClientRequestId(aleatorio) {
  if (!aleatorio && typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return 'ucorr-' + crypto.randomUUID();
  }
  var azar = aleatorio || Math.random;
  var s = '';
  while (s.length < 24) {
    s += Math.floor(azar() * 36).toString(36);
  }
  return 'ucorr-' + Date.now().toString(36) + '-' + s;
}

// --- Mensajes ---

var UCORR_MENSAJES_ERROR = {
  INVALID_COORDENADAS: 'Las coordenadas no son válidas.',
  FUERA_DE_MENDOZA: 'La ubicación queda fuera de Mendoza.',
  INVALID_METODO: 'No se pudo identificar cómo se indicó la ubicación. Volvé a elegirla.',
  INVALID_PRECISION: 'La precisión del GPS no es válida. Intentá obtenerla nuevamente.',
  PRECISION_INSUFICIENTE: 'La precisión del GPS no alcanza (hace falta 50 m o menos). Probá a cielo abierto o elegí el punto en el mapa.',
  INVALID_OBSERVACION: 'La observación no es válida (hasta 300 caracteres).',
  INVALID_CLIENT_REQUEST_ID: 'No se pudo preparar el envío. Intentá de nuevo.',
  IDEMPOTENCY_CONFLICT: 'Esta solicitud ya se había enviado con otros datos. Cerrá y volvé a intentarlo.',
  WELL_NOT_FOUND: 'No se encontró el pozo en el padrón.',
  INVALID_WELL_ID: 'El número de pozo no es válido.',
  INCONSISTENT_STATE: 'Esta corrección tiene un problema en su historial y requiere revisión manual.',
  PERMISSION_DENIED: 'No tenés permiso para corregir la ubicación.',
  SERVICE_UNAVAILABLE: 'No se pudo completar la operación. Intentá nuevamente.',
  SERVICE_RETRY: 'El servidor estaba ocupado. Intentá nuevamente.',
  UNAUTHORIZED: 'Tu sesión venció. Iniciá sesión de nuevo.',
  USER_DISABLED: 'Tu cuenta no tiene acceso habilitado. Contactá al administrador.'
};

function ubicacionCorreccionLogic_mensajeError(code, extra) {
  if (code === 'OBSERVACION_REQUERIDA') {
    var d = extra && ubicacionCorreccionLogic_esNumero(extra.distanciaM) ? ' (a ' + ubicacionCorreccionLogic_formatearDistancia(extra.distanciaM) + ' de Irrigación)' : '';
    return 'Indicá el motivo en la observación' + d + ': es obligatoria a más de ' + UCORR_OBSERVACION_DESDE_M + ' m de la ubicación de Irrigación.';
  }
  return UCORR_MENSAJES_ERROR[code] || 'No se pudo guardar la corrección. Intentá nuevamente.';
}

// Errores de la LECTURA (getCorreccionesUbicacionPozo): nunca se muestra el texto tecnico del backend.
function ubicacionCorreccionLogic_mensajeErrorLectura(code) {
  if (code === 'PERMISSION_DENIED') {
    return 'No tenés permiso para ver las correcciones de ubicación.';
  }
  if (code === 'UNAUTHORIZED' || code === 'USER_DISABLED') {
    return UCORR_MENSAJES_ERROR[code];
  }
  return 'No se pudieron cargar las correcciones. Intentá nuevamente.';
}

var UCORR_MENSAJE_VALIDADA = 'Ubicación corregida y validada.';
var UCORR_MENSAJE_PENDIENTE = 'Corrección enviada para validación.';
var UCORR_MENSAJE_RED = 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.';

// La UI NO decide el estado final: lo lee de la respuesta del backend, y de UN solo lugar: data.correccion.estado (campo que SIEMPRE trae la vista
// de la correccion). El flag opcional data.autoValidada (solo presente cuando quien guarda tiene ubicacion_validar) NO es una dependencia: asi la
// pantalla muestra el resultado correcto con cualquier version del backend, tenga o no esa validacion directa. 'validada' | 'pendiente' | 'otro'
function ubicacionCorreccionLogic_resultadoDeRespuesta(resp) {
  var correccion = resp && resp.data && resp.data.correccion;
  if (!correccion) {
    return 'otro';
  }
  if (correccion.estado === 'VALIDADA') {
    return 'validada';
  }
  if (correccion.estado === 'PROPUESTA') {
    return 'pendiente';
  }
  return 'otro';
}

function ubicacionCorreccionLogic_mensajeResultado(resultado) {
  if (resultado === 'validada') { return UCORR_MENSAJE_VALIDADA; }
  if (resultado === 'pendiente') { return UCORR_MENSAJE_PENDIENTE; }
  return 'Corrección registrada.';
}

// --- Flujo de guardado: clientRequestId estable por intento + sin doble envio + refresco posterior ---
//
// deps: {enviar(payload) -> Promise<respuesta>, leer(wellId) -> Promise<respuesta de getCorreccionesUbicacionPozo>, generarId() -> string}
//  - clientRequestId: se genera al primer envio y se REUTILIZA mientras el contenido sea el mismo y el intento no haya terminado bien
//    (reintento tras un corte de red, o tras un error del servidor): el backend lo deduplica. Si el usuario cambia algo (punto,
//    observacion...), es otro contenido => id nuevo (si no, el backend responderia IDEMPOTENCY_CONFLICT). Tras un guardado exitoso se
//    descarta: la proxima correccion es otro intento.
//  - Doble toque / doble click: mientras hay un envio en curso, guardar() devuelve LA MISMA promesa y no vuelve a enviar nada.
//  - Despues de un guardado exitoso SIEMPRE se relee con deps.leer(): la pantalla se pinta desde esa lectura.
// guardar() resuelve (nunca rechaza) con:
//   {tipo:'invalido', errores}
//   {tipo:'ok', resultado, mensaje, correccion, duplicada, lectura|null, lecturaFallida}
//   {tipo:'error', code, mensaje, sesionVencida}
//   {tipo:'red', mensaje}
function ubicacionCorreccionLogic_crearFlujoGuardado(deps) {
  var intento = null;          // {firma, id} del ultimo envio que no termino bien
  var enCurso = null;

  function idPara(payloadSinId) {
    var firma = ubicacionCorreccionLogic_firmaPayload(payloadSinId);
    if (!intento || intento.firma !== firma) {
      intento = { firma: firma, id: deps.generarId() };
    }
    return intento.id;
  }

  function guardar(wellId, valores) {
    if (enCurso) {
      return enCurso;
    }
    var ev = ubicacionCorreccionLogic_evaluarPropuesta(valores);
    if (!ev.ok) {
      return Promise.resolve({ tipo: 'invalido', errores: ev.errores });
    }
    var sinId = ubicacionCorreccionLogic_construirPayload(wellId, valores, null);
    var payload = ubicacionCorreccionLogic_construirPayload(wellId, valores, idPara(sinId));

    enCurso = Promise.resolve()
      .then(function () { return deps.enviar(payload); })
      .then(function (resp) {
        if (!resp || resp.status !== 'ok') {
          var code = resp && resp.code;
          return {
            tipo: 'error', code: code, mensaje: ubicacionCorreccionLogic_mensajeError(code, resp),
            sesionVencida: UCORR_CODIGOS_SESION.indexOf(code) !== -1
          };
        }
        var resultado = ubicacionCorreccionLogic_resultadoDeRespuesta(resp);
        intento = null;                                         // guardado: el proximo envio es otro intento
        var base = {
          tipo: 'ok', resultado: resultado, mensaje: ubicacionCorreccionLogic_mensajeResultado(resultado),
          correccion: resp.data ? resp.data.correccion : null, duplicada: !!(resp.data && resp.data.duplicada)
        };
        return Promise.resolve()
          .then(function () { return deps.leer(wellId); })
          .then(function (lectura) {
            var ok = !!lectura && lectura.status === 'ok';
            base.lectura = ok ? lectura.data : null;
            base.lecturaFallida = !ok;
            return base;
          }, function () {
            base.lectura = null;
            base.lecturaFallida = true;
            return base;
          });
      }, function () {
        return { tipo: 'red', mensaje: UCORR_MENSAJE_RED };       // el id queda guardado: reintentar el MISMO contenido lo reutiliza
      })
      .then(function (r) { enCurso = null; return r; });
    return enCurso;
  }

  return { guardar: guardar, enCurso: function () { return enCurso !== null; } };
}

// --- Indicador "Correcciones pendientes: N" del hub (solo quien valida) ---

var UCORR_BADGE_INTERVALO_MS = 15000;      // entre refrescos AUTOMATICOS (entrar al hub); validar/rechazar y el login refrescan siempre

// '' si no hay nada que mostrar (0 o dato invalido): el indicador se oculta.
function ubicacionCorreccionLogic_textoBadgePendientes(total) {
  return typeof total === 'number' && isFinite(total) && total > 0 && Math.floor(total) === total ? 'Correcciones pendientes: ' + total : '';
}

// getCorreccionesUbicacionPendientes -> {total, inconsistentes, pendientes[]}. Solo se usa "total" (entero >= 0); cualquier otra cosa es un dato invalido.
function ubicacionCorreccionLogic_totalDePendientes(resp) {
  var t = resp && resp.status === 'ok' && resp.data ? resp.data.total : undefined;
  return typeof t === 'number' && isFinite(t) && t >= 0 && Math.floor(t) === t ? t : null;
}

// Estado del indicador, sin DOM. deps: {obtenerContexto() -> {sessionToken, permisos, onSessionExpired, onUserDisabled}|null,
//   consultar(sessionToken) -> Promise<respuesta de getCorreccionesUbicacionPendientes>, pintar(total|null), ahora() -> ms (opcional), intervaloMs (opcional)}
//  - Sin permiso EXACTO (ubicacion + ubicacion_validar) no consulta nada y se oculta (fail-closed).
//  - Un fallo de la consulta (red, servidor) NO bloquea nada: conserva el ultimo valor conocido y la proxima entrada al hub reintenta.
//  - Sesion vencida / usuario deshabilitado se delegan a la app (igual que el resto de las pantallas).
//  - Una respuesta de una consulta vieja (o de otra sesion, tras reset()) se descarta.
//  - refrescar() automatico respeta un intervalo minimo; refrescar(true) / alResolver() / el login lo fuerzan.
// refrescar() resuelve (nunca rechaza) con {tipo: 'ok'|'sin_permiso'|'reciente'|'obsoleta'|'sesion'|'sin_acceso'|'error', total?}
function ubicacionCorreccionLogic_crearBadgePendientes(deps) {
  var ahora = deps.ahora || function () { return Date.now(); };
  var intervalo = typeof deps.intervaloMs === 'number' ? deps.intervaloMs : UCORR_BADGE_INTERVALO_MS;
  var total = null;
  var generacion = 0;
  var ultima = null;
  var enCurso = null;

  function pintar(valor) {
    total = valor;
    deps.pintar(valor);
  }

  function reset() {
    generacion += 1;
    ultima = null;
    enCurso = null;
    pintar(null);
  }

  function refrescar(forzar) {
    var ctx = deps.obtenerContexto();
    if (!ctx || !ctx.sessionToken || !ubicacionCorreccionLogic_puedeValidar(ctx.permisos)) {
      reset();
      return Promise.resolve({ tipo: 'sin_permiso' });
    }
    if (!forzar) {
      if (enCurso) {
        return enCurso;
      }
      if (ultima !== null && ahora() - ultima < intervalo) {
        return Promise.resolve({ tipo: 'reciente', total: total });
      }
    }
    generacion += 1;
    var mia = generacion;
    ultima = ahora();
    var p = Promise.resolve()
      .then(function () { return deps.consultar(ctx.sessionToken); })
      .then(function (resp) {
        if (mia !== generacion) {
          return { tipo: 'obsoleta' };
        }
        var t = ubicacionCorreccionLogic_totalDePendientes(resp);
        if (t !== null) {
          pintar(t);
          return { tipo: 'ok', total: t };
        }
        var code = resp && resp.code;
        if (code === 'USER_DISABLED') {
          reset();
          if (ctx.onUserDisabled) { ctx.onUserDisabled(); }
          return { tipo: 'sesion' };
        }
        if (code === 'UNAUTHORIZED') {
          reset();
          if (ctx.onSessionExpired) { ctx.onSessionExpired(); }
          return { tipo: 'sesion' };
        }
        if (code === 'PERMISSION_DENIED') {
          pintar(null);                                // el permiso ya no esta: se oculta (sin cerrar sesion)
          return { tipo: 'sin_acceso' };
        }
        ultima = null;                                 // error del servidor: la proxima entrada al hub vuelve a intentar
        return { tipo: 'error' };
      }, function () {
        if (mia === generacion) { ultima = null; }
        return { tipo: 'error' };
      })
      .then(function (r) { if (enCurso === p) { enCurso = null; } return r; });
    enCurso = p;
    return p;
  }

  return {
    refrescar: refrescar,
    // despues de validar o rechazar una correccion: la cola cambio, se vuelve a pedir SIEMPRE
    alResolver: function () { return refrescar(true); },
    reset: reset,
    total: function () { return total; }
  };
}

// --- Centro inicial del mapa ---
// 1) correccion vigente, 2) ubicacion de Irrigacion, 3) ubicacion del dispositivo, 4) vista general de Mendoza.
function ubicacionCorreccionLogic_centroInicialMapa(o) {
  var d = o || {};
  if (d.vigente && ubicacionCorreccionLogic_esNumero(d.vigente.lat) && ubicacionCorreccionLogic_esNumero(d.vigente.lon)) {
    return { lat: d.vigente.lat, lon: d.vigente.lon, zoom: 17, origen: 'vigente' };
  }
  if (d.irrigacion && ubicacionCorreccionLogic_esNumero(d.irrigacion.lat) && ubicacionCorreccionLogic_esNumero(d.irrigacion.lon)) {
    return { lat: d.irrigacion.lat, lon: d.irrigacion.lon, zoom: 17, origen: 'irrigacion' };
  }
  if (d.dispositivo && ubicacionCorreccionLogic_esNumero(d.dispositivo.lat) && ubicacionCorreccionLogic_esNumero(d.dispositivo.lon)) {
    return { lat: d.dispositivo.lat, lon: d.dispositivo.lon, zoom: 16, origen: 'dispositivo' };
  }
  return { lat: UCORR_MENDOZA_CENTRO.lat, lon: UCORR_MENDOZA_CENTRO.lon, zoom: UCORR_MENDOZA_CENTRO.zoom, origen: 'defecto' };
}

// --- HTML de la seccion "Ubicacion corregida" (todo texto de usuario escapado; nunca emails: la API no los manda) ---

function ubicacionCorreccionLogic_escapar(valor) {
  return String(valor === null || valor === undefined ? '' : valor)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

var UCORR_CLASE_ESTADO = {
  PROPUESTA: 'pendiente', VALIDADA: 'validada', RECHAZADA: 'rechazada', SUPERADA: 'superada', REVERTIDA: 'revertida', INCONSISTENTE: 'inconsistente'
};
var UCORR_VERBO_RESOLUCION = { VALIDADA: 'Validada', RECHAZADA: 'Rechazada', SUPERADA: 'Reemplazada', REVERTIDA: 'Revertida' };

function ubicacionCorreccionLogic_filaDato(titulo, valor) {
  return '<div class="ucorr-dato"><dt>' + ubicacionCorreccionLogic_escapar(titulo) + '</dt><dd>' + ubicacionCorreccionLogic_escapar(valor) + '</dd></div>';
}

function ubicacionCorreccionLogic_textoMetodo(c) {
  var t = ubicacionCorreccionLogic_etiquetaMetodo(c.metodo);
  if (c.metodo === 'GPS_ACTUAL' && ubicacionCorreccionLogic_esNumero(c.precisionGpsM)) {
    t += ' (± ' + String(c.precisionGpsM).replace('.', ',') + ' m)';
  }
  return t;
}

// El motivo de SUPERADA nombra un id interno y el de la validacion directa es tecnico: se muestran en lenguaje de usuario.
function ubicacionCorreccionLogic_motivoLegible(evento, motivo) {
  var m = typeof motivo === 'string' ? motivo.trim() : '';
  if (!m || evento === 'SUPERADA') {
    return '';
  }
  if (/^Validada automaticamente/i.test(m)) {
    return 'Validada al crearla, por un usuario con permiso de validación.';
  }
  return m;
}

// c: vista de correccion de la API. opc.modo: 'vigente' | 'pendiente' | 'historial'
function ubicacionCorreccionLogic_htmlTarjeta(c, opc) {
  var modo = (opc && opc.modo) || 'historial';
  var esc = ubicacionCorreccionLogic_escapar;
  var estado = c.estado;
  var h = '<div class="ucorr-card ucorr-card-' + modo + '">';
  h += '<div class="ucorr-card-top"><span class="ucorr-badge ucorr-badge-' + (UCORR_CLASE_ESTADO[estado] || 'inconsistente') + '">' + esc(ubicacionCorreccionLogic_etiquetaEstado(estado)) + '</span>';
  if (c.advertenciaDistancia === true) {
    h += '<span class="ucorr-tag-adv">A más de 1 km de Irrigación</span>';
  }
  h += '</div>';
  h += '<div class="ucorr-coord mono">' + esc(ubicacionCorreccionLogic_formatearCoordenadas(c.lat, c.lon)) + '</div>';
  h += '<dl class="ucorr-datos">';
  h += ubicacionCorreccionLogic_filaDato(modo === 'vigente' ? 'Corregida por' : 'Propuesta por', c.nombrePropone || '—');
  var fecha = ubicacionCorreccionLogic_formatearFecha(c.timestamp);
  if (fecha) {
    h += ubicacionCorreccionLogic_filaDato('Fecha', fecha);
  }
  h += ubicacionCorreccionLogic_filaDato('Método', ubicacionCorreccionLogic_textoMetodo(c));
  if (ubicacionCorreccionLogic_esNumero(c.distanciaM)) {
    h += ubicacionCorreccionLogic_filaDato('Distancia a Irrigación', ubicacionCorreccionLogic_formatearDistancia(c.distanciaM));
  }
  if (typeof c.observacion === 'string' && c.observacion.trim() !== '') {
    h += ubicacionCorreccionLogic_filaDato('Observación', c.observacion);
  }
  h += '</dl>';
  if (modo === 'historial' && c.resolucion && estado !== 'PROPUESTA') {
    var r = c.resolucion;
    var verbo = UCORR_VERBO_RESOLUCION[r.evento] || ubicacionCorreccionLogic_etiquetaEstado(estado);
    var quien = r.evento === 'SUPERADA' ? '' : (r.nombre ? ' por ' + r.nombre : '');
    var cuando = ubicacionCorreccionLogic_formatearFecha(r.timestamp);
    h += '<p class="ucorr-resolucion">' + esc(verbo + quien + (cuando ? ' el ' + cuando : '')) + '</p>';
    var motivo = ubicacionCorreccionLogic_motivoLegible(r.evento, r.motivo);
    if (motivo) {
      h += '<p class="ucorr-motivo">Motivo: ' + esc(motivo) + '</p>';
    }
  }
  if (modo === 'vigente') {
    h += '<a class="maps-btn ucorr-maps" href="' + esc(ubicacionCorreccionLogic_urlGoogleMaps(c.lat, c.lon)) + '" target="_blank" rel="noopener">Abrir esta ubicación en Google Maps</a>';
  }
  h += '</div>';
  return h;
}

// Orden cronologico (mas antigua primero); a igual fecha, conserva el orden de llegada.
function ubicacionCorreccionLogic_ordenCronologico(historial) {
  return (historial || []).map(function (c, i) { return { c: c, i: i }; }).sort(function (a, b) {
    var ta = a.c.timestamp || '';
    var tb = b.c.timestamp || '';
    if (ta !== tb) { return ta < tb ? -1 : 1; }
    return b.i - a.i;           // la API entrega lo mas nuevo primero: dentro de un mismo instante, el mas viejo es el de mas abajo
  }).map(function (x) { return x.c; });
}

// data: respuesta de getCorreccionesUbicacionPozo {vigente, pendientes[], historial[]}
// opc: {puedeCorregir, aviso:{tipo:'ok'|'info', texto, recargar?}, enSesion}
function ubicacionCorreccionLogic_htmlSeccion(data, opc) {
  var o = opc || {};
  var d = data || {};
  var esc = ubicacionCorreccionLogic_escapar;
  var vigente = d.vigente || null;
  var pendientes = d.pendientes || [];
  var historial = d.historial || [];
  var h = '<p class="field-label">Ubicación corregida</p>';
  h += '<p class="ucorr-nota">' + esc(UCORR_TEXTO_NO_REEMPLAZA) + '</p>';

  if (o.aviso && o.aviso.texto) {
    h += '<div class="ucorr-aviso ucorr-aviso-' + (o.aviso.tipo === 'ok' ? 'ok' : 'info') + '" role="status"><span>' + esc(o.aviso.texto) + '</span>';
    if (o.aviso.recargar) {
      h += '<button type="button" class="button-secondary ucorr-recargar" id="btn-ubic-corr-recargar">Actualizar</button>';
    }
    h += '</div>';
  }

  if (vigente) {
    h += ubicacionCorreccionLogic_htmlTarjeta(vigente, { modo: 'vigente' });
  }

  if (pendientes.length) {
    h += '<p class="ucorr-subtitulo">' + (vigente ? 'Correcciones pendientes de validación' : 'Corrección pendiente de validación') + ' (' + pendientes.length + ')</p>';
    pendientes.forEach(function (c) { h += ubicacionCorreccionLogic_htmlTarjeta(c, { modo: 'pendiente' }); });
  }

  if (!vigente && !pendientes.length) {
    h += '<p class="ucorr-vacio">Todavía no hay correcciones de ubicación para este pozo. La ubicación vigente es la de Irrigación.</p>';
  }

  if (o.puedeCorregir === true) {
    h += '<button type="button" class="button ucorr-abrir" id="btn-ubic-corr-abrir">Corregir ubicación</button>';
  }

  if (historial.length) {
    h += '<details class="ucorr-historial"><summary>Historial de correcciones (' + historial.length + ')</summary>';
    ubicacionCorreccionLogic_ordenCronologico(historial).forEach(function (c) { h += ubicacionCorreccionLogic_htmlTarjeta(c, { modo: 'historial' }); });
    h += '</details>';
  }
  return h;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UCORR_GPS_PRECISION_MAX_M, UCORR_OBSERVACION_DESDE_M, UCORR_ADVERTENCIA_DESDE_M, UCORR_OBSERVACION_MAX, UCORR_METODOS,
    UCORR_MENSAJES_ERROR, UCORR_TEXTO_ADVERTENCIA_1KM, UCORR_TEXTO_NO_REEMPLAZA, UCORR_MENSAJE_VALIDADA, UCORR_MENSAJE_PENDIENTE, UCORR_MENSAJE_RED, UCORR_ETIQUETAS_ESTADO,
    ubicacionCorreccionLogic_puedeCorregir,
    ubicacionCorreccionLogic_puedeValidar,
    ubicacionCorreccionLogic_textoBadgePendientes,
    ubicacionCorreccionLogic_totalDePendientes,
    ubicacionCorreccionLogic_crearBadgePendientes,
    UCORR_BADGE_INTERVALO_MS,
    ubicacionCorreccionLogic_oficialDisponible,
    ubicacionCorreccionLogic_tieneCorrecciones,
    ubicacionCorreccionLogic_ofrecerModulo,
    ubicacionCorreccionLogic_necesitaConsultarCorrecciones,
    ubicacionCorreccionLogic_distanciaMetros,
    ubicacionCorreccionLogic_formatearDistancia,
    ubicacionCorreccionLogic_formatearCoord,
    ubicacionCorreccionLogic_formatearCoordenadas,
    ubicacionCorreccionLogic_formatearFecha,
    ubicacionCorreccionLogic_urlGoogleMaps,
    ubicacionCorreccionLogic_etiquetaEstado,
    ubicacionCorreccionLogic_etiquetaMetodo,
    ubicacionCorreccionLogic_irrigacionDeUbicacion,
    ubicacionCorreccionLogic_evaluarGps,
    ubicacionCorreccionLogic_evaluarPropuesta,
    ubicacionCorreccionLogic_construirPayload,
    ubicacionCorreccionLogic_firmaPayload,
    ubicacionCorreccionLogic_nuevoClientRequestId,
    ubicacionCorreccionLogic_mensajeError,
    ubicacionCorreccionLogic_mensajeErrorLectura,
    ubicacionCorreccionLogic_resultadoDeRespuesta,
    ubicacionCorreccionLogic_mensajeResultado,
    ubicacionCorreccionLogic_crearFlujoGuardado,
    ubicacionCorreccionLogic_centroInicialMapa,
    ubicacionCorreccionLogic_htmlTarjeta,
    ubicacionCorreccionLogic_htmlSeccion,
    ubicacionCorreccionLogic_ordenCronologico,
    ubicacionCorreccionLogic_escapar
  };
}
