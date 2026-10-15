// Controlador DOM de "Ubicaciones conocidas" (ficha del pozo, modulo Ubicacion): pinta la seccion con cada fuente por separado y abre el visor comparativo
// ("Ver todas en el mapa"), un mapa SOLO DE LECTURA con todas las coordenadas conocidas del pozo. Toca DOM y Leaflet, asi que no se prueba directo con Jest: los
// tests lo ejecutan con un DOM y un Leaflet simulados (js/ubicacionesConocidasController.test.js); toda la logica pura -fuentes, punto operativo, distancias,
// enlaces y HTML- vive en js/ubicacionesConocidasLogic.js (con tests).
//
// - NO escribe nada: ni llama al backend ni modifica coordenadas. Lee lo que la ficha ya tiene (getWellLocation) y la correccion vigente que ya leyo
//   js/ubicacionCorreccion.js (que la entrega con ubicacionesConocidasController_actualizarVigente).
// - Las acciones "validar / descartar una fuente" NO existen todavia: antes hace falta definir el modelo (docs/ubicacion-correcciones.md).
// - Los enlaces a Google Maps llevan solo latitud y longitud (ver ubicacionesConocidasLogic_urlGoogleMaps).
(function () {
  var estado = {
    aperturaId: 0,       // descarta respuestas tardias de una ficha anterior
    wellId: null,
    location: null,
    vigente: null,
    modelo: null,
    iconoMaps: '',
    visorId: 0,
    mapa: { mapa: null, capasBase: null, capaBaseActual: null, capas: null, marcadores: {} }
  };

  var $ = function (id) { return document.getElementById(id); };
  var overlayEl = $('ucon-overlay');
  var tituloEl = $('ucon-titulo');
  var btnCerrar = $('btn-ucon-cerrar');
  var btnCerrarAbajo = $('btn-ucon-cerrar-abajo');
  var mapaEls = {
    cargando: $('ucon-mapa-cargando'), error: $('ucon-mapa-error'), contenedor: $('ucon-mapa'), leyenda: $('ucon-leyenda'),
    nota: $('ucon-visor-nota'), chips: Array.prototype.slice.call(document.querySelectorAll('.ucon-capa-chip'))
  };
  var abridorEl = null;

  function contenedor() {
    return $('ubic-conocidas');
  }

  function recalcular() {
    estado.modelo = ubicacionesConocidasLogic_construir({ wellId: estado.wellId, location: estado.location, vigente: estado.vigente });
  }

  function pintarSeccion() {
    var cont = contenedor();
    if (!cont) {
      return;
    }
    recalcular();
    cont.innerHTML = ubicacionesConocidasLogic_htmlSeccion(estado.modelo, { iconoMaps: estado.iconoMaps });
    var ver = $('btn-ucon-ver-todas');
    if (ver) {
      ver.addEventListener('click', function () { abrirVisor(ver); });
    }
  }

  // ap: {wellId, location, iconoMaps?}. location es la respuesta de getWellLocation (la que la ficha ya tiene).
  function ubicacionesConocidasController_abrir(ap) {
    estado.aperturaId += 1;
    cerrarVisor();
    estado.wellId = ap && ap.wellId ? ap.wellId : null;
    estado.location = ap && ap.location ? ap.location : null;
    estado.iconoMaps = ap && ap.iconoMaps ? ap.iconoMaps : '';
    estado.vigente = null;
    pintarSeccion();
  }

  // js/ubicacionCorreccion.js la llama cada vez que (re)lee las correcciones del pozo: vigente = vista VALIDADA o null. Si la ficha ya es otra, no hace nada.
  function ubicacionesConocidasController_actualizarVigente(wellId, vigente) {
    if (!estado.wellId || wellId !== estado.wellId) {
      return;
    }
    estado.vigente = vigente || null;
    pintarSeccion();
    if (!overlayEl.hidden) {
      dibujarVisor();
    }
  }

  function ubicacionesConocidasController_cerrar() {
    cerrarVisor();
  }

  // --- Visor comparativo (solo lectura) ---

  function abrirVisor(opener) {
    if (!estado.modelo || estado.modelo.validas === 0) {
      return;
    }
    abridorEl = opener || null;
    estado.visorId += 1;
    tituloEl.textContent = 'Ubicaciones conocidas · ' + estado.wellId;
    overlayEl.hidden = false;
    document.body.classList.add('ucorr-abierto');
    prepararMapa(estado.visorId);
  }

  function cerrarVisor() {
    if (overlayEl.hidden) {
      return;                          // nunca se toca ucorr-abierto si este visor no esta abierto (otro modal podria estarlo)
    }
    estado.visorId += 1;               // descarta un mapa que todavia se esta cargando
    overlayEl.hidden = true;
    document.body.classList.remove('ucorr-abierto');
    if (abridorEl && document.body.contains(abridorEl) && typeof abridorEl.focus === 'function') {
      abridorEl.focus();
    }
    abridorEl = null;
  }

  function htmlMarcador(clase, texto) {
    return '<div class="ucorr-marker ucon-marker ' + clase + '"><span class="ucorr-marker-punto"></span><span class="ucorr-marker-texto">' +
      ubicacionesConocidasLogic_escapar(texto) + '</span></div>';
  }

  // La etiqueta va arriba o abajo del punto (como en el mapa del modal de correccion): el operativo siempre arriba y las demas alternadas, asi las que quedan
  // muy juntas (a pocos metros) no se pisan todas. La leyenda de abajo y los popups cubren los casos en que igual se superpongan.
  function iconoDeFuente(f, arriba) {
    return L.divIcon({
      className: 'ucorr-marker-wrap', html: htmlMarcador(ubicacionesConocidasLogic_claseMarcador(f) + (arriba ? ' ucorr-marker-arriba' : ''), f.esOperativo ? f.etiqueta + ' ★' : f.etiqueta),
      iconSize: [76, 44], iconAnchor: arriba ? [38, 33] : [38, 11]
    });
  }

  function prepararMapa(vi) {
    mapaEls.error.hidden = true;
    mapaEls.cargando.hidden = false;
    mapaEls.contenedor.hidden = true;
    mapaEls.leyenda.innerHTML = ubicacionesConocidasLogic_htmlLeyenda(estado.modelo);
    mapaShared_cargarLibrerias().then(function () {
      if (vi !== estado.visorId) {
        return;
      }
      var mp = estado.mapa;
      mapaEls.cargando.hidden = true;
      mapaEls.contenedor.hidden = false;
      if (!mp.mapa) {
        mp.mapa = L.map('ucon-mapa', { zoomControl: true }).setView([-34.6, -68.6], 7);
        mp.capasBase = mapaShared_crearCapasBase(mp.mapa);
        mp.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
        mp.capas = L.layerGroup().addTo(mp.mapa);
      }
      mapaShared_alMostrarMapa(mp.mapa, function () {
        if (vi === estado.visorId) {
          dibujarVisor();
        }
      });
    }).catch(function () {
      if (vi !== estado.visorId) {
        return;
      }
      mapaEls.cargando.hidden = true;
      mapaEls.error.hidden = false;          // la lista de arriba y los enlaces a Google Maps siguen sirviendo
    });
  }

  // Un marcador por fuente valida. El operativo va arriba de todo y con aro; el resto se distingue por color y por el texto de su etiqueta.
  function dibujarVisor() {
    var mp = estado.mapa;
    if (!mp.mapa || !mp.capas || !estado.modelo) {
      return;
    }
    recalcular();
    mapaEls.leyenda.innerHTML = ubicacionesConocidasLogic_htmlLeyenda(estado.modelo);
    mapaEls.nota.textContent = estado.modelo.sinOperativo ? UCON_NOTA_SIN_OPERATIVO : '';
    mapaEls.nota.hidden = !estado.modelo.sinOperativo;
    mp.capas.clearLayers();
    mp.marcadores = {};
    var pts = [];
    var otras = 0;
    estado.modelo.fuentes.forEach(function (f) {
      if (f.invalida) {
        return;
      }
      var arriba = f.esOperativo || otras % 2 === 1;
      if (!f.esOperativo) {
        otras += 1;
      }
      var mk = L.marker([f.lat, f.lon], { icon: iconoDeFuente(f, arriba), keyboard: true, title: f.etiqueta, zIndexOffset: f.esOperativo ? 1000 : 300 });
      if (typeof mk.bindPopup === 'function') {
        mk.bindPopup(ubicacionesConocidasLogic_htmlPopup(f), { maxWidth: 260 });
      }
      mk.addTo(mp.capas);
      mp.marcadores[f.id] = mk;
      pts.push([f.lat, f.lon]);
    });
    if (pts.length === 1) {
      mp.mapa.setView(pts[0], 17);
    } else if (pts.length > 1) {
      mp.mapa.fitBounds(pts, { maxZoom: 18, paddingTopLeft: [40, 50], paddingBottomRight: [40, 40] });
    }
  }

  function enfocar(id) {
    var mp = estado.mapa;
    var mk = mp.marcadores[id];
    if (!mk || !mp.mapa) {
      return;
    }
    if (typeof mp.mapa.panTo === 'function' && mk.getLatLng) {
      mp.mapa.panTo(mk.getLatLng());
    }
    if (typeof mk.openPopup === 'function') {
      mk.openPopup();
    }
  }

  mapaEls.leyenda.addEventListener('click', function (e) {
    var t = e && e.target;
    var fila = t && typeof t.closest === 'function' ? t.closest('[data-ucon-foco]') : null;
    if (fila) {
      enfocar(fila.getAttribute('data-ucon-foco'));
    }
  });
  mapaEls.chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (estado.mapa.mapa) {
        mapaShared_cambiarCapaBase(estado.mapa, chip.getAttribute('data-capa'), mapaEls.chips);
      }
    });
  });
  btnCerrar.addEventListener('click', function () { cerrarVisor(); });
  btnCerrarAbajo.addEventListener('click', function () { cerrarVisor(); });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cerrarVisor();
    }
  });

  window.ubicacionesConocidasController_abrir = ubicacionesConocidasController_abrir;
  window.ubicacionesConocidasController_actualizarVigente = ubicacionesConocidasController_actualizarVigente;
  window.ubicacionesConocidasController_cerrar = ubicacionesConocidasController_cerrar;
})();
