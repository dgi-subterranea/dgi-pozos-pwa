// Unica funcion que sabe que la Ficha del Pozo vive en Drive como un JSON
// por departamento (01.json..19.json, generados por
// scripts/reindex_pozos.py a partir del Reporte de Pozos). Si el dia de
// manana cambia el mecanismo, se cambia solo aca - RegistryService y el
// frontend no se enteran.
//
// Departamentos grandes se parten en 10 archivos por el primer digito de
// PPPP (DD-0.json..DD-9.json) - medido contra Drive real: leer el JSON
// completo de un departamento de ~7-8MB (07, 08) tarda 3.5-4.7s en frio
// contra ~0.6-0.7s para uno chico o vacio (el cuello de botella es
// getBlob().getDataAsString(), no JSON.parse). Esta lista tiene que
// coincidir a mano con metadata.departamentosParticionados de la ultima
// corrida de scripts/reindex_pozos.py - el backend NO lee ningun indice
// para decidir el nombre de archivo (seria otro viaje a Drive en cada
// busqueda), asi que si la lista cambia en el indexador hay que
// actualizarla aca tambien antes de subir los archivos nuevos.
var PARTITIONED_DEPARTMENTS = { '07': true, '08': true };

// El registro individual ya resuelto se cachea por wellId (CacheService
// tiene un limite de 100KB por valor - muy por debajo de un registro
// individual, pero un archivo de departamento/particion entero no entra
// ahi para los departamentos grandes, asi que NO se cachea el archivo
// completo). La primera busqueda de un wellId en un archivo dado sigue
// pagando el costo completo de abrir+leer+parsear ese archivo; busquedas
// siguientes del MISMO wellId son rapidas mientras dure el cache.
var REGISTRY_CACHE_SECONDS = 600;

function registryRepository_resolveFileName(wellId) {
  var departmentCode = wellId.substring(0, 2);
  if (PARTITIONED_DEPARTMENTS[departmentCode]) {
    var primerDigitoPozo = wellId.charAt(3);
    return departmentCode + '-' + primerDigitoPozo + '.json';
  }
  return departmentCode + '.json';
}

function registryRepository_getWellRecord(wellId) {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'registry_' + wellId;

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return cached === 'null' ? { found: false } : { found: true, record: JSON.parse(cached) };
  }

  var fileName = registryRepository_resolveFileName(wellId);
  var folder = DriveApp.getFolderById(getRegistryFolderId());
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    return { found: false };
  }

  var file = files.next();
  var fileData = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
  var record = fileData[wellId] || null;

  cache.put(cacheKey, record ? JSON.stringify(record) : 'null', REGISTRY_CACHE_SECONDS);

  return record ? { found: true, record: record } : { found: false };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registryRepository_getWellRecord, registryRepository_resolveFileName };
}
