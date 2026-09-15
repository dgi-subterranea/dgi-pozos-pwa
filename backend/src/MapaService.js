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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaService_getPozos, mapaService_sanitizarPunto };
}
