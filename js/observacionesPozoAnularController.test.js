// Controlador DOM de la ANULACION de observaciones (E5-6): js/observacionesPozo.js ejecutado de verdad con un DOM minimo falso (que LANZA ante innerHTML / insertAdjacentHTML). Cubre el boton
// "Anular" (solo en ACTIVAS y solo por permiso / senal del backend), el modal (contexto sin el texto, motivo, foco, Escape, Tab), el envio, el exito (la tarjeta se actualiza EN SITIO y un texto null
// borra el original), los errores, la paginacion intacta, el XSS y las respuestas viejas. La logica fina esta en observacionesPozoAnular.test.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const fuentes = [leer(__dirname, 'reemplazoLogic.js'), leer(__dirname, 'observacionesPozoLogic.js'), leer(__dirname, 'observacionesPozo.js')];

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

class Nodo {
  constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false; this.readOnly = false; this.oyentes = {}; this.value = ''; this.attrs = {}; }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML prohibido'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML prohibido'); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(tipo, f) { this.oyentes[tipo] = f; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  focus() { Nodo.enFoco = this; }
  click() { if (!this.disabled && this.oyentes.click) { this.oyentes.click(); } }
}

const IDS = ['observaciones-entidad', 'observaciones-cargando', 'observaciones-error', 'observaciones-error-texto', 'btn-observaciones-reintentar', 'observaciones-contenido', 'observaciones-acciones',
  'btn-observaciones-agregar', 'observaciones-exito', 'observaciones-vacio', 'observaciones-lista', 'observaciones-error-mas', 'btn-observaciones-mas', 'observaciones-form-overlay', 'observaciones-form',
  'observaciones-form-texto', 'observaciones-form-contador', 'observaciones-form-error', 'btn-observaciones-form-cerrar', 'btn-observaciones-form-cancelar', 'btn-observaciones-form-guardar',
  'observaciones-anular-overlay', 'observaciones-anular-form', 'observaciones-anular-contexto', 'observaciones-anular-motivo', 'observaciones-anular-contador', 'observaciones-anular-error',
  'btn-observaciones-anular-cerrar', 'btn-observaciones-anular-cancelar', 'btn-observaciones-anular-confirmar'];
const OCULTOS = ['observaciones-cargando', 'observaciones-error', 'observaciones-contenido', 'observaciones-acciones', 'observaciones-exito', 'observaciones-vacio', 'observaciones-error-mas', 'btn-observaciones-mas',
  'btn-observaciones-reintentar', 'observaciones-form-overlay', 'observaciones-form-error', 'observaciones-anular-overlay', 'observaciones-anular-error'];
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null, puedeAnular: true }, extra || {});
const anulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Cargada por error' } }, extra || {}));
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });
const respuesta = (o, duplicada) => ({ status: 'ok', data: { wellId: W, duplicada: duplicada === true, observacion: o } });
const MOD = { observaciones: true, observaciones_anular: true };
const AUTOR = { observaciones: true, observaciones_agregar: true };

function cargar(opc) {
  const o = opc || {};
  const el = {};
  IDS.forEach((id) => { el[id] = new Nodo('el'); });
  OCULTOS.forEach((id) => { el[id].hidden = true; });
  el['btn-observaciones-form-guardar'].disabled = true;
  el['btn-observaciones-anular-confirmar'].disabled = true;
  Nodo.enFoco = null;
  const creados = [];
  const bodyClases = new Set();
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Intl, setTimeout });
  ctx.window = ctx;
  ctx.document = {
    body: { classList: { toggle: (c, on) => { if (on) { bodyClases.add(c); } else { bodyClases.delete(c); } } } },
    get activeElement() { return Nodo.enFoco; },
    getElementById: (id) => el[id],
    createElement: (tag) => { const n = new Nodo(tag); creados.push(n); return n; }
  };
  const lecturas = [];
  const lecturasPend = [];
  const anulaciones = [];
  const anulacionesPend = [];
  ctx.apiGetObservacionesPozo = jest.fn((token, wellId, limit, antes) => { lecturas.push({ token, wellId, limit, antes }); return new Promise((res) => { lecturasPend.push(res); }); });
  ctx.apiAgregarObservacionPozo = jest.fn(() => new Promise(() => {}));
  ctx.apiAnularObservacionPozo = jest.fn((token, observacionId, motivo, clientRequestId) => { anulaciones.push({ token, observacionId, motivo, clientRequestId }); return new Promise((res, rej) => { anulacionesPend.push({ res, rej }); }); });
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || MOD, onSessionExpired: jest.fn() };
  ctx.observacionesPozoController_inicializar(() => sesion);
  const t = {
    ctx, el, sesion, lecturas, anulaciones, creados, bodyClases, prevenidos: [],
    responderLista: async (resp, i) => { lecturasPend[i === undefined ? lecturasPend.length - 1 : i](resp); await flush(); },
    responder: async (resp, i) => { anulacionesPend[i === undefined ? anulacionesPend.length - 1 : i].res(resp); await flush(); },
    fallar: async (i) => { anulacionesPend[i === undefined ? anulacionesPend.length - 1 : i].rej(new Error('red')); await flush(); },
    lista: () => el['observaciones-lista'].children,
    textosLista: () => el['observaciones-lista'].children.map((li) => li.children[0].textContent),
    botones: () => el['observaciones-lista'].children.map((li) => li.children.filter((p) => p.className === 'obs-item-acciones').map((p) => p.children[0])[0] || null),
    escribir: (texto) => { el['observaciones-anular-motivo'].value = texto; el['observaciones-anular-motivo'].oyentes.input(); },
    confirmar: () => { const pd = jest.fn(); el['observaciones-anular-form'].oyentes.submit({ preventDefault: pd }); t.prevenidos.push(pd); },
    abrirAnular: (i) => { t.botones()[i].click(); },
    tecla: (key, extra) => { const ev = Object.assign({ key, preventDefault: jest.fn() }, extra || {}); el['observaciones-anular-overlay'].oyentes.keydown(ev); return ev; },
    todoTexto: () => el['observaciones-lista'].textContent + '|' + el['observaciones-exito'].textContent + '|' + el['observaciones-anular-overlay'].textContent + el['observaciones-anular-contexto'].textContent
  };
  return t;
}

async function conLista(opc, items, extra) {
  const t = cargar(opc);
  t.ctx.observacionesPozoController_abrir(W);
  await t.responderLista(pagina(items === undefined ? [obs(3), anulada(2), obs(1)] : items, extra));
  return t;
}

describe('boton "Anular" en la tarjeta: SOLO con puedeAnular === true del backend, en ACTIVAS; nada de permisos de agregar / anular ni de nombre', () => {
  test('ACTIVA con la senal: un boton "Anular" (con texto y aria-label); la ANULADA: ninguno', async () => {
    const t = await conLista({ permisos: { observaciones: true } });
    const b = t.botones();
    expect(b.map((x) => x !== null)).toEqual([true, false, true]);
    expect(b[0].textContent).toBe('Anular');
    expect(b[0].className).toBe('obs-anular');
    expect(b[0].type).toBe('button');
    expect(b[0].attrs['aria-label']).toBe('Anular la observación de Ana del 20/10/2026 12:00');
    expect(t.lista()[1].className).toBe('obs-item obs-item-anulada');
  });

  test('el boton depende de la senal de CADA observacion, no de los permisos del usuario (los mismos permisos dan botones distintos)', async () => {
    const t = await conLista({ permisos: { observaciones: true } }, [obs(3, { puedeAnular: true }), obs(2, { puedeAnular: false }), obs(1, { puedeAnular: true })]);
    expect(t.botones().map((x) => x !== null)).toEqual([true, false, true]);
  });

  test.each([['false', false], ['ausente', undefined], ['null', null], ['"true"', 'true'], ['1', 1], ['"SI"', 'SI'], ['objeto', {}]])('ACTIVA con puedeAnular %s: sin boton, tenga el usuario los permisos que tenga', async (_n, valor) => {
    for (const permisos of [MOD, AUTOR, { observaciones: true, observaciones_agregar: true, observaciones_anular: true }]) {
      const t = await conLista({ permisos }, [obs(1, { puedeAnular: valor })]);
      expect(t.lista()).toHaveLength(1);
      expect(t.botones()[0]).toBeNull();
    }
  });

  test('NO hay fallback: moderador o autor con agregar SIN la senal no ven boton; con la senal, si', async () => {
    const sin = await conLista({ permisos: MOD }, [obs(1, { puedeAnular: false }), obs(2, { puedeAnular: undefined })]);
    expect(sin.botones().every((x) => x === null)).toBe(true);
    const aut = await conLista({ permisos: AUTOR }, [obs(1, { puedeAnular: false })]);
    expect(aut.botones()[0]).toBeNull();
    const con = await conLista({ permisos: AUTOR }, [obs(1, { puedeAnular: true })]);
    expect(con.botones()[0]).not.toBeNull();
  });

  test('una ANULADA con la senal corrupta en true tampoco tiene boton (fail-closed)', async () => {
    const t = await conLista({ permisos: MOD }, [anulada(3, { puedeAnular: true }), obs(1)]);
    expect(t.botones().map((x) => x !== null)).toEqual([false, true]);
  });

  test('el NOMBRE no decide: coincida o no con el del usuario, sin senal no hay boton y con senal si', async () => {
    const sin = await conLista({ permisos: AUTOR }, [obs(1, { nombre: 'Ana', puedeAnular: false }), obs(2, { nombre: 'Beto', puedeAnular: false })]);
    expect(sin.botones().every((x) => x === null)).toBe(true);
    const con = await conLista({ permisos: AUTOR }, [obs(1, { nombre: 'Ana', puedeAnular: true }), obs(2, { nombre: 'Beto', puedeAnular: true })]);
    expect(con.botones().every((x) => x !== null)).toBe(true);
  });

  test('backend viejo (payload sin puedeAnular): la lista se lee y se muestra completa, sin botones', async () => {
    const viejo = (n) => { const o = obs(n); delete o.puedeAnular; return o; };
    const t = await conLista({ permisos: MOD }, [viejo(3), viejo(2), anulada(1)]);
    expect(t.lista()).toHaveLength(3);
    expect(t.botones().every((x) => x === null)).toBe(true);
    expect(t.textosLista()[0]).toBe('Texto 3');
  });

  test('un estado desconocido ni siquiera se muestra: sin tarjeta, sin boton', async () => {
    const t = await conLista({ permisos: MOD }, [obs(1, { estado: 'BORRADA' }), obs(2)]);
    expect(t.lista()).toHaveLength(1);
    expect(t.botones().map((x) => x !== null)).toEqual([true]);
  });

  test('sin observaciones === true ni se pide la lista: no hay botones', async () => {
    const t = cargar({ permisos: { observaciones_anular: true, observaciones_agregar: true } });
    await t.ctx.observacionesPozoController_abrir(W);
    expect(t.ctx.apiGetObservacionesPozo).not.toHaveBeenCalled();
    expect(t.botones()).toEqual([]);
  });

  test('perder observaciones despues de cargar la lista: ya no abre el modal (se revalida al abrir)', async () => {
    const t = await conLista({ permisos: MOD });
    t.sesion.permisos = { observaciones: false };
    t.abrirAnular(0);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
  });
});

describe('abrir el modal', () => {
  test('foco al motivo, contador 0 / 300, confirmar deshabilitado, fondo bloqueado, y el contexto dice QUIEN y CUANDO pero jamas el texto', async () => {
    const t = await conLista({ permisos: MOD }, [obs(1, { texto: 'TEXTO-ORIGINAL-PRIVADO', nombre: 'Beto' })]);
    t.abrirAnular(0);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
    expect(t.bodyClases.has('obs-form-abierto')).toBe(true);
    expect(Nodo.enFoco).toBe(t.el['observaciones-anular-motivo']);
    expect(t.el['observaciones-anular-contexto'].textContent).toBe('Observación de Beto · 20/10/2026 12:00');
    expect(t.el['observaciones-anular-overlay'].textContent).not.toContain('TEXTO-ORIGINAL-PRIVADO');
    expect(t.el['observaciones-anular-contador'].textContent).toBe('0 / 300');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(true);
    expect(t.el['observaciones-anular-error'].hidden).toBe(true);
    expect(t.anulaciones).toHaveLength(0);
    expect(t.lecturas).toHaveLength(1);
  });

  test('no se abre mientras el modal de alta esta abierto (y viceversa)', async () => {
    const t = await conLista({ permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } });
    t.el['btn-observaciones-agregar'].click();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(false);
    t.abrirAnular(0);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
    t.el['btn-observaciones-form-cancelar'].click();
    t.abrirAnular(0);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
    t.el['btn-observaciones-agregar'].click();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
    expect(t.bodyClases.has('obs-form-abierto')).toBe(true);
  });
});

describe('motivo, contador y validacion', () => {
  test('cuenta code points; habilita desde 3; 300 si, 301 no con el aviso en palabras y aria-invalid', async () => {
    const t = await conLista();
    t.abrirAnular(0);
    t.escribir('ab');
    expect(t.el['observaciones-anular-contador'].textContent).toBe('2 / 300');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(true);
    t.escribir('abc');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(false);
    t.escribir('\u{1F600}'.repeat(300));
    expect(t.el['observaciones-anular-contador'].textContent).toBe('300 / 300');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(false);
    t.escribir('a'.repeat(301));
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(true);
    expect(t.el['observaciones-anular-contador'].textContent).toBe('301 / 300 · te pasaste por 1');
    expect(t.el['observaciones-anular-contador'].className).toContain('obs-form-contador-excede');
    expect(t.el['observaciones-anular-motivo'].attrs['aria-invalid']).toBe('true');
    t.escribir('  \n  ');
    expect(t.el['observaciones-anular-contador'].textContent).toBe('0 / 300');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(true);
  });

  test('enviar forzado con un motivo invalido: ningun pedido y error junto al campo con foco', async () => {
    const t = await conLista();
    t.abrirAnular(0);
    t.escribir('ab');
    t.confirmar();
    expect(t.anulaciones).toHaveLength(0);
    expect(t.el['observaciones-anular-error'].textContent).toBe('El motivo debe tener entre 3 y 300 caracteres.');
    expect(Nodo.enFoco).toBe(t.el['observaciones-anular-motivo']);
    expect(t.el['observaciones-anular-motivo'].attrs['aria-invalid']).toBe('true');
  });

  test('el submit siempre llama preventDefault', async () => {
    const t = await conLista();
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    t.confirmar();
    expect(t.prevenidos).toHaveLength(2);
    t.prevenidos.forEach((pd) => expect(pd).toHaveBeenCalledTimes(1));
  });
});

describe('confirmar la anulacion', () => {
  test('manda (token, observacionId, motivo normalizado, id "anu-") sin pozo ni texto; muestra "Anulando…" con todo bloqueado; el doble submit es UNA request', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'TEXTO-ORIGINAL-PRIVADO' }), obs(1)]);
    t.abrirAnular(0);
    t.escribir('  Cargada en el pozo\r\nequivocado  ');
    t.confirmar();
    t.confirmar();
    t.confirmar();
    expect(t.anulaciones).toHaveLength(1);
    expect(t.anulaciones[0]).toMatchObject({ token: 'tok-real', observacionId: 'obs-3', motivo: 'Cargada en el pozo\nequivocado' });
    expect(t.anulaciones[0].clientRequestId).toMatch(/^anu-[A-Za-z0-9_-]+$/);
    expect(Object.keys(t.anulaciones[0]).sort()).toEqual(['clientRequestId', 'motivo', 'observacionId', 'token']);
    expect(JSON.stringify(t.anulaciones)).not.toContain('TEXTO-ORIGINAL-PRIVADO');
    expect(t.el['btn-observaciones-anular-confirmar'].textContent).toBe('Anulando…');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(true);
    expect(t.el['btn-observaciones-anular-cancelar'].disabled).toBe(true);
    expect(t.el['btn-observaciones-anular-cerrar'].disabled).toBe(true);
    expect(t.el['observaciones-anular-motivo'].readOnly).toBe(true);
  });

  test('NO es optimista: la tarjeta no cambia hasta que llega la respuesta', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'sigue igual' })]);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    expect(t.lista()[0].className).toBe('obs-item');
    expect(t.textosLista()).toEqual(['sigue igual']);
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });
});

describe('exito: la tarjeta se actualiza EN SITIO', () => {
  test('texto null (autor / sin observaciones_anular): la tarjeta pasa a ANULADA SIN texto y el original DESAPARECE del DOM; mensaje "Observación anulada."; modal cerrado; la lista no se recarga', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'TEXTO-ORIGINAL-PRIVADO' }), obs(2), obs(1)]);
    expect(t.todoTexto()).toContain('TEXTO-ORIGINAL-PRIVADO');
    t.abrirAnular(0);
    t.escribir('Cargada por error');
    t.confirmar();
    await t.responder(respuesta(anulada(3, { anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Cargada por error' } })));
    expect(t.lista()).toHaveLength(3);                                        // en sitio: ninguna tarjeta nueva
    const li = t.lista()[0];
    expect(li.className).toBe('obs-item obs-item-anulada');
    expect(li.children[0].textContent).toBe('Observación anulada');
    expect(li.children.map((p) => p.className)).not.toContain('obs-texto obs-texto-original');
    expect(li.children.map((p) => p.className)).not.toContain('obs-texto');
    expect(t.todoTexto()).not.toContain('TEXTO-ORIGINAL-PRIVADO');
    expect(JSON.stringify(t.lista().map((n) => n.textContent))).not.toContain('TEXTO-ORIGINAL-PRIVADO');
    expect(t.botones()[0]).toBeNull();                                        // una anulada ya no tiene boton
    expect(t.botones()[1]).not.toBeNull();                                    // las demas siguen igual
    expect(t.el['observaciones-exito'].textContent).toBe('Observación anulada.');
    expect(t.el['observaciones-exito'].hidden).toBe(false);
    expect(t.el['observaciones-exito'].className).toBe('obs-exito');
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
    expect(t.el['observaciones-anular-motivo'].value).toBe('');
    expect(t.bodyClases.has('obs-form-abierto')).toBe(false);
    expect(t.lecturas).toHaveLength(1);
    expect(t.textosLista().slice(1)).toEqual(['Texto 2', 'Texto 1']);
  });

  test('texto string (el backend lo manda al moderador): sigue siendo ANULADA, con el original subordinado, el motivo y quien anulo', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3), obs(1)]);
    t.abrirAnular(0);
    t.escribir('Duplicada');
    t.confirmar();
    await t.responder(respuesta(anulada(3, { texto: 'Texto 3', anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Duplicada' } })));
    const li = t.lista()[0];
    expect(li.className).toBe('obs-item obs-item-anulada');
    expect(li.children.map((p) => p.className)).toEqual(['obs-anulada-titulo', 'obs-texto obs-texto-original', 'obs-meta', 'obs-meta', 'obs-motivo']);
    expect(li.children[1].textContent).toBe('Texto 3');
    expect(li.children[3].textContent).toBe('Anulada por Moderadora · 21/10/2026 15:30');
    expect(li.children[4].textContent).toBe('Motivo: Duplicada');
  });

  test('duplicada=true tambien es exito y actualiza la misma entrada (aunque otro la haya anulado)', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3), obs(1)]);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder(respuesta(anulada(3), true));
    expect(t.lista()).toHaveLength(2);
    expect(t.lista()[0].className).toBe('obs-item obs-item-anulada');
    expect(t.el['observaciones-exito'].textContent).toBe('Observación anulada.');
  });

  test('con paginas ya cargadas: solo cambia esa entrada, "Ver observaciones anteriores" sigue y su cursor es el del backend', async () => {
    const t = await conLista({ permisos: MOD }, [obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 });
    t.abrirAnular(1);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder(respuesta(anulada(4)));
    expect(t.lista().map((li) => li.className)).toEqual(['obs-item', 'obs-item obs-item-anulada']);
    expect(t.el['btn-observaciones-mas'].hidden).toBe(false);
    t.el['btn-observaciones-mas'].click();
    expect(t.lecturas[1]).toMatchObject({ antes: 4 });
    await t.responderLista(pagina([obs(3), obs(2)], { total: 4, hayMas: false }));
    expect(t.lista()).toHaveLength(4);
    expect(t.lista()[1].className).toBe('obs-item obs-item-anulada');
  });

  test('despues de anular, se puede anular OTRA con otro id; el modal vuelve a empezar limpio', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3), obs(2), obs(1)]);
    t.abrirAnular(0);
    t.escribir('motivo uno');
    t.confirmar();
    await t.responder(respuesta(anulada(3)));
    t.abrirAnular(1);
    expect(t.el['observaciones-anular-motivo'].value).toBe('');
    expect(t.el['observaciones-anular-contexto'].textContent).toContain('Ana');
    t.escribir('motivo uno');
    t.confirmar();
    expect(t.anulaciones[1].observacionId).toBe('obs-2');
    expect(t.anulaciones[1].clientRequestId).not.toBe(t.anulaciones[0].clientRequestId);
  });

  test('el foco vuelve al boton de agregar si el boton de la tarjeta ya no existe (la tarjeta cambio a anulada)', async () => {
    const t = await conLista({ permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder(respuesta(anulada(3)));
    expect(Nodo.enFoco).toBeTruthy();
    expect(Nodo.enFoco).not.toBe(t.el['observaciones-anular-motivo']);
  });
});

describe('errores: el modal sigue y el motivo no se pierde', () => {
  test('error de red: modal abierto, motivo y MISMO id al reintentar, tarjeta sin cambios', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'sigue igual' })]);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.fallar();
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
    expect(t.el['observaciones-anular-motivo'].value).toBe('motivo valido');
    expect(t.el['observaciones-anular-error'].textContent).toBe('No se pudo anular la observación. Intentá nuevamente.');
    expect(t.el['btn-observaciones-anular-confirmar'].disabled).toBe(false);
    expect(t.el['btn-observaciones-anular-confirmar'].textContent).toBe('Anular observación');
    expect(t.textosLista()).toEqual(['sigue igual']);
    t.confirmar();
    expect(t.anulaciones[1].clientRequestId).toBe(t.anulaciones[0].clientRequestId);
  });

  test('cambia el motivo despues de un error -> id nuevo', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo A');
    t.confirmar();
    await t.fallar();
    t.escribir('motivo B');
    t.confirmar();
    expect(t.anulaciones[1].clientRequestId).not.toBe(t.anulaciones[0].clientRequestId);
  });

  test.each([
    ['INVALID_MOTIVO', 'El motivo debe tener entre 3 y 300 caracteres.'],
    ['OBSERVACION_NOT_FOUND', 'La observación ya no está disponible.'],
    ['PERMISSION_DENIED', 'No tenés permiso para anular esta observación.'],
    ['IDEMPOTENCY_CONFLICT', 'La anulación cambió después de un intento anterior. Revisá el motivo e intentá nuevamente.'],
    ['SERVICE_UNAVAILABLE', 'No se pudo anular la observación. Intentá nuevamente.']
  ])('%s: mensaje exacto, sin detalle tecnico, motivo conservado, modal abierto', async (code, mensaje) => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('Motivo que no se pierde');
    t.confirmar();
    await t.responder({ status: 'error', code, message: 'DETALLE-INTERNO-SECRETO' });
    expect(t.el['observaciones-anular-error'].textContent).toBe(mensaje);
    expect(t.el['observaciones-anular-error'].textContent).not.toContain('DETALLE-INTERNO');
    expect(t.el['observaciones-anular-motivo'].value).toBe('Motivo que no se pierde');
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
    expect(t.sesion.onSessionExpired).not.toHaveBeenCalled();
  });

  test('INVALID_MOTIVO del backend: aria-invalid y foco al motivo; otros errores: foco al mensaje', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder({ status: 'error', code: 'INVALID_MOTIVO' });
    expect(t.el['observaciones-anular-motivo'].attrs['aria-invalid']).toBe('true');
    expect(Nodo.enFoco).toBe(t.el['observaciones-anular-motivo']);
    t.confirmar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(Nodo.enFoco).toBe(t.el['observaciones-anular-error']);
    expect(t.el['observaciones-anular-motivo'].attrs['aria-invalid']).toBe('false');
  });

  test('INVALID_TRANSITION: se cierra el modal, se vuelve a pedir la lista desde la primera pagina y se avisa "Esta observación ya no puede anularse."', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3), obs(1)]);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder({ status: 'error', code: 'INVALID_TRANSITION', message: 'x' });
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
    expect(t.lecturas).toHaveLength(2);
    expect(t.lecturas[1].antes).toBeUndefined();
    await t.responderLista(pagina([anulada(3), obs(1)]));
    expect(t.el['observaciones-exito'].textContent).toBe('Esta observación ya no puede anularse.');
    expect(t.el['observaciones-exito'].className).toBe('obs-aviso');
    expect(t.el['observaciones-exito'].hidden).toBe(false);
    expect(t.lista()[0].className).toBe('obs-item obs-item-anulada');
    expect(t.anulaciones).toHaveLength(1);                                    // no se reenvia nada
  });

  test('IDEMPOTENCY_CONFLICT: no se reenvia solo; el siguiente envio manual usa un id nuevo', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo A');
    t.confirmar();
    await t.responder({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.anulaciones).toHaveLength(1);
    t.confirmar();
    expect(t.anulaciones).toHaveLength(2);
    expect(t.anulaciones[1].clientRequestId).not.toBe(t.anulaciones[0].clientRequestId);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: dispara el logout global una vez', async (code) => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder({ status: 'error', code });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });
});

describe('cancelar, Escape y teclado', () => {
  test('Cancelar y x: cierran, descartan motivo y error y devuelven el foco al boton que abrio; reabrir -> limpio e id nuevo', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    const boton = t.botones()[0];
    t.escribir('motivo A');
    t.confirmar();
    await t.fallar();
    t.el['btn-observaciones-anular-cancelar'].click();
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
    expect(t.el['observaciones-anular-motivo'].value).toBe('');
    expect(t.el['observaciones-anular-error'].hidden).toBe(true);
    expect(Nodo.enFoco).toBe(boton);
    t.abrirAnular(0);
    expect(t.el['observaciones-anular-motivo'].value).toBe('');
    t.escribir('motivo A');
    t.confirmar();
    expect(t.anulaciones[1].clientRequestId).not.toBe(t.anulaciones[0].clientRequestId);
    expect(t.anulaciones).toHaveLength(2);                                    // cancelar no envio nada
    await t.fallar();
    t.el['btn-observaciones-anular-cerrar'].click();
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
  });

  test('Escape cierra; durante "Anulando…" ni Escape ni Cancelar cierran', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.tecla('Escape');
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    t.tecla('Escape');
    t.el['btn-observaciones-anular-cancelar'].oyentes.click();
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
  });

  test('Tab rota dentro del modal (Shift+Tab hacia atras); lo deshabilitado se saltea', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    const orden = [t.el['btn-observaciones-anular-cerrar'], t.el['observaciones-anular-motivo'], t.el['btn-observaciones-anular-cancelar'], t.el['btn-observaciones-anular-confirmar']];
    Nodo.enFoco = orden[3];
    const ev = t.tecla('Tab');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(Nodo.enFoco).toBe(orden[0]);
    t.tecla('Tab', { shiftKey: true });
    expect(Nodo.enFoco).toBe(orden[3]);
    t.escribir('');
    Nodo.enFoco = orden[2];
    t.tecla('Tab');
    expect(Nodo.enFoco).toBe(orden[0]);
    expect(t.tecla('a').preventDefault).not.toHaveBeenCalled();
  });
});

describe('XSS y privacidad', () => {
  const peligrosos = ['<script>alert(1)</script>', '<img src=x onerror="alert(1)">', '<b>x</b> & &amp; &lt;', '</li></ol><div id="x">hack</div>'];

  test.each(peligrosos.map((p) => [p]))('motivo %s: viaja y se muestra como TEXTO; el DOM falso lanzaria ante innerHTML; solo se crean li / p / button', async (motivo) => {
    const t = await conLista({ permisos: MOD }, [obs(3), obs(1)]);
    t.abrirAnular(0);
    t.escribir(motivo);
    t.confirmar();
    expect(t.anulaciones[0].motivo).toBe(motivo);
    await t.responder(respuesta(anulada(3, { anulacion: { nombre: motivo, timestamp: ISO, motivo } })));
    expect(t.lista()[0].children.map((p) => p.textContent)).toContain('Motivo: ' + motivo);
    expect(new Set(t.creados.map((n) => n.tag))).toEqual(new Set(['li', 'p', 'button']));
  });

  test('los mensajes de error no incluyen el motivo escrito ni el texto de la observacion', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'TEXTO-ORIGINAL-PRIVADO' })]);
    t.abrirAnular(0);
    t.escribir('MOTIVO-SECRETO-1234');
    t.confirmar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'MOTIVO-SECRETO-1234 TEXTO-ORIGINAL-PRIVADO' });
    expect(t.el['observaciones-anular-error'].textContent).not.toMatch(/MOTIVO-SECRETO|TEXTO-ORIGINAL/);
    expect(t.el['observaciones-anular-contexto'].textContent).not.toContain('TEXTO-ORIGINAL-PRIVADO');
  });

  test('email, clientRequestId y secuencia inesperados en la respuesta no llegan al DOM', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3)]);
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    await t.responder(respuesta(anulada(3, { email: 'ana@x.com', clientRequestId: 'req-SECRETO-1', secuencia: 424242, anulacion: { nombre: 'Mod', timestamp: ISO, motivo: 'm', email: 'mod@x.com', secuencia: 9 } })));
    expect(t.todoTexto()).not.toMatch(/@x\.com|SECRETO|424242/);
  });
});

describe('respuestas viejas: no se aplican al contexto incorrecto', () => {
  test('salir de la pantalla con el pedido en vuelo: la respuesta no toca nada', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    t.ctx.observacionesPozoController_cerrar();
    await t.responder(respuesta(anulada(3)));
    expect(t.lista()).toHaveLength(0);
    expect(t.el['observaciones-exito'].hidden).toBe(true);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
  });

  test('cerrar sesion (reset) en vuelo: idem, y el motivo se descarta', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('MOTIVO-CONFIDENCIAL');
    t.confirmar();
    t.ctx.observacionesPozoController_reset();
    await t.responder(respuesta(anulada(3)));
    expect(t.lista()).toHaveLength(0);
    expect(t.el['observaciones-anular-motivo'].value).toBe('');
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });

  test('cambiar de pozo con el pedido en vuelo: la respuesta del pozo anterior no entra en la lista del nuevo', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    t.ctx.observacionesPozoController_abrir('14-0002');
    await t.responderLista({ status: 'ok', data: { wellId: '14-0002', total: 1, activas: 1, anuladas: 0, hayMas: false, cursor: null, observaciones: [obs(3, { wellId: '14-0002', texto: 'del segundo pozo' })] } });
    await t.responder(respuesta(anulada(3)));
    expect(t.textosLista()).toEqual(['del segundo pozo']);
    expect(t.lista()[0].className).toBe('obs-item');                          // la entrada con el mismo id del OTRO pozo no se toca
    expect(t.el['observaciones-exito'].hidden).toBe(true);
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(true);
  });

  test('abrir el modal para OTRA observacion con el pedido en vuelo: la respuesta vieja no se aplica ni pisa el modal nuevo', async () => {
    const t = await conLista({ permisos: MOD }, [obs(3, { texto: 'primera' }), obs(1, { texto: 'segunda' })]);
    t.abrirAnular(0);
    t.escribir('motivo viejo');
    t.confirmar();
    t.abrirAnular(1);                                                         // otro objetivo mientras el primero esta en vuelo
    expect(t.el['observaciones-anular-contexto'].textContent).toContain('Ana');
    t.escribir('motivo nuevo');
    await t.responder(respuesta(anulada(3)), 0);
    expect(t.lista()[0].className).toBe('obs-item');                          // la primera NO se actualizo con la respuesta vieja
    expect(t.textosLista()[0]).toBe('primera');
    expect(t.el['observaciones-anular-overlay'].hidden).toBe(false);
    expect(t.el['observaciones-anular-motivo'].value).toBe('motivo nuevo');
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });

  test('un error tardio de un contexto viejo tampoco aparece ni cierra la sesion ni refresca', async () => {
    const t = await conLista({ permisos: MOD });
    t.abrirAnular(0);
    t.escribir('motivo valido');
    t.confirmar();
    t.ctx.observacionesPozoController_cerrar();
    await t.responder({ status: 'error', code: 'INVALID_TRANSITION' });
    expect(t.sesion.onSessionExpired).not.toHaveBeenCalled();
    expect(t.lecturas).toHaveLength(1);
  });
});
