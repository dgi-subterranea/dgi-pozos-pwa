// API de las decisiones sobre fuentes registrales: getDecisionesFuentesPozo (ubicacion) y decidirFuenteUbicacion (ubicacion + ubicacion_validar), enrutadas por doPost.
// Permisos fail-closed, orden de chequeos, lista blanca de campos, auditoria en Historial, errores genericos y privacidad. Servicios, repositorio y dominio REALES.
const { armar, solicitud, P_REPORTE, P_IRR1, P_IRR2 } = require('./decisionesFuentesHelper');

let t;
const W = '14-0001';
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };

beforeEach(() => { t = armar(); });
afterEach(() => { jest.restoreAllMocks(); });

const cuerpo = (extra) => ({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', ...solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }), ...(extra || {}) });
const post = (body) => JSON.parse(t.Api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
const decidir = (extra) => post(cuerpo(extra));
const leer = (wellId, token) => post({ action: 'getDecisionesFuentesPozo', sessionToken: token === undefined ? 'tok-val@x.com' : token, wellId: wellId === undefined ? W : wellId });
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());

describe('enrutado por doPost', () => {
  test('getDecisionesFuentesPozo y decidirFuenteUbicacion existen y responden', () => {
    expect(leer().status).toBe('ok');
    expect(decidir().status).toBe('ok');
  });

  test('una accion parecida pero inexistente sigue siendo "accion desconocida"', () => {
    expect(post({ action: 'getDecisionesFuentesDelta', sessionToken: 'tok-val@x.com' })).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: expect.stringMatching(/accion desconocida/) });
    expect(post({ action: 'decidirFuente', sessionToken: 'tok-val@x.com' }).message).toMatch(/accion desconocida/);
  });

  test('las acciones de siempre no cambiaron (getUbicacionesValidadas / correcciones siguen enrutadas)', () => {
    global.ubicacionCorreccionService_getUbicacionesValidadas = jest.fn(() => ({ ubicaciones: [] }));
    expect(post({ action: 'getUbicacionesValidadas', sessionToken: 'tok-val@x.com' }).status).toBe('ok');
  });
});

describe('getDecisionesFuentesPozo: permisos y orden de chequeos', () => {
  test('ubicacion=SI alcanza (incluso sin validar): ve las fuentes y el historial', () => {
    expect(decidir().status).toBe('ok');
    const r = leer(W, 'tok-lee@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.fuentes).toHaveLength(3);
    expect(r.data.historial).toHaveLength(1);
  });

  test.each([
    ['sin ubicacion (solo validar)', 'tok-soloval@x.com', 'PERMISSION_DENIED'],
    ['sin ningun permiso', 'tok-nada@x.com', 'PERMISSION_DENIED'],
    ['usuario inactivo (aunque tenga todo)', 'tok-baja@x.com', 'USER_DISABLED'],
    ['token invalido', 'tok-nadie@x.com', 'UNAUTHORIZED'],
    ['token vacio', '', 'UNAUTHORIZED']
  ])('%s -> %s', (nombre, token, code) => {
    const r = leer(W, token);
    expect(r).toMatchObject({ status: 'error', code });
    expect(r.data).toBeUndefined();
  });

  test('wellId invalido: INVALID_WELL_ID (despues de la sesion y antes del permiso); pozo inexistente en el padron: WELL_NOT_FOUND', () => {
    ['x', '99-0001', '14-001', '', null, ['14-0001'], { a: 1 }].forEach((w) => expect(leer(w)).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' }));
    expect(post({ action: 'getDecisionesFuentesPozo', sessionToken: 'tok-nada@x.com', wellId: 'x' }).code).toBe('INVALID_WELL_ID');          // el formato se valida antes del permiso (patron del proyecto)
    expect(post({ action: 'getDecisionesFuentesPozo', sessionToken: 'tok-nadie@x.com', wellId: 'x' }).code).toBe('UNAUTHORIZED');           // pero la sesion va primero
    expect(leer('09-9999')).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
  });

  test('las lecturas no se auditan (patron del proyecto) salvo los rechazos de permiso', () => {
    leer();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    leer(W, 'tok-nada@x.com');
    expect(historial()).toEqual([['nada@x.com', 'getDecisionesFuentesPozo', W, 'PERMISSION_DENIED']]);
  });
});

describe('decidirFuenteUbicacion: permisos (ubicacion + ubicacion_validar, fail-closed)', () => {
  test.each([
    ['ubicacion + ubicacion_validar', 'val@x.com', true],
    ['corregir + validar + ubicacion', 'carla@x.com', true],
    ['SOLO ubicacion_corregir (no concede)', 'ana@x.com', false],
    ['SOLO ubicacion (lectura)', 'lee@x.com', false],
    ['SOLO ubicacion_validar (sin ubicacion)', 'soloval@x.com', false],
    ['ningun permiso', 'nada@x.com', false]
  ])('%s -> %s', (nombre, email, permitido) => {
    const r = decidir({ sessionToken: 'tok-' + email });
    if (permitido) {
      expect(r.status).toBe('ok');
      expect(t.filas()).toHaveLength(1);
    } else {
      expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(t.filas()).toHaveLength(0);
    }
  });

  test('usuario inactivo: USER_DISABLED aunque tenga todos los permisos; token invalido: UNAUTHORIZED; no se escribe nada', () => {
    expect(decidir({ sessionToken: 'tok-baja@x.com' })).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
    expect(decidir({ sessionToken: 'tok-nadie@x.com' })).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(decidir({ sessionToken: undefined })).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(t.filas()).toHaveLength(0);
  });

  test('sin permiso el servicio ni siquiera se consulta (ni el padron ni la hoja)', () => {
    const decidirReal = global.ubicacionFuenteDecisionesService_decidir;
    global.ubicacionFuenteDecisionesService_decidir = jest.fn(decidirReal);
    decidir({ sessionToken: 'tok-ana@x.com' });
    decidir({ sessionToken: 'tok-lee@x.com' });
    expect(global.ubicacionFuenteDecisionesService_decidir).not.toHaveBeenCalled();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('orden de chequeos: sesion -> formato de wellId -> permisos -> contenido', () => {
    expect(decidir({ sessionToken: 'tok-nadie@x.com', wellId: 'x' }).code).toBe('UNAUTHORIZED');
    expect(decidir({ sessionToken: 'tok-ana@x.com', wellId: 'x' }).code).toBe('INVALID_WELL_ID');
    expect(decidir({ sessionToken: 'tok-ana@x.com', accion: 'NO_EXISTE' }).code).toBe('PERMISSION_DENIED');           // el contenido invalido no se evalua sin permiso
    expect(decidir({ accion: 'NO_EXISTE' }).code).toBe('INVALID_ACCION');
  });

  test('un cambio de permisos entre dos pedidos se respeta: se consulta en cada uso', () => {
    expect(decidir().status).toBe('ok');
    global.hasPermission.mockImplementation(() => false);
    expect(decidir({ ...solicitud({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1 }) }).code).toBe('PERMISSION_DENIED');
    expect(t.filas()).toHaveLength(1);
  });
});

describe('decidirFuenteUbicacion: payload y respuesta', () => {
  test('aceptar devuelve la vista actualizada + la decision + duplicada:false', () => {
    const r = decidir();
    expect(r.status).toBe('ok');
    expect(r.data).toMatchObject({ wellId: W, version: 1, integro: true, duplicada: false });
    expect(r.data.decision).toMatchObject({ secuencia: 1, evento: 'ACEPTADA', fuenteTipo: 'REPORTE_POZOS', nombre: 'Valeria Validadora' });
    expect(r.data.fuentes.map((f) => f.estado)).toEqual(['ACEPTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(r.data.resolucion).toMatchObject({ estado: 'ACEPTADA', regla: 'R1B_REGISTRAL_ACEPTADA' });
  });

  test('las cuatro acciones del API: ACEPTAR, DESCARTAR, QUITAR_ACEPTACION y RESTAURAR', () => {
    expect(decidir({ ...REP, accion: 'ACEPTAR', versionVista: 0 }).data.decision.evento).toBe('ACEPTADA');
    expect(decidir({ ...I1, accion: 'DESCARTAR', motivo: 'Fuera del predio', versionVista: 1 }).data.decision.evento).toBe('DESCARTADA');
    expect(decidir({ ...REP, accion: 'QUITAR_ACEPTACION', versionVista: 2 }).data.decision.evento).toBe('ACEPTACION_QUITADA');
    expect(decidir({ ...I1, accion: 'RESTAURAR', versionVista: 3 }).data.decision.evento).toBe('RESTAURADA');
    expect(t.filas()).toHaveLength(4);
  });

  test('la accion se llama QUITAR_ACEPTACION: "QUITAR" a secas no existe en el API', () => {
    expect(decidir({ accion: 'QUITAR' })).toMatchObject({ status: 'error', code: 'INVALID_ACCION' });
  });

  test('STALE_STATE incluye la version actual para releer', () => {
    decidir();
    expect(decidir({ ...I1, accion: 'ACEPTAR', versionVista: 0 })).toMatchObject({ status: 'error', code: 'STALE_STATE', versionActual: 1 });
  });

  test('un reintento idempotente responde ok con duplicada:true y la misma decision', () => {
    const body = cuerpo({ clientRequestId: 'req-api-idem-1' });
    const a = post(body);
    const b = post(body);
    expect(a.data.duplicada).toBe(false);
    expect(b.status).toBe('ok');
    expect(b.data.duplicada).toBe(true);
    expect(b.data.decision).toEqual(a.data.decision);
    expect(t.filas()).toHaveLength(1);
  });

  test('un reintento cuando el padron no responde igual devuelve la decision original (sin la vista)', () => {
    const body = cuerpo({ clientRequestId: 'req-api-idem-3' });
    const a = post(body);
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('Drive caido'); });
    const b = post(body);
    expect(b.status).toBe('ok');
    expect(b.data).toEqual({ wellId: W, decision: a.data.decision, duplicada: true });
  });

  test('IDEMPOTENCY_CONFLICT con otro contenido', () => {
    post(cuerpo({ clientRequestId: 'req-api-idem-2' }));
    expect(post(cuerpo({ clientRequestId: 'req-api-idem-2', accion: 'DESCARTAR', motivo: 'x' }))).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('la respuesta no trae emails, ids internos ni anomalias tecnicas', () => {
    const r = decidir();
    const texto = JSON.stringify([r, leer()]);
    expect(texto).not.toMatch(/@x\.com|decisionId|email|anomalias|clientRequestId/);
  });
});

describe('payload manipulado a traves del API', () => {
  test('campos extra e identidad falsa en el cuerpo se ignoran: email, nombre, secuencia, fecha, estado, evento, punto operativo, fuenteKey', () => {
    const r = decidir({ email: 'otro@x.com', emailPropone: 'otro@x.com', nombre: 'Falso', secuencia: 999, decisionId: 'x', timestampUtc: '1999-01-01T00:00:00.000Z', estado: 'DESCARTADA', evento: 'DESCARTADA', fuenteKey: 'inventada', resolucion: { estado: 'X' }, lat: 1, lon: 2, autoValidar: true });
    expect(r.status).toBe('ok');
    expect(t.fila(0)).toMatchObject({ email: 'val@x.com', nombre: 'Valeria Validadora', secuencia: 1, evento: 'ACEPTADA' });
    expect(t.fila(0).timestampUtc).toBe('2026-10-14T14:32:10.123Z');
    expect(JSON.stringify(t.filas())).not.toMatch(/otro@x|Falso|inventada|1999/);
  });

  test('fuenteKey inventada o x/y alterados: SOURCE_NOT_FOUND', () => {
    expect(decidir({ fuenteKey: '14-0001|IRRIGACION|1.000|2.000', fuenteTipo: 'IRRIGACION', x: 1, y: 2 }).code).toBe('SOURCE_NOT_FOUND');
    expect(decidir({ x: P_REPORTE.x + 5 }).code).toBe('SOURCE_NOT_FOUND');
    expect(decidir({ fuenteTipo: 'IRRIGACION' }).code).toBe('SOURCE_NOT_FOUND');
    expect(t.filas()).toHaveLength(0);
  });

  test('wellId alterado: de otro pozo con las coordenadas de este, inexistente o con formato invalido', () => {
    expect(decidir({ wellId: '01-0012' }).code).toBe('SOURCE_NOT_FOUND');
    expect(decidir({ wellId: '09-9999' }).code).toBe('WELL_NOT_FOUND');
    expect(decidir({ wellId: '../../x' }).code).toBe('INVALID_WELL_ID');
    expect(decidir({ wellId: ['14-0001'] }).code).toBe('INVALID_WELL_ID');
    expect(decidir({ wellId: { toString: 'x' } }).code).toBe('INVALID_WELL_ID');
  });

  test('x / y no numericos o ausentes (el JSON no puede llevar NaN ni Infinity: llegan como null o texto): INVALID_FUENTE', () => {
    [{ x: null }, { y: null }, { x: 'NaN' }, { y: 'Infinity' }, { x: '' }, { x: [] }, { x: {} }, { x: '1e999' }].forEach((extra) => {
      expect(decidir(extra)).toMatchObject({ status: 'error', code: 'INVALID_FUENTE' });
    });
    const sinX = cuerpo();
    delete sinX.x;
    expect(post(sinX).code).toBe('INVALID_FUENTE');
  });

  test('versionVista como texto, negativa o decimal: INVALID_VERSION', () => {
    ['0', -1, 0.5, null, 'abc'].forEach((v) => expect(decidir({ versionVista: v }).code).toBe('INVALID_VERSION'));
  });

  test('clientRequestId enorme: INVALID_CLIENT_REQUEST_ID (y no se procesa)', () => {
    expect(decidir({ clientRequestId: 'a'.repeat(200000) })).toMatchObject({ status: 'error', code: 'INVALID_CLIENT_REQUEST_ID' });
    expect(t.filas()).toHaveLength(0);
  });

  test('motivo que empieza con "=": se guarda como texto literal (no se evalua) ', () => {
    decidir({ accion: 'DESCARTAR', motivo: '=IMPORTDATA("http://malo")' });
    expect(t.fila(0).motivo).toBe('=IMPORTDATA("http://malo")');
    expect(t.hojas.UbicacionFuenteDecisiones.formatos['2:' + (t.columnas.indexOf('motivo') + 1)]).toBe('@');
  });

  test('motivo con caracteres de control: se limpian; motivo enorme: INVALID_MOTIVO', () => {
    decidir({ accion: 'DESCARTAR', motivo: 'ab\u0000c\u0007d' });
    expect(t.fila(0).motivo).toBe('abcd');
    expect(decidir({ ...I2, accion: 'DESCARTAR', versionVista: 1, motivo: 'm'.repeat(5000) }).code).toBe('INVALID_MOTIVO');
  });

  test('__proto__ y constructor en el JSON del cuerpo no contaminan ni se leen como campos', () => {
    const base = JSON.stringify(cuerpo());
    const manipulado = base.slice(0, -1) + ',"__proto__":{"accion":"DESCARTAR","polluted":true},"constructor":{"prototype":{"polluted":true}}}';
    const r = post(manipulado);
    expect(r.status).toBe('ok');
    expect(t.fila(0).evento).toBe('ACEPTADA');
    expect({}.polluted).toBeUndefined();
  });

  test('accion heredada de Object.prototype: INVALID_ACCION', () => {
    ['constructor', '__proto__', 'toString', 'hasOwnProperty'].forEach((a) => expect(decidir({ accion: a }).code).toBe('INVALID_ACCION'));
  });

  test('cuerpo roto: no lanza hacia afuera (doPost devuelve un error)', () => {
    expect(post('{no es json').status).toBe('error');
    expect(post({ action: 'decidirFuenteUbicacion' }).status).toBe('error');
    expect(post({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com' }).code).toBe('INVALID_WELL_ID');
  });
});

describe('auditoria en Historial', () => {
  test('cada decision escrita deja una linea legible: FUENTE_ACEPTADA / DESCARTADA / ACEPTACION_QUITADA / RESTAURADA con resultado OK', () => {
    decidir({ ...REP, accion: 'ACEPTAR', versionVista: 0 });
    decidir({ ...I1, accion: 'DESCARTAR', motivo: 'Fuera del predio', versionVista: 1 });
    decidir({ ...REP, accion: 'QUITAR_ACEPTACION', versionVista: 2 });
    decidir({ ...I1, accion: 'RESTAURAR', versionVista: 3 });
    expect(historial()).toEqual([
      ['val@x.com', 'FUENTE_ACEPTADA', W, 'OK'], ['val@x.com', 'FUENTE_DESCARTADA', W, 'OK'],
      ['val@x.com', 'FUENTE_ACEPTACION_QUITADA', W, 'OK'], ['val@x.com', 'FUENTE_RESTAURADA', W, 'OK']
    ]);
  });

  test('los intentos fallidos se auditan con su codigo (la hoja no puede guardarlos)', () => {
    decidir();
    global.logHistoryEvent.mockClear();
    decidir({ ...I1, versionVista: 0 });                                    // STALE
    decidir({ ...REP, versionVista: 1 });                                   // ALREADY_IN_STATE
    decidir({ ...I2, accion: 'RESTAURAR', versionVista: 1 });               // ALREADY_IN_STATE
    decidir({ ...I2, accion: 'DESCARTAR', motivo: '', versionVista: 1 });   // INVALID_MOTIVO
    decidir({ sessionToken: 'tok-ana@x.com' });                              // PERMISSION_DENIED
    expect(historial().map((h) => h[3])).toEqual(['STALE_STATE', 'ALREADY_IN_STATE', 'ALREADY_IN_STATE', 'INVALID_MOTIVO', 'PERMISSION_DENIED']);
    expect(historial().slice(0, 4).every((h) => h[1] === 'decidirFuenteUbicacion' && h[2] === W)).toBe(true);
  });

  test('el reintento idempotente NO se audita otra vez', () => {
    const body = cuerpo({ clientRequestId: 'req-api-aud-01' });
    post(body);
    global.logHistoryEvent.mockClear();
    post(body);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('Historial no recibe el payload, el motivo, coordenadas ni emails ajenos', () => {
    decidir({ ...I1, accion: 'DESCARTAR', motivo: 'Motivo-SECRETO-123' });
    decidir({ sessionToken: 'tok-vero@x.com', ...REP, accion: 'ACEPTAR', versionVista: 99 });
    const texto = JSON.stringify(historial());
    expect(texto).not.toMatch(/Motivo-SECRETO|2486|6310|req-|IRRIGACION|REPORTE_POZOS|vero@x\.com.*val@x\.com/);
    historial().forEach((h) => expect(h).toHaveLength(4));
  });

  test('sin Telegram ni notificaciones: no se llama a nada de eso', () => {
    global.ubicacionCorreccionNotificacion_notificarPendiente = jest.fn();
    decidir();
    expect(global.ubicacionCorreccionNotificacion_notificarPendiente).not.toHaveBeenCalled();
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test('una falla de Historial no rompe la decision (logHistoryEvent ya traga sus errores)', () => {
    global.logHistoryEvent.mockImplementation(() => {});
    expect(decidir().status).toBe('ok');
  });
});

describe('errores internos: mensaje generico, detalle solo en el log', () => {
  test('hoja inexistente: SERVICE_UNAVAILABLE generico (sin nombres de hoja ni textos de Sheets) en lectura y escritura', () => {
    const t2 = armar({ sinHoja: true });
    const p = (b) => JSON.parse(t2.Api.doPost({ postData: { contents: JSON.stringify(b) } }).text);
    const lectura = p({ action: 'getDecisionesFuentesPozo', sessionToken: 'tok-val@x.com', wellId: W });
    const escritura = p({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', ...solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }) });
    [lectura, escritura].forEach((r) => {
      expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    });
    expect(JSON.stringify([lectura, escritura])).not.toMatch(/UbicacionFuenteDecisiones|hoja|setup|spreadsheet/i);
    expect(global.Logger.log.mock.calls.some((c) => /Decisiones de fuentes: .* fallo: Error: No existe una hoja/.test(String(c[0])))).toBe(true);        // el detalle (recortado) va al log
    expect(global.logHistoryEvent).toHaveBeenCalledWith('val@x.com', 'decidirFuenteUbicacion', W, 'SERVICE_UNAVAILABLE');
  });

  test('esquema roto o lock vencido: tambien generico', () => {
    t.hojas.UbicacionFuenteDecisiones.filas[0] = ['solo', 'dos'];
    expect(decidir()).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    t.hojas.UbicacionFuenteDecisiones.filas[0] = t.columnas.slice();
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('Lock timeout: otro proceso'); }, releaseLock: () => {} }) };
    const r = decidir();
    expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(t.filas()).toHaveLength(0);
  });

  test('un fallo del padron (Drive) tambien es generico', () => {
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('Drive: archivo 07-3.json no accesible'); });
    const r = decidir();
    expect(r.message).toBe('servicio no disponible');
    expect(JSON.stringify(r)).not.toMatch(/Drive|json/);
  });

  test('pozo inconsistente: INCONSISTENT_STATE (con el mensaje de dominio, sin anomalias)', () => {
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'a', secuencia: 1, wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: 'RESTAURADA' }[c] || '')));
    const r = decidir({ versionVista: 1 });
    expect(r).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(JSON.stringify(r)).not.toMatch(/TRANSICION_INVALIDA|anomalia/i);
    expect(historial().pop()[3]).toBe('INCONSISTENT_STATE');
  });
});

describe('lo que NO cambia', () => {
  test('el padron nunca se escribe: ningun servicio de registro fue invocado para escribir', () => {
    decidir();
    const escritores = Object.keys(global).filter((k) => /^registry.*(set|write|update|save|put)/i.test(k));
    expect(escritores).toEqual([]);
  });

  test('las hojas de correcciones no existen en este entorno y nada las toco ni las necesito', () => {
    expect(Object.keys(t.hojas)).toEqual(['UbicacionFuenteDecisiones']);
    decidir();
    expect(Object.keys(t.hojas)).toEqual(['UbicacionFuenteDecisiones']);
  });
});
