// Entorno de tests de E9-3 (proveedor legacy + servicio): Apps Script falso, hoja ItfEventos en memoria, Drive falso CON CONTADORES de llamadas, cache, lock, propiedades y storage E9 falso.
// Se arma con crearEntorno() en cada beforeEach (resetea los modulos). Nada toca Google.
const crypto = require('crypto');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const H = require('./itfHelper');

const JPEG = (n, relleno) => { const b = new Uint8Array(n); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; if (relleno !== undefined) { for (let i = 3; i < n; i += 1) { b[i] = relleno; } } return Array.from(b).map((v) => (v > 127 ? v - 256 : v)); };
const PNG = (n) => { const b = new Uint8Array(Math.max(n, 16)); [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D, 0x49, 0x48, 0x44, 0x52].forEach((v, i) => { b[i] = v; }); return Array.from(b).map((v) => (v > 127 ? v - 256 : v)); };
const sha256 = (bytes) => crypto.createHash('sha256').update(Buffer.from(bytes.map((v) => v & 0xFF))).digest('hex');
const digestNode = (b) => Array.from(crypto.createHash('sha256').update(Buffer.from(Array.from(b).map((v) => v & 0xFF))).digest()).map((v) => (v > 127 ? v - 256 : v));

function iterador(lista) {
  let i = 0;
  return { hasNext: () => i < lista.length, next: () => lista[i++] };
}

// Drive falso: archivos [{id, name, bytes, padre?}]. caseInsensitive emula un Drive que busca sin distinguir mayusculas. Cuenta las llamadas.
function crearDrive(archivos, opciones) {
  const o = opciones || {};
  const estado = { archivos: archivos.slice(), caseInsensitive: o.caseInsensitive === true, fallar: null };
  const calls = { getFilesByName: 0, getFiles: 0, getFileById: 0, getBlob: 0 };
  const mk = (a) => ({
    getId: () => a.id,
    getName: () => a.name,
    getBlob: () => { calls.getBlob += 1; return { getBytes: () => a.bytes, getContentType: () => 'image/jpeg' }; },
    getParents: () => iterador([{ getId: () => (a.padre || 'CARPETA') }])
  });
  const verificar = () => { if (estado.fallar) { throw new Error(estado.fallar); } };
  const carpeta = {
    getFilesByName: (n) => {
      calls.getFilesByName += 1;
      verificar();
      return iterador(estado.archivos.filter((a) => (a.padre || 'CARPETA') === 'CARPETA' && (a.name === n || (estado.caseInsensitive && a.name.toLowerCase() === n.toLowerCase()))).map(mk));
    },
    getFiles: () => { calls.getFiles += 1; verificar(); return iterador(estado.archivos.filter((x) => (x.padre || 'CARPETA') === 'CARPETA').map(mk)); }
  };
  global.DriveApp = {
    getFolderById: () => carpeta,
    getFileById: (id) => {
      calls.getFileById += 1;
      verificar();
      const a = estado.archivos.find((x) => x.id === id);
      if (!a) { throw new Error('Exception: No item with the given ID could be found, or you do not have permission to access it.'); }
      return mk(a);
    }
  };
  global.getFolderId = () => 'CARPETA';
  return { estado, calls, agregar: (a) => estado.archivos.push(a), quitar: (id) => { estado.archivos = estado.archivos.filter((x) => x.id !== id); } };
}

// Storage E9 falso: guarda en memoria, con contadores, y se puede hacer fallar.
function crearStorage() {
  const st = { docs: {}, guardados: 0, eliminados: [], leidos: 0, n: 0, fallarGuardar: false, fallarLeer: false, fallarEliminar: false };
  st.proveedor = {
    guardarPropuesta: (p) => { if (st.fallarGuardar) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; } st.n += 1; st.guardados += 1; const ref = 'e9-storage-' + String(st.n).padStart(6, '0'); st.docs[ref] = { bytes: p.bytes, mimeType: p.mimeType }; return { ok: true, storageRef: ref }; },
    leerDocumento: (ref) => { st.leidos += 1; if (st.fallarLeer || !st.docs[ref]) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; } return { ok: true, bytes: st.docs[ref].bytes, mimeType: st.docs[ref].mimeType }; },
    obtenerMetadata: (ref) => (st.docs[ref] ? { ok: true, bytes: st.docs[ref].bytes.length, mimeType: st.docs[ref].mimeType } : { ok: false, code: 'ITF_NOT_FOUND' }),
    eliminarTemporal: (ref) => { if (st.fallarEliminar) { return { ok: false, code: 'SERVICE_UNAVAILABLE' }; } st.eliminados.push(ref); delete st.docs[ref]; return { ok: true }; }
  };
  return st;
}

// Carga TODOS los modulos como globales de Apps Script (en este orden: las constantes primero) y arma el entorno.
function crearEntorno(opciones) {
  const o = opciones || {};
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  const props = Object.assign({}, o.props || {});
  global.PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }) };
  global.Utilities.sleep = jest.fn();
  global.Utilities.DigestAlgorithm = { SHA_256: 'SHA_256' };
  global.Utilities.computeDigest = (algo, bytes) => digestNode(bytes);
  const drive = crearDrive(o.archivos || []);
  const hojas = o.sinHoja ? instalarSheetsFalsos({}) : instalarSheetsFalsos({ ItfEventos: [require('../src/ItfEventosRepository').ITF_EVENTOS_COLUMNAS].concat(o.filas || []) });
  const mods = {
    archivo: require('../src/ItfArchivoLogic'),
    dominio: require('../src/ItfDominioService'),
    repo: require('../src/ItfEventosRepository'),
    drive: require('../src/DriveProfileRepository'),
    disp: require('../src/ItfAvailabilityService'),
    perfil: require('../src/ProfileService'),
    legacy: require('../src/ItfLegacyProvider'),
    storage: require('../src/ItfStorageProvider'),
    servicio: require('../src/ItfService')
  };
  Object.values(mods).forEach((m) => Object.assign(global, m));
  global.Utilities.computeDigest = (algo, bytes) => digestNode(bytes);
  const storage = crearStorage();
  const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
  global.LockService = { getScriptLock: () => lock };
  return { mods, drive, hoja: hojas.ItfEventos, hojas, storage, props, lock, H };
}

// deps de ItfService con TODO falso/inyectado (para los tests que no quieren depender de los globales reales)
function depsDe(entorno, extra) {
  const m = entorno.mods;
  entorno.contadorIds = entorno.contadorIds || 0;      // compartido entre llamadas a depsDe: los ids no se repiten (como Utilities.getUuid)
  const base = {
    e9Activo: () => entorno.props.ITF_E9_ACTIVO === 'SI',
    repo: { leerTodos: m.repo.itfEventosRepository_leerTodos, escribirEventos: m.repo.itfEventosRepository_escribirEventos, buscarPorClientRequestId: m.repo.itfEventosRepository_buscarPorClientRequestId, conLock: m.repo.itfEventosRepository_conLock },
    legacy: { buscar: m.legacy.itfLegacy_buscar, disponibilidad: m.legacy.itfLegacy_disponibilidad, huella: m.legacy.itfLegacy_huella, verificarHuella: m.legacy.itfLegacy_verificarHuella, leerRegistrado: m.legacy.itfLegacy_leerRegistrado },
    storage: entorno.storage.proveedor,
    existencia: () => ({ existe: true, indeterminado: false }),
    invalidarCaches: jest.fn(),
    ahora: () => new Date(H.ISO),
    nuevoEventoId: () => { entorno.contadorIds += 1; return H.uuid(70000 + entorno.contadorIds); },
    nuevoDocumentoId: () => { entorno.contadorIds += 1; return H.uuid(80000 + entorno.contadorIds); },
    calcularDigest: digestNode
  };
  return Object.assign(base, extra || {});
}

module.exports = { JPEG, PNG, sha256, digestNode, crearDrive, crearStorage, crearEntorno, depsDe, iterador };
