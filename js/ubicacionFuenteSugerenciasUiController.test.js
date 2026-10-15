// SUGERENCIAS en la ficha y el visor, ejecutadas DE VERDAD (sin navegador): controlador de "Ubicaciones conocidas" + dialogo compartido (js/ubicacionesConocidas.js +
// js/ubicacionFuenteDecisionesUi.js) con un DOM minimo falso, Leaflet simulado y una API falsa de decisiones Y de sugerencias. Verifica lo que ve y puede hacer quien NO valida
// (sugerir aceptar / descartar / restaurar, ver el estado de su sugerencia, cancelarla), que el VALIDADOR no ve botones de sugerir, y que tarjeta y mapa comparten las mismas acciones.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
const fuentes = ['coordenadasConversion.js', 'ubicacionOperativaLogic.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionesConocidasLogic.js', 'ubicacionFuenteDecisionesUi.js', 'ubicacionesConocidas.js'].map(leer);
const htmlIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };

const W = '14-0001';
const REPORTE = { lat: -33.34765, lon: -69.14545 };
const IRR1 = { lat: -33.34755, lon: -69.14550 };
const IRR2 = { lat: -33.34880, lon: -69.14400 };
const CAMPO = { lat: -33.34745, lon: -69.14545 };

function crearElemento(id) {
  const e = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, listeners: {}, atributos: {},
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
      if (id === 'btn-ucon-ver-todas') {
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
    map() {
      const m = { setView(c, z) { reg.vistas.push({ c, z }); return m; }, fitBounds(p, o) { reg.encuadres.push({ puntos: p, opciones: o }); return m; }, panTo(ll) { reg.pans.push(ll); return m; }, on() { return m; }, invalidateSize() {} };
      reg.mapas.push(m);
      return m;
    },
    layerGroup() { const g = { capas: [], clearLayers() { g.capas = []; }, addTo() { return g; } }; return g; },
    divIcon(o) { return { divIcon: o }; },
    marker(latlng, opciones) {
      const mk = {
        latlng, opciones, popup: null, abierto: 0,
        bindPopup(html, op) { mk.popup = { html, opciones: op }; return mk; }, openPopup() { mk.abierto += 1; return mk; }, getLatLng() { return latlng; },
        addTo(destino) { if (destino && destino.capas) { destino.capas.push(mk); } return mk; }
      };
      reg.marcadores.push(mk);
      return mk;
    }
  };
  return { L, reg };
}

const posgar = (ctx, p) => { const c = ctx.coordenadas_wgs84APosgar(p.lat, p.lon); return { x: Math.round(c.este * 1000) / 1000, y: Math.round(c.norte * 1000) / 1000 }; };

const PERM_VALIDADOR = { perfil: true, datos: true, ubicacion: true, ubicacion_validar: true };
const PERM_LECTOR = { perfil: true, datos: true, ubicacion: true, ubicacion_validar: false };
const PERM_CORREGIR = { perfil: true, datos: true, ubicacion: true, ubicacion_corregir: true };
const PERM_SIN_UBICACION = { perfil: true, datos: true, ubicacion: false, ubicacion_validar: true };

// Una "vista" de getDecisionesFuentesPozo para las 3 fuentes de la ficha: estados en el orden [Reporte, Irrigacion (1), Irrigacion (2)]
function vistaDe(t, estados, extra) {
  const ps = [posgar(t.ctx, REPORTE), posgar(t.ctx, IRR1), posgar(t.ctx, IRR2)];
  const tipos = ['REPORTE_POZOS', 'IRRIGACION', 'IRRIGACION'];
  const e = estados || [];
  return Object.assign({
    wellId: W, version: 5, integro: true, padronPeriodo: '2026-09', obsoletas: [], historial: [], resolucion: { todasDescartadas: false, cambiaRespectoDelOriginal: false },
    fuentes: ps.map((p, i) => ({
      clave: W + '|' + tipos[i] + '|' + p.x.toFixed(3) + '|' + p.y.toFixed(3), fuenteTipo: tipos[i], x: p.x, y: p.y, posicion: i, estado: e[i] || 'SIN_REVISAR',
      esAceptadaVigente: e[i] === 'ACEPTADA', esOperativa: false,
      ultima: e[i] && e[i] !== 'SIN_REVISAR' ? { secuencia: 2, evento: e[i], nombre: 'Ana Pérez', timestampUtc: '2026-10-15T15:00:00.000Z', motivo: e[i] === 'DESCARTADA' ? 'cae en el río' : '' } : null
    }))
  }, extra || {});
}

function cargar(opc) {
  const o = opc || {};
  const entorno = crearEntorno();
  const { L, reg } = crearLeafletFalso();
  const llamadas = { lecturas: [], decisiones: [], sugerencias: [], sugeridas: [], canceladas: [], otras: [] };
  const sandbox = { console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat, setTimeout };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  ctx.document = entorno.documento;
  ctx.L = L;
  ctx.MAPA_CAPA_BASE_DEFAULT = 'calle';
  ctx.mapaShared_cargarLibrerias = jest.fn(() => Promise.resolve());
  ctx.mapaShared_crearCapasBase = jest.fn(() => ({ calle: {}, satelite: {} }));
  ctx.mapaShared_alMostrarMapa = jest.fn((mapa, cb) => cb());
  ctx.mapaShared_cambiarCapaBase = jest.fn();
  ['fetch', 'callBackend', 'apiProponerCorreccionUbicacion', 'apiValidarCorreccionUbicacion', 'apiRechazarCorreccionUbicacion', 'apiGetCorreccionesUbicacionPozo', 'apiGetUbicacionesValidadas']
    .forEach((n) => { ctx[n] = jest.fn(() => { llamadas.otras.push(n); return Promise.resolve({ status: 'ok' }); }); });
  // La API falsa: la lectura devuelve lo que haya en t.vista; decidir ejecuta o.alDecidir(pedido) (por defecto: aplica el cambio de estado y devuelve la vista nueva)
  const t = { ctx, reg, llamadas, vista: null, el: (id) => entorno.documento.getElementById(id), sesionVencida: jest.fn(), permisos: o.permisos || PERM_VALIDADOR };
  ctx.apiGetDecisionesFuentesPozo = jest.fn((token, wellId) => {
    llamadas.lecturas.push({ token, wellId });
    if (o.lecturaFalla) { return Promise.reject(new Error('sin red')); }
    return Promise.resolve(t.respuestaLectura ? t.respuestaLectura() : { status: 'ok', data: JSON.parse(JSON.stringify(t.vista)) });
  });
  ctx.apiDecidirFuenteUbicacion = jest.fn((token, pedido) => {
    llamadas.decisiones.push({ token, pedido });
    return Promise.resolve().then(() => (t.alDecidir ? t.alDecidir(pedido) : aplicar(t, pedido)));
  });
  // --- API de SUGERENCIAS falsa: t.sugs = las que devuelve la lectura (las mas nuevas primero); sugerir / cancelar las modifican como lo haria el backend ---
  t.sugs = [];
  ctx.apiGetSugerenciasFuentesPozo = jest.fn((token, wellId) => {
    llamadas.sugerencias.push({ token, wellId });
    if (o.sugerenciasFallan) { return Promise.reject(new Error('sin red')); }
    return Promise.resolve({ status: 'ok', data: { wellId, version: 5, integro: true, sugerencias: JSON.parse(JSON.stringify(t.sugs)) } });
  });
  ctx.apiSugerirDecisionFuente = jest.fn((token, pedido) => {
    llamadas.sugeridas.push({ token, pedido });
    return Promise.resolve().then(() => (t.alSugerir ? t.alSugerir(pedido) : sugerirPorDefecto(t, pedido)));
  });
  ctx.apiCancelarSugerenciaFuente = jest.fn((token, pedido) => {
    llamadas.canceladas.push({ token, pedido });
    return Promise.resolve().then(() => (t.alCancelar ? t.alCancelar(pedido) : cancelarPorDefecto(t, pedido)));
  });
  ctx.apiResolverSugerenciaFuente = jest.fn(() => { llamadas.otras.push('apiResolverSugerenciaFuente'); return Promise.resolve({ status: 'ok' }); });
  fuentes.forEach((src) => vm.runInContext(src, ctx));
  ctx.ubicacionesConocidasController_inicializar(() => ({ sessionToken: 'tok-sesion', permisos: t.permisos, onSessionExpired: t.sesionVencida }));
  return Object.assign(t, entorno);
}

const ESTADO_NUEVO = { ACEPTAR: 'ACEPTADA', DESCARTAR: 'DESCARTADA', QUITAR_ACEPTACION: 'SIN_REVISAR', RESTAURAR: 'SIN_REVISAR' };
// Comportamiento por defecto del backend falso: aplica la accion sobre la fuente pedida y devuelve la vista nueva (+ decision + duplicada)
function aplicar(t, pedido) {
  const v = JSON.parse(JSON.stringify(t.vista));
  v.fuentes.forEach((f) => {
    if (f.fuenteTipo === pedido.fuenteTipo && f.x === pedido.x && f.y === pedido.y) {
      f.estado = ESTADO_NUEVO[pedido.accion];
      f.ultima = { secuencia: v.version + 1, evento: 'X', nombre: 'Valeria', timestampUtc: '2026-10-15T16:00:00.000Z', motivo: pedido.motivo };
    }
  });
  v.version += 1;
  t.vista = v;
  return { status: 'ok', data: Object.assign({}, v, { decision: { secuencia: v.version, evento: 'X' }, duplicada: false }) };
}

function ficha(t, opc) {
  const o = opc || {};
  const loc = { wellId: W, coordenadas: posgar(t.ctx, REPORTE), coordenadasProvincia: [IRR1, IRR2].map((p) => posgar(t.ctx, p)), ubicacionResuelta: null };
  const rp = posgar(t.ctx, REPORTE);
  const g = t.ctx.coordenadas_posgarAWgs84(rp.x, rp.y);
  loc.ubicacionResuelta = { estado: 'corroborada', x: rp.x, y: rp.y, lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5, distanciaCorroboracion: 11 };
  return o.loc || loc;
}
const abrir = async (t, estados, extra) => {
  t.vista = vistaDe(t, estados, extra);
  t.el('ubic-conocidas');
  t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ficha(t), iconoMaps: '<svg></svg>' });
  await flush();
};
const vigente = () => ({ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'VALIDADA', correccionId: 'c-1' });

// --- ayudas para "tocar" botones (la tarjeta y el popup entregan HTML: se lo parsea igual que lo haria el navegador) ---
function boton(accion, fuenteId) {
  const b = { atributos: { 'data-ufd-accion': accion, 'data-ufd-fuente': fuenteId }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: (sel) => (sel === '[data-ufd-accion]' ? b : null) };
  return b;
}
const accionesEnHtml = (html) => (html.match(/data-ufd-accion="(\w+)" data-ufd-fuente="([^"]+)"/g) || []).map((s) => s.replace(/data-ufd-accion="(\w+)" data-ufd-fuente="([^"]+)"/, '$1@$2'));
function tarjeta(t, id) {
  const html = t.el('ubic-conocidas').innerHTML;
  const partes = html.split('<li class="ucon-fuente');
  const p = partes.filter((x) => x.indexOf('data-ucon-id="' + id + '"') !== -1)[0] || '';
  return '<li class="ucon-fuente' + p;
}
const accionesDe = (html) => accionesEnHtml(html).map((s) => s.split('@')[0]);
const tocarTarjeta = (t, accion, fuenteId) => t.el('ubic-conocidas').emit('click', { target: boton(accion, fuenteId) });
const tocarPopup = (t, accion, fuenteId) => t.el('ucon-mapa').emit('click', { target: boton(accion, fuenteId) });
const abrirVisor = async (t) => { t.el('btn-ucon-ver-todas').click(); await flush(); };
const marcador = (t, etiqueta) => t.reg.marcadores.filter((m) => m.opciones.title === etiqueta).pop();
const dialogoAbierto = (t) => !t.el('ufd-overlay').hidden;
const confirmarDialogo = async (t) => { t.el('btn-ufd-confirmar').click(); await flush(); };

// --- backend falso de sugerencias ---
let contadorSug = 0;
const ACCION_A_SUG = { ACEPTAR: 'ACEPTAR', DESCARTAR: 'DESCARTAR', RESTAURAR: 'RESTAURAR' };
function itemSug(t, extra) {
  contadorSug += 1;
  return Object.assign({
    sugerenciaId: 'sug-' + String(contadorSug).padStart(8, '0'), wellId: W, fuenteTipo: 'REPORTE_POZOS', x: posgar(t.ctx, REPORTE).x, y: posgar(t.ctx, REPORTE).y, etiquetaFuente: 'Reporte Pozos',
    accionSugerida: 'ACEPTAR', motivo: '', nombre: 'Lee Soloubicacion', timestampUtc: '2026-10-14T15:00:00.000Z', estado: 'PENDIENTE', resolucion: null, aplicable: true, motivoNoAplicable: null, estadoFuente: 'SIN_REVISAR'
  }, extra || {});
}
function sugerirPorDefecto(t, p) {
  const ya = t.sugs.filter((s) => s.estado === 'PENDIENTE' && s.fuenteTipo === p.fuenteTipo && s.x === p.x && s.y === p.y && s.accionSugerida === p.accionSugerida)[0];
  if (ya) { return { status: 'error', code: 'ALREADY_PENDING', sugerencia: ya }; }
  const it = itemSug(t, { fuenteTipo: p.fuenteTipo, x: p.x, y: p.y, accionSugerida: ACCION_A_SUG[p.accionSugerida], motivo: p.motivo, etiquetaFuente: p.fuenteTipo === 'REPORTE_POZOS' ? 'Reporte Pozos' : 'Irrigación' });
  t.sugs.unshift(it);
  return { status: 'ok', data: { sugerencia: it, duplicada: false } };
}
function cancelarPorDefecto(t, p) {
  const it = t.sugs.filter((s) => s.sugerenciaId === p.sugerenciaId)[0];
  if (!it || it.estado !== 'PENDIENTE') { return { status: 'error', code: 'SUGGESTION_NOT_FOUND' }; }
  it.estado = 'CANCELADA';
  it.resolucion = { evento: 'CANCELADA', nombre: 'Lee Soloubicacion', timestampUtc: '2026-10-15T16:00:00.000Z', motivo: '' };
  return { status: 'ok', data: { sugerencia: it, duplicada: false } };
}
// el boton de cancelar lleva ademas el id de la sugerencia (data-ufd-sugerencia)
const tocarCancelar = (t, fuenteId, id) => { const b = boton('CANCELAR_SUGERENCIA', fuenteId); b.atributos['data-ufd-sugerencia'] = id; t.el('ubic-conocidas').emit('click', { target: b }); };
const fuenteDe = (t, i) => { const p = [posgar(t.ctx, REPORTE), posgar(t.ctx, IRR1), posgar(t.ctx, IRR2)][i]; return { fuenteTipo: i === 0 ? 'REPORTE_POZOS' : 'IRRIGACION', x: p.x, y: p.y }; };
const PROHIBIDAS_AUTORITATIVAS = /data-ufd-accion="(ACEPTAR|DESCARTAR|QUITAR_ACEPTACION|RESTAURAR)"/;

describe('quien NO valida: lectura y botones de sugerir', () => {
  test('lee las sugerencias del pozo UNA vez (token + pozo) y muestra los botones segun el estado de cada fuente', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(t.llamadas.sugerencias).toEqual([{ token: 'tok-sesion', wellId: W }]);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['SUGERIR_DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_1'))).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['SUGERIR_RESTAURAR']);
    expect(t.el('ubic-conocidas').innerHTML).toContain('>Sugerir aceptar<');
    expect(t.el('ubic-conocidas').innerHTML).not.toMatch(PROHIBIDAS_AUTORITATIVAS);
    expect(t.el('ubic-conocidas').innerHTML).not.toMatch(/Quitar aceptaci/);
  });

  test('"Validada en campo" sigue sin acciones de este dominio', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    expect(accionesEnHtml(tarjeta(t, 'CAMPO_VALIDADA'))).toEqual([]);
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'CAMPO_VALIDADA');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.sugeridas).toEqual([]);
  });

  test('sin permiso de ubicacion no se pide nada', async () => {
    const t = cargar({ permisos: PERM_SIN_UBICACION });
    await abrir(t, []);
    expect(t.llamadas.sugerencias).toEqual([]);
  });

  test('si la lectura de sugerencias falla, la ficha sigue funcionando (sin el estado de las sugerencias)', async () => {
    const t = cargar({ permisos: PERM_LECTOR, sugerenciasFallan: true });
    await abrir(t, []);
    expect((t.el('ubic-conocidas').innerHTML.match(/<li class="ucon-fuente/g) || []).length).toBe(3);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
  });

  test('un clic forzado en una accion autoritativa (o en "quitar aceptacion") NO hace nada: ni dialogo ni pedido', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, ['ACEPTADA']);
    ['ACEPTAR', 'DESCARTAR', 'QUITAR_ACEPTACION', 'RESTAURAR', 'SUGERIR_QUITAR_ACEPTACION'].forEach((a) => tocarTarjeta(t, a, 'REPORTE_POZOS'));
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.llamadas.sugeridas).toEqual([]);
  });

  test('un boton viejo cuya accion ya no corresponde al estado (SUGERIR_RESTAURAR sobre una fuente sin revisar) se ignora', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_RESTAURAR', 'REPORTE_POZOS');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
  });
});

describe('quien NO valida: sugerir', () => {
  test('SUGERIR ACEPTAR: dialogo con el titulo pedido y motivo opcional; el pedido lleva la lista blanca; la tarjeta pasa a "Sugerencia enviada · Pendiente de revisión"', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'IRRIGACION_1');
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-titulo').textContent).toBe('¿Sugerir aceptar esta fuente como referencia registral?');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (opcional)');
    expect(t.el('ufd-motivo-bloque').hidden).toBe(false);
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas).toHaveLength(1);
    const { token, pedido } = t.llamadas.sugeridas[0];
    expect(token).toBe('tok-sesion');
    expect(Object.keys(pedido).sort()).toEqual(['accionSugerida', 'clientRequestId', 'fuenteTipo', 'motivo', 'versionVista', 'wellId', 'x', 'y']);
    expect(pedido).toMatchObject({ wellId: W, fuenteTipo: 'IRRIGACION', accionSugerida: 'ACEPTAR', motivo: '', versionVista: 5 });
    expect(pedido.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(dialogoAbierto(t)).toBe(false);
    const h = tarjeta(t, 'IRRIGACION_1');
    expect(h).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(accionesDe(h)).toEqual(['SUGERIR_DESCARTAR', 'CANCELAR_SUGERENCIA']);               // la misma accion ya no se ofrece; aparece Cancelar sugerencia
    expect(t.el('ubic-conocidas').innerHTML).toContain('Sugerencia enviada. Un validador la va a revisar.');
    expect(t.llamadas.sugerencias).toHaveLength(2);                                            // se releyo
  });

  test('NO modifica nada real: ni decisiones, ni el estado de la fuente, ni el punto operativo que muestra la ficha', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    const antes = tarjeta(t, 'REPORTE_POZOS').match(/Punto operativo/g);
    tocarTarjeta(t, 'SUGERIR_DESCARTAR', 'REPORTE_POZOS');
    t.el('ufd-motivo').value = 'creo que esta mal';
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.llamadas.otras).toEqual([]);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Sin revisar<');                            // la fuente sigue sin revisar
    expect(tarjeta(t, 'REPORTE_POZOS').match(/Punto operativo/g)).toEqual(antes);
  });

  test('SUGERIR DESCARTAR: motivo OBLIGATORIO (sin motivo no se envia nada), aclara que la coordenada original no se eliminara', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_DESCARTAR', 'IRRIGACION_2');
    expect(t.el('ufd-titulo').textContent).toBe('¿Sugerir descartar esta fuente?');
    expect(t.el('ufd-textos').innerHTML).toContain('La coordenada original no se eliminará.');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (obligatorio)');
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas).toEqual([]);
    expect(t.el('ufd-err-motivo').hidden).toBe(false);
    expect(dialogoAbierto(t)).toBe(true);
    t.el('ufd-motivo').value = '   ';
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas).toEqual([]);
    t.el('ufd-motivo').value = '  cae en el cerro  ';
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas[0].pedido).toMatchObject({ accionSugerida: 'DESCARTAR', motivo: 'cae en el cerro' });
    expect(tarjeta(t, 'IRRIGACION_2')).toContain('Sugerencia enviada · Pendiente de revisión');
  });

  test('SUGERIR RESTAURAR sobre una fuente descartada', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, ['SIN_REVISAR', 'SIN_REVISAR', 'DESCARTADA']);
    tocarTarjeta(t, 'SUGERIR_RESTAURAR', 'IRRIGACION_2');
    expect(t.el('ufd-titulo').textContent).toBe('¿Sugerir que esta fuente vuelva a participar del cálculo?');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (opcional)');
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas[0].pedido).toMatchObject({ accionSugerida: 'RESTAURAR' });
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['CANCELAR_SUGERENCIA']);
  });

  test('SUGERIR DESCARTAR sobre una fuente ACEPTADA (la unica sugerencia posible ahi)', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, ['ACEPTADA']);
    tocarTarjeta(t, 'SUGERIR_DESCARTAR', 'REPORTE_POZOS');
    t.el('ufd-motivo').value = 'ya no corresponde';
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas[0].pedido).toMatchObject({ accionSugerida: 'DESCARTAR', fuenteTipo: 'REPORTE_POZOS' });
  });

  test('ALREADY_PENDING: la UI se actualiza con la sugerencia existente y avisa "Ya enviaste esta sugerencia..."; no se repite ni se trata como error fatal', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    // otra pestaña / dispositivo ya la envio: el backend la tiene pero la ficha todavia no la mostraba
    const existente = itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)));
    t.alSugerir = () => { t.sugs.unshift(existente); return { status: 'error', code: 'ALREADY_PENDING', message: 'x', sugerencia: existente }; };
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.sugeridas).toHaveLength(1);
    const h = t.el('ubic-conocidas').innerHTML;
    expect(h).toContain('Ya enviaste esta sugerencia y está pendiente de revisión.');
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(h).not.toMatch(/ALREADY_PENDING/);
  });

  test('PENDING_LIMIT_REACHED: el dialogo queda abierto con el mensaje humano', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    t.alSugerir = () => ({ status: 'error', code: 'PENDING_LIMIT_REACHED', limite: 10 });
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').textContent).toBe('Ya tenés 10 sugerencias pendientes de revisión. Esperá a que las revisen o cancelá alguna.');
    expect(t.el('ufd-error').textContent).not.toMatch(/PENDING_LIMIT/);
  });

  test('STALE / ALREADY_IN_STATE al sugerir: "Esta información cambió mientras la estabas revisando.", se relee y NO se repite sola', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    t.alSugerir = () => { t.vista = vistaDe(t, ['ACEPTADA']); return { status: 'error', code: 'ALREADY_IN_STATE' }; };
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas).toHaveLength(1);
    expect(t.el('ubic-conocidas').innerHTML).toContain('Esta información cambió mientras la estabas revisando.');
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Aceptada<');
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['SUGERIR_DESCARTAR']);              // ya se ve el estado nuevo
    expect(t.llamadas.lecturas).toHaveLength(2);                                                  // decisiones releidas
  });

  test('corte de red: el dialogo queda abierto y el reintento reutiliza el mismo clientRequestId', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    let n = 0;
    t.alSugerir = (p) => { n += 1; return n === 1 ? Promise.reject(new Error('sin red')) : sugerirPorDefecto(t, p); };
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').textContent).toBe('No se pudo enviar. Revisá tu conexión e intentá de nuevo.');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.sugeridas[0].pedido.clientRequestId).toBe(t.llamadas.sugeridas[1].pedido.clientRequestId);
  });

  test('sesion vencida al sugerir: cierra el dialogo y avisa a la app', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    t.alSugerir = () => ({ status: 'error', code: 'UNAUTHORIZED' });
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.sesionVencida).toHaveBeenCalledTimes(1);
  });

  test('doble toque en Confirmar: un solo pedido', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-confirmar').click();
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(t.llamadas.sugeridas).toHaveLength(1);
  });

  test('cancelar el dialogo no envia nada', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-cancelar').click();
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.sugeridas).toEqual([]);
  });
});

describe('quien NO valida: ver y cancelar sus sugerencias', () => {
  test('una sugerencia PENDIENTE propia se ve al abrir la ficha ("Sugerencia enviada") y se puede cancelar', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'x' }, fuenteDe(t, 2)))];
    await abrir(t, []);
    const h = tarjeta(t, 'IRRIGACION_2');
    expect(h).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(h).toContain('Sugeriste descartar esta fuente · 14/10/2026');
    expect(accionesDe(h)).toEqual(['SUGERIR_ACEPTAR', 'CANCELAR_SUGERENCIA']);
  });

  test('CANCELAR: confirmacion "¿Cancelar esta sugerencia?" (sin motivo); el pedido lleva solo el id; la fuente NO cambia; vuelven los botones de sugerir', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    const it = itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)));
    t.sugs = [it];
    await abrir(t, []);
    tocarCancelar(t, 'REPORTE_POZOS', it.sugerenciaId);
    expect(t.el('ufd-titulo').textContent).toBe('¿Cancelar esta sugerencia?');
    expect(t.el('ufd-textos').innerHTML).toContain('Esto no modifica el estado de la fuente.');
    expect(t.el('ufd-motivo-bloque').hidden).toBe(true);
    await confirmarDialogo(t);
    expect(t.llamadas.canceladas).toHaveLength(1);
    expect(Object.keys(t.llamadas.canceladas[0].pedido).sort()).toEqual(['clientRequestId', 'motivo', 'sugerenciaId']);
    expect(t.llamadas.canceladas[0].pedido.sugerenciaId).toBe(it.sugerenciaId);
    expect(t.llamadas.decisiones).toEqual([]);
    const h = tarjeta(t, 'REPORTE_POZOS');
    expect(h).toContain('Sugerencia cancelada');
    expect(h).toContain('>Sin revisar<');
    expect(accionesDe(h)).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(t.el('ubic-conocidas').innerHTML).toContain('Sugerencia cancelada.');
  });

  test('el id a cancelar sale del boton y se verifica contra las pendientes PROPIAS: un id ajeno o inventado no cancela nada', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)))];
    await abrir(t, []);
    const falso = { atributos: { 'data-ufd-accion': 'CANCELAR_SUGERENCIA', 'data-ufd-fuente': 'REPORTE_POZOS', 'data-ufd-sugerencia': 'sug-de-otra-persona' }, getAttribute(n) { return this.atributos[n] === undefined ? null : this.atributos[n]; }, closest() { return this; } };
    t.el('ubic-conocidas').emit('click', { target: falso });
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.canceladas).toEqual([]);
  });

  test('cancelar una que otro ya resolvio (SUGGESTION_NOT_FOUND / ALREADY_RESOLVED): "La sugerencia ya fue resuelta o dejó de estar disponible." y se refresca', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    const it = itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)));
    t.sugs = [it];
    await abrir(t, []);
    t.alCancelar = () => { it.estado = 'RECHAZADA'; it.resolucion = { evento: 'RECHAZADA', nombre: 'Vero', timestampUtc: '2026-10-15T01:00:00.000Z', motivo: 'esta bien ubicada' }; return { status: 'error', code: 'ALREADY_RESOLVED', estado: 'RECHAZADA' }; };
    tocarCancelar(t, 'REPORTE_POZOS', it.sugerenciaId);
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    const h = t.el('ubic-conocidas').innerHTML;
    expect(h).toContain('La sugerencia ya fue resuelta o dejó de estar disponible.');
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('Sugerencia rechazada');
    expect(h).not.toMatch(/ALREADY_RESOLVED|SUGGESTION_NOT_FOUND/);
  });

  test('APROBADA se ve como "Sugerencia aprobada"', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR', estado: 'APROBADA', resolucion: { evento: 'APROBADA', nombre: 'Valeria', timestampUtc: '2026-10-15T01:00:00.000Z', motivo: '' } }, fuenteDe(t, 0)))];
    await abrir(t, ['ACEPTADA']);
    const h = tarjeta(t, 'REPORTE_POZOS');
    expect(h).toContain('Sugerencia aprobada');
    expect(h).toContain('Aprobada por Valeria');
  });

  test('RECHAZADA se ve con su motivo', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'x', estado: 'RECHAZADA', resolucion: { evento: 'RECHAZADA', nombre: 'Vero', timestampUtc: '2026-10-15T01:00:00.000Z', motivo: 'la coordenada es correcta' } }, fuenteDe(t, 0)))];
    await abrir(t, []);
    const h = tarjeta(t, 'REPORTE_POZOS');
    expect(h).toContain('Sugerencia rechazada');
    expect(h).toContain('Motivo: la coordenada es correcta');
    expect(accionesDe(h)).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);                  // puede volver a sugerir
  });

  test('NO APLICABLE (la fuente cambio): el texto pedido, sin ser un error fatal; se puede cancelar y la accion de hoy se ofrece', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR', aplicable: false, motivoNoAplicable: 'YA_NO_CORRESPONDE', estadoFuente: 'DESCARTADA' }, fuenteDe(t, 0)))];
    await abrir(t, ['DESCARTADA']);
    const h = tarjeta(t, 'REPORTE_POZOS');
    expect(h).toContain('Ya no aplicable');
    expect(h).toContain('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    expect(accionesDe(h)).toEqual(['SUGERIR_RESTAURAR', 'CANCELAR_SUGERENCIA']);
    expect(h).not.toMatch(/YA_NO_CORRESPONDE|motivoNoAplicable/);
  });

  test('una sugerencia llega tarde de una ficha anterior: se descarta', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)))];
    let liberar;
    const original = t.ctx.apiGetSugerenciasFuentesPozo;
    let n = 0;
    t.ctx.apiGetSugerenciasFuentesPozo = jest.fn((token, wellId) => {
      n += 1;
      return n === 1 ? new Promise((res) => { liberar = () => res({ status: 'ok', data: { wellId, version: 5, integro: true, sugerencias: JSON.parse(JSON.stringify(t.sugs)) } }); }) : original(token, wellId);
    });
    t.vista = vistaDe(t, []);
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ficha(t), iconoMaps: '' });
    await flush();
    t.sugs = [];
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ficha(t), iconoMaps: '' });
    await flush();
    liberar();
    await flush();
    expect(tarjeta(t, 'REPORTE_POZOS')).not.toContain('Sugerencia enviada');
  });

  test('nada de emails, ids internos ni codigos en lo que se pinta', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [
      itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'x', estado: 'RECHAZADA', resolucion: { evento: 'RECHAZADA', nombre: 'Vero', timestampUtc: '', motivo: 'no' } }, fuenteDe(t, 0))),
      itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR', email: 'otro@x.com', clientRequestId: 'req-9', secuencia: 7 }, fuenteDe(t, 1)))
    ];
    await abrir(t, []);
    const h = t.el('ubic-conocidas').innerHTML.replace(/data-ufd-sugerencia="[^"]*"/g, '');
    expect(h).not.toMatch(/@|req-9|secuencia|PENDIENTE|RECHAZADA|ALREADY|STALE|SUGGESTION/);
  });
});

describe('el VALIDADOR sigue con las decisiones directas y NO ve botones de sugerir', () => {
  test('mantiene Aceptar / Descartar / Quitar aceptacion / Restaurar y ninguna accion de sugerir ni cancelar', async () => {
    const t = cargar({ permisos: PERM_VALIDADOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'm', nombre: 'Ana' }, fuenteDe(t, 1)))];
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_1'))).toEqual(['ACEPTAR', 'DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['RESTAURAR']);
    expect(t.el('ubic-conocidas').innerHTML).not.toMatch(/SUGERIR_|CANCELAR_SUGERENCIA|Sugerir|Cancelar sugerencia/);
  });

  test('ve un aviso de la sugerencia pendiente (cantidad y quien) sin botones; las resuelve en su cola', async () => {
    const t = cargar({ permisos: PERM_VALIDADOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'm', nombre: 'Ana Pérez' }, fuenteDe(t, 1)))];
    await abrir(t, []);
    const h = tarjeta(t, 'IRRIGACION_1');
    expect(h).toContain('1 sugerencia pendiente de revisión');
    expect(h).toContain('Descartar · Ana Pérez');
    expect(tarjeta(t, 'REPORTE_POZOS')).not.toContain('sugerencia pendiente');
    expect(h).not.toMatch(/@/);
  });

  test('un clic forzado en SUGERIR_* (o en cancelar) siendo validador no hace nada', async () => {
    const t = cargar({ permisos: PERM_VALIDADOR });
    await abrir(t, []);
    ['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR', 'SUGERIR_RESTAURAR', 'CANCELAR_SUGERENCIA'].forEach((a) => tocarTarjeta(t, a, 'REPORTE_POZOS'));
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.sugeridas).toEqual([]);
    expect(t.llamadas.canceladas).toEqual([]);
  });

  test('el permiso se consulta fresco: si pierde ubicacion_validar pasa a ver los botones de sugerir; si lo gana, los de decidir', async () => {
    const t = cargar({ permisos: PERM_VALIDADOR });
    await abrir(t, []);
    t.permisos = PERM_LECTOR;
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');                                    // el boton viejo (autoritativo) ya no sirve
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
  });
});

describe('visor "Ver todas en el mapa": las MISMAS acciones de sugerencias que la tarjeta', () => {
  test('el popup de cada marcador ofrece lo mismo que su tarjeta (sugerir / cancelar), para quien no valida', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'DESCARTAR', motivo: 'x' }, fuenteDe(t, 2)))];
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    await abrirVisor(t);
    [['REPORTE_POZOS', 'Reporte Pozos'], ['IRRIGACION_1', 'Irrigación (1)'], ['IRRIGACION_2', 'Irrigación (2)']].forEach(([id, etiqueta]) => {
      expect(accionesEnHtml(marcador(t, etiqueta).popup.html)).toEqual(accionesEnHtml(tarjeta(t, id)));
    });
    expect(marcador(t, 'Irrigación (2)').popup.html).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(marcador(t, 'Reporte Pozos').popup.html).not.toMatch(PROHIBIDAS_AUTORITATIVAS);
  });

  test('sugerir desde el popup abre el MISMO dialogo; al confirmar se actualizan tarjeta y popup y el mapa NO se mueve', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    await abrirVisor(t);
    const encuadres = t.reg.encuadres.length;
    tocarPopup(t, 'SUGERIR_ACEPTAR', 'IRRIGACION_1');
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-titulo').textContent).toBe('¿Sugerir aceptar esta fuente como referencia registral?');
    await confirmarDialogo(t);
    expect(t.llamadas.sugeridas).toHaveLength(1);
    expect(tarjeta(t, 'IRRIGACION_1')).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(marcador(t, 'Irrigación (1)').popup.html).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(accionesDe(marcador(t, 'Irrigación (1)').popup.html)).toEqual(['SUGERIR_DESCARTAR', 'CANCELAR_SUGERENCIA']);
    expect(t.reg.encuadres.length).toBe(encuadres);
    expect(t.el('ucon-visor-nota').textContent).toBe('Sugerencia enviada. Un validador la va a revisar.');
    expect(t.clases.has('ucorr-abierto')).toBe(true);
  });

  test('cancelar desde el popup', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR' }, fuenteDe(t, 0)))];
    await abrir(t, []);
    await abrirVisor(t);
    const id = t.sugs[0].sugerenciaId;
    const b = boton('CANCELAR_SUGERENCIA', 'REPORTE_POZOS');
    b.atributos['data-ufd-sugerencia'] = id;
    t.el('ucon-mapa').emit('click', { target: b });
    expect(t.el('ufd-titulo').textContent).toBe('¿Cancelar esta sugerencia?');
    await confirmarDialogo(t);
    expect(t.llamadas.canceladas[0].pedido.sugerenciaId).toBe(id);
    expect(marcador(t, 'Reporte Pozos').popup.html).toContain('Sugerencia cancelada');
  });

  test('el validador, en el popup, ve el aviso de pendientes pero ningun boton de sugerir', async () => {
    const t = cargar({ permisos: PERM_VALIDADOR });
    t.sugs = [itemSug(t, Object.assign({ accionSugerida: 'ACEPTAR', nombre: 'Ana' }, fuenteDe(t, 0)))];
    await abrir(t, []);
    await abrirVisor(t);
    const p = marcador(t, 'Reporte Pozos').popup.html;
    expect(p).toContain('1 sugerencia pendiente de revisión');
    expect(p).not.toMatch(/SUGERIR_|CANCELAR_SUGERENCIA/);
    expect(accionesDe(p)).toEqual(['ACEPTAR', 'DESCARTAR']);
  });
});

describe('lo que NO se toca', () => {
  test('sugerir y cancelar nunca llaman a decidirFuenteUbicacion, a resolver ni a las correcciones', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'SUGERIR_ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    const id = t.sugs[0].sugerenciaId;
    const b = boton('CANCELAR_SUGERENCIA', 'REPORTE_POZOS');
    b.atributos['data-ufd-sugerencia'] = id;
    t.el('ubic-conocidas').emit('click', { target: b });
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.llamadas.otras).toEqual([]);
  });
});
