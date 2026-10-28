// Controlador DOM de la moderacion de fotos (E8-4, ajustado en E8-5): js/fotosModeracion.js ejecutado de verdad con un DOM minimo falso (que LANZA ante innerHTML / insertAdjacentHTML). Cubre quien ve cada boton, el
// modal de sugerencia y el de retiro, los ids, el historial (orden, etiquetas, XSS), la reposicion, la imagen de moderador, la galeria que se refresca desde el backend, el foco y el teclado, y la
// sesion vencida. La logica fina esta en fotosModeracionLogic.test.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const raiz = path.join(__dirname, '..');
const html = leer(raiz, 'index.html');
const fuenteControlador = leer(__dirname, 'fotosModeracion.js');
const codigoControlador = fuenteControlador.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const textoHtml = (id) => { const m = new RegExp('id="' + id + '"[^>]*>([^<]*)<').exec(html); return m ? m[1].trim() : null; };
const fuentes = ['reemplazoLogic.js', 'observacionesPozoLogic.js', 'fotosPozosLogic.js', 'fotosModeracionLogic.js', 'fotosModeracion.js'].map((f) => leer(__dirname, f));

const FOTO = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const W = '14-0001';
const ENTIDAD = { wellId: W, monitoringId: '', etiqueta: W, esNE: false };
const FOTO_GRILLA = { fotoId: FOTO, fuente: 'CAMPO_APP', tipoFoto: 'OTRA', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES', observacion: '', tieneSolicitudRetiro: false };
const CON_SOLICITUD = Object.assign({}, FOTO_GRILLA, { tieneSolicitudRetiro: true });
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };

class Nodo {
  constructor(tag, id) {
    this.tag = tag; this.id = id || ''; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false; this.readOnly = false;
    this.oyentes = {}; this.value = ''; this.attrs = {}; this.isConnected = true; this.src = undefined; this.alt = ''; this.type = '';
    const self = this;
    this.classList = {
      toggle(c, on) { const set = new Set(self.className.split(/\s+/).filter(Boolean)); if (on === undefined ? !set.has(c) : on) { set.add(c); } else { set.delete(c); } self.className = Array.from(set).join(' '); },
      contains(c) { return self.className.split(/\s+/).indexOf(c) >= 0; }
    };
  }
  set textContent(v) { this._texto = String(v); this.children = []; }
  get textContent() { return this._texto + this.children.map((c) => c.textContent).join(''); }
  set innerHTML(_v) { throw new Error('innerHTML prohibido'); }
  insertAdjacentHTML() { throw new Error('insertAdjacentHTML prohibido'); }
  appendChild(c) { this.children.push(c); return c; }
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
  el['btn-fotos-mod-form-enviar'].disabled = true;
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
  const llamadas = { solicitar: [], retirar: [], reponer: [], historial: [], imagen: [], normal: [] };
  const pend = { solicitar: [], retirar: [], reponer: [], historial: [], imagen: [] };
  const mk = (clave) => (...args) => { llamadas[clave].push(args); return new Promise((res) => { pend[clave].push(res); }); };
  ctx.apiSolicitarRetiroFotoPozo = jest.fn(mk('solicitar'));
  ctx.apiRetirarFotoPozo = jest.fn(mk('retirar'));
  ctx.apiReponerFotoPozo = jest.fn(mk('reponer'));
  ctx.apiGetHistorialFotoPozo = jest.fn(mk('historial'));
  ctx.apiGetFotoPozoModeracion = jest.fn((...args) => { llamadas.imagen.push(args); return o.imagen ? o.imagen(...args) : Promise.resolve({ status: 'ok', data: { fotoId: args[1], variante: args[2], mimeType: 'image/jpeg', imagenBase64: 'AAAA' } }); });
  ctx.apiGetFotoPozo = jest.fn((...args) => { llamadas.normal.push(args); return Promise.resolve({ status: 'error', code: 'FOTO_NOT_FOUND' }); });
  const permisos = { fotos: true, fotos_carga: true, fotos_moderar: true };
  const contexto = { sessionToken: 'tok', permisos: Object.assign(permisos, o.permisos || {}) };
  if (o.permisos && o.reemplazarPermisos) { contexto.permisos = o.permisos; }
  const sesion = jest.fn();
  contexto.onSessionExpired = sesion;
  const hooks = {
    refrescar: jest.fn(() => Promise.resolve(true)),
    cerrarVisor: jest.fn(() => { ctx.fotosModeracionController_alMostrarFoto(null); })
  };
  fuentes.forEach((src) => vm.runInContext(src, ctx));
  ctx.fotosModeracionController_inicializar(() => contexto, hooks);
  ctx.fotosModeracionController_alAbrir(ENTIDAD);
  return { el, ctx, contexto, llamadas, pend, sesion, hooks, bodyClases };
}

function conPermisos(p) {
  return cargar({ permisos: p, reemplazarPermisos: true });
}

const respOk = (extra) => ({ status: 'ok', data: Object.assign({ fotoId: FOTO, duplicada: false }, extra || {}) });
const respErr = (code) => ({ status: 'error', code: code, message: 'crudo del backend: hoja FotosPozoEventos' });
const evento = (extra) => Object.assign({ evento: 'RETIRADA', solicitudId: '', resolucion: '', motivoCodigo: 'DUPLICADA', motivoTexto: '', nombre: 'Marta', timestampUtc: '2026-10-27T15:00:00.000Z' }, extra || {});
function historialOk(eventos, estado) {
  return {
    status: 'ok',
    data: {
      foto: { fotoId: FOTO, entidadTipo: 'WELL', entidadId: W, tipoFoto: 'OTRA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' },
      estado: Object.assign({ estado: 'RETIRADA', visible: false, solicitudAbierta: null, puedeReponerse: true, requiereRevisionBorrado: false, integridad: 'OK', origenRetiro: 'EVENTO', inconsistencias: [] }, estado || {}),
      eventos: eventos
    }
  };
}

const E = (t, id) => t.el[id];
const sugerir = (t) => E(t, 'btn-fotos-mod-sugerir');
const retirar = (t) => E(t, 'btn-fotos-mod-retirar');
const verHistorial = (t) => E(t, 'btn-fotos-mod-historial');
const enviar = (t) => E(t, 'btn-fotos-mod-form-enviar');
const elegirMotivo = (t, codigo) => { E(t, 'fotos-mod-motivo').value = codigo; E(t, 'fotos-mod-motivo').emitir('change'); };
const escribirDetalle = (t, texto) => { E(t, 'fotos-mod-detalle').value = texto; E(t, 'fotos-mod-detalle').emitir('input'); };
const enviarForm = (t) => { E(t, 'fotos-mod-form').emitir('submit', { preventDefault() {} }); };
const abrirVisor = (t, foto) => t.ctx.fotosModeracionController_alMostrarFoto(foto || FOTO_GRILLA);
const abiertoForm = (t) => !E(t, 'fotos-mod-form-overlay').hidden;
const abiertoHist = (t) => !E(t, 'fotos-mod-hist-overlay').hidden;
const texto = (t, id) => E(t, id).textContent;
const visibles = (t) => ({ sugerir: !sugerir(t).hidden, retirar: !retirar(t).hidden, historial: !verHistorial(t).hidden });

async function abrirHistorialConDatos(t, eventos, estado) {
  abrirVisor(t);
  verHistorial(t).click();
  t.pend.historial[t.pend.historial.length - 1](historialOk(eventos || [evento()], estado));
  await flush();
}

describe('quien ve cada accion en el visor', () => {
  test('solo fotos: ninguna accion (ni sugerir ni moderar)', () => {
    const t = conPermisos({ fotos: true });
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    expect(E(t, 'fotos-mod-visor-acciones').hidden).toBe(true);
  });

  test('fotos + fotos_carga: solo "Sugerir retiro"; no puede retirar ni ver historial', () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: true, retirar: false, historial: false });
    expect(E(t, 'fotos-mod-visor-acciones').hidden).toBe(false);
  });

  test('fotos + fotos_moderar: "Retirar foto" y "Ver historial"; no sugiere', () => {
    const t = conPermisos({ fotos: true, fotos_moderar: true });
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: true, historial: true });
  });

  test('todos los permisos: todas las acciones', () => {
    const t = cargar();
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: true, retirar: true, historial: true });
  });

  test('fotos_carga o fotos_moderar sin fotos: nada', () => {
    [{ fotos_carga: true, fotos_moderar: true }, { fotos: false, fotos_carga: true, fotos_moderar: true }].forEach((p) => {
      const t = conPermisos(p);
      abrirVisor(t);
      expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    });
  });

  test.each([['SI'], [1], ['true'], [{}]])('permisos truthy que no son el booleano true (%j): ninguna accion', (v) => {
    const t = conPermisos({ fotos: v, fotos_carga: v, fotos_moderar: v });
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    const u = conPermisos({ fotos: true, fotos_carga: v, fotos_moderar: v });
    abrirVisor(u);
    expect(visibles(u)).toEqual({ sugerir: false, retirar: false, historial: false });
  });

  test('sin foto en el visor no hay acciones; el nombre o la autoria no dan permisos', () => {
    const t = cargar();
    t.ctx.fotosModeracionController_alMostrarFoto(null);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    const u = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(u, Object.assign({}, FOTO_GRILLA, { emailUsuarioCarga: 'yo@x.com', nombre: 'Moderador' }));
    expect(visibles(u).retirar).toBe(false);
  });

  test('si el permiso se pierde (permisos de HOY), los botones se corrigen al reabrir', () => {
    const t = cargar();
    abrirVisor(t);
    expect(visibles(t).retirar).toBe(true);
    t.contexto.permisos = { fotos: true };
    abrirVisor(t);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
  });
});

describe('sugerir retiro (fotos + fotos_carga)', () => {
  test('modal propio: titulo, texto, motivos con etiquetas humanas, botones', () => {
    const t = cargar({ permisos: { fotos: true, fotos_carga: true }, reemplazarPermisos: true });
    abrirVisor(t);
    sugerir(t).click();
    expect(abiertoForm(t)).toBe(true);
    expect(texto(t, 'fotos-mod-form-titulo')).toBe('Sugerir retiro de foto');
    expect(texto(t, 'fotos-mod-form-intro')).toBe('Indicá por qué pensás que esta foto debería dejar de mostrarse.');
    const opciones = E(t, 'fotos-mod-motivo').children.map((c) => c.textContent);
    expect(opciones).toEqual(['Elegí un motivo', 'No corresponde al pozo', 'Duplicada', 'Mala calidad', 'Sin contenido útil', 'Privacidad', 'Desactualizada', 'Otro']);
    expect(E(t, 'fotos-mod-motivo').children.map((c) => c.value)).toEqual(['', 'NO_CORRESPONDE_POZO', 'DUPLICADA', 'MALA_CALIDAD', 'SIN_CONTENIDO_UTIL', 'PRIVACIDAD', 'DESACTUALIZADA', 'OTRO']);
    expect(texto(t, 'btn-fotos-mod-form-enviar')).toBe('Enviar sugerencia');
    expect(textoHtml('btn-fotos-mod-form-cancelar')).toBe('Cancelar');
    expect(texto(t, 'fotos-mod-detalle-label')).toBe('Detalle (opcional)');
    expect(enviar(t).disabled).toBe(true);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(true);
  });

  test('foco inicial en el motivo', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    expect(Nodo.enFoco).toBe(E(t, 'fotos-mod-motivo'));
  });

  test('el aviso de privacidad NO aparece en la sugerencia, ni siquiera con PRIVACIDAD', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'PRIVACIDAD');
    expect(E(t, 'fotos-mod-privacidad').hidden).toBe(true);
  });

  test('motivo obligatorio: sin motivo no se puede enviar y no se llama a la red', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    enviarForm(t);
    await flush();
    expect(t.llamadas.solicitar).toHaveLength(0);
    expect(texto(t, 'fotos-mod-form-error')).toBe('Elegí un motivo.');
    expect(E(t, 'fotos-mod-motivo').attrs['aria-invalid']).toBe('true');
  });

  test('OTRO: detalle obligatorio (etiqueta y validacion); limites 3..300', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'OTRO');
    expect(texto(t, 'fotos-mod-detalle-label')).toBe('Detalle (obligatorio)');
    expect(enviar(t).disabled).toBe(true);
    escribirDetalle(t, 'ab');
    expect(enviar(t).disabled).toBe(true);
    escribirDetalle(t, 'abc');
    expect(enviar(t).disabled).toBe(false);
    escribirDetalle(t, 'a'.repeat(301));
    expect(enviar(t).disabled).toBe(true);
    expect(texto(t, 'fotos-mod-contador')).toBe('301 / 300 · te pasaste por 1');
    expect(E(t, 'fotos-mod-contador').className).toContain('fotos-mod-contador-excede');
    expect(t.llamadas.solicitar).toHaveLength(0);
  });

  test('exito: envia con id foto-sol-<uuid>, cierra el modal, NO oculta la foto (no cierra el visor), muestra "Retiro sugerido" y VUELVE A PEDIR la galeria al backend', async () => {
    const t = cargar({ permisos: { fotos: true, fotos_carga: true }, reemplazarPermisos: true });
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'OTRO');
    escribirDetalle(t, 'no es el pozo');
    enviarForm(t);
    expect(t.llamadas.solicitar).toHaveLength(1);
    const [token, fotoId, codigo, textoEnviado, id] = t.llamadas.solicitar[0];
    expect([token, fotoId, codigo, textoEnviado]).toEqual(['tok', FOTO, 'OTRO', 'no es el pozo']);
    expect(id).toMatch(/^foto-sol-[0-9a-f-]{36}$/);
    expect(texto(t, 'btn-fotos-mod-form-enviar')).toBe('Enviando…');
    t.pend.solicitar[0](respOk({ solicitudId: 'sol-1' }));
    await flush();
    expect(abiertoForm(t)).toBe(false);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);          // el estado real lo trae el backend (tieneSolicitudRetiro), no una copia local
    expect(t.hooks.cerrarVisor).not.toHaveBeenCalled();
    expect(sugerir(t).hidden).toBe(true);
    expect(E(t, 'fotos-mod-visor-estado').hidden).toBe(false);
    expect(texto(t, 'fotos-mod-visor-estado')).toBe('Retiro sugerido');
    expect(Nodo.enFoco).toBe(E(t, 'fotos-mod-visor-estado'));
  });

  test('"Retiro sugerido" sale del booleano del backend: con tieneSolicitudRetiro === true no se ofrece sugerir otra vez y se ve el estado', () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(t, CON_SOLICITUD);
    expect(sugerir(t).hidden).toBe(true);
    expect(E(t, 'fotos-mod-visor-estado').hidden).toBe(false);
    expect(texto(t, 'fotos-mod-visor-estado')).toBe('Retiro sugerido');
    expect(E(t, 'fotos-mod-visor-acciones').hidden).toBe(true);
    abrirVisor(t, FOTO_GRILLA);
    expect(sugerir(t).hidden).toBe(false);
    expect(E(t, 'fotos-mod-visor-estado').hidden).toBe(true);
  });

  test('NO hay memoria de sesion: tras sugerir, una foto que el backend aun no marca (sin flag) vuelve a ofrecer "Sugerir retiro"', async () => {
    const t = cargar({ permisos: { fotos: true, fotos_carga: true }, reemplazarPermisos: true });
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respOk());
    await flush();
    abrirVisor(t);
    expect(sugerir(t).hidden).toBe(false);
    expect(texto(t, 'fotos-mod-visor-estado')).toBe('');
    expect(codigoControlador).not.toMatch(/sugeridas/);
  });

  test('solo el booleano EXACTO true marca la solicitud (truthy no alcanza)', () => {
    ['true', 1, 'SI', {}].forEach((v) => {
      const t = conPermisos({ fotos: true, fotos_carga: true });
      abrirVisor(t, Object.assign({}, FOTO_GRILLA, { tieneSolicitudRetiro: v }));
      expect(sugerir(t).hidden).toBe(false);
      expect(t.ctx.fotosModeracionController_etiquetaItem(Object.assign({}, FOTO_GRILLA, { tieneSolicitudRetiro: v }))).toBe('');
    });
  });

  test('etiqueta de la miniatura: sale del flag de ESA foto y solo la ve quien puede sugerir o moderar', () => {
    const carga = conPermisos({ fotos: true, fotos_carga: true });
    expect(carga.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('Retiro sugerido');
    expect(carga.ctx.fotosModeracionController_etiquetaItem(FOTO_GRILLA)).toBe('');
    expect(carga.ctx.fotosModeracionController_etiquetaItem(null)).toBe('');
    expect(carga.ctx.fotosModeracionController_etiquetaItem(undefined)).toBe('');
    const mod = conPermisos({ fotos: true, fotos_moderar: true });
    expect(mod.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('Retiro sugerido');
    const lector = conPermisos({ fotos: true });
    expect(lector.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('');
    const sinFotos = conPermisos({ fotos_carga: true });
    expect(sinFotos.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('');
  });

  test('el moderador con una solicitud abierta: no ve "Retirar foto" (se resuelve en Fotos pendientes) pero si "Ver historial"; el estado lo orienta', () => {
    const t = conPermisos({ fotos: true, fotos_moderar: true });
    abrirVisor(t, CON_SOLICITUD);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: true });
    expect(texto(t, 'fotos-mod-visor-estado')).toBe('Retiro sugerido. Resolvelo desde Fotos pendientes.');
    const ambos = cargar();
    abrirVisor(ambos, CON_SOLICITUD);
    expect(visibles(ambos)).toEqual({ sugerir: false, retirar: false, historial: true });
    abrirVisor(ambos, FOTO_GRILLA);
    expect(visibles(ambos)).toEqual({ sugerir: true, retirar: true, historial: true });
  });

  test('un lector (solo fotos) no ve el estado de la solicitud ni ninguna accion', () => {
    const t = conPermisos({ fotos: true });
    abrirVisor(t, CON_SOLICITUD);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    expect(E(t, 'fotos-mod-visor-estado').hidden).toBe(true);
  });

  test('doble clic: un solo pedido; el boton queda deshabilitado mientras se envia', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    enviarForm(t);
    enviar(t).click();
    expect(t.llamadas.solicitar).toHaveLength(1);
    expect(enviar(t).disabled).toBe(true);
    expect(E(t, 'btn-fotos-mod-form-cancelar').disabled).toBe(true);
    expect(E(t, 'btn-fotos-mod-form-cerrar').disabled).toBe(true);
    expect(E(t, 'fotos-mod-motivo').disabled).toBe(true);
    expect(E(t, 'fotos-mod-detalle').readOnly).toBe(true);
  });

  test('error recuperable: mensaje humano, el texto se conserva y el reintento usa el MISMO id; si cambia el contenido, id nuevo', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'OTRO');
    escribirDetalle(t, 'texto que no se pierde');
    enviarForm(t);
    t.pend.solicitar[0](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(abiertoForm(t)).toBe(true);
    expect(texto(t, 'fotos-mod-form-error')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
    expect(E(t, 'fotos-mod-detalle').value).toBe('texto que no se pierde');
    expect(texto(t, 'fotos-mod-form-error')).not.toMatch(/FotosPozoEventos|SERVICE_UNAVAILABLE|hoja/);
    enviarForm(t);
    t.pend.solicitar[1](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(t.llamadas.solicitar[1][4]).toBe(t.llamadas.solicitar[0][4]);
    escribirDetalle(t, 'otro texto distinto');
    enviarForm(t);
    expect(t.llamadas.solicitar[2][4]).not.toBe(t.llamadas.solicitar[0][4]);
    expect(t.llamadas.solicitar[2][4]).toMatch(/^foto-sol-/);
  });

  test('IDEMPOTENCY_CONFLICT pide revisar y reintentar; el siguiente envio usa un id nuevo', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respErr('IDEMPOTENCY_CONFLICT'));
    await flush();
    expect(texto(t, 'fotos-mod-form-error')).toBe('La acción cambió después de un intento anterior. Revisá los datos e intentá nuevamente.');
    expect(t.llamadas.solicitar).toHaveLength(1);
    enviarForm(t);
    expect(t.llamadas.solicitar[1][4]).not.toBe(t.llamadas.solicitar[0][4]);
  });

  test('segunda sugerencia (el backend la rechaza): se cierra, se explica y la galeria se actualiza con el estado real (sin cerrar el visor)', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respErr('SOLICITUD_YA_ABIERTA'));
    await flush();
    expect(abiertoForm(t)).toBe(false);
    expect(texto(t, 'fotos-mod-visor-estado')).toBe('Esta foto ya tiene una solicitud de retiro pendiente.');
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
    expect(t.hooks.cerrarVisor).not.toHaveBeenCalled();
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
  });

  test.each([['FOTO_NOT_FOUND', 'La foto ya no está disponible.'], ['INVALID_TRANSITION', 'El estado de la foto cambió. Actualizamos la galería.'], ['FOTO_YA_RETIRADA', 'El estado de la foto cambió. Actualizamos la galería.']])('%s: la foto cambio -> se cierra el modal y el visor, se avisa y se refresca la galeria', async (code, mensaje) => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respErr(code));
    await flush();
    expect(abiertoForm(t)).toBe(false);
    expect(t.hooks.cerrarVisor).toHaveBeenCalledTimes(1);
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
    expect(texto(t, 'fotos-mod-aviso')).toBe(mensaje);
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(false);
    expect(E(t, 'fotos-mod-aviso').className).toContain('fotos-mod-aviso-error');
  });

  test('PERMISSION_DENIED en el servidor: "Ya no tenés permiso..." dentro del modal', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respErr('PERMISSION_DENIED'));
    await flush();
    expect(texto(t, 'fotos-mod-form-error')).toBe('Ya no tenés permiso para realizar esta acción.');
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: usa el cierre de sesion global; no se muestra como error normal', async (code) => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respErr(code));
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
    expect(t.hooks.refrescar).not.toHaveBeenCalled();
  });

  test('cancelar descarta todo; reabrir empieza limpio con id nuevo', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'OTRO');
    escribirDetalle(t, 'algo');
    E(t, 'btn-fotos-mod-form-cancelar').click();
    expect(abiertoForm(t)).toBe(false);
    expect(Nodo.enFoco).toBe(sugerir(t));
    sugerir(t).click();
    expect(E(t, 'fotos-mod-motivo').value).toBe('');
    expect(E(t, 'fotos-mod-detalle').value).toBe('');
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    const ids = t.llamadas.solicitar.map((c) => c[4]);
    expect(ids).toHaveLength(1);
  });
});

describe('retirar foto (fotos + fotos_moderar)', () => {
  test('modal claramente distinto: titulo, copy, boton; mismo catalogo de motivos', () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    expect(abiertoForm(t)).toBe(true);
    expect(texto(t, 'fotos-mod-form-titulo')).toBe('Retirar foto');
    expect(texto(t, 'fotos-mod-form-intro')).toBe('Esta foto dejará de mostrarse en la galería. El archivo no se eliminará.');
    expect(texto(t, 'btn-fotos-mod-form-enviar')).toBe('Retirar foto');
    expect(E(t, 'fotos-mod-motivo').children).toHaveLength(8);
    expect(E(t, 'fotos-mod-form-overlay').className).toContain('fotos-mod-overlay-retirar');
    sugerir(t).click();
    expect(texto(t, 'fotos-mod-form-titulo')).toBe('Sugerir retiro de foto');
    expect(E(t, 'fotos-mod-form-overlay').className).not.toContain('fotos-mod-overlay-retirar');
  });

  test('PRIVACIDAD agrega un aviso discreto (sin decir que se borrara); otro motivo lo saca', () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    expect(E(t, 'fotos-mod-privacidad').hidden).toBe(true);
    elegirMotivo(t, 'PRIVACIDAD');
    expect(E(t, 'fotos-mod-privacidad').hidden).toBe(false);
    expect(textoHtml('fotos-mod-privacidad')).toBe('Quedará marcada para revisión de borrado.');
    expect(textoHtml('fotos-mod-privacidad')).not.toMatch(/se borrar[aá]\b|eliminar/i);
    elegirMotivo(t, 'DUPLICADA');
    expect(E(t, 'fotos-mod-privacidad').hidden).toBe(true);
  });

  test('exito: id foto-ret-<uuid>, cierra el modal y el visor y VUELVE A PEDIR la galeria al backend (sin bandeja de sesion)', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'PRIVACIDAD');
    enviarForm(t);
    expect(t.llamadas.retirar).toHaveLength(1);
    expect(t.llamadas.retirar[0].slice(0, 4)).toEqual(['tok', FOTO, 'PRIVACIDAD', undefined]);
    expect(t.llamadas.retirar[0][4]).toMatch(/^foto-ret-[0-9a-f-]{36}$/);
    expect(t.llamadas.solicitar).toHaveLength(0);
    t.pend.retirar[0](respOk());
    await flush();
    expect(abiertoForm(t)).toBe(false);
    expect(t.hooks.cerrarVisor).toHaveBeenCalledTimes(1);
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
    expect(texto(t, 'fotos-mod-aviso')).toBe('Foto retirada. El archivo no se eliminó.');
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    expect(Nodo.enFoco).toBe(E(t, 'fotos-mod-aviso'));
  });

  test('la galeria NO pide ninguna imagen de la foto retirada (ni con el endpoint normal ni con el de moderacion): las retiradas se ven en Fotos pendientes', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respOk());
    await flush();
    expect(t.llamadas.imagen).toHaveLength(0);
    expect(t.llamadas.normal).toHaveLength(0);
    expect(html).not.toContain('fotos-mod-retiradas');
  });

  test('la foto retirada NO queda como activa en el frontend: no hay copia optimista (se cerro el visor y la galeria depende del refresco)', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respOk());
    await flush();
    expect(t.hooks.refrescar).toHaveBeenCalled();
    expect(codigoControlador).not.toMatch(/splice|estado\.fotos\b/);
  });

  test('doble clic: un solo pedido', () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    enviarForm(t);
    expect(t.llamadas.retirar).toHaveLength(1);
  });

  test('retry tras SERVICE_UNAVAILABLE: mismo id; luego cambio de motivo: id nuevo', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(texto(t, 'fotos-mod-form-error')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
    enviarForm(t);
    expect(t.llamadas.retirar[1][4]).toBe(t.llamadas.retirar[0][4]);
    t.pend.retirar[1](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    elegirMotivo(t, 'MALA_CALIDAD');
    enviarForm(t);
    expect(t.llamadas.retirar[2][4]).not.toBe(t.llamadas.retirar[0][4]);
  });

  test('si igual llega SOLICITUD_ABIERTA (la solicitud se abrio despues de pintar la galeria), el moderador ve el mensaje y el modal sigue', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respErr('SOLICITUD_ABIERTA'));
    await flush();
    expect(abiertoForm(t)).toBe(true);
    expect(texto(t, 'fotos-mod-form-error')).toBe('Esta foto ya tiene una solicitud de retiro pendiente.');
    expect(t.hooks.refrescar).not.toHaveBeenCalled();
  });

  test('SERVICE_UNAVAILABLE (por ejemplo en desarrollo, sin la hoja de eventos): mensaje humano y NO se oculta nada en el frontend', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(abiertoForm(t)).toBe(true);
    expect(t.hooks.cerrarVisor).not.toHaveBeenCalled();
    expect(texto(t, 'fotos-mod-form-error')).not.toMatch(/FotosPozoEventos|SERVICE_UNAVAILABLE|hoja/);
  });

  test('sesion vencida al retirar: logout global', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respErr('UNAUTHORIZED'));
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });

  test('quien no es moderador no puede abrir el retiro ni aunque el boton fuera accesible', () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(t);
    retirar(t).hidden = false;           // alguien destapa el boton con las herramientas del navegador
    retirar(t).click();
    expect(abiertoForm(t)).toBe(false);
    expect(t.llamadas.retirar).toHaveLength(0);
  });

  test('tras un retiro exitoso la UI del moderador no conserva nada de la foto: ni bandeja ni lista local', () => {
    expect(codigoControlador).not.toMatch(/retiradas|agregarRetirada|quitarRetirada|bandeja/i);
  });
});

describe('historial (solo moderadores)', () => {
  test('abre desde el visor, pide el historial de esa foto y muestra los eventos mas reciente primero con etiquetas humanas', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t, [
      evento({ evento: 'REPUESTA', motivoCodigo: '', nombre: 'Ana', timestampUtc: '2026-10-27T18:00:00.000Z' }),
      evento({ evento: 'RETIRO_RESUELTO', resolucion: 'APROBADO', motivoCodigo: '', nombre: 'Luis', timestampUtc: '2026-10-27T17:00:00.000Z' }),
      evento({ evento: 'RETIRO_RESUELTO', resolucion: 'RECHAZADO', motivoCodigo: '', nombre: 'Luis', timestampUtc: '2026-10-27T16:00:00.000Z' }),
      evento({ evento: 'RETIRADA', motivoCodigo: 'PRIVACIDAD', timestampUtc: '2026-10-27T15:00:00.000Z' }),
      evento({ evento: 'RETIRO_SOLICITADO', motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara', nombre: 'Rosa', timestampUtc: '2026-10-27T14:00:00.000Z' })
    ]);
    expect(t.llamadas.historial).toEqual([['tok', FOTO]]);
    expect(abiertoHist(t)).toBe(true);
    const items = E(t, 'fotos-mod-hist-lista').children;
    expect(items.map((li) => li.children[0].textContent)).toEqual(['Foto repuesta', 'Retiro aprobado', 'Retiro rechazado', 'Foto retirada', 'Retiro sugerido']);
    expect(items[0].children[1].textContent).toBe('Ana · 27/10/2026 15:00');
    expect(items[3].children[2].textContent).toBe('Motivo: Privacidad');
    expect(items[4].children[2].textContent).toBe('Motivo: Otro');
    expect(items[4].children[3].textContent).toBe('se ve una cara');
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-mod-hist-cerrar'));
  });

  test('NO muestra email, clientRequestId, secuencia, ids ni codigos crudos', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t, [Object.assign(evento({ evento: 'RETIRADA', motivoCodigo: 'MALA_CALIDAD' }), { email: 'secreto@x.com', clientRequestId: 'foto-ret-abc', secuencia: 9, eventoId: 'ev-7' })]);
    const lista = E(t, 'fotos-mod-hist-lista').textContent + E(t, 'fotos-mod-hist-insignias').textContent + E(t, 'fotos-mod-hist-detalle').textContent + E(t, 'fotos-mod-hist-fecha').textContent;
    expect(lista).not.toMatch(/secreto@x|foto-ret-abc|ev-7|MALA_CALIDAD|RETIRADA|RETIRO_|REPUESTA|OK\b|EVENTO|WELL/);
    expect(lista).toContain('Mala calidad');
  });

  test('XSS: HTML, script, ampersand, emoji y multilinea se pintan como TEXTO (textContent), sin innerHTML', async () => {
    const t = cargar();
    const raro = '<img src=x onerror=alert(1)> & <script>alert(2)</script>\n\u{1F600} segunda linea';
    await abrirHistorialConDatos(t, [evento({ evento: 'RETIRADA', motivoTexto: raro, nombre: '<b>Marta</b>' })]);
    const li = E(t, 'fotos-mod-hist-lista').children[0];
    expect(li.children[3].textContent).toBe(raro);
    expect(li.children[1].textContent).toContain('<b>Marta</b>');
    expect(li.children[3].tag).toBe('p');
    expect(li.children.every((c) => c.children.length === 0)).toBe(true);
    expect(codigoControlador).not.toMatch(/innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
  });

  test('historial largo: todos los eventos, sin cortar', async () => {
    const t = cargar();
    const muchos = [];
    for (let i = 0; i < 60; i += 1) { muchos.push(evento({ nombre: 'Persona ' + i })); }
    await abrirHistorialConDatos(t, muchos);
    expect(E(t, 'fotos-mod-hist-lista').children).toHaveLength(60);
  });

  test('vacio: sin eventos', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t, [], { estado: 'ACTIVA', puedeReponerse: false });
    expect(E(t, 'fotos-mod-hist-lista').children).toHaveLength(0);
    expect(E(t, 'fotos-mod-hist-vacio').hidden).toBe(false);
  });

  test('error: mensaje humano (sin codigos ni hoja), reintentar no existe como boton raw; cerrar vuelve el foco al disparador', async () => {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    expect(E(t, 'fotos-mod-hist-cargando').hidden).toBe(false);
    t.pend.historial[0](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(texto(t, 'fotos-mod-hist-error')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
    expect(texto(t, 'fotos-mod-hist-error')).not.toMatch(/FotosPozoEventos|hoja/);
    expect(E(t, 'fotos-mod-hist-contenido').hidden).toBe(true);
    E(t, 'btn-fotos-mod-hist-cerrar2').click();
    expect(abiertoHist(t)).toBe(false);
    expect(Nodo.enFoco).toBe(verHistorial(t));
  });

  test('FOTO_NOT_FOUND en el historial: "La foto ya no está disponible."', async () => {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    t.pend.historial[0](respErr('FOTO_NOT_FOUND'));
    await flush();
    expect(texto(t, 'fotos-mod-hist-error')).toBe('La foto ya no está disponible.');
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al pedir el historial: logout global', async (code) => {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    t.pend.historial[0](respErr(code));
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });

  test('la imagen sale del endpoint de moderacion (miniatura), nunca del normal', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t);
    expect(t.llamadas.imagen).toEqual([['tok', FOTO, 'thumb']]);
    expect(t.llamadas.normal).toHaveLength(0);
    expect(E(t, 'fotos-mod-hist-img').src).toBe('data:image/jpeg;base64,AAAA');
    expect(E(t, 'fotos-mod-hist-img').hidden).toBe(false);
  });

  test('si la imagen falla (storage), se explica y el historial se sigue viendo', async () => {
    const t = cargar({ imagen: () => Promise.resolve({ status: 'error', code: 'STORAGE_UNAVAILABLE' }) });
    await abrirHistorialConDatos(t);
    expect(E(t, 'fotos-mod-hist-img-error').hidden).toBe(false);
    expect(texto(t, 'fotos-mod-hist-img-error')).toBe('No se pudo cargar la imagen. Intentá nuevamente.');
    expect(E(t, 'fotos-mod-hist-lista').children).toHaveLength(1);
  });

  test('foto retirada por PRIVACIDAD: "Pendiente de revisión de borrado" (solo en este contexto de moderador)', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t, [evento({ motivoCodigo: 'PRIVACIDAD' })], { requiereRevisionBorrado: true });
    expect(E(t, 'fotos-mod-hist-insignias').children.map((c) => c.textContent)).toEqual(['Foto retirada', 'Pendiente de revisión de borrado']);
  });

  test('el aviso de borrado no aparece en ninguna superficie de un usuario normal', () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'PRIVACIDAD');
    const visible = Object.keys(t.el).filter((id) => !t.el[id].hidden).map((id) => t.el[id].textContent).join(' ');
    expect(visible).not.toMatch(/revisión de borrado/);
  });

  test('un usuario sin fotos_moderar no puede abrir el historial aunque destape el boton', () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    abrirVisor(t);
    verHistorial(t).hidden = false;
    verHistorial(t).click();
    expect(t.llamadas.historial).toHaveLength(0);
    expect(abiertoHist(t)).toBe(false);
  });

  test('una respuesta que llega despues de cerrar no reabre ni pinta nada', async () => {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    E(t, 'btn-fotos-mod-hist-cerrar2').click();
    t.pend.historial[0](historialOk([evento()]));
    await flush();
    expect(abiertoHist(t)).toBe(false);
    expect(E(t, 'fotos-mod-hist-lista').children).toHaveLength(0);
  });
});

describe('reposicion', () => {
  async function conRetirada(estadoExtra) {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    t.pend.historial[0](historialOk([evento()], estadoExtra));
    await flush();
    return t;
  }

  test('historial -> "Reponer foto" -> confirmacion con el copy pedido', async () => {
    const t = await conRetirada();
    expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(false);
    E(t, 'btn-fotos-mod-hist-reponer').click();
    expect(E(t, 'fotos-mod-rep-confirmar').hidden).toBe(false);
    expect(textoHtml('fotos-mod-rep-pregunta')).toBe('¿Querés volver a mostrar esta foto en la galería?');
    expect(html).toContain('Las fotos ocultas históricamente no pueden reponerse desde este flujo.');
    expect(E(t, 'fotos-mod-hist-botones').hidden).toBe(true);
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-mod-rep-cancelar'));
    expect(t.llamadas.reponer).toHaveLength(0);
  });

  test('confirmar: id foto-rep-<uuid>, sin motivo; exito -> cierra, refresca la galeria y avisa', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    expect(t.llamadas.reponer).toHaveLength(1);
    expect(t.llamadas.reponer[0].slice(0, 2)).toEqual(['tok', FOTO]);
    expect(t.llamadas.reponer[0][2]).toMatch(/^foto-rep-[0-9a-f-]{36}$/);
    expect(texto(t, 'btn-fotos-mod-rep-confirmar')).toBe('Reponiendo…');
    t.hooks.refrescar.mockClear();
    t.pend.reponer[0](respOk());
    await flush();
    expect(abiertoHist(t)).toBe(false);
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
    expect(texto(t, 'fotos-mod-aviso')).toBe('Foto repuesta en la galería.');
    expect(t.ctx.fotosModeracionController_hayModalAbierto()).toBe(false);
  });

  test('doble clic en confirmar: un solo pedido', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    expect(t.llamadas.reponer).toHaveLength(1);
    expect(E(t, 'btn-fotos-mod-rep-confirmar').disabled).toBe(true);
  });

  test('cancelar la confirmacion vuelve al historial sin pedir nada', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-cancelar').click();
    expect(E(t, 'fotos-mod-rep-confirmar').hidden).toBe(true);
    expect(E(t, 'fotos-mod-hist-botones').hidden).toBe(false);
    expect(abiertoHist(t)).toBe(true);
    expect(t.llamadas.reponer).toHaveLength(0);
  });

  test('una OCULTA legacy o una foto activa NO ofrecen "Reponer foto"', async () => {
    for (const estado of [{ origenRetiro: 'LEGACY_OCULTA', puedeReponerse: false }, { estado: 'ACTIVA', puedeReponerse: false }, { puedeReponerse: false }]) {
      const t = await conRetirada(estado);
      expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(true);
    }
  });

  test('desde el visor de una foto activa tampoco hay reposicion', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t, [evento({ evento: 'REPUESTA' })], { estado: 'ACTIVA', puedeReponerse: false });
    expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(true);
  });

  test('FOTO_NO_RETIRADA (otro moderador ya la repuso): se cierra, se avisa y se refresca', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.hooks.refrescar.mockClear();
    t.pend.reponer[0](respErr('FOTO_NO_RETIRADA'));
    await flush();
    expect(abiertoHist(t)).toBe(false);
    expect(texto(t, 'fotos-mod-aviso')).toBe('El estado de la foto cambió. Actualizamos la galería.');
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
  });

  test('REPOSICION_NO_PERMITIDA: el error se explica dentro de la confirmacion', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.pend.reponer[0](respErr('REPOSICION_NO_PERMITIDA'));
    await flush();
    expect(abiertoHist(t)).toBe(true);
    expect(texto(t, 'fotos-mod-rep-error')).toBe('Las fotos ocultas históricamente no pueden reponerse desde este flujo.');
  });

  test('SERVICE_UNAVAILABLE: mensaje humano y reintento con el MISMO id', async () => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.pend.reponer[0](respErr('SERVICE_UNAVAILABLE'));
    await flush();
    expect(texto(t, 'fotos-mod-rep-error')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    expect(t.llamadas.reponer[1][2]).toBe(t.llamadas.reponer[0][2]);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al reponer: logout global', async (code) => {
    const t = await conRetirada();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.pend.reponer[0](respErr(code));
    await flush();
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });
});

describe('teclado, foco y bloqueo', () => {
  test('Escape cierra el modal, no se propaga al visor y devuelve el foco al boton; mientras se envia no cierra', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    let propagado = true;
    E(t, 'fotos-mod-form-overlay').emitir('keydown', { key: 'Escape', stopPropagation() { propagado = false; } });
    expect(propagado).toBe(false);
    expect(abiertoForm(t)).toBe(false);
    expect(Nodo.enFoco).toBe(sugerir(t));
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    E(t, 'fotos-mod-form-overlay').emitir('keydown', { key: 'Escape', stopPropagation() {} });
    expect(abiertoForm(t)).toBe(true);
  });

  test('Tab / Shift+Tab rotan dentro del modal', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    const orden = ['btn-fotos-mod-form-cerrar', 'fotos-mod-motivo', 'fotos-mod-detalle', 'btn-fotos-mod-form-cancelar', 'btn-fotos-mod-form-enviar'].map((id) => E(t, id));
    Nodo.enFoco = orden[4];
    let evitado = false;
    E(t, 'fotos-mod-form-overlay').emitir('keydown', { key: 'Tab', shiftKey: false, preventDefault() { evitado = true; } });
    expect(evitado).toBe(true);
    expect(Nodo.enFoco).toBe(orden[0]);
    E(t, 'fotos-mod-form-overlay').emitir('keydown', { key: 'Tab', shiftKey: true, preventDefault() {} });
    expect(Nodo.enFoco).toBe(orden[4]);
  });

  test('el historial tambien: Escape cierra y Tab no se escapa', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t);
    Nodo.enFoco = E(t, 'btn-fotos-mod-hist-cerrar2');
    E(t, 'fotos-mod-hist-overlay').emitir('keydown', { key: 'Tab', shiftKey: false, preventDefault() {} });
    expect(Nodo.enFoco).toBe(E(t, 'btn-fotos-mod-hist-cerrar'));
    E(t, 'fotos-mod-hist-overlay').emitir('keydown', { key: 'Escape', stopPropagation() {} });
    expect(abiertoHist(t)).toBe(false);
  });

  test('Escape sobre la confirmacion de reposicion solo cancela la confirmacion', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t);
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'fotos-mod-hist-overlay').emitir('keydown', { key: 'Escape', stopPropagation() {} });
    expect(E(t, 'fotos-mod-rep-confirmar').hidden).toBe(true);
    expect(abiertoHist(t)).toBe(true);
  });

  test('hayModalAbierto avisa al visor para que Escape / flechas no actuen debajo', () => {
    const t = cargar();
    abrirVisor(t);
    expect(t.ctx.fotosModeracionController_hayModalAbierto()).toBe(false);
    sugerir(t).click();
    expect(t.ctx.fotosModeracionController_hayModalAbierto()).toBe(true);
  });

  test('semantica: botones reales y atributos de dialogo en el HTML', () => {
    ['fotos-mod-form-overlay', 'fotos-mod-hist-overlay'].forEach((id) => {
      expect(html).toMatch(new RegExp('<div id="' + id + '" class="fotos-mod-overlay" role="dialog" aria-modal="true" aria-labelledby="[^"]+" hidden>'));
    });
    expect(html).toMatch(/<label for="fotos-mod-motivo"/);
    expect(html).toMatch(/<label for="fotos-mod-detalle"/);
    expect(html).toMatch(/<button type="submit" id="btn-fotos-mod-form-enviar"/);
  });
});

describe('ciclo de vida', () => {
  test('reset (cerrar sesion): modales, historial, imagenes y avisos se descartan', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.retirar[0](respOk());
    await flush();
    abrirVisor(t, Object.assign({}, FOTO_GRILLA, { fotoId: OTRA }));
    sugerir(t).click();
    t.ctx.fotosModeracionController_reset();
    expect(abiertoForm(t)).toBe(false);
    expect(abiertoHist(t)).toBe(false);
    expect(texto(t, 'fotos-mod-aviso')).toBe('');
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
    expect(visibles(t)).toEqual({ sugerir: false, retirar: false, historial: false });
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
  });

  test('salir de la pantalla (cerrar) descarta los modales abiertos y lo que vuelve despues', async () => {
    const t = cargar();
    abrirVisor(t);
    retirar(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.ctx.fotosModeracionController_cerrar();
    t.pend.retirar[0](respOk());
    await flush();
    expect(abiertoForm(t)).toBe(false);
    expect(t.hooks.refrescar).not.toHaveBeenCalled();
  });

  test('el aviso solo lo ve quien puede ver fotos', () => {
    const t = conPermisos({ fotos_carga: true });
    abrirVisor(t);
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
  });

  test('el controlador nunca llama al endpoint normal de imagen ni al de fotos', () => {
    expect(codigoControlador).not.toMatch(/apiGetFotoPozo\(|apiGetFotosPozo\(|apiSubirFotoPozo\(|apiGetResumenFotosPozos\(/);
    expect(codigoControlador).toMatch(/apiGetFotoPozoModeracion\(/);
  });
});

describe('permisos que cambian y ciclo de vida (huecos cerrados por mutacion)', () => {
  const MOD_SOLO = { fotos: true, fotos_moderar: true };

  test('perder el permiso con el historial abierto: no se ofrece reponer, no se confirma nada y no se piden imagenes de moderacion', async () => {
    const t = cargar();
    abrirVisor(t);
    verHistorial(t).click();
    t.contexto.permisos = { fotos: true, fotos_carga: true };      // le sacaron fotos_moderar mientras cargaba
    t.pend.historial[0](historialOk([evento()]));
    await flush();
    expect(t.llamadas.imagen).toHaveLength(0);
    expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(true);
    E(t, 'btn-fotos-mod-hist-reponer').hidden = false;               // aunque destapen el boton
    E(t, 'btn-fotos-mod-hist-reponer').click();
    expect(E(t, 'fotos-mod-rep-confirmar').hidden).toBe(true);
    expect(t.llamadas.reponer).toHaveLength(0);
  });

  test('el boton Reponer sigue la senal del backend Y el permiso de hoy', async () => {
    const t = cargar();
    await abrirHistorialConDatos(t);
    expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(false);
    t.contexto.permisos = { fotos: true };
    E(t, 'btn-fotos-mod-hist-reponer').click();                       // reabre el pintado con el permiso nuevo
    expect(E(t, 'btn-fotos-mod-hist-reponer').hidden).toBe(true);
    expect(t.llamadas.reponer).toHaveLength(0);
  });

  test('una sugerencia exitosa NO quita la foto del visor: el moderador sigue pudiendo retirarla / ver su historial', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.pend.solicitar[0](respOk());
    await flush();
    expect(visibles(t)).toEqual({ sugerir: false, retirar: true, historial: true });
    retirar(t).click();
    expect(abiertoForm(t)).toBe(true);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al cargar la imagen del historial: logout global', async (code) => {
    const t = cargar({ imagen: () => Promise.resolve({ status: 'error', code: code }) });
    await abrirHistorialConDatos(t);
    expect(t.sesion).toHaveBeenCalledTimes(1);
  });

  test('la etiqueta "Retiro sugerido" de la miniatura depende del permiso de hoy', () => {
    const t = cargar();
    expect(t.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('Retiro sugerido');
    t.contexto.permisos = { fotos: true };
    expect(t.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('');
    t.contexto.permisos = { fotos: true, fotos_moderar: true };
    expect(t.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('Retiro sugerido');
    t.contexto.permisos = { fotos_carga: true };
    expect(t.ctx.fotosModeracionController_etiquetaItem(CON_SOLICITUD)).toBe('');
  });

  test('reset: las imagenes del historial no sobreviven (la proxima vez se vuelven a pedir)', async () => {
    const t = cargar();
    const abrirYEsperar = async () => {
      abrirVisor(t);
      verHistorial(t).click();
      t.pend.historial[t.pend.historial.length - 1](historialOk([evento()]));
      await flush();
      E(t, 'btn-fotos-mod-hist-cerrar2').click();
    };
    await abrirYEsperar();
    expect(t.llamadas.imagen).toHaveLength(1);
    t.ctx.fotosModeracionController_reset();
    t.ctx.fotosModeracionController_alAbrir(ENTIDAD);
    await abrirYEsperar();
    expect(t.llamadas.imagen).toHaveLength(2);
  });

  test('abrir otra pantalla de fotos descarta los modales abiertos', () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    expect(abiertoForm(t)).toBe(true);
    t.ctx.fotosModeracionController_alAbrir({ wellId: '14-0002', monitoringId: '', etiqueta: '14-0002' });
    expect(abiertoForm(t)).toBe(false);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
  });

  test('un aviso sin permiso para ver fotos no se muestra (la respuesta llega cuando ya se perdio el permiso)', async () => {
    const t = cargar();
    abrirVisor(t);
    sugerir(t).click();
    elegirMotivo(t, 'DUPLICADA');
    enviarForm(t);
    t.contexto.permisos = { fotos_carga: true };                    // sin fotos
    t.pend.solicitar[0](respErr('FOTO_NOT_FOUND'));
    await flush();
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
  });
});

describe('historial abierto desde otra pantalla (Fotos pendientes): fotosModeracionController_abrirHistorial', () => {
  const externo = () => ({ alReponer: jest.fn(), alEstadoCambiado: jest.fn(), alCerrar: jest.fn() });
  const abrirDesde = async (t, ext, estado) => {
    const boton = new Nodo('button');
    t.ctx.fotosModeracionController_abrirHistorial(FOTO, boton, ext);
    t.pend.historial[t.pend.historial.length - 1](historialOk([evento()], estado));
    await flush();
    return boton;
  };

  test('abre el mismo dialogo de historial (sin pasar por el visor) y avisa al cerrarse; el foco vuelve al boton de origen', async () => {
    const t = cargar();
    const ext = externo();
    const boton = await abrirDesde(t, ext);
    expect(abiertoHist(t)).toBe(true);
    expect(t.llamadas.historial).toEqual([['tok', FOTO]]);
    expect(t.ctx.fotosModeracionController_hayModalAbierto()).toBe(true);
    E(t, 'btn-fotos-mod-hist-cerrar2').click();
    expect(abiertoHist(t)).toBe(false);
    expect(ext.alCerrar).toHaveBeenCalledTimes(1);
    expect(Nodo.enFoco).toBe(boton);
  });

  test('reponer desde ahi: avisa a la otra pantalla (que se actualiza sola) y NO toca la galeria ni su aviso', async () => {
    const t = cargar();
    const ext = externo();
    await abrirDesde(t, ext);
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    expect(t.llamadas.reponer[0][2]).toMatch(/^foto-rep-/);
    t.pend.reponer[0](respOk());
    await flush();
    expect(abiertoHist(t)).toBe(false);
    expect(ext.alReponer).toHaveBeenCalledTimes(1);
    expect(ext.alCerrar).toHaveBeenCalledTimes(1);
    expect(t.hooks.refrescar).not.toHaveBeenCalled();
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
  });

  test('si el estado cambio (otro moderador la repuso), la otra pantalla recibe el CODIGO y la galeria no se toca', async () => {
    const t = cargar();
    const ext = externo();
    await abrirDesde(t, ext);
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.pend.reponer[0](respErr('FOTO_NO_RETIRADA'));
    await flush();
    expect(ext.alEstadoCambiado).toHaveBeenCalledWith('FOTO_NO_RETIRADA');
    expect(ext.alReponer).not.toHaveBeenCalled();
    expect(ext.alCerrar).toHaveBeenCalledTimes(1);
    expect(t.hooks.refrescar).not.toHaveBeenCalled();
    expect(E(t, 'fotos-mod-aviso').hidden).toBe(true);
  });

  test('sin fotos_moderar no se abre nada y la otra pantalla se entera (alCerrar), sin pedir red', async () => {
    const t = conPermisos({ fotos: true, fotos_carga: true });
    const ext = externo();
    t.ctx.fotosModeracionController_abrirHistorial(FOTO, new Nodo('button'), ext);
    await flush();
    expect(t.llamadas.historial).toHaveLength(0);
    expect(abiertoHist(t)).toBe(false);
    expect(ext.alCerrar).toHaveBeenCalledTimes(1);
  });

  test('desde el visor de la galeria (sin externo) la reposicion SI refresca la galeria y avisa ahi', async () => {
    const t = await (async () => { const x = cargar(); abrirVisor(x); verHistorial(x).click(); x.pend.historial[0](historialOk([evento()])); await flush(); return x; })();
    E(t, 'btn-fotos-mod-hist-reponer').click();
    E(t, 'btn-fotos-mod-rep-confirmar').click();
    t.pend.reponer[0](respOk());
    await flush();
    expect(t.hooks.refrescar).toHaveBeenCalledTimes(1);
    expect(texto(t, 'fotos-mod-aviso')).toBe('Foto repuesta en la galería.');
  });

  test('el cierre de sesion descarta el historial abierto desde otra pantalla', async () => {
    const t = cargar();
    const ext = externo();
    await abrirDesde(t, ext);
    t.ctx.fotosModeracionController_reset();
    expect(abiertoHist(t)).toBe(false);
    expect(t.bodyClases.has('fotos-mod-abierto')).toBe(false);
  });
});
