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

// Lectura en LOTE de varias fichas (la usa el delta de decisiones registrales, que necesita el padron de muchos pozos a la vez). registryRepository_getWellRecord
// abre un archivo de departamento entero por cada pozo que no esta en cache; aca los pozos se agrupan por ARCHIVO y cada archivo se abre UNA sola vez por llamada
// (como mucho 37 archivos: 17 departamentos simples + 2 x 10 particiones). No cambia getWellRecord ni escribe en su cache (el producto cacheable del lote es el
// resultado ya resuelto, no la ficha entera).
//   wellIds   lista de wellId (se ignoran los repetidos y los que no sean texto)
//   opciones  {deadlineMs}: instante (Date.now()) a partir del cual no se abre ningun archivo nuevo; los pozos que quedan sin leer van a `noResueltos`
// salida: {registros: {wellId: ficha | null}, noResueltos: [wellId], archivosAbiertos, desdeCache, errores: [{archivo, detalle}]}
//   - registros[wellId] === null  -> el archivo se leyo (o no existe) y el pozo no esta: es una respuesta, NO un fallo.
//   - noResueltos                 -> no se pudo saber (se acabo el tiempo o fallo la lectura/parseo del archivo): el que llama NO debe inventar nada.
var REGISTRY_BATCH_CACHE_LOTE = 100;       // CacheService.getAll admite hasta 100 claves por llamada

function registryRepository_getWellRecordsBatch(wellIds, opciones) {
  var o = opciones || {};
  var limite = typeof o.deadlineMs === 'number' && isFinite(o.deadlineMs) ? o.deadlineMs : null;
  var salida = { registros: {}, noResueltos: [], archivosAbiertos: 0, desdeCache: 0, errores: [] };
  var vistos = {};
  var ids = [];
  (Array.isArray(wellIds) ? wellIds : []).forEach(function (id) {
    if (typeof id === 'string' && !Object.prototype.hasOwnProperty.call(vistos, id)) {
      vistos[id] = true;
      ids.push(id);
    }
  });

  var cache = null;
  try {
    cache = CacheService.getScriptCache();
  } catch (err) {
    cache = null;
  }
  var pendientes = [];
  for (var i = 0; i < ids.length; i += REGISTRY_BATCH_CACHE_LOTE) {
    var lote = ids.slice(i, i + REGISTRY_BATCH_CACHE_LOTE);
    var hallados = {};
    if (cache) {
      try {
        hallados = cache.getAll(lote.map(function (id) { return 'registry_' + id; })) || {};
      } catch (err) {
        hallados = {};
      }
    }
    lote.forEach(function (id) {
      var crudo = hallados['registry_' + id];
      if (crudo !== undefined && crudo !== null) {
        try {
          salida.registros[id] = crudo === 'null' ? null : JSON.parse(crudo);
          salida.desdeCache += 1;
          return;
        } catch (err) {
          // cache ilegible: se trata como si no estuviera
        }
      }
      pendientes.push(id);
    });
  }

  var porArchivo = {};
  pendientes.forEach(function (id) {
    var nombre = registryRepository_resolveFileName(id);
    (porArchivo[nombre] = porArchivo[nombre] || []).push(id);
  });
  var folder = null;
  Object.keys(porArchivo).sort().forEach(function (nombre) {
    var delArchivo = porArchivo[nombre];
    if (limite !== null && Date.now() >= limite) {
      delArchivo.forEach(function (id) { salida.noResueltos.push(id); });
      return;
    }
    try {
      if (folder === null) {
        folder = DriveApp.getFolderById(getRegistryFolderId());
      }
      var files = folder.getFilesByName(nombre);
      if (!files.hasNext()) {
        delArchivo.forEach(function (id) { salida.registros[id] = null; });
        return;
      }
      var datos = JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
      salida.archivosAbiertos += 1;
      delArchivo.forEach(function (id) {
        salida.registros[id] = Object.prototype.hasOwnProperty.call(datos, id) && datos[id] ? datos[id] : null;
      });
    } catch (err) {
      salida.errores.push({ archivo: nombre, detalle: String(err) });
      delArchivo.forEach(function (id) { salida.noResueltos.push(id); });
    }
  });
  return salida;
}

// metadata.json es chico (fecha de generacion + conteos) y cambia solo
// cuando se re-corre el indexador - se cachea entero, a diferencia de los
// archivos de departamento.
var REGISTRY_METADATA_CACHE_SECONDS = 600;

// Claves (wellId) de UN archivo de la ficha, para validaciones masivas (una lectura por archivo en vez de una por
// pozo; lo usa la importacion historica de fotos). {} si el archivo no existe.
function registryRepository_getWellIdsDeArchivo(fileName) {
  var files = DriveApp.getFolderById(getRegistryFolderId()).getFilesByName(fileName);
  if (!files.hasNext()) {
    return {};
  }
  var data = JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
  var ids = {};
  Object.keys(data).forEach(function (id) { ids[id] = true; });
  return ids;
}

function registryRepository_getMetadata() {
  var cache = CacheService.getScriptCache();
  var cacheKey = 'registry_metadata';

  var cached = cache.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached);
  }

  var folder = DriveApp.getFolderById(getRegistryFolderId());
  var files = folder.getFilesByName('metadata.json');
  if (!files.hasNext()) {
    return null;
  }

  var metadata = JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
  cache.put(cacheKey, JSON.stringify(metadata), REGISTRY_METADATA_CACHE_SECONDS);
  return metadata;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    registryRepository_getWellRecord,
    registryRepository_getWellRecordsBatch,
    registryRepository_resolveFileName,
    registryRepository_getWellIdsDeArchivo,
    registryRepository_getMetadata
  };
}
