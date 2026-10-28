// Permisos de Observaciones (E5-1): observaciones / observaciones_agregar / observaciones_anular contra el parser REAL de la hoja Usuarios (SheetUserRepository) y los defaults de
// AuthService. Fail-closed: un permiso ausente de la hoja (columna inexistente) o con cualquier valor que no sea "SI" (normalizado) es false; el resto de los permisos no cambia.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Repo;

const BASE = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar'];
const NUEVOS = ['observaciones', 'observaciones_agregar', 'observaciones_anular'];
const PERMISOS_VIEJOS = ['perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar'];

function usuarios(header, filas) {
  instalarSheetsFalsos({ Usuarios: [header].concat(filas) });
}
const fila = (header, o) => header.map((c) => (o[c] === undefined ? '' : o[c]));

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  Repo = require('../src/SheetUserRepository');
});

describe('hoja Usuarios con las columnas nuevas', () => {
  const header = BASE.concat(NUEVOS);

  test('"SI" habilita; el valor se normaliza (mayusculas, espacios); cada permiso es independiente', () => {
    usuarios(header, [
      fila(header, { email: 'a@x.com', estado: 'activo', observaciones: 'SI' }),
      fila(header, { email: 'b@x.com', estado: 'activo', observaciones: ' si ', observaciones_agregar: 'Si' }),
      fila(header, { email: 'c@x.com', estado: 'activo', observaciones: 'SI', observaciones_anular: ' SI ' })
    ]);
    expect(Repo.sheetUserRepository_getUserStatus('a@x.com').permisos).toMatchObject({ observaciones: true, observaciones_agregar: false, observaciones_anular: false });
    expect(Repo.sheetUserRepository_getUserStatus('b@x.com').permisos).toMatchObject({ observaciones: true, observaciones_agregar: true, observaciones_anular: false });
    expect(Repo.sheetUserRepository_getUserStatus('c@x.com').permisos).toMatchObject({ observaciones: true, observaciones_agregar: false, observaciones_anular: true });
  });

  test.each([['NO'], [''], ['1'], ['true'], ['TRUE'], ['sí'], ['x'], ['SI.'], ['S'], [' '], [true], [1], [0], [null]])('valor %j no habilita (solo "SI" normalizado)', (valor) => {
    usuarios(header, [fila(header, { email: 'a@x.com', estado: 'activo', observaciones: valor, observaciones_agregar: valor, observaciones_anular: valor })]);
    const p = Repo.sheetUserRepository_getUserStatus('a@x.com').permisos;
    NUEVOS.forEach((n) => expect(p[n]).toBe(false));
  });

  test('un usuario inactivo conserva sus permisos en la hoja pero no esta activo (Api.js lo deshabilita antes)', () => {
    usuarios(header, [fila(header, { email: 'a@x.com', estado: 'baja', observaciones: 'SI' })]);
    expect(Repo.sheetUserRepository_getUserStatus('a@x.com')).toMatchObject({ found: true, active: false });
  });

  test('usuario inexistente: todos los permisos en false, incluidos los nuevos', () => {
    usuarios(header, []);
    const r = Repo.sheetUserRepository_getUserStatus('nadie@x.com');
    expect(r.found).toBe(false);
    expect(r.active).toBe(false);
    expect(Object.keys(r.permisos).sort()).toEqual(PERMISOS_VIEJOS.concat(NUEVOS).sort());
    Object.keys(r.permisos).forEach((k) => expect(r.permisos[k]).toBe(false));
  });
});

describe('compatibilidad: la hoja Usuarios SIN las columnas nuevas (todavia no agregadas)', () => {
  test('los permisos nuevos dan false para todos (fail-closed) y el resto de los permisos no cambia', () => {
    usuarios(BASE, [fila(BASE, { email: 'a@x.com', nombre: 'Ana', estado: 'activo', perfil: 'SI', datos: 'SI', ubicacion: 'SI', ne: 'NO', reemplazo: 'SI', fotos: 'SI', fotos_carga: 'NO', ubicacion_corregir: 'SI', ubicacion_validar: 'NO' })]);
    const s = Repo.sheetUserRepository_getUserStatus('a@x.com');
    expect(s.found).toBe(true);
    expect(s.active).toBe(true);
    expect(s.permisos).toEqual({
      perfil: true, datos: true, ubicacion: true, ne: false, reemplazo: true, fotos: true, fotos_carga: false, fotos_moderar: false, ubicacion_corregir: true, ubicacion_validar: false,
      observaciones: false, observaciones_agregar: false, observaciones_anular: false
    });
  });

  test('indiceColumnas da -1 para las columnas nuevas ausentes y leerPermiso da false', () => {
    const idx = Repo.sheetUserRepository_indiceColumnas(BASE);
    NUEVOS.forEach((n) => {
      expect(idx[n]).toBe(-1);
      expect(Repo.sheetUserRepository_leerPermiso(BASE.map(() => 'SI'), idx, n)).toBe(false);
    });
  });

  test('un permiso nuevo no cambia ninguno de los 9 existentes (todos en SI en la hoja)', () => {
    const header = BASE.concat(NUEVOS);
    usuarios(header, [fila(header, { email: 'a@x.com', estado: 'activo' })]);
    const p = Repo.sheetUserRepository_getUserStatus('a@x.com').permisos;
    PERMISOS_VIEJOS.forEach((k) => expect(p[k]).toBe(false));
    const header2 = BASE.concat(NUEVOS);
    const todos = {};
    header2.slice(4).forEach((c) => { todos[c] = 'SI'; });
    usuarios(header2, [fila(header2, Object.assign({ email: 'b@x.com', estado: 'activo' }, todos))]);
    const q = Repo.sheetUserRepository_getUserStatus('b@x.com').permisos;
    expect(Object.keys(q).sort()).toEqual(PERMISOS_VIEJOS.concat(NUEVOS).sort());
    Object.keys(q).forEach((k) => expect(q[k]).toBe(true));
  });
});

describe('listas de permisos y defaults', () => {
  test('USUARIOS_COLUMNAS_PERMISO incluye los tres nuevos (ademas de los 9 de siempre)', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'SheetUserRepository.js'), 'utf8');
    const m = fuente.match(/var USUARIOS_COLUMNAS_PERMISO = \[([^\]]*)\]/);
    const lista = m[1].split(',').map((x) => x.trim().replace(/'/g, ''));
    expect(lista).toEqual(PERMISOS_VIEJOS.concat(NUEVOS));
  });

  test('permisos vacios (repositorio y AuthService): los 12 en false', () => {
    const fuenteAuth = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'AuthService.js'), 'utf8');
    NUEVOS.forEach((n) => expect(fuenteAuth).toContain(n + ': false'));
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true });
    const Auth = require('../src/AuthService');
    const p = Auth.getUserAccess('x@x.com').permisos;
    expect(Object.keys(p).sort()).toEqual(PERMISOS_VIEJOS.concat(NUEVOS).sort());
    Object.keys(p).forEach((k) => expect(p[k]).toBe(false));
  });

  test('hasPermission: un permiso nuevo ausente en el objeto de acceso es false (fail-closed)', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: true, permisos: { perfil: true } });
    const Auth = require('../src/AuthService');
    expect(Auth.hasPermission('x@x.com', 'observaciones')).toBe(false);
    expect(Auth.hasPermission('x@x.com', 'observaciones_anular')).toBe(false);
    expect(Auth.hasPermission('x@x.com', 'perfil')).toBe(true);
  });

  test('hasPermission: un usuario inactivo no tiene ningun permiso nuevo aunque la hoja diga SI', () => {
    global.sheetUserRepository_getUserStatus.mockReturnValue({ found: true, active: false, permisos: { observaciones: true, observaciones_anular: true } });
    const Auth = require('../src/AuthService');
    expect(Auth.hasPermission('x@x.com', 'observaciones')).toBe(false);
  });
});
