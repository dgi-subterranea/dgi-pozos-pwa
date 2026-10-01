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

  test('encontrado -> found:true con los puntos (incluida cuenca/profundidad/tramosFiltrantes/surgencia) y la metadata', () => {
    global.mapaRepository_getPozos.mockReturnValue({
      found: true,
      pozos: [
        { wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidadTotal: 154, tramosFiltrantes: [{ desde: 80, hasta: 110 }], surgencia: 'Profundo' },
        { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'D', cuenca: 'Río Tunuyán Inferior', profundidadTotal: null, tramosFiltrantes: [], surgencia: null }
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
      { wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidad: 154, tramosFiltrantes: [{ desde: 80, hasta: 110 }], surgencia: 'Profundo' },
      { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'D', cuenca: 'Río Tunuyán Inferior', profundidad: null, tramosFiltrantes: [], surgencia: null }
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
          wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidadTotal: 154,
          ne: true, titular: 'JUAN PEREZ', departamento: 'GUAYMALLEN', distrito: 'X', uso: 'Agricola'
        }
      ]
    });
    global.mapaRepository_getMetadata.mockReturnValue(null);

    const result = MapaService.mapaService_getPozos();

    expect(result.pozos).toEqual([{ wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidad: 154, tramosFiltrantes: [], surgencia: null }]);
    expect(Object.keys(result.pozos[0]).sort()).toEqual(['cuenca', 'estado', 'lat', 'lon', 'profundidad', 'surgencia', 'tramosFiltrantes', 'wellId']);
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
  test('conserva wellId/lat/lon/estado/cuenca/profundidad/tramosFiltrantes/surgencia, en ese orden de claves', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidadTotal: 154,
      tramosFiltrantes: [{ desde: 80, hasta: 110 }], surgencia: 'Profundo', ne: true, titular: 'X'
    });
    expect(sanitizado).toEqual({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: 'Río Mendoza', profundidad: 154,
      tramosFiltrantes: [{ desde: 80, hasta: 110 }], surgencia: 'Profundo'
    });
    expect(Object.keys(sanitizado)).toEqual(['wellId', 'lat', 'lon', 'estado', 'cuenca', 'profundidad', 'tramosFiltrantes', 'surgencia']);
  });

  // Etapa 1C: 0 casos reales (los 13.804 pozos caen dentro de una de las
  // 6 cuencas segun el diagnostico), pero el campo nunca inventa un
  // valor si algun dia hubiera uno fuera de los poligonos.
  test('cuenca ausente en la fuente -> null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C'
    });
    expect(sanitizado.cuenca).toBeNull();
  });

  test('cuenca null explicito en la fuente -> se preserva null', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', cuenca: null
    });
    expect(sanitizado.cuenca).toBeNull();
  });

  // Filtro de profundidad: campoFuente es tecnicas.profundidadTotal (ver
  // scripts/reindex_mapa.py) - 16.1% de los pozos mapeados no lo tienen,
  // nunca se inventa ni se deriva de profundidadBomba/profundidadAntepozo.
  test('profundidadTotal ausente en la fuente -> profundidad:null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C'
    });
    expect(sanitizado.profundidad).toBeNull();
  });

  test('profundidadTotal decimal se preserva tal cual', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', profundidadTotal: 12.5
    });
    expect(sanitizado.profundidad).toBe(12.5);
  });

  // Filtro "Profundidad de filtros" (distinto de "Profundidad del
  // pozo"): campoFuente construccion.filtros[], ver scripts/reindex_mapa.py.
  test('tramosFiltrantes ausente en la fuente -> [], no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C'
    });
    expect(sanitizado.tramosFiltrantes).toEqual([]);
  });

  test('tramosFiltrantes con multiples tramos se reconstruyen campo por campo (descarta diametro u otro campo extra)', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C',
      tramosFiltrantes: [{ desde: 80, hasta: 110, diametro: 10 }, { desde: 145, hasta: 170, diametro: 8 }]
    });
    expect(sanitizado.tramosFiltrantes).toEqual([{ desde: 80, hasta: 110 }, { desde: 145, hasta: 170 }]);
    expect(Object.keys(sanitizado.tramosFiltrantes[0])).toEqual(['desde', 'hasta']);
  });

  // surgencia: campo CATEGORICO unico (ver diagnostico, nunca 2
  // booleanos independientes) - se reenvia tal cual, nunca se re-etiqueta.
  test('surgencia ausente en la fuente -> null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPunto({
      wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C'
    });
    expect(sanitizado.surgencia).toBeNull();
  });

  test('surgencia con cada valor real se preserva tal cual (Profundo/SemiSurgente/Natural)', () => {
    ['Profundo', 'SemiSurgente', 'Natural'].forEach((valor) => {
      const sanitizado = MapaService.mapaService_sanitizarPunto({
        wellId: '04-0263', lat: -32.86865, lon: -68.7507, estado: 'C', surgencia: valor
      });
      expect(sanitizado.surgencia).toBe(valor);
    });
  });
});

describe('mapaService_sanitizarTramoFiltrante', () => {
  test('conserva solo desde/hasta', () => {
    const sanitizado = MapaService.mapaService_sanitizarTramoFiltrante({ desde: 80, hasta: 110, diametro: 10 });
    expect(sanitizado).toEqual({ desde: 80, hasta: 110 });
    expect(Object.keys(sanitizado)).toEqual(['desde', 'hasta']);
  });

  test('desde/hasta ausentes -> null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarTramoFiltrante({});
    expect(sanitizado).toEqual({ desde: null, hasta: null });
  });

  // Real: 19 tramos con desde=0 (filtro desde la superficie) - 0 es un
  // valor legitimo, nunca se trata como "ausente".
  test('desde:0 (real, filtro desde la superficie) se preserva, no se confunde con ausente', () => {
    const sanitizado = MapaService.mapaService_sanitizarTramoFiltrante({ desde: 0, hasta: 50 });
    expect(sanitizado.desde).toBe(0);
  });
});

// Indice de busqueda por titular + NC16 (Etapa 1A) - dataset separado de
// mapaService_getPozos, gateado por "datos" del lado de Api.js (no algo
// que esta funcion decida, pero la sanitizacion estructural aca es la
// misma garantia de fondo: nunca deja pasar mas que wellId/nc16/titular).
// NC16 vive junto a titular a proposito - ver comentario en MapaService.js
// (decision aprobada: nomenclatura catastral es igual de sensible que
// titular, nunca viaja en un dataset gateado solo por "ubicacion").
describe('mapaService_getIndiceBusqueda', () => {
  test('no encontrado (no existe pozos_busqueda.json) -> found:false', () => {
    global.mapaRepository_getPozosBusqueda.mockReturnValue({ found: false });

    const result = MapaService.mapaService_getIndiceBusqueda();

    expect(result).toEqual({ found: false });
  });

  test('encontrado -> found:true con wellId/nc16/titular tal cual', () => {
    global.mapaRepository_getPozosBusqueda.mockReturnValue({
      found: true,
      pozos: [
        { wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
        { wellId: '05-0001', nc16: null, titular: null }
      ]
    });

    const result = MapaService.mapaService_getIndiceBusqueda();

    expect(result).toEqual({
      found: true,
      pozos: [
        { wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
        { wellId: '05-0001', nc16: null, titular: null }
      ]
    });
  });

  // Caso central de seguridad, mismo criterio que mapaService_getPozos:
  // aunque el archivo trajera un campo extra (ej. "departamento",
  // "distrito", o cualquier otro dato de ficha), la sanitizacion
  // estructural lo descarta sin que haga falta una lista de exclusion.
  test('descarta cualquier campo extra que traiga el archivo', () => {
    global.mapaRepository_getPozosBusqueda.mockReturnValue({
      found: true,
      pozos: [{ wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN', departamento: 'GUAYMALLEN', distrito: 'X', dni: '12345678' }]
    });

    const result = MapaService.mapaService_getIndiceBusqueda();

    expect(result.pozos).toEqual([{ wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' }]);
    expect(Object.keys(result.pozos[0]).sort()).toEqual(['nc16', 'titular', 'wellId']);
  });

  test('dataset vacio -> found:true con pozos:[]', () => {
    global.mapaRepository_getPozosBusqueda.mockReturnValue({ found: true, pozos: [] });

    const result = MapaService.mapaService_getIndiceBusqueda();

    expect(result).toEqual({ found: true, pozos: [] });
  });
});

describe('mapaService_sanitizarPuntoBusqueda', () => {
  test('conserva solo wellId/nc16/titular', () => {
    const sanitizado = MapaService.mapaService_sanitizarPuntoBusqueda({
      wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN', departamento: 'GUAYMALLEN'
    });
    expect(sanitizado).toEqual({ wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' });
    expect(Object.keys(sanitizado)).toEqual(['wellId', 'nc16', 'titular']);
  });

  // NC16 con cero inicial: caso central de correctitud del tipo - si
  // alguna vez algo lo tratara como Number en el camino, perderia el
  // cero. Aca solo viaja como string, nunca se parsea.
  test('preserva NC16 con cero inicial como string', () => {
    const sanitizado = MapaService.mapaService_sanitizarPuntoBusqueda({
      wellId: '01-0035', nc16: '0101230020000036', titular: null
    });
    expect(sanitizado.nc16).toBe('0101230020000036');
    expect(typeof sanitizado.nc16).toBe('string');
  });

  test('nc16 ausente -> null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPuntoBusqueda({ wellId: '04-0263', titular: null });
    expect(sanitizado.nc16).toBeNull();
  });

  test('titular ausente -> null, no rompe', () => {
    const sanitizado = MapaService.mapaService_sanitizarPuntoBusqueda({ wellId: '04-0263' });
    expect(sanitizado).toEqual({ wellId: '04-0263', nc16: null, titular: null });
  });
});
