// Api: unico punto de entrada HTTP. Traduce requests a llamadas de
// AuthService/ProfileService/RegistryService y decide como se entrega la
// respuesta (por ejemplo, la codificacion en base64 de la imagen es una
// decision de esta capa, no de ProfileService).

// Logging seguro de errores inesperados de doPost: sirve para detectar, por
// ejemplo, una VERSION DESPLEGADA vieja del Web App (la app manda una accion
// que ese codigo no conoce). Solo el nombre de la accion, recortado, y el
// mensaje de error sin URLs ni tramos largos con pinta de base64/id: nunca
// el cuerpo del request, secretos ni datos del usuario.
function api_limpiarMensajeLog(mensaje) {
  return String(mensaje).replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9+\/=_-]{16,}/g, '[...]').substring(0, 160);
}

function doPost(e) {
  var response;
  try {
    if (!e || !e.postData || !e.postData.contents) {
      response = { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'sin body en el request' };
    } else {
      var body = JSON.parse(e.postData.contents);
      if (body.action === 'login') {
        response = handleLogin(body.idToken);
      } else if (body.action === 'checkSession') {
        response = handleCheckSession(body.sessionToken);
      } else if (body.action === 'getProfile') {
        response = handleGetProfile(body.sessionToken, body.wellId);
      } else if (body.action === 'getWellRecord') {
        response = handleGetWellRecord(body.sessionToken, body.wellId);
      } else if (body.action === 'getMetadata') {
        response = handleGetMetadata(body.sessionToken);
      } else if (body.action === 'getMonitoringPoint') {
        response = handleGetMonitoringPoint(body.sessionToken, body.monitoringId);
      } else if (body.action === 'getWellLocation') {
        response = handleGetWellLocation(body.sessionToken, body.wellId);
      } else if (body.action === 'registerWellSearch') {
        response = handleRegisterWellSearch(body.sessionToken, body.wellId, body.modulos);
      } else if (body.action === 'getMapaPozos') {
        response = handleGetMapaPozos(body.sessionToken);
      } else if (body.action === 'getWellSummary') {
        response = handleGetWellSummary(body.sessionToken, body.wellId);
      } else if (body.action === 'getMapaNE') {
        response = handleGetMapaNE(body.sessionToken);
      } else if (body.action === 'getIndiceBusquedaProvincia') {
        response = handleGetIndiceBusquedaProvincia(body.sessionToken);
      } else if (body.action === 'getItfAvailability') {
        response = handleGetItfAvailability(body.sessionToken, body.wellIds);
      } else if (body.action === 'registerDescargaItf') {
        response = handleRegisterDescargaItf(body.sessionToken, body.resumen);
      } else if (body.action === 'getEstadoReemplazo') {
        response = handleGetEstadoReemplazo(body.sessionToken, body.wellId);
      } else if (body.action === 'getHistorialReemplazo') {
        response = handleGetHistorialReemplazo(body.sessionToken, body.wellId);
      } else if (body.action === 'registrarEvaluacionReemplazo') {
        // Solo estos 4 campos de contenido: cualquier otro (email, nombre,
        // timestamp, evaluacionId...) que mande el cliente se ignora - la
        // identidad sale de la sesion, nunca del body.
        response = handleRegistrarEvaluacionReemplazo(body.sessionToken, body.wellId, body.estado, body.motivo, body.observacion, body.puntoNEReferencia);
      } else if (body.action === 'getResumenReemplazoMapa') {
        response = handleGetResumenReemplazoMapa(body.sessionToken);
      } else if (body.action === 'subirFotoReemplazo') {
        response = handleSubirFotoReemplazo(body.sessionToken, body.wellId, body.evaluacionId, body.nombreArchivo, body.mimeType, body.imagenBase64, body.thumbBase64);
      } else if (body.action === 'getFotosReemplazo') {
        response = handleGetFotosReemplazo(body.sessionToken, body.evaluacionId);
      } else if (body.action === 'getFotosReemplazoPozo') {
        response = handleGetFotosReemplazoPozo(body.sessionToken, body.wellId);
      } else if (body.action === 'getFotoReemplazo') {
        response = handleGetFotoReemplazo(body.sessionToken, body.fotoId, body.variante);
      } else {
        Logger.log('doPost: accion desconocida: ' + api_limpiarMensajeLog(body.action));
        response = { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: ' + body.action };
      }
    }
  } catch (err) {
    Logger.log('doPost: excepcion: ' + api_limpiarMensajeLog(err));
    response = { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  return ContentService
    .createTextOutput(JSON.stringify(response))
    .setMimeType(ContentService.MimeType.JSON);
}

// Validacion compartida por cualquier accion que reciba sessionToken,
// tenga o no wellId (checkSession queda afuera a proposito: es
// recuperacion silenciosa de sesion, no una accion de negocio, y no
// recibe wellId ni se audita). Devuelve {ok:true, session} o {ok:false,
// response} ya listo para devolver tal cual si algo fallo.
function validateSession(sessionToken, accion, wellId) {
  var session = verifySessionToken(sessionToken);
  if (!session.valid) {
    return { ok: false, response: { status: 'error', code: 'UNAUTHORIZED', message: 'sessionToken invalido: ' + session.reason } };
  }

  if (!isUserActive(session.email)) {
    logHistoryEvent(session.email, accion, wellId || null, 'USER_DISABLED');
    return { ok: false, response: { status: 'error', code: 'USER_DISABLED', message: 'usuario no habilitado: ' + session.email } };
  }

  return { ok: true, session: session };
}

// Ademas de la sesion, valida formato/rango de wellId - para las
// acciones que reciben uno (hoy getProfile y getWellRecord; manana la
// que sea la siguiente capa - niveles estaticos, etc.).
function validateSessionAndWellId(sessionToken, wellId, accion) {
  var sessionValidation = validateSession(sessionToken, accion, wellId);
  if (!sessionValidation.ok) {
    return sessionValidation;
  }
  var session = sessionValidation.session;

  if (!wellId || !/^\d{2}-\d{4}$/.test(wellId)) {
    logHistoryEvent(session.email, accion, wellId, 'INVALID_WELL_ID');
    return { ok: false, response: { status: 'error', code: 'INVALID_WELL_ID', message: 'formato invalido: ' + wellId } };
  }

  // Los departamentos validos van de 01 a 19. Esta regla existe tambien
  // en el frontend (wellIdValidator.js), pero el backend nunca confia
  // unicamente en esa validacion - por eso se repite aca.
  var departamento = parseInt(wellId.substring(0, 2), 10);
  if (departamento < 1 || departamento > 19) {
    logHistoryEvent(session.email, accion, wellId, 'INVALID_WELL_ID');
    return { ok: false, response: { status: 'error', code: 'INVALID_WELL_ID', message: 'departamento fuera de rango: ' + wellId } };
  }

  return { ok: true, session: session };
}

// Permisos por modulo (perfil/datos/ubicacion/ne): se chequean DESPUES de
// sesion/formato, con la sesion ya validada - nunca antes, para no
// filtrar "existis pero no tenes permiso" a alguien con un token
// invalido. Un intento denegado se audita igual que cualquier otro
// resultado (ver logHistoryEvent) - PERMISSION_DENIED es un resultado
// mas en Historial, no un caso especial.
function validarPermiso(session, accion, wellId, modulo) {
  if (!hasPermission(session.email, modulo)) {
    logHistoryEvent(session.email, accion, wellId || null, 'PERMISSION_DENIED');
    return { ok: false, response: { status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso "' + modulo + '": ' + session.email } };
  }
  return { ok: true };
}

function handleGetProfile(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getProfile');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getProfile', wellId, 'perfil');
  if (!permiso.ok) {
    return permiso.response;
  }

  var startTime = Date.now();
  var profile;
  try {
    profile = profileService_getProfile(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getProfile', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  var elapsedMs = Date.now() - startTime;

  if (!profile.found) {
    logHistoryEvent(session.email, 'getProfile', wellId, 'PROFILE_NOT_FOUND');
    return { status: 'error', code: 'PROFILE_NOT_FOUND', message: 'no se encontro perfil para ' + wellId };
  }

  var bytes = profile.blob.getBytes();
  var imageBase64 = Utilities.base64Encode(bytes);

  logHistoryEvent(session.email, 'getProfile', wellId, 'OK');

  return {
    status: 'ok',
    data: {
      wellId: wellId,
      mimeType: profile.blob.getContentType(),
      imageBase64: imageBase64,
      originalSizeBytes: bytes.length,
      base64SizeBytes: imageBase64.length,
      elapsedMsEnDrive: elapsedMs
    }
  };
}

// La Ficha del Pozo (padron/registro tecnico) es una capa independiente
// del ITF: uno puede existir sin el otro, y una falla acá nunca debe
// tocar el flujo de getProfile ni viceversa - por eso es un action
// separado en vez de sumarse a la respuesta de getProfile.
function handleGetWellRecord(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getWellRecord');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getWellRecord', wellId, 'datos');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = registryService_getWellRecord(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getWellRecord', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    logHistoryEvent(session.email, 'getWellRecord', wellId, 'WELL_RECORD_NOT_FOUND');
    return { status: 'error', code: 'WELL_RECORD_NOT_FOUND', message: 'no se encontro ficha para ' + wellId };
  }

  logHistoryEvent(session.email, 'getWellRecord', wellId, 'OK');

  return { status: 'ok', data: result.record };
}

// Metadata del padron (fecha de generacion, periodo de la fuente) para
// el caption "Padron: <mes> <anio>" - no es una accion de negocio (no
// depende de un wellId, no se audita en Historial), igual que
// checkSession.
function handleGetMetadata(sessionToken) {
  var validation = validateSession(sessionToken, 'getMetadata');
  if (!validation.ok) {
    return validation.response;
  }

  var result;
  try {
    result = registryService_getMetadata();
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    return { status: 'error', code: 'REGISTRY_METADATA_NOT_FOUND', message: 'no se encontro metadata.json' };
  }

  return { status: 'ok', data: result.metadata };
}

// Niveles Estaticos: capa independiente del padron y del ITF (ver
// NivelesEstaticosRepository.js) - por eso monitoringId NO pasa por
// validateSessionAndWellId (esa funcion exige el formato DD-PPPP; un
// punto especial como "INA 2055" o "6 RTR7" es un monitoringId valido
// que nunca tiene esa forma). Solo se valida que no venga vacio.
function handleGetMonitoringPoint(sessionToken, monitoringId) {
  var validation = validateSession(sessionToken, 'getMonitoringPoint', monitoringId);
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  if (!monitoringId) {
    logHistoryEvent(session.email, 'getMonitoringPoint', null, 'INVALID_MONITORING_ID');
    return { status: 'error', code: 'INVALID_MONITORING_ID', message: 'monitoringId vacio' };
  }

  var permiso = validarPermiso(session, 'getMonitoringPoint', monitoringId, 'ne');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = nivelesEstaticosService_getPunto(monitoringId);
  } catch (err) {
    logHistoryEvent(session.email, 'getMonitoringPoint', monitoringId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    logHistoryEvent(session.email, 'getMonitoringPoint', monitoringId, 'MONITORING_POINT_NOT_FOUND');
    return { status: 'error', code: 'MONITORING_POINT_NOT_FOUND', message: 'no se encontro punto de monitoreo para ' + monitoringId };
  }

  logHistoryEvent(session.email, 'getMonitoringPoint', monitoringId, 'OK');
  return { status: 'ok', data: result.punto };
}

// Modulo Ubicacion: API independiente de Datos, requiere el permiso
// "ubicacion" (no "datos") - un usuario puede tener datos=NO,
// ubicacion=SI y usar este endpoint sin recibir el resto de la ficha
// registral (ver registryService_getWellLocation, que devuelve solo lo
// geografico). Comparte repositorio y cache por wellId con
// getWellRecord, pero nunca su payload.
function handleGetWellLocation(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getWellLocation');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getWellLocation', wellId, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = registryService_getWellLocation(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getWellLocation', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    logHistoryEvent(session.email, 'getWellLocation', wellId, 'WELL_LOCATION_NOT_FOUND');
    return { status: 'error', code: 'WELL_LOCATION_NOT_FOUND', message: 'no se encontro ubicacion para ' + wellId };
  }

  logHistoryEvent(session.email, 'getWellLocation', wellId, 'OK');
  return { status: 'ok', data: result.location };
}

// Una sola llamada por busqueda - el frontend la dispara UNA vez al
// terminar buscarPozo(), nunca desde
// getProfile/getWellRecord/getWellLocation/getMonitoringPoint (esos se
// llaman varias veces por busqueda). La identidad (email/nombre) sale
// SIEMPRE del sessionToken verificado + la hoja Usuarios - nunca se
// confia en un email que mande el navegador. "modulos" es contenido
// informativo (para el registro y el mensaje), no interviene en
// permisos.
//
// Dos efectos independientes, cada uno en su propio try/catch: el
// registro estadistico (hoja "Busquedas", ver SearchHistoryService) y
// la notificacion de Telegram (ver NotificationService) - si uno falla
// el otro se intenta igual, y ninguno de los dos puede afectar la
// respuesta de esta accion. Ambos son secundarios respecto de la
// busqueda real del usuario, que ya se resolvio en el frontend antes de
// llamar aca - por eso esto siempre devuelve status:'ok'.
function handleRegisterWellSearch(sessionToken, wellId, modulos) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'registerWellSearch');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;
  var access = getUserAccess(session.email);
  var modulosSeguros = modulos || {};

  try {
    var logResult = searchHistoryService_registerSearch(session.email, access.nombre, wellId, modulosSeguros);
    if (!logResult.logged) {
      logHistoryEvent(session.email, 'registerWellSearch', wellId, 'SEARCH_LOG_ERROR');
    }
  } catch (err) {
    logHistoryEvent(session.email, 'registerWellSearch', wellId, 'SEARCH_LOG_ERROR');
  }

  try {
    var resultado = notificationService_notifyWellSearch(session.email, access.nombre, wellId, modulosSeguros);
    if (!resultado.sent && resultado.reason === 'ERROR') {
      logHistoryEvent(session.email, 'registerWellSearch', wellId, 'TELEGRAM_ERROR');
    }
  } catch (err) {
    logHistoryEvent(session.email, 'registerWellSearch', wellId, 'TELEGRAM_ERROR');
  }

  return { status: 'ok' };
}

// Mapa de Pozos: dataset general (todos los puntos con coordenada
// confirmada/disponible). Ya NO se gatea por un permiso de modulo: lo
// consumen "Pozos cerca mio" (disponible para TODO usuario activo), el
// mapa Pozos Provincia (perfil=SI o ne=SI) y la seleccion por radio/
// poligono, asi que cualquier gate de modulo (antes "ubicacion") dejaria
// afuera a alguien que si debe usar esas funciones. Alcanza con sesion
// valida + usuario activo. El dataset es estructuralmente general (ver
// MapaService.js: wellId/lat/lon/estado/cuenca y los campos tecnicos de
// filtro, NUNCA titular ni ningun campo registral), y todo lo individual y
// protegido sigue gateado aparte: getWellLocation ("ubicacion"),
// getWellSummary/getIndiceBusquedaProvincia/getWellRecord ("datos"),
// getMapaNE ("ne"). No es una accion
// por-wellId (no recibe ni valida uno), asi que no pasa por
// validateSessionAndWellId ni se audita por wellId en Historial - mismo
// criterio que getMetadata.
function handleGetMapaPozos(sessionToken) {
  var validation = validateSession(sessionToken, 'getMapaPozos');
  if (!validation.ok) {
    return validation.response;
  }

  var result;
  try {
    result = mapaService_getPozos();
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    return { status: 'error', code: 'MAPA_NOT_FOUND', message: 'no se encontro pozos.json' };
  }

  return { status: 'ok', data: { pozos: result.pozos, metadata: result.metadata } };
}

// Popup liviano del Mapa de Pozos: reutiliza el mismo
// RegistryRepository/cache que getWellRecord (mismo archivo de
// departamento, mismo cache por wellId - no es una lectura nueva de
// Drive) pero devuelve solo 4 campos (ver
// registryService_getWellSummary), nunca la ficha completa ni
// coordenadas. Requiere "datos" (no "ubicacion") - es el mismo permiso
// que getWellRecord, coherente con que ambos exponen identidad
// registral (titular).
function handleGetWellSummary(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getWellSummary');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getWellSummary', wellId, 'datos');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = registryService_getWellSummary(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getWellSummary', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    logHistoryEvent(session.email, 'getWellSummary', wellId, 'WELL_RECORD_NOT_FOUND');
    return { status: 'error', code: 'WELL_RECORD_NOT_FOUND', message: 'no se encontro ficha para ' + wellId };
  }

  logHistoryEvent(session.email, 'getWellSummary', wellId, 'OK');
  return { status: 'ok', data: result.summary };
}

// Mapa NE (v2.1.0): dataset SEPARADO del Mapa de Pozos, gateado
// EXCLUSIVAMENTE por el permiso "ne" - nunca "ubicacion". Un usuario con
// ubicacion=SI, ne=NO nunca puede pedir esto (ver MapaNEService.js: la
// separacion de pozos.json/nivelesEstaticos.json es justamente para que
// ese usuario no pueda inferir pertenencia a la red NE inspeccionando el
// dataset general). Mismo criterio que getMapaPozos: no es una accion
// por-wellId, no se audita por wellId en Historial.
function handleGetMapaNE(sessionToken) {
  var validation = validateSession(sessionToken, 'getMapaNE');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getMapaNE', null, 'ne');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = mapaNEService_getPuntos();
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    return { status: 'error', code: 'MAPA_NE_NOT_FOUND', message: 'no se encontro nivelesEstaticos.json' };
  }

  return { status: 'ok', data: { puntos: result.puntos } };
}

// Indice de busqueda por titular de Pozos Provincia (Etapa 1A): dataset
// SEPARADO de getMapaPozos, gateado EXCLUSIVAMENTE por "datos" - nunca
// "ubicacion". Un usuario con ubicacion=SI, datos=NO puede ver el mapa
// pero nunca este indice (mismo criterio que handleGetWellSummary, que
// ya requiere "datos" para exponer titular - esto extiende esa misma
// regla a la busqueda en vez de abrir una puerta nueva gateada distinto).
// No es una accion por-wellId, no se audita por wellId en Historial
// (mismo criterio que getMapaPozos/getMapaNE).
function handleGetIndiceBusquedaProvincia(sessionToken) {
  var validation = validateSession(sessionToken, 'getIndiceBusquedaProvincia');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getIndiceBusquedaProvincia', null, 'datos');
  if (!permiso.ok) {
    return permiso.response;
  }

  var result;
  try {
    result = mapaService_getIndiceBusqueda();
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!result.found) {
    return { status: 'error', code: 'MAPA_BUSQUEDA_NOT_FOUND', message: 'no se encontro pozos_busqueda.json' };
  }

  return { status: 'ok', data: { pozos: result.pozos } };
}

// Etapa "seleccion multiple + lote": valida un ARRAY de wellId (no uno
// solo, por eso no reusa validateSessionAndWellId) - mismo criterio de
// formato/rango de departamento que esa funcion, pero sin loguear
// Historial por item individual (seria un log por pozo del lote, lo que
// el usuario explicitamente no quiere para acciones puramente
// geograficas/de lote). Devuelve {ok:true} o {ok:false, response}.
var SELECCION_LOTE_MAX_WELLIDS = 500;

function validarLoteWellIds(wellIds) {
  if (!Array.isArray(wellIds) || wellIds.length === 0) {
    return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'wellIds vacio o invalido' } };
  }
  if (wellIds.length > SELECCION_LOTE_MAX_WELLIDS) {
    return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'demasiados wellIds (maximo ' + SELECCION_LOTE_MAX_WELLIDS + ')' } };
  }
  for (var i = 0; i < wellIds.length; i++) {
    if (!/^\d{2}-\d{4}$/.test(wellIds[i])) {
      return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'wellId invalido: ' + wellIds[i] } };
    }
  }
  return { ok: true };
}

// Disponibilidad de ITF para un LOTE de pozos (Etapa "seleccion multiple
// + lote", item F/G): devuelve SOLO {wellId: boolean}, nunca ids ni URLs
// de Drive (ver ItfAvailabilityService.js, que resuelve esto con un
// indice cacheado por departamento en vez de recorrer Drive por cada
// wellId). Gateado EXCLUSIVAMENTE por "perfil" - mismo permiso que
// getProfile, coherente con que ambos exponen informacion sobre el ITF.
//
// Auditoria (item 1 del cierre, revisado): esta es la UNICA accion batch
// "material" que se audita antes de la descarga - "Consulta disponibilidad
// ITF" va a Historial (si realmente aporta un registro tecnico de quien
// pregunto que ITF existen), pero deliberadamente SIN Telegram (decision
// explicita del usuario: no mandar una notificacion solo por preguntar
// disponibilidad). Se loguea UNA vez por llamada real a este endpoint -
// como el frontend solo llama aca cuando su propio cache esta vencido o
// vacio (ver asegurarDisponibilidadItf en js/seleccion.js), esto ya es
// "material" por construccion, sin necesitar logica extra de "primera vez
// por seleccion". Abrir la tabla/pantalla ITF en si NUNCA llama a este
// handler si el frontend ya tiene el resultado en memoria - en ese caso
// no hay llamada, y por lo tanto no hay nada que auditar (correcto: no se
// audita "abrir una pantalla local").
function handleGetItfAvailability(sessionToken, wellIds) {
  var validation = validateSession(sessionToken, 'getItfAvailability');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var loteValidation = validarLoteWellIds(wellIds);
  if (!loteValidation.ok) {
    return loteValidation.response;
  }

  var permiso = validarPermiso(session, 'getItfAvailability', null, 'perfil');
  if (!permiso.ok) {
    return permiso.response;
  }

  var disponibilidad;
  try {
    disponibilidad = profileService_checkDisponibilidad(wellIds);
  } catch (err) {
    logHistoryEvent(session.email, 'getItfAvailability', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  logHistoryEvent(session.email, 'getItfAvailability', null, 'OK');
  return { status: 'ok', data: disponibilidad };
}

// Auditoria de la descarga ITF por lote (item 1 del cierre, revisado):
// UN evento resumido (1 fila Historial + 1 Telegram) por cada descarga
// real que el usuario arranca - nunca por pozo, nunca por el solo hecho
// de seleccionar geograficamente o de ver la tabla/disponibilidad. El
// frontend llama aca DESPUES de que la descarga (JSZip + getProfile en
// el navegador) ya termino, con los conteos reales - por eso el payload
// es un resumen (resultado), no solo wellIds. No requiere permiso de
// modulo (es una accion de auditoria/metadata, no de acceso a datos -
// mismo criterio que registerWellSearch): el acceso real a cada imagen
// ya paso, individualmente, por getProfile (gateado por "perfil").
var DESCARGA_ITF_MAX_WELLIDS = SELECCION_LOTE_MAX_WELLIDS;

function validarResumenDescargaItf(resumen) {
  if (!resumen || typeof resumen !== 'object') {
    return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'resumen invalido' } };
  }
  var camposNumericos = ['totalSeleccionados', 'solicitados', 'descargados', 'fallidos'];
  for (var i = 0; i < camposNumericos.length; i++) {
    var v = resumen[camposNumericos[i]];
    if (typeof v !== 'number' || v < 0 || !isFinite(v)) {
      return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'campo invalido: ' + camposNumericos[i] } };
    }
  }
  var loteValidation = validarLoteWellIds(resumen.wellIds);
  if (!loteValidation.ok) {
    return loteValidation;
  }
  if (resumen.wellIds.length > DESCARGA_ITF_MAX_WELLIDS) {
    return { ok: false, response: { status: 'error', code: 'INVALID_REQUEST', message: 'demasiados wellIds (maximo ' + DESCARGA_ITF_MAX_WELLIDS + ')' } };
  }
  return { ok: true };
}

function handleRegisterDescargaItf(sessionToken, resumen) {
  var validation = validateSession(sessionToken, 'registerDescargaItf');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var resumenValidation = validarResumenDescargaItf(resumen);
  if (!resumenValidation.ok) {
    return resumenValidation.response;
  }

  var access = getUserAccess(session.email);

  try {
    var resultado = notificationService_notifyDescargaItf(session.email, access.nombre, resumen);
    if (!resultado.sent && resultado.reason === 'ERROR') {
      logHistoryEvent(session.email, 'registerDescargaItf', null, 'TELEGRAM_ERROR');
    } else {
      logHistoryEvent(session.email, 'registerDescargaItf', null, 'OK');
    }
  } catch (err) {
    logHistoryEvent(session.email, 'registerDescargaItf', null, 'TELEGRAM_ERROR');
  }

  return { status: 'ok' };
}

// --- Modulo Reemplazos v1 (evaluacion de aptitud de pozos candidatos) ---
// Los 3 endpoints se gatean EXCLUSIVAMENTE por el permiso "reemplazo"
// (lectura y escritura, mismo permiso): sin el no se ve estado, no se ve
// historial y no se registra nada. Orden de chequeos, igual que el resto:
// sesion -> formato de wellId -> permiso -> contenido. Toda la logica de
// negocio y validacion vive en ReemplazoService.js, aca solo se traduce.

function handleGetEstadoReemplazo(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getEstadoReemplazo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getEstadoReemplazo', wellId, 'reemplazo');
  if (!permiso.ok) {
    return permiso.response;
  }

  var estado;
  try {
    estado = reemplazoService_getEstado(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getEstadoReemplazo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  // Las lecturas no se auditan en caso OK (son de alta frecuencia y no
  // cambian nada): solo la escritura deja una fila en Historial.
  return { status: 'ok', data: estado };
}

function handleGetHistorialReemplazo(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getHistorialReemplazo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getHistorialReemplazo', wellId, 'reemplazo');
  if (!permiso.ok) {
    return permiso.response;
  }

  var historial;
  try {
    historial = reemplazoService_getHistorial(wellId);
  } catch (err) {
    logHistoryEvent(session.email, 'getHistorialReemplazo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  return { status: 'ok', data: historial };
}

// email/nombre SIEMPRE de la sesion + hoja Usuarios (getUserAccess), nunca
// del cliente. UNA fila de Historial por evaluacion creada (OK), mas los
// resultados de error habituales; sin Telegram en v1 y sin tocar
// registerWellSearch.
function handleRegistrarEvaluacionReemplazo(sessionToken, wellId, estado, motivo, observacion, puntoNEReferencia) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'registrarEvaluacionReemplazo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'registrarEvaluacionReemplazo', wellId, 'reemplazo');
  if (!permiso.ok) {
    return permiso.response;
  }

  var access = getUserAccess(session.email);

  var resultado;
  try {
    resultado = reemplazoService_registrar(session.email, access.nombre, wellId, {
      estado: estado,
      motivo: motivo,
      observacion: observacion,
      puntoNEReferencia: puntoNEReferencia
    });
  } catch (err) {
    logHistoryEvent(session.email, 'registrarEvaluacionReemplazo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }

  if (!resultado.ok) {
    logHistoryEvent(session.email, 'registrarEvaluacionReemplazo', wellId, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }

  logHistoryEvent(session.email, 'registrarEvaluacionReemplazo', wellId, 'OK');
  return { status: 'ok', data: { evaluacion: resultado.evaluacion } };
}

// Resumen BATCH para mapa, Cerca Mio y Mi seleccion (Reemplazos v3): un
// objeto {wellId: "APTO"|"DUDOSO"|"NO_APTO"} solo con los pozos que tienen
// al menos una evaluacion valida (el resto es SIN_EVALUAR). Gateado
// EXCLUSIVAMENTE por "reemplazo": sin el permiso no se lee la hoja ni se
// devuelve nada. Lectura frecuente y sin efectos: no se audita el caso OK
// (ni Historial ni Telegram); permisos denegados y fallas si, como siempre.
function handleGetResumenReemplazoMapa(sessionToken) {
  var validation = validateSession(sessionToken, 'getResumenReemplazoMapa');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getResumenReemplazoMapa', null, 'reemplazo');
  if (!permiso.ok) {
    return permiso.response;
  }

  try {
    return { status: 'ok', data: reemplazoService_getResumenMapa() };
  } catch (err) {
    logHistoryEvent(session.email, 'getResumenReemplazoMapa', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

// --- Fotos de evaluaciones de reemplazo (Reemplazos v2) ---
// Todos gateados EXCLUSIVAMENTE por "reemplazo" (lectura y escritura). El
// almacenamiento real esta en otro proyecto/cuenta de Google (ver
// FotosStorageClient.js): este backend valida, firma y hace de proxy; el
// navegador nunca habla con el storage ni recibe URLs/Drive IDs. Auditoria
// sin ruido: NO se escribe una fila de Historial por cada foto OK (la hoja
// FotosReemplazo ya es el registro con usuario y fecha), solo los errores
// y los permisos denegados; sin Telegram.

function validarSesionPermisoFotos(sessionToken, accion, wellId) {
  var validation = wellId === undefined
    ? validateSession(sessionToken, accion)
    : validateSessionAndWellId(sessionToken, wellId, accion);
  if (!validation.ok) {
    return validation;
  }
  var permiso = validarPermiso(validation.session, accion, wellId === undefined ? null : wellId, 'reemplazo');
  if (!permiso.ok) {
    return permiso;
  }
  return { ok: true, session: validation.session };
}

function handleSubirFotoReemplazo(sessionToken, wellId, evaluacionId, nombreArchivo, mimeType, imagenBase64, thumbBase64) {
  var v = validarSesionPermisoFotos(sessionToken, 'subirFotoReemplazo', wellId);
  if (!v.ok) {
    return v.response;
  }
  var session = v.session;

  var resultado;
  try {
    resultado = fotosService_subir(session.email, wellId, evaluacionId, {
      nombreArchivo: nombreArchivo,
      mimeType: mimeType,
      imagenBase64: imagenBase64,
      thumbBase64: thumbBase64
    });
  } catch (err) {
    logHistoryEvent(session.email, 'subirFotoReemplazo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'subirFotoReemplazo', wellId, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: { foto: resultado.foto } };
}

function handleGetFotosReemplazo(sessionToken, evaluacionId) {
  var v = validarSesionPermisoFotos(sessionToken, 'getFotosReemplazo');
  if (!v.ok) {
    return v.response;
  }
  if (typeof evaluacionId !== 'string' || !FOTOS_UUID_REGEX.test(evaluacionId)) {
    return { status: 'error', code: 'INVALID_EVALUACION_ID', message: 'evaluacionId invalido' };
  }
  try {
    return { status: 'ok', data: fotosService_listarPorEvaluacion(evaluacionId) };
  } catch (err) {
    logHistoryEvent(v.session.email, 'getFotosReemplazo', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

function handleGetFotosReemplazoPozo(sessionToken, wellId) {
  var v = validarSesionPermisoFotos(sessionToken, 'getFotosReemplazoPozo', wellId);
  if (!v.ok) {
    return v.response;
  }
  try {
    return { status: 'ok', data: fotosService_listarPorPozo(wellId) };
  } catch (err) {
    logHistoryEvent(v.session.email, 'getFotosReemplazoPozo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

function handleGetFotoReemplazo(sessionToken, fotoId, variante) {
  var v = validarSesionPermisoFotos(sessionToken, 'getFotoReemplazo');
  if (!v.ok) {
    return v.response;
  }
  var resultado;
  try {
    resultado = fotosService_obtenerImagen(fotoId, variante);
  } catch (err) {
    logHistoryEvent(v.session.email, 'getFotoReemplazo', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    if (resultado.code === 'STORAGE_UNAVAILABLE') {
      logHistoryEvent(v.session.email, 'getFotoReemplazo', null, resultado.code);
    }
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: resultado.imagen };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doPost,
    handleGetProfile,
    handleGetWellRecord,
    handleGetMetadata,
    handleGetMonitoringPoint,
    handleGetWellLocation,
    handleRegisterWellSearch,
    handleGetMapaPozos,
    handleGetWellSummary,
    handleGetMapaNE,
    handleGetIndiceBusquedaProvincia,
    handleGetItfAvailability,
    handleRegisterDescargaItf,
    handleGetEstadoReemplazo,
    handleGetHistorialReemplazo,
    handleRegistrarEvaluacionReemplazo,
    handleSubirFotoReemplazo,
    handleGetFotosReemplazo,
    handleGetFotosReemplazoPozo,
    handleGetFotoReemplazo,
    handleGetResumenReemplazoMapa,
    validarPermiso,
    validateSession,
    validateSessionAndWellId
  };
}
