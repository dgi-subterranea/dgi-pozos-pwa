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
// diferencia con los pozos del padron es la FORMA del marker, no el
// color.
var MAPA_COLOR_NE = '#073e54';
// Mismo tono que --color-mapa-disponible (el celeste ya usado en
// Provincia) - el "agua" dentro del icono-gauge de NE (Etapa 1B.2),
// nunca un color nuevo sin relacion con la paleta existente.
var MAPA_COLOR_NE_NIVEL = '#4fa3c4';

// Color de TODA la geografia de seleccion (poligono, vertices, punto de
// referencia, circulo de radio, anillo de los pozos seleccionados).
// Magenta fuerte (ajuste UX): el marron anterior (#8a5a12) se perdia sobre
// Satelite (tierra/vegetacion) y no destacaba sobre el mapa base claro. El
// magenta casi no existe en la naturaleza ni en la paleta del mapa
// (teal de los pozos, verdes/beige de OSM, tierra de Esri) y se lee bien
// en los dos fondos. Aun asi cada linea se dibuja con un halo blanco
// debajo (ver mapaShared_crearContornoSeleccion) para que el contraste no
// dependa de lo que haya atras. Mismo hex que --color-seleccion en
// css/styles.css (Leaflet no lee variables CSS: duplicado a proposito,
// mantener en sync).
var MAPA_COLOR_SELECCION = '#e0007a';

// Aptitud para reemplazo (anillo del marcador en el mapa): mismos hex que
// --color-reemplazo-* en css/styles.css (Leaflet no lee variables CSS).
var MAPA_COLOR_REEMPLAZO = { APTO: '#1f9d55', DUDOSO: '#e0a100', NO_APTO: '#d32f2f' };

// Dibuja un contorno de seleccion como DOS capas: halo blanco ancho
// debajo + linea magenta arriba. makeLayer(opcionesDeEstilo) crea la capa
// Leaflet (L.polygon / L.circle / L.polyline) con las opciones que le
// pasa esta funcion. interactive:false SIEMPRE: la geografia de seleccion
// nunca debe interceptar toques destinados al mapa (agregar un vertice,
// mover el punto elegido) ni a los pozos de abajo.
function mapaShared_crearContornoSeleccion(makeLayer, opciones) {
  var o = opciones || {};
  var halo = makeLayer({
    color: '#ffffff', weight: (o.weight || 3) + 3, opacity: 0.95, fill: false, interactive: false
  });
  var lineaOpciones = {
    color: MAPA_COLOR_SELECCION, weight: o.weight || 3, opacity: 1, interactive: false
  };
  if (o.dashArray) {
    lineaOpciones.dashArray = o.dashArray;
  }
  if (o.relleno) {
    lineaOpciones.fillColor = MAPA_COLOR_SELECCION;
    lineaOpciones.fillOpacity = o.relleno;
  } else {
    lineaOpciones.fill = false;
  }
  var linea = makeLayer(lineaOpciones);
  return { halo: halo, linea: linea };
}

// Circulo de radio de busqueda (halo + linea + relleno suave) como un
// L.layerGroup - se redimensiona/mueve con
// mapaShared_actualizarCirculoSeleccion (lo usa el mini-mapa de Cerca
// Mio, que lo cambia en vivo, y el mapa Provincia).
function mapaShared_crearCirculoSeleccion(lat, lon, radioMetros) {
  var partes = mapaShared_crearContornoSeleccion(function (o) {
    return L.circle([lat, lon], Object.assign({ radius: radioMetros }, o));
  }, { relleno: 0.08 });
  return L.layerGroup([partes.halo, partes.linea]);
}

function mapaShared_actualizarCirculoSeleccion(grupo, lat, lon, radioMetros) {
  grupo.eachLayer(function (capa) {
    capa.setLatLng([lat, lon]);
    capa.setRadius(radioMetros);
  });
}

// Poligono de seleccion (halo + linea + relleno suave), como L.layerGroup.
function mapaShared_crearPoligonoSeleccion(latlngs) {
  var partes = mapaShared_crearContornoSeleccion(function (o) {
    return L.polygon(latlngs, o);
  }, { relleno: 0.12 });
  return L.layerGroup([partes.halo, partes.linea]);
}

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

// Carga diferida de JSZip (vendorizado en vendor/jszip/, MIT, SIN CDN en
// runtime - ver vendor/jszip/LICENSE) - solo la primera vez que hace
// falta armar un ZIP de verdad (ver seleccionController_descargarItf en
// js/seleccion.js). Mismo patron que mapaShared_cargarLibrerias (Leaflet):
// una sola promesa compartida, nunca vuelve a inyectar el <script> si ya
// se cargo.
var jsZipPromise = null;

function mapaShared_cargarJSZip() {
  if (jsZipPromise) {
    return jsZipPromise;
  }
  jsZipPromise = mapaShared_cargarScript('vendor/jszip/jszip.min.js');
  return jsZipPromise;
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

// Contenedor recien destapado (hidden -> visible en el mismo tick) +
// fitBounds()/setView() basado en tamano = bug real encontrado en la
// primera apertura de AMBOS mapas (Provincia y NE): con el contenedor
// todavia en 0x0 en el momento del calculo, Leaflet devuelve un zoom
// degenerado (encuadra el mundo entero en vez de los puntos). Un solo
// invalidateSize() sincronico, pegado al cambio de "hidden", no alcanza
// siempre - el navegador puede no haber hecho el layout/paint todavia en
// ese mismo tick. Doble requestAnimationFrame (no un setTimeout con un
// numero arbitrario) espera exactamente a que ese layout ya haya
// ocurrido antes de dejar correr cualquier fitBounds()/setView() -
// mapa.js y mapaNE.js llaman esto UNA vez, envolviendo TODO lo que mida
// el contenedor (render de puntos, enfoque puntual/Cerca Mio incluido).
function mapaShared_alMostrarMapa(mapa, callback) {
  mapa.invalidateSize();
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      mapa.invalidateSize();
      callback();
    });
  });
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

// Icono "gauge de nivel" (Etapa 1B.2, reemplaza el rombo original): un
// circulo (punto de monitoreo, nunca un pin - se pidio explicitamente
// evitar la silueta de pin de Google Maps) con su parte inferior en un
// celeste mas claro, separada por una linea blanca - el mismo lenguaje
// visual que un indicador de nivel/bateria, la lectura mas directa de
// "nivel estatico medido dentro de un pozo" a este tamano. Se probaron
// 3 alternativas mas (circulo+onda tipo reloj, gota con punto central,
// capsula tipo pastilla) contra fondos Mapa/Satelite antes de elegir
// esta - las otras 3 se leian como reloj/pin/pastilla en vez de
// "nivel". El circulo (relleno solido + borde blanco, SIN el corte de
// nivel) sigue siendo bien distinto de un circleMarker chico y liso de
// Pozos Provincia (ver mapaController_crearMarker en mapa.js) - nunca
// se confunden a simple vista. Sin animacion (no aplica
// prefers-reduced-motion aca). Usado SOLO por el mapa NE independiente.
var mapaShared_iconoNEContador = 0;

function mapaShared_iconoNE() {
  // id de clipPath UNICO por marker: hay hasta ~405 SVG de estos en el
  // mismo documento (uno por punto), y un id duplicado en <clipPath> es
  // HTML invalido - aunque los 405 circulos clipeados sean geometricamente
  // identicos, no vale la pena depender de que el navegador lo resuelva
  // "bien" igual.
  mapaShared_iconoNEContador += 1;
  var clipId = 'mapaNEClipNivel' + mapaShared_iconoNEContador;
  var svg = '<svg width="22" height="22" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><clipPath id="' + clipId + '"><circle cx="12" cy="12" r="8.2"/></clipPath></defs>' +
    '<circle cx="12" cy="12" r="9" fill="' + MAPA_COLOR_NE + '" stroke="#ffffff" stroke-width="1.6"/>' +
    '<rect x="3" y="14" width="18" height="8" fill="' + MAPA_COLOR_NE_NIVEL + '" clip-path="url(#' + clipId + ')"/>' +
    '<line x1="4" y1="14" x2="20" y2="14" stroke="#ffffff" stroke-width="1.3" clip-path="url(#' + clipId + ')"/>' +
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

  // Una sola linea compacta con lo que un usuario de campo necesita
  // decidir si vale la pena acercarse (Etapa 1B, punto 7) - cuenca/zona
  // quedan afuera a proposito, ya estan disponibles como filtro.
  var infoEl = document.createElement('p');
  infoEl.className = 'mapa-popup-sub';
  infoEl.textContent = mapaLogic_estadoMonitoreoLabel(punto.estadoMonitoreo) +
    ' · ' + (punto.tieneMedicion2026 ? 'Con medición 2026' : 'Sin medición 2026');
  el.appendChild(infoEl);

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
  // Punto especial sin wellId: sin "Abrir pozo" a proposito - todavia no
  // existe una ruta/controlador reutilizable para abrir el modulo NE directo
  // desde un monitoringId sin pasar por buscarPozo(wellId) (el buscador
  // de la app solo acepta el formato DD-PPPP).

  // "Buscar reemplazo" trabaja con el monitoringId, asi que tambien sirve
  // para un punto especial (sin wellId).
  if (typeof contexto.onBuscarReemplazo === 'function') {
    var btnReemplazo = document.createElement('button');
    btnReemplazo.type = 'button';
    btnReemplazo.className = 'button mapa-popup-btn mapa-popup-btn-secundario';
    btnReemplazo.textContent = 'Buscar reemplazo';
    btnReemplazo.addEventListener('click', function () {
      contexto.onBuscarReemplazo(punto.monitoringId);
    });
    el.appendChild(btnReemplazo);
  }

  // "Fotos": galeria general / carga de fotos del punto (FotosPozos). Misma
  // semantica que el popup de Pozos Provincia (js/fotosPopup.js).
  var btnFotos = fotosPopup_crearBoton(contexto, punto, marker);
  if (btnFotos) {
    el.appendChild(btnFotos);
  }

  marker.bindPopup(el);
  return marker;
}

// Icono "pin" (SVG inline, sin imagenes vendorizadas) para "Punto de
// busqueda" (Etapa siguiente, item D) - una forma de gota/pin clasica a
// proposito: es justo la lectura que se evito para NE ("nunca la silueta
// de pin de Google Maps", ver mapaShared_iconoNE) porque aca el
// significado es distinto - no es un pozo ni un punto de monitoreo, es
// "un lugar que el usuario toco en el mapa", y un pin es la forma mas
// reconocible para eso. Nunca se confunde con los circleMarker de pozos
// (son circulos chicos y lisos) ni con el circulo-pulso de "Tu ubicacion"
// (mapaController_iconoMiUbicacion en js/mapa.js, mismo color de seleccion
// pero forma de punto con pulso) - ver MAPA_COLOR_SELECCION arriba.
function mapaShared_iconoPuntoBusqueda() {
  var svg = '<svg width="30" height="38" viewBox="0 0 30 38" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M15 1C7.8 1 2 6.8 2 14c0 10 13 23 13 23s13-13 13-23C28 6.8 22.2 1 15 1z" fill="' + MAPA_COLOR_SELECCION + '" stroke="#ffffff" stroke-width="2"/>' +
    '<circle cx="15" cy="14" r="5" fill="#ffffff"/>' +
    '</svg>';
  return L.divIcon({ className: 'mapa-punto-busqueda-icono', html: svg, iconSize: [30, 38], iconAnchor: [15, 36] });
}
