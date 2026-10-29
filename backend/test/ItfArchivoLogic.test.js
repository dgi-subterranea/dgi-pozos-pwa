// ItfArchivoLogic (E9-2): validadores puros del archivo de un ITF propuesto. Solo JPEG y PNG (NO PDF), magic bytes reales, tamano maximo, SHA-256 de los bytes reales y nombre original.
// Sin Drive, sin red. NOTA de estilo: los caracteres especiales se arman con String.fromCharCode (no con secuencias de escape en el texto del test).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const A = require('../src/ItfArchivoLogic');

const ch = (...codes) => String.fromCharCode(...codes);
const jpeg = (n) => { const b = new Uint8Array(n); b[0] = 0xFF; b[1] = 0xD8; b[2] = 0xFF; return b; };
const PNG_FIRMA = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52];
const png = (n) => { const b = new Uint8Array(Math.max(n, 16)); PNG_FIRMA.forEach((v, i) => { b[i] = v; }); return b; };
const pdf = () => Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n'));
const conSigno = (b) => Array.from(b).map((v) => (v > 127 ? v - 256 : v));         // como Blob.getBytes() de Apps Script
const digestNode = (b) => Array.from(crypto.createHash('sha256').update(Buffer.from(Array.from(b).map((v) => v & 0xFF))).digest());

describe('constantes: solo imagenes, 3 MB como el storage de Fotos', () => {
  test('MIME permitidos exactos y sin PDF', () => {
    expect(A.ITF_MIME_PERMITIDOS).toEqual(['image/jpeg', 'image/png']);
    expect(A.ITF_MIME_PERMITIDOS.join(',')).not.toMatch(/pdf/);
  });
  test('el maximo es 3 MB y coincide con el del storage', () => {
    expect(A.ITF_ARCHIVO_BYTES_MAX).toBe(3 * 1024 * 1024);
    const storage = fs.readFileSync(path.join(__dirname, '..', '..', 'storage', 'src', 'StorageDrive.js'), 'utf8');
    expect(storage).toMatch(/STORAGE_MAX_BYTES = 3 \* 1024 \* 1024;/);
  });
});

describe('itfArchivo_detectarFormato: por los bytes, no por el nombre ni el MIME', () => {
  test('JPEG y PNG validos', () => {
    expect(A.itfArchivo_detectarFormato(jpeg(100))).toBe('image/jpeg');
    expect(A.itfArchivo_detectarFormato(png(100))).toBe('image/png');
  });
  test('bytes con signo de Apps Script (-1, -40, -1)', () => {
    expect(A.itfArchivo_detectarFormato(conSigno(jpeg(10)))).toBe('image/jpeg');
    expect(A.itfArchivo_detectarFormato(conSigno(png(20)))).toBe('image/png');
  });
  test('Array, Uint8Array y Buffer', () => {
    expect(A.itfArchivo_detectarFormato(Array.from(jpeg(5)))).toBe('image/jpeg');
    expect(A.itfArchivo_detectarFormato(Buffer.from(jpeg(5)))).toBe('image/jpeg');
  });
  test('PDF, GIF, texto, vacio y basura: null', () => {
    expect(A.itfArchivo_detectarFormato(pdf())).toBeNull();
    expect(A.itfArchivo_detectarFormato(Uint8Array.from(Buffer.from('GIF89a....')))).toBeNull();
    expect(A.itfArchivo_detectarFormato(Uint8Array.from(Buffer.from('hola mundo')))).toBeNull();
    expect(A.itfArchivo_detectarFormato([])).toBeNull();
    expect(A.itfArchivo_detectarFormato([0xFF, 0xD8])).toBeNull();
    expect(A.itfArchivo_detectarFormato(null)).toBeNull();
    expect(A.itfArchivo_detectarFormato('FFD8FF')).toBeNull();
    expect(A.itfArchivo_detectarFormato({})).toBeNull();
  });
  test('un JPEG que empieza FF D8 pero no FF no es JPEG', () => {
    const b = jpeg(10);
    b[2] = 0x00;
    expect(A.itfArchivo_detectarFormato(b)).toBeNull();
  });
  test('un PNG con la firma pero sin chunk IHDR (o de largo distinto de 13) no es PNG', () => {
    const sinIhdr = png(30);
    sinIhdr[12] = 0x58;
    expect(A.itfArchivo_detectarFormato(sinIhdr)).toBeNull();
    const largoMal = png(30);
    largoMal[11] = 0x0E;
    expect(A.itfArchivo_detectarFormato(largoMal)).toBeNull();
    expect(A.itfArchivo_detectarFormato(Uint8Array.from(PNG_FIRMA.slice(0, 8)))).toBeNull();
  });
});

describe('itfArchivo_validar', () => {
  test('JPEG y PNG validos devuelven el MIME detectado y el largo real', () => {
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: jpeg(1234) })).toEqual({ ok: true, mimeType: 'image/jpeg', bytes: 1234 });
    expect(A.itfArchivo_validar({ mimeType: 'image/png', bytes: png(500) })).toEqual({ ok: true, mimeType: 'image/png', bytes: 500 });
  });
  test('el MIME declarado se normaliza (mayusculas y espacios) pero tiene que ser exacto', () => {
    expect(A.itfArchivo_validar({ mimeType: ' IMAGE/JPEG ', bytes: jpeg(50) }).ok).toBe(true);
    ['image/jpg', 'image/jpeg; charset=binary', 'jpeg', 'image/*', 'image/gif', 'image/webp', '', null, undefined, 5].forEach((m) => {
      expect(A.itfArchivo_validar({ mimeType: m, bytes: jpeg(50) }).code).toBe('MIME_NO_PERMITIDO');
    });
  });
  test('PDF: rechazado por MIME aunque los bytes sean un PDF real, y por contenido si dice ser imagen', () => {
    expect(A.itfArchivo_validar({ mimeType: 'application/pdf', bytes: pdf() }).code).toBe('MIME_NO_PERMITIDO');
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: pdf() }).code).toBe('FORMATO_NO_RECONOCIDO');
  });
  test('el nombre o la extension no cuentan: un PNG que dice ser JPEG es MIME_NO_COINCIDE', () => {
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: png(100) }).code).toBe('MIME_NO_COINCIDE');
    expect(A.itfArchivo_validar({ mimeType: 'image/png', bytes: jpeg(100) }).code).toBe('MIME_NO_COINCIDE');
  });
  test('archivo vacio', () => {
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: new Uint8Array(0) }).code).toBe('ARCHIVO_VACIO');
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: [] }).code).toBe('ARCHIVO_VACIO');
  });
  test('tamano maximo: justo en el limite pasa, un byte mas no', () => {
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: jpeg(A.ITF_ARCHIVO_BYTES_MAX) }).ok).toBe(true);
    expect(A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: jpeg(A.ITF_ARCHIVO_BYTES_MAX + 1) }).code).toBe('ARCHIVO_DEMASIADO_GRANDE');
  });
  test('entradas que no son bytes', () => {
    [null, undefined, {}, 'texto', 42, { mimeType: 'image/jpeg' }, { mimeType: 'image/jpeg', bytes: 'FFD8FF' }, { mimeType: 'image/jpeg', bytes: null }].forEach((e) => {
      expect(A.itfArchivo_validar(e).code).toBe('INVALID_ARCHIVO');
    });
  });
  test('el error no devuelve el contenido', () => {
    const r = A.itfArchivo_validar({ mimeType: 'image/jpeg', bytes: pdf() });
    expect(JSON.stringify(r)).not.toMatch(/PDF-1|obj/);
  });
});

describe('itfArchivo_sha256Hex', () => {
  test('vector conocido: "abc"', () => {
    const abc = Uint8Array.from(Buffer.from('abc'));
    expect(A.itfArchivo_sha256Hex(abc, digestNode)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('un digest con signo (como Utilities.computeDigest) da el mismo hexadecimal', () => {
    const abc = Uint8Array.from(Buffer.from('abc'));
    const conSignoFn = (b) => conSigno(digestNode(b));
    expect(A.itfArchivo_sha256Hex(abc, conSignoFn)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test('64 caracteres hexadecimales en minuscula, y coincide con el regex del dominio', () => {
    const h = A.itfArchivo_sha256Hex(jpeg(2000), digestNode);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(A.ITF_SHA256_REGEX.test(h)).toBe(true);
  });
  test('mismo contenido, mismo hash; un byte distinto, otro hash', () => {
    const a = jpeg(100);
    const b = jpeg(100);
    b[50] = 1;
    expect(A.itfArchivo_sha256Hex(a, digestNode)).toBe(A.itfArchivo_sha256Hex(jpeg(100), digestNode));
    expect(A.itfArchivo_sha256Hex(a, digestNode)).not.toBe(A.itfArchivo_sha256Hex(b, digestNode));
  });
  test('por defecto usa Utilities.computeDigest con SHA_256 de Apps Script', () => {
    const llamadas = [];
    global.Utilities = { DigestAlgorithm: { SHA_256: 'SHA_256_FAKE' }, computeDigest: (algo, bytes) => { llamadas.push(algo); return conSigno(digestNode(bytes)); } };
    try {
      expect(A.itfArchivo_sha256Hex(Uint8Array.from(Buffer.from('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
      expect(llamadas).toEqual(['SHA_256_FAKE']);
    } finally {
      delete global.Utilities;
    }
  });
  test('un digest de largo distinto o bytes que no lo son: lanza (un hash dudoso nunca se escribe)', () => {
    expect(() => A.itfArchivo_sha256Hex(jpeg(10), () => [1, 2, 3])).toThrow(/32 bytes/);
    expect(() => A.itfArchivo_sha256Hex(jpeg(10), () => null)).toThrow();
    expect(() => A.itfArchivo_sha256Hex('texto', digestNode)).toThrow(/bytes/);
  });
});

describe('itfArchivo_nombreOriginal: solo para mostrar y auditar', () => {
  test('normal', () => {
    expect(A.itfArchivo_nombreOriginal('ITF 14-0001.jpg')).toBe('ITF 14-0001.jpg');
  });
  test('sin ruta (Windows y Unix)', () => {
    expect(A.itfArchivo_nombreOriginal('C:' + ch(92) + 'Users' + ch(92) + 'ana' + ch(92) + 'itf.png')).toBe('itf.png');
    expect(A.itfArchivo_nombreOriginal('/home/ana/itf.png')).toBe('itf.png');
  });
  test('una linea, sin controles ni direccionales', () => {
    expect(A.itfArchivo_nombreOriginal('a' + ch(10) + 'b' + ch(13) + 'c' + ch(9) + 'd')).toBe('a b c d');
    expect(A.itfArchivo_nombreOriginal('a' + ch(0) + 'b' + ch(0x202E) + 'c' + ch(0xFEFF))).toBe('abc');
    expect(A.itfArchivo_nombreOriginal('a' + ch(0x2028) + 'b')).toBe('a b');
  });
  test('acotado por caracteres unicos', () => {
    const largo = A.itfArchivo_nombreOriginal('x'.repeat(500) + '.jpg');
    expect(Array.from(largo).length).toBeLessThanOrEqual(A.ITF_NOMBRE_ORIGINAL_MAX);
    const emoji = A.itfArchivo_nombreOriginal(String.fromCodePoint(0x1F600).repeat(400));
    expect(Array.from(emoji).length).toBe(A.ITF_NOMBRE_ORIGINAL_MAX);
  });
  test('vacio o no texto: neutro', () => {
    ['', '   ', null, undefined, 5, ch(10), '/', ch(0)].forEach((n) => { expect(A.itfArchivo_nombreOriginal(n)).toBe(A.ITF_NOMBRE_ORIGINAL_NEUTRO); });
  });
  test('un nombre que empieza con "=" se conserva como texto (la hoja es de texto plano)', () => {
    expect(A.itfArchivo_nombreOriginal('=HYPERLINK("x").jpg')).toBe('=HYPERLINK("x").jpg');
  });
});
