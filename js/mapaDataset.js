// Cache compartida del dataset de getMapaPozos entre js/mapa.js, js/cercaMio.js, js/seleccion.js y js/buscarReemplazo.js: cualquiera que se abra primero
// dispara el fetch; el que se abra despues (o el mismo que se reabre) reusa el resultado ya en memoria, sin importar el orden. No persiste entre recargas de
// pagina a proposito (memoria de sesion nada mas - ver adjustment #3 de la Etapa 5B/5C: evitar localStorage para este dataset).
//
// PUNTO OPERATIVO (unico lugar donde se aplica): lo que devuelve mapaDataset_obtener es el dataset OPERATIVO = el dataset base (pozos.json, que NUNCA se
// modifica) + las ubicaciones VALIDADAS vigentes (getUbicacionesValidadas) aplicadas con ubicacionOperativaLogic_aplicarOverlay. Por eso el mapa, Cerca Mio, la
// seleccion (poligono / radio / multiseleccion) y Buscar reemplazo heredan el punto operativo sin implementar ninguna regla propia: un pozo con ubicacion
// validada aparece en SU lugar con estado 'V', y uno que no tenia punto en el mapa aparece por ella. Un solo punto por wellId.
//  - dataset base: se pide una vez por sesion, como siempre.
//  - deltas: se guardan en memoria y se vuelven a pedir si pasaron mas de 60 s (MAPA_DATASET_DELTAS_TTL_MS) o tras mapaDataset_invalidarDeltas() (validar,
//    revertir o crear una correccion directa): sin polling.
//  - si getUbicacionesValidadas falla (red, sesion, backend viejo sin la accion) el mapa NO se rompe: se usa el dataset base y data.degradado = true (la UI
//    muestra un aviso discreto); la proxima llamada vuelve a intentarlo y, si funciona, aplica el overlay y quita la marca.
// Formato: {status:'ok', data:{pozos, metadata, degradado, operativo:{aplicadas, nuevos, descartadas}}}. El arreglo es el MISMO objeto mientras no cambien el
// dataset base ni los deltas (los consumidores guardan la referencia).
var MAPA_DATASET_DELTAS_TTL_MS = 60000;
var mapaDatasetEstado = {
  pozos: null, metadata: null, promise: null,
  deltas: null, deltasJson: null, deltasTs: 0, deltasPromise: null,
  degradado: false,
  version: 0,                 // sube cada vez que cambia lo que hay que aplicar (deltas distintos o entrada/salida de la degradacion)
  operativo: null             // {base, version, result}: ultimo resultado compuesto
};

function mapaDataset_obtenerBase(sessionToken) {
  if (mapaDatasetEstado.pozos) {
    return Promise.resolve({ status: 'ok', data: { pozos: mapaDatasetEstado.pozos, metadata: mapaDatasetEstado.metadata } });
  }

  // Dos aperturas casi simultaneas (ej. el usuario toca "Mapa de pozos" y en el mismo instante "Cerca mio" desde otra pestaña/flujo) NO deben disparar 2
  // fetches - comparten la misma promesa en vuelo.
  if (mapaDatasetEstado.promise) {
    return mapaDatasetEstado.promise;
  }

  mapaDatasetEstado.promise = apiGetMapaPozos(sessionToken).then(function (result) {
    mapaDatasetEstado.promise = null;
    if (result.status === 'ok') {
      mapaDatasetEstado.pozos = result.data.pozos;
      mapaDatasetEstado.metadata = result.data.metadata;
    }
    // Un error NUNCA se cachea - la proxima apertura (Mapa o Cerca Mio) vuelve a intentar el fetch en vez de quedar pegada a la falla.
    return result;
  }).catch(function (err) {
    mapaDatasetEstado.promise = null;
    throw err;
  });

  return mapaDatasetEstado.promise;
}

function mapaDataset_overlayDisponible() {
  return typeof apiGetUbicacionesValidadas === 'function' && typeof ubicacionOperativaLogic_aplicarOverlay === 'function';
}

function mapaDataset_marcarFalla() {
  if (!mapaDatasetEstado.degradado) {
    mapaDatasetEstado.degradado = true;
    mapaDatasetEstado.version += 1;
  }
}

// Nunca rechaza: cualquier falla deja degradado = true (y se reintenta en la proxima llamada).
function mapaDataset_obtenerDeltas(sessionToken) {
  var e = mapaDatasetEstado;
  if (!mapaDataset_overlayDisponible()) {
    return Promise.resolve();
  }
  if (e.deltas !== null && !e.degradado && (Date.now() - e.deltasTs) < MAPA_DATASET_DELTAS_TTL_MS) {
    return Promise.resolve();
  }
  if (e.deltasPromise) {
    return e.deltasPromise;
  }
  e.deltasPromise = Promise.resolve().then(function () {
    return apiGetUbicacionesValidadas(sessionToken);
  }).then(function (r) {
    if (r && r.status === 'ok' && r.data && Array.isArray(r.data.ubicaciones)) {
      var json = JSON.stringify(r.data.ubicaciones);
      if (e.degradado || json !== e.deltasJson) {
        e.version += 1;
      }
      e.deltas = r.data.ubicaciones;
      e.deltasJson = json;
      e.deltasTs = Date.now();
      e.degradado = false;
    } else {
      mapaDataset_marcarFalla();
    }
  }, function () {
    mapaDataset_marcarFalla();
  }).then(function () {
    e.deltasPromise = null;
  });
  return e.deltasPromise;
}

// dataset base + deltas -> {status:'ok', data}. Memoizado por (dataset base, version de los deltas).
function mapaDataset_componer() {
  var e = mapaDatasetEstado;
  if (e.operativo && e.operativo.base === e.pozos && e.operativo.version === e.version) {
    return e.operativo.result;
  }
  var pozos = e.pozos;
  var operativo = { aplicadas: 0, nuevos: 0, descartadas: [] };
  if (mapaDataset_overlayDisponible() && !e.degradado && e.deltas && e.deltas.length > 0) {
    var r = ubicacionOperativaLogic_aplicarOverlay(e.pozos, e.deltas);
    pozos = r.pozos;
    operativo = { aplicadas: r.resumen.aplicadas, nuevos: r.resumen.nuevos, descartadas: r.resumen.descartadas };
  }
  var result = { status: 'ok', data: { pozos: pozos, metadata: e.metadata, degradado: e.degradado, operativo: operativo } };
  e.operativo = { base: e.pozos, version: e.version, result: result };
  return result;
}

function mapaDataset_obtener(sessionToken) {
  return mapaDataset_obtenerBase(sessionToken).then(function (result) {
    if (!result || result.status !== 'ok') {
      return result;
    }
    return mapaDataset_obtenerDeltas(sessionToken).then(mapaDataset_componer);
  });
}

// Tras validar, revertir o crear una correccion directa: la proxima mapaDataset_obtener vuelve a pedir los deltas (el dataset base no se toca).
function mapaDataset_invalidarDeltas() {
  mapaDatasetEstado.deltasTs = 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaDataset_obtener, mapaDataset_invalidarDeltas, MAPA_DATASET_DELTAS_TTL_MS };
}
