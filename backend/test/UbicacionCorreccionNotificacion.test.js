// Aviso por email a validadores cuando una correccion queda PROPUESTA (MailApp, costo $0). Dos niveles:
//  1) unidad: destinatarios, mensaje, cuota, dedupe, fallos (MailApp / Usuarios / cache) - nada lanza.
//  2) cadena REAL: Api.doPost -> servicio -> hojas en memoria (correcciones + Usuarios) -> MailApp simulado, para verificar cuando SI y cuando NO se manda.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const W = '14-0001';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const norte = (g) => OFICIAL.lat + g;
const ENCABEZADO_USUARIOS = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'ubicacion_corregir', 'ubicacion_validar'];
const fila = (email, nombre, estado, p) => {
  const permisos = Object.assign({ ubicacion: 'NO', ubicacion_corregir: 'NO', ubicacion_validar: 'NO' }, p || {});
  return [email, nombre, estado, '2026-01-01', 'SI', 'SI', permisos.ubicacion, 'NO', 'NO', 'NO', 'NO', permisos.ubicacion_corregir, permisos.ubicacion_validar];
};

let N;
let Service;
let Repo;
let UserRepo;
let correos;            // MailApp.sendEmail: cada llamada
let logs;               // Logger.log
let cuota;              // cuota diaria simulada (null = no consultable)

function instalarComunes() {
  jest.resetModules();
  installAppsScriptFakes();
  logs = [];
  global.Logger = { log: jest.fn((t) => { logs.push(String(t)); }) };
  global.Utilities.formatDate = jest.fn((d, tz, fmt) => {
    const dos = (n) => (n < 10 ? '0' : '') + n;
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  });
  correos = [];
  cuota = 100;
  global.MailApp = {
    sendEmail: jest.fn((m) => { correos.push(m); }),
    getRemainingDailyQuota: jest.fn(() => { if (cuota === null) { throw new Error('sin cuota'); } return cuota; })
  };
  global.getPwaUrl = jest.fn(() => 'https://ejemplo.github.io/dgi-pozos-pwa/');
  Service = require('../src/UbicacionCorreccionService');
  Repo = require('../src/UbicacionCorreccionRepository');
  UserRepo = require('../src/SheetUserRepository');
  N = require('../src/UbicacionCorreccionNotificacion');
}

const vista = (extra) => Object.assign({
  correccionId: '11111111-1111-4111-8111-111111111111', wellId: W, lat: -33.3478, lon: -69.1456, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '',
  nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 22.2, advertenciaDistancia: false,
  irrigacion: { lat: OFICIAL.lat, lon: OFICIAL.lon, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' }, estado: 'PROPUESTA', resolucion: null, propia: false
}, extra || {});

describe('unidad: destinatarios, mensaje, cuota y fallos', () => {
  beforeEach(() => {
    instalarComunes();
    Object.assign(global, Service);
    global.sheetUserRepository_listarConPermisos = jest.fn(() => [
      { email: 'valeria@x.com', nombre: 'Valeria' }, { email: 'carla@x.com', nombre: 'Carla' }, { email: 'ana@x.com', nombre: 'Ana Pérez' }
    ]);
  });

  describe('destinatarios', () => {
    test('pide usuarios activos con ubicacion Y ubicacion_validar, y excluye al proponente (sin importar mayusculas/espacios)', () => {
      const r = N.ubicacionCorreccionNotificacion_destinatarios('  ANA@x.com ');
      expect(global.sheetUserRepository_listarConPermisos).toHaveBeenCalledWith(['ubicacion', 'ubicacion_validar']);
      expect(r.map((u) => u.email)).toEqual(['valeria@x.com', 'carla@x.com']);
    });

    test('sin repetidos, sin emails vacios ni de forma invalida (nada que pueda inyectar encabezados)', () => {
      global.sheetUserRepository_listarConPermisos = jest.fn(() => [
        { email: 'a@x.com' }, { email: 'A@X.com ' }, { email: '' }, { email: 'sin-arroba' }, { email: 'b@x.com\nBcc: malo@x.com' }, { email: 'c d@x.com' },
        { email: 'x@y' }, { email: 'ok@x.com', nombre: null }, { email: null }
      ]);
      expect(N.ubicacionCorreccionNotificacion_destinatarios('').map((u) => u.email)).toEqual(['a@x.com', 'ok@x.com']);
    });

    test('si la hoja de Usuarios no se puede leer, lanza (lo atiende notificarPendiente)', () => {
      global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios"'); });
      expect(() => N.ubicacionCorreccionNotificacion_destinatarios('x')).toThrow();
    });
  });

  describe('mensaje', () => {
    test('asunto exacto con el pozo', () => {
      expect(N.ubicacionCorreccionNotificacion_armarMensaje(vista(), '').asunto).toBe('DGI Pozos — Corrección de ubicación pendiente: 14-0001');
    });

    test('cuerpo: pozo, quien propuso (nombre), fecha, metodo, distancia, observacion y enlace', () => {
      const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'GPS_ACTUAL', precisionGpsM: 9.5, distanciaM: 884.1, observacion: 'Medido desde el camino' }), 'https://ejemplo.github.io/dgi-pozos-pwa/');
      expect(m.cuerpo).toContain('Hay una corrección de ubicación pendiente de validación.');
      expect(m.cuerpo).toContain('Pozo: 14-0001');
      expect(m.cuerpo).toContain('Propuesta por: Ana Pérez');
      expect(m.cuerpo).toContain('Fecha: 13/10/2026 09:30');
      expect(m.cuerpo).toContain('Método: GPS (± 9,5 m)');
      expect(m.cuerpo).toContain('Distancia a la ubicación de Irrigación: 884,1 m');
      expect(m.cuerpo).toContain('Observación: Medido desde el camino');
      expect(m.cuerpo).toContain('Abrí la app para revisarla: https://ejemplo.github.io/dgi-pozos-pwa/');
    });

    test('PUNTO_EN_MAPA se muestra como "Elegida en mapa"', () => {
      expect(N.ubicacionCorreccionNotificacion_armarMensaje(vista(), '').cuerpo).toContain('Método: Elegida en mapa');
    });

    test('sin distancia (pozo sin Irrigacion), sin observacion y sin URL: esas lineas no aparecen', () => {
      const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ distanciaM: null, observacion: '' }), '');
      expect(m.cuerpo).not.toContain('Distancia');
      expect(m.cuerpo).not.toContain('Observación');
      expect(m.cuerpo).not.toContain('Abrí la app');
      expect(m.cuerpo).not.toMatch(/https?:/);
    });

    test('advertencia a mas de 250 m (suave) y a mas de 1 km (fuerte); hasta 250 m ninguna', () => {
      const a250 = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ distanciaM: 333.6 }), '').cuerpo;
      expect(a250).toContain('Atención: la ubicación propuesta está a más de 250 m');
      expect(a250).not.toContain('ATENCIÓN');
      const a1km = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ distanciaM: 1430, advertenciaDistancia: true }), '').cuerpo;
      expect(a1km).toContain('ATENCIÓN: la ubicación propuesta está a más de 1 km');
      expect(a1km).toContain('1,4 km');
      expect(a1km).not.toContain('a más de 250 m');
      const sin = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ distanciaM: 250 }), '').cuerpo;
      expect(sin).not.toMatch(/Atención|ATENCIÓN/);
    });

    test('NO incluye datos innecesarios: ni coordenadas, ni emails, ni datos de Irrigacion, ni ids internos', () => {
      const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ observacion: 'nota' }), 'https://ejemplo.github.io/dgi-pozos-pwa/');
      const todo = m.asunto + '\n' + m.cuerpo;
      expect(todo).not.toMatch(/@/);
      expect(todo).not.toContain('-33.3478');
      expect(todo).not.toContain('-69.1456');
      expect(todo).not.toContain('-33.34765');
      expect(todo).not.toContain('11111111-1111');
      expect(todo).not.toMatch(/reportePozos|padron|titular/i);
    });

    test('el texto de usuario no puede meter saltos de linea ni caracteres de control', () => {
      const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ nombrePropone: 'Ana\r\nBcc: malo@x.com', observacion: 'linea1\nlinea2\u0007' }), '');
      expect(m.cuerpo).toContain('Propuesta por: Ana  Bcc: malo@x.com');
      expect(m.cuerpo).toContain('Observación: linea1 linea2');
      expect(m.asunto).not.toMatch(/[\r\n]/);
    });

    test('wellId raro: el asunto no lo copia', () => {
      expect(N.ubicacionCorreccionNotificacion_armarMensaje(vista({ wellId: '14-0001\nBcc: x' }), '').asunto).toBe('DGI Pozos — Corrección de ubicación pendiente: sin identificar');
    });

    test('nombre ausente', () => {
      expect(N.ubicacionCorreccionNotificacion_armarMensaje(vista({ nombrePropone: '' }), '').cuerpo).toContain('Propuesta por: (sin nombre)');
    });
  });

  describe('notificarPendiente', () => {
    test('PROPUESTA: un email por validador (sin el proponente), cada uno SOLO a su destinatario, con asunto y cuerpo', () => {
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(r).toMatchObject({ resultado: 'ENVIADO', destinatarios: 2, enviados: 2, fallidos: 0 });
      expect(correos.map((c) => c.to)).toEqual(['valeria@x.com', 'carla@x.com']);
      correos.forEach((c) => {
        expect(c.subject).toBe('DGI Pozos — Corrección de ubicación pendiente: 14-0001');
        expect(c.body).toContain('Pozo: 14-0001');
        expect(c.bcc).toBeUndefined();
        expect(c.cc).toBeUndefined();
        expect(c.name).toBe('DGI Pozos');
        expect(c.body).not.toContain('valeria@x.com');          // un validador no ve las direcciones de los demas
        expect(c.body).not.toContain('carla@x.com');
      });
    });

    test('el proponente (aunque valide) nunca recibe su propio aviso', () => {
      N.ubicacionCorreccionNotificacion_notificarPendiente('carla@x.com', vista());
      expect(correos.map((c) => c.to)).not.toContain('carla@x.com');
    });

    test.each([['VALIDADA'], ['RECHAZADA'], ['SUPERADA'], ['REVERTIDA'], ['INCONSISTENTE'], [undefined]])('estado %s: NO manda nada', (estado) => {
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista({ estado: estado }));
      expect(r.resultado).toBe('NO_APLICA');
      expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
      expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    });

    test('sin correccion o sin id: no aplica', () => {
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('a@x.com', null).resultado).toBe('NO_APLICA');
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('a@x.com', vista({ correccionId: '' })).resultado).toBe('NO_APLICA');
      expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    });

    test('DEDUPE: avisar dos veces la misma correccion manda UNA sola vez', () => {
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()).resultado).toBe('ENVIADO');
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()).resultado).toBe('DEDUPED');
      expect(correos).toHaveLength(2);
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista({ correccionId: '22222222-2222-4222-8222-222222222222' })).resultado).toBe('ENVIADO');   // otra correccion si
      expect(correos).toHaveLength(4);
    });

    test('la marca de dedupe se reserva ANTES de enviar y dura el maximo de CacheService (6 h)', () => {
      const cache = CacheService.getScriptCache();
      const put = jest.spyOn(cache, 'put');
      global.MailApp.sendEmail.mockImplementation(() => { expect(put).toHaveBeenCalled(); });
      N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(put).toHaveBeenCalledWith('ucorr_mail_11111111-1111-4111-8111-111111111111', '1', 21600);
    });

    test('SIN validadores: no falla, no manda, informa SIN_DESTINATARIOS', () => {
      global.sheetUserRepository_listarConPermisos = jest.fn(() => []);
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(r).toMatchObject({ resultado: 'SIN_DESTINATARIOS', destinatarios: 0, enviados: 0 });
      expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    });

    test('el unico validador es el proponente: tambien SIN_DESTINATARIOS', () => {
      global.sheetUserRepository_listarConPermisos = jest.fn(() => [{ email: 'ana@x.com', nombre: 'Ana' }]);
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()).resultado).toBe('SIN_DESTINATARIOS');
    });

    test('FALLO de MailApp (p. ej. permiso sin autorizar): no lanza y informa FALLO', () => {
      global.MailApp.sendEmail.mockImplementation(() => { throw new Error('Authorization is required to perform that action. valeria@x.com'); });
      let r;
      expect(() => { r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()); }).not.toThrow();
      expect(r).toMatchObject({ resultado: 'FALLO', destinatarios: 2, enviados: 0, fallidos: 2 });
      expect(logs.join('\n')).not.toMatch(/@x\.com/);                   // el log no filtra direcciones
    });

    test('fallo de UN destinatario: los demas reciben el aviso (PARCIAL)', () => {
      global.MailApp.sendEmail.mockImplementation((m) => { if (m.to === 'valeria@x.com') { throw new Error('rechazado'); } correos.push(m); });
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(r).toMatchObject({ resultado: 'PARCIAL', enviados: 1, fallidos: 1 });
      expect(correos.map((c) => c.to)).toEqual(['carla@x.com']);
    });

    test('CUOTA: se consulta antes de enviar y no se pasa de lo disponible', () => {
      cuota = 1;
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(global.MailApp.getRemainingDailyQuota).toHaveBeenCalled();
      expect(r).toMatchObject({ resultado: 'PARCIAL', enviados: 1, fallidos: 1, sinCuota: true });
      expect(correos).toHaveLength(1);
    });

    test('cuota 0: nada se envia, FALLO con sinCuota', () => {
      cuota = 0;
      const r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista());
      expect(r).toMatchObject({ resultado: 'FALLO', enviados: 0, sinCuota: true });
      expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    });

    test('cuota suficiente: sinCuota false', () => {
      cuota = 2;
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista())).toMatchObject({ resultado: 'ENVIADO', sinCuota: false });
    });

    test('si no se puede consultar la cuota igual se intenta enviar', () => {
      cuota = null;
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()).resultado).toBe('ENVIADO');
    });

    test('hoja de Usuarios ilegible: ERROR, sin lanzar y sin mandar', () => {
      global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios"'); });
      let r;
      expect(() => { r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()); }).not.toThrow();
      expect(r.resultado).toBe('ERROR');
      expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    });

    test('hasta CacheService roto no hace lanzar al aviso', () => {
      global.CacheService = { getScriptCache: () => { throw new Error('cache caido'); } };
      let r;
      expect(() => { r = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()); }).not.toThrow();
      expect(r.resultado).toBe('ERROR');
    });

    test('getPwaUrl que falla: el aviso sale sin enlace', () => {
      global.getPwaUrl = jest.fn(() => { throw new Error('x'); });
      expect(N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', vista()).resultado).toBe('ENVIADO');
      expect(correos[0].body).not.toContain('Abrí la app');
    });
  });

  describe('texto de auditoria (Historial): cantidad y resultado, nunca el cuerpo ni direcciones', () => {
    const t = (r) => N.ubicacionCorreccionNotificacion_textoAuditoria(r);
    test('cada resultado', () => {
      expect(t({ resultado: 'ENVIADO', enviados: 3, destinatarios: 3 })).toBe('EMAIL_ENVIADO (3 destinatarios)');
      expect(t({ resultado: 'ENVIADO', enviados: 1, destinatarios: 1 })).toBe('EMAIL_ENVIADO (1 destinatario)');
      expect(t({ resultado: 'PARCIAL', enviados: 2, destinatarios: 3 })).toBe('EMAIL_PARCIAL (2 de 3 enviados)');
      expect(t({ resultado: 'PARCIAL', enviados: 1, destinatarios: 3, sinCuota: true })).toBe('EMAIL_PARCIAL (1 de 3 enviados, cuota diaria agotada)');
      expect(t({ resultado: 'FALLO', enviados: 0, destinatarios: 2 })).toBe('EMAIL_FALLO (0 de 2 enviados)');
      expect(t({ resultado: 'FALLO', enviados: 0, destinatarios: 2, sinCuota: true })).toBe('EMAIL_FALLO (0 de 2 enviados, cuota diaria agotada)');
      expect(t({ resultado: 'SIN_DESTINATARIOS' })).toBe('EMAIL_SIN_DESTINATARIOS');
      expect(t({ resultado: 'ERROR' })).toBe('EMAIL_ERROR');
    });
    test('DEDUPED, NO_APLICA y nada: no se registra', () => {
      expect(t({ resultado: 'DEDUPED' })).toBeNull();
      expect(t({ resultado: 'NO_APLICA' })).toBeNull();
      expect(t(undefined)).toBeNull();
    });
  });

  test('diagnosticoCorreccionesEmail: pide el permiso de MailApp, informa cuota/URL/cantidad sin imprimir direcciones y no envia nada', () => {
    N.diagnosticoCorreccionesEmail();
    const log = logs.join('\n');
    expect(log).toContain('Cuota diaria restante de MailApp: 100');
    expect(log).toContain('PWA_URL: https://ejemplo.github.io/dgi-pozos-pwa/');
    expect(log).toContain('3');
    expect(log).not.toMatch(/valeria@x\.com|carla@x\.com/);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('getPwaUrl (Script Property PWA_URL, opcional)', () => {
  const con = (valor) => {
    jest.resetModules();
    global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => valor }) };
    return require('../src/Config').getPwaUrl();
  };
  test('una URL https simple se acepta (con o sin barra final / ruta)', () => {
    expect(con('https://dgi-subterranea.github.io/dgi-pozos-pwa/')).toBe('https://dgi-subterranea.github.io/dgi-pozos-pwa/');
    expect(con('  https://ejemplo.org  ')).toBe('https://ejemplo.org');
  });
  test.each([[null], [''], ['http://inseguro.org/'], ['javascript:alert(1)'], ['ftp://x.org'], ['https://x.org/a b'], ['https://x.org/\nBcc: y'], ['https://usuario:clave@x.org/'], ['https://x.org/?q=1'], ['no es url']])('%p -> sin enlace', (v) => {
    expect(con(v)).toBe('');
  });
});

describe('SheetUserRepository: validadores activos', () => {
  beforeEach(instalarComunes);
  const datos = (...filas) => [ENCABEZADO_USUARIOS].concat(filas);
  const filtrar = (data) => UserRepo.sheetUserRepository_filtrarConPermisos(data, ['ubicacion', 'ubicacion_validar']);
  const SI = { ubicacion: 'SI', ubicacion_validar: 'SI' };

  test('solo ACTIVOS con ubicacion=SI y ubicacion_validar=SI', () => {
    const r = filtrar(datos(
      fila('val@x.com', 'Valeria', 'activo', SI),
      fila('inactivo@x.com', 'Inactivo', 'inactivo', SI),
      fila('baja@x.com', 'Baja', 'baja', SI),
      fila('sinvalidar@x.com', 'Sin validar', 'activo', { ubicacion: 'SI' }),
      fila('sinubic@x.com', 'Sin ubicacion', 'activo', { ubicacion_validar: 'SI' }),
      fila('solocorregir@x.com', 'Solo corregir', 'activo', { ubicacion: 'SI', ubicacion_corregir: 'SI' }),
      fila('ambos@x.com', 'Ambos', 'activo', { ubicacion: 'SI', ubicacion_corregir: 'SI', ubicacion_validar: 'SI' })
    ));
    expect(r.map((u) => u.email)).toEqual(['val@x.com', 'ambos@x.com']);
    expect(r[0]).toEqual({ email: 'val@x.com', nombre: 'Valeria' });
  });

  test('estado y permisos se normalizan (" Activo ", "si"), pero valores raros NO cuentan (true, 1, "SI.")', () => {
    const r = filtrar(datos(
      fila('a@x.com', 'A', ' Activo ', { ubicacion: 'si', ubicacion_validar: ' SI ' }),
      fila('b@x.com', 'B', 'activo', { ubicacion: 'SI', ubicacion_validar: 'true' }),
      fila('c@x.com', 'C', 'activo', { ubicacion: 'SI', ubicacion_validar: 1 }),
      fila('d@x.com', 'D', 'activo', { ubicacion: 'SI', ubicacion_validar: 'SI.' }),
      fila('e@x.com', 'E', 'si', SI)
    ));
    expect(r.map((u) => u.email)).toEqual(['a@x.com']);
  });

  test('emails normalizados, vacios descartados y sin repetidos (aunque la hoja los repita)', () => {
    const r = filtrar(datos(fila(' VAL@x.com ', 'V', 'activo', SI), fila('val@x.com', 'V2', 'activo', SI), fila('', 'Sin email', 'activo', SI)));
    expect(r).toEqual([{ email: 'val@x.com', nombre: 'V' }]);
  });

  test('FAIL-CLOSED: si falta la columna ubicacion_validar (o ubicacion) nadie es validador', () => {
    const sinColumna = [ENCABEZADO_USUARIOS.filter((c) => c !== 'ubicacion_validar'), ['v@x.com', 'V', 'activo', '2026', 'SI', 'SI', 'SI', 'NO', 'NO', 'NO', 'NO', 'SI']];
    expect(filtrar(sinColumna)).toEqual([]);
  });

  test('columnas en cualquier orden; hoja vacia o sin datos; sin permisos pedidos no devuelve a todos', () => {
    const reordenada = [['ubicacion_validar', 'ubicacion', 'estado', 'nombre', 'email'], ['SI', 'SI', 'activo', 'Val', 'val@x.com']];
    expect(filtrar(reordenada)).toEqual([{ email: 'val@x.com', nombre: 'Val' }]);
    expect(filtrar([])).toEqual([]);
    expect(filtrar(null)).toEqual([]);
    expect(filtrar([ENCABEZADO_USUARIOS])).toEqual([]);
    expect(UserRepo.sheetUserRepository_filtrarConPermisos(datos(fila('v@x.com', 'V', 'activo', SI)), [])).toEqual([]);
  });

  test('nombre ausente -> null', () => {
    const data = [['email', 'estado', 'ubicacion', 'ubicacion_validar'], ['v@x.com', 'activo', 'SI', 'SI']];
    expect(filtrar(data)).toEqual([{ email: 'v@x.com', nombre: null }]);
  });

  test('lee la hoja "Usuarios" real (SpreadsheetApp) y falla si no existe', () => {
    instalarSheetsFalsos({ Usuarios: datos(fila('v@x.com', 'V', 'activo', SI), fila('n@x.com', 'N', 'activo', {})) });
    expect(UserRepo.sheetUserRepository_listarConPermisos(['ubicacion', 'ubicacion_validar']).map((u) => u.email)).toEqual(['v@x.com']);
    instalarSheetsFalsos({});
    expect(() => UserRepo.sheetUserRepository_listarConPermisos(['ubicacion'])).toThrow(/Usuarios/);
  });
});

// ------------------------------------------------------------------------------------------------------------------ cadena real
describe('cadena real: proponerCorreccionUbicacion -> aviso a validadores', () => {
  let Api;
  let hojas;
  let historial;
  const SESIONES = {
    'ana@x.com': { nombre: 'Ana', permisos: { ubicacion: true, ubicacion_corregir: true } },
    'carla@x.com': { nombre: 'Carla', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
    'val@x.com': { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_validar: true } }
  };

  beforeEach(() => {
    instalarComunes();
    global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
    Api = require('../src/Api');
    Object.assign(global, Repo, Service, N, UserRepo);
    delete global.ubicacionCorreccionNotificacion_notificarPendiente && Object.assign(global, N);       // el real, no el jest.fn de los fakes
    hojas = instalarSheetsFalsos({
      UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS],
      UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS],
      Usuarios: [ENCABEZADO_USUARIOS,
        fila('ana@x.com', 'Ana', 'activo', { ubicacion: 'SI', ubicacion_corregir: 'SI' }),
        fila('carla@x.com', 'Carla', 'activo', { ubicacion: 'SI', ubicacion_corregir: 'SI', ubicacion_validar: 'SI' }),
        fila('val@x.com', 'Valeria', 'activo', { ubicacion: 'SI', ubicacion_validar: 'SI' }),
        fila('val2@x.com', 'Valeria Dos', 'activo', { ubicacion: 'SI', ubicacion_validar: 'SI' }),
        fila('baja@x.com', 'De baja', 'inactivo', { ubicacion: 'SI', ubicacion_validar: 'SI' }),
        fila('sinubic@x.com', 'Sin ubicacion', 'activo', { ubicacion_validar: 'SI' }),
        fila('lector@x.com', 'Lector', 'activo', { ubicacion: 'SI' })]
    });
    global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
    global.registryService_getWellLocation = jest.fn((id) => (id === W ? { found: true, location: { wellId: id, ubicacionResuelta: OFICIAL } } : { found: false }));
    global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
    historial = [];
    global.logHistoryEvent = jest.fn((e, a, w, r) => { historial.push([e, a, w, r]); });
    global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && SESIONES[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
    global.isUserActive.mockImplementation((e) => !!SESIONES[e]);
    global.getUserAccess.mockImplementation((e) => ({ active: !!SESIONES[e], nombre: SESIONES[e].nombre, permisos: SESIONES[e].permisos }));
    global.hasPermission.mockImplementation((e, m) => !!SESIONES[e] && SESIONES[e].permisos[m] === true);
  });

  let n = 0;
  const proponer = (usuario, extra) => {
    n += 1;
    const cuerpo = Object.assign({
      action: 'proponerCorreccionUbicacion', sessionToken: 'tok-' + usuario, wellId: W, lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null,
      observacion: '', clientRequestId: 'aviso-' + String(n).padStart(8, '0')
    }, extra || {});
    return JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).text);
  };
  const avisos = () => historial.filter((h) => h[1] === 'notificarCorreccionUbicacion');

  test('PROPUESTA -> email a los validadores ACTIVOS con ubicacion + validar (sin el proponente, sin inactivos, sin lectores ni quien no tiene ubicacion)', () => {
    const r = proponer('ana@x.com', { observacion: 'Boca corrida' });
    expect(r.status).toBe('ok');
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(correos.map((c) => c.to).sort()).toEqual(['carla@x.com', 'val2@x.com', 'val@x.com']);
    correos.forEach((c) => {
      expect(c.subject).toBe('DGI Pozos — Corrección de ubicación pendiente: 14-0001');
      expect(c.body).toContain('Propuesta por: Ana');
      expect(c.body).toContain('Boca corrida');
      expect(c.body).toContain('https://ejemplo.github.io/dgi-pozos-pwa/');
    });
    expect(avisos()).toEqual([['ana@x.com', 'notificarCorreccionUbicacion', W, 'EMAIL_ENVIADO (3 destinatarios)']]);
  });

  test('la respuesta al cliente NO cambia por el aviso (mismas claves) y no filtra nada del aviso', () => {
    const r = proponer('ana@x.com');
    expect(Object.keys(r.data).sort()).toEqual(['correccion', 'curada', 'duplicada']);
    expect(JSON.stringify(r)).not.toMatch(/@|EMAIL/);
  });

  test('VALIDADA directa (corregir + validar): NO se manda ningun email ni se audita aviso', () => {
    const r = proponer('carla@x.com');
    expect(r.data.correccion.estado).toBe('VALIDADA');
    expect(r.data.autoValidada).toBe(true);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(avisos()).toEqual([]);
  });

  test('reintento idempotente: NO se manda de nuevo (ni se audita)', () => {
    const fijo = { clientRequestId: 'idem-0000001' };
    expect(proponer('ana@x.com', fijo).data.duplicada).toBe(false);
    expect(correos).toHaveLength(3);
    const otra = proponer('ana@x.com', fijo);
    expect(otra.data.duplicada).toBe(true);
    proponer('ana@x.com', fijo);
    expect(correos).toHaveLength(3);
    expect(avisos()).toHaveLength(1);
  });

  test('una propuesta NUEVA distinta si avisa', () => {
    proponer('ana@x.com');
    proponer('ana@x.com', { lat: norte(0.0004) });
    expect(correos).toHaveLength(6);
    expect(avisos()).toHaveLength(2);
  });

  test('SIN validadores: la propuesta se crea, no falla, queda registrado EMAIL_SIN_DESTINATARIOS', () => {
    hojas.Usuarios.filas = hojas.Usuarios.filas.filter((f, i) => i === 0 || !/val|carla|sinubic|baja/.test(f[0]));
    const r = proponer('ana@x.com');
    expect(r.status).toBe('ok');
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(avisos()).toEqual([['ana@x.com', 'notificarCorreccionUbicacion', W, 'EMAIL_SIN_DESTINATARIOS']]);
  });

  test('FALLA MailApp: la propuesta SIGUE creada, la respuesta es ok y se registra EMAIL_FALLO', () => {
    global.MailApp.sendEmail.mockImplementation(() => { throw new Error('Authorization is required to perform that action.'); });
    const r = proponer('ana@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
    expect(hojas.UbicacionCorreccionesLog.filas.slice(1).map((f) => f[2])).toEqual(['PROPUESTA']);
    expect(avisos()).toEqual([['ana@x.com', 'notificarCorreccionUbicacion', W, 'EMAIL_FALLO (0 de 3 enviados)']]);
  });

  test('un fallo parcial se registra como EMAIL_PARCIAL', () => {
    global.MailApp.sendEmail.mockImplementation((m) => { if (m.to === 'val2@x.com') { throw new Error('rechazado'); } correos.push(m); });
    proponer('ana@x.com');
    expect(avisos()[0][3]).toBe('EMAIL_PARCIAL (2 de 3 enviados)');
  });

  test('cuota diaria agotada: no se envia y se registra como tal', () => {
    cuota = 0;
    const r = proponer('ana@x.com');
    expect(r.status).toBe('ok');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(avisos()[0][3]).toBe('EMAIL_FALLO (0 de 3 enviados, cuota diaria agotada)');
  });

  test('la hoja de Usuarios inexistente no rompe la propuesta (EMAIL_ERROR)', () => {
    delete hojas.Usuarios;
    const r = proponer('ana@x.com');
    expect(r.status).toBe('ok');
    expect(avisos()[0][3]).toBe('EMAIL_ERROR');
  });

  test('un proponente que TAMBIEN figura como validador en la hoja (y quedo pendiente) no se avisa a si mismo', () => {
    // la sesion de Valeria solo tiene corregir (cache de permisos viejo): su propuesta queda PENDIENTE, pero en la hoja es validadora
    SESIONES['val@x.com'] = { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_corregir: true } };
    const r = proponer('val@x.com');
    expect(r.data.correccion.estado).toBe('PROPUESTA');
    expect(correos.map((c) => c.to)).not.toContain('val@x.com');
    expect(correos.map((c) => c.to).sort()).toEqual(['carla@x.com', 'val2@x.com']);
  });

  test('un lector (sin corregir) no puede crear nada: ni propuesta ni aviso', () => {
    SESIONES['lector@x.com'] = { nombre: 'Lector', permisos: { ubicacion: true } };
    const r = proponer('lector@x.com');
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(avisos()).toEqual([]);
  });

  test('un error de validacion (p. ej. observacion obligatoria) no manda nada', () => {
    const r = proponer('ana@x.com', { lat: norte(0.003) });
    expect(r.code).toBe('OBSERVACION_REQUERIDA');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('autocurado tras una escritura parcial: el reintento que recien deja la correccion PROPUESTA avisa UNA vez', () => {
    const log = hojas.UbicacionCorreccionesLog;
    const original = log.getRange.bind(log);
    let fallo = false;
    log.getRange = (f, c, nf, nc) => {
      const r = original(f, c, nf, nc);
      return Object.assign({}, r, { setValues: (v) => { if (!fallo) { fallo = true; throw new Error('Sheets rechazo'); } return r.setValues(v); } });
    };
    const fijo = { clientRequestId: 'curar-00000001' };
    const primero = proponer('ana@x.com', fijo);
    expect(primero.status).toBe('error');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();           // todavia no hay propuesta valida
    const curado = proponer('ana@x.com', fijo);
    expect(curado.data).toMatchObject({ duplicada: true, curada: true });
    expect(curado.data.correccion.estado).toBe('PROPUESTA');
    expect(correos).toHaveLength(3);
    proponer('ana@x.com', fijo);
    expect(correos).toHaveLength(3);                                    // el siguiente reintento ya es un duplicado comun
  });

  test('autocurado de una correccion DIRECTA (quien valida): queda VALIDADA y no se manda nada', () => {
    const log = hojas.UbicacionCorreccionesLog;
    const original = log.getRange.bind(log);
    let fallo = false;
    log.getRange = (f, c, nf, nc) => {
      const r = original(f, c, nf, nc);
      return Object.assign({}, r, { setValues: (v) => { if (!fallo) { fallo = true; throw new Error('Sheets rechazo'); } return r.setValues(v); } });
    };
    const fijo = { clientRequestId: 'curar-00000002' };
    proponer('carla@x.com', fijo);
    const curado = proponer('carla@x.com', fijo);
    expect(curado.data.correccion.estado).toBe('VALIDADA');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('Historial NUNCA guarda el cuerpo del email ni direcciones', () => {
    proponer('ana@x.com', { observacion: 'Texto de la observacion que va en el email' });
    avisos().forEach((a) => {
      expect(a[3]).not.toMatch(/@|Texto de la observacion|Pozo:|Propuesta por/);
      expect(a[3].length).toBeLessThan(80);
    });
    expect(JSON.stringify(historial)).not.toContain('val@x.com');
  });

  test('el aviso no usa nada pago: solo MailApp (sin UrlFetchApp)', () => {
    proponer('ana@x.com');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '../src/UbicacionCorreccionNotificacion.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(fuente).toContain('MailApp.sendEmail');
    expect(fuente).not.toMatch(/UrlFetchApp|OneSignal|Twilio|fetch\(/);
  });
});
