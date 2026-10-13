// Unica funcion/archivo que sabe que existen las hojas "UbicacionCorrecciones" y
// "UbicacionCorreccionesLog" en Sheets (mismo spreadsheet que Usuarios/Historial).
//
// Correcciones de ubicacion de pozos, APPEND-ONLY. Nunca se edita ni se borra una fila desde la app y el padron
// original (Drive) jamas se escribe: una correccion es solo una fila aqui, y su estado es DERIVADO del log.
//
// UbicacionCorrecciones (una fila por propuesta, inmutable):
//   correccionId | wellId | lat | lon | metodo | precisionGpsM | observacion | emailPropone | nombrePropone | timestamp |
//   irrLat | irrLon | irrEstado | irrFuente | padronPeriodo | distanciaM | advertenciaDistancia | clientRequestId |
//   coordenadaOriginalTexto | crsOriginal
//   (las dos ULTIMAS - esquema V2, 20 columnas - guardan el valor ingresado a mano en los metodos COORDENADAS_*; van vacias en GPS_ACTUAL y PUNTO_EN_MAPA)
// UbicacionCorreccionesLog (una fila por evento, inmutable):
//   correccionId | timestamp | evento | email | nombre | motivo
//
// Las columnas se buscan por el TEXTO del encabezado (trim/lowercase insensible): reordenarlas a mano no rompe nada. Si falta
// alguna de las 18 columnas BASE se lanza error (fail-closed: nunca se escribe en una hoja con un esquema que no se reconoce).
//
// ESQUEMA V1 (18 columnas) vs V2 (20): las dos columnas nuevas son OPCIONALES para trabajar (compatibilidad con la hoja de produccion hasta que se corra
// migrarUbicacionCorreccionesV2, que solo AGREGA esos dos encabezados al final):
//   - LECTURA: una hoja V1 se lee igual; coordenadaOriginalTexto y crsOriginal salen vacios (como las filas historicas de una hoja ya migrada).
//   - ESCRITURA de GPS_ACTUAL / PUNTO_EN_MAPA: sigue funcionando en una hoja V1 (esos dos campos van vacios, asi que no se pierde nada). Se eligio asi
//     para que desplegar el codigo ANTES de migrar la hoja no rompa las correcciones que hoy funcionan.
//   - ESCRITURA de un metodo COORDENADAS_*: exige V2. El Service lo comprueba antes de escribir (ESQUEMA_DESACTUALIZADO) y este repositorio lo
//     vuelve a verificar: NUNCA descarta en silencio un valor de auditoria no vacio por falta de columna.
// Las columnas de texto se
// escriben como TEXTO PLANO ('@'): una observacion que empiece con "=" o "+" nunca se evalua como formula. Las numericas
// (coordenadas, precision, distancia) se escriben como numeros con formato fijo, sin depender de la configuracion regional.
//
// Concurrencia: las funciones de escritura de este archivo NO toman el lock; el Service las llama dentro de
// ubicacionCorreccionRepository_conLock (que serializa leer -> decidir -> escribir). LockService no es reentrante de forma
// confiable, por eso el lock vive en un solo lugar.
var UBICACION_CORRECCIONES_HOJA = 'UbicacionCorrecciones';
var UBICACION_CORRECCIONES_LOG_HOJA = 'UbicacionCorreccionesLog';
// Las 18 columnas del esquema original (V1): imprescindibles para leer y escribir.
var UBICACION_CORRECCIONES_COLUMNAS_V1 = [
  'correccionId', 'wellId', 'lat', 'lon', 'metodo', 'precisionGpsM', 'observacion', 'emailPropone', 'nombrePropone', 'timestamp',
  'irrLat', 'irrLon', 'irrEstado', 'irrFuente', 'padronPeriodo', 'distanciaM', 'advertenciaDistancia', 'clientRequestId'
];
// Las que agrega el esquema V2, SIEMPRE al final y en este orden (la migracion no reordena nada).
var UBICACION_CORRECCIONES_COLUMNAS_V2_NUEVAS = ['coordenadaOriginalTexto', 'crsOriginal'];
var UBICACION_CORRECCIONES_COLUMNAS = UBICACION_CORRECCIONES_COLUMNAS_V1.concat(UBICACION_CORRECCIONES_COLUMNAS_V2_NUEVAS);
var UBICACION_CORRECCIONES_LOG_COLUMNAS = ['correccionId', 'timestamp', 'evento', 'email', 'nombre', 'motivo'];
// columna -> formato de numero con que se escribe (el resto va como texto, salvo timestamp)
var UBICACION_CORRECCIONES_FORMATOS_NUMERICOS = {
  lat: '0.000000', lon: '0.000000', irrLat: '0.000000', irrLon: '0.000000', precisionGpsM: '0.0', distanciaM: '0.0'
};
var UBICACION_CORRECCIONES_FORMATO_FECHA = 'yyyy-mm-dd hh:mm:ss';
var UBICACION_CORRECCIONES_LOCK_TIMEOUT_MS = 10000;

// --- Logica pura (testeable sin SpreadsheetApp) ---

function ubicacionCorreccionRepository_indiceColumnas(headerRow, columnas) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  columnas.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre.toLowerCase());
  });
  return indices;
}

function ubicacionCorreccionRepository_columnasFaltantes(indices, columnas) {
  return columnas.filter(function (nombre) { return indices[nombre] < 0; });
}

function ubicacionCorreccionRepository_esVacio(valor) {
  return valor === null || valor === undefined || valor === '';
}

// Objeto -> fila respetando el orden REAL de las columnas de la hoja (las desconocidas quedan vacias).
function ubicacionCorreccionRepository_filaDesdeObjeto(objeto, indices, anchoHeader, columnas) {
  var fila = [];
  for (var i = 0; i < anchoHeader; i++) {
    fila.push('');
  }
  columnas.forEach(function (nombre) {
    var valor = objeto[nombre];
    if (nombre === 'advertenciaDistancia') {
      valor = valor === true || valor === 'SI' ? 'SI' : '';
    }
    fila[indices[nombre]] = ubicacionCorreccionRepository_esVacio(valor) ? '' : valor;
  });
  return fila;
}

function ubicacionCorreccionRepository_texto(row, indices, nombre) {
  if (indices[nombre] === undefined || indices[nombre] < 0) {
    return '';        // columna que la hoja todavia no tiene (esquema V1): igual que una fila historica vacia
  }
  var v = row[indices[nombre]];
  return (v === null || v === undefined) ? '' : String(v).trim();
}

function ubicacionCorreccionRepository_numero(row, indices, nombre) {
  if (indices[nombre] === undefined || indices[nombre] < 0) {
    return null;
  }
  var v = row[indices[nombre]];
  if (ubicacionCorreccionRepository_esVacio(v)) {
    return null;
  }
  var n = typeof v === 'number' ? v : Number(String(v).trim().replace(',', '.'));
  return isFinite(n) ? n : null;
}

function ubicacionCorreccionRepository_fechaIso(row, indices) {
  var ts = row[indices.timestamp];
  var fecha = ts instanceof Date ? ts : new Date(ts);
  return isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

// Fila -> correccion "cruda" (timestamp ISO o null; numeros o null; advertenciaDistancia boolean). La validez de contenido
// es del Service, no de aca.
function ubicacionCorreccionRepository_correccionDesdeFila(row, indices) {
  function t(n) { return ubicacionCorreccionRepository_texto(row, indices, n); }
  function num(n) { return ubicacionCorreccionRepository_numero(row, indices, n); }
  return {
    correccionId: t('correccionId'),
    wellId: t('wellId'),
    lat: num('lat'),
    lon: num('lon'),
    metodo: t('metodo'),
    precisionGpsM: num('precisionGpsM'),
    observacion: t('observacion'),
    emailPropone: t('emailPropone'),
    nombrePropone: t('nombrePropone'),
    timestamp: ubicacionCorreccionRepository_fechaIso(row, indices),
    irrLat: num('irrLat'),
    irrLon: num('irrLon'),
    irrEstado: t('irrEstado'),
    irrFuente: t('irrFuente'),
    padronPeriodo: t('padronPeriodo'),
    distanciaM: num('distanciaM'),
    advertenciaDistancia: t('advertenciaDistancia').toUpperCase() === 'SI',
    clientRequestId: t('clientRequestId'),
    coordenadaOriginalTexto: t('coordenadaOriginalTexto'),
    crsOriginal: t('crsOriginal')
  };
}

function ubicacionCorreccionRepository_eventoDesdeFila(row, indices) {
  function t(n) { return ubicacionCorreccionRepository_texto(row, indices, n); }
  return {
    correccionId: t('correccionId'),
    timestamp: ubicacionCorreccionRepository_fechaIso(row, indices),
    evento: t('evento'),
    email: t('email'),
    nombre: t('nombre'),
    motivo: t('motivo')
  };
}

function ubicacionCorreccionRepository_formatosDeFila(indices, ancho, columnas) {
  var formatos = [];
  for (var c = 0; c < ancho; c++) {
    formatos.push('@');
  }
  columnas.forEach(function (nombre) {
    if (nombre === 'timestamp') {
      formatos[indices[nombre]] = UBICACION_CORRECCIONES_FORMATO_FECHA;
    } else if (UBICACION_CORRECCIONES_FORMATOS_NUMERICOS[nombre]) {
      formatos[indices[nombre]] = UBICACION_CORRECCIONES_FORMATOS_NUMERICOS[nombre];
    }
  });
  return formatos;
}

// --- Acceso a Sheets ---

// columnas = esquema COMPLETO de la hoja; opcionales = las que pueden faltar (hoja anterior a una migracion). Devuelve en "columnas" solo las que la hoja
// tiene (con ellas se arman las filas a escribir), en "todas" el esquema completo (para detectar un valor que se perderia por falta de columna) y en
// "completa" si no falta ninguna.
function ubicacionCorreccionRepository_abrirHoja(nombreHoja, columnas, nombreSetup, opcionales) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(nombreHoja);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "' + nombreHoja + '" en el spreadsheet configurado (correr ' + nombreSetup + ')');
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    throw new Error('La hoja "' + nombreHoja + '" no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var indices = ubicacionCorreccionRepository_indiceColumnas(header, columnas);
  var faltantes = ubicacionCorreccionRepository_columnasFaltantes(indices, columnas);
  var obligatorias = faltantes.filter(function (nombre) { return (opcionales || []).indexOf(nombre) === -1; });
  if (obligatorias.length > 0) {
    throw new Error('La hoja "' + nombreHoja + '" no tiene las columnas: ' + obligatorias.join(', '));
  }
  var presentes = columnas.filter(function (nombre) { return indices[nombre] >= 0; });
  return { sheet: sheet, indices: indices, ancho: header.length, columnas: presentes, todas: columnas, completa: faltantes.length === 0 };
}

function ubicacionCorreccionRepository_hojaCorrecciones() {
  return ubicacionCorreccionRepository_abrirHoja(UBICACION_CORRECCIONES_HOJA, UBICACION_CORRECCIONES_COLUMNAS, 'setupUbicacionCorreccionesSheets', UBICACION_CORRECCIONES_COLUMNAS_V2_NUEVAS);
}

// true si la hoja de correcciones ya tiene las dos columnas del esquema V2 (se puede escribir un metodo COORDENADAS_*). Lanza si la hoja no existe o si
// su esquema BASE no se reconoce.
function ubicacionCorreccionRepository_esquemaCorreccionesV2() {
  return ubicacionCorreccionRepository_hojaCorrecciones().completa === true;
}

function ubicacionCorreccionRepository_hojaLog() {
  return ubicacionCorreccionRepository_abrirHoja(UBICACION_CORRECCIONES_LOG_HOJA, UBICACION_CORRECCIONES_LOG_COLUMNAS, 'setupUbicacionCorreccionesSheets', []);
}

// Todas las correcciones, en el orden de la hoja. Lee la hoja completa: a la escala esperada (cientos o miles de filas)
// es una lectura barata, y evita un indice/cache que podria quedar desfasado respecto de una escritura reciente.
function ubicacionCorreccionRepository_listarCorrecciones() {
  var hoja = ubicacionCorreccionRepository_hojaCorrecciones();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var c = ubicacionCorreccionRepository_correccionDesdeFila(data[i], hoja.indices);
    if (c.correccionId) {
      resultado.push(c);
    }
  }
  return resultado;
}

// Todos los eventos, en el orden de la hoja (que es el orden en que ocurrieron: el estado vigente es el ULTIMO).
function ubicacionCorreccionRepository_listarEventos() {
  var hoja = ubicacionCorreccionRepository_hojaLog();
  var data = hoja.sheet.getDataRange().getValues();
  var resultado = [];
  for (var i = 1; i < data.length; i++) {
    var e = ubicacionCorreccionRepository_eventoDesdeFila(data[i], hoja.indices);
    if (e.correccionId) {
      resultado.push(e);
    }
  }
  return resultado;
}

// Escribe 1..n filas CONTIGUAS con un solo setValues (si algo falla a mitad, no queda la mitad de un grupo de eventos).
function ubicacionCorreccionRepository_agregarFilas(hoja, objetos) {
  if (!objetos.length) {
    return;
  }
  // Fail-closed: si un objeto trae un valor NO vacio para una columna que la hoja no tiene (esquema V1 sin migrar), no se escribe nada.
  var ausentes = (hoja.todas || []).filter(function (nombre) { return hoja.columnas.indexOf(nombre) === -1; });
  objetos.forEach(function (o) {
    ausentes.forEach(function (nombre) {
      if (!ubicacionCorreccionRepository_esVacio(o[nombre])) {
        throw new Error('La hoja no tiene la columna "' + nombre + '" y el valor no se puede guardar (correr migrarUbicacionCorreccionesV2)');
      }
    });
  });
  var filas = objetos.map(function (o) {
    return ubicacionCorreccionRepository_filaDesdeObjeto(o, hoja.indices, hoja.ancho, hoja.columnas);
  });
  var primera = hoja.sheet.getLastRow() + 1;
  var rango = hoja.sheet.getRange(primera, 1, filas.length, hoja.ancho);
  var formato = ubicacionCorreccionRepository_formatosDeFila(hoja.indices, hoja.ancho, hoja.columnas);
  rango.setNumberFormats(filas.map(function () { return formato; }));
  rango.setValues(filas);
  SpreadsheetApp.flush();
}

// Llamar SOLO dentro de ubicacionCorreccionRepository_conLock.
function ubicacionCorreccionRepository_agregarCorreccion(correccion) {
  ubicacionCorreccionRepository_agregarFilas(ubicacionCorreccionRepository_hojaCorrecciones(), [correccion]);
}

// Llamar SOLO dentro de ubicacionCorreccionRepository_conLock.
function ubicacionCorreccionRepository_agregarEventos(eventos) {
  ubicacionCorreccionRepository_agregarFilas(ubicacionCorreccionRepository_hojaLog(), eventos);
}

// Creacion de una correccion: la fila y su evento inicial PROPUESTA, en DOS hojas. NO es atomico (Sheets no tiene transacciones entre
// hojas) y no finge serlo. Lo que si hace para achicar la ventana: abre y verifica AMBAS hojas (existencia, encabezado, columnas) antes
// de escribir la primera, de modo que el motivo mas probable de un corte (una hoja inexistente o con el esquema roto) falla sin
// haber escrito nada. Si igual se corta entre las dos escrituras, la correccion queda sin eventos y el reintento con el mismo
// clientRequestId agrega el PROPUESTA faltante (ver UbicacionCorreccionService.js). Llamar SOLO dentro de conLock.
function ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion, evento) {
  ubicacionCorreccionRepository_agregarCorreccionConEventos(correccion, [evento]);
}

// Igual, con VARIOS eventos del log (p. ej. PROPUESTA + SUPERADA de la anterior + VALIDADA cuando quien crea ya tiene ubicacion_validar):
// todos van en UNA sola escritura contigua del log, asi que el log queda con el grupo completo o sin ninguno. Llamar SOLO dentro de conLock.
function ubicacionCorreccionRepository_agregarCorreccionConEventos(correccion, eventos) {
  var hojaCorrecciones = ubicacionCorreccionRepository_hojaCorrecciones();
  var hojaLog = ubicacionCorreccionRepository_hojaLog();
  ubicacionCorreccionRepository_agregarFilas(hojaCorrecciones, [correccion]);
  ubicacionCorreccionRepository_agregarFilas(hojaLog, eventos);
}

// Serializa leer -> decidir -> escribir entre ejecuciones simultaneas (lock de script). Siempre se libera.
function ubicacionCorreccionRepository_conLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(UBICACION_CORRECCIONES_LOCK_TIMEOUT_MS);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// --- Migracion V1 (18 columnas) -> V2 (20 columnas) ---

// Logica PURA de la migracion a partir del encabezado actual de la hoja. Devuelve
//   {ok:false, motivo}                                   la hoja no se puede migrar con seguridad (no se toca nada), o
//   {ok:true, faltantes:[...], columnaInicial:N}         encabezados a AGREGAR y la columna (1-based) donde empiezan; faltantes vacio = ya esta en V2.
// Reglas: las 18 columnas base tienen que estar (si no, el esquema no se reconoce: fail-closed); los encabezados nuevos se agregan DESPUES del ultimo
// encabezado no vacio; si la hoja tiene contenido mas a la derecha que ese encabezado (lastCol > ultimo), se rechaza: se escribiria sobre datos ajenos.
function ubicacionCorreccionRepository_planMigracionV2(headerRow, ultimaColumnaConContenido) {
  var header = headerRow || [];
  var indices = ubicacionCorreccionRepository_indiceColumnas(header, UBICACION_CORRECCIONES_COLUMNAS);
  var baseFaltante = ubicacionCorreccionRepository_columnasFaltantes(indices, UBICACION_CORRECCIONES_COLUMNAS_V1);
  if (baseFaltante.length > 0) {
    return { ok: false, motivo: 'La hoja "' + UBICACION_CORRECCIONES_HOJA + '" no tiene las columnas base: ' + baseFaltante.join(', ') + '. No se migra.' };
  }
  var faltantes = ubicacionCorreccionRepository_columnasFaltantes(indices, UBICACION_CORRECCIONES_COLUMNAS_V2_NUEVAS);
  var ultimo = 0;
  header.forEach(function (h, i) {
    if (String(h === null || h === undefined ? '' : h).trim() !== '') {
      ultimo = i + 1;
    }
  });
  if (faltantes.length > 0 && ultimaColumnaConContenido > ultimo) {
    return { ok: false, motivo: 'La hoja "' + UBICACION_CORRECCIONES_HOJA + '" tiene contenido a la derecha del ultimo encabezado (columna ' + ultimaColumnaConContenido + '). No se migra para no escribir sobre datos ajenos.' };
  }
  return { ok: true, faltantes: faltantes, columnaInicial: ultimo + 1 };
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > migrarUbicacionCorreccionesV2) en la hoja de PRODUCCION (que tiene 18 columnas) ANTES
// de que alguien proponga una correccion por coordenadas. Tambien es seguro correrla de nuevo.
//  - IDEMPOTENTE: solo agrega los encabezados que FALTAN ("coordenadaOriginalTexto", "crsOriginal"), al final de la fila 1. Si ya estan, no escribe nada.
//  - Distingue tres cosas: la GRILLA FISICA (getMaxColumns: cuantas columnas tiene la hoja), los ENCABEZADOS existentes y el CONTENIDO inesperado. Si la grilla
//    es mas chica que lo que hace falta (p. ej. una hoja con exactamente 18 columnas fisicas), agrega SOLO las columnas necesarias al final (insertColumnsAfter)
//    ANTES de escribir los encabezados; si ya hay lugar (p. ej. 26 columnas fisicas y 18 encabezados), no toca la grilla.
//  - NO modifica ningun dato existente, NO reordena columnas, NO borra nada, NO toca el Log ni la hoja Usuarios. Las filas viejas quedan con esas dos celdas vacias.
//  - fail-closed: si la hoja no existe, no tiene las 18 columnas base o tiene contenido a la derecha del encabezado, lanza error y no escribe.
//  - corre bajo el MISMO lock que las escrituras de correcciones (una propuesta concurrente no ve la hoja a medio migrar).
// Devuelve {migrada, agregadas, columnaInicial, columnasInsertadas} y deja el detalle en el log.
function migrarUbicacionCorreccionesV2() {
  return ubicacionCorreccionRepository_conLock(function () {
    var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
    var sheet = spreadsheet.getSheetByName(UBICACION_CORRECCIONES_HOJA);
    if (!sheet) {
      throw new Error('No existe la hoja "' + UBICACION_CORRECCIONES_HOJA + '" (correr setupUbicacionCorreccionesSheets, que ya la crea con el esquema nuevo)');
    }
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      throw new Error('La hoja "' + UBICACION_CORRECCIONES_HOJA + '" no tiene encabezado');
    }
    var header = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var plan = ubicacionCorreccionRepository_planMigracionV2(header, lastCol);
    if (!plan.ok) {
      throw new Error(plan.motivo);
    }
    if (plan.faltantes.length === 0) {
      Logger.log('La hoja ' + UBICACION_CORRECCIONES_HOJA + ' ya tiene el esquema V2 (20 columnas). No se modifico nada.');
      return { migrada: false, agregadas: [], columnaInicial: null, columnasInsertadas: 0 };
    }
    // Capacidad fisica de la grilla: solo se agregan las columnas que faltan para que entren los encabezados (siempre al final, sin tocar las existentes).
    var ultimaNecesaria = plan.columnaInicial + plan.faltantes.length - 1;
    var fisicas = sheet.getMaxColumns();
    var columnasInsertadas = Math.max(0, ultimaNecesaria - fisicas);
    if (columnasInsertadas > 0) {
      sheet.insertColumnsAfter(fisicas, columnasInsertadas);
    }
    sheet.getRange(1, plan.columnaInicial, 1, plan.faltantes.length).setValues([plan.faltantes]);
    SpreadsheetApp.flush();
    Logger.log('Hoja ' + UBICACION_CORRECCIONES_HOJA + ' migrada a V2: se agregaron los encabezados ' + plan.faltantes.join(', ') + ' desde la columna ' + plan.columnaInicial +
      (columnasInsertadas > 0 ? ' (la hoja tenia ' + fisicas + ' columnas fisicas: se agregaron ' + columnasInsertadas + ' al final)' : '') + '. Ningun dato existente fue modificado.');
    return { migrada: true, agregadas: plan.faltantes, columnaInicial: plan.columnaInicial, columnasInsertadas: columnasInsertadas };
  });
}

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > setupUbicacionCorreccionesSheets) para crear las dos
// hojas con su encabezado exacto (la de correcciones ya con el esquema V2, 20 columnas). No toca una hoja que ya existe (si la de correcciones
// existente es V1, avisa en el log que falta correr migrarUbicacionCorreccionesV2) y NO modifica la hoja Usuarios (las columnas de permisos
// ubicacion_corregir y ubicacion_validar se agregan a mano ahi).
function setupUbicacionCorreccionesSheets() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  [[UBICACION_CORRECCIONES_HOJA, UBICACION_CORRECCIONES_COLUMNAS], [UBICACION_CORRECCIONES_LOG_HOJA, UBICACION_CORRECCIONES_LOG_COLUMNAS]].forEach(function (par) {
    var existente = spreadsheet.getSheetByName(par[0]);
    if (existente) {
      Logger.log('La hoja ' + par[0] + ' ya existe, no se modifico.');
      if (par[0] === UBICACION_CORRECCIONES_HOJA && existente.getLastColumn() > 0) {
        var plan = ubicacionCorreccionRepository_planMigracionV2(existente.getRange(1, 1, 1, existente.getLastColumn()).getValues()[0], existente.getLastColumn());
        if (plan.ok && plan.faltantes.length > 0) {
          Logger.log('AVISO: ' + par[0] + ' tiene el esquema anterior (18 columnas). Correr migrarUbicacionCorreccionesV2 para poder guardar coordenadas ingresadas.');
        }
      }
      return;
    }
    var sheet = spreadsheet.insertSheet(par[0]);
    sheet.getRange(1, 1, 1, par[1].length).setValues([par[1]]);
    sheet.setFrozenRows(1);
    Logger.log('Hoja ' + par[0] + ' creada.');
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_CORRECCIONES_HOJA,
    UBICACION_CORRECCIONES_LOG_HOJA,
    UBICACION_CORRECCIONES_COLUMNAS,
    UBICACION_CORRECCIONES_COLUMNAS_V1,
    UBICACION_CORRECCIONES_COLUMNAS_V2_NUEVAS,
    UBICACION_CORRECCIONES_LOG_COLUMNAS,
    ubicacionCorreccionRepository_indiceColumnas,
    ubicacionCorreccionRepository_planMigracionV2,
    ubicacionCorreccionRepository_esquemaCorreccionesV2,
    ubicacionCorreccionRepository_columnasFaltantes,
    ubicacionCorreccionRepository_filaDesdeObjeto,
    ubicacionCorreccionRepository_correccionDesdeFila,
    ubicacionCorreccionRepository_eventoDesdeFila,
    ubicacionCorreccionRepository_listarCorrecciones,
    ubicacionCorreccionRepository_listarEventos,
    ubicacionCorreccionRepository_agregarCorreccion,
    ubicacionCorreccionRepository_agregarEventos,
    ubicacionCorreccionRepository_agregarCorreccionConEvento,
    ubicacionCorreccionRepository_agregarCorreccionConEventos,
    ubicacionCorreccionRepository_conLock,
    migrarUbicacionCorreccionesV2,
    setupUbicacionCorreccionesSheets
  };
}
