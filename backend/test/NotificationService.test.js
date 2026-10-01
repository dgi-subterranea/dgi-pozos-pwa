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

describe('notificationService_buildDescargaItfMessage', () => {
  function resumen(overrides) {
    return Object.assign({
      totalSeleccionados: 80,
      solicitados: 50,
      descargados: 47,
      fallidos: 3,
      wellIds: ['01-0012', '01-0045', '02-0088']
    }, overrides || {});
  }

  test('formato exacto con 5 o menos wellId: sin "+N mas"', () => {
    const texto = NotificationService.notificationService_buildDescargaItfMessage('Juan Pérez', 'juan@example.com', resumen());
    expect(texto).toBe(
      '📦 Descarga ITF\nUsuario: Juan Pérez — juan@example.com\nSeleccionados: 80\nSolicitados: 50\nDescargados: 47\nFallidos: 3\n01-0012, 01-0045, 02-0088\n15/09/2026 11:04'
    );
  });

  test('mas de 5 wellId: lista los primeros 5 y agrega "+N mas"', () => {
    const wellIds = ['01-0012', '01-0045', '02-0088', '03-0010', '04-0012', '04-0013', '05-0001', '05-0002'];
    const texto = NotificationService.notificationService_buildDescargaItfMessage(null, 'user@example.com', resumen({ wellIds }));
    const lineaListado = texto.split('\n')[6];
    expect(lineaListado).toBe('01-0012, 01-0045, 02-0088, 03-0010, 04-0012 +3 más');
  });

  test('sin nombre disponible: solo el email', () => {
    const texto = NotificationService.notificationService_buildDescargaItfMessage(null, 'user@example.com', resumen());
    expect(texto.split('\n')[1]).toBe('Usuario: user@example.com');
  });

  test('los 4 conteos reflejan exactamente lo que se les pasa', () => {
    const texto = NotificationService.notificationService_buildDescargaItfMessage(null, 'u@example.com', resumen({
      totalSeleccionados: 12, solicitados: 12, descargados: 12, fallidos: 0
    }));
    expect(texto).toContain('Seleccionados: 12');
    expect(texto).toContain('Solicitados: 12');
    expect(texto).toContain('Descargados: 12');
    expect(texto).toContain('Fallidos: 0');
  });
});

describe('notificationService_notifyDescargaItf', () => {
  function resumen(overrides) {
    return Object.assign({
      totalSeleccionados: 10,
      solicitados: 10,
      descargados: 9,
      fallidos: 1,
      wellIds: ['01-0012', '01-0045']
    }, overrides || {});
  }

  test('llama a Telegram una sola vez con el texto armado', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    const resultado = NotificationService.notificationService_notifyDescargaItf('juan@example.com', 'Juan Pérez', resumen());

    expect(resultado).toEqual({ sent: true });
    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(1);
    expect(global.telegramRepository_sendMessage.mock.calls[0][0]).toContain('Descargados: 9');
  });

  // Privacidad: el mensaje de Telegram nunca debe llevar coordenadas,
  // centro/radio ni geometria de poligono - solo wellIds (formato DD-PPPP)
  // y conteos.
  test('el texto enviado a Telegram nunca contiene coordenadas/lat/lon', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    NotificationService.notificationService_notifyDescargaItf('u@example.com', null, resumen());

    const texto = global.telegramRepository_sendMessage.mock.calls[0][0];
    expect(texto).not.toMatch(/-?\d{1,3}\.\d{3,}/); // ningun numero con forma de coordenada decimal
  });

  test('deduplicacion: mismo resumen en la ventana corta -> Telegram solo se llama una vez', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    const r1 = NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen());
    const r2 = NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen());

    expect(r1).toEqual({ sent: true });
    expect(r2).toEqual({ sent: false, reason: 'DEDUPED' });
    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(1);
  });

  test('una descarga con resultado distinto (otros conteos) NO se deduplica', () => {
    global.telegramRepository_sendMessage.mockReturnValue({ ok: true });

    NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen());
    NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen({ descargados: 10, fallidos: 0 }));

    expect(global.telegramRepository_sendMessage).toHaveBeenCalledTimes(2);
  });

  test('error de Telegram: no lanza, devuelve sent:false/reason:ERROR', () => {
    global.telegramRepository_sendMessage.mockImplementation(() => {
      throw new Error('Telegram respondio 401: Unauthorized');
    });

    expect(() => {
      NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen());
    }).not.toThrow();

    const resultado = NotificationService.notificationService_notifyDescargaItf('user@example.com', null, resumen());
    expect(resultado).toEqual({ sent: false, reason: 'ERROR' });
  });
});
