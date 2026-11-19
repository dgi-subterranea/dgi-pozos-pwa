// E10-2: los siete ENDPOINTS de la administracion de usuarios, probados DIRECTO por doPost (el camino real del Web App): ocultar la UI no es la defensa. Modulos REALES (Auth, Api, UsuariosAdminApi,
// UsuariosAdminLectura, UsuariosAdminService, dominio, catalogo, flags, repositorios); Google y las hojas, en memoria.
const fs = require('fs');
const path = require('path');
const { crearEntornoE10, ADMIN1, ADMIN2, PERMISOS_DE_SIEMPRE, filaDe } = require('./e10Entorno');

let E;
let Api;
const ON = { E10_ADMIN_USUARIOS_ACTIVO: 'SI' };
const encender = (extra) => { Object.assign(global.__propiedades, ON, extra || {}); };
const ACCIONES = ['adminUsuariosListar', 'adminPermisosCatalogo', 'adminUsuarioObtener', 'adminUsuarioCrear', 'adminUsuarioActualizar', 'adminUsuarioDesactivar', 'adminUsuarioReactivar'];

function armar(opciones) {
  E = crearEntornoE10(opciones);
  ['UsuariosAdminLectura', 'UsuariosAdminApi'].forEach((m) => Object.assign(global, require('../src/' + m)));
  Api = require('../src/Api');
  global.validateSession = Api.validateSession;
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  encender();
}

let n = 0;
const rid = () => 'req-' + (n += 1);
// pedido por doPost con la sesion de `email` (cuerpo = lo que mande el cliente, tal cual)
function llamar(accion, cuerpo, email, token) {
  const t = token !== undefined ? token : E.Auth.createSessionToken(email || ADMIN1);
  const r = Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ action: accion, sessionToken: t }, cuerpo || {})) } });
  return JSON.parse(r.getContent());
}
const usuarios = () => global.sheetUserRepository_leerUsuarios();
const usuario = (email) => usuarios().find((u) => u.email === email);
const eventos = () => global.usuariosEventosRepository_leer(global.usuariosEventosRepository_abrir());
const snapshot = () => JSON.stringify({ u: E.hojas.Usuarios.filas, e: E.hojas.UsuariosEventos ? E.hojas.UsuariosEventos.filas : null });
const columna = (nombre) => E.hojas.Usuarios.filas[0].indexOf(nombre);
const NUEVO = (extra) => Object.assign({ email: 'nuevo@x.com', nombre: 'Nuevo Usuario', tipo: 'INTERNO', permisos: ['perfil', 'datos'], clientRequestId: rid() }, extra || {});
const v1 = (email, extra) => { const u = usuario(email); return Object.assign({ email, versionEsperada: u.version, etag: global.usuariosAdmin_vista(u).etag, clientRequestId: rid() }, extra || {}); };

beforeEach(() => { armar(); });

describe('GATE: sesion + usuario activo + INTERNO + usuarios_admin + flag (fail-closed)', () => {
  test('un administrador valido con el flag encendido puede listar y obtener el catalogo', () => {
    expect(llamar('adminUsuariosListar')).toMatchObject({ status: 'ok' });
    expect(llamar('adminPermisosCatalogo')).toMatchObject({ status: 'ok' });
  });

  test.each(ACCIONES)('%s: un usuario NORMAL (sin usuarios_admin) recibe PERMISSION_DENIED y no toca nada', (accion) => {
    const antes = snapshot();
    const r = llamar(accion, accion === 'adminUsuarioObtener' ? { email: ADMIN1 } : NUEVO(), 'interno@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(snapshot()).toBe(antes);
  });

  test.each(ACCIONES)('%s: un usuario INACTIVO (aunque tuviera usuarios_admin) recibe USER_DISABLED', (accion) => {
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && f[0] === 'baja@x.com') { f[columna('usuarios_admin')] = 'SI'; } });
    expect(llamar(accion, NUEVO(), 'baja@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
  });

  test.each(ACCIONES)('%s: un EXTERNO con usuarios_admin = SI escrito a mano NO es administrador (techo duro)', (accion) => {
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && f[0] === 'externo@x.com') { f[columna('usuarios_admin')] = 'SI'; } });
    const antes = snapshot();
    expect(llamar(accion, NUEVO(), 'externo@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(snapshot()).toBe(antes);
  });

  test.each(ACCIONES)('%s: sin sesion o con un token invalido -> UNAUTHORIZED', (accion) => {
    expect(llamar(accion, {}, null, 'token-invalido')).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(llamar(accion, {}, null, '')).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
  });

  test.each(ACCIONES)('%s: con E10_ADMIN_USUARIOS_ACTIVO apagado el ADMINISTRADOR recibe E10_ADMIN_INACTIVO antes de abrir ninguna hoja y sin leer el cuerpo', (accion) => {
    global.getUserAccess(ADMIN1);                                      // el acceso de la sesion ya esta cacheado: lo unico que abriria una hoja seria el servicio
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    const antes = snapshot();
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    const lock = jest.spyOn(global.LockService, 'getScriptLock');
    // cuerpo con basura: el flag manda antes que la validacion
    expect(llamar(accion, { cualquierCosa: 1 }, ADMIN1)).toMatchObject({ status: 'error', code: 'E10_ADMIN_INACTIVO' });
    expect(abrir).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(snapshot()).toBe(antes);
    abrir.mockRestore();
    lock.mockRestore();
  });

  test.each([[undefined], ['NO'], [''], ['si'], ['true'], [' SI']])('flag con valor %j: apagado (solo el valor exacto SI lo enciende)', (valor) => {
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    if (valor !== undefined) { global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO = valor; }
    expect(llamar('adminUsuariosListar')).toMatchObject({ status: 'error', code: 'E10_ADMIN_INACTIVO' });
  });

  test('flag apagado: un usuario que NO es administrador recibe PERMISSION_DENIED (no se revela el estado del flag)', () => {
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    expect(llamar('adminUsuariosListar', {}, 'interno@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test('un administrador DEGRADADO a mano en la hoja (con su acceso todavia cacheado) es rechazado por la comprobacion FRESCA del servicio', () => {
    expect(llamar('adminUsuariosListar', {}, ADMIN2)).toMatchObject({ status: 'ok' });        // cachea el acceso de admin2
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && f[0] === ADMIN2) { f[columna('usuarios_admin')] = 'NO'; } });
    const antes = snapshot();
    expect(llamar('adminUsuarioCrear', NUEVO(), ADMIN2)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(llamar('adminUsuariosListar', {}, ADMIN2)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(snapshot()).toBe(antes);
  });

  test.each(ACCIONES)('%s: un EXTERNO manipulado o un usuario inactivo NO se entera del estado del flag (PERMISSION_DENIED / USER_DISABLED, nunca E10_ADMIN_INACTIVO)', (accion) => {
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && (f[0] === 'externo@x.com' || f[0] === 'baja@x.com')) { f[columna('usuarios_admin')] = 'SI'; } });
    expect(llamar(accion, NUEVO(), 'externo@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(llamar(accion, NUEVO(), 'baja@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
  });

  test('las LECTURAS (servicio directo) tambien son fail-closed: flag apagado -> E10_ADMIN_INACTIVO sin abrir hojas; actor que no es administrador efectivo -> PERMISSION_DENIED', () => {
    const L = require('../src/UsuariosAdminLectura');
    const admin = { email: ADMIN1, nombre: 'A' };
    expect(L.usuariosAdminLectura_listar(admin)).toMatchObject({ ok: true });
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    ['usuariosAdminLectura_listar', 'usuariosAdminLectura_catalogo'].forEach((fn) => expect(L[fn](admin)).toMatchObject({ ok: false, codigo: 'E10_ADMIN_INACTIVO' }));
    expect(L.usuariosAdminLectura_obtener(admin, 'interno@x.com')).toMatchObject({ ok: false, codigo: 'E10_ADMIN_INACTIVO' });
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
    encender();
    const noAdmin = { email: 'interno@x.com', nombre: 'I' };
    ['usuariosAdminLectura_listar', 'usuariosAdminLectura_catalogo'].forEach((fn) => expect(L[fn](noAdmin)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' }));
    expect(L.usuariosAdminLectura_obtener(noAdmin, ADMIN1)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
    expect(L.usuariosAdminLectura_listar(null)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
  });

  test('exactamente siete acciones administrativas en doPost, ninguna escritura generica de filas', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'Api.js'), 'utf8');
    const rutas = (src.match(/body\.action === 'admin[A-Za-z]+'/g) || []).map((x) => /'(.+)'/.exec(x)[1]).sort();
    expect(rutas).toEqual(ACCIONES.slice().sort());
    const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'UsuariosAdminApi.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(api).not.toMatch(/SpreadsheetApp|setValue|appendRow|getRange|sheetUserRepository_escribir|sheetUserRepository_agregar/);
  });
});

describe('LISTADO', () => {
  test('devuelve TODOS los usuarios con lo minimo que la pantalla muestra y nada interno', () => {
    const r = llamar('adminUsuariosListar');
    expect(r.status).toBe('ok');
    expect(r.data.total).toBe(5);
    expect(r.data.activos).toBe(4);
    expect(r.data.administradoresEfectivos).toBe(2);
    const a = r.data.usuarios.find((u) => u.email === ADMIN1);
    expect(a).toMatchObject({ nombre: 'Admin Uno', estado: 'activo', tipo: 'INTERNO', version: 1, esAdmin: true });
    expect(a.cantidadPermisos).toBe(a.permisos.length);
    expect(a.permisos).toContain('usuarios_admin');
    expect(typeof a.etag).toBe('string');
    expect(a.actualizadoPor).toBe('migracion:E10-1');                   // lo que la migracion dejo en la hoja
    expect(Object.keys(a).sort()).toEqual(['actualizadoPor', 'actualizadoUtc', 'cantidadPermisos', 'email', 'esAdmin', 'estado', 'etag', 'nombre', 'permisos', 'permisosInefectivos', 'tipo', 'version']);
    expect(a.permisosInefectivos).toEqual([]);
    expect(r.data.usuarios.find((u) => u.email === 'externo@x.com')).toMatchObject({ tipo: 'EXTERNO', esAdmin: false });
    expect(r.data.usuarios.find((u) => u.email === 'baja@x.com')).toMatchObject({ estado: 'inactivo', esAdmin: false });
  });

  test('no depende de cuantos usuarios haya: 250 usuarios, todos, sin paginar', () => {
    const header = E.header;
    for (let i = 0; i < 245; i += 1) {
      E.hojas.Usuarios.filas.push(filaDe(header, { email: 'u' + i + '@x.com', nombre: 'Usuario ' + String(i).padStart(3, '0'), permisos: ['perfil'] }));
    }
    const r = llamar('adminUsuariosListar');
    expect(r.data.total).toBe(250);
    expect(r.data.usuarios).toHaveLength(250);
    expect(new Set(r.data.usuarios.map((u) => u.email)).size).toBe(250);
  });

  test('ordenado por nombre (sin distinguir mayusculas) y expone actualizado_utc / actualizado_por de la hoja', () => {
    const fila = E.hojas.Usuarios.filas[2];
    fila[columna('actualizado_utc')] = new Date('2026-11-05T15:04:38.896Z');      // Sheets convierte el ISO en Date
    fila[columna('actualizado_por')] = 'migracion:E10-1';
    const r = llamar('adminUsuariosListar');
    const nombres = r.data.usuarios.map((u) => u.nombre.toLowerCase());
    expect(nombres).toEqual(nombres.slice().sort());
    const u = r.data.usuarios.find((x) => x.email === fila[0]);
    expect(u).toMatchObject({ actualizadoUtc: '2026-11-05T15:04:38.896Z', actualizadoPor: 'migracion:E10-1' });
  });
});

describe('DETALLE', () => {
  test('usuario + etag + ultimos eventos (mas reciente primero), sin clientRequestId ni datos internos', () => {
    llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'Renombrado' }));
    llamar('adminUsuarioActualizar', v1('interno@x.com', { permisos: ['perfil'] }));
    const r = llamar('adminUsuarioObtener', { email: 'Interno@X.com' });
    expect(r.status).toBe('ok');
    expect(r.data.usuario).toMatchObject({ email: 'interno@x.com', nombre: 'Renombrado', version: 3 });
    expect(r.data.eventos.map((e) => e.secuencia)).toEqual([2, 1]);
    expect(r.data.eventos[0]).toMatchObject({ evento: 'USUARIO_ACTUALIZADO', ejecutadoPor: ADMIN1, versionAnterior: 2, versionNueva: 3, permisosAntes: ['perfil', 'datos', 'ubicacion', 'mapa'], permisosDespues: ['perfil'], origen: 'APP' });
    expect(JSON.stringify(r.data.eventos)).not.toMatch(/clientRequestId|req-/);
    expect(r.data).toMatchObject({ eventosDisponibles: true, hayMasEventos: false, limiteEventos: 20 });
  });

  test('cantidad RECIENTE de eventos: tope por defecto, limite pedido, tope maximo y "hay mas"', () => {
    for (let i = 0; i < 25; i += 1) {
      const u = usuario('interno@x.com');
      llamar('adminUsuarioActualizar', { email: 'interno@x.com', versionEsperada: u.version, etag: global.usuariosAdmin_vista(u).etag, nombre: 'Nombre ' + i, clientRequestId: rid() });
    }
    expect(llamar('adminUsuarioObtener', { email: 'interno@x.com' }).data).toMatchObject({ hayMasEventos: true, limiteEventos: 20 });
    expect(llamar('adminUsuarioObtener', { email: 'interno@x.com' }).data.eventos).toHaveLength(20);
    const chico = llamar('adminUsuarioObtener', { email: 'interno@x.com', limiteEventos: 3 }).data;
    expect(chico.eventos).toHaveLength(3);
    expect(chico.eventos[0].secuencia).toBe(25);
    expect(llamar('adminUsuarioObtener', { email: 'interno@x.com', limiteEventos: 500 }).data).toMatchObject({ limiteEventos: 100, hayMasEventos: false });
    expect(llamar('adminUsuarioObtener', { email: 'interno@x.com', limiteEventos: 500 }).data.eventos).toHaveLength(25);
  });

  test('solo los eventos del usuario pedido', () => {
    llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'A' }));
    llamar('adminUsuarioActualizar', v1('externo@x.com', { nombre: 'B' }));
    const r = llamar('adminUsuarioObtener', { email: 'externo@x.com' });
    expect(r.data.eventos).toHaveLength(1);
    expect(r.data.eventos[0].nombreObjetivo).toBe('B');
  });

  test('un email que figura DOS veces en la hoja: EMAIL_DUPLICADO_EN_HOJA (no se elige uno al azar)', () => {
    E.hojas.Usuarios.filas.push(E.hojas.Usuarios.filas[3].slice());
    expect(llamar('adminUsuarioObtener', { email: 'interno@x.com' })).toMatchObject({ status: 'error', code: 'EMAIL_DUPLICADO_EN_HOJA' });
  });

  test('usuario inexistente -> USUARIO_NO_ENCONTRADO; email invalido -> EMAIL_INVALIDO', () => {
    expect(llamar('adminUsuarioObtener', { email: 'nadie@x.com' })).toMatchObject({ status: 'error', code: 'USUARIO_NO_ENCONTRADO' });
    expect(llamar('adminUsuarioObtener', { email: 'no-es-un-email' })).toMatchObject({ status: 'error', code: 'EMAIL_INVALIDO' });
  });

  test('si UsuariosEventos no se puede leer, el detalle se muestra pero DICE que no hay historial disponible (no inventa uno vacio)', () => {
    delete E.hojas.UsuariosEventos;
    const r = llamar('adminUsuarioObtener', { email: 'interno@x.com' });
    expect(r.status).toBe('ok');
    expect(r.data).toMatchObject({ eventosDisponibles: false, eventos: [] });
  });
});

describe('CATALOGO', () => {
  test('metadata completa, ordenada, sin duplicados y IGUAL al catalogo canonico', () => {
    const r = llamar('adminPermisosCatalogo');
    expect(r.status).toBe('ok');
    const ps = r.data.permisos;
    expect(ps).toEqual(global.permisosCatalogo_lista());
    expect(ps).toHaveLength(17);
    expect(new Set(ps.map((p) => p.id)).size).toBe(17);
    expect(ps.map((p) => p.orden)).toEqual(ps.map((p) => p.orden).slice().sort((a, b) => a - b));
    ps.forEach((p) => {
      expect(Object.keys(p).sort()).toEqual(['aplicableExterno', 'aplicableInterno', 'categoria', 'critico', 'dependeDe', 'descripcion', 'id', 'modulo', 'nombre', 'orden']);
      p.dependeDe.forEach((d) => expect(ps.map((x) => x.id)).toContain(d));
    });
    expect(ps.find((p) => p.id === 'usuarios_admin')).toMatchObject({ critico: true, aplicableExterno: false, aplicableInterno: true });
    expect(ps.find((p) => p.id === 'perfil_validar').dependeDe).toEqual(['perfil']);
    expect(r.data.tipos).toEqual(['INTERNO', 'EXTERNO']);
    expect(r.data.categorias).toEqual(['lectura', 'escritura', 'moderacion', 'administracion']);
  });

  test('es una copia: alterar la respuesta no altera el catalogo', () => {
    const r = llamar('adminPermisosCatalogo');
    r.data.permisos[0].nombre = 'ALTERADO';
    expect(global.permisosCatalogo_lista()[0].nombre).not.toBe('ALTERADO');
  });
});

describe('CREAR', () => {
  test('INTERNO: fila nueva activa, version 1, evento USUARIO_CREADO con el actor de la SESION, cache invalidado', () => {
    const r = llamar('adminUsuarioCrear', NUEVO({ email: ' Nuevo@X.com ', motivo: 'alta de prueba' }));
    expect(r).toMatchObject({ status: 'ok', data: { eventos: ['USUARIO_CREADO'], usuario: { email: 'nuevo@x.com', estado: 'activo', tipo: 'INTERNO', version: 1, permisos: ['perfil', 'datos'], esAdmin: false } } });
    expect(usuario('nuevo@x.com')).toMatchObject({ nombre: 'Nuevo Usuario', estado: 'activo', tipo: 'INTERNO', version: 1, actualizadoPor: ADMIN1 });
    expect(r.data.usuario.actualizadoUtc).toMatch(/^2\d{3}-\d\d-\d\dT/);
    const e = eventos();
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ evento: 'USUARIO_CREADO', usuarioObjetivo: 'nuevo@x.com', nombreObjetivo: 'Nuevo Usuario', ejecutadoPor: ADMIN1, tipoNuevo: 'INTERNO', estadoNuevo: 'activo', versionAnterior: 0, versionNueva: 1, permisosAntes: '', permisosDespues: 'perfil,datos', motivo: 'alta de prueba', origen: 'APP' });
    expect(e[0].clientRequestId).toMatch(/^req-/);
  });

  test('EXTERNO con E10_GESTION_EXTERNOS_ACTIVO apagado: E10_GESTION_EXTERNOS_INACTIVA y no se escribe nada', () => {
    const antes = snapshot();
    expect(llamar('adminUsuarioCrear', NUEVO({ tipo: 'EXTERNO' }))).toMatchObject({ status: 'error', code: 'E10_GESTION_EXTERNOS_INACTIVA' });
    expect(snapshot()).toBe(antes);
  });

  test('EXTERNO con E10_GESTION_EXTERNOS_ACTIVO encendido: se crea con exactamente los permisos pedidos (el tipo no concede nada)', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    const r = llamar('adminUsuarioCrear', NUEVO({ tipo: 'EXTERNO', permisos: ['perfil'] }));
    expect(r).toMatchObject({ status: 'ok', data: { usuario: { tipo: 'EXTERNO', permisos: ['perfil'] } } });
    expect(usuario('nuevo@x.com').permisos).toEqual(expect.objectContaining({ perfil: true, datos: false, mapa: false }));
  });

  test('EXTERNO + usuarios_admin: rechazado SIEMPRE (con el flag de externos encendido tambien)', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    const antes = snapshot();
    expect(llamar('adminUsuarioCrear', NUEVO({ tipo: 'EXTERNO', permisos: ['perfil', 'usuarios_admin'] }))).toMatchObject({ status: 'error', code: 'TIPO_NO_PERMITE_PERMISO' });
    expect(snapshot()).toBe(antes);
  });

  test('duplicado, email invalido, nombre invalido, tipo invalido', () => {
    expect(llamar('adminUsuarioCrear', NUEVO({ email: 'Interno@X.com' }))).toMatchObject({ code: 'USUARIO_EXISTE' });
    expect(llamar('adminUsuarioCrear', NUEVO({ email: 'sin-arroba' }))).toMatchObject({ code: 'EMAIL_INVALIDO' });
    expect(llamar('adminUsuarioCrear', NUEVO({ nombre: '   ' }))).toMatchObject({ code: 'NOMBRE_INVALIDO' });
    expect(llamar('adminUsuarioCrear', NUEVO({ tipo: 'ADMIN' }))).toMatchObject({ code: 'TIPO_INVALIDO' });
    expect(usuarios()).toHaveLength(5);
  });

  test('permiso inexistente y dependencia invalida', () => {
    expect(llamar('adminUsuarioCrear', NUEVO({ permisos: ['perfil', 'superpoder'] }))).toMatchObject({ code: 'PERMISO_DESCONOCIDO' });
    expect(llamar('adminUsuarioCrear', NUEVO({ permisos: ['perfil_validar'] }))).toMatchObject({ code: 'PERMISOS_INCONSISTENTES' });
    expect(llamar('adminUsuarioCrear', NUEVO({ permisos: ['fotos_moderar'] }))).toMatchObject({ code: 'PERMISOS_INCONSISTENTES' });
    expect(usuarios()).toHaveLength(5);
  });

  test('crear un administrador INTERNO (usuarios_admin) es posible y cuenta como administrador efectivo', () => {
    const r = llamar('adminUsuarioCrear', NUEVO({ permisos: ['perfil', 'usuarios_admin'] }));
    expect(r.data.usuario.esAdmin).toBe(true);
    expect(llamar('adminUsuariosListar').data.administradoresEfectivos).toBe(3);
  });
});

describe('EDITAR', () => {
  test('nombre y permisos: version + 1, UN evento USUARIO_ACTUALIZADO, el email no cambia', () => {
    const r = llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'Interno Nuevo', permisos: ['perfil', 'datos', 'fotos'], motivo: 'ajuste' }));
    expect(r).toMatchObject({ status: 'ok', data: { eventos: ['USUARIO_ACTUALIZADO'], usuario: { email: 'interno@x.com', nombre: 'Interno Nuevo', version: 2, permisos: ['perfil', 'datos', 'fotos'] } } });
    expect(eventos()[0]).toMatchObject({ nombreAnterior: 'Interno Consulta', nombreObjetivo: 'Interno Nuevo', permisosAntes: 'perfil,datos,ubicacion,mapa', permisosDespues: 'perfil,datos,fotos', motivo: 'ajuste', versionAnterior: 1, versionNueva: 2 });
  });

  test('cambiar el tipo exige motivo y (a EXTERNO) el flag de externos; no toca los demas permisos', () => {
    const antes = usuario('interno@x.com').permisos;
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { tipo: 'EXTERNO', motivo: 'x' }))).toMatchObject({ code: 'E10_GESTION_EXTERNOS_INACTIVA' });
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { tipo: 'EXTERNO' }))).toMatchObject({ code: 'MOTIVO_REQUERIDO' });
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { tipo: 'EXTERNO', motivo: 'pasa a externo' }))).toMatchObject({ status: 'ok', data: { usuario: { tipo: 'EXTERNO' } } });
    expect(usuario('interno@x.com').permisos).toEqual(antes);
  });

  test('EXTERNO -> INTERNO esta permitido para un administrador (con motivo) y conserva los permisos', () => {
    const antes = usuario('externo@x.com').permisos;
    expect(llamar('adminUsuarioActualizar', v1('externo@x.com', { tipo: 'INTERNO', motivo: 'ahora es interno' }))).toMatchObject({ status: 'ok', data: { usuario: { tipo: 'INTERNO' } } });
    expect(usuario('externo@x.com').permisos).toEqual(antes);
  });

  test('INTENTO DE MODIFICAR EL EMAIL: no existe ningun campo para eso (el email es inmutable)', () => {
    const antes = snapshot();
    ['nuevoEmail', 'emailNuevo', 'newEmail', 'emailAnterior', 'correo'].forEach((campo) => {
      expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'X', [campo]: 'otro@x.com' }))).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    });
    expect(snapshot()).toBe(antes);
    expect(usuario('otro@x.com')).toBeUndefined();
  });

  test('CONFLICTO de version: otro administrador cambio el usuario -> CONFLICT_VERSION con el estado actual, sin sobrescribir', () => {
    const pedido = v1('interno@x.com', { nombre: 'Mi cambio' });
    llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'Cambio del otro admin' }), ADMIN2);
    const r = llamar('adminUsuarioActualizar', pedido);
    expect(r).toMatchObject({ status: 'error', code: 'CONFLICT_VERSION', actual: { nombre: 'Cambio del otro admin', version: 2 } });
    expect(usuario('interno@x.com').nombre).toBe('Cambio del otro admin');
  });

  test('CONFLICTO de etag: la version coincide pero el contenido no (edicion manual de la hoja) -> CONFLICT_VERSION', () => {
    const pedido = v1('interno@x.com', { nombre: 'Mi cambio' });
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && f[0] === 'interno@x.com') { f[columna('fotos')] = 'SI'; } });      // sin subir la version
    expect(llamar('adminUsuarioActualizar', pedido)).toMatchObject({ status: 'error', code: 'CONFLICT_VERSION' });
    expect(usuario('interno@x.com').nombre).toBe('Interno Consulta');
  });

  test('sin versionEsperada / etag / clientRequestId: INVALID_REQUEST; sin nada para cambiar: INVALID_REQUEST', () => {
    const base = v1('interno@x.com', { nombre: 'X' });
    ['versionEsperada', 'etag', 'clientRequestId'].forEach((c) => {
      const p = Object.assign({}, base); delete p[c];
      expect(llamar('adminUsuarioActualizar', p)).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    });
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com'))).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
  });

  test('usuario inexistente -> USUARIO_NO_ENCONTRADO; permiso desconocido; dependencia invalida', () => {
    expect(llamar('adminUsuarioActualizar', { email: 'nadie@x.com', versionEsperada: 1, etag: 'x', nombre: 'Z', clientRequestId: rid() })).toMatchObject({ code: 'USUARIO_NO_ENCONTRADO' });
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { permisos: ['perfil', 'volar'] }))).toMatchObject({ code: 'PERMISO_DESCONOCIDO' });
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { permisos: ['perfil_validar', 'datos'] }))).toMatchObject({ code: 'PERMISOS_INCONSISTENTES' });
    expect(usuario('interno@x.com').version).toBe(1);
  });

  test('EXTERNO + usuarios_admin por edicion: rechazado', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    expect(llamar('adminUsuarioActualizar', v1('externo@x.com', { permisos: ['perfil', 'usuarios_admin'] }))).toMatchObject({ code: 'TIPO_NO_PERMITE_PERMISO' });
  });
});

describe('ADMINISTRADORES: nunca 0 administradores efectivos', () => {
  const quitarAdmin = (email, extra) => llamar('adminUsuarioActualizar', v1(email, Object.assign({ permisos: ['perfil'], motivo: 'quita administrador' }, extra || {})));
  const admins = () => usuarios().filter((u) => global.usuariosDominio_esAdminEfectivo(u)).map((u) => u.email).sort();

  test('quitar usuarios_admin cuando quedan 2: permitido (con motivo); al ultimo: ULTIMO_ADMIN', () => {
    expect(quitarAdmin(ADMIN2)).toMatchObject({ status: 'ok' });
    expect(admins()).toEqual([ADMIN1]);
    const antes = snapshot();
    expect(quitarAdmin(ADMIN1)).toMatchObject({ status: 'error', code: 'ULTIMO_ADMIN' });
    expect(snapshot()).toBe(antes);
  });

  test('quitar usuarios_admin SIN motivo: MOTIVO_REQUERIDO', () => {
    expect(llamar('adminUsuarioActualizar', v1(ADMIN2, { permisos: ['perfil'] }))).toMatchObject({ code: 'MOTIVO_REQUERIDO' });
    expect(admins()).toEqual([ADMIN1, ADMIN2]);
  });

  test('desactivar a uno de varios administradores: permitido; al ultimo: ULTIMO_ADMIN', () => {
    expect(llamar('adminUsuarioDesactivar', v1(ADMIN2, { motivo: 'baja' }))).toMatchObject({ status: 'ok', data: { usuario: { estado: 'inactivo' } } });
    expect(llamar('adminUsuarioDesactivar', v1(ADMIN1, { motivo: 'baja' }))).toMatchObject({ code: 'ULTIMO_ADMIN' });
    expect(admins()).toEqual([ADMIN1]);
  });

  test('convertir al ULTIMO administrador a EXTERNO: rechazado (con y sin quitarle usuarios_admin)', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    llamar('adminUsuarioDesactivar', v1(ADMIN2, { motivo: 'baja' }));
    expect(llamar('adminUsuarioActualizar', v1(ADMIN1, { tipo: 'EXTERNO', motivo: 'x' }))).toMatchObject({ status: 'error' });
    expect(llamar('adminUsuarioActualizar', v1(ADMIN1, { tipo: 'EXTERNO', permisos: ['perfil'], motivo: 'x' }))).toMatchObject({ code: 'ULTIMO_ADMIN' });
    expect(admins()).toEqual([ADMIN1]);
  });

  test('cualquier combinacion equivalente tampoco deja 0 (desactivar + quitar admin a distintos usuarios en secuencia)', () => {
    expect(quitarAdmin(ADMIN2)).toMatchObject({ status: 'ok' });
    expect(llamar('adminUsuarioDesactivar', v1(ADMIN1, { motivo: 'baja' }))).toMatchObject({ code: 'ULTIMO_ADMIN' });
    expect(quitarAdmin(ADMIN1)).toMatchObject({ code: 'ULTIMO_ADMIN' });
    expect(admins()).toEqual([ADMIN1]);
  });

  test('un administrador puede degradarse a si mismo si queda otro', () => {
    expect(quitarAdmin(ADMIN1)).toMatchObject({ status: 'ok' });
    expect(admins()).toEqual([ADMIN2]);
  });

  test('el conteo NO sale del cliente: ni un campo "administradores" ni un "esAdmin" en el pedido tienen efecto (son campos no permitidos)', () => {
    expect(llamar('adminUsuarioDesactivar', v1(ADMIN1, { motivo: 'm', administradores: 99 }))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(llamar('adminUsuarioDesactivar', v1(ADMIN1, { motivo: 'm', esAdmin: false }))).toMatchObject({ code: 'INVALID_REQUEST' });
  });
});

describe('DESACTIVAR / REACTIVAR', () => {
  test('desactivar: inactivo, conserva fila, permisos, tipo y version + 1; motivo en el evento', () => {
    const permisos = usuario('interno@x.com').permisos;
    const r = llamar('adminUsuarioDesactivar', v1('interno@x.com', { motivo: 'se fue de la dependencia' }));
    expect(r).toMatchObject({ status: 'ok', data: { eventos: ['USUARIO_DESACTIVADO'], usuario: { estado: 'inactivo', version: 2 } } });
    expect(usuario('interno@x.com')).toMatchObject({ estado: 'inactivo', tipo: 'INTERNO', version: 2 });
    expect(usuario('interno@x.com').permisos).toEqual(permisos);
    expect(usuarios()).toHaveLength(5);
    expect(eventos()[0]).toMatchObject({ evento: 'USUARIO_DESACTIVADO', estadoAnterior: 'activo', estadoNuevo: 'inactivo', motivo: 'se fue de la dependencia', ejecutadoPor: ADMIN1 });
  });

  test('desactivar y reactivar EXIGEN motivo', () => {
    expect(llamar('adminUsuarioDesactivar', v1('interno@x.com', { motivo: undefined }))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(llamar('adminUsuarioDesactivar', v1('interno@x.com', { motivo: '   ' }))).toMatchObject({ code: 'MOTIVO_REQUERIDO' });
    expect(llamar('adminUsuarioReactivar', v1('baja@x.com', { motivo: '   ' }))).toMatchObject({ code: 'MOTIVO_REQUERIDO' });
    expect(usuario('interno@x.com').estado).toBe('activo');
  });

  test('ya inactivo / ya activo', () => {
    expect(llamar('adminUsuarioDesactivar', v1('baja@x.com', { motivo: 'm' }))).toMatchObject({ code: 'USUARIO_YA_INACTIVO' });
    expect(llamar('adminUsuarioReactivar', v1('interno@x.com', { motivo: 'm' }))).toMatchObject({ code: 'USUARIO_YA_ACTIVO' });
  });

  test('reactivar un INTERNO: vuelve a activo con los permisos que tenia', () => {
    const permisos = usuario('baja@x.com').permisos;
    expect(llamar('adminUsuarioReactivar', v1('baja@x.com', { motivo: 'vuelve' }))).toMatchObject({ status: 'ok', data: { eventos: ['USUARIO_REACTIVADO'], usuario: { estado: 'activo' } } });
    expect(usuario('baja@x.com').permisos).toEqual(permisos);
  });

  test('reactivar un EXTERNO: flag de externos apagado -> E10_GESTION_EXTERNOS_INACTIVA; encendido -> ok', () => {
    llamar('adminUsuarioDesactivar', v1('externo@x.com', { motivo: 'baja' }));            // desactivar un externo existente NO requiere el flag
    expect(usuario('externo@x.com').estado).toBe('inactivo');
    expect(llamar('adminUsuarioReactivar', v1('externo@x.com', { motivo: 'vuelve' }))).toMatchObject({ code: 'E10_GESTION_EXTERNOS_INACTIVA' });
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    expect(llamar('adminUsuarioReactivar', v1('externo@x.com', { motivo: 'vuelve' }))).toMatchObject({ status: 'ok', data: { usuario: { estado: 'activo' } } });
  });

  test('reactivar REVALIDA la consistencia completa (dependencias): un usuario dado de baja con permisos inconsistentes escritos a mano no se reactiva', () => {
    E.hojas.Usuarios.filas.forEach((f, i) => { if (i > 0 && f[0] === 'baja@x.com') { f[columna('perfil_validar')] = 'SI'; f[columna('perfil')] = 'NO'; } });
    expect(llamar('adminUsuarioReactivar', v1('baja@x.com', { motivo: 'vuelve' }))).toMatchObject({ status: 'error', code: 'PERMISOS_INCONSISTENTES' });
    expect(usuario('baja@x.com').estado).toBe('inactivo');
  });

  test('un EXTERNO ya existente conserva acceso con el flag de externos apagado (el flag no gobierna el login)', () => {
    expect(global.getUserAccess('externo@x.com')).toMatchObject({ active: true, tipo: 'EXTERNO' });
    expect(global.getUserAccess('externo@x.com').permisos.perfil).toBe(true);
  });
});

describe('AUDITORIA', () => {
  test('el actor es el de la SESION (no el del cuerpo) y cada mutacion genera su evento con secuencia correlativa', () => {
    llamar('adminUsuarioCrear', NUEVO(), ADMIN2);
    llamar('adminUsuarioActualizar', v1('nuevo@x.com', { nombre: 'Otro Nombre' }), ADMIN1);
    llamar('adminUsuarioDesactivar', v1('nuevo@x.com', { motivo: 'm' }), ADMIN2);
    llamar('adminUsuarioReactivar', v1('nuevo@x.com', { motivo: 'm' }), ADMIN1);
    const e = eventos();
    expect(e.map((x) => [x.secuencia, x.evento, x.ejecutadoPor])).toEqual([[1, 'USUARIO_CREADO', ADMIN2], [2, 'USUARIO_ACTUALIZADO', ADMIN1], [3, 'USUARIO_DESACTIVADO', ADMIN2], [4, 'USUARIO_REACTIVADO', ADMIN1]]);
    expect(e.map((x) => x.versionNueva)).toEqual([1, 2, 3, 4]);
    expect(e.every((x) => x.origen === 'APP' && x.usuarioObjetivo === 'nuevo@x.com' && /^req-/.test(x.clientRequestId))).toBe(true);
    expect(usuario('nuevo@x.com').actualizadoPor).toBe(ADMIN1);
  });

  test('ACTOR FALSIFICADO en el cuerpo: se rechaza el pedido entero y no se escribe nada', () => {
    const antes = snapshot();
    ['actor', 'ejecutadoPor', 'actorEmail', 'emailActor', 'ejecutor', 'actualizado_por', 'actualizadoPor', 'origen', 'timestampUtc', 'secuencia'].forEach((campo) => {
      expect(llamar('adminUsuarioCrear', NUEVO({ [campo]: ADMIN2 }), 'interno@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });            // un usuario normal no pasa la puerta
      expect(llamar('adminUsuarioCrear', NUEVO({ [campo]: ADMIN2 }))).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });             // y un admin no puede falsificar el actor
    });
    expect(snapshot()).toBe(antes);
  });

  test('si la auditoria falla al escribir: AUDITORIA_NO_DISPONIBLE y Usuarios REVIERTE (alta y edicion)', () => {
    const antes = snapshot();
    const original = E.hojas.UsuariosEventos.getRange.bind(E.hojas.UsuariosEventos);
    E.hojas.UsuariosEventos.getRange = (...a) => Object.assign(original(...a), { setValues: () => { throw new Error('hoja de eventos caida'); } });      // se lee bien, falla al ESCRIBIR
    expect(llamar('adminUsuarioCrear', NUEVO())).toMatchObject({ status: 'error', code: 'AUDITORIA_NO_DISPONIBLE', revertido: true });
    expect(snapshot()).toBe(antes);
    expect(usuario('nuevo@x.com')).toBeUndefined();
  });

  test('sin la hoja UsuariosEventos no se hace NINGUN cambio (fail-closed)', () => {
    delete E.hojas.UsuariosEventos;
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    expect(llamar('adminUsuarioActualizar', v1('interno@x.com', { nombre: 'X' }))).toMatchObject({ status: 'error', code: 'AUDITORIA_NO_DISPONIBLE' });
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antes);
  });

  test('el Historial registra la accion y el resultado SIN el email del usuario objetivo', () => {
    global.logHistoryEvent.mockClear();
    llamar('adminUsuarioCrear', NUEVO({ email: 'objetivo.secreto@x.com' }));
    llamar('adminUsuarioDesactivar', v1('objetivo.secreto@x.com', { motivo: 'm' }));
    const filas = global.logHistoryEvent.mock.calls;
    expect(filas.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(filas)).not.toMatch(/objetivo\.secreto/);
    expect(filas.map((c) => [c[1], c[3]])).toEqual(expect.arrayContaining([['adminUsuarioCrear', 'OK'], ['adminUsuarioDesactivar', 'OK']]));
  });

  test('un actor FALSIFICADO en el cuerpo no atribuye el Historial a otra persona: la fila de un pedido rechazado lleva el email de la SESION', () => {
    global.logHistoryEvent.mockClear();
    expect(llamar('adminUsuarioCrear', NUEVO({ emailActor: ADMIN2 }))).toMatchObject({ code: 'INVALID_REQUEST' });             // flag encendido: rechazado por la lista blanca
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    expect(llamar('adminUsuarioCrear', NUEVO({ emailActor: ADMIN2 }))).toMatchObject({ code: 'E10_ADMIN_INACTIVO' });          // flag apagado: rechazado antes de validar
    const filas = global.logHistoryEvent.mock.calls.filter((c) => c[1] === 'adminUsuarioCrear');
    expect(filas.map((c) => c[3])).toEqual(['INVALID_REQUEST', 'E10_ADMIN_INACTIVO']);
    expect(filas.every((c) => c[0] === ADMIN1)).toBe(true);
  });
});

describe('CACHE: invalidacion inmediata + tombstone', () => {
  test('desactivar: la SIGUIENTE request del afectado ya no tiene acceso (no hay 5 minutos de permisos viejos)', () => {
    expect(global.getUserAccess('interno@x.com')).toMatchObject({ active: true });            // cacheado
    expect(E.cache.claves()).toContain('user_access_v2_interno@x.com');
    llamar('adminUsuarioDesactivar', v1('interno@x.com', { motivo: 'baja' }));
    expect(global.getUserAccess('interno@x.com')).toMatchObject({ active: false });
    expect(llamar('adminUsuariosListar', {}, 'interno@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
  });

  test('cambiar permisos: efecto inmediato, y el tombstone impide que un recache obsoleto reviva el valor viejo', () => {
    global.getUserAccess('interno@x.com');
    llamar('adminUsuarioActualizar', v1('interno@x.com', { permisos: ['perfil'] }));
    expect(E.cache.claves()).toContain('user_access_inv_interno@x.com');                       // tombstone
    expect(global.getUserAccess('interno@x.com').permisos.datos).toBe(false);
    expect(E.cache.claves()).not.toContain('user_access_v2_interno@x.com');                    // con el tombstone vivo no se recachea
    E.cache.avanzar(16);
    global.getUserAccess('interno@x.com');
    expect(E.cache.claves()).toContain('user_access_v2_interno@x.com');
  });

  test('quitar usuarios_admin: el ex administrador pierde la puerta en la siguiente request', () => {
    llamar('adminUsuariosListar', {}, ADMIN2);
    llamar('adminUsuarioActualizar', v1(ADMIN2, { permisos: ['perfil'], motivo: 'quita admin' }));
    expect(llamar('adminUsuariosListar', {}, ADMIN2)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });
});

describe('IDEMPOTENCIA', () => {
  test('el mismo clientRequestId no duplica la alta ni el evento', () => {
    const p = NUEVO();
    expect(llamar('adminUsuarioCrear', p)).toMatchObject({ status: 'ok' });
    const r2 = llamar('adminUsuarioCrear', p);
    expect(r2).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(usuarios().filter((u) => u.email === 'nuevo@x.com')).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('el mismo clientRequestId reintentado en una edicion: la version sube UNA sola vez', () => {
    const p = v1('interno@x.com', { nombre: 'Una vez' });
    expect(llamar('adminUsuarioActualizar', p)).toMatchObject({ status: 'ok', data: { usuario: { version: 2 } } });
    expect(llamar('adminUsuarioActualizar', p)).toMatchObject({ status: 'ok', data: { duplicada: true, usuario: { version: 2 } } });
    expect(usuario('interno@x.com').version).toBe(2);
    expect(eventos()).toHaveLength(1);
  });

  test('un clientRequestId distinto con la version vieja es un conflicto, no una repeticion', () => {
    const p = v1('interno@x.com', { nombre: 'Primero' });
    llamar('adminUsuarioActualizar', p);
    expect(llamar('adminUsuarioActualizar', Object.assign({}, p, { clientRequestId: rid(), nombre: 'Segundo' }))).toMatchObject({ code: 'CONFLICT_VERSION' });
  });
});

describe('CAMPOS OBLIGATORIOS por endpoint', () => {
  const casos = [
    ['adminUsuarioCrear', () => NUEVO(), ['email', 'nombre', 'tipo', 'permisos', 'clientRequestId']],
    ['adminUsuarioActualizar', () => v1('interno@x.com', { nombre: 'X' }), ['email', 'versionEsperada', 'etag', 'clientRequestId']],
    ['adminUsuarioDesactivar', () => v1('interno@x.com', { motivo: 'm' }), ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId']],
    ['adminUsuarioReactivar', () => v1('baja@x.com', { motivo: 'm' }), ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId']],
    ['adminUsuarioObtener', () => ({ email: 'interno@x.com' }), ['email']]
  ];
  casos.forEach(([accion, cuerpo, obligatorios]) => {
    test.each(obligatorios)(accion + ': sin %s -> INVALID_REQUEST y nada cambia', (campo) => {
      const antes = snapshot();
      const p = cuerpo();
      delete p[campo];
      expect(llamar(accion, p)).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
      expect(snapshot()).toBe(antes);
    });
  });
});

describe('LISTA BLANCA estricta y tipos', () => {
  test.each([
    ['adminUsuariosListar', () => ({ email: 'a@x.com' })],
    ['adminPermisosCatalogo', () => ({ limite: 5 })],
    ['adminUsuarioObtener', () => ({ email: ADMIN1, nombre: 'x' })],
    ['adminUsuarioCrear', () => (NUEVO({ estado: 'inactivo' }))],
    ['adminUsuarioCrear', () => (NUEVO({ version: 7 }))],
    ['adminUsuarioCrear', () => (NUEVO({ fila: 3 }))],
    ['adminUsuarioCrear', () => (NUEVO({ usuarios_admin: true }))],
    ['adminUsuarioCrear', () => (NUEVO({ fecha_alta: '2020-01-01' }))],
    ['adminUsuarioActualizar', () => (Object.assign(v1('interno@x.com', { nombre: 'X' }), { estado: 'inactivo' }))],
    ['adminUsuarioActualizar', () => (Object.assign(v1('interno@x.com', { nombre: 'X' }), { permisosEfectivos: ['usuarios_admin'] }))],
    ['adminUsuarioDesactivar', () => (v1('interno@x.com', { motivo: 'm', accion: 'REACTIVAR' }))],
    ['adminUsuarioReactivar', () => (v1('baja@x.com', { motivo: 'm', estado: 'activo' }))]
  ])('%s con campos extra: INVALID_REQUEST y nada cambia', (accion, cuerpo) => {
    const antes = snapshot();
    expect(llamar(accion, cuerpo())).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(snapshot()).toBe(antes);
  });

  test.each([
    ['email', 123], ['nombre', ['x']], ['tipo', { a: 1 }], ['permisos', 'perfil'], ['permisos', [1, 2]], ['permisos', [{ id: 'perfil' }]], ['clientRequestId', 12], ['motivo', 5]
  ])('tipo invalido en %s: %j', (campo, valor) => {
    expect(llamar('adminUsuarioCrear', NUEVO({ [campo]: valor }))).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(usuarios()).toHaveLength(5);
  });

  test('versionEsperada invalida (texto, negativa, decimal, NaN)', () => {
    ['1', -1, 1.5, null].forEach((v) => {
      const r = llamar('adminUsuarioActualizar', Object.assign(v1('interno@x.com', { nombre: 'X' }), { versionEsperada: v }));
      expect(r).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    });
  });

  test('permisos: demasiados elementos se rechazan', () => {
    expect(llamar('adminUsuarioCrear', NUEVO({ permisos: new Array(101).fill('perfil') }))).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  test('un cuerpo que no es un objeto no rompe', () => {
    const r = Api.doPost({ postData: { contents: JSON.stringify([1, 2, 3]) } });
    expect(JSON.parse(r.getContent())).toMatchObject({ status: 'error' });
  });

  test('los emails se normalizan (espacios y mayusculas) y el duplicado se detecta sobre el normalizado', () => {
    llamar('adminUsuarioCrear', NUEVO({ email: '  NUEVO@x.COM ' }));
    expect(llamar('adminUsuarioCrear', NUEVO({ email: 'nuevo@x.com' }))).toMatchObject({ code: 'USUARIO_EXISTE' });
    expect(usuario('nuevo@x.com')).toBeDefined();
  });
});

describe('E10-2 no cambia lo que los usuarios actuales pueden hacer', () => {
  test('los permisos de login/checkSession de los usuarios existentes son los de la hoja (el tipo no concede ni quita)', () => {
    const ext = global.getUserAccess('externo@x.com');
    expect(ext.permisos).toEqual(expect.objectContaining({ perfil: true, perfil_subir: true, ubicacion: true, mapa: true, datos: false, usuarios_admin: false }));
    expect(global.getUserAccess('interno@x.com').permisos).toEqual(expect.objectContaining({ perfil: true, datos: true, ubicacion: true, mapa: true, usuarios_admin: false }));
  });
});
