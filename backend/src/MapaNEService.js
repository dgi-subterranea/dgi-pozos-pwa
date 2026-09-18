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
// default. No incluye titular/propietario/domicilio ni ningun otro dato
// de ficha - solo lo minimo para pintar el mapa, armar el popup y los
// filtros (ver nivelesEstaticosLogic mas abajo).
//
// Etapa 1B (filtros del mapa NE): cuenca/zona/estadoMonitoreo YA
// estaban en el archivo fuente (los escribe reindex_niveles_estaticos.py
// desde NE_General_2026.csv) - esto solo empieza a PASARLOS, nunca los
// inventa. tieneMedicion2026/tieneHistorico/esEspecial son derivados
// (booleanos, nunca se exponen los arrays campana2026[]/historico[]
// completos - esos arrays traen fecha/persona/observacion, mas detalle
// del necesario para un filtro de mapa, y quedan fuera a proposito).
function mapaNEService_sanitizarPunto(punto, monitoringId) {
  var wellId = punto.wellId !== undefined ? punto.wellId : null;
  return {
    monitoringId: punto.monitoringId || monitoringId,
    wellId: wellId,
    lat: punto.coordenadas.lat,
    lon: punto.coordenadas.lon,
    nombreOriginal: punto.nombreOriginal !== undefined ? punto.nombreOriginal : null,
    cuenca: punto.cuenca !== undefined ? punto.cuenca : null,
    zona: punto.zona !== undefined ? punto.zona : null,
    zonaNormalizada: mapaNEService_normalizarZona(punto.zona),
    estadoMonitoreo: punto.estadoMonitoreo !== undefined ? punto.estadoMonitoreo : null,
    tieneMedicion2026: !!(punto.campana2026 && punto.campana2026.length > 0),
    tieneHistorico: !!(punto.historico && punto.historico.length > 0),
    esEspecial: !wellId
  };
}

// zona se conserva RAW sin tocar (arriba) - esto es SOLO la version para
// filtro/UI, nunca reemplaza al dato original (mismo criterio aprobado
// para Etapa 1B: "raw no se altera, para agrupacion/filtro usar una
// representacion normalizada"). Trim + colapso de espacios siempre;
// una palabra se re-capitaliza SOLO si esta INTEGRAMENTE en mayusculas
// (ej. "NORTE" -> "Norte") - una palabra que ya tiene minusculas
// mezcladas (ej. "del" en "Valle del Toba", o "Libre-Confinado" ya bien
// escrito) se deja intacta, para no reescribir casos que no tenian
// ninguna ambiguedad real que resolver (medido contra los datos reales:
// esto fusiona exactamente "NORTE"+"Norte" -> "Norte" sin tocar ningun
// otro valor). Nunca fusiona categorias semanticamente distintas ("Libre
// Centro" y "Libre Centro-Sur" siguen siendo 2 valores separados).
function mapaNEService_normalizarZona(zona) {
  if (!zona) {
    return null;
  }
  var recortado = String(zona).trim().replace(/\s+/g, ' ');
  return recortado.replace(/[^\s-]+/g, function (palabra) {
    if (palabra === palabra.toUpperCase() && palabra !== palabra.toLowerCase()) {
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    }
    return palabra;
  });
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
  module.exports = {
    mapaNEService_getPuntos,
    mapaNEService_sanitizarPunto,
    mapaNEService_tieneCoordenadasValidas,
    mapaNEService_normalizarZona
  };
}
