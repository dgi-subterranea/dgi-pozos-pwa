const { installAppsScriptFakes } = require('./appsScriptFakes');

// MapaService llama a mapaRepository_getPozos/mapaRepository_getMetadata
// como globals (los fakes) - mismo patron que RegistryService/
// NivelesEstaticosService, ver esos tests.
const MapaService = require('../src/MapaService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('mapaService_getPozos', () => {
  test('no encontrado (no existe pozos.json) -> found:false', () => {
    global.mapaRepository_getPozos.mockReturnValue({ found: false });

    const result = MapaService.mapaService_getPozos();

    expect(result).toEqual({ found: false });
  });

  test('encontrado -> found:true con los puntos y la metadata', () => {
    global.mapaRepository_getPozos.mockReturnValue({
      found: true,
      pozos: [
        { wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' },
        { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'D' }
      ]
    });
    global.mapaRepository_getMetadata.mockReturnValue({
      generadoEl: '2026-09-15T13:33:58-03:00',
      totalPuntos: 13804,
      distribucion: { confirmada: 1603, disponible: 12201 }
    });

    const result = MapaService.mapaService_getPozos();

    expect(result.found).toBe(true);
    expect(result.pozos).toEqual([
      { wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' },
      { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'D' }
    ]);
    expect(result.metadata).toEqual({ generadoEl: '2026-09-15T13:33:58-03:00', totalPuntos: 13804 });
  });

  // Caso central de seguridad: aunque pozos.json (por edicion a mano, o
  // un bug futuro del indexador) trajera campos extra como "ne", "uso" o
  // "titular", mapaService_sanitizarPunto los descarta - la sanitizacion
  // es estructural (siempre arma el objeto de salida campo por campo),
  // no un filtro condicional que dependa de que el archivo este bien
  // generado.
  test('dataset sin campos sensibles - descarta cualquier campo extra que traiga el archivo, incluido "ne"', () => {
    global.mapaRepository_getPozos.mockReturnValue({
      found: true,
      pozos: [
        {
          wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C',
          ne: true, titular: 'JUAN PEREZ', departamento: 'GUAYMALLEN', distrito: 'X', uso: 'Agricola'
        }
      ]
    });
    global.mapaRepository_getMetadata.mockReturnValue(null);

    const result = MapaService.mapaService_getPozos();

    expect(result.pozos).toEqual([{ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' }]);
    expect(Object.keys(result.pozos[0]).sort()).toEqual(['estado', 'lat', 'lon', 'wellId']);
  });

  test('metadata correcta - solo generadoEl y totalPuntos, aunque el archivo traiga mas campos', () => {
    global.mapaRepository_getPozos.mockReturnValue({ found: true, pozos: [] });
    global.mapaRepository_getMetadata.mockReturnValue({
      generadoEl: '2026-09-15T13:33:58-03:00',
      totalPuntos: 13804,
      distribucion: { confirmada: 1603, disponible: 12201 },
      excluidos: { sinCoordenadas: 7350 },
      fuente: { periodo: '2026-09' }
    });

    const result = MapaService.mapaService_getPozos();

    expect(result.metadata).toEqual({ generadoEl: '2026-09-15T13:33:58-03:00', totalPuntos: 13804 });
  });

  test('metadata ausente (no existe metadata.json) -> metadata:null, no rompe', () => {
    global.mapaRepository_getPozos.mockReturnValue({ found: true, pozos: [] });
    global.mapaRepository_getMetadata.mockReturnValue(null);

    const result = MapaService.mapaService_getPozos();

    expect(result.metadata).toBeNull();
  });

  test('dataset vacio -> found:true con pozos:[]', () => {
    global.mapaRepository_getPozos.mockReturnValue({ found: true, pozos: [] });
    global.mapaRepository_getMetadata.mockReturnValue(null);

    const result = MapaService.mapaService_getPozos();

    expect(result).toEqual({ found: true, pozos: [], metadata: null });
  });
});

describe('mapaService_sanitizarPunto', () => {
  test('conserva solo wellId/lat/lon/estado, en ese orden de claves', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', ne: true, titular: 'X'
    });
    expect(sanitizado).toEqual({ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C' });
    expect(Object.keys(sanitizado)).toEqual(['wellId', 'lat', 'lon', 'estado']);
  });
});
