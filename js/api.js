// Wrapper de fetch hacia el Web App de Apps Script. POST con
// Content-Type: text/plain a proposito (evita el preflight de CORS que
// Apps Script no maneja de forma confiable) - ver docs/architecture.md.
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby_fttbCjlZaE7qjhZipqRxvLtdXZV1kCaEjyOeK8UZEJy9VgC5LmAGiyUtVeUZRq1Z/exec';

function callBackend(action, payload, fetchOptions) {
  var body = Object.assign({ action: action }, payload || {});
  var options = Object.assign({
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }, fetchOptions || {});
  return fetch(APPS_SCRIPT_URL, options).then(function (response) {
    return response.json();
  });
}

function apiLogin(idToken) {
  return callBackend('login', { idToken: idToken });
}

function apiCheckSession(sessionToken) {
  return callBackend('checkSession', { sessionToken: sessionToken });
}

function apiGetProfile(sessionToken, wellId) {
  return callBackend('getProfile', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetWellRecord(sessionToken, wellId) {
  return callBackend('getWellRecord', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetRegistryMetadata(sessionToken) {
  return callBackend('getMetadata', { sessionToken: sessionToken });
}

function apiGetMonitoringPoint(sessionToken, monitoringId) {
  return callBackend('getMonitoringPoint', { sessionToken: sessionToken, monitoringId: monitoringId });
}

function apiGetWellLocation(sessionToken, wellId) {
  return callBackend('getWellLocation', { sessionToken: sessionToken, wellId: wellId });
}

// Dataset general del Mapa de Pozos - una sola vez por apertura del mapa,
// nunca por wellId (ver js/mapa.js). Requiere ubicacion=SI del lado del
// backend; el frontend no dispara este fetch si permisosActuales.ubicacion
// es false (ver btn-abrir-mapa en app.js), pero el backend vuelve a
// validarlo igual.
function apiGetMapaPozos(sessionToken) {
  return callBackend('getMapaPozos', { sessionToken: sessionToken });
}

// Popup liviano del mapa: solo se llama si datos=SI (ver
// mapaLogic_debeConsultarSummary) - nunca para mostrar "denegado", el
// permiso se respeta antes de disparar la llamada de red.
function apiGetWellSummary(sessionToken, wellId) {
  return callBackend('getWellSummary', { sessionToken: sessionToken, wellId: wellId });
}

// keepalive: true - para que el request tenga mas chance de llegar
// aunque el usuario cierre/navegue afuera de la PWA justo despues de
// buscar (fire-and-forget, no se espera ni se usa la respuesta). Un
// solo registro por busqueda, disparado una vez al terminar buscarPozo() -
// nunca desde los fetches individuales de cada modulo. Registra en la
// hoja Busquedas y dispara la notificacion Telegram (efectos
// independientes del lado del backend).
function apiRegisterWellSearch(sessionToken, wellId, modulos) {
  return callBackend('registerWellSearch', { sessionToken: sessionToken, wellId: wellId, modulos: modulos }, { keepalive: true });
}
