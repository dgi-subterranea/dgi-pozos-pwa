const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Api.js no declara verifySessionToken/isUserActive/logHistoryEvent/
// profileService_getProfile - en Apps Script real vienen del scope
// global compartido con AuthService.js/HistoryService.js/ProfileService.js.
// Aca se fakean por completo, para testear unicamente la logica de
// handleGetProfile (formato/rango de wellId, mapeo de resultados a
// codigos), sin tocar Google/Drive/Sheets.
beforeEach(() => {
  installAppsScriptFakes();
});

// Por defecto, una sesion valida tiene los 4 permisos concedidos - asi
// los tests existentes de cada handler (que no son sobre permisos) no
// necesitan mockear hasPermission uno por uno. Los tests de permisos
// especificos pisan esto con mockImplementation/mockReturnValueOnce.
function mockValidSession(email) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: email || 'user@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockReturnValue(true);
}

describe('handleGetProfile', () => {
  test('sessionToken invalido: UNAUTHORIZED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetProfile('token-vencido', '03-0123');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetProfile('token-valido', '03-0123');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('formato invalido (letras): INVALID_WELL_ID', () => {
    mockValidSession();
    const result = Api.handleGetProfile('token-valido', '03-ABC');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
  });

  test('departamento fuera de rango por arriba (20): INVALID_WELL_ID, no consulta Drive', () => {
    mockValidSession();
    const result = Api.handleGetProfile('token-valido', '20-0123');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.profileService_getProfile).not.toHaveBeenCalled();
  });

  test('departamento fuera de rango por abajo (00): INVALID_WELL_ID, no consulta Drive', () => {
    mockValidSession();
    const result = Api.handleGetProfile('token-valido', '00-0123');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.profileService_getProfile).not.toHaveBeenCalled();
  });

  test('pozo valido existente: OK con imagen en base64', () => {
    mockValidSession();
    const fakeBlob = { getBytes: () => [1, 2, 3], getContentType: () => 'image/jpeg' };
    global.profileService_getProfile.mockReturnValue({ found: true, blob: fakeBlob });

    const result = Api.handleGetProfile('token-valido', '03-0123');

    expect(result.status).toBe('ok');
    expect(result.data.wellId).toBe('03-0123');
    expect(result.data.mimeType).toBe('image/jpeg');
    expect(typeof result.data.imageBase64).toBe('string');
    expect(result.data.originalSizeBytes).toBe(3);
  });

  test('pozo bien formado pero inexistente: PROFILE_NOT_FOUND', () => {
    mockValidSession();
    global.profileService_getProfile.mockReturnValue({ found: false });

    const result = Api.handleGetProfile('token-valido', '19-9999');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PROFILE_NOT_FOUND');
  });

  test('sin permiso "perfil" (usuario activo, sesion valida): PERMISSION_DENIED, no consulta Drive - llamada manual directa al handler', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo !== 'perfil');

    const result = Api.handleGetProfile('token-valido', '03-0123');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.profileService_getProfile).not.toHaveBeenCalled();
  });

  test('PERMISSION_DENIED se audita en Historial, distinto de PROFILE_NOT_FOUND', () => {
    mockValidSession('user@example.com');
    global.hasPermission.mockReturnValue(false);

    Api.handleGetProfile('token-valido', '03-0123');

    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'getProfile', '03-0123', 'PERMISSION_DENIED');
  });

  test('error de repositorio/Drive al buscar: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.profileService_getProfile.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetProfile('token-valido', '03-0123');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('handleGetWellRecord', () => {
  test('sessionToken invalido: UNAUTHORIZED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetWellRecord('token-vencido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('formato invalido: INVALID_WELL_ID, no consulta el registro', () => {
    mockValidSession();
    const result = Api.handleGetWellRecord('token-valido', '01-ABC');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });

  test('departamento fuera de rango: INVALID_WELL_ID, no consulta el registro', () => {
    mockValidSession();
    const result = Api.handleGetWellRecord('token-valido', '20-0123');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });

  test('sin permiso "datos": PERMISSION_DENIED, no consulta el registro - llamada manual directa al handler', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo !== 'datos');

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });

  test('ficha encontrada: OK con el registro tal cual lo devuelve el service', () => {
    mockValidSession();
    const record = { wellId: '01-0012', identificacion: { departamento: 'Capital' } };
    global.registryService_getWellRecord.mockReturnValue({ found: true, record });

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(record);
  });

  // El saneo de coordenadas es responsabilidad de RegistryService (ver
  // RegistryService.test.js) - aca solo se confirma que Api.js nunca
  // agrega ni reintroduce campos geograficos: pasa el record tal cual
  // lo devuelve el service, incluso si por error trajera coordenadas.
  test('getWellRecord no agrega coordenadas geograficas al payload: pasa el record del service sin tocarlo', () => {
    mockValidSession();
    const recordSinGeo = {
      wellId: '01-0012',
      ubicacion: { domicilioPozo: 'CALLE FALSA 123', planoDgi: '1-A' }
    };
    global.registryService_getWellRecord.mockReturnValue({ found: true, record: recordSinGeo });

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.data.ubicacion.coordenadas).toBeUndefined();
    expect(result.data.ubicacion.coordenadasProvincia).toBeUndefined();
    expect(result.data.ubicacion.ubicacionResuelta).toBeUndefined();
    expect(result.data.ubicacion.domicilioPozo).toBe('CALLE FALSA 123');
  });

  test('ficha inexistente: WELL_RECORD_NOT_FOUND', () => {
    mockValidSession();
    global.registryService_getWellRecord.mockReturnValue({ found: false });

    const result = Api.handleGetWellRecord('token-valido', '01-9999');

    expect(result.status).toBe('error');
    expect(result.code).toBe('WELL_RECORD_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.registryService_getWellRecord.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('registra el evento getWellRecord en el historial con el resultado', () => {
    mockValidSession('user@example.com');
    global.registryService_getWellRecord.mockReturnValue({ found: true, record: { wellId: '01-0012' } });

    Api.handleGetWellRecord('token-valido', '01-0012');

    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'getWellRecord', '01-0012', 'OK');
  });

  test('la ficha del pozo es independiente del ITF: no llama a profileService_getProfile', () => {
    mockValidSession();
    global.registryService_getWellRecord.mockReturnValue({ found: true, record: { wellId: '01-0012' } });

    Api.handleGetWellRecord('token-valido', '01-0012');

    expect(global.profileService_getProfile).not.toHaveBeenCalled();
  });
});

describe('handleGetMetadata', () => {
  test('sessionToken invalido: UNAUTHORIZED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetMetadata('token-vencido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.registryService_getMetadata).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetMetadata('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('no requiere wellId: sesion valida sin wellId alcanza', () => {
    mockValidSession();
    global.registryService_getMetadata.mockReturnValue({ found: true, metadata: { generadoEl: 'x', periodo: '2026-09' } });

    const result = Api.handleGetMetadata('token-valido');

    expect(result.status).toBe('ok');
  });

  test('metadata encontrada: OK con generadoEl y periodo', () => {
    mockValidSession();
    global.registryService_getMetadata.mockReturnValue({
      found: true,
      metadata: { generadoEl: '2026-09-10T13:48:20-03:00', periodo: '2026-09' }
    });

    const result = Api.handleGetMetadata('token-valido');

    expect(result).toEqual({
      status: 'ok',
      data: { generadoEl: '2026-09-10T13:48:20-03:00', periodo: '2026-09' }
    });
  });

  test('metadata.json inexistente: REGISTRY_METADATA_NOT_FOUND', () => {
    mockValidSession();
    global.registryService_getMetadata.mockReturnValue({ found: false });

    const result = Api.handleGetMetadata('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('REGISTRY_METADATA_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.registryService_getMetadata.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetMetadata('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('no se audita en Historial (igual que checkSession, no es una accion de negocio)', () => {
    mockValidSession();
    global.registryService_getMetadata.mockReturnValue({ found: true, metadata: { generadoEl: 'x', periodo: '2026-09' } });

    Api.handleGetMetadata('token-valido');

    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });
});

describe('handleGetMonitoringPoint', () => {
  test('sessionToken invalido: UNAUTHORIZED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetMonitoringPoint('token-vencido', '04-0263');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.nivelesEstaticosService_getPunto).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('monitoringId vacio: INVALID_MONITORING_ID, no consulta el servicio', () => {
    mockValidSession();
    const result = Api.handleGetMonitoringPoint('token-valido', '');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_MONITORING_ID');
    expect(global.nivelesEstaticosService_getPunto).not.toHaveBeenCalled();
  });

  test('sin permiso "ne": PERMISSION_DENIED, no consulta el servicio - llamada manual directa al handler', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo !== 'ne');

    const result = Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.nivelesEstaticosService_getPunto).not.toHaveBeenCalled();
  });

  test('punto con wellId (pozo del padron): OK con el punto tal cual lo devuelve el service', () => {
    mockValidSession();
    const punto = { monitoringId: '04-0263', wellId: '04-0263', coordenadas: { x: 2523332, y: 6363757 } };
    global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto });

    const result = Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(punto);
  });

  // No pasa por validateSessionAndWellId (formato DD-PPPP): un punto
  // especial (INA/RTR/Puesto) nunca tiene esa forma y sigue siendo un
  // monitoringId valido - ver NivelesEstaticosRepository.js.
  test('punto especial sin wellId (formato no DD-PPPP): OK igual, no se rechaza por formato', () => {
    mockValidSession();
    const punto = { monitoringId: '6 RTR7', wellId: null, nombreOriginal: 'PASNOA' };
    global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto });

    const result = Api.handleGetMonitoringPoint('token-valido', '6 RTR7');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(punto);
  });

  test('punto inexistente: MONITORING_POINT_NOT_FOUND', () => {
    mockValidSession();
    global.nivelesEstaticosService_getPunto.mockReturnValue({ found: false });

    const result = Api.handleGetMonitoringPoint('token-valido', '04-9999');

    expect(result.status).toBe('error');
    expect(result.code).toBe('MONITORING_POINT_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.nivelesEstaticosService_getPunto.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('registra el evento getMonitoringPoint en el historial con el resultado', () => {
    mockValidSession('user@example.com');
    global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto: { monitoringId: '04-0263' } });

    Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'getMonitoringPoint', '04-0263', 'OK');
  });

  test('es independiente del padron: no llama a registryService_getWellRecord', () => {
    mockValidSession();
    global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto: { monitoringId: '04-0263' } });

    Api.handleGetMonitoringPoint('token-valido', '04-0263');

    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });
});

describe('handleGetWellLocation', () => {
  test('sessionToken invalido: UNAUTHORIZED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetWellLocation('token-vencido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetWellLocation('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('formato invalido: INVALID_WELL_ID, no consulta el servicio', () => {
    mockValidSession();
    const result = Api.handleGetWellLocation('token-valido', '01-ABC');
    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('sin permiso "ubicacion" (aunque tenga "datos"): PERMISSION_DENIED, no consulta el servicio - llamada manual directa al handler', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'datos');

    const result = Api.handleGetWellLocation('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  // El caso central del diseño: datos=NO, ubicacion=SI debe poder usar
  // el modulo Ubicacion igual, sin pasar por getWellRecord ni recibir el
  // resto de la ficha.
  test('ubicacion=SI con datos=NO: OK, funciona sin necesitar el permiso "datos"', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ubicacion');
    const location = { wellId: '01-0012', coordenadas: { x: 1, y: 2 }, ubicacionResuelta: { estado: 'unica' } };
    global.registryService_getWellLocation.mockReturnValue({ found: true, location });

    const result = Api.handleGetWellLocation('token-valido', '01-0012');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(location);
    expect(global.registryService_getWellRecord).not.toHaveBeenCalled();
  });

  test('ubicacion encontrada: OK con el location tal cual lo devuelve el service', () => {
    mockValidSession();
    const location = { wellId: '01-0012', coordenadas: { x: 100, y: 200 } };
    global.registryService_getWellLocation.mockReturnValue({ found: true, location });

    const result = Api.handleGetWellLocation('token-valido', '01-0012');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(location);
  });

  test('ubicacion inexistente: WELL_LOCATION_NOT_FOUND', () => {
    mockValidSession();
    global.registryService_getWellLocation.mockReturnValue({ found: false });

    const result = Api.handleGetWellLocation('token-valido', '01-9999');

    expect(result.status).toBe('error');
    expect(result.code).toBe('WELL_LOCATION_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.registryService_getWellLocation.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetWellLocation('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('registra el evento getWellLocation en el historial con el resultado', () => {
    mockValidSession('user@example.com');
    global.registryService_getWellLocation.mockReturnValue({ found: true, location: { wellId: '01-0012' } });

    Api.handleGetWellLocation('token-valido', '01-0012');

    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'getWellLocation', '01-0012', 'OK');
  });
});

describe('validarPermiso', () => {
  test('PERMISSION_DENIED y *_NOT_FOUND nunca se colapsan al mismo codigo', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(false);
    const denegado = Api.handleGetWellRecord('token-valido', '01-0012');

    global.hasPermission.mockReturnValue(true);
    global.registryService_getWellRecord.mockReturnValue({ found: false });
    const noEncontrado = Api.handleGetWellRecord('token-valido', '01-9999');

    expect(denegado.code).toBe('PERMISSION_DENIED');
    expect(noEncontrado.code).toBe('WELL_RECORD_NOT_FOUND');
    expect(denegado.code).not.toBe(noEncontrado.code);
  });
});

describe('handleRegisterWellSearch', () => {
  function mockAccess(nombre) {
    global.getUserAccess.mockReturnValue({
      active: true,
      permisos: { perfil: true, datos: true, ubicacion: true, ne: true },
      nombre: nombre === undefined ? 'Juan Pérez' : nombre
    });
  }

  // Por defecto ambos efectos "salen bien" - los tests de cada falla se
  // encargan de pisar esto donde corresponda.
  function mockAmbosOk() {
    global.searchHistoryService_registerSearch.mockReturnValue({ logged: true });
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });
  }

  test('sessionToken invalido: UNAUTHORIZED, no registra ni notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleRegisterWellSearch('token-vencido', '04-0263', { perfil: true });

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.searchHistoryService_registerSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED, no registra ni notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', {});

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
    expect(global.searchHistoryService_registerSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test('formato de wellId invalido: INVALID_WELL_ID, no registra ni notifica', () => {
    mockValidSession();
    mockAccess();

    const result = Api.handleRegisterWellSearch('token-valido', '01-ABC', {});

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.searchHistoryService_registerSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  // Caso central de seguridad: la identidad SIEMPRE sale del
  // sessionToken verificado, nunca de un email que mande el body -
  // vale para los dos efectos.
  test('la identidad usada es la del sessionToken, nunca un email del body', () => {
    mockValidSession('real@example.com');
    mockAccess('Usuario Real');
    mockAmbosOk();

    Api.handleRegisterWellSearch('token-valido', '04-0263', { perfil: true, email: 'atacante@evil.com' });

    expect(global.searchHistoryService_registerSearch).toHaveBeenCalledWith(
      'real@example.com', 'Usuario Real', '04-0263', { perfil: true, email: 'atacante@evil.com' }
    );
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(
      'real@example.com', 'Usuario Real', '04-0263', { perfil: true, email: 'atacante@evil.com' }
    );
  });

  test('pozo encontrado: registra Y notifica con los modulos recibidos, devuelve status ok', () => {
    mockValidSession('juan@example.com');
    mockAccess('Juan Pérez');
    mockAmbosOk();

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', { perfil: true, datos: true, ubicacion: true, ne: true });

    expect(result).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalledWith(
      'juan@example.com', 'Juan Pérez', '04-0263', { perfil: true, datos: true, ubicacion: true, ne: true }
    );
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(
      'juan@example.com', 'Juan Pérez', '04-0263', { perfil: true, datos: true, ubicacion: true, ne: true }
    );
  });

  test('pozo no encontrado (modulos vacio): igual registra y notifica, devuelve status ok', () => {
    mockValidSession();
    mockAccess();
    mockAmbosOk();

    const result = Api.handleRegisterWellSearch('token-valido', '05-9999', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalledWith(expect.any(String), expect.anything(), '05-9999', {});
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(expect.any(String), expect.anything(), '05-9999', {});
  });

  test('Telegram deduplicado: status ok igual, no se audita como error, el registro en Busquedas se intenta igual', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.searchHistoryService_registerSearch.mockReturnValue({ logged: true });
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: false, reason: 'DEDUPED' });

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalled();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  // El caso pedido explicitamente: un error de Telegram nunca debe
  // afectar la respuesta de esta accion, y el registro en Busquedas
  // (independiente) se intenta de todas formas.
  test('error de Telegram: status ok igual, se audita TELEGRAM_ERROR, Busquedas se registra igual', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.searchHistoryService_registerSearch.mockReturnValue({ logged: true });
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: false, reason: 'ERROR' });

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', { perfil: true });

    expect(result).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalled();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'registerWellSearch', '04-0263', 'TELEGRAM_ERROR');
  });

  // El caso simetrico: si falla el registro en Busquedas, Telegram se
  // intenta igual - son independientes en los dos sentidos.
  test('error al registrar en Busquedas: status ok igual, se audita SEARCH_LOG_ERROR, Telegram se intenta igual', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.searchHistoryService_registerSearch.mockReturnValue({ logged: false });
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', { perfil: true });

    expect(result).toEqual({ status: 'ok' });
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalled();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'registerWellSearch', '04-0263', 'SEARCH_LOG_ERROR');
  });

  test('ambos efectos fallan: status ok igual, se auditan ambos errores, ninguno bloquea al otro', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.searchHistoryService_registerSearch.mockImplementation(() => { throw new Error('Sheets caido'); });
    global.notificationService_notifyWellSearch.mockImplementation(() => { throw new Error('Telegram caido'); });

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'registerWellSearch', '04-0263', 'SEARCH_LOG_ERROR');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'registerWellSearch', '04-0263', 'TELEGRAM_ERROR');
  });

  test('exito en ambos NO agrega fila a Historial (las llamadas reales de la busqueda ya quedaron registradas ahi)', () => {
    mockValidSession();
    mockAccess();
    mockAmbosOk();

    Api.handleRegisterWellSearch('token-valido', '04-0263', { perfil: true });

    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('no requiere ningun permiso especifico de modulo - cualquier usuario activo puede registrar su propia busqueda', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(false); // sin ningun permiso de modulo
    mockAccess();
    mockAmbosOk();

    const result = Api.handleRegisterWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalled();
  });
});

describe('handleGetMapaPozos', () => {
  test('sessionToken invalido: UNAUTHORIZED, no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetMapaPozos('token-vencido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.mapaService_getPozos).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  // Cerca Mio es para TODO usuario activo y Pozos Provincia para
  // perfil/ne: el dataset general ya no se gatea por un permiso de modulo
  // (antes "ubicacion"), alcanza con sesion valida + usuario activo.
  test.each([
    ['ningun permiso funcional (solo activo)', {}],
    ['solo perfil', { perfil: true }],
    ['solo ne', { ne: true }],
    ['solo reemplazo', { reemplazo: true }],
    ['solo datos', { datos: true }],
    ['ubicacion=NO con todo lo demas en SI', { perfil: true, datos: true, ne: true, reemplazo: true }]
  ])('usuario activo con %s: OK, sin consultar permisos de modulo', (nombre, permisos) => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(true);
    global.hasPermission.mockImplementation((email, modulo) => !!permisos[modulo]);
    global.mapaService_getPozos.mockReturnValue({ found: true, pozos: [{ wellId: '04-0263', lat: -32.8, lon: -68.7, estado: 'C' }], metadata: null });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.status).toBe('ok');
    expect(global.hasPermission).not.toHaveBeenCalled();
  });

  test('usuario INACTIVO: USER_DISABLED aunque tenga todos los permisos (fail-closed), no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);
    global.hasPermission.mockReturnValue(true);

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.code).toBe('USER_DISABLED');
    expect(global.mapaService_getPozos).not.toHaveBeenCalled();
  });

  test('ubicacion=SI con datos=NO: OK, funciona sin necesitar el permiso "datos"', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ubicacion');
    global.mapaService_getPozos.mockReturnValue({
      found: true,
      pozos: [{ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' }],
      metadata: { generadoEl: '2026-09-15T13:33:58-03:00', totalPuntos: 1 }
    });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.status).toBe('ok');
    expect(result.data.pozos).toEqual([{ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' }]);
  });

  test('dataset encontrado: OK con pozos + metadata tal cual los devuelve el service', () => {
    mockValidSession();
    const pozos = [
      { wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' },
      { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'D' }
    ];
    const metadata = { generadoEl: '2026-09-15T13:33:58-03:00', totalPuntos: 2 };
    global.mapaService_getPozos.mockReturnValue({ found: true, pozos, metadata });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result).toEqual({ status: 'ok', data: { pozos, metadata } });
  });

  // Caso central de seguridad: ningun punto del dataset debe traer mas
  // que wellId/lat/lon/estado - esta prueba lo verifica a nivel del
  // handler completo, no solo del service (ver tambien
  // MapaService.test.js, que lo prueba a nivel unitario).
  test('dataset sin campos sensibles en la respuesta del handler', () => {
    mockValidSession();
    global.mapaService_getPozos.mockReturnValue({
      found: true,
      pozos: [{ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' }],
      metadata: null
    });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(Object.keys(result.data.pozos[0]).sort()).toEqual(['estado', 'lat', 'lon', 'wellId']);
  });

  test('pozos.json inexistente: MAPA_NOT_FOUND', () => {
    mockValidSession();
    global.mapaService_getPozos.mockReturnValue({ found: false });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('MAPA_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.mapaService_getPozos.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetMapaPozos('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('handleGetWellSummary', () => {
  test('sessionToken invalido: UNAUTHORIZED, no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetWellSummary('token-vencido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.registryService_getWellSummary).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetWellSummary('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('formato de wellId invalido: INVALID_WELL_ID, no consulta el servicio', () => {
    mockValidSession();

    const result = Api.handleGetWellSummary('token-valido', '01-ABC');

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.registryService_getWellSummary).not.toHaveBeenCalled();
  });

  // El caso central del diseño: getWellSummary requiere "datos", igual
  // que getWellRecord - nunca "ubicacion" (el summary expone titular,
  // que es contenido de Datos, no de Ubicacion).
  test('datos=NO (aunque tenga "ubicacion"): PERMISSION_DENIED, no consulta el servicio', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ubicacion');

    const result = Api.handleGetWellSummary('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.registryService_getWellSummary).not.toHaveBeenCalled();
  });

  test('datos=SI: OK con el summary tal cual lo devuelve el service', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'datos');
    const summary = { wellId: '14-0202', titular: 'FRANCESCHETTI, MARIANA LOURDES', departamento: 'TUPUNGATO', distrito: 'LA ARBOLEDA' };
    global.registryService_getWellSummary.mockReturnValue({ found: true, summary });

    const result = Api.handleGetWellSummary('token-valido', '14-0202');

    expect(result).toEqual({ status: 'ok', data: summary });
  });

  // Caso central de seguridad: el summary del popup nunca debe traer mas
  // que los 4 campos autorizados, sin importar que el service (por un
  // bug futuro) devolviera algo mas.
  test('summary solo con los 4 campos autorizados', () => {
    mockValidSession();
    global.registryService_getWellSummary.mockReturnValue({
      found: true,
      summary: { wellId: '14-0202', titular: 'X', departamento: 'Y', distrito: 'Z' }
    });

    const result = Api.handleGetWellSummary('token-valido', '14-0202');

    expect(Object.keys(result.data).sort()).toEqual(['departamento', 'distrito', 'titular', 'wellId']);
  });

  test('pozo inexistente: WELL_RECORD_NOT_FOUND', () => {
    mockValidSession();
    global.registryService_getWellSummary.mockReturnValue({ found: false });

    const result = Api.handleGetWellSummary('token-valido', '01-9999');

    expect(result.status).toBe('error');
    expect(result.code).toBe('WELL_RECORD_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.registryService_getWellSummary.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetWellSummary('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  test('registra el evento getWellSummary en el historial con el resultado', () => {
    mockValidSession('user@example.com');
    global.registryService_getWellSummary.mockReturnValue({
      found: true,
      summary: { wellId: '01-0012', titular: 'X', departamento: 'Y', distrito: 'Z' }
    });

    Api.handleGetWellSummary('token-valido', '01-0012');

    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'getWellSummary', '01-0012', 'OK');
  });
});

describe('handleGetMapaNE', () => {
  test('sessionToken invalido: UNAUTHORIZED, no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetMapaNE('token-vencido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.mapaNEService_getPuntos).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetMapaNE('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  // El caso central del diseño (v2.1.0): getMapaNE requiere EXCLUSIVAMENTE
  // "ne" - nunca "ubicacion", aunque el usuario tenga acceso al Mapa de
  // Pozos general. Es la garantia de que ubicacion=SI/ne=NO nunca puede
  // pedir este dataset.
  test('ne=NO (aunque tenga "ubicacion"): PERMISSION_DENIED, no consulta el servicio', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ubicacion');

    const result = Api.handleGetMapaNE('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.mapaNEService_getPuntos).not.toHaveBeenCalled();
  });

  test('ne=SI con ubicacion=NO: OK, funciona sin necesitar el permiso "ubicacion"', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ne');
    global.mapaNEService_getPuntos.mockReturnValue({
      found: true,
      puntos: [{ monitoringId: '04-0263', wellId: '04-0263', lat: -32.86865, lon: -68.7507, nombreOriginal: null }]
    });

    const result = Api.handleGetMapaNE('token-valido');

    expect(result.status).toBe('ok');
    expect(result.data.puntos.length).toBe(1);
  });

  test('dataset encontrado: OK con los puntos tal cual los devuelve el service', () => {
    mockValidSession();
    const puntos = [
      { monitoringId: '04-0263', wellId: '04-0263', lat: -32.86865, lon: -68.7507, nombreOriginal: null },
      { monitoringId: 'INA 2055', wellId: null, lat: -32.9, lon: -68.9, nombreOriginal: 'Jofre Puesto San Vicente' }
    ];
    global.mapaNEService_getPuntos.mockReturnValue({ found: true, puntos });

    const result = Api.handleGetMapaNE('token-valido');

    expect(result).toEqual({ status: 'ok', data: { puntos } });
  });

  // Caso central de seguridad: cada punto solo trae los 5 campos
  // autorizados - esta prueba lo verifica a nivel del handler completo
  // (ver tambien MapaNEService.test.js, que lo prueba a nivel unitario).
  test('dataset sin campos sensibles en la respuesta del handler', () => {
    mockValidSession();
    global.mapaNEService_getPuntos.mockReturnValue({
      found: true,
      puntos: [{ monitoringId: '04-0263', wellId: '04-0263', lat: -32.86865, lon: -68.7507, nombreOriginal: null }]
    });

    const result = Api.handleGetMapaNE('token-valido');

    expect(Object.keys(result.data.puntos[0]).sort()).toEqual(['lat', 'lon', 'monitoringId', 'nombreOriginal', 'wellId']);
  });

  test('nivelesEstaticos.json inexistente: MAPA_NE_NOT_FOUND', () => {
    mockValidSession();
    global.mapaNEService_getPuntos.mockReturnValue({ found: false });

    const result = Api.handleGetMapaNE('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('MAPA_NE_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.mapaNEService_getPuntos.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetMapaNE('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });
});

// Indice de busqueda por titular de Pozos Provincia (Etapa 1A): mismo
// patron que handleGetMapaNE, pero gateado por "datos" - el caso central
// es que "ubicacion" (el permiso que SI alcanza para pedir getMapaPozos)
// nunca alcanza aca. Un usuario con ubicacion=SI/datos=NO ve el mapa
// pero nunca puede pedir titulares.
describe('handleGetIndiceBusquedaProvincia', () => {
  test('sessionToken invalido: UNAUTHORIZED, no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetIndiceBusquedaProvincia('token-vencido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.mapaService_getIndiceBusqueda).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  // Caso central del diseño: ubicacion=SI (el permiso del mapa) NUNCA
  // alcanza por si solo - solo "datos" habilita este indice.
  test('ubicacion=SI pero datos=NO: PERMISSION_DENIED, no consulta el servicio', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'ubicacion');

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.mapaService_getIndiceBusqueda).not.toHaveBeenCalled();
  });

  test('datos=SI con ubicacion=NO: OK, funciona sin necesitar el permiso "ubicacion"', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'datos');
    global.mapaService_getIndiceBusqueda.mockReturnValue({
      found: true,
      pozos: [{ wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' }]
    });

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result.status).toBe('ok');
    expect(result.data.pozos.length).toBe(1);
  });

  test('dataset encontrado: OK con los puntos tal cual los devuelve el service', () => {
    mockValidSession();
    const pozos = [
      { wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
      { wellId: '05-0001', nc16: null, titular: null }
    ];
    global.mapaService_getIndiceBusqueda.mockReturnValue({ found: true, pozos });

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result).toEqual({ status: 'ok', data: { pozos } });
  });

  // NC16 viaja en el MISMO indice que titular, gateado por el mismo
  // permiso "datos" - caso central de la decision de arquitectura
  // aprobada (nunca un dataset separado gateado por "ubicacion" para
  // NC16, ver MapaService.js).
  test('dataset sin campos sensibles en la respuesta del handler (solo wellId/nc16/titular)', () => {
    mockValidSession();
    global.mapaService_getIndiceBusqueda.mockReturnValue({
      found: true,
      pozos: [{ wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' }]
    });

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(Object.keys(result.data.pozos[0]).sort()).toEqual(['nc16', 'titular', 'wellId']);
  });

  test('pozos_busqueda.json inexistente: MAPA_BUSQUEDA_NOT_FOUND', () => {
    mockValidSession();
    global.mapaService_getIndiceBusqueda.mockReturnValue({ found: false });

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('MAPA_BUSQUEDA_NOT_FOUND');
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.mapaService_getIndiceBusqueda.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetIndiceBusquedaProvincia('token-valido');

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('handleGetItfAvailability', () => {
  test('sessionToken invalido: UNAUTHORIZED, no consulta el servicio', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleGetItfAvailability('token-vencido', ['01-0012']);

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.profileService_checkDisponibilidad).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
  });

  test('wellIds vacio: INVALID_REQUEST, no consulta el servicio', () => {
    mockValidSession();

    const result = Api.handleGetItfAvailability('token-valido', []);

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.profileService_checkDisponibilidad).not.toHaveBeenCalled();
  });

  test('wellIds no es array: INVALID_REQUEST', () => {
    mockValidSession();

    const result = Api.handleGetItfAvailability('token-valido', '01-0012');

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
  });

  test('un wellId con formato invalido dentro del lote: INVALID_REQUEST, no consulta el servicio', () => {
    mockValidSession();

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012', '01-ABCD']);

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.profileService_checkDisponibilidad).not.toHaveBeenCalled();
  });

  test('lote mayor al maximo permitido: INVALID_REQUEST, no consulta el servicio', () => {
    mockValidSession();
    const wellIdsGrande = Array.from({ length: 501 }, (_, i) => '01-' + String(i).padStart(4, '0'));

    const result = Api.handleGetItfAvailability('token-valido', wellIdsGrande);

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.profileService_checkDisponibilidad).not.toHaveBeenCalled();
  });

  // Caso central del diseño: gateado EXCLUSIVAMENTE por "perfil" - ni
  // "datos" ni "ubicacion" alcanzan por si solos (mismo criterio que
  // getProfile).
  test('datos=SI pero perfil=NO: PERMISSION_DENIED, no consulta el servicio', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'datos');

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(result.status).toBe('error');
    expect(result.code).toBe('PERMISSION_DENIED');
    expect(global.profileService_checkDisponibilidad).not.toHaveBeenCalled();
  });

  test('perfil=SI: OK, devuelve el mapa tal cual lo arma el service', () => {
    mockValidSession();
    global.hasPermission.mockImplementation((email, modulo) => modulo === 'perfil');
    global.profileService_checkDisponibilidad.mockReturnValue({ '01-0012': true, '01-0013': false });

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012', '01-0013']);

    expect(result).toEqual({ status: 'ok', data: { '01-0012': true, '01-0013': false } });
  });

  test('error del service/Drive: SERVICE_UNAVAILABLE', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(true);
    global.profileService_checkDisponibilidad.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(result.status).toBe('error');
    expect(result.code).toBe('SERVICE_UNAVAILABLE');
  });

  // Privacidad: la respuesta nunca debe llevar mas que booleanos por
  // wellId (ni Drive id, ni url, ni nombre de archivo).
  test('la respuesta no contiene mas campos que los wellId pedidos, todos booleanos', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(true);
    global.profileService_checkDisponibilidad.mockReturnValue({ '01-0012': true });

    const result = Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(Object.keys(result.data)).toEqual(['01-0012']);
    expect(typeof result.data['01-0012']).toBe('boolean');
  });

  // Auditoria revisada (item 1 del cierre): "Consulta disponibilidad ITF"
  // va a Historial en CADA llamada real a este endpoint - nunca a
  // Telegram. Como el frontend solo llama aca cuando su propio cache esta
  // vencido/vacio, esto ya es "material" sin logica extra.
  test('llamada exitosa: se audita en Historial como OK, nunca se manda Telegram', () => {
    mockValidSession('juan@example.com');
    global.hasPermission.mockReturnValue(true);
    global.profileService_checkDisponibilidad.mockReturnValue({ '01-0012': true });

    Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(global.logHistoryEvent).toHaveBeenCalledWith('juan@example.com', 'getItfAvailability', null, 'OK');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test('error del service: se audita en Historial como SERVICE_UNAVAILABLE', () => {
    mockValidSession('juan@example.com');
    global.hasPermission.mockReturnValue(true);
    global.profileService_checkDisponibilidad.mockImplementation(() => {
      throw new Error('Drive no disponible');
    });

    Api.handleGetItfAvailability('token-valido', ['01-0012']);

    expect(global.logHistoryEvent).toHaveBeenCalledWith('juan@example.com', 'getItfAvailability', null, 'SERVICE_UNAVAILABLE');
  });
});

describe('handleRegisterDescargaItf', () => {
  function mockAccess(nombre) {
    global.getUserAccess.mockReturnValue({
      active: true,
      permisos: { perfil: true, datos: true, ubicacion: true, ne: true },
      nombre: nombre === undefined ? 'Juan Pérez' : nombre
    });
  }

  function resumenValido(overrides) {
    return Object.assign({
      totalSeleccionados: 10,
      solicitados: 10,
      descargados: 9,
      fallidos: 1,
      wellIds: ['01-0012', '02-0005']
    }, overrides || {});
  }

  test('sessionToken invalido: UNAUTHORIZED, no notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleRegisterDescargaItf('token-vencido', resumenValido());

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED, no notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleRegisterDescargaItf('token-valido', resumenValido());

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test('resumen ausente: INVALID_REQUEST, no notifica', () => {
    mockValidSession();
    mockAccess();

    const result = Api.handleRegisterDescargaItf('token-valido', null);

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test.each(['totalSeleccionados', 'solicitados', 'descargados', 'fallidos'])(
    'campo numerico faltante/invalido (%s): INVALID_REQUEST, no notifica',
    (campo) => {
      mockValidSession();
      mockAccess();
      const resumen = resumenValido({ [campo]: 'no-es-numero' });

      const result = Api.handleRegisterDescargaItf('token-valido', resumen);

      expect(result.status).toBe('error');
      expect(result.code).toBe('INVALID_REQUEST');
      expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
    }
  );

  test('wellIds vacio: INVALID_REQUEST, no notifica', () => {
    mockValidSession();
    mockAccess();

    const result = Api.handleRegisterDescargaItf('token-valido', resumenValido({ wellIds: [] }));

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test('wellId con formato invalido dentro del resumen: INVALID_REQUEST, no notifica', () => {
    mockValidSession();
    mockAccess();

    const result = Api.handleRegisterDescargaItf('token-valido', resumenValido({ wellIds: ['01-ABCD'] }));

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_REQUEST');
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  // No requiere permiso de modulo - es auditoria, no acceso a datos
  // (mismo criterio que registerWellSearch; el acceso real a cada imagen
  // ya paso por getProfile, gateado por "perfil").
  test('sin ningun permiso de modulo habilitado: igual funciona, no es un acceso a datos', () => {
    mockValidSession();
    mockAccess();
    global.hasPermission.mockReturnValue(false);
    global.notificationService_notifyDescargaItf.mockReturnValue({ sent: true });

    const result = Api.handleRegisterDescargaItf('token-valido', resumenValido());

    expect(result).toEqual({ status: 'ok' });
  });

  test('pasa el resumen completo (los 4 conteos + wellIds) a la notificacion', () => {
    mockValidSession('juan@example.com');
    mockAccess('Juan Pérez');
    global.notificationService_notifyDescargaItf.mockReturnValue({ sent: true });
    const resumen = resumenValido({ totalSeleccionados: 80, solicitados: 50, descargados: 47, fallidos: 3 });

    Api.handleRegisterDescargaItf('token-valido', resumen);

    expect(global.notificationService_notifyDescargaItf).toHaveBeenCalledWith('juan@example.com', 'Juan Pérez', resumen);
  });

  // Caso central de seguridad: la identidad SIEMPRE sale del
  // sessionToken verificado, nunca de un email que mande el body.
  test('la identidad usada es la del sessionToken verificado', () => {
    mockValidSession('real@example.com');
    mockAccess('Usuario Real');
    global.notificationService_notifyDescargaItf.mockReturnValue({ sent: true });

    Api.handleRegisterDescargaItf('token-valido', resumenValido());

    expect(global.notificationService_notifyDescargaItf.mock.calls[0][0]).toBe('real@example.com');
    expect(global.notificationService_notifyDescargaItf.mock.calls[0][1]).toBe('Usuario Real');
  });

  test('siempre devuelve status ok, incluso si Telegram falla (efecto secundario, no debe romper la respuesta)', () => {
    mockValidSession();
    mockAccess();
    global.notificationService_notifyDescargaItf.mockReturnValue({ sent: false, reason: 'ERROR' });

    const result = Api.handleRegisterDescargaItf('token-valido', resumenValido());

    expect(result).toEqual({ status: 'ok' });
  });

  test('error inesperado del servicio de notificacion: no lanza, igual devuelve status ok', () => {
    mockValidSession();
    mockAccess();
    global.notificationService_notifyDescargaItf.mockImplementation(() => {
      throw new Error('fallo inesperado');
    });

    expect(() => {
      Api.handleRegisterDescargaItf('token-valido', resumenValido());
    }).not.toThrow();
  });
});

// Privacidad end-to-end (item 10 de la etapa): ninguna de las 2 acciones
// nuevas recibe ni reenvia lat/lon, poligono, centro/radio - solo
// wellIds[] y conteos.
describe('privacidad: seleccion geografica nunca llega al backend', () => {
  test('handleGetItfAvailability nunca recibe ni reenvia lat/lon/poligono/radio', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(true);
    global.profileService_checkDisponibilidad.mockReturnValue({ '01-0012': true });

    Api.handleGetItfAvailability('token-valido', ['01-0012']);

    const argsEnviados = JSON.stringify(global.profileService_checkDisponibilidad.mock.calls[0]);
    expect(argsEnviados).not.toMatch(/lat|lon|radio|poligono|polygon|vertice/i);
  });

  test('handleRegisterDescargaItf nunca recibe ni reenvia lat/lon/poligono/radio', () => {
    mockValidSession();
    global.getUserAccess.mockReturnValue({ active: true, permisos: {}, nombre: 'Juan' });
    global.notificationService_notifyDescargaItf.mockReturnValue({ sent: true });

    Api.handleRegisterDescargaItf('token-valido', {
      totalSeleccionados: 2, solicitados: 2, descargados: 2, fallidos: 0, wellIds: ['01-0012', '02-0005']
    });

    const argsEnviados = JSON.stringify(global.notificationService_notifyDescargaItf.mock.calls[0]);
    expect(argsEnviados).not.toMatch(/lat|lon|radio|poligono|polygon|vertice/i);
  });
});
