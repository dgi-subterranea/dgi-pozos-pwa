// Controlador DOM de la MODERACION de fotos de pozos (E8-4): "Sugerir retiro" (fotos + fotos_carga), "Retirar foto" y "Ver historial" (fotos + fotos_moderar) en el visor de la galeria, la bandeja de
// fotos retiradas EN ESTA SESION y la reposicion con confirmacion. Toda la logica (permisos, motivos, ids, errores, historial, maquina de estados) vive en js/fotosModeracionLogic.js, con tests; aca solo
// se pinta. Las acciones NO tocan la galeria por su cuenta: avisan a js/fotosPozos.js, que vuelve a pedir getFotosPozo (la verdad es del backend; el frontend no conserva una copia "optimista").
//
// Contrato real del backend en E8-3 (por que la UI es asi):
//  - getFotosPozo entrega SOLO fotos visibles y NO dice si una foto tiene una solicitud abierta. Por eso "Retiro sugerido" se recuerda unicamente cuando el backend lo CONFIRMA en esta sesion (exito de
//    la sugerencia o rechazo por solicitud ya abierta). Una segunda sugerencia sobre la misma foto la rechaza el backend y la UI lo explica; no hay un endpoint por foto solo para saberlo.
//  - No existe todavia un listado de fotos retiradas. Para poder reponer sin inventar N pedidos, la bandeja guarda las fotos que ESTA persona retiro en la sesion; el listado/cola global llega en E8-5.
//  - La imagen de una foto retirada SOLO se pide con getFotoPozoModeracion (nunca con el endpoint normal) y solo desde la bandeja y el historial. El visor normal usa getFotoPozo, siempre.
//
// Privacidad: todo texto de datos se pinta con textContent (jamas innerHTML). No se muestran emails, ids ni codigos crudos. Nada se escribe en storage, ni se loguea.
//
// API (window.fotosModeracionController_*):
//   _inicializar(obtenerContexto, hooks)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}; hooks = {refrescar(): Promise, cerrarVisor(), repintar()}
//   _alAbrir(entidad)                       se abrio la pantalla de fotos de esa entidad
//   _alMostrarFoto(foto|null)               el visor muestra esa foto (o se cerro)
//   _etiquetaItem(fotoId)                   texto discreto para la miniatura ("Retiro sugerido") o ''
//   _hayModalAbierto()                      para que Escape / flechas del visor no actuen debajo de un modal
//   _cerrar() / _reset()                    salir de la pantalla / cerrar sesion
(function () {
  var obtenerContexto = null;
  var hooks = { refrescar: null, cerrarVisor: null, repintar: null };
  var estado = {
    entidad: null,
    foto: null,                  // foto que muestra el visor
    sugeridas: {},               // fotoId -> true (confirmado por el backend en esta sesion)
    retiradas: {},               // claveEntidad -> [{fotoId, fecha, detalle, motivo}] (retiradas por esta persona en esta sesion)
    miniaturas: {},              // fotoId -> dataURL (imagen de moderacion, solo de la bandeja y el historial)
    tokenMiniaturas: 0,
    aviso: { texto: '', error: false },
    historialObjetivo: null      // item de la bandeja desde el que se abrio el historial (o null si vino del visor)
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
  var retiradasEl = $('fotos-mod-retiradas');
  var retiradasListaEl = $('fotos-mod-retiradas-lista');
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

  function claveEntidad() {
    return estado.entidad && typeof fotosPozosLogic_claveEntidad === 'function' ? fotosPozosLogic_claveEntidad(estado.entidad) : '';
  }

  function sesionVencida() {
    var c = ctx();
    if (typeof c.onSessionExpired === 'function') { c.onSessionExpired(); }
  }

  // =====================================================================
  // Acciones del visor
  // =====================================================================

  function pintarAccionesVisor() {
    var p = permisos();
    var foto = estado.foto;
    var id = foto ? fotosModeracionLogic_idNormalizado(foto.fotoId) : '';
    var sugerida = id !== '' && estado.sugeridas[id] === true;
    btnSugerirEl.hidden = !(foto && fotosModeracionLogic_puedeSugerir(p) && !sugerida);
    var moderador = !!foto && fotosModeracionLogic_puedeModerar(p);
    btnRetirarEl.hidden = !moderador;
    btnHistorialEl.hidden = !moderador;
    visorAccionesEl.hidden = btnSugerirEl.hidden && btnRetirarEl.hidden && btnHistorialEl.hidden;
    if (foto && sugerida && fotosModeracionLogic_puedeSugerir(p)) {
      visorEstadoEl.textContent = FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO;
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
  // Avisos, bandeja de retiradas y refresco de la galeria
  // =====================================================================

  function avisar(texto, error) {
    estado.aviso = { texto: texto || '', error: error === true };
    avisoEl.textContent = estado.aviso.texto;
    avisoEl.className = 'fotos-mod-aviso' + (error === true ? ' fotos-mod-aviso-error' : '');
    avisoEl.hidden = !texto || !fotosModeracionLogic_puedeVer(permisos());
  }

  function listaRetiradas() {
    return estado.retiradas[claveEntidad()] || [];
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

  function pintarBandeja() {
    var moderador = fotosModeracionLogic_puedeModerar(permisos());
    var items = moderador ? listaRetiradas() : [];
    retiradasEl.hidden = items.length === 0;
    retiradasListaEl.textContent = '';
    items.forEach(function (it) {
      var li = nodo('li', 'fotos-mod-retirada');
      var img = nodo('img', 'fotos-mod-retirada-mini');
      img.alt = 'Foto retirada del ' + (it.fecha || 'pozo');
      li.appendChild(img);
      cargarMiniaturaModeracion(it.fotoId).then(function (url) { img.src = url; }, function () { /* sin miniatura: queda el recuadro */ });
      var cuerpo = nodo('div', 'fotos-mod-retirada-cuerpo');
      cuerpo.appendChild(nodo('p', '', 'Foto del ' + (it.fecha || 'sin fecha') + (it.detalle ? ' · ' + it.detalle : '')));
      if (it.motivo) { cuerpo.appendChild(nodo('p', '', 'Motivo: ' + it.motivo)); }
      var boton = nodo('button', 'button-secondary', 'Ver historial');
      boton.type = 'button';
      boton.setAttribute('aria-haspopup', 'dialog');
      boton.addEventListener('click', function () { abrirHistorial(it.fotoId, boton, it); });
      cuerpo.appendChild(boton);
      li.appendChild(cuerpo);
      retiradasListaEl.appendChild(li);
    });
  }

  function agregarRetirada(foto, codigoMotivo) {
    var clave = claveEntidad();
    if (clave === '' || !foto) { return; }
    var id = fotosModeracionLogic_idNormalizado(foto.fotoId);
    var lista = (estado.retiradas[clave] || []).filter(function (it) { return it.fotoId !== id; });
    lista.unshift({
      fotoId: id,
      fecha: typeof fotosPozosLogic_formatearFecha === 'function' ? fotosPozosLogic_formatearFecha(foto.fechaFotoValor, foto.fechaFotoPrecision) : '',
      detalle: typeof fotosPozosLogic_etiquetaFuente === 'function' ? fotosPozosLogic_etiquetaFuente(foto.fuente) + ' · ' + fotosPozosLogic_etiquetaTipo(foto.tipoFoto) : '',
      motivo: codigoMotivo ? fotosModeracionLogic_etiquetaMotivo(codigoMotivo) : ''
    });
    estado.retiradas[clave] = lista;
  }

  function quitarRetirada(fotoId) {
    var clave = claveEntidad();
    var id = fotosModeracionLogic_idNormalizado(fotoId);
    if (estado.retiradas[clave]) {
      estado.retiradas[clave] = estado.retiradas[clave].filter(function (it) { return it.fotoId !== id; });
    }
  }

  // La galeria (y su contador) se vuelven a pedir al backend: no se confia en quitar un nodo del DOM. Devuelve una promesa que nunca rechaza.
  function refrescarGaleria() {
    var p = hooks.refrescar ? hooks.refrescar() : null;
    return Promise.resolve(p).then(function () { pintarBandeja(); }, function () { pintarBandeja(); });
  }

  function enfocarAviso() {
    if (!avisoEl.hidden && typeof avisoEl.focus === 'function') { avisoEl.focus(); }
  }

  // =====================================================================
  // Resultado de las acciones
  // =====================================================================

  function alExito(info) {
    if (info.tipo === 'SUGERIR') {
      estado.sugeridas[fotosModeracionLogic_idNormalizado(info.fotoId)] = true;      // el backend lo confirmo: solicitud abierta
      pintarAccionesVisor();
      mensajeVisor(FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO);
      if (hooks.repintar) { hooks.repintar(); }
      return;                                       // una solicitud abierta NO oculta la foto: sigue en la galeria
    }
    if (info.tipo === 'RETIRAR') {
      agregarRetirada(info.foto, info.motivoCodigo);
      if (hooks.cerrarVisor) { hooks.cerrarVisor(); }
      avisar(FOTOS_MODERACION_MENSAJE_EXITO_RETIRAR, false);
      refrescarGaleria().then(enfocarAviso);
    }
  }

  function alEstadoCambiado(info) {
    if (info.tipo === 'SUGERIR' && info.code === 'SOLICITUD_YA_ABIERTA') {
      estado.sugeridas[fotosModeracionLogic_idNormalizado(info.fotoId)] = true;      // el backend dice que ya hay una solicitud abierta
      pintarAccionesVisor();
      mensajeVisor(fotosModeracionLogic_mensajeError(info.code));
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
      if (estabaAbierto) { devolverFoco(abridorHist); abridorHist = null; estado.historialObjetivo = null; }
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

  function abrirHistorial(fotoId, boton, objetivo) {
    if (!historial || formAbierto) { return; }
    abridorHist = boton;
    estado.historialObjetivo = objetivo || null;
    histImgEl.removeAttribute('data-foto-id');
    historial.abrir(fotoId).then(function (abrio) {
      if (!abrio) { abridorHist = null; pintarAccionesVisor(); return; }
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

  function alReponer(info) {
    quitarRetirada(info.fotoId);
    if (historial) { historial.cerrar(); }
    avisar(FOTOS_MODERACION_MENSAJE_EXITO_REPONER, false);
    refrescarGaleria().then(enfocarAviso);
  }

  function alReposicionCambio(info) {
    // la foto ya no esta retirada / no existe: se refresca todo y se explica
    if (historial) { historial.cerrar(); }
    if (info.code === 'FOTO_NO_RETIRADA' || info.code === 'FOTO_NOT_FOUND') { quitarRetirada(info.fotoId); }
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
    hooks = { refrescar: (h && h.refrescar) || null, cerrarVisor: (h && h.cerrarVisor) || null, repintar: (h && h.repintar) || null };
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
    pintarBandeja();
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

  // Cierre de sesion: nada de la moderacion sobrevive (ni lo recordado, ni imagenes de fotos retiradas).
  function fotosModeracionController_reset() {
    descartarModales();
    estado.entidad = null;
    estado.foto = null;
    estado.sugeridas = {};
    estado.retiradas = {};
    estado.miniaturas = {};
    estado.tokenMiniaturas += 1;
    estado.historialObjetivo = null;
    avisar('', false);
    retiradasListaEl.textContent = '';
    retiradasEl.hidden = true;
    visorAccionesEl.hidden = true;
    mensajeVisor('');
  }

  function fotosModeracionController_etiquetaItem(fotoId) {
    var id = fotosModeracionLogic_idNormalizado(fotoId);
    return id !== '' && estado.sugeridas[id] === true && fotosModeracionLogic_puedeSugerir(permisos()) ? FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO : '';
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
  window.fotosModeracionController_hayModalAbierto = fotosModeracionController_hayModalAbierto;
  window.fotosModeracionController_cerrar = fotosModeracionController_cerrar;
  window.fotosModeracionController_reset = fotosModeracionController_reset;
})();
