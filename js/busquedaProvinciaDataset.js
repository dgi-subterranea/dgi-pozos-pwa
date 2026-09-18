// Cache del indice de busqueda por titular de Pozos Provincia
// (getIndiceBusquedaProvincia) - mismo patron que js/mapaNEDataset.js,
// pero SEPARADO de ese Y de js/mapaDataset.js: este indice requiere
// "datos" (nunca "ubicacion" ni "ne"), asi que tiene su propio cache -
// nunca debe compartirse ni mezclarse con los otros 2 datasets del mapa.
// Carga diferida real: solo se pide la PRIMERA VEZ que el usuario escribe
// algo en el buscador con intencion de buscar por titular (ver
// mapaController_buscar en js/mapa.js) - nunca al abrir el mapa, y nunca
// si el usuario solo busca por wellId. No persiste entre recargas de
// pagina (memoria de sesion nada mas, mismo criterio que los otros 2
// datasets del mapa).
var busquedaProvinciaDatasetEstado = { pozos: null, promise: null };

function busquedaProvinciaDataset_obtener(sessionToken) {
  if (busquedaProvinciaDatasetEstado.pozos) {
    return Promise.resolve({ status: 'ok', data: { pozos: busquedaProvinciaDatasetEstado.pozos } });
  }

  if (busquedaProvinciaDatasetEstado.promise) {
    return busquedaProvinciaDatasetEstado.promise;
  }

  busquedaProvinciaDatasetEstado.promise = apiGetIndiceBusquedaProvincia(sessionToken).then(function (result) {
    busquedaProvinciaDatasetEstado.promise = null;
    if (result.status === 'ok') {
      busquedaProvinciaDatasetEstado.pozos = result.data.pozos;
    }
    // Un error NUNCA se cachea - la proxima busqueda por titular vuelve
    // a intentar el fetch en vez de quedar pegada a la falla.
    return result;
  }).catch(function (err) {
    busquedaProvinciaDatasetEstado.promise = null;
    throw err;
  });

  return busquedaProvinciaDatasetEstado.promise;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { busquedaProvinciaDataset_obtener };
}
