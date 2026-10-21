// Controlador DOM de la VALIDACION de correcciones (js/ubicacionValidacion.js) ejecutado de verdad, sin navegador: un DOM minimo falso, Leaflet simulado y un
// "servidor" en memoria detras de las llamadas a la API (apiGetCorreccionesUbicacionPendientes / ...Pozo / apiValidar... / apiRechazar...). Verifica el
// comportamiento observable: la bandeja que abre el indicador, el detalle con su mapa, la confirmacion de Validar, el motivo obligatorio de Rechazar, el doble
// toque, los errores (backend, conexion, sesion, "ya resuelta"), el refresco posterior (indicador, ficha, lista) y los permisos fail-closed.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fuenteConversion = fs.readFileSync(path.join(__dirname, 'coordenadasConversion.js'), 'utf8');
const fuenteLogica = fs.readFileSync(path.join(__dirname, 'ubicacionCorreccionLogic.js'), 'utf8');
const fuenteControlador = fs.readFileSync(path.join(__dirname, 'ubicacionValidacion.js'), 'utf8');
const CODIGO = fuenteControlador.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');             // sin los comentarios
const htmlIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Estado inicial real: los ids que en index.html nacen con el atributo hidden.
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });

const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

const PERM_VALIDA = { ubicacion: true, ubicacion_validar: true };
const IRR = { lat: -33.34765, lon: -69.14545 };
const propuesta = (id, extra) => Object.assign({
  correccionId: id, wellId: '14-0001', lat: -33.3478, lon: -69.1456, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'Boca corrida al norte', nombrePropone: 'Ana Pérez',
  timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 22.2, advertenciaDistancia: false, estado: 'PROPUESTA', resolucion: null, propia: false,
  coordenadaOriginalTexto: '', crsOriginal: '', irrigacion: { lat: IRR.lat, lon: IRR.lon, estado: 'unica' }
}, extra || {});
const P1 = propuesta('11111111-1111-4111-8111-111111111111');
const P2 = propuesta('22222222-2222-4222-8222-222222222222', { wellId: '14-0002', nombrePropone: 'Beto Gómez' });
const VIGENTE = propuesta('99999999-9999-4999-8999-999999999999', { estado: 'VALIDADA', lat: -33.3474, lon: -69.1455, nombrePropone: 'Federico', resolucion: { evento: 'VALIDADA' } });

// ---------------------------------------------------------------------------------------------------------------- DOM falso
function crearElemento(id) {
  const e = {
    id: id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', className: '', scrollTop: 0, listeners: {}, atributos: {},
    addEventListener(tipo, f) { (e.listeners[tipo] = e.listeners[tipo] || []).push(f); },
    emit(tipo, ev) { (e.listeners[tipo] || []).forEach((f) => f(ev || {})); },
    click() { if (!e.disabled) { e.emit('click'); } },
    focus() { e.enfocado = (e.enfocado || 0) + 1; },
    getAttribute(n) { return e.atributos[n] === undefined ? null : e.atributos[n]; }
  };
  return e;
}

function crearEntorno() {
  const els = {};
  const chips = [Object.assign(crearElemento('chip-calle'), { atributos: { 'data-capa': 'calle' } }), Object.assign(crearElemento('chip-sat'), { atributos: { 'data-capa': 'satelite' } })];
  const clases = new Set();
  const cuerpo = { classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) }, contains: () => true };
  const documento = {
    body: cuerpo,
    getElementById(id) {
      if (!els[id]) { els[id] = crearElemento(id); els[id].hidden = OCULTOS_INICIAL.has(id); }
      return els[id];
    },
    querySelectorAll(sel) { return sel === '.uval-capa-chip' ? chips : []; }
  };
  return { documento, els, chips, clases };
}

function crearLeafletFalso() {
  const reg = { mapas: [], marcadores: [], vistas: [], encuadres: [] };
  const L = {
    map(idContenedor) {
      const m = {
        idContenedor, setView(c, z) { reg.vistas.push({ c: c, z: z }); return m; }, fitBounds(puntos, opciones) { reg.encuadres.push({ puntos: puntos, opciones: opciones }); return m; },
        on() { return m; }, invalidateSize() {}
      };
      reg.mapas.push(m);
      return m;
    },
    layerGroup() { const g = { capas: [], clearLayers() { g.capas = []; }, addTo() { return g; } }; return g; },
    divIcon(o) { return { divIcon: o }; },
    marker(latlng, opciones) {
      const mk = { latlng: latlng, opciones: opciones, addTo(destino) { if (destino && destino.capas) { destino.capas.push(mk); } return mk; } };
      reg.marcadores.push(mk);
      return mk;
    }
  };
  return { L, reg };
}

// ---------------------------------------------------------------------------------------------------------------- carga del controlador + servidor en memoria
function cargar(opc) {
  const o = opc || {};
  const entorno = crearEntorno();
  const { L, reg } = crearLeafletFalso();
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, Error, isFinite, parseInt, parseFloat, setTimeout });
  ctx.window = ctx;
  ctx.document = entorno.documento;
  ctx.L = L;
  ctx.MAPA_CAPA_BASE_DEFAULT = 'calle';
  ctx.mapaShared_cargarLibrerias = jest.fn(() => (o.libreriasFallan ? Promise.reject(new Error('sin red')) : Promise.resolve()));
  ctx.mapaShared_crearCapasBase = jest.fn(() => ({ calle: {}, satelite: {} }));
  ctx.mapaShared_alMostrarMapa = jest.fn((mapa, cb) => cb());
  ctx.mapaShared_cambiarCapaBase = jest.fn();
  ctx.mapaShared_iconoPuntoBusqueda = jest.fn(() => ({ pin: true }));

  // servidor en memoria: lo que resuelve el backend real (la propuesta sale de las pendientes; validar la hace vigente)
  const srv = { pendientes: (o.pendientes || [P1, P2]).slice(), vigente: o.vigente === undefined ? null : o.vigente, validadas: [], rechazadas: [] };
  const respuesta = (x) => (typeof x === 'function' ? x() : Promise.resolve(x));
  ctx.apiGetCorreccionesUbicacionPendientes = jest.fn(() => (o.listar
    ? respuesta(o.listar)
    : Promise.resolve({ status: 'ok', data: { total: srv.pendientes.length, inconsistentes: 0, pendientes: srv.pendientes.slice() } })));
  ctx.apiGetCorreccionesUbicacionPozo = jest.fn((token, wellId) => (o.leerPozo
    ? respuesta(o.leerPozo)
    : Promise.resolve({ status: 'ok', data: { vigente: srv.vigente, pendientes: srv.pendientes.filter((p) => p.wellId === wellId), historial: [] } })));
  ctx.apiValidarCorreccionUbicacion = jest.fn((token, id) => {
    if (o.validar) { return respuesta(o.validar); }
    const c = srv.pendientes.find((p) => p.correccionId === id);
    if (!c) { return Promise.resolve({ status: 'error', code: 'INVALID_TRANSITION' }); }
    srv.pendientes = srv.pendientes.filter((p) => p !== c);
    srv.vigente = Object.assign({}, c, { estado: 'VALIDADA' });
    srv.validadas.push(id);
    return Promise.resolve({ status: 'ok', data: { correccion: srv.vigente, supersedidas: [] } });
  });
  ctx.apiRechazarCorreccionUbicacion = jest.fn((token, id, motivo) => {
    if (o.rechazar) { return respuesta(o.rechazar); }
    const c = srv.pendientes.find((p) => p.correccionId === id);
    if (!c) { return Promise.resolve({ status: 'error', code: 'INVALID_TRANSITION' }); }
    srv.pendientes = srv.pendientes.filter((p) => p !== c);
    srv.rechazadas.push({ id: id, motivo: motivo });
    return Promise.resolve({ status: 'ok', data: { correccion: Object.assign({}, c, { estado: 'RECHAZADA' }), supersedidas: [] } });
  });
  ctx.ubicacionPendientesController_alResolver = jest.fn();
  ctx.ubicacionPendientesController_fijarTotal = jest.fn();
  ctx.ubicacionCorreccionController_alResolver = jest.fn();
  ctx.mapaDataset_invalidarDeltas = jest.fn();
  ctx.mapaDataset_invalidarDeltaCampo = jest.fn();
  ctx.mapaDataset_invalidarDeltaRegistral = jest.fn();

  vm.runInContext(fuenteConversion, ctx);
  vm.runInContext(fuenteLogica, ctx);
  vm.runInContext(fuenteControlador, ctx);
  const sesion = { sessionToken: 'tok-real', permisos: 'permisos' in o ? o.permisos : PERM_VALIDA, onSessionExpired: jest.fn(), onUserDisabled: jest.fn() };
  ctx.ubicacionValidacionController_inicializar(() => sesion);
  const el = (id) => entorno.documento.getElementById(id);
  const badge = { focus: jest.fn() };
  return Object.assign({ ctx, reg, sesion, srv, el, badge }, entorno);
}

async function abrirBandeja(t) {
  t.ctx.ubicacionValidacionController_abrirBandeja(t.badge);
  await flush();
}

// toca un renglon de la bandeja (el DOM real delega: el clic llega con un target que tiene closest())
function tocarRenglon(t, id) {
  const boton = { getAttribute: (n) => (n === 'data-uval-correccion' ? id : null) };
  t.el('uval-lista').emit('click', { target: { closest: (sel) => (sel === '[data-uval-correccion]' ? boton : null) } });
}

async function abrirDetalleDesdeLista(t, id) {
  await abrirBandeja(t);
  tocarRenglon(t, id);
  await flush();
}

const visible = (t, id) => !t.el(id).hidden;

describe('bandeja: el indicador abre la lista de correcciones pendientes', () => {
  test('el overlay existe en index.html, oculto, con los ids que usa el controlador', () => {
    ['uval-overlay', 'uval-lista', 'uval-detalle-datos', 'uval-mapa', 'btn-uval-validar', 'btn-uval-rechazar', 'uval-motivo', 'btn-uval-rechazar-confirmar', 'btn-uval-validar-confirmar'].forEach((id) => {
      expect(htmlIndex).toContain('id="' + id + '"');
    });
    expect(OCULTOS_INICIAL.has('uval-overlay')).toBe(true);
    expect(OCULTOS_INICIAL.has('uval-vista-detalle')).toBe(true);
  });

  test('abrir la bandeja: pide la cola con el token, pinta un renglon por propuesta y le pasa el total al indicador', async () => {
    const t = cargar();
    t.ctx.ubicacionValidacionController_abrirBandeja(t.badge);
    expect(visible(t, 'uval-overlay')).toBe(true);
    expect(t.clases.has('ucorr-abierto')).toBe(true);
    expect(visible(t, 'uval-lista-cargando')).toBe(true);
    await flush();
    expect(t.ctx.apiGetCorreccionesUbicacionPendientes).toHaveBeenCalledWith('tok-real');
    expect(visible(t, 'uval-lista-cargando')).toBe(false);
    const html = t.el('uval-lista').innerHTML;
    expect(html).toContain('data-uval-correccion="' + P1.correccionId + '"');
    expect(html).toContain('data-uval-correccion="' + P2.correccionId + '"');
    expect(html).toContain('14-0001');
    expect(html).toContain('Beto Gómez');
    expect(visible(t, 'uval-lista-vacia')).toBe(false);
    expect(t.ctx.ubicacionPendientesController_fijarTotal).toHaveBeenCalledWith(2);
    expect(t.el('uval-titulo').textContent).toBe('Correcciones pendientes');
  });

  test('lista vacia: "No hay correcciones pendientes." y el indicador se oculta (total 0)', async () => {
    const t = cargar({ pendientes: [] });
    await abrirBandeja(t);
    expect(visible(t, 'uval-lista-vacia')).toBe(true);
    expect(t.el('uval-lista').innerHTML).toBe('');
    expect(t.ctx.ubicacionPendientesController_fijarTotal).toHaveBeenCalledWith(0);
  });

  test('FAIL-CLOSED: sin ubicacion + ubicacion_validar exactos no se abre nada ni se consulta', async () => {
    for (const permisos of [null, {}, { ubicacion: true }, { ubicacion_validar: true }, { ubicacion: true, ubicacion_corregir: true }, { ubicacion: true, ubicacion_validar: 'SI' }]) {
      const t = cargar({ permisos });
      t.ctx.ubicacionValidacionController_abrirBandeja(t.badge);
      await flush();
      expect(visible(t, 'uval-overlay')).toBe(false);
      expect(t.ctx.apiGetCorreccionesUbicacionPendientes).not.toHaveBeenCalled();
    }
  });

  test('error de conexion: mensaje, boton Reintentar y NO se toca el indicador; reintentar vuelve a pedir', async () => {
    let n = 0;
    const t = cargar({ listar: () => { n += 1; return n === 1 ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve({ status: 'ok', data: { total: 1, pendientes: [P1] } }); } });
    await abrirBandeja(t);
    expect(t.el('uval-lista-error').textContent).toBe('No se pudieron cargar las correcciones. Revisá tu conexión e intentá de nuevo.');
    expect(visible(t, 'uval-lista-error')).toBe(true);
    expect(visible(t, 'btn-uval-lista-reintentar')).toBe(true);
    expect(t.ctx.ubicacionPendientesController_fijarTotal).not.toHaveBeenCalled();
    t.el('btn-uval-lista-reintentar').click();
    await flush();
    expect(visible(t, 'uval-lista-error')).toBe(false);
    expect(t.el('uval-lista').innerHTML).toContain(P1.correccionId);
  });

  test('error del backend: mensaje en espanol sin codigo tecnico', async () => {
    const t = cargar({ listar: { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle interno' } });
    await abrirBandeja(t);
    expect(t.el('uval-lista-error').textContent).toBe('No se pudieron cargar las correcciones pendientes. Intentá nuevamente.');
  });

  test.each([['UNAUTHORIZED', 'onSessionExpired'], ['USER_DISABLED', 'onUserDisabled']])('%s al abrir la bandeja: se cierra todo y se delega a la app (%s)', async (code, gancho) => {
    const t = cargar({ listar: { status: 'error', code } });
    await abrirBandeja(t);
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.sesion[gancho]).toHaveBeenCalledTimes(1);
  });

  test('con el tope del backend avisa cuantas se muestran de cuantas hay', async () => {
    const t = cargar({ listar: { status: 'ok', data: { total: 250, inconsistentes: 0, pendientes: [P1] } } });
    await abrirBandeja(t);
    expect(visible(t, 'uval-lista-nota')).toBe(true);
    expect(t.el('uval-lista-nota').textContent).toMatch(/Se muestran las 1 más antiguas de 250/);
  });

  test('una respuesta tardia de la lista, ya cerrada la bandeja, se descarta', async () => {
    let resolver;
    const t = cargar({ listar: () => new Promise((r) => { resolver = r; }) });
    t.ctx.ubicacionValidacionController_abrirBandeja(t.badge);
    t.el('btn-uval-cerrar').click();
    resolver({ status: 'ok', data: { total: 1, pendientes: [P1] } });
    await flush();
    expect(t.el('uval-lista').innerHTML).toBe('');
    expect(t.ctx.ubicacionPendientesController_fijarTotal).not.toHaveBeenCalled();
  });

  test('cerrar devuelve el foco al indicador; Escape tambien cierra', async () => {
    const t = cargar();
    await abrirBandeja(t);
    t.el('btn-uval-lista-cerrar').click();
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.clases.has('ucorr-abierto')).toBe(false);
    expect(t.badge.focus).toHaveBeenCalledTimes(1);
    await abrirBandeja(t);
    t.el('uval-overlay').emit('keydown', { key: 'Escape' });
    expect(visible(t, 'uval-overlay')).toBe(false);
  });
});

describe('detalle: datos, mapa propio y vigente', () => {
  test('tocar un renglon abre el detalle con los datos para decidir y lee la vigente del pozo', async () => {
    const t = cargar({ vigente: VIGENTE });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(visible(t, 'uval-vista-detalle')).toBe(true);
    expect(visible(t, 'uval-vista-lista')).toBe(false);
    expect(t.el('uval-titulo').textContent).toBe('Validar corrección');
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenCalledWith('tok-real', '14-0001');
    const datos = t.el('uval-detalle-datos').innerHTML;
    ['14-0001', 'Ana Pérez', '-33.3478, -69.1456', 'Boca corrida al norte', '-33.34765, -69.14545', '-33.3474, -69.1455 (Federico)'].forEach((x) => expect(datos).toContain(x));
    expect(t.el('btn-uval-detalle-volver').textContent).toBe('Volver a la lista');
    expect(t.el('btn-uval-validar').disabled).toBe(false);
    expect(t.el('btn-uval-rechazar').disabled).toBe(false);
  });

  test('mapa propio: Irrigacion + validada vigente + propuesta, tres marcadores diferenciados; todos fijos (no se mueven)', async () => {
    const t = cargar({ vigente: VIGENTE });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(t.reg.mapas).toHaveLength(1);
    expect(t.reg.mapas[0].idContenedor).toBe('uval-mapa');
    expect(visible(t, 'uval-mapa')).toBe(true);
    expect(visible(t, 'uval-mapa-cargando')).toBe(false);
    const ultimos = t.reg.marcadores.slice(-3);
    expect(ultimos.map((m) => m.latlng)).toEqual([[IRR.lat, IRR.lon], [VIGENTE.lat, VIGENTE.lon], [P1.lat, P1.lon]]);
    expect(ultimos[0].opciones.icon.divIcon.html).toContain('ucorr-marker-irr');
    expect(ultimos[0].opciones.icon.divIcon.html).toContain('Irrigación');
    expect(ultimos[1].opciones.icon.divIcon.html).toContain('ucorr-marker-vig');
    expect(ultimos[1].opciones.icon.divIcon.html).toContain('Vigente');
    expect(ultimos[2].opciones.icon).toEqual({ pin: true });
    ultimos.forEach((m) => expect(m.opciones.interactive).toBe(false));
    expect(t.reg.encuadres.slice(-1)[0].puntos).toHaveLength(3);
    expect(t.reg.encuadres.slice(-1)[0].opciones.paddingTopLeft[1]).toBeGreaterThanOrEqual(60);   // el pin sobresale por encima de su punta
  });

  test('sin vigente: dos marcadores (Irrigacion y propuesta); sin Irrigacion ni vigente: solo la propuesta, con vista fija', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(t.reg.marcadores.slice(-2).map((m) => m.latlng)).toEqual([[IRR.lat, IRR.lon], [P1.lat, P1.lon]]);
    expect(t.el('uval-detalle-datos').innerHTML).toContain('Ninguna: hoy rige la de Irrigación');
    const sinIrr = cargar({ pendientes: [propuesta('33333333-3333-4333-8333-333333333333', { irrigacion: { lat: null, lon: null, estado: 'sinCoordenadas' }, distanciaM: null })] });
    await abrirDetalleDesdeLista(sinIrr, '33333333-3333-4333-8333-333333333333');
    expect(sinIrr.reg.marcadores.length).toBeGreaterThan(0);
    sinIrr.reg.marcadores.forEach((m) => expect(m.latlng).toEqual([-33.3478, -69.1456]));     // solo la propuesta (el pin), nunca Irrigacion
    expect(sinIrr.reg.vistas.slice(-1)[0].z).toBe(17);
  });

  test('el mapa del detalle no toca el mapa provincial: solo usa el contenedor propio y las capas del mapa compartido', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(t.reg.mapas.map((m) => m.idContenedor)).toEqual(['uval-mapa']);
    expect(CODIGO).not.toMatch(/mapaPozos|mapaProvincial|overlay-correcciones|cercaMio|bandejaSeleccion|reemplazo/i);
  });

  test('con las advertencias de distancia: >1 km se muestra como alerta fuerte en el detalle', async () => {
    const lejos = propuesta('44444444-4444-4444-8444-444444444444', { distanciaM: 2400, advertenciaDistancia: true });
    const t = cargar({ pendientes: [lejos] });
    await abrirDetalleDesdeLista(t, lejos.correccionId);
    expect(t.el('uval-detalle-datos').innerHTML).toContain('Verificala con cuidado antes de validarla.');
  });

  test('si la vigente no se puede leer: aviso, y se puede decidir igual', async () => {
    const t = cargar({ leerPozo: () => Promise.reject(new Error('sin red')) });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(visible(t, 'uval-vigente-aviso')).toBe(true);
    expect(t.el('uval-vigente-aviso').textContent).toMatch(/No se pudo cargar la ubicación validada vigente/);
    expect(t.el('btn-uval-validar').disabled).toBe(false);
    expect(t.reg.marcadores.slice(-2).map((m) => m.latlng)).toEqual([[IRR.lat, IRR.lon], [P1.lat, P1.lon]]);
  });

  test('mientras se lee la vigente no se puede decidir (botones deshabilitados)', async () => {
    let resolver;
    const t = cargar({ leerPozo: () => new Promise((r) => { resolver = r; }) });
    await abrirBandeja(t);
    tocarRenglon(t, P1.correccionId);
    await flush();
    expect(t.el('btn-uval-validar').disabled).toBe(true);
    expect(t.el('btn-uval-rechazar').disabled).toBe(true);
    t.el('btn-uval-validar').emit('click');                 // aunque alguien fuerce el clic
    expect(visible(t, 'uval-confirmar-validar')).toBe(false);
    resolver({ status: 'ok', data: { vigente: null, pendientes: [P1], historial: [] } });
    await flush();
    expect(t.el('btn-uval-validar').disabled).toBe(false);
  });

  test('si la correccion ya no figura entre las pendientes del pozo: "Esta corrección ya fue resuelta." y se refresca todo', async () => {
    const t = cargar({ leerPozo: { status: 'ok', data: { vigente: VIGENTE, pendientes: [], historial: [] } } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(t.el('uval-aviso').textContent).toBe('Esta corrección ya fue resuelta.');
    expect(visible(t, 'uval-vista-lista')).toBe(true);
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Esta corrección ya fue resuelta.', tipo: 'resuelta' });
  });

  test('sesion vencida al leer la vigente: se cierra todo y se delega a la app', async () => {
    const t = cargar({ leerPozo: { status: 'error', code: 'UNAUTHORIZED' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('si el mapa no carga (sin red a Leaflet), el detalle sigue siendo utilizable', async () => {
    const t = cargar({ libreriasFallan: true });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    expect(visible(t, 'uval-mapa-error')).toBe(true);
    expect(visible(t, 'uval-mapa-cargando')).toBe(false);
    expect(t.el('btn-uval-validar').disabled).toBe(false);
    t.el('btn-uval-validar').click();
    expect(visible(t, 'uval-confirmar-validar')).toBe(true);
  });

  test('volver a la lista la vuelve a leer; los chips cambian la capa base del mapa', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.chips[1].click();
    expect(t.ctx.mapaShared_cambiarCapaBase).toHaveBeenCalledWith(expect.anything(), 'satelite', t.chips);
    const antes = t.ctx.apiGetCorreccionesUbicacionPendientes.mock.calls.length;
    t.el('btn-uval-detalle-volver').click();
    await flush();
    expect(visible(t, 'uval-vista-lista')).toBe(true);
    expect(t.ctx.apiGetCorreccionesUbicacionPendientes.mock.calls.length).toBe(antes + 1);
  });

  test('una propuesta PROPIA: se puede validar pero Rechazar no se ofrece', async () => {
    const propia = propuesta('55555555-5555-4555-8555-555555555555', { propia: true });
    const t = cargar({ pendientes: [propia] });
    await abrirDetalleDesdeLista(t, propia.correccionId);
    expect(t.el('btn-uval-rechazar').hidden).toBe(true);
    expect(t.el('btn-uval-validar').hidden).toBe(false);
  });
});

describe('validar: confirmacion y resultado', () => {
  test('Validar ubicacion pide confirmacion ("¿Validar esta ubicación?") y NO envia nada todavia', async () => {
    const t = cargar({ vigente: VIGENTE });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    expect(visible(t, 'uval-confirmar-validar')).toBe(true);
    expect(visible(t, 'uval-acciones')).toBe(false);
    expect(t.el('uval-confirmar-titulo').textContent).toBe('¿Validar esta ubicación?');
    const puntos = t.el('uval-confirmar-puntos').innerHTML;
    expect(puntos).toContain('Pasará a ser la ubicación validada vigente de este pozo.');
    expect(puntos).toContain('La ubicación validada anterior quedará reemplazada (estado SUPERADA).');
    expect(puntos).toContain('La ubicación de Irrigación NO se modifica ni se elimina.');
    expect(t.ctx.apiValidarCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('sin vigente previa la confirmacion no habla de reemplazo', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    expect(t.el('uval-confirmar-puntos').innerHTML).not.toContain('SUPERADA');
    expect(t.el('uval-confirmar-puntos').innerHTML).toContain('NO se modifica ni se elimina');
  });

  test('Cancelar vuelve a las acciones sin enviar nada', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-cancelar').click();
    expect(visible(t, 'uval-confirmar-validar')).toBe(false);
    expect(visible(t, 'uval-acciones')).toBe(true);
    expect(t.ctx.apiValidarCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('confirmar: envia token + id, muestra "Validando…", deshabilita todo y al terminar vuelve a la lista con el aviso', async () => {
    let resolver;
    const t = cargar({ validar: () => new Promise((r) => { resolver = r; }) });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledTimes(0);   // el envio sale en el turno siguiente
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledWith('tok-real', P1.correccionId);
    expect(visible(t, 'uval-estado')).toBe(true);
    expect(t.el('uval-estado').textContent).toBe('Validando…');
    ['btn-uval-validar-confirmar', 'btn-uval-validar-cancelar', 'btn-uval-detalle-volver', 'btn-uval-cerrar'].forEach((id) => expect(t.el(id).disabled).toBe(true));
    resolver({ status: 'ok', data: { correccion: Object.assign({}, P1, { estado: 'VALIDADA' }), supersedidas: [] } });
    await flush();
    expect(visible(t, 'uval-estado')).toBe(false);
    expect(t.el('uval-aviso').textContent).toBe('Ubicación validada.');
    expect(visible(t, 'uval-vista-lista')).toBe(true);
  });

  test('DOBLE TOQUE en "Sí, validar": una sola llamada al backend', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    t.el('btn-uval-validar-confirmar').emit('click');             // segundo toque aunque el boton ya este deshabilitado
    t.el('btn-uval-validar-confirmar').emit('click');
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledTimes(1);
    expect(t.srv.validadas).toEqual([P1.correccionId]);
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);               // y el resultado se procesa UNA vez (un solo refresco)
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledTimes(1);
  });

  test('despues de validar: la lista se refresca (sin la validada), el indicador y la ficha se avisan, SIN recargar la app', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    const antes = t.ctx.apiGetCorreccionesUbicacionPendientes.mock.calls.length;
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Ubicación validada.', tipo: 'ok' });
    expect(t.ctx.apiGetCorreccionesUbicacionPendientes.mock.calls.length).toBe(antes + 1);
    expect(t.el('uval-lista').innerHTML).not.toContain(P1.correccionId);
    expect(t.el('uval-lista').innerHTML).toContain(P2.correccionId);
    expect(t.ctx.ubicacionPendientesController_fijarTotal).toHaveBeenLastCalledWith(1);
    expect(visible(t, 'uval-overlay')).toBe(true);
  });

  test('al validar la ULTIMA pendiente: la lista queda vacia y el indicador se oculta (total 0)', async () => {
    const t = cargar({ pendientes: [P1] });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(visible(t, 'uval-lista-vacia')).toBe(true);
    expect(t.ctx.ubicacionPendientesController_fijarTotal).toHaveBeenLastCalledWith(0);
  });

  test('error del backend: se muestra el mensaje, el detalle queda abierto y se puede reintentar; no se avisa a nadie', async () => {
    let n = 0;
    const t = cargar({ validar: () => { n += 1; return Promise.resolve(n === 1 ? { status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'interno' } : { status: 'ok', data: { correccion: Object.assign({}, P1, { estado: 'VALIDADA' }), supersedidas: [] } }); } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.el('uval-error').textContent).toBe('No se pudo completar la operación. Intentá nuevamente.');
    expect(visible(t, 'uval-error')).toBe(true);
    expect(visible(t, 'uval-vista-detalle')).toBe(true);
    expect(t.el('btn-uval-validar-confirmar').disabled).toBe(false);
    expect(t.ctx.ubicacionPendientesController_alResolver).not.toHaveBeenCalled();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledTimes(2);
    expect(t.el('uval-aviso').textContent).toBe('Ubicación validada.');
  });

  test('sin conexion: "No se pudo completar. Revisá tu conexión e intentá de nuevo."', async () => {
    const t = cargar({ validar: () => Promise.reject(new Error('Failed to fetch')) });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.el('uval-error').textContent).toBe('No se pudo completar. Revisá tu conexión e intentá de nuevo.');
    expect(visible(t, 'uval-estado')).toBe(false);
  });

  test.each([['UNAUTHORIZED', 'onSessionExpired'], ['USER_DISABLED', 'onUserDisabled']])('%s al validar: se cierra todo y se delega a la app', async (code, gancho) => {
    const t = cargar({ validar: { status: 'error', code } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.sesion[gancho]).toHaveBeenCalledTimes(1);
    expect(t.ctx.ubicacionPendientesController_alResolver).not.toHaveBeenCalled();
  });

  test('propuesta ya resuelta por otra persona (INVALID_TRANSITION): "Esta corrección ya fue resuelta." y se refresca todo', async () => {
    const t = cargar({ validar: { status: 'error', code: 'INVALID_TRANSITION' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.el('uval-aviso').textContent).toBe('Esta corrección ya fue resuelta.');
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Esta corrección ya fue resuelta.', tipo: 'resuelta' });
    expect(visible(t, 'uval-vista-lista')).toBe(true);
  });

  test('cerrar (X, Cerrar, Escape) NO funciona mientras se esta enviando; despues si', async () => {
    let resolver;
    const t = cargar({ validar: () => new Promise((r) => { resolver = r; }) });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    t.el('btn-uval-cerrar').emit('click');
    t.el('uval-overlay').emit('keydown', { key: 'Escape' });
    t.el('btn-uval-detalle-volver').emit('click');
    expect(visible(t, 'uval-overlay')).toBe(true);
    resolver({ status: 'ok', data: { correccion: Object.assign({}, P1, { estado: 'VALIDADA' }), supersedidas: [] } });
    await flush();
    t.el('btn-uval-cerrar').click();
    expect(visible(t, 'uval-overlay')).toBe(false);
  });

  test('FAIL-CLOSED aunque se fuerce el DOM: si el permiso se pierde con la confirmacion abierta, no se envia nada', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.sesion.permisos = { ubicacion: true, ubicacion_validar: false };
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).not.toHaveBeenCalled();
    expect(t.el('uval-error').textContent).toBe('No tenés permiso para validar o rechazar correcciones.');
    expect(visible(t, 'uval-acciones')).toBe(false);
    expect(visible(t, 'uval-confirmar-validar')).toBe(false);
  });

  test('hacer clic en "Sí, validar" sin haber abierto ningun detalle no envia nada', async () => {
    const t = cargar();
    t.el('btn-uval-validar-confirmar').emit('click');
    t.el('btn-uval-rechazar-confirmar').emit('click');
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).not.toHaveBeenCalled();
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
  });
});

describe('rechazar: motivo obligatorio y resultado', () => {
  test('Rechazar abre el bloque del motivo (obligatorio) sin enviar nada', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    expect(visible(t, 'uval-rechazo')).toBe(true);
    expect(visible(t, 'uval-acciones')).toBe(false);
    expect(t.el('uval-motivo').enfocado).toBeGreaterThan(0);
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('Confirmar rechazo sin motivo (vacio o solo espacios): error en el campo y NO se envia nada', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    for (const v of ['', '   ', '\n']) {
      t.el('uval-motivo').value = v;
      t.el('btn-uval-rechazar-confirmar').click();
      await flush();
      expect(t.el('uval-err-motivo').textContent).toBe('Indicá el motivo del rechazo.');
      expect(visible(t, 'uval-err-motivo')).toBe(true);
    }
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('con motivo: envia token + id + motivo recortado, muestra "Rechazando…" y al terminar "Corrección rechazada."', async () => {
    let resolver;
    const t = cargar({ rechazar: () => new Promise((r) => { resolver = r; }) });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = '  El punto no coincide con la boca del pozo  ';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.ctx.apiRechazarCorreccionUbicacion).toHaveBeenCalledWith('tok-real', P1.correccionId, 'El punto no coincide con la boca del pozo');
    expect(t.el('uval-estado').textContent).toBe('Rechazando…');
    expect(t.el('uval-motivo').disabled).toBe(true);
    expect(t.el('btn-uval-rechazar-confirmar').disabled).toBe(true);
    resolver({ status: 'ok', data: { correccion: Object.assign({}, P1, { estado: 'RECHAZADA' }), supersedidas: [] } });
    await flush();
    expect(t.el('uval-aviso').textContent).toBe('Corrección rechazada.');
    expect(t.el('uval-motivo').disabled).toBe(false);
  });

  test('DOBLE TOQUE en "Confirmar rechazo": una sola llamada', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = 'No coincide';
    t.el('btn-uval-rechazar-confirmar').click();
    t.el('btn-uval-rechazar-confirmar').emit('click');
    await flush();
    expect(t.ctx.apiRechazarCorreccionUbicacion).toHaveBeenCalledTimes(1);
    expect(t.srv.rechazadas).toEqual([{ id: P1.correccionId, motivo: 'No coincide' }]);
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
  });

  test('despues de rechazar: sale de la cola, la vigente NO cambia (la rechazada nunca es vigente), indicador y ficha se avisan', async () => {
    const t = cargar({ vigente: VIGENTE });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = 'No coincide';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.srv.vigente).toBe(VIGENTE);
    expect(t.srv.validadas).toEqual([]);
    expect(t.el('uval-lista').innerHTML).not.toContain(P1.correccionId);
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Corrección rechazada.', tipo: 'ok' });
    expect(t.ctx.ubicacionPendientesController_fijarTotal).toHaveBeenLastCalledWith(1);
  });

  test('errores de rechazo: SELF_REJECTION y motivo invalido muestran el mensaje claro; el bloque queda abierto con el texto escrito', async () => {
    const t = cargar({ rechazar: { status: 'error', code: 'SELF_REJECTION' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = 'Motivo escrito';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.el('uval-error').textContent).toBe('No podés rechazar una corrección que propusiste vos.');
    expect(visible(t, 'uval-rechazo')).toBe(true);
    expect(t.el('uval-motivo').value).toBe('Motivo escrito');
  });

  test('propuesta ya resuelta al rechazar: "Esta corrección ya fue resuelta."', async () => {
    const t = cargar({ rechazar: { status: 'error', code: 'CORRECCION_NOT_FOUND' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = 'No coincide';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.el('uval-aviso').textContent).toBe('Esta corrección ya fue resuelta.');
  });

  test('sesion vencida al rechazar: se cierra todo y se delega a la app', async () => {
    const t = cargar({ rechazar: { status: 'error', code: 'UNAUTHORIZED' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('uval-motivo').value = 'No coincide';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(visible(t, 'uval-overlay')).toBe(false);
  });

  test('Cancelar el rechazo vuelve a las acciones, sin enviar y sin perder el detalle', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-rechazar').click();
    t.el('btn-uval-rechazar-cancelar').click();
    expect(visible(t, 'uval-rechazo')).toBe(false);
    expect(visible(t, 'uval-acciones')).toBe(true);
    expect(visible(t, 'uval-vista-detalle')).toBe(true);
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('forzar el DOM: rechazar una propuesta PROPIA no abre el motivo ni envia', async () => {
    const propia = propuesta('55555555-5555-4555-8555-555555555555', { propia: true });
    const t = cargar({ pendientes: [propia] });
    await abrirDetalleDesdeLista(t, propia.correccionId);
    t.el('btn-uval-rechazar').emit('click');
    expect(visible(t, 'uval-rechazo')).toBe(false);
    await flush();
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
  });
});

describe('desde la ficha del pozo: mismo detalle, misma confirmacion, mismo backend', () => {
  const abrirDesdeFicha = (t, extra) => t.ctx.ubicacionValidacionController_abrirDetalle(Object.assign({ correccion: P1, vigente: null, opener: { focus() {} } }, extra || {}));

  test('Validar de la tarjeta: abre el detalle con la confirmacion YA abierta, sin releer el pozo (la ficha ya tiene la vigente)', async () => {
    const t = cargar();
    abrirDesdeFicha(t, { vigente: VIGENTE, accion: 'validar' });
    await flush();
    expect(visible(t, 'uval-overlay')).toBe(true);
    expect(visible(t, 'uval-vista-detalle')).toBe(true);
    expect(visible(t, 'uval-confirmar-validar')).toBe(true);
    expect(t.el('uval-confirmar-puntos').innerHTML).toContain('SUPERADA');
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).not.toHaveBeenCalled();
    expect(t.ctx.apiGetCorreccionesUbicacionPendientes).not.toHaveBeenCalled();
    expect(t.el('btn-uval-detalle-volver').textContent).toBe('Cerrar');
    expect(t.reg.marcadores.slice(-3).map((m) => m.latlng)).toEqual([[IRR.lat, IRR.lon], [VIGENTE.lat, VIGENTE.lon], [P1.lat, P1.lon]]);
  });

  test('Rechazar de la tarjeta: abre el detalle con el motivo pedido', async () => {
    const t = cargar();
    abrirDesdeFicha(t, { accion: 'rechazar' });
    await flush();
    expect(visible(t, 'uval-rechazo')).toBe(true);
    expect(visible(t, 'uval-confirmar-validar')).toBe(false);
  });

  test('validar desde la ficha: mismo endpoint, se CIERRA el overlay y la ficha se actualiza (aviso + releer), el indicador tambien', async () => {
    const t = cargar();
    abrirDesdeFicha(t, { accion: 'validar' });
    await flush();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledWith('tok-real', P1.correccionId);
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Ubicación validada.', tipo: 'ok' });
    expect(t.ctx.ubicacionPendientesController_alResolver).toHaveBeenCalledTimes(1);
    expect(t.ctx.apiGetCorreccionesUbicacionPendientes).not.toHaveBeenCalled();     // no hay lista abierta que refrescar
  });

  test('rechazar desde la ficha: mismo endpoint y mismo motivo obligatorio', async () => {
    const t = cargar();
    abrirDesdeFicha(t, { accion: 'rechazar' });
    await flush();
    t.el('btn-uval-rechazar-confirmar').click();
    expect(t.ctx.apiRechazarCorreccionUbicacion).not.toHaveBeenCalled();
    t.el('uval-motivo').value = 'Fuera del predio';
    t.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(t.ctx.apiRechazarCorreccionUbicacion).toHaveBeenCalledWith('tok-real', P1.correccionId, 'Fuera del predio');
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Corrección rechazada.', tipo: 'ok' });
  });

  test('ya resuelta (otra persona): se cierra, la ficha se refresca con el aviso', async () => {
    const t = cargar({ validar: { status: 'error', code: 'INVALID_TRANSITION' } });
    abrirDesdeFicha(t, { accion: 'validar' });
    await flush();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(t.ctx.ubicacionCorreccionController_alResolver).toHaveBeenCalledWith({ wellId: '14-0001', mensaje: 'Esta corrección ya fue resuelta.', tipo: 'resuelta' });
  });

  test('FAIL-CLOSED: sin permisos no se abre el detalle; una correccion que no esta PROPUESTA tampoco', async () => {
    const sin = cargar({ permisos: { ubicacion: true, ubicacion_corregir: true } });
    abrirDesdeFicha(sin, { accion: 'validar' });
    expect(visible(sin, 'uval-overlay')).toBe(false);
    const t = cargar();
    abrirDesdeFicha(t, { correccion: VIGENTE, accion: 'validar' });
    abrirDesdeFicha(t, { correccion: null });
    abrirDesdeFicha(t, { correccion: { estado: 'PROPUESTA' } });
    expect(visible(t, 'uval-overlay')).toBe(false);
    t.ctx.ubicacionValidacionController_abrirDetalle();
    expect(visible(t, 'uval-overlay')).toBe(false);
  });

  test('cerrar el detalle de la ficha devuelve el foco a la tarjeta', async () => {
    const opener = { focus: jest.fn() };
    const t = cargar();
    abrirDesdeFicha(t, { opener: opener });
    await flush();
    t.el('btn-uval-detalle-volver').click();
    expect(visible(t, 'uval-overlay')).toBe(false);
    expect(opener.focus).toHaveBeenCalledTimes(1);
  });

  test('logout (cerrar): cierra todo y una respuesta tardia no hace nada', async () => {
    let resolver;
    const t = cargar({ validar: () => new Promise((r) => { resolver = r; }) });
    abrirDesdeFicha(t, { accion: 'validar' });
    await flush();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    t.ctx.ubicacionValidacionController_cerrar();
    expect(visible(t, 'uval-overlay')).toBe(false);
    resolver({ status: 'ok', data: { correccion: Object.assign({}, P1, { estado: 'VALIDADA' }), supersedidas: [] } });
    await flush();
    expect(t.ctx.ubicacionCorreccionController_alResolver).not.toHaveBeenCalled();
    expect(visible(t, 'uval-overlay')).toBe(false);
  });
});

describe('el mapa vuelve a pedir las ubicaciones validadas cuando cambia la vigente', () => {
  test('validar invalida SOLO la capa de campo del mapa (ni la registral ni la generica); rechazar NO', async () => {
    const t = cargar();
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.mapaDataset_invalidarDeltaCampo).toHaveBeenCalledTimes(1);
    expect(t.ctx.mapaDataset_invalidarDeltaRegistral).not.toHaveBeenCalled();
    expect(t.ctx.mapaDataset_invalidarDeltas).not.toHaveBeenCalled();

    const r = cargar();
    await abrirDetalleDesdeLista(r, P1.correccionId);
    r.el('btn-uval-rechazar').click();
    r.el('uval-motivo').value = 'No coincide';
    r.el('btn-uval-rechazar-confirmar').click();
    await flush();
    expect(r.ctx.mapaDataset_invalidarDeltaCampo).not.toHaveBeenCalled();
    expect(r.ctx.mapaDataset_invalidarDeltaRegistral).not.toHaveBeenCalled();
    expect(r.ctx.mapaDataset_invalidarDeltas).not.toHaveBeenCalled();
  });

  test('"ya resuelta" por otra persona tambien invalida (no sabemos como se resolvio); desde la ficha igual', async () => {
    const t = cargar({ validar: { status: 'error', code: 'INVALID_TRANSITION' } });
    t.ctx.ubicacionValidacionController_abrirDetalle({ correccion: P1, vigente: null, accion: 'validar', opener: { focus() {} } });
    await flush();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.mapaDataset_invalidarDeltaCampo).toHaveBeenCalledTimes(1);
    expect(t.ctx.mapaDataset_invalidarDeltaRegistral).not.toHaveBeenCalled();
  });

  test('un error del backend o de conexion NO invalida (no cambio nada); sin la funcion del mapa cargada no rompe', async () => {
    const t = cargar({ validar: { status: 'error', code: 'SERVICE_UNAVAILABLE' } });
    await abrirDetalleDesdeLista(t, P1.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.mapaDataset_invalidarDeltaCampo).not.toHaveBeenCalled();
    const s = cargar();
    delete s.ctx.mapaDataset_invalidarDeltaCampo;
    await abrirDetalleDesdeLista(s, P1.correccionId);
    s.el('btn-uval-validar').click();
    s.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(s.srv.validadas).toEqual([P1.correccionId]);
  });
});

describe('lo que el modulo NO toca', () => {
  test('el controlador no usa los modulos de Mapa de pozos, Cerca Mio, seleccion, reemplazos ni NE', () => {
    expect(CODIGO).not.toMatch(/mapaPozos|cercaMio|seleccionGeografica|bandejaSeleccion|reemplazo|nivelEstatico|ubicacionOverlay|mapaPozosOverlay/i);
  });

  test('solo llama a los endpoints existentes (listar, leer el pozo, validar, rechazar): ninguna otra API', () => {
    const llamadas = Array.from(new Set(CODIGO.match(/api[A-Z][A-Za-z]+/g)));
    expect(llamadas.sort()).toEqual(['apiGetCorreccionesUbicacionPendientes', 'apiGetCorreccionesUbicacionPozo', 'apiRechazarCorreccionUbicacion', 'apiValidarCorreccionUbicacion']);
  });
});

// ---------------------------------------------------------------------------------------------------------------- E4-3: marca de primera ubicacion en la bandeja
// candidataPrimeraUbicacion (solo pendientes) -> "Primera ubicación conocida del pozo". El frontend solo pinta lo que manda el backend: si una se valida, la cola refrescada trae la otra sin la marca.
describe('E4-3: bandeja y detalle rotulan la primera ubicacion candidata', () => {
  const CANDIDATA = 'Primera ubicación conocida del pozo';
  const candidata = (id, extra) => propuesta(id, Object.assign({
    wellId: '14-0123', distanciaM: null, irrigacion: { lat: null, lon: null, estado: 'noEnPadron' }, candidataPrimeraUbicacion: true, primeraUbicacion: false
  }, extra || {}));
  const A = candidata('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const B = candidata('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', { nombrePropone: 'Beto Gómez' });
  const cola = (...items) => ({ status: 'ok', data: { total: items.length, inconsistentes: 0, pendientes: items } });
  const cuenta = (h, texto) => h.split(texto).length - 1;

  test('pendiente candidata=true: el renglon dice "Primera ubicación conocida del pozo"; una candidata=false mantiene el copy normal', async () => {
    const t = cargar({ listar: cola(A, propuesta('cccccccc-cccc-4ccc-8ccc-cccccccccccc', { nombrePropone: 'Carla Díaz' })) });
    await abrirBandeja(t);
    const html = t.el('uval-lista').innerHTML;
    expect(cuenta(html, CANDIDATA)).toBe(1);
    const renglonA = html.split('<li').filter((x) => x.indexOf(A.correccionId) !== -1)[0];
    const renglonC = html.split('<li').filter((x) => x.indexOf('Carla Díaz') !== -1)[0];
    expect(renglonA).toContain(CANDIDATA);
    expect(renglonA).not.toContain('Primera ubicación validada');
    expect(renglonC).not.toContain('Primera ubicación');
    expect(renglonC).toContain('A 22,2 m de la ubicación de Irrigación');
  });

  test('DOS pendientes candidatas a la vez: ambas marcadas', async () => {
    const t = cargar({ listar: cola(A, B) });
    await abrirBandeja(t);
    expect(cuenta(t.el('uval-lista').innerHTML, CANDIDATA)).toBe(2);
  });

  test('la accion sigue siendo validar / rechazar segun permisos: el renglon abre el detalle, que repite el rotulo y explica por que no hay Irrigacion', async () => {
    const t = cargar({ pendientes: [A, B], listar: cola(A, B) });
    await abrirDetalleDesdeLista(t, A.correccionId);
    const detalle = t.el('uval-detalle-datos').innerHTML;
    expect(detalle).toContain(CANDIDATA);
    expect(detalle).toContain('Este pozo no figura en el padrón actual.');
    expect(detalle).not.toContain('para comparar');
    expect(visible(t, 'uval-acciones')).toBe(true);
    expect(t.el('btn-uval-validar').hidden).toBe(false);
  });

  test('si una se valida y la cola se refresca, la otra YA NO se muestra candidata (el frontend no resuelve la competencia: pinta lo que llega)', async () => {
    let lecturas = 0;
    const t = cargar({
      pendientes: [A, B],
      listar: () => {
        lecturas += 1;
        return Promise.resolve(lecturas === 1 ? cola(A, B) : cola(Object.assign({}, B, { candidataPrimeraUbicacion: false })));
      }
    });
    await abrirDetalleDesdeLista(t, A.correccionId);
    t.el('btn-uval-validar').click();
    t.el('btn-uval-validar-confirmar').click();
    await flush();
    expect(t.ctx.apiValidarCorreccionUbicacion).toHaveBeenCalledWith('tok-real', A.correccionId);
    expect(lecturas).toBeGreaterThanOrEqual(2);
    const html = t.el('uval-lista').innerHTML;
    expect(html).toContain('Beto Gómez');
    expect(html).not.toContain(CANDIDATA);
    expect(html).not.toContain('Primera ubicación');
  });

  test('backend sin las marcas: la bandeja se pinta como siempre, sin ninguna marca ni error', async () => {
    const sinMarcas = (c) => { const x = Object.assign({}, c); delete x.candidataPrimeraUbicacion; delete x.primeraUbicacion; return x; };
    const t = cargar({ listar: cola(sinMarcas(A), sinMarcas(B)) });
    await abrirBandeja(t);
    const html = t.el('uval-lista').innerHTML;
    expect(html).not.toContain('Primera ubicación');
    expect(html).toContain('Beto Gómez');
    expect(html).toContain('Revisar ›');
  });
});
