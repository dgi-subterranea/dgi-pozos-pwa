// E10-1: reglas PURAS de usuarios: acceso efectivo, administrador efectivo, validacion de una mutacion (catalogo, EXTERNO + usuarios_admin, ULTIMO ADMIN), etag y eventos de auditoria.
Object.assign(global, require('../src/PermisosCatalogo'));
const D = require('../src/UsuariosDominio');

const U = (o) => Object.assign({ email: 'u@x.com', nombre: 'U', estado: 'activo', tipo: 'INTERNO', version: 1, permisos: global.permisosCatalogo_aObjeto(o.ids || []) }, o, { ids: undefined });
const admin = (email) => U({ email, ids: ['usuarios_admin'] });

describe('normalizadores (exactos salvo mayusculas y espacios)', () => {
  test('tipo: INTERNO | EXTERNO | vacio', () => {
    expect(D.usuariosDominio_normalizarTipo(' interno ')).toBe('INTERNO');
    expect(D.usuariosDominio_normalizarTipo('Externo')).toBe('EXTERNO');
    ['', 'ADMIN', 'int', null, undefined, 5, {}].forEach((v) => expect(D.usuariosDominio_normalizarTipo(v)).toBe(''));
  });

  test('estado: activo | inactivo | vacio', () => {
    expect(D.usuariosDominio_normalizarEstado(' Activo ')).toBe('activo');
    expect(D.usuariosDominio_normalizarEstado('INACTIVO')).toBe('inactivo');
    ['', 'baja', 'si', null, undefined].forEach((v) => expect(D.usuariosDominio_normalizarEstado(v)).toBe(''));
  });

  test('version: entero >= 0; todo lo demas es 0', () => {
    expect(D.usuariosDominio_normalizarVersion(3)).toBe(3);
    expect(D.usuariosDominio_normalizarVersion(' 7 ')).toBe(7);
    ['', 'x', -1, 1.5, null, undefined, NaN, {}].forEach((v) => expect(D.usuariosDominio_normalizarVersion(v)).toBe(0));
  });

  test('email', () => {
    expect(D.usuariosDominio_normalizarEmail('  Ana@X.COM ')).toBe('ana@x.com');
    ['a@b.co', 'x.y+z@d.gov.ar'].forEach((e) => expect(D.usuariosDominio_emailValido(e)).toBe(true));
    ['', 'a', 'a@b', 'a b@c.com', 'a@b.com,c@d.com', null, 5].forEach((e) => expect(D.usuariosDominio_emailValido(e)).toBe(false));
  });
});

describe('acceso efectivo', () => {
  const status = (o) => Object.assign({ found: true, active: true, nombre: 'N', tipo: 'INTERNO', version: 2, permisos: { perfil: true, usuarios_admin: true } }, o);

  test('INTERNO activo: sus permisos tal cual (TODOS los ids del catalogo, en booleano)', () => {
    const a = D.usuariosDominio_accesoEfectivo(status());
    expect(a).toMatchObject({ active: true, nombre: 'N', tipo: 'INTERNO', version: 2 });
    expect(Object.keys(a.permisos)).toHaveLength(17);
    expect(a.permisos.perfil).toBe(true);
    expect(a.permisos.usuarios_admin).toBe(true);
    expect(a.permisos.datos).toBe(false);
  });

  test('tipo NO concede permisos: un EXTERNO conserva exactamente los que la hoja le da (salvo usuarios_admin)', () => {
    const a = D.usuariosDominio_accesoEfectivo(status({ tipo: 'EXTERNO', permisos: { perfil: true, perfil_subir: true, ubicacion: true, ubicacion_corregir: true, mapa: true, fotos: true } }));
    expect(global.permisosCatalogo_aLista(a.permisos)).toEqual(['perfil', 'perfil_subir', 'ubicacion', 'ubicacion_corregir', 'mapa', 'fotos']);
    expect(a.active).toBe(true);
  });

  test('un EXTERNO con usuarios_admin = SI en la hoja NO es administrador efectivo (regla dura, aunque alguien edite la hoja)', () => {
    const a = D.usuariosDominio_accesoEfectivo(status({ tipo: 'EXTERNO' }));
    expect(a.permisos.usuarios_admin).toBe(false);
    expect(a.permisos.perfil).toBe(true);        // el resto no se toca
  });

  test.each([[''], ['SUPERVISOR'], [null], [undefined]])('tipo vacio o invalido (%j): usuarios_admin no es efectivo; el acceso por permisos no cambia', (tipo) => {
    const a = D.usuariosDominio_accesoEfectivo(status({ tipo }));
    expect(a.tipo).toBe('');
    expect(a.permisos.usuarios_admin).toBe(false);
    expect(a.permisos.perfil).toBe(true);
    expect(a.active).toBe(true);
  });

  test('usuario inactivo o inexistente: sin ningun permiso', () => {
    [status({ active: false }), status({ found: false }), null, undefined, {}].forEach((s) => {
      const a = D.usuariosDominio_accesoEfectivo(s);
      expect(a.active).toBe(false);
      Object.keys(a.permisos).forEach((k) => expect(a.permisos[k]).toBe(false));
    });
  });

  test('solo booleano estricto: "SI", 1 o un objeto no habilitan', () => {
    const a = D.usuariosDominio_accesoEfectivo(status({ permisos: { perfil: 'SI', datos: 1, ne: {}, mapa: true } }));
    expect(global.permisosCatalogo_aLista(a.permisos)).toEqual(['mapa']);
  });

  test('un permiso que no es del catalogo se ignora', () => {
    const a = D.usuariosDominio_accesoEfectivo(status({ permisos: { perfil: true, inventado: true } }));
    expect(a.permisos.inventado).toBeUndefined();
  });
});

describe('administrador efectivo = estado activo + tipo INTERNO + usuarios_admin = SI', () => {
  test.each([
    ['activo + INTERNO + admin', admin('a@x.com'), true],
    ['inactivo', Object.assign(admin('a@x.com'), { estado: 'inactivo' }), false],
    ['EXTERNO', Object.assign(admin('a@x.com'), { tipo: 'EXTERNO' }), false],
    ['tipo vacio', Object.assign(admin('a@x.com'), { tipo: '' }), false],
    ['sin usuarios_admin', U({ email: 'a@x.com', ids: ['perfil'] }), false]
  ])('%s -> %s', (_n, u, esperado) => {
    expect(D.usuariosDominio_esAdminEfectivo(u)).toBe(esperado);
  });

  test('contarAdmins', () => {
    expect(D.usuariosDominio_contarAdmins([admin('a@x.com'), admin('b@x.com'), U({ email: 'c@x.com' }), Object.assign(admin('d@x.com'), { estado: 'inactivo' })])).toBe(2);
    expect(D.usuariosDominio_contarAdmins([])).toBe(0);
    expect(D.usuariosDominio_contarAdmins(null)).toBe(0);
  });
});

describe('validarMutacion', () => {
  const dos = [admin('a@x.com'), admin('b@x.com'), U({ email: 'c@x.com', ids: ['perfil'] })];
  const val = (antes, despues, todos, op) => D.usuariosDominio_validarMutacion(antes, despues, todos || dos, op || { cambiaPermisos: true });

  test('una mutacion valida pasa', () => {
    expect(val(dos[2], Object.assign({}, dos[2], { nombre: 'Nuevo Nombre' }), dos, { cambiaPermisos: false })).toEqual({ ok: true });
  });

  test.each([
    ['email invalido', { email: 'x' }, 'EMAIL_INVALIDO'],
    ['nombre vacio', { nombre: '  ' }, 'NOMBRE_INVALIDO'],
    ['nombre demasiado largo', { nombre: 'x'.repeat(81) }, 'NOMBRE_INVALIDO'],
    ['estado invalido', { estado: 'baja' }, 'ESTADO_INVALIDO'],
    ['tipo invalido', { tipo: 'ROOT' }, 'TIPO_INVALIDO']
  ])('%s -> %s', (_n, cambio, codigo) => {
    const r = val(dos[2], Object.assign({}, dos[2], cambio));
    expect(r).toMatchObject({ ok: false, codigo });
  });

  test('EXTERNO + usuarios_admin se rechaza SIEMPRE, sea alta o edicion, aunque no se toquen los permisos', () => {
    const externoAdmin = Object.assign(admin('c@x.com'), { tipo: 'EXTERNO' });
    expect(val(null, externoAdmin)).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(val(dos[2], externoAdmin)).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    expect(val(dos[2], externoAdmin, dos, { cambiaPermisos: false })).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
  });

  test('un EXTERNO con cualquier otro permiso es valido (no se decide politica externa)', () => {
    const e = U({ email: 'e@x.com', tipo: 'EXTERNO', ids: ['perfil', 'perfil_subir', 'ubicacion', 'ubicacion_corregir', 'mapa'] });
    expect(val(null, e)).toEqual({ ok: true });
  });

  test('dependencias entre permisos: se exigen en un alta y cuando se tocan los permisos, no al editar solo el nombre de una combinacion historica', () => {
    const historico = U({ email: 'h@x.com', ids: ['fotos_moderar'] });     // fotos_moderar sin fotos (asi estaba en la hoja)
    expect(val(null, historico)).toMatchObject({ ok: false, codigo: 'PERMISOS_INCONSISTENTES' });
    expect(val(historico, historico, [historico].concat(dos), { cambiaPermisos: true })).toMatchObject({ ok: false, codigo: 'PERMISOS_INCONSISTENTES' });
    expect(val(historico, Object.assign({}, historico, { nombre: 'Otro' }), [historico].concat(dos), { cambiaPermisos: false })).toEqual({ ok: true });
  });

  describe('ULTIMO ADMIN: nunca 0 administradores efectivos', () => {
    const unico = [admin('a@x.com'), U({ email: 'c@x.com', ids: ['perfil'] })];

    test('desactivar al unico administrador', () => {
      expect(val(unico[0], Object.assign({}, unico[0], { estado: 'inactivo' }), unico)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });

    test('quitar usuarios_admin al unico administrador', () => {
      expect(val(unico[0], Object.assign({}, unico[0], { permisos: global.permisosCatalogo_aObjeto([]) }), unico)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });

    test('cambiar el tipo del unico administrador a EXTERNO (quitandole usuarios_admin en el mismo cambio)', () => {
      const sinAdmin = Object.assign({}, unico[0], { tipo: 'EXTERNO', permisos: global.permisosCatalogo_aObjeto([]) });
      expect(val(unico[0], sinAdmin, unico)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });

    test('cambiar el tipo del unico administrador a EXTERNO conservando usuarios_admin: se rechaza por la regla dura', () => {
      expect(val(unico[0], Object.assign({}, unico[0], { tipo: 'EXTERNO' }), unico)).toMatchObject({ ok: false, codigo: 'TIPO_NO_PERMITE_PERMISO' });
    });

    test('un administrador inactivo no cuenta: desactivar al unico ACTIVO deja 0', () => {
      const lista = [admin('a@x.com'), Object.assign(admin('b@x.com'), { estado: 'inactivo' })];
      expect(val(lista[0], Object.assign({}, lista[0], { estado: 'inactivo' }), lista)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });

    test('un EXTERNO con usuarios_admin tampoco cuenta', () => {
      const lista = [admin('a@x.com'), Object.assign(admin('b@x.com'), { tipo: 'EXTERNO' })];
      expect(val(lista[0], Object.assign({}, lista[0], { estado: 'inactivo' }), lista)).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });

    test('con DOS administradores se puede desactivar o degradar a uno (queda el otro)', () => {
      expect(val(dos[0], Object.assign({}, dos[0], { estado: 'inactivo' }))).toEqual({ ok: true });
      expect(val(dos[0], Object.assign({}, dos[0], { permisos: global.permisosCatalogo_aObjeto([]) }))).toEqual({ ok: true });
    });

    test('dar usuarios_admin a un tercero no esta bloqueado; crear al primer administrador desde cero tampoco (alta de un admin)', () => {
      expect(val(dos[2], Object.assign({}, dos[2], { permisos: global.permisosCatalogo_aObjeto(['perfil', 'usuarios_admin']) }))).toEqual({ ok: true });
      expect(val(null, admin('nuevo@x.com'), [])).toEqual({ ok: true });
    });

    test('una mutacion que no toca administradores se rechaza igual si el sistema ya quedo sin ninguno (nunca se agrava)', () => {
      const sinAdmins = [U({ email: 'c@x.com', ids: ['perfil'] })];
      expect(val(sinAdmins[0], Object.assign({}, sinAdmins[0], { nombre: 'Otro' }), sinAdmins, { cambiaPermisos: false })).toMatchObject({ ok: false, codigo: 'ULTIMO_ADMIN' });
    });
  });
});

describe('etag', () => {
  test('cambia con cualquier dato editable (nombre, tipo, estado, permisos) y no con la version ni el orden', () => {
    const base = U({ email: 'a@x.com', ids: ['perfil', 'datos'] });
    const e0 = D.usuariosDominio_etag(base);
    expect(e0).toMatch(/^[0-9a-f]{16}$/);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { version: 99 }))).toBe(e0);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { nombre: 'Otro' }))).not.toBe(e0);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { tipo: 'EXTERNO' }))).not.toBe(e0);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { estado: 'inactivo' }))).not.toBe(e0);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { permisos: global.permisosCatalogo_aObjeto(['perfil']) }))).not.toBe(e0);
    expect(D.usuariosDominio_etag(Object.assign({}, base, { permisos: global.permisosCatalogo_aObjeto(['datos', 'perfil']) }))).toBe(e0);
  });
});

describe('eventos de auditoria', () => {
  const antes = U({ email: 'a@x.com', nombre: 'Ana', ids: ['perfil'], version: 2 });

  test('alta -> USUARIO_CREADO con el estado completo', () => {
    const e = D.usuariosDominio_eventosDe(null, Object.assign({}, antes, { version: 1 }));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ evento: 'USUARIO_CREADO', usuarioObjetivo: 'a@x.com', nombreObjetivo: 'Ana', nombreAnterior: '', tipoAnterior: '', tipoNuevo: 'INTERNO', estadoAnterior: '', estadoNuevo: 'activo', versionAnterior: 0, versionNueva: 1, permisosAntes: '', permisosDespues: 'perfil' });
  });

  test('cambio de permisos -> PERMISOS_MODIFICADOS con antes y despues', () => {
    const e = D.usuariosDominio_eventosDe(antes, Object.assign({}, antes, { version: 3, permisos: global.permisosCatalogo_aObjeto(['perfil', 'mapa']) }));
    expect(e.map((x) => x.evento)).toEqual(['PERMISOS_MODIFICADOS']);
    expect(e[0]).toMatchObject({ permisosAntes: 'perfil', permisosDespues: 'perfil,mapa', versionAnterior: 2, versionNueva: 3 });
  });

  test('cambio de nombre o tipo -> USUARIO_EDITADO; ambos cambios (nombre y permisos) generan DOS eventos con las mismas versiones', () => {
    const e = D.usuariosDominio_eventosDe(antes, Object.assign({}, antes, { version: 3, nombre: 'Ana Maria', permisos: global.permisosCatalogo_aObjeto(['perfil', 'ne']) }));
    expect(e.map((x) => x.evento)).toEqual(['USUARIO_EDITADO', 'PERMISOS_MODIFICADOS']);
    expect(e.every((x) => x.versionAnterior === 2 && x.versionNueva === 3)).toBe(true);
    expect(e[0]).toMatchObject({ nombreAnterior: 'Ana', nombreObjetivo: 'Ana Maria' });
    expect(D.usuariosDominio_eventosDe(antes, Object.assign({}, antes, { version: 3, tipo: 'EXTERNO' })).map((x) => x.evento)).toEqual(['USUARIO_EDITADO']);
  });

  test('baja y reactivacion', () => {
    expect(D.usuariosDominio_eventosDe(antes, Object.assign({}, antes, { version: 3, estado: 'inactivo' })).map((x) => x.evento)).toEqual(['USUARIO_DESACTIVADO']);
    expect(D.usuariosDominio_eventosDe(Object.assign({}, antes, { estado: 'inactivo' }), Object.assign({}, antes, { version: 3 })).map((x) => x.evento)).toEqual(['USUARIO_REACTIVADO']);
  });

  test('sin cambios -> ningun evento', () => {
    expect(D.usuariosDominio_eventosDe(antes, Object.assign({}, antes, { version: 3 }))).toEqual([]);
  });

  test('los eventos nunca llevan secretos ni campos ajenos al esquema', () => {
    const e = D.usuariosDominio_eventosDe(null, antes)[0];
    expect(Object.keys(e).sort()).toEqual(['estadoAnterior', 'estadoNuevo', 'evento', 'nombreAnterior', 'nombreObjetivo', 'permisosAntes', 'permisosDespues', 'tipoAnterior', 'tipoNuevo', 'usuarioObjetivo', 'versionAnterior', 'versionNueva']);
  });
});
