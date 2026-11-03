// Unica funcion/archivo que sabe que existira la hoja "PropuestaNotificaciones" en Sheets (mismo spreadsheet que Usuarios/Historial/ItfEventos): el OUTBOX (cola persistente) de los avisos por email de
// "hay una propuesta pendiente de validacion" (PropuestaNotificacion.js). Una fila = UNA notificacion logica = UNA propuesta. La identidad es (tipo + propuestaId): nunca hay dos filas para la misma.
//
// POR QUE EXISTE: el email se manda DESPUES de confirmar la propuesta (que no se deshace nunca por un fallo de email). Si el proceso muriera entre las dos cosas, o MailApp fallara, el aviso NO puede
// perderse: queda en esta hoja como PENDIENTE / ERROR y se reintenta (en la proxima accion idempotente del proponente o con procesarNotificacionesPropuestasPendientes). La garantia de "un solo aviso" es ESTA hoja
// (persistente, bajo lock), no CacheService.
//
// ESTADO DE ESTA ETAPA: la hoja NO existe en produccion. setupPropuestaNotificacionesSheet esta escrita y probada pero NO se ejecuta hasta que el usuario lo decida. Una lectura o una escritura nunca crea la hoja:
// sin ella el aviso no se guarda ni se envia (la propuesta sigue valida) y el log lo dice.
//
// Esquema (15 columnas, en este orden; el orden REAL de la hoja puede variar: se buscan por el texto del encabezado):
//   notificacionId | tipo | propuestaId | wellId | permisosValidador | proponenteNombre | proponenteEmail | propuestaTimestampUtc | estado | intentos | creadoUtc | ultimoIntentoUtc | enviadoUtc | ultimoError | destinatariosEnviados
//   - Identidad
//       notificacionId        UUID v4 de la fila (lo genera el servidor).
//       tipo + propuestaId    la identidad LOGICA (tipo de PROPUESTA_TIPOS y el id de la propuesta; para ITF su documentoId). Una sola fila por par.
//       wellId                el pozo (NN-NNNN) que sale en el asunto.
//   - Lo necesario para poder (re)enviar sin el request original
//       permisosValidador     los permisos que debe tener QUIEN VALIDA, separados por coma (todos en SI), tal como se pidieron al registrar. Si no son validos el aviso no sale (fail-closed).
//       proponenteNombre      el «Propuesta por» del email.
//       proponenteEmail       SOLO para excluir al proponente en los tipos que lo piden; nunca sale en un email.
//       propuestaTimestampUtc fecha de creacion de la propuesta (ISO): la «Fecha y hora» del email.
//   - Estado
//       estado                PENDIENTE (todavia no se intento) | ENVIADA (todos los validadores actuales recibieron el aviso) | ERROR (el ultimo intento fallo o fue parcial; reintentable) |
//                             OMITIDA (ya no corresponde avisar: la propuesta dejo de estar pendiente o los datos de la fila no son validos).
//       intentos              cuantas veces se intento (entero >= 0); con PROPUESTA_NOTIF_MAX_INTENTOS no se reintenta mas.
//       creadoUtc / ultimoIntentoUtc / enviadoUtc   ISO UTC con milisegundos y Z, como TEXTO. El ultimo intento tambien sirve de "reserva" (lease): nadie reintenta una fila mientras otro intento esta en curso.
//       ultimoError           texto CORTO y seguro (codigos como PARCIAL (1 de 2 enviados), SIN_DESTINATARIOS...), sin direcciones de email y sin datos tecnicos. Vacio si se envio.
//       destinatariosEnviados emails (normalizados, separados por «;») que YA recibieron el aviso: un reintento parcial solo manda a los que faltan, asi nadie lo recibe dos veces.
//   Lo que NO se guarda a proposito: el cuerpo del email, secretos, hashes, storageFileId, clientRequestId, imagen ni el documentoId de un tipo que no sea la propuesta misma.
//
// Las columnas se buscan por el TEXTO del encabezado (trim / minuscula): reordenarlas a mano no rompe nada y una columna extra que alguien agregue se respeta (no se pisa). Si falta CUALQUIERA de las 15
// (o hay una repetida) se lanza error (fail-closed). Todas las columnas de texto se escriben como TEXTO PLANO ('@'): nada se evalua como formula. `intentos` va con formato '0'.
//
// Concurrencia: crear una fila y reservar un intento se hacen bajo el lock de script (propuestaNotificacionesRepository_conLock): dos ejecuciones simultaneas nunca crean dos filas ni envian a la vez.
var PROPUESTA_NOTIF_HOJA = 'PropuestaNotificaciones';
var PROPUESTA_NOTIF_COLUMNAS = [
  'notificacionId', 'tipo', 'propuestaId', 'wellId', 'permisosValidador', 'proponenteNombre', 'proponenteEmail', 'propuestaTimestampUtc',
  'estado', 'intentos', 'creadoUtc', 'ultimoIntentoUtc', 'enviadoUtc', 'ultimoError', 'destinatariosEnviados'
];
var PROPUESTA_NOTIF_FORMATOS_NUMERICOS = { intentos: '0' };
var PROPUESTA_NOTIF_ESTADOS = { PENDIENTE: 'PENDIENTE', ENVIADA: 'ENVIADA', ERROR: 'ERROR', OMITIDA: 'OMITIDA' };
var PROPUESTA_NOTIF_MAX_INTENTOS = 5;
var PROPUESTA_NOTIF_LEASE_MS = 300000;          // 5 min: mientras un intento esta en curso nadie mas reintenta esa fila
var PROPUESTA_NOTIF_LOCK_TIMEOUT_MS = 10000;
var PROPUESTA_NOTIF_ULTIMO_ERROR_MAX = 160;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function propuestaNotificacionesRepository_indiceColumnas(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  PROPUESTA_NOTIF_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

// {ok:true} o {ok:false, faltantes, repetidas}. Una columna repetida tambien es un esquema inesperado (no se sabria cual leer).
function propuestaNotificacionesRepository_planEsquema(headerRow) {
  var header = headerRow || [];
  var indices = propuestaNotificacionesRepository_indiceColumnas(header);
  var faltantes = PROPUESTA_NOTIF_COLUMNAS.filter(function (nombre) { return indices[nombre] < 0; });
  var normalizados = header.map(function (h) { return String(h).trim().toLowerCase(); });
  var repetidas = PROPUESTA_NOTIF_COLUMNAS.filter(function (nombre) {
    return normalizados.indexOf(nombre.toLowerCase()) !== normalizados.lastIndexOf(nombre.toLowerCase());
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

function propuestaNotificacionesRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

function propuestaNotificacionesRepository_texto(row, indices, nombre) {
  var v = row[indices[nombre]];
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();      // si Sheets convirtio un timestamp en fecha, se lee igual (ISO)
  }
  return propuestaNotificacionesRepository_esVacio(v) ? '' : String(v).trim();
}

// Fila -> objeto. `fila` es el numero de fila de la hoja (solo para diagnostico). intentos: entero >= 0; cualquier otra cosa se lee como el maximo (fail-closed: una fila rota no se reintenta sin fin).
function propuestaNotificacionesRepository_objetoDesdeFila(row, indices, numeroFila) {
  function t(n) { return propuestaNotificacionesRepository_texto(row, indices, n); }
  var crudo = t('intentos');
  var intentos = /^\d+$/.test(crudo) ? Number(crudo) : (crudo === '' ? 0 : PROPUESTA_NOTIF_MAX_INTENTOS);
  return {
    fila: numeroFila,
    notificacionId: t('notificacionId').toLowerCase(),
    tipo: t('tipo'),
    propuestaId: t('propuestaId'),
    wellId: t('wellId'),
    permisosValidador: t('permisosValidador'),
    proponenteNombre: t('proponenteNombre'),
    proponenteEmail: t('proponenteEmail').toLowerCase(),
    propuestaTimestampUtc: t('propuestaTimestampUtc'),
    estado: t('estado'),
    intentos: intentos,
    creadoUtc: t('creadoUtc'),
    ultimoIntentoUtc: t('ultimoIntentoUtc'),
    enviadoUtc: t('enviadoUtc'),
    ultimoError: t('ultimoError'),
    destinatariosEnviados: t('destinatariosEnviados')
  };
}

function propuestaNotificacionesRepository_filaVacia(row) {
  return (row || []).every(function (v) { return propuestaNotificacionesRepository_esVacio(v) || String(v).trim() === ''; });
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function propuestaNotificacionesRepository_filaDesdeObjeto(objeto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  PROPUESTA_NOTIF_COLUMNAS.forEach(function (nombre) {
    var valor = objeto[nombre];
    fila[indices[nombre]] = propuestaNotificacionesRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

// Formato de cada celda de la fila: TEXTO PLANO ('@') en todas (tambien en las columnas desconocidas) salvo `intentos` ('0').
function propuestaNotificacionesRepository_formatosDeFila(indices, ancho) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  PROPUESTA_NOTIF_COLUMNAS.forEach(function (nombre) {
    if (PROPUESTA_NOTIF_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = PROPUESTA_NOTIF_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// La fila de una propuesta: la PRIMERA con ese (tipo, propuestaId). Si la hoja tuviera repetidas (edicion manual) todos usan la primera: nunca se avisa dos veces. null si no hay.
function propuestaNotificacionesRepository_buscarClave(lista, tipo, propuestaId) {
  for (var i = 0; i < (lista || []).length; i++) {
    if (lista[i].tipo === tipo && lista[i].propuestaId === propuestaId) {
      return lista[i];
    }
  }
  return null;
}

// Puede (re)intentarse AHORA: PENDIENTE o ERROR, con menos de PROPUESTA_NOTIF_MAX_INTENTOS intentos y sin otro intento en curso (ultimoIntentoUtc dentro del lease). Una fecha ilegible no bloquea.
function propuestaNotificacionesRepository_esReintentable(n, ahoraMs) {
  if (n.estado !== PROPUESTA_NOTIF_ESTADOS.PENDIENTE && n.estado !== PROPUESTA_NOTIF_ESTADOS.ERROR) {
    return false;
  }
  if (n.intentos >= PROPUESTA_NOTIF_MAX_INTENTOS) {
    return false;
  }
  var ultimo = new Date(n.ultimoIntentoUtc).getTime();
  return !(n.ultimoIntentoUtc !== '' && isFinite(ultimo) && ahoraMs - ultimo < PROPUESTA_NOTIF_LEASE_MS);
}

// Las filas reintentables, en el orden de la hoja (las mas viejas primero), sin repetir (tipo, propuestaId) y hasta `limite`.
function propuestaNotificacionesRepository_filtrarReintentables(lista, ahoraMs, limite) {
  var vistos = {};
  var salida = [];
  (lista || []).forEach(function (n) {
    var clave = n.tipo + '|' + n.propuestaId;
    if (vistos[clave] === true) {
      return;
    }
    vistos[clave] = true;
    if (salida.length < limite && propuestaNotificacionesRepository_esReintentable(n, ahoraMs)) {
      salida.push(n);
    }
  });
  return salida;
}

// --- Acceso a Sheets ---

// La hoja y su esquema. LANZA si la hoja no existe, esta vacia o tiene un esquema inesperado (fail-closed: nunca se crea ni se repara sola).
function propuestaNotificacionesRepository_hoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(PROPUESTA_NOTIF_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + PROPUESTA_NOTIF_HOJA + '" en el spreadsheet configurado (correr setupPropuestaNotificacionesSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + PROPUESTA_NOTIF_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var plan = propuestaNotificacionesRepository_planEsquema(header);
  if (!plan.ok) {
    throw new Error('La hoja "' + PROPUESTA_NOTIF_HOJA + '" tiene un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + ')');
  }
  return { sheet: sheet, indices: propuestaNotificacionesRepository_indiceColumnas(header), ancho: header.length };
}

// TODAS las notificaciones de la hoja, en el orden de las filas, en UNA lectura. Las filas totalmente vacias a mitad de hoja se saltan.
function propuestaNotificacionesRepository_leerTodas() {
  var hoja = propuestaNotificacionesRepository_hoja();
  var data = hoja.sheet.getDataRange().getValues();
  var lista = [];
  for (var i = 1; i < data.length; i++) {
    if (propuestaNotificacionesRepository_filaVacia(data[i])) {
      continue;
    }
    lista.push(propuestaNotificacionesRepository_objetoDesdeFila(data[i], hoja.indices, i + 1));
  }
  return lista;
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera. NO anidar (el lock de script no es reentrante).
function propuestaNotificacionesRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(PROPUESTA_NOTIF_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Escribe los campos `cambios` de la fila `numeroFila` SIN tocar las demas celdas (ni columnas extra que alguien haya agregado). Texto plano ANTES de los valores. Dentro del lock.
function propuestaNotificacionesRepository_actualizarFila(hoja, numeroFila, cambios) {
  var rango = hoja.sheet.getRange(numeroFila, 1, 1, hoja.ancho);
  var fila = rango.getValues()[0];
  Object.keys(cambios).forEach(function (nombre) {
    fila[hoja.indices[nombre]] = propuestaNotificacionesRepository_esVacio(cambios[nombre]) ? '' : cambios[nombre];
  });
  rango.setNumberFormats([propuestaNotificacionesRepository_formatosDeFila(hoja.indices, hoja.ancho)]);
  rango.setValues([fila]);
  SpreadsheetApp.flush();
}

// ASEGURA que existe la notificacion de (tipo, propuestaId): si ya hay una (en cualquier estado) la devuelve SIN tocarla; si no, agrega UNA fila PENDIENTE. IDEMPOTENTE y bajo lock.
// entrada: {tipo, propuestaId, wellId, permisosValidador, proponenteNombre, proponenteEmail, propuestaTimestampUtc} (ya validada por el que llama). Devuelve {creada, notificacion}.
// LANZA (sin escribir nada) si la hoja falta o esta mal.
function propuestaNotificacionesRepository_asegurar(entrada, ahoraIso, notificacionId) {
  return propuestaNotificacionesRepository_conLock(function () {
    var hoja = propuestaNotificacionesRepository_hoja();
    var existente = propuestaNotificacionesRepository_buscarClave(propuestaNotificacionesRepository_leerTodas(), entrada.tipo, entrada.propuestaId);
    if (existente) {
      return { creada: false, notificacion: existente };
    }
    var objeto = {
      notificacionId: notificacionId,
      tipo: entrada.tipo,
      propuestaId: entrada.propuestaId,
      wellId: entrada.wellId,
      permisosValidador: entrada.permisosValidador,
      proponenteNombre: entrada.proponenteNombre,
      proponenteEmail: entrada.proponenteEmail,
      propuestaTimestampUtc: entrada.propuestaTimestampUtc,
      estado: PROPUESTA_NOTIF_ESTADOS.PENDIENTE,
      intentos: 0,
      creadoUtc: ahoraIso,
      ultimoIntentoUtc: '',
      enviadoUtc: '',
      ultimoError: '',
      destinatariosEnviados: ''
    };
    var fila = propuestaNotificacionesRepository_filaDesdeObjeto(objeto, hoja.indices, hoja.ancho);
    var numero = hoja.sheet.getLastRow() + 1;
    var rango = hoja.sheet.getRange(numero, 1, 1, hoja.ancho);
    rango.setNumberFormats([propuestaNotificacionesRepository_formatosDeFila(hoja.indices, hoja.ancho)]);      // texto plano ANTES de los valores
    rango.setValues([fila]);
    SpreadsheetApp.flush();
    objeto.fila = numero;
    return { creada: true, notificacion: objeto };
  });
}

// RESERVA un intento (bajo lock): relee la fila, y solo si sigue siendo reintentable (PENDIENTE / ERROR, con intentos disponibles y sin otro intento en curso) suma 1 a `intentos` y marca
// ultimoIntentoUtc. Devuelve {reservada:true, notificacion} (con los valores ya actualizados) o {reservada:false, motivo:'NO_EXISTE'|'YA_PROCESADA'|'AGOTADA'|'EN_CURSO'}. LANZA si la hoja falta o esta mal.
function propuestaNotificacionesRepository_reservarIntento(notificacionId, ahoraMs) {
  return propuestaNotificacionesRepository_conLock(function () {
    var hoja = propuestaNotificacionesRepository_hoja();
    var actual = null;
    propuestaNotificacionesRepository_leerTodas().forEach(function (n) {
      if (actual === null && n.notificacionId === notificacionId) {
        actual = n;
      }
    });
    if (actual === null) {
      return { reservada: false, motivo: 'NO_EXISTE' };
    }
    if (actual.estado !== PROPUESTA_NOTIF_ESTADOS.PENDIENTE && actual.estado !== PROPUESTA_NOTIF_ESTADOS.ERROR) {
      return { reservada: false, motivo: 'YA_PROCESADA', notificacion: actual };
    }
    if (actual.intentos >= PROPUESTA_NOTIF_MAX_INTENTOS) {
      return { reservada: false, motivo: 'AGOTADA', notificacion: actual };
    }
    if (!propuestaNotificacionesRepository_esReintentable(actual, ahoraMs)) {
      return { reservada: false, motivo: 'EN_CURSO', notificacion: actual };
    }
    var ahoraIso = new Date(ahoraMs).toISOString();
    propuestaNotificacionesRepository_actualizarFila(hoja, actual.fila, { intentos: actual.intentos + 1, ultimoIntentoUtc: ahoraIso });
    actual.intentos += 1;
    actual.ultimoIntentoUtc = ahoraIso;
    return { reservada: true, notificacion: actual };
  });
}

// Registra el resultado de un intento (bajo lock): estado, enviadoUtc, ultimoError y destinatariosEnviados (solo lo que viene en `cambios`). Devuelve true si encontro la fila.
function propuestaNotificacionesRepository_registrarResultado(notificacionId, cambios) {
  return propuestaNotificacionesRepository_conLock(function () {
    var hoja = propuestaNotificacionesRepository_hoja();
    var destino = null;
    propuestaNotificacionesRepository_leerTodas().forEach(function (n) {
      if (destino === null && n.notificacionId === notificacionId) {
        destino = n;
      }
    });
    if (destino === null) {
      return false;
    }
    var permitidos = {};
    ['estado', 'enviadoUtc', 'ultimoError', 'destinatariosEnviados'].forEach(function (c) {
      if (Object.prototype.hasOwnProperty.call(cambios, c)) {
        permitidos[c] = c === 'ultimoError' ? String(cambios[c]).slice(0, PROPUESTA_NOTIF_ULTIMO_ERROR_MAX) : cambios[c];
      }
    });
    propuestaNotificacionesRepository_actualizarFila(hoja, destino.fila, permitidos);
    return true;
  });
}

// Las notificaciones que hay que (re)intentar ahora (ver filtrarReintentables), hasta `limite`. Una sola lectura de la hoja. LANZA si la hoja falta o esta mal.
function propuestaNotificacionesRepository_listarReintentables(ahoraMs, limite) {
  return propuestaNotificacionesRepository_filtrarReintentables(propuestaNotificacionesRepository_leerTodas(), ahoraMs, limite);
}

// Cuantas filas hay en cada estado (solo para el diagnostico). LANZA si la hoja falta o esta mal.
function propuestaNotificacionesRepository_contarPorEstado() {
  var cuentas = { PENDIENTE: 0, ENVIADA: 0, ERROR: 0, OMITIDA: 0, OTRO: 0 };
  propuestaNotificacionesRepository_leerTodas().forEach(function (n) {
    cuentas[Object.prototype.hasOwnProperty.call(PROPUESTA_NOTIF_ESTADOS, n.estado) ? n.estado : 'OTRO'] += 1;
  });
  return cuentas;
}

// Correr UNA VEZ manualmente desde el editor de Apps Script, SOLO cuando el usuario lo decida: NO se ejecuta sola. IDEMPOTENTE: crea la hoja con su encabezado si no existe; si ya existe SOLO la valida
// (no borra, no reordena, no toca ninguna fila ni el encabezado) y falla si el esquema no es el esperado. No la llama ninguna lectura ni escritura. Devuelve 'CREADA' o 'YA_EXISTE'.
function setupPropuestaNotificacionesSheet() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(PROPUESTA_NOTIF_HOJA);
  if (existente) {
    if (existente.getLastColumn() === 0) {
      throw new Error('La hoja ' + PROPUESTA_NOTIF_HOJA + ' existe pero esta vacia: no se modifica. Revisarla a mano.');
    }
    var plan = propuestaNotificacionesRepository_planEsquema(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0]);
    if (!plan.ok) {
      throw new Error('La hoja ' + PROPUESTA_NOTIF_HOJA + ' existe con un esquema inesperado (faltan: ' + plan.faltantes.join(', ') + '; repetidas: ' + plan.repetidas.join(', ') + '). No se modifico nada.');
    }
    Logger.log('La hoja ' + PROPUESTA_NOTIF_HOJA + ' ya existe con el esquema correcto, no se modifico.');
    return 'YA_EXISTE';
  }
  var sheet = spreadsheet.insertSheet(PROPUESTA_NOTIF_HOJA);
  sheet.getRange(1, 1, 1, PROPUESTA_NOTIF_COLUMNAS.length).setValues([PROPUESTA_NOTIF_COLUMNAS]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + PROPUESTA_NOTIF_HOJA + ' creada.');
  return 'CREADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROPUESTA_NOTIF_HOJA,
    PROPUESTA_NOTIF_COLUMNAS,
    PROPUESTA_NOTIF_FORMATOS_NUMERICOS,
    PROPUESTA_NOTIF_ESTADOS,
    PROPUESTA_NOTIF_MAX_INTENTOS,
    PROPUESTA_NOTIF_LEASE_MS,
    PROPUESTA_NOTIF_LOCK_TIMEOUT_MS,
    PROPUESTA_NOTIF_ULTIMO_ERROR_MAX,
    propuestaNotificacionesRepository_indiceColumnas,
    propuestaNotificacionesRepository_planEsquema,
    propuestaNotificacionesRepository_objetoDesdeFila,
    propuestaNotificacionesRepository_filaVacia,
    propuestaNotificacionesRepository_filaDesdeObjeto,
    propuestaNotificacionesRepository_formatosDeFila,
    propuestaNotificacionesRepository_buscarClave,
    propuestaNotificacionesRepository_esReintentable,
    propuestaNotificacionesRepository_filtrarReintentables,
    propuestaNotificacionesRepository_hoja,
    propuestaNotificacionesRepository_leerTodas,
    propuestaNotificacionesRepository_conLock,
    propuestaNotificacionesRepository_actualizarFila,
    propuestaNotificacionesRepository_asegurar,
    propuestaNotificacionesRepository_reservarIntento,
    propuestaNotificacionesRepository_registrarResultado,
    propuestaNotificacionesRepository_listarReintentables,
    propuestaNotificacionesRepository_contarPorEstado,
    setupPropuestaNotificacionesSheet
  };
}
