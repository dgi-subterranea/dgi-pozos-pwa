// DOM FALSO minimo para probar los controladores de ITF (js/itfPerfil.js y js/itfModeracion.js) sin navegador: los mismos ids y atributos `hidden` que index.html, y LANZA ante innerHTML / insertAdjacentHTML
// (todo texto de datos tiene que ir por textContent). Lo usan itfPerfilController.test.js e itfModeracionController.test.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(...p), 'utf8');
const html = leer(raiz, 'index.html');

class Nodo {
  constructor(tag, id) {
    this.tag = tag; this.tagName = String(tag).toUpperCase(); this.id = id || ''; this.children = []; this.className = ''; this._texto = ''; this.hidden = false; this.disabled = false;
    this.parentNode = null; this.oyentes = {}; this.attrs = {}; this.isConnected = true; this.alt = ''; this.type = ''; this.value = ''; this.href = undefined; this.files = null; this.style = {};
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
  set src(v) { this.attrs.src = String(v); }
  get src() { return Object.prototype.hasOwnProperty.call(this.attrs, 'src') ? this.attrs.src : undefined; }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
  addEventListener(tipo, f) { (this.oyentes[tipo] = this.oyentes[tipo] || []).push(f); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'href') { this.href = undefined; } }
  focus() { Nodo.enFoco = this; }
  emitir(tipo, ev) { const e = ev || {}; e.target = e.target || this; (this.oyentes[tipo] || []).forEach((f) => f(e)); return e; }
  click() { if (!this.disabled && !this.hidden) { this.emitir('click'); } }
  // los hijos recorridos en profundidad (para buscar botones / textos en listas dinamicas)
  descendientes() { const out = []; this.children.forEach((c) => { out.push(c); c.descendientes().forEach((d) => out.push(d)); }); return out; }
  botones() { return this.descendientes().filter((d) => d.tag === 'button'); }
  boton(texto) { return this.botones().filter((b) => b.textContent === texto)[0]; }
}

// fuentes: archivos js a ejecutar (en orden) dentro del mismo contexto; globales: funciones / valores extra (las llamadas a la API, etc.)
function crearEntorno(fuentes, globales, opc) {
  const o = opc || {};
  const codigo = fuentes.map((f) => leer(__dirname, '..', f));
  const ids = new Set();
  codigo.forEach((c) => Array.from(c.matchAll(/\$\('([^']+)'\)/g)).forEach((m) => ids.add(m[1])));
  const el = {};
  ids.forEach((id) => {
    el[id] = new Nodo('el', id);
    const m = new RegExp('<[^>]*\\sid="' + id + '"[^>]*>').exec(html);
    el[id].hidden = !!m && /\shidden(\s|>|$)/.test(m[0].replace(/\sid="[^"]*"/, ''));
    if (m) { const t = /^<([a-z0-9]+)/i.exec(m[0]); el[id].tag = t ? t[1].toLowerCase() : 'el'; el[id].tagName = el[id].tag.toUpperCase(); }
  });
  Nodo.enFoco = null;
  const bodyClases = new Set();
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, Intl, setTimeout, Set, Error, Uint8Array, RegExp, parseInt });
  ctx.window = ctx;
  ctx.crypto = { randomUUID: () => require('crypto').randomUUID() };
  ctx.document = {
    body: { classList: { toggle: (c, on) => { if (on) { bodyClases.add(c); } else { bodyClases.delete(c); } } } },
    get activeElement() { return Nodo.enFoco; },
    getElementById: (id) => el[id],
    createElement: (tag) => new Nodo(tag)
  };
  ctx.navigator = o.navigator || {};
  ctx.atob = (s) => Buffer.from(s, 'base64').toString('binary');
  ctx.File = function (partes, nombre, opciones) { this.partes = partes; this.name = nombre; this.type = opciones && opciones.type; };
  ctx.URL = { revokeObjectURL: jest.fn(), createObjectURL: jest.fn(() => 'blob:x') };
  Object.keys(globales || {}).forEach((k) => { ctx[k] = globales[k]; });
  codigo.forEach((c) => vm.runInContext(c, ctx));
  return { ctx, el, bodyClases, Nodo };
}

const flush = async () => { for (let i = 0; i < 14; i += 1) { await new Promise((r) => setImmediate(r)); } };

module.exports = { Nodo, crearEntorno, flush, html, leer, raiz };
