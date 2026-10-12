// Controlador DOM de las correcciones de ubicacion (js/ubicacionCorreccion.js) ejecutado de verdad, sin navegador: un DOM minimo falso,
// geolocation y Leaflet simulados y las llamadas a la API como jest.fn(). Verifica el comportamiento observable: boton segun permisos, GPS
// (>50 m bloquea), punto en el mapa (Irrigacion fija, solo el punto nuevo se mueve), observacion obligatoria, advertencia de 1 km, doble click,
// retry con el mismo clientRequestId, resultado segun el backend y refresco posterior con getCorreccionesUbicacionPozo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fuenteLogica = fs.readFileSync(path.join(__dirname, 'ubicacionCorreccionLogic.js'), 'utf8');
const fuenteControlador = fs.readFileSync(path.join(__dirname, 'ubicacionCorreccion.js'), 'utf8');
const htmlIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
// Estado inicial real: los ids que en index.html nacen con el atributo hidden (el DOM falso los respeta, asi las pruebas parten del HTML verdadero).
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });

const W = '14-0001';
const IRR = { lat: -33.34765, lon: -69.14545 };
const PUNTO_REAL = { lat: -33.34745, lon: -69.14545 };
const LOCATION = { wellId: W, ubicacionResuelta: { estado: 'unica', fuente: 'reportePozos', lat: IRR.lat, lon: IRR.lon } };
const LOCATION_SIN = { wellId: W, ubicacionResuelta: { estado: 'sinCoordenadas' } };
const VIGENTE = {
  correccionId: '618615f2-3f2b-4a8d-ae3c-1ebd49041190', wellId: W, lat: PUNTO_REAL.lat, lon: PUNTO_REAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null,
  observacion: '', nombrePropone: 'Federico Albrieu', timestamp: new Date(2026, 9, 12, 14, 5).toISOString(), distanciaM: 22.2, advertenciaDistancia: false,
  irrigacion: { lat: IRR.lat, lon: IRR.lon, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' }, estado: 'VALIDADA',
  resolucion: { evento: 'VALIDADA', nombre: 'Federico Albrieu', timestamp: new Date(2026, 9, 12, 14, 5).toISOString(), motivo: '' }, propia: true
};
const PENDIENTE = Object.assign({}, VIGENTE, { correccionId: '22222222-2222-4222-8222-222222222222', estado: 'PROPUESTA', resolucion: null, nombrePropone: 'Ana Pérez', lat: -33.3478, lon: -69.1456 });
const LECTURA_VACIA = { vigente: null, pendientes: [], historial: [] };
const LECTURA_VIGENTE = { vigente: VIGENTE, pendientes: [], historial: [VIGENTE] };

const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

// ---------------------------------------------------------------------------------------------------------------- DOM falso
function crearElemento(id) {
  const e = {
    id: id, hidden: false, disabled: false, value: '', textContent: '', className: '', scrollTop: 0, listeners: {}, atributos: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(tipo, f) { (e.listeners[tipo] = e.listeners[tipo] || []).push(f); },
    emit(tipo, ev) { (e.listeners[tipo] || []).forEach((f) => f(ev || {})); },
    click() { if (!e.disabled) { e.emit('click'); } },
    focus() { e.enfocado = true; },
    scrollIntoView() { e.scrolled = true; },
    getAttribute(n) { return e.atributos[n] === undefined ? null : e.atributos[n]; },
    setAttribute(n, v) { e.atributos[n] = v; }
  };
  return e;
}

function crearEntorno(opc) {
  const o = opc || {};
  const estaticos = {};
  const dinamicos = {};
  const volverBtns = [crearElemento('volver-1'), crearElemento('volver-2')];
  const chips = [Object.assign(crearElemento('chip-calle'), { atributos: { 'data-capa': 'calle' } }), Object.assign(crearElemento('chip-sat'), { atributos: { 'data-capa': 'satelite' } })];
  const contenedor = crearElemento('ubic-correcciones');
  let html = '';
  Object.defineProperty(contenedor, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); Object.keys(dinamicos).forEach((k) => { delete dinamicos[k]; }); }
  });
  const DINAMICOS = ['btn-ubic-corr-abrir', 'btn-ubic-corr-recargar', 'btn-ucorr-reintentar-lectura'];
  const cuerpo = { classList: { add() {}, remove() {} }, contains: () => true };
  const documento = {
    body: cuerpo,
    getElementById(id) {
      if (id === 'ubic-correcciones') { return o.sinContenedor ? null : contenedor; }
      if (DINAMICOS.indexOf(id) !== -1) {
        if (html.indexOf('id="' + id + '"') === -1) { return null; }
        dinamicos[id] = dinamicos[id] || crearElemento(id);
        return dinamicos[id];
      }
      if (!estaticos[id]) {
        estaticos[id] = crearElemento(id);
        estaticos[id].hidden = OCULTOS_INICIAL.has(id);
      }
      return estaticos[id];
    },
    querySelectorAll(sel) {
      if (sel === '.btn-ucorr-volver-opciones') { return volverBtns; }
      if (sel === '.ucorr-capa-chip') { return chips; }
      return [];
    }
  };
  return { documento, estaticos, dinamicos, contenedor, volverBtns, chips, el: (id) => documento.getElementById(id) };
}

// ---------------------------------------------------------------------------------------------------------------- Leaflet falso
function crearLeafletFalso() {
  const reg = { mapas: [], marcadores: [], vistas: [] };
  const L = {
    map() {
      const m = {
        handlers: {}, setView(c, z) { reg.vistas.push({ c: c, z: z }); return m; }, on(t, f) { m.handlers[t] = f; return m; }, removeLayer() {}, invalidateSize() {}, addLayer() {}
      };
      reg.mapas.push(m);
      return m;
    },
    layerGroup() { const g = { capas: [], clearLayers() { g.capas = []; }, addTo() { return g; } }; return g; },
    divIcon(o) { return { divIcon: o }; },
    marker(latlng, opciones) {
      const mk = {
        latlng: latlng, opciones: opciones, handlers: {},
        addTo(destino) { if (destino && destino.capas) { destino.capas.push(mk); } mk.destino = destino; return mk; },
        on(t, f) { mk.handlers[t] = f; return mk; },
        setLatLng(ll) { mk.latlng = ll; return mk; },
        getLatLng() { return { lat: mk.latlng[0], lng: mk.latlng[1] }; }
      };
      reg.marcadores.push(mk);
      return mk;
    }
  };
  return { L, reg };
}

// ---------------------------------------------------------------------------------------------------------------- carga del controlador
function cargar(opc) {
  const o = opc || {};
  const entorno = crearEntorno(o);
  const { L, reg } = crearLeafletFalso();
  const geo = { llamadas: [], getCurrentPosition: jest.fn((ok, err, opts) => { geo.llamadas.push({ ok: ok, err: err, opts: opts }); }) };
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, Error, isFinite, parseInt, parseFloat, setTimeout });
  ctx.window = ctx;
  ctx.document = entorno.documento;
  ctx.navigator = o.sinGeolocation ? {} : { geolocation: geo };
  ctx.L = L;
  ctx.MAPA_CAPA_BASE_DEFAULT = 'calle';
  ctx.cargando_html = (t) => '<div class="cargando">' + t + '</div>';
  ctx.mapaShared_cargarLibrerias = jest.fn(() => (o.libreriasFallan ? Promise.reject(new Error('sin red')) : Promise.resolve()));
  ctx.mapaShared_crearCapasBase = jest.fn(() => ({ calle: {}, satelite: {} }));
  ctx.mapaShared_alMostrarMapa = jest.fn((mapa, cb) => cb());
  ctx.mapaShared_cambiarCapaBase = jest.fn();
  ctx.mapaShared_iconoPuntoBusqueda = jest.fn(() => ({ pin: true }));
  const orden = [];
  ctx.apiGetCorreccionesUbicacionPozo = jest.fn((token, wellId) => {
    orden.push('leer');
    return o.leer ? o.leer(token, wellId) : Promise.resolve({ status: 'ok', data: o.lectura || LECTURA_VACIA });
  });
  ctx.apiProponerCorreccionUbicacion = jest.fn((token, datos) => {
    orden.push('proponer');
    return o.proponer ? o.proponer(datos) : Promise.resolve({ status: 'ok', data: { correccion: VIGENTE, duplicada: false, curada: false, autoValidada: true } });
  });
  vm.runInContext(fuenteLogica, ctx);
  vm.runInContext(fuenteControlador, ctx);
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { ubicacion: true, ubicacion_corregir: true }, onSessionExpired: jest.fn() };
  ctx.ubicacionCorreccionController_inicializar(() => sesion);
  return Object.assign({ ctx, geo, reg, orden, sesion }, entorno);
}

// pos de la Geolocation API
const posicion = (lat, lon, accuracy) => ({ coords: { latitude: lat, longitude: lon, accuracy: accuracy } });

async function abrirFicha(t, location) {
  t.ctx.ubicacionCorreccionController_abrir({ wellId: W, location: location || LOCATION });
  await flush();
}

async function abrirModalGps(t, accuracy) {
  await abrirFicha(t);
  t.el('btn-ubic-corr-abrir').click();
  t.el('btn-ucorr-gps').click();
  t.geo.llamadas[t.geo.llamadas.length - 1].ok(posicion(PUNTO_REAL.lat, PUNTO_REAL.lon, accuracy));
}

async function abrirModalMapa(t, location) {
  await abrirFicha(t, location);
  t.el('btn-ubic-corr-abrir').click();
  t.el('btn-ucorr-mapa').click();
  await flush();
}

const tocarMapa = (t, lat, lon) => t.reg.mapas[0].handlers.click({ latlng: { lat: lat, lng: lon } });

describe('seccion de la ficha: lectura y boton segun permisos', () => {
  test('al abrir muestra el cargando existente y luego pinta desde getCorreccionesUbicacionPozo (con el token y el pozo)', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    t.ctx.ubicacionCorreccionController_abrir({ wellId: W, location: LOCATION });
    expect(t.contenedor.innerHTML).toContain('class="cargando"');
    expect(t.contenedor.innerHTML).toContain('Cargando correcciones…');
    await flush();
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenCalledWith('tok-real', W);
    expect(t.contenedor.innerHTML).toContain('Validada en campo');
    expect(t.contenedor.innerHTML).toContain('Federico Albrieu');
  });

  test('sin correcciones: estado vacio', async () => {
    const t = cargar();
    await abrirFicha(t);
    expect(t.contenedor.innerHTML).toContain('Todavía no hay correcciones de ubicación para este pozo.');
  });

  test('permiso ubicacion + ubicacion_corregir: el boton "Corregir ubicacion" existe', async () => {
    const t = cargar();
    await abrirFicha(t);
    expect(t.el('btn-ubic-corr-abrir')).not.toBeNull();
    expect(t.contenedor.innerHTML).toContain('Corregir ubicación');
  });

  test.each([
    ['solo ubicacion', { ubicacion: true }],
    ['corregir sin ubicacion', { ubicacion_corregir: true }],
    ['solo validar', { ubicacion: true, ubicacion_validar: true }],
    ['corregir como "SI"', { ubicacion: true, ubicacion_corregir: 'SI' }],
    ['sin permisos', {}]
  ])('%s: el boton NO existe (ni deshabilitado)', async (n, permisos) => {
    const t = cargar({ permisos });
    await abrirFicha(t);
    expect(t.el('btn-ubic-corr-abrir')).toBeNull();
    expect(t.contenedor.innerHTML).not.toContain('Corregir ubicación</button>');
    expect(t.contenedor.innerHTML).not.toContain('disabled');
    expect(t.contenedor.innerHTML).toContain('Ubicación corregida');          // igual ve las correcciones
  });

  test('error de lectura: mensaje en contexto y boton Reintentar que vuelve a leer', async () => {
    let falla = true;
    const t = cargar({ leer: () => (falla ? Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) : Promise.resolve({ status: 'ok', data: LECTURA_VIGENTE })) });
    await abrirFicha(t);
    expect(t.contenedor.innerHTML).toContain('No se pudieron cargar las correcciones. Intentá nuevamente.');
    falla = false;
    t.el('btn-ucorr-reintentar-lectura').click();
    await flush();
    expect(t.contenedor.innerHTML).toContain('Validada en campo');
  });

  test('error de red al leer: mensaje y reintento', async () => {
    const t = cargar({ leer: () => Promise.reject(new Error('Failed to fetch')) });
    await abrirFicha(t);
    expect(t.contenedor.innerHTML).toContain('No se pudieron cargar las correcciones. Revisá tu conexión');
    expect(t.contenedor.innerHTML).toContain('btn-ucorr-reintentar-lectura');
  });

  test('sesion vencida al leer: avisa a la app (cierra sesion) en vez de mostrar un error', async () => {
    const t = cargar({ leer: () => Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' }) });
    await abrirFicha(t);
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('una respuesta tardia de un pozo anterior no pisa la ficha actual', async () => {
    let resolverPrimera;
    let n = 0;
    const t = cargar({ leer: () => { n += 1; return n === 1 ? new Promise((r) => { resolverPrimera = r; }) : Promise.resolve({ status: 'ok', data: LECTURA_VIGENTE }); } });
    t.ctx.ubicacionCorreccionController_abrir({ wellId: '01-0001', location: LOCATION });
    t.ctx.ubicacionCorreccionController_abrir({ wellId: W, location: LOCATION });
    await flush();
    resolverPrimera({ status: 'ok', data: { vigente: null, pendientes: [PENDIENTE], historial: [] } });
    await flush();
    expect(t.contenedor.innerHTML).toContain('Validada en campo');
    expect(t.contenedor.innerHTML).not.toContain('Ana Pérez');
  });

  test('sin contenedor en el DOM no rompe', async () => {
    const t = cargar({ sinContenedor: true });
    expect(() => t.ctx.ubicacionCorreccionController_abrir({ wellId: W, location: LOCATION })).not.toThrow();
    await flush();
  });
});

describe('estado inicial segun el index.html real', () => {
  test('el modal y todas las vistas salvo "opciones" nacen ocultas; las opciones no', () => {
    ['ucorr-overlay', 'ucorr-vista-gps', 'ucorr-vista-mapa', 'ucorr-vista-confirmar', 'ucorr-mapa', 'ucorr-gps-resultado', 'btn-ucorr-gps-continuar'].forEach((id) => {
      expect(OCULTOS_INICIAL.has(id)).toBe(true);
    });
    expect(OCULTOS_INICIAL.has('ucorr-vista-opciones')).toBe(false);
    expect(OCULTOS_INICIAL.size).toBeGreaterThan(10);
  });
});

describe('usuario solo lector (ubicacion=SI, sin ubicacion_corregir) en un pozo SIN coordenada de Irrigacion', () => {
  test('ve la correccion vigente y su historial, pero no existe el boton de corregir', async () => {
    const t = cargar({ permisos: { ubicacion: true }, lectura: LECTURA_VIGENTE });
    await abrirFicha(t, LOCATION_SIN);
    expect(t.contenedor.innerHTML).toContain('Validada en campo');
    expect(t.contenedor.innerHTML).toContain('-33.34745, -69.14545');
    expect(t.contenedor.innerHTML).toContain('Historial de correcciones');
    expect(t.el('btn-ubic-corr-abrir')).toBeNull();
    expect(t.contenedor.innerHTML).not.toContain('Corregir ubicación</button>');
    expect(t.el('ucorr-overlay').hidden).toBe(true);
  });

  test('con solo pendientes tambien las ve (todas) y sin boton', async () => {
    const otra = Object.assign({}, PENDIENTE, { correccionId: '33333333-3333-4333-8333-333333333333', nombrePropone: 'Beto' });
    const t = cargar({ permisos: { ubicacion: true }, lectura: { vigente: null, pendientes: [PENDIENTE, otra], historial: [PENDIENTE, otra] } });
    await abrirFicha(t, LOCATION_SIN);
    expect(t.contenedor.innerHTML).toContain('Corrección pendiente de validación (2)');
    expect(t.el('btn-ubic-corr-abrir')).toBeNull();
  });
});

describe('modal: abrir, Irrigacion visible y cierre', () => {
  test('abre con las dos opciones y SIEMPRE muestra la coordenada de Irrigacion (no se modifica)', async () => {
    const t = cargar();
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    expect(t.el('ucorr-vista-opciones').hidden).toBe(false);
    expect(t.el('ucorr-irrigacion').textContent).toBe('Ubicación de Irrigación (no se modifica): -33.34765, -69.14545');
  });

  test('sin ubicacion de Irrigacion lo dice (y se puede corregir igual)', async () => {
    const t = cargar();
    await abrirFicha(t, LOCATION_SIN);
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('ucorr-irrigacion').textContent).toBe('Este pozo no tiene una ubicación de Irrigación para comparar.');
    expect(t.el('ucorr-overlay').hidden).toBe(false);
  });

  test('cerrar (boton y Escape) oculta el modal y devuelve el foco al boton que lo abrio', async () => {
    const t = cargar();
    await abrirFicha(t);
    const abrir = t.el('btn-ubic-corr-abrir');
    abrir.click();
    t.el('btn-ucorr-cerrar').click();
    expect(t.el('ucorr-overlay').hidden).toBe(true);
    expect(abrir.enfocado).toBe(true);
    abrir.click();
    t.el('ucorr-overlay').emit('keydown', { key: 'Escape' });
    expect(t.el('ucorr-overlay').hidden).toBe(true);
  });

  test('si en el momento de abrir ya no hay permiso, no abre', async () => {
    const t = cargar();
    await abrirFicha(t);
    const abrir = t.el('btn-ubic-corr-abrir');
    t.sesion.permisos = { ubicacion: true, ubicacion_corregir: false };
    abrir.click();
    expect(t.el('ucorr-overlay').hidden).toBe(true);                   // sigue cerrado
    expect(t.el('ucorr-irrigacion').textContent).toBe('');
  });
});

describe('A. GPS', () => {
  test('pide alta precision, sin cache, con timeout', async () => {
    const t = cargar();
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    t.el('btn-ucorr-gps').click();
    expect(t.geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(t.geo.llamadas[0].opts).toEqual({ enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    expect(t.el('ucorr-vista-gps').hidden).toBe(false);
    expect(t.el('ucorr-gps-cargando').hidden).toBe(false);
  });

  test('precision > 50 m: muestra el aviso, NO deja continuar y ofrece "Intentar nuevamente"', async () => {
    const t = cargar();
    await abrirModalGps(t, 73);
    expect(t.el('ucorr-gps-coord').textContent).toBe('-33.34745, -69.14545');
    expect(t.el('ucorr-gps-precision').textContent).toBe('± 73 m');
    expect(t.el('ucorr-gps-mensaje').hidden).toBe(false);
    expect(t.el('ucorr-gps-mensaje').textContent).toBe('La precisión actual es de 73 m. Necesitamos 50 m o menos para guardar.');
    expect(t.el('btn-ucorr-gps-continuar').hidden).toBe(true);
    expect(t.el('btn-ucorr-gps-reintentar').hidden).toBe(false);
    t.el('btn-ucorr-gps-continuar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);           // aunque se fuerce el click, no avanza
    expect(t.ctx.apiProponerCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test.each([[0], [-3], [NaN], [undefined]])('accuracy invalida (%p): no se puede guardar', async (acc) => {
    const t = cargar();
    await abrirModalGps(t, acc);
    expect(t.el('btn-ucorr-gps-continuar').hidden).toBe(true);
    expect(t.el('ucorr-gps-mensaje').textContent).toMatch(/No pudimos medir la precisión/);
    expect(t.el('ucorr-gps-precision').textContent).toBe('sin dato');
  });

  test('"Intentar nuevamente" vuelve a pedir la posicion; una medicion buena habilita Continuar', async () => {
    const t = cargar();
    await abrirModalGps(t, 73);
    t.el('btn-ucorr-gps-reintentar').click();
    expect(t.geo.getCurrentPosition).toHaveBeenCalledTimes(2);
    t.geo.llamadas[1].ok(posicion(PUNTO_REAL.lat, PUNTO_REAL.lon, 12));
    expect(t.el('btn-ucorr-gps-continuar').hidden).toBe(false);
    expect(t.el('ucorr-gps-mensaje').hidden).toBe(true);
    expect(t.el('ucorr-gps-precision').textContent).toBe('± 12 m');
  });

  test('una medicion tardia de un intento anterior se descarta', async () => {
    const t = cargar();
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    t.el('btn-ucorr-gps').click();
    t.el('btn-ucorr-gps').click();
    t.geo.llamadas[0].ok(posicion(1, 1, 5));                     // vieja: se ignora
    expect(t.el('ucorr-gps-resultado').hidden).toBe(true);
    t.geo.llamadas[1].ok(posicion(PUNTO_REAL.lat, PUNTO_REAL.lon, 8));
    expect(t.el('ucorr-gps-coord').textContent).toBe('-33.34745, -69.14545');
  });

  test('permiso de ubicacion denegado / timeout / sin geolocation: mensajes claros', async () => {
    const denegado = cargar();
    await abrirFicha(denegado);
    denegado.el('btn-ubic-corr-abrir').click();
    denegado.el('btn-ucorr-gps').click();
    denegado.geo.llamadas[0].err({ code: 1 });
    expect(denegado.el('ucorr-gps-mensaje').textContent).toMatch(/acceso a la ubicación/);
    expect(denegado.el('btn-ucorr-gps-reintentar').hidden).toBe(false);
    const timeout = cargar();
    await abrirFicha(timeout);
    timeout.el('btn-ubic-corr-abrir').click();
    timeout.el('btn-ucorr-gps').click();
    timeout.geo.llamadas[0].err({ code: 3 });
    expect(timeout.el('ucorr-gps-mensaje').textContent).toMatch(/tardó demasiado/);
    const sin = cargar({ sinGeolocation: true });
    await abrirFicha(sin);
    sin.el('btn-ubic-corr-abrir').click();
    sin.el('btn-ucorr-gps').click();
    expect(sin.el('ucorr-gps-mensaje').textContent).toMatch(/no permite obtener la ubicación/);
  });

  test('GPS valido -> confirmar -> guardar: manda metodo GPS_ACTUAL con precisionGpsM', async () => {
    const t = cargar();
    await abrirModalGps(t, 9.46);
    t.el('btn-ucorr-gps-continuar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(false);
    expect(t.el('ucorr-resumen').textContent).toBe('GPS · -33.34745, -69.14545 (± 9,5 m)');
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    const [token, datos] = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0];
    expect(token).toBe('tok-real');
    expect(datos).toMatchObject({ wellId: W, lat: -33.34745, lon: -69.14545, metodo: 'GPS_ACTUAL', precisionGpsM: 9.5, observacion: '' });
  });
});

describe('B. Punto en el mapa', () => {
  test('carga Leaflet con el helper compartido y centra en la VIGENTE; Irrigacion es un marcador fijo no interactivo', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    await abrirModalMapa(t);
    expect(t.ctx.mapaShared_cargarLibrerias).toHaveBeenCalled();
    expect(t.el('ucorr-mapa').hidden).toBe(false);
    expect(t.reg.vistas[t.reg.vistas.length - 1]).toEqual({ c: [PUNTO_REAL.lat, PUNTO_REAL.lon], z: 17 });
    const irr = t.reg.marcadores.find((m) => JSON.stringify(m.opciones.icon).indexOf('ucorr-marker-irr') !== -1);
    const vig = t.reg.marcadores.find((m) => JSON.stringify(m.opciones.icon).indexOf('ucorr-marker-vig') !== -1);
    expect(irr.latlng).toEqual([IRR.lat, IRR.lon]);
    expect(irr.opciones.interactive).toBe(false);
    expect(irr.opciones.draggable).toBeUndefined();
    expect(vig.latlng).toEqual([PUNTO_REAL.lat, PUNTO_REAL.lon]);
    expect(vig.opciones.interactive).toBe(false);
    expect(JSON.stringify(irr.opciones.icon)).toContain('Irrigación');
  });

  test('sin vigente centra en Irrigacion; sin ninguna, vista general de Mendoza y se intenta el dispositivo', async () => {
    const a = cargar();
    await abrirModalMapa(a);
    expect(a.reg.vistas[a.reg.vistas.length - 1]).toEqual({ c: [IRR.lat, IRR.lon], z: 17 });
    const b = cargar();
    await abrirModalMapa(b, LOCATION_SIN);
    expect(b.reg.vistas[b.reg.vistas.length - 1]).toEqual({ c: [-34.6, -68.6], z: 7 });
    expect(b.geo.getCurrentPosition).toHaveBeenCalledTimes(1);
    b.geo.llamadas[0].ok(posicion(-32.9, -68.8, 500));
    expect(b.reg.vistas[b.reg.vistas.length - 1]).toEqual({ c: [-32.9, -68.8], z: 16 });
    expect(b.reg.marcadores.filter((m) => JSON.stringify(m.opciones.icon).indexOf('ucorr-marker-irr') !== -1)).toHaveLength(0);   // no hay Irrigacion que marcar
  });

  test('"Usar este punto" arranca deshabilitado; tocar el mapa elige un unico punto movible y muestra lat/lon y la distancia', async () => {
    const t = cargar();
    await abrirModalMapa(t);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.34745, -69.14545');
    expect(t.el('ucorr-mapa-distancia').textContent).toBe('A 22,2 m de la ubicación de Irrigación.');
    const nuevos = () => t.reg.marcadores.filter((m) => m.opciones.draggable === true);
    expect(nuevos()).toHaveLength(1);
    tocarMapa(t, -33.3475, -69.1455);                              // mover = el mismo marcador, no otro
    expect(nuevos()).toHaveLength(1);
    expect(nuevos()[0].latlng).toEqual([-33.3475, -69.1455]);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.3475, -69.1455');
  });

  test('arrastrar el marcador nuevo actualiza el punto; los marcadores de Irrigacion y vigente no se pueden mover', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    await abrirModalMapa(t);
    tocarMapa(t, -33.3475, -69.1455);
    const nuevo = t.reg.marcadores.find((m) => m.opciones.draggable === true);
    nuevo.latlng = [-33.348, -69.146];
    nuevo.handlers.dragend();
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.348, -69.146');
    t.reg.marcadores.filter((m) => m !== nuevo).forEach((m) => expect(m.opciones.draggable).not.toBe(true));
  });

  test('Usar este punto -> confirmar -> guardar: metodo PUNTO_EN_MAPA con precisionGpsM null', async () => {
    const t = cargar();
    await abrirModalMapa(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(false);
    expect(t.el('ucorr-resumen').textContent).toBe('Elegida en mapa · -33.34745, -69.14545');
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1]).toMatchObject({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, lat: -33.34745, lon: -69.14545, wellId: W });
  });

  test('si no cargan las librerias del mapa: error en contexto con Reintentar', async () => {
    const t = cargar({ libreriasFallan: true });
    await abrirModalMapa(t);
    expect(t.el('ucorr-mapa-error').hidden).toBe(false);
    expect(t.el('ucorr-mapa-cargando').hidden).toBe(true);
  });

  test('"Volver" desde el mapa regresa a las opciones; desde confirmar regresa al mapa', async () => {
    const t = cargar();
    await abrirModalMapa(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-confirmar-volver').click();
    expect(t.el('ucorr-vista-mapa').hidden).toBe(false);
    t.volverBtns[1].click();
    expect(t.el('ucorr-vista-opciones').hidden).toBe(false);
  });
});

describe('distancia, observacion y advertencia en la confirmacion', () => {
  async function confirmarMapa(lat, lon, location) {
    const t = cargar();
    await abrirModalMapa(t, location);
    tocarMapa(t, lat, lon);
    t.el('btn-ucorr-mapa-usar').click();
    return t;
  }

  test('a ~22 m: observacion opcional y se puede guardar sin escribir nada', async () => {
    const t = await confirmarMapa(PUNTO_REAL.lat, PUNTO_REAL.lon);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (opcional)');
    expect(t.el('ucorr-distancia').textContent).toBe('A 22,2 m de la ubicación de Irrigación.');
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('a mas de 250 m: observacion OBLIGATORIA; sin ella no se puede guardar; al escribirla si', async () => {
    const t = await confirmarMapa(-33.3446, IRR.lon);                        // ~333 m
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (obligatoria)');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);
    expect(t.el('ucorr-err-observacion').hidden).toBe(false);
    expect(t.el('ucorr-err-observacion').textContent).toMatch(/obligatoria a más de 250 m/);
    t.el('btn-ucorr-guardar').click();
    expect(t.ctx.apiProponerCorreccionUbicacion).not.toHaveBeenCalled();
    t.el('ucorr-observacion').value = '   ';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);
    t.el('ucorr-observacion').value = 'La boca está corrida';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('ucorr-err-observacion').hidden).toBe(true);
  });

  test('a mas de 1 km: advertencia fuerte visible con el texto exacto; guarda igual si cumple lo demas', async () => {
    const t = await confirmarMapa(-33.3375, IRR.lon);                        // ~1,1 km
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(false);
    expect(t.el('ucorr-advertencia-1km').textContent).toBe('La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);                   // falta la observacion
    t.el('ucorr-observacion').value = 'Verificado con el propietario';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
  });

  test('SIN ubicacion de Irrigacion: no muestra distancia, la observacion es opcional y se puede proponer', async () => {
    const t = await confirmarMapa(-33.9, -68.9, LOCATION_SIN);
    expect(t.el('ucorr-distancia').hidden).toBe(true);
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (opcional)');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
  });

  test('la observacion que se escribe viaja recortada', async () => {
    const t = await confirmarMapa(PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('ucorr-observacion').value = '  boca corrida  ';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1].observacion).toBe('boca corrida');
  });
});

describe('guardado desde el modal', () => {
  async function listoParaGuardar(opc) {
    const t = cargar(opc);
    await abrirModalMapa(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    return t;
  }

  test('respuesta AUTO-VALIDADA: cierra el modal, muestra "Ubicación corregida y validada." y SIEMPRE relee despues de guardar', async () => {
    const t = await listoParaGuardar({ lectura: LECTURA_VIGENTE });
    t.orden.length = 0;
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.orden).toEqual(['proponer', 'leer']);
    expect(t.el('ucorr-overlay').hidden).toBe(true);
    expect(t.contenedor.innerHTML).toContain('ucorr-aviso-ok');
    expect(t.contenedor.innerHTML).toContain('Ubicación corregida y validada.');
    expect(t.contenedor.innerHTML).toContain('Validada en campo');                   // pintado desde la relectura
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenLastCalledWith('tok-real', W);
  });

  test('respuesta PENDIENTE: "Corrección enviada para validación." y la pendiente sale de la relectura', async () => {
    const t = await listoParaGuardar({
      proponer: () => Promise.resolve({ status: 'ok', data: { correccion: PENDIENTE, duplicada: false, curada: false } }),
      lectura: { vigente: null, pendientes: [PENDIENTE], historial: [PENDIENTE] }
    });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.contenedor.innerHTML).toContain('Corrección enviada para validación.');
    expect(t.contenedor.innerHTML).toContain('Corrección pendiente de validación (1)');
    expect(t.contenedor.innerHTML).toContain('Ana Pérez');
  });

  test('la UI no decide el estado: el mismo usuario recibe pendiente o validada segun lo que conteste el backend', async () => {
    const a = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'ok', data: { correccion: PENDIENTE } }) });
    a.el('btn-ucorr-guardar').click();
    await flush();
    expect(a.contenedor.innerHTML).toContain('Corrección enviada para validación.');
    const b = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'ok', data: { correccion: VIGENTE, autoValidada: true } }) });
    b.el('btn-ucorr-guardar').click();
    await flush();
    expect(b.contenedor.innerHTML).toContain('Ubicación corregida y validada.');
  });

  test('si falla la relectura: el guardado se informa igual y aparece "Actualizar"', async () => {
    let lecturas = 0;
    const t = await listoParaGuardar({ leer: () => { lecturas += 1; return lecturas === 1 ? Promise.resolve({ status: 'ok', data: LECTURA_VACIA }) : Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }); } });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.contenedor.innerHTML).toContain('Ubicación corregida y validada. No pudimos actualizar la lista de correcciones.');
    expect(t.el('btn-ubic-corr-recargar')).not.toBeNull();
  });

  test('DOBLE CLICK en Guardar: una sola llamada a la API; el boton queda deshabilitado en "Guardando…"', async () => {
    let resolver;
    const t = await listoParaGuardar({ proponer: () => new Promise((r) => { resolver = r; }) });
    const guardar = t.el('btn-ucorr-guardar');
    guardar.click();
    guardar.listeners.click.forEach((f) => f({}));         // un segundo toque "colado" aunque el boton ya este deshabilitado
    guardar.listeners.click.forEach((f) => f({}));
    await flush();
    expect(guardar.disabled).toBe(true);
    expect(guardar.textContent).toBe('Guardando…');
    expect(t.el('ucorr-guardando').hidden).toBe(false);
    expect(t.el('btn-ucorr-confirmar-volver').disabled).toBe(true);
    expect(t.el('btn-ucorr-cerrar').disabled).toBe(true);
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    resolver({ status: 'ok', data: { correccion: VIGENTE, autoValidada: true } });
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenCalledTimes(2);       // lectura inicial + UNA relectura
  });

  test('mientras guarda no se puede cerrar el modal', async () => {
    let resolver;
    const t = await listoParaGuardar({ proponer: () => new Promise((r) => { resolver = r; }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('ucorr-overlay').emit('keydown', { key: 'Escape' });
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    resolver({ status: 'ok', data: { correccion: VIGENTE, autoValidada: true } });
    await flush();
    expect(t.el('ucorr-overlay').hidden).toBe(true);
  });

  test('ERROR del backend: el mensaje aparece EN el modal, sin cerrar, y el boton vuelve a estar disponible', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'error', code: 'FUERA_DE_MENDOZA', message: 'tecnico' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    expect(t.el('ucorr-error').hidden).toBe(false);
    expect(t.el('ucorr-error').textContent).toBe('La ubicación queda fuera de Mendoza.');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('btn-ucorr-guardar').textContent).toBe('Guardar corrección');
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenCalledTimes(1);           // solo la lectura inicial: no se relee tras un error
  });

  test('error de red: mensaje claro y reintento posible', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.reject(new Error('Failed to fetch')) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-error').textContent).toBe('No se pudo guardar. Revisá tu conexión e intentá de nuevo.');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('RETRY del mismo intento reutiliza el clientRequestId; si cambia la observacion, es otro', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.reject(new Error('timeout')) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('ucorr-observacion').value = 'ahora con nota';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const ids = t.ctx.apiProponerCorreccionUbicacion.mock.calls.map((c) => c[1].clientRequestId);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
    ids.forEach((id) => expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/));
  });

  test('sesion vencida al guardar: cierra el modal y avisa a la app', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-overlay').hidden).toBe(true);
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('PERMISSION_DENIED del backend (aunque el boton estaba): se informa en el modal', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'error', code: 'PERMISSION_DENIED' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-error').textContent).toBe('No tenés permiso para corregir la ubicación.');
  });

  test('NUNCA viaja autoValidar, email, nombre, distancia ni estado: solo la lista blanca de 7 campos', async () => {
    const t = await listoParaGuardar();
    t.el('ucorr-observacion').value = 'nota';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const [token, datos] = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0];
    expect(token).toBe('tok-real');
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(JSON.stringify(datos)).not.toMatch(/autoValid|email|nombre|distancia|estado|irr|validar/i);
  });

  test('despues de guardar, volver a abrir el modal empieza limpio (opciones, sin observacion previa)', async () => {
    const t = await listoParaGuardar({ lectura: LECTURA_VIGENTE });
    t.el('ucorr-observacion').value = 'nota';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('ucorr-vista-opciones').hidden).toBe(false);
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);
    expect(t.el('ucorr-observacion').value).toBe('');
  });
});

describe('cierre de sesion', () => {
  test('ubicacionCorreccionController_cerrar() cierra un modal abierto (lo usa logout)', async () => {
    const t = cargar();
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    t.ctx.ubicacionCorreccionController_cerrar();
    expect(t.el('ucorr-overlay').hidden).toBe(true);
  });
});
