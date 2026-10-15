// Cableado de las decisiones sobre fuentes registrales en la app: scripts y orden en index.html, service worker, ids del dialogo de confirmacion, inicializacion en app.js,
// wrappers de js/api.js (lista blanca), estilos y los limites de alcance de esta etapa (nada de mapa, Cerca Mio, seleccion ni reemplazos).
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
  const pos = (s) => html.indexOf('<script src="' + s + '"></script>');
  test('los dos scripts nuevos se cargan: logica -> (logica de conocidas) -> dialogo -> controlador de conocidas -> correcciones -> app.js', () => {
    const orden = ['js/ubicacionFuenteDecisionesUiLogic.js', 'js/ubicacionesConocidasLogic.js', 'js/ubicacionFuenteDecisionesUi.js', 'js/ubicacionesConocidas.js', 'js/ubicacionCorreccion.js', 'js/app.js'].map(pos);
    orden.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    expect(pos('js/api.js')).toBeGreaterThan(-1);
    expect(pos('js/api.js')).toBeLessThan(pos('js/ubicacionFuenteDecisionesUi.js'));
  });

  test('el dominio puro del backend NO se carga en el navegador', () => {
    expect(html).not.toMatch(/ubicacionFuenteDecisionesLogic\.js/);
  });

  test('el dialogo de confirmacion existe, esta oculto, es un dialogo modal accesible y tiene todos los ids que usa el controlador', () => {
    const fuente = leer('js', 'ubicacionFuenteDecisionesUi.js');
    const usados = (fuente.match(/\$\('([a-z0-9-]+)'\)/g) || []).map((s) => s.slice(3, -2));
    expect(usados.length).toBeGreaterThan(10);
    usados.forEach((id) => expect(html).toContain('id="' + id + '"'));
    expect(html).toMatch(/<div id="ufd-overlay"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="ufd-titulo"[^>]*hidden>/);
    expect(html).toMatch(/<label id="ufd-motivo-label" for="ufd-motivo"/);
    expect(html).toMatch(/<textarea id="ufd-motivo"[^>]*maxlength="300"/);
  });

  test('el dialogo se abre por encima del visor del mapa (comparte clases y tiene su propio z-index mayor)', () => {
    expect(html).toMatch(/id="ufd-overlay" class="ucorr-overlay ufd-overlay"/);
    const z = (re) => Number((css.match(re) || [])[1]);
    expect(z(/\.ufd-overlay \{\s*z-index: (\d+);/)).toBeGreaterThan(z(/\.ucorr-overlay \{[^}]*?z-index: (\d+);/));
  });

  test('el visor no tiene botones de decision propios: las acciones viven en el popup de cada marcador', () => {
    const visor = html.slice(html.indexOf('id="ucon-overlay"'), html.indexOf('<!-- Confirmacion de una decision'));
    expect(visor).not.toMatch(/data-ufd-accion/);
  });
});

describe('service worker', () => {
  test('precachea los scripts nuevos (y no el dominio del backend)', () => {
    expect(sw).toContain("'./js/ubicacionFuenteDecisionesUiLogic.js'");
    expect(sw).toContain("'./js/ubicacionFuenteDecisionesUi.js'");
    expect(sw).not.toMatch(/ubicacionFuenteDecisionesLogic\.js/);
  });
  test('todos los <script src> de index.html estan en el precache', () => {
    const scripts = (html.match(/<script src="(js\/[^"]+)"/g) || []).map((s) => s.slice(13, -1));
    scripts.forEach((s) => expect(sw).toContain("'./" + s + "'"));
  });
});

describe('app.js', () => {
  test('inicializa "Ubicaciones conocidas" con el contexto FRESCO (token y permisos de app.js) y cierra sesion si vence', () => {
    const i = app.indexOf('ubicacionesConocidasController_inicializar(function');
    expect(i).toBeGreaterThan(-1);
    const bloque = app.slice(i, i + 400);
    expect(bloque).toContain('sessionToken: sessionToken');
    expect(bloque).toContain('permisos: permisosActuales');
    expect(bloque).toMatch(/onSessionExpired: function \(\) \{\s*logout\(\);/);
  });
  test('sigue cerrando "Ubicaciones conocidas" al cerrar sesion', () => {
    expect(app).toMatch(/ubicacionesConocidasController_cerrar\(\)/);
  });
  test('app.js no conoce las acciones ni los endpoints de decisiones (solo inicializa el controlador)', () => {
    expect(app).not.toMatch(/decidirFuente|getDecisionesFuentes|ufdui_|ubicacionFuenteDecisionesUi/);
  });
});

describe('js/api.js: wrappers con lista blanca', () => {
  function cargarApi() {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: (url, op) => { llamadas.push({ url, body: JSON.parse(op.body) }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }, JSON, Object, Promise });
    vm.runInContext(api, ctx);
    return { ctx, llamadas };
  }
  test('apiGetDecisionesFuentesPozo manda solo action, sessionToken y wellId', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiGetDecisionesFuentesPozo('tok', '14-0001');
    expect(llamadas[0].body).toEqual({ action: 'getDecisionesFuentesPozo', sessionToken: 'tok', wellId: '14-0001' });
  });
  test('apiDecidirFuenteUbicacion manda exactamente la lista blanca; identidad, secuencia, fecha, estado y email NUNCA viajan, aunque vengan en los datos', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiDecidirFuenteUbicacion('tok', {
      wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 1, y: 2, accion: 'DESCARTAR', motivo: 'm', versionVista: 3, clientRequestId: 'ufd-12345678',
      email: 'a@x.com', nombre: 'Falso', secuencia: 99, timestampUtc: 'ayer', estado: 'ACEPTADA', evento: 'ACEPTADA', decisionId: 'x', clave: 'k'
    });
    expect(llamadas[0].body).toEqual({
      action: 'decidirFuenteUbicacion', sessionToken: 'tok', wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 1, y: 2, accion: 'DESCARTAR', motivo: 'm', versionVista: 3, clientRequestId: 'ufd-12345678'
    });
  });
  test('sin datos no revienta', async () => {
    const { ctx, llamadas } = cargarApi();
    await ctx.apiDecidirFuenteUbicacion('tok');
    expect(llamadas[0].body.action).toBe('decidirFuenteUbicacion');
  });
});

describe('estilos', () => {
  test('hay estilos para el estado, la historia, las acciones, el aviso y el dialogo', () => {
    ['.ufd-estado', '.ufd-estado-aceptada', '.ufd-estado-descartada', '.ufd-historia', '.ufd-acciones', '.ufd-btn', '.ufd-aviso', '.ufd-overlay', '.ucon-descartada'].forEach((c) => expect(css).toContain(c));
  });
  test('los botones son tactiles (44 px de alto minimo) en la tarjeta y en el popup', () => {
    expect(css).toMatch(/\.ufd-btn \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.ucon-popup \.ufd-btn \{[^}]*min-height: 44px/);
  });
  test('la etiqueta del motivo queda separada del campo (en 375 px se veia pegada)', () => {
    expect(css).toMatch(/\.ufd-motivo-bloque \.field-label \{\s*display: block;\s*margin-bottom: 6px;/);
  });
  test('una fuente descartada solo se atenua: la coordenada no se tacha ni se oculta', () => {
    const regla = (css.match(/\.ucon-descartada \.ucon-coord,[^}]*\}/) || [''])[0];
    expect(regla).toMatch(/opacity/);
    expect(regla).not.toMatch(/line-through|display:\s*none|visibility/);
  });
});

describe('alcance de esta etapa: nada de mapas globales, Cerca Mio, seleccion ni reemplazos', () => {
  test.each(['mapa.js', 'mapaDataset.js', 'cercaMio.js', 'seleccion.js', 'reemplazo.js', 'ubicacionOperativaLogic.js'])('js/%s no conoce las decisiones', (f) => {
    if (fs.existsSync(path.join(raiz, 'js', f))) {
      expect(leer('js', f)).not.toMatch(/ufdui_|DecisionesFuentes|decidirFuente|ubicacionFuenteDecisiones/i);
    }
  });
  test('sigue sin haber delta de decisiones ni estado R en el backend (Etapa 3), y la interfaz no usa los endpoints de sugerencias (la UI de sugerencias es posterior)', () => {
    expect(leer('backend', 'src', 'Api.js')).not.toMatch(/getDecisionesFuentesDelta/);
    expect(api).not.toMatch(/Sugerencia/);
    expect(leer('js', 'ubicacionFuenteDecisionesUi.js') + leer('js', 'ubicacionFuenteDecisionesUiLogic.js') + leer('js', 'ubicacionesConocidas.js')).not.toMatch(/sugerirDecision|SugerenciasFuente|resolverSugerencia|cancelarSugerencia/);
  });
});
