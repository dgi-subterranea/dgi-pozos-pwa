// Controlador DOM de la VALIDACION de correcciones de ubicacion (quien tiene ubicacion + ubicacion_validar): la bandeja "Correcciones pendientes" que abre el
// indicador del hub y el detalle para decidir (con un mapa propio, solo para esa decision) con las acciones Validar / Rechazar. Las tarjetas "Pendiente" de la
// ficha del pozo abren el MISMO detalle y la MISMA confirmacion (ubicacionValidacionController_abrirDetalle): un solo camino, sin logica duplicada.
// Toca DOM, Leaflet y red, asi que no se prueba directo con Jest: los tests lo ejecutan con un DOM y un Leaflet simulados (js/ubicacionValidacionController.test.js);
// las reglas -permisos, motivo obligatorio, mensajes, un solo envio a la vez, mapeo de errores- viven en js/ubicacionCorreccionLogic.js (con tests).
//
// - Endpoints que YA existen: getCorreccionesUbicacionPendientes (la lista), getCorreccionesUbicacionPozo (la vigente del pozo), validarCorreccionUbicacion y
//   rechazarCorreccionUbicacion. El backend es la autoridad (permisos, transiciones, quien no puede rechazar lo propio); aca nada se decide por su cuenta.
// - Fail-closed: sin ubicacion + ubicacion_validar exactos no se abre nada y el flujo tampoco envia (aunque alguien fuerce el DOM).
// - Despues de validar / rechazar: se refresca el indicador (ubicacionPendientesController_alResolver), la ficha del pozo si es el mismo pozo
//   (ubicacionCorreccionController_alResolver) y la lista abierta, sin recargar la app.
// - La ubicacion de Irrigacion NO se modifica nunca: este modulo solo la muestra. No toca el mapa provincial, Cerca Mio, la seleccion, los reemplazos ni NE.
(function () {
  var estado = {
    obtenerContexto: null,
    flujo: null,
    vista: null,               // 'lista' | 'detalle'
    origen: 'badge',           // 'badge' (bandeja) | 'ficha' (tarjeta del pozo)
    listaId: 0,                // descarta respuestas tardias de una lista anterior
    detalleId: 0,              // idem para la vigente / el mapa de un detalle anterior
    items: [],
    seleccion: null,
    vigente: null,
    vigenteEstado: 'ok',       // 'ok' | 'cargando' | 'error'
    intencion: null,           // 'validar' | 'rechazar' | null (que confirmacion esta abierta)
    procesando: false,
    mapa: { mapa: null, capasBase: null, capaBaseActual: null, capas: null }
  };

  var $ = function (id) { return document.getElementById(id); };
  var overlayEl = $('uval-overlay');
  var tituloEl = $('uval-titulo');
  var avisoEl = $('uval-aviso');
  var btnCerrar = $('btn-uval-cerrar');
  var vistasEls = { lista: $('uval-vista-lista'), detalle: $('uval-vista-detalle') };
  var listaEls = {
    cargando: $('uval-lista-cargando'), error: $('uval-lista-error'), reintentar: $('btn-uval-lista-reintentar'), vacia: $('uval-lista-vacia'),
    nota: $('uval-lista-nota'), lista: $('uval-lista'), cerrar: $('btn-uval-lista-cerrar')
  };
  var detEls = {
    datos: $('uval-detalle-datos'), vigenteAviso: $('uval-vigente-aviso'), estado: $('uval-estado'), error: $('uval-error'), acciones: $('uval-acciones'),
    validar: $('btn-uval-validar'), rechazar: $('btn-uval-rechazar'), volver: $('btn-uval-detalle-volver'),
    confirmar: $('uval-confirmar-validar'), confirmarTitulo: $('uval-confirmar-titulo'), confirmarPuntos: $('uval-confirmar-puntos'),
    confirmarSi: $('btn-uval-validar-confirmar'), confirmarNo: $('btn-uval-validar-cancelar'),
    rechazo: $('uval-rechazo'), motivo: $('uval-motivo'), errMotivo: $('uval-err-motivo'), rechazoSi: $('btn-uval-rechazar-confirmar'), rechazoNo: $('btn-uval-rechazar-cancelar')
  };
  var mapaEls = {
    cargando: $('uval-mapa-cargando'), error: $('uval-mapa-error'), contenedor: $('uval-mapa'), chips: Array.prototype.slice.call(document.querySelectorAll('.uval-capa-chip'))
  };
  var abridorEl = null;

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function puedeValidar() {
    var ctx = contexto();
    return !!ctx && ubicacionCorreccionLogic_puedeValidar(ctx.permisos);
  }

  function ubicacionValidacionController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    estado.flujo = ubicacionCorreccionLogic_crearFlujoResolucion({
      permisos: function () { var ctx = contexto(); return ctx ? ctx.permisos : null; },
      validar: function (id) { return apiValidarCorreccionUbicacion(contexto().sessionToken, id); },
      rechazar: function (id, motivo) { return apiRechazarCorreccionUbicacion(contexto().sessionToken, id, motivo); }
    });
  }

  // --- Overlay y vistas ---

  function mostrarVista(nombre) {
    Object.keys(vistasEls).forEach(function (k) { vistasEls[k].hidden = k !== nombre; });
    estado.vista = nombre;
    tituloEl.textContent = nombre === 'detalle' ? 'Validar corrección' : 'Correcciones pendientes';
    overlayEl.scrollTop = 0;
  }

  function abrirOverlay(opener) {
    abridorEl = opener || null;
    overlayEl.hidden = false;
    document.body.classList.add('ucorr-abierto');
  }

  function cerrar(forzar) {
    if (estado.procesando && !forzar) {
      return;
    }
    estado.listaId += 1;              // descarta respuestas tardias
    estado.detalleId += 1;
    estado.procesando = false;
    estado.seleccion = null;
    estado.intencion = null;
    estado.vista = null;
    overlayEl.hidden = true;
    document.body.classList.remove('ucorr-abierto');
    if (abridorEl && document.body.contains(abridorEl) && typeof abridorEl.focus === 'function') {
      abridorEl.focus();
    }
    abridorEl = null;
  }

  function ponerAviso(texto) {
    avisoEl.textContent = texto || '';
    avisoEl.hidden = !texto;
  }

  // Sesion vencida / usuario deshabilitado: se cierra todo y se delega a la app (igual que el resto de las pantallas).
  function manejarSesion(code) {
    var ctx = contexto();
    cerrar(true);
    if (!ctx) { return; }
    if (code === 'USER_DISABLED') {
      if (ctx.onUserDisabled) { ctx.onUserDisabled(); }
    } else if (ctx.onSessionExpired) {
      ctx.onSessionExpired();
    }
  }

  // --- Bandeja ---

  function ubicacionValidacionController_abrirBandeja(opener) {
    if (!puedeValidar()) {
      return;                          // fail-closed: sin los dos permisos exactos no se abre nada
    }
    estado.origen = 'badge';
    abrirOverlay(opener);
    ponerAviso('');
    mostrarVista('lista');
    cargarLista();
  }

  function cargarLista() {
    var ctx = contexto();
    if (!ctx || !puedeValidar()) {
      cerrar(true);
      return;
    }
    estado.listaId += 1;
    var mi = estado.listaId;
    listaEls.cargando.hidden = false;
    listaEls.error.hidden = true;
    listaEls.reintentar.hidden = true;
    listaEls.vacia.hidden = true;
    listaEls.nota.hidden = true;
    listaEls.lista.innerHTML = '';
    apiGetCorreccionesUbicacionPendientes(ctx.sessionToken).then(function (resp) {
      if (mi !== estado.listaId) {
        return;
      }
      listaEls.cargando.hidden = true;
      var r = ubicacionCorreccionLogic_resumenPendientes(resp);
      if (r.ok) {
        pintarLista(r);
        return;
      }
      var code = resp && resp.code;
      if (UCORR_CODIGOS_SESION.indexOf(code) !== -1) {
        manejarSesion(code);
        return;
      }
      errorLista(code === 'PERMISSION_DENIED' ? ubicacionCorreccionLogic_mensajeErrorResolver('PERMISSION_DENIED') : 'No se pudieron cargar las correcciones pendientes. Intentá nuevamente.');
    }, function () {
      if (mi === estado.listaId) {
        listaEls.cargando.hidden = true;
        errorLista('No se pudieron cargar las correcciones. Revisá tu conexión e intentá de nuevo.');
      }
    });
  }

  function errorLista(texto) {
    listaEls.error.textContent = texto;
    listaEls.error.hidden = false;
    listaEls.reintentar.hidden = false;
  }

  function pintarLista(r) {
    estado.items = r.items;
    // el indicador del hub toma el total que acaba de informar el backend (con 0 se oculta)
    if (typeof ubicacionPendientesController_fijarTotal === 'function') {
      ubicacionPendientesController_fijarTotal(r.total);
    }
    listaEls.vacia.hidden = r.items.length > 0;
    listaEls.nota.textContent = r.nota;
    listaEls.nota.hidden = !r.nota;
    listaEls.lista.innerHTML = r.items.map(ubicacionCorreccionLogic_htmlItemPendiente).join('');
  }

  // --- Detalle ---

  // info: {correccion (vista de correccion PROPUESTA), vigente (vista|null) si ya se conoce, accion: 'validar'|'rechazar'|undefined, opener}
  // Lo llama la ficha del pozo (origen 'ficha') y la bandeja (origen 'badge', sin vigente conocida: se lee).
  function abrirDetalle(info, origen) {
    var c = info && info.correccion;
    if (!puedeValidar() || !c || c.estado !== 'PROPUESTA' || typeof c.correccionId !== 'string') {
      return;                          // fail-closed
    }
    estado.origen = origen;
    estado.detalleId += 1;
    var mi = estado.detalleId;
    estado.seleccion = c;
    estado.intencion = null;
    estado.procesando = false;
    estado.vigente = info.vigente || null;
    estado.vigenteEstado = info.vigenteConocida === true ? 'ok' : 'cargando';
    if (origen === 'ficha') {
      abrirOverlay(info.opener);
      ponerAviso('');
    }
    ocultarMensajes();
    detEls.volver.textContent = origen === 'badge' ? 'Volver a la lista' : 'Cerrar';
    mostrarVista('detalle');
    pintarDetalle();
    prepararMapa(mi);
    if (estado.vigenteEstado === 'cargando') {
      cargarVigente(c, mi);
    }
    if (info.accion === 'validar') {
      pedirValidar();
    } else if (info.accion === 'rechazar') {
      pedirRechazo();
    }
  }

  function ocultarMensajes() {
    detEls.estado.hidden = true;
    detEls.error.hidden = true;
    detEls.vigenteAviso.hidden = true;
    detEls.confirmar.hidden = true;
    detEls.rechazo.hidden = true;
    detEls.errMotivo.hidden = true;
    detEls.motivo.value = '';
    detEls.acciones.hidden = false;
  }

  function pintarDetalle() {
    var c = estado.seleccion;
    if (!c) {
      return;
    }
    detEls.datos.innerHTML = ubicacionCorreccionLogic_htmlDetalleValidacion(c, { vigente: estado.vigente, vigenteEstado: estado.vigenteEstado });
    // Rechazar no se ofrece sobre una propuesta PROPIA (el backend responde SELF_REJECTION). Mientras se lee la vigente no se puede decidir.
    detEls.rechazar.hidden = !ubicacionCorreccionLogic_puedeRechazarPropuesta(contexto() ? contexto().permisos : null, c);
    detEls.validar.disabled = estado.procesando || estado.vigenteEstado === 'cargando';
    detEls.rechazar.disabled = estado.procesando || estado.vigenteEstado === 'cargando';
  }

  // La vigente del pozo se lee con el endpoint existente; ademas, si la correccion ya no figura entre las pendientes del pozo, otra persona la resolvio.
  function cargarVigente(c, mi) {
    var ctx = contexto();
    apiGetCorreccionesUbicacionPozo(ctx.sessionToken, c.wellId).then(function (resp) {
      if (mi !== estado.detalleId) {
        return;
      }
      if (resp && resp.status === 'ok' && resp.data) {
        var sigue = (resp.data.pendientes || []).some(function (p) { return p.correccionId === c.correccionId; });
        if (!sigue) {
          resolvioOtro(UCORR_MENSAJE_YA_RESUELTA);
          return;
        }
        estado.vigente = resp.data.vigente || null;
        estado.vigenteEstado = 'ok';
      } else {
        var code = resp && resp.code;
        if (UCORR_CODIGOS_SESION.indexOf(code) !== -1) {
          manejarSesion(code);
          return;
        }
        vigenteFallo();
        return;
      }
      pintarDetalle();
      dibujarMarcadores();
    }, function () {
      if (mi === estado.detalleId) {
        vigenteFallo();
      }
    });
  }

  function vigenteFallo() {
    estado.vigente = null;
    estado.vigenteEstado = 'error';
    detEls.vigenteAviso.textContent = 'No se pudo cargar la ubicación validada vigente de este pozo. Podés decidir igual: si existe otra, quedará reemplazada.';
    detEls.vigenteAviso.hidden = false;
    pintarDetalle();
  }

  // --- Mapa del detalle (solo para decidir esta validacion) ---

  function htmlMarcador(clase, texto) {
    return '<div class="ucorr-marker ' + clase + '"><span class="ucorr-marker-punto"></span><span class="ucorr-marker-texto">' + texto + '</span></div>';
  }

  function iconoFijo(clase, texto, etiquetaArriba) {
    return L.divIcon({
      className: 'ucorr-marker-wrap', html: htmlMarcador(clase + (etiquetaArriba ? ' ucorr-marker-arriba' : ''), texto),
      iconSize: [64, 44], iconAnchor: etiquetaArriba ? [32, 33] : [32, 11]
    });
  }

  function prepararMapa(mi) {
    estado.mapaId = mi;
    mapaEls.error.hidden = true;
    mapaEls.cargando.hidden = false;
    mapaEls.contenedor.hidden = true;
    mapaShared_cargarLibrerias().then(function () {
      if (mi !== estado.detalleId) {
        return;
      }
      var mp = estado.mapa;
      mapaEls.cargando.hidden = true;
      mapaEls.contenedor.hidden = false;
      if (!mp.mapa) {
        mp.mapa = L.map('uval-mapa', { zoomControl: true }).setView([-34.6, -68.6], 7);
        mp.capasBase = mapaShared_crearCapasBase(mp.mapa);
        mp.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
        mp.capas = L.layerGroup().addTo(mp.mapa);
      }
      mapaShared_alMostrarMapa(mp.mapa, function () {
        if (mi === estado.detalleId) {
          dibujarMarcadores();
        }
      });
    }).catch(function () {
      if (mi !== estado.detalleId) {
        return;
      }
      mapaEls.cargando.hidden = true;
      mapaEls.error.hidden = false;          // el detalle sigue siendo utilizable: se decide con los datos
    });
  }

  // Tres puntos claramente diferenciados: Irrigacion (fija), validada vigente (fija, si hay) y la propuesta (pin). Nada se puede mover.
  function dibujarMarcadores() {
    var mp = estado.mapa;
    var c = estado.seleccion;
    if (!mp.mapa || !c || !mp.capas) {
      return;
    }
    mp.capas.clearLayers();
    var pts = [[c.lat, c.lon]];
    var irr = c.irrigacion;
    if (irr && ubicacionCorreccionLogic_esNumero(irr.lat) && ubicacionCorreccionLogic_esNumero(irr.lon)) {
      L.marker([irr.lat, irr.lon], { icon: iconoFijo('ucorr-marker-irr', 'Irrigación'), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(mp.capas);
      pts.push([irr.lat, irr.lon]);
    }
    var v = estado.vigente;
    if (v && ubicacionCorreccionLogic_esNumero(v.lat) && ubicacionCorreccionLogic_esNumero(v.lon)) {
      L.marker([v.lat, v.lon], { icon: iconoFijo('ucorr-marker-vig', 'Vigente', true), interactive: false, keyboard: false, zIndexOffset: 300 }).addTo(mp.capas);
      pts.push([v.lat, v.lon]);
    }
    L.marker([c.lat, c.lon], { icon: mapaShared_iconoPuntoBusqueda(), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(mp.capas);
    if (pts.length === 1) {
      mp.mapa.setView(pts[0], 17);
    } else {
      // el pin sobresale ~38 px por encima de su punta: mas margen arriba para que no quede cortado
      mp.mapa.fitBounds(pts, { maxZoom: 17, paddingTopLeft: [36, 60], paddingBottomRight: [36, 40] });
    }
  }

  // --- Acciones: confirmacion de Validar / motivo de Rechazar ---

  function pedirValidar() {
    if (!puedeValidar() || estado.procesando || !estado.seleccion || estado.vigenteEstado === 'cargando') {
      return;
    }
    estado.intencion = 'validar';
    var hayVigente = estado.vigenteEstado === 'ok' ? !!estado.vigente : null;
    var t = ubicacionCorreccionLogic_textosConfirmacionValidar(hayVigente);
    detEls.confirmarTitulo.textContent = t.titulo;
    detEls.confirmarPuntos.innerHTML = t.puntos.map(function (p) { return '<li>' + ubicacionCorreccionLogic_escapar(p) + '</li>'; }).join('');
    detEls.error.hidden = true;
    detEls.rechazo.hidden = true;
    detEls.acciones.hidden = true;
    detEls.confirmar.hidden = false;
    detEls.confirmarSi.focus();
  }

  function pedirRechazo() {
    var ctx = contexto();
    if (!puedeValidar() || estado.procesando || !estado.seleccion || estado.vigenteEstado === 'cargando' ||
        !ubicacionCorreccionLogic_puedeRechazarPropuesta(ctx ? ctx.permisos : null, estado.seleccion)) {
      return;
    }
    estado.intencion = 'rechazar';
    detEls.error.hidden = true;
    detEls.errMotivo.hidden = true;
    detEls.confirmar.hidden = true;
    detEls.acciones.hidden = true;
    detEls.rechazo.hidden = false;
    detEls.motivo.focus();
  }

  function cancelarIntencion() {
    if (estado.procesando) {
      return;
    }
    estado.intencion = null;
    detEls.confirmar.hidden = true;
    detEls.rechazo.hidden = true;
    detEls.error.hidden = true;
    detEls.errMotivo.hidden = true;
    detEls.acciones.hidden = false;
  }

  function setProcesando(si, accion) {
    estado.procesando = si;
    detEls.estado.textContent = si ? (accion === 'validar' ? 'Validando…' : 'Rechazando…') : '';
    detEls.estado.hidden = !si;
    [detEls.validar, detEls.rechazar, detEls.confirmarSi, detEls.confirmarNo, detEls.rechazoSi, detEls.rechazoNo, detEls.volver, btnCerrar].forEach(function (b) { b.disabled = si; });
    detEls.motivo.disabled = si;
    if (si) {
      detEls.error.hidden = true;
    } else {
      pintarDetalle();
    }
  }

  function ejecutar(accion) {
    var c = estado.seleccion;
    if (estado.procesando || !c) {
      return;                          // doble toque: el flujo tambien lo ignora, esto evita incluso el cambio de UI
    }
    if (accion === 'rechazar') {
      var m = ubicacionCorreccionLogic_validarMotivoRechazo(detEls.motivo.value);
      if (!m.ok) {
        detEls.errMotivo.textContent = m.error;      // motivo obligatorio: no se envia nada
        detEls.errMotivo.hidden = false;
        detEls.motivo.focus();
        return;
      }
      detEls.errMotivo.hidden = true;
    }
    var mi = estado.detalleId;
    setProcesando(true, accion);
    estado.flujo.resolver(accion, c, detEls.motivo.value).then(function (r) {
      if (mi !== estado.detalleId) {
        return;                        // se cerro (sesion, logout) mientras tanto
      }
      setProcesando(false);
      manejarResultado(c, r);
    });
  }

  function mostrarError(texto) {
    detEls.error.textContent = texto;
    detEls.error.hidden = false;
  }

  // Avisa a quienes muestran estos datos: el indicador del hub (siempre se vuelve a pedir) y la ficha del pozo si es el mismo pozo.
  function notificarResolucion(c, r) {
    if (typeof ubicacionPendientesController_alResolver === 'function') {
      ubicacionPendientesController_alResolver();
    }
    if (typeof ubicacionCorreccionController_alResolver === 'function') {
      ubicacionCorreccionController_alResolver({ wellId: c.wellId, mensaje: r.mensaje, tipo: r.tipo });
    }
  }

  // Termino la accion (validada, rechazada o ya resuelta por otro): se vuelve a la lista (refrescada) o, si se vino de la ficha, se cierra y la ficha se actualiza.
  function terminar(c, r) {
    // validar (o que otra persona la resolviera: no sabemos como) puede haber cambiado la ubicacion vigente: el mapa vuelve a pedir los deltas. Rechazar no la cambia.
    if ((r.tipo === 'ok' && r.accion === 'validar') || r.tipo === 'resuelta') {
      if (typeof mapaDataset_invalidarDeltas === 'function') {
        mapaDataset_invalidarDeltas();
      }
    }
    notificarResolucion(c, r);
    if (estado.origen === 'badge') {
      ponerAviso(r.mensaje);
      estado.seleccion = null;
      estado.intencion = null;
      mostrarVista('lista');
      cargarLista();
    } else {
      cerrar(true);
    }
  }

  function resolvioOtro(mensaje) {
    var c = estado.seleccion;
    if (c) {
      terminar(c, { tipo: 'resuelta', mensaje: mensaje });
    }
  }

  function manejarResultado(c, r) {
    if (r.tipo === 'ok' || r.tipo === 'resuelta') {
      terminar(c, r);
    } else if (r.tipo === 'sesion') {
      manejarSesion(r.code);
    } else if (r.tipo === 'sin_permiso') {
      mostrarError(r.mensaje);
      detEls.acciones.hidden = true;
      detEls.confirmar.hidden = true;
      detEls.rechazo.hidden = true;
    } else {
      mostrarError(r.mensaje);        // error del backend / sin conexion: el detalle queda abierto y se puede reintentar
    }
  }

  // --- Eventos ---

  // clic en un renglon de la bandeja (delegacion: la lista se vuelve a pintar entera)
  function idDeEvento(e, atributo) {
    var t = e && e.target;
    var el = t && typeof t.closest === 'function' ? t.closest('[' + atributo + ']') : null;
    return el ? el.getAttribute(atributo) : null;
  }

  listaEls.lista.addEventListener('click', function (e) {
    var id = idDeEvento(e, 'data-uval-correccion');
    if (id === null || estado.vista !== 'lista') {
      return;
    }
    var item = estado.items.filter(function (c) { return c.correccionId === id; })[0];
    if (item) {
      abrirDetalle({ correccion: item, vigenteConocida: false }, 'badge');
    }
  });
  listaEls.reintentar.addEventListener('click', cargarLista);
  listaEls.cerrar.addEventListener('click', function () { cerrar(false); });
  detEls.validar.addEventListener('click', pedirValidar);
  detEls.rechazar.addEventListener('click', pedirRechazo);
  detEls.confirmarNo.addEventListener('click', cancelarIntencion);
  detEls.rechazoNo.addEventListener('click', cancelarIntencion);
  detEls.confirmarSi.addEventListener('click', function () { ejecutar('validar'); });
  detEls.rechazoSi.addEventListener('click', function () { ejecutar('rechazar'); });
  detEls.volver.addEventListener('click', function () {
    if (estado.procesando) {
      return;
    }
    if (estado.origen === 'badge') {
      estado.detalleId += 1;
      estado.seleccion = null;
      estado.intencion = null;
      mostrarVista('lista');
      cargarLista();
    } else {
      cerrar(false);
    }
  });
  mapaEls.chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (estado.mapa.mapa) {
        mapaShared_cambiarCapaBase(estado.mapa, chip.getAttribute('data-capa'), mapaEls.chips);
      }
    });
  });
  btnCerrar.addEventListener('click', function () { cerrar(false); });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cerrar(false);
    }
  });

  // Desde la ficha del pozo: info = {correccion, vigente, accion, opener}. Mismo detalle, misma confirmacion, mismo backend.
  function ubicacionValidacionController_abrirDetalle(info) {
    var i = info || {};
    abrirDetalle({ correccion: i.correccion, vigente: i.vigente || null, vigenteConocida: true, accion: i.accion, opener: i.opener }, 'ficha');
  }

  function ubicacionValidacionController_cerrar() {
    cerrar(true);
  }

  window.ubicacionValidacionController_inicializar = ubicacionValidacionController_inicializar;
  window.ubicacionValidacionController_abrirBandeja = ubicacionValidacionController_abrirBandeja;
  window.ubicacionValidacionController_abrirDetalle = ubicacionValidacionController_abrirDetalle;
  window.ubicacionValidacionController_cerrar = ubicacionValidacionController_cerrar;
})();
