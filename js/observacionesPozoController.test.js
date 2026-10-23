// Controlador DOM de Observaciones (js/observacionesPozo.js) ejecutado de verdad con un DOM minimo falso. El DOM falso LANZA si alguien usa innerHTML / insertAdjacentHTML, asi que
// un texto libre jamas puede interpretarse como HTML sin que un test falle. La logica fina (paginacion, permisos, respuestas viejas) esta en observacionesPozoLogic.test.js; aca se
// verifica lo que se VE: activa, anulada con y sin texto, vacio, cargando, errores, "ver anteriores", reapertura y privacidad.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const fuentes = [leer(__dirname, 'reemplazoLogic.js'), leer(__dirname, 'observacionesPozoLogic.js'), leer(__dirname, 'observacionesPozo.js')];

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

class Nodo {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false; this.oyentes = {}; this.value = ''; this.readOnly = false; this.attrs = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  focus() { Nodo.enFoco = this; }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML prohibido en el controlador de Observaciones'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML prohibido'); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(tipo, f) { this.oyentes[tipo] = f; }
  click() { if (!this.disabled && this.oyentes.click) { this.oyentes.click(); } }
}

const IDS = ['observaciones-entidad', 'observaciones-cargando', 'observaciones-error', 'observaciones-error-texto', 'btn-observaciones-reintentar', 'observaciones-contenido', 'observaciones-vacio', 'observaciones-lista', 'observaciones-error-mas', 'btn-observaciones-mas',
  'observaciones-acciones', 'btn-observaciones-agregar', 'observaciones-exito', 'observaciones-form-overlay', 'observaciones-form', 'observaciones-form-texto', 'observaciones-form-contador',
  'observaciones-form-error', 'btn-observaciones-form-cerrar', 'btn-observaciones-form-cancelar', 'btn-observaciones-form-guardar'];
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null }, extra || {});
const anulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Cargada por error' } }, extra || {}));
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });

function cargar(opc) {
  const o = opc || {};
  const el = {};
  IDS.forEach((id) => { el[id] = new Nodo('el'); });
  ['observaciones-cargando', 'observaciones-error', 'observaciones-contenido', 'observaciones-vacio', 'observaciones-error-mas', 'btn-observaciones-mas', 'btn-observaciones-reintentar', 'observaciones-acciones', 'observaciones-exito', 'observaciones-form-overlay', 'observaciones-form-error'].forEach((id) => { el[id].hidden = true; });
  const creados = [];
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Intl, setTimeout });
  ctx.window = ctx;
  ctx.document = { body: { classList: { toggle: () => {} } }, get activeElement() { return Nodo.enFoco || null; }, getElementById: (id) => el[id], createElement: (tag) => { const n = new Nodo(tag); creados.push(n); return n; } };
  const pendientes = [];
  const llamadas = [];
  ctx.apiAgregarObservacionPozo = jest.fn(() => new Promise(() => {}));
  ctx.apiGetObservacionesPozo = jest.fn((token, wellId, limit, antes) => {
    llamadas.push({ token, wellId, limit, antes });
    return new Promise((resolver, rechazar) => { pendientes.push({ resolver, rechazar }); });
  });
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { observaciones: true }, onSessionExpired: jest.fn() };
  ctx.observacionesPozoController_inicializar(() => sesion);
  const responder = async (resp, i) => { pendientes[i === undefined ? pendientes.length - 1 : i].resolver(resp); await flush(); };
  const fallar = async () => { pendientes[pendientes.length - 1].rechazar(new Error('red')); await flush(); };
  const lista = () => el['observaciones-lista'].children;
  const clases = (li) => li.children.map((p) => p.className);
  const textos = (li) => li.children.map((p) => p.textContent);
  const todoTexto = (n) => n.textContent;
  return { ctx, el, sesion, llamadas, pendientes, responder, fallar, lista, clases, textos, creados, todoTexto };
}

describe('abrir: lo que se ve mientras carga y al terminar', () => {
  test('al abrir muestra el pozo y "cargando"; no hay contenido ni error; se pide UNA pagina', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    expect(t.el['observaciones-entidad'].textContent).toBe(W);
    expect(t.el['observaciones-cargando'].hidden).toBe(false);
    expect(t.el['observaciones-contenido'].hidden).toBe(true);
    expect(t.el['observaciones-error'].hidden).toBe(true);
    expect(t.llamadas).toEqual([{ token: 'tok-real', wellId: W, limit: 50, antes: undefined }]);
  });

  test('sin llamadas hasta que se abre (inicializar no pide nada)', () => {
    const t = cargar();
    expect(t.ctx.apiGetObservacionesPozo).not.toHaveBeenCalled();
  });

  test('estado vacio: "Este pozo todavía no tiene observaciones." sin error ni boton de anteriores', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([], { total: 0 }));
    expect(t.el['observaciones-cargando'].hidden).toBe(true);
    expect(t.el['observaciones-contenido'].hidden).toBe(false);
    expect(t.el['observaciones-vacio'].hidden).toBe(false);
    expect(t.lista()).toHaveLength(0);
    expect(t.el['btn-observaciones-mas'].hidden).toBe(true);
    expect(t.el['observaciones-error'].hidden).toBe(true);
    expect(t.el['observaciones-error-mas'].hidden).toBe(true);
  });

  test('con observaciones el aviso de vacio no se ve', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1)]));
    expect(t.el['observaciones-vacio'].hidden).toBe(true);
    expect(t.lista()).toHaveLength(1);
  });
});

describe('observacion ACTIVA', () => {
  test('texto, autor y fecha legible; sin categoria; nada de estado visible', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1)]));
    const li = t.lista()[0];
    expect(li.tag).toBe('li');
    expect(li.className).toBe('obs-item');
    expect(t.clases(li)).toEqual(['obs-texto', 'obs-meta']);
    expect(t.textos(li)).toEqual(['Texto 1', 'Ana · 20/10/2026 12:00']);
  });

  test('con categoria definida se agrega una linea; sin categoria no', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1, { categoria: 'Acceso' })]));
    expect(t.clases(t.lista()[0])).toEqual(['obs-texto', 'obs-meta', 'obs-categoria']);
    expect(t.textos(t.lista()[0])[2]).toBe('Acceso');
  });

  test('fecha invalida: "Fecha no disponible" y la pantalla no se rompe', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1, { timestamp: 'basura' }), obs(2)]));
    expect(t.textos(t.lista()[0])[1]).toBe('Ana · Fecha no disponible');
    expect(t.lista()).toHaveLength(2);
  });

  test('sin nombre: el neutro "Usuario"', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1, { nombre: '' })]));
    expect(t.textos(t.lista()[0])[1]).toBe('Usuario · 20/10/2026 12:00');
  });

  test('el orden recibido (mas reciente primero) se respeta', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(3), obs(2), obs(1)]));
    expect(t.lista().map((li) => t.textos(li)[0])).toEqual(['Texto 3', 'Texto 2', 'Texto 1']);
  });
});

describe('observacion ANULADA', () => {
  test('sin texto (usuario comun): "Observación anulada" + quien anulo, cuando y el motivo; sin intentar recuperar el original ni decir "texto oculto"', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([anulada(1)], { activas: 0, anuladas: 1 }));
    const li = t.lista()[0];
    expect(li.className).toBe('obs-item obs-item-anulada');
    expect(t.textos(li)).toEqual(['Observación anulada', 'Escrita por Ana · 20/10/2026 12:00', 'Anulada por Moderadora · 21/10/2026 15:30', 'Motivo: Cargada por error']);
    expect(t.clases(li)).not.toContain('obs-texto');
    expect(t.clases(li)).not.toContain('obs-texto obs-texto-original');
    expect(t.todoTexto(li)).not.toMatch(/oculto|no disponible|\*\*\*/i);
    expect(t.llamadas).toHaveLength(1);                         // no pidio nada mas para "recuperar" el texto
  });

  test('con texto (el backend lo mando por observaciones_anular): sigue marcada como anulada y el original queda subordinado', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([anulada(1, { texto: 'Texto original de la anulada' })]));
    const li = t.lista()[0];
    expect(li.className).toBe('obs-item obs-item-anulada');
    expect(t.textos(li)[0]).toBe('Observación anulada');
    expect(t.clases(li)).toEqual(['obs-anulada-titulo', 'obs-texto obs-texto-original', 'obs-meta', 'obs-meta', 'obs-motivo']);
    expect(t.textos(li)[1]).toBe('Texto original de la anulada');
    expect(t.textos(li)).toContain('Anulada por Moderadora · 21/10/2026 15:30');
    expect(t.textos(li)).toContain('Motivo: Cargada por error');
    expect(t.clases(li)).not.toContain('obs-texto');                      // nunca con el estilo de una observacion activa
  });

  test('sin motivo: no se inventa la linea; con fecha de anulacion invalida: "Fecha no disponible"', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([anulada(1, { anulacion: { nombre: 'Mod', timestamp: 'basura', motivo: '' } })]));
    const li = t.lista()[0];
    expect(t.textos(li)).toEqual(['Observación anulada', 'Escrita por Ana · 20/10/2026 12:00', 'Anulada por Mod · Fecha no disponible']);
  });

  test('sin fecha de creacion legible: se omite "Escrita por" (anulada sin texto)', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([anulada(1, { timestamp: 'basura' })]));
    expect(t.textos(t.lista()[0])).toEqual(['Observación anulada', 'Anulada por Moderadora · 21/10/2026 15:30', 'Motivo: Cargada por error']);
  });

  test('mezcla de activas y anuladas: cada una con su forma y su orden', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(4), anulada(3), obs(2), anulada(1, { texto: 'orig' })], { total: 4, activas: 2, anuladas: 2 }));
    expect(t.lista().map((li) => li.className)).toEqual(['obs-item', 'obs-item obs-item-anulada', 'obs-item', 'obs-item obs-item-anulada']);
  });
});

describe('seguridad del texto libre: SIEMPRE textContent', () => {
  const peligrosos = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '<b>negrita</b> & <i>cursiva</i> &amp; &lt;',
    '</li></ol><div id="x">inyeccion</div>',
    '"><svg onload=alert(1)>'
  ];

  test.each(peligrosos.map((p) => [p]))('%s se muestra como TEXTO exacto; no se crean elementos fuera de li/p', async (texto) => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1, { texto, nombre: texto }), anulada(2, { texto, nombre: texto, anulacion: { nombre: texto, timestamp: ISO, motivo: texto } })]));
    expect(t.textos(t.lista()[0])[0]).toBe(texto);
    expect(t.lista()[0].textContent).toContain(texto);
    expect(t.textos(t.lista()[1])).toContain('Motivo: ' + texto);
    expect(t.textos(t.lista()[1])).toContain('Anulada por ' + texto + ' · 20/10/2026 12:00');
    expect(new Set(t.creados.map((n) => n.tag))).toEqual(new Set(['li', 'p']));
  });

  test('saltos de linea, emoji y 1000 caracteres llegan intactos', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    const largo = 'x'.repeat(1000);
    await t.responder(pagina([obs(3, { texto: 'uno\ndos\n\ntres \u{1F4A7}' }), obs(2, { texto: largo }), obs(1, { texto: 'a'.repeat(400) })]));
    expect(t.textos(t.lista()[0])[0]).toBe('uno\ndos\n\ntres \u{1F4A7}');
    expect(t.textos(t.lista()[1])[0]).toHaveLength(1000);
    expect(t.textos(t.lista()[2])[0]).toBe('a'.repeat(400));
  });

  test('innerHTML nunca se usa (el DOM falso lanzaria): todo el flujo completo, con error y paginacion, corre sin excepciones', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(2, { texto: '<script>x</script>' })], { hayMas: true, cursor: 2 }));
    t.el['btn-observaciones-mas'].click();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: '<img src=x onerror=alert(1)>' });
    expect(t.el['observaciones-error-mas'].textContent).not.toContain('<img');
  });
});

describe('privacidad del payload', () => {
  test('email, clientRequestId y secuencia inesperados NO llegan a ningun texto del DOM', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([
      obs(1, { email: 'ana@x.com', clientRequestId: 'req-SECRETO-1234', secuencia: 987654 }),
      anulada(2, { email: 'beto@x.com', clientRequestId: 'req-SECRETO-5678', secuencia: 123456, anulacion: { nombre: 'Mod', timestamp: ISO, motivo: 'm', email: 'mod@x.com', clientRequestId: 'req-SECRETO-9999', secuencia: 424242 } })
    ]));
    const todo = t.todoTexto(t.el['observaciones-contenido']) + t.lista().map((li) => t.todoTexto(li)).join('|');
    expect(todo).not.toMatch(/@x\.com|SECRETO|987654|123456|424242/);
  });

  test('un texto null en una anulada no se reconstruye con ningun otro campo (p. ej. el cursor o el motivo)', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([anulada(1, { texto: null, textoOriginal: 'otro campo', original: 'otro' })]));
    expect(t.todoTexto(t.lista()[0])).not.toMatch(/otro campo|otro\b/);
  });

  test('al cerrar la pantalla se borra el contenido del DOM (nada de texto de observaciones queda atras)', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(1, { texto: 'CONFIDENCIAL-77' })]));
    expect(t.todoTexto(t.el['observaciones-lista'])).toContain('CONFIDENCIAL-77');
    t.ctx.observacionesPozoController_cerrar();
    expect(t.lista()).toHaveLength(0);
    expect(t.el['observaciones-contenido'].hidden).toBe(true);
    expect(t.el['observaciones-cargando'].hidden).toBe(true);
    expect(t.el['observaciones-error'].hidden).toBe(true);
  });

  test('reset (cerrar sesion) hace lo mismo y descarta una respuesta en vuelo', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    t.ctx.observacionesPozoController_reset();
    await t.responder(pagina([obs(1, { texto: 'LLEGO-TARDE' })]));
    expect(t.lista()).toHaveLength(0);
  });
});

describe('paginacion en pantalla', () => {
  test('hayMas=false: no hay boton; hayMas=true: "Ver observaciones anteriores"', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(2)], { hayMas: false }));
    expect(t.el['btn-observaciones-mas'].hidden).toBe(true);
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(2), obs(1)], { hayMas: true, cursor: 1 }));
    expect(t.el['btn-observaciones-mas'].hidden).toBe(false);
    expect(t.el['btn-observaciones-mas'].textContent).toBe('Ver observaciones anteriores');
    expect(t.el['btn-observaciones-mas'].disabled).toBe(false);
  });

  test('tocar pide la pagina siguiente con el cursor, deshabilita el boton mientras carga y AGREGA al final', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 }));
    t.el['btn-observaciones-mas'].click();
    expect(t.llamadas[1]).toEqual({ token: 'tok-real', wellId: W, limit: 50, antes: 4 });
    expect(t.el['btn-observaciones-mas'].disabled).toBe(true);
    expect(t.el['btn-observaciones-mas'].textContent).toBe('Cargando…');
    expect(t.lista()).toHaveLength(2);                             // la primera pagina sigue visible mientras carga
    await t.responder(pagina([obs(3), obs(2)], { total: 4, hayMas: false }));
    expect(t.lista().map((li) => t.textos(li)[0])).toEqual(['Texto 5', 'Texto 4', 'Texto 3', 'Texto 2']);
    expect(t.el['btn-observaciones-mas'].hidden).toBe(true);
  });

  test('doble click: UN solo pedido (el segundo click cae sobre un boton deshabilitado y ademas el cargador lo ignora)', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.el['btn-observaciones-mas'].click();
    t.el['btn-observaciones-mas'].oyentes.click();                  // aun forzando el listener, no hay segundo pedido
    t.el['btn-observaciones-mas'].oyentes.click();
    expect(t.llamadas).toHaveLength(2);
    await t.responder(pagina([obs(4)], { hayMas: false }));
    expect(t.lista()).toHaveLength(2);
  });

  test('error en la pagina 2: la pagina 1 sigue visible, mensaje contextual, el boton vuelve a estar disponible para reintentar', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { hayMas: true, cursor: 4 }));
    t.el['btn-observaciones-mas'].click();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle interno' });
    expect(t.lista()).toHaveLength(2);
    expect(t.el['observaciones-contenido'].hidden).toBe(false);
    expect(t.el['observaciones-error'].hidden).toBe(true);           // no se reemplaza toda la pantalla por un error
    expect(t.el['observaciones-error-mas'].hidden).toBe(false);
    expect(t.el['observaciones-error-mas'].textContent).toBe('No se pudieron cargar las observaciones. Intentá nuevamente.');
    expect(t.el['btn-observaciones-mas'].hidden).toBe(false);
    expect(t.el['btn-observaciones-mas'].disabled).toBe(false);
    t.el['btn-observaciones-mas'].click();
    expect(t.el['observaciones-error-mas'].hidden).toBe(true);
    await t.responder(pagina([obs(3)], { hayMas: false }));
    expect(t.lista()).toHaveLength(3);
  });

  test('reabrir la pantalla pide datos frescos desde la primera pagina', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { hayMas: true, cursor: 4 }));
    t.el['btn-observaciones-mas'].click();
    await t.responder(pagina([obs(3)], { hayMas: false }));
    expect(t.lista()).toHaveLength(3);
    t.ctx.observacionesPozoController_cerrar();
    t.ctx.observacionesPozoController_abrir(W);
    expect(t.llamadas[t.llamadas.length - 1].antes).toBeUndefined();
    expect(t.lista()).toHaveLength(0);
    await t.responder(pagina([obs(9)]));
    expect(t.lista().map((li) => t.textos(li)[0])).toEqual(['Texto 9']);
  });
});

describe('errores y permisos', () => {
  test('error de la primera pagina: mensaje de tabla (nunca el message tecnico) y "Reintentar"', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'Spreadsheet X caido' });
    expect(t.el['observaciones-error'].hidden).toBe(false);
    expect(t.el['observaciones-error-texto'].textContent).toBe('No se pudieron cargar las observaciones. Intentá nuevamente.');
    expect(t.el['btn-observaciones-reintentar'].hidden).toBe(false);
    expect(t.el['observaciones-contenido'].hidden).toBe(true);
    t.el['btn-observaciones-reintentar'].click();
    expect(t.llamadas).toHaveLength(2);
    expect(t.el['observaciones-cargando'].hidden).toBe(false);
    await t.responder(pagina([obs(1)]));
    expect(t.el['observaciones-error'].hidden).toBe(true);
    expect(t.lista()).toHaveLength(1);
  });

  test('error de red: la app sigue en pie y se puede reintentar', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.fallar();
    expect(t.el['observaciones-error-texto'].textContent).toMatch(/No se pudieron cargar/);
    expect(t.el['btn-observaciones-reintentar'].hidden).toBe(false);
  });

  test('backend viejo ("accion desconocida"): error controlado, sin detalle tecnico', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: getObservacionesPozo' });
    expect(t.el['observaciones-error-texto'].textContent).not.toMatch(/accion desconocida/);
    expect(t.el['observaciones-error'].hidden).toBe(false);
  });

  test('PERMISSION_DENIED: mensaje de acceso y SIN boton de reintentar', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder({ status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso "observaciones": ana@x.com' });
    expect(t.el['observaciones-error-texto'].textContent).toBe('No tenés acceso a las observaciones de este pozo.');
    expect(t.el['btn-observaciones-reintentar'].hidden).toBe(true);
    expect(t.el['observaciones-error-texto'].textContent).not.toContain('ana@x.com');
  });

  test.each([[{ observaciones: false }], [{ observaciones: 'SI' }], [{ observaciones: 1 }], [{}]])('sin observaciones===true (%j): ni siquiera se llama al backend', async (permisos) => {
    const t = cargar({ permisos });
    await t.ctx.observacionesPozoController_abrir(W);
    expect(t.ctx.apiGetObservacionesPozo).not.toHaveBeenCalled();
    expect(t.el['observaciones-error-texto'].textContent).toBe('No tenés acceso a las observaciones de este pozo.');
  });

  test('sesion vencida: avisa a la app para cerrar sesion', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder({ status: 'error', code: 'UNAUTHORIZED', message: 'x' });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(t.el['btn-observaciones-reintentar'].hidden).toBe(true);
  });

  test('respuesta mal formada: error generico, la pantalla no se rompe', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    await t.responder({ status: 'ok', data: { observaciones: 'no-es-lista' } });
    expect(t.el['observaciones-error'].hidden).toBe(false);
    expect(t.lista()).toHaveLength(0);
  });
});
