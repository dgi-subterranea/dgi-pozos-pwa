const { installAppsScriptFakes } = require('./appsScriptFakes');

// NotificationService llama a telegramRepository_sendMessage como
// global (el fake) - mismo patron que RegistryService/NivelesEstaticosService.
const NotificationService = require('../src/NotificationService');

beforeEach(() => {
  installAppsScriptFakes();
  // Utilities.formatDate no esta en el fake compartido (solo lo usa este
  // servicio) - se agrega aca, con un resultado fijo para que los tests
  // de buildMessage no dependan de la fecha real de ejecucion.
  global.Utilities.formatDate = jest.fn(() => '15/09/2026 11:04');
});

describe('notificationService_buildMessage', () => {
  test('formato exacto, pozo encontrado, con nombre', () => {
    const texto = NotificationService.notificationService_buildMessage(
      'Juan Pérez', 'juan@example.com', '04-0263',
      { perfil: true, datos: true, ubicacion: true, ne: true }
    );
    expect(texto).toBe(
      '🔎 DGI Pozos\nJuan Pérez — juan@example.com\n04-0263\n✅ Encontrado\nPerfil · Datos · Ubicación · NE\n15/09/2026 11:04'
    );
  });

  test('formato exacto, pozo no encontrado, con nombre', () => {
    const texto = NotificationService.notificationService_buildMessage(
      'Juan Pérez', 'juan@example.com', '05-9999', {}
    );
    expect(texto).toBe('🔎 DGI Pozos\nJuan Pérez — juan@example.com\n05-9999\n❌ No encontrado\n15/09/2026 11:04');
  });

  test('sin nombre disponible: solo el email, sin guion suelto', () => {
    const texto = NotificationService.notificationService_buildMessage(
      null, 'juan@example.com', '04-0263', { perfil: true }
    );
    expect(texto.split('\n')[1]).toBe('juan@example.com');
  });

  test('modulos parcialmente encontrados: solo los true aparecen, en orden fijo Perfil/Datos/Ubicacion/NE', () => {
    const texto = NotificationService.notificationService_buildMessage(
      null, 'user@example.com', '01-0012',
      { ne: true, perfil: true, ubicacion: false, datos: undefined }
    );
    const lineaModulos = texto.split('\n')[4];
    expect(lineaModulos).toBe('Perfil · NE');
  });

  test('modulos con valores no-booleanos truthy (ej. string) NO cuentan como encontrado - solo true estricto', () => {
    const texto = NotificationService.notificationService_buildMessage(
      null, 'user@example.com', '01-0012', { perfil: 'si', datos: 1 }
    );
    expect(texto).toContain('❌ No encontrado');
  });
});

describe('notificationService_notifyWellSearch', () => {
  test('pozo encontrado: llama a Telegram una sola vez con el texto armado', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    const resultado = NotificationService.notificationService_notifyWellSearch(
      'juan@example.com', 'Juan Pérez', '04-0263', { perfil: true, datos: true }
    );

    expect(resultado).toEqual({ sent: true });
    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(1);
    expect(global.telegramRepository_sendMessage.mock.calls[0][0]).toContain('✅ Encontrado');
  });

  test('pozo no encontrado: igual notifica, con el texto de no-encontrado', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    NotificationService.notificationService_notifyWellSearch('user@example.com', null, '05-9999', {});

    expect(global.telegramRepository_sendMessage.mock.calls[0][0]).toContain('❌ No encontrado');
  });

  test('deduplicacion: dos busquedas del mismo email+wellId en la ventana -> Telegram solo se llama una vez', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    const r1 = NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});
    const r2 = NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});

    expect(r1).toEqual({ sent: true });
    expect(r2).toEqual({ sent: false, reason: 'DEDUPED' });
    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(1);
  });

  test('distinto wellId con el mismo email NO se deduplica entre si', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});
    NotificationService.notificationService_notifyWellSearch('user@example.com', null, '05-0100', {});

    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(2);
  });

  test('mismo wellId con distinto email NO se deduplica entre si', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    NotificationService.notificationService_notifyWellSearch('uno@example.com', null, '04-0263', {});
    NotificationService.notificationService_notifyWellSearch('dos@example.com', null, '04-0263', {});

    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(2);
  });

  // Caso central pedido: un error de Telegram nunca debe subir como
  // excepcion - la busqueda que disparo esto ya se resolvio antes.
  test('error de Telegram: no lanza, devuelve sent:false/reason:ERROR', () => {
    global.telegramRepository_sendMessage.mockImplementation(() => {
      throw new Error('Telegram respondio 401: Unauthorized');
    });

    expect(() => {
      NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});
    }).not.toThrow();

    const resultado = NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});
    expect(resultado).toEqual({ sent: false, reason: 'ERROR' });
  });

  test('si Telegram falla, NO se graba la clave de dedupe - un reintento posterior puede notificar', () => {
    global.telegramRepository_sendMessage.mockImplementationOnce(() => {
      throw new Error('Telegram: fallo la conexion');
    });
    global.telegramRepository_sendMessage.mockImplementationOnce(() => ({ ok: true }));

    const r1 = NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});
    const r2 = NotificationService.notificationService_notifyWellSearch('user@example.com', null, '04-0263', {});

    expect(r1).toEqual({ sent: false, reason: 'ERROR' });
    expect(r2).toEqual({ sent: true });
    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(2);
  });
});
