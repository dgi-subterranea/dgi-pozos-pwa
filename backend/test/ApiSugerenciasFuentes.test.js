// API de las SUGERENCIAS sobre fuentes registrales, enrutada por doPost: sugerirDecisionFuente (ubicacion), getSugerenciasFuentesPozo (ubicacion), getSugerenciasFuentesPendientes y
// resolverSugerenciaFuente (ubicacion + ubicacion_validar) y cancelarSugerenciaFuente (ubicacion, solo el autor). Permisos fail-closed, orden de chequeos, lista blanca de campos,
// identidad de la sesion, auditoria en Historial, errores genericos y privacidad. Servicios, repositorios y dominio REALES.
const { armarSug, W, REP, I1, I2, nuevoId } = require('./sugerenciasHelper');

let t;
beforeEach(() => {
  t = armarSug();
  global.sheetUserRepository_listarConPermisos = jest.fn(() => []);
  global.getPwaUrl = jest.fn(() => '');
  global.MailApp = { sendEmail: jest.fn(), getRemainingDailyQuota: jest.fn(() => 100) };
});
afterEach(() => { jest.restoreAllMocks(); });

const post = (body) => JSON.parse(t.Api.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
const sugerirBody = (extra, quien) => ({ action: 'sugerirDecisionFuente', sessionToken: 'tok-' + (quien || 'lee@x.com'), ...t.payloadSug({ versionVista: 0 }), ...(extra || {}) });
const sugerir = (extra, quien) => post(sugerirBody(extra, quien));
const verPozo = (quien, wellId) => post({ action: 'getSugerenciasFuentesPozo', sessionToken: 'tok-' + (quien || 'lee@x.com'), wellId: wellId === undefined ? W : wellId });
const cola = (quien) => post({ action: 'getSugerenciasFuentesPendientes', sessionToken: 'tok-' + (quien || 'val@x.com') });
const resolver = (id, extra, quien) => post({ action: 'resolverSugerenciaFuente', sessionToken: 'tok-' + (quien || 'val@x.com'), sugerenciaId: id, resolucion: 'APROBAR', motivo: '', versionVista: t.versionDe(W), clientRequestId: nuevoId(), ...(extra || {}) });
const cancelar = (id, extra, quien) => post({ action: 'cancelarSugerenciaFuente', sessionToken: 'tok-' + (quien || 'lee@x.com'), sugerenciaId: id, motivo: '', clientRequestId: nuevoId(), ...(extra || {}) });
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());
const nueva = (extra, quien) => sugerir(extra, quien).data.sugerencia.sugerenciaId;

describe('enrutado por doPost', () => {
  test('las cinco acciones existen y responden', () => {
    const id = nueva();
    expect(verPozo().status).toBe('ok');
    expect(cola().status).toBe('ok');
    expect(cancelar(id).status).toBe('ok');
    const id2 = nueva({ ...I1 });
    expect(resolver(id2, { versionVista: 0 }).status).toBe('ok');
  });

  test('acciones parecidas pero inexistentes siguen siendo "accion desconocida"', () => {
    ['sugerirDecision', 'getSugerencias', 'aprobarSugerenciaFuente', 'rechazarSugerenciaFuente', 'getSugerenciasFuentesDelta'].forEach((a) => {
      expect(post({ action: a, sessionToken: 'tok-val@x.com' }).message).toMatch(/accion desconocida/);
    });
  });

  test('las decisiones directas siguen funcionando igual (y un id "sug-..." sigue reservado)', () => {
    const r = post({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-directo-01' });
    expect(r.status).toBe('ok');
    expect(post({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1, clientRequestId: 'sug-reservado-1' })).toMatchObject({ status: 'error', code: 'INVALID_CLIENT_REQUEST_ID' });
  });
});

describe('permisos (fail-closed, mas usuario activo)', () => {
  test.each([
    ['lee@x.com (ubicacion)', 'lee@x.com', true], ['ana@x.com (ubicacion + corregir)', 'ana@x.com', true], ['val@x.com (valida: tecnicamente puede)', 'val@x.com', true],
    ['soloval@x.com (valida pero SIN ubicacion)', 'soloval@x.com', false], ['nada@x.com', 'nada@x.com', false]
  ])('sugerirDecisionFuente con %s', (_n, email, permitido) => {
    const r = sugerir({}, email);
    if (permitido) {
      expect(r.status).toBe('ok');
    } else {
      expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(t.filasSug()).toHaveLength(0);
    }
  });

  test.each([
    ['val@x.com', true], ['vero@x.com', true], ['carla@x.com', true],
    ['lee@x.com (no valida)', false], ['ana@x.com (solo corrige)', false], ['soloval@x.com (sin ubicacion)', false], ['nada@x.com', false]
  ])('cola y resolver: %s', (email, permitido) => {
    const quien = email.split(' ')[0];
    const id = nueva({}, 'lee@x.com');
    const c = cola(quien);
    const r = resolver(id, { versionVista: 0, clientRequestId: nuevoId() }, quien);
    if (permitido) {
      expect(c.status).toBe('ok');
      expect(r.status).toBe('ok');
    } else {
      expect(c).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(t.filasDec()).toHaveLength(0);
      expect(t.filasSug()).toHaveLength(1);
    }
  });

  test('ubicacion_corregir NO concede resolver ni ver la cola', () => {
    const id = nueva();
    expect(resolver(id, {}, 'ana@x.com').code).toBe('PERMISSION_DENIED');
    expect(cola('ana@x.com').code).toBe('PERMISSION_DENIED');
  });

  test('getSugerenciasFuentesPozo y cancelarSugerenciaFuente exigen ubicacion', () => {
    const id = nueva();
    expect(verPozo('soloval@x.com').code).toBe('PERMISSION_DENIED');
    expect(verPozo('nada@x.com').code).toBe('PERMISSION_DENIED');
    expect(cancelar(id, {}, 'soloval@x.com').code).toBe('PERMISSION_DENIED');
    expect(cancelar(id, {}, 'nada@x.com').code).toBe('PERMISSION_DENIED');
  });

  test('usuario inactivo: USER_DISABLED aunque tenga todos los permisos; token invalido: UNAUTHORIZED; no se escribe nada', () => {
    expect(sugerir({}, 'baja@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
    expect(cola('baja@x.com').code).toBe('USER_DISABLED');
    expect(resolver('x'.repeat(10), {}, 'baja@x.com').code).toBe('USER_DISABLED');
    expect(cancelar('x'.repeat(10), {}, 'baja@x.com').code).toBe('USER_DISABLED');
    expect(verPozo('baja@x.com').code).toBe('USER_DISABLED');
    ['sugerirDecisionFuente', 'getSugerenciasFuentesPozo', 'getSugerenciasFuentesPendientes', 'resolverSugerenciaFuente', 'cancelarSugerenciaFuente'].forEach((a) => {
      expect(post({ action: a, sessionToken: 'basura', wellId: W })).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    });
    expect(t.filasSug()).toHaveLength(0);
  });

  test('sin permiso el servicio ni siquiera se consulta (ni el padron ni las hojas)', () => {
    global.registryService_getWellLocation.mockClear();
    const listarSug = jest.fn(t.RepoSug.ubicacionFuenteSugerenciasRepository_listar);
    global.ubicacionFuenteSugerenciasRepository_listar = listarSug;
    sugerir({}, 'nada@x.com');
    verPozo('nada@x.com');
    cola('lee@x.com');
    resolver('x'.repeat(10), {}, 'lee@x.com');
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
    expect(listarSug).not.toHaveBeenCalled();
  });

  test('orden de chequeos: sesion -> formato de wellId -> permisos -> contenido', () => {
    expect(sugerir({ wellId: 'zz' }, 'nada@x.com').code).toBe('INVALID_WELL_ID');                    // formato antes que permisos
    expect(sugerir({ accionSugerida: 'BASURA' }, 'nada@x.com').code).toBe('PERMISSION_DENIED');      // permisos antes que contenido
    expect(sugerir({ wellId: 'zz' }, 'baja@x.com').code).toBe('USER_DISABLED');                       // sesion primero
    expect(verPozo('nada@x.com', 'zz').code).toBe('INVALID_WELL_ID');
    expect(resolver('x'.repeat(10), { resolucion: 'BASURA' }, 'lee@x.com').code).toBe('PERMISSION_DENIED');
  });

  test('un cambio de permisos entre dos pedidos se respeta (se consulta en cada uso)', () => {
    expect(sugerir({}, 'lee@x.com').status).toBe('ok');
    global.hasPermission.mockImplementation(() => false);
    expect(sugerir({ ...I1 }, 'lee@x.com').code).toBe('PERMISSION_DENIED');
  });
});

describe('sugerirDecisionFuente: payload y respuesta', () => {
  test('crea la sugerencia y devuelve el item seguro + duplicada:false; la identidad sale de la SESION', () => {
    const r = sugerir({ accionSugerida: 'DESCARTAR', motivo: 'cae en el rio', ...I2 }, 'ana@x.com');
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data).sort()).toEqual(['duplicada', 'sugerencia']);
    expect(r.data.duplicada).toBe(false);
    expect(r.data.sugerencia).toMatchObject({ wellId: W, fuenteTipo: 'IRRIGACION', accionSugerida: 'DESCARTAR', motivo: 'cae en el rio', nombre: 'Ana Corrige', estado: 'PENDIENTE' });
    expect(t.filasSug()[0]).toMatchObject({ email: 'ana@x.com', nombre: 'Ana Corrige', evento: 'PROPUESTA' });
  });

  test('campos extra e identidad falsa en el cuerpo se ignoran (email, nombre, secuencia, fecha, estado, evento, sugerenciaId, decisionId...)', () => {
    sugerir({ email: 'otro@x.com', nombre: 'Falso', secuencia: 999, timestampUtc: '1999-01-01', estado: 'APROBADA', evento: 'APROBADA', sugerenciaId: 'inventada-0001', decisionId: 'x', emailPropone: 'z@x.com', nombrePropone: 'Z', resolucion: 'APROBAR' });
    expect(t.filasSug()).toHaveLength(1);
    expect(t.filasSug()[0]).toMatchObject({ email: 'lee@x.com', nombre: 'Lee Soloubicacion', secuencia: 1, evento: 'PROPUESTA' });
    expect(t.filasSug()[0].sugerenciaId).not.toBe('inventada-0001');
    expect(t.filasSug()[0].timestampUtc).toBe('2026-10-14T14:32:10.123Z');
    expect(t.filasDec()).toHaveLength(0);
  });

  test('ALREADY_PENDING: error estable con la sugerencia existente (sin emails); PENDING_LIMIT_REACHED con el limite; STALE no existe al sugerir', () => {
    const id = nueva();
    const dup = sugerir({ clientRequestId: nuevoId() });
    expect(dup).toMatchObject({ status: 'error', code: 'ALREADY_PENDING', sugerencia: { sugerenciaId: id, estado: 'PENDIENTE' } });
    expect(JSON.stringify(dup)).not.toMatch(/@/);
    t.sembrarAplicables(9, 'lee@x.com', { x: REP.x + 0 });
    expect(sugerir({ ...I1 })).toMatchObject({ status: 'error', code: 'PENDING_LIMIT_REACHED', limite: 10 });
  });

  test('un reintento idempotente responde ok con duplicada:true y la misma sugerencia', () => {
    const body = sugerirBody({ clientRequestId: 'req-api-sug-01' });
    const a = post(body);
    const b = post(body);
    expect(b.data).toMatchObject({ duplicada: true });
    expect(b.data.sugerencia.sugerenciaId).toBe(a.data.sugerencia.sugerenciaId);
    expect(post(sugerirBody({ clientRequestId: 'req-api-sug-01', motivo: 'otro' }))).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('QUITAR_ACEPTACION no se puede sugerir', () => {
    expect(sugerir({ accionSugerida: 'QUITAR_ACEPTACION' })).toMatchObject({ status: 'error', code: 'INVALID_ACCION' });
  });

  test('el campo "accion" de las decisiones NO sirve: hay que mandar accionSugerida', () => {
    const b = sugerirBody({});
    delete b.accionSugerida;
    b.accion = 'ACEPTAR';
    expect(post(b)).toMatchObject({ status: 'error', code: 'INVALID_ACCION' });
  });
});

describe('lecturas por API', () => {
  test('quien no valida ve solo las suyas; el validador ve todas las pendientes del pozo; el nombre del proponente si, el email nunca', () => {
    nueva({ accionSugerida: 'ACEPTAR' }, 'lee@x.com');
    nueva({ accionSugerida: 'ACEPTAR', ...I1 }, 'ana@x.com');
    const lee = verPozo('lee@x.com');
    expect(lee.data.sugerencias).toHaveLength(1);
    expect(lee.data.sugerencias[0].nombre).toBe('Lee Soloubicacion');
    const val = verPozo('val@x.com');
    expect(val.data.sugerencias.map((s) => s.nombre).sort()).toEqual(['Ana Corrige', 'Lee Soloubicacion']);
    [lee, val, cola()].forEach((r) => expect(JSON.stringify(r)).not.toMatch(/@|clientRequestId|secuencia|req-0/));
  });

  test('la cola es compacta y trae lo necesario para revisar (pozo, fuente, lat/lon, accion, proponente, fecha, motivo, estado actual, version)', () => {
    nueva({ accionSugerida: 'DESCARTAR', motivo: 'queda lejos', ...I2 }, 'ana@x.com');
    const r = cola();
    expect(r.data).toMatchObject({ total: 1, noAplicables: 0, inconsistentes: 0 });
    const it = r.data.pendientes[0];
    expect(Object.keys(it).sort()).toEqual(['accionSugerida', 'aplicable', 'estado', 'estadoFuente', 'etiquetaFuente', 'fuenteTipo', 'lat', 'lon', 'motivo', 'motivoNoAplicable', 'nombre', 'resolucion', 'sugerenciaId', 'timestampUtc', 'versionVista', 'wellId', 'x', 'y']);
    expect(it).toMatchObject({ wellId: W, etiquetaFuente: 'Irrigación (2)', accionSugerida: 'DESCARTAR', nombre: 'Ana Corrige', motivo: 'queda lejos', estadoFuente: 'SIN_REVISAR', versionVista: 0 });
  });

  test('pozo invalido o inexistente en la lectura', () => {
    expect(verPozo('lee@x.com', 'zz')).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
    expect(verPozo('lee@x.com', '15-0005')).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(verPozo('lee@x.com', ['14-0001'])).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
  });

  test('las lecturas no se auditan (patron del proyecto) salvo los rechazos', () => {
    nueva();
    global.logHistoryEvent.mockClear();
    verPozo('lee@x.com');
    cola();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    verPozo('nada@x.com');
    expect(historial().map((h) => h[3])).toEqual(['PERMISSION_DENIED']);
  });
});

describe('resolver y cancelar por API', () => {
  test('APROBAR: respuesta con resultado, sugerencia, decision y la vista actualizada de las fuentes; la fuente queda ACEPTADA para todos', () => {
    const id = nueva({ accionSugerida: 'ACEPTAR', ...I1 });
    const r = resolver(id, { versionVista: 0 });
    expect(r.status).toBe('ok');
    expect(r.data).toMatchObject({ resultado: 'APROBADA', duplicada: false, sugerencia: { estado: 'APROBADA' }, decision: { evento: 'ACEPTADA' } });
    expect(r.data.fuentes.fuentes.filter((f) => f.x === I1.x)[0].estado).toBe('ACEPTADA');
    expect(post({ action: 'getDecisionesFuentesPozo', sessionToken: 'tok-lee@x.com', wellId: W }).data.fuentes.filter((f) => f.x === I1.x)[0].estado).toBe('ACEPTADA');
    expect(verPozo('lee@x.com').data.sugerencias[0]).toMatchObject({ estado: 'APROBADA', resolucion: { nombre: 'Valeria Validadora' } });
    expect(JSON.stringify(r)).not.toMatch(/@|clientRequestId|decisionId/);        // (decision.secuencia es la misma que ya devuelve decidirFuenteUbicacion)
    expect(JSON.stringify(r.data.sugerencia)).not.toMatch(/secuencia/);
  });

  test('un campo "wellId", "fuenteTipo", "x" o "accionSugerida" en el cuerpo de resolver NO puede redirigir la aprobacion: se aplica lo que dice la sugerencia guardada', () => {
    const id = nueva({ accionSugerida: 'ACEPTAR', ...I1 });
    resolver(id, { versionVista: 0, wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: 1, y: 1, accionSugerida: 'DESCARTAR', accion: 'DESCARTAR' });
    expect(t.filasDec()).toHaveLength(1);
    expect(t.filasDec()[0]).toMatchObject({ wellId: W, evento: 'ACEPTADA', x: I1.x });
  });

  test('STALE_STATE trae versionActual; OBSOLETA devuelve ok con el motivo; ALREADY_RESOLVED trae el estado', () => {
    const id = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    post({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-directo-02' });
    expect(resolver(id, { versionVista: 0 })).toMatchObject({ status: 'error', code: 'STALE_STATE', versionActual: 1 });
    const o = resolver(id, { versionVista: 1 });
    expect(o).toMatchObject({ status: 'ok', data: { resultado: 'OBSOLETA', motivoNoAplicable: 'YA_ESTA_ASI', sugerencia: { estado: 'OBSOLETA' } } });
    expect(resolver(id, { versionVista: 1 })).toMatchObject({ status: 'error', code: 'ALREADY_RESOLVED', estado: 'OBSOLETA' });
  });

  test('RECHAZAR exige motivo y no crea decision', () => {
    const id = nueva();
    expect(resolver(id, { resolucion: 'RECHAZAR', motivo: '' })).toMatchObject({ status: 'error', code: 'INVALID_MOTIVO' });
    const r = resolver(id, { resolucion: 'RECHAZAR', motivo: 'no corresponde' });
    expect(r.data).toMatchObject({ resultado: 'RECHAZADA', sugerencia: { estado: 'RECHAZADA', resolucion: { motivo: 'no corresponde' } } });
    expect(r.data.decision).toBeUndefined();
    expect(r.data.fuentes).toBeUndefined();
    expect(t.filasDec()).toHaveLength(0);
  });

  test('cancelar: solo el autor; los demas reciben SUGGESTION_NOT_FOUND', () => {
    const id = nueva({}, 'lee@x.com');
    expect(cancelar(id, {}, 'ana@x.com')).toMatchObject({ status: 'error', code: 'SUGGESTION_NOT_FOUND' });
    expect(cancelar(id, {}, 'val@x.com')).toMatchObject({ status: 'error', code: 'SUGGESTION_NOT_FOUND' });
    const ok = cancelar(id, { motivo: 'me equivoque' }, 'lee@x.com');
    expect(ok).toMatchObject({ status: 'ok', data: { duplicada: false, sugerencia: { estado: 'CANCELADA' } } });
  });

  test('el flujo completo: un usuario sugiere, el validador ve la cola, aprueba, y la cola queda vacia', () => {
    const id = nueva({ accionSugerida: 'DESCARTAR', motivo: 'esta mal', ...I2 }, 'lee@x.com');
    expect(cola().data.total).toBe(1);
    expect(resolver(id, { versionVista: 0 }).data.resultado).toBe('APROBADA');
    expect(cola().data).toMatchObject({ total: 0, pendientes: [] });
    expect(t.filasDec()[0]).toMatchObject({ evento: 'DESCARTADA', motivo: 'esta mal', email: 'val@x.com' });
  });
});

describe('auditoria en Historial', () => {
  test('cada evento deja una linea legible con resultado OK; aprobar deja la de la decision y la de la sugerencia', () => {
    const a = nueva({ accionSugerida: 'ACEPTAR', ...I1 });
    const b = nueva({ accionSugerida: 'ACEPTAR', ...I2 });
    const c = nueva({ accionSugerida: 'DESCARTAR', motivo: 'x', ...REP });
    const d = nueva({ accionSugerida: 'ACEPTAR', wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: 2500000, y: 6350000 });
    global.logHistoryEvent.mockClear();
    resolver(a, { versionVista: 0 });
    resolver(b, { resolucion: 'RECHAZAR', motivo: 'no' });
    cancelar(c);
    t.padron['01-0012'].coordenadasProvincia = [];
    resolver(d, { versionVista: 0 });
    expect(historial().filter((h) => h[3] === 'OK').map((h) => h[1])).toEqual(['FUENTE_ACEPTADA', 'FUENTE_SUGERENCIA_APROBADA', 'FUENTE_SUGERENCIA_RECHAZADA', 'FUENTE_SUGERENCIA_CANCELADA', 'FUENTE_SUGERENCIA_OBSOLETA']);
  });

  test('la creacion deja FUENTE_SUGERIDA', () => {
    sugerir({});
    expect(historial().filter((h) => h[1] === 'FUENTE_SUGERIDA')).toEqual([['lee@x.com', 'FUENTE_SUGERIDA', W, 'OK']]);
  });

  test('los intentos fallidos se auditan con su codigo', () => {
    const id = nueva();
    global.logHistoryEvent.mockClear();
    sugerir({ clientRequestId: nuevoId() });                              // ALREADY_PENDING
    sugerir({ accionSugerida: 'RESTAURAR', ...I1 });                      // ALREADY_IN_STATE
    resolver(id, { versionVista: 7 });                                    // STALE_STATE
    resolver(id, { resolucion: 'RECHAZAR', motivo: '' });                 // INVALID_MOTIVO
    cancelar(id, {}, 'ana@x.com');                                        // SUGGESTION_NOT_FOUND
    cola('lee@x.com');                                                    // PERMISSION_DENIED
    expect(historial().map((h) => h[3])).toEqual(['ALREADY_PENDING', 'ALREADY_IN_STATE', 'STALE_STATE', 'INVALID_MOTIVO', 'SUGGESTION_NOT_FOUND', 'PERMISSION_DENIED']);
    expect(historial().map((h) => h[1])).toEqual(['sugerirDecisionFuente', 'sugerirDecisionFuente', 'resolverSugerenciaFuente', 'resolverSugerenciaFuente', 'cancelarSugerenciaFuente', 'getSugerenciasFuentesPendientes']);
  });

  test('los reintentos idempotentes NO se auditan otra vez', () => {
    const body = sugerirBody({ clientRequestId: 'req-api-aud-s1' });
    post(body);
    global.logHistoryEvent.mockClear();
    post(body);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    const id = nueva({ ...I1 });
    const r = { clientRequestId: 'req-api-aud-s2', versionVista: 0 };
    resolver(id, r);
    global.logHistoryEvent.mockClear();
    resolver(id, r);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('Historial no recibe el payload, motivos, coordenadas ni emails ajenos', () => {
    const id = nueva({ accionSugerida: 'DESCARTAR', motivo: 'Motivo-SECRETO-777', ...I1 }, 'lee@x.com');
    resolver(id, { versionVista: 0, motivo: 'Aprobacion-SECRETA-888' }, 'vero@x.com');
    const texto = JSON.stringify(historial());
    expect(texto).not.toMatch(/SECRET|2486|6310|req-|IRRIGACION|REPORTE_POZOS/);
    // cada linea tiene SOLO el email de quien actuo (el proponente o el validador), nunca el de otra persona
    historial().forEach((h) => { expect(h).toHaveLength(4); expect(h.filter((c) => /@/.test(String(c)))).toHaveLength(1); });
    expect(historial().filter((h) => h[1] === 'FUENTE_SUGERENCIA_APROBADA')[0][0]).toBe('vero@x.com');
  });
});

describe('errores internos: mensaje generico, detalle solo en el log', () => {
  test('hoja de sugerencias inexistente: SERVICE_UNAVAILABLE generico en todas las operaciones, sin nombres de hoja', () => {
    const t2 = armarSug({ sinHojaSug: true });
    t = t2;
    global.sheetUserRepository_listarConPermisos = jest.fn(() => []);
    global.MailApp = { sendEmail: jest.fn(), getRemainingDailyQuota: jest.fn(() => 100) };
    const respuestas = [sugerir({}), verPozo('lee@x.com'), cola(), resolver('x'.repeat(10)), cancelar('x'.repeat(10))];
    respuestas.forEach((r) => {
      expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
      expect(JSON.stringify(r)).not.toMatch(/Ubicacion|hoja|sheet|setup/i);
    });
    expect(global.Logger.log.mock.calls.some((c) => /sugerirDecisionFuente fallo/.test(String(c[0])))).toBe(true);           // el detalle va solo al log
  });

  test('esquema roto, lock vencido y caida del padron: tambien genericos', () => {
    t.hojas.UbicacionFuenteSugerencias.filas[0] = ['x'];
    expect(sugerir({})).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    const t2 = armarSug();
    t = t2;
    global.sheetUserRepository_listarConPermisos = jest.fn(() => []);
    global.MailApp = { sendEmail: jest.fn(), getRemainingDailyQuota: jest.fn(() => 100) };
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('Lock timeout'); }, releaseLock: () => {} }) };
    expect(sugerir({})).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('Drive caido ID-SECRETO'); });
    expect(verPozo('lee@x.com')).toMatchObject({ code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
  });

  test('una falla al armar la respuesta no filtra el mensaje interno', () => {
    global.ubicacionFuenteSugerenciasService_getPendientes = jest.fn(() => { throw new Error('TypeError: interno ABC123'); });
    const r = cola();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(JSON.stringify(r)).not.toMatch(/ABC123|TypeError/);
  });
});

describe('seguridad: payloads manipulados', () => {
  test('__proto__ y constructor en el JSON no contaminan ni se leen como campos', () => {
    const body = '{"action":"sugerirDecisionFuente","sessionToken":"tok-lee@x.com","wellId":"14-0001","fuenteTipo":"REPORTE_POZOS","x":' + REP.x + ',"y":' + REP.y + ',"accionSugerida":"ACEPTAR","motivo":"","versionVista":0,"clientRequestId":"req-proto-0001","__proto__":{"email":"x@x.com","accionSugerida":"DESCARTAR"},"constructor":{"prototype":{"polluted":true}}}';
    const r = post(body);
    expect(r.status).toBe('ok');
    expect({}.polluted).toBeUndefined();
    expect({}.email).toBeUndefined();
    expect(t.filasSug()[0]).toMatchObject({ accionSugerida: 'ACEPTAR', email: 'lee@x.com' });
  });

  test.each([['sugerenciaId enorme', 'a'.repeat(5000)], ['sugerenciaId con ../', '../../etc/passwd'], ['sugerenciaId arreglo', ['x'.repeat(10)]], ['sugerenciaId objeto', { a: 1 }], ['sugerenciaId numero', 1234567890], ['sugerenciaId vacio', '']])('resolver con %s: INVALID_SUGERENCIA_ID y no se escribe', (_n, id) => {
    expect(resolver(id)).toMatchObject({ status: 'error', code: 'INVALID_SUGERENCIA_ID' });
    expect(cancelar(id)).toMatchObject({ status: 'error', code: 'INVALID_SUGERENCIA_ID' });
    expect(t.filasSug()).toHaveLength(0);
    expect(t.filasDec()).toHaveLength(0);
  });

  test('clientRequestId enorme o con caracteres raros: INVALID_CLIENT_REQUEST_ID y no se procesa', () => {
    expect(sugerir({ clientRequestId: 'x'.repeat(5000) }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(sugerir({ clientRequestId: 'con espacios y ñ' }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(t.filasSug()).toHaveLength(0);
  });

  test('x / y / versionVista no numericos (en JSON llegan como null o texto): errores de forma, no se escribe', () => {
    expect(sugerir({ x: null }).code).toBe('INVALID_FUENTE');
    expect(sugerir({ y: 'abc' }).code).toBe('INVALID_FUENTE');
    expect(sugerir({ versionVista: '0' }).code).toBe('INVALID_VERSION');
    expect(sugerir({ versionVista: null }).code).toBe('INVALID_VERSION');
    expect(post('{"action":"sugerirDecisionFuente","sessionToken":"tok-lee@x.com","wellId":"14-0001","fuenteTipo":"REPORTE_POZOS","x":1e999,"y":1,"accionSugerida":"ACEPTAR","versionVista":0,"clientRequestId":"req-inf-0001"}').code).toBe('INVALID_FUENTE');
    expect(t.filasSug()).toHaveLength(0);
  });

  test('wellId alterado: formato invalido, inexistente, o de otro pozo con las coordenadas de este', () => {
    expect(sugerir({ wellId: '14-0001; DROP' }).code).toBe('INVALID_WELL_ID');
    expect(sugerir({ wellId: ['14-0001'] }).code).toBe('INVALID_WELL_ID');
    expect(sugerir({ wellId: '15-0005' }).code).toBe('WELL_NOT_FOUND');
    expect(sugerir({ wellId: '01-0012' }).code).toBe('SOURCE_NOT_FOUND');
    expect(t.filasSug()).toHaveLength(0);
  });

  test('motivo con "=" queda como texto literal; motivo enorme: INVALID_MOTIVO', () => {
    expect(sugerir({ motivo: '=HYPERLINK("x")' }).status).toBe('ok');
    expect(t.filasSug()[0].motivo).toBe('=HYPERLINK("x")');
    expect(sugerir({ ...I1, motivo: 'm'.repeat(5000) }).code).toBe('INVALID_MOTIVO');
  });

  test('accion/resolucion heredada de Object.prototype o con tipos raros: invalida', () => {
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach((a) => {
      expect(sugerir({ accionSugerida: a }).code).toBe('INVALID_ACCION');
      expect(resolver('x'.repeat(10), { resolucion: a }).code).toBe('INVALID_RESOLUCION');
    });
  });

  test('cuerpo roto: no lanza hacia afuera', () => {
    expect(() => post('{no es json')).not.toThrow();
    expect(post('{no es json').status).toBe('error');
  });

  test('un usuario no puede ver ni cancelar las de otro (ni adivinando el id)', () => {
    const id = nueva({}, 'lee@x.com');
    expect(verPozo('ana@x.com').data.sugerencias).toEqual([]);
    expect(cancelar(id, {}, 'ana@x.com').code).toBe('SUGGESTION_NOT_FOUND');
    expect(t.filasSug()).toHaveLength(1);
  });
});
