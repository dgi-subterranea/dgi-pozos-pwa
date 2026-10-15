// Cableado de las SUGERENCIAS en la app (Etapa D): indicador del hub, cola de revision, scripts y orden en index.html, service worker, app.js, wrappers de js/api.js (lista blanca),
// estilos tactiles y los limites de alcance (nada de mapa global, estado R, Cerca Mio, seleccion, reemplazos ni subida de ITF).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const html = leer('index.html');
const sw = leer('sw.js');
const app = leer('js', 'app.js');
const css = leer('css', 'styles.css');
const api = leer('js', 'api.js');

describe('index.html', () => {
  test('el indicador del hub existe, esta OCULTO de entrada, es un boton accesible y esta junto al de "Correcciones pendientes"', () => {
    expect(html).toMatch(/<button type="button" id="usug-pendientes" class="ucorr-pendientes usug-pendientes" aria-haspopup="dialog"[^>]*hidden>/);
    expect(html).toContain('id="usug-pendientes-texto"');
    expect(html.indexOf('id="ucorr-pendientes"')).toBeLessThan(html.indexOf('id="usug-pendientes"'));
  });

  test('la cola es un dialogo modal accesible, oculto, con todos los ids que usa el controlador', () => {
    const fuente = leer('js', 'ubicacionSugerencias.js');
    const usados = (fuente.match(/\$\('([a-z0-9-]+)'\)/g) || []).map((s) => s.slice(3, -2));
    expect(usados.length).toBeGreaterThan(8);
    usados.forEach((id) => expect(html).toContain('id="' + id + '"'));
    expect(html).toMatch(/<div id="usug-overlay" class="ucorr-overlay usug-overlay" role="dialog" aria-modal="true" aria-labelledby="usug-titulo" hidden>/);
    expect(html).toMatch(/<ul id="usug-lista" class="usug-lista">/);
  });

  test('los scripts: logica de la ficha -> dialogo -> badge/cola; despues de las correcciones; antes de app.js', () => {
    const pos = (s) => html.indexOf('<script src="' + s + '"></script>');
    const orden = ['js/ubicacionCorreccionLogic.js', 'js/ubicacionFuenteDecisionesUiLogic.js', 'js/ubicacionFuenteDecisionesUi.js', 'js/ubicacionPendientes.js', 'js/ubicacionSugerenciasLogic.js', 'js/ubicacionSugerencias.js', 'js/app.js'].map(pos);
    orden.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(pos('js/api.js')).toBeLessThan(pos('js/ubicacionSugerencias.js'));
  });

  test('el dialogo de la cola queda por debajo del de confirmacion (z-index) para que confirmar quede arriba', () => {
    const z = (re) => Number((css.match(re) || [])[1]);
    expect(z(/\.ufd-overlay \{\s*z-index: (\d+);/)).toBeGreaterThan(z(/\.ucorr-overlay \{[^}]*?z-index: (\d+);/));
    expect(html.indexOf('id="usug-overlay"')).toBeLessThan(html.indexOf('id="ufd-overlay"'));
  });
});

describe('service worker', () => {
  test('precachea los dos scripts nuevos', () => {
    expect(sw).toContain("'./js/ubicacionSugerenciasLogic.js'");
    expect(sw).toContain("'./js/ubicacionSugerencias.js'");
  });
  test('todos los <script src> de index.html estan en el precache', () => {
    const scripts = (html.match(/<script src="(js\/[^"]+)"/g) || []).map((s) => s.slice(13, -1));
    scripts.forEach((s) => expect(sw).toContain("'./" + s + "'"));
  });
});

describe('app.js', () => {
  test('inicializa la cola con el contexto FRESCO de la app (token y permisos), sesion vencida cierra sesion y puede abrir la ficha de un pozo', () => {
    const i = app.indexOf('ubicacionSugerenciasController_inicializar(function');
    expect(i).toBeGreaterThan(-1);
    const bloque = app.slice(i, i + 400);
    expect(bloque).toContain('contextoValidacion()');
    expect(bloque).toMatch(/ctx\.onAbrirPozo = function \(wellId\) \{\s*showScreen\('main'\);\s*buscarPozo\(wellId\);/);
    // el contexto de validacion: sessionToken y permisosActuales siempre frescos + logout
    const j = app.indexOf('var contextoValidacion = function');
    const ctx = app.slice(j, j + 500);
    expect(ctx).toContain('sessionToken: sessionToken');
    expect(ctx).toContain('permisos: permisosActuales');
    expect(ctx).toMatch(/onSessionExpired: function \(\) \{\s*logout\(\);/);
  });

  test('el indicador se refresca al volver al hub y se reinicia al cerrar sesion', () => {
    expect(app).toMatch(/name === 'main' && typeof ubicacionSugerenciasController_refrescar === 'function'/);
    expect(app).toMatch(/ubicacionPendientesController_reset\(\);\s*ubicacionSugerenciasController_reset\(\);/);
  });

  test('app.js no conoce las acciones ni los endpoints de sugerencias (solo inicializa y delega)', () => {
    expect(app).not.toMatch(/sugerirDecisionFuente|resolverSugerenciaFuente|cancelarSugerenciaFuente|getSugerenciasFuentes|ufdui_|usug_/);
  });
});

describe('js/api.js: wrappers con lista blanca', () => {
  function cargarApi() {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: (url, op) => { llamadas.push({ url, body: JSON.parse(op.body) }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }, JSON, Object, Promise });
    vm.runInContext(api, ctx);
    return { ctx, llamadas };
  }

  test('apiSugerirDecisionFuente manda exactamente la lista blanca; identidad, estado, secuencia y fecha NUNCA viajan', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiSugerirDecisionFuente('tok', {
      wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 1, y: 2, accionSugerida: 'DESCARTAR', motivo: 'm', versionVista: 3, clientRequestId: 'ufd-12345678',
      email: 'a@x.com', nombre: 'Falso', estado: 'APROBADA', secuencia: 9, sugerenciaId: 'x', timestampUtc: 'ayer', evento: 'APROBADA'
    });
    expect(llamadas[0].body).toEqual({ action: 'sugerirDecisionFuente', sessionToken: 'tok', wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 1, y: 2, accionSugerida: 'DESCARTAR', motivo: 'm', versionVista: 3, clientRequestId: 'ufd-12345678' });
  });

  test('apiGetSugerenciasFuentesPozo y apiGetSugerenciasFuentesPendientes: solo token (y pozo)', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiGetSugerenciasFuentesPozo('tok', '14-0001');
    await ctx.apiGetSugerenciasFuentesPendientes('tok');
    expect(llamadas[0].body).toEqual({ action: 'getSugerenciasFuentesPozo', sessionToken: 'tok', wellId: '14-0001' });
    expect(llamadas[1].body).toEqual({ action: 'getSugerenciasFuentesPendientes', sessionToken: 'tok' });
  });

  test('apiResolverSugerenciaFuente y apiCancelarSugerenciaFuente: lista blanca; nada de wellId/fuente/accion (la sugerencia guardada manda)', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiResolverSugerenciaFuente('tok', { sugerenciaId: 's-1', resolucion: 'APROBAR', motivo: 'm', versionVista: 4, clientRequestId: 'ufd-12345678', wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: 1, y: 2, accionSugerida: 'DESCARTAR', email: 'a@x.com' });
    await ctx.apiCancelarSugerenciaFuente('tok', { sugerenciaId: 's-1', motivo: 'm', clientRequestId: 'ufd-12345678', wellId: '01-0012', email: 'a@x.com' });
    expect(llamadas[0].body).toEqual({ action: 'resolverSugerenciaFuente', sessionToken: 'tok', sugerenciaId: 's-1', resolucion: 'APROBAR', motivo: 'm', versionVista: 4, clientRequestId: 'ufd-12345678' });
    expect(llamadas[1].body).toEqual({ action: 'cancelarSugerenciaFuente', sessionToken: 'tok', sugerenciaId: 's-1', motivo: 'm', clientRequestId: 'ufd-12345678' });
  });

  test('sin datos no revienta', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiSugerirDecisionFuente('tok');
    await ctx.apiResolverSugerenciaFuente('tok');
    await ctx.apiCancelarSugerenciaFuente('tok');
    expect(llamadas.map((l) => l.body.action)).toEqual(['sugerirDecisionFuente', 'resolverSugerenciaFuente', 'cancelarSugerenciaFuente']);
  });
});

describe('estilos y tactilidad', () => {
  test('hay estilos para el estado de la sugerencia, la cola, el aviso y el indicador', () => {
    ['.ufd-sug', '.ufd-sug-chip', '.ufd-sug-pendiente', '.ufd-sug-aprobada', '.ufd-sug-rechazada', '.ufd-sug-obsoleta', '.usug-lista', '.usug-item', '.usug-no-aplicable', '.usug-accion', '.ucorr-pendientes'].forEach((c) => expect(css).toContain(c));
  });
  test('los botones de la cola y de las sugerencias son tactiles (44 px de alto minimo) y la cola no desborda a lo ancho', () => {
    expect(css).toMatch(/\.ufd-btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.usug-lista \{[^}]*flex-direction: column/);
    expect(css).toMatch(/\.usug-motivo \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/\.ufd-sug-detalle,\s*\.ufd-sug-motivo \{[^}]*overflow-wrap: anywhere/);
  });
  test('el indicador reutiliza la apariencia de "Correcciones pendientes" (misma clase base)', () => {
    expect(html).toContain('class="ucorr-pendientes usug-pendientes"');
    expect(css).toMatch(/button\.ucorr-pendientes \{[^}]*min-height: 36px/);
  });
});

describe('alcance de esta etapa', () => {
  test.each(['mapa.js', 'mapaDataset.js', 'cercaMio.js', 'seleccion.js', 'reemplazo.js', 'ubicacionOperativaLogic.js'])('js/%s no conoce las sugerencias ni las decisiones', (f) => {
    if (fs.existsSync(path.join(raiz, 'js', f))) {
      expect(leer('js', f)).not.toMatch(/ufdui_|usug_|SugerenciasFuente|sugerirDecision|resolverSugerencia|cancelarSugerencia/);
    }
  });
  test('el backend no cambio en esta etapa (sin delta ni estado R) y la cola no usa decidirFuenteUbicacion', () => {
    expect(leer('backend', 'src', 'Api.js')).not.toMatch(/getDecisionesFuentesDelta/);
    expect(leer('js', 'ubicacionSugerencias.js')).not.toMatch(/decidirFuenteUbicacion|apiDecidirFuente/);
  });
  test('no hay nada de subida / validacion de ITF (es un roadmap documentado, sin codigo)', () => {
    ['index.html', 'sw.js', 'js/app.js', 'js/api.js'].forEach((f) => expect(leer(...f.split('/'))).not.toMatch(/perfil_subir|perfil_validar|subirItf|subirPerfil/));
  });
});
