// MapaService: logica de negocio sobre el dataset general del Mapa de
// Pozos. La sanitizacion de campos aca es ESTRUCTURAL, no condicional -
// igual que registryService_sanitizarUbicacionParaDatos: aunque
// scripts/reindex_mapa.py ya solo escribe wellId/lat/lon/estado en
// pozos.json, esta funcion vuelve a armar cada punto explicitando esos 4
// campos y nada mas, para que una edicion futura del archivo (a mano, o
// un indexador con un bug) nunca pueda filtrar un campo sensible sin que
// tambien haya que romper este mapeo explicito.
//
// En particular, el dataset general NUNCA lleva un flag "ne": un usuario
// con ubicacion=SI, ne=NO no debe poder inferir que pozos pertenecen a la
// red de Niveles Estaticos inspeccionando el JSON (ver adjustment #1 de
// la Etapa 5B/5C). Una futura capa de mapa para la red NE seria un
// dataset/endpoint completamente aparte, gateado por el permiso "ne", con
// sus propias coordenadas - nunca mezclado con este.
function mapaService_sanitizarPunto(punto) {
  return {
    wellId: punto.wellId,
    lat: punto.lat,
    lon: punto.lon,
    estado: punto.estado
  };
}

function mapaService_getPozos() {
  var result = mapaRepository_getPozos();
  if (!result.found) {
    return { found: false };
  }

  var metadataCruda = mapaRepository_getMetadata();
  var metadata = metadataCruda ? {
    generadoEl: metadataCruda.generadoEl,
    totalPuntos: metadataCruda.totalPuntos
  } : null;

  return {
    found: true,
    pozos: result.pozos.map(mapaService_sanitizarPunto),
    metadata: metadata
  };
}

// Indice de busqueda por titular + NC16 (Etapa 1A) - dataset SEPARADO de
// mapaService_getPozos a proposito: titular Y nc16 requieren "datos",
// nunca "ubicacion" (mismo criterio de separacion que Niveles Estaticos
// con "ne" - ver adjustment #1 de la Etapa 5B/5C, aplicado ahora tambien
// a busqueda). NC16 vive junto a titular a proposito (decision explicita
// aprobada, no un descuido): una nomenclatura catastral identifica una
// PARCELA fisica - combinada con el catastro publico provincial permite
// ubicar la propiedad exacta, igual de sensible que el titular, mas
// cercana conceptualmente a "domicilio" que a un wellId (que es un id
// interno arbitrario sin correlato externo). Sanitizacion ESTRUCTURAL,
// igual que mapaService_sanitizarPunto: se reconstruye el punto campo por
// campo para que un campo nuevo que se agregue a pozos_busqueda.json en
// el futuro no se filtre por default.
function mapaService_sanitizarPuntoBusqueda(punto) {
  return {
    wellId: punto.wellId,
    nc16: punto.nc16 !== undefined ? punto.nc16 : null,
    titular: punto.titular !== undefined ? punto.titular : null
  };
}

function mapaService_getIndiceBusqueda() {
  var result = mapaRepository_getPozosBusqueda();
  if (!result.found) {
    return { found: false };
  }
  return {
    found: true,
    pozos: result.pozos.map(mapaService_sanitizarPuntoBusqueda)
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaService_getPozos, mapaService_sanitizarPunto, mapaService_getIndiceBusqueda, mapaService_sanitizarPuntoBusqueda };
}
