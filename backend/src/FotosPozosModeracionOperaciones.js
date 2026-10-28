// FotosPozosModeracionOperaciones (E8-3): integra el DOMINIO de moderacion (FotosPozosModeracionService.js) y la hoja de eventos (FotosPozoEventosRepository.js) con FotosPozos y el storage.
// No sabe de HTTP ni de permisos de Usuarios (eso es de Api.js): recibe la sesion ya autorizada ({email, nombre, permisos}) y vuelve a comprobar el permiso con el dominio (defensa en profundidad).
// Documento de diseno: docs/fotos-pozos-moderacion.md.
//
// FAIL-CLOSED (decision cerrada de E8-3): una vez activo E8, la hoja FotosPozoEventos es PARTE NECESARIA del contrato. Si no existe, tiene un esquema roto o no se puede leer, NADA vuelve a
// "ignorar la moderacion": estas funciones LANZAN (Api.js responde SERVICE_UNAVAILABLE) y las lecturas de galeria / imagen / resumen tampoco muestran nada. Jamas se muestra como activa una foto cuyo
// estado no se puede derivar. La hoja NO se auto-crea; el rollout la crea y valida ANTES de publicar el codigo que la lee.
//
// ESCRITURAS (orden): validar (dominio) -> permiso -> camino rapido de idempotencia (sin lock) -> LOCK { volver a comprobar la idempotencia -> leer eventos y derivar -> leer la foto -> planificar
// (revalida el estado DENTRO del lock) -> secuencia + append del evento } -> liberar el lock -> RECIEN ENTONCES invalidar el cache (si cambio la visibilidad). Nunca se invalida antes de confirmar el evento.
//
// NO toca el storage ni Drive para moderar (retirar solo cambia la visibilidad logica: el archivo permanece). La unica lectura de storage es la imagen para el moderador.
var FOTOS_MOD_OPS_LIMITE_DEFECTO = 50;
var FOTOS_MOD_OPS_LIMITE_MAX = 100;

function fotosPozosModeracionOps_error(code, message) {
  return { ok: false, code: code, message: message };
}

function fotosPozosModeracionOps_log(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Fotos moderacion: ' + mensaje);
  }
}

// --- Derivacion y visibilidad (lectura) ---

// Lee TODOS los eventos (una llamada) y deriva. LANZA si la hoja no existe / esquema roto / ilegible: no hay fallback.
function fotosPozosModeracionOps_cargarDerivacion() {
  return fotosPozosModeracion_derivar(fotosPozoEventosRepository_leerTodos().eventos);
}

// Fotos (con el shape de FotosPozosRepository) que SI se ven en la galeria normal: baseline + vinculo + estado derivado + integridad (fotosPozosModeracion_visible).
function fotosPozosModeracionOps_filtrarVisibles(fotos, derivacion) {
  return (fotos || []).filter(function (f) { return fotosPozosModeracion_visible(f, derivacion); });
}

// Galeria normal (E8-5): las mismas fotos visibles que filtrarVisibles, cada una como COPIA con `tieneSolicitudRetiro` (true solo si el historial derivable de la foto tiene una solicitud ABIERTA). Es
// un booleano derivado de los eventos reales, calculado en la misma pasada y con la misma derivacion (una sola lectura de la hoja): nada de datos de la solicitud sale de aca. Una solicitud rechazada,
// aprobada o inexistente da false (la aprobada ademas retira la foto: no llega a la galeria).
function fotosPozosModeracionOps_visiblesConSolicitud(fotos, derivacion) {
  var salida = [];
  (fotos || []).forEach(function (f) {
    var dto = fotosPozosModeracion_estadoFoto(f, derivacion);
    if (dto.visible === true) {
      salida.push(Object.assign({}, f, { tieneSolicitudRetiro: dto.solicitudAbierta !== null && typeof dto.solicitudAbierta === 'object' }));
    }
  });
  return salida;
}

// ¿La foto sigue permitida segun los EVENTOS solos? (no necesita la fila de FotosPozos): false si fue retirada por eventos o si su historial no se puede derivar. Es la comprobacion barata que se hace
// SIEMPRE antes de servir una imagen, aun con el cache de ids / miniatura lleno: un cache viejo nunca es un bypass de un retiro.
function fotosPozosModeracionOps_permitidaPorEventos(fotoId, derivacion) {
  var id = fotosPozosModeracion_idNormalizado(fotoId);
  if (id === '' || !derivacion || typeof derivacion.porFoto !== 'object' || derivacion.porFoto === null) {
    return false;
  }
  if (!Object.prototype.hasOwnProperty.call(derivacion.porFoto, id)) {
    return true;
  }
  var ev = derivacion.porFoto[id];
  return ev.integridad === FOTOS_MOD_INTEGRIDAD.OK && ev.estado === FOTOS_MOD_ESTADOS_FOTO.ACTIVA;
}

// Cache: tira exactamente las claves de la foto (metadata, miniatura) y el resumen. Si CacheService falla se loguea y se sigue (el retiro ya esta escrito; la lectura de imagen igual
// comprueba los eventos antes de servir, asi que un cache que no cayo no es un bypass).
function fotosPozosModeracionOps_invalidarCache(fotoId) {
  var claves = fotosPozosModeracion_clavesCacheAInvalidar(fotoId);
  try {
    var cache = CacheService.getScriptCache();
    claves.forEach(function (k) { cache.remove(k); });
  } catch (err) {
    fotosPozosModeracionOps_log('no se pudo invalidar el cache: ' + String(err && err.message ? err.message : err).substring(0, 200));
  }
  return claves;
}

function fotosPozosModeracionOps_indicePorFotoId(fotos) {
  var indice = {};
  (fotos || []).forEach(function (f) {
    var id = String(f.fotoId).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(indice, id)) {
      indice[id] = f;
    }
  });
  return indice;
}

// --- Escrituras ---

// datos: {accion, fotoId, solicitudId, resolucion, motivoCodigo, motivoTexto, clientRequestId} (el cliente NUNCA manda entidad, estado, email, nombre ni la foto de una resolucion).
// sesion: {email, nombre, permisos:{fotos, fotos_carga, fotos_moderar}} (de la SESION + hoja Usuarios).
// Devuelve {ok:true, duplicada, evento:{eventoId, evento, fotoId, solicitudId, resolucion}, entidad:{tipo, id}|null, cacheInvalidado:[claves]} | {ok:false, code, message}. LANZA si la hoja de eventos / FotosPozos no se puede
// leer o escribir, o si no se consigue el lock (Api.js lo traduce a SERVICE_UNAVAILABLE; en ese caso NO se escribio nada).
function fotosPozosModeracionOps_ejecutar(datos, sesion) {
  var s = sesion || {};
  var validacion = fotosPozosModeracion_validarComando(datos);
  if (!validacion.ok) {
    return validacion;
  }
  var valores = validacion.valores;
  if (!fotosPozosModeracion_puede(valores.accion, s.permisos)) {
    return fotosPozosModeracionOps_error('PERMISSION_DENIED', 'permiso insuficiente');
  }
  var email = fotosPozosModeracion_normalizarEmail(s.email);

  // camino rapido (sin lock): un reintento exacto se reconoce sin leer nada mas ni tomar el lock
  var rapidas = fotosPozoEventosRepository_buscarPorClientRequestId(email, valores.clientRequestId);
  if (rapidas.total > 0) {
    return fotosPozosModeracionOps_resultado(fotosPozosModeracion_atenderExistente(rapidas, valores), null);
  }

  var plan = fotosPozoEventosRepository_conLock(function () {
    var existentes = fotosPozoEventosRepository_buscarPorClientRequestId(email, valores.clientRequestId);
    var derivacion = fotosPozosModeracionOps_cargarDerivacion();
    var fotos = null;
    var resultado = fotosPozosModeracion_planificar(datos, {
      email: email,
      nombre: s.nombre,
      permisos: s.permisos,
      ahora: new Date(),
      derivacion: derivacion,
      obtenerBase: function (id) {
        if (fotos === null) {
          fotos = fotosPozosModeracionOps_indicePorFotoId(fotosPozosRepository_leerTodasLasFotos());
        }
        var f = fotos[String(id).toLowerCase()];
        return f === undefined ? null : f;
      },
      existentes: existentes,
      nuevoEventoId: function () { return Utilities.getUuid(); }
    });
    if (resultado.ok && resultado.accion === 'ESCRIBIR') {
      resultado.escrito = fotosPozoEventosRepository_escribirEvento(resultado.evento);
    }
    return resultado;
  });
  // fuera del lock y SOLO si el evento quedo escrito
  var invalidado = [];
  if (plan.ok && plan.accion === 'ESCRIBIR' && plan.invalidaCache === true) {
    invalidado = fotosPozosModeracionOps_invalidarCache(plan.evento.fotoId);
  }
  return fotosPozosModeracionOps_resultado(plan, invalidado);
}

// Plan -> respuesta del servicio. Sin email, sin secuencia, sin clientRequestId, sin motivoTexto.
function fotosPozosModeracionOps_resultado(plan, invalidado) {
  if (!plan.ok) {
    return plan;
  }
  var e = plan.evento;
  return {
    ok: true,
    duplicada: plan.accion === 'REINTENTO',
    evento: { eventoId: e.eventoId, evento: e.evento, fotoId: e.fotoId, solicitudId: e.solicitudId, resolucion: e.resolucion },
    entidad: plan.accion === 'ESCRIBIR' ? { tipo: e.entidadTipo, id: e.entidadId } : null,
    cacheInvalidado: invalidado || []
  };
}

// --- Lecturas de moderador ---

function fotosPozosModeracionOps_vistaEvento(e) {
  var tipo = FOTOS_MOD_EVENTOS.indexOf(e.evento) >= 0 ? e.evento : 'DESCONOCIDO';
  return {
    evento: tipo,
    solicitudId: tipo === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO ? e.eventoId : (tipo === FOTOS_MOD_EVENTO.RETIRO_RESUELTO ? e.solicitudId : ''),
    resolucion: tipo === FOTOS_MOD_EVENTO.RETIRO_RESUELTO ? e.resolucion : '',
    motivoCodigo: FOTOS_MOD_MOTIVOS.indexOf(e.motivoCodigo) >= 0 ? e.motivoCodigo : '',
    motivoTexto: (tipo === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO || tipo === FOTOS_MOD_EVENTO.RETIRADA) ? e.motivoTexto : '',
    nombre: fotosPozosModeracion_nombreVisible(e.nombre),
    timestampUtc: fotosPozosModeracion_fechaIso(e.timestampUtc)
  };
}

function fotosPozosModeracionOps_vistaEstado(dto) {
  return {
    estado: dto.estado,
    visible: dto.visible,
    solicitudAbierta: dto.solicitudAbierta,
    puedeReponerse: dto.puedeReponerse,
    requiereRevisionBorrado: dto.requiereRevisionBorrado,
    integridad: dto.integridad,
    origenRetiro: dto.origenRetiro,
    inconsistencias: dto.inconsistencias
  };
}

function fotosPozosModeracionOps_vistaFoto(f) {
  var entidad = fotosPozosModeracion_entidadDeBase(f);
  return {
    fotoId: String(f.fotoId).toLowerCase(),
    entidadTipo: entidad === null ? null : entidad.tipo,
    entidadId: entidad === null ? null : entidad.id,
    tipoFoto: f.tipoFoto,
    fuente: f.fuente,
    fechaFotoValor: f.fechaFotoValor,
    fechaFotoPrecision: f.fechaFotoPrecision
  };
}

// Historial de UNA foto para el moderador: estado derivado + eventos, el mas reciente primero (secuencia descendente). Lista blanca: sin email, clientRequestId ni secuencia. {ok:true, foto, estado, eventos} | {ok:false, ...}.
function fotosPozosModeracionOps_historial(fotoId) {
  var id = fotosPozosModeracion_idNormalizado(fotoId);
  if (id === '') {
    return fotosPozosModeracionOps_error('INVALID_FOTO_ID', 'fotoId invalido');
  }
  var todos = fotosPozoEventosRepository_leerTodos().eventos;
  var derivacion = fotosPozosModeracion_derivar(todos);
  var foto = fotosPozosRepository_buscarPorFotoId(id);
  if (foto === null) {
    return fotosPozosModeracionOps_error('FOTO_NOT_FOUND', 'no existe la foto');
  }
  var solicitudesDeLaFoto = {};
  todos.forEach(function (e) {
    if (e.fotoId === id && e.evento === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO && e.eventoId !== '') {
      solicitudesDeLaFoto[e.eventoId] = true;
    }
  });
  var relevantes = todos.filter(function (e) {
    return e.fotoId === id || (e.solicitudId !== '' && solicitudesDeLaFoto[e.solicitudId] === true);
  }).sort(function (a, b) {
    var sa = typeof a.secuencia === 'number' ? a.secuencia : Infinity;
    var sb = typeof b.secuencia === 'number' ? b.secuencia : Infinity;
    // MAS RECIENTE PRIMERO (secuencia descendente; los no numericos, que no son derivables, al final por fila)
    if (sa === Infinity && sb === Infinity) {
      return a.fila - b.fila;
    }
    return sa !== sb ? (sa > sb ? -1 : 1) : a.fila - b.fila;
  });
  return {
    ok: true,
    foto: fotosPozosModeracionOps_vistaFoto(foto),
    estado: fotosPozosModeracionOps_vistaEstado(fotosPozosModeracion_estadoFoto(foto, derivacion)),
    eventos: relevantes.map(fotosPozosModeracionOps_vistaEvento)
  };
}

// limit (entero 1..100, defecto 50) y cursor (entero >= 1 o vacio). {ok:true, limit, cursor} | {ok:false, ...}
function fotosPozosModeracionOps_parametrosCola(limit, cursor) {
  var l = FOTOS_MOD_OPS_LIMITE_DEFECTO;
  if (limit !== undefined && limit !== null && limit !== '') {
    if (typeof limit !== 'number' || !isFinite(limit) || Math.floor(limit) !== limit || limit < 1 || limit > FOTOS_MOD_OPS_LIMITE_MAX) {
      return fotosPozosModeracionOps_error('INVALID_LIMIT', 'limit debe ser un entero entre 1 y ' + FOTOS_MOD_OPS_LIMITE_MAX);
    }
    l = limit;
  }
  var c = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'number' || !isFinite(cursor) || Math.floor(cursor) !== cursor || cursor < 1) {
      return fotosPozosModeracionOps_error('INVALID_CURSOR', 'cursor invalido');
    }
    c = cursor;
  }
  return { ok: true, limit: l, cursor: c };
}

// Cola de solicitudes de retiro ABIERTAS (de fotos derivables), mas reciente primero (secuencia descendente: unica y determinista). UNA lectura de la hoja de eventos y UNA de FotosPozos (metadata basica
// por fotoId en memoria; nada de N+1), sin imagenes ni ids de Drive. Paginada por cursor (la secuencia del ultimo item): el volumen esperado son decenas, pero el contrato ya soporta mas.
// {ok:true, total, items:[...], hayMas, cursor} | {ok:false, ...}. items: {solicitudId, fotoId, entidadTipo, entidadId, motivoCodigo, motivoTexto, nombre, timestampUtc, foto:{tipoFoto, fuente, fechaFotoValor, fechaFotoPrecision}|null}.
function fotosPozosModeracionOps_cola(limit, cursor) {
  var p = fotosPozosModeracionOps_parametrosCola(limit, cursor);
  if (!p.ok) {
    return p;
  }
  var derivacion = fotosPozosModeracionOps_cargarDerivacion();
  var abiertas = derivacion.solicitudes.filter(function (it) { return it.solicitud.estado === FOTOS_MOD_ESTADOS_SOLICITUD.ABIERTA; })
    .sort(function (a, b) { return b.solicitud.ev.secuencia - a.solicitud.ev.secuencia; });
  var candidatas = abiertas.filter(function (it) { return p.cursor === null || it.solicitud.ev.secuencia < p.cursor; });
  var pagina = candidatas.slice(0, p.limit);
  var hayMas = candidatas.length > pagina.length;
  var fotos = pagina.length === 0 ? {} : fotosPozosModeracionOps_indicePorFotoId(fotosPozosRepository_leerTodasLasFotos());
  var items = pagina.map(function (it) {
    var v = fotosPozosModeracion_vistaSolicitud(it);
    var f = fotos[it.fotoId];
    return {
      solicitudId: v.solicitudId,
      fotoId: v.fotoId,
      entidadTipo: v.entidadTipo,
      entidadId: v.entidadId,
      motivoCodigo: v.motivoCodigo,
      motivoTexto: v.motivoTexto,
      nombre: v.solicitadaPor,
      timestampUtc: v.solicitadaEn,
      foto: f === undefined ? null : { tipoFoto: f.tipoFoto, fuente: f.fuente, fechaFotoValor: f.fechaFotoValor, fechaFotoPrecision: f.fechaFotoPrecision }
    };
  });
  return {
    ok: true,
    total: abiertas.length,
    items: items,
    hayMas: hayMas,
    cursor: hayMas ? pagina[pagina.length - 1].solicitud.ev.secuencia : null
  };
}

// Listado institucional de fotos RETIRADAS POR EVENTOS que se pueden reponer (E8-5), la mas recientemente retirada primero (secuencia del evento que la retiro: unica y determinista, cursor estable).
// Entran SOLO las que cumplen todo: historial derivable (integridad OK), estado derivado RETIRADA con origen EVENTO (puedeReponerse), baseline ACTIVA y vinculo CONFIRMADO (reponerla la hace volver
// a la galeria) y entidad coincidente. NO entran: OCULTA legacy (ningun evento la revive), no derivables, ni fotos sin fila en FotosPozos. UNA lectura de eventos y UNA de FotosPozos (si hay
// candidatas), sin imagenes, sin ids de Drive, sin email / clientRequestId / secuencia.
// {ok:true, total, items, hayMas, cursor} | {ok:false, ...}. items: {fotoId, entidadTipo, entidadId, origenRetiro, motivoCodigo, motivoTexto, nombre, timestampUtc, viaSolicitud, requiereRevisionBorrado,
// foto:{tipoFoto, fuente, fechaFotoValor, fechaFotoPrecision}}. nombre = quien retiro (RETIRADA) o quien aprobo (RETIRO_RESUELTO + APROBADO); motivo y detalle son los de la retirada / de la solicitud aprobada.
function fotosPozosModeracionOps_retiradas(limit, cursor) {
  var p = fotosPozosModeracionOps_parametrosCola(limit, cursor);
  if (!p.ok) {
    return p;
  }
  var derivacion = fotosPozosModeracionOps_cargarDerivacion();
  var candidatas = Object.keys(derivacion.porFoto).filter(function (id) {
    var ev = derivacion.porFoto[id];
    return ev.integridad === FOTOS_MOD_INTEGRIDAD.OK && ev.estado === FOTOS_MOD_ESTADOS_FOTO.RETIRADA && ev.origen === FOTOS_MOD_ORIGEN_RETIRO.EVENTO && !!ev.retiro;
  });
  var fotos = candidatas.length === 0 ? {} : fotosPozosModeracionOps_indicePorFotoId(fotosPozosRepository_leerTodasLasFotos());
  var elegibles = [];
  candidatas.forEach(function (id) {
    var base = fotos[id];
    if (base === undefined) {
      return;
    }
    var dto = fotosPozosModeracion_estadoFoto(base, derivacion);
    if (dto.integridad !== FOTOS_MOD_INTEGRIDAD.OK || dto.estado !== FOTOS_MOD_ESTADOS_FOTO.RETIRADA || dto.puedeReponerse !== true || fotosPozosModeracion_texto(base.estadoVinculo) !== 'CONFIRMADO') {
      return;
    }
    elegibles.push({ id: id, base: base, dto: dto, retiro: derivacion.porFoto[id].retiro });
  });
  elegibles.sort(function (a, b) { return b.retiro.ev.secuencia - a.retiro.ev.secuencia; });
  var restantes = elegibles.filter(function (it) { return p.cursor === null || it.retiro.ev.secuencia < p.cursor; });
  var pagina = restantes.slice(0, p.limit);
  var hayMas = restantes.length > pagina.length;
  var items = pagina.map(function (it) {
    var vista = fotosPozosModeracionOps_vistaFoto(it.base);
    var origen = it.retiro.solicitud === null ? it.retiro.ev : it.retiro.solicitud;     // el motivo es el de la retirada, o el de la solicitud que se aprobo
    return {
      fotoId: vista.fotoId,
      entidadTipo: vista.entidadTipo,
      entidadId: vista.entidadId,
      origenRetiro: it.dto.origenRetiro,
      motivoCodigo: origen.motivoCodigo,
      motivoTexto: origen.motivoTexto,
      nombre: fotosPozosModeracion_nombreVisible(it.retiro.ev.nombre),
      timestampUtc: it.retiro.ev.timestamp,
      viaSolicitud: it.retiro.solicitud !== null,
      requiereRevisionBorrado: it.dto.requiereRevisionBorrado === true,
      foto: { tipoFoto: vista.tipoFoto, fuente: vista.fuente, fechaFotoValor: vista.fechaFotoValor, fechaFotoPrecision: vista.fechaFotoPrecision }
    };
  });
  return {
    ok: true,
    total: elegibles.length,
    items: items,
    hayMas: hayMas,
    cursor: hayMas ? pagina[pagina.length - 1].retiro.ev.secuencia : null
  };
}

// Imagen (miniatura o completa) de una foto para el MODERADOR, activa o retirada. El endpoint normal (getFotoPozo) sigue respetando la visibilidad: este es el UNICO camino a una foto no visible y lo
// autoriza Api.js con fotos + fotos_moderar. No usa ni llena el cache de la galeria. Sin metadata de storage en la respuesta.
function fotosPozosModeracionOps_imagen(fotoId, variante) {
  var id = fotosPozosModeracion_idNormalizado(fotoId);
  if (id === '') {
    return fotosPozosModeracionOps_error('INVALID_FOTO_ID', 'fotoId invalido');
  }
  if (variante !== 'thumb' && variante !== 'full') {
    return fotosPozosModeracionOps_error('INVALID_VARIANTE', 'variante invalida');
  }
  var foto = fotosPozosRepository_buscarPorFotoId(id);
  if (foto === null) {
    return fotosPozosModeracionOps_error('FOTO_NOT_FOUND', 'no existe la foto');
  }
  var r;
  try {
    r = fotosStorageClient_obtenerPozo(foto.driveFileId, foto.driveThumbId, variante);
  } catch (err) {
    fotosPozosModeracionOps_log('storage no disponible: ' + String(err && err.message ? err.message : err).substring(0, 200));
    return fotosPozosModeracionOps_error('STORAGE_UNAVAILABLE', 'no se pudo leer la foto');
  }
  return { ok: true, imagen: { fotoId: id, variante: variante, mimeType: r.mimeType, imagenBase64: r.imagenBase64 } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_MOD_OPS_LIMITE_DEFECTO,
    FOTOS_MOD_OPS_LIMITE_MAX,
    fotosPozosModeracionOps_cargarDerivacion,
    fotosPozosModeracionOps_filtrarVisibles,
    fotosPozosModeracionOps_visiblesConSolicitud,
    fotosPozosModeracionOps_permitidaPorEventos,
    fotosPozosModeracionOps_invalidarCache,
    fotosPozosModeracionOps_indicePorFotoId,
    fotosPozosModeracionOps_ejecutar,
    fotosPozosModeracionOps_resultado,
    fotosPozosModeracionOps_vistaEvento,
    fotosPozosModeracionOps_historial,
    fotosPozosModeracionOps_parametrosCola,
    fotosPozosModeracionOps_cola,
    fotosPozosModeracionOps_retiradas,
    fotosPozosModeracionOps_imagen
  };
}
