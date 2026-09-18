// Mapa Niveles Estáticos: mapa independiente y completo de la red NE
// (arquitectura de 2 mapas, v2.2.0) - controlador DOM/Leaflet, mismo
// criterio que js/mapa.js (no se testea con Jest, se verifica a mano en
// el navegador). Muestra SOLO los puntos de getMapaNE (405 con
// coordenadas validas: 371 con wellId + 34 especiales) - nunca los
// 13.804 puntos del padron general debajo (esa combinacion vive en
// Pozos Provincia como un FILTRO, ver mapaController_toggleNE en
// js/mapa.js, no como una superposicion aca).
//
// API publica (unica funcion que app.js llama, ver
// window.mapaNEController_abrir al final): mapaNEController_abrir(contexto).
// contexto = {sessionToken, permisos, onAbrirPozo(wellId)} - gateado
// EXCLUSIVAMENTE por permisos.ne (nunca por "ubicacion" - ver
// mapaLogic_determinarAccesoMapas en js/mapaLogic.js, que ya garantiza
// que este mapa es alcanzable con ne=SI solo, sin ubicacion).
//
// Instancia de Leaflet totalmente independiente de la de Pozos Provincia
// (contenedor DOM propio, mapa-ne-leaflet) - las librerias Leaflet/
// markercluster SI son compartidas (ver js/mapaShared.js), pero cada
// mapa tiene su propio L.Map, sus propias 2 capas base y su propio ciclo
// de vida.
(function () {
  var loadingEl = document.getElementById('mapa-ne-loading');
  var errorEl = document.getElementById('mapa-ne-error');
  var errorMensajeEl = document.getElementById('mapa-ne-error-mensaje');
  var mapaEl = document.getElementById('mapa-ne-leaflet');
  var contadorEl = document.getElementById('mapa-ne-contador');
  var capaBaseChipsEls = Array.prototype.slice.call(document.querySelectorAll('.mapa-ne-capa-chip'));
  var btnReintentar = document.getElementById('btn-mapa-ne-reintentar');
  var btnBuscarToggleEl = document.getElementById('btn-mapa-ne-buscar-toggle');
  var panelBuscarEl = document.getElementById('mapa-ne-buscar-panel');
  var inputBuscarEl = document.getElementById('mapa-ne-buscar-input');
  var btnBuscarCerrarEl = document.getElementById('btn-mapa-ne-buscar-cerrar');
  var resultadosBuscarEl = document.getElementById('mapa-ne-buscar-resultados');

  var mapaNEEstado = {
    mapa: null,           // instancia L.Map PROPIA (nunca la misma que Pozos Provincia)
    capaPuntos: null,     // L.layerGroup con los 405 markers NE - sin cluster (dataset chico, ver adjustment de la Etapa v2.2.0)
    capasBase: null,
    capaBaseActual: null,
    puntos: null,               // ultimo dataset de getMapaNE ya recibido (para buscar sin refetch, ver Etapa 1A)
    markersPorMonitoringId: {}, // se reconstruye en cada renderPuntos() - permite centrar+abrir popup de un resultado de busqueda
    busquedaActiva: false,
    contextoActual: null,
    aperturaId: 0
  };

  function mapaNEController_crearMapaSiHaceFalta() {
    if (mapaNEEstado.mapa) {
      return;
    }
    mapaNEEstado.mapa = L.map('mapa-ne-leaflet', { zoomControl: true }).setView([-34.6, -68.6], 7);
    mapaNEEstado.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
    mapaNEEstado.capasBase = mapaShared_crearCapasBase(mapaNEEstado.mapa);

    // L.featureGroup (no L.layerGroup a secas): necesitamos getBounds()
    // para el fitBounds() inicial en mapaNEController_renderPuntos -
    // L.layerGroup no expone ese metodo, solo L.featureGroup (que lo
    // extiende). Bug real encontrado probando esta pantalla en vivo.
    mapaNEEstado.capaPuntos = L.featureGroup();
    mapaNEEstado.mapa.addLayer(mapaNEEstado.capaPuntos);
  }

  function mapaNEController_cambiarCapaBase(id) {
    mapaShared_cambiarCapaBase(mapaNEEstado, id, capaBaseChipsEls);
  }

  function mapaNEController_renderPuntos(puntos, contexto) {
    mapaNEEstado.puntos = puntos;
    mapaNEEstado.capaPuntos.clearLayers();
    mapaNEEstado.markersPorMonitoringId = {};
    var markers = puntos.map(function (p) {
      var marker = mapaShared_crearMarkerNE(p, contexto);
      mapaNEEstado.markersPorMonitoringId[p.monitoringId] = marker;
      return marker;
    });
    markers.forEach(function (m) { mapaNEEstado.capaPuntos.addLayer(m); });

    contadorEl.hidden = false;
    contadorEl.textContent = puntos.length + ' puntos de monitoreo';

    if (markers.length > 0) {
      mapaNEEstado.mapa.fitBounds(mapaNEEstado.capaPuntos.getBounds().pad(0.05));
    }
  }

  // --- Buscador en el mapa NE (Etapa 1A) ---
  // 100% local sobre mapaNEEstado.puntos (ya cargado) - sin filtros que
  // puedan ocultar un resultado en esta etapa, asi que a diferencia de
  // Pozos Provincia nunca hace falta el aviso "fuera del filtro": todo
  // resultado de busqueda SIEMPRE tiene un marker vivo en el mapa.
  var MAPA_NE_ZOOM_BUSQUEDA = 13;

  function mapaNEController_centrarYAbrirPopup(marker) {
    var zoomObjetivo = Math.max(mapaNEEstado.mapa.getZoom(), MAPA_NE_ZOOM_BUSQUEDA);
    var yaEstaAhi = mapaNEEstado.mapa.getZoom() === zoomObjetivo &&
      mapaNEEstado.mapa.getCenter().distanceTo(marker.getLatLng()) < 1;
    if (yaEstaAhi) {
      marker.openPopup();
    } else {
      mapaNEEstado.mapa.once('moveend', function () {
        marker.openPopup();
      });
      mapaNEEstado.mapa.setView(marker.getLatLng(), zoomObjetivo);
    }
  }

  function mapaNEController_cerrarPanelBusqueda() {
    mapaNEEstado.busquedaActiva = false;
    btnBuscarToggleEl.classList.remove('active');
    btnBuscarToggleEl.setAttribute('aria-pressed', 'false');
    btnBuscarToggleEl.setAttribute('aria-expanded', 'false');
    panelBuscarEl.hidden = true;
    inputBuscarEl.value = '';
    resultadosBuscarEl.innerHTML = '';
  }

  function mapaNEController_toggleBusqueda() {
    if (mapaNEEstado.busquedaActiva) {
      mapaNEController_cerrarPanelBusqueda();
      return;
    }
    mapaNEEstado.busquedaActiva = true;
    btnBuscarToggleEl.classList.add('active');
    btnBuscarToggleEl.setAttribute('aria-pressed', 'true');
    btnBuscarToggleEl.setAttribute('aria-expanded', 'true');
    panelBuscarEl.hidden = false;
    inputBuscarEl.value = '';
    resultadosBuscarEl.innerHTML = '';
    inputBuscarEl.focus();
  }

  function mapaNEController_buscarSeleccionar(resultado) {
    mapaNEController_cerrarPanelBusqueda();
    var marker = mapaNEEstado.markersPorMonitoringId[resultado.monitoringId];
    if (marker) {
      mapaNEController_centrarYAbrirPopup(marker);
    }
  }

  function mapaNEController_renderResultadosBusqueda(query) {
    resultadosBuscarEl.innerHTML = '';
    if (!query || !query.trim()) {
      return;
    }

    var resultados = mapaLogic_buscarPuntosNE(mapaNEEstado.puntos || [], query, 6);
    if (resultados.length === 0) {
      var vacio = document.createElement('p');
      vacio.className = 'mapa-buscar-sin-resultados';
      vacio.textContent = 'Sin resultados.';
      resultadosBuscarEl.appendChild(vacio);
      return;
    }

    resultados.forEach(function (r) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mapa-buscar-resultado';

      var idEl = document.createElement('span');
      idEl.className = 'mapa-buscar-resultado-id';
      idEl.textContent = r.wellId || mapaLogic_nombrePuntoNE(r);
      btn.appendChild(idEl);

      // Punto con wellId y nombreOriginal, o punto especial identificado
      // por nombreOriginal: la sub-linea muestra lo que el titulo no dijo
      // ya - nunca inventa nada que no venga del dataset.
      var sub = r.wellId ? r.nombreOriginal : (r.nombreOriginal ? r.monitoringId : null);
      if (sub) {
        var subEl = document.createElement('span');
        subEl.className = 'mapa-buscar-resultado-sub';
        subEl.textContent = sub;
        btn.appendChild(subEl);
      }

      btn.addEventListener('click', function () {
        mapaNEController_buscarSeleccionar(r);
      });
      resultadosBuscarEl.appendChild(btn);
    });
  }

  function mapaNEController_mostrarError(aperturaId, mensaje) {
    if (aperturaId !== mapaNEEstado.aperturaId) {
      return;
    }
    loadingEl.hidden = true;
    mapaEl.hidden = true;
    errorMensajeEl.textContent = mensaje;
    errorEl.hidden = false;
  }

  function mapaNEController_mensajeError(code) {
    if (code === 'PERMISSION_DENIED') {
      return 'No tenés permiso para ver la red de Niveles Estáticos.';
    }
    if (code === 'MAPA_NE_NOT_FOUND') {
      return 'El mapa de Niveles Estáticos todavía no está disponible.';
    }
    if (code === 'UNAUTHORIZED' || code === 'USER_DISABLED') {
      return 'Tu sesión ya no es válida. Volvé a iniciar sesión.';
    }
    return 'No se pudo cargar el mapa. Intentá de nuevo.';
  }

  // Punto de entrada unico (ver window.mapaNEController_abrir al final).
  // Gateado EXCLUSIVAMENTE por permisos.ne - "ubicacion" nunca entra en
  // esta decision (requisito central: el mapa NE no depende del permiso
  // de Pozos Provincia).
  function mapaNEController_abrir(contexto) {
    mapaNEEstado.aperturaId += 1;
    var aperturaId = mapaNEEstado.aperturaId;
    mapaNEEstado.contextoActual = contexto;

    loadingEl.hidden = false;
    errorEl.hidden = true;
    mapaEl.hidden = true;
    contadorEl.hidden = true;
    mapaNEController_cerrarPanelBusqueda();

    if (!contexto.permisos || !contexto.permisos.ne) {
      // Defensa en profundidad: el acceso a esta pantalla ya deberia
      // estar bloqueado por mapaLogic_determinarAccesoMapas en app.js,
      // pero si de todas formas se llega aca, nunca se dispara el fetch.
      mapaNEController_mostrarError(aperturaId, 'No tenés permiso para ver la red de Niveles Estáticos.');
      return;
    }

    mapaShared_cargarLibrerias().then(function () {
      if (aperturaId !== mapaNEEstado.aperturaId) {
        return null;
      }
      mapaNEController_crearMapaSiHaceFalta();
      // Dataset compartido con el filtro "Tiene: Niveles estáticos" de
      // Pozos Provincia (js/mapaNEDataset.js) - si ya se cargo desde
      // ahi, esto no vuelve a pedirlo a Apps Script, y viceversa.
      return mapaNEDataset_obtener(contexto.sessionToken);
    }).then(function (result) {
      if (!result || aperturaId !== mapaNEEstado.aperturaId) {
        return;
      }
      if (result.status !== 'ok') {
        mapaNEController_mostrarError(aperturaId, mapaNEController_mensajeError(result.code));
        return;
      }

      loadingEl.hidden = true;
      mapaEl.hidden = false;
      mapaNEEstado.mapa.invalidateSize();

      mapaNEController_renderPuntos(result.data.puntos, contexto);
    }).catch(function () {
      mapaNEController_mostrarError(aperturaId, 'No se pudo cargar el mapa. Revisá tu conexión.');
    });
  }

  // Se llama al salir de la pantalla (boton Volver/Mapas). No destruye
  // la instancia de Leaflet (el contenedor sigue vivo en el DOM, solo
  // queda hidden) - mismo criterio que mapaController_cerrar en
  // js/mapa.js.
  function mapaNEController_cerrar() {
    mapaNEEstado.aperturaId += 1;
  }

  capaBaseChipsEls.forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapaNEController_cambiarCapaBase(chip.getAttribute('data-capa'));
    });
  });

  btnReintentar.addEventListener('click', function () {
    if (mapaNEEstado.contextoActual) {
      mapaNEController_abrir(mapaNEEstado.contextoActual);
    }
  });

  btnBuscarToggleEl.addEventListener('click', mapaNEController_toggleBusqueda);
  btnBuscarCerrarEl.addEventListener('click', mapaNEController_cerrarPanelBusqueda);
  inputBuscarEl.addEventListener('input', function () {
    mapaNEController_renderResultadosBusqueda(inputBuscarEl.value);
  });

  window.mapaNEController_abrir = mapaNEController_abrir;
  window.mapaNEController_cerrar = mapaNEController_cerrar;
})();
