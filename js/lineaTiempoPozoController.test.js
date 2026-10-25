// Controlador DOM de la Linea de tiempo (js/lineaTiempoPozo.js) ejecutado de verdad, junto con el modelo, el cargador y la presentacion REALES, sobre un DOM minimo falso. El DOM falso LANZA
// si alguien usa innerHTML / insertAdjacentHTML y NO acepta atributos data-*, asi que un texto libre jamas puede interpretarse como HTML ni viajar en un atributo sin que un test falle.
// Los wrappers de api.js se simulan con promesas controladas (cada test decide cuando y como responde cada fuente).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const fuentes = ['reemplazoLogic.js', 'lineaTiempoPozoLogic.js', 'lineaTiempoPozoLoader.js', 'lineaTiempoPozoVistaLogic.js', 'lineaTiempoPozo.js'].map((f) => leer(__dirname, f));

const W = '14-0006';
const OTRO = '14-0007';
const T1 = '2026-10-20T15:00:00.000Z';      // 12:00 en Mendoza (UTC-3)
const T2 = '2026-10-21T18:30:00.000Z';
const T3 = '2026-10-22T09:15:30.250Z';
const TODOS = { ubicacion: true, reemplazo: true, observaciones: true };
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };

class Nodo {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false; this.oyentes = {}; this.attrs = {}; this.type = ''; }
  setAttribute(k, v) {
    if (/^data-/.test(k)) { throw new Error('data-* prohibido en la linea de tiempo: ' + k); }
    this.attrs[k] = String(v);
  }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  focus() { Nodo.enFoco = this; }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML prohibido en el controlador de la linea de tiempo'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML prohibido'); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(tipo, f) { this.oyentes[tipo] = f; }
  click() { if (!this.disabled && this.oyentes.click) { this.oyentes.click(); } }
}

const IDS = ['linea-tiempo-entidad', 'linea-tiempo-cargando', 'linea-tiempo-error', 'linea-tiempo-error-texto', 'btn-linea-tiempo-reintentar', 'linea-tiempo-contenido', 'linea-tiempo-avisos',
  'linea-tiempo-filtros', 'linea-tiempo-vacio', 'linea-tiempo-lista'];

// --- payloads con la forma real de cada endpoint ---
const ok = (data) => ({ status: 'ok', data });
const falla = (code) => ({ status: 'error', code, message: 'detalle tecnico que nunca debe salir' });
const correccion = (n, extra) => Object.assign({ correccionId: 'corr-' + String(n).padStart(4, '0'), wellId: W, metodo: 'GPS_ACTUAL', observacion: 'Medido en el cerco', nombrePropone: 'Carla', timestamp: T3, estado: 'PROPUESTA', resolucion: null }, extra || {});
const decision = (sec, extra) => Object.assign({ secuencia: sec, evento: 'ACEPTADA', fuenteTipo: 'REPORTE_POZOS', x: 111.5, y: 222.5, nombre: 'Valeria', timestampUtc: T1, motivo: null, obsoleta: false }, extra || {});
const evaluacion = (n, extra) => Object.assign({ evaluacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, timestamp: T2, nombre: 'Marta', estado: 'NO_APTO', motivo: 'SIN_ACCESO', observacion: 'Portón cerrado' }, extra || {});
const obs = (n, extra) => Object.assign({ observacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: T1, puedeAnular: false, anulacion: null }, extra || {});
const respUbic = (historial, pozo) => ok({ wellId: pozo || W, vigente: null, pendientes: [], historial });
const respDec = (historial) => ok({ wellId: W, version: 1, integro: true, historial });
const respReemp = (evaluaciones) => ok({ wellId: W, evaluaciones });
const respObs = (items, extra) => ok(Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}));

function montar(opc) {
  const o = opc || {};
  const el = {};
  IDS.forEach((id) => { el[id] = new Nodo('el'); });
  ['linea-tiempo-cargando', 'linea-tiempo-error', 'linea-tiempo-contenido', 'linea-tiempo-avisos', 'linea-tiempo-filtros', 'linea-tiempo-vacio'].forEach((id) => { el[id].hidden = true; });
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Intl, setTimeout, performance: { now: () => 0 } });
  ctx.window = ctx;
  ctx.document = { getElementById: (id) => el[id], createElement: (tag) => new Nodo(tag) };
  const pendientes = { correcciones: [], decisiones: [], reemplazo: [], observaciones: [] };
  const llamadas = { correcciones: [], decisiones: [], reemplazo: [], observaciones: [] };
  const pedir = (k) => (...args) => {
    llamadas[k].push(args);
    return new Promise((resolver, rechazar) => { pendientes[k].push({ resolver, rechazar }); });
  };
  ctx.apiGetCorreccionesUbicacionPozo = jest.fn(pedir('correcciones'));
  ctx.apiGetDecisionesFuentesPozo = jest.fn(pedir('decisiones'));
  ctx.apiGetHistorialReemplazo = jest.fn(pedir('reemplazo'));
  ctx.apiGetObservacionesPozo = jest.fn(pedir('observaciones'));
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || TODOS, onSessionExpired: jest.fn() };
  ctx.lineaTiempoPozoController_inicializar(() => sesion);
  const total = () => Object.keys(llamadas).reduce((n, k) => n + llamadas[k].length, 0);
  // responde la ULTIMA (o la i-esima) llamada pendiente de cada fuente; `r` = {correcciones, decisiones, reemplazo, observaciones}
  const responder = async (r, i) => {
    Object.keys(r).forEach((k) => {
      const idx = i === undefined ? pendientes[k].length - 1 : i;
      if (r[k] === 'RED') { pendientes[k][idx].rechazar(new Error('red')); } else { pendientes[k][idx].resolver(r[k]); }
    });
    await flush();
  };
  const todo = () => ({ correcciones: respUbic([correccion(1)]), decisiones: respDec([decision(1)]), reemplazo: respReemp([evaluacion(1)]), observaciones: respObs([obs(1)]) });
  const lista = () => el['linea-tiempo-lista'].children;
  const filtros = () => el['linea-tiempo-filtros'].children;
  const items = () => lista().map((li) => li.children.map((c) => c.className));
  const textoDe = (n) => n.textContent;
  const tituloDe = (li) => li.children.find((c) => c.className === 'lt-titulo').textContent;
  const fuenteDe = (li) => li.children[0].children[0].textContent;
  const textoTodo = () => IDS.map((id) => el[id].textContent).join('\n');
  return { ctx, el, sesion, llamadas, pendientes, total, responder, todo, lista, filtros, items, textoDe, tituloDe, fuenteDe, textoTodo };
}

describe('abrir: lo que se ve mientras carga', () => {
  test('al abrir muestra el pozo y "cargando"; las 4 lecturas arrancan juntas con el token y el pozo; no hay contenido ni error', () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    expect(t.el['linea-tiempo-entidad'].textContent).toBe(W);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(false);
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.llamadas.correcciones).toEqual([['tok-real', W]]);
    expect(t.llamadas.decisiones).toEqual([['tok-real', W]]);
    expect(t.llamadas.reemplazo).toEqual([['tok-real', W]]);
    expect(t.llamadas.observaciones).toEqual([['tok-real', W, 100, undefined]]);
  });

  test('inicializar no pide nada: los datos se piden SOLO al abrir', () => {
    const t = montar();
    expect(t.total()).toBe(0);
  });

  test('sin el permiso exacto de ninguna fuente, abrir no hace nada (ni pide, ni cambia la pantalla)', () => {
    [{}, { perfil: true, datos: true, ne: true, fotos: true }, { ubicacion: 'SI', reemplazo: 1, observaciones: 'true' }, { ubicacion: false, reemplazo: false, observaciones: false }].forEach((permisos) => {
      const t = montar({ permisos });
      t.ctx.lineaTiempoPozoController_abrir(W);
      expect(t.total()).toBe(0);
      expect(t.el['linea-tiempo-cargando'].hidden).toBe(true);
      expect(t.el['linea-tiempo-entidad'].textContent).toBe('');
    });
  });

  test('un wellId que no es un string no abre nada: ni pedidos ni cambios en la pantalla', () => {
    const t = montar();
    [null, undefined, 5, {}].forEach((w) => t.ctx.lineaTiempoPozoController_abrir(w));
    expect(t.total()).toBe(0);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(true);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.el['linea-tiempo-entidad'].textContent).toBe('');
  });

  test('solo se piden las fuentes con permiso exacto', () => {
    const t = montar({ permisos: { reemplazo: true, ubicacion: 'SI' } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    expect(t.llamadas.reemplazo.length).toBe(1);
    expect(t.llamadas.correcciones.length + t.llamadas.decisiones.length + t.llamadas.observaciones.length).toBe(0);
  });
});

describe('lista de eventos', () => {
  test('pinta cada evento con fuente, fecha local, titulo, detalle, notas y autor; en el orden del modelo (mas reciente primero)', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(true);
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(false);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    const titulos = t.lista().map(t.tituloDe);
    expect(titulos).toEqual(['Ubicación propuesta', 'Evaluación de reemplazo: no apto', 'Observación agregada', 'Fuente de ubicación aceptada']);        // T3, T2 y empate en T1: el modelo desempata por fuente
    const fuentesPintadas = t.lista().map(t.fuenteDe);
    expect(fuentesPintadas).toEqual(['Ubicación', 'Reemplazo', 'Observaciones', 'Ubicación']);
    const reemplazo = t.lista()[1];
    expect(reemplazo.children[0].children[1].textContent).toBe('21/10/2026 15:30');                // 18:30Z en hora de Mendoza
    expect(reemplazo.children[0].children[1].tag).toBe('time');
    expect(reemplazo.children[0].children[1].attrs.datetime).toBe(T2);
    expect(reemplazo.children.map((c) => c.className)).toEqual(['lt-item-cabecera', 'lt-titulo', 'lt-detalle', 'lt-nota', 'lt-autor']);
    expect(reemplazo.children[2].textContent).toBe('Portón cerrado');
    expect(reemplazo.children[3].textContent).toBe('Motivo: Sin acceso');
    expect(reemplazo.children[4].textContent).toBe('Por Marta');
    expect(reemplazo.className).toBe('lt-item lt-item-reemplazo');
    expect(t.lista()[0].children.map((c) => c.className)).toEqual(['lt-item-cabecera', 'lt-titulo', 'lt-detalle', 'lt-nota', 'lt-nota', 'lt-autor']);
    expect(t.lista()[0].children[3].textContent).toBe('Método: GPS del dispositivo');
  });

  test('el orden del DOM es EXACTAMENTE el del modelo (no se reordena)', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([correccion(1, { timestamp: T1 }), correccion(2, { timestamp: T3 }), correccion(3, { timestamp: T2 })]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    const fechas = t.lista().map((li) => li.children[0].children[1].attrs.datetime);
    expect(fechas).toEqual([T3, T2, T1]);
  });

  test('cada evento se distingue por el texto de la fuente (no solo por color) y tiene clase por fuente', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    t.lista().forEach((li) => {
      expect(['Ubicación', 'Reemplazo', 'Observaciones']).toContain(t.fuenteDe(li));
      expect(li.children[0].children[0].className).toBe('lt-fuente');
    });
  });

  test('1 evento y muchos eventos', async () => {
    const uno = montar({ permisos: { observaciones: true } });
    uno.ctx.lineaTiempoPozoController_abrir(W);
    await uno.responder({ observaciones: respObs([obs(1)]) });
    expect(uno.lista()).toHaveLength(1);
    const muchos = montar({ permisos: { observaciones: true } });
    muchos.ctx.lineaTiempoPozoController_abrir(W);
    await muchos.responder({ observaciones: respObs(Array.from({ length: 100 }, (_, i) => obs(i + 1))) });
    expect(muchos.lista()).toHaveLength(100);
  });

  test('vacio (todo cargo y no hay eventos): el texto pedido, sin error, sin lista, sin filtros', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(false);
    expect(t.el['linea-tiempo-vacio'].hidden).toBe(false);
    expect(t.el['linea-tiempo-vacio'].textContent).toBe('Este pozo todavía no tiene eventos en la línea de tiempo.');
    expect(t.el['linea-tiempo-lista'].hidden).toBe(true);
    expect(t.el['linea-tiempo-filtros'].hidden).toBe(true);
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(true);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
  });

  test('detalle largo, nombre largo y palabras largas se ponen con textContent (el CSS los parte); nada de HTML', async () => {
    const t = montar({ permisos: { observaciones: true } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ observaciones: respObs([obs(1, { texto: 'x'.repeat(500) + ' ' + 'palabra'.repeat(60), nombre: 'N'.repeat(300) })]) });
    const li = t.lista()[0];
    expect(Array.from(li.children[2].textContent).length).toBe(140);
    expect(li.children[2].textContent.endsWith('…')).toBe(true);
    expect(Array.from(li.children[3].textContent.replace('Por ', '')).length).toBeLessThanOrEqual(80);
  });

  test('la tarjeta de un evento no muestra ids tecnicos, estado crudo ni metadata', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    const s = t.textoTodo();
    ['corr-0001', '00000000-0000-4000', 'DECISION:', 'REEMPLAZO:', 'OBSERVACION:', 'UBICACION_', 'REEMPLAZO_', 'OBSERVACION_', 'FUENTE_', 'metadata', '{', 'undefined', 'null'].forEach((x) => expect(s).not.toContain(x));
  });
});

describe('filtros', () => {
  async function abierta() {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    return t;
  }

  test('con tres fuentes: botones reales Todas / Ubicación / Reemplazo / Observaciones; Todas seleccionada (aria-pressed y clase)', async () => {
    const t = await abierta();
    expect(t.el['linea-tiempo-filtros'].hidden).toBe(false);
    expect(t.filtros().map((b) => b.textContent)).toEqual(['Todas', 'Ubicación', 'Reemplazo', 'Observaciones']);
    expect(t.filtros().every((b) => b.tag === 'button' && b.type === 'button')).toBe(true);
    expect(t.filtros().map((b) => b.attrs['aria-pressed'])).toEqual(['true', 'false', 'false', 'false']);
    expect(t.filtros()[0].className).toBe('lt-filtro lt-filtro-activo');
    expect(t.filtros()[1].className).toBe('lt-filtro');
  });

  test('cada filtro muestra solo su fuente, marca el seleccionado y NO vuelve a pedir nada al backend', async () => {
    const t = await abierta();
    const antes = t.total();
    for (const [indice, fuente, cantidad] of [[1, 'Ubicación', 2], [2, 'Reemplazo', 1], [3, 'Observaciones', 1]]) {
      t.filtros()[indice].click();
      expect(t.lista()).toHaveLength(cantidad);
      expect(t.lista().every((li) => t.fuenteDe(li) === fuente)).toBe(true);
      expect(t.filtros().map((b) => b.attrs['aria-pressed'])).toEqual(['false', 'false', 'false', 'false'].map((v, k) => (k === indice ? 'true' : v)));
      expect(t.filtros()[indice].className).toBe('lt-filtro lt-filtro-activo');
    }
    t.filtros()[0].click();
    expect(t.lista()).toHaveLength(4);
    expect(t.total()).toBe(antes);                                       // ningun pedido nuevo
  });

  test('el filtro conserva el orden relativo y el foco queda en el boton elegido', async () => {
    const t = await abierta();
    t.filtros()[1].click();
    expect(t.lista().map(t.tituloDe)).toEqual(['Ubicación propuesta', 'Fuente de ubicación aceptada']);
    expect(Nodo.enFoco).toBe(t.filtros()[1]);
  });

  test('un filtro sin resultados muestra "No hay eventos de esta fuente." y la barra sigue', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([]), decisiones: respDec([]), reemplazo: respReemp([evaluacion(1)]), observaciones: respObs([obs(1)]) });
    t.filtros()[1].click();                                              // Ubicacion
    expect(t.lista()).toHaveLength(0);
    expect(t.el['linea-tiempo-lista'].hidden).toBe(true);
    expect(t.el['linea-tiempo-vacio'].hidden).toBe(false);
    expect(t.el['linea-tiempo-vacio'].textContent).toBe('No hay eventos de esta fuente.');
    expect(t.filtros()).toHaveLength(4);
    t.filtros()[0].click();
    expect(t.el['linea-tiempo-vacio'].hidden).toBe(true);
    expect(t.lista()).toHaveLength(2);
  });

  test('sin el permiso de una fuente no hay filtro de esa fuente; con una sola fuente no hay barra', async () => {
    const dos = montar({ permisos: { reemplazo: true, observaciones: true } });
    dos.ctx.lineaTiempoPozoController_abrir(W);
    await dos.responder({ reemplazo: respReemp([evaluacion(1)]), observaciones: respObs([obs(1)]) });
    expect(dos.filtros().map((b) => b.textContent)).toEqual(['Todas', 'Reemplazo', 'Observaciones']);
    const una = montar({ permisos: { observaciones: true } });
    una.ctx.lineaTiempoPozoController_abrir(W);
    await una.responder({ observaciones: respObs([obs(1)]) });
    expect(una.el['linea-tiempo-filtros'].hidden).toBe(true);
    expect(una.filtros()).toHaveLength(0);
  });

  test('el estado parcial se mantiene al filtrar: el aviso sigue visible', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([correccion(1)]), decisiones: respDec([]), reemplazo: respReemp([evaluacion(1)]), observaciones: falla('SERVICE_UNAVAILABLE') });
    const avisosAntes = t.el['linea-tiempo-avisos'].textContent;
    expect(avisosAntes).toContain('Observaciones no pudo cargarse.');
    t.filtros()[2].click();                                              // Reemplazo
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(false);
    expect(t.el['linea-tiempo-avisos'].textContent).toBe(avisosAntes);
    t.filtros()[3].click();                                              // la fuente caida: lista vacia, aviso intacto
    expect(t.lista()).toHaveLength(0);
    expect(t.el['linea-tiempo-avisos'].textContent).toBe(avisosAntes);
  });

  test('reabrir parte siempre de "Todas"', async () => {
    const t = await abierta();
    t.filtros()[2].click();
    t.ctx.lineaTiempoPozoController_cerrar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    expect(t.filtros()[0].attrs['aria-pressed']).toBe('true');
    expect(t.lista()).toHaveLength(4);
  });
});

describe('parcial, error total y copys', () => {
  test('una fuente caida: lista con lo disponible + aviso general y por fuente, sin codigos tecnicos', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([correccion(1)]), decisiones: respDec([]), reemplazo: 'RED', observaciones: respObs([obs(1)]) });
    expect(t.lista()).toHaveLength(2);
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(false);
    expect(t.el['linea-tiempo-avisos'].children.map((p) => p.textContent)).toEqual(['Parte de la información no pudo cargarse.', 'Reemplazo no pudo cargarse.']);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.textoTodo()).not.toMatch(/RED\b|SERVICE|undefined|CURSOR/);
  });

  test('Ubicacion parcial (una subfuente cae): eventos disponibles + copy simple', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([correccion(1)]), decisiones: falla('SERVICE_UNAVAILABLE'), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.lista()).toHaveLength(1);
    expect(t.el['linea-tiempo-avisos'].children.map((p) => p.textContent)).toEqual(['Parte de la información no pudo cargarse.', 'Parte del historial de ubicación no pudo cargarse.']);
  });

  test('WELL_NOT_FOUND de decisiones (pozo fuera del padron) no es un fallo: ni aviso ni error', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([correccion(1)]), decisiones: falla('WELL_NOT_FOUND'), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.lista()).toHaveLength(1);
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(true);
  });

  test('LIMIT_REACHED: aviso propio, sin llamarlo error, y la lista cargada se ve', async () => {
    const t = montar({ permisos: { observaciones: true } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    // 5 paginas de 100 con hayMas
    for (let p = 0; p < 5; p += 1) {
      await t.responder({ observaciones: respObs(Array.from({ length: 100 }, (_, i) => obs(p * 100 + i + 1)), { hayMas: true, cursor: 1000 - p * 100 }) });
    }
    expect(t.llamadas.observaciones).toHaveLength(5);
    expect(t.lista()).toHaveLength(500);
    expect(t.el['linea-tiempo-avisos'].children.map((p) => p.textContent)).toEqual(['Hay más observaciones antiguas que no se incluyeron en esta vista.']);
    expect(t.textoTodo()).not.toMatch(/LIMIT|error/i);
  });

  test('observaciones se corta por un cursor roto: aviso "no pudo cargarse por completo" SIN el motivo tecnico', async () => {
    const t = montar({ permisos: { observaciones: true } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ observaciones: respObs([obs(1)], { hayMas: true, cursor: 50 }) });
    await t.responder({ observaciones: respObs([obs(2)], { hayMas: true, cursor: 50 }) });          // cursor repetido
    expect(t.lista()).toHaveLength(2);
    expect(t.el['linea-tiempo-avisos'].children.map((p) => p.textContent)).toEqual(['Parte de la información no pudo cargarse.', 'Observaciones no pudo cargarse por completo.']);
    expect(t.textoTodo()).not.toMatch(/CURSOR|REPETIDO/);
  });

  test('error total (todas las fuentes caen): mensaje general + Reintentar, sin codigos, sin lista', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: 'RED', decisiones: falla('SERVICE_UNAVAILABLE'), reemplazo: falla('SERVICE_UNAVAILABLE'), observaciones: 'RED' });
    expect(t.el['linea-tiempo-error'].hidden).toBe(false);
    expect(t.el['linea-tiempo-error-texto'].textContent).toBe('No se pudo cargar la línea de tiempo.');
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(true);
    expect(t.textoTodo()).not.toMatch(/SERVICE|RED\b|undefined/);
    expect(t.el['btn-linea-tiempo-reintentar'].oyentes.click).toBeDefined();
  });

  test('Reintentar hace una carga NUEVA del mismo pozo (todas las fuentes de nuevo) y puede salir bien', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: 'RED', decisiones: 'RED', reemplazo: 'RED', observaciones: 'RED' });
    t.el['btn-linea-tiempo-reintentar'].click();
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(false);
    expect(t.llamadas.correcciones).toHaveLength(2);
    expect(t.llamadas.observaciones[1]).toEqual(['tok-real', W, 100, undefined]);
    await t.responder(t.todo());
    expect(t.lista()).toHaveLength(4);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
  });

  test('SIN_PERMISO del backend en una fuente (el permiso cambio): invisible, sin aviso y sin filtro', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('PERMISSION_DENIED'), decisiones: falla('PERMISSION_DENIED'), reemplazo: respReemp([evaluacion(1)]), observaciones: respObs([obs(1)]) });
    expect(t.lista()).toHaveLength(2);
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(true);
    expect(t.filtros().map((b) => b.textContent)).toEqual(['Todas', 'Reemplazo', 'Observaciones']);
    expect(t.textoTodo()).not.toMatch(/Ubicaci|permiso|oculta/i);
  });

  test('solo una fuente permitida y el backend la deniega: pantalla neutra (sin error ni sugerir informacion oculta)', async () => {
    const t = montar({ permisos: { observaciones: true } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ observaciones: falla('PERMISSION_DENIED') });
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.el['linea-tiempo-vacio'].hidden).toBe(false);
    expect(t.el['linea-tiempo-vacio'].textContent).toBe('No hay información disponible para mostrar.');
    expect(t.textoTodo()).not.toMatch(/permiso|oculta|todavía no tiene eventos/i);
    expect(t.el['linea-tiempo-filtros'].hidden).toBe(true);
    expect(t.el['linea-tiempo-avisos'].hidden).toBe(true);
  });

  test('todas las fuentes denegadas por el backend (el frontend creia poder verlas): mismo estado neutro, sin afirmar que no hay eventos', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('PERMISSION_DENIED'), decisiones: falla('PERMISSION_DENIED'), reemplazo: falla('PERMISSION_DENIED'), observaciones: falla('PERMISSION_DENIED') });
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.el['linea-tiempo-vacio'].textContent).toBe('No hay información disponible para mostrar.');
    expect(t.lista()).toHaveLength(0);
    expect(t.textoTodo()).not.toMatch(/permiso|oculta|todavía no tiene eventos|No se pudo|Reintentar/i);
  });

  test('el vacio VERDADERO (todo se leyo y no hay eventos) sigue diciendolo', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: respUbic([]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.el['linea-tiempo-vacio'].textContent).toBe('Este pozo todavía no tiene eventos en la línea de tiempo.');
  });

  test('no se muestran tiempos ni diagnosticos del cargador', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    expect(t.textoTodo()).not.toMatch(/\bms\b|duracion|milisegundos|generacion/i);
  });
});

describe('cancelar, respuestas viejas y reapertura', () => {
  test('cerrar cancela: la respuesta que llega despues NO se aplica', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_cerrar();
    await t.responder(t.todo());
    expect(t.lista()).toHaveLength(0);
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
  });

  test('cerrar limpia lo pintado (lista, avisos, filtros)', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    expect(t.lista().length).toBeGreaterThan(0);
    t.ctx.lineaTiempoPozoController_cerrar();
    expect(t.lista()).toHaveLength(0);
    expect(t.filtros()).toHaveLength(0);
    expect(t.el['linea-tiempo-avisos'].textContent).toBe('');
  });

  test('cambio de pozo: la respuesta del pozo anterior (que llega tarde) no pisa la del nuevo', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_abrir(OTRO);
    expect(t.el['linea-tiempo-entidad'].textContent).toBe(OTRO);
    expect(t.llamadas.correcciones).toHaveLength(2);
    // primero responde el nuevo (indice 1), despues el viejo (indice 0)
    await t.responder({ correcciones: respUbic([correccion(2, { wellId: OTRO, observacion: 'DEL-NUEVO' })], OTRO), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) }, 1);
    const nuevo = t.textoTodo();
    expect(nuevo).toContain('DEL-NUEVO');
    await t.responder({ correcciones: respUbic([correccion(1, { observacion: 'DEL-VIEJO' })]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) }, 0);
    expect(t.textoTodo()).toContain('DEL-NUEVO');
    expect(t.textoTodo()).not.toContain('DEL-VIEJO');
    expect(t.el['linea-tiempo-entidad'].textContent).toBe(OTRO);
  });

  test('si la respuesta vieja llega ANTES que la nueva tampoco se aplica', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_abrir(OTRO);
    await t.responder({ correcciones: respUbic([correccion(1, { observacion: 'DEL-VIEJO' })]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) }, 0);
    expect(t.textoTodo()).not.toContain('DEL-VIEJO');
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(false);          // sigue cargando el pozo nuevo
  });

  test('reabrir el mismo pozo: carga fresca (no hay cache) y el resultado anterior no se reutiliza', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    t.ctx.lineaTiempoPozoController_cerrar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    expect(t.llamadas.correcciones).toHaveLength(2);
    expect(t.lista()).toHaveLength(0);                                // mientras carga no queda lo viejo
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(false);
    await t.responder({ correcciones: respUbic([]), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([obs(9)]) });
    expect(t.lista()).toHaveLength(1);
  });

  test('abrir de nuevo SIN cerrar (por ejemplo desde el hub otra vez): mientras carga no queda nada de lo anterior', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    expect(t.lista().length).toBeGreaterThan(0);
    t.filtros()[2].click();
    t.ctx.lineaTiempoPozoController_abrir(W);
    expect(t.lista()).toHaveLength(0);
    expect(t.filtros()).toHaveLength(0);
    expect(t.el['linea-tiempo-avisos'].textContent).toBe('');
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(false);
    await t.responder(t.todo());
    expect(t.filtros()[0].attrs['aria-pressed']).toBe('true');         // y el filtro vuelve a "Todas"
  });

  test('reset (cierre de sesion) cancela y deja todo oculto', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_reset();
    expect(t.el['linea-tiempo-cargando'].hidden).toBe(true);
    await t.responder(t.todo());
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.lista()).toHaveLength(0);
  });

  test('Reintentar tras cerrar no hace nada', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_cerrar();
    const antes = t.total();
    t.el['btn-linea-tiempo-reintentar'].click();
    expect(t.total()).toBe(antes);
  });
});

describe('errores de sesion', () => {
  test.each([['correcciones'], ['decisiones'], ['reemplazo'], ['observaciones']])('UNAUTHORIZED en %s: se avisa UNA vez al cierre de sesion y NO se muestra como error de la linea de tiempo', async (donde) => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    const r = t.todo();
    r[donde] = falla('UNAUTHORIZED');
    await t.responder(r);
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(t.el['linea-tiempo-error'].hidden).toBe(true);
    expect(t.el['linea-tiempo-contenido'].hidden).toBe(true);
    expect(t.lista()).toHaveLength(0);
    expect(t.textoTodo()).not.toMatch(/No se pudo|no pudo cargarse|Reintentar/);
  });

  test('el cierre de sesion se pide APENAS una fuente responde auth, sin esperar a las demas', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('UNAUTHORIZED') });          // las otras tres siguen pendientes
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    await t.responder({ decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('USER_DISABLED tambien; y aunque varias fuentes respondan auth, el aviso es UNO solo', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('UNAUTHORIZED'), decisiones: falla('USER_DISABLED'), reemplazo: falla('UNAUTHORIZED'), observaciones: falla('UNAUTHORIZED') });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('auth en una carga vieja (otro pozo) no cierra la sesion de la apertura nueva', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    t.ctx.lineaTiempoPozoController_abrir(OTRO);
    await t.responder({ correcciones: falla('UNAUTHORIZED'), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) }, 0);
    expect(t.sesion.onSessionExpired).not.toHaveBeenCalled();
  });

  test('una apertura posterior puede avisar de nuevo (el aviso es por apertura)', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('UNAUTHORIZED'), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ correcciones: falla('UNAUTHORIZED'), decisiones: respDec([]), reemplazo: respReemp([]), observaciones: respObs([]) });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(2);
  });
});

describe('privacidad y XSS', () => {
  async function conObservaciones(items, permisos) {
    const t = montar({ permisos: permisos || { observaciones: true } });
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({ observaciones: respObs(items) });
    return t;
  }

  test('<script>, HTML, ampersand, comillas y emoji se muestran literales (textContent)', async () => {
    const textos = ['<script>alert("x")</script>', '<img src=x onerror=alert(1)>', 'a & b &amp; c', '"comillas" y \'simples\'', 'pozo 💧 ok 👍🏽'];
    const t = await conObservaciones(textos.map((x, i) => obs(i + 1, { texto: x, nombre: i === 0 ? '<b>Ana</b>' : 'Ana' })));
    const detalles = t.lista().map((li) => li.children.find((c) => c.className === 'lt-detalle').textContent);
    textos.forEach((x) => expect(detalles).toContain(x));
    expect(t.lista().some((li) => li.children[li.children.length - 1].textContent === 'Por <b>Ana</b>')).toBe(true);
  });

  test('texto multilinea: queda en una linea (el extracto colapsa saltos) y sin nodos de HTML', async () => {
    const t = await conObservaciones([obs(1, { texto: 'Linea 1\nLinea 2\r\n\r\nLinea 3' })]);
    expect(t.lista()[0].children.find((c) => c.className === 'lt-detalle').textContent).toBe('Linea 1 Linea 2 Linea 3');
  });

  test('observacion anulada: ni la alta ni la anulacion llevan el texto original, ni siquiera cuando lo recibio un moderador', async () => {
    const t = await conObservaciones([obs(1, { estado: 'ANULADA', texto: 'TEXTO-ORIGINAL-DEL-MODERADOR', anulacion: { nombre: 'Moderadora', timestamp: T2, motivo: 'Cargada por error' } })], { observaciones: true });
    expect(t.textoTodo()).not.toContain('TEXTO-ORIGINAL-DEL-MODERADOR');
    expect(t.lista().map(t.tituloDe)).toEqual(['Observación anulada', 'Observación agregada']);
    const anulacion = t.lista()[0];
    expect(anulacion.children.find((c) => c.className === 'lt-detalle').textContent).toBe('Cargada por error');
    const alta = t.lista()[1];
    expect(alta.children.some((c) => c.className === 'lt-detalle')).toBe(false);
    expect(alta.children.find((c) => c.className === 'lt-nota').textContent).toBe('Estado actual: anulada');
  });

  test('email, clientRequestId, secuencia, token, coordenadas y metadata inesperada que traiga el backend no aparecen en ningun lado', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder({
      correcciones: respUbic([correccion(1, { emailPropone: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', lat: -33.987654, lon: -69.987654, coordenadaOriginalTexto: 'COORD-SECRETA' })]),
      decisiones: respDec([decision(1, { email: 'secreto@dominio.test', versionVista: 987654321 })]),
      reemplazo: respReemp([evaluacion(1, { email: 'secreto@dominio.test', puntoNEReferencia: 'INA-SECRETO' })]),
      observaciones: respObs([obs(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', secuencia: 987654321 })], { sessionToken: 'tok-real' })
    });
    const s = t.textoTodo();
    ['secreto@dominio.test', 'req-secreto-123', '987654321', '-33.98', 'COORD-SECRETA', 'INA-SECRETO', 'tok-real', '111.5', '222.5'].forEach((x) => expect(s).not.toContain(x));
  });

  test('ningun elemento creado usa atributos data-* ni HTML (el DOM falso lanzaria)', async () => {
    const t = montar();
    t.ctx.lineaTiempoPozoController_abrir(W);
    await t.responder(t.todo());
    t.filtros()[2].click();
    t.el['btn-linea-tiempo-reintentar'].click();
    expect(true).toBe(true);
  });
});

describe('guardas del codigo del controlador', () => {
  const codigo = leer(__dirname, 'lineaTiempoPozo.js');
  const sinComentarios = codigo.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('solo textContent: sin innerHTML / insertAdjacentHTML / outerHTML / document.write / eval', () => {
    [/innerHTML/, /insertAdjacentHTML/, /outerHTML/, /document\.write/, /\beval\b/, /new Function/].forEach((re) => expect(sinComentarios).not.toMatch(re));
  });

  test('sin console, almacenamiento, URL, data-*, red directa, fechas del dispositivo ni analytics', () => {
    [/\bconsole\b/, /localStorage|sessionStorage|indexedDB/, /location\.|history\./, /dataset|data-/, /\bfetch\s*\(/, /callBackend/, /new Date|Date\.now/, /\bgtag\b|analytics/i, /setTimeout|setInterval/].forEach((re) => {
      expect(sinComentarios).not.toMatch(re);
    });
  });

  test('no reordena ni arma el modelo: sin sort / reverse y sin normalizar eventos a mano', () => {
    expect(sinComentarios).not.toMatch(/\.sort\(|\.reverse\(/);
    expect(sinComentarios).not.toMatch(/lineaTiempoPozoLogic_(normalizar|deduplicar|ordenar|armar)/);
    expect(sinComentarios).toMatch(/lineaTiempoPozoLogic_filtrarPorFuente/);           // el filtro es la funcion pura del modelo
  });

  test('ES5 y sin invisibles crudos', () => {
    expect(sinComentarios).not.toMatch(/=>|\blet\b|\bconst\b|`|\bclass\b|\basync\b|\bawait\b|\.\.\.|\?\.|\?\?/);
    const invisibles = codigo.split('').filter((c) => {
      const o = c.charCodeAt(0);
      return (o < 32 && c !== '\n') || (o >= 0x7F && o <= 0x9F) || o === 0x2028 || o === 0x2029 || o === 0xFEFF || (o >= 0x200B && o <= 0x200F) || (o >= 0x202A && o <= 0x202E) || (o >= 0x2060 && o <= 0x2064) || (o >= 0x2066 && o <= 0x2069);
    });
    expect(invisibles).toEqual([]);
  });
});
