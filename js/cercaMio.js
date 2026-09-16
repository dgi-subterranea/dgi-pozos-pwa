// Pozos Cerca Mio: controlador DOM/geolocation. No se testea con Jest
// (toca DOM/geolocation/fetch en vivo, igual que js/mapa.js/js/app.js) -
// la logica pura (Haversine, bounding box, orden, limite) vive en
// js/cercaMioLogic.js, testeada sin navegador.
//
// PRIVACIDAD (ver Etapa 5C-3): la posicion del usuario
// (navigator.geolocation) se guarda SOLO en estado.miUbicacion, una
// variable de este modulo - NUNCA se pasa a apiGetMapaPozos,
// apiGetWellSummary, apiRegisterWellSearch ni ninguna otra funcion de
// js/api.js. Se usa exclusivamente para: (1) filtrar en el propio
// navegador el dataset ya cargado (ver cercaMioLogic_buscarCercanos,
// funcion pura sin red) y (2) centrar el mapa localmente al tocar "Ver
// en mapa"/"Ver todos en el mapa" (mapaController_abrir con
// enfoque.tipo='ubicacion' - Leaflet solo mueve la vista, tampoco manda
// nada a ningun lado). No se guarda en localStorage ni sessionStorage.
//
// API publica (ver window.cercaMioController_* al final):
// cercaMioController_abrir(contexto) y cercaMioController_cerrar().
// contexto = {sessionToken, permisos, onAbrirPozo(wellId),
// onVerEnMapa(wellId), onVerTodosEnMapa(lat, lon, radioMetros)} - mismo
// criterio que js/mapa.js: app.js es el unico dueño de
// sessionToken/permisos, los pasa frescos en cada apertura.
(function () {
  var estado = {
    aperturaId: 0,
    contextoActual: null,
    radioMetros: CERCA_MIO_RADIO_DEFAULT_METROS,
    miUbicacion: null,   // {lat, lon} - ver nota de privacidad arriba
    datasetCache: null   // referencia al array ya cargado (mapaDataset.js) - nunca se reenvia a ningun lado
  };

  var estadosEls = {
    permiso: document.getElementById('cercamio-pidiendo-permiso'),
    denegado: document.getElementById('cercamio-permiso-denegado'),
    noDisponible: document.getElementById('cercamio-no-disponible'),
    error: document.getElementById('cercamio-error'),
    errorMensaje: document.getElementById('cercamio-error-mensaje'),
    sinResultados: document.getElementById('cercamio-sin-resultados'),
    sinResultadosMensaje: document.getElementById('cercamio-sin-resultados-mensaje'),
    btnAmpliar: document.getElementById('btn-cercamio-ampliar'),
    resultados: document.getElementById('cercamio-resultados'),
    contador: document.getElementById('cercamio-contador'),
    lista: document.getElementById('cercamio-lista')
  };

  var chips = Array.prototype.slice.call(document.querySelectorAll('.cercamio-radio-chip'));
  var btnVerTodosMapa = document.getElementById('btn-cercamio-ver-todos-mapa');

  function mostrarEstado(nombre) {
    ['permiso', 'denegado', 'noDisponible', 'error', 'sinResultados'].forEach(function (k) {
      estadosEls[k].hidden = k !== nombre;
    });
    estadosEls.resultados.hidden = nombre !== 'resultados';
  }

  function actualizarChips() {
    chips.forEach(function (chip) {
      var esActivo = parseInt(chip.getAttribute('data-radio'), 10) === estado.radioMetros;
      chip.classList.toggle('active', esActivo);
      chip.setAttribute('aria-pressed', esActivo ? 'true' : 'false');
    });
  }

  // Punto de entrada unico (ver window.cercaMioController_abrir al
  // final). aperturaId descarta cualquier callback tardio (de
  // geolocation o de red) de una apertura anterior - mismo patron que
  // mapaController_abrir/buscarPozo.
  function cercaMioController_abrir(contexto) {
    estado.aperturaId += 1;
    var aperturaId = estado.aperturaId;
    estado.contextoActual = contexto;
    estado.miUbicacion = null;
    estado.datasetCache = null;
    actualizarChips();

    if (!contexto.permisos || !contexto.permisos.ubicacion) {
      // Defensa en profundidad: el boton de acceso (btn-abrir-cerca-mio)
      // ya deberia estar oculto sin este permiso, pero si de todas
      // formas se llega aca, nunca se pide geolocation ni se hace fetch.
      mostrarEstado('error');
      estadosEls.errorMensaje.textContent = 'No tenés permiso para usar esta función.';
      return;
    }

    if (!navigator.geolocation) {
      mostrarEstado('noDisponible');
      return;
    }

    mostrarEstado('permiso');

    navigator.geolocation.getCurrentPosition(function (pos) {
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      // SOLO lat/lon en memoria - ver nota de privacidad arriba del
      // archivo. Nunca se guarda pos.coords completo (trae accuracy,
      // altitude, etc. que tampoco hacen falta).
      estado.miUbicacion = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      cercaMioController_cargarDatasetYRenderizar(contexto, aperturaId);
    }, function (err) {
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      if (err.code === err.PERMISSION_DENIED) {
        mostrarEstado('denegado');
      } else {
        // POSITION_UNAVAILABLE o TIMEOUT: mismo mensaje generico, nunca
        // el texto crudo del error del navegador.
        mostrarEstado('error');
        estadosEls.errorMensaje.textContent = 'No pudimos obtener tu ubicación. Intentá de nuevo.';
      }
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  }

  function cercaMioController_cargarDatasetYRenderizar(contexto, aperturaId) {
    // mapaDataset_obtener (js/mapaDataset.js) es la MISMA cache que usa
    // el Mapa de Pozos - si el usuario ya abrio el mapa antes en esta
    // sesion, esto no vuelve a pedir nada a Apps Script (y funciona sin
    // red, ver requisito de offline de la Etapa 5C-3).
    mapaDataset_obtener(contexto.sessionToken).then(function (result) {
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      if (result.status !== 'ok') {
        mostrarEstado('error');
        estadosEls.errorMensaje.textContent = 'No se pudo cargar el listado de pozos. Intentá de nuevo.';
        return;
      }
      estado.datasetCache = result.data.pozos;
      cercaMioController_renderizarResultados(contexto);
    }).catch(function () {
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      mostrarEstado('error');
      estadosEls.errorMensaje.textContent = 'No se pudo cargar el listado de pozos. Revisá tu conexión.';
    });
  }

  function cercaMioController_renderizarResultados(contexto) {
    var resultados = cercaMioLogic_buscarCercanos(estado.datasetCache, estado.miUbicacion.lat, estado.miUbicacion.lon, estado.radioMetros);

    if (resultados.length === 0) {
      mostrarEstado('sinResultados');
      estadosEls.sinResultadosMensaje.textContent = 'No encontramos pozos a menos de ' + cercaMioLogic_formatearDistancia(estado.radioMetros) + '.';

      var indiceActual = CERCA_MIO_RADIOS_METROS.indexOf(estado.radioMetros);
      var siguienteRadio = indiceActual >= 0 ? CERCA_MIO_RADIOS_METROS[indiceActual + 1] : null;
      if (siguienteRadio) {
        estadosEls.btnAmpliar.hidden = false;
        estadosEls.btnAmpliar.textContent = 'Ampliar a ' + cercaMioLogic_formatearDistancia(siguienteRadio);
        estadosEls.btnAmpliar.onclick = function () {
          estado.radioMetros = siguienteRadio;
          actualizarChips();
          cercaMioController_renderizarResultados(contexto);
        };
      } else {
        estadosEls.btnAmpliar.hidden = true;
      }
      return;
    }

    mostrarEstado('resultados');
    estadosEls.contador.textContent = resultados.length + (resultados.length >= CERCA_MIO_MAX_RESULTADOS ? '+' : '') +
      ' pozo' + (resultados.length === 1 ? '' : 's') + ' encontrado' + (resultados.length === 1 ? '' : 's');
    cercaMioController_pintarLista(resultados, contexto);
  }

  function cercaMioController_pintarLista(resultados, contexto) {
    estadosEls.lista.innerHTML = '';
    resultados.forEach(function (r) {
      estadosEls.lista.appendChild(cercaMioController_construirItem(r, contexto));
    });
  }

  // Cada item arranca colapsado (solo wellId + distancia, sin fetch
  // ninguno). El summary (titular/departamento/distrito) se pide SOLO
  // al expandir ESE item puntual, y SOLO una vez por item (yaConsultado)
  // - nunca los 30 de una, mismo criterio que el popup del mapa (ver
  // mapaController_crearMarker en js/mapa.js). Si datos=NO, nunca se
  // dispara el fetch (mapaLogic_debeConsultarSummary).
  function cercaMioController_construirItem(resultado, contexto) {
    var item = document.createElement('div');
    item.className = 'cercamio-item';

    var main = document.createElement('button');
    main.type = 'button';
    main.className = 'cercamio-item-main';

    var idEl = document.createElement('span');
    idEl.className = 'cercamio-item-id mono';
    idEl.textContent = resultado.wellId;

    var distEl = document.createElement('span');
    distEl.className = 'cercamio-item-dist';
    distEl.textContent = cercaMioLogic_formatearDistancia(resultado.distanciaMetros);

    var chevEl = document.createElement('span');
    chevEl.className = 'cercamio-item-chev';
    chevEl.setAttribute('aria-hidden', 'true');
    chevEl.textContent = '›';

    main.appendChild(idEl);
    main.appendChild(distEl);
    main.appendChild(chevEl);
    item.appendChild(main);

    var detalle = document.createElement('div');
    detalle.className = 'cercamio-item-detalle';
    detalle.hidden = true;

    var summaryEl = document.createElement('div');
    summaryEl.className = 'cercamio-item-summary';
    detalle.appendChild(summaryEl);

    var actions = document.createElement('div');
    actions.className = 'cercamio-item-actions';

    var btnMapa = document.createElement('button');
    btnMapa.type = 'button';
    btnMapa.className = 'button-secondary';
    btnMapa.textContent = 'Ver en mapa';
    btnMapa.addEventListener('click', function (ev) {
      ev.stopPropagation();
      contexto.onVerEnMapa(resultado.wellId);
    });

    var btnAbrir = document.createElement('button');
    btnAbrir.type = 'button';
    btnAbrir.className = 'button';
    btnAbrir.textContent = 'Abrir pozo';
    btnAbrir.addEventListener('click', function (ev) {
      ev.stopPropagation();
      contexto.onAbrirPozo(resultado.wellId);
    });

    actions.appendChild(btnMapa);
    actions.appendChild(btnAbrir);
    detalle.appendChild(actions);
    item.appendChild(detalle);

    var yaConsultado = false;
    main.addEventListener('click', function () {
      var abriendo = detalle.hidden;
      detalle.hidden = !abriendo;
      item.classList.toggle('cercamio-item-expandido', abriendo);

      if (abriendo && !yaConsultado && mapaLogic_debeConsultarSummary(contexto.permisos)) {
        yaConsultado = true;
        summaryEl.textContent = 'Cargando datos...';

        apiGetWellSummary(contexto.sessionToken, resultado.wellId).then(function (result) {
          summaryEl.innerHTML = '';
          if (result.status === 'ok') {
            var data = result.data;
            if (data.titular) {
              var t = document.createElement('p');
              t.className = 'cercamio-item-titular';
              t.textContent = data.titular;
              summaryEl.appendChild(t);
            }
            var sub = [data.departamento, data.distrito].filter(Boolean).join(' · ');
            if (sub) {
              var s = document.createElement('p');
              s.className = 'cercamio-item-sub';
              s.textContent = sub;
              summaryEl.appendChild(s);
            }
          }
        }).catch(function () {
          summaryEl.textContent = '';
        });
      }
    });

    return item;
  }

  function cercaMioController_cerrar() {
    estado.aperturaId += 1;
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      estado.radioMetros = parseInt(chip.getAttribute('data-radio'), 10);
      actualizarChips();
      // Cambiar de radio NUNCA vuelve a pedir geolocation ni a refetchear
      // el dataset - es un recalculo puramente local sobre lo que ya
      // esta en memoria.
      if (estado.contextoActual && estado.miUbicacion && estado.datasetCache) {
        cercaMioController_renderizarResultados(estado.contextoActual);
      }
    });
  });

  btnVerTodosMapa.addEventListener('click', function () {
    if (estado.contextoActual && estado.miUbicacion) {
      estado.contextoActual.onVerTodosEnMapa(estado.miUbicacion.lat, estado.miUbicacion.lon, estado.radioMetros);
    }
  });

  Array.prototype.forEach.call(document.querySelectorAll('.btn-cercamio-reintentar'), function (btn) {
    btn.addEventListener('click', function () {
      if (estado.contextoActual) {
        cercaMioController_abrir(estado.contextoActual);
      }
    });
  });

  window.cercaMioController_abrir = cercaMioController_abrir;
  window.cercaMioController_cerrar = cercaMioController_cerrar;
})();
