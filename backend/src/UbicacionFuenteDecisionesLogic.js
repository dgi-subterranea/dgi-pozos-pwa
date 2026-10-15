// Decisiones sobre las FUENTES REGISTRALES de ubicacion de un pozo (aceptar / descartar / restaurar / quitar la aceptacion): DOMINIO PURO, sin DOM, sin red, sin
// Sheets, sin Leaflet. Etapa 1 de docs/ubicacion-fuente-decisiones.md (propuesta tecnica). Todavia no lo usa ninguna pantalla ni el backend.
//
// QUE ES (y que no):
//   - Una decision recae sobre UNA coordenada del padron (Reporte Pozos o una de Irrigacion), identificada por wellId + tipo + x + y. La coordenada original
//     NUNCA se modifica ni se borra: una descartada sigue existiendo, solo deja de participar del resolver.
//   - NO es una correccion de campo. La prioridad «validada en campo > aceptada» se integra mas adelante en el modulo del punto operativo; este modulo no sabe nada de
//     correcciones de campo.
//
// EVENTOS (append-only; el estado vigente SIEMPRE se deriva, nunca se guarda en una celda):
//   ACEPTADA            la fuente pasa a ser la referencia operativa registral elegida a mano. Si OTRA estaba aceptada en el pozo, esa deja de serlo
//                       (se deriva del orden de los eventos: NO hace falta un evento SUPERADA, ver abajo).
//   DESCARTADA          la fuente deja de participar del resolver. Motivo OBLIGATORIO. Si estaba aceptada, tambien deja de estarlo (un solo evento).
//   ACEPTACION_QUITADA  ACEPTADA -> SIN_REVISAR (la fuente vuelve al resolver automatico; no queda descartada).
//   RESTAURADA          DESCARTADA -> SIN_REVISAR (vuelve al resolver automatico; NO queda aceptada).
//   (no existe SUPERADA ni REEVALUADA en el dominio: SUPERADA se deduce del orden —el ACEPTADA mas nuevo del pozo manda— y por construccion jamas puede haber dos
//   aceptadas vigentes; la historia queda inequivoca con una sola fila por decision. REEVALUADA, si hiciera falta tras un reindexado, es de la etapa de backend.)
//
// ORDEN: por `secuencia` (entero >= 1, unico). La fecha NO se usa jamas: dos eventos del mismo segundo (pasa en los datos reales) quedan ordenados por su
// secuencia. Una secuencia repetida o invalida deja el pozo INCONSISTENTE (fail-closed: ninguna decision del pozo aplica y no se acepta ninguna nueva).
//
// IDENTIDAD: wellId|TIPO|x|y con x e y a 3 decimales. Si un reindexado cambia la coordenada, la clave cambia: la decision vieja queda historica (obsoleta) y la
// coordenada nueva nace SIN_REVISAR. «Irrigacion (2)» es solo una etiqueta posicional, nunca identidad.
//
// RESOLVER: copia en JS de scripts/reindex_pozos.py::resolver_ubicacion (mismos umbrales 10 / 50 / 500 m, mismo desempate, mismo redondeo de Python, incluido
// round half-even). La paridad se prueba contra js/fixtures/resolver_ubicacion_vectores.json, que genera el propio Python (scripts/gen_vectores_resolver_ubicacion.py).
//
// Dependencia (global en el navegador, cargada antes): coordenadas_posgarAWgs84 (js/coordenadasConversion.js).
// El archivo usa funciones globales con prefijo ufd_ (sin IIFE) para poder copiarse tal cual al backend de Apps Script en la etapa siguiente.
var UFD_VERSION = 1;
var UFD_TIPOS = { REPORTE_POZOS: 'REPORTE_POZOS', IRRIGACION: 'IRRIGACION' };
var UFD_EVENTOS = { ACEPTADA: 'ACEPTADA', DESCARTADA: 'DESCARTADA', ACEPTACION_QUITADA: 'ACEPTACION_QUITADA', RESTAURADA: 'RESTAURADA' };
var UFD_ESTADOS = { SIN_REVISAR: 'SIN_REVISAR', ACEPTADA: 'ACEPTADA', DESCARTADA: 'DESCARTADA' };
var UFD_DECISIONES = { ACEPTAR: 'ACEPTAR', DESCARTAR: 'DESCARTAR', RESTAURAR: 'RESTAURAR', QUITAR: 'QUITAR' };
var UFD_DECISION_A_EVENTO = { ACEPTAR: 'ACEPTADA', DESCARTAR: 'DESCARTADA', RESTAURAR: 'RESTAURADA', QUITAR: 'ACEPTACION_QUITADA' };
var UFD_REGLAS = { R1B: 'R1B_REGISTRAL_ACEPTADA', R2: 'R2_AUTOMATICO', R0: 'R0_NINGUNA' };
var UFD_RESULTADO_ESTADOS = { ACEPTADA: 'ACEPTADA', COINCIDENTE: 'COINCIDENTE', DISPONIBLE: 'DISPONIBLE', DISCREPANCIA: 'DISCREPANCIA', SIN_COORDENADAS: 'SIN_COORDENADAS' };
var UFD_FUENTES_OPERATIVAS = { IRR_REPORTE: 'IRR_REPORTE', IRR_PROVINCIA: 'IRR_PROVINCIA', IRR_VARIAS: 'IRR_VARIAS' };
var UFD_MOTIVO_MAX = 300;
var UFD_DECIMALES_CLAVE = 3;
var UFD_UMBRAL_CORROBORACION_M = 10.0;     // iguales a UBICACION_UMBRAL_* de scripts/reindex_pozos.py (un test de paridad lo exige)
var UFD_UMBRAL_DUDOSO_M = 50.0;
var UFD_UMBRAL_GRAVE_M = 500.0;
// Mismo recuadro que UBICACION_CORR_MENDOZA_BBOX / UOP_MENDOZA_BBOX (un test los compara).
var UFD_MENDOZA_BBOX = { latMin: -37.65, latMax: -31.95, lonMin: -70.65, lonMax: -66.45 };
var UFD_NOMBRE_PADRON_A_TIPO = { reportePozos: 'REPORTE_POZOS', coordProvincia: 'IRRIGACION' };
var UFD_TIPO_A_NOMBRE_PADRON = { REPORTE_POZOS: 'reportePozos', IRRIGACION: 'coordProvincia' };
var UFD_WELL_ID_REGEX = /^(\d{2})-(\d{4})$/;

// Codigos de error de una SOLICITUD (ufd_decidir)
var UFD_ERRORES = {
  INVALID_DECISION: 'INVALID_DECISION',
  INVALID_FUENTE: 'INVALID_FUENTE',
  INVALID_VERSION: 'INVALID_VERSION',
  MOTIVO_REQUERIDO: 'MOTIVO_REQUERIDO',
  MOTIVO_INVALIDO: 'MOTIVO_INVALIDO',
  WELL_ID_INVALIDO: 'WELL_ID_INVALIDO',
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  STALE_STATE: 'STALE_STATE',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  ALREADY_IN_STATE: 'ALREADY_IN_STATE',
  INCONSISTENT_STATE: 'INCONSISTENT_STATE'
};
// Codigos de anomalia de un LOG (ufd_derivar): cualquiera deja el pozo INCONSISTENTE
var UFD_ANOMALIAS = {
  EVENTO_NO_ES_OBJETO: 'EVENTO_NO_ES_OBJETO',
  EVENTO_DESCONOCIDO: 'EVENTO_DESCONOCIDO',
  SECUENCIA_INVALIDA: 'SECUENCIA_INVALIDA',
  SECUENCIA_DUPLICADA: 'SECUENCIA_DUPLICADA',
  WELL_ID_INVALIDO: 'WELL_ID_INVALIDO',
  EVENTO_DE_OTRO_POZO: 'EVENTO_DE_OTRO_POZO',
  FUENTE_TIPO_INVALIDO: 'FUENTE_TIPO_INVALIDO',
  COORDENADA_INVALIDA: 'COORDENADA_INVALIDA',
  MOTIVO_INVALIDO: 'MOTIVO_INVALIDO',
  MOTIVO_AUSENTE_EN_DESCARTE: 'MOTIVO_AUSENTE_EN_DESCARTE',
  TRANSICION_INVALIDA_EN_LOG: 'TRANSICION_INVALIDA_EN_LOG',
  ACEPTADAS_MULTIPLES: 'ACEPTADAS_MULTIPLES',
  FUENTE_SIN_COORDENADA_VALIDA: 'FUENTE_SIN_COORDENADA_VALIDA',
  ACEPTADA_FUERA_DE_MENDOZA: 'ACEPTADA_FUERA_DE_MENDOZA',
  COORDENADA_FUERA_DE_MENDOZA: 'COORDENADA_FUERA_DE_MENDOZA',
  POZO_INCONSISTENTE: 'POZO_INCONSISTENTE'
};

// --- Utilidades ---

function ufd_esNumero(v) {
  return typeof v === 'number' && isFinite(v);
}

function ufd_esObjeto(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function ufd_wellIdValido(w) {
  if (typeof w !== 'string') { return false; }
  var m = UFD_WELL_ID_REGEX.exec(w);
  if (!m) { return false; }
  var d = parseInt(m[1], 10);
  return d >= 1 && d <= 19;
}

// Numero o texto numerico simple ("2486460.782"); cualquier otra cosa -> null. Nunca lanza.
function ufd_numero(v) {
  if (typeof v === 'number') { return isFinite(v) ? v : null; }
  if (typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v)) { return Number(v); }
  return null;
}

// round(v, dec) de PYTHON: correctamente redondeado sobre el valor binario exacto (por eso 0.15 -> 0.1 y 0.35 -> 0.3) y half-even SOLO en los empates exactos
// (1.25 -> 1.2, 20.75 -> 20.8). toFixed de JS ya redondea sobre el valor exacto pero desempata hacia arriba: se corrigen solo esos empates.
function ufd_redondearComoPython(v, dec) {
  var tabla = Math.pow(10, dec);
  var y = v * Math.pow(2, dec + 1);
  var esEmpate = isFinite(y) && Math.floor(y) === y && Math.abs(y) % 2 === 1;      // v es un multiplo impar de 1 / 2^(dec+1): empate exacto
  if (esEmpate) {
    var t = Math.floor(v * tabla);
    return (t % 2 === 0 ? t : t + 1) / tabla;
  }
  return Number(v.toFixed(dec));
}

// Coordenada del padron normalizada a 3 decimales (1 mm), como texto estable. Ignora el ruido de coma flotante (2486460.7820000001 == 2486460.782).
function ufd_normalizarCoordenada(v) {
  var n = ufd_numero(v);
  if (n === null) { return null; }
  var s = n.toFixed(UFD_DECIMALES_CLAVE);
  return s === '-0.000' ? '0.000' : s;
}

// Identidad canonica de una fuente: wellId|TIPO|x|y. null si algo no es valido.
function ufd_claveFuente(wellId, tipo, x, y) {
  if (!ufd_wellIdValido(wellId) || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, tipo)) { return null; }
  var nx = ufd_normalizarCoordenada(x);
  var ny = ufd_normalizarCoordenada(y);
  if (nx === null || ny === null) { return null; }
  return wellId + '|' + tipo + '|' + nx + '|' + ny;
}

function ufd_partesDeClave(clave) {
  var p = typeof clave === 'string' ? clave.split('|') : [];
  return p.length === 4 ? { wellId: p[0], tipo: p[1], x: Number(p[2]), y: Number(p[3]) } : null;
}

function ufd_latLonDe(x, y) {
  var g = coordenadas_posgarAWgs84(x, y);
  return { lat: ufd_redondearComoPython(g.lat, 5), lon: ufd_redondearComoPython(g.lon, 5) };
}

function ufd_dentroDeMendoza(lat, lon) {
  var b = UFD_MENDOZA_BBOX;
  return ufd_esNumero(lat) && ufd_esNumero(lon) && lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
}

function ufd_error(codigo, mensaje, extra) {
  var e = { ok: false, codigo: codigo, mensaje: mensaje };
  if (extra) { Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); }
  return e;
}

// --- Fuentes del padron ---

// location: {coordenadas: {x,y}|null, coordenadasProvincia: [{x,y}...]} (la respuesta de getWellLocation / ubicacion de la ficha registral). Devuelve las fuentes en
// el MISMO orden en que las recibe el resolver de Python (Reporte Pozos primero, luego Irrigacion en su orden). Las que no tienen x/y numericos se omiten con una
// anomalia (el indexador ya las descarta; esto es defensivo).
function ufd_fuentesDePadron(wellId, location) {
  var loc = ufd_esObjeto(location) ? location : {};
  var fuentes = [];
  var anomalias = [];
  function agregar(tipo, c, posicion) {
    var x = ufd_esObjeto(c) ? ufd_numero(c.x) : null;
    var y = ufd_esObjeto(c) ? ufd_numero(c.y) : null;
    var clave = x === null || y === null ? null : ufd_claveFuente(wellId, tipo, x, y);
    if (clave === null) {
      anomalias.push({ codigo: UFD_ANOMALIAS.FUENTE_SIN_COORDENADA_VALIDA, tipo: tipo, posicion: posicion });
      return;
    }
    var ll = ufd_latLonDe(x, y);
    fuentes.push({ clave: clave, tipo: tipo, x: x, y: y, lat: ll.lat, lon: ll.lon, posicion: posicion });
  }
  if (loc.coordenadas !== null && loc.coordenadas !== undefined) { agregar(UFD_TIPOS.REPORTE_POZOS, loc.coordenadas, 0); }
  var provincia = Array.isArray(loc.coordenadasProvincia) ? loc.coordenadasProvincia : [];
  provincia.forEach(function (c, i) { agregar(UFD_TIPOS.IRRIGACION, c, i + 1); });
  return { fuentes: fuentes, anomalias: anomalias };
}

// --- Resolver automatico (copia de scripts/reindex_pozos.py::resolver_ubicacion) ---

function ufd_distancia(a, b) {
  // Python: ((a.x - b.x) ** 2 + (a.y - b.y) ** 2) ** 0.5
  return Math.pow(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2), 0.5);
}

// candidatas: [{tipo, x, y}] en el orden del indexador. Devuelve {resultado, indiceElegido}: `resultado` es EXACTAMENTE lo que devuelve Python ({estado, ...});
// indiceElegido es la posicion (en `candidatas`) del punto que el resolver usa como coordenada (null si no hay punto), dato que Python no devuelve pero necesita la UI.
function ufd_resolverAutomaticoDetallado(candidatas) {
  var lista = Array.isArray(candidatas) ? candidatas : [];
  if (lista.length === 0) {
    return { resultado: { estado: 'sinCoordenadas' }, indiceElegido: null };
  }
  if (lista.length === 1) {
    var c = lista[0];
    var ll = ufd_latLonDe(c.x, c.y);
    return { resultado: { estado: 'unica', fuente: UFD_TIPO_A_NOMBRE_PADRON[c.tipo], x: c.x, y: c.y, lat: ll.lat, lon: ll.lon }, indiceElegido: 0 };
  }
  var mejorDist = null;
  var mejorIdx = null;
  var peorDist = 0.0;
  for (var i = 0; i < lista.length; i++) {
    for (var j = i + 1; j < lista.length; j++) {
      var d = ufd_distancia(lista[i], lista[j]);
      if (d > peorDist) { peorDist = d; }
      if (mejorDist === null || d < mejorDist) {
        mejorDist = d;
        mejorIdx = i;
      }
    }
  }
  if (mejorDist <= UFD_UMBRAL_CORROBORACION_M) {
    var m = lista[mejorIdx];
    var llm = ufd_latLonDe(m.x, m.y);
    return {
      resultado: { estado: 'corroborada', x: m.x, y: m.y, lat: llm.lat, lon: llm.lon, distanciaCorroboracion: ufd_redondearComoPython(mejorDist, 1) },
      indiceElegido: mejorIdx
    };
  }
  var estado;
  if (peorDist <= UFD_UMBRAL_DUDOSO_M) {
    estado = 'dudosoLeve';
  } else if (peorDist <= UFD_UMBRAL_GRAVE_M) {
    estado = 'revisar';
  } else {
    estado = 'revisarGrave';
  }
  return { resultado: { estado: estado, distanciaMaxima: ufd_redondearComoPython(peorDist, 1) }, indiceElegido: null };
}

function ufd_resolverAutomatico(candidatas) {
  return ufd_resolverAutomaticoDetallado(candidatas).resultado;
}

// --- Validacion de eventos ---

// Un evento de la hoja. Devuelve null si esta bien o {codigo, detalle}. La fecha NO se mira (ni siquiera se exige).
function ufd_problemaDeEvento(ev, wellIdEsperado) {
  if (!ufd_esObjeto(ev)) { return { codigo: UFD_ANOMALIAS.EVENTO_NO_ES_OBJETO }; }
  if (typeof ev.secuencia !== 'number' || !isFinite(ev.secuencia) || Math.floor(ev.secuencia) !== ev.secuencia || ev.secuencia < 1) {
    return { codigo: UFD_ANOMALIAS.SECUENCIA_INVALIDA };
  }
  if (typeof ev.evento !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_EVENTOS, ev.evento)) { return { codigo: UFD_ANOMALIAS.EVENTO_DESCONOCIDO, secuencia: ev.secuencia }; }
  if (!ufd_wellIdValido(ev.wellId)) { return { codigo: UFD_ANOMALIAS.WELL_ID_INVALIDO, secuencia: ev.secuencia }; }
  if (wellIdEsperado && ev.wellId !== wellIdEsperado) { return { codigo: UFD_ANOMALIAS.EVENTO_DE_OTRO_POZO, secuencia: ev.secuencia }; }
  if (typeof ev.fuenteTipo !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, ev.fuenteTipo)) { return { codigo: UFD_ANOMALIAS.FUENTE_TIPO_INVALIDO, secuencia: ev.secuencia }; }
  if (ufd_claveFuente(ev.wellId, ev.fuenteTipo, ev.x, ev.y) === null) { return { codigo: UFD_ANOMALIAS.COORDENADA_INVALIDA, secuencia: ev.secuencia }; }
  if (ev.motivo !== undefined && ev.motivo !== null && (typeof ev.motivo !== 'string' || ev.motivo.length > UFD_MOTIVO_MAX)) {
    return { codigo: UFD_ANOMALIAS.MOTIVO_INVALIDO, secuencia: ev.secuencia };
  }
  if (ev.evento === UFD_EVENTOS.DESCARTADA && (typeof ev.motivo !== 'string' || ev.motivo.trim() === '')) {
    return { codigo: UFD_ANOMALIAS.MOTIVO_AUSENTE_EN_DESCARTE, secuencia: ev.secuencia };
  }
  return null;
}

// --- Derivacion del estado de un pozo ---

// entrada: {wellId, eventos: [...del pozo, en cualquier orden], fuentes: [... ufd_fuentesDePadron(...).fuentes]}
// salida (nunca lanza):
//   { wellId, integro, version, anomalias[], fuentes[], obsoletas[], aceptadaClave, aceptadaObsoletaClave, historial[] }
//   - integro=false: el log del pozo tiene algun problema; NINGUNA decision aplica (todo queda SIN_REVISAR) y no se aceptan decisiones nuevas.
//   - version: la secuencia mas alta del pozo (0 si no hay eventos). Es la «versionVista» que el cliente devuelve para detectar un estado viejo.
//   - fuentes[i]: {clave, tipo, x, y, lat, lon, posicion, estado, ultimaSecuencia, esAceptadaVigente}
//   - obsoletas[]: claves con decisiones que ya no estan en el padron: {clave, tipo, x, y, estado, ultimaSecuencia}
//   - historial[]: un item por evento, en orden de secuencia, con lo que provoco: {secuencia, evento, clave, tipo, x, y, motivo, obsoleta, reemplazaA, reemplazadaPor,
//     descartaLaAceptada, quitaAceptacion}
function ufd_derivar(entrada) {
  var e = ufd_esObjeto(entrada) ? entrada : {};
  var wellId = typeof e.wellId === 'string' ? e.wellId : null;
  var anomalias = [];
  var eventosCrudos = Array.isArray(e.eventos) ? e.eventos : [];
  var fuentesActuales = Array.isArray(e.fuentes) ? e.fuentes : [];

  if (!ufd_wellIdValido(wellId)) { anomalias.push({ codigo: UFD_ANOMALIAS.WELL_ID_INVALIDO }); }

  // 1. forma + secuencia unica
  var validos = [];
  var vistas = {};
  eventosCrudos.forEach(function (ev) {
    var p = ufd_problemaDeEvento(ev, wellId);
    if (p) { anomalias.push(p); return; }
    if (vistas[ev.secuencia]) {
      anomalias.push({ codigo: UFD_ANOMALIAS.SECUENCIA_DUPLICADA, secuencia: ev.secuencia });
      return;
    }
    vistas[ev.secuencia] = true;
    validos.push(ev);
  });
  validos.sort(function (a, b) { return a.secuencia - b.secuencia; });

  // 2. reproduccion en orden de secuencia (la fecha no interviene)
  var estados = {};          // clave -> {estado, ultimaSecuencia, tipo, x, y}
  var aceptada = null;       // clave de la aceptada vigente del pozo (a lo sumo una, por construccion)
  var historial = [];
  var integro = anomalias.length === 0;
  var itemAceptado = null;   // item del historial del ACEPTADA que hoy esta vigente (para anotar quien lo reemplazo)

  if (integro) {
    for (var k = 0; k < validos.length; k++) {
      var ev = validos[k];
      var clave = ufd_claveFuente(ev.wellId, ev.fuenteTipo, ev.x, ev.y);
      var st = estados[clave] || { estado: UFD_ESTADOS.SIN_REVISAR, ultimaSecuencia: null, tipo: ev.fuenteTipo, x: Number(ufd_normalizarCoordenada(ev.x)), y: Number(ufd_normalizarCoordenada(ev.y)) };
      var item = {
        secuencia: ev.secuencia, evento: ev.evento, clave: clave, tipo: ev.fuenteTipo, x: st.x, y: st.y, motivo: typeof ev.motivo === 'string' ? ev.motivo.trim() : '',
        obsoleta: false, reemplazaA: null, reemplazadaPor: null, descartaLaAceptada: false, quitaAceptacion: false
      };
      var valida = true;
      if (ev.evento === UFD_EVENTOS.ACEPTADA) {
        valida = st.estado === UFD_ESTADOS.SIN_REVISAR;
        if (valida) {
          if (aceptada !== null && aceptada !== clave) {
            item.reemplazaA = aceptada;
            estados[aceptada].estado = UFD_ESTADOS.SIN_REVISAR;
            if (itemAceptado) { itemAceptado.reemplazadaPor = clave; }
          }
          st.estado = UFD_ESTADOS.ACEPTADA;
          aceptada = clave;
          itemAceptado = item;
        }
      } else if (ev.evento === UFD_EVENTOS.DESCARTADA) {
        valida = st.estado !== UFD_ESTADOS.DESCARTADA;
        if (valida) {
          if (aceptada === clave) { aceptada = null; itemAceptado = null; item.descartaLaAceptada = true; }
          st.estado = UFD_ESTADOS.DESCARTADA;
        }
      } else if (ev.evento === UFD_EVENTOS.ACEPTACION_QUITADA) {
        valida = st.estado === UFD_ESTADOS.ACEPTADA;
        if (valida) { st.estado = UFD_ESTADOS.SIN_REVISAR; aceptada = null; itemAceptado = null; item.quitaAceptacion = true; }
      } else {      // RESTAURADA
        valida = st.estado === UFD_ESTADOS.DESCARTADA;
        if (valida) { st.estado = UFD_ESTADOS.SIN_REVISAR; }
      }
      if (!valida) {
        anomalias.push({ codigo: UFD_ANOMALIAS.TRANSICION_INVALIDA_EN_LOG, secuencia: ev.secuencia, evento: ev.evento, desde: st.estado });
        integro = false;
        break;
      }
      st.ultimaSecuencia = ev.secuencia;
      estados[clave] = st;
      historial.push(item);
    }
  }

  var version = validos.length > 0 ? validos[validos.length - 1].secuencia : 0;

  // 3. cruce con el padron de hoy
  var clavesActuales = {};
  var fuentes = fuentesActuales.map(function (f) {
    clavesActuales[f.clave] = true;
    var st = integro ? estados[f.clave] : null;
    return {
      clave: f.clave, tipo: f.tipo, x: f.x, y: f.y, lat: f.lat, lon: f.lon, posicion: f.posicion,
      estado: st ? st.estado : UFD_ESTADOS.SIN_REVISAR,
      ultimaSecuencia: st ? st.ultimaSecuencia : null,
      esAceptadaVigente: integro && aceptada === f.clave
    };
  });
  var obsoletas = [];
  if (integro) {
    Object.keys(estados).forEach(function (clave) {
      if (!clavesActuales[clave]) {
        var s = estados[clave];
        obsoletas.push({ clave: clave, tipo: s.tipo, x: s.x, y: s.y, estado: s.estado, ultimaSecuencia: s.ultimaSecuencia });
      }
    });
    obsoletas.sort(function (a, b) { return a.ultimaSecuencia - b.ultimaSecuencia; });
    historial.forEach(function (h) { h.obsoleta = !clavesActuales[h.clave]; });
  }
  var aceptadaClave = integro && aceptada !== null && clavesActuales[aceptada] ? aceptada : null;
  var aceptadaObsoletaClave = integro && aceptada !== null && !clavesActuales[aceptada] ? aceptada : null;

  var estado = {
    wellId: wellId, integro: integro, version: version, anomalias: anomalias, fuentes: fuentes, obsoletas: obsoletas,
    aceptadaClave: aceptadaClave, aceptadaObsoletaClave: aceptadaObsoletaClave, historial: integro ? historial : []
  };
  var invariante = ufd_verificarInvariantes(estado);
  if (invariante.length > 0) {
    // Imposible por construccion; si algun dia pasara (un bug), se falla cerrado.
    estado.anomalias = estado.anomalias.concat(invariante);
    estado.integro = false;
  }
  return estado;
}

// Defensa en profundidad: a lo sumo UNA fuente aceptada vigente por pozo. La derivacion lo garantiza por construccion (el ACEPTADA mas nuevo reemplaza al anterior), asi
// que esto solo detectaria un bug o un estado armado a mano. Devuelve la lista de anomalias (vacia = todo bien).
function ufd_verificarInvariantes(estado) {
  var out = [];
  var aceptadas = (estado && Array.isArray(estado.fuentes) ? estado.fuentes : []).filter(function (f) { return f.estado === UFD_ESTADOS.ACEPTADA; });
  var claves = {};
  aceptadas.forEach(function (f) { claves[f.clave] = true; });
  if (Object.keys(claves).length > 1) { out.push({ codigo: UFD_ANOMALIAS.ACEPTADAS_MULTIPLES, claves: Object.keys(claves) }); }
  return out;
}

// Agrupa eventos de varios pozos: {wellId: [eventos]}. Un evento sin wellId valido va a la clave '' (y hara inconsistente al que lo reciba, si se lo pasan).
function ufd_agruparPorPozo(eventos) {
  var out = {};
  (Array.isArray(eventos) ? eventos : []).forEach(function (ev) {
    var w = ufd_esObjeto(ev) && typeof ev.wellId === 'string' ? ev.wellId : '';
    (out[w] = out[w] || []).push(ev);
  });
  return out;
}

// --- Solicitudes (validan una decision contra el estado derivado y devuelven el evento a escribir) ---

// solicitud: {decision: 'ACEPTAR'|'DESCARTAR'|'RESTAURAR'|'QUITAR', fuenteTipo, x, y, motivo?, versionVista}
// salida: {ok:true, evento: {wellId, evento, fuenteTipo, x, y, motivo}, efecto: {desde, hacia, reemplazaA, descartaLaAceptada, quitaAceptacion}} | {ok:false, codigo, mensaje, ...}
// El evento NO lleva secuencia, fecha, usuario ni id: los asigna quien lo escribe (etapa de backend, bajo lock). Orden de los chequeos: forma -> pozo integro -> la
// fuente existe hoy -> estado viejo -> transicion.
function ufd_decidir(estado, solicitud) {
  var s = ufd_esObjeto(solicitud) ? solicitud : {};
  var st = ufd_esObjeto(estado) ? estado : null;
  if (typeof s.decision !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_DECISIONES, s.decision)) {
    return ufd_error(UFD_ERRORES.INVALID_DECISION, 'La decision debe ser ACEPTAR, DESCARTAR, RESTAURAR o QUITAR');
  }
  if (st === null || !ufd_wellIdValido(st.wellId)) { return ufd_error(UFD_ERRORES.WELL_ID_INVALIDO, 'Pozo invalido'); }
  if (typeof s.fuenteTipo !== 'string' || !Object.prototype.hasOwnProperty.call(UFD_TIPOS, s.fuenteTipo) || ufd_claveFuente(st.wellId, s.fuenteTipo, s.x, s.y) === null) {
    return ufd_error(UFD_ERRORES.INVALID_FUENTE, 'La fuente indicada no es valida (tipo, x e y)');
  }
  if (typeof s.versionVista !== 'number' || !isFinite(s.versionVista) || Math.floor(s.versionVista) !== s.versionVista || s.versionVista < 0) {
    return ufd_error(UFD_ERRORES.INVALID_VERSION, 'versionVista debe ser un entero >= 0');
  }
  var motivo = '';
  if (s.motivo !== undefined && s.motivo !== null) {
    if (typeof s.motivo !== 'string') { return ufd_error(UFD_ERRORES.MOTIVO_INVALIDO, 'El motivo debe ser texto'); }
    motivo = s.motivo.trim();
    if (motivo.length > UFD_MOTIVO_MAX) { return ufd_error(UFD_ERRORES.MOTIVO_INVALIDO, 'El motivo no puede superar los ' + UFD_MOTIVO_MAX + ' caracteres'); }
  }
  if (s.decision === UFD_DECISIONES.DESCARTAR && motivo === '') {
    return ufd_error(UFD_ERRORES.MOTIVO_REQUERIDO, 'Para descartar una fuente el motivo es obligatorio');
  }
  if (!st.integro) {
    return ufd_error(UFD_ERRORES.INCONSISTENT_STATE, 'Las decisiones de este pozo estan inconsistentes: se necesita una revision antes de agregar otra');
  }
  var clave = ufd_claveFuente(st.wellId, s.fuenteTipo, s.x, s.y);
  var fuente = (Array.isArray(st.fuentes) ? st.fuentes : []).filter(function (f) { return f.clave === clave; })[0];
  if (!fuente) {
    return ufd_error(UFD_ERRORES.SOURCE_NOT_FOUND, 'Esa coordenada ya no figura entre las fuentes del pozo (el padron pudo haber cambiado)');
  }
  if (s.versionVista !== st.version) {
    return ufd_error(UFD_ERRORES.STALE_STATE, 'Las decisiones de este pozo cambiaron mientras mirabas: volve a cargarlas', { versionActual: st.version });
  }

  var desde = fuente.estado;
  var hacia;
  var efecto = { desde: desde, hacia: null, reemplazaA: null, descartaLaAceptada: false, quitaAceptacion: false };
  if (s.decision === UFD_DECISIONES.ACEPTAR) {
    if (desde === UFD_ESTADOS.ACEPTADA) { return ufd_error(UFD_ERRORES.ALREADY_IN_STATE, 'Esa fuente ya esta aceptada'); }
    if (desde === UFD_ESTADOS.DESCARTADA) { return ufd_error(UFD_ERRORES.INVALID_TRANSITION, 'Una fuente descartada no se puede aceptar: primero hay que restaurarla'); }
    hacia = UFD_ESTADOS.ACEPTADA;
    var previa = st.aceptadaClave || st.aceptadaObsoletaClave;
    efecto.reemplazaA = previa && previa !== clave ? previa : null;
  } else if (s.decision === UFD_DECISIONES.DESCARTAR) {
    if (desde === UFD_ESTADOS.DESCARTADA) { return ufd_error(UFD_ERRORES.ALREADY_IN_STATE, 'Esa fuente ya esta descartada'); }
    hacia = UFD_ESTADOS.DESCARTADA;
    efecto.descartaLaAceptada = desde === UFD_ESTADOS.ACEPTADA;
  } else if (s.decision === UFD_DECISIONES.QUITAR) {
    if (desde === UFD_ESTADOS.SIN_REVISAR) { return ufd_error(UFD_ERRORES.ALREADY_IN_STATE, 'Esa fuente no esta aceptada'); }
    if (desde === UFD_ESTADOS.DESCARTADA) { return ufd_error(UFD_ERRORES.INVALID_TRANSITION, 'Esa fuente esta descartada, no aceptada: para volver a usarla hay que restaurarla'); }
    hacia = UFD_ESTADOS.SIN_REVISAR;
    efecto.quitaAceptacion = true;
  } else {      // RESTAURAR
    if (desde === UFD_ESTADOS.SIN_REVISAR) { return ufd_error(UFD_ERRORES.ALREADY_IN_STATE, 'Esa fuente no esta descartada'); }
    if (desde === UFD_ESTADOS.ACEPTADA) { return ufd_error(UFD_ERRORES.INVALID_TRANSITION, 'Esa fuente esta aceptada, no descartada: para dejar de aceptarla usa «Quitar aceptacion»'); }
    hacia = UFD_ESTADOS.SIN_REVISAR;
  }
  efecto.hacia = hacia;
  return {
    ok: true,
    evento: {
      wellId: st.wellId, evento: UFD_DECISION_A_EVENTO[s.decision], fuenteTipo: s.fuenteTipo,
      x: Number(ufd_normalizarCoordenada(s.x)), y: Number(ufd_normalizarCoordenada(s.y)), motivo: motivo
    },
    efecto: efecto
  };
}

// --- Resolver del punto operativo REGISTRAL ---

function ufd_fuenteOperativaDeTipo(tipo) {
  return tipo === UFD_TIPOS.REPORTE_POZOS ? UFD_FUENTES_OPERATIVAS.IRR_REPORTE : UFD_FUENTES_OPERATIVAS.IRR_PROVINCIA;
}

// Resultado de Python -> estado humano (el mismo mapeo que UOP_ESTADO_PADRON del modulo del punto operativo).
function ufd_mapearResultadoAutomatico(res, candidatas, indiceElegido) {
  var out = { estado: UFD_RESULTADO_ESTADOS.SIN_COORDENADAS, nivel: null, lat: null, lon: null, x: null, y: null, fuente: null, fuenteClave: null, regla: UFD_REGLAS.R0, operativo: false, anomalias: [] };
  if (res.estado === 'unica' || res.estado === 'corroborada') {
    if (!ufd_dentroDeMendoza(res.lat, res.lon)) {
      out.anomalias.push({ codigo: UFD_ANOMALIAS.COORDENADA_FUERA_DE_MENDOZA });
      return out;
    }
    var elegida = candidatas[indiceElegido];
    out.estado = res.estado === 'unica' ? UFD_RESULTADO_ESTADOS.DISPONIBLE : UFD_RESULTADO_ESTADOS.COINCIDENTE;
    out.lat = res.lat; out.lon = res.lon; out.x = res.x; out.y = res.y;
    out.fuente = res.estado === 'unica' ? ufd_fuenteOperativaDeTipo(elegida.tipo) : UFD_FUENTES_OPERATIVAS.IRR_VARIAS;
    out.fuenteClave = elegida.clave;
    out.regla = UFD_REGLAS.R2;
    out.operativo = true;
    if (res.estado === 'corroborada') { out.distanciaCorroboracionM = res.distanciaCorroboracion; }
  } else if (res.estado !== 'sinCoordenadas') {
    out.estado = UFD_RESULTADO_ESTADOS.DISCREPANCIA;
    out.nivel = res.estado === 'dudosoLeve' ? 'leve' : (res.estado === 'revisar' ? 'revisar' : 'grave');
    out.distanciaMaximaM = res.distanciaMaxima;
  }
  return out;
}

// estadoDerivado: lo que devuelve ufd_derivar. Prioridad (la validada en campo se integra aparte, por encima de esto):
//   R1b  fuente ACEPTADA vigente (y presente hoy en el padron, con coordenada valida)   -> estado ACEPTADA
//   R2   resolver automatico sobre las fuentes NO descartadas                          -> COINCIDENTE / DISPONIBLE / DISCREPANCIA / SIN_COORDENADAS
//   R0   sin fuentes que participen
// Un pozo con log inconsistente ignora TODAS sus decisiones (resuelve como si no existieran) y lo informa.
// salida: {wellId, estado, nivel, lat, lon, x, y, fuente, fuenteClave, regla, operativo, todasDescartadas, participantes, descartadas[], automatico, original, cambiaRespectoDelOriginal,
//          anomalias[]}
//   - automatico: lo que diria el resolver sobre las no descartadas (aunque haya una aceptada, para mostrar «el automatico dice…»)
//   - original: lo que diria el resolver con TODAS las fuentes, sin ninguna decision
function ufd_resolverRegistral(estadoDerivado) {
  var e = ufd_esObjeto(estadoDerivado) ? estadoDerivado : { fuentes: [], integro: false, anomalias: [], wellId: null };
  var anomalias = [];
  var integro = e.integro === true;
  if (!integro) { anomalias.push({ codigo: UFD_ANOMALIAS.POZO_INCONSISTENTE }); }
  var todas = (Array.isArray(e.fuentes) ? e.fuentes : []).map(function (f) { return { clave: f.clave, tipo: f.tipo, x: f.x, y: f.y, estado: integro ? f.estado : UFD_ESTADOS.SIN_REVISAR, lat: f.lat, lon: f.lon }; });
  var participantes = todas.filter(function (f) { return f.estado !== UFD_ESTADOS.DESCARTADA; });
  var descartadas = todas.filter(function (f) { return f.estado === UFD_ESTADOS.DESCARTADA; }).map(function (f) { return f.clave; });

  var detOriginal = ufd_resolverAutomaticoDetallado(todas);
  var original = ufd_mapearResultadoAutomatico(detOriginal.resultado, todas, detOriginal.indiceElegido);
  var detAuto = ufd_resolverAutomaticoDetallado(participantes);
  var automatico = ufd_mapearResultadoAutomatico(detAuto.resultado, participantes, detAuto.indiceElegido);

  var final = automatico;
  var aceptada = integro ? todas.filter(function (f) { return f.estado === UFD_ESTADOS.ACEPTADA; })[0] : null;
  if (aceptada) {
    if (ufd_dentroDeMendoza(aceptada.lat, aceptada.lon)) {
      final = {
        estado: UFD_RESULTADO_ESTADOS.ACEPTADA, nivel: null, lat: aceptada.lat, lon: aceptada.lon, x: aceptada.x, y: aceptada.y, fuente: ufd_fuenteOperativaDeTipo(aceptada.tipo),
        fuenteClave: aceptada.clave, regla: UFD_REGLAS.R1B, operativo: true, anomalias: []
      };
    } else {
      anomalias.push({ codigo: UFD_ANOMALIAS.ACEPTADA_FUERA_DE_MENDOZA, clave: aceptada.clave });
    }
  }
  var resultado = {};
  Object.keys(final).forEach(function (k) { resultado[k] = final[k]; });
  resultado.anomalias = anomalias.concat(final.anomalias || []);
  resultado.wellId = e.wellId || null;
  resultado.todasDescartadas = todas.length > 0 && participantes.length === 0;
  resultado.participantes = participantes.length;
  resultado.descartadas = descartadas;
  resultado.automatico = automatico;
  resultado.original = original;
  resultado.cambiaRespectoDelOriginal = resultado.estado !== original.estado || resultado.lat !== original.lat || resultado.lon !== original.lon;
  return resultado;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFD_VERSION, UFD_TIPOS, UFD_EVENTOS, UFD_ESTADOS, UFD_DECISIONES, UFD_DECISION_A_EVENTO, UFD_REGLAS, UFD_RESULTADO_ESTADOS, UFD_FUENTES_OPERATIVAS, UFD_MOTIVO_MAX,
    UFD_DECIMALES_CLAVE, UFD_UMBRAL_CORROBORACION_M, UFD_UMBRAL_DUDOSO_M, UFD_UMBRAL_GRAVE_M, UFD_MENDOZA_BBOX, UFD_ERRORES, UFD_ANOMALIAS,
    ufd_redondearComoPython,
    ufd_wellIdValido,
    ufd_normalizarCoordenada,
    ufd_claveFuente,
    ufd_partesDeClave,
    ufd_fuentesDePadron,
    ufd_resolverAutomatico,
    ufd_resolverAutomaticoDetallado,
    ufd_problemaDeEvento,
    ufd_derivar,
    ufd_verificarInvariantes,
    ufd_agruparPorPozo,
    ufd_decidir,
    ufd_resolverRegistral
  };
}
