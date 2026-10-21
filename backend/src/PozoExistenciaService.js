// "¿Este pozo existe para la aplicacion?" - UNICO lugar que lo decide (E4). Lo usan, y nadie mas, dos puntos: el snapshot de Irrigacion al proponer una ubicacion
// (ubicacionCorreccionService_snapshotIrrigacion) y la vista de ubicacion de un pozo fuera del padron (handleGetWellLocation). Ningun endpoint hace sus propios lookups.
//
// Un pozo "existe" si alguna fuente institucional ya lo conoce. Fuentes validas (v1), en este orden, y se corta en la PRIMERA que confirma:
//   1. PADRON            registryService_getWellLocation: el padron actual (si esta aca, el pozo NO esta "fuera del padron").
//   2. ITF               <wellId>.jpg en la carpeta ITF de Drive (driveProfileRepository_existe: solo existencia, no se descarga el archivo; es lo mismo que muestra el Perfil).
//   3. NE                nivelesEstaticosRepository_getPunto(wellId): solo prueba existencia; su coordenada NO es una ubicacion registral y no se usa.
//   4. CORRECCION_PREVIA cualquier fila del pozo en UbicacionCorrecciones, en cualquier estado: si una primera ubicacion se creo validamente cuando existia ITF/NE y esa fuente
//                        desaparece despues, las correcciones siguientes no pueden quedar bloqueadas.
// NO prueban existencia (y no se usan): Fotos, evaluaciones de reemplazo, historial de Busquedas. Ninguna se valida contra el padron y cualquiera de ellas se puede generar
// con un wellId de formato valido (circulares).
//
// FAIL-CLOSED. El resultado nunca afirma lo que no se pudo comprobar:
//   - alguna fuente confirma                              -> existe:true (las fuentes siguientes ni se consultan, aunque fallarian).
//   - todas responden "no"                                -> existe:false, indeterminado:false (quien llama dice "no existe": WELL_NOT_FOUND).
//   - ninguna confirma y alguna NO se pudo verificar      -> existe:false, indeterminado:true  (quien llama dice SERVICE_UNAVAILABLE). Un error de Drive o de la hoja jamas se vuelve "no existe".
//   - el PADRON no se puede consultar                     -> indeterminado:true de inmediato. Sin saber si esta en el padron no se puede afirmar `enPadron:false`, y eso define el snapshot
//                                                            (con coordenada del padron, sin coordenada, o fuera del padron): no se adivina con otra fuente.
//   - una funcion de lectura que no existe cuenta como fuente no verificable (nunca se supone una respuesta).
// Detalle tecnico de cada falla: Logger (con el wellId, sin ningun dato personal).
//
// CACHE: SOLO los positivos de las fuentes que NO son el padron (el padron ya tiene su cache y de el sale la ubicacion), por pozo, ~10 minutos. Nunca se cachea un negativo ni un
// indeterminado. Si CacheService falla, la verificacion sigue sin cache.
//
// Resultado: {existe, enPadron, fuentes, indeterminado, noVerificadas, location?}. `location` (la vista de ubicacion del padron) solo viene si enPadron. Es de USO INTERNO: no se
// devuelve tal cual al cliente.
var POZO_EXISTENCIA_FUENTES = { PADRON: 'PADRON', ITF: 'ITF', NE: 'NE', CORRECCION_PREVIA: 'CORRECCION_PREVIA' };
var POZO_EXISTENCIA_CACHE_PREFIJO = 'pozo_existe_v1_';
var POZO_EXISTENCIA_CACHE_SEGUNDOS = 600;
var POZO_EXISTENCIA_WELL_ID_REGEX = /^\d{2}-\d{4}$/;

function pozoExistenciaService_log(mensaje) {
  if (typeof Logger !== 'undefined' && Logger && typeof Logger.log === 'function') {
    Logger.log('Existencia de pozo: ' + mensaje);
  }
}

// Mismo criterio que validateSessionAndWellId (Api.js): DD-PPPP y departamento 01..19. No amplia el universo de ids aceptados.
function pozoExistenciaService_wellIdValido(wellId) {
  if (typeof wellId !== 'string' || !POZO_EXISTENCIA_WELL_ID_REGEX.test(wellId)) {
    return false;
  }
  var depto = parseInt(wellId.substring(0, 2), 10);
  return depto >= 1 && depto <= 19;
}

function pozoExistenciaService_resultado(existe, enPadron, fuentes, indeterminado, noVerificadas) {
  return { existe: existe, enPadron: enPadron, fuentes: fuentes, indeterminado: indeterminado, noVerificadas: noVerificadas };
}

function pozoExistenciaService_cache() {
  try {
    return CacheService.getScriptCache();
  } catch (err) {
    pozoExistenciaService_log('CacheService no disponible: ' + String(err));
    return null;
  }
}

// ['ITF'] si hay un positivo cacheado y valido; null si no hay o no sirve. Nunca lanza.
function pozoExistenciaService_leerCache(wellId) {
  var cache = pozoExistenciaService_cache();
  if (!cache) {
    return null;
  }
  try {
    var crudo = cache.get(POZO_EXISTENCIA_CACHE_PREFIJO + wellId);
    if (crudo === null || crudo === undefined) {
      return null;
    }
    var lista = JSON.parse(crudo);
    var validas = Array.isArray(lista) && lista.length > 0 && lista.every(function (f) { return f === 'ITF' || f === 'NE' || f === 'CORRECCION_PREVIA'; });
    return validas ? lista : null;
  } catch (err) {
    pozoExistenciaService_log('cache ilegible para ' + wellId + ', se verifica de nuevo: ' + String(err));
    return null;
  }
}

function pozoExistenciaService_guardarCache(wellId, fuentes) {
  var cache = pozoExistenciaService_cache();
  if (!cache) {
    return;
  }
  try {
    cache.put(POZO_EXISTENCIA_CACHE_PREFIJO + wellId, JSON.stringify(fuentes), POZO_EXISTENCIA_CACHE_SEGUNDOS);
  } catch (err) {
    pozoExistenciaService_log('no se pudo guardar el cache de ' + wellId + ': ' + String(err));
  }
}

// --- Las fuentes que no son el padron: cada una devuelve true / false o LANZA (= no se pudo verificar) ---

function pozoExistenciaService_porItf(wellId) {
  if (typeof driveProfileRepository_existe !== 'function') {
    throw new Error('driveProfileRepository_existe no disponible');
  }
  return driveProfileRepository_existe(wellId) === true;
}

function pozoExistenciaService_porNe(wellId) {
  if (typeof nivelesEstaticosRepository_getPunto !== 'function') {
    throw new Error('nivelesEstaticosRepository_getPunto no disponible');
  }
  var r = nivelesEstaticosRepository_getPunto(wellId);
  return !!r && r.found === true;
}

function pozoExistenciaService_porCorreccionPrevia(wellId) {
  if (typeof ubicacionCorreccionRepository_listarCorrecciones !== 'function') {
    throw new Error('ubicacionCorreccionRepository_listarCorrecciones no disponible');
  }
  return ubicacionCorreccionRepository_listarCorrecciones().some(function (c) { return c && c.wellId === wellId; });
}

// opciones.padron (opcional): el resultado de registryService_getWellLocation que quien llama YA obtuvo ({found, location}); evita consultar el padron dos veces.
function pozoExistenciaService_verificar(wellId, opciones) {
  if (!pozoExistenciaService_wellIdValido(wellId)) {
    return pozoExistenciaService_resultado(false, false, [], false, []);
  }

  // 1. PADRON
  var padron = opciones && opciones.padron;
  if (!padron) {
    try {
      padron = registryService_getWellLocation(wellId);
    } catch (err) {
      pozoExistenciaService_log('el padron no se pudo consultar para ' + wellId + ': ' + String(err));
      return pozoExistenciaService_resultado(false, false, [], true, [POZO_EXISTENCIA_FUENTES.PADRON]);
    }
  }
  if (padron && padron.found) {
    var enPadron = pozoExistenciaService_resultado(true, true, [POZO_EXISTENCIA_FUENTES.PADRON], false, []);
    enPadron.location = padron.location;
    return enPadron;
  }

  // positivo cacheado de las demas fuentes
  var cacheadas = pozoExistenciaService_leerCache(wellId);
  if (cacheadas) {
    return pozoExistenciaService_resultado(true, false, cacheadas, false, []);
  }

  // 2..4 en orden; se corta en la primera que confirma
  var consultas = [
    [POZO_EXISTENCIA_FUENTES.ITF, pozoExistenciaService_porItf],
    [POZO_EXISTENCIA_FUENTES.NE, pozoExistenciaService_porNe],
    [POZO_EXISTENCIA_FUENTES.CORRECCION_PREVIA, pozoExistenciaService_porCorreccionPrevia]
  ];
  var noVerificadas = [];
  for (var i = 0; i < consultas.length; i++) {
    var nombre = consultas[i][0];
    var confirma;
    try {
      confirma = consultas[i][1](wellId);
    } catch (err) {
      noVerificadas.push(nombre);
      pozoExistenciaService_log(nombre + ' no se pudo verificar para ' + wellId + ': ' + String(err));
      continue;
    }
    if (confirma === true) {
      pozoExistenciaService_guardarCache(wellId, [nombre]);
      return pozoExistenciaService_resultado(true, false, [nombre], false, noVerificadas);
    }
  }
  return pozoExistenciaService_resultado(false, false, [], noVerificadas.length > 0, noVerificadas);
}

// Vista de ubicacion MINIMA de un pozo que existe pero no esta en el padron (la que devuelve getWellLocation en ese caso): sin ninguna coordenada y sin ficha registral. El estado
// `noEnPadron` es distinto de `sinCoordenadas` (que es "esta en el padron pero sin coordenada").
function pozoExistenciaService_ubicacionFueraDelPadron(wellId) {
  return { wellId: wellId, coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'noEnPadron' } };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    POZO_EXISTENCIA_FUENTES,
    POZO_EXISTENCIA_CACHE_PREFIJO,
    POZO_EXISTENCIA_CACHE_SEGUNDOS,
    pozoExistenciaService_wellIdValido,
    pozoExistenciaService_verificar,
    pozoExistenciaService_ubicacionFueraDelPadron
  };
}
