// UsuariosEventosRepository (E10-1): unica pieza que sabe que existe la hoja "UsuariosEventos" (mismo spreadsheet que Usuarios/Historial). APPEND-ONLY: la auditoria administrativa de usuarios y
// permisos. NO es el Historial de pozos (que representa hechos funcionales): una hoja propia, sin secretos (ni tokens, ni idToken, ni contrasenas: no existen en este sistema).
//
// Esquema FIJO (19 columnas, buscadas por el TEXTO del encabezado, trim/minuscula insensible; si falta o se repite cualquiera se lanza error: fail-closed, nunca se escribe en una hoja con un esquema
// que no se reconoce y NUNCA se crea sola: la crea setupUsuariosEventosSheet a mano):
//   eventoId          UUID
//   secuencia         entero creciente (max + 1), calculado BAJO EL LOCK del servicio que escribe
//   evento            USUARIO_CREADO | USUARIO_ACTUALIZADO | USUARIO_DESACTIVADO | USUARIO_REACTIVADO | USUARIO_MIGRADO | USUARIO_MIGRACION_REVERTIDA
//   usuarioObjetivo   email (normalizado) del usuario afectado
//   nombreObjetivo    nombre del usuario DESPUES del evento
//   nombreAnterior    nombre ANTES (campo tecnico adicional, justificado: sin el, un cambio de solo el nombre no dejaria el valor previo en la auditoria)
//   ejecutadoPor      email del administrador (SIEMPRE de la sesion, nunca del cuerpo) o 'migracion:E10-1'
//   timestampUtc      ISO-8601 UTC
//   tipoAnterior / tipoNuevo, estadoAnterior / estadoNuevo, versionAnterior / versionNueva
//   permisosAntes / permisosDespues   lista de ids en SI, separada por comas, en el orden del catalogo
//   motivo            texto corto opcional
//   clientRequestId   idempotencia (un reintento del mismo pedido no duplica el cambio)
//   origen            APP | MIGRACION
// Texto plano ('@') salvo las numericas: un motivo que empiece con "=" nunca se evalua como formula.
//
// Concurrencia: este archivo NO toma lock; UsuariosAdminService lo llama dentro del script lock (el que serializa leer -> validar -> escribir Usuarios -> escribir el evento).
var USUARIOS_EVENTOS_HOJA = 'UsuariosEventos';
var USUARIOS_EVENTOS_COLUMNAS = [
  'eventoId', 'secuencia', 'evento', 'usuarioObjetivo', 'nombreObjetivo', 'nombreAnterior', 'ejecutadoPor', 'timestampUtc', 'tipoAnterior', 'tipoNuevo', 'estadoAnterior', 'estadoNuevo',
  'versionAnterior', 'versionNueva', 'permisosAntes', 'permisosDespues', 'motivo', 'clientRequestId', 'origen'
];
var USUARIOS_EVENTOS_NUMERICAS = { secuencia: '0', versionAnterior: '0', versionNueva: '0' };
var USUARIOS_EVENTOS_NOMBRES = ['USUARIO_CREADO', 'USUARIO_ACTUALIZADO', 'USUARIO_DESACTIVADO', 'USUARIO_REACTIVADO', 'USUARIO_MIGRADO', 'USUARIO_MIGRACION_REVERTIDA'];
var USUARIOS_EVENTOS_ORIGENES = ['APP', 'MIGRACION'];

// --- logica pura ---

function usuariosEventosRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  USUARIOS_EVENTOS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes:[...], repetidas:[...]}. Una columna repetida tambien es un esquema inesperado (no se sabria cual escribir).
function usuariosEventosRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = usuariosEventosRepository_indiceColumnas(header);
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var faltantes = USUARIOS_EVENTOS_COLUMNAS.filter(function (n) { return indices[n] < 0; });
  var repetidas = USUARIOS_EVENTOS_COLUMNAS.filter(function (n) {
    return indices[n] >= 0 && normalizados.indexOf(n.toLowerCase()) !== normalizados.lastIndexOf(n.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function usuariosEventosRepository_texto(v) {
  return v === null || v === undefined ? '' : String(v);
}

// Valida un evento ANTES de escribirlo: {ok:true} o {ok:false, motivo}. La auditoria no acepta eventos incompletos.
function usuariosEventosRepository_validarEvento(e) {
  if (!e || typeof e !== 'object') {
    return { ok: false, motivo: 'evento no es un objeto' };
  }
  if (USUARIOS_EVENTOS_NOMBRES.indexOf(e.evento) < 0) {
    return { ok: false, motivo: 'evento desconocido' };
  }
  if (USUARIOS_EVENTOS_ORIGENES.indexOf(e.origen) < 0) {
    return { ok: false, motivo: 'origen invalido' };
  }
  if (!usuariosEventosRepository_texto(e.usuarioObjetivo).trim() || !usuariosEventosRepository_texto(e.ejecutadoPor).trim()) {
    return { ok: false, motivo: 'faltan usuarioObjetivo o ejecutadoPor' };
  }
  return { ok: true };
}

// Fila (arreglo en el orden del esquema) de un evento ya completo (eventoId, secuencia, timestampUtc).
function usuariosEventosRepository_aFila(e, indices, ancho) {
  var fila = new Array(ancho).fill('');
  USUARIOS_EVENTOS_COLUMNAS.forEach(function (c) {
    var v = e[c];
    fila[indices[c]] = USUARIOS_EVENTOS_NUMERICAS[c] !== undefined ? (typeof v === 'number' ? v : 0) : usuariosEventosRepository_texto(v);
  });
  return fila;
}

// --- hoja ---

// Abre la hoja y exige el esquema; si no existe o no coincide, lanza AUDITORIA_NO_DISPONIBLE (nunca la crea).
function usuariosEventosRepository_abrir() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_EVENTOS_HOJA);
  if (!sheet) {
    throw new Error('AUDITORIA_NO_DISPONIBLE: no existe la hoja ' + USUARIOS_EVENTOS_HOJA + ' (correr setupUsuariosEventosSheet)');
  }
  var ancho = sheet.getLastColumn();
  if (ancho < 1) {
    throw new Error('AUDITORIA_NO_DISPONIBLE: la hoja ' + USUARIOS_EVENTOS_HOJA + ' no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, ancho).getValues()[0];
  var plan = usuariosEventosRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('AUDITORIA_NO_DISPONIBLE: la hoja ' + USUARIOS_EVENTOS_HOJA + ' no tiene el esquema esperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: usuariosEventosRepository_indiceColumnas(header), ancho: ancho };
}

// Todos los eventos (fresco), como objetos. Una fila que no se puede leer se ignora.
function usuariosEventosRepository_leer(abierta) {
  var h = abierta || usuariosEventosRepository_abrir();
  var data = h.sheet.getDataRange().getValues();
  var eventos = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!Array.isArray(row)) {
      continue;
    }
    var e = { fila: i + 1 };
    USUARIOS_EVENTOS_COLUMNAS.forEach(function (c) {
      var v = row[h.indices[c]];
      e[c] = USUARIOS_EVENTOS_NUMERICAS[c] !== undefined ? (isFinite(parseInt(v, 10)) ? parseInt(v, 10) : 0) : usuariosEventosRepository_texto(v);
    });
    eventos.push(e);
  }
  return eventos;
}

function usuariosEventosRepository_ultimaSecuencia(eventos) {
  return (eventos || []).reduce(function (m, e) { return Math.max(m, e.secuencia || 0); }, 0);
}

// El ultimo evento de un usuario con ese clientRequestId (para responder idempotente a un reintento), o null.
function usuariosEventosRepository_buscarPorClientRequestId(eventos, email, clientRequestId) {
  if (!clientRequestId) {
    return null;
  }
  var coincidencias = (eventos || []).filter(function (e) { return e.usuarioObjetivo === email && e.clientRequestId === clientRequestId; });
  return coincidencias.length > 0 ? coincidencias[coincidencias.length - 1] : null;
}

// Agrega TODOS los eventos en UNA sola escritura (nunca queda un grupo a medias). `eventos`: [{evento, usuarioObjetivo, ... , origen}] sin eventoId/secuencia/timestampUtc: se asignan aca.
// `ultimaSecuencia`: la que leyo el llamador bajo lock. Devuelve los eventos completos que se escribieron. Lanza si algun evento es invalido (antes de escribir nada).
function usuariosEventosRepository_agregar(abierta, eventos, ultimaSecuencia, ejecutadoPor) {
  var instante = new Date().toISOString();
  var completos = eventos.map(function (e, i) {
    var c = {};
    Object.keys(e).forEach(function (k) { c[k] = e[k]; });
    c.eventoId = Utilities.getUuid();
    c.secuencia = ultimaSecuencia + i + 1;
    c.timestampUtc = instante;
    c.ejecutadoPor = c.ejecutadoPor || ejecutadoPor;
    return c;
  });
  completos.forEach(function (c) {
    var v = usuariosEventosRepository_validarEvento(c);
    if (!v.ok) {
      throw new Error('AUDITORIA_EVENTO_INVALIDO: ' + v.motivo);
    }
  });
  var h = abierta;
  var primeraFila = h.sheet.getLastRow() + 1;
  var filas = completos.map(function (c) { return usuariosEventosRepository_aFila(c, h.indices, h.ancho); });
  var formatos = filas.map(function () {
    var f = new Array(h.ancho).fill('@');
    Object.keys(USUARIOS_EVENTOS_NUMERICAS).forEach(function (col) { f[h.indices[col]] = USUARIOS_EVENTOS_NUMERICAS[col]; });
    return f;
  });
  var rango = h.sheet.getRange(primeraFila, 1, filas.length, h.ancho);
  rango.setNumberFormats(formatos);
  rango.setValues(filas);
  return completos;
}

// --- setup MANUAL (idempotente): no se ejecuta en ningun despliegue ---

// Crea la hoja con el esquema si NO existe. Si existe: vacia -> no se toca y se avisa; con esquema correcto -> no se toca; con esquema inesperado -> lanza (no se modifica nada).
function setupUsuariosEventosSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(USUARIOS_EVENTOS_HOJA);
  if (existente) {
    var ancho = existente.getLastColumn();
    if (ancho < 1) {
      throw new Error('La hoja ' + USUARIOS_EVENTOS_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = usuariosEventosRepository_planEsquema(existente.getRange(1, 1, 1, ancho).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + USUARIOS_EVENTOS_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + USUARIOS_EVENTOS_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return { creada: false, motivo: 'YA_EXISTE' };
  }
  var sheet = spreadsheet.insertSheet(USUARIOS_EVENTOS_HOJA);
  sheet.getRange(1, 1, 1, USUARIOS_EVENTOS_COLUMNAS.length).setValues([USUARIOS_EVENTOS_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + USUARIOS_EVENTOS_HOJA + ' creada.');
  return { creada: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_EVENTOS_HOJA,
    USUARIOS_EVENTOS_COLUMNAS,
    USUARIOS_EVENTOS_NOMBRES,
    USUARIOS_EVENTOS_ORIGENES,
    usuariosEventosRepository_indiceColumnas,
    usuariosEventosRepository_planEsquema,
    usuariosEventosRepository_validarEvento,
    usuariosEventosRepository_abrir,
    usuariosEventosRepository_leer,
    usuariosEventosRepository_ultimaSecuencia,
    usuariosEventosRepository_buscarPorClientRequestId,
    usuariosEventosRepository_agregar,
    setupUsuariosEventosSheet
  };
}
