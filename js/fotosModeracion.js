// Controlador DOM de la MODERACION de fotos de pozos en la galeria (E8-4, ajustado en E8-5): "Sugerir retiro" (fotos + fotos_carga), "Retirar foto" y "Ver historial" (fotos + fotos_moderar) en el visor de
// la galeria, y el dialogo de historial con la reposicion con confirmacion (que tambien reutiliza la pantalla "Fotos pendientes", js/fotosModeracionCola.js). Toda la logica (permisos, motivos, ids,
// errores, historial, maquina de estados) vive en js/fotosModeracionLogic.js, con tests; aca solo se pinta. Las acciones NO tocan la galeria por su cuenta: avisan a js/fotosPozos.js, que vuelve a pedir
// getFotosPozo (la verdad es del backend; el frontend no conserva una copia "optimista").
//
// Contrato del backend (por que la UI es asi):
//  - getFotosPozo entrega SOLO fotos visibles y, desde E8-5, `tieneSolicitudRetiro` (booleano derivado de los eventos reales). "Retiro sugerido" sale de ahi: sobrevive a recargar y a una sesion nueva,
//    y NO se recuerda nada en memoria. Con una solicitud abierta no se ofrece "Sugerir retiro" (ni "Retirar foto": se resuelve desde "Fotos pendientes").
//  - La imagen de una foto retirada SOLO se pide con getFotoPozoModeracion (nunca con el endpoint normal) y solo desde el historial y la pantalla de fotos pendientes. El visor normal usa getFotoPozo.
//
// Privacidad: todo texto de datos se pinta con textContent (jamas innerHTML). No se muestran emails, ids ni codigos crudos. Nada se escribe en storage, ni se loguea.
//
// API (window.fotosModeracionController_*):
//   _inicializar(obtenerContexto, hooks)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}; hooks = {refrescar(): Promise, cerrarVisor()}
//   _alAbrir(entidad)                       se abrio la pantalla de fotos de esa entidad
//   _alMostrarFoto(foto|null)               el visor muestra esa foto (o se cerro)
//   _etiquetaItem(foto)                     texto discreto para la miniatura ("Retiro sugerido") o ''
//   _abrirHistorial(fotoId, boton, opc)     abre el historial de una foto desde otra pantalla; opc = {alReponer(), alEstadoCambiado(code), alCerrar()}
//   _hayModalAbierto()                      para que Escape / flechas del visor no actuen debajo de un modal
//   _cerrar() / _reset()                    salir de la pantalla / cerrar sesion
(function () {
  var obtenerContexto = null;
  var hooks = { refrescar: null, cerrarVisor: null };
  var estado = {
    entidad: null,
    foto: null,                  // foto que muestra el visor
    miniaturas: {},              // fotoId -> dataURL (imagen de moderacion, solo del historial)
    tokenMiniaturas: 0,
    aviso: { texto: '', error: false },
    externo: null                // callbacks de la pantalla que abrio el historial (o null si vino del visor de la galeria)
  };

  function $(id) { return document.getElementById(id); }

  // visor
  var visorAccionesEl = $('fotos-mod-visor-acciones');
  var btnSugerirEl = $('btn-fotos-mod-sugerir');
  var btnRetirarEl = $('btn-fotos-mod-retirar');
  var btnHistorialEl = $('btn-fotos-mod-historial');
  var visorEstadoEl = $('fotos-mod-visor-estado');
  // pantalla
  var avisoEl = $('fotos-mod-aviso');
  // formulario (sugerir / retirar)
  var formOverlayEl = $('fotos-mod-form-overlay');
  var formEl = $('fotos-mod-form');
  var formTituloEl = $('fotos-mod-form-titulo');
  var formIntroEl = $('fotos-mod-form-intro');
  var motivoEl = $('fotos-mod-motivo');
  var detalleLabelEl = $('fotos-mod-detalle-label');
  var detalleEl = $('fotos-mod-detalle');
  var contadorEl = $('fotos-mod-contador');
  var privacidadEl = $('fotos-mod-privacidad');
  var formErrorEl = $('fotos-mod-form-error');
  var btnFormCerrarEl = $('btn-fotos-mod-form-cerrar');
  var btnFormCancelarEl = $('btn-fotos-mod-form-cancelar');
  var btnFormEnviarEl = $('btn-fotos-mod-form-enviar');
  // historial / reposicion
  var histOverlayEl = $('fotos-mod-hist-overlay');
  var histCargandoEl = $('fotos-mod-hist-cargando');
  var histErrorEl = $('fotos-mod-hist-error');
  var histContenidoEl = $('fotos-mod-hist-contenido');
  var histImgEl = $('fotos-mod-hist-img');
  var histImgErrorEl = $('fotos-mod-hist-img-error');
  var histFechaEl = $('fotos-mod-hist-fecha');
  var histDetalleEl = $('fotos-mod-hist-detalle');
  var histInsigniasEl = $('fotos-mod-hist-insignias');
  var histListaEl = $('fotos-mod-hist-lista');
  var histVacioEl = $('fotos-mod-hist-vacio');
  var histBotonesEl = $('fotos-mod-hist-botones');
  var btnHistCerrarEl = $('btn-fotos-mod-hist-cerrar');
  var btnHistCerrar2El = $('btn-fotos-mod-hist-cerrar2');
  var btnHistReponerEl = $('btn-fotos-mod-hist-reponer');
  var repConfirmarEl = $('fotos-mod-rep-confirmar');
  var repErrorEl = $('fotos-mod-rep-error');
  var btnRepCancelarEl = $('btn-fotos-mod-rep-cancelar');
  var btnRepConfirmarEl = $('btn-fotos-mod-rep-confirmar');

  var accion = null;           // sugerir / retirar
  var reposicion = null;       // reponer
  var historial = null;
  var abridorForm = null;      // boton que abrio el formulario (el foco vuelve ahi)
  var abridorHist = null;
  var formAbierto = false;
  var histAbierto = false;

  function nodo(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  function ctx() {
    return (obtenerContexto ? obtenerContexto() : null) || {};
  }

  function permisos() {
    return ctx().permisos;
  }

  function sesionVencida() {
    var c = ctx();
    if (typeof c.onSessionExpired === 'function') { c.onSessionExpired(); }
  }

  // =====================================================================
  // Acciones del visor
  // =====================================================================

  // Los botones salen de los permisos de HOY y de `foto.tieneSolicitudRetiro === true` (lo informa el backend en la galeria): con una solicitud abierta no se sugiere otra ni se retira directo (el backend lo
  // rechazaria): se muestra "Retiro sugerido" y el moderador la resuelve desde "Fotos pendientes". "Ver historial" sigue disponible para el moderador.
  function pintarAccionesVisor() {
    var p = permisos();
    var foto = estado.foto;
    var conSolicitud = !!foto && foto.tieneSolicitudRetiro === true;
    btnSugerirEl.hidden = !(foto && fotosModeracionLogic_puedeSugerir(p) && !conSolicitud);
    var moderador = !!foto && fotosModeracionLogic_puedeModerar(p);
    btnRetirarEl.hidden = !(moderador && !conSolicitud);
    btnHistorialEl.hidden = !moderador;
    visorAccionesEl.hidden = btnSugerirEl.hidden && btnRetirarEl.hidden && btnHistorialEl.hidden;
    if (conSolicitud && fotosModeracionLogic_puedeVerEstadoSolicitud(p)) {
      visorEstadoEl.textContent = moderador ? FOTOS_MODERACION_MENSAJE_SUGERIDO_MODERADOR : FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO;
      visorEstadoEl.hidden = false;
    } else {
      visorEstadoEl.textContent = '';
      visorEstadoEl.hidden = true;
    }
  }

  function fotosModeracionController_alMostrarFoto(foto) {
    estado.foto = foto || null;
    pintarAccionesVisor();
  }

  function mensajeVisor(texto) {
    visorEstadoEl.textContent = texto || '';
    visorEstadoEl.hidden = !texto;
  }

  // =====================================================================
  // Formulario: sugerir retiro / retirar foto
  // =====================================================================

  function poblarMotivos() {
    motivoEl.textContent = '';
    var vacio = nodo('option', '', 'Elegí un motivo');
    vacio.value = '';
    motivoEl.appendChild(vacio);
    FOTOS_MODERACION_MOTIVOS.forEach(function (m) {
      var op = nodo('option', '', m.etiqueta);
      op.value = m.codigo;
      motivoEl.appendChild(op);
    });
  }

  function pintarFormulario(e) {
    var estabaAbierto = formAbierto;
    formAbierto = e.abierto && e.tipo !== 'REPONER';
    formOverlayEl.hidden = !formAbierto;
    actualizarBloqueoScroll();
    if (!formAbierto) {
      motivoEl.value = '';
      detalleEl.value = '';
      formErrorEl.textContent = '';
      formErrorEl.hidden = true;
      if (estabaAbierto) { devolverFoco(abridorForm); abridorForm = null; }
      return;
    }
    var retirar = e.tipo === 'RETIRAR';
    formOverlayEl.classList.toggle('fotos-mod-overlay-retirar', retirar);
    formTituloEl.textContent = retirar ? 'Retirar foto' : 'Sugerir retiro de foto';
    formIntroEl.textContent = retirar
      ? 'Esta foto dejará de mostrarse en la galería. El archivo no se eliminará.'
      : 'Indicá por qué pensás que esta foto debería dejar de mostrarse.';
    btnFormEnviarEl.textContent = e.enviando ? (retirar ? 'Retirando…' : 'Enviando…') : (retirar ? 'Retirar foto' : 'Enviar sugerencia');
    if (motivoEl.value !== e.codigo) { motivoEl.value = e.codigo; }
    if (detalleEl.value !== e.detalle) { detalleEl.value = e.detalle; }
    detalleLabelEl.textContent = e.detalleObligatorio ? 'Detalle (obligatorio)' : 'Detalle (opcional)';
    detalleEl.setAttribute('aria-required', e.detalleObligatorio ? 'true' : 'false');
    contadorEl.textContent = e.contador;
    contadorEl.className = e.excede ? 'fotos-mod-contador fotos-mod-contador-excede' : 'fotos-mod-contador';
    privacidadEl.hidden = !e.avisoPrivacidad;
    btnFormEnviarEl.disabled = !e.puedeEnviar;
    btnFormCancelarEl.disabled = e.enviando;
    btnFormCerrarEl.disabled = e.enviando;
    motivoEl.disabled = e.enviando;
    detalleEl.readOnly = e.enviando;
    var campo = e.error ? e.error.campo : null;
    motivoEl.setAttribute('aria-invalid', campo === 'motivo' ? 'true' : 'false');
    detalleEl.setAttribute('aria-invalid', campo === 'detalle' || e.excede ? 'true' : 'false');
    formErrorEl.textContent = e.error ? e.error.mensaje : '';
    formErrorEl.hidden = !e.error;
  }

  function abrirFormulario(tipo, boton) {
    if (!accion || estado.foto === null || histAbierto) { return; }
    abridorForm = boton;
    if (accion.abrir(tipo, estado.foto)) {
      motivoEl.focus();
    } else {
      abridorForm = null;
      pintarAccionesVisor();         // el permiso cambio: la UI se corrige
    }
  }

  function enviarFormulario() {
    if (!accion) { return; }
    accion.guardar().then(function (e) {
      if (!e.abierto) { return; }
      if (e.error && e.error.campo === 'motivo') { motivoEl.focus(); }
      else if (e.error && e.error.campo === 'detalle') { detalleEl.focus(); }
      else if (e.error) { formErrorEl.focus(); }
    });
  }

  // =====================================================================
  // Avisos y refresco de la galeria
  // =====================================================================

  function avisar(texto, error) {
    estado.aviso = { texto: texto || '', error: error === true };
    avisoEl.textContent = estado.aviso.texto;
    avisoEl.className = 'fotos-mod-aviso' + (error === true ? ' fotos-mod-aviso-error' : '');
    avisoEl.hidden = !texto || !fotosModeracionLogic_puedeVer(permisos());
  }

  function cargarMiniaturaModeracion(fotoId) {
    if (estado.miniaturas[fotoId]) { return Promise.resolve(estado.miniaturas[fotoId]); }
    var c = ctx();
    if (!fotosModeracionLogic_puedeModerar(c.permisos)) { return Promise.reject(new Error('PERMISSION_DENIED')); }
    var token = estado.tokenMiniaturas;
    return apiGetFotoPozoModeracion(c.sessionToken, fotoId, 'thumb').then(function (r) {
      if (!r || r.status !== 'ok' || !r.data || typeof r.data.imagenBase64 !== 'string') {
        if (r && fotosModeracionLogic_esErrorDeSesion(r.code)) { sesionVencida(); }
        throw new Error((r && r.code) || 'ERROR');
      }
      var url = 'data:' + r.data.mimeType + ';base64,' + r.data.imagenBase64;
      if (token === estado.tokenMiniaturas) { estado.miniaturas[fotoId] = url; }
      return url;
    });
  }

  // La galeria (y su contador) se vuelven a pedir al backend: no se confia en quitar un nodo del DOM. Devuelve una promesa que nunca rechaza.
  function refrescarGaleria() {
    var p = hooks.refrescar ? hooks.refrescar() : null;
    return Promise.resolve(p).then(function () { return undefined; }, function () { return undefined; });
  }

  function enfocarAviso() {
    if (!avisoEl.hidden && typeof avisoEl.focus === 'function') { avisoEl.focus(); }
  }

  // =====================================================================
  // Resultado de las acciones
  // =====================================================================

  function alExito(info) {
    if (info.tipo === 'SUGERIR') {
      // una solicitud abierta NO oculta la foto: sigue en la galeria. El estado "Retiro sugerido" lo trae el backend: se vuelve a pedir la galeria (y el visor se sincroniza con la foto actualizada).
      btnSugerirEl.hidden = true;
      mensajeVisor(FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO);
      refrescarGaleria();
      return;
    }
    if (info.tipo === 'RETIRAR') {
      if (hooks.cerrarVisor) { hooks.cerrarVisor(); }
      avisar(FOTOS_MODERACION_MENSAJE_EXITO_RETIRAR, false);
      refrescarGaleria().then(enfocarAviso);
    }
  }

  function alEstadoCambiado(info) {
    if (info.tipo === 'SUGERIR' && info.code === 'SOLICITUD_YA_ABIERTA') {
      // el backend dice que ya hay una solicitud abierta (otra persona se adelanto): la galeria se actualiza y el visor muestra el estado real
      mensajeVisor(fotosModeracionLogic_mensajeError(info.code));
      refrescarGaleria();
      return;
    }
    avisar(fotosModeracionLogic_mensajeError(info.code), true);
    if (hooks.cerrarVisor) { hooks.cerrarVisor(); }
    refrescarGaleria().then(enfocarAviso);
  }

  // =====================================================================
  // Historial y reposicion
  // =====================================================================

  function pintarHistorial(e) {
    var estabaAbierto = histAbierto;
    histAbierto = e.abierto;
    histOverlayEl.hidden = !e.abierto;
    actualizarBloqueoScroll();
    if (!e.abierto) {
      histListaEl.textContent = '';
      histInsigniasEl.textContent = '';
      histImgEl.removeAttribute('src');
      histImgEl.hidden = true;
      repConfirmarEl.hidden = true;
      if (estabaAbierto) {
        devolverFoco(abridorHist);
        abridorHist = null;
        var externo = estado.externo;
        estado.externo = null;
        if (externo && typeof externo.alCerrar === 'function') { externo.alCerrar(); }
      }
      return;
    }
    histCargandoEl.hidden = !e.cargando;
    histErrorEl.textContent = e.error ? e.error.mensaje : '';
    histErrorEl.hidden = !e.error;
    var v = e.vista;
    histContenidoEl.hidden = !v;
    if (!v) {
      btnHistReponerEl.hidden = true;
      repConfirmarEl.hidden = true;
      return;
    }
    histFechaEl.textContent = v.fecha ? 'Foto del ' + v.fecha : 'Foto';
    histDetalleEl.textContent = v.detalle;
    histInsigniasEl.textContent = '';
    var insignias = [{ texto: v.estado.etiqueta, alerta: v.estado.retirada || !v.estado.derivable }];
    if (v.estado.solicitudAbierta) { insignias.push({ texto: FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO, alerta: false }); }
    if (v.estado.pendienteBorrado) { insignias.push({ texto: FOTOS_MODERACION_AVISO_PENDIENTE_BORRADO, alerta: true }); }
    if (v.estado.legacy) { insignias.push({ texto: 'Oculta desde antes de la moderación', alerta: true }); }
    insignias.forEach(function (i) {
      histInsigniasEl.appendChild(nodo('li', 'fotos-mod-insignia' + (i.alerta ? ' fotos-mod-insignia-alerta' : ''), i.texto));
    });
    histListaEl.textContent = '';
    v.eventos.forEach(function (ev) {
      var li = nodo('li', 'fotos-mod-hist-evento');
      li.appendChild(nodo('p', 'fotos-mod-hist-evento-titulo', ev.titulo));
      li.appendChild(nodo('p', 'fotos-mod-hist-evento-meta', ev.nombre + (ev.fecha ? ' · ' + ev.fecha : '')));
      if (ev.motivo) { li.appendChild(nodo('p', 'fotos-mod-hist-evento-meta', 'Motivo: ' + ev.motivo)); }
      if (ev.texto) { li.appendChild(nodo('p', 'fotos-mod-hist-evento-texto', ev.texto)); }
      histListaEl.appendChild(li);
    });
    histVacioEl.hidden = v.eventos.length > 0;
    var repo = reposicion ? reposicion.estado() : null;
    var confirmando = !!repo && repo.abierto;
    repConfirmarEl.hidden = !confirmando;
    histBotonesEl.hidden = confirmando;
    btnHistReponerEl.hidden = !(v.puedeReponer && fotosModeracionLogic_puedeModerar(permisos()));
    cargarImagenHistorial(v.fotoId);
  }

  function cargarImagenHistorial(fotoId) {
    if (histImgEl.getAttribute('data-foto-id') === fotoId && !histImgEl.hidden) { return; }
    histImgEl.setAttribute('data-foto-id', fotoId);
    histImgErrorEl.hidden = true;
    cargarMiniaturaModeracion(fotoId).then(function (url) {
      if (!histAbierto || histImgEl.getAttribute('data-foto-id') !== fotoId) { return; }
      histImgEl.src = url;
      histImgEl.hidden = false;
    }, function () {
      if (!histAbierto || histImgEl.getAttribute('data-foto-id') !== fotoId) { return; }
      histImgErrorEl.textContent = fotosModeracionLogic_mensajeError('STORAGE_UNAVAILABLE');
      histImgErrorEl.hidden = false;
    });
  }

  // externo: callbacks de otra pantalla (la cola de fotos pendientes) que abre el mismo dialogo; null si se abre desde el visor de la galeria.
  function abrirHistorial(fotoId, boton, externo) {
    if (!historial || formAbierto) {
      if (externo && typeof externo.alCerrar === 'function') { externo.alCerrar(); }
      return;
    }
    abridorHist = boton;
    estado.externo = externo || null;
    histImgEl.removeAttribute('data-foto-id');
    historial.abrir(fotoId).then(function (abrio) {
      if (!abrio) {
        abridorHist = null;
        var ext = estado.externo;
        estado.externo = null;
        pintarAccionesVisor();
        if (ext && typeof ext.alCerrar === 'function') { ext.alCerrar(); }
        return;
      }
      if (typeof btnHistCerrarEl.focus === 'function') { btnHistCerrarEl.focus(); }
    });
  }

  function pintarReposicion(e) {
    var activo = e.abierto && e.tipo === 'REPONER';
    if (!histAbierto) { return; }
    repConfirmarEl.hidden = !activo;
    histBotonesEl.hidden = activo;
    btnRepConfirmarEl.disabled = e.enviando;
    btnRepCancelarEl.disabled = e.enviando;
    btnRepConfirmarEl.textContent = e.enviando ? 'Reponiendo…' : 'Reponer foto';
    repErrorEl.textContent = e.error ? e.error.mensaje : '';
    repErrorEl.hidden = !e.error;
  }

  function pedirReposicion() {
    var h = historial ? historial.estado() : null;
    if (!reposicion || !h || !h.vista || !h.vista.puedeReponer) { return; }
    if (reposicion.abrir('REPONER', { fotoId: h.vista.fotoId })) {
      btnRepCancelarEl.focus();
    } else {
      pintarHistorial(h);
    }
  }

  function confirmarReposicion() {
    if (!reposicion) { return; }
    reposicion.guardar().then(function (e) {
      if (e.abierto && e.error && typeof repErrorEl.focus === 'function') { repErrorEl.focus(); }
    });
  }

  function cancelarReposicion() {
    if (reposicion && reposicion.cancelar()) {
      btnHistReponerEl.hidden = !(historial && historial.estado().vista && historial.estado().vista.puedeReponer);
      if (typeof btnHistReponerEl.focus === 'function' && !btnHistReponerEl.hidden) { btnHistReponerEl.focus(); }
    }
  }

  // Al cerrarse el historial se llama a externo.alCerrar; por eso se toma el externo ANTES de cerrarlo.
  function alReponer(info) {
    var externo = estado.externo;
    if (historial) { historial.cerrar(); }
    if (externo) {
      if (typeof externo.alReponer === 'function') { externo.alReponer(info); }        // la pantalla de fotos pendientes se actualiza sola
      return;
    }
    avisar(FOTOS_MODERACION_MENSAJE_EXITO_REPONER, false);
    refrescarGaleria().then(enfocarAviso);
  }

  function alReposicionCambio(info) {
    // la foto ya no esta retirada / no existe: se refresca todo y se explica
    var externo = estado.externo;
    if (historial) { historial.cerrar(); }
    if (externo) {
      if (typeof externo.alEstadoCambiado === 'function') { externo.alEstadoCambiado(info.code); }
      return;
    }
    avisar(fotosModeracionLogic_mensajeError(info.code), true);
    refrescarGaleria().then(enfocarAviso);
  }

  // =====================================================================
  // Teclado, foco y bloqueo de scroll
  // =====================================================================

  function actualizarBloqueoScroll() {
    document.body.classList.toggle('fotos-mod-abierto', formAbierto || histAbierto);
  }

  // El foco vuelve al boton que abrio el modal; si ya no esta (p. ej. la foto se retiro o ya se sugirio), al mensaje visible mas cercano.
  function devolverFoco(boton) {
    if (boton && boton.isConnected !== false && !boton.hidden && typeof boton.focus === 'function') {
      boton.focus();
    } else if (!visorEstadoEl.hidden && typeof visorEstadoEl.focus === 'function') {
      visorEstadoEl.focus();
    } else if (!avisoEl.hidden && typeof avisoEl.focus === 'function') {
      avisoEl.focus();
    }
  }

  function enfocablesForm() {
    return [btnFormCerrarEl, motivoEl, detalleEl, btnFormCancelarEl, btnFormEnviarEl].filter(function (e) { return !e.disabled; });
  }

  function enfocablesHist() {
    var lista = repConfirmarEl.hidden
      ? [btnHistCerrarEl, btnHistReponerEl, btnHistCerrar2El]
      : [btnHistCerrarEl, btnRepCancelarEl, btnRepConfirmarEl];
    return lista.filter(function (e) { return !e.disabled && !e.hidden; });
  }

  // Escape cancela el modal (si no esta enviando) y NO llega al visor de abajo; Tab rota dentro del modal.
  function teclaDeModal(listaEnfocables, cancelar) {
    return function (ev) {
      if (ev.key === 'Escape') {
        if (typeof ev.stopPropagation === 'function') { ev.stopPropagation(); }
        cancelar();
        return;
      }
      if (ev.key === 'Tab') {
        var lista = listaEnfocables();
        var actual = lista.indexOf(document.activeElement);
        var siguiente = fotosModeracionLogic_siguienteFoco(lista.length, actual, ev.shiftKey === true);
        if (siguiente >= 0) {
          ev.preventDefault();
          lista[siguiente].focus();
        }
      }
    };
  }

  function cerrarHistorialOReposicion() {
    if (reposicion && reposicion.estado().abierto) { cancelarReposicion(); return; }
    if (historial) { historial.cerrar(); }
  }

  // =====================================================================
  // Ciclo de vida
  // =====================================================================

  function fotosModeracionController_inicializar(ctxFn, h) {
    obtenerContexto = ctxFn;
    hooks = { refrescar: (h && h.refrescar) || null, cerrarVisor: (h && h.cerrarVisor) || null };
    poblarMotivos();
    var comunes = {
      obtenerContexto: ctxFn,
      onSesionExpirada: sesionVencida
    };
    accion = fotosModeracionLogic_crearAccion({
      obtenerContexto: ctxFn,
      enviar: function (tipo, sessionToken, datos, clientRequestId) {
        if (tipo === 'SUGERIR') { return apiSolicitarRetiroFotoPozo(sessionToken, datos.fotoId, datos.motivoCodigo, datos.motivoTexto, clientRequestId); }
        return apiRetirarFotoPozo(sessionToken, datos.fotoId, datos.motivoCodigo, datos.motivoTexto, clientRequestId);
      },
      onCambio: pintarFormulario,
      onExito: alExito,
      onEstadoCambiado: alEstadoCambiado,
      onSesionExpirada: comunes.onSesionExpirada
    });
    reposicion = fotosModeracionLogic_crearAccion({
      obtenerContexto: ctxFn,
      enviar: function (tipo, sessionToken, datos, clientRequestId) { return apiReponerFotoPozo(sessionToken, datos.fotoId, clientRequestId); },
      onCambio: pintarReposicion,
      onExito: alReponer,
      onEstadoCambiado: alReposicionCambio,
      onSesionExpirada: comunes.onSesionExpirada
    });
    historial = fotosModeracionLogic_crearHistorial({
      obtenerContexto: ctxFn,
      consultar: function (sessionToken, fotoId) { return apiGetHistorialFotoPozo(sessionToken, fotoId); },
      onCambio: pintarHistorial,
      onSesionExpirada: comunes.onSesionExpirada
    });
  }

  function fotosModeracionController_alAbrir(entidad) {
    descartarModales();
    estado.entidad = entidad || null;
    estado.foto = null;
    avisar('', false);
    pintarAccionesVisor();
  }

  function descartarModales() {
    if (accion) { accion.descartar(); }
    if (reposicion) { reposicion.descartar(); }
    if (historial) { historial.cerrar(); }
    formAbierto = false;
    histAbierto = false;
    abridorForm = null;
    abridorHist = null;
    actualizarBloqueoScroll();
  }

  function fotosModeracionController_cerrar() {
    descartarModales();
    estado.foto = null;
    pintarAccionesVisor();
  }

  // Cierre de sesion: nada de la moderacion sobrevive (ni modales abiertos, ni imagenes de fotos retiradas).
  function fotosModeracionController_reset() {
    descartarModales();
    estado.entidad = null;
    estado.foto = null;
    estado.miniaturas = {};
    estado.tokenMiniaturas += 1;
    estado.externo = null;
    avisar('', false);
    pintarAccionesVisor();
    mensajeVisor('');
  }

  // Texto discreto bajo la miniatura: sale del booleano que trae la galeria (no de memoria) y solo lo ve quien puede sugerir o moderar.
  function fotosModeracionController_etiquetaItem(foto) {
    return !!foto && foto.tieneSolicitudRetiro === true && fotosModeracionLogic_puedeVerEstadoSolicitud(permisos()) ? FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO : '';
  }

  function fotosModeracionController_abrirHistorial(fotoId, boton, externo) {
    abrirHistorial(fotoId, boton, externo);
  }

  function fotosModeracionController_hayModalAbierto() {
    return formAbierto || histAbierto;
  }

  // Eventos
  btnSugerirEl.addEventListener('click', function () { abrirFormulario('SUGERIR', btnSugerirEl); });
  btnRetirarEl.addEventListener('click', function () { abrirFormulario('RETIRAR', btnRetirarEl); });
  btnHistorialEl.addEventListener('click', function () {
    if (estado.foto) { abrirHistorial(estado.foto.fotoId, btnHistorialEl, null); }
  });
  motivoEl.addEventListener('change', function () { if (accion) { accion.setCodigo(motivoEl.value); } });
  detalleEl.addEventListener('input', function () { if (accion) { accion.setDetalle(detalleEl.value); } });
  formEl.addEventListener('submit', function (ev) {
    if (ev && typeof ev.preventDefault === 'function') { ev.preventDefault(); }
    enviarFormulario();
  });
  btnFormCancelarEl.addEventListener('click', function () { if (accion) { accion.cancelar(); } });
  btnFormCerrarEl.addEventListener('click', function () { if (accion) { accion.cancelar(); } });
  formOverlayEl.addEventListener('keydown', teclaDeModal(enfocablesForm, function () { if (accion) { accion.cancelar(); } }));

  btnHistCerrarEl.addEventListener('click', cerrarHistorialOReposicion);
  btnHistCerrar2El.addEventListener('click', function () { if (historial) { historial.cerrar(); } });
  btnHistReponerEl.addEventListener('click', pedirReposicion);
  btnRepCancelarEl.addEventListener('click', cancelarReposicion);
  btnRepConfirmarEl.addEventListener('click', confirmarReposicion);
  histOverlayEl.addEventListener('keydown', teclaDeModal(enfocablesHist, cerrarHistorialOReposicion));

  window.fotosModeracionController_inicializar = fotosModeracionController_inicializar;
  window.fotosModeracionController_alAbrir = fotosModeracionController_alAbrir;
  window.fotosModeracionController_alMostrarFoto = fotosModeracionController_alMostrarFoto;
  window.fotosModeracionController_etiquetaItem = fotosModeracionController_etiquetaItem;
  window.fotosModeracionController_abrirHistorial = fotosModeracionController_abrirHistorial;
  window.fotosModeracionController_hayModalAbierto = fotosModeracionController_hayModalAbierto;
  window.fotosModeracionController_cerrar = fotosModeracionController_cerrar;
  window.fotosModeracionController_reset = fotosModeracionController_reset;
})();
