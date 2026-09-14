// Unica funcion que sabe que la Red de Niveles Estaticos vive en Drive
// como un unico nivelesEstaticos.json (generado por
// scripts/reindex_niveles_estaticos.py). Recurso independiente del
// padron: la clave es monitoringId, que coincide con wellId solo cuando
// el punto es un pozo registrado - un punto especial (INA/RTR/Puesto)
// tiene monitoringId pero nunca wellId.
//
// A diferencia de RegistryRepository, aca NO se particiona por
// departamento (la red completa son ~460 puntos, no 24000+ pozos) pero
// TAMPOCO se cachea el archivo entero: nivelesEstaticos.json pesa ~680KB
// (medido, ver Etapa 1), muy por encima del limite de 100KB por valor de
// CacheService - por eso se cachea el PUNTO ya resuelto, igual que
// RegistryRepository cachea el registro individual y no el archivo de
// departamento completo.
var NIVELES_ESTATICOS_CACHE_SECONDS = 600;

function nivelesEstaticosRepository_getPunto(monitoringId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'ne_punto_' + monitoringId;

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return cached === 'null' ? { found: false } : { found: true, punto: JSON.parse(cached) };
  }

  var folder = DriveApp.getFolderById(getNivelesEstaticosFolderId());
  var files = folder.getFilesByName('nivelesEstaticos.json');
  if (!files.hasNext()) {
    return { found: false };
  }

  var file = files.next();
  var data = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  var punto = (data.puntos && data.puntos[monitoringId]) || null;

  cache.put(cacheKey, punto ? JSON.stringify(punto) : 'null', NIVELES_ESTATICOS_CACHE_SECONDS);

  return punto ? { found: true, punto: punto } : { found: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nivelesEstaticosRepository_getPunto };
}
