// UsuariosAdminService (E10-1, usado por los endpoints de E10-2 en UsuariosAdminApi.js): las OPERACIONES administrativas de usuarios, con todas sus protecciones. El endpoint valida ANTES sesion + usuario
// activo + INTERNO + usuarios_admin (la UI nunca es una defensa); este servicio vuelve a comprobar el permiso del actor contra la hoja FRESCA, sin cache. Las lecturas (listado, detalle, catalogo) estan
// en UsuariosAdminLectura.js.
//
//   usuariosAdmin_crear(actor, datos)           alta de un usuario nuevo (estado activo, version 1)
//   usuariosAdmin_actualizar(actor, datos)      cambia nombre, tipo y/o permisos (el email NUNCA cambia: otro email es otro usuario)
//   usuariosAdmin_cambiarEstado(actor, datos)   baja logica (inactivo) o reactivacion. NUNCA se borra una fila.
//   actor = {email, nombre} (SIEMPRE de la sesion). datos: ver cada funcion. `permisos` = lista de ids del catalogo en SI.
//
// SECUENCIA de cada operacion (todo bajo el script lock):
//   flag E10_ADMIN_USUARIOS_ACTIVO -> lock -> abrir Usuarios (esquema completo) y UsuariosEventos (esquema) SIN escribir -> leer todo FRESCO -> actor = administrador efectivo -> idempotencia (clientRequestId)
//   -> usuario actual + version esperada (+ etag) -> estado nuevo -> reglas (catalogo, EXTERNO+usuarios_admin, ULTIMO ADMIN) -> escribir Usuarios -> escribir UsuariosEventos (UNA escritura)
//   -> si la auditoria falla: REVERTIR Usuarios -> invalidar el cache del usuario afectado.
// Nunca queda un cambio administrativo sin auditoria. Los errores son {ok:false, codigo, mensaje}; los codigos:
//   E10_ADMIN_INACTIVO, E10_GESTION_EXTERNOS_INACTIVA, PERMISSION_DENIED, INVALID_REQUEST, SERVICE_UNAVAILABLE (lock),
//   USUARIOS_NO_EXISTE / USUARIOS_ESQUEMA_INCOMPLETO / AUDITORIA_NO_DISPONIBLE (fail-closed: sin esquema no se escribe nada),
//   USUARIO_EXISTE, USUARIO_NO_ENCONTRADO, EMAIL_DUPLICADO_EN_HOJA, CONFLICT_VERSION, EMAIL_INVALIDO, NOMBRE_INVALIDO, ESTADO_INVALIDO, TIPO_INVALIDO,
//   PERMISO_DESCONOCIDO, PERMISOS_INCONSISTENTES, TIPO_NO_PERMITE_PERMISO, CONCESION_AUTOMATICA (E10-3), ULTIMO_ADMIN,
//   MOTIVO_REQUERIDO (E10-2: desactivar, reactivar, quitar usuarios_admin y cambiar INTERNO <-> EXTERNO exigen motivo), USUARIO_YA_ACTIVO / USUARIO_YA_INACTIVO (E10-2).
// E10_GESTION_EXTERNOS_ACTIVO gobierna SOLO las altas NUEVAS de externos (crear uno, convertir uno a EXTERNO, reactivar uno): no el acceso de los externos ya existentes.
// E10-3 (politica de autoridad): independiente de ese flag, el techo de permisos de un EXTERNO (aplicableExterno = false: usuarios_admin y los de autoridad DGI) lo aplica usuariosDominio_validarMutacion a TODA
// mutacion, tambien a un EXTERNO ACTIVO ya existente: ningun administrador puede otorgarle esos permisos. Convertir INTERNO -> EXTERNO con permisos de autoridad se rechaza listando TODOS (sin quitar nada en silencio);
// pasar EXTERNO -> INTERNO no activa por si solo permisos inefectivos (CONCESION_AUTOMATICA); reactivar un EXTERNO con permisos incompatibles heredados se rechaza hasta que se quiten.
var USUARIOS_ADMIN_LOCK_MS = 10000;
var USUARIOS_ADMIN_MOTIVO_MAX = 200;
var USUARIOS_ADMIN_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9._:-]{1,80}$/;

function usuariosAdmin_error(codigo, mensaje, extra) {
  var r = { ok: false, codigo: codigo, mensaje: mensaje };
  if (extra) {
    Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
  }
  return r;
}

function usuariosAdmin_log(texto) {
  try {
    Logger.log(texto);
  } catch (err) {
    // sin log disponible
  }
}

function usuariosAdmin_codigoDeError(err) {
  var m = /^([A-Z_]+):/.exec(String(err && err.message ? err.message : err));
  return m ? m[1] : 'SERVICE_UNAVAILABLE';
}

// Vista del usuario que devuelve la operacion (sin fila de hoja ni datos internos): lo necesario para que el cliente reenvie version y etag.
function usuariosAdmin_vista(u) {
  var permisos = permisosCatalogo_aLista(u.permisos);
  return {
    email: u.email,
    nombre: u.nombre,
    tipo: u.tipo,
    estado: u.estado,
    version: u.version,
    etag: usuariosDominio_etag(u),
    permisos: permisos,
    cantidadPermisos: permisos.length,
    // E10-3: permisos asignados en la hoja que NO son efectivos para este tipo (p. ej. un EXTERNO con perfil_validar en SI por edicion manual o dato historico). La pantalla los muestra como
    // "asignado en origen pero inefectivo"; la hoja no se limpia sola.
    permisosInefectivos: usuariosDominio_permisosInefectivos(u.permisos, usuariosDominio_normalizarTipo(u.tipo)),
    esAdmin: usuariosDominio_esAdminEfectivo(u),
    actualizadoUtc: u.actualizadoUtc || '',
    actualizadoPor: u.actualizadoPor || ''
  };
}

// E10-2: el MOTIVO es obligatorio en las mutaciones sensibles (no por cada checkbox): desactivar, reactivar, quitar usuarios_admin y cambiar INTERNO <-> EXTERNO.
function usuariosAdmin_exigeMotivo(antes, despues) {
  if (!antes) {
    return false;
  }
  var quitaAdmin = antes.permisos && antes.permisos.usuarios_admin === true && !(despues.permisos && despues.permisos.usuarios_admin === true);
  return antes.estado !== despues.estado || antes.tipo !== despues.tipo || quitaAdmin === true;
}

function usuariosAdmin_motivo(datos) {
  var m = datos && typeof datos.motivo === 'string' ? datos.motivo.trim() : '';
  return m.slice(0, USUARIOS_ADMIN_MOTIVO_MAX);
}

// Valida lo comun de la entrada: actor (email valido), clientRequestId (opcional, formato), motivo. Devuelve {ok} o el error.
function usuariosAdmin_entrada(actor, datos) {
  if (!actor || !usuariosDominio_emailValido(usuariosDominio_normalizarEmail(actor.email))) {
    return usuariosAdmin_error('PERMISSION_DENIED', 'actor invalido');
  }
  if (!datos || typeof datos !== 'object') {
    return usuariosAdmin_error('INVALID_REQUEST', 'datos invalidos');
  }
  if (datos.clientRequestId !== undefined && datos.clientRequestId !== null && (typeof datos.clientRequestId !== 'string' || !USUARIOS_ADMIN_CLIENT_REQUEST_ID_REGEX.test(datos.clientRequestId))) {
    return usuariosAdmin_error('INVALID_REQUEST', 'clientRequestId invalido');
  }
  return { ok: true };
}

// Lista de ids -> {ok:true, ids} o error PERMISO_DESCONOCIDO / INVALID_REQUEST. Se valida ANTES de convertir a objeto (convertir descartaria en silencio un id inexistente).
function usuariosAdmin_idsDePermisos(permisos) {
  if (!Array.isArray(permisos)) {
    return usuariosAdmin_error('INVALID_REQUEST', 'permisos debe ser una lista de ids');
  }
  for (var i = 0; i < permisos.length; i++) {
    if (!permisosCatalogo_existe(permisos[i])) {
      return usuariosAdmin_error('PERMISO_DESCONOCIDO', 'permiso inexistente: ' + String(permisos[i]).slice(0, 40));
    }
  }
  return { ok: true, ids: permisos.filter(function (p, i) { return permisos.indexOf(p) === i; }) };
}

function usuariosAdmin_cambiosDeFila(u, instante, actorEmail, incluirAlta) {
  var cambios = {
    nombre: u.nombre,
    estado: u.estado,
    tipo: u.tipo,
    version: u.version,
    actualizado_utc: instante,
    actualizado_por: actorEmail
  };
  permisosCatalogo_ids().forEach(function (id) { cambios[id] = sheetUserRepository_aSiNo(u.permisos[id] === true); });
  if (incluirAlta) {
    cambios.email = u.email;
    cambios.fecha_alta = instante.slice(0, 10);
  }
  return cambios;
}

// Altas NUEVAS de externos: crear uno, convertir uno a EXTERNO o reactivar uno. Con E10_GESTION_EXTERNOS_ACTIVO apagado se rechazan.
function usuariosAdmin_esAltaDeExterno(antes, despues) {
  if (despues.tipo !== 'EXTERNO' || despues.estado !== 'activo') {
    return false;
  }
  return !antes || antes.tipo !== 'EXTERNO' || antes.estado !== 'activo';
}

// Nucleo comun. `construir(antes, usuarios)` devuelve {ok:true, despues, cambiaPermisos} o un error; `antes` es null en un alta.
function usuariosAdmin_ejecutar(actor, datos, opciones, construir) {
  var entrada = usuariosAdmin_entrada(actor, datos);
  if (entrada.ok !== true) {
    return entrada;
  }
  if (!e10Flags_adminUsuariosActivo()) {
    return usuariosAdmin_error('E10_ADMIN_INACTIVO', 'la administracion de usuarios no esta activa');
  }
  var email = usuariosDominio_normalizarEmail(datos.email);
  if (!usuariosDominio_emailValido(email)) {
    return usuariosAdmin_error('EMAIL_INVALIDO', 'el email no es valido');
  }
  var actorEmail = usuariosDominio_normalizarEmail(actor.email);

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(USUARIOS_ADMIN_LOCK_MS);
  } catch (err) {
    return usuariosAdmin_error('SERVICE_UNAVAILABLE', 'otra operacion administrativa esta en curso: reintentar');
  }
  var escribioUsuarios = null;      // {tipo:'update'|'create', fila, crudo}
  try {
    var hoja;
    var auditoria;
    try {
      hoja = sheetUserRepository_abrirParaEscritura();
      auditoria = usuariosEventosRepository_abrir();
    } catch (err) {
      var codigo = usuariosAdmin_codigoDeError(err);
      usuariosAdmin_log('UsuariosAdmin: no se pudo abrir ' + codigo);
      return usuariosAdmin_error(codigo === 'SERVICE_UNAVAILABLE' ? 'SERVICE_UNAVAILABLE' : codigo, 'esquema o hoja no disponible');
    }

    var usuarios = sheetUserRepository_leerUsuarios(hoja);
    var eventos = usuariosEventosRepository_leer(auditoria);

    // el actor tiene que ser administrador EFECTIVO segun la hoja FRESCA (defensa en profundidad; el endpoint ya valido por cache)
    var delActor = usuarios.filter(function (u) { return u.email === actorEmail; });
    if (delActor.length === 0 || !usuariosDominio_esAdminEfectivo(delActor[0])) {
      return usuariosAdmin_error('PERMISSION_DENIED', 'el actor no es administrador efectivo');
    }

    var coincidencias = usuarios.filter(function (u) { return u.email === email; });
    if (coincidencias.length > 1) {
      return usuariosAdmin_error('EMAIL_DUPLICADO_EN_HOJA', 'el email figura mas de una vez en la hoja: depurar a mano antes de operar');
    }
    var antes = coincidencias.length === 1 ? coincidencias[0] : null;

    // reintento idempotente: el mismo clientRequestId ya aplicado a este usuario -> exito sin tocar nada
    var previo = usuariosEventosRepository_buscarPorClientRequestId(eventos, email, datos.clientRequestId);
    if (previo !== null && antes !== null) {
      return { ok: true, duplicada: true, usuario: usuariosAdmin_vista(antes), advertencias: [] };
    }

    var armado = construir(antes, usuarios);
    if (armado.ok !== true) {
      return armado;
    }
    var despues = armado.despues;

    if (usuariosAdmin_esAltaDeExterno(antes, despues) && !e10Flags_gestionExternosActivo()) {
      return usuariosAdmin_error('E10_GESTION_EXTERNOS_INACTIVA', 'las altas de usuarios externos no estan habilitadas');
    }

    var validacion = usuariosDominio_validarMutacion(antes, despues, usuarios, { cambiaPermisos: armado.cambiaPermisos === true });
    if (validacion.ok !== true) {
      return usuariosAdmin_error(validacion.codigo, validacion.mensaje, validacion.detalle ? { detalle: validacion.detalle } : null);
    }

    // el motivo se exige DESPUES de las reglas duras (ultimo admin, EXTERNO + usuarios_admin, aplicabilidad): el error mas fundamental sale primero
    if (usuariosAdmin_exigeMotivo(antes, despues) && usuariosAdmin_motivo(datos) === '') {
      return usuariosAdmin_error('MOTIVO_REQUERIDO', 'esta operacion exige un motivo');
    }

    var eventosNuevos = usuariosDominio_eventosDe(antes, Object.assign({}, despues, { version: antes ? antes.version + 1 : 1 }));
    if (antes && eventosNuevos.length === 0) {
      return { ok: true, sinCambios: true, usuario: usuariosAdmin_vista(antes), advertencias: [] };
    }
    despues.version = antes ? antes.version + 1 : 1;

    var instante = new Date().toISOString();
    despues.actualizadoUtc = instante;
    despues.actualizadoPor = actorEmail;
    var cambios = usuariosAdmin_cambiosDeFila(despues, instante, actorEmail, antes === null);
    try {
      if (antes) {
        escribioUsuarios = { tipo: 'update', fila: antes.fila, crudo: sheetUserRepository_leerFilaCruda(hoja, antes.fila) };
        sheetUserRepository_escribirFila(hoja, antes.fila, cambios);
      } else {
        var filaNueva = sheetUserRepository_agregarFila(hoja, cambios);
        escribioUsuarios = { tipo: 'create', fila: filaNueva, crudo: null };
      }
    } catch (err) {
      usuariosAdmin_revertir(hoja, escribioUsuarios);
      usuariosAdmin_log('UsuariosAdmin: fallo al escribir Usuarios');
      return usuariosAdmin_error('SERVICE_UNAVAILABLE', 'no se pudo escribir la hoja Usuarios');
    }

    var motivo = usuariosAdmin_motivo(datos);
    var aEscribir = eventosNuevos.map(function (e) {
      e.motivo = motivo;
      e.clientRequestId = datos.clientRequestId || '';
      e.origen = 'APP';
      return e;
    });
    try {
      usuariosEventosRepository_agregar(auditoria, aEscribir, usuariosEventosRepository_ultimaSecuencia(eventos), actorEmail);
    } catch (err) {
      // la auditoria no se pudo escribir: NO puede quedar el cambio sin rastro -> se REVIERTE Usuarios
      var revertido = usuariosAdmin_revertir(hoja, escribioUsuarios);
      usuariosAdmin_log('UsuariosAdmin: la auditoria fallo; reversion ' + (revertido ? 'OK' : 'FALLIDA (revisar la hoja Usuarios a mano)'));
      authService_invalidarAcceso(email);
      return usuariosAdmin_error('AUDITORIA_NO_DISPONIBLE', 'no se pudo registrar la auditoria: el cambio se revirtio', { revertido: revertido });
    }

    var advertencias = [];
    if (authService_invalidarAcceso(email).ok !== true) {
      advertencias.push('CACHE_NO_INVALIDADO');
    }
    return { ok: true, usuario: usuariosAdmin_vista(despues), eventos: aEscribir.map(function (e) { return e.evento; }), advertencias: advertencias };
  } finally {
    try {
      lock.releaseLock();
    } catch (err) {
      // el lock expira solo
    }
  }
}

// Deshace la escritura de Usuarios. true si quedo como estaba.
function usuariosAdmin_revertir(hoja, escribio) {
  if (!escribio) {
    return true;
  }
  try {
    if (escribio.tipo === 'update') {
      sheetUserRepository_restaurarFila(hoja, escribio.fila, escribio.crudo);
      return true;
    }
    return sheetUserRepository_quitarUltimaFilaSiEs(hoja, escribio.fila);
  } catch (err) {
    return false;
  }
}

// --- operaciones ---

// datos: {email, nombre, tipo, permisos: [ids], clientRequestId?, motivo?}
function usuariosAdmin_crear(actor, datos) {
  return usuariosAdmin_ejecutar(actor, datos, {}, function (antes) {
    if (antes) {
      return usuariosAdmin_error('USUARIO_EXISTE', 'ya existe un usuario con ese email (si esta inactivo, reactivarlo)');
    }
    var ids = usuariosAdmin_idsDePermisos(datos.permisos === undefined ? [] : datos.permisos);
    if (ids.ok !== true) {
      return ids;
    }
    return {
      ok: true,
      cambiaPermisos: true,
      despues: { email: usuariosDominio_normalizarEmail(datos.email), nombre: String(datos.nombre === undefined || datos.nombre === null ? '' : datos.nombre).trim(), tipo: usuariosDominio_normalizarTipo(datos.tipo), estado: 'activo', version: 1, permisos: permisosCatalogo_aObjeto(ids.ids) }
    };
  });
}

function usuariosAdmin_verificarVersion(antes, datos) {
  if (!antes) {
    return usuariosAdmin_error('USUARIO_NO_ENCONTRADO', 'no existe un usuario con ese email');
  }
  if (typeof datos.versionEsperada !== 'number' || !isFinite(datos.versionEsperada) || Math.floor(datos.versionEsperada) !== datos.versionEsperada || datos.versionEsperada < 0) {
    return usuariosAdmin_error('INVALID_REQUEST', 'versionEsperada es obligatoria');
  }
  var etagActual = usuariosDominio_etag(antes);
  if (datos.versionEsperada !== antes.version || (datos.etag !== undefined && datos.etag !== null && datos.etag !== etagActual)) {
    return usuariosAdmin_error('CONFLICT_VERSION', 'el usuario cambio desde que se abrio: recargar', { actual: usuariosAdmin_vista(antes) });
  }
  return { ok: true };
}

// datos: {email, versionEsperada, etag?, nombre?, tipo?, permisos?: [ids], clientRequestId?, motivo?}. Solo se cambia lo que se manda.
function usuariosAdmin_actualizar(actor, datos) {
  return usuariosAdmin_ejecutar(actor, datos, {}, function (antes) {
    var v = usuariosAdmin_verificarVersion(antes, datos);
    if (v.ok !== true) {
      return v;
    }
    var despues = { email: antes.email, nombre: antes.nombre, tipo: antes.tipo, estado: antes.estado, version: antes.version, permisos: Object.assign({}, antes.permisos) };
    var cambiaPermisos = false;
    if (datos.nombre !== undefined) {
      despues.nombre = String(datos.nombre === null ? '' : datos.nombre).trim();
    }
    if (datos.tipo !== undefined) {
      despues.tipo = usuariosDominio_normalizarTipo(datos.tipo);
    }
    if (datos.permisos !== undefined) {
      var ids = usuariosAdmin_idsDePermisos(datos.permisos);
      if (ids.ok !== true) {
        return ids;
      }
      despues.permisos = permisosCatalogo_aObjeto(ids.ids);
      cambiaPermisos = permisosCatalogo_aLista(despues.permisos).join(',') !== permisosCatalogo_aLista(antes.permisos).join(',');
    }
    return { ok: true, despues: despues, cambiaPermisos: cambiaPermisos };
  });
}

// datos: {email, versionEsperada, etag?, accion: 'DESACTIVAR' | 'REACTIVAR', clientRequestId?, motivo?}
function usuariosAdmin_cambiarEstado(actor, datos) {
  return usuariosAdmin_ejecutar(actor, datos, {}, function (antes) {
    var v = usuariosAdmin_verificarVersion(antes, datos);
    if (v.ok !== true) {
      return v;
    }
    if (datos.accion !== 'DESACTIVAR' && datos.accion !== 'REACTIVAR') {
      return usuariosAdmin_error('INVALID_REQUEST', 'accion debe ser DESACTIVAR o REACTIVAR');
    }
    if (datos.accion === 'DESACTIVAR' && antes.estado === 'inactivo') {
      return usuariosAdmin_error('USUARIO_YA_INACTIVO', 'el usuario ya esta inactivo');
    }
    if (datos.accion === 'REACTIVAR' && antes.estado === 'activo') {
      return usuariosAdmin_error('USUARIO_YA_ACTIVO', 'el usuario ya esta activo');
    }
    return {
      ok: true,
      // reactivar REVALIDA la consistencia completa (dependencias incluidas), no solo lo que cambia
      cambiaPermisos: datos.accion === 'REACTIVAR',
      despues: { email: antes.email, nombre: antes.nombre, tipo: antes.tipo, estado: datos.accion === 'DESACTIVAR' ? 'inactivo' : 'activo', version: antes.version, permisos: Object.assign({}, antes.permisos) }
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    usuariosAdmin_crear,
    usuariosAdmin_actualizar,
    usuariosAdmin_cambiarEstado,
    usuariosAdmin_vista,
    usuariosAdmin_exigeMotivo,
    USUARIOS_ADMIN_LOCK_MS
  };
}
