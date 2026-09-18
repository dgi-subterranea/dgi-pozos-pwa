// Api: unico punto de entrada HTTP. Traduce requests a llamadas de
// AuthService/ProfileService/RegistryService y decide como se entrega la
// respuesta (por ejemplo, la codificacion en base64 de la imagen es una
// decision de esta capa, no de ProfileService).

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
      } else {
        response = { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: ' + body.action };
      }
    }
  } catch (err) {
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
// confirmada/disponible), requiere el permiso "ubicacion" - mismo
// permiso que getWellLocation, coherente con que ambos exponen
// coordenadas; nunca "datos" (el dataset general no lleva titular ni
// ningun otro campo registral, ver MapaService.js). No es una accion
// por-wellId (no recibe ni valida uno), asi que no pasa por
// validateSessionAndWellId ni se audita por wellId en Historial - mismo
// criterio que getMetadata.
function handleGetMapaPozos(sessionToken) {
  var validation = validateSession(sessionToken, 'getMapaPozos');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getMapaPozos', null, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
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
    validarPermiso,
    validateSession,
    validateSessionAndWellId
  };
}
