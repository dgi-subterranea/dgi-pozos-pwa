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
    // E3-5: el bloque principal ya no se arma aca con la ubicacion automatica del padron: lo pinta js/ubicacionesConocidas.js (con la ubicacion OPERATIVA: decisiones + validada)
    expect(render).toContain('id="ubic-operativa"');
    expect(render).not.toContain('resuelta.lat');
    expect(render).not.toContain('ubicacionResuelta');
    expect(render.indexOf('id="ubic-operativa"')).toBeLessThan(render.indexOf('id="ubic-conocidas"'));
    expect(render).toContain('id="ubic-conocidas"');                             // y las "Ubicaciones conocidas" (cada fuente por separado; reemplazan al detalle tecnico)
    expect(render).not.toContain('Fuentes (detalle técnico)');
  });

  test('el controlador recibe sessionToken y permisos FRESCOS en cada uso y cierra sesion si vence', () => {
    expect(app).toMatch(/ubicacionCorreccionController_inicializar\(function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);/);
  });

  test('permisos por defecto fail-closed incluyen ubicacion_corregir y ubicacion_validar en false (inicio y logout)', () => {
    const defecto = app.match(/permisosActuales = \{[^}]*ubicacion_corregir: false, ubicacion_validar: false[^}]* \}/g) || [];
    expect(defecto.length).toBe(2);
  });

  test('logout cierra un modal abierto', () => {
    const logout = app.slice(app.indexOf('function logout()'), app.indexOf("document.getElementById('btn-logout')"));
    expect(logout).toContain('ubicacionCorreccionController_cerrar();');
  });

  test('E4-2: el hub decide la tarjeta Ubicacion SOLO por la lectura (getWellLocation ok): ni coordenadas, ni correcciones, ni permiso de corregir', () => {
    expect(app).toMatch(/ubicacionCorreccionLogic_ofrecerModulo\(\{ ubicacionFound: pozo\.ubicacion\.found \}\)/);
    expect(app).toMatch(/function ubicacionModuloDisponible\(location\) \{\s*return ubicacionCorreccionLogic_oficialDisponible\(location\);/);
  });

  test('E4-2: buscar un pozo ya NO consulta getCorreccionesUbicacionPozo para decidir la tarjeta (solo lo hace la ficha, ubicacionCorreccion.js)', () => {
    expect((app.match(/apiGetCorreccionesUbicacionPozo\(/g) || []).length).toBe(0);
    expect(app).not.toContain('correccionesUbicacion');
    expect(app).not.toContain('necesitaConsultarCorrecciones');
    const busqueda = app.slice(app.indexOf('function buscarPozo'), app.indexOf("form.addEventListener('submit'"));
    expect(busqueda).not.toContain('Correcciones');
  });

  test('la busqueda obsoleta no pisa el hub vigente', () => {
    const busqueda = app.slice(app.indexOf('function buscarPozo'), app.indexOf("form.addEventListener('submit'"));
    expect(busqueda).toMatch(/if \(pozoActual && pozoActual\.wellId === wellId\) \{\s*pozoActual\.itf = itf;/);
  });

  test('E4-2: si la ubicacion no se pudo comprobar (SERVICE_UNAVAILABLE) el hub avisa; no inventa un estado ni dice que no se encontro por eso', () => {
    const hub = app.slice(app.indexOf('function renderHubResultado'), app.indexOf('function puedeFotos'));
    expect(hub).toMatch(/var avisoUbicacion = ubicacionCorreccionLogic_avisoHubUbicacion\(pozo\.ubicacion, permisosActuales\);/);
    expect(hub).toMatch(/if \(avisoUbicacion !== ''\) \{\s*renderHubError\(avisoUbicacion\);\s*\} else \{\s*renderHubNotFound\(pozo\.wellId\);/);
  });

  test('sin ubicacion la ficha lo dice (no el texto de "fuentes que no coinciden"): "Sin ubicación registrada" + los dos detalles; el titulo viejo queda para discrepancia / descartadas', () => {
    const logica = fs.readFileSync(path.join(__dirname, 'ubicacionesConocidasLogic.js'), 'utf8');
    expect(logica).toContain("var UCON_TITULO_SIN_OPERATIVO = 'Sin ubicación operativa de Irrigación';");
    expect(logica).toContain("var UCON_TITULO_SIN_REGISTRADA = 'Sin ubicación registrada';");
    expect(logica).toContain("SIN_COORDENADAS: 'Este pozo figura en el padrón, pero no tiene una coordenada cargada.'");
    expect(logica).toContain("NO_EN_PADRON: 'Este pozo no figura en el padrón actual.'");
    expect(logica).not.toContain('Este pozo no tiene una coordenada oficial cargada.');
    expect(app).not.toContain("resuelta.estado === 'sinCoordenadas'");
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
    // E4-2: el boton sale de la tabla de modos (permisos exactos, la misma logica); el modal solo abre con el permiso de originar
    expect(controlador).toMatch(/function modoActual\(\) \{\s*var ctx = contexto\(\);\s*return ubicacionCorreccionLogic_modoDeIngreso\(/);
    expect(controlador).toMatch(/puedeCorregir: modo\.puedeOriginar, textoBoton: modo\.textoBoton, sinUbicacion: modo\.sinUbicacion/);
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Ingresar coordenadas (GMS / WGS84): cableado en index.html, api.js, estilos y service worker
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('Ingresar coordenadas: index.html', () => {
  test('el modal ofrece la tercera opcion "Ingresar coordenadas"', () => {
    expect(html).toMatch(/id="btn-ucorr-coordenadas"[^>]*>Ingresar coordenadas</);
    expect(html).toMatch(/id="btn-ucorr-gps"[^>]*>Usar mi ubicación actual</);
    expect(html).toMatch(/id="btn-ucorr-mapa"[^>]*>Elegir punto en el mapa</);
  });

  test('el panel GMS / WGS84: latitud y longitud con grados, minutos, segundos y hemisferio, cada campo con su etiqueta', () => {
    expect(html).toMatch(/id="ucorr-coord-panel"[^>]*hidden/);
    expect(html).toContain('GMS / WGS84');
    ['lat', 'lon'].forEach((eje) => {
      ['g', 'm', 's'].forEach((k) => {
        expect(html).toMatch(new RegExp('<label for="ucorr-' + eje + '-' + k + '">'));
        expect(html).toMatch(new RegExp('<input id="ucorr-' + eje + '-' + k + '"[^>]*type="text"'));
      });
      expect(html).toMatch(new RegExp('<label for="ucorr-' + eje + '-h">Hemisferio</label><select id="ucorr-' + eje + '-h"'));
      expect(html).toMatch(new RegExp('id="ucorr-err-' + eje + '"[^>]*role="alert"[^>]*hidden'));
    });
    ['Latitud', 'Longitud', 'Grados', 'Minutos', 'Segundos'].forEach((t) => expect(html).toContain('>' + t + '<'));
  });

  test('defaults para Mendoza: latitud S y longitud O seleccionados; opciones N/S y E/O', () => {
    expect(html).toMatch(/id="ucorr-lat-h"[^>]*><option value="N">N<\/option><option value="S" selected>S<\/option><\/select>/);
    expect(html).toMatch(/id="ucorr-lon-h"[^>]*><option value="E">E<\/option><option value="O" selected>O<\/option><\/select>/);
  });

  test('los campos aceptan coma o punto (texto, no number) y no autocompletan ni autocapitalizan', () => {
    expect(html).toMatch(/id="ucorr-lat-s"[^>]*type="text" inputmode="decimal"/);
    expect(html).toMatch(/id="ucorr-lat-g"[^>]*type="text" inputmode="numeric"/);
    expect(html).not.toMatch(/id="ucorr-(lat|lon)-[gms]"[^>]*type="number"/);
    expect(html).toMatch(/id="ucorr-lat-g"[^>]*autocomplete="off"[^>]*autocapitalize="off"/);
  });

  test('aviso de punto movido y restaurar, equivalencia WGS84, error general y resumen del original (todo oculto al inicio)', () => {
    expect(html).toContain('Moviste el punto manualmente. Se guardará como punto elegido en el mapa.');
    expect(html).toMatch(/id="btn-ucorr-coord-restaurar"[^>]*>Restaurar coordenada ingresada</);
    expect(html).toMatch(/id="ucorr-coord-movido"[^>]*role="status"[^>]*hidden/);
    expect(html).toMatch(/id="ucorr-coord-equivale"[^>]*hidden/);
    expect(html).toMatch(/id="ucorr-err-general"[^>]*role="alert"[^>]*hidden/);
    expect(html).toMatch(/id="ucorr-resumen-original"[^>]*hidden/);
  });

  test('el texto del aviso del HTML es el MISMO que el de la logica (una sola fuente)', () => {
    expect(logica).toContain("var UCORR_TEXTO_PUNTO_MOVIDO = 'Moviste el punto manualmente. Se guardará como punto elegido en el mapa.';");
    expect(logica).toContain("var UCORR_TEXTO_RESTAURAR = 'Restaurar coordenada ingresada';");
    expect(controlador).toContain('coordEls.movidoTexto.textContent = UCORR_TEXTO_PUNTO_MOVIDO;');
  });

  test('usa el mapa existente del modal: no hay un segundo contenedor de mapa', () => {
    expect((html.match(/id="ucorr-mapa"/g) || []).length).toBe(1);
    expect((html.match(/id="ucorr-vista-mapa"/g) || []).length).toBe(1);
    expect((controlador.match(/L\.map\(/g) || []).length).toBe(1);
  });

  test('coordenadasConversion.js se carga ANTES de la logica y del controlador, y es local (sin CDN ni librerias externas)', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('coordenadasConversion.js')).toBeGreaterThan(-1);
    expect(pos('coordenadasConversion.js')).toBeLessThan(pos('ubicacionCorreccionLogic.js'));
    expect(pos('ubicacionCorreccionLogic.js')).toBeLessThan(pos('ubicacionCorreccion.js'));
    expect(html).not.toMatch(/<script[^>]*src="https?:[^"]*(proj4|pyproj|geodesy|coordinates)/i);
    expect((html.match(/coordenadasConversion\.js/g) || []).length).toBe(1);
  });
});

describe('Ingresar coordenadas: js/api.js ejecutado', () => {
  function cargarApi() {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: jest.fn((url, opciones) => { llamadas.push(opciones); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }), JSON, Object });
    vm.runInContext(api, ctx);
    return { ctx, cuerpo: (i) => JSON.parse(llamadas[i].body) };
  }
  const ORIGINAL = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };

  test('COORDENADAS_GMS: viaja coordenadaOriginal ademas de los 7 campos, y NADA mas (ni coordenadaOriginalTexto / crsOriginal / identidad / estado)', () => {
    const a = cargarApi();
    a.ctx.apiProponerCorreccionUbicacion('tok', {
      wellId: '14-0001', lat: -33.34765, lon: -69.14545, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: '', clientRequestId: 'ucorr-12345678', coordenadaOriginal: ORIGINAL,
      coordenadaOriginalTexto: 'X', crsOriginal: 'Y', autoValidar: true, email: 'a@b.com', nombre: 'Falso', distanciaM: 1, estado: 'VALIDADA'
    });
    const body = a.cuerpo(0);
    expect(Object.keys(body).sort()).toEqual(['action', 'clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'sessionToken', 'wellId']);
    expect(body.coordenadaOriginal).toEqual(ORIGINAL);
    expect(JSON.stringify(body)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|autoValid|email|Falso|distancia|VALIDADA/);
  });

  test('GPS y mapa NO mandan coordenadaOriginal (la clave ni aparece en el JSON)', () => {
    const a = cargarApi();
    a.ctx.apiProponerCorreccionUbicacion('tok', { wellId: '14-0001', lat: 1, lon: 2, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', clientRequestId: 'ucorr-12345678' });
    expect(Object.keys(a.cuerpo(0))).not.toContain('coordenadaOriginal');
  });

  test('el modulo de conversion no depende de librerias ni de la red', () => {
    const conv = leer(__dirname, 'coordenadasConversion.js');
    expect(conv.replace(/\/\/.*$/gm, '')).not.toMatch(/\b(fetch|XMLHttpRequest|import|require|document|window|localStorage)\b/);
  });
});

describe('Ingresar coordenadas: controlador y estilos', () => {
  test('el controlador nunca arma coordenadaOriginalTexto ni crsOriginal (son del backend) y no persiste nada', () => {
    [controlador, logica].forEach((src) => {
      const codigo = src.replace(/\/\/.*$/gm, '');
      expect(codigo).not.toMatch(/coordenadaOriginalTexto\s*(:|=(?!=))/);
      expect(codigo).not.toMatch(/crsOriginal\s*(:|=(?!=))/);
    });
  });

  test('los textos de usuario salen escapados (innerHTML solo con ubicacionCorreccionLogic_escapar)', () => {
    expect(logica).toMatch(/esc\(texto\)/);
    expect(controlador).not.toMatch(/innerHTML\s*=\s*[^;]*coord/i);
  });

  test.each([
    'ucorr-coord-panel', 'ucorr-eje', 'ucorr-eje-campos', 'ucorr-campo', 'ucorr-input', 'ucorr-equivale', 'ucorr-movido', 'ucorr-sistema', 'ucorr-dato-original', 'ucorr-crs', 'ucorr-mapa-corto'
  ])('existe la clase .%s', (clase) => {
    expect(css).toContain('.' + clase);
  });

  test('el campo con error se marca (aria-invalid) y los hemisferios caben en celular: grilla de 4 columnas', () => {
    expect(css).toMatch(/\.ucorr-input\[aria-invalid="true"\]/);
    expect(css).toMatch(/\.ucorr-eje-campos \{[^}]*grid-template-columns: 1fr 1fr 1\.5fr 1\.1fr/);
  });

  test('los elementos con [hidden] que tienen display propio vuelven a ocultarse', () => {
    expect(css).toMatch(/\.ucorr-coord-panel\[hidden\] \{\s*display: none/);
    expect(css).toMatch(/\.ucorr-movido\[hidden\] \{\s*display: none/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Etapa 4: POSGAR 94 / Argentina 2 en el cableado (index.html, estilos, api.js, offline)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('POSGAR: index.html', () => {
  test('selector de sistema accesible: grupo con titulo y dos botones (GMS / WGS84 y POSGAR 94 / Argentina 2) con aria-pressed', () => {
    expect(html).toMatch(/role="group" aria-labelledby="ucorr-sistemas-titulo"/);
    expect(html).toMatch(/id="ucorr-sistemas-titulo"[^>]*>Sistema de coordenadas</);
    expect(html).toMatch(/id="btn-ucorr-sistema-gms"[^>]*type="button"|type="button" id="btn-ucorr-sistema-gms"/);
    expect(html).toMatch(/id="btn-ucorr-sistema-gms"[^>]*aria-pressed="true">GMS \/ WGS84</);
    expect(html).toMatch(/id="btn-ucorr-sistema-posgar"[^>]*aria-pressed="false">POSGAR 94 \/ Argentina 2</);
    expect(html).toMatch(/data-sistema="GMS"/);
    expect(html).toMatch(/data-sistema="POSGAR"/);
  });

  test('panel POSGAR oculto al inicio, con titulo "POSGAR 94 / Argentina 2 · EPSG:22182" y la ayuda de la convencion X = Este, Y = Norte', () => {
    expect(html).toMatch(/id="ucorr-coord-posgar"[^>]*hidden/);
    expect(html).toMatch(/<strong>POSGAR 94 \/ Argentina 2<\/strong> · EPSG:22182/);
    expect(html).toContain('En esta aplicación se ingresa X = Este e Y = Norte.');
    expect(logica).toContain("var UCORR_TEXTO_AYUDA_XY = 'En esta aplicación se ingresa X = Este e Y = Norte.';");
  });

  test('campos "X / Este" e "Y / Norte": etiquetas asociadas, teclado numerico/decimal, sin autocompletar ni capitalizar, tipo texto (acepta coma y puntos)', () => {
    ['x', 'y'].forEach((k) => {
      expect(html).toMatch(new RegExp('<label for="ucorr-posgar-' + k + '">' + (k === 'x' ? 'X / Este' : 'Y / Norte') + '</label>'));
      expect(html).toMatch(new RegExp('<input id="ucorr-posgar-' + k + '"[^>]*type="text" inputmode="decimal" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="18"'));
      expect(html).toMatch(new RegExp('id="ucorr-err-' + k + '"[^>]*role="alert"[^>]*hidden'));
      expect(html).toMatch(new RegExp('id="ucorr-posgar-' + k + '"[^>]*aria-describedby="ucorr-err-' + k + '"'));
    });
    expect(html).not.toMatch(/id="ucorr-posgar-[xy]"[^>]*type="number"/);
  });

  test('X/Y invertidos: bloque oculto con mensaje y el boton "Intercambiar X e Y"', () => {
    expect(html).toMatch(/id="ucorr-posgar-invertido"[^>]*role="alert"[^>]*hidden/);
    expect(html).toContain('Parece que X e Y están intercambiados.');
    expect(html).toMatch(/id="btn-ucorr-posgar-intercambiar"[^>]*>Intercambiar X e Y</);
    expect(html).toMatch(/id="ucorr-err-posgar-general"[^>]*role="alert"[^>]*hidden/);
  });

  test('el panel GMS sigue intacto (ids, hemisferios por defecto, ayuda) y el mapa sigue siendo uno solo', () => {
    ['lat', 'lon'].forEach((eje) => ['g', 'm', 's', 'h'].forEach((k) => expect(html).toContain('id="ucorr-' + eje + '-' + k + '"')));
    expect(html).toMatch(/id="ucorr-lat-h"[^>]*><option value="N">N<\/option><option value="S" selected>S<\/option><\/select>/);
    expect(html).toMatch(/id="ucorr-lon-h"[^>]*><option value="E">E<\/option><option value="O" selected>O<\/option><\/select>/);
    expect(html).toMatch(/id="ucorr-coord-gms"/);
    expect((html.match(/id="ucorr-mapa"/g) || []).length).toBe(1);
  });

  test('todos los ids POSGAR que usa el controlador existen en el HTML', () => {
    const ids = new Set();
    controlador.replace(/\$\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    ['ucorr-posgar-x', 'ucorr-posgar-y', 'ucorr-err-x', 'ucorr-err-y', 'ucorr-coord-posgar', 'ucorr-posgar-invertido', 'btn-ucorr-posgar-intercambiar', 'btn-ucorr-sistema-gms', 'btn-ucorr-sistema-posgar'].forEach((id) => {
      expect(ids.has(id)).toBe(true);
      expect(html).toContain('id="' + id + '"');
    });
  });
});

describe('POSGAR: estilos (movil) y api.js', () => {
  test.each(['ucorr-sistemas', 'ucorr-sistema-chip', 'ucorr-coord-posgar', 'ucorr-eje-xy', 'ucorr-ayuda-xy', 'ucorr-posgar-titulo'])('existe la clase .%s', (clase) => {
    expect(css).toContain('.' + clase);
  });

  test('selector de dos columnas con botones de al menos 44 px de alto (tactil); X e Y en dos columnas', () => {
    expect(css).toMatch(/\.ucorr-sistemas-chips \{[^}]*grid-template-columns: 1fr 1fr/);
    expect(css).toMatch(/\.ucorr-sistema-chip \{[^}]*min-height: 44px/);
    expect(css).toMatch(/\.ucorr-eje-xy \{[^}]*grid-template-columns: 1fr 1fr/);
  });

  test('los campos del modal ganan al estilo global de input[type=text] (si no, en celular se recortan los digitos)', () => {
    expect(css).toMatch(/\.ucorr-panel \.ucorr-input \{[^}]*height: 46px/);
    expect(css).toMatch(/\.ucorr-panel \.ucorr-input \{[^}]*padding: 0 4px/);
  });

  test('los paneles de sistema con display propio vuelven a ocultarse con [hidden]', () => {
    expect(css).toMatch(/\.ucorr-coord-gms\[hidden\],\s*\.ucorr-coord-posgar\[hidden\] \{\s*display: none/);
  });

  test('api.js manda {x, y} en coordenadaOriginal de POSGAR y nada mas (ni coordenadaOriginalTexto / crsOriginal)', () => {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: jest.fn((url, o) => { llamadas.push(o); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }), JSON, Object });
    vm.runInContext(api, ctx);
    ctx.apiProponerCorreccionUbicacion('tok', {
      wellId: '14-0001', lat: -32.992946, lon: -69, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null, observacion: '', clientRequestId: 'ucorr-12345678',
      coordenadaOriginal: { x: 2500000, y: 6350000 }, coordenadaOriginalTexto: 'X', crsOriginal: 'EPSG:22182', email: 'a@b.com'
    });
    const body = JSON.parse(llamadas[0].body);
    expect(body.coordenadaOriginal).toEqual({ x: 2500000, y: 6350000 });
    expect(JSON.stringify(body)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|EPSG|email/);
  });
});

describe('POSGAR: el modulo de conversion funciona SIN conexion y SIN librerias', () => {
  test('ejecutado solo (un contexto vacio, sin fetch / document / require), convierte POSGAR -> WGS84 y detecta X/Y invertidos', () => {
    const conv = leer(__dirname, 'coordenadasConversion.js');
    const ctx = vm.createContext({ Math, Number, String, isFinite, Object });       // nada de red ni de DOM: lo que tiene la PWA sin conexion
    vm.runInContext(conv, ctx);
    const ok = vm.runInContext("coordenadas_evaluarPosgar({ x: '2.500.000,00', y: '6.350.000' })", ctx);
    expect(ok.ok).toBe(true);
    expect([ok.lat, ok.lon]).toEqual([-32.992946, -69]);
    expect(ok.crsOriginal).toBe('EPSG:22182');
    const inv = vm.runInContext("coordenadas_evaluarPosgar({ x: 6350000, y: 2500000 })", ctx);
    expect(inv).toMatchObject({ ok: false, invertido: true });
  });

  test('esta en el precache del service worker (SHELL_FILES) y se carga antes que la logica', () => {
    const sw = require('../sw');
    expect(sw.SHELL_FILES).toContain('./js/coordenadasConversion.js');
    expect(html.indexOf('src="js/coordenadasConversion.js"')).toBeLessThan(html.indexOf('src="js/ubicacionCorreccionLogic.js"'));
  });
});

describe('POSGAR: reglas de codigo del controlador', () => {
  test('el intercambio de X/Y solo ocurre desde el boton (una unica llamada a ubicacionCorreccionLogic_intercambiarXY, dentro de intercambiarXY)', () => {
    const codigo = controlador.replace(/\/\/.*$/gm, '');
    expect((codigo.match(/ubicacionCorreccionLogic_intercambiarXY\(/g) || []).length).toBe(1);
    expect(codigo).toMatch(/function intercambiarXY\(\) \{[\s\S]*?ubicacionCorreccionLogic_intercambiarXY\(/);
    expect(codigo).toMatch(/coordEls\.intercambiar\.addEventListener\('click', intercambiarXY\)/);
    expect((logica.replace(/\/\/.*$/gm, '').match(/intercambiarXY\(/g) || []).length).toBe(1);        // la logica solo DEFINE la funcion; nada la invoca
  });

  test('la convencion no se invierte: la logica jamas usa X como Norte (X = Este, Y = Norte en cada mensaje y etiqueta)', () => {
    expect(html).toContain('X / Este');
    expect(html).toContain('Y / Norte');
    expect(html).not.toMatch(/X \/ Norte|Y \/ Este/);
  });
});
