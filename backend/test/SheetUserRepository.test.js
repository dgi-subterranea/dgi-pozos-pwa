// sheetUserRepository_indiceColumnas/leerPermiso son logica pura de
// string/array - no tocan SpreadsheetApp - asi que se testean directo,
// igual que registryRepository_resolveFileName (ver ese test).
// sheetUserRepository_getUserStatus (que SI abre el spreadsheet) no se
// testea unitariamente, por convencion del proyecto.
// E10-1: el repositorio deriva las columnas de permiso del catalogo (en Apps Script es otro archivo del proyecto, global).
Object.assign(global, require('../src/PermisosCatalogo'));
Object.assign(global, require('../src/UsuariosDominio'));
const {
  sheetUserRepository_indiceColumnas,
  sheetUserRepository_leerPermiso
} = require('../src/SheetUserRepository');

describe('sheetUserRepository_indiceColumnas', () => {
  test('encuentra las 17 columnas en el orden original (E5: + observaciones*; E8: + fotos_moderar)', () => {
    const header = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({
      email: 0, nombre: 1, estado: 2, fecha_alta: 3, perfil: 4, datos: 5, ubicacion: 6, ne: 7, reemplazo: 8, fotos: 9, fotos_carga: 10, fotos_moderar: 11, ubicacion_corregir: 12, ubicacion_validar: 13,
      observaciones: 14, observaciones_agregar: 15, observaciones_anular: 16, perfil_subir: -1, perfil_validar: -1,
      mapa: -1, usuarios_admin: -1, tipo: -1, version: -1, actualizado_utc: -1, actualizado_por: -1
    });
  });

  test('encuentra las columnas aunque esten reordenadas', () => {
    const header = ['observaciones_anular', 'observaciones_agregar', 'observaciones', 'ubicacion_validar', 'ubicacion_corregir', 'fotos_carga', 'fotos', 'reemplazo', 'ne', 'ubicacion', 'datos', 'perfil', 'fecha_alta', 'estado', 'nombre', 'email'];
    const idx = sheetUserRepository_indiceColumnas(header);
    expect(idx).toEqual({
      observaciones_anular: 0, observaciones_agregar: 1, observaciones: 2, ubicacion_validar: 3, ubicacion_corregir: 4, fotos_carga: 5, fotos: 6, reemplazo: 7, ne: 8, ubicacion: 9, datos: 10, perfil: 11,
      fecha_alta: 12, estado: 13, nombre: 14, email: 15, fotos_moderar: -1, perfil_subir: -1, perfil_validar: -1,
      mapa: -1, usuarios_admin: -1, tipo: -1, version: -1, actualizado_utc: -1, actualizado_por: -1
    });
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

  test('fotos_moderar (E8-3): columna ausente -> false; vacio / NO / valores raros -> false; "SI" (como el parser institucional) -> true', () => {
    const con = sheetUserRepository_indiceColumnas(['email', 'fotos', 'fotos_moderar']);
    const sin = sheetUserRepository_indiceColumnas(['email', 'fotos']);
    expect(sheetUserRepository_leerPermiso(['a', 'SI', 'SI'], sin, 'fotos_moderar')).toBe(false);
    expect(sheetUserRepository_leerPermiso(['a', 'SI', 'SI'], con, 'fotos_moderar')).toBe(true);
    expect(sheetUserRepository_leerPermiso(['a', 'SI', ' si '], con, 'fotos_moderar')).toBe(true);
    ['', '  ', 'NO', 'no', 'tal vez', 'SI!', 1, true, 'true', 'x'].forEach((v) => {
      expect(sheetUserRepository_leerPermiso(['a', 'SI', v], con, 'fotos_moderar')).toBe(false);
    });
  });

  test('los permisos vacios (usuario inexistente) incluyen fotos_moderar en false: se verifica en AuthService.test.js', () => {
    // E10-1: ya no hay una lista literal en el repositorio: el usuario inexistente recibe los permisos vacios DEL CATALOGO (todos false, incluidos fotos_moderar, mapa y usuarios_admin)
    const { instalarSheetsFalsos } = require('./fakeSheets');
    instalarSheetsFalsos({ Usuarios: [['email', 'nombre', 'estado']] });
    const r = require('../src/SheetUserRepository').sheetUserRepository_getUserStatus('nadie@example.com');
    expect(r.found).toBe(false);
    expect(r.permisos).toEqual(global.permisosCatalogo_vacios());
    expect(r.permisos.fotos_moderar).toBe(false);
    expect(require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'SheetUserRepository.js'), 'utf8')).not.toMatch(/fotos_carga: false|perfil_subir: false|'fotos_moderar',/);
  });

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

// ---------- E10-1: techo EXTERNO en los destinatarios y rollback de altas ----------
describe('E10-1: destinatarios (filtrarConPermisos) y quitarUltimaFilaSiEs', () => {
  const R = require('../src/SheetUserRepository');
  const HEADER = ['email', 'nombre', 'estado', 'perfil', 'usuarios_admin', 'tipo'];
  const filas = [
    ['interno@x.com', 'Interno', 'activo', 'SI', 'SI', 'INTERNO'],
    ['externo@x.com', 'Externo', 'activo', 'SI', 'SI', 'EXTERNO'],
    ['sintipo@x.com', 'Sin Tipo', 'activo', 'SI', 'SI', ''],
    ['baja@x.com', 'Baja', 'inactivo', 'SI', 'SI', 'INTERNO']
  ];

  test('un permiso no aplicable a EXTERNO (usuarios_admin) solo cuenta para un INTERNO: el EXTERNO y el de tipo vacio no reciben avisos de administracion', () => {
    expect(R.sheetUserRepository_filtrarConPermisos([HEADER].concat(filas), ['usuarios_admin']).map((u) => u.email)).toEqual(['interno@x.com']);
  });

  test('un permiso comun (perfil) lo reciben todos los activos, tambien el EXTERNO (tipo no concede ni quita)', () => {
    expect(R.sheetUserRepository_filtrarConPermisos([HEADER].concat(filas), ['perfil']).map((u) => u.email)).toEqual(['interno@x.com', 'externo@x.com', 'sintipo@x.com']);
  });

  test('sin la columna tipo: usuarios_admin no es efectivo para nadie (fail-closed) y perfil sigue igual', () => {
    const h = ['email', 'nombre', 'estado', 'perfil', 'usuarios_admin'];
    const f = filas.map((x) => x.slice(0, 5));
    expect(R.sheetUserRepository_filtrarConPermisos([h].concat(f), ['usuarios_admin'])).toEqual([]);
    expect(R.sheetUserRepository_filtrarConPermisos([h].concat(f), ['perfil'])).toHaveLength(3);
  });

  test('quitarUltimaFilaSiEs: quita la fila SOLO si sigue siendo la ultima (nunca borra la fila de otro usuario)', () => {
    const { instalarSheetsFalsos } = require('./fakeSheets');
    const hojas = instalarSheetsFalsos({ Usuarios: [HEADER, filas[0], filas[1], filas[2]] });
    const abierta = { sheet: hojas.Usuarios };
    expect(R.sheetUserRepository_quitarUltimaFilaSiEs(abierta, 2)).toBe(false);       // la fila 2 no es la ultima
    expect(hojas.Usuarios.filas).toHaveLength(4);
    expect(R.sheetUserRepository_quitarUltimaFilaSiEs(abierta, 4)).toBe(true);
    expect(hojas.Usuarios.filas).toHaveLength(3);
    expect(hojas.Usuarios.filas[2][0]).toBe('externo@x.com');
  });
});
