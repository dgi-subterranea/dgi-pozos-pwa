// Controlador DOM de las correcciones de ubicacion (js/ubicacionCorreccion.js) ejecutado de verdad, sin navegador: un DOM minimo falso,
// geolocation y Leaflet simulados y las llamadas a la API como jest.fn(). Verifica el comportamiento observable: boton segun permisos, GPS
// (>50 m bloquea), punto en el mapa (Irrigacion fija, solo el punto nuevo se mueve), observacion obligatoria, advertencia de 1 km, doble click,
// retry con el mismo clientRequestId, resultado segun el backend y refresco posterior con getCorreccionesUbicacionPozo.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const fuenteConversion = fs.readFileSync(path.join(__dirname, 'coordenadasConversion.js'), 'utf8');
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
  const reg = { mapas: [], marcadores: [], vistas: [], encuadres: [] };
  const L = {
    map() {
      const m = {
        handlers: {}, removidas: [], setView(c, z) { reg.vistas.push({ c: c, z: z }); return m; }, on(t, f) { m.handlers[t] = f; return m; },
        removeLayer(l) { m.removidas.push(l); }, invalidateSize() {}, addLayer() {},
        fitBounds(puntos, opciones) { reg.encuadres.push({ puntos: puntos, opciones: opciones }); return m; }
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
  vm.runInContext(fuenteConversion, ctx);               // igual que index.html: el modulo de conversion se carga antes que la logica
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
    expect(t.el('ucorr-error').textContent).toBe(t.ctx.UCORR_MENSAJES_ERROR.FUERA_DE_MENDOZA);
    expect(t.el('ucorr-error').textContent).toMatch(/fuera de Mendoza/);
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

// ---------------------------------------------------------------------------------------------------------------- C. Ingresar coordenadas (GMS / WGS84)
const Conv = require('./coordenadasConversion');
const GMS_LAT = { g: '33', m: '20', s: '51,54', h: 'S' };            // = Irrigacion del pozo 14-0001 (-33.34765, -69.14545)
const GMS_LON = { g: '69', m: '8', s: '43,62', h: 'O' };
const GMS_NUM = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };
const EXACTO_IRR = Conv.coordenadas_evaluarGms(GMS_NUM);

function escribir(t, eje, valores) {
  Object.keys(valores).forEach((k) => {
    const el = t.el('ucorr-' + eje + '-' + k);
    el.value = String(valores[k]);
    el.emit(k === 'h' ? 'change' : 'input');
  });
}
const escribirIrr = (t) => { escribir(t, 'lat', GMS_LAT); escribir(t, 'lon', GMS_LON); };
async function abrirCoordenadas(t, location) {
  await abrirFicha(t, location);
  t.el('btn-ubic-corr-abrir').click();
  t.el('btn-ucorr-coordenadas').click();
  await flush();
}
// el marcador movible (el punto nuevo) que sigue en el mapa
const marcadorNuevo = (t) => {
  const mapa = t.reg.mapas[0];
  const vivos = t.reg.marcadores.filter((m) => m.opciones.draggable === true && mapa.removidas.indexOf(m) === -1);
  return vivos[vivos.length - 1] || null;
};
const arrastrar = (t, lat, lon) => { const mk = marcadorNuevo(t); mk.latlng = [lat, lon]; mk.handlers.dragend(); };
const marcadoresFijos = (t) => t.reg.marcadores.filter((m) => m.opciones.interactive === false);

describe('C. Ingresar coordenadas: abrir y validacion en vivo', () => {
  test('el modal ofrece las TRES opciones y "Ingresar coordenadas" abre la vista con el panel GMS / WGS84, defaults S y O y Continuar apagado', async () => {
    const t = cargar();
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('btn-ucorr-gps').hidden).toBe(false);
    expect(t.el('btn-ucorr-mapa').hidden).toBe(false);
    expect(t.el('btn-ucorr-coordenadas').hidden).toBe(false);
    t.el('btn-ucorr-coordenadas').click();
    await flush();
    expect(t.el('ucorr-vista-mapa').hidden).toBe(false);
    expect(t.el('ucorr-vista-opciones').hidden).toBe(true);
    expect(t.el('ucorr-coord-panel').hidden).toBe(false);
    expect(t.el('btn-ucorr-sistema-gms').atributos['aria-pressed']).toBe('true');
    expect(t.el('btn-ucorr-sistema-posgar').atributos['aria-pressed']).toBe('false');
    expect(t.el('ucorr-coord-gms').hidden).toBe(false);
    expect(t.el('ucorr-coord-posgar').hidden).toBe(true);
    expect(t.el('ucorr-lat-h').value).toBe('S');
    expect(t.el('ucorr-lon-h').value).toBe('O');
    expect(t.el('btn-ucorr-mapa-usar').textContent).toBe('Continuar');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('Ingresá la latitud y la longitud.');
    expect(t.el('ucorr-coord-equivale').hidden).toBe(true);
    ['ucorr-err-lat', 'ucorr-err-lon', 'ucorr-err-general', 'ucorr-coord-movido'].forEach((id) => expect(t.el(id).hidden).toBe(true));
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('"Elegir punto en el mapa" sigue igual: sin panel de coordenadas y con "Usar este punto"', async () => {
    const t = cargar();
    await abrirModalMapa(t);
    expect(t.el('ucorr-coord-panel').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').textContent).toBe('Usar este punto');
    expect(t.el('ucorr-mapa-instruccion').textContent).toMatch(/Tocá el mapa/);
  });

  test('GMS valido: convierte AL INSTANTE, muestra lat/lon, pone el punto en el mapa (movible) y habilita Continuar', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    expect(t.el('ucorr-coord-equivale').hidden).toBe(false);
    expect(t.el('ucorr-coord-equivale-valor').textContent).toBe('-33.34765, -69.14545');
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.34765, -69.14545');
    const mk = marcadorNuevo(t);
    expect(mk).not.toBeNull();
    expect(mk.latlng).toEqual([EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta]);
    expect(mk.opciones.draggable).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
    ['ucorr-err-lat', 'ucorr-err-lon', 'ucorr-err-general'].forEach((id) => expect(t.el(id).hidden).toBe(true));
    expect(t.el('ucorr-mapa-distancia').textContent).toMatch(/^A 0(,\d)? m de la ubicación de Irrigación\.$/);
    expect(t.reg.encuadres.length + t.reg.vistas.length).toBeGreaterThan(0);          // el mapa se encuadra en el punto
  });

  test('coma o punto decimal en los segundos dan el MISMO punto', async () => {
    const t1 = cargar();
    await abrirCoordenadas(t1);
    escribir(t1, 'lat', { g: '33', m: '20', s: '51,54' }); escribir(t1, 'lon', { g: '69', m: '8', s: '43,62' });
    const t2 = cargar();
    await abrirCoordenadas(t2);
    escribir(t2, 'lat', { g: '33', m: '20', s: '51.54' }); escribir(t2, 'lon', { g: '69', m: '8', s: '43.62' });
    expect(marcadorNuevo(t1).latlng).toEqual(marcadorNuevo(t2).latlng);
    expect(t1.el('ucorr-coord-equivale-valor').textContent).toBe(t2.el('ucorr-coord-equivale-valor').textContent);
  });

  test('mientras se escribe a medias (un eje) no hay errores ni punto; al completar el otro eje aparece el punto', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribir(t, 'lat', GMS_LAT);
    ['ucorr-err-lat', 'ucorr-err-lon', 'ucorr-err-general'].forEach((id) => expect(t.el(id).hidden).toBe(true));
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    escribir(t, 'lon', GMS_LON);
    expect(marcadorNuevo(t)).not.toBeNull();
  });

  test.each([
    ['minutos = 60', 'lat', { m: '60' }, 'err-lat', 'm', /minutos/],
    ['segundos = 60', 'lat', { s: '60' }, 'err-lat', 's', /segundos/],
    ['grados no numericos', 'lon', { g: 'abc' }, 'err-lon', 'g', /grados/],
    ['segundos no numericos', 'lon', { s: '4x' }, 'err-lon', 's', /segundos/],
    ['minutos negativos', 'lat', { m: '-5' }, 'err-lat', 'm', /negativos/],
    ['latitud con grados > 90', 'lat', { g: '95' }, 'err-lat', 'g', /entre 0 y 90/]
  ])('invalido: %s -> mensaje EN CONTEXTO, campo marcado, sin punto y Continuar apagado', async (_n, eje, cambio, errId, campo, texto) => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    expect(marcadorNuevo(t)).not.toBeNull();
    escribir(t, eje, cambio);
    expect(t.el('ucorr-' + errId).hidden).toBe(false);
    expect(t.el('ucorr-' + errId).textContent).toMatch(texto);
    expect(t.el('ucorr-' + eje + '-' + campo).atributos['aria-invalid']).toBe('true');
    expect(marcadorNuevo(t)).toBeNull();                                            // el punto anterior desaparece: no queda una propuesta "vieja"
    expect(t.el('ucorr-coord-equivale').hidden).toBe(true);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('Ingresá la latitud y la longitud.');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);                        // aunque se fuerce el click, no avanza
  });

  test('corregir el valor invalido restablece todo: errores fuera, punto de nuevo y Continuar', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    escribir(t, 'lat', { m: '60' });
    expect(t.el('ucorr-err-lat').hidden).toBe(false);
    escribir(t, 'lat', { m: '20' });
    expect(t.el('ucorr-err-lat').hidden).toBe(true);
    expect(t.el('ucorr-lat-m').atributos['aria-invalid']).toBe('false');
    expect(marcadorNuevo(t)).not.toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test('hemisferio equivocado (lat N): fuera de Mendoza con la pista del hemisferio; NO se corrige solo y Continuar queda apagado', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    escribir(t, 'lat', { h: 'N' });
    expect(t.el('ucorr-err-general').hidden).toBe(false);
    expect(t.el('ucorr-err-general').textContent).toMatch(/fuera de Mendoza/);
    expect(t.el('ucorr-err-general').textContent).toMatch(/hemisferio/i);
    expect(t.el('ucorr-lat-h').value).toBe('N');                                     // lo elegido se respeta
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    escribir(t, 'lat', { h: 'S' });
    expect(t.el('ucorr-err-general').hidden).toBe(true);
    expect(marcadorNuevo(t)).not.toBeNull();
  });

  test('el hemisferio Este para la longitud tambien deja el punto fuera de Mendoza (E / O)', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    escribir(t, 'lon', { h: 'E' });
    expect(t.el('ucorr-err-general').textContent).toMatch(/fuera de Mendoza/);
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('punto fuera de Mendoza (Buenos Aires): mensaje y sin propuesta', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribir(t, 'lat', { g: '34', m: '36', s: '0', h: 'S' });
    escribir(t, 'lon', { g: '58', m: '22', s: '0', h: 'O' });
    expect(t.el('ucorr-err-general').textContent).toMatch(/fuera de Mendoza/);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('en modo coordenadas, tocar el mapa NO elige un punto (solo se arrastra el convertido)', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    escribirIrr(t);
    const antes = marcadorNuevo(t).latlng;
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    expect(marcadorNuevo(t).latlng).toEqual(antes);
  });
});

describe('C. Ingresar coordenadas: mapa con Irrigacion, vigente y punto nuevo', () => {
  test('Irrigacion + vigente (fijos, no interactivos) + punto nuevo movible; el mapa se encuadra con los tres', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    await abrirCoordenadas(t);
    expect(marcadoresFijos(t)).toHaveLength(2);
    marcadoresFijos(t).forEach((m) => { expect(m.opciones.interactive).toBe(false); expect(m.opciones.draggable).toBeUndefined(); });
    escribirIrr(t);
    expect(marcadorNuevo(t).opciones.draggable).toBe(true);
    const ult = t.reg.encuadres[t.reg.encuadres.length - 1];
    expect(ult.puntos).toHaveLength(3);
    expect(ult.puntos[0]).toEqual([EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta]);
    expect(ult.puntos).toContainEqual([IRR.lat, IRR.lon]);
    expect(ult.puntos).toContainEqual([PUNTO_REAL.lat, PUNTO_REAL.lon]);
    expect(ult.opciones.maxZoom).toBe(17);
  });

  test('sin vigente: Irrigacion + punto nuevo; sin Irrigacion ni vigente: solo el punto, a zoom 17', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    expect(t.reg.encuadres[t.reg.encuadres.length - 1].puntos).toHaveLength(2);
    const sin = cargar();
    await abrirCoordenadas(sin, LOCATION_SIN);
    escribirIrr(sin);
    expect(marcadoresFijos(sin)).toHaveLength(0);
    expect(sin.reg.vistas[sin.reg.vistas.length - 1]).toEqual({ c: [EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta], z: 17 });
  });

  test('si la coordenada se escribio mientras cargaba el mapa, el punto aparece al terminar la carga', async () => {
    let listo;
    const t = cargar({});
    t.ctx.mapaShared_cargarLibrerias.mockImplementation(() => new Promise((r) => { listo = r; }));
    await abrirFicha(t);
    t.el('btn-ubic-corr-abrir').click();
    t.el('btn-ucorr-coordenadas').click();
    escribirIrr(t);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);                      // el formulario funciona sin esperar al mapa
    expect(marcadorNuevo(t)).toBeNull();
    listo();
    await flush();
    expect(marcadorNuevo(t)).not.toBeNull();
  });

  test('si el mapa no carga, se puede continuar igual con la coordenada ingresada (no depende del mapa)', async () => {
    const t = cargar({ libreriasFallan: true });
    await abrirCoordenadas(t);
    expect(t.el('ucorr-mapa-error').hidden).toBe(false);
    expect(t.el('ucorr-mapa-error-texto').textContent).toMatch(/podés continuar/);
    escribirIrr(t);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(false);
  });
});

describe('C. Ingresar coordenadas: arrastrar el punto -> PUNTO_EN_MAPA, y restaurar', () => {
  async function conPuntoConvertido(opc) {
    const t = cargar(opc);
    await abrirCoordenadas(t);
    escribirIrr(t);
    return t;
  }

  test('arrastrar: aviso exacto, boton "Restaurar coordenada ingresada" y el punto manual pasa a ser el punto', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3470000123, -69.1450000456);
    expect(t.el('ucorr-coord-movido').hidden).toBe(false);
    expect(t.el('ucorr-coord-movido-texto').textContent).toBe('Moviste el punto manualmente. Se guardará como punto elegido en el mapa.');
    expect(t.el('btn-ucorr-coord-restaurar').textContent).toBe('Restaurar coordenada ingresada');
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.347, -69.145');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test('arrastrado: se guarda como PUNTO_EN_MAPA y coordenadaOriginal DEJA de enviarse (payload de 7 campos, lat/lon redondeados)', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3470000123, -69.1450000456);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toBe('Elegida en mapa · -33.347, -69.145');
    expect(t.el('ucorr-resumen-original').hidden).toBe(true);
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(datos).toMatchObject({ metodo: 'PUNTO_EN_MAPA', lat: -33.347, lon: -69.145, precisionGpsM: null });
    expect(JSON.stringify(datos)).not.toMatch(/coordenadaOriginal/);
  });

  test('Restaurar: vuelve a COORDENADAS_GMS, EXACTAMENTE a la coordenada derivada del GMS, y recupera coordenadaOriginal', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3470000123, -69.1450000456);
    t.el('btn-ucorr-coord-restaurar').click();
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    expect(marcadorNuevo(t).latlng).toEqual([EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta]);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.34765, -69.14545');
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toBe('Coordenadas GMS / WGS84 · -33.34765, -69.14545');
    expect(t.el('ucorr-resumen-original').hidden).toBe(false);
    expect(t.el('ucorr-resumen-original').textContent).toBe('Coordenada ingresada: 33° 20\' 51.54" S, 69° 8\' 43.62" O (GMS / WGS84)');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('COORDENADAS_GMS');
    expect(datos.coordenadaOriginal).toEqual(GMS_NUM);
    expect(datos.lat).toBe(EXACTO_IRR.latExacta);
    expect(datos.lon).toBe(EXACTO_IRR.lonExacta);
  });

  test('arrastrar varias veces y restaurar sigue dando la coordenada original (no queda estado viejo)', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3471, -69.1451);
    arrastrar(t, -33.3472, -69.1452);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-33.3472, -69.1452');
    t.el('btn-ucorr-coord-restaurar').click();
    expect(marcadorNuevo(t).latlng).toEqual([EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta]);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
  });

  test('soltar el punto en el mismo lugar NO lo vuelve manual', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, EXACTO_IRR.latExacta, EXACTO_IRR.lonExacta);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toMatch(/^Coordenadas GMS \/ WGS84 · /);
  });

  test('despues de arrastrar, escribir de nuevo en los campos RETOMA la coordenada ingresada (el aviso desaparece y el punto vuelve a la conversion)', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3471, -69.1451);
    escribir(t, 'lat', { s: '50' });
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    const nuevo = Conv.coordenadas_evaluarGms({ lat: { g: 33, m: 20, s: 50, h: 'S' }, lon: GMS_NUM.lon });
    expect(marcadorNuevo(t).latlng).toEqual([nuevo.latExacta, nuevo.lonExacta]);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toMatch(/^Coordenadas GMS \/ WGS84 · /);
  });

  test('despues de arrastrar, dejar los campos invalidos quita el punto (no se guarda un punto "huerfano")', async () => {
    const t = await conPuntoConvertido();
    arrastrar(t, -33.3471, -69.1451);
    escribir(t, 'lat', { m: '99' });
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
  });
});

describe('C. Ingresar coordenadas: distancia, observacion y advertencia', () => {
  async function confirmarCon(lat, lon, opc) {
    const t = cargar(opc);
    await abrirCoordenadas(t, opc && opc.location);
    escribir(t, 'lat', lat);
    escribir(t, 'lon', lon);
    t.el('btn-ucorr-mapa-usar').click();
    return t;
  }

  test('a ~0 m: observacion opcional, sin advertencias, se puede guardar', async () => {
    const t = await confirmarCon(GMS_LAT, GMS_LON);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (opcional)');
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('ucorr-resumen').textContent).toBe('Coordenadas GMS / WGS84 · -33.34765, -69.14545');
  });

  test('a mas de 250 m (~326 m): observacion OBLIGATORIA; sin ella no se puede guardar; al escribirla si', async () => {
    const t = await confirmarCon(Object.assign({}, GMS_LAT, { s: '41' }), GMS_LON);
    expect(t.el('ucorr-distancia').textContent).toMatch(/^A 32\d(,\d)? m de la ubicación de Irrigación\./);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (obligatoria)');
    expect(t.el('ucorr-err-observacion').hidden).toBe(false);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);
    t.el('ucorr-observacion').value = 'El pozo esta del otro lado del canal';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
  });

  test('a mas de 1 km (~1,2 km): advertencia fuerte con el texto exacto, y guarda igual si cumple lo demas', async () => {
    const t = await confirmarCon(Object.assign({}, GMS_LAT, { s: '11' }), GMS_LON);
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(false);
    expect(t.el('ucorr-advertencia-1km').textContent).toBe('La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.');
    t.el('ucorr-observacion').value = 'lejos';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('el punto convertido tambien muestra la distancia orientativa en la vista del mapa', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribir(t, 'lat', Object.assign({}, GMS_LAT, { s: '41' }));
    escribir(t, 'lon', GMS_LON);
    expect(t.el('ucorr-mapa-distancia').textContent).toMatch(/^A 32\d(,\d)? m de la ubicación de Irrigación\./);
  });

  test('SIN ubicacion de Irrigacion: sin distancia, observacion opcional y se puede continuar y guardar', async () => {
    const t = await confirmarCon(GMS_LAT, GMS_LON, { location: LOCATION_SIN });
    expect(t.el('ucorr-distancia').hidden).toBe(true);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (opcional)');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('ucorr-mapa-distancia').textContent).toBe('');
  });
});

describe('C. Ingresar coordenadas: guardado, payload exacto y errores del backend', () => {
  async function listoParaGuardarGms(opc) {
    const t = cargar(opc);
    await abrirCoordenadas(t, opc && opc.location);
    escribirIrr(t);
    t.el('btn-ucorr-mapa-usar').click();
    return t;
  }

  test('PAYLOAD EXACTO: 8 campos, metodo COORDENADAS_GMS, precisionGpsM null, lat/lon sin redondear y coordenadaOriginal estructurada con numeros', async () => {
    const t = await listoParaGuardarGms();
    t.el('ucorr-observacion').value = ' nota de campo ';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const [token, datos] = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0];
    expect(token).toBe('tok-real');
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(datos).toMatchObject({ wellId: W, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: 'nota de campo' });
    expect(datos.lat).toBe(EXACTO_IRR.latExacta);
    expect(datos.lon).toBe(EXACTO_IRR.lonExacta);
    expect(datos.coordenadaOriginal).toEqual(GMS_NUM);
    expect(Object.keys(datos.coordenadaOriginal).sort()).toEqual(['lat', 'lon']);
    expect(Object.keys(datos.coordenadaOriginal.lat).sort()).toEqual(['g', 'h', 'm', 's']);
    expect(datos.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test('NUNCA viaja coordenadaOriginalTexto, crsOriginal, distancia, estado, email, nombre ni flags de validacion', async () => {
    const t = await listoParaGuardarGms();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(JSON.stringify(datos)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|distancia|estado|email|nombre|autoValid|validar|validada|irr/i);
  });

  test('los segundos con coma viajan como NUMERO (51.54) y los vacios como 0', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribir(t, 'lat', { g: '33', m: '', s: '', h: 'S' });
    escribir(t, 'lon', { g: '69', m: '', s: '', h: 'O' });
    t.el('btn-ucorr-mapa-usar').click();
    t.el('ucorr-observacion').value = 'sin minutos';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1].coordenadaOriginal).toEqual({ lat: { g: 33, m: 0, s: 0, h: 'S' }, lon: { g: 69, m: 0, s: 0, h: 'O' } });
  });

  test('guardado OK: cierra el modal, el resultado lo dice el backend y SIEMPRE se relee (pintado desde la relectura, con el valor original)', async () => {
    const GMS_CORR = Object.assign({}, VIGENTE, { metodo: 'COORDENADAS_GMS', lat: IRR.lat, lon: IRR.lon, coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O', crsOriginal: 'GMS_WGS84' });
    const t = await listoParaGuardarGms({
      lectura: { vigente: GMS_CORR, pendientes: [], historial: [GMS_CORR, VIGENTE] },
      proponer: () => Promise.resolve({ status: 'ok', data: { correccion: GMS_CORR, duplicada: false, curada: false, autoValidada: true } })
    });
    t.orden.length = 0;
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.orden).toEqual(['proponer', 'leer']);
    expect(t.el('ucorr-overlay').hidden).toBe(true);
    const html = t.contenedor.innerHTML;
    expect(html).toContain('Ubicación corregida y validada.');
    expect(html).toContain('Coordenadas GMS / WGS84');
    expect(html).toContain('Coordenada ingresada');
    expect(html).toContain('GMS / WGS84');
    expect(html).toContain('-33.34765, -69.14545');
    expect(html.match(/Coordenada ingresada/g)).toHaveLength(2);        // vigente + su fila del historial; la fila de mapa (sin campos) no suma
    expect(html).toContain('Elegida en mapa');
  });

  test('PENDIENTE: "Corrección enviada para validación." segun el backend', async () => {
    const t = await listoParaGuardarGms({ proponer: () => Promise.resolve({ status: 'ok', data: { correccion: PENDIENTE, duplicada: false, curada: false } }), lectura: { vigente: null, pendientes: [PENDIENTE], historial: [PENDIENTE] } });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.contenedor.innerHTML).toContain('Corrección enviada para validación.');
  });

  test('DOBLE CLICK en Guardar: una sola llamada a la API', async () => {
    let resolver;
    const t = await listoParaGuardarGms({ proponer: () => new Promise((r) => { resolver = r; }) });
    t.el('btn-ucorr-guardar').click();
    t.el('btn-ucorr-guardar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);
    resolver({ status: 'ok', data: { correccion: VIGENTE, autoValidada: true } });
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
  });

  test('REINTENTO: tras un corte de red se reenvia el MISMO contenido con el MISMO clientRequestId; cambiar un segundo da otro', async () => {
    const t = await listoParaGuardarGms({ proponer: () => Promise.reject(new Error('timeout')) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-error').textContent).toBe('No se pudo guardar. Revisá tu conexión e intentá de nuevo.');
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ucorr-confirmar-volver').click();
    escribir(t, 'lat', { s: '52' });
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const ids = t.ctx.apiProponerCorreccionUbicacion.mock.calls.map((c) => c[1].clientRequestId);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  test.each([
    ['COORDENADA_INCONSISTENTE', /no coincide con el punto calculado/],
    ['COORDENADA_INVALIDA', /coordenada ingresada no es válida/],
    ['XY_INVERTIDOS', /X e Y están intercambiados/],
    ['INVALID_COORDENADA_ORIGINAL', /No se pudo interpretar la coordenada/],
    ['ESQUEMA_DESACTUALIZADO', /todavía no está disponible/],
    ['FUERA_DE_MENDOZA', /fuera de Mendoza/]
  ])('el backend responde %s: mensaje amigable EN el modal (sin codigo tecnico), no cierra y se puede reintentar', async (code, texto) => {
    const t = await listoParaGuardarGms({ proponer: () => Promise.resolve({ status: 'error', code: code, message: 'texto tecnico', detalle: 'MINUTOS_FUERA_DE_RANGO', campo: 'lat.m' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    expect(t.el('ucorr-error').hidden).toBe(false);
    expect(t.el('ucorr-error').textContent).toMatch(texto);
    expect(t.el('ucorr-error').textContent).not.toMatch(new RegExp(code + '|tecnico|MINUTOS|lat\\.m'));
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.ctx.apiGetCorreccionesUbicacionPozo).toHaveBeenCalledTimes(1);               // no se relee tras un error
  });

  test('codigo desconocido: mensaje generico, nunca el codigo', async () => {
    const t = await listoParaGuardarGms({ proponer: () => Promise.resolve({ status: 'error', code: 'ALGO_NUEVO', message: 'x' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-error').textContent).toBe('No se pudo guardar la corrección. Intentá nuevamente.');
  });

  test('Volver desde confirmar regresa a las coordenadas con los campos intactos y el punto en el mapa', async () => {
    const t = await listoParaGuardarGms();
    t.el('btn-ucorr-confirmar-volver').click();
    expect(t.el('ucorr-vista-mapa').hidden).toBe(false);
    expect(t.el('ucorr-coord-panel').hidden).toBe(false);
    expect(t.el('ucorr-lat-s').value).toBe('51,54');
    expect(marcadorNuevo(t)).not.toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });
});

describe('C. Ingresar coordenadas: convivencia con las otras opciones', () => {
  test('Volver a las opciones y elegir "punto en el mapa": se oculta el panel, no queda el punto convertido y el boton vuelve a "Usar este punto"', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    t.volverBtns[1].click();
    expect(t.el('ucorr-vista-opciones').hidden).toBe(false);
    t.el('btn-ucorr-mapa').click();
    await flush();
    expect(t.el('ucorr-coord-panel').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').textContent).toBe('Usar este punto');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('PUNTO_EN_MAPA');
    expect(datos).not.toHaveProperty('coordenadaOriginal');
  });

  test('volver a abrir "Ingresar coordenadas" empieza limpio (campos vacios, S y O, sin errores ni punto)', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    escribir(t, 'lat', { h: 'N' });
    t.volverBtns[1].click();
    t.el('btn-ucorr-coordenadas').click();
    await flush();
    ['g', 'm', 's'].forEach((k) => { expect(t.el('ucorr-lat-' + k).value).toBe(''); expect(t.el('ucorr-lon-' + k).value).toBe(''); });
    expect(t.el('ucorr-lat-h').value).toBe('S');
    expect(t.el('ucorr-lon-h').value).toBe('O');
    expect(t.el('ucorr-err-general').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
  });

  test('GPS despues de coordenadas: manda GPS_ACTUAL sin coordenadaOriginal', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    t.volverBtns[1].click();
    t.el('btn-ucorr-gps').click();
    t.geo.llamadas[t.geo.llamadas.length - 1].ok(posicion(PUNTO_REAL.lat, PUNTO_REAL.lon, 8));
    t.el('btn-ucorr-gps-continuar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('GPS_ACTUAL');
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
  });

  test('despues de guardar, volver a abrir el modal empieza en las opciones y sin observacion previa', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    await abrirCoordenadas(t);
    escribirIrr(t);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('ucorr-observacion').value = 'algo';
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ubic-corr-abrir').click();
    expect(t.el('ucorr-vista-opciones').hidden).toBe(false);
    expect(t.el('ucorr-observacion').value).toBe('');
  });
});

describe('C. Ingresar coordenadas: permisos', () => {
  test('quien NO puede corregir no ve el boton (ni por lo tanto la opcion de coordenadas)', async () => {
    const t = cargar({ permisos: { ubicacion: true, ubicacion_corregir: false } });
    await abrirFicha(t);
    expect(t.contenedor.innerHTML).not.toContain('btn-ubic-corr-abrir');
  });
});

// ---------------------------------------------------------------------------------------------------------------- D. Ingresar coordenadas: POSGAR 94 / Argentina 2
// Punto de Irrigacion del pozo (-33.34765, -69.14545) expresado en POSGAR (X = Este, Y = Norte), a 2 decimales: queda a unos pocos cm de Irrigacion.
const POS_IRR_NUM = (() => { const p = Conv.coordenadas_wgs84APosgar(IRR.lat, IRR.lon); return { x: Math.round(p.este * 100) / 100, y: Math.round(p.norte * 100) / 100 }; })();
const aArgentino = (n) => String(n).replace('.', ',');
const POS_IRR = { x: aArgentino(POS_IRR_NUM.x), y: aArgentino(POS_IRR_NUM.y) };
const EXACTO_POS = Conv.coordenadas_evaluarPosgar(POS_IRR_NUM);

function escribirXY(t, x, y) {
  [['ucorr-posgar-x', x], ['ucorr-posgar-y', y]].forEach(([id, v]) => {
    if (v === undefined) { return; }
    const el = t.el(id);
    el.value = String(v);
    el.emit('input');
  });
}
const elegirPosgar = (t) => t.el('btn-ucorr-sistema-posgar').click();
const elegirGms = (t) => t.el('btn-ucorr-sistema-gms').click();
async function abrirPosgar(t, location) {
  await abrirCoordenadas(t, location);
  elegirPosgar(t);
}

describe('D. POSGAR: selector de sistema', () => {
  test('el panel ofrece GMS / WGS84 y POSGAR 94 / Argentina 2; GMS es el sistema inicial', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    expect(t.el('btn-ucorr-sistema-gms').atributos['aria-pressed']).toBe('true');
    expect(t.el('btn-ucorr-sistema-posgar').atributos['aria-pressed']).toBe('false');
    expect(t.el('ucorr-coord-gms').hidden).toBe(false);
    expect(t.el('ucorr-coord-posgar').hidden).toBe(true);
  });

  test('elegir POSGAR muestra su panel (con la ayuda X = Este e Y = Norte), oculta GMS y deja Continuar apagado', async () => {
    const t = cargar();
    await abrirPosgar(t);
    expect(t.el('btn-ucorr-sistema-posgar').atributos['aria-pressed']).toBe('true');
    expect(t.el('btn-ucorr-sistema-gms').atributos['aria-pressed']).toBe('false');
    expect(t.el('ucorr-coord-posgar').hidden).toBe(false);
    expect(t.el('ucorr-coord-gms').hidden).toBe(true);
    expect(t.el('ucorr-posgar-ayuda').textContent).toBe('En esta aplicación se ingresa X = Este e Y = Norte.');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('Ingresá X (Este) e Y (Norte).');
    ['ucorr-err-x', 'ucorr-err-y', 'ucorr-err-posgar-general', 'ucorr-posgar-invertido', 'ucorr-coord-equivale', 'ucorr-coord-movido'].forEach((id) => expect(t.el(id).hidden).toBe(true));
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('GMS -> POSGAR LIMPIA todo: campos GMS vacios (y S / O), errores fuera, sin punto, sin conversion y Continuar apagado', async () => {
    const t = cargar();
    await abrirCoordenadas(t);
    escribirIrr(t);
    expect(marcadorNuevo(t)).not.toBeNull();
    escribir(t, 'lat', { m: '99' });
    expect(t.el('ucorr-err-lat').hidden).toBe(false);
    escribirIrr(t);
    elegirPosgar(t);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('ucorr-coord-equivale').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-err-lat').hidden).toBe(true);
    ['g', 'm', 's'].forEach((k) => { expect(t.el('ucorr-lat-' + k).value).toBe(''); expect(t.el('ucorr-lon-' + k).value).toBe(''); });
    expect(t.el('ucorr-lat-h').value).toBe('S');
    expect(t.el('ucorr-lon-h').value).toBe('O');
    expect(t.el('ucorr-posgar-x').value).toBe('');
    expect(t.el('ucorr-posgar-y').value).toBe('');
  });

  test('POSGAR -> GMS LIMPIA todo: X/Y vacios, errores e invertido fuera, sin punto, y GMS arranca vacio (no reutiliza X/Y)', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '6350000', '2500000');
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(false);
    elegirGms(t);
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(true);
    expect(t.el('ucorr-posgar-x').value).toBe('');
    expect(t.el('ucorr-posgar-y').value).toBe('');
    expect(t.el('ucorr-coord-gms').hidden).toBe(false);
    expect(t.el('ucorr-lat-g').value).toBe('');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-mapa-coord').textContent).toBe('Ingresá la latitud y la longitud.');
    escribirXY(t, '2500000', '6350000');                     // un X/Y valido escrito mientras esta GMS NO activa nada (no son los campos activos)
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
  });

  test('POSGAR valido -> GMS: el punto del sistema anterior desaparece y no se puede continuar con el', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    expect(marcadorNuevo(t)).not.toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
    elegirGms(t);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);
  });

  test('despues de cambiar de sistema NO viaja el coordenadaOriginal del anterior: GMS -> POSGAR guarda solo {x, y}; POSGAR -> GMS solo {lat, lon}', async () => {
    const t1 = cargar();
    await abrirCoordenadas(t1);
    escribirIrr(t1);
    elegirPosgar(t1);
    escribirXY(t1, POS_IRR.x, POS_IRR.y);
    t1.el('btn-ucorr-mapa-usar').click();
    t1.el('btn-ucorr-guardar').click();
    await flush();
    const d1 = t1.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(d1.metodo).toBe('COORDENADAS_POSGAR94_AR2');
    expect(Object.keys(d1.coordenadaOriginal).sort()).toEqual(['x', 'y']);

    const t2 = cargar();
    await abrirPosgar(t2);
    escribirXY(t2, POS_IRR.x, POS_IRR.y);
    elegirGms(t2);
    escribirIrr(t2);
    t2.el('btn-ucorr-mapa-usar').click();
    t2.el('btn-ucorr-guardar').click();
    await flush();
    const d2 = t2.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(d2.metodo).toBe('COORDENADAS_GMS');
    expect(Object.keys(d2.coordenadaOriginal).sort()).toEqual(['lat', 'lon']);
  });

  test('tocar el sistema que ya esta activo no borra lo escrito', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    elegirPosgar(t);
    expect(t.el('ucorr-posgar-x').value).toBe(POS_IRR.x);
    expect(marcadorNuevo(t)).not.toBeNull();
  });

  test('cambiar de sistema despues de arrastrar tambien limpia el aviso de "movido" y el punto manual', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    arrastrar(t, -33.3471, -69.1451);
    expect(t.el('ucorr-coord-movido').hidden).toBe(false);
    elegirGms(t);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
  });
});

describe('D. POSGAR: parseo, validacion en vivo y conversion', () => {
  test('transformacion conocida: X=2.500.000 Y=6.350.000 -> -32.992946, -69 (pyproj); el punto va al mapa, movible', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '2.500.000', '6.350.000');
    expect(t.el('ucorr-coord-equivale').hidden).toBe(false);
    expect(t.el('ucorr-coord-equivale-valor').textContent).toBe('-32.992946, -69');
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-32.992946, -69');
    const mk = marcadorNuevo(t);
    const ex = Conv.coordenadas_evaluarPosgar({ x: 2500000, y: 6350000 });
    expect(mk.latlng).toEqual([ex.latExacta, ex.lonExacta]);
    expect(mk.opciones.draggable).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test.each([
    ['entero', '2500000', '6350000'],
    ['punto decimal', '2500000.00', '6350000.0'],
    ['coma decimal', '2500000,00', '6350000,0'],
    ['separador de miles', '2.500.000', '6.350.000'],
    ['formato argentino con decimales', '2.500.000,00', '6.350.000,00']
  ])('formato %s: el mismo numero da EXACTAMENTE el mismo punto', async (_n, x, y) => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, x, y);
    const ex = Conv.coordenadas_evaluarPosgar({ x: 2500000, y: 6350000 });
    expect(marcadorNuevo(t).latlng).toEqual([ex.latExacta, ex.lonExacta]);
    expect(t.el('ucorr-err-x').hidden).toBe(true);
    expect(t.el('ucorr-err-y').hidden).toBe(true);
  });

  test('formato argentino 2.500.000,50 y 6.350.000,25: se interpreta como 2500000.5 y 6350000.25', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '2.500.000,50', '6.350.000,25');
    const ex = Conv.coordenadas_evaluarPosgar({ x: 2500000.5, y: 6350000.25 });
    expect(marcadorNuevo(t).latlng).toEqual([ex.latExacta, ex.lonExacta]);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toMatch(/^Coordenadas POSGAR 94 \/ Argentina 2 · /);
    expect(t.el('ucorr-resumen-original').textContent).toBe('Coordenada ingresada: X(Este)=2500000.50, Y(Norte)=6350000.25 (POSGAR 94 / Argentina 2 · EPSG:22182)');
  });

  test.each([
    ['X no numerico', 'abc', '6350000', 'ucorr-err-x', /X \/ Este.*número/, 'ucorr-posgar-x'],
    ['Y no numerico', '2500000', '63x', 'ucorr-err-y', /Y \/ Norte.*número/, 'ucorr-posgar-y'],
    ['X NaN', 'NaN', '6350000', 'ucorr-err-x', /X \/ Este/, 'ucorr-posgar-x'],
    ['Y infinito', '2500000', 'Infinity', 'ucorr-err-y', /Y \/ Norte/, 'ucorr-posgar-y'],
    ['X con notacion cientifica', '2.5e6', '6350000', 'ucorr-err-x', /X \/ Este/, 'ucorr-posgar-x'],
    ['X con miles mal formados', '2.50.000', '6350000', 'ucorr-err-x', /X \/ Este/, 'ucorr-posgar-x'],
    ['X fuera de rango (chico)', '100', '6350000', 'ucorr-err-x', /fuera de rango/, 'ucorr-posgar-x'],
    ['X fuera de rango (grande)', '3500000', '6350000', 'ucorr-err-x', /fuera de rango/, 'ucorr-posgar-x'],
    ['Y fuera de rango', '2500000', '5000000', 'ucorr-err-y', /fuera de rango/, 'ucorr-posgar-y'],
    ['X ambiguo con un solo grupo de miles (2.500)', '2.500', '6350000', 'ucorr-err-x', /fuera de rango/, 'ucorr-posgar-x']
  ])('invalido: %s -> error EN CONTEXTO, campo marcado, sin punto y Continuar apagado', async (_n, x, y, errId, texto, campoId) => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    expect(marcadorNuevo(t)).not.toBeNull();
    escribirXY(t, x, y);
    expect(t.el(errId).hidden).toBe(false);
    expect(t.el(errId).textContent).toMatch(texto);
    expect(t.el(campoId).atributos['aria-invalid']).toBe('true');
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('ucorr-coord-equivale').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);
  });

  test('un solo campo escrito y fuera de rango: el error aparece YA; si esta bien, no hay error ni punto hasta completar el otro', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '100');
    expect(t.el('ucorr-err-x').hidden).toBe(false);
    escribirXY(t, '2500000');
    expect(t.el('ucorr-err-x').hidden).toBe(true);
    expect(t.el('ucorr-err-y').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    escribirXY(t, undefined, '6350000');
    expect(marcadorNuevo(t)).not.toBeNull();
  });

  test('dentro del rango pero fuera de Mendoza (esquina SO): mensaje general y sin propuesta', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '2300000', '5800000');
    expect(t.el('ucorr-err-posgar-general').hidden).toBe(false);
    expect(t.el('ucorr-err-posgar-general').textContent).toMatch(/fuera de Mendoza/);
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
  });

  test('corregir un valor invalido restablece todo (errores fuera, punto y Continuar)', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, 'abc', '6350000');
    expect(t.el('ucorr-err-x').hidden).toBe(false);
    escribirXY(t, '2500000');
    expect(t.el('ucorr-err-x').hidden).toBe(true);
    expect(t.el('ucorr-posgar-x').atributos['aria-invalid']).toBe('false');
    expect(marcadorNuevo(t)).not.toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test('tocar el mapa en modo POSGAR no elige puntos', async () => {
    const t = cargar();
    await abrirPosgar(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    expect(marcadorNuevo(t)).toBeNull();
  });
});

describe('D. POSGAR: X/Y invertidos y el boton "Intercambiar X e Y"', () => {
  async function conInvertidos(opc) {
    const t = cargar(opc);
    await abrirPosgar(t);
    escribirXY(t, '6.350.000,5', '2.500.000');
    return t;
  }

  test('invertidos: mensaje claro + boton; NO se convierte, NO hay punto y NO se corrige nada solo', async () => {
    const t = await conInvertidos();
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(false);
    expect(t.el('ucorr-posgar-invertido-texto').textContent).toMatch(/Parece que X e Y están intercambiados/);
    expect(t.el('btn-ucorr-posgar-intercambiar').hidden).toBe(false);
    expect(t.el('ucorr-posgar-x').value).toBe('6.350.000,5');          // los valores siguen como los escribio la persona
    expect(t.el('ucorr-posgar-y').value).toBe('2.500.000');
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('ucorr-coord-equivale').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-err-posgar-general').hidden).toBe(true);        // un solo mensaje, no dos
  });

  test('NUNCA intercambia automaticamente: despues de mucho tiempo / re-evaluaciones los campos son los mismos', async () => {
    const t = await conInvertidos();
    escribirXY(t, '6.350.000,5');
    escribirXY(t, undefined, '2.500.000');
    await flush();
    expect(t.el('ucorr-posgar-x').value).toBe('6.350.000,5');
    expect(t.el('ucorr-posgar-y').value).toBe('2.500.000');
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('"Intercambiar X e Y": intercambia los valores TAL CUAL, vuelve a validar, recalcula y muestra el punto', async () => {
    const t = await conInvertidos();
    t.el('btn-ucorr-posgar-intercambiar').click();
    expect(t.el('ucorr-posgar-x').value).toBe('2.500.000');
    expect(t.el('ucorr-posgar-y').value).toBe('6.350.000,5');
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(true);
    const ex = Conv.coordenadas_evaluarPosgar({ x: 2500000, y: 6350000.5 });
    expect(marcadorNuevo(t).latlng).toEqual([ex.latExacta, ex.lonExacta]);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test('el payload refleja los valores DESPUES del intercambio (X = Este, Y = Norte)', async () => {
    const t = await conInvertidos();
    t.el('btn-ucorr-posgar-intercambiar').click();
    t.el('btn-ucorr-mapa-usar').click();
    t.el('ucorr-observacion').value = 'distinto';
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.coordenadaOriginal).toEqual({ x: 2500000, y: 6350000.5 });
  });

  test('invertidos sin tocar el boton: no se puede continuar ni guardar (no sale ninguna llamada a la API)', async () => {
    const t = await conInvertidos();
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(true);
    expect(t.ctx.apiProponerCorreccionUbicacion).not.toHaveBeenCalled();
  });

  test('el boton no hace nada si no hay inversion (aunque se dispare el evento)', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, '2500000', '6350000');
    t.el('btn-ucorr-posgar-intercambiar').emit('click');
    expect(t.el('ucorr-posgar-x').value).toBe('2500000');
    expect(t.el('ucorr-posgar-y').value).toBe('6350000');
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(true);
  });

  test('arreglar los valores a mano tambien saca el aviso de invertidos', async () => {
    const t = await conInvertidos();
    escribirXY(t, '2500000', '6350000');
    expect(t.el('ucorr-posgar-invertido').hidden).toBe(true);
    expect(marcadorNuevo(t)).not.toBeNull();
  });
});

describe('D. POSGAR: mapa, distancia y mapa que falla', () => {
  test('Irrigacion + vigente (fijos) + punto propuesto movible; el mapa se encuadra con los tres (zoom maximo 17)', async () => {
    const t = cargar({ lectura: LECTURA_VIGENTE });
    await abrirPosgar(t);
    expect(marcadoresFijos(t)).toHaveLength(2);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    expect(marcadorNuevo(t).opciones.draggable).toBe(true);
    const ult = t.reg.encuadres[t.reg.encuadres.length - 1];
    expect(ult.puntos).toHaveLength(3);
    expect(ult.puntos[0]).toEqual([EXACTO_POS.latExacta, EXACTO_POS.lonExacta]);
    expect(ult.puntos).toContainEqual([IRR.lat, IRR.lon]);
    expect(ult.puntos).toContainEqual([PUNTO_REAL.lat, PUNTO_REAL.lon]);
    expect(ult.opciones.maxZoom).toBe(17);
  });

  test('sin Irrigacion ni vigente: solo el punto, a zoom 17, sin distancia, y se puede continuar', async () => {
    const t = cargar();
    await abrirPosgar(t, LOCATION_SIN);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    expect(marcadoresFijos(t)).toHaveLength(0);
    expect(t.reg.vistas[t.reg.vistas.length - 1]).toEqual({ c: [EXACTO_POS.latExacta, EXACTO_POS.lonExacta], z: 17 });
    expect(t.el('ucorr-mapa-distancia').textContent).toBe('');
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(false);
    expect(t.el('ucorr-distancia').hidden).toBe(true);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('si el mapa no carga, el formulario POSGAR sigue siendo utilizable y se puede continuar', async () => {
    const t = cargar({ libreriasFallan: true });
    await abrirPosgar(t);
    expect(t.el('ucorr-mapa-error').hidden).toBe(false);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
    expect(t.el('ucorr-coord-equivale-valor').textContent).toMatch(/^-33\./);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-vista-confirmar').hidden).toBe(false);
  });

  const confirmarCon = async (x, y, opc) => {
    const t = cargar(opc);
    await abrirPosgar(t, opc && opc.location);
    escribirXY(t, x, y);
    t.el('btn-ucorr-mapa-usar').click();
    return t;
  };

  test('a ~0 m: observacion opcional, sin advertencias, resumen con el sistema', async () => {
    const t = await confirmarCon(POS_IRR.x, POS_IRR.y);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (opcional)');
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
    expect(t.el('ucorr-resumen').textContent).toMatch(/^Coordenadas POSGAR 94 \/ Argentina 2 · -33\.3476/);
  });

  test('a mas de 250 m (~300 m al norte): observacion OBLIGATORIA; sin ella no se guarda; al escribirla si', async () => {
    const t = await confirmarCon(POS_IRR.x, aArgentino(POS_IRR_NUM.y + 300));
    expect(t.el('ucorr-distancia').textContent).toMatch(/^A (29\d|30\d)(,\d)? m de la ubicación de Irrigación\./);
    expect(t.el('ucorr-obs-label').textContent).toBe('Observación (obligatoria)');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(true);
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(true);
    t.el('ucorr-observacion').value = 'motivo';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('a mas de 1 km (~1,5 km): advertencia fuerte con el texto exacto, y guarda igual si cumple lo demas', async () => {
    const t = await confirmarCon(POS_IRR.x, aArgentino(POS_IRR_NUM.y + 1500));
    expect(t.el('ucorr-advertencia-1km').hidden).toBe(false);
    expect(t.el('ucorr-advertencia-1km').textContent).toBe('La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.');
    t.el('ucorr-observacion').value = 'lejos';
    t.el('ucorr-observacion').emit('input');
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('la vista del mapa tambien muestra la distancia orientativa', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, aArgentino(POS_IRR_NUM.y + 300));
    expect(t.el('ucorr-mapa-distancia').textContent).toMatch(/^A (29\d|30\d)(,\d)? m de la ubicación de Irrigación\./);
  });
});

describe('D. POSGAR: arrastrar el punto -> PUNTO_EN_MAPA, y restaurar', () => {
  async function conPunto(opc) {
    const t = cargar(opc);
    await abrirPosgar(t);
    escribirXY(t, '2.500.000,50', '6.350.000,25');
    return t;
  }
  const EX = Conv.coordenadas_evaluarPosgar({ x: 2500000.5, y: 6350000.25 });

  test('arrastrar: aviso exacto y "Restaurar coordenada ingresada"; el punto manual pasa a ser el punto', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931000123, -69.0001000456);
    expect(t.el('ucorr-coord-movido').hidden).toBe(false);
    expect(t.el('ucorr-coord-movido-texto').textContent).toBe('Moviste el punto manualmente. Se guardará como punto elegido en el mapa.');
    expect(t.el('btn-ucorr-coord-restaurar').textContent).toBe('Restaurar coordenada ingresada');
    expect(t.el('ucorr-mapa-coord').textContent).toBe('-32.9931, -69.0001');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(false);
  });

  test('arrastrado: se guarda como PUNTO_EN_MAPA y coordenadaOriginal DEJA de enviarse (7 campos, lat/lon redondeados)', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931000123, -69.0001000456);
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toBe('Elegida en mapa · -32.9931, -69.0001');
    expect(t.el('ucorr-resumen-original').hidden).toBe(true);
    t.el('ucorr-observacion').value = 'nota';                                  // ~20 km de Irrigacion: la observacion es obligatoria
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(datos).toMatchObject({ metodo: 'PUNTO_EN_MAPA', lat: -32.9931, lon: -69.0001 });
    expect(JSON.stringify(datos)).not.toMatch(/coordenadaOriginal|"x"|"y"/);
  });

  test('Restaurar: vuelve EXACTAMENTE al punto derivado de X/Y, al metodo POSGAR, conserva los X/Y escritos y recupera coordenadaOriginal', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931, -69.0001);
    t.el('btn-ucorr-coord-restaurar').click();
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    expect(marcadorNuevo(t).latlng).toEqual([EX.latExacta, EX.lonExacta]);
    expect(t.el('ucorr-posgar-x').value).toBe('2.500.000,50');
    expect(t.el('ucorr-posgar-y').value).toBe('6.350.000,25');
    t.el('btn-ucorr-mapa-usar').click();
    expect(t.el('ucorr-resumen').textContent).toMatch(/^Coordenadas POSGAR 94 \/ Argentina 2/);
    t.el('ucorr-observacion').value = 'nota';                                  // ~20 km de Irrigacion: la observacion es obligatoria
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('COORDENADAS_POSGAR94_AR2');
    expect(datos.coordenadaOriginal).toEqual({ x: 2500000.5, y: 6350000.25 });
    expect(datos.lat).toBe(EX.latExacta);
    expect(datos.lon).toBe(EX.lonExacta);
  });

  test('si se modifica X o Y despues de arrastrar, la entrada POSGAR vuelve a ser la fuente activa y se recalcula', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931, -69.0001);
    escribirXY(t, '2.500.100,50');
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    const nuevo = Conv.coordenadas_evaluarPosgar({ x: 2500100.5, y: 6350000.25 });
    expect(marcadorNuevo(t).latlng).toEqual([nuevo.latExacta, nuevo.lonExacta]);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('ucorr-observacion').value = 'nota';                                  // ~20 km de Irrigacion: la observacion es obligatoria
    t.el('ucorr-observacion').emit('input');
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('COORDENADAS_POSGAR94_AR2');
    expect(datos.coordenadaOriginal).toEqual({ x: 2500100.5, y: 6350000.25 });
  });

  test('despues de arrastrar, dejar X o Y invalidos quita el punto (no se guarda un punto huerfano)', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931, -69.0001);
    escribirXY(t, 'xx');
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
    expect(marcadorNuevo(t)).toBeNull();
  });

  test('soltar el punto en el mismo lugar NO lo vuelve manual', async () => {
    const t = await conPunto();
    arrastrar(t, EX.latExacta, EX.lonExacta);
    expect(t.el('ucorr-coord-movido').hidden).toBe(true);
  });

  test('arrastrar varias veces y restaurar sigue dando la coordenada original', async () => {
    const t = await conPunto();
    arrastrar(t, -32.9931, -69.0001);
    arrastrar(t, -32.9932, -69.0002);
    t.el('btn-ucorr-coord-restaurar').click();
    expect(marcadorNuevo(t).latlng).toEqual([EX.latExacta, EX.lonExacta]);
  });
});

describe('D. POSGAR: guardado, payload exacto, errores del backend e historial', () => {
  async function listoParaGuardar(opc) {
    const t = cargar(opc);
    await abrirPosgar(t, opc && opc.location);
    escribirXY(t, '2.500.000,50', '6.350.000,25');
    t.el('btn-ucorr-mapa-usar').click();
    t.el('ucorr-observacion').value = ' desde planilla ';
    t.el('ucorr-observacion').emit('input');
    return t;
  }
  const EX = Conv.coordenadas_evaluarPosgar({ x: 2500000.5, y: 6350000.25 });

  test('PAYLOAD EXACTO: 8 campos, metodo POSGAR, precisionGpsM null, lat/lon de MAXIMA precision (sin redondear) y coordenadaOriginal {x, y} numerica', async () => {
    const t = await listoParaGuardar();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const [token, datos] = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0];
    expect(token).toBe('tok-real');
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(datos).toMatchObject({ wellId: W, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null, observacion: 'desde planilla' });
    expect(datos.lat).toBe(EX.latExacta);
    expect(datos.lon).toBe(EX.lonExacta);
    expect(datos.lat).not.toBe(EX.lat);                                      // no el redondeado de presentacion
    expect(datos.coordenadaOriginal).toEqual({ x: 2500000.5, y: 6350000.25 });
    expect(typeof datos.coordenadaOriginal.x).toBe('number');
    expect(datos.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test('NUNCA viaja coordenadaOriginalTexto, crsOriginal, distancia, estado, email, nombre ni flags', async () => {
    const t = await listoParaGuardar();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(JSON.stringify(datos)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|distancia|estado|email|nombre|autoValid|validar|validada|irr|EPSG/i);
  });

  test('guardado OK: cierra el modal, SIEMPRE relee y pinta desde la relectura, con la coordenada ingresada y el sistema', async () => {
    const POS_CORR = Object.assign({}, VIGENTE, { metodo: 'COORDENADAS_POSGAR94_AR2', lat: IRR.lat, lon: IRR.lon, coordenadaOriginalTexto: 'X(Este)=2500000.50, Y(Norte)=6350000.25', crsOriginal: 'EPSG:22182' });
    const t = await listoParaGuardar({
      lectura: { vigente: POS_CORR, pendientes: [], historial: [POS_CORR, VIGENTE] },
      proponer: () => Promise.resolve({ status: 'ok', data: { correccion: POS_CORR, duplicada: false, curada: false, autoValidada: true } })
    });
    t.orden.length = 0;
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.orden).toEqual(['proponer', 'leer']);
    expect(t.el('ucorr-overlay').hidden).toBe(true);
    const html = t.contenedor.innerHTML;
    expect(html).toContain('Ubicación corregida y validada.');
    expect(html).toContain('Coordenadas POSGAR 94 / Argentina 2');
    expect(html).toContain('Coordenada ingresada');
    expect(html).toContain('X(Este)=2500000.50, Y(Norte)=6350000.25');
    expect(html).toContain('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(html.match(/Coordenada ingresada/g)).toHaveLength(2);           // vigente + su fila del historial; la fila de mapa (sin campos) no suma
    expect(html).toContain('Elegida en mapa');
  });

  test('DOBLE CLICK en Guardar: una sola llamada', async () => {
    let resolver;
    const t = await listoParaGuardar({ proponer: () => new Promise((r) => { resolver = r; }) });
    t.el('btn-ucorr-guardar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    resolver({ status: 'ok', data: { correccion: VIGENTE, autoValidada: true } });
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
  });

  test('REINTENTO: el mismo contenido reutiliza el clientRequestId; cambiar X es otro', async () => {
    const t = await listoParaGuardar({ proponer: () => Promise.reject(new Error('timeout')) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ucorr-guardar').click();
    await flush();
    t.el('btn-ucorr-confirmar-volver').click();
    escribirXY(t, '2.500.001,50');
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const ids = t.ctx.apiProponerCorreccionUbicacion.mock.calls.map((c) => c[1].clientRequestId);
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  test.each([
    ['XY_INVERTIDOS', /X e Y están intercambiados/],
    ['COORDENADA_INCONSISTENTE', /no coincide con el punto calculado/],
    ['COORDENADA_INVALIDA', /coordenada ingresada no es válida/],
    ['INVALID_COORDENADA_ORIGINAL', /No se pudo interpretar la coordenada/],
    ['ESQUEMA_DESACTUALIZADO', /todavía no está disponible/],
    ['FUERA_DE_MENDOZA', /fuera de Mendoza/]
  ])('el backend responde %s: mensaje amigable EN el modal, sin codigo tecnico; no cierra y se puede reintentar', async (code, texto) => {
    const t = await listoParaGuardar({ proponer: () => Promise.resolve({ status: 'error', code: code, message: 'texto tecnico', detalle: 'ESTE_FUERA_DE_RANGO', campo: 'x' }) });
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.el('ucorr-overlay').hidden).toBe(false);
    expect(t.el('ucorr-error').textContent).toMatch(texto);
    expect(t.el('ucorr-error').textContent).not.toMatch(new RegExp(code + '|tecnico|ESTE_FUERA'));
    expect(t.el('btn-ucorr-guardar').disabled).toBe(false);
  });

  test('Volver desde confirmar regresa a POSGAR con X/Y intactos y el punto en el mapa', async () => {
    const t = await listoParaGuardar();
    t.el('btn-ucorr-confirmar-volver').click();
    expect(t.el('ucorr-vista-mapa').hidden).toBe(false);
    expect(t.el('ucorr-coord-posgar').hidden).toBe(false);
    expect(t.el('ucorr-posgar-x').value).toBe('2.500.000,50');
    expect(marcadorNuevo(t)).not.toBeNull();
  });
});

describe('D. REGRESION: sumar POSGAR no rompe GMS, GPS, mapa, permisos ni reglas', () => {
  test('GMS sigue completo despues de haber visitado POSGAR (payload GMS de 8 campos con {lat, lon})', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    elegirGms(t);
    escribirIrr(t);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('COORDENADAS_GMS');
    expect(datos.coordenadaOriginal).toEqual(GMS_NUM);
    expect(datos.lat).toBe(EXACTO_IRR.latExacta);
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
  });

  test('"Elegir punto en el mapa" despues de coordenadas: sin panel y con "Usar este punto"; PUNTO_EN_MAPA de 7 campos', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    t.volverBtns[1].click();
    t.el('btn-ucorr-mapa').click();
    await flush();
    expect(t.el('ucorr-coord-panel').hidden).toBe(true);
    expect(t.el('btn-ucorr-mapa-usar').textContent).toBe('Usar este punto');
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos.metodo).toBe('PUNTO_EN_MAPA');
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
  });

  test('GPS despues de POSGAR: GPS_ACTUAL de 7 campos con su precision', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    t.volverBtns[1].click();
    t.el('btn-ucorr-gps').click();
    t.geo.llamadas[t.geo.llamadas.length - 1].ok(posicion(PUNTO_REAL.lat, PUNTO_REAL.lon, 8));
    t.el('btn-ucorr-gps-continuar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    const datos = t.ctx.apiProponerCorreccionUbicacion.mock.calls[0][1];
    expect(datos).toMatchObject({ metodo: 'GPS_ACTUAL', precisionGpsM: 8 });
    expect(Object.keys(datos).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
  });

  test('volver a abrir "Ingresar coordenadas" empieza SIEMPRE en GMS y vacio, aunque se haya salido en POSGAR con datos', async () => {
    const t = cargar();
    await abrirPosgar(t);
    escribirXY(t, POS_IRR.x, POS_IRR.y);
    t.volverBtns[1].click();
    t.el('btn-ucorr-coordenadas').click();
    await flush();
    expect(t.el('btn-ucorr-sistema-gms').atributos['aria-pressed']).toBe('true');
    expect(t.el('ucorr-coord-gms').hidden).toBe(false);
    expect(t.el('ucorr-coord-posgar').hidden).toBe(true);
    expect(t.el('ucorr-posgar-x').value).toBe('');
    expect(marcadorNuevo(t)).toBeNull();
    expect(t.el('btn-ucorr-mapa-usar').disabled).toBe(true);
  });

  test('permisos: sin ubicacion_corregir no existe el boton, por lo tanto tampoco el modal ni POSGAR', async () => {
    const t = cargar({ permisos: { ubicacion: true, ubicacion_corregir: false } });
    await abrirFicha(t);
    expect(t.contenedor.innerHTML).not.toContain('btn-ubic-corr-abrir');
  });

  test('el backend manda la respuesta (VALIDADA o PROPUESTA) y la UI no decide por su cuenta, tambien con POSGAR', async () => {
    for (const [estadoBackend, mensaje] of [['VALIDADA', 'Ubicación corregida y validada.'], ['PROPUESTA', 'Corrección enviada para validación.']]) {
      const corr = Object.assign({}, VIGENTE, { estado: estadoBackend, metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182' });
      const t = cargar({ proponer: () => Promise.resolve({ status: 'ok', data: { correccion: corr, duplicada: false, curada: false } }), lectura: { vigente: estadoBackend === 'VALIDADA' ? corr : null, pendientes: estadoBackend === 'PROPUESTA' ? [corr] : [], historial: [corr] } });
      await abrirPosgar(t);
      escribirXY(t, POS_IRR.x, POS_IRR.y);
      t.el('btn-ucorr-mapa-usar').click();
      t.el('btn-ucorr-guardar').click();
      await flush();
      expect(t.contenedor.innerHTML).toContain(mensaje);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------- validar desde la tarjeta "Pendiente"
describe('ficha: Validar / Rechazar en la tarjeta Pendiente (abre el detalle compartido; sin logica propia)', () => {
  const PERM_VALIDA = { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true };
  const AJENA = Object.assign({}, PENDIENTE, { propia: false });                     // propuesta de otra persona: se puede validar y rechazar
  const LECTURA_PEND = { vigente: VIGENTE, pendientes: [AJENA], historial: [AJENA, VIGENTE] };

  // el clic llega al contenedor con un target que sabe su closest() y sus atributos, como el DOM real
  function tocar(t, accion, id) {
    const boton = { getAttribute: (n) => ({ 'data-uval-accion': accion, 'data-uval-correccion': id })[n] || null };
    t.contenedor.emit('click', { target: { closest: (sel) => (sel === '[data-uval-accion]' ? boton : null) } });
    return boton;
  }

  async function abrirConPendiente(permisos, lectura) {
    const t = cargar({ permisos: permisos, lectura: lectura || LECTURA_PEND });
    t.ctx.ubicacionValidacionController_abrirDetalle = jest.fn();
    await abrirFicha(t);
    return t;
  }

  test('con ubicacion + ubicacion_validar: la tarjeta pendiente trae [Validar] y [Rechazar]', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    expect(t.contenedor.innerHTML).toContain('data-uval-accion="validar" data-uval-correccion="' + PENDIENTE.correccionId + '"');
    expect(t.contenedor.innerHTML).toContain('data-uval-accion="rechazar" data-uval-correccion="' + PENDIENTE.correccionId + '"');
  });

  test('sin ubicacion_validar (incluido quien solo corrige): la tarjeta pendiente NO trae botones', async () => {
    for (const permisos of [{ ubicacion: true, ubicacion_corregir: true }, { ubicacion: true }, { ubicacion: true, ubicacion_validar: 'SI' }, { ubicacion_validar: true }]) {
      const t = await abrirConPendiente(permisos);
      expect(t.contenedor.innerHTML).not.toContain('data-uval-accion');
    }
  });

  test('tocar Validar abre el MISMO detalle con la correccion, la vigente ya cargada, la accion y el boton como origen del foco', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    const boton = tocar(t, 'validar', PENDIENTE.correccionId);
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).toHaveBeenCalledTimes(1);
    const info = t.ctx.ubicacionValidacionController_abrirDetalle.mock.calls[0][0];
    expect(info.correccion.correccionId).toBe(PENDIENTE.correccionId);
    expect(info.vigente.correccionId).toBe(VIGENTE.correccionId);
    expect(info.accion).toBe('validar');
    expect(info.opener).toBe(boton);
  });

  test('tocar Rechazar abre el detalle con la accion "rechazar"', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    tocar(t, 'rechazar', PENDIENTE.correccionId);
    expect(t.ctx.ubicacionValidacionController_abrirDetalle.mock.calls[0][0].accion).toBe('rechazar');
  });

  test('FAIL-CLOSED aunque se fuerce el DOM: sin el permiso, el clic de un boton inyectado no abre nada', async () => {
    const t = await abrirConPendiente({ ubicacion: true, ubicacion_corregir: true });
    tocar(t, 'validar', PENDIENTE.correccionId);
    tocar(t, 'rechazar', PENDIENTE.correccionId);
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).not.toHaveBeenCalled();
  });

  test('el permiso se consulta AL TOCAR: si se pierde con la ficha abierta, el clic no hace nada', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    t.sesion.permisos = { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: false };
    tocar(t, 'validar', PENDIENTE.correccionId);
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).not.toHaveBeenCalled();
  });

  test('un id que no esta entre las pendientes del pozo (DOM manipulado) o un clic fuera de los botones no abre nada; sin el detalle cargado no rompe', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    tocar(t, 'validar', 'otro-id-inventado');
    t.contenedor.emit('click', { target: { closest: () => null } });
    t.contenedor.emit('click', { target: {} });
    t.contenedor.emit('click', {});
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).not.toHaveBeenCalled();
    delete t.ctx.ubicacionValidacionController_abrirDetalle;
    expect(() => tocar(t, 'validar', PENDIENTE.correccionId)).not.toThrow();
  });

  test('el oyente se enlaza UNA vez aunque la seccion se vuelva a pintar (un clic = una apertura)', async () => {
    const t = await abrirConPendiente(PERM_VALIDA);
    t.ctx.ubicacionCorreccionController_alResolver({ wellId: W, mensaje: 'x', tipo: 'ok' });
    await flush();
    tocar(t, 'validar', PENDIENTE.correccionId);
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).toHaveBeenCalledTimes(1);
  });

  describe('alResolver: la validacion termino sobre un pozo', () => {
    test('si es el de esta ficha: vuelve a leer, pinta (la pendiente desaparece, la nueva vigente aparece) y muestra el aviso', async () => {
      const t = cargar({ permisos: PERM_VALIDA, lectura: LECTURA_PEND });
      await abrirFicha(t);
      expect(t.contenedor.innerHTML).toContain('data-uval-accion');
      const nueva = Object.assign({}, PENDIENTE, { estado: 'VALIDADA', resolucion: { evento: 'VALIDADA', nombre: 'Validador', timestamp: PENDIENTE.timestamp, motivo: '' } });
      t.ctx.apiGetCorreccionesUbicacionPozo.mockImplementation(() => Promise.resolve({ status: 'ok', data: { vigente: nueva, pendientes: [], historial: [nueva, Object.assign({}, VIGENTE, { estado: 'SUPERADA' })] } }));
      const antes = t.ctx.apiGetCorreccionesUbicacionPozo.mock.calls.length;
      t.ctx.ubicacionCorreccionController_alResolver({ wellId: W, mensaje: 'Ubicación validada.', tipo: 'ok' });
      await flush();
      expect(t.ctx.apiGetCorreccionesUbicacionPozo.mock.calls.length).toBe(antes + 1);
      expect(t.contenedor.innerHTML).toContain('Ubicación validada.');
      expect(t.contenedor.innerHTML).not.toContain('data-uval-accion');
      expect(t.contenedor.innerHTML).toContain('Reemplazada por una corrección posterior');
    });

    test('"ya resuelta": el aviso es informativo (no de exito)', async () => {
      const t = cargar({ permisos: PERM_VALIDA, lectura: LECTURA_PEND });
      await abrirFicha(t);
      t.ctx.ubicacionCorreccionController_alResolver({ wellId: W, mensaje: 'Esta corrección ya fue resuelta.', tipo: 'resuelta' });
      await flush();
      expect(t.contenedor.innerHTML).toContain('Esta corrección ya fue resuelta.');
      expect(t.contenedor.innerHTML).not.toContain('ucorr-aviso-ok');
    });

    test('si es OTRO pozo, o no hay ficha abierta, o falta la info: no se toca nada ni se lee', async () => {
      const t = cargar({ permisos: PERM_VALIDA, lectura: LECTURA_PEND });
      t.ctx.ubicacionCorreccionController_alResolver({ wellId: W, mensaje: 'x', tipo: 'ok' });         // sin ficha abierta
      expect(t.ctx.apiGetCorreccionesUbicacionPozo).not.toHaveBeenCalled();
      await abrirFicha(t);
      const antes = t.ctx.apiGetCorreccionesUbicacionPozo.mock.calls.length;
      t.ctx.ubicacionCorreccionController_alResolver({ wellId: '99-9999', mensaje: 'x', tipo: 'ok' });
      t.ctx.ubicacionCorreccionController_alResolver(null);
      t.ctx.ubicacionCorreccionController_alResolver();
      await flush();
      expect(t.ctx.apiGetCorreccionesUbicacionPozo.mock.calls.length).toBe(antes);
    });

    test('si al releer falla, la ficha no queda mostrando botones de una pendiente que ya no es', async () => {
      const t = cargar({ permisos: PERM_VALIDA, lectura: LECTURA_PEND });
      await abrirFicha(t);
      t.ctx.apiGetCorreccionesUbicacionPozo.mockImplementation(() => Promise.reject(new Error('sin red')));
      t.ctx.ubicacionCorreccionController_alResolver({ wellId: W, mensaje: 'Ubicación validada.', tipo: 'ok' });
      await flush();
      expect(t.contenedor.innerHTML).not.toContain('data-uval-accion');
    });
  });

  test('regresion: corregir + validar (auto-validacion) sigue guardando como siempre, sin pasar por el detalle de validacion', async () => {
    const t = cargar({ permisos: PERM_VALIDA });
    t.ctx.ubicacionValidacionController_abrirDetalle = jest.fn();
    await abrirModalMapa(t);
    tocarMapa(t, PUNTO_REAL.lat, PUNTO_REAL.lon);
    t.el('btn-ucorr-mapa-usar').click();
    t.el('btn-ucorr-guardar').click();
    await flush();
    expect(t.ctx.apiProponerCorreccionUbicacion).toHaveBeenCalledTimes(1);
    expect(t.contenedor.innerHTML).toContain('Ubicación corregida y validada.');
    expect(t.ctx.ubicacionValidacionController_abrirDetalle).not.toHaveBeenCalled();
  });
});
