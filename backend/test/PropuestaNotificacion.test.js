// Aviso por email REUTILIZABLE de una propuesta pendiente de validacion (PropuestaNotificacion.js) con su OUTBOX persistente (hoja PropuestaNotificaciones): permisos configurables sin nada implicito, contenido
// seguro, una sola notificacion por (tipo, propuestaId) garantizada por la hoja, reintentos que no duplican, best-effort (nunca lanza), cuota, verificacion de que la propuesta sigue pendiente y procesamiento
// de pendientes. Nada manda emails reales: MailApp, la hoja de Usuarios, las hojas, el lock y la hora son falsos.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let N;
let R;
let hojas;
let enviados;
let cuota;
let usuarios;
let pedidoPermisos;
let ahoraMs;
let eventosItf;
let e9;
let dateNow;

const T0 = Date.parse('2026-11-03T17:05:00.000Z');
const LEASE = 300000;
const NOMBRE = 'PropuestaNotificaciones';
const ID = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID2 = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const propuesta = (extra) => Object.assign({
  tipo: 'ITF',
  wellId: '14-0130',
  propuestaId: ID,
  proponente: { email: 'ana@example.com', nombre: 'Ana Proponente' },
  timestamp: '2026-11-03T17:00:00.000Z'
}, extra || {});
const notificar = (extra) => N.propuestaNotificacion_notificar(propuesta(extra));
const outbox = () => R.propuestaNotificacionesRepository_leerTodas();
const avanzar = (ms) => { ahoraMs += ms; };
const log = () => global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
const destinatarios = () => enviados.map((m) => m.to);

function montar(opciones) {
  const o = opciones || {};
  jest.resetModules();
  installAppsScriptFakes();
  R = require('../src/PropuestaNotificacionesRepository');
  N = require('../src/PropuestaNotificacion');
  hojas = instalarSheetsFalsos(o.sinOutbox ? {} : { [NOMBRE]: [R.PROPUESTA_NOTIF_COLUMNAS] });
  Object.assign(global, R);
  enviados = [];
  pedidoPermisos = [];
  ahoraMs = T0;
  e9 = true;
  eventosItf = [{ evento: 'ITF_PROPUESTO', documentoId: ID }, { evento: 'ITF_PROPUESTO', documentoId: ID2 }];
  cuota = { restante: 100, falla: false, falloEnvio: null };
  usuarios = [{ email: 'val1@example.com', nombre: 'Valeria' }, { email: 'val2@example.com', nombre: 'Vero' }];
  global.sheetUserRepository_listarConPermisos = jest.fn((permisos) => { pedidoPermisos.push(permisos); return usuarios; });
  global.itfService_e9Activo = jest.fn(() => e9);
  global.itfEventosRepository_listarPorDocumento = jest.fn((id) => ({ eventos: eventosItf.filter((e) => e.documentoId === id) }));
  global.getPwaUrl = jest.fn(() => 'https://pozos.example.org/app/');
  global.MailApp = {
    sendEmail: jest.fn((m) => { if (cuota.falloEnvio && cuota.falloEnvio(m)) { throw new Error('rechazado ' + m.to); } enviados.push(m); }),
    getRemainingDailyQuota: jest.fn(() => { if (cuota.falla) { throw new Error('sin cuota'); } return cuota.restante; })
  };
  global.Logger = { log: jest.fn() };
  const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
  global.LockService = { getScriptLock: () => lock };
  let uuid = 0;
  global.Utilities.getUuid = () => { uuid += 1; return '00000000-0000-4000-8000-' + String(uuid).padStart(12, '0'); };
  // Utilities.formatDate de Apps Script (hora de Mendoza = UTC-3): dd/MM/yyyy HH:mm
  global.Utilities.formatDate = (d) => {
    const x = new Date(d.getTime() - 3 * 3600 * 1000);
    const p2 = (n) => String(n).padStart(2, '0');
    return p2(x.getUTCDate()) + '/' + p2(x.getUTCMonth() + 1) + '/' + x.getUTCFullYear() + ' ' + p2(x.getUTCHours()) + ':' + p2(x.getUTCMinutes());
  };
  if (dateNow) { dateNow.mockRestore(); }
  dateNow = jest.spyOn(Date, 'now').mockImplementation(() => ahoraMs);
}

beforeEach(() => montar());
afterEach(() => { if (dateNow) { dateNow.mockRestore(); dateNow = null; } });

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
      'Fecha y hora: 03/11/2026 14:00',
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
});

// Hojas de Usuarios simuladas, filtradas con la funcion REAL del repositorio (para demostrar que NO se agrega ningun permiso por detras).
describe('1. permisos configurables: se evalua EXACTAMENTE lo que pide el tipo, sin nada implicito', () => {
  const ENC = ['email', 'nombre', 'estado', 'perfil', 'perfil_validar', 'ubicacion_validar', 'fotos_moderar'];
  const USU = [
    ENC,
    ['solo-ubicacion@example.com', 'Solo Ubicacion', 'activo', 'NO', 'NO', 'SI', 'NO'],
    ['ubicacion-y-perfil@example.com', 'Ubic y Perfil', 'activo', 'SI', 'NO', 'SI', 'NO'],
    ['solo-fotos@example.com', 'Solo Fotos', 'activo', 'NO', 'NO', 'NO', 'SI'],
    ['perfil-sin-nada@example.com', 'Perfil Sin Nada', 'activo', 'SI', 'NO', 'NO', 'NO'],
    ['itf-completo@example.com', 'Validador ITF', 'activo', 'SI', 'SI', 'NO', 'NO'],
    ['solo-validar@example.com', 'Solo Validar', 'activo', 'NO', 'SI', 'NO', 'NO'],
    ['inactivo-ubicacion@example.com', 'Inactivo', 'inactivo', 'NO', 'NO', 'SI', 'NO']
  ];

  beforeEach(() => {
    global.sheetUserRepository_listarConPermisos = jest.fn((permisos) => { pedidoPermisos.push(permisos); return require('../src/SheetUserRepository').sheetUserRepository_filtrarConPermisos(USU, permisos); });
    N.PROPUESTA_TIPOS.UBIC = { titulo: 'Nueva propuesta de ubicación', intro: 'Hay una ubicación pendiente.', etiquetaTipo: 'Ubicación', lugarRevision: 'Ubicaciones pendientes', permisosValidador: ['ubicacion_validar'], incluirProponente: true };
    N.PROPUESTA_TIPOS.FOTO = { titulo: 'Nueva propuesta de foto', intro: 'Hay una foto pendiente.', etiquetaTipo: 'Foto', lugarRevision: 'Fotos pendientes', permisosValidador: ['fotos_moderar'], incluirProponente: true };
  });

  test('un tipo que pide SOLO ["ubicacion_validar"] avisa a quien lo tiene, aunque NO tenga perfil, y a nadie mas', () => {
    expect(notificar({ tipo: 'UBIC' }).resultado).toBe('ENVIADO');
    expect(pedidoPermisos).toEqual([['ubicacion_validar']]);
    expect(destinatarios().sort()).toEqual(['solo-ubicacion@example.com', 'ubicacion-y-perfil@example.com']);
    expect(destinatarios()).not.toContain('perfil-sin-nada@example.com');
    expect(destinatarios()).not.toContain('itf-completo@example.com');
    expect(destinatarios()).not.toContain('inactivo-ubicacion@example.com');
  });

  test('un tipo que pide SOLO ["fotos_moderar"] avisa a quien lo tiene (sin perfil)', () => {
    expect(notificar({ tipo: 'FOTO' }).resultado).toBe('ENVIADO');
    expect(pedidoPermisos).toEqual([['fotos_moderar']]);
    expect(destinatarios()).toEqual(['solo-fotos@example.com']);
  });

  test('NINGUN permiso implicito: la lista pedida es identica a la configurada (no se agrega "perfil" ni nada)', () => {
    [['UBIC', 'p0'], ['FOTO', 'p1'], ['ITF', ID]].forEach(([tipo, propuestaId], i) => {
      notificar({ tipo, propuestaId });
      expect(pedidoPermisos[i]).toEqual(N.PROPUESTA_TIPOS[tipo].permisosValidador);
    });
    expect(pedidoPermisos[0]).not.toContain('perfil');
    expect(pedidoPermisos[1]).not.toContain('perfil');
  });

  test('ITF requiere los dos permisos definidos explicitamente: perfil Y perfil_validar (uno solo no alcanza)', () => {
    expect(N.PROPUESTA_TIPOS.ITF.permisosValidador).toEqual(['perfil', 'perfil_validar']);
    notificar();
    expect(destinatarios()).toEqual(['itf-completo@example.com']);
    expect(destinatarios()).not.toContain('solo-validar@example.com');
    expect(destinatarios()).not.toContain('perfil-sin-nada@example.com');
  });

  test('el permiso del pedido (permisosValidador) pisa el del tipo y tambien se evalua tal cual', () => {
    notificar({ tipo: 'FOTO', permisosValidador: ['ubicacion_validar', 'perfil'] });
    expect(pedidoPermisos).toEqual([['ubicacion_validar', 'perfil']]);
    expect(destinatarios()).toEqual(['ubicacion-y-perfil@example.com']);
  });

  test('un tipo sin permisos configurados NO avisa a nadie (no hay un "por defecto" que difunda a todos) y no crea fila', () => {
    N.PROPUESTA_TIPOS.SIN_PERMISOS = { titulo: 'x', intro: 'x', etiquetaTipo: 'x', lugarRevision: 'x', incluirProponente: true };
    N.PROPUESTA_TIPOS.VACIO = { titulo: 'x', intro: 'x', etiquetaTipo: 'x', lugarRevision: 'x', permisosValidador: [], incluirProponente: true };
    expect(notificar({ tipo: 'SIN_PERMISOS' }).resultado).toBe('NO_APLICA');
    expect(notificar({ tipo: 'VACIO' }).resultado).toBe('NO_APLICA');
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(0);
    expect(outbox()).toHaveLength(0);
  });

  test('el diagnostico tambien usa los permisos del tipo, no un texto fijo', () => {
    N.diagnosticoPropuestasItfEmail();
    expect(log()).toContain('con perfil y perfil_validar = SI): 1');
  });
});

describe('que se avisa y a quien (destinatarios)', () => {
  test('dos validadores: ambos reciben su propio email (uno por destinatario, sin ver al otro)', () => {
    const r = notificar();
    expect(r).toEqual({ resultado: 'ENVIADO', destinatarios: 2, enviados: 2, fallidos: 0, sinCuota: false });
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
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
    expect(destinatarios()).toEqual(['val1@example.com']);
  });

  test('emails de forma invalida o vacios se descartan (nunca se confia en la hoja para armar encabezados)', () => {
    usuarios = [{ email: 'sin-arroba', nombre: 'A' }, { email: '', nombre: 'B' }, { email: 'a@b', nombre: 'C' }, { email: 'dos@example.com,tres@example.com', nombre: 'D' }, { email: 'x@example.com\nBcc: y@example.com', nombre: 'E' }, { email: null, nombre: 'F' }, { email: 'ok@example.com', nombre: 'G' }];
    notificar();
    expect(destinatarios()).toEqual(['ok@example.com']);
  });

  test('el proponente tambien validador RECIBE el aviso (decision de ITF: comportamiento simple y consistente)', () => {
    usuarios = [{ email: 'ana@example.com', nombre: 'Ana Proponente' }, { email: 'val1@example.com', nombre: 'Valeria' }];
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', destinatarios: 2, enviados: 2 });
    expect(destinatarios()).toEqual(['ana@example.com', 'val1@example.com']);
  });

  test('un tipo que pida excluir al proponente (incluirProponente: false) NO se lo manda, tampoco en un reintento desde la hoja', () => {
    N.PROPUESTA_TIPOS.PRUEBA = { titulo: 'Nueva propuesta de prueba', intro: 'Hay algo.', etiquetaTipo: 'Prueba', lugarRevision: 'Pendientes', permisosValidador: ['prueba_validar'], incluirProponente: false };
    usuarios = [{ email: 'ANA@example.com', nombre: 'Ana' }, { email: 'val1@example.com', nombre: 'Valeria' }];
    cuota.falloEnvio = () => true;
    expect(notificar({ tipo: 'PRUEBA' })).toMatchObject({ resultado: 'FALLO', destinatarios: 1 });
    cuota.falloEnvio = null;
    avanzar(LEASE);
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ enviadas: 1 });
    expect(destinatarios()).toEqual(['val1@example.com']);
  });

  test('cero validadores: SIN_DESTINATARIOS, no se envia nada, no lanza y el aviso queda reintentable', () => {
    usuarios = [];
    expect(notificar()).toEqual({ resultado: 'SIN_DESTINATARIOS', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'SIN_DESTINATARIOS' });
  });

  test('si despues aparece un validador, el reintento lo avisa', () => {
    usuarios = [];
    notificar();
    usuarios = [{ email: 'nuevo@example.com', nombre: 'Nuevo' }];
    avanzar(LEASE);
    expect(N.propuestaNotificacion_procesarPendientes().enviadas).toBe(1);
    expect(destinatarios()).toEqual(['nuevo@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 2, ultimoError: '' });
  });

  test('la lectura de Usuarios falla: no se envia nada, no lanza, queda ERROR reintentable y el log no trae direcciones', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios" (ana@example.com)'); });
    expect(notificar().resultado).toBe('ERROR');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'LECTURA_USUARIOS' });
    expect(log()).not.toContain('ana@example.com');
  });
});

describe('fail-closed: pedidos que no se pueden atender NO avisan a nadie ni crean fila', () => {
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
  ])('%s -> NO_APLICA, sin consultar usuarios ni enviar ni escribir', (nombre, extra) => {
    expect(notificar(extra)).toEqual({ resultado: 'NO_APLICA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(0);
  });

  test.each([null, undefined, 'x', 5, []])('un pedido que no es un objeto (%j) no lanza', (p) => {
    expect(() => N.propuestaNotificacion_notificar(p)).not.toThrow();
    expect(N.propuestaNotificacion_notificar(p).resultado).toBe('NO_APLICA');
  });
});

describe('outbox: el aviso se REGISTRA antes de intentar enviarlo', () => {
  test('queda UNA fila con lo necesario y nada de lo prohibido (ni cuerpo, ni ids tecnicos, ni emails de validadores)', () => {
    notificar();
    const filas = hojas[NOMBRE].filas;
    expect(filas).toHaveLength(2);
    const o = outbox()[0];
    expect(o).toMatchObject({
      tipo: 'ITF', propuestaId: ID, wellId: '14-0130', permisosValidador: 'perfil,perfil_validar', proponenteNombre: 'Ana Proponente', proponenteEmail: 'ana@example.com',
      propuestaTimestampUtc: '2026-11-03T17:00:00.000Z', estado: 'ENVIADA', intentos: 1, creadoUtc: new Date(T0).toISOString(), ultimoIntentoUtc: new Date(T0).toISOString(), enviadoUtc: new Date(T0).toISOString(), ultimoError: ''
    });
    expect(o.destinatariosEnviados).toBe('val1@example.com;val2@example.com');
    const todo = JSON.stringify(filas.slice(1));
    expect(todo).not.toMatch(/Hay una nueva propuesta|Estado: pendiente|Abrí la app|sha|storage|clientRequest|base64/i);
  });

  test('ORDEN: cuando se envia el primer email la fila YA esta en la hoja (PENDIENTE, con el intento reservado)', () => {
    const vistos = [];
    global.MailApp.sendEmail.mockImplementation((m) => { vistos.push(outbox().map((x) => ({ estado: x.estado, intentos: x.intentos }))); enviados.push(m); });
    notificar();
    expect(vistos).toEqual([[{ estado: 'PENDIENTE', intentos: 1 }], [{ estado: 'PENDIENTE', intentos: 1 }]]);
  });

  test('una timestamp ilegible se guarda vacia (el email sale sin linea de fecha)', () => {
    notificar({ timestamp: 'no es fecha' });
    expect(outbox()[0].propuestaTimestampUtc).toBe('');
    expect(enviados[0].body).not.toMatch(/Fecha y hora/);
  });

  test('sin la hoja del outbox (setup todavia no corrido): OUTBOX_NO_DISPONIBLE, no se envia nada, no lanza, la hoja NO se crea sola y el log no trae direcciones', () => {
    montar({ sinOutbox: true });
    expect(() => notificar()).not.toThrow();
    expect(notificar().resultado).toBe('OUTBOX_NO_DISPONIBLE');
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(hojas[NOMBRE]).toBeUndefined();
    expect(log()).toContain('outbox');
  });

  test('con la hoja del outbox mal armada: tambien OUTBOX_NO_DISPONIBLE, sin enviar', () => {
    hojas[NOMBRE].filas[0] = ['notificacionId', 'tipo'];
    expect(notificar().resultado).toBe('OUTBOX_NO_DISPONIBLE');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('si no se consigue el lock: OUTBOX_NO_DISPONIBLE, no se envia (preferible a duplicar)', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout'); }, releaseLock: jest.fn() }) };
    expect(notificar().resultado).toBe('OUTBOX_NO_DISPONIBLE');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });
});

describe('6/7/8. idempotencia PERSISTENTE (la garantia es la hoja, no el cache)', () => {
  test('mismo tipo + propuestaId -> UNA sola fila, aunque se notifique varias veces', () => {
    notificar();
    notificar();
    notificar();
    expect(outbox()).toHaveLength(1);
    expect(hojas[NOMBRE].filas).toHaveLength(2);
  });

  test('reprocesar una ENVIADA NO duplica el email (ni consulta usuarios)', () => {
    expect(notificar().resultado).toBe('ENVIADO');
    global.sheetUserRepository_listarConPermisos.mockClear();
    global.MailApp.sendEmail.mockClear();
    expect(notificar()).toEqual({ resultado: 'YA_ENVIADA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false });
    avanzar(10 * LEASE);
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 0, enviadas: 0 });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(2);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 1 });
  });

  test('NO depende de CacheService: con el cache caido o vacio igual no duplica, y el cache no se usa', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('cache caido'); } };
    expect(notificar().resultado).toBe('ENVIADO');
    expect(notificar().resultado).toBe('YA_ENVIADA');
    expect(enviados).toHaveLength(2);
  });

  test('la idempotencia sobrevive a "otra ejecucion" (modulos recargados, sin memoria compartida): la hoja manda', () => {
    notificar();
    const hojaViva = hojas[NOMBRE].filas.map((f) => f.slice());
    const mails = enviados.length;
    jest.resetModules();
    installAppsScriptFakes();
    R = require('../src/PropuestaNotificacionesRepository');
    N = require('../src/PropuestaNotificacion');
    hojas = instalarSheetsFalsos({ [NOMBRE]: hojaViva });
    Object.assign(global, R);
    global.itfService_e9Activo = jest.fn(() => true);
    global.itfEventosRepository_listarPorDocumento = jest.fn(() => ({ eventos: [{ evento: 'ITF_PROPUESTO', documentoId: ID }] }));
    global.sheetUserRepository_listarConPermisos = jest.fn(() => usuarios);
    global.MailApp = { sendEmail: jest.fn(), getRemainingDailyQuota: jest.fn(() => 100) };
    global.Logger = { log: jest.fn() };
    global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
    expect(N.propuestaNotificacion_notificar(propuesta()).resultado).toBe('YA_ENVIADA');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(mails);
  });

  test('dos propuestas DISTINTAS del mismo pozo -> dos notificaciones (dos filas, un email por validador de cada una)', () => {
    notificar({ propuestaId: ID });
    notificar({ propuestaId: ID2 });
    expect(outbox().map((o) => o.propuestaId)).toEqual([ID, ID2]);
    expect(outbox().every((o) => o.wellId === '14-0130' && o.estado === 'ENVIADA')).toBe(true);
    expect(enviados).toHaveLength(4);
  });

  test('el mismo propuestaId en dos TIPOS distintos son dos notificaciones distintas', () => {
    N.PROPUESTA_TIPOS.FOTO = { titulo: 'Nueva propuesta de foto', intro: 'Hay una foto pendiente.', etiquetaTipo: 'Foto', lugarRevision: 'Fotos pendientes', permisosValidador: ['fotos', 'fotos_moderar'], incluirProponente: true };
    expect(notificar({ tipo: 'ITF' }).resultado).toBe('ENVIADO');
    expect(notificar({ tipo: 'FOTO' }).resultado).toBe('ENVIADO');
    expect(notificar({ tipo: 'FOTO' }).resultado).toBe('YA_ENVIADA');
    expect(outbox().map((o) => o.tipo)).toEqual(['ITF', 'FOTO']);
    expect(enviados).toHaveLength(4);
    expect(enviados[2].subject).toBe('DGI Pozos | Nueva propuesta de foto | 14-0130');
  });

  test('una fila OMITIDA tampoco se reenvia ni se reabre', () => {
    eventosItf = [{ evento: 'ITF_PROPUESTO', documentoId: ID }, { evento: 'ITF_APROBADO', documentoId: ID }];
    expect(notificar().resultado).toBe('OMITIDA');
    eventosItf = [{ evento: 'ITF_PROPUESTO', documentoId: ID }];
    expect(notificar().resultado).toBe('OMITIDA');
    expect(enviados).toHaveLength(0);
  });
});

describe('4/5/9. fallos y reintentos: el aviso no desaparece', () => {
  test('MailApp rechaza todo: queda ERROR reintentable con el intento contado, sin cuerpo ni direcciones; no lanza', () => {
    cuota.falloEnvio = () => true;
    expect(() => notificar()).not.toThrow();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'FALLO (0 de 2 enviados)', enviadoUtc: '', destinatariosEnviados: '' });
    expect(log()).not.toContain('@example.com');
  });

  test('retry posterior: envia y pasa a ENVIADA (intentos 2, error limpio, enviadoUtc)', () => {
    cuota.falloEnvio = () => true;
    notificar();
    cuota.falloEnvio = null;
    avanzar(LEASE);
    const r = N.propuestaNotificacion_procesarPendientes();
    expect(r).toEqual({ revisadas: 1, enviadas: 1, omitidas: 0, enEspera: 0, errores: 0, fallo: false });
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 2, ultimoError: '', enviadoUtc: new Date(T0 + LEASE).toISOString(), ultimoIntentoUtc: new Date(T0 + LEASE).toISOString() });
  });

  test('NO se reintenta mientras otro intento esta en curso (lease de 5 min) y se informa EN_CURSO', () => {
    cuota.falloEnvio = () => true;
    notificar();
    cuota.falloEnvio = null;
    avanzar(LEASE - 1);
    expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(0);
    expect(notificar().resultado).toBe('EN_CURSO');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0].intentos).toBe(1);
  });

  test('parcial: falla UN destinatario -> ERROR con los enviados guardados; el reintento manda SOLO al que faltaba (nadie recibe dos veces)', () => {
    cuota.falloEnvio = (m) => m.to === 'val1@example.com';
    expect(notificar()).toMatchObject({ resultado: 'PARCIAL', destinatarios: 2, enviados: 1, fallidos: 1 });
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'PARCIAL (1 de 2 enviados)', destinatariosEnviados: 'val2@example.com' });
    expect(destinatarios()).toEqual(['val2@example.com']);
    cuota.falloEnvio = null;
    avanzar(LEASE);
    expect(N.propuestaNotificacion_procesarPendientes().enviadas).toBe(1);
    expect(destinatarios()).toEqual(['val2@example.com', 'val1@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', ultimoError: '', destinatariosEnviados: 'val2@example.com;val1@example.com' });
  });

  test('cuota insuficiente: no se pasa de lo disponible, queda ERROR con la causa y el dia siguiente completa solo los que faltan', () => {
    cuota.restante = 1;
    expect(notificar()).toMatchObject({ resultado: 'PARCIAL', enviados: 1, fallidos: 1, sinCuota: true });
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'PARCIAL (1 de 2 enviados, cuota diaria agotada)' });
    cuota.restante = 100;
    avanzar(LEASE);
    N.propuestaNotificacion_procesarPendientes();
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(outbox()[0].estado).toBe('ENVIADA');
  });

  test('la cuota del reintento se mide contra los que FALTAN, no contra todos: con 1 de cuota y 1 pendiente completa sin marcar cuota agotada', () => {
    cuota.falloEnvio = (m) => m.to === 'val1@example.com';
    notificar();
    cuota.falloEnvio = null;
    cuota.restante = 1;
    avanzar(LEASE);
    expect(N.propuestaNotificacion_entregar(outbox()[0])).toEqual({ resultado: 'ENVIADO', destinatarios: 2, enviados: 1, fallidos: 0, sinCuota: false });
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', ultimoError: '' });
  });

  test('cuota agotada (0): FALLO sin intentar enviar', () => {
    cuota.restante = 0;
    expect(notificar()).toMatchObject({ resultado: 'FALLO', enviados: 0, fallidos: 2, sinCuota: true });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0].ultimoError).toBe('FALLO (0 de 2 enviados, cuota diaria agotada)');
  });

  test('no se puede consultar la cuota: se intenta igual', () => {
    cuota.falla = true;
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', enviados: 2, sinCuota: false });
  });

  test('MailApp sin getRemainingDailyQuota: se intenta igual', () => {
    delete global.MailApp.getRemainingDailyQuota;
    expect(notificar().resultado).toBe('ENVIADO');
  });

  test('getPwaUrl falla: el aviso sale sin enlace', () => {
    global.getPwaUrl = jest.fn(() => { throw new Error('sin propiedad'); });
    expect(notificar().resultado).toBe('ENVIADO');
    expect(enviados[0].body).not.toMatch(/Abrí la app/);
  });

  test('un error inesperado (MailApp inexistente) no lanza y deja el aviso reintentable', () => {
    delete global.MailApp;
    expect(() => notificar()).not.toThrow();
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1 });
  });

  test('ya todos lo habian recibido pero no se llego a guardar ENVIADA (murio antes): el reintento NO manda nada y la marca ENVIADA', () => {
    notificar();
    const fila = hojas[NOMBRE].filas[1];
    fila[R.PROPUESTA_NOTIF_COLUMNAS.indexOf('estado')] = 'ERROR';
    fila[R.PROPUESTA_NOTIF_COLUMNAS.indexOf('enviadoUtc')] = '';
    enviados.length = 0;
    global.MailApp.sendEmail.mockClear();
    avanzar(LEASE);
    expect(N.propuestaNotificacion_procesarPendientes().enviadas).toBe(1);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0].estado).toBe('ENVIADA');
  });

  test('un validador que se suma DESPUES del envio completo no genera un segundo aviso a los demas (la fila ya esta ENVIADA)', () => {
    notificar();
    usuarios = usuarios.concat([{ email: 'tarde@example.com', nombre: 'Tarde' }]);
    avanzar(10 * LEASE);
    N.propuestaNotificacion_procesarPendientes();
    expect(enviados).toHaveLength(2);
  });

  test('si no se puede GUARDAR el resultado tras enviar: no lanza, el resumen dice lo que paso y el log no trae direcciones', () => {
    global.propuestaNotificacionesRepository_registrarResultado = jest.fn(() => { throw new Error('hoja caida para ana@example.com'); });
    expect(notificar()).toMatchObject({ resultado: 'ENVIADO', enviados: 2 });
    expect(log()).toContain('no se pudo guardar');
    expect(log()).not.toContain('ana@example.com');
  });

  test('el limite de intentos: tras 5 intentos fallidos no se reintenta mas (AGOTADA) y no se envia', () => {
    cuota.falloEnvio = () => true;
    notificar();
    for (let i = 1; i < R.PROPUESTA_NOTIF_MAX_INTENTOS; i += 1) {
      avanzar(LEASE);
      expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(1);
    }
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: R.PROPUESTA_NOTIF_MAX_INTENTOS });
    cuota.falloEnvio = null;
    avanzar(10 * LEASE);
    expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(0);
    expect(notificar().resultado).toBe('AGOTADA');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0].intentos).toBe(R.PROPUESTA_NOTIF_MAX_INTENTOS);
  });
});

describe('verificar: el aviso solo corresponde mientras la propuesta SIGUE pendiente', () => {
  test.each([['aprobada', 'ITF_APROBADO'], ['rechazada', 'ITF_RECHAZADO'], ['retirada', 'ITF_RETIRADO']])('propuesta %s antes del reintento -> OMITIDA (YA_NO_PENDIENTE), no se manda un «pendiente» falso', (nombre, evento) => {
    cuota.falloEnvio = () => true;
    notificar();
    cuota.falloEnvio = null;
    eventosItf.push({ evento, documentoId: ID });
    avanzar(LEASE);
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 1, omitidas: 1, enviadas: 0 });
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'OMITIDA', ultimoError: 'YA_NO_PENDIENTE', intentos: 1 });
    avanzar(10 * LEASE);
    expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(0);
  });

  test('el cierre de OTRO documento no afecta a este', () => {
    eventosItf.push({ evento: 'ITF_APROBADO', documentoId: ID2 });
    expect(notificar({ propuestaId: ID }).resultado).toBe('ENVIADO');
  });

  test('un cierre de OTRO documento que lo menciona como reemplazado (documentoReemplazadoId) tampoco cierra esta propuesta', () => {
    global.itfEventosRepository_listarPorDocumento = jest.fn(() => ({ eventos: [{ evento: 'ITF_PROPUESTO', documentoId: ID }, { evento: 'ITF_APROBADO', documentoId: ID2, documentoReemplazadoId: ID }] }));
    expect(notificar().resultado).toBe('ENVIADO');
  });

  test('sin evento ITF_PROPUESTO para ese documento: no se avisa (OMITIDA)', () => {
    eventosItf = [];
    expect(notificar().resultado).toBe('OMITIDA');
    expect(enviados).toHaveLength(0);
  });

  test('ITF_E9_ACTIVO apagado: el aviso ESPERA (nada cambia en la fila, no cuenta intento) y sale cuando se enciende', () => {
    e9 = false;
    expect(notificar().resultado).toBe('EN_ESPERA');
    expect(outbox()[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 1, enEspera: 1 });
    expect(enviados).toHaveLength(0);
    e9 = true;
    expect(N.propuestaNotificacion_procesarPendientes().enviadas).toBe(1);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 1 });
  });

  test('si no se puede leer ItfEventos: ERROR, no se envia, la fila queda como estaba y no lanza', () => {
    global.itfEventosRepository_listarPorDocumento = jest.fn(() => { throw new Error('hoja ItfEventos caida'); });
    expect(notificar().resultado).toBe('ERROR');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
  });

  test('un tipo sin verificar (el modulo no la necesita) avisa igual', () => {
    N.PROPUESTA_TIPOS.PRUEBA = { titulo: 'P', intro: 'P', etiquetaTipo: 'P', lugarRevision: 'P', permisosValidador: ['p_validar'], incluirProponente: true };
    expect(notificar({ tipo: 'PRUEBA' }).resultado).toBe('ENVIADO');
  });

  test('verificarItf: PENDIENTE solo con ITF_PROPUESTO y sin cierre; ESPERAR si el modulo esta apagado', () => {
    const v = (id) => N.propuestaNotificacion_verificarItf({ propuestaId: id });
    expect(v(ID)).toBe('PENDIENTE');
    eventosItf = [{ evento: 'ITF_PROPUESTO', documentoId: ID }, { evento: 'ITF_REVERTIDO', documentoId: ID }];
    expect(v(ID)).toBe('PENDIENTE');
    e9 = false;
    expect(v(ID)).toBe('ESPERAR');
  });
});

describe('datos de la fila invalidos: fail-closed', () => {
  const sembrar = (cambios) => {
    notificar();
    const fila = hojas[NOMBRE].filas[1];
    Object.keys(cambios).forEach((c) => { fila[R.PROPUESTA_NOTIF_COLUMNAS.indexOf(c)] = cambios[c]; });
    fila[R.PROPUESTA_NOTIF_COLUMNAS.indexOf('estado')] = 'ERROR';
    fila[R.PROPUESTA_NOTIF_COLUMNAS.indexOf('destinatariosEnviados')] = '';
    enviados.length = 0;
    global.sheetUserRepository_listarConPermisos.mockClear();
    global.MailApp.sendEmail.mockClear();
    avanzar(LEASE);
  };

  test.each([
    ['permisos vacios', { permisosValidador: '' }],
    ['permisos con algo raro', { permisosValidador: 'perfil,x y' }],
    ['tipo que ya no existe', { tipo: 'VIEJO' }],
    ['propuestaId roto', { propuestaId: 'a b' }]
  ])('%s -> OMITIDA (DATOS_INVALIDOS), sin consultar usuarios ni enviar', (nombre, cambios) => {
    sembrar(cambios);
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 1, omitidas: 1 });
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0]).toMatchObject({ estado: 'OMITIDA', ultimoError: 'DATOS_INVALIDOS' });
  });

  test('un estado desconocido en la fila no se toca ni se envia', () => {
    notificar();
    hojas[NOMBRE].filas[1][R.PROPUESTA_NOTIF_COLUMNAS.indexOf('estado')] = 'RARO';
    enviados.length = 0;
    expect(N.propuestaNotificacion_entregar(outbox()[0]).resultado).toBe('ERROR');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0].estado).toBe('RARO');
  });

  test('los permisos de la fila son los que se evaluan (los registrados), con espacios tolerados', () => {
    sembrar({ permisosValidador: ' perfil_validar , perfil ' });
    N.propuestaNotificacion_procesarPendientes();
    expect(pedidoPermisos[pedidoPermisos.length - 1]).toEqual(['perfil_validar', 'perfil']);
  });
});

describe('procesarPendientes: limite por corrida y una que falla no bloquea a las demas', () => {
  const sembrarN = (cantidad) => {
    eventosItf = [];
    for (let i = 0; i < cantidad; i += 1) { eventosItf.push({ evento: 'ITF_PROPUESTO', documentoId: 'prop-' + String(i).padStart(3, '0') }); }
    cuota.falloEnvio = () => true;
    for (let i = 0; i < cantidad; i += 1) { notificar({ propuestaId: 'prop-' + String(i).padStart(3, '0') }); }
    cuota.falloEnvio = null;
    avanzar(LEASE);
  };

  test('por defecto toma 10 por corrida, las mas viejas primero; el resto en la siguiente', () => {
    sembrarN(12);
    expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(10);
    expect(outbox().filter((o) => o.estado === 'ENVIADA').map((o) => o.propuestaId)).toEqual(Array.from({ length: 10 }, (_, i) => 'prop-' + String(i).padStart(3, '0')));
    expect(N.propuestaNotificacion_procesarPendientes().revisadas).toBe(2);
    expect(outbox().every((o) => o.estado === 'ENVIADA')).toBe(true);
  });

  test.each([[3, 3], [1, 1], [1000, 12], [0, 10], [-5, 10], [NaN, 10], ['5', 10], [undefined, 10], [2.9, 2]])('limite %j -> %j', (limite, esperadas) => {
    sembrarN(12);
    expect(N.propuestaNotificacion_procesarPendientes(limite).revisadas).toBe(esperadas);
  });

  test('el tope absoluto es 50 por corrida', () => {
    expect(N.PROPUESTA_NOTIF_LIMITE_MAXIMO).toBe(50);
    expect(N.PROPUESTA_NOTIF_LIMITE_POR_CORRIDA).toBe(10);
    sembrarN(55);
    expect(N.propuestaNotificacion_procesarPendientes(999).revisadas).toBe(50);
  });

  test('una notificacion que falla (MailApp) no frena a las otras: las demas salen y la que fallo queda ERROR', () => {
    sembrarN(3);
    cuota.falloEnvio = (m) => false;
    // la del medio falla siempre porque su pozo es otro y MailApp rechaza ese asunto
    const filas = hojas[NOMBRE].filas;
    filas[2][R.PROPUESTA_NOTIF_COLUMNAS.indexOf('wellId')] = '99-9999';
    cuota.falloEnvio = (m) => /99-9999/.test(m.subject);
    expect(N.propuestaNotificacion_procesarPendientes()).toEqual({ revisadas: 3, enviadas: 2, omitidas: 0, enEspera: 0, errores: 1, fallo: false });
    expect(outbox().map((o) => o.estado)).toEqual(['ENVIADA', 'ERROR', 'ENVIADA']);
  });

  test('una que revienta POR DENTRO (verificar lanza) no frena a las otras', () => {
    sembrarN(3);
    global.itfEventosRepository_listarPorDocumento = jest.fn((id) => { if (id === 'prop-001') { throw new Error('boom'); } return { eventos: [{ evento: 'ITF_PROPUESTO', documentoId: id }] }; });
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 3, enviadas: 2, errores: 1 });
    expect(outbox().map((o) => o.estado)).toEqual(['ENVIADA', 'ERROR', 'ENVIADA']);
  });

  test('si entregar llegara a lanzar, procesarPendientes lo contiene y sigue con la siguiente', () => {
    sembrarN(2);
    let n = 0;
    global.propuestaNotificacionesRepository_reservarIntento = jest.fn((id, ahora) => { n += 1; if (n === 1) { throw new Error('lock'); } return R.propuestaNotificacionesRepository_reservarIntento(id, ahora); });
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 2, enviadas: 1, errores: 1 });
  });

  test('si hasta el log falla dentro de una entrega (entregar lanza), procesarPendientes lo contiene y sigue con las demas', () => {
    sembrarN(2);
    global.itfEventosRepository_listarPorDocumento = jest.fn((id) => { if (id === 'prop-000') { throw new Error('boom'); } return { eventos: [{ evento: 'ITF_PROPUESTO', documentoId: id }] }; });
    global.Logger = { log: jest.fn(() => { throw new Error('logger caido'); }) };
    expect(N.propuestaNotificacion_procesarPendientes()).toMatchObject({ revisadas: 2, enviadas: 1, errores: 1 });
    expect(outbox().map((o) => o.estado)).toEqual(['ERROR', 'ENVIADA']);
  });

  test('sin hoja de outbox: fallo=true, no lanza y no envia', () => {
    montar({ sinOutbox: true });
    expect(N.propuestaNotificacion_procesarPendientes()).toEqual({ revisadas: 0, enviadas: 0, omitidas: 0, enEspera: 0, errores: 0, fallo: true });
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('dos corridas seguidas (simulan dos triggers) no envian dos veces: la segunda ve el intento en curso', () => {
    cuota.falloEnvio = () => true;
    notificar();
    cuota.falloEnvio = null;
    avanzar(LEASE);
    // la "otra ejecucion" ya reservo el intento: esta ve la fila desactualizada que leyo antes
    const vieja = outbox()[0];
    expect(N.propuestaNotificacion_procesarPendientes().enviadas).toBe(1);
    enviados.length = 0;
    expect(N.propuestaNotificacion_entregar(vieja).resultado).toBe('YA_ENVIADA');
    expect(enviados).toHaveLength(0);
  });

  test('la fila leida antes de que otra ejecucion reserve el intento: la reserva (bajo lock) lo detecta y NO envia', () => {
    cuota.falloEnvio = () => true;
    notificar();
    cuota.falloEnvio = null;
    avanzar(LEASE);
    const vieja = outbox()[0];
    expect(R.propuestaNotificacionesRepository_reservarIntento(vieja.notificacionId, ahoraMs).reservada).toBe(true);
    expect(N.propuestaNotificacion_entregar(vieja).resultado).toBe('EN_CURSO');
    expect(enviados).toHaveLength(0);
  });

  test('procesarNotificacionesPropuestasPendientes (la funcion lista para un trigger): devuelve el resumen y lo deja en el log', () => {
    sembrarN(2);
    const r = N.procesarNotificacionesPropuestasPendientes();
    expect(r).toMatchObject({ revisadas: 2, enviadas: 2 });
    expect(log()).toContain('Avisos de propuestas pendientes: revisadas 2, enviadas 2, omitidas 0, en espera 0, con error 0.');
  });

  test('sin outbox deja constancia en el log y no lanza', () => {
    montar({ sinOutbox: true });
    expect(() => N.procesarNotificacionesPropuestasPendientes()).not.toThrow();
    expect(log()).toContain('no se pudo leer el outbox');
  });
});

describe('best-effort total: el subsistema de avisos NUNCA lanza, ni siquiera cuando falla el log o el texto del error es ilegible', () => {
  const logCaido = () => { global.Logger = { log: jest.fn(() => { throw new Error('logger caido'); }) }; };

  test('notificar con el outbox roto y el log caido: devuelve OUTBOX_NO_DISPONIBLE sin lanzar', () => {
    global.propuestaNotificacionesRepository_asegurar = jest.fn(() => { throw new Error('hoja inaccesible'); });
    logCaido();
    expect(() => notificar()).not.toThrow();
    expect(notificar().resultado).toBe('OUTBOX_NO_DISPONIBLE');
    expect(enviados).toHaveLength(0);
  });

  test('notificar con Usuarios ilegible, MailApp caido y el log caido: queda ERROR en la hoja y no lanza', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('sin Usuarios'); });
    logCaido();
    expect(notificar().resultado).toBe('ERROR');
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'LECTURA_USUARIOS' });
  });

  test('un fallo de MailApp con el log caido: el intento se cuenta y queda reintentable', () => {
    cuota.falloEnvio = () => true;
    logCaido();
    expect(notificar().resultado).toBe('FALLO');
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'FALLO (0 de 2 enviados)' });
  });

  test('registrarResultado lanza y el log tambien: ni entregar ni notificar lanzan; la fila no se pierde', () => {
    global.propuestaNotificacionesRepository_registrarResultado = jest.fn(() => { throw new Error('la hoja ya no existe'); });
    logCaido();
    expect(() => notificar()).not.toThrow();
    expect(outbox()).toHaveLength(1);
    expect(enviados).toHaveLength(2);
  });

  test('un estado desconocido en la fila con el log caido: entregar no lanza y no toca la fila', () => {
    notificar({ propuestaId: ID2 });
    logCaido();
    const fila = Object.assign({}, outbox()[0], { estado: 'RARO' });
    expect(() => N.propuestaNotificacion_entregar(fila)).not.toThrow();
    expect(N.propuestaNotificacion_entregar(fila).resultado).toBe('ERROR');
  });

  test('un error inesperado FUERA de los pasos controlados (fila nula) no sale de entregar: resultado ERROR', () => {
    expect(() => N.propuestaNotificacion_entregar(null)).not.toThrow();
    expect(N.propuestaNotificacion_entregar(null).resultado).toBe('ERROR');
    expect(log()).toContain('error inesperado');
  });

  test('un error inesperado al leer el pedido (propiedad que lanza) no sale de notificar: resultado ERROR, sin fila ni email', () => {
    const hostil = { get tipo() { throw new Error('getter hostil'); } };
    expect(() => N.propuestaNotificacion_notificar(hostil)).not.toThrow();
    expect(N.propuestaNotificacion_notificar(hostil).resultado).toBe('ERROR');
    expect(outbox()).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  test('propuestaNotificacion_errorSeguro con un error cuyo mensaje no se puede leer: devuelve un texto fijo y no lanza', () => {
    const raro = { get message() { throw new Error('ilegible'); }, toString() { throw new Error('ilegible'); } };
    expect(N.propuestaNotificacion_errorSeguro(raro)).toBe('error sin detalle');
  });

  test('propuestaNotificacion_errorSeguro sigue enmascarando emails y acotando a 160 caracteres', () => {
    expect(N.propuestaNotificacion_errorSeguro(new Error('fallo con ana@example.com'))).toBe('fallo con <email>');
    expect(N.propuestaNotificacion_errorSeguro(new Error('x'.repeat(500)))).toHaveLength(160);
  });
});

describe('diagnosticoPropuestasItfEmail (editor): informa y NO envia ni escribe', () => {
  test('muestra cuota, URL, validadores enmascarados y el estado del outbox', () => {
    usuarios = [{ email: 'valeria@example.com', nombre: 'Valeria' }];
    notificar();
    avanzar(1);
    const antes = JSON.stringify(hojas[NOMBRE].filas);
    global.MailApp.sendEmail.mockClear();
    pedidoPermisos.length = 0;
    N.diagnosticoPropuestasItfEmail();
    expect(log()).toContain('Cuota diaria restante de MailApp: 100');
    expect(log()).toContain('PWA_URL: https://pozos.example.org/app/');
    expect(log()).toContain('perfil_validar = SI): 1');
    expect(log()).toContain('v***@example.com');
    expect(log()).not.toContain('valeria@example.com');
    expect(log()).toContain('Outbox PropuestaNotificaciones: PENDIENTE 0, ENVIADA 1, ERROR 0, OMITIDA 0');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(JSON.stringify(hojas[NOMBRE].filas)).toBe(antes);
    expect(pedidoPermisos).toEqual([['perfil', 'perfil_validar']]);
  });

  test('sin hoja de outbox el diagnostico igual termina e informa', () => {
    montar({ sinOutbox: true });
    expect(() => N.diagnosticoPropuestasItfEmail()).not.toThrow();
    expect(log()).toContain('Outbox PropuestaNotificaciones: No existe una hoja');
  });
});
