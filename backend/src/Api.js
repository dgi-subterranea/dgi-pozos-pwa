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

function handleGetProfile(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getProfile');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doPost,
    handleGetProfile,
    handleGetWellRecord,
    handleGetMetadata,
    validateSession,
    validateSessionAndWellId
  };
}
