// ItfService (E9-3), LECTURA: resolver el vigente, getProfile desacoplado del origen, disponibilidad en lote, descarga historica y existencia del pozo. Contrato critico: con la hoja vacia o sin
// eventos para un pozo, el resultado es el del ITF legacy de hoy. Drive falso con contadores, hoja en memoria; nada toca Google.
const { crearEntorno, depsDe, JPEG, PNG, sha256 } = require('./itfEntorno');
const H = require('./itfHelper');

let E;
let S;
const W = '14-0001';
const OTRO = '14-0002';
const LEGACY_ID = 'LEGACY:' + W;

const entorno = (op) => { E = crearEntorno(op); S = E.mods.servicio; H.reiniciar(); return E; };
const activar = () => { E.props.ITF_E9_ACTIVO = 'SI'; };
const cargar = (...evs) => { const cols = E.mods.repo.ITF_EVENTOS_COLUMNAS; evs.forEach((e) => E.hoja.filas.push(cols.map((c) => (e[c] === undefined ? '' : e[c])))); };
const lf = (w, bytes, id) => ({ id: id || ('legacy-' + w), name: w + '.jpg', bytes: bytes || JPEG(300, 5) });
const lecturasHoja = () => { let n = 0; const o = E.hoja.getDataRange.bind(E.hoja); E.hoja.getDataRange = () => { n += 1; return o(); }; return () => n; };
const legacyFalso = (w) => ({ id: 'legacy-' + w, name: w + '.jpg', bytes: JPEG(300, 5) });

describe('resolverVigente: casos A-D del contrato', () => {
  test.each([['modo legacy puro (E9 apagado)', false], ['E9 activo con la hoja vacia', true]])('A. sin eventos + legacy unico -> LEGACY vigente (%s)', (nombre, activo) => {
    entorno({ archivos: [lf(W)] });
    if (activo) { activar(); }
    const r = S.itfService_resolverVigente(W);
    expect(r).toMatchObject({ wellId: W, estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID, storageRef: 'legacy-' + W, integridad: 'OK', codigo: null, legacy: 'UNICO' });
  });
  test.each([['modo legacy puro', false], ['E9 activo con la hoja vacia', true]])('B. sin eventos + sin legacy -> NO / SIN_ITF (%s)', (nombre, activo) => {
    entorno({ archivos: [lf(OTRO)] });
    if (activo) { activar(); }
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'NO', origen: null, documentoId: null, storageRef: null, codigo: 'ITF_NOT_FOUND', legacy: 'NO' });
  });
  test('C. con un documento E9 vigente: origen E9, referencia interna del storage, tipo y tamano; NO se toca Drive', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID));
    const r = S.itfService_resolverVigente(W);
    expect(r).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: H.doc(1), storageRef: H.storageId(1), mimeType: 'image/jpeg', bytes: 1001, integridad: 'OK', codigo: null, legacy: null });
    expect(E.drive.calls.getFilesByName).toBe(0);
  });
  test('D. historial NO_DERIVABLE -> DESCONOCIDO (fail-closed), aunque el archivo legacy exista', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.aprobado(1), H.aprobado(1));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'DESCONOCIDO', origen: null, documentoId: null, storageRef: null, integridad: 'NO_DERIVABLE', codigo: 'ITF_STATE_UNKNOWN' });
  });
});

describe('resolverVigente: legacy y E9 combinados', () => {
  beforeEach(() => { entorno({ archivos: [lf(W)] }); activar(); });
  test('legacy ambiguo (dos archivos con el mismo nombre): DESCONOCIDO / LEGACY_AMBIGUO, nunca el primero', () => {
    E.drive.agregar({ id: 'legacy-otro-' + W, name: W + '.jpg', bytes: JPEG(100) });
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'DESCONOCIDO', codigo: 'LEGACY_AMBIGUO', legacy: 'AMBIGUO', storageRef: null });
  });
  test.each([[false], [true]])('un UNICO <wellId>.JPG es el vigente legacy (Drive insensible=%s): SI / LEGACY, getProfile lo sirve y la disponibilidad lo cuenta', (insensible) => {
    const bytes = JPEG(100, 3);
    entorno({ archivos: [{ id: 'legacy-x-' + W, name: W + '.JPG', bytes: bytes }] });
    activar();
    E.drive.estado.caseInsensitive = insensible;
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID, codigo: null });
    expect(S.itfService_getProfile(W)).toMatchObject({ found: true });
    expect(S.itfService_getProfile(W).blob.getBytes()).toHaveLength(100);
    expect(S.itfService_disponibilidad([W])).toEqual({ [W]: true });
  });
  test('<wellId>.jpg + <wellId>.JPG: DESCONOCIDO / LEGACY_AMBIGUO (nunca se elige uno), getProfile no sirve ninguno y la disponibilidad lo omite', () => {
    entorno({ archivos: [{ id: 'legacy-a-' + W, name: W + '.jpg', bytes: JPEG(100, 3) }, { id: 'legacy-b-' + W, name: W + '.JPG', bytes: JPEG(100, 4) }] });
    activar();
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'DESCONOCIDO', codigo: 'LEGACY_AMBIGUO' });
    expect(S.itfService_getProfile(W)).toMatchObject({ found: false, unknown: true });
    expect(S.itfService_disponibilidad([W])).toEqual({});
  });
  test('legacy registrado pero SIN aprobacion posterior: el legacy SIGUE vigente (el registro no es un reemplazo)', () => {
    cargar(H.legacy());
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID });
    expect(S.itfService_disponibilidad([W])).toEqual({ [W]: true });
  });
  test('legacy + propuesta pendiente: el legacy sigue vigente', () => {
    cargar(H.propuesto(1));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY' });
  });
  test('sin legacy + solo una propuesta pendiente: NO (una propuesta no es un ITF vigente)', () => {
    entorno({ archivos: [] });
    activar();
    cargar(H.propuesto(1));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'NO', codigo: 'ITF_NOT_FOUND' });
  });
  test('legacy reemplazado por un documento E9: vigente E9; el archivo legacy fisico sigue ahi y NO se usa', () => {
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID));
    expect(E.drive.estado.archivos).toHaveLength(1);
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: H.doc(1) });
  });
  test('vigente E9 retirado: NO aunque el archivo legacy siga en la carpeta (no hay vuelta al legacy)', () => {
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID), H.retirado(1));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'NO', codigo: 'ITF_NOT_FOUND' });
  });
  test('legacy retirado explicitamente: NO aunque el archivo siga', () => {
    cargar(H.legacy(), H.retirado(LEGACY_ID));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'NO' });
  });
  test('reversion al legacy: el legacy vuelve a ser el vigente', () => {
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID), H.revertido(LEGACY_ID, 1));
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID });
  });
  test('legacy registrado y vigente cuyo archivo ya no esta: NO (no se afirma un ITF que no se puede servir)', () => {
    cargar(H.legacy());
    E.drive.quitar('legacy-' + W);
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'NO' });
  });
  test('AISLAMIENTO: un pozo corrupto no afecta a los demas', () => {
    entorno({ archivos: [lf(W), lf(OTRO)] });
    activar();
    cargar(H.propuesto(1), H.aprobado(1), H.aprobado(1), H.propuesto(2, { wellId: OTRO }), H.aprobado(2, null, { wellId: OTRO }));
    expect(S.itfService_resolverVigente(W).estado).toBe('DESCONOCIDO');
    expect(S.itfService_resolverVigente(OTRO)).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: H.doc(2) });
    expect(S.itfService_resolverVigente('14-0099')).toMatchObject({ estado: 'NO' });
  });
});

describe('resolverVigente: fallas de infraestructura y sin fallback inseguro', () => {
  test('modo legacy puro: NUNCA se lee ItfEventos (ni siquiera existe la hoja)', () => {
    entorno({ archivos: [lf(W)], sinHoja: true });
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY' });
  });
  test('E9 activo y la hoja NO se puede leer: lanza. No hay fallback al legacy', () => {
    entorno({ archivos: [lf(W)], sinHoja: true });
    activar();
    expect(() => S.itfService_resolverVigente(W)).toThrow(/ItfEventos/);
    expect(() => S.itfService_getProfile(W)).toThrow(/ItfEventos/);
    expect(() => S.itfService_disponibilidad([W])).toThrow(/ItfEventos/);
  });
  test('E9 activo y el esquema de la hoja esta roto: lanza', () => {
    entorno({ archivos: [lf(W)], sinHoja: true });
    E.hojas.ItfEventos = require('./fakeSheets').crearHoja('ItfEventos', [['a', 'b']]);
    global.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => E.hojas[n] || null }), flush: () => {} };
    activar();
    expect(() => S.itfService_resolverVigente(W)).toThrow(/esquema/);
  });
  test('Drive caido: lanza (no se vuelve "no existe")', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    E.drive.estado.fallar = 'Drive caido';
    expect(() => S.itfService_resolverVigente(W)).toThrow(/Drive caido/);
  });
  test('con un vigente E9, un Drive caido no importa (no hace falta mirarlo)', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.aprobado(1));
    E.drive.estado.fallar = 'Drive caido';
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'E9' });
  });
  test('el interruptor es exactamente "SI"', () => {
    entorno({ archivos: [lf(W)], sinHoja: true });
    ['si', 'true', '1', 'SI ', '', 'NO', undefined].forEach((v) => {
      E.props.ITF_E9_ACTIVO = v;
      expect(S.itfService_e9Activo()).toBe(false);
    });
    E.props.ITF_E9_ACTIVO = 'SI';
    expect(S.itfService_e9Activo()).toBe(true);
  });
  test('el resultado interno lleva la referencia de storage pero NO email, hash ni clientRequestId; abrir() no es enumerable', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.aprobado(1));
    const r = S.itfService_resolverVigente(W);
    expect(Object.keys(r).sort()).toEqual(['bytes', 'codigo', 'documentoId', 'estado', 'integridad', 'legacy', 'mimeType', 'origen', 'storageRef', 'wellId']);
    expect(JSON.stringify(r)).not.toMatch(/@x\.com|req-|sha256|secuencia/);
  });
});

describe('getProfile: equivalencia con el comportamiento actual (cero eventos) y desacople del origen', () => {
  const bytes = JPEG(512, 3);
  test.each([['modo legacy puro', false], ['E9 activo con hoja vacia', true]])('un pozo con ITF legacy devuelve EXACTAMENTE lo que devuelve profileService_getProfile (%s)', (n, activo) => {
    entorno({ archivos: [lf(W, bytes)] });
    if (activo) { activar(); }
    const viejo = E.mods.perfil.profileService_getProfile(W);
    const nuevo = S.itfService_getProfile(W);
    expect(nuevo.found).toBe(viejo.found);
    expect(nuevo.blob.getBytes()).toEqual(viejo.blob.getBytes());
    expect(nuevo.blob.getContentType()).toBe(viejo.blob.getContentType());
  });
  test.each([['modo legacy puro', false], ['E9 activo con hoja vacia', true]])('un pozo SIN ITF devuelve found:false como hoy (%s)', (n, activo) => {
    entorno({ archivos: [lf(OTRO)] });
    if (activo) { activar(); }
    expect(E.mods.perfil.profileService_getProfile(W)).toEqual({ found: false });
    expect(S.itfService_getProfile(W)).toMatchObject({ found: false });
    expect(S.itfService_getProfile(W).unknown).toBeUndefined();
  });
  test('un error de Drive se comporta como hoy: lanza', () => {
    entorno({ archivos: [lf(W)] });
    E.drive.estado.fallar = 'Drive caido';
    expect(() => E.mods.perfil.profileService_getProfile(W)).toThrow(/Drive caido/);
    expect(() => S.itfService_getProfile(W)).toThrow(/Drive caido/);
  });
  test('una sola llamada a Drive por getProfile legacy (igual que hoy), sin lecturas de hoja en modo puro', () => {
    entorno({ archivos: [lf(W, bytes)] });
    S.itfService_getProfile(W);
    expect(E.drive.calls.getFilesByName).toBe(1);
    expect(E.drive.calls.getFileById).toBe(0);
    expect(E.drive.calls.getFiles).toBe(0);
  });
  test('DIFERENCIA DOCUMENTADA: con dos archivos del mismo nombre hoy se toma el primero en silencio; el servicio nuevo responde "no se sabe" (LEGACY_AMBIGUO)', () => {
    entorno({ archivos: [lf(W, JPEG(100, 1), 'a-' + W), lf(W, JPEG(100, 2), 'b-' + W)] });
    expect(E.mods.perfil.profileService_getProfile(W).found).toBe(true);
    expect(S.itfService_getProfile(W)).toEqual({ found: false, unknown: true, code: 'LEGACY_AMBIGUO' });
  });
  test('con un vigente E9 los bytes salen del storage (abstraccion), con el mismo contrato getBytes / getContentType', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    const png = PNG(64);
    const ref = 'e9-storage-000099';
    E.storage.docs[ref] = { bytes: png, mimeType: 'image/png' };
    cargar(H.propuesto(1, { storageFileId: ref, mimeType: 'image/png' }), H.legacy(), H.aprobado(1, LEGACY_ID));
    const r = S.itfService_getProfile(W, depsDe(E));
    expect(r.found).toBe(true);
    expect(r.blob.getBytes()).toEqual(png);
    expect(r.blob.getContentType()).toBe('image/png');
    expect(E.drive.calls.getBlob).toBe(0);                               // el legacy fisico NO se descarga
    expect(Object.keys(r).sort()).toEqual(['blob', 'found']);            // no se expone documentoId ni storageRef
  });
  test('el storage E9 falla: found:false + unknown (nunca se cae al legacy)', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID));
    E.storage.fallarLeer = true;
    expect(S.itfService_getProfile(W, depsDe(E))).toEqual({ found: false, unknown: true, code: 'SERVICE_UNAVAILABLE' });
  });
  test('sin storage configurado (el estado de E9-3): un vigente E9 responde ITF_STORAGE_NO_CONFIGURADO', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.propuesto(1), H.legacy(), H.aprobado(1, LEGACY_ID));
    expect(S.itfService_getProfile(W)).toEqual({ found: false, unknown: true, code: 'ITF_STORAGE_NO_CONFIGURADO' });
  });
  test('historial no derivable: found:false + unknown + ITF_STATE_UNKNOWN', () => {
    entorno({ archivos: [lf(W)] });
    activar();
    cargar(H.aprobado(7));
    expect(S.itfService_getProfile(W)).toEqual({ found: false, unknown: true, code: 'ITF_STATE_UNKNOWN' });
  });
});

describe('disponibilidad en lote', () => {
  const carpeta = () => {
    const archivos = [];
    for (let i = 1; i <= 700; i += 1) { if (i % 3 !== 0) { archivos.push({ id: 'id-' + i + '-abcdef', name: '14-' + String(i).padStart(4, '0') + '.jpg', bytes: JPEG(50) }); } }
    return archivos;
  };
  const ids = (n) => { const out = []; for (let i = 1; i <= n; i += 1) { out.push('14-' + String(i).padStart(4, '0')); } return out; };

  test.each([['modo legacy puro', false], ['E9 activo con hoja vacia', true]])('equivalencia: mismos booleanos que itfAvailabilityService_checkDisponibilidad (%s)', (n, activo) => {
    entorno({ archivos: carpeta() });
    if (activo) { activar(); }
    const viejo = E.mods.disp.itfAvailabilityService_checkDisponibilidad(ids(700));
    CacheService.getScriptCache().remove('itf_idx_14');
    expect(S.itfService_disponibilidad(ids(700))).toEqual(viejo);
  });
  test.each([1, 50, 500, 700])('%i pozos: UNA lectura de ItfEventos, UNA pasada por la carpeta, CERO busquedas por nombre (no hay N+1)', (n) => {
    entorno({ archivos: carpeta() });
    activar();
    cargar(H.propuesto(1, { wellId: '14-0003' }), H.aprobado(1, null, { wellId: '14-0003' }));
    const lecturas = lecturasHoja();
    const r = S.itfService_disponibilidad(ids(n));
    expect(Object.keys(r)).toHaveLength(n);
    expect(lecturas()).toBe(1);
    expect(E.drive.calls.getFiles).toBe(1);
    expect(E.drive.calls.getFilesByName).toBe(0);
    expect(E.drive.calls.getFileById).toBe(0);
    expect(E.drive.calls.getBlob).toBe(0);
  });
  test('modo legacy puro: cero lecturas de la hoja de eventos', () => {
    entorno({ archivos: carpeta(), sinHoja: true });
    expect(Object.keys(S.itfService_disponibilidad(ids(500)))).toHaveLength(500);
  });
  test('tabla de estados: legacy -> true, E9 vigente -> true, solo propuesta -> false, rechazado -> false, retirado sin vigente -> false', () => {
    const w = (n) => '15-000' + n;
    entorno({ archivos: [lf(w(1)), lf(w(3)), lf(w(6))] });
    activar();
    cargar(
      H.propuesto(1, { wellId: w(2) }), H.aprobado(1, null, { wellId: w(2) }),                                 // 15-0002: E9 vigente, sin legacy
      H.propuesto(2, { wellId: w(4) }),                                                                         // 15-0004: solo propuesta, sin legacy
      H.propuesto(3, { wellId: w(5) }), H.rechazado(3, { wellId: w(5) }),                                      // 15-0005: rechazada, sin legacy
      H.propuesto(4, { wellId: w(6) }), H.legacy(w(6)), H.aprobado(4, 'LEGACY:' + w(6), { wellId: w(6) }), H.retirado(4, { wellId: w(6) })   // 15-0006: retirado sin vigente (el legacy sigue en la carpeta)
    );
    expect(S.itfService_disponibilidad([w(1), w(2), w(3), w(4), w(5), w(6), w(7)])).toEqual({
      [w(1)]: true, [w(2)]: true, [w(3)]: true, [w(4)]: false, [w(5)]: false, [w(6)]: false, [w(7)]: false
    });
  });
  test('un pozo corrupto o ambiguo (tambien jpg + JPG) se OMITE: nunca un "No" enganoso; una variante unica (.JPG) SI cuenta como tiene ITF', () => {
    entorno({ archivos: [lf('15-0001'), lf('15-0002'), { id: 'dup-15-0002', name: '15-0002.jpg', bytes: JPEG(10) }, { id: 'may-15-0003', name: '15-0003.JPG', bytes: JPEG(10) }, lf('15-0004'), lf('15-0006'), { id: 'may-15-0006', name: '15-0006.JPG', bytes: JPEG(10) }] });
    activar();
    cargar(H.propuesto(1, { wellId: '15-0004' }), H.aprobado(1, null, { wellId: '15-0004' }), H.aprobado(1, null, { wellId: '15-0004' }));
    const r = S.itfService_disponibilidad(['15-0001', '15-0002', '15-0003', '15-0004', '15-0005', '15-0006']);
    expect(r).toEqual({ '15-0001': true, '15-0003': true, '15-0005': false });
    ['15-0002', '15-0004', '15-0006'].forEach((id) => expect(Object.prototype.hasOwnProperty.call(r, id)).toBe(false));
  });
  test('los valores son SOLO booleanos (nada de ids, estados ni detalles)', () => {
    entorno({ archivos: carpeta() });
    activar();
    Object.values(S.itfService_disponibilidad(ids(100))).forEach((v) => expect(typeof v).toBe('boolean'));
  });
  test('un vigente E9 en un pozo cuyo legacy es ambiguo igual se contesta (el E9 decide)', () => {
    entorno({ archivos: [lf('15-0001'), { id: 'dup', name: '15-0001.jpg', bytes: JPEG(10) }] });
    activar();
    cargar(H.propuesto(1, { wellId: '15-0001' }), H.aprobado(1, null, { wellId: '15-0001' }));
    expect(S.itfService_disponibilidad(['15-0001'])).toEqual({ '15-0001': true });
  });
  test('falla de eventos (E9 activo): lanza, no devuelve parcial ni falsos "No"', () => {
    entorno({ archivos: carpeta(), sinHoja: true });
    activar();
    expect(() => S.itfService_disponibilidad(ids(10))).toThrow(/ItfEventos/);
  });
  test('falla de Drive: lanza', () => {
    entorno({ archivos: carpeta() });
    E.drive.estado.fallar = 'Drive caido';
    expect(() => S.itfService_disponibilidad(ids(10))).toThrow(/Drive caido/);
  });
  test('lista vacia: nada', () => {
    entorno({ archivos: [] });
    expect(S.itfService_disponibilidad([])).toEqual({});
  });
});

describe('descarga de un documento cualquiera (historial futuro del validador)', () => {
  const bytesLegacy = JPEG(256, 11);
  const conLegacyRegistrado = () => {
    entorno({ archivos: [lf(W, bytesLegacy)] });
    activar();
    E.storage.docs['e9-storage-000001'] = { bytes: PNG(40), mimeType: 'image/png' };
    E.storage.docs['e9-storage-000002'] = { bytes: JPEG(60, 2), mimeType: 'image/jpeg' };
    cargar(
      H.propuesto(1, { storageFileId: 'e9-storage-000001', mimeType: 'image/png' }),
      H.legacy(W, { storageFileId: 'legacy-' + W, sha256: sha256(bytesLegacy), bytes: bytesLegacy.length }),
      H.aprobado(1, LEGACY_ID),
      H.propuesto(2, { storageFileId: 'e9-storage-000002' })
    );
  };
  test('un legacy REEMPLAZADO se puede descargar desde el historial, por el id registrado (no por el nombre) y verificando su hash', () => {
    conLegacyRegistrado();
    const r = S.itfService_obtenerDocumento(LEGACY_ID, depsDe(E));
    expect(r.ok).toBe(true);
    expect(r.estado).toBe('REEMPLAZADO');
    expect(r.blob.getBytes()).toEqual(bytesLegacy);
    expect(E.drive.calls.getFileById).toBe(1);
    expect(E.drive.calls.getFilesByName).toBe(0);
  });
  test('si el legacy cambio desde que se registro, NO se entrega: LEGACY_CAMBIO', () => {
    conLegacyRegistrado();
    E.drive.estado.archivos[0].bytes = JPEG(256, 12);
    expect(S.itfService_obtenerDocumento(LEGACY_ID, depsDe(E))).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
  });
  test('un documento E9 (vigente) y una propuesta pendiente salen del storage; el validador puede verlos sin hacerlos vigentes', () => {
    conLegacyRegistrado();
    const vigente = S.itfService_obtenerDocumento(H.doc(1), depsDe(E));
    expect(vigente).toMatchObject({ ok: true, estado: 'VIGENTE' });
    expect(vigente.blob.getContentType()).toBe('image/png');
    const pendiente = S.itfService_obtenerDocumento(H.doc(2), depsDe(E));
    expect(pendiente).toMatchObject({ ok: true, estado: 'PROPUESTO' });
    expect(S.itfService_resolverVigente(W).documentoId).toBe(H.doc(1));
  });
  test('documento inexistente, id invalido, pozo no derivable, E9 apagado: error sin detalle', () => {
    conLegacyRegistrado();
    expect(S.itfService_obtenerDocumento(H.doc(77), depsDe(E))).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    expect(S.itfService_obtenerDocumento('no-es-un-id', depsDe(E))).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    expect(S.itfService_obtenerDocumento('LEGACY:99-9999', depsDe(E))).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    cargar(H.aprobado(9));
    expect(S.itfService_obtenerDocumento(H.doc(1), depsDe(E))).toMatchObject({ ok: false, code: 'ITF_STATE_UNKNOWN' });
    E.props.ITF_E9_ACTIVO = 'NO';
    expect(S.itfService_obtenerDocumento(H.doc(1), depsDe(E))).toMatchObject({ ok: false, code: 'ITF_E9_INACTIVO' });
  });
  test('el storage falla o no esta configurado: codigo claro, sin caer a otra fuente', () => {
    conLegacyRegistrado();
    E.storage.fallarLeer = true;
    expect(S.itfService_obtenerDocumento(H.doc(1), depsDe(E))).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(S.itfService_obtenerDocumento(H.doc(1))).toMatchObject({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
  });
  test('el resultado no trae email, hash ni referencias de storage', () => {
    conLegacyRegistrado();
    const r = S.itfService_obtenerDocumento(H.doc(1), depsDe(E));
    expect(Object.keys(r).sort()).toEqual(['blob', 'estado', 'ok']);
  });
});

describe('pozoExiste: fuente institucional PREVIA (una propuesta no prueba que el pozo exista)', () => {
  const fuentes = (extra) => {
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
    Object.assign(global, extra || {});
  };
  test('un pozo que solo tiene propuestas en ItfEventos NO existe', () => {
    entorno({ archivos: [] });
    fuentes();
    activar();
    cargar(H.propuesto(1), H.propuesto(2), H.legacy());
    expect(S.itfService_pozoExiste(W)).toEqual({ existe: false, indeterminado: false });
  });
  test('un E9 vigente tampoco prueba la existencia (sin padron / legacy / NE / correccion previa)', () => {
    entorno({ archivos: [] });
    fuentes();
    activar();
    cargar(H.propuesto(1), H.aprobado(1));
    expect(S.itfService_pozoExiste(W).existe).toBe(false);
  });
  test('NINGUN ITF es evidencia de existencia: ni el archivo legacy actual (la rama ITF de PozoExistenciaService se excluye) ni uno nuevo', () => {
    entorno({ archivos: [lf(W)] });
    fuentes();
    expect(S.itfService_pozoExiste(W)).toEqual({ existe: false, indeterminado: false });
    expect(E.drive.calls.getFilesByName).toBe(0);                                  // ni siquiera se consulta Drive
    expect(E.mods.dominio).toBeDefined();
    // en cambio el servicio de existencia general (E4) sigue aceptando el legacy: la exclusion es solo de los ITF colaborativos
    expect(E.mods.drive.driveProfileRepository_existe(W)).toBe(true);
  });
  test('el padron, el punto NE o una correccion previa SI lo prueban', () => {
    entorno({ archivos: [lf(W)] });
    fuentes({ registryService_getWellLocation: jest.fn(() => ({ found: true, location: {} })) });
    expect(S.itfService_pozoExiste(W).existe).toBe(true);
    entorno({ archivos: [] });
    fuentes({ nivelesEstaticosRepository_getPunto: jest.fn(() => ({ found: true })) });
    expect(S.itfService_pozoExiste(W).existe).toBe(true);
    entorno({ archivos: [] });
    fuentes({ ubicacionCorreccionRepository_listarCorrecciones: jest.fn(() => [{ wellId: W }]) });
    expect(S.itfService_pozoExiste(W).existe).toBe(true);
  });
  test('una fuente que falla sin que otra confirme es indeterminado (nunca "no existe")', () => {
    entorno({ archivos: [] });
    fuentes({ nivelesEstaticosRepository_getPunto: jest.fn(() => { throw new Error('hoja caida'); }) });
    expect(S.itfService_pozoExiste(W)).toEqual({ existe: false, indeterminado: true });
  });
  test('el servicio de existencia no lee ItfEventos ni el storage E9', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'PozoExistenciaService.js'), 'utf8');
    expect(fuente).not.toMatch(/ItfEventos|itfEventosRepository|itfDominio|ItfStorage/);
  });
});

describe('contadores de lecturas remotas: el costo crece en CPU / memoria, NO en lecturas por pozo', () => {
  const carpeta = () => {
    const archivos = [];
    for (let i = 1; i <= 700; i += 1) { if (i % 3 !== 0) { archivos.push({ id: 'id-' + i + '-abcdef', name: '14-' + String(i).padStart(4, '0') + '.jpg', bytes: JPEG(50) }); } }
    return archivos;
  };
  const ids = (n) => { const out = []; for (let i = 1; i <= n; i += 1) { out.push('14-' + String(i).padStart(4, '0')); } return out; };

  test.each([1, 50, 500, 700])('%i pozos: 1 lectura de ItfEventos, 1 llamada al proveedor legacy, 0 busquedas por pozo, 1 derivacion', (n) => {
    entorno({ archivos: carpeta() });
    activar();
    cargar(H.propuesto(1, { wellId: '14-0003' }), H.aprobado(1, null, { wellId: '14-0003' }));
    const deps = depsDe(E);
    const leerTodos = jest.fn(deps.repo.leerTodos);
    const disponibilidad = jest.fn(deps.legacy.disponibilidad);
    const buscar = jest.fn(deps.legacy.buscar);
    const huella = jest.fn(deps.legacy.huella);
    deps.repo = Object.assign({}, deps.repo, { leerTodos: leerTodos });
    deps.legacy = Object.assign({}, deps.legacy, { disponibilidad: disponibilidad, buscar: buscar, huella: huella });
    const derivar = jest.spyOn(global, 'itfDominio_derivar');
    const lecturas = lecturasHoja();
    const r = S.itfService_disponibilidad(ids(n), deps);
    expect(Object.keys(r)).toHaveLength(n);
    expect(leerTodos).toHaveBeenCalledTimes(1);
    expect(lecturas()).toBe(1);
    expect(disponibilidad).toHaveBeenCalledTimes(1);
    expect(buscar).not.toHaveBeenCalled();
    expect(huella).not.toHaveBeenCalled();
    expect(derivar).toHaveBeenCalledTimes(1);
    expect(E.drive.calls.getFiles).toBe(1);
    expect(E.drive.calls.getFilesByName).toBe(0);
    expect(E.drive.calls.getFileById).toBe(0);
    expect(E.drive.calls.getBlob).toBe(0);
    derivar.mockRestore();
  });
  test('modo legacy puro: 0 lecturas de eventos y 1 llamada al proveedor, para cualquier N', () => {
    [1, 50, 500, 700].forEach((n) => {
      entorno({ archivos: carpeta(), sinHoja: true });
      const deps = depsDe(E);
      const leerTodos = jest.fn(deps.repo.leerTodos);
      const disponibilidad = jest.fn(deps.legacy.disponibilidad);
      deps.repo = Object.assign({}, deps.repo, { leerTodos: leerTodos });
      deps.legacy = Object.assign({}, deps.legacy, { disponibilidad: disponibilidad });
      S.itfService_disponibilidad(ids(n), deps);
      expect(leerTodos).not.toHaveBeenCalled();
      expect(disponibilidad).toHaveBeenCalledTimes(1);
    });
  });
  test('la segunda consulta (indice caliente) no toca Drive; con un solo pozo sin el indice tampoco hace busquedas por nombre', () => {
    entorno({ archivos: carpeta() });
    activar();
    S.itfService_disponibilidad(ids(700), depsDe(E));
    const antes = E.drive.calls.getFiles;
    S.itfService_disponibilidad(ids(500), depsDe(E));
    expect(E.drive.calls.getFiles).toBe(antes);
    expect(E.drive.calls.getFilesByName).toBe(0);
  });
});

describe('MATRIZ A-I: cada caso con su resolucion, su respuesta de disponibilidad (SI / NO / DESCONOCIDO -> true / false / sin clave) y su getProfile', () => {
  const REF = 'e9-storage-000077';
  const bytesE9 = PNG(48);
  const preparar = (archivos, eventos, extra) => {
    entorno(Object.assign({ archivos: archivos }, extra || {}));
    activar();
    E.storage.docs[REF] = { bytes: bytesE9, mimeType: 'image/png' };
    cargar(...eventos());
  };
  const prop = (n) => H.propuesto(n, { storageFileId: REF, mimeType: 'image/png' });
  const casos = [
    ['A. legacy existe + 0 eventos -> LEGACY vigente', [lf(W)], () => [], { estado: 'SI', origen: 'LEGACY' }, true, 'legacy'],
    ['B. legacy no existe + 0 eventos -> SIN_ITF', [], () => [], { estado: 'NO', origen: null }, false, 'no'],
    ['C. legacy ambiguo -> DESCONOCIDO (error institucional)', [lf(W), { id: 'dup-' + W + '-x', name: W + '.jpg', bytes: JPEG(9) }], () => [], { estado: 'DESCONOCIDO', codigo: 'LEGACY_AMBIGUO' }, undefined, 'desconocido'],
    ['D. legacy + propuesta -> el legacy sigue vigente', [lf(W)], () => [prop(1)], { estado: 'SI', origen: 'LEGACY' }, true, 'legacy'],
    ['E. legacy registrado solamente -> el legacy sigue vigente', [lf(W)], () => [H.legacy()], { estado: 'SI', origen: 'LEGACY' }, true, 'legacy'],
    ['F. legacy reemplazado por E9 -> E9 vigente', [lf(W)], () => [prop(1), H.legacy(), H.aprobado(1, LEGACY_ID)], { estado: 'SI', origen: 'E9' }, true, 'e9'],
    ['G. E9 vigente + legacy fisico todavia existe -> SOLO E9', [lf(W)], () => [prop(1), H.legacy(), H.aprobado(1, LEGACY_ID)], { estado: 'SI', origen: 'E9' }, true, 'e9'],
    ['H. E9 retirado sin restauracion -> SIN_ITF', [lf(W)], () => [prop(1), H.legacy(), H.aprobado(1, LEGACY_ID), H.retirado(1)], { estado: 'NO', origen: null }, false, 'no'],
    ['I. historial corrupto -> DESCONOCIDO', [lf(W)], () => [prop(1), H.aprobado(1), H.aprobado(1)], { estado: 'DESCONOCIDO', codigo: 'ITF_STATE_UNKNOWN', integridad: 'NO_DERIVABLE' }, undefined, 'desconocido']
  ];
  test.each(casos)('%s', (nombre, archivos, eventos, esperado, disponible, perfil) => {
    preparar(archivos, eventos);
    const deps = depsDe(E);
    expect(S.itfService_resolverVigente(W, deps)).toMatchObject(esperado);
    const disp = S.itfService_disponibilidad([W], deps);
    if (disponible === undefined) {
      expect(Object.prototype.hasOwnProperty.call(disp, W)).toBe(false);                    // DESCONOCIDO NUNCA se vuelve false
    } else {
      expect(disp).toEqual({ [W]: disponible });
    }
    E.drive.calls.getBlob = 0;
    const p = S.itfService_getProfile(W, deps);
    if (perfil === 'legacy') {
      expect(p.found).toBe(true);
      expect(p.blob.getBytes()).toEqual(E.drive.estado.archivos[0].bytes);
    } else if (perfil === 'e9') {
      expect(p.found).toBe(true);
      expect(p.blob.getBytes()).toEqual(bytesE9);                                           // los bytes del E9, no los del legacy fisico
      expect(E.drive.calls.getBlob).toBe(0);
    } else if (perfil === 'no') {
      expect(p).toMatchObject({ found: false });
      expect(p.unknown).toBeUndefined();
    } else {
      expect(p).toMatchObject({ found: false, unknown: true });
    }
    expect(Object.keys(p).filter((k) => ['documentoId', 'storageRef', 'origen'].indexOf(k) >= 0)).toEqual([]);
  });
  test('la forma de la respuesta es la misma para legacy y E9 (el cliente no conoce el origen)', () => {
    preparar([lf(W)], () => []);
    const legacy = S.itfService_getProfile(W, depsDe(E));
    preparar([lf(W)], () => [prop(1), H.legacy(), H.aprobado(1, LEGACY_ID)]);
    const e9 = S.itfService_getProfile(W, depsDe(E));
    expect(Object.keys(legacy).sort()).toEqual(Object.keys(e9).sort());
    expect(typeof legacy.blob.getBytes).toBe(typeof e9.blob.getBytes);
    expect(typeof legacy.blob.getContentType).toBe(typeof e9.blob.getContentType);
  });
});
