// MapaNEService: logica de negocio sobre la capa del Mapa NE - dataset
// SEPARADO de pozos.json/MapaService.js a proposito (aprobado - v2.1.0):
// mezclar la red de Niveles Estaticos con el dataset general del padron
// permitiria a un usuario con ubicacion=SI, ne=NO inferir que pozos
// pertenecen a la red NE con solo inspeccionar el JSON general. Por eso
// esto vive en su propio endpoint (getMapaNE, ver Api.js) gateado
// EXCLUSIVAMENTE por el permiso "ne" - nunca por "ubicacion".
//
// La sanitizacion aca es ESTRUCTURAL, igual que mapaService_sanitizarPunto:
// arma el punto de salida campo por campo (nunca "el resto del registro
// menos algunas claves"), para que un campo nuevo que se agregue a
// nivelesEstaticos.json en el futuro (ej. "propietario", que YA existe en
// el registro completo y nunca debe viajar por aca) no se filtre por
// default. No incluye titular/propietario ni ningun otro dato de ficha -
// solo lo minimo para pintar el mapa y armar el popup (ver
// nivelesEstaticosLogic mas abajo).
function mapaNEService_sanitizarPunto(punto, monitoringId) {
  return {
    monitoringId: punto.monitoringId || monitoringId,
    wellId: punto.wellId !== undefined ? punto.wellId : null,
    lat: punto.coordenadas.lat,
    lon: punto.coordenadas.lon,
    nombreOriginal: punto.nombreOriginal !== undefined ? punto.nombreOriginal : null
  };
}

function mapaNEService_tieneCoordenadasValidas(punto) {
  var c = punto.coordenadas;
  return !!(c && c.lat !== null && c.lat !== undefined && c.lon !== null && c.lon !== undefined);
}

function mapaNEService_getPuntos() {
  var result = nivelesEstaticosRepository_getTodosLosPuntos();
  if (!result.found) {
    return { found: false };
  }

  var puntos = [];
  for (var monitoringId in result.puntos) {
    if (!Object.prototype.hasOwnProperty.call(result.puntos, monitoringId)) {
      continue;
    }
    var punto = result.puntos[monitoringId];
    if (mapaNEService_tieneCoordenadasValidas(punto)) {
      puntos.push(mapaNEService_sanitizarPunto(punto, monitoringId));
    }
  }

  return { found: true, puntos: puntos };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { mapaNEService_getPuntos, mapaNEService_sanitizarPunto, mapaNEService_tieneCoordenadasValidas };
}
