// UsuariosAdminLectura (E10-2): las LECTURAS de la administracion de usuarios: listado, detalle (con los ultimos eventos de auditoria del usuario) y catalogo de permisos. Solo lee: no toma el lock,
// no escribe hojas, no toca el cache. Misma disciplina que las escrituras de UsuariosAdminService: flag E10_ADMIN_USUARIOS_ACTIVO PRIMERO (apagado: E10_ADMIN_INACTIVO antes de abrir ninguna hoja) y el
// actor tiene que ser administrador EFECTIVO (activo + INTERNO + usuarios_admin) segun la hoja FRESCA, sin cache. El actor sale SIEMPRE de la sesion: estas funciones nunca leen un actor del pedido.
//
//   usuariosAdminLectura_listar(actor)                      -> {ok, usuarios:[vista], total, activos, administradoresEfectivos}
//   usuariosAdminLectura_obtener(actor, email, opciones)    -> {ok, usuario: vista, eventos:[...], eventosDisponibles, hayMasEventos}   opciones: {limiteEventos}
//   usuariosAdminLectura_catalogo(actor)                    -> {ok, permisos:[{id,nombre,descripcion,modulo,categoria,aplicableInterno,aplicableExterno,dependeDe,critico,orden}], categorias, tipos}
//
// El listado devuelve a TODOS los usuarios sin paginar (la busqueda y los filtros son del frontend); no depende de cuantos sean. El detalle muestra una cantidad RECIENTE de eventos (por defecto
// USUARIOS_ADMIN_EVENTOS_POR_DEFECTO, tope USUARIOS_ADMIN_EVENTOS_MAXIMO) y dice si hay mas, para ampliar sin cambiar el contrato. Un evento nunca lleva el clientRequestId ni datos internos de la hoja.
var USUARIOS_ADMIN_EVENTOS_POR_DEFECTO = 20;
var USUARIOS_ADMIN_EVENTOS_MAXIMO = 100;

function usuariosAdminLectura_error(codigo, mensaje) {
  return { ok: false, codigo: codigo, mensaje: mensaje };
}

// Flag + hoja + actor administrador efectivo. Devuelve {ok:true, usuarios} (hoja fresca) o el error.
function usuariosAdminLectura_abrir(actor) {
  if (!actor || !usuariosDominio_emailValido(usuariosDominio_normalizarEmail(actor.email))) {
    return usuariosAdminLectura_error('PERMISSION_DENIED', 'actor invalido');
  }
  if (!e10Flags_adminUsuariosActivo()) {
    return usuariosAdminLectura_error('E10_ADMIN_INACTIVO', 'la administracion de usuarios no esta activa');
  }
  var usuarios;
  try {
    usuarios = sheetUserRepository_leerUsuarios(sheetUserRepository_abrirParaEscritura());
  } catch (err) {
    var m = /^([A-Z_]+):/.exec(String(err && err.message ? err.message : err));
    return usuariosAdminLectura_error(m ? m[1] : 'SERVICE_UNAVAILABLE', 'hoja de usuarios no disponible');
  }
  var actorEmail = usuariosDominio_normalizarEmail(actor.email);
  var delActor = usuarios.filter(function (u) { return u.email === actorEmail; });
  if (delActor.length === 0 || !usuariosDominio_esAdminEfectivo(delActor[0])) {
    return usuariosAdminLectura_error('PERMISSION_DENIED', 'el actor no es administrador efectivo');
  }
  return { ok: true, usuarios: usuarios };
}

function usuariosAdminLectura_listar(actor) {
  var base = usuariosAdminLectura_abrir(actor);
  if (base.ok !== true) {
    return base;
  }
  var lista = base.usuarios.map(usuariosAdmin_vista).sort(function (a, b) {
    var na = String(a.nombre || a.email).toLowerCase();
    var nb = String(b.nombre || b.email).toLowerCase();
    return na < nb ? -1 : (na > nb ? 1 : (a.email < b.email ? -1 : (a.email > b.email ? 1 : 0)));
  });
  return {
    ok: true,
    usuarios: lista,
    total: lista.length,
    activos: lista.filter(function (u) { return u.estado === 'activo'; }).length,
    administradoresEfectivos: usuariosDominio_contarAdmins(base.usuarios)
  };
}

function usuariosAdminLectura_dtoEvento(e) {
  function lista(texto) {
    return String(texto || '') === '' ? [] : String(texto).split(',');
  }
  return {
    secuencia: e.secuencia,
    evento: e.evento,
    timestampUtc: e.timestampUtc,
    ejecutadoPor: e.ejecutadoPor,
    nombreAnterior: e.nombreAnterior,
    nombreObjetivo: e.nombreObjetivo,
    tipoAnterior: e.tipoAnterior,
    tipoNuevo: e.tipoNuevo,
    estadoAnterior: e.estadoAnterior,
    estadoNuevo: e.estadoNuevo,
    versionAnterior: e.versionAnterior,
    versionNueva: e.versionNueva,
    permisosAntes: lista(e.permisosAntes),
    permisosDespues: lista(e.permisosDespues),
    motivo: e.motivo,
    origen: e.origen
  };
}

function usuariosAdminLectura_limite(opciones) {
  var l = opciones && opciones.limiteEventos;
  if (typeof l !== 'number' || !isFinite(l) || Math.floor(l) !== l || l < 1) {
    return USUARIOS_ADMIN_EVENTOS_POR_DEFECTO;
  }
  return Math.min(l, USUARIOS_ADMIN_EVENTOS_MAXIMO);
}

function usuariosAdminLectura_obtener(actor, email, opciones) {
  var base = usuariosAdminLectura_abrir(actor);
  if (base.ok !== true) {
    return base;
  }
  var objetivo = usuariosDominio_normalizarEmail(email);
  if (!usuariosDominio_emailValido(objetivo)) {
    return usuariosAdminLectura_error('EMAIL_INVALIDO', 'el email no es valido');
  }
  var coincidencias = base.usuarios.filter(function (u) { return u.email === objetivo; });
  if (coincidencias.length === 0) {
    return usuariosAdminLectura_error('USUARIO_NO_ENCONTRADO', 'no existe un usuario con ese email');
  }
  if (coincidencias.length > 1) {
    return usuariosAdminLectura_error('EMAIL_DUPLICADO_EN_HOJA', 'el email figura mas de una vez en la hoja: depurar a mano antes de operar');
  }
  var limite = usuariosAdminLectura_limite(opciones);
  var eventos = [];
  var disponibles = true;
  var hayMas = false;
  try {
    var todos = usuariosEventosRepository_leer(usuariosEventosRepository_abrir()).filter(function (e) { return e.usuarioObjetivo === objetivo; });
    todos.sort(function (a, b) { return b.secuencia - a.secuencia; });
    hayMas = todos.length > limite;
    eventos = todos.slice(0, limite).map(usuariosAdminLectura_dtoEvento);
  } catch (err) {
    // la auditoria no se pudo leer: el detalle se muestra igual pero lo dice (no se inventa un historial vacio)
    disponibles = false;
  }
  return { ok: true, usuario: usuariosAdmin_vista(coincidencias[0]), eventos: eventos, eventosDisponibles: disponibles, hayMasEventos: hayMas, limiteEventos: limite };
}

// El catalogo canonico (PermisosCatalogo.js) tal cual lo necesita la pantalla: el frontend NO mantiene una segunda lista. Solo lee el catalogo, no la hoja: no hace falta abrir Usuarios, pero si el flag
// y el actor (hoja fresca) como el resto.
function usuariosAdminLectura_catalogo(actor) {
  var base = usuariosAdminLectura_abrir(actor);
  if (base.ok !== true) {
    return base;
  }
  return { ok: true, permisos: permisosCatalogo_lista(), categorias: PERMISOS_CATALOGO_CATEGORIAS.slice(), tipos: PERMISOS_CATALOGO_TIPOS.slice() };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_ADMIN_EVENTOS_POR_DEFECTO,
    USUARIOS_ADMIN_EVENTOS_MAXIMO,
    usuariosAdminLectura_listar,
    usuariosAdminLectura_obtener,
    usuariosAdminLectura_catalogo,
    usuariosAdminLectura_dtoEvento
  };
}
