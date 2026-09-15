const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();
global.Logger = { log: jest.fn() };

const { searchHistoryService_registerSearch } = require('../src/SearchHistoryService');

describe('searchHistoryService_registerSearch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('resultado ENCONTRADO cuando algun modulo es true', () => {
    global.sheetSearchHistoryRepository_logSearch.mockReturnValue(undefined);

    searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '04-0263', { perfil: true, datos: false, ubicacion: false, ne: false });

    expect(global.sheetSearchHistoryRepository_logSearch).toHaveBeenCalledWith(
      'user@example.com', 'Juan Pérez', '04-0263', 'ENCONTRADO', { perfil: true, datos: false, ubicacion: false, ne: false }
    );
  });

  test('resultado NO_ENCONTRADO cuando todos los modulos son false', () => {
    global.sheetSearchHistoryRepository_logSearch.mockReturnValue(undefined);

    searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '05-9999', { perfil: false, datos: false, ubicacion: false, ne: false });

    expect(global.sheetSearchHistoryRepository_logSearch).toHaveBeenCalledWith(
      'user@example.com', 'Juan Pérez', '05-9999', 'NO_ENCONTRADO', { perfil: false, datos: false, ubicacion: false, ne: false }
    );
  });

  test('resultado NO_ENCONTRADO cuando modulos es un objeto vacio', () => {
    global.sheetSearchHistoryRepository_logSearch.mockReturnValue(undefined);

    searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '05-9999', {});

    expect(global.sheetSearchHistoryRepository_logSearch).toHaveBeenCalledWith(
      'user@example.com', 'Juan Pérez', '05-9999', 'NO_ENCONTRADO', {}
    );
  });

  test('resultado NO_ENCONTRADO cuando modulos es undefined (no rompe)', () => {
    global.sheetSearchHistoryRepository_logSearch.mockReturnValue(undefined);

    searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '05-9999', undefined);

    expect(global.sheetSearchHistoryRepository_logSearch).toHaveBeenCalledWith(
      'user@example.com', 'Juan Pérez', '05-9999', 'NO_ENCONTRADO', {}
    );
  });

  test('devuelve { logged: true } cuando el repositorio no lanza excepcion', () => {
    global.sheetSearchHistoryRepository_logSearch.mockReturnValue(undefined);

    const result = searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '04-0263', { perfil: true });

    expect(result).toEqual({ logged: true });
  });

  test('devuelve { logged: false } y no propaga la excepcion cuando el repositorio falla', () => {
    global.sheetSearchHistoryRepository_logSearch.mockImplementation(() => {
      throw new Error('No existe una hoja llamada "Busquedas"');
    });

    const result = searchHistoryService_registerSearch('user@example.com', 'Juan Pérez', '04-0263', { perfil: true });

    expect(result).toEqual({ logged: false });
  });
});
