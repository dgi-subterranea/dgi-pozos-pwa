// E7-2: la tabla de Mi seleccion (js/seleccion.js) ejecutada de verdad sobre un DOM falso: busqueda + filtro de aptitud + orden salen de seleccionLogic_filtrarYOrdenarFilas, la MISMA
// funcion que usa la exportacion. Estos tests fijan el orden y el filtrado que la tabla dibuja (los wellId que la exportacion tiene que llevar, en ese orden).
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

// pozos del dataset operativo (getMapaPozos) y del indice de busqueda (getIndiceBusquedaProvincia)
const POZOS = [
  { wellId: '01-0001', lat: -32.9, lon: -68.8, estado: 'V', cuenca: 'Mendoza Norte', profundidad: 120, surgencia: 'Profundo' },
  { wellId: '01-0002', lat: -32.9, lon: -68.8, estado: 'D', cuenca: 'Valle de Uco', profundidad: 300, surgencia: 'SemiSurgente' },
  { wellId: '14-0001', lat: -33.3, lon: -69.1, estado: 'D', cuenca: 'Valle de Uco', profundidad: 45, surgencia: 'Natural' },
  { wellId: '14-0002', lat: -33.3, lon: -69.1, estado: 'C', cuenca: 'Mendoza Norte', profundidad: null, surgencia: null },
  { wellId: '03-0001', lat: -32.8, lon: -68.9, estado: 'D', cuenca: 'Mendoza Norte', profundidad: 80, surgencia: 'Profundo' }
];
const BUSQUEDA = [
  { wellId: '01-0001', titular: 'ZAPATA', nc16: '0100000000000001' },
  { wellId: '14-0002', titular: 'VALLEJO', nc16: '0100000000000002' }
];
const RESUMEN = { '01-0001': 'APTO', '01-0002': 'APTO', '14-0001': 'NO_APTO' };

function montar(permisos) {
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
  ctx.busquedaProvinciaDataset_obtener = () => Promise.resolve({ status: 'ok', data: { pozos: BUSQUEDA } });
  ctx.mapaNEDataset_obtener = () => Promise.resolve({ status: 'ok', data: { puntos: [{ wellId: '01-0002' }] } });
  ctx.apiGetItfAvailability = () => Promise.resolve({ status: 'ok', data: {} });
  const resumen = permisos.reemplazo ? RESUMEN : null;
  ctx.reemplazoEstadosController_cargar = () => Promise.resolve();
  ctx.reemplazoEstadosController_resumen = () => resumen;
  ctx.reemplazoEstadosController_estadoDe = (w) => (resumen ? (resumen[w] || 'SIN_EVALUAR') : null);
  ctx.reemplazoEstadosUI_pintarFiltro = jest.fn();
  ctx.reemplazoLogic_claseEstado = (e) => String(e).toLowerCase();
  fuentes.forEach((f) => vm.runInContext(f, ctx));
  ctx.seleccionController_inicializar(() => ({ sessionToken: 't', permisos, onSessionExpired: () => {}, onAbrirPozo: () => {} }));
  ctx.seleccionController_proponerSeleccion(POZOS.map((p) => p.wellId), 'radio', { lat: 0, lon: 0, radioMetros: 1 });
  return {
    ctx,
    // la busqueda se limpia al abrir la tabla con una seleccion nueva (comportamiento real): se abre una vez y despues se busca
    async buscar(texto) { await this.abrir(); ctx.document.getElementById('seleccion-tabla-buscar').value = texto; },
    ordenar: (orden) => { ctx.document.getElementById('seleccion-tabla-orden').value = orden; },
    async abrir() {
      creados = [];
      ctx.seleccionController_abrirTabla();
      await flush();
      return creados.filter((n) => n.className === 'seleccion-card-id mono').map((n) => n.textContent);
    }
  };
}

describe('la tabla de Mi seleccion dibuja lo que la exportacion va a llevar', () => {
  test('sin busqueda ni filtro: toda la seleccion, ordenada por wellId (el orden por defecto)', async () => {
    const t = montar({ datos: true, ubicacion: true, perfil: false, ne: true, reemplazo: true });
    expect(await t.abrir()).toEqual(['01-0001', '01-0002', '03-0001', '14-0001', '14-0002']);
  });

  test('orden por profundidad: mayor a menor, los sin dato al final', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    t.ordenar('profundidad');
    expect(await t.abrir()).toEqual(['01-0002', '01-0001', '03-0001', '14-0001', '14-0002']);
  });

  test('orden por cuenca: alfabetico, con desempate por wellId', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    t.ordenar('cuenca');
    expect(await t.abrir()).toEqual(['01-0001', '03-0001', '14-0002', '01-0002', '14-0001']);
  });

  test('orden por departamento: alfabetico por nombre (Capital, Las Heras, ...) y luego wellId', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    t.ordenar('departamento');
    const nombre = (w) => t.ctx.mapaLogic_nombreDepartamento(w.substring(0, 2));
    const esperado = ['01-0001', '01-0002', '03-0001', '14-0001', '14-0002'].sort((a, b) => nombre(a).localeCompare(nombre(b)) || a.localeCompare(b));
    expect(await t.abrir()).toEqual(esperado);
  });

  test('la busqueda filtra la tabla (cuenca): solo esos pozos se dibujan', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    await t.buscar('valle de uco');
    expect(await t.abrir()).toEqual(['01-0002', '14-0001']);
  });

  test('la busqueda tambien mira el titular cuando hay permiso de datos (aunque el titular no se exporte)', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    await t.buscar('zapata');
    expect(await t.abrir()).toEqual(['01-0001']);
  });

  test('sin permiso de datos el titular no participa de la busqueda', async () => {
    const t = montar({ ubicacion: true, ne: true, reemplazo: true });
    await t.buscar('zapata');
    expect(await t.abrir()).toEqual([]);
  });

  test('busqueda + orden combinados', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    await t.buscar('mendoza norte');
    t.ordenar('profundidad');
    expect(await t.abrir()).toEqual(['01-0001', '03-0001', '14-0002']);
  });

  test('el filtro de aptitud (chips) se combina con la busqueda y el orden', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true, reemplazo: true });
    // el controlador recibe los chips a traves de reemplazoEstadosUI_pintarFiltro (se simula el click de "Apto")
    await t.abrir();
    const alCambiar = t.ctx.reemplazoEstadosUI_pintarFiltro.mock.calls[0][3];
    alCambiar({ APTO: true });
    await t.buscar('valle');
    t.ordenar('profundidad');
    expect(await t.abrir()).toEqual(['01-0002']);
  });

  test('sin permiso de reemplazo no hay filtro de aptitud: se dibujan todos los pozos', async () => {
    const t = montar({ datos: true, ubicacion: true, ne: true });
    expect(await t.abrir()).toHaveLength(5);
  });
});
