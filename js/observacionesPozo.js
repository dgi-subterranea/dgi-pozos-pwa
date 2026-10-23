// Controlador DOM de la pantalla "Observaciones" del pozo (E5-4 lectura + E5-5 alta; la anulacion llega en E5-6). Toda la logica -permisos fail-closed, normalizacion de la respuesta,
// paginacion, formulario de alta, clientRequestId por intencion, descarte de respuestas viejas, mensajes- vive en js/observacionesPozoLogic.js (con tests); aca solo se pinta.
//
// API (ver window.observacionesPozoController_* al final):
//   _inicializar(obtenerContexto)  obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir(wellId)                 pide la PRIMERA pagina (siempre fresca: no hay cache) y pinta
//   _cerrar() / _reset()           salir de la pantalla / cerrar sesion: se descartan las respuestas en vuelo y se cierra el formulario
//
// Se llama a getObservacionesPozo SOLO al abrir esta pantalla (nunca desde el hub ni en la busqueda). El boton "Agregar observacion" aparece SOLO con observaciones === true Y
// observaciones_agregar === true (el backend vuelve a validar). Privacidad: todo texto que viene de datos o del usuario (observacion, nombre, motivo, categoria) se pone con textContent /
// .value -jamas como HTML- y nunca se escribe en console, URL ni storage. Los saltos de linea y las palabras largas se resuelven por CSS (white-space: pre-wrap, overflow-wrap).
(function () {
  function $(id) { return document.getElementById(id); }
  var entidadEl = $('observaciones-entidad');
  var cargandoEl = $('observaciones-cargando');
  var errorEl = $('observaciones-error');
  var errorTextoEl = $('observaciones-error-texto');
  var btnReintentarEl = $('btn-observaciones-reintentar');
  var contenidoEl = $('observaciones-contenido');
  var accionesEl = $('observaciones-acciones');
  var btnAgregarEl = $('btn-observaciones-agregar');
  var exitoEl = $('observaciones-exito');
  var vacioEl = $('observaciones-vacio');
  var listaEl = $('observaciones-lista');
  var errorMasEl = $('observaciones-error-mas');
  var btnMasEl = $('btn-observaciones-mas');
  // formulario "Agregar observacion"
  var overlayEl = $('observaciones-form-overlay');
  var formEl = $('observaciones-form');
  var textoEl = $('observaciones-form-texto');
  var contadorEl = $('observaciones-form-contador');
  var formErrorEl = $('observaciones-form-error');
  var btnCerrarFormEl = $('btn-observaciones-form-cerrar');
  var btnCancelarEl = $('btn-observaciones-form-cancelar');
  var btnGuardarEl = $('btn-observaciones-form-guardar');

  var cargador = null;
  var formulario = null;
  var obtenerContexto = null;
  var textoExito = '';
  var formAbierto = false;

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

  function puedeAgregar() {
    var ctx = obtenerContexto ? obtenerContexto() || {} : {};
    return observacionesPozoLogic_puedeAgregar(ctx.permisos);
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
    accionesEl.hidden = !(listo && puedeAgregar());
    exitoEl.textContent = listo ? textoExito : '';
    exitoEl.hidden = !listo || textoExito === '';
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

  // --- Formulario "Agregar observacion" ---
  function pintarFormulario(e) {
    var estabaAbierto = formAbierto;
    formAbierto = e.abierto;
    overlayEl.hidden = !e.abierto;
    document.body.classList.toggle('obs-form-abierto', e.abierto);
    if (!e.abierto) {
      textoEl.value = '';
      formErrorEl.textContent = '';
      formErrorEl.hidden = true;
      if (estabaAbierto && btnAgregarEl && !btnAgregarEl.hidden && typeof btnAgregarEl.focus === 'function') {
        btnAgregarEl.focus();                 // al cerrar el foco vuelve al boton que lo abrio
      }
      return;
    }
    if (textoEl.value !== e.texto) { textoEl.value = e.texto; }           // solo si cambia (no mover el cursor mientras se escribe)
    contadorEl.textContent = e.contador;
    contadorEl.className = e.excede ? 'obs-form-contador obs-form-contador-excede' : 'obs-form-contador';
    btnGuardarEl.disabled = !e.puedeGuardar;
    btnGuardarEl.textContent = e.enviando ? 'Guardando…' : 'Guardar';
    btnCancelarEl.disabled = e.enviando;
    btnCerrarFormEl.disabled = e.enviando;
    textoEl.readOnly = e.enviando;
    var errorTexto = !!e.error && e.error.campo === 'texto';
    textoEl.setAttribute('aria-invalid', errorTexto || e.excede ? 'true' : 'false');
    formErrorEl.textContent = e.error ? e.error.mensaje : '';
    formErrorEl.hidden = !e.error;
  }

  function abrirFormulario() {
    if (!cargador || !formulario) { return; }                      // el permiso lo exige formulario.abrir (puedeAgregar)
    var wellId = cargador.estado().wellId;
    textoExito = '';
    exitoEl.hidden = true;
    if (formulario.abrir(wellId)) {
      textoEl.focus();
    }
  }

  function guardar() {
    if (!formulario) { return; }
    formulario.guardar().then(function (e) {
      if (!e.abierto) { return; }
      if (e.error && e.error.campo === 'texto') { textoEl.focus(); } else if (e.error) { formErrorEl.focus(); }
    });
  }

  function enfocables() {
    return [btnCerrarFormEl, textoEl, btnCancelarEl, btnGuardarEl].filter(function (el) { return !el.disabled; });
  }

  function onTeclaFormulario(ev) {
    if (ev.key === 'Escape') {
      if (formulario) { formulario.cancelar(); }
      return;
    }
    if (ev.key === 'Tab') {                   // el foco no se escapa del modal
      var lista = enfocables();
      var actual = lista.indexOf(document.activeElement);
      var siguiente = observacionesPozoLogic_siguienteFoco(lista.length, actual, ev.shiftKey === true);
      if (siguiente >= 0) {
        ev.preventDefault();
        lista[siguiente].focus();
      }
    }
  }

  function observacionesPozoController_inicializar(ctxFn) {
    obtenerContexto = ctxFn;
    cargador = observacionesPozoLogic_crearCargador({
      obtenerContexto: ctxFn,
      consultar: function (sessionToken, wellId, limit, antes) { return apiGetObservacionesPozo(sessionToken, wellId, limit, antes); },
      onCambio: pintar,
      onSesionExpirada: function () {
        var ctx = ctxFn() || {};
        if (typeof ctx.onSessionExpired === 'function') { ctx.onSessionExpired(); }
      }
    });
    formulario = observacionesPozoLogic_crearFormulario({
      obtenerContexto: ctxFn,
      enviar: function (sessionToken, wellId, texto, clientRequestId) { return apiAgregarObservacionPozo(sessionToken, wellId, texto, clientRequestId); },
      onCambio: pintarFormulario,
      // la observacion devuelta entra arriba de la lista ya cargada (sin recargar); duplicada=true tambien es exito
      onExito: function (vista, duplicada, wellId) {
        textoExito = OBSERVACIONES_POZO_MENSAJE_EXITO;
        cargador.agregarNueva(vista, wellId);
        exitoEl.textContent = textoExito;                                  // tambien si la observacion ya estaba en la lista (no se repinta)
        exitoEl.hidden = false;
      },
      onSesionExpirada: function () {
        var ctx = ctxFn() || {};
        if (typeof ctx.onSessionExpired === 'function') { ctx.onSessionExpired(); }
      }
    });
  }

  function observacionesPozoController_abrir(wellId) {
    if (!cargador) { return Promise.resolve(null); }
    formulario.cerrar();
    pintarFormulario(formulario.estado());
    textoExito = '';
    entidadEl.textContent = typeof wellId === 'string' ? wellId : '';
    return cargador.abrir(wellId);
  }

  function observacionesPozoController_cerrar() {
    if (formulario) {
      formulario.cerrar();
      pintarFormulario(formulario.estado());
    }
    textoExito = '';
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
  btnAgregarEl.addEventListener('click', abrirFormulario);
  textoEl.addEventListener('input', function () {
    if (formulario) { formulario.setTexto(textoEl.value); }
  });
  formEl.addEventListener('submit', function (ev) {
    if (ev && typeof ev.preventDefault === 'function') { ev.preventDefault(); }
    guardar();
  });
  btnCancelarEl.addEventListener('click', function () { if (formulario) { formulario.cancelar(); } });
  btnCerrarFormEl.addEventListener('click', function () { if (formulario) { formulario.cancelar(); } });
  overlayEl.addEventListener('keydown', onTeclaFormulario);
})();
