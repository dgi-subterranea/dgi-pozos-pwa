// A diferencia de DriveProfileRepository/SheetUserRepository (que llaman
// a Drive/Sheets de verdad y por convencion del proyecto no se testean
// unitariamente, solo a mano), registryRepository_resolveFileName es
// logica pura de string - no toca DriveApp ni CacheService - asi que si
// vale la pena testearla directo, sin fakes.
const { registryRepository_resolveFileName } = require('../src/RegistryRepository');

describe('registryRepository_resolveFileName', () => {
  test('departamento no particionado -> archivo simple DD.json', () => {
    expect(registryRepository_resolveFileName('01-0012')).toBe('01.json');
    expect(registryRepository_resolveFileName('05-0057')).toBe('05.json');
    expect(registryRepository_resolveFileName('02-0001')).toBe('02.json');
  });

  test('departamento particionado (07/08) -> archivo por primer digito de Nro Pozo', () => {
    expect(registryRepository_resolveFileName('07-0012')).toBe('07-0.json');
    expect(registryRepository_resolveFileName('07-1005')).toBe('07-1.json');
    expect(registryRepository_resolveFileName('08-2999')).toBe('08-2.json');
    expect(registryRepository_resolveFileName('08-9999')).toBe('08-9.json');
  });
});
