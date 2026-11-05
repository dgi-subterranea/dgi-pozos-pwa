// DiagnosticoBusquedaE10 (E10-1): herramienta MANUAL para medir, etapa por etapa y en el runtime REAL de Apps Script, lo que dispara el frontend publicado al BUSCAR UN POZO:
//   getItfAvailability + getWellRecord + getWellLocation + getMonitoringPoint (el frontend las manda en paralelo) y, aparte, la verificacion de existencia que registerWellSearch hace antes de
//   registrar. Sirve para ubicar CUAL etapa queda lenta o colgada con el codigo E10-1 (con v48 la busqueda anda, con v49 no).
//
//   diagnosticoBusquedaE10_ejecutar()      <- la que se corre desde el editor (el boton "Ejecutar" no permite parametros). Elige SOLA un usuario activo con los 4 permisos de busqueda y un pozo
//                                             del dataset del mapa. Para fijar uno, editar las constantes de abajo (DIAG_BUSQ_E10_WELLID / DIAG_BUSQ_E10_EMAIL) o usar la de abajo.
//   diagnosticoBusquedaE10(wellId, email)  <- misma logica con parametros (ambos opcionales; otra funcion del editor puede llamarla).
//
// QUE MIDE (cada etapa informa inicioMs desde el arranque, duracionMs, resultado OK | RESPUESTA_ERROR | ERROR | TIMEOUT_LOGICO, la FORMA del resultado y un error seguro):
//   usuario.*            eleccion del usuario / del pozo de prueba (lectura de la hoja Usuarios; lectura del dataset del mapa solo si no se fijo un pozo)
//   acceso.*             resolucion de permisos pieza por pieza: lectura del cache v2, lectura del tombstone, lectura de la hoja Usuarios (getUserStatus), acceso efectivo, getUserAccess real (1 y 4 veces)
//   sesion.*             firmar y verificar un token (en memoria; el token NO se imprime)
//   lectura.*            los 4 handlers REALES por doPost (el mismo camino del Web App: sesion -> permisos -> servicio -> respuesta), uno por uno
//   existencia.*         pozoExistenciaService_verificar (lo que registerWellSearch exige antes de escribir) y la lectura del padron que la alimenta
// TIMEOUT_LOGICO: la etapa termino pero tardo mas de DIAG_BUSQ_E10_UMBRAL_LENTO_MS (no hay forma de interrumpir una llamada en Apps Script; una etapa colgada de verdad es la que NUNCA llega al
// registro: si la ejecucion se corta, el ultimo "[diagBusqE10] inicio <etapa>" del registro dice cual era).
//
// EFECTOS: no escribe hojas, no manda Telegram, no escribe Busquedas, no toca Script Properties, no crea triggers ni locks. Los 4 handlers escriben en Historial por diseno: durante la corrida se
// REEMPLAZAN logHistoryEvent y telegramRepository_sendMessage por funciones que solo cuentan (se restauran SIEMPRE, tambien ante una excepcion) y se verifica que el reemplazo quedo instalado ANTES
// de llamar al primer handler; si no queda instalado, no se llama a ninguno. Unico efecto posible: los mismos que tiene el uso normal en el cache (la entrada user_access_v2_<email> que escribe
// getUserAccess en un fallo de cache, y los positivos de existencia de pozoExistenciaService, ~10 min). NO usa ningun secreto y NO imprime tokens, ids de Drive, contenido ni el email completo.
var DIAG_BUSQ_E10_VERSION = 1;
var DIAG_BUSQ_E10_UMBRAL_LENTO_MS = 5000;
var DIAG_BUSQ_E10_WELLID = '';
var DIAG_BUSQ_E10_EMAIL = '';
var DIAG_BUSQ_E10_MODULOS = ['perfil', 'datos', 'ubicacion', 'ne'];
var DIAG_BUSQ_E10_FUNCIONES_SIN_EFECTOS = ['logHistoryEvent', 'telegramRepository_sendMessage'];

function diagBusqE10_mascara(email) {
  var t = String(email || '').trim();
  var arroba = t.indexOf('@');
  if (arroba < 1) {
    return '***';
  }
  return t.charAt(0) + '***' + t.substring(arroba);
}

function diagBusqE10_errorSeguro(err) {
  var nombre = err && err.name ? String(err.name).substring(0, 40) : 'Error';
  var mensaje = err && err.message !== undefined ? String(err.message) : String(err);
  mensaje = mensaje.replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9+\/=_-]{24,}/g, '[...]').substring(0, 160);
  return { tipo: nombre, mensaje: mensaje };
}

// Forma aproximada del resultado, sin su contenido: tipo, tamano en bytes del JSON y, si es una respuesta de la API, status / code.
function diagBusqE10_forma(valor) {
  var forma = {};
  if (valor === null || valor === undefined) {
    return { tipo: String(valor) };
  }
  if (Array.isArray(valor)) {
    forma.tipo = 'lista';
    forma.elementos = valor.length;
  } else if (typeof valor === 'object') {
    forma.tipo = 'objeto';
    forma.claves = Object.keys(valor).length;
    if (typeof valor.status === 'string') {
      forma.status = valor.status;
    }
    if (typeof valor.code === 'string') {
      forma.code = valor.code.substring(0, 40);
    }
  } else {
    forma.tipo = typeof valor;
  }
  try {
    forma.bytes = JSON.stringify(valor).length;
  } catch (err) {
    forma.bytes = -1;
  }
  return forma;
}

// Corre UNA etapa: la registra (inicio / duracion / resultado / forma / error) y devuelve {ok, valor}. Nunca lanza. Escribe "inicio" en el Logger ANTES de correrla: si la ejecucion se corta, ese es
// el ultimo renglon del registro.
function diagBusqE10_etapa(ctx, nombre, fn) {
  var inicio = Date.now();
  var etapa = { etapa: nombre, inicioMs: inicio - ctx.t0, duracionMs: 0, resultado: 'OK', forma: null };
  try {
    Logger.log('[diagBusqE10] inicio ' + nombre);
  } catch (e) {
    // el registro nunca condiciona la medicion
  }
  var valor;
  var ok = true;
  try {
    valor = fn();
    etapa.forma = diagBusqE10_forma(valor);
    if (valor !== null && typeof valor === 'object' && valor.status === 'error') {
      etapa.resultado = 'RESPUESTA_ERROR';
    }
  } catch (err) {
    ok = false;
    etapa.resultado = 'ERROR';
    etapa.error = diagBusqE10_errorSeguro(err);
  }
  etapa.duracionMs = Date.now() - inicio;
  if (etapa.resultado === 'OK' && etapa.duracionMs > ctx.umbral) {
    etapa.resultado = 'TIMEOUT_LOGICO';
  }
  ctx.etapas.push(etapa);
  return { ok: ok, valor: valor };
}

// Reemplaza las funciones con efectos por contadores, verifica que el reemplazo quedo instalado y SIEMPRE las restaura. Devuelve {instalado, contadores}.
function diagBusqE10_sinEfectos(fn) {
  var global_ = typeof globalThis !== 'undefined' ? globalThis : this;
  var originales = {};
  var contadores = {};
  var instalado = true;
  DIAG_BUSQ_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) {
    contadores[nombre] = 0;
  });
  try {
    DIAG_BUSQ_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) {
      originales[nombre] = global_[nombre];
      var cuenta = function () {
        contadores[nombre] = contadores[nombre] + 1;
        return nombre === 'telegramRepository_sendMessage' ? { ok: true } : undefined;
      };
      global_[nombre] = cuenta;
      if (global_[nombre] !== cuenta) {
        instalado = false;
      }
    });
    if (instalado) {
      fn();
    }
  } finally {
    DIAG_BUSQ_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) {
      if (Object.prototype.hasOwnProperty.call(originales, nombre)) {
        global_[nombre] = originales[nombre];
      }
    });
  }
  return { instalado: instalado, contadores: contadores };
}

function diagBusqE10_llamar(ctx, accion, resto) {
  var cuerpo = { action: accion, sessionToken: ctx.token };
  Object.keys(resto || {}).forEach(function (k) { cuerpo[k] = resto[k]; });
  var salida = doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(salida.getContent());
}

function diagBusqE10_correr(wellIdParam, emailParam) {
  var ctx = { t0: Date.now(), umbral: DIAG_BUSQ_E10_UMBRAL_LENTO_MS, etapas: [], token: null };
  var wellId = String(wellIdParam || DIAG_BUSQ_E10_WELLID || '').trim();
  var email = String(emailParam || DIAG_BUSQ_E10_EMAIL || '').trim().toLowerCase();
  var nota = [];

  // --- usuario / pozo de prueba ---
  if (!email) {
    var elegido = diagBusqE10_etapa(ctx, 'usuario.elegir_con_4_permisos_de_busqueda', function () {
      return sheetUserRepository_listarConPermisos(DIAG_BUSQ_E10_MODULOS);
    });
    if (elegido.ok && Array.isArray(elegido.valor) && elegido.valor.length > 0) {
      email = String(elegido.valor[0].email || '').trim().toLowerCase();
    }
  }
  if (!wellId) {
    var pozos = diagBusqE10_etapa(ctx, 'usuario.elegir_pozo_del_dataset_del_mapa', function () {
      var r = mapaService_getPozos();
      var lista = r && Array.isArray(r.pozos) ? r.pozos : [];
      return { found: !!(r && r.found), pozos: lista.length, primero: lista.length > 0 ? String(lista[0].wellId || '') : '' };
    });
    if (pozos.ok && pozos.valor && pozos.valor.primero) {
      wellId = pozos.valor.primero;
    }
  }
  if (!email || !wellId) {
    nota.push('SIN_DATOS_DE_PRUEBA: ' + (!email ? 'no se encontro un usuario activo con perfil, datos, ubicacion y ne; ' : '') + (!wellId ? 'no se pudo elegir un pozo (fijar DIAG_BUSQ_E10_WELLID)' : ''));
    return diagBusqE10_informe(ctx, email, wellId, null, nota);
  }

  // --- resolucion de permisos, pieza por pieza ---
  var clave = USER_ACCESS_CACHE_PREFIJO + email;
  var claveTombstone = USER_ACCESS_TOMBSTONE_PREFIJO + email;
  diagBusqE10_etapa(ctx, 'acceso.cache_v2_lectura', function () {
    var v = CacheService.getScriptCache().get(clave);
    return { acierto: v !== null && v !== undefined, bytes: v ? String(v).length : 0 };
  });
  diagBusqE10_etapa(ctx, 'acceso.tombstone_lectura', function () {
    var v = CacheService.getScriptCache().get(claveTombstone);
    return { presente: v !== null && v !== undefined };
  });
  var estado = diagBusqE10_etapa(ctx, 'acceso.hoja_usuarios_getUserStatus', function () {
    var s = sheetUserRepository_getUserStatus(email);
    return { found: s.found === true, active: s.active === true, permisosEnSI: Object.keys(s.permisos || {}).filter(function (k) { return s.permisos[k] === true; }).length, tipo: s.tipo || '' };
  });
  diagBusqE10_etapa(ctx, 'acceso.efectivo_usuariosDominio', function () {
    var s = sheetUserRepository_getUserStatus(email);
    var a = usuariosDominio_accesoEfectivo(s);
    return { active: a.active, permisosEfectivosEnSI: Object.keys(a.permisos || {}).filter(function (k) { return a.permisos[k] === true; }).length, tipo: a.tipo };
  });
  diagBusqE10_etapa(ctx, 'acceso.getUserAccess_x1', function () {
    var a = getUserAccess(email);
    return { active: a.active === true, permisos: Object.keys(a.permisos || {}).length };
  });
  diagBusqE10_etapa(ctx, 'acceso.getUserAccess_x4_como_las_4_lecturas', function () {
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (getUserAccess(email).active === true) {
        n++;
      }
    }
    return { activas: n };
  });
  if (!(estado.ok && estado.valor && estado.valor.active === true)) {
    nota.push('USUARIO_NO_ACTIVO: no se llaman los handlers');
    return diagBusqE10_informe(ctx, email, wellId, null, nota);
  }

  // --- sesion ---
  diagBusqE10_etapa(ctx, 'sesion.firmar_y_verificar_token', function () {
    ctx.token = createSessionToken(email);
    var v = verifySessionToken(ctx.token);
    return { valido: v.valid === true };
  });

  // --- los 4 handlers reales, con los efectos apagados ---
  var sinEfectos = diagBusqE10_sinEfectos(function () {
    diagBusqE10_etapa(ctx, 'lectura.getItfAvailability', function () { return diagBusqE10_llamar(ctx, 'getItfAvailability', { wellIds: [wellId] }); });
    diagBusqE10_etapa(ctx, 'lectura.getWellRecord', function () { return diagBusqE10_llamar(ctx, 'getWellRecord', { wellId: wellId }); });
    diagBusqE10_etapa(ctx, 'lectura.getWellLocation', function () { return diagBusqE10_llamar(ctx, 'getWellLocation', { wellId: wellId }); });
    diagBusqE10_etapa(ctx, 'lectura.getMonitoringPoint', function () { return diagBusqE10_llamar(ctx, 'getMonitoringPoint', { monitoringId: wellId }); });
  });
  if (!sinEfectos.instalado) {
    nota.push('EFECTOS_NO_SUPRIMIBLES: no se pudieron reemplazar logHistoryEvent / telegramRepository_sendMessage; NO se llamo a ningun handler');
  }

  // --- existencia (lo que registerWellSearch exige antes de registrar; NO se llama a registerWellSearch) ---
  diagBusqE10_etapa(ctx, 'existencia.padron_ubicacion', function () {
    var r = registryService_getWellLocation(wellId);
    return { found: !!(r && r.found) };
  });
  diagBusqE10_etapa(ctx, 'existencia.pozoExistenciaService_verificar', function () {
    var r = pozoExistenciaService_verificar(wellId);
    return { existe: !!(r && r.existe), enPadron: !!(r && r.enPadron), indeterminado: !!(r && r.indeterminado), fuentes: r && Array.isArray(r.fuentes) ? r.fuentes.length : 0 };
  });

  return diagBusqE10_informe(ctx, email, wellId, sinEfectos, nota);
}

function diagBusqE10_informe(ctx, email, wellId, sinEfectos, nota) {
  var lentas = [];
  var errores = [];
  var respuestasError = [];
  ctx.etapas.forEach(function (e) {
    if (e.resultado === 'TIMEOUT_LOGICO') { lentas.push(e.etapa); }
    if (e.resultado === 'ERROR') { errores.push(e.etapa); }
    if (e.resultado === 'RESPUESTA_ERROR') { respuestasError.push(e.etapa); }
  });
  return {
    diagnostico: 'busqueda-E10',
    version: DIAG_BUSQ_E10_VERSION,
    soloLectura: true,
    usuario: diagBusqE10_mascara(email),
    wellId: wellId || null,
    umbralLentoMs: ctx.umbral,
    etapas: ctx.etapas,
    totalMs: Date.now() - ctx.t0,
    lentas: lentas,
    errores: errores,
    respuestasConError: respuestasError,
    efectosSuprimidos: sinEfectos ? sinEfectos.contadores : null,
    notas: nota
  };
}

function diagnosticoBusquedaE10(wellId, email) {
  var informe;
  try {
    informe = diagBusqE10_correr(wellId, email);
  } catch (err) {
    informe = { diagnostico: 'busqueda-E10', version: DIAG_BUSQ_E10_VERSION, soloLectura: true, error: diagBusqE10_errorSeguro(err) };
  }
  Logger.log(JSON.stringify(informe));
  return informe;
}

function diagnosticoBusquedaE10_ejecutar() {
  return diagnosticoBusquedaE10('', '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    diagnosticoBusquedaE10,
    diagnosticoBusquedaE10_ejecutar,
    diagBusqE10_correr,
    diagBusqE10_etapa,
    diagBusqE10_sinEfectos,
    diagBusqE10_forma,
    diagBusqE10_mascara,
    diagBusqE10_errorSeguro,
    DIAG_BUSQ_E10_FUNCIONES_SIN_EFECTOS,
    DIAG_BUSQ_E10_UMBRAL_LENTO_MS
  };
}
