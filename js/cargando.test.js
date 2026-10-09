// Componente comun de "cargando" (js/cargando.js): markup accesible, sin recursos externos, sin ids
// repetidos, hidratacion del HTML estatico, y cableado en index.html / css / sw / controladores.
const fs = require('fs');
const path = require('path');
const C = require('./cargando');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').split(String.fromCharCode(13) + String.fromCharCode(10)).join(String.fromCharCode(10));
const html = leer('index.html');
const css = leer('css', 'styles.css');

describe('cargando_html', () => {
  test('bloque accesible: role=status, aria-live=polite, svg decorativo y texto contextual', () => {
    const h = C.cargando_html('Cargando mapa…');
    expect(h).toContain('role="status"');
    expect(h).toContain('aria-live="polite"');
    expect(h).toMatch(/<svg class="cargando-svg"[^>]*aria-hidden="true"/);
    expect(h).toContain('<span class="cargando-texto">Cargando mapa…</span>');
  });

  test('tamano por defecto md; sm y lg; un tamano desconocido cae en md', () => {
    expect(C.cargando_html('x')).toContain('class="cargando cargando-md"');
    expect(C.cargando_html('x', { tam: 'sm' })).toContain('cargando-sm');
    expect(C.cargando_html('x', { tam: 'lg' })).toContain('cargando-lg');
    expect(C.cargando_html('x', { tam: 'enorme' })).toContain('cargando-md');
  });

  test('opciones fila y soloIcono agregan su clase', () => {
    const h = C.cargando_html('x', { fila: true, soloIcono: true });
    expect(h).toContain('cargando-fila');
    expect(h).toContain('cargando-solo-icono');
  });

  test('el texto se escapa (un wellId o mensaje nunca inyecta HTML)', () => {
    const h = C.cargando_html('Buscando <img src=x onerror=alert(1)> "a" & \'b\'');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
    expect(h).toContain('&amp;');
    expect(h).toContain('&quot;');
  });

  test('sin texto usa el texto por defecto', () => {
    expect(C.cargando_html('')).toContain('Cargando…');
    expect(C.cargando_html(null)).toContain('Cargando…');
  });
});

describe('SVG inline', () => {
  test('liviano, sin recursos externos y sin ids (hay varias instancias en la pagina)', () => {
    expect(C.CARGANDO_SVG.length).toBeLessThan(2500);
    expect(C.CARGANDO_SVG).not.toMatch(/https?:|<image|<script|<foreignObject|href=|url\(|\bid=/i);
  });

  test('dibuja pozo, columna de agua, ondas del nivel freatico y gota', () => {
    ['cargando-tubo', 'cargando-boca', 'cargando-agua', 'cargando-onda', 'cargando-freatico', 'cargando-expansiva', 'cargando-gota', 'cargando-suelo']
      .forEach((c) => expect(C.CARGANDO_SVG).toContain(c));
  });
});

describe('cargando_crear', () => {
  test('arma un elemento con role/aria-live y el interior', () => {
    const attrs = {};
    global.document = { createElement: () => ({ className: '', innerHTML: '', setAttribute: (k, v) => { attrs[k] = v; } }) };
    const el = C.cargando_crear('Procesando foto…', { tam: 'sm', soloIcono: true });
    delete global.document;
    expect(el.className).toBe('cargando cargando-sm cargando-solo-icono');
    expect(attrs).toEqual({ role: 'status', 'aria-live': 'polite' });
    expect(el.innerHTML).toContain('Procesando foto…');
  });
});

describe('cargando_hidratar', () => {
  function nodo(texto, clase) {
    const attrs = { 'data-cargando': '' };
    return {
      textContent: texto, className: clase || '', innerHTML: '', attrs,
      setAttribute(k, v) { attrs[k] = v; },
      removeAttribute(k) { delete attrs[k]; }
    };
  }

  test('convierte el texto del marcador en el texto contextual y completa clases/atributos', () => {
    const n = nodo('  Cargando fotos...  ', 'cargando cargando-sm');
    const total = C.cargando_hidratar({ querySelectorAll: () => [n] });
    expect(total).toBe(1);
    expect(n.className).toBe('cargando cargando-sm');
    expect(n.attrs.role).toBe('status');
    expect(n.attrs['aria-live']).toBe('polite');
    expect(n.innerHTML).toContain('Cargando fotos...');
    expect(n.innerHTML).toContain('cargando-svg');
    expect('data-cargando' in n.attrs).toBe(false);          // idempotente
  });

  test('un marcador sin clase de tamano recibe md y la clase base', () => {
    const n = nodo('Cargando', '');
    C.cargando_hidratar({ querySelectorAll: () => [n] });
    expect(n.className).toBe('cargando cargando-md');
  });

  test('sin DOM no hace nada', () => {
    expect(C.cargando_hidratar(null)).toBe(0);
  });
});

describe('index.html', () => {
  test('ya no quedan spinners circulares sueltos', () => {
    expect(html).not.toMatch(/class="spinner"|gsi-spinner/);
  });

  test('cada marcador data-cargando tiene texto contextual (sin JS sigue siendo legible)', () => {
    const marcadores = html.match(/<div[^>]*data-cargando[^>]*>[^<]*<\/div>/g) || [];
    expect(marcadores.length).toBe((html.match(/data-cargando/g) || []).length);
    marcadores.forEach((m) => expect(m.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(3));
  });

  test('conserva los ids que usa el JS para mostrar/ocultar', () => {
    ['screen-loading', 'google-signin-loading', 'mapa-loading', 'mapa-ne-loading', 'cercamio-pidiendo-permiso', 'bre-cargando',
      'seleccion-itf-loading', 'reemplazo-cargando', 'fotos-cargando', 'reemplazo-visor-cargando', 'fotos-visor-cargando']
      .forEach((id) => expect(html).toContain('id="' + id + '"'));
  });

  test('los visores usan el icono sin texto visible y siguen siendo ocultables con hidden', () => {
    expect(html).toMatch(/id="fotos-visor-cargando" class="cargando cargando-sm cargando-solo-icono" data-cargando/);
    expect(html).toMatch(/id="reemplazo-visor-cargando" class="cargando cargando-sm cargando-solo-icono" data-cargando/);
  });

  test('cargando.js se carga antes que cualquier controlador que lo use', () => {
    const pos = (s) => html.indexOf('<script src="js/' + s + '"');
    expect(pos('cargando.js')).toBeGreaterThan(-1);
    ['mapa.js', 'cercaMio.js', 'fotosPozos.js', 'reemplazoFotos.js', 'app.js'].forEach((s) => expect(pos('cargando.js')).toBeLessThan(pos(s)));
  });
});

describe('css/styles.css', () => {
  test('define el componente y sus animaciones con tokens de la app', () => {
    expect(css).toMatch(/\.cargando \{/);
    ['cargando-aparecer', 'cargando-sube', 'cargando-oleaje', 'cargando-ondas', 'cargando-gota']
      .forEach((k) => expect(css).toContain('@keyframes ' + k));
    expect(css).toContain('var(--color-primary)');
    expect(css).toContain('var(--color-mapa-disponible)');
  });

  test('demora de ~150 ms antes de aparecer (evita destellos) y tamano fijo (sin layout shift)', () => {
    expect(css).toMatch(/\.cargando \{[^}]*animation: cargando-aparecer 0\.2s ease-out 150ms both/);
    expect(css).toMatch(/\.cargando-svg \{[^}]*width: 56px;[^}]*height: 56px;/);
  });

  test('prefers-reduced-motion apaga las animaciones del dibujo', () => {
    const bloque = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce) {\n  /* Sin movimiento'));
    expect(bloque).toContain('animation: none');
    ['.cargando-agua', '.cargando-onda', '.cargando-expansiva', '.cargando-gota'].forEach((c) => expect(bloque).toContain(c));
  });

  test('solo anima transform y opacity (nada que dispare layout)', () => {
    const keyframes = css.match(/@keyframes cargando-[a-z]+ \{[\s\S]*?\n\}/g) || [];
    expect(keyframes.length).toBe(5);
    keyframes.forEach((k) => {
      const props = (k.match(/([a-z-]+):/g) || []).map((p) => p.replace(':', ''));
      props.forEach((p) => expect(['transform', 'opacity']).toContain(p));
    });
  });

  test('desaparecieron los spinners circulares duplicados', () => {
    expect(css).not.toMatch(/\.spinner|gsi-spinner|gsi-spin\b/);
  });
});

describe('cableado en controladores y service worker', () => {
  test('el hub, los popups y las vistas previas usan el componente', () => {
    expect(leer('js', 'app.js')).toContain("cargando_html('Buscando pozo '");
    expect(leer('js', 'mapa.js')).toContain("cargando_html('Cargando datos…'");
    expect(leer('js', 'cercaMio.js')).toContain("cargando_html('Cargando datos…'");
    expect(leer('js', 'fotosPozos.js')).toContain("cargando_crear('Procesando foto…'");
    expect(leer('js', 'reemplazoFotos.js')).toContain("cargando_crear('Procesando foto…'");
  });

  test('cargando.js esta en el shell precacheado (funciona offline)', () => {
    const { SHELL_FILES } = require('../sw');
    expect(SHELL_FILES).toContain('./js/cargando.js');
  });
});
