// E9-5, capa Api de la MODERACION de ITF: gates exactos de permiso (perfil + perfil_validar === true) en los 5 endpoints del validador y perfil + perfil_subir en retirarPropuestaItf, orden sesion -> permisos ->
// interruptor -> lista blanca, campos que el cliente NUNCA manda, DTO minimo, Historial resumido (un reintento no escribe otra fila) y la cadena REAL Api -> ItfService -> proveedor de storage -> cliente HMAC
// con hoja, Drive y storage en memoria. Nada toca Google.
const { crearEntorno, JPEG } = require('./itfEntorno');

const PROPONENTE = 'ana.proponente@example.com';
const VALIDADOR = 'val.validador@example.com';
const AMBOS = 'carla.ambos@example.com';
const W = '14-0001';
const LEGACY_ID = 'LEGACY:' + W;
const BYTES_LEGACY = JPEG(300, 5);
const PERMISOS = {
  [PROPONENTE]: { perfil: true, perfil_subir: true },
  [VALIDADOR]: { perfil: true, perfil_validar: true },
  [AMBOS]: { perfil: true, perfil_subir: true, perfil_validar: true }
};
const NOMBRES = { [PROPONENTE]: 'Ana Proponente', [VALIDADOR]: 'Valeria Validadora', [AMBOS]: 'Carla Ambos' };

let E;
let Api;
let almacen;
let llamadasStorage;
let n = 0;
let actual;

const crid = () => { n += 1; return 'mod-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');
const filas = () => E.hoja.filas.slice(1);
const eventos = () => E.mods.repo.itfEventosRepository_leerTodos().eventos;

function como(email, permisosForzados) {
  actual = email;
  const permisos = permisosForzados || PERMISOS[email] || {};
  global.verifySessionToken.mockReturnValue({ valid: true, email: email });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((e, modulo) => permisos[modulo] === true);
  global.getUserAccess.mockReturnValue({ nombre: NOMBRES[email] || 'Persona' });
}

function montar(opciones) {
  E = crearEntorno(Object.assign({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } }, opciones || {}));
  Api = require('../src/Api');
  almacen = {};
  llamadasStorage = [];
  global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
    llamadasStorage.push({ accion: accion, payload: payload });
    if (accion === 'putItf') {
      const ref = 'itf-ref-' + String(Object.keys(almacen).length + 1).padStart(6, '0');
      almacen[ref] = payload;
      return { status: 'ok', driveFileId: ref, tamanoBytes: Buffer.from(payload.imagenBase64, 'base64').length };
    }
    if (accion === 'metaItf' || accion === 'getItf') {
      const f = almacen[payload.driveFileId];
      if (!f) { throw new Error('storage devolvio error: NOT_FOUND'); }
      return accion === 'metaItf' ? { status: 'ok', mimeType: f.mimeType, tamanoBytes: Buffer.from(f.imagenBase64, 'base64').length } : { status: 'ok', mimeType: f.mimeType, imagenBase64: f.imagenBase64, tamanoBytes: 1 };
    }
    if (accion === 'trashItf') { delete almacen[payload.driveFileId]; return { status: 'ok' }; }
    throw new Error('accion inesperada ' + accion);
  });
  global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: {} }));
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  global.UrlFetchApp = { fetch: jest.fn() };
  como(PROPONENTE);
}
beforeEach(() => montar());

function proponer(relleno, wellId, email) {
  const previo = actual;
  como(email || PROPONENTE);
  const r = Api.handleProponerItf('t', { wellId: wellId || W, imageBase64: b64(JPEG(400, relleno)), mimeType: 'image/jpeg', nombreOriginal: 'itf-' + relleno + '.jpg', clientRequestId: crid() });
  como(previo);
  expect(r.status).toBe('ok');
  return r.data.documentoId;
}
const comoVal = () => como(VALIDADOR);
const pendientes = (b) => Api.handleGetItfPendientes('t', Object.assign({ action: 'getItfPendientes', sessionToken: 't' }, b || {}));
const abrir = (documentoId) => Api.handleGetItfDocumentoModeracion('t', { action: 'getItfDocumentoModeracion', sessionToken: 't', documentoId: documentoId });
const historialDe = (wellId) => Api.handleGetHistorialItf('t', { action: 'getHistorialItf', sessionToken: 't', wellId: wellId });
const aprobar = (documentoId, vigente, extra) => Api.handleAprobarItf('t', Object.assign({ action: 'aprobarItf', sessionToken: 't', documentoId: documentoId, clientRequestId: crid() }, vigente ? { vigenteEsperadoDocumentoId: vigente, motivoCodigo: 'ACTUALIZACION' } : {}, extra || {}));
const rechazar = (documentoId, extra) => Api.handleRechazarItf('t', Object.assign({ action: 'rechazarItf', sessionToken: 't', documentoId: documentoId, motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }, extra || {}));
const retirar = (documentoId, extra) => Api.handleRetirarItf('t', Object.assign({ action: 'retirarItf', sessionToken: 't', documentoId: documentoId, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() }, extra || {}));
const revertir = (documentoId, vigente, extra) => Api.handleRevertirItf('t', Object.assign({ action: 'revertirItf', sessionToken: 't', documentoId: documentoId, motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() }, vigente ? { vigenteEsperadoDocumentoId: vigente } : {}, extra || {}));
const retirarPropia = (documentoId, extra) => Api.handleRetirarPropuestaItf('t', Object.assign({ action: 'retirarPropuestaItf', sessionToken: 't', documentoId: documentoId, clientRequestId: crid() }, extra || {}));

function sinFugas(valor) {
  const json = JSON.stringify(valor);
  ['@example.com', 'itf-ref-', 'e9-storage-', 'legacy-14-0001', 'mod-req-'].forEach((p) => expect(json).not.toContain(p));
  expect(json).not.toMatch(/[0-9a-f]{64}/);
  expect(json).not.toMatch(/"(email|storageFileId|storageRef|sha256|huella|clientRequestId|secuencia|eventoId|driveFileId)"/);
}

const VALIDADOR_ENDPOINTS = [
  ['getItfPendientes', () => pendientes()],
  ['getItfDocumentoModeracion', () => abrir(H_DOC(1))],
  ['getHistorialItf', () => historialDe(W)],
  ['aprobarItf', () => aprobar(H_DOC(1))],
  ['rechazarItf', () => rechazar(H_DOC(1))],
  ['retirarItf', () => retirar(H_DOC(1))],
  ['revertirItf', () => revertir(H_DOC(1), H_DOC(2))]
];
function H_DOC(i) { return '00000000-0000-4000-8000-' + String(i).padStart(12, '0'); }

describe('gates exactos de permiso y orden de chequeos', () => {
  test.each(VALIDADOR_ENDPOINTS)('%s: sin sesion -> UNAUTHORIZED; inactivo -> USER_DISABLED; nada se ejecuta', (accion, llamar) => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(llamar().code).toBe('UNAUTHORIZED');
    como(VALIDADOR);
    global.isUserActive.mockReturnValue(false);
    expect(llamar().code).toBe('USER_DISABLED');
    expect(filas()).toHaveLength(0);
    expect(llamadasStorage).toEqual([]);
  });
  test.each(VALIDADOR_ENDPOINTS)('%s: exige perfil === true Y perfil_validar === true (nada menos, nada raro)', (accion, llamar) => {
    [
      ['solo perfil', { perfil: true }],
      ['solo perfil_validar', { perfil_validar: true }],
      ['perfil + perfil_subir', { perfil: true, perfil_subir: true }],
      ['perfil_subir + perfil_validar sin perfil', { perfil_subir: true, perfil_validar: true }],
      ['ninguno', {}],
      ['perfil false', { perfil: false, perfil_validar: true }],
      ['perfil_validar false', { perfil: true, perfil_validar: false }]
    ].forEach(([nombre, permisos]) => {
      como(VALIDADOR, permisos);
      expect(llamar()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(global.logHistoryEvent).toHaveBeenCalledWith(VALIDADOR, accion, null, 'PERMISSION_DENIED');
    });
    ['SI', 1, 'true', {}, []].forEach((raro) => {
      global.hasPermission.mockImplementation((e, modulo) => (modulo === 'perfil' || modulo === 'perfil_validar' ? raro : false));
      expect(llamar().code).toBe('PERMISSION_DENIED');
    });
    expect(filas()).toHaveLength(0);
    expect(llamadasStorage).toEqual([]);
  });
  test('retirarPropuestaItf exige perfil + perfil_subir (el validador puro no retira "como proponente")', () => {
    const a = proponer(1);
    como(VALIDADOR);
    expect(retirarPropia(a).code).toBe('PERMISSION_DENIED');
    como(PROPONENTE, { perfil: true });
    expect(retirarPropia(a).code).toBe('PERMISSION_DENIED');
    como(PROPONENTE, { perfil_subir: true });
    expect(retirarPropia(a).code).toBe('PERMISSION_DENIED');
    como(PROPONENTE);
    expect(retirarPropia(a).status).toBe('ok');
  });
  test.each(VALIDADOR_ENDPOINTS)('%s: el permiso se chequea ANTES que el interruptor (quien no puede no se entera de si esta apagado); con permiso y E9 apagado: ITF_E9_INACTIVO sin tocar la hoja', (accion, llamar) => {
    E.props.ITF_E9_ACTIVO = 'NO';
    como(VALIDADOR, { perfil: true });
    expect(llamar().code).toBe('PERMISSION_DENIED');
    como(VALIDADOR);
    expect(llamar()).toMatchObject({ status: 'error', code: 'ITF_E9_INACTIVO' });
    expect(llamadasStorage).toEqual([]);
  });
  test('con la hoja inexistente y E9 apagado, los endpoints cortan ANTES de tocarla', () => {
    montar({ sinHoja: true, props: {} });
    comoVal();
    VALIDADOR_ENDPOINTS.forEach(([accion, llamar]) => expect(llamar().code).toBe('ITF_E9_INACTIVO'));
    expect(E.hojas.ItfEventos).toBeUndefined();
  });
});

describe('lista blanca de campos: el cliente solo manda lo suyo', () => {
  const PROHIBIDOS = ['email', 'actor', 'nombre', 'wellId', 'storageFileId', 'storageRef', 'driveFileId', 'sha256', 'hash', 'estado', 'secuencia', 'timestamp', 'timestampUtc', 'eventoId', 'documentoReemplazadoId', 'accion', 'carpeta', 'url'];
  test.each([
    ['getItfPendientes', (c) => pendientes({ [c]: 'x' })],
    ['getItfDocumentoModeracion', (c) => Api.handleGetItfDocumentoModeracion('t', { action: 'getItfDocumentoModeracion', sessionToken: 't', documentoId: H_DOC(1), [c]: 'x' })],
    ['getHistorialItf', (c) => Api.handleGetHistorialItf('t', { action: 'getHistorialItf', sessionToken: 't', wellId: W, [c]: 'x' })],
    ['aprobarItf', (c) => aprobar(H_DOC(1), null, { [c]: 'x' })],
    ['rechazarItf', (c) => rechazar(H_DOC(1), { [c]: 'x' })],
    ['retirarItf', (c) => retirar(H_DOC(1), { [c]: 'x' })],
    ['revertirItf', (c) => revertir(H_DOC(1), H_DOC(2), { [c]: 'x' })]
  ])('%s rechaza (INVALID_REQUEST) email, actor, storage, hash, estado, secuencia, timestamp...', (accion, llamar) => {
    comoVal();
    PROHIBIDOS.forEach((campo) => {
      if (accion === 'getHistorialItf' && campo === 'wellId') { return; }
      if (accion === 'getItfPendientes' && campo === 'x') { return; }
      expect(llamar(campo)).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    });
    expect(filas()).toHaveLength(0);
    expect(llamadasStorage).toEqual([]);
  });
  test('retirarPropuestaItf rechaza motivoCodigo (lo fija el servidor), wellId, email y el vigente esperado', () => {
    const a = proponer(1);
    como(PROPONENTE);
    ['motivoCodigo', 'wellId', 'email', 'vigenteEsperadoDocumentoId', 'nombre'].forEach((c) => expect(retirarPropia(a, { [c]: 'CANCELADO_POR_PROPONENTE' }).code).toBe('INVALID_REQUEST'));
    expect(retirarPropia(a).status).toBe('ok');
  });
  test('wellId de otro pozo junto a un documentoId: se rechaza (el pozo sale del documento)', () => {
    const a = proponer(1);
    comoVal();
    expect(aprobar(a, LEGACY_ID, { wellId: '14-0002' }).code).toBe('INVALID_REQUEST');
    expect(aprobar(a, LEGACY_ID, { wellId: W }).code).toBe('INVALID_REQUEST');
  });
  test('entradas mal formadas: documentoId, vigente esperado, motivo, clientRequestId y paginacion', () => {
    comoVal();
    [undefined, null, 5, {}, 'x', H_DOC(1).toUpperCase() + 'x'].forEach((id) => {
      expect(Api.handleGetItfDocumentoModeracion('t', { action: 'getItfDocumentoModeracion', sessionToken: 't', documentoId: id }).code).toBe('INVALID_DOCUMENTO_ID');
    });
    expect(aprobar(H_DOC(1), 5).code).toBe('INVALID_DOCUMENTO_ID');
    expect(aprobar(H_DOC(1), 'LEGACY:XX').code).toBe('INVALID_DOCUMENTO_ID');
    expect(Api.handleAprobarItf('t', { action: 'aprobarItf', sessionToken: 't', documentoId: H_DOC(1) }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(Api.handleAprobarItf('t', { action: 'aprobarItf', sessionToken: 't', documentoId: H_DOC(1), clientRequestId: 'corto' }).code).toBe('INVALID_CLIENT_REQUEST_ID');
    expect(rechazar(H_DOC(1), { motivoCodigo: 'ilegible' }).code).toBe('INVALID_MOTIVO');
    expect(rechazar(H_DOC(1), { motivoTexto: { x: 1 } }).code).toBe('INVALID_MOTIVO_TEXTO');
    expect(pendientes({ limite: '10' }).code).toBe('INVALID_LIMITE');
    expect(pendientes({ cursor: 'zzz' }).code).toBe('INVALID_CURSOR');
    expect(historialDe('14-1').code).toBe('INVALID_WELL_ID');
    expect(Api.handleGetHistorialItf('t', { action: 'getHistorialItf', sessionToken: 't' }).code).toBe('INVALID_WELL_ID');
    expect(filas()).toHaveLength(0);
  });
  test('cuerpo ausente o no objeto: error controlado, sin excepcion', () => {
    comoVal();
    expect(Api.handleAprobarItf('t', null)).toMatchObject({ status: 'error' });
    expect(Api.handleRechazarItf('t', 'x')).toMatchObject({ status: 'error' });
    expect(Api.handleGetItfPendientes('t', undefined)).toMatchObject({ status: 'ok' });
  });
});

describe('lecturas: cola, documento e historial', () => {
  test('la cola entrega las propuestas pendientes con el DTO seguro, sin imagenes', () => {
    const a = proponer(1);
    const b = proponer(2, '14-0002', AMBOS);
    comoVal();
    const r = pendientes();
    expect(r.status).toBe('ok');
    expect(r.data.items.map((i) => i.documentoId)).toEqual([b, a]);
    expect(r.data.items[1]).toEqual({
      documentoId: a, wellId: W, mimeType: 'image/jpeg', bytes: 400, nombreOriginal: 'itf-1.jpg', nombreProponente: 'Ana Proponente', timestampUtc: expect.any(String),
      autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, warningMensaje: null
    });
    expect(r.data).toMatchObject({ siguienteCursor: null, total: 2, pozosSinDerivar: 0 });
    sinFugas(r);
    expect(JSON.stringify(r)).not.toContain('imagenBase64');
    expect(llamadasStorage.filter((c) => c.accion !== 'putItf')).toEqual([]);                            // la cola no leyo el storage
  });
  test('paginacion por cursor via Api', () => {
    for (let i = 1; i <= 5; i += 1) { proponer(i, '14-00' + String(10 + i)); }
    comoVal();
    const p1 = pendientes({ limite: 2 });
    const p2 = pendientes({ limite: 2, cursor: p1.data.siguienteCursor });
    const p3 = pendientes({ limite: 2, cursor: p2.data.siguienteCursor });
    expect([p1, p2, p3].map((p) => p.data.items.length)).toEqual([2, 2, 1]);
    expect(p3.data.siguienteCursor).toBeNull();
  });
  test('abrir un documento: metadata segura + imagen en base64 identica a la guardada; el contexto del pozo trae el vigente a declarar', () => {
    const a = proponer(7);
    comoVal();
    const r = abrir(a);
    expect(r.status).toBe('ok');
    expect(r.data.imagen).toEqual({ mimeType: 'image/jpeg', imagenBase64: b64(JPEG(400, 7)) });
    expect(r.data.documento).toMatchObject({ documentoId: a, estado: 'PROPUESTO', wellId: W, origen: 'E9' });
    expect(r.data.pozo).toMatchObject({ wellId: W, vigenteActualDocumentoId: LEGACY_ID, vigenteIndeterminado: false });
    sinFugas({ documento: r.data.documento, pozo: r.data.pozo });
  });
  test('abrir el legacy implicito y uno inexistente; el storage caido no filtra detalles', () => {
    comoVal();
    const l = abrir(LEGACY_ID);
    expect(l.data.imagen.imagenBase64).toBe(b64(BYTES_LEGACY));
    expect(l.data.documento).toMatchObject({ origen: 'LEGACY', implicito: true, estado: 'VIGENTE' });
    expect(abrir(H_DOC(77)).code).toBe('ITF_NOT_FOUND');
    const a = proponer(1);
    comoVal();
    global.fotosStorageClient_llamar.mockImplementation(() => { throw new Error('storage devolvio error: INTERNAL id-secreto-77'); });
    const r = abrir(a);
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('id-secreto');
  });
  test('historial por pozo: eventos del mas nuevo al mas viejo con nombres (nunca emails) y los documentos del pozo', () => {
    const a = proponer(1);
    comoVal();
    expect(aprobar(a, LEGACY_ID).status).toBe('ok');
    const r = historialDe(W);
    expect(r.status).toBe('ok');
    expect(r.data.historial.map((h) => h.evento)).toEqual(['ITF_APROBADO', 'ITF_LEGACY_REGISTRADO', 'ITF_PROPUESTO']);
    expect(r.data.historial[0]).toMatchObject({ nombre: 'Valeria Validadora', documentoId: a, documentoReemplazadoId: LEGACY_ID, estadoActualDocumento: 'VIGENTE' });
    expect(r.data.pozo.vigenteActualDocumentoId).toBe(a);
    sinFugas(r);
  });
  test('las lecturas no dejan fila en Historial en el caso OK (alta frecuencia) y no escriben nada', () => {
    proponer(1);
    comoVal();
    global.logHistoryEvent.mockClear();
    const antes = filas().length;
    pendientes();
    historialDe(W);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(filas()).toHaveLength(antes);
  });
});

describe('escrituras: respuesta, Historial e idempotencia', () => {
  test('aprobar reemplazando al legacy: respuesta minima, UNA fila de Historial, el vigente derivado cambia y la propuesta sale de la cola', () => {
    const a = proponer(1);
    comoVal();
    global.logHistoryEvent.mockClear();
    const r = aprobar(a, LEGACY_ID);
    expect(r).toEqual({ status: 'ok', data: { documentoId: a, wellId: W, evento: 'ITF_APROBADO', estado: 'VIGENTE', reintento: false, autoaprobado: false } });
    expect(global.logHistoryEvent.mock.calls).toEqual([[VALIDADOR, 'aprobarItf', W, 'OK']]);
    expect(pendientes().data.items).toEqual([]);
    expect(E.mods.servicio.itfService_resolverVigente(W, require('./itfEntorno').depsDe(E))).toMatchObject({ origen: 'E9', documentoId: a });
    sinFugas(r);
  });
  test('autoaprobacion: quien tiene ambos permisos aprueba SU propuesta con otra llamada; la respuesta lo marca y queda UNA fila por accion', () => {
    const a = proponer(1, W, AMBOS);
    como(AMBOS);
    global.logHistoryEvent.mockClear();
    const r = aprobar(a, LEGACY_ID);
    expect(r.data).toMatchObject({ evento: 'ITF_APROBADO', autoaprobado: true });
    expect(global.logHistoryEvent.mock.calls).toEqual([[AMBOS, 'aprobarItf', W, 'OK']]);
    expect(eventos().filter((e) => e.evento === 'ITF_APROBADO')).toHaveLength(1);
  });
  test('REINTENTO exacto: misma respuesta con reintento=true, ninguna fila de datos ni de Historial nueva; otro contenido: IDEMPOTENCY_CONFLICT con su fila de error', () => {
    const a = proponer(1);
    comoVal();
    const cr = crid();
    const r1 = aprobar(a, LEGACY_ID, { clientRequestId: cr });
    global.logHistoryEvent.mockClear();
    const antes = filas().length;
    const r2 = aprobar(a, LEGACY_ID, { clientRequestId: cr });
    expect(r2.data).toEqual(Object.assign({}, r1.data, { reintento: true }));
    expect(filas()).toHaveLength(antes);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(aprobar(a, LEGACY_ID, { clientRequestId: cr, motivoCodigo: 'CORRECCION' }).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(global.logHistoryEvent.mock.calls).toEqual([[VALIDADOR, 'aprobarItf', null, 'IDEMPOTENCY_CONFLICT']]);
  });
  test('vigente cambiado: VIGENTE_CAMBIO claro para el validador, con su fila de error y sin escribir', () => {
    const a = proponer(1);
    const b = proponer(2);
    comoVal();
    expect(aprobar(a, LEGACY_ID).status).toBe('ok');
    global.logHistoryEvent.mockClear();
    const antes = filas().length;
    expect(aprobar(b, LEGACY_ID)).toMatchObject({ status: 'error', code: 'VIGENTE_CAMBIO' });
    expect(aprobar(b)).toMatchObject({ status: 'error', code: 'VIGENTE_CAMBIO' });
    expect(filas()).toHaveLength(antes);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(VALIDADOR, 'aprobarItf', null, 'VIGENTE_CAMBIO');
  });
  test('rechazar: documento RECHAZADO conservado (el archivo no se borra), sale de la cola, una fila de Historial', () => {
    const a = proponer(1);
    comoVal();
    global.logHistoryEvent.mockClear();
    const r = rechazar(a, { motivoCodigo: 'OTRO', motivoTexto: 'No es el pozo' });
    expect(r.data).toEqual({ documentoId: a, wellId: W, evento: 'ITF_RECHAZADO', estado: 'RECHAZADO', reintento: false });
    expect(global.logHistoryEvent.mock.calls).toEqual([[VALIDADOR, 'rechazarItf', W, 'OK']]);
    expect(pendientes().data.items).toEqual([]);
    expect(llamadasStorage.filter((c) => c.accion === 'trashItf')).toEqual([]);
    expect(abrir(a).data.documento).toMatchObject({ estado: 'RECHAZADO', decision: { motivoCodigo: 'OTRO', motivoTexto: 'No es el pozo' } });
    expect(rechazar(a)).toMatchObject({ status: 'error', code: 'DOCUMENTO_NO_PROPUESTO' });
    expect(rechazar(a, { motivoCodigo: 'OTRO' }).code).toBe('INVALID_MOTIVO_TEXTO');
  });
  test('retirar el vigente, retirar una propuesta (validador) y retirar la PROPIA (proponente): tres caminos, una fila cada uno', () => {
    const v = proponer(1);
    const p = proponer(2);
    const propia = proponer(3);
    comoVal();
    aprobar(v, LEGACY_ID);
    global.logHistoryEvent.mockClear();
    expect(retirar(v, { motivoCodigo: 'ERROR_DE_APROBACION' }).data).toEqual({ documentoId: v, wellId: W, evento: 'ITF_RETIRADO', estado: 'RETIRADO', reintento: false });
    expect(retirar(p, { motivoCodigo: 'NO_CORRESPONDE_POZO' }).data.estado).toBe('RETIRADO');
    como(PROPONENTE);
    expect(retirarPropia(propia).data).toEqual({ documentoId: propia, wellId: W, evento: 'ITF_RETIRADO', estado: 'RETIRADO', reintento: false });
    expect(global.logHistoryEvent.mock.calls).toEqual([[VALIDADOR, 'retirarItf', W, 'OK'], [VALIDADOR, 'retirarItf', W, 'OK'], [PROPONENTE, 'retirarPropuestaItf', W, 'OK']]);
    comoVal();
    expect(E.mods.servicio.itfService_resolverVigente(W, require('./itfEntorno').depsDe(E))).toMatchObject({ estado: 'NO' });         // sin ITF y sin restaurar el legacy
    expect(retirar(v)).toMatchObject({ status: 'error', code: 'DOCUMENTO_NO_RETIRABLE' });
  });
  test('retirar la propuesta AJENA con retirarPropuestaItf: PERMISSION_DENIED igual que si no existiera', () => {
    const a = proponer(1, W, AMBOS);
    como(PROPONENTE);
    const ajena = retirarPropia(a);
    const inexistente = retirarPropia(H_DOC(88));
    expect(ajena).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(Object.assign({}, ajena, { message: '' })).toEqual(Object.assign({}, inexistente, { message: '' }));
  });
  test('revertir un E9 historico y el legacy: respuestas y filas; el restaurado vuelve a ser el vigente derivado', () => {
    const a = proponer(1);
    const b = proponer(2);
    comoVal();
    aprobar(a, LEGACY_ID);
    aprobar(b, a);
    global.logHistoryEvent.mockClear();
    expect(revertir(a, b).data).toEqual({ documentoId: a, wellId: W, evento: 'ITF_REVERTIDO', estado: 'VIGENTE', reintento: false });
    expect(revertir(LEGACY_ID, a).data).toMatchObject({ documentoId: LEGACY_ID, estado: 'VIGENTE' });
    expect(global.logHistoryEvent.mock.calls.map((c) => c.slice(1))).toEqual([['revertirItf', W, 'OK'], ['revertirItf', W, 'OK']]);
    expect(E.mods.servicio.itfService_resolverVigente(W, require('./itfEntorno').depsDe(E))).toMatchObject({ origen: 'LEGACY' });
    E.drive.estado.archivos[0].bytes = JPEG(300, 9);                                                  // el legacy cambio por fuera
    expect(revertir(b, LEGACY_ID).status).toBe('ok');                                                  // volver a un E9 no mira el legacy
    expect(revertir(LEGACY_ID, b)).toMatchObject({ status: 'error', code: 'LEGACY_CAMBIO' });
  });
  test('destino invalido y estados incompatibles dan errores claros para el validador', () => {
    const a = proponer(1);
    const r = proponer(2);
    comoVal();
    rechazar(r);
    expect(revertir(a, LEGACY_ID).code).toBe('DESTINO_INVALIDO');
    expect(revertir(r, LEGACY_ID).code).toBe('DESTINO_INVALIDO');
    expect(aprobar(r, LEGACY_ID).code).toBe('DOCUMENTO_NO_PROPUESTO');
    expect(aprobar(H_DOC(99), LEGACY_ID).code).toBe('ITF_NOT_FOUND');
  });
  test('el archivo de la propuesta ya no esta en el storage: ITF_ARCHIVO_NO_DISPONIBLE (nunca queda vigente un documento sin archivo)', () => {
    const a = proponer(1);
    comoVal();
    delete almacen[Object.keys(almacen)[0]];
    expect(aprobar(a, LEGACY_ID)).toMatchObject({ status: 'error', code: 'ITF_ARCHIVO_NO_DISPONIBLE' });
    expect(eventos().filter((e) => e.evento === 'ITF_LEGACY_REGISTRADO')).toHaveLength(0);
  });
  test('una excepcion interna (hoja caida) se traduce a SERVICE_UNAVAILABLE sin detalle y deja su fila de error', () => {
    const a = proponer(1);
    comoVal();
    E.hoja.getDataRange = () => { throw new Error('Sheets caido: id-secreto-9'); };
    global.logHistoryEvent.mockClear();
    const r = aprobar(a, LEGACY_ID);
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('id-secreto');
    expect(global.logHistoryEvent).toHaveBeenCalledWith(VALIDADOR, 'aprobarItf', null, 'SERVICE_UNAVAILABLE');
  });
  test('sin Telegram ni avisos: ninguna accion de moderacion manda mensajes', () => {
    const a = proponer(1);
    comoVal();
    aprobar(a, LEGACY_ID);
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});

describe('contrato: ninguna respuesta lleva datos internos', () => {
  test('recorrido completo (proponer, listar, abrir, aprobar, reemplazar, rechazar, retirar, revertir, historial): nada de emails, storage, hashes, clientRequestId ni secuencia', () => {
    const a = proponer(1);
    const b = proponer(2);
    const c = proponer(3);
    comoVal();
    const respuestas = [pendientes(), abrir(a), aprobar(a, LEGACY_ID), aprobar(b, a), rechazar(c), retirar(b, { motivoCodigo: 'DESACTUALIZADO' }), revertir(a, null), historialDe(W)];
    respuestas.forEach((r) => {
      expect(r.status).toBe('ok');
      const copia = JSON.parse(JSON.stringify(r));
      if (copia.data && copia.data.imagen) { delete copia.data.imagen; }                              // la imagen es base64 y puede contener cualquier secuencia
      sinFugas(copia);
    });
  });
});

describe('el Api corta ANTES de llamar al servicio (la puerta no se delega) y no filtra excepciones', () => {
  const SERVICIOS = ['itfService_ejecutar', 'itfService_pendientes', 'itfService_documentoModeracion', 'itfService_historial'];
  const espiar = () => SERVICIOS.map((nombre) => jest.spyOn(global, nombre));
  const CON_EXTRA = [
    ['getItfPendientes', () => pendientes({ email: 'x@example.com' })],
    ['getItfDocumentoModeracion', () => Api.handleGetItfDocumentoModeracion('t', { action: 'getItfDocumentoModeracion', sessionToken: 't', documentoId: H_DOC(1), email: 'x@example.com' })],
    ['getHistorialItf', () => Api.handleGetHistorialItf('t', { action: 'getHistorialItf', sessionToken: 't', wellId: W, email: 'x@example.com' })],
    ['aprobarItf', () => aprobar(H_DOC(1), null, { wellId: W })],
    ['rechazarItf', () => rechazar(H_DOC(1), { wellId: W })],
    ['retirarItf', () => retirar(H_DOC(1), { wellId: W })],
    ['revertirItf', () => revertir(H_DOC(1), H_DOC(2), { wellId: W })],
    ['retirarPropuestaItf', () => retirarPropia(H_DOC(1), { wellId: W })]
  ];
  test.each(VALIDADOR_ENDPOINTS)('%s: sin el permiso exacto o con E9 apagado, el servicio NO se llama', (accion, llamar) => {
    const espias = espiar();
    como(VALIDADOR, { perfil: true });
    expect(llamar().code).toBe('PERMISSION_DENIED');
    como(VALIDADOR, { perfil_validar: true });
    expect(llamar().code).toBe('PERMISSION_DENIED');
    como(VALIDADOR);
    E.props.ITF_E9_ACTIVO = 'NO';
    expect(llamar().code).toBe('ITF_E9_INACTIVO');
    espias.forEach((e) => expect(e).not.toHaveBeenCalled());
  });
  test.each(CON_EXTRA)('%s: con un campo que no le corresponde, el servicio NO se llama', (accion, llamar) => {
    const espias = espiar();
    como(accion === 'retirarPropuestaItf' ? PROPONENTE : VALIDADOR);
    expect(llamar().code).toBe('INVALID_REQUEST');
    espias.forEach((e) => expect(e).not.toHaveBeenCalled());
  });
  test.each([
    ['getItfPendientes', () => pendientes(), VALIDADOR],
    ['getItfDocumentoModeracion', () => abrir(H_DOC(1)), VALIDADOR],
    ['getHistorialItf', () => historialDe(W), VALIDADOR],
    ['aprobarItf', () => aprobar(H_DOC(1)), VALIDADOR],
    ['rechazarItf', () => rechazar(H_DOC(1)), VALIDADOR],
    ['retirarItf', () => retirar(H_DOC(1)), VALIDADOR],
    ['revertirItf', () => revertir(H_DOC(1), H_DOC(2)), VALIDADOR],
    ['retirarPropuestaItf', () => retirarPropia(H_DOC(1)), PROPONENTE]
  ])('%s: si el servicio lanza una excepcion, SERVICE_UNAVAILABLE sin su texto', (accion, llamar, quien) => {
    espiar().forEach((e) => e.mockImplementation(() => { throw new Error('boom id-secreto-5 ' + E.hoja.filas.length); }));
    como(quien);
    global.logHistoryEvent.mockClear();
    const r = llamar();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toMatch(/boom|id-secreto/);
    expect(JSON.stringify(global.Logger.log.mock.calls)).not.toMatch(/@example\.com/);
    if (/^(aprobar|rechazar|retirar|revertir)/.test(accion)) {
      expect(global.logHistoryEvent).toHaveBeenCalledWith(quien, accion, null, 'SERVICE_UNAVAILABLE');
    }
  });
});
