// Logica pura del Mapa de Pozos - sin DOM, sin Leaflet, sin fetch (esas
// partes viven en js/mapa.js, que no se testea por convencion del
// proyecto, igual que js/app.js). Esta separacion mirror
// js/hubIdentificacion.js: lo que se puede probar sin tocar el navegador,
// se prueba directo.

// Nombres reales de los 19 departamentos, derivados de
// identificacion.departamento en el padron real (scripts/out/registro) -
// el codigo "02" no tiene pozos en el dataset actual, por eso no
// necesita nombre (mapaLogic_construirOpcionesDepartamento nunca lo
// ofrece si no aparece ningun punto con ese codigo).
var MAPA_DEPARTAMENTOS = {
  '01': 'Capital',
  '03': 'Las Heras',
  '04': 'Guaymallén',
  '05': 'Godoy Cruz',
  '06': 'Luján de Cuyo',
  '07': 'Maipú',
  '08': 'San Martín',
  '09': 'Junín',
  '10': 'Rivadavia',
  '11': 'Santa Rosa',
  '12': 'La Paz',
  '13': 'Lavalle',
  '14': 'Tupungato',
  '15': 'Tunuyán',
  '16': 'San Carlos',
  '17': 'San Rafael',
  '18': 'General Alvear',
  '19': 'Malargüe'
};

var MAPA_ESTADO_LABEL = { C: 'Confirmada', D: 'Disponible' };

function mapaLogic_departamentoDeWellId(wellId) {
  return wellId.substring(0, 2);
}

function mapaLogic_nombreDepartamento(codigo) {
  return MAPA_DEPARTAMENTOS[codigo] || codigo;
}

function mapaLogic_estadoLabel(estado) {
  return MAPA_ESTADO_LABEL[estado] || estado;
}

// Opciones del filtro de departamento: SOLO los que realmente tienen
// puntos en el dataset recibido (listar uno sin ningun punto es ruido,
// no informacion) - se calculan a partir de los datos, nunca de una
// lista fija de 19, para que el filtro siempre refleje lo que el mapa
// puede mostrar de verdad. Orden alfabetico por nombre (mas usable que
// por codigo para elegir a mano).
function mapaLogic_construirOpcionesDepartamento(pozos) {
  var conteos = {};
  for (var i = 0; i < pozos.length; i++) {
    var codigo = mapaLogic_departamentoDeWellId(pozos[i].wellId);
    conteos[codigo] = (conteos[codigo] || 0) + 1;
  }
  var opciones = Object.keys(conteos).map(function (codigo) {
    return { codigo: codigo, nombre: mapaLogic_nombreDepartamento(codigo), cantidad: conteos[codigo] };
  });
  opciones.sort(function (a, b) { return a.nombre.localeCompare(b.nombre, 'es'); });
  return opciones;
}

function mapaLogic_filtrarPorDepartamento(pozos, codigo) {
  if (!codigo || codigo === 'todos') {
    return pozos;
  }
  return pozos.filter(function (p) { return mapaLogic_departamentoDeWellId(p.wellId) === codigo; });
}

// Filtro por estado (chips Confirmada/Disponible - Etapa v2.1.0). Nunca
// deja el mapa en un estado ambiguo: si por algun motivo llegaran los 2
// apagados (la UI de mapa.js ya lo impide del lado del click - ver
// mapaController_toggleEstado - pero esta funcion no depende de eso para
// ser correcta), se interpreta como "sin filtro de estado" y se
// devuelve el dataset completo, nunca una lista vacia que parezca un
// error. estadosActivos: {C: bool, D: bool}.
function mapaLogic_filtrarPorEstado(pozos, estadosActivos) {
  var c = !!(estadosActivos && estadosActivos.C);
  var d = !!(estadosActivos && estadosActivos.D);
  if (!c && !d) {
    return pozos;
  }
  return pozos.filter(function (p) { return (p.estado === 'C' && c) || (p.estado === 'D' && d); });
}

// Divide las opciones de departamento en "visibles de entrada" y
// "detras del +N mas", para el patron de chips mobile-first del mockup.
// "Todos" no pasa por aca - es una opcion aparte, siempre visible, que
// mapa.js agrega por su cuenta antes de estas.
function mapaLogic_dividirChipsDepartamento(opciones, cantidadInicial) {
  var n = Math.max(0, cantidadInicial || 0);
  return {
    visibles: opciones.slice(0, n),
    ocultos: opciones.slice(n)
  };
}

// Decide si conviene pedir el summary liviano (titular/departamento/
// distrito) para el popup de un punto. El permiso se respeta ANTES de
// disparar la llamada de red, no solo al decidir que mostrar despues -
// mismo criterio que fetchSiTienePermiso en app.js.
function mapaLogic_debeConsultarSummary(permisos) {
  return !!(permisos && permisos.datos);
}

// Capa Mapa NE (v2.1.0): el chip "Niveles estáticos" (y todo lo que
// dispara) solo existe para un usuario con ne=SI - fail-closed, mismo
// criterio que mapaLogic_debeConsultarSummary. Nunca se llama "ubicacion"
// aca: son 2 permisos independientes, ver adjustment de v2.1.0 sobre no
// revelar pertenencia a la red NE a traves de otro permiso.
function mapaLogic_debeMostrarChipNE(permisos) {
  return !!(permisos && permisos.ne);
}

// Nombre para mostrar de un punto NE: nombreOriginal si existe (el caso
// tipico de un punto especial sin wellId, ej. "Jofre Puesto San
// Vicente"), si no el propio monitoringId (nunca se inventa un nombre).
function mapaLogic_nombrePuntoNE(punto) {
  return (punto && punto.nombreOriginal) || (punto && punto.monitoringId) || '';
}

// --- Filtro "Tiene: Niveles estáticos" dentro de Pozos Provincia ---
// (arquitectura de 2 mapas, aprobada): a diferencia de la capa NE
// independiente (que dibuja SUS propios 405 puntos, con su propio
// marker), este filtro vive DENTRO del padron general - reduce los
// puntos de getMapaPozos a solo aquellos cuyo wellId pertenece a la red
// NE. Los 34 puntos NE especiales (sin wellId) nunca pueden matchear
// nada aca (un Set de wellId no nulos no los contiene) - por diseño,
// ellos solo existen en el mapa NE independiente, nunca en este filtro.
//
// mapaLogic_setWellIdNE construye el Set UNA sola vez a partir del
// dataset ya cacheado por mapaNEDataset.js (nunca dispara fetch por si
// misma) - quien la llama decide cuando (ver mapaController_toggleNE en
// js/mapa.js).
function mapaLogic_setWellIdNE(puntosNE) {
  var set = new Set();
  (puntosNE || []).forEach(function (p) {
    if (p && p.wellId) {
      set.add(p.wellId);
    }
  });
  return set;
}

// Se combina con AND junto a mapaLogic_filtrarPorDepartamento/
// filtrarPorEstado (ver mapaController_renderPuntos) - cada uno un
// filtro puro independiente, encadenados. activo=false devuelve el
// dataset tal cual (comportamiento actual sin cambios, requisito
// explicito). activo=true con un set todavia no cargado (no deberia
// pasar en la practica - ver el flujo de carga diferida en mapa.js, que
// nunca re-renderiza con neActivo=true hasta tener el set) se trata
// fail-closed: no se asume "todos matchean", se devuelve vacio.
function mapaLogic_filtrarPorNE(pozos, wellIdSet, activo) {
  if (!activo) {
    return pozos;
  }
  var set = wellIdSet || new Set();
  return pozos.filter(function (p) { return set.has(p.wellId); });
}

// --- Navegacion entre los 2 mapas, segun permisos (arquitectura v2.2.0) ---
// Centraliza la decision de que le corresponde ver al usuario al tocar
// "Mapa de pozos" - la UNICA fuente de verdad para app.js (que boton/
// pantalla mostrar) y para mapa.js/mapaNE.js (que boton "Volver" usar,
// ver actualizarBotonesVolverMapa en app.js). ubicacion y ne son
// permisos completamente independientes (nunca se infiere uno del otro -
// mismo criterio de v2.1.0 aplicado ahora tambien a la navegacion, no
// solo al dataset):
//   ambos       -> 'selector'  (elegir Pozos Provincia o Niveles Estaticos)
//   solo ubicacion -> 'provincia' (entra directo, sin selector ni NE)
//   solo ne     -> 'ne'        (entra directo a Niveles Estaticos - el
//                                mapa NE nunca depende de "ubicacion")
//   ninguno     -> 'ninguno'   (sin acceso a ningun mapa)
function mapaLogic_determinarAccesoMapas(permisos) {
  var ubicacion = !!(permisos && permisos.ubicacion);
  var ne = !!(permisos && permisos.ne);
  if (ubicacion && ne) {
    return 'selector';
  }
  if (ubicacion) {
    return 'provincia';
  }
  if (ne) {
    return 'ne';
  }
  return 'ninguno';
}

// --- Busqueda dentro de los mapas (Etapa 1A) ---
// Normaliza texto para comparar sin distinguir mayusculas/minusculas,
// tildes, ni espacios repetidos - usado tanto para wellId+titular
// (Provincia) como para monitoringId/wellId/nombreOriginal (NE). Nunca
// altera el dato original en el dataset, solo el string efimero que se
// compara (mismo criterio de "raw se conserva, normalizado es aparte"
// aprobado para zona/cuenca en los datasets NE).
function mapaLogic_normalizarTexto(s) {
  return String(s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

// Arma un mapa wellId -> {nc16, titular} a partir del indice de
// getIndiceBusquedaProvincia, para no recorrer el array entero por cada
// tecla presionada durante la busqueda. NC16 y titular viajan JUNTOS en
// el mismo indice/permiso a proposito (decision de arquitectura
// aprobada, Etapa 1A: una nomenclatura catastral identifica una parcela
// fisica, igual de sensible que el titular - nunca un dataset separado
// gateado solo por "ubicacion").
function mapaLogic_indiceBusquedaPorWellId(indiceBusqueda) {
  var mapa = {};
  (indiceBusqueda || []).forEach(function (r) {
    if (r && r.wellId) {
      mapa[r.wellId] = { nc16: r.nc16 || null, titular: r.titular || null };
    }
  });
  return mapa;
}

// Busqueda local por substring normalizado sobre Pozos Provincia -
// wellId siempre, NC16 y titular solo si el indice (gateado por "datos")
// ya esta cargado. indiceBusquedaPorWellId es OPCIONAL (salida de
// mapaLogic_indiceBusquedaPorWellId) - si es null/undefined, la busqueda
// cae sola a "solo wellId", nunca intenta leer nc16/titular de ningun
// lado (fail-closed: sin el indice cargado, nunca se insinua un match
// por nc16/nombre). Nunca dispara ningun fetch - eso lo decide quien
// llama (ver mapa.js).
//
// Cada campo se compara POR SEPARADO (no un haystack unico concatenado)
// para poder reportar cual matcheo (matchNc16/matchTitular) - la UI usa
// eso para mostrar "NC16: ..." solo cuando el match fue justamente ahi,
// nunca en cada resultado (ver mapaController_renderResultadosBusqueda
// en mapa.js). Buscar por NC16 completo (16 digitos) da un match EXACTO
// de forma natural (substring de 2 strings de igual longitud solo
// matchea si son identicos) - no hace falta logica especial para eso, y
// nunca se hace fuzzy matching numerico.
function mapaLogic_buscarPozosProvincia(pozos, indiceBusquedaPorWellId, query, limite) {
  var q = mapaLogic_normalizarTexto(query);
  if (!q) {
    return [];
  }
  var lim = limite > 0 ? limite : 6;
  var resultados = [];
  for (var i = 0; i < pozos.length && resultados.length < lim; i++) {
    var p = pozos[i];
    var indice = indiceBusquedaPorWellId ? indiceBusquedaPorWellId[p.wellId] : null;
    var nc16 = indice ? indice.nc16 : null;
    var titular = indice ? indice.titular : null;

    var matchWellId = mapaLogic_normalizarTexto(p.wellId).indexOf(q) !== -1;
    var matchNc16 = nc16 ? mapaLogic_normalizarTexto(nc16).indexOf(q) !== -1 : false;
    var matchTitular = titular ? mapaLogic_normalizarTexto(titular).indexOf(q) !== -1 : false;

    if (matchWellId || matchNc16 || matchTitular) {
      resultados.push({
        wellId: p.wellId, lat: p.lat, lon: p.lon, estado: p.estado,
        nc16: nc16, titular: titular,
        matchNc16: matchNc16, matchTitular: matchTitular
      });
    }
  }
  return resultados;
}

// Busqueda local por substring normalizado sobre Niveles Estaticos -
// wellId/monitoringId/nombreOriginal, los 3 campos que ya viajan en el
// dataset de getMapaNE (nunca hace falta un dato nuevo). Funciona igual
// para puntos con wellId que para especiales (nombreOriginal/
// monitoringId siguen presentes sin el).
function mapaLogic_buscarPuntosNE(puntos, query, limite) {
  var q = mapaLogic_normalizarTexto(query);
  if (!q) {
    return [];
  }
  var lim = limite > 0 ? limite : 6;
  var resultados = [];
  for (var i = 0; i < puntos.length && resultados.length < lim; i++) {
    var p = puntos[i];
    var haystack = mapaLogic_normalizarTexto([p.monitoringId, p.wellId, p.nombreOriginal].filter(Boolean).join(' '));
    if (haystack.indexOf(q) !== -1) {
      resultados.push(p);
    }
  }
  return resultados;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MAPA_DEPARTAMENTOS,
    MAPA_ESTADO_LABEL,
    mapaLogic_departamentoDeWellId,
    mapaLogic_nombreDepartamento,
    mapaLogic_estadoLabel,
    mapaLogic_construirOpcionesDepartamento,
    mapaLogic_filtrarPorDepartamento,
    mapaLogic_filtrarPorEstado,
    mapaLogic_dividirChipsDepartamento,
    mapaLogic_debeConsultarSummary,
    mapaLogic_debeMostrarChipNE,
    mapaLogic_nombrePuntoNE,
    mapaLogic_setWellIdNE,
    mapaLogic_filtrarPorNE,
    mapaLogic_determinarAccesoMapas,
    mapaLogic_normalizarTexto,
    mapaLogic_indiceBusquedaPorWellId,
    mapaLogic_buscarPozosProvincia,
    mapaLogic_buscarPuntosNE
  };
}
