// Pozos Cerca Mio: controlador DOM/geolocation. No se testea con Jest
// (toca DOM/geolocation/fetch en vivo, igual que js/mapa.js/js/app.js) -
// la logica pura (Haversine, bounding box, orden, limite) vive en
// js/cercaMioLogic.js, testeada sin navegador.
//
// PRIVACIDAD (ver Etapa 5C-3, ampliado en la Etapa siguiente item B/E): la
// posicion de referencia se guarda SOLO en memoria de este modulo - o bien
// estado.miUbicacion (navigator.geolocation, "Mi ubicacion") o bien
// estado.puntoElegido (un tap en el mini-mapa de "Elegir en mapa") - NUNCA
// se pasa a apiGetMapaPozos, apiGetWellSummary, apiRegisterWellSearch ni
// ninguna otra funcion de js/api.js, y NUNCA se guarda en localStorage ni
// sessionStorage. Se usa exclusivamente para: (1) filtrar en el propio
// navegador el dataset ya cargado (ver cercaMioLogic_buscarCercanos,
// funcion pura sin red) y (2) centrar el mapa localmente al tocar "Ver en
// mapa"/"Ver todos en el mapa" (mapaController_abrir con
// enfoque.tipo='ubicacion'|'puntoBusqueda' - Leaflet solo mueve la vista,
// tampoco manda nada a ningun lado). Cambiar de radio o mover el punto
// elegido NUNCA dispara apiRegisterWellSearch - esa funcion solo se llama
// desde "Abrir pozo" (ver buscarPozo en js/app.js), igual que antes de
// esta etapa.
//
// API publica (ver window.cercaMioController_* al final):
// cercaMioController_abrir(contexto), cercaMioController_cerrar() y
// cercaMioController_reanudar() (volver desde el mapa SIN reiniciar la
// busqueda).
// contexto = {sessionToken, permisos, onAbrirPozo(wellId),
// onVerEnMapa(wellId), onVerTodosEnMapa()} - mismo criterio que
// js/mapa.js: app.js es el unico dueño de sessionToken/permisos, los
// pasa frescos en cada apertura. Antes de pedir "Ver en mapa"/"Ver todos
// en el mapa" este modulo publica la busqueda radial como VISTA PREVIA
// (seleccionController_establecerVistaPrevia: punto + radio + pozos), que
// es lo que el mapa dibuja - por eso esas 2 callbacks ya no llevan
// lat/lon/radio.
(function () {
  var estado = {
    aperturaId: 0,
    contextoActual: null,
    radioMetros: CERCA_MIO_RADIO_DEFAULT_METROS,
    radioPersonalizadoActivo: false, // true = chip "Personalizado" activo (item C)
    referencia: 'miUbicacion',  // 'miUbicacion' | 'elegirMapa' (item B)
    miUbicacion: null,   // {lat, lon} - ver nota de privacidad arriba
    puntoElegido: null,  // {lat, lon} - idem, elegido a mano en el mini-mapa
    datasetCache: null,  // referencia al array ya cargado (mapaDataset.js) - nunca se reenvia a ningun lado
    pickerMapa: null,    // instancia L.Map del mini-mapa de "Elegir en mapa", se crea UNA sola vez
    pickerMarker: null,  // marcador "Punto de busqueda" sobre pickerMapa
    puedeVerMapa: false, // perfil=SI o ne=SI: habilita los botones que abren el mapa Provincia
    encontrados: [],     // TODOS los pozos del radio actual, ordenados por distancia (sin el tope de 30): sobre este conjunto filtra localmente la aptitud, sin recalcular GPS ni radio
    reemplazoActivos: {}, // filtro "Aptitud para reemplazo" (solo reemplazo=SI), multi-seleccion OR
    pickerCirculo: null  // L.circle del radio sobre pickerMapa (item 3 del cierre) - sigue al marcador y se redimensiona en vivo con el radio, sin tocar el centro
  };

  var estadosEls = {
    permiso: document.getElementById('cercamio-pidiendo-permiso'),
    denegado: document.getElementById('cercamio-permiso-denegado'),
    noDisponible: document.getElementById('cercamio-no-disponible'),
    error: document.getElementById('cercamio-error'),
    errorMensaje: document.getElementById('cercamio-error-mensaje'),
    eligiendoPunto: document.getElementById('cercamio-eligiendo-punto'),
    sinResultados: document.getElementById('cercamio-sin-resultados'),
    sinResultadosMensaje: document.getElementById('cercamio-sin-resultados-mensaje'),
    btnAmpliar: document.getElementById('btn-cercamio-ampliar'),
    resultados: document.getElementById('cercamio-resultados'),
    contador: document.getElementById('cercamio-contador'),
    lista: document.getElementById('cercamio-lista'),
    headerLabel: document.getElementById('cercamio-header-label')
  };

  var chips = Array.prototype.slice.call(document.querySelectorAll('.cercamio-radio-chip'));
  var btnVerTodosMapa = document.getElementById('btn-cercamio-ver-todos-mapa');
  var btnUsarSeleccionEl = document.getElementById('btn-cercamio-usar-seleccion');
  var btnRefUbicacion = document.getElementById('btn-cercamio-ref-ubicacion');
  var btnRefMapa = document.getElementById('btn-cercamio-ref-mapa');
  var radioPersonalizadoWrapEl = document.getElementById('cercamio-radio-personalizado');
  var inputRadioKmEl = document.getElementById('input-cercamio-radio-km');
  var radioPersonalizadoErrorEl = document.getElementById('cercamio-radio-personalizado-error');
  var btnBuscarDesdePuntoEl = document.getElementById('btn-cercamio-buscar-desde-punto');
  var grupoReemplazoEl = document.getElementById('cercamio-grupo-reemplazo');
  var reemplazoChipsEl = document.getElementById('cercamio-reemplazo-chips');

  function mostrarEstado(nombre) {
    ['permiso', 'denegado', 'noDisponible', 'error', 'eligiendoPunto', 'sinResultados'].forEach(function (k) {
      estadosEls[k].hidden = k !== nombre;
    });
    estadosEls.resultados.hidden = nombre !== 'resultados';
  }

  function actualizarChips() {
    chips.forEach(function (chip) {
      var valor = chip.getAttribute('data-radio');
      var esActivo = valor === 'personalizado'
        ? estado.radioPersonalizadoActivo
        : (!estado.radioPersonalizadoActivo && parseInt(valor, 10) === estado.radioMetros);
      chip.classList.toggle('active', esActivo);
      chip.setAttribute('aria-pressed', esActivo ? 'true' : 'false');
    });
  }

  // Referencia actualmente en uso (item B): la funcion central que todo el
  // resto del archivo consulta en vez de leer estado.miUbicacion directo -
  // asi "Elegir en mapa" reusa EXACTAMENTE el mismo pipeline de busqueda/
  // renderizado/"Ver todos en el mapa" que "Mi ubicacion", sin duplicar
  // nada (cercaMioLogic_buscarCercanos ya recibe lat/lon genericos).
  function cercaMioController_referenciaActual() {
    return estado.referencia === 'elegirMapa' ? estado.puntoElegido : estado.miUbicacion;
  }

  function actualizarChipsReferencia() {
    var esUbicacion = estado.referencia === 'miUbicacion';
    btnRefUbicacion.classList.toggle('active', esUbicacion);
    btnRefUbicacion.setAttribute('aria-pressed', esUbicacion ? 'true' : 'false');
    btnRefMapa.classList.toggle('active', !esUbicacion);
    btnRefMapa.setAttribute('aria-pressed', !esUbicacion ? 'true' : 'false');
  }

  function actualizarHeaderLabel() {
    if (estado.referencia === 'miUbicacion') {
      estadosEls.headerLabel.textContent = 'Según tu ubicación actual';
    } else {
      estadosEls.headerLabel.textContent = estado.puntoElegido ? 'Según el punto elegido en el mapa' : 'Elegí un punto en el mapa';
    }
  }

  // Punto de entrada unico (ver window.cercaMioController_abrir al
  // final). aperturaId descarta cualquier callback tardio (de
  // geolocation o de red) de una apertura anterior - mismo patron que
  // mapaController_abrir/buscarPozo.
  function cercaMioController_abrir(contexto) {
    estado.aperturaId += 1;
    var aperturaId = estado.aperturaId;
    estado.contextoActual = contexto;
    estado.reemplazoActivos = {};
    estado.encontrados = [];
    // Una busqueda nueva arranca sin la vista previa de la anterior.
    seleccionController_limpiarVistaPrevia();
    estado.miUbicacion = null;
    estado.puntoElegido = null;
    estado.datasetCache = null;
    estado.referencia = 'miUbicacion';
    estado.radioPersonalizadoActivo = false;
    estado.radioMetros = CERCA_MIO_RADIO_DEFAULT_METROS;
    if (estado.pickerMarker) {
      estado.pickerMapa.removeLayer(estado.pickerMarker);
      estado.pickerMarker = null;
    }
    if (estado.pickerCirculo) {
      estado.pickerMapa.removeLayer(estado.pickerCirculo);
      estado.pickerCirculo = null;
    }
    btnBuscarDesdePuntoEl.disabled = true;
    radioPersonalizadoWrapEl.hidden = true;
    radioPersonalizadoErrorEl.hidden = true;
    inputRadioKmEl.value = '';
    actualizarChips();
    actualizarChipsReferencia();
    actualizarHeaderLabel();

    // Cerca Mio esta disponible para TODO usuario activo (no depende de
    // ningun permiso de modulo, ver mapaLogic_calcularAccesos). Lo que SI
    // depende de perfil/ne es poder abrir el mapa Pozos Provincia: sin ese
    // acceso se ocultan "Ver todos en el mapa" y "Ver en mapa" por pozo
    // (la busqueda, la lista y "Usar estos pozos" siguen funcionando).
    estado.puedeVerMapa = mapaLogic_puedeVerProvincia(contexto.permisos);
    btnVerTodosMapa.hidden = !estado.puedeVerMapa;

    cercaMioController_solicitarUbicacion(contexto, aperturaId);
  }

  // Pide navigator.geolocation y, si tiene exito, carga el dataset y
  // renderiza - extraido de cercaMioController_abrir para poder reusarlo
  // cuando el usuario vuelve a "Mi ubicacion" desde "Elegir en mapa" sin
  // haber pedido la posicion todavia en esta apertura (item B: cambiar de
  // referencia NUNCA repite un pedido que ya tuvo exito antes).
  function cercaMioController_solicitarUbicacion(contexto, aperturaId) {
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
    // Aptitud para reemplazo: UNA llamada batch (o cache), solo con
    // reemplazo=SI; sin permiso no hace ninguna llamada. Nunca rechaza.
    // Contador de fotos: idem, una llamada batch con cache y solo con fotos=SI.
    var pResumen = Promise.all([reemplazoEstadosController_cargar(), fotosPozosResumenController_cargar()]);
    mapaDataset_obtener(contexto.sessionToken).then(function (result) {
      return pResumen.then(function () { return result; });
    }).then(function (result) {
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
    var ref = cercaMioController_referenciaActual();
    if (!ref) {
      return;
    }
    // El conjunto COMPLETO del radio (sin el tope de 30): la lista visible se
    // arma desde aca (con o sin filtro de aptitud) sin volver a buscar.
    var resultados = cercaMioLogic_buscarCercanos(estado.datasetCache, ref.lat, ref.lon, estado.radioMetros, estado.datasetCache.length);
    estado.encontrados = resultados;

    if (resultados.length === 0) {
      // Sin pozos en el radio no hay nada que mostrar como vista previa.
      seleccionController_limpiarVistaPrevia();
      mostrarEstado('sinResultados');
      estadosEls.sinResultadosMensaje.textContent = 'No encontramos pozos a menos de ' + cercaMioLogic_formatearDistancia(estado.radioMetros) + '.';

      // "Ampliar a X" solo tiene sentido con un radio preset activo (con
      // Personalizado, indexOf da -1 y el boton queda oculto - el usuario
      // ya eligio su propio radio a mano).
      var indiceActual = CERCA_MIO_RADIOS_METROS.indexOf(estado.radioMetros);
      var siguienteRadio = !estado.radioPersonalizadoActivo && indiceActual >= 0 ? CERCA_MIO_RADIOS_METROS[indiceActual + 1] : null;
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
    cercaMioController_pintarResultados(contexto);
    // Si el usuario ya habia mirado esta busqueda en el mapa, cambiar el
    // radio/punto actualiza tambien lo que el mapa muestra (nunca queda
    // una vista previa vieja de un radio que ya no es el activo).
    if (seleccionController_hayVistaPrevia()) {
      cercaMioController_publicarVistaPrevia();
    }
  }

  // Pinta contador + filtro de aptitud + lista a partir de estado.encontrados
  // (el conjunto ya buscado por radio). Tocar un chip de aptitud solo vuelve
  // a pasar por aca: NO se recalcula GPS ni radio, y la vista previa/
  // "Usar estos pozos"/"Ver todos en el mapa" siguen siendo el RADIO completo.
  function cercaMioController_pintarResultados(contexto) {
    var resumen = reemplazoEstadosController_resumen();
    if (!resumen) {
      // sin reemplazo=SI (o sin resumen): Cerca Mio funciona exactamente como siempre
      estado.reemplazoActivos = {};
      grupoReemplazoEl.hidden = true;
    } else {
      grupoReemplazoEl.hidden = false;
      reemplazoEstadosUI_pintarFiltro(reemplazoChipsEl, estado.reemplazoActivos, reemplazoResumenLogic_contar(estado.encontrados, resumen), function (nuevos) {
        estado.reemplazoActivos = nuevos;
        cercaMioController_pintarResultados(contexto);
      });
    }

    var total = estado.encontrados.length;
    var filtrados = reemplazoResumenLogic_filtrar(estado.encontrados, resumen, estado.reemplazoActivos);
    var hayFiltro = reemplazoResumenLogic_hayActivos(estado.reemplazoActivos);
    var excede = filtrados.length > CERCA_MIO_MAX_RESULTADOS;

    if (!hayFiltro) {
      estadosEls.contador.textContent = excede
        ? 'Se muestran los ' + CERCA_MIO_MAX_RESULTADOS + ' pozos más cercanos dentro de ' + cercaMioLogic_formatearDistancia(estado.radioMetros) + '.'
        : total + ' pozo' + (total === 1 ? '' : 's') + ' encontrado' + (total === 1 ? '' : 's');
    } else if (filtrados.length === 0) {
      estadosEls.contador.textContent = 'Ningún pozo del radio coincide con el filtro de aptitud (' + total + ' encontrado' + (total === 1 ? '' : 's') + ').';
    } else {
      estadosEls.contador.textContent = filtrados.length + ' de ' + total + ' pozo' + (total === 1 ? '' : 's') + ' del radio' +
        (excede ? ' (se muestran los ' + CERCA_MIO_MAX_RESULTADOS + ' más cercanos)' : '');
    }
    cercaMioController_pintarLista(filtrados.slice(0, CERCA_MIO_MAX_RESULTADOS), contexto);
    cercaMioController_actualizarAcciones();
  }

  // Busqueda radial ACTUAL completa (sin el tope de 30 de la lista
  // visible) como contexto geografico: todos los wellId dentro del
  // radio + la geometria (punto de referencia, radio y de donde salio -
  // GPS o punto elegido en el mapa, para dibujar el icono correcto).
  // Las acciones ("Ver todos en el mapa", "Usar estos pozos", vista previa)
  // operan sobre LO QUE EL USUARIO VE: sin filtros de aptitud son todos los
  // pozos del radio; con filtros, solo el subconjunto filtrado (ver
  // reemplazoResumenLogic_pozosParaAcciones). La GEOMETRIA es siempre la del
  // radio original: el circulo sigue siendo el contexto.
  function cercaMioController_contextoRadial() {
    var ref = cercaMioController_referenciaActual();
    if (!ref || !estado.datasetCache) {
      return null;
    }
    var encontrados = estado.encontrados.length > 0
      ? estado.encontrados
      : cercaMioLogic_buscarCercanos(estado.datasetCache, ref.lat, ref.lon, estado.radioMetros, estado.datasetCache.length);
    var acciones = reemplazoResumenLogic_pozosParaAcciones(encontrados, reemplazoEstadosController_resumen(), estado.reemplazoActivos);
    return {
      wellIds: acciones.wellIds,
      filtrado: acciones.filtrado,
      total: acciones.total,
      geometria: { lat: ref.lat, lon: ref.lon, radioMetros: estado.radioMetros, tipoReferencia: estado.referencia }
    };
  }

  // Estado de los 2 botones de accion segun el subconjunto vigente: con
  // filtro activo muestran cuantos pozos usan; sin pozos (filtro que deja 0)
  // quedan deshabilitados. Si ya habia una vista previa en el mapa, se
  // actualiza (o se retira si ya no hay pozos) para no dejar una vista vieja.
  function cercaMioController_actualizarAcciones() {
    var c = cercaMioController_contextoRadial();
    var n = c ? c.wellIds.length : 0;
    btnVerTodosMapa.textContent = c && c.filtrado ? 'Ver ' + n + ' en el mapa' : 'Ver todos en el mapa';
    btnUsarSeleccionEl.textContent = c && c.filtrado ? 'Usar estos ' + n + ' pozos' : 'Usar estos pozos';
    btnVerTodosMapa.disabled = n === 0;
    btnUsarSeleccionEl.disabled = n === 0;
    if (seleccionController_hayVistaPrevia()) {
      if (n > 0) {
        cercaMioController_publicarVistaPrevia();
      } else {
        seleccionController_limpiarVistaPrevia();
      }
    }
  }

  function cercaMioController_publicarVistaPrevia() {
    var c = cercaMioController_contextoRadial();
    if (c && c.wellIds.length > 0) {
      seleccionController_establecerVistaPrevia(c.wellIds, 'radio', c.geometria);
    }
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
    // Aptitud para reemplazo (solo reemplazo=SI)
    var estadoReemplazo = reemplazoEstadosController_estadoDe(resultado.wellId);
    if (estadoReemplazo) {
      var badgeEl = document.createElement('span');
      badgeEl.className = 'reemplazo-badge cercamio-item-reemplazo reemplazo-badge-' + reemplazoLogic_claseEstado(estadoReemplazo);
      badgeEl.textContent = reemplazoResumenLogic_etiqueta(estadoReemplazo);
      main.appendChild(badgeEl);
    }
    // Contador de fotos (FotosPozos): solo con fotos=SI y si el pozo tiene fotos
    var chipFotos = typeof contexto.onVerFotos === 'function' ? fotosPozosController_crearChip(resultado.wellId, contexto.onVerFotos) : null;
    if (chipFotos) {
      main.appendChild(chipFotos);
    }
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
      // El pozo se muestra enfocado PERO conservando el contexto de esta
      // busqueda (punto + radio + pozos del radio) - ver
      // cercaMioController_publicarVistaPrevia.
      cercaMioController_publicarVistaPrevia();
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

    if (estado.puedeVerMapa) {
      actions.appendChild(btnMapa);
    }
    actions.appendChild(btnAbrir);
    // "Evaluar" (solo reemplazo=SI): abre el modulo sobre este pozo.
    if (estadoReemplazo && typeof contexto.onEvaluarReemplazo === 'function') {
      var btnEvaluar = document.createElement('button');
      btnEvaluar.type = 'button';
      btnEvaluar.className = 'button-secondary';
      btnEvaluar.textContent = 'Evaluar';
      btnEvaluar.addEventListener('click', function (ev) {
        ev.stopPropagation();
        contexto.onEvaluarReemplazo(resultado.wellId);
      });
      actions.appendChild(btnEvaluar);
    }
    detalle.appendChild(actions);
    item.appendChild(detalle);

    var yaConsultado = false;
    main.addEventListener('click', function () {
      var abriendo = detalle.hidden;
      detalle.hidden = !abriendo;
      item.classList.toggle('cercamio-item-expandido', abriendo);

      if (abriendo && !yaConsultado && mapaLogic_debeConsultarSummary(contexto.permisos)) {
        yaConsultado = true;
        summaryEl.innerHTML = cargando_html('Cargando datos…', { tam: 'sm', fila: true });

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

  // Salir de Cerca Mio por su propio "Volver" termina esa busqueda: la
  // vista previa (que solo existe mientras dura este flujo) se va con
  // ella. Una SELECCION ya confirmada ("Usar estos pozos") no se toca.
  function cercaMioController_cerrar() {
    estado.aperturaId += 1;
    seleccionController_limpiarVistaPrevia();
  }

  // Volver a esta pantalla desde el mapa (btn-mapa-volver en js/app.js):
  // el estado de la busqueda sigue intacto en memoria (referencia, radio,
  // lista) - solo hay que re-medir el mini-mapa si es lo que estaba a la
  // vista (Leaflet mide mal un contenedor que estuvo oculto).
  function cercaMioController_reanudar() {
    if (estado.pickerMapa && !estadosEls.eligiendoPunto.hidden) {
      mapaShared_alMostrarMapa(estado.pickerMapa, function () {});
    }
    // Volver de evaluar un pozo (o del mapa): los badges y los conteos de
    // aptitud se repintan YA con el estado local actualizado (sin refetch
    // masivo), sobre la misma busqueda - sin tocar GPS ni radio.
    if (estado.contextoActual && !estadosEls.resultados.hidden) {
      cercaMioController_pintarResultados(estado.contextoActual);
      var aperturaId = estado.aperturaId;
      Promise.all([reemplazoEstadosController_cargar(), fotosPozosResumenController_cargar()]).then(function () {
        if (aperturaId === estado.aperturaId && !estadosEls.resultados.hidden) {
          cercaMioController_pintarResultados(estado.contextoActual);
        }
      });
    }
  }

  // Recalcula y vuelve a renderizar sobre lo que ya esta en memoria (sin
  // pedir geolocation ni refetchear el dataset) - reusado por el cambio de
  // radio (presets y Personalizado) y por "Buscar desde este punto".
  function cercaMioController_recalcularSiHayDatos() {
    if (estado.contextoActual && cercaMioController_referenciaActual() && estado.datasetCache) {
      cercaMioController_renderizarResultados(estado.contextoActual);
    }
  }

  chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var valor = chip.getAttribute('data-radio');
      if (valor === 'personalizado') {
        estado.radioPersonalizadoActivo = true;
        actualizarChips();
        radioPersonalizadoWrapEl.hidden = false;
        inputRadioKmEl.focus();
        return;
      }
      estado.radioPersonalizadoActivo = false;
      radioPersonalizadoWrapEl.hidden = true;
      radioPersonalizadoErrorEl.hidden = true;
      estado.radioMetros = parseInt(valor, 10);
      actualizarChips();
      // El circulo del mini-mapa (si estamos en "Elegir en mapa" con un
      // punto ya elegido) se redimensiona en vivo, sin mover el centro -
      // independiente de si ya hay resultados en pantalla.
      cercaMioController_actualizarCirculoPicker();
      // Cambiar de radio NUNCA vuelve a pedir geolocation ni a refetchear
      // el dataset - es un recalculo puramente local sobre lo que ya
      // esta en memoria.
      cercaMioController_recalcularSiHayDatos();
    });
  });

  // Radio "Personalizado" (item C): valida con la misma funcion pura que
  // los tests de js/cercaMioLogic.test.js - mismas reglas, un solo lugar
  // que las define. Mientras el valor es invalido no se recalcula nada
  // (el usuario sigue viendo el ultimo resultado valido, con el error
  // visible debajo del campo).
  inputRadioKmEl.addEventListener('input', function () {
    var resultado = cercaMioLogic_validarRadioPersonalizadoKm(inputRadioKmEl.value);
    if (!resultado.valido) {
      radioPersonalizadoErrorEl.textContent = resultado.error;
      radioPersonalizadoErrorEl.hidden = inputRadioKmEl.value.trim() === '';
      return;
    }
    radioPersonalizadoErrorEl.hidden = true;
    estado.radioMetros = resultado.metros;
    cercaMioController_actualizarCirculoPicker();
    cercaMioController_recalcularSiHayDatos();
  });

  btnVerTodosMapa.addEventListener('click', function () {
    if (!estado.contextoActual || btnVerTodosMapa.disabled) {
      return;
    }
    cercaMioController_publicarVistaPrevia();
    estado.contextoActual.onVerTodosEnMapa();
  });

  // Item D del cierre: radio desemboca en la MISMA seleccion que
  // poligono (ver seleccionController_proponerSeleccion en
  // js/seleccion.js) - se recalcula SIN el tope de 30 de la lista
  // visible (ese tope es solo para la UX de "pozos cerca mio" en vivo,
  // la seleccion por lote no tiene por que estar limitada a 30: la
  // pantalla de ITF ya sabe manejar selecciones grandes en lotes).
  btnUsarSeleccionEl.addEventListener('click', function () {
    var c = cercaMioController_contextoRadial();
    // nunca una seleccion vacia por accidente (filtro que no deja pozos)
    if (!c || c.wellIds.length === 0) {
      return;
    }
    seleccionController_proponerSeleccion(c.wellIds, 'radio', c.geometria);
  });

  // Referencia (item B): "Mi ubicacion" vuelve al flujo GPS de siempre -
  // si ya se obtuvo la posicion en esta apertura, solo recalcula local; si
  // todavia no (el usuario entro directo a "Elegir en mapa"), recien ahi
  // pide navigator.geolocation por primera vez.
  btnRefUbicacion.addEventListener('click', function () {
    if (estado.referencia === 'miUbicacion') {
      return;
    }
    estado.referencia = 'miUbicacion';
    actualizarChipsReferencia();
    actualizarHeaderLabel();
    if (estado.miUbicacion) {
      mostrarEstado('resultados');
      cercaMioController_recalcularSiHayDatos();
    } else if (estado.contextoActual) {
      cercaMioController_solicitarUbicacion(estado.contextoActual, estado.aperturaId);
    }
  });

  // "Elegir en mapa" (item B/G): nunca pide geolocation. Muestra el mini-
  // mapa (lazy: Leaflet se carga UNA sola vez para toda la pagina, ver
  // mapaShared_cargarLibrerias en js/mapaShared.js - reusa la promesa ya
  // resuelta si Pozos Provincia o Niveles Estaticos la cargaron antes).
  btnRefMapa.addEventListener('click', function () {
    // A diferencia de btnRefUbicacion, SIEMPRE vuelve a mostrar el mini-
    // mapa aunque ya estuviera en modo 'elegirMapa' - es la unica forma de
    // volver a tocar/mover el punto despues de ver resultados (item B:
    // "moverlo tocando en otro lugar").
    estado.referencia = 'elegirMapa';
    actualizarChipsReferencia();
    actualizarHeaderLabel();
    cercaMioController_resetBotonBuscarDesdePunto();
    mostrarEstado('eligiendoPunto');
    cercaMioController_prepararPickerMapa();
  });

  // Mini-mapa de "Elegir en mapa": instancia L.Map independiente del mapa
  // de Pozos Provincia (js/mapa.js) y del mapa NE (js/mapaNE.js) - mismas
  // capas base/libreria compartidas via js/mapaShared.js, nunca una copia
  // propia. Se crea UNA sola vez (igual que mapaController_crearMapaSiHaceFalta);
  // reabrir "Elegir en mapa" despues solo vuelve a medir el contenedor
  // (mapaShared_alMostrarMapa, mismo fix de doble-rAF que el resto de los
  // mapas de la app para el bug de contenedor recien destapado).
  function cercaMioController_prepararPickerMapa() {
    mapaShared_cargarLibrerias().then(function () {
      if (estado.referencia !== 'elegirMapa') {
        return; // el usuario volvio a "Mi ubicacion" mientras cargaba
      }
      if (!estado.pickerMapa) {
        estado.pickerMapa = L.map('cercamio-picker-mapa', { zoomControl: true }).setView([-34.6, -68.6], 7);
        mapaShared_crearCapasBase(estado.pickerMapa);
        estado.pickerMapa.on('click', function (e) {
          cercaMioController_alTocarPickerMapa(e.latlng.lat, e.latlng.lng);
        });
      }
      mapaShared_alMostrarMapa(estado.pickerMapa, function () {});
    });
  }

  // Coloca o mueve el marcador "Punto de busqueda" (item B: "tocar el mapa
  // en cualquier lugar"/"moverlo tocando en otro lugar") - puramente local,
  // SOLO guarda lat/lon en estado.puntoElegido (ver nota de privacidad
  // arriba del archivo). No dispara la busqueda todavia: eso requiere el
  // tap explicito en "Buscar desde este punto" (item G).
  function cercaMioController_alTocarPickerMapa(lat, lon) {
    estado.puntoElegido = { lat: lat, lon: lon };
    if (!estado.pickerMarker) {
      estado.pickerMarker = L.marker([lat, lon], { icon: mapaShared_iconoPuntoBusqueda() }).addTo(estado.pickerMapa);
    } else {
      estado.pickerMarker.setLatLng([lat, lon]);
    }
    cercaMioController_actualizarCirculoPicker();
    btnBuscarDesdePuntoEl.disabled = false;
    actualizarHeaderLabel();
  }

  // Circulo de radio sobre el mini-mapa (item 3 del cierre): se crea o se
  // mueve/redimensiona junto con el marcador "Punto de busqueda" - mismo
  // helper (mapaShared_crearCirculoSeleccion: magenta + halo blanco) que
  // el circulo persistente del mapa Provincia, mismo lenguaje visual en
  // los 2 lugares. Se actualiza en vez de recrearlo: cambiar de radio
  // NUNCA mueve el centro elegido (requisito explicito del usuario).
  function cercaMioController_actualizarCirculoPicker() {
    if (!estado.puntoElegido || !estado.pickerMapa) {
      return;
    }
    if (!estado.pickerCirculo) {
      estado.pickerCirculo = mapaShared_crearCirculoSeleccion(estado.puntoElegido.lat, estado.puntoElegido.lon, estado.radioMetros)
        .addTo(estado.pickerMapa);
    } else {
      mapaShared_actualizarCirculoSeleccion(estado.pickerCirculo, estado.puntoElegido.lat, estado.puntoElegido.lon, estado.radioMetros);
    }
  }

  function cercaMioController_resetBotonBuscarDesdePunto() {
    btnBuscarDesdePuntoEl.disabled = !estado.puntoElegido;
    btnBuscarDesdePuntoEl.textContent = 'Buscar desde este punto';
  }

  btnBuscarDesdePuntoEl.addEventListener('click', function () {
    if (!estado.puntoElegido || !estado.contextoActual) {
      return;
    }
    if (estado.datasetCache) {
      cercaMioController_renderizarResultados(estado.contextoActual);
    } else {
      // Sin dataset en cache todavia (primera vez en la sesion que se pide
      // sin haber abierto antes el Mapa/Cerca Mio con GPS): unico tramo sin
      // un indicador de carga dedicado, asi que al menos el boton avisa que
      // esta trabajando - se restablece en cuanto se vuelve a mostrar este
      // mini-mapa (cercaMioController_resetBotonBuscarDesdePunto).
      btnBuscarDesdePuntoEl.disabled = true;
      btnBuscarDesdePuntoEl.textContent = 'Buscando...';
      cercaMioController_cargarDatasetYRenderizar(estado.contextoActual, estado.aperturaId);
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
  window.cercaMioController_reanudar = cercaMioController_reanudar;
})();
