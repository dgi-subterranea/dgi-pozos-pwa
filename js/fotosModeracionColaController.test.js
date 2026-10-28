// Controlador DOM de "Fotos pendientes" (E8-5): js/fotosModeracionCola.js ejecutado de verdad con un DOM minimo falso (que LANZA ante innerHTML / insertAdjacentHTML). Cubre la tarjeta de la cola, las
// pestañas, las tarjetas (pendientes y retiradas), la paginacion, las miniaturas lazy (maximo 3 en paralelo, con fallo tolerado), la foto completa, aprobar / rechazar / reponer con confirmacion, el
// historial reutilizado, el foco, el teclado, los errores y la sesion. La logica fina esta en fotosModeracionColaLogic.test.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const raiz = path.join(__dirname, '..');
const html = leer(raiz, 'index.html');
const fuenteControlador = leer(__dirname, 'fotosModeracionCola.js');
const codigoControlador = fuenteControlador.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const fuentes = ['reemplazoLogic.js', 'observacionesPozoLogic.js', 'fotosPozosLogic.js', 'fotosModeracionLogic.js', 'fotosModeracionColaLogic.js', 'fotosModeracionCola.js'].map((f) => leer(__dirname, f));

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const MOD = { fotos: true, fotos_moderar: true };
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };

const itemPend = (n, extra) => Object.assign({
  solicitudId: uuid(100 + n), fotoId: uuid(n), entidadTipo: 'WELL', entidadId: '14-000' + (n % 10), motivoCodigo: 'DUPLICADA', motivoTexto: '', nombre: 'Ana ' + n,
  timestampUtc: '2026-10-27T15:00:00.000Z', foto: { tipoFoto: 'CERCA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' }
}, extra || {});
const itemRet = (n, extra) => Object.assign({
  fotoId: uuid(n), entidadTipo: 'WELL', entidadId: '14-000' + (n % 10), origenRetiro: 'EVENTO', motivoCodigo: 'MALA_CALIDAD', motivoTexto: '', nombre: 'Marta', timestampUtc: '2026-10-27T15:00:00.000Z',
  viaSolicitud: false, requiereRevisionBorrado: false, foto: { tipoFoto: 'OTRA', fuente: 'MONITOREO_NE', fechaFotoValor: '2024', fechaFotoPrecision: 'ANIO' }
}, extra || {});
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ total: items.length, items: items, hayMas: false, cursor: null }, extra || {}) });

class Nodo {
  constructor(tag, id) {
    this.tag = tag; this.id = id || ''; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false; this.parentNode = null;
    this.oyentes = {}; this.attrs = {}; this.isConnected = true; this.src = undefined; this.alt = ''; this.type = '';
    const self = this;
    this.classList = {
      toggle(c, on) { const set = new Set(self.className.split(/\s+/).filter(Boolean)); if (on === undefined ? !set.has(c) : on) { set.add(c); } else { set.delete(c); } self.className = Array.from(set).join(' '); },
      contains(c) { return self.className.split(/\s+/).indexOf(c) >= 0; }
    };
  }
  desconectar() { this.isConnected = false; this.children.forEach((c) => c.desconectar()); }
  set textContent(v) { this.children.forEach((c) => c.desconectar()); this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML prohibido'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML prohibido'); }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(tipo, f) { (this.oyentes[tipo] = this.oyentes[tipo] || []).push(f); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'src') { this.src = undefined; } }
  focus() { Nodo.enFoco = this; }
  emitir(tipo, ev) { const e = ev || {}; e.target = e.target || this; (this.oyentes[tipo] || []).forEach((f) => f(e)); return e; }
  click() { if (!this.disabled && !this.hidden) { this.emitir('click'); } }
}

function cargar(opc) {
  const o = opc || {};
  const ids = Array.from(new Set(Array.from(fuenteControlador.matchAll(/\$\('([^']+)'\)/g)).map((m) => m[1])));
  const el = {};
  ids.forEach((id) => {
    el[id] = new Nodo('el', id);
    const m = new RegExp('<[^>]*id="' + id + '"[^>]*>').exec(html);
    el[id].hidden = !!m && /\shidden(\s|>|$)/.test(m[0].replace(/id="[^"]*"/, ''));
  });
  Nodo.enFoco = null;
  const bodyClases = new Set();
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Intl, setTimeout, Set });
  ctx.window = ctx;
  ctx.crypto = { randomUUID: () => nodeCrypto.randomUUID() };
  ctx.document = {
    body: { classList: { toggle: (c, on) => { if (on) { bodyClases.add(c); } else { bodyClases.delete(c); } } } },
    get activeElement() { return Nodo.enFoco; },
    getElementById: (id) => el[id],
    createElement: (tag) => new Nodo(tag)
  };
  const observados = [];
  if (o.observador) {
    ctx.IntersectionObserver = function (cb) {
      this.observe = (img) => { observados.push(img); };
      this.unobserve = () => {};
      ctx.__intersectar = (img) => cb([{ isIntersecting: true, target: img }]);
    };
  }
  const llamadas = { pendientes: [], retiradas: [], resolver: [], reponer: [], imagen: [], normal: [], historial: [] };
  const pend = { pendientes: [], retiradas: [], resolver: [], reponer: [], imagen: [] };
  const mk = (clave) => (...args) => { llamadas[clave].push(args); return new Promise((res) => { pend[clave].push(res); }); };
  ctx.apiGetFotosPozosPendientesModeracion = jest.fn(mk('pendientes'));
  ctx.apiGetFotosPozosRetiradasModeracion = jest.fn(mk('retiradas'));
  ctx.apiResolverRetiroFotoPozo = jest.fn(mk('resolver'));
  ctx.apiReponerFotoPozo = jest.fn(mk('reponer'));
  ctx.apiGetFotoPozoModeracion = jest.fn(o.imagenManual ? mk('imagen') : (...args) => {
    llamadas.imagen.push(args);
    return o.imagen ? o.imagen(...args) : Promise.resolve({ status: 'ok', data: { fotoId: args[1], variante: args[2], mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
  });
  ctx.apiGetFotoPozo = jest.fn((...args) => { llamadas.normal.push(args); return Promise.resolve({ status: 'error', code: 'FOTO_NOT_FOUND' }); });
  const contexto = { sessionToken: 'tok', permisos: o.permisos || Object.assign({}, MOD) };
  const sesion = jest.fn();
  contexto.onSessionExpired = sesion;
  // historial de la galeria (otro controlador): se simula con un doble que recuerda como lo abrieron
  const historiales = [];
  ctx.fotosModeracionController_abrirHistorial = jest.fn((fotoId, boton, externo) => { historiales.push({ fotoId, boton, externo }); });
  ctx.fotosModeracionController_cerrar = jest.fn();
  ctx.fotosPozosResumenController_cargar = jest.fn();
  fuentes.forEach((src) => vm.runInContext(src, ctx));
  ctx.fotosModeracionColaController_inicializar(() => contexto);
  return { el, ctx, contexto, llamadas, pend, sesion, bodyClases, historiales, observados };
}

const E = (t, id) => t.el[id];
const texto = (t, id) => E(t, id).textContent;
const tarjetas = (t) => E(t, 'fotos-cola-lista').children;
const cuerpo = (li) => li.children[1];
const botones = (li) => li.children[2].children;
const boton = (li, etiqueta) => botones(li).filter((b) => b.textContent === etiqueta)[0];
const lineas = (li) => cuerpo(li).children.map((p) => p.textContent);
const abrir = async (t, items, extra) => {
  const p = t.ctx.fotosModeracionColaController_abrir();
  t.pend.pendientes[t.pend.pendientes.length - 1](pagina(items || [], extra));
  await p;
  await flush();
};
const irARetiradas = async (t, items, extra) => {
  E(t, 'fotos-cola-tab-retiradas').click();
  t.pend.retiradas[t.pend.retiradas.length - 1](pagina(items, extra));
  await flush();
};

describe('apertura y permisos', () => {
  test('abrir pide SOLO la primera pagina de Pendientes con el token; Retiradas no se pide hasta elegirla', async () => {
    const t = cargar();
    const p = t.ctx.fotosModeracionColaController_abrir();
    expect(t.llamadas.pendientes).toEqual([['tok', 20, undefined]]);
    expect(t.llamadas.retiradas).toHaveLength(0);
    expect(E(t, 'fotos-cola-cargando').hidden).toBe(false);
    t.pend.pendientes[0](pagina([itemPend(1)]));
    expect(await p).toBe(true);
    await flush();
    expect(E(t, 'fotos-cola-cargando').hidden).toBe(true);
  });

  test.each([[{ fotos: true }], [{ fotos: true, fotos_carga: true }], [{ fotos_moderar: true }], [{ fotos: 'SI', fotos_moderar: 'SI' }], [{}]])('sin fotos + fotos_moderar exactos (%j) no se pide NADA', async (permisos) => {
    const t = cargar({ permisos });
    expect(await t.ctx.fotosModeracionColaController_abrir()).toBe(false);
    expect(t.llamadas.pendientes).toHaveLength(0);
    expect(t.llamadas.retiradas).toHaveLength(0);
    expect(tarjetas(t)).toHaveLength(0);
  });

  test('una apertura nueva descarta la anterior: cierra los dialogos de moderacion y la respuesta vieja no se pinta', async () => {
    const t = cargar();
    t.ctx.fotosModeracionColaController_abrir();
    t.ctx.fotosModeracionColaController_abrir();
    expect(t.ctx.fotosModeracionController_cerrar).toHaveBeenCalledTimes(2);
    t.pend.pendientes[0](pagina([itemPend(1)]));
    await flush();
    expect(tarjetas(t)).toHaveLength(0);
    t.pend.pendientes[1](pagina([itemPend(2)]));
    await flush();
    expect(tarjetas(t)).toHaveLength(1);
  });
});

describe('estados de la lista', () => {
  test('cargando: indicador visible y sin tarjetas ni "Ver mas"', async () => {
    const t = cargar();
    t.ctx.fotosModeracionColaController_abrir();
    expect(E(t, 'fotos-cola-cargando').hidden).toBe(false);
    expect(tarjetas(t)).toHaveLength(0);
    expect(E(t, 'btn-fotos-cola-mas').hidden).toBe(true);
    expect(E(t, 'fotos-cola-vacio').hidden).toBe(true);
    expect(E(t, 'btn-fotos-cola-actualizar').disabled).toBe(true);
  });

  test('vacia: el mensaje pedido en cada pestaña', async () => {
    const t = cargar();
    await abrir(t, []);
    expect(E(t, 'fotos-cola-vacio').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-vacio')).toBe('No hay solicitudes de retiro pendientes.');
    expect(E(t, 'fotos-cola-total').hidden).toBe(true);
    await irARetiradas(t, []);
    expect(texto(t, 'fotos-cola-vacio')).toBe('No hay fotos retiradas para revisar.');
  });

  test('error: texto fijo, boton Reintentar (vuelve a pedir) y NINGUN codigo tecnico', async () => {
    const t = cargar();
    const p = t.ctx.fotosModeracionColaController_abrir();
    t.pend.pendientes[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'No existe la hoja "FotosPozoEventos" https://docs.google.com/x' });
    await p;
    await flush();
    expect(E(t, 'fotos-cola-error').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-error-texto')).toBe('No se pudo cargar la moderación de fotos.');
    expect(Object.keys(t.el).map((id) => t.el[id].textContent).join(' ')).not.toMatch(/SERVICE_UNAVAILABLE|FotosPozoEventos|docs\.google|hoja/);
    expect(tarjetas(t)).toHaveLength(0);
    expect(E(t, 'fotos-cola-vacio').hidden).toBe(true);
    E(t, 'btn-fotos-cola-reintentar').click();
    expect(t.llamadas.pendientes).toHaveLength(2);
    expect(E(t, 'fotos-cola-error').hidden).toBe(true);
    t.pend.pendientes[1](pagina([itemPend(1)]));
    await flush();
    expect(tarjetas(t)).toHaveLength(1);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: logout global, sin pantalla de error de moderacion', async (code) => {
    const t = cargar();
    const p = t.ctx.fotosModeracionColaController_abrir();
    t.pend.pendientes[0]({ status: 'error', code });
    await p;
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
    expect(E(t, 'fotos-cola-error').hidden).toBe(true);
  });

  test('Actualizar vuelve a pedir la primera pagina de la pestaña actual', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    E(t, 'btn-fotos-cola-actualizar').click();
    expect(t.llamadas.pendientes).toHaveLength(2);
    expect(tarjetas(t)).toHaveLength(0);          // nunca se muestra una lista vieja mientras se vuelve a pedir
  });

  test('el total informado se muestra con singular / plural', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)], { total: 1 });
    expect(texto(t, 'fotos-cola-total')).toBe('1 solicitud pendiente');
    const u = cargar();
    await abrir(u, [itemPend(1), itemPend(2)], { total: 7, hayMas: true, cursor: 5 });
    expect(texto(u, 'fotos-cola-total')).toBe('7 solicitudes pendientes');
  });
});

describe('tarjetas de Pendientes', () => {
  test('cada solicitud: entidad, quien y cuando, motivo humano, detalle, metadata de la foto y las 4 acciones', async () => {
    const t = cargar();
    await abrir(t, [itemPend(3, { motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara' })]);
    const li = tarjetas(t)[0];
    expect(lineas(li)).toEqual(['Pozo 14-0003', 'Solicitado por Ana 3 · 27/10/2026 12:00', 'Motivo: Otro', 'se ve una cara', 'Foto del 06/2025 · Carga de campo · De cerca']);
    expect(botones(li).map((b) => b.textContent)).toEqual(['Abrir foto', 'Ver historial', 'Aprobar retiro', 'Rechazar']);
    expect(botones(li).map((b) => b.attrs['aria-label'])).toEqual(['Abrir foto de Pozo 14-0003', 'Ver historial de Pozo 14-0003', 'Aprobar retiro de Pozo 14-0003', 'Rechazar retiro de Pozo 14-0003']);
    botones(li).forEach((b) => { expect(b.tag).toBe('button'); expect(b.type).toBe('button'); });
  });

  test('un punto NE se muestra como tal; el orden es el del backend (mas reciente primero)', async () => {
    const t = cargar();
    await abrir(t, [itemPend(5, { entidadTipo: 'MONITORING', entidadId: 'INA 536' }), itemPend(4)]);
    expect(tarjetas(t).map((li) => lineas(li)[0])).toEqual(['Punto NE INA 536', 'Pozo 14-0004']);
  });

  test('NO muestra email, secuencia, clientRequestId, ids de Drive ni codigos crudos', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1, { email: 'secreto@x.com', secuencia: 9, clientRequestId: 'foto-sol-abc', driveFileId: 'DRIVE_1', motivoCodigo: 'NO_CORRESPONDE_POZO' })]);
    const visible = tarjetas(t)[0].textContent + tarjetas(t)[0].children.map((c) => JSON.stringify(c.attrs)).join('');
    expect(visible).not.toMatch(/secreto@x\.com|secuencia|clientRequestId|foto-sol-abc|DRIVE_1|NO_CORRESPONDE_POZO|SERVICE_UNAVAILABLE/);
    expect(visible).toContain('No corresponde al pozo');
  });

  test('texto libre con HTML / comillas / emoji / saltos de linea se pinta literal (textContent) y el texto largo no rompe', async () => {
    const t = cargar();
    const raro = '<img src=x onerror=alert(1)><script>x</script> & "comillas" 😀\nlinea 2 ' + 'palabrafuertelarguisima'.repeat(20);
    await abrir(t, [itemPend(1, { motivoCodigo: 'OTRO', motivoTexto: raro, nombre: '<b>Ana</b>' })]);
    const li = tarjetas(t)[0];
    expect(lineas(li)[3]).toBe(raro);
    expect(lineas(li)[1]).toContain('<b>Ana</b>');
    expect(li.children[1].children[3].className).toBe('fotos-cola-texto');
  });

  test('un nombre con forma de email se muestra neutro', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1, { nombre: 'persona@dominio.com' })]);
    expect(lineas(tarjetas(t)[0])[1]).toBe('Solicitado por Usuario · 27/10/2026 12:00');
  });

  test('20 solicitudes: 20 tarjetas', async () => {
    const t = cargar();
    const items = [];
    for (let i = 1; i <= 20; i++) { items.push(itemPend(i)); }
    await abrir(t, items, { total: 20 });
    expect(tarjetas(t)).toHaveLength(20);
  });

  test('la lista no se reconstruye si no cambia (no se pierde el foco al repintar por otra razon)', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1), itemPend(2)]);
    const antes = tarjetas(t).slice();
    t.ctx.fotosModeracionColaController_hayModalAbierto();
    boton(antes[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-cancelar').click();
    expect(tarjetas(t)[0]).toBe(antes[0]);
  });
});

describe('tarjetas de Retiradas', () => {
  test('quien retiro, motivo, fecha, metadata y las acciones Abrir / Historial / Reponer (sin Aprobar ni Rechazar)', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(2, { motivoCodigo: 'OTRO', motivoTexto: 'otra cosa' })]);
    const li = tarjetas(t)[0];
    expect(lineas(li)).toEqual(['Pozo 14-0002', 'Retirada por Marta · 27/10/2026 12:00', 'Motivo: Otro', 'otra cosa', 'Foto del 2024 · Monitoreo NE · Otra']);
    expect(botones(li).map((b) => b.textContent)).toEqual(['Abrir foto', 'Ver historial', 'Reponer']);
    expect(botones(li).map((b) => b.attrs['aria-label'])).toEqual(['Abrir foto de Pozo 14-0002', 'Ver historial de Pozo 14-0002', 'Reponer foto de Pozo 14-0002']);
  });

  test('retiro aprobado desde una solicitud: se dice quien aprobo', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(2, { viaSolicitud: true, nombre: 'Jefe' })]);
    expect(lineas(tarjetas(t)[0])[1]).toBe('Retiro aprobado por Jefe · 27/10/2026 12:00');
  });

  test('PRIVACIDAD: "Pendiente de revisión de borrado" solo cuando el backend lo marca, y NUNCA hay boton de borrar', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1, { motivoCodigo: 'PRIVACIDAD', requiereRevisionBorrado: true }), itemRet(2)]);
    const [conAviso, sinAviso] = tarjetas(t);
    expect(conAviso.textContent).toContain('Pendiente de revisión de borrado');
    expect(conAviso.textContent).toContain('Motivo: Privacidad');
    expect(sinAviso.textContent).not.toContain('revisión de borrado');
    tarjetas(t).forEach((li) => botones(li).forEach((b) => expect(b.textContent).not.toMatch(/borrar|eliminar|delete/i)));
  });

  test('una OCULTA legacy que llegara por error no aparece como reponible', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1, { origenRetiro: 'LEGACY_OCULTA' }), itemRet(2)]);
    expect(tarjetas(t)).toHaveLength(1);
    expect(lineas(tarjetas(t)[0])[0]).toBe('Pozo 14-0002');
  });

  test('retiradas con el total en singular / plural', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1), itemRet(2)], { total: 2 });
    expect(texto(t, 'fotos-cola-total')).toBe('2 fotos retiradas');
  });
});

describe('pestañas', () => {
  test('roles y estado accesibles: la activa tiene aria-selected y tabindex 0; el panel apunta a la activa', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    expect(E(t, 'fotos-cola-tab-pendientes').attrs['aria-selected']).toBe('true');
    expect(E(t, 'fotos-cola-tab-pendientes').attrs.tabindex).toBe('0');
    expect(E(t, 'fotos-cola-tab-retiradas').attrs['aria-selected']).toBe('false');
    expect(E(t, 'fotos-cola-tab-retiradas').attrs.tabindex).toBe('-1');
    expect(E(t, 'fotos-cola-panel').attrs['aria-labelledby']).toBe('fotos-cola-tab-pendientes');
    await irARetiradas(t, []);
    expect(E(t, 'fotos-cola-tab-retiradas').attrs['aria-selected']).toBe('true');
    expect(E(t, 'fotos-cola-tab-pendientes').attrs['aria-selected']).toBe('false');
    expect(E(t, 'fotos-cola-panel').attrs['aria-labelledby']).toBe('fotos-cola-tab-retiradas');
  });

  test('flechas Izquierda / Derecha, Inicio y Fin cambian de pestaña y mueven el foco', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    const ev = { key: 'ArrowRight', preventDefault: jest.fn() };
    E(t, 'fotos-cola-tab-pendientes').emitir('keydown', ev);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(Nodo.enFoco).toBe(E(t, 'fotos-cola-tab-retiradas'));
    expect(t.llamadas.retiradas).toHaveLength(1);
    t.pend.retiradas[0](pagina([]));
    await flush();
    E(t, 'fotos-cola-tab-retiradas').emitir('keydown', { key: 'Home', preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'fotos-cola-tab-pendientes'));
    E(t, 'fotos-cola-tab-pendientes').emitir('keydown', { key: 'End', preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'fotos-cola-tab-retiradas'));
    const otra = { key: 'a', preventDefault: jest.fn() };
    E(t, 'fotos-cola-tab-retiradas').emitir('keydown', otra);
    expect(otra.preventDefault).not.toHaveBeenCalled();
  });

  test('no se mezclan: una respuesta vieja de Pendientes no pisa lo que se ve en Retiradas', async () => {
    const t = cargar();
    const p = t.ctx.fotosModeracionColaController_abrir();           // Pendientes en vuelo
    E(t, 'fotos-cola-tab-retiradas').click();
    t.pend.retiradas[0](pagina([itemRet(7)]));
    await flush();
    t.pend.pendientes[0](pagina([itemPend(1), itemPend(2)]));        // llega tarde
    await p;
    await flush();
    expect(tarjetas(t)).toHaveLength(1);
    expect(lineas(tarjetas(t)[0])[0]).toBe('Pozo 14-0007');
    E(t, 'fotos-cola-tab-pendientes').click();
    expect(tarjetas(t)).toHaveLength(2);
  });

  test('volver a una pestaña ya cargada no vuelve a pedir', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    await irARetiradas(t, [itemRet(2)]);
    E(t, 'fotos-cola-tab-pendientes').click();
    E(t, 'fotos-cola-tab-retiradas').click();
    expect(t.llamadas.pendientes).toHaveLength(1);
    expect(t.llamadas.retiradas).toHaveLength(1);
  });
});

describe('paginacion', () => {
  test('"Ver mas" solo con mas paginas; pide la siguiente con el cursor, suma sin repetir y se deshabilita mientras carga', async () => {
    const t = cargar();
    await abrir(t, [itemPend(5), itemPend(4)], { total: 5, hayMas: true, cursor: 41 });
    expect(E(t, 'btn-fotos-cola-mas').hidden).toBe(false);
    expect(t.llamadas.pendientes).toHaveLength(1);
    E(t, 'btn-fotos-cola-mas').click();
    expect(t.llamadas.pendientes[1]).toEqual(['tok', 20, 41]);
    expect(E(t, 'btn-fotos-cola-mas').disabled).toBe(true);
    expect(texto(t, 'btn-fotos-cola-mas')).toBe('Cargando…');
    E(t, 'btn-fotos-cola-mas').click();
    expect(t.llamadas.pendientes).toHaveLength(2);
    t.pend.pendientes[1](pagina([itemPend(4), itemPend(3)], { total: 5, hayMas: false, cursor: null }));
    await flush();
    expect(tarjetas(t).map((li) => lineas(li)[0])).toEqual(['Pozo 14-0005', 'Pozo 14-0004', 'Pozo 14-0003']);
    expect(E(t, 'btn-fotos-cola-mas').hidden).toBe(true);
    expect(texto(t, 'fotos-cola-total')).toBe('5 solicitudes pendientes');
  });

  test('fallo al cargar mas: conserva las tarjetas, avisa y deja reintentar', async () => {
    const t = cargar();
    await abrir(t, [itemPend(5)], { total: 3, hayMas: true, cursor: 9 });
    E(t, 'btn-fotos-cola-mas').click();
    t.pend.pendientes[1]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    await flush();
    expect(tarjetas(t)).toHaveLength(1);
    expect(E(t, 'fotos-cola-mas-error').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-mas-error')).toBe('No se pudieron cargar más. Intentá nuevamente.');
    expect(E(t, 'btn-fotos-cola-mas').hidden).toBe(false);
    E(t, 'btn-fotos-cola-mas').click();
    expect(t.llamadas.pendientes[2][2]).toBe(9);
    expect(E(t, 'fotos-cola-mas-error').hidden).toBe(true);
  });

  test('NO hay filtros de cliente: ni buscador ni selector en la pantalla', () => {
    const pantalla = html.slice(html.indexOf('<div id="screen-fotos-moderacion"'), html.indexOf('<div id="fotos-cola-conf-overlay"'));
    expect(pantalla).not.toMatch(/<input|<select|type="search"|filtro/i);
    expect(codigoControlador).not.toMatch(/\.filter\(function \(it\)|filtrar|buscar/i);
  });
});

describe('miniaturas', () => {
  test('se piden con el endpoint de MODERACION (thumb) y nunca con el normal; la imagen es un data: URL', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1), itemPend(2)]);
    expect(t.llamadas.imagen.map((a) => a.slice(1))).toEqual([[uuid(1), 'thumb'], [uuid(2), 'thumb']]);
    expect(t.llamadas.normal).toHaveLength(0);
    expect(tarjetas(t)[0].children[0].children[0].src).toBe('data:image/jpeg;base64,AAAA');
    expect(tarjetas(t)[0].children[0].children[0].hidden).toBe(false);
  });

  test('lazy: con IntersectionObserver no se pide nada hasta que la tarjeta entra en pantalla', async () => {
    const t = cargar({ observador: true });
    await abrir(t, [itemPend(1), itemPend(2), itemPend(3)]);
    expect(t.llamadas.imagen).toHaveLength(0);
    expect(t.observados).toHaveLength(3);
    t.observados.forEach((o) => { expect(o.className).toBe('fotos-cola-mini'); expect(o.hidden).toBe(false); });      // se observa el recuadro visible, nunca la <img> oculta (display:none no intersecta)
    t.ctx.__intersectar(t.observados[1]);
    await flush();
    expect(t.llamadas.imagen.map((a) => a[1])).toEqual([uuid(2)]);
  });

  test('maximo 3 miniaturas en paralelo; las demas esperan', async () => {
    const t = cargar({ imagenManual: true });
    const items = [];
    for (let i = 1; i <= 7; i++) { items.push(itemPend(i)); }
    await abrir(t, items);
    expect(t.llamadas.imagen).toHaveLength(3);
    t.pend.imagen[0]({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
    await flush();
    expect(t.llamadas.imagen).toHaveLength(4);
  });

  test('una miniatura que falla deja un recuadro "Sin vista previa"; la solicitud sigue siendo resoluble y la lista no falla', async () => {
    const t = cargar({ imagen: (token, fotoId) => (fotoId === uuid(1) ? Promise.resolve({ status: 'error', code: 'STORAGE_UNAVAILABLE' }) : Promise.resolve({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'BBBB' } })) });
    await abrir(t, [itemPend(1), itemPend(2)]);
    expect(E(t, 'fotos-cola-error').hidden).toBe(true);
    expect(tarjetas(t)).toHaveLength(2);
    const mini = tarjetas(t)[0].children[0];
    expect(mini.textContent).toBe('Sin vista previa');
    expect(mini.children[0].hidden).toBe(true);
    expect(tarjetas(t)[1].children[0].children[0].src).toBe('data:image/jpeg;base64,BBBB');
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(false);
  });

  test('una respuesta sin imagen valida es un fallo tolerado', async () => {
    const t = cargar({ imagen: () => Promise.resolve({ status: 'ok', data: { mimeType: 'image/jpeg' } }) });
    await abrir(t, [itemPend(1)]);
    expect(tarjetas(t)[0].children[0].textContent).toBe('Sin vista previa');
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al cargar una miniatura: logout global', async (code) => {
    const t = cargar({ imagen: () => Promise.resolve({ status: 'error', code }) });
    await abrir(t, [itemPend(1)]);
    expect(t.sesion).toHaveBeenCalled();
  });

  test('sin permiso no se piden imagenes', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    const antes = t.llamadas.imagen.length;
    t.contexto.permisos = { fotos: true };
    E(t, 'fotos-cola-tab-retiradas').click();
    await flush();
    expect(t.llamadas.retiradas).toHaveLength(0);
    expect(t.llamadas.imagen).toHaveLength(antes);
    expect(texto(t, 'fotos-cola-error-texto')).toBe('Ya no tenés permiso para realizar esta acción.');
  });
});

describe('Abrir foto (tamano completo)', () => {
  test('pide la imagen COMPLETA con el endpoint de moderacion, muestra entidad y datos y enfoca el cierre', async () => {
    const t = cargar();
    await abrir(t, [itemPend(3)]);
    t.llamadas.imagen.length = 0;
    boton(tarjetas(t)[0], 'Abrir foto').click();
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(false);
    expect(t.llamadas.imagen).toEqual([['tok', uuid(3), 'full']]);
    expect(t.llamadas.normal).toHaveLength(0);
    expect(texto(t, 'fotos-cola-vis-pie')).toBe('Pozo 14-0003 · Foto del 06/2025 · Carga de campo · De cerca');
    expect(E(t, 'fotos-cola-vis-cargando').hidden).toBe(false);
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-vis-cerrar'));
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(true);
    await flush();
    expect(E(t, 'fotos-cola-vis-cargando').hidden).toBe(true);
    expect(E(t, 'fotos-cola-vis-img').src).toBe('data:image/jpeg;base64,AAAA');
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(false);
  });

  test('una foto que ya fue retirada mientras se miraba la cola igual se muestra (endpoint de moderacion, sin fallback al normal)', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(4)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    await flush();
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(false);
    expect(t.llamadas.normal).toHaveLength(0);
  });

  test('si la imagen falla: mensaje humano, y no se intenta con el endpoint normal', async () => {
    const t = cargar({ imagen: (token, fotoId, variante) => (variante === 'full' ? Promise.resolve({ status: 'error', code: 'STORAGE_UNAVAILABLE' }) : Promise.resolve({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'AAAA' } })) });
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    await flush();
    expect(E(t, 'fotos-cola-vis-error').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-vis-error')).toBe('No se pudo cargar la imagen. Intentá nuevamente.');
    expect(t.llamadas.normal).toHaveLength(0);
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(true);
  });

  test('FOTO_NOT_FOUND: "La foto ya no esta disponible."', async () => {
    const t = cargar({ imagen: (token, fotoId, variante) => (variante === 'full' ? Promise.resolve({ status: 'error', code: 'FOTO_NOT_FOUND' }) : Promise.resolve({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'AAAA' } })) });
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    await flush();
    expect(texto(t, 'fotos-cola-vis-error')).toBe('La foto ya no está disponible.');
  });

  test('cerrar (boton, X o Escape): vuelve el foco al boton de origen; una respuesta tardia no pinta nada', async () => {
    const t = cargar({ imagenManual: true });
    await abrir(t, [itemPend(1)]);
    const abrirBtn = boton(tarjetas(t)[0], 'Abrir foto');
    abrirBtn.click();
    const full = t.pend.imagen.length - 1;
    E(t, 'fotos-cola-vis-overlay').emitir('keydown', { key: 'Escape', stopPropagation() {} });
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(true);
    expect(Nodo.enFoco).toBe(abrirBtn);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
    t.pend.imagen[full]({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'ZZZZ' } });
    await flush();
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(true);
    expect(E(t, 'fotos-cola-vis-img').src).toBeUndefined();
    abrirBtn.click();
    E(t, 'btn-fotos-cola-vis-cerrar2').click();
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(true);
    abrirBtn.click();
    E(t, 'btn-fotos-cola-vis-cerrar').click();
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(true);
  });

  test('Tab rota dentro del dialogo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    const ev = { key: 'Tab', shiftKey: false, preventDefault: jest.fn() };
    E(t, 'fotos-cola-vis-overlay').emitir('keydown', ev);
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-vis-cerrar2'));
    E(t, 'fotos-cola-vis-overlay').emitir('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-vis-cerrar'));
    E(t, 'fotos-cola-vis-overlay').emitir('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-vis-cerrar2'));
  });

  test('sesion vencida al pedir la imagen completa: logout global', async () => {
    const t = cargar({ imagen: (token, fotoId, variante) => (variante === 'full' ? Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' }) : Promise.resolve({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'AAAA' } })) });
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });

  test('si se pierde el permiso con la lista a la vista, "Abrir foto" NO pide la imagen: muestra el mensaje del permiso', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    t.llamadas.imagen.length = 0;
    t.contexto.permisos = { fotos: true, fotos_carga: true };
    boton(tarjetas(t)[0], 'Abrir foto').click();
    await flush();
    expect(t.llamadas.imagen).toHaveLength(0);
    expect(texto(t, 'fotos-cola-vis-error')).toBe('Ya no tenés permiso para realizar esta acción.');
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(true);
  });

  test('mientras hay un dialogo abierto, los demas botones de las tarjetas no hacen nada', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Abrir foto').click();
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    boton(tarjetas(t)[0], 'Ver historial').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(t.historiales).toHaveLength(0);
    expect(t.ctx.fotosModeracionColaController_hayModalAbierto()).toBe(true);
  });
});

describe('Ver historial (reutiliza el dialogo de la galeria)', () => {
  test('abre el MISMO dialogo con el fotoId y el boton de origen; ningun componente nuevo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(2)]);
    const b = boton(tarjetas(t)[0], 'Ver historial');
    b.click();
    expect(t.historiales).toHaveLength(1);
    expect(t.historiales[0].fotoId).toBe(uuid(2));
    expect(t.historiales[0].boton).toBe(b);
    expect(t.ctx.fotosModeracionColaController_hayModalAbierto()).toBe(true);
    t.historiales[0].externo.alCerrar();
    expect(t.ctx.fotosModeracionColaController_hayModalAbierto()).toBe(false);
  });

  test('tambien desde Retiradas', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(6)]);
    boton(tarjetas(t)[0], 'Ver historial').click();
    expect(t.historiales[0].fotoId).toBe(uuid(6));
  });

  test('mientras el historial esta abierto no se abren otros dialogos desde la cola', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1), itemPend(2)]);
    boton(tarjetas(t)[0], 'Ver historial').click();
    boton(tarjetas(t)[1], 'Aprobar retiro').click();
    boton(tarjetas(t)[1], 'Abrir foto').click();
    boton(tarjetas(t)[1], 'Ver historial').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(true);
    expect(t.historiales).toHaveLength(1);
  });

  test('reponer desde el historial: la lista se vuelve a pedir con el aviso y el contador compartido se refresca', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(6)]);
    boton(tarjetas(t)[0], 'Ver historial').click();
    t.historiales[0].externo.alCerrar();
    t.historiales[0].externo.alReponer({ fotoId: uuid(6) });
    expect(t.ctx.fotosPozosResumenController_cargar).toHaveBeenCalledWith(true);
    expect(t.llamadas.retiradas).toHaveLength(2);
    expect(texto(t, 'fotos-cola-aviso')).toBe('Foto repuesta en la galería.');
    t.pend.retiradas[1](pagina([]));
    await flush();
    expect(texto(t, 'fotos-cola-vacio')).toBe('No hay fotos retiradas para revisar.');
  });

  test('si el estado cambio desde el historial: mensaje fijo y lista actualizada', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(6)]);
    boton(tarjetas(t)[0], 'Ver historial').click();
    t.historiales[0].externo.alCerrar();
    t.historiales[0].externo.alEstadoCambiado('FOTO_NO_RETIRADA');
    expect(texto(t, 'fotos-cola-aviso')).toBe('El estado de la foto cambió. Actualizamos la lista.');
    expect(E(t, 'fotos-cola-aviso').className).toContain('fotos-mod-aviso-error');
    expect(t.llamadas.retiradas).toHaveLength(2);
  });
});

describe('aprobar, rechazar y reponer con confirmacion', () => {
  const conf = (t) => ({ abierto: !E(t, 'fotos-cola-conf-overlay').hidden, titulo: texto(t, 'fotos-cola-conf-titulo'), texto: texto(t, 'fotos-cola-conf-texto'), boton: texto(t, 'btn-fotos-cola-conf-confirmar') });

  test('aprobar: confirmacion breve con el copy pedido, foco en Cancelar y SIN pedir motivo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    expect(conf(t)).toEqual({ abierto: true, titulo: 'Aprobar retiro', texto: 'La foto dejará de mostrarse en la galería.', boton: 'Aprobar retiro' });
    expect(texto(t, 'fotos-cola-conf-entidad')).toBe('Pozo 14-0001');
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-conf-cancelar'));
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(true);
    expect(t.llamadas.resolver).toHaveLength(0);
    const dialogo = html.slice(html.indexOf('id="fotos-cola-conf-overlay"'), html.indexOf('id="fotos-cola-vis-overlay"'));
    expect(dialogo).not.toMatch(/<select|<textarea|<input|motivo/i);
  });

  test('aprobar: confirmar manda solicitudId + APROBADO con id foto-res-<uuid>; deshabilitado mientras se envia; exito: sale de la lista, aviso, foco y contador', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1), itemPend(2)], { total: 2 });
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.resolver).toHaveLength(1);
    const [token, solicitudId, resolucion, id] = t.llamadas.resolver[0];
    expect([token, solicitudId, resolucion]).toEqual(['tok', uuid(101), 'APROBADO']);
    expect(id).toMatch(/^foto-res-[0-9a-f-]{36}$/);
    expect(E(t, 'btn-fotos-cola-conf-confirmar').disabled).toBe(true);
    expect(E(t, 'btn-fotos-cola-conf-cancelar').disabled).toBe(true);
    expect(E(t, 'btn-fotos-cola-conf-cerrar').disabled).toBe(true);
    expect(texto(t, 'btn-fotos-cola-conf-confirmar')).toBe('Aprobando…');
    t.pend.resolver[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
    await flush();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(tarjetas(t).map((li) => lineas(li)[0])).toEqual(['Pozo 14-0002']);
    expect(texto(t, 'fotos-cola-total')).toBe('1 solicitud pendiente');
    expect(texto(t, 'fotos-cola-aviso')).toBe('Retiro aprobado. La foto ya no se muestra en la galería.');
    expect(Nodo.enFoco).toBe(E(t, 'fotos-cola-aviso'));
    expect(t.ctx.fotosPozosResumenController_cargar).toHaveBeenCalledWith(true);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
  });

  test('aprobar -> la foto aparece en Retiradas tras el refresco de esa pestaña (no se arma en el cliente)', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.resolver[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
    await flush();
    expect(t.llamadas.retiradas).toHaveLength(0);
    E(t, 'fotos-cola-tab-retiradas').click();
    expect(t.llamadas.retiradas).toHaveLength(1);
    t.pend.retiradas[0](pagina([itemRet(1, { viaSolicitud: true })]));
    await flush();
    expect(lineas(tarjetas(t)[0])[1]).toContain('Retiro aprobado por Marta');
  });

  test('rechazar: confirmacion simple, RECHAZADO, sale de Pendientes y NO toca el contador de la galeria', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Rechazar').click();
    expect(conf(t)).toEqual({ abierto: true, titulo: 'Rechazar retiro', texto: 'La foto seguirá visible en la galería.', boton: 'Rechazar' });
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.resolver[0].slice(0, 3)).toEqual(['tok', uuid(101), 'RECHAZADO']);
    expect(t.llamadas.resolver[0][3]).toMatch(/^foto-res-[0-9a-f-]{36}$/);
    t.pend.resolver[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'RECHAZADO' } });
    await flush();
    expect(tarjetas(t)).toHaveLength(0);
    expect(texto(t, 'fotos-cola-vacio')).toBe('No hay solicitudes de retiro pendientes.');
    expect(texto(t, 'fotos-cola-aviso')).toBe('Retiro rechazado. La foto sigue visible.');
    expect(t.ctx.fotosPozosResumenController_cargar).not.toHaveBeenCalled();
  });

  test('doble clic en confirmar: un solo pedido', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.resolver).toHaveLength(1);
  });

  test('error recuperable: mensaje humano dentro del dialogo y el reintento usa el MISMO id', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.resolver[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'hoja FotosPozoEventos' });
    await flush();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-conf-error')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
    expect(Nodo.enFoco).toBe(E(t, 'fotos-cola-conf-error'));
    expect(E(t, 'btn-fotos-cola-conf-confirmar').disabled).toBe(false);
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.resolver[1][3]).toBe(t.llamadas.resolver[0][3]);
  });

  test('Cancelar / X / Escape cierran sin pedir nada y devuelven el foco al boton de origen; reabrir da un id nuevo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    const aprobar = boton(tarjetas(t)[0], 'Aprobar retiro');
    aprobar.click();
    E(t, 'btn-fotos-cola-conf-cancelar').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(Nodo.enFoco).toBe(aprobar);
    aprobar.click();
    E(t, 'btn-fotos-cola-conf-cerrar').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    aprobar.click();
    const escape = { key: 'Escape', stopPropagation: jest.fn() };
    E(t, 'fotos-cola-conf-overlay').emitir('keydown', escape);
    expect(escape.stopPropagation).toHaveBeenCalled();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(t.llamadas.resolver).toHaveLength(0);
  });

  test('cancelar y reabrir da un id NUEVO; reintentar sin cancelar conserva el mismo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    const aprobar = boton(tarjetas(t)[0], 'Aprobar retiro');
    aprobar.click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.resolver[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    await flush();
    E(t, 'btn-fotos-cola-conf-cancelar').click();
    aprobar.click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.resolver).toHaveLength(2);
    expect(t.llamadas.resolver[1][3]).not.toBe(t.llamadas.resolver[0][3]);
  });

  test('Escape no cierra el dialogo mientras se envia', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    E(t, 'fotos-cola-conf-overlay').emitir('keydown', { key: 'Escape', stopPropagation() {} });
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(false);
  });

  test('Tab rota solo entre los controles habilitados del dialogo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-cancelar').focus();
    E(t, 'fotos-cola-conf-overlay').emitir('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-conf-confirmar'));
    E(t, 'fotos-cola-conf-overlay').emitir('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-conf-cerrar'));
    E(t, 'fotos-cola-conf-overlay').emitir('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-cola-conf-confirmar'));
  });

  test.each([['SOLICITUD_YA_RESUELTA'], ['INVALID_TRANSITION']])('%s (otro moderador ya la resolvio): "La solicitud ya fue resuelta. Actualizamos la lista." y se vuelve a pedir la primera pagina', async (code) => {
    const t = cargar();
    await abrir(t, [itemPend(1), itemPend(2)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.resolver[0]({ status: 'error', code, message: 'detalle tecnico del backend' });
    await flush();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(texto(t, 'fotos-cola-aviso')).toBe('La solicitud ya fue resuelta. Actualizamos la lista.');
    expect(E(t, 'fotos-cola-aviso').className).toContain('fotos-mod-aviso-error');
    expect(t.llamadas.pendientes).toHaveLength(2);
    expect(t.llamadas.pendientes[1]).toEqual(['tok', 20, undefined]);
    expect(Object.keys(t.el).map((id) => t.el[id].textContent).join(' ')).not.toMatch(/detalle tecnico|INVALID_TRANSITION|SOLICITUD_YA_RESUELTA/);
    t.pend.pendientes[1](pagina([itemPend(2)]));
    await flush();
    expect(tarjetas(t)).toHaveLength(1);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al resolver: logout global', async (code) => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.resolver[0]({ status: 'error', code });
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });

  test('reponer: confirmacion con el copy pedido; PRIVACIDAD agrega el aviso de borrado; los demas no', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1, { motivoCodigo: 'PRIVACIDAD', requiereRevisionBorrado: true }), itemRet(2)]);
    boton(tarjetas(t)[0], 'Reponer').click();
    expect(conf(t)).toEqual({ abierto: true, titulo: 'Reponer foto', texto: '¿Querés volver a mostrar esta foto en la galería?', boton: 'Reponer foto' });
    expect(E(t, 'fotos-cola-conf-extra').hidden).toBe(false);
    expect(texto(t, 'fotos-cola-conf-extra')).toBe('También dejará de quedar marcada para revisión de borrado.');
    E(t, 'btn-fotos-cola-conf-cancelar').click();
    boton(tarjetas(t)[1], 'Reponer').click();
    expect(E(t, 'fotos-cola-conf-extra').hidden).toBe(true);
  });

  test('reponer: id foto-rep-<uuid>; exito: sale de Retiradas, vuelve a la galeria (contador) y avisa', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1), itemRet(2)], { total: 2 });
    boton(tarjetas(t)[0], 'Reponer').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    expect(t.llamadas.reponer[0].slice(0, 2)).toEqual(['tok', uuid(1)]);
    expect(t.llamadas.reponer[0][2]).toMatch(/^foto-rep-[0-9a-f-]{36}$/);
    expect(texto(t, 'btn-fotos-cola-conf-confirmar')).toBe('Reponiendo…');
    t.pend.reponer[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false } });
    await flush();
    expect(tarjetas(t).map((li) => lineas(li)[0])).toEqual(['Pozo 14-0002']);
    expect(texto(t, 'fotos-cola-total')).toBe('1 foto retirada');
    expect(texto(t, 'fotos-cola-aviso')).toBe('Foto repuesta en la galería.');
    expect(t.ctx.fotosPozosResumenController_cargar).toHaveBeenCalledWith(true);
  });

  test('una foto repuesta/inexistente (FOTO_NO_RETIRADA): mensaje fijo y la lista se actualiza', async () => {
    const t = cargar();
    await abrir(t, []);
    await irARetiradas(t, [itemRet(1)]);
    boton(tarjetas(t)[0], 'Reponer').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.pend.reponer[0]({ status: 'error', code: 'FOTO_NO_RETIRADA' });
    await flush();
    expect(texto(t, 'fotos-cola-aviso')).toBe('El estado de la foto cambió. Actualizamos la lista.');
    expect(t.llamadas.retiradas).toHaveLength(2);
  });

  test('perdio el permiso con la lista a la vista: aprobar / rechazar / reponer no abren nada', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    t.contexto.permisos = { fotos: true, fotos_carga: true };
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    boton(tarjetas(t)[0], 'Rechazar').click();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(t.llamadas.resolver).toHaveLength(0);
  });
});

describe('cierre y cierre de sesion', () => {
  test('cerrar descarta listas, dialogos, imagenes y avisos; lo que vuelve despues no se pinta', async () => {
    const t = cargar({ imagenManual: true });
    const p = t.ctx.fotosModeracionColaController_abrir();
    t.pend.pendientes[0](pagina([itemPend(1)]));
    await p;
    await flush();
    boton(tarjetas(t)[0], 'Abrir foto').click();
    t.ctx.fotosModeracionColaController_cerrar();
    expect(E(t, 'fotos-cola-vis-overlay').hidden).toBe(true);
    expect(tarjetas(t)).toHaveLength(0);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
    t.pend.imagen.forEach((r) => r({ status: 'ok', data: { mimeType: 'image/jpeg', imagenBase64: 'ZZZZ' } }));
    await flush();
    expect(E(t, 'fotos-cola-vis-img').hidden).toBe(true);
  });

  test('una respuesta de lista que llega despues de cerrar no pinta nada ni dispara el logout', async () => {
    const t = cargar();
    const p = t.ctx.fotosModeracionColaController_abrir();
    t.ctx.fotosModeracionColaController_cerrar();
    t.pend.pendientes[0]({ status: 'error', code: 'UNAUTHORIZED' });
    await p;
    await flush();
    expect(t.sesion).not.toHaveBeenCalled();
    expect(tarjetas(t)).toHaveLength(0);
  });

  test('reset (cerrar sesion) deja todo en blanco, incluida la confirmacion abierta y la que esta en vuelo', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    boton(tarjetas(t)[0], 'Aprobar retiro').click();
    E(t, 'btn-fotos-cola-conf-confirmar').click();
    t.ctx.fotosModeracionColaController_reset();
    t.pend.resolver[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
    await flush();
    expect(E(t, 'fotos-cola-conf-overlay').hidden).toBe(true);
    expect(tarjetas(t)).toHaveLength(0);
    expect(texto(t, 'fotos-cola-aviso')).toBe('');
    expect(t.ctx.fotosPozosResumenController_cargar).not.toHaveBeenCalled();
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
  });

  test('reset: las miniaturas de la sesion anterior no sobreviven (se vuelven a pedir)', async () => {
    const t = cargar();
    await abrir(t, [itemPend(1)]);
    expect(t.llamadas.imagen).toHaveLength(1);
    t.ctx.fotosModeracionColaController_reset();
    await abrir(t, [itemPend(1)]);
    expect(t.llamadas.imagen).toHaveLength(2);
  });

  test('reset antes de inicializar o dos veces seguidas no revienta', () => {
    const t = cargar();
    t.ctx.fotosModeracionColaController_reset();
    t.ctx.fotosModeracionColaController_reset();
    expect(t.ctx.fotosModeracionColaController_hayModalAbierto()).toBe(false);
  });
});

describe('privacidad y estructura', () => {
  test('el controlador no usa innerHTML, no guarda nada en el navegador, no loguea y no maneja ids de Drive', () => {
    expect(codigoControlador).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    expect(codigoControlador).not.toMatch(/console\.|localStorage|sessionStorage|indexedDB|caches\./);
    expect(codigoControlador).not.toMatch(/driveFileId|driveThumbId|drive\.google|googleusercontent/i);
    expect(codigoControlador).not.toMatch(/\.email\b|secuencia|clientRequestId/);
  });

  test('las imagenes solo salen de data: URL y solo del endpoint de moderacion; nunca el normal', () => {
    expect(codigoControlador).toMatch(/'data:' \+ r\.data\.mimeType \+ ';base64,' \+ r\.data\.imagenBase64/);
    expect(codigoControlador).not.toMatch(/apiGetFotoPozo\(/);
    expect(codigoControlador).toMatch(/apiGetFotoPozoModeracion\(c\.sessionToken, fotoId, variante\)/);
  });

  test('no se muestra el message crudo del backend', () => {
    expect(codigoControlador).not.toMatch(/\.message\b(?!\s*===)/);
  });
});
