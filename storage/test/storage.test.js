// Tests del proyecto de STORAGE (segunda cuenta). Drive en memoria, sin
// tocar Google. Incluye pruebas CRUZADAS con el cliente del backend
// principal (backend/src/FotosStorageClient.js): lo que firma uno tiene que
// validar el otro, y viceversa.
const crypto = require('crypto');

const SECRET = 'a'.repeat(40);
const ROOT_ID = 'ROOT_FOLDER_ID_0001';
const POZOS_ROOT_ID = 'POZOS_ROOT_FOLDER_0001';

// --- Fakes de Apps Script ---
let idSeq = 0;
function nuevoId(prefijo) {
  idSeq += 1;
  return prefijo + '_' + String(idSeq).padStart(12, '0');
}

function crearDriveEnMemoria() {
  const archivos = {};
  const carpetas = {};

  function iterador(lista) {
    let i = 0;
    return { hasNext: () => i < lista.length, next: () => lista[i++] };
  }

  function crearCarpeta(nombre, padre) {
    const f = {
      _id: nuevoId('FOLDER'), _nombre: nombre, _padre: padre, _hijosCarpetas: [], _hijosArchivos: [],
      getId() { return this._id; },
      getName() { return this._nombre; },
      getParents() { return iterador(this._padre ? [this._padre] : []); },
      getFoldersByName(n) { return iterador(this._hijosCarpetas.filter((c) => c._nombre === n)); },
      createFolder(n) { const c = crearCarpeta(n, this); this._hijosCarpetas.push(c); return c; },
      getFilesByName(n) { return iterador(this._hijosArchivos.filter((a) => a._nombre === n && !a._papelera)); },
      createFile(blob) {
        const a = {
          _id: nuevoId('FILE'), _nombre: blob.nombre, _bytes: blob.bytes, _mime: blob.mime, _padre: this, _desc: '', _papelera: false, _sharing: null,
          getId() { return this._id; },
          getSize() { return this._bytes.length; },
          getParents() { return iterador([this._padre]); },
          setDescription(d) { this._desc = d; },
          getDescription() { return this._desc; },
          setSharing(acceso, permiso) { this._sharing = [acceso, permiso]; },
          getBlob() { const self = this; return { getContentType: () => self._mime, getBytes: () => self._bytes }; },
          setTrashed(v) { this._papelera = v; }
        };
        archivos[a._id] = a;
        this._hijosArchivos.push(a);
        return a;
      }
    };
    carpetas[f._id] = f;
    return f;
  }

  const raiz = crearCarpeta('FotosReemplazo', null);
  raiz._id = ROOT_ID;
  carpetas[ROOT_ID] = raiz;
  const raizPozos = crearCarpeta('FotosPozos', null);
  raizPozos._id = POZOS_ROOT_ID;
  carpetas[POZOS_ROOT_ID] = raizPozos;
  const otraCarpeta = crearCarpeta('PrivadoDeLaCuenta', null);
  const archivoAjeno = otraCarpeta.createFile({ nombre: 'secreto.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1]), mime: 'image/jpeg' });

  return {
    raiz, raizPozos, archivos, archivoAjeno,
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' },
      getFolderById: (id) => carpetas[id],
      getFileById: (id) => { if (!archivos[id]) { throw new Error('no existe'); } return archivos[id]; }
    }
  };
}

function instalarGlobals() {
  const cacheStore = {};
  global.CacheService = {
    getScriptCache: () => ({
      get: (k) => (Object.prototype.hasOwnProperty.call(cacheStore, k) ? cacheStore[k] : null),
      put: (k, v) => { cacheStore[k] = v; }
    })
  };
  global.Utilities = {
    computeHmacSha256Signature: (value, key) => crypto.createHmac('sha256', key).update(value).digest(),
    base64Decode: (str) => Array.from(Buffer.from(String(str), 'base64')).map((b) => (b > 127 ? b - 256 : b)),
    base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
    newBlob: (bytes, mime, nombre) => ({ bytes: Buffer.from(bytes), mime, nombre }),
    getUuid: () => crypto.randomUUID()
  };
  global.ContentService = {
    MimeType: { JSON: 'json', TEXT: 'text' },
    createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) })
  };
  global.getStorageSecret = () => SECRET;
  global.getStorageRootFolderId = () => ROOT_ID;
  global.getStoragePozosRootFolderId = () => POZOS_ROOT_ID;
  global.getFotosStorageSecret = () => SECRET;
  global.getFotosStorageUrl = () => 'https://script.google.com/macros/s/STORAGE/exec';
  return cacheStore;
}

let cacheStore;
let drive;
let Auth;
let Dr;
let Api;
let Client;

const JPEG_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('fotodeprueba')]).toString('base64');
const THUMB_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('mini')]).toString('base64');
const FOTO_ID = '11111111-1111-4111-8111-111111111111';
const EVAL_ID = '22222222-2222-4222-8222-222222222222';

function payloadPut(extra) {
  return Object.assign({
    fotoId: FOTO_ID, evaluacionId: EVAL_ID, wellId: '04-0263',
    nombreArchivo: '04-0263_' + EVAL_ID + '_' + FOTO_ID + '.jpg',
    mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64
  }, extra || {});
}

beforeEach(() => {
  jest.resetModules();
  idSeq = 0;
  cacheStore = instalarGlobals();
  drive = crearDriveEnMemoria();
  global.DriveApp = drive.DriveApp;
  Auth = require('../src/StorageAuth');
  Dr = require('../src/StorageDrive');
  Api = require('../src/StorageApi');
  Client = require('../../backend/src/FotosStorageClient');
  // En Apps Script todos los archivos comparten el scope global; en Jest hay que publicarlo a mano.
  Object.assign(global, Auth, Dr);
});

const cache = () => global.CacheService.getScriptCache();
const ahora = () => Math.floor(Date.now() / 1000);

describe('StorageAuth: firma, vencimiento y replay', () => {
  function solicitudValida(accion, payload, over) {
    return Object.assign(Client.fotosStorageClient_armarSolicitud(accion, payload || {}, SECRET, ahora(), crypto.randomUUID()), over || {});
  }

  test('solicitud firmada por el cliente del backend principal: valida (compatibilidad cruzada)', () => {
    const body = solicitudValida('putFoto', { a: 1 });
    const r = Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache());
    expect(r.ok).toBe(true);
    expect(r.accion).toBe('putFoto');
    expect(r.payload).toEqual({ a: 1 });
  });

  test('firma invalida (secreto distinto): BAD_SIGNATURE', () => {
    const body = Client.fotosStorageClient_armarSolicitud('putFoto', {}, 'b'.repeat(40), ahora(), crypto.randomUUID());
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache())).toEqual({ ok: false, code: 'BAD_SIGNATURE' });
  });

  test('payload alterado despues de firmar: BAD_SIGNATURE', () => {
    const body = solicitudValida('putFoto', { a: 1 });
    body.payload = JSON.stringify({ a: 2 });
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).code).toBe('BAD_SIGNATURE');
  });

  test('accion alterada (cambiar putFoto por trashFoto reusando la firma): BAD_SIGNATURE', () => {
    const body = solicitudValida('putFoto', {});
    body.action = 'trashFoto';
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).code).toBe('BAD_SIGNATURE');
  });

  test('timestamp vencido (hace 10 min) y del futuro: EXPIRED', () => {
    const viejo = Client.fotosStorageClient_armarSolicitud('putFoto', {}, SECRET, ahora() - 600, crypto.randomUUID());
    const futuro = Client.fotosStorageClient_armarSolicitud('putFoto', {}, SECRET, ahora() + 600, crypto.randomUUID());
    expect(Auth.storageAuth_verificarSolicitud(viejo, SECRET, ahora(), cache()).code).toBe('EXPIRED');
    expect(Auth.storageAuth_verificarSolicitud(futuro, SECRET, ahora(), cache()).code).toBe('EXPIRED');
  });

  test('dentro de la tolerancia (4 min de diferencia): valida', () => {
    const body = Client.fotosStorageClient_armarSolicitud('putFoto', {}, SECRET, ahora() - 240, crypto.randomUUID());
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).ok).toBe(true);
  });

  test('replay: la misma solicitud dos veces, la segunda es REPLAY', () => {
    const body = solicitudValida('getFoto', {});
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).ok).toBe(true);
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache())).toEqual({ ok: false, code: 'REPLAY' });
  });

  test('una solicitud con firma invalida NO consume el nonce', () => {
    const nonce = crypto.randomUUID();
    const mala = Client.fotosStorageClient_armarSolicitud('putFoto', {}, 'x'.repeat(40), ahora(), nonce);
    Auth.storageAuth_verificarSolicitud(mala, SECRET, ahora(), cache());
    const buena = Client.fotosStorageClient_armarSolicitud('putFoto', {}, SECRET, ahora(), nonce);
    expect(Auth.storageAuth_verificarSolicitud(buena, SECRET, ahora(), cache()).ok).toBe(true);
  });

  test.each([
    ['sin body', null],
    ['sin firma', { v: 'v1', action: 'putFoto', ts: 1, nonce: 'n'.repeat(20), payload: '{}' }],
    ['payload no string', { v: 'v1', action: 'putFoto', ts: 1, nonce: 'n'.repeat(20), payload: {}, sig: 'x' }],
    ['nonce corto', { v: 'v1', action: 'putFoto', ts: ahora(), nonce: 'abc', payload: '{}', sig: 'x' }]
  ])('estructura invalida (%s): MALFORMED', (nombre, body) => {
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).code).toBe('MALFORMED');
  });

  test('version desconocida: BAD_VERSION', () => {
    const body = solicitudValida('putFoto', {}, { v: 'v2' });
    expect(Auth.storageAuth_verificarSolicitud(body, SECRET, ahora(), cache()).code).toBe('BAD_VERSION');
  });

  test('respuesta firmada por el storage la valida el cliente del backend (cruzado), y falla con otro nonce o secreto', () => {
    const nonce = crypto.randomUUID();
    const resp = Auth.storageAuth_firmarRespuesta(SECRET, nonce, { status: 'ok', driveFileId: 'X' }, ahora());
    expect(Client.fotosStorageClient_verificarRespuesta(resp, SECRET, nonce, ahora())).toEqual({ ok: true, data: { status: 'ok', driveFileId: 'X' } });
    expect(Client.fotosStorageClient_verificarRespuesta(resp, SECRET, 'otro-nonce', ahora()).reason).toBe('NONCE_DISTINTO');
    expect(Client.fotosStorageClient_verificarRespuesta(resp, 'z'.repeat(40), nonce, ahora()).reason).toBe('FIRMA_INVALIDA');
    expect(Client.fotosStorageClient_verificarRespuesta(resp, SECRET, nonce, ahora() + 1000).reason).toBe('RESPUESTA_VENCIDA');
    expect(Client.fotosStorageClient_verificarRespuesta({ payload: '{}' }, SECRET, nonce, ahora()).reason).toBe('RESPUESTA_SIN_FIRMA');
  });
});

describe('StorageDrive', () => {
  test('putFoto: crea carpeta del anio, archivo + miniatura, privados, miniatura referenciada en la descripcion', () => {
    const r = Dr.storageDrive_putFoto(payloadPut(), 2026);
    expect(r.status).toBe('ok');
    const carpeta2026 = drive.raiz._hijosCarpetas.find((c) => c._nombre === '2026');
    expect(carpeta2026).toBeTruthy();
    expect(carpeta2026._hijosArchivos).toHaveLength(2);
    const principal = drive.archivos[r.driveFileId];
    expect(principal._nombre).toBe('04-0263_' + EVAL_ID + '_' + FOTO_ID + '.jpg');
    expect(principal._desc).toMatch(/^thumb:/);
    expect(principal._sharing).toEqual(['PRIVATE', 'NONE']);
    expect(r.tamanoBytes).toBe(principal._bytes.length);
  });

  test('anios distintos van a carpetas distintas; el mismo anio reusa la carpeta', () => {
    Dr.storageDrive_putFoto(payloadPut(), 2026);
    Dr.storageDrive_putFoto(payloadPut({ fotoId: '33333333-3333-4333-8333-333333333333', nombreArchivo: '04-0263_x_y.jpg' }), 2026);
    Dr.storageDrive_putFoto(payloadPut({ fotoId: '44444444-4444-4444-8444-444444444444', nombreArchivo: 'otra.jpg' }), 2027);
    expect(drive.raiz._hijosCarpetas.map((c) => c._nombre).sort()).toEqual(['2026', '2027']);
  });

  test('idempotente: reintentar el mismo nombre devuelve el archivo existente sin duplicar', () => {
    const a = Dr.storageDrive_putFoto(payloadPut(), 2026);
    const b = Dr.storageDrive_putFoto(payloadPut(), 2026);
    expect(b.driveFileId).toBe(a.driveFileId);
    expect(drive.raiz._hijosCarpetas[0]._hijosArchivos).toHaveLength(2);
  });

  test.each([
    ['mime no jpeg', { mimeType: 'image/png' }, 'INVALID_MIME'],
    ['no es un JPEG real', { imagenBase64: Buffer.from('esto no es una imagen').toString('base64') }, 'INVALID_IMAGEN'],
    ['demasiado grande', { imagenBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64') }, 'INVALID_IMAGEN'],
    ['base64 invalido', { imagenBase64: '***' }, 'INVALID_IMAGEN'],
    ['miniatura invalida', { thumbBase64: 'AAAA' }, 'INVALID_THUMB'],
    ['nombre con ruta', { nombreArchivo: '../../x.jpg' }, 'INVALID_NOMBRE'],
    ['fotoId no UUID', { fotoId: 'abc' }, 'INVALID_FOTO_ID'],
    ['wellId invalido', { wellId: '4-1' }, 'INVALID_WELL_ID'],
    ['evaluacionId invalido', { evaluacionId: 'x' }, 'INVALID_EVALUACION_ID']
  ])('putFoto rechaza: %s', (nombre, extra, codigo) => {
    const r = Dr.storageDrive_putFoto(payloadPut(extra), 2026);
    expect(r).toEqual({ status: 'error', code: codigo });
    expect(drive.raiz._hijosCarpetas).toHaveLength(0);
  });

  test('getFoto full y thumb devuelven el contenido correcto', () => {
    const r = Dr.storageDrive_putFoto(payloadPut(), 2026);
    const full = Dr.storageDrive_getFoto({ driveFileId: r.driveFileId, variante: 'full' });
    const thumb = Dr.storageDrive_getFoto({ driveFileId: r.driveFileId, variante: 'thumb' });
    expect(full).toMatchObject({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: JPEG_B64 });
    expect(thumb.imagenBase64).toBe(THUMB_B64);
  });

  test('getFoto de un archivo FUERA de la carpeta raiz (otro archivo de la cuenta): NOT_FOUND', () => {
    const r = Dr.storageDrive_getFoto({ driveFileId: drive.archivoAjeno._id, variante: 'full' });
    expect(r).toEqual({ status: 'error', code: 'NOT_FOUND' });
  });

  test('getFoto con id inexistente o con formato invalido: NOT_FOUND; variante invalida: INVALID_VARIANTE', () => {
    expect(Dr.storageDrive_getFoto({ driveFileId: 'NOEXISTE_00000000', variante: 'full' }).code).toBe('NOT_FOUND');
    expect(Dr.storageDrive_getFoto({ driveFileId: '../x', variante: 'full' }).code).toBe('NOT_FOUND');
    expect(Dr.storageDrive_getFoto({ driveFileId: 'x', variante: 'otra' }).code).toBe('INVALID_VARIANTE');
  });

  test('trashFoto manda a papelera foto + miniatura (nunca borra) y no toca archivos ajenos', () => {
    const r = Dr.storageDrive_putFoto(payloadPut(), 2026);
    expect(Dr.storageDrive_trashFoto({ driveFileId: r.driveFileId })).toEqual({ status: 'ok' });
    drive.raiz._hijosCarpetas[0]._hijosArchivos.forEach((a) => expect(a._papelera).toBe(true));
    expect(Dr.storageDrive_trashFoto({ driveFileId: drive.archivoAjeno._id }).code).toBe('NOT_FOUND');
    expect(drive.archivoAjeno._papelera).toBe(false);
  });
});

describe('StorageApi (extremo a extremo con el cliente del backend)', () => {
  function llamar(accion, payload, secretoFirma) {
    const sol = Client.fotosStorageClient_armarSolicitud(accion, payload, secretoFirma || SECRET, ahora(), crypto.randomUUID());
    const salida = Api.doPost({ postData: { contents: JSON.stringify(sol) } });
    return { sol, cuerpo: JSON.parse(salida.text) };
  }

  test('putFoto firmado: respuesta firmada y verificable por el backend principal', () => {
    const { sol, cuerpo } = llamar('putFoto', payloadPut());
    const v = Client.fotosStorageClient_verificarRespuesta(cuerpo, SECRET, sol.nonce, ahora());
    expect(v.ok).toBe(true);
    expect(v.data.status).toBe('ok');
    expect(typeof v.data.driveFileId).toBe('string');
  });

  test('solicitud con firma invalida: UNAUTHORIZED sin firmar y sin detalle, y no escribe nada en Drive', () => {
    const { cuerpo } = llamar('putFoto', payloadPut(), 'q'.repeat(40));
    expect(cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    expect(drive.raiz._hijosCarpetas).toHaveLength(0);
  });

  test('replay de una solicitud valida: la segunda se rechaza', () => {
    const sol = Client.fotosStorageClient_armarSolicitud('putFoto', payloadPut(), SECRET, ahora(), crypto.randomUUID());
    const enviar = () => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text);
    expect(enviar().status).toBeUndefined();
    const segunda = enviar();
    expect(segunda).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
  });

  test('accion desconocida firmada: error firmado UNKNOWN_ACTION', () => {
    const { sol, cuerpo } = llamar('borrarTodo', {});
    expect(Client.fotosStorageClient_verificarRespuesta(cuerpo, SECRET, sol.nonce, ahora()).data.code).toBe('UNKNOWN_ACTION');
  });

  test('body que no es JSON o vacio: MALFORMED, sin excepcion', () => {
    expect(JSON.parse(Api.doPost({ postData: { contents: 'basura' } }).text).code).toBe('MALFORMED');
    expect(JSON.parse(Api.doPost({}).text).code).toBe('UNAUTHORIZED');
  });

  test('doGet no revela nada', () => {
    expect(Api.doGet().text).toBe('ok');
  });

  test('flujo completo put -> get thumb -> get full -> trash', () => {
    const put = llamar('putFoto', payloadPut());
    const id = Client.fotosStorageClient_verificarRespuesta(put.cuerpo, SECRET, put.sol.nonce, ahora()).data.driveFileId;
    const g = llamar('getFoto', { driveFileId: id, variante: 'thumb' });
    expect(Client.fotosStorageClient_verificarRespuesta(g.cuerpo, SECRET, g.sol.nonce, ahora()).data.imagenBase64).toBe(THUMB_B64);
    const t = llamar('trashFoto', { driveFileId: id });
    expect(Client.fotosStorageClient_verificarRespuesta(t.cuerpo, SECRET, t.sol.nonce, ahora()).data.status).toBe('ok');
  });
});


// ===========================================================================
// Galeria general de pozos (FotosPozos): otra raiz, otras acciones
// ===========================================================================
describe('StorageDrive: galeria general de pozos (FotosPozos)', () => {
  const FOTO_POZO = '55555555-5555-4555-8555-555555555555';

  function payloadPozo(extra) {
    return Object.assign({
      fotoId: FOTO_POZO, fuente: 'CAMPO_APP', carpetaFecha: '2026',
      mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64
    }, extra || {});
  }
  const carpetaHija = (padre, nombre) => padre._hijosCarpetas.find((c) => c._nombre === nombre);

  test('putFotoPozo: FotosPozos/<fuente>/<anio>/<fotoId>.jpg + _thumb.jpg, privados, miniatura en la descripcion', () => {
    const r = Dr.storageDrive_putFotoPozo(payloadPozo());
    expect(r.status).toBe('ok');
    expect(r.existente).toBe(false);
    const anio = carpetaHija(carpetaHija(drive.raizPozos, 'CAMPO_APP'), '2026');
    expect(anio).toBeTruthy();
    expect(anio._hijosArchivos.map((a) => a._nombre).sort()).toEqual([FOTO_POZO + '.jpg', FOTO_POZO + '_thumb.jpg']);
    const principal = drive.archivos[r.driveFileId];
    expect(principal._desc).toMatch(/^thumb:/);
    expect(principal._sharing).toEqual(['PRIVATE', 'NONE']);
    expect(r.tamanoBytes).toBe(principal._bytes.length);
    // devuelve tambien el id de la miniatura (columna driveThumbId de la hoja)
    expect(drive.archivos[r.driveThumbId]._nombre).toBe(FOTO_POZO + '_thumb.jpg');
    expect(principal._desc).toBe('thumb:' + r.driveThumbId);
    // la raiz de Reemplazos no se toca
    expect(drive.raiz._hijosCarpetas).toHaveLength(0);
  });

  test('fecha desconocida: carpeta sin_fecha; fuentes distintas, carpetas distintas; la misma carpeta se reutiliza', () => {
    Dr.storageDrive_putFotoPozo(payloadPozo({ carpetaFecha: 'sin_fecha' }));
    Dr.storageDrive_putFotoPozo(payloadPozo({ fotoId: '66666666-6666-4666-8666-666666666666', fuente: 'MONITOREO_NE', carpetaFecha: '2024' }));
    Dr.storageDrive_putFotoPozo(payloadPozo({ fotoId: '77777777-7777-4777-8777-777777777777', fuente: 'MONITOREO_NE', carpetaFecha: '2024' }));
    expect(drive.raizPozos._hijosCarpetas.map((c) => c._nombre).sort()).toEqual(['CAMPO_APP', 'MONITOREO_NE']);
    expect(carpetaHija(carpetaHija(drive.raizPozos, 'CAMPO_APP'), 'sin_fecha')._hijosArchivos).toHaveLength(2);
    expect(carpetaHija(drive.raizPozos, 'MONITOREO_NE')._hijosCarpetas).toHaveLength(1);
    expect(carpetaHija(carpetaHija(drive.raizPozos, 'MONITOREO_NE'), '2024')._hijosArchivos).toHaveLength(4);
  });

  test('el nombre del archivo lo fija el storage (fotoId): no hay forma de pasar un nombre del cliente', () => {
    const r = Dr.storageDrive_putFotoPozo(payloadPozo({ nombreArchivo: '../../Perez_Juan.jpg', nombre: 'titular.jpg' }));
    expect(drive.archivos[r.driveFileId]._nombre).toBe(FOTO_POZO + '.jpg');
  });

  test('idempotente: reintentar el mismo fotoId devuelve el existente sin duplicar', () => {
    const a = Dr.storageDrive_putFotoPozo(payloadPozo());
    const b = Dr.storageDrive_putFotoPozo(payloadPozo());
    expect(b.driveFileId).toBe(a.driveFileId);
    expect(b.driveThumbId).toBe(a.driveThumbId);
    // el importador historico distingue SUBIDA de YA_EXISTE por este indicador
    expect(a.existente).toBe(false);
    expect(b.existente).toBe(true);
    expect(carpetaHija(carpetaHija(drive.raizPozos, 'CAMPO_APP'), '2026')._hijosArchivos).toHaveLength(2);
  });

  test.each([
    ['fuente en minusculas', { fuente: 'campo_app' }, 'INVALID_FUENTE'],
    ['fuente con ruta', { fuente: '../CAMPO' }, 'INVALID_FUENTE'],
    ['fuente corta', { fuente: 'AB' }, 'INVALID_FUENTE'],
    ['carpetaFecha anterior a 2000', { carpetaFecha: '1999' }, 'INVALID_CARPETA_FECHA'],
    ['carpetaFecha con ruta', { carpetaFecha: '2026/../x' }, 'INVALID_CARPETA_FECHA'],
    ['carpetaFecha libre', { carpetaFecha: 'verano' }, 'INVALID_CARPETA_FECHA'],
    ['fotoId no UUID', { fotoId: 'abc' }, 'INVALID_FOTO_ID'],
    ['mime no jpeg', { mimeType: 'image/png' }, 'INVALID_MIME'],
    ['no es JPEG real', { imagenBase64: Buffer.from('no es una imagen').toString('base64') }, 'INVALID_IMAGEN'],
    ['demasiado grande', { imagenBase64: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(3 * 1024 * 1024)]).toString('base64') }, 'INVALID_IMAGEN'],
    ['miniatura invalida', { thumbBase64: 'AAAA' }, 'INVALID_THUMB']
  ])('putFotoPozo rechaza: %s', (nombre, extra, codigo) => {
    expect(Dr.storageDrive_putFotoPozo(payloadPozo(extra))).toEqual({ status: 'error', code: codigo });
    expect(drive.raizPozos._hijosCarpetas).toHaveLength(0);
  });

  test('getFotoPozo full y thumb devuelven el contenido correcto', () => {
    const r = Dr.storageDrive_putFotoPozo(payloadPozo());
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, variante: 'full' })).toMatchObject({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: JPEG_B64 });
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, variante: 'thumb' }).imagenBase64).toBe(THUMB_B64);
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, variante: 'otra' }).code).toBe('INVALID_VARIANTE');
  });

  test('getFotoPozo thumb con driveThumbId explicito: lo sirve solo si cuelga de la raiz de pozos', () => {
    const r = Dr.storageDrive_putFotoPozo(payloadPozo());
    drive.archivos[r.driveFileId]._desc = '';    // sin descripcion (p. ej. archivo cargado a mano)
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, driveThumbId: r.driveThumbId, variante: 'thumb' }).imagenBase64).toBe(THUMB_B64);
    // un driveThumbId de OTRA raiz o ajeno se ignora: cae a la completa de su propia raiz
    const re = Dr.storageDrive_putFoto(payloadPut(), 2026);
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, driveThumbId: re.driveFileId, variante: 'thumb' }).imagenBase64).toBe(JPEG_B64);
    expect(Dr.storageDrive_getFotoPozo({ driveFileId: r.driveFileId, driveThumbId: drive.archivoAjeno._id, variante: 'thumb' }).imagenBase64).toBe(JPEG_B64);
  });

  test('trashFotoPozo manda a papelera foto + miniatura (nunca borra)', () => {
    const r = Dr.storageDrive_putFotoPozo(payloadPozo());
    expect(Dr.storageDrive_trashFotoPozo({ driveFileId: r.driveFileId })).toEqual({ status: 'ok' });
    carpetaHija(carpetaHija(drive.raizPozos, 'CAMPO_APP'), '2026')._hijosArchivos.forEach((a) => expect(a._papelera).toBe(true));
  });

  describe('aislamiento respecto de FotosReemplazo', () => {
    test('un archivo de Reemplazos NO se lee ni se descarta con las acciones de Pozos', () => {
      const re = Dr.storageDrive_putFoto(payloadPut(), 2026);
      expect(Dr.storageDrive_getFotoPozo({ driveFileId: re.driveFileId, variante: 'full' })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_trashFotoPozo({ driveFileId: re.driveFileId })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(drive.archivos[re.driveFileId]._papelera).toBe(false);
    });

    test('un archivo de Pozos NO se lee ni se descarta con las acciones de Reemplazos', () => {
      const po = Dr.storageDrive_putFotoPozo(payloadPozo());
      expect(Dr.storageDrive_getFoto({ driveFileId: po.driveFileId, variante: 'full' })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_trashFoto({ driveFileId: po.driveFileId })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(drive.archivos[po.driveFileId]._papelera).toBe(false);
    });

    test('un archivo ajeno de la cuenta tampoco se alcanza por las acciones de Pozos', () => {
      expect(Dr.storageDrive_getFotoPozo({ driveFileId: drive.archivoAjeno._id, variante: 'full' }).code).toBe('NOT_FOUND');
      expect(Dr.storageDrive_trashFotoPozo({ driveFileId: drive.archivoAjeno._id }).code).toBe('NOT_FOUND');
      expect(drive.archivoAjeno._papelera).toBe(false);
    });

    test('subir una foto de Pozos no cambia el comportamiento de Reemplazos (estructura por anio intacta)', () => {
      Dr.storageDrive_putFotoPozo(payloadPozo());
      const re = Dr.storageDrive_putFoto(payloadPut(), 2026);
      expect(drive.raiz._hijosCarpetas.map((c) => c._nombre)).toEqual(['2026']);
      expect(Dr.storageDrive_getFoto({ driveFileId: re.driveFileId, variante: 'full' }).status).toBe('ok');
    });

    test('la miniatura referenciada en la descripcion tambien se resuelve solo dentro de SU raiz', () => {
      const po = Dr.storageDrive_putFotoPozo(payloadPozo());
      const archivo = drive.archivos[po.driveFileId];
      // descripcion apuntando a un archivo de OTRA raiz (Reemplazos): no se sirve
      const re = Dr.storageDrive_putFoto(payloadPut(), 2026);
      archivo._desc = 'thumb:' + re.driveFileId;
      const r = Dr.storageDrive_getFotoPozo({ driveFileId: po.driveFileId, variante: 'thumb' });
      expect(r.imagenBase64).toBe(JPEG_B64);   // cae a la completa de SU propia raiz, nunca al archivo de la otra
    });
  });

  test('estaBajoRaiz respeta el limite de niveles (3 para pozos, 2 por defecto)', () => {
    const fuente = drive.raizPozos.createFolder('CAMPO_APP');
    const anio = fuente.createFolder('2026');
    const profunda = anio.createFolder('extra').createFolder('mas');
    const enAnio = anio.createFile({ nombre: 'a.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg' });
    const enProfunda = profunda.createFile({ nombre: 'b.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg' });
    expect(Dr.storageDrive_estaBajoRaiz(enAnio, POZOS_ROOT_ID, 3)).toBe(true);
    expect(Dr.storageDrive_estaBajoRaiz(enAnio, POZOS_ROOT_ID)).toBe(false);      // por defecto 2 niveles (Reemplazos)
    expect(Dr.storageDrive_estaBajoRaiz(enProfunda, POZOS_ROOT_ID, 3)).toBe(false);
    expect(Dr.storageDrive_estaBajoRaiz(drive.archivoAjeno, POZOS_ROOT_ID, 3)).toBe(false);
  });
});

describe('StorageApi: acciones de Pozos (extremo a extremo)', () => {
  const FOTO = '88888888-8888-4888-8888-888888888888';
  const pl = (extra) => Object.assign({ fotoId: FOTO, fuente: 'CAMPO_APP', carpetaFecha: '2026', mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64 }, extra || {});

  function llamar(accion, payload, secretoFirma) {
    const sol = Client.fotosStorageClient_armarSolicitud(accion, payload, secretoFirma || SECRET, ahora(), crypto.randomUUID());
    const salida = Api.doPost({ postData: { contents: JSON.stringify(sol) } });
    return { sol, cuerpo: JSON.parse(salida.text) };
  }
  const datos = (r) => Client.fotosStorageClient_verificarRespuesta(r.cuerpo, SECRET, r.sol.nonce, ahora()).data;

  test('flujo completo firmado: putFotoPozo -> getFotoPozo (thumb/full) -> trashFotoPozo', () => {
    const put = datos(llamar('putFotoPozo', pl()));
    expect(put.status).toBe('ok');
    expect(datos(llamar('getFotoPozo', { driveFileId: put.driveFileId, variante: 'thumb' })).imagenBase64).toBe(THUMB_B64);
    expect(datos(llamar('getFotoPozo', { driveFileId: put.driveFileId, variante: 'full' })).imagenBase64).toBe(JPEG_B64);
    expect(datos(llamar('trashFotoPozo', { driveFileId: put.driveFileId })).status).toBe('ok');
  });

  test('sin firma valida: UNAUTHORIZED sin detalle y no escribe nada', () => {
    const { cuerpo } = llamar('putFotoPozo', pl(), 'q'.repeat(40));
    expect(cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    expect(drive.raizPozos._hijosCarpetas).toHaveLength(0);
  });

  test('replay de una subida de Pozos: la segunda se rechaza', () => {
    const sol = Client.fotosStorageClient_armarSolicitud('putFotoPozo', pl(), SECRET, ahora(), crypto.randomUUID());
    const enviar = () => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text);
    expect(enviar().status).toBeUndefined();
    expect(enviar()).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
  });

  test('cambiar la accion firmada de putFoto a putFotoPozo reusando la firma: rechazado', () => {
    const sol = Client.fotosStorageClient_armarSolicitud('putFoto', pl(), SECRET, ahora(), crypto.randomUUID());
    sol.action = 'putFotoPozo';
    expect(JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text)).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
  });

  test('errores de validacion salen como respuesta firmada (sin excepciones)', () => {
    expect(datos(llamar('putFotoPozo', pl({ fuente: 'x' }))).code).toBe('INVALID_FUENTE');
  });

  test('si falta FOTOS_POZOS_ROOT_FOLDER_ID (setup sin correr): INTERNAL generico, sin detalle', () => {
    global.getStoragePozosRootFolderId = () => { throw new Error('FOTOS_POZOS_ROOT_FOLDER_ID no configurado'); };
    const { cuerpo } = llamar('putFotoPozo', pl());
    expect(cuerpo).toEqual({ status: 'error', code: 'INTERNAL' });
  });

  test('las acciones de Reemplazos siguen funcionando igual (no se rompieron)', () => {
    const put = datos(llamar('putFoto', { fotoId: FOTO_ID, evaluacionId: EVAL_ID, wellId: '04-0263', nombreArchivo: '04-0263_' + EVAL_ID + '_' + FOTO_ID + '.jpg', mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64 }));
    expect(put.status).toBe('ok');
    expect(datos(llamar('getFoto', { driveFileId: put.driveFileId, variante: 'thumb' })).imagenBase64).toBe(THUMB_B64);
  });
});
