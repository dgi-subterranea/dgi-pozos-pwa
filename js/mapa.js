// Mapa de Pozos: controlador DOM/Leaflet. No se testea con Jest (toca
// DOM/fetch/Leaflet en vivo, igual que js/app.js) - la logica que vale
// la pena probar sin navegador vive en js/mapaLogic.js. Se verifica a
// mano en el navegador.
//
// API publica (las unicas 2 funciones que app.js llama, ver
// window.mapaController_* al final): mapaController_abrir(contexto) y
// mapaController_cerrar(). contexto = {sessionToken, permisos,
// onAbrirPozo(wellId), enfoque} - app.js es SIEMPRE quien decide
// sessionToken y permisos vigentes (los lee de su propio estado privado
// en el momento del click), este archivo nunca los cachea mas alla de
// una apertura.
//
// enfoque (opcional, usado por "Ver en mapa"/"Ver todos en el mapa" de
// Cerca Mio - ver js/cercaMio.js):
//   {tipo: 'pozo', wellId}                        - centra y abre el popup de ESE pozo
//   {tipo: 'ubicacion', lat, lon, radioMetros}     - centra en esas coordenadas (la posicion GPS del usuario, que SOLO viaja de app.js a aca en memoria - nunca se manda a ningun backend) y agrega el marcador "Tu ubicacion"
//   {tipo: 'puntoBusqueda', lat, lon, radioMetros} - idem, pero para un punto elegido a mano en el mapa (Etapa siguiente, item B/D) en vez de GPS: marcador y circulo de radio con otro color (mapaShared_iconoPuntoBusqueda), misma garantia de privacidad (solo memoria, nunca a ningun backend)
(function () {
  var MAPA_COLOR_CONFIRMADA = '#0b5a7a';
  var MAPA_COLOR_DISPONIBLE = '#4fa3c4';
  // Mismo valor que disableClusteringAtZoom del clusterGroup (ver
  // mapaController_crearMapaSiHaceFalta) - a este zoom un marker
  // individual deja de estar agrupado, sin importar cuantos vecinos
  // tenga. mapaController_aplicarEnfoque lo reusa para "Ver en mapa" de
  // un pozo puntual: centrar ahi con setView() (no zoomToShowLayer, ver
  // comentario en esa funcion) garantiza que el marker exista de verdad
  // en el mapa antes de abrirle el popup.
  var MAPA_ZOOM_INDIVIDUAL = 16;

  // Proveedores de tiles, carga diferida de Leaflet y capas base:
  // js/mapaShared.js (arquitectura de 2 mapas, v2.2.0) - compartido con
  // el mapa independiente de Niveles Estaticos (js/mapaNE.js), para no
  // duplicar la config ni la carga de las librerias entre los 2.

  // "Todos" es aparte (siempre visible, nunca cuenta para el +N mas) -
  // ver mapaController_renderChipsDepartamento. Estos son la cantidad de
  // chips REALES de departamento que se muestran de entrada; el resto
  // queda detras de "+N mas" hasta expandir. Mas en desktop porque hay
  // mas ancho disponible (aprobado - ver punto 4 de la Etapa v2.1.0).
  var CANTIDAD_CHIPS_DEPTO_MOBILE = 4;
  var CANTIDAD_CHIPS_DEPTO_DESKTOP = 8;
  var BREAKPOINT_DESKTOP_PX = 640; // mismo breakpoint que css/styles.css

  var mapaEstado = {
    mapa: null,              // instancia L.Map, se crea UNA sola vez (el contenedor sigue vivo en el DOM aunque la pantalla este hidden)
    clusterGroup: null,      // L.markerClusterGroup, se crea junto con mapa.mapa
    capasBase: null,         // {calle, satelite}: los 2 L.tileLayer, creados una sola vez junto con mapa.mapa - cambiar de capa nunca recrea el mapa ni los puntos
    capaBaseActual: MAPA_CAPA_BASE_DEFAULT,
    puntosCrudos: null,      // ultimo dataset recibido de getMapaPozos (para filtrar sin refetch)
    opcionesDepartamento: [],// ultimo resultado de mapaLogic_construirOpcionesDepartamento (cache: expandir/contraer "+N mas" no recalcula nada)
    // Unificacion UX (con el mapa NE): TODO grupo multi-seleccion usa el
    // mismo modelo - mapa disperso {valor: true}, vacio == "Todos" (ver
    // mapaLogic_toggleFiltroMultiple en js/mapaLogic.js). PERSISTEN entre
    // aperturas normales (solo se resetean con enfoque:{tipo:'pozo'}, ver
    // mapaController_abrir).
    departamentoActivos: {},
    opcionesCuenca: [],      // mapaLogic_construirOpcionesCampoNE sobre 'cuenca' (reusa la funcion generica ya usada para Cuenca/Zona en el mapa NE, nunca la duplica)
    cuencaActivos: {},
    estadosActivos: {},      // chips Ubicacion (Confirmada/Disponible)
    deptosExpandido: false,  // true = "+N mas" ya tocado, se ven todos los chips de departamento
    markersPorWellId: {},    // se reconstruye en cada renderPuntos() - permite ubicar el marker de un wellId puntual para enfoque:{tipo:'pozo'}
    neWellIdSet: null,       // Set de wellId de la red NE (mapaLogic_setWellIdNE sobre getMapaNE) - se arma UNA sola vez, la PRIMERA vez que se activa el filtro "Tiene: Niveles estáticos" (carga diferida real)
    neActivo: false,         // estado del filtro "Tiene: Niveles estáticos" (v2.2.0: filtro sobre el padron, NO una capa aparte - ver mapaController_renderPuntos, que lo combina con AND junto a departamento/estado)
    indiceBusqueda: null,    // mapa wellId->{nc16,titular} (mapaLogic_indiceBusquedaPorWellId sobre getIndiceBusquedaProvincia) - se arma UNA sola vez, la PRIMERA vez que el usuario escribe algo en el buscador (Etapa 1A, carga diferida real, nunca al abrir el mapa). NC16 y titular viajan juntos, gateados por "datos" - ver decision de arquitectura en MapaService.js
    busquedaActiva: false,   // true = el panel del buscador esta desplegado
    filtrosActivo: false,    // true = el panel de filtros esta desplegado (unificacion UX con el mapa NE - oculto por default)
    profundidadDesde: null,  // numero o null (sin filtro ese extremo) - "Profundidad DEL POZO" (profundidadTotal)
    profundidadHasta: null,
    tramoDesde: null,        // "Profundidad DE FILTROS" (tramosFiltrantes) - CONCEPTO DISTINTO del de arriba, nunca mezclar
    tramoHasta: null,
    opcionesCondicion: [],   // mapaLogic_construirOpcionesCampoNE sobre 'surgencia' (reusa la misma funcion generica, sin duplicar)
    condicionActivos: {},    // multi-seleccion OR, mismo modelo que el resto
    marcadorBusquedaTemporal: null, // marker de "Mostrarlo igual" para un resultado de busqueda que los filtros activos esconden - se saca en cuanto cambia cualquier filtro o se abre una busqueda nueva, nunca sobrevive a eso
    contextoActual: null,    // {sessionToken, permisos, onAbrirPozo, onSeleccionarPorRadio, enfoque} de la apertura en curso
    aperturaId: 0,            // se incrementa en cada apertura/cierre - una respuesta de red de una apertura vieja se descarta si ya cambio (mismo patron de staleness que buscarPozo en app.js)

    // Etapa "seleccion multiple + lote" (item C/J): estado del dibujo de
    // poligono, PURAMENTE local a esta pantalla - nunca sale de aca salvo
    // como lista de wellId (ver mapaController_usarSeleccionPoligono ->
    // seleccionController_proponerSeleccion).
    dibujando: false,
    verticesPoligono: [],        // [{lat,lon}] en el orden en que se tocaron
    marcadoresVerticesLayer: null, // L.LayerGroup con un circleMarker por vertice + L.Polyline provisional
    poligonoCerradoLayer: null,   // L.Polygon semitransparente, solo mientras se revisa el resultado ANTES de "Usar seleccion"
    ultimosWellIdsPoligono: [],   // resultado de seleccionLogic_filtrarPorPoligono del ultimo "Cerrar área", listo para "Usar selección"

    // Contexto geografico (ajuste UX): lo que el mapa dibuja de la
    // seleccion confirmada o de la vista previa de Cerca Mio - poligono o
    // punto+radio - y sobre lo que pueden actuar los filtros. Todo se
    // re-deriva de seleccionController_obtenerContextoGeografico() en cada
    // renderPuntos, asi que sobrevive a cualquier navegacion/reapertura
    // sin guardar copias aca (la fuente de verdad es js/seleccion.js).
    contextoLayer: null,          // L.LayerGroup con poligono, o punto de referencia + circulo de radio
    alcance: 'todo',              // 'todo' = todos los pozos (el contexto solo resaltado) | 'solo' = solo los del contexto (AND con los filtros). Vuelve a 'todo' cuando el contexto cambia de verdad (ver claveContexto)
    claveContexto: '',            // seleccionLogic_claveContexto del ultimo contexto visto
    setResaltado: null,           // Set de wellId del contexto vigente, armado una vez por renderPuntos (lo lee crearMarker)

    // Conteos contextuales de los chips (ver mapaController_actualizarConteosChips):
    // las opciones *Global son las del padron completo (orden/nombres) y
    // las de arriba (opcionesDepartamento/Cuenca/Condicion) llevan la
    // cantidad del universo vigente (todo el padron, o solo el contexto).
    opcionesDepartamentoGlobal: [],
    opcionesCuencaGlobal: [],
    opcionesCondicionGlobal: [],
    claveUniverso: null,          // clave del universo cuyos conteos estan pintados (null = recalcular)
    totalUniverso: 0,             // "Todos (N)" de Departamento
    conteoEstado: null,           // {C, D} del universo
    conteoNE: null                // pozos del universo en la red NE (null mientras el Set NE no se cargo)
  };

  var loadingEl = document.getElementById('mapa-loading');
  var errorEl = document.getElementById('mapa-error');
  var errorMensajeEl = document.getElementById('mapa-error-mensaje');
  var mapaEl = document.getElementById('mapa-leaflet');
  var contadorEl = document.getElementById('mapa-contador');
  var deptosChipsEl = document.getElementById('mapa-deptos-chips');
  var btnDeptosExpandirEl = document.getElementById('btn-mapa-deptos-expandir');
  var cuencaChipsEl = document.getElementById('mapa-cuenca-chips');
  var btnFiltrosToggleEl = document.getElementById('btn-mapa-filtros-toggle');
  var panelFiltrosEl = document.getElementById('mapa-filtros-panel');
  var btnLimpiarFiltrosEl = document.getElementById('btn-mapa-limpiar-filtros');
  var estadoChipsEls = Array.prototype.slice.call(document.querySelectorAll('.mapa-estado-chip'));
  var capaBaseChipsEls = Array.prototype.slice.call(document.querySelectorAll('.mapa-capa-chip'));
  var grupoTieneEl = document.getElementById('mapa-grupo-tiene');
  var chipNEEl = document.getElementById('mapa-chip-ne');
  var btnReintentar = document.getElementById('btn-mapa-reintentar');
  var btnBuscarToggleEl = document.getElementById('btn-mapa-buscar-toggle');
  var panelBuscarEl = document.getElementById('mapa-buscar-panel');
  var inputBuscarEl = document.getElementById('mapa-buscar-input');
  var btnBuscarCerrarEl = document.getElementById('btn-mapa-buscar-cerrar');
  var resultadosBuscarEl = document.getElementById('mapa-buscar-resultados');
  var inputProfundidadDesdeEl = document.getElementById('mapa-profundidad-desde');
  var inputProfundidadHastaEl = document.getElementById('mapa-profundidad-hasta');
  var errorProfundidadEl = document.getElementById('mapa-profundidad-error');
  var btnProfundidadLimpiarEl = document.getElementById('btn-mapa-profundidad-limpiar');
  var inputTramoDesdeEl = document.getElementById('mapa-tramo-desde');
  var inputTramoHastaEl = document.getElementById('mapa-tramo-hasta');
  var errorTramoEl = document.getElementById('mapa-tramo-error');
  var btnTramoLimpiarEl = document.getElementById('btn-mapa-tramo-limpiar');
  var condicionChipsEl = document.getElementById('mapa-condicion-chips');
  var btnSeleccionarToggleEl = document.getElementById('btn-mapa-seleccionar-toggle');
  var seleccionarMenuEl = document.getElementById('mapa-seleccionar-menu');
  var btnSeleccionarRadioEl = document.getElementById('btn-mapa-seleccionar-radio');
  var btnSeleccionarPoligonoEl = document.getElementById('btn-mapa-seleccionar-poligono');
  var contextoBarraEl = document.getElementById('mapa-contexto-barra');
  var contextoTituloEl = document.getElementById('mapa-contexto-titulo');
  var contextoEstadoEl = document.getElementById('mapa-contexto-estado');
  var btnAlcanceTodoEl = document.getElementById('btn-mapa-alcance-todo');
  var btnAlcanceSoloEl = document.getElementById('btn-mapa-alcance-solo');
  var btnContextoUsarEl = document.getElementById('btn-mapa-contexto-usar');
  var btnContextoQuitarEl = document.getElementById('btn-mapa-contexto-quitar');
  var dibujoPanelEl = document.getElementById('mapa-dibujo-panel');
  var dibujoMensajeEl = document.getElementById('mapa-dibujo-mensaje');
  var dibujoAccionesDibujandoEl = document.getElementById('mapa-dibujo-acciones-dibujando');
  var dibujoAccionesCerradoEl = document.getElementById('mapa-dibujo-acciones-cerrado');
  var btnDibujoDeshacerEl = document.getElementById('btn-mapa-dibujo-deshacer');
  var btnDibujoCerrarEl = document.getElementById('btn-mapa-dibujo-cerrar');
  var btnDibujoCancelarEl = document.getElementById('btn-mapa-dibujo-cancelar');
  var btnDibujoUsarEl = document.getElementById('btn-mapa-dibujo-usar');
  var btnDibujoRedibujarEl = document.getElementById('btn-mapa-dibujo-redibujar');
  var btnDibujoCancelar2El = document.getElementById('btn-mapa-dibujo-cancelar-2');

  function mapaController_crearMapaSiHaceFalta() {
    if (mapaEstado.mapa) {
      return;
    }
    mapaEstado.mapa = L.map('mapa-leaflet', { zoomControl: true }).setView([-34.6, -68.6], 7);
    mapaEstado.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
    mapaEstado.capasBase = mapaShared_crearCapasBase(mapaEstado.mapa);

    mapaEstado.clusterGroup = L.markerClusterGroup({
      chunkedLoading: true,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: MAPA_ZOOM_INDIVIDUAL,
      // Mismo icono que el default de markercluster (misma tabla de
      // tamanos/clases) + un anillo magenta cuando el cluster CONTIENE
      // pozos del contexto geografico: con zoom alejado todo se agrupa y
      // sin esto el resaltado de los pozos seleccionados no se veria
      // hasta acercarse al zoom donde se desagrupan.
      iconCreateFunction: function (cluster) {
        var n = cluster.getChildCount();
        var tam = n < 10 ? 'small' : (n < 100 ? 'medium' : 'large');
        var conSeleccion = !!mapaEstado.setResaltado && cluster.getAllChildMarkers().some(function (m) {
          return m.options.esSeleccionado === true;
        });
        return L.divIcon({
          html: '<div><span>' + n + '</span></div>',
          className: 'marker-cluster marker-cluster-' + tam + (conSeleccion ? ' mapa-cluster-con-seleccion' : ''),
          iconSize: L.point(40, 40)
        });
      }
    });
    mapaEstado.mapa.addLayer(mapaEstado.clusterGroup);
    mapaController_registrarListenerSeleccion();

    // Item C: UN solo listener de click en el mapa, vive toda la vida de
    // la instancia - solo actua si mapaEstado.dibujando esta activo. Los
    // clicks sobre un marker individual no llegan aca (Leaflet no
    // propaga el click del marker al mapa), asi que tocar un pozo
    // mientras se dibuja no agrega un vertice por accidente.
    mapaEstado.mapa.on('click', function (e) {
      if (mapaEstado.dibujando) {
        mapaController_agregarVerticePoligono(e.latlng.lat, e.latlng.lng);
      }
    });
  }

  // Nunca recarga el dataset ni toca clusterGroup/markers/vista - ver
  // mapaShared_cambiarCapaBase (js/mapaShared.js), compartida con el
  // mapa NE independiente.
  function mapaController_cambiarCapaBase(id) {
    mapaShared_cambiarCapaBase(mapaEstado, id, capaBaseChipsEls);
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
    // Item J: un pozo del contexto geografico (seleccion confirmada o
    // vista previa de Cerca Mio) se distingue con un borde mas grueso en
    // MAPA_COLOR_SELECCION (el mismo magenta de poligono/circulo) - el
    // relleno sigue mostrando Confirmada/Disponible, nunca se pierde esa
    // info. Mismo L.circleMarker de siempre (no se agrega una capa
    // aparte), asi que el markercluster nunca se entera de la diferencia.
    // mapaEstado.setResaltado lo arma renderPuntos UNA vez por pasada (no
    // un Set nuevo por cada uno de los 13 mil markers).
    var seleccionado = !!mapaEstado.setResaltado && mapaEstado.setResaltado.has(punto.wellId);
    var marker = L.circleMarker([punto.lat, punto.lon], {
      radius: seleccionado ? 9 : 7,
      color: seleccionado ? MAPA_COLOR_SELECCION : '#ffffff',
      weight: seleccionado ? 3 : 1.5,
      fillColor: color,
      fillOpacity: 0.9,
      esSeleccionado: seleccionado // lo lee iconCreateFunction del clusterGroup
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

  // --- Buscador en el mapa (Etapa 1A) ---

  // Centra el mapa en un marker y le abre el popup - factorizado de
  // mapaController_aplicarEnfoque (tipo:'pozo') porque el buscador
  // necesita EXACTAMENTE el mismo comportamiento (zoom determinista al
  // nivel donde el clusterGroup desagrupa todo, esperar 'moveend' antes
  // de abrir el popup) para un resultado elegido en vivo.
  function mapaController_centrarYAbrirPopup(marker) {
    var yaEstaAhi = mapaEstado.mapa.getZoom() === MAPA_ZOOM_INDIVIDUAL &&
      mapaEstado.mapa.getCenter().distanceTo(marker.getLatLng()) < 1;
    if (yaEstaAhi) {
      marker.openPopup();
    } else {
      mapaEstado.mapa.once('moveend', function () {
        marker.openPopup();
      });
      mapaEstado.mapa.setView(marker.getLatLng(), MAPA_ZOOM_INDIVIDUAL);
    }
  }

  // El marker de "Mostrarlo igual" es SIEMPRE temporal: sobrevive solo
  // hasta el siguiente cambio de filtro o la siguiente busqueda - se
  // saca al principio de mapaController_renderPuntos (cualquier filtro
  // nuevo) y de mapaController_abrir (nueva apertura). Nunca se agrega
  // al clusterGroup (evita un marker duplicado si el filtro cambia y el
  // pozo empieza a cumplirlo).
  function mapaController_limpiarMarcadorBusquedaTemporal() {
    if (mapaEstado.marcadorBusquedaTemporal) {
      mapaEstado.mapa.removeLayer(mapaEstado.marcadorBusquedaTemporal);
      mapaEstado.marcadorBusquedaTemporal = null;
    }
  }

  function mapaController_cerrarPanelBusqueda() {
    mapaEstado.busquedaActiva = false;
    btnBuscarToggleEl.classList.remove('active');
    btnBuscarToggleEl.setAttribute('aria-pressed', 'false');
    btnBuscarToggleEl.setAttribute('aria-expanded', 'false');
    panelBuscarEl.hidden = true;
    inputBuscarEl.value = '';
    resultadosBuscarEl.innerHTML = '';
  }

  function mapaController_toggleBusqueda() {
    if (mapaEstado.busquedaActiva) {
      mapaController_cerrarPanelBusqueda();
      return;
    }
    mapaEstado.busquedaActiva = true;
    btnBuscarToggleEl.classList.add('active');
    btnBuscarToggleEl.setAttribute('aria-pressed', 'true');
    btnBuscarToggleEl.setAttribute('aria-expanded', 'true');
    panelBuscarEl.hidden = false;
    inputBuscarEl.value = '';
    resultadosBuscarEl.innerHTML = '';
    inputBuscarEl.focus();
  }

  // Muestra, en el mismo panel, un aviso de que el resultado elegido no
  // cumple los filtros activos + un boton para mostrarlo temporalmente
  // (aprobado: nunca resetear filtros en silencio, nunca dejarlo
  // simplemente afuera sin explicar por que).
  function mapaController_mostrarAvisoFueraDeFiltro(resultado, contexto) {
    resultadosBuscarEl.innerHTML = '';
    var aviso = document.createElement('div');
    aviso.className = 'mapa-buscar-aviso';

    var texto = document.createElement('span');
    texto.textContent = resultado.wellId + ' no cumple los filtros activos.';
    aviso.appendChild(texto);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mapa-buscar-aviso-btn';
    btn.textContent = 'Mostrarlo igual';
    btn.addEventListener('click', function () {
      mapaController_mostrarResultadoTemporalmente(resultado, contexto);
    });
    aviso.appendChild(btn);

    resultadosBuscarEl.appendChild(aviso);
  }

  function mapaController_mostrarResultadoTemporalmente(resultado, contexto) {
    mapaController_cerrarPanelBusqueda();
    mapaController_limpiarMarcadorBusquedaTemporal();
    var punto = { wellId: resultado.wellId, lat: resultado.lat, lon: resultado.lon, estado: resultado.estado };
    var marker = mapaController_crearMarker(punto, contexto);
    marker.addTo(mapaEstado.mapa);
    mapaEstado.marcadorBusquedaTemporal = marker;
    mapaController_centrarYAbrirPopup(marker);
  }

  // Si el wellId elegido ya tiene un marker vivo en el clusterGroup (pasa
  // los filtros actuales), se reusa ese - nunca se duplica. Si no, se
  // ofrece el aviso de arriba en vez de mostrarlo/ocultarlo sin avisar.
  function mapaController_buscarSeleccionar(resultado, contexto) {
    var marker = mapaEstado.markersPorWellId[resultado.wellId];
    if (marker) {
      mapaController_cerrarPanelBusqueda();
      mapaController_centrarYAbrirPopup(marker);
      return;
    }
    mapaController_mostrarAvisoFueraDeFiltro(resultado, contexto);
  }

  // Cada sugerencia muestra SIEMPRE el wellId, y ademas "NC16: ..."
  // cuando el match fue justamente por ahi (nunca en cada resultado -
  // solo cuando corresponde, para no generar ruido) y el titular cuando
  // existe y el indice esta cargado (datos=SI) - mismo criterio previo,
  // sin cambios: el titular es contexto util para identificar el pozo
  // aunque el match haya sido por wellId o NC16.
  function mapaController_renderResultadosBusqueda(query, contexto) {
    resultadosBuscarEl.innerHTML = '';
    if (!query || !query.trim()) {
      return;
    }

    var resultados = mapaLogic_buscarPozosProvincia(mapaEstado.puntosCrudos || [], mapaEstado.indiceBusqueda, query, 6);
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
      idEl.textContent = r.wellId;
      btn.appendChild(idEl);

      if (r.matchNc16) {
        var nc16El = document.createElement('span');
        nc16El.className = 'mapa-buscar-resultado-sub';
        nc16El.textContent = 'NC16: ' + r.nc16;
        btn.appendChild(nc16El);
      }

      if (r.titular) {
        var subEl = document.createElement('span');
        subEl.className = 'mapa-buscar-resultado-sub';
        subEl.textContent = r.titular;
        btn.appendChild(subEl);
      }

      btn.addEventListener('click', function () {
        mapaController_buscarSeleccionar(r, contexto);
      });
      resultadosBuscarEl.appendChild(btn);
    });
  }

  // Carga diferida real del indice de NC16+titular: NUNCA se pide al
  // abrir el mapa ni al desplegar el panel - solo la PRIMERA vez que el
  // usuario escribe algo (ver el listener de 'input' mas abajo), y solo
  // si tiene el permiso "datos". Sin datos=SI, el buscador sigue
  // funcionando (wellId, ya disponible sin fetch) pero nunca intenta
  // este indice - fail-closed, mismo criterio que el resto de los
  // datasets separados. NC16 nunca viaja por un camino distinto al de
  // titular (ver decision de arquitectura en MapaService.js).
  function mapaController_asegurarIndiceBusqueda(contexto) {
    if (!contexto.permisos || !contexto.permisos.datos || mapaEstado.indiceBusqueda) {
      return Promise.resolve();
    }
    return busquedaProvinciaDataset_obtener(contexto.sessionToken).then(function (result) {
      if (result.status === 'ok') {
        mapaEstado.indiceBusqueda = mapaLogic_indiceBusquedaPorWellId(result.data.pozos);
      }
    }).catch(function () {
      // Sin indice cargado, la busqueda sigue funcionando solo por
      // wellId - no hace falta mostrar un error por esto.
    });
  }

  // Toggle del filtro "Tiene: Niveles estáticos" (v2.2.0: filtro sobre el
  // padron, no una capa aparte - la capa NE independiente con su propio
  // marker/diamante vive en el mapa Niveles Estaticos, ver js/mapaNE.js).
  // Carga lazy en la PRIMERA activacion (nunca antes), via
  // mapaNEDataset.js (cache COMPARTIDA con el mapa NE independiente - si
  // ya se cargo desde ahi, esto no vuelve a pedirlo a Apps Script, y
  // viceversa). mapaEstado.neWellIdSet se arma una sola vez a partir de
  // ese dataset y se reusa en cada prendido/apagado posterior.
  function mapaController_toggleNE(contexto) {
    mapaEstado.neActivo = !mapaEstado.neActivo;
    chipNEEl.classList.toggle('active', mapaEstado.neActivo);
    chipNEEl.setAttribute('aria-pressed', mapaEstado.neActivo ? 'true' : 'false');

    if (!mapaEstado.neActivo || mapaEstado.neWellIdSet) {
      // Apagar nunca necesita el dataset. Prender cuando el Set ya esta
      // armado (se prendio antes en esta apertura del mapa) tampoco -
      // ambos casos solo tienen que re-renderizar con el filtro
      // correspondiente.
      mapaController_renderPuntos(contexto);
      return;
    }

    var aperturaAlPedir = mapaEstado.aperturaId;
    mapaNEDataset_obtener(contexto.sessionToken).then(function (result) {
      // Si el usuario ya salio del mapa (aperturaId cambio) o volvio a
      // apagar el filtro mientras el fetch estaba en vuelo, no se pisa
      // nada - se descarta en silencio, igual que el resto de los fetches
      // del mapa.
      if (aperturaAlPedir !== mapaEstado.aperturaId || !mapaEstado.neActivo) {
        return;
      }
      if (result.status !== 'ok') {
        mapaEstado.neActivo = false;
        chipNEEl.classList.remove('active');
        chipNEEl.setAttribute('aria-pressed', 'false');
        return;
      }
      mapaEstado.neWellIdSet = mapaLogic_setWellIdNE(result.data.puntos);
      mapaController_renderPuntos(contexto);
    }).catch(function () {
      if (aperturaAlPedir !== mapaEstado.aperturaId) {
        return;
      }
      mapaEstado.neActivo = false;
      chipNEEl.classList.remove('active');
      chipNEEl.setAttribute('aria-pressed', 'false');
    });
  }

  function mapaController_construirChipDepartamento(codigo, etiqueta, activo) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mapa-depto-chip' + (activo ? ' active' : '');
    chip.setAttribute('data-depto', codigo);
    chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    chip.textContent = etiqueta;
    return chip;
  }

  function mapaController_cantidadChipsIniciales() {
    return window.innerWidth >= BREAKPOINT_DESKTOP_PX ? CANTIDAD_CHIPS_DEPTO_DESKTOP : CANTIDAD_CHIPS_DEPTO_MOBILE;
  }

  // Repinta los chips de departamento a partir de mapaEstado.opcionesDepartamento
  // (ya calculado por mapaController_poblarChipsDepartamento) - expandir/
  // contraer "+N mas" pasa por aca sin recalcular nada ni tocar el dataset.
  function mapaController_renderChipsDepartamento() {
    var totalPozos = mapaEstado.totalUniverso;
    var division = mapaLogic_dividirChipsDepartamento(mapaEstado.opcionesDepartamento, mapaController_cantidadChipsIniciales());
    var hayMasQueMostrar = division.ocultos.length > 0;
    var visibles = (mapaEstado.deptosExpandido || !hayMasQueMostrar) ? mapaEstado.opcionesDepartamento : division.visibles;
    var sinSeleccion = Object.keys(mapaEstado.departamentoActivos).length === 0;

    deptosChipsEl.innerHTML = '';
    deptosChipsEl.appendChild(mapaController_construirChipDepartamento('todos', 'Todos (' + totalPozos + ')', sinSeleccion));
    visibles.forEach(function (o) {
      deptosChipsEl.appendChild(mapaController_construirChipDepartamento(o.codigo, o.nombre + ' (' + o.cantidad + ')', !!mapaEstado.departamentoActivos[o.codigo]));
    });

    if (hayMasQueMostrar) {
      btnDeptosExpandirEl.hidden = false;
      btnDeptosExpandirEl.textContent = mapaEstado.deptosExpandido ? 'Mostrar menos' : '+' + division.ocultos.length + ' más';
    } else {
      btnDeptosExpandirEl.hidden = true;
    }
  }

  // Opciones del PADRON COMPLETO (fijan orden y nombres): se calculan una
  // vez por apertura. Las cantidades que ve el usuario las recalcula
  // mapaController_actualizarConteosChips sobre el universo vigente.
  function mapaController_poblarChipsDepartamento(pozos) {
    mapaEstado.opcionesDepartamentoGlobal = mapaLogic_construirOpcionesDepartamento(pozos);
    // Defensivo (no deberia pasar en la practica, el dataset es el mismo
    // entre aperturas): saca de departamentoActivos cualquier codigo que
    // dejo de tener puntos EN EL PADRON, en vez de dejar un filtro
    // invisible. Se valida contra el padron completo, nunca contra un
    // universo contextual (ahi un activo con 0 pozos es legitimo).
    mapaEstado.departamentoActivos = mapaLogic_limpiarActivosInvalidos(
      mapaEstado.departamentoActivos,
      mapaEstado.opcionesDepartamentoGlobal.map(function (o) { return { valor: o.codigo, cantidad: o.cantidad }; })
    );
  }

  // --- Cuenca (Etapa 1C) ---
  // Multi-seleccion OR (unificacion UX con el mapa NE): "Todas" (data-
  // valor 'todos') limpia la seleccion, nunca un valor de estado propio
  // - su apariencia "active" se DERIVA de si el mapa de activos esta
  // vacio. Solo 6 valores posibles, nunca necesita "+N mas" (a
  // diferencia de Departamento).
  function mapaController_construirChipCuenca(valor, etiqueta, activo) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mapa-cuenca-chip' + (activo ? ' active' : '');
    chip.setAttribute('data-valor', valor);
    chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    chip.textContent = etiqueta;
    return chip;
  }

  function mapaController_renderChipsCuenca() {
    var sinSeleccion = Object.keys(mapaEstado.cuencaActivos).length === 0;
    cuencaChipsEl.innerHTML = '';
    cuencaChipsEl.appendChild(mapaController_construirChipCuenca('todos', 'Todas', sinSeleccion));
    mapaEstado.opcionesCuenca.forEach(function (o) {
      cuencaChipsEl.appendChild(mapaController_construirChipCuenca(o.valor, o.valor + ' (' + o.cantidad + ')', !!mapaEstado.cuencaActivos[o.valor]));
    });
  }

  // cuencaActivos (igual que departamentoActivos) persiste entre
  // aperturas normales - las 6 cuencas no cambian de un dataset a otro,
  // asi que no hace falta revalidar nada aca (a diferencia de
  // Departamento, cuyos codigos si podrian variar en teoria).
  function mapaController_poblarChipsCuenca(pozos) {
    mapaEstado.opcionesCuencaGlobal = mapaLogic_construirOpcionesCampoNE(pozos, 'cuenca');
  }

  // --- Ubicacion (Confirmada/Disponible) ---
  // Multi-seleccion OR, mismo modelo que el resto (unificacion UX) -
  // "Todos" (estatico en el HTML, data-estado='todos') activo cuando el
  // grupo esta vacio. Confirmada/Disponible llevan el conteo contextual
  // (ver mapaController_actualizarConteosChips); "Todos" no.
  function mapaController_actualizarChipsEstado() {
    var sinSeleccion = Object.keys(mapaEstado.estadosActivos).length === 0;
    estadoChipsEls.forEach(function (chip) {
      var valor = chip.getAttribute('data-estado');
      var activo = valor === 'todos' ? sinSeleccion : !!mapaEstado.estadosActivos[valor];
      if (valor !== 'todos') {
        if (!chip.hasAttribute('data-etiqueta')) {
          chip.setAttribute('data-etiqueta', chip.textContent);
        }
        var n = mapaEstado.conteoEstado ? mapaEstado.conteoEstado[valor] : null;
        chip.textContent = chip.getAttribute('data-etiqueta') + (n === null || n === undefined ? '' : ' (' + n + ')');
      }
      chip.classList.toggle('active', activo);
      chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
  }

  // --- Filtros: panel colapsable (unificacion UX con el mapa NE) ---
  function mapaController_cerrarPanelFiltros() {
    mapaEstado.filtrosActivo = false;
    btnFiltrosToggleEl.classList.remove('active');
    btnFiltrosToggleEl.setAttribute('aria-pressed', 'false');
    btnFiltrosToggleEl.setAttribute('aria-expanded', 'false');
    panelFiltrosEl.hidden = true;
  }

  function mapaController_toggleFiltrosPanel() {
    if (mapaEstado.filtrosActivo) {
      mapaController_cerrarPanelFiltros();
      return;
    }
    mapaEstado.filtrosActivo = true;
    btnFiltrosToggleEl.classList.add('active');
    btnFiltrosToggleEl.setAttribute('aria-pressed', 'true');
    btnFiltrosToggleEl.setAttribute('aria-expanded', 'true');
    panelFiltrosEl.hidden = false;
  }

  // --- Profundidad (Desde/Hasta) ---
  // Validacion en vivo (cada input) - nunca aplica un rango invalido
  // (Desde > Hasta, negativos, texto no numerico): muestra el error y NO
  // toca mapaEstado.profundidadDesde/Hasta hasta que el rango sea valido
  // de nuevo.
  function mapaController_aplicarProfundidad() {
    var resultado = mapaLogic_validarRangoProfundidad(inputProfundidadDesdeEl.value, inputProfundidadHastaEl.value);
    if (!resultado.valido) {
      errorProfundidadEl.textContent = resultado.error;
      errorProfundidadEl.hidden = false;
      return;
    }
    errorProfundidadEl.hidden = true;
    mapaEstado.profundidadDesde = resultado.desde;
    mapaEstado.profundidadHasta = resultado.hasta;
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  }

  function mapaController_limpiarProfundidad() {
    inputProfundidadDesdeEl.value = '';
    inputProfundidadHastaEl.value = '';
    errorProfundidadEl.hidden = true;
    mapaEstado.profundidadDesde = null;
    mapaEstado.profundidadHasta = null;
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  }

  // --- Profundidad DE FILTROS (tramos filtrantes) ---
  // CONCEPTO DISTINTO de "Profundidad del pozo" de arriba - mismo patron
  // de validacion (reusa mapaLogic_validarRangoProfundidad tal cual, las
  // reglas Desde/Hasta/negativos/error son identicas), pero el filtro en
  // si es mapaLogic_filtrarPorTramoFiltrante (interseccion con AL MENOS
  // UNO de los tramos del pozo, nunca "el pozo entero adentro").
  function mapaController_aplicarTramo() {
    var resultado = mapaLogic_validarRangoProfundidad(inputTramoDesdeEl.value, inputTramoHastaEl.value);
    if (!resultado.valido) {
      errorTramoEl.textContent = resultado.error;
      errorTramoEl.hidden = false;
      return;
    }
    errorTramoEl.hidden = true;
    mapaEstado.tramoDesde = resultado.desde;
    mapaEstado.tramoHasta = resultado.hasta;
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  }

  function mapaController_limpiarTramo() {
    inputTramoDesdeEl.value = '';
    inputTramoHastaEl.value = '';
    errorTramoEl.hidden = true;
    mapaEstado.tramoDesde = null;
    mapaEstado.tramoHasta = null;
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  }

  // --- Condicion (tecnicas.surgencia) ---
  // Mapeo de presentacion decidido por el usuario (Etapa siguiente,
  // cierre): el VALOR real (Profundo/SemiSurgente/Natural, el que usa
  // data-valor y mapaLogic_filtrarPorCampoMultipleNE para filtrar) NUNCA
  // cambia - solo la ETIQUETA que ve el usuario en el chip. "Natural" se
  // muestra como "Surgente" (era la pregunta abierta del diagnostico A2,
  // ya confirmada), "SemiSurgente" como "Semisurgente" (capitalizacion
  // legible). Un valor sin mapeo explicito se muestra tal cual (defensivo,
  // no deberia pasar con los 3 valores reales conocidos).
  var MAPA_ETIQUETAS_TIPO_POZO = { Profundo: 'Profundo', SemiSurgente: 'Semisurgente', Natural: 'Surgente' };
  function mapaController_etiquetaTipoPozo(valor) {
    return MAPA_ETIQUETAS_TIPO_POZO[valor] || valor;
  }

  // Multi-seleccion OR, mismo patron que Cuenca (chips dinamicos segun
  // los valores reales del dataset - Profundo/SemiSurgente/Natural, ver
  // diagnostico: es un campo categorico unico, nunca 2 booleanos).
  function mapaController_construirChipCondicion(valor, etiqueta, activo) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mapa-condicion-chip' + (activo ? ' active' : '');
    chip.setAttribute('data-valor', valor);
    chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    chip.textContent = etiqueta;
    return chip;
  }

  function mapaController_renderChipsCondicion() {
    var sinSeleccion = Object.keys(mapaEstado.condicionActivos).length === 0;
    condicionChipsEl.innerHTML = '';
    condicionChipsEl.appendChild(mapaController_construirChipCondicion('todos', 'Todos', sinSeleccion));
    mapaEstado.opcionesCondicion.forEach(function (o) {
      condicionChipsEl.appendChild(mapaController_construirChipCondicion(o.valor, mapaController_etiquetaTipoPozo(o.valor) + ' (' + o.cantidad + ')', !!mapaEstado.condicionActivos[o.valor]));
    });
  }

  function mapaController_poblarChipsCondicion(pozos) {
    mapaEstado.opcionesCondicionGlobal = mapaLogic_construirOpcionesCampoNE(pozos, 'surgencia');
  }

  // Conteos CONTEXTUALES de todos los chips (pedido: "Todo el mapa" =
  // padron completo; "Solo selección"/"Solo vista previa" = unicamente los
  // pozos de ese contexto - "Río Mendoza (22)" son 22 de los 40, no 6.739).
  // Criterio de facetas ya existente: el conteo es del universo, sin
  // cruzar con los demas grupos (OR dentro del grupo, AND entre grupos
  // siguen siendo del filtrado, no del conteo). Profundidad no tiene
  // conteo. Se recalcula solo si cambio el universo (clave), no en cada
  // toque de un filtro.
  function mapaController_actualizarConteosChips(ctx) {
    var soloContexto = !!ctx && mapaEstado.alcance === 'solo';
    var ids = soloContexto ? ctx.wellIds : null;
    var clave = soloContexto
      ? 'solo|' + mapaEstado.claveContexto + '|' + ids.length + '|' + ids[0] + '|' + ids[ids.length - 1]
      : 'todo';
    clave += mapaEstado.neWellIdSet ? '|ne' : '';
    // Los valores activos entran en la clave: un chip activo con 0 pozos se
    // conserva visible, y debe desaparecer al destildarlo.
    clave += '|' + [mapaEstado.departamentoActivos, mapaEstado.cuencaActivos, mapaEstado.condicionActivos]
      .map(function (a) { return Object.keys(a).sort().join(','); }).join('/');
    if (clave === mapaEstado.claveUniverso) {
      return;
    }
    mapaEstado.claveUniverso = clave;

    var universo = soloContexto
      ? seleccionLogic_filtrarPorWellIds(mapaEstado.puntosCrudos, new Set(ids))
      : mapaEstado.puntosCrudos;
    mapaEstado.totalUniverso = universo.length;

    mapaEstado.opcionesDepartamento = mapaLogic_aplicarConteosContextuales(
      mapaEstado.opcionesDepartamentoGlobal, mapaLogic_construirOpcionesDepartamento(universo),
      'codigo', mapaEstado.departamentoActivos
    );
    mapaEstado.opcionesCuenca = mapaLogic_aplicarConteosContextuales(
      mapaEstado.opcionesCuencaGlobal, mapaLogic_construirOpcionesCampoNE(universo, 'cuenca'),
      'valor', mapaEstado.cuencaActivos
    );
    mapaEstado.opcionesCondicion = mapaLogic_aplicarConteosContextuales(
      mapaEstado.opcionesCondicionGlobal, mapaLogic_construirOpcionesCampoNE(universo, 'surgencia'),
      'valor', mapaEstado.condicionActivos
    );
    mapaEstado.conteoEstado = mapaLogic_contarPorEstado(universo);
    mapaEstado.conteoNE = mapaLogic_contarEnSetNE(universo, mapaEstado.neWellIdSet);

    mapaController_renderChipsDepartamento();
    mapaController_renderChipsCuenca();
    mapaController_renderChipsCondicion();
    mapaController_actualizarChipsEstado();
    mapaController_actualizarChipNE();
  }

  function mapaController_actualizarChipNE() {
    chipNEEl.textContent = mapaEstado.conteoNE === null || mapaEstado.conteoNE === undefined
      ? 'Niveles estáticos'
      : 'Niveles estáticos (' + mapaEstado.conteoNE + ')';
  }

  // "Limpiar filtros": vuelve TODOS los grupos a "Todos"/vacio - Cuenca,
  // Departamento, Ubicacion, Condicion, Profundidad del pozo, Profundidad
  // de filtros, "Tiene: Niveles estáticos" (apagado) - mismo criterio
  // que "Limpiar filtros" en el mapa NE, nunca cierra ningun panel solo.
  function mapaController_limpiarFiltros() {
    mapaEstado.cuencaActivos = {};
    mapaEstado.departamentoActivos = {};
    mapaEstado.estadosActivos = {};
    mapaEstado.condicionActivos = {};
    mapaEstado.neActivo = false;
    chipNEEl.classList.remove('active');
    chipNEEl.setAttribute('aria-pressed', 'false');
    mapaEstado.profundidadDesde = null;
    mapaEstado.profundidadHasta = null;
    inputProfundidadDesdeEl.value = '';
    inputProfundidadHastaEl.value = '';
    errorProfundidadEl.hidden = true;
    mapaEstado.tramoDesde = null;
    mapaEstado.tramoHasta = null;
    inputTramoDesdeEl.value = '';
    inputTramoHastaEl.value = '';
    errorTramoEl.hidden = true;

    // Los chips se repintan (activos, conteos) dentro de renderPuntos.
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual);
    }
  }

  // saltarAutoFit: true cuando mapaController_aplicarEnfoque va a poner
  // su propia vista (centrar en un pozo puntual o en la ubicacion del
  // usuario) inmediatamente despues - encadenar 2 fitBounds/setView
  // seguidos confundia la animacion de Leaflet (la 2da terminaba
  // "ganando" el frame final pero la 1ra a veces revertia el zoom poco
  // despues, bug real encontrado en la Etapa 5C-3 con "Ver en mapa"
  // desde Cerca Mio) - mas simple y confiable evitar la 1ra por completo
  // en vez de pelear las dos animaciones entre si.
  function mapaController_renderPuntos(contexto, saltarAutoFit) {
    // Cualquier cambio de filtro invalida el "Mostrarlo igual" de una
    // busqueda anterior - nunca sobrevive a un filtro distinto (ver
    // mapaController_mostrarResultadoTemporalmente).
    mapaController_limpiarMarcadorBusquedaTemporal();

    // cuenca AND departamento AND estado AND condicion AND "Tiene:
    // Niveles estáticos" AND profundidad del pozo AND profundidad de
    // filtros: se encadenan 7 filtros puros de mapaLogic.js, cada uno
    // responsable de un solo criterio. cuenca/departamento/condicion son
    // multi-seleccion OR (mapaLogic_filtrarPorCampoMultipleNE/
    // mapaLogic_filtrarPorDepartamentoMultiple - la primera es generica,
    // reusada tal cual pese al sufijo "NE" del nombre, ver su comentario
    // en mapaLogic.js). El filtro NE reduce el padron a la interseccion
    // con la red NE (ver mapaLogic_filtrarPorNE) - nunca agrega puntos
    // que no esten ya en getMapaPozos, y nunca muestra los 34 puntos NE
    // especiales (sin wellId no pueden estar en el Set - ver
    // mapaLogic_setWellIdNE). profundidad de filtros usa
    // mapaLogic_filtrarPorTramoFiltrante (interseccion con al menos un
    // tramo) - CONCEPTO DISTINTO de profundidad del pozo, nunca
    // confundir aunque ambos usen el mismo tipo de input Desde/Hasta.
    var filtrados = mapaLogic_filtrarPorTramoFiltrante(
      mapaLogic_filtrarPorRangoProfundidad(
        mapaLogic_filtrarPorCampoMultipleNE(
          mapaLogic_filtrarPorNE(
            mapaLogic_filtrarPorEstado(
              mapaLogic_filtrarPorDepartamentoMultiple(
                mapaLogic_filtrarPorCampoMultipleNE(mapaEstado.puntosCrudos, 'cuenca', mapaEstado.cuencaActivos),
                mapaEstado.departamentoActivos
              ),
              mapaEstado.estadosActivos
            ),
            mapaEstado.neWellIdSet,
            mapaEstado.neActivo
          ),
          'surgencia', mapaEstado.condicionActivos
        ),
        mapaEstado.profundidadDesde, mapaEstado.profundidadHasta, 'profundidad'
      ),
      mapaEstado.tramoDesde, mapaEstado.tramoHasta, 'tramosFiltrantes'
    );

    // Contexto geografico (seleccion confirmada o vista previa de Cerca
    // Mio): con alcance "solo" el contexto define el CONJUNTO BASE y los 7
    // filtros de arriba actuan sobre el - o sea la interseccion (AND)
    // pedida. Se aplica sobre el resultado de los filtros (AND es
    // conmutativo), nunca se guarda como parte de ellos: "Limpiar filtros"
    // no toca el alcance. Con alcance "todo" el contexto solo se resalta.
    var ctx = mapaController_sincronizarContexto();
    mapaEstado.setResaltado = ctx ? new Set(ctx.wellIds) : null;
    if (ctx && mapaEstado.alcance === 'solo') {
      filtrados = seleccionLogic_filtrarPorWellIds(filtrados, mapaEstado.setResaltado);
    }
    mapaController_actualizarConteosChips(ctx);

    mapaEstado.clusterGroup.clearLayers();
    mapaEstado.markersPorWellId = {};
    var markers = filtrados.map(function (p) {
      var marker = mapaController_crearMarker(p, contexto);
      mapaEstado.markersPorWellId[p.wellId] = marker;
      return marker;
    });
    mapaEstado.clusterGroup.addLayers(markers);

    var vista = seleccionLogic_describirVista({
      contexto: ctx,
      alcance: mapaEstado.alcance,
      filtrosActivos: mapaController_hayFiltrosActivos(),
      visibles: filtrados.length,
      totalDataset: mapaEstado.puntosCrudos.length
    });
    contadorEl.hidden = false;
    contadorEl.textContent = vista.contador;
    mapaController_actualizarBarraContexto(ctx, vista);

    if (filtrados.length > 0 && !saltarAutoFit) {
      mapaEstado.mapa.fitBounds(mapaEstado.clusterGroup.getBounds().pad(0.05));
    }

    mapaController_dibujarContexto(ctx);
  }

  // True si hay CUALQUIER filtro del panel activo (los 7 de arriba) - el
  // alcance "solo" lo usa para distinguir "solo la seleccion" de
  // "seleccion AND filtros".
  function mapaController_hayFiltrosActivos() {
    var hayClaves = function (o) { return Object.keys(o).length > 0; };
    return hayClaves(mapaEstado.departamentoActivos) || hayClaves(mapaEstado.cuencaActivos) ||
      hayClaves(mapaEstado.estadosActivos) || hayClaves(mapaEstado.condicionActivos) ||
      mapaEstado.neActivo ||
      mapaEstado.profundidadDesde !== null || mapaEstado.profundidadHasta !== null ||
      mapaEstado.tramoDesde !== null || mapaEstado.tramoHasta !== null;
  }

  // Lee el contexto vigente de js/seleccion.js y, si cambio de verdad
  // (otra seleccion, otra vista previa - NO si solo se quito un pozo de la
  // misma), vuelve al alcance "todo": un alcance "solo" heredado de un
  // contexto anterior dejaria el mapa casi vacio sin que el usuario haya
  // pedido eso para el contexto NUEVO.
  function mapaController_sincronizarContexto() {
    var ctx = typeof seleccionController_obtenerContextoGeografico === 'function'
      ? seleccionController_obtenerContextoGeografico()
      : null;
    var clave = seleccionLogic_claveContexto(ctx);
    if (clave !== mapaEstado.claveContexto) {
      mapaEstado.claveContexto = clave;
      mapaEstado.alcance = 'todo';
    }
    return ctx;
  }

  // Barra de contexto (pedido D: "debe quedar claro cuando esta viendo
  // todos los pozos, solo la seleccion, o la interseccion"): siempre dice
  // que contexto hay, cuantos pozos y que esta viendo ahora; con vista
  // previa suma "Usar estos pozos"/"Quitar".
  function mapaController_actualizarBarraContexto(ctx, vista) {
    contextoBarraEl.hidden = !ctx;
    if (!ctx) {
      return;
    }
    contextoTituloEl.textContent = vista.titulo;
    contextoEstadoEl.textContent = vista.estado;
    contextoBarraEl.setAttribute('data-modo', vista.modo);
    var solo = mapaEstado.alcance === 'solo';
    btnAlcanceTodoEl.classList.toggle('active', !solo);
    btnAlcanceTodoEl.setAttribute('aria-pressed', solo ? 'false' : 'true');
    btnAlcanceSoloEl.classList.toggle('active', solo);
    btnAlcanceSoloEl.setAttribute('aria-pressed', solo ? 'true' : 'false');
    btnAlcanceSoloEl.textContent = ctx.tipo === 'vistaPrevia' ? 'Solo vista previa' : 'Solo selección';
    var esPrevia = ctx.tipo === 'vistaPrevia';
    btnContextoUsarEl.hidden = !esPrevia;
    btnContextoQuitarEl.hidden = !esPrevia;
  }

  // Poligono, o punto de referencia + circulo de radio, del contexto
  // vigente: se redibuja en CADA renderPuntos (apertura, filtro, cambio de
  // contexto), asi que persiste a toda navegacion SPA igual para radio
  // que para poligono - esa era la diferencia que perdia el radio (antes
  // solo el poligono se redibujaba, el punto/circulo vivian como un
  // adorno de la apertura con "Ver todos en el mapa"). Contorno magenta con
  // halo blanco (contrasta en Mapa y en Satelite) - interactive:false para
  // no tapar toques destinados a pozos/vertices (ver
  // mapaShared_crearContornoSeleccion).
  function mapaController_dibujarContexto(ctx) {
    if (mapaEstado.contextoLayer) {
      mapaEstado.mapa.removeLayer(mapaEstado.contextoLayer);
      mapaEstado.contextoLayer = null;
    }
    if (!ctx || !ctx.geometria) {
      return;
    }
    var capa = L.layerGroup();
    var g = ctx.geometria;
    if (ctx.origen === 'poligono' && g.vertices) {
      mapaShared_crearPoligonoSeleccion(g.vertices.map(function (v) { return [v.lat, v.lon]; })).addTo(capa);
    } else if (ctx.origen === 'radio' && typeof g.lat === 'number') {
      mapaShared_crearCirculoSeleccion(g.lat, g.lon, g.radioMetros).addTo(capa);
      var esGps = g.tipoReferencia === 'miUbicacion';
      L.marker([g.lat, g.lon], { icon: esGps ? mapaController_iconoMiUbicacion() : mapaShared_iconoPuntoBusqueda(), keyboard: false })
        .bindPopup(esGps ? 'Tu ubicación' : 'Punto de búsqueda')
        .addTo(capa);
    }
    capa.addTo(mapaEstado.mapa);
    // Poligono/circulo POR DEBAJO de los pozos (el relleno suave no tapa
    // markers ni clusters): bringToBack solo existe en capas vectoriales.
    // En orden INVERSO (linea magenta primero, halo blanco despues): cada
    // bringToBack manda la capa al fondo, asi el halo termina debajo de la
    // linea.
    var vectoriales = [];
    capa.eachLayer(function (sub) {
      if (sub.eachLayer) {
        sub.eachLayer(function (v) { vectoriales.push(v); });
      }
    });
    vectoriales.reverse().forEach(function (v) { v.bringToBack(); });
    mapaEstado.contextoLayer = capa;
  }

  // Bounds del contexto vigente (para encuadrar): circulo de radio o
  // poligono. null si no hay contexto.
  function mapaController_boundsContexto(ctx) {
    if (!ctx || !ctx.geometria) {
      return null;
    }
    var g = ctx.geometria;
    if (ctx.origen === 'poligono' && g.vertices && g.vertices.length >= 3) {
      var b = seleccionLogic_bboxDeVertices(g.vertices);
      return [[b.latMin, b.lonMin], [b.latMax, b.lonMax]];
    }
    if (ctx.origen === 'radio' && typeof g.lat === 'number') {
      var r = cercaMioLogic_boundingBox(g.lat, g.lon, g.radioMetros);
      return [[r.latMin, r.lonMin], [r.latMax, r.lonMax]];
    }
    return null;
  }

  // Icono div (sin imagenes vendorizadas, igual que los circleMarker de
  // pozos) para "Tu ubicacion" - un punto solido con un pulso animado
  // alrededor, visualmente bien distinto de los pozos (color de seleccion,
  // --color-seleccion, en vez de los 2 teals de Confirmada/Disponible).
  function mapaController_iconoMiUbicacion() {
    return L.divIcon({
      className: 'mapa-mi-ubicacion-icono',
      html: '<span class="mapa-mi-ubicacion-pulso"></span><span class="mapa-mi-ubicacion-punto"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  // Aplica un enfoque (opcional) DESPUES de renderizar los puntos:
  //   {tipo:'pozo', wellId}      centra + abre el popup de ese pozo
  //   {tipo:'contexto'}          encuadra el poligono o el radio del
  //                              contexto geografico vigente (el punto, el
  //                              circulo, el poligono y el resaltado ya los
  //                              dibujo renderPuntos - ver
  //                              mapaController_dibujarContexto)
  //   {tipo:'seleccion', wellIds} encuadra esos pozos
  // Ya no hay enfoques 'ubicacion'/'puntoBusqueda': el punto y el circulo
  // dejaron de ser un adorno efimero de UNA apertura (por eso se perdian
  // al navegar) y pasaron a ser parte del contexto persistente.
  function mapaController_aplicarEnfoque(enfoque) {
    if (!enfoque) {
      return;
    }

    if (enfoque.tipo === 'contexto') {
      var limites = mapaController_boundsContexto(mapaController_sincronizarContexto());
      if (limites) {
        mapaEstado.mapa.fitBounds(limites, { padding: [20, 20] });
      }
    } else if (enfoque.tipo === 'pozo') {
      // NO se usa clusterGroup.zoomToShowLayer(): su heuristica interna
      // (¿el marker ya esta "visible" segun sus bounds actuales? ¿hace
      // falta spiderfy en vez de zoom?) dio resultados inconsistentes
      // con clusters de miles de puntos - a veces no cambiaba el zoom
      // en absoluto (bug real encontrado en la Etapa 5C-3). setView() al
      // zoom exacto donde el clusterGroup desagrupa TODO
      // (MAPA_ZOOM_INDIVIDUAL = disableClusteringAtZoom) es determinista:
      // a ese zoom el marker SIEMPRE es una capa individual real, nunca
      // parte de un cluster - once('moveend') espera a que el pan/zoom
      // (animado) termine antes de abrir el popup, para no abrirlo
      // mientras el marker todavia no esta agregado al mapa de verdad.
      var marker = mapaEstado.markersPorWellId[enfoque.wellId];
      if (marker) {
        // Si ya estamos parados justo ahi (ej. tocar "Ver en mapa" dos
        // veces seguidas para el mismo pozo), setView() no mueve nada y
        // "moveend" nunca dispara - mapaController_centrarYAbrirPopup ya
        // contempla ese caso (mismo helper que usa el buscador).
        mapaController_centrarYAbrirPopup(marker);
      } else {
        // El pozo no pasa los filtros/alcance activos. Antes se BORRABAN
        // todos los filtros para poder mostrarlo; ahora (pedido: que no se
        // pierdan los filtros activos al navegar) se muestra igual como
        // marker temporal - mismo mecanismo que "Mostrarlo igual" del
        // buscador - y los filtros quedan como estaban.
        var punto = mapaEstado.puntosCrudos.filter(function (p) { return p.wellId === enfoque.wellId; })[0];
        if (punto) {
          mapaController_mostrarResultadoTemporalmente(punto, mapaEstado.contextoActual);
          contadorEl.textContent += ' · +1 pozo fuera de los filtros';
        }
      }
    } else if (enfoque.tipo === 'seleccion') {
      // "Ver en mapa" desde la bandeja de seleccion (item D): ajusta la
      // vista a los markers seleccionados que esten actualmente
      // visibles (respetando los filtros activos) - el resaltado en si
      // ya lo hace mapaController_crearMarker, aca solo falta encuadrar.
      var bounds = [];
      var wellIdsEnfoque = new Set(enfoque.wellIds);
      Object.keys(mapaEstado.markersPorWellId).forEach(function (wellId) {
        if (wellIdsEnfoque.has(wellId)) {
          bounds.push(mapaEstado.markersPorWellId[wellId].getLatLng());
        }
      });
      if (bounds.length > 0) {
        mapaEstado.mapa.fitBounds(L.latLngBounds(bounds).pad(0.1));
      }
    }
  }

  // --- Seleccion de pozos (Etapa "seleccion multiple + lote") ---

  // Icono del vertice de poligono - circulo chico solido, mismo
  // mecanismo que mapaController_iconoMiUbicacion (anula el fondo/borde
  // default de .leaflet-div-icon).
  function mapaController_iconoVerticePoligono() {
    return L.divIcon({
      className: 'mapa-vertice-poligono-icono',
      html: '<span class="mapa-vertice-poligono-punto"></span>',
      iconSize: [14, 14],
      iconAnchor: [7, 7]
    });
  }

  // Item C/G del cierre: "Seleccionar pozos" (Por radio navega a Cerca
  // Mio via contexto.onSeleccionarPorRadio - app.js es quien decide
  // sessionToken/permisos frescos, mapa.js nunca llama a showScreen
  // directo; Dibujar área activa el modo local de abajo).
  btnSeleccionarToggleEl.addEventListener('click', function () {
    var abriendo = seleccionarMenuEl.hidden;
    seleccionarMenuEl.hidden = !abriendo;
    btnSeleccionarToggleEl.setAttribute('aria-expanded', abriendo ? 'true' : 'false');
  });
  btnSeleccionarRadioEl.addEventListener('click', function () {
    seleccionarMenuEl.hidden = true;
    if (mapaEstado.contextoActual && mapaEstado.contextoActual.onSeleccionarPorRadio) {
      mapaEstado.contextoActual.onSeleccionarPorRadio();
    }
  });
  btnSeleccionarPoligonoEl.addEventListener('click', function () {
    seleccionarMenuEl.hidden = true;
    mapaController_activarDibujo();
  });

  function mapaController_activarDibujo() {
    mapaEstado.dibujando = true;
    mapaEstado.verticesPoligono = [];
    mapaController_limpiarCapasDibujo();
    dibujoPanelEl.hidden = false;
    dibujoMensajeEl.textContent = 'Tocá el mapa para marcar los vértices del área';
    dibujoAccionesDibujandoEl.hidden = false;
    dibujoAccionesCerradoEl.hidden = true;
    btnDibujoDeshacerEl.disabled = true;
    btnDibujoCerrarEl.disabled = true;
  }

  function mapaController_limpiarCapasDibujo() {
    if (mapaEstado.marcadoresVerticesLayer) {
      mapaEstado.mapa.removeLayer(mapaEstado.marcadoresVerticesLayer);
      mapaEstado.marcadoresVerticesLayer = null;
    }
    if (mapaEstado.poligonoCerradoLayer) {
      mapaEstado.mapa.removeLayer(mapaEstado.poligonoCerradoLayer);
      mapaEstado.poligonoCerradoLayer = null;
    }
  }

  // Redibuja los vertices sueltos + la linea provisional que los conecta
  // (item C: "cada toque agrega un vertice visible"/"mostrar lineas
  // entre vertices") - se reconstruye entera en cada toque, barato para
  // la cantidad de vertices que un usuario puede tocar a mano.
  function mapaController_redibujarVerticesSueltos() {
    mapaController_limpiarCapasDibujo();
    if (mapaEstado.verticesPoligono.length === 0) {
      return;
    }
    var layer = L.layerGroup();
    mapaEstado.verticesPoligono.forEach(function (v) {
      L.marker([v.lat, v.lon], { icon: mapaController_iconoVerticePoligono() }).addTo(layer);
    });
    if (mapaEstado.verticesPoligono.length >= 2) {
      var latlngs = mapaEstado.verticesPoligono.map(function (v) { return [v.lat, v.lon]; });
      var linea = mapaShared_crearContornoSeleccion(function (o) { return L.polyline(latlngs, o); }, { weight: 3, dashArray: '8 6' });
      linea.halo.addTo(layer);
      linea.linea.addTo(layer);
    }
    layer.addTo(mapaEstado.mapa);
    mapaEstado.marcadoresVerticesLayer = layer;
  }

  function mapaController_agregarVerticePoligono(lat, lon) {
    mapaEstado.verticesPoligono.push({ lat: lat, lon: lon });
    mapaController_redibujarVerticesSueltos();
    dibujoMensajeEl.textContent = mapaEstado.verticesPoligono.length + ' vértice' + (mapaEstado.verticesPoligono.length === 1 ? '' : 's') +
      ' marcado' + (mapaEstado.verticesPoligono.length === 1 ? '' : 's') + ' - tocá el mapa para seguir';
    btnDibujoDeshacerEl.disabled = false;
    btnDibujoCerrarEl.disabled = mapaEstado.verticesPoligono.length < 3;
  }

  // "Deshacer último punto" (pedido explicito del cierre: "en celular es
  // muy facil tocar mal").
  btnDibujoDeshacerEl.addEventListener('click', function () {
    mapaEstado.verticesPoligono.pop();
    mapaController_redibujarVerticesSueltos();
    var n = mapaEstado.verticesPoligono.length;
    dibujoMensajeEl.textContent = n > 0
      ? (n + ' vértice' + (n === 1 ? '' : 's') + ' marcado' + (n === 1 ? '' : 's') + ' - tocá el mapa para seguir')
      : 'Tocá el mapa para marcar los vértices del área';
    btnDibujoDeshacerEl.disabled = n === 0;
    btnDibujoCerrarEl.disabled = n < 3;
  });

  // "Cerrar área" (desde 3 puntos): calcula localmente contra los
  // 13.804 pozos (seleccionLogic_filtrarPorPoligono, bounding box +
  // point-in-polygon-or-boundary) y muestra el poligono semitransparente
  // + el conteo - NUNCA manda la geometria a ningun lado.
  btnDibujoCerrarEl.addEventListener('click', function () {
    if (mapaEstado.verticesPoligono.length < 3) {
      return;
    }
    var latlngs = mapaEstado.verticesPoligono.map(function (v) { return [v.lat, v.lon]; });
    mapaEstado.poligonoCerradoLayer = mapaShared_crearPoligonoSeleccion(latlngs).addTo(mapaEstado.mapa);

    var wellIdsDentro = mapaEstado.puntosCrudos
      ? seleccionLogic_filtrarPorPoligono(mapaEstado.puntosCrudos, mapaEstado.verticesPoligono)
      : [];
    mapaEstado.ultimosWellIdsPoligono = wellIdsDentro;

    dibujoMensajeEl.textContent = wellIdsDentro.length + ' pozo' + (wellIdsDentro.length === 1 ? '' : 's') + ' dentro del área';
    dibujoAccionesDibujandoEl.hidden = true;
    dibujoAccionesCerradoEl.hidden = false;
  });

  function mapaController_salirDeDibujo() {
    mapaEstado.dibujando = false;
    mapaEstado.verticesPoligono = [];
    mapaController_limpiarCapasDibujo();
    dibujoPanelEl.hidden = true;
  }

  btnDibujoUsarEl.addEventListener('click', function () {
    var vertices = mapaEstado.verticesPoligono.slice();
    var wellIds = mapaEstado.ultimosWellIdsPoligono || [];
    mapaController_salirDeDibujo();
    seleccionController_proponerSeleccion(wellIds, 'poligono', { vertices: vertices });
  });
  btnDibujoRedibujarEl.addEventListener('click', function () {
    mapaController_activarDibujo();
  });
  btnDibujoCancelarEl.addEventListener('click', mapaController_salirDeDibujo);
  btnDibujoCancelar2El.addEventListener('click', mapaController_salirDeDibujo);

  // Alcance (pedido D): "Todo el mapa" deja ver todos los pozos con el
  // contexto solo resaltado; "Solo selección/vista previa" restringe el
  // mapa al conjunto del contexto y los filtros actuan SOBRE el (AND).
  // Cambiar a "solo" re-encuadra a lo que queda visible; volver a "todo"
  // no mueve la vista (no se zoomea a toda la provincia sin pedirlo).
  function mapaController_cambiarAlcance(alcance) {
    if (mapaEstado.alcance === alcance) {
      return;
    }
    mapaEstado.alcance = alcance;
    if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
      mapaController_renderPuntos(mapaEstado.contextoActual, alcance === 'todo');
    }
  }
  btnAlcanceTodoEl.addEventListener('click', function () { mapaController_cambiarAlcance('todo'); });
  btnAlcanceSoloEl.addEventListener('click', function () { mapaController_cambiarAlcance('solo'); });
  btnContextoUsarEl.addEventListener('click', function () { seleccionController_usarVistaPrevia(); });
  btnContextoQuitarEl.addEventListener('click', function () { seleccionController_limpiarVistaPrevia(); });

  // mapa.js nunca pregunta por el contexto por su cuenta en cada render
  // salvo que YA haya pozos renderizados - esta suscripcion vuelve a
  // pintar (resaltado + poligono/punto/radio + barra de contexto) cuando
  // la seleccion o la vista previa cambian desde OTRA pantalla (ej.
  // "Limpiar" o "Quitar" en la tabla, un radio nuevo en Cerca Mio) sin
  // que el usuario haya vuelto a tocar ningun filtro aca.
  // Se registra al crear el mapa (primera apertura), NO al cargar este
  // archivo: js/seleccion.js se carga DESPUES de js/mapa.js (ver orden de
  // <script> en index.html), asi que al cargar mapa.js
  // seleccionController_registrarListener todavia no existe - registrarlo
  // a nivel de modulo dejaba la suscripcion en silencio sin efecto.
  var listenerSeleccionRegistrado = false;
  function mapaController_registrarListenerSeleccion() {
    if (listenerSeleccionRegistrado || typeof seleccionController_registrarListener !== 'function') {
      return;
    }
    listenerSeleccionRegistrado = true;
    seleccionController_registrarListener(function () {
      if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
        mapaController_renderPuntos(mapaEstado.contextoActual, true);
      }
    });
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
    mapaController_cerrarPanelBusqueda();
    mapaController_cerrarPanelFiltros();
    mapaController_limpiarMarcadorBusquedaTemporal();
    seleccionarMenuEl.hidden = true;
    // Una apertura nueva nunca arranca a mitad de un dibujo viejo -
    // "ver solo seleccionados" SI persiste (no es parte del dibujo, es
    // un toggle de visualizacion de una seleccion que sigue viva).
    if (mapaEstado.dibujando) {
      mapaController_salirDeDibujo();
    }

    // El placeholder del buscador nunca insinua que se puede buscar por
    // NC16/titular sin el permiso "datos" - NC16 esta gateado por
    // "datos", igual que titular (decision de arquitectura aprobada, ver
    // MapaService.js: viven en el MISMO indice/permiso). Con datos=NO,
    // el placeholder solo menciona numero de pozo - el buscador sigue
    // existiendo igual (ver mapaLogic_buscarPozosProvincia con indice
    // null), nunca insinua las otras 2 formas de busqueda.
    inputBuscarEl.placeholder = (contexto.permisos && contexto.permisos.datos)
      ? 'Buscar pozo, NC16 o titular...'
      : 'Buscar número de pozo...';

    if (!mapaLogic_puedeVerProvincia(contexto.permisos)) {
      // Defensa en profundidad: el boton de acceso (btn-abrir-mapa) ya
      // deberia estar oculto sin perfil/ne (ver mapaLogic_calcularAccesos),
      // pero si de todas formas se llega aca, nunca se dispara el fetch.
      mapaController_mostrarError(aperturaId, 'No tenés permiso para ver el mapa de pozos.');
      return;
    }

    // Chip "Niveles estáticos" (grupo TIENE, v2.1.0): visible SOLO con
    // ne=SI - nunca se revela ni el grupo ni el chip a un usuario sin el
    // permiso (fail-closed, ver mapaLogic_debeMostrarChipNE). Esto es
    // independiente de cargar librerias/dataset, no hace falta esperar
    // nada para decidirlo.
    var debeMostrarNE = mapaLogic_debeMostrarChipNE(contexto.permisos);
    grupoTieneEl.hidden = !debeMostrarNE;
    if (!debeMostrarNE && mapaEstado.neActivo) {
      // Caso limite: el permiso se revoco entre una apertura y la
      // siguiente (ej. un admin le saco ne=SI al usuario en la hoja
      // Usuarios) - se apaga el filtro, nunca se deja aplicado "a
      // escondidas" sin su chip visible. El re-render con el filtro ya
      // apagado ocurre mas abajo (mapaController_renderPuntos), una vez
      // que el dataset este listo - no hace falta repintar aca todavia.
      mapaEstado.neActivo = false;
      chipNEEl.classList.remove('active');
      chipNEEl.setAttribute('aria-pressed', 'false');
    }

    mapaShared_cargarLibrerias().then(function () {
      if (aperturaId !== mapaEstado.aperturaId) {
        return null;
      }
      mapaController_crearMapaSiHaceFalta();
      // Dataset compartido con Cerca Mio (js/mapaDataset.js): si ya lo
      // cargo el otro, esto no vuelve a pedirlo a Apps Script.
      return mapaDataset_obtener(contexto.sessionToken);
    }).then(function (result) {
      if (!result || aperturaId !== mapaEstado.aperturaId) {
        return;
      }
      if (result.status !== 'ok') {
        mapaController_mostrarError(aperturaId, mapaController_mensajeError(result.code));
        return;
      }

      mapaEstado.puntosCrudos = result.data.pozos;

      loadingEl.hidden = true;
      mapaEl.hidden = false;

      // El contenedor tiene que estar visible y con su tamano real ANTES
      // de cualquier fitBounds()/setView() (dentro de renderPuntos Y de
      // aplicarEnfoque - Cerca Mio tambien encuadra por tamano) - ver
      // mapaShared_alMostrarMapa en js/mapaShared.js para el detalle del
      // bug que esto evita.
      mapaShared_alMostrarMapa(mapaEstado.mapa, function () {
        if (aperturaId !== mapaEstado.aperturaId) {
          return;
        }

        // Ya NO se borran los filtros al venir a mostrar un pozo puntual
        // (enfoque:{tipo:'pozo'}): se perdian filtros/alcance activos solo
        // por tocar "Ver en mapa". Si ese pozo no pasa los filtros,
        // mapaController_aplicarEnfoque lo muestra igual como marker
        // temporal (ver ahi).

        mapaController_poblarChipsDepartamento(mapaEstado.puntosCrudos);
        mapaController_poblarChipsCuenca(mapaEstado.puntosCrudos);
        mapaController_poblarChipsCondicion(mapaEstado.puntosCrudos);
        // Fuerza el recalculo de conteos (renderPuntos los pinta) - el
        // dataset pudo cambiar entre aperturas.
        mapaEstado.claveUniverso = null;

        // Sin enfoque explicito pero con un contexto geografico vivo
        // (seleccion confirmada o vista previa), el mapa abre encuadrando
        // ese contexto en vez de toda la provincia: volver al mapa deja
        // ver el poligono/radio con el que se estaba trabajando.
        var enfoque = contexto.enfoque ||
          (typeof seleccionController_obtenerContextoGeografico === 'function' && seleccionController_obtenerContextoGeografico()
            ? { tipo: 'contexto' } : null);
        mapaController_renderPuntos(contexto, !!enfoque);
        // markersPorWellId ya esta poblado en este punto (renderPuntos lo
        // arma de forma sincronica, ANTES de pasarle los markers a
        // clusterGroup.addLayers - no hace falta esperar a que termine el
        // chunked loading de addLayers para encontrar el marker de un
        // wellId puntual).
        mapaController_aplicarEnfoque(enfoque);
      });
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

  // Delegacion en el contenedor (no un listener por chip): los chips se
  // recrean enteros en cada mapaController_renderChipsDepartamento, un
  // listener por boton se perderia/duplicaria en cada repintado.
  deptosChipsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.mapa-depto-chip') : null;
    if (!chip || !mapaEstado.contextoActual || !mapaEstado.puntosCrudos) {
      return;
    }
    mapaEstado.departamentoActivos = mapaLogic_toggleFiltroMultiple(mapaEstado.departamentoActivos, chip.getAttribute('data-depto'));
    mapaController_renderPuntos(mapaEstado.contextoActual);
  });

  // Cuenca - multi-seleccion OR (unificacion UX con el mapa NE). "Todas"
  // limpia la seleccion del grupo (mapaLogic_toggleFiltroMultiple ya
  // devuelve {} en ese caso).
  cuencaChipsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.mapa-cuenca-chip') : null;
    if (!chip || !mapaEstado.contextoActual || !mapaEstado.puntosCrudos) {
      return;
    }
    mapaEstado.cuencaActivos = mapaLogic_toggleFiltroMultiple(mapaEstado.cuencaActivos, chip.getAttribute('data-valor'));
    mapaController_renderPuntos(mapaEstado.contextoActual);
  });

  // Condicion - mismo patron que Cuenca (chips dinamicos, multi-seleccion OR).
  condicionChipsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.mapa-condicion-chip') : null;
    if (!chip || !mapaEstado.contextoActual || !mapaEstado.puntosCrudos) {
      return;
    }
    mapaEstado.condicionActivos = mapaLogic_toggleFiltroMultiple(mapaEstado.condicionActivos, chip.getAttribute('data-valor'));
    mapaController_renderPuntos(mapaEstado.contextoActual);
  });

  btnDeptosExpandirEl.addEventListener('click', function () {
    mapaEstado.deptosExpandido = !mapaEstado.deptosExpandido;
    if (mapaEstado.puntosCrudos) {
      mapaController_renderChipsDepartamento();
    }
  });

  btnFiltrosToggleEl.addEventListener('click', mapaController_toggleFiltrosPanel);
  btnLimpiarFiltrosEl.addEventListener('click', mapaController_limpiarFiltros);
  inputProfundidadDesdeEl.addEventListener('input', mapaController_aplicarProfundidad);
  inputProfundidadHastaEl.addEventListener('input', mapaController_aplicarProfundidad);
  btnProfundidadLimpiarEl.addEventListener('click', mapaController_limpiarProfundidad);
  inputTramoDesdeEl.addEventListener('input', mapaController_aplicarTramo);
  inputTramoHastaEl.addEventListener('input', mapaController_aplicarTramo);
  btnTramoLimpiarEl.addEventListener('click', mapaController_limpiarTramo);

  // Chips Ubicacion (Confirmada/Disponible + Todos - estaticos en el
  // HTML, no se recrean nunca, por eso un listener por chip alcanza) -
  // mismo reducer que Cuenca/Departamento (mapaLogic_toggleFiltroMultiple).
  estadoChipsEls.forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapaEstado.estadosActivos = mapaLogic_toggleFiltroMultiple(mapaEstado.estadosActivos, chip.getAttribute('data-estado'));
      mapaController_actualizarChipsEstado();
      if (mapaEstado.contextoActual && mapaEstado.puntosCrudos) {
        mapaController_renderPuntos(mapaEstado.contextoActual);
      }
    });
  });

  // Chips Mapa/Satelite - estaticos en el HTML. Antes de que exista el
  // mapa (mapaEstado.capasBase todavia null) mapaController_cambiarCapaBase
  // no hace nada, asi que tocarlos antes de la primera apertura es
  // inofensivo.
  capaBaseChipsEls.forEach(function (chip) {
    chip.addEventListener('click', function () {
      mapaController_cambiarCapaBase(chip.getAttribute('data-capa'));
    });
  });

  // Chip "Niveles estáticos" - el grupo entero empieza hidden en el HTML
  // y mapaController_abrir lo desoculta solo con ne=SI, asi que este
  // listener nunca dispara para un usuario sin el permiso (el boton ni
  // siquiera es clickeable/visible).
  chipNEEl.addEventListener('click', function () {
    if (mapaEstado.contextoActual) {
      mapaController_toggleNE(mapaEstado.contextoActual);
    }
  });

  btnReintentar.addEventListener('click', function () {
    if (mapaEstado.contextoActual) {
      mapaController_abrir(mapaEstado.contextoActual);
    }
  });

  btnBuscarToggleEl.addEventListener('click', mapaController_toggleBusqueda);
  btnBuscarCerrarEl.addEventListener('click', mapaController_cerrarPanelBusqueda);

  // Primer keystroke con intencion de buscar: repinta YA con lo que haya
  // (wellId siempre disponible, sin fetch) y, en paralelo, si hace falta
  // el indice de NC16+titular y todavia no esta, lo pide UNA sola vez -
  // cuando resuelve, solo repinta si el input sigue diciendo lo mismo
  // (evita pisar una busqueda mas nueva con una respuesta vieja).
  inputBuscarEl.addEventListener('input', function () {
    var contexto = mapaEstado.contextoActual;
    if (!contexto) {
      return;
    }
    var query = inputBuscarEl.value;
    mapaController_renderResultadosBusqueda(query, contexto);

    if (contexto.permisos && contexto.permisos.datos && !mapaEstado.indiceBusqueda) {
      mapaController_asegurarIndiceBusqueda(contexto).then(function () {
        if (inputBuscarEl.value === query) {
          mapaController_renderResultadosBusqueda(query, contexto);
        }
      });
    }
  });

  window.mapaController_abrir = mapaController_abrir;
  window.mapaController_cerrar = mapaController_cerrar;
})();
