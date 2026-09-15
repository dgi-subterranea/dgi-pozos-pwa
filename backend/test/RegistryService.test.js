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

  // Caso central de seguridad: coordenadas/coordenadasProvincia/
  // ubicacionResuelta NUNCA viajan por getWellRecord - es estructural,
  // no depende de ningun permiso (ver registryService_getWellLocation,
  // el unico camino autorizado para esos 3 campos).
  test('nunca incluye coordenadas geograficas, sin importar que el repositorio las traiga', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '14-0202',
        ubicacion: {
          domicilioPozo: 'CALLE C ESQ. 6 Y 7',
          planoDgi: '8418-F',
          planoCatastro: null,
          coordenadas: { x: 2487370.5, y: 6299934 },
          coordenadasProvincia: [{ x: 2487371.0, y: 6299934.0 }],
          ubicacionResuelta: { estado: 'corroborada', lat: -33.44429, lon: -69.13583 }
        }
      }
    });

    const result = RegistryService.registryService_getWellRecord('14-0202');

    expect(result.record.ubicacion).toEqual({ domicilioPozo: 'CALLE C ESQ. 6 Y 7', planoDgi: '8418-F' });
    expect(result.record.ubicacion.coordenadas).toBeUndefined();
    expect(result.record.ubicacion.coordenadasProvincia).toBeUndefined();
    expect(result.record.ubicacion.ubicacionResuelta).toBeUndefined();
  });

  test('conserva domicilioPozo/planoDgi/planoCatastro - son de Datos, no geograficos', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '04-0263',
        ubicacion: { domicilioPozo: 'TIRASSO A 355M', planoDgi: '12490-P', planoCatastro: '69758', coordenadas: null }
      }
    });

    const result = RegistryService.registryService_getWellRecord('04-0263');

    expect(result.record.ubicacion).toEqual({ domicilioPozo: 'TIRASSO A 355M', planoDgi: '12490-P', planoCatastro: '69758' });
  });

  test('un record sin ubicacion no rompe (no todos los registros la tienen necesariamente)', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: { wellId: '01-0012' }
    });

    const result = RegistryService.registryService_getWellRecord('01-0012');

    expect(result.record).toEqual({ wellId: '01-0012' });
  });
});

describe('registryService_sanitizarUbicacionParaDatos', () => {
  test('quita solo los 3 campos geograficos, conserva el resto de ubicacion y del record', () => {
    const record = {
      wellId: '14-0202',
      identificacion: { departamento: 'TUPUNGATO' },
      ubicacion: {
        domicilioPozo: 'X', planoDgi: 'Y', planoCatastro: 'Z',
        coordenadas: { x: 1, y: 2 }, coordenadasProvincia: [{ x: 3, y: 4 }], ubicacionResuelta: { estado: 'unica' }
      }
    };
    const sanitized = RegistryService.registryService_sanitizarUbicacionParaDatos(record);
    expect(sanitized).toEqual({
      wellId: '14-0202',
      identificacion: { departamento: 'TUPUNGATO' },
      ubicacion: { domicilioPozo: 'X', planoDgi: 'Y', planoCatastro: 'Z' }
    });
  });

  test('no muta el record original', () => {
    const record = { wellId: '01-0012', ubicacion: { coordenadas: { x: 1, y: 2 } } };
    RegistryService.registryService_sanitizarUbicacionParaDatos(record);
    expect(record.ubicacion.coordenadas).toEqual({ x: 1, y: 2 });
  });
});

describe('registryService_getWellLocation', () => {
  test('no encontrado -> found:false', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    expect(RegistryService.registryService_getWellLocation('01-9999')).toEqual({ found: false });
  });

  test('encontrado -> found:true con solo wellId + los 3 campos geograficos, nada mas de la ficha', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '14-0202',
        titularidad: { titular: 'FRANCESCHETTI, MARIANA LOURDES' },
        identificacion: { departamento: 'TUPUNGATO' },
        ubicacion: {
          domicilioPozo: 'CALLE C ESQ. 6 Y 7', planoDgi: '8418-F',
          coordenadas: { x: 2487370.5, y: 6299934 },
          coordenadasProvincia: [{ x: 2487371.0, y: 6299934.0 }],
          ubicacionResuelta: { estado: 'corroborada', lat: -33.44429, lon: -69.13583 }
        }
      }
    });

    const result = RegistryService.registryService_getWellLocation('14-0202');

    expect(result.found).toBe(true);
    expect(result.location).toEqual({
      wellId: '14-0202',
      coordenadas: { x: 2487370.5, y: 6299934 },
      coordenadasProvincia: [{ x: 2487371.0, y: 6299934.0 }],
      ubicacionResuelta: { estado: 'corroborada', lat: -33.44429, lon: -69.13583 }
    });
    expect(result.location.titularidad).toBeUndefined();
    expect(result.location.domicilioPozo).toBeUndefined();
  });

  test('reusa registryRepository_getWellRecord (mismo cache por wellId que getWellRecord) - no hay repositorio propio', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    RegistryService.registryService_getWellLocation('07-1234');
    expect(global.registryRepository_getWellRecord).toHaveBeenCalledWith('07-1234');
  });

  test('pozo sin coordenadas del Reporte Pozos: coordenadas queda ausente (null se limpia), coordenadasProvincia vacio se conserva', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '04-0263',
        ubicacion: { coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'sinCoordenadas' } }
      }
    });

    const result = RegistryService.registryService_getWellLocation('04-0263');

    expect(result.location.coordenadas).toBeUndefined();
    expect(result.location.coordenadasProvincia).toEqual([]);
    expect(result.location.ubicacionResuelta).toEqual({ estado: 'sinCoordenadas' });
  });
});

describe('registryService_getWellSummary', () => {
  test('no encontrado -> found:false', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    expect(RegistryService.registryService_getWellSummary('01-9999')).toEqual({ found: false });
  });

  test('encontrado -> found:true con solo los 4 campos autorizados', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '14-0202',
        titularidad: { titular: 'FRANCESCHETTI, MARIANA LOURDES', domicilioTitular: 'CALLE X 123' },
        identificacion: { departamento: 'TUPUNGATO', distrito: 'LA ARBOLEDA', nomenclatura: 'B00140202' },
        ubicacion: {
          coordenadas: { x: 2487370.5, y: 6299934 },
          ubicacionResuelta: { estado: 'corroborada', lat: -33.44429, lon: -69.13583 }
        },
        tecnicas: { profundidadTotal: 80 }
      }
    });

    const result = RegistryService.registryService_getWellSummary('14-0202');

    expect(result.found).toBe(true);
    expect(result.summary).toEqual({
      wellId: '14-0202',
      titular: 'FRANCESCHETTI, MARIANA LOURDES',
      departamento: 'TUPUNGATO',
      distrito: 'LA ARBOLEDA'
    });
    expect(Object.keys(result.summary).sort()).toEqual(['departamento', 'distrito', 'titular', 'wellId']);
  });

  // Caso central de seguridad: nunca coordenadas, nunca domicilio, nunca
  // ningun otro campo de la ficha - solo los 4 explicitos, sin importar
  // cuanto traiga el registro completo.
  test('nunca incluye coordenadas ni ningun otro campo de la ficha completa', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: {
        wellId: '04-0263',
        titularidad: { titular: 'PEREZ, JUAN' },
        identificacion: { departamento: 'GUAYMALLEN', distrito: 'X' },
        ubicacion: {
          coordenadas: { x: 1, y: 2 },
          coordenadasProvincia: [{ x: 3, y: 4 }],
          ubicacionResuelta: { estado: 'unica', lat: -32.8, lon: -68.7 },
          domicilioPozo: 'CALLE FALSA 123'
        }
      }
    });

    const result = RegistryService.registryService_getWellSummary('04-0263');

    expect(result.summary.coordenadas).toBeUndefined();
    expect(result.summary.ubicacion).toBeUndefined();
    expect(result.summary.domicilioPozo).toBeUndefined();
  });

  test('campos ausentes en el registro -> null, nunca se omiten ni rompen', () => {
    global.registryRepository_getWellRecord.mockReturnValue({
      found: true,
      record: { wellId: '01-0012' }
    });

    const result = RegistryService.registryService_getWellSummary('01-0012');

    expect(result.summary).toEqual({ wellId: '01-0012', titular: null, departamento: null, distrito: null });
  });

  test('reusa registryRepository_getWellRecord (mismo cache por wellId que getWellRecord) - no hay repositorio propio', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    RegistryService.registryService_getWellSummary('07-1234');
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
