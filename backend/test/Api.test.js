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

function mockValidSession(email) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: email || 'user@example.com' });
  global.isUserActive.mockReturnValue(true);
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

  test('ficha encontrada: OK con el registro tal cual lo devuelve el service', () => {
    mockValidSession();
    const record = { wellId: '01-0012', identificacion: { departamento: 'Capital' } };
    global.registryService_getWellRecord.mockReturnValue({ found: true, record });

    const result = Api.handleGetWellRecord('token-valido', '01-0012');

    expect(result.status).toBe('ok');
    expect(result.data).toEqual(record);
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
