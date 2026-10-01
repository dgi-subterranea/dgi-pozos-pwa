// Logica pura de "Seleccion de pozos" (Etapa "seleccion multiple + lote")
// - sin DOM, sin Leaflet, sin fetch. Mismo patron de separacion que
// js/mapaLogic.js/js/cercaMioLogic.js: la parte testeable sin navegador
// vive aca, el controlador DOM (dibujo del poligono sobre el mapa,
// bandeja, tabla) vive en js/seleccion.js.
//
// PRIVACIDAD: estas funciones son puras - el poligono/radio/centro que
// entra aca nunca sale hacia la red. Solo el resultado (una lista de
// wellId) puede eventualmente viajar al backend, y solo en las 2 llamadas
// explicitas (getItfAvailability/registerDescargaItf) - nunca la
// geometria en si.

// ---- Seleccion: operaciones de set sobre wellId ----
// La seleccion es SIEMPRE un array de wellId sin duplicados - nunca
// importa si vino de radio, poligono o (a futuro) seleccion manual, la
// fuente de verdad es unicamente este array (ver item 12 del cierre: no
// hace falta conservar todas las geometrias historicas).

function seleccionLogic_normalizar(wellIds) {
  return Array.from(new Set(wellIds || []));
}

function seleccionLogic_reemplazar(nuevos) {
  return seleccionLogic_normalizar(nuevos);
}

function seleccionLogic_agregar(actual, nuevos) {
  var set = new Set(actual || []);
  (nuevos || []).forEach(function (id) { set.add(id); });
  return Array.from(set);
}

function seleccionLogic_quitar(actual, wellId) {
  return (actual || []).filter(function (id) { return id !== wellId; });
}

function seleccionLogic_limpiar() {
  return [];
}

// ---- Poligono: point-in-polygon-or-boundary ----
// vertices: array de {lat, lon}, en el orden en que el usuario los toco.
// Se trata como poligono CERRADO automaticamente (el ultimo vertice se
// conecta con el primero) - el llamador nunca necesita repetir el primer
// punto al final.

// Distancia perpendicular de un punto a un SEGMENTO (no a la recta
// infinita) - si la proyeccion cae fuera de [A,B], se usa el extremo mas
// cercano. Funciona igual para segmentos horizontales, verticales o
// diagonales (no hay caso especial por orientacion, la formula es
// general) - por eso los tests de cada orientacion ejercitan la MISMA
// funcion con distintos vertices, no implementaciones distintas.
function seleccionLogic_distanciaPuntoASegmento(px, py, ax, ay, bx, by) {
  var dx = bx - ax;
  var dy = by - ay;
  if (dx === 0 && dy === 0) {
    // segmento degenerado (2 vertices iguales) - distancia al punto A
    var ddx = px - ax, ddy = py - ay;
    return Math.sqrt(ddx * ddx + ddy * ddy);
  }
  var t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  var cx = ax + t * dx;
  var cy = ay + t * dy;
  var ddx2 = px - cx, ddy2 = py - cy;
  return Math.sqrt(ddx2 * ddx2 + ddy2 * ddy2);
}

// Tolerancia default: robustez numerica (redondeo de punto flotante),
// NO un buffer geografico generoso - 1e-9 grados son ~0.0001mm en el
// ecuador, muchisimo menor que la precision real de una coordenada de
// pozo (~5-6 decimales, del orden de 1m). Un llamador puede pasar una
// tolerancia mayor si alguna vez hace falta (ver parametro opcional).
var SELECCION_POLIGONO_TOLERANCIA_DEFAULT = 1e-9;

// "interior O borde = seleccionado" (decision explicita del usuario,
// Etapa "seleccion multiple + lote", item 4 del cierre). Primero se
// revisa el borde (vertice o segmento) con tolerancia numerica - el
// ray-casting de abajo NO es determinista justo en el borde (depende de
// redondeo de punto flotante), asi que nunca se usa solo para decidir
// ese caso especifico.
function seleccionLogic_pointInPolygonOrBoundary(lat, lon, vertices, tolerancia) {
  if (!vertices || vertices.length < 3) {
    return false;
  }
  var tol = tolerancia !== undefined && tolerancia !== null ? tolerancia : SELECCION_POLIGONO_TOLERANCIA_DEFAULT;

  for (var i = 0; i < vertices.length; i++) {
    var a = vertices[i];
    var b = vertices[(i + 1) % vertices.length];
    if (seleccionLogic_distanciaPuntoASegmento(lon, lat, a.lon, a.lat, b.lon, b.lat) <= tol) {
      return true;
    }
  }

  // Ray-casting estandar (regla par-impar) para el interior - lat="y",
  // lon="x", tratamiento uniforme sin importar la orientacion.
  var dentro = false;
  for (var j = 0, k = vertices.length - 1; j < vertices.length; k = j++) {
    var vi = vertices[j];
    var vk = vertices[k];
    var interseca = ((vi.lat > lat) !== (vk.lat > lat)) &&
      (lon < (vk.lon - vi.lon) * (lat - vi.lat) / (vk.lat - vi.lat) + vi.lon);
    if (interseca) {
      dentro = !dentro;
    }
  }
  return dentro;
}

// Bounding box barato (min/max lat/lon de los vertices) - mismo criterio
// que cercaMioLogic_boundingBox en js/cercaMioLogic.js: un descarte
// masivo con comparaciones simples ANTES de pagar el costo real
// (distancia a cada segmento + ray-casting) en cada punto. Esto NO es
// una optimizacion espacial compleja (nunca un quadtree/R-tree) - es el
// mismo prefiltro ya usado en el resto de la app, agregado porque la
// medicion real con el dataset completo (ver js/seleccionLogic.test.js,
// "rendimiento") mostro que vale la pena con poligonos de muchos
// vertices (ver item 11 del cierre: "no agregar salvo que las
// mediciones indiquen que hace falta" - esto SI lo indico).
function seleccionLogic_bboxDeVertices(vertices) {
  var latMin = vertices[0].lat, latMax = vertices[0].lat;
  var lonMin = vertices[0].lon, lonMax = vertices[0].lon;
  for (var i = 1; i < vertices.length; i++) {
    if (vertices[i].lat < latMin) { latMin = vertices[i].lat; }
    if (vertices[i].lat > latMax) { latMax = vertices[i].lat; }
    if (vertices[i].lon < lonMin) { lonMin = vertices[i].lon; }
    if (vertices[i].lon > lonMax) { lonMax = vertices[i].lon; }
  }
  return { latMin: latMin, latMax: latMax, lonMin: lonMin, lonMax: lonMax };
}

// Filtra el dataset completo (ej. los 13.804 de pozos.json) y devuelve
// SOLO los wellId que caen dentro o en el borde del poligono - mismo
// shape de salida que un resultado de busqueda por radio
// (cercaMioLogic_buscarCercanos devuelve objetos; esto devuelve wellId
// directo porque no hay "distancia" que ordenar, ver item D del cierre:
// ambos caminos desembocan en la misma seleccionLogic_reemplazar/agregar).
function seleccionLogic_filtrarPorPoligono(puntos, vertices, tolerancia) {
  if (!vertices || vertices.length < 3) {
    return [];
  }
  var bbox = seleccionLogic_bboxDeVertices(vertices);
  var resultado = [];
  for (var i = 0; i < puntos.length; i++) {
    var p = puntos[i];
    if (p.lat < bbox.latMin || p.lat > bbox.latMax || p.lon < bbox.lonMin || p.lon > bbox.lonMax) {
      continue;
    }
    if (seleccionLogic_pointInPolygonOrBoundary(p.lat, p.lon, vertices, tolerancia)) {
      resultado.push(p.wellId);
    }
  }
  return resultado;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SELECCION_POLIGONO_TOLERANCIA_DEFAULT,
    seleccionLogic_normalizar,
    seleccionLogic_reemplazar,
    seleccionLogic_agregar,
    seleccionLogic_quitar,
    seleccionLogic_limpiar,
    seleccionLogic_distanciaPuntoASegmento,
    seleccionLogic_pointInPolygonOrBoundary,
    seleccionLogic_bboxDeVertices,
    seleccionLogic_filtrarPorPoligono
  };
}
