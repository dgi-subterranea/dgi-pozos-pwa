// Aviso por email a los validadores al PROPONER un ITF (handleProponerItf -> avisarValidadoresPropuestaItf -> PropuestaNotificacion), con la cadena REAL (Api -> ItfService -> proveedor de storage) y la hoja
// ItfEventos / el storage en memoria. Se simula Usuarios (con el filtro real de SheetUserRepository), MailApp, la cuota y el cache: no sale ningun email real. Verifica: el aviso sale SOLO despues de confirmar el
// ITF_PROPUESTO, nunca por un intento fallido ni por un reintento idempotente, y que ningun fallo de email deshace la propuesta ni cambia la respuesta.
const { crearEntorno, JPEG } = require('./itfEntorno');

const EMAIL = 'sesion@example.com';
const W = '14-0130';
const PROPONE = { perfil: true, perfil_subir: true };

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
let almacen;
let enviados;
let usuarios;
let cuota;
let trasheados;
let n = 0;

const crid = () => { n += 1; return 'noti-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');
const cuerpo = (extra) => Object.assign({ wellId: W, imageBase64: b64(JPEG(400, 1)), mimeType: 'image/jpeg', nombreOriginal: 'itf-14-0130.jpg', clientRequestId: crid() }, extra || {});
const proponer = (b) => Api.handleProponerItf('t', b === undefined ? cuerpo() : b);
const filas = () => E.hoja.filas.slice(1);
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.join('|'));
const filasAviso = () => global.logHistoryEvent.mock.calls.filter((c) => c[1] === 'notificarPropuestaItf');
const destinatarios = () => enviados.map((m) => m.to).sort();

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}

function montar(opciones) {
  E = crearEntorno(Object.assign({ archivos: [], props: { ITF_E9_ACTIVO: 'SI' } }, opciones || {}));
  Api = require('../src/Api');
  // el aviso REAL (en Apps Script es un archivo mas del proyecto: globales) y el filtro REAL de usuarios
  Object.assign(global, require('../src/PropuestaNotificacion'), require('../src/SheetUserRepository'));
  global.getUserAccess.mockReturnValue({ nombre: 'Ana Proponente' });
  como(PROPONE);
  almacen = {};
  enviados = [];
  trasheados = [];
  usuarios = USUARIOS;
  cuota = { restante: 100, falloEnvio: null, alEnviar: null };
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

describe('1. propuesta nueva -> notifica', () => {
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

  test('ORDEN: cuando se envia el email la propuesta YA esta escrita (ITF_PROPUESTO confirmado) y el archivo ya esta en el storage', () => {
    const vistos = [];
    cuota.alEnviar = () => vistos.push({ filas: filas().length, archivos: Object.keys(almacen).length, evento: filas().length === 1 && JSON.stringify(filas()[0]).indexOf('ITF_PROPUESTO') >= 0 });
    proponer();
    expect(vistos).toHaveLength(2);
    vistos.forEach((v) => expect(v).toEqual({ filas: 1, archivos: 1, evento: true }));
  });

  test('queda UNA fila de Historial por el aviso (resultado y cantidad, sin cuerpo ni direcciones), despues de la de la propuesta', () => {
    proponer();
    expect(historial()).toEqual([EMAIL + '|proponerItf|' + W + '|OK', EMAIL + '|notificarPropuestaItf|' + W + '|EMAIL_ENVIADO (2 destinatarios)']);
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
  });
});

describe('1b. la identidad del aviso es la PROPUESTA, no el pozo', () => {
  test('retirar la propuesta propia y volver a proponer en el MISMO pozo es otra propuesta: avisa de nuevo', () => {
    const r1 = proponer();
    const retiro = Api.handleRetirarPropuestaItf('t', { action: 'retirarPropuestaItf', sessionToken: 't', documentoId: r1.data.documentoId, clientRequestId: crid() });
    expect(retiro.status).toBe('ok');
    expect(enviados).toHaveLength(2);                     // retirar no avisa a nadie
    const r2 = proponer(cuerpo({ imageBase64: b64(JPEG(450, 6)) }));
    expect(r2.status).toBe('ok');
    expect(r2.data.documentoId).not.toBe(r1.data.documentoId);
    expect(enviados).toHaveLength(4);
    expect(filasAviso()).toHaveLength(2);
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
});

describe('3. usuario sin permiso -> no recibe', () => {
  test('sin perfil_validar, con perfil_validar vacio, con un valor distinto de SI, o sin perfil: no reciben', () => {
    proponer();
    ['sinpermiso@example.com', 'solosubir@example.com', 'permisotexto@example.com', 'sinperfil@example.com', EMAIL].forEach((e) => {
      expect(destinatarios()).not.toContain(e);
    });
  });

  test('si la hoja ni siquiera tiene la columna perfil_validar: NADIE recibe (fail-closed) y la propuesta funciona', () => {
    usuarios = [['email', 'nombre', 'estado', 'perfil'], ['val1@example.com', 'V', 'activo', 'SI']];
    expect(proponer().status).toBe('ok');
    expect(enviados).toHaveLength(0);
    expect(filasAviso()[0][3]).toBe('EMAIL_SIN_DESTINATARIOS');
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

describe('6. reintento idempotente -> NO segundo email', () => {
  test('mismo clientRequestId y mismo contenido: devuelve la propuesta original y NO manda ni intenta otro email', () => {
    const real = global.propuestaNotificacion_notificar;
    global.propuestaNotificacion_notificar = jest.fn((p) => real(p));
    const b = cuerpo();
    const primera = proponer(b);
    expect(enviados).toHaveLength(2);
    expect(global.propuestaNotificacion_notificar).toHaveBeenCalledTimes(1);
    global.MailApp.sendEmail.mockClear();
    global.sheetUserRepository_listarConPermisos.mockClear();
    const segunda = proponer(b);
    // la decision de "no avisar" es del handler (solo accion ESCRIBIR): ni siquiera se invoca al notificador (la marca de cache es solo la segunda defensa)
    expect(global.propuestaNotificacion_notificar).toHaveBeenCalledTimes(1);
    expect(segunda.status).toBe('ok');
    expect(segunda.data.documentoId).toBe(primera.data.documentoId);
    expect(filas()).toHaveLength(1);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(enviados).toHaveLength(2);
    expect(filasAviso()).toHaveLength(1);
  });

  test('varios reintentos seguidos: sigue habiendo UN solo aviso por destinatario', () => {
    const b = cuerpo();
    for (let i = 0; i < 4; i += 1) { expect(proponer(b).status).toBe('ok'); }
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(2);
  });

  test('si el primer intento termino con el email caido, el reintento TAMPOCO manda (la propuesta ya existe: no se vuelve a avisar)', () => {
    cuota.falloEnvio = () => true;
    const b = cuerpo();
    proponer(b);
    cuota.falloEnvio = null;
    global.MailApp.sendEmail.mockClear();
    expect(proponer(b).status).toBe('ok');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });

  test('la segunda defensa: aunque el servicio dijera ESCRIBIR dos veces para el mismo documento, la marca de cache evita el segundo email', () => {
    const real = global.propuestaNotificacion_notificar;
    const resumenes = [];
    global.propuestaNotificacion_notificar = jest.fn((p) => { const r = real(p); resumenes.push(r.resultado); return r; });
    const b = cuerpo();
    proponer(b);
    // se simula una carrera: el mismo pedido de aviso se repite con el mismo documento
    const llamada = global.propuestaNotificacion_notificar.mock.calls[0][0];
    expect(real(llamada).resultado).toBe('DEDUPED');
    expect(resumenes).toEqual(['ENVIADO']);
    expect(enviados).toHaveLength(2);
  });
});

describe('7. fallo de MailApp -> la propuesta sigue creada', () => {
  test('MailApp rechaza todo: respuesta OK identica, evento escrito, archivo en el storage, SIN compensacion, y el fallo queda auditado', () => {
    cuota.falloEnvio = () => true;
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(Object.keys(r.data).sort()).toEqual(['bytes', 'documentoId', 'estado', 'mimeType', 'nombreOriginal', 'timestampUtc', 'warnings', 'wellId']);
    expect(filas()).toHaveLength(1);
    expect(Object.keys(almacen)).toHaveLength(1);
    expect(trasheados).toEqual([]);
    expect(historial()).toEqual([EMAIL + '|proponerItf|' + W + '|OK', EMAIL + '|notificarPropuestaItf|' + W + '|EMAIL_FALLO (0 de 2 enviados)']);
  });

  test('falla un solo destinatario: el otro lo recibe y queda EMAIL_PARCIAL', () => {
    cuota.falloEnvio = (m) => m.to === 'val1@example.com';
    expect(proponer().status).toBe('ok');
    expect(destinatarios()).toEqual(['val2@example.com']);
    expect(filasAviso()[0][3]).toBe('EMAIL_PARCIAL (1 de 2 enviados)');
  });

  test('cuota diaria agotada: la propuesta sigue creada y se audita', () => {
    cuota.restante = 0;
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(filasAviso()[0][3]).toBe('EMAIL_FALLO (0 de 2 enviados, cuota diaria agotada)');
  });

  test('la hoja de Usuarios no se puede leer: la propuesta sigue creada y se audita EMAIL_ERROR', () => {
    global.sheetUserRepository_listarConPermisos = jest.fn(() => { throw new Error('No existe una hoja llamada "Usuarios"'); });
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(0);
    expect(filasAviso()[0][3]).toBe('EMAIL_ERROR');
  });

  test('aunque el propio notificador reviente (lance una excepcion), la respuesta es la de exito y queda EMAIL_ERROR', () => {
    global.propuestaNotificacion_notificar = jest.fn(() => { throw new Error('explota'); });
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(trasheados).toEqual([]);
    expect(filasAviso()[0][3]).toBe('EMAIL_ERROR');
  });

  test('aunque falle el armado del texto de auditoria, la respuesta sigue siendo de exito (solo falta la fila del aviso)', () => {
    global.propuestaNotificacion_textoAuditoria = jest.fn(() => { throw new Error('explota'); });
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(filasAviso()).toHaveLength(0);
  });
});

describe('8. propuesta fallida -> NO hay email', () => {
  const sinAviso = () => {
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
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
    montar({ sinHoja: true });
    expect(proponer()).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    sinAviso();
  });

  test('el mismo clientRequestId con OTRO contenido: IDEMPOTENCY_CONFLICT, y no se manda otro email (ya hubo el del original)', () => {
    const b = cuerpo();
    expect(proponer(b).status).toBe('ok');
    global.MailApp.sendEmail.mockClear();
    const antes = filasAviso().length;
    expect(proponer(Object.assign({}, b, { imageBase64: b64(JPEG(500, 8)) })).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(filasAviso()).toHaveLength(antes);
  });

  test('el mismo archivo ya propuesto con otro clientRequestId: rechazado como duplicado y SIN segundo email', () => {
    const b = cuerpo();
    expect(proponer(b).status).toBe('ok');
    global.MailApp.sendEmail.mockClear();
    const r = proponer(cuerpo({ imageBase64: b.imageBase64 }));
    expect(r.status).toBe('error');
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(filas()).toHaveLength(1);
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
    expect(filasAviso()[0][3]).toBe('EMAIL_ENVIADO (3 destinatarios)');
  });

  test('si el proponente NO valida, no recibe nada', () => {
    proponer();
    expect(destinatarios()).not.toContain(EMAIL);
  });
});

describe('10. cero validadores -> la propuesta funciona igualmente', () => {
  test('nadie con perfil_validar: propuesta creada, sin emails, y se audita EMAIL_SIN_DESTINATARIOS', () => {
    usuarios = [ENCABEZADO, FILA_PROPONENTE, ['inactivo@example.com', 'Inactivo', 'inactivo', 'SI', 'NO', 'SI']];
    const r = proponer();
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
    expect(filas()).toHaveLength(1);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(historial()).toEqual([EMAIL + '|proponerItf|' + W + '|OK', EMAIL + '|notificarPropuestaItf|' + W + '|EMAIL_SIN_DESTINATARIOS']);
  });

  test('hoja de usuarios vacia (ni encabezado): igual', () => {
    usuarios = [];
    expect(proponer().status).toBe('ok');
    expect(filas()).toHaveLength(1);
    expect(enviados).toHaveLength(0);
  });
});

describe('interruptor apagado: modo legacy puro, ni un solo email', () => {
  test('con ITF_E9_ACTIVO ausente proponer da ITF_E9_INACTIVO y no se lee Usuarios ni se envia nada', () => {
    montar({ props: {} });
    expect(proponer().code).toBe('ITF_E9_INACTIVO');
    expect(global.sheetUserRepository_listarConPermisos).not.toHaveBeenCalled();
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
  });
});
