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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { notificationService_buildMessage, notificationService_notifyWellSearch };
}
