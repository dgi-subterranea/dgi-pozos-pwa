// Pozos seleccionados: controlador DOM (bandeja persistente, tabla/
// listado conjunto, ITF por lote). No se testea con Jest (toca DOM/
// fetch/JSZip en vivo, igual que js/mapa.js/js/cercaMio.js/js/app.js) -
// la logica pura (point-in-polygon, operaciones de set) vive en
// js/seleccionLogic.js, testeada sin navegador.
//
// PRIVACIDAD (Etapa "seleccion multiple + lote", item A/I/10): la
// seleccion (array de wellId) y la geometria que la genero (poligono o
// radio/centro) viven SOLO en memoria de este modulo. El poligono/centro/
// radio NUNCA viajan al backend - unicamente wellIds[], y solo en 2
// llamadas: apiGetItfAvailability (disponibilidad) y
// apiRegisterDescargaItf (auditoria de una descarga real). Seleccionar
// geograficamente (radio o poligono), abrir la tabla o abrir la pantalla
// ITF con un resultado ya cacheado NUNCA llaman a ninguna de las 2 (ver
// cierre revisado del item 1/K: no se audita abrir pantallas locales). No
// persiste entre recargas de pagina (memoria de sesion nada mas, mismo
// criterio que mapaDatasetEstado).
//
// API publica (ver window.seleccionController_* al final):
//   seleccionController_inicializar(obtenerContexto) - obtenerContexto()
//     devuelve SIEMPRE {sessionToken, permisos} frescos (app.js es el
//     unico dueño, igual que el resto de los controladores).
//   seleccionController_proponerSeleccion(wellIds, origen, geometria) -
//     unico punto de entrada para radio Y poligono (item D) - origen:
//     'radio'|'poligono'. Si ya hay seleccion activa, pregunta
//     Reemplazar/Agregar/Cancelar (item 6) antes de aplicar.
//   seleccionController_obtenerSeleccionSet() -> Set<wellId>, para que
//     mapa.js resalte los markers seleccionados.
//   seleccionController_obtenerGeometria() -> {origen, geometria}|null,
//     para que mapa.js conserve el poligono mas reciente (item 12).
//   seleccionController_registrarListener(fn) - mapa.js se suscribe para
//     re-renderizar highlighting cuando la seleccion cambia.
//   seleccionController_abrirTabla()/seleccionController_abrirItf() -
//     llamados por app.js DESPUES de showScreen (mismo criterio que
//     mapaController_abrir/cercaMioController_abrir).
(function () {
  var estado = {
    seleccion: [],                    // array de wellId - FUENTE DE VERDAD
    origenGeografico: null,           // 'radio' | 'poligono' | null
    geometria: null,                  // {lat,lon,radioMetros} o {vertices}
    disponibilidadItf: {},            // cache {wellId: boolean}
    disponibilidadItfListoPara: null, // snapshot (join de wellIds) de la seleccion para la que ya se pidio
    obtenerContexto: null,
    listeners: [],
    pendienteConfirmacion: null,      // {wellIds, origen, geometria} mientras se muestra el dialogo
    aperturaTablaId: 0,
    aperturaItfId: 0,
    descargaEnCurso: false,
    ultimosFallidos: []               // wellId que fallaron en la ultima descarga (para "Reintentar fallidos")
  };

  var bandejaEl = document.getElementById('seleccion-bandeja');
  var bandejaContadorEl = document.getElementById('seleccion-bandeja-contador');
  var btnInfoEl = document.getElementById('btn-seleccion-info');
  var btnItfEl = document.getElementById('btn-seleccion-itf');
  var btnVerMapaEl = document.getElementById('btn-seleccion-ver-mapa');
  var btnLimpiarEl = document.getElementById('btn-seleccion-limpiar');

  var confirmarOverlayEl = document.getElementById('seleccion-confirmar-overlay');
  var confirmarMensajeEl = document.getElementById('seleccion-confirmar-mensaje');
  var btnConfirmarReemplazarEl = document.getElementById('btn-seleccion-confirmar-reemplazar');
  var btnConfirmarAgregarEl = document.getElementById('btn-seleccion-confirmar-agregar');
  var btnConfirmarCancelarEl = document.getElementById('btn-seleccion-confirmar-cancelar');

  var tablaSubtituloEl = document.getElementById('seleccion-tabla-subtitulo');
  var tablaBuscarEl = document.getElementById('seleccion-tabla-buscar');
  var tablaOrdenEl = document.getElementById('seleccion-tabla-orden');
  var tablaVacioEl = document.getElementById('seleccion-tabla-vacio');
  var tablaContenidoEl = document.getElementById('seleccion-tabla-contenido');

  var itfSubtituloEl = document.getElementById('seleccion-itf-subtitulo');
  var itfLoadingEl = document.getElementById('seleccion-itf-loading');
  var itfContenidoEl = document.getElementById('seleccion-itf-contenido');
  var itfLotesEl = document.getElementById('seleccion-itf-lotes');
  var itfListaEl = document.getElementById('seleccion-itf-lista');
  var itfProgresoEl = document.getElementById('seleccion-itf-progreso');
  var itfProgresoTextoEl = document.getElementById('seleccion-itf-progreso-texto');
  var itfProgresoBarraEl = document.getElementById('seleccion-itf-progreso-barra');
  var itfResultadoEl = document.getElementById('seleccion-itf-resultado');
  var itfResultadoTextoEl = document.getElementById('seleccion-itf-resultado-texto');
  var btnItfReintentarEl = document.getElementById('btn-seleccion-itf-reintentar');

  // Tope de lote para "Descargar todos los disponibles" (item 3 del
  // cierre - CONFIRMADO: 50). Distinto del limite de seguridad del lado
  // del backend (SELECCION_LOTE_MAX_WELLIDS=500 en Api.js, que solo evita
  // abuso de la validacion, no tiene relacion con esto).
  var ITF_LOTE_MAX = 50;
  var ITF_CONCURRENCIA_MAX = 3;

  // ---- Utilidades internas ----

  function obtenerContextoSeguro() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  // Item 8 del cierre: un sessionToken vencido se maneja IGUAL que en el
  // resto de la app (ver chequeo de UNAUTHORIZED en buscarPozo,
  // js/app.js) - nunca como un fallo silencioso mas por pozo. Guardado
  // contra llamar onSessionExpired() varias veces si varios requests en
  // vuelo devuelven UNAUTHORIZED casi juntos (ej. una descarga en lote).
  var sesionExpiradaYaManejada = false;
  function manejarSiSesionExpiro(result, contexto) {
    if (result && result.code === 'UNAUTHORIZED' && !sesionExpiradaYaManejada) {
      sesionExpiradaYaManejada = true;
      if (contexto && contexto.onSessionExpired) {
        contexto.onSessionExpired();
      }
      return true;
    }
    return false;
  }

  function notificarCambio() {
    estado.listeners.forEach(function (fn) { fn(); });
  }

  function invalidarCachesDependientes() {
    estado.disponibilidadItfListoPara = null;
    estado.resumenAuditado = false;
    estado.itfAuditado = false;
    estado.ultimosFallidos = [];
  }

  function actualizarBandeja() {
    var n = estado.seleccion.length;
    bandejaEl.hidden = n === 0;
    bandejaContadorEl.textContent = n + ' pozo' + (n === 1 ? '' : 's') + ' seleccionado' + (n === 1 ? '' : 's');
  }

  function aplicarSeleccion(wellIds, origen, geometria) {
    estado.seleccion = seleccionLogic_reemplazar(wellIds);
    estado.origenGeografico = estado.seleccion.length > 0 ? (origen || null) : null;
    estado.geometria = estado.seleccion.length > 0 ? (geometria || null) : null;
    invalidarCachesDependientes();
    actualizarBandeja();
    notificarCambio();
  }

  function agregarASeleccionInterno(wellIds, origen, geometria) {
    estado.seleccion = seleccionLogic_agregar(estado.seleccion, wellIds);
    // Item 12 del cierre: no hace falta conservar todas las geometrias
    // historicas - solo la mas reciente, para que el mapa pueda
    // mostrarla si corresponde.
    estado.origenGeografico = origen || null;
    estado.geometria = geometria || null;
    invalidarCachesDependientes();
    actualizarBandeja();
    notificarCambio();
  }

  // ---- API publica ----

  function seleccionController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
  }

  function seleccionController_registrarListener(fn) {
    estado.listeners.push(fn);
  }

  function seleccionController_obtenerSeleccionSet() {
    return new Set(estado.seleccion);
  }

  function seleccionController_tieneSeleccion() {
    return estado.seleccion.length > 0;
  }

  function seleccionController_obtenerGeometria() {
    if (!estado.origenGeografico || !estado.geometria) {
      return null;
    }
    return { origen: estado.origenGeografico, geometria: estado.geometria };
  }

  // Punto de entrada unico para radio Y poligono (item D/6): si ya habia
  // seleccion, pregunta antes de pisarla.
  function seleccionController_proponerSeleccion(wellIds, origen, geometria) {
    var normalizados = seleccionLogic_normalizar(wellIds);
    if (estado.seleccion.length === 0) {
      aplicarSeleccion(normalizados, origen, geometria);
      return;
    }
    estado.pendienteConfirmacion = { wellIds: normalizados, origen: origen, geometria: geometria };
    confirmarMensajeEl.textContent = 'Ya tenés ' + estado.seleccion.length + ' pozo' + (estado.seleccion.length === 1 ? '' : 's') +
      ' seleccionado' + (estado.seleccion.length === 1 ? '' : 's') + '. La nueva selección tiene ' +
      normalizados.length + ' pozo' + (normalizados.length === 1 ? '' : 's') + '.';
    confirmarOverlayEl.hidden = false;
  }

  function seleccionController_quitarPozo(wellId) {
    estado.seleccion = seleccionLogic_quitar(estado.seleccion, wellId);
    if (estado.seleccion.length === 0) {
      estado.origenGeografico = null;
      estado.geometria = null;
    }
    invalidarCachesDependientes();
    actualizarBandeja();
    notificarCambio();
  }

  btnConfirmarReemplazarEl.addEventListener('click', function () {
    var p = estado.pendienteConfirmacion;
    confirmarOverlayEl.hidden = true;
    estado.pendienteConfirmacion = null;
    if (p) { aplicarSeleccion(p.wellIds, p.origen, p.geometria); }
  });
  btnConfirmarAgregarEl.addEventListener('click', function () {
    var p = estado.pendienteConfirmacion;
    confirmarOverlayEl.hidden = true;
    estado.pendienteConfirmacion = null;
    if (p) { agregarASeleccionInterno(p.wellIds, p.origen, p.geometria); }
  });
  btnConfirmarCancelarEl.addEventListener('click', function () {
    confirmarOverlayEl.hidden = true;
    estado.pendienteConfirmacion = null;
  });

  btnLimpiarEl.addEventListener('click', function () {
    aplicarSeleccion([], null, null);
  });

  // ---- Tabla "Pozos seleccionados" (item E/F/7) ----
  // Arma cada fila SOLO con datasets ya cacheados (pozos.json,
  // pozos_busqueda.json, nivelesEstaticos.json) - sin getWellSummaries
  // nuevo (decision aprobada). "Tiene ITF" es la unica llamada de red
  // real (getItfAvailability, UNA vez por seleccion) - gateada por
  // "perfil"; sin ese permiso se muestra "—", nunca se intenta.

  function construirIndicePorWellId(lista, campoId) {
    var indice = {};
    (lista || []).forEach(function (item) {
      indice[item[campoId || 'wellId']] = item;
    });
    return indice;
  }

  // Cierre revisado del item 1/K: abrir la tabla o la pantalla ITF NUNCA
  // audita nada por si solo - son pantallas que se arman 100% con
  // datasets ya cacheados en el navegador (pozos.json/pozos_busqueda.json/
  // nivelesEstaticos.json). La UNICA llamada "material" al backend que
  // puede disparar esto es getItfAvailability (ver asegurarDisponibilidadItf
  // abajo) - y ESA se audita del lado del backend mismo (Historial, sin
  // Telegram), no desde aca. La descarga real audita aparte, al terminar
  // (ver descargarLoteItf).

  function seleccionController_abrirTabla() {
    sesionExpiradaYaManejada = false;
    var contexto = obtenerContextoSeguro();
    estado.aperturaTablaId += 1;
    var aperturaId = estado.aperturaTablaId;

    tablaSubtituloEl.textContent = estado.seleccion.length + ' pozo' + (estado.seleccion.length === 1 ? '' : 's');
    tablaBuscarEl.value = '';

    if (estado.seleccion.length === 0) {
      tablaVacioEl.hidden = false;
      tablaContenidoEl.hidden = true;
      return;
    }
    tablaVacioEl.hidden = true;

    if (!contexto) {
      return;
    }

    var permisos = contexto.permisos || {};
    var promesas = [mapaDataset_obtener(contexto.sessionToken)];
    promesas.push(permisos.datos ? busquedaProvinciaDataset_obtener(contexto.sessionToken) : Promise.resolve({ status: 'ok', data: { pozos: [] } }));
    promesas.push(permisos.ne ? mapaNEDataset_obtener(contexto.sessionToken) : Promise.resolve({ status: 'ok', data: { puntos: [] } }));

    Promise.all(promesas).then(function (resultados) {
      if (aperturaId !== estado.aperturaTablaId) {
        return;
      }
      var pozosResult = resultados[0];
      var busquedaResult = resultados[1];
      var neResult = resultados[2];

      var indicePozos = pozosResult.status === 'ok' ? construirIndicePorWellId(pozosResult.data.pozos) : {};
      var indiceBusqueda = busquedaResult.status === 'ok' ? construirIndicePorWellId(busquedaResult.data.pozos) : {};
      var neSet = new Set();
      if (neResult.status === 'ok') {
        neResult.data.puntos.forEach(function (p) { if (p.wellId) { neSet.add(p.wellId); } });
      }

      function continuarConDisponibilidad() {
        if (aperturaId !== estado.aperturaTablaId) {
          return;
        }
        renderizarTabla(indicePozos, indiceBusqueda, neSet, permisos);
      }

      if (permisos.perfil) {
        asegurarDisponibilidadItf(contexto).then(continuarConDisponibilidad);
      } else {
        continuarConDisponibilidad();
      }
    }).catch(function () {
      if (aperturaId !== estado.aperturaTablaId) {
        return;
      }
      tablaContenidoEl.hidden = false;
      tablaContenidoEl.innerHTML = '<p class="cercamio-estado">No se pudo cargar la información. Intentá de nuevo.</p>';
    });
  }

  // Snapshot de la seleccion actual - si cambia, la disponibilidad
  // cacheada queda invalida (ver invalidarCachesDependientes).
  function snapshotSeleccion() {
    return estado.seleccion.slice().sort().join(',');
  }

  function asegurarDisponibilidadItf(contexto) {
    var snapshot = snapshotSeleccion();
    if (estado.disponibilidadItfListoPara === snapshot) {
      return Promise.resolve(estado.disponibilidadItf);
    }
    return apiGetItfAvailability(contexto.sessionToken, estado.seleccion).then(function (result) {
      if (result.status === 'ok') {
        estado.disponibilidadItf = result.data;
        estado.disponibilidadItfListoPara = snapshot;
      } else {
        manejarSiSesionExpiro(result, contexto);
      }
      // Si getItfAvailability falla (sesion vencida u otro error), la
      // seleccion en si NUNCA se toca - el usuario sigue viendo los
      // mismos wellId, solo sin saber (todavia) cuales tienen ITF.
      return estado.disponibilidadItf;
    }).catch(function () {
      return estado.disponibilidadItf;
    });
  }

  function campoTexto(valor) {
    return valor === null || valor === undefined || valor === '' ? '—' : String(valor);
  }

  var SELECCION_ETIQUETAS_TIPO_POZO = { Profundo: 'Profundo', SemiSurgente: 'Semisurgente', Natural: 'Surgente' };

  function construirFilasOrdenadasYFiltradas(indicePozos, indiceBusqueda, neSet, permisos) {
    var filtro = tablaBuscarEl.value.trim().toLowerCase();
    var orden = tablaOrdenEl.value;

    var filas = estado.seleccion.map(function (wellId) {
      var p = indicePozos[wellId] || {};
      var b = indiceBusqueda[wellId] || {};
      var depto = mapaLogic_nombreDepartamento(wellId.substring(0, 2));
      return {
        wellId: wellId,
        titular: permisos.datos ? campoTexto(b.titular) : '—',
        nc16: permisos.datos ? campoTexto(b.nc16) : '—',
        departamento: depto,
        cuenca: campoTexto(p.cuenca),
        profundidad: p.profundidad !== undefined && p.profundidad !== null ? p.profundidad + ' m' : '—',
        tipoPozo: p.surgencia ? (SELECCION_ETIQUETAS_TIPO_POZO[p.surgencia] || p.surgencia) : '—',
        estadoUbicacion: permisos.ubicacion ? campoTexto(p.estado === 'C' ? 'Confirmada' : (p.estado === 'D' ? 'Disponible' : p.estado)) : '—',
        tieneItf: permisos.perfil ? (estado.disponibilidadItf[wellId] ? 'Sí' : 'No') : '—',
        tieneNe: permisos.ne ? (neSet.has(wellId) ? 'Sí' : 'No') : '—',
        profundidadNum: typeof p.profundidad === 'number' ? p.profundidad : -1
      };
    });

    if (filtro) {
      filas = filas.filter(function (f) {
        return f.wellId.toLowerCase().indexOf(filtro) !== -1 ||
          f.titular.toLowerCase().indexOf(filtro) !== -1 ||
          f.departamento.toLowerCase().indexOf(filtro) !== -1 ||
          f.cuenca.toLowerCase().indexOf(filtro) !== -1;
      });
    }

    filas.sort(function (a, b) {
      if (orden === 'departamento') { return a.departamento.localeCompare(b.departamento) || a.wellId.localeCompare(b.wellId); }
      if (orden === 'cuenca') { return a.cuenca.localeCompare(b.cuenca) || a.wellId.localeCompare(b.wellId); }
      if (orden === 'profundidad') { return b.profundidadNum - a.profundidadNum || a.wellId.localeCompare(b.wellId); }
      return a.wellId.localeCompare(b.wellId);
    });

    return filas;
  }

  function construirCardFila(fila, contexto) {
    var card = document.createElement('div');
    card.className = 'seleccion-card';

    var header = document.createElement('div');
    header.className = 'seleccion-card-header';
    var idEl = document.createElement('span');
    idEl.className = 'seleccion-card-id mono';
    idEl.textContent = fila.wellId;
    header.appendChild(idEl);

    var btnQuitar = document.createElement('button');
    btnQuitar.type = 'button';
    btnQuitar.className = 'seleccion-card-quitar';
    btnQuitar.setAttribute('aria-label', 'Quitar ' + fila.wellId + ' de la selección');
    btnQuitar.textContent = '×';
    btnQuitar.addEventListener('click', function () {
      seleccionController_quitarPozo(fila.wellId);
      seleccionController_abrirTabla();
    });
    header.appendChild(btnQuitar);
    card.appendChild(header);

    if (fila.titular !== '—') {
      var titularEl = document.createElement('p');
      titularEl.className = 'cercamio-item-titular';
      titularEl.style.margin = '0';
      titularEl.textContent = fila.titular;
      card.appendChild(titularEl);
    }

    var campos = document.createElement('div');
    campos.className = 'seleccion-card-campos';
    [
      ['NC16', fila.nc16], ['Departamento', fila.departamento], ['Cuenca', fila.cuenca],
      ['Profundidad', fila.profundidad], ['Tipo de pozo', fila.tipoPozo], ['Ubicación', fila.estadoUbicacion],
      ['Tiene ITF', fila.tieneItf], ['Tiene NE', fila.tieneNe]
    ].forEach(function (par) {
      var wrap = document.createElement('div');
      var label = document.createElement('p');
      label.className = 'seleccion-card-campo-label';
      label.textContent = par[0];
      var valor = document.createElement('p');
      valor.style.margin = '0';
      valor.textContent = par[1];
      wrap.appendChild(label);
      wrap.appendChild(valor);
      campos.appendChild(wrap);
    });
    card.appendChild(campos);

    var acciones = document.createElement('div');
    acciones.className = 'seleccion-card-acciones';

    var btnDetalle = document.createElement('button');
    btnDetalle.type = 'button';
    btnDetalle.className = 'button-secondary';
    btnDetalle.textContent = 'Ver detalle';
    btnDetalle.addEventListener('click', function () { contexto.onAbrirPozo(fila.wellId); });
    acciones.appendChild(btnDetalle);

    // "Ver ITF" directo (item 3 del cierre: NO obligar a Ver detalle ->
    // Perfil -> ITF) - reusa apiGetProfile + un visor liviano propio
    // (mostrarItfVisor). Deshabilitado con texto "Sin ITF" cuando no hay
    // archivo, nunca un boton clickeable que falle en silencio.
    var btnItfFila = document.createElement('button');
    btnItfFila.type = 'button';
    btnItfFila.className = 'button-secondary';
    if (fila.tieneItf === 'Sí') {
      btnItfFila.textContent = 'Ver ITF';
      btnItfFila.addEventListener('click', function () { mostrarItfVisor(fila.wellId); });
    } else {
      btnItfFila.textContent = 'Sin ITF';
      btnItfFila.disabled = true;
    }
    acciones.appendChild(btnItfFila);

    var btnMapa = document.createElement('button');
    btnMapa.type = 'button';
    btnMapa.className = 'button-secondary';
    btnMapa.textContent = 'Mapa';
    btnMapa.addEventListener('click', function () { contexto.onVerEnMapa(fila.wellId); });
    acciones.appendChild(btnMapa);

    card.appendChild(acciones);
    return card;
  }

  // Visor de ITF individual (item 3 del cierre): reusa apiGetProfile tal
  // cual (mismo endpoint/permiso que el modulo Perfil), SIN pasar por
  // Ver detalle. "Guardar / Compartir" reusa el mismo dataUri con
  // download nativo del navegador - version simplificada (sin el camino
  // de Web Share API de iOS que usa renderPerfil en js/app.js), valida
  // para este contexto secundario (ver reporte de la etapa).
  var itfVisorOverlayEl = document.getElementById('seleccion-itf-visor-overlay');
  var itfVisorIdEl = document.getElementById('seleccion-itf-visor-id');
  var itfVisorImgEl = document.getElementById('seleccion-itf-visor-img');
  var itfVisorGuardarEl = document.getElementById('seleccion-itf-visor-guardar');
  var btnItfVisorCerrarEl = document.getElementById('btn-seleccion-itf-visor-cerrar');

  function mostrarItfVisor(wellId) {
    var contexto = obtenerContextoSeguro();
    if (!contexto) { return; }
    itfVisorIdEl.textContent = wellId;
    itfVisorImgEl.removeAttribute('src');
    itfVisorGuardarEl.hidden = true;
    itfVisorOverlayEl.hidden = false;

    apiGetProfile(contexto.sessionToken, wellId).then(function (result) {
      if (itfVisorOverlayEl.hidden) {
        return; // se cerro mientras cargaba
      }
      if (result.status !== 'ok') {
        if (!manejarSiSesionExpiro(result, contexto)) {
          itfVisorIdEl.textContent = wellId + ' — no se pudo cargar el ITF';
        }
        return;
      }
      var dataUri = 'data:' + result.data.mimeType + ';base64,' + result.data.imageBase64;
      itfVisorImgEl.src = dataUri;
      itfVisorImgEl.alt = 'ITF del pozo ' + wellId;
      itfVisorGuardarEl.href = dataUri;
      itfVisorGuardarEl.download = wellId + '.jpg';
      itfVisorGuardarEl.hidden = false;
    });
  }

  btnItfVisorCerrarEl.addEventListener('click', function () {
    itfVisorOverlayEl.hidden = true;
  });

  function renderizarTabla(indicePozos, indiceBusqueda, neSet, permisos) {
    var contexto = obtenerContextoSeguro();
    tablaContenidoEl.hidden = false;
    tablaContenidoEl.innerHTML = '';
    var filas = construirFilasOrdenadasYFiltradas(indicePozos, indiceBusqueda, neSet, permisos);
    if (filas.length === 0) {
      var vacio = document.createElement('p');
      vacio.className = 'cercamio-estado';
      vacio.textContent = 'Ningún pozo coincide con la búsqueda.';
      tablaContenidoEl.appendChild(vacio);
      return;
    }
    filas.forEach(function (fila) {
      tablaContenidoEl.appendChild(construirCardFila(fila, contexto));
    });
    // guarda el ultimo render para que buscar/ordenar puedan re-renderizar sin re-pedir red
    estado.ultimoRenderTabla = { indicePozos: indicePozos, indiceBusqueda: indiceBusqueda, neSet: neSet, permisos: permisos };
  }

  tablaBuscarEl.addEventListener('input', function () {
    if (estado.ultimoRenderTabla) {
      renderizarTabla(estado.ultimoRenderTabla.indicePozos, estado.ultimoRenderTabla.indiceBusqueda, estado.ultimoRenderTabla.neSet, estado.ultimoRenderTabla.permisos);
    }
  });
  tablaOrdenEl.addEventListener('change', function () {
    if (estado.ultimoRenderTabla) {
      renderizarTabla(estado.ultimoRenderTabla.indicePozos, estado.ultimoRenderTabla.indiceBusqueda, estado.ultimoRenderTabla.neSet, estado.ultimoRenderTabla.permisos);
    }
  });

  // ---- ITF por lote (item G/H) ----

  function seleccionController_abrirItf() {
    sesionExpiradaYaManejada = false;
    var contexto = obtenerContextoSeguro();
    estado.aperturaItfId += 1;
    var aperturaId = estado.aperturaItfId;

    itfSubtituloEl.textContent = estado.seleccion.length + ' pozo' + (estado.seleccion.length === 1 ? '' : 's') + ' seleccionado' + (estado.seleccion.length === 1 ? '' : 's');
    itfContenidoEl.hidden = true;
    itfProgresoEl.hidden = true;
    itfResultadoEl.hidden = true;
    itfListaEl.innerHTML = '';
    itfLotesEl.innerHTML = '';

    if (!contexto || !contexto.permisos || !contexto.permisos.perfil) {
      itfLoadingEl.hidden = true;
      itfContenidoEl.hidden = false;
      itfListaEl.innerHTML = '<p class="cercamio-estado">No tenés permiso para ver ITF.</p>';
      return;
    }
    if (estado.seleccion.length === 0) {
      itfLoadingEl.hidden = true;
      itfContenidoEl.hidden = false;
      itfListaEl.innerHTML = '<p class="cercamio-estado">No tenés pozos seleccionados.</p>';
      return;
    }

    itfLoadingEl.hidden = false;

    asegurarDisponibilidadItf(contexto).then(function () {
      if (aperturaId !== estado.aperturaItfId) {
        return;
      }
      itfLoadingEl.hidden = true;
      itfContenidoEl.hidden = false;
      renderizarListaItf();
    });
  }

  function renderizarListaItf() {
    itfListaEl.innerHTML = '';
    itfLotesEl.innerHTML = '';

    var disponibles = estado.seleccion.filter(function (id) { return estado.disponibilidadItf[id]; });
    var noDisponibles = estado.seleccion.filter(function (id) { return !estado.disponibilidadItf[id]; });

    var resumen = document.createElement('p');
    resumen.className = 'mapa-contador';
    resumen.textContent = disponibles.length + ' ITF disponibles de ' + estado.seleccion.length + ' pozos seleccionados';
    itfLotesEl.appendChild(resumen);

    // Item 3 del cierre: lotes de hasta 50, mostrados como botones
    // separados si hace falta mas de uno - nunca se intenta descargar
    // wellId sin ITF.
    for (var i = 0; i < disponibles.length; i += ITF_LOTE_MAX) {
      var lote = disponibles.slice(i, i + ITF_LOTE_MAX);
      var btnLote = document.createElement('button');
      btnLote.type = 'button';
      btnLote.className = 'button';
      var desde = i + 1, hasta = i + lote.length;
      btnLote.textContent = disponibles.length > ITF_LOTE_MAX
        ? ('Descargar lote ' + (Math.floor(i / ITF_LOTE_MAX) + 1) + ': ' + desde + '–' + hasta)
        : 'Descargar todos los disponibles (' + lote.length + ')';
      btnLote.disabled = estado.descargaEnCurso;
      btnLote.addEventListener('click', function (loteCerrado) {
        return function () { descargarLoteItf(loteCerrado); };
      }(lote));
      itfLotesEl.appendChild(btnLote);
    }

    estado.seleccion.forEach(function (wellId) {
      var disponible = !!estado.disponibilidadItf[wellId];
      var item = document.createElement('div');
      item.className = 'seleccion-itf-item ' + (disponible ? 'seleccion-itf-item-disponible' : 'seleccion-itf-item-no-disponible');

      var idEl = document.createElement('span');
      idEl.className = 'mono';
      idEl.textContent = wellId;
      item.appendChild(idEl);

      var estadoEl = document.createElement('span');
      if (disponible) {
        var btnUno = document.createElement('button');
        btnUno.type = 'button';
        btnUno.className = 'button-secondary';
        btnUno.textContent = '✓ Descargar';
        btnUno.addEventListener('click', function () { descargarUnoItf(wellId); });
        item.appendChild(btnUno);
      } else {
        estadoEl.textContent = 'Sin ITF';
        item.appendChild(estadoEl);
      }

      itfListaEl.appendChild(item);
    });
  }

  // Descarga individual (item G: "Descargar uno individual") - misma
  // llamada que ya usa el modulo Perfil (apiGetProfile), con un guardado
  // simplificado: en iOS abre la imagen en una pestaña nueva (Safari
  // ofrece su propio boton de guardar sobre la imagen), en el resto
  // dispara la descarga directa - version mas simple del mecanismo
  // completo de renderPerfil/handleSaveImageIOS en js/app.js (ese usa
  // ademas el Web Share API con archivos cuando esta disponible), valida
  // igual para este contexto de lote/secundario.
  function descargarUnoItf(wellId) {
    var contexto = obtenerContextoSeguro();
    if (!contexto) { return; }
    apiGetProfile(contexto.sessionToken, wellId).then(function (result) {
      if (result.status !== 'ok') {
        manejarSiSesionExpiro(result, contexto);
        return;
      }
      var dataUri = 'data:' + result.data.mimeType + ';base64,' + result.data.imageBase64;
      if (/iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream) {
        window.open(dataUri, '_blank');
        return;
      }
      var a = document.createElement('a');
      a.href = dataUri;
      a.download = wellId + '.jpg';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    });
  }

  // Ejecuta fnAsync sobre items con un maximo de "limite" en vuelo a la
  // vez (item 3: "maximo 3 requests simultaneos, nunca 50 a la vez") -
  // sin libreria, un runner chico y explicito.
  function ejecutarConConcurrencia(items, limite, fnAsync, onProgreso) {
    return new Promise(function (resolve) {
      if (items.length === 0) {
        resolve([]);
        return;
      }
      var indice = 0;
      var completados = 0;
      var activos = 0;
      var resultados = new Array(items.length);

      function lanzarSiguiente() {
        if (indice >= items.length) {
          if (activos === 0) { resolve(resultados); }
          return;
        }
        var miIndice = indice++;
        activos++;
        fnAsync(items[miIndice], miIndice).then(function (valor) {
          resultados[miIndice] = { ok: true, valor: valor };
        }).catch(function (error) {
          resultados[miIndice] = { ok: false, error: error };
        }).then(function () {
          activos--;
          completados++;
          if (onProgreso) { onProgreso(completados, items.length); }
          lanzarSiguiente();
        });
      }

      var arranque = Math.min(limite, items.length);
      for (var i = 0; i < arranque; i++) {
        lanzarSiguiente();
      }
    });
  }

  function descargarLoteItf(wellIds) {
    if (estado.descargaEnCurso) {
      return;
    }
    var contexto = obtenerContextoSeguro();
    if (!contexto) { return; }

    estado.descargaEnCurso = true;
    Array.prototype.forEach.call(itfLotesEl.querySelectorAll('button'), function (b) { b.disabled = true; });
    itfProgresoEl.hidden = false;
    itfResultadoEl.hidden = true;
    itfProgresoBarraEl.value = 0;
    itfProgresoBarraEl.max = wellIds.length;
    itfProgresoTextoEl.textContent = 'Descargando ITF 0 de ' + wellIds.length + '…';
    var totalSeleccionadosAlArrancar = estado.seleccion.length;

    mapaShared_cargarJSZip().then(function () {
      var zip = new window.JSZip();
      var exitosos = [];

      return ejecutarConConcurrencia(wellIds, ITF_CONCURRENCIA_MAX, function (wellId) {
        return apiGetProfile(contexto.sessionToken, wellId).then(function (result) {
          if (result.status !== 'ok') {
            // Sesion vencida (item 8 del cierre): se maneja UNA vez
            // (manejarSiSesionExpiro esta guardado) igual que el resto
            // de la app - el resto de los items en vuelo sigue
            // terminando normalmente (cada uno cuenta como fallido), no
            // hace falta cancelar el lote entero para esto.
            manejarSiSesionExpiro(result, contexto);
            throw new Error(result.message || 'error');
          }
          zip.file(wellId + '.jpg', result.data.imageBase64, { base64: true });
          exitosos.push(wellId);
          return true;
        });
      }, function (completados, total) {
        itfProgresoBarraEl.value = completados;
        itfProgresoTextoEl.textContent = 'Descargando ITF ' + completados + ' de ' + total + '…';
      }).then(function (resultados) {
        var fallidos = wellIds.filter(function (id, i) { return !resultados[i].ok; });
        estado.ultimosFallidos = fallidos;

        itfProgresoEl.hidden = true;
        itfResultadoEl.hidden = false;
        itfResultadoTextoEl.textContent = exitosos.length + ' descargados' + (fallidos.length > 0 ? ' · ' + fallidos.length + ' con error' : '');
        btnItfReintentarEl.hidden = fallidos.length === 0;

        // Auditoria de "Descarga ITF" (cierre revisado del item 1/K): UN
        // evento resumido AL TERMINAR la descarga real (no al arrancar,
        // para poder reportar los conteos reales) - nunca uno por pozo.
        // Fire-and-forget, nunca bloquea la UI ni condiciona el ZIP.
        try {
          apiRegisterDescargaItf(contexto.sessionToken, {
            totalSeleccionados: totalSeleccionadosAlArrancar,
            solicitados: wellIds.length,
            descargados: exitosos.length,
            fallidos: fallidos.length,
            wellIds: wellIds
          });
        } catch (err) {
          // auditoria es secundaria, nunca bloquea la descarga
        }

        if (exitosos.length === 0) {
          estado.descargaEnCurso = false;
          Array.prototype.forEach.call(itfLotesEl.querySelectorAll('button'), function (b) { b.disabled = false; });
          return;
        }

        return zip.generateAsync({ type: 'blob' }).then(function (blob) {
          descargarBlob(blob, 'itf_' + exitosos.length + '_pozos.zip');
        });
      });
    }).finally(function () {
      estado.descargaEnCurso = false;
      Array.prototype.forEach.call(itfLotesEl.querySelectorAll('button'), function (b) { b.disabled = false; });
    });
  }

  function descargarBlob(blob, nombreArchivo) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  btnItfReintentarEl.addEventListener('click', function () {
    var fallidos = estado.ultimosFallidos;
    if (fallidos.length > 0) {
      descargarLoteItf(fallidos);
    }
  });

  window.seleccionController_inicializar = seleccionController_inicializar;
  window.seleccionController_registrarListener = seleccionController_registrarListener;
  window.seleccionController_obtenerSeleccionSet = seleccionController_obtenerSeleccionSet;
  window.seleccionController_tieneSeleccion = seleccionController_tieneSeleccion;
  window.seleccionController_obtenerGeometria = seleccionController_obtenerGeometria;
  window.seleccionController_proponerSeleccion = seleccionController_proponerSeleccion;
  window.seleccionController_quitarPozo = seleccionController_quitarPozo;
  window.seleccionController_abrirTabla = seleccionController_abrirTabla;
  window.seleccionController_abrirItf = seleccionController_abrirItf;
})();
