// NotificationService: arma el mensaje de una busqueda y decide si
// corresponde mandarlo (deduplicacion). Los booleanos de "modulos" son
// PURAMENTE informativos para el texto del mensaje - vienen del
// frontend (que ya sabe que encontro, no hace falta volver a
// consultarlo) pero nunca se usan para autorizar ni para decidir que
// datos entregar. La unica fuente de verdad para permisos es
// hasPermission(), en cada endpoint real - esto es un canal secundario,
// de solo lectura sobre lo que ya se resolvio.
var NOTIFY_DEDUPE_SECONDS = 30;

var MODULO_LABEL = { perfil: 'Perfil', datos: 'Datos', ubicacion: 'Ubicación', ne: 'NE' };
var MODULO_ORDEN = ['perfil', 'datos', 'ubicacion', 'ne'];

function notificationService_buildMessage(nombre, email, wellId, modulos) {
  var identidad = nombre ? (nombre + ' — ' + email) : email;
  var encontrados = MODULO_ORDEN.filter(function (m) {
    return !!(modulos && modulos[m] === true);
  });

  var lineas = ['🔎 DGI Pozos', identidad, wellId];
  if (encontrados.length > 0) {
    lineas.push('✅ Encontrado');
    lineas.push(encontrados.map(function (m) { return MODULO_LABEL[m]; }).join(' · '));
  } else {
    lineas.push('❌ No encontrado');
  }
  lineas.push(Utilities.formatDate(new Date(), 'America/Argentina/Mendoza', 'dd/MM/yyyy HH:mm'));

  return lineas.join('\n');
}

// Deduplicacion: la clave (email+wellId) se graba en cache RECIEN
// cuando Telegram confirmo el envio - no antes. Si el primer intento
// falla (Telegram caido, red), una busqueda repetida del mismo pozo
// segundos despues puede reintentar y notificar - se prioriza que el
// aviso llegue por sobre evitar una rarisima carrera de doble mensaje.
function notificationService_notifyWellSearch(email, nombre, wellId, modulos) {
  var cache = CacheService.getScriptCache();
  var dedupeKey = 'notify_' + String(email).trim().toLowerCase() + '_' + wellId;

  if (cache.get(dedupeKey) !== null) {
    return { sent: false, reason: 'DEDUPED' };
  }

  try {
    var texto = notificationService_buildMessage(nombre, email, wellId, modulos);
    telegramRepository_sendMessage(texto);
    cache.put(dedupeKey, '1', NOTIFY_DEDUPE_SECONDS);
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'ERROR' };
  }
}

// Etapa "seleccion multiple + lote" (item 1 del cierre, auditoria
// revisada): UNA notificacion resumida por descarga ITF real, NUNCA una
// por pozo descargado - es la UNICA accion batch que manda Telegram
// (seleccionar geograficamente, ver la tabla y consultar disponibilidad
// NUNCA llegan aca). Ventana de dedupe corta (no los 30s de
// NOTIFY_DEDUPE_SECONDS): solo busca absorber un doble-click/doble-submit
// accidental, nunca bloquear 2 descargas distintas y legitimas hechas
// seguidas por el mismo usuario.
var DESCARGA_ITF_NOTIFY_DEDUPE_SECONDS = 10;
var DESCARGA_ITF_LISTADO_MAX_WELLIDS = 5;

// resumen = {totalSeleccionados, solicitados, descargados, fallidos, wellIds}
// wellIds = los SOLICITADOS en esta descarga (el lote que se intento
// bajar, exitosos y fallidos juntos) - no solo los exitosos, para que el
// registro refleje exactamente que se pidio.
function notificationService_buildDescargaItfMessage(nombre, email, resumen) {
  var identidad = nombre ? (nombre + ' — ' + email) : email;
  var listados = resumen.wellIds.slice(0, DESCARGA_ITF_LISTADO_MAX_WELLIDS).join(', ');
  var resto = resumen.wellIds.length - DESCARGA_ITF_LISTADO_MAX_WELLIDS;
  var listaTexto = listados + (resto > 0 ? ' +' + resto + ' más' : '');

  var lineas = [
    '📦 Descarga ITF',
    'Usuario: ' + identidad,
    'Seleccionados: ' + resumen.totalSeleccionados,
    'Solicitados: ' + resumen.solicitados,
    'Descargados: ' + resumen.descargados,
    'Fallidos: ' + resumen.fallidos,
    listaTexto,
    Utilities.formatDate(new Date(), 'America/Argentina/Mendoza', 'dd/MM/yyyy HH:mm')
  ];
  return lineas.join('\n');
}

// Dedupe por email+cantidades+primer wellId: suficiente para absorber un
// reintento identico sin pisar 2 descargas legitimas distintas.
function notificationService_notifyDescargaItf(email, nombre, resumen) {
  var cache = CacheService.getScriptCache();
  var dedupeKey = 'notifydescarga_' + String(email).trim().toLowerCase() + '_' +
    resumen.solicitados + '_' + resumen.descargados + '_' + resumen.fallidos + '_' + resumen.wellIds[0];

  if (cache.get(dedupeKey) !== null) {
    return { sent: false, reason: 'DEDUPED' };
  }

  try {
    var texto = notificationService_buildDescargaItfMessage(nombre, email, resumen);
    telegramRepository_sendMessage(texto);
    cache.put(dedupeKey, '1', DESCARGA_ITF_NOTIFY_DEDUPE_SECONDS);
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'ERROR' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    notificationService_buildMessage,
    notificationService_notifyWellSearch,
    notificationService_buildDescargaItfMessage,
    notificationService_notifyDescargaItf
  };
}
