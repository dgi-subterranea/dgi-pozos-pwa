// E3-6: invalidacion y refresco inmediato del dataset del mapa tras una decision AUTORITATIVA. Ejecuta de verdad (sin navegador) mapaDataset + el dialogo compartido + la ficha
// (ubicacionesConocidas) + la cola de sugerencias contra un backend falso que DERIVA el delta registral y la vista de cada pozo desde los estados de sus fuentes (nada de resultados
// escritos a mano). Verifica: que invalidan aceptar / descartar / quitar aceptacion / restaurar / aprobar; que NO invalidan sugerir / rechazar / cancelar / errores / STALE_STATE (salvo que la
// relectura muestre que OTRA persona cambio el punto); que V invalida solo su capa; que el base (pozos.json) no se vuelve a pedir; y el copy obsoleto.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const sinComentarios = (f) => leer(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const conv = require('./coordenadasConversion.js');
const ufdui = require('./ubicacionFuenteDecisionesUiLogic.js');
const MapaLogic = require('./mapaLogic.js');

const W = '14-0001';
const OTRO = '14-0002';
const A = { lat: -33.34765, lon: -69.14545 };
const B = { lat: -33.34755, lon: -69.14550 };
const C = { lat: -33.34880, lon: -69.14400 };
const CAMPO = { lat: -33.34745, lon: -69.14545 };
const PERIODO = '2026-09';
const PUNTO = { A: A, B: B, C: C };
const TIPO = { A: 'REPORTE_POZOS', B: 'IRRIGACION', C: 'IRRIGACION' };
const ID = { A: 'REPORTE_POZOS', B: 'IRRIGACION_1', C: 'IRRIGACION_2' };
const ETIQ = { A: 'Reporte Pozos', B: 'Irrigación (1)', C: 'Irrigación (2)' };

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const posgar = (p) => { const c = conv.coordenadas_wgs84APosgar(p.lat, p.lon); return { x: Math.round(c.este * 1000) / 1000, y: Math.round(c.norte * 1000) / 1000 }; };
const wgs = (p) => { const q = posgar(p); const g = conv.coordenadas_posgarAWgs84(q.x, q.y); return { lat: r5(g.lat), lon: r5(g.lon) }; };
const clave = (k) => W + '|' + TIPO[k] + '|' + posgar(PUNTO[k]).x.toFixed(3) + '|' + posgar(PUNTO[k]).y.toFixed(3);
const flush = async () => { for (let i = 0; i < 14; i += 1) { await new Promise((r) => setImmediate(r)); } };

// ---------------------------------------------------------------------------------------------------------------------
// Backend falso: estados de las fuentes -> resolucion (como ufd_resolverRegistral, simplificado) -> vista por pozo, delta registral, cola de sugerencias
// ---------------------------------------------------------------------------------------------------------------------
function resolver(estados) {
  const claves = Object.keys(estados);
  const aceptada = claves.filter((k) => estados[k] === 'ACEPTADA')[0];
  const participantes = claves.filter((k) => estados[k] !== 'DESCARTADA');
  const punto = (estado, k, extra) => Object.assign({ estado, nivel: null, operativo: true, lat: wgs(PUNTO[k]).lat, lon: wgs(PUNTO[k]).lon, fuente: k === 'A' ? 'IRR_REPORTE' : 'IRR_PROVINCIA', fuenteClave: clave(k), todasDescartadas: false, participantes: participantes.length }, extra || {});
  if (aceptada) { return punto('ACEPTADA', aceptada); }
  if (participantes.length === 0) { return { estado: 'SIN_COORDENADAS', nivel: null, operativo: false, lat: null, lon: null, fuente: null, fuenteClave: null, todasDescartadas: true, participantes: 0 }; }
  if (participantes.indexOf('A') !== -1 && participantes.indexOf('B') !== -1) { return punto('COINCIDENTE', 'A', { fuente: 'IRR_VARIAS' }); }
  if (participantes.length === 1) { return punto('DISPONIBLE', participantes[0]); }
  return { estado: 'DISCREPANCIA', nivel: 'revisar', operativo: false, lat: null, lon: null, fuente: null, fuenteClave: null, todasDescartadas: false, participantes: participantes.length };
}
const ORIGINAL = { A: 'SIN_REVISAR', B: 'SIN_REVISAR', C: 'SIN_REVISAR' };
const CODIGO = { ACEPTADA: 'R', COINCIDENTE: 'C', DISPONIBLE: 'D' };

function crearBackend() {
  const be = {
    estados: Object.assign({}, ORIGINAL), version: 1, sugerencias: [], campo: [], n: { base: 0, delta: 0, campo: 0, vista: 0, decidir: 0, cola: 0 }, seq: 0,
    vista() {
      const res = resolver(be.estados);
      return {
        wellId: W, version: be.version, integro: true, padronPeriodo: PERIODO, obsoletas: [], historial: [], resolucion: res,
        fuentes: Object.keys(be.estados).map((k, i) => ({
          clave: clave(k), fuenteTipo: TIPO[k], x: posgar(PUNTO[k]).x, y: posgar(PUNTO[k]).y, posicion: i, estado: be.estados[k], esAceptadaVigente: be.estados[k] === 'ACEPTADA', esOperativa: false,
          ultima: be.estados[k] === 'SIN_REVISAR' ? null : { secuencia: 2 + i, evento: be.estados[k], nombre: 'Ana Pérez', timestampUtc: '2026-10-15T15:00:00.000Z', motivo: be.estados[k] === 'DESCARTADA' ? 'cae en el río' : '' }
        }))
      };
    },
    // lo que trae pozos.json: el resultado del padron SIN decisiones
    base() {
      const o = resolver(ORIGINAL);
      return [
        { wellId: W, lat: o.lat, lon: o.lon, estado: CODIGO[o.estado], cuenca: 'X', profundidad: 100, tramosFiltrantes: [], surgencia: null },
        { wellId: OTRO, lat: -33.5, lon: -69.2, estado: 'D', cuenca: 'X', profundidad: 80, tramosFiltrantes: [], surgencia: null }
      ];
    },
    // getDecisionesFuentesDelta: solo si el resultado OPERATIVO difiere del original
    delta() {
      const res = resolver(be.estados);
      const orig = resolver(ORIGINAL);
      const igual = res.estado === orig.estado && res.lat === orig.lat && res.lon === orig.lon;
      const decisiones = [];
      if (!igual) {
        decisiones.push(CODIGO[res.estado] ? { wellId: W, estado: CODIGO[res.estado], lat: res.lat, lon: res.lon } : { wellId: W, estado: 'N' });
      }
      return { version: be.version, periodo: PERIODO, parcial: 0, decisiones: decisiones };
    },
    aplicar(clv, accion) {
      const k = Object.keys(be.estados).filter((x) => clave(x) === clv)[0];
      if (!k) { return { status: 'error', code: 'SOURCE_NOT_FOUND' }; }
      const desde = be.estados[k];
      if (accion === 'ACEPTAR') {
        if (desde !== 'SIN_REVISAR') { return { status: 'error', code: desde === 'ACEPTADA' ? 'ALREADY_IN_STATE' : 'INVALID_TRANSITION' }; }
        Object.keys(be.estados).forEach((x) => { if (be.estados[x] === 'ACEPTADA') { be.estados[x] = 'SIN_REVISAR'; } });
        be.estados[k] = 'ACEPTADA';
      } else if (accion === 'DESCARTAR') {
        if (desde === 'DESCARTADA') { return { status: 'error', code: 'ALREADY_IN_STATE' }; }
        be.estados[k] = 'DESCARTADA';
      } else if (accion === 'QUITAR_ACEPTACION') {
        if (desde !== 'ACEPTADA') { return { status: 'error', code: 'INVALID_TRANSITION' }; }
        be.estados[k] = 'SIN_REVISAR';
      } else {
        if (desde !== 'DESCARTADA') { return { status: 'error', code: 'INVALID_TRANSITION' }; }
        be.estados[k] = 'SIN_REVISAR';
      }
      be.version += 1;
      return { status: 'ok' };
    },
    // otro usuario decide directamente (sin pasar por este cliente)
    externo(letra, accion) { return be.aplicar(clave(letra), accion); },
    sugerir(letra, accion, extra) {
      be.seq += 1;
      const it = Object.assign({
        sugerenciaId: 'sug-' + String(be.seq).padStart(8, '0'), wellId: W, fuenteTipo: TIPO[letra], x: posgar(PUNTO[letra]).x, y: posgar(PUNTO[letra]).y, etiquetaFuente: ETIQ[letra], accionSugerida: accion,
        motivo: accion === 'DESCARTAR' ? 'queda lejos' : '', nombre: 'Lee', timestampUtc: '2026-10-14T15:00:00.000Z', estado: 'PENDIENTE', resolucion: null, aplicable: true, motivoNoAplicable: null,
        estadoFuente: be.estados[letra], versionVista: be.version, lat: wgs(PUNTO[letra]).lat, lon: wgs(PUNTO[letra]).lon
      }, extra || {});
      be.sugerencias.push(it);
      return it;
    }
  };
  return be;
}

// ---------------------------------------------------------------------------------------------------------------------
// Entorno: DOM falso + las apis falsas + los modulos REALES
// ---------------------------------------------------------------------------------------------------------------------
const MODULOS = ['coordenadasConversion.js', 'ubicacionOperativaLogic.js', 'ubicacionCorreccionLogic.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionesConocidasLogic.js', 'mapaDataset.js',
  'ubicacionFuenteDecisionesUi.js', 'ubicacionesConocidas.js', 'ubicacionSugerenciasLogic.js', 'ubicacionSugerencias.js'].map((f) => leer(f));
const htmlIndex = leer('..', 'index.html');
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });

function crearElemento(id) {
  const e = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, className: '', listeners: {}, atributos: {},
    addEventListener(tipo, f) { (e.listeners[tipo] = e.listeners[tipo] || []).push(f); },
    emit(tipo, ev) { (e.listeners[tipo] || []).forEach((f) => f(ev || {})); },
    click() { e.emit('click', { target: e }); },
    focus() {},
    getAttribute(n) { return e.atributos[n] === undefined ? null : e.atributos[n]; }
  };
  return e;
}

function location() {
  const loc = { wellId: W, coordenadas: posgar(A), coordenadasProvincia: [posgar(B), posgar(C)] };
  const p = posgar(A);
  loc.ubicacionResuelta = Object.assign({ estado: 'corroborada', x: p.x, y: p.y, distanciaCorroboracion: 11 }, wgs(A));
  return loc;
}

function cargar(opc) {
  const o = opc || {};
  const be = crearBackend();
  const els = {};
  const documento = {
    body: { classList: { add() {}, remove() {} }, contains: () => true },
    getElementById(id) {
      if (id === 'btn-ucon-ver-todas') { return null; }
      if (!els[id]) { els[id] = crearElemento(id); els[id].hidden = OCULTOS_INICIAL.has(id); }
      return els[id];
    },
    querySelectorAll() { return []; }
  };
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat, setTimeout });
  ctx.window = ctx;
  ctx.document = documento;
  const t = { ctx, be, el: (id) => documento.getElementById(id), permisos: o.permisos || { ubicacion: true, ubicacion_validar: true }, fallas: {} };

  ctx.apiGetMapaPozos = jest.fn(() => { be.n.base += 1; return Promise.resolve({ status: 'ok', data: { pozos: JSON.parse(JSON.stringify(be.base())), metadata: { periodo: PERIODO, totalPuntos: 2 } } }); });
  ctx.apiGetDecisionesFuentesDelta = jest.fn(() => { be.n.delta += 1; return Promise.resolve({ status: 'ok', data: be.delta() }); });
  ctx.apiGetUbicacionesValidadas = jest.fn(() => { be.n.campo += 1; return Promise.resolve({ status: 'ok', data: { ubicaciones: JSON.parse(JSON.stringify(be.campo)) } }); });
  ctx.apiGetDecisionesFuentesPozo = jest.fn(() => { be.n.vista += 1; return Promise.resolve({ status: 'ok', data: be.vista() }); });
  ctx.apiDecidirFuenteUbicacion = jest.fn((token, pedido) => {
    be.n.decidir += 1;
    return Promise.resolve().then(() => {
      if (t.fallas.decidir) { return t.fallas.decidir; }
      if (pedido.versionVista !== be.version) { return { status: 'error', code: 'STALE_STATE' }; }
      const clv = W + '|' + pedido.fuenteTipo + '|' + Number(pedido.x).toFixed(3) + '|' + Number(pedido.y).toFixed(3);
      const r = be.aplicar(clv, pedido.accion);
      return r.status === 'ok' ? { status: 'ok', data: Object.assign({}, be.vista(), { decision: { secuencia: be.version, evento: 'X' }, duplicada: false }) } : r;
    });
  });
  ctx.apiGetSugerenciasFuentesPendientes = jest.fn(() => {
    be.n.cola += 1;
    const aplicables = be.sugerencias.filter((i) => i.estado === 'PENDIENTE' && i.aplicable).length;
    return Promise.resolve({ status: 'ok', data: { total: aplicables, noAplicables: 0, inconsistentes: 0, pendientes: JSON.parse(JSON.stringify(be.sugerencias.filter((i) => i.estado === 'PENDIENTE'))) } });
  });
  ctx.apiGetSugerenciasFuentesPozo = jest.fn(() => Promise.resolve({ status: 'ok', data: { wellId: W, sugerencias: JSON.parse(JSON.stringify(be.sugerencias.filter((i) => i.wellId === W))) } }));
  ctx.apiResolverSugerenciaFuente = jest.fn((token, pedido) => Promise.resolve().then(() => {
    const it = be.sugerencias.filter((i) => i.sugerenciaId === pedido.sugerenciaId)[0];
    if (!it) { return { status: 'error', code: 'SUGGESTION_NOT_FOUND' }; }
    if (t.fallas.resolver) { return t.fallas.resolver; }
    if (pedido.resolucion === 'RECHAZAR') { it.estado = 'RECHAZADA'; return { status: 'ok', data: { resultado: 'RECHAZADA', sugerencia: it, duplicada: false } }; }
    if (t.obsoleta) { it.estado = 'OBSOLETA'; return { status: 'ok', data: { resultado: 'OBSOLETA', sugerencia: it, duplicada: false } }; }
    const clv = W + '|' + it.fuenteTipo + '|' + Number(it.x).toFixed(3) + '|' + Number(it.y).toFixed(3);
    const r = be.aplicar(clv, it.accionSugerida);
    if (r.status !== 'ok') { return r; }
    it.estado = 'APROBADA';
    return { status: 'ok', data: { resultado: 'APROBADA', sugerencia: it, decision: { secuencia: be.version, evento: 'X' }, duplicada: false } };
  }));
  ctx.apiSugerirDecisionFuente = jest.fn((token, pedido) => Promise.resolve().then(() => {
    const letra = Object.keys(PUNTO).filter((k) => TIPO[k] === pedido.fuenteTipo && posgar(PUNTO[k]).x === pedido.x)[0];
    return { status: 'ok', data: { sugerencia: be.sugerir(letra, pedido.accionSugerida, { nombre: 'Yo' }), duplicada: false } };
  }));
  ctx.apiCancelarSugerenciaFuente = jest.fn((token, pedido) => Promise.resolve().then(() => {
    const it = be.sugerencias.filter((i) => i.sugerenciaId === pedido.sugerenciaId)[0];
    if (it) { it.estado = 'CANCELADA'; }
    return { status: 'ok', data: { sugerencia: it, duplicada: false } };
  }));
  ctx.apiGetCorreccionesUbicacionPozo = jest.fn(() => Promise.resolve({ status: 'ok', data: { vigente: null } }));

  MODULOS.forEach((src) => vm.runInContext(src, ctx));
  const contexto = () => ({ sessionToken: 'tok', permisos: t.permisos, onSessionExpired: jest.fn(), onUserDisabled: jest.fn(), onAbrirPozo: () => {} });
  ctx.ubicacionesConocidasController_inicializar(contexto);
  ctx.ubicacionSugerenciasController_inicializar(contexto);
  return t;
}

const obtener = (t) => t.ctx.mapaDataset_obtener('tok');
const pozo = (r, w) => r.data.pozos.filter((p) => p.wellId === (w || W))[0];
const abrirFicha = async (t) => { t.el('ubic-conocidas'); t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: location(), iconoMaps: '', iconoUbicacion: '', iconoUbicacionWarn: '' }); await flush(); };
const estadoPrincipal = (t) => (t.el('ubic-operativa').innerHTML.match(/data-ubic-estado="(\w)"/) || [])[1];
const botonUfd = (accion, id) => { const b = { atributos: { 'data-ufd-accion': accion, 'data-ufd-fuente': id }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: () => b }; return b; };
const tocar = (t, accion, letra) => t.el('ubic-conocidas').emit('click', { target: botonUfd(accion, ID[letra]) });
const confirmar = async (t, motivo) => { if (motivo !== undefined) { t.el('ufd-motivo').value = motivo; } t.el('btn-ufd-confirmar').click(); await flush(); };
// una decision completa desde la tarjeta
const decidir = async (t, accion, letra, motivo) => { tocar(t, accion, letra); await flush(); await confirmar(t, accion === 'DESCARTAR' ? (motivo || 'cae en el río') : motivo); };
const dialogoAbierto = (t) => !t.el('ufd-overlay').hidden;
const llamadas = (t) => Object.assign({}, t.be.n);
// arranque: dataset cargado (base + los dos deltas pedidos UNA vez), ficha abierta
async function arrancar(opc) {
  const t = cargar(opc);
  t.antes = await obtener(t);
  await abrirFicha(t);
  t.n0 = llamadas(t);
  return t;
}

// =====================================================================================================================

describe('que resultado cambia la resolucion (logica pura)', () => {
  test.each([
    ['ACEPTAR ok', { tipo: 'ok', accion: 'ACEPTAR' }, true],
    ['DESCARTAR ok', { tipo: 'ok', accion: 'DESCARTAR' }, true],
    ['QUITAR_ACEPTACION ok', { tipo: 'ok', accion: 'QUITAR_ACEPTACION' }, true],
    ['RESTAURAR ok', { tipo: 'ok', accion: 'RESTAURAR' }, true],
    ['RESTAURAR ok duplicado (reintento deduplicado: la decision existe)', { tipo: 'ok', accion: 'RESTAURAR', duplicada: true }, true],
    ['APROBAR una sugerencia (APROBADA)', { tipo: 'ok', accion: 'APROBAR_SUGERENCIA', resultado: 'APROBADA' }, true],
    ['APROBAR una sugerencia que quedo OBSOLETA', { tipo: 'ok', accion: 'APROBAR_SUGERENCIA', resultado: 'OBSOLETA' }, false],
    ['RECHAZAR una sugerencia', { tipo: 'ok', accion: 'RECHAZAR_SUGERENCIA', resultado: 'RECHAZADA' }, false],
    ['CANCELAR una sugerencia', { tipo: 'ok', accion: 'CANCELAR_SUGERENCIA' }, false],
    ['SUGERIR aceptar / descartar / restaurar', { tipo: 'ok', accion: 'SUGERIR_ACEPTAR' }, false],
    ['STALE_STATE (desactualizado)', { tipo: 'desactualizado', code: 'STALE_STATE', accion: 'ACEPTAR' }, false],
    ['error del backend', { tipo: 'error', code: 'SERVICE_UNAVAILABLE', accion: 'ACEPTAR' }, false],
    ['error de red', { tipo: 'red', accion: 'ACEPTAR' }, false],
    ['sugerencia ya pendiente', { tipo: 'ya_pendiente', accion: 'SUGERIR_ACEPTAR' }, false],
    ['dialogo cancelado', { tipo: 'cancelado' }, false],
    ['invalido', { tipo: 'invalido', accion: 'DESCARTAR' }, false]
  ])('%s -> %s', (_n, r, esperado) => {
    expect(ufdui.ufdui_cambiaResolucion(r)).toBe(esperado);
  });

  test('entradas raras: nunca true y nunca lanza', () => {
    [undefined, null, 5, 'ok', [], {}, { tipo: 'ok' }, { tipo: 'ok', accion: 'ELIMINAR' }, { tipo: 'ok', accion: 'APROBAR_SUGERENCIA' }, { tipo: 'ok', accion: 'APROBAR_SUGERENCIA', resultado: 'aprobada' }]
      .forEach((r) => expect(ufdui.ufdui_cambiaResolucion(r)).toBe(false));
  });
});

describe('decision directa desde la ficha: invalida el delta REGISTRAL y el mapa lo ve enseguida', () => {
  test('ACEPTAR: el delta registral se vuelve a pedir (una vez), el base NO, el de campo NO, y el pozo pasa a R en el punto aceptado', async () => {
    const t = await arrancar();
    expect(pozo(t.antes).estado).toBe('C');
    await decidir(t, 'ACEPTAR', 'C');
    const r = await obtener(t);
    const n = llamadas(t);
    expect(n.delta).toBe(t.n0.delta + 1);
    expect(n.base).toBe(1);
    expect(n.campo).toBe(t.n0.campo);
    expect(pozo(r)).toMatchObject({ estado: 'R', lat: wgs(C).lat, lon: wgs(C).lon });
    expect(estadoPrincipal(t)).toBe('R');                                                      // y la ficha, con la vista que devolvio el backend
  });

  test('DESCARTAR: invalida y el pozo cuyas fuentes quedan en discrepancia SALE del mapa (sin ubicacion operativa)', async () => {
    const t = await arrancar();
    await decidir(t, 'DESCARTAR', 'B');                                                       // quedan A y C (170 m): discrepancia
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);
    expect(r.data.pozos.map((p) => p.wellId)).toEqual([OTRO]);
    expect(MapaLogic.mapaLogic_contarPorEstado(r.data.pozos)).toEqual({ C: 0, D: 1, R: 0, V: 0 });
    expect(estadoPrincipal(t)).toBe('N');
  });

  test('RESTAURAR: invalida y el punto vuelve al mapa (con el estado que resuelven los datos refrescados, no uno fijo)', async () => {
    const t = await arrancar();
    await decidir(t, 'DESCARTAR', 'B');
    await obtener(t);
    const n1 = llamadas(t);
    await decidir(t, 'RESTAURAR', 'B');
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(n1.delta + 1);
    expect(pozo(r)).toMatchObject({ estado: 'C', lat: wgs(A).lat, lon: wgs(A).lon });
    expect(llamadas(t).base).toBe(1);
  });

  test('QUITAR_ACEPTACION: invalida y el pozo vuelve a lo automatico (C) o a D/N segun lo que queda', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    expect(pozo(await obtener(t)).estado).toBe('R');
    const n1 = llamadas(t);
    await decidir(t, 'QUITAR_ACEPTACION', 'C');
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(n1.delta + 1);
    expect(pozo(r).estado).toBe('C');
    // con dos fuentes en discrepancia debajo, quitar la aceptacion deja "sin punto"
    const u = await arrancar();
    await decidir(u, 'DESCARTAR', 'B');
    await decidir(u, 'ACEPTAR', 'A');
    expect(pozo(await obtener(u)).estado).toBe('R');
    await decidir(u, 'QUITAR_ACEPTACION', 'A');
    expect(pozo(await obtener(u))).toBeUndefined();
  });

  test('descartar todas deja al pozo sin punto; con una V en campo el mapa conserva la V y la prioridad no cambia', async () => {
    const t = cargar();
    t.be.campo = [{ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-13T12:00:00.000Z' }];
    await obtener(t);
    await abrirFicha(t);
    await decidir(t, 'ACEPTAR', 'C');
    let r = await obtener(t);
    expect(pozo(r)).toMatchObject({ estado: 'V', lat: CAMPO.lat, lon: CAMPO.lon, base: { estado: 'R', lat: wgs(C).lat } });         // V gana; R queda debajo
    for (const k of ['A', 'B', 'C']) { await decidir(t, 'DESCARTAR', k); }
    r = await obtener(t);
    expect(pozo(r)).toMatchObject({ estado: 'V', base: null });                                                                      // N + V = V
  });

  test('un error del backend NO invalida: el dialogo queda abierto con el mensaje y el mapa sigue con lo que tenia', async () => {
    const t = await arrancar();
    t.fallas.decidir = { status: 'error', code: 'SERVICE_UNAVAILABLE' };
    await decidir(t, 'ACEPTAR', 'C');
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').hidden).toBe(false);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(pozo(await obtener(t)).estado).toBe('C');
  });

  test('un fallo de red NO invalida', async () => {
    const t = await arrancar();
    t.ctx.apiDecidirFuenteUbicacion = jest.fn(() => Promise.reject(new Error('sin red')));
    await decidir(t, 'ACEPTAR', 'C');
    expect(dialogoAbierto(t)).toBe(true);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
  });

  test.each([['ALREADY_IN_STATE'], ['INVALID_TRANSITION'], ['SOURCE_NOT_FOUND']])('%s no se toma como exito: no invalida por si mismo', async (code) => {
    const t = await arrancar();
    t.fallas.decidir = { status: 'error', code };
    await decidir(t, 'ACEPTAR', 'C');
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);                       // la relectura no mostro ningun cambio del punto: nada que invalidar
    expect(t.be.estados.C).toBe('SIN_REVISAR');                       // y la accion propia NO se aplico
  });

  test('cancelar el dialogo no invalida ni llama al backend', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'C');
    await flush();
    t.el('btn-ufd-cancelar').click();
    await flush();
    expect(llamadas(t).decidir).toBe(0);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
  });

  test('invalidar antes de que la ficha se cierre: aunque la pantalla de origen ya no este, la decision confirmada igual invalida', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'C');
    await flush();
    t.el('btn-ufd-confirmar').click();
    t.ctx.ubicacionesConocidasController_cerrar();                         // la ficha se cierra mientras el pedido vuela
    await flush();
    expect(t.be.estados.C).toBe('ACEPTADA');
    expect(pozo(await obtener(t)).estado).toBe('R');
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);
  });

  test('el base (pozos.json) NUNCA se vuelve a pedir tras una secuencia de decisiones', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    await obtener(t);
    await decidir(t, 'QUITAR_ACEPTACION', 'C');
    await obtener(t);
    await decidir(t, 'DESCARTAR', 'B');
    await obtener(t);
    await decidir(t, 'RESTAURAR', 'B');
    await obtener(t);
    expect(llamadas(t).base).toBe(1);
    expect(llamadas(t).delta).toBe(t.n0.delta + 4);
    expect(llamadas(t).campo).toBe(t.n0.campo);
  });

  test('varios consumidores a la vez comparten UN solo pedido nuevo del delta tras invalidar', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    const [r1, r2, r3] = await Promise.all([obtener(t), obtener(t), obtener(t)]);
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);
    expect(r1).toBe(r2);
    expect(r2).toBe(r3);
  });
});

describe('STALE_STATE y concurrencia (dos validadores sobre la misma fuente)', () => {
  const MENSAJE = 'Esta información cambió mientras la estabas revisando.';

  test('otro valida primero: tu ACEPTAR recibe STALE_STATE, se relee, la ficha muestra la verdad nueva y NO se simula exito propio', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'C');                                               // el validador B abre el dialogo con la version 1
    await flush();
    expect(t.be.externo('B', 'ACEPTAR').status).toBe('ok');                // el validador A (otro) aceptaba la Irrigacion (1) antes
    await confirmar(t);
    expect(t.be.estados).toEqual({ A: 'SIN_REVISAR', B: 'ACEPTADA', C: 'SIN_REVISAR' });          // la accion propia NO se aplico
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.el('ubic-conocidas').innerHTML).toContain(MENSAJE);
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('Fuente aceptada como referencia registral.');   // no se muestra el exito
    expect(estadoPrincipal(t)).toBe('R');
    expect(t.el('ubic-operativa').innerHTML).toContain(String(wgs(B).lat));                   // la ficha refleja la nueva verdad (la R de la OTRA persona)
    expect(t.el('ubic-conocidas').innerHTML).toMatch(/data-ufd-accion="QUITAR_ACEPTACION"/);   // y ofrece acciones sobre el estado actual: debe decidir de nuevo
  });

  test('y como la relectura revelo que el punto cambio por la accion ajena, el mapa tambien se actualiza (sin esperar el TTL de 60 s)', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'C');
    await flush();
    t.be.externo('B', 'ACEPTAR');
    await confirmar(t);
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);
    expect(pozo(r)).toMatchObject({ estado: 'R', lat: wgs(B).lat, lon: wgs(B).lon });
    expect(llamadas(t).base).toBe(1);
  });

  test('STALE_STATE cuando la accion ajena NO cambio el punto: se relee la ficha, NO se invalida (no hay nada nuevo para el mapa)', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'A');
    await flush();
    t.be.externo('C', 'DESCARTAR');                                         // descartar la 3.a fuente: el resultado sigue siendo C en A
    await confirmar(t);
    expect(t.el('ubic-conocidas').innerHTML).toContain(MENSAJE);
    expect(t.be.estados.A).toBe('SIN_REVISAR');
    expect(estadoPrincipal(t)).toBe('C');
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(llamadas(t).vista).toBeGreaterThan(t.n0.vista);                  // pero SI se releyeron las decisiones
  });

  test.each([
    ['A. STALE_STATE SIN cambio operativo ajeno', 'A', 'ACEPTAR', 'C', 'DESCARTAR', false, 'C'],
    ['B. STALE_STATE CON cambio operativo ajeno', 'C', 'ACEPTAR', 'B', 'ACEPTAR', true, 'R']
  ])('%s: la accion propia nunca cuenta como exito; el delta registral cliente %s', async (_n, propiaLetra, propiaAccion, ajenaLetra, ajenaAccion, invalida, estadoFinal) => {
    const t = await arrancar();
    tocar(t, propiaAccion, propiaLetra);
    await flush();
    expect(t.be.externo(ajenaLetra, ajenaAccion).status).toBe('ok');
    const estadosTrasLaAjena = Object.assign({}, t.be.estados);
    await confirmar(t);
    expect(t.be.estados).toEqual(estadosTrasLaAjena);                         // la accion propia NO se aplico
    expect(t.el('ubic-conocidas').innerHTML).toContain(MENSAJE);
    expect(t.ctx.apiDecidirFuenteUbicacion).toHaveBeenCalledTimes(1);          // y no se reintento sola
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta + (invalida ? 1 : 0));
    expect(llamadas(t).base).toBe(1);
    expect(estadoPrincipal(t)).toBe(estadoFinal);
    expect(pozo(r).estado).toBe(estadoFinal);                                  // ficha y mapa coinciden en ambos casos (en A porque el punto no cambio)
  });

  test('despues de STALE_STATE el segundo validador puede decidir con la version nueva (y entonces SI invalida como exito)', async () => {
    const t = await arrancar();
    tocar(t, 'ACEPTAR', 'C');
    await flush();
    t.be.externo('B', 'ACEPTAR');
    await confirmar(t);
    await obtener(t);
    const n1 = llamadas(t);
    await decidir(t, 'QUITAR_ACEPTACION', 'B');
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(n1.delta + 1);
    expect(pozo(r).estado).toBe('C');
    expect(t.be.estados).toEqual(ORIGINAL);
  });

  test('ninguna pantalla queda con el estado viejo: ficha, delta del mapa y backend coinciden despues del conflicto', async () => {
    const t = await arrancar();
    tocar(t, 'DESCARTAR', 'A');
    await flush();
    t.be.externo('B', 'ACEPTAR');
    t.el('ufd-motivo').value = 'fuera';
    await confirmar(t, 'fuera');
    const r = await obtener(t);
    const vista = t.be.vista();
    expect(estadoPrincipal(t)).toBe(CODIGO[vista.resolucion.estado]);
    expect(pozo(r).estado).toBe(CODIGO[vista.resolucion.estado]);
    expect(pozo(r).lat).toBe(vista.resolucion.lat);
  });
});

describe('sugerencias: solo APROBAR cambia la resolucion', () => {
  const botonCola = (accion, id) => { const b = { atributos: { 'data-usug-accion': accion, 'data-usug-id': id }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: () => b }; return b; };
  const tocarCola = (t, accion, id) => t.el('usug-lista').emit('click', { target: botonCola(accion, id) });
  const abrirCola = async (t) => { t.el('usug-pendientes').click(); await flush(); };
  const badge = (t) => (t.el('usug-pendientes').hidden ? '' : t.el('usug-pendientes-texto').textContent);

  test('APROBAR: invalida el registral, relee la cola y el indicador, y refresca la ficha ABIERTA de ese pozo (R en el mapa y en la ficha)', async () => {
    const t = await arrancar();
    const it = t.be.sugerir('C', 'ACEPTAR');
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(badge(t)).toBe('Sugerencias de ubicación: 1');
    await abrirCola(t);
    const colaAntes = t.be.n.cola;
    const vistaAntes = t.be.n.vista;
    tocarCola(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t);
    expect(t.be.estados.C).toBe('ACEPTADA');
    expect(t.be.n.cola).toBe(colaAntes + 1);                                               // la cola se releyo
    expect(badge(t)).toBe('');                                                             // y el indicador toma el total nuevo (0: se oculta)
    expect(t.be.n.vista).toBeGreaterThan(vistaAntes);                                      // la ficha abierta de ese pozo se releyo
    expect(estadoPrincipal(t)).toBe('R');
    const r = await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);
    expect(pozo(r)).toMatchObject({ estado: 'R', lat: wgs(C).lat });
    expect(llamadas(t).base).toBe(1);
  });

  test('aprobar una sugerencia de DESCARTAR deja el mismo resultado que la decision directa', async () => {
    const directa = await arrancar();
    await decidir(directa, 'DESCARTAR', 'B');
    const rDirecta = await obtener(directa);

    const t = await arrancar();
    const it = t.be.sugerir('B', 'DESCARTAR');
    await abrirCola(t);
    tocarCola(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t);
    const r = await obtener(t);
    expect(r.data.pozos).toEqual(rDirecta.data.pozos);
    expect(t.be.estados).toEqual(directa.be.estados);
  });

  test('RECHAZAR: refresca la cola y el indicador pero NO invalida el delta registral', async () => {
    const t = await arrancar();
    const it = t.be.sugerir('C', 'ACEPTAR');
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    const colaAntes = t.be.n.cola;
    tocarCola(t, 'RECHAZAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t, 'no corresponde');
    expect(t.be.n.cola).toBe(colaAntes + 1);
    expect(badge(t)).toBe('');
    expect(t.be.estados).toEqual(ORIGINAL);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(pozo(await obtener(t)).estado).toBe('C');
  });

  test('aprobar una sugerencia que quedo OBSOLETA (no se aplico ninguna decision) NO invalida', async () => {
    const t = await arrancar();
    t.obsoleta = true;
    const it = t.be.sugerir('C', 'ACEPTAR');
    await abrirCola(t);
    tocarCola(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t);
    expect(t.be.estados).toEqual(ORIGINAL);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
  });

  test('aprobar con un error del backend NO invalida', async () => {
    const t = await arrancar();
    t.fallas.resolver = { status: 'error', code: 'SERVICE_UNAVAILABLE' };
    const it = t.be.sugerir('C', 'ACEPTAR');
    await abrirCola(t);
    tocarCola(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
  });

  test('aprobar con STALE_STATE (otro valido antes) no invalida como exito', async () => {
    const t = await arrancar();
    const it = t.be.sugerir('C', 'ACEPTAR');
    await abrirCola(t);
    t.fallas.resolver = { status: 'error', code: 'STALE_STATE' };
    tocarCola(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    await flush();
    await confirmar(t);
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(t.be.estados).toEqual(ORIGINAL);
  });

  test('SUGERIR y CANCELAR (el flujo de sugerencias de la ficha, por el mismo dialogo) NO invalidan', async () => {
    const t = await arrancar();
    t.permisos = { ubicacion: true, ubicacion_validar: false };               // quien no valida sugiere
    const flujo = t.ctx.ubicacionFuenteDecisionesUi_flujoSugerencias();
    tocar(t, 'SUGERIR_ACEPTAR', 'C');
    await flush();
    await confirmar(t);
    expect(t.ctx.apiSugerirDecisionFuente).toHaveBeenCalledTimes(1);
    const propia = t.be.sugerencias[0];
    expect(propia.estado).toBe('PENDIENTE');
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    t.ctx.ubicacionFuenteDecisionesUi_pedir({
      accion: 'CANCELAR_SUGERENCIA', fuente: { etiqueta: ETIQ.C }, visorAbierto: false,
      ejecutar: () => flujo.cancelar({ sugerenciaId: propia.sugerenciaId })
    });
    await flush();
    await confirmar(t);
    expect(propia.estado).toBe('CANCELADA');
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(t.be.estados).toEqual(ORIGINAL);
  });
});

describe('V (validada en campo): invalida SOLO la capa de campo', () => {
  test('mapaDataset_invalidarDeltaCampo vuelve a pedir la capa de campo y nada mas (ni registral ni base)', async () => {
    const t = await arrancar();
    t.ctx.mapaDataset_invalidarDeltaCampo();
    await obtener(t);
    expect(llamadas(t).campo).toBe(t.n0.campo + 1);
    expect(llamadas(t).delta).toBe(t.n0.delta);
    expect(llamadas(t).base).toBe(1);
  });

  test('una V nueva aparece en el mapa tras invalidar la capa de campo, con R debajo si la hay (V conserva la prioridad)', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    expect(pozo(await obtener(t)).estado).toBe('R');
    const n1 = llamadas(t);
    t.be.campo = [{ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-16T12:00:00.000Z' }];
    t.ctx.mapaDataset_invalidarDeltaCampo();
    const r = await obtener(t);
    expect(llamadas(t).campo).toBe(n1.campo + 1);
    expect(llamadas(t).delta).toBe(n1.delta);
    expect(pozo(r)).toMatchObject({ estado: 'V', base: { estado: 'R' } });
    // revertir la V: el servidor deja de informarla -> R vuelve a ser el punto operativo (no el automatico)
    t.be.campo = [];
    t.ctx.mapaDataset_invalidarDeltaCampo();
    const s = await obtener(t);
    expect(pozo(s)).toMatchObject({ estado: 'R', lat: wgs(C).lat });
  });

  test('una decision registral NO toca la capa de campo (ni al reves)', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    await obtener(t);
    expect(llamadas(t).campo).toBe(t.n0.campo);
    t.ctx.mapaDataset_invalidarDeltaCampo();
    await obtener(t);
    expect(llamadas(t).delta).toBe(t.n0.delta + 1);                           // solo la de la decision
  });

  test('los callers de V usan el invalidador de campo (ni la generica ni la registral)', () => {
    ['ubicacionValidacion.js', 'ubicacionCorreccion.js'].forEach((f) => {
      const c = sinComentarios(f);
      expect(c).toMatch(/mapaDataset_invalidarDeltaCampo\(\)/);
      expect(c).not.toMatch(/mapaDataset_invalidarDeltas\(|mapaDataset_invalidarDeltaRegistral/);
    });
  });
});

describe('mapaDataset: la invalidacion descarta lo que estaba volando', () => {
  function entorno() {
    const t = cargar();
    let resolverDelta = null;
    t.ctx.apiGetDecisionesFuentesDelta = jest.fn(() => { t.be.n.delta += 1; const snapshot = t.be.delta(); return new Promise((res) => { resolverDelta = () => res({ status: 'ok', data: snapshot }); }); });
    return { t, soltar: () => resolverDelta() };
  }

  test('un pedido en vuelo ANTERIOR a la decision no deja un delta viejo como "fresco": el siguiente obtener pide otro', async () => {
    const { t, soltar } = entorno();
    const primera = obtener(t);                                          // empieza el pedido del delta (version 1: sin decisiones)
    await flush();
    t.be.aplicar(clave('C'), 'ACEPTAR');                                 // una decision se confirma mientras vuela
    t.ctx.mapaDataset_invalidarDeltaRegistral();
    soltar();
    await primera;
    t.ctx.apiGetDecisionesFuentesDelta = jest.fn(() => { t.be.n.delta += 1; return Promise.resolve({ status: 'ok', data: t.be.delta() }); });
    const r = await obtener(t);
    expect(pozo(r)).toMatchObject({ estado: 'R', lat: wgs(C).lat });     // la respuesta vieja no se cacheo
    expect(t.ctx.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
  });

  test('invalidar con un pedido en vuelo no hace que el siguiente consumidor comparta ESE pedido viejo', async () => {
    const { t, soltar } = entorno();
    const vieja = obtener(t);
    await flush();
    t.ctx.mapaDataset_invalidarDeltaRegistral();
    t.ctx.apiGetDecisionesFuentesDelta = jest.fn(() => { t.be.n.delta += 1; return Promise.resolve({ status: 'ok', data: t.be.delta() }); });
    const nueva = obtener(t);
    await nueva;
    expect(t.ctx.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);                 // pidio uno propio
    soltar();
    await vieja;
    expect(t.be.n.delta).toBe(2);
  });

  test('CAMPO (mismo mecanismo): una respuesta vieja de la capa de campo que llega DESPUES de invalidar no queda como fresca; el siguiente obtener vuelve a pedir', async () => {
    const t = cargar();
    t.be.campo = [{ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-13T12:00:00.000Z' }];       // la V que el pedido en vuelo va a traer
    let soltarCampo = null;
    t.ctx.apiGetUbicacionesValidadas = jest.fn(() => { t.be.n.campo += 1; const snap = JSON.parse(JSON.stringify(t.be.campo)); return new Promise((res) => { soltarCampo = () => res({ status: 'ok', data: { ubicaciones: snap } }); }); });
    const primera = obtener(t);
    await flush();
    t.be.campo = [];                                                      // la V se revierte mientras el pedido vuela
    t.ctx.mapaDataset_invalidarDeltaCampo();
    soltarCampo();
    await primera;
    t.ctx.apiGetUbicacionesValidadas = jest.fn(() => { t.be.n.campo += 1; return Promise.resolve({ status: 'ok', data: { ubicaciones: [] } }); });
    const r = await obtener(t);
    expect(t.ctx.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);   // no se creyo la respuesta vieja
    expect(pozo(r).estado).toBe('C');                                     // la V vieja NO esta
    expect(t.be.n.base).toBe(1);
  });

  test('cuando el pedido VIEJO termina, no borra el pedido NUEVO en vuelo: un tercer consumidor comparte el nuevo (no se duplica el pedido)', async () => {
    const t = cargar();
    const pendientes = [];
    t.ctx.apiGetDecisionesFuentesDelta = jest.fn(() => { t.be.n.delta += 1; const snap = t.be.delta(); return new Promise((res) => { pendientes.push(() => res({ status: 'ok', data: snap })); }); });
    const vieja = obtener(t);
    await flush();
    t.be.aplicar(clave('C'), 'ACEPTAR');
    t.ctx.mapaDataset_invalidarDeltaRegistral();
    const nueva = obtener(t);                                            // pedido nuevo, todavia volando
    await flush();
    expect(pendientes.length).toBe(2);
    pendientes[0]();                                                     // termina el VIEJO (se descarta)
    await vieja;
    const tercera = obtener(t);                                          // debe compartir el pedido nuevo, no crear un tercero
    await flush();
    expect(t.ctx.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    pendientes[1]();
    const [rn, rt] = await Promise.all([nueva, tercera]);
    expect(rn).toBe(rt);
    expect(pozo(rn)).toMatchObject({ estado: 'R', lat: wgs(C).lat });
  });

  test('invalidar sin nada en vuelo y sin datos todavia no rompe (idempotente) y nunca toca el base', async () => {
    const t = cargar();
    t.ctx.mapaDataset_invalidarDeltaRegistral();
    t.ctx.mapaDataset_invalidarDeltaCampo();
    t.ctx.mapaDataset_invalidarDeltaRegistral();
    const r = await obtener(t);
    expect(pozo(r).estado).toBe('C');
    expect(t.be.n.base).toBe(1);
  });

  test('la generica de compatibilidad sigue invalidando las dos capas', async () => {
    const t = await arrancar();
    t.ctx.mapaDataset_invalidarDeltas();
    await obtener(t);
    expect(llamadas(t)).toMatchObject({ delta: t.n0.delta + 1, campo: t.n0.campo + 1, base: 1 });
  });
});

describe('mapa y demas pantallas heredan el dataset actualizado (sin resolucion propia)', () => {
  test('el mapa NO recrea la app ni pierde filtros: cada apertura vuelve a pedir el dataset (que ya trae el delta nuevo) y solo "Limpiar filtros" los borra', () => {
    const mapa = sinComentarios('mapa.js');
    const abrir = mapa.slice(mapa.indexOf('function mapaController_abrir('), mapa.indexOf('function mapaController_cerrar('));
    expect(abrir).toMatch(/mapaDataset_obtener\(contexto\.sessionToken\)/);
    expect(abrir).not.toMatch(/estadosActivos = \{\}|cuencaActivos = \{\}|departamentoActivos = \{\}|condicionActivos = \{\}/);                      // (el unico reset de neActivo es por permiso revocado, no por un refresco)
    const limpiar = mapa.slice(mapa.indexOf('function mapaController_limpiarFiltros('), mapa.indexOf('function mapaController_limpiarFiltros(') + 600);
    expect(limpiar).toMatch(/estadosActivos = \{\}/);
    expect(mapa).not.toMatch(/mapaDataset_invalidar/);
  });

  test('mapa, Cerca Mio, seleccion y Buscar reemplazo piden el dataset a mapaDataset_obtener y no resuelven nada ni invalidan', () => {
    ['mapa.js', 'cercaMio.js', 'seleccion.js', 'buscarReemplazo.js'].forEach((f) => {
      const c = sinComentarios(f);
      expect(c).toMatch(/mapaDataset_obtener\(/);
      expect(c).not.toMatch(/mapaDataset_invalidar|ubicacionOperativaLogic_|apiGetDecisionesFuentes/);
    });
  });

  test('la proxima consulta de cualquier consumidor recibe el punto actualizado (misma referencia entre consumidores hasta el proximo cambio)', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    const mapa = await obtener(t);
    const cercaMio = await obtener(t);
    expect(cercaMio).toBe(mapa);
    expect(pozo(mapa).estado).toBe('R');
    expect(t.antes).not.toBe(mapa);
  });

  test('el pozo que se quedo sin punto sale de TODOS los consumidores a la vez (poligono / radio / reemplazo) y vuelve al restaurar', async () => {
    const t = await arrancar();
    await decidir(t, 'DESCARTAR', 'B');
    expect(pozo(await obtener(t))).toBeUndefined();
    await decidir(t, 'RESTAURAR', 'B');
    expect(pozo(await obtener(t)).wellId).toBe(W);
  });
});

describe('copy obsoleto', () => {
  test('UFDUI_TEXTO_SIN_EFECTO_MAPAS ya no existe en ningun modulo (ni su texto)', () => {
    expect(ufdui.UFDUI_TEXTO_SIN_EFECTO_MAPAS).toBeUndefined();
    fs.readdirSync(__dirname).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => {
      expect(leer(f)).not.toMatch(/SIN_EFECTO_MAPAS|todavía no cambian el punto|todavia no cambian el punto/);
    });
    expect(htmlIndex).not.toMatch(/no cambian el punto/);
  });

  test('la ficha con todas descartadas o con R no muestra ninguna nota sobre "los mapas": el cambio ya se refleja', async () => {
    const t = await arrancar();
    await decidir(t, 'ACEPTAR', 'C');
    expect(t.el('ubic-conocidas').innerHTML).not.toMatch(/todavía no cambian|no cambian el punto/);
    const u = await arrancar();
    for (const k of ['A', 'B', 'C']) { await decidir(u, 'DESCARTAR', k); }
    expect(u.el('ubic-conocidas').innerHTML).toContain('Sin ubicación operativa de Irrigación. Todas las fuentes conocidas fueron descartadas.');
    expect(u.el('ubic-conocidas').innerHTML).not.toMatch(/todavía no cambian|no cambian el punto/);
  });
});

describe('alcance de E3-6', () => {
  test('sin cambios de backend ni de contratos de la API: los wrappers y los endpoints son los de E3-5', () => {
    const api = leer('api.js');
    ['getDecisionesFuentesPozo', 'getDecisionesFuentesDelta', 'decidirFuenteUbicacion', 'resolverSugerenciaFuente', 'getUbicacionesValidadas'].forEach((a) => expect(api).toContain("callBackend('" + a + "'"));
  });

  test('el dominio de decisiones y el de composicion no cambiaron: ninguno de los dos conoce la invalidacion', () => {
    ['ubicacionOperativaLogic.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionesConocidasLogic.js'].forEach((f) => {
      expect(sinComentarios(f)).not.toMatch(/mapaDataset_/);
    });
  });
});
