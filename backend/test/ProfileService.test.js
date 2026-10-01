const { installAppsScriptFakes } = require('./appsScriptFakes');
const ProfileService = require('../src/ProfileService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('profileService_getProfile', () => {
  test('pozo existente: delega en el repositorio y devuelve found:true con el blob', () => {
    const fakeBlob = { getBytes: () => [1, 2, 3], getContentType: () => 'image/jpeg' };
    global.driveProfileRepository_getFile.mockReturnValue({ found: true, blob: fakeBlob });

    const result = ProfileService.profileService_getProfile('03-0123');

    expect(result.found).toBe(true);
    expect(result.blob).toBe(fakeBlob);
    expect(global.driveProfileRepository_getFile).toHaveBeenCalledWith('03-0123');
  });

  test('pozo inexistente: devuelve found:false', () => {
    global.driveProfileRepository_getFile.mockReturnValue({ found: false });

    const result = ProfileService.profileService_getProfile('19-9999');

    expect(result.found).toBe(false);
  });

  test('error de repositorio/Drive: se propaga tal cual, ProfileService no lo atrapa', () => {
    global.driveProfileRepository_getFile.mockImplementation(() => {
      throw new Error('FOLDER_ID no configurado en Script Properties');
    });

    expect(() => ProfileService.profileService_getProfile('03-0123')).toThrow('FOLDER_ID no configurado');
  });
});

describe('profileService_checkDisponibilidad', () => {
  test('delega en itfAvailabilityService_checkDisponibilidad y devuelve el mapa tal cual', () => {
    global.itfAvailabilityService_checkDisponibilidad.mockReturnValue({ '01-0012': true, '01-0013': false });

    const resultado = ProfileService.profileService_checkDisponibilidad(['01-0012', '01-0013']);

    expect(resultado).toEqual({ '01-0012': true, '01-0013': false });
    expect(global.itfAvailabilityService_checkDisponibilidad).toHaveBeenCalledWith(['01-0012', '01-0013']);
  });
});
