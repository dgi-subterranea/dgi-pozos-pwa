// Unica funcion que sabe que existe Drive y getFilesByName(). Si el dia de
// manana cambia el mecanismo de busqueda (por ejemplo, un indice), se
// cambia solo aca - ProfileService y el frontend no se enteran.
function driveProfileRepository_getFile(wellId) {
  var folder = DriveApp.getFolderById(getFolderId());
  var files = folder.getFilesByName(wellId + '.jpg');
  if (!files.hasNext()) {
    return { found: false };
  }
  var file = files.next();
  return { found: true, blob: file.getBlob() };
}

// Solo EXISTENCIA del ITF de un pozo (E4): comprueba que este <wellId>.jpg en la carpeta institucional, sin descargar ni leer el archivo. No depende del indice de miniaturas
// (puede estar incompleto o vencido). Lanza si Drive falla: quien llama lo trata como "no se pudo verificar", nunca como "no existe".
function driveProfileRepository_existe(wellId) {
  var folder = DriveApp.getFolderById(getFolderId());
  return folder.getFilesByName(wellId + '.jpg').hasNext();
}

// Etapa "seleccion multiple + lote": getItfAvailability necesita saber,
// para un lote de wellId, cuales tienen ITF SIN leer cada imagen. Unica
// funcion que de verdad recorre la carpeta THUMB entera - la logica de
// indice/cache que la usa vive en ItfAvailabilityService.js (capa
// separada a proposito: en Apps Script ambas comparten namespace global
// igual, pero separarlas en 2 archivos permite mockear esta funcion como
// global en los tests del service sin que la propia definicion local la
// tape - ver appsScriptFakes.js).
function driveProfileRepository_listarArchivosThumb() {
  var folder = DriveApp.getFolderById(getFolderId());
  var files = folder.getFiles();
  var nombres = [];
  while (files.hasNext()) {
    nombres.push(files.next().getName());
  }
  return nombres;
}

// E9-3 (ITF colaborativos): TODAS las coincidencias exactas por nombre en la carpeta institucional, no solo la primera. Drive permite dos archivos con el mismo nombre y getFile() se queda
// en silencio con el primero; el proveedor legacy de ITF (ItfLegacyProvider.js) necesita contarlos para no inventar un ITF ambiguo. Devuelve descriptores {fileId, nombre, leerBlob()}: el
// fileId es una referencia INTERNA del backend (nunca sale hacia el cliente). Lanza si Drive falla. Todavia no la usa ningun endpoint.
function driveProfileRepository_buscarPorNombre(nombre) {
  var folder = DriveApp.getFolderById(getFolderId());
  var files = folder.getFilesByName(nombre);
  var out = [];
  while (files.hasNext()) {
    var f = files.next();
    out.push({ fileId: f.getId(), nombre: f.getName(), leerBlob: (function (archivo) { return function () { return archivo.getBlob(); }; })(f) });
  }
  return out;
}

// E9-7 (politica de nombre legacy case-insensitive SOLO para la extension .jpg): TODOS los candidatos legacy de un pozo, sea cual sea la capitalizacion de la extension (DD-PPPP.jpg, DD-PPPP.JPG, DD-PPPP.Jpg...).
// No se confia en como compara nombres getFilesByName: se UNEN (por id de archivo) dos busquedas de solo lectura y se filtra en codigo con el nombre logico DD-PPPP + ".jpg" sin importar mayusculas:
//   1) getFilesByName('<wellId>.jpg'): lo que siempre funciono (el canonico en minuscula nunca se pierde);
//   2) searchFiles("title contains '<wellId>'"): trae las variantes de mayusculas. Si esta busqueda falla se LANZA (un error de Drive jamas se vuelve "un solo candidato": podria ocultar un duplicado).
// Descriptores {fileId, nombre, leerBlob()}; el fileId es INTERNO (nunca sale hacia el cliente). Los archivos de otros pozos o con otros nombres se descartan.
function driveProfileRepository_buscarCandidatosLegacy(wellId) {
  if (typeof wellId !== 'string' || !/^\d{2}-\d{4}$/.test(wellId)) {
    throw new Error('wellId invalido');
  }
  var folder = DriveApp.getFolderById(getFolderId());
  var regex = new RegExp('^' + wellId + '\\.jpg$', 'i');
  var vistos = {};
  var out = [];
  function agregar(iterador) {
    while (iterador.hasNext()) {
      var f = iterador.next();
      var id = f.getId();
      if (vistos[id] === true || !regex.test(f.getName())) {
        continue;
      }
      vistos[id] = true;
      out.push({ fileId: id, nombre: f.getName(), leerBlob: (function (archivo) { return function () { return archivo.getBlob(); }; })(f) });
    }
  }
  agregar(folder.getFilesByName(wellId + '.jpg'));
  agregar(folder.searchFiles("title contains '" + wellId + "' and trashed = false"));
  return out;
}

// E9-3: lee un archivo de la carpeta institucional POR ID (el que quedo registrado en ITF_LEGACY_REGISTRADO). Solo devuelve archivos que estan dentro de FOLDER_ID: un id cualquiera de Drive
// no sirve para leer otra cosa con los permisos de la cuenta del backend. {found:false} si no existe o no esta en la carpeta; lanza si Drive falla.
function driveProfileRepository_leerPorId(fileId) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    if (/No item with the given ID|could not be found|not found/i.test(String(err))) {
      return { found: false };
    }
    throw err;                                      // un error de Drive jamas se vuelve "no existe"
  }
  var carpetaId = getFolderId();
  var padres = file.getParents();
  var dentro = false;
  while (padres.hasNext()) {
    if (padres.next().getId() === carpetaId) {
      dentro = true;
    }
  }
  if (!dentro) {
    return { found: false };
  }
  return { found: true, nombre: file.getName(), blob: file.getBlob() };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    driveProfileRepository_getFile,
    driveProfileRepository_existe,
    driveProfileRepository_listarArchivosThumb,
    driveProfileRepository_buscarPorNombre,
    driveProfileRepository_buscarCandidatosLegacy,
    driveProfileRepository_leerPorId
  };
}
