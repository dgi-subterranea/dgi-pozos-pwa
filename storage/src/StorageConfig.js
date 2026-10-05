// Proyecto de Apps Script de STORAGE de fotos (Reemplazos v2). Se despliega
// en una SEGUNDA cuenta de Google, distinta de la del backend principal,
// como Web App "Ejecutar como: yo" - asi cada archivo se crea realmente
// bajo ESA cuenta y consume SU cuota de Drive (ver
// docs/fotos-reemplazo-storage.md). Este proyecto no sabe nada de
// usuarios, permisos ni Sheets: solo guarda y entrega fotos a quien firme
// la llamada con el secreto compartido.
//
// Script Properties de ESTE proyecto:
//   FOTOS_STORAGE_SECRET   secreto compartido (>= 32 caracteres), el MISMO
//                          que en el backend principal
//   FOTOS_ROOT_FOLDER_ID   id de la carpeta raiz "FotosReemplazo" (lo crea
//                          setupFotosStorage)
var STORAGE_ROOT_FOLDER_NAME = 'FotosReemplazo';
var STORAGE_SECRET_MIN_LENGTH = 32;

function getStorageSecret() {
  var secret = PropertiesService.getScriptProperties().getProperty('FOTOS_STORAGE_SECRET');
  if (!secret || secret.length < STORAGE_SECRET_MIN_LENGTH) {
    throw new Error('FOTOS_STORAGE_SECRET no configurado (o demasiado corto, minimo ' + STORAGE_SECRET_MIN_LENGTH + ') en Script Properties');
  }
  return secret;
}

function getStorageRootFolderId() {
  var id = PropertiesService.getScriptProperties().getProperty('FOTOS_ROOT_FOLDER_ID');
  if (!id) {
    throw new Error('FOTOS_ROOT_FOLDER_ID no configurado: correr setupFotosStorage() una vez');
  }
  return id;
}

// Correr UNA VEZ manualmente desde el editor (Ejecutar > setupFotosStorage)
// con la SEGUNDA cuenta. IDEMPOTENTE: si ya hay carpeta configurada no
// crea otra. Loguea la cuenta efectiva para verificar que es la correcta.
function setupFotosStorage() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('Cuenta efectiva: ' + Session.getEffectiveUser().getEmail());
  var existente = props.getProperty('FOTOS_ROOT_FOLDER_ID');
  if (existente) {
    Logger.log('FOTOS_ROOT_FOLDER_ID ya configurado (' + existente + '), no se modifico.');
    return;
  }
  var carpetas = DriveApp.getRootFolder().getFoldersByName(STORAGE_ROOT_FOLDER_NAME);
  var carpeta = carpetas.hasNext() ? carpetas.next() : DriveApp.getRootFolder().createFolder(STORAGE_ROOT_FOLDER_NAME);
  props.setProperty('FOTOS_ROOT_FOLDER_ID', carpeta.getId());
  Logger.log('Carpeta raiz lista: ' + carpeta.getName() + ' (' + carpeta.getId() + ')');
}

// Verificacion de cuota (correr con la segunda cuenta, antes y despues de
// subir fotos de prueba): el uso de Drive de ESTA cuenta tiene que subir y
// el de la cuenta principal no.
function diagnosticarCuotaStorage() {
  Logger.log('Cuenta efectiva: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Drive usado (bytes): ' + DriveApp.getStorageUsed());
  Logger.log('Drive limite (bytes): ' + DriveApp.getStorageLimit());
  var carpeta = DriveApp.getFolderById(getStorageRootFolderId());
  Logger.log('Propietario de la carpeta raiz: ' + carpeta.getOwner().getEmail());
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { STORAGE_ROOT_FOLDER_NAME, getStorageSecret, getStorageRootFolderId };
}
