// Controlador DOM de la pantalla "Observaciones" del pozo (E5-4, solo LECTURA: sin alta ni anulacion todavia). Toda la logica -permisos fail-closed, normalizacion de la respuesta,
// paginacion, descarte de respuestas viejas, mensajes- vive en js/observacionesPozoLogic.js (con tests); aca solo se pinta.
//
// API (ver window.observacionesPozoController_* al final):
//   _inicializar(obtenerContexto)  obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir(wellId)                 pide la PRIMERA pagina (siempre fresca: no hay cache) y pinta
//   _cerrar() / _reset()           salir de la pantalla / cerrar sesion: se descartan las respuestas en vuelo
//
// Se llama a getObservacionesPozo SOLO al abrir esta pantalla (nunca desde el hub ni en la busqueda). Privacidad: todo texto que viene de datos (observacion, nombre, motivo, categoria)
// se pone con textContent -jamas como HTML- y nunca se escribe en console, URL ni storage. Los saltos de linea y las palabras largas se resuelven por CSS (white-space: pre-wrap,
// overflow-wrap).
(function () {
  function $(id) { return document.getElementById(id); }
  var entidadEl = $('observaciones-entidad');
  var cargandoEl = $('observaciones-cargando');
  var errorEl = $('observaciones-error');
  var errorTextoEl = $('observaciones-error-texto');
  var btnReintentarEl = $('btn-observaciones-reintentar');
  var contenidoEl = $('observaciones-contenido');
  var vacioEl = $('observaciones-vacio');
  var listaEl = $('observaciones-lista');
  var errorMasEl = $('observaciones-error-mas');
  var btnMasEl = $('btn-observaciones-mas');

  var cargador = null;

  function nodo(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) { n.className = clase; }
    if (texto !== undefined && texto !== null) { n.textContent = texto; }
    return n;
  }

  // "Ana · 20/10/2026 12:00" (la fecha puede faltar en una anulada)
  function lineaMeta(prefijo, nombre, fecha) {
    var partes = [prefijo + nombre];
    if (fecha) { partes.push(fecha); }
    return nodo('p', 'obs-meta', partes.join(' · '));
  }

  function itemActiva(v, li) {
    li.appendChild(nodo('p', 'obs-texto', v.texto));
    li.appendChild(lineaMeta('', v.nombre, v.fecha));
    if (v.categoria) { li.appendChild(nodo('p', 'obs-categoria', v.categoria)); }
  }

  // Anulada: una anulacion DELIBERADA (no un error). Si el backend mando el texto original (moderacion) se muestra subordinado; si mando null, no se intenta recuperar ni se dice nada de el.
  function itemAnulada(v, li) {
    li.appendChild(nodo('p', 'obs-anulada-titulo', 'Observación anulada'));
    if (v.texto !== null) {
      li.appendChild(nodo('p', 'obs-texto obs-texto-original', v.texto));
      li.appendChild(lineaMeta('Escrita por ', v.nombre, v.fecha));
    } else if (v.fecha) {
      li.appendChild(lineaMeta('Escrita por ', v.nombre, v.fecha));
    }
    li.appendChild(lineaMeta('Anulada por ', v.anulacion.nombre, v.anulacion.fecha));
    if (v.anulacion.motivo !== null) {
      li.appendChild(nodo('p', 'obs-motivo', 'Motivo: ' + v.anulacion.motivo));
    }
  }

  function renderItem(v) {
    var li = nodo('li', v.estado === 'ANULADA' ? 'obs-item obs-item-anulada' : 'obs-item');
    if (v.estado === 'ANULADA') { itemAnulada(v, li); } else { itemActiva(v, li); }
    return li;
  }

  function pintar(estado) {
    cargandoEl.hidden = estado.fase !== 'cargando';
    errorEl.hidden = estado.fase !== 'error';
    errorTextoEl.textContent = estado.fase === 'error' ? estado.error : '';
    // sin acceso o con la sesion vencida reintentar no sirve de nada
    btnReintentarEl.hidden = estado.fase !== 'error' || estado.errorCode === 'PERMISSION_DENIED' || estado.errorCode === 'UNAUTHORIZED' || estado.errorCode === 'USER_DISABLED';
    var listo = estado.fase === 'listo';
    contenidoEl.hidden = !listo;
    listaEl.textContent = '';
    if (!listo) {
      return;
    }
    estado.items.forEach(function (v) { listaEl.appendChild(renderItem(v)); });
    vacioEl.hidden = !(estado.total === 0 && estado.items.length === 0);
    errorMasEl.textContent = estado.errorMas;
    errorMasEl.hidden = estado.errorMas === '';
    btnMasEl.hidden = !estado.hayMas;
    btnMasEl.disabled = estado.cargandoMas;
    btnMasEl.textContent = estado.cargandoMas ? 'Cargando…' : 'Ver observaciones anteriores';
  }

  function observacionesPozoController_inicializar(obtenerContexto) {
    cargador = observacionesPozoLogic_crearCargador({
      obtenerContexto: obtenerContexto,
      consultar: function (sessionToken, wellId, limit, antes) { return apiGetObservacionesPozo(sessionToken, wellId, limit, antes); },
      onCambio: pintar,
      onSesionExpirada: function () {
        var ctx = obtenerContexto() || {};
        if (typeof ctx.onSessionExpired === 'function') { ctx.onSessionExpired(); }
      }
    });
  }

  function observacionesPozoController_abrir(wellId) {
    if (!cargador) { return Promise.resolve(null); }
    entidadEl.textContent = typeof wellId === 'string' ? wellId : '';
    return cargador.abrir(wellId);
  }

  function observacionesPozoController_cerrar() {
    if (cargador) { cargador.cerrar(); }
    pintar(observacionesPozoLogic_estadoInicial());
  }

  window.observacionesPozoController_inicializar = observacionesPozoController_inicializar;
  window.observacionesPozoController_abrir = observacionesPozoController_abrir;
  window.observacionesPozoController_cerrar = observacionesPozoController_cerrar;
  window.observacionesPozoController_reset = observacionesPozoController_cerrar;

  btnMasEl.addEventListener('click', function () {
    if (cargador) { cargador.cargarMas(); }
  });
  btnReintentarEl.addEventListener('click', function () {
    if (cargador) { cargador.reintentar(); }
  });
})();
