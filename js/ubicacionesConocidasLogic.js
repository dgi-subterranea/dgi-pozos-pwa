// "Ubicaciones conocidas" de un pozo (ficha del pozo): logica PURA, sin DOM, sin red, sin Leaflet. Junta TODAS las coordenadas que el sistema conoce de un
// pozo -cada fuente por separado- y dice cual es el punto operativo y a cuantos metros de el queda cada una.
//
// Fuentes (todas de LECTURA; nada de esto escribe ni modifica una coordenada):
//   - Reporte Pozos           ubicacion.coordenadas              {x, y}   padron (POSGAR 94 / Argentina 2), inmutable
//   - Irrigacion (1..N)       ubicacion.coordenadasProvincia[]   {x, y}   padron, inmutable
//   - Validada en campo       la correccion VIGENTE (estado VALIDADA) de UbicacionCorrecciones, si hay
// El padron solo trae x/y: la latitud/longitud de cada fuente se calcula aca con js/coordenadasConversion.js (la misma conversion que valida pyproj, 0,03 mm).
//
// El punto operativo NO se decide aca: lo resuelve ubicacionOperativaLogic_resolver (R1 la validada en campo gana; R2 el punto del padron; R0 ninguno). Este
// modulo solo identifica CUAL de las fuentes es ese punto. Si no hay punto operativo (sin coordenadas o discrepancia) ninguna fuente lo es y no se calculan
// distancias.
//
// Privacidad de los enlaces: Google Maps recibe SOLO latitud y longitud (ubicacionesConocidasLogic_urlGoogleMaps). Nunca el wellId, el titular, el autor, la
// observacion, el email, el motivo ni el historial.
//
// Dependencias (globales en el navegador, cargadas antes): coordenadas_posgarAWgs84, ubicacionOperativaLogic_{resolver, distanciaMetros, coordenadaValida}.
var UCON_ETIQUETA_REPORTE = 'Reporte Pozos';
var UCON_ETIQUETA_IRRIGACION = 'Irrigación';
var UCON_ETIQUETA_CAMPO = 'Validada en campo';
var UCON_TIPOS = { REPORTE_POZOS: 'REPORTE_POZOS', IRRIGACION: 'IRRIGACION', CAMPO_VALIDADA: 'CAMPO_VALIDADA' };
var UCON_ID_CAMPO = 'CAMPO_VALIDADA';
var UCON_ID_REPORTE = 'REPORTE_POZOS';
var UCON_DECIMALES = 5;                       // ~1 m: igual que el padron (scripts/coord_utils.py) y que lo que muestra la ficha
var UCON_TOLERANCIA_MATCH_M = 2;              // respaldo para reconocer la fuente del punto operativo cuando no coincide x/y exacto
var UCON_URL_MAPS = 'https://www.google.com/maps/search/?api=1&query=';
var UCON_NOTA_SIN_OPERATIVO = 'No hay punto operativo: las ubicaciones de las fuentes no coinciden entre sí y un técnico debe revisarlas.';
var UCON_NOTA_CONSERVA = 'Cada fuente conserva su ubicación original. El punto operativo es el que usa la aplicación en los mapas.';
var UCON_TEXTO_VER_TODAS = 'Ver todas en el mapa';
var UCON_TEXTO_ABRIR_MAPS = 'Abrir en Google Maps';

function ubicacionesConocidasLogic_escapar(texto) {
  return String(texto === null || texto === undefined ? '' : texto)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function ubicacionesConocidasLogic_esNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

function ubicacionesConocidasLogic_redondear(v) {
  var f = Math.pow(10, UCON_DECIMALES);
  return Math.round(v * f) / f;
}

// Enlace a Google Maps de UNA coordenada. null si no es una coordenada valida de Mendoza. Solo lat,lon; sin API key.
function ubicacionesConocidasLogic_urlGoogleMaps(lat, lon) {
  if (!ubicacionOperativaLogic_coordenadaValida(lat, lon)) {
    return null;
  }
  return UCON_URL_MAPS + ubicacionesConocidasLogic_redondear(lat) + ',' + ubicacionesConocidasLogic_redondear(lon);
}

function ubicacionesConocidasLogic_numeroDeCampo(v) {
  if (typeof v === 'number') {
    return isFinite(v) ? v : null;
  }
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) {
    return Number(v);
  }
  return null;
}

// Una fuente del padron {x, y} (Este, Norte) -> {x, y, lat, lon} o {invalida}. Una x/y ausente o fuera de Mendoza no genera enlace ni marcador.
function ubicacionesConocidasLogic_fuentePadron(id, tipo, etiqueta, c) {
  var f = { id: id, tipo: tipo, etiqueta: etiqueta, x: null, y: null, lat: null, lon: null, invalida: true, esOperativo: false, distanciaOperativoM: null, urlMaps: null };
  if (c === null || typeof c !== 'object') {
    return f;
  }
  var x = ubicacionesConocidasLogic_numeroDeCampo(c.x);
  var y = ubicacionesConocidasLogic_numeroDeCampo(c.y);
  if (x === null || y === null) {
    return f;
  }
  f.x = x;
  f.y = y;
  var g = coordenadas_posgarAWgs84(x, y);
  var lat = ubicacionesConocidasLogic_redondear(g.lat);
  var lon = ubicacionesConocidasLogic_redondear(g.lon);
  if (!ubicacionOperativaLogic_coordenadaValida(lat, lon)) {
    return f;
  }
  f.lat = lat;
  f.lon = lon;
  f.invalida = false;
  f.urlMaps = ubicacionesConocidasLogic_urlGoogleMaps(lat, lon);
  return f;
}

// entrada: {wellId, location (respuesta de getWellLocation: coordenadas, coordenadasProvincia, ubicacionResuelta), vigente (vista de correccion VALIDADA o null)}
// salida: {wellId, fuentes: [...], validas, operativo: {lat, lon, fuenteId, estado, etiquetaEstado, regla} | null, sinOperativo}
//   fuente: {id, tipo, etiqueta, x, y, lat, lon, invalida, esOperativo, distanciaOperativoM, urlMaps, detalle}
function ubicacionesConocidasLogic_construir(entrada) {
  var e = entrada && typeof entrada === 'object' ? entrada : {};
  var loc = e.location && typeof e.location === 'object' ? e.location : {};
  var fuentes = [];

  if (loc.coordenadas) {
    fuentes.push(ubicacionesConocidasLogic_fuentePadron(UCON_ID_REPORTE, UCON_TIPOS.REPORTE_POZOS, UCON_ETIQUETA_REPORTE, loc.coordenadas));
  }
  var provincia = Array.isArray(loc.coordenadasProvincia) ? loc.coordenadasProvincia : [];
  provincia.forEach(function (c, i) {
    var etiqueta = UCON_ETIQUETA_IRRIGACION + (provincia.length > 1 ? ' (' + (i + 1) + ')' : '');
    fuentes.push(ubicacionesConocidasLogic_fuentePadron('IRRIGACION_' + (i + 1), UCON_TIPOS.IRRIGACION, etiqueta, c));
  });

  var v = e.vigente && typeof e.vigente === 'object' && (e.vigente.estado === undefined || e.vigente.estado === 'VALIDADA') ? e.vigente : null;
  if (v && ubicacionOperativaLogic_coordenadaValida(v.lat, v.lon)) {
    var campo = { id: UCON_ID_CAMPO, tipo: UCON_TIPOS.CAMPO_VALIDADA, etiqueta: UCON_ETIQUETA_CAMPO, x: null, y: null, lat: v.lat, lon: v.lon, invalida: false, esOperativo: false, distanciaOperativoM: null, urlMaps: ubicacionesConocidasLogic_urlGoogleMaps(v.lat, v.lon) };
    fuentes.push(campo);
  }

  // Punto operativo: lo dice el resolvedor (nunca se recalcula la regla aca).
  var res = ubicacionOperativaLogic_resolver({ wellId: e.wellId, ubicacionResuelta: loc.ubicacionResuelta || null, vigente: v });
  var operativo = null;
  if (res && res.operativo && ubicacionOperativaLogic_coordenadaValida(res.lat, res.lon)) {
    var fuenteOp = null;
    if (res.regla === 'R1_CAMPO_VALIDADA') {
      fuenteOp = fuentes.filter(function (f) { return f.id === UCON_ID_CAMPO; })[0] || null;
    } else {
      var r = loc.ubicacionResuelta || {};
      fuenteOp = fuentes.filter(function (f) { return f.tipo !== UCON_TIPOS.CAMPO_VALIDADA && !f.invalida && f.x === r.x && f.y === r.y; })[0] || null;
      if (!fuenteOp) {
        var mejor = null;
        fuentes.forEach(function (f) {
          if (f.tipo === UCON_TIPOS.CAMPO_VALIDADA || f.invalida) { return; }
          var d = ubicacionOperativaLogic_distanciaMetros(res.lat, res.lon, f.lat, f.lon);
          if (d <= UCON_TOLERANCIA_MATCH_M && (mejor === null || d < mejor.d)) { mejor = { f: f, d: d }; }
        });
        fuenteOp = mejor ? mejor.f : null;
      }
    }
    operativo = { lat: res.lat, lon: res.lon, fuenteId: fuenteOp ? fuenteOp.id : null, estado: res.estado, etiquetaEstado: res.etiqueta, regla: res.regla };
    if (fuenteOp) {
      fuenteOp.esOperativo = true;
    }
    fuentes.forEach(function (f) {
      if (!f.esOperativo && !f.invalida) {
        f.distanciaOperativoM = ubicacionOperativaLogic_distanciaMetros(operativo.lat, operativo.lon, f.lat, f.lon);
      }
    });
  }

  fuentes.forEach(function (f) {
    f.detalle = f.tipo === UCON_TIPOS.CAMPO_VALIDADA ? 'Corrección validada por un usuario autorizado' : 'Padrón · POSGAR 94 / Argentina 2';
  });

  var validas = fuentes.filter(function (f) { return !f.invalida; }).length;
  return { wellId: typeof e.wellId === 'string' ? e.wellId : null, fuentes: fuentes, validas: validas, operativo: operativo, sinOperativo: operativo === null };
}

// "A 22 m del punto operativo" / "A menos de 1 m ..." / "A 1,2 km ...". null si no hay distancia (es el operativo o no hay operativo).
function ubicacionesConocidasLogic_textoDistancia(m) {
  if (!ubicacionesConocidasLogic_esNumero(m) || m < 0) {
    return null;
  }
  var cuerpo;
  if (m < 1) {
    return 'A menos de 1 m del punto operativo';
  } else if (m < 10) {
    cuerpo = String(Math.round(m * 10) / 10).replace('.', ',') + ' m';
  } else if (m < 1000) {
    cuerpo = Math.round(m) + ' m';
  } else {
    cuerpo = String(Math.round(m / 100) / 10).replace('.', ',') + ' km';
  }
  return 'A ' + cuerpo + ' del punto operativo';
}

function ubicacionesConocidasLogic_textoCoordenada(f) {
  return f.invalida ? 'Coordenada no válida' : f.lat + ', ' + f.lon;
}

// Estado y acciones de las decisiones (js/ubicacionFuenteDecisionesUiLogic.js): se usan SOLO si ese modulo esta cargado y la fuente trae `decision` (nunca la
// "Validada en campo"). La tarjeta y el popup piden lo mismo a las mismas funciones: una sola fuente de verdad.
function ubicacionesConocidasLogic_hayDecisiones() {
  return typeof ufdui_htmlEstado === 'function' && typeof ufdui_htmlAcciones === 'function' && typeof ufdui_htmlHistoria === 'function';
}

// Una fila de la seccion. opciones: {iconoMaps (SVG confiable de app.js), modelo, rol (acciones de decision)}.
function ubicacionesConocidasLogic_htmlFuente(f, opciones) {
  var esc = ubicacionesConocidasLogic_escapar;
  var o = opciones || {};
  var dec = ubicacionesConocidasLogic_hayDecisiones() && f.decision;
  var h = '<li class="ucon-fuente' + (f.esOperativo ? ' ucon-operativa' : '') + (dec && f.decision.estado === 'DESCARTADA' ? ' ucon-descartada' : '') + '" data-ucon-id="' + esc(f.id) + '">';
  h += '<div class="ucon-cab"><span class="ucon-nombre">' + esc(f.etiqueta) + '</span>';
  if (f.esOperativo) {
    h += '<span class="ucon-chip-operativo">Punto operativo</span>';
  }
  if (dec) {
    h += ufdui_htmlEstado(f);
  }
  h += '</div>';
  h += '<div class="ucon-coord mono' + (f.invalida ? ' ucon-coord-invalida' : '') + '">' + esc(ubicacionesConocidasLogic_textoCoordenada(f)) + '</div>';
  var meta = [f.detalle];
  if (f.x !== null && f.y !== null) {
    meta.push('x ' + f.x + ' / y ' + f.y);
  }
  var dist = ubicacionesConocidasLogic_textoDistancia(f.distanciaOperativoM);
  if (dist) {
    meta.push(dist);
  }
  h += '<div class="ucon-meta">' + meta.map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>';
  if (dec) {
    h += ufdui_htmlHistoria(f);
  }
  if (ubicacionesConocidasLogic_hayDecisiones() && typeof ufdui_htmlSugerencias === 'function') {
    h += ufdui_htmlSugerencias(f, o.modelo, o.rol);
  }
  if (f.urlMaps) {
    h += '<a class="maps-btn ucon-maps" href="' + esc(f.urlMaps) + '" target="_blank" rel="noopener">' + (o.iconoMaps || '') + UCON_TEXTO_ABRIR_MAPS + '</a>';
  }
  if (dec || (f.sugerencias && ubicacionesConocidasLogic_hayDecisiones())) {
    h += ufdui_htmlAcciones(f, o.modelo, o.rol);
  }
  h += '</li>';
  return h;
}

// La seccion completa. '' si el pozo no tiene ninguna fuente conocida (no se muestra nada).
function ubicacionesConocidasLogic_htmlSeccion(modelo, opciones) {
  var esc = ubicacionesConocidasLogic_escapar;
  if (!modelo || !Array.isArray(modelo.fuentes) || modelo.fuentes.length === 0) {
    return '';
  }
  var h = '<p class="field-label">Ubicaciones conocidas</p>';
  if (modelo.sinOperativo) {
    h += '<p class="ucon-nota ucon-nota-aviso" role="status">' + esc(UCON_NOTA_SIN_OPERATIVO) + '</p>';
  } else {
    h += '<p class="ucon-nota">' + esc(UCON_NOTA_CONSERVA) + '</p>';
  }
  if (ubicacionesConocidasLogic_hayDecisiones() && typeof ufdui_htmlNotasSeccion === 'function') {
    h += ufdui_htmlNotasSeccion(modelo, opciones && opciones.aviso);
  }
  var opcFuente = Object.assign({}, opciones || {}, { modelo: modelo });
  h += '<ul class="ucon-lista">' + modelo.fuentes.map(function (f) { return ubicacionesConocidasLogic_htmlFuente(f, opcFuente); }).join('') + '</ul>';
  if (modelo.validas > 0) {
    h += '<button type="button" id="btn-ucon-ver-todas" class="button-secondary ucon-ver-todas">' + UCON_TEXTO_VER_TODAS + '</button>';
  }
  return h;
}

// Contenido del popup de un marcador (Leaflet). Fuente, estado, coordenada, distancia, el enlace y las acciones de decision permitidas (las MISMAS que la tarjeta).
// Nada personal salvo el nombre de quien decidio por ultima vez (igual que el historial). opciones: {modelo, rol}.
function ubicacionesConocidasLogic_htmlPopup(f, opciones) {
  var esc = ubicacionesConocidasLogic_escapar;
  var o = opciones || {};
  var dec = ubicacionesConocidasLogic_hayDecisiones() && f.decision;
  var h = '<div class="ucon-popup"><strong>' + esc(f.etiqueta) + '</strong>';
  if (f.esOperativo) {
    h += ' <span class="ucon-chip-operativo">Punto operativo</span>';
  }
  if (dec) {
    h += ' ' + ufdui_htmlEstado(f);
  }
  h += '<div class="ucon-popup-coord mono">' + esc(ubicacionesConocidasLogic_textoCoordenada(f)) + '</div>';
  var dist = ubicacionesConocidasLogic_textoDistancia(f.distanciaOperativoM);
  if (dist) {
    h += '<div class="ucon-popup-dist">' + esc(dist) + '</div>';
  }
  if (dec) {
    h += ufdui_htmlHistoria(f);
  }
  if (ubicacionesConocidasLogic_hayDecisiones() && typeof ufdui_htmlSugerencias === 'function') {
    h += ufdui_htmlSugerencias(f, o.modelo, o.rol);
  }
  if (f.urlMaps) {
    h += '<a class="ucon-popup-maps" href="' + esc(f.urlMaps) + '" target="_blank" rel="noopener">' + UCON_TEXTO_ABRIR_MAPS + '</a>';
  }
  if (dec || (f.sugerencias && ubicacionesConocidasLogic_hayDecisiones())) {
    h += ufdui_htmlAcciones(f, o.modelo, o.rol);
  }
  return h + '</div>';
}

// Leyenda del visor: una fila por fuente valida (boton que enfoca su marcador). Sirve tambien cuando dos puntos se superponen.
function ubicacionesConocidasLogic_htmlLeyenda(modelo) {
  var esc = ubicacionesConocidasLogic_escapar;
  var validas = (modelo && Array.isArray(modelo.fuentes) ? modelo.fuentes : []).filter(function (f) { return !f.invalida; });
  return validas.map(function (f) {
    var dist = f.esOperativo ? 'Punto operativo' : ubicacionesConocidasLogic_textoDistancia(f.distanciaOperativoM);
    if (ubicacionesConocidasLogic_hayDecisiones() && f.decision && typeof UFDUI_ETIQUETA_ESTADO !== 'undefined') {
      dist = (dist ? dist + ' · ' : '') + UFDUI_ETIQUETA_ESTADO[f.decision.estado];
    }
    return '<li><button type="button" class="ucon-leyenda-fila" data-ucon-foco="' + esc(f.id) + '">' +
      '<span class="ucon-leyenda-punto ' + ubicacionesConocidasLogic_claseMarcador(f) + '"></span>' +
      '<span class="ucon-leyenda-texto"><strong>' + esc(f.etiqueta) + '</strong>' + (dist ? '<span>' + esc(dist) + '</span>' : '') + '</span></button></li>';
  }).join('');
}

function ubicacionesConocidasLogic_claseMarcador(f) {
  var base = f.tipo === UCON_TIPOS.CAMPO_VALIDADA ? 'ucon-marker-campo' : (f.tipo === UCON_TIPOS.REPORTE_POZOS ? 'ucon-marker-reporte' : 'ucon-marker-irr');
  return base + (f.esOperativo ? ' ucon-marker-op' : '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UCON_ETIQUETA_REPORTE, UCON_ETIQUETA_IRRIGACION, UCON_ETIQUETA_CAMPO, UCON_TIPOS, UCON_ID_CAMPO, UCON_ID_REPORTE, UCON_URL_MAPS,
    UCON_NOTA_SIN_OPERATIVO, UCON_NOTA_CONSERVA, UCON_TEXTO_VER_TODAS, UCON_TEXTO_ABRIR_MAPS,
    ubicacionesConocidasLogic_escapar,
    ubicacionesConocidasLogic_urlGoogleMaps,
    ubicacionesConocidasLogic_construir,
    ubicacionesConocidasLogic_textoDistancia,
    ubicacionesConocidasLogic_htmlFuente,
    ubicacionesConocidasLogic_htmlSeccion,
    ubicacionesConocidasLogic_htmlPopup,
    ubicacionesConocidasLogic_htmlLeyenda,
    ubicacionesConocidasLogic_claseMarcador,
    ubicacionesConocidasLogic_hayDecisiones
  };
}
