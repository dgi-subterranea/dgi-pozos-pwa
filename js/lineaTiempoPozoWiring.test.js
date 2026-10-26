// Cableado de la Linea de tiempo del pozo (E6-3): index.html (pantalla propia, accesibilidad y scripts en orden), tarjeta del hub (solo con ubicacion / reemplazo / observaciones === true y
// sin cargar datos), navegacion (Volver cancela y regresa al hub del mismo pozo), cierre de sesion, service worker, CSS propio y responsive, y los limites de app.js (solo cablea).
const fs = require('fs');
const path = require('path');
const L = require('./lineaTiempoPozoLogic');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css').replace(/\r\n/g, '\n');                  // el fin de linea del archivo en disco depende de la configuracion de Git
const app = leer(__dirname, 'app.js').replace(/\r\n/g, '\n');
const api = leer(__dirname, 'api.js');
const { SHELL_FILES } = require('../sw');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const codigoApp = sinComentarios(app);

const pantalla = html.slice(html.indexOf('<div id="screen-linea-tiempo"'), html.indexOf('<!-- Visor de la galeria de fotos de pozos'));

describe('index.html: pantalla propia', () => {
  const ids = ['screen-linea-tiempo', 'btn-linea-tiempo-volver', 'linea-tiempo-entidad', 'linea-tiempo-cargando', 'linea-tiempo-error', 'linea-tiempo-error-texto', 'btn-linea-tiempo-reintentar',
    'linea-tiempo-contenido', 'linea-tiempo-avisos', 'linea-tiempo-filtros', 'linea-tiempo-vacio', 'linea-tiempo-lista'];

  test.each(ids.map((i) => [i]))('existe #%s (una sola vez)', (id) => {
    expect(html.split('id="' + id + '"')).toHaveLength(2);
  });

  test('la pantalla arranca oculta, es una pantalla de modulo y no se mezcla con Observaciones, Datos, Reemplazo ni Fotos', () => {
    expect(html).toMatch(/<div id="screen-linea-tiempo" class="screen" hidden>/);
    expect(pantalla).not.toMatch(/screen-observaciones|screen-datos|screen-reemplazo|screen-fotos|obs-|fotos-|reemplazo-/);
  });

  test('cargando, error, contenido, avisos, filtros y vacio arrancan ocultos', () => {
    ['linea-tiempo-cargando', 'linea-tiempo-error', 'linea-tiempo-contenido', 'linea-tiempo-avisos', 'linea-tiempo-filtros', 'linea-tiempo-vacio'].forEach((id) => {
      expect(html).toMatch(new RegExp('id="' + id + '"[^>]*\\bhidden\\b'));
    });
  });

  test('accesibilidad: titulo semantico, botones reales, estado de carga y avisos anunciados, error como alerta, filtros agrupados, lista ordenada con nombre', () => {
    expect(pantalla).toMatch(/<h2 class="tv-header-label">Línea de tiempo del pozo<\/h2>/);
    expect(pantalla).toMatch(/<button type="button" id="btn-linea-tiempo-volver" class="tv-volver">/);
    expect(pantalla).toMatch(/<button type="button" id="btn-linea-tiempo-reintentar" class="button-secondary">Reintentar<\/button>/);
    expect(pantalla).toMatch(/id="linea-tiempo-cargando"[^>]*role="status"/);
    expect(pantalla).toMatch(/id="linea-tiempo-avisos"[^>]*role="status"/);
    expect(pantalla).toMatch(/id="linea-tiempo-error-texto"[^>]*role="alert"/);
    expect(pantalla).toMatch(/id="linea-tiempo-filtros"[^>]*role="group"[^>]*aria-label="Filtrar por fuente"/);
    expect(pantalla).toMatch(/<ol id="linea-tiempo-lista" class="lt-lista" aria-label="[^"]+">/);
  });

  test('el orden del DOM es el de lectura: volver, cabecera, cargando, error, avisos, filtros, vacio, lista', () => {
    const pos = (id) => pantalla.indexOf('id="' + id + '"');
    ['btn-linea-tiempo-volver', 'linea-tiempo-entidad', 'linea-tiempo-cargando', 'linea-tiempo-error', 'linea-tiempo-avisos', 'linea-tiempo-filtros', 'linea-tiempo-vacio', 'linea-tiempo-lista']
      .reduce((anterior, id) => { expect(pos(id)).toBeGreaterThan(anterior); return pos(id); }, -1);
  });

  test('sin handlers inline, sin formularios ni campos, sin data-* (salvo el de la animacion de carga) y sin estilos en linea', () => {
    expect(pantalla).not.toMatch(/\son[a-z]+=|<form|<input|<textarea|<select|data-(?!cargando)|style=/i);
  });

  test('usa clases propias lt-* (mas las genericas ya existentes: tv-*, cargando, mapa-titulo, error-message, button-secondary, screen)', () => {
    const clases = (pantalla.match(/class="([^"]+)"/g) || []).join(' ').replace(/class="|"/g, '').split(/\s+/).filter(Boolean);
    const permitidas = /^(lt-[a-z-]+|tv-topbar|tv-topbar-fija|tv-volver|tv-header|tv-header-label|mapa-titulo|mono|cargando|error-message|button-secondary|screen)$/;
    clases.forEach((c) => expect(c).toMatch(permitidas));
  });

  test('scripts en orden: api.js y reemplazoLogic.js (fecha / motivos) -> modelo -> cargador -> presentacion -> controlador -> app.js', () => {
    const pos = (n) => html.indexOf('<script src="js/' + n + '"></script>');
    const orden = ['api.js', 'reemplazoLogic.js', 'lineaTiempoPozoLogic.js', 'lineaTiempoPozoLoader.js', 'lineaTiempoPozoVistaLogic.js', 'lineaTiempoPozo.js', 'app.js'];
    orden.forEach((n) => expect(pos(n)).toBeGreaterThan(-1));
    orden.reduce((anterior, n) => { expect(pos(n)).toBeGreaterThan(anterior); return pos(n); }, -1);
  });
});

describe('service worker', () => {
  test('los cuatro archivos nuevos estan en el shell, antes de app.js', () => {
    ['./js/lineaTiempoPozoLogic.js', './js/lineaTiempoPozoLoader.js', './js/lineaTiempoPozoVistaLogic.js', './js/lineaTiempoPozo.js'].forEach((f) => {
      expect(SHELL_FILES).toContain(f);
      expect(SHELL_FILES.indexOf(f)).toBeLessThan(SHELL_FILES.indexOf('./js/app.js'));
    });
  });

  test('el service worker sigue sin cachear la API y no menciona la linea de tiempo mas que en la lista del shell', () => {
    const sw = leer(raiz, 'sw.js');
    expect(sw).toMatch(/function isExternalApi/);
    expect(sw).toMatch(/script\.google\.com/);
    const fuera = sw.split('\n').filter((l) => /lineaTiempo/.test(l) && !/^\s*'\.\/js\/lineaTiempoPozo[A-Za-z]*\.js',?$/.test(l));
    expect(fuera).toEqual([]);
    expect(sw).not.toMatch(/getObservacionesPozo|getCorreccionesUbicacionPozo|getHistorialReemplazo/);
  });
});

describe('tarjeta del hub', () => {
  const desde = codigoApp.indexOf('if (lineaTiempoPozoLogic_puedeVerLineaTiempo(permisosActuales)) {');
  const bloqueHub = codigoApp.slice(desde, codigoApp.indexOf('Cantidad impar (>1)'));

  test('se agrega con el titulo y el copy pedidos, SOLO bajo la funcion pura de acceso', () => {
    expect(codigoApp).toMatch(/if \(lineaTiempoPozoLogic_puedeVerLineaTiempo\(permisosActuales\)\) \{\n\s+modulos\.push\(\{ id: 'linea-tiempo', titulo: 'Línea de tiempo', desc: 'Historia operativa del pozo', icono: ICON_LINEA_TIEMPO \}\);\n\s+\}/);
    expect(codigoApp.split("id: 'linea-tiempo'")).toHaveLength(2);
  });

  test('la condicion de la tarjeta no mira perfil, datos, ne, fotos ni ningun otro permiso', () => {
    const condicion = codigoApp.match(/if \((lineaTiempoPozoLogic_puedeVerLineaTiempo\([^)]*\))\) \{\n\s+modulos\.push\(\{ id: 'linea-tiempo'/)[1];
    expect(condicion).toBe('lineaTiempoPozoLogic_puedeVerLineaTiempo(permisosActuales)');
    expect(condicion).not.toMatch(/perfil|datos|\bne\b|fotos|pozo\.|\|\||&&/);
  });

  test.each([
    [{ ubicacion: true }, true], [{ reemplazo: true }, true], [{ observaciones: true }, true], [{ ubicacion: true, reemplazo: true, observaciones: true }, true],
    [{ ubicacion: false, reemplazo: false, observaciones: false }, false], [{}, false],
    [{ perfil: true }, false], [{ datos: true }, false], [{ ne: true }, false], [{ fotos: true }, false], [{ perfil: true, datos: true, ne: true, fotos: true, fotos_carga: true }, false],
    [{ ubicacion_validar: true, ubicacion_corregir: true, observaciones_agregar: true, observaciones_anular: true }, false],
    [{ ubicacion: 'SI' }, false], [{ reemplazo: 1 }, false], [{ observaciones: 'true' }, false], [{ ubicacion: 'SI', reemplazo: 1, observaciones: 'true' }, false], [null, false], [undefined, false]
  ])('permisos %j -> tarjeta: %s', (permisos, esperado) => {
    expect(L.lineaTiempoPozoLogic_puedeVerLineaTiempo(permisos)).toBe(esperado);
  });

  test('la tarjeta NO carga datos: ni el bloque del hub ni el despacho llaman a la API, al cargador ni al controlador de carga', () => {
    expect(bloqueHub.slice(0, 400)).not.toMatch(/api[A-Z]\w*\(|lineaTiempoPozoLoader|lineaTiempoPozoController_abrir|\.cargar\(/);
    const i = codigoApp.indexOf("} else if (id === 'linea-tiempo') {");
    expect(i).toBeGreaterThan(-1);
    const despacho = codigoApp.slice(i, i + 120);
    expect(despacho).toMatch(/abrirLineaTiempo\(pozoActual\.wellId\);/);
    expect(despacho).not.toMatch(/api[A-Z]|\.cargar/);
  });

  test('el icono propio existe y la tarjeta se agrega despues de Observaciones (ultima)', () => {
    expect(app).toMatch(/var ICON_LINEA_TIEMPO = '<svg/);
    expect(app.indexOf("id: 'observaciones', titulo")).toBeLessThan(app.indexOf("id: 'linea-tiempo', titulo"));
  });
});

describe('navegacion y sesion', () => {
  test('abrirLineaTiempo exige el permiso (defensa en profundidad), cambia de pantalla y abre el controlador; Volver cancela y regresa al hub del mismo pozo', () => {
    expect(app).toMatch(/function abrirLineaTiempo\(wellId\) \{\n\s+if \(!lineaTiempoPozoLogic_puedeVerLineaTiempo\(permisosActuales\) \|\| typeof wellId !== 'string'\) \{\n\s+return;[^\n]*\n\s+\}\n\s+showScreen\('lineaTiempo'\);\n\s+lineaTiempoPozoController_abrir\(wellId\);/);
    expect(app).toMatch(/getElementById\('btn-linea-tiempo-volver'\)\.addEventListener\('click', function \(\) \{\n\s+lineaTiempoPozoController_cerrar\(\);\n\s+showScreen\('main'\);\n\s+\}\);/);
    expect(app).toMatch(/lineaTiempo: document\.getElementById\('screen-linea-tiempo'\),/);
  });

  test('volver al hub no toca el pozo actual ni lanza una busqueda nueva', () => {
    const i = app.indexOf("document.getElementById('btn-linea-tiempo-volver')");
    const volver = app.slice(i, i + 220);
    expect(volver).not.toMatch(/pozoActual|buscarPozo|renderHub/);
  });

  test('el contexto del controlador entrega token y permisos FRESCOS y conecta la sesion vencida con el logout existente', () => {
    expect(app).toMatch(/lineaTiempoPozoController_inicializar\(function \(\) \{\n\s+return \{\n\s+sessionToken: sessionToken,\n\s+permisos: permisosActuales,\n\s+onSessionExpired: function \(\) \{\n\s+logout\(\);\n\s+\}\n\s+\};\n\s+\}\);/);
  });

  test('el logout descarta la linea de tiempo abierta', () => {
    const i = app.indexOf('function logout() {');
    expect(app.slice(i, i + 2600)).toMatch(/lineaTiempoPozoController_reset\(\);/);
  });

  test('app.js solo cablea: sin render, sin normalizacion, sin cargador ni logica de presentacion de la linea de tiempo', () => {
    const lineas = codigoApp.split('\n').filter((l) => /lineaTiempo|linea-tiempo|LINEA_TIEMPO/i.test(l));
    expect(lineas.length).toBeGreaterThan(5);
    lineas.forEach((l) => expect(l).not.toMatch(/lineaTiempoPozoLoader|lineaTiempoPozoVista|lineaTiempoPozoLogic_(normalizar|deduplicar|ordenar|armar|filtrar)|innerHTML|createElement/));
  });

  test('api.js no cambio: ningun wrapper nuevo para la linea de tiempo (se usan los de lectura que ya existian)', () => {
    expect(api).not.toMatch(/lineaTiempo|linea-tiempo|LineaTiempo/);
  });
});

describe('CSS propio y responsive', () => {
  const inicio = css.indexOf('/* --- Linea de tiempo del pozo (E6-3, solo lectura) --- */');
  const bloque = css.slice(inicio, css.indexOf('/* --- Observaciones del pozo (E5-4, solo lectura) --- */'));

  test('el bloque existe y todos sus selectores son .lt-* o #screen-linea-tiempo', () => {
    expect(inicio).toBeGreaterThan(-1);
    const selectores = (bloque.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+(?=\{)/g) || []).map((s) => s.trim()).filter((s) => !/^@media/.test(s));
    expect(selectores.length).toBeGreaterThan(20);
    selectores.forEach((lista) => lista.split(',').forEach((s) => expect(s.trim()).toMatch(/^(\.lt-[a-z-]+|#screen-linea-tiempo)(\s|:|\.|$)/)));
  });

  test('no reutiliza clases reemplazo-* ni obs-* y no toca otros modulos', () => {
    expect(bloque).not.toMatch(/reemplazo-|\.obs-|fotos-|\.hub-/);
  });

  test('mobile first sin scroll horizontal: textos que se parten, items con min-width 0, nada de anchos fijos ni nowrap', () => {
    expect(bloque).toMatch(/\.lt-item \{[^}]*min-width: 0;/);
    ['lt-titulo', 'lt-detalle', 'lt-aviso', 'lt-autor'].forEach((c) => expect(bloque).toMatch(new RegExp('\\.' + c + '[^{]*\\{[^}]*overflow-wrap: anywhere;')));
    expect(bloque.replace(/@media \([^)]*\)/g, '')).not.toMatch(/white-space: nowrap|(^|[^-])width: \d+px|min-width: \d+px/);
    expect(bloque).toMatch(/\.lt-filtros \{[^}]*flex-wrap: wrap;/);
    expect(bloque).toMatch(/\.lt-item-cabecera \{[^}]*flex-wrap: wrap;/);
  });

  test('escritorio: la pantalla se limita a 640 px con la misma cabecera que Observaciones', () => {
    expect(bloque).toMatch(/@media \(min-width: 640px\) \{\n\s+#screen-linea-tiempo \{\n\s+max-width: 640px;/);
  });

  test('filtros: boton tactil de 44 px, estado seleccionado con tilde ademas del color, hover que no pisa el texto, foco visible', () => {
    expect(bloque).toMatch(/\.lt-filtro \{[^}]*min-height: 44px;/);
    expect(bloque).toMatch(/\.lt-filtro-activo::before \{\n\s+content: "\\2713\\00a0";/);
    expect(bloque).toMatch(/\.lt-filtro:hover,\n\.lt-filtro:active \{[^}]*background: var\(--color-primary-tint\);/);
    expect(bloque).toMatch(/\.lt-filtro:focus-visible \{[^}]*outline: 2px solid/);
  });

  test('cada fuente tiene un refuerzo de color PERO la fuente se lee en el texto del badge', () => {
    expect(bloque).toMatch(/\.lt-fuente \{[^}]*text-transform: uppercase;/);
    expect(bloque).toMatch(/\.lt-item-reemplazo \.lt-fuente/);
    expect(bloque).toMatch(/\.lt-item-observaciones \.lt-fuente/);
  });
});
