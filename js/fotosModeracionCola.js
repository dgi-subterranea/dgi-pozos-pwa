// Controlador DOM de la pantalla "Fotos pendientes" (E8-5, solo fotos + fotos_moderar): dos pestañas (Pendientes: solicitudes de retiro abiertas; Retiradas: fotos retiradas que se pueden reponer), tarjetas
// con miniatura lazy, "Ver mas", aprobar / rechazar / reponer con confirmacion, la foto a tamano completo y el historial (que reutiliza el dialogo de js/fotosModeracion.js). Toda la logica (permisos, listas,
// paginacion, respuestas viejas, acciones, cola de miniaturas) vive en js/fotosModeracionColaLogic.js, con tests; aca solo se pinta.
//
// Reglas de esta pantalla:
//  - La tarjeta del hub NO carga nada: la primera pagina se pide recien al abrir la pantalla (_abrir). Sin fotos + fotos_moderar no se pide nada.
//  - Las imagenes (miniatura y completa) salen SIEMPRE de getFotoPozoModeracion; nunca del endpoint normal. Una miniatura que falla deja un recuadro "Sin vista previa" y la solicitud sigue siendo resoluble.
//  - Una pagina por vez. No hay filtros de cliente (filtrar solo la pagina cargada daria la impresion de buscar en toda la cola).
//  - Todo texto de datos se pinta con textContent (jamas innerHTML). No se muestran emails, secuencias, clientRequestId ni ids de Drive. Nada se escribe en storage ni se loguea.
//
// API (window.fotosModeracionColaController_*):
//   _inicializar(obtenerContexto)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir()                        la pantalla se muestra: pide la primera pagina de Pendientes (false si no hay permiso)
//   _cerrar() / _reset()            salir de la pantalla / cerrar sesion: se descarta todo, tambien lo que este en vuelo
//   _hayModalAbierto()
(function () {
  var obtenerContexto = null;
  var cola = null;
  var colaMiniaturas = null;
  var historialAbierto = false;

  function $(id) { return document.getElementById(id); }

  var tabEls = { PENDIENTES: $('fotos-cola-tab-pendientes'), RETIRADAS: $('fotos-cola-tab-retiradas') };
  var panelEl = $('fotos-cola-panel');
  var avisoEl = $('fotos-cola-aviso');
  var totalEl = $('fotos-cola-total');
  var btnActualizarEl = $('btn-fotos-cola-actualizar');
  var cargandoEl = $('fotos-cola-cargando');
  var errorEl = $('fotos-cola-error');
  var errorTextoEl = $('fotos-cola-error-texto');
  var btnReintentarEl = $('btn-fotos-cola-reintentar');
  var vacioEl = $('fotos-cola-vacio');
  var listaEl = $('fotos-cola-lista');
  var masErrorEl = $('fotos-cola-mas-error');
  var btnMasEl = $('btn-fotos-cola-mas');
  // confirmacion
  var confOverlayEl = $('fotos-cola-conf-overlay');
  var confTituloEl = $('fotos-cola-conf-titulo');
  var confEntidadEl = $('fotos-cola-conf-entidad');
  var confTextoEl = $('fotos-cola-conf-texto');
  var confExtraEl = $('fotos-cola-conf-extra');
  var confErrorEl = $('fotos-cola-conf-error');
  var btnConfCerrarEl = $('btn-fotos-cola-conf-cerrar');
  var btnConfCancelarEl = $('btn-fotos-cola-conf-cancelar');
  var btnConfConfirmarEl = $('btn-fotos-cola-conf-confirmar');
  // foto a tamano completo
  var visOverlayEl = $('fotos-cola-vis-overlay');
  var visPieEl = $('fotos-cola-vis-pie');
  var visCargandoEl = $('fotos-cola-vis-cargando');
  var visImgEl = $('fotos-cola-vis-img');
  var visErrorEl = $('fotos-cola-vis-error');
  var btnVisCerrarEl = $('btn-fotos-cola-vis-cerrar');
  var btnVisCerrar2El = $('btn-fotos-cola-vis-cerrar2');

  var observador = null;
  var firmaLista = '';
  var confAbierto = false;
  var visAbierto = false;
  var visToken = 0;
  var abridorConf = null;
  var abridorVis = null;

  function nodo(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  function ctx() {
    return (obtenerContexto ? obtenerContexto() : null) || {};
  }

  function sesionVencida() {
    var c = ctx();
    if (typeof c.onSessionExpired === 'function') { c.onSessionExpired(); }
  }

  // =====================================================================
  // Imagenes (siempre getFotoPozoModeracion)
  // =====================================================================

  function errorConCodigo(code) {
    var e = new Error(code);
    e.codigo = code;
    return e;
  }

  function pedirImagen(fotoId, variante) {
    var c = ctx();
    if (!fotosModeracionColaLogic_puedeVer(c.permisos)) { return Promise.reject(errorConCodigo('PERMISSION_DENIED')); }
    return apiGetFotoPozoModeracion(c.sessionToken, fotoId, variante).then(function (r) {
      if (!r || r.status !== 'ok' || !r.data || typeof r.data.imagenBase64 !== 'string' || typeof r.data.mimeType !== 'string') {
        var code = (r && typeof r.code === 'string' && r.code) || 'ERROR';
        if (fotosModeracionLogic_esErrorDeSesion(code)) { sesionVencida(); }
        throw errorConCodigo(code);
      }
      return 'data:' + r.data.mimeType + ';base64,' + r.data.imagenBase64;
    });
  }

  function cargarMiniatura(img) {
    var fotoId = img.getAttribute('data-foto-id');
    colaMiniaturas.pedir(fotoId).then(function (url) {
      img.src = url;
      img.hidden = false;
    }, function () {
      // sin vista previa: la solicitud / la foto sigue siendo resoluble
      if (img.parentNode && !img.parentNode.getAttribute('data-sin-vista')) {
        img.parentNode.setAttribute('data-sin-vista', 'true');
        img.parentNode.appendChild(nodo('span', 'fotos-cola-mini-vacia', FOTOS_COLA_MENSAJE_SIN_VISTA_PREVIA));
      }
    });
  }

  function observadorMiniaturas() {
    if (observador || typeof IntersectionObserver !== 'function') { return observador; }
    observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) {
          observador.unobserve(e.target);
          cargarMiniatura(e.target.children[0]);        // se observa el recuadro (siempre visible), no la <img> oculta: un elemento display:none nunca "intersecta"
        }
      });
    }, { rootMargin: '200px' });
    return observador;
  }

  // =====================================================================
  // Tarjetas
  // =====================================================================

  function textoFoto(f) {
    if (!f) { return ''; }
    var partes = [f.fecha ? 'Foto del ' + f.fecha : '', f.fuente, f.tipo].filter(function (x) { return !!x; });
    return partes.join(' · ');
  }

  function boton(texto, nombre, clase, alClick, haspopup) {
    var b = nodo('button', clase || 'button-secondary', texto);
    b.type = 'button';
    b.setAttribute('aria-label', nombre);
    if (haspopup) { b.setAttribute('aria-haspopup', 'dialog'); }
    b.addEventListener('click', function () { alClick(b); });
    return b;
  }

  function construirTarjeta(it, pestana) {
    var li = nodo('li', 'fotos-cola-item');
    li.setAttribute('data-clave', it.clave);
    var mini = nodo('div', 'fotos-cola-mini');
    var img = nodo('img');
    img.alt = 'Foto de ' + it.entidad;
    img.hidden = true;
    img.setAttribute('data-foto-id', it.fotoId);
    mini.appendChild(img);
    li.appendChild(mini);
    var obs = observadorMiniaturas();
    if (obs) { obs.observe(mini); } else { cargarMiniatura(img); }

    var cuerpo = nodo('div', 'fotos-cola-cuerpo');
    cuerpo.appendChild(nodo('p', 'fotos-cola-entidad', it.entidad));
    if (pestana === FOTOS_COLA_PENDIENTES) {
      cuerpo.appendChild(nodo('p', '', 'Solicitado por ' + it.nombre + (it.fecha ? ' · ' + it.fecha : '')));
    } else {
      cuerpo.appendChild(nodo('p', '', it.quien + (it.fecha ? ' · ' + it.fecha : '')));
    }
    if (it.motivo) { cuerpo.appendChild(nodo('p', 'fotos-cola-motivo', 'Motivo: ' + it.motivo)); }
    if (it.texto) { cuerpo.appendChild(nodo('p', 'fotos-cola-texto', it.texto)); }
    var meta = textoFoto(it.foto);
    if (meta) { cuerpo.appendChild(nodo('p', 'fotos-nota', meta)); }
    if (pestana === FOTOS_COLA_RETIRADAS && it.pendienteBorrado) {
      var p = nodo('p');
      p.appendChild(nodo('span', 'fotos-mod-insignia fotos-mod-insignia-alerta', FOTOS_MODERACION_AVISO_PENDIENTE_BORRADO));
      cuerpo.appendChild(p);
    }
    li.appendChild(cuerpo);

    var acciones = nodo('div', 'fotos-cola-acciones');
    acciones.appendChild(boton('Abrir foto', 'Abrir foto de ' + it.entidad, 'button-secondary', function (b) { abrirFoto(it, b); }, true));
    acciones.appendChild(boton('Ver historial', 'Ver historial de ' + it.entidad, 'button-secondary', function (b) { abrirHistorialDe(it, b); }, true));
    if (pestana === FOTOS_COLA_PENDIENTES) {
      acciones.appendChild(boton('Aprobar retiro', 'Aprobar retiro de ' + it.entidad, 'button', function (b) { pedirAccion('APROBAR', it, b); }, true));
      acciones.appendChild(boton('Rechazar', 'Rechazar retiro de ' + it.entidad, 'button-secondary', function (b) { pedirAccion('RECHAZAR', it, b); }, true));
    } else {
      acciones.appendChild(boton('Reponer', 'Reponer foto de ' + it.entidad, 'button', function (b) { pedirAccion('REPONER', it, b); }, true));
    }
    li.appendChild(acciones);
    return li;
  }

  // =====================================================================
  // Pantalla
  // =====================================================================

  function pintar(e) {
    // pestañas
    ['PENDIENTES', 'RETIRADAS'].forEach(function (p) {
      var activa = e.pestana === p;
      tabEls[p].setAttribute('aria-selected', activa ? 'true' : 'false');
      tabEls[p].setAttribute('tabindex', activa ? '0' : '-1');
    });
    panelEl.setAttribute('aria-labelledby', e.pestana === FOTOS_COLA_RETIRADAS ? 'fotos-cola-tab-retiradas' : 'fotos-cola-tab-pendientes');
    var l = e.pestana === FOTOS_COLA_RETIRADAS ? e.retiradas : e.pendientes;

    avisoEl.textContent = e.aviso.texto;
    avisoEl.className = 'fotos-mod-aviso' + (e.aviso.error ? ' fotos-mod-aviso-error' : '');
    avisoEl.hidden = !e.aviso.texto;

    cargandoEl.hidden = !l.cargando;
    errorEl.hidden = !l.error;
    errorTextoEl.textContent = l.error ? l.error.mensaje : '';
    vacioEl.hidden = !l.vacia;
    vacioEl.textContent = l.vacia ? FOTOS_COLA_VACIO[e.pestana] : '';
    var texto = !l.cargando && !l.error ? fotosModeracionColaLogic_textoTotal(e.pestana, l.total === null ? l.items.length : l.total) : '';
    totalEl.textContent = texto;
    totalEl.hidden = texto === '';
    btnActualizarEl.disabled = l.cargando || l.cargandoMas;
    masErrorEl.textContent = l.errorMas || '';
    masErrorEl.hidden = !l.errorMas;
    btnMasEl.hidden = !l.hayMas || !!l.error || l.cargando;
    btnMasEl.disabled = l.cargandoMas;
    btnMasEl.textContent = l.cargandoMas ? 'Cargando…' : 'Ver más';

    // la lista solo se reconstruye si cambia (no se pierde el foco al pintar por otra razon)
    var firma = e.pestana + '|' + (l.cargando || l.error ? '-' : l.items.map(function (it) { return it.clave + (it.pendienteBorrado ? '!' : ''); }).join(','));
    if (firma !== firmaLista) {
      firmaLista = firma;
      listaEl.textContent = '';
      if (!l.cargando && !l.error) {
        l.items.forEach(function (it) { listaEl.appendChild(construirTarjeta(it, e.pestana)); });
      }
    }
    pintarConfirmacion(e.accion);
  }

  function pintarConfirmacion(a) {
    var estaba = confAbierto;
    confAbierto = !!a;
    confOverlayEl.hidden = !a;
    actualizarBloqueoScroll();
    if (!a) {
      confErrorEl.textContent = '';
      confErrorEl.hidden = true;
      if (estaba) { devolverFocoConf(); }
      return;
    }
    confTituloEl.textContent = a.titulo;
    confEntidadEl.textContent = a.entidad;
    confTextoEl.textContent = a.texto;
    confExtraEl.textContent = a.extra;
    confExtraEl.hidden = !a.extra;
    btnConfConfirmarEl.textContent = a.boton;
    btnConfConfirmarEl.disabled = !a.puedeEnviar;
    btnConfCancelarEl.disabled = a.enviando;
    btnConfCerrarEl.disabled = a.enviando;
    confErrorEl.textContent = a.error ? a.error.mensaje : '';
    confErrorEl.hidden = !a.error;
    if (!estaba) { btnConfCancelarEl.focus(); }
  }

  function devolverFocoConf() {
    var b = abridorConf;
    abridorConf = null;
    if (b && b.isConnected !== false && !b.hidden && typeof b.focus === 'function') {
      b.focus();
    } else if (!avisoEl.hidden && typeof avisoEl.focus === 'function') {
      avisoEl.focus();          // el item ya no esta (se resolvio / repuso): el foco va al aviso del resultado
    } else if (typeof panelEl.focus === 'function') {
      panelEl.focus();
    }
  }

  function actualizarBloqueoScroll() {
    document.body.classList.toggle('fotos-mod-abierto', confAbierto || visAbierto);
  }

  // =====================================================================
  // Acciones
  // =====================================================================

  function pedirAccion(tipo, it, boton) {
    if (!cola || confAbierto || visAbierto || historialAbierto) { return; }
    abridorConf = boton;
    if (!cola.pedirAccion(tipo, it.clave)) { abridorConf = null; }
  }

  function confirmarAccion() {
    if (!cola) { return; }
    cola.confirmar().then(function (e) {
      if (e.accion && e.accion.error && typeof confErrorEl.focus === 'function') { confErrorEl.focus(); }
    });
  }

  function alVisibilidadCambio() {
    // aprobar / reponer cambian lo que ve la galeria: el contador compartido se vuelve a pedir
    if (typeof fotosPozosResumenController_cargar === 'function') { fotosPozosResumenController_cargar(true); }
  }

  function abrirHistorialDe(it, boton) {
    if (!cola || confAbierto || visAbierto || historialAbierto || typeof fotosModeracionController_abrirHistorial !== 'function') { return; }
    historialAbierto = true;
    fotosModeracionController_abrirHistorial(it.fotoId, boton, {
      // reponer desde el historial: la lista se vuelve a pedir y el contador compartido tambien
      alReponer: function () { alVisibilidadCambio(); cola.actualizarConAviso(FOTOS_COLA_MENSAJE_EXITO.REPONER, false); },
      alEstadoCambiado: function (code) { cola.actualizarConAviso(fotosModeracionColaLogic_mensajeCambioEstado('REPONER', code), true); },
      alCerrar: function () { historialAbierto = false; }
    });
  }

  // =====================================================================
  // Foto a tamano completo
  // =====================================================================

  function abrirFoto(it, boton) {
    if (!cola || confAbierto || visAbierto || historialAbierto) { return; }
    abridorVis = boton;
    visAbierto = true;
    visToken += 1;
    var mio = visToken;
    visOverlayEl.hidden = false;
    actualizarBloqueoScroll();
    visPieEl.textContent = [it.entidad, textoFoto(it.foto)].filter(function (x) { return !!x; }).join(' · ');
    visImgEl.removeAttribute('src');
    visImgEl.hidden = true;
    visErrorEl.hidden = true;
    visErrorEl.textContent = '';
    visCargandoEl.hidden = false;
    btnVisCerrarEl.focus();
    pedirImagen(it.fotoId, 'full').then(function (url) {
      if (mio !== visToken) { return; }
      visCargandoEl.hidden = true;
      visImgEl.src = url;
      visImgEl.hidden = false;
    }, function (err) {
      if (mio !== visToken) { return; }
      visCargandoEl.hidden = true;
      var code = err && err.codigo;
      visErrorEl.textContent = fotosModeracionLogic_mensajeError(code === 'FOTO_NOT_FOUND' || code === 'PERMISSION_DENIED' ? code : 'STORAGE_UNAVAILABLE');
      visErrorEl.hidden = false;
    });
  }

  function cerrarFoto() {
    if (!visAbierto) { return; }
    visAbierto = false;
    visToken += 1;
    visOverlayEl.hidden = true;
    visImgEl.removeAttribute('src');
    visImgEl.hidden = true;
    actualizarBloqueoScroll();
    var b = abridorVis;
    abridorVis = null;
    if (b && b.isConnected !== false && typeof b.focus === 'function') { b.focus(); }
  }

  // =====================================================================
  // Teclado
  // =====================================================================

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

  function enfocablesConf() {
    return [btnConfCerrarEl, btnConfCancelarEl, btnConfConfirmarEl].filter(function (b) { return !b.disabled; });
  }

  function enfocablesVis() {
    return [btnVisCerrarEl, btnVisCerrar2El];
  }

  // =====================================================================
  // Ciclo de vida
  // =====================================================================

  function fotosModeracionColaController_inicializar(ctxFn) {
    obtenerContexto = ctxFn;
    colaMiniaturas = fotosModeracionColaLogic_crearColaMiniaturas(FOTOS_COLA_MINIATURAS_PARALELAS, function (fotoId) { return pedirImagen(fotoId, 'thumb'); });
    cola = fotosModeracionColaLogic_crear({
      obtenerContexto: ctxFn,
      consultar: function (pestana, sessionToken, limit, cursor) {
        return pestana === FOTOS_COLA_RETIRADAS
          ? apiGetFotosPozosRetiradasModeracion(sessionToken, limit, cursor)
          : apiGetFotosPozosPendientesModeracion(sessionToken, limit, cursor);
      },
      enviar: function (tipo, sessionToken, datos, idIntencion) {
        if (tipo === 'REPONER') { return apiReponerFotoPozo(sessionToken, datos.fotoId, idIntencion); }
        return apiResolverRetiroFotoPozo(sessionToken, datos.solicitudId, datos.resolucion, idIntencion);
      },
      onCambio: pintar,
      onSesionExpirada: sesionVencida,
      onVisibilidadCambio: alVisibilidadCambio
    });
  }

  function reiniciarPantalla() {
    colaMiniaturas.reset();
    firmaLista = '';
    listaEl.textContent = '';
    cerrarFoto();
    historialAbierto = false;
    if (typeof fotosModeracionController_cerrar === 'function') { fotosModeracionController_cerrar(); }
  }

  function fotosModeracionColaController_abrir() {
    reiniciarPantalla();
    return cola.abrir();
  }

  function fotosModeracionColaController_cerrar() {
    cola.cerrar();
    reiniciarPantalla();
  }

  // Cierre de sesion: nada de la pantalla sobrevive (ni las listas, ni las imagenes, ni lo que este en vuelo).
  function fotosModeracionColaController_reset() {
    if (!cola) { return; }
    fotosModeracionColaController_cerrar();
    abridorConf = null;
    abridorVis = null;
  }

  function fotosModeracionColaController_hayModalAbierto() {
    return confAbierto || visAbierto || historialAbierto;
  }

  // Eventos
  ['PENDIENTES', 'RETIRADAS'].forEach(function (p) {
    tabEls[p].addEventListener('click', function () { if (cola) { cola.seleccionarPestana(p); } });
    tabEls[p].addEventListener('keydown', function (ev) {
      var destino = fotosModeracionColaLogic_pestanaPorTecla(p, ev.key);
      if (destino && cola) {
        ev.preventDefault();
        cola.seleccionarPestana(destino);
        tabEls[destino].focus();
      }
    });
  });
  btnActualizarEl.addEventListener('click', function () { if (cola) { cola.recargar(); } });
  btnReintentarEl.addEventListener('click', function () { if (cola) { cola.recargar(); } });
  btnMasEl.addEventListener('click', function () { if (cola) { cola.verMas(); } });
  btnConfConfirmarEl.addEventListener('click', confirmarAccion);
  btnConfCancelarEl.addEventListener('click', function () { if (cola) { cola.cancelarAccion(); } });
  btnConfCerrarEl.addEventListener('click', function () { if (cola) { cola.cancelarAccion(); } });
  confOverlayEl.addEventListener('keydown', teclaDeModal(enfocablesConf, function () { if (cola) { cola.cancelarAccion(); } }));
  btnVisCerrarEl.addEventListener('click', cerrarFoto);
  btnVisCerrar2El.addEventListener('click', cerrarFoto);
  visOverlayEl.addEventListener('keydown', teclaDeModal(enfocablesVis, cerrarFoto));

  window.fotosModeracionColaController_inicializar = fotosModeracionColaController_inicializar;
  window.fotosModeracionColaController_abrir = fotosModeracionColaController_abrir;
  window.fotosModeracionColaController_cerrar = fotosModeracionColaController_cerrar;
  window.fotosModeracionColaController_reset = fotosModeracionColaController_reset;
  window.fotosModeracionColaController_hayModalAbierto = fotosModeracionColaController_hayModalAbierto;
})();
