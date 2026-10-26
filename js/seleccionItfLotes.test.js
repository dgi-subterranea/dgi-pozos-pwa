// Controlador de Mi seleccion (js/seleccion.js) ejecutado de verdad sobre un DOM falso permisivo: la disponibilidad de ITF se pide en lotes de a lo sumo 500 wellId (el backend rechaza mas),
// con un maximo de 3 en vuelo, y un lote que falla deja a SUS pozos como desconocidos (nunca "No"). Solo se simula apiGetItfAvailability.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const fuentes = ['mapaLogic.js', 'reemplazoResumenLogic.js', 'seleccionLogic.js', 'seleccion.js'].map(leer);
const flush = async () => { for (let i = 0; i < 20; i += 1) { await new Promise((r) => setImmediate(r)); } };

// nodo DOM permisivo: cualquier propiedad es otro nodo, llamable; las asignaciones se guardan
function nodo() {
  const guardado = {};
  const f = function () { return nodo(); };
  return new Proxy(f, {
    get(t, k) {
      if (Object.prototype.hasOwnProperty.call(guardado, k)) { return guardado[k]; }
      if (k === 'then') { return undefined; }
      if (k === Symbol.toPrimitive) { return () => ''; }
      if (k === 'value') { return ''; }
      return nodo();
    },
    set(t, k, v) { guardado[k] = v; return true; },
    apply() { return nodo(); }
  });
}

const ids = (n, desde) => Array.from({ length: n }, (_, i) => '14-' + String((desde || 0) + i).padStart(4, '0'));
const ok = (data) => ({ status: 'ok', data });
const disponibilidadDe = (lote, valor) => { const o = {}; lote.forEach((w) => { o[w] = typeof valor === 'function' ? valor(w) : valor; }); return o; };

function montar(opc) {
  const o = opc || {};
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, Set, Map, isFinite, setTimeout, Proxy, Symbol });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.requestAnimationFrame = (fn) => setImmediate(fn);
  ctx.getComputedStyle = () => ({});
  ctx.document = { body: nodo(), documentElement: nodo(), getElementById: () => nodo(), createElement: () => nodo(), querySelector: () => nodo(), querySelectorAll: () => [] };
  const llamadas = [];
  let enVuelo = 0;
  let maxEnVuelo = 0;
  ctx.apiGetItfAvailability = jest.fn((token, lote) => {
    llamadas.push({ token, lote: lote.slice() });
    enVuelo += 1;
    maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    const idx = llamadas.length - 1;
    const respuesta = o.responder ? o.responder(lote, idx) : ok(disponibilidadDe(lote, true));
    return new Promise((resolver, rechazar) => {
      setImmediate(() => {
        enVuelo -= 1;
        if (respuesta === 'RED') { rechazar(new Error('red')); } else { resolver(respuesta); }
      });
    });
  });
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { perfil: true }, onSessionExpired: jest.fn() };
  ctx.seleccionController_inicializar(() => sesion);
  return { ctx, sesion, llamadas, maxEnVuelo: () => maxEnVuelo };
}

function seleccionar(ctx, wellIds) {
  ctx.seleccionController_proponerSeleccion(wellIds, 'radio', { lat: 0, lon: 0, radioMetros: 1 });
}

describe('disponibilidad ITF en lotes de a lo sumo 500', () => {
  test.each([[1, [1]], [500, [500]], [501, [500, 1]], [1200, [500, 500, 200]]])('%i pozos seleccionados -> llamadas de %j wellId, ninguna mayor a 500', async (n, tamanos) => {
    const { ctx, llamadas } = montar();
    seleccionar(ctx, ids(n));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas.map((l) => l.lote.length)).toEqual(tamanos);
    expect(llamadas.every((l) => l.lote.length <= 500)).toBe(true);
    expect([].concat(...llamadas.map((l) => l.lote))).toEqual(ids(n));          // todos los pozos, una sola vez cada uno
    expect(Object.keys(r.disponibilidad)).toHaveLength(n);
    expect(r.desconocidos).toEqual([]);
    expect(llamadas.every((l) => l.token === 'tok-real')).toBe(true);
  });

  test('la seleccion completa (13.804 pozos) se parte en 28 lotes con maximo 3 en vuelo', async () => {
    const { ctx, llamadas, maxEnVuelo } = montar();
    seleccionar(ctx, ids(13804));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas).toHaveLength(28);
    expect(llamadas.every((l) => l.lote.length <= 500)).toBe(true);
    expect(maxEnVuelo()).toBeLessThanOrEqual(3);
    expect(maxEnVuelo()).toBeGreaterThan(1);                                    // en paralelo, no uno por uno
    expect(Object.keys(r.disponibilidad)).toHaveLength(13804);
  });

  test('une los resultados de todos los lotes: Si y No bien asignados a cada pozo', async () => {
    const { ctx } = montar({ responder: (lote) => ok(disponibilidadDe(lote, (w) => Number(w.slice(3)) % 2 === 0)) });
    seleccionar(ctx, ids(1100));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.disponibilidad['14-0000']).toBe(true);
    expect(r.disponibilidad['14-0001']).toBe(false);
    expect(r.disponibilidad['14-0999']).toBe(false);
    expect(r.disponibilidad['14-1000']).toBe(true);
    expect(r.desconocidos).toEqual([]);
  });

  test('sin pozos seleccionados no se llama al backend', async () => {
    const { ctx, llamadas } = montar();
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas).toHaveLength(0);
    expect(r).toEqual({ disponibilidad: {}, desconocidos: [] });
  });
});

describe('fallos parciales: Si / No / Desconocido', () => {
  const lote2 = ids(500, 500);

  test('lote 1 OK, lote 2 con error: los pozos del lote 2 quedan DESCONOCIDOS (ni "No" ni "Si"); el resto conserva su respuesta', async () => {
    const { ctx } = montar({ responder: (lote, i) => (i === 1 ? { status: 'error', code: 'SERVICE_UNAVAILABLE' } : ok(disponibilidadDe(lote, true))) });
    seleccionar(ctx, ids(1200));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.desconocidos).toEqual(lote2);
    lote2.forEach((w) => { expect(w in r.disponibilidad).toBe(false); });
    expect(Object.keys(r.disponibilidad)).toHaveLength(700);
    expect(r.disponibilidad['14-0000']).toBe(true);
    expect(r.disponibilidad['14-1100']).toBe(true);
  });

  test('un lote que RECHAZA (error de red) tambien deja sus pozos desconocidos, sin tirar abajo a los demas', async () => {
    const { ctx } = montar({ responder: (lote, i) => (i === 1 ? 'RED' : ok(disponibilidadDe(lote, false))) });
    seleccionar(ctx, ids(1200));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.desconocidos).toEqual(lote2);
    expect(r.disponibilidad['14-0000']).toBe(false);                            // "No" afirmado por el backend en un lote que si respondio
    expect('14-0500' in r.disponibilidad).toBe(false);
  });

  test('todos los lotes fallan: todo desconocido, disponibilidad vacia (jamas "No" masivo)', async () => {
    const { ctx } = montar({ responder: () => ({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) });
    seleccionar(ctx, ids(700));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.desconocidos).toEqual(ids(700));
    expect(r.disponibilidad).toEqual({});
  });

  test('un lote OK sin booleano para algun pozo (respuesta incompleta) lo deja desconocido', async () => {
    const { ctx } = montar({ responder: (lote) => ok(disponibilidadDe(lote.slice(0, 2), true)) });
    seleccionar(ctx, ids(5));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.desconocidos).toEqual(ids(3, 2));
    expect(Object.keys(r.disponibilidad)).toEqual(ids(2));
  });

  test('con un fallo parcial NO se da por lista la disponibilidad: el siguiente pedido reintenta, y solo ahi se completa', async () => {
    let falla = true;
    const { ctx, llamadas } = montar({ responder: (lote, i) => (falla && i === 1 ? { status: 'error', code: 'X' } : ok(disponibilidadDe(lote, true))) });
    seleccionar(ctx, ids(1200));
    const primero = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(primero.desconocidos).toHaveLength(500);
    const antes = llamadas.length;
    falla = false;
    const segundo = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas.length).toBeGreaterThan(antes);                             // volvio a pedir
    expect(segundo.desconocidos).toEqual([]);
    expect(Object.keys(segundo.disponibilidad)).toHaveLength(1200);
  });

  test('una disponibilidad completa se cachea: el segundo pedido no llama al backend', async () => {
    const { ctx, llamadas } = montar();
    seleccionar(ctx, ids(1200));
    await ctx.seleccionController_asegurarDisponibilidadItf();
    const n = llamadas.length;
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas).toHaveLength(n);
    expect(Object.keys(r.disponibilidad)).toHaveLength(1200);
  });

  test('si la seleccion cambia mientras se pide, el resultado viejo no se guarda ni se da por lista', async () => {
    const { ctx, llamadas } = montar();
    seleccionar(ctx, ids(600));
    const pendiente = ctx.seleccionController_asegurarDisponibilidadItf();
    ctx.seleccionController_quitarPozo('14-0000');                              // cambia la seleccion antes de que respondan
    const viejo = await pendiente;
    expect(viejo.disponibilidad).toEqual({});                                   // lo que respondio para la seleccion anterior no se guarda
    const n = llamadas.length;
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(llamadas.length).toBeGreaterThan(n);                                 // se vuelve a pedir para la seleccion nueva
    expect(Object.keys(r.disponibilidad)).toHaveLength(599);
    expect('14-0000' in r.disponibilidad).toBe(false);
  });
});

describe('un pedido nuevo no arrastra datos del anterior ni de un error inesperado', () => {
  test('al volver a pedir tras un cambio de seleccion, los pozos de un lote fallido NO conservan el Si / No viejo', async () => {
    let fallar = false;
    const { ctx } = montar({ responder: (lote, i) => (fallar && i === 4 ? { status: 'error', code: 'X' } : ok(disponibilidadDe(lote, true))) });
    seleccionar(ctx, ids(1200));
    const primero = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(primero.disponibilidad['14-0501']).toBe(true);
    ctx.seleccionController_quitarPozo('14-0000');                              // otra seleccion: se vuelve a pedir
    fallar = true;                                                              // ahora falla el 2do lote del nuevo pedido (llamada 4; las 3 primeras fueron del pedido anterior)
    const segundo = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(segundo.desconocidos).toEqual(ids(500, 501));                        // el lote 2 de la nueva seleccion (14-0501 a 14-1000)
    segundo.desconocidos.forEach((w) => { expect(w in segundo.disponibilidad).toBe(false); });
    expect(segundo.disponibilidad['14-0001']).toBe(true);
  });

  test('un error inesperado (la API tira una excepcion) deja TODO desconocido, nunca "No"', async () => {
    const { ctx } = montar();
    ctx.apiGetItfAvailability = () => { throw new Error('boom'); };
    seleccionar(ctx, ids(30));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(r.desconocidos).toEqual(ids(30));
    expect(r.disponibilidad).toEqual({});
  });
});

describe('permisos y sesion', () => {
  test.each([[{}], [{ perfil: false }], [{ perfil: 'SI' }], [{ perfil: 1 }], [{ perfil: {} }], [{ ubicacion: true }]])('perfil distinto del booleano true (%j) -> null y ninguna llamada', async (permisos) => {
    const { ctx, llamadas } = montar({ permisos });
    seleccionar(ctx, ids(10));
    expect(await ctx.seleccionController_asegurarDisponibilidadItf()).toBeNull();
    expect(llamadas).toHaveLength(0);
  });

  test('sesion vencida (UNAUTHORIZED) en varios lotes: se avisa UNA sola vez y los pozos quedan desconocidos', async () => {
    const { ctx, sesion } = montar({ responder: () => ({ status: 'error', code: 'UNAUTHORIZED' }) });
    seleccionar(ctx, ids(1200));
    const r = await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(r.desconocidos).toHaveLength(1200);
    expect(r.disponibilidad).toEqual({});
  });

  test('la seleccion en si nunca se toca por un fallo de disponibilidad', async () => {
    const { ctx } = montar({ responder: () => 'RED' });
    seleccionar(ctx, ids(700));
    await ctx.seleccionController_asegurarDisponibilidadItf();
    expect(Array.from(ctx.seleccionController_obtenerSeleccionSet())).toEqual(ids(700));
  });
});

describe('la tabla y la exportacion comparten el codigo de filtro/orden y de lotes (guardas de codigo)', () => {
  const src = leer('seleccion.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('seleccion.js filtra y ordena con seleccionLogic_filtrarYOrdenarFilas (sin su propio sort)', () => {
    expect(src).toContain('seleccionLogic_filtrarYOrdenarFilas(');
    expect(src).not.toMatch(/filas\.sort\(|filas\.filter\(/);
  });

  test('seleccion.js pide la disponibilidad por lotes (seleccionLogic_dividirEnLotes + combinar), no la seleccion entera de una vez', () => {
    expect(src).toContain('seleccionLogic_dividirEnLotes(estado.seleccion, SELECCION_ITF_LOTE_MAX)');
    expect(src).toContain('seleccionLogic_combinarDisponibilidadItf(');
    expect(src).not.toMatch(/apiGetItfAvailability\(contexto\.sessionToken, estado\.seleccion\)/);
  });
});
