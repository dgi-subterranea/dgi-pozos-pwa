// Configuracion centralizada. Publico (Client ID) va como constante en el
// codigo; secretos/IDs van siempre a Script Properties, nunca hardcodeados.

var GOOGLE_CLIENT_ID = '970817103867-q30tnqqqcc9lhtaamqplbs28nglcj7q3.apps.googleusercontent.com';

function getSessionSecret() {
  var secret = PropertiesService.getScriptProperties().getProperty('SESSION_SECRET');
  if (!secret) {
    throw new Error('SESSION_SECRET no configurado. Corre setupSessionSecret() primero.');
  }
  return secret;
}

function getFolderId() {
  var folderId = PropertiesService.getScriptProperties().getProperty('FOLDER_ID');
  if (!folderId) {
    throw new Error('FOLDER_ID no configurado en Script Properties');
  }
  return folderId;
}

// Carpeta de Drive con 01.json..19.json + metadata.json (Ficha del Pozo),
// generados por scripts/reindex_pozos.py y subidos a mano. Carpeta
// distinta de FOLDER_ID (esa es de las imagenes THUMB del ITF) a
// proposito - son dos fuentes de datos independientes.
function getRegistryFolderId() {
  var folderId = PropertiesService.getScriptProperties().getProperty('REGISTRY_FOLDER_ID');
  if (!folderId) {
    throw new Error('REGISTRY_FOLDER_ID no configurado en Script Properties');
  }
  return folderId;
}

// Carpeta de Drive con nivelesEstaticos.json + metadata.json (Red de
// Niveles Estaticos), generados por scripts/reindex_niveles_estaticos.py
// y subidos a mano. Carpeta distinta de REGISTRY_FOLDER_ID a proposito -
// la red NE es un recurso independiente del padron (ver
// NivelesEstaticosRepository.js): un monitoringId puede no tener wellId.
function getNivelesEstaticosFolderId() {
  var folderId = PropertiesService.getScriptProperties().getProperty('NIVELES_ESTATICOS_FOLDER_ID');
  if (!folderId) {
    throw new Error('NIVELES_ESTATICOS_FOLDER_ID no configurado en Script Properties');
  }
  return folderId;
}

// Notificaciones de busqueda por Telegram (ver NotificationService.js /
// TelegramRepository.js) - secretos en Script Properties, nunca en el
// codigo. El token nunca debe aparecer en logs ni mensajes de error, ver
// TelegramRepository.js.
function getTelegramBotToken() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN no configurado en Script Properties');
  }
  return token;
}

function getTelegramChatId() {
  var chatId = PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_ID');
  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID no configurado en Script Properties');
  }
  return chatId;
}

// Carpeta de Drive con pozos.json + metadata.json (Mapa de Pozos),
// generados por scripts/reindex_mapa.py a partir de la salida ya
// indexada de scripts/out/registro y subidos a mano. Carpeta distinta de
// REGISTRY_FOLDER_ID a proposito: el mapa se regenera en su propio ritmo
// (solo depende de coordenadas, no de toda la ficha registral) y su
// contenido ya viene sanitizado por diseno (ver MapaService.js) - no
// tiene sentido que comparta carpeta con datos registrales completos.
function getMapaFolderId() {
  var folderId = PropertiesService.getScriptProperties().getProperty('MAPA_FOLDER_ID');
  if (!folderId) {
    throw new Error('MAPA_FOLDER_ID no configurado en Script Properties');
  }
  return folderId;
}

function getSpreadsheetId() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) {
    throw new Error('SPREADSHEET_ID no configurado en Script Properties');
  }
  return spreadsheetId;
}

// Correr esta funcion UNA VEZ manualmente desde el editor de Apps Script
// (Ejecutar > setupSessionSecret) para generar y guardar el secreto HMAC.
// No sobreescribe un secreto ya existente.
function setupSessionSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('SESSION_SECRET')) {
    Logger.log('SESSION_SECRET ya existe, no se modifico.');
    return;
  }
  var secret = Utilities.getUuid() + Utilities.getUuid();
  props.setProperty('SESSION_SECRET', secret);
  Logger.log('SESSION_SECRET generado y guardado en Script Properties.');
}
