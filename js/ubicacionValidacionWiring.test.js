// Guardas baratas del cableado de la VALIDACION de correcciones de ubicacion: ids de index.html, orden de scripts, service worker, lista blanca de js/api.js
// ejecutado de verdad, integracion en app.js (contexto compartido, cierre de sesion), estilos mobile first y areas que NO se tocan.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');
const css = leer(raiz, 'css', 'styles.css');
const sw = leer(raiz, 'sw.js');
const app = leer(__dirname, 'app.js');
const api = leer(__dirname, 'api.js');
const controlador = leer(__dirname, 'ubicacionValidacion.js');
const ficha = leer(__dirname, 'ubicacionCorreccion.js');
const pendientes = leer(__dirname, 'ubicacionPendientes.js');
const logica = leer(__dirname, 'ubicacionCorreccionLogic.js');
const sinComentarios = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('index.html', () => {
  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = Array.from(new Set((controlador.match(/\$\('([^']+)'\)/g) || []).map((m) => m.slice(3, -2))));
    expect(ids.length).toBeGreaterThan(25);
    ids.forEach((id) => expect(html).toContain('id="' + id + '"'));
  });

  test('el indicador es un BOTON accesible dentro del hub, oculto al inicio, que abre un dialogo', () => {
    expect(html).toMatch(/<button type="button" id="ucorr-pendientes" class="ucorr-pendientes" aria-haspopup="dialog"[^>]* hidden>/);
    expect(html).toContain('id="ucorr-pendientes-texto"');
  });

  test('la bandeja es un dialogo modal accesible, oculto por defecto, con titulo asociado y boton cerrar con nombre', () => {
    expect(html).toMatch(/<div id="uval-overlay" class="ucorr-overlay uval-overlay" role="dialog" aria-modal="true" aria-labelledby="uval-titulo" hidden>/);
    expect(html).toMatch(/<h2 id="uval-titulo"/);
    expect(html).toMatch(/<button type="button" id="btn-uval-cerrar" class="ucorr-cerrar" aria-label="Cerrar">/);
  });

  test('el detalle arranca oculto; los estados, errores y bloques de confirmacion tambien', () => {
    ['uval-vista-detalle', 'uval-aviso', 'uval-lista-error', 'btn-uval-lista-reintentar', 'uval-lista-vacia', 'uval-lista-nota', 'uval-mapa-error', 'uval-mapa', 'uval-estado', 'uval-error',
      'uval-confirmar-validar', 'uval-rechazo', 'uval-err-motivo', 'uval-vigente-aviso', 'uval-mapa-cargando', 'uval-lista-cargando'].forEach((id) => {
      expect(html).toMatch(new RegExp('<[^>]*id="' + id + '"[^>]*\\shidden[\\s>=]'));
    });
    expect(html).not.toMatch(/<[^>]*id="uval-vista-lista"[^>]*\shidden/);
  });

  test('textos pedidos: Validar ubicacion, Rechazar, motivo obligatorio, Confirmar rechazo, titulo de la confirmacion', () => {
    expect(html).toContain('>Validar ubicación</button>');
    expect(html).toContain('>Rechazar</button>');
    expect(html).toContain('Motivo del rechazo (obligatorio)');
    expect(html).toContain('>Confirmar rechazo</button>');
    expect(html).toContain('¿Validar esta ubicación?');
    expect(html).toContain('<h2 id="uval-titulo" class="ucorr-titulo">Correcciones pendientes</h2>');
  });

  test('el motivo es un textarea con maxlength 300 y etiqueta asociada', () => {
    expect(html).toMatch(/<label for="uval-motivo"/);
    expect(html).toMatch(/<textarea id="uval-motivo"[^>]*maxlength="300"/);
  });

  test('Validar y Rechazar son botones distintos y Rechazar es secundario (clase propia; contorno + texto, no solo color)', () => {
    expect(html).toMatch(/id="btn-uval-validar" class="button uval-btn-validar"/);
    expect(html).toMatch(/id="btn-uval-rechazar" class="button button-secondary uval-btn-rechazar"/);
    expect(html.indexOf('id="btn-uval-validar"')).toBeLessThan(html.indexOf('id="btn-uval-rechazar"'));
  });

  test('el mapa del detalle es un contenedor PROPIO (no el del mapa de pozos ni el de la correccion), con chips de capa y leyenda de los tres puntos', () => {
    expect((html.match(/id="uval-mapa"/g) || []).length).toBe(1);
    expect(html).toMatch(/uval-capa-chip/);
    ['Irrigación (fija)', 'Validada vigente', 'Propuesta'].forEach((t) => expect(html).toContain(t));
  });

  test('script en orden: despues de api, mapaShared, la logica y el controlador de la ficha; antes de app.js', () => {
    const i = (n) => html.indexOf('<script src="' + n + '"></script>');
    expect(i('js/ubicacionValidacion.js')).toBeGreaterThan(-1);
    expect(i('js/ubicacionValidacion.js')).toBeGreaterThan(i('js/ubicacionCorreccionLogic.js'));
    expect(i('js/ubicacionValidacion.js')).toBeGreaterThan(i('js/ubicacionCorreccion.js'));
    expect(i('js/ubicacionValidacion.js')).toBeLessThan(i('js/app.js'));
    expect(i('js/ubicacionValidacion.js')).toBeGreaterThan(i('js/mapaShared.js'));
    expect(i('js/ubicacionValidacion.js')).toBeGreaterThan(i('js/api.js'));
  });

  test('el service worker precachea el script nuevo (la app instalada lo tiene sin red)', () => {
    expect(sw).toContain("'./js/ubicacionValidacion.js'");
  });
});

describe('js/api.js ejecutado: validar y rechazar mandan SOLO lo permitido', () => {
  function cargarApi() {
    const llamadas = [];
    const ctx = vm.createContext({ fetch: jest.fn((url, opciones) => { llamadas.push({ url: url, opciones: opciones }); return Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }); }), JSON, Object });
    vm.runInContext(api, ctx);
    return { ctx, llamadas, cuerpo: (i) => JSON.parse(llamadas[i].opciones.body) };
  }

  test('apiValidarCorreccionUbicacion: action + sessionToken + correccionId; nada mas', () => {
    const a = cargarApi();
    a.ctx.apiValidarCorreccionUbicacion('tok', 'id-1', 'motivo que no debe viajar', { x: 1 });
    expect(a.cuerpo(0)).toEqual({ action: 'validarCorreccionUbicacion', sessionToken: 'tok', correccionId: 'id-1' });
  });

  test('apiRechazarCorreccionUbicacion: action + sessionToken + correccionId + motivo; nada mas', () => {
    const a = cargarApi();
    a.ctx.apiRechazarCorreccionUbicacion('tok', 'id-1', 'No coincide', { estado: 'VALIDADA', email: 'x@y.z' });
    expect(a.cuerpo(0)).toEqual({ action: 'rechazarCorreccionUbicacion', sessionToken: 'tok', correccionId: 'id-1', motivo: 'No coincide' });
  });

  test('apiGetCorreccionesUbicacionPendientes (la lista): action + sessionToken', () => {
    const a = cargarApi();
    a.ctx.apiGetCorreccionesUbicacionPendientes('tok');
    expect(a.cuerpo(0)).toEqual({ action: 'getCorreccionesUbicacionPendientes', sessionToken: 'tok' });
  });
});

describe('integracion en app.js', () => {
  test('el indicador y la validacion comparten UN contexto con token y permisos FRESCOS; sesion vencida cierra sesion, usuario deshabilitado va a su pantalla', () => {
    expect(app).toMatch(/var contextoValidacion = function \(\) \{\s*return \{\s*sessionToken: sessionToken,\s*permisos: permisosActuales,\s*onSessionExpired: function \(\) \{\s*logout\(\);\s*\},\s*onUserDisabled: function \(\) \{\s*showScreen\('disabled'\);/);
    expect(app).toContain('ubicacionPendientesController_inicializar(contextoValidacion);');
    expect(app).toContain('ubicacionValidacionController_inicializar(contextoValidacion);');
  });

  test('logout cierra la bandeja o el detalle abiertos', () => {
    expect(app).toMatch(/ubicacionValidacionController_cerrar\(\);\s*\/\/ ni el indicador de correcciones pendientes\s*ubicacionPendientesController_reset\(\);/);
  });

  test('el hub no gana ninguna tarjeta nueva: la validacion se abre solo desde el indicador y desde las tarjetas pendientes de la ficha', () => {
    expect(pendientes).toContain('ubicacionValidacionController_abrirBandeja(badgeEl)');
    expect(ficha).toContain('ubicacionValidacionController_abrirDetalle({');
    expect(app).not.toContain('ubicacionValidacionController_abrir');
  });
});

describe('reglas del controlador', () => {
  const codigo = sinComentarios(controlador);

  test('todo permiso pasa por la logica estricta (ubicacion + ubicacion_validar exactos); el controlador no compara permisos por su cuenta', () => {
    expect(codigo).toContain('ubicacionCorreccionLogic_puedeValidar(ctx.permisos)');
    expect(codigo).not.toMatch(/permisos\.ubicacion_validar|permisos\[/);
  });

  test('validar y rechazar SOLO pasan por el flujo compartido (un envio a la vez, fail-closed); las apis solo se llaman desde ahi', () => {
    expect(codigo).toContain('ubicacionCorreccionLogic_crearFlujoResolucion(');
    expect((codigo.match(/apiValidarCorreccionUbicacion\(/g) || []).length).toBe(1);
    expect((codigo.match(/apiRechazarCorreccionUbicacion\(/g) || []).length).toBe(1);
    expect(codigo).toContain('estado.flujo.resolver(accion, c, detEls.motivo.value)');
  });

  test('la ficha no duplica la logica: no llama a validar/rechazar, solo abre el MISMO detalle', () => {
    const f = sinComentarios(ficha);
    expect(f).not.toMatch(/apiValidarCorreccionUbicacion|apiRechazarCorreccionUbicacion/);
    expect(f).toContain('ubicacionValidacionController_abrirDetalle');
  });

  test('despues de resolver: se avisa al indicador (alResolver) y a la ficha; nada se persiste en el navegador', () => {
    expect(codigo).toContain('ubicacionPendientesController_alResolver()');
    expect(codigo).toContain('ubicacionCorreccionController_alResolver(');
    expect(codigo).not.toMatch(/localStorage|sessionStorage|indexedDB/);
  });

  test('no hay alert()/confirm()/prompt(): los errores y las confirmaciones se muestran en contexto', () => {
    expect(codigo).not.toMatch(/\b(alert|confirm|prompt)\(/);
  });

  test('los textos del backend o del usuario salen escapados (innerHTML solo con funciones de la logica, escapar o vacio)', () => {
    const asignaciones = codigo.match(/\.innerHTML = [^;]+;/g) || [];
    expect(asignaciones.length).toBeGreaterThan(2);
    asignaciones.forEach((a) => expect(a).toMatch(/ubicacionCorreccionLogic_|escapar|''/));
  });

  test('el mapa es de solo lectura: marcadores no interactivos, sin arrastre ni clic en el mapa', () => {
    expect(codigo).not.toMatch(/draggable|\.on\('click'|\.on\('dragend'/);
    expect((codigo.match(/interactive: false/g) || []).length).toBe(3);
  });

  test('NO se tocan otras areas: ni mapa de pozos, ni Cerca Mio, ni seleccion geografica, ni reemplazos, ni NE', () => {
    expect(codigo).not.toMatch(/mapaPozos|cercaMio|seleccionGeografica|bandejaSeleccion|reemplazo|nivelEstatico|ubicacionOverlay|overlay-correcciones/i);
    expect(codigo).not.toMatch(/getElementById\('(mapa-pozos|screen-)/);
  });

  test('la logica no inventa endpoints: solo valida/rechaza con los dos callbacks inyectados', () => {
    expect(sinComentarios(logica)).not.toMatch(/validarCorreccionUbicacion|rechazarCorreccionUbicacion/);
  });
});

describe('estilos mobile first', () => {
  test.each(['.uval-lista', '.uval-item', '.uval-item-fuerte', '.uval-adv-media', '.uval-adv-fuerte', '.uval-acciones', '.uval-btn-rechazar', '.uval-bloque', '.uval-estado', 'button.ucorr-pendientes'])(
    'existe %s', (sel) => {
      expect(css).toContain(sel);
    }
  );

  test('los renglones de la bandeja ocupan todo el ancho, con altura tactil y sin desbordar (el texto largo se ajusta)', () => {
    const m = css.match(/\.uval-item \{[^}]*\}/);
    expect(m[0]).toMatch(/width: 100%/);
    expect(m[0]).toMatch(/min-height: 44px/);
    expect(css).toMatch(/\.uval-item-linea,\s*\.uval-item-obs \{[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/#uval-detalle-datos \.ucorr-datos dd \{[^}]*overflow-wrap: anywhere/);
  });

  test('las acciones van en columna, con botones de ancho completo y separacion entre Validar y Rechazar', () => {
    expect(css).toMatch(/\.uval-acciones,\s*\.uval-acciones-ficha \{[^}]*flex-direction: column;[^}]*gap: 14px/);
    expect(css).toMatch(/\.uval-acciones \.button,\s*\.uval-acciones-ficha \.button \{[^}]*width: 100%/);
  });

  test('Rechazar es secundario: contorno + color de error (no depende solo del color: lleva texto propio y borde)', () => {
    expect(css).toMatch(/\.uval-btn-rechazar,\s*\.uval-btn-rechazar:hover \{[^}]*background: transparent;[^}]*border: 2px solid var\(--color-error\)/);
  });

  test('los elementos con [hidden] que tienen display propio vuelven a ocultarse', () => {
    expect(css).toMatch(/\.uval-bloque\[hidden\] \{\s*display: none;/);
    expect(css).toMatch(/\.uval-acciones\[hidden\] \{\s*display: none;/);
    expect(css).toMatch(/\.uval-estado\[hidden\] \{\s*display: none;/);
    expect(css).toMatch(/button\.ucorr-pendientes\[hidden\] \{\s*display: none;/);
  });

  test('el indicador, como boton, tiene foco visible', () => {
    expect(css).toMatch(/button\.ucorr-pendientes:focus-visible/);
    expect(css).toMatch(/\.uval-item:focus-visible/);
  });
});
