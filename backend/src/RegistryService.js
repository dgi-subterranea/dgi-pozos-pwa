// RegistryService: logica de negocio pura sobre la Ficha del Pozo. El
// indexador (scripts/reindex_pozos.py) ya normalizo "sin dato" a null
// campo por campo - aca solo se limpia esa respuesta antes de mandarla
// por la red, para no llenar el payload de claves en null.
function registryService_getWellRecord(wellId) {
  var result = registryRepository_getWellRecord(wellId);
  if (!result.found) {
    return { found: false };
  }
  return { found: true, record: registryService_cleanRecord(result.record) };
}

// Quita recursivamente las claves con valor null de objetos y limpia cada
// elemento de los arrays (ej. laboratorio.analisis[]). No toca arrays u
// objetos vacios en si mismos (un array vacio, como analisis:[] cuando no
// hay laboratorio cargado, es un dato real - "no hay" - no "sin dato").
function registryService_cleanRecord(value) {
  if (Array.isArray(value)) {
    return value.map(registryService_cleanRecord);
  }
  if (value !== null && typeof value === 'object') {
    var cleaned = {};
    for (var key in value) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) {
        continue;
      }
      var v = value[key];
      if (v === null) {
        continue;
      }
      cleaned[key] = registryService_cleanRecord(v);
    }
    return cleaned;
  }
  return value;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { registryService_getWellRecord, registryService_cleanRecord };
}
