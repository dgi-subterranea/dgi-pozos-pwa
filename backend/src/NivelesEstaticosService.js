// NivelesEstaticosService: logica de negocio pura sobre la Red de
// Niveles Estaticos. El indexador (scripts/reindex_niveles_estaticos.py)
// ya normalizo "sin dato" a null campo por campo - aca solo se limpia
// esa respuesta antes de mandarla por la red, igual que RegistryService.
function nivelesEstaticosService_getPunto(monitoringId) {
  var result = nivelesEstaticosRepository_getPunto(monitoringId);
  if (!result.found) {
    return { found: false };
  }
  return { found: true, punto: nivelesEstaticosService_cleanPunto(result.punto) };
}

// Copia deliberada de la misma logica que registryService_cleanRecord:
// ambos modulos son independientes a proposito (la red NE tiene vida
// propia, no depende del padron - ver NivelesEstaticosRepository.js), no
// vale la pena acoplarlos por una funcion generica de 15 lineas.
function nivelesEstaticosService_cleanPunto(value) {
  if (Array.isArray(value)) {
    return value.map(nivelesEstaticosService_cleanPunto);
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
      cleaned[key] = nivelesEstaticosService_cleanPunto(v);
    }
    return cleaned;
  }
  return value;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { nivelesEstaticosService_getPunto, nivelesEstaticosService_cleanPunto };
}
