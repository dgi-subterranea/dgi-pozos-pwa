// IMPORTACION HISTORICA a la galeria FotosPozos desde una hoja de STAGING. Se ejecuta A MANO desde el editor de Apps
// Script (nunca es un endpoint: Api.js no la enruta; doPost no puede llamarla). Flujo:
//
//   scripts/fotos/importar.py subir          -> sube las fotos normalizadas al storage (cuenta 2)
//   scripts/fotos/importar.py exportar-filas -> CSV con metadata + driveFileId/driveThumbId (solo subidas confirmadas)
//   (se importa ese CSV a la hoja "FotosPozosImport", SIN convertir texto a numeros/fechas)
//   simularImportacionFotosPozosDesdeHoja()  -> valida y cuenta, NO escribe en FotosPozos
//   importarFotosPozosDesdeHoja()            -> agrega a FotosPozos las filas validas que todavia no estan
//
// Garantias:
// - IDEMPOTENTE: una fila cuyo fotoId ya esta en FotosPozos (en cualquier estado, tambien OCULTA: una foto ocultada
//   por moderacion no "revive" al reimportar) no se vuelve a agregar; tampoco el mismo contenido (sha1) de la misma
//   entidad si ya hay una foto visible; ni un driveFileId/driveThumbId ya usado por otra foto.
// - SOLO CONFIRMADO / ACTIVA, entidad existente (padron U red NE), enums y fechas validos (un anio solo nunca es
//   01/01), ids de storage con el formato del storage, sin rutas ni nombres de archivo en ninguna celda, sin
//   observacion y con emailUsuarioCarga = IMPORTACION.
// - NO borra ni modifica la hoja de staging salvo las dos columnas de resultado (estadoImportacion /
//   detalleImportacion); NO toca FotosReemplazo; FotosPozos solo recibe filas NUEVAS (append-only).
// - Una escritura por lote bajo LockService (miles de filas entran en segundos, no de a una).
var FOTOS_POZOS_IMPORT_HOJA = 'FotosPozosImport';
var FOTOS_POZOS_IMPORT_COLUMNAS_RESULTADO = ['estadoImportacion', 'detalleImportacion'];
var FOTOS_POZOS_IMPORT_FUENTES = ['MONITOREO_NE', 'RELEVAMIENTO_2018'];       // las historicas; CAMPO_APP solo entra por la app
var FOTOS_POZOS_IMPORT_FUENTES_FECHA = ['EXIF', 'CARPETA', 'NOMBRE_ANIO', 'ARCHIVO', 'DESCONOCIDA'];
var FOTOS_POZOS_IMPORT_METODOS = ['NOMBRE_ARCHIVO', 'NOMBRE_ARCHIVO_GPS', 'MANUAL'];
var FOTOS_POZOS_IMPORT_EMAIL = 'IMPORTACION';
var FOTOS_POZOS_IMPORT_DRIVE_ID_REGEX = /^[A-Za-z0-9_-]{10,100}$/;
var FOTOS_POZOS_IMPORT_LOTE_REGEX = /^[A-Za-z0-9_-]{1,40}$/;
var FOTOS_POZOS_IMPORT_RASTRO_ARCHIVO_REGEX = /[\\\/]|\.(jpe?g|png|heic|thm|info)\b|^[A-Za-z]:/i;
var FOTOS_POZOS_IMPORT_ANIO_MIN = 2000;
var FOTOS_POZOS_IMPORT_LOTE_FILAS = 500;           // filas por setValues
var FOTOS_POZOS_IMPORT_MAX_DETALLES_LOG = 50;
var FOTOS_POZOS_IMPORT_LOCK_MS = 30000;

// ------------------------------------------------------------------ logica pura

function fotosPozosImport_texto(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function fotosPozosImport_entero(v) {
  if (v === '' || v === null || v === undefined) {
    return null;
  }
  var n = Number(v);
  return (isFinite(n) && Math.floor(n) === n) ? n : null;
}

// Valor de la celda de fecha -> texto segun la precision. Sheets puede haber convertido '2018' en numero y
// '2018-05-03' / '2018-03' en Date: se reconstruye sin inventar dias ni meses.
function fotosPozosImport_textoFecha(v, precision) {
  if (v === null || v === undefined || v === '') {
    return '';
  }
  if (v instanceof Date) {
    var iso = fotosPozosRepository_textoFecha(v);               // yyyy-mm-dd
    return precision === 'ANIO' ? iso.substring(0, 4) : (precision === 'MES' ? iso.substring(0, 7) : iso);
  }
  return String(v).trim();
}

function fotosPozosImport_fechaReal(anio, mes, dia) {
  var d = new Date(Date.UTC(anio, mes - 1, dia));
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function fotosPozosImport_validarFecha(valor, precision, fuente, ahora) {
  if (FOTOS_POZOS_PRECISIONES.indexOf(precision) < 0) {
    return 'fechaFotoPrecision invalida';
  }
  if (FOTOS_POZOS_IMPORT_FUENTES_FECHA.indexOf(fuente) < 0) {
    return 'fechaFotoFuente invalida';
  }
  if (precision === 'DESCONOCIDA') {
    return (valor === '' && fuente === 'DESCONOCIDA') ? null : 'una fecha DESCONOCIDA no lleva valor y su fuente es DESCONOCIDA';
  }
  var m = precision === 'DIA' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor) : (precision === 'MES' ? /^(\d{4})-(\d{2})$/.exec(valor) : /^(\d{4})$/.exec(valor));
  if (!m) {
    return 'fechaFotoValor "' + valor + '" no corresponde a la precision ' + precision;
  }
  var anio = parseInt(m[1], 10);
  var mes = m[2] ? parseInt(m[2], 10) : 1;
  var dia = m[3] ? parseInt(m[3], 10) : 1;
  if (anio < FOTOS_POZOS_IMPORT_ANIO_MIN || anio > ahora.getFullYear() || mes < 1 || mes > 12 || !fotosPozosImport_fechaReal(anio, mes, dia)) {
    return 'fecha fuera de rango o inexistente';
  }
  if (fuente === 'DESCONOCIDA') {
    return 'una fecha conocida no puede tener fuente DESCONOCIDA';
  }
  if (new Date(Date.UTC(anio, mes - 1, dia)).getTime() > ahora.getTime()) {
    return 'fecha futura';
  }
  return null;
}

// Fila CRUDA (valores de las celdas por nombre de columna) -> {ok:true, foto} | {ok:false, motivo}. No consulta nada
// externo: la existencia de la entidad y los duplicados se resuelven aparte (fotosPozosImport_clasificar).
function fotosPozosImport_normalizarFila(cruda, ahora) {
  var t = fotosPozosImport_texto;
  function malo(motivo) { return { ok: false, motivo: motivo }; }

  var fotoId = t(cruda.fotoId).toLowerCase();
  if (!FOTOS_POZOS_UUID_REGEX.test(fotoId)) {
    return malo('fotoId no es un UUID');
  }
  var entidad = fotosPozosService_normalizarEntidad(t(cruda.wellId), t(cruda.monitoringId));
  if (!entidad.ok) {
    return malo('entidad invalida (' + entidad.code + ')');
  }
  if (FOTOS_POZOS_IMPORT_FUENTES.indexOf(t(cruda.fuente)) < 0) {
    return malo('fuente invalida para una importacion historica');
  }
  if (FOTOS_POZOS_TIPOS.indexOf(t(cruda.tipoFoto)) < 0) {
    return malo('tipoFoto invalido');
  }
  var precision = t(cruda.fechaFotoPrecision);
  var valorFecha = fotosPozosImport_textoFecha(cruda.fechaFotoValor, precision);
  var errorFecha = fotosPozosImport_validarFecha(valorFecha, precision, t(cruda.fechaFotoFuente), ahora);
  if (errorFecha) {
    return malo(errorFecha);
  }
  if (t(cruda.estadoVinculo) !== 'CONFIRMADO') {
    return malo('solo se importan filas CONFIRMADO');
  }
  if (t(cruda.estado) !== 'ACTIVA') {
    return malo('solo se importan filas ACTIVA');
  }
  if (FOTOS_POZOS_IMPORT_METODOS.indexOf(t(cruda.vinculoMetodo)) < 0) {
    return malo('vinculoMetodo invalido');
  }
  var lat = cruda.gpsLat === '' || cruda.gpsLat === null || cruda.gpsLat === undefined ? null : Number(cruda.gpsLat);
  var lon = cruda.gpsLon === '' || cruda.gpsLon === null || cruda.gpsLon === undefined ? null : Number(cruda.gpsLon);
  var origen = t(cruda.gpsOrigen);
  if ((lat === null) !== (lon === null)) {
    return malo('gps incompleto');
  }
  if (lat !== null) {
    if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) {
      return malo('gps fuera de rango');
    }
    if (origen !== 'EXIF_ORIGINAL') {
      return malo('gpsOrigen debe ser EXIF_ORIGINAL cuando hay gps');
    }
  } else if (origen !== '') {
    return malo('gpsOrigen sin coordenadas');
  }
  if (t(cruda.emailUsuarioCarga) !== FOTOS_POZOS_IMPORT_EMAIL) {
    return malo('emailUsuarioCarga debe ser ' + FOTOS_POZOS_IMPORT_EMAIL);
  }
  if (t(cruda.observacion) !== '') {
    return malo('las fotos historicas no llevan observacion');
  }
  if (!FOTOS_POZOS_IMPORT_LOTE_REGEX.test(t(cruda.loteImportacion))) {
    return malo('loteImportacion invalido');
  }
  if (!/^[0-9a-f]{40}$/.test(t(cruda.sha1Original))) {
    return malo('sha1Original invalido');
  }
  if (!/^[A-Z0-9_]{1,40}$/.test(t(cruda.procesamiento))) {
    return malo('procesamiento invalido');
  }
  if (t(cruda.mimeType) !== 'image/jpeg') {
    return malo('mimeType debe ser image/jpeg');
  }
  var tamano = fotosPozosImport_entero(cruda.tamanoBytes);
  if (tamano === null || tamano < 1 || tamano > FOTOS_POZOS_MAX_BYTES) {
    return malo('tamanoBytes invalido');
  }
  var ancho = fotosPozosImport_entero(cruda.ancho);
  var alto = fotosPozosImport_entero(cruda.alto);
  if (ancho === null || alto === null || ancho < 16 || alto < 16 || ancho > 2000 || alto > 2000) {
    return malo('ancho/alto invalidos');
  }
  var original = fotosPozosImport_entero(cruda.tamanoOriginalBytes);
  if (t(cruda.tamanoOriginalBytes) !== '' && (original === null || original < 1)) {
    return malo('tamanoOriginalBytes invalido');
  }
  var driveFileId = t(cruda.driveFileId);
  var driveThumbId = t(cruda.driveThumbId);
  if (!FOTOS_POZOS_IMPORT_DRIVE_ID_REGEX.test(driveFileId) || !FOTOS_POZOS_IMPORT_DRIVE_ID_REGEX.test(driveThumbId)) {
    return malo('driveFileId / driveThumbId con formato invalido');
  }
  if (driveFileId === driveThumbId) {
    return malo('driveFileId y driveThumbId no pueden ser el mismo archivo');
  }
  // ninguna celda de texto libre puede traer rutas ni nombres de archivo (los reales traen titulares o lugares)
  var libres = ['procesamiento', 'loteImportacion', 'emailUsuarioCarga', 'fuente', 'tipoFoto', 'fechaFotoFuente', 'vinculoMetodo', 'wellId', 'monitoringId'];
  for (var i = 0; i < libres.length; i++) {
    if (FOTOS_POZOS_IMPORT_RASTRO_ARCHIVO_REGEX.test(t(cruda[libres[i]]))) {
      return malo('la columna ' + libres[i] + ' parece contener una ruta o nombre de archivo');
    }
  }
  return {
    ok: true,
    foto: {
      fotoId: fotoId, timestampRegistro: null, wellId: entidad.wellId, monitoringId: entidad.monitoringId,
      fuente: t(cruda.fuente), tipoFoto: t(cruda.tipoFoto),
      fechaFotoValor: valorFecha, fechaFotoPrecision: precision, fechaFotoFuente: t(cruda.fechaFotoFuente),
      observacion: '', estadoVinculo: 'CONFIRMADO', vinculoMetodo: t(cruda.vinculoMetodo),
      gpsLat: lat, gpsLon: lon, gpsOrigen: origen,
      emailUsuarioCarga: FOTOS_POZOS_IMPORT_EMAIL, loteImportacion: t(cruda.loteImportacion),
      sha1Original: t(cruda.sha1Original), procesamiento: t(cruda.procesamiento), mimeType: 'image/jpeg',
      tamanoBytes: tamano, ancho: ancho, alto: alto, tamanoOriginalBytes: t(cruda.tamanoOriginalBytes) === '' ? null : original,
      driveFileId: driveFileId, driveThumbId: driveThumbId, estado: 'ACTIVA'
    }
  };
}

// items: [{numeroFila, cruda}] -> [{numeroFila, estado: 'INSERTADA'|'YA_EXISTE'|'INVALIDA', detalle, foto?}]
// existentes: TODAS las filas de FotosPozos (fotosPozosRepository_leerTodas). existeEntidad(entidad) -> boolean.
// El orden se respeta: ante dos filas iguales dentro del staging gana la primera.
function fotosPozosImport_clasificar(items, existentes, existeEntidad, ahora) {
  var idsExistentes = {};
  var driveUsados = {};
  var sha1PorEntidad = {};
  (existentes || []).forEach(function (f) {
    idsExistentes[f.fotoId.toLowerCase()] = true;
    if (f.driveFileId) { driveUsados[f.driveFileId] = f.fotoId; }
    if (f.driveThumbId) { driveUsados[f.driveThumbId] = f.fotoId; }
    if (f.sha1Original && fotosPozosRepository_esVisible(f)) {
      sha1PorEntidad[(f.wellId || f.monitoringId) + '|' + f.sha1Original] = true;
    }
  });
  var vistosEnStaging = {};
  return items.map(function (item) {
    var r = fotosPozosImport_normalizarFila(item.cruda, ahora);
    if (!r.ok) {
      return { numeroFila: item.numeroFila, estado: 'INVALIDA', detalle: r.motivo };
    }
    var f = r.foto;
    var clave = f.wellId || f.monitoringId;
    if (vistosEnStaging[f.fotoId]) {
      return { numeroFila: item.numeroFila, estado: 'INVALIDA', detalle: 'fotoId repetido en el staging (fila ' + vistosEnStaging[f.fotoId] + ')' };
    }
    vistosEnStaging[f.fotoId] = item.numeroFila;
    if (!existeEntidad({ wellId: f.wellId, monitoringId: f.monitoringId })) {
      return { numeroFila: item.numeroFila, estado: 'INVALIDA', detalle: 'la entidad ' + clave + ' no existe en el padron ni en la red NE' };
    }
    if (idsExistentes[f.fotoId]) {
      return { numeroFila: item.numeroFila, estado: 'YA_EXISTE', detalle: 'el fotoId ya esta en FotosPozos' };
    }
    if (sha1PorEntidad[clave + '|' + f.sha1Original]) {
      return { numeroFila: item.numeroFila, estado: 'YA_EXISTE', detalle: 'ya hay una foto visible de ' + clave + ' con el mismo contenido' };
    }
    if (driveUsados[f.driveFileId] || driveUsados[f.driveThumbId]) {
      return { numeroFila: item.numeroFila, estado: 'INVALIDA', detalle: 'un id de Drive ya lo usa otra foto' };
    }
    // reservar para que otra fila igual del mismo staging se detecte
    driveUsados[f.driveFileId] = f.fotoId;
    driveUsados[f.driveThumbId] = f.fotoId;
    sha1PorEntidad[clave + '|' + f.sha1Original] = true;
    return { numeroFila: item.numeroFila, estado: 'INSERTADA', detalle: '', foto: f };
  });
}

function fotosPozosImport_resumir(resultados) {
  var r = { leidas: resultados.length, insertadas: 0, yaExistentes: 0, invalidas: 0 };
  resultados.forEach(function (x) {
    if (x.estado === 'INSERTADA') { r.insertadas += 1; }
    else if (x.estado === 'YA_EXISTE') { r.yaExistentes += 1; }
    else { r.invalidas += 1; }
  });
  return r;
}

// ---------------------------------------------------------------- acceso a hojas

function fotosPozosImport_columnasStaging() {
  return FOTOS_POZOS_COLUMNAS.concat(FOTOS_POZOS_IMPORT_COLUMNAS_RESULTADO);
}

function fotosPozosImport_abrirStaging() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(FOTOS_POZOS_IMPORT_HOJA);
  if (!sheet) {
    throw new Error('No existe la hoja "' + FOTOS_POZOS_IMPORT_HOJA + '" (correr setupFotosPozosImportStaging)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + FOTOS_POZOS_IMPORT_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = fotosPozosRepository_indiceColumnas(header, FOTOS_POZOS_COLUMNAS);
  var faltantes = fotosPozosRepository_columnasFaltantes(indices, FOTOS_POZOS_COLUMNAS);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + FOTOS_POZOS_IMPORT_HOJA + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  var res = fotosPozosRepository_indiceColumnas(header, FOTOS_POZOS_IMPORT_COLUMNAS_RESULTADO);
  return { sheet: sheet, indices: indices, resultado: res, ancho: header.length };
}

function fotosPozosImport_leerItems(staging) {
  var datos = staging.sheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var vacia = FOTOS_POZOS_COLUMNAS.every(function (c) { return fotosPozosImport_texto(fila[staging.indices[c]]) === ''; });
    if (vacia) {
      continue;
    }
    var cruda = {};
    FOTOS_POZOS_COLUMNAS.forEach(function (c) { cruda[c] = fila[staging.indices[c]]; });
    items.push({ numeroFila: i + 1, cruda: cruda });
  }
  return items;
}

// Existencia de las entidades en UNA lectura por archivo (no por foto: miles de lecturas de Drive no entran en el
// limite de 6 minutos). Un wellId existe si esta en la red NE o en la ficha del padron; un monitoringId, en la red NE.
function fotosPozosImport_crearVerificadorEntidades(items) {
  var ne = nivelesEstaticosRepository_getTodosLosPuntos();
  var puntos = (ne && ne.found && ne.puntos) ? ne.puntos : {};
  var porArchivo = {};
  items.forEach(function (it) {
    var w = fotosPozosImport_texto(it.cruda.wellId);
    if (/^\d{2}-\d{4}$/.test(w) && !puntos[w]) {
      porArchivo[registryRepository_resolveFileName(w)] = true;
    }
  });
  var padron = {};
  Object.keys(porArchivo).forEach(function (archivo) {
    var ids = registryRepository_getWellIdsDeArchivo(archivo);
    Object.keys(ids).forEach(function (id) { padron[id] = true; });
  });
  return function (entidad) {
    if (entidad.wellId) {
      return !!(puntos[entidad.wellId] || padron[entidad.wellId]);
    }
    return !!puntos[entidad.monitoringId];
  };
}

// opciones: {simular, ahora, existeEntidad (para tests)}. Devuelve {leidas, insertadas, yaExistentes, invalidas, simulada}.
function fotosPozosImport_ejecutar(opciones) {
  var o = opciones || {};
  var ahora = o.ahora || new Date();
  var simular = o.simular === true;
  var staging = fotosPozosImport_abrirStaging();
  var items = fotosPozosImport_leerItems(staging);
  var existeEntidad = o.existeEntidad || fotosPozosImport_crearVerificadorEntidades(items);

  var lock = LockService.getScriptLock();
  lock.waitLock(FOTOS_POZOS_IMPORT_LOCK_MS);
  var resultados;
  try {
    var hoja = fotosPozosRepository_abrirHoja();
    var existentes = fotosPozosRepository_leerTodas(hoja);
    resultados = fotosPozosImport_clasificar(items, existentes, existeEntidad, ahora);
    var nuevas = resultados.filter(function (r) { return r.estado === 'INSERTADA'; });
    if (!simular && nuevas.length > 0) {
      var formatos = fotosPozosRepository_formatosFila(hoja);
      for (var desde = 0; desde < nuevas.length; desde += FOTOS_POZOS_IMPORT_LOTE_FILAS) {
        var tanda = nuevas.slice(desde, desde + FOTOS_POZOS_IMPORT_LOTE_FILAS);
        var filas = tanda.map(function (r) {
          r.foto.timestampRegistro = ahora;
          return fotosPozosRepository_filaDesdeFoto(r.foto, hoja.indices, hoja.ancho);
        });
        var rango = hoja.sheet.getRange(hoja.sheet.getLastRow() + 1, 1, filas.length, hoja.ancho);
        rango.setNumberFormats(filas.map(function () { return formatos; }));
        rango.setValues(filas);
      }
      SpreadsheetApp.flush();
    }
  } finally {
    lock.releaseLock();
  }

  var resumen = fotosPozosImport_resumir(resultados);
  resumen.simulada = simular;
  if (!simular) {
    fotosPozosImport_escribirResultados(staging, resultados);
    if (resumen.insertadas > 0) {
      fotosPozosService_invalidarResumen();            // el contador de la app se entera enseguida
    }
  }
  fotosPozosImport_registrar(resumen, resultados);
  return resumen;
}

// Solo las dos columnas de resultado de CADA fila del staging (nada mas se modifica ni se borra).
function fotosPozosImport_escribirResultados(staging, resultados) {
  if (staging.resultado.estadoImportacion < 0 || staging.resultado.detalleImportacion < 0 || resultados.length === 0) {
    return;
  }
  // dos escrituras en bloque (una por columna), no una por fila
  var ultima = resultados.reduce(function (m, r) { return Math.max(m, r.numeroFila); }, 1);
  var estados = [];
  var detalles = [];
  for (var i = 2; i <= ultima; i++) {
    estados.push(['']);
    detalles.push(['']);
  }
  resultados.forEach(function (r) {
    estados[r.numeroFila - 2][0] = r.estado;
    detalles[r.numeroFila - 2][0] = r.detalle || '';
  });
  staging.sheet.getRange(2, staging.resultado.estadoImportacion + 1, estados.length, 1).setValues(estados);
  staging.sheet.getRange(2, staging.resultado.detalleImportacion + 1, detalles.length, 1).setValues(detalles);
}

function fotosPozosImport_registrar(resumen, resultados) {
  Logger.log((resumen.simulada ? 'SIMULACION (no se escribio nada en FotosPozos): ' : 'IMPORTACION: ') +
    'leidas=' + resumen.leidas + ' insertadas=' + resumen.insertadas + ' yaExistentes=' + resumen.yaExistentes + ' invalidas=' + resumen.invalidas);
  var malas = resultados.filter(function (r) { return r.estado === 'INVALIDA'; });
  malas.slice(0, FOTOS_POZOS_IMPORT_MAX_DETALLES_LOG).forEach(function (r) {
    Logger.log('  fila ' + r.numeroFila + ': ' + r.detalle);
  });
  if (malas.length > FOTOS_POZOS_IMPORT_MAX_DETALLES_LOG) {
    Logger.log('  ... y ' + (malas.length - FOTOS_POZOS_IMPORT_MAX_DETALLES_LOG) + ' filas invalidas mas (ver la columna detalleImportacion)');
  }
}

// --------------------------------------------------- funciones para correr a mano

// Crea la hoja de staging (idempotente: si existe no la toca). Columnas = las de FotosPozos + 2 de resultado, todas
// como texto plano para que Sheets no convierta '2018' en numero ni '2018-05-03' en fecha al importar el CSV.
function setupFotosPozosImportStaging() {
  var columnas = fotosPozosImport_columnasStaging();
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(FOTOS_POZOS_IMPORT_HOJA);
  if (existente) {
    var lastCol = existente.getLastColumn();
    var header = lastCol > 0 ? existente.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var faltantes = fotosPozosRepository_columnasFaltantes(fotosPozosRepository_indiceColumnas(header, columnas), columnas);
    Logger.log(faltantes.length === 0
      ? 'La hoja ' + FOTOS_POZOS_IMPORT_HOJA + ' ya existe con su encabezado, no se modifico.'
      : 'La hoja ' + FOTOS_POZOS_IMPORT_HOJA + ' existe pero le faltan columnas (' + faltantes.join(', ') + '). No se modifico: revisarla a mano.');
    return;
  }
  var sheet = spreadsheet.insertSheet(FOTOS_POZOS_IMPORT_HOJA);
  sheet.getRange(1, 1, 1, columnas.length).setValues([columnas]);
  sheet.getRange(1, 1, sheet.getMaxRows(), columnas.length).setNumberFormat('@');
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + FOTOS_POZOS_IMPORT_HOJA + ' creada.');
}

function simularImportacionFotosPozosDesdeHoja() {
  return fotosPozosImport_ejecutar({ simular: true });
}

function importarFotosPozosDesdeHoja() {
  return fotosPozosImport_ejecutar({ simular: false });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_POZOS_IMPORT_HOJA,
    FOTOS_POZOS_IMPORT_FUENTES,
    fotosPozosImport_textoFecha,
    fotosPozosImport_validarFecha,
    fotosPozosImport_normalizarFila,
    fotosPozosImport_clasificar,
    fotosPozosImport_resumir,
    fotosPozosImport_columnasStaging,
    fotosPozosImport_abrirStaging,
    fotosPozosImport_leerItems,
    fotosPozosImport_crearVerificadorEntidades,
    fotosPozosImport_ejecutar,
    setupFotosPozosImportStaging,
    simularImportacionFotosPozosDesdeHoja,
    importarFotosPozosDesdeHoja
  };
}
