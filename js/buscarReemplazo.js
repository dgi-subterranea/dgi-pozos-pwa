// Buscar reemplazo (v1): controlador DOM de la pantalla que lista pozos de
// Provincia cercanos a un punto de la red NE. Igual que cercaMio.js/mapa.js no
// se testea con Jest (toca DOM): toda la logica (radio, filtros, orden,
// explicacion de cada candidato) vive en js/buscarReemplazoLogic.js, con tests.
//
// Referencia = la coordenada PROPIA del punto NE (getMapaNE). Todo se calcula
// en el navegador sobre getMapaPozos + getMapaNE ya cargados (misma cache que
// los mapas) y, con reemplazo=SI, el resumen de aptitud (reemplazoEstados).
// No hay endpoint nuevo ni se manda ninguna coordenada a ningun backend.
//
// API publica: buscarReemplazoController_abrir(contexto, monitoringId),
// _cerrar() y _reanudar() (volver del mapa o de Evaluar sin reiniciar).
// contexto = {sessionToken, permisos, onAbrirPozo(wellId), onVerEnMapa(wellId),
// onVerTodosEnMapa(), onEvaluarReemplazo(wellId, monitoringId)} - app.js es el
// unico dueño de sessionToken/permisos y los pasa frescos en cada apertura.
//
// Todo texto que viene de datos se pinta con textContent, nunca como HTML.
(function () {
  var estado = {
    aperturaId: 0,
    contexto: null,
    monitoringId: null,
    ref: null,
    pozos: null,
    redNE: {},
    radioMetros: BUSCAR_REEMPLAZO_RADIO_DEFAULT_METROS,
    radioPersonalizadoActivo: false,
    incluirRedNE: false,
    filtros: null,
    orden: 'distancia',
    candidatos: [],        // TODO el radio (sin filtros), por distancia
    visibles: BUSCAR_REEMPLAZO_PAGINA,
    puedeVerMapa: false
  };

  function el(id) { return document.getElementById(id); }
  var cargandoEl = el('bre-cargando');
  var errorEl = el('bre-error');
  var errorMensajeEl = el('bre-error-mensaje');
  var btnReintentarEl = el('btn-bre-reintentar');
  var contenidoEl = el('bre-contenido');
  var refIdEl = el('bre-ref-id');
  var refNombreEl = el('bre-ref-nombre');
  var refDatosEl = el('bre-ref-datos');
  var refAvisoEl = el('bre-ref-aviso');
  var radioChips = Array.prototype.slice.call(document.querySelectorAll('.bre-radio-chip'));
  var radioPersonalizadoEl = el('bre-radio-personalizado');
  var inputRadioKmEl = el('input-bre-radio-km');
  var radioErrorEl = el('bre-radio-error');
  var chkRedNEEl = el('chk-bre-red-ne');
  var interruptorNoAptosEl = el('bre-interruptor-no-aptos');
  var chkNoAptosEl = el('chk-bre-no-aptos');
  var noAptosOcultosEl = el('bre-no-aptos-ocultos');
  var filtrosEl = el('bre-filtros');
  var filtrosCantidadEl = el('bre-filtros-cantidad');
  var grupoAptitudEl = el('bre-grupo-aptitud');
  var aptitudChipsEl = el('bre-aptitud-chips');
  var surgenciaChipsEl = el('bre-surgencia-chips');
  var cuencaChipsEl = el('bre-cuenca-chips');
  var inputProfDesdeEl = el('input-bre-prof-desde');
  var inputProfHastaEl = el('input-bre-prof-hasta');
  var profErrorEl = el('bre-prof-error');
  var chkConProfEl = el('chk-bre-con-prof');
  var chkConTramosEl = el('chk-bre-con-tramos');
  var btnLimpiarEl = el('btn-bre-limpiar-filtros');
  var ordenChips = Array.prototype.slice.call(document.querySelectorAll('.bre-orden-chip'));
  var btnOrdenEstadoEl = el('btn-bre-orden-estado');
  var textoOrdenEl = el('bre-texto-orden');
  var contadorEl = el('bre-contador');
  var sinResultadosEl = el('bre-sin-resultados');
  var sinResultadosMensajeEl = el('bre-sin-resultados-mensaje');
  var btnAmpliarEl = el('btn-bre-ampliar');
  var listaEl = el('bre-lista');
  var btnMasEl = el('btn-bre-mas');
  var btnVerMapaEl = el('btn-bre-ver-todos-mapa');

  function crearEl(tag, clase, texto) {
    var nodo = document.createElement(tag);
    if (clase) { nodo.className = clase; }
    if (texto !== undefined && texto !== null) { nodo.textContent = texto; }
    return nodo;
  }

  function mostrarSolo(nombre) {
    cargandoEl.hidden = nombre !== 'cargando';
    errorEl.hidden = nombre !== 'error';
    contenidoEl.hidden = nombre !== 'contenido';
  }

  function mostrarError(texto, conReintento) {
    errorMensajeEl.textContent = texto;
    btnReintentarEl.hidden = !conReintento;
    mostrarSolo('error');
  }

  function resumenReemplazo() {
    return reemplazoEstadosController_resumen();
  }

  // --- Apertura ---

  function buscarReemplazoController_abrir(contexto, monitoringId) {
    estado.aperturaId += 1;
    var aperturaId = estado.aperturaId;
    estado.contexto = contexto;
    estado.monitoringId = monitoringId;
    estado.ref = null;
    estado.candidatos = [];
    estado.radioMetros = BUSCAR_REEMPLAZO_RADIO_DEFAULT_METROS;
    estado.radioPersonalizadoActivo = false;
    estado.incluirRedNE = false;
    estado.filtros = buscarReemplazoLogic_filtrosPorDefecto();
    estado.orden = 'distancia';
    estado.visibles = BUSCAR_REEMPLAZO_PAGINA;
    estado.puedeVerMapa = mapaLogic_puedeVerProvincia(contexto.permisos);
    // Una busqueda nueva arranca sin la vista previa de la anterior.
    seleccionController_limpiarVistaPrevia();
    reiniciarControles();
    if (!buscarReemplazoLogic_puedeBuscar(contexto.permisos)) {
      // Defensa en profundidad: app.js ya no ofrece la entrada sin reemplazo=SI.
      mostrarError('No tenés permiso para buscar reemplazos.', false);
      return;
    }
    mostrarSolo('cargando');

    // Los 3 datasets son cache de sesion compartida; el de aptitud no hace
    // ninguna llamada sin reemplazo=SI y nunca rechaza.
    var pResumen = reemplazoEstadosController_cargar();
    // Contador de fotos: una llamada batch con cache; sin fotos=SI no llama a nada
    // y nunca rechaza (si falla, simplemente no hay contadores).
    var pFotos = fotosPozosResumenController_cargar();
    Promise.all([
      mapaNEDataset_obtener(contexto.sessionToken),
      mapaDataset_obtener(contexto.sessionToken),
      pResumen,
      pFotos
    ]).then(function (resultados) {
      if (aperturaId !== estado.aperturaId) { return; }
      var rNE = resultados[0];
      var rPozos = resultados[1];
      if (rNE.status !== 'ok') {
        if (rNE.code === 'UNAUTHORIZED' || rNE.code === 'USER_DISABLED') {
          if (contexto.onSessionExpired) { contexto.onSessionExpired(); }
          return;
        }
        mostrarError('No se pudo cargar la red de puntos NE. Intentá de nuevo.', true);
        return;
      }
      if (rPozos.status !== 'ok') {
        mostrarError('No se pudo cargar el listado de pozos. Intentá de nuevo.', true);
        return;
      }
      var puntoNE = buscarReemplazoLogic_buscarPuntoNE(rNE.data.puntos, monitoringId);
      var ref = buscarReemplazoLogic_construirReferencia(puntoNE, rPozos.data.pozos);
      if (!ref) {
        mostrarError('Este punto NE no tiene coordenadas propias, así que no se puede buscar un reemplazo a su alrededor.', false);
        return;
      }
      estado.ref = ref;
      estado.pozos = rPozos.data.pozos;
      // Toda la red NE (tambien los miembros sin coordenada propia): la exclusion
      // de candidatos no depende de que el pozo se pueda dibujar.
      estado.redNE = buscarReemplazoLogic_wellIdsRedNE(rNE.data.puntos, rNE.data.wellIdsSinCoordenada);
      renderReferencia();
      mostrarSolo('contenido');
      recalcular();
    }).catch(function () {
      if (aperturaId !== estado.aperturaId) { return; }
      mostrarError('No se pudo cargar la búsqueda. Revisá tu conexión.', true);
    });
  }

  function reiniciarControles() {
    chkRedNEEl.checked = false;
    chkNoAptosEl.checked = false;
    chkConProfEl.checked = false;
    chkConTramosEl.checked = false;
    inputProfDesdeEl.value = '';
    inputProfHastaEl.value = '';
    inputRadioKmEl.value = '';
    radioPersonalizadoEl.hidden = true;
    radioErrorEl.hidden = true;
    profErrorEl.hidden = true;
    filtrosEl.open = false;
    actualizarRadioChips();
    actualizarOrdenChips();
  }

  function renderReferencia() {
    var ref = estado.ref;
    refIdEl.textContent = ref.monitoringId;
    refNombreEl.textContent = ref.nombre || '';
    refNombreEl.hidden = !ref.nombre;
    refDatosEl.innerHTML = '';
    function fila(etiqueta, valor, sinDato) {
      var wrap = crearEl('div', 'bre-ref-dato');
      wrap.appendChild(crearEl('dt', '', etiqueta));
      wrap.appendChild(crearEl('dd', sinDato ? 'bre-sin-dato' : '', valor));
      refDatosEl.appendChild(wrap);
    }
    fila('Pozo', ref.wellId || 'Punto especial (sin número de pozo)', false);
    fila('Monitoreo', mapaLogic_estadoMonitoreoLabel(ref.estadoMonitoreo) + ' · ' + (ref.tieneMedicion2026 ? 'con medición 2026' : 'sin medición 2026'), false);
    if (ref.profundidadAtipica) {
      fila('Profundidad total', 'Atípica (' + buscarReemplazoLogic_formatearMetros(ref.profundidad) + '), no se compara', false);
    } else if (ref.profundidadValida === null) {
      fila('Profundidad total', 'Sin dato', true);
    } else {
      fila('Profundidad total', buscarReemplazoLogic_formatearMetros(ref.profundidadValida), false);
    }
    fila('Cuenca (red NE)', ref.cuenca || 'Sin dato', !ref.cuenca);
    fila('Coordenada usada', 'Propia del punto NE', false);
    var aviso = buscarReemplazoLogic_textoAdvertenciaCoordenada(ref);
    refAvisoEl.textContent = aviso || '';
    refAvisoEl.hidden = !aviso;
  }

  // --- Calculo y pintado ---

  // Radio / red NE cambiaron: se vuelve a buscar sobre el dataset en memoria.
  function recalcular() {
    if (!estado.ref || !estado.pozos) { return; }
    estado.candidatos = buscarReemplazoLogic_buscarCandidatos(estado.pozos, estado.ref, estado.radioMetros, {
      incluirRedNE: estado.incluirRedNE,
      redNE: estado.redNE
    });
    estado.visibles = BUSCAR_REEMPLAZO_PAGINA;
    pintar();
  }

  // Filtro / orden / aptitud cambiaron: solo se repinta.
  function pintar(conservarVisibles) {
    if (!estado.ref) { return; }
    if (!conservarVisibles) { estado.visibles = BUSCAR_REEMPLAZO_PAGINA; }
    var resumen = resumenReemplazo();
    var hayResumen = !!resumen;

    // Sin reemplazo=SI nada de aptitud: ni chips, ni interruptor, ni orden.
    grupoAptitudEl.hidden = !hayResumen;
    interruptorNoAptosEl.hidden = !hayResumen;
    btnOrdenEstadoEl.hidden = !hayResumen;
    if (!hayResumen) {
      estado.filtros.estados = {};
      estado.filtros.mostrarNoAptos = false;
      if (estado.orden === 'estado') { estado.orden = 'distancia'; }
    }

    pintarFiltros(resumen);
    actualizarOrdenChips();
    textoOrdenEl.textContent = buscarReemplazoLogic_textoOrden(estado.orden, hayResumen, estado.ref.profundidadValida !== null);

    var filtrados = buscarReemplazoLogic_filtrar(estado.candidatos, resumen, estado.filtros);
    var ordenados = buscarReemplazoLogic_ordenar(filtrados, estado.orden, resumen);
    estado.visiblesLista = ordenados;
    pintarContador(filtrados.length, resumen);
    pintarLista(ordenados);
    actualizarAcciones(ordenados);
  }

  function pintarContador(nFiltrados, resumen) {
    var total = estado.candidatos.length;
    var radio = buscarReemplazoLogic_formatearDistancia(estado.radioMetros);
    sinResultadosEl.hidden = true;
    contadorEl.hidden = false;
    if (total === 0) {
      contadorEl.hidden = true;
      sinResultadosEl.hidden = false;
      sinResultadosMensajeEl.textContent = 'No hay pozos de Provincia a menos de ' + radio + ' del punto NE' +
        (estado.incluirRedNE ? '.' : ' (sin contar los de la red NE).');
      var siguiente = estado.radioPersonalizadoActivo ? null : buscarReemplazoLogic_siguienteRadio(estado.radioMetros);
      btnAmpliarEl.hidden = !siguiente;
      if (siguiente) {
        btnAmpliarEl.textContent = 'Ampliar a ' + buscarReemplazoLogic_formatearDistancia(siguiente);
        btnAmpliarEl.onclick = function () {
          estado.radioMetros = siguiente;
          actualizarRadioChips();
          recalcular();
        };
      }
      return;
    }
    var conteo = buscarReemplazoLogic_conteosAptitud(estado.candidatos, resumen, estado.filtros);
    var hayFiltros = buscarReemplazoLogic_cantidadFiltrosActivos(estado.filtros) > 0;
    contadorEl.textContent = buscarReemplazoLogic_textoContador(total, nFiltrados, conteo.noAptosOcultos, radio, hayFiltros);
  }

  function pintarLista(ordenados) {
    listaEl.innerHTML = '';
    ordenados.slice(0, estado.visibles).forEach(function (c) {
      listaEl.appendChild(construirItem(c));
    });
    btnMasEl.hidden = ordenados.length <= estado.visibles;
    if (!btnMasEl.hidden) {
      btnMasEl.textContent = 'Mostrar más (' + (ordenados.length - estado.visibles) + ' restantes)';
    }
  }

  function construirItem(c) {
    var ctx = estado.contexto;
    var item = crearEl('article', 'bre-item');

    var cabecera = crearEl('div', 'bre-item-cabecera');
    cabecera.appendChild(crearEl('span', 'bre-item-id mono', c.wellId));
    var estadoReemplazo = reemplazoEstadosController_estadoDe(c.wellId);
    if (estadoReemplazo) {
      cabecera.appendChild(crearEl('span', 'reemplazo-badge reemplazo-badge-' + reemplazoLogic_claseEstado(estadoReemplazo), reemplazoResumenLogic_etiqueta(estadoReemplazo)));
    }
    // Contador de fotos (FotosPozos): solo con fotos=SI y si el pozo tiene fotos
    var chipFotos = typeof ctx.onVerFotos === 'function' ? fotosPozosController_crearChip(c.wellId, ctx.onVerFotos) : null;
    if (chipFotos) {
      cabecera.appendChild(chipFotos);
    }
    cabecera.appendChild(crearEl('span', 'bre-item-dist', buscarReemplazoLogic_formatearDistancia(c.distanciaMetros)));
    item.appendChild(cabecera);

    // "Por que aparece": los datos crudos, nunca un puntaje.
    var porque = crearEl('ul', 'bre-chips');
    buscarReemplazoLogic_explicar(c, estado.ref).forEach(function (e) {
      // la distancia ya esta en la cabecera
      if (e.clave === 'distancia') { return; }
      var li = crearEl('li', 'bre-chip bre-chip-' + e.tipo, e.texto);
      porque.appendChild(li);
    });
    item.appendChild(porque);

    var acciones = crearEl('div', 'bre-item-acciones');
    if (estado.puedeVerMapa) {
      var btnMapa = crearEl('button', 'button-secondary', 'Ver en mapa');
      btnMapa.type = 'button';
      btnMapa.addEventListener('click', function () {
        publicarVistaPrevia();
        ctx.onVerEnMapa(c.wellId);
      });
      acciones.appendChild(btnMapa);
    }
    var btnAbrir = crearEl('button', 'button', 'Abrir pozo');
    btnAbrir.type = 'button';
    btnAbrir.addEventListener('click', function () { ctx.onAbrirPozo(c.wellId); });
    acciones.appendChild(btnAbrir);
    if (estadoReemplazo && typeof ctx.onEvaluarReemplazo === 'function') {
      var btnEvaluar = crearEl('button', 'button-secondary', 'Evaluar');
      btnEvaluar.type = 'button';
      btnEvaluar.addEventListener('click', function () {
        // El punto NE de referencia viaja a la evaluacion (campo
        // puntoNEReferencia ya existente); la distancia no se guarda: se
        // recalcula siempre desde las coordenadas.
        ctx.onEvaluarReemplazo(c.wellId, estado.ref.monitoringId);
      });
      acciones.appendChild(btnEvaluar);
    }
    item.appendChild(acciones);
    return item;
  }

  // --- Filtros (chips) ---

  function pintarChips(contenedor, opciones, activos, onCambio) {
    contenedor.innerHTML = '';
    var sinSeleccion = !reemplazoResumenLogic_hayActivos(activos);
    function chip(valor, etiqueta, activo) {
      var b = crearEl('button', 'reemplazo-filtro-chip' + (activo ? ' active' : ''), etiqueta);
      b.type = 'button';
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
      b.addEventListener('click', function () { onCambio(mapaLogic_toggleFiltroMultiple(activos, valor)); });
      contenedor.appendChild(b);
    }
    chip('todos', 'Todos', sinSeleccion);
    opciones.forEach(function (o) {
      chip(o.valor, o.etiqueta + ' (' + o.cantidad + ')', !!activos[o.valor]);
    });
  }

  function pintarFiltros(resumen) {
    var f = estado.filtros;
    if (resumen) {
      var c = buscarReemplazoLogic_conteosAptitud(estado.candidatos, resumen, f);
      reemplazoEstadosUI_pintarFiltro(aptitudChipsEl, f.estados, c.conteos, function (nuevos) {
        f.estados = nuevos;
        // elegir "No apto" implica mostrarlos; quitar el interruptor lo desmarca
        if (nuevos.NO_APTO) {
          f.mostrarNoAptos = true;
          chkNoAptosEl.checked = true;
        }
        pintar();
      });
      noAptosOcultosEl.textContent = c.noAptosOcultos > 0 ? '(' + c.noAptosOcultos + ' oculto' + (c.noAptosOcultos === 1 ? '' : 's') + ')' : '';
    }

    var cuentaSurg = { Natural: 0, SemiSurgente: 0, Profundo: 0, SIN_DATO: 0 };
    estado.candidatos.forEach(function (cand) { cuentaSurg[cand.surgencia || 'SIN_DATO'] += 1; });
    var opcionesSurg = BUSCAR_REEMPLAZO_SURGENCIAS.map(function (s) {
      return { valor: s, etiqueta: BUSCAR_REEMPLAZO_SURGENCIA_ETIQUETAS[s], cantidad: cuentaSurg[s] };
    });
    opcionesSurg.push({ valor: 'SIN_DATO', etiqueta: 'Sin dato', cantidad: cuentaSurg.SIN_DATO });
    pintarChips(surgenciaChipsEl, opcionesSurg, f.surgencias, function (nuevos) {
      f.surgencias = nuevos;
      pintar();
    });

    var opcionesCuenca = buscarReemplazoLogic_opcionesCuenca(estado.candidatos).map(function (o) {
      return { valor: o.valor, etiqueta: o.valor === 'SIN_DATO' ? 'Sin dato' : o.valor, cantidad: o.cantidad };
    });
    pintarChips(cuencaChipsEl, opcionesCuenca, f.cuencas, function (nuevos) {
      f.cuencas = nuevos;
      pintar();
    });

    var n = buscarReemplazoLogic_cantidadFiltrosActivos(f);
    filtrosCantidadEl.textContent = String(n);
    filtrosCantidadEl.hidden = n === 0;
    btnLimpiarEl.disabled = n === 0;
  }

  function actualizarRadioChips() {
    radioChips.forEach(function (chip) {
      var valor = chip.getAttribute('data-radio');
      var activo = valor === 'personalizado'
        ? estado.radioPersonalizadoActivo
        : (!estado.radioPersonalizadoActivo && parseInt(valor, 10) === estado.radioMetros);
      chip.classList.toggle('active', activo);
      chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
  }

  function actualizarOrdenChips() {
    ordenChips.forEach(function (chip) {
      var activo = chip.getAttribute('data-orden') === estado.orden;
      chip.classList.toggle('active', activo);
      chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
  }

  // --- Mapa ---

  // Todos los candidatos que el usuario ve (filtrados, no solo la pagina),
  // con la geometria del radio: punto NE + circulo.
  function publicarVistaPrevia() {
    var ids = (estado.visiblesLista || []).map(function (c) { return c.wellId; });
    if (ids.length > 0 && estado.ref) {
      seleccionController_establecerVistaPrevia(ids, 'radio', buscarReemplazoLogic_geometria(estado.ref, estado.radioMetros));
    }
  }

  function actualizarAcciones(ordenados) {
    var n = ordenados.length;
    var filtrado = n !== estado.candidatos.length;
    btnVerMapaEl.hidden = !estado.puedeVerMapa;
    btnVerMapaEl.textContent = filtrado ? 'Ver ' + n + ' en el mapa' : 'Ver todos en el mapa';
    btnVerMapaEl.disabled = n === 0;
    // Si ya se habia mirado en el mapa, la vista previa sigue lo que se ve.
    if (seleccionController_hayVistaPrevia()) {
      if (n > 0) { publicarVistaPrevia(); } else { seleccionController_limpiarVistaPrevia(); }
    }
  }

  // --- Salir / volver ---

  function buscarReemplazoController_cerrar() {
    estado.aperturaId += 1;
    seleccionController_limpiarVistaPrevia();
  }

  // Volver del mapa o de Evaluar: misma busqueda, con los estados ya
  // actualizados localmente (sin refetch masivo).
  function buscarReemplazoController_reanudar() {
    if (!estado.ref || contenidoEl.hidden) { return; }
    pintar(true);
    var aperturaId = estado.aperturaId;
    Promise.all([reemplazoEstadosController_cargar(), fotosPozosResumenController_cargar()]).then(function () {
      if (aperturaId === estado.aperturaId && !contenidoEl.hidden) { pintar(true); }
    });
  }

  // --- Eventos ---

  radioChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      var valor = chip.getAttribute('data-radio');
      if (valor === 'personalizado') {
        estado.radioPersonalizadoActivo = true;
        actualizarRadioChips();
        radioPersonalizadoEl.hidden = false;
        inputRadioKmEl.focus();
        return;
      }
      estado.radioPersonalizadoActivo = false;
      radioPersonalizadoEl.hidden = true;
      radioErrorEl.hidden = true;
      estado.radioMetros = parseInt(valor, 10);
      actualizarRadioChips();
      recalcular();
    });
  });

  inputRadioKmEl.addEventListener('input', function () {
    var r = cercaMioLogic_validarRadioPersonalizadoKm(inputRadioKmEl.value);
    if (!r.valido) {
      radioErrorEl.textContent = r.error;
      radioErrorEl.hidden = inputRadioKmEl.value.trim() === '';
      return;
    }
    radioErrorEl.hidden = true;
    estado.radioMetros = r.metros;
    recalcular();
  });

  chkRedNEEl.addEventListener('change', function () {
    estado.incluirRedNE = chkRedNEEl.checked;
    recalcular();
  });

  chkNoAptosEl.addEventListener('change', function () {
    estado.filtros.mostrarNoAptos = chkNoAptosEl.checked;
    if (!chkNoAptosEl.checked && estado.filtros.estados.NO_APTO) {
      var nuevos = Object.assign({}, estado.filtros.estados);
      delete nuevos.NO_APTO;
      estado.filtros.estados = nuevos;
    }
    pintar();
  });

  function aplicarRangoProfundidad() {
    var r = mapaLogic_validarRangoProfundidad(inputProfDesdeEl.value, inputProfHastaEl.value);
    if (!r.valido) {
      profErrorEl.textContent = r.error;
      profErrorEl.hidden = false;
      return;
    }
    profErrorEl.hidden = true;
    estado.filtros.profDesde = r.desde;
    estado.filtros.profHasta = r.hasta;
    pintar();
  }
  inputProfDesdeEl.addEventListener('input', aplicarRangoProfundidad);
  inputProfHastaEl.addEventListener('input', aplicarRangoProfundidad);

  chkConProfEl.addEventListener('change', function () {
    estado.filtros.soloConProfundidad = chkConProfEl.checked;
    pintar();
  });
  chkConTramosEl.addEventListener('change', function () {
    estado.filtros.soloConTramos = chkConTramosEl.checked;
    pintar();
  });

  btnLimpiarEl.addEventListener('click', function () {
    estado.filtros = buscarReemplazoLogic_filtrosPorDefecto();
    chkNoAptosEl.checked = false;
    chkConProfEl.checked = false;
    chkConTramosEl.checked = false;
    inputProfDesdeEl.value = '';
    inputProfHastaEl.value = '';
    profErrorEl.hidden = true;
    pintar();
  });

  ordenChips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      estado.orden = chip.getAttribute('data-orden');
      pintar();
    });
  });

  btnMasEl.addEventListener('click', function () {
    estado.visibles += BUSCAR_REEMPLAZO_PAGINA;
    pintar(true);
  });

  btnVerMapaEl.addEventListener('click', function () {
    if (btnVerMapaEl.disabled || !estado.contexto) { return; }
    publicarVistaPrevia();
    estado.contexto.onVerTodosEnMapa();
  });

  btnReintentarEl.addEventListener('click', function () {
    if (estado.contexto && estado.monitoringId !== null) {
      buscarReemplazoController_abrir(estado.contexto, estado.monitoringId);
    }
  });

  window.buscarReemplazoController_abrir = buscarReemplazoController_abrir;
  window.buscarReemplazoController_cerrar = buscarReemplazoController_cerrar;
  window.buscarReemplazoController_reanudar = buscarReemplazoController_reanudar;
})();
