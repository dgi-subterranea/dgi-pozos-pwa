// Aviso por email a los validadores al PROPONER un ITF (handleProponerItf -> avisarValidadoresPropuestaItf -> PropuestaNotificacion + outbox PropuestaNotificaciones), con la cadena REAL (Api -> ItfService ->
// proveedor de storage) y las hojas ItfEventos / PropuestaNotificaciones / el storage en memoria. Se simula Usuarios (con el filtro real de SheetUserRepository), MailApp, la cuota y la hora: no sale ningun
// email real. Verifica: el aviso se REGISTRA en el outbox despues de confirmar el ITF_PROPUESTO, nunca por un intento fallido, un reintento no duplica pero SI recupera un aviso que no llego a salir, ningun fallo
// de email deshace la propuesta ni cambia la respuesta, y el Historial del pozo no recibe filas tecnicas.
const { crearEntorno, JPEG } = require('./itfEntorno');
const { crearHoja } = require('./fakeSheets');

const EMAIL = 'sesion@example.com';
const W = '14-0130';
const PROPONE = { perfil: true, perfil_subir: true };
const NOMBRE = 'PropuestaNotificaciones';
const LEASE = 300000;
const T0 = Date.parse('2026-11-03T17:05:00.000Z');

// Hoja Usuarios simulada (encabezado + filas); se filtra con la funcion REAL del repositorio. Validan (activos, perfil=SI, perfil_validar=SI): val1 y val2.
const ENCABEZADO = ['email', 'nombre', 'estado', 'perfil', 'perfil_subir', 'perfil_validar'];
const FILA_PROPONENTE = [EMAIL, 'Ana Proponente', 'activo', 'SI', 'SI', 'NO'];
const USUARIOS = [
  ENCABEZADO,
  FILA_PROPONENTE,
  ['val1@example.com', 'Valeria Validadora', 'activo', 'SI', 'NO', 'SI'],
  ['val2@example.com', 'Vero Validadora', 'Activo ', 'SI', 'SI', ' si '],
  ['sinpermiso@example.com', 'Sin Permiso', 'activo', 'SI', 'SI', 'NO'],
  ['solosubir@example.com', 'Solo Subir', 'activo', 'SI', 'SI', ''],
  ['permisotexto@example.com', 'Permiso Texto', 'activo', 'SI', 'NO', 'true'],
  ['inactivo@example.com', 'Inactivo', 'inactivo', 'SI', 'NO', 'SI'],
  ['bloqueado@example.com', 'Bloqueado', 'bloqueado', 'SI', 'NO', 'SI'],
  ['sinperfil@example.com', 'Sin Perfil', 'activo', 'NO', 'NO', 'SI'],
  ['VAL1@Example.com', 'Valeria repetida', 'activo', 'SI', 'NO', 'SI'],
  ['malformado', 'Malformado', 'activo', 'SI', 'NO', 'SI']
];

let E;
let Api;
let R;
let almacen;
let enviados;
let usuarios;
let cuota;
let trasheados;
let ahoraMs;
let dateNow;
let n = 0;

const crid = () => { n += 1; return 'noti-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');
const cuerpo = (extra) => Object.assign({ wellId: W, imageBase64: b64(JPEG(400, 1)), mimeType: 'image/jpeg', nombreOriginal: 'itf-14-0130.jpg', clientRequestId: crid() }, extra || {});
const proponer = (b) => Api.handleProponerItf('t', b === undefined ? cuerpo() : b);
const filas = () => E.hoja.filas.slice(1);
const outbox = () => R.propuestaNotificacionesRepository_leerTodas();
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.join('|'));
const filasAviso = () => global.logHistoryEvent.mock.calls.filter((c) => /notific/i.test(String(c[1])));
const destinatarios = () => enviados.map((m) => m.to).sort();
const avanzar = (ms) => { ahoraMs += ms; };
const soloLaPropuesta = () => [EMAIL + '|proponerItf|' + W + '|OK'];

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}

function montar(opciones) {
  const o = opciones || {};
  E = crearEntorno(Object.assign({ archivos: [], props: { ITF_E9_ACTIVO: 'SI' } }, o.entorno || {}));
  Api = require('../src/Api');
  // el aviso REAL (en Apps Script es un archivo mas del proyecto: globales), su outbox y el filtro REAL de usuarios
  R = require('../src/PropuestaNotificacionesRepository');
  Object.assign(global, require('../src/PropuestaNotificacion'), R, require('../src/SheetUserRepository'));
  if (o.sinOutbox !== true) {
    E.hojas[NOMBRE] = crearHoja(NOMBRE, [R.PROPUESTA_NOTIF_COLUMNAS]);
  }
  global.getUserAccess.mockReturnValue({ nombre: 'Ana Proponente' });
  como(PROPONE);
  almacen = {};
  enviados = [];
  trasheados = [];
  usuarios = USUARIOS;
  cuota = { restante: 100, falloEnvio: null, alEnviar: null };
  ahoraMs = T0;
  if (dateNow) { dateNow.mockRestore(); }
  dateNow = jest.spyOn(Date, 'now').mockImplementation(() => ahoraMs);
  global.sheetUserRepository_listarConPermisos = jest.fn((permisos) => global.sheetUserRepository_filtrarConPermisos(usuarios, permisos));
  global.getPwaUrl = jest.fn(() => 'https://pozos.example.org/app/');
  global.MailApp = {
    sendEmail: jest.fn((m) => {
      if (cuota.alEnviar) { cuota.alEnviar(m); }
      if (cuota.falloEnvio && cuota.falloEnvio(m)) { throw new Error('rechazado ' + m.to); }
      enviados.push(m);
    }),
    getRemainingDailyQuota: jest.fn(() => cuota.restante)
  };
  global.Utilities.formatDate = (d) => {
    const x = new Date(d.getTime() - 3 * 3600 * 1000);
    const p2 = (v) => String(v).padStart(2, '0');
    return p2(x.getUTCDate()) + '/' + p2(x.getUTCMonth() + 1) + '/' + x.getUTCFullYear() + ' ' + p2(x.getUTCHours()) + ':' + p2(x.getUTCMinutes());
  };
  global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
    if (accion === 'putItf') {
      const ref = 'itf-ref-' + String(Object.keys(almacen).length + 1).padStart(6, '0');
      almacen[ref] = payload;
      return { status: 'ok', driveFileId: ref, tamanoBytes: 1 };
    }
    if (accion === 'trashItf') {
      trasheados.push(payload.driveFileId);
      delete almacen[payload.driveFileId];
      return { status: 'ok' };
    }
    throw new Error('accion inesperada ' + accion);
  });
  global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: {} }));
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  global.UrlFetchApp = { fetch: jest.fn() };
}

beforeEach(() => montar());
afterEach(() => { if (dateNow) { dateNow.mockRestore(); dateNow = null; } });

describe('1. propuesta nueva -> se registra en el outbox y notifica', () => {
  test('el aviso sale con el asunto y el cuerpo pedidos, y la respuesta al cliente es la de siempre (sin rastro del aviso)', () => {
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(Object.keys(r.data).sort()).toEqual(['bytes', 'documentoId', 'estado', 'mimeType', 'nombreOriginal', 'timestampUtc', 'warnings', 'wellId']);
    expect(enviados.length).toBeGreaterThan(0);
    const m = enviados[0];
    expect(m.subject).toBe('DGI Pozos | Nueva propuesta de ITF | 14-0130');
    expect(m.body).toMatch(/^Hay una nueva propuesta de ITF pendiente de validación\.\n\nTipo de propuesta: ITF\nPozo: 14-0130\nPropuesta por: Ana Proponente\nFecha y hora: \d\d\/\d\d\/\d{4} \d\d:\d\d\nEstado: pendiente de validación\n\nAbrí la app: https:\/\/pozos\.example\.org\/app\/\nPara revisarla, entrá a «ITF pendientes»\./);
  });

  test('el email NO lleva imagen, documentoId, storage, hash ni clientRequestId; solo el nombre de quien propuso (jamas un email)', () => {
    const b = cuerpo();
    const r = proponer(b);
    const ref = Object.keys(almacen)[0];
    expect(enviados.length).toBeGreaterThan(0);
    enviados.forEach((m) => {
      const todo = m.subject + '\n' + m.body;
      [r.data.documentoId, ref, b.clientRequestId, b.imageBase64.slice(0, 12), 'sha256', 'hash', 'storage', EMAIL, 'val1@example.com', 'val2@example.com'].forEach((prohibido) => {
        expect(todo).not.toContain(prohibido);
      });
      expect(todo).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{40,}/i);
      expect(Object.keys(m).sort()).toEqual(['body', 'name', 'subject', 'to']);     // sin adjuntos
    });
  });

  test('la fila del outbox no guarda el cuerpo, ni storageFileId, ni hash, ni clientRequestId, ni imagen', () => {
    const b = cuerpo();
    proponer(b);
    const ref = Object.keys(almacen)[0];
    const hoja = JSON.stringify(E.hojas[NOMBRE].filas);
    [ref, b.clientRequestId, b.imageBase64.slice(0, 12), 'sha256', 'Abrí la app', 'pendiente de validación'].forEach((prohibido) => {
      expect(hoja).not.toContain(prohibido);
    });
    expect(hoja).not.toMatch(/[0-9a-f]{40,}/i);
    // los emails SOLO aparecen donde corresponde: el del proponente y los validadores que ya recibieron el aviso (para no duplicar)
    const o = outbox()[0];
    const conEmail = Object.keys(o).filter((k) => /@/.test(String(o[k])));
    expect(conEmail.sort()).toEqual(['destinatariosEnviados', 'proponenteEmail']);
    expect(E.hojas[NOMBRE].filas[0]).toEqual(R.PROPUESTA_NOTIF_COLUMNAS);
  });

  test('ORDEN: al enviar el email la propuesta YA esta escrita, el archivo YA esta en el storage y el aviso YA esta registrado en el outbox', () => {
    const vistos = [];
    cuota.alEnviar = () => vistos.push({
      filas: filas().length,
      archivos: Object.keys(almacen).length,
      evento: filas().length === 1 && JSON.stringify(filas()[0]).indexOf('ITF_PROPUESTO') >= 0,
      outbox: outbox().map((x) => x.estado + ':' + x.intentos)
    });
    proponer();
    expect(vistos).toHaveLength(2);
    vistos.forEach((v) => expect(v).toEqual({ filas: 1, archivos: 1, evento: true, outbox: ['PENDIENTE:1'] }));
  });

  test('queda UNA fila ENVIADA en el outbox con los datos necesarios para reenviar', () => {
    const r = proponer();
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({
      tipo: 'ITF', propuestaId: r.data.documentoId, wellId: W, permisosValidador: 'perfil,perfil_validar', proponenteNombre: 'Ana Proponente', proponenteEmail: EMAIL, propuestaTimestampUtc: r.data.timestampUtc,
      estado: 'ENVIADA', intentos: 1, ultimoError: '', destinatariosEnviados: 'val1@example.com;val2@example.com'
    });
  });

  test('10. NO hay fila tecnica extra en el Historial del pozo: solo la de la propuesta', () => {
    proponer();
    expect(historial()).toEqual(soloLaPropuesta());
    expect(filasAviso()).toHaveLength(0);
  });

  test('una propuesta PNG tambien notifica (el formato no cambia el aviso)', () => {
    const png = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52].concat(new Array(300).fill(3));
    expect(proponer(cuerpo({ imageBase64: b64(png), mimeType: 'image/png', nombreOriginal: 'itf.png' })).status).toBe('ok');
    expect(enviados).toHaveLength(2);
  });

  test('otra propuesta DISTINTA (otro pozo) avisa de nuevo: el aviso es por propuesta, no por usuario ni por sesion', () => {
    proponer();
    proponer(cuerpo({ wellId: '14-0131', imageBase64: b64(JPEG(420, 9)) }));
    expect(enviados).toHaveLength(4);
    expect(enviados.slice(2).every((m) => m.subject === 'DGI Pozos | Nueva propuesta de ITF | 14-0131')).toBe(true);
    expect(outbox()).toHaveLength(2);
  });
});

describe('1b. la identidad del aviso es la PROPUESTA, no el pozo', () => {
  test('8. dos propuestas DISTINTAS del mismo pozo (retirar la propia y volver a proponer) -> dos notificaciones', () => {
    const r1 = proponer();
    const retiro = Api.handleRetirarPropuestaItf('t', { action: 'retirarPropuestaItf', sessionToken: 't', documentoId: r1.data.documentoId, clientRequestId: crid() });
    expect(retiro.status).toBe('ok');
    expect(enviados).toHaveLength(2);                     // retirar no avisa a nadie
    const r2 = proponer(cuerpo({ imageBase64: b64(JPEG(450, 6)) }));
    expect(r2.status).toBe('ok');
    expect(r2.data.documentoId).not.toBe(r1.data.documentoId);
    expect(enviados).toHaveLength(4);
    expect(outbox().map((x) => x.propuestaId)).toEqual([r1.data.documentoId, r2.data.documentoId]);
    expect(outbox().every((x) => x.wellId === W && x.estado === 'ENVIADA')).toBe(true);
  });
});

describe('2. dos validadores -> ambos reciben', () => {
  test('cada validador activo recibe SU propio email (uno por destinatario: no se ven entre si)', () => {
    proponer();
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(enviados.every((m) => typeof m.to === 'string' && m.to.indexOf(',') < 0)).toBe(true);
  });

  test('la consulta de destinatarios pide EXACTAMENTE perfil + perfil_validar (lo que el backend exige para la cola de ITF)', () => {
    proponer();
    expect(global.sheetUserRepository_listarConPermisos).toHaveBeenCalledWith(['perfil', 'perfil_validar']);
  });

  test('CONTRATO: reciben el aviso exactamente quienes pueden abrir la cola «ITF pendientes» (mismos permisos exigidos por el backend)', () => {
    const exigidos = global.PROPUESTA_TIPOS.ITF.permisosValidador;
    const denegado = (permisos) => { como(permisos); return Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' }).code === 'PERMISSION_DENIED'; };
    const todos = {};
    exigidos.forEach((p) => { todos[p] = true; });
    expect(denegado(todos)).toBe(false);
    exigidos.forEach((falta) => {
      const parcial = Object.assign({}, todos);
      delete parcial[falta];
      expect(denegado(parcial)).toBe(true);
    });
    // y ningun permiso extra hace falta para abrir la cola: los exigidos son TODOS los que el backend mira
    expect(denegado({ perfil: true, perfil_subir: true, perfil_validar: true })).toBe(false);
  });
});

describe('3. usuario sin permiso -> no recibe', () => {
  test('sin perfil_validar, con perfil_validar vacio, con un valor distinto de SI, o sin perfil: no reciben', () => {
    proponer();
    ['sinpermiso@example.com', 'solosubir@example.com', 'permisotexto@example.com', 'sinperfil@example.com', EMAIL].forEach((e) => {
      expect(destinatarios()).not.toContain(e);
    });
  });

  test('si la hoja ni siquiera tiene la columna perfil_validar: NADIE recibe (fail-closed), la propuesta funciona y el aviso queda reintentable', () => {
    usuarios = [['email', 'nombre', 'estado', 'perfil'], ['val1@example.com', 'V', 'activo', 'SI']];
    expect(proponer().status).toBe('ok');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'SIN_DESTINATARIOS' });
  });
});

describe('4. usuario inactivo -> no recibe', () => {
  test('estado inactivo o cualquier otro que no sea exactamente activo: no reciben aunque tengan los permisos', () => {
    proponer();
    expect(destinatarios()).not.toContain('inactivo@example.com');
    expect(destinatarios()).not.toContain('bloqueado@example.com');
  });
});

describe('5. email duplicado -> uno solo', () => {
  test('el mismo email dos veces en la hoja (aunque cambie la capitalizacion) recibe UN solo aviso', () => {
    proponer();
    expect(enviados.filter((m) => m.to === 'val1@example.com')).toHaveLength(1);
    expect(enviados).toHaveLength(2);
  });

  test('emails de forma invalida en la hoja se descartan', () => {
    proponer();
    expect(destinatarios().every((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))).toBe(true);
  });
});

describe('6. reintento idempotente del proponente', () => {
  test('con el aviso ya ENVIADA: devuelve la propuesta original y NO manda ni intenta otro email (el notificador se invoca y la hoja lo frena)', () => {
    const real = global.propuestaNotificacion_notificar;
    global.propuestaNotificacion_notificar = jest.fn((p) => real(p));
    const b = cuerpo();
    const primera = proponer(b);
    expect(enviados).toHaveLength(2);
    global.MailApp.sendEmail.mockClear();
    global.sheetUserRepository_listarConPermisos.mockClear();
    const segunda = proponer(b);
    expect(global.propuestaNotificacion_notificar).toHaveBeenCalledTimes(2);
    expect(global.propuestaNotificacion_notificar.mock.results[1].value.resultado).toBe('YA_ENVIADA');
    expect(segunda.status).toBe('ok');
    expect(segunda.data.documentoId).toBe(primera.data.documentoId);
    expect(filas()).toHaveLength(1);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(2);
    expect(outbox()).toHaveLength(1);
    expect(historial()).toEqual(soloLaPropuesta());
  });

  test('la respuesta del reintento es identica a la del primer intento', () => {
    const b = cuerpo();
    const primera = proponer(b);
    expect(proponer(b)).toEqual(primera);
  });

  test('varios reintentos seguidos: sigue habiendo UN solo aviso por destinatario y UNA fila', () => {
    const b = cuerpo();
    for (let i = 0; i < 4; i += 1) { expect(proponer(b).status).toBe('ok'); }
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(2);
    expect(outbox()).toHaveLength(1);
  });

  test('5. el primer intento termino con el email caido: el reintento posterior (pasado el lease) ENVIA y la fila pasa a ENVIADA', () => {
    cuota.falloEnvio = () => true;
    const b = cuerpo();
    const primera = proponer(b);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1 });
    cuota.falloEnvio = null;
    avanzar(LEASE);
    const segunda = proponer(b);
    expect(segunda).toEqual(primera);
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 2, ultimoError: '' });
    expect(filas()).toHaveLength(1);
  });

  test('el reintento INMEDIATO (otro intento en curso) no manda de nuevo', () => {
    cuota.falloEnvio = () => true;
    const b = cuerpo();
    proponer(b);
    cuota.falloEnvio = null;
    expect(proponer(b).status).toBe('ok');
    expect(enviados).toHaveLength(0);
    expect(outbox()[0].intentos).toBe(1);
  });

  test('el proceso murio entre confirmar ITF_PROPUESTO y registrar el aviso: el reintento del proponente RECUPERA el aviso (ya no se pierde)', () => {
    const real = global.propuestaNotificacion_notificar;
    global.propuestaNotificacion_notificar = jest.fn(() => { throw new Error('el proceso muere aca'); });
    const b = cuerpo();
    const primera = proponer(b);
    expect(primera.status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(outbox()).toHaveLength(0);
    expect(enviados).toHaveLength(0);
    global.propuestaNotificacion_notificar = real;
    const segunda = proponer(b);
    expect(segunda).toEqual(primera);
    expect(filas()).toHaveLength(1);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].estado).toBe('ENVIADA');
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(proponer(b).status).toBe('ok');
    expect(enviados).toHaveLength(2);
  });

  test('el aviso no se registro porque el outbox todavia no estaba creado: al crearlo, el reintento del proponente lo recupera', () => {
    montar({ sinOutbox: true });
    const b = cuerpo();
    expect(proponer(b).status).toBe('ok');
    expect(enviados).toHaveLength(0);
    E.hojas[NOMBRE] = crearHoja(NOMBRE, [R.PROPUESTA_NOTIF_COLUMNAS]);
    expect(proponer(b).status).toBe('ok');
    expect(outbox()).toHaveLength(1);
    expect(enviados).toHaveLength(2);
  });
});

describe('7. fallo de MailApp -> la propuesta sigue creada y el aviso persiste', () => {
  test('MailApp rechaza todo: respuesta OK identica, evento escrito, archivo en el storage, SIN compensacion, outbox ERROR y Historial limpio', () => {
    cuota.falloEnvio = () => true;
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(Object.keys(r.data).sort()).toEqual(['bytes', 'documentoId', 'estado', 'mimeType', 'nombreOriginal', 'timestampUtc', 'warnings', 'wellId']);
    expect(filas()).toHaveLength(1);
    expect(Object.keys(almacen)).toHaveLength(1);
    expect(trasheados).toEqual([]);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'FALLO (0 de 2 enviados)' });
    expect(historial()).toEqual(soloLaPropuesta());
  });

  test('4. propuesta confirmada + MailApp falla -> el outbox persiste y despues procesarNotificacionesPropuestasPendientes lo envia', () => {
    cuota.falloEnvio = () => true;
    proponer();
    cuota.falloEnvio = null;
    avanzar(LEASE);
    expect(global.procesarNotificacionesPropuestasPendientes()).toMatchObject({ revisadas: 1, enviadas: 1, errores: 0 });
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', intentos: 2 });
    expect(historial()).toEqual(soloLaPropuesta());
  });

  test('falla un solo destinatario: el otro lo recibe, queda ERROR parcial y el reintento completa SOLO al que faltaba', () => {
    cuota.falloEnvio = (m) => m.to === 'val1@example.com';
    expect(proponer().status).toBe('ok');
    expect(destinatarios()).toEqual(['val2@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'PARCIAL (1 de 2 enviados)' });
    cuota.falloEnvio = null;
    avanzar(LEASE);
    global.procesarNotificacionesPropuestasPendientes();
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(outbox()[0].estado).toBe('ENVIADA');
  });

  test('cuota diaria agotada: la propuesta sigue creada y el aviso queda reintentable', () => {
    cuota.restante = 0;
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'FALLO (0 de 2 enviados, cuota diaria agotada)' });
  });

  test('la hoja de Usuarios no se puede leer: la propuesta sigue creada y el aviso queda ERROR', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios"'); });
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'LECTURA_USUARIOS' });
  });

  test('aunque el propio notificador reviente (lance una excepcion), la respuesta es la de exito, no se deshace nada y el Historial queda limpio', () => {
    global.propuestaNotificacion_notificar = jest.fn(() => { throw new Error('explota'); });
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(trasheados).toEqual([]);
    expect(historial()).toEqual(soloLaPropuesta());
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).toContain('no se pudo avisar a los validadores');
  });

  test('el outbox NO existe (setup sin correr): la propuesta funciona, no se manda nada y el Historial queda limpio', () => {
    montar({ sinOutbox: true });
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(0);
    expect(historial()).toEqual(soloLaPropuesta());
    expect(E.hojas[NOMBRE]).toBeUndefined();
  });

  test.each([
    ['todo falla', (c) => { c.falloEnvio = () => true; }],
    ['parcial', (c) => { c.falloEnvio = (m) => m.to === 'val1@example.com'; }],
    ['cuota agotada', (c) => { c.restante = 0; }],
    ['todo bien', () => {}]
  ])('9. Historial limpio en cualquier resultado del aviso (%s): nunca una fila notificarPropuestaItf ni de email', (nombre, preparar) => {
    preparar(cuota);
    proponer();
    expect(historial()).toEqual(soloLaPropuesta());
    expect(filasAviso()).toHaveLength(0);
  });
});

describe('7b. BEST-EFFORT TOTAL: ITF_PROPUESTO confirmado => la API responde exito aunque falle CUALQUIER parte del subsistema de avisos', () => {
  const RESPUESTA = ['bytes', 'documentoId', 'estado', 'mimeType', 'nombreOriginal', 'timestampUtc', 'warnings', 'wellId'];
  const logCaido = () => global.Logger.log.mockImplementation(() => { throw new Error('el log no esta disponible'); });

  // La propuesta quedo confirmada y NADA se deshizo: ni ItfEventos ni el storage; la respuesta es la de siempre y el Historial solo tiene la propuesta.
  function propuestaIntacta(r) {
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(Object.keys(r.data).sort()).toEqual(RESPUESTA);
    expect(filas()).toHaveLength(1);
    expect(JSON.stringify(filas()[0])).toContain('ITF_PROPUESTO');
    expect(Object.keys(almacen)).toHaveLength(1);
    expect(trasheados).toEqual([]);
    expect(historial()).toEqual(soloLaPropuesta());
  }

  test('1-4. ITF_PROPUESTO se confirma, ASEGURAR el outbox lanza una excepcion: la API devuelve la propuesta exitosa y no se revierte storage ni ItfEventos', () => {
    global.propuestaNotificacionesRepository_asegurar = jest.fn(() => { throw new Error('Exception: no se pudo abrir la hoja'); });
    const r = proponer();
    propuestaIntacta(r);
    expect(global.propuestaNotificacionesRepository_asegurar).toHaveBeenCalledTimes(1);
    expect(outbox()).toHaveLength(0);
    expect(enviados).toHaveLength(0);
  });

  test('asegurar el outbox lanza Y ademas el log esta caido: sigue siendo exito (el manejo del error tampoco puede romper la respuesta)', () => {
    global.propuestaNotificacionesRepository_asegurar = jest.fn(() => { throw new Error('boom'); });
    logCaido();
    propuestaIntacta(proponer());
    expect(enviados).toHaveLength(0);
  });

  test('el outbox no se pudo asegurar: el REINTENTO idempotente del proponente repara la fila y recien ahi sale el aviso (una sola vez)', () => {
    const real = global.propuestaNotificacionesRepository_asegurar;
    global.propuestaNotificacionesRepository_asegurar = jest.fn(() => { throw new Error('boom'); });
    const b = cuerpo();
    const primera = proponer(b);
    propuestaIntacta(primera);
    expect(outbox()).toHaveLength(0);
    global.propuestaNotificacionesRepository_asegurar = real;
    expect(proponer(b)).toEqual(primera);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0].estado).toBe('ENVIADA');
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
    expect(proponer(b)).toEqual(primera);
    expect(enviados).toHaveLength(2);
    expect(filas()).toHaveLength(1);
  });

  test('RESERVAR el intento lanza (lock, hoja): exito, nada se envia y la fila queda PENDIENTE sin intentos gastados', () => {
    global.propuestaNotificacionesRepository_reservarIntento = jest.fn(() => { throw new Error('No se pudo obtener el lock'); });
    propuestaIntacta(proponer());
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 0 });
  });

  test('LEER Usuarios lanza y el log tambien esta caido: exito; la fila queda en ERROR reintentable', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('Usuarios no existe'); });
    logCaido();
    propuestaIntacta(proponer());
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'LECTURA_USUARIOS' });
  });

  test('MailApp lanza en cada envio y el log tambien esta caido: exito; la fila queda en ERROR reintentable', () => {
    cuota.falloEnvio = () => true;
    logCaido();
    propuestaIntacta(proponer());
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', intentos: 1, ultimoError: 'FALLO (0 de 2 enviados)' });
  });

  test('MailApp.getRemainingDailyQuota lanza: se intenta enviar igual y la propuesta no se ve afectada', () => {
    global.MailApp.getRemainingDailyQuota = jest.fn(() => { throw new Error('sin permiso de cuota'); });
    propuestaIntacta(proponer());
    expect(outbox()[0].estado).toBe('ENVIADA');
  });

  test('ACTUALIZAR el estado de la notificacion lanza (hoja borrada, lock): exito; el email ya salio y la fila no se pierde', () => {
    global.propuestaNotificacionesRepository_registrarResultado = jest.fn(() => { throw new Error('la hoja ya no existe'); });
    propuestaIntacta(proponer());
    expect(enviados).toHaveLength(2);
    expect(outbox()).toHaveLength(1);
    expect(outbox()[0]).toMatchObject({ estado: 'PENDIENTE', intentos: 1 });
  });

  test('ACTUALIZAR el estado lanza Y el log esta caido: exito igual', () => {
    global.propuestaNotificacionesRepository_registrarResultado = jest.fn(() => { throw new Error('boom'); });
    logCaido();
    propuestaIntacta(proponer());
  });

  test('la verificacion de vigencia del tipo lanza: exito; el aviso queda como esta y se reintenta', () => {
    const real = global.PROPUESTA_TIPOS.ITF.verificar;
    global.PROPUESTA_TIPOS.ITF.verificar = jest.fn(() => { throw new Error('boom'); });
    try {
      propuestaIntacta(proponer());
      expect(enviados).toHaveLength(0);
      expect(outbox()).toHaveLength(1);
    } finally {
      global.PROPUESTA_TIPOS.ITF.verificar = real;
    }
  });

  test('el notificador entero lanza con un error cuyo texto no se puede ni leer, y el log esta caido: exito igual', () => {
    const raro = { get message() { throw new Error('mensaje ilegible'); }, toString() { throw new Error('toString ilegible'); } };
    global.propuestaNotificacion_notificar = jest.fn(() => { throw raro; });
    logCaido();
    propuestaIntacta(proponer());
    expect(global.propuestaNotificacion_notificar).toHaveBeenCalledTimes(1);
  });

  test('el notificador ni siquiera esta cargado (ReferenceError): exito igual', () => {
    delete global.propuestaNotificacion_notificar;
    propuestaIntacta(proponer());
    expect(enviados).toHaveLength(0);
  });

  test('NO regresion: con todo el subsistema sano sale el email y la respuesta es identica a la de los casos de falla', () => {
    const sana = proponer();
    expect(Object.keys(sana.data).sort()).toEqual(RESPUESTA);
    expect(enviados).toHaveLength(2);
    expect(outbox()[0].estado).toBe('ENVIADA');
  });
});

describe('8. propuesta fallida -> NO hay email ni fila en el outbox', () => {
  const sinAviso = () => {
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(0);
    expect(filasAviso()).toHaveLength(0);
  };

  test.each([
    ['sin permisos para proponer', () => { como({ perfil: true }); }, null, 'PERMISSION_DENIED'],
    ['interruptor apagado', () => { E.props.ITF_E9_ACTIVO = 'NO'; }, null, 'ITF_E9_INACTIVO'],
    ['wellId invalido', null, { wellId: '14-13' }, 'INVALID_WELL_ID'],
    ['base64 invalido', null, { imageBase64: 'no es base64!!' }, 'INVALID_ARCHIVO'],
    ['tipo de archivo no permitido', null, { mimeType: 'application/pdf' }, 'MIME_NO_PERMITIDO'],
    ['campo que no corresponde', null, { documentoId: 'x' }, 'INVALID_REQUEST'],
    ['clientRequestId invalido', null, { clientRequestId: 'corto' }, 'INVALID_CLIENT_REQUEST_ID']
  ])('%s -> error y ningun email', (nombre, preparar, extra, code) => {
    if (preparar) { preparar(); }
    expect(proponer(cuerpo(extra || {})).code).toBe(code);
    expect(filas()).toHaveLength(0);
    sinAviso();
  });

  test('el storage no esta disponible: error, nada escrito y ningun email', () => {
    global.fotosStorageClient_llamar = jest.fn(() => { throw new Error('FOTOS_STORAGE_URL no configurado en Script Properties'); });
    expect(proponer().status).toBe('error');
    expect(filas()).toHaveLength(0);
    sinAviso();
  });

  test('la hoja ItfEventos no existe: SERVICE_UNAVAILABLE y ningun email', () => {
    montar({ entorno: { sinHoja: true } });
    expect(proponer()).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    sinAviso();
  });

  test('el mismo clientRequestId con OTRO contenido: IDEMPOTENCY_CONFLICT, y no se manda otro email ni se crea otra fila', () => {
    const b = cuerpo();
    expect(proponer(b).status).toBe('ok');
    global.MailApp.sendEmail.mockClear();
    expect(proponer(Object.assign({}, b, { imageBase64: b64(JPEG(500, 8)) })).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(1);
  });

  test('el mismo archivo ya propuesto con otro clientRequestId: rechazado como duplicado y SIN segundo email ni segunda fila', () => {
    const b = cuerpo();
    expect(proponer(b).status).toBe('ok');
    global.MailApp.sendEmail.mockClear();
    const r = proponer(cuerpo({ imageBase64: b.imageBase64 }));
    expect(r.status).toBe('error');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(filas()).toHaveLength(1);
    expect(outbox()).toHaveLength(1);
  });

  test('INVERSO: el ITF_PROPUESTO NO llega a escribirse (la hoja rechaza la escritura): error al cliente, archivo compensado, ni fila de outbox ni email ni lectura de Usuarios', () => {
    const original = E.hoja.getRange.bind(E.hoja);
    E.hoja.getRange = (...args) => {
      const rango = original(...args);
      rango.setValues = () => { throw new Error('Exception: la hoja rechazo la escritura'); };
      return rango;
    };
    const r = proponer();
    expect(r.status).toBe('error');
    expect(filas()).toHaveLength(0);
    expect(Object.keys(almacen)).toHaveLength(0);
    sinAviso();
  });

  test('sin sesion valida: nada', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(proponer().code).toBe('UNAUTHORIZED');
    sinAviso();
  });
});

describe('9. el proponente tambien es validador -> comportamiento definido: RECIBE el aviso', () => {
  test('quien propone y tambien valida (perfil_validar = SI) recibe el mismo email que los demas', () => {
    usuarios = USUARIOS.map((f, i) => (i === 1 ? [EMAIL, 'Ana Proponente', 'activo', 'SI', 'SI', 'SI'] : f));
    expect(proponer().status).toBe('ok');
    expect(destinatarios()).toEqual(['sesion@example.com', 'val1@example.com', 'val2@example.com']);
    expect(outbox()[0]).toMatchObject({ estado: 'ENVIADA', destinatariosEnviados: 'sesion@example.com;val1@example.com;val2@example.com' });
  });

  test('si el proponente NO valida, no recibe nada', () => {
    proponer();
    expect(destinatarios()).not.toContain(EMAIL);
  });
});

describe('10. cero validadores -> la propuesta funciona igualmente', () => {
  test('nadie con perfil_validar: propuesta creada, sin emails, aviso reintentable y Historial limpio', () => {
    usuarios = [ENCABEZADO, FILA_PROPONENTE, ['inactivo@example.com', 'Inactivo', 'inactivo', 'SI', 'NO', 'SI']];
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(filas()).toHaveLength(1);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()[0]).toMatchObject({ estado: 'ERROR', ultimoError: 'SIN_DESTINATARIOS' });
    expect(historial()).toEqual(soloLaPropuesta());
  });

  test('hoja de usuarios vacia (ni encabezado): igual', () => {
    usuarios = [];
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(0);
  });

  test('cuando despues se da de alta un validador, el reintento lo avisa', () => {
    usuarios = [ENCABEZADO, FILA_PROPONENTE];
    proponer();
    usuarios = USUARIOS;
    avanzar(LEASE);
    expect(global.procesarNotificacionesPropuestasPendientes().enviadas).toBe(1);
    expect(destinatarios()).toEqual(['val1@example.com', 'val2@example.com']);
  });
});

describe('la propuesta deja de estar pendiente antes de que salga el aviso', () => {
  test('retirada por el proponente despues de un envio fallido: el reintento NO manda un «pendiente» falso y queda OMITIDA', () => {
    cuota.falloEnvio = () => true;
    const r = proponer();
    cuota.falloEnvio = null;
    expect(Api.handleRetirarPropuestaItf('t', { action: 'retirarPropuestaItf', sessionToken: 't', documentoId: r.data.documentoId, clientRequestId: crid() }).status).toBe('ok');
    avanzar(LEASE);
    expect(global.procesarNotificacionesPropuestasPendientes()).toMatchObject({ revisadas: 1, omitidas: 1, enviadas: 0 });
    expect(enviados).toHaveLength(0);
    expect(outbox()[0]).toMatchObject({ estado: 'OMITIDA', ultimoError: 'YA_NO_PENDIENTE' });
  });

  test('con el interruptor apagado el aviso pendiente espera y sale cuando se vuelve a encender', () => {
    cuota.falloEnvio = () => true;
    proponer();
    cuota.falloEnvio = null;
    avanzar(LEASE);
    E.props.ITF_E9_ACTIVO = 'NO';
    expect(global.procesarNotificacionesPropuestasPendientes()).toMatchObject({ enEspera: 1, enviadas: 0 });
    expect(enviados).toHaveLength(0);
    E.props.ITF_E9_ACTIVO = 'SI';
    expect(global.procesarNotificacionesPropuestasPendientes().enviadas).toBe(1);
  });
});

describe('interruptor apagado: modo legacy puro, ni un solo email ni fila de outbox', () => {
  test('con ITF_E9_ACTIVO ausente proponer da ITF_E9_INACTIVO y no se lee Usuarios ni se envia nada', () => {
    montar({ entorno: { props: {} } });
    expect(proponer().code).toBe('ITF_E9_INACTIVO');
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(outbox()).toHaveLength(0);
  });
});
