// Flujos con ESTADO de los ITF colaborativos en el navegador (E9-6, local, NO productivo). Sin DOM: cada fabrica recibe sus dependencias (contexto fresco, llamadas a la API, generador de ids, onCambio) y devuelve un
// objeto con metodos y un snapshot() puro, asi se prueba todo con Jest y el controlador DOM solo pinta. Requiere js/itfLogic.js cargado antes.
//
// Reglas comunes a TODOS los flujos:
//  - Contexto fresco en cada llamada (obtenerContexto -> {sessionToken, permisos, onSessionExpired}): el permiso se vuelve a mirar al actuar, nunca se cachea. El backend es la autoridad; esto evita pedir lo que
//    seguro va a fallar.
//  - Respuestas viejas: cada carga lleva un TOKEN y una GENERACION (reset = cierre de sesion / cierre de la pantalla). Una respuesta que llega tarde NO pisa el estado nuevo.
//  - Tras una mutacion nada se "parcha": la lista / el contexto se vuelven a pedir (nunca se muestran datos anteriores a la accion).
//  - Ids de intencion (clientRequestId): uno por intencion (archivo elegido, apertura del modal, confirmacion de retiro), el MISMO en cada reintento de esa intencion; una intencion nueva, un id nuevo.
//  - Doble toque: mientras hay un envio en vuelo, otro toque devuelve la misma promesa y NO envia de nuevo.

var ITF_PAGINA = 20;
var ITF_ZOOMS = [1, 1.5, 2, 3, 4];

function itfFlujos_contexto(deps) {
  return (deps.obtenerContexto ? deps.obtenerContexto() : null) || {};
}

function itfFlujos_sesionVencida(deps) {
  var c = itfFlujos_contexto(deps);
  if (typeof c.onSessionExpired === 'function') {
    c.onSessionExpired();
  }
}

// Una llamada a la API que NUNCA lanza ni rechaza: {resp} | {code}. Una respuesta rara es un error generico, una caida de red es 'RED'.
function itfFlujos_llamar(fn) {
  return new Promise(function (resolver) {
    resolver(fn());
  }).then(function (resp) {
    if (resp && resp.status === 'ok') {
      return { resp: resp };
    }
    return { code: itfLogic_codigoDeRespuesta(resp) };
  }, function () {
    return { code: 'RED' };
  });
}

// --- Perfil: el ITF vigente al abrir ---

// deps: obtenerContexto, cargar(sessionToken, wellId) -> Promise<getProfile>, onCambio(snapshot)
function itfFlujos_crearPerfil(deps) {
  var generacion = 0;
  var token = 0;
  var s = { fase: 'VACIO', wellId: null, imagen: null, code: null, mensaje: '' };

  function snapshot() {
    return {
      fase: s.fase,
      wellId: s.wellId,
      imagen: s.imagen,
      mensaje: s.mensaje,
      reintentable: s.fase === 'ERROR' && itfLogic_esReintentable(s.code),
      hayVigente: s.fase === 'LISTO'
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  function cargar(wellId) {
    token += 1;
    var mio = token;
    var gen = generacion;
    s = { fase: 'CARGANDO', wellId: wellId, imagen: null, code: null, mensaje: '' };
    cambio();
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeVerPerfil(ctx.permisos)) {
      s.fase = 'ERROR';
      s.code = 'PERMISSION_DENIED';
      s.mensaje = itfLogic_mensajeError('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(snapshot());
    }
    return itfFlujos_llamar(function () { return deps.cargar(ctx.sessionToken, wellId); }).then(function (r) {
      if (mio !== token || gen !== generacion) {
        return snapshot();
      }
      if (r.resp) {
        var d = r.resp.data || {};
        var uri = itfLogic_dataUri(d.mimeType, d.imageBase64);
        if (uri === null) {
          s.fase = 'ERROR';
          s.code = 'ERROR';
          s.mensaje = itfLogic_mensajeError('ERROR');
        } else {
          s.fase = 'LISTO';
          s.imagen = { mimeType: d.mimeType, base64: d.imageBase64, dataUri: uri };
        }
        cambio();
        return snapshot();
      }
      if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      }
      if (r.code === 'PROFILE_NOT_FOUND') {
        s.fase = 'SIN_ITF';
        s.mensaje = itfLogic_mensajePerfil('PROFILE_NOT_FOUND');
      } else {
        s.fase = 'ERROR';
        s.code = r.code;
        s.mensaje = itfLogic_mensajePerfil(r.code);
      }
      cambio();
      return snapshot();
    });
  }

  return {
    abrir: cargar,
    reintentar: function () { return s.wellId === null ? Promise.resolve(snapshot()) : cargar(s.wellId); },
    // despues de aprobar / retirar / restaurar: lo que se veia ya no vale
    refrescar: function () { return s.wellId === null ? Promise.resolve(snapshot()) : cargar(s.wellId); },
    reset: function () { generacion += 1; token += 1; s = { fase: 'VACIO', wellId: null, imagen: null, code: null, mensaje: '' }; cambio(); },
    snapshot: snapshot
  };
}

// --- Proponer un ITF ---

// deps: obtenerContexto, preparar(archivo) -> Promise<{base64, bytes, mimeType, ancho, alto, accion:'CONSERVADA'|'REDUCIDA', previewUrl}>, enviar(sessionToken, payload) -> Promise<proponerItf>,
//       nuevoId(), liberarPreview(url), onCambio(snapshot), alProponer(data)
// fases: VACIO -> PREPARANDO -> LISTO -> ENVIANDO -> ENVIADO; ERROR_ARCHIVO (no se puede enviar), ERROR_ENVIO (se puede reintentar con el MISMO id).
function itfFlujos_crearProponer(deps) {
  var generacion = 0;
  var prepToken = 0;
  var enVuelo = null;
  var s = estadoInicial();

  function estadoInicial() {
    return { abierto: false, wellId: null, hayVigente: false, fase: 'VACIO', nombre: '', bytesOriginal: null, preparado: null, intentoId: null, mensaje: null };
  }

  function liberar() {
    if (s.preparado && s.preparado.previewUrl && deps.liberarPreview) { deps.liberarPreview(s.preparado.previewUrl); }
  }

  function snapshot() {
    var p = s.preparado;
    return {
      abierto: s.abierto,
      wellId: s.wellId,
      fase: s.fase,
      titulo: s.hayVigente ? 'Proponer nueva versión' : 'Proponer ITF',
      nombre: s.nombre,
      tamanoOriginal: s.bytesOriginal === null ? '' : itfLogic_formatearBytes(s.bytesOriginal),
      preview: p ? p.previewUrl : null,
      tamanoFinal: p ? itfLogic_formatearBytes(p.bytes) : '',
      dimensiones: p ? p.ancho + ' × ' + p.alto + ' px' : '',
      accionImagen: p ? p.accion : null,
      puedeEnviar: (s.fase === 'LISTO' || s.fase === 'ERROR_ENVIO') && p !== null,
      enviando: s.fase === 'ENVIANDO',
      preparando: s.fase === 'PREPARANDO',
      enviado: s.fase === 'ENVIADO',
      textoBoton: s.fase === 'ENVIANDO' ? 'Enviando…' : (s.fase === 'ERROR_ENVIO' ? 'Reintentar envío' : 'Enviar propuesta'),
      mensaje: s.mensaje
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }
  function aviso(texto, tipo) { s.mensaje = texto ? { texto: texto, tipo: tipo } : null; }

  function reiniciarArchivo() {
    liberar();
    s.fase = 'VACIO';
    s.nombre = '';
    s.bytesOriginal = null;
    s.preparado = null;
    s.intentoId = null;
  }

  function puede() {
    return itfLogic_puedeProponer(itfFlujos_contexto(deps).permisos);
  }

  function abrir(wellId, hayVigente) {
    prepToken += 1;
    liberar();
    s = estadoInicial();
    if (!puede()) {
      cambio();
      return false;
    }
    s.abierto = true;
    s.wellId = wellId;
    s.hayVigente = hayVigente === true;
    cambio();
    return true;
  }

  function elegir(archivo) {
    if (!s.abierto || s.fase === 'ENVIANDO') { return Promise.resolve(snapshot()); }
    if (!puede()) {
      reiniciarArchivo();
      aviso(itfLogic_mensajeError('PERMISSION_DENIED'), 'error');
      cambio();
      return Promise.resolve(snapshot());
    }
    prepToken += 1;
    var mio = prepToken;
    var gen = generacion;
    reiniciarArchivo();
    var v = itfLogic_validarArchivoElegido(archivo);
    if (!v.ok) {
      s.fase = 'ERROR_ARCHIVO';
      aviso(v.mensaje, 'error');
      cambio();
      return Promise.resolve(snapshot());
    }
    s.fase = 'PREPARANDO';
    s.nombre = typeof archivo.name === 'string' ? archivo.name : '';
    s.bytesOriginal = archivo.size;
    s.intentoId = deps.nuevoId();              // archivo nuevo = intencion nueva = id nuevo
    aviso('', null);
    cambio();
    return new Promise(function (resolver) { resolver(deps.preparar(archivo)); }).then(function (p) {
      if (mio !== prepToken || gen !== generacion) {
        if (p && p.previewUrl && deps.liberarPreview) { deps.liberarPreview(p.previewUrl); }
        return snapshot();
      }
      s.preparado = p;
      var t = itfLogic_resultadoDeTamano(p.bytes);
      if (!t.ok) {
        s.fase = 'ERROR_ARCHIVO';
        aviso(t.mensaje, 'error');
      } else {
        s.fase = 'LISTO';
        aviso('', null);
      }
      cambio();
      return snapshot();
    }, function (err) {
      if (mio !== prepToken || gen !== generacion) { return snapshot(); }
      s.fase = 'ERROR_ARCHIVO';
      s.preparado = null;
      aviso(err && err.mensaje ? err.mensaje : 'No se pudo preparar la imagen. Probá con otra.', 'error');
      cambio();
      return snapshot();
    });
  }

  function enviar() {
    if (enVuelo !== null) { return enVuelo; }
    if (!s.abierto || !(s.fase === 'LISTO' || s.fase === 'ERROR_ENVIO') || s.preparado === null) { return Promise.resolve(snapshot()); }
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeProponer(ctx.permisos)) {
      s.fase = 'ERROR_ENVIO';
      aviso(itfLogic_mensajeError('PERMISSION_DENIED'), 'error');
      cambio();
      return Promise.resolve(snapshot());
    }
    var gen = generacion;
    var token = prepToken;
    var p = s.preparado;
    var payload = { wellId: s.wellId, imageBase64: p.base64, mimeType: p.mimeType, nombreOriginal: s.nombre, clientRequestId: s.intentoId };
    s.fase = 'ENVIANDO';
    aviso('', null);
    cambio();
    enVuelo = itfFlujos_llamar(function () { return deps.enviar(ctx.sessionToken, payload); }).then(function (r) {
      enVuelo = null;
      if (gen !== generacion || token !== prepToken) { return snapshot(); }
      if (r.resp) {
        liberar();
        s.fase = 'ENVIADO';
        s.preparado = null;
        aviso('ITF propuesto. Queda pendiente de validación.', 'ok');
        cambio();
        if (deps.alProponer) { deps.alProponer(r.resp.data); }
        return snapshot();
      }
      if (itfLogic_esErrorDeSesion(r.code)) {
        s.fase = 'ERROR_ENVIO';
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      }
      if (r.code === 'IDEMPOTENCY_CONFLICT') {
        // el id ya quedo asociado a otro contenido: la unica salida es volver a elegir el archivo (id nuevo)
        reiniciarArchivo();
        aviso(itfLogic_mensajeError(r.code), 'error');
        cambio();
        return snapshot();
      }
      s.fase = 'ERROR_ENVIO';
      aviso(itfLogic_mensajeError(r.code), 'error');
      cambio();
      return snapshot();
    });
    return enVuelo;
  }

  return {
    abrir: abrir,
    elegir: elegir,
    enviar: enviar,
    descartar: function () { if (s.abierto && s.fase !== 'ENVIANDO') { prepToken += 1; reiniciarArchivo(); aviso('', null); cambio(); } },
    cerrar: function () { prepToken += 1; liberar(); s = estadoInicial(); enVuelo = null; cambio(); },
    reset: function () { generacion += 1; prepToken += 1; liberar(); s = estadoInicial(); enVuelo = null; cambio(); },
    snapshot: snapshot
  };
}

// --- Mis propuestas (perfil + perfil_subir) ---

// deps: obtenerContexto, consultar(sessionToken, wellIdOnull, limite, cursor), retirar(sessionToken, {documentoId, clientRequestId}), nuevoId(), onCambio(snapshot), alRetirar()
// alcance 'POZO' (las de este pozo, el filtro lo hace el SERVIDOR) o 'TODOS'.
function itfFlujos_crearMisPropuestas(deps) {
  var generacion = 0;
  var enVuelo = null;
  var s = estadoInicial();

  function estadoInicial() {
    return { abierto: false, wellId: null, alcance: 'POZO', token: 0, items: [], cursor: null, hayMas: false, total: null, incompleta: false, cargando: false, cargandoMas: false, cargada: false, error: null, errorMas: null, aviso: null, retiro: null };
  }
  function snapshot() {
    return {
      abierto: s.abierto,
      wellId: s.wellId,
      alcance: s.alcance,
      items: s.items.map(function (i) {
        return {
          documentoId: i.documentoId, wellId: i.wellId, estado: i.estado, textoEstado: itfLogic_textoEstadoPropuesta(i.estado), puedeRetirar: i.puedeRetirar === true, esVigente: i.esVigente === true,
          nombre: itfLogic_nombreDocumento(i), tamano: itfLogic_formatearBytes(i.bytes), enviadaEl: itfLogic_formatearFecha(i.timestampUtc), decididaEl: itfLogic_formatearFecha(i.decididoEn),
          motivo: i.retiradaPorMi === true ? 'Retirada por vos' : [itfLogic_textoMotivoGuardado(i.motivoCodigo), i.motivoTexto || ''].filter(function (x) { return x !== ''; }).join(': ')
        };
      }),
      hayMas: s.hayMas,
      total: s.total,
      incompleta: s.incompleta,
      cargando: s.cargando,
      cargandoMas: s.cargandoMas,
      vacia: s.cargada && !s.cargando && s.error === null && s.items.length === 0,
      error: s.error,
      errorMas: s.errorMas,
      aviso: s.aviso,
      retiro: s.retiro === null ? null : { documentoId: s.retiro.documentoId, enviando: s.retiro.enviando, error: s.retiro.error }
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  function pedir(cursor) {
    var ctx = itfFlujos_contexto(deps);
    var wellId = s.alcance === 'POZO' ? s.wellId : null;
    return itfFlujos_llamar(function () { return deps.consultar(ctx.sessionToken, wellId, ITF_PAGINA, cursor); });
  }

  function cargarPrimera() {
    var gen = generacion;
    var aviso = s.aviso;
    s.token += 1;
    var mio = s.token;
    s.items = [];
    s.cursor = null;
    s.hayMas = false;
    s.total = null;
    s.incompleta = false;
    s.cargada = false;
    s.error = null;
    s.errorMas = null;
    s.cargandoMas = false;
    s.aviso = aviso;
    if (!itfLogic_puedeProponer(itfFlujos_contexto(deps).permisos)) {
      s.error = { code: 'PERMISSION_DENIED', mensaje: itfLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    s.cargando = true;
    cambio();
    return pedir(undefined).then(function (r) {
      if (mio !== s.token || gen !== generacion) { return snapshot(); }
      s.cargando = false;
      if (r.resp) {
        var d = r.resp.data || {};
        s.items = Array.isArray(d.items) ? d.items : [];
        s.cursor = typeof d.siguienteCursor === 'string' ? d.siguienteCursor : null;
        s.hayMas = s.cursor !== null;
        s.total = typeof d.total === 'number' ? d.total : null;
        s.incompleta = d.incompleta === true;
        s.cargada = true;
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.error = { code: r.code, mensaje: itfLogic_mensajeError(r.code) };
      }
      cambio();
      return snapshot();
    });
  }

  function verMas() {
    if (!s.abierto || !s.hayMas || s.cargando || s.cargandoMas || s.cursor === null) { return Promise.resolve(snapshot()); }
    var gen = generacion;
    s.token += 1;
    var mio = s.token;
    s.cargandoMas = true;
    s.errorMas = null;
    cambio();
    return pedir(s.cursor).then(function (r) {
      if (mio !== s.token || gen !== generacion) { return snapshot(); }
      s.cargandoMas = false;
      if (r.resp) {
        var d = r.resp.data || {};
        var vistos = {};
        s.items.forEach(function (i) { vistos[i.documentoId] = true; });
        (Array.isArray(d.items) ? d.items : []).forEach(function (i) { if (!vistos[i.documentoId]) { s.items.push(i); } });
        s.cursor = typeof d.siguienteCursor === 'string' ? d.siguienteCursor : null;
        s.hayMas = s.cursor !== null;
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.errorMas = itfLogic_mensajeError(r.code);
      }
      cambio();
      return snapshot();
    });
  }

  function confirmarRetiro() {
    if (enVuelo !== null) { return enVuelo; }
    var r = s.retiro;
    if (!s.abierto || r === null) { return Promise.resolve(snapshot()); }
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeProponer(ctx.permisos)) {
      r.error = itfLogic_mensajeError('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(snapshot());
    }
    var gen = generacion;
    r.enviando = true;
    r.error = null;
    cambio();
    enVuelo = itfFlujos_llamar(function () { return deps.retirar(ctx.sessionToken, { documentoId: r.documentoId, clientRequestId: r.id }); }).then(function (res) {
      enVuelo = null;
      if (gen !== generacion || s.retiro !== r) { return snapshot(); }
      r.enviando = false;
      if (res.resp) {
        s.retiro = null;
        s.aviso = { texto: ITF_ACCIONES_UI.RETIRAR_PROPUESTA.exito, error: false };
        cambio();
        if (deps.alRetirar) { deps.alRetirar(); }
        return cargarPrimera();
      }
      if (itfLogic_esErrorDeSesion(res.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      }
      if (res.code === 'DOCUMENTO_NO_PROPUESTO' || res.code === 'DOCUMENTO_NO_RETIRABLE' || res.code === 'ITF_NOT_FOUND' || res.code === 'PERMISSION_DENIED') {
        // ya no esta pendiente (la resolvio alguien mas) o no es mia: lo que se veia esta viejo -> se cierra y se vuelve a pedir
        s.retiro = null;
        s.aviso = { texto: res.code === 'PERMISSION_DENIED' ? itfLogic_mensajeError(res.code) : 'Esta propuesta ya no estaba pendiente. Se actualizó la lista.', error: res.code === 'PERMISSION_DENIED' };
        cambio();
        return cargarPrimera();
      }
      r.error = itfLogic_mensajeError(res.code);
      cambio();
      return snapshot();
    });
    return enVuelo;
  }

  return {
    abrir: function (wellId) {
      generacion += 1;
      s = estadoInicial();
      s.abierto = true;
      s.wellId = wellId;
      return cargarPrimera();
    },
    cambiarAlcance: function (alcance) {
      if (!s.abierto || (alcance !== 'POZO' && alcance !== 'TODOS') || alcance === s.alcance) { return Promise.resolve(snapshot()); }
      s.alcance = alcance;
      return cargarPrimera();
    },
    recargar: function () { return s.abierto ? cargarPrimera() : Promise.resolve(snapshot()); },
    verMas: verMas,
    pedirRetiro: function (documentoId) {
      var existe = s.items.filter(function (i) { return i.documentoId === documentoId && i.puedeRetirar === true; }).length === 1;
      if (!s.abierto || s.retiro !== null || !existe) { return false; }
      s.retiro = { documentoId: documentoId, id: deps.nuevoId(), enviando: false, error: null };      // intencion nueva = id nuevo
      cambio();
      return true;
    },
    cancelarRetiro: function () { if (s.retiro !== null && !s.retiro.enviando) { s.retiro = null; cambio(); } },
    confirmarRetiro: confirmarRetiro,
    avisarProponer: function () { s.aviso = null; return s.abierto ? cargarPrimera() : Promise.resolve(snapshot()); },
    cerrar: function () { generacion += 1; s = estadoInicial(); enVuelo = null; cambio(); },
    reset: function () { generacion += 1; s = estadoInicial(); enVuelo = null; cambio(); },
    snapshot: snapshot
  };
}

// --- Cola de propuestas pendientes (perfil + perfil_validar) ---

// deps: obtenerContexto, consultar(sessionToken, limite, cursor), onCambio(snapshot)
function itfFlujos_crearCola(deps) {
  var generacion = 0;
  var s = estadoInicial();

  function estadoInicial() {
    return { abierta: false, token: 0, items: [], cursor: null, hayMas: false, total: null, sinDerivar: 0, cargando: false, cargandoMas: false, cargada: false, error: null, errorMas: null, aviso: null };
  }
  function snapshot() {
    return {
      abierta: s.abierta,
      items: s.items.map(function (i) {
        return {
          documentoId: i.documentoId, wellId: i.wellId, nombreArchivo: itfLogic_nombreDocumento(i), tamano: itfLogic_formatearBytes(i.bytes), proponente: typeof i.nombreProponente === 'string' ? i.nombreProponente : '',
          enviadaEl: itfLogic_formatearFecha(i.timestampUtc), propia: i.autoPropuestaPropia === true, advertencia: i.warningDuplicadoOtroPozo === true ? (i.warningMensaje || 'Este mismo archivo aparece asociado a otro pozo.') : ''
        };
      }),
      hayMas: s.hayMas,
      total: s.total,
      sinDerivar: s.sinDerivar,
      cargando: s.cargando,
      cargandoMas: s.cargandoMas,
      vacia: s.cargada && !s.cargando && s.error === null && s.items.length === 0,
      error: s.error,
      errorMas: s.errorMas,
      aviso: s.aviso
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  function pedir(cursor) {
    var ctx = itfFlujos_contexto(deps);
    return itfFlujos_llamar(function () { return deps.consultar(ctx.sessionToken, ITF_PAGINA, cursor); });
  }

  // Siempre desde cero (items, cursor): nunca se muestra una lista vieja mientras se vuelve a pedir.
  function cargarPrimera(aviso) {
    var gen = generacion;
    s.token += 1;
    var mio = s.token;
    s.items = [];
    s.cursor = null;
    s.hayMas = false;
    s.total = null;
    s.sinDerivar = 0;
    s.cargada = false;
    s.cargandoMas = false;
    s.error = null;
    s.errorMas = null;
    s.aviso = aviso || null;
    if (!itfLogic_puedeValidar(itfFlujos_contexto(deps).permisos)) {
      s.error = { code: 'PERMISSION_DENIED', mensaje: itfLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    s.cargando = true;
    cambio();
    return pedir(undefined).then(function (r) {
      if (mio !== s.token || gen !== generacion) { return snapshot(); }
      s.cargando = false;
      if (r.resp) {
        var d = r.resp.data || {};
        s.items = Array.isArray(d.items) ? d.items : [];
        s.cursor = typeof d.siguienteCursor === 'string' ? d.siguienteCursor : null;
        s.hayMas = s.cursor !== null;
        s.total = typeof d.total === 'number' ? d.total : null;
        s.sinDerivar = typeof d.pozosSinDerivar === 'number' ? d.pozosSinDerivar : 0;
        s.cargada = true;
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.error = { code: r.code, mensaje: itfLogic_mensajeError(r.code) };
      }
      cambio();
      return snapshot();
    });
  }

  function verMas() {
    if (!s.abierta || !s.hayMas || s.cargando || s.cargandoMas || s.cursor === null) { return Promise.resolve(snapshot()); }
    var gen = generacion;
    s.token += 1;
    var mio = s.token;
    s.cargandoMas = true;
    s.errorMas = null;
    cambio();
    return pedir(s.cursor).then(function (r) {
      if (mio !== s.token || gen !== generacion) { return snapshot(); }
      s.cargandoMas = false;
      if (r.resp) {
        var d = r.resp.data || {};
        var vistos = {};
        s.items.forEach(function (i) { vistos[i.documentoId] = true; });
        (Array.isArray(d.items) ? d.items : []).forEach(function (i) { if (!vistos[i.documentoId]) { s.items.push(i); } });
        s.cursor = typeof d.siguienteCursor === 'string' ? d.siguienteCursor : null;
        s.hayMas = s.cursor !== null;
        if (typeof d.total === 'number') { s.total = d.total; }
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.errorMas = itfLogic_mensajeError(r.code);
      }
      cambio();
      return snapshot();
    });
  }

  return {
    abrir: function () { generacion += 1; s = estadoInicial(); s.abierta = true; return cargarPrimera(); },
    recargar: function (aviso) { return s.abierta ? cargarPrimera(aviso) : Promise.resolve(snapshot()); },
    verMas: verMas,
    // el aviso se muestra DESPUES de volver a pedir la lista (nunca se parcha la lista vieja)
    recargarConAviso: function (texto, esError) { return s.abierta ? cargarPrimera({ texto: texto, error: esError === true }) : Promise.resolve(snapshot()); },
    cerrar: function () { generacion += 1; s = estadoInicial(); cambio(); },
    reset: function () { generacion += 1; s = estadoInicial(); cambio(); },
    snapshot: snapshot
  };
}

// --- Visor de un documento (+ comparacion con el vigente) ---

// deps: obtenerContexto, abrir(sessionToken, documentoId) -> Promise<getItfDocumentoModeracion>, onCambio(snapshot)
function itfFlujos_crearVisor(deps) {
  var generacion = 0;
  var s = estadoInicial();

  function estadoInicial() {
    return { abierto: false, token: 0, tokenVigente: 0, documentoId: null, cargando: false, error: null, doc: null, pozo: null, imagen: null, vigente: { fase: 'NINGUNO', doc: null, imagen: null, error: null }, vista: 'PROPUESTA', comparando: false, zoom: 0 };
  }

  function puedeComparar() {
    return s.pozo !== null && typeof s.pozo.vigenteActualDocumentoId === 'string' && s.pozo.vigenteActualDocumentoId !== s.documentoId;
  }

  function snapshot() {
    return {
      abierto: s.abierto,
      cargando: s.cargando,
      error: s.error,
      doc: s.doc === null ? null : {
        documentoId: s.doc.documentoId, wellId: s.doc.wellId, estado: s.doc.estado, textoEstado: itfLogic_textoEstadoDocumento(s.doc.estado), nombre: itfLogic_nombreDocumento(s.doc), tamano: itfLogic_formatearBytes(s.doc.bytes),
        proponente: s.doc.nombreProponente || '', enviadaEl: itfLogic_formatearFecha(s.doc.propuestoEn), propia: s.doc.autoPropuestaPropia === true, advertencia: s.doc.warningDuplicadoOtroPozo === true ? 'Este mismo archivo aparece asociado a otro pozo.' : '',
        esPropuesta: s.doc.estado === 'PROPUESTO', esExistente: s.doc.origen === 'LEGACY', restaurable: s.doc.restaurable === true
      },
      wellId: s.doc === null ? null : s.doc.wellId,
      imagen: s.imagen,
      hayVigente: s.pozo !== null && typeof s.pozo.vigenteActualDocumentoId === 'string',
      vigenteIndeterminado: s.pozo !== null && s.pozo.vigenteIndeterminado === true,
      puedeComparar: puedeComparar(),
      comparando: s.comparando,
      vista: s.vista,
      vigente: { fase: s.vigente.fase, imagen: s.vigente.imagen, error: s.vigente.error, nombre: s.vigente.doc === null ? '' : itfLogic_nombreDocumento(s.vigente.doc), tamano: s.vigente.doc === null ? '' : itfLogic_formatearBytes(s.vigente.doc.bytes) },
      zoom: ITF_ZOOMS[s.zoom],
      puedeAcercar: s.zoom < ITF_ZOOMS.length - 1,
      puedeAlejar: s.zoom > 0
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  // {doc, pozo, imagen} de una respuesta OK, o null si no se puede leer (una respuesta rara nunca deja la pantalla "cargando" para siempre).
  function leer(resp) {
    var d = resp && resp.data;
    if (!d || !d.documento || !d.pozo || !d.imagen) { return null; }
    var uri = itfLogic_dataUri(d.imagen.mimeType, d.imagen.imagenBase64);
    return uri === null ? null : { doc: d.documento, pozo: d.pozo, imagen: { mimeType: d.imagen.mimeType, dataUri: uri } };
  }

  function cargar(documentoId) {
    var gen = generacion;
    s.token += 1;
    s.tokenVigente += 1;
    var mio = s.token;
    s.documentoId = documentoId;
    s.cargando = true;
    s.error = null;
    s.doc = null;
    s.pozo = null;
    s.imagen = null;
    s.vigente = { fase: 'NINGUNO', doc: null, imagen: null, error: null };
    s.vista = 'PROPUESTA';
    s.comparando = false;
    s.zoom = 0;
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeValidar(ctx.permisos)) {
      s.cargando = false;
      s.error = { code: 'PERMISSION_DENIED', mensaje: itfLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    cambio();
    return itfFlujos_llamar(function () { return deps.abrir(ctx.sessionToken, documentoId); }).then(function (r) {
      if (mio !== s.token || gen !== generacion) { return snapshot(); }
      s.cargando = false;
      var v = r.resp ? leer(r.resp) : null;
      if (v !== null) {
        s.doc = v.doc;
        s.pozo = v.pozo;
        s.imagen = v.imagen;
      } else if (r.resp) {
        s.error = { code: 'ERROR', mensaje: itfLogic_mensajeError('ERROR') };
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.error = { code: r.code, mensaje: itfLogic_mensajeError(r.code) };
      }
      cambio();
      return snapshot();
    });
  }

  function cargarVigente() {
    if (!puedeComparar() || s.vigente.fase === 'CARGANDO' || s.vigente.fase === 'LISTO') { return Promise.resolve(snapshot()); }
    var gen = generacion;
    s.tokenVigente += 1;
    var mio = s.tokenVigente;
    var idVigente = s.pozo.vigenteActualDocumentoId;
    s.vigente = { fase: 'CARGANDO', doc: null, imagen: null, error: null };
    cambio();
    var ctx = itfFlujos_contexto(deps);
    return itfFlujos_llamar(function () { return deps.abrir(ctx.sessionToken, idVigente); }).then(function (r) {
      if (mio !== s.tokenVigente || gen !== generacion) { return snapshot(); }
      var v = r.resp ? leer(r.resp) : null;
      if (v !== null) {
        s.vigente = { fase: 'LISTO', doc: v.doc, imagen: v.imagen, error: null };
      } else if (r.code && itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.vigente = { fase: 'ERROR', doc: null, imagen: null, error: itfLogic_mensajeError(r.code || 'ERROR') };
      }
      cambio();
      return snapshot();
    });
  }

  return {
    abrir: function (documentoId) {
      generacion += 1;
      s = estadoInicial();
      s.abierto = true;
      return cargar(documentoId);
    },
    // despues de un cambio de vigente (o de una accion): TODO se vuelve a pedir
    recargar: function () { return s.abierto && s.documentoId !== null ? cargar(s.documentoId) : Promise.resolve(snapshot()); },
    comparar: function () {
      if (!s.abierto || !puedeComparar()) { return Promise.resolve(snapshot()); }
      s.comparando = true;
      cambio();
      return cargarVigente();
    },
    dejarDeComparar: function () { s.comparando = false; s.vista = 'PROPUESTA'; cambio(); },
    verVista: function (vista) {
      if (!s.comparando || (vista !== 'PROPUESTA' && vista !== 'VIGENTE')) { return; }
      s.vista = vista;
      cambio();
    },
    acercar: function () { if (s.zoom < ITF_ZOOMS.length - 1) { s.zoom += 1; cambio(); } },
    alejar: function () { if (s.zoom > 0) { s.zoom -= 1; cambio(); } },
    ajustar: function () { s.zoom = 0; cambio(); },
    // lo que necesita aprobar / restaurar desde el visor: el documento y el vigente QUE ESTA PERSONA VIO
    contextoDeAccion: function () {
      if (s.doc === null || s.pozo === null) { return null; }
      return {
        documentoId: s.doc.documentoId,
        wellId: s.doc.wellId,
        entidad: itfLogic_nombreDocumento(s.doc) + ' · pozo ' + s.doc.wellId,
        vigenteEsperadoDocumentoId: typeof s.pozo.vigenteActualDocumentoId === 'string' ? s.pozo.vigenteActualDocumentoId : null
      };
    },
    cerrar: function () { generacion += 1; s = estadoInicial(); cambio(); },
    reset: function () { generacion += 1; s = estadoInicial(); cambio(); },
    snapshot: snapshot
  };
}

// --- Historial de un pozo (perfil + perfil_validar) ---

// deps: obtenerContexto, consultar(sessionToken, wellId) -> Promise<getHistorialItf>, onCambio(snapshot)
function itfFlujos_crearHistorial(deps) {
  var generacion = 0;
  var token = 0;
  var s = estadoInicial();

  function estadoInicial() {
    return { abierto: false, wellId: null, cargando: false, error: null, cargado: false, historial: [], documentos: [], pozo: null };
  }
  function snapshot() {
    var vigente = itfLogic_documentoVigente(s.documentos);
    return {
      abierto: s.abierto,
      wellId: s.wellId,
      cargando: s.cargando,
      error: s.error,
      filas: itfLogic_filasHistorial(s.historial, s.documentos),
      vacio: s.cargado && !s.cargando && s.error === null && itfLogic_filasHistorial(s.historial, s.documentos).length === 0,
      hayVigente: s.pozo !== null && typeof s.pozo.vigenteActualDocumentoId === 'string',
      vigente: vigente === null ? null : { documentoId: vigente.documentoId, nombre: itfLogic_nombreDocumento(vigente), vigenteDesde: itfLogic_formatearFecha(vigente.vigenteDesde) },
      vigenteActualDocumentoId: s.pozo === null ? null : (typeof s.pozo.vigenteActualDocumentoId === 'string' ? s.pozo.vigenteActualDocumentoId : null),
      restaurables: itfLogic_documentosRestaurables(s.documentos).map(function (d) {
        return { documentoId: d.documentoId, wellId: d.wellId, nombre: itfLogic_nombreDocumento(d), estado: itfLogic_textoEstadoDocumento(d.estado), tamano: itfLogic_formatearBytes(d.bytes), vigenteDesde: itfLogic_formatearFecha(d.vigenteDesde) };
      })
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  function cargar(wellId) {
    var gen = generacion;
    token += 1;
    var mio = token;
    s.wellId = wellId;
    s.cargando = true;
    s.error = null;
    s.cargado = false;
    s.historial = [];
    s.documentos = [];
    s.pozo = null;
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeValidar(ctx.permisos)) {
      s.cargando = false;
      s.error = { code: 'PERMISSION_DENIED', mensaje: itfLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    cambio();
    return itfFlujos_llamar(function () { return deps.consultar(ctx.sessionToken, wellId); }).then(function (r) {
      if (mio !== token || gen !== generacion) { return snapshot(); }
      s.cargando = false;
      if (r.resp && r.resp.data && Array.isArray(r.resp.data.historial) && Array.isArray(r.resp.data.documentos) && r.resp.data.pozo) {
        s.historial = r.resp.data.historial;
        s.documentos = r.resp.data.documentos;
        s.pozo = r.resp.data.pozo;
        s.cargado = true;
      } else if (r.resp) {
        s.error = { code: 'ERROR', mensaje: itfLogic_mensajeError('ERROR') };
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      } else {
        s.error = { code: r.code, mensaje: itfLogic_mensajeError(r.code) };
      }
      cambio();
      return snapshot();
    });
  }

  return {
    abrir: function (wellId) { generacion += 1; s = estadoInicial(); s.abierto = true; return cargar(wellId); },
    recargar: function () { return s.abierto && s.wellId !== null ? cargar(s.wellId) : Promise.resolve(snapshot()); },
    cerrar: function () { generacion += 1; token += 1; s = estadoInicial(); cambio(); },
    reset: function () { generacion += 1; token += 1; s = estadoInicial(); cambio(); },
    snapshot: snapshot
  };
}

// --- Aprobar / rechazar / retirar vigente / restaurar (el dialogo de confirmacion con motivo) ---

// deps: obtenerContexto, cargarContexto(sessionToken, wellId) -> Promise<getHistorialItf> (solo si no se conoce el vigente), enviar(tipo, sessionToken, payload) -> Promise<respuesta>, nuevoId(), onCambio(snapshot),
//       alExito({tipo, documentoId, wellId, data}), alObsoleto({tipo, documentoId, wellId, code}) (la propuesta ya no esta pendiente / el documento ya no existe: se vuelve a pedir lo que se veia),
//       alVigenteCambio({tipo, documentoId, wellId}) (el vigente cambio desde que se miro: se vuelve a pedir el contexto; NO se reintenta solo)
var ITF_ACCION_OBSOLETA = ['DOCUMENTO_NO_PROPUESTO', 'DOCUMENTO_NO_RETIRABLE', 'DESTINO_INVALIDO', 'ITF_NOT_FOUND'];

function itfFlujos_crearAccion(deps) {
  var generacion = 0;
  var tokenContexto = 0;
  var enVuelo = null;
  var s = null;

  function textoAviso() {
    if (s.tipo === 'APROBAR') { return s.vigente !== null ? ITF_TEXTO_REEMPLAZA : 'Vas a aprobar esta propuesta como ITF vigente del pozo.'; }
    if (s.tipo === 'RESTAURAR') { return s.vigente !== null ? 'Esta restauración reemplazará el ITF vigente actual.' : 'Este documento volverá a ser el ITF vigente del pozo.'; }
    if (s.tipo === 'RETIRAR') { return ITF_TEXTO_RETIRAR; }
    return 'La propuesta quedará rechazada. El archivo se conserva.';
  }

  function catalogo() {
    return itfLogic_catalogoDe(s.tipo, s.vigente !== null);
  }

  function snapshot() {
    if (s === null) { return null; }
    var cat = s.cargandoContexto ? null : catalogo();
    var ui = ITF_ACCIONES_UI[s.tipo];
    var v = itfLogic_validarMotivo(cat, s.motivoCodigo, s.motivoTexto);
    return {
      tipo: s.tipo,
      titulo: ui.titulo,
      entidad: s.entidad,
      aviso: s.cargandoContexto ? '' : textoAviso(),
      reemplaza: s.vigente !== null && (s.tipo === 'APROBAR' || s.tipo === 'RESTAURAR'),
      catalogo: cat,
      motivoCodigo: s.motivoCodigo,
      motivoTexto: s.motivoTexto,
      pideTexto: cat !== null && s.motivoCodigo === ITF_CODIGO_OTRO,
      textoMin: ITF_MOTIVO_TEXTO_MIN,
      textoMax: ITF_MOTIVO_TEXTO_MAX,
      cargandoContexto: s.cargandoContexto,
      enviando: s.enviando,
      boton: s.enviando ? ui.enviando : ui.boton,
      puedeEnviar: !s.cargandoContexto && !s.enviando && s.errorContexto === null && v.ok,
      error: s.error,
      errorContexto: s.errorContexto
    };
  }
  function cambio() {
    if (deps.onCambio) { deps.onCambio(snapshot()); }
  }

  function puede() {
    return itfLogic_puedeValidar(itfFlujos_contexto(deps).permisos);
  }

  // info = {documentoId, wellId, entidad, vigenteEsperadoDocumentoId (string | null = no hay | undefined = no se conoce: se pide)}
  function pedir(tipo, info) {
    if (!ITF_ACCIONES_UI[tipo] || tipo === 'RETIRAR_PROPUESTA' || s !== null || !puede()) { return false; }
    // aprobar / restaurar necesitan saber cual es el vigente; retirar el vigente desde el Perfil ni siquiera conoce el documento: ambos se piden al abrir (una sola lectura, sin imagenes)
    var conoce = info.documentoId !== undefined && (info.vigenteEsperadoDocumentoId !== undefined || (tipo !== 'APROBAR' && tipo !== 'RESTAURAR'));
    s = {
      tipo: tipo, documentoId: info.documentoId, wellId: info.wellId, entidad: info.entidad || '', vigente: typeof info.vigenteEsperadoDocumentoId === 'string' ? info.vigenteEsperadoDocumentoId : null,
      motivoCodigo: '', motivoTexto: '', cargandoContexto: !conoce, errorContexto: null, enviando: false, error: null, intentoId: deps.nuevoId()
    };
    cambio();
    if (!conoce) { cargarContexto(); }
    return true;
  }

  function cargarContexto() {
    var gen = generacion;
    tokenContexto += 1;
    var mio = tokenContexto;
    var propio = s;
    var ctx = itfFlujos_contexto(deps);
    itfFlujos_llamar(function () { return deps.cargarContexto(ctx.sessionToken, propio.wellId); }).then(function (r) {
      if (mio !== tokenContexto || gen !== generacion || s !== propio) { return; }
      propio.cargandoContexto = false;
      if (r.resp && r.resp.data && r.resp.data.pozo) {
        var id = r.resp.data.pozo.vigenteActualDocumentoId;
        propio.vigente = typeof id === 'string' ? id : null;
        if (propio.documentoId === undefined) {
          // retirar "el ITF vigente": el documento es el que hoy esta vigente
          propio.documentoId = propio.vigente;
          var doc = itfLogic_documentoVigente(r.resp.data.documentos);
          propio.entidad = (doc === null ? 'ITF vigente' : itfLogic_nombreDocumento(doc)) + ' · pozo ' + propio.wellId;
          if (propio.documentoId === null) {
            propio.errorContexto = ITF_TEXTO_SIN_VIGENTE;
          }
        } else if (propio.vigente === propio.documentoId && propio.tipo !== 'RETIRAR' && propio.tipo !== 'RECHAZAR') {
          // aprobar / restaurar EL MISMO documento que ya es el vigente no tiene sentido
          propio.errorContexto = itfLogic_mensajeError('DESTINO_INVALIDO');
        }
      } else if (r.resp) {
        propio.errorContexto = itfLogic_mensajeError('ERROR');
      } else if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return;
      } else {
        propio.errorContexto = itfLogic_mensajeError(r.code);
      }
      cambio();
    });
  }

  function confirmar() {
    if (enVuelo !== null) { return enVuelo; }
    if (s === null || s.cargandoContexto || s.errorContexto !== null) { return Promise.resolve(snapshot()); }
    var ctx = itfFlujos_contexto(deps);
    if (!itfLogic_puedeValidar(ctx.permisos)) {
      s.error = { code: 'PERMISSION_DENIED', mensaje: itfLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    var v = itfLogic_validarMotivo(catalogo(), s.motivoCodigo, s.motivoTexto);
    if (!v.ok) {
      s.error = { code: v.code, mensaje: v.mensaje };
      cambio();
      return Promise.resolve(snapshot());
    }
    var propio = s;
    var gen = generacion;
    var payload = { documentoId: propio.documentoId, clientRequestId: propio.intentoId };
    if (propio.tipo === 'APROBAR' || propio.tipo === 'RESTAURAR') {
      if (propio.vigente !== null) { payload.vigenteEsperadoDocumentoId = propio.vigente; }
    }
    if (v.motivoCodigo !== undefined) { payload.motivoCodigo = v.motivoCodigo; }
    if (v.motivoTexto !== undefined) { payload.motivoTexto = v.motivoTexto; }
    propio.enviando = true;
    propio.error = null;
    cambio();
    var info = { tipo: propio.tipo, documentoId: propio.documentoId, wellId: propio.wellId };
    enVuelo = itfFlujos_llamar(function () { return deps.enviar(propio.tipo, ctx.sessionToken, payload); }).then(function (r) {
      enVuelo = null;
      if (gen !== generacion || s !== propio) { return snapshot(); }
      propio.enviando = false;
      if (r.resp) {
        s = null;
        cambio();
        if (deps.alExito) { deps.alExito(Object.assign({ data: r.resp.data }, info)); }
        return null;
      }
      if (itfLogic_esErrorDeSesion(r.code)) {
        cambio();
        itfFlujos_sesionVencida(deps);
        return snapshot();
      }
      if (r.code === 'VIGENTE_CAMBIO') {
        // NO se reintenta: la persona tiene que ver el vigente nuevo antes de decidir
        s = null;
        cambio();
        if (deps.alVigenteCambio) { deps.alVigenteCambio(info); }
        return null;
      }
      if (ITF_ACCION_OBSOLETA.indexOf(r.code) >= 0) {
        s = null;
        cambio();
        if (deps.alObsoleto) { deps.alObsoleto(Object.assign({ code: r.code }, info)); }
        return null;
      }
      propio.error = { code: r.code, mensaje: itfLogic_mensajeError(r.code) };
      cambio();
      return snapshot();
    });
    return enVuelo;
  }

  return {
    pedir: pedir,
    setMotivo: function (codigo) { if (s !== null && !s.enviando) { s.motivoCodigo = typeof codigo === 'string' ? codigo : ''; s.error = null; cambio(); } },
    setTexto: function (texto) { if (s !== null && !s.enviando) { s.motivoTexto = typeof texto === 'string' ? texto : ''; s.error = null; cambio(); } },
    confirmar: confirmar,
    cancelar: function () { if (s !== null && !s.enviando) { tokenContexto += 1; s = null; cambio(); } },
    abierta: function () { return s !== null; },
    cerrar: function () { generacion += 1; tokenContexto += 1; s = null; enVuelo = null; cambio(); },
    reset: function () { generacion += 1; tokenContexto += 1; s = null; enVuelo = null; cambio(); },
    snapshot: snapshot
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_PAGINA, ITF_ZOOMS, ITF_ACCION_OBSOLETA,
    itfFlujos_llamar, itfFlujos_crearPerfil, itfFlujos_crearProponer, itfFlujos_crearMisPropuestas, itfFlujos_crearCola, itfFlujos_crearVisor, itfFlujos_crearHistorial, itfFlujos_crearAccion
  };
}
