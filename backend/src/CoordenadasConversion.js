// Conversion y validacion de coordenadas INGRESADAS A MANO - COPIA BACKEND del algoritmo del frontend (js/coordenadasConversion.js).
//
//   - GMS (grados / minutos / segundos + hemisferio) -> WGS84 decimal.
//   - POSGAR 94 / Argentina 2 · EPSG:22182 (Gauss-Kruger faja 2; X = Este, Y = Norte, como el padron de este proyecto) <-> WGS84.
//
// Apps Script no comparte archivos con la PWA, por eso este archivo es una COPIA del frontend: el CUERPO (todo desde "var COORD_CRS_GMS") tiene que ser
// el mismo codigo. Un test (backend/test/CoordenadasConversion.test.js) compara ambos ignorando comentarios y falla si divergen, y otro corre los dos
// contra el fixture generado con pyproj (js/fixtures/posgar94_ar2_vectores.json, error maximo ~0,03 mm). Si se cambia un algoritmo, se cambia en los
// DOS archivos y se regenera/verifica el fixture.
//
// El backend NUNCA copia el resultado derivado por el cliente: UbicacionCorreccionService.js vuelve a calcular lat/lon desde el valor ORIGINAL
// (coordenadaOriginal) con estas funciones, usa SU resultado y solo compara contra el que mando el cliente (COORDENADA_INCONSISTENTE).
//
// Convencion de ejes de ESTE proyecto: X = Este, Y = Norte (igual que el padron). El IGN usa la inversa (X = Norte, Y = Este): por eso se detectan
// X/Y invertidos y NUNCA se intercambian solos.
//
// Convenciones de las funciones: ninguna lanza ante una entrada rara; devuelven {ok, ...} con errores por campo {codigo, mensaje} en espanol.
var COORD_CRS_GMS = 'GMS_WGS84';
var COORD_CRS_POSGAR94_AR2 = 'EPSG:22182';
var COORD_POSGAR_ETIQUETA = 'POSGAR 94 / Argentina 2 · EPSG:22182';

// Misma caja gruesa de Mendoza que el backend (UBICACION_CORR_MENDOZA_BBOX en UbicacionCorreccionService.js; un test las compara).
var COORD_MENDOZA_BBOX = { latMin: -37.65, latMax: -31.95, lonMin: -70.65, lonMax: -66.45 };

// Rangos de SANIDAD en POSGAR faja 2: la caja de Mendoza ocupa Este 2.34-2.74 M y Norte 5.83-6.47 M; se usa un rectangulo redondeado con margen. Sirven para
// dar mensajes claros (fuera de rango, X/Y invertidos); la AUTORIDAD sigue siendo la caja lat/lon de arriba aplicada al resultado.
var COORD_POSGAR_ESTE_MIN = 2300000;
var COORD_POSGAR_ESTE_MAX = 2800000;
var COORD_POSGAR_NORTE_MIN = 5800000;
var COORD_POSGAR_NORTE_MAX = 6500000;

// --- Elipsoide GRS80 y proyeccion (EPSG:22182: lat0 = -90, lon0 = -69, k0 = 1, FE = 2.500.000, FN = 0) ---
var COORD_TM_A = 6378137.0;
var COORD_TM_F = 1 / 298.257222101;
var COORD_TM_E = Math.sqrt(COORD_TM_F * (2 - COORD_TM_F));
var COORD_TM_N = COORD_TM_F / (2 - COORD_TM_F);
var COORD_TM_K0 = 1;
var COORD_TM_FE = 2500000;
var COORD_TM_FN = 0;
var COORD_TM_LON0 = -69 * Math.PI / 180;
var COORD_TM_RAD_A = COORD_TM_A / (1 + COORD_TM_N) * (1 + Math.pow(COORD_TM_N, 2) / 4 + Math.pow(COORD_TM_N, 4) / 64 + Math.pow(COORD_TM_N, 6) / 256);

// Coeficientes de la serie de Kruger (6to orden): alfa = directa, beta = inversa. n = tercer aplanamiento.
var COORD_TM_ALFA = (function () {
  var n = COORD_TM_N;
  return [
    n / 2 - 2 * n * n / 3 + 5 * Math.pow(n, 3) / 16 + 41 * Math.pow(n, 4) / 180 - 127 * Math.pow(n, 5) / 288 + 7891 * Math.pow(n, 6) / 37800,
    13 * n * n / 48 - 3 * Math.pow(n, 3) / 5 + 557 * Math.pow(n, 4) / 1440 + 281 * Math.pow(n, 5) / 630 - 1983433 * Math.pow(n, 6) / 1935360,
    61 * Math.pow(n, 3) / 240 - 103 * Math.pow(n, 4) / 140 + 15061 * Math.pow(n, 5) / 26880 + 167603 * Math.pow(n, 6) / 181440,
    49561 * Math.pow(n, 4) / 161280 - 179 * Math.pow(n, 5) / 168 + 6601661 * Math.pow(n, 6) / 7257600,
    34729 * Math.pow(n, 5) / 80640 - 3418889 * Math.pow(n, 6) / 1995840,
    212378941 * Math.pow(n, 6) / 319334400
  ];
})();
var COORD_TM_BETA = (function () {
  var n = COORD_TM_N;
  return [
    n / 2 - 2 * n * n / 3 + 37 * Math.pow(n, 3) / 96 - Math.pow(n, 4) / 360 - 81 * Math.pow(n, 5) / 512 + 96199 * Math.pow(n, 6) / 604800,
    n * n / 48 + Math.pow(n, 3) / 15 - 437 * Math.pow(n, 4) / 1440 + 46 * Math.pow(n, 5) / 105 - 1118711 * Math.pow(n, 6) / 3870720,
    17 * Math.pow(n, 3) / 480 - 37 * Math.pow(n, 4) / 840 - 209 * Math.pow(n, 5) / 4480 + 5569 * Math.pow(n, 6) / 90720,
    4397 * Math.pow(n, 4) / 161280 - 11 * Math.pow(n, 5) / 504 - 830251 * Math.pow(n, 6) / 7257600,
    4583 * Math.pow(n, 5) / 161280 - 108847 * Math.pow(n, 6) / 3991680,
    20648693 * Math.pow(n, 6) / 638668800
  ];
})();

// --- Proyeccion pura (sin validaciones: las hacen las funciones de evaluacion) ---

// (Este, Norte) en metros de EPSG:22182 -> {lat, lon} en grados (WGS84). Con lat0 = -90 el origen de latitud es el polo sur, donde xi = -pi/2.
function coordenadas_posgarAWgs84(este, norte) {
  var xi = (norte - COORD_TM_FN) / (COORD_TM_K0 * COORD_TM_RAD_A) - Math.PI / 2;
  var eta = (este - COORD_TM_FE) / (COORD_TM_K0 * COORD_TM_RAD_A);
  var xi0 = xi;
  var eta0 = eta;
  for (var j = 1; j <= 6; j++) {
    xi0 -= COORD_TM_BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    eta0 -= COORD_TM_BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  var chi = Math.asin(Math.sin(xi0) / Math.cosh(eta0));          // latitud conforme
  var lat = chi;
  for (var i = 0; i < 20; i++) {                                 // conforme -> geodesica (punto fijo; converge en 4-5 vueltas)
    var siguiente = Math.asin(Math.tanh(Math.atanh(Math.sin(chi)) + COORD_TM_E * Math.atanh(COORD_TM_E * Math.sin(lat))));
    var cambio = Math.abs(siguiente - lat);
    lat = siguiente;
    if (cambio < 1e-15) {
      break;
    }
  }
  var lon = COORD_TM_LON0 + Math.atan2(Math.sinh(eta0), Math.cos(xi0));
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

// Inversa de la anterior: {lat, lon} WGS84 -> {este, norte}. Sirve para ida y vuelta y para mostrar la coordenada equivalente.
function coordenadas_wgs84APosgar(latDeg, lonDeg) {
  var lat = latDeg * Math.PI / 180;
  var lon = lonDeg * Math.PI / 180;
  var t = Math.sinh(Math.atanh(Math.sin(lat)) - COORD_TM_E * Math.atanh(COORD_TM_E * Math.sin(lat)));
  var xi0 = Math.atan(t / Math.cos(lon - COORD_TM_LON0));
  var eta0 = Math.atanh(Math.sin(lon - COORD_TM_LON0) / Math.sqrt(1 + t * t));
  var xi = xi0;
  var eta = eta0;
  for (var j = 1; j <= 6; j++) {
    xi += COORD_TM_ALFA[j - 1] * Math.sin(2 * j * xi0) * Math.cosh(2 * j * eta0);
    eta += COORD_TM_ALFA[j - 1] * Math.cos(2 * j * xi0) * Math.sinh(2 * j * eta0);
  }
  return { este: COORD_TM_FE + COORD_TM_K0 * COORD_TM_RAD_A * eta, norte: COORD_TM_FN + COORD_TM_K0 * COORD_TM_RAD_A * (xi + Math.PI / 2) };
}

// --- Utilidades ---

function coordenadas_redondear(valor, decimales) {
  var f = Math.pow(10, decimales);
  return Math.round(valor * f) / f;
}

function coordenadas_error(codigo, mensaje) {
  return { codigo: codigo, mensaje: mensaje };
}

function coordenadas_dentroDeMendoza(lat, lon) {
  var b = COORD_MENDOZA_BBOX;
  return typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

// Parseo de un numero escrito por una persona. Acepta numeros y texto con coma o punto decimal, espacios y signo; NO acepta notacion cientifica, "NaN",
// "Infinity", varios signos ni texto suelto. opciones.permitirMiles (solo POSGAR, que son metros): "2.500.000,50" = 2500000.5 (puntos de miles + coma
// decimal); en GMS el punto SIEMPRE es decimal ("1.234" = 1,234 segundos). Devuelve {ok:true, valor} | {ok:false, motivo: 'vacio'|'invalido'}.
function coordenadas_parsearNumero(entrada, opciones) {
  var miles = !!(opciones && opciones.permitirMiles);
  if (typeof entrada === 'number') {
    return isFinite(entrada) ? { ok: true, valor: entrada } : { ok: false, motivo: 'invalido' };
  }
  if (entrada === null || entrada === undefined) {
    return { ok: false, motivo: 'vacio' };
  }
  if (typeof entrada !== 'string') {
    return { ok: false, motivo: 'invalido' };
  }
  var t = entrada.replace(/[\s  ]/g, '');
  if (t === '') {
    return { ok: false, motivo: 'vacio' };
  }
  if (miles && /^[+-]?\d{1,3}(\.\d{3})+(,\d+)?$/.test(t)) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^[+-]?\d*,\d+$/.test(t) || /^[+-]?\d+,$/.test(t)) {
    t = t.replace(',', '.');
  }
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) {
    return { ok: false, motivo: 'invalido' };
  }
  var v = Number(t);
  return isFinite(v) ? { ok: true, valor: v } : { ok: false, motivo: 'invalido' };
}

// --- GMS ---

var COORD_HEMISFERIOS = {
  lat: { N: 1, NORTE: 1, S: -1, SUR: -1 },
  lon: { E: 1, ESTE: 1, O: -1, OESTE: -1, W: -1, WEST: -1 }
};
var COORD_GMS_ETIQUETA_EJE = { lat: 'Latitud', lon: 'Longitud' };
var COORD_GMS_MAX_GRADOS = { lat: 90, lon: 180 };

// "-32", "-0", "-0,5" (texto con signo menos) o un numero < 0: el signo en GMS lo da SIEMPRE el hemisferio.
function coordenadas_esNegativo(entrada, parseado) {
  return parseado.valor < 0 || (typeof entrada === 'string' && /^\s*-/.test(entrada));
}

// 2500000 -> "2.500.000" (sin depender de Intl/ICU del entorno)
function coordenadas_formatearMiles(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// Un eje (latitud o longitud) en GMS -> grados decimales con signo. entrada: {g, m, s, h}; cada valor es numero o texto.
//  - grados: obligatorios, enteros, 0..90 (lat) / 0..180 (lon); minutos: enteros 0..59; segundos: 0 <= s < 60. Minutos y segundos vacios = 0.
//  - NUNCA negativos: el signo lo da el hemisferio (latitud N/S, longitud E/O; tambien W). Un "-32" con "S" seria ambiguo y se rechaza.
//  - el resultado no puede pasar de 90 / 180 grados.
// Devuelve {ok:true, valor, hemisferio, texto} | {ok:false, error:{campo, codigo, mensaje}}.
function coordenadas_gmsEjeADecimal(eje, entrada) {
  var nombre = COORD_GMS_ETIQUETA_EJE[eje];
  var e = entrada || {};
  function falla(campo, codigo, mensaje) {
    return { ok: false, error: { campo: campo, codigo: codigo, mensaje: mensaje } };
  }
  var g = coordenadas_parsearNumero(e.g);
  if (!g.ok) {
    return falla('g', g.motivo === 'vacio' ? 'GRADOS_REQUERIDOS' : 'GRADOS_INVALIDOS', g.motivo === 'vacio' ? nombre + ': ingresá los grados.' : nombre + ': los grados deben ser un número.');
  }
  var mTxt = e.m === '' || e.m === null || e.m === undefined ? 0 : e.m;
  var sTxt = e.s === '' || e.s === null || e.s === undefined ? 0 : e.s;
  var m = coordenadas_parsearNumero(mTxt);
  if (!m.ok) {
    return falla('m', 'MINUTOS_INVALIDOS', nombre + ': los minutos deben ser un número entero.');
  }
  var s = coordenadas_parsearNumero(sTxt);
  if (!s.ok) {
    return falla('s', 'SEGUNDOS_INVALIDOS', nombre + ': los segundos deben ser un número (con coma o punto decimal).');
  }
  var negativo = coordenadas_esNegativo(e.g, g) ? 'g' : (coordenadas_esNegativo(mTxt, m) ? 'm' : (coordenadas_esNegativo(sTxt, s) ? 's' : null));
  if (negativo) {
    return falla(negativo, 'NEGATIVO', nombre + ': no uses valores negativos; el signo lo da el hemisferio (' + (eje === 'lat' ? 'N / S' : 'E / O') + ').');
  }
  if (!Number.isInteger(g.valor)) {
    return falla('g', 'GRADOS_NO_ENTEROS', nombre + ': los grados deben ser un número entero (los decimales van en minutos y segundos).');
  }
  if (!Number.isInteger(m.valor)) {
    return falla('m', 'MINUTOS_NO_ENTEROS', nombre + ': los minutos deben ser un número entero (los decimales van en los segundos).');
  }
  if (g.valor > COORD_GMS_MAX_GRADOS[eje]) {
    return falla('g', 'GRADOS_FUERA_DE_RANGO', nombre + ': los grados deben estar entre 0 y ' + COORD_GMS_MAX_GRADOS[eje] + '.');
  }
  if (m.valor > 59) {
    return falla('m', 'MINUTOS_FUERA_DE_RANGO', nombre + ': los minutos deben estar entre 0 y 59.');
  }
  if (s.valor >= 60) {
    return falla('s', 'SEGUNDOS_FUERA_DE_RANGO', nombre + ': los segundos deben ser menores que 60.');
  }
  var hTxt = typeof e.h === 'string' ? e.h.trim().toUpperCase() : '';
  if (hTxt === '') {
    return falla('h', 'HEMISFERIO_REQUERIDO', nombre + ': elegí el hemisferio (' + (eje === 'lat' ? 'N o S' : 'E u O') + ').');
  }
  var signo = COORD_HEMISFERIOS[eje][hTxt];
  if (signo === undefined) {
    return falla('h', 'HEMISFERIO_INVALIDO', nombre + ': el hemisferio debe ser ' + (eje === 'lat' ? 'N o S' : 'E u O') + '.');
  }
  var valor = g.valor + m.valor / 60 + s.valor / 3600;
  if (valor > COORD_GMS_MAX_GRADOS[eje]) {
    return falla('g', 'FUERA_DE_RANGO', nombre + ': el valor no puede superar ' + COORD_GMS_MAX_GRADOS[eje] + ' grados.');
  }
  var letra = eje === 'lat' ? (signo > 0 ? 'N' : 'S') : (signo > 0 ? 'E' : 'O');
  var segundosTxt = String(coordenadas_redondear(s.valor, 4));
  return { ok: true, valor: signo * valor, hemisferio: letra, texto: g.valor + '° ' + m.valor + "' " + segundosTxt + '" ' + letra };
}

// Mensaje cuando el punto cae fuera de Mendoza; si invirtiendo el signo de la latitud y/o la longitud SI cae adentro, es casi seguro un hemisferio mal
// elegido y se lo dice (pero NO se corrige solo).
function coordenadas_errorFueraDeMendoza(lat, lon) {
  var sugerencia = null;
  [[-lat, lon], [lat, -lon], [-lat, -lon]].some(function (c, i) {
    if (coordenadas_dentroDeMendoza(c[0], c[1])) {
      sugerencia = i === 0 ? { lat: true, lon: false } : (i === 1 ? { lat: false, lon: true } : { lat: true, lon: true });
      return true;
    }
    return false;
  });
  var msg = 'La ubicación queda fuera de Mendoza.';
  if (sugerencia) {
    msg += ' Revisá el hemisferio: en Mendoza la latitud es Sur (S) y la longitud es Oeste (O).';
  }
  return { codigo: 'FUERA_DE_MENDOZA', mensaje: msg, sugerencia: sugerencia };
}

// GMS completo -> WGS84. entrada: {lat:{g,m,s,h}, lon:{g,m,s,h}}.
// Devuelve {ok, lat, lon (6 decimales), latExacta, lonExacta (SIN redondear: es con lo que se compara a escala de centimetros), textoOriginal, crsOriginal,
// errores:{lat?, lon?, general?}} - errores por eje con {campo, codigo, mensaje}.
// ok:false si algun eje es invalido o el punto queda fuera de Mendoza (igual que el backend).
function coordenadas_evaluarGms(entrada) {
  var e = entrada || {};
  var la = coordenadas_gmsEjeADecimal('lat', e.lat);
  var lo = coordenadas_gmsEjeADecimal('lon', e.lon);
  var errores = {};
  if (!la.ok) { errores.lat = la.error; }
  if (!lo.ok) { errores.lon = lo.error; }
  if (!la.ok || !lo.ok) {
    return { ok: false, errores: errores };
  }
  var lat = coordenadas_redondear(la.valor, 6);
  var lon = coordenadas_redondear(lo.valor, 6);
  var res = { ok: true, lat: lat, lon: lon, latExacta: la.valor, lonExacta: lo.valor, textoOriginal: la.texto + ', ' + lo.texto, crsOriginal: COORD_CRS_GMS, errores: errores };
  if (!coordenadas_dentroDeMendoza(lat, lon)) {
    res.ok = false;
    res.errores.general = coordenadas_errorFueraDeMendoza(lat, lon);
  }
  return res;
}

// Decimal con signo -> {g, m, s, h} (segundos con hasta 4 decimales, sin llegar nunca a 60). Para mostrar o para ida y vuelta.
function coordenadas_decimalAGms(valor, eje) {
  var h = eje === 'lat' ? (valor < 0 ? 'S' : 'N') : (valor < 0 ? 'O' : 'E');
  var abs = Math.abs(valor);
  var g = Math.floor(abs);
  var resto = (abs - g) * 60;
  var m = Math.floor(resto);
  var s = coordenadas_redondear((resto - m) * 60, 4);
  if (s >= 60) { s = 0; m += 1; }
  if (m >= 60) { m = 0; g += 1; }
  return { g: g, m: m, s: s, h: h };
}

// --- POSGAR 94 / Argentina 2 · EPSG:22182: X = Este, Y = Norte ---

function coordenadas_enRangoEste(v) {
  return v >= COORD_POSGAR_ESTE_MIN && v <= COORD_POSGAR_ESTE_MAX;
}

function coordenadas_enRangoNorte(v) {
  return v >= COORD_POSGAR_NORTE_MIN && v <= COORD_POSGAR_NORTE_MAX;
}

// entrada: {x, y} (numeros o texto: "2500000", "2.500.000,50", "2500000.5"). x = Este (m), y = Norte (m).
// Devuelve {ok, lat, lon (6 decimales), latExacta, lonExacta (SIN redondear), textoOriginal: "X(Este)=2500000.00, Y(Norte)=6350000.00", crsOriginal: "EPSG:22182", invertido, sugerencia?, errores:{x?, y?, general?}}.
//  - X/Y invertidos (Este dentro del rango de Norte y viceversa): ok:false, errores.general = XY_INVERTIDOS, sugerencia {x, y} con los valores intercambiados
//    (la interfaz puede ofrecer un boton "Intercambiar"; nunca se intercambian solos). Es inequivoco: los dos rangos no se solapan.
//  - fuera de rango (no es Mendoza), negativos, vacios, no numericos: errores por campo.
//  - punto convertido fuera de la caja de Mendoza: errores.general = FUERA_DE_MENDOZA.
function coordenadas_evaluarPosgar(entrada) {
  var e = entrada || {};
  var errores = {};
  var px = coordenadas_parsearNumero(e.x, { permitirMiles: true });
  var py = coordenadas_parsearNumero(e.y, { permitirMiles: true });
  if (!px.ok) {
    errores.x = coordenadas_error(px.motivo === 'vacio' ? 'ESTE_REQUERIDO' : 'ESTE_INVALIDO', px.motivo === 'vacio' ? 'X / Este: ingresá el valor en metros.' : 'X / Este: ingresá un número (metros).');
  }
  if (!py.ok) {
    errores.y = coordenadas_error(py.motivo === 'vacio' ? 'NORTE_REQUERIDO' : 'NORTE_INVALIDO', py.motivo === 'vacio' ? 'Y / Norte: ingresá el valor en metros.' : 'Y / Norte: ingresá un número (metros).');
  }
  if (!px.ok || !py.ok) {
    return { ok: false, invertido: false, errores: errores };
  }
  var x = px.valor;
  var y = py.valor;
  if (coordenadas_enRangoNorte(x) && coordenadas_enRangoEste(y)) {
    errores.general = coordenadas_error('XY_INVERTIDOS',
      'Parece que X e Y están intercambiados: en este proyecto X es el Este (alrededor de 2.500.000) e Y es el Norte (alrededor de 6.300.000).');
    return { ok: false, invertido: true, sugerencia: { x: y, y: x }, errores: errores };
  }
  if (x < 0 || y < 0) {
    errores.general = coordenadas_error('NEGATIVO', 'Las coordenadas POSGAR de Mendoza son positivas.');
  }
  if (!coordenadas_enRangoEste(x)) {
    errores.x = coordenadas_error('ESTE_FUERA_DE_RANGO', 'X / Este fuera de rango: en Mendoza va entre ' + coordenadas_formatearMiles(COORD_POSGAR_ESTE_MIN) + ' y ' + coordenadas_formatearMiles(COORD_POSGAR_ESTE_MAX) + ' m.');
  }
  if (!coordenadas_enRangoNorte(y)) {
    errores.y = coordenadas_error('NORTE_FUERA_DE_RANGO', 'Y / Norte fuera de rango: en Mendoza va entre ' + coordenadas_formatearMiles(COORD_POSGAR_NORTE_MIN) + ' y ' + coordenadas_formatearMiles(COORD_POSGAR_NORTE_MAX) + ' m.');
  }
  if (errores.x || errores.y || errores.general) {
    return { ok: false, invertido: false, errores: errores };
  }
  var r = coordenadas_posgarAWgs84(x, y);
  var lat = coordenadas_redondear(r.lat, 6);
  var lon = coordenadas_redondear(r.lon, 6);
  var res = {
    ok: true, invertido: false, lat: lat, lon: lon, latExacta: r.lat, lonExacta: r.lon, errores: errores, crsOriginal: COORD_CRS_POSGAR94_AR2,
    textoOriginal: 'X(Este)=' + x.toFixed(2) + ', Y(Norte)=' + y.toFixed(2)
  };
  if (!coordenadas_dentroDeMendoza(lat, lon)) {
    res.ok = false;
    res.errores.general = coordenadas_errorFueraDeMendoza(lat, lon);
  }
  return res;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COORD_CRS_GMS, COORD_CRS_POSGAR94_AR2, COORD_POSGAR_ETIQUETA, COORD_MENDOZA_BBOX,
    COORD_POSGAR_ESTE_MIN, COORD_POSGAR_ESTE_MAX, COORD_POSGAR_NORTE_MIN, COORD_POSGAR_NORTE_MAX,
    coordenadas_posgarAWgs84,
    coordenadas_wgs84APosgar,
    coordenadas_redondear,
    coordenadas_dentroDeMendoza,
    coordenadas_parsearNumero,
    coordenadas_gmsEjeADecimal,
    coordenadas_errorFueraDeMendoza,
    coordenadas_evaluarGms,
    coordenadas_decimalAGms,
    coordenadas_evaluarPosgar
  };
}
