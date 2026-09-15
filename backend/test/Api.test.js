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

describe('handleNotifyWellSearch', () => {
  function mockAccess(nombre) {
    global.getUserAccess.mockReturnValue({
      active: true,
      permisos: { perfil: true, datos: true, ubicacion: true, ne: true },
      nombre: nombre === undefined ? 'Juan Pérez' : nombre
    });
  }

  test('sessionToken invalido: UNAUTHORIZED, no notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });

    const result = Api.handleNotifyWellSearch('token-vencido', '04-0263', { perfil: true });

    expect(result.status).toBe('error');
    expect(result.code).toBe('UNAUTHORIZED');
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test('usuario deshabilitado: USER_DISABLED, no notifica', () => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'user@example.com' });
    global.isUserActive.mockReturnValue(false);

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', {});

    expect(result.status).toBe('error');
    expect(result.code).toBe('USER_DISABLED');
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  test('formato de wellId invalido: INVALID_WELL_ID, no notifica', () => {
    mockValidSession();
    mockAccess();

    const result = Api.handleNotifyWellSearch('token-valido', '01-ABC', {});

    expect(result.status).toBe('error');
    expect(result.code).toBe('INVALID_WELL_ID');
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
  });

  // Caso central de seguridad: la identidad SIEMPRE sale del
  // sessionToken verificado, nunca de un email que mande el body.
  test('la identidad usada para notificar es la del sessionToken, nunca un email del body', () => {
    mockValidSession('real@example.com');
    mockAccess('Usuario Real');
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    Api.handleNotifyWellSearch('token-valido', '04-0263', { perfil: true, email: 'atacante@evil.com' });

    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(
      'real@example.com', 'Usuario Real', '04-0263', { perfil: true, email: 'atacante@evil.com' }
    );
  });

  test('pozo encontrado: notifica con los modulos recibidos, devuelve status ok', () => {
    mockValidSession('juan@example.com');
    mockAccess('Juan Pérez');
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', { perfil: true, datos: true, ubicacion: true, ne: true });

    expect(result).toEqual({ status: 'ok' });
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(
      'juan@example.com', 'Juan Pérez', '04-0263', { perfil: true, datos: true, ubicacion: true, ne: true }
    );
  });

  test('pozo no encontrado (modulos vacio): igual devuelve status ok, notifica igual', () => {
    mockValidSession();
    mockAccess();
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    const result = Api.handleNotifyWellSearch('token-valido', '05-9999', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalledWith(
      expect.any(String), expect.anything(), '05-9999', {}
    );
  });

  test('deduplicado: status ok igual, no se audita como error', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: false, reason: 'DEDUPED' });

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  // El caso pedido explicitamente: un error de Telegram nunca debe
  // afectar la respuesta de esta accion ni, por extension, la busqueda
  // que ya se resolvio en el frontend antes de llamar a esto.
  test('error de Telegram (notificationService devuelve reason ERROR): status ok igual, se audita TELEGRAM_ERROR', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: false, reason: 'ERROR' });

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', { perfil: true });

    expect(result).toEqual({ status: 'ok' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'notifyWellSearch', '04-0263', 'TELEGRAM_ERROR');
  });

  test('si notificationService lanza una excepcion inesperada: igual status ok, se audita TELEGRAM_ERROR, no se propaga', () => {
    mockValidSession('user@example.com');
    mockAccess();
    global.notificationService_notifyWellSearch.mockImplementation(() => {
      throw new Error('fallo inesperado');
    });

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.logHistoryEvent).toHaveBeenCalledWith('user@example.com', 'notifyWellSearch', '04-0263', 'TELEGRAM_ERROR');
  });

  test('envio exitoso NO agrega fila a Historial (las llamadas reales de la busqueda ya quedaron registradas)', () => {
    mockValidSession();
    mockAccess();
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    Api.handleNotifyWellSearch('token-valido', '04-0263', { perfil: true });

    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('no requiere ningun permiso especifico de modulo - cualquier usuario activo puede notificar su propia busqueda', () => {
    mockValidSession();
    global.hasPermission.mockReturnValue(false); // sin ningun permiso de modulo
    mockAccess();
    global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });

    const result = Api.handleNotifyWellSearch('token-valido', '04-0263', {});

    expect(result).toEqual({ status: 'ok' });
    expect(global.notificationService_notifyWellSearch).toHaveBeenCalled();
  });
});
