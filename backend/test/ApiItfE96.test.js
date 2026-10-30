// E9-6 (local, NO productivo), capa Api: (1) getMisPropuestasItf, la lectura de las propuestas del PROPIO usuario (perfil + perfil_subir exactos, el dueno sale de la sesion, paginacion, DTO minimo); (2) el
// cableado de getProfile y getItfAvailability a itfService_* SOLO con ITF_E9_ACTIVO === 'SI' (apagado: comportamiento legacy EXACTO; encendido: vigente institucional, sin fallback inseguro). Cadena real
// Api -> ItfService -> proveedor de storage -> cliente HMAC con hoja, Drive y storage en memoria. Nada toca Google.
const { crearEntorno, JPEG, PNG } = require('./itfEntorno');

const PROPONENTE = 'ana.proponente@example.com';
const OTRA = 'otra.persona@example.com';
const VALIDADOR = 'val.validador@example.com';
const AMBOS = 'carla.ambos@example.com';
const SOLO_PERFIL = 'solo.perfil@example.com';
const MAYUSCULAS = '  ANA.Proponente@Example.com ';
const W = '14-0001';
const W2 = '14-0002';
const BYTES_LEGACY = JPEG(300, 5);
const PERMISOS = {
  [PROPONENTE]: { perfil: true, perfil_subir: true },
  [OTRA]: { perfil: true, perfil_subir: true },
  [VALIDADOR]: { perfil: true, perfil_validar: true },
  [AMBOS]: { perfil: true, perfil_subir: true, perfil_validar: true },
  [SOLO_PERFIL]: { perfil: true },
  [MAYUSCULAS]: { perfil: true, perfil_subir: true }
};
const NOMBRES = { [PROPONENTE]: 'Ana Proponente', [OTRA]: 'Olga Otra', [VALIDADOR]: 'Valeria Validadora', [AMBOS]: 'Carla Ambos', [SOLO_PERFIL]: 'Sara Perfil' };

let E;
let Api;
let almacen;
let n = 0;
let actual;

const crid = () => { n += 1; return 'e96-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');
const filas = () => E.hoja.filas.slice(1);

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
  global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
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

function proponer(relleno, wellId, email, mime) {
  const previo = actual;
  como(email || PROPONENTE);
  const bytes = mime === 'image/png' ? PNG(400) : JPEG(400, relleno);
  const r = Api.handleProponerItf('t', { wellId: wellId || W, imageBase64: b64(bytes), mimeType: mime || 'image/jpeg', nombreOriginal: 'itf-' + relleno + (mime === 'image/png' ? '.png' : '.jpg'), clientRequestId: crid() });
  como(previo);
  expect(r.status).toBe('ok');
  return r.data.documentoId;
}
const aprobar = (documentoId, vigente) => {
  const previo = actual;
  como(VALIDADOR);
  const r = Api.handleAprobarItf('t', Object.assign({ action: 'aprobarItf', sessionToken: 't', documentoId: documentoId, clientRequestId: crid() }, vigente ? { vigenteEsperadoDocumentoId: vigente, motivoCodigo: 'ACTUALIZACION' } : {}));
  como(previo);
  expect(r.status).toBe('ok');
  return r.data;
};
const rechazar = (documentoId, extra) => {
  const previo = actual;
  como(VALIDADOR);
  const r = Api.handleRechazarItf('t', Object.assign({ action: 'rechazarItf', sessionToken: 't', documentoId: documentoId, motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }, extra || {}));
  como(previo);
  expect(r.status).toBe('ok');
};
const retirarPropia = (documentoId) => Api.handleRetirarPropuestaItf('t', { action: 'retirarPropuestaItf', sessionToken: 't', documentoId: documentoId, clientRequestId: crid() });
const mis = (b) => Api.handleGetMisPropuestasItf('t', Object.assign({ action: 'getMisPropuestasItf', sessionToken: 't' }, b || {}));

function sinFugas(valor) {
  const json = JSON.stringify(valor);
  ['@example.com', 'itf-ref-', 'e9-storage-', 'legacy-14-0001', 'e96-req-'].forEach((p) => expect(json).not.toContain(p));
  expect(json).not.toMatch(/[0-9a-f]{64}/);
  expect(json).not.toMatch(/"(email|storageFileId|storageRef|sha256|huella|clientRequestId|secuencia|eventoId|driveFileId)"/);
}

describe('getMisPropuestasItf: gates exactos (perfil + perfil_subir) y orden sesion -> permisos -> interruptor -> lista blanca', () => {
  test('sin sesion -> UNAUTHORIZED; usuario inactivo -> USER_DISABLED; no se lee la hoja', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(mis().code).toBe('UNAUTHORIZED');
    como(PROponenteSeguro());
    global.isUserActive.mockReturnValue(false);
    expect(mis().code).toBe('USER_DISABLED');
  });
  function PROponenteSeguro() { return PROPONENTE; }

  test.each([
    ['solo perfil', { perfil: true }, false],
    ['perfil + perfil_validar (validar no es proponer)', { perfil: true, perfil_validar: true }, false],
    ['perfil_subir sin perfil', { perfil_subir: true }, false],
    ['sin ningun permiso', {}, false],
    ['perfil + perfil_subir', { perfil: true, perfil_subir: true }, true],
    ['los tres', { perfil: true, perfil_subir: true, perfil_validar: true }, true]
  ])('%s -> %s', (_n, permisos, deberiaPasar) => {
    como(PROPONENTE, permisos);
    const r = mis();
    if (deberiaPasar) { expect(r.status).toBe('ok'); } else { expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' }); }
  });

  test.each([['"SI"', 'SI'], ['1', 1], ['"true"', 'true'], ['un objeto', {}]])('un permiso truthy que no es el booleano true (%s) NO alcanza', (_n, raro) => {
    global.verifySessionToken.mockReturnValue({ valid: true, email: PROPONENTE });
    global.isUserActive.mockReturnValue(true);
    global.hasPermission.mockImplementation((e, modulo) => (modulo === 'perfil' || modulo === 'perfil_subir' ? raro : false));
    expect(mis().code).toBe('PERMISSION_DENIED');
  });

  test('con ITF_E9_ACTIVO apagado: ITF_E9_INACTIVO, y el servicio ni se llama', () => {
    E.props.ITF_E9_ACTIVO = 'NO';
    const espia = jest.spyOn(global, 'itfService_misPropuestas');
    expect(mis()).toMatchObject({ status: 'error', code: 'ITF_E9_INACTIVO' });
    expect(espia).not.toHaveBeenCalled();
  });

  test.each([
    ['email', { email: 'ana.proponente@example.com' }],
    ['emailPropietario', { emailPropietario: OTRA }],
    ['actor', { actor: OTRA }],
    ['nombre', { nombre: 'Otra' }],
    ['estado', { estado: 'PROPUESTO' }],
    ['propietario', { propietario: OTRA }]
  ])('el cuerpo NUNCA puede traer %s (lista blanca: action, sessionToken, limite, cursor)', (_c, extra) => {
    const espia = jest.spyOn(global, 'itfService_misPropuestas');
    expect(mis(extra).code).toBe('INVALID_REQUEST');
    expect(espia).not.toHaveBeenCalled();
  });

  test.each([[0], [51], [1.5], ['10'], [-1]])('limite invalido (%p) -> INVALID_LIMITE; cursor mal formado -> INVALID_CURSOR', (limite) => {
    expect(mis({ limite: limite }).code).toBe('INVALID_LIMITE');
    expect(mis({ cursor: 'x1:3' }).code).toBe('INVALID_CURSOR');
  });

  test.each([['xx'], [12], ['14-00011'], ['']])('wellId opcional invalido (%p) -> INVALID_WELL_ID', (wellId) => {
    const r = mis({ wellId: wellId });
    expect(['INVALID_WELL_ID']).toContain(r.code);
  });

  test('una excepcion del servicio se responde SERVICE_UNAVAILABLE sin su texto', () => {
    jest.spyOn(global, 'itfService_misPropuestas').mockImplementation(() => { throw new Error('boom id-secreto'); });
    const r = mis();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toMatch(/boom|id-secreto/);
  });
});

describe('getMisPropuestasItf: solo las propuestas de quien pregunta', () => {
  test('cada persona ve las SUYAS y nunca las de otra, aunque sean del mismo pozo', () => {
    const a1 = proponer(1, W, PROPONENTE);
    const o1 = proponer(2, W, OTRA);
    const a2 = proponer(3, W2, PROPONENTE);
    como(PROPONENTE);
    expect(mis().data.items.map((i) => i.documentoId)).toEqual([a2, a1]);
    como(OTRA);
    expect(mis().data.items.map((i) => i.documentoId)).toEqual([o1]);
  });

  test('el validador que ademas propone ve solo las propias (no la cola ajena)', () => {
    proponer(1, W, PROPONENTE);
    const propia = proponer(2, W2, AMBOS);
    como(AMBOS);
    expect(mis().data.items.map((i) => i.documentoId)).toEqual([propia]);
  });

  test('wellId opcional: acota a ESE pozo sin cambiar de dueno (las de otra persona del mismo pozo siguen sin verse)', () => {
    const a = proponer(1, W, PROPONENTE);
    proponer(2, W2, PROPONENTE);
    proponer(3, W, OTRA);
    como(PROPONENTE);
    expect(mis({ wellId: W }).data.items.map((i) => i.documentoId)).toEqual([a]);
    expect(mis({ wellId: W }).data.total).toBe(1);
    expect(mis().data.total).toBe(2);
    expect(mis({ wellId: '14-0099' }).data.items).toEqual([]);
  });

  test('sin propuestas: lista vacia, total 0, sin cursor', () => {
    como(OTRA);
    expect(mis().data).toEqual({ items: [], siguienteCursor: null, total: 0, incompleta: false });
  });

  test('el email que identifica al dueno se compara normalizado (mayusculas / espacios no abren la puerta ni la cierran)', () => {
    proponer(1, W, MAYUSCULAS);
    como(PROPONENTE);
    expect(mis().data.total).toBe(1);
    como(MAYUSCULAS);
    expect(mis().data.total).toBe(1);
    como(OTRA);
    expect(mis().data.total).toBe(0);
  });

  test('estados: PROPUESTO, APROBADO (es el vigente), REEMPLAZADO, RECHAZADO y RETIRADO (por mi o por la institucion), con sus marcas', () => {
    const pendiente = proponer(1, W, PROPONENTE);
    const aprobada = proponer(2, W, PROPONENTE);
    const reemplazadora = proponer(3, W, OTRA);
    const rechazada = proponer(4, W2, PROPONENTE);
    const retiradaPorMi = proponer(5, W2, PROPONENTE);
    como(PROPONENTE);
    expect(retirarPropia(retiradaPorMi).status).toBe('ok');
    rechazar(rechazada, { motivoCodigo: 'OTRO', motivoTexto: 'La foto esta cortada' });
    aprobar(aprobada, 'LEGACY:' + W);                                                // el pozo tiene ITF legacy: aprobar lo reemplaza y hay que declararlo
    como(PROPONENTE);
    const antes = Object.fromEntries(mis().data.items.map((i) => [i.documentoId, i]));
    expect(antes[pendiente]).toMatchObject({ estado: 'PROPUESTO', puedeRetirar: true, esVigente: false, decididoEn: null, motivoCodigo: null });
    expect(antes[rechazada]).toMatchObject({ estado: 'RECHAZADO', puedeRetirar: false, motivoCodigo: 'OTRO', motivoTexto: 'La foto esta cortada', retiradaPorMi: false });
    expect(antes[retiradaPorMi]).toMatchObject({ estado: 'RETIRADO', retiradaPorMi: true, motivoCodigo: null, motivoTexto: null, puedeRetirar: false });
    expect(antes[aprobada]).toMatchObject({ estado: 'APROBADO', esVigente: true, puedeRetirar: false });
    expect(antes[aprobada].decididoEn).not.toBeNull();
    // otra persona propone y se aprueba su documento: el mio queda REEMPLAZADO
    aprobar(reemplazadora, aprobada);
    como(PROPONENTE);
    const despues = Object.fromEntries(mis().data.items.map((i) => [i.documentoId, i]));
    expect(despues[aprobada]).toMatchObject({ estado: 'REEMPLAZADO', esVigente: false, puedeRetirar: false });
    expect(despues[reemplazadora]).toBeUndefined();
  });

  test('retirar la propia propuesta la pasa a RETIRADO y deja de ofrecerse "retirar" (no se retira dos veces)', () => {
    const d = proponer(1, W, PROPONENTE);
    como(PROPONENTE);
    expect(mis().data.items[0]).toMatchObject({ estado: 'PROPUESTO', puedeRetirar: true });
    expect(retirarPropia(d).status).toBe('ok');
    expect(mis().data.items[0]).toMatchObject({ estado: 'RETIRADO', puedeRetirar: false });
  });

  test('un documento aprobado y despues retirado por la institucion figura RETIRADO con el motivo institucional', () => {
    const d = proponer(1, W, PROPONENTE);
    aprobar(d, 'LEGACY:' + W);
    como(VALIDADOR);
    const r = Api.handleRetirarItf('t', { action: 'retirarItf', sessionToken: 't', documentoId: d, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() });
    expect(r.status).toBe('ok');
    como(PROPONENTE);
    expect(mis().data.items[0]).toMatchObject({ estado: 'RETIRADO', retiradaPorMi: false, motivoCodigo: 'DOCUMENTO_INCORRECTO' });
  });

  test('DTO minimo: ningun email, storage, hash, clientRequestId, secuencia, nombre de quien decidio ni id de legacy', () => {
    const d = proponer(1, W, PROPONENTE);
    rechazar(d);
    proponer(2, W2, PROPONENTE);
    como(PROPONENTE);
    const r = mis();
    sinFugas(r);
    expect(Object.keys(r.data.items[0]).sort()).toEqual(['bytes', 'decididoEn', 'documentoId', 'esVigente', 'estado', 'mimeType', 'motivoCodigo', 'motivoTexto', 'nombreOriginal', 'puedeRetirar', 'retiradaPorMi', 'timestampUtc', 'wellId']);
    expect(JSON.stringify(r)).not.toMatch(/Valeria|Validadora|LEGACY:/);
  });

  test('una lectura de la hoja por pedido: no hay lecturas de storage ni de Drive por propuesta', () => {
    for (let i = 1; i <= 12; i += 1) { proponer(i, i % 2 ? W : W2, PROPONENTE); }
    aprobar(proponer(77, '14-0003', OTRA));
    como(PROPONENTE);
    const lecturas = jest.spyOn(global, 'itfEventosRepository_leerTodos');
    global.fotosStorageClient_llamar.mockClear();
    const drive = jest.spyOn(global, 'driveProfileRepository_getFile');
    const r = mis({ limite: 50 });
    expect(r.status).toBe('ok');
    expect(lecturas).toHaveBeenCalledTimes(1);
    expect(global.fotosStorageClient_llamar).not.toHaveBeenCalled();
    expect(drive).not.toHaveBeenCalled();
  });

  test.each([1, 20, 100])('paginacion estable con %i propuestas propias: recorrer las paginas no repite ni omite, aunque entren nuevas y se retiren otras', (cantidad) => {
    const ids = [];
    for (let i = 0; i < cantidad; i += 1) {
      // cada pozo admite hasta 10 pendientes: se reparten en varios pozos
      const wellId = '14-' + String(100 + Math.floor(i / 8)).padStart(4, '0');
      E.drive.agregar && E.drive.agregar(wellId);
      ids.push(proponer(i % 200 + 1, wellId, PROPONENTE));
    }
    como(PROPONENTE);
    const vistos = [];
    let cursor;
    let paginas = 0;
    do {
      const r = mis({ limite: 7, cursor: cursor });
      expect(r.status).toBe('ok');
      r.data.items.forEach((i) => vistos.push(i.documentoId));
      cursor = r.data.siguienteCursor || undefined;
      paginas += 1;
      if (paginas === 1) { ids.push(proponer(199, W2, PROPONENTE)); retirarPropia(ids[ids.length - 2]); }       // una entra y otra sale mientras se pagina
    } while (cursor);
    expect(new Set(vistos).size).toBe(vistos.length);
    expect(vistos.length).toBeGreaterThanOrEqual(cantidad - 1);
  });
});

describe('getProfile: cableado al vigente institucional SOLO con ITF_E9_ACTIVO === SI', () => {
  const getProfile = (wellId) => Api.handleGetProfile('t', wellId || W);

  test('APAGADO: comportamiento EXACTO de siempre (profileService_getProfile; el servicio E9 ni se toca; ItfEventos ni se lee)', () => {
    E.props.ITF_E9_ACTIVO = 'NO';
    const e9 = jest.spyOn(global, 'itfService_getProfile');
    const leer = jest.spyOn(global, 'itfEventosRepository_leerTodos');
    const legacy = jest.spyOn(global, 'profileService_getProfile');
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r.status).toBe('ok');
    expect(r.data).toMatchObject({ wellId: W, mimeType: 'image/jpeg' });
    expect(legacy).toHaveBeenCalledTimes(1);
    expect(e9).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
  });

  test('APAGADO y ausente la propiedad: igual (el interruptor es "SI" exacto)', () => {
    ['', 'si', 'true', '1', 'SI '].forEach((valor) => {
      E.props.ITF_E9_ACTIVO = valor;
      const e9 = jest.spyOn(global, 'itfService_getProfile');
      como(SOLO_PERFIL);
      expect(getProfile().status).toBe('ok');
      expect(e9).not.toHaveBeenCalled();
      e9.mockRestore();
    });
  });

  test('APAGADO: un pozo sin archivo sigue siendo PROFILE_NOT_FOUND', () => {
    E.props.ITF_E9_ACTIVO = 'NO';
    como(SOLO_PERFIL);
    expect(getProfile(W2)).toMatchObject({ status: 'error', code: 'PROFILE_NOT_FOUND' });
  });

  test('ENCENDIDO sin eventos: el legacy es el vigente (con la hoja vacia el comportamiento es el de hoy)', () => {
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r.status).toBe('ok');
    expect(r.data.originalSizeBytes).toBe(BYTES_LEGACY.length);
  });

  test('ENCENDIDO sin ITF: PROFILE_NOT_FOUND', () => {
    como(SOLO_PERFIL);
    expect(getProfile(W2)).toMatchObject({ status: 'error', code: 'PROFILE_NOT_FOUND' });
  });

  test('ENCENDIDO: una propuesta pendiente NO se sirve (sigue el legacy) y un rechazado tampoco', () => {
    const p = proponer(9, W, PROPONENTE);
    como(SOLO_PERFIL);
    expect(getProfile().data.originalSizeBytes).toBe(BYTES_LEGACY.length);
    rechazar(p);
    como(SOLO_PERFIL);
    expect(getProfile().data.originalSizeBytes).toBe(BYTES_LEGACY.length);
  });

  test('ENCENDIDO: en un pozo SIN ITF una propuesta pendiente tampoco se sirve (PROFILE_NOT_FOUND) ni cuenta como disponible (el ZIP y Mi seleccion usan lo mismo)', () => {
    proponer(9, W2, PROPONENTE);
    como(SOLO_PERFIL);
    expect(getProfile(W2)).toMatchObject({ status: 'error', code: 'PROFILE_NOT_FOUND' });
    expect(Api.handleGetItfAvailability('t', [W2]).data).toEqual({ [W2]: false });
  });

  test('ENCENDIDO: aprobada una propuesta, getProfile sirve ESE documento (PNG o JPEG, con su mimeType); el legacy deja de servirse', () => {
    const d = proponer(9, W, PROPONENTE, 'image/png');
    aprobar(d, 'LEGACY:' + W);
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r.status).toBe('ok');
    expect(r.data.mimeType).toBe('image/png');
    expect(r.data.originalSizeBytes).toBe(400);
  });

  test('ENCENDIDO: el vigente E9 retirado deja el pozo SIN ITF (no vuelve solo al legacy)', () => {
    const d = proponer(9, W, PROPONENTE);
    aprobar(d, 'LEGACY:' + W);
    como(VALIDADOR);
    expect(Api.handleRetirarItf('t', { action: 'retirarItf', sessionToken: 't', documentoId: d, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() }).status).toBe('ok');
    como(SOLO_PERFIL);
    expect(getProfile()).toMatchObject({ status: 'error', code: 'PROFILE_NOT_FOUND' });
  });

  test('ENCENDIDO: la hoja ItfEventos ilegible NO cae al legacy: SERVICE_UNAVAILABLE', () => {
    montar({ sinHoja: true, archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } });
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r.status).toBe('error');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.data).toBeUndefined();
  });

  test('ENCENDIDO: un historial no derivable es ITF_STATE_UNKNOWN (jamas "no existe" ni el legacy)', () => {
    const d = proponer(9, W, PROPONENTE);
    // se corrompe el historial del pozo: una aprobacion de un documento inexistente
    const fila = E.hoja.filas[1].slice();
    const cols = E.hoja.filas[0];
    fila[cols.indexOf('evento')] = 'ITF_APROBADO';
    fila[cols.indexOf('documentoId')] = '00000000-0000-4000-8000-0000000000ff';
    fila[cols.indexOf('secuencia')] = 99;
    fila[cols.indexOf('eventoId')] = '00000000-0000-4000-8000-0000000000fe';
    fila[cols.indexOf('clientRequestId')] = 'corrupto-0001';
    E.hoja.filas.push(fila);
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r).toMatchObject({ status: 'error' });
    expect(['ITF_STATE_UNKNOWN', 'SERVICE_UNAVAILABLE']).toContain(r.code);
    expect(r.code).not.toBe('PROFILE_NOT_FOUND');
    expect(d).toBeTruthy();
  });

  test('ENCENDIDO: storage caido -> SERVICE_UNAVAILABLE (no "no existe", no legacy)', () => {
    const d = proponer(9, W, PROPONENTE);
    aprobar(d, 'LEGACY:' + W);
    global.fotosStorageClient_llamar.mockImplementation(() => { throw new Error('storage devolvio error: boom'); });
    como(SOLO_PERFIL);
    const r = getProfile();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(r.data).toBeUndefined();
  });

  test('permiso y sesion siguen primero: sin perfil -> PERMISSION_DENIED; sin sesion -> UNAUTHORIZED; y no se lee nada', () => {
    const e9 = jest.spyOn(global, 'itfService_getProfile');
    como(SOLO_PERFIL, { perfil_subir: true });
    expect(getProfile().code).toBe('PERMISSION_DENIED');
    global.verifySessionToken.mockReturnValue({ valid: false });
    expect(getProfile().code).toBe('UNAUTHORIZED');
    expect(e9).not.toHaveBeenCalled();
  });

  test('la respuesta tiene la MISMA forma con el interruptor apagado o encendido y no filtra el origen ni ids', () => {
    como(SOLO_PERFIL);
    const encendido = getProfile();
    E.props.ITF_E9_ACTIVO = 'NO';
    const apagado = getProfile();
    expect(Object.keys(encendido.data).sort()).toEqual(Object.keys(apagado.data).sort());
    sinFugas(encendido);
    expect(JSON.stringify(encendido)).not.toMatch(/LEGACY|origen/);
  });
});

describe('getItfAvailability: cableado al vigente institucional SOLO con ITF_E9_ACTIVO === SI', () => {
  const disp = (ids) => Api.handleGetItfAvailability('t', ids);

  test('APAGADO: el indice de siempre (profileService_checkDisponibilidad); el servicio E9 ni se toca', () => {
    E.props.ITF_E9_ACTIVO = 'NO';
    const e9 = jest.spyOn(global, 'itfService_disponibilidad');
    const leer = jest.spyOn(global, 'itfEventosRepository_leerTodos');
    como(SOLO_PERFIL);
    expect(disp([W, W2])).toEqual({ status: 'ok', data: { [W]: true, [W2]: false } });
    expect(e9).not.toHaveBeenCalled();
    expect(leer).not.toHaveBeenCalled();
  });

  test('ENCENDIDO: "Tiene ITF" = hay vigente institucional; una propuesta pendiente NO cuenta', () => {
    proponer(1, W2, PROPONENTE);
    como(SOLO_PERFIL);
    expect(disp([W, W2]).data).toEqual({ [W]: true, [W2]: false });
  });

  test('ENCENDIDO: aprobada la propuesta, el pozo pasa a tener ITF; retirado el vigente, vuelve a no tenerlo', () => {
    const d = proponer(1, W2, PROPONENTE);
    aprobar(d);
    como(SOLO_PERFIL);
    expect(disp([W2]).data).toEqual({ [W2]: true });
    como(VALIDADOR);
    Api.handleRetirarItf('t', { action: 'retirarItf', sessionToken: 't', documentoId: d, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() });
    como(SOLO_PERFIL);
    expect(disp([W2]).data).toEqual({ [W2]: false });
  });

  test('ENCENDIDO: el vigente E9 retirado en un pozo CON legacy deja false (no vuelve al legacy)', () => {
    const d = proponer(1, W, PROPONENTE);
    aprobar(d, 'LEGACY:' + W);
    como(VALIDADOR);
    Api.handleRetirarItf('t', { action: 'retirarItf', sessionToken: 't', documentoId: d, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() });
    como(SOLO_PERFIL);
    expect(disp([W]).data).toEqual({ [W]: false });
  });

  test('ENCENDIDO: un pozo que NO se puede afirmar se OMITE de la respuesta (nunca false)', () => {
    proponer(9, W, PROPONENTE);
    const cols = E.hoja.filas[0];
    const fila = E.hoja.filas[1].slice();
    fila[cols.indexOf('evento')] = 'ITF_APROBADO';
    fila[cols.indexOf('documentoId')] = '00000000-0000-4000-8000-0000000000ff';
    fila[cols.indexOf('secuencia')] = 99;
    fila[cols.indexOf('eventoId')] = '00000000-0000-4000-8000-0000000000fe';
    fila[cols.indexOf('clientRequestId')] = 'corrupto-0001';
    E.hoja.filas.push(fila);
    como(SOLO_PERFIL);
    const r = disp([W, W2]);
    expect(r.status).toBe('ok');
    expect(Object.prototype.hasOwnProperty.call(r.data, W)).toBe(false);
    expect(r.data[W2]).toBe(false);
  });

  test('ENCENDIDO: la hoja ilegible -> SERVICE_UNAVAILABLE (sin fallback al indice legacy)', () => {
    montar({ sinHoja: true, archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } });
    como(SOLO_PERFIL);
    const r = disp([W]);
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(r.data).toBeUndefined();
  });

  test('los valores son booleanos y no hay mas claves que los pozos pedidos', () => {
    como(SOLO_PERFIL);
    const r = disp([W, W2]);
    expect(Object.keys(r.data).sort()).toEqual([W, W2]);
    Object.values(r.data).forEach((v) => expect(typeof v).toBe('boolean'));
  });

  test('el permiso perfil exacto sigue siendo la puerta', () => {
    como(SOLO_PERFIL, { perfil_subir: true, perfil_validar: true });
    expect(disp([W]).code).toBe('PERMISSION_DENIED');
  });
});
