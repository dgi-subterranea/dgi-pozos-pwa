// Ajustes visuales de la prueba real en celular: (1) pantalla de arranque centrada con logo y nombre; (2) separacion entre los botones de Cerca Mio.
// Son guardas sobre index.html y css/styles.css (la verificacion visual real, en 375 px y escritorio, se hace con el navegador).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'css', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const bloque = (selector, fuente) => {
  const re = new RegExp('(?:^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}');
  const m = re.exec(fuente || css);
  return m ? m[1] : null;
};

describe('1. Pantalla de arranque', () => {
  const pantalla = html.slice(html.indexOf('<div id="screen-loading"'), html.indexOf('<div id="screen-login"'));

  test('muestra, en este orden: logo de Irrigacion, "Consulta de Pozos" y el pozo animado con "Cargando…"', () => {
    const iLogo = pantalla.indexOf('irr-logo-inicio');
    const iNombre = pantalla.indexOf('Consulta de Pozos');
    const iCargando = pantalla.indexOf('data-cargando');
    expect(iLogo).toBeGreaterThan(-1);
    expect(iNombre).toBeGreaterThan(iLogo);
    expect(iCargando).toBeGreaterThan(iNombre);
    expect(pantalla).toContain('>Cargando…</div>');
  });

  test('reutiliza el logo oficial que ya esta en el repo (symbol #irr-logo): no hay imagenes nuevas ni recursos externos', () => {
    expect(pantalla).toContain('<use href="#irr-logo"></use>');
    expect(pantalla).toContain('role="img" aria-label="Irrigación"');
    expect(pantalla).not.toMatch(/<img|https?:\/\//);
    expect((html.match(/<symbol id="irr-logo"/g) || []).length).toBe(1);
  });

  test('el nombre es texto real (accesible), no una imagen', () => {
    expect(pantalla).toMatch(/<p class="inicio-nombre">Consulta de Pozos<\/p>/);
  });

  test('queda centrado vertical y horizontalmente con flex, sin altura fija: min-height = viewport real (dvh con respaldo vh) menos el padding del body y las safe areas', () => {
    const b = bloque('#screen-loading:not([hidden])');
    expect(b).not.toBeNull();
    expect(b).toMatch(/display: flex;/);
    expect(b).toMatch(/flex-direction: column;/);
    expect(b).toMatch(/align-items: center;/);
    expect(b).toMatch(/justify-content: center;/);
    expect(b).toMatch(/min-height: calc\(100vh - 48px\);/);                                                                     // respaldo
    expect(b).toMatch(/min-height: calc\(100dvh - 48px - env\(safe-area-inset-top, 0px\) - env\(safe-area-inset-bottom, 0px\)\);/);
    expect(b).toMatch(/padding-left: env\(safe-area-inset-left, 0px\);/);
    expect(b).toMatch(/padding-right: env\(safe-area-inset-right, 0px\);/);
    expect(b).not.toMatch(/[^-]height: \d+px/);                                                                                  // ninguna altura fija en px
  });

  test('el 48px del calculo es exactamente el padding vertical del body (24 + 24): el bloque ocupa el alto visible y no genera scroll', () => {
    expect(bloque('body')).toMatch(/padding: 24px 16px;/);
    expect(bloque('body')).toMatch(/min-height: 100vh;/);
    const b = bloque('body:has(#screen-loading:not([hidden]))');
    expect(b).toMatch(/min-height: 100vh;\s*min-height: 100dvh;/);                                                              // en iPhone 100vh > alto visible
  });

  test('el display:flex solo se aplica cuando NO esta [hidden] (si no, la pantalla seguiria visible tras cargar)', () => {
    expect(css).not.toMatch(/\n#screen-loading \{[^}]*display: flex/);
    expect(css).toMatch(/\[hidden\] \{\s*display: none !important;/);
  });

  test('escritorio: la pantalla de arranque no es una tarjeta (sin fondo, borde ni sombra)', () => {
    const media = css.slice(css.indexOf('@media (min-width: 640px) {\n  /* En escritorio las pantallas son una tarjeta'));
    expect(media).toMatch(/#screen-loading \{\s*background: transparent;\s*border: 0;\s*box-shadow: none;\s*\}/);
  });

  test('el logo escala (200 px con tope del 70 % del ancho) y conserva su proporcion; el nombre usa los tokens de la app', () => {
    const logo = bloque('.irr-logo-inicio');
    expect(logo).toMatch(/width: 200px;/);
    expect(logo).toMatch(/max-width: 70vw;/);
    expect(logo).toMatch(/aspect-ratio: 807 \/ 169;/);
    expect(bloque('.inicio-nombre')).toMatch(/color: var\(--color-text\);/);
    expect(bloque('.irr-logo')).toMatch(/color: var\(--color-primary\);/);
  });

  test('prefers-reduced-motion sigue desactivando las animaciones del pozo; el logo y el nombre no animan nada', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\/\* Sin movimiento: el pozo queda dibujado[^}]*\.cargando \*,[^}]*animation: none;/);
    expect(bloque('.inicio-marca')).not.toMatch(/animation|transition/);
    expect(bloque('.irr-logo-inicio')).not.toMatch(/animation|transition/);
    expect(bloque('.inicio-nombre')).not.toMatch(/animation|transition/);
  });

  test('la pantalla de arranque sigue siendo la que muestra/oculta app.js (mismo id) y el resto de pantallas no cambia', () => {
    expect((html.match(/id="screen-loading"/g) || []).length).toBe(1);
    expect(fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8')).toContain("loading: document.getElementById('screen-loading')");
    expect(html).toContain('<div id="screen-login" class="screen" hidden>');
  });
});

describe('2. Cerca Mio: separacion entre "Ver todos en el mapa" y "Usar estos pozos"', () => {
  const grupo = html.slice(html.indexOf('<div class="cercamio-acciones">'), html.indexOf('</div>', html.indexOf('<div class="cercamio-acciones">')));

  test('los dos botones siguen en el mismo bloque de acciones (mismos ids, mismo orden)', () => {
    expect(grupo).toContain('id="btn-cercamio-ver-todos-mapa"');
    expect(grupo).toContain('id="btn-cercamio-usar-seleccion"');
    expect(grupo.indexOf('btn-cercamio-ver-todos-mapa')).toBeLessThan(grupo.indexOf('btn-cercamio-usar-seleccion'));
    expect((html.match(/class="cercamio-acciones"/g) || []).length).toBe(1);
  });

  test('el bloque es una columna flex con 14 px de separacion (dentro de 12-16 px)', () => {
    const b = bloque('.cercamio-acciones');
    expect(b).toMatch(/display: flex;/);
    expect(b).toMatch(/flex-direction: column;/);
    const gap = parseInt(/gap: (\d+)px;/.exec(b)[1], 10);
    expect(gap).toBeGreaterThanOrEqual(12);
    expect(gap).toBeLessThanOrEqual(16);
  });

  test('respeta la safe area inferior (modo PWA) y no deja los botones pegados al borde', () => {
    expect(bloque('.cercamio-acciones')).toMatch(/padding-bottom: env\(safe-area-inset-bottom, 0px\);/);
    expect(bloque('.cercamio-viewport')).toMatch(/padding: 18px;/);
  });

  test('los botones ocupan el ancho del bloque sin margenes puntuales (la separacion sale del gap, no de un margin hardcodeado)', () => {
    const b = bloque('.cercamio-ver-todos-mapa');
    expect(b).toMatch(/width: 100%;/);
    expect(b).not.toMatch(/margin/);
  });

  test('la lista de pozos conserva su separacion inferior respecto del bloque de acciones', () => {
    expect(bloque('.cercamio-lista')).toMatch(/margin: 10px 0 16px;/);
  });

  test('no se tocaron los handlers: cercaMio.js sigue buscando los botones por id', () => {
    const cm = fs.readFileSync(path.join(__dirname, 'cercaMio.js'), 'utf8');
    expect(cm).toContain("document.getElementById('btn-cercamio-ver-todos-mapa')");
    expect(cm).toContain("document.getElementById('btn-cercamio-usar-seleccion')");
  });
});
