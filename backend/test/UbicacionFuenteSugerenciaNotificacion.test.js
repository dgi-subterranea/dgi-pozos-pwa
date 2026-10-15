// Aviso por email de una SUGERENCIA pendiente a quienes validan: destinatarios (activos, ubicacion + ubicacion_validar, sin repetidos y sin el proponente), contenido seguro
// (sin emails, ids ni coordenadas), RESERVA de 20 destinatarios de cuota para las correcciones, y best-effort (nunca lanza ni cambia la respuesta funcional).
const { armarSug, W, LEE, VAL, VERO } = require('./sugerenciasHelper');

let t;
let enviados;
let cuota;
let usuarios;
beforeEach(() => {
  t = armarSug();
  enviados = [];
  cuota = { restante: 100, falla: false, falloEnvio: null, sinMetodo: false };
  usuarios = [
    { email: 'val@x.com', nombre: 'Valeria' }, { email: 'vero@x.com', nombre: 'Vero' }, { email: 'carla@x.com', nombre: 'Carla' }
  ];
  global.sheetUserRepository_listarConPermisos = jest.fn(() => usuarios);
  global.getPwaUrl = jest.fn(() => 'https://pozos.example.org/app/');
  global.MailApp = {
    sendEmail: jest.fn((m) => { if (cuota.falloEnvio && cuota.falloEnvio(m)) { throw new Error('rechazado ' + m.to); } enviados.push(m); }),
    getRemainingDailyQuota: jest.fn(() => { if (cuota.falla) { throw new Error('sin cuota'); } return cuota.restante; })
  };
  global.Logger = { log: jest.fn() };
  // Utilities.formatDate de Apps Script (hora de Mendoza = UTC-3): dd/MM/yyyy HH:mm
  global.Utilities.formatDate = (d) => {
    const x = new Date(d.getTime() - 3 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(x.getUTCDate()) + '/' + p2(x.getUTCMonth() + 1) + '/' + x.getUTCFullYear() + ' ' + p2(x.getUTCHours()) + ':' + p2(x.getUTCMinutes());
  };
});
afterEach(() => { jest.restoreAllMocks(); });

const N = () => t.Notif;
const sug = (extra) => Object.assign({ sugerenciaId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', wellId: W, etiquetaFuente: 'Irrigación (2)', accionSugerida: 'DESCARTAR', nombre: 'Lee Soloubicacion', timestampUtc: '2026-10-14T14:32:10.123Z', motivo: 'cae en el río' }, extra || {});
const avisar = (extra, proponente) => N().ubicacionFuenteSugerenciaNotificacion_notificarPendiente(proponente || LEE, sug(extra));
const muchos = (n) => Array.from({ length: n }, (_v, i) => ({ email: 'val' + i + '@x.com', nombre: 'V' + i }));

describe('mensaje', () => {
  test('asunto claro y cuerpo con pozo, tipo de sugerencia, fuente, proponente, fecha, motivo y enlace', () => {
    const m = N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug(), 'https://pozos.example.org/app/');
    expect(m.asunto).toBe('DGI Pozos — Sugerencia de ubicación pendiente: 14-0001');
    ['Pozo: 14-0001', 'Sugerencia: Descartar la fuente «Irrigación (2)»', 'Propuesta por: Lee Soloubicacion', 'Fecha: 14/10/2026', 'Motivo: cae en el río', 'https://pozos.example.org/app/'].forEach((x) => expect(m.cuerpo).toContain(x));
    expect(m.cuerpo).toContain('no cambia nada');
  });

  test.each([['ACEPTAR', 'Aceptar'], ['DESCARTAR', 'Descartar'], ['RESTAURAR', 'Restaurar']])('el verbo de %s es %s', (accion, verbo) => {
    expect(N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug({ accionSugerida: accion }), '').cuerpo).toContain('Sugerencia: ' + verbo + ' la fuente');
  });

  test('NO lleva emails, ids internos, payload tecnico ni coordenadas', () => {
    const m = N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug({ email: 'lee@x.com', clientRequestId: 'req-1', x: 2486460.782, y: 6310651.228, lat: -33.3, lon: -69.1, secuencia: 3 }), 'https://pozos.example.org/app/');
    const todo = m.asunto + '\n' + m.cuerpo;
    expect(todo).not.toMatch(/@|lee@|aaaaaaaa-1111|req-1|2486460|6310651|-33\.3|-69\.1|secuencia|clientRequestId/);
  });

  test('sin motivo no hay linea de motivo; sin URL no hay enlace', () => {
    const m = N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug({ motivo: '' }), '');
    expect(m.cuerpo).not.toMatch(/Motivo:|Abrí la app/);
  });

  test('los textos de usuario se limpian: no se pueden fabricar lineas falsas con saltos de linea ni caracteres de control', () => {
    const m = N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug({ nombre: 'Ana\nPropuesta por: Presidente', motivo: 'a\nAdvertencia: pague aqui\u0000', etiquetaFuente: 'Irrigación\nPozo: 99-9999' }), '');
    expect(m.cuerpo.split('\n').filter((l) => /^Propuesta por:/.test(l))).toHaveLength(1);
    expect(m.cuerpo.split('\n').filter((l) => /^Pozo:/.test(l))).toEqual(['Pozo: 14-0001']);
    expect(m.cuerpo.split('\n').some((l) => /^Advertencia:/.test(l))).toBe(false);
  });

  test('un wellId raro se muestra como "sin identificar" y un motivo enorme se acota', () => {
    const m = N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug({ wellId: '<script>', motivo: 'x'.repeat(5000) }), '');
    expect(m.asunto).toContain('sin identificar');
    expect(m.cuerpo.length).toBeLessThan(1500);
  });

  test('datos faltantes o invalidos no rompen', () => {
    [null, undefined, {}, 'x', 5].forEach((s) => expect(() => N().ubicacionFuenteSugerenciaNotificacion_armarMensaje(s, '')).not.toThrow());
  });
});

describe('destinatarios', () => {
  test('los validadores activos con ubicacion + ubicacion_validar (la consulta pide exactamente esos dos permisos)', () => {
    const r = avisar();
    expect(global.sheetUserRepository_listarConPermisos).toHaveBeenCalledWith(['ubicacion', 'ubicacion_validar']);
    expect(r).toMatchObject({ resultado: 'ENVIADO', destinatarios: 3, enviados: 3, fallidos: 0, sinCuota: false });
    expect(enviados.map((m) => m.to).sort()).toEqual(['carla@x.com', 'val@x.com', 'vero@x.com']);
  });

  test('un email por destinatario (los validadores no ven las direcciones de los demas)', () => {
    avisar();
    enviados.forEach((m) => { expect(typeof m.to).toBe('string'); expect(m.to).not.toMatch(/,/); expect(m.cc).toBeUndefined(); expect(m.bcc).toBeUndefined(); });
  });

  test('NO se avisa al propio proponente aunque tambien valide (sin importar mayusculas ni espacios)', () => {
    const r = avisar({}, '  VAL@x.com ');
    expect(enviados.map((m) => m.to).sort()).toEqual(['carla@x.com', 'vero@x.com']);
    expect(r.destinatarios).toBe(2);
  });

  test('sin repetidos y descartando direcciones de forma invalida (nunca se arma un encabezado con basura)', () => {
    usuarios = [{ email: 'val@x.com' }, { email: 'VAL@x.com' }, { email: ' val@x.com ' }, { email: 'a@x.com, b@x.com' }, { email: 'sin-arroba' }, { email: 'x@y' }, { email: '' }, { email: 'ok@x.com' }];
    avisar();
    expect(enviados.map((m) => m.to).sort()).toEqual(['ok@x.com', 'val@x.com']);
  });

  test('sin destinatarios: SIN_DESTINATARIOS y no se envia nada', () => {
    usuarios = [{ email: 'lee@x.com' }];
    expect(avisar({}, LEE)).toMatchObject({ resultado: 'SIN_DESTINATARIOS', enviados: 0 });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('si no se puede leer la hoja de usuarios: ERROR, nunca lanza y no se envia nada', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('hoja caida'); });
    expect(() => avisar()).not.toThrow();
    expect(avisar({ sugerenciaId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb' })).toMatchObject({ resultado: 'ERROR' });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('RESERVA DE CUOTA: las sugerencias nunca usan los ultimos 20 destinatarios disponibles', () => {
  test('cuota 25 y 10 validadores: a lo sumo 5 mails (25 - 20)', () => {
    usuarios = muchos(10);
    cuota.restante = 25;
    const r = avisar();
    expect(enviados).toHaveLength(5);
    expect(r).toMatchObject({ resultado: 'PARCIAL', enviados: 5, fallidos: 5, sinCuota: true, destinatarios: 10 });
  });

  test('cuota 100 y 3 validadores: se avisa a los 3 (hay de sobra)', () => {
    cuota.restante = 100;
    expect(avisar()).toMatchObject({ resultado: 'ENVIADO', enviados: 3, sinCuota: false });
  });

  test('cuota justo = destinatarios + 20: se avisa a todos; con uno menos, uno queda afuera', () => {
    usuarios = muchos(4);
    cuota.restante = 24;
    expect(avisar().enviados).toBe(4);
    enviados = [];
    cuota.restante = 23;
    const r = avisar({ sugerenciaId: 'cccccccc-1111-4111-8111-cccccccccccc' });
    expect(r).toMatchObject({ enviados: 3, fallidos: 1, sinCuota: true });
  });

  test.each([[20], [19], [5], [0], [-3]])('cuota restante %i (<= reserva): NO se envia ninguno (FALLO con sinCuota)', (restante) => {
    cuota.restante = restante;
    const r = avisar();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(r).toMatchObject({ resultado: 'FALLO', enviados: 0, sinCuota: true });
  });

  test('si no se puede consultar la cuota no se envia nada (no se puede garantizar la reserva)', () => {
    cuota.falla = true;
    expect(avisar()).toMatchObject({ resultado: 'FALLO', enviados: 0, sinCuota: true });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    delete global.MailApp.getRemainingDailyQuota;
    expect(avisar({ sugerenciaId: 'dddddddd-1111-4111-8111-dddddddddddd' })).toMatchObject({ resultado: 'FALLO', enviados: 0 });
  });

  test('la reserva es una constante de 20 y la cuenta ubicacionFuenteSugerenciaNotificacion_cupo', () => {
    expect(N().UFS_MAIL_RESERVA_CUOTA).toBe(20);
    expect(N().ubicacionFuenteSugerenciaNotificacion_cupo(10)).toBeGreaterThanOrEqual(0);
    cuota.restante = 25;
    expect(N().ubicacionFuenteSugerenciaNotificacion_cupo(10)).toBe(5);
    cuota.restante = 1000;
    expect(N().ubicacionFuenteSugerenciaNotificacion_cupo(10)).toBe(10);
    cuota.restante = 3;
    expect(N().ubicacionFuenteSugerenciaNotificacion_cupo(10)).toBe(0);
  });

  test('las CORRECCIONES de ubicacion mantienen su comportamiento: usan toda la cuota disponible, sin reserva', () => {
    usuarios = muchos(3);
    cuota.restante = 3;
    const c = { correccionId: 'c-1', estado: 'PROPUESTA', wellId: W, nombrePropone: 'Ana', timestamp: '2026-10-14T14:00:00.000Z', metodo: 'GPS_ACTUAL', distanciaM: 10, observacion: 'x' };
    const r = t.CorrNotif.ubicacionCorreccionNotificacion_notificarPendiente(LEE, c);
    expect(r).toMatchObject({ resultado: 'ENVIADO', enviados: 3 });
  });
});

describe('best-effort: un fallo de email nunca cambia ni deshace nada', () => {
  test('falla el envio a un destinatario: PARCIAL y el resto sale', () => {
    cuota.falloEnvio = (m) => m.to === 'vero@x.com';
    expect(avisar()).toMatchObject({ resultado: 'PARCIAL', enviados: 2, fallidos: 1 });
  });

  test('fallan todos: FALLO; el detalle del log no tiene direcciones', () => {
    cuota.falloEnvio = () => true;
    expect(avisar()).toMatchObject({ resultado: 'FALLO', enviados: 0, fallidos: 3 });
    global.Logger.log.mock.calls.forEach((c) => expect(String(c[0])).not.toMatch(/@x\.com/));
  });

  test('MailApp ausente: no lanza', () => {
    delete global.MailApp;
    expect(() => avisar()).not.toThrow();
  });

  test('un solo aviso por sugerencia (marca en cache): el segundo intento es DEDUPED y no manda nada', () => {
    avisar();
    enviados = [];
    expect(avisar()).toMatchObject({ resultado: 'DEDUPED' });
    expect(enviados).toHaveLength(0);
  });

  test('sin sugerenciaId (nada que avisar): NO_APLICA', () => {
    expect(N().ubicacionFuenteSugerenciaNotificacion_notificarPendiente(LEE, null)).toMatchObject({ resultado: 'NO_APLICA' });
    expect(N().ubicacionFuenteSugerenciaNotificacion_notificarPendiente(LEE, {})).toMatchObject({ resultado: 'NO_APLICA' });
  });

  test('nunca lanza, aun con CacheService roto o datos absurdos', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    expect(() => avisar()).not.toThrow();
    expect(avisar({ sugerenciaId: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee' }).resultado).toBe('ERROR');
  });

  test('sin PWA_URL configurada el aviso sale igual, sin enlace', () => {
    global.getPwaUrl = jest.fn(() => { throw new Error('no configurada'); });
    avisar();
    expect(enviados).toHaveLength(3);
    expect(enviados[0].body).not.toMatch(/Abrí la app/);
  });
});

describe('integracion con sugerir: el aviso sale solo para una sugerencia NUEVA', () => {
  const enApi = (extra, quien) => t.Api.handleSugerirDecisionFuente('tok-' + (quien || LEE), t.payloadSug(extra));

  test('una sugerencia nueva avisa a los validadores (sin el autor) y deja una linea en Historial', () => {
    const r = enApi({ accionSugerida: 'DESCARTAR', motivo: 'queda en el cerro' });
    expect(r.status).toBe('ok');
    expect(enviados.map((m) => m.to).sort()).toEqual(['carla@x.com', 'val@x.com', 'vero@x.com']);
    expect(enviados[0].body).toContain('Descartar la fuente «Reporte Pozos»');
    expect(enviados[0].body).toContain('queda en el cerro');
    expect(global.logHistoryEvent).toHaveBeenCalledWith(LEE, 'notificarSugerenciaFuente', W, 'EMAIL_ENVIADO (3 destinatarios)');
  });

  test('un reintento idempotente, una duplicada pendiente o una rechazada NO vuelven a avisar', () => {
    const p = { clientRequestId: 'req-mail-1' };
    enApi(p);
    enviados = [];
    expect(enApi(p).data.duplicada).toBe(true);
    expect(enApi({ clientRequestId: 'req-mail-2' }).code).toBe('ALREADY_PENDING');
    expect(enApi({ accionSugerida: 'RESTAURAR' }).status).toBe('error');
    expect(enviados).toEqual([]);
  });

  test('si el mail falla, la sugerencia IGUAL se crea y la respuesta es la misma; queda registrado el fallo', () => {
    cuota.falloEnvio = () => true;
    const r = enApi({});
    expect(r).toMatchObject({ status: 'ok' });
    expect(r.data.sugerencia.estado).toBe('PENDIENTE');
    expect(t.filasSug()).toHaveLength(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(LEE, 'notificarSugerenciaFuente', W, expect.stringMatching(/^EMAIL_FALLO/));
  });

  test('sin cuota suficiente (reserva): la sugerencia se crea y el aviso queda como EMAIL_FALLO con cuota agotada', () => {
    cuota.restante = 20;
    const r = enApi({});
    expect(r.status).toBe('ok');
    expect(global.logHistoryEvent).toHaveBeenCalledWith(LEE, 'notificarSugerenciaFuente', W, 'EMAIL_FALLO (0 de 3 enviados, cuota diaria agotada)');
  });

  test('si el modulo de aviso revienta, la sugerencia sigue siendo ok', () => {
    global.ubicacionFuenteSugerenciaNotificacion_notificarPendiente = jest.fn(() => { throw new Error('boom'); });
    const r = enApi({});
    expect(r.status).toBe('ok');
    expect(t.filasSug()).toHaveLength(1);
  });

  test('un validador que sugiere NO se avisa a si mismo', () => {
    enApi({}, VAL);
    expect(enviados.map((m) => m.to)).not.toContain(VAL);
  });
});
