// Logica PURA del resumen de aptitud de reemplazo (Reemplazos v3): el mapa
// {wellId: "APTO"|"DUDOSO"|"NO_APTO"} que devuelve getResumenReemplazoMapa
// (solo pozos evaluados; el resto es SIN_EVALUAR) y lo que mapa, Cerca Mio
// y Mi seleccion hacen con el: estado de un pozo, filtro, conteos. Sin DOM
// ni red - la testea Jest (js/reemplazoResumenLogic.test.js).
//
// Convencion: un resumen NULL significa "no disponible" (sin permiso, aun
// no cargado o fallo la carga): ahi NO hay badge, NO hay filtro y NINGUN
// pozo se trata como "Sin evaluar" (seria afirmar algo que no se sabe).
var REEMPLAZO_RESUMEN_ESTADOS = ['APTO', 'DUDOSO', 'NO_APTO', 'SIN_EVALUAR'];
var REEMPLAZO_RESUMEN_ETIQUETAS = { APTO: 'Apto', DUDOSO: 'Dudoso', NO_APTO: 'No apto', SIN_EVALUAR: 'Sin evaluar' };
var REEMPLAZO_RESUMEN_EVALUADOS = { APTO: true, DUDOSO: true, NO_APTO: true };

function reemplazoResumenLogic_etiqueta(estado) {
  return REEMPLAZO_RESUMEN_ETIQUETAS[estado] || 'Sin evaluar';
}

// Defensa en el borde de red: del payload solo pasan pares wellId (DD-PPPP)
// -> estado evaluado conocido. Cualquier otra cosa se descarta.
function reemplazoResumenLogic_sanitizar(data) {
  var resumen = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return resumen;
  }
  Object.keys(data).forEach(function (wellId) {
    if (/^\d{2}-\d{4}$/.test(wellId) && REEMPLAZO_RESUMEN_EVALUADOS[data[wellId]] === true) {
      resumen[wellId] = data[wellId];
    }
  });
  return resumen;
}

// Estado de un pozo: el del resumen o SIN_EVALUAR si esta ausente; null si
// no hay resumen disponible.
function reemplazoResumenLogic_estadoDe(resumen, wellId) {
  if (!resumen) {
    return null;
  }
  return REEMPLAZO_RESUMEN_EVALUADOS[resumen[wellId]] === true ? resumen[wellId] : 'SIN_EVALUAR';
}

function reemplazoResumenLogic_hayActivos(activos) {
  return !!activos && Object.keys(activos).some(function (k) { return activos[k]; });
}

// Filtro por aptitud: OR dentro del grupo (varios estados), vacio = sin
// filtro. Se combina con AND con el resto de los filtros (se aplica sobre
// el resultado de los otros). puntos: cualquier lista de objetos con
// wellId. Sin resumen disponible no filtra.
function reemplazoResumenLogic_filtrar(puntos, resumen, activos) {
  if (!resumen || !reemplazoResumenLogic_hayActivos(activos)) {
    return puntos;
  }
  return puntos.filter(function (p) {
    return activos[reemplazoResumenLogic_estadoDe(resumen, p.wellId)] === true;
  });
}

// Conteo por estado de un universo (la suma da siempre universo.length:
// Sin evaluar = el resto). Es el que alimenta los chips con la logica
// contextual (todo el mapa / solo seleccion / solo vista previa).
function reemplazoResumenLogic_contar(puntos, resumen) {
  var conteo = { APTO: 0, DUDOSO: 0, NO_APTO: 0, SIN_EVALUAR: 0 };
  (puntos || []).forEach(function (p) {
    var e = reemplazoResumenLogic_estadoDe(resumen, p.wellId);
    conteo[e === null ? 'SIN_EVALUAR' : e] += 1;
  });
  return conteo;
}

// Pozos sobre los que actuan las acciones de Cerca Mio ("Ver todos en el
// mapa" y "Usar estos pozos"): las acciones operan sobre LO QUE EL USUARIO
// VE. Sin filtros activos (o sin resumen disponible) son todos los pozos
// encontrados en el radio; con uno o mas filtros activos, SOLO el
// subconjunto filtrado (en el mismo orden: ya vienen ordenados por
// distancia). vacio = el filtro no deja ningun pozo: ahi las acciones se
// deshabilitan para no generar jamas una seleccion/vista previa vacia.
// encontrados: lista de objetos con wellId (TODOS los del radio, sin el tope
// de 30 de la lista visible).
function reemplazoResumenLogic_pozosParaAcciones(encontrados, resumen, activos) {
  var todos = encontrados || [];
  var filtrado = !!resumen && reemplazoResumenLogic_hayActivos(activos);
  var elegidos = filtrado ? reemplazoResumenLogic_filtrar(todos, resumen, activos) : todos;
  return {
    wellIds: elegidos.map(function (p) { return p.wellId; }),
    filtrado: filtrado,
    total: todos.length,
    vacio: elegidos.length === 0
  };
}

// Copia del resumen con el estado nuevo de UN pozo (actualizacion
// inmediata despues de evaluar, sin refetch). SIN_EVALUAR (o invalido) lo
// quita. Sin resumen no hace nada (null).
function reemplazoResumenLogic_actualizar(resumen, wellId, estado) {
  if (!resumen) {
    return null;
  }
  var copia = {};
  Object.keys(resumen).forEach(function (k) { copia[k] = resumen[k]; });
  if (REEMPLAZO_RESUMEN_EVALUADOS[estado] === true) {
    copia[wellId] = estado;
  } else {
    delete copia[wellId];
  }
  return copia;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REEMPLAZO_RESUMEN_ESTADOS,
    reemplazoResumenLogic_etiqueta,
    reemplazoResumenLogic_sanitizar,
    reemplazoResumenLogic_estadoDe,
    reemplazoResumenLogic_hayActivos,
    reemplazoResumenLogic_filtrar,
    reemplazoResumenLogic_contar,
    reemplazoResumenLogic_pozosParaAcciones,
    reemplazoResumenLogic_actualizar
  };
}
