const { installAppsScriptFakes } = require('./appsScriptFakes');

// MapaNEService llama a nivelesEstaticosRepository_getTodosLosPuntos
// como global (el fake) - mismo patron que MapaService/RegistryService,
// ver esos tests.
const MapaNEService = require('../src/MapaNEService');

beforeEach(() => {
  installAppsScriptFakes();
});

function puntoConWellId(overrides) {
  return Object.assign({
    monitoringId: '04-0263',
    wellId: '04-0263',
    nombreOriginal: null,
    coordenadas: { lat: -32.86865, lon: -68.7507, x: 2523332, y: 6363757 },
    propietario: 'PEREZ, JUAN', // nunca debe sobrevivir la sanitizacion
    estadisticas: { media: -10 }, // idem
    historico: [{ anio: 2020, nivel: -10 }] // idem
  }, overrides);
}

function puntoEspecial(overrides) {
  return Object.assign({
    monitoringId: 'INA 2055',
    wellId: null,
    nombreOriginal: 'Jofre Puesto San Vicente',
    coordenadas: { lat: -32.9, lon: -68.9 }
  }, overrides);
}

describe('mapaNEService_getPuntos', () => {
  test('no encontrado (no existe nivelesEstaticos.json) -> found:false', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({ found: false });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result).toEqual({ found: false });
  });

  test('punto con wellId -> found:true con los 5 campos esperados', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { '04-0263': puntoConWellId() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.found).toBe(true);
    expect(result.puntos).toEqual([
      { monitoringId: '04-0263', wellId: '04-0263', lat: -32.86865, lon: -68.7507, nombreOriginal: null }
    ]);
  });

  test('punto especial (sin wellId) -> wellId:null, nombreOriginal presente', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { 'INA 2055': puntoEspecial() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos).toEqual([
      { monitoringId: 'INA 2055', wellId: null, lat: -32.9, lon: -68.9, nombreOriginal: 'Jofre Puesto San Vicente' }
    ]);
  });

  // Caso central de seguridad: aunque el registro completo traiga
  // propietario/estadisticas/historico (datos reales de la ficha NE),
  // ninguno de esos campos sobrevive - la sanitizacion es ESTRUCTURAL
  // (arma el objeto de salida campo por campo), no un filtro condicional.
  test('nunca incluye propietario, estadisticas, historico ni ningun otro campo de la ficha', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { '04-0263': puntoConWellId() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(Object.keys(result.puntos[0]).sort()).toEqual(['lat', 'lon', 'monitoringId', 'nombreOriginal', 'wellId']);
  });

  // Requisito explicito: los puntos SIN coordenadas validas (53 en el
  // dataset real, todos con wellId) nunca entran al mapa - no tiene
  // sentido un punto de mapa sin donde pintarlo.
  test('excluye puntos sin coordenadas validas (coordenadas ausente o lat/lon null)', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: {
        'sin-coordenadas-objeto': puntoConWellId({ monitoringId: 'sin-coordenadas-objeto', coordenadas: undefined }),
        'lat-null': puntoConWellId({ monitoringId: 'lat-null', coordenadas: { lat: null, lon: -68.7 } }),
        'lon-null': puntoConWellId({ monitoringId: 'lon-null', coordenadas: { lat: -32.8, lon: null } }),
        'valido': puntoConWellId({ monitoringId: 'valido' })
      }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos.map((p) => p.monitoringId)).toEqual(['valido']);
  });

  test('dataset vacio -> found:true con puntos:[]', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({ found: true, puntos: {} });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result).toEqual({ found: true, puntos: [] });
  });

  test('mezcla de puntos con y sin wellId en el mismo dataset', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: {
        '04-0263': puntoConWellId(),
        'INA 2055': puntoEspecial()
      }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos.length).toBe(2);
    expect(result.puntos.some((p) => p.wellId === '04-0263')).toBe(true);
    expect(result.puntos.some((p) => p.monitoringId === 'INA 2055' && p.wellId === null)).toBe(true);
  });
});

describe('mapaNEService_tieneCoordenadasValidas', () => {
  test('coordenadas con lat/lon numericos -> true', () => {
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({ coordenadas: { lat: -32.8, lon: -68.7 } })).toBe(true);
  });

  test('sin coordenadas -> false', () => {
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({})).toBe(false);
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({ coordenadas: null })).toBe(false);
  });

  test('lat o lon null/undefined -> false', () => {
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({ coordenadas: { lat: null, lon: -68.7 } })).toBe(false);
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({ coordenadas: { lat: -32.8, lon: undefined } })).toBe(false);
  });

  // lat/lon 0 son coordenadas validas (aunque irreales para Mendoza) -
  // el chequeo nunca debe tratar 0 como "falsy sin dato".
  test('lat/lon en 0 se consideran validas (0 no es "sin dato")', () => {
    expect(MapaNEService.mapaNEService_tieneCoordenadasValidas({ coordenadas: { lat: 0, lon: 0 } })).toBe(true);
  });
});
