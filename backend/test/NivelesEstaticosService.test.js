const { installAppsScriptFakes } = require('./appsScriptFakes');

// NivelesEstaticosService declara nivelesEstaticosService_cleanPunto en
// su propio scope de modulo, y llama a nivelesEstaticosRepository_getPunto
// como global (el fake) - mismo patron que RegistryService, ver ese test.
const NivelesEstaticosService = require('../src/NivelesEstaticosService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('nivelesEstaticosService_getPunto', () => {
  test('no encontrado -> found:false', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: false });

    const result = NivelesEstaticosService.nivelesEstaticosService_getPunto('04-0263');

    expect(result).toEqual({ found: false });
  });

  test('encontrado -> found:true con el punto limpio (sin claves null)', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({
      found: true,
      punto: {
        monitoringId: '04-0263',
        wellId: '04-0263',
        nombreOriginal: null,
        coordenadas: { x: 2523332, y: 6363757, lat: -32.86865, lon: -68.7507 },
        historico: []
      }
    });

    const result = NivelesEstaticosService.nivelesEstaticosService_getPunto('04-0263');

    expect(result.found).toBe(true);
    expect(result.punto).toEqual({
      monitoringId: '04-0263',
      wellId: '04-0263',
      coordenadas: { x: 2523332, y: 6363757, lat: -32.86865, lon: -68.7507 },
      historico: []
    });
  });

  test('delega en el repositorio con el monitoringId recibido - funciona igual para un punto especial sin wellId', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: false });
    NivelesEstaticosService.nivelesEstaticosService_getPunto('6 RTR7');
    expect(global.nivelesEstaticosRepository_getPunto).toHaveBeenCalledWith('6 RTR7');
  });
});

describe('nivelesEstaticosService_cleanPunto', () => {
  test('quita claves con valor null de un objeto', () => {
    const cleaned = NivelesEstaticosService.nivelesEstaticosService_cleanPunto({ a: 1, b: null, c: 'x' });
    expect(cleaned).toEqual({ a: 1, c: 'x' });
  });

  test('limpia recursivamente objetos anidados (ej. wellId:null de un punto especial)', () => {
    const cleaned = NivelesEstaticosService.nivelesEstaticosService_cleanPunto({
      monitoringId: '6 RTR7', wellId: null, coordenadas: { x: 1, y: 2, lat: null }
    });
    expect(cleaned).toEqual({ monitoringId: '6 RTR7', coordenadas: { x: 1, y: 2 } });
  });

  test('limpia cada elemento de un array (ej. historico[])', () => {
    const cleaned = NivelesEstaticosService.nivelesEstaticosService_cleanPunto({
      historico: [
        { anio: 2024, nivel: -3.25, surgente: false },
        { anio: 2011, nivel: 1.77, surgente: true }
      ]
    });
    expect(cleaned).toEqual({
      historico: [
        { anio: 2024, nivel: -3.25, surgente: false },
        { anio: 2011, nivel: 1.77, surgente: true }
      ]
    });
  });

  test('no toca un array vacio - es un dato real (ej. campana2026:[] cuando no hubo visita en 2026)', () => {
    const cleaned = NivelesEstaticosService.nivelesEstaticosService_cleanPunto({ campana2026: [] });
    expect(cleaned).toEqual({ campana2026: [] });
  });

  test('valores primitivos y false/0 sobreviven (solo null se quita)', () => {
    const cleaned = NivelesEstaticosService.nivelesEstaticosService_cleanPunto({
      surgente: false,
      nivel: 0,
      wellId: null
    });
    expect(cleaned).toEqual({ surgente: false, nivel: 0 });
  });
});
