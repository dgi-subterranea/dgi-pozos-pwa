// Guardas del cableado de "Ubicaciones conocidas": ids del HTML, orden de scripts, service worker, integracion en app.js y en el controlador de correcciones, y estilos.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const html = leer('index.html');
const css = leer('css', 'styles.css');
const app = leer('js', 'app.js');
const sw = leer('sw.js');
const controlador = leer('js', 'ubicacionesConocidas.js');
const correccion = leer('js', 'ubicacionCorreccion.js');

describe('index.html', () => {
  test('todos los ids que usa el controlador existen (el boton "Ver todas" lo pinta la seccion)', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    const dinamicos = ['ubic-conocidas', 'btn-ucon-ver-todas'];
    const faltan = [...ids].filter((id) => dinamicos.indexOf(id) === -1 && !new RegExp('id="' + id + '"').test(html));
    expect(ids.size).toBeGreaterThan(8);
    expect(faltan).toEqual([]);
  });

  test('el visor es un dialogo accesible, oculto por defecto y con titulo asociado', () => {
    expect(html).toMatch(/<div id="ucon-overlay" class="ucorr-overlay ucon-overlay" role="dialog" aria-modal="true" aria-labelledby="ucon-titulo" hidden>/);
    expect(html).toMatch(/<h2 id="ucon-titulo"/);
    expect(html).toMatch(/id="btn-ucon-cerrar"[^>]*aria-label="Cerrar"/);
    ['ucon-mapa', 'ucon-mapa-cargando', 'ucon-mapa-error', 'ucon-visor-nota'].forEach((id) => expect(html).toMatch(new RegExp('id="' + id + '"[^>]*hidden')));
  });

  test('el visor solo tiene capas y cierre: NO hay botones de validar ni de descartar fuentes', () => {
    // las acciones de decision aparecen en el popup de cada marcador (mismo dialogo que las tarjetas), no como botones fijos del visor
    const visor = html.slice(html.indexOf('id="ucon-overlay"'), html.indexOf('<!-- Cola de REVISION de sugerencias'));
    expect(visor).not.toMatch(/Validar|Descartar|Aceptar|Rechazar|Ignorar/);
    expect((visor.match(/<button/g) || []).length).toBe(4);               // x, Mapa, Satelite y Cerrar
  });

  test('los scripts: la logica antes que el controlador, ambos antes del controlador de correcciones y de app.js; las dependencias tambien antes de app.js', () => {
    const pos = (s) => html.indexOf('<script src="' + s + '"></script>');
    const orden = ['js/ubicacionesConocidasLogic.js', 'js/ubicacionesConocidas.js', 'js/ubicacionCorreccion.js', 'js/app.js'].map(pos);
    orden.forEach((i) => expect(i).toBeGreaterThan(-1));
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
    ['js/coordenadasConversion.js', 'js/ubicacionOperativaLogic.js', 'js/mapaShared.js'].forEach((d) => {
      expect(pos(d)).toBeGreaterThan(-1);
      expect(pos(d)).toBeLessThan(pos('js/app.js'));
    });
  });

  test('exactamente un contenedor del visor y un solo script de cada archivo', () => {
    expect((html.match(/id="ucon-overlay"/g) || []).length).toBe(1);
    expect((html.match(/<script src="js\/ubicacionesConocidas\.js"><\/script>/g) || []).length).toBe(1);
    expect((html.match(/<script src="js\/ubicacionesConocidasLogic\.js"><\/script>/g) || []).length).toBe(1);
  });
});

describe('service worker', () => {
  test('precachea los dos archivos nuevos (offline)', () => {
    expect(sw).toContain("'./js/ubicacionesConocidasLogic.js'");
    expect(sw).toContain("'./js/ubicacionesConocidas.js'");
  });
});

describe('app.js y controlador de correcciones', () => {
  const render = app.slice(app.indexOf('function renderUbicacion'), app.indexOf('// --- Modulo Niveles Estaticos'));

  test('la ficha trae el contenedor y abre el controlador con wellId, location e icono de mapas, ANTES de las correcciones', () => {
    expect(render).toContain('<div id="ubic-conocidas" class="ubic-conocidas"></div>');
    expect(render).toMatch(/ubicacionesConocidasController_abrir\(\{ wellId: location\.wellId, location: location, iconoMaps: ICON_MAPS \}\);/);
    expect(render.indexOf('ubicacionesConocidasController_abrir({')).toBeLessThan(render.indexOf('ubicacionCorreccionController_abrir({'));
    expect(render.indexOf('id="ubic-conocidas"')).toBeLessThan(render.indexOf('id="ubic-correcciones"'));
    expect(render.indexOf('Ubicación de Irrigación')).toBeLessThan(render.indexOf('id="ubic-conocidas"'));
  });

  test('el viejo "Fuentes (detalle técnico)" ya no se pinta (lo reemplazan las Ubicaciones conocidas)', () => {
    expect(app).not.toContain('Fuentes (detalle técnico)');
    expect(app).not.toContain('buildFuentesUbicacion');
  });

  test('logout cierra el visor', () => {
    const logout = app.slice(app.indexOf('function logout()'), app.indexOf("document.getElementById('btn-logout')"));
    expect(logout).toContain('ubicacionesConocidasController_cerrar();');
  });

  test('cada vez que se lee la correccion vigente, el controlador de correcciones se la pasa a las Ubicaciones conocidas', () => {
    expect(correccion).toMatch(/ubicacionesConocidasController_actualizarVigente\(estado\.wellId, \(estado\.lectura && estado\.lectura\.vigente\) \|\| null\)/);
    expect(correccion).toMatch(/typeof ubicacionesConocidasController_actualizarVigente === 'function'/);
  });

  test('las decisiones sobre fuentes: solo js/api.js conoce los nombres de las acciones del backend; los controladores y la logica usan los wrappers', () => {
    const api = leer('js', 'api.js');
    expect(api).toContain("callBackend('getDecisionesFuentesPozo'");
    expect(api).toContain("callBackend('decidirFuenteUbicacion'");
    [controlador, leer('js', 'ubicacionesConocidasLogic.js'), leer('js', 'ubicacionFuenteDecisionesUi.js'), leer('js', 'ubicacionFuenteDecisionesUiLogic.js')].forEach((src) => {
      expect(src).not.toMatch(/'getDecisionesFuentesPozo'|'decidirFuenteUbicacion'|callBackend|fetch\(/);
      expect(src).not.toMatch(/\bufd_/);                                  // nunca el dominio del backend
    });
  });
});

describe('estilos', () => {
  test('hay estilos para la fila, el chip del operativo, la leyenda y los marcadores por tipo', () => {
    ['.ucon-fuente', '.ucon-operativa', '.ucon-chip-operativo', '.ucon-leyenda-fila', '.ucon-marker-reporte', '.ucon-marker-irr', '.ucon-marker-campo', '.ucon-marker-op', '.ucon-popup'].forEach((c) => {
      expect(css).toContain(c);
    });
  });

  test('las filas de la leyenda mantienen el mismo aspecto con hover (el boton global se ponia oscuro)', () => {
    expect(css).toMatch(/\.ucon-leyenda-fila,\s*\.ucon-leyenda-fila:hover \{[^}]*background: var\(--color-surface\);[^}]*color: var\(--color-text\);/);
  });

  test('el texto de coordenadas largas no desborda el ancho de 375 px', () => {
    expect(css).toMatch(/\.ucon-coord \{[^}]*overflow-wrap: anywhere;/);
    expect(css).toMatch(/\.ucon-cab \{[^}]*flex-wrap: wrap;/);
  });
});
