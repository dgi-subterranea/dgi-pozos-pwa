// Controlador DOM de las correcciones de ubicacion (ficha individual del pozo): seccion "Ubicacion corregida" dentro del modulo Ubicacion,
// y el modal "Corregir ubicacion" con sus tres formas de indicar el punto: GPS actual, punto elegido en el mapa e "Ingresar coordenadas"
// (GMS / WGS84 o POSGAR 94 / Argentina 2 · EPSG:22182). Toca DOM, geolocation, Leaflet y red, asi que no se prueba directo con Jest: los tests lo
// ejecutan con un DOM y un Leaflet simulados (js/ubicacionCorreccionController.test.js); toda la logica pura -reglas, validacion de las coordenadas
// ingresadas, payload, clientRequestId, flujo de guardado, HTML de la seccion- vive en js/ubicacionCorreccionLogic.js (con tests).
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
    registral: null,         // la ubicacion registral vigente SI cambio respecto de irrigacion ({tipo, lat, lon} | {tipo:'N'} | null); solo informativa (ver ubicacionesConocidas.js)
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
  var registralEl = $('ucorr-registral');
  var vistasEls = {
    opciones: $('ucorr-vista-opciones'), gps: $('ucorr-vista-gps'), mapa: $('ucorr-vista-mapa'), confirmar: $('ucorr-vista-confirmar')
  };
  var gpsEls = {
    cargando: $('ucorr-gps-cargando'), resultado: $('ucorr-gps-resultado'), coord: $('ucorr-gps-coord'), precision: $('ucorr-gps-precision'),
    mensaje: $('ucorr-gps-mensaje'), reintentar: $('btn-ucorr-gps-reintentar'), continuar: $('btn-ucorr-gps-continuar')
  };
  var mapaEls = {
    cargando: $('ucorr-mapa-cargando'), error: $('ucorr-mapa-error'), errorTexto: $('ucorr-mapa-error-texto'), contenedor: $('ucorr-mapa'), coord: $('ucorr-mapa-coord'),
    distancia: $('ucorr-mapa-distancia'), usar: $('btn-ucorr-mapa-usar'), instruccion: $('ucorr-mapa-instruccion'),
    chips: Array.prototype.slice.call(document.querySelectorAll('.ucorr-capa-chip'))
  };
  var confEls = {
    resumen: $('ucorr-resumen'), resumenOriginal: $('ucorr-resumen-original'), distancia: $('ucorr-distancia'), advertencia: $('ucorr-advertencia-1km'),
    obsLabel: $('ucorr-obs-label'), obs: $('ucorr-observacion'), errObs: $('ucorr-err-observacion'), error: $('ucorr-error'), guardar: $('btn-ucorr-guardar'),
    volver: $('btn-ucorr-confirmar-volver'), guardando: $('ucorr-guardando')
  };
  // Ingresar coordenadas. El selector de sistema (GMS / POSGAR) muestra un panel por sistema dentro de ucorr-coord-panel (la lista de sistemas esta en la logica:
  // UCORR_SISTEMAS_COORDENADAS). GMS: ucorr-{lat|lon}-{g|m|s|h}; POSGAR: ucorr-posgar-{x|y} (X = Este, Y = Norte).
  var coordEls = {
    panel: $('ucorr-coord-panel'), equivale: $('ucorr-coord-equivale'), equivaleValor: $('ucorr-coord-equivale-valor'),
    gms: $('ucorr-coord-gms'), posgar: $('ucorr-coord-posgar'),
    general: $('ucorr-err-general'), posgarGeneral: $('ucorr-err-posgar-general'), invertido: $('ucorr-posgar-invertido'),
    invertidoTexto: $('ucorr-posgar-invertido-texto'), intercambiar: $('btn-ucorr-posgar-intercambiar'), posgarAyuda: $('ucorr-posgar-ayuda'),
    movido: $('ucorr-coord-movido'), movidoTexto: $('ucorr-coord-movido-texto'), restaurar: $('btn-ucorr-coord-restaurar'),
    chips: { GMS: $('btn-ucorr-sistema-gms'), POSGAR: $('btn-ucorr-sistema-posgar') },
    err: { lat: $('ucorr-err-lat'), lon: $('ucorr-err-lon'), x: $('ucorr-err-x'), y: $('ucorr-err-y') },
    campos: {
      lat: { g: $('ucorr-lat-g'), m: $('ucorr-lat-m'), s: $('ucorr-lat-s'), h: $('ucorr-lat-h') },
      lon: { g: $('ucorr-lon-g'), m: $('ucorr-lon-m'), s: $('ucorr-lon-s'), h: $('ucorr-lon-h') },
      x: $('ucorr-posgar-x'), y: $('ucorr-posgar-y')
    }
  };
  var TEXTO_INSTRUCCION_MAPA = 'Tocá el mapa para elegir el nuevo punto. Después podés arrastrar el marcador.';
  var TEXTO_INSTRUCCION_COORDENADAS = 'El punto aparece en el mapa cuando la coordenada es válida. Si lo arrastrás, se guarda como punto elegido en el mapa.';
  // Los textos del aviso de punto movido, de restaurar y de la ayuda X/Y viven en la logica (una sola fuente); el HTML trae el mismo texto como respaldo.
  coordEls.movidoTexto.textContent = UCORR_TEXTO_PUNTO_MOVIDO;
  coordEls.restaurar.textContent = UCORR_TEXTO_RESTAURAR;
  coordEls.posgarAyuda.textContent = UCORR_TEXTO_AYUDA_XY;
  var btnOpcionGps = $('btn-ucorr-gps');
  var btnOpcionMapa = $('btn-ucorr-mapa');
  var btnOpcionCoord = $('btn-ucorr-coordenadas');
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

  // Quien valida (ubicacion + ubicacion_validar exactos, fail-closed): ve Validar / Rechazar en las tarjetas "Pendiente".
  function puedeValidarAhora() {
    var ctx = contexto();
    return !!ctx && ubicacionCorreccionLogic_puedeValidar(ctx.permisos);
  }

  // Validar / Rechazar en una tarjeta pendiente abre el MISMO detalle y la MISMA confirmacion que la bandeja (js/ubicacionValidacion.js): aca no hay logica de
  // validacion ni llamadas al backend. Un solo oyente en el contenedor (la seccion se vuelve a pintar entera cada vez).
  function enlazarAccionesDeValidacion(cont) {
    if (cont.ucorrAccionesEnlazadas === true) {
      return;
    }
    cont.ucorrAccionesEnlazadas = true;
    cont.addEventListener('click', function (e) {
      var t = e && e.target;
      var el = t && typeof t.closest === 'function' ? t.closest('[data-uval-accion]') : null;
      if (!el || !puedeValidarAhora() || typeof ubicacionValidacionController_abrirDetalle !== 'function') {
        return;
      }
      var id = el.getAttribute('data-uval-correccion');
      var c = ((estado.lectura && estado.lectura.pendientes) || []).filter(function (p) { return p.correccionId === id; })[0];
      if (!c) {
        return;
      }
      ubicacionValidacionController_abrirDetalle({
        correccion: c, vigente: (estado.lectura && estado.lectura.vigente) || null, accion: el.getAttribute('data-uval-accion') === 'rechazar' ? 'rechazar' : 'validar', opener: el
      });
    });
  }

  function pintarSeccion() {
    var cont = contenedor();
    if (!cont) {
      return;
    }
    enlazarAccionesDeValidacion(cont);
    cont.innerHTML = ubicacionCorreccionLogic_htmlSeccion(estado.lectura, { puedeCorregir: puedeCorregir(), puedeValidar: puedeValidarAhora(), aviso: estado.aviso });
    // "Ubicaciones conocidas" suma la correccion vigente (validada en campo) apenas se la lee; si no se pudo leer, queda solo lo del padron.
    if (typeof ubicacionesConocidasController_actualizarVigente === 'function') {
      ubicacionesConocidasController_actualizarVigente(estado.wellId, (estado.lectura && estado.lectura.vigente) || null);
    }
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
    estado.registral = null;
    estado.lectura = null;
    estado.aviso = null;
    cargarLectura(estado.aperturaId);
  }

  function ubicacionCorreccionController_cerrar() {
    cerrarModal(true);
  }

  // "Ubicaciones conocidas" informa que la ubicacion registral vigente cambio (una fuente aceptada o descartada). Solo se MUESTRA como referencia actual en el modal: la comparacion
  // de la correccion y el snapshot historico de Irrigacion (que guarda el backend) no se tocan. Una ficha que ya no es esta no hace nada.
  function pintarRegistral() {
    var texto = ubicacionCorreccionLogic_textoRegistralVigente(estado.registral);
    registralEl.textContent = texto;
    registralEl.hidden = texto === '';
  }

  function ubicacionCorreccionController_actualizarRegistral(wellId, info) {
    if (!estado.wellId || wellId !== estado.wellId) {
      return;
    }
    estado.registral = info || null;
    if (overlayEl && !overlayEl.hidden) {
      pintarRegistral();
    }
  }

  // La validacion (bandeja o tarjeta) termino sobre un pozo: si es el de esta ficha, se vuelve a leer y se pinta (pendientes, historial y vigente) con el aviso del
  // resultado; si es otro, no se toca nada. info: {wellId, mensaje, tipo ('ok' | 'resuelta')}.
  function ubicacionCorreccionController_alResolver(info) {
    if (!info || !estado.wellId || info.wellId !== estado.wellId || !contenedor()) {
      return;
    }
    estado.aviso = info.mensaje ? { tipo: info.tipo === 'ok' ? 'ok' : 'info', texto: info.mensaje } : null;
    cargarLectura(estado.aperturaId);
  }

  // --- Modal ---

  function nuevoModal() {
    // modo: que se hace en la vista del mapa ('mapa' = elegir tocando; 'coordenadas' = escribir la coordenada). coord: estado de "Ingresar coordenadas".
    return { vista: 'opciones', vistaPrevia: 'opciones', metodo: null, modo: 'mapa', coord: null, punto: null, gps: null, gpsId: 0, mapaId: 0 };
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
    pintarRegistral();
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
    m.modo = 'gps';
    m.coord = null;
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
    iniciarVistaMapa('mapa');
  }

  // La misma vista y el mismo mapa sirven para dos cosas: elegir un punto tocando ('mapa') o ver el punto que sale de la coordenada escrita ('coordenadas').
  function iniciarVistaMapa(modo) {
    var m = estado.modal;
    var coordenadas = modo === 'coordenadas';
    m.modo = modo;
    m.metodo = coordenadas ? ubicacionCorreccionLogic_sistemaPorId('GMS').metodo : 'PUNTO_EN_MAPA';
    m.punto = null;
    m.coord = coordenadas ? nuevaEntradaCoordenadas('GMS') : null;
    m.mapaId += 1;
    var id = m.mapaId;
    m.vistaPrevia = 'opciones';
    mostrarVista('mapa');
    coordEls.panel.hidden = !coordenadas;
    mapaEls.instruccion.textContent = coordenadas ? TEXTO_INSTRUCCION_COORDENADAS : TEXTO_INSTRUCCION_MAPA;
    mapaEls.usar.textContent = coordenadas ? 'Continuar' : 'Usar este punto';
    mapaEls.contenedor.classList.toggle('ucorr-mapa-corto', coordenadas);           // classList: Leaflet agrega sus propias clases al contenedor
    mapaEls.errorTexto.textContent = coordenadas
      ? 'No se pudo cargar el mapa, pero podés continuar con la coordenada ingresada.'
      : 'No se pudo cargar el mapa. Revisá tu conexión e intentá de nuevo.';
    mapaEls.error.hidden = true;
    mapaEls.cargando.hidden = false;
    mapaEls.contenedor.hidden = true;
    if (coordenadas) {
      reiniciarCamposCoordenadas();
      mostrarSistema('GMS');
      aplicarCoordenadas();
    } else {
      mapaEls.usar.disabled = true;
      mapaEls.coord.textContent = 'Tocá el mapa para elegir el punto.';
      mapaEls.distancia.textContent = '';
    }
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
      mp.mapa.on('click', function (e) { elegirPunto(e.latlng.lat, e.latlng.lng, false); });      // en "coordenadas" elegirPunto lo ignora: ahi solo se arrastra
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
      if (id !== estado.modal.mapaId) {
        return;
      }
      if (estado.modal.modo === 'coordenadas' && estado.modal.punto) {
        enmarcarPuntos(estado.modal.punto);
      } else {
        mp.mapa.setView([centro.lat, centro.lon], centro.zoom);
      }
    });
    if (estado.modal.modo === 'coordenadas') {
      aplicarCoordenadas();                  // si ya habia una coordenada valida escrita mientras cargaba el mapa, su punto aparece ahora
    }
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

  // Un unico marcador movible (el punto nuevo) para los dos modos; lo que significa arrastrarlo depende del modo.
  function asegurarMarcador(lat, lon, mover) {
    var mp = estado.mapa;
    if (!mp.mapa) {
      return;
    }
    if (!mp.marcador) {
      mp.marcador = L.marker([lat, lon], { icon: mapaShared_iconoPuntoBusqueda(), draggable: true, keyboard: false, zIndexOffset: 1000 }).addTo(mp.mapa);
      mp.marcador.on('dragend', function () {
        var p = mp.marcador.getLatLng();
        if (estado.modal && estado.modal.modo === 'coordenadas') {
          moverPuntoManual(p.lat, p.lng);
        } else {
          elegirPunto(p.lat, p.lng, true);
        }
      });
    } else if (mover) {
      mp.marcador.setLatLng([lat, lon]);
    }
  }

  function quitarMarcador() {
    var mp = estado.mapa;
    if (mp.marcador && mp.mapa) {
      mp.mapa.removeLayer(mp.marcador);
    }
    mp.marcador = null;
  }

  function textoDistancia(ev) {
    return ev.distanciaM !== null ? 'A ' + ubicacionCorreccionLogic_formatearDistancia(ev.distanciaM) + ' de la ubicación de Irrigación.' : '';
  }

  function elegirPunto(lat, lon, desdeArrastre) {
    var m = estado.modal;
    if (!m || m.vista !== 'mapa' || m.modo !== 'mapa') {
      return;
    }
    m.punto = { lat: lat, lon: lon };
    asegurarMarcador(lat, lon, !desdeArrastre);
    mapaEls.coord.textContent = ubicacionCorreccionLogic_formatearCoordenadas(lat, lon);
    var ev = ubicacionCorreccionLogic_evaluarPropuesta({ lat: lat, lon: lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: estado.irrigacion });
    mapaEls.distancia.textContent = textoDistancia(ev);
    mapaEls.usar.disabled = !m.punto;
  }

  // --- C. Ingresar coordenadas (GMS / WGS84 o POSGAR 94 / Argentina 2 · EPSG:22182) ---
  //
  // estado.modal.coord = {sistema, entrada, evaluacion, movido, manual}. Mientras los campos sean validos, el punto del modal ES la conversion exacta y el metodo es el del
  // sistema (COORDENADAS_GMS / COORDENADAS_POSGAR94_AR2, con coordenadaOriginal). Si la persona ARRASTRA el punto, el metodo pasa a PUNTO_EN_MAPA, la coordenada ingresada
  // deja de ser la fuente activa (no viaja) y se ofrece restaurarla. Escribir de nuevo en los campos retoma el control. Cambiar de sistema EMPIEZA DE CERO: nada de un
  // sistema se reutiliza en el otro.

  function nuevaEntradaCoordenadas(sistemaId) {
    var entrada = ubicacionCorreccionLogic_entradaVacia(sistemaId);
    return { sistema: sistemaId, entrada: entrada, evaluacion: ubicacionCorreccionLogic_evaluarEntrada(sistemaId, entrada), movido: false, manual: null };
  }

  function reiniciarCamposCoordenadas() {
    var vacia = ubicacionCorreccionLogic_entradaGmsVacia();
    ['lat', 'lon'].forEach(function (eje) {
      ['g', 'm', 's', 'h'].forEach(function (k) { coordEls.campos[eje][k].value = vacia[eje][k]; });
    });
    coordEls.campos.x.value = '';
    coordEls.campos.y.value = '';
  }

  // Muestra el panel del sistema activo y marca su boton del selector.
  function mostrarSistema(sistemaId) {
    coordEls.gms.hidden = sistemaId !== 'GMS';
    coordEls.posgar.hidden = sistemaId !== 'POSGAR';
    Object.keys(coordEls.chips).forEach(function (id) {
      var activo = id === sistemaId;
      coordEls.chips[id].classList.toggle('active', activo);
      coordEls.chips[id].setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
  }

  function leerEntradaCoordenadas(sistemaId) {
    if (sistemaId === 'POSGAR') {
      return { x: coordEls.campos.x.value, y: coordEls.campos.y.value };
    }
    var e = { lat: {}, lon: {} };
    ['lat', 'lon'].forEach(function (eje) {
      ['g', 'm', 's', 'h'].forEach(function (k) { e[eje][k] = coordEls.campos[eje][k].value; });
    });
    return e;
  }

  function ponerError(elemento, texto) {
    elemento.textContent = texto || '';
    elemento.hidden = !texto;
  }

  // Encuadra el punto nuevo junto con Irrigacion y la vigente (si hay), sin pasar de zoom 17.
  function enmarcarPuntos(punto) {
    var mp = estado.mapa;
    if (!mp.mapa) {
      return;
    }
    var pts = [[punto.lat, punto.lon]];
    if (estado.irrigacion) {
      pts.push([estado.irrigacion.lat, estado.irrigacion.lon]);
    }
    var vig = estado.lectura && estado.lectura.vigente;
    if (vig && ubicacionCorreccionLogic_esNumero(vig.lat) && ubicacionCorreccionLogic_esNumero(vig.lon)) {
      pts.push([vig.lat, vig.lon]);
    }
    if (pts.length === 1) {
      mp.mapa.setView(pts[0], 17);
    } else {
      // el pin sobresale ~38 px POR ENCIMA de su punta: mas margen arriba para que no quede cortado en el borde
      mp.mapa.fitBounds(pts, { maxZoom: 17, paddingTopLeft: [36, 60], paddingBottomRight: [36, 40] });
    }
  }

  // Errores en contexto del sistema activo (y limpieza total de los del otro): cada campo con error queda marcado (aria-invalid).
  function pintarErroresCoordenadas(c) {
    var ev = c.evaluacion;
    var gms = c.sistema === 'GMS';
    ['lat', 'lon'].forEach(function (eje) {
      ponerError(coordEls.err[eje], gms ? ev.errores[eje] : '');
      ['g', 'm', 's', 'h'].forEach(function (k) {
        coordEls.campos[eje][k].setAttribute('aria-invalid', gms && ev.errores[eje] && ev.campos[eje] === k ? 'true' : 'false');
      });
    });
    ['x', 'y'].forEach(function (k) {
      ponerError(coordEls.err[k], gms ? '' : ev.errores[k]);
      coordEls.campos[k].setAttribute('aria-invalid', !gms && ev.errores[k] ? 'true' : 'false');
    });
    ponerError(coordEls.general, gms ? ev.errores.general : '');
    // X/Y invertidos: mensaje claro y un boton. NUNCA se intercambian solos (solo lo hace el boton).
    var invertido = !gms && ev.invertido === true;
    coordEls.invertido.hidden = !invertido;
    coordEls.invertidoTexto.textContent = invertido ? (ev.errores.general || '') : '';
    ponerError(coordEls.posgarGeneral, !gms && !invertido ? ev.errores.general : '');
  }

  // Pinta TODO lo que depende de la coordenada escrita: errores en contexto, equivalencia WGS84, punto en el mapa, distancia, aviso de "movido" y Continuar.
  function aplicarCoordenadas() {
    var m = estado.modal;
    if (!m || m.modo !== 'coordenadas' || !m.coord) {
      return;
    }
    var c = m.coord;
    var ev = c.evaluacion;
    var sistema = ubicacionCorreccionLogic_sistemaPorId(c.sistema);
    pintarErroresCoordenadas(c);

    if (ev.estado !== 'valido') {
      // Sin propuesta valida: nada de punto, ni de conversion, ni de Guardar.
      m.punto = null;
      m.metodo = sistema.metodo;
      c.movido = false;
      c.manual = null;
      quitarMarcador();
      coordEls.equivale.hidden = true;
      coordEls.movido.hidden = true;
      mapaEls.coord.textContent = sistema.textoPendiente;
      mapaEls.distancia.textContent = '';
      mapaEls.usar.disabled = true;
      return;
    }

    var d = ev.derivado;
    coordEls.equivale.hidden = false;
    coordEls.equivaleValor.textContent = ubicacionCorreccionLogic_formatearCoordenadas(d.lat, d.lon);
    coordEls.movido.hidden = !c.movido;
    if (c.movido) {
      m.metodo = 'PUNTO_EN_MAPA';
      m.punto = { lat: c.manual.lat, lon: c.manual.lon };
    } else {
      m.metodo = sistema.metodo;
      m.punto = { lat: d.latExacta, lon: d.lonExacta };
      asegurarMarcador(d.latExacta, d.lonExacta, true);
      enmarcarPuntos(m.punto);
    }
    mapaEls.coord.textContent = ubicacionCorreccionLogic_formatearCoordenadas(m.punto.lat, m.punto.lon);
    var ep = ubicacionCorreccionLogic_evaluarPropuesta(valoresActuales());
    mapaEls.distancia.textContent = textoDistancia(ep);
    // Continuar depende SOLO de que haya un punto valido: la observacion (obligatoria a mas de 250 m) se pide recien en la vista de confirmacion.
    mapaEls.usar.disabled = !!(ep.errores.punto || ep.errores.gps);
  }

  function onEntradaCoordenadas() {
    var m = estado.modal;
    if (!m || m.modo !== 'coordenadas' || !m.coord) {
      return;
    }
    m.coord.entrada = leerEntradaCoordenadas(m.coord.sistema);
    m.coord.evaluacion = ubicacionCorreccionLogic_evaluarEntrada(m.coord.sistema, m.coord.entrada);
    m.coord.movido = false;                       // escribir de nuevo retoma el control: la conversion vuelve a ser el punto
    m.coord.manual = null;
    aplicarCoordenadas();
  }

  // Cambiar de sistema empieza de cero: se vacian los campos, se quitan errores y punto, y Continuar queda apagado hasta que el nuevo sistema tenga datos validos.
  function cambiarSistema(sistemaId) {
    var m = estado.modal;
    if (!m || m.modo !== 'coordenadas' || !m.coord || m.coord.sistema === sistemaId || !ubicacionCorreccionLogic_sistemaPorId(sistemaId)) {
      return;
    }
    reiniciarCamposCoordenadas();
    m.coord = nuevaEntradaCoordenadas(sistemaId);
    mostrarSistema(sistemaId);
    aplicarCoordenadas();
  }

  // "Intercambiar X e Y": SOLO al tocarlo (y solo si el modulo detecto la inversion) se intercambian los textos tal cual y se vuelve a validar y a convertir.
  function intercambiarXY() {
    var m = estado.modal;
    var c = m && m.coord;
    if (!c || c.sistema !== 'POSGAR' || c.evaluacion.invertido !== true) {
      return;
    }
    var nueva = ubicacionCorreccionLogic_intercambiarXY(leerEntradaCoordenadas('POSGAR'));
    coordEls.campos.x.value = nueva.x;
    coordEls.campos.y.value = nueva.y;
    onEntradaCoordenadas();
  }

  // El usuario arrastro el punto convertido: ya no es la conversion -> metodo PUNTO_EN_MAPA y la coordenada ingresada deja de ser fuente activa.
  function moverPuntoManual(lat, lon) {
    var m = estado.modal;
    var c = m && m.coord;
    if (!c || c.evaluacion.estado !== 'valido') {
      return;
    }
    var d = c.evaluacion.derivado;
    if (Math.abs(lat - d.latExacta) <= UCORR_COORD_COINCIDE_GRADOS && Math.abs(lon - d.lonExacta) <= UCORR_COORD_COINCIDE_GRADOS) {
      return;                                     // lo solto en el mismo lugar: sigue siendo la conversion
    }
    c.movido = true;
    c.manual = { lat: lat, lon: lon };
    aplicarCoordenadas();
  }

  function restaurarCoordenadaIngresada() {
    var m = estado.modal;
    var c = m && m.coord;
    if (!c || !c.movido || c.evaluacion.estado !== 'valido') {
      return;
    }
    c.movido = false;
    c.manual = null;
    aplicarCoordenadas();                         // vuelve EXACTAMENTE a la conversion (setLatLng con latExacta / lonExacta), al metodo del sistema y con los campos intactos
  }

  // --- Confirmar y guardar ---

  function valoresActuales() {
    var m = estado.modal;
    var ev = m.metodo === 'GPS_ACTUAL' ? ubicacionCorreccionLogic_evaluarGps(m.gps && m.gps.accuracy) : null;
    var p = m.metodo === 'GPS_ACTUAL' ? m.gps : m.punto;
    var valores = {
      lat: p ? p.lat : null,
      lon: p ? p.lon : null,
      metodo: m.metodo,
      precisionGpsM: ev && ev.valido ? ev.precisionM : null,
      observacion: confEls.obs.value,
      irrigacion: estado.irrigacion
    };
    // Solo mientras el punto ES la conversion de lo ingresado viaja coordenadaOriginal; arrastrado = PUNTO_EN_MAPA y la coordenada ingresada se descarta.
    if (ubicacionCorreccionLogic_sistemaPorMetodo(m.metodo) && m.coord && m.coord.evaluacion.estado === 'valido') {
      valores.coordenadaOriginal = m.coord.evaluacion.original;
    }
    return valores;
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
    var sistema = ubicacionCorreccionLogic_sistemaPorMetodo(v.metodo);
    var textoOriginal = sistema && estado.modal.coord ? estado.modal.coord.evaluacion.textoOriginal : '';
    confEls.resumenOriginal.textContent = textoOriginal ? 'Coordenada ingresada: ' + textoOriginal + ' (' + sistema.etiquetaLarga + ')' : '';
    confEls.resumenOriginal.hidden = !textoOriginal;
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
      // Una correccion directa (corregir + validar) queda VIGENTE de inmediato: el mapa tiene que volver a pedir la capa de campo (V); las decisiones registrales no cambian.
      if (r.resultado === 'validada' && typeof mapaDataset_invalidarDeltaCampo === 'function') {
        mapaDataset_invalidarDeltaCampo();
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
  btnOpcionCoord.addEventListener('click', function () { iniciarVistaMapa('coordenadas'); });
  ['lat', 'lon'].forEach(function (eje) {
    ['g', 'm', 's'].forEach(function (k) { coordEls.campos[eje][k].addEventListener('input', onEntradaCoordenadas); });
    coordEls.campos[eje].h.addEventListener('change', onEntradaCoordenadas);
  });
  ['x', 'y'].forEach(function (k) { coordEls.campos[k].addEventListener('input', onEntradaCoordenadas); });
  Object.keys(coordEls.chips).forEach(function (id) {
    coordEls.chips[id].addEventListener('click', function () { cambiarSistema(id); });
  });
  coordEls.intercambiar.addEventListener('click', intercambiarXY);
  coordEls.restaurar.addEventListener('click', restaurarCoordenadaIngresada);
  gpsEls.reintentar.addEventListener('click', iniciarGps);
  gpsEls.continuar.addEventListener('click', function () {
    var ev = ubicacionCorreccionLogic_evaluarGps(estado.modal.gps && estado.modal.gps.accuracy);
    if (ev.valido) {
      abrirConfirmar('gps');
    }
  });
  mapaEls.usar.addEventListener('click', function () {
    if (estado.modal.punto && !mapaEls.usar.disabled) {
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
  window.ubicacionCorreccionController_alResolver = ubicacionCorreccionController_alResolver;
  window.ubicacionCorreccionController_actualizarRegistral = ubicacionCorreccionController_actualizarRegistral;
})();
