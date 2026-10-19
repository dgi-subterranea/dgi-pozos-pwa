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

var UFD_SVC_PREFIJO_ID_SUGERENCIA = 'sug-';          // clientRequestId reservado: lo escribe el servidor al aprobar una sugerencia
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
  return { ok: true, fuentes: ufd_fuentesDePadron(wellId, res.location).fuentes, periodo: ubicacionFuenteDecisionesService_periodoActual() };
}

// Padron ACTUAL segun la metadata de la ficha registral (el mismo origen que usa la hoja al escribir `padronPeriodo`): {periodo, generadoEl}. '' en lo que no se pueda saber
// (nunca lanza). `periodo` es lo que se informa; `generadoEl` (instante de la ultima corrida del indexador) solo se usa para versionar caches: un reindexado del MISMO periodo
// tambien cambia las coordenadas y no debe servir resultados calculados con el padron anterior.
function ubicacionFuenteDecisionesService_padronActual() {
  try {
    var meta = registryService_getMetadata();
    if (meta && meta.found && meta.metadata) {
      return {
        periodo: meta.metadata.periodo ? String(meta.metadata.periodo) : '',
        generadoEl: meta.metadata.generadoEl ? String(meta.metadata.generadoEl) : ''
      };
    }
  } catch (err) {
    ubicacionFuenteDecisionesService_log('no se pudo leer la metadata del padron: ' + String(err));
  }
  return { periodo: '', generadoEl: '' };
}

function ubicacionFuenteDecisionesService_periodoActual() {
  return ubicacionFuenteDecisionesService_padronActual().periodo;
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
  // las sugerencias muestran el estado ACTUAL de cada fuente: una decision cambia lo que dicen (cola, contador, vista del pozo)
  if (typeof ubicacionFuenteSugerenciasService_invalidar === 'function') {
    ubicacionFuenteSugerenciasService_invalidar(wellId);
  }
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

// --- Lectura: getDecisionesFuentesDelta (efecto REGISTRAL de las decisiones sobre el padron actual) ---
//
// Para cada pozo con decisiones calcula el punto operativo REGISTRAL (con el MISMO dominio que getDecisionesFuentesPozo: ufd_derivar + ufd_resolverRegistral, sin una
// segunda logica) y lo compara con el que daria el padron sin decisiones (`resolucion.original`, que es lo que trae pozos.json). Solo sale una entrada cuando el
// resultado OPERATIVO difiere:  {wellId, estado:'R'|'C'|'D', lat, lon}  o  {wellId, estado:'N'}.
//   R = fuente aceptada, C = coincidente, D = disponible. NO incluye la validada en campo (V): el cliente la compone DESPUES, encima de este resultado.
//   N = "SIN PUNTO operativo registral" y SOLO eso: la resolucion VALIDA del dominio determino que no hay punto (todas las fuentes descartadas, o las que quedan siguen en
//       discrepancia, o el dominio dice SIN_COORDENADAS). Un dato imposible de interpretar NUNCA se convierte en N: eso es un FALLO de resolucion (ver `parcial`).
// Respuesta: {version, periodo, parcial, decisiones}.
//   version  secuencia maxima de TODA la hoja entre las filas con secuencia valida (entero seguro >= 1); 0 si no hay filas validas. Cambia con cualquier escritura.
//   periodo  periodo del padron con que se calculo (metadata del padron). OBLIGATORIO: si no se puede determinar de forma confiable el endpoint FALLA (SERVICE_UNAVAILABLE)
//            en vez de devolver un delta no verificable. Un cliente que reciba un periodo distinto del de su dataset base debe IGNORAR todo el delta (otro padron).
//   parcial  cantidad de wellIds con decisiones que debian evaluarse y cuyo resultado NO se pudo calcular de forma segura: presupuesto agotado, archivo del padron ilegible,
//            fuente del padron con coordenada invalida, coordenada fuera de Mendoza o imposible de normalizar, historial de decisiones INCONSISTENTE, o un error de calculo.
//            No cuenta lo que se ignora correctamente por dominio: decision obsoleta (la fuente cambio) y wellId que ya no esta en el padron. Las filas sin wellId valido no
//            pertenecen a ningun pozo: no suman (se registran en el log).
//   parcial > 0 NO invalida el resto: las entradas de `decisiones` son validas y se aplican; los pozos no resueltos simplemente no aparecen (el cliente conserva base + V
//            para ellos y avisa). Solo un fallo GLOBAL (respuesta o contrato invalido, periodo incompatible, endpoint fallido) invalida TODO el delta.
// Un pozo no resuelto NO se inventa ni se convierte en N: no sale en `decisiones`.
// Costo: la hoja se lee UNA vez; el padron de los pozos que faltan en cache se lee en LOTE (cada archivo de departamento una sola vez); el resultado de cada pozo se
// cachea con una clave que incluye su version (una decision nueva produce otra clave sin invalidar nada). Se cachean tambien los fallos DETERMINISTAS (dependen solo de
// las filas y del padron: se repetirian igual), nunca los TRANSITORIOS (tiempo, lectura de archivo, error inesperado), que se reintentan en la llamada siguiente.
var UFD_SVC_DELTA_CACHE_KEY = 'ufd_delta_v1';
var UFD_SVC_DELTA_INVAL_KEY = 'ufd_delta_v1_inval';
var UFD_SVC_DELTA_CACHE_SEGUNDOS = 120;
var UFD_SVC_DELTA_INVAL_SEGUNDOS = 180;
var UFD_SVC_DELTA_CACHE_MAX_CARACTERES = 90000;             // CacheService admite 100 KB por valor: pasado esto el delta completo no se cachea (nunca se trunca)
var UFD_SVC_DELTA_POZO_PREFIJO = 'ufd_res_v1_';
var UFD_SVC_DELTA_POZO_SEGUNDOS = 21600;                    // 6 h, el maximo de CacheService: la clave cambia sola con cada decision y con cada periodo
var UFD_SVC_DELTA_PRESUPUESTO_MS = 15000;                   // conservador: el cliente espera esta respuesta y Apps Script corta mucho mas arriba
var UFD_SVC_DELTA_LOTE_CACHE = 100;                         // getAll / putAll admiten 100 claves por llamada
var UFD_SVC_DELTA_CODIGOS = { ACEPTADA: 'R', COINCIDENTE: 'C', DISPONIBLE: 'D' };
var UFD_SVC_DELTA_ANOMALIAS_FATALES = ['COORDENADA_FUERA_DE_MENDOZA', 'ACEPTADA_FUERA_DE_MENDOZA'];       // el dominio las "absorbe" como sin punto: aca son fallo de resolucion

function ubicacionFuenteDecisionesService_coordenadaOperativa(lat, lon) {
  return typeof lat === 'number' && isFinite(lat) && typeof lon === 'number' && isFinite(lon) &&
    lat >= UFD_MENDOZA_BBOX.latMin && lat <= UFD_MENDOZA_BBOX.latMax && lon >= UFD_MENDOZA_BBOX.lonMin && lon <= UFD_MENDOZA_BBOX.lonMax;
}

// Resultado registral (la salida de ufd_resolverRegistral o su `original`) -> UNA de tres cosas:
//   {estado:'R'|'C'|'D', lat, lon}  punto operativo valido (coordenada numerica finita DENTRO de Mendoza)
//   {estado:'N'}                    el dominio determino, de forma valida, que NO hay punto (SIN_COORDENADAS / DISCREPANCIA no operativos)
//   {invalido: MOTIVO}              no se puede interpretar (ausente, estado desconocido, incoherente, coordenada invalida): NO es "sin punto", es un fallo
function ubicacionFuenteDecisionesService_puntoOperativoRegistral(r) {
  if (!r || typeof r !== 'object') {
    return { invalido: 'RESOLUCION_AUSENTE' };
  }
  if (Object.prototype.hasOwnProperty.call(UFD_SVC_DELTA_CODIGOS, r.estado)) {
    if (r.operativo !== true) {
      return { invalido: 'ESTADO_INCOHERENTE' };
    }
    if (!ubicacionFuenteDecisionesService_coordenadaOperativa(r.lat, r.lon)) {
      return { invalido: 'COORDENADA_INVALIDA' };
    }
    return { estado: UFD_SVC_DELTA_CODIGOS[r.estado], lat: r.lat, lon: r.lon };
  }
  if (r.estado === UFD_RESULTADO_ESTADOS.SIN_COORDENADAS || r.estado === UFD_RESULTADO_ESTADOS.DISCREPANCIA) {
    return r.operativo === true ? { invalido: 'ESTADO_INCOHERENTE' } : { estado: 'N' };
  }
  return { invalido: 'ESTADO_DESCONOCIDO' };
}

// Dos clasificaciones validas y iguales. Si cualquiera es invalida NO se las considera iguales (ante la duda, se invalida el cache).
function ubicacionFuenteDecisionesService_mismoPunto(a, b) {
  if (!a || !b || a.invalido || b.invalido) {
    return false;
  }
  return a.estado === b.estado && (a.estado === 'N' || (a.lat === b.lat && a.lon === b.lon));
}

function ubicacionFuenteDecisionesService_hayAnomaliaFatal(res) {
  var lista = [].concat(Array.isArray(res.anomalias) ? res.anomalias : [], res.original && Array.isArray(res.original.anomalias) ? res.original.anomalias : []);
  return lista.some(function (a) { return a && UFD_SVC_DELTA_ANOMALIAS_FATALES.indexOf(a.codigo) !== -1; });
}

// resolucion de un pozo -> {ok:true, entrada: {wellId, estado[, lat, lon]} | null}  (null = el resultado efectivo es el mismo que el original: no entra)
//                        | {ok:false, motivo}  (la resolucion no se pudo interpretar: el pozo NO se emite, ni como punto ni como N)
function ubicacionFuenteDecisionesService_entradaDelta(wellId, resolucion) {
  if (!resolucion || typeof resolucion !== 'object') {
    return { ok: false, motivo: 'RESOLUCION_AUSENTE' };
  }
  if (ubicacionFuenteDecisionesService_hayAnomaliaFatal(resolucion)) {
    return { ok: false, motivo: 'COORDENADA_FUERA_DE_MENDOZA' };          // la coordenada se resolvio pero cae fuera de Mendoza: dato invalido, no "sin punto"
  }
  var final = ubicacionFuenteDecisionesService_puntoOperativoRegistral(resolucion);
  if (final.invalido) {
    return { ok: false, motivo: final.invalido };
  }
  var original = ubicacionFuenteDecisionesService_puntoOperativoRegistral(resolucion.original);
  if (original.invalido) {
    return { ok: false, motivo: original.invalido };
  }
  if (ubicacionFuenteDecisionesService_mismoPunto(final, original)) {
    return { ok: true, entrada: null };
  }
  return { ok: true, entrada: final.estado === 'N' ? { wellId: wellId, estado: 'N' } : { wellId: wellId, estado: final.estado, lat: final.lat, lon: final.lon } };
}

// Evalua UN pozo con decisiones. Devuelve {ok:true, entrada|null} o {ok:false, tipo:'determinista'|'transitorio', motivo, detalle?}.
//   determinista: depende solo de las filas del pozo y del padron (se repetiria igual): fuente del padron invalida, historial inconsistente, coordenada invalida/fuera de Mendoza.
//   transitorio : un error inesperado del calculo (puede no repetirse).
function ubicacionFuenteDecisionesService_evaluarPozoDelta(wellId, location, filasDelPozo) {
  try {
    var padron = ufd_fuentesDePadron(wellId, location);
    if (padron.anomalias.length > 0) {
      return { ok: false, tipo: 'determinista', motivo: 'FUENTE_PADRON_INVALIDA', detalle: JSON.stringify(padron.anomalias) };
    }
    var calculo = ubicacionFuenteDecisionesService_calcular(wellId, padron.fuentes, filasDelPozo);
    if (!calculo.estado.integro) {
      // hay decisiones pero no se pueden interpretar: se conserva el base, pero NO se oculta (suma a parcial)
      return { ok: false, tipo: 'determinista', motivo: 'HISTORIAL_INCONSISTENTE', detalle: JSON.stringify(calculo.estado.anomalias) };
    }
    var r = ubicacionFuenteDecisionesService_entradaDelta(wellId, calculo.resolucion);
    if (!r.ok) {
      return { ok: false, tipo: 'determinista', motivo: r.motivo, detalle: JSON.stringify(calculo.resolucion.anomalias) };
    }
    return { ok: true, entrada: r.entrada };
  } catch (err) {
    return { ok: false, tipo: 'transitorio', motivo: 'CALCULO', detalle: String(err) };
  }
}

// Secuencia valida: entero seguro >= 1 (la misma regla que siguienteSecuencia).
function ubicacionFuenteDecisionesService_secuenciaValida(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 9007199254740990;
}

function ubicacionFuenteDecisionesService_cacheLeerVarios(cache, claves) {
  var out = {};
  for (var i = 0; i < claves.length; i += UFD_SVC_DELTA_LOTE_CACHE) {
    var lote = claves.slice(i, i + UFD_SVC_DELTA_LOTE_CACHE);
    try {
      var r = cache.getAll(lote) || {};
      Object.keys(r).forEach(function (k) { out[k] = r[k]; });
    } catch (err) {
      ubicacionFuenteDecisionesService_log('delta: no se pudo leer el cache por pozo: ' + String(err));
    }
  }
  return out;
}

function ubicacionFuenteDecisionesService_cacheGuardarVarios(cache, pares) {
  var claves = Object.keys(pares);
  for (var i = 0; i < claves.length; i += UFD_SVC_DELTA_LOTE_CACHE) {
    var lote = {};
    claves.slice(i, i + UFD_SVC_DELTA_LOTE_CACHE).forEach(function (k) { lote[k] = pares[k]; });
    try {
      cache.putAll(lote, UFD_SVC_DELTA_POZO_SEGUNDOS);
    } catch (err) {
      ubicacionFuenteDecisionesService_log('delta: no se pudo guardar el cache por pozo: ' + String(err));
    }
  }
}

// Lo que se guarda por pozo: '=' (sin efecto), una entrada, o '!' (fallo DETERMINISTA, con su motivo). undefined = no estaba / ilegible (se recalcula).
//   devuelve {entrada} (puede ser null) o {falla: motivo}
function ubicacionFuenteDecisionesService_leerResultadoCacheado(wellId, crudo) {
  if (crudo === undefined || crudo === null) {
    return undefined;
  }
  try {
    var v = JSON.parse(crudo);
    if (v && v.e === '=') {
      return { entrada: null };
    }
    if (v && v.e === 'N') {
      return { entrada: { wellId: wellId, estado: 'N' } };
    }
    if (v && v.e === '!' && typeof v.m === 'string' && /^[A-Z_]{1,40}$/.test(v.m)) {
      return { falla: v.m };
    }
    if (v && (v.e === 'R' || v.e === 'C' || v.e === 'D') && ubicacionFuenteDecisionesService_coordenadaOperativa(v.lat, v.lon)) {
      return { entrada: { wellId: wellId, estado: v.e, lat: v.lat, lon: v.lon } };
    }
  } catch (err) {
    // ilegible: se recalcula
  }
  return undefined;
}

function ubicacionFuenteDecisionesService_serializarResultado(r) {
  if (!r.ok) {
    return JSON.stringify({ e: '!', m: r.motivo });
  }
  if (r.entrada === null) {
    return '{"e":"="}';
  }
  return r.entrada.estado === 'N' ? '{"e":"N"}' : JSON.stringify({ e: r.entrada.estado, lat: r.entrada.lat, lon: r.entrada.lon });
}

// Invalida el delta completo. Se llama DESPUES de una escritura confirmada que cambio el punto operativo registral de un pozo. NUNCA lanza: si falla, la operacion
// principal sigue y el TTL (120 s) acota el desfasaje. La marca con la hora evita que un lector que empezo ANTES guarde un resultado viejo.
function ubicacionFuenteDecisionesService_invalidarDelta() {
  var cache = ubicacionFuenteDecisionesService_cache();
  if (!cache) {
    return false;
  }
  var ok = true;
  try {
    cache.put(UFD_SVC_DELTA_INVAL_KEY, String(Date.now()), UFD_SVC_DELTA_INVAL_SEGUNDOS);
  } catch (err) {
    ok = false;
    ubicacionFuenteDecisionesService_log('delta: no se pudo marcar la invalidacion: ' + String(err));
  }
  try {
    cache.remove(UFD_SVC_DELTA_CACHE_KEY);
  } catch (err) {
    ok = false;
    ubicacionFuenteDecisionesService_log('delta: no se pudo invalidar: ' + String(err));
  }
  return ok;
}

// Lo que se cachea es {p: la respuesta, g: version del padron con que se calculo}. `g` se compara en cada lectura: tras un reindexado un delta calculado con el padron
// anterior no se sirve. Lo que se devuelve al cliente es solo `p` (version, periodo, parcial, decisiones). Solo se cachea si no hubo fallos TRANSITORIOS; `parcial` puede
// ser > 0 por fallos deterministas (se repetirian igual hasta que cambie una fila o el padron, y eso cambia la clave / invalida).
function ubicacionFuenteDecisionesService_leerDeltaCompleto(cache, versionPadron) {
  try {
    var crudo = cache.get(UFD_SVC_DELTA_CACHE_KEY);
    if (crudo === null || crudo === undefined) {
      return null;
    }
    var c = JSON.parse(crudo);
    var d = c && c.p;
    if (d && c.g === versionPadron && Array.isArray(d.decisiones) && typeof d.version === 'number' && typeof d.periodo === 'string' && d.periodo !== '' &&
      typeof d.parcial === 'number' && d.parcial >= 0 && Math.floor(d.parcial) === d.parcial) {
      return d;
    }
  } catch (err) {
    ubicacionFuenteDecisionesService_log('delta: lectura de cache invalida, se recalcula: ' + String(err));
  }
  return null;
}

// Padron con que se va a calcular. El PERIODO es obligatorio: sin el, el cliente no puede verificar que el delta corresponde a su dataset base y mezclar decisiones
// calculadas sobre otro padron daria coordenadas falsas. En una instalacion sana la metadata siempre existe (la escribe el mismo indexador que genera la ficha), asi que
// su ausencia o corrupcion es un fallo de instalacion: el endpoint FALLA (el Api responde SERVICE_UNAVAILABLE generico) en lugar de devolver `periodo:''`.
function ubicacionFuenteDecisionesService_padronParaDelta() {
  var meta = registryService_getMetadata();
  var periodo = meta && meta.found && meta.metadata && typeof meta.metadata.periodo === 'string' ? meta.metadata.periodo.trim() : '';
  if (periodo === '') {
    throw new Error('delta de decisiones: la metadata del padron no tiene un periodo valido (no se puede identificar con que padron se calcularia)');
  }
  return { periodo: periodo, generadoEl: meta.metadata.generadoEl ? String(meta.metadata.generadoEl) : '' };
}

// opciones (solo para pruebas): {presupuestoMs}
function ubicacionFuenteDecisionesService_getDelta(opciones) {
  var inicio = Date.now();
  var presupuesto = opciones && typeof opciones.presupuestoMs === 'number' ? opciones.presupuestoMs : UFD_SVC_DELTA_PRESUPUESTO_MS;
  var limite = inicio + presupuesto;
  var padronAct = ubicacionFuenteDecisionesService_padronParaDelta();             // lanza si no hay periodo confiable
  var periodo = padronAct.periodo;
  var versionPadron = periodo + '@' + padronAct.generadoEl;                         // clave de cache: periodo + corrida del indexador
  var cache = ubicacionFuenteDecisionesService_cache();

  if (cache) {
    var completo = ubicacionFuenteDecisionesService_leerDeltaCompleto(cache, versionPadron);
    if (completo) {
      return completo;
    }
  }

  // La hoja se lee UNA vez. Si no existe o tiene otro esquema, lanza: el Api responde SERVICE_UNAVAILABLE generico.
  var filas = ubicacionFuenteDecisionesRepository_listar();
  var version = 0;
  var porPozo = {};
  var filasSinPozo = 0;
  filas.forEach(function (f) {
    if (ubicacionFuenteDecisionesService_secuenciaValida(f.secuencia) && f.secuencia > version) {
      version = f.secuencia;
    }
    if (!ufd_wellIdValido(f.wellId)) {
      filasSinPozo += 1;
      return;
    }
    var g = porPozo[f.wellId] = porPozo[f.wellId] || { wellId: f.wellId, filas: [], maxSecuencia: 0 };
    g.filas.push(f);
    if (ubicacionFuenteDecisionesService_secuenciaValida(f.secuencia) && f.secuencia > g.maxSecuencia) {
      g.maxSecuencia = f.secuencia;
    }
  });
  if (filasSinPozo > 0) {
    ubicacionFuenteDecisionesService_log('delta: ' + filasSinPozo + ' fila(s) sin wellId valido: no pertenecen a ningun pozo, se ignoran');
  }
  var pozos = Object.keys(porPozo).sort();
  var resultados = {};            // wellId -> {entrada: obj|null} | {falla: motivo}   (los transitorios no se guardan: se cuentan aparte)
  var parcial = 0;
  var transitorios = 0;

  // 1) cache por pozo (la clave incluye cantidad de filas, secuencia maxima del pozo y la version del padron)
  var claveDe = {};
  pozos.forEach(function (id) {
    claveDe[id] = UFD_SVC_DELTA_POZO_PREFIJO + id + '_' + porPozo[id].filas.length + '_' + porPozo[id].maxSecuencia + '_' + versionPadron;
  });
  var faltan = pozos;
  if (cache) {
    var hallados = ubicacionFuenteDecisionesService_cacheLeerVarios(cache, pozos.map(function (id) { return claveDe[id]; }));
    faltan = [];
    pozos.forEach(function (id) {
      var r = ubicacionFuenteDecisionesService_leerResultadoCacheado(id, hallados[claveDe[id]]);
      if (r === undefined) {
        faltan.push(id);
      } else {
        resultados[id] = r;
      }
    });
  }

  // 2) los que faltan: padron en lote + dominio
  var paraCachear = {};
  var archivosAbiertos = 0;
  if (faltan.length > 0) {
    var lote = registryService_getWellLocations(faltan, { deadlineMs: limite });
    archivosAbiertos = lote.archivosAbiertos || 0;
    lote.errores.forEach(function (e) {
      ubicacionFuenteDecisionesService_log('delta: no se pudo leer el archivo ' + e.archivo + ' del padron: ' + e.detalle);
    });
    var sinPozoEnPadron = 0;
    var noResueltos = {};
    lote.noResueltos.forEach(function (id) { noResueltos[id] = true; });
    faltan.forEach(function (id) {
      if (noResueltos[id] === true) {
        transitorios += 1;
        return;
      }
      var location = lote.locations[id];
      if (location === null || location === undefined) {
        sinPozoEnPadron += 1;
        resultados[id] = { entrada: null };                                   // el pozo ya no esta en el padron: sus decisiones no aplican (no es un fallo)
        paraCachear[claveDe[id]] = ubicacionFuenteDecisionesService_serializarResultado({ ok: true, entrada: null });
        return;
      }
      if (Date.now() >= limite) {
        transitorios += 1;
        return;
      }
      var ev = ubicacionFuenteDecisionesService_evaluarPozoDelta(id, location, porPozo[id].filas);
      if (ev.ok) {
        resultados[id] = { entrada: ev.entrada };
        paraCachear[claveDe[id]] = ubicacionFuenteDecisionesService_serializarResultado(ev);
        return;
      }
      ubicacionFuenteDecisionesService_log('delta: pozo ' + id + ' sin resolver (' + ev.tipo + ', ' + ev.motivo + ')' + (ev.detalle ? ': ' + ev.detalle : ''));
      if (ev.tipo === 'determinista') {
        resultados[id] = { falla: ev.motivo };
        paraCachear[claveDe[id]] = ubicacionFuenteDecisionesService_serializarResultado(ev);
      } else {
        transitorios += 1;
      }
    });
    if (sinPozoEnPadron > 0) {
      ubicacionFuenteDecisionesService_log('delta: ' + sinPozoEnPadron + ' pozo(s) con decisiones que no estan en el padron actual: se ignoran');
    }
    if (cache) {
      ubicacionFuenteDecisionesService_cacheGuardarVarios(cache, paraCachear);
    }
  }

  var decisiones = [];
  var fallasDeterministas = 0;
  pozos.forEach(function (id) {
    var r = resultados[id];
    if (!r) {
      return;                                                                 // transitorio: ya contado
    }
    if (r.falla) {
      fallasDeterministas += 1;
    } else if (r.entrada) {
      decisiones.push(r.entrada);
    }
  });
  parcial = fallasDeterministas + transitorios;
  var payload = { version: version, periodo: periodo, parcial: parcial, decisiones: decisiones };
  // Una linea por calculo (no por acierto del delta completo): es el dato para MEDIR en produccion cuanto cuesta el calculo en frio (decidir si hace falta otra estrategia).
  ubicacionFuenteDecisionesService_log('delta calculado en ' + (Date.now() - inicio) + ' ms: ' + pozos.length + ' pozo(s) con decisiones, ' + (pozos.length - faltan.length) +
    ' por cache, ' + faltan.length + ' a calcular, ' + archivosAbiertos + ' archivo(s) del padron, ' + decisiones.length + ' entrada(s), parcial ' + parcial +
    ' (' + fallasDeterministas + ' determinista(s), ' + transitorios + ' transitorio(s))');
  if (transitorios > 0) {
    ubicacionFuenteDecisionesService_log('delta con ' + transitorios + ' pozo(s) sin resolver por causas transitorias: no se cachea el delta completo');
  }

  if (cache && transitorios === 0) {
    try {
      var marca = cache.get(UFD_SVC_DELTA_INVAL_KEY);
      var invalidadaDuranteElCalculo = marca !== null && marca !== undefined && Number(marca) >= inicio - UFD_SVC_CACHE_MARGEN_CARRERA_MS;
      var json = JSON.stringify({ p: payload, g: versionPadron });
      if (invalidadaDuranteElCalculo) {
        ubicacionFuenteDecisionesService_log('delta: se invalido mientras se calculaba: no se guarda');
      } else if (json.length > UFD_SVC_DELTA_CACHE_MAX_CARACTERES) {
        ubicacionFuenteDecisionesService_log('delta de ' + json.length + ' caracteres: supera el limite de CacheService, no se cachea completo (sigue el cache por pozo)');
      } else {
        cache.put(UFD_SVC_DELTA_CACHE_KEY, json, UFD_SVC_DELTA_CACHE_SEGUNDOS);
      }
    } catch (err) {
      ubicacionFuenteDecisionesService_log('delta: no se pudo guardar el delta completo: ' + String(err));
    }
  }
  return payload;
}

// --- Escritura: decidirFuenteUbicacion ---

// Siguiente secuencia = MAX(secuencia de TODAS las filas de la hoja, de cualquier pozo) + 1. Una secuencia valida es un entero seguro >= 1. Si ALGUNA fila (de
// cualquier pozo) no la tiene (vacia con el resto de la fila lleno, texto, 0, negativa, decimal, fuera de rango) el maximo deja de ser confiable (esa fila podria "ser"
// cualquier numero): FAIL-CLOSED, no se escribe. Devuelve {ok, siguiente} o {ok:false, invalidas:[decisionId...]} (el detalle va solo al log).
function ubicacionFuenteDecisionesService_siguienteSecuencia(filas, campoId) {
  var campo = campoId || 'decisionId';
  var max = 0;
  var invalidas = [];
  filas.forEach(function (f) {
    var n = f.secuencia;
    if (typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1 && n <= 9007199254740990) {
      if (n > max) {
        max = n;
      }
    } else {
      invalidas.push(f[campo] || '(sin ' + campo + ')');
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
  // Los clientRequestId que empiezan con "sug-" los genera el SERVIDOR al aprobar una sugerencia (UbicacionFuenteSugerenciasService.js): ningun cliente puede usarlos.
  if (s.clientRequestId.indexOf(UFD_SVC_PREFIJO_ID_SUGERENCIA) === 0) {
    return ubicacionFuenteDecisionesService_error('INVALID_CLIENT_REQUEST_ID');
  }

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
    return ubicacionFuenteDecisionesService_aplicarDecision(emailN, nombre, s, filas, padron);
  });
}

// NUCLEO AUTORITATIVO COMPARTIDO: valida UNA decision contra el estado ACTUAL del pozo (dominio ufd_decidir), asigna decisionId / secuencia / fecha, escribe UNA fila,
// invalida el cache y arma la vista. Lo usan decidirFuenteUbicacion (ubicacionFuenteDecisionesService_decidir) y la APROBACION de una sugerencia
// (UbicacionFuenteSugerenciasService.js): hay una sola logica de decision. DEBE llamarse DENTRO de ubicacionFuenteDecisionesRepository_conLock, con `filas` (TODAS las filas
// de la hoja) y `padron` ya leidos DENTRO de ese lock. `s` es una solicitud ya validada por ubicacionFuenteDecisionesService_validarSolicitud.
// {ok:true, duplicada:false, decision, evento, auditoria, data} | {ok:false, code, message, ...}
function ubicacionFuenteDecisionesService_aplicarDecision(emailN, nombre, s, filas, padron) {
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
  var nuevo;
  try {
    nuevo = ubicacionFuenteDecisionesService_calcular(s.wellId, padron.fuentes, filas.concat([fila]));
  } catch (err) {
    ubicacionFuenteDecisionesService_invalidarDelta();         // no se pudo comparar antes/despues: por las dudas el delta se recalcula
    throw err;
  }
  // El delta registral solo cambia si cambio el punto operativo REGISTRAL de este pozo (mismo estado y mismas coordenadas = nada que invalidar). Aprobar una sugerencia
  // llega por aca (aplicarDecision es el nucleo compartido); crear, rechazar o cancelar una sugerencia no escribe decisiones y nunca pasa por aca.
  if (!ubicacionFuenteDecisionesService_mismoPunto(
    ubicacionFuenteDecisionesService_puntoOperativoRegistral(calculo.resolucion), ubicacionFuenteDecisionesService_puntoOperativoRegistral(nuevo.resolucion))) {
    ubicacionFuenteDecisionesService_invalidarDelta();
  }
  return { ok: true, duplicada: false, decision: ubicacionFuenteDecisionesService_itemDecision(fila), evento: fila.evento, auditoria: UFD_SVC_AUDITORIA[fila.evento], data: ubicacionFuenteDecisionesService_vista(s.wellId, nuevo, padron.periodo) };
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
    UFD_SVC_DELTA_CACHE_KEY,
    UFD_SVC_DELTA_INVAL_KEY,
    UFD_SVC_DELTA_CACHE_SEGUNDOS,
    UFD_SVC_DELTA_CACHE_MAX_CARACTERES,
    UFD_SVC_DELTA_POZO_PREFIJO,
    UFD_SVC_DELTA_POZO_SEGUNDOS,
    UFD_SVC_DELTA_PRESUPUESTO_MS,
    UFD_SVC_PREFIJO_ID_SUGERENCIA,
    UFD_SVC_ACCIONES,
    UFD_SVC_ERRORES_DOMINIO,
    ubicacionFuenteDecisionesService_validarSolicitud,
    ubicacionFuenteDecisionesService_aplicarDecision,
    ubicacionFuenteDecisionesService_itemDecision,
    ubicacionFuenteDecisionesService_padron,
    ubicacionFuenteDecisionesService_calcular,
    ubicacionFuenteDecisionesService_siguienteSecuencia,
    ubicacionFuenteDecisionesService_getPorPozo,
    ubicacionFuenteDecisionesService_decidir,
    ubicacionFuenteDecisionesService_invalidar,
    ubicacionFuenteDecisionesService_invalidarDelta,
    ubicacionFuenteDecisionesService_getDelta,
    ubicacionFuenteDecisionesService_entradaDelta,
    ubicacionFuenteDecisionesService_puntoOperativoRegistral,
    ubicacionFuenteDecisionesService_periodoActual,
    ubicacionFuenteDecisionesService_padronActual,
    ubicacionFuenteDecisionesService_padronParaDelta,
    ubicacionFuenteDecisionesService_evaluarPozoDelta,
    ubicacionFuenteDecisionesService_mismoPunto,
    ubicacionFuenteDecisionesService_diagnosticar,
    diagnosticarUbicacionFuenteDecisiones
  };
}
