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
// MATRIZ DE ACCESO a modulos/pantallas - la UNICA fuente de verdad para
// app.js (que botones del hub y tarjetas del selector mostrar), para
// mapa.js/cercaMio.js (defensa en profundidad al abrir) y para el selector
// de mapas. Reglas (decididas por producto):
//   - Pozos cerca mio: todo usuario ACTIVO, sin depender de ningun permiso.
//   - Mapa Pozos Provincia: perfil=SI (o ne=SI: quien ve Niveles Estaticos
//     tambien ve las dos opciones en el selector).
//   - Mapa Niveles Estaticos: solo ne=SI.
//   - Selector de mapas ('selector'): cuando hay DOS opciones (ne=SI);
//     'provincia' = entra directo a Provincia sin selector (perfil=SI,
//     ne=NO); 'ninguno' = sin acceso a Mapas (perfil=NO y ne=NO).
//   - Perfil/ITF: perfil=SI. Evaluacion/Reemplazo: reemplazo=SI.
//   - datos y ubicacion NO deciden ninguno de estos accesos: siguen
//     controlando solo su informacion protegida (ficha / ubicacion
//     individual del pozo), en el backend y en el detalle del pozo.
// Usuario inactivo (o sin sesion): todo cerrado, fail-closed.
function mapaLogic_calcularAccesos(permisos, activo) {
  if (!activo) {
    return { cercaMio: false, mapas: 'ninguno', provincia: false, ne: false, itf: false, reemplazo: false };
  }
  var p = permisos || {};
  var perfil = p.perfil === true;
  var ne = p.ne === true;
  return {
    cercaMio: true,
    mapas: ne ? 'selector' : (perfil ? 'provincia' : 'ninguno'),
    provincia: perfil || ne,
    ne: ne,
    itf: perfil,
    reemplazo: p.reemplazo === true
  };
}

// Que le corresponde ver al usuario al tocar "Mapa de pozos" ('selector' |
// 'provincia' | 'ninguno') - ver mapaLogic_calcularAccesos.
function mapaLogic_determinarAccesoMapas(permisos) {
  return mapaLogic_calcularAccesos(permisos, true).mapas;
}

function mapaLogic_puedeVerProvincia(permisos) {
  return mapaLogic_calcularAccesos(permisos, true).provincia;
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

// --- Filtros del mapa Niveles Estaticos (Etapa 1B) ---

var MAPA_NE_ESTADO_LABEL = { ACTIVO: 'Activo', INACTIVO: 'Inactivo' };

// null/ausente -> "Sin dato", nunca se inventa un estado - mismo
// criterio que mapaLogic_estadoLabel, pero con un default explicito para
// el caso sin dato (71/405 puntos reales, ver diagnostico Etapa 1B).
function mapaLogic_estadoMonitoreoLabel(estado) {
  return estado ? (MAPA_NE_ESTADO_LABEL[estado] || estado) : 'Sin dato';
}

// Generico: opciones de un filtro de un solo campo (cuenca o
// zonaNormalizada) - SOLO los valores que realmente aparecen en el
// dataset recibido (mismo criterio que
// mapaLogic_construirOpcionesDepartamento: listar un valor sin ningun
// punto es ruido, no informacion). Orden alfabetico ('es'), igual que
// departamento. Puntos con el campo null/vacio no cuentan para ninguna
// opcion (quedan afuera del filtro especifico, visibles solo bajo
// "todos" - ver mapaLogic_filtrarPorCampoNE).
function mapaLogic_construirOpcionesCampoNE(puntos, campo) {
  var conteos = {};
  (puntos || []).forEach(function (p) {
    var v = p && p[campo];
    if (v) {
      conteos[v] = (conteos[v] || 0) + 1;
    }
  });
  var opciones = Object.keys(conteos).map(function (v) {
    return { valor: v, cantidad: conteos[v] };
  });
  opciones.sort(function (a, b) { return a.valor.localeCompare(b.valor, 'es'); });
  return opciones;
}

// Generico: filtro de seleccion UNICA sobre un campo (cuenca o
// zonaNormalizada) - 'todos'/vacio/ausente devuelve el dataset completo
// sin tocar (mismo criterio que mapaLogic_filtrarPorDepartamento).
function mapaLogic_filtrarPorCampoNE(puntos, campo, valorActivo) {
  if (!valorActivo || valorActivo === 'todos') {
    return puntos;
  }
  return puntos.filter(function (p) { return p[campo] === valorActivo; });
}

// Estado de monitoreo: a diferencia de cuenca/zona (dinamico, muchos
// valores posibles) este es un filtro de 3 categorias FIJAS
// (Activo/Inactivo/Sin dato) - los chips son estaticos en el HTML, esta
// funcion solo calcula el conteo real de cada uno para mostrarlo en la
// etiqueta (ej. "Activo (274)").
function mapaLogic_construirConteoEstadoMonitoreo(puntos) {
  var conteo = { ACTIVO: 0, INACTIVO: 0, SIN_DATO: 0 };
  (puntos || []).forEach(function (p) {
    if (p && p.estadoMonitoreo === 'ACTIVO') {
      conteo.ACTIVO++;
    } else if (p && p.estadoMonitoreo === 'INACTIVO') {
      conteo.INACTIVO++;
    } else {
      conteo.SIN_DATO++;
    }
  });
  return conteo;
}

// Filtro multi-toggle de 3 estados - mismo criterio que
// mapaLogic_filtrarPorEstado (Provincia): 0 activos se interpreta como
// "sin filtro" (nunca una lista vacia ambigua), nunca deja el mapa en un
// estado confuso.
function mapaLogic_filtrarPorEstadoMonitoreo(puntos, activos) {
  var activo = !!(activos && activos.ACTIVO);
  var inactivo = !!(activos && activos.INACTIVO);
  var sinDato = !!(activos && activos.SIN_DATO);
  if (!activo && !inactivo && !sinDato) {
    return puntos;
  }
  return puntos.filter(function (p) {
    if (p.estadoMonitoreo === 'ACTIVO') { return activo; }
    if (p.estadoMonitoreo === 'INACTIVO') { return inactivo; }
    return sinDato;
  });
}

// Generico para los 3 filtros binarios derivados de un campo booleano
// del punto (tieneMedicion2026, tieneHistorico, esEspecial) - mismo
// criterio de "0 activos = sin filtro" que el resto. mostrarTrue/
// mostrarFalse son los 2 toggles independientes del grupo (ej. "Con
// medición"/"Sin medición"), nunca acoplados a un nombre de campo
// especifico para poder reusar la misma funcion en los 3 grupos.
function mapaLogic_filtrarPorFlagNE(puntos, campo, mostrarTrue, mostrarFalse) {
  if (!mostrarTrue && !mostrarFalse) {
    return puntos;
  }
  return puntos.filter(function (p) {
    return (p[campo] && mostrarTrue) || (!p[campo] && mostrarFalse);
  });
}

// --- Cuenca/Departamento/etc: multi-seleccion (OR dentro del grupo) ---

// Generico: filtro OR multi-seleccion sobre un campo dinamico (Cuenca en
// NE y Provincia, etc.) - activos es un mapa DISPERSO {valor: true} (ver
// mapaLogic_toggleFiltroMultiple: solo se guardan las claves activas,
// nunca claves en false). Vacio == "Todos"/sin filtro - ese es el UNICO
// caso de "sin filtro" (a diferencia de una version anterior de esta
// funcion, que tambien trataba "todas activas" como sin filtro; con el
// modelo disperso actual esa rama quedaria SIEMPRE verdadera para
// cualquier seleccion no vacia, porque toda clave presente ya esta en
// true por construccion - hubiera sido un bug real, no dead code).
function mapaLogic_filtrarPorCampoMultipleNE(puntos, campo, activos) {
  var activas = Object.keys(activos || {}).filter(function (k) { return activos[k]; });
  if (activas.length === 0) {
    return puntos;
  }
  return puntos.filter(function (p) { return !!activos[p[campo]]; });
}

// Opciones de un campo dinamico CONDICIONADAS por un universo mas chico
// (ej. Zona condicionada por la Cuenca activa) - a diferencia de
// mapaLogic_construirOpcionesCampoNE, esta SIEMPRE lista todos los
// valores que existen en puntosCompletos (nunca se saca un valor del DOM
// solo porque el universo actual lo dejo en 0 - pedido explicito: "no
// eliminarla del DOM, mostrarla deshabilitada"), pero cuenta cada uno
// SOLO contra puntosUniverso. Un valor con cantidad:0 es candidato a
// deshabilitarse en la UI - lo decide el controlador, esta funcion solo
// da el numero real.
function mapaLogic_construirOpcionesCampoCondicionadoNE(puntosCompletos, puntosUniverso, campo) {
  var valores = {};
  (puntosCompletos || []).forEach(function (p) {
    var v = p && p[campo];
    if (v) {
      valores[v] = true;
    }
  });
  var conteoUniverso = {};
  (puntosUniverso || []).forEach(function (p) {
    var v = p && p[campo];
    if (v) {
      conteoUniverso[v] = (conteoUniverso[v] || 0) + 1;
    }
  });
  var opciones = Object.keys(valores).map(function (v) {
    return { valor: v, cantidad: conteoUniverso[v] || 0 };
  });
  opciones.sort(function (a, b) { return a.valor.localeCompare(b.valor, 'es'); });
  return opciones;
}

// Un valor seleccionado (ej. zonaActiva) sigue siendo aplicable despues
// de recalcular sus opciones condicionadas (ej. tras cambiar Cuenca) -
// 'todos' siempre es valido (nunca depende del universo). Se usa para
// decidir si hay que deseleccionar automaticamente (ver Etapa 1B.1,
// punto C: "no dejar filtros invisibles/imposibles activos").
// NOTA: pensada para el patron single-select original de Zona - para el
// patron multi-select actual (Etapa "unificacion UX"), ver
// mapaLogic_limpiarActivosInvalidos, que hace lo mismo pero sobre un
// conjunto de valores en vez de uno solo.
function mapaLogic_valorSigueDisponible(opciones, valor) {
  if (!valor || valor === 'todos') {
    return true;
  }
  var opcion = (opciones || []).filter(function (o) { return o.valor === valor; })[0];
  return !!(opcion && opcion.cantidad > 0);
}

// --- Unificacion UX de filtros (ambos mapas) ---
//
// Modelo unico para TODO grupo de chips multi-seleccion en Provincia y
// NE (Cuenca, Departamento, Ubicacion, Zona, Estado, Medicion 2026,
// Historico, Tipo): 'activos' es un mapa disperso {valor: true} que
// SOLO contiene las claves activas (nunca claves en false - una clave
// ausente YA significa "no activa", no hace falta guardarla explicita).
// Vacio ({}) siempre significa "Todos" (sin filtro de este grupo) - esa
// equivalencia es la base de toda la semantica pedida:
//   - tocar un valor individual estando en "Todos" -> dejo de estar
//     vacio, por lo tanto "Todos" se desactiva SOLO (nunca hace falta
//     codigo aparte para "apagar Todos").
//   - tocar mas valores -> se van sumando (OR dentro del grupo).
//   - apagar el ultimo valor activo -> el mapa vuelve a quedar vacio,
//     por lo tanto "Todos" se reactiva SOLO.
//   - tocar "Todos" -> se limpian todos los valores individuales.
function mapaLogic_toggleFiltroMultiple(activos, valor) {
  if (!valor || valor === 'todos') {
    return {};
  }
  var nuevo = Object.assign({}, activos);
  if (nuevo[valor]) {
    delete nuevo[valor];
  } else {
    nuevo[valor] = true;
  }
  return nuevo;
}

// Generico: filtro OR multi-seleccion sobre un campo DERIVADO (no un
// campo literal del punto) - Departamento no vive como string en el
// punto, se deriva del wellId (ver mapaLogic_departamentoDeWellId).
// Mismo criterio "vacio = sin filtro" que el resto.
function mapaLogic_filtrarPorCampoDerivadoMultiple(puntos, derivar, activos) {
  var claves = Object.keys(activos || {}).filter(function (k) { return activos[k]; });
  if (claves.length === 0) {
    return puntos;
  }
  return puntos.filter(function (p) { return !!activos[derivar(p)]; });
}

function mapaLogic_filtrarPorDepartamentoMultiple(puntos, activos) {
  return mapaLogic_filtrarPorCampoDerivadoMultiple(puntos, function (p) {
    return mapaLogic_departamentoDeWellId(p.wellId);
  }, activos);
}

// Limpia de 'activos' (mapa disperso) cualquier valor que ya no figure
// con cantidad>0 en 'opciones' condicionadas (ej. Zona tras cambiar
// Cuenca - Etapa 1B.1/C) - version MULTI-valor de
// mapaLogic_valorSigueDisponible: si alguno de los valores activos dejo
// de ser valido, se saca SOLO ese (los demas activos que sigan siendo
// validos se preservan). Si el resultado queda vacio, es exactamente
// "Todos" (mismo criterio de todo el modulo) - no hace falta un caso
// especial para eso.
function mapaLogic_limpiarActivosInvalidos(activos, opciones) {
  var cantidadPorValor = {};
  (opciones || []).forEach(function (o) { cantidadPorValor[o.valor] = o.cantidad; });
  var nuevo = {};
  Object.keys(activos || {}).forEach(function (k) {
    if (activos[k] && cantidadPorValor[k] > 0) {
      nuevo[k] = true;
    }
  });
  return nuevo;
}

// --- Conteos contextuales de los chips ---
//
// Los conteos de un chip se calculan sobre el UNIVERSO vigente (todo el
// padron, o solo los pozos de la seleccion/vista previa cuando el alcance
// es "solo"), nunca sobre el padron completo mientras se trabaja sobre un
// contexto: "Rio Mendoza (22)" tiene que significar 22 de los 40 pozos de
// la seleccion, no 6.739. Mismo criterio de facetas que ya existia: el
// conteo es del universo, sin cruzar con los OTROS grupos de filtros.

// Combina las opciones del padron completo (globales: fijan el orden y los
// nombres) con las del universo vigente (contextuales: fijan la cantidad).
// Un valor sin ningun pozo en el universo se oculta, salvo que este
// ACTIVO: ahi se conserva con cantidad 0 para que el filtro nunca quede
// invisible (y el usuario pueda destildarlo). clave = 'valor' o 'codigo'.
function mapaLogic_aplicarConteosContextuales(globales, contextuales, clave, activos) {
  var cantidadPorClave = {};
  (contextuales || []).forEach(function (o) { cantidadPorClave[o[clave]] = o.cantidad; });
  var resultado = [];
  (globales || []).forEach(function (g) {
    var cantidad = cantidadPorClave[g[clave]] || 0;
    if (cantidad > 0 || (activos && activos[g[clave]])) {
      var copia = {};
      Object.keys(g).forEach(function (k) { copia[k] = g[k]; });
      copia.cantidad = cantidad;
      resultado.push(copia);
    }
  });
  return resultado;
}

// Conteo de Ubicacion: { C: n, D: n } sobre el universo.
function mapaLogic_contarPorEstado(pozos) {
  var conteo = { C: 0, D: 0 };
  (pozos || []).forEach(function (p) {
    if (p.estado === 'C' || p.estado === 'D') {
      conteo[p.estado] += 1;
    }
  });
  return conteo;
}

// Conteo de "Tiene NE": pozos del universo presentes en la red NE. Sin Set
// cargado (todavia no se pidio el dataset NE) devuelve null: no hay numero
// honesto que mostrar, el chip queda sin conteo.
function mapaLogic_contarEnSetNE(pozos, setNE) {
  if (!setNE) {
    return null;
  }
  var n = 0;
  (pozos || []).forEach(function (p) {
    if (p.wellId && setNE.has(p.wellId)) {
      n += 1;
    }
  });
  return n;
}

// --- Filtro por profundidad (Desde/Hasta) ---
//
// Validacion pura del rango ingresado por el usuario - nunca acepta
// negativos (la fuente real, tecnicas.profundidadTotal, no tiene ningun
// valor negativo: 0 casos medidos sobre 19.076 valores reales) y nunca
// aplica un rango invertido (Desde > Hasta) - en vez de "corregirlo"
// solo, devuelve un error amigable para que la UI lo muestre y NO
// aplique el filtro, tal como se pidio.
function mapaLogic_validarRangoProfundidad(desdeTexto, hastaTexto) {
  var desdeVacio = desdeTexto === '' || desdeTexto === null || desdeTexto === undefined;
  var hastaVacio = hastaTexto === '' || hastaTexto === null || hastaTexto === undefined;

  var desde = desdeVacio ? null : Number(desdeTexto);
  var hasta = hastaVacio ? null : Number(hastaTexto);

  if (!desdeVacio && isNaN(desde)) {
    return { valido: false, error: 'Desde debe ser un número.', desde: null, hasta: null };
  }
  if (!hastaVacio && isNaN(hasta)) {
    return { valido: false, error: 'Hasta debe ser un número.', desde: null, hasta: null };
  }
  if (desde !== null && desde < 0) {
    return { valido: false, error: 'Desde no puede ser negativo.', desde: null, hasta: null };
  }
  if (hasta !== null && hasta < 0) {
    return { valido: false, error: 'Hasta no puede ser negativo.', desde: null, hasta: null };
  }
  if (desde !== null && hasta !== null && desde > hasta) {
    return { valido: false, error: 'Desde no puede ser mayor que Hasta.', desde: null, hasta: null };
  }
  return { valido: true, error: null, desde: desde, hasta: hasta };
}

// Filtro puro Desde<=profundidad<=Hasta (cualquiera de los 2 extremos
// puede faltar) - campo parametrizable porque el nombre sanitizado es el
// mismo en ambos mapas ('profundidad', ver MapaService.js/
// MapaNEService.js), pero la funcion no asume ningun nombre fijo.
// Ambos vacios (desde=null Y hasta=null) -> sin filtro, dataset
// completo. Un punto sin profundidad (null/undefined) SIEMPRE queda
// excluido si hay CUALQUIER extremo activo (decision explicita: un dato
// ausente no puede "pasar" un filtro numerico que si esta pidiendo un
// rango) - y aparece normalmente si el filtro esta vacio.
function mapaLogic_filtrarPorRangoProfundidad(puntos, desde, hasta, campo) {
  var campoReal = campo || 'profundidad';
  if (desde === null && hasta === null) {
    return puntos;
  }
  return puntos.filter(function (p) {
    var v = p[campoReal];
    if (v === null || v === undefined) {
      return false;
    }
    if (desde !== null && v < desde) {
      return false;
    }
    if (hasta !== null && v > hasta) {
      return false;
    }
    return true;
  });
}

// --- Filtro "Profundidad de filtros" (tramos filtrantes/ranurados) ---
//
// CONCEPTO DISTINTO de "Profundidad del pozo" (mapaLogic_filtrarPorRangoProfundidad,
// que compara contra un solo numero) - aca cada pozo trae una LISTA de
// tramos {desde,hasta} (0 a 5 reales, ver diagnostico), y la semantica
// pedida es "interseccion con al menos un tramo", no "el pozo entero
// cae dentro del rango". La VALIDACION del rango ingresado (negativos,
// Desde>Hasta, texto no numerico) se reusa tal cual de
// mapaLogic_validarRangoProfundidad - son las mismas reglas, un solo
// lugar que las define.

// Un tramo {desde,hasta} intersecta [desde,hasta] del filtro si se
// solapan en algun punto - equivalente a NO estar completamente afuera
// a ningun lado. null en cualquier extremo del filtro = ese lado no
// acota (comparacion siempre pasa de ese lado).
function mapaLogic_tramoIntersectaRango(tramo, desde, hasta) {
  if (!tramo || tramo.desde === null || tramo.desde === undefined || tramo.hasta === null || tramo.hasta === undefined) {
    return false;
  }
  if (desde !== null && tramo.hasta < desde) {
    return false;
  }
  if (hasta !== null && tramo.desde > hasta) {
    return false;
  }
  return true;
}

// Un pozo pasa si CUALQUIERA de sus tramos intersecta el rango pedido
// (ver ejemplo del pedido: Filtro1 80-110 + Filtro2 145-170, busqueda
// 100-150 -> pasa por Filtro1 solo, 100<=110 y 80<=150). Ambos vacios =
// sin filtro. Un pozo sin tramos (lista vacia/ausente) SIEMPRE queda
// excluido si el filtro esta activo - mismo criterio que
// mapaLogic_filtrarPorRangoProfundidad, un dato ausente no puede
// "pasar" un filtro que si esta pidiendo algo.
function mapaLogic_filtrarPorTramoFiltrante(puntos, desde, hasta, campo) {
  var campoReal = campo || 'tramosFiltrantes';
  if (desde === null && hasta === null) {
    return puntos;
  }
  return puntos.filter(function (p) {
    var tramos = p[campoReal];
    if (!tramos || tramos.length === 0) {
      return false;
    }
    return tramos.some(function (t) { return mapaLogic_tramoIntersectaRango(t, desde, hasta); });
  });
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
    mapaLogic_calcularAccesos,
    mapaLogic_puedeVerProvincia,
    mapaLogic_normalizarTexto,
    mapaLogic_indiceBusquedaPorWellId,
    mapaLogic_buscarPozosProvincia,
    mapaLogic_buscarPuntosNE,
    MAPA_NE_ESTADO_LABEL,
    mapaLogic_estadoMonitoreoLabel,
    mapaLogic_construirOpcionesCampoNE,
    mapaLogic_filtrarPorCampoNE,
    mapaLogic_construirConteoEstadoMonitoreo,
    mapaLogic_filtrarPorEstadoMonitoreo,
    mapaLogic_filtrarPorFlagNE,
    mapaLogic_filtrarPorCampoMultipleNE,
    mapaLogic_construirOpcionesCampoCondicionadoNE,
    mapaLogic_valorSigueDisponible,
    mapaLogic_toggleFiltroMultiple,
    mapaLogic_filtrarPorCampoDerivadoMultiple,
    mapaLogic_filtrarPorDepartamentoMultiple,
    mapaLogic_limpiarActivosInvalidos,
    mapaLogic_aplicarConteosContextuales,
    mapaLogic_contarPorEstado,
    mapaLogic_contarEnSetNE,
    mapaLogic_validarRangoProfundidad,
    mapaLogic_filtrarPorRangoProfundidad,
    mapaLogic_tramoIntersectaRango,
    mapaLogic_filtrarPorTramoFiltrante
  };
}
