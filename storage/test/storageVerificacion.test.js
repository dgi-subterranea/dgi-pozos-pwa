// Tests de la verificacion MANUAL del storage (storage/src/StorageVerificacion.js): verificarRaicesStorage y smokeItfStorage. Drive en memoria,
// sin tocar Google. Ademas del camino sano se INYECTAN fallas en el storage (aislamiento roto, HMAC flojo, PNG aceptado en Fotos...) y se comprueba que
// el smoke las DETECTA, que limpia siempre lo que creo y que nunca toca lo que ya existia.
const crypto = require('crypto');

const SECRET = 's'.repeat(40);
const ROOT_ID = 'ROOT_REEMPLAZOS_0001';
const POZOS_ROOT_ID = 'ROOT_POZOS_0000001';
const ITF_ROOT_ID = 'ROOT_ITF_00000001';

let seq;
function nuevoId(prefijo) {
  seq += 1;
  return prefijo + '_' + String(seq).padStart(14, '0');
}

function iterador(lista) {
  let i = 0;
  return { hasNext: () => i < lista.length, next: () => lista[i++] };
}

function crearDrive() {
  const archivos = {};
  const carpetas = {};

  function crearCarpeta(nombre, padre, id) {
    const f = {
      _id: id || nuevoId('FOLDER'), _nombre: nombre, _padre: padre, _hijosCarpetas: [], _hijosArchivos: [], _papelera: false,
      getId() { return this._id; },
      getName() { return this._nombre; },
      isTrashed() { return this._papelera; },
      setTrashed(v) { this._papelera = v; },
      getParents() { return iterador(this._padre ? [this._padre] : []); },
      getFoldersByName(n) { return iterador(this._hijosCarpetas.filter((c) => c._nombre === n && !c._papelera)); },
      getFolders() { return iterador(this._hijosCarpetas.filter((c) => !c._papelera)); },
      createFolder(n) { const c = crearCarpeta(n, this); this._hijosCarpetas.push(c); return c; },
      getFilesByName(n) { return iterador(this._hijosArchivos.filter((a) => a._nombre === n && !a._papelera)); },
      getFiles() { return iterador(this._hijosArchivos.filter((a) => !a._papelera)); },
      createFile(blob) {
        const a = {
          _id: nuevoId('FILE'), _nombre: blob.nombre, _bytes: blob.bytes, _mime: blob.mime, _padre: this, _desc: '', _papelera: false,
          getId() { return this._id; },
          getName() { return this._nombre; },
          getSize() { return this._bytes.length; },
          getParents() { return iterador([this._padre]); },
          setDescription(d) { this._desc = d; },
          getDescription() { return this._desc; },
          setSharing() {},
          isTrashed() { return this._papelera; },
          getBlob() { const self = this; return { getContentType: () => self._mime, getBytes: () => self._bytes }; },
          setTrashed(v) { this._papelera = v; }
        };
        archivos[a._id] = a;
        this._hijosArchivos.push(a);
        return a;
      }
    };
    carpetas[f._id] = f;
    if (padre) { padre._hijosCarpetas.push(f); }
    return f;
  }

  const miUnidad = crearCarpeta('Mi unidad', null, 'MI_UNIDAD_0000001');
  const raizReemplazos = crearCarpeta('FotosReemplazo', miUnidad, ROOT_ID);
  const raizPozos = crearCarpeta('FotosPozos', miUnidad, POZOS_ROOT_ID);
  const raizItf = crearCarpeta('ItfPropuestas', miUnidad, ITF_ROOT_ID);
  // Contenido que YA existia: el smoke no puede tocarlo.
  const carpetaAjena = crearCarpeta('PrivadoDeLaCuenta', miUnidad);
  const archivoAjeno = carpetaAjena.createFile({ nombre: 'secreto.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 1]), mime: 'image/jpeg' });
  const anioReemplazos = crearCarpeta(String(new Date().getFullYear()), raizReemplazos);
  const archivoReemplazosPrevio = anioReemplazos.createFile({ nombre: 'previo.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 2]), mime: 'image/jpeg' });

  return {
    miUnidad, raizReemplazos, raizPozos, raizItf, carpetaAjena, archivoAjeno, anioReemplazos, archivoReemplazosPrevio, archivos, carpetas, crearCarpeta,
    DriveApp: {
      Access: { PRIVATE: 'PRIVATE' }, Permission: { NONE: 'NONE' },
      getRootFolder: () => miUnidad,
      getFolderById: (id) => { if (!carpetas[id]) { throw new Error('no existe'); } return carpetas[id]; },
      getFileById: (id) => { if (!archivos[id]) { throw new Error('no existe'); } return archivos[id]; }
    }
  };
}

let props;
let logs;
let drive;
let cacheStore;
let Auth;
let Dr;
let Api;
let Verif;

function instalarGlobals() {
  cacheStore = {};
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
  global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null) }) };
  global.Logger = { log: (m) => { logs.push(String(m)); } };
  function requerida(clave) {
    return () => { if (!props[clave]) { throw new Error(clave + ' no configurado'); } return props[clave]; };
  }
  global.getStorageSecret = requerida('FOTOS_STORAGE_SECRET');
  global.getStorageRootFolderId = requerida('FOTOS_ROOT_FOLDER_ID');
  global.getStoragePozosRootFolderId = requerida('FOTOS_POZOS_ROOT_FOLDER_ID');
  global.getStorageItfRootFolderId = requerida('ITF_ROOT_FOLDER_ID');
  // En Apps Script estas constantes viven en el scope global compartido (StorageAuth / StorageConfig); en Jest hay que publicarlas.
  global.STORAGE_AUTH_VERSION = 'v1';
  global.STORAGE_SECRET_MIN_LENGTH = 32;
}

beforeEach(() => {
  jest.resetModules();
  seq = 0;
  logs = [];
  drive = crearDrive();
  props = {
    FOTOS_STORAGE_SECRET: SECRET,
    FOTOS_ROOT_FOLDER_ID: ROOT_ID,
    FOTOS_POZOS_ROOT_FOLDER_ID: POZOS_ROOT_ID,
    ITF_ROOT_FOLDER_ID: ITF_ROOT_ID
  };
  instalarGlobals();
  global.DriveApp = drive.DriveApp;
  Auth = require('../src/StorageAuth');
  Dr = require('../src/StorageDrive');
  Api = require('../src/StorageApi');
  Verif = require('../src/StorageVerificacion');
  Object.assign(global, Auth, Dr, Api, Verif);
});

afterEach(() => {
  ['storageAuth_firmarRespuesta', 'storageDrive_getItf', 'storageDrive_metaItf', 'storageDrive_trashItf', 'storageDrive_putItf', 'storageDrive_getFoto', 'storageDrive_trashFoto', 'storageDrive_putFoto',
    'storageDrive_putFotoPozo', 'storageDrive_trashFotoPozo', 'storageDrive_getFotoPozo', 'storageAuth_verificarSolicitud'].forEach((n) => { delete global[n]; });
});

const fallas = (inf) => inf.checks.filter((c) => !c.ok).map((c) => c.nombre);
const hayFalla = (inf, texto) => fallas(inf).some((n) => n.indexOf(texto) >= 0);
const idsDelDrive = () => Object.keys(drive.archivos).concat(Object.keys(drive.carpetas));

function snapshotPrevio() {
  return { archivos: Object.keys(drive.archivos), carpetas: Object.keys(drive.carpetas) };
}

function verifVacia(carpeta) {
  return !carpeta.getFiles().hasNext() && !carpeta.getFolders().hasNext();
}

// Todo lo que NO estaba antes del smoke tiene que estar en la papelera, y lo que estaba tiene que seguir igual.
function verificarLimpieza(previo) {
  const nuevosArchivos = Object.keys(drive.archivos).filter((id) => previo.archivos.indexOf(id) < 0);
  const nuevasCarpetas = Object.keys(drive.carpetas).filter((id) => previo.carpetas.indexOf(id) < 0);
  nuevosArchivos.forEach((id) => expect(drive.archivos[id]._papelera).toBe(true));
  // Una carpeta nueva queda retirada si ella o algun ancestro esta en la papelera (en Drive, la papelera de la carpeta arrastra a sus hijas). Unica excepcion
  // permitida: la carpeta del anio dentro de la raiz ITF (ItfPropuestas/<anio>), que es la carpeta normal de produccion y queda VACIA.
  nuevasCarpetas.forEach((id) => {
    const c = drive.carpetas[id];
    if (c._padre === drive.raizItf) {
      expect(verifVacia(c)).toBe(true);
      return;
    }
    let retirada = false;
    for (let x = c; x; x = x._padre) { retirada = retirada || x._papelera; }
    // o bien retirada, o bien una subcarpeta VACIA dentro de una carpeta que ya existia (no se toca lo que no es del smoke)
    expect(retirada || (verifVacia(c) && previo.carpetas.indexOf(c._padre._id) >= 0)).toBe(true);
  });
  previo.archivos.forEach((id) => expect(drive.archivos[id]._papelera).toBe(false));
  previo.carpetas.forEach((id) => expect(drive.carpetas[id]._papelera).toBe(false));
  expect(drive.raizItf.getFiles().hasNext()).toBe(false);
  return { nuevosArchivos, nuevasCarpetas };
}

describe('verificarRaicesStorage', () => {
  test('configuracion sana: todo OK', () => {
    const inf = Verif.verificarRaicesStorage();
    expect(inf.ok).toBe(true);
    expect(fallas(inf)).toEqual([]);
    expect(inf.checks.map((c) => c.nombre)).toEqual(expect.arrayContaining([
      expect.stringMatching(/secreto HMAC configurado/),
      'FOTOS_ROOT_FOLDER_ID configurada', 'FOTOS_POZOS_ROOT_FOLDER_ID configurada', 'ITF_ROOT_FOLDER_ID configurada',
      'raiz Reemplazos accesible', 'raiz Pozos accesible', 'raiz ITF accesible',
      'raiz ITF se llama ItfPropuestas', 'raiz ITF fuera de la papelera',
      expect.stringMatching(/DISTINTAS/), 'ninguna raiz cuelga de otra'
    ]));
    expect(logs).toContain('VERIFICACION DE RAICES: OK');
  });

  test('es de SOLO LECTURA: no crea, modifica ni manda a la papelera nada', () => {
    const previo = snapshotPrevio();
    const nombres = previo.carpetas.map((id) => drive.carpetas[id]._nombre);
    Verif.verificarRaicesStorage();
    expect(idsDelDrive().length).toBe(previo.archivos.length + previo.carpetas.length);
    expect(previo.carpetas.map((id) => drive.carpetas[id]._nombre)).toEqual(nombres);
    previo.archivos.forEach((id) => expect(drive.archivos[id]._papelera).toBe(false));
    previo.carpetas.forEach((id) => expect(drive.carpetas[id]._papelera).toBe(false));
  });

  test.each([
    ['ITF_ROOT_FOLDER_ID', 'ITF_ROOT_FOLDER_ID configurada'],
    ['FOTOS_ROOT_FOLDER_ID', 'FOTOS_ROOT_FOLDER_ID configurada'],
    ['FOTOS_POZOS_ROOT_FOLDER_ID', 'FOTOS_POZOS_ROOT_FOLDER_ID configurada']
  ])('falta %s -> FALLA', (clave, nombre) => {
    delete props[clave];
    const inf = Verif.verificarRaicesStorage();
    expect(inf.ok).toBe(false);
    expect(fallas(inf)).toContain(nombre);
    expect(hayFalla(inf, 'DISTINTAS')).toBe(true);
  });

  test('secreto ausente o corto -> FALLA', () => {
    props.FOTOS_STORAGE_SECRET = 'corto';
    expect(hayFalla(Verif.verificarRaicesStorage(), 'secreto HMAC configurado')).toBe(true);
    delete props.FOTOS_STORAGE_SECRET;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'secreto HMAC configurado')).toBe(true);
  });

  test('id configurado que no es una carpeta accesible -> FALLA', () => {
    props.ITF_ROOT_FOLDER_ID = 'NO_EXISTE_EN_DRIVE_0001';
    const inf = Verif.verificarRaicesStorage();
    expect(fallas(inf)).toContain('raiz ITF accesible');
    expect(hayFalla(inf, 'ninguna raiz cuelga de otra')).toBe(true);
  });

  test('la raiz ITF es la MISMA carpeta que otra raiz -> FALLA (distintas)', () => {
    props.ITF_ROOT_FOLDER_ID = POZOS_ROOT_ID;
    const inf = Verif.verificarRaicesStorage();
    expect(hayFalla(inf, 'DISTINTAS')).toBe(true);
    props.ITF_ROOT_FOLDER_ID = ITF_ROOT_ID;
    props.FOTOS_ROOT_FOLDER_ID = POZOS_ROOT_ID;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'DISTINTAS')).toBe(true);
    props.FOTOS_ROOT_FOLDER_ID = ROOT_ID;
    props.FOTOS_POZOS_ROOT_FOLDER_ID = ITF_ROOT_ID;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'DISTINTAS')).toBe(true);
    props.FOTOS_POZOS_ROOT_FOLDER_ID = POZOS_ROOT_ID;
    props.FOTOS_ROOT_FOLDER_ID = ITF_ROOT_ID;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'DISTINTAS')).toBe(true);
  });

  test('nombre equivocado de la carpeta -> FALLA', () => {
    drive.raizItf._nombre = 'OtraCosa';
    expect(fallas(Verif.verificarRaicesStorage())).toContain('raiz ITF se llama ItfPropuestas');
    drive.raizItf._nombre = 'ItfPropuestas';
    drive.raizPozos._nombre = 'FotosReemplazo';
    expect(fallas(Verif.verificarRaicesStorage())).toContain('raiz Pozos se llama FotosPozos');
  });

  test('carpeta en la papelera -> FALLA', () => {
    drive.raizItf._papelera = true;
    expect(fallas(Verif.verificarRaicesStorage())).toContain('raiz ITF fuera de la papelera');
  });

  test('una raiz anidada dentro de otra (en cualquier sentido) -> FALLA', () => {
    drive.raizItf._padre = drive.raizPozos;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'ninguna raiz cuelga de otra')).toBe(true);
    drive.raizItf._padre = drive.miUnidad;
    drive.raizPozos._padre = drive.raizItf;
    expect(hayFalla(Verif.verificarRaicesStorage(), 'ninguna raiz cuelga de otra')).toBe(true);
    drive.raizPozos._padre = drive.miUnidad;
    drive.raizReemplazos._padre = drive.crearCarpeta('Intermedia', drive.raizItf);
    expect(hayFalla(Verif.verificarRaicesStorage(), 'ninguna raiz cuelga de otra')).toBe(true);
  });

  test('nunca loguea el secreto ni ids de Drive', () => {
    Verif.verificarRaicesStorage();
    const texto = logs.join('\n');
    expect(texto).not.toContain(SECRET);
    [ROOT_ID, POZOS_ROOT_ID, ITF_ROOT_ID].forEach((id) => expect(texto).not.toContain(id));
  });
});

describe('smokeItfStorage: camino sano', () => {
  test('todo OK, y deja el Drive como estaba (todo lo creado en la papelera, lo previo intacto)', () => {
    const previo = snapshotPrevio();
    const inf = Verif.smokeItfStorage();
    expect(fallas(inf)).toEqual([]);
    expect(inf.ok).toBe(true);
    expect(logs[logs.length - 1]).toMatch(/^SMOKE ITF STORAGE: OK \((\d+)\/\1 chequeos\)$/);
    const { nuevosArchivos, nuevasCarpetas } = verificarLimpieza(previo);
    // 2 archivos ITF + foto y miniatura de Pozos + foto y miniatura de Reemplazos + 1 fuera de raiz
    expect(nuevosArchivos.length).toBe(7);
    // La fuente SMOKE_ITF_E9 y su subcarpeta sin_fecha (el anio de Reemplazos ya existia: no se crea otro) + la carpeta del anio de ITF
    expect(nuevasCarpetas.length).toBe(3);
    expect(nuevasCarpetas.filter((id) => drive.carpetas[id]._padre === drive.raizItf).length).toBe(1);
  });

  test('cubre todo lo pedido: JPEG, PNG, HMAC, aislamiento, regresion de Fotos y de Reemplazos, limpieza', () => {
    const nombres = Verif.smokeItfStorage().checks.map((c) => c.nombre).join('\n');
    [
      'ITF JPEG: putItf ok', 'ITF JPEG: nombre fisico', 'ITF JPEG: cuelga de ItfPropuestas/<anio>/', 'ITF JPEG: metaItf', 'ITF JPEG: getItf devuelve exactamente los bytes',
      'ITF JPEG: reintento', 'ITF JPEG: getFoto / getFotoPozo / trashFoto / trashFotoPozo', 'ITF JPEG: trashItf',
      'ITF PNG: putItf ok', 'ITF PNG: nombre fisico', 'ITF PNG: metaItf', 'ITF PNG: getItf devuelve exactamente los bytes', 'ITF PNG: trashItf',
      'aislamiento: getItf / metaItf / trashItf sobre un archivo de Fotos (Pozos)', 'aislamiento: getItf / metaItf / trashItf sobre un archivo de Reemplazos',
      'aislamiento: getItf / metaItf / trashItf sobre un archivo fuera de las tres raices',
      'HMAC: firma invalida', 'HMAC: accion alterada', 'HMAC: timestamp vencido', 'HMAC: timestamp del futuro', 'HMAC: la solicitud valida se procesa una vez', 'HMAC: solicitud sin firma',
      'documentoId que no es UUID', 'documentoId con ruta', 'PNG declarado como JPEG', 'JPEG declarado como PNG', 'mime no permitido', 'clave de mas',
      'driveFileId invalido',
      'Fotos (Pozos): putFotoPozo JPEG sigue funcionando', 'Fotos (Pozos): getFotoPozo completa y miniatura', 'Fotos (Pozos): el archivo cuelga de la raiz de Pozos', 'Fotos (Pozos): un PNG sigue rechazado', 'Fotos (Pozos): trashFotoPozo',
      'Reemplazos: putFoto JPEG sigue funcionando', 'Reemplazos: getFoto completa y miniatura', 'Reemplazos: el archivo cuelga de la raiz de Reemplazos', 'Reemplazos: un PNG sigue rechazado', 'Reemplazos: trashFoto',
      'ningun archivo de smoke queda vivo', 'la raiz ITF tiene los mismos archivos vivos'
    ].forEach((t) => expect(nombres).toContain(t));
  });

  test('el nombre fisico en Drive es <documentoId>.jpg / .png (no un nombre original) y solo bajo ItfPropuestas', () => {
    const previo = snapshotPrevio();
    Verif.smokeItfStorage();
    const itf = Object.keys(drive.archivos).filter((id) => previo.archivos.indexOf(id) < 0).map((id) => drive.archivos[id]).filter((a) => a._padre._padre === drive.raizItf);
    expect(itf.map((a) => a._mime).sort()).toEqual(['image/jpeg', 'image/png']);
    itf.forEach((a) => expect(a._nombre).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png)$/));
    expect(drive.raizItf._hijosArchivos).toEqual([]);
  });

  test('si la carpeta SMOKE_ITF_E9 y el anio de Reemplazos YA existian, no se tocan (solo se retiran los archivos del smoke)', () => {
    const fuente = drive.crearCarpeta('SMOKE_ITF_E9', drive.raizPozos);
    const previa = fuente.createFile({ nombre: 'otra-foto.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 9]), mime: 'image/jpeg' });
    const previo = snapshotPrevio();
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(true);
    expect(fuente._papelera).toBe(false);
    expect(previa._papelera).toBe(false);
    expect(drive.anioReemplazos._papelera).toBe(false);
    expect(drive.archivoReemplazosPrevio._papelera).toBe(false);
    expect(drive.archivoAjeno._papelera).toBe(false);
    verificarLimpieza(previo);
  });

  test('carpetas PREEXISTENTES vacias (fuente SMOKE y anio de Reemplazos) no se mandan a la papelera', () => {
    drive.crearCarpeta('SMOKE_ITF_E9', drive.raizPozos);
    drive.archivoReemplazosPrevio.setTrashed(true);
    expect(Verif.smokeItfStorage().ok).toBe(true);
    expect(drive.raizPozos._hijosCarpetas.find((c) => c._nombre === 'SMOKE_ITF_E9')._papelera).toBe(false);
    expect(drive.anioReemplazos._papelera).toBe(false);
  });

  test('carpetas que el smoke CREO (fuente SMOKE y anio de Reemplazos) vuelven a la papelera', () => {
    drive.raizReemplazos._hijosCarpetas = drive.raizReemplazos._hijosCarpetas.filter((c) => c !== drive.anioReemplazos);
    expect(Verif.smokeItfStorage().ok).toBe(true);
    const anio = drive.raizReemplazos._hijosCarpetas.find((c) => c._nombre === String(new Date().getFullYear()));
    expect(anio._papelera).toBe(true);
    expect(drive.raizPozos._hijosCarpetas.find((c) => c._nombre === 'SMOKE_ITF_E9')._papelera).toBe(true);
  });

  test('si un archivo del smoke no se puede retirar, la carpeta que lo contiene NO se manda a la papelera', () => {
    global.storageDrive_putFotoPozo = (p) => { const r = Dr.storageDrive_putFotoPozo(p); if (r.status === 'ok') { drive.archivos[r.driveFileId].setTrashed = () => {}; } return r; };
    expect(Verif.smokeItfStorage().ok).toBe(false);
    expect(drive.raizPozos._hijosCarpetas.find((c) => c._nombre === 'SMOKE_ITF_E9')._papelera).toBe(false);
  });

  test('la raiz ITF con archivos vivos previos: quedan intactos y el conteo vuelve al mismo valor', () => {
    const anio = drive.crearCarpeta('2026', drive.raizItf);
    const previoITF = anio.createFile({ nombre: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 5]), mime: 'image/jpeg' });
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(true);
    expect(previoITF._papelera).toBe(false);
    expect(drive.raizItf.getFolders().hasNext()).toBe(true);
  });

  test('nunca loguea el secreto, ids de Drive ni correos', () => {
    Verif.smokeItfStorage();
    const texto = logs.join('\n');
    expect(texto).not.toContain(SECRET);
    [ROOT_ID, POZOS_ROOT_ID, ITF_ROOT_ID].concat(Object.keys(drive.archivos)).forEach((id) => expect(texto).not.toContain(id));
    expect(texto).not.toMatch(/@/);
  });

  test('con las raices mal configuradas NO se ejecuta y no crea nada', () => {
    delete props.ITF_ROOT_FOLDER_ID;
    const previo = snapshotPrevio();
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(false);
    expect(logs).toContain('SMOKE ITF STORAGE: NO SE EJECUTO');
    expect(Object.keys(drive.archivos)).toEqual(previo.archivos);
    expect(Object.keys(drive.carpetas)).toEqual(previo.carpetas);
  });
});

describe('smokeItfStorage: detecta un storage defectuoso (inyeccion de fallas) y limpia igual', () => {
  const lectura = (p) => {
    const a = global.DriveApp.getFileById(p.driveFileId);
    return { status: 'ok', mimeType: a.getBlob().getContentType(), imagenBase64: global.Utilities.base64Encode(a.getBlob().getBytes()), tamanoBytes: a.getSize() };
  };
  const casos = [
    ['getItf sin chequear la raiz', () => { global.storageDrive_getItf = (p) => (/^[A-Za-z0-9_-]{10,100}$/.test(p.driveFileId) ? lectura(p) : { status: 'error', code: 'NOT_FOUND' }); }, 'aislamiento: getItf / metaItf / trashItf sobre un archivo de Fotos'],
    ['metaItf sin chequear la raiz', () => { global.storageDrive_metaItf = (p) => (/^[A-Za-z0-9_-]{10,100}$/.test(p.driveFileId) && drive.archivos[p.driveFileId] ? { status: 'ok', mimeType: 'image/jpeg', tamanoBytes: 1 } : { status: 'error', code: 'NOT_FOUND' }); }, 'aislamiento: getItf / metaItf / trashItf sobre un archivo de Reemplazos'],
    ['trashItf sin chequear la raiz', () => { global.storageDrive_trashItf = (p) => { const a = drive.archivos[p.driveFileId]; if (!a) { return { status: 'error', code: 'NOT_FOUND' }; } a.setTrashed(true); return { status: 'ok' }; }; }, 'aislamiento: getItf / metaItf / trashItf sobre un archivo fuera de las tres raices'],
    ['trashItf que no manda nada a la papelera', () => { global.storageDrive_trashItf = () => ({ status: 'ok' }); }, 'trashItf manda ese archivo a la papelera'],
    ['firma invalida aceptada', () => { global.storageAuth_verificarSolicitud = (b) => ({ ok: true, accion: b.action, payload: JSON.parse(b.payload), nonce: b.nonce }); }, 'HMAC: firma invalida'],
    ['timestamp vencido y futuro aceptados', () => { const orig = Auth.storageAuth_verificarSolicitud; global.storageAuth_verificarSolicitud = (b, s, ahora, c) => orig(b, s, Number(b.ts), c); }, 'HMAC: timestamp vencido'],
    ['replay aceptado', () => { global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {} }) }; }, 'HMAC: la solicitud valida se procesa una vez'],
    ['accion alterada aceptada', () => { const orig = Auth.storageAuth_verificarSolicitud; global.storageAuth_verificarSolicitud = (b, s, ahora, c) => { const r = orig(Object.assign({}, b, { action: 'metaItf' }), s, ahora, c); return r.ok ? Object.assign(r, { accion: b.action }) : r; }; }, 'HMAC: accion alterada'],
    ['getFoto alcanza archivos de ITF', () => { global.storageDrive_getFoto = (p) => Dr.storageDrive_getItf({ driveFileId: p.driveFileId }); }, 'ITF JPEG: getFoto / getFotoPozo / trashFoto / trashFotoPozo'],
    ['trashFotoPozo alcanza archivos de ITF', () => { global.storageDrive_trashFotoPozo = (p) => Dr.storageDrive_trashItf({ driveFileId: p.driveFileId }); }, 'ITF PNG: getFoto / getFotoPozo / trashFoto / trashFotoPozo'],
    ['Fotos acepta un PNG', () => { global.storageDrive_putFotoPozo = (p) => (p.mimeType === 'image/png' ? { status: 'ok', driveFileId: 'x'.repeat(12) } : Dr.storageDrive_putFotoPozo(p)); }, 'Fotos (Pozos): un PNG sigue rechazado'],
    ['Reemplazos acepta un PNG', () => { global.storageDrive_putFoto = (p, a) => (p.mimeType === 'image/png' ? { status: 'ok', driveFileId: 'x'.repeat(12) } : Dr.storageDrive_putFoto(p, a)); }, 'Reemplazos: un PNG sigue rechazado'],
    ['putItf guarda con otro nombre fisico', () => { global.storageDrive_putItf = (p, a) => { const r = Dr.storageDrive_putItf(p, a); if (r.status === 'ok') { drive.archivos[r.driveFileId]._nombre = 'foto-original.jpg'; } return r; }; }, 'ITF JPEG: nombre fisico'],
    ['putItf guarda fuera de la raiz ITF', () => { global.storageDrive_putItf = (p, a) => { const r = Dr.storageDrive_putItf(p, a); if (r.status === 'ok') { drive.archivos[r.driveFileId]._padre = drive.miUnidad; } return r; }; }, 'ITF JPEG: cuelga de ItfPropuestas/<anio>/'],
    ['getItf devuelve otros bytes', () => { global.storageDrive_getItf = (p) => { const r = Dr.storageDrive_getItf(p); return r.status === 'ok' ? Object.assign(r, { imagenBase64: r.imagenBase64.slice(0, -4) + 'AAAA' }) : r; }; }, 'getItf devuelve exactamente los bytes'],
    ['getItf devuelve otro mime', () => { global.storageDrive_metaItf = (p) => { const r = Dr.storageDrive_metaItf(p); return r.status === 'ok' ? Object.assign(r, { mimeType: 'image/jpeg' }) : r; }; }, 'ITF PNG: metaItf'],
    ['metaItf entrega el contenido', () => { global.storageDrive_metaItf = (p) => Object.assign(Dr.storageDrive_metaItf(p), { imagenBase64: 'AAAA' }); }, 'ITF JPEG: metaItf'],
    ['putItf duplica en el reintento', () => { global.storageDrive_putItf = (p, a) => { const r = Dr.storageDrive_putItf(p, a); return r.status === 'ok' ? Object.assign(r, { existente: false }) : r; }; }, 'reintento del mismo documento es idempotente'],
    ['putItf acepta un PNG declarado como JPEG (y lo guarda)', () => { global.storageDrive_putItf = (p, a) => Dr.storageDrive_putItf(p.mimeType === 'image/jpeg' && p.imagenBase64 === Verif.VERIF_PNG_B64 ? { documentoId: p.documentoId, mimeType: 'image/png', imagenBase64: p.imagenBase64 } : p, a); }, 'PNG declarado como JPEG'],
    ['putItf acepta un documentoId que no es UUID (y lo guarda)', () => { global.storageDrive_putItf = (p, a) => Dr.storageDrive_putItf(p.documentoId === 'no-es-un-uuid' ? Object.assign({}, p, { documentoId: crypto.randomUUID() }) : p, a); }, 'documentoId que no es UUID'],
    ['firma invalida aceptada pero la respuesta es un UNAUTHORIZED FIRMADO', () => { global.storageAuth_verificarSolicitud = (b) => ({ ok: true, accion: b.action, payload: JSON.parse(b.payload), nonce: b.nonce }); global.storageDrive_metaItf = () => ({ status: 'error', code: 'UNAUTHORIZED' }); }, 'HMAC: firma invalida'],
    ['putItf guarda en una carpeta de dos niveles que NO cuelga de la raiz ITF', () => { global.storageDrive_putItf = (p, a) => { const r = Dr.storageDrive_putItf(p, a); if (r.status === 'ok') { drive.archivos[r.driveFileId]._padre = drive.crearCarpeta('2026', drive.crearCarpeta('OtraCarpeta', drive.miUnidad)); } return r; }; }, 'ITF JPEG: cuelga de ItfPropuestas/<anio>/'],
    ['trashItf sobre un archivo ajeno responde algo distinto de NOT_FOUND', () => { global.storageDrive_trashItf = (p) => { const r = Dr.storageDrive_trashItf(p); return r.code === 'NOT_FOUND' ? { status: 'error', code: 'INTERNAL' } : r; }; }, 'aislamiento: getItf / metaItf / trashItf sobre un archivo de Fotos'],
    ['trashItf responde NOT_FOUND pero manda a la papelera el archivo ajeno', () => { global.storageDrive_trashItf = (p) => { const r = Dr.storageDrive_trashItf(p); if (r.status === 'error' && drive.archivos[p.driveFileId]) { drive.archivos[p.driveFileId].setTrashed(true); } return r; }; }, 'aislamiento: getItf / metaItf / trashItf sobre un archivo de Fotos'],
    ['trashFoto responde NOT_FOUND pero manda a la papelera el archivo ITF', () => { global.storageDrive_trashFoto = (p) => { const a = drive.archivos[p.driveFileId]; if (a && a._padre._padre === drive.raizItf) { a.setTrashed(true); } return Dr.storageDrive_trashFoto(p); }; }, 'ITF JPEG: getFoto / getFotoPozo / trashFoto / trashFotoPozo'],
    ['Fotos (Pozos) acepta un PNG declarado como JPEG', () => { global.storageDrive_putFotoPozo = (p) => (p.mimeType === 'image/jpeg' && p.imagenBase64 === Verif.VERIF_PNG_B64 ? { status: 'ok', driveFileId: 'x'.repeat(12) } : Dr.storageDrive_putFotoPozo(p)); }, 'Fotos (Pozos): un PNG sigue rechazado'],
    ['getItf deja un archivo huerfano vivo DENTRO de la carpeta del anio de ITF', () => { global.storageDrive_getItf = (p) => { drive.raizItf._hijosCarpetas[0].createFile({ nombre: 'huerfano.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 7]), mime: 'image/jpeg' }); return Dr.storageDrive_getItf(p); }; }, 'la raiz ITF tiene los mismos archivos vivos', { residuo: true }],
    ['la respuesta firmada trae OTRO nonce', () => { const orig = Auth.storageAuth_firmarRespuesta; global.storageAuth_firmarRespuesta = (secret, nonce, datos, ahora) => orig(secret, 'otro-nonce-0123456789abcdef', datos, ahora); }, 'ITF JPEG: putItf ok, respuesta firmada'],
    ['la respuesta firmada trae una firma que no es del servidor', () => { const orig = Auth.storageAuth_firmarRespuesta; global.storageAuth_firmarRespuesta = (secret, nonce, datos, ahora) => orig('otro-secreto-' + 'z'.repeat(30), nonce, datos, ahora); }, 'ITF PNG: putItf ok, respuesta firmada'],
    ['getItf deja un archivo huerfano vivo en la raiz ITF', () => { global.storageDrive_getItf = (p) => { drive.raizItf.createFile({ nombre: 'huerfano.jpg', bytes: Buffer.from([0xff, 0xd8, 0xff, 7]), mime: 'image/jpeg' }); return Dr.storageDrive_getItf(p); }; }, 'la raiz ITF tiene los mismos archivos vivos', { residuo: true }],
    ['un archivo de Fotos no se puede mandar a la papelera (setTrashed inefectivo)', () => { global.storageDrive_putFotoPozo = (p) => { const r = Dr.storageDrive_putFotoPozo(p); if (r.status === 'ok') { drive.archivos[r.driveFileId].setTrashed = () => {}; } return r; }; }, 'ningun archivo de smoke queda vivo', { residuo: true }],
    ['trashFotoPozo no manda la miniatura a la papelera', () => { global.storageDrive_trashFotoPozo = (p) => { drive.archivos[p.driveFileId].setTrashed(true); return { status: 'ok' }; }; }, 'Fotos (Pozos): trashFotoPozo'],
    ['trashFoto no manda la miniatura a la papelera', () => { global.storageDrive_trashFoto = (p) => { drive.archivos[p.driveFileId].setTrashed(true); return { status: 'ok' }; }; }, 'Reemplazos: trashFoto'],
    ['Fotos (Pozos) guarda en la raiz de ITF', () => { global.storageDrive_putFotoPozo = (p) => { const r = Dr.storageDrive_putFotoPozo(p); if (r.status === 'ok') { drive.archivos[r.driveFileId]._padre = drive.crearCarpeta('2026', drive.raizItf); } return r; }; }, 'Fotos (Pozos): el archivo cuelga de la raiz de Pozos y NO de la de ITF'],
    ['Reemplazos guarda en la raiz de ITF', () => { global.storageDrive_putFoto = (p, a) => { const r = Dr.storageDrive_putFoto(p, a); if (r.status === 'ok') { drive.archivos[r.driveFileId]._padre = drive.crearCarpeta('2026', drive.raizItf); } return r; }; }, 'Reemplazos: el archivo cuelga de la raiz de Reemplazos y NO de la de ITF'],
    ['Fotos (Pozos) devuelve otros bytes', () => { global.storageDrive_getFotoPozo = (p) => { const r = Dr.storageDrive_getFotoPozo(p); return r.status === 'ok' ? Object.assign(r, { imagenBase64: 'AAAA' }) : r; }; }, 'Fotos (Pozos): getFotoPozo completa y miniatura'],
    ['Reemplazos devuelve otros bytes', () => { global.storageDrive_getFoto = (p) => { const r = Dr.storageDrive_getFoto(p); return r.status === 'ok' && p.variante === 'thumb' ? Object.assign(r, { imagenBase64: 'AAAA' }) : r; }; }, 'Reemplazos: getFoto completa y miniatura'],
    ['putFotoPozo falla (Fotos roto)', () => { global.storageDrive_putFotoPozo = () => ({ status: 'error', code: 'INTERNAL' }); }, 'Fotos (Pozos): putFotoPozo JPEG sigue funcionando'],
    ['putFoto falla (Reemplazos roto)', () => { global.storageDrive_putFoto = () => ({ status: 'error', code: 'INTERNAL' }); }, 'Reemplazos: putFoto JPEG sigue funcionando'],
    ['putItf falla (ITF roto)', () => { global.storageDrive_putItf = () => ({ status: 'error', code: 'INTERNAL' }); }, 'ITF JPEG: putItf ok']
  ];

  // cada fila lleva siempre 4 elementos: con menos, Jest tomaria el ultimo parametro como callback `done`
  test.each(casos.map((c) => [c[0], c[1], c[2], c[3] || {}]))('%s', (nombre, inyectar, esperado, opciones) => {
    const previo = snapshotPrevio();
    inyectar();
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(false);
    expect(fallas(inf).some((n) => n.indexOf(esperado) >= 0)).toBe(true);
    expect(logs[logs.length - 1]).toMatch(/^SMOKE ITF STORAGE: FALLO/);
    // con cualquier falla: nada de lo previo se toca y lo que el smoke creo queda en la papelera
    previo.archivos.forEach((id) => expect(drive.archivos[id]._papelera).toBe(false));
    if (opciones.residuo) {
      // la falla inyectada deja algo que la limpieza NO puede retirar (y el smoke lo informa): lo demas si se retira
      return;
    }
    Object.keys(drive.archivos).filter((id) => previo.archivos.indexOf(id) < 0).forEach((id) => expect(drive.archivos[id]._papelera).toBe(true));
    expect(drive.raizItf.getFiles().hasNext()).toBe(false);
  });

  test('una EXCEPCION en medio del smoke: se informa, se limpia todo y el resto del Drive sigue igual', () => {
    const previo = snapshotPrevio();
    global.storageDrive_metaItf = () => { throw new Error('fallo de Drive ' + 'A'.repeat(40)); };
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(false);
    expect(fallas(inf)).toContain('el smoke termino sin excepciones');
    expect(logs.join('\n')).not.toContain('A'.repeat(40));
    verificarLimpieza(previo);
  });

  test('si la limpieza final falla, se informa', () => {
    const orig = drive.raizPozos.getFoldersByName.bind(drive.raizPozos);
    let llamadas = 0;
    drive.raizPozos.getFoldersByName = (n) => { llamadas += 1; if (llamadas > 3) { throw new Error('Drive no responde'); } return orig(n); };
    const inf = Verif.smokeItfStorage();
    expect(inf.ok).toBe(false);
    expect(fallas(inf)).toContain('limpieza de los archivos de smoke');
  });
});
