// E9-6 (Q1 y desconocido): la tabla de Mi seleccion (js/seleccion.js) ejecutada de verdad sobre un DOM falso. La tabla se DIBUJA sin esperar la disponibilidad de ITF (la columna dice "Verificando…") y se
// repinta cuando llega; "Tiene ITF" es Si / No SOLO si el servidor lo afirmo: un pozo que no se pudo saber (lote caido, o pozo omitido por el servidor) queda sin dato ("—"), JAMAS "No". Tambien guarda el
// nombre del archivo del ZIP segun el tipo real del ITF y que el ZIP use solo getProfile (el vigente institucional).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const fuentes = ['mapaLogic.js', 'reemplazoResumenLogic.js', 'seleccionLogic.js', 'seleccion.js'].map(leer);
const flush = async () => { for (let i = 0; i < 20; i += 1) { await new Promise((r) => setImmediate(r)); } };

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

const POZOS = ['14-0001', '14-0002', '14-0003'].map((wellId) => ({ wellId: wellId, lat: -33.3, lon: -69.1, estado: 'D', cuenca: 'Valle de Uco', profundidad: 45, surgencia: 'Natural' }));
const diferida = () => { let resolver; const promesa = new Promise((r) => { resolver = r; }); return { promesa, resolver }; };

function montar(opc) {
  const o = opc || {};
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, Set, Map, isFinite, setTimeout, Proxy, Symbol });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.requestAnimationFrame = (fn) => setImmediate(fn);
  ctx.getComputedStyle = () => ({});
  const porId = {};
  let creados = [];
  ctx.document = {
    body: nodo(), documentElement: nodo(), querySelector: () => nodo(), querySelectorAll: () => [],
    getElementById: (id) => { if (!porId[id]) { porId[id] = nodo(); } return porId[id]; },
    createElement: () => { const n = nodo(); creados.push(n); return n; }
  };
  ctx.mapaDataset_obtener = () => Promise.resolve({ status: 'ok', data: { pozos: POZOS } });
  ctx.busquedaProvinciaDataset_obtener = () => Promise.resolve({ status: 'ok', data: { pozos: [] } });
  ctx.mapaNEDataset_obtener = () => Promise.resolve({ status: 'ok', data: { puntos: [] } });
  ctx.reemplazoEstadosController_cargar = () => Promise.resolve();
  ctx.reemplazoEstadosController_resumen = () => null;
  ctx.reemplazoEstadosController_estadoDe = () => null;
  ctx.reemplazoEstadosUI_pintarFiltro = jest.fn();
  ctx.reemplazoLogic_claseEstado = (e) => String(e).toLowerCase();
  ctx.apiGetItfAvailability = jest.fn(o.disponibilidad || (() => Promise.resolve({ status: 'ok', data: { '14-0001': true, '14-0002': false, '14-0003': true } })));
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok', permisos: o.permisos || { perfil: true, datos: false, ubicacion: true, ne: false }, onSessionExpired: jest.fn(), onAbrirPozo: () => {} };
  ctx.seleccionController_inicializar(() => sesion);
  ctx.seleccionController_proponerSeleccion(POZOS.map((p) => p.wellId), 'radio', { lat: 0, lon: 0, radioMetros: 1 });
  return {
    ctx,
    sesion,
    // la columna "Tiene ITF" y el boton de ITF de cada tarjeta dibujada, en orden
    async abrir() {
      creados = [];
      ctx.seleccionController_abrirTabla();
      await flush();
      return this.leer();
    },
    leer() {
      const valores = [];
      creados.forEach((n, i) => { if (n.textContent === 'Tiene ITF') { valores.push(creados[i + 1].textContent); } });
      const botones = creados.filter((n) => n.className === 'button-secondary' && ['Ver ITF', 'Sin ITF', 'Verificando…'].indexOf(n.textContent) >= 0).map((n) => ({ texto: n.textContent, disabled: n.disabled === true }));
      // lo que queda EN PANTALLA es el ultimo dibujo (la tabla se repinta al llegar la disponibilidad): las 3 ultimas tarjetas
      const ultimas = (lista) => lista.slice(-POZOS.length);
      return { valores: ultimas(valores), botones: ultimas(botones), tarjetas: Math.min(POZOS.length, creados.filter((n) => n.className === 'seleccion-card-id mono').length) };
    },
    reiniciarRegistro() { creados = []; }
  };
}

describe('Q1: la tabla se dibuja SIN esperar la disponibilidad de ITF', () => {
  test('mientras la disponibilidad esta en vuelo: tarjetas ya dibujadas, "Verificando…" en cada fila y boton deshabilitado; al llegar se repinta con Si / No', async () => {
    const d = diferida();
    const t = montar({ disponibilidad: () => d.promesa });
    const antes = await t.abrir();
    expect(t.ctx.apiGetItfAvailability).toHaveBeenCalledTimes(1);          // la consulta YA salio...
    expect(antes.tarjetas).toBe(3);                                         // ...y la tabla ya esta en pantalla (no esperó)
    expect(antes.valores).toEqual(['Verificando…', 'Verificando…', 'Verificando…']);
    expect(antes.botones.every((b) => b.texto === 'Verificando…' && b.disabled)).toBe(true);
    t.reiniciarRegistro();
    d.resolver({ status: 'ok', data: { '14-0001': true, '14-0002': false, '14-0003': true } });
    await flush();
    const despues = t.leer();
    expect(despues.valores).toEqual(['Sí', 'No', 'Sí']);
    expect(despues.botones).toEqual([{ texto: 'Ver ITF', disabled: false }, { texto: 'Sin ITF', disabled: true }, { texto: 'Ver ITF', disabled: false }]);
  });

  test('el orden de los eventos: primero se dibuja la tabla, despues llega la disponibilidad (nunca al reves)', async () => {
    const d = diferida();
    const eventos = [];
    const t = montar({ disponibilidad: () => { eventos.push('disponibilidad pedida'); return d.promesa.then((r) => { eventos.push('disponibilidad llego'); return r; }); } });
    t.ctx.document.createElement = ((original) => () => { const n = original(); if (eventos.indexOf('tabla dibujada') < 0) { eventos.push('tabla dibujada'); } return n; })(t.ctx.document.createElement);
    t.ctx.seleccionController_abrirTabla();
    await flush();
    expect(eventos.slice(0, 2)).toEqual(expect.arrayContaining(['tabla dibujada']));
    expect(eventos.indexOf('tabla dibujada')).toBeLessThan(eventos.indexOf('disponibilidad llego') === -1 ? Infinity : eventos.indexOf('disponibilidad llego'));
    d.resolver({ status: 'ok', data: {} });
    await flush();
    expect(eventos.indexOf('tabla dibujada')).toBeLessThan(eventos.indexOf('disponibilidad llego'));
  });

  test('con la disponibilidad ya conocida (misma seleccion) la tabla se abre sin "Verificando…" y SIN volver a pedir', async () => {
    const t = montar();
    await t.abrir();
    const r = await t.abrir();
    expect(r.valores).toEqual(['Sí', 'No', 'Sí']);
    expect(t.ctx.apiGetItfAvailability).toHaveBeenCalledTimes(1);
  });

  test('un cambio de vigente (se aprobo / retiro / restauro un ITF) descarta lo cacheado: la proxima apertura vuelve a verificar', async () => {
    const t = montar();
    await t.abrir();
    t.ctx.seleccionController_invalidarDisponibilidadItf();
    await t.abrir();
    expect(t.ctx.apiGetItfAvailability).toHaveBeenCalledTimes(2);
  });

  test('sin perfil === true no se consulta nada y la columna queda sin dato', async () => {
    const t = montar({ permisos: { perfil: false, ubicacion: true } });
    const r = await t.abrir();
    expect(t.ctx.apiGetItfAvailability).not.toHaveBeenCalled();
    expect(r.valores).toEqual(['—', '—', '—']);
  });
});

describe('desconocido: nunca "No"', () => {
  test('un pozo que el servidor OMITE (no se puede afirmar) queda "—" y conserva su boton "Ver ITF" (getProfile es la autoridad); los demas conservan Si / No', async () => {
    const t = montar({ disponibilidad: () => Promise.resolve({ status: 'ok', data: { '14-0001': true, '14-0003': false } }) });
    const r = await t.abrir();
    expect(r.valores).toEqual(['Sí', '—', 'No']);
    expect(r.botones.map((b) => b.texto)).toEqual(['Ver ITF', 'Ver ITF', 'Sin ITF']);
    expect(r.botones[1].disabled).toBe(false);
  });

  test('si TODA la consulta falla (servicio caido / red): ninguna fila dice "No"', async () => {
    for (const falla of [() => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }), () => Promise.reject(new Error('red'))]) {
      const t = montar({ disponibilidad: falla });
      const r = await t.abrir();
      expect(r.valores).toEqual(['—', '—', '—']);
      expect(r.valores).not.toContain('No');
    }
  });

  test('un valor que no es booleano (null, "false", 0) tampoco se toma como "No"', async () => {
    const t = montar({ disponibilidad: () => Promise.resolve({ status: 'ok', data: { '14-0001': null, '14-0002': 'false', '14-0003': 0 } }) });
    const r = await t.abrir();
    expect(r.valores).toEqual(['—', '—', '—']);
  });

  test('un fallo reintenta en la proxima apertura (no se da la disponibilidad por conocida)', async () => {
    const disponibilidad = jest.fn().mockResolvedValueOnce({ status: 'error', code: 'SERVICE_UNAVAILABLE' }).mockResolvedValueOnce({ status: 'ok', data: { '14-0001': true, '14-0002': true, '14-0003': true } });
    const t = montar({ disponibilidad });
    await t.abrir();
    const r = await t.abrir();
    expect(r.valores).toEqual(['Sí', 'Sí', 'Sí']);
  });
});

describe('descarga del visor y de "Descargar" individual: tambien por el tipo real', () => {
  test('ninguna descarga de seleccion fija .jpg: todas siguen el mimeType', () => {
    expect(leer('seleccion.js')).not.toMatch(/\.download = wellId \+ '\.jpg'/);
    expect((leer('seleccion.js').match(/\.download = wellId \+ \(result\.data\.mimeType === 'image\/png' \? '\.png' : '\.jpg'\)/g) || []).length).toBe(2);
  });
});

describe('ZIP y descarga: solo el vigente institucional, con el nombre del tipo real', () => {
  const fuente = leer('seleccion.js');
  test('el ZIP y la descarga individual piden el ITF SOLO con getProfile (el vigente institucional): jamas el endpoint de moderacion ni una propuesta', () => {
    expect(fuente).toMatch(/apiGetProfile\(contexto\.sessionToken, wellId\)/);
    expect(fuente).not.toMatch(/apiGetItfDocumentoModeracion|apiGetItfPendientes|apiGetMisPropuestasItf|apiGetHistorialItf/);
  });
  test('el nombre dentro del ZIP sigue el mimeType real (un PNG vigente es .png, no .jpg)', () => {
    expect(fuente).toMatch(/zip\.file\(wellId \+ \(result\.data\.mimeType === 'image\/png' \? '\.png' : '\.jpg'\), result\.data\.imageBase64, \{ base64: true \}\)/);
  });
});
