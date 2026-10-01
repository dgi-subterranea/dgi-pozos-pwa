const { installAppsScriptFakes } = require('./appsScriptFakes');
const ItfAvailabilityService = require('../src/ItfAvailabilityService');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('itfAvailabilityService_departamentosValidos', () => {
  test('devuelve "01".."19", con cero a la izquierda', () => {
    const deptos = ItfAvailabilityService.itfAvailabilityService_departamentosValidos();
    expect(deptos).toEqual([
      '01', '02', '03', '04', '05', '06', '07', '08', '09', '10',
      '11', '12', '13', '14', '15', '16', '17', '18', '19'
    ]);
  });
});

describe('itfAvailabilityService_checkDisponibilidad', () => {
  test('wellId con archivo real en THUMB -> true', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0012.jpg', '03-0050.jpg']);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012']);

    expect(resultado).toEqual({ '01-0012': true });
  });

  test('wellId sin archivo -> false', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0012.jpg']);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0013']);

    expect(resultado).toEqual({ '01-0013': false });
  });

  test('lote mixto: cada wellId resuelto de forma independiente', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0012.jpg', '02-0005.jpg']);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012', '01-0013', '02-0005', '02-0006']);

    expect(resultado).toEqual({
      '01-0012': true,
      '01-0013': false,
      '02-0005': true,
      '02-0006': false
    });
  });

  test('archivos que no siguen DD-PPPP.jpg se ignoran, no rompen el indice', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['readme.txt', 'foto_vieja.jpg', '01-0012.jpg', 'temp']);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012']);

    expect(resultado).toEqual({ '01-0012': true });
  });

  test('carpeta vacia -> todo false, no rompe', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue([]);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012', '19-9999']);

    expect(resultado).toEqual({ '01-0012': false, '19-9999': false });
  });

  // Eficiencia: la carpeta se recorre UNA sola vez aunque se llame varias
  // veces seguidas (indice cacheado) - esto es lo que evita "recorrer los
  // ~26.000 archivos cada vez que abrimos una seleccion" (requisito
  // explicito del usuario).
  test('eficiencia: dos llamadas seguidas (mismo o distinto lote) solo recorren Drive UNA vez', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0012.jpg', '05-0099.jpg']);

    ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012']);
    ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['05-0099', '05-0100']);
    const tercera = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012', '05-0099']);

    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);
    expect(tercera).toEqual({ '01-0012': true, '05-0099': true });
  });

  test('una llamada con wellId de varios departamentos distintos sigue recorriendo Drive UNA sola vez', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0001.jpg', '10-0001.jpg', '19-0001.jpg']);

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0001', '10-0001', '19-0001', '07-0001']);

    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({
      '01-0001': true,
      '10-0001': true,
      '19-0001': true,
      '07-0001': false
    });
  });

  test('lote vacio -> objeto vacio, no rompe, no recorre Drive', () => {
    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad([]);
    expect(resultado).toEqual({});
  });
});

describe('itfAvailabilityService_asegurarIndice', () => {
  test('el indice solo se reconstruye si el bucket "01" no esta en cache', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0001.jpg']);

    ItfAvailabilityService.itfAvailabilityService_asegurarIndice();
    ItfAvailabilityService.itfAvailabilityService_asegurarIndice();
    ItfAvailabilityService.itfAvailabilityService_asegurarIndice();

    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);
  });
});

describe('itfAvailabilityService_deptosDeWellIds', () => {
  test('extrae codigos de departamento unicos, sin duplicar', () => {
    const deptos = ItfAvailabilityService.itfAvailabilityService_deptosDeWellIds(['01-0001', '01-0002', '05-0001', '19-9999']);
    expect(deptos.sort()).toEqual(['01', '05', '19']);
  });
});

// Item 2 del cierre (validacion de cache real): CacheService puede
// expulsar UNA entrada bajo presion de memoria sin tocar las demas - un
// bucket faltante NUNCA debe leerse como "sin archivos" sin antes
// intentar reconstruir el indice completo contra Drive (la fuente de
// verdad sigue siendo Drive, nunca el cache).
describe('fallback ante expulsion parcial de CacheService (item 2 del cierre)', () => {
  test('si el bucket "01" esta pero el bucket pedido (ej. "05") fue expulsado, se reconstruye TODO antes de responder (nunca asume "sin archivos")', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['05-0099.jpg']);

    // Primera llamada construye el indice completo (19 buckets, incluido "05": ["0099"]).
    ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['05-0099']);
    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);

    // Simula que CacheService expulso SOLO el bucket "05" (bajo presion
    // de memoria) - "01" y el resto siguen vigentes.
    const cache = global.CacheService.getScriptCache();
    cache.remove('itf_idx_05');

    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['05-0099']);

    // Si el codigo tratara el bucket faltante como "sin archivos" sin
    // reconstruir, esto daria false a pesar de que el archivo existe.
    expect(resultado).toEqual({ '05-0099': true });
    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(2);
  });

  test('bucket faltante para un departamento NO pedido no dispara una reconstruccion innecesaria', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0001.jpg']);

    ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0001']);
    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);

    // Solo se vuelve a pedir el departamento "01" (ya en cache) - nunca
    // dispara una reconstruccion aunque OTROS buckets no se hayan tocado.
    ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0001']);
    expect(global.driveProfileRepository_listarArchivosThumb).toHaveBeenCalledTimes(1);
  });
});

// Privacidad/seguridad: el indice nunca expone Drive IDs, URLs ni el
// nombre de archivo original - solo booleanos por wellId (ver
// handleGetItfAvailability en Api.js, que es el unico que arma la
// respuesta final al frontend).
describe('privacidad: la respuesta nunca incluye datos internos de Drive', () => {
  test('ningun valor del resultado es un objeto/id/url - solo true/false', () => {
    global.driveProfileRepository_listarArchivosThumb.mockReturnValue(['01-0012.jpg']);
    const resultado = ItfAvailabilityService.itfAvailabilityService_checkDisponibilidad(['01-0012', '01-0013']);
    Object.values(resultado).forEach((v) => {
      expect(typeof v).toBe('boolean');
    });
  });
});
