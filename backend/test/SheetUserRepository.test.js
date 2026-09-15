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
  test('encuentra las 8 columnas en el orden original', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({ email: 0, nombre: 1, estado: 2, fecha_alta: 3, perfil: 4, datos: 5, ubicacion: 6, ne: 7 });
  });

  test('encuentra las columnas aunque esten reordenadas', () => {
    const header = ['ne', 'ubicacion', 'datos', 'perfil', 'fecha_alta', 'estado', 'nombre', 'email'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({ ne: 0, ubicacion: 1, datos: 2, perfil: 3, fecha_alta: 4, estado: 5, nombre: 6, email: 7 });
  });

  test('es insensible a mayusculas y espacios en el encabezado', () => {
    const header = [' Email ', 'Nombre', 'ESTADO', 'Fecha_Alta', 'Perfil', 'Datos', 'Ubicacion', 'NE'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx.email).toBe(0);
    expect(idx.perfil).toBe(4);
    expect(idx.ne).toBe(7);
  });

  test('columna de permiso ausente del header da indice -1 (fail-closed en leerPermiso)', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx.ubicacion).toBe(-1);
    expect(idx.ne).toBe(-1);
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

  test('columna inexistente (indice -1) da false sin lanzar error', () => {
    expect(sheetUserRepository_leerPermiso(['SI', 'SI', 'SI'], indices, 'ne')).toBe(false);
  });
});
