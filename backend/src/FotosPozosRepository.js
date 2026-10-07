// Unica funcion/archivo que sabe que existen las hojas "FotosPozos" y
// "FotosPozosCambios" en Sheets (mismo spreadsheet que Usuarios/Historial/
// EvaluacionesReemplazo/FotosReemplazo). FotosPozos es la galeria GENERAL de
// fotos de pozos Provincia y puntos NE, separada de FotosReemplazo (que son
// fotos de UNA evaluacion): una fila por foto, APPEND-ONLY. Nada se borra ni
// se edita en silencio: una correccion futura deja una fila en
// FotosPozosCambios (quien, cuando, campo, valor anterior y nuevo).
//
// FotosPozos (header exacto, fila 1; las columnas se buscan por TEXTO, no por
// posicion, y falta alguna => error fail-closed):
//   fotoId | timestampRegistro | wellId | monitoringId | fuente | tipoFoto |
//   fechaFotoValor | fechaFotoPrecision | fechaFotoFuente | observacion |
//   estadoVinculo | vinculoMetodo | gpsLat | gpsLon | gpsOrigen |
//   emailUsuarioCarga | loteImportacion | sha1Original | procesamiento |
//   mimeType | tamanoBytes | ancho | alto | tamanoOriginalBytes |
//   driveFileId | driveThumbId | estado
// - la imagen NUNCA se guarda aca (ni base64 ni URL): vive en el Drive de la
//   cuenta de STORAGE; driveFileId/driveThumbId son referencias internas que
//   no salen hacia el frontend (ver FotosPozosService.js);
// - fechaFotoValor se guarda como TEXTO ('2025', '2025-06', '2025-06-14'):
//   Sheets convertiria '2025' en numero y '2025-06-14' en fecha;
// - la entidad es wellId (pozo Provincia o punto NE con numero de pozo) o,
//   para un punto NE especial sin wellId, monitoringId.
var FOTOS_POZOS_HOJA = 'FotosPozos';
var FOTOS_POZOS_COLUMNAS = [
  'fotoId', 'timestampRegistro', 'wellId', 'monitoringId', 'fuente', 'tipoFoto',
  'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente', 'observacion',
  'estadoVinculo', 'vinculoMetodo', 'gpsLat', 'gpsLon', 'gpsOrigen',
  'emailUsuarioCarga', 'loteImportacion', 'sha1Original', 'procesamiento',
  'mimeType', 'tamanoBytes', 'ancho', 'alto', 'tamanoOriginalBytes',
  'driveFileId', 'driveThumbId', 'estado'
];
var FOTOS_POZOS_CAMBIOS_HOJA = 'FotosPozosCambios';
var FOTOS_POZOS_CAMBIOS_COLUMNAS = ['timestamp', 'fotoId', 'campo', 'valorAnterior', 'valorNuevo', 'email'];
var FOTOS_POZOS_LOCK_TIMEOUT_MS = 10000;

// Columnas con formato propio al escribir (el resto va como texto plano '@')
var FOTOS_POZOS_COLUMNAS_NUMERICAS = ['tamanoBytes', 'ancho', 'alto', 'tamanoOriginalBytes'];
var FOTOS_POZOS_COLUMNAS_COORD = ['gpsLat', 'gpsLon'];

// --- Logica pura (testeable sin SpreadsheetApp) ---

function fotosPozosRepository_indiceColumnas(headerRow, columnas) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  (columnas || FOTOS_POZOS_COLUMNAS).forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

function fotosPozosRepository_columnasFaltantes(indices, columnas) {
  return (columnas || FOTOS_POZOS_COLUMNAS).filter(function (nombre) { return indices[nombre] < 0; });
}

function fotosPozosRepository_filaDesdeFoto(foto, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  FOTOS_POZOS_COLUMNAS.forEach(function (nombre) {
    var valor = foto[nombre];
    fila[indices[nombre]] = (valor === null || valor === undefined) ? '' : valor;
  });
  return fila;
}

// Una fecha parcial puede volver de la hoja como numero (2025) o, si alguien
// la reescribio a mano y Sheets la convirtio, como Date: se normaliza a texto.
function fotosPozosRepository_textoFecha(v) {
  if (v === null || v === undefined) {
    return '';
  }
  if (v instanceof Date) {
    var m = v.getMonth() + 1;
    var d = v.getDate();
    return v.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d;
  }
  return String(v).trim();
}

function fotosPozosRepository_fotoDesdeFila(row, indices) {
  function texto(nombre) {
    var v = row[indices[nombre]];
    return (v === null || v === undefined) ? '' : String(v).trim();
  }
  function numero(nombre) {
    var v = row[indices[nombre]];
    if (v === '' || v === null || v === undefined) {
      return null;
    }
    var n = Number(v);
    return isFinite(n) ? n : null;
  }
  var ts = row[indices.timestampRegistro];
  var fecha = ts instanceof Date ? ts : new Date(ts);
  return {
    fotoId: texto('fotoId'),
    timestampRegistro: isNaN(fecha.getTime()) ? null : fecha.toISOString(),
    wellId: texto('wellId'),
    monitoringId: texto('monitoringId'),
    fuente: texto('fuente'),
    tipoFoto: texto('tipoFoto'),
    fechaFotoValor: fotosPozosRepository_textoFecha(row[indices.fechaFotoValor]),
    fechaFotoPrecision: texto('fechaFotoPrecision'),
    fechaFotoFuente: texto('fechaFotoFuente'),
    observacion: texto('observacion'),
    estadoVinculo: texto('estadoVinculo'),
    vinculoMetodo: texto('vinculoMetodo'),
    gpsLat: numero('gpsLat'),
    gpsLon: numero('gpsLon'),
    gpsOrigen: texto('gpsOrigen'),
    emailUsuarioCarga: texto('emailUsuarioCarga'),
    loteImportacion: texto('loteImportacion'),
    sha1Original: texto('sha1Original'),
    procesamiento: texto('procesamiento'),
    mimeType: texto('mimeType'),
    tamanoBytes: numero('tamanoBytes'),
    ancho: numero('ancho'),
    alto: numero('alto'),
    tamanoOriginalBytes: numero('tamanoOriginalBytes'),
    driveFileId: texto('driveFileId'),
    driveThumbId: texto('driveThumbId'),
    estado: texto('estado')
  };
}

// Una foto "pertenece" a una entidad si coincide su wellId o su monitoringId
// (el que venga informado en la entidad).
function fotosPozosRepository_perteneceAEntidad(foto, entidad) {
  if (entidad.wellId && foto.wellId === entidad.wellId) {
    return true;
  }
  return !!(entidad.monitoringId && foto.monitoringId === entidad.monitoringId);
}

// Visibles en la galeria: ACTIVA y vinculo CONFIRMADO. Las POR_REVISAR (asociacion
// todavia no confirmada) y las OCULTA nunca salen.
function fotosPozosRepository_esVisible(foto) {
  return foto.estado === 'ACTIVA' && foto.estadoVinculo === 'CONFIRMADO';
}

// --- Acceso a Sheets ---

function fotosPozosRepository_abrirHoja() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(FOTOS_POZOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + FOTOS_POZOS_HOJA + '" en el spreadsheet configurado (correr setupFotosPozosSheet)');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + FOTOS_POZOS_HOJA + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = fotosPozosRepository_indiceColumnas(header);
  var faltantes = fotosPozosRepository_columnasFaltantes(indices);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + FOTOS_POZOS_HOJA + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  return { sheet: sheet, indices: indices, ancho: header.length };
}

function fotosPozosRepository_leerTodas(hoja) {
  var data = hoja.sheet.getDataRange().getValues();
  var fotos = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][hoja.indices.fotoId]).trim() === '') {
      continue;     // fila vacia a mitad de hoja
    }
    fotos.push(fotosPozosRepository_fotoDesdeFila(data[i], hoja.indices));
  }
  return fotos;
}

// Fotos VISIBLES de una entidad (una lectura de la hoja).
function fotosPozosRepository_listarVisiblesPorEntidad(entidad) {
  return fotosPozosRepository_leerTodas(fotosPozosRepository_abrirHoja()).filter(function (f) {
    return fotosPozosRepository_esVisible(f) && fotosPozosRepository_perteneceAEntidad(f, entidad);
  });
}

// Foto VISIBLE por id (null si no existe, esta oculta o sin confirmar).
function fotosPozosRepository_buscarVisiblePorFotoId(fotoId) {
  var todas = fotosPozosRepository_leerTodas(fotosPozosRepository_abrirHoja());
  for (var i = 0; i < todas.length; i++) {
    if (todas[i].fotoId === fotoId) {
      return fotosPozosRepository_esVisible(todas[i]) ? todas[i] : null;
    }
  }
  return null;
}

// Contador por entidad: {clave: cantidad}, clave = wellId o, si no tiene,
// monitoringId. Solo fotos visibles, solo claves con al menos una.
function fotosPozosRepository_contarVisiblesPorEntidad() {
  var cuenta = {};
  fotosPozosRepository_leerTodas(fotosPozosRepository_abrirHoja()).forEach(function (f) {
    if (!fotosPozosRepository_esVisible(f)) {
      return;
    }
    var clave = f.wellId || f.monitoringId;
    if (clave) {
      cuenta[clave] = (cuenta[clave] || 0) + 1;
    }
  });
  return cuenta;
}

function fotosPozosRepository_formatosFila(hoja) {
  var formatos = [];
  for (var c = 0; c < hoja.ancho; c++) {
    if (c === hoja.indices.timestampRegistro) {
      formatos.push('yyyy-mm-dd hh:mm:ss');
    } else if (FOTOS_POZOS_COLUMNAS_NUMERICAS.some(function (n) { return hoja.indices[n] === c; })) {
      formatos.push('0');
    } else if (FOTOS_POZOS_COLUMNAS_COORD.some(function (n) { return hoja.indices[n] === c; })) {
      formatos.push('0.000000');
    } else {
      formatos.push('@');
    }
  }
  return formatos;
}

// Append de UNA fila bajo LockService. Si se informa sha1Original y ya hay una
// foto visible de la MISMA entidad con ese hash (doble toque, reintento tras una
// respuesta perdida, mismo archivo elegido de nuevo), NO agrega y devuelve la
// existente: la subida es idempotente. {agregada:true} | {agregada:false, existente}.
function fotosPozosRepository_agregarSinDuplicar(foto) {
  var hoja = fotosPozosRepository_abrirHoja();
  var lock = LockService.getScriptLock();
  lock.waitLock(FOTOS_POZOS_LOCK_TIMEOUT_MS);
  try {
    if (foto.sha1Original) {
      var entidad = { wellId: foto.wellId, monitoringId: foto.monitoringId };
      var repetidas = fotosPozosRepository_leerTodas(hoja).filter(function (f) {
        return f.sha1Original === foto.sha1Original && fotosPozosRepository_esVisible(f) && fotosPozosRepository_perteneceAEntidad(f, entidad);
      });
      if (repetidas.length > 0) {
        return { agregada: false, existente: repetidas[0] };
      }
    }
    var fila = fotosPozosRepository_filaDesdeFoto(foto, hoja.indices, hoja.ancho);
    var numeroFila = hoja.sheet.getLastRow() + 1;
    var rango = hoja.sheet.getRange(numeroFila, 1, 1, hoja.ancho);
    rango.setNumberFormats([fotosPozosRepository_formatosFila(hoja)]);
    rango.setValues([fila]);
    SpreadsheetApp.flush();
    return { agregada: true };
  } finally {
    lock.releaseLock();
  }
}

// Duplicado ya registrado (misma entidad + mismo sha1Original), sin escribir.
function fotosPozosRepository_buscarDuplicado(entidad, sha1Original) {
  if (!sha1Original) {
    return null;
  }
  var repetidas = fotosPozosRepository_leerTodas(fotosPozosRepository_abrirHoja()).filter(function (f) {
    return f.sha1Original === sha1Original && fotosPozosRepository_esVisible(f) && fotosPozosRepository_perteneceAEntidad(f, entidad);
  });
  return repetidas.length > 0 ? repetidas[0] : null;
}

// --- FotosPozosCambios: auditoria de correcciones (solo repositorio basico) ---

function fotosPozosCambiosRepository_filaDesdeCambio(cambio, indices, anchoHeader) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  FOTOS_POZOS_CAMBIOS_COLUMNAS.forEach(function (nombre) {
    var valor = cambio[nombre];
    fila[indices[nombre]] = (valor === null || valor === undefined) ? '' : valor;
  });
  return fila;
}

// Registra UN cambio (quien, cuando, campo, anterior, nuevo). Todavia no hay
// endpoint ni UI de correccion: queda listo para cuando se agregue.
function fotosPozosCambiosRepository_registrar(cambio) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(FOTOS_POZOS_CAMBIOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + FOTOS_POZOS_CAMBIOS_HOJA + '" (correr setupFotosPozosCambiosSheet)');
  }
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  var indices = fotosPozosRepository_indiceColumnas(header, FOTOS_POZOS_CAMBIOS_COLUMNAS);
  var faltantes = fotosPozosRepository_columnasFaltantes(indices, FOTOS_POZOS_CAMBIOS_COLUMNAS);
  if (faltantes.length > 0) {
    throw new Error('La hoja "' + FOTOS_POZOS_CAMBIOS_HOJA + '" no tiene las columnas: ' + faltantes.join(', '));
  }
  var fila = fotosPozosCambiosRepository_filaDesdeCambio(
    { timestamp: new Date(), fotoId: cambio.fotoId, campo: cambio.campo, valorAnterior: cambio.valorAnterior, valorNuevo: cambio.valorNuevo, email: cambio.email },
    indices, header.length);
  var numeroFila = sheet.getLastRow() + 1;
  var rango = sheet.getRange(numeroFila, 1, 1, header.length);
  var formatos = [];
  for (var c = 0; c < header.length; c++) {
    formatos.push(c === indices.timestamp ? 'yyyy-mm-dd hh:mm:ss' : '@');
  }
  rango.setNumberFormats([formatos]);
  rango.setValues([fila]);
}

// --- Setup (correr A MANO desde el editor; IDEMPOTENTE) ---

// Si la hoja ya existe con el encabezado completo no hace nada; si existe con
// otro encabezado NO la toca y avisa (nunca pisa datos); si no existe, la crea.
function fotosPozosRepository_setupHoja(nombreHoja, columnas) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var existente = spreadsheet.getSheetByName(nombreHoja);
  if (existente) {
    var lastCol = existente.getLastColumn();
    var header = lastCol > 0 ? existente.getRange(1, 1, 1, lastCol).getValues()[0] : [];
    var faltantes = fotosPozosRepository_columnasFaltantes(fotosPozosRepository_indiceColumnas(header, columnas), columnas);
    if (faltantes.length === 0) {
      Logger.log('La hoja ' + nombreHoja + ' ya existe con su encabezado, no se modifico.');
    } else {
      Logger.log('La hoja ' + nombreHoja + ' existe pero le faltan columnas (' + faltantes.join(', ') + '). No se modifico: revisarla a mano.');
    }
    return;
  }
  var sheet = spreadsheet.insertSheet(nombreHoja);
  sheet.getRange(1, 1, 1, columnas.length).setValues([columnas]);
  sheet.setFrozenRows(1);
  Logger.log('Hoja ' + nombreHoja + ' creada.');
}

function setupFotosPozosSheet() {
  fotosPozosRepository_setupHoja(FOTOS_POZOS_HOJA, FOTOS_POZOS_COLUMNAS);
}

function setupFotosPozosCambiosSheet() {
  fotosPozosRepository_setupHoja(FOTOS_POZOS_CAMBIOS_HOJA, FOTOS_POZOS_CAMBIOS_COLUMNAS);
}

// Atajo: crea las dos hojas de la galeria general (cada una idempotente).
function setupFotosPozos() {
  setupFotosPozosSheet();
  setupFotosPozosCambiosSheet();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_POZOS_COLUMNAS,
    FOTOS_POZOS_CAMBIOS_COLUMNAS,
    fotosPozosRepository_indiceColumnas,
    fotosPozosRepository_columnasFaltantes,
    fotosPozosRepository_filaDesdeFoto,
    fotosPozosRepository_fotoDesdeFila,
    fotosPozosRepository_textoFecha,
    fotosPozosRepository_perteneceAEntidad,
    fotosPozosRepository_esVisible,
    fotosPozosRepository_formatosFila,
    fotosPozosCambiosRepository_filaDesdeCambio,
    fotosPozosRepository_abrirHoja,
    fotosPozosRepository_leerTodas,
    fotosPozosRepository_listarVisiblesPorEntidad,
    fotosPozosRepository_buscarVisiblePorFotoId,
    fotosPozosRepository_contarVisiblesPorEntidad,
    fotosPozosRepository_agregarSinDuplicar,
    fotosPozosRepository_buscarDuplicado,
    fotosPozosCambiosRepository_registrar,
    fotosPozosRepository_setupHoja,
    setupFotosPozosSheet,
    setupFotosPozosCambiosSheet,
    setupFotosPozos
  };
}
