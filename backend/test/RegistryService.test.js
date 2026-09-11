const { installAppsScriptFakes } = require('./appsScriptFakes');

// RegistryService declara registryService_cleanRecord en su propio scope
// de modulo, y llama a registryRepository_getWellRecord como global (el
// fake) - mismo patron que ProfileService/AuthService, ver esos tests.
const RegistryService = require('../src/RegistryService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('registryService_getWellRecord', () => {
  test('no encontrado -> found:false, sin llamar a cleanRecord con nada raro', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });

    const result = RegistryService.registryService_getWellRecord('01-0012');

    expect(result).toEqual({ found: false });
  });

  test('encontrado -> found:true con el registro limpio (sin claves null)', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '01-0012',
        identificacion: { departamento: 'Capital', distrito: 'Ciudad', nic: null },
        laboratorio: { analisis: [] }
      }
    });

    const result = RegistryService.registryService_getWellRecord('01-0012');

    expect(result.found).toBe(true);
    expect(result.record).toEqual({
      wellId: '01-0012',
      identificacion: { departamento: 'Capital', distrito: 'Ciudad' },
      laboratorio: { analisis: [] }
    });
  });

  test('delega en el repositorio con el wellId recibido', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    RegistryService.registryService_getWellRecord('07-1234');
    expect(global.registryRepository_getWellRecord).toHaveBeenCalledWith('07-1234');
  });
});

describe('registryService_cleanRecord', () => {
  test('quita claves con valor null de un objeto', () => {
    const cleaned = RegistryService.registryService_cleanRecord({ a: 1, b: null, c: 'x' });
    expect(cleaned).toEqual({ a: 1, c: 'x' });
  });

  test('limpia recursivamente objetos anidados', () => {
    const cleaned = RegistryService.registryService_cleanRecord({
      estado: { situacion: 'Activo', baja: null, cegado: null }
    });
    expect(cleaned).toEqual({ estado: { situacion: 'Activo' } });
  });

  test('limpia cada elemento de un array (ej. laboratorio.analisis[])', () => {
    const cleaned = RegistryService.registryService_cleanRecord({
      analisis: [
        { laboratorio: 'Agroas', ph: null, durezaTotal: 25 },
        { laboratorio: 'ASSENZA', ph: 7.56, durezaTotal: null }
      ]
    });
    expect(cleaned).toEqual({
      analisis: [
        { laboratorio: 'Agroas', durezaTotal: 25 },
        { laboratorio: 'ASSENZA', ph: 7.56 }
      ]
    });
  });

  test('no toca un array vacio - es un dato real, no ausencia de dato', () => {
    const cleaned = RegistryService.registryService_cleanRecord({ analisis: [] });
    expect(cleaned).toEqual({ analisis: [] });
  });

  test('valores primitivos y false/0 sobreviven (solo null se quita)', () => {
    const cleaned = RegistryService.registryService_cleanRecord({
      declaracionJurada: false,
      profundidadTotal: 0,
      titular: null
    });
    expect(cleaned).toEqual({ declaracionJurada: false, profundidadTotal: 0 });
  });
});

describe('registryService_getMetadata', () => {
  test('metadata.json no existe -> found:false', () => {
    global.registryRepository_getMetadata.mockReturnValue(null);
    expect(RegistryService.registryService_getMetadata()).toEqual({ found: false });
  });

  test('expone solo generadoEl y fuente.periodo, no el resto del detalle interno', () => {
    global.registryRepository_getMetadata.mockReturnValue({
      generadoEl: '2026-09-10T13:48:20-03:00',
      fuente: { archivo: 'Reporte Pozos 09_2026.csv', periodo: '2026-09', filasFuente: 24198 },
      pozosUnicos: 24180,
      departamentos: { '01': 52 }
    });

    const result = RegistryService.registryService_getMetadata();

    expect(result).toEqual({
      found: true,
      metadata: { generadoEl: '2026-09-10T13:48:20-03:00', periodo: '2026-09' }
    });
  });
});
