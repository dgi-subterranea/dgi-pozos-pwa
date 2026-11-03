// Aviso por email REUTILIZABLE de una propuesta pendiente de validacion (PropuestaNotificacion.js): destinatarios (activos, todos los permisos de validador, sin repetidos), contenido seguro (sin imagen ni datos
// tecnicos), idempotencia por (tipo, propuestaId), best-effort (nunca lanza), cuota, tipos desconocidos fail-closed y reutilizacion por otro tipo. Nada manda emails reales: MailApp, CacheService y la hoja de
// Usuarios son falsos.
const { installAppsScriptFakes } = require('./appsScriptFakes');

let N;
let enviados;
let cuota;
let usuarios;
let pedidoPermisos;

const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const propuesta = (extra) => Object.assign({
  tipo: 'ITF',
  objetoId: '14-0130',
  wellId: '14-0130',
  propuestaId: ID,
  proponente: { email: 'ana@example.com', nombre: 'Ana Proponente' },
  timestamp: '2026-11-03T17:05:00.000Z'
}, extra || {});
const notificar = (extra) => N.propuestaNotificacion_notificar(propuesta(extra));

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  N = require('../src/PropuestaNotificacion');
  enviados = [];
  pedidoPermisos = [];
  cuota = { restante: 100, falla: false, falloEnvio: null };
  usuarios = [{ email: 'val1@example.com', nombre: 'Valeria' }, { email: 'val2@example.com', nombre: 'Vero' }];
  global.sheetUserRepository_listarConPermisos = jest.fn((permisos) => { pedidoPermisos.push(permisos); return usuarios; });
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

describe('mensaje', () => {
  const armar = (extra, url) => N.propuestaNotificacion_armarMensaje(N.propuestaNotificacion_normalizar(propuesta(extra)), url === undefined ? 'https://pozos.example.org/app/' : url);

  test('asunto y cuerpo: tipo, pozo, quien propuso, fecha y hora de Mendoza, estado pendiente, enlace e indicacion de «ITF pendientes»', () => {
    const m = armar();
    expect(m.asunto).toBe('DGI Pozos | Nueva propuesta de ITF | 14-0130');
    expect(m.cuerpo.split('\n')).toEqual([
      'Hay una nueva propuesta de ITF pendiente de validación.',
      '',
      'Tipo de propuesta: ITF',
      'Pozo: 14-0130',
      'Propuesta por: Ana Proponente',
      'Fecha y hora: 03/11/2026 14:05',
      'Estado: pendiente de validación',
      '',
      'Abrí la app: https://pozos.example.org/app/',
      'Para revisarla, entrá a «ITF pendientes».',
      '',
      '— DGI Pozos. Aviso automático: no respondas este correo.'
    ]);
  });

  test('NO lleva imagen, emails, documentoId, storage, hash ni clientRequestId aunque el pedido los traiga', () => {
    const m = armar({
      documentoId: ID, storageFileId: 'drive-ref-secreto', sha256: 'f'.repeat(64), clientRequestId: 'req-123456', imageBase64: 'AAAA', secuencia: 7,
      proponente: { email: 'ana@example.com', nombre: 'Ana Proponente', storageFileId: 'x' }
    });
    const todo = m.asunto + '\n' + m.cuerpo;
    expect(todo).not.toMatch(/@|aaaaaaaa-1111|drive-ref|ffffffff|req-123456|AAAA|secuencia|storage|sha|hash|clientRequestId|documentoId/i);
  });

  test('sin enlace configurado el aviso sale sin la linea de enlace pero con la indicacion', () => {
    const m = armar({}, '');
    expect(m.cuerpo).not.toMatch(/Abrí la app/);
    expect(m.cuerpo).toContain('entrá a «ITF pendientes»');
  });

  test('los textos de usuario se limpian: el nombre no puede fabricar lineas falsas', () => {
    const m = armar({ proponente: { email: 'a@example.com', nombre: 'Ana\nEstado: aprobada\u0000\r\nPozo: 99-9999' } });
    expect(m.cuerpo.split('\n').filter((l) => /^Estado:/.test(l))).toEqual(['Estado: pendiente de validación']);
    expect(m.cuerpo.split('\n').filter((l) => /^Pozo:/.test(l))).toEqual(['Pozo: 14-0130']);
    expect(m.asunto).not.toMatch(/[\r\n]/);
  });

  test('un wellId raro se muestra como «sin identificar» y un nombre enorme se acota', () => {
    const m = armar({ wellId: '<script>\n', proponente: { email: 'a@example.com', nombre: 'x'.repeat(5000) } });
    expect(m.asunto).toBe('DGI Pozos | Nueva propuesta de ITF | sin identificar');
    expect(m.cuerpo.length).toBeLessThan(700);
  });

  test('sin nombre -> «(sin nombre)»; fecha invalida o ausente -> sin linea de fecha', () => {
    expect(armar({ proponente: { email: 'a@example.com', nombre: '   ' } }).cuerpo).toContain('Propuesta por: (sin nombre)');
    ['no es fecha', undefined, null, ''].forEach((t) => expect(armar({ timestamp: t }).cuerpo).not.toMatch(/Fecha y hora/));
  });

  test('un enlace que no es https publico se descarta', () => {
    ['http://x.org/', 'javascript:alert(1)', 'https://x.org/<b>', 5].forEach((u) => {
      const n = N.propuestaNotificacion_normalizar(propuesta({ url: u }));
      expect(n.url).toBe('');
    });
    expect(N.propuestaNotificacion_normalizar(propuesta({ url: 'https://otro.example.org/app/' })).url).toBe('https://otro.example.org/app/');
  });
});

describe('que se avisa y a quien (destinatarios)', () => {
  test('ITF: la consulta pide EXACTAMENTE perfil + perfil_validar (los permisos que exige el backend para la cola)', () => {
    notificar();
    expect(pedidoPermisos).toEqual([['perfil', 'perfil_validar']]);
  });

  test('dos validadores: ambos reciben su propio email (uno por destinatario, sin ver al otro)', () => {
    const r = notificar();
    expect(r).toEqual({ resultado: 'ENVIADO', destinatarios: 2, enviados: 2, fallidos: 0, sinCuota: false });
    expect(enviados.map((m) => m.to)).toEqual(['val1@example.com', 'val2@example.com']);
    enviados.forEach((m) => {
      expect(m.subject).toBe('DGI Pozos | Nueva propuesta de ITF | 14-0130');
      expect(m.name).toBe('DGI Pozos');
      expect(Object.keys(m).sort()).toEqual(['body', 'name', 'subject', 'to']);
      expect(m.body).not.toContain('val2@example.com');
    });
  });

  test('emails repetidos (aunque difieran en mayusculas o espacios) reciben UNO solo', () => {
    usuarios = [{ email: 'Val1@Example.com ', nombre: 'A' }, { email: 'val1@example.com', nombre: 'B' }, { email: ' VAL1@EXAMPLE.COM', nombre: 'C' }];
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', destinatarios: 1, enviados: 1 });
    expect(enviados.map((m) => m.to)).toEqual(['val1@example.com']);
  });

  test('emails de forma invalida o vacios se descartan (nunca se confia en la hoja para armar encabezados)', () => {
    usuarios = [{ email: 'sin-arroba', nombre: 'A' }, { email: '', nombre: 'B' }, { email: 'a@b', nombre: 'C' }, { email: 'dos@example.com,tres@example.com', nombre: 'D' }, { email: 'x@example.com\nBcc: y@example.com', nombre: 'E' }, { email: null, nombre: 'F' }, { email: 'ok@example.com', nombre: 'G' }];
    notificar();
    expect(enviados.map((m) => m.to)).toEqual(['ok@example.com']);
  });

  test('el proponente tambien validador RECIBE el aviso (decision de ITF: comportamiento simple y consistente)', () => {
    usuarios = [{ email: 'ana@example.com', nombre: 'Ana Proponente' }, { email: 'val1@example.com', nombre: 'Valeria' }];
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', destinatarios: 2, enviados: 2 });
    expect(enviados.map((m) => m.to)).toEqual(['ana@example.com', 'val1@example.com']);
  });

  test('un tipo que pida excluir al proponente (incluirProponente: false) NO se lo manda', () => {
    N.PROPUESTA_TIPOS.PRUEBA = { titulo: 'Nueva propuesta de prueba', intro: 'Hay algo.', etiquetaTipo: 'Prueba', lugarRevision: 'Pendientes', permisosValidador: ['prueba_validar'], incluirProponente: false };
    usuarios = [{ email: 'ANA@example.com', nombre: 'Ana' }, { email: 'val1@example.com', nombre: 'Valeria' }];
    expect(notificar({ tipo: 'PRUEBA' })).toMatchObject({ resultado: 'ENVIADO', destinatarios: 1, enviados: 1 });
    expect(enviados.map((m) => m.to)).toEqual(['val1@example.com']);
  });

  test('cero validadores: SIN_DESTINATARIOS, no se envia nada y no lanza', () => {
    usuarios = [];
    expect(notificar()).toEqual({ resultado: 'SIN_DESTINATARIOS', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('la lectura de Usuarios falla: ERROR, no se envia nada, no lanza y el log no trae direcciones', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios" (ana@example.com)'); });
    expect(notificar().resultado).toBe('ERROR');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).not.toContain('ana@example.com');
  });
});

describe('reutilizacion por otro tipo de propuesta', () => {
  beforeEach(() => {
    N.PROPUESTA_TIPOS.FOTO = { titulo: 'Nueva propuesta de foto', intro: 'Hay una foto pendiente de moderación.', etiquetaTipo: 'Foto', lugarRevision: 'Fotos pendientes', permisosValidador: ['fotos', 'fotos_moderar'], incluirProponente: true };
  });

  test('otro tipo usa SU texto y SU permiso de validador, con la misma maquinaria', () => {
    notificar({ tipo: 'FOTO' });
    expect(pedidoPermisos).toEqual([['fotos', 'fotos_moderar']]);
    expect(enviados[0].subject).toBe('DGI Pozos | Nueva propuesta de foto | 14-0130');
    expect(enviados[0].body).toContain('Tipo de propuesta: Foto');
    expect(enviados[0].body).toContain('entrá a «Fotos pendientes»');
  });

  test('el llamador puede indicar el permiso de validador en el pedido (permisosValidador), que pisa el del tipo', () => {
    notificar({ tipo: 'FOTO', permisosValidador: ['fotos_carga', 'fotos_moderar'] });
    expect(pedidoPermisos).toEqual([['fotos_carga', 'fotos_moderar']]);
  });

  test('la marca de idempotencia incluye el TIPO: el mismo propuestaId en dos tipos distintos son dos propuestas distintas', () => {
    expect(notificar({ tipo: 'ITF' }).resultado).toBe('ENVIADO');
    expect(notificar({ tipo: 'FOTO' }).resultado).toBe('ENVIADO');
    expect(notificar({ tipo: 'FOTO' }).resultado).toBe('DEDUPED');
    expect(enviados).toHaveLength(4);
  });
});

describe('fail-closed: pedidos que no se pueden atender NO avisan a nadie', () => {
  test.each([
    ['tipo desconocido', { tipo: 'NO_EXISTE' }],
    ['tipo heredado de Object.prototype', { tipo: 'constructor' }],
    ['tipo heredado + permisos explicitos (no puede colarse con un texto "undefined")', { tipo: 'constructor', permisosValidador: ['perfil_validar'] }],
    ['tipo __proto__ + permisos explicitos', { tipo: '__proto__', permisosValidador: ['perfil_validar'] }],
    ['tipo ausente', { tipo: undefined }],
    ['tipo no string', { tipo: 5 }],
    ['sin propuestaId', { propuestaId: undefined }],
    ['propuestaId vacio', { propuestaId: '' }],
    ['propuestaId con caracteres raros', { propuestaId: 'a b\nc' }],
    ['propuestaId demasiado largo', { propuestaId: 'a'.repeat(101) }],
    ['permisosValidador vacio', { permisosValidador: [] }],
    ['permisosValidador no es lista', { permisosValidador: 'perfil_validar' }],
    ['permisosValidador con algo que no es un permiso', { permisosValidador: ['perfil', 'x y'] }],
    ['permisosValidador con un no-string', { permisosValidador: ['perfil', 5] }]
  ])('%s -> NO_APLICA, sin consultar usuarios ni enviar', (nombre, extra) => {
    expect(notificar(extra)).toEqual({ resultado: 'NO_APLICA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test.each([null, undefined, 'x', 5, []])('un pedido que no es un objeto (%j) no lanza', (p) => {
    expect(() => N.propuestaNotificacion_notificar(p)).not.toThrow();
    expect(N.propuestaNotificacion_notificar(p).resultado).toBe('NO_APLICA');
  });
});

describe('idempotencia: no hay un segundo email para la misma propuesta', () => {
  test('la segunda llamada con la misma (tipo, propuestaId) es DEDUPED y no envia ni consulta usuarios', () => {
    expect(notificar().resultado).toBe('ENVIADO');
    global.sheetUserRepository_listarConPermisos.mockClear();
    expect(notificar()).toEqual({ resultado: 'DEDUPED', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(2);
  });

  test('otra propuesta (otro propuestaId) SI avisa', () => {
    notificar();
    notificar({ propuestaId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb' });
    expect(enviados).toHaveLength(4);
  });

  test('la marca se pone ANTES de enviar: un fallo total no se reintenta solo', () => {
    cuota.falloEnvio = () => true;
    expect(notificar().resultado).toBe('FALLO');
    cuota.falloEnvio = null;
    expect(notificar().resultado).toBe('DEDUPED');
    expect(enviados).toHaveLength(0);
  });

  test('si CacheService falla no se puede garantizar la idempotencia: ERROR y NO se envia (preferible a duplicar)', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('cache caido'); } };
    expect(notificar().resultado).toBe('ERROR');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('best-effort: fallos de MailApp y de cuota', () => {
  test('MailApp rechaza TODOS los envios: FALLO, no lanza', () => {
    cuota.falloEnvio = () => true;
    expect(() => notificar()).not.toThrow();
    expect(notificar({ propuestaId: 'cccccccc-3333-4333-8333-cccccccccccc' })).toMatchObject({ resultado: 'FALLO', destinatarios: 2, enviados: 0, fallidos: 2 });
  });

  test('MailApp rechaza a UN destinatario: PARCIAL, el resto lo recibe; el log no trae la direccion', () => {
    cuota.falloEnvio = (m) => m.to === 'val1@example.com';
    expect(notificar()).toMatchObject({ resultado: 'PARCIAL', destinatarios: 2, enviados: 1, fallidos: 1 });
    expect(enviados.map((m) => m.to)).toEqual(['val2@example.com']);
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).not.toContain('@example.com');
  });

  test('cuota insuficiente: no se pasa de lo disponible y se informa sinCuota', () => {
    cuota.restante = 1;
    expect(notificar()).toMatchObject({ resultado: 'PARCIAL', enviados: 1, fallidos: 1, sinCuota: true });
    expect(enviados).toHaveLength(1);
  });

  test('cuota agotada (0): FALLO sin intentar enviar', () => {
    cuota.restante = 0;
    expect(notificar()).toMatchObject({ resultado: 'FALLO', enviados: 0, fallidos: 2, sinCuota: true });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('no se puede consultar la cuota: se intenta igual', () => {
    cuota.falla = true;
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', enviados: 2, sinCuota: false });
  });

  test('MailApp sin getRemainingDailyQuota: se intenta igual', () => {
    delete global.MailApp.getRemainingDailyQuota;
    expect(notificar().resultado).toBe('ENVIADO');
  });

  test('la url del pedido (https publica) gana sobre PWA_URL; sin ella se usa PWA_URL', () => {
    notificar({ url: 'https://otro.example.org/app/' });
    expect(enviados[0].body).toContain('Abrí la app: https://otro.example.org/app/');
    expect(enviados[0].body).not.toContain('pozos.example.org');
    expect(global.getPwaUrl).not.toHaveBeenCalled();
    notificar({ propuestaId: 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee' });
    expect(enviados[2].body).toContain('Abrí la app: https://pozos.example.org/app/');
  });

  test('getPwaUrl falla: el aviso sale sin enlace', () => {
    global.getPwaUrl = jest.fn(() => { throw new Error('sin propiedad'); });
    expect(notificar().resultado).toBe('ENVIADO');
    expect(enviados[0].body).not.toMatch(/Abrí la app/);
  });

  test('un error inesperado (MailApp inexistente) no lanza', () => {
    delete global.MailApp;
    expect(() => notificar()).not.toThrow();
    expect(notificar({ propuestaId: 'dddddddd-4444-4444-8444-dddddddddddd' }).resultado).toBe('FALLO');
  });
});

describe('textos de auditoria (Historial: cantidades, nunca cuerpo ni direcciones)', () => {
  test.each([
    [{ resultado: 'ENVIADO', enviados: 1, destinatarios: 1 }, 'EMAIL_ENVIADO (1 destinatario)'],
    [{ resultado: 'ENVIADO', enviados: 2, destinatarios: 2 }, 'EMAIL_ENVIADO (2 destinatarios)'],
    [{ resultado: 'PARCIAL', enviados: 1, destinatarios: 3, sinCuota: false }, 'EMAIL_PARCIAL (1 de 3 enviados)'],
    [{ resultado: 'PARCIAL', enviados: 1, destinatarios: 3, sinCuota: true }, 'EMAIL_PARCIAL (1 de 3 enviados, cuota diaria agotada)'],
    [{ resultado: 'FALLO', enviados: 0, destinatarios: 2, sinCuota: false }, 'EMAIL_FALLO (0 de 2 enviados)'],
    [{ resultado: 'FALLO', enviados: 0, destinatarios: 2, sinCuota: true }, 'EMAIL_FALLO (0 de 2 enviados, cuota diaria agotada)'],
    [{ resultado: 'SIN_DESTINATARIOS' }, 'EMAIL_SIN_DESTINATARIOS'],
    [{ resultado: 'ERROR' }, 'EMAIL_ERROR'],
    [{ resultado: 'DEDUPED' }, null],
    [{ resultado: 'NO_APLICA' }, null],
    [null, null],
    [undefined, null]
  ])('%j -> %j', (resumen, esperado) => {
    expect(N.propuestaNotificacion_textoAuditoria(resumen)).toBe(esperado);
  });
});

describe('diagnosticoPropuestasItfEmail (editor): informa y NO envia', () => {
  test('muestra cuota, URL y cantidad de validadores con direcciones enmascaradas, sin enviar nada', () => {
    usuarios = [{ email: 'valeria@example.com', nombre: 'Valeria' }];
    N.diagnosticoPropuestasItfEmail();
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toContain('Cuota diaria restante de MailApp: 100');
    expect(log).toContain('PWA_URL: https://pozos.example.org/app/');
    expect(log).toContain('perfil_validar=SI): 1');
    expect(log).toContain('v***@example.com');
    expect(log).not.toContain('valeria@example.com');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(pedidoPermisos).toEqual([['perfil', 'perfil_validar']]);
  });
});
