// Guardas baratas del cableado de FotosPozos (los controladores DOM no se testean
// con Jest, igual que mapa.js/reemplazoFotos.js): ids existentes en index.html,
// orden de scripts, gating por permisos y privacidad del renderizado.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const controlador = leer(__dirname, 'fotosPozos.js');
const app = leer(__dirname, 'app.js');
const buscar = leer(__dirname, 'buscarReemplazo.js');
const cerca = leer(__dirname, 'cercaMio.js');
const shared = leer(__dirname, 'mapaShared.js');
const mapaProvincia = leer(__dirname, 'mapa.js');
const popup = leer(__dirname, 'fotosPopup.js');
const resumen = leer(__dirname, 'fotosPozosResumen.js');
const imagen = leer(__dirname, 'fotosImagen.js');
const reemplazoFotos = leer(__dirname, 'reemplazoFotos.js');

describe('index.html y controlador de la galeria', () => {
  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    expect(ids.size).toBeGreaterThan(40);
    const faltan = [...ids].filter((id) => !new RegExp('id="' + id + '"').test(html));
    expect(faltan).toEqual([]);
  });

  test('la pantalla existe, oculta por defecto, y app.js la registra', () => {
    expect(html).toMatch(/<div id="screen-fotos" class="screen" hidden>/);
    expect(app).toMatch(/fotos: document\.getElementById\('screen-fotos'\)/);
  });

  test('el visor existe oculto y es un dialogo', () => {
    expect(html).toMatch(/<div id="fotos-visor-overlay" class="reemplazo-visor" role="dialog" aria-modal="true"[^>]*hidden>/);
  });

  test('scripts en orden: imagen antes que reemplazoFotos, logica -> resumen -> controlador, todo antes de app.js', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('fotosImagen.js')).toBeGreaterThan(pos('reemplazoFotosLogic.js'));
    expect(pos('reemplazoFotos.js')).toBeGreaterThan(pos('fotosImagen.js'));
    expect(pos('fotosPozosLogic.js')).toBeGreaterThan(pos('reemplazoFotosLogic.js'));
    expect(pos('fotosPozosResumen.js')).toBeGreaterThan(pos('fotosPozosLogic.js'));
    expect(pos('fotosPozos.js')).toBeGreaterThan(pos('fotosPozosResumen.js'));
    expect(pos('fotosPozos.js')).toBeGreaterThan(pos('fotosImagen.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('fotosPozos.js'));
  });

  test('los inputs de carga: camara con capture y galeria multiple, ambos ocultos', () => {
    expect(html).toMatch(/<input type="file" id="input-fotos-camara" accept="image\/\*" capture="environment" hidden>/);
    expect(html).toMatch(/<input type="file" id="input-fotos-galeria" accept="image\/\*" multiple hidden>/);
  });

  test('GPS: casilla opt-in sin marcar por defecto y aviso de que no modifica la coordenada oficial', () => {
    expect(html).toMatch(/<input id="chk-fotos-gps" type="checkbox">/);
    expect(html).not.toMatch(/id="chk-fotos-gps"[^>]*checked/);
    expect(html).toMatch(/no modifica la coordenada oficial/);
  });

  test('observacion limitada a 140 en el HTML', () => {
    expect(html).toMatch(/id="fotos-observacion"[^>]*maxlength="140"/);
  });

  test('la galeria y "Agregar foto" arrancan ocultas (se muestran segun permisos)', () => {
    expect(html).toMatch(/id="fotos-galeria"[^>]*hidden>/);
    expect(html).toMatch(/id="btn-fotos-agregar"[^>]*hidden>/);
    expect(html).toMatch(/id="fotos-contador"[^>]*hidden>/);
  });
});

describe('gating por permisos en el controlador', () => {
  test('la galeria solo se pide con fotos=SI; sin ella ni se llama a la API', () => {
    expect(controlador).toMatch(/estado\.puedeVer = permisos\.fotos === true/);
    expect(controlador).toMatch(/estado\.puedeCargar = permisos\.fotos_carga === true/);
    // "no puedeVer" corta antes de cargarGaleria
    const abrir = controlador.slice(controlador.indexOf('function fotosPozosController_abrir'), controlador.indexOf('function cargarGaleria'));
    expect(abrir).toMatch(/if \(!estado\.puedeVer\) \{[\s\S]*?return;[\s\S]*?\}\s*cargarGaleria\(aperturaId\)/);
  });

  test('las miniaturas tambien exigen puedeVer', () => {
    expect(controlador).toMatch(/ctx && estado\.puedeVer \? apiGetFotoPozo/);
  });

  test('contador y galeria ocultos sin fotos=SI; "Agregar foto" oculto sin fotos_carga=SI', () => {
    expect(controlador).toMatch(/contadorEl\.hidden = !estado\.puedeVer/);
    expect(controlador).toMatch(/galeriaEl\.hidden = !estado\.puedeVer/);
    expect(controlador).toMatch(/btnAgregarEl\.hidden = !estado\.puedeCargar/);
  });

  test('el contador compartido solo se incrementa con fotos=SI', () => {
    expect(controlador).toMatch(/if \(puedeVer\) \{ fotosPozosResumenController_incrementar/);
  });

  test('el resumen solo se habilita con fotos === true (fotos_carga solo no alcanza)', () => {
    expect(resumen).toMatch(/ctx\.permisos\.fotos === true/);
    expect(resumen).not.toMatch(/permisos.fotos_carga/);
  });

  test('el chip de contador no se pinta sin permiso ni sin fotos', () => {
    expect(controlador).toMatch(/var n = fotosPozosResumenController_cantidadDe\(wellId\);\s*if \(!\(n > 0\)/);
  });
});

describe('app.js', () => {
  test('permisos por defecto y logout incluyen fotos y fotos_carga (fail-closed)', () => {
    const coincidencias = app.match(/fotos: false, fotos_carga: false/g) || [];
    expect(coincidencias.length).toBe(2);
  });

  test('logout descarta el resumen, la galeria y la cola', () => {
    const logout = app.slice(app.indexOf('function logout()'), app.indexOf("document.getElementById('btn-logout')"));
    expect(logout).toMatch(/fotosPozosResumenController_reset\(\)/);
    expect(logout).toMatch(/fotosPozosController_reset\(\)/);
  });

  test('abrirFotos tiene defensa en profundidad y recuerda el origen', () => {
    expect(app).toMatch(/function abrirFotos\(entidad\) \{\s*if \(!entidad \|\| !puedeFotos\(\)\)/);
    expect(app).toMatch(/fotosOrigen = \{ pantalla: pantallaActual/);
    expect(app).toMatch(/restaurarPantalla\(fotosOrigen\)/);
  });

  test('puedeFotos = fotos o fotos_carga; no depende de reemplazo ni de ne', () => {
    const f = app.slice(app.indexOf('function puedeFotos()'), app.indexOf('function descFotosHub'));
    expect(f).toMatch(/fotos === true \|\| permisosActuales\.fotos_carga === true/);
    expect(f).not.toMatch(/reemplazo|\.ne\b/);
  });

  test('tarjeta del hub: sin fotos=SI el texto nunca dice si hay fotos', () => {
    const f = app.slice(app.indexOf('function descFotosHub'), app.indexOf('function abrirModulo'));
    expect(f).toMatch(/if \(!permisosActuales\.fotos\) \{\s*return 'Cargar fotos del pozo';/);
  });

  test('el resumen se precarga solo con fotos=SI en hub y ficha NE', () => {
    expect(app).toMatch(/if \(permisosActuales\.fotos\) \{\s*var wellIdFotos/);
    expect(app).toMatch(/if \(permisosActuales\.fotos\) \{\s*fotosPozosResumenController_cargar\(\)\.then/);
  });

  test('Buscar reemplazo y Cerca Mio abren la galeria por wellId (helper comun)', () => {
    const usos = app.match(/abrirFotos\(fotosPozosLogic_entidadDeWellId\(wellId\)\)/g) || [];
    expect(usos.length).toBe(2);
  });

  test('Buscar reemplazo y Cerca Mio reciben "Fotos" solo con fotos=SI', () => {
    const ocurrencias = app.match(/onVerFotos: permisosActuales\.fotos === true/g) || [];
    expect(ocurrencias.length).toBe(2);
  });

  test('popups de Provincia Y de NE: mismo contexto de Fotos (permisos -> fotosPozosLogic_accionesMapa), con el resumen precargado', () => {
    expect(app).toMatch(/return fotosPozosLogic_accionesMapa\(permisosActuales, \{\s*abrirFotos: abrirFotos,\s*cantidadDe: fotosPozosResumenController_cantidadDe\s*\}\)/);
    const provincia = app.slice(app.indexOf('function abrirMapaDesde'), app.indexOf('function abrirMapaNE'));
    const ne = app.slice(app.indexOf('function abrirMapaNE'), app.indexOf('function abrirMapaPrincipal'));
    [provincia, ne].forEach((bloque) => {
      expect(bloque).toMatch(/onVerFotos: accionesFotosMapa\(\)\.onVerFotos/);
      expect(bloque).toMatch(/cantidadFotos: accionesFotosMapa\(\)\.cantidadFotos/);
      expect(bloque).toMatch(/fotosPozosResumenController_cargar\(\)/);
    });
  });

  test('inicializa los dos controladores con el contexto fresco', () => {
    expect(app).toMatch(/fotosPozosController_inicializar\(function \(\) \{[\s\S]{0,200}permisos: permisosActuales/);
    expect(app).toMatch(/fotosPozosResumenController_inicializar\(function \(\) \{[\s\S]{0,120}permisos: permisosActuales/);
  });
});

describe('Buscar reemplazo, Cerca Mio y popup NE', () => {
  test('usan el chip del controlador (que ya filtra por permiso/cantidad), no su propio contador', () => {
    expect(buscar).toMatch(/fotosPozosController_crearChip\(c\.wellId, ctx\.onVerFotos\)/);
    expect(cerca).toMatch(/fotosPozosController_crearChip\(resultado\.wellId, contexto\.onVerFotos\)/);
  });

  test('cargan el resumen de fotos junto al de aptitud (una llamada batch), nunca por pozo', () => {
    expect(buscar).toMatch(/fotosPozosResumenController_cargar\(\)/);
    expect(cerca).toMatch(/fotosPozosResumenController_cargar\(\)/);
    expect(buscar).not.toMatch(/apiGetFotosPozo|apiGetFotoPozo/);
    expect(cerca).not.toMatch(/apiGetFotosPozo|apiGetFotoPozo/);
  });

  test('los dos popups usan el MISMO helper de boton, que solo dibuja "Fotos" si el contexto trae la accion', () => {
    expect(shared).toMatch(/fotosPopup_crearBoton\(contexto, punto, marker\)/);
    expect(mapaProvincia).toMatch(/fotosPopup_crearBoton\(contexto, punto\.wellId, marker\)/);
    expect(popup).toMatch(/if \(!contexto \|\| typeof contexto\.onVerFotos !== 'function'\) \{\s*return null;/);
    // Provincia identifica SIEMPRE por wellId
    expect(mapaProvincia).not.toMatch(/fotosPopup_crearBoton\([^)]*monitoringId/);
  });

  test('el popup Provincia pone "Fotos" despues de Abrir pozo / Evaluar y recibe el marker para refrescar el contador', () => {
    expect(mapaProvincia).toMatch(/function mapaController_construirPopupInicial\(punto, contexto, marker\)/);
    expect(mapaProvincia).toMatch(/mapaController_construirPopupInicial\(punto, contexto, marker\)/);
    const popupInicial = mapaProvincia.slice(mapaProvincia.indexOf('function mapaController_construirPopupInicial'), mapaProvincia.indexOf('function mapaController_pintarLineaReemplazo'));
    expect(popupInicial.indexOf("'Abrir pozo'")).toBeLessThan(popupInicial.indexOf('btnEvaluar'));
    expect(popupInicial.indexOf('btnEvaluar')).toBeLessThan(popupInicial.indexOf('fotosPopup_crearBoton'));
  });

  test('fotosPopup.js se carga antes de mapa.js y mapaNE.js (y despues de la logica de fotos no hace falta: se usa en runtime)', () => {
    const pos = (a) => html.indexOf('src="js/' + a + '"');
    expect(pos('fotosPopup.js')).toBeGreaterThan(-1);
    expect(pos('fotosPopup.js')).toBeLessThan(pos('mapa.js'));
    expect(pos('fotosPopup.js')).toBeLessThan(pos('mapaNE.js'));
    expect(pos('fotosPopup.js')).toBeLessThan(pos('app.js'));
    expect(pos('fotosPozosLogic.js')).toBeLessThan(pos('app.js'));
  });
});

describe('red y privacidad', () => {
  test('solo el controlador, el resumen y api.js tocan los endpoints de fotos de pozos', () => {
    const archivos = fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    const usan = archivos.filter((f) => /\b(apiGetFotosPozo|apiGetFotoPozo|apiGetResumenFotosPozos|apiSubirFotoPozo)\(/.test(leer(__dirname, f))).sort();
    expect(usan).toEqual(["api.js", "fotosPozos.js", "fotosPozosResumen.js"]);
  });

  test('el controlador nunca usa innerHTML con datos (solo markup estatico) ni inserta HTML de la red', () => {
    const usos = controlador.match(/\.innerHTML\s*=\s*[^;]+;/g) || [];
    usos.forEach((u) => {
      // solo '' o el SVG estatico del chip
      expect(u).toMatch(/innerHTML\s*=\s*(''|'<svg[^']*')\s*;/);
    });
    expect(controlador).not.toMatch(/insertAdjacentHTML|outerHTML|document\.write/);
  });

  test('no loguea nada (ni base64, ni ids, ni errores con datos)', () => {
    [controlador, resumen, imagen].forEach((src) => {
      expect(src).not.toMatch(/console\.(log|info|warn|error|debug)/);
    });
  });

  test('el controlador no maneja driveFileId ni URLs de storage', () => {
    expect(controlador).not.toMatch(/driveFileId|driveThumbId|FOTOS_STORAGE|drive\.google|googleusercontent/i);
  });

  test('el nombre del archivo original nunca se envia ni se muestra', () => {
    expect(controlador).not.toMatch(/\.name\b/);
  });

  test('la ubicacion se pide solo al marcar la casilla', () => {
    // obtenerGps solo desde pedirGps, que solo se invoca en el change de la casilla marcada
    const usos = controlador.match(/fotosPozosLogic_obtenerGps/g) || [];
    expect(usos.length).toBe(1);
    expect(controlador).toMatch(/if \(chkGpsEl\.checked\) \{ pedirGps\(\); \} else \{ quitarGps\(\); \}/);
  });

  test('se sube de a UNA foto por request mediante la cola secuencial', () => {
    expect(controlador).toMatch(/fotosPozosCola_crear\(/);
    expect(controlador).toMatch(/apiSubirFotoPozo\(ctx\.sessionToken, item\.request\)/);
  });

  test('la pantalla de carga acepta como mucho 10 fotos por vez', () => {
    expect(html).toMatch(/hasta 10 por vez/);
  });
});

describe('pipeline de imagen compartido', () => {
  test('reemplazoFotos.js ya no tiene su propia compresion: usa fotosImagen_comprimir', () => {
    expect(reemplazoFotos).toMatch(/var comprimir = fotosImagen_comprimir;/);
    expect(reemplazoFotos).not.toMatch(/createImageBitmap|toBlob|getContext\('2d'\)/);
  });

  test('fotosImagen.js expone comprimir, leerBytes y sha1 y no loguea', () => {
    expect(imagen).toMatch(/window\.fotosImagen_comprimir = /);
    expect(imagen).toMatch(/window\.fotosImagen_leerBytes = /);
    expect(imagen).toMatch(/window\.fotosImagen_sha1 = /);
  });
});
