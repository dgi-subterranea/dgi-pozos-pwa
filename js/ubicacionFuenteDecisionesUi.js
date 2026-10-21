// Controlador DOM de la confirmacion de una decision sobre una fuente registral (Aceptar / Descartar / Quitar aceptacion / Restaurar) y de las SUGERENCIAS (Sugerir aceptar /
// descartar / restaurar, Cancelar sugerencia, y Aprobar / Rechazar en la cola de revision). Es UN solo dialogo, compartido por las tarjetas de "Ubicaciones conocidas", el popup del
// visor "Ver todas en el mapa" (js/ubicacionesConocidas.js) y la cola de sugerencias (js/ubicacionSugerencias.js): no hay logica de decision duplicada. Toca DOM y red, asi que no se prueba directo con Jest: los tests lo ejecutan con un DOM simulado (js/ubicacionFuenteDecisionesUi.test.js); toda la
// logica pura -acciones, textos de confirmacion, pedido, errores, clientRequestId, flujo- vive en js/ubicacionFuenteDecisionesUiLogic.js (con tests).
//
// - La coordenada original NUNCA se elimina: el dialogo dice "descartada", no "eliminada".
// - El estado y la version salen del backend (getDecisionesFuentesPozo); lo que se envia es la lista blanca de ufdui_construirPedido via apiDecidirFuenteUbicacion.
// - app.js es el unico dueño de sessionToken/permisos: los pasa frescos con obtenerContexto() -> {sessionToken, permisos, onSessionExpired}.
// - Es el unico punto por donde pasa TODA decision autoritativa (tarjeta, popup del visor y aprobar en la cola): cuando el backend confirma una (ufdui_cambiaResolucion) invalida en el
//   acto el delta REGISTRAL del dataset del mapa, aunque la pantalla de origen ya se haya cerrado. Sugerir, cancelar, rechazar y los errores NO invalidan. No toca el delta de campo (V).
(function () {
  var estado = {
    obtenerContexto: null,
    flujo: null,
    abierto: false,
    resolver: null,
    entrada: null,           // {wellId, fuente, accion, version, hayValidadaVigente}
    agregoClaseBody: false,
    abridorEl: null,
    enviando: false
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    overlay: $('ufd-overlay'), titulo: $('ufd-titulo'), cerrar: $('btn-ufd-cerrar'), fuente: $('ufd-fuente'), textos: $('ufd-textos'),
    motivoBloque: $('ufd-motivo-bloque'), motivoLabel: $('ufd-motivo-label'), motivo: $('ufd-motivo'), errMotivo: $('ufd-err-motivo'),
    error: $('ufd-error'), guardando: $('ufd-guardando'), confirmar: $('btn-ufd-confirmar'), cancelar: $('btn-ufd-cancelar')
  };

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function ubicacionFuenteDecisionesUi_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    estado.flujo = ufdui_crearFlujo({
      enviar: function (pedido) { return apiDecidirFuenteUbicacion(contexto().sessionToken, pedido); },
      leer: function (wellId) { return apiGetDecisionesFuentesPozo(contexto().sessionToken, wellId); },
      generarId: function () { return ufdui_nuevoClientRequestId(); }
    });
    // UN solo flujo de sugerencias para toda la app (ficha, mapa y cola): asi un reintento tras un corte de red reutiliza el mismo clientRequestId desde donde se haga.
    estado.flujoSugerencias = ufdui_crearFlujoSugerencias({
      sugerir: function (pedido) { return apiSugerirDecisionFuente(contexto().sessionToken, pedido); },
      cancelar: function (pedido) { return apiCancelarSugerenciaFuente(contexto().sessionToken, pedido); },
      resolver: function (pedido) { return apiResolverSugerenciaFuente(contexto().sessionToken, pedido); },
      generarId: function () { return ufdui_nuevoClientRequestId(); }
    });
  }

  function ubicacionFuenteDecisionesUi_flujoSugerencias() {
    return estado.flujoSugerencias;
  }

  function mostrarError(texto) {
    els.error.textContent = texto || '';
    els.error.hidden = !texto;
  }

  function enviando(si) {
    estado.enviando = si;
    els.guardando.hidden = !si;
    els.confirmar.disabled = si;
    els.cancelar.disabled = si;
    els.motivo.disabled = si;
  }

  function terminar(resultado) {
    if (!estado.abierto) {
      return;
    }
    estado.abierto = false;
    enviando(false);
    els.overlay.hidden = true;
    if (estado.agregoClaseBody) {
      document.body.classList.remove('ucorr-abierto');
    }
    estado.agregoClaseBody = false;
    var ab = estado.abridorEl;
    estado.abridorEl = null;
    if (ab && document.body.contains(ab) && typeof ab.focus === 'function') {
      ab.focus();
    }
    var r = estado.resolver;
    estado.resolver = null;
    estado.entrada = null;
    if (r) {
      r(resultado);
    }
  }

  // args: {wellId, fuente (fuente del modelo, con .decision; para operaciones con `ejecutar` basta {etiqueta}), accion, version (versionVista que vio el usuario),
  //        hayValidadaVigente, accionSugerida (al aprobar), ejecutar(motivo) -> Promise<resultado> (operaciones de sugerencias), visorAbierto, abridor}
  // Resuelve cuando el dialogo se cierra: {tipo:'cancelado'} | {tipo:'ok'|'desactualizado'|'ya_pendiente'|'error', ...} (ver ufdui_crearFlujo y ufdui_crearFlujoSugerencias). Los errores
  // recuperables (red, rechazo) dejan el dialogo abierto con el mensaje para reintentar; la promesa sigue pendiente hasta que se confirma bien o se cancela.
  function ubicacionFuenteDecisionesUi_pedir(args) {
    var a = args || {};
    var conf = ufdui_confirmacion(a.accion, a.fuente, { hayValidadaVigente: !!a.hayValidadaVigente, accionSugerida: a.accionSugerida });
    var propia = typeof a.ejecutar === 'function';
    if (!conf || !a.fuente || (!propia && (!a.fuente.decision || !estado.flujo))) {
      return Promise.resolve({ tipo: 'cancelado' });
    }
    if (estado.abierto) {
      return Promise.resolve({ tipo: 'cancelado' });
    }
    estado.abierto = true;
    estado.entrada = a;
    estado.abridorEl = a.abridor || null;
    els.titulo.textContent = conf.titulo;
    els.fuente.textContent = conf.fuente;
    els.textos.innerHTML = conf.parrafos.map(function (t) { return '<p>' + ufdui_escapar(t) + '</p>'; }).join('');
    els.motivoBloque.hidden = conf.motivo === 'ninguno';
    els.motivoLabel.textContent = conf.motivo === 'obligatorio' ? 'Motivo (obligatorio)' : 'Motivo (opcional)';
    els.motivo.value = '';
    els.errMotivo.hidden = true;
    mostrarError('');
    enviando(false);
    els.confirmar.textContent = conf.ok;
    els.overlay.hidden = false;
    if (!a.visorAbierto) {
      document.body.classList.add('ucorr-abierto');
      estado.agregoClaseBody = true;
    }
    if (conf.motivo === 'obligatorio' && typeof els.motivo.focus === 'function') {
      els.motivo.focus();
    } else if (typeof els.confirmar.focus === 'function') {
      els.confirmar.focus();
    }
    return new Promise(function (resolve) { estado.resolver = resolve; });
  }

  function confirmar() {
    var e = estado.entrada;
    if (!estado.abierto || !e || estado.enviando) {
      return;
    }
    var errMotivo = ufdui_validarMotivo(e.accion, els.motivo.value);
    if (errMotivo) {
      els.errMotivo.textContent = errMotivo;
      els.errMotivo.hidden = false;
      return;
    }
    els.errMotivo.hidden = true;
    mostrarError('');
    enviando(true);
    var motivo = els.motivo.value;
    var promesa = typeof e.ejecutar === 'function' ?
      Promise.resolve().then(function () { return e.ejecutar(motivo); }) :
      estado.flujo.decidir({ wellId: e.wellId, decision: e.fuente.decision, accion: e.accion, motivo: motivo, versionVista: e.version });
    promesa.then(function (r) {
      // ANTES de mirar si el dialogo sigue abierto: la decision ya esta en el backend aunque la ficha se haya cerrado, y el mapa no puede seguir con el delta viejo
      if (ufdui_cambiaResolucion(r) && typeof mapaDataset_invalidarDeltaRegistral === 'function') {
        mapaDataset_invalidarDeltaRegistral();
      }
      if (!estado.abierto || estado.entrada !== e) {
        return;                                                  // se cerro/cambio la ficha mientras tanto
      }
      if (r.tipo === 'ok' || r.tipo === 'desactualizado' || r.tipo === 'ya_pendiente' || (r.tipo === 'error' && r.sesionVencida)) {
        terminar(r);
        if (r.tipo === 'error' && r.sesionVencida && contexto() && typeof contexto().onSessionExpired === 'function') {
          contexto().onSessionExpired();
        }
        return;
      }
      enviando(false);
      if (r.tipo === 'invalido') {
        els.errMotivo.textContent = r.mensaje;
        els.errMotivo.hidden = false;
      } else {
        mostrarError(r.mensaje);
      }
    });
  }

  function cancelar() {
    if (estado.enviando) {
      return;
    }
    terminar({ tipo: 'cancelado' });
  }

  // La ficha se cerro / cambio: cierra el dialogo sin decidir nada.
  function ubicacionFuenteDecisionesUi_cancelar() {
    if (estado.abierto) {
      estado.enviando = false;
      terminar({ tipo: 'cancelado' });
    }
  }

  els.confirmar.addEventListener('click', confirmar);
  els.cancelar.addEventListener('click', cancelar);
  els.cerrar.addEventListener('click', cancelar);
  els.overlay.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      cancelar();
    }
  });

  window.ubicacionFuenteDecisionesUi_inicializar = ubicacionFuenteDecisionesUi_inicializar;
  window.ubicacionFuenteDecisionesUi_flujoSugerencias = ubicacionFuenteDecisionesUi_flujoSugerencias;
  window.ubicacionFuenteDecisionesUi_pedir = ubicacionFuenteDecisionesUi_pedir;
  window.ubicacionFuenteDecisionesUi_cancelar = ubicacionFuenteDecisionesUi_cancelar;
})();
