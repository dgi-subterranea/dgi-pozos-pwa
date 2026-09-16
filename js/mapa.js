// Mapa de Pozos: controlador DOM/Leaflet. No se testea con Jest (toca
// DOM/fetch/Leaflet en vivo, igual que js/app.js) - la logica que vale
// la pena probar sin navegador vive en js/mapaLogic.js. Se verifica a
// mano en el navegador.
//
// API publica (las unicas 2 funciones que app.js llama, ver
// window.mapaController_* al final): mapaController_abrir(contexto) y
// mapaController_cerrar(). contexto = {sessionToken, permisos,
// onAbrirPozo(wellId)} - app.js es SIEMPRE quien decide sessionToken y
// permisos vigentes (los lee de su propio estado privado en el momento
// del click), este archivo nunca los cachea mas alla de una apertura.
(function () {
  var MAPA_COLOR_CONFIRMADA = '#0b5a7a';
  var MAPA_COLOR_DISPONIBLE = '#4fa3c4';

  // Proveedor de tiles: unico lugar que sabe la URL/atribucion de OSM.
  // Cambiar de proveedor (ej. a uno con distinto limite de uso) es tocar
  // solo esto, nunca el resto de la arquitectura del mapa (aprobado -
  // ver Etapa 5B/5C, adjustment #7).
  var MAPA_TILE_PROVIDER = {
    urlTemplate: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    subdomains: 'abc',
    maxZoom: 19
  };

  var mapaEstado = {
    mapa: null,           // instancia L.Map, se crea UNA sola vez (el contenedor sigue vivo en el DOM aunque la pantalla este hidden)
    clusterGroup: null,   // L.markerClusterGroup, se crea junto con mapa.mapa
    puntosCrudos: null,   // ultimo dataset recibido de getMapaPozos (para filtrar sin refetch)
    contextoActual: null, // {sessionToken, permisos, onAbrirPozo} de la apertura en curso
    aperturaId: 0          // se incrementa en cada apertura/cierre - una respuesta de red de una apertura vieja se descarta si ya cambio (mismo patron de staleness que buscarPozo en app.js)
  };

  var loadingEl = document.getElementById('mapa-loading');
  var errorEl = document.getElementById('mapa-error');
  var errorMensajeEl = document.getElementById('mapa-error-mensaje');
  var mapaEl = document.getElementById('mapa-leaflet');
  var contadorEl = document.getElementById('mapa-contador');
  var filtroSelect = document.getElementById('mapa-filtro-departamento');
  var btnReintentar = document.getElementById('btn-mapa-reintentar');

  function mapaController_cargarScript(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error('No se pudo cargar ' + src)); };
      document.body.appendChild(script);
    });
  }

  function mapaController_cargarCSS(href) {
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    document.head.appendChild(link);
  }

  var mapaLibreriasPromise = null;

  // Carga diferida real: Leaflet/Leaflet.markercluster (vendorizados
  // localmente en vendor/, nunca por CDN - aprobado, ver adjustment #7)
  // no se referencian en el <head> del documento - recien se inyectan la
  // PRIMERA vez que se abre el mapa. La promesa se cachea: una segunda
  // apertura en la misma sesion de pagina no vuelve a pedir los scripts.
  function mapaController_cargarLibrerias() {
    if (mapaLibreriasPromise) {
      return mapaLibreriasPromise;
    }
    mapaController_cargarCSS('vendor/leaflet/leaflet.css');
    mapaController_cargarCSS('vendor/leaflet.markercluster/MarkerCluster.css');
    mapaController_cargarCSS('vendor/leaflet.markercluster/MarkerCluster.Default.css');

    mapaLibreriasPromise = mapaController_cargarScript('vendor/leaflet/leaflet.js')
      .then(function () { return mapaController_cargarScript('vendor/leaflet.markercluster/leaflet.markercluster.js'); });
    return mapaLibreriasPromise;
  }

  function mapaController_crearMapaSiHaceFalta() {
    if (mapaEstado.mapa) {
      return;
    }
    mapaEstado.mapa = L.map('mapa-leaflet', { zoomControl: true }).setView([-34.6, -68.6], 7);
    L.tileLayer(MAPA_TILE_PROVIDER.urlTemplate, {
      attribution: MAPA_TILE_PROVIDER.attribution,
      subdomains: MAPA_TILE_PROVIDER.subdomains,
      maxZoom: MAPA_TILE_PROVIDER.maxZoom
    }).addTo(mapaEstado.mapa);

    mapaEstado.clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 16
    });
    mapaEstado.mapa.addLayer(mapaEstado.clusterGroup);
  }

  // Contenido inicial del popup: SOLO wellId + estado + boton "Abrir
  // pozo" - disponible de inmediato, sin ningun fetch (ver adjustment #2
  // de la Etapa 5B/5C: "wellId inmediato"). summaryEl queda vacio, listo
  // para que el listener de popupopen lo llene si corresponde.
  function mapaController_construirPopupInicial(punto, contexto) {
    var el = document.createElement('div');
    el.className = 'mapa-popup';

    var idEl = document.createElement('p');
    idEl.className = 'mapa-popup-id mono';
    idEl.textContent = punto.wellId;
    el.appendChild(idEl);

    var estadoEl = document.createElement('p');
    estadoEl.className = 'mapa-popup-estado';
    estadoEl.textContent = mapaLogic_estadoLabel(punto.estado);
    el.appendChild(estadoEl);

    var summaryEl = document.createElement('div');
    summaryEl.className = 'mapa-popup-summary';
    el.appendChild(summaryEl);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button mapa-popup-btn';
    btn.textContent = 'Abrir pozo';
    btn.addEventListener('click', function () {
      contexto.onAbrirPozo(punto.wellId);
    });
    el.appendChild(btn);

    return { el: el, summaryEl: summaryEl };
  }

  // El summary (titular/departamento/distrito) NUNCA se pide para los
  // 13 mil puntos de una - solo cuando el usuario abre ese popup
  // puntual, y solo una vez por marker (yaConsultado). Si datos=NO, el
  // popup se queda con wellId + estado + Abrir pozo nada mas - nunca se
  // dispara el fetch (ver mapaLogic_debeConsultarSummary).
  function mapaController_crearMarker(punto, contexto) {
    var color = punto.estado === 'C' ? MAPA_COLOR_CONFIRMADA : MAPA_COLOR_DISPONIBLE;
    var marker = L.circleMarker([punto.lat, punto.lon], {
      radius: 7,
      color: '#ffffff',
      weight: 1.5,
      fillColor: color,
      fillOpacity: 0.9
    });

    var popupContent = mapaController_construirPopupInicial(punto, contexto);
    marker.bindPopup(popupContent.el);

    var yaConsultado = false;
    marker.on('popupopen', function () {
      if (yaConsultado || !mapaLogic_debeConsultarSummary(contexto.permisos)) {
        return;
      }
      yaConsultado = true;
      popupContent.summaryEl.textContent = 'Cargando datos...';

      apiGetWellSummary(contexto.sessionToken, punto.wellId).then(function (result) {
        popupContent.summaryEl.innerHTML = '';
        if (result.status === 'ok') {
          var data = result.data;
          if (data.titular) {
            var titularEl = document.createElement('p');
            titularEl.className = 'mapa-popup-titular';
            titularEl.textContent = data.titular;
            popupContent.summaryEl.appendChild(titularEl);
          }
          var sub = [data.departamento, data.distrito].filter(Boolean).join(' · ');
          if (sub) {
            var subEl = document.createElement('p');
            subEl.className = 'mapa-popup-sub';
            subEl.textContent = sub;
            popupContent.summaryEl.appendChild(subEl);
          }
        }
        marker.getPopup().update();
      }).catch(function () {
        popupContent.summaryEl.textContent = '';
        marker.getPopup().update();
      });
    });

    return marker;
  }

  function mapaController_poblarFiltroDepartamento(pozos) {
    var valorPrevio = filtroSelect.value;
    var opciones = mapaLogic_construirOpcionesDepartamento(pozos);

    filtroSelect.innerHTML = '';
    var optTodos = document.createElement('option');
    optTodos.value = 'todos';
    optTodos.textContent = 'Todos los departamentos (' + pozos.length + ')';
    filtroSelect.appendChild(optTodos);

    opciones.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.codigo;
      opt.textContent = o.nombre + ' (' + o.cantidad + ')';
      filtroSelect.appendChild(opt);
    });

    var siguesValido = Array.prototype.some.call(filtroSelect.options, function (opt) {
      return opt.value === valorPrevio;
    });
    filtroSelect.value = siguesValido ? valorPrevio : 'todos';
  }

  function mapaController_renderPuntos(contexto) {
    var filtrados = mapaLogic_filtrarPorDepartamento(mapaEstado.puntosCrudos, filtroSelect.value);

    mapaEstado.clusterGroup.clearLayers();
    var markers = filtrados.map(function (p) { return mapaController_crearMarker(p, contexto); });
    mapaEstado.clusterGroup.addLayers(markers);

    contadorEl.hidden = false;
    contadorEl.textContent = filtrados.length + ' de ' + mapaEstado.puntosCrudos.length + ' pozos';

    if (filtrados.length > 0) {
      mapaEstado.mapa.fitBounds(mapaEstado.clusterGroup.getBounds().pad(0.05));
    }
  }

  function mapaController_mostrarError(aperturaId, mensaje) {
    if (aperturaId !== mapaEstado.aperturaId) {
      return;
    }
    loadingEl.hidden = true;
    mapaEl.hidden = true;
    errorMensajeEl.textContent = mensaje;
    errorEl.hidden = false;
  }

  function mapaController_mensajeError(code) {
    if (code === 'PERMISSION_DENIED') {
      return 'No tenés permiso para ver el mapa de pozos.';
    }
    if (code === 'MAPA_NOT_FOUND') {
      return 'El mapa todavía no está disponible.';
    }
    if (code === 'UNAUTHORIZED' || code === 'USER_DISABLED') {
      return 'Tu sesión ya no es válida. Volvé a iniciar sesión.';
    }
    return 'No se pudo cargar el mapa. Intentá de nuevo.';
  }

  // Punto de entrada unico (ver window.mapaController_abrir al final).
  // aperturaId descarta cualquier respuesta tardia de una apertura
  // anterior - mismo patron de staleness que buscarPozo() en app.js: el
  // guard nunca aborta el fetch en si (ya salio, no se puede cancelar un
  // fetch), solo impide que pise el estado de una apertura mas nueva.
  function mapaController_abrir(contexto) {
    mapaEstado.aperturaId += 1;
    var aperturaId = mapaEstado.aperturaId;
    mapaEstado.contextoActual = contexto;

    loadingEl.hidden = false;
    errorEl.hidden = true;
    mapaEl.hidden = true;
    contadorEl.hidden = true;

    if (!contexto.permisos || !contexto.permisos.ubicacion) {
      // Defensa en profundidad: el boton de acceso (btn-abrir-mapa) ya
      // deberia estar oculto sin este permiso (ver toggleAccesoMapa en
      // app.js), pero si de todas formas se llega aca, nunca se dispara
      // el fetch.
      mapaController_mostrarError(aperturaId, 'No tenés permiso para ver el mapa de pozos.');
      return;
    }

    mapaController_cargarLibrerias().then(function () {
      if (aperturaId !== mapaEstado.aperturaId) {
        return null;
      }
      mapaController_crearMapaSiHaceFalta();
      return apiGetMapaPozos(contexto.sessionToken);
    }).then(function (result) {
      if (!result || aperturaId !== mapaEstado.aperturaId) {
        return;
      }
      if (result.status !== 'ok') {
        mapaController_mostrarError(aperturaId, mapaController_mensajeError(result.code));
        return;
      }

      mapaEstado.puntosCrudos = result.data.pozos;

      // El contenedor tiene que estar visible y con su tamano real ANTES
      // de fitBounds() (dentro de renderPuntos): con el contenedor todavia
      // [hidden] (0x0), Leaflet calcula un zoom degenerado (todo el
      // mundo) en vez de encuadrar los puntos. invalidateSize() primero,
      // renderPuntos() despues - en ese orden.
      loadingEl.hidden = true;
      mapaEl.hidden = false;
      mapaEstado.mapa.invalidateSize();

      mapaController_poblarFiltroDepartamento(mapaEstado.puntosCrudos);
      mapaController_renderPuntos(contexto);
    }).catch(function () {
      mapaController_mostrarError(aperturaId, 'No se pudo cargar el mapa. Revisá tu conexión.');
    });
  }

  // Se llama al salir de la pantalla del mapa (boton Volver). No destruye
  // la instancia de Leaflet (el contenedor sigue vivo en el DOM, solo
  // queda hidden) - una reapertura reusa mapa/clusterGroup, mas rapida
  // que recrear todo. Solo invalida cualquier fetch todavia en vuelo.
  function mapaController_cerrar() {
    mapaEstado.aperturaId += 1;
  }

  filtroSelect.addEventListener('change', function () {
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  });

  btnReintentar.addEventListener('click', function () {
    if (mapaEstado.contextoActual) {
      mapaController_abrir(mapaEstado.contextoActual);
    }
  });

  window.mapaController_abrir = mapaController_abrir;
  window.mapaController_cerrar = mapaController_cerrar;
})();
