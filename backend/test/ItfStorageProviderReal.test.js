// E9-4, proveedor REAL del storage de ITF (itfStorage_crearReal): usa el cliente HMAC de Fotos (un solo esquema de autenticacion), manda payloads exactos a acciones especificas, valida antes de llamar
// y traduce los errores a codigos estables sin filtrar texto. `llamar` inyectable: nada toca Google.
const { installAppsScriptFakes } = require('./appsScriptFakes');

let P;
let llamar;
const DOC = '33333333-3333-4333-8333-333333333333';
const jpeg = (n) => Array.from(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(n - 3, 1)])).map((v) => (v > 127 ? v - 256 : v));
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xff)).toString('base64');

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Object.assign(global, require('../src/ItfArchivoLogic'));
  P = require('../src/ItfStorageProvider');
  llamar = jest.fn();
});

describe('guardarPropuesta', () => {
  test('manda putItf con EXACTAMENTE {documentoId, mimeType, imagenBase64} y devuelve la referencia interna', () => {
    llamar.mockReturnValue({ status: 'ok', driveFileId: 'ref-interna-0001', tamanoBytes: 300 });
    const bytes = jpeg(300);
    const r = P.itfStorage_crearReal(llamar).guardarPropuesta({ documentoId: DOC, bytes: bytes, mimeType: 'image/jpeg' });
    expect(r).toEqual({ ok: true, storageRef: 'ref-interna-0001' });
    expect(llamar).toHaveBeenCalledTimes(1);
    expect(llamar.mock.calls[0][0]).toBe('putItf');
    expect(llamar.mock.calls[0][1]).toEqual({ documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: b64(bytes) });
  });
  test('ignora cualquier otro campo (nombre, wellId, hash, carpeta): no viajan al storage', () => {
    llamar.mockReturnValue({ status: 'ok', driveFileId: 'ref-interna-0001' });
    P.itfStorage_crearReal(llamar).guardarPropuesta({ documentoId: DOC, bytes: jpeg(50), mimeType: 'image/png', nombre: 'a.jpg', wellId: '14-0001', sha256: 'x', carpeta: 'Fotos', nombreSugerido: 'z' });
    expect(Object.keys(llamar.mock.calls[0][1]).sort()).toEqual(['documentoId', 'imagenBase64', 'mimeType']);
  });
  test.each([
    ['documentoId que no es UUID (un wellId)', { documentoId: '14-0001', bytes: jpeg(10), mimeType: 'image/jpeg' }],
    ['documentoId = hash', { documentoId: 'a'.repeat(64), bytes: jpeg(10), mimeType: 'image/jpeg' }],
    ['sin bytes', { documentoId: DOC, bytes: [], mimeType: 'image/jpeg' }],
    ['bytes ausentes', { documentoId: DOC, mimeType: 'image/jpeg' }],
    ['PDF', { documentoId: DOC, bytes: jpeg(10), mimeType: 'application/pdf' }],
    ['sin mime', { documentoId: DOC, bytes: jpeg(10) }],
    ['null', null]
  ])('%s: INVALID_ARCHIVO y no llama al storage', (nombre, entrada) => {
    expect(P.itfStorage_crearReal(llamar).guardarPropuesta(entrada)).toEqual({ ok: false, code: 'INVALID_ARCHIVO' });
    expect(llamar).not.toHaveBeenCalled();
  });
  test('el storage no devuelve una referencia valida: SERVICE_UNAVAILABLE', () => {
    [{ status: 'ok' }, { status: 'ok', driveFileId: '' }, { status: 'ok', driveFileId: 5 }].forEach((resp) => {
      llamar.mockReturnValue(resp);
      expect(P.itfStorage_crearReal(llamar).guardarPropuesta({ documentoId: DOC, bytes: jpeg(10), mimeType: 'image/jpeg' })).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    });
  });
});

describe('leerDocumento / obtenerMetadata / eliminarTemporal', () => {
  test('leerDocumento: getItf con {driveFileId} y devuelve bytes (decodificados) y tipo', () => {
    const bytes = jpeg(120);
    llamar.mockReturnValue({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: b64(bytes), tamanoBytes: 120 });
    const r = P.itfStorage_crearReal(llamar).leerDocumento('ref-interna-0001');
    expect(llamar).toHaveBeenCalledWith('getItf', { driveFileId: 'ref-interna-0001' });
    expect(r.ok).toBe(true);
    expect(r.mimeType).toBe('image/jpeg');
    expect(Array.from(r.bytes).map((v) => v & 0xff)).toEqual(bytes.map((v) => v & 0xff));
  });
  test('obtenerMetadata: metaItf, sin contenido', () => {
    llamar.mockReturnValue({ status: 'ok', mimeType: 'image/png', tamanoBytes: 77 });
    expect(P.itfStorage_crearReal(llamar).obtenerMetadata('ref-interna-0001')).toEqual({ ok: true, bytes: 77, mimeType: 'image/png' });
    expect(llamar).toHaveBeenCalledWith('metaItf', { driveFileId: 'ref-interna-0001' });
  });
  test('eliminarTemporal: trashItf (papelera)', () => {
    llamar.mockReturnValue({ status: 'ok' });
    expect(P.itfStorage_crearReal(llamar).eliminarTemporal('ref-interna-0001')).toEqual({ ok: true });
    expect(llamar).toHaveBeenCalledWith('trashItf', { driveFileId: 'ref-interna-0001' });
  });
  test.each(['', null, undefined, 5, {}])('una referencia invalida (%j) nunca llega al storage', (ref) => {
    const prov = P.itfStorage_crearReal(llamar);
    [prov.leerDocumento, prov.obtenerMetadata, prov.eliminarTemporal].forEach((f) => expect(f(ref)).toEqual({ ok: false, code: 'ITF_NOT_FOUND' }));
    expect(llamar).not.toHaveBeenCalled();
  });
  test('lectura sin imagenBase64 en la respuesta: SERVICE_UNAVAILABLE', () => {
    llamar.mockReturnValue({ status: 'ok' });
    expect(P.itfStorage_crearReal(llamar).leerDocumento('ref-interna-0001')).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('errores: codigos estables, sin filtrar texto', () => {
  const casos = [
    ['falta la URL', 'FOTOS_STORAGE_URL no configurado en Script Properties', 'ITF_STORAGE_NO_CONFIGURADO'],
    ['falta el secreto', 'FOTOS_STORAGE_SECRET no configurado (o demasiado corto)', 'ITF_STORAGE_NO_CONFIGURADO'],
    ['sin cliente', 'fotosStorageClient_llamar is not defined', 'ITF_STORAGE_NO_CONFIGURADO'],
    ['el storage no tiene las acciones de ITF', 'storage devolvio error: UNKNOWN_ACTION', 'ITF_STORAGE_NO_CONFIGURADO'],
    ['falta la raiz de ITF', 'storage devolvio error: INTERNAL ITF_ROOT_FOLDER_ID no configurado', 'ITF_STORAGE_NO_CONFIGURADO'],
    ['no existe', 'storage devolvio error: NOT_FOUND', 'ITF_NOT_FOUND'],
    ['imagen rechazada', 'storage devolvio error: INVALID_IMAGEN', 'INVALID_ARCHIVO'],
    ['mime rechazado', 'storage devolvio error: INVALID_MIME', 'INVALID_ARCHIVO'],
    ['payload mal formado', 'storage devolvio error: MALFORMED', 'INVALID_ARCHIVO'],
    ['conflicto de documento', 'storage devolvio error: DOCUMENTO_EXISTENTE_DISTINTO', 'INVALID_ARCHIVO'],
    ['HTTP 500', 'storage HTTP 500 <html>ID-DRIVE-SECRETO</html>', 'SERVICE_UNAVAILABLE'],
    ['respuesta sin firma', 'respuesta del storage rechazada: FIRMA_INVALIDA', 'SERVICE_UNAVAILABLE'],
    ['otro error', 'cualquier cosa rara', 'SERVICE_UNAVAILABLE']
  ];
  test.each(casos)('%s -> %s', (nombre, mensaje, esperado) => {
    llamar.mockImplementation(() => { throw new Error(mensaje); });
    const prov = P.itfStorage_crearReal(llamar);
    const resultados = [
      prov.guardarPropuesta({ documentoId: DOC, bytes: jpeg(10), mimeType: 'image/jpeg' }),
      prov.leerDocumento('ref-interna-0001'),
      prov.obtenerMetadata('ref-interna-0001'),
      prov.eliminarTemporal('ref-interna-0001')
    ];
    resultados.forEach((r) => {
      expect(r).toEqual({ ok: false, code: esperado });
      expect(JSON.stringify(r)).not.toMatch(/SECRETO|html|storage/);
    });
  });
  test('un fallo del storage nunca lanza hacia el servicio', () => {
    llamar.mockImplementation(() => { throw new Error('x'); });
    expect(() => P.itfStorage_crearReal(llamar).guardarPropuesta({ documentoId: DOC, bytes: jpeg(10), mimeType: 'image/jpeg' })).not.toThrow();
  });
});

describe('autenticacion: el MISMO cliente HMAC de Fotos (no hay un segundo esquema)', () => {
  test('por defecto usa fotosStorageClient_llamar y, si no esta, es "no configurado"', () => {
    delete global.fotosStorageClient_llamar;
    expect(P.itfStorage_crearReal().guardarPropuesta({ documentoId: DOC, bytes: jpeg(10), mimeType: 'image/jpeg' })).toEqual({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
    global.fotosStorageClient_llamar = jest.fn(() => ({ status: 'ok', driveFileId: 'ref-interna-0001' }));
    expect(P.itfStorage_crearReal().guardarPropuesta({ documentoId: DOC, bytes: jpeg(10), mimeType: 'image/jpeg' })).toEqual({ ok: true, storageRef: 'ref-interna-0001' });
    expect(global.fotosStorageClient_llamar.mock.calls[0][0]).toBe('putItf');
  });
  test('el proveedor no firma nada por su cuenta, no lee secretos, no usa UrlFetchApp ni Drive', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ItfStorageProvider.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/computeHmac|getFotosStorageSecret|getFotosStorageUrl|UrlFetchApp|DriveApp|SpreadsheetApp|PropertiesService/);
    expect(fuente).toMatch(/fotosStorageClient_llamar/);
  });
  test('es un proveedor completo del contrato', () => {
    expect(P.itfStorage_esProveedor(P.itfStorage_crearReal(llamar))).toBe(true);
    expect(P.itfStorage_esProveedor(P.itfStorage_noConfigurado())).toBe(true);
  });
});
