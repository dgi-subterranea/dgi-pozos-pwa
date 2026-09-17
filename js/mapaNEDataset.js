// Cache del dataset de getMapaNE - mismo patron que js/mapaDataset.js
// (getMapaPozos), pero SEPARADO a proposito: son 2 datasets distintos
// con 2 permisos distintos (ubicacion vs ne), nunca deben compartir
// cache ni mezclarse en memoria. Solo js/mapa.js lo usa (el chip
// "Niveles estáticos" vive unicamente en el Mapa, no en Cerca Mio - ver
// v2.1.0). No persiste entre recargas de pagina (memoria de sesion nada
// mas, mismo criterio que mapaDataset.js).
var mapaNEDatasetEstado = { puntos: null, promise: null };

function mapaNEDataset_obtener(sessionToken) {
  if (mapaNEDatasetEstado.puntos) {
    return Promise.resolve({ status: 'ok', data: { puntos: mapaNEDatasetEstado.puntos } });
  }

  if (mapaNEDatasetEstado.promise) {
    return mapaNEDatasetEstado.promise;
  }

  mapaNEDatasetEstado.promise = apiGetMapaNE(sessionToken).then(function (result) {
    mapaNEDatasetEstado.promise = null;
    if (result.status === 'ok') {
      mapaNEDatasetEstado.puntos = result.data.puntos;
    }
    // Un error NUNCA se cachea - la proxima vez que se active el chip
    // vuelve a intentar el fetch en vez de quedar pegada a la falla.
    return result;
  }).catch(function (err) {
    mapaNEDatasetEstado.promise = null;
    throw err;
  });

  return mapaNEDatasetEstado.promise;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaNEDataset_obtener };
}
