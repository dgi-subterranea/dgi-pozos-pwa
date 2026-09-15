// Unica funcion que sabe que el Mapa de Pozos vive en Drive como un unico
// pozos.json + metadata.json (generados por scripts/reindex_mapa.py a
// partir de la salida ya indexada del padron). Mismo patron que
// NivelesEstaticosRepository.js: recurso independiente, un solo archivo,
// no particionado por departamento (13-14 mil puntos, no 24000+).
//
// A diferencia de RegistryRepository/NivelesEstaticosRepository, aca NO
// se cachea nada en CacheService: pozos.json pesa ~900KB (medido, ver
// Etapa 5C-1), muy por encima del limite de 100KB por valor, y a
// diferencia de un registro individual no hay una clave mas chica que
// cachear en su lugar (el mapa se sirve entero de una). La estrategia de
// evitar refetches repetidos queda para el lado del frontend (Cache
// Storage del service worker) en una etapa futura - explicitamente fuera
// de alcance de 5C-1.
function mapaRepository_getPozos() {
  var folder = DriveApp.getFolderById(getMapaFolderId());
  var files = folder.getFilesByName('pozos.json');
  if (!files.hasNext()) {
    return { found: false };
  }
  var file = files.next();
  var pozos = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  return { found: true, pozos: pozos };
}

// metadata.json es chico (fecha de generacion + conteos) y cambia solo
// cuando se re-corre el indexador - se cachea entero, mismo criterio que
// registryRepository_getMetadata.
var MAPA_METADATA_CACHE_SECONDS = 600;

function mapaRepository_getMetadata() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'mapa_metadata';

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached);
  }

  var folder = DriveApp.getFolderById(getMapaFolderId());
  var files = folder.getFilesByName('metadata.json');
  if (!files.hasNext()) {
    return null;
  }

  var metadata = JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
  cache.put(cacheKey, JSON.stringify(metadata), MAPA_METADATA_CACHE_SECONDS);
  return metadata;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaRepository_getPozos, mapaRepository_getMetadata };
}
