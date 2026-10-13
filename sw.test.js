const fs = require('fs');
const path = require('path');
const { SHELL_FILES, CACHE_NAME } = require('./sw');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const fuenteSw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');

// Chequeo barato que evita una clase real de bug: si SHELL_FILES tiene un
// path con un typo, o alguien borra/renombra un archivo del shell sin
// actualizar la lista, el precache de ese archivo falla en el install del
// Service Worker (queda sin cachear). Esto no requiere un entorno de
// navegador/SW, solo verifica que los archivos existan en el repo.
describe('sw.js: SHELL_FILES apunta a archivos reales del repo', () => {
  const archivos = SHELL_FILES.filter((f) => f !== './');

  test.each(archivos)('%s existe', (relativePath) => {
    const limpio = relativePath.replace(/^\.\//, '');
    const rutaCompleta = path.join(__dirname, limpio);
    expect(fs.existsSync(rutaCompleta)).toBe(true);
  });

  test('sin duplicados y todos con prefijo "./" (claves de cache consistentes)', () => {
    expect(new Set(SHELL_FILES).size).toBe(SHELL_FILES.length);
    SHELL_FILES.forEach((f) => expect(f.startsWith('./')).toBe(true));
  });
});

// El shell de la PWA tiene que ser TODO lo que index.html carga al arrancar: si un deploy agrega un <script> y el precache no lo incluye, una
// instalacion/actualizacion seguida de una apertura SIN conexion deja a index.html apuntando a un JS que no esta disponible.
describe('sw.js: el precache cubre todo lo que index.html carga localmente', () => {
  const locales = (re) => [...html.matchAll(re)].map((m) => m[1]).filter((u) => !/^(https?:)?\/\//.test(u) && u.indexOf('data:') !== 0);
  const scripts = locales(/<script[^>]*\ssrc="([^"]+)"/g);
  const links = locales(/<link[^>]*\shref="([^"]+)"/g);
  const enShell = (u) => SHELL_FILES.indexOf('./' + u) !== -1;

  test('index.html tiene scripts locales (el chequeo no es vacio)', () => {
    expect(scripts.length).toBeGreaterThan(25);
  });

  test.each(scripts)('script %s esta en SHELL_FILES', (u) => {
    expect(enShell(u)).toBe(true);
  });

  test.each(links)('link %s (hoja de estilos, manifest, icono) esta en SHELL_FILES', (u) => {
    expect(enShell(u)).toBe(true);
  });

  test('las correcciones de ubicacion (logica y controlador) forman parte del shell', () => {
    expect(SHELL_FILES).toContain('./js/ubicacionCorreccionLogic.js');
    expect(SHELL_FILES).toContain('./js/ubicacionCorreccion.js');
    expect(html).toContain('src="js/ubicacionCorreccionLogic.js"');
    expect(html).toContain('src="js/ubicacionCorreccion.js"');
  });

  test('el modulo de conversion de coordenadas (Ingresar coordenadas) forma parte del shell: disponible SIN conexion', () => {
    expect(SHELL_FILES).toContain('./js/coordenadasConversion.js');
    expect(html).toContain('src="js/coordenadasConversion.js"');
    // y se carga antes que la logica que lo usa, tambien en el precache (mismo orden que en index.html)
    expect(SHELL_FILES.indexOf('./js/coordenadasConversion.js')).toBeLessThan(SHELL_FILES.indexOf('./js/ubicacionCorreccionLogic.js'));
  });

  test('el propio index.html y la raiz estan precacheados', () => {
    expect(SHELL_FILES).toContain('./');
    expect(SHELL_FILES).toContain('./index.html');
  });

  test('lo que se carga bajo demanda (vendor/*) no es del shell: no se cuela en la lista', () => {
    SHELL_FILES.forEach((f) => expect(f.indexOf('vendor/')).toBe(-1));
    expect(html).not.toMatch(/<script[^>]*\ssrc="vendor\//);
  });
});

// Ejecuta el handler "install" real de sw.js con un cache y un Request simulados.
describe('sw.js: install', () => {
  async function instalar(opciones) {
    const o = opciones || {};
    const manejadores = {};
    const cache = { pedidos: [], add: jest.fn((req) => { cache.pedidos.push(req); return o.falla && o.falla(req) ? Promise.reject(new Error('sin red')) : Promise.resolve(); }) };
    const guardado = { self: global.self, caches: global.caches, Request: global.Request, error: console.error };
    global.self = { addEventListener: (t, f) => { manejadores[t] = f; }, skipWaiting: jest.fn(), clients: { claim: jest.fn() } };
    global.caches = { open: jest.fn((nombre) => { cache.nombre = nombre; return Promise.resolve(cache); }) };
    global.Request = function (url, init) { this.url = url; this.cache = init && init.cache; };
    console.error = jest.fn();
    let espera = null;
    let resultado = null;
    try {
      jest.isolateModules(() => { require('./sw'); });
      manejadores.install({ waitUntil: (p) => { espera = p; } });
      resultado = await espera;            // los simulados siguen puestos hasta que termina el precache asincrono
    } finally {
      global.self = guardado.self; global.caches = guardado.caches; global.Request = guardado.Request; console.error = guardado.error;
    }
    return { cache, resultado, self: manejadores };
  }

  test('precachea CADA archivo del shell (incluidos los 2 JS de correcciones) en la cache del shell', async () => {
    const r = await instalar();
    expect(r.cache.nombre).toBe(CACHE_NAME);
    expect(r.cache.pedidos.map((p) => p.url)).toEqual(SHELL_FILES);
    expect(r.cache.pedidos.map((p) => p.url)).toContain('./js/ubicacionCorreccionLogic.js');
    expect(r.cache.pedidos.map((p) => p.url)).toContain('./js/ubicacionCorreccion.js');
  });

  test('el install precachea js/coordenadasConversion.js (con cache: "reload"): la conversion funciona offline', async () => {
    const r = await instalar();
    const pedido = r.cache.pedidos.find((p) => p.url === './js/coordenadasConversion.js');
    expect(pedido).toBeDefined();
    expect(pedido.cache).toBe('reload');
  });

  test('si falla el precache de coordenadasConversion.js los demas archivos igual se cachean (y el fallo no rompe el install)', async () => {
    const r = await instalar({ falla: (req) => req.url === './js/coordenadasConversion.js' });
    expect(r.cache.pedidos).toHaveLength(SHELL_FILES.length);
  });

  test('cada precache ignora la cache HTTP (cache: "reload"): el shell es de la misma version que el sw.js nuevo', async () => {
    const r = await instalar();
    r.cache.pedidos.forEach((p) => expect(p.cache).toBe('reload'));
    expect(fuenteSw).toMatch(/new Request\(url, \{ cache: 'reload' \}\)/);
  });

  test('un archivo que falla no impide cachear los demas (el install no se cae)', async () => {
    const r = await instalar({ falla: (req) => req.url === './js/mapa.js' });          // si el install rechazara, instalar() lanzaria
    expect(r.cache.pedidos).toHaveLength(SHELL_FILES.length);
    expect(r.cache.pedidos.map((p) => p.url)).toContain('./js/app.js');
  });
});
