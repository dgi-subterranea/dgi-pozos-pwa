// Controlador del boton "Exportar Excel (N)" (js/exportacionSeleccion.js) ejecutado de verdad junto con el controlador REAL de Mi seleccion (js/seleccion.js), la logica de exportacion y el
// escritor XLSX, sobre un DOM falso. Se simulan solo: la red (apiGetItfAvailability y los datasets), la carga de JSZip, Blob / URL y los temporizadores.
// El XLSX descargado se vuelve a abrir con JSZip para mirar su contenido real.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const JSZip = require('../vendor/jszip/jszip.min.js');

const leer = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
const FUENTES = ['mapaLogic.js', 'reemplazoResumenLogic.js', 'seleccionLogic.js', 'xlsxLogic.js', 'exportacionSeleccionLogic.js', 'seleccion.js', 'exportacionSeleccion.js'].map(leer);
const flush = async () => { for (let i = 0; i < 40; i += 1) { await new Promise((r) => setImmediate(r)); } };

// ---------- DOM falso ----------
function permisivo() {
  const guardado = {};
  const f = function () { return permisivo(); };
  return new Proxy(f, {
    get(t, k) {
      if (Object.prototype.hasOwnProperty.call(guardado, k)) { return guardado[k]; }
      if (k === Symbol.toPrimitive) { return () => ''; }
      if (k === 'then' || typeof k === 'symbol') { return undefined; }
      if (k === 'value') { return ''; }
      return permisivo();
    },
    set(t, k, v) { guardado[k] = v; return true; },
    apply() { return permisivo(); }
  });
}

class NodoBase {
  constructor(id) {
    this.id = id; this.textContent = ''; this.disabled = false; this.hidden = false; this.className = ''; this.value = '';
    this.attrs = {}; this.listeners = {}; this.children = []; this.style = permisivo(); this.classList = permisivo();
  }
  addEventListener(tipo, fn) { this.listeners[tipo] = fn; }
  click() { if (!this.disabled && this.listeners.click) { this.listeners.click({}); } }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  appendChild(c) { this.children.push(c); return c; }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; }
  focus() {}
}
function nodo(id) {
  return new Proxy(new NodoBase(id), {
    get(t, k) {
      if (k in t) { const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; }
      if (k === 'then' || typeof k === 'symbol') { return undefined; }
      return permisivo();
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

// ---------- datos ----------
const marcas = { titular: 'TITULAR-SECRETO-ZZ', nc16: '0199999999999999', email: 'secreto@dominio.test', agente: 'AGENTE-SECRETO', token: 'tok-secreto' };
function pozosDe(n) {
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const w = '14-' + String(i).padStart(4, '0');
    out.push({
      wellId: w, lat: -33 - i / 10000, lon: -69 - i / 10000, estado: i % 2 ? 'D' : 'V', cuenca: i % 2 ? 'Valle de Uco' : 'Mendoza Norte', profundidad: 10 + i, surgencia: 'Profundo',
      titular: marcas.titular, nc16: marcas.nc16, email: marcas.email, nombreAgente: marcas.agente, sessionToken: marcas.token
    });
  }
  return out;
}

function montar(opc) {
  const o = Object.assign({ n: 6, permisos: { datos: true, ubicacion: true, perfil: true, ne: true, reemplazo: true }, jszip: 'ok', blob: 'ok' }, opc || {});
  const reloj = { ahora: Date.now() };
  class FechaControlada extends Date {
    constructor(...a) { if (a.length === 0) { super(reloj.ahora); } else { super(...a); } }
    static now() { return reloj.ahora; }
  }
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date: FechaControlada, Object, Array, String, Number, Set, Map, isFinite, Intl, Proxy, Symbol, Uint8Array, Error });
  ctx.window = ctx;
  ctx.addEventListener = () => {};
  ctx.requestAnimationFrame = (fn) => setImmediate(fn);
  ctx.getComputedStyle = () => ({});
  const porId = {};
  const anclas = [];
  ctx.document = {
    body: nodo('body'), documentElement: nodo('html'), querySelector: () => permisivo(), querySelectorAll: () => [],
    getElementById: (id) => { if (!porId[id]) { porId[id] = nodo(id); } return porId[id]; },
    createElement: (tag) => { const n = nodo(tag); if (tag === 'a') { n.click = () => { anclas.push({ href: n.href, download: n.download }); }; } return n; }
  };
  // temporizadores controlables
  const timers = [];
  ctx.setTimeout = (fn, ms) => { timers.push({ fn, ms, hecho: false }); return timers.length; };
  ctx.clearTimeout = (id) => { if (timers[id - 1]) { timers[id - 1].hecho = true; } };
  // URL / Blob
  const urls = { creadas: [], revocadas: [] };
  ctx.URL = { createObjectURL: (blob) => { urls.creadas.push(blob); return 'blob:fake-' + urls.creadas.length; }, revokeObjectURL: (u) => { urls.revocadas.push(u); } };
  ctx.Blob = o.blob === 'falla' ? function () { throw new Error('blob roto'); } : Blob;
  // red
  const pozos = pozosDe(o.n);
  const t = { fase: 'tabla', itf: [], jszip: 0, retener: null, datasets: 0 };
  ctx.mapaDataset_obtener = () => { t.datasets += 1; return Promise.resolve({ status: 'ok', data: { pozos } }); };
  ctx.busquedaProvinciaDataset_obtener = () => Promise.resolve({ status: 'ok', data: { pozos: pozos.map((p) => ({ wellId: p.wellId, titular: marcas.titular, nc16: marcas.nc16 })) } });
  ctx.mapaNEDataset_obtener = () => (o.neFalla ? Promise.resolve({ status: 'error', code: 'X' }) : Promise.resolve({ status: 'ok', data: { puntos: [{ wellId: '14-0002' }] } }));
  ctx.apiGetItfAvailability = (token, lote) => {
    t.itf.push({ fase: t.fase, lote: lote.slice() });
    const idx = t.itf.length - 1;
    const resp = o.itf ? o.itf(lote, idx, t.fase) : { status: 'ok', data: Object.fromEntries(lote.map((w) => [w, Number(w.slice(3)) % 2 === 0])) };
    return (t.retener ? t.retener : Promise.resolve()).then(() => new Promise((resolver, rechazar) => { setImmediate(() => { if (resp === 'RED') { rechazar(new Error('red')); } else { resolver(resp); } }); }));
  };
  const resumen = o.permisos.reemplazo ? Object.fromEntries(pozos.slice(0, 3).map((p, i) => [p.wellId, ['APTO', 'DUDOSO', 'NO_APTO'][i]])) : null;
  ctx.reemplazoEstadosController_cargar = () => Promise.resolve();
  ctx.reemplazoEstadosController_resumen = () => resumen;
  ctx.reemplazoEstadosController_estadoDe = (w) => (resumen ? (resumen[w] || 'SIN_EVALUAR') : null);
  ctx.reemplazoEstadosUI_pintarFiltro = jest.fn();
  ctx.reemplazoLogic_claseEstado = (e) => String(e).toLowerCase();
  ctx.mapaDataset_periodoDelBase = () => '2026-05';
  ctx.mapaShared_cargarJSZip = () => {
    t.jszip += 1;
    const espera = t.retener || Promise.resolve();
    if (o.jszip === 'falla') { return espera.then(() => Promise.reject(new Error('sin red'))); }
    return espera.then(() => { ctx.JSZip = JSZip; });
  };
  FUENTES.forEach((f) => vm.runInContext(f, ctx));
  const sesion = { sessionToken: 'tok-real', permisos: o.permisos, onSessionExpired: jest.fn(), onAbrirPozo: () => {} };
  ctx.seleccionController_inicializar(() => sesion);
  ctx.seleccionController_proponerSeleccion(pozos.map((p) => p.wellId), 'radio', { lat: 0, lon: 0, radioMetros: 1 });
  const el = (id) => ctx.document.getElementById(id);
  const api = {
    ctx, sesion, t, timers, urls, anclas, pozos, el, reloj,
    boton: el('btn-seleccion-exportar'),
    msgEstado: el('seleccion-exportar-estado'),
    msgError: el('seleccion-exportar-error'),
    async abrir() { t.fase = 'tabla'; ctx.seleccionController_abrirTabla(); await flush(); t.fase = 'export'; },
    async buscar(texto) { el('seleccion-tabla-buscar').value = texto; el('seleccion-tabla-buscar').listeners.input(); await flush(); },
    async ordenar(orden) { el('seleccion-tabla-orden').value = orden; el('seleccion-tabla-orden').listeners.change(); await flush(); },
    async aptitud(activos) {
      const llamadas = ctx.reemplazoEstadosUI_pintarFiltro.mock.calls;
      llamadas[llamadas.length - 1][3](activos);
      await flush();
    },
    clic() { api.boton.click(); },
    clicDirecto() { api.boton.listeners.click({}); },
    async libroDescargado() {
      const blob = urls.creadas[urls.creadas.length - 1];
      const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
      const leerParte = async (r) => zip.file(r).async('string');
      const hoja = await leerParte('xl/worksheets/sheet1.xml');
      const info = await leerParte('xl/worksheets/sheet2.xml');
      const textos = (xml) => Array.from(xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)).map((m) => m[1]);
      const filas = Array.from(hoja.matchAll(/<row r="(\d+)">([\s\S]*?)<\/row>/g)).map((m) => Array.from(m[2].matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:t="inlineStr")?[^>]*>(?:<is><t xml:space="preserve">([^<]*)<\/t><\/is>|<v>([^<]*)<\/v>)<\/c>/g)).map((c) => ({ col: c[1], v: c[2] !== undefined ? c[2] : Number(c[3]) })));
      return { blob, hoja, info, encabezado: textos(hoja.slice(0, hoja.indexOf('</row>'))), filas, pozos: filas.slice(1).map((f) => f[0].v), todo: [hoja, info] };
    },
    // espera a que la exportacion termine (el boton deja de decir "Preparando Excel…"); la generacion de libros grandes tarda mas ticks que un flush
    async terminar() {
      await flush();
      const limite = Date.now() + 15000;
      while (api.boton.textContent === 'Preparando Excel…' && Date.now() < limite) { await new Promise((r) => setImmediate(r)); }
      await flush();
    },
    textoBoton: () => api.boton.textContent
  };
  return api;
}

const ids = (n, desde) => Array.from({ length: n }, (_, i) => '14-' + String((desde || 1) + i).padStart(4, '0'));

describe('boton "Exportar Excel (N)": contador y estado', () => {
  test('antes de abrir la tabla: N=0, deshabilitado', () => {
    const t = montar();
    expect(t.textoBoton()).toBe('Exportar Excel (0)');
    expect(t.boton.disabled).toBe(true);
    expect(t.boton.getAttribute('aria-busy')).toBe('false');
  });

  test.each([[1], [6], [25]])('%i pozos visibles -> "Exportar Excel (%i)" habilitado', async (n) => {
    const t = montar({ n });
    await t.abrir();
    expect(t.textoBoton()).toBe('Exportar Excel (' + n + ')');
    expect(t.boton.disabled).toBe(false);
  });

  test('una busqueda sin resultados deja N=0 y el boton deshabilitado; al borrarla vuelve', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.buscar('no existe nada asi');
    expect(t.textoBoton()).toBe('Exportar Excel (0)');
    expect(t.boton.disabled).toBe(true);
    await t.buscar('');
    expect(t.textoBoton()).toBe('Exportar Excel (6)');
    expect(t.boton.disabled).toBe(false);
  });

  test('la busqueda reduce N (cuenca "valle": la mitad); NO es la cantidad de la seleccion', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.buscar('valle de uco');
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
  });

  test('la busqueda por titular tambien cuenta (igual que la tabla) aunque el titular no se exporte', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.buscar('titular-secreto');
    expect(t.textoBoton()).toBe('Exportar Excel (6)');
  });

  test('el filtro de aptitud reduce N y se combina con la busqueda', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.aptitud({ APTO: true });
    expect(t.textoBoton()).toBe('Exportar Excel (1)');
    await t.aptitud({ APTO: true, DUDOSO: true, NO_APTO: true });
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    await t.buscar('mendoza norte');
    expect(t.textoBoton()).toBe('Exportar Excel (1)');                       // solo el DUDOSO de cuenca "Mendoza Norte"
  });

  test('cambiar el orden NO cambia N', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    for (const o of ['profundidad', 'cuenca', 'departamento', 'wellId']) {
      await t.ordenar(o);
      expect(t.textoBoton()).toBe('Exportar Excel (6)');
    }
  });

  test('quitar un pozo de la seleccion actualiza N al volver a dibujar la tabla', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    t.ctx.seleccionController_quitarPozo('14-0001');
    await t.abrir();
    expect(t.textoBoton()).toBe('Exportar Excel (5)');
  });

  test('contar NO hace ningun pedido: ni ITF extra, ni JSZip, ni datasets nuevos al buscar / filtrar / ordenar', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    const antes = { itf: t.t.itf.length, jszip: t.t.jszip, datasets: t.t.datasets };
    await t.buscar('valle');
    await t.ordenar('profundidad');
    await t.aptitud({ APTO: true });
    await t.buscar('');
    expect(t.t.itf.length).toBe(antes.itf);
    expect(t.t.jszip).toBe(antes.jszip);
    expect(t.t.datasets).toBe(antes.datasets);
  });

  test('JSZip NO se carga al entrar a Mi seleccion: solo al exportar', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    expect(t.t.jszip).toBe(0);
    t.clic();
    await t.terminar();
    expect(t.t.jszip).toBe(1);
  });

  test('mientras la tabla recarga (datasets pendientes) el boton queda en 0 y deshabilitado; al dibujarse vuelve a N', async () => {
    const t = montar({ n: 4 });
    await t.abrir();
    expect(t.textoBoton()).toBe('Exportar Excel (4)');
    let liberar;
    t.ctx.mapaDataset_obtener = () => new Promise((r) => { liberar = () => r({ status: 'ok', data: { pozos: t.pozos } }); });
    t.ctx.seleccionController_abrirTabla();
    await flush();
    expect(t.textoBoton()).toBe('Exportar Excel (0)');
    expect(t.boton.disabled).toBe(true);
    liberar();
    await flush();
    expect(t.textoBoton()).toBe('Exportar Excel (4)');
    expect(t.boton.disabled).toBe(false);
  });

  test('una tabla que no pudo cargar deja el boton en 0 y deshabilitado', async () => {
    const t = montar({ n: 3 });
    t.ctx.mapaDataset_obtener = () => Promise.reject(new Error('x'));
    await t.abrir();
    expect(t.textoBoton()).toBe('Exportar Excel (0)');
    expect(t.boton.disabled).toBe(true);
  });
});

describe('flujo de exportacion: descarga', () => {
  test('descarga un XLSX con el nombre del dia (Mendoza), el MIME correcto y los pozos visibles en el orden de la tabla', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.ordenar('profundidad');
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
    expect(t.anclas[0].download).toMatch(/^dgi-pozos-seleccion-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(t.anclas[0].href).toBe('blob:fake-1');
    const blob = t.urls.creadas[0];
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(blob.size).toBeGreaterThan(1000);
    const libro = await t.libroDescargado();
    expect(libro.pozos).toEqual(['14-0006', '14-0005', '14-0004', '14-0003', '14-0002', '14-0001']);     // profundidad descendente
  });

  test('la URL del objeto NO se revoca al instante: solo cuando vence el margen largo', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.urls.revocadas).toEqual([]);
    const revocacion = t.timers.find((x) => x.ms >= 30000);
    expect(revocacion).toBeDefined();
    expect(revocacion.ms).toBeGreaterThanOrEqual(30000);
    revocacion.fn();
    expect(t.urls.revocadas).toEqual(['blob:fake-1']);
  });

  test('exporta solo lo visible: con busqueda "valle" salen 3 pozos y la hoja Informacion lo declara', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.buscar('valle');
    t.clic();
    await t.terminar();
    const libro = await t.libroDescargado();
    expect(libro.pozos).toEqual(['14-0001', '14-0003', '14-0005']);
    const info = libro.info;
    expect(info).toContain('>Búsqueda aplicada<');
    expect(info).toContain('>valle<');
    expect(info).toContain('Pozos en la selección (sin filtrar)');
  });

  test('el filtro de aptitud activo sale en la hoja Informacion', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.aptitud({ APTO: true });
    t.clic();
    await t.terminar();
    const libro = await t.libroDescargado();
    expect(libro.pozos).toEqual(['14-0001']);
    expect(libro.info).toContain('>Filtro de aptitud<');
    expect(libro.info).toContain('>Apto<');
  });

  test('con todos los permisos el libro tiene las 11 columnas; las coordenadas son numeros, no texto', async () => {
    const t = montar({ n: 2 });
    await t.abrir();
    t.clic();
    await t.terminar();
    const libro = await t.libroDescargado();
    expect(libro.encabezado).toEqual(['Pozo', 'Departamento', 'Cuenca', 'Profundidad (m)', 'Tipo de pozo', 'Estado de ubicación', 'Latitud', 'Longitud', 'Tiene ITF', 'Tiene NE', 'Aptitud para reemplazo']);
    expect(libro.hoja).toMatch(/<c r="G2" s="2"><v>-33.0001<\/v><\/c>/);
    expect(libro.hoja).not.toMatch(/<f[ >]/);
    const col = (c) => libro.filas.slice(1).map((f) => (f.find((x) => x.col === c) || {}).v);
    expect(col('K')).toEqual(['Apto', 'Dudoso']);                                // aptitud para reemplazo (resumen de la tabla)
    expect(col('F')).toEqual(['Disponible', 'Validada en campo']);
    expect(col('E')).toEqual(['Profundo', 'Profundo']);
  });

  test('el enlace temporal de descarga se quita del DOM despues del clic', async () => {
    const t = montar({ n: 2 });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
    expect(t.ctx.document.body.children).toHaveLength(0);
  });

  test('la fecha del archivo y de la hoja Informacion es la del CLIC, no la de cuando termina la preparacion', async () => {
    const t = montar({ n: 2 });
    t.reloj.ahora = Date.parse('2026-10-26T02:30:00Z');                         // 23:30 del 25 en Mendoza
    await t.abrir();
    t.t.retener = new Promise((r) => { t.liberar = r; });
    t.clic();
    await flush();
    t.reloj.ahora = Date.parse('2026-10-27T15:00:00Z');                         // pasa un dia mientras se prepara
    t.t.retener = null;
    t.liberar();
    await t.terminar();
    expect(t.anclas[0].download).toBe('dgi-pozos-seleccion-2026-10-25.xlsx');
    expect((await t.libroDescargado()).info).toContain('>2026-10-26T02:30:00Z<');
  });

  test('NE: con el dataset cargado Si / No; si no se pudo cargar la columna queda vacia (no "No")', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.clic();
    await t.terminar();
    let libro = await t.libroDescargado();
    const col = (l, c) => l.filas.slice(1).map((f) => (f.find((x) => x.col === c) || {}).v);
    expect(col(libro, 'J')).toEqual(['No', 'Sí', 'No']);
    const t2 = montar({ n: 3, neFalla: true });
    await t2.abrir();
    t2.clic();
    await t2.terminar();
    libro = await t2.libroDescargado();
    expect(col(libro, 'J')).toEqual([undefined, undefined, undefined]);
  });

  test('mensaje de exito "Excel descargado." (accesible: region de estado) que se borra solo; el boton vuelve a "Exportar Excel (N)"', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.msgEstado.hidden).toBe(false);
    expect(t.msgEstado.textContent).toBe('Excel descargado.');
    expect(t.msgError.hidden).toBe(true);
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    expect(t.boton.disabled).toBe(false);
    const temporizador = t.timers.find((x) => x.ms <= 10000 && !x.hecho);
    temporizador.fn();
    expect(t.msgEstado.hidden).toBe(true);
  });

  test('durante la preparacion: "Preparando Excel…", deshabilitado, aria-busy', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    let liberar;
    t.t.retener = new Promise((r) => { liberar = r; });
    t.clic();
    await flush();
    expect(t.textoBoton()).toBe('Preparando Excel…');
    expect(t.boton.disabled).toBe(true);
    expect(t.boton.getAttribute('aria-busy')).toBe('true');
    t.t.retener = null;
    liberar();
    await flush();
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    expect(t.boton.getAttribute('aria-busy')).toBe('false');
  });

  test('N=0: el clic no hace nada', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    await t.buscar('nada');
    t.clicDirecto();
    await flush();
    expect(t.anclas).toHaveLength(0);
    expect(t.t.jszip).toBe(0);
  });

  test('sin tabla cargada el clic no hace nada', async () => {
    const t = montar({ n: 3 });
    t.clicDirecto();
    await flush();
    expect(t.anclas).toHaveLength(0);
  });
});

describe('snapshot: el archivo es el del momento del clic', () => {
  test('si cambian busqueda, filtro, orden y seleccion mientras prepara, el archivo conserva las filas y el orden originales', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    await t.ordenar('profundidad');
    t.t.fase = 'export';
    t.t.retener = new Promise((r) => { t.liberar = r; });
    t.clic();
    await flush();
    expect(t.textoBoton()).toBe('Preparando Excel…');
    // el usuario sigue usando la tabla
    await t.buscar('valle');
    await t.ordenar('cuenca');
    t.ctx.seleccionController_quitarPozo('14-0006');
    t.t.retener = null;
    t.liberar();
    await flush();
    const libro = await t.libroDescargado();
    expect(libro.pozos).toEqual(['14-0006', '14-0005', '14-0004', '14-0003', '14-0002', '14-0001']);
    expect(libro.info).not.toContain('Búsqueda aplicada');
    expect(libro.info).toContain('>Profundidad (mayor a menor)<');
  });

  test('una exportacion siguiente usa el estado nuevo', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    t.clic();
    await t.terminar();
    await t.buscar('valle');
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(2);
    expect((await t.libroDescargado()).pozos).toEqual(['14-0001', '14-0003', '14-0005']);
  });

  test('el contador sigue la tabla durante la preparacion y se muestra al terminar', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    t.t.retener = new Promise((r) => { t.liberar = r; });
    t.clic();
    await flush();
    await t.buscar('valle');
    expect(t.textoBoton()).toBe('Preparando Excel…');
    t.t.retener = null;
    t.liberar();
    await flush();
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
  });

  test('la foto es de solo lectura: los filtros y listas que entrega son copias', async () => {
    const t = montar({ n: 4 });
    await t.abrir();
    await t.aptitud({ APTO: true });
    const foto = t.ctx.seleccionController_snapshotExportacion();
    expect(foto.wellIds).toEqual(['14-0001']);
    foto.wellIds.push('X');
    foto.filtros.aptitudActivos.DUDOSO = true;
    const otra = t.ctx.seleccionController_snapshotExportacion();
    expect(otra.wellIds).toEqual(['14-0001']);
    expect(otra.filtros.aptitudActivos).toEqual({ APTO: true });
  });
});

describe('doble clic y exportaciones simultaneas', () => {
  test('dos clics seguidos (aunque el boton no estuviera deshabilitado): UNA sola exportacion, UN solo JSZip, UNA sola descarga', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.clicDirecto();
    t.clicDirecto();
    t.clicDirecto();
    await flush();
    expect(t.t.jszip).toBe(1);
    expect(t.anclas).toHaveLength(1);
    expect(t.urls.creadas).toHaveLength(1);
  });

  test('el boton esta deshabilitado de verdad mientras prepara: el clic real no entra', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.t.retener = new Promise((r) => { t.liberar = r; });
    t.clic();
    await flush();
    t.clic();
    t.t.retener = null;
    t.liberar();
    await flush();
    expect(t.anclas).toHaveLength(1);
  });

  test('despues de terminar se puede exportar de nuevo', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.clic();
    await t.terminar();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(2);
  });
});

describe('ITF', () => {
  test('sin permiso perfil: NO se consulta ITF y el libro no tiene la columna', async () => {
    const t = montar({ n: 3, permisos: { ubicacion: true, ne: true, reemplazo: true } });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.t.itf).toHaveLength(0);
    const libro = await t.libroDescargado();
    expect(libro.encabezado).not.toContain('Tiene ITF');
    expect(libro.pozos).toHaveLength(3);
    expect(t.msgEstado.textContent).toBe('Excel descargado.');
  });

  test.each([['SI'], [1], [true && {}], ['true']])('perfil truthy que no es true (%p): no se consulta y no hay columna', async (perfil) => {
    const t = montar({ n: 2, permisos: { ubicacion: true, perfil } });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.t.itf.filter((x) => x.fase === 'export')).toHaveLength(0);          // (la tabla, por su cuenta, ya consultaba con perfil truthy: comportamiento previo)
    expect((await t.libroDescargado()).encabezado).not.toContain('Tiene ITF');
  });

  test('con perfil y la disponibilidad ya conocida por la tabla: se reutiliza (sin pedidos extra)', async () => {
    const t = montar({ n: 4 });
    await t.abrir();
    const antes = t.t.itf.length;
    t.clic();
    await t.terminar();
    expect(t.t.itf.length).toBe(antes);
    const libro = await t.libroDescargado();
    const col = libro.filas.slice(1).map((f) => (f.find((x) => x.col === 'I') || {}).v);
    expect(col).toEqual(['No', 'Sí', 'No', 'Sí']);
  });

  test('con perfil y sin disponibilidad previa: se piden SOLO los pozos visibles, en lotes de <= 500, con 3 en vuelo como maximo', async () => {
    // la tabla no logra la disponibilidad al abrir (todos los lotes fallan) -> la exportacion pide lo que necesita
    const t = montar({ n: 1100, itf: (lote, i, fase) => (fase === 'tabla' ? { status: 'error', code: 'SERVICE_UNAVAILABLE' } : { status: 'ok', data: Object.fromEntries(lote.map((w) => [w, true])) }) });
    await t.abrir();
    await t.buscar('valle');                                                  // 550 visibles de 1100
    expect(t.textoBoton()).toBe('Exportar Excel (550)');
    const antes = t.t.itf.length;
    t.clic();
    await t.terminar();
    const pedidos = t.t.itf.slice(antes);
    expect(pedidos.map((p) => p.lote.length)).toEqual([500, 50]);
    const pedidosIds = [].concat(...pedidos.map((p) => p.lote));
    expect(pedidosIds).toHaveLength(550);
    expect(pedidosIds.every((w) => Number(w.slice(3)) % 2 === 1)).toBe(true);   // solo cuenca "Valle de Uco": ningun pozo filtrado afuera
    expect(pedidos.every((p) => p.lote.length <= 500)).toBe(true);
    expect((await t.libroDescargado()).pozos).toHaveLength(550);
  }, 120000);

  test('si la seleccion cambio desde que la tabla supo el ITF, se vuelve a pedir (no se usan datos de otra seleccion)', async () => {
    let valor = false;
    const t = montar({ n: 4, itf: (lote) => ({ status: 'ok', data: Object.fromEntries(lote.map((w) => [w, valor])) }) });
    await t.abrir();                                                          // la tabla supo: todo "No"
    valor = true;                                                             // el ITF cambio en el backend
    t.ctx.seleccionController_quitarPozo('14-0004');                          // otra seleccion: el cache de la tabla deja de valer
    const antes = t.t.itf.length;
    t.clic();
    await t.terminar();
    expect(t.t.itf.length).toBeGreaterThan(antes);
    const libro = await t.libroDescargado();
    expect(libro.filas.slice(1).map((f) => (f.find((x) => x.col === 'I') || {}).v)).toEqual(['Sí', 'Sí', 'Sí']);          // 3 pozos: el quitado ya no esta en la seleccion
  });

  test('si la consulta explota por un error inesperado, lo que la tabla ya sabia se conserva y el resto queda vacio', async () => {
    const t = montar({ n: 4, itf: (lote) => ({ status: 'ok', data: Object.fromEntries(lote.map((w) => [w, true])) }) });
    await t.abrir();
    // la foto trae un pozo mas que la tabla no conocia (la tabla vigente cubre 14-0001..0004)
    const foto = await t.ctx.seleccionController_disponibilidadItfDe(['14-0001', '14-0002']);
    expect(foto.disponibilidad).toEqual({ '14-0001': true, '14-0002': true });
    t.ctx.apiGetItfAvailability = () => { throw new Error('boom'); };
    const mixto = await t.ctx.seleccionController_disponibilidadItfDe(['14-0001', '14-9999']);
    expect(mixto.disponibilidad).toEqual({ '14-0001': true });
    expect(mixto.desconocidos).toEqual(['14-9999']);
    expect(mixto.completo).toBe(false);
  });

  test('NO se consultan los pozos que el filtro dejo afuera', async () => {
    const t = montar({ n: 6, itf: (lote, i, fase) => (fase === 'tabla' ? { status: 'error', code: 'X' } : { status: 'ok', data: Object.fromEntries(lote.map((w) => [w, false])) }) });
    await t.abrir();
    await t.aptitud({ APTO: true });
    const antes = t.t.itf.length;
    t.clic();
    await t.terminar();
    expect([].concat(...t.t.itf.slice(antes).map((p) => p.lote))).toEqual(['14-0001']);
  });
});

describe('ITF parcial o caido: el archivo igual se genera, sin "No" falsos', () => {
  const colItf = (libro) => libro.filas.slice(1).map((f) => (f.find((x) => x.col === 'I') || {}).v);
  const AVISO = 'El archivo se exportó, pero no se pudo determinar la disponibilidad de ITF para algunos pozos.';

  test('un lote falla (de 2): se descarga; los pozos del lote caido quedan vacios; avisa; los otros conservan su Si / No', async () => {
    const t = montar({ n: 600, itf: (lote, i, fase) => (fase === 'tabla' || i % 2 === 0 ? { status: 'error', code: 'SERVICE_UNAVAILABLE' } : { status: 'ok', data: Object.fromEntries(lote.map((w) => [w, true])) }) });
    await t.abrir();
    const antes = t.t.itf.length;
    t.t.itf.length = 0;                                                       // el contador de indices del responder usa el largo: lote 1 falla, lote 2 responde
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
    const libro = await t.libroDescargado();
    const valores = colItf(libro);
    expect(valores).toHaveLength(600);
    expect(valores.slice(0, 500).every((v) => v === undefined)).toBe(true);   // lote 1 (500 pozos): desconocido -> vacio
    expect(valores.slice(500).every((v) => v === 'Sí')).toBe(true);           // lote 2 (100): respondio
    expect(valores).not.toContain('No');
    expect(t.msgEstado.textContent).toBe(AVISO);
    expect(t.msgError.hidden).toBe(true);
    expect(antes).toBeGreaterThan(0);
  }, 60000);

  test('fallan TODOS los lotes: igual se genera el XLSX, toda la columna Tiene ITF vacia (nunca "No") y el mismo aviso', async () => {
    const t = montar({ n: 4, itf: () => ({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle tecnico' }) });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
    const libro = await t.libroDescargado();
    expect(libro.encabezado).toContain('Tiene ITF');
    expect(colItf(libro)).toEqual([undefined, undefined, undefined, undefined]);
    expect(libro.pozos).toHaveLength(4);
    expect(t.msgEstado.textContent).toBe(AVISO);
  });

  test('un error de red (la promesa rechaza) tambien se tolera', async () => {
    const t = montar({ n: 3, itf: () => 'RED' });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
    expect(colItf(await t.libroDescargado())).toEqual([undefined, undefined, undefined]);
    expect(t.msgEstado.textContent).toBe(AVISO);
  });

  test('el aviso no muestra cantidades, codigos del backend ni detalles tecnicos', async () => {
    const t = montar({ n: 3, itf: () => ({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'Exception: lote 2 de 3' }) });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.msgEstado.textContent).not.toMatch(/SERVICE_UNAVAILABLE|Exception|lote|\d/);
  });

  test('el aviso parcial no se borra solo y el siguiente export exitoso lo reemplaza', async () => {
    let falla = true;
    const t = montar({ n: 3, itf: (lote, i, fase) => (fase === 'tabla' || falla ? { status: 'error', code: 'X' } : { status: 'ok', data: Object.fromEntries(lote.map((w) => [w, true])) }) });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.msgEstado.textContent).toBe(AVISO);
    expect(t.timers.filter((x) => x.ms <= 10000 && !x.hecho)).toHaveLength(0);
    falla = false;
    t.clic();
    await t.terminar();
    expect(t.msgEstado.textContent).toBe('Excel descargado.');
  });
});

describe('sesion vencida o cuenta deshabilitada', () => {
  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al consultar ITF: logout global, NO se genera archivo, sin mensaje tecnico', async (codigo) => {
    const t = montar({ n: 3, itf: (lote, i, fase) => (fase === 'tabla' ? { status: 'error', code: 'X' } : { status: 'error', code: codigo, message: 'Sesion invalida (detalle)' }) });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(t.anclas).toHaveLength(0);
    expect(t.urls.creadas).toHaveLength(0);
    expect(t.t.jszip).toBe(0);
    expect(t.msgError.hidden).toBe(true);
    expect(t.msgEstado.hidden).toBe(true);
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    expect(t.boton.disabled).toBe(false);
  });

  test('varios lotes con sesion invalida: se avisa UNA sola vez', async () => {
    const t = montar({ n: 600, itf: (lote, i, fase) => (fase === 'tabla' ? { status: 'error', code: 'X' } : { status: 'error', code: 'UNAUTHORIZED' }) });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.sesion.onSessionExpired).toHaveBeenCalledTimes(1);
    expect(t.anclas).toHaveLength(0);
  }, 60000);

  test('sin perfil no hay consulta, asi que no hay modo de que la sesion invalida bloquee: el archivo se genera', async () => {
    const t = montar({ n: 3, permisos: { ubicacion: true } });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(1);
  });

  test('un logout (reset) durante la preparacion: no se descarga nada despues', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    t.t.retener = new Promise((r) => { t.liberar = r; });
    t.clic();
    await flush();
    t.ctx.exportacionSeleccionController_reset();
    expect(t.textoBoton()).toBe('Exportar Excel (0)');
    expect(t.boton.disabled).toBe(true);
    t.t.retener = null;
    t.liberar();
    await flush();
    expect(t.anclas).toHaveLength(0);
    expect(t.msgEstado.hidden).toBe(true);
    expect(t.msgError.hidden).toBe(true);
  });
});

describe('errores de generacion', () => {
  const ERROR = 'No se pudo preparar el archivo Excel. Intentá nuevamente.';

  test('JSZip no carga: no se descarga nada, mensaje de error, el boton se rehabilita', async () => {
    const t = montar({ n: 3, jszip: 'falla' });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(0);
    expect(t.urls.creadas).toHaveLength(0);
    expect(t.msgError.hidden).toBe(false);
    expect(t.msgError.textContent).toBe(ERROR);
    expect(t.msgEstado.hidden).toBe(true);
    expect(t.textoBoton()).toBe('Exportar Excel (3)');
    expect(t.boton.disabled).toBe(false);
  });

  test('JSZip "carga" pero no esta disponible: tambien es error, sin archivo', async () => {
    const t = montar({ n: 3 });
    t.ctx.mapaShared_cargarJSZip = () => { delete t.ctx.JSZip; return Promise.resolve(); };
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(0);
    expect(t.msgError.textContent).toBe(ERROR);
  });

  test('Blob falla: error, sin descarga, boton habilitado', async () => {
    const t = montar({ n: 3, blob: 'falla' });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(0);
    expect(t.msgError.textContent).toBe(ERROR);
    expect(t.boton.disabled).toBe(false);
  });

  test('la generacion del XLSX falla: error, sin descarga', async () => {
    const t = montar({ n: 3 });
    t.ctx.xlsxLogic_generar = () => Promise.reject(new Error('zip roto'));
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(0);
    expect(t.msgError.textContent).toBe(ERROR);
  });

  test('createObjectURL falla: error, sin descarga', async () => {
    const t = montar({ n: 3 });
    t.ctx.URL.createObjectURL = () => { throw new Error('sin memoria'); };
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.anclas).toHaveLength(0);
    expect(t.msgError.textContent).toBe(ERROR);
  });

  test('despues de un error se puede reintentar y el error anterior se limpia', async () => {
    const t = montar({ n: 3, jszip: 'falla' });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.msgError.hidden).toBe(false);
    t.ctx.mapaShared_cargarJSZip = () => { t.ctx.JSZip = JSZip; return Promise.resolve(); };
    t.clic();
    await t.terminar();
    expect(t.msgError.hidden).toBe(true);
    expect(t.anclas).toHaveLength(1);
  });

  test('los mensajes de error no llevan detalles tecnicos de la excepcion', async () => {
    const t = montar({ n: 3 });
    t.ctx.xlsxLogic_generar = () => Promise.reject(new Error('TypeError: x is not a function at línea 42'));
    await t.abrir();
    t.clic();
    await t.terminar();
    expect(t.msgError.textContent).not.toMatch(/TypeError|línea|function/);
  });
});

describe('privacidad', () => {
  test('titular, nc16, email, agente y token (presentes en los datasets) no salen ni en el archivo, ni en el nombre, ni en mensajes ni en atributos del boton', async () => {
    const t = montar({ n: 6 });
    await t.abrir();
    t.clic();
    await t.terminar();
    const libro = await t.libroDescargado();
    const todoElArchivo = libro.todo.join('\n');
    Object.keys(marcas).forEach((k) => { expect(todoElArchivo).not.toContain(marcas[k]); });
    const zip = await JSZip.loadAsync(Buffer.from(await t.urls.creadas[0].arrayBuffer()));
    for (const r of Object.keys(zip.files).filter((x) => !zip.files[x].dir)) {
      const c = await zip.file(r).async('string');
      Object.keys(marcas).forEach((k) => { expect(c).not.toContain(marcas[k]); });
    }
    const visible = [t.anclas[0].download, t.anclas[0].href, t.boton.textContent, JSON.stringify(t.boton.attrs), t.msgEstado.textContent, t.msgError.textContent, JSON.stringify(t.msgEstado.attrs)].join('|');
    Object.keys(marcas).forEach((k) => { expect(visible).not.toContain(marcas[k]); });
  });

  test('la foto que se entrega a la exportacion no trae datos personales', async () => {
    const t = montar({ n: 3 });
    await t.abrir();
    const foto = t.ctx.seleccionController_snapshotExportacion();
    const sinDataset = Object.assign({}, foto, { indicePozos: null });                     // el dataset operativo es publico y se filtra campo por campo en el modelo
    Object.keys(marcas).forEach((k) => { expect(JSON.stringify(sinDataset)).not.toContain(marcas[k]); });
  });

  test('el nombre del archivo no depende de filtros, cantidades ni usuario', async () => {
    const a = montar({ n: 6 });
    await a.abrir();
    await a.buscar('valle');
    a.clic();
    await a.terminar();
    const b = montar({ n: 2 });
    await b.abrir();
    b.clic();
    await b.terminar();
    expect(a.anclas[0].download).toBe(b.anclas[0].download);
  });

  test('columna sin permiso: ubicacion=false -> sin Estado de ubicacion, Latitud ni Longitud; ne / reemplazo igual', async () => {
    const t = montar({ n: 3, permisos: { datos: true, perfil: true } });
    await t.abrir();
    t.clic();
    await t.terminar();
    const libro = await t.libroDescargado();
    expect(libro.encabezado).toEqual(['Pozo', 'Departamento', 'Cuenca', 'Profundidad (m)', 'Tipo de pozo', 'Tiene ITF']);
    expect(libro.hoja).not.toMatch(/-33\.000/);
  });

  test('el permiso "datos" (titular / nc16) no agrega columnas', async () => {
    const t = montar({ n: 3, permisos: { datos: true } });
    await t.abrir();
    t.clic();
    await t.terminar();
    expect((await t.libroDescargado()).encabezado).toEqual(['Pozo', 'Departamento', 'Cuenca', 'Profundidad (m)', 'Tipo de pozo']);
  });
});

describe('rendimiento del flujo completo en el harness (modelo + XLSX + descarga)', () => {
  test.each([[10], [1000]])('%i filas', async (n) => {
    const t = montar({ n });
    await t.abrir();
    const t0 = Date.now();
    t.clic();
    await t.terminar();
    const ms = Date.now() - t0;
    expect(t.anclas).toHaveLength(1);
    expect((await t.libroDescargado()).pozos).toHaveLength(n);
    process.stdout.write('   [flujo] ' + n + ' filas: ' + ms + ' ms (incluye vaciados de cola del test)\n');
  }, 120000);
});
