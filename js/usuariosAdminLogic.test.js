// E10-2: logica pura de Administracion -> Usuarios (js/usuariosAdminLogic.js): visibilidad por permiso, layout, filtros locales, agrupacion del catalogo, dependencias SIN cascadas invisibles, diferencias,
// motivo obligatorio, confirmaciones concretas, mensajes de error por codigo e id de intencion.
const fs = require('fs');
const path = require('path');
const L = require('./usuariosAdminLogic');

// Catalogo de PRUEBA (el frontend real lo recibe del backend: aca se arma a mano solo para los tests).
const P = (id, nombre, modulo, orden, extra) => Object.assign({ id, nombre, descripcion: 'Descripcion de ' + nombre, modulo, categoria: 'lectura', aplicableInterno: true, aplicableExterno: true, dependeDe: [], critico: false, orden }, extra || {});
const CATALOGO = [
  P('perfil', 'Ver ITF', 'Perfil / ITF', 10),
  P('perfil_subir', 'Proponer ITF', 'Perfil / ITF', 20, { dependeDe: ['perfil'], categoria: 'escritura' }),
  P('perfil_validar', 'Validar ITF', 'Perfil / ITF', 30, { dependeDe: ['perfil'], categoria: 'moderacion', critico: true }),
  P('datos', 'Ver ficha', 'Datos', 40),
  P('fotos', 'Ver fotos', 'Fotos', 60),
  P('fotos_moderar', 'Moderar fotos', 'Fotos', 62, { dependeDe: ['fotos'], categoria: 'moderacion' }),
  P('cadena_a', 'Cadena A', 'Cadena', 70),
  P('cadena_b', 'Cadena B', 'Cadena', 71, { dependeDe: ['cadena_a'] }),
  P('cadena_c', 'Cadena C', 'Cadena', 72, { dependeDe: ['cadena_b'] }),
  P('usuarios_admin', 'Administrar usuarios y permisos', 'Administracion', 90, { aplicableExterno: false, critico: true, categoria: 'administracion' })
];
const U = (extra) => Object.assign({ email: 'ana@x.com', nombre: 'Ana Pérez', tipo: 'INTERNO', estado: 'activo', version: 3, etag: 'abc', permisos: ['perfil'], cantidadPermisos: 1, esAdmin: false, actualizadoUtc: '2026-11-05T15:04:38.896Z', actualizadoPor: 'migracion:E10-1' }, extra || {});

describe('visibilidad: solo usuarios_admin === true exacto', () => {
  test.each([[{ usuarios_admin: true }, true], [{ usuarios_admin: false }, false], [{}, false], [null, false], [undefined, false], [{ usuarios_admin: 'SI' }, false], [{ usuarios_admin: 1 }, false], [{ admin: true }, false]])('%j -> %s', (permisos, esperado) => {
    expect(L.usuariosAdminLogic_puedeVer(permisos)).toBe(esperado);
  });
});

describe('layout responsive', () => {
  test('doble (listado + detalle) desde 900 px; simple (una cosa por vez) en el celular', () => {
    expect(L.usuariosAdminLogic_modoLayout(1280)).toBe('doble');
    expect(L.usuariosAdminLogic_modoLayout(900)).toBe('doble');
    expect(L.usuariosAdminLogic_modoLayout(899)).toBe('simple');
    expect(L.usuariosAdminLogic_modoLayout(375)).toBe('simple');
    expect(L.usuariosAdminLogic_modoLayout(undefined)).toBe('simple');
    expect(L.usuariosAdminLogic_modoLayout('1200')).toBe('simple');
  });
});

describe('filtros locales (nombre / email, activo / inactivo, interno / externo, administrador)', () => {
  const LISTA = [
    U({ email: 'ana@x.com', nombre: 'Ana Pérez' }),
    U({ email: 'beto@x.com', nombre: 'Alberto Gómez', tipo: 'EXTERNO' }),
    U({ email: 'cora@dgi.mendoza.gov.ar', nombre: 'Cora Díaz', estado: 'inactivo' }),
    U({ email: 'admin@x.com', nombre: 'Admin Uno', esAdmin: true })
  ];
  const f = (extra) => L.usuariosAdminLogic_filtrar(LISTA, Object.assign({ texto: '', estado: 'todos', tipo: 'todos', admin: 'todos' }, extra || {})).map((u) => u.email);

  test('sin filtros: todos', () => { expect(f()).toHaveLength(4); });
  test('texto: por nombre o email, sin tildes ni mayusculas, todas las palabras', () => {
    expect(f({ texto: 'perez' })).toEqual(['ana@x.com']);
    expect(f({ texto: 'PÉREZ' })).toEqual(['ana@x.com']);
    expect(f({ texto: 'gov.ar' })).toEqual(['cora@dgi.mendoza.gov.ar']);
    expect(f({ texto: 'ana perez' })).toEqual(['ana@x.com']);
    expect(f({ texto: 'ana beto' })).toEqual([]);
    expect(f({ texto: '  ' })).toHaveLength(4);
    expect(f({ texto: 'diaz' })).toEqual(['cora@dgi.mendoza.gov.ar']);
  });
  test('estado, tipo y administrador', () => {
    expect(f({ estado: 'inactivo' })).toEqual(['cora@dgi.mendoza.gov.ar']);
    expect(f({ estado: 'activo' })).toHaveLength(3);
    expect(f({ tipo: 'EXTERNO' })).toEqual(['beto@x.com']);
    expect(f({ tipo: 'INTERNO' })).toHaveLength(3);
    expect(f({ admin: 'admin' })).toEqual(['admin@x.com']);
    expect(f({ admin: 'no_admin' })).toHaveLength(3);
  });
  test('combinados', () => {
    expect(f({ estado: 'activo', tipo: 'INTERNO', admin: 'no_admin', texto: 'ana' })).toEqual(['ana@x.com']);
    expect(f({ estado: 'inactivo', tipo: 'EXTERNO' })).toEqual([]);
  });
  test('no depende de la cantidad: 5000 usuarios', () => {
    const muchos = [];
    for (let i = 0; i < 5000; i += 1) { muchos.push(U({ email: 'u' + i + '@x.com', nombre: 'Usuario ' + i })); }
    expect(L.usuariosAdminLogic_filtrar(muchos, { texto: 'usuario 4999' })).toHaveLength(1);
    expect(L.usuariosAdminLogic_filtrar(muchos, {})).toHaveLength(5000);
  });
  test('no muta la lista ni falla con entradas raras', () => {
    expect(L.usuariosAdminLogic_filtrar(null, {})).toEqual([]);
    expect(L.usuariosAdminLogic_filtrar(LISTA)).toHaveLength(4);
    expect(L.usuariosAdminLogic_filtrar([{ email: 'x@x.com' }], { texto: 'x' })).toHaveLength(1);
  });
  test('resumen del listado', () => {
    expect(L.usuariosAdminLogic_resumenListado(11, 11)).toBe('11 usuarios');
    expect(L.usuariosAdminLogic_resumenListado(1, 1)).toBe('1 usuario');
    expect(L.usuariosAdminLogic_resumenListado(11, 3)).toBe('3 de 11 usuarios');
  });
  test('tarjeta: nombre, email, estado, tipo, cantidad de permisos, admin, ultima actualizacion', () => {
    const t = L.usuariosAdminLogic_tarjeta(U({ esAdmin: true, cantidadPermisos: 17, tipo: 'EXTERNO', estado: 'inactivo' }));
    expect(t).toMatchObject({ nombre: 'Ana Pérez', email: 'ana@x.com', activo: false, estadoTexto: 'Inactivo', tipoTexto: 'Externo', externo: true, esAdmin: true, permisosTexto: '17 permisos' });
    expect(t.actualizado).toMatch(/^\d\d\/\d\d\/2026 \d\d:\d\d$/);
    expect(L.usuariosAdminLogic_tarjeta(U({ cantidadPermisos: 1 })).permisosTexto).toBe('1 permiso');
    expect(L.usuariosAdminLogic_tarjeta(U({ nombre: '' })).nombre).toBe('ana@x.com');
    expect(L.usuariosAdminLogic_tarjeta(U({ actualizadoUtc: '' })).actualizado).toBe('—');
  });
});

describe('catalogo: agrupacion y aplicabilidad (todo viene del backend, nada literal)', () => {
  test('agrupa por modulo en el orden del catalogo y ordena los permisos por `orden`', () => {
    const g = L.usuariosAdminLogic_agruparCatalogo(CATALOGO.slice().reverse());
    expect(g.map((x) => x.modulo)).toEqual(['Perfil / ITF', 'Datos', 'Fotos', 'Cadena', 'Administracion']);
    expect(g[0].permisos.map((p) => p.id)).toEqual(['perfil', 'perfil_subir', 'perfil_validar']);
  });
  test('aplicabilidad: el techo EXTERNO sale del catalogo (aplicableExterno = false)', () => {
    const admin = CATALOGO.find((p) => p.id === 'usuarios_admin');
    expect(L.usuariosAdminLogic_aplicable(admin, 'INTERNO')).toBe(true);
    expect(L.usuariosAdminLogic_aplicable(admin, 'EXTERNO')).toBe(false);
    expect(L.usuariosAdminLogic_aplicable(CATALOGO[0], 'EXTERNO')).toBe(true);
    expect(L.usuariosAdminLogic_aplicable(null, 'INTERNO')).toBe(false);
  });
  test('nombre de un permiso (y el id si no esta en el catalogo)', () => {
    expect(L.usuariosAdminLogic_nombrePermiso(CATALOGO, 'perfil')).toBe('Ver ITF');
    expect(L.usuariosAdminLogic_nombrePermiso(CATALOGO, 'inexistente')).toBe('inexistente');
  });
});

describe('dependencias: sin cascadas invisibles', () => {
  test('activar con el requerido apagado: informa los faltantes (transitivos)', () => {
    expect(L.usuariosAdminLogic_alActivar(CATALOGO, [], 'perfil_validar').faltantes).toEqual(['perfil']);
    expect(L.usuariosAdminLogic_alActivar(CATALOGO, ['perfil'], 'perfil_validar').faltantes).toEqual([]);
    expect(L.usuariosAdminLogic_alActivar(CATALOGO, [], 'cadena_c').faltantes.sort()).toEqual(['cadena_a', 'cadena_b']);
    expect(L.usuariosAdminLogic_alActivar(CATALOGO, ['cadena_a'], 'cadena_c').faltantes).toEqual(['cadena_b']);
    expect(L.usuariosAdminLogic_alActivar(CATALOGO, [], 'datos').faltantes).toEqual([]);
  });
  test('activar SIN aceptar los requeridos solo agrega ese permiso; aceptando, agrega tambien los requeridos, en orden de catalogo', () => {
    expect(L.usuariosAdminLogic_activar(CATALOGO, [], 'perfil_validar', false)).toEqual(['perfil_validar']);
    expect(L.usuariosAdminLogic_activar(CATALOGO, [], 'perfil_validar', true)).toEqual(['perfil', 'perfil_validar']);
    expect(L.usuariosAdminLogic_activar(CATALOGO, ['datos'], 'cadena_c', true)).toEqual(['datos', 'cadena_a', 'cadena_b', 'cadena_c']);
    expect(L.usuariosAdminLogic_activar(CATALOGO, ['perfil'], 'perfil', true)).toEqual(['perfil']);
  });
  test('quitar un padre: informa los dependientes (transitivos) y NO los apaga solos', () => {
    expect(L.usuariosAdminLogic_alQuitar(CATALOGO, ['perfil', 'perfil_subir', 'datos'], 'perfil').dependientes).toEqual(['perfil_subir']);
    expect(L.usuariosAdminLogic_alQuitar(CATALOGO, ['cadena_a', 'cadena_b', 'cadena_c'], 'cadena_a').dependientes.sort()).toEqual(['cadena_b', 'cadena_c']);
    expect(L.usuariosAdminLogic_alQuitar(CATALOGO, ['perfil'], 'perfil').dependientes).toEqual([]);
    expect(L.usuariosAdminLogic_alQuitar(CATALOGO, ['datos'], 'perfil').dependientes).toEqual([]);
    // sin decision explicita solo se quita el elegido (el que llama debio advertir antes)
    expect(L.usuariosAdminLogic_quitar(CATALOGO, ['perfil', 'perfil_subir'], 'perfil', false)).toEqual(['perfil_subir']);
    // con decision explicita se quitan tambien los dependientes
    expect(L.usuariosAdminLogic_quitar(CATALOGO, ['perfil', 'perfil_subir', 'perfil_validar', 'datos'], 'perfil', true)).toEqual(['datos']);
  });
  test('no muta la seleccion original', () => {
    const sel = ['perfil', 'perfil_subir'];
    L.usuariosAdminLogic_quitar(CATALOGO, sel, 'perfil', true);
    L.usuariosAdminLogic_activar(CATALOGO, sel, 'datos', false);
    expect(sel).toEqual(['perfil', 'perfil_subir']);
  });
  test('ciclos en el catalogo no cuelgan el calculo', () => {
    const ciclo = [P('a', 'A', 'M', 1, { dependeDe: ['b'] }), P('b', 'B', 'M', 2, { dependeDe: ['a'] })];
    expect(L.usuariosAdminLogic_requeridos(ciclo, 'a').sort()).toEqual(['a', 'b']);
  });
});

describe('validacion de apoyo de la seleccion (el backend siempre valida)', () => {
  test('valida: dependencias, aplicabilidad al tipo y permisos desconocidos, con los codigos del backend', () => {
    expect(L.usuariosAdminLogic_validarSeleccion(CATALOGO, 'INTERNO', ['perfil', 'perfil_subir']).ok).toBe(true);
    const dep = L.usuariosAdminLogic_validarSeleccion(CATALOGO, 'INTERNO', ['perfil_subir']);
    expect(dep.errores.map((e) => e.codigo)).toEqual(['PERMISOS_INCONSISTENTES']);
    expect(dep.errores[0].mensaje).toContain('Ver ITF');
    const ext = L.usuariosAdminLogic_validarSeleccion(CATALOGO, 'EXTERNO', ['usuarios_admin']);
    expect(ext.errores.map((e) => e.codigo)).toEqual(['TIPO_NO_PERMITE_PERMISO']);
    expect(L.usuariosAdminLogic_validarSeleccion(CATALOGO, 'INTERNO', ['usuarios_admin']).ok).toBe(true);
    expect(L.usuariosAdminLogic_validarSeleccion(CATALOGO, 'INTERNO', ['volar']).errores[0].codigo).toBe('PERMISO_DESCONOCIDO');
  });
});

describe('diferencias, motivo obligatorio y confirmaciones concretas', () => {
  const ORIG = { nombre: 'Ana', tipo: 'INTERNO', permisos: ['perfil', 'usuarios_admin'] };
  test('diferencias: nombre, tipo, permisos agregados y quitados', () => {
    expect(L.usuariosAdminLogic_diferencias(ORIG, ORIG)).toMatchObject({ hayCambios: false, nombre: null, tipo: null, agregados: [], quitados: [] });
    const d = L.usuariosAdminLogic_diferencias(ORIG, { nombre: ' Ana M ', tipo: 'EXTERNO', permisos: ['perfil', 'datos'] });
    expect(d).toMatchObject({ hayCambios: true, nombre: { antes: 'Ana', despues: 'Ana M' }, tipo: { antes: 'INTERNO', despues: 'EXTERNO' }, agregados: ['datos'], quitados: ['usuarios_admin'] });
    expect(L.usuariosAdminLogic_diferencias(ORIG, { nombre: 'Ana', tipo: 'INTERNO', permisos: ['usuarios_admin', 'perfil'] }).hayCambios).toBe(false);     // el orden no es un cambio
  });
  test('motivo OBLIGATORIO: desactivar, reactivar, quitar usuarios_admin y cambiar de tipo; opcional para nombre y permisos comunes', () => {
    expect(L.usuariosAdminLogic_requiereMotivo('DESACTIVAR')).toBe(true);
    expect(L.usuariosAdminLogic_requiereMotivo('REACTIVAR')).toBe(true);
    expect(L.usuariosAdminLogic_requiereMotivo('ACTUALIZAR', ORIG, Object.assign({}, ORIG, { permisos: ['perfil'] }))).toBe(true);        // quita usuarios_admin
    expect(L.usuariosAdminLogic_requiereMotivo('ACTUALIZAR', ORIG, Object.assign({}, ORIG, { tipo: 'EXTERNO' }))).toBe(true);
    expect(L.usuariosAdminLogic_requiereMotivo('ACTUALIZAR', ORIG, Object.assign({}, ORIG, { nombre: 'Otro' }))).toBe(false);
    expect(L.usuariosAdminLogic_requiereMotivo('ACTUALIZAR', ORIG, Object.assign({}, ORIG, { permisos: ['perfil', 'usuarios_admin', 'datos'] }))).toBe(false);   // agregar permisos comunes
    expect(L.usuariosAdminLogic_requiereMotivo('ACTUALIZAR', { nombre: 'B', tipo: 'INTERNO', permisos: ['perfil'] }, { nombre: 'B', tipo: 'INTERNO', permisos: ['perfil', 'usuarios_admin'] })).toBe(false);  // CONCEDER admin: confirmacion, no motivo
    expect(L.usuariosAdminLogic_requiereMotivo('CREAR')).toBe(false);
  });
  test('confirmaciones CONCRETAS (nada de "¿Esta seguro?")', () => {
    const u = { nombre: 'Ana Pérez', email: 'ana@x.com', tipo: 'INTERNO' };
    const des = L.usuariosAdminLogic_confirmacion('DESACTIVAR', u, u, u, CATALOGO);
    expect(des).toMatchObject({ titulo: 'Desactivar usuario', boton: 'Desactivar usuario', pideMotivo: true, critica: true });
    expect(des.lineas.join(' ')).toContain('Ana Pérez (ana@x.com)');
    expect(des.lineas.join(' ')).toContain('no se borra nada');
    const rea = L.usuariosAdminLogic_confirmacion('REACTIVAR', Object.assign({}, u, { tipo: 'EXTERNO' }), u, u, CATALOGO);
    expect(rea.pideMotivo).toBe(true);
    expect(rea.lineas.join(' ')).toContain('gestión de externos');
    const tipo = L.usuariosAdminLogic_confirmacion('ACTUALIZAR', u, ORIG, { nombre: 'Ana', tipo: 'EXTERNO', permisos: ['perfil'] }, CATALOGO);
    expect(tipo.lineas.join(' ')).toContain('de interno a externo');
    expect(tipo.lineas.join(' ')).toContain('no concede ni quita permisos');
    expect(tipo.pideMotivo).toBe(true);
    const conceder = L.usuariosAdminLogic_confirmacion('ACTUALIZAR', u, { nombre: 'Ana', tipo: 'INTERNO', permisos: ['perfil'] }, { nombre: 'Ana', tipo: 'INTERNO', permisos: ['perfil', 'usuarios_admin'] }, CATALOGO);
    expect(conceder.lineas.join(' ')).toContain('Le das «Administrar usuarios y permisos»');
    expect(conceder).toMatchObject({ pideMotivo: false, critica: true });
    const quitar = L.usuariosAdminLogic_confirmacion('ACTUALIZAR', u, ORIG, { nombre: 'Ana', tipo: 'INTERNO', permisos: ['perfil'] }, CATALOGO);
    expect(quitar.lineas.join(' ')).toContain('Le quitás «Administrar usuarios y permisos»');
    expect(quitar.pideMotivo).toBe(true);
    // un cambio comun no pide confirmacion
    expect(L.usuariosAdminLogic_confirmacion('ACTUALIZAR', u, ORIG, { nombre: 'Ana M', tipo: 'INTERNO', permisos: ['perfil', 'usuarios_admin', 'datos'] }, CATALOGO)).toBeNull();
    const alta = L.usuariosAdminLogic_confirmacion('CREAR', null, null, { email: 'n@x.com', nombre: 'Nueva', tipo: 'EXTERNO', permisos: ['perfil'] }, CATALOGO);
    expect(alta.lineas[0]).toContain('Nueva (n@x.com) como usuario externo con 1 permiso(s)');
    expect(L.usuariosAdminLogic_confirmacion('CREAR', null, null, { email: 'n@x.com', nombre: 'N', tipo: 'INTERNO', permisos: ['usuarios_admin'] }, CATALOGO).critica).toBe(true);
    ['DESACTIVAR', 'REACTIVAR', 'ACTUALIZAR', 'CREAR'].forEach((a) => {
      const c = L.usuariosAdminLogic_confirmacion(a, u, ORIG, { nombre: 'Ana', tipo: 'EXTERNO', permisos: ['usuarios_admin'] }, CATALOGO);
      if (c) { expect(c.lineas.join(' ')).not.toMatch(/¿Est[aá] seguro\?/i); }
    });
  });
});

describe('errores: un mensaje util por codigo (nunca "algo salio mal" si hay codigo conocido)', () => {
  const CODIGOS = ['E10_ADMIN_INACTIVO', 'E10_GESTION_EXTERNOS_INACTIVA', 'PERMISSION_DENIED', 'CONFLICT_VERSION', 'ULTIMO_ADMIN', 'USUARIO_EXISTE', 'EMAIL_INVALIDO', 'NOMBRE_INVALIDO', 'TIPO_INVALIDO', 'PERMISO_DESCONOCIDO', 'PERMISOS_INCONSISTENTES',
    'TIPO_NO_PERMITE_PERMISO', 'USUARIO_NO_ENCONTRADO', 'USUARIO_YA_INACTIVO', 'USUARIO_YA_ACTIVO', 'MOTIVO_REQUERIDO', 'EMAIL_DUPLICADO_EN_HOJA', 'AUDITORIA_NO_DISPONIBLE', 'SERVICE_UNAVAILABLE', 'INVALID_REQUEST', 'UNAUTHORIZED', 'USER_DISABLED'];
  test.each(CODIGOS)('%s tiene mensaje propio, distinto del generico', (c) => {
    const m = L.usuariosAdminLogic_mensajeError(c);
    expect(m.length).toBeGreaterThan(20);
    expect(m).not.toMatch(/algo sali/i);
    expect(m).not.toContain('código');
  });
  test('los mensajes son DISTINTOS entre si (cada codigo explica lo suyo)', () => {
    expect(new Set(CODIGOS.map((c) => L.usuariosAdminLogic_mensajeError(c))).size).toBe(CODIGOS.length);
  });
  test('los que mencionan las reglas lo dicen: administracion deshabilitada, externos, ultimo admin, conflicto', () => {
    expect(L.usuariosAdminLogic_mensajeError('E10_ADMIN_INACTIVO')).toContain('deshabilitada');
    expect(L.usuariosAdminLogic_mensajeError('E10_GESTION_EXTERNOS_INACTIVA')).toContain('externos');
    expect(L.usuariosAdminLogic_mensajeError('ULTIMO_ADMIN')).toContain('administradores efectivos');
    expect(L.usuariosAdminLogic_mensajeError('CONFLICT_VERSION', { actual: { version: 7 } })).toContain('versión actual: 7');
    expect(L.usuariosAdminLogic_mensajeError('CONFLICT_VERSION')).toContain('Otro administrador');
    expect(L.usuariosAdminLogic_mensajeError('TIPO_NO_PERMITE_PERMISO')).toContain('externo');
  });
  test('un codigo desconocido igual dice cual fue', () => {
    expect(L.usuariosAdminLogic_mensajeError('RARO_X')).toContain('RARO_X');
    expect(L.usuariosAdminLogic_mensajeError(undefined)).toContain('desconocido');
  });
  test('estado de pantalla por codigo y codigos que piden recargar', () => {
    expect(L.usuariosAdminLogic_estadoPorCodigo('E10_ADMIN_INACTIVO')).toBe('deshabilitada');
    expect(L.usuariosAdminLogic_estadoPorCodigo('PERMISSION_DENIED')).toBe('sinPermiso');
    expect(L.usuariosAdminLogic_estadoPorCodigo('UNAUTHORIZED')).toBe('sesion');
    expect(L.usuariosAdminLogic_estadoPorCodigo('USER_DISABLED')).toBe('sesion');
    expect(L.usuariosAdminLogic_estadoPorCodigo('SERVICE_UNAVAILABLE')).toBe('error');
    ['CONFLICT_VERSION', 'USUARIO_YA_INACTIVO', 'USUARIO_YA_ACTIVO'].forEach((c) => expect(L.usuariosAdminLogic_codigoRecarga(c)).toBe(true));
    ['ULTIMO_ADMIN', 'EMAIL_INVALIDO', 'E10_ADMIN_INACTIVO'].forEach((c) => expect(L.usuariosAdminLogic_codigoRecarga(c)).toBe(false));
  });
});

describe('auditoria en pantalla, fechas, email e id de intencion', () => {
  test('etiquetas y resumen de un evento (permisos agregados / quitados con nombre amigable)', () => {
    expect(L.usuariosAdminLogic_etiquetaEvento('USUARIO_CREADO')).toBe('Creado');
    expect(L.usuariosAdminLogic_etiquetaEvento('USUARIO_ACTUALIZADO')).toBe('Actualizado');
    expect(L.usuariosAdminLogic_etiquetaEvento('USUARIO_DESACTIVADO')).toBe('Desactivado');
    expect(L.usuariosAdminLogic_etiquetaEvento('USUARIO_REACTIVADO')).toBe('Reactivado');
    expect(L.usuariosAdminLogic_etiquetaEvento('USUARIO_MIGRADO')).toContain('Migración');
    expect(L.usuariosAdminLogic_etiquetaEvento('OTRO')).toBe('OTRO');
    const r = L.usuariosAdminLogic_resumenEvento({ nombreAnterior: 'Ana', nombreObjetivo: 'Ana M', tipoAnterior: 'INTERNO', tipoNuevo: 'EXTERNO', estadoAnterior: 'activo', estadoNuevo: 'inactivo', permisosAntes: ['perfil'], permisosDespues: ['datos'], versionNueva: 4 }, CATALOGO);
    expect(r).toEqual(['Nombre: «Ana» → «Ana M»', 'Tipo: INTERNO → EXTERNO', 'Estado: activo → inactivo', 'Permisos agregados: Ver ficha', 'Permisos quitados: Ver ITF', 'Versión 4']);
  });
  test('fecha: dd/mm/aaaa hh:mm; vacia o invalida -> raya', () => {
    expect(L.usuariosAdminLogic_formatearFecha('2026-11-05T15:04:38.896Z')).toMatch(/^0[45]\/11\/2026 \d\d:\d\d$/);
    expect(L.usuariosAdminLogic_formatearFecha('')).toBe('—');
    expect(L.usuariosAdminLogic_formatearFecha('basura')).toBe('—');
    expect(L.usuariosAdminLogic_formatearFecha(null)).toBe('—');
  });
  test('email plausible', () => {
    expect(L.usuariosAdminLogic_esEmailPlausible('a@b.co')).toBe(true);
    ['', 'a', 'a@b', '@b.co', 'a b@c.co', null].forEach((e) => expect(L.usuariosAdminLogic_esEmailPlausible(e)).toBe(false));
  });
  test('clientRequestId: formato aceptado por el backend y distinto en cada intencion', () => {
    const a = L.usuariosAdminLogic_nuevoClientRequestId();
    const b = L.usuariosAdminLogic_nuevoClientRequestId();
    expect(a).toMatch(/^[A-Za-z0-9._:-]{1,80}$/);
    expect(a).not.toBe(b);
  });
});

describe('el modulo no mantiene una lista literal de permisos ni infiere permisos del tipo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'usuariosAdminLogic.js'), 'utf8');
  const codigo = fuente.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test('lo unico que nombra es usuarios_admin (el permiso de esta pantalla)', () => {
    ['perfil_subir', 'perfil_validar', 'ubicacion_corregir', 'ubicacion_validar', 'fotos_moderar', 'observaciones_anular', 'fotos_carga', 'reemplazo'].forEach((id) => {
      expect(codigo).not.toContain("'" + id + "'");
    });
    expect(codigo.match(/usuarios_admin/g).length).toBeGreaterThan(0);
  });
  test('ninguna funcion mira el tipo para conceder o quitar permisos (solo aplicabilidad del catalogo)', () => {
    expect(codigo).not.toMatch(/tipo\s*===\s*'EXTERNO'\s*\?\s*\[/);
    expect(L.usuariosAdminLogic_activar(CATALOGO, [], 'datos', false)).toEqual(['datos']);
  });
});

// E10-3: politica de autoridad para EXTERNOS (el techo sale del catalogo: aplicableExterno = false; el backend es la autoridad, esto es apoyo para no armar estados invalidos).
describe('E10-3: inefectivos, validarSeleccion con punto de partida y confirmaciones', () => {
  const CAT = CATALOGO.map((p) => (['perfil_validar', 'fotos_moderar'].includes(p.id) ? Object.assign({}, p, { aplicableExterno: false }) : p));
  const codigos = (r) => r.errores.map((e) => e.codigo + ':' + e.permiso);

  test('usuariosAdminLogic_inefectivos: solo los asignados que el tipo no puede ejercer, segun el catalogo', () => {
    expect(L.usuariosAdminLogic_inefectivos(CAT, 'EXTERNO', ['perfil', 'perfil_validar', 'fotos', 'fotos_moderar', 'usuarios_admin'])).toEqual(['perfil_validar', 'fotos_moderar', 'usuarios_admin']);
    expect(L.usuariosAdminLogic_inefectivos(CAT, 'INTERNO', ['perfil_validar', 'fotos_moderar'])).toEqual([]);
    expect(L.usuariosAdminLogic_inefectivos(CAT, 'EXTERNO', ['no_existe'])).toEqual([]);
    expect(L.usuariosAdminLogic_inefectivos(CAT, 'EXTERNO', null)).toEqual([]);
  });

  test('un EXTERNO nuevo o convertido con autoridad: TIPO_NO_PERMITE_PERMISO por cada uno', () => {
    expect(codigos(L.usuariosAdminLogic_validarSeleccion(CAT, 'EXTERNO', ['perfil', 'perfil_validar', 'fotos', 'fotos_moderar']))).toEqual(['TIPO_NO_PERMITE_PERMISO:perfil_validar', 'TIPO_NO_PERMITE_PERMISO:fotos_moderar']);
    const original = { tipo: 'INTERNO', permisos: ['perfil', 'perfil_validar'] };
    expect(codigos(L.usuariosAdminLogic_validarSeleccion(CAT, 'EXTERNO', ['perfil', 'perfil_validar'], original))).toEqual(['TIPO_NO_PERMITE_PERMISO:perfil_validar']);
  });

  test('un EXTERNO que ya los tenia asignados (heredados) puede seguir editandose sin que lo bloqueen, pero NO se le agrega otro', () => {
    const original = { tipo: 'EXTERNO', permisos: ['perfil', 'perfil_validar'] };
    expect(L.usuariosAdminLogic_validarSeleccion(CAT, 'EXTERNO', ['perfil', 'perfil_validar'], original).ok).toBe(true);
    expect(codigos(L.usuariosAdminLogic_validarSeleccion(CAT, 'EXTERNO', ['perfil', 'perfil_validar', 'fotos', 'fotos_moderar'], original))).toEqual(['TIPO_NO_PERMITE_PERMISO:fotos_moderar']);
  });

  test('EXTERNO -> INTERNO: los inefectivos que se conservan dan CONCESION_AUTOMATICA; quitados, no', () => {
    const original = { tipo: 'EXTERNO', permisos: ['perfil', 'perfil_validar'] };
    expect(codigos(L.usuariosAdminLogic_validarSeleccion(CAT, 'INTERNO', ['perfil', 'perfil_validar'], original))).toEqual(['CONCESION_AUTOMATICA:perfil_validar']);
    expect(L.usuariosAdminLogic_validarSeleccion(CAT, 'INTERNO', ['perfil'], original).ok).toBe(true);
    // otorgar autoridad a quien ya es INTERNO no es una concesion automatica
    expect(L.usuariosAdminLogic_validarSeleccion(CAT, 'INTERNO', ['perfil', 'perfil_validar'], { tipo: 'INTERNO', permisos: ['perfil'] }).ok).toBe(true);
  });

  test('la tarjeta informa la cantidad de inefectivos (y 0 si el backend no la manda)', () => {
    expect(L.usuariosAdminLogic_tarjeta(U({ tipo: 'EXTERNO', permisosInefectivos: ['perfil_validar'] }))).toMatchObject({ inefectivos: 1, inefectivosTexto: '1 inefectivo' });
    expect(L.usuariosAdminLogic_tarjeta(U({ permisosInefectivos: ['a', 'b'] }))).toMatchObject({ inefectivos: 2, inefectivosTexto: '2 inefectivos' });
    expect(L.usuariosAdminLogic_tarjeta(U())).toMatchObject({ inefectivos: 0 });
  });

  test('confirmaciones: crear o convertir a externo explica la politica; pasar a interno aclara que no concede nada', () => {
    expect(L.USUARIOS_ADMIN_TEXTO_EXTERNO).toContain('no puede validar, moderar, anular contenido ajeno ni administrar usuarios');
    const crear = L.usuariosAdminLogic_confirmacion('CREAR', null, null, { email: 'e@x.com', nombre: 'E', tipo: 'EXTERNO', permisos: ['perfil'] }, CAT);
    expect(crear.lineas).toContain(L.USUARIOS_ADMIN_TEXTO_EXTERNO);
    const aExterno = L.usuariosAdminLogic_confirmacion('ACTUALIZAR', { nombre: 'Ana', email: 'a@x.com' }, { tipo: 'INTERNO', nombre: 'Ana', permisos: ['perfil'] }, { tipo: 'EXTERNO', nombre: 'Ana', permisos: ['perfil'] }, CAT);
    expect(aExterno.lineas).toContain(L.USUARIOS_ADMIN_TEXTO_EXTERNO);
    const aInterno = L.usuariosAdminLogic_confirmacion('ACTUALIZAR', { nombre: 'Ana', email: 'a@x.com' }, { tipo: 'EXTERNO', nombre: 'Ana', permisos: ['perfil'] }, { tipo: 'INTERNO', nombre: 'Ana', permisos: ['perfil'] }, CAT);
    expect(aInterno.lineas.join(' ')).toContain('no le otorga ningún permiso nuevo');
  });

  test('mensajes de error: los codigos nuevos tienen texto propio y nombran los permisos del detalle', () => {
    expect(L.usuariosAdminLogic_mensajeError('CONCESION_AUTOMATICA')).toContain('activaría permisos');
    expect(L.usuariosAdminLogic_mensajeError('TIPO_NO_PERMITE_PERMISO')).toContain('permisos de autoridad');
    expect(L.usuariosAdminLogic_mensajeError('TIPO_NO_PERMITE_PERMISO', { detalle: ['TIPO_NO_PERMITE_PERMISO:perfil_validar', 'TIPO_NO_PERMITE_PERMISO:fotos_moderar', 'PERMISOS_INCONSISTENTES:x'] }, CAT)).toMatch(/«Validar ITF», «Moderar fotos»/);
  });
});
