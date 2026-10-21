// Decisiones sobre las fuentes registrales ejecutadas DE VERDAD (sin navegador): controlador de "Ubicaciones conocidas" + dialogo de confirmacion compartido
// (js/ubicacionesConocidas.js + js/ubicacionFuenteDecisionesUi.js) con un DOM minimo falso, Leaflet simulado y una API falsa. Verifica el flujo del validador (tarjeta y
// popup del mapa con el MISMO dialogo), lo que ve quien no valida, las confirmaciones, el motivo, STALE_STATE, la sesion vencida, los reintentos y que "Validada en campo"
// nunca tiene acciones.
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
  const llamadas = { lecturas: [], decisiones: [], otras: [] };
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

// =====================================================================================================================

describe('lectura del estado de las fuentes', () => {
  test('con ubicacion: lee getDecisionesFuentesPozo UNA vez con el token y el pozo de la ficha, y muestra el estado de cada fuente registral', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(t.llamadas.lecturas).toEqual([{ token: 'tok-sesion', wellId: W }]);
    const h = t.el('ubic-conocidas').innerHTML;
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Aceptada<');
    expect(tarjeta(t, 'IRRIGACION_1')).toContain('>Sin revisar<');
    expect(tarjeta(t, 'IRRIGACION_2')).toContain('>Descartada<');
    expect(tarjeta(t, 'IRRIGACION_2')).toContain('Descartada por Ana Pérez · 15/10/2026 · cae en el río');
    expect(h).not.toMatch(/@|decisionId|clientRequestId/);
  });

  test('sin permiso de ubicacion: ni siquiera se pide la lectura', async () => {
    const t = cargar({ permisos: PERM_SIN_UBICACION });
    await abrir(t, []);
    expect(t.llamadas.lecturas).toEqual([]);
    expect(accionesEnHtml(t.el('ubic-conocidas').innerHTML)).toEqual([]);
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('ufd-estado');
  });

  test('si la lectura falla la seccion queda como antes (sin estados ni acciones) y no se rompe', async () => {
    const t = cargar({ lecturaFalla: true });
    await abrir(t, []);
    const h = t.el('ubic-conocidas').innerHTML;
    expect((h.match(/<li class="ucon-fuente/g) || []).length).toBe(3);
    expect(h).not.toContain('ufd-estado');
    expect(accionesEnHtml(h)).toEqual([]);
  });

  test('una respuesta de error o de otro pozo no pinta nada', async () => {
    const t = cargar();
    t.respuestaLectura = () => ({ status: 'error', code: 'PERMISSION_DENIED' });
    await abrir(t, []);
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('ufd-estado');
    const t2 = cargar();
    t2.respuestaLectura = () => ({ status: 'ok', data: Object.assign(vistaDe(t2, []), { wellId: '01-0012' }) });
    await abrir(t2, []);
    expect(t2.el('ubic-conocidas').innerHTML).not.toContain('ufd-estado');
  });

  test('una lectura que llega tarde de una ficha anterior se descarta', async () => {
    const t = cargar();
    let liberar;
    let n = 0;
    t.respuestaLectura = () => {
      n += 1;
      return n === 1 ? new Promise((res) => { liberar = () => res({ status: 'ok', data: vistaDe(t, ['ACEPTADA']) }); }) : { status: 'ok', data: vistaDe(t, []) };
    };
    t.vista = vistaDe(t, []);
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ficha(t), iconoMaps: '' });      // 1ra apertura: su lectura queda pendiente
    await flush();
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ficha(t), iconoMaps: '' });      // otra apertura: lee de nuevo
    await flush();
    liberar();                                                                                          // llega tarde la lectura de la 1ra
    await flush();
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Sin revisar<');                                  // no quedo el estado de la lectura vieja
  });
});

describe('que acciones ve cada rol en las tarjetas', () => {
  test('VALIDADOR: SIN_REVISAR -> Aceptar, Descartar | ACEPTADA -> Quitar aceptacion, Descartar | DESCARTADA -> Restaurar', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_1'))).toEqual(['ACEPTAR', 'DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['RESTAURAR']);
  });

  test.each([['usuario que no valida', PERM_LECTOR], ['quien solo corrige (ubicacion_corregir no concede decidir)', PERM_CORREGIR]])('%s: ve los estados y SOLO acciones de SUGERIR, ninguna autoritativa', async (_n, permisos) => {
    const t = cargar({ permisos });
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    const h = t.el('ubic-conocidas').innerHTML;
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['SUGERIR_DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_1'))).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['SUGERIR_RESTAURAR']);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Aceptada<');
    expect(h).not.toMatch(/data-ufd-accion="(ACEPTAR|DESCARTAR|QUITAR_ACEPTACION|RESTAURAR)"/);
    expect(h).not.toMatch(/>Aceptar<|>Descartar<|>Restaurar<|Quitar aceptaci/);
  });

  test('un clic forzado en un boton que NO existe para este usuario no hace nada (ni dialogo ni pedido)', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, []);
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
  });

  test('un boton viejo cuya accion ya no corresponde al estado actual se ignora (RESTAURAR sobre una fuente sin revisar)', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'RESTAURAR', 'REPORTE_POZOS');
    tocarTarjeta(t, 'QUITAR_ACEPTACION', 'IRRIGACION_1');
    tocarTarjeta(t, 'ACEPTAR', 'NO_EXISTE');
    tocarTarjeta(t, 'ELIMINAR', 'REPORTE_POZOS');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
  });

  test('"Validada en campo" no tiene estado ni acciones, aunque el validador este viendo todo lo demas', async () => {
    const t = cargar();
    await abrir(t, []);
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    const campo = tarjeta(t, 'CAMPO_VALIDADA');
    expect(campo).toContain('Validada en campo');
    expect(campo).not.toContain('ufd-estado');
    expect(accionesEnHtml(campo)).toEqual([]);
    tocarTarjeta(t, 'ACEPTAR', 'CAMPO_VALIDADA');
    tocarTarjeta(t, 'DESCARTAR', 'CAMPO_VALIDADA');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['ACEPTAR', 'DESCARTAR']);                  // las registrales siguen igual
  });

  test('historial inconsistente: sin acciones y con el aviso (sin codigos tecnicos)', async () => {
    const t = cargar();
    await abrir(t, [], { integro: false });
    const h = t.el('ubic-conocidas').innerHTML;
    expect(accionesEnHtml(h)).toEqual([]);
    expect(h).toContain('necesita una revisión técnica');
    expect(h).not.toMatch(/INCONSISTENT|SECUENCIA_|anomal/i);
  });

  test('todas descartadas: el aviso pedido y NINGUNA nota de "los mapas todavia no cambian" (ya es falsa: el mapa sigue a las decisiones)', async () => {
    const t = cargar();
    await abrir(t, ['DESCARTADA', 'DESCARTADA', 'DESCARTADA'], { resolucion: { todasDescartadas: true, cambiaRespectoDelOriginal: true } });
    const h = t.el('ubic-conocidas').innerHTML;
    expect(h).toContain('Sin ubicación operativa de Irrigación. Todas las fuentes conocidas fueron descartadas.');
    expect(h).not.toMatch(/todavía no cambian|todavia no cambian|no cambian el punto/);
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['RESTAURAR']);
  });
});

describe('flujo del validador desde la tarjeta', () => {
  test('ACEPTAR: dialogo con la pregunta, motivo opcional; al confirmar viaja el pedido exacto y la tarjeta pasa a "Aceptada"', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'ACEPTAR', 'IRRIGACION_1');
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-titulo').textContent).toBe('¿Aceptar esta fuente como referencia registral?');
    expect(t.el('ufd-fuente').textContent).toBe('Irrigación (1)');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (opcional)');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toHaveLength(1);
    const { token, pedido } = t.llamadas.decisiones[0];
    expect(token).toBe('tok-sesion');
    expect(Object.keys(pedido).sort()).toEqual(['accion', 'clientRequestId', 'fuenteTipo', 'motivo', 'versionVista', 'wellId', 'x', 'y']);
    expect(pedido).toMatchObject({ wellId: W, fuenteTipo: 'IRRIGACION', accion: 'ACEPTAR', motivo: '', versionVista: 5 });
    expect(pedido.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(dialogoAbierto(t)).toBe(false);
    expect(tarjeta(t, 'IRRIGACION_1')).toContain('>Aceptada<');
    expect(accionesDe(tarjeta(t, 'IRRIGACION_1'))).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(t.el('ubic-conocidas').innerHTML).toContain('Fuente aceptada como referencia registral.');
    expect(t.llamadas.lecturas).toHaveLength(1);                                    // la vista nueva viene en la respuesta: no hace falta releer
  });

  test('ACEPTAR con una validada en campo vigente aclara que la ubicacion operativa sigue siendo la validada', async () => {
    const t = cargar();
    await abrir(t, []);
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    expect(t.el('ufd-textos').innerHTML).toContain('Esta fuente quedará aceptada como referencia registral, pero la ubicación operativa seguirá siendo la validada en campo.');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[0].pedido.accion).toBe('ACEPTAR');
    expect(tarjeta(t, 'CAMPO_VALIDADA')).toContain('Punto operativo');                // lo operativo sigue siendo la validada
  });

  test('ACEPTAR sin validada en campo: no aparece ese aviso', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    expect(t.el('ufd-textos').innerHTML).not.toContain('validada en campo');
  });

  test('DESCARTAR: el motivo es OBLIGATORIO (sin motivo no se envia nada y se explica); con motivo se descarta y la coordenada se conserva en pantalla', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'DESCARTAR', 'IRRIGACION_2');
    expect(t.el('ufd-titulo').textContent).toBe('¿Descartar esta fuente?');
    expect(t.el('ufd-textos').innerHTML).toContain('La coordenada original no se eliminará. Quedará conservada y marcada como descartada.');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (obligatorio)');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.el('ufd-err-motivo').hidden).toBe(false);
    expect(t.el('ufd-err-motivo').textContent).toBe('Indicá el motivo del descarte.');
    expect(dialogoAbierto(t)).toBe(true);
    t.el('ufd-motivo').value = '   ';
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toEqual([]);
    t.el('ufd-motivo').value = '  coordenada fuera del predio  ';
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[0].pedido).toMatchObject({ accion: 'DESCARTAR', motivo: 'coordenada fuera del predio', fuenteTipo: 'IRRIGACION' });
    const h = tarjeta(t, 'IRRIGACION_2');
    expect(h).toContain('>Descartada<');
    expect(h).toContain('ucon-descartada');
    expect(h).toContain('-33.3');                                                      // la coordenada original sigue a la vista
    expect(h).toContain('Descartada por Valeria · 15/10/2026 · coordenada fuera del predio');
    expect(accionesDe(h)).toEqual(['RESTAURAR']);
  });

  test('descartar una fuente ACEPTADA es un solo paso y el dialogo lo avisa', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA']);
    tocarTarjeta(t, 'DESCARTAR', 'REPORTE_POZOS');
    expect(t.el('ufd-textos').innerHTML).toContain('al descartarla también se quita su aceptación');
    t.el('ufd-motivo').value = 'ya no corresponde';
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toHaveLength(1);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Descartada<');
  });

  test('QUITAR ACEPTACION: confirmacion simple (motivo opcional) y la fuente vuelve a "Sin revisar"', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA']);
    tocarTarjeta(t, 'QUITAR_ACEPTACION', 'REPORTE_POZOS');
    expect(t.el('ufd-titulo').textContent).toBe('¿Quitar la aceptación de esta fuente?');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[0].pedido.accion).toBe('QUITAR_ACEPTACION');
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Sin revisar<');
    expect(t.el('ubic-conocidas').innerHTML).toContain('Se quitó la aceptación de la fuente.');
  });

  test('RESTAURAR: aclara que vuelve al calculo y NO queda aceptada; despues queda "Sin revisar", no "Aceptada"', async () => {
    const t = cargar();
    await abrir(t, ['SIN_REVISAR', 'SIN_REVISAR', 'DESCARTADA']);
    tocarTarjeta(t, 'RESTAURAR', 'IRRIGACION_2');
    expect(t.el('ufd-textos').innerHTML).toContain('La fuente volverá a participar del cálculo automático. No quedará aceptada automáticamente.');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[0].pedido.accion).toBe('RESTAURAR');
    expect(tarjeta(t, 'IRRIGACION_2')).toContain('>Sin revisar<');
    expect(accionesDe(tarjeta(t, 'IRRIGACION_2'))).toEqual(['ACEPTAR', 'DESCARTAR']);
  });

  test('cancelar (boton, X o Escape) no envia nada y devuelve el foco', async () => {
    const t = cargar();
    await abrir(t, []);
    const btn = boton('ACEPTAR', 'REPORTE_POZOS');
    btn.focus = jest.fn();
    t.el('ubic-conocidas').emit('click', { target: btn });
    t.el('btn-ufd-cancelar').click();
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(btn.focus).toHaveBeenCalled();
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-cerrar').click();
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    t.el('ufd-overlay').emit('keydown', { key: 'Escape' });
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.clases.has('ucorr-abierto')).toBe(false);
  });

  test('doble toque en Confirmar: un solo pedido', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-confirmar').click();
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(t.llamadas.decisiones).toHaveLength(1);
  });

  test('mientras se guarda: boton y motivo deshabilitados, indicador visible; al terminar se rehabilitan', async () => {
    const t = cargar();
    await abrir(t, []);
    let responder;
    t.alDecidir = (p) => new Promise((res) => { responder = () => res(aplicar(t, p)); });
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(t.el('btn-ufd-confirmar').disabled).toBe(true);
    expect(t.el('btn-ufd-cancelar').disabled).toBe(true);
    expect(t.el('ufd-guardando').hidden).toBe(false);
    responder();
    await flush();
    expect(t.el('btn-ufd-confirmar').disabled).toBe(false);
    expect(t.el('ufd-guardando').hidden).toBe(true);
  });
});

describe('errores y concurrencia', () => {
  test('STALE_STATE: "Esta información cambió mientras la estabas revisando.", se relee, se muestra el estado nuevo y NO se repite la decision', async () => {
    const t = cargar();
    await abrir(t, []);
    t.alDecidir = () => {
      t.vista = vistaDe(t, ['DESCARTADA'], { version: 9 });          // otro usuario descarto el Reporte mientras mirabas
      return { status: 'error', code: 'STALE_STATE', message: 'x', versionActual: 9 };
    };
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toHaveLength(1);                     // no se reintento solo
    expect(dialogoAbierto(t)).toBe(false);
    const h = t.el('ubic-conocidas').innerHTML;
    expect(h).toContain('Esta información cambió mientras la estabas revisando.');
    expect(h).not.toMatch(/STALE_STATE|versionActual/);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Descartada<');
    expect(accionesDe(tarjeta(t, 'REPORTE_POZOS'))).toEqual(['RESTAURAR']);
    expect(t.llamadas.lecturas).toHaveLength(2);                       // la apertura + la relectura
    // el usuario ahora decide con la version NUEVA
    t.alDecidir = null;
    tocarTarjeta(t, 'RESTAURAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[1].pedido.versionVista).toBe(9);
  });

  test('SOURCE_NOT_FOUND (la fuente desaparecio por un reindexado): se informa y se relee', async () => {
    const t = cargar();
    await abrir(t, []);
    t.alDecidir = () => { t.vista = vistaDe(t, [], { version: 7 }); return { status: 'error', code: 'SOURCE_NOT_FOUND' }; };
    tocarTarjeta(t, 'ACEPTAR', 'IRRIGACION_2');
    await confirmarDialogo(t);
    expect(t.el('ubic-conocidas').innerHTML).toContain('Esa fuente ya no figura en el padrón');
    expect(t.llamadas.lecturas).toHaveLength(2);
    expect(t.llamadas.decisiones).toHaveLength(1);
  });

  test('ALREADY_IN_STATE / INVALID_TRANSITION: tambien "desactualizado" con relectura', async () => {
    for (const code of ['ALREADY_IN_STATE', 'INVALID_TRANSITION']) {
      const t = cargar();
      await abrir(t, []);
      t.alDecidir = () => ({ status: 'error', code });
      tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
      await confirmarDialogo(t);
      expect(t.el('ubic-conocidas').innerHTML).toContain('Esta información cambió mientras la estabas revisando.');
      expect(t.llamadas.lecturas).toHaveLength(2);
    }
  });

  test('corte de red: el dialogo queda abierto con el mensaje y el reintento reutiliza el mismo clientRequestId', async () => {
    const t = cargar();
    await abrir(t, []);
    let intentos = 0;
    t.alDecidir = (p) => { intentos += 1; return intentos === 1 ? Promise.reject(new Error('sin red')) : aplicar(t, p); };
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').hidden).toBe(false);
    expect(t.el('ufd-error').textContent).toBe('No se pudo guardar la decisión. Revisá tu conexión e intentá de nuevo.');
    expect(t.el('btn-ufd-confirmar').disabled).toBe(false);
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones[0].pedido.clientRequestId).toBe(t.llamadas.decisiones[1].pedido.clientRequestId);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Aceptada<');
  });

  test.each([['PERMISSION_DENIED', 'No tenés permiso'], ['INCONSISTENT_STATE', 'necesita una revisión técnica'], ['SERVICE_UNAVAILABLE', 'No se pudo guardar la decisión']])('%s: mensaje en castellano, sin codigo, dialogo abierto', async (code, texto) => {
    const t = cargar();
    await abrir(t, []);
    t.alDecidir = () => ({ status: 'error', code, message: 'detalle tecnico interno' });
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').textContent).toContain(texto);
    expect(t.el('ufd-error').textContent).not.toMatch(code + '|detalle tecnico');
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('>Sin revisar<');
  });

  test('sesion vencida: cierra el dialogo y avisa a la app (una sola vez)', async () => {
    const t = cargar();
    await abrir(t, []);
    t.alDecidir = () => ({ status: 'error', code: 'UNAUTHORIZED' });
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.sesionVencida).toHaveBeenCalledTimes(1);
  });

  test('si se abre otra ficha con el dialogo abierto, el dialogo se cierra sin decidir nada', async () => {
    const t = cargar();
    await abrir(t, []);
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    expect(dialogoAbierto(t)).toBe(true);
    await abrir(t, []);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
  });

  test('cerrar sesion / salir de la ficha con una decision en vuelo: la respuesta tardia no pinta nada', async () => {
    const t = cargar();
    await abrir(t, []);
    let responder;
    t.alDecidir = (p) => new Promise((res) => { responder = () => res(aplicar(t, p)); });
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    t.el('btn-ufd-confirmar').click();
    await flush();
    const antes = t.el('ubic-conocidas').innerHTML;
    t.ctx.ubicacionesConocidasController_cerrar();
    responder();
    await flush();
    expect(t.el('ubic-conocidas').innerHTML).toBe(antes);
    expect(dialogoAbierto(t)).toBe(false);
  });

  test('el permiso se consulta fresco: si el usuario pierde ubicacion_validar, el boton viejo deja de funcionar', async () => {
    const t = cargar();
    await abrir(t, []);
    t.permisos = PERM_LECTOR;
    tocarTarjeta(t, 'ACEPTAR', 'REPORTE_POZOS');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.decisiones).toEqual([]);
  });
});

describe('visor "Ver todas en el mapa": las MISMAS acciones y el MISMO dialogo', () => {
  test('el popup de cada marcador muestra fuente, estado, coordenada, distancia, Google Maps y las acciones segun el rol', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    await abrirVisor(t);
    const p1 = marcador(t, 'Irrigación (1)').popup.html;
    expect(p1).toContain('Irrigación (1)');
    expect(p1).toContain('>Sin revisar<');
    expect(p1).toMatch(/A \d+ m del punto operativo|A menos de 1 m/);
    expect(p1).toContain('Abrir en Google Maps');
    expect(accionesDe(p1)).toEqual(['ACEPTAR', 'DESCARTAR']);
    expect(accionesDe(marcador(t, 'Reporte Pozos').popup.html)).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(accionesDe(marcador(t, 'Irrigación (2)').popup.html)).toEqual(['RESTAURAR']);
  });

  test('tarjetas y popups ofrecen EXACTAMENTE las mismas acciones para cada fuente (misma logica reutilizada)', async () => {
    const t = cargar();
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    await abrirVisor(t);
    [['REPORTE_POZOS', 'Reporte Pozos'], ['IRRIGACION_1', 'Irrigación (1)'], ['IRRIGACION_2', 'Irrigación (2)']].forEach(([id, etiqueta]) => {
      expect(accionesEnHtml(marcador(t, etiqueta).popup.html)).toEqual(accionesEnHtml(tarjeta(t, id)));
    });
  });

  test('quien no valida ve el estado en el popup pero ninguna accion', async () => {
    const t = cargar({ permisos: PERM_LECTOR });
    await abrir(t, ['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    await abrirVisor(t);
    // (en el popup tambien: solo sugerir, nunca una accion autoritativa)
    t.reg.marcadores.forEach((m) => expect(m.popup.html).not.toMatch(/data-ufd-accion="(ACEPTAR|DESCARTAR|QUITAR_ACEPTACION|RESTAURAR)"/));
    expect(accionesDe(marcador(t, 'Irrigación (1)').popup.html)).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(marcador(t, 'Irrigación (1)').popup.html).toContain('>Sin revisar<');
  });

  test('"Validada en campo" en el mapa: sin estado y sin acciones', async () => {
    const t = cargar();
    await abrir(t, []);
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    await abrirVisor(t);
    const p = marcador(t, 'Validada en campo').popup.html;
    expect(p).not.toContain('ufd-estado');
    expect(accionesEnHtml(p)).toEqual([]);
  });

  test('tocar un boton del popup abre el MISMO dialogo; al confirmar se actualiza la tarjeta, el popup y la leyenda, y el mapa NO se mueve', async () => {
    const t = cargar();
    await abrir(t, []);
    await abrirVisor(t);
    const encuadres = t.reg.encuadres.length;
    const vistas = t.reg.vistas.length;
    tocarPopup(t, 'ACEPTAR', 'IRRIGACION_1');
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-titulo').textContent).toBe('¿Aceptar esta fuente como referencia registral?');
    expect(t.el('ufd-fuente').textContent).toBe('Irrigación (1)');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toHaveLength(1);
    expect(t.llamadas.decisiones[0].pedido).toMatchObject({ accion: 'ACEPTAR', wellId: W, fuenteTipo: 'IRRIGACION', versionVista: 5 });
    expect(tarjeta(t, 'IRRIGACION_1')).toContain('>Aceptada<');
    expect(marcador(t, 'Irrigación (1)').popup.html).toContain('>Aceptada<');
    expect(accionesDe(marcador(t, 'Irrigación (1)').popup.html)).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(t.el('ucon-leyenda').innerHTML).toContain('Aceptada');
    expect(t.reg.encuadres.length).toBe(encuadres);
    expect(t.reg.vistas.length).toBe(vistas);
    expect(marcador(t, 'Irrigación (1)').abierto).toBeGreaterThan(0);               // el popup de esa fuente se vuelve a abrir
    expect(t.el('ucon-visor-nota').hidden).toBe(false);
    expect(t.el('ucon-visor-nota').textContent).toBe('Fuente aceptada como referencia registral.');
    expect(t.clases.has('ucorr-abierto')).toBe(true);                                // el visor sigue abierto: el dialogo no le saca la marca al cuerpo
  });

  test('descartar desde el popup exige motivo igual que desde la tarjeta', async () => {
    const t = cargar();
    await abrir(t, []);
    await abrirVisor(t);
    tocarPopup(t, 'DESCARTAR', 'IRRIGACION_2');
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones).toEqual([]);
    expect(t.el('ufd-err-motivo').hidden).toBe(false);
    t.el('ufd-motivo').value = 'esta en un cerro';
    await confirmarDialogo(t);
    expect(t.llamadas.decisiones[0].pedido).toMatchObject({ accion: 'DESCARTAR', motivo: 'esta en un cerro' });
    expect(marcador(t, 'Irrigación (2)').popup.html).toContain('>Descartada<');
  });

  test('STALE_STATE desde el mapa: aviso en el visor, estado releido y sin repetir', async () => {
    const t = cargar();
    await abrir(t, []);
    await abrirVisor(t);
    t.alDecidir = () => { t.vista = vistaDe(t, ['ACEPTADA'], { version: 8 }); return { status: 'error', code: 'STALE_STATE' }; };
    tocarPopup(t, 'DESCARTAR', 'REPORTE_POZOS');
    t.el('ufd-motivo').value = 'x';
    await confirmarDialogo(t);
    expect(t.el('ucon-visor-nota').textContent).toContain('Esta información cambió mientras la estabas revisando.');
    expect(marcador(t, 'Reporte Pozos').popup.html).toContain('>Aceptada<');
    expect(t.llamadas.decisiones).toHaveLength(1);
  });

  test('un boton del popup que ya no corresponde (otro estado) se ignora', async () => {
    const t = cargar();
    await abrir(t, ['DESCARTADA']);
    await abrirVisor(t);
    tocarPopup(t, 'ACEPTAR', 'REPORTE_POZOS');
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
  });

  test('cerrar el visor despues de decidir no deja la marca ucorr-abierto puesta', async () => {
    const t = cargar();
    await abrir(t, []);
    await abrirVisor(t);
    tocarPopup(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    t.el('btn-ucon-cerrar').click();
    expect(t.clases.has('ucorr-abierto')).toBe(false);
  });
});

describe('lo que NO se toca', () => {
  test('solo se llama a getDecisionesFuentesPozo y decidirFuenteUbicacion: ninguna otra API (ni correcciones, ni validadas, ni mapa)', async () => {
    const t = cargar();
    await abrir(t, []);
    await abrirVisor(t);
    tocarPopup(t, 'ACEPTAR', 'REPORTE_POZOS');
    await confirmarDialogo(t);
    expect(t.llamadas.otras).toEqual([]);
  });

  test('la coordenada original sigue en pantalla en todos los estados (nunca se borra ni se reemplaza)', async () => {
    const t = cargar();
    await abrir(t, ['DESCARTADA', 'DESCARTADA', 'DESCARTADA']);
    const h = t.el('ubic-conocidas').innerHTML;
    expect((h.match(/class="ucon-coord mono/g) || []).length).toBe(3);
    expect(h).not.toMatch(/Coordenada no válida/);
  });

  test('el punto operativo que muestra la ficha no cambia por una decision (los mapas aun no integran las decisiones)', async () => {
    const t = cargar();
    await abrir(t, []);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('Punto operativo');
    tocarTarjeta(t, 'DESCARTAR', 'REPORTE_POZOS');
    t.el('ufd-motivo').value = 'prueba';
    await confirmarDialogo(t);
    expect(tarjeta(t, 'REPORTE_POZOS')).toContain('Punto operativo');
  });
});
