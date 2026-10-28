// Guardas baratas del cableado de la moderacion de fotos (E8-4): ids que usa el controlador, orden de scripts, service worker, wrappers de api.js, quien toca los endpoints, integracion con
// fotosPozos.js y app.js, CSS acotado a .fotos-mod-* y privacidad del renderizado. El comportamiento esta en fotosModeracionController.test.js y fotosModeracionLogic.test.js.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const sw = leer(raiz, 'sw.js');
const api = leer(__dirname, 'api.js');
const app = leer(__dirname, 'app.js');
const galeria = leer(__dirname, 'fotosPozos.js');
const controlador = leer(__dirname, 'fotosModeracion.js');
const logica = leer(__dirname, 'fotosModeracionLogic.js');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const codigoControlador = sinComentarios(controlador);
const codigoLogica = sinComentarios(logica);

describe('index.html y controlador', () => {
  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    expect(ids.size).toBeGreaterThan(35);
    const faltan = [...ids].filter((id) => !new RegExp('id="' + id + '"').test(html));
    expect(faltan).toEqual([]);
  });

  test('los modales son dialogos ocultos por defecto, con foco inicial posible y fuera de la pantalla de fotos', () => {
    ['fotos-mod-form-overlay', 'fotos-mod-hist-overlay'].forEach((id) => {
      expect(html).toMatch(new RegExp('<div id="' + id + '" class="fotos-mod-overlay" role="dialog" aria-modal="true" aria-labelledby="[^"]+" hidden>'));
    });
    const pantalla = html.slice(html.indexOf('<div id="screen-fotos"'), html.indexOf('<!-- Observaciones del pozo (E5-4'));
    expect(pantalla).not.toContain('fotos-mod-form-overlay');
    expect(pantalla).not.toContain('fotos-mod-hist-overlay');
  });

  test('formulario: label asociado a select y textarea, errores con role alert, contador, botones reales', () => {
    expect(html).toMatch(/<label for="fotos-mod-motivo" class="fotos-mod-label">Motivo<\/label>/);
    expect(html).toMatch(/<select id="fotos-mod-motivo"[^>]*aria-required="true"[^>]*aria-describedby="fotos-mod-form-error"/);
    expect(html).toMatch(/<label for="fotos-mod-detalle" id="fotos-mod-detalle-label"/);
    expect(html).toMatch(/<textarea id="fotos-mod-detalle"[^>]*aria-describedby="fotos-mod-contador fotos-mod-form-error"/);
    expect(html).toMatch(/<p id="fotos-mod-form-error"[^>]*role="alert"[^>]*tabindex="-1" hidden>/);
    expect(html).toMatch(/<p id="fotos-mod-rep-error"[^>]*role="alert"/);
    expect(html).toMatch(/<button type="button" id="btn-fotos-mod-form-cancelar" class="button-secondary">Cancelar<\/button>/);
    expect(html).toMatch(/<button type="submit" id="btn-fotos-mod-form-enviar" class="button" disabled><\/button>/);
    expect(html).not.toMatch(/id="fotos-mod-detalle"[^>]*maxlength/i);
  });

  test('el copy pedido esta en el HTML: privacidad discreta, confirmacion de reposicion y nota de OCULTAS historicas', () => {
    expect(html).toContain('Quedará marcada para revisión de borrado.');
    expect(html).toContain('¿Querés volver a mostrar esta foto en la galería?');
    expect(html).toContain('Las fotos ocultas históricamente no pueden reponerse desde este flujo.');
    expect(html).toContain('Retiradas en esta sesión');
    expect(html).toMatch(/id="btn-fotos-mod-sugerir"[^>]*>Sugerir retiro</);
    expect(html).toMatch(/id="btn-fotos-mod-retirar"[^>]*>Retirar foto</);
    expect(html).toMatch(/id="btn-fotos-mod-historial"[^>]*>Ver historial</);
    expect(html).toMatch(/id="btn-fotos-mod-hist-reponer"[^>]*>Reponer foto</);
  });

  test('las acciones del visor y los avisos estan ocultos por defecto (no se muestra nada que el usuario no pueda ejecutar)', () => {
    ['fotos-mod-visor-acciones', 'btn-fotos-mod-sugerir', 'btn-fotos-mod-retirar', 'btn-fotos-mod-historial', 'fotos-mod-visor-estado', 'fotos-mod-aviso', 'fotos-mod-retiradas', 'btn-fotos-mod-hist-reponer', 'fotos-mod-rep-confirmar']
      .forEach((id) => { expect(html).toMatch(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*\\shidden')); });
  });

  test('los mensajes de estado son anunciables (role status)', () => {
    expect(html).toMatch(/id="fotos-mod-aviso"[^>]*role="status"/);
    expect(html).toMatch(/id="fotos-mod-visor-estado"[^>]*role="status"/);
  });

  test('sin handlers inline, sin estilos en linea y sin data-* en el markup nuevo', () => {
    const bloques = [
      html.slice(html.indexOf('<!-- Moderacion de fotos (E8-4). Tres modales'), html.indexOf('<!-- Confirmacion antes de guardar')),
      html.slice(html.indexOf('<!-- Moderacion de fotos (E8-4). Controlador'), html.indexOf('<!-- Moderacion de fotos (E8-4). Controlador') + 1400),
      html.slice(html.indexOf('<!-- Moderacion (E8-4, solo'), html.indexOf('<section id="fotos-galeria"'))
    ];
    bloques.forEach((b) => {
      expect(b.length).toBeGreaterThan(300);
      expect(b).not.toMatch(/\son[a-z]+=|style=|data-(?!cargando)/i);
    });
  });

  test('scripts en orden: logica de moderacion despues de las logicas de las que depende y antes de app.js', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('fotosModeracionLogic.js')).toBeGreaterThan(pos('reemplazoLogic.js'));
    expect(pos('fotosModeracionLogic.js')).toBeGreaterThan(pos('observacionesPozoLogic.js'));
    expect(pos('fotosModeracionLogic.js')).toBeGreaterThan(pos('fotosPozosLogic.js'));
    expect(pos('fotosModeracion.js')).toBeGreaterThan(pos('fotosModeracionLogic.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('fotosModeracion.js'));
    expect(pos('fotosModeracionLogic.js')).toBeGreaterThan(0);
  });

  test('el service worker precachea los dos archivos nuevos (como cualquier script del shell)', () => {
    const { SHELL_FILES } = require('../sw.js');
    expect(SHELL_FILES).toContain('./js/fotosModeracionLogic.js');
    expect(SHELL_FILES).toContain('./js/fotosModeracion.js');
    expect(SHELL_FILES.indexOf('./js/fotosModeracion.js')).toBeLessThan(SHELL_FILES.indexOf('./js/app.js'));
    expect(sw).not.toMatch(/getFotoPozoModeracion|getHistorialFotoPozo/);      // el SW no cachea API ni imagenes
  });
});

describe('wrappers de api.js (contrato del backend)', () => {
  const wrappers = [
    ['solicitarRetiroFotoPozo', 'sessionToken: sessionToken, fotoId: fotoId, motivoCodigo: motivoCodigo, motivoTexto: motivoTexto, clientRequestId: clientRequestId'],
    ['retirarFotoPozo', 'sessionToken: sessionToken, fotoId: fotoId, motivoCodigo: motivoCodigo, motivoTexto: motivoTexto, clientRequestId: clientRequestId'],
    ['resolverRetiroFotoPozo', 'sessionToken: sessionToken, solicitudId: solicitudId, resolucion: resolucion, clientRequestId: clientRequestId'],
    ['reponerFotoPozo', 'sessionToken: sessionToken, fotoId: fotoId, clientRequestId: clientRequestId'],
    ['getHistorialFotoPozo', 'sessionToken: sessionToken, fotoId: fotoId'],
    ['getFotosPozosPendientesModeracion', 'sessionToken: sessionToken, limit: limit, cursor: cursor'],
    ['getFotoPozoModeracion', 'sessionToken: sessionToken, fotoId: fotoId, variante: variante']
  ];
  test.each(wrappers)('%s manda solo lo que es del cliente', (accion, campos) => {
    expect(api).toContain("callBackend('" + accion + "', { " + campos + " })");
  });

  test('el cliente nunca manda email, nombre, entidad, estado, secuencia ni timestamp', () => {
    const bloque = api.slice(api.indexOf('// --- Moderacion de fotos de pozos (E8)'));
    expect(bloque).not.toMatch(/\bemail:|\bnombre:|\bwellId:|\bmonitoringId:|\bestado:|\bsecuencia:|\btimestamp\w*:|\bentidad\w*:/);
  });

  test('resolver y la cola global tienen wrapper pero E8-4 no los usa', () => {
    expect(api).toContain('function apiResolverRetiroFotoPozo(');
    expect(api).toContain('function apiGetFotosPozosPendientesModeracion(');
    const archivos = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'api.js');
    archivos.forEach((f) => {
      expect(sinComentarios(leer(__dirname, f))).not.toMatch(/apiResolverRetiroFotoPozo\(|apiGetFotosPozosPendientesModeracion\(/);
    });
  });
});

describe('quien toca los endpoints de moderacion', () => {
  const archivos = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  const usan = (re) => archivos.filter((f) => re.test(sinComentarios(leer(__dirname, f)))).sort();

  test('solo api.js (define) y el controlador de moderacion (usa) tocan los wrappers de moderacion', () => {
    expect(usan(/\b(apiSolicitarRetiroFotoPozo|apiRetirarFotoPozo|apiReponerFotoPozo|apiGetHistorialFotoPozo|apiGetFotoPozoModeracion)\(/)).toEqual(['api.js', 'fotosModeracion.js']);
  });

  test('la imagen de una foto retirada solo se pide con el endpoint de moderacion; el visor normal sigue con getFotoPozo', () => {
    expect(sinComentarios(galeria)).not.toMatch(/apiGetFotoPozoModeracion|getFotoPozoModeracion/);
    expect(sinComentarios(galeria)).toMatch(/apiGetFotoPozo\(ctx\.sessionToken, foto\.fotoId, 'full'\)/);
    expect(codigoControlador).not.toMatch(/apiGetFotoPozo\(/);
    expect(codigoLogica).not.toMatch(/fetch\(|XMLHttpRequest|callBackend|api[A-Z]\w+\(/);
  });

  test('ningun archivo del frontend escribe las acciones de moderacion por su cuenta (solo api.js)', () => {
    const acciones = ['solicitarRetiroFotoPozo', 'retirarFotoPozo', 'resolverRetiroFotoPozo', 'reponerFotoPozo', 'getHistorialFotoPozo', 'getFotosPozosPendientesModeracion', 'getFotoPozoModeracion'];
    expect(archivos.filter((f) => acciones.some((a) => sinComentarios(leer(__dirname, f)).indexOf("'" + a + "'") >= 0))).toEqual(['api.js']);
  });
});

describe('integracion con la galeria y app.js', () => {
  test('fotosPozos.js avisa a la moderacion al abrir, mostrar una foto, cerrar el visor y salir de la pantalla (siempre protegido con typeof)', () => {
    expect(galeria).toMatch(/typeof fotosModeracionController_alAbrir === 'function'/);
    expect(galeria).toMatch(/typeof fotosModeracionController_alMostrarFoto === 'function'/);
    expect(galeria).toMatch(/typeof fotosModeracionController_cerrar === 'function'/);
    expect(galeria).toMatch(/typeof fotosModeracionController_etiquetaItem === 'function'/);
    expect(galeria).toMatch(/fotosModeracionController_alMostrarFoto\(null\)/);
  });

  test('Escape y las flechas del visor no actuan debajo de un modal de moderacion', () => {
    const i = galeria.indexOf("document.addEventListener('keydown'");
    const bloque = galeria.slice(i, i + 700);
    expect(bloque).toMatch(/fotosModeracionController_hayModalAbierto\(\)\) \{ return; \}/);
    expect(bloque.indexOf('hayModalAbierto')).toBeLessThan(bloque.indexOf("e.key === 'Escape'"));
  });

  test('refrescar vuelve a pedir getFotosPozo al backend, fuerza el contador y, si falla, NO deja la galeria vieja a la vista', () => {
    const i = galeria.indexOf('function fotosPozosController_refrescar');
    const bloque = galeria.slice(i, galeria.indexOf('function fotosPozosController_repintar'));
    expect(bloque).toMatch(/apiGetFotosPozo\(/);
    expect(bloque).toMatch(/fotosPozosResumenController_cargar\(true\)/);
    expect(bloque).toMatch(/if \(aperturaId !== estado\.aperturaId\) \{ return false; \}\s*if \(r\.status !== 'ok'\)/);
    expect(bloque.match(/mostrarError\(/g).length).toBe(2);
    expect(bloque).toMatch(/estado\.fotos = r\.data\.fotos \|\| \[\]/);
    expect(bloque).not.toMatch(/estado\.fotos = estado\.fotos\.filter|splice/);
    expect(galeria).toMatch(/window\.fotosPozosController_refrescar = fotosPozosController_refrescar/);
    expect(galeria).toMatch(/window\.fotosPozosController_cerrarVisor = cerrarVisor/);
    expect(galeria).toMatch(/window\.fotosPozosController_repintar = fotosPozosController_repintar/);
  });

  test('app.js inicializa la moderacion con contexto fresco (sesion + permisos de hoy), los ganchos de la galeria y el logout global', () => {
    expect(app).toMatch(/fotosModeracionController_inicializar\(function \(\) \{[\s\S]{0,260}permisos: permisosActuales[\s\S]{0,120}logout\(\)[\s\S]{0,200}refrescar: fotosPozosController_refrescar,\s*cerrarVisor: fotosPozosController_cerrarVisor,\s*repintar: fotosPozosController_repintar/);
  });

  test('cerrar sesion descarta la moderacion junto con la galeria', () => {
    expect(app).toMatch(/fotosPozosController_reset\(\);[\s\S]{0,260}fotosModeracionController_reset\(\);/);
  });

  test('app.js no decide permisos de moderacion ni llama sus endpoints', () => {
    expect(sinComentarios(app)).not.toMatch(/fotos_moderar|apiRetirar|apiSolicitar|apiReponer|apiGetHistorial/);
  });
});

describe('privacidad y red', () => {
  test('ni el controlador ni la logica usan innerHTML, loguean o guardan nada en el navegador', () => {
    [codigoControlador, codigoLogica].forEach((src) => {
      expect(src).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
      expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
      expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB|caches\./);
    });
  });

  test('no maneja ids de Drive ni URLs de storage', () => {
    [codigoControlador, codigoLogica].forEach((src) => {
      expect(src).not.toMatch(/driveFileId|driveThumbId|FOTOS_STORAGE|drive\.google|googleusercontent/i);
    });
  });

  test('el controlador pinta con textContent / .value y la imagen solo desde data: URL', () => {
    expect(codigoControlador).toMatch(/'data:' \+ r\.data\.mimeType \+ ';base64,' \+ r\.data\.imagenBase64/);
    expect(codigoControlador).not.toMatch(/\.src = (?!url)/);
  });

  test('no se muestra jamas el message crudo del backend', () => {
    expect(codigoControlador).not.toMatch(/\.message\b/);
    expect(codigoLogica).not.toMatch(/resp\.message|\.message\b/);
  });

  test('la logica no conoce el email de nadie: ni lo lee ni lo muestra', () => {
    expect(codigoLogica).not.toMatch(/\.email\b|\.clientRequestId\b|\.secuencia\b/);
    expect(codigoControlador).not.toMatch(/\.email\b|secuencia/);
  });
});

describe('CSS propio y responsive', () => {
  const marca = '/* --- Moderacion de fotos de pozos (E8-4).';
  const inicio = css.indexOf(marca);
  const bloque = css.slice(inicio, css.indexOf('/* --- Modal "Corregir ubicacion"'));
  const regla = (sel) => {
    // todas las reglas cuyo selector sea exactamente `sel` (solo o dentro de una lista separada por comas), unidas
    const escapado = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(?:^|\\n)(?:[^\\n{};]*,\\n)?' + escapado + '(?:,\\n[^\\n{};]*)* \\{([^}]*)\\}', 'g');
    return Array.from(bloque.matchAll(re)).map((m) => m[1]).join('\n');
  };

  test('el bloque existe y TODOS sus selectores son .fotos-mod-* o body.fotos-mod-abierto', () => {
    expect(inicio).toBeGreaterThan(0);
    const selectores = Array.from(bloque.matchAll(/(^|\n)\s*([^\n{};@/]+?)\s*\{/g)).map((m) => m[2].trim()).filter((x) => x !== '' && !/^(from|to)$/.test(x));
    expect(selectores.length).toBeGreaterThan(40);
    selectores.forEach((sel) => expect(sel).toMatch(/^(\.fotos-mod-|body\.fotos-mod-abierto)/));
  });

  test('no toca otros modulos: ningun selector generico ni de otro prefijo', () => {
    expect(bloque).not.toMatch(/(^|\n)\s*(\.obs-|\.reemplazo-|\.fotos-(?!mod-)|\.hub-|\.lt-|#screen-|body\s*\{|button\s*\{|\.button\b|\.error-message)/);
  });

  test('modal: hoja inferior en celular con scroll interno, centrado en pantallas grandes, por ENCIMA del visor; el fondo no se desplaza', () => {
    expect(regla('.fotos-mod-overlay')).toMatch(/position:\s*fixed/);
    expect(parseInt(/z-index:\s*(\d+)/.exec(regla('.fotos-mod-overlay'))[1], 10)).toBeGreaterThan(80);
    expect(regla('.fotos-mod-panel')).toMatch(/max-height:\s*94dvh/);
    expect(regla('.fotos-mod-panel')).toMatch(/overflow-y:\s*auto/);
    expect(regla('.fotos-mod-panel')).toMatch(/width:\s*100%/);
    expect(bloque).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.fotos-mod-overlay\s*\{\s*align-items:\s*center/);
    expect(regla('body.fotos-mod-abierto')).toMatch(/overflow:\s*hidden/);
  });

  test('sin scroll horizontal: textos que se parten, botones que envuelven, controles al ancho completo', () => {
    ['.fotos-mod-hist-evento-texto', '.fotos-mod-hist-evento-meta', '.fotos-mod-error', '.fotos-mod-texto', '.fotos-mod-aviso', '.fotos-mod-retirada-cuerpo p'].forEach((s) => {
      expect(regla(s)).toMatch(/overflow-wrap:\s*anywhere/);
    });
    expect(regla('.fotos-mod-hist-evento-texto')).toMatch(/white-space:\s*pre-wrap/);
    expect(regla('.fotos-mod-botones')).toMatch(/flex-wrap:\s*wrap/);
    expect(regla('.fotos-mod-texto') + regla('.fotos-mod-select')).toMatch(/width:\s*100%/);
    expect(regla('.fotos-mod-acciones')).toMatch(/flex-wrap:\s*wrap/);
    expect(regla('.fotos-mod-retirada-cuerpo')).toMatch(/min-width:\s*0/);
    expect(regla('.fotos-mod-hist-datos')).toMatch(/min-width:\s*0/);
    expect(bloque.replace(/@media \(min-width: 640px\)/g, '')).not.toMatch(/white-space:\s*nowrap|min-width:\s*\d+px/);
  });

  test('objetivos tactiles de 44 px y foco visible; deshabilitado se ve apagado', () => {
    expect(regla('.fotos-mod-boton')).toMatch(/min-height:\s*44px/);
    expect(regla('.fotos-mod-cerrar')).toMatch(/width:\s*44px/);
    expect(regla('.fotos-mod-select')).toMatch(/min-height:\s*44px/);
    expect(bloque).toMatch(/\.fotos-mod-boton:focus-visible/);
    expect(bloque).toMatch(/\.fotos-mod-botones \.button:disabled/);
    expect(regla('.fotos-mod-contador-excede')).toMatch(/font-weight:\s*700/);
  });

  test('la animacion respeta prefers-reduced-motion', () => {
    expect(bloque).toMatch(/@media \(prefers-reduced-motion: no-preference\)\s*\{\s*\.fotos-mod-panel\s*\{\s*animation:/);
  });
});
