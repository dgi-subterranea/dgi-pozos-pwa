// REPRODUCCION de punta a punta de la subida de una foto desde la app:
//   js/api.js (apiSubirFotoReemplazo, el codigo REAL del frontend)
//   -> JSON exacto que viaja por fetch
//   -> Api.doPost (real) -> handleSubirFotoReemplazo (real)
//   -> FotosReemplazoService (real) -> FotosStorageClient (real, firma HMAC)
//   -> UrlFetchApp simulado que entrega la solicitud al StorageApi REAL
//   -> StorageDrive con un Drive en memoria.
// Solo se simulan las hojas (repositorios en memoria), la sesion y Drive.
// Sirve para (1) fijar la forma exacta del payload frontend<->backend y (2)
// documentar que, con el codigo actual, una subida con payload valido
// funciona hasta el final - y que otros fallos (accion no desplegada,
// sesion vencida) NO dejan rastro en Historial.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { installAppsScriptFakes } = require('./appsScriptFakes');

const ROOT = path.join(__dirname, '..', '..');
const SECRET = 'e'.repeat(48);
const ROOT_ID = 'ROOT_FOLDER_E2E_0001';
const WELL = '04-0263';
const EVAL_ID = '9f3c1b6a-1111-4222-8333-444455556666';
const THUMB_B64 = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(12 * 1024, 7)]).toString('base64');

function jpegBase64(bytes) {
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(bytes - 4, 9)]).toString('base64');
}

// --- frontend real (api.js + reemplazoFotosLogic.js) en un sandbox ---
function cargarFrontend() {
  const enviados = [];
  const sandbox = {
    JSON, Object, Promise, Math, String, Number, Array,
    fetch: (url, opciones) => {
      enviados.push({ url, opciones, cuerpo: JSON.parse(opciones.body) });
      return Promise.resolve({ json: () => Promise.resolve({}) });
    }
  };
  vm.createContext(sandbox);
  ['js/api.js', 'js/reemplazoFotosLogic.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
  return { sandbox, enviados };
}

// --- Drive en memoria (para el storage) ---
function crearDrive() {
  let n = 0;
  const archivos = {};
  const it = (l) => { let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
  function carpeta(nombre, padre, id) {
    const f = {
      _id: id || 'FOLDER_' + (++n), _n: nombre, _p: padre, _c: [], _a: [],
      getId() { return this._id; },
      getParents() { return it(this._p ? [this._p] : []); },
      getFoldersByName(x) { return it(this._c.filter((c) => c._n === x)); },
      createFolder(x) { const c = carpeta(x, this); this._c.push(c); return c; },
      getFilesByName(x) { return it(this._a.filter((a) => a._n === x)); },
      createFile(blob) {
        const a = {
          _id: 'FILE_' + String(++n).padStart(10, '0'), _n: blob.nombre, _b: blob.bytes, _m: blob.mime, _p: this, _d: '', _t: false,
          getId() { return this._id; }, getSize() { return this._b.length; }, getParents() { return it([this._p]); },
          setDescription(d) { this._d = d; }, getDescription() { return this._d; }, setSharing() {},
          getBlob() { const s = this; return { getContentType: () => s._m, getBytes: () => s._b }; }, setTrashed(v) { this._t = v; }
        };
        archivos[a._id] = a; this._a.push(a); return a;
      }
    };
    return f;
  }
  const raiz = carpeta('FotosReemplazo', null, ROOT_ID);
  return {
    raiz, archivos,
    DriveApp: {
      Access: { PRIVATE: 'P' }, Permission: { NONE: 'N' },
      getFolderById: (id) => (id === ROOT_ID ? raiz : null),
      getFileById: (id) => { if (!archivos[id]) { throw new Error('no existe'); } return archivos[id]; }
    }
  };
}

let drive;
let hojaEvaluaciones;
let hojaFotos;
let Api;
let Servicios;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  drive = crearDrive();
  global.DriveApp = drive.DriveApp;

  Api = require('../src/Api');
  const Service = require('../src/FotosReemplazoService');
  const Client = require('../src/FotosStorageClient');
  const StorageAuth = require('../../storage/src/StorageAuth');
  const StorageDrive = require('../../storage/src/StorageDrive');
  const StorageApi = require('../../storage/src/StorageApi');
  Servicios = { Service, Client };

  // Scope global compartido (Apps Script): lo que cada archivo ve de los demas
  Object.assign(global, StorageAuth, StorageDrive);
  global.FOTOS_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  global.fotosService_subir = Service.fotosService_subir;
  global.fotosService_listarPorEvaluacion = Service.fotosService_listarPorEvaluacion;
  global.fotosService_listarPorPozo = Service.fotosService_listarPorPozo;
  global.fotosService_obtenerImagen = Service.fotosService_obtenerImagen;
  global.fotosStorageClient_subir = Client.fotosStorageClient_subir;
  global.fotosStorageClient_obtener = Client.fotosStorageClient_obtener;
  global.fotosStorageClient_descartar = Client.fotosStorageClient_descartar;
  global.getFotosStorageSecret = () => SECRET;
  global.getFotosStorageUrl = () => 'https://script.google.com/macros/s/STORAGE_E2E/exec';
  global.getStorageSecret = () => SECRET;
  global.getStorageRootFolderId = () => ROOT_ID;
  global.Utilities.newBlob = (bytes, mime, nombre) => ({ bytes: Buffer.from(bytes), mime, nombre });
  global.Utilities.base64Encode = (bytes) => Buffer.from(bytes).toString('base64');
  global.ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };

  // Storage "en la nube": UrlFetchApp del backend principal -> StorageApi real
  global.UrlFetchApp = {
    fetch: jest.fn((url, opts) => {
      const salida = StorageApi.doPost({ postData: { contents: opts.payload } });
      return { getResponseCode: () => 200, getContentText: () => salida.text };
    })
  };

  // Hojas en memoria
  hojaEvaluaciones = [{ evaluacionId: EVAL_ID, wellId: WELL, email: 'autor@x.com', timestamp: '2026-10-05T12:00:00.000Z' }];
  hojaFotos = [];
  global.reemplazoRepository_buscarPorEvaluacionId = (id) => hojaEvaluaciones.find((e) => e.evaluacionId === id) || null;
  global.fotosRepository_contarPorEvaluacionId = (id) => hojaFotos.filter((f) => f.evaluacionId === id).length;
  global.fotosRepository_agregarSiHayCupo = (foto, max) => {
    if (hojaFotos.filter((f) => f.evaluacionId === foto.evaluacionId).length >= max) { return false; }
    hojaFotos.push({ ...foto, timestamp: foto.timestamp.toISOString() });
    return true;
  };
  global.fotosRepository_buscarPorFotoId = (id) => hojaFotos.find((f) => f.fotoId === id) || null;
  global.fotosRepository_listarPorEvaluacionId = (id) => hojaFotos.filter((f) => f.evaluacionId === id);
  global.fotosRepository_listarPorWellId = (w) => hojaFotos.filter((f) => f.wellId === w);

  // Sesion de un usuario con reemplazo=SI (como el de produccion)
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'companero@x.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => modulo === 'reemplazo' || modulo === 'perfil');
  global.getUserAccess.mockReturnValue({ active: true, nombre: 'Companero', permisos: { reemplazo: true, perfil: true } });
});

// Lo que el frontend REAL manda, tal cual lo arma js/reemplazoFotos.js
// (nombre neutro 'foto.jpg', mime 'image/jpeg', base64 puro de canvas)
function bodyDeFrontend(imagenBytes, over) {
  const { sandbox, enviados } = cargarFrontend();
  const dataUrl = 'data:image/jpeg;base64,' + jpegBase64(imagenBytes); // lo que entrega FileReader
  const imagenBase64 = sandbox.reemplazoFotosLogic_base64DeDataUrl(dataUrl);
  sandbox.apiSubirFotoReemplazo('tok-test', WELL, EVAL_ID, 'foto.jpg', 'image/jpeg', (over && over.imagenBase64) || imagenBase64, THUMB_B64);
  return enviados[0];
}

const post = (contenidoJson) => JSON.parse(Api.doPost({ postData: { contents: contenidoJson } }).text);

describe('payload real del frontend', () => {
  test('accion y campos exactos que manda js/api.js, y que Api.js lee con esos mismos nombres', () => {
    const e = bodyDeFrontend(300 * 1024);
    expect(e.opciones.method).toBe('POST');
    expect(e.opciones.headers['Content-Type']).toBe('text/plain;charset=utf-8');
    expect(Object.keys(e.cuerpo).sort()).toEqual(['action', 'evaluacionId', 'imagenBase64', 'mimeType', 'nombreArchivo', 'sessionToken', 'thumbBase64', 'wellId']);
    expect(e.cuerpo.action).toBe('subirFotoReemplazo');
    expect(e.cuerpo.wellId).toBe(WELL);
    expect(e.cuerpo.evaluacionId).toBe(EVAL_ID);
    expect(e.cuerpo.mimeType).toBe('image/jpeg');
    expect(e.cuerpo.nombreArchivo).toBe('foto.jpg');
  });

  test('la imagen viaja como base64 PURO (sin prefijo data:) y no lleva saltos de linea', () => {
    const e = bodyDeFrontend(300 * 1024);
    expect(e.cuerpo.imagenBase64.startsWith('data:')).toBe(false);
    expect(e.cuerpo.imagenBase64.startsWith('/9j/')).toBe(true);
    expect(/^[A-Za-z0-9+\/]+={0,2}$/.test(e.cuerpo.imagenBase64)).toBe(true);
    expect(e.cuerpo.thumbBase64.startsWith('data:')).toBe(false);
  });

  test('si por error llegara CON prefijo data:, el backend la rechaza como INVALID_IMAGEN (y lo audita)', () => {
    const e = bodyDeFrontend(100 * 1024);
    e.cuerpo.imagenBase64 = 'data:image/jpeg;base64,' + e.cuerpo.imagenBase64;
    const r = post(JSON.stringify(e.cuerpo));
    expect(r.code).toBe('INVALID_IMAGEN');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('companero@x.com', 'subirFotoReemplazo', WELL, 'INVALID_IMAGEN');
  });
});

describe('subida completa con el codigo actual (storage real simulado)', () => {
  test.each([
    ['300 KB (foto tipica comprimida)', 300 * 1024],
    ['1,5 MB (objetivo del navegador)', 1.5 * 1024 * 1024],
    ['1,99 MB (justo bajo el tope del backend)', 2 * 1024 * 1024 - 100]
  ])('%s: OK, queda en Drive, en la hoja, y se lee de vuelta', (nombre, bytes) => {
    const e = bodyDeFrontend(bytes);
    const r = post(JSON.stringify(e.cuerpo));

    expect(r.status).toBe('ok');
    expect(hojaFotos).toHaveLength(1);
    expect(hojaFotos[0]).toMatchObject({ evaluacionId: EVAL_ID, wellId: WELL, email: 'companero@x.com', mimeType: 'image/jpeg' });
    expect(hojaFotos[0].tamanoBytes).toBe(bytes);
    expect(Object.keys(drive.archivos)).toHaveLength(2); // foto + miniatura
    // respuesta sin email ni driveFileId
    expect(JSON.stringify(r)).not.toMatch(/companero@x\.com|FILE_/);

    const fotoId = r.data.foto.fotoId;
    const thumb = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'thumb' }));
    const full = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'full' }));
    expect(thumb.data.imagenBase64).toBe(THUMB_B64);
    expect(full.data.imagenBase64).toBe(e.cuerpo.imagenBase64);
  });

  test('no se escribe NADA en Historial en una subida correcta (sin ruido)', () => {
    post(JSON.stringify(bodyDeFrontend(200 * 1024).cuerpo));
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('3 fotos seguidas (como la cola del frontend) -> 3 filas', () => {
    for (let i = 0; i < 3; i++) {
      expect(post(JSON.stringify(bodyDeFrontend(250 * 1024).cuerpo)).status).toBe('ok');
    }
    expect(hojaFotos).toHaveLength(3);
  });

  test('2,1 MB: FILE_TOO_LARGE (y SI queda en Historial)', () => {
    const r = post(JSON.stringify(bodyDeFrontend(2.1 * 1024 * 1024).cuerpo));
    expect(r.code).toBe('FILE_TOO_LARGE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('companero@x.com', 'subirFotoReemplazo', WELL, 'FILE_TOO_LARGE');
  });

  test('validar un base64 de ~2,7 M de caracteres con la regex no es lento ni revienta', () => {
    const grande = jpegBase64(2 * 1024 * 1024 - 100);
    const t0 = Date.now();
    expect(/^[A-Za-z0-9+\/]+={0,2}$/.test(grande)).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('fallos que NO dejan rastro en Historial (el sintoma reportado)', () => {
  test('accion no desplegada (Web App con una version vieja de Api.js): SERVICE_UNAVAILABLE "accion desconocida", sin Historial ni fila', () => {
    const e = bodyDeFrontend(200 * 1024);
    e.cuerpo.action = 'accionQueLaVersionDesplegadaNoConoce';
    const r = post(JSON.stringify(e.cuerpo));
    expect(r.status).toBe('error');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(r.message).toMatch(/accion desconocida/);
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(hojaFotos).toHaveLength(0);
  });

  test('sesion vencida: UNAUTHORIZED, sin Historial (no hay email al que atribuirlo)', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    const r = post(JSON.stringify(bodyDeFrontend(200 * 1024).cuerpo));
    expect(r.code).toBe('UNAUTHORIZED');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('body sin contenido: SERVICE_UNAVAILABLE sin Historial', () => {
    const r = JSON.parse(Api.doPost({}).text);
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('JSON roto (ej. cuerpo truncado): SERVICE_UNAVAILABLE desde el catch de doPost, sin Historial', () => {
    const r = post('{"action":"subirFotoReemplazo","imagenBase64":"/9j/4AAQ');
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('storage caido: STORAGE_UNAVAILABLE y SI queda en Historial', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => ({ getResponseCode: () => 500, getContentText: () => '' }));
    const r = post(JSON.stringify(bodyDeFrontend(200 * 1024).cuerpo));
    expect(r.code).toBe('STORAGE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('companero@x.com', 'subirFotoReemplazo', WELL, 'STORAGE_UNAVAILABLE');
  });
});

describe('logging permanente: seguro y con valor operativo', () => {
  const lineas = () => global.Logger.log.mock.calls.map((c) => String(c[0]));

  test('una accion que la version desplegada no conoce deja en el log SOLO el nombre de la accion (detecta un Web App viejo)', () => {
    post(JSON.stringify({ action: 'accionNueva', sessionToken: 't', imagenBase64: 'AAAA'.repeat(500) }));
    const l = lineas().filter((x) => x.includes('accion desconocida'));
    expect(l).toHaveLength(1);
    expect(l[0]).toContain('accionNueva');
    expect(l[0]).not.toContain('AAAAAAAA');
  });

  test('una subida OK no escribe nada en el log (sin ruido)', () => {
    post(JSON.stringify(bodyDeFrontend(200 * 1024).cuerpo));
    expect(lineas()).toHaveLength(0);
  });

  test('una excepcion inesperada de doPost (JSON truncado) se loguea sin fragmentos del cuerpo', () => {
    const e = bodyDeFrontend(300 * 1024);
    post('{"action":"subirFotoReemplazo","imagenBase64":"' + e.cuerpo.imagenBase64.substring(0, 400));
    const l = lineas().filter((x) => x.includes('excepcion'));
    expect(l).toHaveLength(1);
    expect(l[0]).not.toContain(e.cuerpo.imagenBase64.substring(0, 60));
  });

  test('storage caido: se loguea el motivo SIN la URL del storage ni ids largos', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => { throw new Error('Address unavailable https://script.google.com/macros/s/STORAGE_E2E/exec'); });
    post(JSON.stringify(bodyDeFrontend(100 * 1024).cuerpo));
    const l = lineas().filter((x) => x.includes('Storage de fotos no disponible'));
    expect(l).toHaveLength(1);
    expect(l[0]).not.toContain('STORAGE_E2E');
    expect(l[0]).toContain('[url]');
  });

  test('NUNCA imprime base64, secreto, URL del storage, driveFileId ni email (OK, errores, JSON roto, storage caido)', () => {
    const e = bodyDeFrontend(300 * 1024);
    post(JSON.stringify(e.cuerpo));                                   // OK
    post(JSON.stringify({ ...e.cuerpo, mimeType: 'image/png' }));     // error de contenido
    post('{"action":"subirFotoReemplazo","imagenBase64":"' + e.cuerpo.imagenBase64.substring(0, 400)); // truncado
    post(JSON.stringify({ ...e.cuerpo, action: 'otraAccion' }));      // accion desconocida con el body completo
    global.UrlFetchApp.fetch.mockImplementation(() => { throw new Error('Address unavailable https://script.google.com/macros/s/STORAGE_E2E/exec'); });
    post(JSON.stringify(e.cuerpo));                                   // storage cae con la URL en el mensaje
    const todo = lineas().join('\n');
    expect(todo).not.toContain(e.cuerpo.imagenBase64.substring(0, 120));
    expect(todo).not.toContain(e.cuerpo.thumbBase64.substring(0, 60));
    expect(todo).not.toContain(SECRET);
    expect(todo).not.toContain('STORAGE_E2E');
    expect(todo).not.toMatch(/FILE_\d{10}/);
    expect(todo).not.toContain('companero@x.com');
    expect(todo).not.toContain('autor@x.com');
  });

  test('ya no existe la instrumentacion temporal (build, etapas, resumen del body)', () => {
    const fuente = fs.readFileSync(path.join(ROOT, 'backend/src/Api.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'backend/src/FotosReemplazoService.js'), 'utf8');
    expect(fuente).not.toMatch(/FOTOS_API_BUILD|fotosDiag_|fotosService_etapa|FOTOS_ACCIONES_DIAG/);
  });
});
