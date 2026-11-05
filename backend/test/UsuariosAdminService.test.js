// E10-1: operaciones administrativas de usuarios (infraestructura de E10-2; ningun endpoint las llama todavia). Modulos REALES + hojas en memoria: alta, edicion, baja logica, reactivacion, version +
// etag (concurrencia), ULTIMO ADMIN, EXTERNO + usuarios_admin, auditoria con rollback, flags, idempotencia e invalidacion inmediata del cache.
const { crearEntornoE10, ACTOR, ADMIN1, ADMIN2 } = require('./e10Entorno');

let E;
const ON = { E10_ADMIN_USUARIOS_ACTIVO: 'SI' };
const encender = (extra) => { Object.assign(global.__propiedades, ON, extra || {}); };
const crear = (extra, actor) => E.Servicio.usuariosAdmin_crear(actor === undefined ? ACTOR : actor, Object.assign({ email: 'nuevo@x.com', nombre: 'Nuevo Usuario', tipo: 'INTERNO', permisos: ['perfil', 'datos'] }, extra || {}));
const actualizar = (extra, actor) => E.Servicio.usuariosAdmin_actualizar(actor === undefined ? ACTOR : actor, Object.assign({ email: 'interno@x.com', versionEsperada: 1 }, extra || {}));
const estado = (accion, extra, actor) => E.Servicio.usuariosAdmin_cambiarEstado(actor === undefined ? ACTOR : actor, Object.assign({ email: 'interno@x.com', versionEsperada: 1, accion }, extra || {}));
const usuarios = () => global.sheetUserRepository_leerUsuarios();
const usuario = (email) => usuarios().find((u) => u.email === email);
const eventos = () => global.usuariosEventosRepository_leer(global.usuariosEventosRepository_abrir());
const snapshot = () => JSON.stringify({ u: E.hojas.Usuarios.filas, e: E.hojas.UsuariosEventos ? E.hojas.UsuariosEventos.filas : null });
const columna = (nombre) => E.hojas.Usuarios.filas[0].indexOf(nombre);

beforeEach(() => { E = crearEntornoE10(); encender(); });

describe('flag E10_ADMIN_USUARIOS_ACTIVO', () => {
  test.each([[undefined], ['NO'], [''], ['si'], ['true'], [' SI']])('apagado (%j): E10_ADMIN_INACTIVO ANTES de abrir ninguna hoja ni tomar el lock', (valor) => {
    delete global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO;
    if (valor !== undefined) { global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO = valor; }
    const antes = snapshot();
    const abrir = jest.spyOn(global.SpreadsheetApp, 'openById');
    const lock = jest.spyOn(global.LockService, 'getScriptLock');
    expect(crear()).toMatchObject({ ok: false, codigo: 'E10_ADMIN_INACTIVO' });
    expect(actualizar()).toMatchObject({ ok: false, codigo: 'E10_ADMIN_INACTIVO' });
    expect(estado('DESACTIVAR')).toMatchObject({ ok: false, codigo: 'E10_ADMIN_INACTIVO' });
    expect(abrir).not.toHaveBeenCalled();
    expect(lock).not.toHaveBeenCalled();
    expect(snapshot()).toBe(antes);
  });
});

describe('el actor: administrador EFECTIVO segun la hoja fresca', () => {
  test.each([
    ['un INTERNO sin usuarios_admin', { email: 'interno@x.com', nombre: 'I' }],
    ['un EXTERNO (aunque la hoja diga usuarios_admin = SI)', { email: 'externo@x.com', nombre: 'E' }],
    ['un administrador INACTIVO', { email: 'baja@x.com', nombre: 'B' }],
    ['alguien que no existe', { email: 'fantasma@x.com', nombre: 'F' }],
    ['un actor sin email valido', { email: 'no-es-email', nombre: 'X' }],
    ['sin actor', null]
  ])('%s -> PERMISSION_DENIED y no se escribe nada', (_n, actor) => {
    if (actor && actor.email === 'externo@x.com') {
      E.hojas.Usuarios.filas[4][columna('usuarios_admin')] = 'SI';          // el EXTERNO con usuarios_admin = SI escrito a mano
    }
    if (actor && actor.email === 'baja@x.com') {
      E.hojas.Usuarios.filas[5][columna('usuarios_admin')] = 'SI';
    }
    const antes = snapshot();
    expect(crear({}, actor)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
    expect(actualizar({}, actor)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
    expect(estado('DESACTIVAR', {}, actor)).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
    expect(snapshot()).toBe(antes);
  });

  test('el actor se toma de la hoja fresca, no del cache: un administrador degradado hace un instante ya no puede operar', () => {
    global.getUserAccess(ADMIN2);                                                      // cacheado como administrador
    E.hojas.Usuarios.filas[2][columna('usuarios_admin')] = 'NO';                       // degradado a mano (el cache aun lo cree admin)
    expect(global.hasPermission(ADMIN2, 'usuarios_admin')).toBe(true);
    expect(crear({}, { email: ADMIN2, nombre: 'Admin Dos' })).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });
  });
});

describe('alta', () => {
  test('crea el usuario activo, version 1, con permisos SI/NO explicitos, y deja el evento USUARIO_CREADO', () => {
    const r = crear({ permisos: ['perfil', 'perfil_subir', 'mapa'] });
    expect(r).toMatchObject({ ok: true, eventos: ['USUARIO_CREADO'], usuario: { email: 'nuevo@x.com', estado: 'activo', tipo: 'INTERNO', version: 1, permisos: ['perfil', 'perfil_subir', 'mapa'] } });
    const u = usuario('nuevo@x.com');
    expect(u).toMatchObject({ nombre: 'Nuevo Usuario', estado: 'activo', tipo: 'INTERNO', version: 1 });
    const fila = E.hojas.Usuarios.filas[E.hojas.Usuarios.filas.length - 1];
    expect(fila[columna('perfil')]).toBe('SI');
    expect(fila[columna('datos')]).toBe('NO');                                        // NO explicito, nunca vacio
    expect(fila[columna('actualizado_por')]).toBe(ADMIN1);
    expect(fila[columna('actualizado_utc')]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fila[columna('fecha_alta')]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const ev = eventos();
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ evento: 'USUARIO_CREADO', usuarioObjetivo: 'nuevo@x.com', nombreObjetivo: 'Nuevo Usuario', ejecutadoPor: ADMIN1, tipoNuevo: 'INTERNO', estadoNuevo: 'activo', versionAnterior: 0, versionNueva: 1, permisosAntes: '', permisosDespues: 'perfil,perfil_subir,mapa', origen: 'APP', secuencia: 1 });
  });

  test('el email se normaliza (minusculas, espacios) y no se puede duplicar: ni activo ni inactivo', () => {
    expect(crear({ email: '  Nuevo@X.COM ' }).ok).toBe(true);
    expect(usuario('nuevo@x.com')).toBeDefined();
    expect(crear({ email: 'nuevo@x.com' })).toMatchObject({ ok: false, codigo: 'USUARIO_EXISTE' });
    expect(crear({ email: 'baja@x.com' })).toMatchObject({ ok: false, codigo: 'USUARIO_EXISTE' });          // inactivo: se reactiva, no se reutiliza en silencio
    expect(usuarios().filter((u) => u.email === 'nuevo@x.com')).toHaveLength(1);
  });

  test.each([
    ['email invalido', { email: 'sin-arroba' }, 'EMAIL_INVALIDO'],
    ['nombre vacio', { nombre: '   ' }, 'NOMBRE_INVALIDO'],
    ['tipo invalido', { tipo: 'ADMIN' }, 'TIPO_INVALIDO'],
    ['tipo ausente', { tipo: undefined }, 'TIPO_INVALIDO'],
    ['permiso inexistente', { permisos: ['perfil', 'inventado'] }, 'PERMISO_DESCONOCIDO'],
    ['permisos que no son una lista', { permisos: 'perfil' }, 'INVALID_REQUEST'],
    ['dependencia faltante', { permisos: ['perfil_subir'] }, 'PERMISOS_INCONSISTENTES'],
    ['clientRequestId invalido', { clientRequestId: 'con espacios!' }, 'INVALID_REQUEST']
  ])('alta con %s -> %s y no escribe nada', (_n, extra, codigo) => {
    const antes = snapshot();
    expect(crear(extra)).toMatchObject({ ok: false, codigo });
    expect(snapshot()).toBe(antes);
  });

  test('EXTERNO + usuarios_admin se rechaza SIEMPRE por el backend', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    const antes = snapshot();
    expect(crear({ tipo: 'EXTERNO', permisos: ['perfil', 'usuarios_admin'] })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(snapshot()).toBe(antes);
  });

  test('un INTERNO con usuarios_admin se puede crear (segundo administrador)', () => {
    expect(crear({ permisos: ['perfil', 'usuarios_admin'] }).ok).toBe(true);
    expect(global.hasPermission('nuevo@x.com', 'usuarios_admin')).toBe(true);
  });

  test('E10_GESTION_EXTERNOS_ACTIVO apagado: no se pueden dar de alta externos nuevos; encendido si, sin ningun permiso especial', () => {
    expect(crear({ tipo: 'EXTERNO', permisos: ['perfil'] })).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
    expect(usuario('nuevo@x.com')).toBeUndefined();
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    const r = crear({ tipo: 'EXTERNO', permisos: ['perfil'] });
    expect(r).toMatchObject({ ok: true, usuario: { tipo: 'EXTERNO', permisos: ['perfil'] } });
  });

  test('el motivo se acota a 200 caracteres y queda en el evento', () => {
    crear({ motivo: 'x'.repeat(500) });
    expect(eventos()[0].motivo).toHaveLength(200);
  });
});

describe('edicion', () => {
  test('cambiar permisos -> PERMISOS_MODIFICADOS, version + 1, antes/despues en el evento; lo demas no cambia', () => {
    const r = actualizar({ permisos: ['perfil', 'datos', 'ubicacion', 'fotos'] });
    expect(r).toMatchObject({ ok: true, eventos: ['PERMISOS_MODIFICADOS'], usuario: { version: 2, permisos: ['perfil', 'datos', 'ubicacion', 'fotos'] } });
    expect(usuario('interno@x.com')).toMatchObject({ nombre: 'Interno Consulta', tipo: 'INTERNO', estado: 'activo', version: 2 });
    const e = eventos()[0];
    expect(e).toMatchObject({ evento: 'PERMISOS_MODIFICADOS', versionAnterior: 1, versionNueva: 2, permisosAntes: 'perfil,datos,ubicacion,mapa', permisosDespues: 'perfil,datos,ubicacion,fotos', ejecutadoPor: ADMIN1 });
  });

  test('cambiar nombre y tipo -> USUARIO_EDITADO; nombre y permisos a la vez -> DOS eventos con las mismas versiones', () => {
    expect(actualizar({ nombre: 'Interno Renombrado' }).eventos).toEqual(['USUARIO_EDITADO']);
    const r = actualizar({ versionEsperada: 2, nombre: 'Otro Nombre', permisos: ['perfil'] });
    expect(r.eventos).toEqual(['USUARIO_EDITADO', 'PERMISOS_MODIFICADOS']);
    const ev = eventos();
    expect(ev.map((e) => e.evento)).toEqual(['USUARIO_EDITADO', 'USUARIO_EDITADO', 'PERMISOS_MODIFICADOS']);
    expect(ev[1]).toMatchObject({ nombreAnterior: 'Interno Renombrado', nombreObjetivo: 'Otro Nombre', versionAnterior: 2, versionNueva: 3 });
    expect(ev[2]).toMatchObject({ versionAnterior: 2, versionNueva: 3 });
    expect(ev.map((e) => e.secuencia)).toEqual([1, 2, 3]);
  });

  test('un INTERNO pasado a EXTERNO conserva EXACTAMENTE sus permisos (el tipo no concede ni quita) y requiere E10_GESTION_EXTERNOS_ACTIVO', () => {
    expect(actualizar({ tipo: 'EXTERNO' })).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    const antes = usuario('interno@x.com').permisos;
    const r = actualizar({ tipo: 'EXTERNO' });
    expect(r).toMatchObject({ ok: true, eventos: ['USUARIO_EDITADO'], usuario: { tipo: 'EXTERNO' } });
    expect(usuario('interno@x.com').permisos).toEqual(antes);
  });

  test('sin cambios reales: sinCambios, sin evento y sin subir la version', () => {
    const antes = snapshot();
    expect(actualizar({ nombre: 'Interno Consulta' })).toMatchObject({ ok: true, sinCambios: true });
    expect(actualizar({ permisos: ['perfil', 'datos', 'ubicacion', 'mapa'] })).toMatchObject({ ok: true, sinCambios: true });
    expect(snapshot()).toBe(antes);
  });

  test('el email NUNCA cambia: un campo email distinto en el cuerpo no tiene efecto (el usuario se ubica por email)', () => {
    actualizar({ nombre: 'Nuevo', emailNuevo: 'otro@x.com', email2: 'otro@x.com' });
    expect(usuarios().map((u) => u.email)).toEqual([ADMIN1, ADMIN2, 'interno@x.com', 'externo@x.com', 'baja@x.com']);
  });

  test('usuario inexistente -> USUARIO_NO_ENCONTRADO; sin versionEsperada -> INVALID_REQUEST', () => {
    expect(actualizar({ email: 'nadie@x.com' })).toMatchObject({ ok: false, codigo: 'USUARIO_NO_ENCONTRADO' });
    expect(actualizar({ versionEsperada: undefined })).toMatchObject({ ok: false, codigo: 'INVALID_REQUEST' });
    expect(actualizar({ versionEsperada: '1' })).toMatchObject({ ok: false, codigo: 'INVALID_REQUEST' });
    expect(actualizar({ versionEsperada: 1.5 })).toMatchObject({ ok: false, codigo: 'INVALID_REQUEST' });
  });

  test('una combinacion historica inconsistente (fotos_moderar sin fotos) permite editar el nombre; tocar los permisos exige coherencia', () => {
    E.hojas.Usuarios.filas[3][columna('fotos_moderar')] = 'SI';
    expect(actualizar({ nombre: 'Solo Nombre' }).ok).toBe(true);
    expect(actualizar({ versionEsperada: 2, permisos: ['perfil', 'fotos_moderar'] })).toMatchObject({ ok: false, codigo: 'PERMISOS_INCONSISTENTES' });
  });
});

describe('baja logica y reactivacion (NUNCA se borra una fila)', () => {
  test('desactivar: estado inactivo, permisos intactos, version + 1, USUARIO_DESACTIVADO; la cantidad de filas no cambia', () => {
    const filas = E.hojas.Usuarios.filas.length;
    const r = estado('DESACTIVAR');
    expect(r).toMatchObject({ ok: true, eventos: ['USUARIO_DESACTIVADO'], usuario: { estado: 'inactivo', version: 2 } });
    expect(E.hojas.Usuarios.filas).toHaveLength(filas);
    expect(usuario('interno@x.com')).toMatchObject({ estado: 'inactivo', version: 2 });
    expect(global.permisosCatalogo_aLista(usuario('interno@x.com').permisos)).toEqual(['perfil', 'datos', 'ubicacion', 'mapa']);
    expect(eventos()[0]).toMatchObject({ evento: 'USUARIO_DESACTIVADO', estadoAnterior: 'activo', estadoNuevo: 'inactivo' });
  });

  test('reactivar vuelve a activo con los permisos que tenia; el evento es USUARIO_REACTIVADO', () => {
    estado('DESACTIVAR');
    const r = estado('REACTIVAR', { versionEsperada: 2 });
    expect(r).toMatchObject({ ok: true, eventos: ['USUARIO_REACTIVADO'], usuario: { estado: 'activo', version: 3 } });
    expect(eventos().map((e) => e.evento)).toEqual(['USUARIO_DESACTIVADO', 'USUARIO_REACTIVADO']);
  });

  test('reactivar a un usuario ya inactivo de la hoja (baja manual)', () => {
    expect(estado('REACTIVAR', { email: 'baja@x.com', versionEsperada: 1 })).toMatchObject({ ok: true, usuario: { estado: 'activo' } });
  });

  test('desactivar a quien ya esta inactivo: sin cambios', () => {
    expect(estado('DESACTIVAR', { email: 'baja@x.com' })).toMatchObject({ ok: true, sinCambios: true });
  });

  test('accion invalida -> INVALID_REQUEST', () => {
    expect(estado('BORRAR')).toMatchObject({ ok: false, codigo: 'INVALID_REQUEST' });
    expect(estado(undefined)).toMatchObject({ ok: false, codigo: 'INVALID_REQUEST' });
  });

  test('reactivar a un EXTERNO es un alta de externo: requiere E10_GESTION_EXTERNOS_ACTIVO', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    estado('DESACTIVAR', { email: 'externo@x.com' });
    delete global.__propiedades.E10_GESTION_EXTERNOS_ACTIVO;
    expect(estado('REACTIVAR', { email: 'externo@x.com', versionEsperada: 2 })).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
    expect(usuario('externo@x.com').estado).toBe('inactivo');
  });

  test('desactivar a un EXTERNO ya existente NO requiere el flag de externos (el flag gobierna solo las altas nuevas)', () => {
    expect(estado('DESACTIVAR', { email: 'externo@x.com' })).toMatchObject({ ok: true, usuario: { estado: 'inactivo' } });
  });
});

describe('ULTIMO ADMIN: nunca 0 administradores efectivos (activo + INTERNO + usuarios_admin)', () => {
  const admins = () => usuarios().filter((u) => global.usuariosDominio_esAdminEfectivo(u)).map((u) => u.email);
  const quitarAdmin = (email, v) => E.Servicio.usuariosAdmin_actualizar({ email: ADMIN1, nombre: 'A' }, { email, versionEsperada: v === undefined ? 1 : v, permisos: ['perfil'] });

  test('con dos administradores se puede desactivar uno; el ultimo NO', () => {
    expect(E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN1, nombre: 'A' }, { email: ADMIN2, versionEsperada: 1, accion: 'DESACTIVAR' }).ok).toBe(true);
    expect(admins()).toEqual([ADMIN1]);
    const antes = snapshot();
    expect(E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN1, nombre: 'A' }, { email: ADMIN1, versionEsperada: 1, accion: 'DESACTIVAR' })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(snapshot()).toBe(antes);
    expect(admins()).toEqual([ADMIN1]);
  });

  test('quitar usuarios_admin al ultimo se rechaza', () => {
    E.Servicio.usuariosAdmin_cambiarEstado(ACTOR, { email: ADMIN2, versionEsperada: 1, accion: 'DESACTIVAR' });
    const antes = snapshot();
    expect(quitarAdmin(ADMIN1)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(snapshot()).toBe(antes);
  });

  test('cambiar el tipo del ultimo a EXTERNO se rechaza (con y sin quitarle usuarios_admin)', () => {
    encender({ E10_GESTION_EXTERNOS_ACTIVO: 'SI' });
    E.Servicio.usuariosAdmin_cambiarEstado(ACTOR, { email: ADMIN2, versionEsperada: 1, accion: 'DESACTIVAR' });
    const antes = snapshot();
    expect(E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: ADMIN1, versionEsperada: 1, tipo: 'EXTERNO' })).toMatchObject({ ok: false });           // regla dura: EXTERNO + usuarios_admin
    expect(E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: ADMIN1, versionEsperada: 1, tipo: 'EXTERNO', permisos: ['perfil'] })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    expect(snapshot()).toBe(antes);
  });

  test('un administrador inactivo o un EXTERNO con usuarios_admin escrito a mano NO cuentan como ultimo respaldo', () => {
    E.hojas.Usuarios.filas[4][columna('usuarios_admin')] = 'SI';          // externo@x.com con usuarios_admin = SI
    E.Servicio.usuariosAdmin_cambiarEstado(ACTOR, { email: ADMIN2, versionEsperada: 1, accion: 'DESACTIVAR' });
    expect(admins()).toEqual([ADMIN1]);
    expect(E.Servicio.usuariosAdmin_cambiarEstado(ACTOR, { email: ADMIN1, versionEsperada: 1, accion: 'DESACTIVAR' })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
  });

  test('un administrador puede degradarse a si mismo si queda otro; y puede promover a un tercero', () => {
    expect(E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'interno@x.com', versionEsperada: 1, permisos: ['perfil', 'usuarios_admin'] }).ok).toBe(true);
    expect(admins()).toEqual([ADMIN1, ADMIN2, 'interno@x.com']);
    expect(quitarAdmin(ADMIN1).ok).toBe(true);
    expect(admins()).toEqual([ADMIN2, 'interno@x.com']);
  });

  test('dos administradores que se desactivan mutuamente: el segundo falla (el lock los serializa y se cuenta sobre la hoja fresca)', () => {
    const a = E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN1, nombre: 'A' }, { email: ADMIN2, versionEsperada: 1, accion: 'DESACTIVAR' });
    const b = E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN2, nombre: 'B' }, { email: ADMIN1, versionEsperada: 1, accion: 'DESACTIVAR' });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, codigo: 'PERMISSION_DENIED' });          // ADMIN2 ya no es administrador efectivo cuando le toca
    expect(admins()).toEqual([ADMIN1]);
  });

  test('ninguna secuencia de operaciones puede dejar 0 administradores efectivos', () => {
    const intentos = [
      () => E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN1, nombre: 'A' }, { email: ADMIN1, versionEsperada: usuario(ADMIN1).version, accion: 'DESACTIVAR' }),
      () => E.Servicio.usuariosAdmin_cambiarEstado({ email: ADMIN1, nombre: 'A' }, { email: ADMIN2, versionEsperada: usuario(ADMIN2).version, accion: 'DESACTIVAR' }),
      () => E.Servicio.usuariosAdmin_actualizar({ email: ADMIN1, nombre: 'A' }, { email: ADMIN1, versionEsperada: usuario(ADMIN1).version, permisos: ['perfil'] }),
      () => E.Servicio.usuariosAdmin_actualizar({ email: ADMIN1, nombre: 'A' }, { email: ADMIN2, versionEsperada: usuario(ADMIN2).version, permisos: [] })
    ];
    intentos.forEach((f) => { f(); expect(admins().length).toBeGreaterThanOrEqual(1); });
  });
});

describe('concurrencia: version + etag, nunca se sobrescribe en silencio', () => {
  test('el segundo administrador que guarda desde la version N cuando ya esta en N+1 recibe CONFLICT_VERSION con el estado actual', () => {
    expect(actualizar({ versionEsperada: 1, permisos: ['perfil'] }).ok).toBe(true);                   // admin A: 1 -> 2
    const antes = snapshot();
    const r = E.Servicio.usuariosAdmin_actualizar({ email: ADMIN2, nombre: 'B' }, { email: 'interno@x.com', versionEsperada: 1, permisos: ['perfil', 'datos', 'fotos'] });     // admin B abrio en la 1
    expect(r).toMatchObject({ ok: false, codigo: 'CONFLICT_VERSION', actual: { version: 2, permisos: ['perfil'] } });
    expect(r.actual.etag).toMatch(/^[0-9a-f]{16}$/);
    expect(snapshot()).toBe(antes);
    expect(global.permisosCatalogo_aLista(usuario('interno@x.com').permisos)).toEqual(['perfil']);
  });

  test('despues de recargar (version y etag actuales) el guardado funciona', () => {
    actualizar({ versionEsperada: 1, permisos: ['perfil'] });
    const conflicto = E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'interno@x.com', versionEsperada: 1, permisos: ['perfil', 'datos'] });
    const r = E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'interno@x.com', versionEsperada: conflicto.actual.version, etag: conflicto.actual.etag, permisos: ['perfil', 'datos'] });
    expect(r).toMatchObject({ ok: true, usuario: { version: 3 } });
  });

  test('una EDICION MANUAL de la hoja (que no sube la version) se detecta por el etag', () => {
    const v = E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'interno@x.com', versionEsperada: 1, permisos: ['perfil', 'datos', 'ubicacion', 'mapa'] });
    const etagAbierto = v.usuario.etag;
    E.hojas.Usuarios.filas[3][columna('ne')] = 'SI';                                                  // alguien edita la hoja a mano: version sigue siendo 1... 2
    const r = E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'interno@x.com', versionEsperada: 1, etag: etagAbierto, permisos: ['perfil'] });
    expect(r).toMatchObject({ ok: false, codigo: 'CONFLICT_VERSION' });
  });

  test('etag que coincide + version que coincide: pasa', () => {
    const abierto = usuario('interno@x.com');
    const etag = global.usuariosDominio_etag(abierto);
    expect(actualizar({ versionEsperada: abierto.version, etag, nombre: 'Con Etag' }).ok).toBe(true);
  });

  test('no se pierde ningun cambio: dos ediciones secuenciales de campos distintos terminan en la version 3 con ambos cambios', () => {
    actualizar({ versionEsperada: 1, nombre: 'Primero' });
    actualizar({ versionEsperada: 2, permisos: ['perfil'] });
    expect(usuario('interno@x.com')).toMatchObject({ nombre: 'Primero', version: 3 });
    expect(global.permisosCatalogo_aLista(usuario('interno@x.com').permisos)).toEqual(['perfil']);
  });

  test('el script lock se toma en CADA operacion y se libera siempre, tambien si la operacion falla', () => {
    const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
    global.LockService = { getScriptLock: () => lock };
    crear();
    actualizar({ versionEsperada: 99 });                                         // conflicto
    estado('DESACTIVAR', { email: 'nadie@x.com' });                              // usuario inexistente
    expect(lock.waitLock).toHaveBeenCalledTimes(3);
    expect(lock.releaseLock).toHaveBeenCalledTimes(3);
  });

  test('si no se obtiene el lock: SERVICE_UNAVAILABLE y no se escribe nada', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout'); }, releaseLock: jest.fn() }) };
    const antes = snapshot();
    expect(crear()).toMatchObject({ ok: false, codigo: 'SERVICE_UNAVAILABLE' });
    expect(snapshot()).toBe(antes);
  });

  test('se vuelve a leer la hoja DENTRO del lock (no se opera sobre una lectura previa)', () => {
    let leidas = 0;
    const original = global.sheetUserRepository_leerUsuarios;
    global.sheetUserRepository_leerUsuarios = (...a) => { leidas += 1; return original(...a); };
    crear();
    expect(leidas).toBe(1);
    global.sheetUserRepository_leerUsuarios = original;
  });
});

describe('auditoria obligatoria: sin UsuariosEventos no hay cambio, y si falla se REVIERTE', () => {
  test('sin la hoja UsuariosEventos: AUDITORIA_NO_DISPONIBLE ANTES de escribir Usuarios', () => {
    E = crearEntornoE10({ eventos: false });
    encender();
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    expect(crear()).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE' });
    expect(actualizar()).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE' });
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antes);
  });

  test('UsuariosEventos con esquema inesperado: AUDITORIA_NO_DISPONIBLE y Usuarios intacta', () => {
    E.hojas.UsuariosEventos.filas = [['otra', 'cosa']];
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    expect(estado('DESACTIVAR')).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE' });
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antes);
  });

  test('Usuarios sin una columna de E10 (esquema incompleto): USUARIOS_ESQUEMA_INCOMPLETO y no se escribe nada', () => {
    const idx = columna('version');
    E.hojas.Usuarios.filas.forEach((f) => f.splice(idx, 1));
    const antes = snapshot();
    expect(crear()).toMatchObject({ ok: false, codigo: 'USUARIOS_ESQUEMA_INCOMPLETO' });
    expect(snapshot()).toBe(antes);
  });

  test('sin la hoja Usuarios: USUARIOS_NO_EXISTE', () => {
    delete E.hojas.Usuarios;
    expect(crear()).toMatchObject({ ok: false, codigo: 'USUARIOS_NO_EXISTE' });
  });

  function fallarAuditoria(hojaEventos) {
    const original = hojaEventos.getRange.bind(hojaEventos);
    hojaEventos.getRange = (fila, ...resto) => {
      const r = original(fila, ...resto);
      if (fila > 1) { r.setValues = () => { throw new Error('Sheets caido al escribir el evento'); }; }
      return r;
    };
  }

  test('EDICION: si el evento no se puede escribir, la fila de Usuarios vuelve EXACTAMENTE a como estaba (rollback)', () => {
    fallarAuditoria(E.hojas.UsuariosEventos);
    const antesUsuarios = JSON.stringify(E.hojas.Usuarios.filas);
    const r = actualizar({ permisos: ['perfil', 'fotos'] });
    expect(r).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE', revertido: true });
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antesUsuarios);
    expect(E.hojas.UsuariosEventos.filas).toHaveLength(1);
  });

  test('BAJA: rollback igual (el usuario sigue activo, version intacta)', () => {
    fallarAuditoria(E.hojas.UsuariosEventos);
    expect(estado('DESACTIVAR')).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE', revertido: true });
    expect(usuario('interno@x.com')).toMatchObject({ estado: 'activo', version: 1 });
  });

  test('ALTA: si la auditoria falla se quita la fila recien agregada (nunca queda un usuario sin rastro)', () => {
    fallarAuditoria(E.hojas.UsuariosEventos);
    const filas = E.hojas.Usuarios.filas.length;
    expect(crear()).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE', revertido: true });
    expect(E.hojas.Usuarios.filas).toHaveLength(filas);
    expect(usuario('nuevo@x.com')).toBeUndefined();
  });

  test('tras un rollback el cache del usuario se invalida (no queda ningun valor intermedio)', () => {
    global.getUserAccess('interno@x.com');
    fallarAuditoria(E.hojas.UsuariosEventos);
    actualizar({ permisos: ['perfil'] });
    expect(E.cache.get('user_access_v2_interno@x.com')).toBeNull();
    expect(global.hasPermission('interno@x.com', 'datos')).toBe(true);                                // sigue con sus permisos reales
  });

  test('si TAMBIEN falla la reversion se informa revertido:false y se deja constancia en el log', () => {
    fallarAuditoria(E.hojas.UsuariosEventos);
    const original = global.sheetUserRepository_restaurarFila;
    global.sheetUserRepository_restaurarFila = () => { throw new Error('no se pudo restaurar'); };
    const r = actualizar({ permisos: ['perfil'] });
    expect(r).toMatchObject({ ok: false, codigo: 'AUDITORIA_NO_DISPONIBLE', revertido: false });
    expect(global.Logger.log.mock.calls.some((c) => /reversion FALLIDA/.test(String(c[0])))).toBe(true);
    global.sheetUserRepository_restaurarFila = original;
  });

  test('si falla la escritura de la fila de Usuarios: SERVICE_UNAVAILABLE y no queda un evento huerfano', () => {
    const original = global.sheetUserRepository_escribirFila;
    global.sheetUserRepository_escribirFila = () => { throw new Error('Sheets caido'); };
    expect(actualizar({ permisos: ['perfil'] })).toMatchObject({ ok: false, codigo: 'SERVICE_UNAVAILABLE' });
    expect(E.hojas.UsuariosEventos.filas).toHaveLength(1);
    global.sheetUserRepository_escribirFila = original;
  });

  test('el evento lleva al ejecutor de la SESION, nunca un email del cuerpo; y ningun dato sensible', () => {
    actualizar({ permisos: ['perfil'], ejecutadoPor: 'atacante@x.com', actor: 'atacante@x.com' });
    const e = eventos()[0];
    expect(e.ejecutadoPor).toBe(ADMIN1);
    expect(JSON.stringify(E.hojas.UsuariosEventos.filas)).not.toMatch(/atacante|token|secret|password/i);
  });
});

describe('invalidacion inmediata del cache tras cada cambio administrativo', () => {
  test('quitar un permiso es efectivo en la SIGUIENTE request (aunque el usuario estuviera cacheado)', () => {
    expect(global.hasPermission('interno@x.com', 'datos')).toBe(true);
    actualizar({ permisos: ['perfil', 'ubicacion', 'mapa'] });
    expect(global.hasPermission('interno@x.com', 'datos')).toBe(false);
    expect(global.hasPermission('interno@x.com', 'perfil')).toBe(true);
  });

  test('agregar un permiso tambien', () => {
    expect(global.hasPermission('interno@x.com', 'fotos')).toBe(false);
    actualizar({ permisos: ['perfil', 'datos', 'ubicacion', 'mapa', 'fotos'] });
    expect(global.hasPermission('interno@x.com', 'fotos')).toBe(true);
  });

  test('la baja es efectiva en la siguiente request y la reactivacion tambien', () => {
    expect(global.isUserActive('interno@x.com')).toBe(true);
    estado('DESACTIVAR');
    expect(global.isUserActive('interno@x.com')).toBe(false);
    estado('REACTIVAR', { versionEsperada: 2 });
    expect(global.isUserActive('interno@x.com')).toBe(true);
  });

  test('un alta nueva es efectiva de inmediato (login del nuevo usuario)', () => {
    expect(global.isUserActive('nuevo@x.com')).toBe(false);
    crear();
    expect(global.isUserActive('nuevo@x.com')).toBe(true);
  });

  test('queda el tombstone: una request en vuelo no puede volver a cachear el valor viejo', () => {
    global.getUserAccess('interno@x.com');
    actualizar({ permisos: ['perfil'] });
    expect(E.cache.get('user_access_inv_interno@x.com')).toBe('1');
    expect(E.cache.get('user_access_v2_interno@x.com')).toBeNull();
  });

  test('si el cache no esta disponible el cambio igual queda aplicado y se advierte', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('cache caido'); } };
    const r = actualizar({ permisos: ['perfil'] });
    expect(r).toMatchObject({ ok: true, advertencias: ['CACHE_NO_INVALIDADO'] });
  });

  test('solo se invalida al usuario afectado', () => {
    global.getUserAccess('externo@x.com');
    actualizar({ permisos: ['perfil'] });
    expect(E.cache.get('user_access_v2_externo@x.com')).not.toBeNull();
  });
});

describe('idempotencia por clientRequestId', () => {
  test('el reintento del MISMO pedido (mismo clientRequestId, mismo usuario) no duplica nada', () => {
    const a = actualizar({ permisos: ['perfil'], clientRequestId: 'req-1' });
    expect(a.ok).toBe(true);
    const antes = snapshot();
    const b = actualizar({ permisos: ['perfil'], clientRequestId: 'req-1' });                           // version ya vieja (1): no es un conflicto, es el reintento
    expect(b).toMatchObject({ ok: true, duplicada: true, usuario: { version: 2 } });
    expect(snapshot()).toBe(antes);
  });

  test('el reintento de un alta no crea una segunda fila', () => {
    crear({ clientRequestId: 'alta-1' });
    const filas = E.hojas.Usuarios.filas.length;
    expect(crear({ clientRequestId: 'alta-1' })).toMatchObject({ ok: true, duplicada: true });
    expect(E.hojas.Usuarios.filas).toHaveLength(filas);
  });

  test('el mismo clientRequestId sobre OTRO usuario no se confunde', () => {
    actualizar({ permisos: ['perfil'], clientRequestId: 'req-2' });
    const r = E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'externo@x.com', versionEsperada: 1, permisos: ['perfil'], clientRequestId: 'req-2' });
    expect(r.duplicada).toBeUndefined();
    expect(r.ok).toBe(true);
  });

  test('sin clientRequestId un reintento es un conflicto de version normal', () => {
    actualizar({ permisos: ['perfil'] });
    expect(actualizar({ permisos: ['perfil'] })).toMatchObject({ ok: false, codigo: 'CONFLICT_VERSION' });
  });
});

describe('emails duplicados en la hoja', () => {
  test('operar sobre un email repetido se rechaza (hay que depurar a mano); el resto de los usuarios sigue operable', () => {
    E.hojas.Usuarios.filas.push(E.hojas.Usuarios.filas[3].slice());
    expect(actualizar()).toMatchObject({ ok: false, codigo: 'EMAIL_DUPLICADO_EN_HOJA' });
    expect(E.Servicio.usuariosAdmin_actualizar(ACTOR, { email: 'externo@x.com', versionEsperada: 1, nombre: 'Otro Nombre' }).ok).toBe(true);
  });
});

describe('los permisos actuales de los usuarios no cambian por operar sobre otro', () => {
  test('una edicion toca SOLO la fila del usuario afectado', () => {
    const antes = JSON.parse(JSON.stringify(E.hojas.Usuarios.filas));
    actualizar({ permisos: ['perfil'] });
    const despues = E.hojas.Usuarios.filas;
    [0, 1, 2, 4, 5].forEach((i) => expect(despues[i]).toEqual(antes[i]));
    expect(despues[3]).not.toEqual(antes[3]);
  });
});
