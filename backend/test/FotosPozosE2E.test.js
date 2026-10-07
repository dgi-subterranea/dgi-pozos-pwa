// De punta a punta, con el codigo REAL de todos los eslabones:
//   js/api.js (apiSubirFotoPozo / apiGetFotosPozo..., el frontend real, en un sandbox)
//   -> JSON exacto que viaja por fetch
//   -> Api.doPost -> handlers (gates fotos / fotos_carga)
//   -> FotosPozosService -> FotosPozosRepository (hoja en memoria)
//   -> FotosStorageClient (firma HMAC) -> UrlFetchApp simulado
//   -> StorageApi / StorageDrive reales con un Drive en memoria (dos raices:
//      FotosReemplazo y FotosPozos).
// Solo se simulan la sesion/permisos, Sheets, Drive y el padron/red NE.
const vm = require('vm');
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const ROOT = path.join(__dirname, '..', '..');
const SECRET = 'e'.repeat(48);
const REEMPLAZO_ROOT_ID = 'ROOT_REEMPLAZO_E2E_01';
const POZOS_ROOT_ID = 'ROOT_POZOS_E2E_0001';
const STORAGE_URL = 'https://script.google.com/macros/s/STORAGE_E2E_SECRETA/exec';
const WELL = '04-0263';
const EMAIL = 'companero@x.com';

function jpegB64(ancho, alto, relleno, semilla) {
  const cab = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from(cab), Buffer.from(sof), Buffer.alloc(relleno, semilla || 7)]).toString('base64');
}
const IMG = jpegB64(1600, 1200, 300 * 1024, 7);
const THUMB = jpegB64(256, 192, 12 * 1024, 9);
const SHA = 'ab'.repeat(20);

function cargarFrontend() {
  const enviados = [];
  const sandbox = { JSON, Object, Promise, Math, String, Number, Array, fetch: (url, opciones) => { enviados.push({ url, opciones, cuerpo: JSON.parse(opciones.body) }); return Promise.resolve({ json: () => Promise.resolve({}) }); } };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/api.js'), 'utf8'), sandbox, { filename: 'js/api.js' });
  return { sandbox, enviados };
}

function crearDrive() {
  let n = 0;
  const archivos = {};
  const it = (l) => { let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
  const carpetas = {};
  function carpeta(nombre, padre, id) {
    const f = {
      _id: id || 'FOLDER_' + (++n), _n: nombre, _p: padre, _c: [], _a: [],
      getId() { return this._id; },
      getParents() { return it(this._p ? [this._p] : []); },
      getFoldersByName(x) { return it(this._c.filter((c) => c._n === x)); },
      createFolder(x) { const c = carpeta(x, this); this._c.push(c); return c; },
      getFilesByName(x) { return it(this._a.filter((a) => a._n === x && !a._t)); },
      createFile(blob) {
        const a = {
          _id: 'FILE_' + String(++n).padStart(10, '0'), _n: blob.nombre, _b: blob.bytes, _m: blob.mime, _p: this, _d: '', _t: false, _share: null,
          getId() { return this._id; }, getSize() { return this._b.length; }, getParents() { return it([this._p]); },
          setDescription(d) { this._d = d; }, getDescription() { return this._d; }, setSharing(a2, p2) { this._share = [a2, p2]; },
          getBlob() { const s = this; return { getContentType: () => s._m, getBytes: () => s._b }; }, setTrashed(v) { this._t = v; }
        };
        archivos[a._id] = a; this._a.push(a); return a;
      }
    };
    carpetas[f._id] = f;
    return f;
  }
  const raizReemplazo = carpeta('FotosReemplazo', null, REEMPLAZO_ROOT_ID);
  const raizPozos = carpeta('FotosPozos', null, POZOS_ROOT_ID);
  return {
    raizReemplazo, raizPozos, archivos,
    DriveApp: {
      Access: { PRIVATE: 'P' }, Permission: { NONE: 'N' },
      getFolderById: (id) => carpetas[id] || null,
      getFileById: (id) => { if (!archivos[id]) { throw new Error('no existe'); } return archivos[id]; }
    }
  };
}

let drive;
let hojas;
let Api;
let StorageApi;
let permisos;
let respuestasStorage;
let fallaHoja;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  drive = crearDrive();
  global.DriveApp = drive.DriveApp;
  respuestasStorage = [];
  fallaHoja = false;

  Api = require('../src/Api');
  const Repo = require('../src/FotosPozosRepository');
  const Service = require('../src/FotosPozosService');
  const Reemplazo = require('../src/FotosReemplazoService');
  const Client = require('../src/FotosStorageClient');
  const StorageAuth = require('../../storage/src/StorageAuth');
  const StorageDrive = require('../../storage/src/StorageDrive');
  StorageApi = require('../../storage/src/StorageApi');

  // Scope global compartido (Apps Script)
  Object.assign(global, StorageAuth, StorageDrive, Repo, Service, Client);
  global.fotosService_bytesDeBase64 = Reemplazo.fotosService_bytesDeBase64;
  global.fotosService_esJpeg = Reemplazo.fotosService_esJpeg;
  global.fotosService_limpiar = Reemplazo.fotosService_limpiar;
  global.fotosService_obtenerImagen = Reemplazo.fotosService_obtenerImagen;
  global.FOTOS_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  global.fotosRepository_buscarPorFotoId = () => null;     // FotosReemplazo vacia
  global.getFotosStorageSecret = () => SECRET;
  global.getFotosStorageUrl = () => STORAGE_URL;
  global.getStorageSecret = () => SECRET;
  global.getStorageRootFolderId = () => REEMPLAZO_ROOT_ID;
  global.getStoragePozosRootFolderId = () => POZOS_ROOT_ID;
  global.Utilities.newBlob = (bytes, mime, nombre) => ({ bytes: Buffer.from(bytes), mime, nombre });
  global.ContentService = { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };

  // Storage "en la nube": UrlFetchApp del backend principal -> StorageApi real
  global.UrlFetchApp = {
    fetch: jest.fn((url, opts) => {
      const sol = JSON.parse(opts.payload);
      respuestasStorage.push(sol.action);
      const salida = StorageApi.doPost({ postData: { contents: opts.payload } });
      return { getResponseCode: () => 200, getContentText: () => salida.text };
    })
  };

  // Hoja FotosPozos en memoria (con el repositorio real)
  hojas = instalarSheetsFalsos({ FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS] });
  const sheetsAppend = global.SpreadsheetApp;
  global.SpreadsheetApp = {
    openById: (id) => {
      const ss = sheetsAppend.openById(id);
      return {
        getSheetByName: (n) => {
          const h = ss.getSheetByName(n);
          if (h && fallaHoja && n === 'FotosPozos') {
            return Object.assign(Object.create(h), { getRange: (...a) => { const r = h.getRange(...a); return Object.assign({}, r, { setValues: () => { throw new Error('Sheets rechazo la escritura'); } }); } });
          }
          return h;
        },
        insertSheet: ss.insertSheet
      };
    },
    flush: () => {}
  };

  // Padron y red NE
  global.registryRepository_getWellRecord = jest.fn((w) => ({ found: w === WELL }));
  global.nivelesEstaticosRepository_getPunto = jest.fn((id) => (id === 'INA 2055' ? { found: true, punto: { monitoringId: 'INA 2055', wellId: null } } : { found: false }));

  permisos = { fotos: true, fotos_carga: true };
  global.verifySessionToken.mockReturnValue({ valid: true, email: EMAIL });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => permisos[modulo] === true);
  global.getUserAccess.mockReturnValue({ active: true, nombre: 'Companero', permisos });
});

const post = (obj) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(obj) } }).text);
const cuerpoSubida = (extra) => {
  const { sandbox, enviados } = cargarFrontend();
  sandbox.apiSubirFotoPozo('tok', Object.assign({
    wellId: WELL, monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO',
    observacion: 'Boca del pozo', gps: { lat: -33.1, lon: -68.5 }, mimeType: 'image/jpeg', imagenBase64: IMG, thumbBase64: THUMB, sha1Original: SHA,
    procesamiento: 'JPEG_1600_Q72', tamanoOriginalBytes: 4200000
  }, extra || {}));
  return enviados[0].cuerpo;
};
const carpetaHija = (padre, nombre) => padre._c.find((c) => c._n === nombre);

describe('payload real del frontend', () => {
  test('accion y campos exactos de apiSubirFotoPozo (sin identidad: la pone la sesion)', () => {
    const c = cuerpoSubida();
    expect(c.action).toBe('subirFotoPozo');
    expect(Object.keys(c).sort()).toEqual(['action', 'fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fuente', 'gps', 'imagenBase64', 'mimeType', 'monitoringId', 'observacion', 'procesamiento', 'sessionToken', 'sha1Original', 'tamanoOriginalBytes', 'thumbBase64', 'tipoFoto', 'wellId']);
    expect(c.imagenBase64.startsWith('data:')).toBe(false);
    expect(JSON.stringify(c)).not.toMatch(/email|driveFileId/i);
  });

  test('las lecturas mandan exactamente la entidad / el id', () => {
    const { sandbox, enviados } = cargarFrontend();
    sandbox.apiGetFotosPozo('tok', WELL, '', 'recientes');
    sandbox.apiGetFotoPozo('tok', 'id', 'thumb');
    sandbox.apiGetResumenFotosPozos('tok');
    expect(enviados.map((e) => e.cuerpo.action)).toEqual(['getFotosPozo', 'getFotoPozo', 'getResumenFotosPozos']);
    expect(enviados[0].cuerpo).toEqual({ action: 'getFotosPozo', sessionToken: 'tok', wellId: WELL, monitoringId: '', orden: 'recientes' });
  });
});

describe('flujo completo con el codigo real', () => {
  test('subir -> listar -> miniatura -> completa -> resumen; queda en Drive privado, en FotosPozos/<fuente>/<anio>/<fotoId>.jpg', () => {
    const sube = post(cuerpoSubida());
    expect(sube.status).toBe('ok');
    const fotoId = sube.data.foto.fotoId;
    expect(sube.data.duplicada).toBe(false);

    // Drive: estructura y privacidad
    const anio = carpetaHija(carpetaHija(drive.raizPozos, 'CAMPO_APP'), '2026');
    expect(anio._a.map((a) => a._n).sort()).toEqual([fotoId + '.jpg', fotoId + '_thumb.jpg']);
    anio._a.forEach((a) => expect(a._share).toEqual(['P', 'N']));
    expect(drive.raizReemplazo._c).toHaveLength(0);

    // hoja
    expect(hojas.FotosPozos.filas).toHaveLength(2);
    const fila = hojas.FotosPozos.filas[1];
    const cols = hojas.FotosPozos.filas[0];
    const celda = (n) => fila[cols.indexOf(n)];
    expect(celda('wellId')).toBe(WELL);
    expect(celda('estadoVinculo')).toBe('CONFIRMADO');
    expect(celda('vinculoMetodo')).toBe('CAMPO_APP');
    expect(celda('gpsOrigen')).toBe('DISPOSITIVO_CARGA');
    expect(celda('emailUsuarioCarga')).toBe(EMAIL);
    expect(celda('ancho')).toBe(1600);
    expect(celda('driveThumbId')).toMatch(/^FILE_/);

    // lectura
    const lista = post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL, monitoringId: '' });
    expect(lista.data.total).toBe(1);
    expect(lista.data.fotos[0]).toEqual({
      fotoId, fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO',
      observacion: 'Boca del pozo', ancho: 1600, alto: 1200, tieneGps: true
    });
    const thumb = post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' });
    expect(thumb.data.imagenBase64).toBe(THUMB);
    const full = post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'full' });
    expect(full.data.imagenBase64).toBe(IMG);
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({ [WELL]: 1 });
  });

  test('NINGUNA respuesta contiene driveFileId, ids de Drive, email, sha1, coordenadas, URL ni secreto', () => {
    const sube = post(cuerpoSubida());
    const fotoId = sube.data.foto.fotoId;
    const respuestas = [
      sube,
      post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL }),
      post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' }),
      post({ action: 'getResumenFotosPozos', sessionToken: 't' })
    ];
    respuestas.forEach((r) => {
      const json = JSON.stringify(r);
      [SECRET, STORAGE_URL, 'script.google.com', 'FILE_', 'FOLDER_', 'driveFileId', 'driveThumbId', EMAIL, SHA, 'sha1', 'emailUsuarioCarga', '-33.1', '-68.5'].forEach((t) => expect(json).not.toContain(t));
    });
  });

  test('el backend principal no escribe base64, secreto ni ids en el log', () => {
    post(cuerpoSubida());
    const log = JSON.stringify(global.Logger.log.mock.calls) + JSON.stringify(global.logHistoryEvent.mock.calls);
    [SECRET, STORAGE_URL, IMG.substring(0, 40), 'FILE_'].forEach((t) => expect(log).not.toContain(t));
  });

  test('misma foto (mismo sha1) subida dos veces a la misma entidad: no se duplica en Drive ni en la hoja', () => {
    const a = post(cuerpoSubida());
    const archivosAntes = Object.keys(drive.archivos).length;
    const b = post(cuerpoSubida());
    expect(b.status).toBe('ok');
    expect(b.data.duplicada).toBe(true);
    expect(b.data.foto.fotoId).toBe(a.data.foto.fotoId);
    expect(Object.keys(drive.archivos)).toHaveLength(archivosAntes);
    expect(hojas.FotosPozos.filas).toHaveLength(2);
  });

  test('la misma foto en OTRA entidad si se sube (cada pozo tiene su galeria)', () => {
    post(cuerpoSubida());
    global.registryRepository_getWellRecord = jest.fn(() => ({ found: true }));
    const otra = post(cuerpoSubida({ wellId: '05-0001' }));
    expect(otra.data.duplicada).toBe(false);
    expect(hojas.FotosPozos.filas).toHaveLength(3);
  });

  test('un resumen cacheado se actualiza al subir (invalidacion)', () => {
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({});
    post(cuerpoSubida());
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({ [WELL]: 1 });
    post(cuerpoSubida({ sha1Original: 'cd'.repeat(20) }));
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({ [WELL]: 2 });
  });

  test('varias fotos: orden cronologico configurable (recientes por defecto)', () => {
    post(cuerpoSubida({ fechaFotoValor: '2024-01-10', sha1Original: '11'.repeat(20) }));
    post(cuerpoSubida({ fechaFotoValor: '2026-03-01', sha1Original: '22'.repeat(20) }));
    post(cuerpoSubida({ fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA', sha1Original: '33'.repeat(20) }));
    const fechas = (orden) => post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL, orden }).data.fotos.map((f) => f.fechaFotoValor);
    expect(fechas(undefined)).toEqual(['2026-03-01', '2024-01-10', '']);
    expect(fechas('antiguas')).toEqual(['2024-01-10', '2026-03-01', '']);
    expect(carpetaHija(drive.raizPozos, 'CAMPO_APP')._c.map((c) => c._n).sort()).toEqual(['2024', '2026', 'sin_fecha']);
  });

  test('punto NE especial (sin wellId): sube y lista por monitoringId; Historial lo registra', () => {
    const r = post(cuerpoSubida({ wellId: '', monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' }));
    expect(r.status).toBe('ok');
    expect(hojas.FotosPozos.filas[1][hojas.FotosPozos.filas[0].indexOf('monitoringId')]).toBe('INA 2055');
    expect(post({ action: 'getFotosPozo', sessionToken: 't', wellId: '', monitoringId: 'INA 2055' }).data.total).toBe(1);
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({ 'INA 2055': 1 });
    expect(carpetaHija(drive.raizPozos, 'MONITOREO_NE')).toBeTruthy();
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'subirFotoPozo', 'INA 2055', 'OK');
  });

  test('pozo inexistente: ENTIDAD_NOT_FOUND y no se crea nada en Drive ni en la hoja', () => {
    const r = post(cuerpoSubida({ wellId: '09-9999' }));
    expect(r.code).toBe('ENTIDAD_NOT_FOUND');
    expect(Object.keys(drive.archivos)).toHaveLength(0);
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('galeria vacia: lista vacia sin error (no revela si el pozo existe)', () => {
    expect(post({ action: 'getFotosPozo', sessionToken: 't', wellId: '09-9999' }).data).toEqual({ entidad: '09-9999', total: 0, fotos: [] });
  });
});

describe('permisos de punta a punta', () => {
  test('fotos_carga sin fotos: puede subir pero NO ve nada (galeria, imagen, resumen)', () => {
    permisos = { fotos: false, fotos_carga: true };
    global.getUserAccess.mockReturnValue({ active: true, permisos });
    const sube = post(cuerpoSubida());
    expect(sube.status).toBe('ok');
    const fotoId = sube.data.foto.fotoId;
    expect(post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL }).code).toBe('PERMISSION_DENIED');
    expect(post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' }).code).toBe('PERMISSION_DENIED');
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).code).toBe('PERMISSION_DENIED');
  });

  test('fotos sin fotos_carga: ve pero no sube (nada llega al storage)', () => {
    permisos = { fotos: true, fotos_carga: false };
    const r = post(cuerpoSubida());
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('sin ninguno (aunque tenga reemplazo): nada', () => {
    permisos = { reemplazo: true, ne: true, perfil: true, datos: true, ubicacion: true };
    expect(post(cuerpoSubida()).code).toBe('PERMISSION_DENIED');
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).code).toBe('PERMISSION_DENIED');
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
});

describe('fallas', () => {
  test('foto oculta (estado=OCULTA en la hoja): desaparece de la galeria, del resumen y de la imagen', () => {
    const fotoId = post(cuerpoSubida()).data.foto.fotoId;
    post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL });                    // calienta caches
    post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' });
    // un administrador la oculta a mano en la hoja
    const cols = hojas.FotosPozos.filas[0];
    hojas.FotosPozos.filas[1][cols.indexOf('estado')] = 'OCULTA';
    global.CacheService.getScriptCache().remove('fotospozos_resumen');
    global.CacheService.getScriptCache().remove('fotospozos_m_' + fotoId);                // vence el cache de ids (10 min)
    expect(post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL }).data.total).toBe(0);
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({});
    expect(post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' }).code).toBe('FOTO_NOT_FOUND');
    expect(post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'full' }).code).toBe('FOTO_NOT_FOUND');
  });

  test('foto POR_REVISAR (asociacion no confirmada): nunca se muestra', () => {
    const fotoId = post(cuerpoSubida()).data.foto.fotoId;
    const cols = hojas.FotosPozos.filas[0];
    hojas.FotosPozos.filas[1][cols.indexOf('estadoVinculo')] = 'POR_REVISAR';
    global.CacheService.getScriptCache().remove('fotospozos_resumen');
    global.CacheService.getScriptCache().remove('fotospozos_m_' + fotoId);
    expect(post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL }).data.total).toBe(0);
    expect(post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' }).code).toBe('FOTO_NOT_FOUND');
  });

  test('COMPENSACION real: si Sheets rechaza la escritura, el archivo y su miniatura van a la papelera del storage', () => {
    fallaHoja = true;
    const r = post(cuerpoSubida());
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(respuestasStorage).toEqual(['putFotoPozo', 'trashFotoPozo']);
    const archivos = Object.values(drive.archivos);
    expect(archivos).toHaveLength(2);
    archivos.forEach((a) => expect(a._t).toBe(true));
    expect(hojas.FotosPozos.filas).toHaveLength(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'subirFotoPozo', WELL, 'SERVICE_UNAVAILABLE');
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({});
  });

  test('storage caido (HTTP 500): STORAGE_UNAVAILABLE, sin fila, el log no filtra la URL', () => {
    global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 500, getContentText: () => 'x' });
    const r = post(cuerpoSubida());
    expect(r.code).toBe('STORAGE_UNAVAILABLE');
    expect(hojas.FotosPozos.filas).toHaveLength(1);
    expect(JSON.stringify(global.Logger.log.mock.calls)).not.toContain('STORAGE_E2E_SECRETA');
    expect(JSON.stringify(r)).not.toContain('STORAGE_E2E_SECRETA');
  });

  test('storage con secreto desfasado (rota el secreto solo en un lado): STORAGE_UNAVAILABLE', () => {
    global.getStorageSecret = () => 'z'.repeat(48);
    expect(post(cuerpoSubida()).code).toBe('STORAGE_UNAVAILABLE');
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('si falta la raiz de pozos en el storage (setup sin correr): STORAGE_UNAVAILABLE, nada queda a medias', () => {
    global.getStoragePozosRootFolderId = () => { throw new Error('FOTOS_POZOS_ROOT_FOLDER_ID no configurado'); };
    expect(post(cuerpoSubida()).code).toBe('STORAGE_UNAVAILABLE');
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('si la hoja FotosPozos no existe (setup sin correr): SERVICE_UNAVAILABLE claro; las lecturas tampoco rompen la app', () => {
    delete hojas.FotosPozos;
    const lectura = post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL });
    expect(lectura.code).toBe('SERVICE_UNAVAILABLE');
    expect(lectura.message).toMatch(/setupFotosPozosSheet/);
  });
});

describe('aislamiento respecto de FotosReemplazo', () => {
  test('una foto de la galeria general no se sirve por getFotoReemplazo ni viceversa', () => {
    permisos = { fotos: true, fotos_carga: true, reemplazo: true };
    const fotoId = post(cuerpoSubida()).data.foto.fotoId;
    const r = post({ action: 'getFotoReemplazo', sessionToken: 't', fotoId, variante: 'thumb' });
    expect(r.code).toBe('FOTO_NOT_FOUND');
  });

  test('subir a la galeria general no toca la raiz de Reemplazos ni su hoja', () => {
    post(cuerpoSubida());
    expect(drive.raizReemplazo._c).toHaveLength(0);
    expect(respuestasStorage.every((a) => /Pozo$/.test(a))).toBe(true);
  });
});

describe('revision de seguridad (aprobacion de FotosPozos v1)', () => {
  const columna = (n) => hojas.FotosPozos.filas[0].indexOf(n);

  test('el GPS de la carga queda como evidencia de la foto y NO toca coordenadas oficiales: el codigo de fotos solo LEE padron y red NE', () => {
    expect(post(cuerpoSubida({ gps: { lat: -33.987654, lon: -68.123456 } })).status).toBe('ok');
    const fila = hojas.FotosPozos.filas[1];
    expect(fila[columna('gpsLat')]).toBe(-33.987654);
    expect(fila[columna('gpsLon')]).toBe(-68.123456);
    expect(fila[columna('gpsOrigen')]).toBe('DISPOSITIVO_CARGA');
    // unica hoja que existe/se escribio: FotosPozos (la del padron/NE ni se abre)
    expect(Object.keys(hojas)).toEqual(['FotosPozos']);
    // las unicas funciones externas de padron/red NE que el servicio puede llamar son las de LECTURA
    const src = ['FotosPozosService.js', 'FotosPozosRepository.js'].map((f) => fs.readFileSync(path.join(ROOT, 'backend/src', f), 'utf8')).join('\n');
    const externas = new Set(src.match(/\b(?:registry|nivelesEstaticos|mapa|mapaNE|ubicacion|location|well)\w*(?:Repository|Service)_\w+/g) || []);
    expect([...externas].sort()).toEqual(['nivelesEstaticosRepository_getPunto', 'registryRepository_getWellRecord']);
    expect(global.registryRepository_getWellRecord).toHaveBeenCalled();
  });

  test('las coordenadas de la foto nunca vuelven al frontend (solo tieneGps)', () => {
    post(cuerpoSubida({ gps: { lat: -33.987654, lon: -68.123456 } }));
    const lista = post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL });
    expect(lista.data.fotos[0].tieneGps).toBe(true);
    expect(JSON.stringify(lista)).not.toMatch(/33\.98|68\.12|gpsLat|gpsLon/);
  });

  test('un wellId o un monitoringId inventado se rechaza y no escribe nada', () => {
    ['09-9999', '99-0001', '00-0000'].forEach((w) => {
      expect(post(cuerpoSubida({ wellId: w })).code).toMatch(/^(ENTIDAD_NOT_FOUND|INVALID_ENTIDAD)$/);
    });
    ['INA 9999', 'FANTASMA', 'X'.repeat(20)].forEach((m) => {
      expect(post(cuerpoSubida({ wellId: '', monitoringId: m, fuente: 'MONITOREO_NE' })).code).toMatch(/^(ENTIDAD_NOT_FOUND|INVALID_ENTIDAD)$/);
    });
    expect(Object.keys(drive.archivos)).toHaveLength(0);
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('wellId y monitoringId a la vez (entidad ambigua) se rechaza: no se puede forzar otra entidad', () => {
    const r = post(cuerpoSubida({ wellId: WELL, monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' }));
    expect(r.status).toBe('error');
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('una carga normal no puede hacerse pasar por una fuente historica ni inventar otra', () => {
    ['RELEVAMIENTO_2018', 'CAMPO_APP_2', 'campo_app', '../MONITOREO_NE', 'MONITOREO_NE '].forEach((f) => {
      expect(post(cuerpoSubida({ fuente: f })).code).toBe('INVALID_FUENTE');
    });
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('el cliente no puede fijar estado, estadoVinculo, vinculoMetodo, lote, origen de GPS ni email: la carga siempre es ACTIVA/CONFIRMADO/CAMPO_APP', () => {
    const c = cuerpoSubida();
    Object.assign(c, { estado: 'OCULTA', estadoVinculo: 'POR_REVISAR', vinculoMetodo: 'NOMBRE_ARCHIVO', loteImportacion: 'X', gpsOrigen: 'EXIF_ORIGINAL', emailUsuarioCarga: 'otro@x.com', driveFileId: 'AAA' });
    expect(post(c).status).toBe('ok');
    const f = hojas.FotosPozos.filas[1];
    expect(f[columna('estado')]).toBe('ACTIVA');
    expect(f[columna('estadoVinculo')]).toBe('CONFIRMADO');
    expect(f[columna('vinculoMetodo')]).toBe('CAMPO_APP');
    expect(f[columna('loteImportacion')]).toBe('');
    expect(f[columna('gpsOrigen')]).toBe('DISPOSITIVO_CARGA');
    expect(f[columna('emailUsuarioCarga')]).toBe(EMAIL);
    expect(f[columna('driveFileId')]).not.toBe('AAA');
  });

  test('resumen y galeria cuentan SOLO ACTIVA + CONFIRMADO (ocultas y por revisar nunca)', () => {
    const hex = ['1', '2', '3', '4'].map((d) => d.repeat(40).replace(/[34]/g, 'a'));
    const ids = [0, 1, 2, 3].map((i) => post(cuerpoSubida({ imagenBase64: jpegB64(1600, 1200, 300 * 1024, 20 + i), sha1Original: hex[i].slice(0, 39) + String(i) })).data.foto.fotoId);
    const fila = (id) => hojas.FotosPozos.filas.find((f, i) => i > 0 && f[columna('fotoId')] === id);
    fila(ids[1])[columna('estado')] = 'OCULTA';
    fila(ids[2])[columna('estadoVinculo')] = 'POR_REVISAR';
    fila(ids[3])[columna('estado')] = 'OCULTA';
    fila(ids[3])[columna('estadoVinculo')] = 'POR_REVISAR';
    const lista = post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL });
    expect(lista.data.fotos.map((f) => f.fotoId)).toEqual([ids[0]]);
    expect(post({ action: 'getResumenFotosPozos', sessionToken: 't' }).data).toEqual({ [WELL]: 1 });
    [ids[1], ids[2], ids[3]].forEach((id) => {
      expect(post({ action: 'getFotoPozo', sessionToken: 't', fotoId: id, variante: 'full' }).code).toBe('FOTO_NOT_FOUND');
    });
  });

  test('auditoria: las lecturas exitosas NO escriben en Historial; la carga exitosa deja una sola fila minima', () => {
    const sube = post(cuerpoSubida());
    expect(sube.status).toBe('ok');
    global.logHistoryEvent.mockClear();
    const fotoId = sube.data.foto.fotoId;
    post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL });
    post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' });
    post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'full' });
    post({ action: 'getResumenFotosPozos', sessionToken: 't' });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    post(cuerpoSubida({ imagenBase64: jpegB64(1600, 1200, 300 * 1024, 77), sha1Original: 'cd'.repeat(20) }));
    expect(global.logHistoryEvent).toHaveBeenCalledTimes(1);
    expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'subirFotoPozo', WELL, 'OK');
  });

  test('ninguna respuesta de ninguna accion lleva driveFileId, driveThumbId, email, sha1, URL del storage ni secreto (incluidos los errores)', () => {
    const respuestas = [];
    respuestas.push(post(cuerpoSubida()));
    const fotoId = respuestas[0].data.foto.fotoId;
    respuestas.push(post(cuerpoSubida()));                                              // duplicada
    respuestas.push(post(cuerpoSubida({ wellId: '09-9999' })));                         // entidad inexistente
    respuestas.push(post({ action: 'getFotosPozo', sessionToken: 't', wellId: WELL }));
    respuestas.push(post({ action: 'getFotoPozo', sessionToken: 't', fotoId, variante: 'thumb' }));
    respuestas.push(post({ action: 'getFotoPozo', sessionToken: 't', fotoId: 'no-existe', variante: 'thumb' }));
    respuestas.push(post({ action: 'getResumenFotosPozos', sessionToken: 't' }));
    const filaDrive = hojas.FotosPozos.filas[1];
    const idsDrive = [filaDrive[columna('driveFileId')], filaDrive[columna('driveThumbId')]];
    const texto = JSON.stringify(respuestas).replace(/"imagenBase64":"[^"]*"/g, '"imagenBase64":"..."');
    idsDrive.forEach((id) => { expect(id).toBeTruthy(); expect(texto).not.toContain(id); });
    expect(texto).not.toContain(EMAIL);
    expect(texto).not.toContain(SHA);
    expect(texto).not.toContain('STORAGE_E2E_SECRETA');
    expect(texto).not.toContain(SECRET);
    expect(texto).not.toMatch(/driveFileId|driveThumbId|emailUsuarioCarga|sha1Original/);
  });
});

// =====================================================================================================
// "Fotos del pozo > Agregar foto" es la galeria general FotosPozos (subirFotoPozo): NO usa evaluaciones. Una foto de esta
// pantalla pertenece a un POZO (wellId) o a un punto NE especial (monitoringId), nunca a una evaluacion. Aca se fija que
// el flujo no depende de FotosReemplazo y que cada causa de fallo tiene su codigo: STORAGE_UNAVAILABLE solo si falla la
// llamada al storage (y el log dice POR QUE).
describe('flujo "Fotos del pozo > Agregar foto" (FotosPozos): sin evaluaciones y con un codigo por causa', () => {
  const Diag = () => require('../src/FotosDiagnostico');
  const lineasLog = () => global.Logger.log.mock.calls.map((c) => String(c[0]));
  const frontend = () => {
    const sandbox = { JSON, Object, Promise, Math, String, Number, Array };
    vm.createContext(sandbox);
    ['js/reemplazoFotosLogic.js', 'js/fotosPozosLogic.js'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }));
    return sandbox;
  };
  const firmadoDelStorage = (solicitudCrudo, datos) => {
    const A = require('../../storage/src/StorageAuth');
    const sol = JSON.parse(solicitudCrudo);
    return JSON.stringify(A.storageAuth_firmarRespuesta(SECRET, sol.nonce, datos, Math.floor(Date.now() / 1000)));
  };
  const modos = {
    'la Web App desplegada del storage no tiene la accion putFotoPozo (version vieja)': {
      aplicar: () => global.UrlFetchApp.fetch.mockImplementation((u, o) => ({ getResponseCode: () => 200, getContentText: () => firmadoDelStorage(o.payload, { status: 'error', code: 'UNKNOWN_ACTION' }) })),
      log: /UNKNOWN_ACTION/, pista: /NUEVA VERSION/
    },
    'falta correr setupFotosPozosStorage (no existe FOTOS_POZOS_ROOT_FOLDER_ID)': {
      aplicar: () => { global.getStoragePozosRootFolderId = () => { throw new Error('FOTOS_POZOS_ROOT_FOLDER_ID no configurado'); }; },
      log: /RESPUESTA_SIN_FIRMA \(el storage dijo INTERNAL\)/, pista: /setupFotosPozosStorage/
    },
    'el secreto del storage no coincide': {
      aplicar: () => { global.getStorageSecret = () => 'otro-secreto-distinto-0123456789abcdef0123'; },
      log: /RESPUESTA_SIN_FIRMA \(el storage dijo UNAUTHORIZED\)/, pista: /secreto/
    },
    'la plataforma responde HTTP 500': {
      aplicar: () => global.UrlFetchApp.fetch.mockImplementation(() => ({ getResponseCode: () => 500, getContentText: () => 'Error interno' })),
      log: /storage HTTP 500/, pista: /HTTP/
    }
  };

  describe('no depende de evaluaciones ni de FotosReemplazo', () => {
    test('el payload real de "Agregar foto" no lleva evaluacionId; si alguien lo inyectara el backend lo ignora y no consulta evaluaciones', () => {
      global.reemplazoRepository_buscarPorEvaluacionId = jest.fn();
      global.fotosRepository_agregarSiHayCupo = jest.fn();
      global.fotosRepository_contarPorEvaluacionId = jest.fn();
      const c = cuerpoSubida();
      expect(Object.keys(c)).not.toContain('evaluacionId');
      const r = post(Object.assign({}, c, { evaluacionId: '11111111-2222-4333-8444-555555555555' }));
      expect(r.status).toBe('ok');
      expect(global.reemplazoRepository_buscarPorEvaluacionId).not.toHaveBeenCalled();
      expect(global.fotosRepository_agregarSiHayCupo).not.toHaveBeenCalled();
      expect(global.fotosRepository_contarPorEvaluacionId).not.toHaveBeenCalled();
      expect(Repo_columnas()).not.toContain('evaluacionId');
    });

    test('un pozo SIN ninguna evaluacion recibe su foto: queda en FotosPozos asociada al wellId (no huerfana)', () => {
      const r = post(cuerpoSubida());
      expect(r.status).toBe('ok');
      expect(hojas.FotosPozos.filas).toHaveLength(2);
      expect(hojas.FotosPozos.filas[1][hojas.FotosPozos.filas[0].indexOf('wellId')]).toBe(WELL);
    });

    test('el limite de 5 fotos y la asociacion a evaluacion NO existen en esta galeria (7 fotos seguidas al mismo pozo)', () => {
      for (let i = 0; i < 7; i++) {
        const c = cuerpoSubida({ imagenBase64: jpegB64(1600, 1200, 300 * 1024, 40 + i), sha1Original: String(i).padStart(2, '0').repeat(20) });
        expect(post(c).status).toBe('ok');
      }
      expect(hojas.FotosPozos.filas).toHaveLength(8);
    });

    test('la accion no existe como ruta de FotosReemplazo: subirFotoReemplazo y subirFotoPozo son rutas, tablas y permisos distintos', () => {
      permisos = { fotos: false, fotos_carga: true, reemplazo: false };
      expect(post(cuerpoSubida()).status).toBe('ok');                       // basta fotos_carga
      const rr = post({ action: 'subirFotoReemplazo', sessionToken: 't', wellId: WELL, evaluacionId: '11111111-2222-4333-8444-555555555555', nombreArchivo: 'foto.jpg', mimeType: 'image/jpeg', imagenBase64: IMG, thumbBase64: THUMB });
      expect(rr.code).toBe('PERMISSION_DENIED');                            // reemplazo=NO
    });
  });

  describe('cada fallo tiene su codigo; STORAGE_UNAVAILABLE solo cuando falla el storage', () => {
    test.each(Object.keys(modos))('storage: %s -> STORAGE_UNAVAILABLE, sin fila ni archivo, auditado, y el log dice la causa', (nombre) => {
      modos[nombre].aplicar();
      const r = post(cuerpoSubida());
      expect(r.code).toBe('STORAGE_UNAVAILABLE');
      expect(hojas.FotosPozos.filas).toHaveLength(1);
      expect(Object.keys(drive.archivos)).toHaveLength(0);
      expect(global.logHistoryEvent).toHaveBeenCalledWith(EMAIL, 'subirFotoPozo', WELL, 'STORAGE_UNAVAILABLE');
      const l = lineasLog().filter((x) => x.includes('Storage de fotos no disponible'));
      expect(l).toHaveLength(1);
      expect(l[0]).toMatch(modos[nombre].log);
      expect(l[0]).not.toContain('STORAGE_E2E');
      expect(l[0]).not.toContain(SECRET);
    });

    test('pozo inexistente: ENTIDAD_NOT_FOUND (no STORAGE_UNAVAILABLE) y sin llamar al storage', () => {
      const r = post(cuerpoSubida({ wellId: '09-9999' }));
      expect(r.code).toBe('ENTIDAD_NOT_FOUND');
      expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    });

    test('entidad ambigua / mal formada / fuente o fecha invalida: su propio codigo, sin storage', () => {
      const casos = [
        [{ wellId: WELL, monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' }, 'ENTIDAD_INCONSISTENTE'],
        [{ wellId: '', monitoringId: '' }, 'INVALID_ENTIDAD'],
        [{ wellId: 'xx-1' }, 'INVALID_ENTIDAD'],
        [{ fuente: 'RELEVAMIENTO_2018' }, 'INVALID_FUENTE'],
        [{ fechaFotoValor: '2999-01-01' }, 'INVALID_FECHA'],
        [{ tipoFoto: 'X' }, 'INVALID_TIPO'],
        [{ observacion: 'a'.repeat(141) }, 'INVALID_OBSERVACION'],
        [{ mimeType: 'image/png' }, 'INVALID_MIME']
      ];
      casos.forEach(([extra, codigo]) => {
        expect(post(cuerpoSubida(extra)).code).toBe(codigo);
      });
      expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
    });

    test('sin permiso fotos_carga: PERMISSION_DENIED; sin la hoja FotosPozos: SERVICE_UNAVAILABLE (no STORAGE) y sin subir nada', () => {
      permisos = { fotos: true, fotos_carga: false };
      expect(post(cuerpoSubida()).code).toBe('PERMISSION_DENIED');
      permisos = { fotos: true, fotos_carga: true };
      delete hojas.FotosPozos;
      const r = post(cuerpoSubida());
      expect(r.code).toBe('SERVICE_UNAVAILABLE');
      expect(Object.keys(drive.archivos)).toHaveLength(0);
    });

    test('si el storage guarda pero la hoja falla: SERVICE_UNAVAILABLE y el archivo se manda a la papelera (sin huerfanas)', () => {
      fallaHoja = true;
      const r = post(cuerpoSubida());
      expect(r.code).toBe('SERVICE_UNAVAILABLE');
      expect(Object.values(drive.archivos).every((a) => a._t)).toBe(true);
    });

    test('el frontend de "Fotos del pozo" muestra un mensaje DISTINTO por cada causa', () => {
      const f = frontend();
      const codigos = ['STORAGE_UNAVAILABLE', 'ENTIDAD_NOT_FOUND', 'INVALID_ENTIDAD', 'SERVICE_UNAVAILABLE', 'PERMISSION_DENIED', 'INVALID_FUENTE', 'INVALID_FECHA'];
      const mensajes = codigos.map((c) => f.fotosPozosLogic_mensajeError(c));
      expect(mensajes.every((m) => typeof m === 'string' && m.length > 5)).toBe(true);
      expect(f.fotosPozosLogic_mensajeError('STORAGE_UNAVAILABLE')).toMatch(/almacenamiento/);
      expect(f.fotosPozosLogic_mensajeError('ENTIDAD_NOT_FOUND')).toMatch(/ya no existe/);
      expect(f.fotosPozosLogic_mensajeError('ENTIDAD_NOT_FOUND')).not.toMatch(/almacenamiento/);
      expect(new Set([f.fotosPozosLogic_mensajeError('STORAGE_UNAVAILABLE'), f.fotosPozosLogic_mensajeError('ENTIDAD_NOT_FOUND'), f.fotosPozosLogic_mensajeError('PERMISSION_DENIED'), f.fotosPozosLogic_mensajeError('SERVICE_UNAVAILABLE')]).size).toBe(4);
    });
  });

  describe('diagnosticarFotosPozos() (se corre a mano en el editor): dice la causa exacta de un STORAGE_UNAVAILABLE', () => {
    test('storage sano: todo OK, la foto de prueba se manda a la papelera y NO se escribe ninguna fila', () => {
      Diag().diagnosticarFotosPozos();
      const l = lineasLog().join('\n');
      expect(l).toContain('DIAGNOSTICO COMPLETO');
      expect(l).not.toMatch(/FALLA/);
      expect(hojas.FotosPozos.filas).toHaveLength(1);
      const archivos = Object.values(drive.archivos);
      expect(archivos).toHaveLength(2);
      expect(archivos.every((a) => a._t)).toBe(true);
      expect(l).not.toContain(SECRET);
    });

    test.each(Object.keys(modos))('%s: el diagnostico muestra el motivo exacto y la pista', (nombre) => {
      modos[nombre].aplicar();
      Diag().diagnosticarFotosPozos();
      const falla = lineasLog().find((x) => x.startsWith('FALLA 1) putFotoPozo'));
      expect(falla).toBeTruthy();
      expect(falla).toMatch(modos[nombre].log);
      expect(falla).toMatch(modos[nombre].pista);
      expect(lineasLog().join('\n')).toContain('DIAGNOSTICO CON FALLAS');
      expect(hojas.FotosPozos.filas).toHaveLength(1);
      const todo = lineasLog().join('\n');
      expect(todo).not.toContain(SECRET);
      expect(todo).not.toContain('STORAGE_E2E');
    });

    test('pistas: una por causa tipica y vacia si no hay nada que sugerir', () => {
      const p = Diag().fotosDiagnostico_pista;
      expect(p('RESPUESTA_SIN_FIRMA (el storage dijo UNAUTHORIZED)')).toMatch(/secreto/);
      expect(p('storage devolvio error: UNKNOWN_ACTION')).toMatch(/NUEVA VERSION/);
      expect(p('RESPUESTA_SIN_FIRMA (el storage dijo INTERNAL)')).toMatch(/setupFotosPozosStorage/);
      expect(p('storage HTTP 404')).toMatch(/HTTP/);
      expect(p('storage devolvio error: INVALID_IMAGEN')).toMatch(/contenido/);
      expect(p('algo raro')).toBe('');
    });

    test('el diagnostico no es una accion de la API (doPost no puede ejecutarlo)', () => {
      const r = post({ action: 'diagnosticarFotosPozos', sessionToken: 't' });
      expect(r.status).toBe('error');
      expect(fs.readFileSync(path.join(ROOT, 'backend/src/Api.js'), 'utf8')).not.toMatch(/diagnosticarFotosPozos/);
    });
  });
});

function Repo_columnas() {
  return require('../src/FotosPozosRepository').FOTOS_POZOS_COLUMNAS;
}
