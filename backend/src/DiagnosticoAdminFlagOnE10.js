// DiagnosticoAdminFlagOnE10 (E10-2): herramienta MANUAL (se corre a mano desde el editor de Apps Script; ningun endpoint, trigger ni pantalla la llama) para la PRIMERA PRUEBA REAL de la administracion de usuarios
// con E10_ADMIN_USUARIOS_ACTIVO encendido, SIN ninguna escritura real.
//
//   diagnosticoAdminFlagOnE10()   Se NIEGA a correr si E10_ADMIN_USUARIOS_ACTIVO no es exactamente 'SI' o si E10_GESTION_EXTERNOS_ACTIVO es 'SI'. Pega por doPost (el camino real del Web App) con sesiones firmadas
//                                 en memoria (nunca se imprimen) y comprueba:
//     LECTURAS   adminUsuariosListar (cantidades esperadas + una linea por usuario), adminPermisosCatalogo (17 permisos, ids unicos, metadata completa, orden estable, usuarios_admin no aplicable a EXTERNO)
//                y adminUsuarioObtener (cada administrador efectivo, un INTERNO no administrador y un EXTERNO: version, etag, permisos, eventos recientes).
//     GATES      administrador real -> permitido (las lecturas responden ok; las escrituras, con cuerpo VACIO, llegan a la validacion y responden INVALID_REQUEST); INTERNO no administrador -> PERMISSION_DENIED;
//                EXTERNO -> PERMISSION_DENIED; token invalido -> UNAUTHORIZED. Con el flag ON NO se amplia el acceso de nadie.
//     EXTERNOS   con E10_GESTION_EXTERNOS_ACTIVO apagado: crear EXTERNO, convertir INTERNO -> EXTERNO y reactivar EXTERNO responden E10_GESTION_EXTERNOS_INACTIVA. «Reactivar» se prueba sobre un externo
//                inactivo SINTETICO que existe solo en memoria durante esa llamada (hoy no hay ninguno real).
//
// CERO ESCRITURAS REALES, GARANTIZADO POR UNA GUARDA EXPLICITA (no por confiar en que un cuerpo invalido sea rechazado): mientras corre, TODAS las funciones que escriben en Usuarios o UsuariosEventos
// (sheetUserRepository_escribirFila / _agregarFila / _restaurarFila / _quitarUltimaFilaSiEs / _agregarColumnas / _escribirCeldas / _quitarColumnas / _crearRespaldo, usuariosEventosRepository_agregar,
// setupUsuariosEventosSheet y authService_invalidarAcceso) se REEMPLAZAN por funciones que LANZAN y cuentan el intento; se verifica que el reemplazo quedo instalado y que BLOQUEA (una sonda lo prueba) ANTES de llamar a ningun endpoint, y se
// restauran SIEMPRE (tambien ante una excepcion). Si algo intentara escribir, no escribe: la respuesta es un error y el informe lo marca como FALTA. Ademas se compara una huella de las hojas Usuarios y
// UsuariosEventos ANTES y DESPUES. logHistoryEvent y telegramRepository_sendMessage tambien se reemplazan por contadores (los endpoints escriben en Historial por diseno).
// Efectos que SI pueden ocurrir: el ScriptLock que toma un servicio administrativo mientras evalua y el cache positivo de acceso que escribe cualquier getUserAccess.
//
// PRIVACIDAD: emails enmascarados (a***@dominio), nombres solo como iniciales, nunca tokens, ids de Drive ni secretos.
var DIAG_ADMFLAG_VERSION = 1;
var DIAG_ADMFLAG_ESPERADO = { total: 11, activos: 11, interno: 9, externo: 2, administradoresEfectivos: 2, permisos: 17 };
var DIAG_ADMFLAG_ACCIONES = ['adminUsuariosListar', 'adminPermisosCatalogo', 'adminUsuarioObtener', 'adminUsuarioCrear', 'adminUsuarioActualizar', 'adminUsuarioDesactivar', 'adminUsuarioReactivar'];
var DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS = ['sheetUserRepository_escribirFila', 'sheetUserRepository_agregarFila', 'sheetUserRepository_restaurarFila', 'sheetUserRepository_quitarUltimaFilaSiEs', 'sheetUserRepository_agregarColumnas', 'sheetUserRepository_escribirCeldas', 'sheetUserRepository_quitarColumnas', 'sheetUserRepository_crearRespaldo', 'usuariosEventosRepository_agregar', 'setupUsuariosEventosSheet', 'authService_invalidarAcceso'];
var DIAG_ADMFLAG_METADATA = ['id', 'nombre', 'descripcion', 'modulo', 'categoria', 'aplicableInterno', 'aplicableExterno', 'dependeDe', 'critico', 'orden'];
var DIAG_ADMFLAG_EMAIL_SINTETICO = 'e10-2-diagnostico-sintetico@example.com';

function diagAdm_mascara(email) {
  var t = String(email === null || email === undefined ? '' : email).trim();
  var arroba = t.indexOf('@');
  return arroba < 1 ? '***' : t.charAt(0) + '***' + t.substring(arroba);
}

function diagAdm_iniciales(nombre) {
  var partes = String(nombre === null || nombre === undefined ? '' : nombre).trim().split(/\s+/).filter(function (p) { return p !== ''; });
  return partes.length === 0 ? '(sin nombre)' : partes.map(function (p) { return p.charAt(0).toUpperCase() + '.'; }).join(' ');
}

function diagAdm_norm(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

// Huella corta y determinista (FNV-1a de 32 bits con dos semillas) de un texto: solo detecta cambios.
function diagAdm_huella(texto) {
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

// Reemplaza las funciones de escritura por una GUARDA que lanza y cuenta; verifica la instalacion y que bloquea; SIEMPRE restaura. fn(estado) solo corre si la guarda esta instalada y probada.
function diagAdm_sinEscrituras(fn) {
  var global_ = typeof globalThis !== 'undefined' ? globalThis : this;
  var originales = {};
  var estado = { instalada: true, sondaBloqueada: false, intentos: 0, funciones: DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.slice() };
  try {
    DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach(function (nombre) {
      originales[nombre] = global_[nombre];
      var guarda = function () {
        estado.intentos = estado.intentos + 1;
        throw new Error('GUARDA_SIN_ESCRITURAS: ' + nombre);
      };
      global_[nombre] = guarda;
      if (global_[nombre] !== guarda) {
        estado.instalada = false;
      }
    });
    if (estado.instalada) {
      // sonda: cada funcion de escritura tiene que LANZAR; despues se pone el contador en cero para que cuente solo los intentos reales
      var todasBloquean = true;
      DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach(function (nombre) {
        try {
          global_[nombre]({}, {}, {}, {});
          todasBloquean = false;
        } catch (err) {
          if (String(err && err.message).indexOf('GUARDA_SIN_ESCRITURAS') !== 0) {
            todasBloquean = false;
          }
        }
      });
      estado.sondaBloqueada = todasBloquean;
      estado.intentos = 0;
      if (todasBloquean) {
        fn(estado);
      }
    }
  } finally {
    DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach(function (nombre) {
      if (Object.prototype.hasOwnProperty.call(originales, nombre)) {
        global_[nombre] = originales[nombre];
      }
    });
  }
  return estado;
}

// Sesiones de la prueba a partir de la hoja (sin escribirla): administradores efectivos, hasta 2 INTERNO no administradores y todos los EXTERNO activos.
function diagAdm_actores(tabla) {
  var indices = sheetUserRepository_indiceColumnas(tabla.header);
  var vistos = {};
  var r = { admins: [], internos: [], externos: [] };
  tabla.filas.forEach(function (row, i) {
    var email = indices.email >= 0 ? diagAdm_norm(row[indices.email]) : '';
    if (email === '' || vistos[email] === true || !usuariosDominio_emailValido(email)) {
      return;
    }
    vistos[email] = true;
    var activo = diagAdm_norm(sheetUserRepository_celda(row, indices, 'estado')) === 'activo';
    var tipo = usuariosDominio_normalizarTipo(sheetUserRepository_celda(row, indices, 'tipo'));
    var admin = sheetUserRepository_permisosDeFila(row, indices).usuarios_admin === true;
    var a = { fila: i + 2, email: email };
    if (activo && tipo === 'INTERNO' && admin) {
      r.admins.push(a);
    } else if (activo && tipo === 'INTERNO' && r.internos.length < 2) {
      r.internos.push(a);
    } else if (activo && tipo === 'EXTERNO') {
      r.externos.push(a);
    }
  });
  return r;
}

function diagAdm_codigo(r) {
  return r && r.status === 'ok' ? 'OK' : (r && r.code ? r.code : 'SIN_CODIGO');
}

// deps: { admin() -> texto de la propiedad, gestion() -> texto, tabla(), huellaHojas() -> texto, token(email), llamar(token, accion, resto) -> respuesta, reactivarSintetico(actor, sintetico) -> resultado del servicio,
//         sinEfectos(fn) -> {instalado}, sinEscrituras(fn) -> estado }
function diagAdm_correr(deps) {
  var salida = { version: DIAG_ADMFLAG_VERSION, soloLectura: true, abortado: null, flags: null, guardaSinEscrituras: null, hojasSinCambios: null, lecturas: null, gates: null, externosConGestionApagada: null, faltas: [], ok: false };
  var admin = deps.admin();
  var gestion = deps.gestion();
  salida.flags = { adminUsuarios: admin === 'SI' ? 'ENCENDIDO' : 'NO ENCENDIDO', gestionExternos: gestion === 'SI' ? 'ENCENDIDO' : 'APAGADO' };
  if (admin !== 'SI') {
    salida.abortado = 'E10_ADMIN_USUARIOS_ACTIVO no es SI: esta prueba solo corre con la administracion ENCENDIDA. No se llamo a ningun endpoint.';
    return salida;
  }
  if (gestion === 'SI') {
    salida.abortado = 'E10_GESTION_EXTERNOS_ACTIVO esta ENCENDIDO: esta prueba solo corre con la gestion de externos APAGADA. No se llamo a ningun endpoint.';
    return salida;
  }
  var tabla = deps.tabla();
  if (!tabla || tabla.existe !== true) {
    salida.abortado = 'HOJA_USUARIOS_INEXISTENTE';
    return salida;
  }
  var actores = diagAdm_actores(tabla);
  if (actores.admins.length === 0) {
    salida.abortado = 'NO_HAY_ADMINISTRADOR_EFECTIVO: no hay con quien probar';
    return salida;
  }
  var faltas = salida.faltas;
  function esperar(condicion, texto) {
    if (!condicion) {
      faltas.push(texto);
    }
  }

  var antes = deps.huellaHojas();
  var guarda = deps.sinEscrituras(function (estadoGuarda) {
    var efectos = deps.sinEfectos(function () {
      var admin1 = actores.admins[0];
      var tokenAdmin = deps.token(admin1.email);

      // --- LECTURAS ---
      var listado = deps.llamar(tokenAdmin, 'adminUsuariosListar', {});
      var lectura = { listado: null, catalogo: null, detalles: [] };
      if (listado.status !== 'ok') {
        faltas.push('adminUsuariosListar con administrador: esperado OK, obtenido ' + diagAdm_codigo(listado));
      } else {
        var us = listado.data.usuarios || [];
        var cuenta = { total: us.length, activos: us.filter(function (u) { return u.estado === 'activo'; }).length, interno: us.filter(function (u) { return u.tipo === 'INTERNO'; }).length, externo: us.filter(function (u) { return u.tipo === 'EXTERNO'; }).length, administradoresEfectivos: listado.data.administradoresEfectivos };
        Object.keys(cuenta).forEach(function (k) {
          esperar(cuenta[k] === DIAG_ADMFLAG_ESPERADO[k], 'listado: ' + k + ' esperado ' + DIAG_ADMFLAG_ESPERADO[k] + ', obtenido ' + cuenta[k]);
        });
        esperar(listado.data.total === us.length && listado.data.activos === cuenta.activos, 'listado: total/activos de la respuesta no coinciden con las filas');
        lectura.listado = {
          cantidades: cuenta,
          esperado: DIAG_ADMFLAG_ESPERADO,
          usuarios: us.map(function (u) {
            return { email: diagAdm_mascara(u.email), nombre: diagAdm_iniciales(u.nombre), estado: u.estado, tipo: u.tipo, cantidadPermisos: u.cantidadPermisos, admin: u.esAdmin === true, actualizadoUtc: u.actualizadoUtc, version: u.version };
          })
        };
      }

      var cat = deps.llamar(tokenAdmin, 'adminPermisosCatalogo', {});
      var cat2 = deps.llamar(tokenAdmin, 'adminPermisosCatalogo', {});
      if (cat.status !== 'ok') {
        faltas.push('adminPermisosCatalogo con administrador: esperado OK, obtenido ' + diagAdm_codigo(cat));
      } else {
        var ps = cat.data.permisos || [];
        var ids = ps.map(function (p) { return p.id; });
        var unicos = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
        var metadataCompleta = ps.every(function (p) { return DIAG_ADMFLAG_METADATA.every(function (c) { return Object.prototype.hasOwnProperty.call(p, c) && p[c] !== null && p[c] !== undefined; }); });
        var ordenado = ps.every(function (p, i) { return i === 0 || ps[i - 1].orden < p.orden; });
        var estable = cat2.status === 'ok' && JSON.stringify(cat2.data.permisos) === JSON.stringify(ps);
        var admPerm = ps.filter(function (p) { return p.id === 'usuarios_admin'; })[0];
        esperar(ps.length === DIAG_ADMFLAG_ESPERADO.permisos, 'catalogo: esperado ' + DIAG_ADMFLAG_ESPERADO.permisos + ' permisos, obtenido ' + ps.length);
        esperar(unicos.length === ids.length, 'catalogo: hay ids repetidos');
        esperar(metadataCompleta, 'catalogo: falta metadata en algun permiso');
        esperar(ordenado, 'catalogo: el orden no es estrictamente creciente');
        esperar(estable, 'catalogo: dos llamadas seguidas devuelven distinto orden o contenido');
        esperar(!!admPerm && admPerm.aplicableExterno === false && admPerm.aplicableInterno === true, 'catalogo: usuarios_admin tiene que ser aplicable a INTERNO y NO a EXTERNO');
        lectura.catalogo = { permisos: ps.length, idsUnicos: unicos.length === ids.length, metadataCompleta: metadataCompleta, ordenEstrictamenteCreciente: ordenado, estableEnDosLlamadas: estable, usuariosAdminNoAplicableAExterno: !!admPerm && admPerm.aplicableExterno === false, ids: ids };
      }

      var objetivos = actores.admins.map(function (a) { return { rol: 'ADMIN', a: a }; });
      if (actores.internos.length > 0) { objetivos.push({ rol: 'INTERNO_NO_ADMIN', a: actores.internos[0] }); }
      if (actores.externos.length > 0) { objetivos.push({ rol: 'EXTERNO', a: actores.externos[0] }); }
      esperar(actores.internos.length > 0, 'detalle: no hay un INTERNO no administrador para probar');
      esperar(actores.externos.length > 0, 'detalle: no hay un EXTERNO para probar');
      objetivos.forEach(function (o) {
        var d = deps.llamar(tokenAdmin, 'adminUsuarioObtener', { email: o.a.email });
        if (d.status !== 'ok') {
          faltas.push('adminUsuarioObtener ' + o.rol + ' fila ' + o.a.fila + ': esperado OK, obtenido ' + diagAdm_codigo(d));
          return;
        }
        var u = d.data.usuario || {};
        var ev = d.data.eventos || [];
        esperar(typeof u.version === 'number' && typeof u.etag === 'string' && u.etag.length > 0 && Array.isArray(u.permisos), 'detalle ' + o.rol + ' fila ' + o.a.fila + ': falta version, etag o permisos');
        esperar(u.email === o.a.email && JSON.stringify(d).indexOf('clientRequestId') < 0, 'detalle ' + o.rol + ' fila ' + o.a.fila + ': email distinto o expone clientRequestId');
        lectura.detalles.push({ rol: o.rol, fila: o.a.fila, email: diagAdm_mascara(u.email), tipo: u.tipo, estado: u.estado, version: u.version, etag: u.etag, permisos: u.permisos, cantidadPermisos: u.cantidadPermisos, esAdmin: u.esAdmin === true, eventosDisponibles: d.data.eventosDisponibles, hayMasEventos: d.data.hayMasEventos, cantidadEventos: ev.length, ultimosEventos: ev.slice(0, 3).map(function (e) { return { secuencia: e.secuencia, evento: e.evento, timestampUtc: e.timestampUtc, ejecutadoPor: /@/.test(String(e.ejecutadoPor)) ? diagAdm_mascara(e.ejecutadoPor) : e.ejecutadoPor, versionNueva: e.versionNueva, origen: e.origen }; }) });
      });
      salida.lecturas = lectura;

      // --- GATES (con el flag ON no se amplia el acceso de nadie) ---
      var gates = [];
      function fila(rol, a, token, esperado) {
        var r = { rol: rol, fila: a ? a.fila : null, email: a ? diagAdm_mascara(a.email) : '(token invalido)', respuestas: {} };
        DIAG_ADMFLAG_ACCIONES.forEach(function (accion) {
          var cuerpo = {};
          if (rol === 'ADMIN' && accion === 'adminUsuarioObtener') { cuerpo = { email: a.email }; }
          var codigo = diagAdm_codigo(deps.llamar(token, accion, cuerpo));
          r.respuestas[accion] = codigo;
          var esp = esperado(accion);
          if (codigo !== esp) {
            faltas.push(rol + (a ? ' fila ' + a.fila : '') + ' ' + accion + ': esperado ' + esp + ', obtenido ' + codigo);
          }
        });
        gates.push(r);
      }
      actores.admins.forEach(function (a) {
        fila('ADMIN', a, deps.token(a.email), function (accion) { return /Listar|Catalogo|Obtener/.test(accion) ? 'OK' : 'INVALID_REQUEST'; });
      });
      actores.internos.forEach(function (a) { fila('INTERNO_NO_ADMIN', a, deps.token(a.email), function () { return 'PERMISSION_DENIED'; }); });
      actores.externos.forEach(function (a) { fila('EXTERNO', a, deps.token(a.email), function () { return 'PERMISSION_DENIED'; }); });
      fila('TOKEN_INVALIDO', null, 'token-invalido', function () { return 'UNAUTHORIZED'; });
      esperar(actores.internos.length > 0, 'gates: no hay un INTERNO no administrador para probar');
      salida.gates = gates;

      // --- EXTERNOS con la gestion APAGADA ---
      var ext = { crearExterno: null, convertirInternoAExterno: null, reactivarExternoSintetico: null };
      var rCrear = deps.llamar(tokenAdmin, 'adminUsuarioCrear', { email: DIAG_ADMFLAG_EMAIL_SINTETICO, nombre: 'DIAGNOSTICO SINTETICO', tipo: 'EXTERNO', permisos: ['perfil'], clientRequestId: 'diag-adm-crear-externo' });
      ext.crearExterno = diagAdm_codigo(rCrear);
      esperar(ext.crearExterno === 'E10_GESTION_EXTERNOS_INACTIVA', 'crear EXTERNO: esperado E10_GESTION_EXTERNOS_INACTIVA, obtenido ' + ext.crearExterno);
      if (actores.internos.length > 0 && lectura.listado) {
        var objetivo = lectura.detalles.filter(function (d) { return d.rol === 'INTERNO_NO_ADMIN'; })[0];
        if (objetivo) {
          var emailObjetivo = actores.internos[0].email;
          var rConv = deps.llamar(tokenAdmin, 'adminUsuarioActualizar', { email: emailObjetivo, versionEsperada: objetivo.version, etag: objetivo.etag, tipo: 'EXTERNO', motivo: 'diagnostico sin escrituras', clientRequestId: 'diag-adm-convertir-externo' });
          ext.convertirInternoAExterno = diagAdm_codigo(rConv);
          esperar(ext.convertirInternoAExterno === 'E10_GESTION_EXTERNOS_INACTIVA', 'convertir INTERNO a EXTERNO: esperado E10_GESTION_EXTERNOS_INACTIVA, obtenido ' + ext.convertirInternoAExterno);
        } else {
          faltas.push('convertir INTERNO a EXTERNO: no se pudo leer el detalle del INTERNO');
        }
      }
      var rReact = deps.reactivarSintetico({ email: admin1.email, nombre: null }, DIAG_ADMFLAG_EMAIL_SINTETICO);
      ext.reactivarExternoSintetico = rReact && rReact.ok === true ? 'OK(!)' : (rReact && rReact.codigo ? rReact.codigo : 'SIN_CODIGO');
      esperar(ext.reactivarExternoSintetico === 'E10_GESTION_EXTERNOS_INACTIVA', 'reactivar EXTERNO (sintetico en memoria): esperado E10_GESTION_EXTERNOS_INACTIVA, obtenido ' + ext.reactivarExternoSintetico);
      salida.externosConGestionApagada = ext;
    });
    salida.historialYTelegramSuprimidos = efectos.contadores;
    if (!efectos.instalado) {
      faltas.push('EFECTOS_NO_SUPRIMIBLES: no se pudo reemplazar logHistoryEvent / telegramRepository_sendMessage');
    }
  });
  var despues = deps.huellaHojas();
  salida.guardaSinEscrituras = { instalada: guarda.instalada, sondaBloqueada: guarda.sondaBloqueada, funcionesBloqueadas: guarda.funciones.length, intentosDeEscrituraReales: guarda.intentos };
  salida.hojasSinCambios = { antes: antes, despues: despues, igual: antes === despues };
  if (!guarda.instalada || !guarda.sondaBloqueada) {
    salida.abortado = 'GUARDA_SIN_ESCRITURAS_NO_VERIFICADA: no se llamo a ningun endpoint';
    return salida;
  }
  esperar(guarda.intentos === 0, 'se INTENTO escribir ' + guarda.intentos + ' vez/veces (la guarda lo bloqueo)');
  esperar(antes === despues, 'las hojas Usuarios / UsuariosEventos CAMBIARON durante la prueba');
  salida.ok = faltas.length === 0;
  return salida;
}

function diagAdm_depsReales() {
  var global_ = typeof globalThis !== 'undefined' ? globalThis : this;
  return {
    admin: function () { return e10Flags_leerPropiedad(E10_PROP_ADMIN_USUARIOS); },
    gestion: function () { return e10Flags_leerPropiedad(E10_PROP_GESTION_EXTERNOS); },
    tabla: function () { return sheetUserRepository_leerTabla(); },
    huellaHojas: function () {
      var u = sheetUserRepository_leerTabla();
      var e;
      try {
        e = JSON.stringify(usuariosEventosRepository_leer(usuariosEventosRepository_abrir()));
      } catch (err) {
        e = 'SIN_HOJA_DE_EVENTOS';
      }
      return diagAdm_huella(JSON.stringify(u)) + '/' + diagAdm_huella(e);
    },
    token: function (email) { return createSessionToken(email); },
    llamar: function (token, accion, resto) {
      var cuerpo = { action: accion, sessionToken: token };
      Object.keys(resto || {}).forEach(function (k) { cuerpo[k] = resto[k]; });
      return JSON.parse(doPost({ postData: { contents: JSON.stringify(cuerpo) } }).getContent());
    },
    // Reactivar un EXTERNO inactivo: no hay ninguno real, asi que se AGREGA uno sintetico a la lectura de usuarios SOLO durante esta llamada (en memoria; la hoja no se toca) y se restaura siempre.
    reactivarSintetico: function (actor, email) {
      var original = global_.sheetUserRepository_leerUsuarios;
      var sintetico = { fila: 99999, email: email, nombre: 'DIAGNOSTICO SINTETICO', estado: 'inactivo', tipo: 'EXTERNO', version: 1, permisos: permisosCatalogo_aObjeto(['perfil']), fechaAlta: '', actualizadoUtc: '', actualizadoPor: '' };
      global_.sheetUserRepository_leerUsuarios = function (abierta) { return original(abierta).concat([sintetico]); };
      try {
        return usuariosAdmin_cambiarEstado(actor, { accion: 'REACTIVAR', email: email, versionEsperada: 1, etag: usuariosAdmin_vista(sintetico).etag, motivo: 'diagnostico sin escrituras', clientRequestId: 'diag-adm-reactivar-externo' });
      } finally {
        global_.sheetUserRepository_leerUsuarios = original;
      }
    },
    sinEfectos: diagPerm_sinEfectos,
    sinEscrituras: diagAdm_sinEscrituras
  };
}

function diagnosticoAdminFlagOnE10() {
  var informe;
  try {
    informe = diagAdm_correr(diagAdm_depsReales());
  } catch (err) {
    informe = { version: DIAG_ADMFLAG_VERSION, soloLectura: true, ok: false, abortado: 'DIAGNOSTICO_FALLO:' + String(err && err.name ? err.name : 'Error').slice(0, 40) };
  }
  Logger.log(JSON.stringify(informe));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIAG_ADMFLAG_VERSION,
    DIAG_ADMFLAG_ESPERADO,
    DIAG_ADMFLAG_ACCIONES,
    DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS,
    diagAdm_mascara,
    diagAdm_iniciales,
    diagAdm_huella,
    diagAdm_sinEscrituras,
    diagAdm_actores,
    diagAdm_correr,
    diagAdm_depsReales,
    diagnosticoAdminFlagOnE10
  };
}
