// Unica funcion que sabe que las notificaciones salen por la API de
// Telegram (Bot API, sendMessage). Texto plano, sin parse_mode - evita
// que un nombre de usuario con caracteres especiales rompa el formato
// del mensaje.
//
// IMPORTANTE: TELEGRAM_BOT_TOKEN nunca debe aparecer en un error que
// suba de esta funcion. La URL del request lo contiene embebido
// (https://api.telegram.org/bot<TOKEN>/sendMessage) - por eso una falla
// de RED (excepcion real de UrlFetchApp, que en Apps Script puede
// incluir la URL pedida en su propio mensaje) nunca se re-lanza tal
// cual, se reemplaza por un error generico. Una respuesta HTTP de
// Telegram (muteHttpExceptions:true) es segura de incluir: el cuerpo de
// esa respuesta es sobre el chat/mensaje, nunca repite el token.
function telegramRepository_sendMessage(texto) {
  var response;
  try {
    var url = 'https://api.telegram.org/bot' + getTelegramBotToken() + '/sendMessage';
    response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ chat_id: getTelegramChatId(), text: texto }),
      muteHttpExceptions: true
    });
  } catch (err) {
    throw new Error('Telegram: fallo la conexion');
  }

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('Telegram respondio ' + code + ': ' + response.getContentText());
  }
  return { ok: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { telegramRepository_sendMessage };
}
