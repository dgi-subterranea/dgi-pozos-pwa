// Etapa "seleccion multiple + lote": resuelve, para un lote de wellId,
// cuales tienen ITF disponible - SIN leer cada imagen (serian N lecturas
// de Drive por lote) y SIN recorrer la carpeta THUMB entera en cada
// request (puede tener miles de archivos). Unico consumidor:
// handleGetItfAvailability en Api.js.
//
// Indice cacheado POR DEPARTAMENTO (01..19) en CacheService (NUNCA
// PropertiesService - ese esta pensado para secretos/config chica, no
// para un indice que puede pesar varios KB). Cada bucket guarda SOLO el
// PPPP (4 digitos) de los wellId con archivo - un departamento con 2000
// pozos pesa unos pocos KB, muy por debajo del limite de 100KB/valor de
// CacheService (medido en backend/test/ItfAvailabilityService.test.js,
// "cache real" - ver tambien el reporte de la etapa).
//
// 1 hora de TTL: el contenido de THUMB se sube a mano (ver
// reindex_mapa.py y comentarios de .gitignore), cambia con poca
// frecuencia - no hace falta recalcular en cada request.
var ITF_INDEX_CACHE_SECONDS = 3600;
var ITF_INDEX_CACHE_PREFIX = 'itf_idx_';

function itfAvailabilityService_departamentosValidos() {
  var deptos = [];
  for (var d = 1; d <= 19; d++) {
    deptos.push(('0' + d).slice(-2));
  }
  return deptos;
}

function itfAvailabilityService_deptosDeWellIds(wellIds) {
  var set = {};
  wellIds.forEach(function (wellId) { set[wellId.substring(0, 2)] = true; });
  return Object.keys(set);
}

// Construye/reconstruye el indice completo (los 19 departamentos juntos,
// en UNA sola pasada por Drive) y lo escribe en CacheService.
function itfAvailabilityService_reconstruirIndice() {
  var cache = CacheService.getScriptCache();
  var deptos = itfAvailabilityService_departamentosValidos();
  var buckets = {};
  deptos.forEach(function (d) { buckets[d] = []; });

  var nombres = driveProfileRepository_listarArchivosThumb();
  var patron = /^(\d{2})-(\d{4})\.jpg$/i;
  nombres.forEach(function (nombre) {
    var match = patron.exec(nombre);
    if (!match) {
      return; // archivo que no sigue la convencion DD-PPPP.jpg - se ignora, nunca rompe el indice
    }
    var depto = match[1];
    if (buckets[depto]) {
      buckets[depto].push(match[2]);
    }
  });

  deptos.forEach(function (d) {
    cache.put(ITF_INDEX_CACHE_PREFIX + d, JSON.stringify(buckets[d]), ITF_INDEX_CACHE_SECONDS);
  });
  return buckets;
}

// Se asegura de que los departamentos pedidos esten en cache - NUNCA
// asume que faltar un bucket puntual significa "sin archivos": eso seria
// tratar una expulsion de CacheService (bajo presion de memoria, puede
// expulsar UNA entrada sin tocar las demas) como si fuera informacion
// real de Drive, exactamente lo que NO hay que hacer (la fuente de
// verdad sigue siendo Drive). Si CUALQUIERA de los departamentos
// necesarios no esta en cache, se reconstruye TODO el indice de nuevo
// (una pasada mas por Drive, nunca por wellId individual) - mas simple y
// mas seguro que reconstruir partes sueltas, y sigue siendo barato
// porque pasa poquisimas veces (CacheService normalmente no expulsa
// entradas de pocos KB salvo presion real de memoria).
function itfAvailabilityService_asegurarIndice(deptosNecesarios) {
  var cache = CacheService.getScriptCache();
  var deptos = deptosNecesarios && deptosNecesarios.length > 0
    ? deptosNecesarios
    : itfAvailabilityService_departamentosValidos();

  var faltaAlguno = deptos.some(function (d) {
    return cache.get(ITF_INDEX_CACHE_PREFIX + d) === null;
  });
  if (!faltaAlguno) {
    return;
  }
  itfAvailabilityService_reconstruirIndice();
}

// Devuelve SOLO {wellId: boolean} - nunca ids ni URLs de Drive (ver
// handleGetItfAvailability en Api.js). Usa el indice cacheado de arriba,
// nunca una busqueda por nombre individual por wellId. Si un bucket
// sigue sin aparecer en cache DESPUES de asegurarIndice (caso limite:
// CacheService lo volvio a expulsar en el instante entre un call y el
// otro), se trata como "sin archivos" SOLO como ultimo recurso - nunca
// como primera respuesta, y nunca sin haber intentado reconstruir antes.
function itfAvailabilityService_checkDisponibilidad(wellIds) {
  if (!wellIds || wellIds.length === 0) {
    return {};
  }
  var deptosNecesarios = itfAvailabilityService_deptosDeWellIds(wellIds);
  itfAvailabilityService_asegurarIndice(deptosNecesarios);

  var cache = CacheService.getScriptCache();
  var bucketsPorDepto = {};
  var resultado = {};

  wellIds.forEach(function (wellId) {
    var depto = wellId.substring(0, 2);
    var pppp = wellId.substring(3);
    if (!(depto in bucketsPorDepto)) {
      var raw = cache.get(ITF_INDEX_CACHE_PREFIX + depto);
      bucketsPorDepto[depto] = raw ? JSON.parse(raw) : [];
    }
    resultado[wellId] = bucketsPorDepto[depto].indexOf(pppp) !== -1;
  });

  return resultado;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    itfAvailabilityService_departamentosValidos,
    itfAvailabilityService_deptosDeWellIds,
    itfAvailabilityService_reconstruirIndice,
    itfAvailabilityService_asegurarIndice,
    itfAvailabilityService_checkDisponibilidad
  };
}
