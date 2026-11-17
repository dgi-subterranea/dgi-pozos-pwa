// UsuariosDominio (E10-1): reglas PURAS de usuarios y permisos (sin Sheets, sin cache, sin reloj, sin Script Properties). Lo usan el acceso por request (AuthService), el parser de la hoja Usuarios, la
// administracion futura (UsuariosAdminService), la migracion y el preflight. Depende SOLO de PermisosCatalogo (funciones, a llamada: el orden de carga de Apps Script no esta garantizado).
//
// Modelo (aprobado): `tipo` (INTERNO | EXTERNO) + `estado` (activo | inactivo) + permisos individuales.
//   - `tipo` NO concede permisos. La autoridad de acceso son los permisos.
//   - Un permiso cuyo catalogo dice aplicableExterno = false (hoy: usuarios_admin) solo es EFECTIVO para un usuario INTERNO. Es una regla de seguridad dura, no de negocio.
//   - Administrador EFECTIVO = estado activo + tipo INTERNO + usuarios_admin = SI.
//
// Un "usuario" en este modulo es {email, nombre, estado, tipo, version, permisos: {id: boolean}}.
var USUARIOS_ESTADOS = ['activo', 'inactivo'];
var USUARIOS_NOMBRE_MAX = 80;
var USUARIOS_EMAIL_REGEX = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

function usuariosDominio_normalizarEmail(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

function usuariosDominio_emailValido(email) {
  return typeof email === 'string' && email.length > 0 && email.length <= 254 && USUARIOS_EMAIL_REGEX.test(email);
}

// 'INTERNO' | 'EXTERNO' | '' (vacio o invalido). Exacto salvo mayusculas y espacios.
function usuariosDominio_normalizarTipo(v) {
  var t = v === null || v === undefined ? '' : String(v).trim().toUpperCase();
  return permisosCatalogo_tipoValido(t) ? t : '';
}

function usuariosDominio_normalizarEstado(v) {
  var e = v === null || v === undefined ? '' : String(v).trim().toLowerCase();
  return USUARIOS_ESTADOS.indexOf(e) >= 0 ? e : '';
}

function usuariosDominio_normalizarVersion(v) {
  var n = typeof v === 'number' ? v : parseInt(String(v === null || v === undefined ? '' : v).trim(), 10);
  return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : 0;
}

// Permisos EFECTIVOS: copia de los crudos (solo los ids del catalogo, booleanos estrictos) donde los permisos no aplicables a EXTERNO solo valen para un INTERNO.
function usuariosDominio_permisosEfectivos(crudos, tipo) {
  var salida = permisosCatalogo_vacios();
  var c = crudos || {};
  permisosCatalogo_lista().forEach(function (p) {
    var valor = c[p.id] === true;
    if (valor && p.aplicableExterno !== true && tipo !== 'INTERNO') {
      valor = false;
    }
    salida[p.id] = valor;
  });
  return salida;
}

// Estado de acceso de UN usuario a partir de lo que leyo el repositorio: {found, active, permisos (crudos), nombre, tipo, version}.
// Devuelve {active, permisos (efectivos), nombre, tipo, version}. Un usuario no encontrado o inactivo no tiene ningun permiso.
function usuariosDominio_accesoEfectivo(status) {
  var s = status || {};
  var activo = s.found === true && s.active === true;
  var tipo = usuariosDominio_normalizarTipo(s.tipo);
  return {
    active: activo,
    permisos: activo ? usuariosDominio_permisosEfectivos(s.permisos, tipo) : permisosCatalogo_vacios(),
    nombre: s.found === true ? (s.nombre || null) : null,
    tipo: s.found === true ? tipo : '',
    version: s.found === true ? usuariosDominio_normalizarVersion(s.version) : 0
  };
}

function usuariosDominio_esAdminEfectivo(u) {
  return !!u && usuariosDominio_normalizarEstado(u.estado) === 'activo' && usuariosDominio_normalizarTipo(u.tipo) === 'INTERNO' && !!u.permisos && u.permisos.usuarios_admin === true;
}

function usuariosDominio_contarAdmins(lista) {
  return (lista || []).filter(usuariosDominio_esAdminEfectivo).length;
}

// Hash corto y determinista del estado EDITABLE de un usuario (nombre | tipo | estado | permisos). Complementa a `version`: una edicion manual de la hoja no incrementa `version`, pero si cambia
// el etag. FNV-1a de 32 bits con dos semillas (16 hex): no es criptografico, solo detecta cambios.
function usuariosDominio_etag(u) {
  var x = u || {};
  var texto = [String(x.nombre || '').trim(), usuariosDominio_normalizarTipo(x.tipo), usuariosDominio_normalizarEstado(x.estado), permisosCatalogo_aLista(x.permisos).join(',')].join('|');
  function fnv(semilla) {
    var h = semilla >>> 0;
    for (var i = 0; i < texto.length; i++) {
      h ^= texto.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return ('00000000' + h.toString(16)).slice(-8);
  }
  return fnv(2166136261) + fnv(374761393);
}

// --- validacion de una mutacion ---

// antes: usuario actual (o null en un alta). despues: estado nuevo. todosAntes: TODOS los usuarios actuales (incluido `antes`). opciones: {cambiaPermisos: boolean} (las dependencias entre permisos se exigen solo
// cuando se tocan los permisos o se crea el usuario: editar el nombre de un usuario con una combinacion historica no se bloquea por eso).
// Devuelve {ok:true} o {ok:false, codigo, mensaje, detalle?}. Orden de las reglas: forma -> permisos/tipo -> ULTIMO ADMIN.
function usuariosDominio_validarMutacion(antes, despues, todosAntes, opciones) {
  var o = opciones || {};
  var d = despues || {};
  var email = usuariosDominio_normalizarEmail(d.email);
  if (!usuariosDominio_emailValido(email)) {
    return { ok: false, codigo: 'EMAIL_INVALIDO', mensaje: 'el email no es valido' };
  }
  var nombre = String(d.nombre === null || d.nombre === undefined ? '' : d.nombre).trim();
  if (nombre === '' || nombre.length > USUARIOS_NOMBRE_MAX) {
    return { ok: false, codigo: 'NOMBRE_INVALIDO', mensaje: 'el nombre es obligatorio (hasta ' + USUARIOS_NOMBRE_MAX + ' caracteres)' };
  }
  if (usuariosDominio_normalizarEstado(d.estado) === '') {
    return { ok: false, codigo: 'ESTADO_INVALIDO', mensaje: 'el estado debe ser activo o inactivo' };
  }
  var tipo = usuariosDominio_normalizarTipo(d.tipo);
  if (tipo === '') {
    return { ok: false, codigo: 'TIPO_INVALIDO', mensaje: 'el tipo debe ser INTERNO o EXTERNO' };
  }
  var ids = permisosCatalogo_aLista(d.permisos);
  var validacion = permisosCatalogo_validarConjunto(tipo, ids);
  var errores = validacion.errores.filter(function (e) {
    // las dependencias solo se exigen si se tocan los permisos (o es un alta)
    return e.codigo !== 'PERMISOS_INCONSISTENTES' || o.cambiaPermisos === true || antes === null || antes === undefined;
  });
  if (errores.length > 0) {
    // TIPO_NO_PERMITE_PERMISO (EXTERNO + usuarios_admin) tiene prioridad: es la regla dura
    var duro = errores.filter(function (e) { return e.codigo === 'TIPO_NO_PERMITE_PERMISO'; })[0] || errores[0];
    return { ok: false, codigo: duro.codigo, mensaje: duro.detalle, detalle: errores.map(function (e) { return e.codigo + (e.permiso ? ':' + e.permiso : ''); }) };
  }
  // ULTIMO ADMIN: despues de la mutacion tiene que quedar al menos un administrador efectivo
  var despuesLista = (todosAntes || []).filter(function (u) { return usuariosDominio_normalizarEmail(u.email) !== email; });
  despuesLista.push({ email: email, nombre: nombre, estado: usuariosDominio_normalizarEstado(d.estado), tipo: tipo, permisos: permisosCatalogo_aObjeto(ids) });
  if (usuariosDominio_contarAdmins(despuesLista) < 1) {
    return { ok: false, codigo: 'ULTIMO_ADMIN', mensaje: 'la operacion dejaria al sistema sin administradores efectivos (activo + INTERNO + usuarios_admin)' };
  }
  return { ok: true };
}

// --- eventos de auditoria ---

// Diferencias entre `antes` (o null) y `despues`. Devuelve la lista de eventos [{evento, ...campos}] SIN identidad del actor ni fechas (las pone el servicio):
//   alta                                     -> USUARIO_CREADO
//   cambio de nombre, tipo y/o permisos      -> USUARIO_ACTUALIZADO (UN solo evento por mutacion, con el estado completo antes/despues: los permisos agregados y quitados salen de comparar permisosAntes y permisosDespues)
//   activo -> inactivo                       -> USUARIO_DESACTIVADO ; inactivo -> activo -> USUARIO_REACTIVADO
// (E10-2: reemplaza a USUARIO_EDITADO + PERMISOS_MODIFICADOS de E10-1, que nunca se escribieron en produccion: la unica auditoria real hasta hoy es USUARIO_MIGRADO.)
// Cada evento lleva el estado COMPLETO antes/despues (tipo, estado, version, permisos, nombre) para que cualquiera se lea solo.
function usuariosDominio_eventosDe(antes, despues) {
  var a = antes || null;
  var base = {
    usuarioObjetivo: usuariosDominio_normalizarEmail(despues.email),
    nombreObjetivo: String(despues.nombre || '').trim(),
    nombreAnterior: a ? String(a.nombre || '').trim() : '',
    tipoAnterior: a ? usuariosDominio_normalizarTipo(a.tipo) : '',
    tipoNuevo: usuariosDominio_normalizarTipo(despues.tipo),
    estadoAnterior: a ? usuariosDominio_normalizarEstado(a.estado) : '',
    estadoNuevo: usuariosDominio_normalizarEstado(despues.estado),
    versionAnterior: a ? usuariosDominio_normalizarVersion(a.version) : 0,
    versionNueva: usuariosDominio_normalizarVersion(despues.version),
    permisosAntes: a ? permisosCatalogo_aLista(a.permisos).join(',') : '',
    permisosDespues: permisosCatalogo_aLista(despues.permisos).join(',')
  };
  function evento(nombre) {
    var e = { evento: nombre };
    Object.keys(base).forEach(function (k) { e[k] = base[k]; });
    return e;
  }
  if (!a) {
    return [evento('USUARIO_CREADO')];
  }
  var eventos = [];
  if (base.estadoAnterior !== base.estadoNuevo) {
    eventos.push(evento(base.estadoNuevo === 'activo' ? 'USUARIO_REACTIVADO' : 'USUARIO_DESACTIVADO'));
  }
  if (base.nombreAnterior !== base.nombreObjetivo || base.tipoAnterior !== base.tipoNuevo || base.permisosAntes !== base.permisosDespues) {
    eventos.push(evento('USUARIO_ACTUALIZADO'));
  }
  return eventos;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_ESTADOS,
    USUARIOS_NOMBRE_MAX,
    usuariosDominio_normalizarEmail,
    usuariosDominio_emailValido,
    usuariosDominio_normalizarTipo,
    usuariosDominio_normalizarEstado,
    usuariosDominio_normalizarVersion,
    usuariosDominio_permisosEfectivos,
    usuariosDominio_accesoEfectivo,
    usuariosDominio_esAdminEfectivo,
    usuariosDominio_contarAdmins,
    usuariosDominio_etag,
    usuariosDominio_validarMutacion,
    usuariosDominio_eventosDe
  };
}
