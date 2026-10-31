// ItfPreflight (E9-7): herramientas MANUALES de rollout de los ITF colaborativos, para correr a mano desde el editor de Apps Script. NINGUN endpoint, trigger ni pantalla las llama.
//
//   preflightItfE9()              SOLO LECTURA. Informa en el Logger (y devuelve) un checklist de booleanos / contadores: interruptor, carpeta legacy, hoja ItfEventos, columnas de Usuarios, storage de
//                                 ITF. NO escribe nada (ni hojas, ni Drive, ni propiedades, ni cache), NO crea la hoja ni la carpeta, NO cambia permisos ni sharing, NO crea triggers.
//                                 Jamas imprime ids de Drive, la URL ni el secreto del storage, ni emails: solo si-no y cantidades.
//   itfE9Encender()               pone ITF_E9_ACTIVO = SI SOLO si el preflight esta completamente en verde; si no, NO toca nada y lo dice. Es la unica forma recomendada de encender.
//   itfE9Apagar()                 pone ITF_E9_ACTIVO = NO. Siempre funciona (sin condiciones): es el rollback inmediato. No borra eventos ni documentos.
//   medirRendimientoItfE9()       SOLO LECTURA (salvo el cache de indice que ya usa la app): hash SHA-256 de 100 KB / 500 KB / 1 MB / 3 MB / 12 MB sinteticos y disponibilidad legacy de 1 y 500 pozos.
//
// INTERRUPTOR: Script Property ITF_E9_ACTIVO del proyecto dgi-pozos-backend. Encendido = exactamente 'SI'. Apagado = CUALQUIER otro valor o propiedad ausente (el valor real de hoy: ausente).
// La propiedad se lee en cada pedido (sin cache): apagarla corta E9 al instante, tambien para el @HEAD y para las versiones numeradas.
var ITF_PREFLIGHT_PROPIEDAD = 'ITF_E9_ACTIVO';
var ITF_PREFLIGHT_COLUMNAS_USUARIOS = ['perfil_subir', 'perfil_validar'];
// Pozos cuyo UNICO archivo legacy tiene la extension en mayuscula (.JPG), segun la auditoria real de la carpeta (E9-7). El preflight comprueba que el lookup case-insensitive de la politica legacy los resuelve
// como UNICO (solo lectura: nunca se abre ni se renombra el archivo). Es informacion de higiene historica, no una lista de acciones.
var ITF_PREFLIGHT_POZOS_VARIANTE = ['15-1082', '15-1024', '15-0997'];
var ITF_PREFLIGHT_REFERENCIA_INEXISTENTE = 'preflight-referencia-inexistente-no-es-un-archivo';
var ITF_PREFLIGHT_TAMANOS_HASH = [
  { etiqueta: '100 KB', bytes: 100 * 1024 },
  { etiqueta: '500 KB', bytes: 500 * 1024 },
  { etiqueta: '1 MB', bytes: 1024 * 1024 },
  { etiqueta: '3 MB', bytes: 3 * 1024 * 1024 },
  { etiqueta: '12 MB (el legacy mas grande medido: 11,5 MB)', bytes: 12 * 1024 * 1024 }
];

// --- evaluacion PURA (testeable sin Google) ---

// estado = {interruptor: valor crudo de la propiedad (string | null), carpetaLegacy: {configurada, accesible}, hoja: {existe, esquemaOk, filas}, usuarios: {hoja, columnas: {perfil_subir, perfil_validar},
//           activosConSubir, activosConValidar}, storage: {configurado, codigo: 'ITF_NOT_FOUND' | 'ITF_STORAGE_NO_CONFIGURADO' | 'SERVICE_UNAVAILABLE' | otro | null}}
// Devuelve {interruptor: 'ENCENDIDO' | 'APAGADO', items: [{id, ok, detalle}], listoParaEncender, contadores}. listoParaEncender NO depende del interruptor. contadores: solo cantidades (nunca emails).
function itfPreflight_evaluar(estado) {
  var e = estado !== null && typeof estado === 'object' ? estado : {};
  var carpeta = e.carpetaLegacy || {};
  var hoja = e.hoja || {};
  var usuarios = e.usuarios || {};
  var columnas = usuarios.columnas || {};
  var storage = e.storage || {};
  var legacyVariantes = e.legacyVariantes || {};
  var items = [];
  function item(id, ok, detalle) {
    items.push({ id: id, ok: ok === true, detalle: detalle });
  }
  item('carpeta_legacy', carpeta.configurada === true && carpeta.accesible === true,
    carpeta.configurada !== true ? 'FOLDER_ID no configurado' : (carpeta.accesible === true ? 'carpeta legacy configurada y accesible' : 'la carpeta legacy configurada no se pudo abrir'));
  item('legacy_variantes_mayusculas', typeof legacyVariantes.consultados === 'number' && legacyVariantes.consultados > 0 && legacyVariantes.unicos === legacyVariantes.consultados,
    legacyVariantes.consultados > 0 && legacyVariantes.unicos === legacyVariantes.consultados ? 'el lookup case-insensitive resuelve como UNICO los ' + String(legacyVariantes.consultados) + ' pozos con extension en mayuscula' : 'el lookup case-insensitive NO resolvio como UNICO a los pozos con extension en mayuscula (' + String(legacyVariantes.unicos || 0) + ' de ' + String(legacyVariantes.consultados || 0) + ')');
  item('hoja_itfeventos', hoja.existe === true && hoja.esquemaOk === true,
    hoja.existe !== true ? 'la hoja ItfEventos NO existe (setupItfEventosSheet)' : (hoja.esquemaOk === true ? 'existe con el esquema de 17 columnas (' + String(hoja.filas) + ' evento(s))' : 'existe pero con un esquema inesperado: NO tocar, revisar a mano'));
  item('usuarios_hoja', usuarios.hoja === true, usuarios.hoja === true ? 'hoja Usuarios legible' : 'no se pudo leer la hoja Usuarios');
  ITF_PREFLIGHT_COLUMNAS_USUARIOS.forEach(function (c) {
    item('usuarios_columna_' + c, columnas[c] === true, columnas[c] === true ? 'la columna ' + c + ' existe' : 'falta la columna ' + c + ' (sin ella nadie tiene el permiso: fail-closed)');
  });
  item('storage_configurado', storage.configurado === true, storage.configurado === true ? 'URL y secreto del storage presentes' : 'faltan FOTOS_STORAGE_URL / FOTOS_STORAGE_SECRET');
  var codigo = storage.codigo;
  item('storage_itf', codigo === 'ITF_NOT_FOUND',
    codigo === 'ITF_NOT_FOUND' ? 'el storage responde y tiene raiz de ITF (la consulta de un archivo inexistente dio NOT_FOUND)'
      : (codigo === 'ITF_STORAGE_NO_CONFIGURADO' ? 'el storage desplegado NO tiene las acciones de ITF o falta ITF_ROOT_FOLDER_ID (setupItfPropuestasStorage / nueva version del storage)'
        : (codigo === null || codigo === undefined ? 'no se consulto el storage' : 'el storage no respondio como se esperaba (' + String(codigo) + ')')));
  var listo = items.every(function (i) { return i.ok; });
  return {
    interruptor: e.interruptor === 'SI' ? 'ENCENDIDO' : 'APAGADO',
    items: items,
    listoParaEncender: listo,
    contadores: { eventos: typeof hoja.filas === 'number' ? hoja.filas : 0, usuariosActivosConPerfilSubir: usuarios.activosConSubir || 0, usuariosActivosConPerfilValidar: usuarios.activosConValidar || 0 }
  };
}

function itfPreflight_cuantosActivosCon(data, columna) {
  if (!data || data.length < 2) {
    return 0;
  }
  var cabecera = data[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var iEstado = cabecera.indexOf('estado');
  var iPerfil = cabecera.indexOf('perfil');
  var iColumna = cabecera.indexOf(columna);
  if (iEstado < 0 || iPerfil < 0 || iColumna < 0) {
    return 0;
  }
  var n = 0;
  for (var i = 1; i < data.length; i++) {
    var fila = data[i];
    if (String(fila[iEstado]).trim().toLowerCase() === 'activo' && String(fila[iPerfil]).trim().toLowerCase() === 'si' && String(fila[iColumna]).trim().toLowerCase() === 'si') {
      n += 1;
    }
  }
  return n;
}

function itfPreflight_columnasDeUsuarios(data) {
  var cabecera = data && data.length > 0 ? data[0].map(function (h) { return String(h).trim().toLowerCase(); }) : [];
  var r = {};
  ITF_PREFLIGHT_COLUMNAS_USUARIOS.forEach(function (c) { r[c] = cabecera.indexOf(c) >= 0; });
  return r;
}

// --- recoleccion (lecturas) ---

// deps inyectables para los tests; por defecto las de Apps Script. Cada lectura va en su propio try: un fallo se informa como "no ok", nunca rompe ni imprime el error crudo.
function itfPreflight_recolectar(deps) {
  var d = deps || {};
  var props = d.propiedad || function (k) { return PropertiesService.getScriptProperties().getProperty(k); };
  var estado = { interruptor: props(ITF_PREFLIGHT_PROPIEDAD), carpetaLegacy: { configurada: false, accesible: false }, hoja: { existe: false, esquemaOk: false, filas: 0 }, usuarios: { hoja: false, columnas: { perfil_subir: false, perfil_validar: false }, activosConSubir: 0, activosConValidar: 0 }, storage: { configurado: false, codigo: null } };
  try {
    var idCarpeta = d.carpetaLegacyId ? d.carpetaLegacyId() : getFolderId();
    estado.carpetaLegacy.configurada = typeof idCarpeta === 'string' && idCarpeta !== '';
    if (estado.carpetaLegacy.configurada) {
      (d.abrirCarpeta || function (id) { DriveApp.getFolderById(id); })(idCarpeta);
      estado.carpetaLegacy.accesible = true;
    }
  } catch (err) {
    // sigue en false
  }
  try {
    var variantes = d.estadosVariantesLegacy ? d.estadosVariantesLegacy() : ITF_PREFLIGHT_POZOS_VARIANTE.map(function (w) { return itfLegacy_buscar(w).estado; });
    estado.legacyVariantes = { consultados: variantes.length, unicos: variantes.filter(function (v) { return v === 'UNICO'; }).length };
  } catch (err) {
    estado.legacyVariantes = { consultados: ITF_PREFLIGHT_POZOS_VARIANTE.length, unicos: 0 };
  }
  try {
    var hoja = d.hojaItfEventos ? d.hojaItfEventos() : SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(ITF_EVENTOS_HOJA);
    if (hoja) {
      estado.hoja.existe = true;
      var ancho = hoja.getLastColumn();
      estado.hoja.esquemaOk = ancho > 0 && itfEventosRepository_planEsquema(hoja.getRange(1, 1, 1, ancho).getValues()[0]).ok === true;
      estado.hoja.filas = Math.max(0, hoja.getLastRow() - 1);
    }
  } catch (err) {
    // sigue en false
  }
  try {
    var data = d.datosUsuarios ? d.datosUsuarios() : SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName('Usuarios').getDataRange().getValues();
    estado.usuarios.hoja = true;
    estado.usuarios.columnas = itfPreflight_columnasDeUsuarios(data);
    estado.usuarios.activosConSubir = itfPreflight_cuantosActivosCon(data, 'perfil_subir');
    estado.usuarios.activosConValidar = itfPreflight_cuantosActivosCon(data, 'perfil_validar');
  } catch (err) {
    // sigue en false
  }
  try {
    var proveedor = d.proveedorStorage ? d.proveedorStorage() : itfStorage_crearReal();
    // Consulta de SOLO LECTURA de un archivo que no existe: si el storage responde NOT_FOUND es que esta desplegado con las acciones de ITF y tiene su raiz configurada.
    estado.storage.configurado = d.storageConfigurado ? d.storageConfigurado() === true : (typeof getFotosStorageUrl === 'function' && !!getFotosStorageUrl() && !!getFotosStorageSecret());
    var r = estado.storage.configurado ? proveedor.obtenerMetadata(ITF_PREFLIGHT_REFERENCIA_INEXISTENTE) : { ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' };
    estado.storage.codigo = r.ok === true ? 'RESPUESTA_INESPERADA' : r.code;
  } catch (err) {
    estado.storage.codigo = estado.storage.configurado ? 'SERVICE_UNAVAILABLE' : 'ITF_STORAGE_NO_CONFIGURADO';
  }
  return estado;
}

// --- entradas de Apps Script (a mano) ---

function preflightItfE9() {
  var informe = itfPreflight_evaluar(itfPreflight_recolectar());
  Logger.log(JSON.stringify(informe, null, 2));
  return informe;
}

function itfE9Encender() {
  var informe = itfPreflight_evaluar(itfPreflight_recolectar());
  if (!informe.listoParaEncender) {
    Logger.log('NO SE ENCENDIO ITF_E9_ACTIVO: el preflight no esta completamente en verde.');
    Logger.log(JSON.stringify(informe.items.filter(function (i) { return !i.ok; }), null, 2));
    return { encendido: false, motivo: 'PREFLIGHT_NO_OK', pendientes: informe.items.filter(function (i) { return !i.ok; }).map(function (i) { return i.id; }) };
  }
  PropertiesService.getScriptProperties().setProperty(ITF_PREFLIGHT_PROPIEDAD, 'SI');
  Logger.log('ITF_E9_ACTIVO = SI (encendido). Para apagar: itfE9Apagar().');
  return { encendido: true };
}

function itfE9Apagar() {
  PropertiesService.getScriptProperties().setProperty(ITF_PREFLIGHT_PROPIEDAD, 'NO');
  Logger.log('ITF_E9_ACTIVO = NO (apagado). No se borro ningun evento ni documento.');
  return { encendido: false };
}

// --- medicion (lectura) ---

// Bytes con signo (como los de Apps Script). Empiezan con la firma JPEG (FF D8 FF) para que los validadores de formato los reconozcan como una imagen.
function itfPreflight_bytesSinteticos(n) {
  var b = [];
  for (var i = 0; i < n; i++) {
    b.push(((i * 31 + 7) % 256) - 128);
  }
  if (n >= 3) {
    b[0] = -1;
    b[1] = -40;
    b[2] = -1;
  }
  return b;
}

// deps inyectables: ahora() (ms), sha256(bytes), disponibilidad(wellIds)
function itfPreflight_medir(deps) {
  var d = deps || {};
  var ahora = d.ahora || function () { return new Date().getTime(); };
  var sha = d.sha256 || function (bytes) { return itfArchivo_sha256Hex(bytes); };
  var disponibilidad = d.disponibilidad || function (ids) { return itfLegacy_disponibilidad(ids); };
  var resultado = { hash: [], disponibilidad: [] };
  ITF_PREFLIGHT_TAMANOS_HASH.forEach(function (t) {
    var t0 = ahora();
    try {
      var bytes = itfPreflight_bytesSinteticos(t.bytes);
      sha(bytes);
      var ms = ahora() - t0;
      // Los dos limites son independientes: un legacy existente de este tamano debe poder registrarse aunque supere el de las propuestas nuevas.
      resultado.hash.push({
        tamano: t.etiqueta,
        ms: ms,
        legacyRegistrable: itfArchivo_validarLegacy({ bytes: bytes }).ok === true,
        propuestaNuevaAceptada: itfArchivo_validarPropuesta({ mimeType: 'image/jpeg', bytes: bytes }).ok === true
      });
    } catch (err) {
      resultado.hash.push({ tamano: t.etiqueta, ms: ahora() - t0, error: true });        // p. ej. memoria: se informa y se sigue con lo demas
    }
  });
  [{ etiqueta: '1 pozo', n: 1 }, { etiqueta: '500 pozos', n: 500 }, { etiqueta: '500 pozos (otra vez)', n: 500 }].forEach(function (c) {
    var ids = [];
    for (var i = 1; i <= c.n; i++) {
      ids.push('14-' + ('000' + i).slice(-4));
    }
    var t0 = ahora();
    disponibilidad(ids);
    resultado.disponibilidad.push({ consulta: c.etiqueta, ms: ahora() - t0 });
  });
  return resultado;
}

function medirRendimientoItfE9() {
  var r = itfPreflight_medir();
  Logger.log(JSON.stringify(r, null, 2));
  return r;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_PREFLIGHT_PROPIEDAD,
    ITF_PREFLIGHT_TAMANOS_HASH,
    ITF_PREFLIGHT_POZOS_VARIANTE,
    itfPreflight_evaluar,
    itfPreflight_cuantosActivosCon,
    itfPreflight_columnasDeUsuarios,
    itfPreflight_recolectar,
    itfPreflight_bytesSinteticos,
    itfPreflight_medir,
    preflightItfE9,
    itfE9Encender,
    itfE9Apagar,
    medirRendimientoItfE9
  };
}
