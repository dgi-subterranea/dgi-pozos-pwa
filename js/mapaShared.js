// Recursos compartidos entre el mapa de Pozos Provincia (js/mapa.js) y
// el mapa independiente de Niveles Estaticos (js/mapaNE.js) - arquitectura
// de 2 mapas (v2.2.0). Igual que js/mapa.js, toca DOM/Leaflet en vivo, no
// se testea con Jest (se verifica a mano en el navegador).
//
// Sin IIFE a proposito: mismo patron que js/mapaLogic.js/js/mapaDataset.js/
// js/mapaNEDataset.js (funciones globales de script plano), para que
// mapa.js y mapaNE.js las llamen directo, sin prefijo window.

// Proveedores de tiles (Mapa/Satelite) - unico lugar que sabe las URLs/
// atribuciones para LOS 2 MAPAS. Ver comentario extenso original en la
// version previa de js/mapa.js (Etapa v2.1.0, adjustment #7) sobre por
// que Esri World Imagery es una dependencia $0 asumida a proposito.
var MAPA_TILE_PROVIDERS = {
  calle: {
    urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    subdomains: 'abc',
    maxZoom: 19
  },
  satelite: {
    urlTemplate: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19
  }
};
var MAPA_CAPA_BASE_DEFAULT = 'calle';

// Mismo tono que --color-primary-dark (no un color nuevo) - la
// diferencia con los pozos del padron es la FORMA del marker (diamante
// con linea), no el color.
var MAPA_COLOR_NE = '#073e54';

function mapaShared_cargarScript(src) {
  return new Promise(function (resolve, reject) {
    var script = document.createElement('script');
    script.src = src;
    script.onload = function () { resolve(); };
    script.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
    document.body.appendChild(script);
  });
}

function mapaShared_cargarCSS(href) {
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

var mapaLibreriasPromise = null;

// Carga diferida real, UNA SOLA vez para toda la pagina: Leaflet/
// Leaflet.markercluster no se referencian en el <head> - se inyectan
// recien la primera vez que se abre CUALQUIERA de los 2 mapas. Si Pozos
// Provincia ya las cargo, abrir despues Niveles Estaticos (o viceversa)
// reusa la misma promesa resuelta, sin volver a inyectar los <script>
// (requisito explicito: no duplicar la carga de librerias entre los 2
// mapas).
function mapaShared_cargarLibrerias() {
  if (mapaLibreriasPromise) {
    return mapaLibreriasPromise;
  }
  mapaShared_cargarCSS('vendor/leaflet/leaflet.css');
  mapaShared_cargarCSS('vendor/leaflet.markercluster/MarkerCluster.css');
  mapaShared_cargarCSS('vendor/leaflet.markercluster/MarkerCluster.Default.css');

  mapaLibreriasPromise = mapaShared_cargarScript('vendor/leaflet/leaflet.js')
    .then(function () { return mapaShared_cargarScript('vendor/leaflet.markercluster/leaflet.markercluster.js'); });
  return mapaLibreriasPromise;
}

// Crea las 2 capas base sobre una instancia de L.Map ya creada y agrega
// la default - la otra queda lista sin pedir tiles hasta que se cambie a
// ella (Leaflet no descarga nada de una capa no agregada al mapa).
// Devuelve {capasBase, capaBaseActual}, que cada controlador (mapa.js/
// mapaNE.js) guarda en SU PROPIO estado - son 2 instancias de L.Map
// totalmente independientes, cada una con sus propias 2 capas base.
function mapaShared_crearCapasBase(mapaInstance) {
  var capasBase = {};
  Object.keys(MAPA_TILE_PROVIDERS).forEach(function (id) {
    var p = MAPA_TILE_PROVIDERS[id];
    var opciones = { attribution: p.attribution, maxZoom: p.maxZoom };
    // subdomains SOLO si el proveedor lo define - ver bug documentado en
    // la version original de mapa.js (Etapa v2.1.0): pasar
    // subdomains:undefined explicito rompe la capa "satelite" con un
    // TypeError interno de Leaflet la primera vez que pide un tile.
    if (p.subdomains) {
      opciones.subdomains = p.subdomains;
    }
    capasBase[id] = L.tileLayer(p.urlTemplate, opciones);
  });
  capasBase[MAPA_CAPA_BASE_DEFAULT].addTo(mapaInstance);
  return capasBase;
}

// Cambia de capa base sobre un estado generico {mapa, capasBase,
// capaBaseActual} (mutado in-place - cada controlador pasa el suyo).
// Nunca recarga el dataset ni toca clusterGroup/markers/vista - solo
// quita la capa base vieja y agrega la nueva (las 2 ya existen).
function mapaShared_cambiarCapaBase(estado, id, capaBaseChipsEls) {
  if (id === estado.capaBaseActual || !estado.capasBase || !estado.capasBase[id]) {
    return;
  }
  estado.mapa.removeLayer(estado.capasBase[estado.capaBaseActual]);
  estado.capasBase[id].addTo(estado.mapa);
  estado.capaBaseActual = id;

  capaBaseChipsEls.forEach(function (chip) {
    var esEsta = chip.getAttribute('data-capa') === id;
    chip.classList.toggle('active', esEsta);
    chip.setAttribute('aria-pressed', esEsta ? 'true' : 'false');
  });
}

// Icono especifico de monitoreo: un diamante con una linea horizontal
// (evoca una regla/gauge de nivel), NO otro circulo de otro color -
// pedido explicito para que se distinga de un vistazo de los pozos del
// padron. Usado SOLO por el mapa NE independiente (mapaNE.js) - dentro
// de Pozos Provincia, el filtro "Tiene: Niveles estáticos" muestra
// pozos reales del padron con su marker normal (circleMarker teal), ver
// mapaController_crearMarker en mapa.js.
function mapaShared_iconoNE() {
  var svg = '<svg width="22" height="22" viewBox="0 0 22 22" xmlns="http://www.w3.org/2000/svg">' +
    '<rect x="5" y="5" width="12" height="12" rx="2.5" transform="rotate(45 11 11)" fill="' + MAPA_COLOR_NE + '" stroke="#ffffff" stroke-width="2"/>' +
    '<line x1="7" y1="11" x2="15" y2="11" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>' +
    '</svg>';
  return L.divIcon({ className: 'mapa-ne-icono', html: svg, iconSize: [22, 22], iconAnchor: [11, 11] });
}

// Popup de un punto NE: SIEMPRE distingue "tiene wellId" de "punto
// especial" (nunca se inventa un DD-PPPP para un punto que no lo
// tiene). Sin fetch de summary (no aplica aca, a diferencia del popup de
// pozos del padron). contexto = {onAbrirPozo(wellId)} - mismo contrato
// que el resto de los popups de la app.
function mapaShared_crearMarkerNE(punto, contexto) {
  var marker = L.marker([punto.lat, punto.lon], { icon: mapaShared_iconoNE() });

  var el = document.createElement('div');
  el.className = 'mapa-popup';

  var idEl = document.createElement('p');
  idEl.className = 'mapa-popup-id mono';
  idEl.textContent = punto.wellId || mapaLogic_nombrePuntoNE(punto);
  el.appendChild(idEl);

  var tagEl = document.createElement('p');
  tagEl.className = 'mapa-popup-estado';
  tagEl.textContent = 'Niveles estáticos';
  el.appendChild(tagEl);

  // Punto especial (sin wellId) con nombreOriginal: la linea de arriba
  // ya muestra el nombre - aca se agrega el monitoringId tecnico como
  // referencia secundaria, nunca al reves.
  if (!punto.wellId && punto.nombreOriginal) {
    var subEl = document.createElement('p');
    subEl.className = 'mapa-popup-sub';
    subEl.textContent = punto.monitoringId;
    el.appendChild(subEl);
  }

  if (punto.wellId) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button mapa-popup-btn';
    btn.textContent = 'Abrir pozo';
    btn.addEventListener('click', function () {
      contexto.onAbrirPozo(punto.wellId);
    });
    el.appendChild(btn);
  }
  // Punto especial sin wellId: sin boton a proposito - todavia no existe
  // una ruta/controlador reutilizable para abrir el modulo NE directo
  // desde un monitoringId sin pasar por buscarPozo(wellId) (el buscador
  // de la app solo acepta el formato DD-PPPP).

  marker.bindPopup(el);
  return marker;
}
