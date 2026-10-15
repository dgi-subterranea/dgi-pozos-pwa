// SUGERENCIAS de decisiones sobre las FUENTES REGISTRALES de ubicacion (Etapa C de docs/ubicacion-fuente-decisiones.md). Un usuario SIN autoridad (ubicacion=SI, sin
// ubicacion_validar) pide aceptar / descartar / restaurar una fuente; un validador la APRUEBA o la RECHAZA; el autor puede CANCELARLA mientras siga pendiente.
//
// SEPARACION ESTRICTA: una sugerencia NO es una decision. Vive en su propia hoja (UbicacionFuenteSugerencias, ver el Repository) y por si sola NO cambia el estado de ninguna
// fuente, ni el punto operativo, ni los mapas. Solo la APROBACION produce una decision real, y la produce con el MISMO nucleo autoritativo que decidirFuenteUbicacion
// (ubicacionFuenteDecisionesService_aplicarDecision): misma validacion de transicion contra el estado ACTUAL, misma secuencia, misma fila, mismo lock. Aca no hay logica de
// decision duplicada. La identidad de la fuente es la MISMA (wellId + tipo + x + y a 3 decimales, ufd_claveFuente).
//
// Estados (derivados del log, nunca guardados): PENDIENTE -> APROBADA | RECHAZADA | CANCELADA | OBSOLETA (terminales). Ademas:
//   - "no aplicable" (calculado al LEER, sin escribir): la fuente ya no existe en el padron (reindexado: JAMAS se transfiere a una fuente nueva) o la accion ya no corresponde
//     al estado actual. Sigue PENDIENTE hasta que un validador la resuelva (si intenta aprobarla se escribe OBSOLETA) o el autor la cancele.
//   - autocuracion: una PENDIENTE cuya decision 'sug-<sugerenciaId>' ya existe (corte entre las dos escrituras de una aprobacion) se lee como APROBADA y el reintento solo
//     escribe el evento que faltaba.
//
// Aprobar (todo en UN lock de script, el mismo de las decisiones): relee sugerencias, padron y decisiones -> revalida contra el estado ACTUAL (NO se confia en la
// versionVista de quien sugirio: el validador aprueba una intencion, no una transaccion congelada; se compara SU versionVista contra la actual, como en las decisiones) ->
// escribe PRIMERO la decision (clientRequestId determinista 'sug-<id>') y DESPUES el evento APROBADA.
//   Si la fuente ya no existe, o la accion ya esta cumplida / ya no corresponde (SOURCE_NOT_FOUND, ALREADY_IN_STATE, INVALID_TRANSITION): no se aplica nada y se escribe OBSOLETA
//   (el validador recibe un resultado amistoso). Si cambio la version del pozo (STALE_STATE): no se escribe nada y el validador revisa de nuevo.
//
// Errores estables (code): INVALID_WELL_ID, WELL_NOT_FOUND, INVALID_ACCION, INVALID_RESOLUCION, INVALID_SUGERENCIA_ID, INVALID_CLIENT_REQUEST_ID, INVALID_FUENTE, INVALID_VERSION,
// INVALID_MOTIVO, SOURCE_NOT_FOUND, STALE_STATE (+versionActual), INCONSISTENT_STATE, INVALID_TRANSITION, ALREADY_IN_STATE, IDEMPOTENCY_CONFLICT, ALREADY_PENDING (+sugerencia),
// PENDING_LIMIT_REACHED, SUGGESTION_NOT_FOUND, ALREADY_RESOLVED. Nunca se devuelve el texto de un error interno: el detalle va a Logger.

var UFS_ACCIONES_SUGERIBLES = { ACEPTAR: 'ACEPTAR', DESCARTAR: 'DESCARTAR', RESTAURAR: 'RESTAURAR' };      // QUITAR_ACEPTACION NO se puede sugerir
var UFS_EVENTOS = { PROPUESTA: 'PROPUESTA', APROBADA: 'APROBADA', RECHAZADA: 'RECHAZADA', CANCELADA: 'CANCELADA', OBSOLETA: 'OBSOLETA' };
var UFS_ESTADOS = { PENDIENTE: 'PENDIENTE', APROBADA: 'APROBADA', RECHAZADA: 'RECHAZADA', CANCELADA: 'CANCELADA', OBSOLETA: 'OBSOLETA' };
var UFS_RESOLUCIONES = { APROBAR: 'APROBAR', RECHAZAR: 'RECHAZAR' };
var UFS_AUDITORIA = {
  PROPUESTA: 'FUENTE_SUGERIDA', APROBADA: 'FUENTE_SUGERENCIA_APROBADA', RECHAZADA: 'FUENTE_SUGERENCIA_RECHAZADA', CANCELADA: 'FUENTE_SUGERENCIA_CANCELADA',
  OBSOLETA: 'FUENTE_SUGERENCIA_OBSOLETA'
};
var UFS_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
var UFS_LIMITE_PENDIENTES = 10;           // por usuario: solo PENDIENTES que sigan APLICABLES hoy (no cuentan aprobadas, rechazadas, canceladas, obsoletas ni las que dejaron de ser aplicables)
var UFS_COLA_MAX = 200;                   // items que devuelve la cola (el total real se informa aparte)
var UFS_POZO_MAX = 50;                    // items que devuelve la vista de un pozo
// Cache de lectura (misma tecnica que las decisiones: TTL, marca de invalidacion contra la carrera lector/escritor, tope de tamano, nunca indispensable). NUNCA se usa para escribir.
var UFS_CACHE_PREFIJO_POZO = 'ufs_v1_pozo_';
var UFS_CACHE_COLA = 'ufs_v1_cola';
var UFS_CACHE_INVAL_KEY = 'ufs_v1_inval';
var UFS_CACHE_SEGUNDOS = 120;
var UFS_CACHE_INVAL_SEGUNDOS = 180;
var UFS_CACHE_MAX_CARACTERES = 90000;
var UFS_CACHE_MARGEN_CARRERA_MS = 2000;
var UFS_MENSAJES = {
  INVALID_WELL_ID: 'wellId invalido',
  WELL_NOT_FOUND: 'no se encontro el pozo en el padron',
  INVALID_ACCION: 'accion invalida (ACEPTAR, DESCARTAR o RESTAURAR)',
  INVALID_RESOLUCION: 'resolucion invalida (APROBAR o RECHAZAR)',
  INVALID_SUGERENCIA_ID: 'sugerenciaId invalido',
  INVALID_CLIENT_REQUEST_ID: 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)',
  INVALID_FUENTE: 'la fuente indicada no es valida (fuenteTipo, x e y)',
  INVALID_VERSION: 'versionVista debe ser un entero mayor o igual a 0',
  IDEMPOTENCY_CONFLICT: 'clientRequestId ya usado con otro contenido',
  ALREADY_PENDING: 'ya enviaste esta sugerencia y esta pendiente de revision',
  PENDING_LIMIT_REACHED: 'tenes demasiadas sugerencias pendientes: espera a que se revisen o cancela alguna',
  SUGGESTION_NOT_FOUND: 'no se encontro la sugerencia',
  ALREADY_RESOLVED: 'la sugerencia ya fue resuelta',
  SERVICE_UNAVAILABLE: 'servicio no disponible'
};

function ubicacionFuenteSugerenciasService_error(code, message, extra) {
  var e = { ok: false, code: code, message: message || UFS_MENSAJES[code] || code };
  if (extra) {
    Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  }
  return e;
}

function ubicacionFuenteSugerenciasService_log(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Sugerencias de fuentes: ' + mensaje);
  }
}

// ======================================================================================================================
// DOMINIO PURO: validacion de eventos y estado derivado (sin Sheets, sin cache, sin reloj)
// ======================================================================================================================

function ufs_enteroSeguro(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 9007199254740990;
}

// Codigo del primer problema de una fila-evento, o null si esta bien formada. Una fila a medias NUNCA se descarta en silencio: marca inconsistente a SU sugerencia.
function ufs_problemaDeEvento(ev) {
  var e = ev && typeof ev === 'object' ? ev : null;
  if (e === null) { return 'EVENTO_INVALIDO'; }
  if (!ufs_enteroSeguro(e.secuencia)) { return 'SECUENCIA_INVALIDA'; }
  if (typeof e.sugerenciaId !== 'string' || !UFS_ID_REGEX.test(e.sugerenciaId)) { return 'ID_INVALIDO'; }
  if (typeof e.evento !== 'string' || !Object.prototype.hasOwnProperty.call(UFS_EVENTOS, e.evento)) { return 'EVENTO_DESCONOCIDO'; }
  if (!ufd_wellIdValido(e.wellId)) { return 'POZO_INVALIDO'; }
  if (typeof e.fuenteTipo !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, e.fuenteTipo) || ufd_claveFuente(e.wellId, e.fuenteTipo, e.x, e.y) === null) { return 'FUENTE_INVALIDA'; }
  if (typeof e.accionSugerida !== 'string' || !Object.prototype.hasOwnProperty.call(UFS_ACCIONES_SUGERIBLES, e.accionSugerida)) { return 'ACCION_INVALIDA'; }
  if (typeof e.email !== 'string' || e.email === '') { return 'SIN_EMAIL'; }
  if (typeof e.timestampUtc !== 'string' || isNaN(Date.parse(e.timestampUtc))) { return 'FECHA_INVALIDA'; }
  if (e.evento === UFS_EVENTOS.PROPUESTA && (typeof e.versionVista !== 'number' || !isFinite(e.versionVista) || Math.floor(e.versionVista) !== e.versionVista || e.versionVista < 0)) { return 'VERSION_INVALIDA'; }
  if (e.evento !== UFS_EVENTOS.PROPUESTA && e.versionVista !== null && e.versionVista !== undefined && (typeof e.versionVista !== 'number' || !isFinite(e.versionVista) || e.versionVista < 0)) { return 'VERSION_INVALIDA'; }
  if (e.evento === UFS_EVENTOS.PROPUESTA && e.accionSugerida === 'DESCARTAR' && (typeof e.motivo !== 'string' || e.motivo === '')) { return 'MOTIVO_REQUERIDO'; }
  if (e.evento === UFS_EVENTOS.RECHAZADA && (typeof e.motivo !== 'string' || e.motivo === '')) { return 'MOTIVO_REQUERIDO'; }
  return null;
}

function ufs_claveDeEvento(ev) {
  return ufd_claveFuente(ev.wellId, ev.fuenteTipo, ev.x, ev.y);
}

// clientRequestId (determinista) con que una APROBACION escribe su decision en UbicacionFuenteDecisiones.
function ufs_idDecisionDeSugerencia(sugerenciaId) {
  return UFD_SVC_PREFIJO_ID_SUGERENCIA + sugerenciaId;
}

// La decision que creo la aprobacion de esta sugerencia: {fila, coincide} o null. `coincide` = es del mismo pozo, misma fuente y el evento que corresponde a la accion.
function ufs_decisionDeSugerencia(filasDecisiones, propuesta) {
  var id = ufs_idDecisionDeSugerencia(propuesta.sugerenciaId);
  var lista = Array.isArray(filasDecisiones) ? filasDecisiones : [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i] && lista[i].clientRequestId === id) {
      var d = lista[i];
      var coincide = d.wellId === propuesta.wellId && ufd_claveFuente(d.wellId, d.fuenteTipo, d.x, d.y) === ufs_claveDeEvento(propuesta) &&
        d.evento === UFD_DECISION_A_EVENTO[UFD_SVC_ACCIONES[propuesta.accionSugerida]];
      return { fila: d, coincide: coincide };
    }
  }
  return null;
}

// filasSug: TODAS las filas de UbicacionFuenteSugerencias (crudas); filasDec: TODAS las de UbicacionFuenteDecisiones (para la autocuracion; puede ser []).
// Devuelve {sugerencias: [...ordenadas por la secuencia de su PROPUESTA], anomaliasGlobales: [...]}. Cada sugerencia:
//   {sugerenciaId, propuesta, resolucion|null, estado ('PENDIENTE'|...|null si es inconsistente), anomalias: [codigos], curada: bool}
function ufs_derivar(filasSug, filasDec) {
  var filas = Array.isArray(filasSug) ? filasSug : [];
  var vecesSecuencia = {};
  filas.forEach(function (f) {
    if (f && ufs_enteroSeguro(f.secuencia)) { vecesSecuencia[f.secuencia] = (vecesSecuencia[f.secuencia] || 0) + 1; }
  });
  var grupos = {};
  var orden = [];
  var globales = [];
  filas.forEach(function (f) {
    var id = f && typeof f.sugerenciaId === 'string' && UFS_ID_REGEX.test(f.sugerenciaId) ? f.sugerenciaId : null;
    if (id === null) {
      globales.push({ codigo: 'ID_INVALIDO', secuencia: f ? f.secuencia : null });
      return;
    }
    if (!grupos[id]) { grupos[id] = []; orden.push(id); }
    grupos[id].push(f);
  });
  var sugerencias = orden.map(function (id) {
    var eventos = grupos[id].slice().sort(function (a, b) {
      var sa = ufs_enteroSeguro(a.secuencia) ? a.secuencia : Infinity;
      var sb = ufs_enteroSeguro(b.secuencia) ? b.secuencia : Infinity;
      return sa - sb;
    });
    var anomalias = [];
    eventos.forEach(function (e) {
      var p = ufs_problemaDeEvento(e);
      if (p) { anomalias.push(p); }
      if (ufs_enteroSeguro(e.secuencia) && vecesSecuencia[e.secuencia] > 1) { anomalias.push('SECUENCIA_REPETIDA'); }
    });
    var propuestas = eventos.filter(function (e) { return e.evento === UFS_EVENTOS.PROPUESTA; });
    var resoluciones = eventos.filter(function (e) { return e.evento !== UFS_EVENTOS.PROPUESTA; });
    if (propuestas.length === 0) { anomalias.push('SIN_PROPUESTA'); }
    if (propuestas.length > 1) { anomalias.push('PROPUESTA_REPETIDA'); }
    if (resoluciones.length > 1) { anomalias.push('RESOLUCION_REPETIDA'); }
    var propuesta = propuestas[0] || null;
    var resolucion = resoluciones[0] || null;
    if (propuesta && eventos[0] !== propuesta) { anomalias.push('EVENTO_ANTES_DE_LA_PROPUESTA'); }
    if (propuesta && resolucion && (ufs_problemaDeEvento(propuesta) === null) && (ufs_problemaDeEvento(resolucion) === null) &&
        (ufs_claveDeEvento(propuesta) !== ufs_claveDeEvento(resolucion) || propuesta.accionSugerida !== resolucion.accionSugerida)) {
      anomalias.push('NO_COINCIDE_CON_LA_PROPUESTA');
    }
    var unicas = anomalias.filter(function (c, i) { return anomalias.indexOf(c) === i; });
    var estado = null;
    var curada = false;
    if (unicas.length === 0) {
      estado = resolucion ? UFS_ESTADOS[resolucion.evento] : UFS_ESTADOS.PENDIENTE;
      if (estado === UFS_ESTADOS.PENDIENTE) {
        var dec = ufs_decisionDeSugerencia(filasDec, propuesta);
        if (dec && dec.coincide) {
          estado = UFS_ESTADOS.APROBADA;           // la decision ya esta escrita: solo falta el evento (corte entre las dos escrituras)
          curada = true;
        } else if (dec && !dec.coincide) {
          unicas.push('DECISION_NO_COINCIDE');
          estado = null;
        }
      }
    }
    return { sugerenciaId: id, propuesta: propuesta, resolucion: resolucion, estado: unicas.length === 0 ? estado : null, anomalias: unicas, curada: curada };
  });
  sugerencias.sort(function (a, b) {
    var sa = a.propuesta && ufs_enteroSeguro(a.propuesta.secuencia) ? a.propuesta.secuencia : Infinity;
    var sb = b.propuesta && ufs_enteroSeguro(b.propuesta.secuencia) ? b.propuesta.secuencia : Infinity;
    return sa - sb;
  });
  return { sugerencias: sugerencias, anomaliasGlobales: globales };
}

// "Irrigacion (2)" / "Reporte Pozos": solo para mostrar (la identidad es la clave, no la etiqueta). `fuentes`: las del estado derivado del pozo.
function ufs_etiquetaFuente(fuentes, tipo, x, y, wellId) {
  var lista = Array.isArray(fuentes) ? fuentes : [];
  if (tipo === 'REPORTE_POZOS') { return 'Reporte Pozos'; }
  var irr = lista.filter(function (f) { return f.tipo === 'IRRIGACION'; });
  var clave = ufd_claveFuente(wellId, tipo, x, y);
  var f = lista.filter(function (g) { return g.clave === clave; })[0];
  return 'Irrigación' + (irr.length > 1 && f ? ' (' + f.posicion + ')' : '');
}

// Evalua si una sugerencia PENDIENTE se podria aprobar HOY (sin escribir). calculo: {estado} del pozo o null si el padron no lo encuentra.
// {aplicable, motivoNoAplicable|null, estadoFuente|null, etiquetaFuente}
function ufs_aplicabilidad(propuesta, calculo) {
  var base = { aplicable: false, motivoNoAplicable: null, estadoFuente: null, etiquetaFuente: ufs_etiquetaFuente([], propuesta.fuenteTipo, propuesta.x, propuesta.y, propuesta.wellId) };
  if (!calculo || !calculo.estado) {
    base.motivoNoAplicable = 'FUENTE_NO_EXISTE';
    return base;
  }
  var st = calculo.estado;
  base.etiquetaFuente = ufs_etiquetaFuente(st.fuentes, propuesta.fuenteTipo, propuesta.x, propuesta.y, propuesta.wellId);
  var clave = ufs_claveDeEvento(propuesta);
  var fuente = (st.fuentes || []).filter(function (f) { return f.clave === clave; })[0];
  if (!st.integro) {
    base.motivoNoAplicable = 'HISTORIAL_INCONSISTENTE';
    return base;
  }
  if (!fuente) {
    base.motivoNoAplicable = 'FUENTE_NO_EXISTE';
    return base;
  }
  base.estadoFuente = fuente.estado;
  var r = ufd_decidir(st, { decision: UFD_SVC_ACCIONES[propuesta.accionSugerida], fuenteTipo: propuesta.fuenteTipo, x: propuesta.x, y: propuesta.y, motivo: propuesta.motivo, versionVista: st.version });
  if (r.ok) {
    base.aplicable = true;
    return base;
  }
  base.motivoNoAplicable = r.codigo === 'ALREADY_IN_STATE' ? 'YA_ESTA_ASI' : (r.codigo === 'INVALID_TRANSITION' ? 'YA_NO_CORRESPONDE' : 'NO_APLICABLE');
  return base;
}

// Item seguro para el cliente: SIN emails, SIN clientRequestId, SIN secuencia. `nombre` es el del PROPONENTE; la resolucion trae el nombre de quien resolvio.
function ufs_item(sug, aplic, version) {
  var p = sug.propuesta;
  var item = {
    sugerenciaId: sug.sugerenciaId, wellId: p.wellId, fuenteTipo: p.fuenteTipo, x: p.x, y: p.y, etiquetaFuente: aplic.etiquetaFuente, accionSugerida: p.accionSugerida,
    motivo: p.motivo, nombre: p.nombre, timestampUtc: p.timestampUtc, estado: sug.estado, resolucion: null
  };
  if (sug.resolucion) {
    item.resolucion = { evento: sug.resolucion.evento, nombre: sug.resolucion.nombre, timestampUtc: sug.resolucion.timestampUtc, motivo: sug.resolucion.motivo };
  } else if (sug.curada) {
    item.resolucion = { evento: 'APROBADA', nombre: '', timestampUtc: '', motivo: '' };
  }
  if (sug.estado === UFS_ESTADOS.PENDIENTE) {
    item.aplicable = aplic.aplicable;
    item.motivoNoAplicable = aplic.motivoNoAplicable;
    item.estadoFuente = aplic.estadoFuente;
    if (version !== undefined) { item.versionVista = version; }
  }
  return item;
}

// ======================================================================================================================
// SERVICIO
// ======================================================================================================================

function ubicacionFuenteSugerenciasService_normalizarEmail(email) {
  return ubicacionCorreccionService_normalizarEmail(email);
}

function ubicacionFuenteSugerenciasService_validarMotivo(motivo, obligatorio) {
  var m = ubicacionCorreccionService_validarMotivo(motivo, obligatorio);
  return m.ok ? m : ubicacionFuenteSugerenciasService_error('INVALID_MOTIVO', m.message);
}

function ufs_versionValida(v) {
  return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 0;
}

function ufs_idValido(id) {
  return typeof id === 'string' && UFS_ID_REGEX.test(id);
}

// --- Validacion de la forma de cada solicitud (todo se vuelve a validar aca: el Api solo filtra la lista blanca de campos) ---

function ubicacionFuenteSugerenciasService_validarSugerir(s) {
  var d = s && typeof s === 'object' ? s : {};
  if (!ufd_wellIdValido(d.wellId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_WELL_ID');
  }
  if (typeof d.accionSugerida !== 'string' || !Object.prototype.hasOwnProperty.call(UFS_ACCIONES_SUGERIBLES, d.accionSugerida)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_ACCION');
  }
  if (typeof d.clientRequestId !== 'string' || !UBICACION_CORR_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_CLIENT_REQUEST_ID');
  }
  if (typeof d.fuenteTipo !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, d.fuenteTipo) || ufd_claveFuente(d.wellId, d.fuenteTipo, d.x, d.y) === null) {
    return ubicacionFuenteSugerenciasService_error('INVALID_FUENTE');
  }
  if (!ufs_versionValida(d.versionVista)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_VERSION');
  }
  var motivo = ubicacionFuenteSugerenciasService_validarMotivo(d.motivo, d.accionSugerida === 'DESCARTAR');
  if (!motivo.ok) {
    return motivo;
  }
  return {
    ok: true,
    solicitud: {
      wellId: d.wellId, accionSugerida: d.accionSugerida, clientRequestId: d.clientRequestId, fuenteTipo: d.fuenteTipo,
      x: Number(ufd_normalizarCoordenada(d.x)), y: Number(ufd_normalizarCoordenada(d.y)), versionVista: d.versionVista, motivo: motivo.motivo
    }
  };
}

function ubicacionFuenteSugerenciasService_validarResolver(s) {
  var d = s && typeof s === 'object' ? s : {};
  if (!ufs_idValido(d.sugerenciaId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_SUGERENCIA_ID');
  }
  if (typeof d.resolucion !== 'string' || !Object.prototype.hasOwnProperty.call(UFS_RESOLUCIONES, d.resolucion)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_RESOLUCION');
  }
  if (typeof d.clientRequestId !== 'string' || !UBICACION_CORR_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_CLIENT_REQUEST_ID');
  }
  var aprobar = d.resolucion === 'APROBAR';
  if (aprobar && !ufs_versionValida(d.versionVista)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_VERSION');
  }
  var motivo = ubicacionFuenteSugerenciasService_validarMotivo(d.motivo, !aprobar);       // rechazar: motivo OBLIGATORIO; aprobar: opcional
  if (!motivo.ok) {
    return motivo;
  }
  return { ok: true, solicitud: { sugerenciaId: d.sugerenciaId, resolucion: d.resolucion, clientRequestId: d.clientRequestId, versionVista: aprobar ? d.versionVista : null, motivo: motivo.motivo } };
}

function ubicacionFuenteSugerenciasService_validarCancelar(s) {
  var d = s && typeof s === 'object' ? s : {};
  if (!ufs_idValido(d.sugerenciaId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_SUGERENCIA_ID');
  }
  if (typeof d.clientRequestId !== 'string' || !UBICACION_CORR_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_CLIENT_REQUEST_ID');
  }
  var motivo = ubicacionFuenteSugerenciasService_validarMotivo(d.motivo, false);
  if (!motivo.ok) {
    return motivo;
  }
  return { ok: true, solicitud: { sugerenciaId: d.sugerenciaId, clientRequestId: d.clientRequestId, motivo: motivo.motivo } };
}

// --- Cache ---

function ubicacionFuenteSugerenciasService_cache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    ubicacionFuenteSugerenciasService_log('CacheService no disponible: ' + String(err));
    return null;
  }
}

// Despues de CADA escritura confirmada (y de cada decision, que cambia lo que dicen las sugerencias). NUNCA lanza.
function ubicacionFuenteSugerenciasService_invalidar(wellId) {
  var cache = ubicacionFuenteSugerenciasService_cache();
  if (!cache) {
    return false;
  }
  var ok = true;
  try {
    cache.put(UFS_CACHE_INVAL_KEY, String(Date.now()), UFS_CACHE_INVAL_SEGUNDOS);
  } catch (err) {
    ok = false;
    ubicacionFuenteSugerenciasService_log('no se pudo marcar la invalidacion: ' + String(err));
  }
  var claves = [UFS_CACHE_COLA];
  if (typeof wellId === 'string' && wellId !== '') {
    claves.push(UFS_CACHE_PREFIJO_POZO + wellId);
  }
  claves.forEach(function (k) {
    try {
      cache.remove(k);
    } catch (err) {
      ok = false;
      ubicacionFuenteSugerenciasService_log('no se pudo invalidar: ' + String(err));
    }
  });
  return ok;
}

function ubicacionFuenteSugerenciasService_cacheLeer(clave, validar) {
  var cache = ubicacionFuenteSugerenciasService_cache();
  if (!cache) {
    return null;
  }
  try {
    var crudo = cache.get(clave);
    if (crudo !== null && crudo !== undefined) {
      var parseado = JSON.parse(crudo);
      if (validar(parseado)) {
        return parseado;
      }
    }
  } catch (err) {
    ubicacionFuenteSugerenciasService_log('lectura de cache invalida, se recalcula: ' + String(err));
  }
  return null;
}

// inicio: Date.now() de cuando EMPEZO el calculo; si se invalido durante el calculo (marca reciente) el resultado viejo NO se guarda.
function ubicacionFuenteSugerenciasService_cacheGuardar(clave, valor, inicio) {
  var cache = ubicacionFuenteSugerenciasService_cache();
  if (!cache) {
    return;
  }
  try {
    var marca = cache.get(UFS_CACHE_INVAL_KEY);
    var invalidada = marca !== null && marca !== undefined && Number(marca) >= inicio - UFS_CACHE_MARGEN_CARRERA_MS;
    var json = JSON.stringify(valor);
    if (invalidada) {
      ubicacionFuenteSugerenciasService_log('se invalido mientras se calculaba: no se guarda');
    } else if (json.length > UFS_CACHE_MAX_CARACTERES) {
      ubicacionFuenteSugerenciasService_log('vista de ' + json.length + ' caracteres: supera el limite de CacheService, no se guarda');
    } else {
      cache.put(clave, json, UFS_CACHE_SEGUNDOS);
    }
  } catch (err) {
    ubicacionFuenteSugerenciasService_log('no se pudo guardar: ' + String(err));
  }
}

// --- Busquedas e idempotencia ---

// El evento (de cualquier tipo) que `emailN` genero con ese clientRequestId, o null. El id es unico POR USUARIO en toda la hoja.
function ubicacionFuenteSugerenciasService_buscarPorClientRequestId(filas, emailN, clientRequestId) {
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].clientRequestId === clientRequestId && ubicacionFuenteSugerenciasService_normalizarEmail(filas[i].email) === emailN) {
      return filas[i];
    }
  }
  return null;
}

function ubicacionFuenteSugerenciasService_mismaSugerencia(fila, s) {
  return fila.evento === UFS_EVENTOS.PROPUESTA && fila.wellId === s.wellId && fila.accionSugerida === s.accionSugerida &&
    ufd_claveFuente(fila.wellId, fila.fuenteTipo, fila.x, fila.y) === ufd_claveFuente(s.wellId, s.fuenteTipo, s.x, s.y) && fila.motivo === s.motivo && fila.versionVista === s.versionVista;
}

// Un reintento de APROBAR puede haber terminado en APROBADA o en OBSOLETA; uno de RECHAZAR, en RECHAZADA.
function ubicacionFuenteSugerenciasService_mismaResolucion(fila, s) {
  var evento = fila.evento;
  var tipoOk = s.resolucion === 'RECHAZAR' ? evento === UFS_EVENTOS.RECHAZADA : (evento === UFS_EVENTOS.APROBADA || evento === UFS_EVENTOS.OBSOLETA);
  return fila.sugerenciaId === s.sugerenciaId && tipoOk && fila.motivo === s.motivo && (s.resolucion === 'RECHAZAR' || fila.versionVista === s.versionVista);
}

function ubicacionFuenteSugerenciasService_mismaCancelacion(fila, s) {
  return fila.sugerenciaId === s.sugerenciaId && fila.evento === UFS_EVENTOS.CANCELADA && fila.motivo === s.motivo;
}

// --- Lectura de estado ---

function ubicacionFuenteSugerenciasService_leerTodo() {
  return { filasSug: ubicacionFuenteSugerenciasRepository_listar(), filasDec: ubicacionFuenteDecisionesRepository_listar() };
}

// {estado, ...} del pozo con los datos de HOY, o null si el padron no lo encuentra. `memo` evita releer el mismo pozo dos veces dentro de una operacion.
function ubicacionFuenteSugerenciasService_calculoPozo(wellId, filasDec, memo) {
  if (memo && Object.prototype.hasOwnProperty.call(memo, wellId)) {
    return memo[wellId];
  }
  var padron = ubicacionFuenteDecisionesService_padron(wellId);
  var calculo = padron.ok ? ubicacionFuenteDecisionesService_calcular(wellId, padron.fuentes, filasDec) : null;
  if (memo) {
    memo[wellId] = calculo;
  }
  return calculo;
}

function ubicacionFuenteSugerenciasService_logAnomalias(derivado) {
  var malas = derivado.sugerencias.filter(function (s) { return s.estado === null; });
  if (malas.length > 0 || derivado.anomaliasGlobales.length > 0) {
    ubicacionFuenteSugerenciasService_log('INCONSISTENTES ' + malas.length + ' sugerencia(s): ' + JSON.stringify(malas.slice(0, 5).map(function (s) { return { id: s.sugerenciaId, anomalias: s.anomalias }; })) +
      (derivado.anomaliasGlobales.length > 0 ? ' | filas sin id valido: ' + derivado.anomaliasGlobales.length : ''));
  }
}

// --- sugerirDecisionFuente ---

// {ok:true, duplicada, sugerencia, nueva, notificar, auditoria} | {ok:false, code, message, ...}. Idempotente por (usuario, clientRequestId).
function ubicacionFuenteSugerenciasService_sugerir(email, nombre, solicitud) {
  var v = ubicacionFuenteSugerenciasService_validarSugerir(solicitud);
  if (!v.ok) {
    return v;
  }
  var s = v.solicitud;
  var emailN = ubicacionFuenteSugerenciasService_normalizarEmail(email);

  var previa = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(ubicacionFuenteSugerenciasRepository_listar(), emailN, s.clientRequestId);
  if (previa) {
    return ubicacionFuenteSugerenciasService_atenderSugerirExistente(previa, s);
  }

  return ubicacionFuenteDecisionesRepository_conLock(function () {
    // Todo se relee DENTRO del lock (nunca el cache): sugerencias, decisiones y padron.
    var filasSug = ubicacionFuenteSugerenciasRepository_listar();
    var enLock = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(filasSug, emailN, s.clientRequestId);
    if (enLock) {
      return ubicacionFuenteSugerenciasService_atenderSugerirExistente(enLock, s);
    }
    var padron = ubicacionFuenteDecisionesService_padron(s.wellId);
    if (!padron.ok) {
      return padron;
    }
    var filasDec = ubicacionFuenteDecisionesRepository_listar();
    var sig = ubicacionFuenteDecisionesService_siguienteSecuencia(filasSug, 'sugerenciaId');
    if (!sig.ok) {
      ubicacionFuenteSugerenciasService_log('secuencia invalida en ' + sig.invalidas.length + ' fila(s) (sugerenciaId: ' + sig.invalidas.slice(0, 5).join(', ') + '): no se escribe');
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'el registro de sugerencias tiene un valor de secuencia invalido: no se puede registrar una sugerencia hasta que se revise');
    }
    var calculo = ubicacionFuenteDecisionesService_calcular(s.wellId, padron.fuentes, filasDec);

    // ¿Es una sugerencia razonable HOY? Se valida con el mismo dominio que una decision real (sin ejecutarla): una fuente inexistente, un estado que ya es ese o una
    // transicion que el dominio impediria (restaurar una fuente que no esta descartada, aceptar una descartada...) no se sugieren.
    var r = ufd_decidir(calculo.estado, { decision: UFD_SVC_ACCIONES[s.accionSugerida], fuenteTipo: s.fuenteTipo, x: s.x, y: s.y, motivo: s.motivo, versionVista: calculo.estado.version });
    if (!r.ok) {
      return ubicacionFuenteSugerenciasService_error(UFD_SVC_ERRORES_DOMINIO[r.codigo] || 'SERVICE_UNAVAILABLE', r.mensaje);
    }

    var derivado = ufs_derivar(filasSug, filasDec);
    var clave = ufd_claveFuente(s.wellId, s.fuenteTipo, s.x, s.y);
    var pendientesDelUsuario = derivado.sugerencias.filter(function (g) {
      return g.estado === UFS_ESTADOS.PENDIENTE && g.propuesta && ubicacionFuenteSugerenciasService_normalizarEmail(g.propuesta.email) === emailN;
    });
    // "Aplicable HOY" = se podria aprobar ahora (padron + estado actual de la fuente). Se calcula al vuelo, SIN escribir nada: una pendiente que dejo de ser aplicable (reindexado,
    // otra decision) se conserva intacta y auditable, pero ni bloquea ni consume cupo. Si vuelve a ser aplicable, vuelve a contar.
    var calculos = {};
    calculos[s.wellId] = calculo;
    var esAplicableHoy = function (g) {
      try {
        return ufs_aplicabilidad(g.propuesta, ubicacionFuenteSugerenciasService_calculoPozo(g.propuesta.wellId, filasDec, calculos)).aplicable === true;
      } catch (err) {
        ubicacionFuenteSugerenciasService_log('no se pudo verificar si una sugerencia pendiente sigue aplicable (cuenta para el limite): ' + String(err));
        return true;                // fail-closed: si no se puede verificar, el limite no se puede esquivar
      }
    };
    // Deduplicacion: NO depende solo del clientRequestId. Misma persona + mismo pozo + misma fuente + misma accion mientras siga PENDIENTE y APLICABLE = no se crea otra
    // (una equivalente que ya no es aplicable no bloquea; como esta misma accion acaba de validarse contra el estado actual, en la practica la equivalente tambien lo es).
    var igual = pendientesDelUsuario.filter(function (g) { return ufs_claveDeEvento(g.propuesta) === clave && g.propuesta.accionSugerida === s.accionSugerida && esAplicableHoy(g); })[0];
    if (igual) {
      return ubicacionFuenteSugerenciasService_error('ALREADY_PENDING', null, { sugerencia: ufs_item(igual, ufs_aplicabilidad(igual.propuesta, calculo)) });
    }
    // Limite: hasta 10 pendientes APLICABLES por usuario (se corta apenas se alcanza: no hace falta verificar el resto).
    var aplicablesDelUsuario = 0;
    for (var i = 0; i < pendientesDelUsuario.length && aplicablesDelUsuario < UFS_LIMITE_PENDIENTES; i++) {
      if (esAplicableHoy(pendientesDelUsuario[i])) {
        aplicablesDelUsuario += 1;
      }
    }
    if (aplicablesDelUsuario >= UFS_LIMITE_PENDIENTES) {
      return ubicacionFuenteSugerenciasService_error('PENDING_LIMIT_REACHED', null, { limite: UFS_LIMITE_PENDIENTES });
    }

    var fila = {
      sugerenciaId: Utilities.getUuid(), secuencia: sig.siguiente, evento: UFS_EVENTOS.PROPUESTA, wellId: s.wellId, fuenteTipo: s.fuenteTipo, x: s.x, y: s.y,
      accionSugerida: s.accionSugerida, motivo: s.motivo, email: emailN, nombre: nombre || '', timestampUtc: new Date(Date.now()).toISOString(), clientRequestId: s.clientRequestId,
      versionVista: s.versionVista
    };
    ubicacionFuenteSugerenciasRepository_agregar(fila);
    ubicacionFuenteSugerenciasService_invalidar(s.wellId);
    var nueva = ufs_derivar(filasSug.concat([fila]), filasDec).sugerencias.filter(function (g) { return g.sugerenciaId === fila.sugerenciaId; })[0];
    var aplic = ufs_aplicabilidad(nueva.propuesta, calculo);
    return {
      ok: true, duplicada: false, nueva: true, auditoria: UFS_AUDITORIA.PROPUESTA, wellId: s.wellId, sugerencia: ufs_item(nueva, aplic, calculo.estado.version),
      notificar: { sugerenciaId: fila.sugerenciaId, wellId: s.wellId, etiquetaFuente: aplic.etiquetaFuente, accionSugerida: s.accionSugerida, nombre: fila.nombre, timestampUtc: fila.timestampUtc, motivo: s.motivo }
    };
  });
}

// Reintento de una PROPUESTA ya escrita: mismo contenido -> la sugerencia original (sin escribir); otro contenido -> IDEMPOTENCY_CONFLICT. La vista de hoy es un extra: si no
// se puede armar, igual se devuelve la sugerencia.
function ubicacionFuenteSugerenciasService_atenderSugerirExistente(fila, s) {
  if (!ubicacionFuenteSugerenciasService_mismaSugerencia(fila, s)) {
    return ubicacionFuenteSugerenciasService_error('IDEMPOTENCY_CONFLICT');
  }
  return { ok: true, duplicada: true, nueva: false, wellId: fila.wellId, sugerencia: ubicacionFuenteSugerenciasService_itemDeId(fila.sugerenciaId) };
}

// Item actual de una sugerencia por id (con aplicabilidad si se puede calcular). null si no se encuentra o esta inconsistente.
function ubicacionFuenteSugerenciasService_itemDeId(sugerenciaId) {
  try {
    var t = ubicacionFuenteSugerenciasService_leerTodo();
    var sug = ufs_derivar(t.filasSug, t.filasDec).sugerencias.filter(function (g) { return g.sugerenciaId === sugerenciaId; })[0];
    if (!sug || sug.estado === null) {
      return null;
    }
    var aplic = sug.estado === UFS_ESTADOS.PENDIENTE ? ufs_aplicabilidad(sug.propuesta, ubicacionFuenteSugerenciasService_calculoPozo(sug.propuesta.wellId, t.filasDec, {})) :
      { aplicable: false, motivoNoAplicable: null, estadoFuente: null, etiquetaFuente: ufs_etiquetaFuente([], sug.propuesta.fuenteTipo, sug.propuesta.x, sug.propuesta.y, sug.propuesta.wellId) };
    return ufs_item(sug, aplic);
  } catch (err) {
    ubicacionFuenteSugerenciasService_log('no se pudo armar la vista de una sugerencia: ' + String(err));
    return null;
  }
}

// --- resolverSugerenciaFuente (APROBAR / RECHAZAR) ---

// Escribe UN evento de resolucion de `sug` (hereda pozo, fuente y accion de la PROPUESTA). Llamar dentro del lock.
function ubicacionFuenteSugerenciasService_escribirResolucion(evento, sug, emailN, nombre, s, filasSug) {
  var sig = ubicacionFuenteDecisionesService_siguienteSecuencia(filasSug, 'sugerenciaId');
  var p = sug.propuesta;
  var fila = {
    sugerenciaId: sug.sugerenciaId, secuencia: sig.siguiente, evento: evento, wellId: p.wellId, fuenteTipo: p.fuenteTipo, x: p.x, y: p.y, accionSugerida: p.accionSugerida,
    motivo: s.motivo, email: emailN, nombre: nombre || '', timestampUtc: new Date(Date.now()).toISOString(), clientRequestId: s.clientRequestId,
    versionVista: s.versionVista === undefined ? null : s.versionVista
  };
  ubicacionFuenteSugerenciasRepository_agregar(fila);
  ubicacionFuenteSugerenciasService_invalidar(p.wellId);
  return fila;
}

// {ok:true, duplicada, resultado:'APROBADA'|'RECHAZADA'|'OBSOLETA', sugerencia, wellId, auditoria, [decision, auditoriaDecision, data, motivoNoAplicable, curada]} | {ok:false, code, ...}
function ubicacionFuenteSugerenciasService_resolver(email, nombre, solicitud) {
  var v = ubicacionFuenteSugerenciasService_validarResolver(solicitud);
  if (!v.ok) {
    return v;
  }
  var s = v.solicitud;
  var emailN = ubicacionFuenteSugerenciasService_normalizarEmail(email);

  var previa = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(ubicacionFuenteSugerenciasRepository_listar(), emailN, s.clientRequestId);
  if (previa) {
    return ubicacionFuenteSugerenciasService_atenderResolverExistente(previa, s);
  }

  return ubicacionFuenteDecisionesRepository_conLock(function () {
    var filasSug = ubicacionFuenteSugerenciasRepository_listar();
    var enLock = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(filasSug, emailN, s.clientRequestId);
    if (enLock) {
      return ubicacionFuenteSugerenciasService_atenderResolverExistente(enLock, s);
    }
    var filasDec = ubicacionFuenteDecisionesRepository_listar();
    var derivado = ufs_derivar(filasSug, filasDec);
    var sug = derivado.sugerencias.filter(function (g) { return g.sugerenciaId === s.sugerenciaId; })[0];
    if (!sug) {
      return ubicacionFuenteSugerenciasService_error('SUGGESTION_NOT_FOUND');
    }
    if (sug.estado === null) {
      ubicacionFuenteSugerenciasService_logAnomalias(derivado);
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'esta sugerencia tiene un registro inconsistente: se necesita una revision tecnica');
    }
    // Un reintento de OTRO validador (o con otro id) sobre una sugerencia que quedo "curada" completa el evento faltante; cualquier otra ya resuelta no se toca.
    if (sug.estado !== UFS_ESTADOS.PENDIENTE && !(sug.curada && s.resolucion === 'APROBAR')) {
      return ubicacionFuenteSugerenciasService_error('ALREADY_RESOLVED', null, { estado: sug.estado });
    }
    var sigSug = ubicacionFuenteDecisionesService_siguienteSecuencia(filasSug, 'sugerenciaId');
    if (!sigSug.ok) {
      ubicacionFuenteSugerenciasService_log('secuencia invalida en ' + sigSug.invalidas.length + ' fila(s) (sugerenciaId: ' + sigSug.invalidas.slice(0, 5).join(', ') + '): no se escribe');
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'el registro de sugerencias tiene un valor de secuencia invalido: no se puede resolver hasta que se revise');
    }

    if (s.resolucion === 'RECHAZAR') {
      var rechazo = ubicacionFuenteSugerenciasService_escribirResolucion(UFS_EVENTOS.RECHAZADA, sug, emailN, nombre, s, filasSug);
      return ubicacionFuenteSugerenciasService_resultadoResolucion('RECHAZADA', rechazo, filasSug, filasDec, false);
    }
    return ubicacionFuenteSugerenciasService_aprobarEnLock(emailN, nombre, s, sug, filasSug, filasDec);
  });
}

// APROBAR dentro del lock. Escribe PRIMERO la decision (si no existe ya) y DESPUES el evento APROBADA.
function ubicacionFuenteSugerenciasService_aprobarEnLock(emailN, nombre, s, sug, filasSug, filasDec) {
  var p = sug.propuesta;
  var wellId = p.wellId;

  // CURACION: la decision de esta sugerencia ya esta escrita (un corte dejo el evento APROBADA sin escribir). No se crea otra: solo se completa lo que falta.
  var existente = ufs_decisionDeSugerencia(filasDec, p);
  if (existente) {
    if (!existente.coincide) {
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'esta sugerencia tiene un registro inconsistente: se necesita una revision tecnica');
    }
    var curado = ubicacionFuenteSugerenciasService_escribirResolucion(UFS_EVENTOS.APROBADA, sug, emailN, nombre, s, filasSug);
    var salida = ubicacionFuenteSugerenciasService_resultadoResolucion('APROBADA', curado, filasSug, filasDec, true);
    salida.decision = ubicacionFuenteDecisionesService_itemDecision(existente.fila);
    salida.curada = true;
    return salida;
  }

  var padron = ubicacionFuenteDecisionesService_padron(wellId);
  if (!padron.ok) {
    // el pozo ya no esta en el padron: no hay fuente a la que aplicar nada. Queda OBSOLETA (jamas se transfiere).
    return ubicacionFuenteSugerenciasService_obsoleta(emailN, nombre, s, sug, filasSug, filasDec, 'FUENTE_NO_EXISTE');
  }
  var accion = p.accionSugerida;
  var raw = ubicacionFuenteDecisionesService_validarSolicitud({
    wellId: wellId, accion: accion, clientRequestId: ufs_idDecisionDeSugerencia(sug.sugerenciaId), fuenteTipo: p.fuenteTipo, x: p.x, y: p.y, versionVista: s.versionVista, motivo: p.motivo
  });
  if (!raw.ok) {
    return raw;
  }
  var decidida = ubicacionFuenteDecisionesService_aplicarDecision(emailN, nombre, raw.solicitud, filasDec, padron);
  if (!decidida.ok) {
    if (decidida.code === 'SOURCE_NOT_FOUND' || decidida.code === 'ALREADY_IN_STATE' || decidida.code === 'INVALID_TRANSITION') {
      var motivoNo = decidida.code === 'SOURCE_NOT_FOUND' ? 'FUENTE_NO_EXISTE' : (decidida.code === 'ALREADY_IN_STATE' ? 'YA_ESTA_ASI' : 'YA_NO_CORRESPONDE');
      return ubicacionFuenteSugerenciasService_obsoleta(emailN, nombre, s, sug, filasSug, filasDec, motivoNo);
    }
    return decidida;                // STALE_STATE (+versionActual), INCONSISTENT_STATE, secuencia invalida de decisiones...: nada se escribio
  }
  // A partir de aca la decision YA esta escrita: si lo que sigue falla (corte), el reintento cura (ver arriba) y no duplica la decision.
  var evento = ubicacionFuenteSugerenciasService_escribirResolucion(UFS_EVENTOS.APROBADA, sug, emailN, nombre, s, filasSug);
  var salidaOk = ubicacionFuenteSugerenciasService_resultadoResolucion('APROBADA', evento, filasSug, filasDec, false);
  salidaOk.decision = decidida.decision;
  salidaOk.auditoriaDecision = decidida.auditoria;
  salidaOk.data = decidida.data;
  return salidaOk;
}

function ubicacionFuenteSugerenciasService_obsoleta(emailN, nombre, s, sug, filasSug, filasDec, motivoNoAplicable) {
  var fila = ubicacionFuenteSugerenciasService_escribirResolucion(UFS_EVENTOS.OBSOLETA, sug, emailN, nombre, s, filasSug);
  var salida = ubicacionFuenteSugerenciasService_resultadoResolucion('OBSOLETA', fila, filasSug, filasDec, false);
  salida.motivoNoAplicable = motivoNoAplicable;
  return salida;
}

// Arma la respuesta con la sugerencia ya resuelta (releyendo sus eventos + el que se acaba de escribir).
function ubicacionFuenteSugerenciasService_resultadoResolucion(resultado, filaEvento, filasSug, filasDec, curada) {
  var sug = ufs_derivar(filasSug.concat([filaEvento]), filasDec).sugerencias.filter(function (g) { return g.sugerenciaId === filaEvento.sugerenciaId; })[0];
  var aplic = { aplicable: false, motivoNoAplicable: null, estadoFuente: null, etiquetaFuente: ufs_etiquetaFuente([], filaEvento.fuenteTipo, filaEvento.x, filaEvento.y, filaEvento.wellId) };
  return { ok: true, duplicada: false, resultado: resultado, wellId: filaEvento.wellId, auditoria: UFS_AUDITORIA[filaEvento.evento], curada: !!curada, sugerencia: sug && sug.estado !== null ? ufs_item(sug, aplic) : null };
}

function ubicacionFuenteSugerenciasService_atenderResolverExistente(fila, s) {
  if (!ubicacionFuenteSugerenciasService_mismaResolucion(fila, s)) {
    return ubicacionFuenteSugerenciasService_error('IDEMPOTENCY_CONFLICT');
  }
  return { ok: true, duplicada: true, resultado: fila.evento, wellId: fila.wellId, sugerencia: ubicacionFuenteSugerenciasService_itemDeId(fila.sugerenciaId) };
}

// --- cancelarSugerenciaFuente ---

// Solo el AUTOR y solo mientras siga PENDIENTE. Para cualquier otra persona la sugerencia "no existe" (no se revela quien sugirio que).
function ubicacionFuenteSugerenciasService_cancelar(email, nombre, solicitud) {
  var v = ubicacionFuenteSugerenciasService_validarCancelar(solicitud);
  if (!v.ok) {
    return v;
  }
  var s = v.solicitud;
  var emailN = ubicacionFuenteSugerenciasService_normalizarEmail(email);

  var previa = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(ubicacionFuenteSugerenciasRepository_listar(), emailN, s.clientRequestId);
  if (previa) {
    if (!ubicacionFuenteSugerenciasService_mismaCancelacion(previa, s)) {
      return ubicacionFuenteSugerenciasService_error('IDEMPOTENCY_CONFLICT');
    }
    return { ok: true, duplicada: true, wellId: previa.wellId, sugerencia: ubicacionFuenteSugerenciasService_itemDeId(previa.sugerenciaId) };
  }

  return ubicacionFuenteDecisionesRepository_conLock(function () {
    var filasSug = ubicacionFuenteSugerenciasRepository_listar();
    var enLock = ubicacionFuenteSugerenciasService_buscarPorClientRequestId(filasSug, emailN, s.clientRequestId);
    if (enLock) {
      if (!ubicacionFuenteSugerenciasService_mismaCancelacion(enLock, s)) {
        return ubicacionFuenteSugerenciasService_error('IDEMPOTENCY_CONFLICT');
      }
      return { ok: true, duplicada: true, wellId: enLock.wellId, sugerencia: ubicacionFuenteSugerenciasService_itemDeId(enLock.sugerenciaId) };
    }
    var filasDec = ubicacionFuenteDecisionesRepository_listar();
    var derivado = ufs_derivar(filasSug, filasDec);
    var sug = derivado.sugerencias.filter(function (g) { return g.sugerenciaId === s.sugerenciaId; })[0];
    if (!sug || !sug.propuesta || ubicacionFuenteSugerenciasService_normalizarEmail(sug.propuesta.email) !== emailN) {
      return ubicacionFuenteSugerenciasService_error('SUGGESTION_NOT_FOUND');
    }
    if (sug.estado === null) {
      ubicacionFuenteSugerenciasService_logAnomalias(derivado);
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'esta sugerencia tiene un registro inconsistente: se necesita una revision tecnica');
    }
    if (sug.estado !== UFS_ESTADOS.PENDIENTE) {
      return ubicacionFuenteSugerenciasService_error('ALREADY_RESOLVED', null, { estado: sug.estado });
    }
    var sig = ubicacionFuenteDecisionesService_siguienteSecuencia(filasSug, 'sugerenciaId');
    if (!sig.ok) {
      return ubicacionFuenteSugerenciasService_error('INCONSISTENT_STATE', 'el registro de sugerencias tiene un valor de secuencia invalido: no se puede cancelar hasta que se revise');
    }
    var fila = ubicacionFuenteSugerenciasService_escribirResolucion(UFS_EVENTOS.CANCELADA, sug, emailN, nombre, { motivo: s.motivo, clientRequestId: s.clientRequestId, versionVista: null }, filasSug);
    var salida = ubicacionFuenteSugerenciasService_resultadoResolucion('CANCELADA', fila, filasSug, filasDec, false);
    delete salida.curada;
    return salida;
  });
}

// --- Lecturas: getSugerenciasFuentesPozo y getSugerenciasFuentesPendientes ---

function ufs_itemsDePozo(derivado, wellId, calculo, esValidador, emailN) {
  var propias = derivado.sugerencias.filter(function (g) {
    return g.estado !== null && g.propuesta && g.propuesta.wellId === wellId && (esValidador ? g.estado === UFS_ESTADOS.PENDIENTE : ubicacionFuenteSugerenciasService_normalizarEmail(g.propuesta.email) === emailN);
  });
  propias.sort(function (a, b) { return b.propuesta.secuencia - a.propuesta.secuencia; });              // las mas nuevas primero
  var version = calculo ? calculo.estado.version : undefined;
  return propias.slice(0, UFS_POZO_MAX).map(function (g) {
    var aplic = g.estado === UFS_ESTADOS.PENDIENTE ? ufs_aplicabilidad(g.propuesta, calculo) : { aplicable: false, motivoNoAplicable: null, estadoFuente: null, etiquetaFuente: ufs_etiquetaFuente(calculo ? calculo.estado.fuentes : [], g.propuesta.fuenteTipo, g.propuesta.x, g.propuesta.y, wellId) };
    return ufs_item(g, aplic, version);
  });
}

// Vista de las sugerencias de un pozo. Quien NO valida: solo SUS sugerencias (todos los estados). Quien valida: todas las PENDIENTES del pozo. Sin emails.
// {ok:true, data:{wellId, version, integro, sugerencias:[...]}} | {ok:false, WELL_NOT_FOUND}
function ubicacionFuenteSugerenciasService_getPorPozo(email, esValidador, wellId) {
  if (!ufd_wellIdValido(wellId)) {
    return ubicacionFuenteSugerenciasService_error('INVALID_WELL_ID');
  }
  var emailN = ubicacionFuenteSugerenciasService_normalizarEmail(email);
  var claveCache = UFS_CACHE_PREFIJO_POZO + wellId;
  if (esValidador === true) {
    var cacheada = ubicacionFuenteSugerenciasService_cacheLeer(claveCache, function (o) { return o && o.wellId === wellId && Array.isArray(o.sugerencias); });
    if (cacheada) {
      return { ok: true, data: cacheada };
    }
  }
  var inicio = Date.now();
  var padron = ubicacionFuenteDecisionesService_padron(wellId);
  if (!padron.ok) {
    return padron;
  }
  var t = ubicacionFuenteSugerenciasService_leerTodo();
  var calculo = ubicacionFuenteDecisionesService_calcular(wellId, padron.fuentes, t.filasDec);
  var derivado = ufs_derivar(t.filasSug, t.filasDec);
  ubicacionFuenteSugerenciasService_logAnomalias(derivado);
  var data = { wellId: wellId, version: calculo.estado.version, integro: calculo.estado.integro === true, sugerencias: ufs_itemsDePozo(derivado, wellId, calculo, esValidador === true, emailN) };
  if (esValidador === true) {
    ubicacionFuenteSugerenciasService_cacheGuardar(claveCache, data, inicio);       // la vista del validador no depende de quien pregunta
  }
  return { ok: true, data: data };
}

// Cola de PENDIENTES para quien valida: {total (aplicables, para el indicador), noAplicables, inconsistentes, pendientes:[...]}. Una lectura de cada hoja + el padron de cada
// pozo distinto (sin N+1 por sugerencia). Mas viejas primero.
function ubicacionFuenteSugerenciasService_getPendientes() {
  var cacheada = ubicacionFuenteSugerenciasService_cacheLeer(UFS_CACHE_COLA, function (o) { return o && Array.isArray(o.pendientes) && typeof o.total === 'number'; });
  if (cacheada) {
    return { ok: true, data: cacheada };
  }
  var inicio = Date.now();
  var t = ubicacionFuenteSugerenciasService_leerTodo();
  var derivado = ufs_derivar(t.filasSug, t.filasDec);
  ubicacionFuenteSugerenciasService_logAnomalias(derivado);
  var memo = {};
  var pendientes = derivado.sugerencias.filter(function (g) { return g.estado === UFS_ESTADOS.PENDIENTE; });
  var items = pendientes.map(function (g) {
    var calculo = ubicacionFuenteSugerenciasService_calculoPozo(g.propuesta.wellId, t.filasDec, memo);
    var item = ufs_item(g, ufs_aplicabilidad(g.propuesta, calculo), calculo ? calculo.estado.version : undefined);
    // lat/lon de la fuente (derivadas por el dominio del padron actual); si la fuente ya no existe no hay coordenada que mostrar
    var clave = ufs_claveDeEvento(g.propuesta);
    var fuente = calculo ? (calculo.estado.fuentes || []).filter(function (f) { return f.clave === clave; })[0] : null;
    if (fuente) {
      item.lat = fuente.lat;
      item.lon = fuente.lon;
    }
    return item;
  });
  var data = {
    total: items.filter(function (i) { return i.aplicable === true; }).length,
    noAplicables: items.filter(function (i) { return i.aplicable !== true; }).length,
    inconsistentes: derivado.sugerencias.filter(function (g) { return g.estado === null; }).length,
    pendientes: items.slice(0, UFS_COLA_MAX)
  };
  ubicacionFuenteSugerenciasService_cacheGuardar(UFS_CACHE_COLA, data, inicio);
  return { ok: true, data: data };
}

// Para correr a mano desde el editor: revisa TODA la hoja y deja en el log las sugerencias inconsistentes (solo codigos y ids; sin emails ni coordenadas).
function diagnosticarUbicacionFuenteSugerencias() {
  var t = ubicacionFuenteSugerenciasService_leerTodo();
  var d = ufs_derivar(t.filasSug, t.filasDec);
  var resumen = {
    filas: t.filasSug.length, sugerencias: d.sugerencias.length, filasSinIdValido: d.anomaliasGlobales.length,
    pendientes: d.sugerencias.filter(function (g) { return g.estado === UFS_ESTADOS.PENDIENTE; }).length,
    inconsistentes: d.sugerencias.filter(function (g) { return g.estado === null; }).map(function (g) { return g.sugerenciaId + ': ' + g.anomalias.join(','); })
  };
  Logger.log(JSON.stringify(resumen));
  return resumen;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFS_ACCIONES_SUGERIBLES, UFS_EVENTOS, UFS_ESTADOS, UFS_RESOLUCIONES, UFS_AUDITORIA, UFS_LIMITE_PENDIENTES, UFS_COLA_MAX, UFS_POZO_MAX,
    UFS_CACHE_PREFIJO_POZO, UFS_CACHE_COLA, UFS_CACHE_INVAL_KEY, UFS_CACHE_SEGUNDOS, UFS_ID_REGEX,
    ufs_problemaDeEvento, ufs_derivar, ufs_aplicabilidad, ufs_item, ufs_etiquetaFuente, ufs_idDecisionDeSugerencia, ufs_decisionDeSugerencia,
    ubicacionFuenteSugerenciasService_validarSugerir,
    ubicacionFuenteSugerenciasService_validarResolver,
    ubicacionFuenteSugerenciasService_validarCancelar,
    ubicacionFuenteSugerenciasService_sugerir,
    ubicacionFuenteSugerenciasService_resolver,
    ubicacionFuenteSugerenciasService_cancelar,
    ubicacionFuenteSugerenciasService_getPorPozo,
    ubicacionFuenteSugerenciasService_getPendientes,
    ubicacionFuenteSugerenciasService_invalidar,
    diagnosticarUbicacionFuenteSugerencias
  };
}
