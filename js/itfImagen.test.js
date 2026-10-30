// E9-6: pipeline de imagen del navegador (js/itfImagen.js) ejecutado de verdad con un navegador FALSO (canvas, createImageBitmap, FileReader y URL): conservar lo que ya esta bien, reducir un escaneo grande
// con la escalera de calidad / lado, aplanar sobre blanco, convertir un PNG grande a JPEG, respetar la orientacion, el mensaje cuando no se puede abrir y la liberacion del bitmap.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fuente = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const MB = 1024 * 1024;

// factor: bytes del JPEG simulado = ancho * alto * calidad * factor (para forzar que entre o no a la primera)
function cargar(opc) {
  const o = opc || {};
  const registro = { canvases: [], bitmaps: [], urls: [], liberadas: [], lecturas: [] };
  const ctx = vm.createContext({ console, Promise, Math, Number, String, Array, Object, JSON, Error, Uint8Array });
  ctx.window = ctx;
  ctx.URL = { createObjectURL: (b) => { const u = 'blob:' + (registro.urls.length + 1); registro.urls.push({ u, b }); return u; }, revokeObjectURL: (u) => { registro.liberadas.push(u); } };
  ctx.FileReader = function () {
    this.readAsDataURL = (blob) => { registro.lecturas.push(blob); setImmediate(() => { if (o.fallaLectura) { this.onerror(); } else { this.result = 'data:' + (blob.type || 'image/jpeg') + ';base64,B64-' + blob.size; this.onload(); } }); };
  };
  ctx.document = {
    createElement: (tag) => {
      const llamadas = [];
      const c = {
        tag, width: 0, height: 0, llamadas,
        getContext: () => {
          const g = { fillStyle: '', fillRect: (...a) => llamadas.push(['fillRect', g.fillStyle, ...a]), drawImage: (...a) => llamadas.push(['drawImage', ...a.slice(1)]) };
          return g;
        },
        toBlob: (cb, tipo, calidad) => {
          registro.canvases.push({ ancho: c.width, alto: c.height, tipo, calidad, llamadas });
          const size = Math.round(c.width * c.height * calidad * (o.factor || 0.2));
          setImmediate(() => { if (o.sinBlob) { cb(null); } else { cb({ size, type: tipo }); } });
        }
      };
      return c;
    }
  };
  if (o.sinBitmap) {
    ctx.Image = function () {
      setImmediate(() => { if (o.imagenRota) { this.onerror(); } else { this.naturalWidth = o.ancho; this.naturalHeight = o.alto; this.onload(); } });
      Object.defineProperty(this, 'src', { set() {} });
    };
  } else {
    ctx.createImageBitmap = jest.fn((archivo, opciones) => {
      registro.bitmaps.push({ archivo, opciones });
      if (o.imagenRota) { return Promise.reject(new Error('decode')); }
      const bmp = { width: o.ancho, height: o.alto, close: jest.fn() };
      registro.bmp = bmp;
      return Promise.resolve(bmp);
    });
    if (o.imagenRota) { ctx.Image = function () { setImmediate(() => this.onerror()); Object.defineProperty(this, 'src', { set() {} }); }; }
  }
  vm.runInContext(fuente('itfLogic.js'), ctx);
  vm.runInContext(fuente('itfImagen.js'), ctx);
  return { ctx, registro, preparar: ctx.window.itfImagen_preparar };
}

const archivo = (type, size) => ({ type, size, name: 'x' });

describe('conservar: un archivo que ya esta bien NO se toca', () => {
  test('JPEG chico y de lado razonable: mismos bytes, sin canvas, preview del propio archivo', async () => {
    const { preparar, registro } = cargar({ ancho: 2000, alto: 3000 });
    const a = archivo('image/jpeg', 1 * MB);
    const r = await preparar(a);
    expect(r).toMatchObject({ accion: 'CONSERVADA', bytes: 1 * MB, mimeType: 'image/jpeg', ancho: 2000, alto: 3000, base64: 'B64-' + MB });
    expect(registro.canvases).toEqual([]);                                  // nunca se recomprimio
    expect(registro.lecturas[0]).toBe(a);                                   // el base64 sale de los bytes ORIGINALES
    expect(registro.urls[0].b).toBe(a);
    expect(r.previewUrl).toBe('blob:1');
    expect(registro.bmp.close).toHaveBeenCalled();
  });

  test('un PNG chico se conserva como PNG', async () => {
    const { preparar, registro } = cargar({ ancho: 1500, alto: 2100 });
    const r = await preparar(archivo('image/png', 2 * MB));
    expect(r).toMatchObject({ accion: 'CONSERVADA', mimeType: 'image/png', bytes: 2 * MB });
    expect(registro.canvases).toEqual([]);
  });

  test('se decodifica respetando la orientacion (createImageBitmap con from-image)', async () => {
    const { preparar, registro } = cargar({ ancho: 2000, alto: 3000 });
    await preparar(archivo('image/jpeg', 1 * MB));
    expect(registro.bitmaps[0].opciones).toEqual({ imageOrientation: 'from-image' });
  });
});

describe('reducir: un escaneo grande se achica manteniendo la legibilidad', () => {
  test('JPEG grande: JPEG de calidad 0.92 con el lado mayor en 2400 px, fondo blanco, y entra a la primera', async () => {
    const { preparar, registro } = cargar({ ancho: 6000, alto: 4000, factor: 0.2 });
    const r = await preparar(archivo('image/jpeg', 6 * MB));
    expect(registro.canvases).toHaveLength(1);
    expect(registro.canvases[0]).toMatchObject({ ancho: 2400, alto: 1600, tipo: 'image/jpeg', calidad: 0.92 });
    expect(r).toMatchObject({ accion: 'REDUCIDA', mimeType: 'image/jpeg', ancho: 2400, alto: 1600 });
    expect(r.bytes).toBeLessThanOrEqual(2.5 * MB);
    // fondo blanco ANTES de dibujar (una transparencia no sale negra)
    const llamadas = registro.canvases[0].llamadas;
    expect(llamadas[0]).toEqual(['fillRect', '#ffffff', 0, 0, 2400, 1600]);
    expect(llamadas[1][0]).toBe('drawImage');
    expect(r.previewUrl).toBe('blob:1');                                    // el preview es la imagen que REALMENTE se envia
    expect(registro.urls[0].b.size).toBe(r.bytes);
  });

  test('un PNG grande se convierte a JPEG', async () => {
    const { preparar, registro } = cargar({ ancho: 3000, alto: 4000, factor: 0.1 });
    const r = await preparar(archivo('image/png', 9 * MB));
    expect(r).toMatchObject({ accion: 'REDUCIDA', mimeType: 'image/jpeg' });
    expect(registro.canvases[0].tipo).toBe('image/jpeg');
  });

  test('si no entra a la primera baja la CALIDAD (0.92 -> 0.88 -> ...) y mantiene el lado; para apenas entra', async () => {
    const { preparar, registro } = cargar({ ancho: 6000, alto: 4000, factor: 0.8 });          // 2400x1600x calidad x 0.8
    const r = await preparar(archivo('image/jpeg', 8 * MB));
    const calidades = registro.canvases.map((c) => c.calidad);
    expect(calidades).toEqual([0.92, 0.88, 0.84, 0.80, 0.76].slice(0, calidades.length));
    expect(calidades.length).toBeGreaterThan(1);
    registro.canvases.forEach((c) => expect(c.ancho).toBe(2400));
    expect(r.bytes).toBeLessThanOrEqual(L().ITF_IMG_OBJETIVO_BYTES);
    function L() { return { ITF_IMG_OBJETIVO_BYTES: Math.floor(2.5 * MB) }; }
  });

  test('si la calidad no alcanza baja el LADO (con la calidad alta otra vez), sin pasar de 1600 ni de 0.76', async () => {
    const { preparar, registro } = cargar({ ancho: 6000, alto: 4000, factor: 1.4 });
    const r = await preparar(archivo('image/jpeg', 20 * MB));
    const lados = registro.canvases.map((c) => Math.max(c.ancho, c.alto));
    expect(Math.min.apply(null, lados)).toBeGreaterThanOrEqual(1600);
    expect(registro.canvases.every((c) => c.calidad >= 0.76)).toBe(true);
    expect(lados[0]).toBe(2400);
    expect(lados.some((l) => l < 2400)).toBe(true);
    const primeroConLadoMenor = registro.canvases.find((c) => Math.max(c.ancho, c.alto) < 2400);
    expect(primeroConLadoMenor.calidad).toBe(0.92);
    expect(r.accion).toBe('REDUCIDA');
  });

  test('si ni asi entra, devuelve lo ultimo (el flujo de proponer lo BLOQUEA por tamano); la escalera se agota en 1600 px y 0.76', async () => {
    const { preparar, registro } = cargar({ ancho: 6000, alto: 4000, factor: 6 });
    const r = await preparar(archivo('image/jpeg', 30 * MB));
    const ultimo = registro.canvases[registro.canvases.length - 1];
    expect(Math.max(ultimo.ancho, ultimo.alto)).toBe(1600);
    expect(ultimo.calidad).toBe(0.76);
    expect(r.bytes).toBeGreaterThan(3 * MB);
  });

  test('un canvas se libera (se pone a 0) despues de cada intento', async () => {
    const { preparar, ctx } = cargar({ ancho: 6000, alto: 4000, factor: 0.8 });
    const creados = [];
    const original = ctx.document.createElement;
    ctx.document.createElement = (t) => { const c = original(t); creados.push(c); return c; };
    await preparar(archivo('image/jpeg', 8 * MB));
    expect(creados.length).toBeGreaterThan(1);
    creados.forEach((c) => { expect(c.width).toBe(0); expect(c.height).toBe(0); });
  });
});

describe('errores', () => {
  test('si el navegador no puede abrir la imagen: Error DECODIFICAR con mensaje humano', async () => {
    const { preparar } = cargar({ ancho: 100, alto: 100, imagenRota: true });
    await expect(preparar(archivo('image/jpeg', 1000))).rejects.toMatchObject({ message: 'DECODIFICAR', mensaje: 'No se pudo abrir la imagen. Probá con otra.' });
  });

  test('si el canvas no produce un blob: mismo error', async () => {
    const { preparar } = cargar({ ancho: 6000, alto: 4000, sinBlob: true });
    await expect(preparar(archivo('image/jpeg', 8 * MB))).rejects.toMatchObject({ message: 'DECODIFICAR' });
  });

  test('si falla la lectura del archivo: mismo error', async () => {
    const { preparar } = cargar({ ancho: 2000, alto: 3000, fallaLectura: true });
    await expect(preparar(archivo('image/jpeg', 1 * MB))).rejects.toMatchObject({ message: 'DECODIFICAR' });
  });

  test('sin createImageBitmap usa <img> (navegadores viejos) y funciona igual', async () => {
    const { preparar, registro } = cargar({ ancho: 2000, alto: 3000, sinBitmap: true });
    const r = await preparar(archivo('image/jpeg', 1 * MB));
    expect(r.accion).toBe('CONSERVADA');
    expect(registro.urls.length).toBeGreaterThanOrEqual(1);
  });
});
