// Controlador DOM de la moderacion de ITF (E9-6, local, NO productivo; solo perfil + perfil_validar): la pantalla "ITF pendientes" (cola paginada), el visor de un documento con comparacion propuesta / vigente,
// el dialogo de aprobar / rechazar / retirar / restaurar (con motivo) y el historial de un pozo. Toda la logica (permisos, paginacion, respuestas viejas, ids de intencion, VIGENTE_CAMBIO) vive en
// js/itfLogic.js y js/itfFlujosLogic.js, con tests; aca solo se pinta.
//
// Reglas de estas pantallas:
//  - La tarjeta del hub NO carga nada: la primera pagina de la cola se pide recien al abrir la pantalla. Una pagina por vez; "Ver más" sigue desde el cursor. La cola NO baja imagenes: cada documento se pide
//    al abrirlo ("Ver documento"), uno por vez.
//  - Aprobar con ITF vigente: el cliente declara el vigente QUE VIO (vigenteEsperadoDocumentoId). Si cambio, se avisa, se vuelve a pedir el contexto y NO se reintenta solo.
//  - Despues de CUALQUIER accion la lista / el contexto se vuelven a pedir: nunca se queda un dato anterior a la accion.
//  - Nada de ids internos (LEGACY:<wellId> se ve como "ITF existente"), emails ni hashes. Todo texto del servidor se pinta con textContent: jamas innerHTML con datos.
//
// API (window.itfModeracionController_*):
//   _inicializar(obtenerContexto, opciones)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}; opciones: {onVerPozo(wellId), onCambioDeVigente(wellId)}
//   _abrir() / _volver()                      la pantalla se muestra: pide la primera pagina (_volver conserva lo ya cargado) / _cerrar() / _reset() (cierre de sesion)
//   _abrirHistorial(wellId, abridor, hooks)   el historial de un pozo (tambien desde el Perfil); hooks.alCambio() se llama despues de una accion exitosa
//   _pedirRetirarVigente(wellId, abridor, hooks)   confirmacion de retirar el ITF vigente de un pozo (desde el Perfil)
//   _hayModalAbierto()
(function () {
  var obtenerContexto = null;
  var opcionesApp = {};
  var cola = null;
  var visor = null;
  var historial = null;
  var accion = null;
  var hooksExternos = null;            // {alCambio} de quien abrio el historial / el retiro desde el Perfil
  var origenAccion = 'COLA';           // desde donde se pidio la accion en curso: COLA | VISOR | HIST | PERFIL
  var abridorAccion = null;
  var abridorVisor = null;
  var abridorHist = null;
  var accionAbierta = false;
  var visorAbierto = false;
  var histAbierto = false;
  var firmaLista = '';
  var firmaHist = '';
  var firmaAnteriores = '';

  function $(id) { return document.getElementById(id); }

  var el = {
    // cola
    avisoCola: $('itf-cola-aviso'),
    panelCola: $('itf-cola-panel'),
    total: $('itf-cola-total'),
    btnActualizar: $('btn-itf-cola-actualizar'),
    cargando: $('itf-cola-cargando'),
    error: $('itf-cola-error'),
    errorTexto: $('itf-cola-error-texto'),
    btnReintentar: $('btn-itf-cola-reintentar'),
    vacio: $('itf-cola-vacio'),
    sinDerivar: $('itf-cola-sin-derivar'),
    lista: $('itf-cola-lista'),
    masError: $('itf-cola-mas-error'),
    btnMas: $('btn-itf-cola-mas'),
    // visor
    visOverlay: $('itf-vis-overlay'),
    visPozo: $('itf-vis-pozo'),
    visCargando: $('itf-vis-cargando'),
    visError: $('itf-vis-error'),
    visErrorTexto: $('itf-vis-error-texto'),
    btnVisReintentar: $('btn-itf-vis-reintentar'),
    visAviso: $('itf-vis-aviso'),
    visDatos: $('itf-vis-datos'),
    visEstado: $('itf-vis-estado'),
    visNombre: $('itf-vis-nombre'),
    visTamano: $('itf-vis-tamano'),
    visDtProp: $('itf-vis-dt-prop'),
    visProponente: $('itf-vis-proponente'),
    visAdvertencia: $('itf-vis-advertencia'),
    visVistas: $('itf-vis-vistas'),
    btnVerProp: $('btn-itf-vis-ver-prop'),
    btnVerVig: $('btn-itf-vis-ver-vig'),
    visZoom: $('itf-vis-zoom'),
    btnAlejar: $('btn-itf-vis-alejar'),
    btnAcercar: $('btn-itf-vis-acercar'),
    btnAjustar: $('btn-itf-vis-ajustar'),
    zoomTexto: $('itf-vis-zoom-texto'),
    visPaneles: $('itf-vis-paneles'),
    panelProp: $('itf-vis-pane-prop'),
    panelVig: $('itf-vis-pane-vig'),
    capProp: $('itf-vis-cap-prop'),
    imgProp: $('itf-vis-img-prop'),
    vigCargando: $('itf-vis-vig-cargando'),
    vigError: $('itf-vis-vig-error'),
    vigErrorTexto: $('itf-vis-vig-error-texto'),
    btnVigReintentar: $('btn-itf-vis-vig-reintentar'),
    vigScroll: $('itf-vis-vig-scroll'),
    imgVig: $('itf-vis-img-vig'),
    vigenteNota: $('itf-vis-vigente-nota'),
    btnComparar: $('btn-itf-vis-comparar'),
    btnVisAprobar: $('btn-itf-vis-aprobar'),
    btnVisRechazar: $('btn-itf-vis-rechazar'),
    btnVisRestaurar: $('btn-itf-vis-restaurar'),
    btnVisCerrar: $('btn-itf-vis-cerrar'),
    btnVisCerrar2: $('btn-itf-vis-cerrar2'),
    // accion
    accOverlay: $('itf-accion-overlay'),
    accTitulo: $('itf-accion-titulo'),
    accEntidad: $('itf-accion-entidad'),
    accCargando: $('itf-accion-cargando'),
    accAviso: $('itf-accion-aviso'),
    accMotivoGrupo: $('itf-accion-motivo-grupo'),
    accMotivo: $('itf-accion-motivo'),
    accTextoGrupo: $('itf-accion-texto-grupo'),
    accTexto: $('itf-accion-texto'),
    accError: $('itf-accion-error'),
    btnAccCerrar: $('btn-itf-accion-cerrar'),
    btnAccCancelar: $('btn-itf-accion-cancelar'),
    btnAccConfirmar: $('btn-itf-accion-confirmar'),
    // historial
    histOverlay: $('itf-hist-overlay'),
    histPozo: $('itf-hist-pozo'),
    histCargando: $('itf-hist-cargando'),
    histError: $('itf-hist-error'),
    histErrorTexto: $('itf-hist-error-texto'),
    btnHistReintentar: $('btn-itf-hist-reintentar'),
    histAviso: $('itf-hist-aviso'),
    histContenido: $('itf-hist-contenido'),
    histVigente: $('itf-hist-vigente'),
    btnHistVerVigente: $('btn-itf-hist-ver-vigente'),
    btnHistRetirar: $('btn-itf-hist-retirar'),
    histSinAnteriores: $('itf-hist-sin-anteriores'),
    histAnteriores: $('itf-hist-anteriores'),
    histVacio: $('itf-hist-vacio'),
    histLineas: $('itf-hist-lineas'),
    btnHistCerrar: $('btn-itf-hist-cerrar'),
    btnHistCerrar2: $('btn-itf-hist-cerrar2')
  };

  function nodo(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  function boton(texto, nombre, clase, alClick, haspopup) {
    var b = nodo('button', clase || 'button-secondary', texto);
    b.type = 'button';
    b.setAttribute('aria-label', nombre);
    if (haspopup) { b.setAttribute('aria-haspopup', 'dialog'); }
    b.addEventListener('click', function () { alClick(b); });
    return b;
  }

  function ctx() {
    return (obtenerContexto ? obtenerContexto() : null) || {};
  }

  function actualizarBloqueoScroll() {
    document.body.classList.toggle('itf-mod-abierto', accionAbierta || visorAbierto || histAbierto);
  }

  function devolverFoco(abridor, respaldo) {
    if (abridor && abridor.isConnected !== false && !abridor.hidden && typeof abridor.focus === 'function') {
      abridor.focus();
    } else if (respaldo && !respaldo.hidden && typeof respaldo.focus === 'function') {
      respaldo.focus();
    }
  }

  // =====================================================================
  // Cola
  // =====================================================================

  function textoTotal(n) {
    if (n === null) { return ''; }
    return n === 1 ? '1 propuesta pendiente' : n + ' propuestas pendientes';
  }

  function construirTarjeta(it) {
    var li = nodo('li', 'itf-item');
    li.setAttribute('data-clave', it.documentoId);
    li.appendChild(nodo('p', 'itf-item-titulo', 'Pozo ' + it.wellId));
    li.appendChild(nodo('p', '', it.nombreArchivo + (it.tamano ? ' · ' + it.tamano : '')));
    li.appendChild(nodo('p', 'fotos-nota', 'Propuesto por ' + (it.proponente || 'una persona') + (it.enviadaEl ? ' · ' + it.enviadaEl : '')));
    if (it.advertencia) { li.appendChild(nodo('p', 'itf-advertencia', it.advertencia)); }
    var acc = nodo('div', 'itf-item-acciones');
    var ref = 'del pozo ' + it.wellId;
    acc.appendChild(boton('Ver documento', 'Ver documento ' + ref, 'button-secondary', function (b) { abrirVisor(it.documentoId, b); }, true));
    acc.appendChild(boton('Ver pozo', 'Ver pozo ' + it.wellId, 'button-secondary', function () { verPozo(it.wellId); }, false));
    acc.appendChild(boton('Historial', 'Ver historial de ITF ' + ref, 'button-secondary', function (b) { abrirHistorial(it.wellId, b, null); }, true));
    acc.appendChild(boton('Aprobar', 'Aprobar propuesta ' + ref, 'button', function (b) { pedirAccionDeTarjeta('APROBAR', it, b); }, true));
    acc.appendChild(boton('Rechazar', 'Rechazar propuesta ' + ref, 'button-secondary', function (b) { pedirAccionDeTarjeta('RECHAZAR', it, b); }, true));
    li.appendChild(acc);
    return li;
  }

  function pintarCola(sn) {
    el.avisoCola.textContent = sn.aviso ? sn.aviso.texto : '';
    el.avisoCola.className = 'fotos-mod-aviso' + (sn.aviso && sn.aviso.error ? ' fotos-mod-aviso-error' : '');
    el.avisoCola.hidden = !sn.aviso || !sn.aviso.texto;
    el.cargando.hidden = !sn.cargando;
    el.error.hidden = !sn.error;
    el.errorTexto.textContent = sn.error ? sn.error.mensaje : '';
    el.vacio.hidden = !sn.vacia;
    var texto = !sn.cargando && !sn.error ? textoTotal(sn.total === null ? (sn.abierta ? sn.items.length : null) : sn.total) : '';
    el.total.textContent = texto;
    el.total.hidden = texto === '';
    el.sinDerivar.hidden = !(sn.sinDerivar > 0) || sn.cargando || !!sn.error;
    el.btnActualizar.disabled = sn.cargando || sn.cargandoMas;
    el.masError.textContent = sn.errorMas || '';
    el.masError.hidden = !sn.errorMas;
    el.btnMas.hidden = !sn.hayMas || !!sn.error || sn.cargando;
    el.btnMas.disabled = sn.cargandoMas;
    el.btnMas.textContent = sn.cargandoMas ? 'Cargando…' : 'Ver más';
    var firma = sn.cargando || sn.error ? '-' : sn.items.map(function (i) { return i.documentoId; }).join(',');
    if (firma !== firmaLista) {
      firmaLista = firma;
      el.lista.textContent = '';
      if (!sn.cargando && !sn.error) {
        sn.items.forEach(function (it) { el.lista.appendChild(construirTarjeta(it)); });
      }
    }
  }

  function verPozo(wellId) {
    if (typeof opcionesApp.onVerPozo === 'function') { opcionesApp.onVerPozo(wellId); }
  }

  // =====================================================================
  // Visor
  // =====================================================================

  function abrirVisor(documentoId, abridor) {
    if (!visor || accionAbierta) { return; }
    abridorVisor = abridor;
    visorAbierto = true;
    el.visOverlay.hidden = false;
    actualizarBloqueoScroll();
    visor.abrir(documentoId);
    if (typeof el.btnVisCerrar.focus === 'function') { el.btnVisCerrar.focus(); }
  }

  function cerrarVisor() {
    if (!visorAbierto) { return; }
    visorAbierto = false;
    if (visor) { visor.cerrar(); }
    el.visOverlay.hidden = true;
    el.imgProp.removeAttribute('src');
    el.imgVig.removeAttribute('src');
    el.visAviso.hidden = true;
    el.visAviso.textContent = '';
    actualizarBloqueoScroll();
    var b = abridorVisor;
    abridorVisor = null;
    devolverFoco(b, null);
  }

  function aplicarZoom(img, zoom) {
    img.style.width = zoom <= 1 ? '100%' : (zoom * 100) + '%';
    img.style.maxWidth = zoom <= 1 ? '100%' : 'none';
  }

  function ponerImagen(img, dataUri) {
    if (dataUri) {
      if (img.getAttribute('src') !== dataUri) { img.src = dataUri; }
    } else {
      img.removeAttribute('src');
    }
  }

  function pintarVisor(sn) {
    if (!sn.abierto) { return; }
    var d = sn.doc;
    el.visCargando.hidden = !sn.cargando;
    el.visError.hidden = !sn.error;
    el.visErrorTexto.textContent = sn.error ? sn.error.mensaje : '';
    el.visPozo.textContent = sn.wellId ? 'Pozo ' + sn.wellId : '';
    el.visDatos.hidden = !d;
    el.visPaneles.hidden = !d;
    el.visZoom.hidden = !d;
    if (d) {
      el.visEstado.textContent = d.textoEstado;
      el.visNombre.textContent = d.nombre;
      el.visTamano.textContent = d.tamano;
      el.visDtProp.hidden = !d.proponente;
      el.visProponente.hidden = !d.proponente;
      el.visProponente.textContent = d.proponente ? d.proponente + (d.enviadaEl ? ' · ' + d.enviadaEl : '') : '';
      el.visAdvertencia.hidden = !d.advertencia;
      el.visAdvertencia.textContent = d.advertencia;
    } else {
      el.visAdvertencia.hidden = true;
    }
    ponerImagen(el.imgProp, sn.imagen ? sn.imagen.dataUri : null);
    el.capProp.textContent = d ? (d.esPropuesta ? 'Propuesta' : d.nombre) : 'Documento';
    el.capProp.hidden = !sn.comparando;
    // comparacion: tabs (celular, uno por vez) o lado a lado (pantalla ancha); el CSS decide con data-comparando / data-vista
    el.visPaneles.setAttribute('data-comparando', sn.comparando ? 'true' : 'false');
    el.visPaneles.setAttribute('data-vista', sn.vista);
    el.panelVig.hidden = !sn.comparando;
    el.visVistas.hidden = !sn.comparando;
    el.btnVerProp.setAttribute('aria-pressed', sn.vista === 'PROPUESTA' ? 'true' : 'false');
    el.btnVerVig.setAttribute('aria-pressed', sn.vista === 'VIGENTE' ? 'true' : 'false');
    el.btnVerProp.textContent = d && !d.esPropuesta ? 'Este documento' : 'Propuesta';
    el.vigCargando.hidden = sn.vigente.fase !== 'CARGANDO';
    el.vigError.hidden = sn.vigente.fase !== 'ERROR';
    el.vigErrorTexto.textContent = sn.vigente.error || '';
    el.vigScroll.hidden = sn.vigente.fase !== 'LISTO';
    ponerImagen(el.imgVig, sn.vigente.fase === 'LISTO' && sn.vigente.imagen ? sn.vigente.imagen.dataUri : null);
    aplicarZoom(el.imgProp, sn.zoom);
    aplicarZoom(el.imgVig, sn.zoom);
    el.zoomTexto.textContent = Math.round(sn.zoom * 100) + '%';
    el.btnAcercar.disabled = !sn.puedeAcercar;
    el.btnAlejar.disabled = !sn.puedeAlejar;
    // botones
    el.btnComparar.hidden = !d || !sn.puedeComparar;
    el.btnComparar.textContent = sn.comparando ? 'Dejar de comparar' : 'Comparar con el ITF vigente';
    el.btnComparar.setAttribute('aria-pressed', sn.comparando ? 'true' : 'false');
    el.btnVisAprobar.hidden = !d || !d.esPropuesta;
    el.btnVisRechazar.hidden = !d || !d.esPropuesta;
    el.btnVisRestaurar.hidden = !d || !d.restaurable;
    var nota = '';
    if (d && sn.vigenteIndeterminado) {
      nota = itfLogic_mensajeError('ITF_STATE_UNKNOWN');
    } else if (d && !sn.hayVigente) {
      nota = ITF_TEXTO_SIN_VIGENTE;
    }
    el.vigenteNota.textContent = nota;
    el.vigenteNota.hidden = nota === '';
  }

  function avisoVisor(texto, esError) {
    el.visAviso.textContent = texto || '';
    el.visAviso.className = 'fotos-mod-aviso' + (esError ? ' fotos-mod-aviso-error' : '');
    el.visAviso.hidden = !texto;
    if (texto && typeof el.visAviso.focus === 'function') { el.visAviso.focus(); }
  }

  // =====================================================================
  // Acciones (aprobar / rechazar / retirar / restaurar)
  // =====================================================================

  function pedirAccionDeTarjeta(tipo, it, boton) {
    if (!accion || accionAbierta || visorAbierto || histAbierto) { return; }
    abridorAccion = boton;
    origenAccion = 'COLA';
    hooksExternos = null;
    var info = { documentoId: it.documentoId, wellId: it.wellId, entidad: it.nombreArchivo + ' · pozo ' + it.wellId };
    // aprobar necesita saber cual es el vigente: no se conoce desde la cola, se pide al abrir el dialogo (sin imagenes)
    if (!accion.pedir(tipo, info)) { abridorAccion = null; }
  }

  function pedirAccionDeVisor(tipo, boton) {
    if (!accion || accionAbierta || !visor) { return; }
    var info = visor.contextoDeAccion();
    if (info === null) { return; }
    abridorAccion = boton;
    origenAccion = 'VISOR';
    if (!histAbierto) { hooksExternos = null; }
    if (!accion.pedir(tipo, info)) { abridorAccion = null; }
  }

  function pintarAccion(sn) {
    var estaba = accionAbierta;
    accionAbierta = sn !== null;
    el.accOverlay.hidden = !accionAbierta;
    actualizarBloqueoScroll();
    if (!sn) {
      el.accError.textContent = '';
      el.accError.hidden = true;
      el.accMotivo.textContent = '';
      el.accMotivo.removeAttribute('data-tipo');
      el.accTexto.value = '';
      if (estaba) { devolverFocoAccion(); }
      return;
    }
    el.accTitulo.textContent = sn.titulo;
    el.accEntidad.textContent = sn.entidad;
    el.accCargando.hidden = !sn.cargandoContexto;
    el.accAviso.textContent = sn.aviso;
    el.accAviso.hidden = sn.aviso === '';
    var conMotivo = sn.catalogo !== null;
    el.accMotivoGrupo.hidden = !conMotivo;
    if (conMotivo && el.accMotivo.getAttribute('data-tipo') !== sn.tipo + '|' + (sn.reemplaza ? 'R' : 'N')) {
      el.accMotivo.textContent = '';
      var vacia = nodo('option', '', 'Elegí un motivo…');
      vacia.value = '';
      el.accMotivo.appendChild(vacia);
      sn.catalogo.forEach(function (m) {
        var o = nodo('option', '', m.texto);
        o.value = m.codigo;
        el.accMotivo.appendChild(o);
      });
      el.accMotivo.setAttribute('data-tipo', sn.tipo + '|' + (sn.reemplaza ? 'R' : 'N'));
    }
    if (conMotivo && el.accMotivo.value !== sn.motivoCodigo) { el.accMotivo.value = sn.motivoCodigo; }
    el.accTextoGrupo.hidden = !sn.pideTexto;
    if (el.accTexto.value !== sn.motivoTexto) { el.accTexto.value = sn.motivoTexto; }
    var mensaje = sn.errorContexto || (sn.error ? sn.error.mensaje : '');
    el.accError.textContent = mensaje;
    el.accError.hidden = mensaje === '';
    el.btnAccConfirmar.textContent = sn.boton;
    el.btnAccConfirmar.disabled = !sn.puedeEnviar;
    el.btnAccCancelar.disabled = sn.enviando;
    el.btnAccCerrar.disabled = sn.enviando;
    el.accMotivo.disabled = sn.enviando || sn.cargandoContexto;
    el.accTexto.disabled = sn.enviando;
    if (!estaba) { (conMotivo && !sn.cargandoContexto ? el.accMotivo : el.btnAccCancelar).focus(); }
    if (sn.error && !el.accError.hidden && typeof el.accError.focus === 'function' && !sn.enviando) { el.accError.focus(); }
  }

  function devolverFocoAccion() {
    var b = abridorAccion;
    abridorAccion = null;
    if (b && b.isConnected !== false && !b.hidden && typeof b.focus === 'function') {
      b.focus();
    } else if (visorAbierto && !el.visAviso.hidden) {
      el.visAviso.focus();
    } else if (!el.avisoCola.hidden) {
      el.avisoCola.focus();                // la tarjeta ya no esta (se resolvio): el foco va al aviso del resultado
    } else if (typeof el.panelCola.focus === 'function') {
      el.panelCola.focus();
    }
  }

  // Despues de una accion: lo que se veia ya no vale. Se vuelve a pedir la cola, el historial abierto y el contexto del visor; nada se parcha.
  function refrescarTodo(wellId, avisoCola) {
    if (typeof opcionesApp.onCambioDeVigente === 'function') { opcionesApp.onCambioDeVigente(wellId); }
    if (hooksExternos && typeof hooksExternos.alCambio === 'function') { hooksExternos.alCambio(avisoCola ? avisoCola.texto : ''); }
    if (cola.snapshot().abierta) {
      var recarga = avisoCola ? cola.recargarConAviso(avisoCola.texto, avisoCola.error) : cola.recargar();
      // la tarjeta que se uso ya no esta (se resolvio): el foco va al aviso del resultado, no a un boton que desaparecio
      recarga.then(function () {
        if (!histAbierto && !visorAbierto && !accionAbierta && !el.avisoCola.hidden && typeof el.avisoCola.focus === 'function') { el.avisoCola.focus(); }
      });
    }
    if (histAbierto) { historial.recargar(); }
    if (visorAbierto) { visor.recargar(); }
  }

  function alExitoAccion(info) {
    var ui = ITF_ACCIONES_UI[info.tipo];
    var aviso = { texto: ui.exito, error: false };
    var origen = origenAccion;
    if (origen === 'VISOR') {
      cerrarVisor();               // el documento ya se resolvio: se vuelve a la cola, que se actualiza
    }
    refrescarTodo(info.wellId, aviso);
    if (origen === 'HIST') { avisoHistorial(ui.exito, false); }
  }

  function alVigenteCambio(info) {
    var origen = origenAccion;
    var texto = ITF_TEXTO_VIGENTE_CAMBIO;
    if (typeof opcionesApp.onCambioDeVigente === 'function') { opcionesApp.onCambioDeVigente(info.wellId); }
    if (hooksExternos && typeof hooksExternos.alCambio === 'function') { hooksExternos.alCambio(); }
    if (origen === 'VISOR' && visorAbierto) {
      // el contexto se vuelve a pedir (incluida la comparacion): la persona ve el vigente NUEVO antes de decidir
      visor.recargar().then(function () { avisoVisor(texto, true); });
    } else if (origen === 'HIST' && histAbierto) {
      historial.recargar().then(function () { avisoHistorial(texto, true); });
    }
    if (cola.snapshot().abierta) { cola.recargarConAviso(texto, true); }
  }

  function alObsoletoAccion(info) {
    var texto = info.code === 'ITF_NOT_FOUND' ? itfLogic_mensajeError('ITF_NOT_FOUND') : 'Esta propuesta ya no estaba pendiente. Se actualizó la información.';
    if (info.code === 'DESTINO_INVALIDO') { texto = itfLogic_mensajeError('DESTINO_INVALIDO'); }
    var origen = origenAccion;
    if (origen === 'VISOR' && visorAbierto) { cerrarVisor(); }
    refrescarTodo(info.wellId, { texto: texto, error: true });
    if (origen === 'HIST') { avisoHistorial(texto, true); }
  }

  // =====================================================================
  // Historial
  // =====================================================================

  function abrirHistorial(wellId, abridor, hooks) {
    if (!historial || histAbierto || accionAbierta) { return; }
    abridorHist = abridor;
    hooksExternos = hooks || null;
    histAbierto = true;
    el.histOverlay.hidden = false;
    actualizarBloqueoScroll();
    avisoHistorial('', false);
    historial.abrir(wellId);
    if (typeof el.btnHistCerrar.focus === 'function') { el.btnHistCerrar.focus(); }
  }

  function cerrarHistorial() {
    if (!histAbierto) { return; }
    histAbierto = false;
    if (historial) { historial.cerrar(); }
    el.histOverlay.hidden = true;
    firmaHist = '';
    firmaAnteriores = '';
    el.histLineas.textContent = '';
    el.histAnteriores.textContent = '';
    hooksExternos = null;
    actualizarBloqueoScroll();
    var b = abridorHist;
    abridorHist = null;
    devolverFoco(b, null);
  }

  function avisoHistorial(texto, esError) {
    el.histAviso.textContent = texto || '';
    el.histAviso.className = 'fotos-mod-aviso' + (esError ? ' fotos-mod-aviso-error' : '');
    el.histAviso.hidden = !texto;
  }

  function filaLinea(f) {
    var li = nodo('li', 'itf-linea-item');
    var cab = nodo('p', 'itf-linea-cab');
    cab.appendChild(nodo('strong', '', f.titulo));
    cab.appendChild(nodo('span', 'fotos-nota', (f.quien ? ' · ' + f.quien : '') + (f.cuando ? ' · ' + f.cuando : '')));
    li.appendChild(cab);
    if (f.documento) { li.appendChild(nodo('p', 'itf-linea-doc', f.documento)); }
    if (f.detalle) { li.appendChild(nodo('p', '', f.detalle)); }
    if (f.motivo) { li.appendChild(nodo('p', 'itf-motivo', 'Motivo: ' + f.motivo)); }
    return li;
  }

  function filaAnterior(d, wellId) {
    var li = nodo('li', 'itf-item');
    li.setAttribute('data-clave', d.documentoId);
    li.appendChild(nodo('p', 'itf-item-titulo', d.nombre));
    li.appendChild(nodo('p', 'fotos-nota', d.estado + (d.tamano ? ' · ' + d.tamano : '') + (d.vigenteDesde ? ' · fue vigente desde ' + d.vigenteDesde : '')));
    var acc = nodo('div', 'itf-item-acciones');
    acc.appendChild(boton('Ver', 'Ver ' + d.nombre, 'button-secondary', function (b) { abrirVisor(d.documentoId, b); }, true));
    acc.appendChild(boton('Restaurar', 'Restaurar como vigente ' + d.nombre, 'button', function (b) { restaurarDesdeHistorial(d, b); }, true));
    li.appendChild(acc);
    return li;
  }

  function restaurarDesdeHistorial(d, boton) {
    if (!accion || accionAbierta) { return; }
    var sn = historial.snapshot();
    abridorAccion = boton;
    origenAccion = 'HIST';
    // el vigente que ESTA pantalla muestra es el que se declara: si cambio, el servidor responde VIGENTE_CAMBIO
    if (!accion.pedir('RESTAURAR', { documentoId: d.documentoId, wellId: sn.wellId, entidad: d.nombre + ' · pozo ' + sn.wellId, vigenteEsperadoDocumentoId: sn.vigenteActualDocumentoId })) { abridorAccion = null; }
  }

  function retirarDesdeHistorial(boton) {
    if (!accion || accionAbierta) { return; }
    var sn = historial.snapshot();
    if (sn.vigenteActualDocumentoId === null) { return; }
    abridorAccion = boton;
    origenAccion = 'HIST';
    if (!accion.pedir('RETIRAR', { documentoId: sn.vigenteActualDocumentoId, wellId: sn.wellId, entidad: (sn.vigente ? sn.vigente.nombre : 'ITF vigente') + ' · pozo ' + sn.wellId })) { abridorAccion = null; }
  }

  function pintarHistorial(sn) {
    if (!sn.abierto) { return; }
    el.histPozo.textContent = sn.wellId ? 'Pozo ' + sn.wellId : '';
    el.histCargando.hidden = !sn.cargando;
    el.histError.hidden = !sn.error;
    el.histErrorTexto.textContent = sn.error ? sn.error.mensaje : '';
    var hayContenido = !sn.cargando && !sn.error;
    el.histContenido.hidden = !hayContenido;
    if (!hayContenido) { return; }
    el.histVigente.textContent = sn.vigente ? sn.vigente.nombre + (sn.vigente.vigenteDesde ? ' · vigente desde ' + sn.vigente.vigenteDesde : '') : (sn.hayVigente ? 'Hay un ITF vigente.' : ITF_TEXTO_SIN_VIGENTE);
    el.btnHistVerVigente.hidden = !sn.hayVigente;
    el.btnHistRetirar.hidden = !sn.hayVigente;
    el.histSinAnteriores.hidden = sn.restaurables.length > 0;
    var fAnt = sn.restaurables.map(function (d) { return d.documentoId + ':' + d.estado; }).join(',') + '|' + sn.vigenteActualDocumentoId;
    if (fAnt !== firmaAnteriores) {
      firmaAnteriores = fAnt;
      el.histAnteriores.textContent = '';
      sn.restaurables.forEach(function (d) { el.histAnteriores.appendChild(filaAnterior(d, sn.wellId)); });
    }
    el.histVacio.hidden = !sn.vacio;
    var fHist = sn.filas.map(function (f) { return f.clave; }).join('|');
    if (fHist !== firmaHist) {
      firmaHist = fHist;
      el.histLineas.textContent = '';
      sn.filas.forEach(function (f) { el.histLineas.appendChild(filaLinea(f)); });
    }
  }

  // =====================================================================
  // Teclado de los dialogos
  // =====================================================================

  // un elemento dentro de un contenedor oculto no recibe foco
  function esOculto(e) {
    for (var n = e; n && n !== document.body; n = n.parentNode) {
      if (n.hidden === true) { return true; }
    }
    return false;
  }

  function enfocablesDe(lista) {
    return lista.filter(function (e) { return !e.disabled && !esOculto(e); });
  }

  // todos los <button> de un arbol (las listas dinamicas del historial), en orden
  function botonesDe(raiz) {
    var out = [];
    (raiz.children || []).forEach(function (h) {
      if (h.tag === 'button' || h.tagName === 'BUTTON') { out.push(h); }
      botonesDe(h).forEach(function (b) { out.push(b); });
    });
    return out;
  }

  function enfocablesVisor() {
    return enfocablesDe([el.btnVisCerrar, el.btnVisReintentar, el.btnVerProp, el.btnVerVig, el.btnAlejar, el.btnAcercar, el.btnAjustar, el.btnVigReintentar, el.btnComparar, el.btnVisAprobar, el.btnVisRechazar, el.btnVisRestaurar, el.btnVisCerrar2]);
  }

  function enfocablesAccion() {
    return enfocablesDe([el.btnAccCerrar, el.accMotivo, el.accTexto, el.btnAccCancelar, el.btnAccConfirmar]);
  }

  function enfocablesHistorial() {
    return enfocablesDe([el.btnHistCerrar, el.btnHistReintentar, el.btnHistVerVigente, el.btnHistRetirar].concat(botonesDe(el.histAnteriores), [el.btnHistCerrar2]));
  }

  function teclaDeModal(listaEnfocables, cancelar) {
    return function (ev) {
      if (ev.key === 'Escape') {
        if (typeof ev.stopPropagation === 'function') { ev.stopPropagation(); }
        cancelar();
        return;
      }
      if (ev.key === 'Tab') {
        var lista = listaEnfocables();
        var siguiente = itfLogic_siguienteFoco(lista.length, lista.indexOf(document.activeElement), ev.shiftKey === true);
        if (siguiente >= 0) {
          ev.preventDefault();
          lista[siguiente].focus();
        }
      }
    };
  }

  // =====================================================================
  // Ciclo de vida
  // =====================================================================

  function itfModeracionController_inicializar(ctxFn, opciones) {
    obtenerContexto = ctxFn;
    opcionesApp = opciones || {};
    cola = itfFlujos_crearCola({
      obtenerContexto: ctxFn,
      consultar: function (sessionToken, limite, cursor) { return apiGetItfPendientes(sessionToken, limite, cursor); },
      onCambio: pintarCola
    });
    visor = itfFlujos_crearVisor({
      obtenerContexto: ctxFn,
      abrir: function (sessionToken, documentoId) { return apiGetItfDocumentoModeracion(sessionToken, documentoId); },
      onCambio: pintarVisor
    });
    historial = itfFlujos_crearHistorial({
      obtenerContexto: ctxFn,
      consultar: function (sessionToken, wellId) { return apiGetHistorialItf(sessionToken, wellId); },
      onCambio: pintarHistorial
    });
    accion = itfFlujos_crearAccion({
      obtenerContexto: ctxFn,
      cargarContexto: function (sessionToken, wellId) { return apiGetHistorialItf(sessionToken, wellId); },
      enviar: function (tipo, sessionToken, payload) {
        if (tipo === 'APROBAR') { return apiAprobarItf(sessionToken, payload); }
        if (tipo === 'RECHAZAR') { return apiRechazarItf(sessionToken, payload); }
        if (tipo === 'RETIRAR') { return apiRetirarItf(sessionToken, payload); }
        return apiRevertirItf(sessionToken, payload);
      },
      nuevoId: itfLogic_nuevoId,
      onCambio: pintarAccion,
      alExito: alExitoAccion,
      alVigenteCambio: alVigenteCambio,
      alObsoleto: alObsoletoAccion
    });
  }

  function reiniciarPantalla() {
    firmaLista = '';
    el.lista.textContent = '';
    cerrarVisor();
    cerrarHistorial();
    if (accion) { accion.cerrar(); }
    accionAbierta = false;
    el.accOverlay.hidden = true;
    actualizarBloqueoScroll();
  }

  function itfModeracionController_abrir() {
    reiniciarPantalla();
    return cola.abrir();
  }

  // Vuelta desde "Ver pozo": se conserva lo ya cargado (no se vuelve a pedir ni se pierde el lugar).
  function itfModeracionController_volver() {
    return cola.snapshot().abierta ? Promise.resolve(cola.snapshot()) : cola.abrir();
  }

  function itfModeracionController_cerrar() {
    cola.cerrar();
    reiniciarPantalla();
  }

  function itfModeracionController_reset() {
    if (!cola) { return; }
    cola.reset();
    visor.reset();
    historial.reset();
    accion.reset();
    reiniciarPantalla();
    abridorAccion = null;
    abridorVisor = null;
    abridorHist = null;
    hooksExternos = null;
  }

  function itfModeracionController_abrirHistorial(wellId, abridor, hooks) {
    abrirHistorial(wellId, abridor, hooks);
  }

  function itfModeracionController_pedirRetirarVigente(wellId, abridor, hooks) {
    if (!accion || accionAbierta) { return; }
    abridorAccion = abridor;
    origenAccion = 'PERFIL';
    hooksExternos = hooks || null;
    // no se conoce el documento: se lee el vigente actual al abrir el dialogo (una lectura, sin imagenes)
    if (!accion.pedir('RETIRAR', { documentoId: undefined, wellId: wellId, entidad: 'ITF vigente · pozo ' + wellId })) { abridorAccion = null; hooksExternos = null; }
  }

  function itfModeracionController_hayModalAbierto() {
    return accionAbierta || visorAbierto || histAbierto;
  }

  // Eventos de la cola
  el.btnActualizar.addEventListener('click', function () { if (cola) { cola.recargar(); } });
  el.btnReintentar.addEventListener('click', function () { if (cola) { cola.recargar(); } });
  el.btnMas.addEventListener('click', function () { if (cola) { cola.verMas(); } });
  // Eventos del visor
  el.btnVisCerrar.addEventListener('click', cerrarVisor);
  el.btnVisCerrar2.addEventListener('click', cerrarVisor);
  el.btnVisReintentar.addEventListener('click', function () { if (visor) { visor.recargar(); } });
  el.btnVigReintentar.addEventListener('click', function () { if (visor) { visor.comparar(); } });
  el.btnComparar.addEventListener('click', function () {
    if (!visor) { return; }
    if (visor.snapshot().comparando) { visor.dejarDeComparar(); } else { visor.comparar(); }
  });
  el.btnVerProp.addEventListener('click', function () { if (visor) { visor.verVista('PROPUESTA'); } });
  el.btnVerVig.addEventListener('click', function () { if (visor) { visor.verVista('VIGENTE'); } });
  el.btnAcercar.addEventListener('click', function () { if (visor) { visor.acercar(); } });
  el.btnAlejar.addEventListener('click', function () { if (visor) { visor.alejar(); } });
  el.btnAjustar.addEventListener('click', function () { if (visor) { visor.ajustar(); } });
  el.btnVisAprobar.addEventListener('click', function () { pedirAccionDeVisor('APROBAR', el.btnVisAprobar); });
  el.btnVisRechazar.addEventListener('click', function () { pedirAccionDeVisor('RECHAZAR', el.btnVisRechazar); });
  el.btnVisRestaurar.addEventListener('click', function () { pedirAccionDeVisor('RESTAURAR', el.btnVisRestaurar); });
  el.visOverlay.addEventListener('keydown', teclaDeModal(enfocablesVisor, cerrarVisor));
  // Eventos de la accion
  el.accMotivo.addEventListener('change', function () { if (accion) { accion.setMotivo(el.accMotivo.value); } });
  el.accTexto.addEventListener('input', function () { if (accion) { accion.setTexto(el.accTexto.value); } });
  el.btnAccConfirmar.addEventListener('click', function () { if (accion) { accion.confirmar(); } });
  el.btnAccCancelar.addEventListener('click', function () { if (accion) { accion.cancelar(); } });
  el.btnAccCerrar.addEventListener('click', function () { if (accion) { accion.cancelar(); } });
  el.accOverlay.addEventListener('keydown', teclaDeModal(enfocablesAccion, function () { if (accion) { accion.cancelar(); } }));
  // Eventos del historial
  el.btnHistCerrar.addEventListener('click', cerrarHistorial);
  el.btnHistCerrar2.addEventListener('click', cerrarHistorial);
  el.btnHistReintentar.addEventListener('click', function () { if (historial) { historial.recargar(); } });
  el.btnHistVerVigente.addEventListener('click', function () {
    var sn = historial ? historial.snapshot() : null;
    if (sn && sn.vigenteActualDocumentoId !== null) { abrirVisor(sn.vigenteActualDocumentoId, el.btnHistVerVigente); }
  });
  el.btnHistRetirar.addEventListener('click', function () { retirarDesdeHistorial(el.btnHistRetirar); });
  el.histOverlay.addEventListener('keydown', teclaDeModal(enfocablesHistorial, cerrarHistorial));

  window.itfModeracionController_inicializar = itfModeracionController_inicializar;
  window.itfModeracionController_abrir = itfModeracionController_abrir;
  window.itfModeracionController_volver = itfModeracionController_volver;
  window.itfModeracionController_cerrar = itfModeracionController_cerrar;
  window.itfModeracionController_reset = itfModeracionController_reset;
  window.itfModeracionController_abrirHistorial = itfModeracionController_abrirHistorial;
  window.itfModeracionController_pedirRetirarVigente = itfModeracionController_pedirRetirarVigente;
  window.itfModeracionController_hayModalAbierto = itfModeracionController_hayModalAbierto;
})();
