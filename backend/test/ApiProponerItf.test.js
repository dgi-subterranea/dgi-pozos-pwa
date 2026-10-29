// E9-4, capa Api de PROPONER un ITF (handleProponerItf): gates exactos (perfil + perfil_subir), orden sesion -> permisos -> interruptor -> entrada -> servicio, lista blanca de campos (el cliente NUNCA manda
// documentoId, hash, bytes, storageFileId, email, nombre, timestamp ni estado), identidad solo de la sesion, DTO minimo sin storage / hash / email, Historial resumido (un reintento no escribe otra fila),
// sin Telegram, y la cadena REAL (Api -> ItfService -> proveedor de storage -> cliente HMAC) con hoja y storage en memoria. Nada toca Google.
const { crearEntorno, JPEG, PNG, sha256 } = require('./itfEntorno');

const EMAIL = 'sesion@example.com';
const W = '14-0001';
const PROPONE = { perfil: true, perfil_subir: true };

let E;
let Api;
let almacen;
let llamadasStorage;
let n = 0;

const crid = () => { n += 1; return 'api-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');
const imagen = (relleno, tam) => JPEG(tam || 400, relleno);
const cuerpo = (extra) => Object.assign({ wellId: W, imageBase64: b64(imagen(1)), mimeType: 'image/jpeg', nombreOriginal: 'itf-14-0001.jpg', clientRequestId: crid() }, extra || {});
const proponer = (b) => Api.handleProponerItf('t', b === undefined ? cuerpo() : b);
const filas = () => E.hoja.filas.slice(1);

function como(permisos) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
}

function montar(opciones) {
  E = crearEntorno(Object.assign({ archivos: [], props: { ITF_E9_ACTIVO: 'SI' } }, opciones || {}));
  Api = require('../src/Api');
  global.getUserAccess.mockReturnValue({ nombre: 'Ana Proponente' });
  como(PROPONE);
  almacen = {};
  llamadasStorage = [];
  // el storage REAL se simula por el cliente HMAC de Fotos: el proveedor de ITF lo usa tal cual
  global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
    llamadasStorage.push({ accion: accion, payload: payload });
    if (accion === 'putItf') {
      const ref = 'itf-ref-' + String(Object.keys(almacen).length + 1).padStart(6, '0');
      almacen[ref] = payload;
      return { status: 'ok', driveFileId: ref, tamanoBytes: 1 };
    }
    if (accion === 'trashItf') {
      delete almacen[payload.driveFileId];
      return { status: 'ok' };
    }
    throw new Error('accion inesperada ' + accion);
  });
  // fuentes independientes de existencia: por defecto el padron conoce el pozo
  global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: {} }));
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  global.UrlFetchApp = { fetch: jest.fn() };
}

beforeEach(() => montar());

describe('gates exactos de permiso (perfil + perfil_subir) y orden de chequeos', () => {
  test('sin sesion valida: UNAUTHORIZED; usuario inactivo: USER_DISABLED; nada se ejecuta', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(proponer().code).toBe('UNAUTHORIZED');
    global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
    global.isUserActive.mockReturnValue(false);
    expect(proponer().code).toBe('USER_DISABLED');
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
  });
  test.each([
    ['solo perfil', { perfil: true }],
    ['solo perfil_subir (sin perfil)', { perfil_subir: true }],
    ['perfil_validar sin perfil', { perfil_validar: true }],
    ['perfil + perfil_validar (validar no es proponer)', { perfil: true, perfil_validar: true }],
    ['perfil_subir + perfil_validar sin perfil', { perfil_subir: true, perfil_validar: true }],
    ['ningun permiso', {}],
    ['perfil falso', { perfil: false, perfil_subir: true }],
    ['perfil_subir falso', { perfil: true, perfil_subir: false }]
  ])('%s -> PERMISSION_DENIED y no se toca la hoja ni el storage', (nombre, permisos) => {
    como(permisos);
    expect(proponer()).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'proponerItf', null, 'PERMISSION_DENIED');
  });
  test('valores truthy que no son el booleano true NO habilitan', () => {
    ['SI', 1, 'true', {}, []].forEach((v) => {
      global.hasPermission.mockImplementation((email, modulo) => (modulo === 'perfil' || modulo === 'perfil_subir' ? v : false));
      expect(proponer().code).toBe('PERMISSION_DENIED');
    });
    expect(llamadasStorage).toEqual([]);
  });
  test('perfil + perfil_subir: pasa', () => {
    como(PROPONE);
    expect(proponer().status).toBe('ok');
  });
  test('el permiso se chequea ANTES que el interruptor: quien no puede no se entera de si esta apagado', () => {
    E.props.ITF_E9_ACTIVO = 'NO';
    como({ perfil: true });
    expect(proponer().code).toBe('PERMISSION_DENIED');
  });
});

describe('interruptor ITF_E9_ACTIVO', () => {
  test('apagado: ITF_E9_INACTIVO ANTES de tocar la hoja o el storage (ni siquiera tiene que existir la hoja)', () => {
    montar({ sinHoja: true, props: {} });
    const r = proponer();
    expect(r).toMatchObject({ status: 'error', code: 'ITF_E9_INACTIVO' });
    expect(llamadasStorage).toEqual([]);
    expect(E.hojas.ItfEventos).toBeUndefined();
  });
  test.each(['si', 'true', '1', 'SI ', '', 'NO'])('un valor que no es exactamente "SI" (%j) cuenta como apagado', (valor) => {
    E.props.ITF_E9_ACTIVO = valor;
    expect(proponer().code).toBe('ITF_E9_INACTIVO');
    expect(llamadasStorage).toEqual([]);
  });
  test('encendido y la hoja ItfEventos NO existe: SERVICE_UNAVAILABLE; no se crea sola, no se sube nada y no hay fallback a la carpeta legacy', () => {
    montar({ sinHoja: true, archivos: [{ id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) }] });
    const r = proponer();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(E.hojas.ItfEventos).toBeUndefined();
    expect(llamadasStorage).toEqual([]);
    expect(E.drive.estado.archivos).toHaveLength(1);
  });
  test('encendido y el storage NO esta configurado (sin cliente / sin URL): ITF_STORAGE_NO_CONFIGURADO; nada se escribe', () => {
    delete global.fotosStorageClient_llamar;
    expect(proponer()).toMatchObject({ status: 'error', code: 'ITF_STORAGE_NO_CONFIGURADO' });
    expect(filas()).toHaveLength(0);
    global.fotosStorageClient_llamar = jest.fn(() => { throw new Error('FOTOS_STORAGE_URL no configurado en Script Properties'); });
    expect(proponer().code).toBe('ITF_STORAGE_NO_CONFIGURADO');
  });
  test('el storage desplegado todavia no tiene las acciones de ITF (UNKNOWN_ACTION): ITF_STORAGE_NO_CONFIGURADO', () => {
    global.fotosStorageClient_llamar = jest.fn(() => { throw new Error('storage devolvio error: UNKNOWN_ACTION'); });
    expect(proponer().code).toBe('ITF_STORAGE_NO_CONFIGURADO');
    expect(filas()).toHaveLength(0);
  });
});

describe('entrada: lista blanca de campos y validacion', () => {
  test.each(['documentoId', 'documentId', 'hash', 'sha256', 'bytes', 'storageFileId', 'storageRef', 'email', 'nombre', 'actor', 'timestamp', 'timestampUtc', 'estado', 'secuencia', 'eventoId', 'driveFileId', 'carpeta', 'folderId', 'url', 'archivo'])(
    'el campo %s se RECHAZA (INVALID_REQUEST), no se ignora', (campo) => {
      expect(proponer(cuerpo({ [campo]: 'x' })).code).toBe('INVALID_REQUEST');
      expect(llamadasStorage).toEqual([]);
      expect(filas()).toHaveLength(0);
    });
  test('wellId invalido', () => {
    ['', '14-001', '1-0001', 'AA-0001', '14_0001', null, undefined, 1401].forEach((w) => expect(proponer(cuerpo({ wellId: w })).code).toBe('INVALID_WELL_ID'));
  });
  test('imageBase64: ausente, vacio, no string, caracteres invalidos, largo no multiplo de 4, o mas grande que el maximo', () => {
    const maxBase64 = Math.ceil(3 * 1024 * 1024 / 3) * 4;
    ['', null, undefined, 5, 'no es base64!!', 'AAA', 'AAAA ', ' AAAA', 'AA=A', 'A'.repeat(maxBase64 + 4)].forEach((v) => {
      expect(proponer(cuerpo({ imageBase64: v })).code).toBe('INVALID_ARCHIVO');
    });
    expect(llamadasStorage).toEqual([]);
  });
  test('mimeType no string, y nombreOriginal no string o demasiado largo', () => {
    [null, undefined, 5, {}].forEach((m) => expect(proponer(cuerpo({ mimeType: m })).code).toBe('INVALID_ARCHIVO'));
    [5, {}, 'x'.repeat(501)].forEach((nombre) => expect(proponer(cuerpo({ nombreOriginal: nombre })).code).toBe('INVALID_ARCHIVO'));
    expect(proponer(cuerpo({ nombreOriginal: undefined })).status).toBe('ok');
  });
  test('clientRequestId obligatorio (8 a 64 caracteres)', () => {
    ['', 'corto', 'a'.repeat(65), null, undefined, 'con espacio!!'].forEach((id) => expect(proponer(cuerpo({ clientRequestId: id })).code).toBe('INVALID_CLIENT_REQUEST_ID'));
  });
  test('archivo que no es JPEG / PNG: PDF, GIF, WEBP, MIME falso, magic falso, vacio', () => {
    const casos = [
      [b64(Array.from(Buffer.from('%PDF-1.7 xxxxxxxxxxxx'))), 'application/pdf', 'MIME_NO_PERMITIDO'],
      [b64(Array.from(Buffer.from('%PDF-1.7 xxxxxxxxxxxx'))), 'image/jpeg', 'FORMATO_NO_RECONOCIDO'],
      [b64(Array.from(Buffer.from('GIF89a xxxxxxxxxxxxxx'))), 'image/gif', 'MIME_NO_PERMITIDO'],
      [b64(Array.from(Buffer.from('RIFFxxxxWEBPVP8 xxxx'))), 'image/webp', 'MIME_NO_PERMITIDO'],
      [b64(PNG(64)), 'image/jpeg', 'MIME_NO_COINCIDE'],
      [b64(imagen(1, 100)), 'image/png', 'MIME_NO_COINCIDE'],
      [b64(imagen(1, 100)), 'IMAGE/JPG', 'MIME_NO_PERMITIDO']
    ];
    casos.forEach(([imageBase64, mimeType, code]) => expect(proponer(cuerpo({ imageBase64: imageBase64, mimeType: mimeType })).code).toBe(code));
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
  });
});

describe('caso feliz: DTO minimo, Historial resumido, sin Telegram, solo en el storage privado', () => {
  test('JPEG: DTO exacto y estado PROPUESTO (no vigente)', () => {
    const r = proponer(cuerpo({ imageBase64: b64(imagen(3, 500)), nombreOriginal: 'C:\\fotos\\mi itf.jpg' }));
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data).sort()).toEqual(['bytes', 'documentoId', 'estado', 'mimeType', 'nombreOriginal', 'timestampUtc', 'warnings', 'wellId']);
    expect(r.data).toMatchObject({ wellId: W, estado: 'PROPUESTO', mimeType: 'image/jpeg', bytes: 500, nombreOriginal: 'mi itf.jpg', timestampUtc: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/), warnings: [] });
    expect(r.data.documentoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  test('PNG', () => {
    const r = proponer(cuerpo({ imageBase64: b64(PNG(300)), mimeType: 'image/png', nombreOriginal: 'itf.png' }));
    expect(r.status).toBe('ok');
    expect(r.data).toMatchObject({ mimeType: 'image/png', bytes: 300 });
  });
  test('el DTO NO lleva storageFileId, hash, email, clientRequestId ni secuencia (y la respuesta completa tampoco)', () => {
    const imagenOk = imagen(5, 700);
    const b = cuerpo({ imageBase64: b64(imagenOk) });
    const json = JSON.stringify(proponer(b));
    [EMAIL, 'itf-ref-', sha256(imagenOk), sha256(imagenOk).slice(0, 12), b.clientRequestId, '"secuencia"', 'storageFileId', 'storageRef', '"email"', 'sha256', 'Ana Proponente'].forEach((prohibido) => expect(json).not.toContain(prohibido));
  });
  test('el documento queda PENDIENTE: el Perfil sigue igual (el legacy no cambia) y no cuenta como vigente', () => {
    montar({ archivos: [{ id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) }] });
    expect(proponer().status).toBe('ok');
    const S = E.mods.servicio;
    expect(S.itfService_resolverVigente(W)).toMatchObject({ estado: 'SI', origen: 'LEGACY' });
    expect(S.itfService_disponibilidad([W])).toEqual({ [W]: true });
  });
  test('se guarda en el STORAGE privado con payload exacto {documentoId, mimeType, imagenBase64}; la carpeta legacy no se toca', () => {
    montar({ archivos: [{ id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) }] });
    const imagenOk = imagen(7, 650);
    const r = proponer(cuerpo({ imageBase64: b64(imagenOk) }));
    expect(llamadasStorage).toHaveLength(1);
    expect(llamadasStorage[0].accion).toBe('putItf');
    expect(Object.keys(llamadasStorage[0].payload).sort()).toEqual(['documentoId', 'imagenBase64', 'mimeType']);
    expect(llamadasStorage[0].payload.documentoId).toBe(r.data.documentoId);
    expect(llamadasStorage[0].payload.imagenBase64).toBe(b64(imagenOk));
    expect(E.drive.estado.archivos).toEqual([{ id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) }]);
    expect(E.drive.calls.getFileById).toBe(0);
  });
  test('la fila de ItfEventos lleva el hash de los bytes REALES, la referencia interna del storage y el actor de la sesion', () => {
    const imagenOk = imagen(9, 450);
    const r = proponer(cuerpo({ imageBase64: b64(imagenOk) }));
    const fila = E.mods.repo.itfEventosRepository_leerTodos().eventos[0];
    expect(fila).toMatchObject({ evento: 'ITF_PROPUESTO', documentoId: r.data.documentoId, wellId: W, sha256: sha256(imagenOk), storageFileId: 'itf-ref-000001', email: EMAIL, nombre: 'Ana Proponente', bytes: 450, mimeType: 'image/jpeg' });
  });
  test('el actor sale de la sesion + hoja Usuarios (nunca del cliente)', () => {
    global.getUserAccess.mockReturnValue({ nombre: 'Nombre Oficial' });
    proponer();
    expect(E.mods.repo.itfEventosRepository_leerTodos().eventos[0]).toMatchObject({ email: EMAIL, nombre: 'Nombre Oficial' });
  });
  test('Historial: UNA fila con accion + pozo + OK; sin base64, hash, id de storage ni nombre de archivo; sin Telegram', () => {
    const imagenOk = imagen(2, 420);
    const b = cuerpo({ imageBase64: b64(imagenOk), nombreOriginal: 'secreto-nombre.jpg' });
    proponer(b);
    const filasHistorial = global.logHistoryEvent.mock.calls.filter((c) => c[1] === 'proponerItf');
    expect(filasHistorial).toEqual([[EMAIL, 'proponerItf', W, 'OK']]);
    const todo = JSON.stringify(global.logHistoryEvent.mock.calls) + JSON.stringify(global.Logger.log.mock.calls);
    [b.imageBase64, sha256(imagenOk), 'itf-ref-', 'secreto-nombre'].forEach((p) => expect(todo).not.toContain(p));
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});

describe('idempotencia, conflicto y respuesta perdida', () => {
  test('reintento exacto: MISMA propuesta (mismo documentoId y timestamp), sin storage nuevo, sin fila nueva, sin otra fila de Historial', () => {
    const b = cuerpo();
    const a = proponer(b);
    const reint = proponer(b);
    expect(reint).toEqual(a);
    expect(llamadasStorage).toHaveLength(1);
    expect(filas()).toHaveLength(1);
    expect(global.logHistoryEvent.mock.calls.filter((c) => c[1] === 'proponerItf' && c[3] === 'OK')).toHaveLength(1);
  });
  test('respuesta perdida: la propuesta SE escribio; el navegador reintenta y recibe el evento previo (no crea otro documento ni otro storage)', () => {
    const b = cuerpo();
    const primera = proponer(b);                       // "se perdio la respuesta"
    const reintento = proponer(Object.assign({}, b));
    expect(reintento.data.documentoId).toBe(primera.data.documentoId);
    expect(reintento.data.timestampUtc).toBe(primera.data.timestampUtc);
    expect(Object.keys(almacen)).toHaveLength(1);
    expect(filas()).toHaveLength(1);
  });
  test('mismo clientRequestId con OTRO contenido: IDEMPOTENCY_CONFLICT, sin fila ni storage nuevos, y queda en Historial el codigo', () => {
    const b = cuerpo();
    proponer(b);
    const r = proponer(Object.assign({}, b, { imageBase64: b64(imagen(2)) }));
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(llamadasStorage).toHaveLength(1);
    expect(filas()).toHaveLength(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'proponerItf', W, 'IDEMPOTENCY_CONFLICT');
  });
  test('el email de la sesion se compara normalizado (otro caso): es el mismo usuario', () => {
    const b = cuerpo();
    proponer(b);
    global.verifySessionToken.mockReturnValue({ valid: true, email: '  SESION@EXAMPLE.COM ' });
    expect(proponer(b).status).toBe('ok');
    expect(filas()).toHaveLength(1);
  });
  test('otro usuario puede reutilizar el mismo clientRequestId (con otro archivo)', () => {
    const b = cuerpo();
    proponer(b);
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'otra@example.com' });
    expect(proponer(Object.assign({}, b, { imageBase64: b64(imagen(2)) })).status).toBe('ok');
    expect(filas()).toHaveLength(2);
  });
});

describe('reglas de existencia y de estado (cadena real)', () => {
  const legacy = [{ id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) }];
  test('A. sin ITF vigente: el pozo existe por el padron, un punto NE o una correccion previa', () => {
    expect(proponer().status).toBe('ok');
    montar();
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: true }));
    expect(proponer().status).toBe('ok');
    montar();
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => [{ wellId: W }]);
    expect(proponer().status).toBe('ok');
  });
  test('A. un pozo que ninguna fuente conoce: POZO_NOT_FOUND, y no se sube nada', () => {
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    expect(proponer()).toMatchObject({ status: 'error', code: 'POZO_NOT_FOUND' });
    expect(llamadasStorage).toEqual([]);
  });
  test('A. una fuente que no se puede consultar y ninguna confirma: SERVICE_UNAVAILABLE (nunca "no existe")', () => {
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => { throw new Error('hoja NE caida'); });
    expect(proponer().code).toBe('SERVICE_UNAVAILABLE');
    expect(llamadasStorage).toEqual([]);
  });
  test('B. pozo conocido SOLO por su ITF legacy unico y canonico: se puede proponer una nueva version (el legacy preexistente es evidencia suficiente)', () => {
    montar({ archivos: legacy });
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    expect(proponer().status).toBe('ok');
    expect(llamadasStorage).toHaveLength(1);
  });
  test('C. legacy ambiguo / no canonico / ilegible: NO habilita nada, ni siquiera si el padron conoce el pozo (requiere revision) y no se sube nada', () => {
    montar({ archivos: [legacy[0], { id: 'dup-14-0001-xx', name: W + '.jpg', bytes: JPEG(100) }] });
    expect(proponer()).toMatchObject({ status: 'error', code: 'LEGACY_AMBIGUO' });
    montar({ archivos: [{ id: 'may-14-0001-xx', name: W + '.JPG', bytes: JPEG(100) }] });
    E.drive.estado.caseInsensitive = true;
    expect(proponer().code).toBe('LEGACY_NOMBRE_NO_CANONICO');
    montar({ archivos: [{ id: 'pdf-14-0001-xx', name: W + '.jpg', bytes: Array.from(Buffer.from('%PDF-1.4 no es una imagen')) }] });
    expect(proponer().code).toBe('LEGACY_FORMATO_INVALIDO');
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
  });
  test('C. historial NO_DERIVABLE: ITF_STATE_UNKNOWN y no se sube nada', () => {
    const cols = E.mods.repo.ITF_EVENTOS_COLUMNAS;
    E.hoja.filas.push(cols.map((c) => ({ eventoId: '00000000-0000-4000-8000-000000000001', secuencia: 1, evento: 'ITF_BORRADO', wellId: W, documentoId: '00000000-0000-4000-8000-000000000002', email: 'x@x.com', timestampUtc: '2026-10-28T15:00:00.000Z', clientRequestId: 'corrupto-0001' }[c] || '')));
    expect(proponer().code).toBe('ITF_STATE_UNKNOWN');
    expect(llamadasStorage).toEqual([]);
  });
  test('D. con un vigente E9 se puede proponer una nueva version (aunque ninguna fuente conozca el pozo)', () => {
    const H = E.H;
    montar();
    const cols = E.mods.repo.ITF_EVENTOS_COLUMNAS;
    [H.propuesto(1), H.aprobado(1)].forEach((ev) => E.hoja.filas.push(cols.map((c) => (ev[c] === undefined ? '' : ev[c]))));
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    expect(proponer().status).toBe('ok');
  });
  test('una propuesta pendiente NO prueba que el pozo existe: con solo propuestas y sin fuentes, POZO_NOT_FOUND', () => {
    expect(proponer().status).toBe('ok');
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    expect(proponer(cuerpo({ imageBase64: b64(imagen(2)) })).code).toBe('POZO_NOT_FOUND');
  });
  test('el legacy retirado por un validador ya no es evidencia: sin otra fuente, POZO_NOT_FOUND', () => {
    const H = E.H;
    montar({ archivos: legacy });
    global.registryService_getWellLocation = jest.fn(() => ({ found: false }));
    const cols = E.mods.repo.ITF_EVENTOS_COLUMNAS;
    const sha = sha256(JPEG(300, 5));
    [H.legacy(W, { storageFileId: 'legacy-14-0001', sha256: sha, bytes: 300 }), H.retirado('LEGACY:' + W)].forEach((ev) => E.hoja.filas.push(cols.map((c) => (ev[c] === undefined ? '' : ev[c]))));
    expect(proponer().code).toBe('POZO_NOT_FOUND');
  });
  test('multiples propuestas pendientes por pozo, hasta 10; la 11 -> TOO_MANY_PENDING sin subir nada', () => {
    for (let i = 1; i <= 10; i += 1) {
      expect(proponer(cuerpo({ imageBase64: b64(imagen(i)) })).status).toBe('ok');
    }
    const antes = llamadasStorage.length;
    expect(proponer(cuerpo({ imageBase64: b64(imagen(99)) }))).toMatchObject({ status: 'error', code: 'TOO_MANY_PENDING' });
    expect(llamadasStorage).toHaveLength(antes);
    expect(filas()).toHaveLength(10);
  });
  test('duplicado en el mismo pozo: DUPLICADO_DOCUMENTO sin subir nada; mismo hash que el legacy actual tambien', () => {
    montar({ archivos: legacy });
    expect(proponer(cuerpo({ imageBase64: b64(JPEG(300, 5)) })).code).toBe('DUPLICADO_DOCUMENTO');
    expect(llamadasStorage).toEqual([]);
    expect(proponer().status).toBe('ok');
    expect(proponer().code).toBe('DUPLICADO_DOCUMENTO');
    expect(llamadasStorage).toHaveLength(1);
  });
  test('mismo hash en OTRO pozo: se permite; el aviso queda interno (no sale en el DTO) y la derivacion lo marca para la cola futura', () => {
    expect(proponer().status).toBe('ok');
    const r = proponer(cuerpo({ wellId: '14-0002' }));
    expect(r.status).toBe('ok');
    expect(r.data.warnings).toEqual([]);
    const d = E.mods.dominio.itfDominio_derivar(E.mods.repo.itfEventosRepository_leerTodos().eventos);
    const docs = Object.values(d.porPozo['14-0002'].documentos);
    expect(docs[0].marcaRevision).toEqual(['MISMO_HASH_OTRO_POZO']);
  });
});

describe('errores de infraestructura', () => {
  test('el storage falla: SERVICE_UNAVAILABLE, sin fila, y el error no filtra detalles ni el cuerpo', () => {
    global.fotosStorageClient_llamar = jest.fn(() => { throw new Error('storage HTTP 500 <html>ID-SECRETO</html>'); });
    const r = proponer();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    expect(filas()).toHaveLength(0);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'proponerItf', W, 'SERVICE_UNAVAILABLE');
  });
  test('una excepcion inesperada en el servicio: mensaje fijo, Historial con SERVICE_UNAVAILABLE, nada del base64 en el log', () => {
    const b = cuerpo();
    global.itfService_ejecutar = jest.fn(() => { throw new Error('boom ' + b.imageBase64.slice(0, 30)); });
    const r = proponer(b);
    expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'no se pudo completar la accion: intenta de nuevo en unos minutos' });
    expect(JSON.stringify(global.Logger.log.mock.calls)).not.toContain(b.imageBase64.slice(0, 30));
  });
  test('la escritura de la hoja falla ANTES de escribir: SERVICE_UNAVAILABLE y el archivo subido se retira (trashItf)', () => {
    const real = E.mods.repo.itfEventosRepository_escribirEventos;
    global.itfEventosRepository_escribirEventos = () => { throw new Error('Sheets caido'); };
    expect(proponer().code).toBe('SERVICE_UNAVAILABLE');
    global.itfEventosRepository_escribirEventos = real;
    expect(llamadasStorage.map((c) => c.accion)).toEqual(['putItf', 'trashItf']);
    expect(Object.keys(almacen)).toHaveLength(0);
    expect(filas()).toHaveLength(0);
  });
});

describe('enrutado en doPost', () => {
  const doPost = (body) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  beforeEach(() => { global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) }; });

  test('la accion proponerItf llega al handler con la sesion del token', () => {
    const r = doPost(Object.assign({ action: 'proponerItf', sessionToken: 't' }, cuerpo()));
    expect(r.status).toBe('ok');
    expect(r.data.estado).toBe('PROPUESTO');
  });
  test('un campo de mas en el pedido HTTP se rechaza (no llega nada al servicio)', () => {
    const r = doPost(Object.assign({ action: 'proponerItf', sessionToken: 't', documentoId: '00000000-0000-4000-8000-000000000001' }, cuerpo()));
    expect(r).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
    expect(llamadasStorage).toEqual([]);
  });
  test('no hay rutas para aprobar / rechazar / retirar / reemplazar / revertir ITF', () => {
    ['aprobarItf', 'rechazarItf', 'retirarItf', 'revertirItf', 'getItfPendientes', 'getItfDocumento'].forEach((accion) => {
      expect(doPost({ action: accion, sessionToken: 't' }).status).toBe('error');
    });
  });
});

describe('identidad: el actor sale SOLO de la sesion', () => {
  test('un email valido de otra persona en el cuerpo se rechaza y no se registra nada a su nombre', () => {
    const r = proponer(cuerpo({ email: 'otra.persona@example.com' }));
    expect(r.code).toBe('INVALID_REQUEST');
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
  });
});
