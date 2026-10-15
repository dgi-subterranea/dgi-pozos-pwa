// Controlador DOM de "Ubicaciones conocidas" (ficha del pozo, modulo Ubicacion): pinta la seccion con cada fuente por separado y abre el visor comparativo
// ("Ver todas en el mapa"), un mapa SOLO DE LECTURA con todas las coordenadas conocidas del pozo. Toca DOM y Leaflet, asi que no se prueba directo con Jest: los
// tests lo ejecutan con un DOM y un Leaflet simulados (js/ubicacionesConocidasController.test.js); toda la logica pura -fuentes, punto operativo, distancias,
// enlaces y HTML- vive en js/ubicacionesConocidasLogic.js (con tests).
//
// - NUNCA modifica ni borra una coordenada. Lee lo que la ficha ya tiene (getWellLocation), la correccion vigente que ya leyo js/ubicacionCorreccion.js (que la entrega
//   con ubicacionesConocidasController_actualizarVigente) y el estado de cada fuente registral (getDecisionesFuentesPozo: Sin revisar / Aceptada / Descartada).
// - Quien tiene ubicacion + ubicacion_validar ve las acciones Aceptar / Descartar / Quitar aceptacion / Restaurar en cada tarjeta Y en el popup del visor. Las dos
//   superficies usan las mismas funciones (js/ubicacionFuenteDecisionesUiLogic.js) y el mismo dialogo (js/ubicacionFuenteDecisionesUi.js). "Validada en campo" nunca
//   tiene acciones (es de UbicacionCorrecciones). Quien no valida solo ve el estado.
// - SUGERENCIAS: quien tiene ubicacion pero NO ubicacion_validar ve, en lugar de las decisiones, los botones «Sugerir aceptar / descartar / restaurar» (segun el estado de la fuente), el
//   estado de SUS sugerencias (pendiente, aprobada, rechazada con su motivo, cancelada, ya no aplicable) y «Cancelar sugerencia» mientras este pendiente. Una sugerencia no cambia nada:
//   solo la aprueba un validador (cola de js/ubicacionSugerencias.js). El validador NUNCA ve botones «Sugerir»: decide directo y ve un aviso de las sugerencias pendientes.
// - Tras decidir se pinta la vista actualizada que devuelve el backend; si otro usuario cambio algo, se relee y se avisa (no se repite la decision sola).
// - app.js es el unico dueño de sessionToken/permisos: los pasa frescos con obtenerContexto().
// - Los enlaces a Google Maps llevan solo latitud y longitud (ver ubicacionesConocidasLogic_urlGoogleMaps).
(function () {
  var estado = {
    aperturaId: 0,       // descarta respuestas tardias de una ficha anterior
    wellId: null,
    location: null,
    vigente: null,
    modelo: null,
    iconoMaps: '',
    obtenerContexto: null,
    decisiones: null,    // ultima vista de getDecisionesFuentesPozo (o null si no se pudo leer: sin estados ni acciones)
    sugerencias: null,   // data.sugerencias de getSugerenciasFuentesPozo (quien no valida: las suyas; el validador: las pendientes) o null si no se pudo leer
    aviso: null,         // {tipo:'ok'|'aviso', texto} sobre la ultima decision
    fuenteEnFoco: null,  // fuente cuyo popup se uso por ultima vez (se reabre despues de refrescar el visor)
    visorId: 0,
    mapa: { mapa: null, capasBase: null, capaBaseActual: null, capas: null, marcadores: {} }
  };

  var $ = function (id) { return document.getElementById(id); };
  var overlayEl = $('ucon-overlay');
  var tituloEl = $('ucon-titulo');
  var btnCerrar = $('btn-ucon-cerrar');
  var btnCerrarAbajo = $('btn-ucon-cerrar-abajo');
  var mapaEls = {
    cargando: $('ucon-mapa-cargando'), error: $('ucon-mapa-error'), contenedor: $('ucon-mapa'), leyenda: $('ucon-leyenda'),
    nota: $('ucon-visor-nota'), chips: Array.prototype.slice.call(document.querySelectorAll('.ucon-capa-chip'))
  };
  var abridorEl = null;

  function contenedor() {
    return $('ubic-conocidas');
  }

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  // Rol del usuario para las decisiones (null sin permiso de ubicacion). Siempre desde el contexto fresco de app.js.
  function rol() {
    var ctx = contexto();
    return ctx && typeof ufdui_rol === 'function' ? ufdui_rol(ctx.permisos) : null;
  }

  function recalcular() {
    estado.modelo = ubicacionesConocidasLogic_construir({ wellId: estado.wellId, location: estado.location, vigente: estado.vigente });
    if (typeof ufdui_aplicarDecisiones === 'function') {
      ufdui_aplicarDecisiones(estado.modelo, estado.decisiones, !!estado.vigente);
    }
    if (typeof ufdui_aplicarSugerencias === 'function') {
      ufdui_aplicarSugerencias(estado.modelo, estado.sugerencias);
    }
  }

  function opcionesHtml() {
    return { iconoMaps: estado.iconoMaps, rol: rol(), aviso: estado.aviso };
  }

  function ubicacionesConocidasController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    if (typeof ubicacionFuenteDecisionesUi_inicializar === 'function') {
      ubicacionFuenteDecisionesUi_inicializar(obtenerContexto);
    }
  }

  // Lee el estado de las fuentes (solo con permiso de ubicacion; el backend lo vuelve a exigir). Si falla, la seccion sigue como antes: sin estados ni acciones.
  function cargarDecisiones(ap) {
    var ctx = contexto();
    if (!ctx || !ctx.sessionToken || !ctx.permisos || ctx.permisos.ubicacion !== true || typeof apiGetDecisionesFuentesPozo !== 'function' || !estado.wellId) {
      return Promise.resolve();
    }
    var wellId = estado.wellId;
    return Promise.resolve().then(function () { return apiGetDecisionesFuentesPozo(ctx.sessionToken, wellId); }).then(function (r) {
      if (ap !== estado.aperturaId) {
        return;
      }
      if (r && r.status === 'ok' && ufdui_vistaValida(r.data, wellId)) {
        estado.decisiones = r.data;
        repintar(true);
      }
    }, function () { /* sin red: la seccion queda sin estados ni acciones */ });
  }

  // Las sugerencias del pozo (solo con permiso de ubicacion; el backend lo vuelve a exigir). Si falla, la ficha queda como antes (sin estado de sugerencias).
  function cargarSugerencias(ap) {
    var ctx = contexto();
    if (!ctx || !ctx.sessionToken || !ctx.permisos || ctx.permisos.ubicacion !== true || typeof apiGetSugerenciasFuentesPozo !== 'function' || !estado.wellId) {
      return Promise.resolve();
    }
    var wellId = estado.wellId;
    return Promise.resolve().then(function () { return apiGetSugerenciasFuentesPozo(ctx.sessionToken, wellId); }).then(function (r) {
      if (ap !== estado.aperturaId) {
        return;
      }
      if (r && r.status === 'ok' && r.data && r.data.wellId === wellId && Array.isArray(r.data.sugerencias)) {
        estado.sugerencias = r.data.sugerencias;
        repintar(true);
      }
    }, function () { /* sin red: la ficha queda sin el estado de las sugerencias */ });
  }

  // La cola de sugerencias (js/ubicacionSugerencias.js) resolvio algo de ESTE pozo: se relee todo (decisiones y sugerencias) para que tarjetas y popups queden al dia.
  function ubicacionesConocidasController_refrescar(wellId) {
    if (!estado.wellId || wellId !== estado.wellId) {
      return Promise.resolve();
    }
    return Promise.all([cargarDecisiones(estado.aperturaId), cargarSugerencias(estado.aperturaId)]);
  }

  function repintar(mantenerVista) {
    pintarSeccion();
    if (!overlayEl.hidden) {
      dibujarVisor({ mantenerVista: mantenerVista !== false });
    }
  }

  function pintarSeccion() {
    var cont = contenedor();
    if (!cont) {
      return;
    }
    recalcular();
    cont.innerHTML = ubicacionesConocidasLogic_htmlSeccion(estado.modelo, opcionesHtml());
    if (!cont.__uconAcciones && typeof cont.addEventListener === 'function') {
      cont.__uconAcciones = true;                   // un solo oyente delegado por contenedor (los botones se recrean con cada pintado)
      cont.addEventListener('click', alClickAccion);
    }
    var ver = $('btn-ucon-ver-todas');
    if (ver) {
      ver.addEventListener('click', function () { abrirVisor(ver); });
    }
  }

  // ap: {wellId, location, iconoMaps?}. location es la respuesta de getWellLocation (la que la ficha ya tiene).
  function ubicacionesConocidasController_abrir(ap) {
    estado.aperturaId += 1;
    cerrarVisor();
    estado.wellId = ap && ap.wellId ? ap.wellId : null;
    estado.location = ap && ap.location ? ap.location : null;
    estado.iconoMaps = ap && ap.iconoMaps ? ap.iconoMaps : '';
    estado.vigente = null;
    estado.decisiones = null;
    estado.sugerencias = null;
    estado.aviso = null;
    estado.fuenteEnFoco = null;
    if (typeof ubicacionFuenteDecisionesUi_cancelar === 'function') {
      ubicacionFuenteDecisionesUi_cancelar();
    }
    pintarSeccion();
    cargarDecisiones(estado.aperturaId);
    cargarSugerencias(estado.aperturaId);
  }

  // js/ubicacionCorreccion.js la llama cada vez que (re)lee las correcciones del pozo: vigente = vista VALIDADA o null. Si la ficha ya es otra, no hace nada.
  function ubicacionesConocidasController_actualizarVigente(wellId, vigente) {
    if (!estado.wellId || wellId !== estado.wellId) {
      return;
    }
    estado.vigente = vigente || null;
    repintar(true);
  }

  function ubicacionesConocidasController_cerrar() {
    estado.aperturaId += 1;                        // descarta lecturas/decisiones que vuelvan tarde
    if (typeof ubicacionFuenteDecisionesUi_cancelar === 'function') {
      ubicacionFuenteDecisionesUi_cancelar();
    }
    cerrarVisor();
  }

  // --- Decisiones (tarjeta y popup comparten TODO esto) ---

  function alClickAccion(e) {
    var t = e && e.target;
    var btn = t && typeof t.closest === 'function' ? t.closest('[data-ufd-accion]') : null;
    if (!btn || typeof ubicacionFuenteDecisionesUi_pedir !== 'function') {
      return;
    }
    var accion = btn.getAttribute('data-ufd-accion');
    var fuenteId = btn.getAttribute('data-ufd-fuente');
    var f = estado.modelo ? estado.modelo.fuentes.filter(function (x) { return x.id === fuenteId; })[0] : null;
    // se vuelve a verificar con el estado ACTUAL: un boton viejo (popup abierto, pantalla desactualizada) no puede pedir una accion que ya no corresponde
    if (!f || ufdui_accionesDeFuente(f, estado.modelo, rol()).indexOf(accion) === -1) {
      return;
    }
    if (accion === 'CANCELAR_SUGERENCIA') {
      var id = btn.getAttribute('data-ufd-sugerencia');
      var propia = f.sugerencias && f.sugerencias.pendientes.filter(function (i) { return i.sugerenciaId === id; })[0];
      if (propia) {
        cancelarSugerencia(f, propia, btn);
      }
      return;
    }
    if (!estado.decisiones) {
      return;
    }
    if (typeof UFDUI_ACCION_SUGERIDA !== 'undefined' && UFDUI_ACCION_SUGERIDA[accion]) {
      sugerir(f, accion, btn);
      return;
    }
    decidir(f, accion, btn);
  }

  function flujoSugerencias() {
    return typeof ubicacionFuenteDecisionesUi_flujoSugerencias === 'function' ? ubicacionFuenteDecisionesUi_flujoSugerencias() : null;
  }

  // Resultado de una operacion de sugerencias (sugerir / cancelar): mensaje en la ficha y relectura. NUNCA se reintenta sola.
  function alResultadoSugerencia(r, ap) {
    if (ap !== estado.aperturaId || !r || r.tipo === 'cancelado') {
      return;
    }
    if (r.tipo === 'ok') {
      estado.aviso = { tipo: 'ok', texto: r.mensaje };
    } else if (r.tipo === 'ya_pendiente' || r.tipo === 'desactualizado') {
      estado.aviso = { tipo: 'aviso', texto: r.mensaje };
    } else {
      return;
    }
    pintarSeccion();
    if (r.tipo === 'desactualizado') {
      cargarDecisiones(ap);
    }
    cargarSugerencias(ap);
  }

  function sugerir(f, accion, abridor) {
    var ap = estado.aperturaId;
    var flujo = flujoSugerencias();
    if (!flujo) {
      return;
    }
    estado.fuenteEnFoco = f.id;
    ubicacionFuenteDecisionesUi_pedir({
      accion: accion, fuente: f, visorAbierto: !overlayEl.hidden, abridor: abridor,
      ejecutar: function (motivo) { return flujo.sugerir({ wellId: estado.wellId, decision: f.decision, accion: accion, motivo: motivo, versionVista: estado.decisiones.version }); }
    }).then(function (r) { alResultadoSugerencia(r, ap); });
  }

  function cancelarSugerencia(f, item, abridor) {
    var ap = estado.aperturaId;
    var flujo = flujoSugerencias();
    if (!flujo) {
      return;
    }
    estado.fuenteEnFoco = f.id;
    ubicacionFuenteDecisionesUi_pedir({
      accion: 'CANCELAR_SUGERENCIA', fuente: f, visorAbierto: !overlayEl.hidden, abridor: abridor,
      ejecutar: function () { return flujo.cancelar({ sugerenciaId: item.sugerenciaId }); }
    }).then(function (r) { alResultadoSugerencia(r, ap); });
  }

  function decidir(f, accion, abridor) {
    var ap = estado.aperturaId;
    estado.fuenteEnFoco = f.id;
    ubicacionFuenteDecisionesUi_pedir({
      wellId: estado.wellId, fuente: f, accion: accion, version: estado.decisiones.version, hayValidadaVigente: !!estado.vigente,
      visorAbierto: !overlayEl.hidden, abridor: abridor
    }).then(function (r) {
      if (ap !== estado.aperturaId || !r || r.tipo === 'cancelado') {
        return;
      }
      if (r.tipo === 'ok') {
        estado.aviso = { tipo: 'ok', texto: r.mensaje };
        if (r.vista) {
          estado.decisiones = r.vista;
          repintar(true);
          reabrirPopup();
        } else {
          cargarDecisiones(ap);
        }
      } else if (r.tipo === 'desactualizado') {
        estado.aviso = { tipo: 'aviso', texto: r.mensaje };
        if (r.vista) {
          estado.decisiones = r.vista;
          repintar(true);
        } else {
          pintarSeccion();
          cargarDecisiones(ap);
        }
      }
    });
  }

  function reabrirPopup() {
    if (!overlayEl.hidden && estado.fuenteEnFoco) {
      enfocar(estado.fuenteEnFoco);
    }
  }

  // --- Visor comparativo (solo lectura) ---

  function abrirVisor(opener) {
    if (!estado.modelo || estado.modelo.validas === 0) {
      return;
    }
    abridorEl = opener || null;
    estado.visorId += 1;
    tituloEl.textContent = 'Ubicaciones conocidas · ' + estado.wellId;
    overlayEl.hidden = false;
    document.body.classList.add('ucorr-abierto');
    prepararMapa(estado.visorId);
  }

  function cerrarVisor() {
    if (overlayEl.hidden) {
      return;                          // nunca se toca ucorr-abierto si este visor no esta abierto (otro modal podria estarlo)
    }
    estado.visorId += 1;               // descarta un mapa que todavia se esta cargando
    overlayEl.hidden = true;
    document.body.classList.remove('ucorr-abierto');
    if (abridorEl && document.body.contains(abridorEl) && typeof abridorEl.focus === 'function') {
      abridorEl.focus();
    }
    abridorEl = null;
  }

  function htmlMarcador(clase, texto) {
    return '<div class="ucorr-marker ucon-marker ' + clase + '"><span class="ucorr-marker-punto"></span><span class="ucorr-marker-texto">' +
      ubicacionesConocidasLogic_escapar(texto) + '</span></div>';
  }

  // La etiqueta va arriba o abajo del punto (como en el mapa del modal de correccion): el operativo siempre arriba y las demas alternadas, asi las que quedan
  // muy juntas (a pocos metros) no se pisan todas. La leyenda de abajo y los popups cubren los casos en que igual se superpongan.
  function iconoDeFuente(f, arriba) {
    return L.divIcon({
      className: 'ucorr-marker-wrap', html: htmlMarcador(ubicacionesConocidasLogic_claseMarcador(f) + (arriba ? ' ucorr-marker-arriba' : ''), f.esOperativo ? f.etiqueta + ' ★' : f.etiqueta),
      iconSize: [76, 44], iconAnchor: arriba ? [38, 33] : [38, 11]
    });
  }

  function prepararMapa(vi) {
    mapaEls.error.hidden = true;
    mapaEls.cargando.hidden = false;
    mapaEls.contenedor.hidden = true;
    mapaEls.leyenda.innerHTML = ubicacionesConocidasLogic_htmlLeyenda(estado.modelo);
    mapaShared_cargarLibrerias().then(function () {
      if (vi !== estado.visorId) {
        return;
      }
      var mp = estado.mapa;
      mapaEls.cargando.hidden = true;
      mapaEls.contenedor.hidden = false;
      if (!mp.mapa) {
        mp.mapa = L.map('ucon-mapa', { zoomControl: true }).setView([-34.6, -68.6], 7);
        mp.capasBase = mapaShared_crearCapasBase(mp.mapa);
        mp.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
        mp.capas = L.layerGroup().addTo(mp.mapa);
      }
      mapaShared_alMostrarMapa(mp.mapa, function () {
        if (vi === estado.visorId) {
          dibujarVisor();
        }
      });
    }).catch(function () {
      if (vi !== estado.visorId) {
        return;
      }
      mapaEls.cargando.hidden = true;
      mapaEls.error.hidden = false;          // la lista de arriba y los enlaces a Google Maps siguen sirviendo
    });
  }

  // Un marcador por fuente valida. El operativo va arriba de todo y con aro; el resto se distingue por color y por el texto de su etiqueta.
  function dibujarVisor(opciones) {
    var mantenerVista = !!(opciones && opciones.mantenerVista);
    var mp = estado.mapa;
    if (!mp.mapa || !mp.capas || !estado.modelo) {
      return;
    }
    recalcular();
    mapaEls.leyenda.innerHTML = ubicacionesConocidasLogic_htmlLeyenda(estado.modelo);
    var textoNota = estado.aviso && estado.aviso.texto ? estado.aviso.texto : (estado.modelo.sinOperativo ? UCON_NOTA_SIN_OPERATIVO : '');
    mapaEls.nota.textContent = textoNota;
    mapaEls.nota.hidden = !textoNota;
    mp.capas.clearLayers();
    mp.marcadores = {};
    var pts = [];
    var otras = 0;
    estado.modelo.fuentes.forEach(function (f) {
      if (f.invalida) {
        return;
      }
      var arriba = f.esOperativo || otras % 2 === 1;
      if (!f.esOperativo) {
        otras += 1;
      }
      var mk = L.marker([f.lat, f.lon], { icon: iconoDeFuente(f, arriba), keyboard: true, title: f.etiqueta, zIndexOffset: f.esOperativo ? 1000 : 300 });
      if (typeof mk.bindPopup === 'function') {
        mk.bindPopup(ubicacionesConocidasLogic_htmlPopup(f, { modelo: estado.modelo, rol: rol() }), { maxWidth: 260 });
      }
      mk.addTo(mp.capas);
      mp.marcadores[f.id] = mk;
      pts.push([f.lat, f.lon]);
    });
    if (mantenerVista) {
      return;                                     // refresco tras una decision: no se mueve el mapa
    }
    if (pts.length === 1) {
      mp.mapa.setView(pts[0], 17);
    } else if (pts.length > 1) {
      mp.mapa.fitBounds(pts, { maxZoom: 18, paddingTopLeft: [40, 50], paddingBottomRight: [40, 40] });
    }
  }

  function enfocar(id) {
    var mp = estado.mapa;
    var mk = mp.marcadores[id];
    if (!mk || !mp.mapa) {
      return;
    }
    if (typeof mp.mapa.panTo === 'function' && mk.getLatLng) {
      mp.mapa.panTo(mk.getLatLng());
    }
    if (typeof mk.openPopup === 'function') {
      mk.openPopup();
    }
  }

  // Los botones del popup viven dentro del contenedor del mapa: un oyente delegado alcanza (el popup se recrea con cada marcador).
  mapaEls.contenedor.addEventListener('click', alClickAccion);
  mapaEls.leyenda.addEventListener('click', function (e) {
    var t = e && e.target;
    var fila = t && typeof t.closest === 'function' ? t.closest('[data-ucon-foco]') : null;
    if (fila) {
      enfocar(fila.getAttribute('data-ucon-foco'));
    }
  });
  mapaEls.chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (estado.mapa.mapa) {
        mapaShared_cambiarCapaBase(estado.mapa, chip.getAttribute('data-capa'), mapaEls.chips);
      }
    });
  });
  btnCerrar.addEventListener('click', function () { cerrarVisor(); });
  btnCerrarAbajo.addEventListener('click', function () { cerrarVisor(); });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cerrarVisor();
    }
  });

  window.ubicacionesConocidasController_inicializar = ubicacionesConocidasController_inicializar;
  window.ubicacionesConocidasController_abrir = ubicacionesConocidasController_abrir;
  window.ubicacionesConocidasController_actualizarVigente = ubicacionesConocidasController_actualizarVigente;
  window.ubicacionesConocidasController_cerrar = ubicacionesConocidasController_cerrar;
  window.ubicacionesConocidasController_refrescar = ubicacionesConocidasController_refrescar;
})();
