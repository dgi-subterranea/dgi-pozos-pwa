// Controlador del modulo Evaluacion / Reemplazo (v1): abrir un pozo, ver su
// estado actual y ultima evaluacion, registrar una evaluacion nueva y ver
// el historial. Igual que mapa.js/cercaMio.js/seleccion.js: nunca llama a
// showScreen ni lee el sessionToken por su cuenta - app.js le pasa un
// "obtenerContexto" que devuelve SIEMPRE el valor fresco al momento de
// usarlo. Toda la logica pura (validacion, formatos, orden) vive en
// js/reemplazoLogic.js (con tests); aca solo hay DOM y red.
//
// La identidad de quien evalua NUNCA se manda: el backend la toma de la
// sesion. El historial es append-only - no hay editar ni borrar.
//
// Todo texto que escribio un usuario (observacion, punto NE, nombre) se
// pinta con textContent, nunca como HTML.
(function () {
  var estado = {
    wellId: null,
    estadoActual: 'SIN_EVALUAR',
    ultimaEvaluacion: null,
    historial: [],
    puntoNEOrigen: '',       // punto NE que trae el contexto desde el que se abrio (precarga del formulario, editable)
    formEstado: '',          // estado elegido en el formulario
    cargaId: 0,              // staleness: una respuesta de una carga vieja se descarta
    guardando: false,
    obtenerContexto: null
  };

  var formPozoEl = document.getElementById('reemplazo-form-pozo');
  var inputPozoEl = document.getElementById('input-reemplazo-well-id');
  var pozoErrorEl = document.getElementById('reemplazo-pozo-error');
  var cargandoEl = document.getElementById('reemplazo-cargando');
  var errorBloqueEl = document.getElementById('reemplazo-error');
  var errorTextoEl = document.getElementById('reemplazo-error-texto');
  var btnReintentarEl = document.getElementById('btn-reemplazo-reintentar');
  var detalleEl = document.getElementById('reemplazo-detalle');
  var wellIdEl = document.getElementById('reemplazo-wellid');
  var badgeEl = document.getElementById('reemplazo-estado-badge');
  var ultimaEl = document.getElementById('reemplazo-ultima');
  var btnNuevaEl = document.getElementById('btn-reemplazo-nueva');
  var exitoEl = document.getElementById('reemplazo-exito');
  var formEl = document.getElementById('reemplazo-form');
  var estadosEl = document.getElementById('reemplazo-estados');
  var motivoEl = document.getElementById('reemplazo-motivo');
  var obsEl = document.getElementById('reemplazo-observacion');
  var obsReqEl = document.getElementById('reemplazo-obs-req');
  var puntoEl = document.getElementById('reemplazo-punto-ne');
  var errEstadoEl = document.getElementById('reemplazo-err-estado');
  var errMotivoEl = document.getElementById('reemplazo-err-motivo');
  var errObsEl = document.getElementById('reemplazo-err-observacion');
  var errPuntoEl = document.getElementById('reemplazo-err-punto');
  var btnCancelarEl = document.getElementById('btn-reemplazo-cancelar');
  var historialEl = document.getElementById('reemplazo-historial');
  var historialCantidadEl = document.getElementById('reemplazo-historial-cantidad');

  var confirmarOverlayEl = document.getElementById('reemplazo-confirmar-overlay');
  var confirmarResumenEl = document.getElementById('reemplazo-confirmar-resumen');
  var confirmarErrorEl = document.getElementById('reemplazo-confirmar-error');
  var btnGuardarEl = document.getElementById('btn-reemplazo-guardar');
  var btnConfirmarCancelarEl = document.getElementById('btn-reemplazo-confirmar-cancelar');

  function reemplazoController_inicializar(obtenerContexto) {
    estado.obtenerContexto = obtenerContexto;
    // Fotos (v2): cuando cambian las fotos de una evaluacion (subida OK) se
    // repinta el historial.
    reemplazoFotosController_inicializar(obtenerContexto, function () { renderHistorial(); });
  }

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function mostrarTexto(el, texto) {
    el.textContent = texto || '';
    el.hidden = !texto;
  }

  // --- Apertura ---

  // contextoApertura: {wellId?, puntoNEReferencia?}. Con wellId carga ese
  // pozo directo (desde el detalle del pozo o una card de Mi seleccion);
  // sin wellId deja el buscador vacio (desde el hub).
  function reemplazoController_abrir(contextoApertura) {
    var ap = contextoApertura || {};
    estado.cargaId += 1;
    estado.puntoNEOrigen = ap.puntoNEReferencia || '';
    cerrarFormulario();
    cerrarConfirmacion();
    exitoEl.hidden = true;
    mostrarTexto(pozoErrorEl, '');
    errorBloqueEl.hidden = true;
    cargandoEl.hidden = true;

    if (ap.wellId) {
      inputPozoEl.value = ap.wellId;
      cargarPozo(ap.wellId);
    } else {
      estado.wellId = null;
      detalleEl.hidden = true;
      inputPozoEl.value = ap.wellIdSugerido || '';
    }
  }

  // Se llama al salir de la pantalla: invalida cualquier carga en vuelo.
  function reemplazoController_cerrar() {
    estado.cargaId += 1;
  }

  // --- Carga del pozo (estado actual + historial, en paralelo) ---

  function cargarPozo(wellId) {
    var ctx = contexto();
    if (!ctx) {
      return;
    }
    estado.cargaId += 1;
    var cargaId = estado.cargaId;
    estado.wellId = wellId;

    detalleEl.hidden = true;
    errorBloqueEl.hidden = true;
    cargandoEl.hidden = false;

    Promise.all([
      apiGetEstadoReemplazo(ctx.sessionToken, wellId),
      apiGetHistorialReemplazo(ctx.sessionToken, wellId),
      // metadata de fotos (tolerante: si falla, el historial se ve sin fotos)
      reemplazoFotosController_cargarPozo(wellId)
    ]).then(function (resultados) {
      if (cargaId !== estado.cargaId) {
        return;
      }
      cargandoEl.hidden = true;
      var rEstado = resultados[0];
      var rHistorial = resultados[1];
      var fallo = rEstado.status !== 'ok' ? rEstado : (rHistorial.status !== 'ok' ? rHistorial : null);
      if (fallo) {
        manejarErrorCarga(fallo.code);
        return;
      }
      estado.estadoActual = rEstado.data.estado;
      estado.ultimaEvaluacion = rEstado.data.ultimaEvaluacion;
      estado.historial = rHistorial.data.evaluaciones || [];
      // el estado autoritativo del backend manda sobre el resumen en memoria
      if (reemplazoEstadosController_estadoDe(wellId) !== estado.estadoActual) {
        reemplazoEstadosController_actualizar(wellId, estado.estadoActual);
      }
      renderDetalle();
    }).catch(function () {
      if (cargaId !== estado.cargaId) {
        return;
      }
      cargandoEl.hidden = true;
      mostrarErrorCarga('No se pudo cargar la información. Revisá tu conexión.');
    });
  }

  function manejarErrorCarga(code) {
    if (code === 'UNAUTHORIZED' || code === 'USER_DISABLED') {
      var ctx = contexto();
      if (ctx && ctx.onSessionExpired) {
        ctx.onSessionExpired();
      }
      return;
    }
    mostrarErrorCarga(reemplazoLogic_mensajeError(code));
  }

  function mostrarErrorCarga(texto) {
    errorTextoEl.textContent = texto;
    errorBloqueEl.hidden = false;
    detalleEl.hidden = true;
  }

  // --- Render (todo con textContent) ---

  function crearEl(tag, clase, texto) {
    var el = document.createElement(tag);
    if (clase) {
      el.className = clase;
    }
    if (texto !== undefined && texto !== null) {
      el.textContent = texto;
    }
    return el;
  }

  function pintarBadge(el, valorEstado) {
    el.className = el.className.replace(/\breemplazo-badge-(apto|no-apto|dudoso|sin-evaluar)\b/g, '').trim();
    el.classList.add('reemplazo-badge-' + reemplazoLogic_claseEstado(valorEstado));
    el.textContent = reemplazoLogic_etiquetaEstado(valorEstado);
  }

  // Filas "etiqueta: valor" de una evaluacion (ultima y cada item del
  // historial usan el mismo bloque, asi se leen igual).
  function construirDatosEvaluacion(ev) {
    var dl = crearEl('dl', 'reemplazo-datos');
    function fila(etiqueta, valor) {
      var wrap = crearEl('div', 'reemplazo-dato');
      wrap.appendChild(crearEl('dt', '', etiqueta));
      wrap.appendChild(crearEl('dd', '', valor));
      dl.appendChild(wrap);
    }
    fila('Fecha', reemplazoLogic_formatearFecha(ev.timestamp));
    fila('Usuario', reemplazoLogic_nombreUsuario(ev));
    if (ev.motivo) {
      fila('Motivo', reemplazoLogic_etiquetaMotivo(ev.motivo));
    }
    if (ev.observacion) {
      fila('Observación', ev.observacion);
    }
    if (ev.puntoNEReferencia) {
      fila('Punto NE de referencia', ev.puntoNEReferencia);
    }
    return dl;
  }

  function renderDetalle() {
    detalleEl.hidden = false;
    wellIdEl.textContent = estado.wellId;
    pintarBadge(badgeEl, estado.estadoActual);

    ultimaEl.innerHTML = '';
    if (estado.ultimaEvaluacion) {
      ultimaEl.appendChild(crearEl('p', 'reemplazo-etiqueta', 'Última evaluación'));
      ultimaEl.appendChild(construirDatosEvaluacion(estado.ultimaEvaluacion));
    } else {
      ultimaEl.appendChild(crearEl('p', 'reemplazo-vacio', 'Este pozo todavía no tiene evaluaciones.'));
    }
    renderHistorial();
  }

  function renderHistorial() {
    historialEl.innerHTML = '';
    var n = estado.historial.length;
    historialCantidadEl.textContent = n > 0 ? '(' + n + ')' : '';
    if (n === 0) {
      historialEl.appendChild(crearEl('p', 'reemplazo-vacio', 'Sin evaluaciones registradas.'));
      return;
    }
    estado.historial.forEach(function (ev) {
      var item = crearEl('article', 'reemplazo-item');
      var cabecera = crearEl('div', 'reemplazo-item-cabecera');
      var badge = crearEl('span', 'reemplazo-badge');
      pintarBadge(badge, ev.estado);
      cabecera.appendChild(badge);
      item.appendChild(cabecera);
      item.appendChild(construirDatosEvaluacion(ev));
      // Fotos de ESTA evaluacion (metadata ya cargada, miniaturas lazy)
      var galeria = reemplazoFotosController_construirGaleria(ev.evaluacionId);
      if (galeria) {
        item.appendChild(galeria);
      }
      historialEl.appendChild(item);
    });
  }

  // --- Formulario "Nueva evaluacion" ---

  function construirChipsEstado() {
    estadosEl.innerHTML = '';
    REEMPLAZO_ESTADOS_UI.forEach(function (e) {
      var chip = crearEl('button', 'reemplazo-estado-chip reemplazo-estado-' + reemplazoLogic_claseEstado(e.valor), e.etiqueta);
      chip.type = 'button';
      chip.setAttribute('data-estado', e.valor);
      chip.setAttribute('aria-pressed', 'false');
      estadosEl.appendChild(chip);
    });
  }

  function elegirEstadoForm(valor) {
    estado.formEstado = valor;
    Array.prototype.forEach.call(estadosEl.querySelectorAll('.reemplazo-estado-chip'), function (chip) {
      var activo = chip.getAttribute('data-estado') === valor;
      chip.classList.toggle('active', activo);
      chip.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
    poblarMotivos(valor);
    mostrarTexto(errEstadoEl, '');
    actualizarObsRequerida();
  }

  function poblarMotivos(valorEstado) {
    var motivos = reemplazoLogic_motivosParaEstado(valorEstado);
    motivoEl.innerHTML = '';
    var vacio = document.createElement('option');
    vacio.value = '';
    vacio.textContent = !valorEstado ? 'Elegí primero un estado'
      : (reemplazoLogic_motivoRequerido(valorEstado) ? 'Elegí un motivo' : 'Sin motivo');
    motivoEl.appendChild(vacio);
    motivos.forEach(function (m) {
      var op = document.createElement('option');
      op.value = m.valor;
      op.textContent = m.etiqueta;
      motivoEl.appendChild(op);
    });
    motivoEl.disabled = !valorEstado;
  }

  function actualizarObsRequerida() {
    obsReqEl.textContent = motivoEl.value === 'OTRO' ? '(obligatoria con "Otro")' : '(opcional)';
  }

  function abrirFormulario() {
    exitoEl.hidden = true;
    construirChipsEstado();
    estado.formEstado = '';
    poblarMotivos('');
    obsEl.value = '';
    puntoEl.value = estado.puntoNEOrigen || '';
    reemplazoFotosController_resetFormulario();
    limpiarErroresForm();
    formEl.hidden = false;
    btnNuevaEl.hidden = true;
    formEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  function cerrarFormulario() {
    formEl.hidden = true;
    btnNuevaEl.hidden = false;
    reemplazoFotosController_resetFormulario();
  }

  function limpiarErroresForm() {
    [errEstadoEl, errMotivoEl, errObsEl, errPuntoEl].forEach(function (el) { mostrarTexto(el, ''); });
  }

  function leerFormulario() {
    return reemplazoLogic_validarFormulario({
      estado: estado.formEstado,
      motivo: motivoEl.value,
      observacion: obsEl.value,
      puntoNE: puntoEl.value
    });
  }

  // "Continuar": valida en el cliente (solo guia, el backend revalida) y
  // pide confirmacion antes de escribir.
  function onContinuar(e) {
    e.preventDefault();
    var r = leerFormulario();
    limpiarErroresForm();
    if (reemplazoFotosController_hayProcesando()) {
      mostrarTexto(document.getElementById('reemplazo-err-fotos'), 'Esperá a que terminen de procesarse las fotos.');
      return;
    }
    if (!r.valido) {
      mostrarTexto(errEstadoEl, r.errores.estado);
      mostrarTexto(errMotivoEl, r.errores.motivo);
      mostrarTexto(errObsEl, r.errores.observacion);
      mostrarTexto(errPuntoEl, r.errores.puntoNE);
      return;
    }
    var v = r.valores;
    var partes = [estado.wellId, reemplazoLogic_etiquetaEstado(v.estado)];
    if (v.motivo) {
      partes.push(reemplazoLogic_etiquetaMotivo(v.motivo));
    }
    var resumen = partes.join(' · ');
    if (v.observacion) {
      resumen += '\n' + v.observacion;
    }
    if (v.puntoNEReferencia) {
      resumen += '\nPunto NE: ' + v.puntoNEReferencia;
    }
    var nFotos = reemplazoFotosController_cantidadListas();
    if (nFotos > 0) {
      resumen += '\nFotos: ' + nFotos;
    }
    confirmarResumenEl.textContent = resumen;
    mostrarTexto(confirmarErrorEl, '');
    btnGuardarEl.disabled = false;
    btnConfirmarCancelarEl.disabled = false;
    confirmarOverlayEl.hidden = false;
  }

  function cerrarConfirmacion() {
    confirmarOverlayEl.hidden = true;
  }

  function onGuardar() {
    if (estado.guardando) {
      return;
    }
    var ctx = contexto();
    var r = leerFormulario();
    if (!ctx || !r.valido) {
      cerrarConfirmacion();
      return;
    }
    var v = r.valores;
    var wellIdGuardando = estado.wellId;
    estado.guardando = true;
    btnGuardarEl.disabled = true;
    btnConfirmarCancelarEl.disabled = true;
    mostrarTexto(confirmarErrorEl, '');

    apiRegistrarEvaluacionReemplazo(ctx.sessionToken, wellIdGuardando, v.estado, v.motivo, v.observacion, v.puntoNEReferencia)
      .then(function (resultado) {
        estado.guardando = false;
        if (resultado.status !== 'ok') {
          if (resultado.code === 'UNAUTHORIZED' || resultado.code === 'USER_DISABLED') {
            cerrarConfirmacion();
            if (ctx.onSessionExpired) {
              ctx.onSessionExpired();
            }
            return;
          }
          btnGuardarEl.disabled = false;
          btnConfirmarCancelarEl.disabled = false;
          mostrarTexto(confirmarErrorEl, reemplazoLogic_mensajeError(resultado.code));
          return;
        }
        cerrarConfirmacion();
        // Si el usuario ya cambio de pozo mientras guardaba, la evaluacion
        // igual quedo registrada en el pozo correcto: solo no se pinta aca.
        if (estado.wellId !== wellIdGuardando) {
          return;
        }
        var nueva = resultado.data.evaluacion;
        estado.historial = reemplazoLogic_agregarAlHistorial(estado.historial, nueva);
        var derivado = reemplazoLogic_estadoDesdeHistorial(estado.historial);
        estado.estadoActual = derivado.estado;
        estado.ultimaEvaluacion = derivado.ultimaEvaluacion;
        // Actualizacion INMEDIATA del estado compartido (mapa, Cerca Mio, Mi
        // seleccion): al volver, el badge ya muestra el estado nuevo, sin
        // esperar el cache ni refetchear todo. (El backend invalida su
        // cache al registrar.)
        reemplazoEstadosController_actualizar(wellIdGuardando, derivado.estado);
        // Las fotos se suben DESPUES de guardar la evaluacion (una por
        // request, en cola): si alguna falla, la evaluacion y las demas
        // quedan, y la fallida se puede reintentar. Va antes de
        // cerrarFormulario, que limpia las fotos del formulario.
        reemplazoFotosController_subirDeEvaluacion(nueva);
        cerrarFormulario();
        renderDetalle();
        exitoEl.hidden = false;
        wellIdEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
      })
      .catch(function () {
        estado.guardando = false;
        btnGuardarEl.disabled = false;
        btnConfirmarCancelarEl.disabled = false;
        mostrarTexto(confirmarErrorEl, 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.');
      });
  }

  // --- Eventos ---

  inputPozoEl.addEventListener('input', function () {
    inputPozoEl.value = formatWellIdInput(inputPozoEl.value);
  });

  formPozoEl.addEventListener('submit', function (e) {
    e.preventDefault();
    var normalizado = normalizeWellId(inputPozoEl.value);
    var error = getWellIdError(normalizado);
    if (error) {
      mostrarTexto(pozoErrorEl, getErrorMessage('INVALID_WELL_ID_' + error));
      return;
    }
    mostrarTexto(pozoErrorEl, '');
    inputPozoEl.value = normalizado;
    // Un pozo elegido a mano no hereda el punto NE de otro contexto.
    if (normalizado !== estado.wellId) {
      estado.puntoNEOrigen = '';
    }
    cerrarFormulario();
    exitoEl.hidden = true;
    cargarPozo(normalizado);
  });

  btnReintentarEl.addEventListener('click', function () {
    if (estado.wellId) {
      cargarPozo(estado.wellId);
    }
  });

  btnNuevaEl.addEventListener('click', abrirFormulario);
  btnCancelarEl.addEventListener('click', cerrarFormulario);
  formEl.addEventListener('submit', onContinuar);

  estadosEl.addEventListener('click', function (e) {
    var chip = e.target.closest ? e.target.closest('.reemplazo-estado-chip') : null;
    if (chip) {
      elegirEstadoForm(chip.getAttribute('data-estado'));
    }
  });
  motivoEl.addEventListener('change', function () {
    mostrarTexto(errMotivoEl, '');
    actualizarObsRequerida();
  });

  btnGuardarEl.addEventListener('click', onGuardar);
  btnConfirmarCancelarEl.addEventListener('click', cerrarConfirmacion);

  window.reemplazoController_inicializar = reemplazoController_inicializar;
  window.reemplazoController_abrir = reemplazoController_abrir;
  window.reemplazoController_cerrar = reemplazoController_cerrar;
})();
