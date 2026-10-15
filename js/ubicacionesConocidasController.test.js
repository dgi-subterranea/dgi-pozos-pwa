// Controlador DOM de "Ubicaciones conocidas" (js/ubicacionesConocidas.js) ejecutado de verdad, sin navegador: DOM minimo falso y Leaflet simulado. Verifica lo
// observable: la seccion de la ficha, el boton "Ver todas en el mapa", el visor con N marcadores (el operativo destacado), los popups con su enlace, las distancias,
// la actualizacion cuando llega la correccion vigente, el cierre, los errores del mapa y que NUNCA llama al backend.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
const fuenteConversion = leer('coordenadasConversion.js');
const fuenteOperativa = leer('ubicacionOperativaLogic.js');
const fuenteLogica = leer('ubicacionesConocidasLogic.js');
const fuenteControlador = leer('ubicacionesConocidas.js');
const htmlIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });

const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

// --- coordenadas de prueba (las mismas que la logica) ---
const REPORTE = { lat: -33.34765, lon: -69.14545 };
const IRR1 = { lat: -33.34755, lon: -69.14550 };
const IRR2 = { lat: -33.34880, lon: -69.14400 };
const CAMPO = { lat: -33.34745, lon: -69.14545 };

function crearElemento(id) {
  const e = {
    id: id, hidden: false, textContent: '', innerHTML: '', listeners: {}, atributos: {},
    addEventListener(tipo, f) { (e.listeners[tipo] = e.listeners[tipo] || []).push(f); },
    emit(tipo, ev) { (e.listeners[tipo] || []).forEach((f) => f(ev || {})); },
    click() { e.emit('click', { target: e }); },
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
      if (id === 'btn-ucon-ver-todas') {                       // boton dinamico: solo existe si la seccion lo pinto
        const cont = els['ubic-conocidas'];
        if (!cont || cont.innerHTML.indexOf('id="btn-ucon-ver-todas"') === -1) { return null; }
        if (!els[id] || els[id].html !== cont.innerHTML) { els[id] = crearElemento(id); els[id].html = cont.innerHTML; }
        return els[id];
      }
      if (!els[id]) { els[id] = crearElemento(id); els[id].hidden = OCULTOS_INICIAL.has(id); }
      return els[id];
    },
    querySelectorAll(sel) { return sel === '.ucon-capa-chip' ? chips : []; }
  };
  return { documento, els, chips, clases };
}

function crearLeafletFalso() {
  const reg = { mapas: [], marcadores: [], vistas: [], encuadres: [], pans: [] };
  const L = {
    map(idContenedor) {
      const m = {
        idContenedor, setView(c, z) { reg.vistas.push({ c: c, z: z }); return m; }, fitBounds(puntos, opciones) { reg.encuadres.push({ puntos: puntos, opciones: opciones }); return m; },
        panTo(ll) { reg.pans.push(ll); return m; }, on() { return m; }, invalidateSize() {}
      };
      reg.mapas.push(m);
      return m;
    },
    layerGroup() { const g = { capas: [], clearLayers() { g.capas = []; }, addTo() { return g; } }; return g; },
    divIcon(o) { return { divIcon: o }; },
    marker(latlng, opciones) {
      const mk = {
        latlng: latlng, opciones: opciones, popup: null, abierto: 0,
        bindPopup(html, op) { mk.popup = { html: html, opciones: op }; return mk; }, openPopup() { mk.abierto += 1; return mk; }, getLatLng() { return latlng; },
        addTo(destino) { if (destino && destino.capas) { destino.capas.push(mk); } return mk; }
      };
      reg.marcadores.push(mk);
      return mk;
    }
  };
  return { L, reg };
}

const posgar = (ctx, p) => { const c = ctx.coordenadas_wgs84APosgar(p.lat, p.lon); return { x: Math.round(c.este * 1000) / 1000, y: Math.round(c.norte * 1000) / 1000 }; };

function cargar(opc) {
  const o = opc || {};
  const entorno = crearEntorno();
  const { L, reg } = crearLeafletFalso();
  const llamadasApi = [];
  const sandbox = { console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat, setTimeout };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  ctx.document = entorno.documento;
  ctx.L = L;
  ctx.MAPA_CAPA_BASE_DEFAULT = 'calle';
  let resolverLibrerias = null;
  ctx.mapaShared_cargarLibrerias = jest.fn(() => {
    if (o.libreriasFallan) { return Promise.reject(new Error('sin red')); }
    if (o.libreriasManuales) { return new Promise((res) => { resolverLibrerias = res; }); }
    return Promise.resolve();
  });
  ctx.mapaShared_crearCapasBase = jest.fn(() => ({ calle: {}, satelite: {} }));
  ctx.mapaShared_alMostrarMapa = jest.fn((mapa, cb) => cb());
  ctx.mapaShared_cambiarCapaBase = jest.fn();
  // cualquier llamada a la red/API quedaria registrada: este modulo no deberia hacer ninguna
  ['fetch', 'apiProponerCorreccionUbicacion', 'apiValidarCorreccionUbicacion', 'apiRechazarCorreccionUbicacion', 'apiGetCorreccionesUbicacionPozo', 'apiGetUbicacionesValidadas', 'callBackend']
    .forEach((n) => { ctx[n] = jest.fn(() => { llamadasApi.push(n); return Promise.resolve({ status: 'ok' }); }); });

  vm.runInContext(fuenteConversion, ctx);
  vm.runInContext(fuenteOperativa, ctx);
  vm.runInContext(fuenteLogica, ctx);
  vm.runInContext(fuenteControlador, ctx);
  const el = (id) => entorno.documento.getElementById(id);
  return Object.assign({ ctx, reg, el, llamadasApi, liberarLibrerias: () => resolverLibrerias && resolverLibrerias() }, entorno);
}

function ficha(t, opc) {
  const o = opc || {};
  const provincia = o.provincia || [IRR1, IRR2];
  const loc = { wellId: '14-0001', coordenadasProvincia: provincia.map((p) => posgar(t.ctx, p)), ubicacionResuelta: null };
  if (o.reporte !== false) { loc.coordenadas = posgar(t.ctx, REPORTE); }
  const rp = posgar(t.ctx, o.operativa || REPORTE);
  const g = t.ctx.coordenadas_posgarAWgs84(rp.x, rp.y);
  loc.ubicacionResuelta = o.resuelta === undefined ? { estado: 'corroborada', x: rp.x, y: rp.y, lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, distanciaCorroboracion: 11 } : o.resuelta;
  return loc;
}
const vigente = (extra) => Object.assign({ wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, estado: 'VALIDADA', correccionId: 'c-1' }, extra || {});
const abrirFicha = (t, opc) => { t.el('ubic-conocidas'); t.ctx.ubicacionesConocidasController_abrir({ wellId: '14-0001', location: ficha(t, opc), iconoMaps: '<svg></svg>' }); };

describe('seccion de la ficha', () => {
  test('abrir pinta una fila por fuente (Reporte Pozos, Irrigación (1), Irrigación (2)) en #ubic-conocidas', () => {
    const t = cargar();
    abrirFicha(t);
    const h = t.el('ubic-conocidas').innerHTML;
    expect((h.match(/<li class="ucon-fuente/g) || []).length).toBe(3);
    ['Reporte Pozos', 'Irrigación (1)', 'Irrigación (2)'].forEach((n) => expect(h).toContain(n));
    expect((h.match(/Abrir en Google Maps/g) || []).length).toBe(3);
    expect(h).toContain('id="btn-ucon-ver-todas"');
    expect(h).toContain('<svg></svg>');
  });

  test('sin fuentes no pinta nada (ni titulo ni boton)', () => {
    const t = cargar();
    abrirFicha(t, { reporte: false, provincia: [], resuelta: { estado: 'sinCoordenadas' } });
    expect(t.el('ubic-conocidas').innerHTML).toBe('');
    expect(t.el('btn-ucon-ver-todas')).toBeNull();
  });

  test('si el contenedor no existe (otra pantalla) no falla', () => {
    const t = cargar();
    t.ctx.document.getElementById = (id) => (id === 'ubic-conocidas' ? null : crearElemento(id));
    expect(() => t.ctx.ubicacionesConocidasController_abrir({ wellId: '14-0001', location: ficha(t) })).not.toThrow();
  });

  test('actualizarVigente suma la fuente validada en campo y la hace operativa', () => {
    const t = cargar();
    abrirFicha(t);
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('Validada en campo');
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    const h = t.el('ubic-conocidas').innerHTML;
    expect(h).toContain('<span class="ucon-nombre">Validada en campo</span>');
    expect((h.match(/<li class="ucon-fuente/g) || []).length).toBe(4);
    expect(h).toMatch(/ucon-operativa" data-ucon-id="CAMPO_VALIDADA"/);
    expect((h.match(/ucon-chip-operativo">Punto operativo/g) || []).length).toBe(1);
  });

  test('actualizarVigente con null (se revirtio o no hay) quita la validada y vuelve al padron', () => {
    const t = cargar();
    abrirFicha(t);
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', null);
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('Validada en campo');
  });

  test('una lectura tardia de OTRO pozo no toca esta ficha', () => {
    const t = cargar();
    abrirFicha(t);
    const antes = t.el('ubic-conocidas').innerHTML;
    t.ctx.ubicacionesConocidasController_actualizarVigente('01-0012', vigente({ wellId: '01-0012' }));
    expect(t.el('ubic-conocidas').innerHTML).toBe(antes);
  });

  test('actualizarVigente antes de abrir ninguna ficha no hace nada', () => {
    const t = cargar();
    expect(() => t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente())).not.toThrow();
  });
});

describe('visor comparativo', () => {
  test('"Ver todas en el mapa" abre el visor: titulo con el pozo, cuerpo bloqueado, libreria cargada y mapa creado', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    expect(t.el('ucon-overlay').hidden).toBe(false);
    expect(t.el('ucon-titulo').textContent).toBe('Ubicaciones conocidas · 14-0001');
    expect(t.clases.has('ucorr-abierto')).toBe(true);
    await flush();
    expect(t.ctx.mapaShared_cargarLibrerias).toHaveBeenCalledTimes(1);
    expect(t.reg.mapas.map((m) => m.idContenedor)).toEqual(['ucon-mapa']);
    expect(t.el('ucon-mapa').hidden).toBe(false);
    expect(t.el('ucon-mapa-cargando').hidden).toBe(true);
  });

  test('N=3 fuentes -> 3 marcadores, cada uno en SU coordenada, el operativo con prioridad y todos con popup', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.marcadores).toHaveLength(3);
    const latlons = t.reg.marcadores.map((m) => m.latlng);
    [REPORTE, IRR1, IRR2].forEach((p) => {
      expect(latlons.some((ll) => Math.abs(ll[0] - p.lat) < 2e-5 && Math.abs(ll[1] - p.lon) < 2e-5)).toBe(true);
    });
    const op = t.reg.marcadores.filter((m) => m.opciones.zIndexOffset === 1000);
    expect(op).toHaveLength(1);                                          // el punto operativo, arriba de todo
    expect(op[0].opciones.title).toBe('Reporte Pozos');
    expect(op[0].opciones.icon.divIcon.html).toContain('ucon-marker-op');
    expect(op[0].opciones.icon.divIcon.html).toContain('Reporte Pozos ★');
    t.reg.marcadores.forEach((m) => expect(m.popup.html).toContain('Abrir en Google Maps'));
  });

  test('cada popup lleva su fuente, lat/lon, distancia al operativo y su propio enlace (sin datos personales)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    const irr2 = t.reg.marcadores.filter((m) => m.opciones.title === 'Irrigación (2)')[0];
    expect(irr2.popup.html).toContain('Irrigación (2)');
    expect(irr2.popup.html).toContain('del punto operativo');
    const m = /query=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(irr2.popup.html);
    expect(Math.abs(parseFloat(m[1]) - IRR2.lat)).toBeLessThan(2e-5);
    expect(Math.abs(parseFloat(m[2]) - IRR2.lon)).toBeLessThan(2e-5);
    expect(irr2.popup.html).not.toMatch(/14-0001|@|secreto/);
    const reporte = t.reg.marcadores.filter((x) => x.opciones.title === 'Reporte Pozos')[0];
    expect(reporte.popup.html).toContain('Punto operativo');
    expect(reporte.popup.html).not.toContain('del punto operativo');
  });

  test('con 2 o mas puntos encuadra todos juntos; con 1 solo centra en el (zoom 17)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.encuadres).toHaveLength(1);
    expect(t.reg.encuadres[0].puntos).toHaveLength(3);
    expect(t.reg.encuadres[0].opciones.maxZoom).toBeLessThanOrEqual(18);

    const t1 = cargar();
    abrirFicha(t1, { reporte: true, provincia: [], operativa: REPORTE });
    t1.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t1.reg.marcadores).toHaveLength(1);
    expect(t1.reg.encuadres).toHaveLength(0);
    expect(t1.reg.vistas[t1.reg.vistas.length - 1].z).toBe(17);
  });

  test('N=4 con la validada en campo: 4 marcadores y el operativo pasa a ser la validada', async () => {
    const t = cargar();
    abrirFicha(t);
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.marcadores).toHaveLength(4);
    const op = t.reg.marcadores.filter((m) => m.opciones.zIndexOffset === 1000);
    expect(op.map((m) => m.opciones.title)).toEqual(['Validada en campo']);
    expect(t.el('ucon-leyenda').innerHTML.match(/data-ucon-foco/g)).toHaveLength(4);
  });

  test('N=8: muchas fuentes tambien se dibujan, una por marcador', async () => {
    const t = cargar();
    const muchas = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: -33.3476 - i * 0.0004, lon: -69.1454 + i * 0.0003 }));
    abrirFicha(t, { provincia: muchas, operativa: muchas[2] });
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.marcadores).toHaveLength(8);
    expect(new Set(t.reg.marcadores.map((m) => m.opciones.title)).size).toBe(8);
  });

  test('la leyenda lista cada fuente con su distancia; tocar una fila enfoca su marcador (centra y abre el popup)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    const ley = t.el('ucon-leyenda');
    expect(ley.innerHTML).toContain('Punto operativo');
    expect(ley.innerHTML).toContain('del punto operativo');
    const fila = { getAttribute: (n) => (n === 'data-ucon-foco' ? 'IRRIGACION_2' : null) };
    ley.emit('click', { target: { closest: () => fila } });
    const irr2 = t.reg.marcadores.filter((m) => m.opciones.title === 'Irrigación (2)')[0];
    expect(irr2.abierto).toBe(1);
    expect(t.reg.pans).toHaveLength(1);
    ley.emit('click', { target: { closest: () => null } });                    // un toque fuera de las filas no hace nada
    expect(t.reg.pans).toHaveLength(1);
  });

  test('sin punto operativo (discrepancia): el visor lo avisa, ningun marcador es operativo y no hay distancias', async () => {
    const t = cargar();
    abrirFicha(t, { provincia: [{ lat: -33.36, lon: -69.13 }], resuelta: { estado: 'revisar', distanciaMaxima: 2000 } });
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.el('ucon-visor-nota').hidden).toBe(false);
    expect(t.el('ucon-visor-nota').textContent).toContain('No hay punto operativo');
    expect(t.reg.marcadores).toHaveLength(2);
    expect(t.reg.marcadores.every((m) => m.opciones.zIndexOffset === 300)).toBe(true);
    expect(t.reg.marcadores.every((m) => m.popup.html.indexOf('del punto operativo') === -1)).toBe(true);
  });

  test('si llega la validada con el visor abierto, el mapa se redibuja con N+1 marcadores', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.marcadores).toHaveLength(3);
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    expect(t.reg.marcadores).toHaveLength(7);                     // 3 + 4 nuevos (el grupo se limpio y se volvio a dibujar)
    expect(t.el('ucon-leyenda').innerHTML.match(/data-ucon-foco/g)).toHaveLength(4);
  });

  test('las capas Mapa / Satelite del visor cambian la base', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    t.chips[1].click();
    expect(t.ctx.mapaShared_cambiarCapaBase).toHaveBeenCalledTimes(1);
    expect(t.ctx.mapaShared_cambiarCapaBase.mock.calls[0][1]).toBe('satelite');
  });

  test('reabrir el visor reutiliza el mismo mapa (no crea otro)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    t.el('btn-ucon-cerrar').click();
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.reg.mapas).toHaveLength(1);
  });
});

describe('errores y cierre', () => {
  test('si el mapa no carga: mensaje, sin mapa, y el visor sigue abierto con la leyenda', async () => {
    const t = cargar({ libreriasFallan: true });
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    expect(t.el('ucon-mapa-error').hidden).toBe(false);
    expect(t.el('ucon-mapa').hidden).toBe(true);
    expect(t.el('ucon-mapa-cargando').hidden).toBe(true);
    expect(t.el('ucon-overlay').hidden).toBe(false);
    expect(t.el('ucon-leyenda').innerHTML).toContain('Reporte Pozos');
    expect(t.reg.marcadores).toHaveLength(0);
  });

  test('cerrar (x, boton Cerrar o Escape) oculta el visor, libera el cuerpo y devuelve el foco', async () => {
    for (const via of ['x', 'abajo', 'esc']) {
      const t = cargar();
      abrirFicha(t);
      const boton = t.el('btn-ucon-ver-todas');
      boton.focus = jest.fn();                                          // el foco vuelve al boton que abrio el visor
      boton.click();
      await flush();
      if (via === 'x') { t.el('btn-ucon-cerrar').click(); }
      if (via === 'abajo') { t.el('btn-ucon-cerrar-abajo').click(); }
      if (via === 'esc') { t.el('ucon-overlay').emit('keydown', { key: 'Escape' }); }
      expect(t.el('ucon-overlay').hidden).toBe(true);
      expect(t.clases.has('ucorr-abierto')).toBe(false);
      expect(boton.focus).toHaveBeenCalledTimes(1);
    }
  });

  test('otra tecla no cierra', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    t.el('ucon-overlay').emit('keydown', { key: 'a' });
    expect(t.el('ucon-overlay').hidden).toBe(false);
  });

  test('si se cierra mientras la libreria carga, nada se dibuja despues', async () => {
    const t = cargar({ libreriasManuales: true });
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    t.el('btn-ucon-cerrar').click();
    t.liberarLibrerias();
    await flush();
    expect(t.reg.mapas).toHaveLength(0);
    expect(t.reg.marcadores).toHaveLength(0);
  });

  test('cerrar con el visor cerrado NO toca la clase del cuerpo (otro modal podria estar abierto)', () => {
    const t = cargar();
    t.clases.add('ucorr-abierto');                                  // p. ej. el modal "Corregir ubicacion"
    t.ctx.ubicacionesConocidasController_cerrar();
    abrirFicha(t);                                                    // abrir otra ficha tambien llama a cerrar
    expect(t.clases.has('ucorr-abierto')).toBe(true);
  });

  test('abrir otra ficha cierra un visor que estaba abierto (logout / nueva busqueda)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    abrirFicha(t);
    expect(t.el('ucon-overlay').hidden).toBe(true);
    expect(t.clases.has('ucorr-abierto')).toBe(false);
  });

  test('ubicacionesConocidasController_cerrar (logout) cierra el visor abierto', async () => {
    const t = cargar();
    abrirFicha(t);
    t.el('btn-ucon-ver-todas').click();
    await flush();
    t.ctx.ubicacionesConocidasController_cerrar();
    expect(t.el('ucon-overlay').hidden).toBe(true);
  });
});

describe('sin contexto de sesion no hay red; nunca se modifica una coordenada', () => {
  test('ver la seccion, abrir el visor, enfocar, cambiar capa y cerrar (sin contexto de sesion) no hacen ninguna llamada a la API ni a la red', async () => {
    const t = cargar();
    abrirFicha(t);
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    t.el('btn-ucon-ver-todas').click();
    await flush();
    t.el('ucon-leyenda').emit('click', { target: { closest: () => ({ getAttribute: () => 'CAMPO_VALIDADA' }) } });
    t.chips[1].click();
    t.el('btn-ucon-cerrar').click();
    expect(t.llamadasApi).toEqual([]);
  });

  test('el codigo del controlador no hace fetch ni escribe nada por su cuenta: la unica API que llama es la lectura de decisiones; decidir va por el dialogo compartido', () => {
    const codigo = fuenteControlador.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(codigo).not.toMatch(/fetch\(|callBackend|XMLHttpRequest|localStorage|sessionStorage|apiProponer|apiValidar|apiRechazar|apiDecidirFuente|eliminar|borrar/i);
    expect(codigo.match(/\bapi[A-Z]\w*\(/g)).toEqual(['apiGetDecisionesFuentesPozo(']);
  });
});

describe('etiquetas de los marcadores', () => {
  test('el operativo lleva la etiqueta arriba y las demas alternan abajo / arriba (para que las muy juntas no se pisen todas)', async () => {
    const t = cargar();
    abrirFicha(t);
    t.ctx.ubicacionesConocidasController_actualizarVigente('14-0001', vigente());
    t.el('btn-ucon-ver-todas').click();
    await flush();
    const arriba = (titulo) => /ucorr-marker-arriba/.test(t.reg.marcadores.filter((m) => m.opciones.title === titulo)[0].opciones.icon.divIcon.html);
    expect(arriba('Validada en campo')).toBe(true);        // operativo
    expect(arriba('Reporte Pozos')).toBe(false);           // 1.a no operativa: abajo
    expect(arriba('Irrigación (1)')).toBe(true);           // 2.a: arriba
    expect(arriba('Irrigación (2)')).toBe(false);          // 3.a: abajo
  });
});
