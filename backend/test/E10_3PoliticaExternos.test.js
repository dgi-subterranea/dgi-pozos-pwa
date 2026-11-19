// E10-3: politica de AUTORIDAD para el EXTERNO autenticado. Un EXTERNO consulta, propone y carga segun sus permisos, pero NUNCA valida, modera, anula lo ajeno ni administra.
// Reservados a INTERNO (aplicableExterno = false): perfil_validar, ubicacion_validar, fotos_moderar, observaciones_anular y usuarios_admin. Modulos REALES (catalogo, dominio, auth, servicio administrativo,
// handlers del Api) sobre hojas en memoria; los servicios de negocio que quedan detras de la puerta de permisos se reemplazan por espias.
const { crearEntornoE10, ACTOR, ADMIN1, ADMIN2, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');

const RESERVADOS = ['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular'];
const ONCE_DE_GUALDE = ['perfil', 'perfil_subir', 'datos', 'ubicacion', 'ubicacion_corregir', 'mapa', 'ne', 'fotos', 'fotos_carga', 'observaciones', 'observaciones_agregar'];
const TODOS = ['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'mapa', 'ne', 'fotos', 'fotos_carga', 'fotos_moderar', 'observaciones', 'observaciones_agregar', 'observaciones_anular', 'reemplazo'];
// una EXTERNO con TODOS los permisos de autoridad en SI en la hoja (dato historico / edicion manual) mas lo que esos permisos requieren
const CON_AUTORIDAD = ['perfil', 'perfil_subir', 'perfil_validar', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'mapa', 'fotos', 'fotos_carga', 'fotos_moderar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];

const ON = { E10_ADMIN_USUARIOS_ACTIVO: 'SI' };
let E;
const entorno = (usuarios) => {
  E = crearEntornoE10({ usuarios: [
    { email: ADMIN1, nombre: 'Admin Uno', permisos: PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']) },
    { email: ADMIN2, nombre: 'Admin Dos', permisos: PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']) }
  ].concat(usuarios) });
  Object.assign(global.__propiedades, ON);
};
const gestionExternos = (valor) => { if (valor) { global.__propiedades.E10_GESTION_EXTERNOS_ACTIVO = 'SI'; } else { delete global.__propiedades.E10_GESTION_EXTERNOS_ACTIVO; } };
const usuarios = () => global.sheetUserRepository_leerUsuarios();
const usuario = (email) => usuarios().find((u) => u.email === email);
const lista = (email) => global.permisosCatalogo_aLista(usuario(email).permisos);
const snapshot = () => JSON.stringify({ u: E.hojas.Usuarios.filas, e: E.hojas.UsuariosEventos.filas });
const actualizar = (email, extra) => E.Servicio.usuariosAdmin_actualizar(ACTOR, Object.assign({ email, versionEsperada: 1 }, extra));
const cambiarEstado = (email, accion, extra) => E.Servicio.usuariosAdmin_cambiarEstado(ACTOR, Object.assign({ email, versionEsperada: 1, accion, motivo: 'prueba' }, extra || {}));
const columna = (nombre) => E.hojas.Usuarios.filas[0].indexOf(nombre);

describe('Gualde y Dietrich: conservan EXACTAMENTE sus 11 permisos efectivos (el techo nuevo no les quita nada)', () => {
  beforeEach(() => {
    entorno([
      { email: 'gualde@x.com', nombre: 'M S G', tipo: 'EXTERNO', permisos: ONCE_DE_GUALDE },
      { email: 'dietrich@x.com', nombre: 'S D', tipo: 'EXTERNO', permisos: ONCE_DE_GUALDE }
    ]);
  });

  test.each([['gualde@x.com'], ['dietrich@x.com']])('%s: efectivos = declarados = los 11; los 6 restantes, false; ninguno inefectivo', (email) => {
    const acceso = global.getUserAccess(email);
    expect(acceso).toMatchObject({ active: true, tipo: 'EXTERNO' });
    expect(Object.keys(acceso.permisos).filter((id) => acceso.permisos[id] === true).sort()).toEqual(ONCE_DE_GUALDE.slice().sort());
    ['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular', 'reemplazo', 'usuarios_admin'].forEach((id) => expect(acceso.permisos[id]).toBe(false));
    ONCE_DE_GUALDE.forEach((id) => expect(global.hasPermission(email, id)).toBe(true));
    expect(global.usuariosDominio_permisosInefectivos(usuario(email).permisos, 'EXTERNO')).toEqual([]);
    expect(E.Servicio.usuariosAdmin_vista(usuario(email)).permisosInefectivos).toEqual([]);
  });

  test('login / checkSession les entregan los mismos 11 (el frontend se gobierna por esos permisos)', () => {
    const r = E.Auth.handleCheckSession(E.Auth.createSessionToken('gualde@x.com'));
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data.permisos).filter((id) => r.data.permisos[id] === true).sort()).toEqual(ONCE_DE_GUALDE.slice().sort());
  });

  test('el diseno no los obliga a nada: se pueden renombrar y desactivar como siempre', () => {
    expect(actualizar('gualde@x.com', { nombre: 'Nombre nuevo' })).toMatchObject({ ok: true });
    expect(cambiarEstado('dietrich@x.com', 'DESACTIVAR')).toMatchObject({ ok: true });
  });
});

describe('CIERRE DE LA BRECHA DE E10-2: un administrador NO puede asignar autoridad a un EXTERNO activo', () => {
  beforeEach(() => {
    entorno([{ email: 'ext@x.com', nombre: 'Ext', tipo: 'EXTERNO', permisos: ['perfil', 'perfil_subir', 'ubicacion', 'ubicacion_corregir', 'fotos', 'fotos_carga', 'observaciones', 'observaciones_agregar', 'mapa'] }]);
  });

  test.each([[false], [true]])('cada permiso reservado (y usuarios_admin) se rechaza con TIPO_NO_PERMITE_PERMISO y no se escribe NADA (gestion de externos %s)', (gestion) => {
    gestionExternos(gestion);
    RESERVADOS.concat(['usuarios_admin']).forEach((id) => {
      const antes = snapshot();
      const r = actualizar('ext@x.com', { permisos: lista('ext@x.com').concat([id]) });
      expect(r).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
      expect(r.detalle).toContain('TIPO_NO_PERMITE_PERMISO:' + id);
      expect(snapshot()).toBe(antes);
    });
  });

  test('un permiso NO reservado se sigue pudiendo otorgar (Modelo C no recorta lo funcional)', () => {
    const r = actualizar('ext@x.com', { permisos: lista('ext@x.com').concat(['ne', 'datos', 'reemplazo']) });
    expect(r).toMatchObject({ ok: true });
    expect(lista('ext@x.com')).toEqual(expect.arrayContaining(['ne', 'datos', 'reemplazo']));
  });

  test('tampoco por un pedido directo que combine el cambio con un nombre nuevo, ni dentro de una lista larga', () => {
    const antes = snapshot();
    expect(actualizar('ext@x.com', { nombre: 'Otro', permisos: TODOS })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(snapshot()).toBe(antes);
  });

  test('alta de EXTERNO con autoridad: con la gestion de externos apagada, E10_GESTION_EXTERNOS_INACTIVA; encendida, TIPO_NO_PERMITE_PERMISO (el techo vale siempre)', () => {
    const alta = () => E.Servicio.usuariosAdmin_crear(ACTOR, { email: 'nuevo@x.com', nombre: 'Nuevo', tipo: 'EXTERNO', permisos: ['perfil', 'perfil_validar'] });
    const antes = snapshot();
    expect(alta()).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
    gestionExternos(true);
    expect(alta()).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(snapshot()).toBe(antes);
  });
});

describe('INTERNO -> EXTERNO: sin cascada silenciosa', () => {
  beforeEach(() => {
    entorno([{ email: 'conv@x.com', nombre: 'Conv', tipo: 'INTERNO', permisos: ['perfil', 'perfil_validar', 'ubicacion', 'ubicacion_validar', 'fotos', 'fotos_moderar', 'observaciones', 'observaciones_anular', 'mapa'] }]);
    gestionExternos(true);
  });

  test('con permisos de autoridad se RECHAZA listando TODOS, sin quitar nada por su cuenta', () => {
    const antes = snapshot();
    const r = actualizar('conv@x.com', { tipo: 'EXTERNO', motivo: 'pasa a ser colaborador externo' });
    expect(r).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    RESERVADOS.forEach((id) => expect(r.detalle).toContain('TIPO_NO_PERMITE_PERMISO:' + id));
    expect(snapshot()).toBe(antes);
    expect(usuario('conv@x.com').tipo).toBe('INTERNO');
    expect(lista('conv@x.com')).toEqual(expect.arrayContaining(RESERVADOS));
  });

  test('con la gestion de externos apagada el pedido ya se rechaza antes (E10_GESTION_EXTERNOS_INACTIVA)', () => {
    gestionExternos(false);
    expect(actualizar('conv@x.com', { tipo: 'EXTERNO', motivo: 'x' })).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
  });

  test('el administrador decide: si manda los permisos SIN los reservados (y con motivo), la conversion se hace y queda auditada', () => {
    const sinAutoridad = lista('conv@x.com').filter((id) => !RESERVADOS.includes(id));
    expect(actualizar('conv@x.com', { tipo: 'EXTERNO', permisos: sinAutoridad })).toMatchObject({ ok: false, codigo: 'MOTIVO_REQUERIDO' });
    const r = actualizar('conv@x.com', { tipo: 'EXTERNO', permisos: sinAutoridad, motivo: 'colaborador externo' });
    expect(r).toMatchObject({ ok: true, eventos: ['USUARIO_ACTUALIZADO'] });
    expect(usuario('conv@x.com')).toMatchObject({ tipo: 'EXTERNO', version: 2 });
    expect(lista('conv@x.com')).toEqual(sinAutoridad);
    const evento = global.usuariosEventosRepository_leer(global.usuariosEventosRepository_abrir()).pop();
    expect(evento).toMatchObject({ evento: 'USUARIO_ACTUALIZADO', tipoAnterior: 'INTERNO', tipoNuevo: 'EXTERNO', motivo: 'colaborador externo' });
  });
});

describe('EXTERNO -> INTERNO: sin concesion automatica', () => {
  beforeEach(() => {
    entorno([
      { email: 'limpio@x.com', nombre: 'Limpio', tipo: 'EXTERNO', permisos: ['perfil', 'perfil_subir', 'ubicacion', 'mapa'] },
      { email: 'historico@x.com', nombre: 'Historico', tipo: 'EXTERNO', permisos: CON_AUTORIDAD }
    ]);
  });

  test('un EXTERNO sin permisos inefectivos pasa a INTERNO conservando EXACTAMENTE los suyos (el tipo no concede nada)', () => {
    const antes = lista('limpio@x.com');
    expect(actualizar('limpio@x.com', { tipo: 'INTERNO', motivo: 'ingreso a planta' })).toMatchObject({ ok: true });         // no es alta de externo: no necesita el flag
    expect(lista('limpio@x.com')).toEqual(antes);
    expect(global.getUserAccess('limpio@x.com').permisos.perfil_validar).toBe(false);
  });

  test('un EXTERNO con autoridad en SI en la hoja (hoy inefectiva) NO la recibe de golpe al pasar a INTERNO: CONCESION_AUTOMATICA y no se escribe nada', () => {
    const antes = snapshot();
    const r = actualizar('historico@x.com', { tipo: 'INTERNO', motivo: 'ingreso a planta' });
    expect(r).toMatchObject({ ok: false, codigo: 'CONCESION_AUTOMATICA' });
    RESERVADOS.forEach((id) => expect(r.detalle).toContain('CONCESION_AUTOMATICA:' + id));
    expect(snapshot()).toBe(antes);
  });

  test('el administrador tiene que quitarlos explicitamente; despues, otorgarlos es un paso aparte', () => {
    const sin = lista('historico@x.com').filter((id) => !RESERVADOS.includes(id));
    expect(actualizar('historico@x.com', { tipo: 'INTERNO', permisos: sin, motivo: 'ingreso a planta' })).toMatchObject({ ok: true });
    expect(usuario('historico@x.com').tipo).toBe('INTERNO');
    expect(global.getUserAccess('historico@x.com').permisos.perfil_validar).toBe(false);
    // ahora es INTERNO: otorgar perfil_validar ES posible, pero como una decision explicita (version 3)
    expect(actualizar('historico@x.com', { versionEsperada: 2, permisos: sin.concat(['perfil_validar']) })).toMatchObject({ ok: true });
    expect(global.getUserAccess('historico@x.com').permisos.perfil_validar).toBe(true);
  });
});

describe('PERMISOS CRUDOS HISTORICOS en una fila EXTERNO: inefectivos, visibles y sin limpiar solos', () => {
  beforeEach(() => {
    entorno([
      { email: 'hist@x.com', nombre: 'Hist', tipo: 'EXTERNO', permisos: CON_AUTORIDAD },
      { email: 'histbaja@x.com', nombre: 'Hist Baja', tipo: 'EXTERNO', estado: 'inactivo', permisos: ['perfil', 'perfil_validar'] }
    ]);
  });

  test('el acceso efectivo, hasPermission y los permisos de login/checkSession dan false; el valor de la hoja NO se toca', () => {
    const acceso = global.getUserAccess('hist@x.com');
    RESERVADOS.forEach((id) => {
      expect(acceso.permisos[id]).toBe(false);
      expect(global.hasPermission('hist@x.com', id)).toBe(false);
      expect(E.hojas.Usuarios.filas[3][columna(id)]).toBe('SI');
    });
    expect(acceso.permisos.perfil_subir).toBe(true);                       // lo demas sigue vigente
  });

  test('la administracion los muestra como asignados pero INEFECTIVOS (permisosInefectivos), tambien en el listado y el detalle', () => {
    const vista = E.Servicio.usuariosAdmin_vista(usuario('hist@x.com'));
    expect(vista.permisosInefectivos).toEqual(RESERVADOS);
    expect(vista.permisos).toEqual(expect.arrayContaining(RESERVADOS));    // "asignado en origen"
    const Lectura = require('../src/UsuariosAdminLectura');
    const l = Lectura.usuariosAdminLectura_listar(ACTOR);
    expect(l.usuarios.find((u) => u.email === 'hist@x.com').permisosInefectivos).toEqual(RESERVADOS);
    expect(Lectura.usuariosAdminLectura_obtener(ACTOR, 'hist@x.com', {}).usuario.permisosInefectivos).toEqual(RESERVADOS);
    expect(l.usuarios.find((u) => u.email === ADMIN1).permisosInefectivos).toEqual([]);
  });

  test('desactivar y renombrar siguen funcionando (no se bloquea una baja por un permiso que ya no vale) y no limpian la hoja', () => {
    expect(actualizar('hist@x.com', { nombre: 'Renombrado' })).toMatchObject({ ok: true });
    expect(E.hojas.Usuarios.filas[3][columna('perfil_validar')]).toBe('SI');
    expect(cambiarEstado('hist@x.com', 'DESACTIVAR', { versionEsperada: 2 })).toMatchObject({ ok: true });
    expect(E.hojas.Usuarios.filas[3][columna('perfil_validar')]).toBe('SI');
  });

  test('pero NO se le puede AGREGAR otro permiso de autoridad aunque ya tenga alguno', () => {
    const base = lista('hist@x.com').filter((id) => id !== 'fotos_moderar');
    // se quita uno y se intenta otro nuevo (observaciones_anular ya estaba, fotos_moderar es "nuevo" respecto de esta seleccion pero estaba en la hoja: queda permitido solo si ya estaba)
    expect(actualizar('hist@x.com', { permisos: base.concat(['usuarios_admin']) })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
  });

  test('REACTIVAR un EXTERNO con autoridad heredada se rechaza hasta que se quite (gestion apagada: E10_GESTION_EXTERNOS_INACTIVA; encendida: TIPO_NO_PERMITE_PERMISO)', () => {
    const antes = snapshot();
    expect(cambiarEstado('histbaja@x.com', 'REACTIVAR')).toMatchObject({ ok: false, codigo: 'E10_GESTION_EXTERNOS_INACTIVA' });
    gestionExternos(true);
    const r = cambiarEstado('histbaja@x.com', 'REACTIVAR');
    expect(r).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(r.detalle).toContain('TIPO_NO_PERMITE_PERMISO:perfil_validar');
    expect(snapshot()).toBe(antes);
  });

  test('quitar el permiso mientras esta inactivo se permite (es limpiar) y entonces la reactivacion funciona', () => {
    gestionExternos(true);
    expect(actualizar('histbaja@x.com', { permisos: ['perfil'] })).toMatchObject({ ok: true });
    expect(cambiarEstado('histbaja@x.com', 'REACTIVAR', { versionEsperada: 2 })).toMatchObject({ ok: true });
    expect(usuario('histbaja@x.com')).toMatchObject({ estado: 'activo', version: 3 });
  });
});

describe('dominio puro: usuariosDominio_validarMutacion y permisosInefectivos', () => {
  const D = () => require('../src/UsuariosDominio');
  const base = (extra) => Object.assign({ email: 'a@x.com', nombre: 'A', estado: 'activo', tipo: 'EXTERNO', version: 1, permisos: global.permisosCatalogo_aObjeto(['perfil']) }, extra || {});
  const admins = [{ email: 'adm@x.com', nombre: 'Adm', estado: 'activo', tipo: 'INTERNO', permisos: { usuarios_admin: true } }];

  beforeEach(() => { entorno([]); });

  test('permisosInefectivos es el complemento exacto de permisosEfectivos', () => {
    const crudos = global.permisosCatalogo_aObjeto(TODOS.concat(['usuarios_admin']));
    ['EXTERNO', '', 'INTERNO'].forEach((tipo) => {
      const efectivos = D().usuariosDominio_permisosEfectivos(crudos, tipo);
      const ineficaces = D().usuariosDominio_permisosInefectivos(crudos, tipo);
      global.permisosCatalogo_ids().forEach((id) => expect(ineficaces.includes(id)).toBe(crudos[id] === true && efectivos[id] === false));
    });
    expect(D().usuariosDominio_permisosInefectivos(crudos, 'INTERNO')).toEqual([]);
    expect(D().usuariosDominio_permisosInefectivos(crudos, 'EXTERNO')).toEqual(['perfil_validar', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular', 'usuarios_admin']);
  });

  test('alta o conversion: siempre rechaza; heredado en el mismo tipo activo: solo se tolera lo que YA estaba; reactivacion: rechaza', () => {
    const conAutoridad = global.permisosCatalogo_aObjeto(['perfil', 'perfil_validar']);
    const v = D().usuariosDominio_validarMutacion;
    expect(v(null, base({ permisos: conAutoridad }), admins, { cambiaPermisos: true })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(v(base({ tipo: 'INTERNO', permisos: conAutoridad }), base({ permisos: conAutoridad }), admins, {})).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    const hist = base({ permisos: conAutoridad });
    expect(v(hist, Object.assign({}, hist, { nombre: 'Otro' }), admins, {})).toEqual({ ok: true });
    expect(v(hist, Object.assign({}, hist, { estado: 'inactivo' }), admins, {})).toEqual({ ok: true });
    expect(v(hist, Object.assign({}, hist, { permisos: global.permisosCatalogo_aObjeto(['perfil', 'perfil_validar', 'fotos', 'fotos_moderar']) }), admins, { cambiaPermisos: true })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    const inactivo = Object.assign({}, hist, { estado: 'inactivo' });
    expect(v(inactivo, Object.assign({}, inactivo, { estado: 'activo' }), admins, { cambiaPermisos: true })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
  });

  test('EXTERNO -> INTERNO con permisos inefectivos que se conservan: CONCESION_AUTOMATICA; sin ellos, ok', () => {
    const v = D().usuariosDominio_validarMutacion;
    const hist = base({ permisos: global.permisosCatalogo_aObjeto(['perfil', 'perfil_validar', 'usuarios_admin']) });
    const r = v(hist, Object.assign({}, hist, { tipo: 'INTERNO' }), admins, {});
    expect(r).toMatchObject({ ok: false, codigo: 'CONCESION_AUTOMATICA' });
    expect(r.detalle).toEqual(['CONCESION_AUTOMATICA:perfil_validar', 'CONCESION_AUTOMATICA:usuarios_admin']);
    expect(v(hist, Object.assign({}, hist, { tipo: 'INTERNO', permisos: global.permisosCatalogo_aObjeto(['perfil']) }), admins, {})).toEqual({ ok: true });
  });
});

describe('AUTORIDAD en los endpoints: un EXTERNO con permisos de autoridad en la hoja NO puede ejercerlos', () => {
  const T = { ext: 'ext@x.com', int: 'int@x.com' };
  let Api;
  const puerta = (fn) => { try { return fn(); } catch (err) { return { code: 'PASO_LA_PUERTA' }; } };

  beforeEach(() => {
    entorno([
      { email: T.ext, nombre: 'Ext', tipo: 'EXTERNO', permisos: CON_AUTORIDAD },
      { email: T.int, nombre: 'Int', tipo: 'INTERNO', permisos: CON_AUTORIDAD }
    ]);
    global.verifySessionToken = jest.fn((t) => ({ valid: true, email: t }));
    global.logHistoryEvent = jest.fn();
    global.itfService_e9Activo = jest.fn(() => false);
    global.fotosPozosModeracionOps_ejecutar = jest.fn(() => ({ ok: false, code: 'X', message: 'm' }));
    global.observacionesPozoService_anular = jest.fn(() => ({ ok: false, code: 'X', message: 'm' }));
    global.ubicacionCorreccionService_proponer = jest.fn(() => ({ ok: true, duplicada: false, correccion: { estado: 'PROPUESTA' } }));
    global.ubicacionCorreccionNotificacion_notificarPendiente = jest.fn(() => ({ resultado: 'OMITIDA' }));
    global.ubicacionCorreccionNotificacion_textoAuditoria = jest.fn(() => '');
    Api = require('../src/Api');
  });

  const autoridad = {
    getItfPendientes: (t) => Api.handleGetItfPendientes(t, {}),
    getItfDocumentoModeracion: (t) => Api.handleGetItfDocumentoModeracion(t, {}),
    getHistorialItf: (t) => Api.handleGetHistorialItf(t, {}),
    aprobarItf: (t) => Api.handleAprobarItf(t, {}),
    rechazarItf: (t) => Api.handleRechazarItf(t, {}),
    retirarItf: (t) => Api.handleRetirarItf(t, {}),
    revertirItf: (t) => Api.handleRevertirItf(t, {}),
    getCorreccionesUbicacionPendientes: (t) => Api.handleGetCorreccionesUbicacionPendientes(t),
    validarCorreccionUbicacion: (t) => Api.handleValidarCorreccionUbicacion(t, 'id', 'm'),
    rechazarCorreccionUbicacion: (t) => Api.handleRechazarCorreccionUbicacion(t, 'id', 'm'),
    revertirCorreccionUbicacion: (t) => Api.handleRevertirCorreccionUbicacion(t, 'id', 'm'),
    decidirFuenteUbicacion: (t) => Api.handleDecidirFuenteUbicacion(t, { wellId: '01-0001' }),
    getSugerenciasFuentesPendientes: (t) => Api.handleGetSugerenciasFuentesPendientes(t),
    resolverSugerenciaFuente: (t) => Api.handleResolverSugerenciaFuente(t, {}),
    retirarFotoPozo: (t) => Api.handleRetirarFotoPozo(t, {}),
    resolverRetiroFotoPozo: (t) => Api.handleResolverRetiroFotoPozo(t, {}),
    reponerFotoPozo: (t) => Api.handleReponerFotoPozo(t, {}),
    getFotosPozosPendientesModeracion: (t) => Api.handleGetFotosPozosPendientesModeracion(t),
    getFotosPozosRetiradasModeracion: (t) => Api.handleGetFotosPozosRetiradasModeracion(t),
    getFotoPozoModeracion: (t) => Api.handleGetFotoPozoModeracion(t, '11111111-1111-4111-8111-111111111111', 'thumb')
  };

  test.each(Object.keys(autoridad))('%s: EXTERNO con el permiso en la hoja -> PERMISSION_DENIED; INTERNO con el mismo permiso -> pasa la puerta', (nombre) => {
    expect(puerta(() => autoridad[nombre](T.ext))).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(puerta(() => autoridad[nombre](T.int)).code).not.toBe('PERMISSION_DENIED');
  });

  test('ITF: un EXTERNO con perfil_validar en la hoja ni siquiera llega al servicio (permisos efectivos del handler = false)', () => {
    global.itfService_e9Activo = jest.fn(() => true);
    expect(Api.handleAprobarItf(T.ext, {})).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(global.itfService_e9Activo).not.toHaveBeenCalled();         // el permiso se evalua ANTES que el interruptor
    expect(global.hasPermission(T.ext, 'perfil')).toBe(true);           // propone/consulta: sigue pudiendo
    expect(global.hasPermission(T.ext, 'perfil_subir')).toBe(true);
  });

  test('Fotos: un EXTERNO puede subir y pedir el retiro de las propias (fotos + fotos_carga) pero no retirar, reponer ni resolver', () => {
    expect(puerta(() => Api.handleSolicitarRetiroFotoPozo(T.ext, { fotoId: 'x' })).code).not.toBe('PERMISSION_DENIED');
    expect(global.fotosPozosModeracionOps_ejecutar).toHaveBeenCalledWith(expect.objectContaining({ accion: 'SOLICITAR_RETIRO' }), expect.objectContaining({ permisos: { fotos: true, fotos_carga: true, fotos_moderar: false } }));
  });

  test('Observaciones: un EXTERNO con observaciones_anular en la hoja anula como AUTOR (anular = false); sin observaciones_agregar, ni eso', () => {
    Api.handleAnularObservacionPozo(T.ext, { observacionId: 'o', motivo: 'm' });
    expect(global.observacionesPozoService_anular).toHaveBeenCalledWith(T.ext, 'Ext', expect.any(Object), { observaciones: true, agregar: true, anular: false });
    Api.handleAnularObservacionPozo(T.int, { observacionId: 'o', motivo: 'm' });
    expect(global.observacionesPozoService_anular).toHaveBeenLastCalledWith(T.int, 'Int', expect.any(Object), { observaciones: true, agregar: true, anular: true });
    // sin agregar: solo le quedaria "anular", que es inefectivo
    const fila = E.hojas.Usuarios.filas[3];
    fila[columna('observaciones_agregar')] = 'NO';
    global.authService_invalidarAcceso(T.ext);
    global.observacionesPozoService_anular.mockClear();
    expect(Api.handleAnularObservacionPozo(T.ext, { observacionId: 'o', motivo: 'm' })).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(global.observacionesPozoService_anular).not.toHaveBeenCalled();
  });

  test('Ubicacion: un EXTERNO con ubicacion_corregir + ubicacion_validar en la hoja NO se auto-valida (autoValidar = false); un INTERNO con los mismos permisos si', () => {
    const pedido = { wellId: '01-0001', lat: -32.8, lon: -68.7, metodo: 'MAPA' };
    Api.handleProponerCorreccionUbicacion(T.ext, pedido);
    expect(global.ubicacionCorreccionService_proponer.mock.calls[0][4]).toEqual({ autoValidar: false });
    Api.handleProponerCorreccionUbicacion(T.int, pedido);
    expect(global.ubicacionCorreccionService_proponer.mock.calls[1][4]).toEqual({ autoValidar: true });
  });

  test('Los avisos a validadores no incluyen a un EXTERNO con permisos de validacion en la hoja', () => {
    const data = E.hojas.Usuarios.filas;
    const ids = global.sheetUserRepository_filtrarConPermisos(data, ['perfil', 'perfil_validar']).map((x) => x.email);
    expect(ids).toContain(T.int);
    expect(ids).not.toContain(T.ext);
    expect(global.sheetUserRepository_filtrarConPermisos(data, ['ubicacion', 'ubicacion_validar']).map((x) => x.email)).not.toContain(T.ext);
  });
});
