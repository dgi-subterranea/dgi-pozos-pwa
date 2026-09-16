// Cache compartida del dataset de getMapaPozos entre js/mapa.js y
// js/cercaMio.js: cualquiera de los dos que se abra primero dispara el
// fetch; el que se abra despues (o el mismo que se reabre) reusa el
// resultado ya en memoria, sin importar el orden. No persiste entre
// recargas de pagina a proposito (memoria de sesion nada mas - ver
// adjustment #3 de la Etapa 5B/5C: evitar localStorage para este
// dataset).
var mapaDatasetEstado = { pozos: null, metadata: null, promise: null };

function mapaDataset_obtener(sessionToken) {
  if (mapaDatasetEstado.pozos) {
    return Promise.resolve({ status: 'ok', data: { pozos: mapaDatasetEstado.pozos, metadata: mapaDatasetEstado.metadata } });
  }

  // Dos aperturas casi simultaneas (ej. el usuario toca "Mapa de pozos"
  // y en el mismo instante "Cerca mio" desde otra pestaña/flujo) NO
  // deben disparar 2 fetches - comparten la misma promesa en vuelo.
  if (mapaDatasetEstado.promise) {
    return mapaDatasetEstado.promise;
  }

  mapaDatasetEstado.promise = apiGetMapaPozos(sessionToken).then(function (result) {
    mapaDatasetEstado.promise = null;
    if (result.status === 'ok') {
      mapaDatasetEstado.pozos = result.data.pozos;
      mapaDatasetEstado.metadata = result.data.metadata;
    }
    // Un error NUNCA se cachea - la proxima apertura (Mapa o Cerca Mio)
    // vuelve a intentar el fetch en vez de quedar pegada a la falla.
    return result;
  }).catch(function (err) {
    mapaDatasetEstado.promise = null;
    throw err;
  });

  return mapaDatasetEstado.promise;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaDataset_obtener };
}
