#!/usr/bin/env node
// SOLO PARA PRUEBAS (test_importar.py): levanta en localhost el codigo REAL del storage (storage/src/*.js) con un Drive
// en memoria, para probar el importador Python contra el protocolo verdadero (firma HMAC, respuestas firmadas,
// idempotencia, redireccion 302 de Apps Script). No toca Google ni produccion y no guarda nada en disco.
//
//   node scripts/fotos/servidor_storage_prueba.js        -> imprime "PORT <n>" y atiende hasta que se lo mata
// Entorno: PRUEBA_SECRETO (secreto del storage de prueba), PRUEBA_500_PRIMEROS=N (las primeras N solicitudes
// responden HTTP 500, para probar reintentos), PRUEBA_INTERNAL_PRIMEROS=N (INTERNAL firmado... sin firma, como el real),
// PRUEBA_LATENCIA_MS=N (demora cada respuesta N ms, como la red + Apps Script reales: sirve para medir la concurrencia).
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const SECRETO = process.env.PRUEBA_SECRETO || 'secreto-de-prueba-0123456789';
const RAIZ_POZOS = 'RAIZ_POZOS_PRUEBA_0001';
const RAIZ_REEMPLAZO = 'RAIZ_REEMPLAZO_PRUEBA_01';
let fallar500 = parseInt(process.env.PRUEBA_500_PRIMEROS || '0', 10);
let fallarInternal = parseInt(process.env.PRUEBA_INTERNAL_PRIMEROS || '0', 10);
const LATENCIA_MS = parseInt(process.env.PRUEBA_LATENCIA_MS || '0', 10);

function iter(lista) { let i = 0; return { hasNext: () => i < lista.length, next: () => lista[i++] }; }
let n = 0;
const archivos = {};
const carpetas = {};
function carpeta(nombre, padre, id) {
  const f = {
    _id: id || 'FOLDER_' + String(++n).padStart(8, '0'), _n: nombre, _p: padre, _c: [], _a: [],
    getId() { return this._id; },
    getParents() { return iter(this._p ? [this._p] : []); },
    getFoldersByName(x) { return iter(this._c.filter((c) => c._n === x)); },
    createFolder(x) { const c = carpeta(x, this); this._c.push(c); return c; },
    getFilesByName(x) { return iter(this._a.filter((a) => a._n === x && !a._t)); },
    createFile(blob) {
      const a = {
        _id: 'FILE' + String(++n).padStart(14, '0'), _n: blob.nombre, _b: blob.bytes, _m: blob.mime, _p: this, _d: '', _t: false,
        getId() { return this._id; }, getSize() { return this._b.length; }, getParents() { return iter([this._p]); },
        setDescription(d) { this._d = d; }, getDescription() { return this._d; }, setSharing() {},
        getBlob() { const s = this; return { getContentType: () => s._m, getBytes: () => s._b }; }, setTrashed(v) { this._t = v; }
      };
      archivos[a._id] = a; this._a.push(a); return a;
    }
  };
  carpetas[f._id] = f;
  return f;
}
const raizPozos = carpeta('FotosPozos', null, RAIZ_POZOS);
carpeta('FotosReemplazo', null, RAIZ_REEMPLAZO);

global.Utilities = {
  computeHmacSha256Signature: (msg, clave) => Array.from(crypto.createHmac('sha256', clave).update(msg, 'utf8').digest()),
  base64Decode: (b64) => Array.from(Buffer.from(b64, 'base64')),
  newBlob: (bytes, mime, nombre) => ({ bytes: Buffer.from(bytes), mime, nombre }),
  getUuid: () => crypto.randomUUID()
};
const cache = {};
global.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; } }) };
global.DriveApp = {
  Access: { PRIVATE: 'P' }, Permission: { NONE: 'N' },
  getFolderById: (id) => carpetas[id] || null,
  getFileById: (id) => { if (!archivos[id]) { throw new Error('no existe'); } return archivos[id]; }
};
global.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };   // el codigo real se serializa solo: este servidor es de un hilo
global.getStorageSecret = () => SECRETO;
global.getStorageRootFolderId = () => RAIZ_REEMPLAZO;
global.getStoragePozosRootFolderId = () => RAIZ_POZOS;

const raiz = path.join(__dirname, '..', '..', 'storage', 'src');
Object.assign(global, require(path.join(raiz, 'StorageAuth.js')), require(path.join(raiz, 'StorageDrive.js')));
const { storageApi_procesar } = require(path.join(raiz, 'StorageApi.js'));

const resultados = {};
const servidor = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/resultado/')) {     // lo que sigue un cliente tras el 302 de Apps Script
    const r = resultados[req.url.slice('/resultado/'.length)];
    if (!r) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(r);
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/estado')) {          // inspeccion para los tests
    const lista = Object.values(archivos).map((a) => ({ nombre: a._n, carpeta: a._p._n, padre: a._p._p ? a._p._p._n : '', bytes: a._b.length, papelera: a._t }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ archivos: lista }));
    return;
  }
  const trozos = [];
  req.on('data', (t) => trozos.push(t));
  req.on('end', () => {
    if (fallar500 > 0) { fallar500 -= 1; res.writeHead(500); res.end('error'); return; }
    let salida;
    if (fallarInternal > 0) { fallarInternal -= 1; salida = { status: 'error', code: 'INTERNAL' }; }
    else {
      try { salida = storageApi_procesar(Buffer.concat(trozos).toString('utf8')); } catch (e) { salida = { status: 'error', code: 'INTERNAL' }; }
    }
    const id = crypto.randomUUID();
    resultados[id] = JSON.stringify(salida);
    const responder = () => { res.writeHead(302, { Location: 'http://127.0.0.1:' + servidor.address().port + '/resultado/' + id }); res.end(); };
    if (LATENCIA_MS > 0) { setTimeout(responder, LATENCIA_MS); } else { responder(); }
  });
});
servidor.listen(0, '127.0.0.1', () => {
  console.log('PORT ' + servidor.address().port);
});
