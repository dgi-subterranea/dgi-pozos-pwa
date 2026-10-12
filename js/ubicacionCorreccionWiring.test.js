// Guardas baratas del cableado de las correcciones de ubicacion (ficha del pozo): ids existentes en index.html, orden de scripts, integracion
// en app.js (permisos fail-closed, contenedor, cierre de sesion), lista blanca de campos en js/api.js ejecutado de verdad, y reglas del controlador
// que no dependen de una ejecucion (no hay alert(), no se persiste nada, Irrigacion no se mueve).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const app = leer(__dirname, 'app.js');
const api = leer(__dirname, 'api.js');
const controlador = leer(__dirname, 'ubicacionCorreccion.js');
const logica = leer(__dirname, 'ubicacionCorreccionLogic.js');

describe('index.html y controlador', () => {
  test('todos los ids que usa el controlador existen en el HTML (los dinamicos los pinta la seccion)', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    const dinamicos = ['ubic-correcciones', 'btn-ubic-corr-abrir', 'btn-ubic-corr-recargar', 'btn-ucorr-reintentar-lectura'];
    expect(ids.size).toBeGreaterThan(30);
    const faltan = [...ids].filter((id) => dinamicos.indexOf(id) === -1 && !new RegExp('id="' + id + '"').test(html));
    expect(faltan).toEqual([]);
  });

  test('los ids dinamicos los genera el HTML de la seccion o la ficha de app.js', () => {
    expect(logica).toContain('id="btn-ubic-corr-abrir"');
    expect(logica).toContain('id="btn-ubic-corr-recargar"');
    expect(controlador).toContain('id="btn-ucorr-reintentar-lectura"');
    expect(app).toContain('id="ubic-correcciones"');
  });

  test('el modal es un dialogo accesible, oculto por defecto, con titulo asociado', () => {
    expect(html).toMatch(/<div id="ucorr-overlay" class="ucorr-overlay" role="dialog" aria-modal="true" aria-labelledby="ucorr-titulo" hidden>/);
    expect(html).toMatch(/<h2 id="ucorr-titulo"/);
    expect(html).toMatch(/id="btn-ucorr-cerrar"[^>]*aria-label="Cerrar"/);
  });

  test('las vistas gps, mapa y confirmar y los estados de carga/aviso arrancan ocultos; las opciones, visibles', () => {
    ['ucorr-vista-gps', 'ucorr-vista-mapa', 'ucorr-vista-confirmar', 'ucorr-mapa', 'ucorr-gps-resultado', 'ucorr-gps-mensaje', 'ucorr-advertencia-1km', 'ucorr-error', 'ucorr-guardando'].forEach((id) => {
      expect(html).toMatch(new RegExp('id="' + id + '"[^>]*hidden'));
    });
    expect(html).not.toMatch(/id="ucorr-vista-opciones"[^>]*hidden/);
  });

  test('las dos opciones del modal, textos pedidos y "Intentar nuevamente"', () => {
    expect(html).toMatch(/id="btn-ucorr-gps"[^>]*>Usar mi ubicación actual</);
    expect(html).toMatch(/id="btn-ucorr-mapa"[^>]*>Elegir punto en el mapa</);
    expect(html).toMatch(/id="btn-ucorr-gps-reintentar"[^>]*>Intentar nuevamente</);
    expect(html).toMatch(/id="btn-ucorr-mapa-usar"[^>]*disabled>Usar este punto</);
    expect(html).toMatch(/id="btn-ucorr-guardar"[^>]*disabled>Guardar corrección</);
  });

  test('el modal avisa que la ubicacion de Irrigacion no se modifica y rotula los marcadores fijos', () => {
    expect(html).toMatch(/La ubicación de Irrigación no se modifica/);
    expect(html).toMatch(/Irrigación \(fija\)/);
    expect(html).toMatch(/Corrección vigente \(fija\)/);
    expect(html).toMatch(/Nuevo punto/);
  });

  test('observacion: textarea con maxlength 300 y etiqueta asociada', () => {
    expect(html).toMatch(/<textarea id="ucorr-observacion"[^>]*maxlength="300"/);
    expect(html).toMatch(/<label id="ucorr-obs-label" for="ucorr-observacion"/);
  });

  test('chips de capa base (Mapa / Satelite) con data-capa, como el resto de los mapas', () => {
    expect(html).toMatch(/class="mapa-capa-chip ucorr-capa-chip active" data-capa="calle"/);
    expect(html).toMatch(/class="mapa-capa-chip ucorr-capa-chip" data-capa="satelite"/);
  });

  test('scripts en orden: logica y controlador despues de api/cargando/mapaShared y antes de app.js', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('ubicacionCorreccionLogic.js')).toBeGreaterThan(-1);
    ['api.js', 'cargando.js', 'mapaShared.js'].forEach((a) => expect(pos('ubicacionCorreccionLogic.js')).toBeGreaterThan(pos(a)));
    expect(pos('ubicacionCorreccion.js')).toBeGreaterThan(pos('ubicacionCorreccionLogic.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('ubicacionCorreccion.js'));
  });

  test('las pantallas y la bandeja existentes no se tocaron: sigue habiendo un unico #screen-ubicacion con #ubicacion-content', () => {
    expect((html.match(/id="screen-ubicacion"/g) || []).length).toBe(1);
    expect((html.match(/id="ubicacion-content"/g) || []).length).toBe(1);
  });
});

describe('integracion en app.js', () => {
  test('el contenedor de la seccion se agrega al modulo Ubicacion y se abre el controlador con wellId y la ubicacion ya cargada', () => {
    expect(app).toMatch(/html \+= '<div id="ubic-correcciones" class="ubic-correcciones"><\/div>';/);
    expect(app).toMatch(/ubicacionCorreccionController_abrir\(\{ wellId: location\.wellId, location: location \}\);/);
  });

  test('la ubicacion de Irrigacion se rotula y va ANTES del contenedor de correcciones (no se reemplaza)', () => {
    const render = app.slice(app.indexOf('function renderUbicacion'), app.indexOf('// --- Modulo Niveles Estaticos'));
    expect(render.indexOf('Ubicación de Irrigación')).toBeGreaterThan(-1);
    expect(render.indexOf('Ubicación de Irrigación')).toBeLessThan(render.indexOf('ubic-correcciones'));
    expect(render).toContain('resuelta.lat');                                  // las coordenadas oficiales siguen pintandose
    expect(render).toContain('Abrir en Google Maps');                            // y su enlace
    expect(render).toContain('Fuentes (detalle técnico)');                       // y el detalle tecnico
  });

  test('el controlador recibe sessionToken y permisos FRESCOS en cada uso y cierra sesion si vence', () => {
    expect(app).toMatch(/ubicacionCorreccionController_inicializar\(function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);/);
  });

  test('permisos por defecto fail-closed incluyen ubicacion_corregir y ubicacion_validar en false (inicio y logout)', () => {
    const defecto = app.match(/permisosActuales = \{[^}]*ubicacion_corregir: false, ubicacion_validar: false \}/g) || [];
    expect(defecto.length).toBe(2);
  });

  test('logout cierra un modal abierto', () => {
    const logout = app.slice(app.indexOf('function logout()'), app.indexOf("document.getElementById('btn-logout')"));
    expect(logout).toContain('ubicacionCorreccionController_cerrar();');
  });

  test('el hub decide la tarjeta Ubicacion con ubicacionCorreccionLogic_ofrecerModulo (coordenada oficial, permiso de corregir o correccion existente)', () => {
    expect(app).toMatch(/ubicacionCorreccionLogic_ofrecerModulo\(\{ ubicacionFound: pozo\.ubicacion\.found, location: pozo\.ubicacion\.data, permisos: permisosActuales, correcciones: pozo\.correccionesUbicacion \}\)/);
    expect(app).toMatch(/function ubicacionModuloDisponible\(location\) \{\s*return ubicacionCorreccionLogic_oficialDisponible\(location\);/);
  });

  test('al buscar un pozo SIN coordenada oficial y sin permiso de corregir, se consulta getCorreccionesUbicacionPozo (una sola llamada, solo en ese caso)', () => {
    expect((app.match(/apiGetCorreccionesUbicacionPozo\(/g) || []).length).toBe(1);
    const busqueda = app.slice(app.indexOf('function buscarPozo'), app.indexOf("form.addEventListener('submit'"));
    expect(busqueda).toMatch(/if \(ubicacionCorreccionLogic_necesitaConsultarCorrecciones\(\{ ubicacionFound: ubicacion\.found, location: ubicacion\.data, permisos: permisosActuales \}\)\) \{\s*fetchSinRechazo\(apiGetCorreccionesUbicacionPozo\(sessionToken, wellId\)\)/);
    expect(busqueda).toMatch(/mostrarHub\(corrResult\.status === 'ok' \? corrResult\.data : null\)/);        // si falla: sin correcciones, el modulo no se ofrece
    expect(busqueda).toMatch(/\} else \{\s*mostrarHub\(null\);/);
    expect(busqueda).toContain("corrResult.code === 'UNAUTHORIZED'");
    expect(busqueda).toContain("corrResult.code === 'USER_DISABLED'");
  });

  test('la busqueda obsoleta no pisa el hub vigente tampoco con la consulta extra', () => {
    const busqueda = app.slice(app.indexOf('function buscarPozo'), app.indexOf("form.addEventListener('submit'"));
    expect(busqueda).toMatch(/function mostrarHub\(correcciones\) \{\s*if \(pozoActual && pozoActual\.wellId === wellId\) \{/);
  });

  test('sin coordenada oficial la ficha lo dice (no el texto de "fuentes que no coinciden")', () => {
    expect(app).toContain("resuelta.estado === 'sinCoordenadas'");
    expect(app).toContain('Sin ubicación de Irrigación');
  });
});

describe('js/api.js ejecutado: lista blanca de campos', () => {
  function cargarApi() {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: jest.fn((url, opciones) => { llamadas.push({ url: url, opciones: opciones }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }), JSON, Object });
    vm.runInContext(api, ctx);
    return { ctx, llamadas, cuerpo: (i) => JSON.parse(llamadas[i].opciones.body) };
  }

  test('apiProponerCorreccionUbicacion manda action + sessionToken + SOLO los 7 campos permitidos, aunque "datos" traiga mas', () => {
    const a = cargarApi();
    a.ctx.apiProponerCorreccionUbicacion('tok', {
      wellId: '14-0001', lat: -33.34745, lon: -69.14545, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'x', clientRequestId: 'ucorr-12345678',
      autoValidar: true, email: 'a@b.com', nombre: 'Falso', distanciaM: 1, estado: 'VALIDADA', irrLat: 1, emailPropone: 'a@b.com', correccionId: 'x'
    });
    const body = a.cuerpo(0);
    expect(Object.keys(body).sort()).toEqual(['action', 'clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'sessionToken', 'wellId']);
    expect(body.action).toBe('proponerCorreccionUbicacion');
    expect(a.llamadas[0].opciones.keepalive).toBeUndefined();
  });

  test('apiGetCorreccionesUbicacionPozo manda action, sessionToken y wellId', () => {
    const a = cargarApi();
    a.ctx.apiGetCorreccionesUbicacionPozo('tok', '14-0001');
    expect(a.cuerpo(0)).toEqual({ action: 'getCorreccionesUbicacionPozo', sessionToken: 'tok', wellId: '14-0001' });
  });

  test('apiProponerCorreccionUbicacion sin datos no rompe', () => {
    const a = cargarApi();
    expect(() => a.ctx.apiProponerCorreccionUbicacion('tok')).not.toThrow();
  });
});

describe('reglas del controlador', () => {
  test('el boton y el modal dependen de la logica de permisos estricta', () => {
    expect(controlador).toMatch(/ubicacionCorreccionLogic_puedeCorregir\(ctx\.permisos\)/);
    expect(controlador).toMatch(/function abrirModal\(opener\) \{\s*if \(!puedeCorregir\(\) \|\| estado\.guardando\) \{\s*return;/);
    expect(controlador).toMatch(/puedeCorregir: puedeCorregir\(\)/);
  });

  test('el guardado pasa por el flujo (clientRequestId estable + sin doble envio) y corta el doble toque antes de cualquier cambio', () => {
    expect(controlador).toMatch(/function onGuardar\(\) \{\s*if \(estado\.guardando\) \{\s*return;/);
    expect(controlador).toContain('estado.flujo.guardar(estado.wellId, valoresActuales())');
    expect((controlador.match(/apiProponerCorreccionUbicacion\(/g) || []).length).toBe(1);          // una sola llamada, dentro de la fabrica del flujo
  });

  test('el cliente nunca arma campos de identidad, estado ni autoValidar', () => {
    [controlador, logica].forEach((src) => {
      const codigo = src.replace(/\/\/.*$/gm, '');
      expect(codigo).not.toMatch(/autoValidar\s*[:=]/);
      expect(codigo).not.toMatch(/[{,]\s*email\s*:/);                 // clave de objeto (no un ternario)
      expect(codigo).not.toMatch(/[{,]\s*nombre\s*:/);
    });
    expect(api.replace(/\/\/.*$/gm, '')).not.toMatch(/autoValidar/);
  });

  test('despues de guardar se pinta desde la relectura del backend (nunca desde lo enviado)', () => {
    expect(logica).toContain('deps.leer(wellId)');
    expect(controlador).toContain('estado.lectura = r.lectura;');
    expect(controlador).not.toMatch(/estado\.lectura\s*=\s*\{[^}]*vigente:\s*r\.correccion/);
  });

  test('no hay alert()/confirm()/prompt(); los errores se muestran en contexto', () => {
    [controlador, logica].forEach((src) => expect(src.replace(/\/\/.*$/gm, '')).not.toMatch(/\b(alert|confirm|prompt)\s*\(/));
  });

  test('nada se persiste en el navegador (ni coordenadas ni intentos)', () => {
    [controlador, logica].forEach((src) => expect(src).not.toMatch(/localStorage|sessionStorage|indexedDB/));
  });

  test('en el mapa: Irrigacion y vigente son marcadores no interactivos; solo el punto nuevo es arrastrable', () => {
    expect(controlador).toMatch(/'ucorr-marker-irr'[^\n]*interactive: false/);
    expect(controlador).toMatch(/'ucorr-marker-vig'[^\n]*interactive: false/);
    expect((controlador.match(/draggable: true/g) || []).length).toBe(1);
    expect(controlador).toMatch(/mapaShared_iconoPuntoBusqueda\(\)[^\n]*draggable: true/);
  });

  test('reutiliza la infraestructura de mapas existente (carga diferida de Leaflet y capas base) y el componente de carga', () => {
    expect(controlador).toContain('mapaShared_cargarLibrerias()');
    expect(controlador).toContain('mapaShared_crearCapasBase(');
    expect(controlador).toContain('mapaShared_alMostrarMapa(');
    expect(controlador).toContain("cargando_html('Cargando correcciones…'");
  });

  test('GPS: alta precision, sin cache', () => {
    expect(controlador).toMatch(/\{ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 \}/);
  });

  test('no se tocan otras areas: el controlador no referencia mapa provincial, Cerca Mio, seleccion, NE ni reemplazos', () => {
    const codigo = controlador.replace(/\/\/.*$/gm, '');
    ['mapaController_', 'cercaMioController_', 'seleccionController_', 'mapaNEController_', 'reemplazoController_', 'buscarReemplazo'].forEach((n) => expect(codigo).not.toContain(n));
  });
});

describe('estilos', () => {
  test.each([
    'ucorr-overlay', 'ucorr-panel', 'ucorr-card-vigente', 'ucorr-card-pendiente', 'ucorr-badge-validada', 'ucorr-badge-pendiente', 'ucorr-advertencia', 'ucorr-mapa',
    'ucorr-marker-irr', 'ucorr-marker-vig', 'ucorr-historial', 'ucorr-aviso-ok', 'ucorr-opcion'
  ])('existe la clase .%s', (clase) => {
    expect(css).toContain('.' + clase);
  });

  test('en celular el panel es una hoja inferior; en pantallas grandes se centra', () => {
    expect(css).toMatch(/\.ucorr-overlay \{[^}]*align-items: flex-end/);
    expect(css).toMatch(/@media \(min-width: 640px\) \{\s*\.ucorr-overlay \{\s*align-items: center/);
  });

  test('respeta prefers-reduced-motion (la animacion solo con no-preference)', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\s*\.ucorr-panel \{\s*animation: ucorr-subir/);
  });
});
