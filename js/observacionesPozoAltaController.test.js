// Controlador DOM del ALTA de observaciones (E5-5): js/observacionesPozo.js ejecutado de verdad con un DOM minimo falso (que LANZA ante innerHTML / insertAdjacentHTML). Cubre el boton y sus
// permisos, el formulario (abrir, foco, contador, validacion, cancelar, Escape, Tab), el envio (estado "Guardando…", doble submit), el exito (la observacion entra arriba de la lista sin recargar), los
// errores (el texto se conserva), la paginacion abierta, el XSS y las respuestas viejas. La logica fina esta en observacionesPozoAlta.test.js.
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
  'observaciones-anular-overlay', 'observaciones-anular-form', 'observaciones-anular-contexto', 'observaciones-anular-motivo', 'observaciones-anular-contador', 'observaciones-anular-error', 'btn-observaciones-anular-cerrar', 'btn-observaciones-anular-cancelar', 'btn-observaciones-anular-confirmar'];
const OCULTOS = ['observaciones-cargando', 'observaciones-error', 'observaciones-contenido', 'observaciones-acciones', 'observaciones-exito', 'observaciones-vacio', 'observaciones-error-mas', 'btn-observaciones-mas',
  'btn-observaciones-reintentar', 'observaciones-form-overlay', 'observaciones-form-error', 'observaciones-anular-overlay', 'observaciones-anular-error'];
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null }, extra || {});
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });
const alta = (o, duplicada) => ({ status: 'ok', data: { wellId: W, duplicada: duplicada === true, observacion: o } });

function cargar(opc) {
  const o = opc || {};
  const el = {};
  IDS.forEach((id) => { el[id] = new Nodo('el'); });
  OCULTOS.forEach((id) => { el[id].hidden = true; });
  el['btn-observaciones-form-guardar'].disabled = true;
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
  const escrituras = [];
  const escriturasPend = [];
  ctx.apiGetObservacionesPozo = jest.fn((token, wellId, limit, antes) => { lecturas.push({ token, wellId, limit, antes }); return new Promise((res) => { lecturasPend.push(res); }); });
  ctx.apiAnularObservacionPozo = jest.fn(() => new Promise(() => {}));
  ctx.apiAgregarObservacionPozo = jest.fn((token, wellId, texto, clientRequestId) => { escrituras.push({ token, wellId, texto, clientRequestId }); return new Promise((res, rej) => { escriturasPend.push({ res, rej }); }); });
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { observaciones: true, observaciones_agregar: true }, onSessionExpired: jest.fn() };
  ctx.observacionesPozoController_inicializar(() => sesion);
  const t = {
    ctx, el, sesion, lecturas, escrituras, creados, bodyClases, prevenidos: [],
    responderLista: async (resp, i) => { lecturasPend[i === undefined ? lecturasPend.length - 1 : i](resp); await flush(); },
    responder: async (resp, i) => { escriturasPend[i === undefined ? escriturasPend.length - 1 : i].res(resp); await flush(); },
    fallar: async (i) => { escriturasPend[i === undefined ? escriturasPend.length - 1 : i].rej(new Error('red')); await flush(); },
    lista: () => el['observaciones-lista'].children,
    textosLista: () => el['observaciones-lista'].children.map((li) => li.children[0].textContent),
    escribir: (texto) => { el['observaciones-form-texto'].value = texto; el['observaciones-form-texto'].oyentes.input(); },
    enviar: () => { const pd = jest.fn(); el['observaciones-form'].oyentes.submit({ preventDefault: pd }); t.prevenidos.push(pd); },
    abrirForm: () => { el['btn-observaciones-agregar'].click(); },
    tecla: (key, extra) => { const ev = Object.assign({ key, preventDefault: jest.fn() }, extra || {}); el['observaciones-form-overlay'].oyentes.keydown(ev); return ev; }
  };
  return t;
}

async function conLista(opc, items, extra) {
  const t = cargar(opc);
  t.ctx.observacionesPozoController_abrir(W);
  await t.responderLista(pagina(items === undefined ? [obs(2), obs(1)] : items, extra));
  return t;
}

describe('boton "Agregar observacion": solo con observaciones === true Y observaciones_agregar === true', () => {
  test.each([
    [{ observaciones: true, observaciones_agregar: true }, true],
    [{ observaciones: true, observaciones_agregar: false }, false],
    [{ observaciones: true }, false],
    [{ observaciones: true, observaciones_anular: true }, false],
    [{ observaciones: true, observaciones_agregar: 'SI' }, false],
    [{ observaciones: true, observaciones_agregar: 1 }, false],
    [{ observaciones: true, observaciones_agregar: 'true' }, false],
    [{ observaciones: true, observaciones_agregar: {} }, false]
  ])('%j -> visible=%s', async (permisos, visible) => {
    const t = await conLista({ permisos });
    expect(t.el['observaciones-acciones'].hidden).toBe(!visible);
  });

  test('sin observaciones (solo agregar) la pantalla ni siquiera pide la lista: el boton no existe', async () => {
    const t = cargar({ permisos: { observaciones_agregar: true } });
    await t.ctx.observacionesPozoController_abrir(W);
    expect(t.ctx.apiGetObservacionesPozo).not.toHaveBeenCalled();
    expect(t.el['observaciones-acciones'].hidden).toBe(true);
  });

  test('no se ve mientras carga ni si la lista fallo; con el estado vacio SI se ve', async () => {
    const t = cargar();
    t.ctx.observacionesPozoController_abrir(W);
    expect(t.el['observaciones-acciones'].hidden).toBe(true);
    await t.responderLista({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(t.el['observaciones-acciones'].hidden).toBe(true);
    const v = await conLista({}, [], { total: 0 });
    expect(v.el['observaciones-acciones'].hidden).toBe(false);
    expect(v.el['observaciones-vacio'].hidden).toBe(false);
  });

  test('aunque se fuerce el listener sin el permiso, no abre nada', async () => {
    const t = await conLista({ permisos: { observaciones: true } });
    t.abrirForm();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
  });
});

describe('abrir el formulario', () => {
  test('se muestra el modal, foco en el textarea, contador 0 / 1000, Guardar deshabilitado, sin error; ni se pide nada al backend', async () => {
    const t = await conLista();
    t.abrirForm();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(false);
    expect(t.bodyClases.has('obs-form-abierto')).toBe(true);
    expect(Nodo.enFoco).toBe(t.el['observaciones-form-texto']);
    expect(t.el['observaciones-form-contador'].textContent).toBe('0 / 1000');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(true);
    expect(t.el['observaciones-form-error'].hidden).toBe(true);
    expect(t.escrituras).toHaveLength(0);
    expect(t.lecturas).toHaveLength(1);
  });

  test('el mensaje de exito anterior se limpia al abrir uno nuevo', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('primera');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'primera' })));
    expect(t.el['observaciones-exito'].hidden).toBe(false);
    t.abrirForm();
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });
});

describe('contador y validacion en pantalla', () => {
  test('cuenta caracteres unicos y habilita Guardar desde 3', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('ab');
    expect(t.el['observaciones-form-contador'].textContent).toBe('2 / 1000');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(true);
    t.escribir('abc');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(false);
    t.escribir('\u{1F600}\u{1F600}\u{1F600}');
    expect(t.el['observaciones-form-contador'].textContent).toBe('3 / 1000');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(false);
    t.escribir('  \n  ');
    expect(t.el['observaciones-form-contador'].textContent).toBe('0 / 1000');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(true);
  });

  test('1000 si, 1001 no: el exceso se dice con palabras, con otra clase y con aria-invalid', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('a'.repeat(1000));
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(false);
    expect(t.el['observaciones-form-contador'].className).toBe('obs-form-contador');
    expect(t.el['observaciones-form-texto'].attrs['aria-invalid']).toBe('false');
    t.escribir('a'.repeat(1001));
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(true);
    expect(t.el['observaciones-form-contador'].textContent).toBe('1001 / 1000 · te pasaste por 1');
    expect(t.el['observaciones-form-contador'].className).toContain('obs-form-contador-excede');
    expect(t.el['observaciones-form-texto'].attrs['aria-invalid']).toBe('true');
  });

  test('1000 emoji (2000 unidades UTF-16) son validos', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('\u{1F4A7}'.repeat(1000));
    expect(t.el['observaciones-form-contador'].textContent).toBe('1000 / 1000');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(false);
  });

  test('enviar con el boton deshabilitado / texto invalido (submit forzado) no hace ningun pedido', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('ab');
    t.enviar();
    expect(t.escrituras).toHaveLength(0);
    expect(t.el['observaciones-form-error'].hidden).toBe(false);
    expect(t.el['observaciones-form-error'].textContent).toBe('La observación debe tener entre 3 y 1000 caracteres.');
    expect(Nodo.enFoco).toBe(t.el['observaciones-form-texto']);
  });
});

describe('guardar', () => {
  test('manda (token, pozo, texto normalizado, id) y muestra "Guardando…" con todo bloqueado; el doble submit no duplica el pedido', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('  Bomba nueva\r\nsin ruido  ');
    t.enviar();
    t.enviar();
    t.enviar();
    expect(t.escrituras).toHaveLength(1);
    expect(t.escrituras[0]).toMatchObject({ token: 'tok-real', wellId: W, texto: 'Bomba nueva\nsin ruido' });
    expect(t.escrituras[0].clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(t.el['btn-observaciones-form-guardar'].textContent).toBe('Guardando…');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(true);
    expect(t.el['btn-observaciones-form-cancelar'].disabled).toBe(true);
    expect(t.el['btn-observaciones-form-cerrar'].disabled).toBe(true);
    expect(t.el['observaciones-form-texto'].readOnly).toBe(true);
  });

  test('el submit del formulario SIEMPRE llama preventDefault (si no, el navegador recargaria la pagina y se perderia todo)', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    t.enviar();
    expect(t.prevenidos).toHaveLength(2);
    t.prevenidos.forEach((pd) => expect(pd).toHaveBeenCalledTimes(1));
  });

  test('NO es optimista: la lista no cambia hasta que llega la respuesta', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    expect(t.textosLista()).toEqual(['Texto 2', 'Texto 1']);
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });

  test('el payload no lleva categoria, email, nombre, fecha, observacionId, secuencia ni permisos (solo token, pozo, texto e id)', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    expect(Object.keys(t.escrituras[0]).sort()).toEqual(['clientRequestId', 'texto', 'token', 'wellId']);
  });
});

describe('exito: la observacion entra arriba, sin recargar', () => {
  test('aparece primera, el modal se cierra y se limpia, "Observación agregada." y el foco vuelve al boton; la lista no se vuelve a pedir', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'Bomba nueva', nombre: 'Ana' })));
    expect(t.textosLista()).toEqual(['Bomba nueva', 'Texto 2', 'Texto 1']);
    expect(t.lista()[0].className).toBe('obs-item');
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
    expect(t.bodyClases.has('obs-form-abierto')).toBe(false);
    expect(t.el['observaciones-form-texto'].value).toBe('');
    expect(t.el['observaciones-exito'].hidden).toBe(false);
    expect(t.el['observaciones-exito'].textContent).toBe('Observación agregada.');
    expect(Nodo.enFoco).toBe(t.el['btn-observaciones-agregar']);
    expect(t.lecturas).toHaveLength(1);
  });

  test('la recien creada trae la senal del backend: con puedeAnular=true su tarjeta tiene "Anular" sin recargar; con false o ausente, no', async () => {
    const t = await conLista({ permisos: { observaciones: true, observaciones_agregar: true } });
    const botonDe = (i) => t.lista()[i].children.filter((p) => p.className === 'obs-item-acciones').map((p) => p.children[0])[0] || null;
    t.abrirForm();
    t.escribir('Con la senal');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'Con la senal', puedeAnular: true })));
    expect(botonDe(0)).not.toBeNull();
    expect(botonDe(0).textContent).toBe('Anular');
    expect(botonDe(1)).toBeNull();                                                  // las que ya estaban no cambian (sin senal)
    t.abrirForm();
    t.escribir('Sin la senal');
    t.enviar();
    await t.responder(alta(obs(10, { texto: 'Sin la senal' })));
    expect(t.textosLista()[0]).toBe('Sin la senal');
    expect(botonDe(0)).toBeNull();
    expect(t.lecturas).toHaveLength(1);
  });

  test('duplicada=true (reintento idempotente) tambien es exito, con el mismo mensaje', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'Bomba nueva' }), true));
    expect(t.el['observaciones-exito'].textContent).toBe('Observación agregada.');
    expect(t.lista()).toHaveLength(3);
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
  });

  test('si la observacion ya estaba en la lista no se duplica (pero igual es exito)', async () => {
    const t = await conLista({}, [obs(9, { texto: 'Bomba nueva' }), obs(1)]);
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'Bomba nueva' }), true));
    expect(t.lista()).toHaveLength(2);
    expect(t.el['observaciones-exito'].textContent).toBe('Observación agregada.');
  });

  test('el estado vacio desaparece y aparece la nueva', async () => {
    const t = await conLista({}, [], { total: 0 });
    expect(t.el['observaciones-vacio'].hidden).toBe(false);
    t.abrirForm();
    t.escribir('Primera observacion');
    t.enviar();
    await t.responder(alta(obs(1, { texto: 'Primera observacion' })));
    expect(t.el['observaciones-vacio'].hidden).toBe(true);
    expect(t.textosLista()).toEqual(['Primera observacion']);
  });

  test('con paginas ya cargadas: queda arriba, "Ver observaciones anteriores" sigue y su cursor es el del backend', async () => {
    const t = await conLista({}, [obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 });
    t.abrirForm();
    t.escribir('Nueva arriba');
    t.enviar();
    await t.responder(alta(obs(9, { texto: 'Nueva arriba' })));
    expect(t.textosLista()).toEqual(['Nueva arriba', 'Texto 5', 'Texto 4']);
    expect(t.el['btn-observaciones-mas'].hidden).toBe(false);
    t.el['btn-observaciones-mas'].click();
    expect(t.lecturas[1]).toMatchObject({ antes: 4 });
    await t.responderLista(pagina([obs(3), obs(2)], { total: 4, hayMas: false }));
    expect(t.textosLista()).toEqual(['Nueva arriba', 'Texto 5', 'Texto 4', 'Texto 3', 'Texto 2']);
  });

  test('una segunda alta tambien entra arriba, con un id distinto', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('primera alta');
    t.enviar();
    await t.responder(alta(obs(8, { texto: 'primera alta' })));
    t.abrirForm();
    t.escribir('segunda alta');
    t.enviar();
    expect(t.escrituras[1].clientRequestId).not.toBe(t.escrituras[0].clientRequestId);
    await t.responder(alta(obs(9, { texto: 'segunda alta' })));
    expect(t.textosLista().slice(0, 2)).toEqual(['segunda alta', 'primera alta']);
  });
});

describe('errores: el formulario no se limpia', () => {
  test('error de red: sigue abierto, texto y MISMO id al reintentar, mensaje contextual', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    await t.fallar();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(false);
    expect(t.el['observaciones-form-texto'].value).toBe('Bomba nueva');
    expect(t.el['observaciones-form-error'].hidden).toBe(false);
    expect(t.el['observaciones-form-error'].textContent).toBe('No se pudo guardar la observación. Intentá nuevamente.');
    expect(t.el['btn-observaciones-form-guardar'].disabled).toBe(false);
    expect(t.el['btn-observaciones-form-guardar'].textContent).toBe('Guardar');
    expect(t.textosLista()).toEqual(['Texto 2', 'Texto 1']);                 // nada optimista
    t.enviar();
    expect(t.escrituras.map((e) => e.clientRequestId)[1]).toBe(t.escrituras[0].clientRequestId);
  });

  test('error de red, cambia el texto -> id nuevo', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto A');
    t.enviar();
    await t.fallar();
    t.escribir('texto B');
    t.enviar();
    expect(t.escrituras[1].clientRequestId).not.toBe(t.escrituras[0].clientRequestId);
    expect(t.escrituras[1].texto).toBe('texto B');
  });

  test.each([
    ['INVALID_TEXTO', 'La observación debe tener entre 3 y 1000 caracteres.'],
    ['WELL_NOT_FOUND', 'No se pudo confirmar que este pozo exista en las fuentes disponibles.'],
    ['SERVICE_UNAVAILABLE', 'No se pudo guardar la observación. Intentá nuevamente.'],
    ['IDEMPOTENCY_CONFLICT', 'La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.'],
    ['PERMISSION_DENIED', 'No tenés permiso para agregar observaciones.'],
    ['INVALID_CATEGORIA', 'No se pudo guardar la observación. Intentá nuevamente.']
  ])('%s: mensaje exacto, sin detalle tecnico, y el texto sigue ahi', async (code, mensaje) => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Texto que no se pierde');
    t.enviar();
    await t.responder({ status: 'error', code, message: 'DETALLE-INTERNO-SECRETO' });
    expect(t.el['observaciones-form-error'].textContent).toBe(mensaje);
    expect(t.el['observaciones-form-error'].textContent).not.toContain('DETALLE-INTERNO');
    expect(t.el['observaciones-form-texto'].value).toBe('Texto que no se pierde');
    expect(t.el['observaciones-form-overlay'].hidden).toBe(false);
    expect(t.sesion.onSessionExpired).not.toHaveBeenCalled();
  });

  test('INVALID_TEXTO del backend: aria-invalid, foco al textarea; otros errores: foco al mensaje', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Texto largo valido');
    t.enviar();
    await t.responder({ status: 'error', code: 'INVALID_TEXTO' });
    expect(t.el['observaciones-form-texto'].attrs['aria-invalid']).toBe('true');
    expect(Nodo.enFoco).toBe(t.el['observaciones-form-texto']);
    t.enviar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(Nodo.enFoco).toBe(t.el['observaciones-form-error']);
    expect(t.el['observaciones-form-texto'].attrs['aria-invalid']).toBe('false');
  });

  test('IDEMPOTENCY_CONFLICT: no se reenvia solo y el siguiente envio manual usa un id nuevo', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto A');
    t.enviar();
    await t.responder({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.escrituras).toHaveLength(1);
    t.enviar();
    expect(t.escrituras).toHaveLength(2);
    expect(t.escrituras[1].clientRequestId).not.toBe(t.escrituras[0].clientRequestId);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: dispara el flujo global de sesion (logout) una vez', async (code) => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto valido');
    t.enviar();
    await t.responder({ status: 'error', code });
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test('editar despues de un error limpia el aviso', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto A');
    t.enviar();
    await t.fallar();
    t.escribir('texto A + algo');
    expect(t.el['observaciones-form-error'].hidden).toBe(true);
  });
});

describe('cancelar, Escape y teclado', () => {
  test('Cancelar: cierra, descarta texto y error, devuelve el foco; reabrir -> limpio y con id nuevo', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto A');
    t.enviar();
    await t.fallar();
    t.el['btn-observaciones-form-cancelar'].click();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
    expect(t.el['observaciones-form-texto'].value).toBe('');
    expect(t.el['observaciones-form-error'].hidden).toBe(true);
    expect(Nodo.enFoco).toBe(t.el['btn-observaciones-agregar']);
    t.abrirForm();
    expect(t.el['observaciones-form-texto'].value).toBe('');
    expect(t.el['observaciones-form-contador'].textContent).toBe('0 / 1000');
    expect(t.el['observaciones-form-error'].hidden).toBe(true);
    t.escribir('texto A');
    t.enviar();
    expect(t.escrituras[1].clientRequestId).not.toBe(t.escrituras[0].clientRequestId);
    expect(t.escrituras.length).toBe(2);                                       // cancelar no escribio nada
  });

  test('el boton × cancela igual; Escape cierra el modal', async () => {
    const t = await conLista();
    t.abrirForm();
    t.el['btn-observaciones-form-cerrar'].click();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
    t.abrirForm();
    t.tecla('Escape');
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
    expect(t.escrituras).toHaveLength(0);
  });

  test('mientras se guarda, Escape y Cancelar no cierran', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto valido');
    t.enviar();
    t.tecla('Escape');
    t.el['btn-observaciones-form-cancelar'].oyentes.click();
    expect(t.el['observaciones-form-overlay'].hidden).toBe(false);
  });

  test('Tab rota el foco dentro del modal (y Shift+Tab hacia atras); lo deshabilitado se saltea', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto valido');
    const orden = [t.el['btn-observaciones-form-cerrar'], t.el['observaciones-form-texto'], t.el['btn-observaciones-form-cancelar'], t.el['btn-observaciones-form-guardar']];
    Nodo.enFoco = orden[3];
    let ev = t.tecla('Tab');
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(Nodo.enFoco).toBe(orden[0]);
    ev = t.tecla('Tab', { shiftKey: true });
    expect(Nodo.enFoco).toBe(orden[3]);
    t.escribir('');                                                              // Guardar deshabilitado: queda fuera de la rotacion
    Nodo.enFoco = orden[2];
    t.tecla('Tab');
    expect(Nodo.enFoco).toBe(orden[0]);
    expect(t.tecla('a').preventDefault).not.toHaveBeenCalled();
  });
});

describe('XSS y privacidad del formulario', () => {
  const peligrosos = ['<script>alert(1)</script>', '<img src=x onerror="alert(1)">', '<b>x</b> & &amp; &lt;', '</li></ol><div id="x">hack</div>'];

  test.each(peligrosos.map((p) => [p]))('%s: viaja como texto, se renderiza como texto y nunca se interpreta (el DOM falso lanzaria con innerHTML)', async (texto) => {
    const t = await conLista();
    t.abrirForm();
    t.escribir(texto);
    t.enviar();
    expect(t.escrituras[0].texto).toBe(texto);
    await t.responder(alta(obs(9, { texto })));
    expect(t.textosLista()[0]).toBe(texto);
    expect(new Set(t.creados.map((n) => n.tag))).toEqual(new Set(['li', 'p']));
  });

  test('los mensajes de error no incluyen el texto escrito', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('SECRETO-DE-LA-OBSERVACION');
    t.enviar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'SECRETO-DE-LA-OBSERVACION' });
    expect(t.el['observaciones-form-error'].textContent).not.toContain('SECRETO');
  });

  test('multilinea, emoji y acentos viajan y se muestran intactos', async () => {
    const t = await conLista();
    t.abrirForm();
    const texto = 'Caño de 4" \u{1F4A7}\nSegunda línea\n\nTercera';
    t.escribir(texto);
    t.enviar();
    expect(t.escrituras[0].texto).toBe(texto);
    await t.responder(alta(obs(9, { texto })));
    expect(t.textosLista()[0]).toBe(texto);
  });
});

describe('respuestas viejas: no se aplican al contexto incorrecto', () => {
  test('salir de la pantalla (Volver) con el pedido en vuelo: la respuesta no toca nada', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba nueva');
    t.enviar();
    t.ctx.observacionesPozoController_cerrar();
    await t.responder(alta(obs(9, { texto: 'Bomba nueva' })));
    expect(t.lista()).toHaveLength(0);
    expect(t.el['observaciones-exito'].hidden).toBe(true);
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
  });

  test('cerrar sesion (reset) en vuelo: idem, y el texto del formulario se descarta', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('TEXTO-CONFIDENCIAL');
    t.enviar();
    t.ctx.observacionesPozoController_reset();
    await t.responder(alta(obs(9)));
    expect(t.lista()).toHaveLength(0);
    expect(t.el['observaciones-form-texto'].value).toBe('');
    expect(t.el['observaciones-exito'].hidden).toBe(true);
  });

  test('cambiar de pozo con el pedido en vuelo: la respuesta del pozo anterior no entra en la lista del nuevo', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('Bomba del primer pozo');
    t.enviar();
    t.ctx.observacionesPozoController_abrir('14-0002');
    await t.responderLista({ status: 'ok', data: { wellId: '14-0002', total: 1, activas: 1, anuladas: 0, hayMas: false, cursor: null, observaciones: [obs(50, { wellId: '14-0002', texto: 'del segundo pozo' })] } });
    await t.responder(alta(obs(9, { texto: 'Bomba del primer pozo' })));
    expect(t.textosLista()).toEqual(['del segundo pozo']);
    expect(t.el['observaciones-exito'].hidden).toBe(true);
    expect(t.el['observaciones-form-overlay'].hidden).toBe(true);
  });

  test('un error tardio de un contexto viejo tampoco aparece ni cierra la sesion', async () => {
    const t = await conLista();
    t.abrirForm();
    t.escribir('texto valido');
    t.enviar();
    t.ctx.observacionesPozoController_cerrar();
    await t.responder({ status: 'error', code: 'UNAUTHORIZED' });
    expect(t.sesion.onSessionExpired).not.toHaveBeenCalled();
    expect(t.el['observaciones-form-error'].hidden).toBe(true);
  });
});
