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

// =====================================================================================================
// REGRESION de la lectura de fotos de evaluacion: upload -> guardar metadata -> leer thumbnail -> leer original, con
// IDs DISTINTOS de Drive para el original y la miniatura. Fija lo que viaja en cada lectura:
//   thumbnail: getFotoReemplazo(variante=thumb) -> fotosService_obtenerImagen -> fotosStorageClient_obtener
//              -> action 'getFoto' {driveFileId: <ID DEL ORIGINAL>, variante:'thumb'}
//   original : getFotoReemplazo(variante=full)  -> fotosService_obtenerImagen -> fotosStorageClient_obtener
//              -> action 'getFoto' {driveFileId: <ID DEL ORIGINAL>, variante:'full'}
// El storage abre SIEMPRE primero el archivo principal por ese id; para 'thumb' ademas resuelve la miniatura
// por 'thumb:<id>' en la descripcion.
describe('lectura: upload -> metadata -> thumbnail -> original (IDs distintos)', () => {
  const ORIGINAL_BYTES = 900 * 1024;
  let trafico;

  function espiarStorage() {
    trafico = [];
    const StorageApi = require('../../storage/src/StorageApi');
    global.UrlFetchApp.fetch.mockImplementation((url, opts) => {
      const salida = StorageApi.doPost({ postData: { contents: opts.payload } });
      const solicitud = JSON.parse(opts.payload);
      trafico.push({ url, opts, accion: solicitud.action, payload: JSON.parse(solicitud.payload), texto: salida.text });
      return { getResponseCode: () => 200, getContentText: () => salida.text };
    });
  }

  function subirYObtener() {
    espiarStorage();
    const e = bodyDeFrontend(ORIGINAL_BYTES);
    const sube = post(JSON.stringify(e.cuerpo));
    expect(sube.status).toBe('ok');
    const fila = hojaFotos[0];
    const principal = drive.archivos[fila.driveFileId];
    const idThumb = /^thumb:(.+)$/.exec(principal._d)[1];
    trafico.length = 0;                                                  // solo interesan las LECTURAS
    const fotoId = sube.data.foto.fotoId;
    const thumb = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'thumb' }));
    const full = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'full' }));
    return { e, fila, principal, idThumb, thumb, full };
  }

  test('el original y la miniatura son archivos DISTINTOS con ids distintos, y la hoja guarda solo el id del ORIGINAL', () => {
    const { fila, principal, idThumb } = subirYObtener();
    expect(fila.driveFileId).not.toBe(idThumb);
    expect(principal._n).toMatch(/^[^/]+\.jpg$/);
    expect(principal._n.endsWith('_thumb.jpg')).toBe(false);
    expect(drive.archivos[idThumb]._n.endsWith('_thumb.jpg')).toBe(true);
    expect(drive.archivos[fila.driveFileId]._b.length).toBe(ORIGINAL_BYTES);
    expect(drive.archivos[idThumb]._b.length).toBe(12 * 1024 + 4);
    expect(fila.tamanoBytes).toBe(ORIGINAL_BYTES);
    expect(Object.keys(fila)).not.toContain('driveThumbId');           // Reemplazos: UN id por foto (la miniatura va en la descripcion)
  });

  test('las dos lecturas mandan la MISMA accion y el MISMO id (el del original); solo cambia la variante', () => {
    const { fila } = subirYObtener();
    const lecturas = trafico.filter((t) => t.accion === 'getFoto');
    expect(lecturas).toHaveLength(2);
    const [t, f] = lecturas;
    expect(t.accion).toBe('getFoto');
    expect(f.accion).toBe('getFoto');
    expect(t.payload).toEqual({ driveFileId: fila.driveFileId, variante: 'thumb' });
    expect(f.payload).toEqual({ driveFileId: fila.driveFileId, variante: 'full' });
    // mismo destino, mismo metodo, mismas opciones de fetch
    expect(f.url).toBe(t.url);
    expect(f.opts.method).toBe(t.opts.method);
    expect(f.opts.contentType).toBe(t.opts.contentType);
    expect(f.opts.followRedirects).toBe(t.opts.followRedirects);
    expect(f.opts.muteHttpExceptions).toBe(t.opts.muteHttpExceptions);
    // solo se envia el id del original: la miniatura la resuelve el storage
    expect(JSON.stringify(trafico)).not.toContain(drive.archivos[fila.driveFileId]._d.replace('thumb:', ''));
  });

  test('cada lectura devuelve los bytes del archivo que corresponde (miniatura != original)', () => {
    const { e, thumb, full } = subirYObtener();
    expect(thumb.status).toBe('ok');
    expect(full.status).toBe('ok');
    expect(thumb.data.imagenBase64).toBe(THUMB_B64);
    expect(full.data.imagenBase64).toBe(e.cuerpo.imagenBase64);
    expect(thumb.data.imagenBase64).not.toBe(full.data.imagenBase64);
    expect(thumb.data.imagenBase64.length).toBeLessThan(full.data.imagenBase64.length / 10);
    expect(thumb.data.mimeType).toBe('image/jpeg');
    expect(full.data.mimeType).toBe('image/jpeg');
  });

  test('el storage responde las dos lecturas con HTTP 200 y JSON firmado status=ok: la unica diferencia es el tamano del cuerpo', () => {
    subirYObtener();
    const lecturas = trafico.filter((t) => t.accion === 'getFoto');
    lecturas.forEach((l) => {
      const cuerpo = JSON.parse(l.texto);
      expect(typeof cuerpo.sig).toBe('string');
      expect(JSON.parse(cuerpo.payload).status).toBe('ok');
    });
    expect(lecturas[1].texto.length).toBeGreaterThan(lecturas[0].texto.length * 10);
  });

  test('contrato del storage: todo resultado (ok, NOT_FOUND, INVALID, UNAUTHORIZED, JSON roto) es un JSON con status', () => {
    subirYObtener();
    const StorageApi = require('../../storage/src/StorageApi');
    const fila = hojaFotos[0];
    const envio = (accion, payload, malFirma) => {
      const sol = Servicios.Client.fotosStorageClient_armarSolicitud(accion, payload, malFirma ? 'otro-secreto-distinto' : SECRET, Math.floor(Date.now() / 1000), crypto.randomUUID());
      return JSON.parse(StorageApi.doPost({ postData: { contents: JSON.stringify(sol) } }).text);
    };
    expect(JSON.parse(envio('getFoto', { driveFileId: fila.driveFileId, variante: 'full' }).payload).status).toBe('ok');
    expect(JSON.parse(envio('getFoto', { driveFileId: 'NoExisteEsteId0123456', variante: 'full' }).payload)).toEqual({ status: 'error', code: 'NOT_FOUND' });
    expect(JSON.parse(envio('getFoto', { driveFileId: fila.driveFileId, variante: 'otra' }).payload)).toEqual({ status: 'error', code: 'INVALID_VARIANTE' });
    expect(envio('getFoto', { driveFileId: fila.driveFileId, variante: 'full' }, true)).toEqual({ status: 'error', code: 'UNAUTHORIZED' });
    expect(JSON.parse(StorageApi.doPost({ postData: { contents: '{roto' } }).text)).toEqual({ status: 'error', code: 'MALFORMED' });
    expect(JSON.parse(envio('accionInexistente', {}).payload)).toEqual({ status: 'error', code: 'UNKNOWN_ACTION' });
  });

  test('el id que resuelve el original es el MISMO que usa la miniatura para encontrar su archivo (misma raiz, mismo nivel)', () => {
    const { fila, idThumb } = subirYObtener();
    expect(Global_estaBajoRaiz(drive.archivos[fila.driveFileId])).toBe(true);
    expect(Global_estaBajoRaiz(drive.archivos[idThumb])).toBe(true);
    function Global_estaBajoRaiz(file) { return global.storageDrive_estaBajoRaiz(file, ROOT_ID, 2); }
  });

  test('originales de 300 KB, 1,5 MB y 1,99 MB: la lectura completa vuelve entera por el MISMO camino que la miniatura', () => {
    [300 * 1024, 1.5 * 1024 * 1024, 2 * 1024 * 1024 - 100].forEach((bytes) => {
      const e = bodyDeFrontend(bytes);
      const sube = post(JSON.stringify(e.cuerpo));
      const fotoId = sube.data.foto.fotoId;
      const thumb = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'thumb' }));
      const full = post(JSON.stringify({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'full' }));
      expect(thumb.data.imagenBase64).toBe(THUMB_B64);
      expect(full.data.imagenBase64).toBe(e.cuerpo.imagenBase64);
    });
  });
});

// =====================================================================================================
// Mapeo de errores de la subida de fotos de UNA EVALUACION (Nueva evaluacion > fotos > guardar): la asociacion con la
// evaluacion se valida ANTES de tocar el storage y cada causa tiene su propio codigo y mensaje. STORAGE_UNAVAILABLE
// queda reservado para un fallo real al hablar con el storage.
describe('subida a una evaluacion: cada causa tiene su codigo (STORAGE_UNAVAILABLE solo si el storage falla)', () => {
  const subirConCuerpo = (extra) => {
    const e = bodyDeFrontend(200 * 1024);
    return post(JSON.stringify({ ...e.cuerpo, ...extra }));
  };
  const frontend = () => {
    const sandbox = { JSON, Object, Promise, Math, String, Number, Array };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/reemplazoFotosLogic.js'), 'utf8'), sandbox, { filename: 'js/reemplazoFotosLogic.js' });
    return sandbox;
  };

  test('evaluacionId inexistente: EVALUACION_NOT_FOUND, sin llamar al storage ni escribir filas', () => {
    const r = subirConCuerpo({ evaluacionId: '11111111-2222-4333-8444-555555555555' });
    expect(r.code).toBe('EVALUACION_NOT_FOUND');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(hojaFotos).toHaveLength(0);
    expect(Object.keys(drive.archivos)).toHaveLength(0);
  });

  test('evaluacionId vacio o mal formado: INVALID_EVALUACION_ID (tampoco llega al storage)', () => {
    ['', 'abc', null].forEach((id) => {
      const r = subirConCuerpo({ evaluacionId: id });
      expect(r.code).toBe('INVALID_EVALUACION_ID');
    });
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test('la evaluacion es de otro pozo: EVALUACION_WELLID_MISMATCH', () => {
    const r = subirConCuerpo({ wellId: '05-0001' });
    expect(r.code).toBe('EVALUACION_WELLID_MISMATCH');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test('sexta foto de una evaluacion: FOTO_LIMIT (sin llamar al storage)', () => {
    for (let i = 0; i < 5; i++) {
      expect(subirConCuerpo({}).status).toBe('ok');
    }
    global.UrlFetchApp.fetch.mockClear();
    const r = subirConCuerpo({});
    expect(r.code).toBe('FOTO_LIMIT');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(hojaFotos).toHaveLength(5);
  });

  test('storage realmente caido: STORAGE_UNAVAILABLE', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => ({ getResponseCode: () => 503, getContentText: () => '' }));
    expect(subirConCuerpo({}).code).toBe('STORAGE_UNAVAILABLE');
    expect(hojaFotos).toHaveLength(0);
  });

  test('el frontend muestra un mensaje DISTINTO para cada una de esas causas (y el codigo real al lado)', () => {
    const f = frontend();
    const codigos = ['EVALUACION_NOT_FOUND', 'INVALID_EVALUACION_ID', 'EVALUACION_WELLID_MISMATCH', 'FOTO_LIMIT', 'STORAGE_UNAVAILABLE', 'PERMISSION_DENIED'];
    const mensajes = codigos.map((c) => f.reemplazoFotosLogic_mensajeError(c));
    expect(new Set(mensajes).size).toBe(codigos.length);
    expect(f.reemplazoFotosLogic_mensajeError('EVALUACION_NOT_FOUND')).toMatch(/evaluación/);
    expect(f.reemplazoFotosLogic_mensajeError('STORAGE_UNAVAILABLE')).toMatch(/almacenamiento/);
    expect(f.reemplazoFotosLogic_mensajeError('EVALUACION_NOT_FOUND')).not.toMatch(/almacenamiento/);
    expect(f.reemplazoFotosLogic_textoCodigo('EVALUACION_NOT_FOUND')).toBe('Código: EVALUACION_NOT_FOUND');
  });
});
