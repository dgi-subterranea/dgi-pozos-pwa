// Controlador DOM del indicador "Correcciones pendientes: N" (js/ubicacionPendientes.js) ejecutado de verdad con un DOM minimo falso, mas el cableado
// (index.html, app.js, service worker, API). La logica fina del indicador esta en ubicacionCorreccionLogic.test.js; aca se verifica lo que se VE.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const app = leer(__dirname, 'app.js');
const api = leer(__dirname, 'api.js');
const fuenteLogica = leer(__dirname, 'ubicacionCorreccionLogic.js');
const fuenteControlador = leer(__dirname, 'ubicacionPendientes.js');
const { SHELL_FILES } = require('../sw');

const flush = async () => { for (let i = 0; i < 6; i += 1) { await new Promise((r) => setImmediate(r)); } };

function cargar(opc) {
  const o = opc || {};
  const elementos = { 'ucorr-pendientes': { hidden: true, textContent: '' }, 'ucorr-pendientes-texto': { hidden: false, textContent: '' } };
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, setTimeout });
  ctx.window = ctx;
  ctx.document = { getElementById: (id) => elementos[id] };
  const respuestas = o.respuestas || [{ status: 'ok', data: { total: 3, inconsistentes: 0, pendientes: [] } }];
  const llamadas = [];
  ctx.apiGetCorreccionesUbicacionPendientes = jest.fn((token) => {
    llamadas.push(token);
    const r = respuestas[Math.min(llamadas.length - 1, respuestas.length - 1)];
    return typeof r === 'function' ? r() : Promise.resolve(r);
  });
  vm.runInContext(fuenteLogica, ctx);
  vm.runInContext(fuenteControlador, ctx);
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { ubicacion: true, ubicacion_validar: true }, onSessionExpired: jest.fn(), onUserDisabled: jest.fn() };
  ctx.ubicacionPendientesController_inicializar(() => sesion);
  const visible = () => !elementos['ucorr-pendientes'].hidden;
  const texto = () => elementos['ucorr-pendientes-texto'].textContent;
  return { ctx, sesion, llamadas, visible, texto };
}

describe('lo que se ve', () => {
  test('arranca oculto; con pendientes muestra "Correcciones pendientes: 3"', async () => {
    const t = cargar();
    expect(t.visible()).toBe(false);
    await t.ctx.ubicacionPendientesController_refrescar();
    expect(t.visible()).toBe(true);
    expect(t.texto()).toBe('Correcciones pendientes: 3');
    expect(t.llamadas).toEqual(['tok-real']);
  });

  test('con 0 pendientes queda oculto (estado neutro)', async () => {
    const t = cargar({ respuestas: [{ status: 'ok', data: { total: 0, inconsistentes: 0, pendientes: [] } }] });
    await t.ctx.ubicacionPendientesController_refrescar();
    expect(t.visible()).toBe(false);
    expect(t.texto()).toBe('');
  });

  test.each([
    ['sin permiso de validar', { ubicacion: true, ubicacion_corregir: true }],
    ['permiso de validar sin ubicacion', { ubicacion_validar: true }],
    ['permiso no exacto', { ubicacion: true, ubicacion_validar: 'SI' }],
    ['sin permisos', {}]
  ])('%s: ni se consulta ni se ve', async (n, permisos) => {
    const t = cargar({ permisos });
    await t.ctx.ubicacionPendientesController_refrescar();
    expect(t.llamadas).toHaveLength(0);
    expect(t.visible()).toBe(false);
  });

  test('despues de validar o rechazar (alResolver) el numero se actualiza', async () => {
    const r = (n) => ({ status: 'ok', data: { total: n, inconsistentes: 0, pendientes: [] } });
    const t = cargar({ respuestas: [r(3), r(2), r(0)] });
    await t.ctx.ubicacionPendientesController_refrescar();
    expect(t.texto()).toBe('Correcciones pendientes: 3');
    await t.ctx.ubicacionPendientesController_alResolver();
    expect(t.texto()).toBe('Correcciones pendientes: 2');
    await t.ctx.ubicacionPendientesController_alResolver();
    expect(t.visible()).toBe(false);
    expect(t.llamadas).toHaveLength(3);
  });

  test('un error de la consulta no oculta el valor que ya se mostraba ni lanza', async () => {
    const t = cargar({ respuestas: [{ status: 'ok', data: { total: 4 } }, () => Promise.reject(new Error('Failed to fetch'))] });
    await t.ctx.ubicacionPendientesController_refrescar();
    await t.ctx.ubicacionPendientesController_alResolver();
    expect(t.visible()).toBe(true);
    expect(t.texto()).toBe('Correcciones pendientes: 4');
  });

  test('sesion vencida: avisa a la app y se oculta; usuario deshabilitado: va a su pantalla', async () => {
    const a = cargar({ respuestas: [{ status: 'error', code: 'UNAUTHORIZED' }] });
    await a.ctx.ubicacionPendientesController_refrescar();
    expect(a.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(a.visible()).toBe(false);
    const b = cargar({ respuestas: [{ status: 'error', code: 'USER_DISABLED' }] });
    await b.ctx.ubicacionPendientesController_refrescar();
    expect(b.sesion.onUserDisabled).toHaveBeenCalledTimes(1);
    expect(b.sesion.onSessionExpired).not.toHaveBeenCalled();
  });

  test('reset() (logout) lo oculta y descarta una respuesta que llega tarde', async () => {
    let resolver;
    const t = cargar({ respuestas: [() => new Promise((r) => { resolver = r; })] });
    const p = t.ctx.ubicacionPendientesController_refrescar();
    await flush();
    t.ctx.ubicacionPendientesController_reset();
    resolver({ status: 'ok', data: { total: 9 } });
    await p;
    expect(t.visible()).toBe(false);
  });

  test('antes de inicializar (o sin inicializar) no rompe', async () => {
    const t = cargar();
    t.ctx.ubicacionPendientesController_reset();
    expect(t.visible()).toBe(false);
  });
});

describe('cableado: index.html, app.js, API y service worker', () => {
  test('el indicador existe oculto, discreto y accesible (role status) en el hub, antes del buscador', () => {
    expect(html).toMatch(/<p id="ucorr-pendientes" class="ucorr-pendientes" role="status" hidden>/);
    expect(html).toMatch(/id="ucorr-pendientes-texto"/);
    expect(html.indexOf('id="ucorr-pendientes"')).toBeGreaterThan(html.indexOf('id="screen-main"'));
    expect(html.indexOf('id="ucorr-pendientes"')).toBeLessThan(html.indexOf('id="search-form"'));
  });

  test('script en orden: despues de la logica y de api.js, antes de app.js; y precacheado por el service worker', () => {
    const pos = (a) => html.indexOf('src="js/' + a + '"');
    expect(pos('ubicacionPendientes.js')).toBeGreaterThan(pos('ubicacionCorreccionLogic.js'));
    expect(pos('ubicacionPendientes.js')).toBeGreaterThan(pos('api.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('ubicacionPendientes.js'));
    expect(SHELL_FILES).toContain('./js/ubicacionPendientes.js');
  });

  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = [...fuenteControlador.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
    expect(ids.length).toBe(2);
    ids.forEach((id) => expect(html).toMatch(new RegExp('id="' + id + '"')));
  });

  test('api.js: apiGetCorreccionesUbicacionPendientes manda solo action y sessionToken', () => {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: jest.fn((u, o) => { llamadas.push(JSON.parse(o.body)); return Promise.resolve({ json: () => Promise.resolve({}) }); }), JSON, Object });
    vm.runInContext(api, ctx);
    ctx.apiGetCorreccionesUbicacionPendientes('tok');
    expect(llamadas[0]).toEqual({ action: 'getCorreccionesUbicacionPendientes', sessionToken: 'tok' });
  });

  test('app.js: contexto fresco (token + permisos), sesion vencida cierra sesion, deshabilitado va a su pantalla', () => {
    expect(app).toMatch(/ubicacionPendientesController_inicializar\(function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);\s*\},\s*onUserDisabled: function \(\) \{\s*showScreen\('disabled'\);/);
  });

  test('app.js: se refresca al entrar al hub (showScreen main: login, checkSession y cada regreso) y se resetea en logout', () => {
    expect(app).toMatch(/if \(name === 'main' && typeof ubicacionPendientesController_refrescar === 'function'\) \{\s*ubicacionPendientesController_refrescar\(\);/);
    const logout = app.slice(app.indexOf('function logout()'), app.indexOf("document.getElementById('btn-logout')"));
    expect(logout).toContain('ubicacionPendientesController_reset();');
  });

  test('el login y checkSession pasan por enterMain -> showScreen("main")', () => {
    const enterMain = app.slice(app.indexOf('function enterMain()'), app.indexOf('function logout()'));
    expect(enterMain).toContain("showScreen('main');");
    expect(app).toMatch(/permisosActuales = result\.data\.permisos \|\| permisosActuales;\s*localStorage\.setItem\('sessionToken', sessionToken\);\s*enterMain\(\);/);
  });

  test('la futura cola de validacion tiene el gancho publico alResolver()', () => {
    expect(fuenteControlador).toContain('window.ubicacionPendientesController_alResolver = ubicacionPendientesController_alResolver;');
  });

  test('la UI no bloquea: ningun alert/confirm, nada persistido, solo textContent', () => {
    const codigo = fuenteControlador.replace(/\/\/.*$/gm, '');
    expect(codigo).not.toMatch(/\b(alert|confirm|prompt)\s*\(/);
    expect(codigo).not.toMatch(/localStorage|sessionStorage|innerHTML/);
  });

  test('estilo Acequia: chip discreto con los tokens de aviso existentes', () => {
    expect(css).toMatch(/\.ucorr-pendientes \{[^}]*background: var\(--color-warn-tint\)[^}]*color: var\(--color-warn\)/);
    expect(css).toMatch(/\.ucorr-pendientes-punto \{[^}]*background: var\(--color-accent\)/);
  });
});
