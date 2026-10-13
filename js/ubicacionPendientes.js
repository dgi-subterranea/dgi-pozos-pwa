// Indicador "Correcciones pendientes: N" del hub, solo para quien valida correcciones de ubicacion (ubicacion + ubicacion_validar exactos). Toca el DOM y la
// red, asi que no se testea con Jest; todo el estado y las reglas (permisos fail-closed, intervalo, fallos que no bloquean, sesion vencida, descarte de
// respuestas viejas, refresco al resolver) viven en ubicacionCorreccionLogic_crearBadgePendientes (js/ubicacionCorreccionLogic.js, con tests).
//
// Cuando se refresca: al entrar al hub (login, checkSession y cada vuelta al hub: ver showScreen('main') en app.js) con un intervalo minimo, y SIEMPRE despues
// de validar o rechazar una correccion: la futura cola de validacion llama window.ubicacionPendientesController_alResolver() al terminar cada accion.
// Es discreto: con 0 pendientes (o sin permiso, o con un dato invalido) no se ve.
(function () {
  var badgeEl = document.getElementById('ucorr-pendientes');
  var textoEl = document.getElementById('ucorr-pendientes-texto');
  var badge = null;

  function pintar(total) {
    var texto = ubicacionCorreccionLogic_textoBadgePendientes(total);
    textoEl.textContent = texto;
    badgeEl.hidden = texto === '';
  }

  // obtenerContexto: app.js devuelve SIEMPRE el sessionToken y los permisos frescos, y como reaccionar a una sesion vencida o a un usuario deshabilitado.
  function ubicacionPendientesController_inicializar(obtenerContexto) {
    badge = ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: obtenerContexto,
      consultar: function (sessionToken) { return apiGetCorreccionesUbicacionPendientes(sessionToken); },
      pintar: pintar
    });
  }

  function ubicacionPendientesController_refrescar() {
    return badge ? badge.refrescar(false) : Promise.resolve({ tipo: 'sin_permiso' });
  }

  function ubicacionPendientesController_alResolver() {
    return badge ? badge.alResolver() : Promise.resolve({ tipo: 'sin_permiso' });
  }

  function ubicacionPendientesController_reset() {
    if (badge) { badge.reset(); } else { pintar(null); }
  }

  window.ubicacionPendientesController_inicializar = ubicacionPendientesController_inicializar;
  window.ubicacionPendientesController_refrescar = ubicacionPendientesController_refrescar;
  window.ubicacionPendientesController_alResolver = ubicacionPendientesController_alResolver;
  window.ubicacionPendientesController_reset = ubicacionPendientesController_reset;
})();
