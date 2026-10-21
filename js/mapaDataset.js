// Cache compartida del dataset de getMapaPozos entre js/mapa.js, js/cercaMio.js, js/seleccion.js y js/buscarReemplazo.js: cualquiera que se abra primero
// dispara el fetch; el que se abra despues (o el mismo que se reabre) reusa el resultado ya en memoria, sin importar el orden. No persiste entre recargas de
// pagina a proposito (memoria de sesion nada mas - ver adjustment #3 de la Etapa 5B/5C: evitar localStorage para este dataset).
//
// PUNTO OPERATIVO (unico lugar donde se aplica): lo que devuelve mapaDataset_obtener es el dataset OPERATIVO, compuesto por CAPAS con ubicacionOperativaLogic_aplicarCapas
// (js/ubicacionOperativaLogic.js, la UNICA que decide; aca no hay reglas de resolucion):
//     BASE (pozos.json, que NUNCA se modifica)
//       -> DELTA REGISTRAL (apiGetDecisionesFuentesDelta: efecto de las decisiones sobre las fuentes del padron, D | C | R | N)
//       -> DELTA DE CAMPO (getUbicacionesValidadas: V, siempre gana)
//       -> punto final o NINGUNO (un pozo sin punto sale del arreglo)
// Por eso el mapa, Cerca Mio, la seleccion (poligono / radio / multiseleccion) y Buscar reemplazo heredan el punto operativo sin implementar ninguna regla propia. Un solo
// punto por wellId.
//  - dataset base: se pide una vez por sesion, como siempre. Su metadata trae el `periodo` del padron con que se genero.
//  - DESPUES del base, los dos deltas se piden EN PARALELO (no se suman dos latencias). Cada uno tiene su propio cache de 60 s (MAPA_DATASET_DELTAS_TTL_MS), su propia
//    invalidacion (mapaDataset_invalidarDeltaRegistral / _invalidarDeltaCampo; la generica mapaDataset_invalidarDeltas invalida los dos) y NUNCA obliga a bajar de nuevo el base.
//  - PERIODO: el delta registral solo se aplica si su `periodo` es IGUAL al del base. Si el base no trae periodo, si el delta no lo trae, o si difieren, se ignora TODO el
//    delta registral (jamas se mezclan decisiones calculadas sobre otro padron) y se conserva base + V.
//  - PARCIAL: si el delta trae `parcial` > 0 NO se descarta el resto: se aplican todas las entradas validas; los pozos que faltan conservan base + V.
//  - Una entrada individual invalida se ignora (nunca se vuelve N); una respuesta global invalida o un endpoint que falla se ignoran enteros y el mapa sigue con lo que hay.
//    Una falla global NO se cachea como exito: la proxima llamada reintenta.
//  - AVISO UNICO: cualquier degradacion (endpoint caido, respuesta invalida, periodo incompatible, parcial, entradas invalidas; de una capa o de las dos) enciende un solo
//    `degradado`; el detalle por capa queda en `degradacion` (para pruebas / futuro) y nunca se muestra al usuario.
// Formato: {status:'ok', data:{pozos, metadata, degradado, degradacion, operativo}}. El arreglo es el MISMO objeto mientras no cambien el dataset base ni lo que aplican las
// capas (los consumidores guardan la referencia).
//   degradacion: {degradado, registral: {estado, aplicado, parcial, entradasInvalidas}, campo: {estado, aplicado, entradasInvalidas}}
//     estado registral: 'OK' | 'OMITIDA' | 'FALLA' | 'RESPUESTA_INVALIDA' | 'PERIODO_FALTANTE_BASE' | 'PERIODO_FALTANTE_DELTA' | 'PERIODO_INCOMPATIBLE'
//     estado campo:     'OK' | 'OMITIDA' | 'FALLA'
//   operativo: {aplicadas, nuevos, descartadas (las de campo, como siempre), quitados, sinPunto, registral: {...}, campo: {...}} (el resumen de aplicarCapas)
var MAPA_DATASET_DELTAS_TTL_MS = 60000;

function mapaDataset_capaVacia() {
  // datos: lo que se aplica (null = nada); falla: codigo de la falla global (null = sin falla); firma: huella barata de lo que aplica (para la referencia estable);
  // ts: instante del ultimo exito (0 = hay que pedirla); promise: pedido en vuelo; gen: generacion (cada invalidacion la sube: lo que vuela de una generacion vieja se descarta)
  return { datos: null, falla: null, firma: 'sin-datos', ts: 0, promise: null, gen: 0 };
}

var mapaDatasetEstado = {
  pozos: null, metadata: null, promise: null,
  registral: mapaDataset_capaVacia(),
  campo: mapaDataset_capaVacia(),
  operativo: null             // {base, firmaRegistral, firmaCampo, result}: ultimo resultado compuesto
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

// --- Disponibilidad (en el navegador todo esta cargado; sin el modulo de capas o sin la api de una capa, esa capa simplemente no existe: como antes) ---

function mapaDataset_capasDisponibles() {
  return typeof ubicacionOperativaLogic_aplicarCapas === 'function';
}

function mapaDataset_registralDisponible() {
  return mapaDataset_capasDisponibles() && typeof apiGetDecisionesFuentesDelta === 'function';
}

function mapaDataset_campoDisponible() {
  return mapaDataset_capasDisponibles() && typeof apiGetUbicacionesValidadas === 'function';
}

function mapaDataset_capaFresca(capa) {
  return capa.datos !== null && capa.falla === null && (Date.now() - capa.ts) < MAPA_DATASET_DELTAS_TTL_MS;
}

// Una falla GLOBAL de una capa: no se aplica nada de ella, no se cachea como exito (ts = 0: la proxima llamada reintenta).
function mapaDataset_fallarCapa(capa, codigo) {
  capa.datos = null;
  capa.falla = codigo;
  capa.ts = 0;
  capa.firma = 'falla:' + codigo;
}

function mapaDataset_aceptarCapa(capa, datos, firma) {
  capa.datos = datos;
  capa.falla = null;
  capa.ts = Date.now();
  capa.firma = firma;
}

// Pide una capa. Nunca rechaza: cualquier excepcion o respuesta mala es una falla global de ESA capa. Comparte el pedido en vuelo.
// Si la capa se INVALIDA mientras su pedido vuela (una decision confirmada despues de pedirlo), esa respuesta puede ser vieja: se descarta (no pisa nada ni queda como "fresca") y el
// proximo mapaDataset_obtener pide otra vez, sin reutilizar el pedido viejo.
function mapaDataset_pedirCapa(capa, llamar, procesar) {
  if (capa.promise) {
    return capa.promise;
  }
  var gen = capa.gen;
  var pedido = Promise.resolve().then(llamar).then(function (r) {
    if (capa.gen !== gen) {
      return;
    }
    try {
      procesar(r);
    } catch (err) {
      mapaDataset_fallarCapa(capa, 'FALLA');
    }
  }, function () {
    if (capa.gen === gen) {
      mapaDataset_fallarCapa(capa, 'FALLA');
    }
  }).then(function () {
    if (capa.promise === pedido) {
      capa.promise = null;
    }
  });
  capa.promise = pedido;
  return pedido;
}

// Invalida UNA capa: la proxima mapaDataset_obtener la vuelve a pedir de inmediato. Sube la generacion y suelta el pedido en vuelo (si lo hay). No toca los datos que ya aplica (hasta que
// llegue la respuesta nueva se sigue mostrando lo ultimo conocido), ni el dataset base, ni la otra capa.
function mapaDataset_invalidarCapa(capa) {
  capa.ts = 0;
  capa.gen += 1;
  capa.promise = null;
}

// --- Capa de campo (V) ---

function mapaDataset_obtenerDeltaCampo(sessionToken) {
  var capa = mapaDatasetEstado.campo;
  if (!mapaDataset_campoDisponible() || mapaDataset_capaFresca(capa)) {
    return Promise.resolve();
  }
  return mapaDataset_pedirCapa(capa, function () {
    return apiGetUbicacionesValidadas(sessionToken);
  }, function (r) {
    if (r && r.status === 'ok' && r.data && Array.isArray(r.data.ubicaciones)) {
      var json = JSON.stringify(r.data.ubicaciones);
      // la firma solo cambia si cambia lo que se aplica (o si se vuelve de una falla): asi un refresco con los mismos datos conserva la referencia
      mapaDataset_aceptarCapa(capa, r.data.ubicaciones, capa.falla === null && capa.datos !== null && json === capa.json ? capa.firma : 'campo:' + json);
      capa.json = json;
    } else {
      mapaDataset_fallarCapa(capa, 'FALLA');
    }
  });
}

// --- Capa registral (decisiones) ---

// Respuesta del delta registral -> {ok:true, datos:{version, periodo, parcial, decisiones}} | {ok:false, codigo}. Solo valida la FORMA GLOBAL; cada entrada pasa
// despues por la normalizacion pura (ubicacionOperativaLogic_normalizarDeltaRegistral, dentro de aplicarCapas).
function mapaDataset_validarRespuestaRegistral(r) {
  var d = r && r.status === 'ok' && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data : null;
  if (d === null) {
    return { ok: false, codigo: 'FALLA' };
  }
  if (typeof d.periodo !== 'string' || d.periodo.trim() === '') {
    return { ok: false, codigo: 'PERIODO_FALTANTE_DELTA' };
  }
  if (typeof d.version !== 'number' || !isFinite(d.version) || Math.floor(d.version) !== d.version || d.version < 0 ||
    typeof d.parcial !== 'number' || !isFinite(d.parcial) || Math.floor(d.parcial) !== d.parcial || d.parcial < 0 || !Array.isArray(d.decisiones)) {
    return { ok: false, codigo: 'RESPUESTA_INVALIDA' };
  }
  return { ok: true, datos: { version: d.version, periodo: d.periodo, parcial: d.parcial, decisiones: d.decisiones } };
}

function mapaDataset_periodoDelBase() {
  var m = mapaDatasetEstado.metadata;
  return m && typeof m === 'object' && typeof m.periodo === 'string' && m.periodo.trim() !== '' ? m.periodo : null;
}

function mapaDataset_obtenerDeltaRegistral(sessionToken) {
  var capa = mapaDatasetEstado.registral;
  if (!mapaDataset_registralDisponible()) {
    return Promise.resolve();
  }
  var periodoBase = mapaDataset_periodoDelBase();
  if (periodoBase === null) {
    // sin periodo en el base no hay con que verificar el padron del delta: se ignora la capa entera (y no se gasta el pedido)
    mapaDataset_fallarCapa(capa, 'PERIODO_FALTANTE_BASE');
    return Promise.resolve();
  }
  if (mapaDataset_capaFresca(capa)) {
    return Promise.resolve();
  }
  return mapaDataset_pedirCapa(capa, function () {
    return apiGetDecisionesFuentesDelta(sessionToken);
  }, function (r) {
    var v = mapaDataset_validarRespuestaRegistral(r);
    if (!v.ok) {
      mapaDataset_fallarCapa(capa, v.codigo);
    } else if (v.datos.periodo !== periodoBase) {
      mapaDataset_fallarCapa(capa, 'PERIODO_INCOMPATIBLE');
    } else {
      // la firma no incluye `version`: una decision sin efecto sobre ningun punto cambia la version pero no lo que se aplica
      var json = JSON.stringify([v.datos.parcial, v.datos.decisiones]);
      mapaDataset_aceptarCapa(capa, v.datos, capa.falla === null && capa.datos !== null && json === capa.json ? capa.firma : 'registral:' + json);
      capa.json = json;
    }
  });
}

// Los dos deltas en PARALELO (se disparan en el mismo turno; ninguno espera al otro). Nunca rechaza.
function mapaDataset_obtenerDeltas(sessionToken) {
  return Promise.all([mapaDataset_obtenerDeltaRegistral(sessionToken), mapaDataset_obtenerDeltaCampo(sessionToken)]);
}

// --- Degradacion (un solo aviso para el usuario; el detalle por capa es interno) ---

function mapaDataset_resumenDegradacion(resumen) {
  var e = mapaDatasetEstado;
  var regInvalidas = resumen ? resumen.registral.descartadas.length : 0;
  var campoInvalidas = resumen ? resumen.campo.descartadas.length : 0;
  var registral = {
    estado: !mapaDataset_registralDisponible() ? 'OMITIDA' : (e.registral.falla || 'OK'),
    aplicado: e.registral.datos !== null,
    parcial: e.registral.datos ? e.registral.datos.parcial : 0,
    entradasInvalidas: regInvalidas
  };
  var campo = {
    estado: !mapaDataset_campoDisponible() ? 'OMITIDA' : (e.campo.falla !== null ? 'FALLA' : 'OK'),
    aplicado: e.campo.datos !== null,
    entradasInvalidas: campoInvalidas
  };
  var degradado = (registral.estado !== 'OK' && registral.estado !== 'OMITIDA') || registral.parcial > 0 || registral.entradasInvalidas > 0 ||
    campo.estado === 'FALLA' || campo.entradasInvalidas > 0;
  return { degradado: degradado, registral: registral, campo: campo };
}

// dataset base + capas -> {status:'ok', data}. Memoizado por (dataset base, lo que aplica cada capa).
function mapaDataset_componer() {
  var e = mapaDatasetEstado;
  if (e.operativo && e.operativo.base === e.pozos && e.operativo.firmaRegistral === e.registral.firma && e.operativo.firmaCampo === e.campo.firma) {
    return e.operativo.result;
  }
  var pozos = e.pozos;
  var resumen = null;
  if (mapaDataset_capasDisponibles()) {
    var r = ubicacionOperativaLogic_aplicarCapas(e.pozos, e.registral.datos ? e.registral.datos.decisiones : [], e.campo.datos || []);
    pozos = r.pozos;
    resumen = r.resumen;
  }
  var degradacion = mapaDataset_resumenDegradacion(resumen);
  var operativo = resumen
    ? { aplicadas: resumen.aplicadas, nuevos: resumen.nuevos, descartadas: resumen.campo.descartadas, quitados: resumen.quitados, sinPunto: resumen.sinPunto, registral: resumen.registral, campo: resumen.campo }
    : { aplicadas: 0, nuevos: 0, descartadas: [], quitados: 0, sinPunto: 0, registral: null, campo: null };
  var result = { status: 'ok', data: { pozos: pozos, metadata: e.metadata, degradado: degradacion.degradado, degradacion: degradacion, operativo: operativo } };
  e.operativo = { base: e.pozos, firmaRegistral: e.registral.firma, firmaCampo: e.campo.firma, result: result };
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

// Invalidacion por capa: la proxima mapaDataset_obtener vuelve a pedir ESA capa de inmediato. Nunca toca el dataset base ni la otra capa.
// Registral: la usa el dialogo compartido tras una decision autoritativa (aceptar, descartar, quitar aceptacion, restaurar, aprobar una sugerencia).
function mapaDataset_invalidarDeltaRegistral() {
  mapaDataset_invalidarCapa(mapaDatasetEstado.registral);
}

// Campo (V): la usan validar una correccion, la correccion directa (auto-validada) y que otra persona resuelva una correccion.
function mapaDataset_invalidarDeltaCampo() {
  mapaDataset_invalidarCapa(mapaDatasetEstado.campo);
}

// Generica (compatibilidad; ya no la usa ningun flujo): invalida las DOS capas; el dataset base no se toca.
function mapaDataset_invalidarDeltas() {
  mapaDataset_invalidarDeltaRegistral();
  mapaDataset_invalidarDeltaCampo();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaDataset_obtener, mapaDataset_invalidarDeltas, mapaDataset_invalidarDeltaRegistral, mapaDataset_invalidarDeltaCampo, MAPA_DATASET_DELTAS_TTL_MS };
}
