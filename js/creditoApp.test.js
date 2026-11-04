// Credito del desarrollo ("Desarrollado por Hidrogeología (Albrieu - Ryan)"): guardas sobre index.html y css/styles.css.
// La verificacion visual real (375 px y escritorio) se hace con el navegador.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(raiz, 'css', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');
const bloque = (selector) => {
  const re = new RegExp('(?:^|\\n)' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}');
  const m = re.exec(css);
  return m ? m[1] : null;
};
const textoPlano = (fragmento) => fragmento.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const TEXTO = 'Desarrollado por Hidrogeología (Albrieu - Ryan)';
const bloques = html.match(/<(p|footer) class="credito-app[^"]*">[\s\S]*?<\/\1>/g) || [];

describe('Credito del desarrollo', () => {
  test('aparece en tres lugares exactos: arranque, login y UN footer global (no se repite por pantalla)', () => {
    expect(bloques).toHaveLength(3);
    expect(html).toContain('class="credito-app credito-app-inicio"');
    expect(html).toContain('class="credito-app credito-app-login"');
    expect((html.match(/<footer class="credito-app credito-app-pie">/g) || [])).toHaveLength(1);
  });

  test('el texto es exactamente el pedido, en un solo nodo de texto (sin spans ni separadores) y sin el credito anterior', () => {
    bloques.forEach((b) => {
      expect(textoPlano(b)).toBe(TEXTO);
      expect(b).not.toMatch(/<span/);
    });
    expect(html).not.toContain('Creado por');
  });

  test('arranque y login lo llevan dentro de su pantalla, despues del logo institucional; el global queda fuera de todas', () => {
    const arranque = html.slice(html.indexOf('<div id="screen-loading"'), html.indexOf('<div id="screen-login"'));
    const login = html.slice(html.indexOf('<div id="screen-login"'), html.indexOf('<div id="screen-main"'));
    expect(arranque.indexOf('credito-app-inicio')).toBeGreaterThan(arranque.indexOf('data-cargando'));
    expect(login.indexOf('credito-app-login')).toBeGreaterThan(login.indexOf('irr-logo-login'));
    const iPie = html.indexOf('credito-app-pie');
    expect(iPie).toBeGreaterThan(html.indexOf('id="seleccion-confirmar-overlay"'));
    expect(iPie).toBeLessThan(html.indexOf('<script src="js/wellIdValidator.js">'));
  });

  test('jerarquia secundaria: chico, color apagado de los tokens (sin hex sueltos) y sin competir con el logo', () => {
    const b = bloque('.credito-app');
    expect(b).toMatch(/font-size: 0\.7rem;/);
    expect(b).toMatch(/color: var\(--color-text-soft\);/);
    expect(b).not.toMatch(/#[0-9a-f]{3,6}/i);
  });

  test('el footer global NO es fijo: va en el flujo, sin position fixed/sticky/absolute, y suma la safe area inferior', () => {
    const b = bloque('.credito-app-pie');
    expect(b).not.toMatch(/position:/);
    expect(b).toMatch(/padding: 22px 0 env\(safe-area-inset-bottom, 0px\);/);
    expect(b).toMatch(/margin-top: auto;/);
  });

  test('el global se oculta mientras se ve el arranque o el login (que llevan el suyo): nunca dos creditos a la vez', () => {
    expect(css).toMatch(/body:has\(#screen-loading:not\(\[hidden\]\)\) \.credito-app-pie,\s*body:has\(#screen-login:not\(\[hidden\]\)\) \.credito-app-pie \{\s*display: none;/);
  });

  test('en arranque se ancla al borde inferior del bloque con relleno simetrico: el logo y el pozo siguen centrados', () => {
    const pantalla = bloque('#screen-loading:not([hidden])');
    expect(pantalla).toMatch(/display: flex;/); // la regla original del centrado sigue siendo la primera
    const extra = css.slice(css.indexOf('#screen-loading:not([hidden]) {\n  position: relative;'));
    expect(extra).toMatch(/position: relative;\s*padding-top: 44px;\s*padding-bottom: 44px;/);
    expect(bloque('.credito-app-inicio')).toMatch(/position: absolute;[\s\S]*bottom: 0;/);
  });

  test('entra en una sola linea en 375 px: no hay reglas de apilado ni separadores', () => {
    expect(css).not.toMatch(/credito-app-(autor|area|sep)/);
  });

  test('el texto es real (accesible), sin imagenes ni recursos externos nuevos', () => {
    bloques.forEach((b) => expect(b).not.toMatch(/<img|<svg|https?:\/\//));
  });
});
