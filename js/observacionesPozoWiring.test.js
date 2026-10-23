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
    const bloque = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<div id="observaciones-form-overlay"'));
    expect(bloque).not.toMatch(/screen-datos|screen-reemplazo|screen-ubicacion|screen-fotos|fotos-|reemplazo-form|fotos-nota/);
  });

  test('estado vacio con el texto pedido; lista semantica; boton "Ver observaciones anteriores"; boton "Agregar observacion" (E5-5) pero ningun control de anulacion', () => {
    expect(html).toContain('Este pozo todavía no tiene observaciones.');
    expect(html).toMatch(/<ol id="observaciones-lista" class="obs-lista"/);
    expect(html).toContain('Ver observaciones anteriores');
    const bloque = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<div id="observaciones-form-overlay"'));
    expect(bloque).toMatch(/id="btn-observaciones-agregar"[^>]*>Agregar observación<\/button>/);
    expect(bloque).not.toMatch(/anular|anulaci[oó]n/i);
    expect(bloque).not.toMatch(/<textarea|<form|<input/i);                    // el formulario vive en el modal, fuera de la pantalla
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

  test('sin handlers inline en la pantalla ni en el modal', () => {
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

  test('existen los wrappers del alta (E5-5) y de la anulacion (E5-6), y NO hay ninguno de edicion; app.js no los conoce (solo cablea hub / navegacion)', () => {
    expect(api).toMatch(/function apiAgregarObservacionPozo\(sessionToken, wellId, texto, clientRequestId\)/);
    expect(api).toMatch(/callBackend\('agregarObservacionPozo', \{ sessionToken: sessionToken, wellId: wellId, texto: texto, clientRequestId: clientRequestId \}\)/);
    expect(api).toMatch(/function apiAnularObservacionPozo\(sessionToken, observacionId, motivo, clientRequestId\)/);
    expect(api).toMatch(/callBackend\('anularObservacionPozo', \{ sessionToken: sessionToken, observacionId: observacionId, motivo: motivo, clientRequestId: clientRequestId \}\)/);
    [api, app, logica, controlador, html, css].forEach((t) => expect(t).not.toMatch(/editarObservacionPozo|apiEditarObservacion/));
    expect(codigoApp).not.toMatch(/agregarObservacionPozo|anularObservacionPozo/);
  });

  test('el wrapper de la anulacion manda SOLO sessionToken, observacionId, motivo y clientRequestId (sin wellId, email, nombre, texto original, estado ni permisos)', async () => {
    const vm = require('vm');
    const llamadas = [];
    const ctx = vm.createContext({ JSON, Object, Promise, fetch: (url, opts) => { llamadas.push({ url, opts }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); } });
    vm.runInContext(api, ctx);
    await ctx.apiAnularObservacionPozo('tok', '00000000-0000-4000-8000-000000000001', 'Cargada por error', 'anu-12345678');
    expect(JSON.parse(llamadas[0].opts.body)).toEqual({ action: 'anularObservacionPozo', sessionToken: 'tok', observacionId: '00000000-0000-4000-8000-000000000001', motivo: 'Cargada por error', clientRequestId: 'anu-12345678' });
    expect(llamadas[0].opts.method).toBe('POST');
    expect(llamadas[0].opts.headers['Content-Type']).toBe('text/plain;charset=utf-8');
  });

  test('el wrapper del alta manda SOLO sessionToken, wellId, texto y clientRequestId (sin categoria, email, nombre, fecha, id, secuencia ni permisos)', async () => {
    const vm = require('vm');
    const llamadas = [];
    const ctx = vm.createContext({ JSON, Object, Promise, fetch: (url, opts) => { llamadas.push({ url, opts }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); } });
    vm.runInContext(api, ctx);
    await ctx.apiAgregarObservacionPozo('tok', '14-0001', 'Bomba nueva', 'obs-12345678');
    expect(JSON.parse(llamadas[0].opts.body)).toEqual({ action: 'agregarObservacionPozo', sessionToken: 'tok', wellId: '14-0001', texto: 'Bomba nueva', clientRequestId: 'obs-12345678' });
    expect(llamadas[0].opts.method).toBe('POST');
    expect(llamadas[0].opts.headers['Content-Type']).toBe('text/plain;charset=utf-8');
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

  test.each([['logica', codigoLogica], ['controlador', codigoControlador]])('%s: no nombra email ni secuencia (lista blanca; nunca los espera ni los muestra)', (_n, codigo) => {
    expect(codigo).not.toMatch(/\bemail\b|secuencia/i);
  });

  test('el clientRequestId vive solo en la logica del alta / la anulacion: el modelo de vista y la lectura nunca lo tocan, y el controlador solo lo pasa de largo', () => {
    const render = codigoControlador.slice(codigoControlador.indexOf('function nodo('), codigoControlador.indexOf('function pintarFormulario('));
    expect(render).not.toMatch(/clientRequestId/i);                               // el render (lista, anuladas, estados) no lo conoce
    expect(codigoControlador.match(/clientRequestId/g)).toHaveLength(4);          // solo el pasaje de argumento hacia los wrappers del alta y de la anulacion
    const lectura = codigoLogica.slice(codigoLogica.indexOf('function observacionesPozoLogic_vista('), codigoLogica.indexOf('function observacionesPozoLogic_agregarPagina('));
    expect(lectura).not.toMatch(/clientRequestId/i);
  });

  test('compatibilidad con navegadores viejos: sin regex con lookbehind (error de sintaxis en Safari < 16.4) y sin caracteres invisibles crudos en el codigo', () => {
    [logica, controlador].forEach((t) => {
      expect(t).not.toMatch(/\(\?<[=!]/);
      const crudos = Array.from(t).filter((c) => { const n = c.charCodeAt(0); return (n < 32 && c !== '\n' && c !== '\r' && c !== '\t') || (n >= 0x7f && n <= 0x9f) || n === 0x2028 || n === 0x2029 || n === 0xfeff || (n >= 0x202a && n <= 0x202e) || (n >= 0x2066 && n <= 0x2069); });
      expect(crudos).toEqual([]);
    });
  });

  test('el texto del formulario nunca va a un lugar persistente ni a un log: solo .value / textContent y el pedido de alta', () => {
    expect(codigoControlador).not.toMatch(/console\.|localStorage|sessionStorage|document\.cookie|location|history\.|innerHTML|insertAdjacentHTML/);
    expect(codigoControlador).toMatch(/textoEl\.value/);
    expect(codigoControlador).not.toMatch(/maxlength|maxLength/);
  });

  test('el controlador solo crea li, p y button (el "Anular") y pone todo texto con textContent', () => {
    const creados = codigoControlador.match(/createElement\([^)]*\)|nodo\('[a-z]+'/g) || [];
    expect(creados.length).toBeGreaterThan(0);
    expect(codigoControlador).toMatch(/n\.textContent = texto/);
    expect(codigoControlador).toMatch(/nodo\('li'/);
    expect(codigoControlador.match(/nodo\('([a-z]+)'/g).every((s) => /nodo\('(li|p|button)'/.test(s))).toBe(true);
  });

  test('la fecha usa el helper existente de Reemplazo (hora de Mendoza), sin inventar otra politica de huso', () => {
    expect(codigoLogica).toMatch(/reemplazoLogic_formatearFecha\(iso\)/);
    expect(codigoLogica).not.toMatch(/toLocale|getTimezoneOffset|Intl\./);
  });

  test('el frontend solo habla con el backend por tres acciones: leer, agregar y anular (ninguna otra)', () => {
    expect(codigoControlador.match(/\bapi[A-Z]\w+/g)).toEqual(['apiGetObservacionesPozo', 'apiAgregarObservacionPozo', 'apiAnularObservacionPozo']);
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

describe('E5-5: formulario "Agregar observacion" en index.html', () => {
  const modal = html.slice(html.indexOf('<div id="observaciones-form-overlay"'), html.indexOf('<!-- Modal "Anular observacion"'));

  test('es un dialogo modal accesible, FUERA de #screen-observaciones, con titulo asociado', () => {
    expect(html.indexOf('<div id="observaciones-form-overlay"')).toBeGreaterThan(html.indexOf('<div id="screen-observaciones"'));
    const pantalla = html.slice(html.indexOf('<div id="screen-observaciones"'), html.indexOf('<div id="observaciones-form-overlay"'));
    const abiertos = (pantalla.match(/<div[\s>]/g) || []).length;
    const cerrados = (pantalla.match(/<\/div>/g) || []).length;
    expect(abiertos).toBe(cerrados);                                          // la pantalla queda cerrada antes del modal
    expect(modal).toMatch(/<div id="observaciones-form-overlay" class="obs-overlay" role="dialog" aria-modal="true" aria-labelledby="observaciones-form-titulo" hidden>/);
    expect(modal).toMatch(/<h2 id="observaciones-form-titulo"[^>]*>Agregar observación<\/h2>/);
    expect(modal).toMatch(/<button type="button" id="btn-observaciones-form-cerrar"[^>]*aria-label="Cerrar"/);
  });

  test('label asociado al textarea, ayuda, contador, error con role alert y describedby que apunta a ids que existen', () => {
    expect(modal).toMatch(/<label for="observaciones-form-texto"[^>]*>Observación<\/label>/);
    expect(modal).toMatch(/<textarea id="observaciones-form-texto"/);
    expect(modal).toContain('No incluyas datos personales innecesarios.');
    expect(modal).toMatch(/id="observaciones-form-contador"[^>]*>0 \/ 1000</);
    expect(modal).toMatch(/id="observaciones-form-error"[^>]*role="alert"[^>]*hidden/);
    const describedby = modal.match(/aria-describedby="([^"]+)"/)[1].split(' ');
    describedby.forEach((id) => expect(modal.split('id="' + id + '"')).toHaveLength(2));
    expect(modal).toMatch(/aria-invalid="false"/);
  });

  test('sin maxlength (contaria unidades UTF-16 y cortaria emoji), sin categoria ni otros campos, Cancelar y Guardar (disabled de verdad al abrir)', () => {
    expect(modal).not.toMatch(/maxlength/i);
    expect(modal).not.toMatch(/categor/i);
    expect(modal.match(/<textarea/g) || []).toHaveLength(1);
    expect(modal).not.toMatch(/<input|<select/);
    expect(modal).toMatch(/id="btn-observaciones-form-cancelar"[^>]*>Cancelar<\/button>/);
    expect(modal).toMatch(/<button type="submit" id="btn-observaciones-form-guardar" class="button" disabled>Guardar<\/button>/);
    expect(modal).toMatch(/<form id="observaciones-form" autocomplete="off" novalidate>/);
  });

  test('todos los ids que usa el controlador existen en el HTML', () => {
    const usados = Array.from(controlador.matchAll(/\$\('([^']+)'\)/g)).map((m) => m[1]);
    expect(usados.length).toBeGreaterThan(15);
    usados.forEach((id) => expect(html.split('id="' + id + '"')).toHaveLength(2));
  });
});

describe('E5-5: CSS del modal (responsive y sin overflow)', () => {
  const marca = '/* --- Observaciones del pozo: agregar (E5-5) --- */';
  const bloque = css.slice(css.indexOf(marca));
  const regla = (sel) => {
    const i = css.indexOf('\n' + sel + ' {', css.indexOf(marca));
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };

  test('hoja inferior en celular con scroll interno, centrado en pantallas grandes; el fondo no se desplaza', () => {
    expect(regla('.obs-overlay')).toMatch(/position:\s*fixed/);
    expect(regla('.obs-panel')).toMatch(/max-height:\s*94dvh/);
    expect(regla('.obs-panel')).toMatch(/overflow-y:\s*auto/);
    expect(bloque).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.obs-overlay\s*\{\s*align-items:\s*center/);
    expect(regla('body.obs-form-abierto')).toMatch(/overflow:\s*hidden/);
  });

  test('textarea al ancho completo, sin anchos fijos, rompe palabras largas; el error tambien', () => {
    expect(regla('.obs-form-texto')).toMatch(/width:\s*100%/);
    expect(regla('.obs-form-texto')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(regla('.obs-form-error')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(bloque.replace(/@media \(min-width: 640px\)/g, '').replace(/\.obs-cerrar \{[^}]*\}/, '')).not.toMatch(/(^|[^-])width:\s*\d+px|min-width:\s*\d+px|white-space:\s*nowrap/);
  });

  test('los botones se acomodan en filas sin desbordar; deshabilitado se ve apagado; el exceso del contador no depende solo del color', () => {
    expect(regla('.obs-form-botones')).toMatch(/flex-wrap:\s*wrap/);
    expect(bloque).toMatch(/\.obs-form-botones \.button:disabled/);
    expect(regla('.obs-form-contador-excede')).toMatch(/font-weight:\s*700/);
    expect(regla('.obs-form-texto[aria-invalid="true"]')).toMatch(/border-width:\s*2px/);
  });

  test('los estilos nuevos son solo .obs-* / body.obs-form-abierto: no afectan otros modulos', () => {
    const selectores = Array.from(bloque.matchAll(/(^|\n)\s*([^\n{};@]+?)\s*\{/g)).map((m) => m[2].trim()).filter((x) => x !== '' && !/^(from|to)$/.test(x));
    expect(selectores.length).toBeGreaterThan(15);
    selectores.forEach((sel) => expect(sel).toMatch(/^(\.obs-|body\.obs-form-abierto|#screen-observaciones)/));
  });
});

describe('E5-6: modal "Anular observacion" en index.html y boton por observacion', () => {
  const modal = html.slice(html.indexOf('<div id="observaciones-anular-overlay"'), html.indexOf('<!-- Visor de la galeria de fotos de pozos'));

  test('dialogo modal accesible, FUERA de #screen-observaciones, con titulo asociado y el texto de confirmacion pedido', () => {
    expect(html.indexOf('<div id="observaciones-anular-overlay"')).toBeGreaterThan(html.indexOf('<div id="observaciones-form-overlay"'));
    expect(modal).toMatch(/<div id="observaciones-anular-overlay" class="obs-overlay" role="dialog" aria-modal="true" aria-labelledby="observaciones-anular-titulo" hidden>/);
    expect(modal).toMatch(/<h2 id="observaciones-anular-titulo"[^>]*>Anular observación<\/h2>/);
    expect(modal).toContain('No se borra. La observación quedará registrada como anulada, con tu nombre y la fecha.');
    expect(modal).toMatch(/<button type="button" id="btn-observaciones-anular-cerrar"[^>]*aria-label="Cerrar"/);
  });

  test('label asociado al motivo, ayuda, contador 0 / 300, error con role alert y describedby que apunta a ids existentes; sin maxlength', () => {
    expect(modal).toMatch(/<label for="observaciones-anular-motivo"[^>]*>Motivo de la anulación<\/label>/);
    expect(modal).toMatch(/<textarea id="observaciones-anular-motivo"/);
    expect(modal).toContain('Explicá brevemente por qué se anula.');
    expect(modal).toMatch(/id="observaciones-anular-contador"[^>]*>0 \/ 300</);
    expect(modal).toMatch(/id="observaciones-anular-error"[^>]*role="alert"[^>]*hidden/);
    const describedby = modal.match(/aria-describedby="([^"]+)"/)[1].split(' ');
    describedby.forEach((id) => expect(modal.split('id="' + id + '"')).toHaveLength(2));
    expect(modal).toMatch(/aria-invalid="false"/);
    expect(modal).not.toMatch(/maxlength/i);
    expect(modal.match(/<textarea/g) || []).toHaveLength(1);
    expect(modal).not.toMatch(/<input|<select/);
  });

  test('Cancelar y "Anular observación" (disabled de verdad al abrir); formulario con novalidate', () => {
    expect(modal).toMatch(/id="btn-observaciones-anular-cancelar"[^>]*>Cancelar<\/button>/);
    expect(modal).toMatch(/<button type="submit" id="btn-observaciones-anular-confirmar" class="button" disabled>Anular observación<\/button>/);
    expect(modal).toMatch(/<form id="observaciones-anular-form" autocomplete="off" novalidate>/);
    expect(modal).not.toMatch(/\son[a-z]+=/i);
  });

  test('el modal no repite el texto de la observacion: solo hay un lugar para "quien y cuando" (contexto)', () => {
    expect(modal).toMatch(/<p id="observaciones-anular-contexto"[^>]*><\/p>/);
  });

  test('todos los ids que usa el controlador existen una sola vez (incluidos los de anulacion)', () => {
    const usados = Array.from(controlador.matchAll(/\$\('([^']+)'\)/g)).map((m) => m[1]);
    expect(usados.filter((i) => /anular/.test(i)).length).toBeGreaterThanOrEqual(9);
    usados.forEach((id) => expect(html.split('id="' + id + '"')).toHaveLength(2));
  });

  test('el boton "Anular" por observacion lo crea el controlador SOLO con observacionesPozoLogic_puedeAnular (la senal puedeAnular del backend + estado ACTIVA); jamas por nombre ni por permisos', () => {
    const f = codigoControlador.slice(codigoControlador.indexOf('function puedeAnularItem('), codigoControlador.indexOf('function accionAnular('));
    expect(f).toMatch(/observacionesPozoLogic_puedeAnular\(ctx\.permisos, v\)/);
    expect(f).not.toMatch(/nombre|\.name|email|observaciones_agregar|observaciones_anular/i);
    const itemAnulada = codigoControlador.slice(codigoControlador.indexOf('function itemAnulada('), codigoControlador.indexOf('function renderItem('));
    expect(itemAnulada).not.toMatch(/accionAnular|obs-anular/);              // una anulada nunca tiene boton
    expect(codigoControlador.match(/accionAnular\(/g)).toHaveLength(2);        // definicion + una sola llamada (en itemActiva)
    expect(codigoControlador).toMatch(/nodo\('button', 'obs-anular', 'Anular'\)/);
  });

  test('la decision de anular NO usa el nombre ni nada que no venga del backend: la funcion pura solo mira permisos, estado y vista.puedeAnular', () => {
    const f = codigoLogica.slice(codigoLogica.indexOf('function observacionesPozoLogic_puedeAnular('), codigoLogica.indexOf('function observacionesPozoLogic_validarMotivo('));
    expect(f).not.toMatch(/nombre|email|fecha|texto/i);
    expect(f).toMatch(/vista\.estado === 'ACTIVA'/);
    expect(f).toMatch(/vista\.puedeAnular === true/);
    expect(f).not.toMatch(/observaciones_anular|observaciones_agregar/);       // sin fallback ni combinacion de permisos: manda la senal del backend
  });

  test('el estado del modal de anulacion no guarda el texto de la observacion', () => {
    const f = codigoLogica.slice(codigoLogica.indexOf('function observacionesPozoLogic_crearAnulacion('), codigoLogica.indexOf('if (typeof module'));
    expect(f).toMatch(/s\.objetivo = \{ id: vista\.id, nombre: vista\.nombre, fecha: vista\.fecha, puedeAnular: vista\.puedeAnular === true \}/);
    expect(f).not.toMatch(/vista\.texto|objetivo\.texto/);                 // `v.texto` ahi es el MOTIVO normalizado; el texto de la observacion no se toca
  });

  test('la edicion y el reemplazo automatico no existen', () => {
    [logica, controlador, html].forEach((t) => expect(t).not.toMatch(/editar observaci|Editar observaci|editarObservacion|apiEditar/i));
  });
});

describe('E5-6: CSS del boton y del modal de anulacion', () => {
  const marca = '/* --- Observaciones del pozo: anular (E5-6) --- */';
  const bloque = css.slice(css.indexOf(marca));
  const regla = (sel) => {
    const i = css.indexOf('\n' + sel + ' {', css.indexOf(marca));
    return i === -1 ? '' : css.slice(i, css.indexOf('}', i) + 1);
  };

  test('el boton es discreto pero legible: texto (no solo icono ni color), area tactil >= 40 px y borde propio', () => {
    expect(regla('.obs-anular')).toMatch(/min-height:\s*40px/);
    expect(regla('.obs-anular')).toMatch(/border:\s*1\.5px solid/);
    expect(regla('.obs-anular')).toMatch(/font-weight:\s*700/);
  });

  test('el aviso de confirmacion y el contexto rompen palabras largas; sin anchos fijos', () => {
    expect(regla('.obs-anular-contexto')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(bloque).not.toMatch(/(^|[^-])width:\s*\d+px|white-space:\s*nowrap/);
  });

  test('los estilos nuevos son solo .obs-*: no afectan otros modulos', () => {
    const selectores = Array.from(bloque.matchAll(/(^|\n)\s*([^\n{};@]+?)\s*\{/g)).map((m) => m[2].trim()).filter((x) => x !== '' && !/^(from|to)$/.test(x));
    expect(selectores.length).toBeGreaterThanOrEqual(4);
    selectores.forEach((sel) => expect(sel).toMatch(/^\.obs-/));
  });
});
