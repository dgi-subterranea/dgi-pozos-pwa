// Logica pura de "Pozos cerca mio" - sin DOM, sin geolocation, sin
// fetch (esas partes viven en js/cercaMio.js, que no se testea por
// convencion del proyecto, igual que js/mapa.js/js/app.js). Mismo
// patron de separacion que js/mapaLogic.js.
//
// PRIVACIDAD: estas funciones son puras - reciben lat/lon como
// argumentos y devuelven datos, nunca hacen red ni tocan el DOM. La
// posicion del usuario nunca sale de aca hacia ningun lado (ver
// js/cercaMio.js para la garantia completa del flujo).

var CERCA_MIO_RADIOS_METROS = [500, 1000, 2000, 5000];
var CERCA_MIO_RADIO_DEFAULT_METROS = 2000;
var CERCA_MIO_MAX_RESULTADOS = 30;

var RADIO_TIERRA_METROS = 6371000;
// Constante estandar (WGS84 esferico, suficiente para esta escala - no
// hace falta un elipsoide exacto para distancias de unos pocos km).
var METROS_POR_GRADO_LAT = 111320;

function cercaMioLogic_haversineMetros(lat1, lon1, lat2, lon2) {
  var toRad = Math.PI / 180;
  var phi1 = lat1 * toRad;
  var phi2 = lat2 * toRad;
  var deltaPhi = (lat2 - lat1) * toRad;
  var deltaLambda = (lon2 - lon1) * toRad;

  var a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return RADIO_TIERRA_METROS * c;
}

// Rectangulo (en grados) que contiene el circulo de radioMetros
// alrededor de (lat, lon) - superset barato del circulo real, pensado
// para descartar la enorme mayoria de los 13800 puntos con comparaciones
// simples ANTES de pagar el costo de Haversine (trigonometria) en cada
// uno. La correccion final (circulo exacto) la hace
// cercaMioLogic_buscarCercanos despues, con Haversine sobre los
// candidatos que sobrevivieron al bounding box.
function cercaMioLogic_boundingBox(lat, lon, radioMetros) {
  var deltaLat = radioMetros / METROS_POR_GRADO_LAT;
  var metrosPorGradoLon = METROS_POR_GRADO_LAT * Math.cos(lat * Math.PI / 180);
  // Cerca de los polos metrosPorGradoLon tiende a 0 (nunca en Mendoza,
  // pero por las dudas no se divide por 0 y se cae a "todo el mundo" en
  // longitud en vez de romper).
  var deltaLon = metrosPorGradoLon > 0 ? radioMetros / metrosPorGradoLon : 180;

  return {
    latMin: lat - deltaLat,
    latMax: lat + deltaLat,
    lonMin: lon - deltaLon,
    lonMax: lon + deltaLon
  };
}

function cercaMioLogic_formatearDistancia(metros) {
  if (metros < 1000) {
    return Math.round(metros) + ' m';
  }
  // "2 km" en vez de "2.0 km" para un radio redondo (los 4 radios de la
  // app siempre lo son) - "1.8 km" conserva el decimal para una
  // distancia real de un resultado, donde si importa la precision.
  var km = metros / 1000;
  var conDecimal = km.toFixed(1);
  return (conDecimal.slice(-2) === '.0' ? km.toFixed(0) : conDecimal) + ' km';
}

// Flujo completo pedido: bounding box (barato, descarta la mayoria) ->
// Haversine exacto sobre los candidatos -> filtro final por el circulo
// real (el bounding box es un cuadrado, deja pasar las 4 esquinas de mas)
// -> orden ascendente por distancia -> maximo maxResultados.
function cercaMioLogic_buscarCercanos(pozos, lat, lon, radioMetros, maxResultados) {
  var max = maxResultados || CERCA_MIO_MAX_RESULTADOS;
  var bbox = cercaMioLogic_boundingBox(lat, lon, radioMetros);

  var candidatos = pozos.filter(function (p) {
    return p.lat >= bbox.latMin && p.lat <= bbox.latMax && p.lon >= bbox.lonMin && p.lon <= bbox.lonMax;
  });

  var conDistancia = [];
  for (var i = 0; i < candidatos.length; i++) {
    var p = candidatos[i];
    var distancia = cercaMioLogic_haversineMetros(lat, lon, p.lat, p.lon);
    if (distancia <= radioMetros) {
      conDistancia.push({ wellId: p.wellId, lat: p.lat, lon: p.lon, estado: p.estado, distanciaMetros: distancia });
    }
  }

  conDistancia.sort(function (a, b) { return a.distanciaMetros - b.distanciaMetros; });

  return conDistancia.slice(0, max);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CERCA_MIO_RADIOS_METROS,
    CERCA_MIO_RADIO_DEFAULT_METROS,
    CERCA_MIO_MAX_RESULTADOS,
    cercaMioLogic_haversineMetros,
    cercaMioLogic_boundingBox,
    cercaMioLogic_formatearDistancia,
    cercaMioLogic_buscarCercanos
  };
}
