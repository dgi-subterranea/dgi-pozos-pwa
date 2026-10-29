/* Benchmark LOCAL (Node) del camino de una propuesta de ITF (E9-4). NO es parte de la app ni de Apps Script: no se carga desde index.html ni se sube con clasp.
 *
 * Uso:  node scripts/medir_itf_propuesta.js
 *
 * Que mide (para 100 KB, 500 KB, 1 MB y 3 MB de imagen):
 *   - TAMANOS (deterministas, valen tambien en produccion): base64 de la imagen, cuerpo JSON que manda el navegador al backend (campos + imageBase64), y solicitud firmada que el backend manda al
 *     storage (el payload viaja como STRING JSON dentro de otro JSON, mas la firma HMAC).
 *   - TIEMPOS de CPU en Node (INDICATIVOS: el costo relativo entre tamanos, no los segundos reales de Apps Script): decodificar base64, validar magic bytes, SHA-256, armar y firmar la solicitud.
 * Lo que este script NO puede medir (necesita una sesion real de Google y esta fuera de esta etapa): el tiempo de Utilities.base64Decode / computeDigest / UrlFetchApp / Drive en Apps Script, el limite
 * real del cuerpo de un doPost entrante y la latencia de red del navegador. Ver docs/itf-colaborativos.md (E9-4) para el limite provisional de 3 MB y como medirlo en produccion.
 */
const crypto = require('crypto');
const path = require('path');

// Apps Script no existe en Node: solo se reemplaza el HMAC que usa el cliente del storage (bytes CON SIGNO, como devuelve Utilities).
global.Utilities = {
  computeHmacSha256Signature: (mensaje, secreto) => Array.from(crypto.createHmac('sha256', secreto).update(mensaje).digest()).map((v) => (v > 127 ? v - 256 : v))
};

const Archivo = require(path.join(__dirname, '..', 'backend', 'src', 'ItfArchivoLogic.js'));
const Cliente = require(path.join(__dirname, '..', 'backend', 'src', 'FotosStorageClient.js'));

const KB = 1024;
const MB = 1024 * 1024;
const TAMANOS = [{ etiqueta: '100 KB', bytes: 100 * KB }, { etiqueta: '500 KB', bytes: 500 * KB }, { etiqueta: '1 MB', bytes: 1 * MB }, { etiqueta: '3 MB', bytes: 3 * MB }];
const REPETICIONES = 7;

function imagenJpeg(n) {
  const b = Buffer.alloc(n);
  crypto.randomFillSync(b);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  return b;
}

function mediana(valores) {
  const o = valores.slice().sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
}

function medir(fn) {
  const tiempos = [];
  let resultado;
  for (let i = 0; i < REPETICIONES; i += 1) {
    const t0 = process.hrtime.bigint();
    resultado = fn();
    tiempos.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return { ms: mediana(tiempos), resultado };
}

function formato(n) {
  return n >= MB ? (n / MB).toFixed(2) + ' MB' : (n / KB).toFixed(0) + ' KB';
}

const filas = TAMANOS.map((t) => {
  const bytes = imagenJpeg(t.bytes);
  const b64 = bytes.toString('base64');
  const cuerpoNavegador = JSON.stringify({ action: 'proponerItf', sessionToken: 'x'.repeat(96), wellId: '14-0001', imageBase64: b64, mimeType: 'image/jpeg', nombreOriginal: 'foto-itf.jpg', clientRequestId: crypto.randomUUID() });
  const solicitudStorage = JSON.stringify(Cliente.fotosStorageClient_armarSolicitud('putItf', { documentoId: crypto.randomUUID(), mimeType: 'image/jpeg', imagenBase64: b64 }, 'a'.repeat(40), 1700000000, crypto.randomUUID()));

  const decodificar = medir(() => Array.from(Buffer.from(b64, 'base64')));
  const lista = decodificar.resultado;
  const validar = medir(() => Archivo.itfArchivo_validar({ bytes: lista, mimeType: 'image/jpeg' }));
  const hash = medir(() => Archivo.itfArchivo_sha256Hex(lista, (b) => Array.from(crypto.createHash('sha256').update(Buffer.from(b.map((v) => v & 0xff))).digest()).map((v) => (v > 127 ? v - 256 : v))));
  const firmar = medir(() => Cliente.fotosStorageClient_armarSolicitud('putItf', { documentoId: 'd', mimeType: 'image/jpeg', imagenBase64: b64 }, 'a'.repeat(40), 1700000000, 'n'));

  return {
    imagen: t.etiqueta,
    base64: formato(b64.length),
    'cuerpo navegador->backend': formato(Buffer.byteLength(cuerpoNavegador)),
    'solicitud backend->storage': formato(Buffer.byteLength(solicitudStorage)),
    'factor sobre la imagen': (Buffer.byteLength(solicitudStorage) / t.bytes).toFixed(3),
    'decodificar ms': decodificar.ms.toFixed(1),
    'validar ms': validar.ms.toFixed(1),
    'sha256 ms': hash.ms.toFixed(1),
    'firmar ms': firmar.ms.toFixed(1)
  };
});

console.log('Benchmark LOCAL (Node ' + process.version + ', mediana de ' + REPETICIONES + '). Los tiempos son INDICATIVOS; los tamanos son exactos.');
console.table(filas);
console.log('Limite provisional de ITF: ' + formato(Archivo.ITF_ARCHIVO_BYTES_MAX) + ' binarios = ' + formato(Math.ceil(Archivo.ITF_ARCHIVO_BYTES_MAX / 3) * 4) + ' de base64 (+33 %), mas el sobre JSON.');
