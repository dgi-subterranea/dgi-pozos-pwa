// Controlador DOM de las correcciones de ubicacion (ficha individual del pozo): seccion "Ubicacion corregida" dentro del modulo Ubicacion,
// y el modal "Corregir ubicacion" (GPS o punto en el mapa). Toca DOM, geolocation, Leaflet y red, asi que no se testea con Jest (igual que
// js/reemplazo.js / js/cercaMio.js); toda la logica pura -reglas, payload, clientRequestId, flujo de guardado, HTML de la seccion- vive en
// js/ubicacionCorreccionLogic.js (con tests).
//
// - La coordenada de Irrigacion es inmutable: este modulo solo la MUESTRA (en la ficha, en el modal y como marcador fijo en el mapa).
// - Del cliente solo salen los campos de ubicacionCorreccionLogic_construirPayload (via apiProponerCorreccionUbicacion). El estado final
//   lo informa el backend (data.correccion.estado); despues de guardar SIEMPRE se relee getCorreccionesUbicacionPozo y se pinta desde esa lectura.
// - El boton "Corregir ubicacion" solo existe con ubicacion=SI y ubicacion_corregir=SI exactamente verdaderos (el backend valida igual).
// - app.js es el unico dueño de sessionToken/permisos: los pasa frescos con obtenerContexto() -> {sessionToken, permisos, onSessionExpired}.
(function () {
  var estado = {
    obtenerContexto: null,
    aperturaId: 0,           // descarta respuestas tardias de una apertura anterior
    wellId: null,
    irrigacion: null,        // {lat, lon} oficial (corroborada/unica) o null
    lectura: null,           // ultima lectura de getCorreccionesUbicacionPozo {vigente, pendientes, historial}
    aviso: null,             // {tipo, texto, recargar?} sobre el ultimo guardado
    guardando: false,
    flujo: null,
    modal: null,             // estado del modal abierto (ver nuevoModal)
    mapa: { mapa: null, capasBase: null, capaBaseActual: null, capasFijas: null, marcador: null, dispositivo: null }
  };

  var $ = function (id) { return document.getElementById(id); };
  var overlayEl = $('ucorr-overlay');
  var irrigacionEl = $('ucorr-irrigacion');
  var vistasEls = {
    opciones: $('ucorr-vista-opciones'), gps: $('ucorr-vista-gps'), mapa: $('ucorr-vista-mapa'), confirmar: $('ucorr-vista-confirmar')
  };
  var gpsEls = {
    cargando: $('ucorr-gps-cargando'), resultado: $('ucorr-gps-resultado'), coord: $('ucorr-gps-coord'), precision: $('ucorr-gps-precision'),
    mensaje: $('ucorr-gps-mensaje'), reintentar: $('btn-ucorr-gps-reintentar'), continuar: $('btn-ucorr-gps-continuar')
  };
  var mapaEls = {
    cargando: $('ucorr-mapa-cargando'), error: $('ucorr-mapa-error'), contenedor: $('ucorr-mapa'), coord: $('ucorr-mapa-coord'),
    distancia: $('ucorr-mapa-distancia'), usar: $('btn-ucorr-mapa-usar'), chips: Array.prototype.slice.call(document.querySelectorAll('.ucorr-capa-chip'))
  };
  var confEls = {
    resumen: $('ucorr-resumen'), distancia: $('ucorr-distancia'), advertencia: $('ucorr-advertencia-1km'), obsLabel: $('ucorr-obs-label'),
    obs: $('ucorr-observacion'), errObs: $('ucorr-err-observacion'), error: $('ucorr-error'), guardar: $('btn-ucorr-guardar'),
    volver: $('btn-ucorr-confirmar-volver'), guardando: $('ucorr-guardando')
  };
  var btnOpcionGps = $('btn-ucorr-gps');
  var btnOpcionMapa = $('btn-ucorr-mapa');
  var btnCerrar = $('btn-ucorr-cerrar');
  var abridorEl = null;       // boton que abrio el modal (para devolverle el foco)

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function contenedor() {
    return $('ubic-correcciones');
  }

  function ubicacionCorreccionController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    estado.flujo = ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: function (payload) { return apiProponerCorreccionUbicacion(contexto().sessionToken, payload); },
      leer: function (wellId) { return apiGetCorreccionesUbicacionPozo(contexto().sessionToken, wellId); },
      generarId: function () { return ubicacionCorreccionLogic_nuevoClientRequestId(); }
    });
  }

  // --- Seccion en la ficha ---

  function puedeCorregir() {
    var ctx = contexto();
    return !!ctx && ubicacionCorreccionLogic_puedeCorregir(ctx.permisos);
  }

  function pintarSeccion() {
    var cont = contenedor();
    if (!cont) {
      return;
    }
    cont.innerHTML = ubicacionCorreccionLogic_htmlSeccion(estado.lectura, { puedeCorregir: puedeCorregir(), aviso: estado.aviso });
    var abrir = $('btn-ubic-corr-abrir');
    if (abrir) {
      abrir.addEventListener('click', function () { abrirModal(abrir); });
    }
    var recargar = $('btn-ubic-corr-recargar');
    if (recargar) {
      recargar.addEventListener('click', function () { estado.aviso = null; cargarLectura(estado.aperturaId); });
    }
  }

  function pintarErrorLectura(texto) {
    var cont = contenedor();
    if (!cont) {
      return;
    }
    cont.innerHTML = '<p class="field-label">Ubicación corregida</p><p class="error-message">' + ubicacionCorreccionLogic_escapar(texto) +
      '</p><button type="button" class="button-secondary" id="btn-ucorr-reintentar-lectura">Reintentar</button>';
    $('btn-ucorr-reintentar-lectura').addEventListener('click', function () { cargarLectura(estado.aperturaId); });
  }

  function cargarLectura(aperturaId) {
    var ctx = contexto();
    var cont = contenedor();
    if (!ctx || !cont) {
      return;
    }
    cont.innerHTML = '<p class="field-label">Ubicación corregida</p>' + cargando_html('Cargando correcciones…', { tam: 'sm', fila: true });
    apiGetCorreccionesUbicacionPozo(ctx.sessionToken, estado.wellId).then(function (resp) {
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      if (resp && resp.status === 'ok') {
        estado.lectura = resp.data;
        pintarSeccion();
        return;
      }
      var code = resp && resp.code;
      if ((code === 'UNAUTHORIZED' || code === 'USER_DISABLED') && ctx.onSessionExpired) {
        ctx.onSessionExpired();
        return;
      }
      pintarErrorLectura(ubicacionCorreccionLogic_mensajeErrorLectura(code));
    }).catch(function () {
      if (aperturaId === estado.aperturaId) {
        pintarErrorLectura('No se pudieron cargar las correcciones. Revisá tu conexión e intentá de nuevo.');
      }
    });
  }

  // ap: {wellId, location} - location es la respuesta de getWellLocation (la que ya tiene la ficha).
  function ubicacionCorreccionController_abrir(ap) {
    estado.aperturaId += 1;
    estado.wellId = ap.wellId;
    estado.irrigacion = ubicacionCorreccionLogic_irrigacionDeUbicacion(ap.location);
    estado.lectura = null;
    estado.aviso = null;
    cargarLectura(estado.aperturaId);
  }

  function ubicacionCorreccionController_cerrar() {
    cerrarModal(true);
  }

  // --- Modal ---

  function nuevoModal() {
    return { vista: 'opciones', vistaPrevia: 'opciones', metodo: null, punto: null, gps: null, gpsId: 0, mapaId: 0 };
  }

  function mostrarVista(nombre) {
    Object.keys(vistasEls).forEach(function (k) { vistasEls[k].hidden = k !== nombre; });
    estado.modal.vista = nombre;
    overlayEl.scrollTop = 0;
  }

  function abrirModal(opener) {
    if (!puedeCorregir() || estado.guardando) {
      return;
    }
    abridorEl = opener || null;
    estado.modal = nuevoModal();
    var irr = estado.irrigacion;
    irrigacionEl.textContent = irr
      ? 'Ubicación de Irrigación (no se modifica): ' + ubicacionCorreccionLogic_formatearCoordenadas(irr.lat, irr.lon)
      : 'Este pozo no tiene una ubicación de Irrigación para comparar.';
    confEls.obs.value = '';
    confEls.error.hidden = true;
    mostrarVista('opciones');
    overlayEl.hidden = false;
    document.body.classList.add('ucorr-abierto');
    btnOpcionGps.focus();
  }

  function cerrarModal(forzar) {
    if (estado.guardando && !forzar) {
      return;
    }
    if (estado.modal) {
      estado.modal.gpsId += 1;           // descarta callbacks tardios del GPS / mapa
      estado.modal.mapaId += 1;
    }
    overlayEl.hidden = true;
    document.body.classList.remove('ucorr-abierto');
    if (abridorEl && document.body.contains(abridorEl) && typeof abridorEl.focus === 'function') {
      abridorEl.focus();
    }
    abridorEl = null;
  }

  // --- A. Mi ubicacion actual (GPS) ---

  function textoErrorGps(err) {
    if (err && err.code === 1) {
      return 'No tenés habilitado el acceso a la ubicación para esta página. Habilitalo en el navegador o elegí el punto en el mapa.';
    }
    if (err && err.code === 3) {
      return 'El GPS tardó demasiado en responder. Probá a cielo abierto e intentá nuevamente.';
    }
    return 'No pudimos obtener tu ubicación. Intentá nuevamente.';
  }

  function iniciarGps() {
    var m = estado.modal;
    m.metodo = 'GPS_ACTUAL';
    m.gps = null;
    m.punto = null;
    m.gpsId += 1;
    var id = m.gpsId;
    m.vistaPrevia = 'opciones';
    mostrarVista('gps');
    gpsEls.resultado.hidden = true;
    gpsEls.mensaje.hidden = true;
    gpsEls.continuar.hidden = true;
    gpsEls.reintentar.hidden = true;
    if (!navigator.geolocation) {
      gpsEls.cargando.hidden = true;
      gpsEls.mensaje.textContent = 'Este dispositivo no permite obtener la ubicación. Elegí el punto en el mapa.';
      gpsEls.mensaje.hidden = false;
      return;
    }
    gpsEls.cargando.hidden = false;
    navigator.geolocation.getCurrentPosition(function (pos) {
      if (id !== m.gpsId) {
        return;
      }
      m.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy };
      pintarResultadoGps();
    }, function (err) {
      if (id !== m.gpsId) {
        return;
      }
      gpsEls.cargando.hidden = true;
      gpsEls.mensaje.textContent = textoErrorGps(err);
      gpsEls.mensaje.hidden = false;
      gpsEls.reintentar.hidden = false;
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  function pintarResultadoGps() {
    var g = estado.modal.gps;
    var ev = ubicacionCorreccionLogic_evaluarGps(g.accuracy);
    gpsEls.cargando.hidden = true;
    gpsEls.resultado.hidden = false;
    gpsEls.coord.textContent = ubicacionCorreccionLogic_formatearCoordenadas(g.lat, g.lon);
    gpsEls.precision.textContent = ubicacionCorreccionLogic_esNumero(g.accuracy) && g.accuracy > 0 ? '± ' + Math.round(g.accuracy) + ' m' : 'sin dato';
    gpsEls.reintentar.hidden = false;                       // medir de nuevo siempre es posible
    gpsEls.continuar.hidden = !ev.valido;                   // sin precision suficiente NO se puede guardar
    gpsEls.mensaje.hidden = ev.valido;
    gpsEls.mensaje.textContent = ev.mensaje;
  }

  // --- B. Elegir punto en el mapa ---

  function htmlMarcador(clase, texto) {
    return '<div class="ucorr-marker ' + clase + '"><span class="ucorr-marker-punto"></span><span class="ucorr-marker-texto">' + texto + '</span></div>';
  }

  // La etiqueta de la correccion vigente va ARRIBA de su punto y la de Irrigacion ABAJO: a pocos metros de distancia los dos puntos casi se
  // superponen y asi las etiquetas no se tapan entre si.
  function iconoFijo(clase, texto, etiquetaArriba) {
    return L.divIcon({
      className: 'ucorr-marker-wrap', html: htmlMarcador(clase + (etiquetaArriba ? ' ucorr-marker-arriba' : ''), texto),
      iconSize: [64, 44], iconAnchor: etiquetaArriba ? [32, 33] : [32, 11]
    });
  }

  function iniciarMapa() {
    var m = estado.modal;
    m.metodo = 'PUNTO_EN_MAPA';
    m.punto = null;
    m.mapaId += 1;
    var id = m.mapaId;
    m.vistaPrevia = 'opciones';
    mostrarVista('mapa');
    mapaEls.error.hidden = true;
    mapaEls.cargando.hidden = false;
    mapaEls.contenedor.hidden = true;
    mapaEls.usar.disabled = true;
    mapaEls.coord.textContent = 'Tocá el mapa para elegir el punto.';
    mapaEls.distancia.textContent = '';
    mapaShared_cargarLibrerias().then(function () {
      if (id !== m.mapaId) {
        return;
      }
      prepararMapa(id);
    }).catch(function () {
      if (id !== m.mapaId) {
        return;
      }
      mapaEls.cargando.hidden = true;
      mapaEls.error.hidden = false;
    });
  }

  function prepararMapa(id) {
    var mp = estado.mapa;
    mapaEls.cargando.hidden = true;
    mapaEls.contenedor.hidden = false;
    if (!mp.mapa) {
      mp.mapa = L.map('ucorr-mapa', { zoomControl: true }).setView([-34.6, -68.6], 7);
      mp.capasBase = mapaShared_crearCapasBase(mp.mapa);
      mp.capaBaseActual = MAPA_CAPA_BASE_DEFAULT;
      mp.capasFijas = L.layerGroup().addTo(mp.mapa);
      mp.mapa.on('click', function (e) { elegirPunto(e.latlng.lat, e.latlng.lng, false); });
    }
    // El punto propuesto de una apertura anterior no se arrastra a esta.
    if (mp.marcador) {
      mp.mapa.removeLayer(mp.marcador);
      mp.marcador = null;
    }
    // Marcadores FIJOS (no se mueven ni responden a toques): Irrigacion y, si hay, la correccion vigente.
    mp.capasFijas.clearLayers();
    if (estado.irrigacion) {
      L.marker([estado.irrigacion.lat, estado.irrigacion.lon], { icon: iconoFijo('ucorr-marker-irr', 'Irrigación'), interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(mp.capasFijas);
    }
    var vig = estado.lectura && estado.lectura.vigente;
    if (vig && ubicacionCorreccionLogic_esNumero(vig.lat) && ubicacionCorreccionLogic_esNumero(vig.lon)) {
      L.marker([vig.lat, vig.lon], { icon: iconoFijo('ucorr-marker-vig', 'Vigente', true), interactive: false, keyboard: false, zIndexOffset: 300 }).addTo(mp.capasFijas);
    }
    var centro = ubicacionCorreccionLogic_centroInicialMapa({ vigente: vig, irrigacion: estado.irrigacion, dispositivo: mp.dispositivo });
    mapaShared_alMostrarMapa(mp.mapa, function () {
      if (id === estado.modal.mapaId) {
        mp.mapa.setView([centro.lat, centro.lon], centro.zoom);
      }
    });
    // Sin vigente ni Irrigacion: se intenta centrar en el dispositivo (sin bloquear; si no hay permiso queda la vista general).
    if (centro.origen === 'defecto' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(function (pos) {
        mp.dispositivo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        if (id === estado.modal.mapaId && !estado.modal.punto) {
          mp.mapa.setView([mp.dispositivo.lat, mp.dispositivo.lon], 16);
        }
      }, function () {}, { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 });
    }
  }

  function elegirPunto(lat, lon, desdeArrastre) {
    var mp = estado.mapa;
    var m = estado.modal;
    if (!m || m.vista !== 'mapa') {
      return;
    }
    m.punto = { lat: lat, lon: lon };
    if (!mp.marcador) {
      mp.marcador = L.marker([lat, lon], { icon: mapaShared_iconoPuntoBusqueda(), draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(mp.mapa);
      mp.marcador.on('dragend', function () {
        var p = mp.marcador.getLatLng();
        elegirPunto(p.lat, p.lng, true);
      });
    } else if (!desdeArrastre) {
      mp.marcador.setLatLng([lat, lon]);
    }
    mapaEls.coord.textContent = ubicacionCorreccionLogic_formatearCoordenadas(lat, lon);
    var ev = ubicacionCorreccionLogic_evaluarPropuesta({ lat: lat, lon: lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: estado.irrigacion });
    mapaEls.distancia.textContent = ev.distanciaM !== null ? 'A ' + ubicacionCorreccionLogic_formatearDistancia(ev.distanciaM) + ' de la ubicación de Irrigación.' : '';
    mapaEls.usar.disabled = !m.punto;
  }

  // --- Confirmar y guardar ---

  function valoresActuales() {
    var m = estado.modal;
    var ev = m.metodo === 'GPS_ACTUAL' ? ubicacionCorreccionLogic_evaluarGps(m.gps && m.gps.accuracy) : null;
    var p = m.metodo === 'GPS_ACTUAL' ? m.gps : m.punto;
    return {
      lat: p ? p.lat : null,
      lon: p ? p.lon : null,
      metodo: m.metodo,
      precisionGpsM: ev && ev.valido ? ev.precisionM : null,
      observacion: confEls.obs.value,
      irrigacion: estado.irrigacion
    };
  }

  function abrirConfirmar(desde) {
    estado.modal.vistaPrevia = desde;
    confEls.error.hidden = true;
    mostrarVista('confirmar');
    actualizarConfirmar();
    confEls.obs.focus();
  }

  function actualizarConfirmar() {
    var v = valoresActuales();
    var ev = ubicacionCorreccionLogic_evaluarPropuesta(v);
    var texto = ubicacionCorreccionLogic_etiquetaMetodo(v.metodo) + ' · ' + ubicacionCorreccionLogic_formatearCoordenadas(v.lat, v.lon);
    if (v.metodo === 'GPS_ACTUAL' && v.precisionGpsM) {
      texto += ' (± ' + String(v.precisionGpsM).replace('.', ',') + ' m)';
    }
    confEls.resumen.textContent = texto;
    confEls.distancia.textContent = ev.distanciaM !== null ? 'A ' + ubicacionCorreccionLogic_formatearDistancia(ev.distanciaM) + ' de la ubicación de Irrigación.' : '';
    confEls.distancia.hidden = ev.distanciaM === null;
    confEls.advertencia.textContent = UCORR_TEXTO_ADVERTENCIA_1KM;
    confEls.advertencia.hidden = !ev.advertenciaFuerte;
    confEls.obsLabel.textContent = ev.observacionObligatoria ? 'Observación (obligatoria)' : 'Observación (opcional)';
    confEls.errObs.textContent = ev.errores.observacion || '';
    confEls.errObs.hidden = !ev.errores.observacion;
    confEls.guardar.disabled = !ev.ok || estado.guardando;
  }

  function ponerGuardando(si) {
    estado.guardando = si;
    confEls.guardando.hidden = !si;
    confEls.volver.disabled = si;
    confEls.obs.disabled = si;
    btnCerrar.disabled = si;
    confEls.guardar.textContent = si ? 'Guardando…' : 'Guardar corrección';
    if (si) {
      confEls.guardar.disabled = true;
    } else {
      actualizarConfirmar();
    }
  }

  function mostrarErrorGuardado(texto) {
    confEls.error.textContent = texto;
    confEls.error.hidden = false;
  }

  function onGuardar() {
    if (estado.guardando) {
      return;                                   // doble toque: el flujo tambien lo ignora, esto evita incluso el cambio de UI
    }
    var ctx = contexto();
    if (!ctx || !puedeCorregir()) {
      return;
    }
    var aperturaId = estado.aperturaId;
    confEls.error.hidden = true;
    ponerGuardando(true);
    estado.flujo.guardar(estado.wellId, valoresActuales()).then(function (r) {
      ponerGuardando(false);
      if (r.tipo === 'invalido') {
        actualizarConfirmar();
        return;
      }
      if (r.tipo === 'error') {
        if (r.sesionVencida) {
          cerrarModal(true);
          if (ctx.onSessionExpired) { ctx.onSessionExpired(); }
          return;
        }
        mostrarErrorGuardado(r.mensaje);
        return;
      }
      if (r.tipo === 'red') {
        mostrarErrorGuardado(r.mensaje);
        return;
      }
      // Guardado: se cierra el modal y se pinta DESDE LA RELECTURA del backend (nunca desde lo que se envio).
      cerrarModal(true);
      if (aperturaId !== estado.aperturaId) {
        return;
      }
      estado.aviso = { tipo: 'ok', texto: r.mensaje };
      if (r.lectura) {
        estado.lectura = r.lectura;
      } else {
        estado.aviso.texto += ' No pudimos actualizar la lista de correcciones.';
        estado.aviso.recargar = true;
      }
      pintarSeccion();
      var cont = contenedor();
      if (cont && typeof cont.scrollIntoView === 'function') {
        cont.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    });
  }

  // --- Eventos ---

  btnOpcionGps.addEventListener('click', iniciarGps);
  btnOpcionMapa.addEventListener('click', iniciarMapa);
  gpsEls.reintentar.addEventListener('click', iniciarGps);
  gpsEls.continuar.addEventListener('click', function () {
    var ev = ubicacionCorreccionLogic_evaluarGps(estado.modal.gps && estado.modal.gps.accuracy);
    if (ev.valido) {
      abrirConfirmar('gps');
    }
  });
  mapaEls.usar.addEventListener('click', function () {
    if (estado.modal.punto) {
      abrirConfirmar('mapa');
    }
  });
  $('btn-ucorr-mapa-reintentar').addEventListener('click', iniciarMapa);
  mapaEls.chips.forEach(function (chip) {
    chip.addEventListener('click', function () {
      if (estado.mapa.mapa) {
        mapaShared_cambiarCapaBase(estado.mapa, chip.getAttribute('data-capa'), mapaEls.chips);
      }
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.btn-ucorr-volver-opciones'), function (btn) {
    btn.addEventListener('click', function () {
      estado.modal.gpsId += 1;                  // un GPS en curso ya no interesa
      mostrarVista('opciones');
    });
  });
  confEls.volver.addEventListener('click', function () {
    mostrarVista(estado.modal.vistaPrevia === 'gps' ? 'gps' : 'mapa');
  });
  confEls.obs.addEventListener('input', actualizarConfirmar);
  confEls.guardar.addEventListener('click', onGuardar);
  btnCerrar.addEventListener('click', function () { cerrarModal(false); });
  overlayEl.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cerrarModal(false);
    }
  });

  window.ubicacionCorreccionController_inicializar = ubicacionCorreccionController_inicializar;
  window.ubicacionCorreccionController_abrir = ubicacionCorreccionController_abrir;
  window.ubicacionCorreccionController_cerrar = ubicacionCorreccionController_cerrar;
})();
