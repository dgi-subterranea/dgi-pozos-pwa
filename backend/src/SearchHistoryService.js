// SearchHistoryService: registra una fila por busqueda COMPLETA de pozo
// en la hoja "Busquedas" - independiente de NotificationService
// (Telegram). Un problema al escribir en Sheets nunca debe hacer
// fallar la busqueda que lo origino - mismo principio que
// HistoryService con "Historial", nunca se relanza el error hacia
// arriba.
function searchHistoryService_registerSearch(email, nombre, wellId, modulos) {
  var m = modulos || {};
  var resultado = (m.perfil || m.datos || m.ubicacion || m.ne) ? 'ENCONTRADO' : 'NO_ENCONTRADO';

  try {
    sheetSearchHistoryRepository_logSearch(email, nombre, wellId, resultado, m);
    return { logged: true };
  } catch (err) {
    Logger.log('No se pudo registrar en Busquedas: ' + err.toString());
    return { logged: false };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { searchHistoryService_registerSearch };
}
