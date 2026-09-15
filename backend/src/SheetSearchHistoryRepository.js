// Unica funcion que sabe que existe una hoja "Busquedas" en Sheets.
// Una fila por BUSQUEDA COMPLETA de pozo (no una por endpoint) -
// concepto distinto de "Historial" (auditoria tecnica, una fila por
// llamada). Columnas, header en la fila 1:
//   timestamp | email | nombre | wellId | resultado | perfil | datos | ubicacion | ne
// resultado: "ENCONTRADO" / "NO_ENCONTRADO". Los 4 modulos: "SI"/"NO",
// mismo vocabulario que la hoja "Usuarios" - pensado para analisis
// posterior (tablas dinamicas, COUNTIF) directo sobre esta hoja.
function sheetSearchHistoryRepository_logSearch(email, nombre, wellId, resultado, modulos) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName('Busquedas');
  if (!sheet) {
    throw new Error('No existe una hoja llamada "Busquedas" en el spreadsheet configurado');
  }

  function siNo(valor) {
    return valor ? 'SI' : 'NO';
  }

  sheet.appendRow([
    new Date(),
    email,
    nombre || '',
    wellId,
    resultado,
    siNo(modulos.perfil),
    siNo(modulos.datos),
    siNo(modulos.ubicacion),
    siNo(modulos.ne)
  ]);

  // Mismo motivo que en SheetHistoryRepository: sin esto Sheets puede
  // reinterpretar "04-0263" como fecha/numero y perder el cero inicial,
  // aunque se haya escrito como string.
  var newRow = sheet.getLastRow();
  var wellIdCell = sheet.getRange(newRow, 4);
  wellIdCell.setNumberFormat('@');
  wellIdCell.setValue(wellId);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sheetSearchHistoryRepository_logSearch };
}
