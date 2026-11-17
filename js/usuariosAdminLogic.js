// Logica PURA de la administracion de usuarios (E10-2: Administracion -> Usuarios). Sin DOM, sin red, sin estado: se prueba con Jest y la usa js/usuariosAdmin.js.
//
// Principios (decididos por producto):
//  - La autoridad real son los PERMISOS. `tipo` (INTERNO / EXTERNO) es descriptivo: aca nunca se infiere ningun permiso del tipo. Unica restriccion dura: un EXTERNO no puede tener usuarios_admin
//    (lo marca el catalogo con aplicableExterno = false; el BACKEND siempre valida: esta logica solo ayuda a no armar estados invalidos).
//  - El frontend NO mantiene una lista literal de permisos: todo sale del catalogo que entrega el backend (adminPermisosCatalogo): id, nombre, descripcion, modulo, categoria, aplicableInterno,
//    aplicableExterno, dependeDe, critico, orden. Lo unico que se nombra aca es `usuarios_admin` (el permiso de esta misma pantalla) y los CODIGOS de error que el backend ya define.
//  - Sin cascadas invisibles: activar un permiso cuyo requerido esta apagado OFRECE activar tambien el requerido; quitar un permiso del que dependen otros ADVIERTE cuales quedarian afectados y exige
//    una decision explicita (nada se apaga en silencio).
//  - Los conteos (administradores, etc.) los decide el backend bajo lock; lo que se muestra aca es informativo.
//
// Dependencias: ninguna (ES5, funciones globales usuariosAdminLogic_*).
var USUARIOS_ADMIN_PERMISO_ADMIN = 'usuarios_admin';
var USUARIOS_ADMIN_ANCHO_DOBLE = 900;

// ¿Se ofrece la tarjeta "Administracion" en el hub? Solo con usuarios_admin === true EXACTO. Es solo la UI: la defensa real es el backend.
function usuariosAdminLogic_puedeVer(permisos) {
  return !!permisos && permisos[USUARIOS_ADMIN_PERMISO_ADMIN] === true;
}

// Layout: 'doble' (listado + detalle lado a lado) en pantallas anchas; 'simple' (una cosa por vez) en el celular.
function usuariosAdminLogic_modoLayout(ancho) {
  return typeof ancho === 'number' && ancho >= USUARIOS_ADMIN_ANCHO_DOBLE ? 'doble' : 'simple';
}

// --- texto ---

function usuariosAdminLogic_normalizarTexto(t) {
  var s = String(t === null || t === undefined ? '' : t).toLowerCase();
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  return s.replace(/\s+/g, ' ').trim();
}

function usuariosAdminLogic_esEmailPlausible(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

// Fecha ISO-8601 UTC -> "dd/mm/aaaa hh:mm" en hora local; vacio o invalido -> "—".
function usuariosAdminLogic_formatearFecha(iso) {
  if (!iso) {
    return '—';
  }
  var d = new Date(iso);
  if (isNaN(d.getTime())) {
    return '—';
  }
  function dos(n) { return (n < 10 ? '0' : '') + n; }
  return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
}

// --- listado y filtros (en el frontend; el backend entrega la lista completa) ---

// filtros: {texto, estado: 'todos'|'activo'|'inactivo', tipo: 'todos'|'INTERNO'|'EXTERNO', admin: 'todos'|'admin'|'no_admin'}. El texto busca por nombre o email, todas las palabras (sin tildes ni mayusculas).
function usuariosAdminLogic_filtrar(usuarios, filtros) {
  var f = filtros || {};
  var palabras = usuariosAdminLogic_normalizarTexto(f.texto).split(' ').filter(function (p) { return p !== ''; });
  return (usuarios || []).filter(function (u) {
    if (f.estado === 'activo' && u.estado !== 'activo') { return false; }
    if (f.estado === 'inactivo' && u.estado !== 'inactivo') { return false; }
    if (f.tipo === 'INTERNO' && u.tipo !== 'INTERNO') { return false; }
    if (f.tipo === 'EXTERNO' && u.tipo !== 'EXTERNO') { return false; }
    if (f.admin === 'admin' && u.esAdmin !== true) { return false; }
    if (f.admin === 'no_admin' && u.esAdmin === true) { return false; }
    if (palabras.length === 0) { return true; }
    var pajar = usuariosAdminLogic_normalizarTexto((u.nombre || '') + ' ' + (u.email || ''));
    return palabras.every(function (p) { return pajar.indexOf(p) >= 0; });
  });
}

function usuariosAdminLogic_resumenListado(total, filtrados) {
  if (filtrados === total) {
    return total === 1 ? '1 usuario' : total + ' usuarios';
  }
  return filtrados + ' de ' + total + (total === 1 ? ' usuario' : ' usuarios');
}

// Resumen que se pinta en la tarjeta de un usuario: lo minimo (nombre, email, estado, tipo, cantidad de permisos, admin, ultima actualizacion).
function usuariosAdminLogic_tarjeta(u) {
  return {
    nombre: u.nombre || u.email,
    email: u.email,
    activo: u.estado === 'activo',
    estadoTexto: u.estado === 'activo' ? 'Activo' : 'Inactivo',
    tipoTexto: u.tipo === 'EXTERNO' ? 'Externo' : 'Interno',
    externo: u.tipo === 'EXTERNO',
    esAdmin: u.esAdmin === true,
    permisosTexto: u.cantidadPermisos === 1 ? '1 permiso' : (u.cantidadPermisos || 0) + ' permisos',
    actualizado: usuariosAdminLogic_formatearFecha(u.actualizadoUtc)
  };
}

// --- catalogo ---

function usuariosAdminLogic_porId(catalogo, id) {
  for (var i = 0; i < (catalogo || []).length; i++) {
    if (catalogo[i].id === id) {
      return catalogo[i];
    }
  }
  return null;
}

function usuariosAdminLogic_nombrePermiso(catalogo, id) {
  var p = usuariosAdminLogic_porId(catalogo, id);
  return p ? p.nombre : String(id);
}

// Agrupa por modulo (en el orden del catalogo); dentro de cada modulo, por `orden`. [{modulo, orden, permisos:[...]}]
function usuariosAdminLogic_agruparCatalogo(catalogo) {
  var grupos = [];
  var porModulo = {};
  (catalogo || []).slice().sort(function (a, b) { return a.orden - b.orden; }).forEach(function (p) {
    if (!porModulo[p.modulo]) {
      porModulo[p.modulo] = { modulo: p.modulo, orden: p.orden, permisos: [] };
      grupos.push(porModulo[p.modulo]);
    }
    porModulo[p.modulo].permisos.push(p);
  });
  return grupos;
}

// ¿El permiso se puede dar a un usuario de este tipo? (el techo EXTERNO sale del catalogo: aplicableExterno = false)
function usuariosAdminLogic_aplicable(permiso, tipo) {
  if (!permiso) { return false; }
  return tipo === 'EXTERNO' ? permiso.aplicableExterno === true : permiso.aplicableInterno === true;
}

// Requeridos TRANSITIVOS de un permiso (dependeDe, y los dependeDe de esos).
function usuariosAdminLogic_requeridos(catalogo, id) {
  var salida = [];
  var pila = [id];
  var vistos = {};
  while (pila.length > 0) {
    var actual = usuariosAdminLogic_porId(catalogo, pila.pop());
    if (!actual) { continue; }
    (actual.dependeDe || []).forEach(function (d) {
      if (!vistos[d]) {
        vistos[d] = true;
        salida.push(d);
        pila.push(d);
      }
    });
  }
  return salida;
}

// Al ACTIVAR `id`: {faltantes: requeridos (transitivos) que NO estan en la seleccion}.
function usuariosAdminLogic_alActivar(catalogo, seleccion, id) {
  var sel = seleccion || [];
  return { faltantes: usuariosAdminLogic_requeridos(catalogo, id).filter(function (r) { return sel.indexOf(r) < 0; }) };
}

// Al QUITAR `id`: {dependientes: permisos hoy seleccionados que dependen de `id` (transitivamente)}.
function usuariosAdminLogic_alQuitar(catalogo, seleccion, id) {
  var sel = seleccion || [];
  return {
    dependientes: sel.filter(function (s) {
      return s !== id && usuariosAdminLogic_requeridos(catalogo, s).indexOf(id) >= 0;
    })
  };
}

// Seleccion nueva tras activar `id`. Con conRequeridos = true agrega tambien los requeridos que faltan (decision EXPLICITA del administrador); si no, solo `id`.
function usuariosAdminLogic_activar(catalogo, seleccion, id, conRequeridos) {
  var sel = (seleccion || []).slice();
  if (conRequeridos === true) {
    usuariosAdminLogic_alActivar(catalogo, sel, id).faltantes.forEach(function (f) { if (sel.indexOf(f) < 0) { sel.push(f); } });
  }
  if (sel.indexOf(id) < 0) { sel.push(id); }
  return usuariosAdminLogic_ordenarIds(catalogo, sel);
}

// Seleccion nueva tras quitar `id`. Con alsoDependientes = true quita tambien los dependientes (decision EXPLICITA); si no, solo `id` (puede dejar un estado invalido: el que llama debe haber advertido).
function usuariosAdminLogic_quitar(catalogo, seleccion, id, tambienDependientes) {
  var quitar = [id];
  if (tambienDependientes === true) {
    quitar = quitar.concat(usuariosAdminLogic_alQuitar(catalogo, seleccion, id).dependientes);
  }
  return usuariosAdminLogic_ordenarIds(catalogo, (seleccion || []).filter(function (s) { return quitar.indexOf(s) < 0; }));
}

// Ids en el orden del catalogo (los que no estan en el catalogo, al final y sin cambios: el backend los rechazara).
function usuariosAdminLogic_ordenarIds(catalogo, ids) {
  var orden = {};
  (catalogo || []).forEach(function (p) { orden[p.id] = p.orden; });
  return (ids || []).slice().sort(function (a, b) {
    var oa = orden[a] === undefined ? 1e9 : orden[a];
    var ob = orden[b] === undefined ? 1e9 : orden[b];
    return oa - ob;
  });
}

// Validacion de apoyo (la autoridad es el backend): {ok, errores:[{codigo, permiso, mensaje}]}. Codigos = los del backend: PERMISO_DESCONOCIDO, TIPO_NO_PERMITE_PERMISO, PERMISOS_INCONSISTENTES.
function usuariosAdminLogic_validarSeleccion(catalogo, tipo, seleccion) {
  var errores = [];
  (seleccion || []).forEach(function (id) {
    var p = usuariosAdminLogic_porId(catalogo, id);
    if (!p) {
      errores.push({ codigo: 'PERMISO_DESCONOCIDO', permiso: id, mensaje: usuariosAdminLogic_mensajeError('PERMISO_DESCONOCIDO') });
      return;
    }
    if (!usuariosAdminLogic_aplicable(p, tipo)) {
      errores.push({ codigo: 'TIPO_NO_PERMITE_PERMISO', permiso: id, mensaje: 'Un usuario ' + (tipo === 'EXTERNO' ? 'externo' : 'interno') + ' no puede tener «' + p.nombre + '».' });
    }
    (p.dependeDe || []).forEach(function (d) {
      if ((seleccion || []).indexOf(d) < 0) {
        errores.push({ codigo: 'PERMISOS_INCONSISTENTES', permiso: id, mensaje: '«' + p.nombre + '» requiere «' + usuariosAdminLogic_nombrePermiso(catalogo, d) + '».' });
      }
    });
  });
  return { ok: errores.length === 0, errores: errores };
}

// --- cambios, motivo y confirmaciones ---

// original / edicion: {nombre, tipo, permisos:[ids]}. Devuelve los cambios concretos.
function usuariosAdminLogic_diferencias(original, edicion) {
  var o = original || {};
  var e = edicion || {};
  var antes = o.permisos || [];
  var despues = e.permisos || [];
  var nombreAntes = String(o.nombre || '').trim();
  var nombreDespues = String(e.nombre === undefined || e.nombre === null ? '' : e.nombre).trim();
  var r = {
    nombre: nombreAntes !== nombreDespues ? { antes: nombreAntes, despues: nombreDespues } : null,
    tipo: o.tipo !== e.tipo ? { antes: o.tipo, despues: e.tipo } : null,
    agregados: despues.filter(function (p) { return antes.indexOf(p) < 0; }),
    quitados: antes.filter(function (p) { return despues.indexOf(p) < 0; })
  };
  r.hayCambios = r.nombre !== null || r.tipo !== null || r.agregados.length > 0 || r.quitados.length > 0;
  return r;
}

// El motivo es OBLIGATORIO para: desactivar, reactivar, quitar usuarios_admin y cambiar INTERNO <-> EXTERNO (igual que el backend). Para nombre y permisos comunes es opcional.
function usuariosAdminLogic_requiereMotivo(accion, original, edicion) {
  if (accion === 'DESACTIVAR' || accion === 'REACTIVAR') {
    return true;
  }
  if (accion !== 'ACTUALIZAR') {
    return false;
  }
  var d = usuariosAdminLogic_diferencias(original, edicion);
  return d.tipo !== null || d.quitados.indexOf(USUARIOS_ADMIN_PERMISO_ADMIN) >= 0;
}

// Textos de confirmacion CONCRETOS (nunca un "¿Esta seguro?" generico). Devuelve {titulo, lineas:[...], boton, pideMotivo, critica}. null si la accion no necesita confirmacion (cambio comun).
function usuariosAdminLogic_confirmacion(accion, usuario, original, edicion, catalogo) {
  var nombre = (usuario && (usuario.nombre || usuario.email)) || '';
  var email = (usuario && usuario.email) || '';
  var quien = nombre + (email && nombre !== email ? ' (' + email + ')' : '');
  if (accion === 'DESACTIVAR') {
    return {
      titulo: 'Desactivar usuario',
      lineas: ['Vas a desactivar a ' + quien + '. Pierde el acceso a la aplicación de inmediato; no se borra nada: conserva sus permisos y su historial y se puede reactivar.'],
      boton: 'Desactivar usuario', pideMotivo: true, critica: true
    };
  }
  if (accion === 'REACTIVAR') {
    var ext = usuario && usuario.tipo === 'EXTERNO';
    return {
      titulo: 'Reactivar usuario',
      lineas: ['Vas a reactivar a ' + quien + '. Recupera el acceso con los permisos que ya tenía' + (ext ? ' (es un usuario externo: requiere la gestión de externos habilitada)' : '') + '.'],
      boton: 'Reactivar usuario', pideMotivo: true, critica: false
    };
  }
  if (accion === 'CREAR') {
    var d0 = edicion || {};
    var externo = d0.tipo === 'EXTERNO';
    var lineasC = ['Vas a crear a ' + String(d0.nombre || '').trim() + ' (' + String(d0.email || '').trim() + ') como usuario ' + (externo ? 'externo' : 'interno') + ' con ' + (d0.permisos || []).length + ' permiso(s).'];
    if ((d0.permisos || []).indexOf(USUARIOS_ADMIN_PERMISO_ADMIN) >= 0) {
      lineasC.push('Tendrá «' + usuariosAdminLogic_nombrePermiso(catalogo, USUARIOS_ADMIN_PERMISO_ADMIN) + '»: podrá crear y editar usuarios y permisos.');
    }
    return { titulo: 'Crear usuario', lineas: lineasC, boton: 'Crear usuario', pideMotivo: false, critica: (d0.permisos || []).indexOf(USUARIOS_ADMIN_PERMISO_ADMIN) >= 0 };
  }
  if (accion === 'ACTUALIZAR') {
    var d = usuariosAdminLogic_diferencias(original, edicion);
    var lineas = [];
    var critica = false;
    if (d.tipo) {
      critica = true;
      lineas.push('Cambia el tipo de ' + quien + ' de ' + (d.tipo.antes === 'EXTERNO' ? 'externo' : 'interno') + ' a ' + (d.tipo.despues === 'EXTERNO' ? 'externo' : 'interno') + '. El tipo no concede ni quita permisos: conserva los que tiene.');
    }
    if (d.agregados.indexOf(USUARIOS_ADMIN_PERMISO_ADMIN) >= 0) {
      critica = true;
      lineas.push('Le das «' + usuariosAdminLogic_nombrePermiso(catalogo, USUARIOS_ADMIN_PERMISO_ADMIN) + '» a ' + quien + ': podrá crear, editar, desactivar y reactivar usuarios y cambiar sus permisos.');
    }
    if (d.quitados.indexOf(USUARIOS_ADMIN_PERMISO_ADMIN) >= 0) {
      critica = true;
      lineas.push('Le quitás «' + usuariosAdminLogic_nombrePermiso(catalogo, USUARIOS_ADMIN_PERMISO_ADMIN) + '» a ' + quien + ': dejará de poder administrar usuarios.');
    }
    if (lineas.length === 0) {
      return null;
    }
    return { titulo: 'Confirmar cambios sensibles', lineas: lineas, boton: 'Guardar cambios', pideMotivo: usuariosAdminLogic_requiereMotivo('ACTUALIZAR', original, edicion), critica: critica };
  }
  return null;
}

// Texto de un evento de auditoria para la linea de tiempo del detalle.
function usuariosAdminLogic_etiquetaEvento(evento) {
  var m = {
    USUARIO_CREADO: 'Creado',
    USUARIO_ACTUALIZADO: 'Actualizado',
    USUARIO_DESACTIVADO: 'Desactivado',
    USUARIO_REACTIVADO: 'Reactivado',
    USUARIO_MIGRADO: 'Migración inicial (E10)',
    USUARIO_MIGRACION_REVERTIDA: 'Migración revertida'
  };
  return m[evento] || String(evento || '');
}

function usuariosAdminLogic_resumenEvento(e, catalogo) {
  var partes = [];
  if (e.nombreAnterior && e.nombreAnterior !== e.nombreObjetivo) {
    partes.push('Nombre: «' + e.nombreAnterior + '» → «' + e.nombreObjetivo + '»');
  }
  if (e.tipoAnterior && e.tipoAnterior !== e.tipoNuevo) {
    partes.push('Tipo: ' + e.tipoAnterior + ' → ' + e.tipoNuevo);
  }
  if (e.estadoAnterior && e.estadoAnterior !== e.estadoNuevo) {
    partes.push('Estado: ' + e.estadoAnterior + ' → ' + e.estadoNuevo);
  }
  var antes = e.permisosAntes || [];
  var despues = e.permisosDespues || [];
  var agregados = despues.filter(function (p) { return antes.indexOf(p) < 0; });
  var quitados = antes.filter(function (p) { return despues.indexOf(p) < 0; });
  if (agregados.length > 0) {
    partes.push('Permisos agregados: ' + agregados.map(function (p) { return usuariosAdminLogic_nombrePermiso(catalogo, p); }).join(', '));
  }
  if (quitados.length > 0) {
    partes.push('Permisos quitados: ' + quitados.map(function (p) { return usuariosAdminLogic_nombrePermiso(catalogo, p); }).join(', '));
  }
  if (e.versionNueva) {
    partes.push('Versión ' + e.versionNueva);
  }
  return partes;
}

// --- errores ---

// Mensaje util por CODIGO del backend. Nunca un "algo salio mal" cuando hay un codigo conocido. `extra` (opcional): {actual} en un conflicto.
function usuariosAdminLogic_mensajeError(codigo, extra) {
  var m = {
    E10_ADMIN_INACTIVO: 'Administración temporalmente deshabilitada. No se pueden hacer cambios hasta que se habilite.',
    E10_GESTION_EXTERNOS_INACTIVA: 'La gestión de usuarios externos está deshabilitada: no se pueden crear externos, convertir un usuario a externo ni reactivar un externo.',
    PERMISSION_DENIED: 'No tenés permiso para administrar usuarios.',
    CONFLICT_VERSION: 'Otro administrador modificó este usuario mientras lo editabas. No se guardó nada: se recargaron sus datos actuales para que revises y vuelvas a intentar.',
    ULTIMO_ADMIN: 'No se puede: el sistema quedaría sin administradores efectivos (un administrador efectivo es un usuario activo, interno y con permiso de administración).',
    USUARIO_EXISTE: 'Ya existe un usuario con ese email. Si está inactivo, reactivalo desde su detalle.',
    EMAIL_INVALIDO: 'El email no es válido.',
    NOMBRE_INVALIDO: 'El nombre es obligatorio (hasta 80 caracteres).',
    TIPO_INVALIDO: 'El tipo debe ser Interno o Externo.',
    PERMISO_DESCONOCIDO: 'Se pidió un permiso que no existe en el catálogo. Recargá la pantalla e intentá de nuevo.',
    PERMISOS_INCONSISTENTES: 'Faltan permisos requeridos: algún permiso depende de otro que no está activado.',
    TIPO_NO_PERMITE_PERMISO: 'Un usuario externo no puede tener el permiso de administración de usuarios ni otros permisos no aplicables a externos.',
    USUARIO_NO_ENCONTRADO: 'El usuario no existe (puede que se haya eliminado de la hoja). Volvé al listado y actualizá.',
    USUARIO_YA_INACTIVO: 'El usuario ya está inactivo. Se recargaron sus datos.',
    USUARIO_YA_ACTIVO: 'El usuario ya está activo. Se recargaron sus datos.',
    MOTIVO_REQUERIDO: 'Esta acción exige un motivo.',
    EMAIL_DUPLICADO_EN_HOJA: 'Ese email figura más de una vez en la hoja de usuarios. Hay que depurarlo a mano antes de operar.',
    AUDITORIA_NO_DISPONIBLE: 'No se pudo registrar la auditoría, así que el cambio se revirtió. No se guardó nada.',
    USUARIOS_NO_EXISTE: 'No se encontró la hoja de usuarios.',
    USUARIOS_ESQUEMA_INCOMPLETO: 'La hoja de usuarios no tiene el esquema esperado.',
    SERVICE_UNAVAILABLE: 'No se pudo completar la operación. Si otro administrador está guardando cambios, esperá unos segundos y reintentá.',
    INVALID_REQUEST: 'El pedido no es válido. Revisá los datos e intentá de nuevo.',
    UNAUTHORIZED: 'Tu sesión venció. Iniciá sesión de nuevo.',
    USER_DISABLED: 'Tu cuenta no tiene acceso habilitado.'
  };
  if (codigo === 'CONFLICT_VERSION' && extra && extra.actual && extra.actual.version) {
    return m.CONFLICT_VERSION + ' (versión actual: ' + extra.actual.version + ')';
  }
  return m[codigo] || 'No se pudo completar la operación (código ' + String(codigo || 'desconocido') + ').';
}

// A que estado de pantalla lleva un codigo al CARGAR (listado / catalogo): 'deshabilitada' | 'sinPermiso' | 'sesion' | 'error'.
function usuariosAdminLogic_estadoPorCodigo(codigo) {
  if (codigo === 'E10_ADMIN_INACTIVO') { return 'deshabilitada'; }
  if (codigo === 'PERMISSION_DENIED') { return 'sinPermiso'; }
  if (codigo === 'UNAUTHORIZED' || codigo === 'USER_DISABLED') { return 'sesion'; }
  return 'error';
}

// Codigos tras los que conviene RECARGAR el usuario (el estado que veia la pantalla quedo viejo).
function usuariosAdminLogic_codigoRecarga(codigo) {
  return codigo === 'CONFLICT_VERSION' || codigo === 'USUARIO_YA_INACTIVO' || codigo === 'USUARIO_YA_ACTIVO';
}

// Id de intencion para la idempotencia: UNO por intencion del administrador (se reusa en el reintento del MISMO pedido). Formato aceptado por el backend: [A-Za-z0-9._:-]{1,80}.
function usuariosAdminLogic_nuevoClientRequestId() {
  var base;
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    base = window.crypto.randomUUID();
  } else {
    base = String(new Date().getTime()) + '-' + String(Math.floor(Math.random() * 1e9)) + '-' + String(Math.floor(Math.random() * 1e9));
  }
  return ('adm-' + base).replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 80);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_ADMIN_PERMISO_ADMIN,
    USUARIOS_ADMIN_ANCHO_DOBLE,
    usuariosAdminLogic_puedeVer,
    usuariosAdminLogic_modoLayout,
    usuariosAdminLogic_normalizarTexto,
    usuariosAdminLogic_esEmailPlausible,
    usuariosAdminLogic_formatearFecha,
    usuariosAdminLogic_filtrar,
    usuariosAdminLogic_resumenListado,
    usuariosAdminLogic_tarjeta,
    usuariosAdminLogic_porId,
    usuariosAdminLogic_nombrePermiso,
    usuariosAdminLogic_agruparCatalogo,
    usuariosAdminLogic_aplicable,
    usuariosAdminLogic_requeridos,
    usuariosAdminLogic_alActivar,
    usuariosAdminLogic_alQuitar,
    usuariosAdminLogic_activar,
    usuariosAdminLogic_quitar,
    usuariosAdminLogic_ordenarIds,
    usuariosAdminLogic_validarSeleccion,
    usuariosAdminLogic_diferencias,
    usuariosAdminLogic_requiereMotivo,
    usuariosAdminLogic_confirmacion,
    usuariosAdminLogic_etiquetaEvento,
    usuariosAdminLogic_resumenEvento,
    usuariosAdminLogic_mensajeError,
    usuariosAdminLogic_estadoPorCodigo,
    usuariosAdminLogic_codigoRecarga,
    usuariosAdminLogic_nuevoClientRequestId
  };
}
