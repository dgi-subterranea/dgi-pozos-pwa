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

  // --- Filtros (Etapa 1B) ---
  var btnFiltrosToggleEl = document.getElementById('btn-mapa-ne-filtros-toggle');
  var panelFiltrosEl = document.getElementById('mapa-ne-filtros-panel');
  var cuencaChipsEl = document.getElementById('mapa-ne-cuenca-chips');
  var zonaChipsEl = document.getElementById('mapa-ne-zona-chips');
  var btnZonaExpandirEl = document.getElementById('btn-mapa-ne-zona-expandir');
  var toggleChipsEls = Array.prototype.slice.call(document.querySelectorAll('.mapa-ne-toggle-chip'));
  var btnLimpiarFiltrosEl = document.getElementById('btn-mapa-ne-limpiar-filtros');

  // Mismos valores que CANTIDAD_CHIPS_DEPTO_* en js/mapa.js (Provincia) -
  // Zona puede tener ~15-18 valores reales, Cuenca solo 6 (nunca necesita
  // "+N mas").
  var CANTIDAD_CHIPS_ZONA_MOBILE = 4;
  var CANTIDAD_CHIPS_ZONA_DESKTOP = 8;
  var BREAKPOINT_DESKTOP_PX = 640; // mismo breakpoint que css/styles.css

  var mapaNEEstado = {
    mapa: null,           // instancia L.Map PROPIA (nunca la misma que Pozos Provincia)
    capaPuntos: null,     // L.layerGroup con los 405 markers NE - sin cluster (dataset chico, ver adjustment de la Etapa v2.2.0)
    capasBase: null,
    capaBaseActual: null,
    puntos: null,               // ultimo dataset de getMapaNE ya recibido, SIN FILTRAR (para filtrar/buscar sin refetch)
    markersPorMonitoringId: {}, // se reconstruye en cada render con el subset FILTRADO - solo tiene entradas de lo actualmente visible
    marcadorBusquedaTemporal: null, // marker de "Mostrarlo igual" para un resultado de busqueda que los filtros activos esconden - se saca en cuanto cambia cualquier filtro o se abre una busqueda nueva
    busquedaActiva: false,
    filtrosActivo: false,     // true = el panel de filtros esta desplegado
    opcionesCuenca: [],       // ultimo resultado de mapaLogic_construirOpcionesCampoNE sobre 'cuenca' (conteo GLOBAL, nunca condicionado)
    opcionesZona: [],         // mapaLogic_construirOpcionesCampoCondicionadoNE sobre 'zonaNormalizada' - conteo condicionado por cuencaActivos (Etapa 1B.1)
    cuencaActivos: {},        // multi-seleccion OR (Etapa 1B.1) - {valor: boolean}, se puebla en poblarOpcionesFiltros
    zonaActiva: 'todos',      // sigue seleccion UNICA (mismo patron que Departamento en Provincia)
    zonaExpandida: false,     // true = "+N mas" de Zona ya tocado
    estadoActivos: { ACTIVO: true, INACTIVO: true, SIN_DATO: true }, // multi-toggle - los 3 activos por default = sin filtro
    medicionActivos: { CON: true, SIN: true },
    historicoActivos: { CON: true, SIN: true },
    tipoActivos: { REGISTRADO: true, ESPECIAL: true },
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

  // Renderiza un subset YA FILTRADO (ver mapaNEController_aplicarFiltros,
  // que es quien decide ese subset) - esta funcion nunca filtra nada por
  // si misma, solo pinta lo que le pasan. saltarAutoFit: mismo criterio
  // que mapaController_renderPuntos en Provincia (Etapa 1A no lo
  // necesitaba porque no habia enfoque puntual aca; se deja el parametro
  // preparado por si una futura etapa agrega uno, default false).
  function mapaNEController_renderPuntosFiltrados(puntosFiltrados, contexto, saltarAutoFit) {
    mapaNEEstado.capaPuntos.clearLayers();
    mapaNEEstado.markersPorMonitoringId = {};
    var markers = puntosFiltrados.map(function (p) {
      var marker = mapaShared_crearMarkerNE(p, contexto);
      mapaNEEstado.markersPorMonitoringId[p.monitoringId] = marker;
      return marker;
    });
    markers.forEach(function (m) { mapaNEEstado.capaPuntos.addLayer(m); });

    contadorEl.hidden = false;
    contadorEl.textContent = puntosFiltrados.length + ' de ' + mapaNEEstado.puntos.length + ' puntos';

    if (markers.length > 0 && !saltarAutoFit) {
      mapaNEEstado.mapa.fitBounds(mapaNEEstado.capaPuntos.getBounds().pad(0.05));
    }
  }

  // --- Filtros (Etapa 1B) ---
  // Se combinan por AND, cada uno un filtro puro de mapaLogic.js
  // encadenado (mismo patron que Provincia: departamento AND estado AND
  // NE). Cualquier cambio de filtro invalida el "Mostrarlo igual" de una
  // busqueda anterior - nunca sobrevive a un filtro distinto.
  function mapaNEController_aplicarFiltros(contexto) {
    mapaNEController_limpiarMarcadorBusquedaTemporal();

    var filtrados = mapaLogic_filtrarPorFlagNE(
      mapaLogic_filtrarPorFlagNE(
        mapaLogic_filtrarPorFlagNE(
          mapaLogic_filtrarPorEstadoMonitoreo(
            mapaLogic_filtrarPorCampoNE(
              mapaLogic_filtrarPorCampoMultipleNE(mapaNEEstado.puntos, 'cuenca', mapaNEEstado.cuencaActivos),
              'zonaNormalizada', mapaNEEstado.zonaActiva
            ),
            mapaNEEstado.estadoActivos
          ),
          'tieneMedicion2026', mapaNEEstado.medicionActivos.CON, mapaNEEstado.medicionActivos.SIN
        ),
        'tieneHistorico', mapaNEEstado.historicoActivos.CON, mapaNEEstado.historicoActivos.SIN
      ),
      'esEspecial', mapaNEEstado.tipoActivos.ESPECIAL, mapaNEEstado.tipoActivos.REGISTRADO
    );

    mapaNEController_renderPuntosFiltrados(filtrados, contexto);
  }

  function mapaNEController_construirChipCampo(campo, valor, etiqueta, activo, deshabilitado) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'mapa-ne-campo-chip' + (activo ? ' active' : '') + (deshabilitado ? ' disabled' : '');
    chip.setAttribute('data-campo', campo);
    chip.setAttribute('data-valor', valor);
    chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    // disabled nativo (no solo la clase): bloquea el click en el
    // navegador sin que el listener tenga que acordarse de chequearlo -
    // una Zona sin ningun punto en el universo de Cuenca activo queda
    // visible (nunca se saca del DOM) pero no se puede tocar.
    if (deshabilitado) {
      chip.disabled = true;
      chip.setAttribute('aria-disabled', 'true');
    }
    chip.textContent = etiqueta;
    return chip;
  }

  // Puntos dentro de alguna de las cuencas activas (mismo filtro que
  // aplicarFiltros usa para cuenca) - es el "universo" contra el que se
  // condicionan las opciones de Zona (Etapa 1B.1, punto B).
  function mapaNEController_puntosUniversoCuenca() {
    return mapaLogic_filtrarPorCampoMultipleNE(mapaNEEstado.puntos, 'cuenca', mapaNEEstado.cuencaActivos);
  }

  // Recalcula las opciones de Zona contra el universo de Cuenca activo y
  // deselecciona automaticamente la Zona activa si dejo de tener ningun
  // punto compatible (Etapa 1B.1, punto C - "no dejar filtros invisibles/
  // imposibles activos"). Se llama cada vez que cambia la seleccion de
  // Cuenca, nunca al reves.
  function mapaNEController_recalcularOpcionesZona() {
    var universo = mapaNEController_puntosUniversoCuenca();
    mapaNEEstado.opcionesZona = mapaLogic_construirOpcionesCampoCondicionadoNE(mapaNEEstado.puntos, universo, 'zonaNormalizada');
    if (!mapaLogic_valorSigueDisponible(mapaNEEstado.opcionesZona, mapaNEEstado.zonaActiva)) {
      mapaNEEstado.zonaActiva = 'todos';
    }
  }

  // "Todas" (data-valor 'todos') es un ATAJO que reactiva las 6 cuencas,
  // nunca un valor de estado propio - su apariencia "active" se DERIVA
  // de si las 6 estan activas, no se guarda por separado (evita 2
  // fuentes de verdad para lo mismo).
  function mapaNEController_renderChipsCuenca() {
    var todasActivas = mapaNEEstado.opcionesCuenca.every(function (o) { return !!mapaNEEstado.cuencaActivos[o.valor]; });
    cuencaChipsEl.innerHTML = '';
    cuencaChipsEl.appendChild(mapaNEController_construirChipCampo('cuenca', 'todos', 'Todas', todasActivas));
    mapaNEEstado.opcionesCuenca.forEach(function (o) {
      cuencaChipsEl.appendChild(mapaNEController_construirChipCampo('cuenca', o.valor, o.valor + ' (' + o.cantidad + ')', !!mapaNEEstado.cuencaActivos[o.valor]));
    });
  }

  function mapaNEController_cantidadChipsZonaIniciales() {
    return window.innerWidth >= BREAKPOINT_DESKTOP_PX ? CANTIDAD_CHIPS_ZONA_DESKTOP : CANTIDAD_CHIPS_ZONA_MOBILE;
  }

  // "+N mas" - reusa mapaLogic_dividirChipsDepartamento (generica, no
  // depende del nombre del campo) para no duplicar esa logica de
  // paginado de chips. Las opciones ya vienen condicionadas por Cuenca
  // (ver mapaNEController_recalcularOpcionesZona) - una opcion con
  // cantidad:0 se pinta deshabilitada, nunca se saca de la lista.
  function mapaNEController_renderChipsZona() {
    var division = mapaLogic_dividirChipsDepartamento(mapaNEEstado.opcionesZona, mapaNEController_cantidadChipsZonaIniciales());
    var hayMasQueMostrar = division.ocultos.length > 0;
    var visibles = (mapaNEEstado.zonaExpandida || !hayMasQueMostrar) ? mapaNEEstado.opcionesZona : division.visibles;

    zonaChipsEl.innerHTML = '';
    zonaChipsEl.appendChild(mapaNEController_construirChipCampo('zona', 'todos', 'Todos', mapaNEEstado.zonaActiva === 'todos', false));
    visibles.forEach(function (o) {
      zonaChipsEl.appendChild(mapaNEController_construirChipCampo('zona', o.valor, o.valor + ' (' + o.cantidad + ')', mapaNEEstado.zonaActiva === o.valor, o.cantidad === 0));
    });

    if (hayMasQueMostrar) {
      btnZonaExpandirEl.hidden = false;
      btnZonaExpandirEl.textContent = mapaNEEstado.zonaExpandida ? 'Mostrar menos' : '+' + division.ocultos.length + ' más';
    } else {
      btnZonaExpandirEl.hidden = true;
    }
  }

  // Etiquetas de los chips multi-toggle (Estado/Medición 2026/Histórico/
  // Tipo, estaticos en el HTML) - se actualizan UNA vez con el conteo
  // real del dataset completo (mismo criterio que Departamento en
  // Provincia: el conteo es sobre el dataset SIN FILTRAR, nunca
  // recalculado segun otros filtros activos).
  function mapaNEController_actualizarEtiquetasToggle() {
    var puntos = mapaNEEstado.puntos;
    var conteoEstado = mapaLogic_construirConteoEstadoMonitoreo(puntos);
    var conMedicion = puntos.filter(function (p) { return p.tieneMedicion2026; }).length;
    var conHistorico = puntos.filter(function (p) { return p.tieneHistorico; }).length;
    var especiales = puntos.filter(function (p) { return p.esEspecial; }).length;

    var etiquetas = {
      estado: { ACTIVO: 'Activo (' + conteoEstado.ACTIVO + ')', INACTIVO: 'Inactivo (' + conteoEstado.INACTIVO + ')', SIN_DATO: 'Sin dato (' + conteoEstado.SIN_DATO + ')' },
      medicion: { CON: 'Con medición (' + conMedicion + ')', SIN: 'Sin medición (' + (puntos.length - conMedicion) + ')' },
      historico: { CON: 'Con histórico (' + conHistorico + ')', SIN: 'Sin histórico (' + (puntos.length - conHistorico) + ')' },
      tipo: { REGISTRADO: 'Pozo registrado (' + (puntos.length - especiales) + ')', ESPECIAL: 'Punto especial (' + especiales + ')' }
    };

    toggleChipsEls.forEach(function (chip) {
      var grupo = chip.getAttribute('data-grupo');
      var valor = chip.getAttribute('data-valor');
      if (etiquetas[grupo] && etiquetas[grupo][valor]) {
        chip.textContent = etiquetas[grupo][valor];
      }
    });
  }

  // Se llama UNA sola vez, cuando el dataset completo esta disponible
  // (ver mapaNEController_abrir) - las opciones de Cuenca/Zona se
  // calculan sobre el dataset SIN FILTRAR, igual que Departamento en
  // Provincia.
  function mapaNEController_poblarOpcionesFiltros() {
    mapaNEEstado.opcionesCuenca = mapaLogic_construirOpcionesCampoNE(mapaNEEstado.puntos, 'cuenca');
    mapaNEEstado.cuencaActivos = {};
    mapaNEEstado.opcionesCuenca.forEach(function (o) { mapaNEEstado.cuencaActivos[o.valor] = true; });
    mapaNEController_recalcularOpcionesZona();
    mapaNEController_renderChipsCuenca();
    mapaNEController_renderChipsZona();
    mapaNEController_actualizarEtiquetasToggle();
  }

  function mapaNEController_cerrarPanelFiltros() {
    mapaNEEstado.filtrosActivo = false;
    btnFiltrosToggleEl.classList.remove('active');
    btnFiltrosToggleEl.setAttribute('aria-pressed', 'false');
    btnFiltrosToggleEl.setAttribute('aria-expanded', 'false');
    panelFiltrosEl.hidden = true;
  }

  function mapaNEController_toggleFiltrosPanel() {
    if (mapaNEEstado.filtrosActivo) {
      mapaNEController_cerrarPanelFiltros();
      return;
    }
    mapaNEEstado.filtrosActivo = true;
    btnFiltrosToggleEl.classList.add('active');
    btnFiltrosToggleEl.setAttribute('aria-pressed', 'true');
    btnFiltrosToggleEl.setAttribute('aria-expanded', 'true');
    panelFiltrosEl.hidden = false;
  }

  // "Limpiar filtros": vuelve TODO a "sin filtro" (mismo estado inicial
  // que al abrir el mapa) y re-renderiza - nunca cierra el panel solo,
  // el usuario puede seguir ajustando filtros despues de limpiar.
  function mapaNEController_limpiarFiltros() {
    mapaNEEstado.opcionesCuenca.forEach(function (o) { mapaNEEstado.cuencaActivos[o.valor] = true; });
    mapaNEEstado.zonaActiva = 'todos';
    mapaNEEstado.estadoActivos = { ACTIVO: true, INACTIVO: true, SIN_DATO: true };
    mapaNEEstado.medicionActivos = { CON: true, SIN: true };
    mapaNEEstado.historicoActivos = { CON: true, SIN: true };
    mapaNEEstado.tipoActivos = { REGISTRADO: true, ESPECIAL: true };

    mapaNEController_recalcularOpcionesZona();
    mapaNEController_renderChipsCuenca();
    mapaNEController_renderChipsZona();
    toggleChipsEls.forEach(function (chip) {
      chip.classList.add('active');
      chip.setAttribute('aria-pressed', 'true');
    });

    if (mapaNEEstado.contextoActual) {
      mapaNEController_aplicarFiltros(mapaNEEstado.contextoActual);
    }
  }

  // --- Buscador en el mapa NE (Etapa 1A/1B) ---
  // 100% local sobre mapaNEEstado.puntos (ya cargado). Desde 1B, un
  // resultado puede quedar fuera de los filtros activos - mismo patron
  // aprobado en Provincia (aviso + "Mostrarlo igual", nunca resetear
  // filtros en silencio).
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

  // El marker de "Mostrarlo igual" es SIEMPRE temporal: sobrevive solo
  // hasta el siguiente cambio de filtro o la siguiente busqueda - se
  // saca al principio de mapaNEController_aplicarFiltros (cualquier
  // filtro nuevo) y de mapaNEController_abrir (nueva apertura). Nunca se
  // agrega a capaPuntos (evita un marker duplicado si el filtro cambia y
  // el punto empieza a cumplirlo).
  function mapaNEController_limpiarMarcadorBusquedaTemporal() {
    if (mapaNEEstado.marcadorBusquedaTemporal) {
      mapaNEEstado.mapa.removeLayer(mapaNEEstado.marcadorBusquedaTemporal);
      mapaNEEstado.marcadorBusquedaTemporal = null;
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

  // Muestra, en el mismo panel, un aviso de que el resultado elegido no
  // cumple los filtros activos + un boton para mostrarlo temporalmente
  // (mismo patron aprobado en Provincia - nunca resetear filtros en
  // silencio, nunca dejarlo simplemente afuera sin explicar por que).
  function mapaNEController_mostrarAvisoFueraDeFiltro(resultado) {
    resultadosBuscarEl.innerHTML = '';
    var aviso = document.createElement('div');
    aviso.className = 'mapa-buscar-aviso';

    var texto = document.createElement('span');
    texto.textContent = (resultado.wellId || mapaLogic_nombrePuntoNE(resultado)) + ' no cumple los filtros activos.';
    aviso.appendChild(texto);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mapa-buscar-aviso-btn';
    btn.textContent = 'Mostrarlo igual';
    btn.addEventListener('click', function () {
      mapaNEController_mostrarResultadoTemporalmente(resultado);
    });
    aviso.appendChild(btn);

    resultadosBuscarEl.appendChild(aviso);
  }

  function mapaNEController_mostrarResultadoTemporalmente(resultado) {
    mapaNEController_cerrarPanelBusqueda();
    mapaNEController_limpiarMarcadorBusquedaTemporal();
    var marker = mapaShared_crearMarkerNE(resultado, mapaNEEstado.contextoActual);
    marker.addTo(mapaNEEstado.mapa);
    mapaNEEstado.marcadorBusquedaTemporal = marker;
    mapaNEController_centrarYAbrirPopup(marker);
  }

  // Si el monitoringId elegido ya tiene un marker vivo en capaPuntos
  // (pasa los filtros actuales), se reusa ese - nunca se duplica. Si no,
  // se ofrece el aviso de arriba en vez de mostrarlo/ocultarlo sin
  // avisar.
  function mapaNEController_buscarSeleccionar(resultado) {
    var marker = mapaNEEstado.markersPorMonitoringId[resultado.monitoringId];
    if (marker) {
      mapaNEController_cerrarPanelBusqueda();
      mapaNEController_centrarYAbrirPopup(marker);
      return;
    }
    mapaNEController_mostrarAvisoFueraDeFiltro(resultado);
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
    mapaNEController_cerrarPanelFiltros();
    mapaNEController_limpiarMarcadorBusquedaTemporal();

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

      // El contenedor tiene que estar visible y con su tamano real ANTES
      // de fitBounds() (dentro de renderPuntosFiltrados) - ver
      // mapaShared_alMostrarMapa en js/mapaShared.js para el detalle del
      // bug que esto evita (mismo problema que tenia Pozos Provincia).
      mapaShared_alMostrarMapa(mapaNEEstado.mapa, function () {
        if (aperturaId !== mapaNEEstado.aperturaId) {
          return;
        }

        // Reset de filtros a "todos" en cada apertura nueva (mismo
        // criterio que busqueda/temporal - no hace falta persistirlos
        // entre aperturas, pedido explicito de la Etapa 1B).
        mapaNEEstado.puntos = result.data.puntos;
        mapaNEEstado.zonaActiva = 'todos';
        mapaNEEstado.zonaExpandida = false;
        mapaNEEstado.estadoActivos = { ACTIVO: true, INACTIVO: true, SIN_DATO: true };
        mapaNEEstado.medicionActivos = { CON: true, SIN: true };
        mapaNEEstado.historicoActivos = { CON: true, SIN: true };
        mapaNEEstado.tipoActivos = { REGISTRADO: true, ESPECIAL: true };
        toggleChipsEls.forEach(function (chip) {
          chip.classList.add('active');
          chip.setAttribute('aria-pressed', 'true');
        });

        mapaNEController_poblarOpcionesFiltros();
        mapaNEController_aplicarFiltros(contexto);
      });
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

  // --- Filtros (Etapa 1B): listeners ---
  btnFiltrosToggleEl.addEventListener('click', mapaNEController_toggleFiltrosPanel);
  btnLimpiarFiltrosEl.addEventListener('click', mapaNEController_limpiarFiltros);

  // Delegacion en el contenedor (no un listener por chip): los chips se
  // recrean enteros en cada renderChipsCuenca/renderChipsZona, un
  // listener por boton se perderia/duplicaria en cada repintado (mismo
  // criterio que deptosChipsEl en Provincia).
  //
  // Cuenca es multi-seleccion OR (Etapa 1B.1) - "Todas" (data-valor
  // 'todos') reactiva las 6, nunca las apaga (no hay "estado apagado"
  // para ese chip). Un valor especifico se togglea, con el mismo
  // fail-safe "nunca apagar el ultimo activo" que Estado/Medicion/
  // Historico/Tipo. Cualquier cambio de Cuenca recalcula las opciones de
  // Zona (dependen de que cuencas estan activas, ver punto B) y puede
  // deseleccionar la Zona activa si dejo de ser valida (punto C).
  cuencaChipsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.mapa-ne-campo-chip') : null;
    if (!chip || chip.disabled || !mapaNEEstado.contextoActual || !mapaNEEstado.puntos) {
      return;
    }
    var valor = chip.getAttribute('data-valor');

    if (valor === 'todos') {
      mapaNEEstado.opcionesCuenca.forEach(function (o) { mapaNEEstado.cuencaActivos[o.valor] = true; });
    } else {
      var estaActiva = mapaNEEstado.cuencaActivos[valor];
      var cantidadActivas = mapaNEEstado.opcionesCuenca.filter(function (o) { return mapaNEEstado.cuencaActivos[o.valor]; }).length;
      if (estaActiva && cantidadActivas === 1) {
        return;
      }
      mapaNEEstado.cuencaActivos[valor] = !estaActiva;
    }

    mapaNEController_recalcularOpcionesZona();
    mapaNEController_renderChipsCuenca();
    mapaNEController_renderChipsZona();
    mapaNEController_aplicarFiltros(mapaNEEstado.contextoActual);
  });

  zonaChipsEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.mapa-ne-campo-chip') : null;
    if (!chip || chip.disabled || !mapaNEEstado.contextoActual || !mapaNEEstado.puntos) {
      return;
    }
    var nuevoValor = chip.getAttribute('data-valor');
    if (nuevoValor === mapaNEEstado.zonaActiva) {
      return;
    }
    mapaNEEstado.zonaActiva = nuevoValor;
    mapaNEController_renderChipsZona();
    mapaNEController_aplicarFiltros(mapaNEEstado.contextoActual);
  });

  btnZonaExpandirEl.addEventListener('click', function () {
    mapaNEEstado.zonaExpandida = !mapaNEEstado.zonaExpandida;
    if (mapaNEEstado.puntos) {
      mapaNEController_renderChipsZona();
    }
  });

  // Chips multi-toggle (Estado/Medición 2026/Histórico/Tipo) - estáticos
  // en el HTML, agrupados por data-grupo. Nunca se deja apagar el último
  // chip activo de su propio grupo (mismo criterio que estadoChipsEls en
  // Provincia: "0 activos" nunca llega a ser un estado real de la UI,
  // mapaLogic_filtrarPorEstadoMonitoreo/mapaLogic_filtrarPorFlagNE lo
  // interpretarían como "sin filtro" si llegara, pero la UI ni lo permite).
  var MAPA_NE_GRUPO_A_ESTADO = {
    estado: 'estadoActivos',
    medicion: 'medicionActivos',
    historico: 'historicoActivos',
    tipo: 'tipoActivos'
  };
  toggleChipsEls.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var estadoKey = MAPA_NE_GRUPO_A_ESTADO[chip.getAttribute('data-grupo')];
      var valor = chip.getAttribute('data-valor');
      if (!estadoKey) {
        return;
      }
      var activos = mapaNEEstado[estadoKey];
      var estaActivo = activos[valor];
      var cantidadActivos = Object.keys(activos).filter(function (k) { return activos[k]; }).length;
      if (estaActivo && cantidadActivos === 1) {
        return;
      }
      activos[valor] = !estaActivo;
      chip.classList.toggle('active', activos[valor]);
      chip.setAttribute('aria-pressed', activos[valor] ? 'true' : 'false');
      if (mapaNEEstado.contextoActual && mapaNEEstado.puntos) {
        mapaNEController_aplicarFiltros(mapaNEEstado.contextoActual);
      }
    });
  });

  window.mapaNEController_abrir = mapaNEController_abrir;
  window.mapaNEController_cerrar = mapaNEController_cerrar;
})();
