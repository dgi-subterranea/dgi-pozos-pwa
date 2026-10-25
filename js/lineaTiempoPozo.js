// Controlador DOM de la pantalla "Linea de tiempo" del pozo (E6-3). Toda la logica de presentacion (que se muestra, filtros, avisos, notas de cada evento) vive en
// js/lineaTiempoPozoVistaLogic.js; la carga y el estado de las fuentes en js/lineaTiempoPozoLoader.js; el modelo de eventos en js/lineaTiempoPozoLogic.js (todos con tests). Aca solo se
// pinta y se cablean los botones.
//
// API (ver window.lineaTiempoPozoController_* al final):
//   _inicializar(obtenerContexto)  obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir(wellId)                 carga fresca (no hay cache) y pinta; sin el permiso exacto de alguna fuente no hace nada
//   _cerrar() / _reset()           salir de la pantalla / cerrar sesion: se cancela lo que este en vuelo y se limpia lo pintado
//
// Se carga SOLO al abrir la pantalla (nunca desde el hub ni en la busqueda). Un resultado se aplica unicamente si el cargador dice que sigue vigente (esVigente): salir, cambiar de pozo o
// reabrir descartan lo que venia en vuelo. Cambiar de filtro NO vuelve a pedir nada: filtra el resultado ya cargado con la funcion pura del modelo. UNAUTHORIZED / USER_DISABLED no se
// muestran como error de la linea de tiempo: se avisa UNA vez a onSessionExpired (el cierre de sesion de siempre).
// Privacidad: todo texto que viene de datos (detalle, nombre, titulo) se pone con textContent -jamas como HTML- y nunca se escribe en console, URL, data-* ni storage.
(function () {
  function $(id) { return document.getElementById(id); }
  var entidadEl = $('linea-tiempo-entidad');
  var cargandoEl = $('linea-tiempo-cargando');
  var errorEl = $('linea-tiempo-error');
  var errorTextoEl = $('linea-tiempo-error-texto');
  var btnReintentarEl = $('btn-linea-tiempo-reintentar');
  var contenidoEl = $('linea-tiempo-contenido');
  var avisosEl = $('linea-tiempo-avisos');
  var filtrosEl = $('linea-tiempo-filtros');
  var vacioEl = $('linea-tiempo-vacio');
  var listaEl = $('linea-tiempo-lista');

  var cargador = null;
  var obtenerContexto = null;
  var wellIdActual = null;
  var resultado = null;
  var filtro = LINEA_TIEMPO_VISTA_TODAS;
  var sesionAvisada = false;

  function nodo(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) { n.className = clase; }
    if (texto !== undefined && texto !== null) { n.textContent = texto; }
    return n;
  }

  function limpiar(el) { el.textContent = ''; }

  function contexto() {
    return (obtenerContexto ? obtenerContexto() : null) || {};
  }

  // Una sola vez por apertura: el cierre de sesion de siempre (app.js) se encarga del resto.
  function sesionExpirada() {
    if (sesionAvisada) { return; }
    sesionAvisada = true;
    var ctx = contexto();
    if (typeof ctx.onSessionExpired === 'function') { ctx.onSessionExpired(); }
  }

  function obtenerCargador() {
    if (!cargador) {
      cargador = lineaTiempoPozoLoader_crear({ onSesionExpirada: function () { sesionExpirada(); } });
    }
    return cargador;
  }

  function mostrarCargando() {
    cargandoEl.hidden = false;
    errorEl.hidden = true;
    contenidoEl.hidden = true;
  }

  function mostrarError(texto) {
    cargandoEl.hidden = true;
    errorTextoEl.textContent = texto;
    errorEl.hidden = false;
  }

  function deps() {
    return {
      formatearFecha: reemplazoLogic_formatearFecha,
      etiquetaMotivo: reemplazoLogic_etiquetaMotivo,
      filtrar: lineaTiempoPozoLogic_filtrarPorFuente
    };
  }

  function renderFiltros(filtros, activo, enfocar) {
    limpiar(filtrosEl);
    filtrosEl.hidden = filtros.length === 0;
    filtros.forEach(function (f) {
      var seleccionado = f.valor === activo;
      var boton = nodo('button', seleccionado ? 'lt-filtro lt-filtro-activo' : 'lt-filtro', f.etiqueta);
      boton.type = 'button';
      boton.setAttribute('aria-pressed', seleccionado ? 'true' : 'false');
      boton.addEventListener('click', function () {
        filtro = f.valor;
        render(true);
      });
      filtrosEl.appendChild(boton);
      if (seleccionado && enfocar) { boton.focus(); }
    });
  }

  function renderItem(v) {
    var li = nodo('li', 'lt-item lt-item-' + v.fuente.toLowerCase());
    var cabecera = nodo('div', 'lt-item-cabecera');
    cabecera.appendChild(nodo('span', 'lt-fuente', v.fuenteEtiqueta));
    var fecha = nodo('time', 'lt-fecha', v.fecha);
    fecha.setAttribute('datetime', v.instante);
    cabecera.appendChild(fecha);
    li.appendChild(cabecera);
    li.appendChild(nodo('p', 'lt-titulo', v.titulo));
    if (v.detalle !== null) { li.appendChild(nodo('p', 'lt-detalle', v.detalle)); }
    v.notas.forEach(function (n) { li.appendChild(nodo('p', 'lt-nota', n)); });
    li.appendChild(nodo('p', 'lt-autor', 'Por ' + v.nombre));
    return li;
  }

  function render(enfocarFiltro) {
    var m = lineaTiempoPozoVista_modelo(resultado, filtro, deps());
    cargandoEl.hidden = true;
    if (m.tipo === 'ERROR_TOTAL') {
      mostrarError(m.mensaje);
      return;
    }
    errorEl.hidden = true;
    contenidoEl.hidden = false;
    limpiar(listaEl);
    limpiar(avisosEl);
    if (m.tipo === 'VACIO') {
      filtrosEl.hidden = true;
      limpiar(filtrosEl);
      avisosEl.hidden = true;
      listaEl.hidden = true;
      vacioEl.textContent = m.mensaje;
      vacioEl.hidden = false;
      return;
    }
    avisosEl.hidden = m.avisos.length === 0;
    m.avisos.forEach(function (a) { avisosEl.appendChild(nodo('p', 'lt-aviso', a)); });
    renderFiltros(m.filtros, m.filtro, enfocarFiltro === true);
    m.items.forEach(function (v) { listaEl.appendChild(renderItem(v)); });
    listaEl.hidden = m.items.length === 0;
    vacioEl.hidden = m.mensaje === null;
    if (m.mensaje !== null) { vacioEl.textContent = m.mensaje; }
  }

  function abrir(wellId) {
    var ctx = contexto();
    if (!lineaTiempoPozoLogic_puedeVerLineaTiempo(ctx.permisos) || typeof wellId !== 'string') {
      return;       // defensa en profundidad: cada fuente vuelve a validar su permiso en el backend
    }
    wellIdActual = wellId;
    resultado = null;
    filtro = LINEA_TIEMPO_VISTA_TODAS;
    sesionAvisada = false;
    entidadEl.textContent = wellId;
    limpiar(listaEl);
    limpiar(avisosEl);
    limpiar(filtrosEl);
    mostrarCargando();
    var c = obtenerCargador();
    var promesa = c.cargar(ctx.sessionToken, wellId, ctx.permisos);
    var generacion = c.generacionActual();
    promesa.then(function (r) {
      if (!c.esVigente(r)) { return; }          // respuesta vieja: otro pozo, otra apertura o ya se salio (cerrar() cancela)
      if (r.auth) {
        sesionExpirada();
        return;
      }
      resultado = r;
      render(false);
    }).catch(function () {
      // el cargador no rechaza nunca; esto cubre un fallo inesperado al pintar (solo si esta apertura sigue siendo la vigente)
      if (c.generacionActual() !== generacion) { return; }
      resultado = null;
      mostrarError(LINEA_TIEMPO_VISTA_TEXTOS.ERROR_TOTAL);
    });
  }

  function cerrar() {
    if (cargador) { cargador.cancelar(); }
    wellIdActual = null;
    resultado = null;
    filtro = LINEA_TIEMPO_VISTA_TODAS;
    limpiar(listaEl);
    limpiar(avisosEl);
    limpiar(filtrosEl);
  }

  btnReintentarEl.addEventListener('click', function () {
    if (wellIdActual !== null) { abrir(wellIdActual); }
  });

  window.lineaTiempoPozoController_inicializar = function (fn) { obtenerContexto = fn; };
  window.lineaTiempoPozoController_abrir = abrir;
  window.lineaTiempoPozoController_cerrar = cerrar;
  window.lineaTiempoPozoController_reset = function () {
    cerrar();
    cargandoEl.hidden = true;
    errorEl.hidden = true;
    contenidoEl.hidden = true;
  };
})();
