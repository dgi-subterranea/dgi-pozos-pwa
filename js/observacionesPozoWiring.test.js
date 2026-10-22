// Cableado de Observaciones del pozo (E5-4, solo lectura): index.html (pantalla y scripts en orden), tarjeta del hub (solo con observaciones===true, sin llamada extra), navegacion,
// defaults de permisos, cliente API (solo getObservacionesPozo), service worker, CSS responsive y guardas de fuente (nada de innerHTML, storage, console, URL; sin alta ni anulacion).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const app = leer(__dirname, 'app.js');
const api = leer(__dirname, 'api.js');
const logica = leer(__dirname, 'observacionesPozoLogic.js');
const controlador = leer(__dirname, 'observacionesPozo.js');
const { SHELL_FILES } = require('../sw');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const codigoApp = sinComentarios(app);
const codigoLogica = sinComentarios(logica);
const codigoControlador = sinComentarios(controlador);

describe('index.html: pantalla propia y scripts', () => {
  const ids = ['screen-observaciones', 'btn-observaciones-volver', 'observaciones-entidad', 'observaciones-cargando', 'observaciones-error', 'observaciones-error-texto', 'btn-observaciones-reintentar',
    'observaciones-contenido', 'observaciones-vacio', 'observaciones-lista', 'observaciones-error-mas', 'btn-observaciones-mas'];

  test.each(ids.map((i) => [i]))('existe #%s (una sola vez)', (id) => {
    expect(html.split('id="' + id + '"')).toHaveLength(2);
  });

  test('la pantalla arranca oculta, es una pantalla de modulo y no se mezcla con Datos / Reemplazo / Ubicacion / Fotos', () => {
    expect(html).toMatch(/<div id="screen-observaciones" class="screen" hidden>/);
    const bloque = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<!-- Visor de la galeria de fotos de pozos'));
    expect(bloque).not.toMatch(/screen-datos|screen-reemplazo|screen-ubicacion|screen-fotos|fotos-|reemplazo-form|fotos-nota/);
  });

  test('estado vacio con el texto pedido; lista semantica; boton "Ver observaciones anteriores"; sin botones de alta ni de anulacion', () => {
    expect(html).toContain('Este pozo todavía no tiene observaciones.');
    expect(html).toMatch(/<ol id="observaciones-lista" class="obs-lista"/);
    expect(html).toContain('Ver observaciones anteriores');
    const bloque = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<!-- Visor de la galeria de fotos de pozos'));
    expect(bloque).not.toMatch(/agregar|anular|<textarea|<form|<input/i);
  });

  test('el estado vacio, el error y el "cargando" arrancan ocultos (la pantalla no muestra nada hasta tener datos)', () => {
    ['observaciones-cargando', 'observaciones-error', 'observaciones-contenido', 'observaciones-vacio', 'observaciones-error-mas', 'btn-observaciones-mas'].forEach((id) => {
      expect(html).toMatch(new RegExp('id="' + id + '"[^>]*\\bhidden\\b'));
    });
  });

  test('scripts: reemplazoLogic.js (fecha) -> observacionesPozoLogic.js -> observacionesPozo.js -> app.js, y api.js antes de todos', () => {
    const pos = (n) => html.indexOf('<script src="js/' + n + '"></script>');
    ['api.js', 'reemplazoLogic.js', 'observacionesPozoLogic.js', 'observacionesPozo.js', 'app.js'].forEach((n) => expect(pos(n)).toBeGreaterThan(-1));
    expect(pos('api.js')).toBeLessThan(pos('reemplazoLogic.js'));
    expect(pos('reemplazoLogic.js')).toBeLessThan(pos('observacionesPozoLogic.js'));
    expect(pos('observacionesPozoLogic.js')).toBeLessThan(pos('observacionesPozo.js'));
    expect(pos('observacionesPozo.js')).toBeLessThan(pos('app.js'));
  });

  test('sin handlers inline en la pantalla', () => {
    const bloque = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<!-- Visor de la galeria de fotos de pozos'));
    expect(bloque).not.toMatch(/\son[a-z]+=/i);
  });
});

describe('service worker', () => {
  test('los dos JS nuevos estan en el shell (precache); el listado sigue cubriendo todo <script src>', () => {
    expect(SHELL_FILES).toContain('./js/observacionesPozoLogic.js');
    expect(SHELL_FILES).toContain('./js/observacionesPozo.js');
    const scripts = Array.from(html.matchAll(/<script src="(js\/[^"]+)"><\/script>/g)).map((m) => './' + m[1]);
    scripts.forEach((s) => expect(SHELL_FILES).toContain(s));
  });

  test('las respuestas del API no se cachean (la estrategia sigue siendo la de siempre: Apps Script nunca pasa por el cache)', () => {
    const sw = leer(raiz, 'sw.js');
    expect(sw).toMatch(/isExternalApi/);
    expect(sw).not.toMatch(/getObservacionesPozo/);
  });
});

describe('cliente API: solo lectura', () => {
  test('apiGetObservacionesPozo manda sessionToken, wellId, limit y antesDeSecuencia por el POST text/plain de siempre', () => {
    expect(api).toMatch(/function apiGetObservacionesPozo\(sessionToken, wellId, limit, antesDeSecuencia\)/);
    expect(api).toMatch(/callBackend\('getObservacionesPozo', \{ sessionToken: sessionToken, wellId: wellId, limit: limit, antesDeSecuencia: antesDeSecuencia \}\)/);
    expect(api).toMatch(/'Content-Type': 'text\/plain;charset=utf-8'/);
  });

  test('no existen todavia los wrappers de alta ni de anulacion (E5-5 / E5-6)', () => {
    expect(api).not.toMatch(/agregarObservacionPozo|anularObservacionPozo|apiAgregarObservacion|apiAnularObservacion/);
    [app, logica, controlador, html].forEach((t) => expect(t).not.toMatch(/agregarObservacionPozo|anularObservacionPozo/));
  });

  test('el wrapper manda exactamente esa accion (ejecutado con un fetch falso)', async () => {
    const vm = require('vm');
    const llamadas = [];
    const ctx = vm.createContext({ JSON, Object, Promise, fetch: (url, opts) => { llamadas.push({ url, opts }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); } });
    vm.runInContext(api, ctx);
    await ctx.apiGetObservacionesPozo('tok', '14-0001', 50, 7);
    await ctx.apiGetObservacionesPozo('tok', '14-0001', 50, undefined);
    const cuerpo = (i) => JSON.parse(llamadas[i].opts.body);
    expect(cuerpo(0)).toEqual({ action: 'getObservacionesPozo', sessionToken: 'tok', wellId: '14-0001', limit: 50, antesDeSecuencia: 7 });
    expect(cuerpo(1)).toEqual({ action: 'getObservacionesPozo', sessionToken: 'tok', wellId: '14-0001', limit: 50 });
    expect(llamadas[0].opts.method).toBe('POST');
    expect(llamadas[0].opts.headers['Content-Type']).toBe('text/plain;charset=utf-8');
  });
});

describe('hub: tarjeta, permisos y navegacion', () => {
  test('la tarjeta se agrega SOLO con observacionesPozoLogic_puedeVer(permisosActuales) (===true), con titulo y copy pedidos, y sin contador', () => {
    expect(codigoApp).toMatch(/if \(observacionesPozoLogic_puedeVer\(permisosActuales\)\) \{\s*modulos\.push\(\{ id: 'observaciones', titulo: 'Observaciones', desc: 'Contexto y novedades del pozo', icono: ICON_OBSERVACIONES \}\);/);
    expect(codigoApp.match(/id: 'observaciones'/g)).toHaveLength(1);
  });

  test('ningun otro lugar de app.js decide la tarjeta por truthiness del permiso', () => {
    expect(codigoApp).not.toMatch(/permisosActuales\.observaciones\b(?!_)/);
    expect(codigoApp).not.toMatch(/permisosActuales\.observaciones_(agregar|anular)/);        // alta / anulacion: E5-5 / E5-6
  });

  test('la tarjeta NO dispara getObservacionesPozo: ni el hub ni la busqueda lo llaman', () => {
    expect(app).not.toMatch(/apiGetObservacionesPozo|getObservacionesPozo/);
    expect(codigoApp.match(/observacionesPozoController_abrir\(/g)).toHaveLength(1);
    const abrir = codigoApp.slice(codigoApp.indexOf('function abrirObservaciones('));
    expect(abrir.slice(0, abrir.indexOf('\n  }\n'))).toMatch(/observacionesPozoController_abrir\(wellId\)/);
    // buscarPozo sigue pidiendo solo ITF / registro / ubicacion / NE
    const busqueda = codigoApp.slice(codigoApp.indexOf('var pItf = '), codigoApp.indexOf('var pItf = ') + 900);
    expect(busqueda).not.toMatch(/bservacion/);
  });

  test('abrir la pantalla: solo desde la tarjeta (abrirModulo), con el wellId del pozo actual, y con defensa del permiso', () => {
    expect(codigoApp).toMatch(/\} else if \(id === 'observaciones'\) \{\s*abrirObservaciones\(pozoActual\.wellId\);/);
    expect(codigoApp).toMatch(/function abrirObservaciones\(wellId\) \{\s*if \(!observacionesPozoLogic_puedeVer\(permisosActuales\) \|\| typeof wellId !== 'string'\) \{\s*return;/);
    expect(codigoApp).toMatch(/showScreen\('observaciones'\);\s*observacionesPozoController_abrir\(wellId\);/);
  });

  test('Volver cierra el controlador y regresa al hub (mismo pozo: pozoActual no se toca, sin busqueda nueva)', () => {
    expect(codigoApp).toMatch(/getElementById\('btn-observaciones-volver'\)\.addEventListener\('click', function \(\) \{\s*observacionesPozoController_cerrar\(\);\s*showScreen\('main'\);\s*\}\);/);
    const volver = codigoApp.slice(codigoApp.indexOf("getElementById('btn-observaciones-volver')"), codigoApp.indexOf("getElementById('btn-observaciones-volver')") + 250);
    expect(volver).not.toMatch(/pozoActual\s*=|buscarPozo|apiGet/);
  });

  test('la pantalla esta registrada en screens y se oculta como las demas', () => {
    expect(codigoApp).toMatch(/observaciones: document\.getElementById\('screen-observaciones'\)/);
  });

  test('el controlador se inicializa con la sesion y los permisos FRESCOS, y cerrar sesion lo resetea', () => {
    expect(codigoApp).toMatch(/observacionesPozoController_inicializar\(function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);/);
    const logout = codigoApp.slice(codigoApp.indexOf('function logout()'), codigoApp.indexOf('function logout()') + 1800);
    expect(logout).toMatch(/observacionesPozoController_reset\(\)/);
  });

  test('defaults de permisos: las tres claves nuevas en false en todos los objetos de permisos del frontend', () => {
    const objetos = codigoApp.match(/permisosActuales = \{ perfil: false[^}]*\}/g);
    expect(objetos).toHaveLength(2);                                    // inicial y logout
    objetos.forEach((o) => {
      expect(o).toContain('observaciones: false');
      expect(o).toContain('observaciones_agregar: false');
      expect(o).toContain('observaciones_anular: false');
    });
  });

  test('compatibilidad con un backend viejo sin las claves: los permisos se asignan tal cual y el chequeo es ===true (ausente = false)', () => {
    expect(codigoApp.match(/permisosActuales = result\.data\.permisos \|\| permisosActuales;/g)).toHaveLength(2);
    const L = require('./observacionesPozoLogic');
    expect(L.observacionesPozoLogic_puedeVer({ perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: true, fotos: true, fotos_carga: true, ubicacion_corregir: true, ubicacion_validar: true })).toBe(false);
  });
});

describe('privacidad y seguridad de la fuente (sin comentarios)', () => {
  test.each([['logica', codigoLogica], ['controlador', codigoControlador]])('%s: no usa innerHTML / outerHTML / insertAdjacentHTML / document.write / eval / Function', (_n, codigo) => {
    expect(codigo).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]on/);
  });

  test.each([['logica', codigoLogica], ['controlador', codigoControlador]])('%s: no escribe en console, storage, URL/hash, history ni cookies', (_n, codigo) => {
    expect(codigo).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|\bcaches\b|document\.cookie|location\.|history\.|URLSearchParams|encodeURIComponent|navigator\./);
  });

  test.each([['logica', codigoLogica], ['controlador', codigoControlador]])('%s: no nombra email, clientRequestId ni secuencia (lista blanca; nunca los espera ni los muestra)', (_n, codigo) => {
    expect(codigo).not.toMatch(/\bemail\b|clientRequestId|secuencia/i);
  });

  test('el controlador solo crea li y p y pone todo texto con textContent', () => {
    const creados = codigoControlador.match(/createElement\([^)]*\)|nodo\('[a-z]+'/g) || [];
    expect(creados.length).toBeGreaterThan(0);
    expect(codigoControlador).toMatch(/n\.textContent = texto/);
    expect(codigoControlador).toMatch(/nodo\('li'/);
    expect(codigoControlador.match(/nodo\('([a-z]+)'/g).every((s) => /nodo\('(li|p)'/.test(s))).toBe(true);
  });

  test('la fecha usa el helper existente de Reemplazo (hora de Mendoza), sin inventar otra politica de huso', () => {
    expect(codigoLogica).toMatch(/reemplazoLogic_formatearFecha\(iso\)/);
    expect(codigoLogica).not.toMatch(/toLocale|getTimezoneOffset|Intl\./);
  });

  test('el frontend de lectura no escribe nada en el backend: unica accion de red = getObservacionesPozo', () => {
    expect(codigoControlador.match(/apiGet\w+|api[A-Z]\w+\(/g)).toEqual(['apiGetObservacionesPozo']);
    expect(codigoLogica).not.toMatch(/fetch\(|XMLHttpRequest|callBackend|api[A-Z]\w+\(/);
  });
});

describe('CSS: responsive, saltos de linea y palabras largas', () => {
  const regla = (sel) => {
    const i = css.indexOf('\n' + sel + ' {');
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };

  test('.obs-texto respeta los saltos de linea y rompe palabras largas', () => {
    const r = regla('.obs-texto');
    expect(r).toMatch(/white-space:\s*pre-wrap/);
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('metadatos, categoria y motivo tambien rompen palabras largas; el motivo conserva saltos de linea', () => {
    ['.obs-meta', '.obs-categoria'].forEach((s) => expect(regla(s)).toMatch(/overflow-wrap:\s*anywhere/));
    expect(regla('.obs-motivo')).toMatch(/white-space:\s*pre-wrap/);
    expect(regla('.obs-motivo')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('cada item puede encogerse (min-width: 0) y la lista no tiene anchos fijos: sin scroll horizontal a 375 px', () => {
    expect(regla('.obs-item')).toMatch(/min-width:\s*0/);
    const bloque = css.slice(css.indexOf('/* --- Observaciones del pozo (E5-4'));
    expect(bloque.slice(0, bloque.indexOf('@media'))).not.toMatch(/(^|[^-])width:\s*\d+px|min-width:\s*\d+px|white-space:\s*nowrap/);
    expect(bloque).toMatch(/@media \(min-width: 640px\)/);
  });

  test('la anulada se distingue por forma (borde punteado, titulo en texto) y el original queda subordinado (mas chico, apagado)', () => {
    expect(regla('.obs-item-anulada')).toMatch(/border-style:\s*dashed/);
    expect(regla('.obs-texto-original')).toMatch(/font-size:\s*0\.85rem/);
    expect(regla('.obs-texto-original')).toMatch(/color:\s*var\(--color-text-soft\)/);
    expect(regla('.obs-anulada-titulo')).toMatch(/font-weight:\s*700/);
  });
});
