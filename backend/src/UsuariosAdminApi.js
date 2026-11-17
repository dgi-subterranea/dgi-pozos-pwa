// UsuariosAdminApi (E10-2): los ENDPOINTS de la administracion de usuarios. Siete acciones, ningun endpoint generico de escritura de filas:
//   adminUsuariosListar      todos los usuarios (sin paginar)            adminPermisosCatalogo   el catalogo canonico de permisos para la pantalla
//   adminUsuarioObtener      detalle + ultimos eventos de auditoria      adminUsuarioCrear       alta (siempre activo, version 1)
//   adminUsuarioActualizar   nombre, tipo y/o permisos (el email es INMUTABLE)
//   adminUsuarioDesactivar   baja logica (motivo obligatorio)            adminUsuarioReactivar   reactivacion (motivo obligatorio)
//
// ORDEN DE CHEQUEOS (fail-closed; el backend manda, ocultar la UI no es una defensa):
//   1. sesion valida (token firmado) y usuario activo                      -> UNAUTHORIZED / USER_DISABLED
//   2. administrador: activo + INTERNO + usuarios_admin (acceso efectivo)  -> PERMISSION_DENIED (SIN revelar el estado del flag a quien no es administrador)
//   3. flag E10_ADMIN_USUARIOS_ACTIVO exacto 'SI'                          -> E10_ADMIN_INACTIVO (antes de leer el cuerpo y antes de abrir ninguna hoja)
//   4. lista BLANCA de campos y tipos del pedido (cualquier otro campo se RECHAZA)  -> INVALID_REQUEST
//   5. el servicio (UsuariosAdminService / UsuariosAdminLectura) vuelve a comprobar flag y actor contra la hoja FRESCA bajo el lock (el paso 2 usa el acceso cacheado solo como filtro rapido).
// El ACTOR (email, nombre) sale SIEMPRE de la sesion y de la hoja Usuarios: ningun campo del cuerpo puede ser un actor ni un ejecutor (no estan en la lista blanca). El email del cuerpo es el USUARIO
// OBJETIVO. No existe ningun campo para cambiar el email de un usuario: en E10-2 el email es inmutable (otro email es otro usuario).
// Toda mutacion exige clientRequestId (idempotencia: el mismo pedido reintentado no duplica el cambio ni el evento) y, salvo el alta, versionEsperada + etag (concurrencia optimista: CONFLICT_VERSION).
// Historial: una fila por pedido con la accion y el resultado (OK o el codigo), sin emails de usuarios objetivo ni datos del cuerpo.
var USUARIOS_ADMIN_API_ACCIONES = {
  adminUsuariosListar: { campos: [], obligatorios: [] },
  adminPermisosCatalogo: { campos: [], obligatorios: [] },
  adminUsuarioObtener: { campos: ['email', 'limiteEventos'], obligatorios: ['email'] },
  adminUsuarioCrear: { campos: ['email', 'nombre', 'tipo', 'permisos', 'motivo', 'clientRequestId'], obligatorios: ['email', 'nombre', 'tipo', 'permisos', 'clientRequestId'] },
  adminUsuarioActualizar: { campos: ['email', 'versionEsperada', 'etag', 'nombre', 'tipo', 'permisos', 'motivo', 'clientRequestId'], obligatorios: ['email', 'versionEsperada', 'etag', 'clientRequestId'], algunoDe: ['nombre', 'tipo', 'permisos'] },
  adminUsuarioDesactivar: { campos: ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId'], obligatorios: ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId'] },
  adminUsuarioReactivar: { campos: ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId'], obligatorios: ['email', 'versionEsperada', 'etag', 'motivo', 'clientRequestId'] }
};
// campos que acompanan a TODO pedido (no son datos de la operacion)
var USUARIOS_ADMIN_API_CAMPOS_BASE = ['action', 'sessionToken'];
var USUARIOS_ADMIN_API_MAX_PERMISOS = 100;

function usuariosAdminApi_error(codigo, mensaje, extra) {
  var r = { status: 'error', code: codigo, message: mensaje };
  if (extra) {
    Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  }
  return r;
}

// Tipo esperado de cada campo. Devuelve true si el valor es del tipo correcto.
function usuariosAdminApi_tipoValido(campo, valor) {
  switch (campo) {
    case 'email': case 'nombre': case 'tipo': case 'etag': case 'clientRequestId':
      return typeof valor === 'string' && valor.length <= 254;
    case 'motivo':
      return typeof valor === 'string' && valor.length <= 1000;
    case 'versionEsperada': case 'limiteEventos':
      return typeof valor === 'number' && isFinite(valor) && Math.floor(valor) === valor && valor >= 0;
    case 'permisos':
      return Array.isArray(valor) && valor.length <= USUARIOS_ADMIN_API_MAX_PERMISOS && valor.every(function (p) { return typeof p === 'string' && p.length <= 60; });
    default:
      return false;
  }
}

// Lista BLANCA estricta: devuelve null si el cuerpo es valido o la respuesta de error. Rechaza cualquier campo que no figure (un actor falsificado, un ejecutadoPor, un nuevoEmail, un estado, una fila...).
function usuariosAdminApi_validarCuerpo(accion, body) {
  var cfg = USUARIOS_ADMIN_API_ACCIONES[accion];
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return usuariosAdminApi_error('INVALID_REQUEST', 'cuerpo invalido');
  }
  var permitidos = USUARIOS_ADMIN_API_CAMPOS_BASE.concat(cfg.campos);
  var extra = Object.keys(body).filter(function (k) { return permitidos.indexOf(k) < 0; });
  if (extra.length > 0) {
    return usuariosAdminApi_error('INVALID_REQUEST', 'campos no permitidos: ' + extra.slice(0, 5).map(function (k) { return String(k).slice(0, 40); }).join(', '));
  }
  for (var i = 0; i < cfg.obligatorios.length; i++) {
    if (body[cfg.obligatorios[i]] === undefined || body[cfg.obligatorios[i]] === null) {
      return usuariosAdminApi_error('INVALID_REQUEST', 'falta el campo ' + cfg.obligatorios[i]);
    }
  }
  for (var j = 0; j < cfg.campos.length; j++) {
    var c = cfg.campos[j];
    if (body[c] !== undefined && body[c] !== null && !usuariosAdminApi_tipoValido(c, body[c])) {
      return usuariosAdminApi_error('INVALID_REQUEST', 'campo invalido: ' + c);
    }
    if (body[c] === null && cfg.obligatorios.indexOf(c) < 0 && c !== 'motivo') {
      return usuariosAdminApi_error('INVALID_REQUEST', 'campo invalido: ' + c);
    }
  }
  if (cfg.algunoDe && !cfg.algunoDe.some(function (c) { return body[c] !== undefined; })) {
    return usuariosAdminApi_error('INVALID_REQUEST', 'no hay nada para cambiar: enviar nombre, tipo y/o permisos');
  }
  return null;
}

// Pasos 1 y 2: sesion + administrador (acceso efectivo, filtro rapido por cache). Devuelve {ok, actor} o {ok:false, response}.
function usuariosAdminApi_puerta(sessionToken, accion) {
  var validation = validateSession(sessionToken, accion, null);
  if (!validation.ok) {
    return validation;
  }
  var email = validation.session.email;
  var access = getUserAccess(email);
  var esAdmin = access.active === true && access.tipo === 'INTERNO' && !!access.permisos && access.permisos.usuarios_admin === true;
  if (!esAdmin) {
    logHistoryEvent(email, accion, null, 'PERMISSION_DENIED');
    return { ok: false, response: usuariosAdminApi_error('PERMISSION_DENIED', 'se requiere el permiso de administracion de usuarios') };
  }
  return { ok: true, actor: { email: email, nombre: access.nombre || null } };
}

// Traduce el resultado de un servicio ({ok:true, ...} | {ok:false, codigo, mensaje, ...}) a la respuesta de la API.
function usuariosAdminApi_respuesta(resultado) {
  if (resultado && resultado.ok === true) {
    var data = {};
    Object.keys(resultado).forEach(function (k) { if (k !== 'ok') { data[k] = resultado[k]; } });
    return { status: 'ok', data: data };
  }
  var r = resultado || {};
  var extra = {};
  ['actual', 'detalle', 'revertido'].forEach(function (k) { if (r[k] !== undefined) { extra[k] = r[k]; } });
  return usuariosAdminApi_error(r.codigo || 'SERVICE_UNAVAILABLE', r.mensaje || 'no se pudo completar la operacion', extra);
}

// Nucleo comun de los siete endpoints. `operar(actor, datos)` recibe SOLO los campos de la lista blanca.
function usuariosAdminApi_ejecutar(accion, body, operar) {
  var puerta = usuariosAdminApi_puerta(body && body.sessionToken, accion);
  if (!puerta.ok) {
    return puerta.response;
  }
  var actor = puerta.actor;
  if (!e10Flags_adminUsuariosActivo()) {
    logHistoryEvent(actor.email, accion, null, 'E10_ADMIN_INACTIVO');
    return usuariosAdminApi_error('E10_ADMIN_INACTIVO', 'la administracion de usuarios no esta activa');
  }
  var invalido = usuariosAdminApi_validarCuerpo(accion, body);
  if (invalido) {
    logHistoryEvent(actor.email, accion, null, 'INVALID_REQUEST');
    return invalido;
  }
  var datos = {};
  USUARIOS_ADMIN_API_ACCIONES[accion].campos.forEach(function (c) {
    if (body[c] !== undefined && body[c] !== null) {
      datos[c] = body[c];
    }
  });
  var resultado;
  try {
    resultado = operar(actor, datos);
  } catch (err) {
    Logger.log('UsuariosAdminApi: excepcion en ' + accion);
    logHistoryEvent(actor.email, accion, null, 'SERVICE_UNAVAILABLE');
    return usuariosAdminApi_error('SERVICE_UNAVAILABLE', 'no se pudo completar la operacion');
  }
  var respuesta = usuariosAdminApi_respuesta(resultado);
  logHistoryEvent(actor.email, accion, null, respuesta.status === 'ok' ? 'OK' : respuesta.code);
  return respuesta;
}

function handleAdminUsuariosListar(body) {
  return usuariosAdminApi_ejecutar('adminUsuariosListar', body, function (actor) { return usuariosAdminLectura_listar(actor); });
}

function handleAdminPermisosCatalogo(body) {
  return usuariosAdminApi_ejecutar('adminPermisosCatalogo', body, function (actor) { return usuariosAdminLectura_catalogo(actor); });
}

function handleAdminUsuarioObtener(body) {
  return usuariosAdminApi_ejecutar('adminUsuarioObtener', body, function (actor, datos) {
    return usuariosAdminLectura_obtener(actor, datos.email, { limiteEventos: datos.limiteEventos });
  });
}

function handleAdminUsuarioCrear(body) {
  return usuariosAdminApi_ejecutar('adminUsuarioCrear', body, function (actor, datos) { return usuariosAdmin_crear(actor, datos); });
}

function handleAdminUsuarioActualizar(body) {
  return usuariosAdminApi_ejecutar('adminUsuarioActualizar', body, function (actor, datos) { return usuariosAdmin_actualizar(actor, datos); });
}

function handleAdminUsuarioDesactivar(body) {
  return usuariosAdminApi_ejecutar('adminUsuarioDesactivar', body, function (actor, datos) {
    return usuariosAdmin_cambiarEstado(actor, Object.assign({}, datos, { accion: 'DESACTIVAR' }));
  });
}

function handleAdminUsuarioReactivar(body) {
  return usuariosAdminApi_ejecutar('adminUsuarioReactivar', body, function (actor, datos) {
    return usuariosAdmin_cambiarEstado(actor, Object.assign({}, datos, { accion: 'REACTIVAR' }));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_ADMIN_API_ACCIONES,
    usuariosAdminApi_validarCuerpo,
    usuariosAdminApi_puerta,
    handleAdminUsuariosListar,
    handleAdminPermisosCatalogo,
    handleAdminUsuarioObtener,
    handleAdminUsuarioCrear,
    handleAdminUsuarioActualizar,
    handleAdminUsuarioDesactivar,
    handleAdminUsuarioReactivar
  };
}
