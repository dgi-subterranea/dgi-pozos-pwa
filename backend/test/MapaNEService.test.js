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
    cuenca: 'MI',
    zona: 'NORTE',
    estadoMonitoreo: 'ACTIVO',
    campana2026: [{ fecha: '2026-07-08', nivel: -12 }],
    historico: [{ anio: 2020, nivel: -10 }],
    propietario: 'PEREZ, JUAN', // nunca debe sobrevivir la sanitizacion
    estadisticas: { media: -10 } // idem
  }, overrides);
}

function puntoEspecial(overrides) {
  return Object.assign({
    monitoringId: 'INA 2055',
    wellId: null,
    nombreOriginal: 'Jofre Puesto San Vicente',
    coordenadas: { lat: -32.9, lon: -68.9 },
    cuenca: null,
    zona: 'Libre-Confinado',
    estadoMonitoreo: null,
    campana2026: [],
    historico: []
  }, overrides);
}

describe('mapaNEService_getPuntos', () => {
  test('no encontrado (no existe nivelesEstaticos.json) -> found:false', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({ found: false });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result).toEqual({ found: false });
  });

  test('punto con wellId -> found:true con los 12 campos esperados (Etapa 1B)', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { '04-0263': puntoConWellId() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.found).toBe(true);
    expect(result.puntos).toEqual([{
      monitoringId: '04-0263', wellId: '04-0263', lat: -32.86865, lon: -68.7507, nombreOriginal: null,
      cuenca: 'MI', zona: 'NORTE', zonaNormalizada: 'Norte', estadoMonitoreo: 'ACTIVO',
      tieneMedicion2026: true, tieneHistorico: true, esEspecial: false
    }]);
  });

  test('punto especial (sin wellId) -> wellId:null, nombreOriginal presente, esEspecial:true', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { 'INA 2055': puntoEspecial() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos).toEqual([{
      monitoringId: 'INA 2055', wellId: null, lat: -32.9, lon: -68.9, nombreOriginal: 'Jofre Puesto San Vicente',
      cuenca: null, zona: 'Libre-Confinado', zonaNormalizada: 'Libre-Confinado', estadoMonitoreo: null,
      tieneMedicion2026: false, tieneHistorico: false, esEspecial: true
    }]);
  });

  // Caso central de seguridad: aunque el registro completo traiga
  // propietario/estadisticas (datos reales de la ficha NE) o los arrays
  // completos campana2026[]/historico[] (con fecha/persona/observacion,
  // mas detalle del necesario para un filtro de mapa), ninguno de esos
  // campos sobrevive - la sanitizacion es ESTRUCTURAL (arma el objeto de
  // salida campo por campo), no un filtro condicional. Solo los
  // booleanos derivados (tieneMedicion2026/tieneHistorico) viajan.
  test('nunca incluye propietario, estadisticas, ni los arrays campana2026/historico completos', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { '04-0263': puntoConWellId() }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(Object.keys(result.puntos[0]).sort()).toEqual([
      'cuenca', 'esEspecial', 'estadoMonitoreo', 'lat', 'lon', 'monitoringId',
      'nombreOriginal', 'tieneHistorico', 'tieneMedicion2026', 'wellId', 'zona', 'zonaNormalizada'
    ]);
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

  // --- Etapa 1B: campos derivados ---
  test('tieneMedicion2026/tieneHistorico:false cuando los arrays estan vacios o ausentes', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { x: puntoConWellId({ monitoringId: 'x', campana2026: [], historico: undefined }) }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos[0].tieneMedicion2026).toBe(false);
    expect(result.puntos[0].tieneHistorico).toBe(false);
  });

  test('esEspecial se deriva de wellId, nunca de otro campo', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: {
        conWellId: puntoConWellId({ monitoringId: 'conWellId' }),
        sinWellId: puntoConWellId({ monitoringId: 'sinWellId', wellId: null })
      }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos.find((p) => p.monitoringId === 'conWellId').esEspecial).toBe(false);
    expect(result.puntos.find((p) => p.monitoringId === 'sinWellId').esEspecial).toBe(true);
  });

  // cuenca/zona/estadoMonitoreo null en la fuente (real: 1 punto sin
  // cuenca, 71 sin estadoMonitoreo) -> null en la salida, nunca un valor
  // inventado ("sin dato" es una etiqueta de UI, ver mapaLogic.js - el
  // dato en si queda null).
  test('cuenca/zona/estadoMonitoreo ausentes en la fuente -> null, no rompe', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos.mockReturnValue({
      found: true,
      puntos: { x: puntoConWellId({ monitoringId: 'x', cuenca: null, zona: null, estadoMonitoreo: null }) }
    });

    const result = MapaNEService.mapaNEService_getPuntos();

    expect(result.puntos[0].cuenca).toBeNull();
    expect(result.puntos[0].zona).toBeNull();
    expect(result.puntos[0].zonaNormalizada).toBeNull();
    expect(result.puntos[0].estadoMonitoreo).toBeNull();
  });
});

describe('mapaNEService_normalizarZona', () => {
  // Caso central del pedido: fusionar SOLO diferencias triviales de
  // mayusculas - medido contra los datos reales, esto es exactamente lo
  // que hace falta para que "NORTE"(61) + "Norte"(30) se muestren como
  // una sola opcion "Norte"(91) en el filtro.
  test('palabra integramente en mayusculas se recapitaliza (NORTE -> Norte)', () => {
    expect(MapaNEService.mapaNEService_normalizarZona('NORTE')).toBe('Norte');
    expect(MapaNEService.mapaNEService_normalizarZona('OESTE')).toBe('Oeste');
  });

  test('palabra ya bien escrita (mixed-case) se deja intacta', () => {
    expect(MapaNEService.mapaNEService_normalizarZona('Norte')).toBe('Norte');
  });

  // Caso central de "no sobre-normalizar": "Valle del Toba" ya es una
  // grafia unica en la fuente (sin variante en mayusculas) - la
  // preposicion "del" en minuscula no debe forzarse a "Del".
  test('no re-capitaliza palabras que ya tienen minusculas mezcladas (preposiciones, etc.)', () => {
    expect(MapaNEService.mapaNEService_normalizarZona('Valle del Toba')).toBe('Valle del Toba');
  });

  test('palabras con guion se tratan por separado, nunca fusiona 2 categorias distintas', () => {
    expect(MapaNEService.mapaNEService_normalizarZona('Libre-Confinado')).toBe('Libre-Confinado');
    expect(MapaNEService.mapaNEService_normalizarZona('Libre Centro-Sur')).toBe('Libre Centro-Sur');
    expect(MapaNEService.mapaNEService_normalizarZona('Libre Centro')).not.toBe(MapaNEService.mapaNEService_normalizarZona('Libre Centro-Sur'));
  });

  test('recorta espacios al principio/final y colapsa espacios multiples', () => {
    expect(MapaNEService.mapaNEService_normalizarZona('  NORTE  ')).toBe('Norte');
    expect(MapaNEService.mapaNEService_normalizarZona('Santa Rosa-La  Paz')).toBe('Santa Rosa-La Paz');
  });

  test('valor ausente/vacio -> null, no rompe', () => {
    expect(MapaNEService.mapaNEService_normalizarZona(null)).toBeNull();
    expect(MapaNEService.mapaNEService_normalizarZona(undefined)).toBeNull();
    expect(MapaNEService.mapaNEService_normalizarZona('')).toBeNull();
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
