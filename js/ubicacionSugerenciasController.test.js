// Cola de REVISION de sugerencias + indicador del hub ejecutados DE VERDAD (sin navegador): js/ubicacionSugerencias.js + el dialogo compartido (js/ubicacionFuenteDecisionesUi.js)
// con un DOM minimo falso y una API falsa. Verifica el indicador "Sugerencias de ubicación: N" (solo ubicacion + ubicacion_validar), la lista (mas antiguas primero), Aprobar,
// Rechazar (motivo obligatorio), los conflictos (STALE_STATE, ya resuelta), la actualizacion del contador y de la ficha abierta, y que NUNCA se llama a decidirFuenteUbicacion.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (n) => fs.readFileSync(path.join(__dirname, n), 'utf8');
const fuentes = ['coordenadasConversion.js', 'ubicacionOperativaLogic.js', 'ubicacionCorreccionLogic.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionesConocidasLogic.js', 'ubicacionFuenteDecisionesUi.js', 'ubicacionSugerenciasLogic.js', 'ubicacionSugerencias.js'].map(leer);
const htmlIndex = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });
const flush = async () => { for (let i = 0; i < 12; i += 1) { await new Promise((r) => setImmediate(r)); } };

const PERM_VALIDADOR = { perfil: true, ubicacion: true, ubicacion_validar: true };
const PERM_LECTOR = { perfil: true, ubicacion: true, ubicacion_validar: false };
const PERM_CORREGIR = { perfil: true, ubicacion: true, ubicacion_corregir: true };
const PERM_SOLO_VALIDAR = { ubicacion_validar: true };

function crearElemento(id) {
  const e = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, className: '', listeners: {}, atributos: {},
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
  const clases = new Set();
  const cuerpo = { classList: { add: (c) => clases.add(c), remove: (c) => clases.delete(c) }, contains: () => true };
  const documento = {
    body: cuerpo,
    getElementById(id) {
      if (!els[id]) { els[id] = crearElemento(id); els[id].hidden = OCULTOS_INICIAL.has(id); }
      return els[id];
    },
    querySelectorAll() { return []; }
  };
  return { documento, els, clases };
}

let contador = 0;
const itemCola = (extra) => {
  contador += 1;
  return Object.assign({
    sugerenciaId: 'sug-' + String(contador).padStart(8, '0'), wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 2486590.782, y: 6310541.228, etiquetaFuente: 'Irrigación (2)', accionSugerida: 'DESCARTAR',
    motivo: 'queda lejos', nombre: 'Ana Pérez', timestampUtc: '2026-10-14T15:00:00.000Z', estado: 'PENDIENTE', resolucion: null, aplicable: true, motivoNoAplicable: null, estadoFuente: 'SIN_REVISAR',
    versionVista: 4, lat: -33.3488, lon: -69.144
  }, extra || {});
};

function cargar(opc) {
  const o = opc || {};
  const entorno = crearEntorno();
  const llamadas = { cola: 0, resolver: [], decisiones: 0, correcciones: [], refrescarFicha: [], abrirPozo: [], otras: [] };
  const sandbox = { console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat, setTimeout };
  const ctx = vm.createContext(sandbox);
  ctx.window = ctx;
  ctx.document = entorno.documento;
  const t = { ctx, llamadas, cola: o.cola || [], vigente: o.vigente || null, permisos: o.permisos || PERM_VALIDADOR, sesionVencida: jest.fn(), usuarioDeshabilitado: jest.fn(), el: (id) => entorno.documento.getElementById(id) };
  ctx.apiGetSugerenciasFuentesPendientes = jest.fn(() => {
    llamadas.cola += 1;
    if (t.colaFalla) { return Promise.reject(new Error('sin red')); }
    if (t.respuestaCola) { return Promise.resolve(t.respuestaCola()); }
    const aplicables = t.cola.filter((i) => i.aplicable === true).length;
    return Promise.resolve({ status: 'ok', data: { total: aplicables, noAplicables: t.cola.length - aplicables, inconsistentes: 0, pendientes: JSON.parse(JSON.stringify(t.cola)) } });
  });
  ctx.apiResolverSugerenciaFuente = jest.fn((token, pedido) => {
    llamadas.resolver.push({ token, pedido });
    return Promise.resolve().then(() => (t.alResolver ? t.alResolver(pedido) : resolverPorDefecto(t, pedido)));
  });
  ctx.apiDecidirFuenteUbicacion = jest.fn(() => { llamadas.decisiones += 1; return Promise.resolve({ status: 'ok' }); });
  ctx.apiGetCorreccionesUbicacionPozo = jest.fn((token, wellId) => { llamadas.correcciones.push(wellId); return Promise.resolve({ status: 'ok', data: { vigente: t.vigente } }); });
  ctx.ubicacionesConocidasController_refrescar = jest.fn((wellId) => { llamadas.refrescarFicha.push(wellId); return Promise.resolve(); });
  ['fetch', 'callBackend', 'apiSugerirDecisionFuente', 'apiCancelarSugerenciaFuente', 'apiProponerCorreccionUbicacion', 'apiGetCorreccionesUbicacionPendientes']
    .forEach((n) => { ctx[n] = jest.fn(() => { llamadas.otras.push(n); return Promise.resolve({ status: 'ok' }); }); });
  fuentes.forEach((src) => vm.runInContext(src, ctx));
  const contexto = () => ({
    sessionToken: 'tok-sesion', permisos: t.permisos, onSessionExpired: t.sesionVencida, onUserDisabled: t.usuarioDeshabilitado,
    onAbrirPozo: o.sinAbrirPozo ? undefined : (w) => { llamadas.abrirPozo.push(w); }
  });
  ctx.ubicacionFuenteDecisionesUi_inicializar(contexto);
  ctx.ubicacionSugerenciasController_inicializar(contexto);
  return Object.assign(t, { clases: entorno.clases });
}

// El backend falso: aprobar / rechazar quita la sugerencia de la cola
function resolverPorDefecto(t, pedido) {
  const it = t.cola.filter((i) => i.sugerenciaId === pedido.sugerenciaId)[0];
  if (!it) { return { status: 'error', code: 'SUGGESTION_NOT_FOUND' }; }
  t.cola = t.cola.filter((i) => i !== it);
  return { status: 'ok', data: { resultado: pedido.resolucion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA', sugerencia: Object.assign({}, it, { estado: pedido.resolucion === 'APROBAR' ? 'APROBADA' : 'RECHAZADA' }), duplicada: false } };
}

const badgeVisible = (t) => !t.el('usug-pendientes').hidden;
const badgeTexto = (t) => t.el('usug-pendientes-texto').textContent;
const dialogoAbierto = (t) => !t.el('ufd-overlay').hidden;
const confirmar = async (t) => { t.el('btn-ufd-confirmar').click(); await flush(); };
const abrirCola = async (t) => { t.el('usug-pendientes').click(); await flush(); };
const boton = (accion, id) => { const b = { atributos: { 'data-usug-accion': accion, 'data-usug-id': id }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: () => b }; return b; };
const tocar = (t, accion, id) => t.el('usug-lista').emit('click', { target: boton(accion, id) });
const tocarPozo = (t, wellId) => { const b = { atributos: { 'data-usug-pozo': wellId }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: () => b }; t.el('usug-lista').emit('click', { target: b }); };
const lista = (t) => t.el('usug-lista').innerHTML;
const idsEnLista = (t) => (lista(t).match(/<li class="usug-item[^"]*" data-usug-id="([^"]+)"/g) || []).map((s) => s.replace(/.*data-usug-id="([^"]+)"/, '$1'));

describe('indicador "Sugerencias de ubicación: N" del hub', () => {
  test('solo con ubicacion + ubicacion_validar: pide la cola, muestra el total de las APLICABLES y es un boton', async () => {
    const t = cargar({ cola: [itemCola(), itemCola(), itemCola({ aplicable: false })] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(t.llamadas.cola).toBe(1);
    expect(badgeVisible(t)).toBe(true);
    expect(badgeTexto(t)).toBe('Sugerencias de ubicación: 2');
  });

  test.each([['usuario que no valida', PERM_LECTOR], ['solo corrige', PERM_CORREGIR], ['valida pero sin ubicacion', PERM_SOLO_VALIDAR], ['sin permisos', {}]])('%s: no pide nada y no se ve', async (_n, permisos) => {
    const t = cargar({ permisos, cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(t.llamadas.cola).toBe(0);
    expect(badgeVisible(t)).toBe(false);
  });

  test('con 0 aplicables se oculta (igual que "Correcciones pendientes")', async () => {
    const t = cargar({ cola: [itemCola({ aplicable: false })] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(badgeVisible(t)).toBe(false);
  });

  test('un error del servidor no bloquea ni cambia lo que se veia; sesion vencida cierra sesion; usuario deshabilitado va a su pantalla', async () => {
    const t = cargar({ cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    t.colaFalla = true;
    await t.ctx.ubicacionSugerenciasController_reset();
    t.colaFalla = false;
    t.respuestaCola = () => ({ status: 'error', code: 'UNAUTHORIZED' });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(t.sesionVencida).toHaveBeenCalledTimes(1);
    t.respuestaCola = () => ({ status: 'error', code: 'USER_DISABLED' });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(t.usuarioDeshabilitado).toHaveBeenCalledTimes(1);
    expect(badgeVisible(t)).toBe(false);
  });

  test('refresca con un intervalo minimo: dos entradas seguidas al hub piden una sola vez', async () => {
    const t = cargar({ cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(t.llamadas.cola).toBe(1);
  });

  test('reset (cerrar sesion) oculta el indicador y cierra la cola', async () => {
    const t = cargar({ cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    t.ctx.ubicacionSugerenciasController_reset();
    expect(badgeVisible(t)).toBe(false);
    expect(t.el('usug-overlay').hidden).toBe(true);
    expect(t.clases.has('ucorr-abierto')).toBe(false);
  });

  test('tocar el indicador abre la cola', async () => {
    const t = cargar({ cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    expect(t.el('usug-overlay').hidden).toBe(false);
    expect(t.clases.has('ucorr-abierto')).toBe(true);
  });
});

describe('la cola', () => {
  test('no abre para quien no valida (fail-closed), aunque se llame directo', async () => {
    const t = cargar({ permisos: PERM_LECTOR, cola: [itemCola()] });
    t.ctx.ubicacionSugerenciasController_abrir(null);
    await flush();
    expect(t.el('usug-overlay').hidden).toBe(true);
    expect(t.llamadas.cola).toBe(0);
  });

  test('lista las pendientes con TODO lo necesario para revisar, mas antiguas primero y las no aplicables al final; sin emails ni ids visibles', async () => {
    const vieja = itemCola({ nombre: 'Ana Pérez', motivo: 'queda lejos', timestampUtc: '2026-10-10T15:00:00.000Z' });
    const noAplica = itemCola({ aplicable: false, motivoNoAplicable: 'YA_NO_CORRESPONDE' });
    const nueva = itemCola({ wellId: '01-0012', fuenteTipo: 'REPORTE_POZOS', etiquetaFuente: 'Reporte Pozos', accionSugerida: 'ACEPTAR', motivo: '', nombre: 'Lee', timestampUtc: '2026-10-14T15:00:00.000Z' });
    const t = cargar({ cola: [vieja, noAplica, nueva] });
    await abrirCola(t);
    expect(idsEnLista(t)).toEqual([vieja.sugerenciaId, nueva.sugerenciaId, noAplica.sugerenciaId]);
    const h = lista(t);
    ['14-0001', 'Irrigación (2)', 'Sugiere descartar esta fuente', 'Propuesta por Ana Pérez · 10/10/2026', 'Motivo: queda lejos', '-33.3488, -69.144', 'Abrir en Google Maps', '01-0012', 'Reporte Pozos', 'Sugiere aceptar esta fuente'].forEach((x) => expect(h).toContain(x));
    expect(t.el('usug-resumen').textContent).toBe('2 sugerencias para revisar · 1 ya no aplicable');
    expect(h).toContain('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    const visible = h.replace(/data-usug-[a-z]+="[^"]*"/g, '').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/@|sug-0|clientRequestId|secuencia|YA_NO|APROBAR_|PENDIENTE/);
  });

  test('cola vacia: "No hay sugerencias pendientes." y el indicador se oculta', async () => {
    const t = cargar({ cola: [] });
    await abrirCola(t);
    expect(t.el('usug-vacio').hidden).toBe(false);
    expect(t.el('usug-vacio').textContent).toBe('No hay sugerencias pendientes.');
    expect(badgeVisible(t)).toBe(false);
  });

  test('si no se puede cargar: mensaje humano y boton Reintentar; reintentar vuelve a pedir', async () => {
    const t = cargar({ cola: [itemCola()] });
    t.colaFalla = true;
    await abrirCola(t);
    expect(t.el('usug-error').hidden).toBe(false);
    expect(t.el('usug-error').textContent).toBe('No se pudo cargar la lista. Revisá tu conexión e intentá de nuevo.');
    expect(t.el('btn-usug-reintentar').hidden).toBe(false);
    t.colaFalla = false;
    t.el('btn-usug-reintentar').click();
    await flush();
    expect(t.el('usug-error').hidden).toBe(true);
    expect(idsEnLista(t)).toHaveLength(1);
  });

  test('una respuesta vieja (se cerro y se reabrio, o llego tarde) se descarta', async () => {
    const t = cargar({ cola: [itemCola()] });
    let liberar;
    let n = 0;
    t.respuestaCola = () => {
      n += 1;
      return n === 1 ? new Promise((res) => { liberar = () => res({ status: 'ok', data: { total: 1, pendientes: [itemCola({ nombre: 'VIEJA' })] } }); }) : { status: 'ok', data: { total: 1, noAplicables: 0, pendientes: [itemCola({ nombre: 'NUEVA' })] } };
    };
    t.ctx.ubicacionSugerenciasController_abrir(null);
    await flush();
    t.ctx.ubicacionSugerenciasController_cerrar();
    t.ctx.ubicacionSugerenciasController_abrir(null);
    await flush();
    liberar();
    await flush();
    expect(lista(t)).toContain('NUEVA');
    expect(lista(t)).not.toContain('VIEJA');
  });

  test('cerrar (boton, X o Escape) cierra, saca la marca del cuerpo y devuelve el foco al indicador', async () => {
    const t = cargar({ cola: [itemCola()] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    t.el('btn-usug-cerrar').click();
    expect(t.el('usug-overlay').hidden).toBe(true);
    expect(t.clases.has('ucorr-abierto')).toBe(false);
    expect(t.el('usug-pendientes').enfocado).toBeGreaterThan(0);
    await abrirCola(t);
    t.el('usug-overlay').emit('keydown', { key: 'Escape' });
    expect(t.el('usug-overlay').hidden).toBe(true);
    await abrirCola(t);
    t.el('btn-usug-cerrar-abajo').click();
    expect(t.el('usug-overlay').hidden).toBe(true);
  });

  test('"Ver ficha del pozo" cierra la cola y abre la ficha de ese pozo (si la app lo permite)', async () => {
    const t = cargar({ cola: [itemCola({ wellId: '09-0123' })] });
    await abrirCola(t);
    expect(lista(t)).toContain('Ver ficha del pozo');
    tocarPozo(t, '09-0123');
    expect(t.llamadas.abrirPozo).toEqual(['09-0123']);
    expect(t.el('usug-overlay').hidden).toBe(true);
    const t2 = cargar({ cola: [itemCola()], sinAbrirPozo: true });
    await abrirCola(t2);
    expect(lista(t2)).not.toContain('Ver ficha del pozo');
  });
});

describe('aprobar', () => {
  test('dialogo "¿Aprobar esta sugerencia?" con lo que va a pasar; el pedido va por resolverSugerenciaFuente con la version del pozo; NUNCA por decidirFuenteUbicacion', async () => {
    const it = itemCola({ accionSugerida: 'DESCARTAR', motivo: 'm' });
    const t = cargar({ cola: [it] });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', it.sugerenciaId);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-titulo').textContent).toBe('¿Aprobar esta sugerencia?');
    expect(t.el('ufd-fuente').textContent).toBe('Irrigación (2)');
    expect(t.el('ufd-textos').innerHTML).toContain('Se descartará la fuente «Irrigación (2)». La coordenada original no se eliminará.');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (opcional)');
    await confirmar(t);
    expect(t.llamadas.resolver).toHaveLength(1);
    const { token, pedido } = t.llamadas.resolver[0];
    expect(token).toBe('tok-sesion');
    expect(Object.keys(pedido).sort()).toEqual(['clientRequestId', 'motivo', 'resolucion', 'sugerenciaId', 'versionVista']);
    expect(pedido).toMatchObject({ sugerenciaId: it.sugerenciaId, resolucion: 'APROBAR', versionVista: 4, motivo: '' });
    expect(t.llamadas.decisiones).toBe(0);
    expect(t.ctx.apiDecidirFuenteUbicacion).not.toHaveBeenCalled();
  });

  test('exito: sale de la cola, baja el contador, avisa "Sugerencia aprobada." y actualiza la ficha abierta de ese pozo', async () => {
    const a = itemCola({ wellId: '14-0001' });
    const b = itemCola({ wellId: '01-0012' });
    const t = cargar({ cola: [a, b] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    expect(badgeTexto(t)).toBe('Sugerencias de ubicación: 2');
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(idsEnLista(t)).toEqual([b.sugerenciaId]);
    expect(badgeTexto(t)).toBe('Sugerencias de ubicación: 1');
    expect(t.el('usug-aviso').hidden).toBe(false);
    expect(t.el('usug-aviso').textContent).toBe('Sugerencia aprobada.');
    expect(t.llamadas.refrescarFicha).toEqual(['14-0001']);
  });

  test('aprobar la ULTIMA oculta el indicador y muestra "No hay sugerencias pendientes."', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(badgeVisible(t)).toBe(false);
    expect(t.el('usug-vacio').hidden).toBe(false);
  });

  test('ACEPTAR con una VALIDADA EN CAMPO vigente: el aviso pedido (aceptada como referencia registral; lo operativo sigue siendo la validada)', async () => {
    const a = itemCola({ accionSugerida: 'ACEPTAR', motivo: '' });
    const t = cargar({ cola: [a], vigente: { lat: -33.3, lon: -69.1, estado: 'VALIDADA' } });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(t.llamadas.correcciones).toEqual(['14-0001']);
    expect(t.el('usug-aviso').textContent).toBe('Esta fuente quedó aceptada como referencia registral. La ubicación operativa actual sigue siendo la validada en campo.');
  });

  test('ACEPTAR sin validada en campo (o si no se puede saber): el aviso general; otras acciones no consultan nada', async () => {
    const a = itemCola({ accionSugerida: 'ACEPTAR', motivo: '' });
    const t = cargar({ cola: [a], vigente: null });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(t.el('usug-aviso').textContent).toBe('Sugerencia aprobada.');
    const d = itemCola({ accionSugerida: 'DESCARTAR' });
    const t2 = cargar({ cola: [d], vigente: { lat: 1, lon: 1 } });
    await abrirCola(t2);
    tocar(t2, 'APROBAR_SUGERENCIA', d.sugerenciaId);
    await confirmar(t2);
    expect(t2.llamadas.correcciones).toEqual([]);
    expect(t2.el('usug-aviso').textContent).toBe('Sugerencia aprobada.');
  });

  test('si el backend resuelve OBSOLETA: "Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente." y no es un error', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.alResolver = () => { t.cola = []; return { status: 'ok', data: { resultado: 'OBSOLETA', motivoNoAplicable: 'YA_ESTA_ASI', sugerencia: Object.assign({}, a, { estado: 'OBSOLETA' }), duplicada: false } }; };
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.el('usug-aviso').textContent).toBe('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    expect(idsEnLista(t)).toEqual([]);
  });

  test('STALE_STATE: "Esta información cambió mientras la estabas revisando." y la cola se refresca; la decision NO se repite sola', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.alResolver = () => { a.versionVista = 9; a.estadoFuente = 'ACEPTADA'; return { status: 'error', code: 'STALE_STATE', versionActual: 9 }; };
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(t.llamadas.resolver).toHaveLength(1);
    expect(t.el('usug-aviso').textContent.indexOf('Esta información cambió mientras la estabas revisando.')).toBe(0);
    expect(t.el('usug-aviso').className).toContain('ufd-aviso-aviso');
    expect(t.llamadas.cola).toBe(2);
    expect(lista(t)).toContain('Aceptada');                                   // ya muestra el estado nuevo de la fuente
    expect(t.el('usug-aviso').textContent).not.toMatch(/STALE/);
    // con la version nueva si se puede decidir
    t.alResolver = null;
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(t.llamadas.resolver[1].pedido.versionVista).toBe(9);
  });

  test.each(['SUGGESTION_NOT_FOUND', 'ALREADY_RESOLVED'])('%s: "La sugerencia ya fue resuelta o dejó de estar disponible." y se refresca la cola', async (code) => {
    const a = itemCola();
    const b = itemCola({ wellId: '01-0012' });
    const t = cargar({ cola: [a, b] });
    await abrirCola(t);
    t.alResolver = () => { t.cola = [b]; return { status: 'error', code }; };
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(t.el('usug-aviso').textContent).toBe('La sugerencia ya fue resuelta o dejó de estar disponible.');
    expect(idsEnLista(t)).toEqual([b.sugerenciaId]);
    expect(t.llamadas.resolver).toHaveLength(1);
  });

  test('corte de red: el dialogo queda abierto con el mensaje y el reintento reutiliza el mismo clientRequestId', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    let n = 0;
    t.alResolver = (p) => { n += 1; return n === 1 ? Promise.reject(new Error('sin red')) : resolverPorDefecto(t, p); };
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').textContent).toBe('No se pudo enviar. Revisá tu conexión e intentá de nuevo.');
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.resolver[0].pedido.clientRequestId).toBe(t.llamadas.resolver[1].pedido.clientRequestId);
  });

  test.each([['PERMISSION_DENIED', 'No tenés permiso'], ['SERVICE_UNAVAILABLE', 'No se pudo guardar'], ['INCONSISTENT_STATE', 'necesita una revisión técnica']])('%s: mensaje humano, sin codigo, dialogo abierto', async (code, texto) => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.alResolver = () => ({ status: 'error', code, message: 'detalle tecnico' });
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(true);
    expect(t.el('ufd-error').textContent).toContain(texto);
    expect(t.el('ufd-error').textContent).not.toMatch(code + '|detalle tecnico');
    expect(idsEnLista(t)).toEqual([a.sugerenciaId]);
  });

  test('sesion vencida al aprobar: cierra el dialogo y avisa a la app', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.alResolver = () => ({ status: 'error', code: 'UNAUTHORIZED' });
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.sesionVencida).toHaveBeenCalledTimes(1);
  });

  test('doble toque en Confirmar: un solo pedido', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    t.el('btn-ufd-confirmar').click();
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(t.llamadas.resolver).toHaveLength(1);
  });

  test('cancelar el dialogo no envia nada; cerrar la cola con el dialogo abierto lo cierra sin decidir', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    t.el('btn-ufd-cancelar').click();
    await flush();
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    t.ctx.ubicacionSugerenciasController_cerrar();
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.resolver).toEqual([]);
  });

  test('un boton viejo (la sugerencia ya no esta en la cola, o ya no es aplicable) no hace nada', async () => {
    const a = itemCola({ aplicable: false, motivoNoAplicable: 'YA_NO_CORRESPONDE' });
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);                 // no aplicable: Aprobar no existe
    tocar(t, 'APROBAR_SUGERENCIA', 'sug-inventada');
    tocar(t, 'ELIMINAR', a.sugerenciaId);
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.resolver).toEqual([]);
  });

  test('el permiso se consulta fresco: sin ubicacion_validar, los botones viejos dejan de funcionar', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.permisos = PERM_LECTOR;
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await flush();
    expect(dialogoAbierto(t)).toBe(false);
    expect(t.llamadas.resolver).toEqual([]);
  });
});

describe('rechazar', () => {
  test('motivo OBLIGATORIO: sin motivo no se envia nada y se explica; con motivo se rechaza (sin versionVista)', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    tocar(t, 'RECHAZAR_SUGERENCIA', a.sugerenciaId);
    expect(t.el('ufd-titulo').textContent).toBe('¿Rechazar esta sugerencia?');
    expect(t.el('ufd-motivo-label').textContent).toBe('Motivo (obligatorio)');
    await confirmar(t);
    expect(t.llamadas.resolver).toEqual([]);
    expect(t.el('ufd-err-motivo').hidden).toBe(false);
    expect(t.el('ufd-err-motivo').textContent).toBe('Indicá el motivo del rechazo.');
    t.el('ufd-motivo').value = '   ';
    await confirmar(t);
    expect(t.llamadas.resolver).toEqual([]);
    t.el('ufd-motivo').value = '  la coordenada es correcta  ';
    await confirmar(t);
    expect(t.llamadas.resolver[0].pedido).toMatchObject({ resolucion: 'RECHAZAR', motivo: 'la coordenada es correcta' });
    expect(t.llamadas.resolver[0].pedido.versionVista).toBeUndefined();
    expect(t.llamadas.decisiones).toBe(0);
  });

  test('tras rechazar: sale de la cola, baja el contador y avisa "Sugerencia rechazada."', async () => {
    const a = itemCola();
    const b = itemCola({ wellId: '01-0012' });
    const t = cargar({ cola: [a, b] });
    await t.ctx.ubicacionSugerenciasController_refrescar();
    await abrirCola(t);
    tocar(t, 'RECHAZAR_SUGERENCIA', a.sugerenciaId);
    t.el('ufd-motivo').value = 'no corresponde';
    await confirmar(t);
    expect(idsEnLista(t)).toEqual([b.sugerenciaId]);
    expect(badgeTexto(t)).toBe('Sugerencias de ubicación: 1');
    expect(t.el('usug-aviso').textContent).toBe('Sugerencia rechazada.');
    expect(t.llamadas.refrescarFicha).toEqual(['14-0001']);
  });

  test('una sugerencia NO aplicable se puede rechazar (para limpiar la cola) y deja de listarse', async () => {
    const a = itemCola({ aplicable: false, motivoNoAplicable: 'FUENTE_NO_EXISTE' });
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    tocar(t, 'RECHAZAR_SUGERENCIA', a.sugerenciaId);
    t.el('ufd-motivo').value = 'ya no existe la fuente';
    await confirmar(t);
    expect(idsEnLista(t)).toEqual([]);
  });

  test('conflicto al rechazar (otro validador ya la resolvio): mensaje humano y cola refrescada', async () => {
    const a = itemCola();
    const t = cargar({ cola: [a] });
    await abrirCola(t);
    t.alResolver = () => { t.cola = []; return { status: 'error', code: 'ALREADY_RESOLVED', estado: 'APROBADA' }; };
    tocar(t, 'RECHAZAR_SUGERENCIA', a.sugerenciaId);
    t.el('ufd-motivo').value = 'no';
    await confirmar(t);
    expect(t.el('usug-aviso').textContent).toBe('La sugerencia ya fue resuelta o dejó de estar disponible.');
    expect(idsEnLista(t)).toEqual([]);
  });
});

describe('lo que NO se toca', () => {
  test('aprobar y rechazar solo usan la lectura de la cola, resolver y (mejor esfuerzo) la lectura de correcciones: ninguna otra API', async () => {
    const a = itemCola({ accionSugerida: 'ACEPTAR' });
    const b = itemCola({ wellId: '01-0012' });
    const t = cargar({ cola: [a, b] });
    await abrirCola(t);
    tocar(t, 'APROBAR_SUGERENCIA', a.sugerenciaId);
    await confirmar(t);
    tocar(t, 'RECHAZAR_SUGERENCIA', b.sugerenciaId);
    t.el('ufd-motivo').value = 'x';
    await confirmar(t);
    expect(t.llamadas.otras).toEqual([]);
    expect(t.llamadas.decisiones).toBe(0);
  });

  test('el codigo del controlador no hace fetch, no usa decidirFuenteUbicacion ni sugerir/cancelar, y solo lee/resuelve por los wrappers', () => {
    const codigo = leer('ubicacionSugerencias.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(codigo).not.toMatch(/fetch\(|callBackend|XMLHttpRequest|localStorage|sessionStorage|apiDecidirFuente|apiSugerirDecision|apiCancelarSugerencia|decidirFuenteUbicacion/);
    expect((codigo.match(/\bapi[A-Z]\w*\(/g) || []).filter((v, i, arr) => arr.indexOf(v) === i).sort()).toEqual(['apiGetCorreccionesUbicacionPozo(', 'apiGetSugerenciasFuentesPendientes(']);
  });
});
