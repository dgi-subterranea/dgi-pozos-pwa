// Regresion del pipeline de imagen compartido (js/fotosImagen.js), que reemplazo
// las funciones privadas de js/reemplazoFotos.js: el CONTRATO de FotosReemplazo
// (1600 px, escalera de calidad 0.72 -> 0.62 -> 0.52, objetivo 1,5 MB, miniatura
// 256 px q0.6, errores DECODIFICAR / COMPRIMIR_GRANDE y los campos que consume
// el controlador) no puede cambiar. Se prueba con un DOM simulado (canvas,
// FileReader, createImageBitmap): el tamano de cada blob lo decide el test.
const fs = require('fs');
const path = require('path');
const logica = require('./reemplazoFotosLogic');
// reemplazoFotosLogic.js no exporta la calidad de la miniatura (en el navegador es
// una global): se lee del propio archivo para verificar el valor REAL.
const THUMB_CALIDAD = parseFloat(/REEMPLAZO_FOTOS_THUMB_CALIDAD = ([\d.]+);/.exec(fs.readFileSync(path.join(__dirname, 'reemplazoFotosLogic.js'), 'utf8'))[1]);

function instalarDom(opciones) {
  const o = Object.assign({ ancho: 4000, alto: 3000, tamanos: { 0.72: 400000, 0.6: 20000 }, bitmapFalla: false, bitmapSinOpcionesFalla: false }, opciones || {});
  const registro = { canvases: [], bitmapLlamadas: [], liberados: 0 };

  global.window = global;
  Object.assign(global, logica, { REEMPLAZO_FOTOS_THUMB_CALIDAD: THUMB_CALIDAD });
  global.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') { throw new Error('solo canvas'); }
      const canvas = {
        width: 0, height: 0,
        getContext: () => ({ fillStyle: '', fillRect() {}, drawImage() {} }),
        toBlob(cb, tipo, calidad) {
          registro.canvases.push({ ancho: canvas.width, alto: canvas.height, tipo, calidad });
          const tam = o.tamanos[calidad];
          cb(tam === undefined ? null : { size: tam, calidad });
        }
      };
      return canvas;
    }
  };
  global.FileReader = function () {
    this.readAsDataURL = (blob) => { this.result = 'data:image/jpeg;base64,B64-' + blob.size; this.onload(); };
    this.readAsArrayBuffer = (blob) => { this.result = new Uint8Array([1, 2, 3]).buffer; this.onload(); };
  };
  global.createImageBitmap = (archivo, opts) => {
    registro.bitmapLlamadas.push(opts || null);
    if (o.bitmapFalla) { return Promise.reject(new Error('x')); }
    if (opts && o.bitmapSinOpcionesFalla) { return Promise.reject(new Error('sin opciones')); }
    return Promise.resolve({ width: o.ancho, height: o.alto, close: () => { registro.liberados += 1; } });
  };
  return registro;
}

function cargarModulo() {
  jest.resetModules();
  delete global.fotosImagen_comprimir;
  require('./fotosImagen');
  return global.fotosImagen_comprimir;
}

afterEach(() => {
  ['window', 'document', 'FileReader', 'createImageBitmap'].forEach((k) => { delete global[k]; });
  delete global.REEMPLAZO_FOTOS_THUMB_CALIDAD; delete global.fotosImagen_comprimir; delete global.fotosImagen_leerBytes; delete global.fotosImagen_sha1;
});

describe('fotosImagen_comprimir: contrato de FotosReemplazo', () => {
  test('JPG normal: 1600 px, calidad 0.72, miniatura 256 px q0.6 y exactamente los campos que consume reemplazoFotos.js', async () => {
    const reg = instalarDom();
    const r = await cargarModulo()({ size: 5000000 });
    expect(Object.keys(r).sort()).toEqual(['alto', 'ancho', 'base64', 'bytes', 'calidad', 'ladoMayor', 'thumbBase64', 'thumbBytes']);
    expect(r).toMatchObject({ ancho: 1600, alto: 1200, bytes: 400000, calidad: 0.72, ladoMayor: 1600, thumbBytes: 20000 });
    expect(r.base64).toBe('B64-400000');
    expect(r.thumbBase64).toBe('B64-20000');
    expect(reg.canvases).toEqual([
      { ancho: 1600, alto: 1200, tipo: 'image/jpeg', calidad: 0.72 },
      { ancho: 256, alto: 192, tipo: 'image/jpeg', calidad: 0.6 }
    ]);
    expect(reg.liberados).toBe(1);
  });

  test('vertical: el lado mayor es el alto y tambien se reduce a 1600', async () => {
    instalarDom({ ancho: 3000, alto: 4000 });
    const r = await cargarModulo()({});
    expect(r).toMatchObject({ ancho: 1200, alto: 1600, ladoMayor: 1600 });
  });

  test('una foto chica no se agranda', async () => {
    instalarDom({ ancho: 800, alto: 600 });
    const r = await cargarModulo()({});
    expect(r).toMatchObject({ ancho: 800, alto: 600, ladoMayor: 800 });
  });

  test('escalera de calidad: si 0.72 pasa de 1,5 MB prueba 0.62 y luego 0.52', async () => {
    const reg = instalarDom({ tamanos: { 0.72: 2000000, 0.62: 1700000, 0.52: 1200000, 0.6: 15000 } });
    const r = await cargarModulo()({});
    expect(r.calidad).toBe(0.52);
    expect(r.bytes).toBe(1200000);
    expect(reg.canvases.filter((c) => c.ancho === 1600).map((c) => c.calidad)).toEqual([0.72, 0.62, 0.52]);
  });

  test('para en la primera calidad que entra en 1,5 MB', async () => {
    const reg = instalarDom({ tamanos: { 0.72: 1900000, 0.62: 1400000, 0.6: 15000 } });
    const r = await cargarModulo()({});
    expect(r.calidad).toBe(0.62);
    expect(reg.canvases.filter((c) => c.ancho === 1600).length).toBe(2);
  });

  test('si ni a la calidad minima entra: COMPRIMIR_GRANDE (y se libera la imagen)', async () => {
    const reg = instalarDom({ tamanos: { 0.72: 3000000, 0.62: 2500000, 0.52: 1700000, 0.6: 15000 } });
    await expect(cargarModulo()({})).rejects.toThrow('COMPRIMIR_GRANDE');
    expect(reg.liberados).toBe(1);
  });

  test('imagen que el navegador no puede abrir: DECODIFICAR', async () => {
    instalarDom({ bitmapFalla: true });
    // sin createImageBitmap utilizable cae a <img>, que tambien falla
    global.Image = function () { setTimeout(() => this.onerror(), 0); };
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
    await expect(cargarModulo()({})).rejects.toThrow('DECODIFICAR');
    delete global.Image; delete global.URL.createObjectURL;
  });

  test('toBlob sin resultado: DECODIFICAR', async () => {
    instalarDom({ tamanos: {} });
    await expect(cargarModulo()({})).rejects.toThrow('DECODIFICAR');
  });

  test('respeta la orientacion: pide imageOrientation "from-image" y, si el navegador no lo admite, reintenta sin opciones', async () => {
    const reg = instalarDom({ bitmapSinOpcionesFalla: true });
    await cargarModulo()({});
    expect(reg.bitmapLlamadas).toEqual([{ imageOrientation: 'from-image' }, null]);
  });

  test('las constantes del contrato no cambiaron', () => {
    expect(logica.REEMPLAZO_FOTOS_MAX_DIM).toBe(1600);
    expect(logica.REEMPLAZO_FOTOS_THUMB_DIM).toBe(256);
    expect(THUMB_CALIDAD).toBe(0.6);
    expect(logica.REEMPLAZO_FOTOS_CALIDADES).toEqual([0.72, 0.62, 0.52]);
    expect(logica.REEMPLAZO_FOTOS_OBJETIVO_BYTES).toBe(1.5 * 1024 * 1024);
    expect(logica.REEMPLAZO_FOTOS_MAX).toBe(5);
  });
});

describe('helpers de la galeria general (no afectan a Reemplazos)', () => {
  test('leerBytes devuelve la cabecera y nunca rechaza', async () => {
    instalarDom();
    cargarModulo();
    const bytes = await global.fotosImagen_leerBytes({ slice: () => ({}) }, 0, 10);
    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    const vacio = await global.fotosImagen_leerBytes({ slice: () => { throw new Error('x'); } }, 0, 10);
    expect(vacio.length).toBe(0);
  });

  test('sha1 sin crypto.subtle devuelve vacio (la subida funciona igual)', async () => {
    instalarDom();
    cargarModulo();
    const original = Object.getOwnPropertyDescriptor(global, 'crypto');
    Object.defineProperty(global, 'crypto', { value: undefined, configurable: true });
    try {
      expect(await global.fotosImagen_sha1({})).toBe('');
    } finally {
      if (original) { Object.defineProperty(global, 'crypto', original); } else { delete global.crypto; }
    }
  });
});
