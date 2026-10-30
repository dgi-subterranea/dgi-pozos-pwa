// Controlador DOM de la pantalla Perfil con ITF colaborativos (E9-6, local, NO productivo). Toda la logica (permisos, estados, ids de intencion, respuestas viejas, reintentos) vive en js/itfLogic.js y
// js/itfFlujosLogic.js, con tests; la reduccion de la imagen en js/itfImagen.js; aca solo se pinta y se enganchan los eventos.
//
// Reglas de esta pantalla:
//  - El ITF vigente se pide AL ABRIR (getProfile); buscar un pozo solo consulta la disponibilidad. Para un usuario con solo `perfil` la pantalla es la de siempre: imagen + Guardar / Compartir, o el mensaje
//    "No hay un ITF vigente registrado para este pozo.". Lo colaborativo aparece SOLO con los permisos exactos: proponer / mis propuestas (perfil + perfil_subir), historial y retirar (perfil + perfil_validar).
//  - Nunca se muestra un estado interno, un id, un email ni un hash. Todo texto que viene del servidor (nombre del archivo, motivo) se pinta con textContent: jamas innerHTML con datos.
//  - "Proponer" nunca dice que el ITF ya es vigente: "ITF propuesto. Queda pendiente de validación.". Si ya habia vigente, sigue visible.
//
// API (window.itfPerfilController_*):
//   _inicializar(obtenerContexto, opciones)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}; opciones: {esIOS(): bool}
//   _abrir(wellId)                            la pantalla se muestra: pide el ITF vigente de ese pozo
//   _refrescar()                              vuelve a pedir lo que se ve (cambio el vigente) / _cerrar() / _reset() (cierre de sesion: se descarta todo, tambien lo que este en vuelo)
//   _hayModalAbierto()
(function () {
  var obtenerContexto = null;
  var opcionesApp = {};
  var perfil = null;
  var proponer = null;
  var mis = null;
  var wellIdActual = null;
  var perfilSnap = null;
  var retiroAbierto = false;
  var abridorRetiro = null;

  function $(id) { return document.getElementById(id); }

  var el = {
    wellId: $('perfil-wellid'),
    cargando: $('perfil-cargando'),
    aviso: $('perfil-aviso'),
    avisoTexto: $('perfil-aviso-texto'),
    btnReintentar: $('btn-perfil-reintentar'),
    vigente: $('perfil-vigente'),
    imagen: $('perfil-imagen'),
    guardarA: $('perfil-guardar-a'),
    guardarIOS: $('btn-save-image'),
    colab: $('itf-colab'),
    colabAviso: $('itf-colab-aviso'),
    // proponer
    propBloque: $('itf-proponer-bloque'),
    btnProponer: $('btn-itf-proponer'),
    propPanel: $('itf-proponer-panel'),
    propTitulo: $('itf-prop-titulo'),
    inputArchivo: $('itf-archivo-input'),
    btnElegir: $('btn-itf-elegir'),
    propPreparando: $('itf-prop-preparando'),
    propResumen: $('itf-prop-resumen'),
    propPreview: $('itf-prop-preview'),
    propNombre: $('itf-prop-nombre'),
    propTamOriginal: $('itf-prop-tam-original'),
    propTamFinal: $('itf-prop-tam-final'),
    propDim: $('itf-prop-dim'),
    propAccionImg: $('itf-prop-accion-img'),
    propMensaje: $('itf-prop-mensaje'),
    btnPropEnviar: $('btn-itf-prop-enviar'),
    btnPropCancelar: $('btn-itf-prop-cancelar'),
    // mis propuestas
    misBloque: $('itf-mis-bloque'),
    btnMis: $('btn-itf-mis-propuestas'),
    misPanel: $('itf-mis-panel'),
    btnMisPozo: $('btn-itf-mis-pozo'),
    btnMisTodos: $('btn-itf-mis-todos'),
    misAviso: $('itf-mis-aviso'),
    misCargando: $('itf-mis-cargando'),
    misError: $('itf-mis-error'),
    misErrorTexto: $('itf-mis-error-texto'),
    btnMisReintentar: $('btn-itf-mis-reintentar'),
    misVacio: $('itf-mis-vacio'),
    misIncompleta: $('itf-mis-incompleta'),
    misLista: $('itf-mis-lista'),
    misMasError: $('itf-mis-mas-error'),
    btnMisMas: $('btn-itf-mis-mas'),
    // validador
    valBloque: $('itf-validador-bloque'),
    btnHistorial: $('btn-itf-historial'),
    btnRetirarVigente: $('btn-itf-retirar-vigente'),
    // retiro de la propia propuesta
    retiroOverlay: $('itf-retiro-overlay'),
    retiroEntidad: $('itf-retiro-entidad'),
    retiroError: $('itf-retiro-error'),
    btnRetiroCerrar: $('btn-itf-retiro-cerrar'),
    btnRetiroCancelar: $('btn-itf-retiro-cancelar'),
    btnRetiroConfirmar: $('btn-itf-retiro-confirmar')
  };

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

  // =====================================================================
  // El ITF vigente
  // =====================================================================

  function base64AFile(base64, mimeType, nombre) {
    var bin = atob(base64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    return new File([bytes], nombre, { type: mimeType });
  }

  // iOS no ofrece <a download> de forma confiable para imagenes: se usa el share sheet nativo (Web Share API con archivos) y, si no esta, se abre la imagen en una pestana nueva.
  function guardarEnIOS(sn) {
    var file = base64AFile(sn.imagen.base64, sn.imagen.mimeType, itfLogic_nombreDescarga(sn.wellId, sn.imagen.mimeType));
    var soporta = false;
    try { soporta = !!(navigator.canShare && navigator.canShare({ files: [file] })); } catch (err) { soporta = false; }
    if (soporta) {
      navigator.share({ files: [file], title: 'Perfil ' + sn.wellId }).catch(function () { /* cancelado por la persona: no es un error */ });
      return;
    }
    window.open(sn.imagen.dataUri, '_blank');
  }

  function pintarPerfil(sn) {
    perfilSnap = sn;
    var cargando = sn.fase === 'CARGANDO';
    el.cargando.hidden = !cargando;
    var hayAviso = sn.fase === 'SIN_ITF' || sn.fase === 'ERROR';
    el.aviso.hidden = !hayAviso;
    el.avisoTexto.textContent = hayAviso ? sn.mensaje : '';
    el.avisoTexto.className = sn.fase === 'ERROR' ? 'error-message' : 'itf-sin-itf';
    el.avisoTexto.setAttribute('role', sn.fase === 'ERROR' ? 'alert' : 'status');
    el.btnReintentar.hidden = !sn.reintentable;
    var hayImagen = sn.fase === 'LISTO' && sn.imagen !== null;
    el.vigente.hidden = !hayImagen;
    if (hayImagen) {
      if (el.imagen.getAttribute('src') !== sn.imagen.dataUri) { el.imagen.src = sn.imagen.dataUri; }
      el.imagen.alt = 'Perfil del pozo ' + sn.wellId;
      var ios = typeof opcionesApp.esIOS === 'function' && opcionesApp.esIOS();
      el.guardarIOS.hidden = !ios;
      el.guardarA.hidden = ios;
      el.guardarA.href = sn.imagen.dataUri;
      el.guardarA.setAttribute('download', itfLogic_nombreDescarga(sn.wellId, sn.imagen.mimeType));
    } else {
      el.imagen.removeAttribute('src');
      el.guardarA.removeAttribute('href');
    }
    pintarColaborativo();
  }

  // Las funciones colaborativas dependen de los permisos de HOY y de saber si hay vigente (el boton dice "Proponer ITF" o "Proponer nueva versión"). Mientras carga o si no se pudo saber, no se ofrecen.
  function pintarColaborativo() {
    var p = permisos();
    var puedeProponer = itfLogic_puedeProponer(p);
    var puedeValidar = itfLogic_puedeValidar(p);
    var sabe = perfilSnap !== null && (perfilSnap.fase === 'LISTO' || perfilSnap.fase === 'SIN_ITF');
    var hayVigente = perfilSnap !== null && perfilSnap.fase === 'LISTO';
    el.colab.hidden = !(puedeProponer || puedeValidar);
    el.propBloque.hidden = !(puedeProponer && sabe);
    el.misBloque.hidden = !puedeProponer;
    el.valBloque.hidden = !puedeValidar;
    el.btnRetirarVigente.hidden = !(puedeValidar && hayVigente);
    el.btnProponer.textContent = hayVigente ? 'Proponer nueva versión' : 'Proponer ITF';
  }

  // =====================================================================
  // Proponer
  // =====================================================================

  function pintarProponer(sn) {
    el.propPanel.hidden = !sn.abierto;
    el.btnProponer.setAttribute('aria-expanded', sn.abierto ? 'true' : 'false');
    if (!sn.abierto) {
      // cerrado: no queda la vista previa (su URL ya se libero), ni el resumen, ni un mensaje viejo
      el.propPreview.removeAttribute('src');
      el.propResumen.hidden = true;
      el.propMensaje.hidden = true;
      el.propMensaje.textContent = '';
      return;
    }
    el.propTitulo.textContent = sn.titulo;
    el.propPreparando.hidden = !sn.preparando;
    var conImagen = !!sn.preview && !sn.enviado;
    el.propResumen.hidden = !conImagen;
    if (conImagen) {
      if (el.propPreview.getAttribute('src') !== sn.preview) { el.propPreview.src = sn.preview; }
      el.propNombre.textContent = sn.nombre;
      el.propTamOriginal.textContent = sn.tamanoOriginal;
      el.propTamFinal.textContent = sn.tamanoFinal;
      el.propDim.textContent = sn.dimensiones;
      el.propAccionImg.textContent = sn.accionImagen === 'REDUCIDA' ? 'La imagen se redujo para poder enviarla; se ve como va a quedar.' : 'Se envía la imagen tal cual la elegiste.';
    } else {
      el.propPreview.removeAttribute('src');
    }
    var m = sn.mensaje;
    el.propMensaje.hidden = !m;
    el.propMensaje.textContent = m ? m.texto : '';
    el.propMensaje.className = 'fotos-mod-aviso' + (m && m.tipo === 'error' ? ' fotos-mod-aviso-error' : '');
    el.propMensaje.setAttribute('role', m && m.tipo === 'error' ? 'alert' : 'status');
    el.btnPropEnviar.disabled = !sn.puedeEnviar;
    el.btnPropEnviar.textContent = sn.textoBoton;
    el.btnElegir.disabled = sn.enviando || sn.preparando;
    el.btnElegir.textContent = sn.preview || sn.enviado ? 'Elegir otra imagen' : 'Elegir imagen';
    if (sn.enviado && typeof el.propMensaje.focus === 'function') { el.propMensaje.focus(); }
  }

  function abrirProponer() {
    if (!proponer) { return; }
    var sn = proponer.snapshot();
    if (sn.abierto) {
      proponer.cerrar();
      return;
    }
    if (proponer.abrir(wellIdActual, perfilSnap !== null && perfilSnap.fase === 'LISTO')) {
      if (typeof el.btnElegir.focus === 'function') { el.btnElegir.focus(); }
    } else {
      mostrarAvisoColab(itfLogic_mensajeError('PERMISSION_DENIED'));
      pintarColaborativo();
    }
  }

  function mostrarAvisoColab(texto) {
    el.colabAviso.textContent = texto || '';
    el.colabAviso.hidden = !texto;
  }

  // =====================================================================
  // Mis propuestas
  // =====================================================================

  function tarjetaPropuesta(it) {
    var li = nodo('li', 'itf-item');
    li.setAttribute('data-clave', it.documentoId);
    var cab = nodo('p', 'itf-item-titulo');
    cab.appendChild(nodo('span', '', 'Pozo ' + it.wellId));
    cab.appendChild(nodo('span', 'itf-chip itf-chip-' + it.estado.toLowerCase(), it.textoEstado));
    li.appendChild(cab);
    li.appendChild(nodo('p', '', it.nombre + (it.tamano ? ' · ' + it.tamano : '')));
    li.appendChild(nodo('p', 'fotos-nota', 'Enviada el ' + it.enviadaEl + (it.decididaEl ? ' · Resuelta el ' + it.decididaEl : '')));
    if (it.motivo) { li.appendChild(nodo('p', 'itf-motivo', 'Motivo: ' + it.motivo)); }
    if (it.puedeRetirar) {
      var acc = nodo('div', 'itf-item-acciones');
      var b = nodo('button', 'button-secondary', 'Retirar propuesta');
      b.type = 'button';
      b.setAttribute('aria-label', 'Retirar la propuesta de ITF del pozo ' + it.wellId);
      b.setAttribute('aria-haspopup', 'dialog');
      b.addEventListener('click', function () { pedirRetiro(it, b); });
      acc.appendChild(b);
      li.appendChild(acc);
    }
    return li;
  }

  var firmaMis = '';

  function pintarMis(sn) {
    el.misPanel.hidden = !sn.abierto;
    el.btnMis.setAttribute('aria-expanded', sn.abierto ? 'true' : 'false');
    if (!sn.abierto) { firmaMis = ''; return; }
    el.btnMisPozo.setAttribute('aria-pressed', sn.alcance === 'POZO' ? 'true' : 'false');
    el.btnMisTodos.setAttribute('aria-pressed', sn.alcance === 'TODOS' ? 'true' : 'false');
    el.misAviso.hidden = !sn.aviso || !sn.aviso.texto;
    el.misAviso.textContent = sn.aviso ? sn.aviso.texto : '';
    el.misAviso.className = 'fotos-mod-aviso' + (sn.aviso && sn.aviso.error ? ' fotos-mod-aviso-error' : '');
    el.misCargando.hidden = !sn.cargando;
    el.misError.hidden = !sn.error;
    el.misErrorTexto.textContent = sn.error ? sn.error.mensaje : '';
    el.misVacio.hidden = !sn.vacia;
    el.misVacio.textContent = sn.vacia ? (sn.alcance === 'POZO' ? 'No tenés propuestas de ITF para este pozo.' : 'Todavía no hiciste propuestas de ITF.') : '';
    el.misIncompleta.hidden = !sn.incompleta;
    el.misMasError.hidden = !sn.errorMas;
    el.misMasError.textContent = sn.errorMas || '';
    el.btnMisMas.hidden = !sn.hayMas || !!sn.error || sn.cargando;
    el.btnMisMas.disabled = sn.cargandoMas;
    el.btnMisMas.textContent = sn.cargandoMas ? 'Cargando…' : 'Ver más';
    // la lista solo se reconstruye si cambia (no se pierde el foco al pintar por otra razon)
    var firma = sn.alcance + '|' + (sn.cargando || sn.error ? '-' : sn.items.map(function (i) { return i.documentoId + ':' + i.estado; }).join(','));
    if (firma !== firmaMis) {
      firmaMis = firma;
      el.misLista.textContent = '';
      if (!sn.cargando && !sn.error) {
        sn.items.forEach(function (it) { el.misLista.appendChild(tarjetaPropuesta(it)); });
      }
    }
    pintarRetiro(sn.retiro);
  }

  function pintarRetiro(r) {
    var estaba = retiroAbierto;
    retiroAbierto = !!r;
    el.retiroOverlay.hidden = !r;
    document.body.classList.toggle('itf-mod-abierto', retiroAbierto);
    if (!r) {
      el.retiroError.textContent = '';
      el.retiroError.hidden = true;
      if (estaba) { devolverFocoRetiro(); }
      return;
    }
    el.retiroError.textContent = r.error || '';
    el.retiroError.hidden = !r.error;
    el.btnRetiroConfirmar.disabled = r.enviando;
    el.btnRetiroConfirmar.textContent = r.enviando ? 'Retirando…' : 'Retirar propuesta';
    el.btnRetiroCancelar.disabled = r.enviando;
    el.btnRetiroCerrar.disabled = r.enviando;
    if (!estaba) { el.btnRetiroCancelar.focus(); }
  }

  function devolverFocoRetiro() {
    var b = abridorRetiro;
    abridorRetiro = null;
    if (b && b.isConnected !== false && !b.hidden && typeof b.focus === 'function') {
      b.focus();
    } else if (!el.misAviso.hidden && typeof el.misAviso.focus === 'function') {
      el.misAviso.focus();                 // la propuesta ya no esta en la lista: el foco va al resultado
    } else if (typeof el.btnMis.focus === 'function') {
      el.btnMis.focus();
    }
  }

  function pedirRetiro(it, boton) {
    if (!mis || retiroAbierto) { return; }
    abridorRetiro = boton;
    el.retiroEntidad.textContent = 'Pozo ' + it.wellId + ' · ' + it.nombre;
    if (!mis.pedirRetiro(it.documentoId)) { abridorRetiro = null; }
  }

  function abrirMis() {
    if (!mis) { return; }
    if (mis.snapshot().abierto) {
      mis.cerrar();
      return;
    }
    mis.abrir(wellIdActual);
  }

  // =====================================================================
  // Teclado de los dialogos
  // =====================================================================

  function enfocablesRetiro() {
    return [el.btnRetiroCerrar, el.btnRetiroCancelar, el.btnRetiroConfirmar].filter(function (e) { return !e.disabled; });
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

  function itfPerfilController_inicializar(ctxFn, opciones) {
    obtenerContexto = ctxFn;
    opcionesApp = opciones || {};
    perfil = itfFlujos_crearPerfil({
      obtenerContexto: ctxFn,
      cargar: function (sessionToken, wellId) { return apiGetProfile(sessionToken, wellId); },
      onCambio: pintarPerfil
    });
    proponer = itfFlujos_crearProponer({
      obtenerContexto: ctxFn,
      preparar: itfImagen_preparar,
      enviar: function (sessionToken, payload) { return apiProponerItf(sessionToken, payload); },
      nuevoId: itfLogic_nuevoId,
      liberarPreview: function (url) { try { URL.revokeObjectURL(url); } catch (err) { /* sin URL.revokeObjectURL: nada que liberar */ } },
      onCambio: pintarProponer,
      alProponer: function () {
        // la lista de propuestas (si esta abierta) se vuelve a pedir: nunca muestra algo anterior a esta propuesta
        if (mis && mis.snapshot().abierto) { mis.recargar(); }
      }
    });
    mis = itfFlujos_crearMisPropuestas({
      obtenerContexto: ctxFn,
      consultar: function (sessionToken, wellId, limite, cursor) { return apiGetMisPropuestasItf(sessionToken, wellId, limite, cursor); },
      retirar: function (sessionToken, payload) { return apiRetirarPropuestaItf(sessionToken, payload); },
      nuevoId: itfLogic_nuevoId,
      onCambio: pintarMis
    });
  }

  function limpiarPantalla() {
    wellIdActual = null;
    perfilSnap = null;
    firmaMis = '';
    el.misLista.textContent = '';
    el.propPreview.removeAttribute('src');
    el.imagen.removeAttribute('src');
    el.guardarA.removeAttribute('href');
    mostrarAvisoColab('');
    el.inputArchivo.value = '';
    retiroAbierto = false;
    abridorRetiro = null;
    el.retiroOverlay.hidden = true;
    document.body.classList.toggle('itf-mod-abierto', false);
  }

  function itfPerfilController_abrir(wellId) {
    proponer.cerrar();
    mis.cerrar();
    limpiarPantalla();
    wellIdActual = wellId;
    el.wellId.textContent = wellId;
    pintarColaborativo();
    return perfil.abrir(wellId);
  }

  function itfPerfilController_refrescar() {
    if (perfil && wellIdActual !== null) { return perfil.refrescar(); }
    return Promise.resolve(null);
  }

  function itfPerfilController_cerrar() {
    if (!perfil) { return; }
    perfil.reset();
    proponer.cerrar();
    mis.cerrar();
    limpiarPantalla();
  }

  // Cierre de sesion: nada de la pantalla sobrevive (ni la imagen, ni las propuestas, ni lo que este en vuelo).
  function itfPerfilController_reset() {
    if (!perfil) { return; }
    perfil.reset();
    proponer.reset();
    mis.reset();
    limpiarPantalla();
    el.wellId.textContent = '';
    el.vigente.hidden = true;
    el.aviso.hidden = true;
    el.colab.hidden = true;
  }

  function itfPerfilController_hayModalAbierto() {
    return retiroAbierto;
  }

  // Despues de aprobar / retirar / restaurar desde esta pantalla: se avisa el resultado y el ITF que se ve se vuelve a pedir (nunca queda el anterior).
  function alCambioDeModeracion(texto) {
    mostrarAvisoColab(texto || '');
    return itfPerfilController_refrescar();
  }

  // Eventos
  el.btnReintentar.addEventListener('click', function () { if (perfil) { perfil.reintentar(); } });
  el.guardarIOS.addEventListener('click', function () { if (perfilSnap && perfilSnap.imagen) { guardarEnIOS(perfilSnap); } });
  el.btnProponer.addEventListener('click', abrirProponer);
  el.btnElegir.addEventListener('click', function () { el.inputArchivo.click(); });
  el.inputArchivo.addEventListener('change', function () {
    var archivo = el.inputArchivo.files && el.inputArchivo.files[0];
    el.inputArchivo.value = '';             // se puede volver a elegir el mismo archivo
    if (archivo && proponer) { proponer.elegir(archivo); }
  });
  el.btnPropEnviar.addEventListener('click', function () { if (proponer) { proponer.enviar(); } });
  el.btnPropCancelar.addEventListener('click', function () { if (proponer) { proponer.cerrar(); } if (typeof el.btnProponer.focus === 'function') { el.btnProponer.focus(); } });
  el.btnMis.addEventListener('click', abrirMis);
  el.btnMisPozo.addEventListener('click', function () { if (mis) { mis.cambiarAlcance('POZO'); } });
  el.btnMisTodos.addEventListener('click', function () { if (mis) { mis.cambiarAlcance('TODOS'); } });
  el.btnMisReintentar.addEventListener('click', function () { if (mis) { mis.recargar(); } });
  el.btnMisMas.addEventListener('click', function () { if (mis) { mis.verMas(); } });
  el.btnRetiroConfirmar.addEventListener('click', function () { if (mis) { mis.confirmarRetiro(); } });
  el.btnRetiroCancelar.addEventListener('click', function () { if (mis) { mis.cancelarRetiro(); } });
  el.btnRetiroCerrar.addEventListener('click', function () { if (mis) { mis.cancelarRetiro(); } });
  el.retiroOverlay.addEventListener('keydown', teclaDeModal(enfocablesRetiro, function () { if (mis) { mis.cancelarRetiro(); } }));
  el.btnHistorial.addEventListener('click', function () {
    if (typeof itfModeracionController_abrirHistorial === 'function' && wellIdActual !== null) {
      itfModeracionController_abrirHistorial(wellIdActual, el.btnHistorial, { alCambio: alCambioDeModeracion });
    }
  });
  el.btnRetirarVigente.addEventListener('click', function () {
    if (typeof itfModeracionController_pedirRetirarVigente === 'function' && wellIdActual !== null) {
      itfModeracionController_pedirRetirarVigente(wellIdActual, el.btnRetirarVigente, { alCambio: alCambioDeModeracion });
    }
  });

  window.itfPerfilController_inicializar = itfPerfilController_inicializar;
  window.itfPerfilController_abrir = itfPerfilController_abrir;
  window.itfPerfilController_refrescar = itfPerfilController_refrescar;
  window.itfPerfilController_cerrar = itfPerfilController_cerrar;
  window.itfPerfilController_reset = itfPerfilController_reset;
  window.itfPerfilController_hayModalAbierto = itfPerfilController_hayModalAbierto;
})();
