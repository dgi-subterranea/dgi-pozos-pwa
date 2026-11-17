// E10-2: controlador DOM de Administracion -> Usuarios (js/usuariosAdmin.js) con un DOM falso que LANZA ante innerHTML: estados de pantalla (sin acceso, deshabilitada, error, listo), listado + filtros, detalle
// y editor (email inmutable, permisos agrupados por el catalogo, dependencias sin cascadas invisibles), alta, desactivar / reactivar con motivo, conflicto de version, idempotencia, descarte de cambios,
// layout (celular / pantalla ancha) y cierre de sesion.
const fs = require('fs');
const path = require('path');
const { crearEntorno, flush } = require('./fixtures/domFalsoItf');

const P = (id, nombre, modulo, orden, extra) => Object.assign({ id, nombre, descripcion: 'Descripcion de ' + nombre, modulo, categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden }, extra || {});
const CATALOGO = [
  P('perfil', 'Ver ITF', 'Perfil / ITF', 10),
  P('perfil_subir', 'Proponer ITF', 'Perfil / ITF', 20, { dependeDe: ['perfil'], categoria: 'escritura' }),
  P('perfil_validar', 'Validar ITF', 'Perfil / ITF', 30, { dependeDe: ['perfil'], categoria: 'moderacion', critico: true }),
  P('datos', 'Ver ficha', 'Datos', 40),
  P('usuarios_admin', 'Administrar usuarios y permisos', 'Administracion', 90, { aplicableExterno: false, critico: true, categoria: 'administracion' })
];
const ok = (data) => ({ status: 'ok', data });
const err = (code, extra) => Object.assign({ status: 'error', code }, extra || {});
const V = (email, extra) => Object.assign({ email, nombre: 'Nombre ' + email.split('@')[0], tipo: 'INTERNO', estado: 'activo', version: 2, etag: 'etag-' + email, permisos: ['perfil', 'datos'], cantidadPermisos: 2, esAdmin: false, actualizadoUtc: '2026-11-05T15:04:38.896Z', actualizadoPor: 'migracion:E10-1' }, extra || {});
const USUARIOS = [
  V('ana@x.com', { nombre: 'Ana Pérez' }),
  V('beto@x.com', { nombre: 'Beto Gómez', tipo: 'EXTERNO' }),
  V('baja@x.com', { nombre: 'Baja Usuario', estado: 'inactivo' }),
  V('admin@x.com', { nombre: 'Admin Uno', permisos: ['perfil', 'usuarios_admin'], cantidadPermisos: 2, esAdmin: true }),
  V('admin2@x.com', { nombre: 'Admin Dos', permisos: ['perfil', 'usuarios_admin'], cantidadPermisos: 2, esAdmin: true })
];
const listado = (lista) => ok({ usuarios: lista, total: lista.length, activos: lista.filter((u) => u.estado === 'activo').length, administradoresEfectivos: lista.filter((u) => u.esAdmin).length });
const EVENTO = (n, extra) => Object.assign({ secuencia: n, evento: 'USUARIO_ACTUALIZADO', timestampUtc: '2026-11-05T15:04:38.896Z', ejecutadoPor: 'admin@x.com', nombreAnterior: 'Ana', nombreObjetivo: 'Ana Pérez', tipoAnterior: 'INTERNO', tipoNuevo: 'INTERNO', estadoAnterior: 'activo', estadoNuevo: 'activo', versionAnterior: n, versionNueva: n + 1, permisosAntes: ['perfil'], permisosDespues: ['perfil', 'datos'], motivo: '', origen: 'APP' }, extra || {});
const detalle = (usuario, eventos, extra) => ok(Object.assign({ usuario, eventos: eventos || [], eventosDisponibles: true, hayMasEventos: false, limiteEventos: 20 }, extra || {}));

function montar(opc) {
  const o = opc || {};
  const estado = { permisos: o.permisos || { usuarios_admin: true }, vencida: 0 };
  let usuarios = (o.usuarios || USUARIOS).map((u) => Object.assign({}, u));
  const api = {
    apiAdminPermisosCatalogo: jest.fn(o.catalogo || (() => Promise.resolve(ok({ permisos: CATALOGO, categorias: [], tipos: [] })))),
    apiAdminUsuariosListar: jest.fn(o.listar || (() => Promise.resolve(listado(usuarios)))),
    apiAdminUsuarioObtener: jest.fn(o.obtener || ((tok, email) => Promise.resolve(detalle(usuarios.find((u) => u.email === email), [EVENTO(1), EVENTO(2, { evento: 'USUARIO_CREADO', motivo: 'alta inicial' })])))),
    apiAdminUsuarioCrear: jest.fn(o.crear || ((tok, d) => Promise.resolve(ok({ eventos: ['USUARIO_CREADO'], advertencias: [], usuario: V(d.email, { nombre: d.nombre, tipo: d.tipo, permisos: d.permisos, cantidadPermisos: d.permisos.length, version: 1 }) })))),
    apiAdminUsuarioActualizar: jest.fn(o.actualizar || ((tok, d) => Promise.resolve(ok({ eventos: ['USUARIO_ACTUALIZADO'], advertencias: [], usuario: V(d.email, { nombre: d.nombre || 'Nombre', version: d.versionEsperada + 1 }) })))),
    apiAdminUsuarioDesactivar: jest.fn(o.desactivar || ((tok, d) => Promise.resolve(ok({ eventos: ['USUARIO_DESACTIVADO'], advertencias: [], usuario: V(d.email, { estado: 'inactivo', version: d.versionEsperada + 1 }) })))),
    apiAdminUsuarioReactivar: jest.fn(o.reactivar || ((tok, d) => Promise.resolve(ok({ eventos: ['USUARIO_REACTIVADO'], advertencias: [], usuario: V(d.email, { estado: 'activo', version: d.versionEsperada + 1 }) }))))
  };
  const e = crearEntorno(['usuariosAdminLogic.js', 'usuariosAdmin.js'], api);
  if (o.ancho !== undefined) { e.ctx.innerWidth = o.ancho; }
  e.ctx.usuariosAdminController_inicializar(() => ({ sessionToken: 'tok', permisos: estado.permisos, onSessionExpired: () => { estado.vencida += 1; } }));
  const el = e.el;
  const r = Object.assign(e, {
    api, estado, c: e.ctx, el,
    setUsuarios: (l) => { usuarios = l; },
    tarjetas: () => el['uadm-lista'].descendientes().filter((n) => n.tag === 'button'),
    nombresTarjetas: () => el['uadm-lista'].descendientes().filter((n) => n.className === 'uadm-card-nombre').map((n) => n.textContent),
    permisos: () => el['uadm-permisos'].descendientes().filter((n) => n.tag === 'input'),
    permiso: (id) => el['uadm-permisos'].descendientes().filter((n) => n.tag === 'input' && n.getAttribute('data-permiso') === id)[0],
    marcados: () => el['uadm-permisos'].descendientes().filter((n) => n.tag === 'input' && n.checked).map((n) => n.getAttribute('data-permiso')),
    abrirPantalla: async () => { e.ctx.usuariosAdminController_abrir(); await flush(); },
    abrirDetalle: async (email) => { r.tarjetas().filter((b) => b.getAttribute('data-email') === email)[0].click(); await flush(); },
    tocar: async (id, marcado) => { const cb = r.permiso(id); cb.checked = marcado; cb.emitir('change'); await flush(); },
    escribir: (id, valor, tipo) => { el[id].value = valor; el[id].emitir(tipo || 'input'); },
    dlg: () => ({ abierto: !el['uadm-overlay'].hidden, titulo: el['uadm-dlg-titulo'].textContent, texto: el['uadm-dlg-lineas'].descendientes().map((n) => n.textContent).join(' '), boton: el['btn-uadm-dlg-confirmar'].textContent, motivoVisible: !el['uadm-dlg-motivo'].hidden, error: el['uadm-dlg-error'].hidden ? '' : el['uadm-dlg-error'].textContent }),
    confirmar: async (motivo) => { if (motivo !== undefined) { el['uadm-dlg-motivo'].value = motivo; } el['btn-uadm-dlg-confirmar'].click(); await flush(); },
    cancelar: async () => { el['btn-uadm-dlg-cancelar'].click(); await flush(); },
    texto: (id) => el[id].textContent,
    visible: (id) => !el[id].hidden
  });
  return r;
}

describe('estados de la pantalla', () => {
  test('sin usuarios_admin: no se pide NADA y se muestra "sin acceso"', async () => {
    const t = montar({ permisos: { perfil: true } });
    await t.abrirPantalla();
    expect(t.api.apiAdminPermisosCatalogo).not.toHaveBeenCalled();
    expect(t.api.apiAdminUsuariosListar).not.toHaveBeenCalled();
    expect(t.visible('uadm-sin-permiso')).toBe(true);
    expect(t.visible('uadm-contenido')).toBe(false);
  });

  test('administrador: pide catalogo y listado UNA vez, con su sesion, y muestra el listado', async () => {
    const t = montar();
    expect(t.api.apiAdminUsuariosListar).not.toHaveBeenCalled();            // la tarjeta del hub no carga nada: se pide al abrir
    await t.abrirPantalla();
    expect(t.api.apiAdminPermisosCatalogo).toHaveBeenCalledTimes(1);
    expect(t.api.apiAdminPermisosCatalogo).toHaveBeenCalledWith('tok');
    expect(t.api.apiAdminUsuariosListar).toHaveBeenCalledWith('tok');
    expect(t.visible('uadm-contenido')).toBe(true);
    expect(t.visible('uadm-cargando')).toBe(false);
    expect(t.tarjetas()).toHaveLength(5);
    expect(t.texto('uadm-resumen')).toBe('5 usuarios · 4 activos · 2 administradores efectivos');
  });

  test('Administracion DESHABILITADA (flag apagado): estado claro, sin formularios ni listado ni "Nuevo usuario" funcionales', async () => {
    const t = montar({ listar: () => Promise.resolve(err('E10_ADMIN_INACTIVO')) });
    await t.abrirPantalla();
    expect(t.visible('uadm-deshabilitada')).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')).toContain('Administración temporalmente deshabilitada');       // el texto estatico del estado vive en index.html
    expect(t.visible('uadm-contenido')).toBe(false);          // el listado, los filtros, el editor y "Nuevo usuario" viven ahi dentro
    expect(t.api.apiAdminUsuarioCrear).not.toHaveBeenCalled();
    expect(t.api.apiAdminUsuarioActualizar).not.toHaveBeenCalled();
  });

  test('"Volver a comprobar" reintenta y, si ya esta habilitada, muestra el listado', async () => {
    let habilitada = false;
    const t = montar({ listar: () => Promise.resolve(habilitada ? listado(USUARIOS) : err('E10_ADMIN_INACTIVO')) });
    await t.abrirPantalla();
    expect(t.visible('uadm-deshabilitada')).toBe(true);
    habilitada = true;
    t.el['btn-uadm-reintentar-deshab'].click();
    await flush();
    expect(t.visible('uadm-deshabilitada')).toBe(false);
    expect(t.visible('uadm-contenido')).toBe(true);
  });

  test('PERMISSION_DENIED del backend (permiso retirado): "sin acceso"; sesion vencida: cierra la sesion', async () => {
    const a = montar({ listar: () => Promise.resolve(err('PERMISSION_DENIED')) });
    await a.abrirPantalla();
    expect(a.visible('uadm-sin-permiso')).toBe(true);
    const b = montar({ listar: () => Promise.resolve(err('UNAUTHORIZED')) });
    await b.abrirPantalla();
    expect(b.estado.vencida).toBe(1);
    const c = montar({ catalogo: () => Promise.resolve(err('USER_DISABLED')) });
    await c.abrirPantalla();
    expect(c.estado.vencida).toBe(1);
  });

  test('error de servicio o de red: mensaje util y "Reintentar" vuelve a pedir', async () => {
    let falla = true;
    const t = montar({ listar: () => (falla ? Promise.reject(new Error('red')) : Promise.resolve(listado(USUARIOS))) });
    await t.abrirPantalla();
    expect(t.visible('uadm-error')).toBe(true);
    expect(t.texto('uadm-error-texto')).toContain('No se pudo completar la operación');
    falla = false;
    t.el['btn-uadm-reintentar'].click();
    await flush();
    expect(t.visible('uadm-error')).toBe(false);
    expect(t.tarjetas()).toHaveLength(5);
    const u = montar({ listar: () => Promise.resolve(err('SERVICE_UNAVAILABLE')) });
    await u.abrirPantalla();
    expect(u.texto('uadm-error-texto')).toContain('No se pudo completar');
  });

  test('si la pantalla se cierra antes de que llegue la respuesta, no se pinta nada (respuesta vieja)', async () => {
    let resolver;
    const t = montar({ listar: () => new Promise((res) => { resolver = res; }) });
    t.c.usuariosAdminController_abrir();
    t.c.usuariosAdminController_cerrar();
    resolver(listado(USUARIOS));
    await flush();
    expect(t.visible('uadm-contenido')).toBe(false);
  });

  test('una respuesta VIEJA no pisa a la nueva: si se abre la pantalla dos veces, manda la ultima aunque la primera llegue despues', async () => {
    const resolvers = [];
    const t = montar({ listar: () => new Promise((res) => { resolvers.push(res); }) });
    t.c.usuariosAdminController_abrir();
    t.c.usuariosAdminController_abrir();
    resolvers[1](listado([V('nueva@x.com', { nombre: 'Respuesta Nueva' })]));
    await flush();
    resolvers[0](listado([V('vieja@x.com', { nombre: 'Respuesta Vieja' })]));
    await flush();
    expect(t.nombresTarjetas()).toEqual(['Respuesta Nueva']);
  });

  test('cierre de sesion (reset): limpia listas y oculta todo', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.c.usuariosAdminController_reset();
    expect(t.tarjetas()).toHaveLength(0);
    expect(t.permisos()).toHaveLength(0);
    expect(t.visible('uadm-contenido')).toBe(false);
    expect(t.c.usuariosAdminController_hayModalAbierto()).toBe(false);
  });
});

describe('listado y filtros', () => {
  test('cada tarjeta muestra nombre, email, estado, tipo, cantidad de permisos, indicador Admin y ultima actualizacion; sin acciones en la fila', async () => {
    const t = montar();
    await t.abrirPantalla();
    const admin = t.tarjetas().filter((b) => b.getAttribute('data-email') === 'admin@x.com')[0];
    const texto = admin.descendientes().map((n) => n.textContent).join('|');
    expect(texto).toContain('Admin Uno');
    expect(texto).toContain('admin@x.com');
    expect(texto).toContain('Activo');
    expect(texto).toContain('Interno');
    expect(texto).toContain('Admin');
    expect(texto).toContain('2 permisos');
    expect(texto).toMatch(/Actualizado: \d\d\/\d\d\/2026/);
    const ext = t.tarjetas().filter((b) => b.getAttribute('data-email') === 'beto@x.com')[0].descendientes().map((n) => n.textContent).join('|');
    expect(ext).toContain('Externo');
    expect(ext).not.toContain('|Admin|');
    // las acciones sensibles NO estan en las filas: ningun boton de desactivar / reactivar dentro del listado
    expect(t.el['uadm-lista'].botones().every((b) => b.getAttribute('data-email'))).toBe(true);
    expect(t.el['uadm-lista'].botones().map((b) => b.textContent).join(' ')).not.toMatch(/Desactivar|Reactivar/);
  });

  test('busqueda por nombre o email y filtros de estado, tipo y administrador', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.escribir('uadm-buscar', 'perez');
    expect(t.nombresTarjetas()).toEqual(['Ana Pérez']);
    t.escribir('uadm-buscar', '');
    t.escribir('uadm-f-estado', 'inactivo', 'change');
    expect(t.nombresTarjetas()).toEqual(['Baja Usuario']);
    t.escribir('uadm-f-estado', 'todos', 'change');
    t.escribir('uadm-f-tipo', 'EXTERNO', 'change');
    expect(t.nombresTarjetas()).toEqual(['Beto Gómez']);
    t.escribir('uadm-f-tipo', 'todos', 'change');
    t.escribir('uadm-f-admin', 'admin', 'change');
    expect(t.nombresTarjetas()).toEqual(['Admin Uno', 'Admin Dos']);
    expect(t.texto('uadm-resumen')).toContain('2 de 5 usuarios');
    t.escribir('uadm-f-admin', 'no_admin', 'change');
    expect(t.tarjetas()).toHaveLength(3);
  });

  test('sin coincidencias: mensaje; "Limpiar filtros" los restablece', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.escribir('uadm-buscar', 'zzzz');
    expect(t.tarjetas()).toHaveLength(0);
    expect(t.visible('uadm-lista-vacia')).toBe(true);
    t.el['btn-uadm-limpiar-filtros'].click();
    expect(t.tarjetas()).toHaveLength(5);
    expect(t.visible('uadm-lista-vacia')).toBe(false);
    expect(t.el['uadm-buscar'].value).toBe('');
  });

  test('no depende de que sean 11: 300 usuarios se listan y se filtran', async () => {
    const muchos = [];
    for (let i = 0; i < 300; i += 1) { muchos.push(V('u' + i + '@x.com', { nombre: 'Usuario ' + i })); }
    const t = montar({ usuarios: muchos });
    await t.abrirPantalla();
    expect(t.tarjetas()).toHaveLength(300);
    t.escribir('uadm-buscar', 'usuario 299');
    expect(t.tarjetas()).toHaveLength(1);
  });

  test('texto de datos como TEXTO: un nombre con etiquetas se pinta literal (el DOM falso lanza ante innerHTML)', async () => {
    const t = montar({ usuarios: [V('xss@x.com', { nombre: '<img src=x onerror=alert(1)>' })] });
    await t.abrirPantalla();
    expect(t.nombresTarjetas()).toEqual(['<img src=x onerror=alert(1)>']);
  });

  test('"Actualizar" vuelve a pedir el listado', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.setUsuarios(USUARIOS.concat([V('nuevo@x.com', { nombre: 'Nuevo' })]));
    t.el['btn-uadm-actualizar'].click();
    await flush();
    expect(t.tarjetas()).toHaveLength(6);
  });
});

describe('detalle y editor', () => {
  test('abrir un usuario: pide el detalle FRESCO, muestra datos, version, actualizacion y eventos recientes; el email es de solo lectura', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    expect(t.api.apiAdminUsuarioObtener).toHaveBeenCalledWith('tok', 'ana@x.com', 20);
    expect(t.texto('uadm-detalle-titulo')).toBe('Ana Pérez');
    expect(t.el['uadm-email'].value).toBe('ana@x.com');
    expect(t.el['uadm-email'].readOnly).toBe(true);
    expect(t.visible('uadm-email-nota')).toBe(true);
    expect(t.el['uadm-nombre'].value).toBe('Ana Pérez');
    expect(t.el['uadm-tipo'].value).toBe('INTERNO');
    expect(t.texto('uadm-estado-texto')).toBe('Activo');
    expect(t.texto('uadm-meta-version')).toBe('2');
    expect(t.texto('uadm-meta-actualizado')).toContain('migracion:E10-1');
    expect(t.marcados()).toEqual(['perfil', 'datos']);
    const ev = t.el['uadm-eventos'].descendientes().map((n) => n.textContent).join('|');
    expect(ev).toContain('Actualizado');
    expect(ev).toContain('Creado');
    expect(ev).toContain('Motivo: alta inicial');
    expect(ev).toContain('Permisos agregados: Ver ficha');
    expect(t.visible('btn-uadm-eventos-mas')).toBe(false);
  });

  test('permisos agrupados por modulo con la metadata del catalogo: nombre, descripcion, dependencia, critico, aplicabilidad', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    const grupos = t.el['uadm-permisos'].children.map((g) => g.children[0].textContent);
    expect(grupos).toEqual(['Perfil / ITF', 'Datos', 'Administracion']);
    const textoPermisos = t.el['uadm-permisos'].descendientes().map((n) => n.textContent).join('|');
    expect(textoPermisos).toContain('Validar ITF');
    expect(textoPermisos).toContain('Descripcion de Validar ITF');
    expect(textoPermisos).toContain('Requiere: Ver ITF');
    expect(textoPermisos).toContain('Crítico');
    // sin el catalogo en el controlador: 5 casillas = las 5 del catalogo de prueba
    expect(t.permisos()).toHaveLength(5);
  });

  test('un usuario externo NO puede tener el permiso no aplicable (casilla deshabilitada con su nota)', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('beto@x.com');
    expect(t.permiso('usuarios_admin').disabled).toBe(true);
    expect(t.el['uadm-permisos'].descendientes().map((n) => n.textContent).join('|')).toContain('No aplicable a usuarios externos.');
    expect(t.permiso('perfil').disabled).toBe(false);
  });

  test('celular: listado O detalle (una cosa por vez) con "Volver al listado"; pantalla ancha: los dos a la vez', async () => {
    const cel = montar({ ancho: 390 });
    await cel.abrirPantalla();
    expect(cel.visible('uadm-panel-lista')).toBe(true);
    expect(cel.visible('uadm-panel-detalle')).toBe(false);
    await cel.abrirDetalle('ana@x.com');
    expect(cel.visible('uadm-panel-lista')).toBe(false);
    expect(cel.visible('uadm-panel-detalle')).toBe(true);
    expect(cel.visible('btn-uadm-detalle-volver')).toBe(true);
    cel.el['btn-uadm-detalle-volver'].click();
    await flush();
    expect(cel.visible('uadm-panel-lista')).toBe(true);
    expect(cel.visible('uadm-panel-detalle')).toBe(false);
    const pc = montar({ ancho: 1280 });
    await pc.abrirPantalla();
    expect(pc.visible('uadm-panel-lista')).toBe(true);
    expect(pc.visible('uadm-panel-detalle')).toBe(true);
    expect(pc.visible('uadm-detalle-vacio')).toBe(true);
    await pc.abrirDetalle('ana@x.com');
    expect(pc.visible('uadm-panel-lista')).toBe(true);
    expect(pc.visible('btn-uadm-detalle-volver')).toBe(false);
    expect(pc.el['uadm-columnas'].className).toContain('uadm-doble');
    expect(cel.el['uadm-columnas'].className).toContain('uadm-simple');
  });

  test('"Ver mas actividad": pide mas eventos (el doble, hasta el tope)', async () => {
    const t = montar({ obtener: (tok, email, lim) => Promise.resolve(detalle(USUARIOS.find((u) => u.email === email), [EVENTO(1)], { hayMasEventos: true, limiteEventos: lim })) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    expect(t.visible('btn-uadm-eventos-mas')).toBe(true);
    t.el['btn-uadm-eventos-mas'].click();
    await flush();
    expect(t.api.apiAdminUsuarioObtener).toHaveBeenLastCalledWith('tok', 'ana@x.com', 40);
  });

  test('si el historial no se pudo leer, lo dice (no muestra uno vacio)', async () => {
    const t = montar({ obtener: (tok, email) => Promise.resolve(detalle(USUARIOS.find((u) => u.email === email), [], { eventosDisponibles: false })) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    expect(t.visible('uadm-eventos-no-disponibles')).toBe(true);
    expect(t.visible('uadm-eventos-vacio')).toBe(false);
  });

  test('error al pedir el detalle: mensaje por codigo; el flag apagado a mitad de camino lleva al estado "deshabilitada"', async () => {
    const a = montar({ obtener: () => Promise.resolve(err('USUARIO_NO_ENCONTRADO')) });
    await a.abrirPantalla();
    await a.abrirDetalle('ana@x.com');
    expect(a.texto('uadm-detalle-error')).toContain('El usuario no existe');
    const b = montar({ obtener: () => Promise.resolve(err('E10_ADMIN_INACTIVO')) });
    await b.abrirPantalla();
    await b.abrirDetalle('ana@x.com');
    expect(b.visible('uadm-deshabilitada')).toBe(true);
    expect(b.visible('uadm-contenido')).toBe(false);
  });
});

describe('edicion: guardar cambios', () => {
  test('cambiar el nombre: "Guardar" se habilita, manda SOLO lo que cambio con version + etag + clientRequestId, y avisa', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
    t.escribir('uadm-nombre', 'Ana M. Pérez');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(false);
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.api.apiAdminUsuarioActualizar).toHaveBeenCalledTimes(1);
    const pedido = t.api.apiAdminUsuarioActualizar.mock.calls[0][1];
    expect(Object.keys(pedido).sort()).toEqual(['clientRequestId', 'email', 'etag', 'nombre', 'versionEsperada']);
    expect(pedido).toMatchObject({ email: 'ana@x.com', nombre: 'Ana M. Pérez', versionEsperada: 2, etag: 'etag-ana@x.com' });
    expect(pedido.clientRequestId).toMatch(/^adm-/);
    expect(t.texto('uadm-aviso')).toContain('Cambios guardados.');
  });

  test('el pedido nunca lleva actor, ejecutor ni un email nuevo', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    const pedido = t.api.apiAdminUsuarioActualizar.mock.calls[0][1];
    ['actor', 'ejecutadoPor', 'nuevoEmail', 'emailNuevo', 'estado', 'version', 'fila'].forEach((c) => expect(pedido).not.toHaveProperty(c));
    // y el campo email de un usuario existente no se puede editar
    expect(t.el['uadm-email'].readOnly).toBe(true);
  });

  test('un cambio comun de permisos no pide confirmacion ni motivo y manda la lista completa', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    await t.tocar('perfil_subir', true);
    expect(t.dlg().abierto).toBe(false);
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.api.apiAdminUsuarioActualizar.mock.calls[0][1]).toMatchObject({ permisos: ['perfil', 'perfil_subir', 'datos'] });
    expect(t.api.apiAdminUsuarioActualizar.mock.calls[0][1]).not.toHaveProperty('nombre');
  });

  test('"Descartar cambios" vuelve a los datos del servidor', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Cambiado');
    await t.tocar('datos', false);
    t.el['btn-uadm-descartar'].click();
    await flush();
    expect(t.el['uadm-nombre'].value).toBe('Ana Pérez');
    expect(t.marcados()).toEqual(['perfil', 'datos']);
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
  });

  test('doble toque en "Guardar": UN solo pedido; los controles quedan deshabilitados mientras se guarda', async () => {
    let resolver;
    const t = montar({ actualizar: () => new Promise((res) => { resolver = res; }) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.api.apiAdminUsuarioActualizar).toHaveBeenCalledTimes(1);
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
    expect(t.el['uadm-nombre'].disabled).toBe(true);
    resolver(ok({ eventos: ['USUARIO_ACTUALIZADO'], advertencias: [], usuario: V('ana@x.com', { nombre: 'Otro', version: 3 }) }));
    await flush();
    expect(t.el['uadm-nombre'].disabled).toBe(false);
  });

  test('aunque el boton este deshabilitado, un segundo disparo del guardado mientras hay uno en curso NO hace otro pedido', async () => {
    let resolver;
    const t = montar({ actualizar: () => new Promise((res) => { resolver = res; }) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    t.el['btn-uadm-guardar'].emitir('click');          // un evento que se cuela igual (p. ej. teclado)
    await flush();
    expect(t.api.apiAdminUsuarioActualizar).toHaveBeenCalledTimes(1);
    resolver(ok({ eventos: ['USUARIO_ACTUALIZADO'], advertencias: [], usuario: V('ana@x.com', { nombre: 'Otro', version: 3 }) }));
    await flush();
  });

  test('IDEMPOTENCIA: un reintento del MISMO pedido (error de red) reusa el clientRequestId; un cambio distinto usa otro', async () => {
    let falla = true;
    const t = montar({ actualizar: (tok, d) => (falla ? Promise.reject(new Error('red')) : Promise.resolve(ok({ eventos: ['USUARIO_ACTUALIZADO'], advertencias: [], usuario: V(d.email, { nombre: d.nombre, version: 3 }) }))) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.texto('uadm-detalle-error')).toContain('Tu pedido no se duplica si reintentás');
    falla = false;
    t.el['btn-uadm-guardar'].click();
    await flush();
    const [a, b] = t.api.apiAdminUsuarioActualizar.mock.calls.map((c) => c[1].clientRequestId);
    expect(a).toBe(b);
    // otro cambio, otra intencion
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Nombre distinto');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.api.apiAdminUsuarioActualizar.mock.calls[2][1].clientRequestId).not.toBe(a);
  });

  test('CONFLICTO de version: mensaje claro, se recargan los datos actuales y no se pierde la sesion', async () => {
    let n = 0;
    const t = montar({
      actualizar: () => Promise.resolve(err('CONFLICT_VERSION', { actual: V('ana@x.com', { nombre: 'Cambiado por otro', version: 5 }) })),
      obtener: (tok, email) => { n += 1; return Promise.resolve(detalle(n === 1 ? USUARIOS.find((u) => u.email === email) : V(email, { nombre: 'Cambiado por otro', version: 5, etag: 'nuevo' }), [])); }
    });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Mi cambio');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.texto('uadm-detalle-error')).toContain('Otro administrador modificó este usuario');
    expect(t.api.apiAdminUsuarioObtener.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(t.el['uadm-nombre'].value).toBe('Cambiado por otro');
    expect(t.texto('uadm-meta-version')).toBe('5');
    expect(t.estado.vencida).toBe(0);
  });

  test.each([['ULTIMO_ADMIN', 'sin administradores efectivos'], ['E10_GESTION_EXTERNOS_INACTIVA', 'gestión de usuarios externos está deshabilitada'], ['PERMISOS_INCONSISTENTES', 'Faltan permisos requeridos'], ['AUDITORIA_NO_DISPONIBLE', 'se revirtió'], ['PERMISSION_DENIED', 'No tenés permiso']])('el codigo %s se muestra con su mensaje', async (codigo, fragmento) => {
    const t = montar({ actualizar: () => Promise.resolve(err(codigo)) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.texto('uadm-detalle-error')).toContain(fragmento);
  });

  test('administracion deshabilitada durante la edicion: pasa al estado "deshabilitada" y no se puede seguir escribiendo', async () => {
    const t = montar({ actualizar: () => Promise.resolve(err('E10_ADMIN_INACTIVO')) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.visible('uadm-deshabilitada')).toBe(true);
    expect(t.visible('uadm-contenido')).toBe(false);
  });

  test('sesion vencida durante un guardado: cierra la sesion', async () => {
    const t = montar({ actualizar: () => Promise.resolve(err('UNAUTHORIZED')) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Otro');
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.estado.vencida).toBe(1);
  });
});

describe('dependencias de permisos: sin cascadas invisibles', () => {
  test('activar un permiso con su requerido apagado OFRECE activar el requerido (decision explicita)', async () => {
    const t = montar({ usuarios: [V('x@x.com', { nombre: 'X', permisos: ['datos'], cantidadPermisos: 1 })] });
    await t.abrirPantalla();
    await t.abrirDetalle('x@x.com');
    await t.tocar('perfil_validar', true);
    const d = t.dlg();
    expect(d.abierto).toBe(true);
    expect(d.titulo).toBe('Este permiso necesita otro');
    expect(d.texto).toContain('«Validar ITF» requiere: Ver ITF');
    expect(d.boton).toBe('Activar también: Ver ITF');
    expect(t.marcados()).toEqual(['datos']);                      // todavia no cambio nada
    await t.confirmar();
    expect(t.marcados()).toEqual(['perfil', 'perfil_validar', 'datos']);
  });

  test('cancelar la oferta deja el permiso APAGADO (no se enciende en silencio)', async () => {
    const t = montar({ usuarios: [V('x@x.com', { nombre: 'X', permisos: ['datos'], cantidadPermisos: 1 })] });
    await t.abrirPantalla();
    await t.abrirDetalle('x@x.com');
    await t.tocar('perfil_validar', true);
    await t.cancelar();
    expect(t.marcados()).toEqual(['datos']);
    expect(t.permiso('perfil_validar').checked).toBe(false);
  });

  test('quitar un padre ADVIERTE que dependientes quedarian afectados y exige decision; cancelar no cambia nada', async () => {
    const t = montar({ usuarios: [V('x@x.com', { nombre: 'X', permisos: ['perfil', 'perfil_subir', 'datos'], cantidadPermisos: 3 })] });
    await t.abrirPantalla();
    await t.abrirDetalle('x@x.com');
    await t.tocar('perfil', false);
    const d = t.dlg();
    expect(d.abierto).toBe(true);
    expect(d.titulo).toBe('Quitar este permiso afecta a otros');
    expect(d.texto).toContain('Proponer ITF');
    expect(d.texto).toContain('No se quitan solos');
    expect(t.marcados()).toEqual(['perfil', 'perfil_subir', 'datos']);          // nada se apago en silencio
    await t.cancelar();
    expect(t.marcados()).toEqual(['perfil', 'perfil_subir', 'datos']);
    await t.tocar('perfil', false);
    await t.confirmar();
    expect(t.marcados()).toEqual(['datos']);
  });

  test('quitar un permiso sin dependientes es directo (sin dialogo)', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    await t.tocar('datos', false);
    expect(t.dlg().abierto).toBe(false);
    expect(t.marcados()).toEqual(['perfil']);
  });
});

describe('tipo y administrador: confirmaciones concretas y motivo obligatorio', () => {
  test('pasar a EXTERNO a un usuario con usuarios_admin: se avisa, no se quita en silencio y no se puede guardar', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('admin2@x.com');
    t.escribir('uadm-tipo', 'EXTERNO', 'change');
    expect(t.visible('uadm-form-aviso')).toBe(true);
    expect(t.texto('uadm-form-aviso')).toContain('Un usuario externo no puede tener «Administrar usuarios y permisos»');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
    expect(t.marcados()).toContain('usuarios_admin');                // el administrador decide quitarlo
    await t.tocar('usuarios_admin', false);
    expect(t.el['btn-uadm-guardar'].disabled).toBe(false);
  });

  test('cambiar el tipo: confirmacion explicita + motivo OBLIGATORIO (sin motivo no se manda nada)', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-tipo', 'EXTERNO', 'change');
    t.el['btn-uadm-guardar'].click();
    await flush();
    const d = t.dlg();
    expect(d.abierto).toBe(true);
    expect(d.texto).toContain('de interno a externo');
    expect(d.motivoVisible).toBe(true);
    await t.confirmar('   ');
    expect(t.dlg().error).toContain('exige un motivo');
    expect(t.api.apiAdminUsuarioActualizar).not.toHaveBeenCalled();
    await t.confirmar('pasa a técnico externo');
    const pedido = t.api.apiAdminUsuarioActualizar.mock.calls[0][1];
    expect(pedido).toMatchObject({ tipo: 'EXTERNO', motivo: 'pasa a técnico externo' });
    expect(pedido).not.toHaveProperty('permisos');                 // el tipo no toca los permisos
  });

  test('conceder usuarios_admin: confirmacion critica explicando el alcance, sin motivo obligatorio', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    await t.tocar('usuarios_admin', true);
    t.el['btn-uadm-guardar'].click();
    await flush();
    const d = t.dlg();
    expect(d.abierto).toBe(true);
    expect(d.texto).toContain('Le das «Administrar usuarios y permisos» a Ana Pérez (ana@x.com)');
    expect(d.motivoVisible).toBe(false);
    expect(t.el['btn-uadm-dlg-confirmar'].className).toContain('uadm-peligro');
    await t.confirmar();
    expect(t.api.apiAdminUsuarioActualizar.mock.calls[0][1].permisos).toContain('usuarios_admin');
  });

  test('quitar usuarios_admin: motivo OBLIGATORIO y el texto dice que dejara de poder administrar', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('admin2@x.com');
    await t.tocar('usuarios_admin', false);
    t.el['btn-uadm-guardar'].click();
    await flush();
    const d = t.dlg();
    expect(d.texto).toContain('Le quitás «Administrar usuarios y permisos»');
    expect(d.motivoVisible).toBe(true);
    await t.confirmar('');
    expect(t.api.apiAdminUsuarioActualizar).not.toHaveBeenCalled();
    await t.confirmar('rota de area');
    expect(t.api.apiAdminUsuarioActualizar.mock.calls[0][1]).toMatchObject({ permisos: ['perfil'], motivo: 'rota de area' });
  });

  test('el ultimo administrador: el backend lo rechaza y la pantalla explica por que (sin cambiar el estado local)', async () => {
    const t = montar({ actualizar: () => Promise.resolve(err('ULTIMO_ADMIN')) });
    await t.abrirPantalla();
    await t.abrirDetalle('admin@x.com');
    await t.tocar('usuarios_admin', false);
    t.el['btn-uadm-guardar'].click();
    await flush();
    await t.confirmar('x');
    expect(t.texto('uadm-detalle-error')).toContain('sin administradores efectivos');
  });
});

describe('desactivar / reactivar: acciones sensibles solo desde el detalle, con motivo', () => {
  test('desactivar: dialogo que nombra al usuario, motivo obligatorio, pedido con version + etag + motivo + clientRequestId', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    expect(t.visible('btn-uadm-desactivar')).toBe(true);
    expect(t.visible('btn-uadm-reactivar')).toBe(false);
    t.el['btn-uadm-desactivar'].click();
    await flush();
    const d = t.dlg();
    expect(d.titulo).toBe('Desactivar usuario');
    expect(d.texto).toContain('Ana Pérez (ana@x.com)');
    expect(d.motivoVisible).toBe(true);
    await t.confirmar('');
    expect(t.api.apiAdminUsuarioDesactivar).not.toHaveBeenCalled();
    await t.confirmar('se fue de la dependencia');
    expect(t.api.apiAdminUsuarioDesactivar).toHaveBeenCalledTimes(1);
    const pedido = t.api.apiAdminUsuarioDesactivar.mock.calls[0][1];
    expect(Object.keys(pedido).sort()).toEqual(['clientRequestId', 'email', 'etag', 'motivo', 'versionEsperada']);
    expect(pedido).toMatchObject({ email: 'ana@x.com', versionEsperada: 2, etag: 'etag-ana@x.com', motivo: 'se fue de la dependencia' });
    expect(t.texto('uadm-aviso')).toContain('Usuario desactivado.');
  });

  test('un usuario inactivo ofrece "Reactivar" (no "Desactivar"), tambien con motivo', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('baja@x.com');
    expect(t.visible('btn-uadm-desactivar')).toBe(false);
    expect(t.visible('btn-uadm-reactivar')).toBe(true);
    t.el['btn-uadm-reactivar'].click();
    await flush();
    expect(t.dlg().titulo).toBe('Reactivar usuario');
    await t.confirmar('vuelve');
    expect(t.api.apiAdminUsuarioReactivar.mock.calls[0][1]).toMatchObject({ email: 'baja@x.com', motivo: 'vuelve', versionEsperada: 2 });
    expect(t.texto('uadm-aviso')).toContain('Usuario reactivado.');
  });

  test('reactivar un EXTERNO avisa que requiere la gestion de externos; si esta apagada el backend lo rechaza y se explica', async () => {
    const t = montar({ usuarios: [V('ext@x.com', { nombre: 'Ext', tipo: 'EXTERNO', estado: 'inactivo' })], reactivar: () => Promise.resolve(err('E10_GESTION_EXTERNOS_INACTIVA')) });
    await t.abrirPantalla();
    await t.abrirDetalle('ext@x.com');
    t.el['btn-uadm-reactivar'].click();
    await flush();
    expect(t.dlg().texto).toContain('gestión de externos');
    await t.confirmar('vuelve');
    expect(t.texto('uadm-detalle-error')).toContain('gestión de usuarios externos está deshabilitada');
  });

  test('desactivar al ultimo administrador: el backend lo rechaza y la pantalla lo explica; el usuario sigue activo', async () => {
    const t = montar({ desactivar: () => Promise.resolve(err('ULTIMO_ADMIN')) });
    await t.abrirPantalla();
    await t.abrirDetalle('admin@x.com');
    t.el['btn-uadm-desactivar'].click();
    await flush();
    await t.confirmar('baja');
    expect(t.texto('uadm-detalle-error')).toContain('sin administradores efectivos');
    expect(t.texto('uadm-estado-texto')).toBe('Activo');
  });

  test('ya inactivo / ya activo (otro admin lo hizo antes): mensaje y recarga del detalle', async () => {
    const t = montar({ desactivar: () => Promise.resolve(err('USUARIO_YA_INACTIVO')) });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.el['btn-uadm-desactivar'].click();
    await flush();
    await t.confirmar('baja');
    expect(t.texto('uadm-detalle-error')).toContain('ya está inactivo');
    expect(t.api.apiAdminUsuarioObtener.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('cancelar el dialogo no hace ningun pedido', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.el['btn-uadm-desactivar'].click();
    await flush();
    await t.cancelar();
    expect(t.api.apiAdminUsuarioDesactivar).not.toHaveBeenCalled();
    expect(t.c.usuariosAdminController_hayModalAbierto()).toBe(false);
  });
});

describe('alta de usuario', () => {
  const llenar = (t, email, nombre) => { t.escribir('uadm-email', email); t.escribir('uadm-nombre', nombre); };

  test('"Nuevo usuario": formulario vacio con email editable, estado inicial y sin zona de desactivar', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    expect(t.texto('uadm-detalle-titulo')).toBe('Nuevo usuario');
    expect(t.el['uadm-email'].readOnly).toBe(false);
    expect(t.visible('uadm-email-nota')).toBe(false);
    expect(t.texto('uadm-estado-texto')).toBe('Se crea activo');
    expect(t.visible('uadm-zona-estado')).toBe(false);
    expect(t.visible('uadm-eventos-bloque')).toBe(false);
    expect(t.marcados()).toEqual([]);
    expect(t.el['btn-uadm-guardar'].textContent).toBe('Crear usuario');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
  });

  test('validacion de apoyo: email invalido o sin nombre no se puede crear', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    llenar(t, 'no-es-email', 'Nuevo');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
    expect(t.texto('uadm-form-aviso')).toContain('email válido');
    llenar(t, 'nuevo@x.com', '');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(true);
    llenar(t, 'nuevo@x.com', 'Nuevo');
    expect(t.el['btn-uadm-guardar'].disabled).toBe(false);
  });

  test('crear: confirmacion concreta, pedido con los campos exactos (sin actor), usuario nuevo abierto en su detalle y listado actualizado', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    llenar(t, ' Nuevo@X.com ', ' Nuevo Usuario ');
    await t.tocar('perfil', true);
    await t.tocar('datos', true);
    t.setUsuarios(USUARIOS.concat([V('nuevo@x.com', { nombre: 'Nuevo Usuario', version: 1 })]));
    t.el['btn-uadm-guardar'].click();
    await flush();
    const d = t.dlg();
    expect(d.titulo).toBe('Crear usuario');
    expect(d.texto).toContain('Nuevo Usuario (Nuevo@X.com');
    expect(d.motivoVisible).toBe(false);
    await t.confirmar();
    const pedido = t.api.apiAdminUsuarioCrear.mock.calls[0][1];
    expect(Object.keys(pedido).sort()).toEqual(['clientRequestId', 'email', 'nombre', 'permisos', 'tipo']);
    expect(pedido).toMatchObject({ email: 'Nuevo@X.com', nombre: 'Nuevo Usuario', tipo: 'INTERNO', permisos: ['perfil', 'datos'] });
    expect(t.texto('uadm-aviso')).toContain('Usuario creado.');
    expect(t.texto('uadm-detalle-titulo')).toBe('Nuevo Usuario');
    expect(t.el['uadm-email'].readOnly).toBe(true);
    expect(t.tarjetas()).toHaveLength(6);
  });

  test('crear un EXTERNO: sin la casilla de administracion disponible; y si el flag de externos esta apagado se explica', async () => {
    const t = montar({ crear: () => Promise.resolve(err('E10_GESTION_EXTERNOS_INACTIVA')) });
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    llenar(t, 'ext@x.com', 'Externo Nuevo');
    t.escribir('uadm-tipo', 'EXTERNO', 'change');
    expect(t.permiso('usuarios_admin').disabled).toBe(true);
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.dlg().texto).toContain('usuario externo');
    await t.confirmar();
    expect(t.texto('uadm-detalle-error')).toContain('gestión de usuarios externos está deshabilitada');
    expect(t.el['uadm-email'].readOnly).toBe(false);                // sigue en la alta: no se pierde lo escrito
    expect(t.el['uadm-nombre'].value).toBe('Externo Nuevo');
  });

  test('email duplicado: el mensaje explica que hacer', async () => {
    const t = montar({ crear: () => Promise.resolve(err('USUARIO_EXISTE')) });
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    llenar(t, 'ana@x.com', 'Otra Ana');
    t.el['btn-uadm-guardar'].click();
    await flush();
    await t.confirmar();
    expect(t.texto('uadm-detalle-error')).toContain('Ya existe un usuario con ese email');
  });

  test('crear un administrador INTERNO: la confirmacion es critica y explica el alcance', async () => {
    const t = montar();
    await t.abrirPantalla();
    t.el['btn-uadm-nuevo'].click();
    await flush();
    llenar(t, 'nuevoadmin@x.com', 'Nuevo Admin');
    await t.tocar('usuarios_admin', true);
    t.el['btn-uadm-guardar'].click();
    await flush();
    expect(t.dlg().texto).toContain('podrá crear y editar usuarios y permisos');
    expect(t.el['btn-uadm-dlg-confirmar'].className).toContain('uadm-peligro');
  });
});

describe('cambios sin guardar', () => {
  test('abrir otro usuario con cambios pendientes pide una decision explicita: cancelar los conserva, confirmar los descarta', async () => {
    const t = montar();
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'Cambio pendiente');
    await t.abrirDetalle('beto@x.com');
    expect(t.dlg().abierto).toBe(true);
    expect(t.dlg().titulo).toBe('Hay cambios sin guardar');
    expect(t.dlg().texto).toContain('Ana Pérez');
    await t.cancelar();
    expect(t.el['uadm-nombre'].value).toBe('Cambio pendiente');
    await t.abrirDetalle('beto@x.com');
    await t.confirmar();
    expect(t.texto('uadm-detalle-titulo')).toBe('Beto Gómez');
    expect(t.el['uadm-nombre'].value).toBe('Beto Gómez');
  });

  test('"Volver al listado" con cambios pendientes tambien pregunta; sin cambios vuelve directo', async () => {
    const t = montar({ ancho: 390 });
    await t.abrirPantalla();
    await t.abrirDetalle('ana@x.com');
    t.el['btn-uadm-detalle-volver'].click();
    await flush();
    expect(t.dlg().abierto).toBe(false);
    expect(t.visible('uadm-panel-lista')).toBe(true);
    await t.abrirDetalle('ana@x.com');
    t.escribir('uadm-nombre', 'X');
    t.el['btn-uadm-detalle-volver'].click();
    await flush();
    expect(t.dlg().titulo).toBe('Hay cambios sin guardar');
  });
});

describe('seguridad del controlador (guardas sobre el texto)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'usuariosAdmin.js'), 'utf8');
  const codigo = src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test('nunca innerHTML / insertAdjacentHTML / eval / document.write con datos', () => {
    expect(codigo).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|eval\(|document\.write|new Function/);
  });
  test('ninguna lista literal de permisos: ningun id del catalogo real aparece en el controlador', () => {
    ['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'mapa', 'ne', 'fotos', 'fotos_carga', 'fotos_moderar', 'observaciones', 'observaciones_agregar', 'observaciones_anular', 'reemplazo'].forEach((id) => {
      expect(codigo).not.toContain("'" + id + "'");
    });
  });
  test('el controlador nunca envia actor / ejecutor y el email de un usuario existente es de solo lectura', () => {
    expect(codigo).not.toMatch(/\b(actor|ejecutor|ejecutadoPor|emailActor)\s*:/);                     // ningun pedido arma un actor (ejecutadoPor solo se MUESTRA en el historial)
    expect(codigo).toContain('el.email.readOnly = !crearModo');
  });
  test('no guarda nada en localStorage / sessionStorage / cookies', () => {
    expect(codigo).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
  });
});
