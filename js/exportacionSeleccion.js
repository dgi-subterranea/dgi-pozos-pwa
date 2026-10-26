// Controlador DOM de "Exportar Excel (N)" en la pantalla de Mi seleccion (E7-3). Sin pantalla ni modal nuevos: un boton, su estado y mensajes de resultado.
// Toda la decision sobre columnas, formato y contenido vive en js/exportacionSeleccionLogic.js + js/xlsxLogic.js (E7-2); este archivo solo orquesta:
//   1. N = filas que la tabla dibuja AHORA (busqueda + filtro de aptitud + orden): llega de seleccion.js sin ningun pedido (seleccionController_registrarListenerFilasVisibles).
//   2. Al hacer clic: FOTO de esas filas, los filtros, los permisos y los datasets (seleccionController_snapshotExportacion). Lo que cambie despues (busqueda, filtro, orden,
//      seleccion) no entra en un archivo ya iniciado.
//   3. Con perfil === true: disponibilidad de ITF SOLO de esos pozos, en lotes de <= 500 con 3 en vuelo (seleccionController_disponibilidadItfDe). Sin perfil, no se consulta nada.
//   4. JSZip se carga recien aca (mapaShared_cargarJSZip), nunca al entrar a Mi seleccion.
//   5. Se arma el libro (exportacionSeleccion_construirLibro), se genera el XLSX (xlsxLogic_generar) y se descarga con Blob + enlace (compatible con Safari / iPhone).
// ITF parcial o caido NO cancela el archivo: esos pozos quedan con "Tiene ITF" vacio y se avisa. Sesion vencida / cuenta deshabilitada: logout global, sin archivo ni mensaje de error.
// Una sola exportacion a la vez. Sin auditoria nueva en E7 v1 (ver docs/exportacion-seleccion.md).
(function () {
  var REVOCAR_URL_MS = 60000;          // margen largo: Safari / iOS necesita la URL viva hasta que arranca la descarga
  var MENSAJE_OK_MS = 6000;

  var TEXTO_OK = 'Excel descargado.';
  var TEXTO_ITF_PARCIAL = 'El archivo se exportó, pero no se pudo determinar la disponibilidad de ITF para algunos pozos.';
  var TEXTO_ERROR = 'No se pudo preparar el archivo Excel. Intentá nuevamente.';

  // marcas internas para cortar la cadena de promesas (no son errores de usuario)
  var CANCELADA = { cancelada: true };
  var SESION_INVALIDA = { sesionInvalida: true };

  var estado = {
    n: 0,                 // filas visibles en la tabla
    enCurso: false,
    generacion: 0,        // se incrementa al reiniciar (logout): una exportacion en vuelo de otra generacion se descarta
    temporizadorMensaje: null
  };

  var botonEl = document.getElementById('btn-seleccion-exportar');
  var estadoEl = document.getElementById('seleccion-exportar-estado');
  var errorEl = document.getElementById('seleccion-exportar-error');

  function pintarBoton() {
    if (!botonEl) { return; }
    botonEl.textContent = estado.enCurso ? 'Preparando Excel…' : 'Exportar Excel (' + estado.n + ')';
    botonEl.disabled = estado.enCurso || estado.n === 0;
    botonEl.setAttribute('aria-busy', estado.enCurso ? 'true' : 'false');
  }

  function limpiarMensajes() {
    if (estado.temporizadorMensaje !== null) {
      clearTimeout(estado.temporizadorMensaje);
      estado.temporizadorMensaje = null;
    }
    if (estadoEl) { estadoEl.hidden = true; estadoEl.textContent = ''; estadoEl.className = 'seleccion-exportar-mensaje'; }
    if (errorEl) { errorEl.hidden = true; errorEl.textContent = ''; }
  }

  function mostrarEstado(texto, esAviso) {
    if (!estadoEl) { return; }
    estadoEl.textContent = texto;
    estadoEl.className = 'seleccion-exportar-mensaje' + (esAviso ? ' seleccion-exportar-mensaje-aviso' : '');
    estadoEl.hidden = false;
    if (!esAviso) {
      estado.temporizadorMensaje = setTimeout(function () {
        estado.temporizadorMensaje = null;
        if (estadoEl) { estadoEl.hidden = true; estadoEl.textContent = ''; }
      }, MENSAJE_OK_MS);
    }
  }

  function mostrarError(texto) {
    if (!errorEl) { return; }
    errorEl.textContent = texto;
    errorEl.hidden = false;
  }

  // Descarga con Blob + enlace (sin File System Access API ni nada exclusivo de Chromium). La URL se revoca bastante despues, no al instante.
  function descargarBlob(blob, nombreArchivo) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, REVOCAR_URL_MS);
  }

  function exportar() {
    if (estado.enCurso) {
      return;
    }
    var foto;
    try {
      foto = seleccionController_snapshotExportacion();
    } catch (e) {
      foto = null;
    }
    if (!foto || !foto.wellIds || foto.wellIds.length === 0) {
      return;
    }

    estado.enCurso = true;
    var generacion = estado.generacion;
    var ahora = new Date();
    limpiarMensajes();
    pintarBoton();

    function vigente() { return generacion === estado.generacion; }
    var itf = null;

    seleccionController_disponibilidadItfDe(foto.wellIds).then(function (resultado) {
      if (!vigente()) { throw CANCELADA; }
      if (resultado && resultado.sesionInvalida) { throw SESION_INVALIDA; }       // el logout global ya se disparo: no se genera nada
      itf = resultado;
      return mapaShared_cargarJSZip();
    }).then(function () {
      if (!vigente()) { throw CANCELADA; }
      var modelo = exportacionSeleccion_construirLibro({
        wellIds: foto.wellIds,
        totalSeleccion: foto.totalSeleccion,
        permisos: foto.permisos,
        indicePozos: foto.indicePozos,
        neSet: foto.neSet,
        itf: itf,
        resumenReemplazo: foto.resumenReemplazo,
        filtros: foto.filtros,
        periodoPadron: foto.periodoPadron,
        ahora: ahora
      });
      return xlsxLogic_generar(modelo.libro, window.JSZip, 'uint8array').then(function (bytes) {
        return { bytes: bytes, nombreArchivo: modelo.nombreArchivo };
      });
    }).then(function (archivo) {
      if (!vigente()) { throw CANCELADA; }
      descargarBlob(new Blob([archivo.bytes], { type: XLSX_MIME }), archivo.nombreArchivo);
      // con perfil, todo pozo exportado sin respuesta de ITF cuenta como "no se pudo determinar"
      var itfIncompleto = foto.permisos.perfil === true && (!itf || !itf.completo);
      if (itfIncompleto) {
        mostrarEstado(TEXTO_ITF_PARCIAL, true);
      } else {
        mostrarEstado(TEXTO_OK, false);
      }
    }).catch(function (error) {
      if (error === CANCELADA || error === SESION_INVALIDA) { return; }
      if (vigente()) { mostrarError(TEXTO_ERROR); }
    }).then(function () {
      if (vigente()) {
        estado.enCurso = false;
        pintarBoton();
      }
    });
  }

  // Logout: se descarta lo que este en vuelo (no se descarga nada despues de cerrar sesion) y se limpia el boton.
  function exportacionSeleccionController_reset() {
    estado.generacion += 1;
    estado.enCurso = false;
    estado.n = 0;
    limpiarMensajes();
    pintarBoton();
  }

  if (botonEl) {
    botonEl.addEventListener('click', exportar);
  }
  seleccionController_registrarListenerFilasVisibles(function (n) {
    estado.n = typeof n === 'number' && n > 0 ? n : 0;
    pintarBoton();
  });
  pintarBoton();

  window.exportacionSeleccionController_reset = exportacionSeleccionController_reset;
})();
