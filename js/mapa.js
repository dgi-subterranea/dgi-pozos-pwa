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
//   {tipo: 'pozo', wellId}                    - centra y abre el popup de ESE pozo
//   {tipo: 'ubicacion', lat, lon, radioMetros} - centra en esas coordenadas (la posicion del usuario, que SOLO viaja de app.js a aca en memoria - nunca se manda a ningun backend) y agrega el marcador "Tu ubicacion"
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
    departamentoActual: 'todos',
    estadosActivos: { C: true, D: true }, // chips Ubicacion (Confirmada/Disponible) - arrancan ambos activos (sin filtrar)
    deptosExpandido: false,  // true = "+N mas" ya tocado, se ven todos los chips de departamento
    markersPorWellId: {},    // se reconstruye en cada renderPuntos() - permite ubicar el marker de un wellId puntual para enfoque:{tipo:'pozo'}
    miUbicacionMarker: null, // marcador "Tu ubicacion" (enfoque:{tipo:'ubicacion'}) - se saca en cada apertura que no lo pida, para no dejar uno viejo colgado
    neWellIdSet: null,       // Set de wellId de la red NE (mapaLogic_setWellIdNE sobre getMapaNE) - se arma UNA sola vez, la PRIMERA vez que se activa el filtro "Tiene: Niveles estáticos" (carga diferida real)
    neActivo: false,         // estado del filtro "Tiene: Niveles estáticos" (v2.2.0: filtro sobre el padron, NO una capa aparte - ver mapaController_renderPuntos, que lo combina con AND junto a departamento/estado)
    indiceBusqueda: null,    // mapa wellId->{nc16,titular} (mapaLogic_indiceBusquedaPorWellId sobre getIndiceBusquedaProvincia) - se arma UNA sola vez, la PRIMERA vez que el usuario escribe algo en el buscador (Etapa 1A, carga diferida real, nunca al abrir el mapa). NC16 y titular viajan juntos, gateados por "datos" - ver decision de arquitectura en MapaService.js
    busquedaActiva: false,   // true = el panel del buscador esta desplegado
    marcadorBusquedaTemporal: null, // marker de "Mostrarlo igual" para un resultado de busqueda que los filtros activos esconden - se saca en cuanto cambia cualquier filtro o se abre una busqueda nueva, nunca sobrevive a eso
    contextoActual: null,    // {sessionToken, permisos, onAbrirPozo, enfoque} de la apertura en curso
    aperturaId: 0             // se incrementa en cada apertura/cierre - una respuesta de red de una apertura vieja se descarta si ya cambio (mismo patron de staleness que buscarPozo en app.js)
  };

  var loadingEl = document.getElementById('mapa-loading');
  var errorEl = document.getElementById('mapa-error');
  var errorMensajeEl = document.getElementById('mapa-error-mensaje');
  var mapaEl = document.getElementById('mapa-leaflet');
  var contadorEl = document.getElementById('mapa-contador');
  var deptosChipsEl = document.getElementById('mapa-deptos-chips');
  var btnDeptosExpandirEl = document.getElementById('btn-mapa-deptos-expandir');
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
      disableClusteringAtZoom: MAPA_ZOOM_INDIVIDUAL
    });
    mapaEstado.mapa.addLayer(mapaEstado.clusterGroup);
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
  function mapaController_renderChipsDepartamento(totalPozos) {
    var division = mapaLogic_dividirChipsDepartamento(mapaEstado.opcionesDepartamento, mapaController_cantidadChipsIniciales());
    var hayMasQueMostrar = division.ocultos.length > 0;
    var visibles = (mapaEstado.deptosExpandido || !hayMasQueMostrar) ? mapaEstado.opcionesDepartamento : division.visibles;

    deptosChipsEl.innerHTML = '';
    deptosChipsEl.appendChild(mapaController_construirChipDepartamento('todos', 'Todos (' + totalPozos + ')', mapaEstado.departamentoActual === 'todos'));
    visibles.forEach(function (o) {
      deptosChipsEl.appendChild(mapaController_construirChipDepartamento(o.codigo, o.nombre + ' (' + o.cantidad + ')', mapaEstado.departamentoActual === o.codigo));
    });

    if (hayMasQueMostrar) {
      btnDeptosExpandirEl.hidden = false;
      btnDeptosExpandirEl.textContent = mapaEstado.deptosExpandido ? 'Mostrar menos' : '+' + division.ocultos.length + ' más';
    } else {
      btnDeptosExpandirEl.hidden = true;
    }
  }

  function mapaController_poblarChipsDepartamento(pozos) {
    mapaEstado.opcionesDepartamento = mapaLogic_construirOpcionesDepartamento(pozos);
    // Si el departamento activo ya no existe en el dataset (no deberia
    // pasar en la practica - el dataset es el mismo entre aperturas -
    // pero mismo criterio defensivo que tenia el <select> anterior),
    // vuelve a "todos" en vez de quedar en un filtro invisible.
    var sigueValido = mapaEstado.departamentoActual === 'todos' ||
      mapaEstado.opcionesDepartamento.some(function (o) { return o.codigo === mapaEstado.departamentoActual; });
    if (!sigueValido) {
      mapaEstado.departamentoActual = 'todos';
    }
    mapaController_renderChipsDepartamento(pozos.length);
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

    // departamento AND estado AND "Tiene: Niveles estáticos" (v2.2.0,
    // arquitectura de 2 mapas - aprobado): se encadenan 3 filtros puros
    // de mapaLogic.js, cada uno responsable de un solo criterio. El
    // filtro NE reduce el padron a la interseccion con la red NE (ver
    // mapaLogic_filtrarPorNE) - nunca agrega puntos que no esten ya en
    // getMapaPozos, y nunca muestra los 34 puntos NE especiales (sin
    // wellId no pueden estar en el Set - ver mapaLogic_setWellIdNE).
    var filtrados = mapaLogic_filtrarPorNE(
      mapaLogic_filtrarPorEstado(
        mapaLogic_filtrarPorDepartamento(mapaEstado.puntosCrudos, mapaEstado.departamentoActual),
        mapaEstado.estadosActivos
      ),
      mapaEstado.neWellIdSet,
      mapaEstado.neActivo
    );

    mapaEstado.clusterGroup.clearLayers();
    mapaEstado.markersPorWellId = {};
    var markers = filtrados.map(function (p) {
      var marker = mapaController_crearMarker(p, contexto);
      mapaEstado.markersPorWellId[p.wellId] = marker;
      return marker;
    });
    mapaEstado.clusterGroup.addLayers(markers);

    contadorEl.hidden = false;
    contadorEl.textContent = filtrados.length + ' de ' + mapaEstado.puntosCrudos.length + ' pozos';

    if (filtrados.length > 0 && !saltarAutoFit) {
      mapaEstado.mapa.fitBounds(mapaEstado.clusterGroup.getBounds().pad(0.05));
    }
  }

  // Icono div (sin imagenes vendorizadas, igual que los circleMarker de
  // pozos) para "Tu ubicacion" - un punto solido con un pulso animado
  // alrededor, visualmente bien distinto de los pozos (color accent en
  // vez de los 2 teals de Confirmada/Disponible).
  function mapaController_iconoMiUbicacion() {
    return L.divIcon({
      className: 'mapa-mi-ubicacion-icono',
      html: '<span class="mapa-mi-ubicacion-pulso"></span><span class="mapa-mi-ubicacion-punto"></span>',
      iconSize: [18, 18],
      iconAnchor: [9, 9]
    });
  }

  // Aplica un enfoque (opcional) DESPUES de renderizar los puntos: o
  // centra+abre el popup de un pozo puntual, o centra en la ubicacion
  // del usuario y le agrega su marcador. El marcador "Tu ubicacion" de
  // una apertura anterior se saca siempre primero - si esta apertura no
  // pide uno nuevo, no debe quedar ninguno colgado.
  function mapaController_aplicarEnfoque(contexto) {
    if (mapaEstado.miUbicacionMarker) {
      mapaEstado.mapa.removeLayer(mapaEstado.miUbicacionMarker);
      mapaEstado.miUbicacionMarker = null;
    }

    var enfoque = contexto.enfoque;
    if (!enfoque) {
      return;
    }

    if (enfoque.tipo === 'ubicacion') {
      mapaEstado.miUbicacionMarker = L.marker([enfoque.lat, enfoque.lon], { icon: mapaController_iconoMiUbicacion() })
        .bindPopup('Tu ubicación');
      mapaEstado.miUbicacionMarker.addTo(mapaEstado.mapa);

      var bbox = cercaMioLogic_boundingBox(enfoque.lat, enfoque.lon, enfoque.radioMetros || CERCA_MIO_RADIO_DEFAULT_METROS);
      mapaEstado.mapa.fitBounds([[bbox.latMin, bbox.lonMin], [bbox.latMax, bbox.lonMax]], { padding: [20, 20] });
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
      }
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
    mapaController_cerrarPanelBusqueda();
    mapaController_limpiarMarcadorBusquedaTemporal();

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

    if (!contexto.permisos || !contexto.permisos.ubicacion) {
      // Defensa en profundidad: el boton de acceso (btn-abrir-mapa) ya
      // deberia estar oculto sin este permiso (ver toggleAccesoMapa en
      // app.js), pero si de todas formas se llega aca, nunca se dispara
      // el fetch.
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

        // Si vinimos a mostrar un pozo puntual (enfoque:{tipo:'pozo'}), los
        // filtros de departamento, estado Y "Tiene: Niveles estáticos"
        // tienen que estar sin restringir ANTES de renderizar - si no, un
        // filtro previo (ej. "solo Confirmada", un departamento distinto o
        // el filtro NE activo con ese wellId fuera del Set) podria dejar
        // ese wellId afuera y mapaController_aplicarEnfoque no lo
        // encontraria.
        if (contexto.enfoque && contexto.enfoque.tipo === 'pozo') {
          mapaEstado.departamentoActual = 'todos';
          mapaEstado.estadosActivos = { C: true, D: true };
          estadoChipsEls.forEach(function (chip) {
            chip.classList.add('active');
            chip.setAttribute('aria-pressed', 'true');
          });
          mapaEstado.neActivo = false;
          chipNEEl.classList.remove('active');
          chipNEEl.setAttribute('aria-pressed', 'false');
        }

        mapaController_poblarChipsDepartamento(mapaEstado.puntosCrudos);
        mapaController_renderPuntos(contexto, !!contexto.enfoque);
        // markersPorWellId ya esta poblado en este punto (renderPuntos lo
        // arma de forma sincronica, ANTES de pasarle los markers a
        // clusterGroup.addLayers - no hace falta esperar a que termine el
        // chunked loading de addLayers para encontrar el marker de un
        // wellId puntual).
        mapaController_aplicarEnfoque(contexto);
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
    var nuevoDepto = chip.getAttribute('data-depto');
    if (nuevoDepto === mapaEstado.departamentoActual) {
      return;
    }
    mapaEstado.departamentoActual = nuevoDepto;
    mapaController_renderChipsDepartamento(mapaEstado.puntosCrudos.length);
    mapaController_renderPuntos(mapaEstado.contextoActual);
  });

  btnDeptosExpandirEl.addEventListener('click', function () {
    mapaEstado.deptosExpandido = !mapaEstado.deptosExpandido;
    if (mapaEstado.puntosCrudos) {
      mapaController_renderChipsDepartamento(mapaEstado.puntosCrudos.length);
    }
  });

  // Chips Ubicacion (Confirmada/Disponible - estaticos en el HTML, no se
  // recrean nunca, por eso un listener por chip alcanza). Nunca se deja
  // apagar el ultimo chip activo: evita el estado ambiguo "0 activos" en
  // la UI directamente (mapaLogic_filtrarPorEstado igual lo interpretaria
  // como "sin filtro" si alguna vez llegara ahi, pero la UI ni lo
  // permite - ver punto 1 de la Etapa v2.1.0, "nunca dejar el mapa en un
  // estado ambiguo").
  estadoChipsEls.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var estado = chip.getAttribute('data-estado');
      var estaActivo = mapaEstado.estadosActivos[estado];
      var cantidadActivos = (mapaEstado.estadosActivos.C ? 1 : 0) + (mapaEstado.estadosActivos.D ? 1 : 0);
      if (estaActivo && cantidadActivos === 1) {
        return;
      }
      mapaEstado.estadosActivos[estado] = !estaActivo;
      chip.classList.toggle('active', mapaEstado.estadosActivos[estado]);
      chip.setAttribute('aria-pressed', mapaEstado.estadosActivos[estado] ? 'true' : 'false');
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
