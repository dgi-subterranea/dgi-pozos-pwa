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

// Decide si conviene pedir el summary liviano (titular/departamento/
// distrito) para el popup de un punto. El permiso se respeta ANTES de
// disparar la llamada de red, no solo al decidir que mostrar despues -
// mismo criterio que fetchSiTienePermiso en app.js.
function mapaLogic_debeConsultarSummary(permisos) {
  return !!(permisos && permisos.datos);
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
    mapaLogic_debeConsultarSummary
  };
}
