// E9-6: guardas del CABLEADO de los ITF colaborativos en el navegador (todo local, NO productivo): markup accesible y sin handlers inline, ids del controlador, orden de scripts + service worker, wrappers de api.js
// (lista blanca, sin email, sin keepalive), app.js (tarjeta del hub con permiso exacto, availability en vez de getProfile al buscar, getProfile solo al abrir Perfil, reset al cerrar sesion) y CSS (clases usadas,
// foco visible, responsive). Las DECISIONES del hub (cuando ofrecer Perfil, como leer la disponibilidad) se ejecutan de verdad extrayendo esas funciones de app.js.
const fs = require('fs');
const path = require('path');
const L = require('./itfLogic');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8').replace(/\r\n/g, '\n');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const sw = leer(raiz, 'sw.js');
const api = leer(__dirname, 'api.js');
const app = leer(__dirname, 'app.js');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const codigoApp = sinComentarios(app);
const FUENTES = ['itfLogic.js', 'itfFlujosLogic.js', 'itfImagen.js', 'itfPerfil.js', 'itfModeracion.js'];

// el markup nuevo de E9-6: la pantalla Perfil, la pantalla ITF pendientes y los dialogos
const perfil = html.slice(html.indexOf('<div id="screen-perfil"'), html.indexOf('<div id="screen-datos"'));
const moderacion = html.slice(html.indexOf('<!-- ITF pendientes (E9-6, solo perfil + perfil_validar)'), html.indexOf('<!-- Correcciones de ubicacion (ficha del pozo)'));
const hubTarjetas = html.slice(html.indexOf('<!-- ITF pendientes (E9-6): visible solo'), html.indexOf('<!-- Hub modular: cabecera compacta'));
const markupNuevo = perfil + moderacion + hubTarjetas;

describe('markup', () => {
  test('todos los ids que usan los controladores existen en el HTML, una sola vez', () => {
    ['itfPerfil.js', 'itfModeracion.js'].forEach((f) => {
      const ids = new Set();
      leer(__dirname, f).replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
      expect(ids.size).toBeGreaterThan(30);
      expect([...ids].filter((id) => html.split('id="' + id + '"').length - 1 !== 1)).toEqual([]);
    });
  });

  test('ningun id repetido en el markup nuevo', () => {
    const ids = Array.from(markupNuevo.matchAll(/\sid="([^"]+)"/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(80);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('sin handlers inline ni estilos en linea ni data-* (salvo data-cargando y los dos de la comparacion, que el CSS usa)', () => {
    const permitido = markupNuevo.replace(/data-cargando|data-comparando="false"|data-vista="PROPUESTA"/g, '');
    expect(permitido).not.toMatch(/\son[a-z]+=|style=|data-/i);
  });

  test('Perfil: el boton de proponer no dice "definitivo"; el input es de imagenes JPEG / PNG; los bloques colaborativos arrancan OCULTOS', () => {
    expect(perfil).not.toMatch(/definitivo/i);
    expect(perfil).toMatch(/<input type="file" id="itf-archivo-input" accept="image\/jpeg,image\/png" hidden>/);
    ['itf-colab', 'itf-proponer-bloque', 'itf-mis-bloque', 'itf-validador-bloque', 'itf-proponer-panel', 'itf-mis-panel', 'btn-itf-retirar-vigente', 'perfil-vigente', 'perfil-aviso', 'perfil-cargando'].forEach((id) => {
      expect(perfil).toMatch(new RegExp('<[a-z]+[^>]*\\sid="' + id + '"[^>]*\\shidden'));
    });
    expect(perfil).toContain('Proponer ITF');
    expect(perfil).toContain('Mis propuestas');
    expect(perfil).toContain('Historial de ITF');
  });

  test('estados anunciables: cargando / avisos / mensajes con role; errores con role=alert', () => {
    ['perfil-cargando', 'perfil-aviso-texto', 'itf-prop-preparando', 'itf-mis-cargando'].forEach((id) => expect(perfil).toMatch(new RegExp('id="' + id + '"[^>]*role="status"')));
    ['itf-prop-mensaje'].forEach((id) => expect(perfil).toMatch(new RegExp('id="' + id + '"[^>]*role="status"')));
    ['itf-mis-error-texto', 'itf-mis-mas-error'].forEach((id) => expect(perfil).toMatch(new RegExp('id="' + id + '"[^>]*role="alert"')));
    ['itf-cola-error-texto', 'itf-cola-mas-error', 'itf-vis-error-texto', 'itf-accion-error', 'itf-hist-error-texto', 'itf-retiro-error'].forEach((id) => expect(moderacion).toMatch(new RegExp('id="' + id + '"[^>]*role="alert"')));
    ['itf-cola-aviso', 'itf-vis-aviso', 'itf-hist-aviso'].forEach((id) => expect(moderacion).toMatch(new RegExp('id="' + id + '"[^>]*role="status"[^>]*tabindex="-1"')));
  });

  test('los 4 dialogos son role=dialog, aria-modal, con titulo (aria-labelledby) y ocultos', () => {
    ['itf-vis-overlay', 'itf-accion-overlay', 'itf-hist-overlay', 'itf-retiro-overlay'].forEach((id) => {
      expect(moderacion).toMatch(new RegExp('<div id="' + id + '"[^>]*role="dialog" aria-modal="true" aria-labelledby="[^"]+"[^>]*hidden>'));
    });
    ['itf-vis-titulo', 'itf-accion-titulo', 'itf-hist-titulo', 'itf-retiro-titulo'].forEach((id) => expect(moderacion).toContain('id="' + id + '"'));
  });

  test('todo boton es type=button (ninguno envia formularios) y los de icono tienen aria-label', () => {
    const botones = Array.from(markupNuevo.matchAll(/<button\b[^>]*>/g)).map((m) => m[0]);
    expect(botones.length).toBeGreaterThan(30);
    botones.forEach((b) => expect(b).toMatch(/type="button"/));
    ['btn-itf-vis-cerrar', 'btn-itf-accion-cerrar', 'btn-itf-hist-cerrar', 'btn-itf-retiro-cerrar', 'btn-itf-vis-alejar', 'btn-itf-vis-acercar'].forEach((id) => expect(markupNuevo).toMatch(new RegExp('id="' + id + '"[^>]*aria-label="')));
  });

  test('campos del dialogo de accion: <label for> asociado a un select y a un textarea con maximo de 300', () => {
    expect(moderacion).toMatch(/<label for="itf-accion-motivo"/);
    expect(moderacion).toMatch(/<select id="itf-accion-motivo"/);
    expect(moderacion).toMatch(/<label for="itf-accion-texto"/);
    expect(moderacion).toMatch(/<textarea id="itf-accion-texto"[^>]*maxlength="300"/);
  });

  test('grupos de botones con nombre accesible y estado (aria-pressed) en alcance y vistas; la lista de la cola es <ul>, la linea de tiempo <ol>', () => {
    expect(perfil).toMatch(/role="group" aria-label="Qué propuestas ver"/);
    expect(moderacion).toMatch(/id="itf-vis-vistas"[^>]*role="group" aria-label=/);
    expect(moderacion).toMatch(/<ul id="itf-cola-lista"/);
    expect(moderacion).toMatch(/<ol id="itf-hist-lineas"/);
    expect(moderacion).toMatch(/<img id="itf-vis-img-prop"[^>]*alt="/);
  });

  test('la tarjeta del hub "ITF pendientes" arranca oculta y no carga nada (no hay badge ni contador)', () => {
    expect(hubTarjetas).toMatch(/id="btn-abrir-itf-moderacion"[^>]*hidden>/);
    expect(hubTarjetas).toContain('ITF pendientes');
    expect(hubTarjetas).not.toMatch(/badge|contador|<span[^>]*id=/i);
    expect(hubTarjetas).toMatch(/id="btn-itf-volver-moderacion"[^>]*hidden>/);
  });
});

describe('scripts, service worker y api.js', () => {
  test('orden de scripts: la logica, los flujos y la imagen ANTES de los controladores, y todos antes de app.js; despues de api.js', () => {
    const orden = Array.from(html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)).map((m) => m[1]);
    FUENTES.forEach((f) => expect(orden).toContain(f));
    const pos = (f) => orden.indexOf(f);
    expect(pos('api.js')).toBeLessThan(pos('itfLogic.js'));
    expect(pos('itfLogic.js')).toBeLessThan(pos('itfFlujosLogic.js'));
    expect(pos('itfFlujosLogic.js')).toBeLessThan(pos('itfImagen.js'));
    expect(pos('itfImagen.js')).toBeLessThan(pos('itfPerfil.js'));
    expect(pos('itfPerfil.js')).toBeLessThan(pos('itfModeracion.js'));
    expect(pos('itfModeracion.js')).toBeLessThan(pos('app.js'));
  });

  test('el service worker precachea los 5 archivos nuevos y sigue siendo network-first (sin version manual)', () => {
    FUENTES.forEach((f) => expect(sw).toContain("'./js/" + f + "'"));
    expect(sw).toMatch(/networkFirstThenCache/);
    expect(sw).toMatch(/var CACHE_NAME = 'dgi-pozos-shell';/);
    const lista = require('../sw.js').SHELL_FILES;
    FUENTES.forEach((f) => expect(lista).toContain('./js/' + f));
  });

  test('los wrappers de api.js copian SOLO su lista blanca y ninguno manda email, actor, nombre ni keepalive', () => {
    const wrappers = ['apiProponerItf', 'apiGetMisPropuestasItf', 'apiRetirarPropuestaItf', 'apiGetItfPendientes', 'apiGetItfDocumentoModeracion', 'apiGetHistorialItf', 'apiAprobarItf', 'apiRechazarItf', 'apiRetirarItf', 'apiRevertirItf'];
    wrappers.forEach((w) => expect(api).toMatch(new RegExp('function ' + w + '\\(')));
    const bloque = sinComentarios(api.slice(api.indexOf('// --- ITF colaborativos (E9-6'), api.indexOf('// --- Modulo Evaluacion / Reemplazo (v1) ---')));
    expect(bloque).not.toMatch(/email|actor|nombre:|keepalive|emailPropietario/i);
    expect(bloque).toContain("callBackend('proponerItf'");
    expect(bloque).toContain("callBackend('getMisPropuestasItf'");
    expect(bloque).toContain("callBackend('aprobarItf'");
    expect(bloque).toContain("callBackend('revertirItf'");
  });

  test('las listas blancas de api.js son un SUBCONJUNTO de las del backend (jamas un campo de mas: el servidor rechazaria el pedido) y llevan los obligatorios', () => {
    const Api = require('../backend/src/Api');
    const campos = (accion) => Api.ITF_MOD_ENDPOINTS[accion].campos.filter((c) => c !== 'action' && c !== 'sessionToken').sort();
    const pares = { apiAprobarItf: 'aprobarItf', apiRechazarItf: 'rechazarItf', apiRetirarItf: 'retirarItf', apiRevertirItf: 'revertirItf', apiRetirarPropuestaItf: 'retirarPropuestaItf', apiGetItfPendientes: 'getItfPendientes', apiGetMisPropuestasItf: 'getMisPropuestasItf' };
    Object.keys(pares).forEach((w) => {
      const m = new RegExp('function ' + w + '\\([^)]*\\) \\{\\n  return callBackend\\(\'' + pares[w] + '\',[^\\n]*\\[([^\\]]*)\\]').exec(api);
      expect(m).not.toBeNull();
      const enviados = m[1].split(',').map((c) => c.trim().replace(/'/g, '')).filter(Boolean).sort();
      expect({ w: w, sobran: enviados.filter((c) => campos(pares[w]).indexOf(c) < 0) }).toEqual({ w: w, sobran: [] });
      expect(enviados).toEqual(expect.arrayContaining(campos(pares[w]).filter((c) => c !== 'motivoTexto' && c !== 'wellId' && c !== 'limite' && c !== 'cursor')));
    });
  });

  test('itfApi_campos: copia solo lo permitido y descarta el resto (incluido un email colado)', () => {
    const ctx = {};
    new Function('ctx', api.replace(/var APPS_SCRIPT_URL[^\n]*\n/, '') + '\nctx.itfApi_campos = itfApi_campos;')(ctx);
    expect(ctx.itfApi_campos({ documentoId: 'd', clientRequestId: 'c', email: 'x@y.com', actor: 'a', motivoCodigo: undefined }, ['documentoId', 'clientRequestId', 'motivoCodigo'])).toEqual({ documentoId: 'd', clientRequestId: 'c' });
  });
});

describe('app.js: el hub', () => {
  test('la tarjeta "ITF pendientes" se muestra SOLO con la funcion de permiso exacto (perfil y perfil_validar === true), y el atajo de vuelta tambien', () => {
    expect(codigoApp).toMatch(/document\.getElementById\('btn-abrir-itf-moderacion'\)\.hidden = !itfLogic_puedeValidar\(permisosActuales\);/);
    expect(codigoApp).toMatch(/document\.getElementById\('btn-itf-volver-moderacion'\)\.hidden = !\(itfRetornoModeracion && itfLogic_puedeValidar\(permisosActuales\)\);/);
    expect(codigoApp).toMatch(/if \(!itfLogic_puedeValidar\(permisosActuales\)\) \{\n\s+toggleAccesosUbicacion\(\);/);
  });

  test('los permisos por defecto (inicio y cierre de sesion) incluyen perfil_subir y perfil_validar en false', () => {
    const defectos = codigoApp.match(/permisosActuales = \{ perfil: false, perfil_subir: false, perfil_validar: false,/g) || [];
    expect(defectos).toHaveLength(2);
  });

  test('Q2: buscar un pozo consulta la DISPONIBILIDAD de ese pozo (una llamada liviana) y NO baja la imagen; getProfile se pide solo al abrir Perfil (en itfPerfil.js)', () => {
    const buscar = codigoApp.slice(codigoApp.indexOf('function buscarPozo(wellId)'), codigoApp.indexOf("form.addEventListener('submit'"));
    expect(buscar).toMatch(/apiGetItfAvailability\(sessionToken, \[wellId\]\)/);
    expect(buscar).not.toMatch(/apiGetProfile/);
    expect(codigoApp).not.toMatch(/apiGetProfile/);
    expect(leer(__dirname, 'itfPerfil.js')).toMatch(/apiGetProfile\(sessionToken, wellId\)/);
    expect(codigoApp).toMatch(/id === 'perfil'\) \{\n\s+itfPerfilController_abrir\(pozoActual\.wellId\);/);
  });

  test('la busqueda registra perfil=SI solo cuando hay ITF vigente afirmado', () => {
    expect(codigoApp).toMatch(/perfil: itf\.estado === 'SI',/);
  });

  test('cerrar sesion reinicia el Perfil y la moderacion (imagenes, listas, dialogos y lo que este en vuelo)', () => {
    const logout = codigoApp.slice(codigoApp.indexOf('function logout()'), codigoApp.indexOf("document.getElementById('btn-logout').addEventListener"));
    expect(logout).toContain('itfPerfilController_reset();');
    expect(logout).toContain('itfModeracionController_reset();');
    expect(logout).toContain('itfRetornoModeracion = false;');
  });

  test('los controladores reciben un contexto FRESCO (permisos de hoy) y una sesion vencida usa el logout de siempre', () => {
    ['itfPerfilController_inicializar', 'itfModeracionController_inicializar'].forEach((f) => {
      const i = codigoApp.indexOf(f + '(function () {');
      expect(i).toBeGreaterThan(0);
      const bloque = codigoApp.slice(i, i + 400);
      expect(bloque).toMatch(/sessionToken: sessionToken,\n\s+permisos: permisosActuales,/);
      expect(bloque).toMatch(/onSessionExpired: function \(\) \{\n\s+logout\(\);/);
    });
  });

  test('"Ver pozo" lleva al hub, busca ese pozo y deja el atajo de vuelta; volver a la cola conserva lo cargado (_volver) y no la reabre', () => {
    expect(codigoApp).toMatch(/onVerPozo: function \(wellId\) \{\n\s+itfRetornoModeracion = true;[\s\S]*?buscarPozo\(wellId\);/);
    expect(codigoApp).toMatch(/itfModeracionController_volver\(\);/);
  });

  test('un cambio de vigente actualiza el hub (availability de ESE pozo) y descarta el cache de la seleccion', () => {
    expect(codigoApp).toMatch(/onCambioDeVigente: refrescarItfDelHub/);
    const f = codigoApp.slice(codigoApp.indexOf('function refrescarItfDelHub(wellId)'), codigoApp.indexOf('function renderHubResultado(pozo)'));
    expect(f).toContain('seleccionController_invalidarDisponibilidadItf');
    expect(f).toContain('apiGetItfAvailability(sessionToken, [wellId])');
  });

  // Las decisiones del hub, ejecutadas de verdad
  function funcion(nombre) {
    const i = app.indexOf('  function ' + nombre + '(');
    let fin = app.indexOf('\n  }\n', i);
    return app.slice(i, fin + 5);
  }
  function armarHub(permisos) {
    const fuente = funcion('itfTarjetaVisible') + funcion('descPerfilHub') + funcion('interpretarDisponibilidadItf') + '\nreturn { itfTarjetaVisible, descPerfilHub, interpretarDisponibilidadItf };';
    return new Function('permisosActuales', 'itfLogic_puedeProponer', 'itfLogic_puedeValidar', fuente)(permisos, L.itfLogic_puedeProponer, L.itfLogic_puedeValidar);
  }
  const pozo = (estado, otros) => ({ wellId: '14-0001', itf: { estado: estado }, registro: { found: !!otros }, ubicacion: { found: false }, ne: { found: false } });

  test('la disponibilidad de UN pozo: true -> SI, false -> NO; el pozo OMITIDO o un error -> DESCONOCIDO (nunca "no existe"); PERMISSION_DENIED -> SIN_PERMISO', () => {
    const h = armarHub({ perfil: true });
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: { '14-0001': true } })).toEqual({ found: true, estado: 'SI' });
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: { '14-0001': false } })).toEqual({ found: false, estado: 'NO' });
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: {} })).toEqual({ found: false, estado: 'DESCONOCIDO' });
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: { '14-0001': 'true' } }).estado).toBe('DESCONOCIDO');
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: { '14-0001': null } }).estado).toBe('DESCONOCIDO');
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok', data: { '14-0002': true } }).estado).toBe('DESCONOCIDO');
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'ok' }).estado).toBe('DESCONOCIDO');
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'error', code: 'SERVICE_UNAVAILABLE' })).toMatchObject({ found: false, estado: 'DESCONOCIDO' });
    expect(h.interpretarDisponibilidadItf('14-0001', { status: 'error', code: 'PERMISSION_DENIED' })).toMatchObject({ found: false, estado: 'SIN_PERMISO' });
  });

  test('tarjeta Perfil: con ITF o con estado desconocido SIEMPRE (no se afirma que no existe); sin ITF solo para quien puede proponer / validar y si el pozo existe en otro modulo', () => {
    const solo = armarHub({ perfil: true });
    expect(solo.itfTarjetaVisible(pozo('SI', false))).toBe(true);
    expect(solo.itfTarjetaVisible(pozo('DESCONOCIDO', false))).toBe(true);
    expect(solo.itfTarjetaVisible(pozo('NO', true))).toBe(false);                 // perfil solo: sin ITF -> sin tarjeta (como hoy)
    expect(solo.itfTarjetaVisible(pozo('SIN_PERMISO', true))).toBe(false);
    expect(solo.itfTarjetaVisible({ wellId: 'x', itf: { found: false }, registro: {}, ubicacion: {}, ne: {} })).toBe(false);
    const sube = armarHub({ perfil: true, perfil_subir: true });
    expect(sube.itfTarjetaVisible(pozo('NO', true))).toBe(true);                  // para poder proponer el primer ITF
    expect(sube.itfTarjetaVisible(pozo('NO', false))).toBe(false);                // un pozo que no existe en ningun modulo: nada
    const valida = armarHub({ perfil: true, perfil_validar: true });
    expect(valida.itfTarjetaVisible(pozo('NO', true))).toBe(true);
    const truthy = armarHub({ perfil: true, perfil_subir: 'SI', perfil_validar: 1 });
    expect(truthy.itfTarjetaVisible(pozo('NO', true))).toBe(false);
  });

  test('descripcion de la tarjeta: "Ver imagen ITF" (como hoy), o "Sin ITF vigente" (+ "· proponer" solo a quien puede proponer)', () => {
    expect(armarHub({ perfil: true }).descPerfilHub(pozo('SI'))).toBe('Ver imagen ITF');
    expect(armarHub({ perfil: true }).descPerfilHub(pozo('DESCONOCIDO'))).toBe('Ver imagen ITF');
    expect(armarHub({ perfil: true, perfil_subir: true }).descPerfilHub(pozo('NO', true))).toBe('Sin ITF vigente · proponer');
    expect(armarHub({ perfil: true, perfil_validar: true }).descPerfilHub(pozo('NO', true))).toBe('Sin ITF vigente');
  });
});

describe('controladores: sin innerHTML con datos', () => {
  test.each(FUENTES)('%s no usa innerHTML / insertAdjacentHTML / document.write / eval / outerHTML', (f) => {
    expect(sinComentarios(leer(__dirname, f))).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|\beval\(|outerHTML|new Function/);
  });

  test('ningun archivo nuevo menciona emails, storage ni hashes (el cliente jamas los ve)', () => {
    FUENTES.forEach((f) => expect(sinComentarios(leer(__dirname, f))).not.toMatch(/storageFileId|sha256|driveFileId|\.email\b|emailPropietario/));
  });
});

describe('CSS', () => {
  const clasesUsadas = new Set();
  ['itfPerfil.js', 'itfModeracion.js', 'itfFlujosLogic.js'].forEach((f) => {
    leer(__dirname, f).replace(/nodo\('[a-z0-9]+', '([a-z0-9 -]+)'/g, (_, c) => { c.split(' ').forEach((x) => clasesUsadas.add(x)); return ''; });
  });
  markupNuevo.replace(/class="([^"]+)"/g, (_, c) => { c.split(' ').forEach((x) => clasesUsadas.add(x)); return ''; });
  const itf = [...clasesUsadas].filter((c) => /^itf-/.test(c) && !/-$/.test(c));       // las que terminan en "-" se arman por concatenacion (itf-chip-<estado>): se verifican aparte

  test('toda clase itf-* que usa el markup o un controlador esta definida en el CSS', () => {
    expect(itf.length).toBeGreaterThan(20);
    expect(itf.filter((c) => !new RegExp('\\.' + c + '(?![\\w-])').test(css) && !new RegExp('\\.itf-chip-').test(c + css.slice(0, 0)))).toEqual([]);
  });

  test('las variantes de chip por estado existen para los 5 estados de propuesta', () => {
    ['propuesto', 'aprobado', 'rechazado', 'retirado', 'reemplazado'].forEach((e) => expect(css).toMatch(new RegExp('\\.itf-chip-' + e + '[,\\s{]')));
  });

  test('foco visible en los controles nuevos; el visor es responsive (lado a lado solo en pantalla ancha; de a una en el celular); el scroll del fondo se bloquea con un dialogo', () => {
    expect(css).toMatch(/\.itf-alcance-btn:focus-visible/);
    expect(css).toMatch(/\.itf-vis-scroll:focus-visible/);
    expect(css).toMatch(/@media \(min-width: 900px\) \{\n\s+\.itf-vis-paneles\[data-comparando="true"\] \{\n\s+display: grid;/);
    expect(css).toMatch(/\.itf-vis-paneles\[data-comparando="true"\]\[data-vista="PROPUESTA"\] #itf-vis-pane-vig \{\n\s+display: none;/);
    expect(css).toMatch(/body\.itf-mod-abierto \{\n\s+overflow: hidden;/);
    expect(css).toMatch(/\.itf-accion-overlay \{\n\s+z-index: 100;/);
  });

  test('sin anchos fijos que desborden en el celular dentro del bloque nuevo; palabras largas se parten', () => {
    const bloque = css.slice(css.indexOf('/* --- ITF colaborativos (E9-6)'), css.indexOf('/* --- Linea de tiempo del pozo (E6-3'));
    expect(bloque.length).toBeGreaterThan(3000);
    expect(bloque).not.toMatch(/(^|[^-])width:\s*\d+px|white-space:\s*nowrap/);
    expect(bloque).toMatch(/overflow-wrap: anywhere/);
  });
});
