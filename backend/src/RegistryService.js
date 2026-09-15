// RegistryService: logica de negocio pura sobre la Ficha del Pozo. El
// indexador (scripts/reindex_pozos.py) ya normalizo "sin dato" a null
// campo por campo - aca solo se limpia esa respuesta antes de mandarla
// por la red, para no llenar el payload de claves en null.
//
// Campos geograficos de ubicacion (coordenadas/coordenadasProvincia/
// ubicacionResuelta) NUNCA viajan en getWellRecord, sin importar
// permisos: ese dato pertenece al modulo Ubicacion, que tiene su propia
// API (registryService_getWellLocation, requiere el permiso "ubicacion")
// y su propio endpoint (getWellLocation). No es un filtro condicional -
// es estructural, para que no dependa de que ningun chequeo de permiso
// se aplique correctamente en el lugar correcto. domicilioPozo/planoDgi/
// planoCatastro si son parte de Datos (no son geograficos) y se
// conservan.
var REGISTRY_CAMPOS_GEOGRAFICOS = ['coordenadas', 'coordenadasProvincia', 'ubicacionResuelta'];

function registryService_sanitizarUbicacionParaDatos(record) {
  if (!record.ubicacion) {
    return record;
  }
  var ubicacionSinGeo = {};
  for (var key in record.ubicacion) {
    if (Object.prototype.hasOwnProperty.call(record.ubicacion, key) && REGISTRY_CAMPOS_GEOGRAFICOS.indexOf(key) === -1) {
      ubicacionSinGeo[key] = record.ubicacion[key];
    }
  }
  var sanitized = {};
  for (var k in record) {
    if (Object.prototype.hasOwnProperty.call(record, k)) {
      sanitized[k] = k === 'ubicacion' ? ubicacionSinGeo : record[k];
    }
  }
  return sanitized;
}

function registryService_getWellRecord(wellId) {
  var result = registryRepository_getWellRecord(wellId);
  if (!result.found) {
    return { found: false };
  }
  var sinGeo = registryService_sanitizarUbicacionParaDatos(result.record);
  return { found: true, record: registryService_cleanRecord(sinGeo) };
}

// Modulo Ubicacion: API independiente sobre el MISMO registro (mismo
// archivo, mismo cache por wellId en registryRepository_getWellRecord -
// no hay una segunda lectura de Drive), pero devuelve solo lo
// geografico, plano, sin el resto de la ficha registral. Un usuario con
// datos=NO / ubicacion=SI nunca recibe titular/domicilio/tecnicas por
// esta via.
function registryService_getWellLocation(wellId) {
  var result = registryRepository_getWellRecord(wellId);
  if (!result.found) {
    return { found: false };
  }
  var ubicacion = result.record.ubicacion || {};
  var location = {
    wellId: result.record.wellId,
    coordenadas: ubicacion.coordenadas !== undefined ? ubicacion.coordenadas : null,
    coordenadasProvincia: ubicacion.coordenadasProvincia !== undefined ? ubicacion.coordenadasProvincia : [],
    ubicacionResuelta: ubicacion.ubicacionResuelta !== undefined ? ubicacion.ubicacionResuelta : null
  };
  return { found: true, location: registryService_cleanRecord(location) };
}

// Popup liviano del Mapa de Pozos (getWellSummary): reutiliza el MISMO
// repositorio y cache por wellId que getWellRecord (no es una lectura
// nueva de Drive), pero devuelve solo 4 campos - nunca la ficha completa
// ni coordenadas. Estructural, igual que
// registryService_sanitizarUbicacionParaDatos: arma el objeto de salida
// campo por campo en vez de recortar el registro completo, para que
// agregar un campo nuevo a la ficha en el futuro nunca lo filtre aca sin
// una decision explicita.
function registryService_getWellSummary(wellId) {
  var result = registryRepository_getWellRecord(wellId);
  if (!result.found) {
    return { found: false };
  }
  var record = result.record;
  var identificacion = record.identificacion || {};
  var titularidad = record.titularidad || {};
  return {
    found: true,
    summary: {
      wellId: record.wellId,
      titular: titularidad.titular !== undefined ? titularidad.titular : null,
      departamento: identificacion.departamento !== undefined ? identificacion.departamento : null,
      distrito: identificacion.distrito !== undefined ? identificacion.distrito : null
    }
  };
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

// Solo expone lo que el frontend necesita para el caption "Padron: mes
// anio" (ver metadata.json) - no todo el objeto crudo (conteos por
// departamento, etc. son un detalle interno del indexador).
function registryService_getMetadata() {
  var metadata = registryRepository_getMetadata();
  if (!metadata) {
    return { found: false };
  }
  return {
    found: true,
    metadata: {
      generadoEl: metadata.generadoEl,
      periodo: metadata.fuente ? metadata.fuente.periodo : null
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    registryService_getWellRecord,
    registryService_getWellLocation,
    registryService_getWellSummary,
    registryService_cleanRecord,
    registryService_sanitizarUbicacionParaDatos,
    registryService_getMetadata
  };
}
