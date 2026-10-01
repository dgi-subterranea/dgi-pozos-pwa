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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { driveProfileRepository_getFile, driveProfileRepository_listarArchivosThumb };
}
