// Componente comun de "cargando": un pozo con entubado, una columna de agua que
// asciende y ondas del nivel freatico. SVG inline + CSS (ver .cargando en
// css/styles.css): sin GIF, sin recursos externos, funciona offline y respeta
// prefers-reduced-motion. Reemplaza a los spinners circulares y a los textos
// planos de espera.
//
// Cuatro formas de usarlo:
//   cargando_html(texto, opc)  -> string con el bloque completo (para innerHTML)
//   cargando_crear(texto, opc) -> elemento DOM listo para appendChild
//   cargando_hidratar(raiz)    -> convierte los <div data-cargando>Texto</div> del HTML estatico
//   cargando_interior(texto, opc) -> solo el interior (svg + texto), lo usan las anteriores
// opc: { tam: 'sm' | 'md' | 'lg' (default md), fila: true (icono al lado del texto),
//        soloIcono: true (el texto queda solo para lectores de pantalla) }
//
// Accesibilidad: role="status" + aria-live="polite"; el SVG es decorativo (aria-hidden).
// No hay layout shift: el SVG tiene tamano fijo por CSS. La demora de ~150 ms para evitar
// destellos en respuestas rapidas la hace el CSS (animation-delay sobre la opacidad), asi que
// funciona igual al mostrar/ocultar con [hidden] y no necesita timers.
//
// El SVG NO usa ids (ni clipPath ni defs): hay varias instancias en la pagina y un id repetido
// dentro de un SVG oculto (display:none) rompe la referencia en algunos navegadores.
var CARGANDO_TAMANOS = { sm: true, md: true, lg: true };
var CARGANDO_TEXTO_DEFECTO = 'Cargando…';

var CARGANDO_SVG =
  '<svg class="cargando-svg" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
    '<rect class="cargando-freatico" x="0" y="54" width="64" height="10"/>' +
    '<path class="cargando-onda" d="M-16 54q4-3 8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0t8 0"/>' +
    '<ellipse class="cargando-expansiva" cx="32" cy="58" rx="6" ry="1.6"/>' +
    '<ellipse class="cargando-expansiva cargando-expansiva-2" cx="32" cy="58" rx="6" ry="1.6"/>' +
    '<rect class="cargando-agua" x="29" y="17" width="6" height="44"/>' +
    '<path class="cargando-tubo" d="M28 18V60M36 18V60"/>' +
    '<path class="cargando-suelo" d="M4 40H25M39 40H60"/>' +
    '<path class="cargando-tubo" d="M39 14.5H46Q50 14.5 50 19V24"/>' +
    '<rect class="cargando-boca" x="25" y="12" width="14" height="5" rx="1.5"/>' +
    '<circle class="cargando-gota" cx="50" cy="27" r="1.8"/>' +
  '</svg>';

function cargando_escapar(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function cargando_clases(opc) {
  var o = opc || {};
  var tam = CARGANDO_TAMANOS[o.tam] ? o.tam : 'md';
  var clases = 'cargando cargando-' + tam;
  if (o.fila) { clases += ' cargando-fila'; }
  if (o.soloIcono) { clases += ' cargando-solo-icono'; }
  return clases;
}

function cargando_interior(texto, opc) {
  var t = (texto === null || texto === undefined || String(texto).trim() === '') ? CARGANDO_TEXTO_DEFECTO : texto;
  return CARGANDO_SVG + '<span class="cargando-texto">' + cargando_escapar(t) + '</span>';
}

function cargando_html(texto, opc) {
  return '<div class="' + cargando_clases(opc) + '" role="status" aria-live="polite">' + cargando_interior(texto, opc) + '</div>';
}

function cargando_crear(texto, opc) {
  var d = document.createElement('div');
  d.className = cargando_clases(opc);
  d.setAttribute('role', 'status');
  d.setAttribute('aria-live', 'polite');
  d.innerHTML = cargando_interior(texto, opc);
  return d;
}

// HTML estatico: <div class="cargando cargando-lg" data-cargando>Cargando mapa...</div>. El texto del
// marcador pasa a ser el texto contextual (sin JS queda visible como texto plano). Conserva id y clases
// del marcador y agrega lo que falte; es idempotente (saca data-cargando al terminar).
function cargando_hidratar(raiz) {
  var base = raiz || (typeof document !== 'undefined' ? document : null);
  if (!base || typeof base.querySelectorAll !== 'function') {
    return 0;
  }
  var nodos = base.querySelectorAll('[data-cargando]');
  for (var i = 0; i < nodos.length; i++) {
    var n = nodos[i];
    var texto = String(n.textContent || '').trim();
    var tiene = ' ' + (n.className || '') + ' ';
    var clases = n.className || '';
    if (tiene.indexOf(' cargando ') === -1) { clases = (clases ? clases + ' ' : '') + 'cargando'; }
    if (!/ cargando-(sm|md|lg) /.test(tiene)) { clases += ' cargando-md'; }
    n.className = clases;
    n.setAttribute('role', 'status');
    n.setAttribute('aria-live', 'polite');
    n.innerHTML = cargando_interior(texto);
    n.removeAttribute('data-cargando');
  }
  return nodos.length;
}

if (typeof document !== 'undefined') {
  // Los <script> van al final del <body>: los marcadores del HTML ya existen.
  cargando_hidratar();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { cargando_html, cargando_crear, cargando_hidratar, cargando_interior, cargando_escapar, cargando_clases, CARGANDO_SVG };
}
