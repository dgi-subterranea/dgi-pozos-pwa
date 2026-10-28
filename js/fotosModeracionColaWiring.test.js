// Guardas baratas del cableado de "Fotos pendientes" (E8-5): ids del controlador, markup accesible (pestañas, dialogos), tarjeta del hub, app.js (permiso exacto, carga solo al abrir, reset), orden de
// scripts, service worker, wrappers de api.js y CSS acotado a .fotos-cola-*. El comportamiento esta en fotosModeracionColaLogic.test.js y fotosModeracionColaController.test.js.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const sw = leer(raiz, 'sw.js');
const api = leer(__dirname, 'api.js');
const app = leer(__dirname, 'app.js');
const controlador = leer(__dirname, 'fotosModeracionCola.js');
const logica = leer(__dirname, 'fotosModeracionColaLogic.js');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const codigoApp = sinComentarios(app);
const pantalla = html.slice(html.indexOf('<div id="screen-fotos-moderacion"'), html.indexOf('<div id="fotos-cola-conf-overlay"'));
const dialogos = html.slice(html.indexOf('<div id="fotos-cola-conf-overlay"'), html.indexOf('<!-- Confirmacion antes de guardar'));

describe('markup de la pantalla y de los dialogos', () => {
  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    expect(ids.size).toBeGreaterThan(25);
    expect([...ids].filter((id) => !new RegExp('id="' + id + '"').test(html))).toEqual([]);
  });

  test('ningun id esta repetido en el markup nuevo', () => {
    const ids = Array.from((pantalla + dialogos).matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(25);
    expect(new Set(ids).size).toBe(ids.length);
    ids.forEach((id) => expect(html.split('id="' + id + '"').length - 1).toBe(1));
  });

  test('es una pantalla propia, oculta por defecto, y esta registrada en showScreen', () => {
    expect(html).toMatch(/<div id="screen-fotos-moderacion" class="screen" hidden>/);
    expect(app).toMatch(/fotosModeracion: document\.getElementById\('screen-fotos-moderacion'\)/);
  });

  test('titulo y subtitulo pedidos, y boton Volver real', () => {
    expect(pantalla).toMatch(/<h1 class="mapa-titulo">Fotos pendientes<\/h1>/);
    expect(pantalla).toContain('Revisá solicitudes de retiro');
    expect(pantalla).toMatch(/<button type="button" id="btn-fotos-cola-volver" class="tv-volver">/);
  });

  test('pestañas accesibles: tablist con nombre, dos tabs con aria-selected / aria-controls / tabindex y un tabpanel', () => {
    expect(pantalla).toMatch(/<div class="fotos-cola-pestanas" role="tablist" aria-label="Fotos a revisar">/);
    expect(pantalla).toMatch(/<button type="button" id="fotos-cola-tab-pendientes" class="fotos-cola-pestana" role="tab" aria-selected="true" aria-controls="fotos-cola-panel" tabindex="0">Pendientes<\/button>/);
    expect(pantalla).toMatch(/<button type="button" id="fotos-cola-tab-retiradas" class="fotos-cola-pestana" role="tab" aria-selected="false" aria-controls="fotos-cola-panel" tabindex="-1">Retiradas<\/button>/);
    expect(pantalla).toMatch(/<div id="fotos-cola-panel" class="fotos-cola-panel" role="tabpanel" aria-labelledby="fotos-cola-tab-pendientes" tabindex="-1">/);
  });

  test('estados anunciables: aviso y total como status; cargando y errores con role; lista como ul', () => {
    expect(pantalla).toMatch(/id="fotos-cola-aviso"[^>]*role="status"[^>]*tabindex="-1" hidden/);
    expect(pantalla).toMatch(/id="fotos-cola-total"[^>]*role="status"/);
    expect(pantalla).toMatch(/id="fotos-cola-cargando"[^>]*role="status"/);
    expect(pantalla).toMatch(/id="fotos-cola-error-texto"[^>]*role="alert"/);
    expect(pantalla).toMatch(/id="fotos-cola-mas-error"[^>]*role="alert"/);
    expect(pantalla).toMatch(/<ul id="fotos-cola-lista" class="fotos-cola-lista"><\/ul>/);
  });

  test('botones reales (button) para Volver, Actualizar, Reintentar y Ver mas; ocultos o deshabilitados cuando corresponde', () => {
    expect(pantalla).toMatch(/<button type="button" id="btn-fotos-cola-actualizar"/);
    expect(pantalla).toMatch(/<button type="button" id="btn-fotos-cola-reintentar" class="button-secondary">Reintentar<\/button>/);
    expect(pantalla).toMatch(/<button type="button" id="btn-fotos-cola-mas"[^>]*hidden>Ver más<\/button>/);
    ['fotos-cola-cargando', 'fotos-cola-error', 'fotos-cola-vacio', 'fotos-cola-mas-error', 'fotos-cola-total', 'fotos-cola-aviso'].forEach((id) => {
      expect(pantalla).toMatch(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*\\shidden'));
    });
  });

  test('NO hay buscador ni filtros (no se simula buscar en toda la cola filtrando una pagina)', () => {
    expect(pantalla).not.toMatch(/<input|<select|<textarea|type="search"|placeholder/i);
  });

  test('los dos dialogos son role=dialog aria-modal, ocultos, con titulo y botones reales; la confirmacion NO pide motivo', () => {
    ['fotos-cola-conf-overlay', 'fotos-cola-vis-overlay'].forEach((id) => {
      expect(dialogos).toMatch(new RegExp('<div id="' + id + '" class="fotos-mod-overlay" role="dialog" aria-modal="true" aria-labelledby="[^"]+"[^>]*hidden>'));
    });
    expect(dialogos).toMatch(/<h2 id="fotos-cola-conf-titulo"/);
    expect(dialogos).toMatch(/<button type="button" id="btn-fotos-cola-conf-cancelar" class="button-secondary">Cancelar<\/button>/);
    expect(dialogos).toMatch(/<button type="button" id="btn-fotos-cola-conf-confirmar" class="button"><\/button>/);
    expect(dialogos).toMatch(/id="fotos-cola-conf-error"[^>]*role="alert"/);
    expect(dialogos).toMatch(/<img id="fotos-cola-vis-img" class="fotos-cola-vis-img" alt="Foto en revisión" hidden>/);
    expect(dialogos.slice(0, dialogos.indexOf('id="fotos-cola-vis-overlay"'))).not.toMatch(/<select|<textarea|<input/);
  });

  test('sin handlers inline, sin estilos en linea y sin data-* en el markup nuevo', () => {
    [pantalla, dialogos].forEach((b) => {
      expect(b.length).toBeGreaterThan(500);
      expect(b).not.toMatch(/\son[a-z]+=|style=|data-(?!cargando)/i);
    });
  });

  test('las pantallas y dialogos nuevos van fuera de las zonas que guardan otros modulos (E5-4 / E6-3)', () => {
    const iVisor = html.indexOf('<!-- Visor de la galeria de fotos de pozos');
    expect(iVisor).toBeGreaterThan(0);
    expect(html.indexOf('id="screen-fotos-moderacion"')).toBeGreaterThan(iVisor);
    expect(html.indexOf('id="fotos-cola-vis-overlay"')).toBeGreaterThan(iVisor);
  });
});

describe('tarjeta del hub', () => {
  const tarjeta = html.slice(html.indexOf('<button type="button" id="btn-abrir-fotos-moderacion"'), html.indexOf('</button>', html.indexOf('<button type="button" id="btn-abrir-fotos-moderacion"')) + 9);

  test('tarjeta propia, con el copy pedido, oculta por defecto (nunca parpadea antes del permiso real)', () => {
    expect(tarjeta).toMatch(/id="btn-abrir-fotos-moderacion" class="button-secondary btn-mapa-acceso fotos-cola-acceso" hidden>/);
    expect(tarjeta).toContain('>Fotos pendientes<');
    expect(tarjeta).toContain('>Revisá solicitudes de retiro<');
  });

  test('esta en la pantalla principal (hub), junto a los otros accesos institucionales', () => {
    const main = html.slice(html.indexOf('<div id="screen-main"'), html.indexOf('<div id="screen-well-record-table"'));
    expect(main).toContain('id="btn-abrir-fotos-moderacion"');
    expect(main.indexOf('btn-abrir-reemplazo')).toBeLessThan(main.indexOf('btn-abrir-fotos-moderacion'));
  });

  test('la tarjeta se muestra SOLO con fotos + fotos_moderar exactos (la regla compartida de moderacion), recalculada con los permisos de hoy', () => {
    expect(codigoApp).toMatch(/document\.getElementById\('btn-abrir-fotos-moderacion'\)\.hidden = !fotosModeracionLogic_puedeModerar\(permisosActuales\);/);
    const i = codigoApp.indexOf('function toggleAccesosUbicacion');
    expect(codigoApp.slice(i, codigoApp.indexOf('function enterMain'))).toContain('btn-abrir-fotos-moderacion');
  });

  test('la tarjeta NO carga datos: toggleAccesosUbicacion, enterMain y showScreen no llaman a la cola; solo el click', () => {
    expect(codigoApp.match(/fotosModeracionColaController_abrir\(\)/g)).toHaveLength(1);
    const i = codigoApp.indexOf("document.getElementById('btn-abrir-fotos-moderacion').addEventListener('click'");
    expect(codigoApp.slice(i, i + 700)).toMatch(/fotosModeracionColaController_abrir\(\)/);
    ['function toggleAccesosUbicacion', 'function enterMain', 'function showScreen'].forEach((f) => {
      const j = codigoApp.indexOf(f);
      expect(codigoApp.slice(j, j + 900)).not.toMatch(/fotosModeracionColaController_/);
    });
  });

  test('al hacer click se vuelve a comprobar el permiso (si se perdio, no se abre ni se pide nada) y se recuerda el origen', () => {
    const i = codigoApp.indexOf("document.getElementById('btn-abrir-fotos-moderacion').addEventListener('click'");
    const bloque = codigoApp.slice(i, i + 700);
    expect(bloque).toMatch(/if \(!fotosModeracionLogic_puedeModerar\(permisosActuales\)\) \{\s*toggleAccesosUbicacion\(\);[^\n]*\n\s*return;\s*\}/);
    expect(bloque.indexOf('puedeModerar')).toBeLessThan(bloque.indexOf('showScreen'));
    expect(bloque).toMatch(/fotosModeracionOrigen = \{ pantalla: pantallaActual, scrollY: window\.scrollY \}/);
    expect(bloque.indexOf('showScreen')).toBeLessThan(bloque.indexOf('fotosModeracionColaController_abrir'));
  });

  test('Volver cierra la pantalla (descarta lo que este en vuelo) y regresa al origen', () => {
    expect(codigoApp).toMatch(/btn-fotos-cola-volver'\)\.addEventListener\('click', function \(\) \{\s*fotosModeracionColaController_cerrar\(\);\s*restaurarPantalla\(fotosModeracionOrigen\);/);
  });

  test('el contexto es fresco (token y permisos de HOY) y la sesion vencida usa el logout de siempre', () => {
    expect(codigoApp).toMatch(/fotosModeracionColaController_inicializar\(function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);/);
  });

  test('cerrar sesion descarta la pantalla junto con la moderacion de la galeria', () => {
    expect(codigoApp).toMatch(/fotosModeracionController_reset\(\);[\s\S]{0,200}fotosModeracionColaController_reset\(\);/);
  });

  test('app.js no tiene la cola en su codigo: solo tarjeta, cableado y reset', () => {
    expect(codigoApp).not.toMatch(/apiResolver|apiGetFotosPozos(Pendientes|Retiradas)|apiGetFotoPozoModeracion|fotos_moderar|fotosModeracionColaLogic_/);
  });
});

describe('scripts, service worker y api.js', () => {
  test('orden de scripts: la logica de la cola despues de la logica de moderacion y antes del controlador; todo antes de app.js', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('fotosModeracionColaLogic.js')).toBeGreaterThan(pos('fotosModeracionLogic.js'));
    expect(pos('fotosModeracionColaLogic.js')).toBeGreaterThan(pos('fotosPozosLogic.js'));
    expect(pos('fotosModeracionCola.js')).toBeGreaterThan(pos('fotosModeracionColaLogic.js'));
    expect(pos('fotosModeracionCola.js')).toBeGreaterThan(pos('fotosModeracion.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('fotosModeracionCola.js'));
    expect(pos('fotosModeracionColaLogic.js')).toBeGreaterThan(0);
  });

  test('el service worker precachea los dos archivos nuevos y no cachea API ni imagenes', () => {
    const { SHELL_FILES } = require('../sw.js');
    expect(SHELL_FILES).toContain('./js/fotosModeracionColaLogic.js');
    expect(SHELL_FILES).toContain('./js/fotosModeracionCola.js');
    expect(sw).not.toMatch(/getFotosPozosRetiradasModeracion|getFotosPozosPendientesModeracion|resolverRetiroFotoPozo/);
  });

  test('api.js: los wrappers mandan solo lo que es del cliente', () => {
    expect(api).toContain("callBackend('getFotosPozosRetiradasModeracion', { sessionToken: sessionToken, limit: limit, cursor: cursor })");
    expect(api).toContain("callBackend('getFotosPozosPendientesModeracion', { sessionToken: sessionToken, limit: limit, cursor: cursor })");
    expect(api).toContain("callBackend('resolverRetiroFotoPozo', { sessionToken: sessionToken, solicitudId: solicitudId, resolucion: resolucion, clientRequestId: clientRequestId })");
  });

  test('el controlador usa los wrappers existentes y NADA mas del backend', () => {
    const codigo = sinComentarios(controlador);
    const usados = Array.from(codigo.matchAll(/\b(api[A-Z]\w+)\(/g)).map((m) => m[1]).filter((v, i, a) => a.indexOf(v) === i).sort();
    expect(usados).toEqual(['apiGetFotoPozoModeracion', 'apiGetFotosPozosPendientesModeracion', 'apiGetFotosPozosRetiradasModeracion', 'apiReponerFotoPozo', 'apiResolverRetiroFotoPozo']);
  });

  test('la logica es pura: sin DOM, sin red y sin permisos propios', () => {
    expect(sinComentarios(logica)).not.toMatch(/document\.|window\.|fetch\(|callBackend|api[A-Z]\w+\(/);
  });
});

describe('CSS propio y responsive', () => {
  const marca = '/* --- Fotos pendientes (E8-5)';
  const inicio = css.indexOf(marca);
  const bloque = css.slice(inicio, css.indexOf('/* --- Moderacion de fotos de pozos (E8-4).'));
  const regla = (sel) => {
    const escapado = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|\\n)' + escapado + ' \\{([^}]*)\\}', 'g');
    return Array.from(bloque.matchAll(re)).map((m) => m[1]).join('\n');
  };

  test('el bloque existe y TODOS sus selectores son .fotos-cola-*', () => {
    expect(inicio).toBeGreaterThan(0);
    const selectores = Array.from(bloque.matchAll(/(^|\n)\s*([^\n{};@/]+?)\s*\{/g)).map((m) => m[2].trim()).filter((x) => x !== '');
    expect(selectores.length).toBeGreaterThan(25);
    selectores.forEach((sel) => expect(sel).toMatch(/^\.fotos-cola-/));
  });

  test('no toca otros modulos ni elementos genericos', () => {
    expect(bloque).not.toMatch(/(^|\n)\s*(\.obs-|\.reemplazo-|\.fotos-(?!cola-)|\.hub-|\.lt-|#screen-|body\s*\{|button\s*\{|\.button\b|\.error-message)/);
  });

  test('pestañas: la activa no depende solo del color (trazo grueso, peso y subrayado), hover propio y foco visible', () => {
    const activa = bloque.slice(bloque.indexOf('.fotos-cola-pestana[aria-selected="true"]'));
    expect(activa).toMatch(/border-bottom-color:/);
    expect(activa.slice(0, activa.indexOf('}'))).toMatch(/font-weight:\s*800/);
    expect(activa.slice(0, activa.indexOf('}'))).toMatch(/text-decoration:\s*underline/);
    expect(regla('.fotos-cola-pestana')).toMatch(/border-bottom:\s*4px solid transparent/);
    expect(regla('.fotos-cola-pestana')).toMatch(/background:\s*transparent/);
    expect(bloque).toMatch(/\.fotos-cola-pestana:hover \{[^}]*background: var\(--color-primary-tint\)/);
    expect(bloque).toMatch(/\.fotos-cola-pestana:focus-visible \{[^}]*outline:\s*3px/);
  });

  test('sin scroll horizontal: textos que se parten, columnas que encogen, botones que envuelven', () => {
    expect(regla('.fotos-cola-cuerpo p')).toMatch(/overflow-wrap:\s*anywhere/);
    expect(regla('.fotos-cola-cuerpo')).toMatch(/min-width:\s*0/);
    expect(regla('.fotos-cola-item')).toMatch(/grid-template-columns:\s*88px minmax\(0, 1fr\)/);
    expect(regla('.fotos-cola-acciones')).toMatch(/flex-wrap:\s*wrap/);
    expect(regla('.fotos-cola-texto')).toMatch(/white-space:\s*pre-wrap/);
    expect(regla('.fotos-cola-acciones button')).toMatch(/min-width:\s*0/);
    expect(regla('.fotos-cola-acceso-textos')).toMatch(/min-width:\s*0/);
    expect(regla('.fotos-cola-vis-img')).toMatch(/max-width:\s*100%/);
    expect(regla('.fotos-cola-mas')).toMatch(/width:\s*100%/);
    expect(bloque).not.toMatch(/white-space:\s*nowrap|min-width:\s*\d+px/);
  });

  test('objetivos tactiles de 44 px o mas', () => {
    expect(regla('.fotos-cola-acciones button')).toMatch(/min-height:\s*44px/);
    expect(regla('.fotos-cola-actualizar')).toMatch(/min-height:\s*44px/);
    expect(regla('.fotos-cola-pestana')).toMatch(/min-height:\s*48px/);
    expect(regla('.fotos-cola-acceso')).toMatch(/min-height:\s*56px/);
  });

  test('la miniatura tiene recuadro fijo y la imagen la rellena sin deformarse', () => {
    expect(regla('.fotos-cola-mini')).toMatch(/width:\s*88px/);
    expect(regla('.fotos-cola-mini')).toMatch(/height:\s*88px/);
    expect(regla('.fotos-cola-mini img')).toMatch(/object-fit:\s*cover/);
  });

  test('el estado deshabilitado se ve apagado (no depende del color)', () => {
    expect(regla('.fotos-cola-acciones button:disabled')).toMatch(/opacity:\s*0\.4/);
  });
});
