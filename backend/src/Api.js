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
      } else if (body.action === 'getUbicacionesValidadas') {
        response = handleGetUbicacionesValidadas(body.sessionToken);
      } else if (body.action === 'getDecisionesFuentesDelta') {
        response = handleGetDecisionesFuentesDelta(body.sessionToken);
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
      } else if (body.action === 'getFotosPozo') {
        response = handleGetFotosPozo(body.sessionToken, body.wellId, body.monitoringId, body.orden);
      } else if (body.action === 'getFotoPozo') {
        response = handleGetFotoPozo(body.sessionToken, body.fotoId, body.variante);
      } else if (body.action === 'getResumenFotosPozos') {
        response = handleGetResumenFotosPozos(body.sessionToken);
      } else if (body.action === 'subirFotoPozo') {
        // Lista BLANCA de campos: la identidad (email, timestamp) sale de la sesion, y
        // nada mas que lo declarado aca llega al servicio. driveFileId, estado,
        // estadoVinculo, gpsOrigen, lote... que mande el cliente se ignoran.
        response = handleSubirFotoPozo(body.sessionToken, {
          wellId: body.wellId,
          monitoringId: body.monitoringId,
          fuente: body.fuente,
          tipoFoto: body.tipoFoto,
          fechaFotoValor: body.fechaFotoValor,
          fechaFotoPrecision: body.fechaFotoPrecision,
          fechaFotoFuente: body.fechaFotoFuente,
          observacion: body.observacion,
          gps: body.gps,
          mimeType: body.mimeType,
          imagenBase64: body.imagenBase64,
          thumbBase64: body.thumbBase64,
          sha1Original: body.sha1Original,
          procesamiento: body.procesamiento,
          tamanoOriginalBytes: body.tamanoOriginalBytes
        });
      } else if (body.action === 'solicitarRetiroFotoPozo') {
        // Lista BLANCA (E8-3): NUNCA entidad, estado, email, nombre ni solicitudId del cliente; la foto la identifica fotoId y la entidad la deriva el servidor.
        response = handleSolicitarRetiroFotoPozo(body.sessionToken, { fotoId: body.fotoId, motivoCodigo: body.motivoCodigo, motivoTexto: body.motivoTexto, clientRequestId: body.clientRequestId });
      } else if (body.action === 'retirarFotoPozo') {
        response = handleRetirarFotoPozo(body.sessionToken, { fotoId: body.fotoId, motivoCodigo: body.motivoCodigo, motivoTexto: body.motivoTexto, clientRequestId: body.clientRequestId });
      } else if (body.action === 'resolverRetiroFotoPozo') {
        // la foto y la entidad salen de la SOLICITUD (servidor): el cliente solo manda solicitudId + resolucion
        response = handleResolverRetiroFotoPozo(body.sessionToken, { solicitudId: body.solicitudId, resolucion: body.resolucion, clientRequestId: body.clientRequestId });
      } else if (body.action === 'reponerFotoPozo') {
        response = handleReponerFotoPozo(body.sessionToken, { fotoId: body.fotoId, clientRequestId: body.clientRequestId });
      } else if (body.action === 'getHistorialFotoPozo') {
        response = handleGetHistorialFotoPozo(body.sessionToken, body.fotoId);
      } else if (body.action === 'getFotosPozosPendientesModeracion') {
        response = handleGetFotosPozosPendientesModeracion(body.sessionToken, body.limit, body.cursor);
      } else if (body.action === 'getFotosPozosRetiradasModeracion') {
        response = handleGetFotosPozosRetiradasModeracion(body.sessionToken, body.limit, body.cursor);
      } else if (body.action === 'getFotoPozoModeracion') {
        response = handleGetFotoPozoModeracion(body.sessionToken, body.fotoId, body.variante);
      } else if (body.action === 'proponerCorreccionUbicacion') {
        // Lista BLANCA de campos: la identidad sale de la sesion; irrLat/irrLon/irrEstado/distanciaM/estado... que mande el
        // cliente se ignoran (el snapshot de Irrigacion, la distancia y las banderas las calcula el backend). coordenadaOriginal es el valor tipeado de
        // los metodos COORDENADAS_*; coordenadaOriginalTexto y crsOriginal NO se leen del cliente: los genera el backend al recalcular.
        response = handleProponerCorreccionUbicacion(body.sessionToken, {
          wellId: body.wellId,
          lat: body.lat,
          lon: body.lon,
          metodo: body.metodo,
          precisionGpsM: body.precisionGpsM,
          observacion: body.observacion,
          clientRequestId: body.clientRequestId,
          coordenadaOriginal: body.coordenadaOriginal
        });
      } else if (body.action === 'getCorreccionesUbicacionPozo') {
        response = handleGetCorreccionesUbicacionPozo(body.sessionToken, body.wellId);
      } else if (body.action === 'getCorreccionesUbicacionPendientes') {
        response = handleGetCorreccionesUbicacionPendientes(body.sessionToken);
      } else if (body.action === 'validarCorreccionUbicacion') {
        response = handleValidarCorreccionUbicacion(body.sessionToken, body.correccionId, body.motivo);
      } else if (body.action === 'rechazarCorreccionUbicacion') {
        response = handleRechazarCorreccionUbicacion(body.sessionToken, body.correccionId, body.motivo);
      } else if (body.action === 'revertirCorreccionUbicacion') {
        response = handleRevertirCorreccionUbicacion(body.sessionToken, body.correccionId, body.motivo);
      } else if (body.action === 'getDecisionesFuentesPozo') {
        response = handleGetDecisionesFuentesPozo(body.sessionToken, body.wellId);
      } else if (body.action === 'decidirFuenteUbicacion') {
        // Lista blanca de campos: la identidad (email, nombre), la secuencia, la fecha, el estado y el punto operativo NO se leen del cliente.
        response = handleDecidirFuenteUbicacion(body.sessionToken, {
          wellId: body.wellId,
          fuenteTipo: body.fuenteTipo,
          x: body.x,
          y: body.y,
          accion: body.accion,
          motivo: body.motivo,
          versionVista: body.versionVista,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'sugerirDecisionFuente') {
        // Lista blanca de campos: la identidad (email, nombre), la secuencia, la fecha y el estado NO se leen del cliente.
        response = handleSugerirDecisionFuente(body.sessionToken, {
          wellId: body.wellId,
          fuenteTipo: body.fuenteTipo,
          x: body.x,
          y: body.y,
          accionSugerida: body.accionSugerida,
          motivo: body.motivo,
          versionVista: body.versionVista,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'getSugerenciasFuentesPozo') {
        response = handleGetSugerenciasFuentesPozo(body.sessionToken, body.wellId);
      } else if (body.action === 'getSugerenciasFuentesPendientes') {
        response = handleGetSugerenciasFuentesPendientes(body.sessionToken);
      } else if (body.action === 'resolverSugerenciaFuente') {
        response = handleResolverSugerenciaFuente(body.sessionToken, {
          sugerenciaId: body.sugerenciaId,
          resolucion: body.resolucion,
          motivo: body.motivo,
          versionVista: body.versionVista,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'cancelarSugerenciaFuente') {
        response = handleCancelarSugerenciaFuente(body.sessionToken, {
          sugerenciaId: body.sugerenciaId,
          motivo: body.motivo,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'agregarObservacionPozo') {
        // Solo estos 4 campos de contenido: cualquier otro (email, nombre, timestamp, observacionId, secuencia, estado...) que mande el cliente se ignora.
        response = handleAgregarObservacionPozo(body.sessionToken, {
          wellId: body.wellId,
          texto: body.texto,
          categoria: body.categoria,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'anularObservacionPozo') {
        // Solo estos 3 campos: el wellId, el autor, el estado y el texto NO los decide el cliente (salen de la ALTA original y de la sesion).
        response = handleAnularObservacionPozo(body.sessionToken, {
          observacionId: body.observacionId,
          motivo: body.motivo,
          clientRequestId: body.clientRequestId
        });
      } else if (body.action === 'getObservacionesPozo') {
        // Solo estos 2 parametros de paginacion ademas del pozo: cualquier otro campo que mande el cliente se ignora.
        response = handleGetObservacionesPozo(body.sessionToken, body.wellId, body.limit, body.antesDeSecuencia);
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

  // typeof: un wellId que no es texto (un arreglo, un objeto) jamas pasa; antes un arreglo ['14-0001'] pasaba el regex (se convierte a texto) y rompia mas abajo
  if (typeof wellId !== 'string' || !wellId || !/^\d{2}-\d{4}$/.test(wellId)) {
    logHistoryEvent(session.email, accion, typeof wellId === 'string' ? wellId : null, 'INVALID_WELL_ID');
    return { ok: false, response: { status: 'error', code: 'INVALID_WELL_ID', message: 'formato invalido: ' + (typeof wellId === 'string' ? wellId : typeof wellId) } };
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
    // Fuera del padron: si OTRA fuente institucional conoce el pozo (ITF, NE o una correccion previa; ver PozoExistenciaService.js, el unico lugar que lo decide) se devuelve una vista
    // MINIMA, sin coordenadas ni ficha, con ubicacionResuelta.estado = 'noEnPadron': asi la tarjeta Ubicacion puede ofrecer agregar la primera ubicacion. getWellRecord NO cambia (sigue
    // sin ficha registral). Sin ninguna evidencia: WELL_LOCATION_NOT_FOUND; si no se pudo verificar y nadie confirmo: SERVICE_UNAVAILABLE (un error de Drive no es "no existe").
    var existencia;
    try {
      existencia = pozoExistenciaService_verificar(wellId, { padron: result });
    } catch (err) {
      logHistoryEvent(session.email, 'getWellLocation', wellId, 'SERVICE_UNAVAILABLE');
      return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
    }
    if (existencia.existe && !existencia.enPadron) {
      logHistoryEvent(session.email, 'getWellLocation', wellId, 'OK_NO_EN_PADRON');
      return { status: 'ok', data: pozoExistenciaService_ubicacionFueraDelPadron(wellId) };
    }
    if (existencia.indeterminado) {
      logHistoryEvent(session.email, 'getWellLocation', wellId, 'SERVICE_UNAVAILABLE');
      return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo verificar el pozo ' + wellId };
    }
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

// Ubicaciones VALIDADAS vigentes (delta del punto operativo): {wellId, lat, lon, vts} por pozo. Mismo contrato de permisos que getMapaPozos: CUALQUIER usuario
// activo, sin permiso de modulo (todos los usuarios deben ver la misma posicion del mismo pozo, y esta coordenada es la que reemplaza a la base que ya ven). Sesion
// invalida -> UNAUTHORIZED; usuario inactivo -> USER_DISABLED. No se audita por wellId (no recibe ninguno). Nada de autor, observacion, ids ni historial.
function handleGetUbicacionesValidadas(sessionToken) {
  var validation = validateSession(sessionToken, 'getUbicacionesValidadas');
  if (!validation.ok) {
    return validation.response;
  }
  try {
    return { status: 'ok', data: ubicacionCorreccionService_getUbicacionesValidadas() };
  } catch (err) {
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
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

  // wellIdsSinCoordenada: pozos de la red NE sin coordenada propia (no se dibujan,
  // pero siguen siendo miembros de la red); lista corta de wellId, nada mas.
  return { status: 'ok', data: { puntos: result.puntos, wellIdsSinCoordenada: result.wellIdsSinCoordenada || [] } };
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

// --- Galeria general de fotos de pozos / puntos NE (FotosPozos v1) ---
// Gates INDEPENDIENTES de "reemplazo": ver (galeria, imagen, resumen) = "fotos";
// cargar = "fotos_carga". fotos_carga NO implica "fotos": un usuario que solo
// puede cargar no ve la galeria, ni contadores, ni el resumen (el backend lee
// lo que necesita para SU subida, pero no se lo devuelve). Auditoria sin ruido:
// las lecturas OK no escriben en Historial; la subida OK si (es una escritura,
// igual que registrarEvaluacionReemplazo) con la entidad y sin foto ni ids de
// Drive; errores y permisos denegados siempre. Sin Telegram.

function validarSesionPermisoFotosPozos(sessionToken, accion, modulo, entidad) {
  var validation = validateSession(sessionToken, accion, entidad);
  if (!validation.ok) {
    return validation;
  }
  var permiso = validarPermiso(validation.session, accion, entidad || null, modulo);
  if (!permiso.ok) {
    return permiso;
  }
  return { ok: true, session: validation.session };
}

// Clave de entidad para Historial (acotada): wellId o monitoringId si son strings sanos.
function claveEntidadParaLog(wellId, monitoringId) {
  var c = (typeof wellId === 'string' && wellId.trim() !== '') ? wellId : monitoringId;
  return (typeof c === 'string' && c.length <= 40) ? c.trim() : null;
}

function handleGetFotosPozo(sessionToken, wellId, monitoringId, orden) {
  var v = validarSesionPermisoFotosPozos(sessionToken, 'getFotosPozo', 'fotos', claveEntidadParaLog(wellId, monitoringId));
  if (!v.ok) {
    return v.response;
  }
  var resultado;
  try {
    resultado = fotosPozosService_listar(wellId, monitoringId, orden);
  } catch (err) {
    logHistoryEvent(v.session.email, 'getFotosPozo', claveEntidadParaLog(wellId, monitoringId), 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: { entidad: resultado.entidad, total: resultado.total, fotos: resultado.fotos } };
}

function handleGetFotoPozo(sessionToken, fotoId, variante) {
  var v = validarSesionPermisoFotosPozos(sessionToken, 'getFotoPozo', 'fotos');
  if (!v.ok) {
    return v.response;
  }
  var resultado;
  try {
    resultado = fotosPozosService_obtenerImagen(fotoId, variante);
  } catch (err) {
    logHistoryEvent(v.session.email, 'getFotoPozo', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    if (resultado.code === 'STORAGE_UNAVAILABLE') {
      logHistoryEvent(v.session.email, 'getFotoPozo', null, resultado.code);
    }
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: resultado.imagen };
}

// Contador {wellId|monitoringId: n}, solo claves con al menos una foto visible.
function handleGetResumenFotosPozos(sessionToken) {
  var v = validarSesionPermisoFotosPozos(sessionToken, 'getResumenFotosPozos', 'fotos');
  if (!v.ok) {
    return v.response;
  }
  try {
    return { status: 'ok', data: fotosPozosService_resumen() };
  } catch (err) {
    logHistoryEvent(v.session.email, 'getResumenFotosPozos', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

// Unicos campos que una subida puede traer del cliente. Todo lo demas (email,
// estado, estadoVinculo, vinculoMetodo, gpsOrigen, driveFileId, lote, fotoId...)
// lo fija el backend o no existe para el cliente.
var API_FOTOS_POZOS_CAMPOS_SUBIDA = ['wellId', 'monitoringId', 'fuente', 'tipoFoto', 'fechaFotoValor', 'fechaFotoPrecision',
  'fechaFotoFuente', 'observacion', 'gps', 'mimeType', 'imagenBase64', 'thumbBase64', 'sha1Original', 'procesamiento', 'tamanoOriginalBytes'];

function handleSubirFotoPozo(sessionToken, datos) {
  var d = {};
  API_FOTOS_POZOS_CAMPOS_SUBIDA.forEach(function (campo) {
    if (datos && datos[campo] !== undefined) {
      d[campo] = datos[campo];
    }
  });
  var clave = claveEntidadParaLog(d.wellId, d.monitoringId);
  var v = validarSesionPermisoFotosPozos(sessionToken, 'subirFotoPozo', 'fotos_carga', clave);
  if (!v.ok) {
    return v.response;
  }
  var session = v.session;

  var resultado;
  try {
    resultado = fotosPozosService_subir(session.email, d);
  } catch (err) {
    logHistoryEvent(session.email, 'subirFotoPozo', clave, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'subirFotoPozo', clave, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, 'subirFotoPozo', clave, 'OK');
  }
  return { status: 'ok', data: { foto: resultado.foto, duplicada: resultado.duplicada } };
}

// --- Moderacion de fotos de pozos (E8-3) ---
// Gates (todos exactos, `=== true`, y siempre CON `fotos`: quien no puede ver las fotos no solicita ni decide a ciegas):
//   solicitar retiro ........... fotos + fotos_carga
//   retirar / resolver / reponer / historial / cola / imagen de moderacion ... fotos + fotos_moderar
// Orden de chequeos, igual que el resto: sesion -> permisos -> contenido -> estado (DENTRO del lock en las escrituras). email / nombre SIEMPRE de la sesion + hoja Usuarios; el cliente nunca manda
// entidad, estado, email, nombre ni la foto de una resolucion. La hoja FotosPozoEventos es PARTE NECESARIA del contrato: si falta, esta rota o no se puede leer, SERVICE_UNAVAILABLE (nunca se ignora la
// moderacion). Historial: UNA fila por escritura exitosa (accion + entidad + OK), sin motivo, sin fotoId, sin email redundante; un reintento idempotente NO escribe otra. Sin Telegram.
// Codigos de error estables: INVALID_ACCION / INVALID_FOTO_ID / INVALID_SOLICITUD_ID / INVALID_RESOLUCION / INVALID_MOTIVO / INVALID_MOTIVO_TEXTO / INVALID_CLIENT_REQUEST_ID / INVALID_REQUEST (entrada),
// PERMISSION_DENIED, FOTO_NOT_FOUND (para quien solicita cubre inexistente, oculta, retirada, no derivable o sin vinculo: sin oraculo), SOLICITUD_NOT_FOUND, SOLICITUD_YA_ABIERTA, SOLICITUD_ABIERTA,
// SOLICITUD_YA_RESUELTA, FOTO_YA_RETIRADA, FOTO_NO_RETIRADA, REPOSICION_NO_PERMITIDA, ESTADO_NO_DERIVABLE (transiciones, solo moderador), IDEMPOTENCY_CONFLICT, INCONSISTENT_STATE, SERVICE_UNAVAILABLE.

// Permisos de moderacion: TODOS los modulos deben valer exactamente `true` (un valor truthy que no sea boolean true, p. ej. "SI" o 1, no habilita). Mismo mensaje y auditoria que validarPermiso.
function api_validarPermisosEstrictos(session, accion, modulos) {
  for (var i = 0; i < modulos.length; i++) {
    if (hasPermission(session.email, modulos[i]) !== true) {
      logHistoryEvent(session.email, accion, null, 'PERMISSION_DENIED');
      return { ok: false, response: { status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso "' + modulos[i] + '": ' + session.email } };
    }
  }
  return { ok: true };
}

// Lista blanca de campos de entrada (el cliente solo es autoridad sobre estos): el resto de `datos` NO llega al servicio.
function api_camposModeracion(datos, campos) {
  var d = datos && typeof datos === 'object' ? datos : {};
  var salida = {};
  campos.forEach(function (c) {
    if (Object.prototype.hasOwnProperty.call(d, c)) {
      salida[c] = d[c];
    }
  });
  return salida;
}

// Escritura de moderacion: accionApi (nombre del action), accionDominio (FOTOS_MOD_ACCIONES) y modulos (permisos exigidos). datos YA es la lista blanca de la ruta.
function api_escrituraModeracionFotoPozo(sessionToken, accionApi, accionDominio, modulos, datos) {
  var validation = validateSession(sessionToken, accionApi, null);
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;
  var permisos = api_validarPermisosEstrictos(session, accionApi, modulos);
  if (!permisos.ok) {
    return permisos.response;
  }
  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = fotosPozosModeracionOps_ejecutar(Object.assign({ accion: accionDominio }, datos), {
      email: session.email,
      nombre: access.nombre,
      permisos: {
        fotos: hasPermission(session.email, 'fotos') === true,
        fotos_carga: hasPermission(session.email, 'fotos_carga') === true,
        fotos_moderar: hasPermission(session.email, 'fotos_moderar') === true
      }
    });
  } catch (err) {
    // mensaje fijo: el detalle tecnico va a Logger (recortado, sin URLs) y jamas lleva el motivo
    Logger.log(accionApi + ': excepcion: ' + api_limpiarMensajeLog(err));
    logHistoryEvent(session.email, accionApi, null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo completar la accion: intenta de nuevo en unos minutos' };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, accionApi, null, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, accionApi, resultado.entidad ? resultado.entidad.id : null, 'OK');
  }
  var data = { fotoId: resultado.evento.fotoId, duplicada: resultado.duplicada === true };
  if (accionDominio === 'SOLICITAR_RETIRO' || accionDominio === 'RESOLVER_RETIRO') {
    data.solicitudId = accionDominio === 'SOLICITAR_RETIRO' ? resultado.evento.eventoId : resultado.evento.solicitudId;
  }
  if (accionDominio === 'RESOLVER_RETIRO') {
    data.resolucion = resultado.evento.resolucion;
  }
  return { status: 'ok', data: data };
}

function handleSolicitarRetiroFotoPozo(sessionToken, datos) {
  return api_escrituraModeracionFotoPozo(sessionToken, 'solicitarRetiroFotoPozo', 'SOLICITAR_RETIRO', ['fotos', 'fotos_carga'], api_camposModeracion(datos, ['fotoId', 'motivoCodigo', 'motivoTexto', 'clientRequestId']));
}

function handleRetirarFotoPozo(sessionToken, datos) {
  return api_escrituraModeracionFotoPozo(sessionToken, 'retirarFotoPozo', 'RETIRAR', ['fotos', 'fotos_moderar'], api_camposModeracion(datos, ['fotoId', 'motivoCodigo', 'motivoTexto', 'clientRequestId']));
}

function handleResolverRetiroFotoPozo(sessionToken, datos) {
  return api_escrituraModeracionFotoPozo(sessionToken, 'resolverRetiroFotoPozo', 'RESOLVER_RETIRO', ['fotos', 'fotos_moderar'], api_camposModeracion(datos, ['solicitudId', 'resolucion', 'clientRequestId']));
}

function handleReponerFotoPozo(sessionToken, datos) {
  return api_escrituraModeracionFotoPozo(sessionToken, 'reponerFotoPozo', 'REPONER', ['fotos', 'fotos_moderar'], api_camposModeracion(datos, ['fotoId', 'clientRequestId']));
}

// Lectura de moderador: sesion -> permisos (fotos + fotos_moderar) -> servicio. Las lecturas OK no se auditan; permisos denegados y fallas si.
function api_lecturaModeracionFotoPozo(sessionToken, accionApi, fn) {
  var validation = validateSession(sessionToken, accionApi, null);
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;
  var permisos = api_validarPermisosEstrictos(session, accionApi, ['fotos', 'fotos_moderar']);
  if (!permisos.ok) {
    return permisos.response;
  }
  var resultado;
  try {
    resultado = fn();
  } catch (err) {
    Logger.log(accionApi + ': excepcion: ' + api_limpiarMensajeLog(err));
    logHistoryEvent(session.email, accionApi, null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo completar la accion: intenta de nuevo en unos minutos' };
  }
  if (!resultado.ok) {
    if (resultado.code === 'STORAGE_UNAVAILABLE') {
      logHistoryEvent(session.email, accionApi, null, resultado.code);
    }
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: resultado };
}

function handleGetHistorialFotoPozo(sessionToken, fotoId) {
  var r = api_lecturaModeracionFotoPozo(sessionToken, 'getHistorialFotoPozo', function () { return fotosPozosModeracionOps_historial(fotoId); });
  return r.status === 'ok' ? { status: 'ok', data: { foto: r.data.foto, estado: r.data.estado, eventos: r.data.eventos } } : r;
}

function handleGetFotosPozosPendientesModeracion(sessionToken, limit, cursor) {
  var r = api_lecturaModeracionFotoPozo(sessionToken, 'getFotosPozosPendientesModeracion', function () { return fotosPozosModeracionOps_cola(limit, cursor); });
  return r.status === 'ok' ? { status: 'ok', data: { total: r.data.total, items: r.data.items, hayMas: r.data.hayMas, cursor: r.data.cursor } } : r;
}

// Fotos RETIRADAS por eventos que se pueden reponer (E8-5): solo fotos + fotos_moderar, paginado igual que la cola. Sin imagenes, ids de Drive, email, clientRequestId ni secuencia.
function handleGetFotosPozosRetiradasModeracion(sessionToken, limit, cursor) {
  var r = api_lecturaModeracionFotoPozo(sessionToken, 'getFotosPozosRetiradasModeracion', function () { return fotosPozosModeracionOps_retiradas(limit, cursor); });
  return r.status === 'ok' ? { status: 'ok', data: { total: r.data.total, items: r.data.items, hayMas: r.data.hayMas, cursor: r.data.cursor } } : r;
}

// Imagen de una foto para el moderador, activa o RETIRADA (el endpoint normal getFotoPozo sigue respetando la visibilidad). Solo la imagen: ni ids de Drive ni metadata de storage.
function handleGetFotoPozoModeracion(sessionToken, fotoId, variante) {
  var r = api_lecturaModeracionFotoPozo(sessionToken, 'getFotoPozoModeracion', function () { return fotosPozosModeracionOps_imagen(fotoId, variante); });
  return r.status === 'ok' ? { status: 'ok', data: r.data.imagen } : r;
}

// --- Correcciones de ubicacion de pozos (etapa backend base) ---
// La ubicacion corregida en campo NUNCA toca el padron: vive en dos hojas append-only (ver UbicacionCorreccionRepository.js) y
// su estado se deriva del log. Permisos (todos fail-closed, mas el usuario activo que ya exige validateSession):
//   leer correcciones de un pozo ..... ubicacion
//   proponer ......................... ubicacion + ubicacion_corregir
//                                      (si ADEMAS tiene ubicacion_validar la correccion nace VALIDADA: es una correccion directa, sin
//                                       validacion de otra persona; si no, queda PROPUESTA pendiente)
//   cola de validacion / validar /
//   rechazar / revertir .............. ubicacion + ubicacion_validar   (validar puede ser una propuesta propia; rechazar la propia, no)
// Orden de chequeos, igual que el resto: sesion -> formato de wellId -> permisos -> contenido. email/nombre SIEMPRE de la
// sesion + hoja Usuarios, nunca del cliente. Las respuestas no incluyen emails (solo nombres y el booleano "propia").
// Auditoria en Historial: propuesta/validacion/rechazo/reversion (OK), permisos denegados, transiciones invalidas y demas
// errores; los reenvios idempotentes (duplicada) y las lecturas no, salvo el autocurado de una escritura parcial (AUTOCURADA).
// Sin Telegram.

function validarPermisosTodos(session, accion, wellId, modulos) {
  for (var i = 0; i < modulos.length; i++) {
    var permiso = validarPermiso(session, accion, wellId, modulos[i]);
    if (!permiso.ok) {
      return permiso;
    }
  }
  return { ok: true };
}

function respuestaErrorCorreccion(resultado) {
  var r = { status: 'error', code: resultado.code, message: resultado.message };
  if (resultado.distanciaM !== undefined && resultado.distanciaM !== null) {
    r.distanciaM = resultado.distanciaM;
  }
  // errores de una coordenada ingresada: detalle = codigo fino (p. ej. MINUTOS_FUERA_DE_RANGO) y campo = donde (lat.m, x...), sin ningun dato del usuario
  if (typeof resultado.detalle === 'string') {
    r.detalle = resultado.detalle;
  }
  if (typeof resultado.campo === 'string') {
    r.campo = resultado.campo;
  }
  return r;
}

function handleProponerCorreccionUbicacion(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSessionAndWellId(sessionToken, d.wellId, 'proponerCorreccionUbicacion');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'proponerCorreccionUbicacion', d.wellId, ['ubicacion', 'ubicacion_corregir']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var access = getUserAccess(session.email);
  // Corregir + validar = correccion directa: el permiso se consulta aca (fail-closed: hasPermission es false ante cualquier duda) y el servicio
  // solo recibe el booleano; el cliente no puede pedirlo.
  var autoValidar = hasPermission(session.email, 'ubicacion_validar') === true;
  var resultado;
  try {
    resultado = ubicacionCorreccionService_proponer(session.email, access.nombre, d.wellId, {
      lat: d.lat,
      lon: d.lon,
      metodo: d.metodo,
      precisionGpsM: d.precisionGpsM,
      observacion: d.observacion,
      clientRequestId: d.clientRequestId,
      coordenadaOriginal: d.coordenadaOriginal
    }, { autoValidar: autoValidar });
  } catch (err) {
    logHistoryEvent(session.email, 'proponerCorreccionUbicacion', d.wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'proponerCorreccionUbicacion', d.wellId, resultado.code);
    return respuestaErrorCorreccion(resultado);
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, 'proponerCorreccionUbicacion', d.wellId, 'OK');
  } else if (resultado.curada) {
    // el reintento completo una correccion que habia quedado sin su evento PROPUESTA: queda constancia en Historial
    logHistoryEvent(session.email, 'proponerCorreccionUbicacion', d.wellId, 'AUTOCURADA');
  }
  avisarValidadoresCorreccion(session.email, d.wellId, resultado);
  var data = { correccion: resultado.correccion, duplicada: resultado.duplicada, curada: resultado.curada === true };
  if (resultado.autoValidada === true) {
    // la validacion directa queda auditada como lo que es: una validacion (ademas de la propuesta), a nombre del mismo usuario
    logHistoryEvent(session.email, 'validarCorreccionUbicacion', d.wellId, 'OK');
    data.autoValidada = true;
    data.supersedidas = resultado.supersedidas || [];
  }
  return { status: 'ok', data: data };
}

// Aviso por email a quienes validan (UbicacionCorreccionNotificacion.js) cuando una correccion NUEVA queda PROPUESTA. No avisa si quedo VALIDADA
// (correccion directa de quien corrige y valida) ni en un reintento idempotente (duplicada) - salvo el autocurado de una escritura parcial, que es
// cuando esa correccion recien llega a PROPUESTA. Es best-effort: cualquier problema (sin permiso de MailApp, cuota, hoja de usuarios) se registra
// en Historial y NUNCA cambia la respuesta ni deshace la propuesta.
function avisarValidadoresCorreccion(email, wellId, resultado) {
  var c = resultado && resultado.correccion;
  if (!c || c.estado !== 'PROPUESTA' || resultado.autoValidada === true) {
    return;
  }
  if (resultado.duplicada === true && resultado.curada !== true) {
    return;
  }
  var aviso;
  try {
    aviso = ubicacionCorreccionNotificacion_notificarPendiente(email, c);
  } catch (err) {
    aviso = { resultado: 'ERROR' };
  }
  var texto = ubicacionCorreccionNotificacion_textoAuditoria(aviso);
  if (texto) {
    logHistoryEvent(email, 'notificarCorreccionUbicacion', wellId, texto);
  }
}

function handleGetCorreccionesUbicacionPozo(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getCorreccionesUbicacionPozo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getCorreccionesUbicacionPozo', wellId, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  try {
    return { status: 'ok', data: ubicacionCorreccionService_getPorPozo(session.email, wellId) };
  } catch (err) {
    logHistoryEvent(session.email, 'getCorreccionesUbicacionPozo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

function handleGetCorreccionesUbicacionPendientes(sessionToken) {
  var validation = validateSession(sessionToken, 'getCorreccionesUbicacionPendientes');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'getCorreccionesUbicacionPendientes', null, ['ubicacion', 'ubicacion_validar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  try {
    return { status: 'ok', data: ubicacionCorreccionService_getPendientes(session.email) };
  } catch (err) {
    logHistoryEvent(session.email, 'getCorreccionesUbicacionPendientes', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
}

// validar / rechazar / revertir comparten sesion, permisos y auditoria; solo cambia la rutina del servicio.
function resolverCorreccionUbicacion(accion, ejecutar, sessionToken, correccionId, motivo) {
  var validation = validateSession(sessionToken, accion);
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, accion, null, ['ubicacion', 'ubicacion_validar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = ejecutar(session.email, access.nombre, correccionId, motivo);
  } catch (err) {
    logHistoryEvent(session.email, accion, null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, accion, resultado.wellId || null, resultado.code);
    return respuestaErrorCorreccion(resultado);
  }
  logHistoryEvent(session.email, accion, resultado.correccion.wellId, 'OK');
  return { status: 'ok', data: { correccion: resultado.correccion, supersedidas: resultado.supersedidas || [] } };
}

function handleValidarCorreccionUbicacion(sessionToken, correccionId, motivo) {
  return resolverCorreccionUbicacion('validarCorreccionUbicacion', function (e, n, id, m) { return ubicacionCorreccionService_validar(e, n, id, m); }, sessionToken, correccionId, motivo);
}

function handleRechazarCorreccionUbicacion(sessionToken, correccionId, motivo) {
  return resolverCorreccionUbicacion('rechazarCorreccionUbicacion', function (e, n, id, m) { return ubicacionCorreccionService_rechazar(e, n, id, m); }, sessionToken, correccionId, motivo);
}

function handleRevertirCorreccionUbicacion(sessionToken, correccionId, motivo) {
  return resolverCorreccionUbicacion('revertirCorreccionUbicacion', function (e, n, id, m) { return ubicacionCorreccionService_revertir(e, n, id, m); }, sessionToken, correccionId, motivo);
}

// --- Decisiones sobre las fuentes registrales de ubicacion (aceptar / descartar / quitar la aceptacion / restaurar) ---
// Hoja append-only UbicacionFuenteDecisiones (ver UbicacionFuenteDecisionesRepository.js); NO son correcciones de campo. Permisos (fail-closed, mas el usuario activo):
//   leer las fuentes y decisiones de un pozo ..... ubicacion
//   decidir (aceptar / descartar / quitar / restaurar) ... ubicacion + ubicacion_validar   (ubicacion_corregir NO alcanza)
// Orden de chequeos, igual que el resto: sesion -> formato de wellId -> permisos -> contenido. email/nombre SIEMPRE de la sesion + hoja Usuarios.
// Auditoria en Historial: ademas de la hoja (que ya guarda quien, cuando, que y por que), se registra CADA INTENTO: lo que la hoja no puede guardar (permiso denegado,
// transicion invalida, estado viejo, errores) y, para una decision escrita, la accion legible FUENTE_ACEPTADA / FUENTE_DESCARTADA / FUENTE_ACEPTACION_QUITADA /
// FUENTE_RESTAURADA con resultado OK. Nunca el payload, el motivo, el email de otra persona ni coordenadas. Los reintentos idempotentes y las lecturas no se auditan.
// Un fallo interno (p. ej. de Sheets) devuelve un mensaje generico: el detalle va a Logger.

function respuestaErrorDecisionFuente(resultado) {
  var r = { status: 'error', code: resultado.code, message: resultado.message };
  if (resultado.versionActual !== undefined && resultado.versionActual !== null) {
    r.versionActual = resultado.versionActual;
  }
  // sugerencias: ALREADY_PENDING referencia la que ya existe (item seguro, sin emails); PENDING_LIMIT_REACHED informa el tope; ALREADY_RESOLVED el estado en que quedo
  if (resultado.sugerencia && typeof resultado.sugerencia === 'object') {
    r.sugerencia = resultado.sugerencia;
  }
  if (typeof resultado.limite === 'number') {
    r.limite = resultado.limite;
  }
  if (typeof resultado.estado === 'string') {
    r.estado = resultado.estado;
  }
  return r;
}

function respuestaServicioNoDisponibleDecision(accion, email, wellId, err) {
  Logger.log('Decisiones de fuentes: ' + accion + ' fallo: ' + api_limpiarMensajeLog(err));
  logHistoryEvent(email, accion, wellId, 'SERVICE_UNAVAILABLE');
  return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' };
}

// Efecto REGISTRAL de las decisiones sobre el padron actual (delta del punto operativo registral): {version, periodo, parcial, decisiones:[{wellId, estado:'R'|'C'|'D', lat,
// lon} | {wellId, estado:'N'}]}. NO incluye la validada en campo (V): el cliente la compone despues. Mismo contrato de permisos que getMapaPozos y getUbicacionesValidadas:
// CUALQUIER usuario activo, sin permiso de modulo. Es el patron real del mapa: el dataset base que ya recibe todo usuario activo lleva el mismo tipo de dato (wellId, lat, lon,
// estado) y esto solo cambia el punto de ESOS pozos; nada individual (fuentes, motivos, autores, historial) sale por aca, y eso sigue gateado por `ubicacion`. Sesion invalida ->
// UNAUTHORIZED; usuario inactivo -> USER_DISABLED. No recibe wellId ni se audita por pozo; un fallo se audita y responde SERVICE_UNAVAILABLE generico (el detalle va a Logger).
function handleGetDecisionesFuentesDelta(sessionToken) {
  var validation = validateSession(sessionToken, 'getDecisionesFuentesDelta');
  if (!validation.ok) {
    return validation.response;
  }
  var data;
  try {
    data = ubicacionFuenteDecisionesService_getDelta();
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('getDecisionesFuentesDelta', validation.session.email, null, err);
  }
  return { status: 'ok', data: data };
}

function handleGetDecisionesFuentesPozo(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getDecisionesFuentesPozo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getDecisionesFuentesPozo', wellId, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  var resultado;
  try {
    resultado = ubicacionFuenteDecisionesService_getPorPozo(wellId);
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('getDecisionesFuentesPozo', session.email, wellId, err);
  }
  if (!resultado.ok) {
    return respuestaErrorDecisionFuente(resultado);
  }
  return { status: 'ok', data: resultado.data };
}

function handleDecidirFuenteUbicacion(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSessionAndWellId(sessionToken, d.wellId, 'decidirFuenteUbicacion');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'decidirFuenteUbicacion', d.wellId, ['ubicacion', 'ubicacion_validar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = ubicacionFuenteDecisionesService_decidir(session.email, access.nombre, {
      wellId: d.wellId,
      fuenteTipo: d.fuenteTipo,
      x: d.x,
      y: d.y,
      accion: d.accion,
      motivo: d.motivo,
      versionVista: d.versionVista,
      clientRequestId: d.clientRequestId
    });
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('decidirFuenteUbicacion', session.email, d.wellId, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'decidirFuenteUbicacion', d.wellId, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, resultado.auditoria || 'decidirFuenteUbicacion', d.wellId, 'OK');
  }
  var data = resultado.data ? Object.assign({}, resultado.data) : { wellId: d.wellId };
  data.decision = resultado.decision;
  data.duplicada = resultado.duplicada === true;
  return { status: 'ok', data: data };
}


// --- Sugerencias sobre las fuentes registrales (quien NO valida pide aceptar / descartar / restaurar; un validador aprueba o rechaza) ---
// Hoja append-only UbicacionFuenteSugerencias (ver UbicacionFuenteSugerenciasRepository.js). Una sugerencia NO es una decision: por si sola no cambia nada. Permisos (fail-closed,
// mas el usuario activo):
//   sugerir / leer las sugerencias de un pozo / cancelar la propia ........ ubicacion
//   la cola de pendientes y resolver (aprobar / rechazar) .................. ubicacion + ubicacion_validar
// El backend permite que un validador tambien sugiera (la UI no se lo ofrece). Orden de chequeos: sesion -> formato de wellId (si lo hay) -> permisos -> contenido.
// Auditoria en Historial (sin payload, motivos, coordenadas ni emails ajenos): FUENTE_SUGERIDA, FUENTE_SUGERENCIA_APROBADA / _RECHAZADA / _CANCELADA / _OBSOLETA (y, al aprobar, la
// accion de la decision que se creo: FUENTE_ACEPTADA...). Los fallos se registran con su codigo. Los reintentos idempotentes y las lecturas no se auditan.

function avisarValidadoresSugerencia(email, wellId, resultado) {
  if (!resultado || resultado.nueva !== true || !resultado.notificar) {
    return;
  }
  var aviso;
  try {
    aviso = ubicacionFuenteSugerenciaNotificacion_notificarPendiente(email, resultado.notificar);
  } catch (err) {
    aviso = { resultado: 'ERROR' };
  }
  var texto = ubicacionCorreccionNotificacion_textoAuditoria(aviso);
  if (texto) {
    logHistoryEvent(email, 'notificarSugerenciaFuente', wellId, texto);
  }
}

function handleSugerirDecisionFuente(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSessionAndWellId(sessionToken, d.wellId, 'sugerirDecisionFuente');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'sugerirDecisionFuente', d.wellId, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = ubicacionFuenteSugerenciasService_sugerir(session.email, access.nombre, {
      wellId: d.wellId,
      fuenteTipo: d.fuenteTipo,
      x: d.x,
      y: d.y,
      accionSugerida: d.accionSugerida,
      motivo: d.motivo,
      versionVista: d.versionVista,
      clientRequestId: d.clientRequestId
    });
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('sugerirDecisionFuente', session.email, d.wellId, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'sugerirDecisionFuente', d.wellId, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, resultado.auditoria || 'sugerirDecisionFuente', d.wellId, 'OK');
    avisarValidadoresSugerencia(session.email, d.wellId, resultado);
  }
  return { status: 'ok', data: { sugerencia: resultado.sugerencia, duplicada: resultado.duplicada === true } };
}

function handleGetSugerenciasFuentesPozo(sessionToken, wellId) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getSugerenciasFuentesPozo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getSugerenciasFuentesPozo', wellId, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  // quien valida ve todas las pendientes del pozo; el resto, solo las suyas (la consulta de permisos no se audita: es una lectura)
  var esValidador = hasPermission(session.email, 'ubicacion_validar') === true;
  var resultado;
  try {
    resultado = ubicacionFuenteSugerenciasService_getPorPozo(session.email, esValidador, wellId);
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('getSugerenciasFuentesPozo', session.email, wellId, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'getSugerenciasFuentesPozo', wellId, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  return { status: 'ok', data: resultado.data };
}

function handleGetSugerenciasFuentesPendientes(sessionToken) {
  var validation = validateSession(sessionToken, 'getSugerenciasFuentesPendientes');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'getSugerenciasFuentesPendientes', null, ['ubicacion', 'ubicacion_validar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var resultado;
  try {
    resultado = ubicacionFuenteSugerenciasService_getPendientes();
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('getSugerenciasFuentesPendientes', session.email, null, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'getSugerenciasFuentesPendientes', null, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  return { status: 'ok', data: resultado.data };
}

function handleResolverSugerenciaFuente(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSession(sessionToken, 'resolverSugerenciaFuente');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'resolverSugerenciaFuente', null, ['ubicacion', 'ubicacion_validar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = ubicacionFuenteSugerenciasService_resolver(session.email, access.nombre, {
      sugerenciaId: d.sugerenciaId,
      resolucion: d.resolucion,
      motivo: d.motivo,
      versionVista: d.versionVista,
      clientRequestId: d.clientRequestId
    });
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('resolverSugerenciaFuente', session.email, null, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'resolverSugerenciaFuente', null, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  if (!resultado.duplicada) {
    // la decision real (si se creo) tiene su propia linea legible, igual que si se hubiera decidido directo; despues, la de la sugerencia
    if (resultado.auditoriaDecision) {
      logHistoryEvent(session.email, resultado.auditoriaDecision, resultado.wellId, 'OK');
    }
    logHistoryEvent(session.email, resultado.auditoria || 'resolverSugerenciaFuente', resultado.wellId, 'OK');
  }
  var data = { resultado: resultado.resultado, sugerencia: resultado.sugerencia, duplicada: resultado.duplicada === true };
  if (resultado.decision) {
    data.decision = resultado.decision;
  }
  if (resultado.data) {
    data.fuentes = resultado.data;                 // la vista actualizada del pozo (la misma de getDecisionesFuentesPozo)
  }
  if (resultado.motivoNoAplicable) {
    data.motivoNoAplicable = resultado.motivoNoAplicable;
  }
  return { status: 'ok', data: data };
}

function handleCancelarSugerenciaFuente(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSession(sessionToken, 'cancelarSugerenciaFuente');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'cancelarSugerenciaFuente', null, 'ubicacion');
  if (!permiso.ok) {
    return permiso.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = ubicacionFuenteSugerenciasService_cancelar(session.email, access.nombre, {
      sugerenciaId: d.sugerenciaId,
      motivo: d.motivo,
      clientRequestId: d.clientRequestId
    });
  } catch (err) {
    return respuestaServicioNoDisponibleDecision('cancelarSugerenciaFuente', session.email, null, err);
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'cancelarSugerenciaFuente', null, resultado.code);
    return respuestaErrorDecisionFuente(resultado);
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, resultado.auditoria || 'cancelarSugerenciaFuente', resultado.wellId, 'OK');
  }
  return { status: 'ok', data: { sugerencia: resultado.sugerencia, duplicada: resultado.duplicada === true } };
}

// Observaciones generales de un pozo (E5-1, solo lectura). Orden de chequeos, igual que el resto: sesion -> formato de wellId -> permiso `observaciones` -> contenido. NO verifica que el
// pozo exista (sin filas devuelve una lista vacia: leer no es un oraculo de existencia; las observaciones tampoco son evidencia de que un pozo exista). Quien ademas tiene
// `observaciones_anular` recibe el texto original de las observaciones ANULADAS; el resto recibe null. Nunca viaja el email del autor, la secuencia ni el clientRequestId.
// Una lectura OK no se audita (alta frecuencia y sin efectos); permisos denegados, parametros invalidos y fallas si, como siempre. Una hoja ausente o con un esquema que no se
// reconoce NO se crea ni se repara: SERVICE_UNAVAILABLE (fail-closed).
function handleGetObservacionesPozo(sessionToken, wellId, limit, antesDeSecuencia) {
  var validation = validateSessionAndWellId(sessionToken, wellId, 'getObservacionesPozo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permiso = validarPermiso(session, 'getObservacionesPozo', wellId, 'observaciones');
  if (!permiso.ok) {
    return permiso.response;
  }

  // moderador = observaciones_anular (privacidad del texto de las anuladas); `sesion` alimenta puedeAnular de cada observacion con los permisos de HOY (booleanos estrictos; el email no sale)
  var moderador = hasPermission(session.email, 'observaciones_anular') === true;
  var resultado;
  try {
    resultado = observacionesPozoService_getObservaciones(wellId, { limit: limit, antesDeSecuencia: antesDeSecuencia }, {
      moderador: moderador,
      sesion: {
        email: session.email,
        permisos: { observaciones: hasPermission(session.email, 'observaciones') === true, agregar: hasPermission(session.email, 'observaciones_agregar') === true, anular: moderador }
      }
    });
  } catch (err) {
    logHistoryEvent(session.email, 'getObservacionesPozo', wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: err.toString() };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'getObservacionesPozo', wellId, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  return { status: 'ok', data: resultado.data };
}

// Agregar una observacion a un pozo (E5-2). Orden de chequeos, igual que el resto: sesion -> formato de wellId -> permisos (`observaciones` Y `observaciones_agregar`, ambos exactos:
// ninguno sustituye al otro ni lo hace `observaciones_anular`) -> contenido -> existencia del pozo. email / nombre SIEMPRE de la sesion + hoja Usuarios, nunca del cliente.
// Auditoria en Historial: UNA fila por observacion creada (OK), con accion + wellId + resultado: NUNCA el texto, el clientRequestId ni el id; los reenvios idempotentes (duplicada) no
// escriben otra; permisos denegados y errores si, como siempre (por su codigo). La respuesta no trae email, clientRequestId ni secuencia. Los errores no repiten el contenido.
function handleAgregarObservacionPozo(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSessionAndWellId(sessionToken, d.wellId, 'agregarObservacionPozo');
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  var permisos = validarPermisosTodos(session, 'agregarObservacionPozo', d.wellId, ['observaciones', 'observaciones_agregar']);
  if (!permisos.ok) {
    return permisos.response;
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = observacionesPozoService_agregar(session.email, access.nombre, d.wellId, {
      texto: d.texto,
      categoria: d.categoria,
      clientRequestId: d.clientRequestId
    }, {
      observaciones: hasPermission(session.email, 'observaciones') === true,
      agregar: hasPermission(session.email, 'observaciones_agregar') === true,
      anular: hasPermission(session.email, 'observaciones_anular') === true
    });
  } catch (err) {
    // mensaje fijo: el detalle tecnico va a Logger (recortado, sin URLs) y jamas lleva el texto de la observacion
    Logger.log('agregarObservacionPozo: excepcion: ' + api_limpiarMensajeLog(err));
    logHistoryEvent(session.email, 'agregarObservacionPozo', d.wellId, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo guardar la observacion: intenta de nuevo en unos minutos' };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'agregarObservacionPozo', d.wellId, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, 'agregarObservacionPozo', d.wellId, 'OK');
  }
  return { status: 'ok', data: { wellId: d.wellId, duplicada: resultado.duplicada === true, observacion: resultado.observacion } };
}

// Anular una observacion (E5-3). Orden de chequeos, igual que el resto pero SIN wellId del cliente: sesion -> permiso base `observaciones` Y (`observaciones_agregar` O
// `observaciones_anular`) -> contenido (observacionId, motivo, clientRequestId) -> observacion objetivo -> autorizacion fina (moderador: cualquier autor; autor: solo la propia, por email
// normalizado) -> idempotencia -> transicion. Los permisos se evaluan SIEMPRE antes de resolver un reintento: la idempotencia nunca es un bypass. NO verifica la existencia del pozo. email /
// nombre SIEMPRE de la sesion + hoja Usuarios. Historial: UNA fila `anularObservacionPozo` + wellId (el de la ALTA) + OK por anulacion creada, jamas el motivo, el texto, el observacionId ni el
// clientRequestId; el reintento idempotente no escribe otra; errores con su codigo. La respuesta no trae email, clientRequestId ni secuencia, y el texto original solo con observaciones_anular.
function handleAnularObservacionPozo(sessionToken, datos) {
  var d = datos || {};
  var validation = validateSession(sessionToken, 'anularObservacionPozo', null);
  if (!validation.ok) {
    return validation.response;
  }
  var session = validation.session;

  // los tres permisos SOLO valen con `=== true` (un valor truthy que no sea el booleano no habilita nada)
  if (hasPermission(session.email, 'observaciones') !== true) {
    logHistoryEvent(session.email, 'anularObservacionPozo', null, 'PERMISSION_DENIED');
    return { status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso "observaciones": ' + session.email };
  }
  var puedeAgregar = hasPermission(session.email, 'observaciones_agregar') === true;
  var puedeAnular = hasPermission(session.email, 'observaciones_anular') === true;
  if (!puedeAgregar && !puedeAnular) {
    logHistoryEvent(session.email, 'anularObservacionPozo', null, 'PERMISSION_DENIED');
    return { status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso para anular observaciones: ' + session.email };
  }

  var access = getUserAccess(session.email);
  var resultado;
  try {
    resultado = observacionesPozoService_anular(session.email, access.nombre, {
      observacionId: d.observacionId,
      motivo: d.motivo,
      clientRequestId: d.clientRequestId
    }, { observaciones: true, agregar: puedeAgregar, anular: puedeAnular });
  } catch (err) {
    // mensaje fijo: el detalle tecnico va a Logger (recortado, sin URLs) y jamas lleva el motivo ni el texto
    Logger.log('anularObservacionPozo: excepcion: ' + api_limpiarMensajeLog(err));
    logHistoryEvent(session.email, 'anularObservacionPozo', null, 'SERVICE_UNAVAILABLE');
    return { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo anular la observacion: intenta de nuevo en unos minutos' };
  }
  if (!resultado.ok) {
    logHistoryEvent(session.email, 'anularObservacionPozo', resultado.wellId || null, resultado.code);
    return { status: 'error', code: resultado.code, message: resultado.message };
  }
  if (!resultado.duplicada) {
    logHistoryEvent(session.email, 'anularObservacionPozo', resultado.wellId, 'OK');
  }
  return { status: 'ok', data: { wellId: resultado.wellId, duplicada: resultado.duplicada === true, observacion: resultado.observacion } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    doPost,
    handleSugerirDecisionFuente,
    handleGetSugerenciasFuentesPozo,
    handleGetSugerenciasFuentesPendientes,
    handleResolverSugerenciaFuente,
    handleCancelarSugerenciaFuente,
    handleGetObservacionesPozo,
    handleAgregarObservacionPozo,
    handleAnularObservacionPozo,
    handleGetDecisionesFuentesPozo,
    handleGetDecisionesFuentesDelta,
    handleDecidirFuenteUbicacion,
    handleProponerCorreccionUbicacion,
    handleGetCorreccionesUbicacionPozo,
    handleGetCorreccionesUbicacionPendientes,
    handleValidarCorreccionUbicacion,
    handleRechazarCorreccionUbicacion,
    handleRevertirCorreccionUbicacion,
    handleSolicitarRetiroFotoPozo,
    handleRetirarFotoPozo,
    handleResolverRetiroFotoPozo,
    handleReponerFotoPozo,
    handleGetHistorialFotoPozo,
    handleGetFotosPozosPendientesModeracion,
    handleGetFotosPozosRetiradasModeracion,
    handleGetFotoPozoModeracion,
    handleGetFotosPozo,
    handleGetFotoPozo,
    handleGetResumenFotosPozos,
    handleSubirFotoPozo,
    handleGetProfile,
    handleGetWellRecord,
    handleGetMetadata,
    handleGetMonitoringPoint,
    handleGetWellLocation,
    handleRegisterWellSearch,
    handleGetMapaPozos,
    handleGetUbicacionesValidadas,
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
