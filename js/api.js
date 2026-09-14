// Wrapper de fetch hacia el Web App de Apps Script. POST con
// Content-Type: text/plain a proposito (evita el preflight de CORS que
// Apps Script no maneja de forma confiable) - ver docs/architecture.md.
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby_fttbCjlZaE7qjhZipqRxvLtdXZV1kCaEjyOeK8UZEJy9VgC5LmAGiyUtVeUZRq1Z/exec';

function callBackend(action, payload) {
  var body = Object.assign({ action: action }, payload || {});
  return fetch(APPS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }).then(function (response) {
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
