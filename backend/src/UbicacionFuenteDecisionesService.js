// Decisiones sobre las FUENTES REGISTRALES de ubicacion (aceptar / descartar / quitar la aceptacion / restaurar). Etapa 2 (backend) de
// docs/ubicacion-fuente-decisiones.md. NO toca las correcciones de campo (UbicacionCorrecciones) ni la prioridad «validada en campo > aceptada»: eso se integra mas
// adelante. Las reglas de dominio (identidad, estados, transiciones, resolver registral) viven en UbicacionFuenteDecisionesLogic.js, copia EXACTA del modulo del
// frontend (un test exige que no deriven); este archivo solo agrega lo que depende del backend: permisos de lectura de hojas, lock, secuencia, idempotencia, cache.
//
// El backend es la unica autoridad:
//   - La fuente se verifica contra el padron ACTUAL (registryService_getWellLocation): el cliente solo manda tipo + x + y y una fuente que hoy no existe es SOURCE_NOT_FOUND.
//   - email y nombre salen de la sesion; el cliente no manda estado, punto operativo, secuencia, fecha ni identidad.
//   - El orden es la `secuencia` (max + 1 bajo lock); la fecha es solo informativa.
//
// Errores estables (code): INVALID_WELL_ID, WELL_NOT_FOUND, INVALID_ACCION, INVALID_CLIENT_REQUEST_ID, INVALID_FUENTE, INVALID_VERSION, INVALID_MOTIVO,
// SOURCE_NOT_FOUND, STALE_STATE (+versionActual), INCONSISTENT_STATE, INVALID_TRANSITION, ALREADY_IN_STATE, IDEMPOTENCY_CONFLICT. Nunca se devuelve el texto de un
// error interno de Sheets: el detalle tecnico va a Logger.

var UFD_SVC_ACCIONES = { ACEPTAR: 'ACEPTAR', DESCARTAR: 'DESCARTAR', QUITAR_ACEPTACION: 'QUITAR', RESTAURAR: 'RESTAURAR' };    // accion del API -> decision del dominio
var UFD_SVC_AUDITORIA = { ACEPTADA: 'FUENTE_ACEPTADA', DESCARTADA: 'FUENTE_DESCARTADA', ACEPTACION_QUITADA: 'FUENTE_ACEPTACION_QUITADA', RESTAURADA: 'FUENTE_RESTAURADA' };
var UFD_SVC_ERRORES_DOMINIO = {
  INVALID_DECISION: 'INVALID_ACCION', INVALID_FUENTE: 'INVALID_FUENTE', INVALID_VERSION: 'INVALID_VERSION', MOTIVO_REQUERIDO: 'INVALID_MOTIVO', MOTIVO_INVALIDO: 'INVALID_MOTIVO',
  WELL_ID_INVALIDO: 'INVALID_WELL_ID', SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND', STALE_STATE: 'STALE_STATE', INVALID_TRANSITION: 'INVALID_TRANSITION',
  ALREADY_IN_STATE: 'ALREADY_IN_STATE', INCONSISTENT_STATE: 'INCONSISTENT_STATE'
};
// Cache de lectura por pozo (misma tecnica que getUbicacionesValidadas: TTL, marca de invalidacion contra la carrera lector/escritor, tope de tamano, nunca indispensable).
var UFD_SVC_CACHE_PREFIJO = 'ufd_vista_v1_';
var UFD_SVC_CACHE_INVAL_KEY = 'ufd_vista_v1_inval';
var UFD_SVC_CACHE_SEGUNDOS = 120;
var UFD_SVC_CACHE_INVAL_SEGUNDOS = 180;
var UFD_SVC_CACHE_MAX_CARACTERES = 90000;
var UFD_SVC_CACHE_MARGEN_CARRERA_MS = 2000;
var UFD_SVC_MENSAJES = {
  INVALID_WELL_ID: 'wellId invalido',
  WELL_NOT_FOUND: 'no se encontro el pozo en el padron',
  INVALID_ACCION: 'accion invalida (ACEPTAR, DESCARTAR, QUITAR_ACEPTACION o RESTAURAR)',
  INVALID_CLIENT_REQUEST_ID: 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)',
  INVALID_FUENTE: 'la fuente indicada no es valida (fuenteTipo, x e y)',
  INVALID_VERSION: 'versionVista debe ser un entero mayor o igual a 0',
  IDEMPOTENCY_CONFLICT: 'clientRequestId ya usado con otro contenido',
  SERVICE_UNAVAILABLE: 'servicio no disponible'
};

function ubicacionFuenteDecisionesService_error(code, message, extra) {
  var e = { ok: false, code: code, message: message || UFD_SVC_MENSAJES[code] || code };
  if (extra) {
    Object.keys(extra).forEach(function (k) { e[k] = extra[k]; });
  }
  return e;
}

function ubicacionFuenteDecisionesService_log(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Decisiones de fuentes: ' + mensaje);
  }
}

// --- Forma de la solicitud (todo se vuelve a validar aca: el Api solo filtra la lista blanca de campos) ---

function ubicacionFuenteDecisionesService_validarSolicitud(s) {
  var d = s && typeof s === 'object' ? s : {};
  if (!ufd_wellIdValido(d.wellId)) {
    return ubicacionFuenteDecisionesService_error('INVALID_WELL_ID');
  }
  if (typeof d.accion !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_SVC_ACCIONES, d.accion)) {
    return ubicacionFuenteDecisionesService_error('INVALID_ACCION');
  }
  if (typeof d.clientRequestId !== 'string' || !UBICACION_CORR_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return ubicacionFuenteDecisionesService_error('INVALID_CLIENT_REQUEST_ID');
  }
  if (typeof d.fuenteTipo !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, d.fuenteTipo) || ufd_claveFuente(d.wellId, d.fuenteTipo, d.x, d.y) === null) {
    return ubicacionFuenteDecisionesService_error('INVALID_FUENTE');
  }
  if (typeof d.versionVista !== 'number' || !isFinite(d.versionVista) || Math.floor(d.versionVista) !== d.versionVista || d.versionVista < 0) {
    return ubicacionFuenteDecisionesService_error('INVALID_VERSION');
  }
  // mismo limite, limpieza y codigo que el motivo de las correcciones (constante y rutina existentes)
  var motivo = ubicacionCorreccionService_validarMotivo(d.motivo, d.accion === 'DESCARTAR');
  if (!motivo.ok) {
    return ubicacionFuenteDecisionesService_error('INVALID_MOTIVO', motivo.message);
  }
  return {
    ok: true,
    solicitud: {
      wellId: d.wellId, accion: d.accion, decision: UFD_SVC_ACCIONES[d.accion], clientRequestId: d.clientRequestId, fuenteTipo: d.fuenteTipo,
      x: Number(ufd_normalizarCoordenada(d.x)), y: Number(ufd_normalizarCoordenada(d.y)), versionVista: d.versionVista, motivo: motivo.motivo
    }
  };
}

// --- Estado de un pozo (padron actual + eventos) ---

// Evento del dominio a partir de una fila de la hoja: SOLO los campos que el dominio conoce (nada de emails ni nombres).
function ubicacionFuenteDecisionesService_eventoDeDominio(f) {
  return { secuencia: f.secuencia, evento: f.evento, wellId: f.wellId, fuenteTipo: f.fuenteTipo, x: f.x, y: f.y, motivo: f.motivo };
}

// El padron del pozo: {ok:true, fuentes, periodo} o {ok:false, WELL_NOT_FOUND}. La coordenada de una fuente NUNCA sale de otro lugar que de aca.
function ubicacionFuenteDecisionesService_padron(wellId) {
  var res = registryService_getWellLocation(wellId);
  if (!res || !res.found) {
    return ubicacionFuenteDecisionesService_error('WELL_NOT_FOUND');
  }
  var periodo = '';
  try {
    var meta = registryService_getMetadata();
    if (meta && meta.found && meta.metadata && meta.metadata.periodo) {
      periodo = String(meta.metadata.periodo);
    }
  } catch (err) {
    periodo = '';
  }
  return { ok: true, fuentes: ufd_fuentesDePadron(wellId, res.location).fuentes, periodo: periodo };
}

// {estado, resolucion, filasDelPozo}. `filas` = TODAS las filas de la hoja (el filtro por pozo se hace aca).
function ubicacionFuenteDecisionesService_calcular(wellId, fuentes, filas) {
  var delPozo = filas.filter(function (f) { return f.wellId === wellId; });
  var estado = ufd_derivar({ wellId: wellId, eventos: delPozo.map(ubicacionFuenteDecisionesService_eventoDeDominio), fuentes: fuentes });
  if (!estado.integro) {
    // diagnostico tecnico: solo codigos y secuencias, jamas al usuario
    ubicacionFuenteDecisionesService_log('pozo ' + wellId + ' INCONSISTENTE: ' + JSON.stringify(estado.anomalias));
  }
  return { estado: estado, resolucion: ufd_resolverRegistral(estado), filasDelPozo: delPozo };
}

function ubicacionFuenteDecisionesService_resumenPunto(p) {
  return { estado: p.estado, lat: p.lat, lon: p.lon };
}

// Vista segura para el cliente (sin emails, sin anomalias tecnicas, sin ids internos). `nombre` y `timestampUtc` salen de la fila del evento.
function ubicacionFuenteDecisionesService_vista(wellId, calculo, periodo) {
  var estado = calculo.estado;
  var res = calculo.resolucion;
  var porSecuencia = {};
  calculo.filasDelPozo.forEach(function (f) { porSecuencia[f.secuencia] = f; });
  function ultima(sec) {
    var f = sec === null || sec === undefined ? null : porSecuencia[sec];
    return f ? { secuencia: f.secuencia, evento: f.evento, nombre: f.nombre, timestampUtc: f.timestampUtc, motivo: f.motivo } : null;
  }
  return {
    wellId: wellId,
    version: estado.version,
    integro: estado.integro,
    padronPeriodo: periodo || '',
    fuentes: estado.fuentes.map(function (f) {
      return {
        clave: f.clave, fuenteTipo: f.tipo, x: f.x, y: f.y, lat: f.lat, lon: f.lon, posicion: f.posicion, estado: f.estado,
        esAceptadaVigente: f.esAceptadaVigente, esOperativa: res.operativo === true && res.fuenteClave === f.clave, ultima: ultima(f.ultimaSecuencia)
      };
    }),
    obsoletas: estado.obsoletas.map(function (o) {
      return { clave: o.clave, fuenteTipo: o.tipo, x: o.x, y: o.y, estado: o.estado, ultima: ultima(o.ultimaSecuencia) };
    }),
    historial: estado.historial.map(function (h) {
      var u = ultima(h.secuencia);
      return {
        secuencia: h.secuencia, evento: h.evento, fuenteTipo: h.tipo, x: h.x, y: h.y, nombre: u ? u.nombre : '', timestampUtc: u ? u.timestampUtc : '', motivo: h.motivo,
        obsoleta: h.obsoleta, reemplazaA: h.reemplazaA, reemplazadaPor: h.reemplazadaPor, descartaLaAceptada: h.descartaLaAceptada, quitaAceptacion: h.quitaAceptacion
      };
    }),
    resolucion: {
      estado: res.estado, nivel: res.nivel, regla: res.regla, operativo: res.operativo, lat: res.lat, lon: res.lon, fuente: res.fuente, fuenteClave: res.fuenteClave,
      todasDescartadas: res.todasDescartadas, participantes: res.participantes, cambiaRespectoDelOriginal: res.cambiaRespectoDelOriginal,
      automatico: ubicacionFuenteDecisionesService_resumenPunto(res.automatico), original: ubicacionFuenteDecisionesService_resumenPunto(res.original)
    }
  };
}

// --- Cache de lectura ---

function ubicacionFuenteDecisionesService_cache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    ubicacionFuenteDecisionesService_log('CacheService no disponible: ' + String(err));
    return null;
  }
}

// Despues de CADA escritura confirmada (el repositorio hace flush). NUNCA lanza: si falla, la operacion principal sigue y el TTL acota el desfasaje.
function ubicacionFuenteDecisionesService_invalidar(wellId) {
  var cache = ubicacionFuenteDecisionesService_cache();
  if (!cache) {
    return false;
  }
  var ok = true;
  try {
    cache.put(UFD_SVC_CACHE_INVAL_KEY, String(Date.now()), UFD_SVC_CACHE_INVAL_SEGUNDOS);
  } catch (err) {
    ok = false;
    ubicacionFuenteDecisionesService_log('no se pudo marcar la invalidacion: ' + String(err));
  }
  try {
    cache.remove(UFD_SVC_CACHE_PREFIJO + wellId);
  } catch (err) {
    ok = false;
    ubicacionFuenteDecisionesService_log('no se pudo invalidar: ' + String(err));
  }
  return ok;
}

// --- Lectura: getDecisionesFuentesPozo ---

// {ok:true, data: vista} | {ok:false, code}. Primero el cache (contenido ya sanitizado y sin datos del solicitante); si no esta, padron + hoja, y se guarda 120 s.
function ubicacionFuenteDecisionesService_getPorPozo(wellId) {
  if (!ufd_wellIdValido(wellId)) {
    return ubicacionFuenteDecisionesService_error('INVALID_WELL_ID');
  }
  var cache = ubicacionFuenteDecisionesService_cache();
  if (cache) {
    try {
      var crudo = cache.get(UFD_SVC_CACHE_PREFIJO + wellId);
      if (crudo !== null && crudo !== undefined) {
        var parseado = JSON.parse(crudo);
        if (parseado && parseado.wellId === wellId && Array.isArray(parseado.fuentes)) {
          return { ok: true, data: parseado };
        }
      }
    } catch (err) {
      ubicacionFuenteDecisionesService_log('lectura de cache invalida, se recalcula: ' + String(err));
    }
  }

  var inicio = Date.now();
  var padron = ubicacionFuenteDecisionesService_padron(wellId);
  if (!padron.ok) {
    return padron;
  }
  var vista = ubicacionFuenteDecisionesService_vista(wellId, ubicacionFuenteDecisionesService_calcular(wellId, padron.fuentes, ubicacionFuenteDecisionesRepository_listar()), padron.periodo);

  if (cache) {
    try {
      var marca = cache.get(UFD_SVC_CACHE_INVAL_KEY);
      var invalidadaDuranteElCalculo = marca !== null && marca !== undefined && Number(marca) >= inicio - UFD_SVC_CACHE_MARGEN_CARRERA_MS;
      var json = JSON.stringify(vista);
      if (invalidadaDuranteElCalculo) {
        ubicacionFuenteDecisionesService_log('se invalido mientras se calculaba: no se guarda');
      } else if (json.length > UFD_SVC_CACHE_MAX_CARACTERES) {
        ubicacionFuenteDecisionesService_log('vista de ' + json.length + ' caracteres: supera el limite de CacheService, no se guarda');
      } else {
        cache.put(UFD_SVC_CACHE_PREFIJO + wellId, json, UFD_SVC_CACHE_SEGUNDOS);
      }
    } catch (err) {
      ubicacionFuenteDecisionesService_log('no se pudo guardar: ' + String(err));
    }
  }
  return { ok: true, data: vista };
}

// --- Escritura: decidirFuenteUbicacion ---

// Siguiente secuencia = MAX(secuencia de TODAS las filas de la hoja, de cualquier pozo) + 1. Una secuencia valida es un entero seguro >= 1. Si ALGUNA fila (de
// cualquier pozo) no la tiene (vacia con el resto de la fila lleno, texto, 0, negativa, decimal, fuera de rango) el maximo deja de ser confiable (esa fila podria "ser"
// cualquier numero): FAIL-CLOSED, no se escribe. Devuelve {ok, siguiente} o {ok:false, invalidas:[decisionId...]} (el detalle va solo al log).
function ubicacionFuenteDecisionesService_siguienteSecuencia(filas) {
  var max = 0;
  var invalidas = [];
  filas.forEach(function (f) {
    var n = f.secuencia;
    if (typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 9007199254740990) {
      if (n > max) {
        max = n;
      }
    } else {
      invalidas.push(f.decisionId || '(sin decisionId)');
    }
  });
  return invalidas.length === 0 ? { ok: true, siguiente: max + 1 } : { ok: false, invalidas: invalidas };
}

// Una solicitud ya escrita por (usuario, clientRequestId): la fila existente o null.
function ubicacionFuenteDecisionesService_buscarPorClientRequestId(filas, emailN, clientRequestId) {
  for (var i = 0; i < filas.length; i++) {
    if (filas[i].clientRequestId === clientRequestId && ubicacionCorreccionService_normalizarEmail(filas[i].email) === emailN) {
      return filas[i];
    }
  }
  return null;
}

// Mismo contenido = mismo pozo, misma fuente (identidad canonica), misma accion, mismo motivo y la misma version vista.
function ubicacionFuenteDecisionesService_mismaSolicitud(fila, s) {
  return fila.wellId === s.wellId && fila.fuenteTipo === s.fuenteTipo &&
    ufd_claveFuente(fila.wellId, fila.fuenteTipo, fila.x, fila.y) === ufd_claveFuente(s.wellId, s.fuenteTipo, s.x, s.y) &&
    fila.evento === UFD_DECISION_A_EVENTO[s.decision] && fila.motivo === s.motivo && fila.versionVista === s.versionVista;
}

function ubicacionFuenteDecisionesService_itemDecision(f) {
  return { secuencia: f.secuencia, evento: f.evento, fuenteTipo: f.fuenteTipo, x: f.x, y: f.y, nombre: f.nombre, timestampUtc: f.timestampUtc, motivo: f.motivo };
}

// {ok:true, duplicada, decision, data: vista} | {ok:false, code, message, ...}. Idempotente por (usuario, clientRequestId); la lectura, la validacion de la
// transicion, la asignacion de la secuencia y la escritura van en UN solo lock; el padron tambien se lee DENTRO del lock.
function ubicacionFuenteDecisionesService_decidir(email, nombre, solicitud) {
  var v = ubicacionFuenteDecisionesService_validarSolicitud(solicitud);
  if (!v.ok) {
    return v;
  }
  var s = v.solicitud;
  var emailN = ubicacionCorreccionService_normalizarEmail(email);

  // Reintento de una solicitud ya escrita: se responde ANTES de mirar el padron o la version (el padron pudo haber cambiado y la version avanzo con esta misma escritura).
  var previa = ubicacionFuenteDecisionesService_buscarPorClientRequestId(ubicacionFuenteDecisionesRepository_listar(), emailN, s.clientRequestId);
  if (previa) {
    return ubicacionFuenteDecisionesService_atenderExistente(previa, s);
  }

  return ubicacionFuenteDecisionesRepository_conLock(function () {
    // Hoja Y padron se leen DENTRO del lock (nunca el cache de lectura): lo que se decide es lo que hay en este momento, no lo que vio el pedido al llegar. Un reindexado
    // entre el pedido y el lock se ve aca (SOURCE_NOT_FOUND si la coordenada ya no existe). El reintento ya escrito se atiende antes de mirar el padron.
    var filas = ubicacionFuenteDecisionesRepository_listar();
    var enLock = ubicacionFuenteDecisionesService_buscarPorClientRequestId(filas, emailN, s.clientRequestId);
    if (enLock) {
      return ubicacionFuenteDecisionesService_atenderExistente(enLock, s);
    }
    var padron = ubicacionFuenteDecisionesService_padron(s.wellId);
    if (!padron.ok) {
      return padron;
    }
    var sig = ubicacionFuenteDecisionesService_siguienteSecuencia(filas);
    if (!sig.ok) {
      ubicacionFuenteDecisionesService_log('secuencia invalida en ' + sig.invalidas.length + ' fila(s) (decisionId: ' + sig.invalidas.slice(0, 5).join(', ') + '): no se escribe');
      return ubicacionFuenteDecisionesService_error('INCONSISTENT_STATE', 'el registro de decisiones tiene un valor de secuencia invalido: no se puede registrar una decision hasta que se revise');
    }
    var calculo = ubicacionFuenteDecisionesService_calcular(s.wellId, padron.fuentes, filas);
    var r = ufd_decidir(calculo.estado, { decision: s.decision, fuenteTipo: s.fuenteTipo, x: s.x, y: s.y, motivo: s.motivo, versionVista: s.versionVista });
    if (!r.ok) {
      var extra = r.codigo === 'STALE_STATE' ? { versionActual: r.versionActual } : null;
      return ubicacionFuenteDecisionesService_error(UFD_SVC_ERRORES_DOMINIO[r.codigo] || 'SERVICE_UNAVAILABLE', r.mensaje, extra);
    }
    var fila = {
      decisionId: Utilities.getUuid(),
      secuencia: sig.siguiente,
      wellId: s.wellId,
      fuenteTipo: r.evento.fuenteTipo,
      x: r.evento.x,
      y: r.evento.y,
      evento: r.evento.evento,
      motivo: r.evento.motivo,
      email: emailN,
      nombre: nombre || '',
      timestampUtc: new Date(Date.now()).toISOString(),
      clientRequestId: s.clientRequestId,
      versionVista: s.versionVista,
      padronPeriodo: padron.periodo
    };
    ubicacionFuenteDecisionesRepository_agregar(fila);
    ubicacionFuenteDecisionesService_invalidar(s.wellId);
    var nuevo = ubicacionFuenteDecisionesService_calcular(s.wellId, padron.fuentes, filas.concat([fila]));
    return { ok: true, duplicada: false, decision: ubicacionFuenteDecisionesService_itemDecision(fila), evento: fila.evento, auditoria: UFD_SVC_AUDITORIA[fila.evento], data: ubicacionFuenteDecisionesService_vista(s.wellId, nuevo, padron.periodo) };
  });
}

// Reintento: mismo contenido -> la decision original + la vista de HOY (sin escribir); otro contenido -> IDEMPOTENCY_CONFLICT.
function ubicacionFuenteDecisionesService_atenderExistente(fila, s) {
  if (!ubicacionFuenteDecisionesService_mismaSolicitud(fila, s)) {
    return ubicacionFuenteDecisionesService_error('IDEMPOTENCY_CONFLICT');
  }
  // La decision original ya esta escrita: la vista de hoy es un extra. Si el padron o la hoja no responden en este momento (o el pozo ya no figura), el reintento
  // igual devuelve la decision original (data: null) en vez de fallar.
  var data = null;
  try {
    var padron = ubicacionFuenteDecisionesService_padron(fila.wellId);
    if (padron.ok) {
      data = ubicacionFuenteDecisionesService_vista(fila.wellId, ubicacionFuenteDecisionesService_calcular(fila.wellId, padron.fuentes, ubicacionFuenteDecisionesRepository_listar()), padron.periodo);
    }
  } catch (err) {
    ubicacionFuenteDecisionesService_log('reintento idempotente: no se pudo armar la vista actual: ' + String(err));
    data = null;
  }
  return { ok: true, duplicada: true, decision: ubicacionFuenteDecisionesService_itemDecision(fila), evento: fila.evento, auditoria: UFD_SVC_AUDITORIA[fila.evento], data: data };
}

// --- Diagnostico manual (editor de Apps Script) ---

// Revisa TODA la hoja contra el padron de hoy y devuelve, por pozo con decisiones: {wellId, integro, anomalias:[codigos], obsoletas, filas}. Solo lectura; no se
// expone por ningun endpoint. Las filas que no se pueden atribuir a un pozo valido se informan aparte (filasSinPozo).
function ubicacionFuenteDecisionesService_diagnosticar() {
  var filas = ubicacionFuenteDecisionesRepository_listar();
  var porPozo = {};
  var sinPozo = 0;
  filas.forEach(function (f) {
    if (ufd_wellIdValido(f.wellId)) {
      porPozo[f.wellId] = (porPozo[f.wellId] || 0) + 1;
    } else {
      sinPozo += 1;
    }
  });
  var pozos = Object.keys(porPozo).sort().map(function (wellId) {
    var padron = ubicacionFuenteDecisionesService_padron(wellId);
    var estado = ufd_derivar({ wellId: wellId, eventos: filas.filter(function (f) { return f.wellId === wellId; }).map(ubicacionFuenteDecisionesService_eventoDeDominio), fuentes: padron.ok ? padron.fuentes : [] });
    return {
      wellId: wellId, filas: porPozo[wellId], integro: estado.integro, padronEncontrado: padron.ok === true,
      anomalias: estado.anomalias.map(function (a) { return a.codigo + (a.secuencia !== undefined ? '#' + a.secuencia : ''); }), obsoletas: estado.obsoletas.length
    };
  });
  return { filas: filas.length, filasSinPozo: sinPozo, pozos: pozos };
}

// Para correr a mano desde el editor: deja el resultado en el log de ejecucion.
function diagnosticarUbicacionFuenteDecisiones() {
  var r = ubicacionFuenteDecisionesService_diagnosticar();
  Logger.log(JSON.stringify(r));
  return r;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFD_SVC_ACCIONES,
    UFD_SVC_AUDITORIA,
    UFD_SVC_CACHE_PREFIJO,
    UFD_SVC_CACHE_INVAL_KEY,
    UFD_SVC_CACHE_SEGUNDOS,
    UFD_SVC_CACHE_MAX_CARACTERES,
    ubicacionFuenteDecisionesService_validarSolicitud,
    ubicacionFuenteDecisionesService_getPorPozo,
    ubicacionFuenteDecisionesService_decidir,
    ubicacionFuenteDecisionesService_invalidar,
    ubicacionFuenteDecisionesService_diagnosticar,
    diagnosticarUbicacionFuenteDecisiones
  };
}
