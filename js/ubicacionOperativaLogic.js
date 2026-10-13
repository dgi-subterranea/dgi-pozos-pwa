// PUNTO OPERATIVO del pozo (Etapa 1: modulo puro, sin DOM, sin red, sin Leaflet, sin backend; todavia NO lo usa ninguna pantalla).
//
// Responde, para un wellId, "donde esta el pozo" con UNA regla central que despues deben heredar el Mapa de pozos, Cerca Mio, la seleccion y los reemplazos
// (el punto de aplicacion sera mapaDataset_obtener, una sola vez). Ningun modulo debe re-implementar estas reglas.
//
// FUENTE, ESTADO y CONFIANZA son SIEMPRE tres cosas distintas (nunca un mismo campo):
//   fuente     de donde sale la coordenada del punto operativo:  IRR_REPORTE | IRR_PROVINCIA | IRR_VARIAS | CAMPO_CORREGIDA
//   estado     que se sabe de ese punto:                          SIN_COORDENADAS | DISPONIBLE | COINCIDENTE | VALIDADA_CAMPO | DISCREPANCIA
//   confianza  nivel derivado por TABLA (sin IA, sin score):      A (validada en campo) | B (coincidente) | C (una sola fuente) | D (discrepancia) | null
//
// Reglas V1 (las aprobadas; NE, Relevamiento, "Confirmada en campo" y candidatos satelitales NO entran todavia):
//   R1  hay una correccion VALIDADA vigente  -> su lat/lon, fuente CAMPO_CORREGIDA, estado VALIDADA_CAMPO, confianza A.
//   R2  si no, y el padron tiene punto (DISPONIBLE o COINCIDENTE) -> ese punto, tal cual.
//   R0  si no -> sin punto operativo (SIN_COORDENADAS o DISCREPANCIA: el padron no elige una candidata por su cuenta).
// La coordenada de Irrigacion NUNCA se borra ni se pisa: queda en `base`. Revertir una validada devuelve el pozo a su base (el backend ya no la informa como
// vigente); una SUPERADA, RECHAZADA, REVERTIDA, PROPUESTA o INCONSISTENTE nunca es override.
//
// Dos contratos:
//  1) PUNTO DEL DATASET (camino caliente, el de pozos.json; viaja a todo usuario activo, asi que es MINIMO): los campos de siempre
//     {wellId, lat, lon, estado:'C'|'D', cuenca, profundidad, tramosFiltrantes, surgencia}; un punto reemplazado por una validada suma
//     {estado:'V', fuente:'CAMPO', base:{lat,lon,estado}|null, vts}. NUNCA lleva autor, observacion, email, motivo, historial, metodo ni correccionId.
//     `base` solo existe en puntos con overlay: lo necesita Reemplazos (comparar la coordenada NE contra la de Irrigacion) y la futura opcion
//     "Mostrar ubicaciones/fuentes anteriores"; null si el pozo no tenia punto en el mapa.
//  2) PUNTO OPERATIVO COMPLETO (ficha / analisis): ver ubicacionOperativaLogic_resolver.
(function (global) {
  var UOP_VERSION = 1;

  // Mismo recuadro que el backend (UBICACION_CORR_MENDOZA_BBOX): una coordenada fuera de Mendoza nunca es operativa. Un test compara ambos valores.
  var UOP_MENDOZA_BBOX = { latMin: -37.65, latMax: -31.95, lonMin: -70.65, lonMax: -66.45 };

  var UOP_FUENTES = { IRR_REPORTE: 'IRR_REPORTE', IRR_PROVINCIA: 'IRR_PROVINCIA', IRR_VARIAS: 'IRR_VARIAS', CAMPO_CORREGIDA: 'CAMPO_CORREGIDA' };
  var UOP_ESTADOS = { SIN_COORDENADAS: 'SIN_COORDENADAS', DISPONIBLE: 'DISPONIBLE', COINCIDENTE: 'COINCIDENTE', VALIDADA_CAMPO: 'VALIDADA_CAMPO', DISCREPANCIA: 'DISCREPANCIA' };
  var UOP_REGLAS = { R1: 'R1_CAMPO_VALIDADA', R2: 'R2_BASE', R0: 'R0_NINGUNA' };

  // Camino caliente: el padron solo informa que es Irrigacion (pozos.json no distingue Reporte Pozos / Provincia); un override es CAMPO.
  var UOP_FUENTE_DATASET_BASE = 'IRR';
  var UOP_FUENTE_DATASET_CAMPO = 'CAMPO';

  // Codigo de una letra del dataset <-> estado completo. D y C ya existen en pozos.json; V se suma por el overlay.
  var UOP_CODIGO_A_ESTADO = { D: 'DISPONIBLE', C: 'COINCIDENTE', V: 'VALIDADA_CAMPO' };
  var UOP_ESTADO_A_CODIGO = { DISPONIBLE: 'D', COINCIDENTE: 'C', VALIDADA_CAMPO: 'V' };

  // Tabla inicial (no hay otra forma de llegar a una confianza): VALIDADA_CAMPO=A, COINCIDENTE=B, DISPONIBLE=C, DISCREPANCIA=D, SIN_COORDENADAS=null.
  var UOP_CONFIANZA_POR_ESTADO = { VALIDADA_CAMPO: 'A', COINCIDENTE: 'B', DISPONIBLE: 'C', DISCREPANCIA: 'D', SIN_COORDENADAS: null };

  // Etiquetas humanas. El rename "Ubicacion confirmada" -> "Ubicacion coincidente" se hace en las pantallas en la etapa de UI; aca solo quedan definidas.
  var UOP_ETIQUETAS_ESTADO = {
    DISPONIBLE: 'Ubicación disponible',
    COINCIDENTE: 'Ubicación coincidente',
    VALIDADA_CAMPO: 'Validada en campo',
    DISCREPANCIA: 'Discrepancia',
    SIN_COORDENADAS: 'Sin coordenadas'
  };
  var UOP_ETIQUETAS_CODIGO_CORTAS = { D: 'Disponible', C: 'Coincidente', V: 'Validada en campo' };

  // Estado del padron (ubicacionResuelta.estado) -> estado humano. dudosoLeve / revisar / revisarGrave son los tres niveles de DISCREPANCIA.
  var UOP_ESTADO_PADRON = {
    sinCoordenadas: { estado: 'SIN_COORDENADAS' },
    unica: { estado: 'DISPONIBLE' },
    corroborada: { estado: 'COINCIDENTE' },
    dudosoLeve: { estado: 'DISCREPANCIA', nivel: 'leve' },
    revisar: { estado: 'DISCREPANCIA', nivel: 'revisar' },
    revisarGrave: { estado: 'DISCREPANCIA', nivel: 'grave' }
  };
  var UOP_FUENTE_PADRON = { reportePozos: 'IRR_REPORTE', coordProvincia: 'IRR_PROVINCIA' };
  var UOP_METODOS_CONOCIDOS = ['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2'];
  var UOP_WELL_ID_REGEX = /^(\d{2})-(\d{4})$/;

  // --- Utilidades ---

  function esNumero(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function esObjeto(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
  }

  function redondear(v, decimales) {
    var f = Math.pow(10, decimales);
    return Math.round(v * f) / f;
  }

  function wellIdValido(w) {
    if (typeof w !== 'string') { return false; }
    var m = UOP_WELL_ID_REGEX.exec(w);
    if (!m) { return false; }
    var d = parseInt(m[1], 10);
    return d >= 1 && d <= 19;
  }

  // Coordenada utilizable como punto operativo: numeros finitos dentro de Mendoza (mismo criterio que el backend).
  function ubicacionOperativaLogic_coordenadaValida(lat, lon) {
    var b = UOP_MENDOZA_BBOX;
    return esNumero(lat) && esNumero(lon) && lat >= b.latMin && lat <= b.latMax && lon >= b.lonMin && lon <= b.lonMax;
  }

  // Haversine en metros (R = 6371008.8, el mismo radio que ubicacionCorreccionLogic_distanciaMetros), redondeada a 0,1 m.
  function ubicacionOperativaLogic_distanciaMetros(lat1, lon1, lat2, lon2) {
    var R = 6371008.8;
    var rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad;
    var dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return redondear(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)), 1);
  }

  // --- Estados, codigos, etiquetas y confianza ---

  function ubicacionOperativaLogic_estadoDeCodigo(codigo) {
    return Object.prototype.hasOwnProperty.call(UOP_CODIGO_A_ESTADO, codigo) ? UOP_CODIGO_A_ESTADO[codigo] : null;
  }

  function ubicacionOperativaLogic_codigoDeEstado(estado) {
    return Object.prototype.hasOwnProperty.call(UOP_ESTADO_A_CODIGO, estado) ? UOP_ESTADO_A_CODIGO[estado] : null;
  }

  function ubicacionOperativaLogic_confianzaDeEstado(estado) {
    return Object.prototype.hasOwnProperty.call(UOP_CONFIANZA_POR_ESTADO, estado) ? UOP_CONFIANZA_POR_ESTADO[estado] : null;
  }

  function ubicacionOperativaLogic_etiquetaEstado(estado) {
    return Object.prototype.hasOwnProperty.call(UOP_ETIQUETAS_ESTADO, estado) ? UOP_ETIQUETAS_ESTADO[estado] : '';
  }

  // Etiqueta de un codigo de una letra (chips y popups del mapa). corta=true -> "Disponible" / "Coincidente" / "Validada en campo".
  function ubicacionOperativaLogic_etiquetaCodigo(codigo, corta) {
    var estado = ubicacionOperativaLogic_estadoDeCodigo(codigo);
    if (!estado) { return ''; }
    return corta ? UOP_ETIQUETAS_CODIGO_CORTAS[codigo] : UOP_ETIQUETAS_ESTADO[estado];
  }

  // Lo que se sabe de un punto del DATASET con solo lo que trae (sin red): estado completo, fuente generica y confianza derivada.
  function ubicacionOperativaLogic_infoDePuntoDataset(punto) {
    if (!esObjeto(punto)) { return null; }
    var estado = ubicacionOperativaLogic_estadoDeCodigo(punto.estado);
    if (!estado) { return null; }
    return {
      estado: estado,
      fuente: punto.fuente === UOP_FUENTE_DATASET_CAMPO ? UOP_FUENTES.CAMPO_CORREGIDA : UOP_FUENTE_DATASET_BASE,
      confianza: ubicacionOperativaLogic_confianzaDeEstado(estado),
      etiqueta: UOP_ETIQUETAS_ESTADO[estado]
    };
  }

  // --- Overrides (deltas de correcciones VALIDADAS vigentes) ---

  function normalizarVts(v) {
    if (typeof v === 'string' && v.length > 0 && v.length <= 40) { return v; }
    if (esNumero(v)) { return v; }
    return null;
  }

  // {wellId, lat, lon, vts} -> delta limpio o null. Solo se copian esos 4 campos: cualquier otro (autor, observacion, email, motivo...) se descarta aca.
  function ubicacionOperativaLogic_normalizarDelta(d) {
    if (!esObjeto(d) || !wellIdValido(d.wellId) || !ubicacionOperativaLogic_coordenadaValida(d.lat, d.lon)) {
      return null;
    }
    return { wellId: d.wellId, lat: d.lat, lon: d.lon, vts: normalizarVts(d.vts) };
  }

  function motivoDescarte(d) {
    if (!esObjeto(d)) { return 'NO_ES_OBJETO'; }
    if (!wellIdValido(d.wellId)) { return 'WELL_ID_INVALIDO'; }
    return 'COORDENADA_INVALIDA';
  }

  // Entre dos deltas del mismo pozo gana el de vts mas reciente (ISO se ordena como texto; numeros por valor); sin vts comparable, el ultimo de la lista.
  function esMasNuevo(nuevo, actual) {
    if (nuevo.vts !== null && actual.vts !== null && typeof nuevo.vts === typeof actual.vts) {
      return nuevo.vts >= actual.vts;
    }
    return true;
  }

  // deltas (lista de objetos) -> {porWell: {wellId: delta}, descartadas: [{wellId, motivo}], duplicadas: n}. Nunca lanza.
  function ubicacionOperativaLogic_indexarDeltas(deltas) {
    var porWell = Object.create(null);
    var descartadas = [];
    var duplicadas = 0;
    var lista = Array.isArray(deltas) ? deltas : [];
    for (var i = 0; i < lista.length; i++) {
      var d = ubicacionOperativaLogic_normalizarDelta(lista[i]);
      if (!d) {
        descartadas.push({ wellId: esObjeto(lista[i]) && typeof lista[i].wellId === 'string' ? lista[i].wellId : null, motivo: motivoDescarte(lista[i]) });
        continue;
      }
      var previo = porWell[d.wellId];
      if (previo) {
        duplicadas += 1;
        if (!esMasNuevo(d, previo)) { continue; }
      }
      porWell[d.wellId] = d;
    }
    return { porWell: porWell, descartadas: descartadas, duplicadas: duplicadas };
  }

  // De una lista de correcciones (vistas del backend) devuelve la VIGENTE: solo estado VALIDADA; si por una inconsistencia hubiera mas de una, la mas
  // reciente (misma regla que getCorreccionesUbicacionPozo). SUPERADA, REVERTIDA, RECHAZADA, PROPUESTA e INCONSISTENTE nunca son vigentes.
  function ubicacionOperativaLogic_vigenteDeCorrecciones(correcciones) {
    var mejor = null;
    (Array.isArray(correcciones) ? correcciones : []).forEach(function (c) {
      if (!esObjeto(c) || c.estado !== 'VALIDADA') { return; }
      var t = typeof c.timestamp === 'string' ? c.timestamp : '';
      if (mejor === null || t >= mejor.t) { mejor = { c: c, t: t }; }
    });
    return mejor ? mejor.c : null;
  }

  // --- Punto del dataset (camino caliente) ---

  // Atributos que el padron conoce por wellId aunque el pozo no tenga punto en el mapa: profundidad, tramos filtrantes, surgencia (y cuenca si alguien la trae;
  // el padron NO la guarda: sale de ubicar el punto en un poligono, y esa asignacion no se recalcula aca). Todo lo que no existe queda en null / [] ("Sin dato").
  function atributosDeRegistral(registral) {
    var r = esObjeto(registral) ? registral : {};
    var prof = esNumero(r.profundidad) ? r.profundidad : (esNumero(r.profundidadTotal) ? r.profundidadTotal : null);
    var tramos = [];
    if (Array.isArray(r.tramosFiltrantes)) {
      r.tramosFiltrantes.forEach(function (t) {
        if (esObjeto(t)) {
          tramos.push({ desde: esNumero(t.desde) ? t.desde : null, hasta: esNumero(t.hasta) ? t.hasta : null });
        }
      });
    }
    return {
      cuenca: typeof r.cuenca === 'string' && r.cuenca !== '' ? r.cuenca : null,
      profundidad: prof,
      tramosFiltrantes: tramos,
      surgencia: typeof r.surgencia === 'string' && r.surgencia !== '' ? r.surgencia : null
    };
  }

  function hayAtributosRegistrales(registral) {
    if (!esObjeto(registral)) { return false; }
    var a = atributosDeRegistral(registral);
    return a.cuenca !== null || a.profundidad !== null || a.tramosFiltrantes.length > 0 || a.surgencia !== null;
  }

  // La coordenada y el estado de la base de un punto del dataset (si ya lleva overlay, la base ORIGINAL guardada en `base`; asi aplicar dos veces no anida).
  function baseDePuntoDataset(punto) {
    if (punto.fuente === UOP_FUENTE_DATASET_CAMPO) {
      var b = punto.base;
      return esObjeto(b) && ubicacionOperativaLogic_coordenadaValida(b.lat, b.lon)
        ? { lat: b.lat, lon: b.lon, estado: b.estado === 'C' || b.estado === 'D' ? b.estado : null } : null;
    }
    if (!ubicacionOperativaLogic_coordenadaValida(punto.lat, punto.lon)) { return null; }
    return { lat: punto.lat, lon: punto.lon, estado: punto.estado === 'C' || punto.estado === 'D' ? punto.estado : null };
  }

  // Resuelve UN punto del dataset. base: punto de pozos.json o null (pozo sin punto en el mapa). delta: override ya normalizado o null.
  // registral: atributos del padron del pozo (solo se usan si no hay base). NUNCA muta base ni delta; devuelve un objeto NUEVO cuando cambia algo y el MISMO
  // objeto base cuando no hay override. Sin base y sin override -> null (R0).
  function ubicacionOperativaLogic_resolverPuntoDataset(base, delta, registral) {
    var d = delta ? ubicacionOperativaLogic_normalizarDelta(delta) : null;
    var tieneBase = esObjeto(base);
    if (!d) {
      return tieneBase ? base : null;
    }
    var out = {};
    if (tieneBase) {
      Object.keys(base).forEach(function (k) { out[k] = base[k]; });      // copia superficial: cuenca, profundidad, tramos y surgencia se conservan tal cual
    } else {
      var a = atributosDeRegistral(registral);
      out.wellId = d.wellId;
      out.lat = d.lat;
      out.lon = d.lon;
      out.estado = 'V';
      out.cuenca = a.cuenca;
      out.profundidad = a.profundidad;
      out.tramosFiltrantes = a.tramosFiltrantes;
      out.surgencia = a.surgencia;
    }
    var b = tieneBase ? baseDePuntoDataset(base) : null;
    out.lat = d.lat;
    out.lon = d.lon;
    out.estado = 'V';
    out.fuente = UOP_FUENTE_DATASET_CAMPO;
    out.base = b;
    out.vts = d.vts;
    return out;
  }

  // Aplica TODOS los overrides a la lista de puntos de pozos.json (el punto unico donde lo hara mapaDataset_obtener). Devuelve {pozos, resumen}.
  //  - pozos: si no hay nada que aplicar, la MISMA lista; si no, una lista NUEVA con el mismo orden; los puntos sin override son los mismos objetos y los
  //    pozos nuevos (sin punto base) van al final ordenados por wellId. La lista y los puntos base no se modifican.
  //  - opciones.obtenerRegistral(wellId) -> atributos del padron del pozo o null; solo se llama para pozos SIN punto base. Si lanza, el pozo se agrega igual sin esos
  //    atributos ("Sin dato"): un override valido nunca se pierde por no poder enriquecerlo.
  function ubicacionOperativaLogic_aplicarOverlay(pozos, deltas, opciones) {
    var base = Array.isArray(pozos) ? pozos : [];
    var o = opciones || {};
    var idx = ubicacionOperativaLogic_indexarDeltas(deltas);
    var resumen = {
      recibidas: Array.isArray(deltas) ? deltas.length : 0,
      aplicadas: 0, nuevos: 0, nuevosEnriquecidos: 0, nuevosSinRegistral: 0,
      duplicadas: idx.duplicadas, descartadas: idx.descartadas
    };
    var wellIds = Object.keys(idx.porWell);
    if (wellIds.length === 0) {
      return { pozos: base, resumen: resumen };
    }
    var vistos = Object.create(null);
    var salida = new Array(base.length);
    for (var i = 0; i < base.length; i++) {
      var p = base[i];
      var d = esObjeto(p) ? idx.porWell[p.wellId] : undefined;
      if (d) {
        vistos[p.wellId] = true;
        salida[i] = ubicacionOperativaLogic_resolverPuntoDataset(p, d, null);
        resumen.aplicadas += 1;
      } else {
        salida[i] = p;
      }
    }
    wellIds.sort();
    wellIds.forEach(function (wellId) {
      if (vistos[wellId]) { return; }
      var registral = null;
      if (typeof o.obtenerRegistral === 'function') {
        try { registral = o.obtenerRegistral(wellId); } catch (e) { registral = null; }
      }
      salida.push(ubicacionOperativaLogic_resolverPuntoDataset(null, idx.porWell[wellId], registral));
      resumen.aplicadas += 1;
      resumen.nuevos += 1;
      if (hayAtributosRegistrales(registral)) { resumen.nuevosEnriquecidos += 1; } else { resumen.nuevosSinRegistral += 1; }
    });
    return { pozos: salida, resumen: resumen };
  }

  // --- Punto operativo completo (ficha / analisis) ---

  // ubicacionResuelta del padron (la de getWellLocation) -> base normalizada. Nunca inventa una coordenada: sin lat/lon validos no hay punto.
  function ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta) {
    var anomalias = [];
    var r = esObjeto(resuelta) ? resuelta : null;
    var mapeo = r && typeof r.estado === 'string' && Object.prototype.hasOwnProperty.call(UOP_ESTADO_PADRON, r.estado) ? UOP_ESTADO_PADRON[r.estado] : null;
    if (!mapeo) {
      anomalias.push(r ? 'ESTADO_BASE_DESCONOCIDO' : 'BASE_AUSENTE');
      return { estado: 'SIN_COORDENADAS', nivel: null, fuente: null, lat: null, lon: null, estadoPadron: r && typeof r.estado === 'string' ? r.estado : null, anomalias: anomalias };
    }
    var base = { estado: mapeo.estado, nivel: mapeo.nivel || null, fuente: null, lat: null, lon: null, estadoPadron: r.estado, anomalias: anomalias };
    if (mapeo.estado === 'DISPONIBLE' || mapeo.estado === 'COINCIDENTE') {
      if (!ubicacionOperativaLogic_coordenadaValida(r.lat, r.lon)) {
        anomalias.push('BASE_SIN_COORDENADA_VALIDA');
        base.estado = 'SIN_COORDENADAS';
        return base;
      }
      base.lat = r.lat;
      base.lon = r.lon;
      if (mapeo.estado === 'COINCIDENTE') {
        base.fuente = UOP_FUENTES.IRR_VARIAS;
        if (esNumero(r.distanciaCorroboracion)) { base.distanciaCorroboracionM = r.distanciaCorroboracion; }
      } else if (Object.prototype.hasOwnProperty.call(UOP_FUENTE_PADRON, r.fuente)) {
        base.fuente = UOP_FUENTE_PADRON[r.fuente];
      } else {
        anomalias.push('FUENTE_BASE_DESCONOCIDA');
      }
    } else if (mapeo.estado === 'DISCREPANCIA' && esNumero(r.distanciaMaxima)) {
      base.distanciaMaximaM = r.distanciaMaxima;
    }
    return base;
  }

  // Un override valido para el resolvedor: una vista de correccion (con estado) o un delta. Devuelve {lat, lon, correccionId, metodo, validadaEl, irrigacion} o
  // {ignorado: motivo}. Solo se copian campos de una lista cerrada: autor, observacion, email, motivo e historial NUNCA pasan.
  function overrideValido(wellId, v) {
    if (v === null || v === undefined) { return null; }
    if (!esObjeto(v)) { return { ignorado: 'OVERRIDE_NO_ES_OBJETO' }; }
    if (v.estado !== undefined && v.estado !== 'VALIDADA') { return { ignorado: 'OVERRIDE_NO_VALIDADA' }; }
    if (v.wellId !== undefined && v.wellId !== wellId) { return { ignorado: 'OVERRIDE_OTRO_POZO' }; }
    if (!ubicacionOperativaLogic_coordenadaValida(v.lat, v.lon)) { return { ignorado: 'OVERRIDE_COORDENADA_INVALIDA' }; }
    var validadaEl = (esObjeto(v.resolucion) && typeof v.resolucion.timestamp === 'string' && v.resolucion.timestamp) ||
      (typeof v.vts === 'string' && v.vts) || (typeof v.timestamp === 'string' && v.timestamp) || null;
    var irr = esObjeto(v.irrigacion) && ubicacionOperativaLogic_coordenadaValida(v.irrigacion.lat, v.irrigacion.lon) ? { lat: v.irrigacion.lat, lon: v.irrigacion.lon } : null;
    return {
      lat: v.lat, lon: v.lon,
      correccionId: typeof v.correccionId === 'string' && v.correccionId !== '' && v.correccionId.length <= 64 ? v.correccionId : null,
      metodo: UOP_METODOS_CONOCIDOS.indexOf(v.metodo) !== -1 ? v.metodo : null,
      validadaEl: validadaEl,
      irrigacion: irr
    };
  }

  // PUNTO OPERATIVO COMPLETO de un pozo.
  // entrada: { wellId, ubicacionResuelta (la del padron, de getWellLocation), vigente (vista de correccion VALIDADA o delta) | correcciones (lista de vistas) }
  // salida:
  //   { wellId, lat, lon,                      coordenada operativa (null si no hay punto)
  //     fuente, estado, confianza,             tres campos distintos (fuente null si no hay punto)
  //     operativo, regla, etiqueta,
  //     base:     { estado, nivel, fuente, lat, lon, estadoPadron, ... }   lo que dice Irrigacion, SIEMPRE conservado
  //     override: { lat, lon, correccionId, metodo, validadaEl, distanciaBaseM, baseCambioM } | null
  //     evidencias: [],                        reservado: NE, Relevamiento... (no se integran todavia)
  //     anomalias: [], version }
  function ubicacionOperativaLogic_resolver(entrada) {
    var e = esObjeto(entrada) ? entrada : {};
    var wellId = typeof e.wellId === 'string' ? e.wellId : null;
    var base = ubicacionOperativaLogic_baseDeUbicacionResuelta(e.ubicacionResuelta);
    var anomalias = base.anomalias.slice();
    delete base.anomalias;
    if (!wellIdValido(wellId)) { anomalias.push('WELL_ID_INVALIDO'); }

    var candidato = e.vigente !== undefined && e.vigente !== null ? e.vigente : ubicacionOperativaLogic_vigenteDeCorrecciones(e.correcciones);
    var ov = wellIdValido(wellId) ? overrideValido(wellId, candidato) : null;
    if (ov && ov.ignorado) {
      anomalias.push(ov.ignorado);
      ov = null;
    }

    var resultado = {
      wellId: wellId, lat: null, lon: null, fuente: null, estado: base.estado, confianza: ubicacionOperativaLogic_confianzaDeEstado(base.estado),
      operativo: false, regla: UOP_REGLAS.R0, etiqueta: UOP_ETIQUETAS_ESTADO[base.estado], base: base, override: null, evidencias: [], anomalias: anomalias, version: UOP_VERSION
    };

    if (ov) {                                                                                      // R1
      var tieneBase = base.lat !== null && base.lon !== null;
      resultado.lat = ov.lat;
      resultado.lon = ov.lon;
      resultado.fuente = UOP_FUENTES.CAMPO_CORREGIDA;
      resultado.estado = UOP_ESTADOS.VALIDADA_CAMPO;
      resultado.confianza = ubicacionOperativaLogic_confianzaDeEstado(UOP_ESTADOS.VALIDADA_CAMPO);
      resultado.operativo = true;
      resultado.regla = UOP_REGLAS.R1;
      resultado.etiqueta = UOP_ETIQUETAS_ESTADO.VALIDADA_CAMPO;
      resultado.override = {
        lat: ov.lat, lon: ov.lon, correccionId: ov.correccionId, metodo: ov.metodo, validadaEl: ov.validadaEl,
        distanciaBaseM: tieneBase ? ubicacionOperativaLogic_distanciaMetros(base.lat, base.lon, ov.lat, ov.lon) : null,
        // la base cambio desde que se valido (el padron se regenera): metros entre la que vio la correccion y la de hoy; solo informativo
        baseCambioM: tieneBase && ov.irrigacion ? ubicacionOperativaLogic_distanciaMetros(ov.irrigacion.lat, ov.irrigacion.lon, base.lat, base.lon) : null
      };
      return resultado;
    }
    if ((base.estado === UOP_ESTADOS.DISPONIBLE || base.estado === UOP_ESTADOS.COINCIDENTE) && base.lat !== null) {      // R2
      resultado.lat = base.lat;
      resultado.lon = base.lon;
      resultado.fuente = base.fuente;
      resultado.operativo = true;
      resultado.regla = UOP_REGLAS.R2;
    }
    return resultado;                                                                              // R0 si no hubo ninguno de los dos
  }

  var API = {
    UOP_VERSION: UOP_VERSION,
    UOP_MENDOZA_BBOX: UOP_MENDOZA_BBOX,
    UOP_FUENTES: UOP_FUENTES,
    UOP_ESTADOS: UOP_ESTADOS,
    UOP_REGLAS: UOP_REGLAS,
    UOP_FUENTE_DATASET_BASE: UOP_FUENTE_DATASET_BASE,
    UOP_FUENTE_DATASET_CAMPO: UOP_FUENTE_DATASET_CAMPO,
    UOP_CODIGO_A_ESTADO: UOP_CODIGO_A_ESTADO,
    UOP_ESTADO_A_CODIGO: UOP_ESTADO_A_CODIGO,
    UOP_CONFIANZA_POR_ESTADO: UOP_CONFIANZA_POR_ESTADO,
    UOP_ETIQUETAS_ESTADO: UOP_ETIQUETAS_ESTADO,
    UOP_ETIQUETAS_CODIGO_CORTAS: UOP_ETIQUETAS_CODIGO_CORTAS,
    UOP_ESTADO_PADRON: UOP_ESTADO_PADRON,
    ubicacionOperativaLogic_coordenadaValida: ubicacionOperativaLogic_coordenadaValida,
    ubicacionOperativaLogic_distanciaMetros: ubicacionOperativaLogic_distanciaMetros,
    ubicacionOperativaLogic_estadoDeCodigo: ubicacionOperativaLogic_estadoDeCodigo,
    ubicacionOperativaLogic_codigoDeEstado: ubicacionOperativaLogic_codigoDeEstado,
    ubicacionOperativaLogic_confianzaDeEstado: ubicacionOperativaLogic_confianzaDeEstado,
    ubicacionOperativaLogic_etiquetaEstado: ubicacionOperativaLogic_etiquetaEstado,
    ubicacionOperativaLogic_etiquetaCodigo: ubicacionOperativaLogic_etiquetaCodigo,
    ubicacionOperativaLogic_infoDePuntoDataset: ubicacionOperativaLogic_infoDePuntoDataset,
    ubicacionOperativaLogic_normalizarDelta: ubicacionOperativaLogic_normalizarDelta,
    ubicacionOperativaLogic_indexarDeltas: ubicacionOperativaLogic_indexarDeltas,
    ubicacionOperativaLogic_vigenteDeCorrecciones: ubicacionOperativaLogic_vigenteDeCorrecciones,
    ubicacionOperativaLogic_resolverPuntoDataset: ubicacionOperativaLogic_resolverPuntoDataset,
    ubicacionOperativaLogic_aplicarOverlay: ubicacionOperativaLogic_aplicarOverlay,
    ubicacionOperativaLogic_baseDeUbicacionResuelta: ubicacionOperativaLogic_baseDeUbicacionResuelta,
    ubicacionOperativaLogic_resolver: ubicacionOperativaLogic_resolver
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = API;
  } else {
    Object.keys(API).forEach(function (k) { global[k] = API[k]; });
  }
})(typeof window !== 'undefined' ? window : this);
