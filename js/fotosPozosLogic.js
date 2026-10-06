// Logica PURA de la galeria general de fotos de pozos / puntos NE (FotosPozos
// v1): sin DOM, sin canvas, sin red - la testea Jest (js/fotosPozosLogic.test.js).
// js/fotosPozos.js es el controlador (pantalla, inputs, visor); js/fotosImagen.js
// el pipeline de imagen (canvas). Reutiliza de js/reemplazoFotosLogic.js
// (cargado antes) las constantes y helpers genericos: limite del original,
// dimensiones, escalera de calidad, formato de bytes, vecino del visor, y los
// helpers de cola (siguienteASubir / hayEnCurso / resumenSubida).
//
// Entidad: {wellId, monitoringId, etiqueta, esNE}. wellId para un pozo Provincia
// o un punto NE con numero de pozo (una sola galeria compartida); monitoringId
// para un punto NE especial sin wellId. La clave que cuenta el resumen es
// wellId o, si no hay, monitoringId.
var FOTOS_POZOS_MAX_POR_LOTE = 10;
var FOTOS_POZOS_OBSERVACION_MAX = 140;
var FOTOS_POZOS_ANIO_MIN = 2005;
var FOTOS_POZOS_FUENTES_ETIQUETA = { CAMPO_APP: 'Carga de campo', MONITOREO_NE: 'Monitoreo NE', RELEVAMIENTO_2018: 'Relevamiento 2018' };
var FOTOS_POZOS_TIPOS_ETIQUETA = { CERCA: 'De cerca', PANORAMICA: 'Panorámica', OTRA: 'Otra' };
var FOTOS_POZOS_TIPOS = ['CERCA', 'PANORAMICA', 'OTRA'];
// Origenes que se pueden elegir al cargar desde la app (los historicos se importan aparte)
var FOTOS_POZOS_FUENTES_CARGA = ['CAMPO_APP', 'MONITOREO_NE'];

// --- Entidad ---

function fotosPozosLogic_claveEntidad(entidad) {
  return (entidad && (entidad.wellId || entidad.monitoringId)) || '';
}

// Entidad del pozo abierto en el hub (pozoActual de app.js). El hub siempre se
// abre por numero de pozo (DD-PPPP); esNE si ademas esta en la red NE.
function fotosPozosLogic_entidadDePozo(pozoActual) {
  if (!pozoActual || !pozoActual.wellId) {
    return null;
  }
  return { wellId: pozoActual.wellId, monitoringId: '', etiqueta: pozoActual.wellId, esNE: !!(pozoActual.ne && pozoActual.ne.found) };
}

// Entidad de un punto NE (ficha NE o popup del mapa NE): con numero de pozo es
// el mismo wellId que en Provincia; un punto especial se indexa por monitoringId.
function fotosPozosLogic_entidadDePuntoNE(punto) {
  if (!punto) {
    return null;
  }
  var monitoringId = punto.monitoringId === undefined || punto.monitoringId === null ? '' : String(punto.monitoringId);
  // El mapa NE trae wellId; la ficha NE (getMonitoringPoint) solo trae monitoringId,
  // que coincide con el wellId unicamente en los puntos que lo tienen (DD-PPPP).
  var wellId = typeof punto.wellId === 'string' && /^\d{2}-\d{4}$/.test(punto.wellId) ? punto.wellId
    : (/^\d{2}-\d{4}$/.test(monitoringId) ? monitoringId : '');
  if (!wellId && !monitoringId) {
    return null;
  }
  return { wellId: wellId, monitoringId: wellId ? '' : monitoringId, etiqueta: wellId || punto.nombreOriginal || monitoringId, esNE: true };
}

// Que fuentes puede elegir el usuario para esa entidad al cargar.
function fotosPozosLogic_fuentesDisponibles(entidad) {
  return entidad && entidad.esNE ? FOTOS_POZOS_FUENTES_CARGA.slice() : ['CAMPO_APP'];
}

// --- Texto ---

function fotosPozosLogic_textoContador(n) {
  return n === 1 ? '1 foto' : n + ' fotos';
}

// Lo que ve el usuario: '14/06/2025', '06/2025', '2025' o 'Sin fecha'. Nunca
// completa un dia o un mes que no se conoce.
function fotosPozosLogic_formatearFecha(valor, precision) {
  if (!valor || precision === 'DESCONOCIDA') {
    return 'Sin fecha';
  }
  var p = String(valor).split('-');
  if (precision === 'ANIO' && p.length === 1) {
    return p[0];
  }
  if (precision === 'MES' && p.length === 2) {
    return p[1] + '/' + p[0];
  }
  if (precision === 'DIA' && p.length === 3) {
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  return 'Sin fecha';
}

function fotosPozosLogic_etiquetaFuente(fuente) {
  return FOTOS_POZOS_FUENTES_ETIQUETA[fuente] || 'Otra fuente';
}

function fotosPozosLogic_etiquetaTipo(tipo) {
  return FOTOS_POZOS_TIPOS_ETIQUETA[tipo] || 'Otra';
}

// --- Filtros / orden de la galeria ---

function fotosPozosLogic_anioDe(foto) {
  if (!foto || foto.fechaFotoPrecision === 'DESCONOCIDA' || !foto.fechaFotoValor) {
    return 'sin_fecha';
  }
  return String(foto.fechaFotoValor).substring(0, 4);
}

// {fuentes, anios, tipos}: cada una [{valor, etiqueta, cantidad}] solo con lo
// que existe en la lista. Anios de mas nuevo a mas viejo, "Sin fecha" al final.
function fotosPozosLogic_opcionesFiltro(fotos) {
  var fuentes = {};
  var anios = {};
  var tipos = {};
  (fotos || []).forEach(function (f) {
    fuentes[f.fuente] = (fuentes[f.fuente] || 0) + 1;
    var a = fotosPozosLogic_anioDe(f);
    anios[a] = (anios[a] || 0) + 1;
    tipos[f.tipoFoto] = (tipos[f.tipoFoto] || 0) + 1;
  });
  return {
    fuentes: Object.keys(fuentes).sort().map(function (v) { return { valor: v, etiqueta: fotosPozosLogic_etiquetaFuente(v), cantidad: fuentes[v] }; }),
    anios: Object.keys(anios).sort(function (a, b) {
      if (a === 'sin_fecha') { return 1; }
      if (b === 'sin_fecha') { return -1; }
      return a < b ? 1 : -1;
    }).map(function (v) { return { valor: v, etiqueta: v === 'sin_fecha' ? 'Sin fecha' : v, cantidad: anios[v] }; }),
    tipos: FOTOS_POZOS_TIPOS.filter(function (t) { return tipos[t]; }).map(function (v) { return { valor: v, etiqueta: fotosPozosLogic_etiquetaTipo(v), cantidad: tipos[v] }; })
  };
}

// filtros: {fuente, anio, tipo} ('' o ausente = todos). AND entre los tres.
function fotosPozosLogic_filtrar(fotos, filtros) {
  var f = filtros || {};
  return (fotos || []).filter(function (foto) {
    return (!f.fuente || foto.fuente === f.fuente) &&
      (!f.anio || fotosPozosLogic_anioDe(foto) === f.anio) &&
      (!f.tipo || foto.tipoFoto === f.tipo);
  });
}

function fotosPozosLogic_hayFiltros(filtros) {
  return !!filtros && !!(filtros.fuente || filtros.anio || filtros.tipo);
}

// Clave de orden por la fecha de la foto, SOLO para ordenar (un anio ordena como
// 1 de enero, un mes como el dia 1; sin fecha: ''). Misma regla que el backend.
function fotosPozosLogic_claveFecha(f) {
  if (!f || f.fechaFotoPrecision === 'DESCONOCIDA' || !f.fechaFotoValor) {
    return '';
  }
  if (f.fechaFotoPrecision === 'ANIO') {
    return f.fechaFotoValor + '-01-01';
  }
  if (f.fechaFotoPrecision === 'MES') {
    return f.fechaFotoValor + '-01';
  }
  return f.fechaFotoValor;
}

// 'recientes' (default) | 'antiguas'; las sin fecha siempre al final. Estable:
// a igual fecha se conserva el orden de entrada.
function fotosPozosLogic_ordenar(fotos, orden) {
  var asc = orden === 'antiguas';
  return (fotos || []).map(function (f, i) { return { f: f, i: i }; }).sort(function (a, b) {
    var ka = fotosPozosLogic_claveFecha(a.f);
    var kb = fotosPozosLogic_claveFecha(b.f);
    if ((ka === '') !== (kb === '')) {
      return ka === '' ? 1 : -1;
    }
    if (ka !== kb) {
      return asc ? (ka < kb ? -1 : 1) : (ka < kb ? 1 : -1);
    }
    return a.i - b.i;
  }).map(function (x) { return x.f; });
}

// Agrega una foto recien subida al principio (primera entre las de igual fecha)
// y reordena. Si ya estaba (mismo fotoId: reintento / duplicada) no la repite.
function fotosPozosLogic_agregarFoto(fotos, nueva, orden) {
  var lista = fotos || [];
  if (lista.some(function (f) { return f.fotoId === nueva.fotoId; })) {
    return lista;
  }
  return fotosPozosLogic_ordenar([nueva].concat(lista), orden);
}

// --- Formato de archivo POR CONTENIDO (la extension/mime pueden mentir) ---

// bytes: Uint8Array o array con al menos los primeros 12 bytes.
// 'JPEG' | 'PNG' | 'WEBP' | 'HEIC' (HEIC/HEIF) | 'AVIF' | null
function fotosPozosLogic_detectarFormato(bytes) {
  if (!bytes || bytes.length < 4) {
    return null;
  }
  var b = function (i) { return bytes[i] & 0xff; };
  var txt = function (desde, n) {
    var s = '';
    for (var i = desde; i < desde + n && i < bytes.length; i++) { s += String.fromCharCode(b(i)); }
    return s;
  };
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) {
    return 'JPEG';
  }
  if (b(0) === 0x89 && txt(1, 3) === 'PNG') {
    return 'PNG';
  }
  if (bytes.length >= 12 && txt(0, 4) === 'RIFF' && txt(8, 4) === 'WEBP') {
    return 'WEBP';
  }
  if (bytes.length >= 12 && txt(4, 4) === 'ftyp') {
    var marca = txt(8, 4);
    if (marca === 'avif' || marca === 'avis') {
      return 'AVIF';
    }
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'heif'].indexOf(marca) >= 0) {
      return 'HEIC';
    }
  }
  return null;
}

// {ok:true, formato} | {ok:false, code}. cantidadActual = fotos ya en la lista
// de este lote. HEIC se intenta (el navegador decide si puede decodificarlo).
function fotosPozosLogic_validarArchivo(archivo, formato, cantidadActual) {
  if (cantidadActual >= FOTOS_POZOS_MAX_POR_LOTE) {
    return { ok: false, code: 'LIMITE_LOTE' };
  }
  if (!archivo) {
    return { ok: false, code: 'SIN_ARCHIVO' };
  }
  if (!(archivo.size > 0)) {
    return { ok: false, code: 'ARCHIVO_VACIO' };
  }
  if (archivo.size > REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES) {
    return { ok: false, code: 'ORIGINAL_MUY_GRANDE' };
  }
  if (['JPEG', 'PNG', 'WEBP', 'HEIC'].indexOf(formato) < 0) {
    return { ok: false, code: 'TIPO_NO_SOPORTADO' };
  }
  return { ok: true, formato: formato };
}

// --- Fecha ---

// 'AAAA-MM-DD' en hora LOCAL del dispositivo (la fecha que el usuario ve hoy).
function fotosPozosLogic_fechaHoy(ahora) {
  var d = ahora || new Date();
  var mm = d.getMonth() + 1;
  var dd = d.getDate();
  return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
}

// Fecha valida para una foto: real, >= 2005 y no futura (un dia de margen).
function fotosPozosLogic_fechaDiaValida(valor, ahora) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(valor || ''));
  if (!m) {
    return false;
  }
  var y = parseInt(m[1], 10);
  var mo = parseInt(m[2], 10);
  var d = parseInt(m[3], 10);
  var fecha = new Date(Date.UTC(y, mo - 1, d));
  if (fecha.getUTCFullYear() !== y || fecha.getUTCMonth() !== mo - 1 || fecha.getUTCDate() !== d || y < FOTOS_POZOS_ANIO_MIN) {
    return false;
  }
  return fecha.getTime() <= (ahora || new Date()).getTime() + 24 * 3600 * 1000;
}

// Fecha de captura EXIF (DateTimeOriginal) de un JPEG, 'AAAA-MM-DD', o null si no
// hay una confiable. bytes: los primeros ~128 KB del archivo. Un EXIF con anio
// anterior a 2005 (p. ej. 1980-01-01, reloj sin configurar) o futuro no es confiable.
function fotosPozosLogic_fechaExif(bytes, ahora) {
  if (!bytes || bytes.length < 12) {
    return null;
  }
  var b = function (i) { return bytes[i] & 0xff; };
  if (!(b(0) === 0xff && b(1) === 0xd8)) {
    return null;
  }
  var i = 2;
  while (i + 4 < bytes.length) {
    if (b(i) !== 0xff) {
      return null;
    }
    var marcador = b(i + 1);
    if (marcador === 0xda || marcador === 0xd9) {
      return null;
    }
    var largo = (b(i + 2) << 8) | b(i + 3);
    if (marcador === 0xe1 && b(i + 4) === 0x45 && b(i + 5) === 0x78 && b(i + 6) === 0x69 && b(i + 7) === 0x66) {
      return fotosPozosLogic_fechaDeTiff(bytes, i + 10, Math.min(bytes.length, i + 2 + largo), ahora);
    }
    i += 2 + largo;
  }
  return null;
}

function fotosPozosLogic_fechaDeTiff(bytes, t, fin, ahora) {
  var b = function (i) { return bytes[i] & 0xff; };
  if (t + 8 > fin) {
    return null;
  }
  var little = b(t) === 0x49;
  var u16 = function (o) { return little ? (b(o) | (b(o + 1) << 8)) : ((b(o) << 8) | b(o + 1)); };
  var u32 = function (o) { return little ? ((b(o) | (b(o + 1) << 8) | (b(o + 2) << 16)) + b(o + 3) * 16777216) : (b(o) * 16777216 + ((b(o + 1) << 16) | (b(o + 2) << 8) | b(o + 3))); };
  var buscar = function (ifd, tagBuscado) {
    if (t + ifd + 2 > fin) { return null; }
    var n = u16(t + ifd);
    for (var k = 0; k < n; k++) {
      var e = t + ifd + 2 + k * 12;
      if (e + 12 > fin) { return null; }
      if (u16(e) === tagBuscado) { return { tipo: u16(e + 2), cuenta: u32(e + 4), valor: e + 8 }; }
    }
    return null;
  };
  var ptr = buscar(u32(t + 4), 0x8769);
  if (!ptr) {
    return null;
  }
  var fecha = buscar(u32(ptr.valor), 0x9003);
  if (!fecha || fecha.tipo !== 2 || fecha.cuenta < 19) {
    return null;
  }
  var inicio = fecha.cuenta > 4 ? t + u32(fecha.valor) : fecha.valor;
  if (inicio + 19 > fin) {
    return null;
  }
  var texto = '';
  for (var c = 0; c < 19; c++) { texto += String.fromCharCode(b(inicio + c)); }
  var m = /^(\d{4}):(\d{2}):(\d{2}) \d{2}:\d{2}:\d{2}$/.exec(texto);
  if (!m) {
    return null;
  }
  var valor = m[1] + '-' + m[2] + '-' + m[3];
  return fotosPozosLogic_fechaDiaValida(valor, ahora) ? valor : null;
}

// Fecha de UNA foto del lote a partir del formulario:
//   - "No sé la fecha"            -> desconocida
//   - el usuario edito la fecha    -> esa fecha para todas (origen USUARIO)
//   - la imagen trae fecha EXIF    -> la de la imagen (origen EXIF)
//   - si no                        -> la de hoy (origen USUARIO)
// {valor, precision, fuente}
function fotosPozosLogic_resolverFecha(item, form, ahora) {
  var f = form || {};
  if (f.fechaDesconocida) {
    return { valor: '', precision: 'DESCONOCIDA', fuente: 'DESCONOCIDA' };
  }
  if (f.fechaEditada && fotosPozosLogic_fechaDiaValida(f.fecha, ahora)) {
    return { valor: f.fecha, precision: 'DIA', fuente: 'USUARIO' };
  }
  if (item && item.fechaExif) {
    return { valor: item.fechaExif, precision: 'DIA', fuente: 'EXIF' };
  }
  return { valor: fotosPozosLogic_fechaHoy(ahora), precision: 'DIA', fuente: 'USUARIO' };
}

// Validacion del formulario del lote (antes de subir). {valido, errores:{fecha, observacion}}
function fotosPozosLogic_validarFormulario(form, ahora) {
  var f = form || {};
  var errores = {};
  if (!f.fechaDesconocida && f.fechaEditada && !fotosPozosLogic_fechaDiaValida(f.fecha, ahora)) {
    errores.fecha = 'La fecha no es válida (no puede ser futura ni anterior a 2005).';
  }
  if (typeof f.observacion === 'string' && f.observacion.trim().length > FOTOS_POZOS_OBSERVACION_MAX) {
    errores.observacion = 'La observación admite hasta ' + FOTOS_POZOS_OBSERVACION_MAX + ' caracteres.';
  }
  return { valido: Object.keys(errores).length === 0, errores: errores };
}

// --- Subida ---

// Cuerpo de apiSubirFotoPozo para UNA foto del lote. gps: {lat, lon} o null.
function fotosPozosLogic_armarSubida(item, entidad, form, gps, ahora) {
  var f = form || {};
  var fecha = fotosPozosLogic_resolverFecha(item, f, ahora);
  var fuentes = fotosPozosLogic_fuentesDisponibles(entidad);
  return {
    wellId: entidad.wellId || '',
    monitoringId: entidad.wellId ? '' : (entidad.monitoringId || ''),
    fuente: fuentes.indexOf(f.fuente) >= 0 ? f.fuente : 'CAMPO_APP',
    tipoFoto: FOTOS_POZOS_TIPOS.indexOf(f.tipoFoto) >= 0 ? f.tipoFoto : 'OTRA',
    fechaFotoValor: fecha.valor,
    fechaFotoPrecision: fecha.precision,
    fechaFotoFuente: fecha.fuente,
    observacion: (f.observacion || '').trim(),
    gps: gps ? { lat: gps.lat, lon: gps.lon } : null,
    mimeType: 'image/jpeg',
    imagenBase64: item.base64,
    thumbBase64: item.thumbBase64,
    sha1Original: item.sha1 || '',
    procesamiento: 'NAVEGADOR_' + (item.ladoMayor || 1600) + '_Q' + Math.round((item.calidad || 0.72) * 100),
    tamanoOriginalBytes: item.bytesOriginal
  };
}

var FOTOS_POZOS_MENSAJES = {
  LIMITE_LOTE: 'Podés cargar hasta ' + FOTOS_POZOS_MAX_POR_LOTE + ' fotos por vez.',
  SIN_ARCHIVO: 'No se pudo leer el archivo.',
  ARCHIVO_VACIO: 'El archivo está vacío.',
  TIPO_NO_SOPORTADO: 'Formato no soportado. Usá una foto JPEG, PNG o WebP.',
  HEIC_NO_SOPORTADO: 'Este navegador no puede abrir fotos HEIC. Elegí la foto desde la galería (el iPhone la convierte a JPEG) o configurá la cámara en "Más compatible" (Ajustes > Cámara > Formatos).',
  // codigos del backend
  PERMISSION_DENIED: 'No tenés permiso para cargar fotos.',
  INVALID_ENTIDAD: 'No se pudo identificar el pozo o punto de esta foto.',
  ENTIDAD_INCONSISTENTE: 'No se pudo identificar el pozo o punto de esta foto.',
  ENTIDAD_NOT_FOUND: 'El pozo o punto ya no existe.',
  INVALID_FUENTE: 'El origen de la foto no es válido.',
  INVALID_TIPO: 'El tipo de foto no es válido.',
  INVALID_FECHA: 'La fecha de la foto no es válida.',
  INVALID_OBSERVACION: 'La observación es demasiado larga.',
  INVALID_GPS: 'La ubicación no es válida.',
  INVALID_DIMENSIONES: 'La imagen tiene un tamaño no admitido.'
};

function fotosPozosLogic_mensajeError(code) {
  return FOTOS_POZOS_MENSAJES[code] || reemplazoFotosLogic_mensajeError(code);
}

// Cola SECUENCIAL de subida (una foto por request: Apps Script atiende pocas
// ejecuciones en paralelo y cada subida son 2 viajes). deps:
//   subir(item) -> Promise<{status, data|code}>   (apiSubirFotoPozo ya armado)
//   onCambio()                                     (repintar)
//   onSubida(item, data)                           (una foto quedo guardada)
//   onSesionExpirada()                             (UNAUTHORIZED / USER_DISABLED)
// Estados de item: 'pendiente' | 'subiendo' | 'subida' | 'fallida'. Una foto que
// falla NO frena a las demas ni se reintenta sola; solo con reintentar(item).
function fotosPozosCola_crear(deps) {
  var cola = { items: [], subiendo: false, pausada: false };

  function cambio() {
    if (deps.onCambio) { deps.onCambio(); }
  }

  function procesar() {
    if (cola.subiendo || cola.pausada) {
      return;
    }
    var item = reemplazoFotosLogic_siguienteASubir(cola.items);
    if (!item) {
      cambio();
      return;
    }
    cola.subiendo = true;
    item.estado = 'subiendo';
    cambio();
    var promesa;
    try {
      promesa = Promise.resolve(deps.subir(item));
    } catch (err) {
      promesa = Promise.reject(err);
    }
    promesa.then(function (r) {
      if (r && r.status === 'ok') {
        item.estado = 'subida';
        item.duplicada = !!(r.data && r.data.duplicada);
        item.base64 = null;               // libera memoria
        item.foto = r.data && r.data.foto;
        if (deps.onSubida) { deps.onSubida(item, r.data); }
        return;
      }
      item.estado = 'fallida';
      item.codigo = (r && r.code) || 'SIN_CODIGO';
      item.error = fotosPozosLogic_mensajeError(item.codigo);
      if (item.codigo === 'UNAUTHORIZED' || item.codigo === 'USER_DISABLED') {
        cola.pausada = true;              // sesion vencida: no tiene sentido seguir pegandole al backend
        if (deps.onSesionExpirada) { deps.onSesionExpirada(); }
      }
    }).catch(function () {
      item.estado = 'fallida';
      item.codigo = 'RED';
      item.error = fotosPozosLogic_mensajeError('RED');
    }).then(function () {
      cola.subiendo = false;
      cambio();
      procesar();
    });
  }

  return {
    estado: cola,
    encolar: function (items) {
      items.forEach(function (it) {
        it.estado = 'pendiente';
        it.error = null;
        it.codigo = null;
        cola.items.push(it);
      });
      procesar();
    },
    reintentar: function (item) {
      if (item.estado !== 'fallida') { return; }
      item.estado = 'pendiente';
      item.error = null;
      item.codigo = null;
      cola.pausada = false;
      cambio();
      procesar();
    },
    // descarta lo ya terminado (subido): la cola queda con lo pendiente/fallido
    limpiarSubidas: function () {
      cola.items = cola.items.filter(function (it) { return it.estado !== 'subida'; });
    },
    resumen: function () { return reemplazoFotosLogic_resumenSubida(cola.items); },
    hayEnCurso: function () { return reemplazoFotosLogic_hayEnCurso(cola.items); }
  };
}

// --- GPS opcional de la carga ---

// Posicion del dispositivo -> {lat, lon} redondeado a 6 decimales, o null si no es utilizable.
function fotosPozosLogic_gpsDePosicion(pos) {
  var c = pos && pos.coords;
  if (!c || typeof c.latitude !== 'number' || typeof c.longitude !== 'number' || !isFinite(c.latitude) || !isFinite(c.longitude)) {
    return null;
  }
  if (Math.abs(c.latitude) > 90 || Math.abs(c.longitude) > 180 || (c.latitude === 0 && c.longitude === 0)) {
    return null;
  }
  return { lat: Math.round(c.latitude * 1e6) / 1e6, lon: Math.round(c.longitude * 1e6) / 1e6 };
}

// Pide la ubicacion UNA vez, solo cuando el usuario lo acepta. Nunca rechaza:
// {estado:'ok', lat, lon, precisionM} | 'denegado' | 'no_disponible' | 'error'.
// La carga de la foto NUNCA depende de esto.
function fotosPozosLogic_obtenerGps(geolocation) {
  return new Promise(function (resolve) {
    if (!geolocation || typeof geolocation.getCurrentPosition !== 'function') {
      resolve({ estado: 'no_disponible' });
      return;
    }
    try {
      geolocation.getCurrentPosition(function (pos) {
        var g = fotosPozosLogic_gpsDePosicion(pos);
        if (!g) {
          resolve({ estado: 'error' });
          return;
        }
        resolve({ estado: 'ok', lat: g.lat, lon: g.lon, precisionM: pos.coords.accuracy >= 0 ? Math.round(pos.coords.accuracy) : null });
      }, function (err) {
        resolve({ estado: err && err.code === 1 ? 'denegado' : 'error' });
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    } catch (err) {
      resolve({ estado: 'error' });
    }
  });
}

var FOTOS_POZOS_TEXTO_GPS = {
  ok: 'Ubicación obtenida. Se guarda con las fotos.',
  denegado: 'No diste permiso de ubicación. Las fotos se suben igual, sin ubicación.',
  no_disponible: 'Este dispositivo no permite obtener la ubicación. Las fotos se suben igual.',
  error: 'No se pudo obtener la ubicación. Las fotos se suben igual, sin ella.'
};

function fotosPozosLogic_textoGps(estado, precisionM) {
  if (estado === 'ok' && precisionM > 0) {
    return 'Ubicación obtenida (± ' + precisionM + ' m). Se guarda con las fotos.';
  }
  return FOTOS_POZOS_TEXTO_GPS[estado] || '';
}

var FOTOS_POZOS_AVISO_GPS = 'La ubicación de la foto es solo evidencia de campo: no modifica la coordenada oficial del pozo.';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_POZOS_MAX_POR_LOTE,
    FOTOS_POZOS_OBSERVACION_MAX,
    FOTOS_POZOS_FUENTES_ETIQUETA,
    FOTOS_POZOS_TIPOS_ETIQUETA,
    FOTOS_POZOS_TIPOS,
    FOTOS_POZOS_FUENTES_CARGA,
    FOTOS_POZOS_AVISO_GPS,
    fotosPozosLogic_claveEntidad,
    fotosPozosLogic_entidadDePozo,
    fotosPozosLogic_entidadDePuntoNE,
    fotosPozosLogic_fuentesDisponibles,
    fotosPozosLogic_textoContador,
    fotosPozosLogic_formatearFecha,
    fotosPozosLogic_etiquetaFuente,
    fotosPozosLogic_etiquetaTipo,
    fotosPozosLogic_anioDe,
    fotosPozosLogic_opcionesFiltro,
    fotosPozosLogic_filtrar,
    fotosPozosLogic_hayFiltros,
    fotosPozosLogic_claveFecha,
    fotosPozosLogic_ordenar,
    fotosPozosLogic_agregarFoto,
    fotosPozosLogic_detectarFormato,
    fotosPozosLogic_validarArchivo,
    fotosPozosLogic_fechaHoy,
    fotosPozosLogic_fechaDiaValida,
    fotosPozosLogic_fechaExif,
    fotosPozosLogic_resolverFecha,
    fotosPozosLogic_validarFormulario,
    fotosPozosLogic_armarSubida,
    fotosPozosLogic_mensajeError,
    fotosPozosCola_crear,
    fotosPozosLogic_gpsDePosicion,
    fotosPozosLogic_obtenerGps,
    fotosPozosLogic_textoGps
  };
}
