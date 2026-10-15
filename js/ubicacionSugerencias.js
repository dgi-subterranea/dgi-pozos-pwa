// Controlador DOM de la COLA DE REVISION de sugerencias sobre fuentes registrales: el indicador del hub «Sugerencias de ubicación: N» (solo ubicacion + ubicacion_validar exactos) y la
// lista de pendientes con Aprobar / Rechazar. Toca DOM y red, asi que no se prueba directo con Jest: los tests lo ejecutan con un DOM simulado (js/ubicacionSugerenciasController.test.js);
// la logica pura vive en js/ubicacionSugerenciasLogic.js y en js/ubicacionFuenteDecisionesUiLogic.js (con tests).
//
// - Aprobar y rechazar van SIEMPRE por resolverSugerenciaFuente (nunca se llama al endpoint de las decisiones directas desde aca): el backend reutiliza el mismo nucleo autoritativo. El dialogo de
//   confirmacion es el MISMO de las decisiones y de las sugerencias de la ficha (js/ubicacionFuenteDecisionesUi.js).
// - El indicador reutiliza el mecanismo de «Correcciones pendientes» (ubicacionCorreccionLogic_crearBadgePendientes): sin permiso, con 0 o ante un error no se ve; se refresca al entrar al
//   hub con un intervalo minimo y SIEMPRE despues de resolver una sugerencia.
// - Tras resolver: la cola se relee, el indicador toma el total nuevo y, si la ficha de ese pozo esta abierta, sus tarjetas y popups se actualizan.
// - Un conflicto (otro validador resolvio antes, cambio la version del pozo) NUNCA se reintenta solo: se avisa en palabras humanas y se refresca.
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var badgeEl = $('usug-pendientes');
  var textoEl = $('usug-pendientes-texto');
  var overlayEl = $('usug-overlay');
  var els = {
    cerrar: $('btn-usug-cerrar'), cerrarAbajo: $('btn-usug-cerrar-abajo'), aviso: $('usug-aviso'), cargando: $('usug-cargando'), error: $('usug-error'), reintentar: $('btn-usug-reintentar'),
    vacio: $('usug-vacio'), resumen: $('usug-resumen'), lista: $('usug-lista')
  };
  var estado = { obtenerContexto: null, badge: null, cola: null, abridor: null, cargaId: 0, abierta: false, iconoMaps: '' };

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function puedeRevisar() {
    var ctx = contexto();
    return !!ctx && !!ctx.sessionToken && ubicacionCorreccionLogic_puedeValidar(ctx.permisos);
  }

  function pintarBadge(total) {
    var texto = usug_textoBadge(total);
    textoEl.textContent = texto;
    badgeEl.hidden = texto === '';
  }

  // obtenerContexto: app.js devuelve SIEMPRE el sessionToken y los permisos frescos (y como reaccionar a una sesion vencida, un usuario deshabilitado o abrir la ficha de un pozo).
  function ubicacionSugerenciasController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    estado.badge = ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: obtenerContexto,
      consultar: function (sessionToken) { return apiGetSugerenciasFuentesPendientes(sessionToken); },
      pintar: pintarBadge
    });
  }

  function ubicacionSugerenciasController_refrescar() {
    return estado.badge ? estado.badge.refrescar(false) : Promise.resolve({ tipo: 'sin_permiso' });
  }

  function ubicacionSugerenciasController_reset() {
    ubicacionSugerenciasController_cerrar();
    estado.cola = null;
    if (estado.badge) { estado.badge.reset(); } else { pintarBadge(null); }
  }

  // --- Cola ---

  function mostrarAviso(tipo, texto) {
    els.aviso.className = 'ufd-aviso ufd-aviso-' + (tipo === 'ok' ? 'ok' : 'aviso');
    els.aviso.textContent = texto || '';
    els.aviso.hidden = !texto;
  }

  function pintarCola() {
    var cola = estado.cola;
    els.error.hidden = true;
    els.reintentar.hidden = true;
    els.cargando.hidden = true;
    var vacia = !cola || cola.items.length === 0;
    els.vacio.hidden = !vacia;
    els.vacio.textContent = USUG_TEXTO_VACIO;
    els.resumen.textContent = usug_textoResumen(cola);
    els.resumen.hidden = !els.resumen.textContent;
    els.lista.innerHTML = usug_htmlLista(cola, { iconoMaps: estado.iconoMaps, puedeAbrirPozo: !!(contexto() && typeof contexto().onAbrirPozo === 'function') });
  }

  // Lee la cola completa. Una respuesta vieja (otra apertura u otra carga) se descarta. Devuelve una promesa que no rechaza.
  function cargarCola() {
    if (!puedeRevisar()) {
      return Promise.resolve();
    }
    estado.cargaId += 1;
    var mia = estado.cargaId;
    var ctx = contexto();
    els.cargando.hidden = false;
    els.error.hidden = true;
    els.reintentar.hidden = true;
    return Promise.resolve().then(function () { return apiGetSugerenciasFuentesPendientes(ctx.sessionToken); }).then(function (r) {
      if (mia !== estado.cargaId) {
        return;
      }
      var cola = r && r.status === 'ok' ? usug_normalizarCola(r.data) : null;
      if (cola) {
        estado.cola = cola;
        pintarCola();
        if (estado.badge) { estado.badge.fijarTotal(cola.total); }
        return;
      }
      var code = r && r.code;
      els.cargando.hidden = true;
      if (code === 'UNAUTHORIZED' || code === 'USER_DISABLED') {
        if (ctx.onSessionExpired && code === 'UNAUTHORIZED') { ctx.onSessionExpired(); }
        if (ctx.onUserDisabled && code === 'USER_DISABLED') { ctx.onUserDisabled(); }
        return;
      }
      els.error.textContent = code === 'PERMISSION_DENIED' ? 'No tenés permiso para revisar sugerencias.' : USUG_TEXTO_ERROR_CARGA;
      els.error.hidden = false;
      els.reintentar.hidden = code === 'PERMISSION_DENIED';
    }, function () {
      if (mia !== estado.cargaId) {
        return;
      }
      els.cargando.hidden = true;
      els.error.textContent = USUG_TEXTO_ERROR_CARGA;
      els.error.hidden = false;
      els.reintentar.hidden = false;
    });
  }

  function ubicacionSugerenciasController_abrir(opener, iconoMaps) {
    if (!puedeRevisar()) {
      return;                          // fail-closed: sin ubicacion + ubicacion_validar exactos no se abre nada
    }
    estado.abridor = opener || null;
    estado.iconoMaps = iconoMaps || estado.iconoMaps || '';
    estado.abierta = true;
    mostrarAviso('ok', '');
    overlayEl.hidden = false;
    document.body.classList.add('ucorr-abierto');
    if (estado.cola) {
      pintarCola();
    }
    cargarCola();
  }

  function ubicacionSugerenciasController_cerrar() {
    if (!estado.abierta) {
      return;
    }
    estado.abierta = false;
    estado.cargaId += 1;               // descarta una carga en vuelo
    if (typeof ubicacionFuenteDecisionesUi_cancelar === 'function') {
      ubicacionFuenteDecisionesUi_cancelar();
    }
    overlayEl.hidden = true;
    document.body.classList.remove('ucorr-abierto');
    var ab = estado.abridor;
    estado.abridor = null;
    if (ab && document.body.contains(ab) && typeof ab.focus === 'function') {
      ab.focus();
    }
  }

  // --- Aprobar / Rechazar (el MISMO dialogo de confirmacion que las decisiones) ---

  function itemPorId(id) {
    return estado.cola ? estado.cola.items.filter(function (i) { return i.sugerenciaId === id; })[0] : null;
  }

  // Mejor esfuerzo: ¿hay una validada en campo vigente en ese pozo? (solo para elegir el texto del aviso al aprobar un ACEPTAR; si no se puede saber, se usa el texto general)
  function hayValidadaVigente(wellId) {
    var ctx = contexto();
    if (typeof apiGetCorreccionesUbicacionPozo !== 'function' || !ctx) {
      return Promise.resolve(false);
    }
    return Promise.resolve().then(function () { return apiGetCorreccionesUbicacionPozo(ctx.sessionToken, wellId); }).then(function (r) {
      return !!(r && r.status === 'ok' && r.data && r.data.vigente);
    }, function () { return false; });
  }

  function alResolver(item, r) {
    if (!r || r.tipo === 'cancelado' || !estado.abierta) {
      return Promise.resolve();
    }
    var seguir = Promise.resolve(false);
    if (r.tipo === 'ok' && r.resultado === 'APROBADA' && item.accionSugerida === 'ACEPTAR') {
      seguir = hayValidadaVigente(item.wellId);
    }
    return seguir.then(function (conCampo) {
      if (r.tipo === 'ok') {
        mostrarAviso('ok', usug_mensajeResolucion(r, item.accionSugerida, conCampo));
      } else if (r.tipo === 'desactualizado') {
        mostrarAviso('aviso', r.mensaje);
      } else {
        return null;
      }
      // la cola cambio: se relee (y el indicador toma el total nuevo); la ficha abierta de ese pozo tambien
      var carga = cargarCola();
      if (typeof ubicacionesConocidasController_refrescar === 'function') {
        ubicacionesConocidasController_refrescar(item.wellId);
      }
      return carga;                 // (al terminar de leer la cola completa, el indicador toma ESE total: no hace falta otra consulta)
    });
  }

  function resolver(item, resolucion, abridor) {
    var flujo = typeof ubicacionFuenteDecisionesUi_flujoSugerencias === 'function' ? ubicacionFuenteDecisionesUi_flujoSugerencias() : null;
    if (!flujo) {
      return;
    }
    var accion = resolucion === 'APROBAR' ? 'APROBAR_SUGERENCIA' : 'RECHAZAR_SUGERENCIA';
    ubicacionFuenteDecisionesUi_pedir({
      accion: accion, fuente: { etiqueta: item.etiquetaFuente }, accionSugerida: item.accionSugerida, visorAbierto: true, abridor: abridor,
      ejecutar: function (motivo) { return flujo.resolver({ sugerenciaId: item.sugerenciaId, resolucion: resolucion, motivo: motivo, versionVista: item.versionVista }); }
    }).then(function (r) { return alResolver(item, r); });
  }

  els.lista.addEventListener('click', function (e) {
    var t = e && e.target;
    var btn = t && typeof t.closest === 'function' ? t.closest('[data-usug-accion],[data-usug-pozo]') : null;
    if (!btn || !puedeRevisar()) {
      return;
    }
    var pozo = btn.getAttribute('data-usug-pozo');
    if (pozo) {
      var ctx = contexto();
      if (ctx && typeof ctx.onAbrirPozo === 'function') {
        ubicacionSugerenciasController_cerrar();
        ctx.onAbrirPozo(pozo);
      }
      return;
    }
    var accion = btn.getAttribute('data-usug-accion');
    var item = itemPorId(btn.getAttribute('data-usug-id'));
    // se vuelve a verificar con la cola ACTUAL: un boton viejo no puede pedir una accion que ya no corresponde a esa sugerencia
    if (!item || usug_accionesDeItem(item).indexOf(accion) === -1) {
      return;
    }
    resolver(item, accion === 'APROBAR_SUGERENCIA' ? 'APROBAR' : 'RECHAZAR', btn);
  });

  els.reintentar.addEventListener('click', function () { cargarCola(); });
  els.cerrar.addEventListener('click', function () { ubicacionSugerenciasController_cerrar(); });
  els.cerrarAbajo.addEventListener('click', function () { ubicacionSugerenciasController_cerrar(); });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      ubicacionSugerenciasController_cerrar();
    }
  });
  // Tocar el indicador abre la cola (que vuelve a comprobar el permiso).
  badgeEl.addEventListener('click', function () { ubicacionSugerenciasController_abrir(badgeEl); });

  window.ubicacionSugerenciasController_inicializar = ubicacionSugerenciasController_inicializar;
  window.ubicacionSugerenciasController_refrescar = ubicacionSugerenciasController_refrescar;
  window.ubicacionSugerenciasController_abrir = ubicacionSugerenciasController_abrir;
  window.ubicacionSugerenciasController_cerrar = ubicacionSugerenciasController_cerrar;
  window.ubicacionSugerenciasController_reset = ubicacionSugerenciasController_reset;
})();
