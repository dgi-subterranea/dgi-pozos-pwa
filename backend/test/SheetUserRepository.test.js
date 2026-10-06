// sheetUserRepository_indiceColumnas/leerPermiso son logica pura de
// string/array - no tocan SpreadsheetApp - asi que se testean directo,
// igual que registryRepository_resolveFileName (ver ese test).
// sheetUserRepository_getUserStatus (que SI abre el spreadsheet) no se
// testea unitariamente, por convencion del proyecto.
const {
  sheetUserRepository_indiceColumnas,
  sheetUserRepository_leerPermiso
} = require('../src/SheetUserRepository');

describe('sheetUserRepository_indiceColumnas', () => {
  test('encuentra las 11 columnas en el orden original', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({ email: 0, nombre: 1, estado: 2, fecha_alta: 3, perfil: 4, datos: 5, ubicacion: 6, ne: 7, reemplazo: 8, fotos: 9, fotos_carga: 10 });
  });

  test('encuentra las columnas aunque esten reordenadas', () => {
    const header = ['fotos_carga', 'fotos', 'reemplazo', 'ne', 'ubicacion', 'datos', 'perfil', 'fecha_alta', 'estado', 'nombre', 'email'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({ fotos_carga: 0, fotos: 1, reemplazo: 2, ne: 3, ubicacion: 4, datos: 5, perfil: 6, fecha_alta: 7, estado: 8, nombre: 9, email: 10 });
  });

  test('una hoja SIN las columnas fotos / fotos_carga (todavia no agregadas) las da como -1: fail-closed', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx.fotos).toBe(-1);
    expect(idx.fotos_carga).toBe(-1);
    expect(sheetUserRepository_leerPermiso(['x', 'x', 'x', 'x', 'SI', 'SI', 'SI', 'SI', 'SI'], idx, 'fotos')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['x', 'x', 'x', 'x', 'SI', 'SI', 'SI', 'SI', 'SI'], idx, 'fotos_carga')).toBe(false);
  });

  test('fotos y fotos_carga son permisos independientes (SI / NO por separado)', () => {
    const idx = sheetUserRepository_indiceColumnas(['email', 'fotos', 'fotos_carga']);
    expect(sheetUserRepository_leerPermiso(['a', 'SI', 'NO'], idx, 'fotos')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['a', 'SI', 'NO'], idx, 'fotos_carga')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['a', '', 'si'], idx, 'fotos')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['a', '', 'si'], idx, 'fotos_carga')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['a', 'yes', 'true'], idx, 'fotos')).toBe(false);
  });

  test('es insensible a mayusculas y espacios en el encabezado', () => {
    const header = [' Email ', 'Nombre', 'ESTADO', 'Fecha_Alta', 'Perfil', 'Datos', 'Ubicacion', 'NE', ' Reemplazo '];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx.email).toBe(0);
    expect(idx.perfil).toBe(4);
    expect(idx.ne).toBe(7);
    expect(idx.reemplazo).toBe(8);
  });

  test('columna de permiso ausente del header da indice -1 (fail-closed en leerPermiso)', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx.ubicacion).toBe(-1);
    expect(idx.ne).toBe(-1);
    expect(idx.reemplazo).toBe(-1);
  });
});

describe('sheetUserRepository_leerPermiso', () => {
  const indices = { perfil: 0, datos: 1, ubicacion: 2, ne: -1 };

  test('"SI" (variantes de mayuscula/espacios) da true', () => {
    expect(sheetUserRepository_leerPermiso(['SI'], indices, 'perfil')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['si'], indices, 'perfil')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['Si'], indices, 'perfil')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['  SI  '], indices, 'perfil')).toBe(true);
  });

  test('"NO" da false', () => {
    expect(sheetUserRepository_leerPermiso(['x', 'NO'], indices, 'datos')).toBe(false);
  });

  test('celda vacia da false', () => {
    expect(sheetUserRepository_leerPermiso(['x', ''], indices, 'datos')).toBe(false);
  });

  test('valores invalidos (1, true, texto desconocido) dan false', () => {
    expect(sheetUserRepository_leerPermiso(['x', 'x', 1], indices, 'ubicacion')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['x', 'x', true], indices, 'ubicacion')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['x', 'x', 'tal vez'], indices, 'ubicacion')).toBe(false);
  });

  test('reemplazo: SI da true; NO, vacio, texto raro o columna ausente dan false (fail-closed)', () => {
    const idx = { reemplazo: 0, ne: -1 };
    expect(sheetUserRepository_leerPermiso([' si '], idx, 'reemplazo')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['NO'], idx, 'reemplazo')).toBe(false);
    expect(sheetUserRepository_leerPermiso([''], idx, 'reemplazo')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['yes'], idx, 'reemplazo')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['SI'], { reemplazo: -1 }, 'reemplazo')).toBe(false);
  });

  test('columna inexistente (indice -1) da false sin lanzar error', () => {
    expect(sheetUserRepository_leerPermiso(['SI', 'SI', 'SI'], indices, 'ne')).toBe(false);
  });
});
