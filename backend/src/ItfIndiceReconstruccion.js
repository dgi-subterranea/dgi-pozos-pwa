// ItfIndiceReconstruccion (E10-1, incidente v49): lo COMPARTIDO por los dos indices de disponibilidad de ITF (el de E9, 'itf_leg_v2_' en ItfLegacyProvider.js, y el de siempre, 'itf_idx_' en
// ItfAvailabilityService.js): cuando se usa el indice y cuando se reconstruye.
//
// POR QUE EXISTE. Reconstruir el indice recorre la carpeta THUMB ENTERA de Drive (17.000+ archivos): ~128 s medidos con el indice vencido. Antes, (1) la busqueda de UN pozo dependia del indice (el primer
// usuario despues de una hora sin actividad esperaba minutos) y (2) la "bandera" de single-flight se miraba y se ponia sin ser atomica, vencia a los 60 s y los que esperaban lo hacian solo ~6 s: con una
// reconstruccion de ~130 s todos terminaban recorriendo la carpeta a la vez.
//
// REGLA EXPLICITA (la misma para los dos indices):
//   1 pozo (un solo wellId distinto)  -> LOOKUP DIRECTO por nombre en Drive (itfLegacy_buscar / driveProfileRepository_buscarCandidatosLegacy). NUNCA toca el indice ni recorre la carpeta: funciona igual con el
//                                        cache vacio, inexistente o vencido. Es el camino interactivo del hub.
//   2 o mas pozos distintos (lote)    -> INDICE (una lectura del cache; reconstruirlo es UNA pasada por la carpeta). Es el camino de la seleccion multiple / exportacion. N busquedas directas serian N+1.
//
// RECONSTRUCCION CON UN SOLO RECONSTRUCTOR (itfIndice_asegurar):
//   - El ScriptLock se usa SOLO para RECLAMAR la reconstruccion (milisegundos): bajo el lock se REVALIDA el indice (otro proceso pudo haberlo reconstruido mientras se esperaba el lock), se mira la bandera de
//     reconstruccion y, si nadie la tiene, se la pone (cache, TTL ITF_INDICE_BANDERA_SEGUNDOS). El lock se SUELTA ANTES del recorrido pesado: el ScriptLock es el mismo lock global que serializa TODAS las
//     escrituras de hojas (fotos, observaciones, ubicaciones...) y retenerlo ~130 s las dejaria afuera.
//   - El que reclama ("PROPIO") reconstruye FUERA del lock y SIEMPRE quita la bandera (finally); si la ejecucion muere sin pasar por el finally, la bandera vence sola.
//   - Los demas NO recorren la carpeta: ESPERAN al indice sin tomar el lock. Cada sondeo (cada ITF_INDICE_ESPERA_SONDEO_MS = 3 s) lee el indice y la bandera (2 lecturas de cache) y duerme; el ScriptLock se toma
//     SOLO cuando no hay indice Y NO hay bandera (el reconstructor termino sin dejar indice, murio o su bandera vencio): ahi, dentro del lock, se REVALIDA el indice (si aparecio, se usa), se REVALIDA la
//     bandera (si otro ya reclamo, se vuelve a esperar) y recien si sigue todo libre se reclama. La espera maxima es ITF_INDICE_ESPERA_MAX sondeos (60 x 3 s = ~180 s): cubre las reconstrucciones medidas
//     (88 s a 160 s) y queda por debajo de la bandera (300 s) y del limite de ejecucion de Apps Script (360 s). Pasado ese tiempo FALLAN (SERVICE_UNAVAILABLE para el cliente, que puede reintentar) en vez de
//     lanzarse a reconstruir: la carpeta se recorre una vez, no una por proceso. Jamas se afirma "sin ITF" por no haber podido reconstruir. Con 3 s, un consumidor se entera como mucho 3 s despues de que el
//     reconstructor termino (menos del 4 % de una reconstruccion de 90 s) y hace ~120 lecturas de cache en 180 s (con 1 s serian ~360, sin ningun beneficio perceptible).
//   - Lo que se esconde detras de un indice incompleto sigue igual que antes: un departamento que desaparece del cache entre la reconstruccion y la lectura es "DESCONOCIDO" (nunca "No").
// El TTL de los indices NO cambia (1 hora): con el lookup directo el cold start deja de afectar la busqueda individual, y el del lote lo absorbe el unico reconstructor.
var ITF_INDICE_CLAIM_ESPERA_MS = 2000;
var ITF_INDICE_BANDERA_SEGUNDOS = 300;
var ITF_INDICE_ESPERA_SONDEO_MS = 3000;
var ITF_INDICE_ESPERA_MAX = 60;
var ITF_INDICE_BANDERA_ANTIGUO = 'itf_idx_rebuilding';

// Cantidad de wellId DISTINTOS de un lote (los repetidos cuentan una vez). La regla "1 pozo -> directo" se decide con esto.
function itfIndice_unicos(wellIds) {
  var vistos = {};
  var lista = [];
  (wellIds || []).forEach(function (w) {
    if (typeof w === 'string' && vistos[w] !== true) {
      vistos[w] = true;
      lista.push(w);
    }
  });
  return lista;
}

// Reclama la reconstruccion. cfg = {cache, banderaClave, hayIndice()}. Devuelve 'LISTO' (el indice ya estaba: otro lo reconstruyo), 'PROPIO' (este proceso reconstruye) u 'OCUPADO' (otro reconstruye, o no se
// pudo tomar el lock). El lock se libera SIEMPRE (finally), tambien si hayIndice() o el cache lanzan.
function itfIndice_reclamar(cfg) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(ITF_INDICE_CLAIM_ESPERA_MS);
  } catch (err) {
    return 'OCUPADO';
  }
  try {
    if (cfg.hayIndice()) {
      return 'LISTO';
    }
    if (cfg.cache.get(cfg.banderaClave) !== null) {
      return 'OCUPADO';
    }
    cfg.cache.put(cfg.banderaClave, '1', ITF_INDICE_BANDERA_SEGUNDOS);
    return 'PROPIO';
  } finally {
    lock.releaseLock();
  }
}

// Se asegura de que el indice exista con UN SOLO reconstructor. cfg = {cache, banderaClave, hayIndice(), reconstruir()}. Lanza si Drive falla (el que reconstruye) o si esperando al reconstructor se agotan
// los sondeos. El lock SOLO se toma dentro de itfIndice_reclamar, y SOLO si no hay indice y no hay bandera.
function itfIndice_asegurar(cfg) {
  for (var sondeo = 0; ; sondeo++) {
    if (cfg.hayIndice()) {
      return;
    }
    if (cfg.cache.get(cfg.banderaClave) === null) {
      // sin indice y sin bandera: este proceso podria convertirse en el reconstructor -> reclamo bajo lock (revalida indice y bandera)
      var r = itfIndice_reclamar(cfg);
      if (r === 'LISTO') {
        return;
      }
      if (r === 'PROPIO') {
        try {
          cfg.reconstruir();
        } finally {
          try {
            cfg.cache.remove(cfg.banderaClave);
          } catch (err) {
            // la bandera vence sola (TTL): nunca tapa el resultado ni el error de la reconstruccion
          }
        }
        return;
      }
      // 'OCUPADO': otro reclamo entre medio (o no se pudo tomar el lock): se vuelve a esperar
    }
    if (sondeo >= ITF_INDICE_ESPERA_MAX) {
      throw new Error('ITF_INDEX_RECONSTRUYENDO: otra ejecucion esta reconstruyendo el indice de disponibilidad; reintentar');
    }
    Utilities.sleep(ITF_INDICE_ESPERA_SONDEO_MS);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_INDICE_CLAIM_ESPERA_MS,
    ITF_INDICE_BANDERA_SEGUNDOS,
    ITF_INDICE_ESPERA_SONDEO_MS,
    ITF_INDICE_ESPERA_MAX,
    ITF_INDICE_BANDERA_ANTIGUO,
    itfIndice_unicos,
    itfIndice_reclamar,
    itfIndice_asegurar
  };
}
