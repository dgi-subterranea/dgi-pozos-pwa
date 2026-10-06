// FotosPozosService: logica de negocio de la galeria GENERAL de fotos de
// pozos Provincia y puntos NE (FotosPozos v1). No sabe nada de HTTP (Api.js),
// de Sheets (FotosPozosRepository.js) ni de como se habla con el storage
// (FotosStorageClient.js). Es una familia APARTE de FotosReemplazoService
// (fotos de UNA evaluacion): otra hoja, otra raiz en el Drive de storage, otros
// permisos. Solo reutiliza helpers genericos de ese archivo (scope global de
// Apps Script): fotosService_bytesDeBase64, fotosService_esJpeg,
// fotosService_limpiar.
//
// Entidad: wellId (pozo Provincia o punto NE con numero de pozo - una sola
// galeria compartida) o, para un punto NE especial sin wellId, monitoringId.
// El usuario nunca "inventa" una entidad: al SUBIR se valida contra el padron y
// la red NE (union logica).
//
// Privacidad: nunca hay URL publica. El frontend recibe metadata sanitizada
// (sin driveFileId/driveThumbId, sin email, sin sha1, sin coordenadas) y la
// imagen solo por proxy (getFotoPozo). El archivo es SIEMPRE un JPEG que el
// navegador re-codifico con canvas (sin EXIF/GPS); aca se vuelve a validar tipo,
// firma binaria, tamano y dimensiones, sin confiar en el navegador.
var FOTOS_POZOS_FUENTES = ['MONITOREO_NE', 'RELEVAMIENTO_2018', 'CAMPO_APP'];
// Fuentes que un usuario puede elegir al cargar desde la app (las historicas se
// importan por otro camino): su carga de campo, o una foto de una campana de monitoreo NE.
var FOTOS_POZOS_FUENTES_CARGA = ['CAMPO_APP', 'MONITOREO_NE'];
var FOTOS_POZOS_TIPOS = ['CERCA', 'PANORAMICA', 'OTRA'];
var FOTOS_POZOS_PRECISIONES = ['DIA', 'MES', 'ANIO', 'DESCONOCIDA'];
// Origen de la fecha aceptado en una CARGA desde la app (CARPETA / NOMBRE_ANIO /
// ARCHIVO son origenes de la importacion historica)
var FOTOS_POZOS_FUENTES_FECHA_CARGA = ['EXIF', 'USUARIO', 'DESCONOCIDA'];
var FOTOS_POZOS_ANIO_MIN = 2000;
var FOTOS_POZOS_OBSERVACION_MAX = 140;
var FOTOS_POZOS_MAX_BYTES = 2 * 1024 * 1024;     // JPEG ya comprimido (1600 px, q~0.72: 0.2-0.6 MB)
var FOTOS_POZOS_THUMB_MAX_BYTES = 60 * 1024;
var FOTOS_POZOS_DIM_MIN = 16;
var FOTOS_POZOS_DIM_MAX = 2000;                  // la app comprime a 1600; margen por redondeos
var FOTOS_POZOS_THUMB_DIM_MAX = 400;             // la app genera 256
var FOTOS_POZOS_MIME = 'image/jpeg';
var FOTOS_POZOS_UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
var FOTOS_POZOS_BASE64_REGEX = /^[A-Za-z0-9+\/]+={0,2}$/;
var FOTOS_POZOS_WELLID_REGEX = /^\d{2}-\d{4}$/;
var FOTOS_POZOS_MONITORING_REGEX = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
var FOTOS_POZOS_SHA1_REGEX = /^[0-9a-f]{40}$/;
var FOTOS_POZOS_PROCESAMIENTO_REGEX = /^[A-Z0-9_]{1,40}$/;
var FOTOS_POZOS_ORIGINAL_MAX_BYTES = 200 * 1024 * 1024;

// Caches (CacheService, por script)
var FOTOS_POZOS_RESUMEN_CLAVE = 'fotospozos_resumen';
var FOTOS_POZOS_RESUMEN_CACHE_SEG = 300;
var FOTOS_POZOS_CACHE_MAX_CHARS = 95000;         // CacheService: 100 KB por valor
var FOTOS_POZOS_META_CACHE_SEG = 600;            // fotoId -> ids internos (SOLO de fotos visibles): acota cuanto tarda en notarse una foto oculta
var FOTOS_POZOS_THUMB_CACHE_SEG = 21600;

function fotosPozosService_error(code, message) {
  return { ok: false, code: code, message: message };
}

// ------------------------------------------------------------------ entidad

// {ok:true, wellId, monitoringId, clave} | {ok:false, code, message}. SOLO formato:
// la existencia se valida al subir (fotosPozosService_resolverEntidadExistente).
function fotosPozosService_normalizarEntidad(wellId, monitoringId) {
  var w = (wellId === null || wellId === undefined) ? '' : wellId;
  var m = (monitoringId === null || monitoringId === undefined) ? '' : monitoringId;
  if (typeof w !== 'string' || typeof m !== 'string') {
    return fotosPozosService_error('INVALID_ENTIDAD', 'entidad invalida');
  }
  w = w.trim();
  m = m.trim();
  if (w !== '') {
    var depto = parseInt(w.substring(0, 2), 10);
    if (!FOTOS_POZOS_WELLID_REGEX.test(w) || depto < 1 || depto > 19) {
      return fotosPozosService_error('INVALID_ENTIDAD', 'wellId invalido');
    }
    // un punto NE normal usa su wellId: monitoringId vacio o igual
    if (m !== '' && m !== w) {
      return fotosPozosService_error('ENTIDAD_INCONSISTENTE', 'wellId y monitoringId no corresponden a la misma entidad');
    }
    return { ok: true, wellId: w, monitoringId: '', clave: w };
  }
  if (m === '' || !FOTOS_POZOS_MONITORING_REGEX.test(m)) {
    return fotosPozosService_error('INVALID_ENTIDAD', 'falta la entidad (wellId o monitoringId)');
  }
  if (FOTOS_POZOS_WELLID_REGEX.test(m)) {
    // monitoringId con forma de wellId: es el wellId del punto NE
    return fotosPozosService_normalizarEntidad(m, '');
  }
  return { ok: true, wellId: '', monitoringId: m, clave: m };
}

// Para SUBIR: la entidad tiene que existir en el padron o en la red NE. Si el
// monitoringId es de un punto NE que tiene numero de pozo, la entidad pasa a ser
// ese wellId (galeria compartida). esNE: pertenece a la red NE (lo usa la regla de
// la fuente MONITOREO_NE). {ok:true, entidad, esNE} | {ok:false, code, message}
function fotosPozosService_resolverEntidadExistente(entidad) {
  if (entidad.wellId) {
    var punto = nivelesEstaticosRepository_getPunto(entidad.wellId);
    if (punto && punto.found) {
      return { ok: true, entidad: entidad, esNE: true };
    }
    var registro = registryRepository_getWellRecord(entidad.wellId);
    if (registro && registro.found) {
      return { ok: true, entidad: entidad, esNE: false };
    }
    return fotosPozosService_error('ENTIDAD_NOT_FOUND', 'no existe el pozo');
  }
  var ne = nivelesEstaticosRepository_getPunto(entidad.monitoringId);
  if (!ne || !ne.found) {
    return fotosPozosService_error('ENTIDAD_NOT_FOUND', 'no existe el punto NE');
  }
  var conWell = ne.punto && ne.punto.wellId;
  if (typeof conWell === 'string' && FOTOS_POZOS_WELLID_REGEX.test(conWell)) {
    return { ok: true, entidad: { ok: true, wellId: conWell, monitoringId: '', clave: conWell }, esNE: true };
  }
  return { ok: true, entidad: entidad, esNE: true };
}

// -------------------------------------------------------------- validaciones

function fotosPozosService_normalizarObservacion(obs) {
  if (obs === null || obs === undefined || obs === '') {
    return { ok: true, valor: '' };
  }
  if (typeof obs !== 'string') {
    return fotosPozosService_error('INVALID_OBSERVACION', 'observacion invalida');
  }
  // texto corto de una linea: saltos y tabs pasan a espacio, se descartan los demas caracteres de control
  var limpia = obs.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (limpia.length > FOTOS_POZOS_OBSERVACION_MAX) {
    return fotosPozosService_error('INVALID_OBSERVACION', 'la observacion supera ' + FOTOS_POZOS_OBSERVACION_MAX + ' caracteres');
  }
  return { ok: true, valor: limpia };
}

function fotosPozosService_fechaIsoReal(anio, mes, dia) {
  var d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

// Fecha con precision parcial. Nunca completa un dia/mes que no se conoce: ANIO
// se guarda '2025', no '2025-01-01'. ahora (Date) solo para la regla "no futura".
// {ok:true, valor, precision, fuente} | {ok:false, ...}
function fotosPozosService_validarFecha(valor, precision, fuente, ahora) {
  var prec = precision === undefined || precision === null || precision === '' ? 'DESCONOCIDA' : precision;
  if (FOTOS_POZOS_PRECISIONES.indexOf(prec) < 0) {
    return fotosPozosService_error('INVALID_FECHA', 'precision de fecha invalida');
  }
  var origen = fuente === undefined || fuente === null || fuente === '' ? (prec === 'DESCONOCIDA' ? 'DESCONOCIDA' : 'USUARIO') : fuente;
  if (FOTOS_POZOS_FUENTES_FECHA_CARGA.indexOf(origen) < 0) {
    return fotosPozosService_error('INVALID_FECHA', 'origen de fecha invalido');
  }
  if (prec === 'DESCONOCIDA') {
    if (valor !== undefined && valor !== null && valor !== '') {
      return fotosPozosService_error('INVALID_FECHA', 'una fecha desconocida no lleva valor');
    }
    if (origen !== 'DESCONOCIDA') {
      return fotosPozosService_error('INVALID_FECHA', 'origen de fecha incoherente');
    }
    return { ok: true, valor: '', precision: 'DESCONOCIDA', fuente: 'DESCONOCIDA' };
  }
  if (origen === 'DESCONOCIDA' || typeof valor !== 'string') {
    return fotosPozosService_error('INVALID_FECHA', 'fecha invalida');
  }
  var m;
  var anio;
  var mes = 1;
  var dia = 1;
  if (prec === 'DIA') {
    m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    if (m) { anio = parseInt(m[1], 10); mes = parseInt(m[2], 10); dia = parseInt(m[3], 10); }
  } else if (prec === 'MES') {
    m = /^(\d{4})-(\d{2})$/.exec(valor);
    if (m) { anio = parseInt(m[1], 10); mes = parseInt(m[2], 10); }
  } else {
    m = /^(\d{4})$/.exec(valor);
    if (m) { anio = parseInt(m[1], 10); }
  }
  if (!m || anio < FOTOS_POZOS_ANIO_MIN || mes < 1 || mes > 12 || !fotosPozosService_fechaIsoReal(anio, mes, dia)) {
    return fotosPozosService_error('INVALID_FECHA', 'fecha invalida');
  }
  // No futura (un dia de margen por husos horarios)
  var limite = new Date((ahora || new Date()).getTime() + 24 * 3600 * 1000);
  if (Date.UTC(anio, mes - 1, dia) > limite.getTime()) {
    return fotosPozosService_error('INVALID_FECHA', 'la fecha no puede ser futura');
  }
  return { ok: true, valor: valor, precision: prec, fuente: origen };
}

// gps opcional {lat, lon}: ambos o ninguno, dentro de rango. Se redondea a 6
// decimales (~0,1 m). El origen SIEMPRE lo fija el backend (DISPOSITIVO_CARGA).
function fotosPozosService_validarGps(gps) {
  if (gps === null || gps === undefined) {
    return { ok: true, lat: null, lon: null };
  }
  if (typeof gps !== 'object' || typeof gps.lat !== 'number' || typeof gps.lon !== 'number' || !isFinite(gps.lat) || !isFinite(gps.lon)) {
    return fotosPozosService_error('INVALID_GPS', 'ubicacion invalida');
  }
  if (gps.lat < -90 || gps.lat > 90 || gps.lon < -180 || gps.lon > 180) {
    return fotosPozosService_error('INVALID_GPS', 'ubicacion fuera de rango');
  }
  return { ok: true, lat: Math.round(gps.lat * 1e6) / 1e6, lon: Math.round(gps.lon * 1e6) / 1e6 };
}

// {ancho, alto} leyendo el marcador SOF del JPEG (primeros ~6 KB), o null. El
// JPEG de canvas no trae EXIF, asi que el SOF esta casi al principio.
function fotosPozosService_dimensionesJpeg(b64) {
  var n = Math.min(b64.length, 8192);
  n -= n % 4;
  var bytes;
  try {
    bytes = Utilities.base64Decode(b64.substring(0, n));
  } catch (err) {
    return null;
  }
  var i = 2;
  while (i + 9 < bytes.length) {
    if ((bytes[i] & 0xff) !== 0xff) {
      return null;
    }
    var marcador = bytes[i + 1] & 0xff;
    if (marcador === 0xff) {
      i += 1;
      continue;
    }
    if (marcador === 0xd8 || marcador === 0x01 || (marcador >= 0xd0 && marcador <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marcador >= 0xc0 && marcador <= 0xcf && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc) {
      return {
        alto: ((bytes[i + 5] & 0xff) << 8) | (bytes[i + 6] & 0xff),
        ancho: ((bytes[i + 7] & 0xff) << 8) | (bytes[i + 8] & 0xff)
      };
    }
    i += 2 + (((bytes[i + 2] & 0xff) << 8) | (bytes[i + 3] & 0xff));
  }
  return null;
}

// Imagen + miniatura. {ok:true, ancho, alto} | {ok:false, ...}
function fotosPozosService_validarImagenes(mimeType, imagenBase64, thumbBase64) {
  if (mimeType !== FOTOS_POZOS_MIME) {
    return fotosPozosService_error('INVALID_MIME', 'solo se aceptan imagenes ' + FOTOS_POZOS_MIME);
  }
  if (typeof imagenBase64 !== 'string' || imagenBase64.length === 0 || !FOTOS_POZOS_BASE64_REGEX.test(imagenBase64)) {
    return fotosPozosService_error('INVALID_IMAGEN', 'imagen invalida');
  }
  if (fotosService_bytesDeBase64(imagenBase64) > FOTOS_POZOS_MAX_BYTES) {
    return fotosPozosService_error('FILE_TOO_LARGE', 'la foto supera ' + FOTOS_POZOS_MAX_BYTES + ' bytes');
  }
  if (!fotosService_esJpeg(imagenBase64)) {
    return fotosPozosService_error('INVALID_IMAGEN', 'el archivo no es un JPEG');
  }
  if (typeof thumbBase64 !== 'string' || thumbBase64.length === 0 || !FOTOS_POZOS_BASE64_REGEX.test(thumbBase64)) {
    return fotosPozosService_error('INVALID_THUMB', 'miniatura invalida');
  }
  if (fotosService_bytesDeBase64(thumbBase64) > FOTOS_POZOS_THUMB_MAX_BYTES) {
    return fotosPozosService_error('INVALID_THUMB', 'la miniatura supera ' + FOTOS_POZOS_THUMB_MAX_BYTES + ' bytes');
  }
  if (!fotosService_esJpeg(thumbBase64)) {
    return fotosPozosService_error('INVALID_THUMB', 'la miniatura no es un JPEG');
  }
  var dim = fotosPozosService_dimensionesJpeg(imagenBase64);
  if (!dim || dim.ancho < FOTOS_POZOS_DIM_MIN || dim.alto < FOTOS_POZOS_DIM_MIN || dim.ancho > FOTOS_POZOS_DIM_MAX || dim.alto > FOTOS_POZOS_DIM_MAX) {
    return fotosPozosService_error('INVALID_DIMENSIONES', 'dimensiones de la imagen fuera de rango');
  }
  var dimThumb = fotosPozosService_dimensionesJpeg(thumbBase64);
  if (!dimThumb || dimThumb.ancho > FOTOS_POZOS_THUMB_DIM_MAX || dimThumb.alto > FOTOS_POZOS_THUMB_DIM_MAX) {
    return fotosPozosService_error('INVALID_THUMB', 'dimensiones de la miniatura fuera de rango');
  }
  return { ok: true, ancho: dim.ancho, alto: dim.alto };
}

// Valida TODO lo que manda el usuario en una subida (sin tocar hojas ni
// storage). d = {fuente, tipoFoto, fechaFotoValor, fechaFotoPrecision,
// fechaFotoFuente, observacion, gps, mimeType, imagenBase64, thumbBase64,
// sha1Original, procesamiento, tamanoOriginalBytes}. {ok:true, valores} | {ok:false,...}
function fotosPozosService_validarSubida(d, ahora) {
  var datos = d || {};
  var fuente = datos.fuente === undefined || datos.fuente === null || datos.fuente === '' ? 'CAMPO_APP' : datos.fuente;
  if (FOTOS_POZOS_FUENTES_CARGA.indexOf(fuente) < 0) {
    return fotosPozosService_error('INVALID_FUENTE', 'fuente invalida');
  }
  var tipo = datos.tipoFoto === undefined || datos.tipoFoto === null || datos.tipoFoto === '' ? 'OTRA' : datos.tipoFoto;
  if (FOTOS_POZOS_TIPOS.indexOf(tipo) < 0) {
    return fotosPozosService_error('INVALID_TIPO', 'tipoFoto invalido');
  }
  var fecha = fotosPozosService_validarFecha(datos.fechaFotoValor, datos.fechaFotoPrecision, datos.fechaFotoFuente, ahora);
  if (!fecha.ok) {
    return fecha;
  }
  var obs = fotosPozosService_normalizarObservacion(datos.observacion);
  if (!obs.ok) {
    return obs;
  }
  var gps = fotosPozosService_validarGps(datos.gps);
  if (!gps.ok) {
    return gps;
  }
  var sha1 = datos.sha1Original === undefined || datos.sha1Original === null ? '' : datos.sha1Original;
  if (sha1 !== '' && (typeof sha1 !== 'string' || !FOTOS_POZOS_SHA1_REGEX.test(sha1))) {
    return fotosPozosService_error('INVALID_SHA1', 'sha1Original invalido');
  }
  var procesamiento = datos.procesamiento === undefined || datos.procesamiento === null || datos.procesamiento === '' ? 'NAVEGADOR' : datos.procesamiento;
  if (typeof procesamiento !== 'string' || !FOTOS_POZOS_PROCESAMIENTO_REGEX.test(procesamiento)) {
    return fotosPozosService_error('INVALID_PROCESAMIENTO', 'procesamiento invalido');
  }
  var original = '';
  if (datos.tamanoOriginalBytes !== undefined && datos.tamanoOriginalBytes !== null && datos.tamanoOriginalBytes !== '') {
    if (typeof datos.tamanoOriginalBytes !== 'number' || !isFinite(datos.tamanoOriginalBytes) || datos.tamanoOriginalBytes < 0 || datos.tamanoOriginalBytes > FOTOS_POZOS_ORIGINAL_MAX_BYTES) {
      return fotosPozosService_error('INVALID_ORIGINAL', 'tamanoOriginalBytes invalido');
    }
    original = Math.round(datos.tamanoOriginalBytes);
  }
  var imagenes = fotosPozosService_validarImagenes(datos.mimeType, datos.imagenBase64, datos.thumbBase64);
  if (!imagenes.ok) {
    return imagenes;
  }
  return {
    ok: true,
    valores: {
      fuente: fuente, tipoFoto: tipo, fecha: fecha, observacion: obs.valor, gps: gps,
      sha1Original: sha1, procesamiento: procesamiento, tamanoOriginalBytes: original,
      ancho: imagenes.ancho, alto: imagenes.alto
    }
  };
}

// ----------------------------------------------------------------- salida

// Metadata hacia el frontend: SIN driveFileId/driveThumbId, email, sha1,
// coordenadas ni lote. Solo un booleano (tieneGps): las coordenadas de una foto
// no se muestran (ubicar un pozo es del modulo Ubicacion, otro permiso).
function fotosPozosService_sanitizar(f) {
  return {
    fotoId: f.fotoId,
    fuente: f.fuente,
    tipoFoto: f.tipoFoto,
    fechaFotoValor: f.fechaFotoValor,
    fechaFotoPrecision: f.fechaFotoPrecision,
    fechaFotoFuente: f.fechaFotoFuente,
    observacion: f.observacion,
    ancho: f.ancho,
    alto: f.alto,
    tieneGps: f.gpsLat !== null && f.gpsLat !== undefined && f.gpsLon !== null && f.gpsLon !== undefined
  };
}

// Clave de orden por fecha de la foto SOLO para ordenar (no es lo que se muestra):
// un anio ordena como 1 de enero de ese anio, un mes como el dia 1. Sin fecha: ''.
function fotosPozosService_claveFecha(f) {
  if (f.fechaFotoPrecision === 'DESCONOCIDA' || !f.fechaFotoValor) {
    return '';
  }
  var v = f.fechaFotoValor;
  if (f.fechaFotoPrecision === 'ANIO') {
    return v + '-01-01';
  }
  if (f.fechaFotoPrecision === 'MES') {
    return v + '-01';
  }
  return v;
}

// orden: 'recientes' (default: fecha de la foto, mas nueva primero) | 'antiguas'.
// Las de fecha desconocida van siempre al final; desempate por registro.
function fotosPozosService_ordenar(fotos, orden) {
  var ascendente = orden === 'antiguas';
  return fotos
    .map(function (f, i) { return { f: f, i: i }; })
    .sort(function (a, b) {
      var ka = fotosPozosService_claveFecha(a.f);
      var kb = fotosPozosService_claveFecha(b.f);
      if ((ka === '') !== (kb === '')) {
        return ka === '' ? 1 : -1;
      }
      if (ka !== kb) {
        return ascendente ? (ka < kb ? -1 : 1) : (ka < kb ? 1 : -1);
      }
      var ta = a.f.timestampRegistro || '';
      var tb = b.f.timestampRegistro || '';
      if (ta !== tb) {
        return ascendente ? (ta < tb ? -1 : 1) : (ta < tb ? 1 : -1);
      }
      return a.i - b.i;
    })
    .map(function (x) { return x.f; });
}

// ----------------------------------------------------------------- lecturas

// Galeria de una entidad: metadata de sus fotos visibles. Deja en cache los ids
// internos (para que getFotoPozo no relea la hoja por cada miniatura). Si la
// entidad no tiene fotos (o no existe) devuelve lista vacia: leer no sirve de
// oraculo de existencia.
function fotosPozosService_listar(wellId, monitoringId, orden) {
  var entidad = fotosPozosService_normalizarEntidad(wellId, monitoringId);
  if (!entidad.ok) {
    return entidad;
  }
  var fotos = fotosPozosService_ordenar(fotosPozosRepository_listarVisiblesPorEntidad(entidad), orden);
  fotosPozosService_cachearMeta(fotos);
  return { ok: true, entidad: entidad.clave, total: fotos.length, fotos: fotos.map(fotosPozosService_sanitizar) };
}

// Deja en cache los ids internos de las fotos listadas (lotes de 50: putAll tiene
// limite de cantidad por llamada). Solo fotos VISIBLES llegan hasta aca.
function fotosPozosService_cachearMeta(fotos) {
  var cache = CacheService.getScriptCache();
  for (var i = 0; i < fotos.length; i += 50) {
    var lote = {};
    fotos.slice(i, i + 50).forEach(function (f) {
      lote['fotospozos_m_' + f.fotoId] = JSON.stringify({ d: f.driveFileId, t: f.driveThumbId });
    });
    if (typeof cache.putAll === 'function') {
      cache.putAll(lote, FOTOS_POZOS_META_CACHE_SEG);
    } else {
      Object.keys(lote).forEach(function (k) { cache.put(k, lote[k], FOTOS_POZOS_META_CACHE_SEG); });
    }
  }
}

// Contador por entidad {clave: n}. Cache corto; se invalida al subir.
function fotosPozosService_resumen() {
  var cache = CacheService.getScriptCache();
  var cacheado = cache.get(FOTOS_POZOS_RESUMEN_CLAVE);
  if (cacheado) {
    return JSON.parse(cacheado);
  }
  var cuenta = fotosPozosRepository_contarVisiblesPorEntidad();
  var json = JSON.stringify(cuenta);
  if (json.length <= FOTOS_POZOS_CACHE_MAX_CHARS) {
    cache.put(FOTOS_POZOS_RESUMEN_CLAVE, json, FOTOS_POZOS_RESUMEN_CACHE_SEG);
  }
  return cuenta;
}

function fotosPozosService_invalidarResumen() {
  CacheService.getScriptCache().remove(FOTOS_POZOS_RESUMEN_CLAVE);
}

// Ids internos de una foto visible (cache primero; si no, la hoja). null si no existe/oculta.
function fotosPozosService_idsInternos(fotoId, cache) {
  var cacheada = cache.get('fotospozos_m_' + fotoId);
  if (cacheada) {
    try {
      return JSON.parse(cacheada);
    } catch (err) {
      // entrada corrupta: se relee de la hoja
    }
  }
  var foto = fotosPozosRepository_buscarVisiblePorFotoId(fotoId);
  if (!foto) {
    return null;
  }
  var ids = { d: foto.driveFileId, t: foto.driveThumbId };
  cache.put('fotospozos_m_' + fotoId, JSON.stringify(ids), FOTOS_POZOS_META_CACHE_SEG);
  return ids;
}

// Imagen (miniatura o completa) por fotoId. El navegador nunca manda un
// driveFileId: se resuelve aca. El permiso se valida ANTES (Api.js) en cada request.
function fotosPozosService_obtenerImagen(fotoId, variante) {
  if (typeof fotoId !== 'string' || !FOTOS_POZOS_UUID_REGEX.test(fotoId)) {
    return fotosPozosService_error('INVALID_FOTO_ID', 'fotoId invalido');
  }
  if (variante !== 'thumb' && variante !== 'full') {
    return fotosPozosService_error('INVALID_VARIANTE', 'variante invalida');
  }
  var cache = CacheService.getScriptCache();
  var ids = fotosPozosService_idsInternos(fotoId, cache);
  if (!ids) {
    return fotosPozosService_error('FOTO_NOT_FOUND', 'no existe la foto');
  }
  // La miniatura en cache solo se consulta DESPUES de confirmar que la foto sigue visible
  var claveThumb = 'fotospozos_t_' + fotoId;
  if (variante === 'thumb') {
    var cacheada = cache.get(claveThumb);
    if (cacheada) {
      return { ok: true, imagen: { fotoId: fotoId, variante: variante, mimeType: FOTOS_POZOS_MIME, imagenBase64: cacheada } };
    }
  }
  var r;
  try {
    r = fotosStorageClient_obtenerPozo(ids.d, ids.t, variante);
  } catch (err) {
    Logger.log('Storage de fotos no disponible: ' + fotosService_limpiar(err));
    return fotosPozosService_error('STORAGE_UNAVAILABLE', 'no se pudo leer la foto');
  }
  if (variante === 'thumb' && r.imagenBase64.length <= FOTOS_POZOS_CACHE_MAX_CHARS) {
    cache.put(claveThumb, r.imagenBase64, FOTOS_POZOS_THUMB_CACHE_SEG);
  }
  return { ok: true, imagen: { fotoId: fotoId, variante: variante, mimeType: r.mimeType, imagenBase64: r.imagenBase64 } };
}

// ------------------------------------------------------------------- subida

// Compensacion: el archivo quedo en el storage pero no en la hoja. Papelera del
// storage; si tambien falla solo se loguea (huerfano, nunca visible desde la app).
function fotosPozosService_descartarSilencioso(driveFileId) {
  try {
    fotosStorageClient_descartarPozo(driveFileId);
  } catch (err) {
    Logger.log('No se pudo descartar una foto huerfana: ' + fotosService_limpiar(err));
  }
}

// Sube UNA foto a la galeria de una entidad. email viene SIEMPRE de la sesion.
// datos incluye wellId / monitoringId (los que ya determino la ficha abierta) mas
// lo de fotosPozosService_validarSubida. ahora: solo para tests.
// {ok:true, foto, duplicada} | {ok:false, code, message}
function fotosPozosService_subir(email, datos, ahora) {
  var d = datos || {};
  var entidadFormato = fotosPozosService_normalizarEntidad(d.wellId, d.monitoringId);
  if (!entidadFormato.ok) {
    return entidadFormato;
  }
  var validacion = fotosPozosService_validarSubida(d, ahora);
  if (!validacion.ok) {
    return validacion;
  }
  var v = validacion.valores;

  var existente = fotosPozosService_resolverEntidadExistente(entidadFormato);
  if (!existente.ok) {
    return existente;
  }
  var entidad = existente.entidad;
  // MONITOREO_NE solo se puede declarar sobre un punto de la red NE: una carga normal de un
  // pozo que no esta en la red no puede hacerse pasar por una foto de monitoreo.
  if (v.fuente === 'MONITOREO_NE' && !existente.esNE) {
    return fotosPozosService_error('INVALID_FUENTE', 'la fuente MONITOREO_NE requiere un punto de la red NE');
  }

  // Idempotencia: el mismo archivo ya subido a esta entidad no se vuelve a guardar
  var repetida = fotosPozosRepository_buscarDuplicado(entidad, v.sha1Original);
  if (repetida) {
    return { ok: true, foto: fotosPozosService_sanitizar(repetida), duplicada: true };
  }

  var fotoId = Utilities.getUuid();
  var carpetaFecha = v.fecha.precision === 'DESCONOCIDA' ? 'sin_fecha' : v.fecha.valor.substring(0, 4);

  var almacenada;
  try {
    almacenada = fotosStorageClient_subirPozo({
      fotoId: fotoId,
      fuente: v.fuente,
      carpetaFecha: carpetaFecha,
      mimeType: d.mimeType,
      imagenBase64: d.imagenBase64,
      thumbBase64: d.thumbBase64
    });
  } catch (err) {
    Logger.log('Storage de fotos no disponible: ' + fotosService_limpiar(err));
    return fotosPozosService_error('STORAGE_UNAVAILABLE', 'no se pudo guardar la foto');
  }

  var foto = {
    fotoId: fotoId,
    timestampRegistro: new Date(),
    wellId: entidad.wellId,
    monitoringId: entidad.monitoringId,
    fuente: v.fuente,
    tipoFoto: v.tipoFoto,
    fechaFotoValor: v.fecha.valor,
    fechaFotoPrecision: v.fecha.precision,
    fechaFotoFuente: v.fecha.fuente,
    observacion: v.observacion,
    estadoVinculo: 'CONFIRMADO',
    vinculoMetodo: 'CAMPO_APP',
    gpsLat: v.gps.lat,
    gpsLon: v.gps.lon,
    gpsOrigen: v.gps.lat === null ? '' : 'DISPOSITIVO_CARGA',
    emailUsuarioCarga: email,
    loteImportacion: '',
    sha1Original: v.sha1Original,
    procesamiento: v.procesamiento,
    mimeType: FOTOS_POZOS_MIME,
    tamanoBytes: almacenada.tamanoBytes,
    ancho: v.ancho,
    alto: v.alto,
    tamanoOriginalBytes: v.tamanoOriginalBytes,
    driveFileId: almacenada.driveFileId,
    driveThumbId: almacenada.driveThumbId || '',
    estado: 'ACTIVA'
  };

  var resultado;
  try {
    resultado = fotosPozosRepository_agregarSinDuplicar(foto);
  } catch (err) {
    fotosPozosService_descartarSilencioso(almacenada.driveFileId);
    throw err;
  }
  if (!resultado.agregada) {
    // otra subida igual se registro entre el chequeo y el append: este archivo sobra
    fotosPozosService_descartarSilencioso(almacenada.driveFileId);
    return { ok: true, foto: fotosPozosService_sanitizar(resultado.existente), duplicada: true };
  }

  fotosPozosService_invalidarResumen();
  return {
    ok: true,
    foto: fotosPozosService_sanitizar({
      fotoId: fotoId, fuente: v.fuente, tipoFoto: v.tipoFoto, fechaFotoValor: v.fecha.valor,
      fechaFotoPrecision: v.fecha.precision, fechaFotoFuente: v.fecha.fuente, observacion: v.observacion,
      ancho: v.ancho, alto: v.alto, gpsLat: v.gps.lat, gpsLon: v.gps.lon
    }),
    duplicada: false
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_POZOS_FUENTES,
    FOTOS_POZOS_FUENTES_CARGA,
    FOTOS_POZOS_TIPOS,
    FOTOS_POZOS_PRECISIONES,
    FOTOS_POZOS_OBSERVACION_MAX,
    FOTOS_POZOS_MAX_BYTES,
    FOTOS_POZOS_THUMB_MAX_BYTES,
    FOTOS_POZOS_UUID_REGEX,
    fotosPozosService_normalizarEntidad,
    fotosPozosService_resolverEntidadExistente,
    fotosPozosService_normalizarObservacion,
    fotosPozosService_validarFecha,
    fotosPozosService_validarGps,
    fotosPozosService_dimensionesJpeg,
    fotosPozosService_validarImagenes,
    fotosPozosService_validarSubida,
    fotosPozosService_sanitizar,
    fotosPozosService_claveFecha,
    fotosPozosService_ordenar,
    fotosPozosService_listar,
    fotosPozosService_resumen,
    fotosPozosService_invalidarResumen,
    fotosPozosService_obtenerImagen,
    fotosPozosService_subir
  };
}
