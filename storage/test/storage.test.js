// Tests del proyecto de STORAGE (segunda cuenta). Drive en memoria, sin
// tocar Google. Incluye pruebas CRUZADAS con el cliente del backend
// principal (backend/src/FotosStorageClient.js): lo que firma uno tiene que
// validar el otro, y viceversa.
const crypto = require('crypto');

const SECRET = 'a'.repeat(40);
const ROOT_ID = 'ROOT_FOLDER_ID_0001';
const POZOS_ROOT_ID = 'POZOS_ROOT_FOLDER_0001';
const ITF_ROOT_ID = 'ITF_ROOT_FOLDER_00001';

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
  const raizItf = crearCarpeta('ItfPropuestas', null);
  raizItf._id = ITF_ROOT_ID;
  carpetas[ITF_ROOT_ID] = raizItf;
  const otraCarpeta = crearCarpeta('PrivadoDeLaCuenta', null);
  const archivoAjeno = otraCarpeta.createFile({ nombre: 'secreto.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1]), mime: 'image/jpeg' });

  return {
    raiz, raizPozos, raizItf, archivos, archivoAjeno,
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
  global.getStorageItfRootFolderId = () => ITF_ROOT_ID;
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
  // LockService en memoria (cuenta cuantas veces se tomo y se libero)
  global.__lock = { esperas: 0, liberaciones: 0 };
  global.LockService = { getScriptLock: () => ({ waitLock: () => { global.__lock.esperas += 1; }, releaseLock: () => { global.__lock.liberaciones += 1; } }) };
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

// ===========================================================================
// Importacion historica: cronometro por paso, lote de varias fotos y carpetas con lock
// ===========================================================================
describe('StorageDrive: cronometro, lote de fotos y carpetas bajo lock', () => {
  const ids = ['a1111111-1111-4111-8111-111111111111', 'b2222222-2222-4222-8222-222222222222', 'c3333333-3333-4333-8333-333333333333', 'd4444444-4444-4444-8444-444444444444'];
  const item = (i, extra) => Object.assign({ fotoId: ids[i], fuente: 'MONITOREO_NE', carpetaFecha: '2025', mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64 }, extra || {});
  const carpeta = (padre, nombre) => padre._hijosCarpetas.find((c) => c._nombre === nombre);

  describe('tiempos por paso dentro del storage', () => {
    test('una foto nueva informa cuanto tardo cada paso (solo numeros)', () => {
      const r = Dr.storageDrive_putFotoPozo(item(0));
      expect(r.existente).toBe(false);
      expect(Object.keys(r.tiempos).sort()).toEqual(['carpetas', 'compartir', 'descripcion', 'existe', 'imagen', 'miniatura', 'total']);
      Object.values(r.tiempos).forEach((v) => { expect(Number.isInteger(v)).toBe(true); expect(v).toBeGreaterThanOrEqual(0); });
    });

    test('una foto que ya existia informa solo los pasos que hizo', () => {
      Dr.storageDrive_putFotoPozo(item(0));
      const r = Dr.storageDrive_putFotoPozo(item(0));
      expect(r.existente).toBe(true);
      expect(Object.keys(r.tiempos).sort()).toEqual(['carpetas', 'existe', 'total']);
    });

    test('el cronometro mide la diferencia entre marcas', () => {
      const t = jest.spyOn(Date, 'now');
      t.mockReturnValueOnce(1000).mockReturnValueOnce(1250).mockReturnValueOnce(1300).mockReturnValueOnce(2000);
      const c = Dr.storageDrive_cronometro();
      c.marca('a');
      c.marca('b');
      expect(c.fin()).toEqual({ a: 250, b: 50, total: 1000 });
      t.mockRestore();
    });
  });

  describe('recuperacion de una subida cortada a medias (se completa sin duplicar)', () => {
    const carpetaDe = () => carpeta(carpeta(drive.raizPozos, 'MONITOREO_NE'), '2025');

    test('se corto entre el original y la miniatura: el reintento crea SOLO la miniatura y devuelve ids validos', () => {
      const carpetaPrevia = Dr.storageDrive_putFotoPozo(item(1));                // crea la jerarquia de carpetas
      const c = carpetaDe();
      const original = c.createFile;
      c.createFile = (blob) => { if (blob.nombre === ids[0] + '_thumb.jpg') { throw new Error('corte'); } return original.call(c, blob); };
      expect(() => Dr.storageDrive_putFotoPozo(item(0))).toThrow('corte');
      c.createFile = original;
      expect(carpetaPrevia.status).toBe('ok');
      const r = Dr.storageDrive_putFotoPozo(item(0));
      expect(r.status).toBe('ok');
      expect(r.existente).toBe(true);
      expect(r.driveThumbId).toMatch(/^[A-Za-z0-9_-]{10,100}$/);
      expect(c._hijosArchivos.filter((a) => a._nombre.startsWith(ids[0])).map((a) => a._nombre).sort()).toEqual([ids[0] + '.jpg', ids[0] + '_thumb.jpg']);
      expect(Dr.storageDrive_putFotoPozo(item(0)).driveThumbId).toBe(r.driveThumbId);   // y ya queda estable
    });

    test('se corto despues de crear la miniatura y antes de registrarla: se reutiliza la miniatura existente', () => {
      Dr.storageDrive_putFotoPozo(item(1));
      const c = carpetaDe();
      const original = c.createFile;
      c.createFile = (blob) => {
        const a = original.call(c, blob);
        if (blob.nombre === ids[0] + '.jpg') {
          const real = a.setDescription;
          a.setDescription = function (d) { a.setDescription = real; throw new Error('corte'); };      // falla UNA vez
        }
        return a;
      };
      expect(() => Dr.storageDrive_putFotoPozo(item(0))).toThrow('corte');
      c.createFile = original;
      const hijos = c._hijosArchivos.filter((a) => a._nombre.startsWith(ids[0]));
      expect(hijos).toHaveLength(2);
      const thumbExistente = hijos.find((a) => a._nombre.endsWith('_thumb.jpg'));
      const r = Dr.storageDrive_putFotoPozo(item(0));
      expect(r.driveThumbId).toBe(thumbExistente._id);
      expect(c._hijosArchivos.filter((a) => a._nombre.startsWith(ids[0]))).toHaveLength(2);   // no se duplico
    });
  });

  describe('autocurado dentro de un lote', () => {
    test('un lote que incluye una foto cortada a medias la completa, y las demas siguen normales, sin duplicar', () => {
      Dr.storageDrive_putFotoPozo(item(1));
      const c = carpeta(carpeta(drive.raizPozos, 'MONITOREO_NE'), '2025');
      const original = c.createFile;
      c.createFile = (blob) => { if (blob.nombre === ids[0] + '_thumb.jpg') { throw new Error('corte'); } return original.call(c, blob); };
      expect(() => Dr.storageDrive_putFotoPozo(item(0))).toThrow('corte');
      c.createFile = original;
      const r = Dr.storageDrive_putFotosPozoLote({ fotos: [item(0), item(1), item(2)] });
      expect(r.resultados.map((x) => [x.status, x.existente])).toEqual([['ok', true], ['ok', true], ['ok', false]]);
      expect(r.resultados.every((x) => /^[A-Za-z0-9_-]{10,100}$/.test(x.driveThumbId))).toBe(true);
      expect(c._hijosArchivos.map((a) => a._nombre).sort()).toEqual(
        [ids[0] + '.jpg', ids[0] + '_thumb.jpg', ids[1] + '.jpg', ids[1] + '_thumb.jpg', ids[2] + '.jpg', ids[2] + '_thumb.jpg']);
    });
  });

  describe('putFotosPozoLote', () => {
    test('guarda cada foto con su carpeta, ids distintos y el fotoId de cada una', () => {
      const r = Dr.storageDrive_putFotosPozoLote({ fotos: [item(0), item(1), item(2, { fuente: 'RELEVAMIENTO_2018', carpetaFecha: '2018' })] });
      expect(r.status).toBe('ok');
      expect(r.resultados.map((x) => x.fotoId)).toEqual(ids.slice(0, 3));
      expect(r.resultados.every((x) => x.status === 'ok' && x.existente === false)).toBe(true);
      expect(new Set(r.resultados.map((x) => x.driveFileId)).size).toBe(3);
      expect(carpeta(carpeta(drive.raizPozos, 'MONITOREO_NE'), '2025')._hijosArchivos.map((a) => a._nombre).sort()).toEqual([ids[0] + '.jpg', ids[0] + '_thumb.jpg', ids[1] + '.jpg', ids[1] + '_thumb.jpg']);
      expect(carpeta(carpeta(drive.raizPozos, 'RELEVAMIENTO_2018'), '2018')._hijosArchivos).toHaveLength(2);
      expect(typeof r.tiempos.total).toBe('number');
    });

    test('reenviar el mismo lote es seguro: todo vuelve como existente y no se duplica nada', () => {
      const lote = { fotos: [item(0), item(1)] };
      const a = Dr.storageDrive_putFotosPozoLote(lote);
      const cuenta = Object.keys(drive.archivos).length;
      const b = Dr.storageDrive_putFotosPozoLote(lote);
      expect(b.resultados.every((x) => x.status === 'ok' && x.existente === true)).toBe(true);
      expect(b.resultados.map((x) => x.driveFileId)).toEqual(a.resultados.map((x) => x.driveFileId));
      expect(Object.keys(drive.archivos)).toHaveLength(cuenta);
    });

    test('una foto invalida o que falla no frena a las demas (resultados independientes)', () => {
      const original = drive.raizPozos.createFolder.bind(drive.raizPozos);
      drive.raizPozos.createFolder = (n) => { if (n === 'BOOM') { throw new Error('Drive fallo'); } return original(n); };
      const r = Dr.storageDrive_putFotosPozoLote({ fotos: [item(0), item(1, { mimeType: 'image/png' }), item(2, { fuente: 'BOOM' }), item(3)] });
      expect(r.status).toBe('ok');
      expect(r.resultados.map((x) => [x.status, x.code || (x.existente === false ? 'nueva' : 'x')])).toEqual([['ok', 'nueva'], ['error', 'INVALID_MIME'], ['error', 'INTERNAL'], ['ok', 'nueva']]);
      expect(JSON.stringify(r)).not.toContain('Drive fallo');                     // nunca el detalle de la excepcion
    });

    test.each([
      ['sin fotos', { fotos: [] }],
      ['no es una lista', { fotos: 'x' }],
      ['sin payload', null],
      ['mas de 10 fotos', { fotos: Array.from({ length: 11 }, (_, i) => item(0, { fotoId: '0000000' + i + '-1111-4111-8111-111111111111' })) }],
      ['un item que no es un objeto', { fotos: [item(0), 5] }],
      ['un item sin base64', { fotos: [item(0), { fotoId: ids[1] }] }]
    ])('lote invalido (%s): INVALID_LOTE y no se guarda nada', (n, payload) => {
      const antes = Object.keys(drive.archivos).length;
      expect(Dr.storageDrive_putFotosPozoLote(payload)).toEqual({ status: 'error', code: 'INVALID_LOTE' });
      expect(Object.keys(drive.archivos)).toHaveLength(antes);
    });

    test('un lote que supera el tope de caracteres se rechaza antes de procesar nada', () => {
      const grande = 'A'.repeat(5 * 1024 * 1024);
      const antes = Object.keys(drive.archivos).length;
      expect(Dr.storageDrive_putFotosPozoLote({ fotos: [item(0, { imagenBase64: grande }), item(1, { imagenBase64: grande })] })).toEqual({ status: 'error', code: 'INVALID_LOTE' });
      expect(Object.keys(drive.archivos)).toHaveLength(antes);
    });

    test('si se agota el tiempo, lo no procesado vuelve como TIEMPO_AGOTADO para reintentar (lo ya guardado se conserva)', () => {
      let reloj = 0;
      const t = jest.spyOn(Date, 'now').mockImplementation(() => { reloj += 100000; return reloj; });
      const r = Dr.storageDrive_putFotosPozoLote({ fotos: [item(0), item(1), item(2)] });
      t.mockRestore();
      expect(r.resultados.map((x) => x.code || x.status)).toEqual(['ok', 'TIEMPO_AGOTADO', 'TIEMPO_AGOTADO']);
      const reintento = Dr.storageDrive_putFotosPozoLote({ fotos: [item(0), item(1), item(2)] });
      expect(reintento.resultados.map((x) => x.existente)).toEqual([true, false, false]);
    });

    test('el tope es de 10 fotos por solicitud', () => {
      expect(Dr.STORAGE_LOTE_MAX_FOTOS).toBe(10);
    });
  });

  describe('carpetas: doble verificacion bajo lock', () => {
    function padreFalso(existentesLuegoDelLock) {
      const llamadas = { buscar: 0, crear: 0 };
      const hecha = { getId: () => 'CARPETA_CREADA_POR_OTRA_SOLICITUD' };
      return {
        llamadas,
        getFoldersByName: () => {
          llamadas.buscar += 1;
          const hay = llamadas.buscar > 1 && existentesLuegoDelLock;           // otra solicitud la creo mientras esperabamos el lock
          let leida = false;
          return { hasNext: () => hay && !leida, next: () => { leida = true; return hecha; } };
        },
        createFolder: () => { llamadas.crear += 1; return { getId: () => 'CARPETA_NUEVA' }; },
        hecha
      };
    }

    test('si otra solicitud ya la creo mientras se esperaba el lock, se usa esa y NO se crea otra', () => {
      const p = padreFalso(true);
      expect(Dr.storageDrive_carpetaHija(p, '2025')).toBe(p.hecha);
      expect(p.llamadas).toEqual({ buscar: 2, crear: 0 });
      expect(global.__lock).toEqual({ esperas: 1, liberaciones: 1 });
    });

    test('si de verdad no existe, la crea una sola vez bajo lock', () => {
      const p = padreFalso(false);
      Dr.storageDrive_carpetaHija(p, '2025');
      expect(p.llamadas).toEqual({ buscar: 2, crear: 1 });
      expect(global.__lock).toEqual({ esperas: 1, liberaciones: 1 });
    });

    test('el camino normal (la carpeta ya existe) no toma el lock', () => {
      Dr.storageDrive_putFotoPozo(item(0));
      global.__lock.esperas = 0;
      global.__lock.liberaciones = 0;
      Dr.storageDrive_putFotoPozo(item(1));                                  // misma carpeta
      expect(global.__lock).toEqual({ esperas: 0, liberaciones: 0 });
    });

    test('el lock se libera aunque la creacion falle', () => {
      const p = padreFalso(false);
      p.createFolder = () => { throw new Error('Drive'); };
      expect(() => Dr.storageDrive_carpetaHija(p, '2025')).toThrow('Drive');
      expect(global.__lock).toEqual({ esperas: 1, liberaciones: 1 });
    });
  });

  describe('por la API firmada', () => {
    const SECRETO = SECRET;
    const llamarApi = (accion, payload, firma) => {
      const sol = Client.fotosStorageClient_armarSolicitud(accion, payload, firma || SECRETO, ahora(), require('crypto').randomUUID());
      return { sol, cuerpo: JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text) };
    };
    const datosApi = (r) => Client.fotosStorageClient_verificarRespuesta(r.cuerpo, SECRETO, r.sol.nonce, ahora()).data;

    test('putFotosPozoLote firmado: respuesta firmada con un resultado por foto', () => {
      const r = llamarApi('putFotosPozoLote', { fotos: [item(0), item(1)] });
      const d = datosApi(r);
      expect(d.status).toBe('ok');
      expect(d.resultados).toHaveLength(2);
      expect(d.resultados.every((x) => x.status === 'ok')).toBe(true);
    });

    test('sin firma valida: UNAUTHORIZED y no se guarda nada', () => {
      const antes = Object.keys(drive.archivos).length;
      const r = llamarApi('putFotosPozoLote', { fotos: [item(0)] }, 'otro-secreto-distinto-0123456789abcdef');
      expect(r.cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
      expect(Object.keys(drive.archivos)).toHaveLength(antes);
    });

    test('el lote de pozos nunca toca la raiz de Reemplazos', () => {
      llamarApi('putFotosPozoLote', { fotos: [item(0), item(1)] });
      expect(drive.raiz._hijosCarpetas).toHaveLength(0);
    });
  });
});


// ===========================================================================
// ITF colaborativos (E9-4): TERCERA raiz (ItfPropuestas), acciones especificas, JPEG y PNG
// ===========================================================================
describe('StorageDrive: ITF colaborativos (E9-4)', () => {
  const DOC = '33333333-3333-4333-8333-333333333333';
  const DOC2 = '44444444-4444-4444-8444-444444444444';
  const jpegB64 = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(Math.max(n - 4, 0), 7)]).toString('base64');
  const pngB64 = (n) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(Math.max(n - 16, 0), 9)]).toString('base64');
  const putItf = (extra) => Object.assign({ documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: jpegB64(500) }, extra || {});
  const MB3 = 3 * 1024 * 1024;

  describe('validacion', () => {
    test('JPEG y PNG validos', () => {
      expect(Dr.storageDrive_validarPutItf(putItf())).toBeNull();
      expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: 'image/png', imagenBase64: pngB64(500) }))).toBeNull();
    });
    test.each([['application/pdf'], ['image/gif'], ['image/webp'], ['image/jpg'], ['IMAGE/JPEG'], ['image/jpeg; charset=x'], [''], [null], [5]])('MIME %j no se acepta', (mime) => {
      expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: mime }))).toBe('INVALID_MIME');
    });
    test('contenido renombrado: un PNG declarado JPEG, un JPEG declarado PNG, un PDF / GIF / WEBP / texto declarados imagen', () => {
      expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: pngB64(100) }))).toBe('INVALID_IMAGEN');
      expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: 'image/png', imagenBase64: jpegB64(100) }))).toBe('INVALID_IMAGEN');
      ['%PDF-1.7 xxxxxxxxxxxxxx', 'GIF89a xxxxxxxxxxxxxxxx', 'RIFFxxxxWEBPVP8 xxxxxxxx', 'hola mundo, esto no es una imagen'].forEach((t) => {
        const b64 = Buffer.from(t).toString('base64');
        expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: b64 }))).toBe('INVALID_IMAGEN');
        expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: 'image/png', imagenBase64: b64 }))).toBe('INVALID_IMAGEN');
      });
    });
    test('PNG con la firma pero sin chunk IHDR, y JPEG de menos de 3 bytes: INVALID_IMAGEN', () => {
      const sinIhdr = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]).toString('base64');
      expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: 'image/png', imagenBase64: sinIhdr }))).toBe('INVALID_IMAGEN');
      expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: Buffer.from([0xff, 0xd8]).toString('base64') }))).toBe('INVALID_IMAGEN');
    });
    test('vacio, no base64, base64 con largo invalido o con espacios', () => {
      ['', 'no es base64!!', 'AAA', ' ' + jpegB64(100), jpegB64(100) + '\n', null, 5].forEach((b) => {
        expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: b }))).toBe('INVALID_IMAGEN');
      });
    });
    test('tamano: justo 3 MB entra; un byte mas no', () => {
      expect(Dr.STORAGE_ITF_MAX_BYTES).toBe(MB3);
      expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: jpegB64(MB3) }))).toBeNull();
      expect(Dr.storageDrive_validarPutItf(putItf({ imagenBase64: jpegB64(MB3 + 1) }))).toBe('INVALID_IMAGEN');
      expect(Dr.storageDrive_validarPutItf(putItf({ mimeType: 'image/png', imagenBase64: pngB64(MB3 + 1) }))).toBe('INVALID_IMAGEN');
    });
    test('documentoId: UUID obligatorio (no un wellId, un hash, un id de Drive ni un nombre)', () => {
      ['14-0001', 'a'.repeat(64), '1AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'itf.jpg', '', null, 5, DOC + 'x'].forEach((d) => {
        expect(Dr.storageDrive_validarPutItf(putItf({ documentoId: d }))).toBe('INVALID_DOCUMENTO_ID');
      });
    });
    test('el cliente no manda carpetas ni nombres: cualquier clave de mas es MALFORMED', () => {
      ['carpeta', 'folderId', 'nombre', 'nombreArchivo', 'wellId', 'driveFileId', 'ruta', 'parent', 'sha256', 'anio', 'fuente'].forEach((k) => {
        expect(Dr.storageDrive_validarPutItf(putItf({ [k]: 'x' }))).toBe('MALFORMED');
      });
      [null, undefined, 'texto', [], 5].forEach((p) => expect(Dr.storageDrive_validarPutItf(p)).toBe('MALFORMED'));
    });
    test('la politica de Fotos NO cambia: Reemplazos y Pozos siguen aceptando SOLO JPEG', () => {
      const png = pngB64(100);
      expect(Dr.storageDrive_validarPut(payloadPut({ mimeType: 'image/png', imagenBase64: png }))).toBe('INVALID_MIME');
      expect(Dr.storageDrive_validarPut(payloadPut({ imagenBase64: png }))).toBe('INVALID_IMAGEN');
      const pozo = { fotoId: FOTO_ID, fuente: 'CAMPO_APP', carpetaFecha: '2026', mimeType: 'image/png', imagenBase64: png, thumbBase64: THUMB_B64 };
      expect(Dr.storageDrive_validarPutPozo(pozo)).toBe('INVALID_MIME');
      expect(Dr.storageDrive_validarPutPozo(Object.assign({}, pozo, { mimeType: 'image/jpeg' }))).toBe('INVALID_IMAGEN');
      expect(Dr.storageDrive_validarPut(payloadPut())).toBeNull();
      expect(Dr.STORAGE_LOTE_MAX_FOTOS).toBe(10);
    });
  });

  describe('putItf / getItf / metaItf / trashItf', () => {
    test('guarda bajo la raiz de ITF / <anio> con nombre = documentoId + extension (jamas el nombre original), privado', () => {
      const r = Dr.storageDrive_putItf(putItf(), 2026);
      expect(r).toMatchObject({ status: 'ok', existente: false });
      const archivo = drive.archivos[r.driveFileId];
      expect(archivo._nombre).toBe(DOC + '.jpg');
      expect(archivo._padre._nombre).toBe('2026');
      expect(archivo._padre._padre._id).toBe(ITF_ROOT_ID);
      expect(archivo._sharing).toEqual(['PRIVATE', 'NONE']);
      expect(archivo._mime).toBe('image/jpeg');
      expect(Object.keys(r).sort()).toEqual(['driveFileId', 'existente', 'status', 'tamanoBytes']);
    });
    test('PNG: extension .png y MIME png', () => {
      const r = Dr.storageDrive_putItf(putItf({ documentoId: DOC2, mimeType: 'image/png', imagenBase64: pngB64(300) }), 2026);
      expect(drive.archivos[r.driveFileId]._nombre).toBe(DOC2 + '.png');
      expect(drive.archivos[r.driveFileId]._mime).toBe('image/png');
    });
    test('un documentoId en mayuscula produce el nombre en minuscula', () => {
      const r = Dr.storageDrive_putItf(putItf({ documentoId: DOC.toUpperCase() }), 2026);
      expect(drive.archivos[r.driveFileId]._nombre).toBe(DOC + '.jpg');
    });
    test('NO escribe en las raices de Fotos ni de Reemplazos', () => {
      Dr.storageDrive_putItf(putItf(), 2026);
      expect(drive.raiz._hijosCarpetas).toHaveLength(0);
      expect(drive.raizPozos._hijosCarpetas).toHaveLength(0);
      expect(drive.raizItf._hijosCarpetas).toHaveLength(1);
    });
    test('un documento invalido no toca Drive', () => {
      expect(Dr.storageDrive_putItf(putItf({ mimeType: 'application/pdf' }), 2026)).toEqual({ status: 'error', code: 'INVALID_MIME' });
      expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
    });
    test('IDEMPOTENTE: el mismo documentoId con el mismo contenido devuelve el existente (una sola copia)', () => {
      const a = Dr.storageDrive_putItf(putItf(), 2026);
      const b = Dr.storageDrive_putItf(putItf(), 2026);
      expect(b).toMatchObject({ status: 'ok', driveFileId: a.driveFileId, existente: true });
      expect(drive.raizItf._hijosCarpetas[0]._hijosArchivos).toHaveLength(1);
    });
    test('el mismo documentoId con OTRO contenido (otro tamano) es un conflicto: no se pisa ni se duplica', () => {
      Dr.storageDrive_putItf(putItf(), 2026);
      expect(Dr.storageDrive_putItf(putItf({ imagenBase64: jpegB64(900) }), 2026)).toEqual({ status: 'error', code: 'DOCUMENTO_EXISTENTE_DISTINTO' });
      expect(drive.raizItf._hijosCarpetas[0]._hijosArchivos).toHaveLength(1);
    });
    test('getItf devuelve el contenido y el tipo; metaItf solo el tipo y el tamano', () => {
      const bytes = jpegB64(321);
      const { driveFileId } = Dr.storageDrive_putItf(putItf({ imagenBase64: bytes }), 2026);
      expect(Dr.storageDrive_getItf({ driveFileId })).toEqual({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: bytes, tamanoBytes: 321 });
      expect(Dr.storageDrive_metaItf({ driveFileId })).toEqual({ status: 'ok', mimeType: 'image/jpeg', tamanoBytes: 321 });
    });
    test('trashItf manda a la papelera (nunca borrado definitivo)', () => {
      const { driveFileId } = Dr.storageDrive_putItf(putItf(), 2026);
      expect(Dr.storageDrive_trashItf({ driveFileId })).toEqual({ status: 'ok' });
      expect(drive.archivos[driveFileId]._papelera).toBe(true);
    });
    test('AISLAMIENTO: get / meta / trash de ITF no alcanzan archivos de Fotos, de Reemplazos ni de la cuenta', () => {
      const foto = Dr.storageDrive_putFoto(payloadPut(), 2026).driveFileId;
      const pozo = Dr.storageDrive_putFotoPozo({ fotoId: FOTO_ID, fuente: 'CAMPO_APP', carpetaFecha: '2026', mimeType: 'image/jpeg', imagenBase64: JPEG_B64, thumbBase64: THUMB_B64 }).driveFileId;
      [foto, pozo, drive.archivoAjeno._id].forEach((id) => {
        expect(Dr.storageDrive_getItf({ driveFileId: id })).toEqual({ status: 'error', code: 'NOT_FOUND' });
        expect(Dr.storageDrive_metaItf({ driveFileId: id })).toEqual({ status: 'error', code: 'NOT_FOUND' });
        expect(Dr.storageDrive_trashItf({ driveFileId: id })).toEqual({ status: 'error', code: 'NOT_FOUND' });
        expect(drive.archivos[id]._papelera).toBe(false);
      });
    });
    test('AISLAMIENTO inverso: Fotos y Reemplazos no alcanzan un archivo de ITF', () => {
      const { driveFileId } = Dr.storageDrive_putItf(putItf(), 2026);
      expect(Dr.storageDrive_getFoto({ driveFileId, variante: 'full' })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_getFotoPozo({ driveFileId, variante: 'full' })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_trashFoto({ driveFileId })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_trashFotoPozo({ driveFileId })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(drive.archivos[driveFileId]._papelera).toBe(false);
    });
    test('get / meta / trash: ids invalidos o con claves de mas -> NOT_FOUND, sin excepcion', () => {
      ['', 'corto', null, 5, '../../etc', 'a b c d e f g h i j'].forEach((id) => expect(Dr.storageDrive_getItf({ driveFileId: id })).toEqual({ status: 'error', code: 'NOT_FOUND' }));
      const { driveFileId } = Dr.storageDrive_putItf(putItf(), 2026);
      expect(Dr.storageDrive_getItf({ driveFileId, carpeta: 'x' })).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_getItf(null)).toEqual({ status: 'error', code: 'NOT_FOUND' });
      expect(Dr.storageDrive_trashItf([])).toEqual({ status: 'error', code: 'NOT_FOUND' });
    });
  });

  describe('StorageApi: acciones de ITF (extremo a extremo con el cliente del backend)', () => {
    function llamar(accion, payload, secretoFirma) {
      const sol = Client.fotosStorageClient_armarSolicitud(accion, payload, secretoFirma || SECRET, ahora(), crypto.randomUUID());
      const salida = Api.doPost({ postData: { contents: JSON.stringify(sol) } });
      return { sol, cuerpo: JSON.parse(salida.text) };
    }
    const datos = (r) => Client.fotosStorageClient_verificarRespuesta(r.cuerpo, SECRET, r.sol.nonce, ahora()).data;

    test('putItf -> metaItf -> getItf -> trashItf firmados', () => {
      const put = datos(llamar('putItf', putItf()));
      expect(put.status).toBe('ok');
      expect(datos(llamar('metaItf', { driveFileId: put.driveFileId }))).toMatchObject({ status: 'ok', mimeType: 'image/jpeg' });
      expect(datos(llamar('getItf', { driveFileId: put.driveFileId })).imagenBase64).toBe(putItf().imagenBase64);
      expect(datos(llamar('trashItf', { driveFileId: put.driveFileId })).status).toBe('ok');
    });
    test('sin firma valida: UNAUTHORIZED y no escribe nada en la raiz de ITF', () => {
      const r = llamar('putItf', putItf(), 'q'.repeat(40));
      expect(r.cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
      expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
    });
    test('NO hay una accion generica: cualquier otra accion firmada es UNKNOWN_ACTION y no toca Drive', () => {
      ['putArchivo', 'getArchivo', 'crearCarpeta', 'listarItf', 'borrarItf', 'putItfLote', 'moverItf', 'getFileById'].forEach((accion) => {
        expect(datos(llamar(accion, putItf())).code).toBe('UNKNOWN_ACTION');
      });
      expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
    });
    test('payload con carpeta u otras claves: MALFORMED firmado', () => {
      expect(datos(llamar('putItf', putItf({ carpeta: 'ItfPropuestas' }))).code).toBe('MALFORMED');
    });
    test('la acciones de ITF usan el anio del servidor (no uno que mande el cliente)', () => {
      const put = datos(llamar('putItf', putItf()));
      expect(drive.archivos[put.driveFileId]._padre._nombre).toBe(String(new Date().getFullYear()));
    });
  });

  describe('configuracion', () => {
    test('el setup crea la raiz una sola vez y es idempotente (no se ejecuta solo)', () => {
      const props = {};
      global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) };
      global.Session = { getEffectiveUser: () => ({ getEmail: () => 'storage@x.com' }) };
      global.Logger = { log: jest.fn() };
      const creadas = [];
      const raizDrive = { getFoldersByName: () => ({ hasNext: () => false }), createFolder: (n) => { creadas.push(n); return { getId: () => 'ITF_NUEVA_RAIZ_0001', getName: () => n }; } };
      global.DriveApp = Object.assign({}, global.DriveApp, { getRootFolder: () => raizDrive });
      const Config = require('../src/StorageConfig');
      expect(() => Config.getStorageItfRootFolderId()).toThrow(/setupItfPropuestasStorage/);
      Config.setupItfPropuestasStorage();
      Config.setupItfPropuestasStorage();
      expect(creadas).toEqual(['ItfPropuestas']);
      expect(props.ITF_ROOT_FOLDER_ID).toBe('ITF_NUEVA_RAIZ_0001');
      expect(Config.getStorageItfRootFolderId()).toBe('ITF_NUEVA_RAIZ_0001');
      expect(Config.STORAGE_ITF_ROOT_FOLDER_NAME).toBe('ItfPropuestas');
    });
    test('las tres raices tienen nombres y propiedades distintos', () => {
      const Config = require('../src/StorageConfig');
      expect(new Set([Config.STORAGE_ROOT_FOLDER_NAME, Config.STORAGE_POZOS_ROOT_FOLDER_NAME, Config.STORAGE_ITF_ROOT_FOLDER_NAME]).size).toBe(3);
    });
  });
});

// ===========================================================================
// Prueba CRUZADA E9-4: el proveedor REAL del backend principal (ItfStorageProvider) contra el Web App de storage, con la firma HMAC de Fotos (un solo esquema de autenticacion)
// ===========================================================================
describe('ITF extremo a extremo: proveedor del backend principal -> cliente HMAC de Fotos -> storage', () => {
  const jpeg = (n) => Array.from(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 5)])).map((v) => (v > 127 ? v - 256 : v));
  const png = (n) => Array.from(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(n - 16, 6)])).map((v) => (v > 127 ? v - 256 : v));
  const DOC_ID = '55555555-5555-4555-8555-555555555555';
  let proveedor;
  let enviados;

  beforeEach(() => {
    Object.assign(global, require('../../backend/src/ItfArchivoLogic'));
    enviados = [];
    // UrlFetchApp: el "HTTP" va directo al doPost del storage
    global.UrlFetchApp = {
      fetch: (url, opciones) => {
        enviados.push(JSON.parse(opciones.payload));
        const salida = Api.doPost({ postData: { contents: opciones.payload } });
        return { getResponseCode: () => 200, getContentText: () => salida.text };
      }
    };
    Object.assign(global, Client);
    proveedor = require('../../backend/src/ItfStorageProvider').itfStorage_crearReal();
  });

  test('guardar -> metadata -> leer -> compensar: los bytes vuelven identicos y todo viaja firmado con las acciones de ITF', () => {
    const bytes = jpeg(5000);
    const g = proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: bytes, mimeType: 'image/jpeg' });
    expect(g.ok).toBe(true);
    expect(typeof g.storageRef).toBe('string');
    expect(drive.archivos[g.storageRef]._padre._padre._id).toBe(ITF_ROOT_ID);
    expect(proveedor.obtenerMetadata(g.storageRef)).toEqual({ ok: true, bytes: 5000, mimeType: 'image/jpeg' });
    const l = proveedor.leerDocumento(g.storageRef);
    expect(l.ok).toBe(true);
    expect(Array.from(l.bytes).map((v) => v & 0xff)).toEqual(bytes.map((v) => v & 0xff));
    expect(proveedor.eliminarTemporal(g.storageRef)).toEqual({ ok: true });
    expect(drive.archivos[g.storageRef]._papelera).toBe(true);
    expect(enviados.map((s) => s.action)).toEqual(['putItf', 'metaItf', 'getItf', 'trashItf']);
    enviados.forEach((s) => { expect(s.v).toBe('v1'); expect(typeof s.sig).toBe('string'); expect(s.sig).toHaveLength(64); });
  });
  test('PNG viaja y se guarda como PNG', () => {
    const g = proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: png(800), mimeType: 'image/png' });
    expect(g.ok).toBe(true);
    expect(drive.archivos[g.storageRef]._nombre).toBe(DOC_ID + '.png');
    expect(proveedor.leerDocumento(g.storageRef).mimeType).toBe('image/png');
  });
  test('un reintento con el mismo documentoId devuelve la MISMA referencia (idempotente) y una sola copia', () => {
    const a = proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: jpeg(700), mimeType: 'image/jpeg' });
    const b = proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: jpeg(700), mimeType: 'image/jpeg' });
    expect(b).toEqual(a);
    expect(drive.raizItf._hijosCarpetas[0]._hijosArchivos).toHaveLength(1);
  });
  test('contenido renombrado (PDF dicho JPEG) que se cuele al storage: el storage lo rechaza y el proveedor lo informa como INVALID_ARCHIVO', () => {
    const pdf = Array.from(Buffer.from('%PDF-1.7 ....................'));
    expect(proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: pdf, mimeType: 'image/jpeg' })).toEqual({ ok: false, code: 'INVALID_ARCHIVO' });
    expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
  });
  test('un archivo de Fotos no se puede leer ni retirar por el proveedor de ITF', () => {
    const foto = Dr.storageDrive_putFoto(payloadPut(), 2026).driveFileId;
    expect(proveedor.leerDocumento(foto)).toEqual({ ok: false, code: 'ITF_NOT_FOUND' });
    expect(proveedor.eliminarTemporal(foto)).toEqual({ ok: false, code: 'ITF_NOT_FOUND' });
    expect(drive.archivos[foto]._papelera).toBe(false);
  });
  test('sin el secreto correcto en el storage: UNAUTHORIZED -> el proveedor responde SERVICE_UNAVAILABLE (no se crea nada)', () => {
    global.getStorageSecret = () => 'z'.repeat(40);
    const g = proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: jpeg(700), mimeType: 'image/jpeg' });
    expect(g).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
  });
  test('un storage desplegado SIN las acciones de ITF (version vieja) responde UNKNOWN_ACTION -> ITF_STORAGE_NO_CONFIGURADO', () => {
    const original = Api.doPost;
    global.UrlFetchApp.fetch = (url, opciones) => {
      const sol = JSON.parse(opciones.payload);
      const falso = Client.fotosStorageClient_armarSolicitud('accionInexistente', {}, SECRET, ahora(), sol.nonce);
      const salida = original({ postData: { contents: JSON.stringify(Object.assign({}, falso, { nonce: sol.nonce })) } });
      // el storage viejo firma su error con el nonce de la solicitud original: se emula devolviendo UNKNOWN_ACTION firmado
      const cuerpo = Auth.storageAuth_firmarRespuesta(SECRET, sol.nonce, { status: 'error', code: 'UNKNOWN_ACTION' }, ahora());
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(cuerpo) };
    };
    expect(proveedor.guardarPropuesta({ documentoId: DOC_ID, bytes: jpeg(700), mimeType: 'image/jpeg' })).toEqual({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
  });
});

describe('StorageApi: ITF y autenticacion HMAC (timestamp, replay, accion, firma)', () => {
  const DOC = '66666666-6666-4666-8666-666666666666';
  const imagen = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 3)]).toString('base64');
  const enviar = (accion, payload, ts, secreto, nonce) => {
    const sol = Client.fotosStorageClient_armarSolicitud(accion, payload, secreto || SECRET, ts === undefined ? ahora() : ts, nonce || crypto.randomUUID());
    return { sol, cuerpo: JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text) };
  };
  const sinEscritura = () => { expect(drive.raizItf._hijosCarpetas).toHaveLength(0); };

  test('timestamp vencido (hace 10 min) o del futuro: UNAUTHORIZED y no se escribe nada', () => {
    expect(enviar('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen }, ahora() - 600).cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    expect(enviar('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen }, ahora() + 600).cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    sinEscritura();
  });
  test('replay de un putItf valido: el segundo es UNAUTHORIZED y no duplica nada', () => {
    const sol = Client.fotosStorageClient_armarSolicitud('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen }, SECRET, ahora(), crypto.randomUUID());
    const mandar = () => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text);
    expect(mandar().status).toBeUndefined();                                    // respuesta firmada (sin 'status' en el sobre)
    expect(mandar()).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    expect(drive.raizItf._hijosCarpetas[0]._hijosArchivos).toHaveLength(1);
  });
  test('firma con otro secreto, y accion alterada (putFoto -> putItf reusando la firma): UNAUTHORIZED', () => {
    expect(enviar('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen }, undefined, 'q'.repeat(40)).cuerpo).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    const sol = Client.fotosStorageClient_armarSolicitud('putFoto', {}, SECRET, ahora(), crypto.randomUUID());
    sol.action = 'putItf';
    sol.payload = JSON.stringify({ documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen });
    expect(JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(sol) } }).text)).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    sinEscritura();
  });
  test('acciones de otras familias NO operan sobre la raiz de ITF y las de ITF NO operan sobre la de Fotos', () => {
    const r = enviar('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen });
    const ref = Client.fotosStorageClient_verificarRespuesta(r.cuerpo, SECRET, r.sol.nonce, ahora()).data.driveFileId;
    ['getFoto', 'getFotoPozo'].forEach((accion) => {
      const x = enviar(accion, { driveFileId: ref, variante: 'full' });
      expect(Client.fotosStorageClient_verificarRespuesta(x.cuerpo, SECRET, x.sol.nonce, ahora()).data).toEqual({ status: 'error', code: 'NOT_FOUND' });
    });
    ['trashFoto', 'trashFotoPozo'].forEach((accion) => {
      const x = enviar(accion, { driveFileId: ref });
      expect(Client.fotosStorageClient_verificarRespuesta(x.cuerpo, SECRET, x.sol.nonce, ahora()).data).toEqual({ status: 'error', code: 'NOT_FOUND' });
    });
    expect(drive.archivos[ref]._papelera).toBe(false);
    const foto = Dr.storageDrive_putFoto(payloadPut(), 2026).driveFileId;
    const g = enviar('getItf', { driveFileId: foto });
    expect(Client.fotosStorageClient_verificarRespuesta(g.cuerpo, SECRET, g.sol.nonce, ahora()).data).toEqual({ status: 'error', code: 'NOT_FOUND' });
  });
  test('la raiz de ITF sin configurar (falta ITF_ROOT_FOLDER_ID): INTERNAL sin detalle, nada se crea', () => {
    global.getStorageItfRootFolderId = () => { throw new Error('ITF_ROOT_FOLDER_ID no configurado: correr setupItfPropuestasStorage() una vez'); };
    const r = enviar('putItf', { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen });
    expect(r.cuerpo).toEqual({ status: 'error', code: 'INTERNAL' });
    expect(JSON.stringify(r.cuerpo)).not.toMatch(/ITF_ROOT|setup/);
  });
  test('el limite de 3 MB es el mismo en el storage y en el backend principal', () => {
    const { ITF_ARCHIVO_BYTES_MAX } = require('../../backend/src/ItfArchivoLogic');
    expect(Dr.STORAGE_ITF_MAX_BYTES).toBe(ITF_ARCHIVO_BYTES_MAX);
    expect(ITF_ARCHIVO_BYTES_MAX).toBe(3 * 1024 * 1024);
  });
});

describe('StorageDrive: ITF, nombre fisico y claves del payload', () => {
  const DOC = '77777777-7777-4777-8777-777777777777';
  const imagen = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 3)]).toString('base64');

  test('putItf con "nombreOriginal" (o cualquier clave de mas) se rechaza como MALFORMED y no crea nada', () => {
    ['nombreOriginal', 'nombre', 'ruta', 'wellId'].forEach((clave) => {
      const p = { documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen };
      p[clave] = '../../fuga.jpg';
      expect(Dr.storageDrive_putItf(p, 2026)).toEqual({ status: 'error', code: 'MALFORMED' });
    });
    expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
  });
  test('el archivo se llama exactamente <documentoId>.jpg / .png, sin importar nada mas', () => {
    const j = Dr.storageDrive_putItf({ documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: imagen }, 2026);
    expect(drive.archivos[j.driveFileId]._nombre).toBe(DOC + '.jpg');
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]), Buffer.alloc(40, 1)]).toString('base64');
    const otro = '88888888-8888-4888-8888-888888888888';
    const p = Dr.storageDrive_putItf({ documentoId: otro, mimeType: 'image/png', imagenBase64: png }, 2026);
    expect(drive.archivos[p.driveFileId]._nombre).toBe(otro + '.png');
  });
  test('base64 vacio, solo relleno o de largo cero bytes: INVALID_IMAGEN y no se crea carpeta ni archivo', () => {
    ['', '====', 'AAAA'.slice(0, 0), '=A=='].forEach((vacio) => {
      expect(Dr.storageDrive_putItf({ documentoId: DOC, mimeType: 'image/jpeg', imagenBase64: vacio }, 2026)).toEqual({ status: 'error', code: 'INVALID_IMAGEN' });
    });
    expect(drive.raizItf._hijosCarpetas).toHaveLength(0);
  });
});
