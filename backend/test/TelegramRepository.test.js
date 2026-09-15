const { installAppsScriptFakes } = require('./appsScriptFakes');

// TelegramRepository toca UrlFetchApp - por convencion del proyecto los
// repositorios de I/O externo no se testean unitariamente (ver
// DriveProfileRepository/SheetUserRepository). La excepcion es esta:
// tiene logica real (nunca dejar que TELEGRAM_BOT_TOKEN llegue a un
// mensaje de error), que es exactamente lo que hay que proteger de una
// regresion futura - vale la pena testearla con UrlFetchApp fakeado.
const TelegramRepository = require('../src/TelegramRepository');

beforeEach(() => {
  installAppsScriptFakes();
});

describe('telegramRepository_sendMessage', () => {
  test('respuesta 200: ok:true', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 200,
      getContentText: () => '{"ok":true}'
    });

    const resultado = TelegramRepository.telegramRepository_sendMessage('hola');

    expect(resultado).toEqual({ ok: true });
  });

  test('llama a la URL de sendMessage con el chat_id y el texto en el payload', () => {
    global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 200, getContentText: () => '{}' });

    TelegramRepository.telegramRepository_sendMessage('texto de prueba');

    const [url, options] = global.UrlFetchApp.fetch.mock.calls[0];
    expect(url).toContain('/sendMessage');
    const payload = JSON.parse(options.payload);
    expect(payload.chat_id).toBe('-1000000000');
    expect(payload.text).toBe('texto de prueba');
  });

  test('respuesta distinta de 200: lanza error con el codigo, SIN el token en el mensaje', () => {
    global.UrlFetchApp.fetch.mockReturnValue({
      getResponseCode: () => 401,
      getContentText: () => '{"ok":false,"description":"Unauthorized"}'
    });

    expect(() => TelegramRepository.telegramRepository_sendMessage('hola')).toThrow(/401/);

    try {
      TelegramRepository.telegramRepository_sendMessage('hola');
    } catch (err) {
      expect(err.message).not.toContain('test-telegram-token-nunca-debe-aparecer-en-un-error');
    }
  });

  test('excepcion real de red (UrlFetchApp.fetch lanza): error generico, SIN el token ni la URL original', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => {
      // Simula lo que puede pasar en Apps Script real: la excepcion de
      // red incluye la URL completa pedida (con el token embebido).
      throw new Error('Request failed for https://api.telegram.org/bottest-telegram-token-nunca-debe-aparecer-en-un-error/sendMessage returned code 500');
    });

    let errorCapturado;
    try {
      TelegramRepository.telegramRepository_sendMessage('hola');
    } catch (err) {
      errorCapturado = err;
    }

    expect(errorCapturado).toBeDefined();
    expect(errorCapturado.message).not.toContain('test-telegram-token-nunca-debe-aparecer-en-un-error');
    expect(errorCapturado.message).not.toContain('api.telegram.org');
  });
});
