// Unica funcion que sabe que existe una hoja "Usuarios" en Sheets.
// Columnas esperadas (header en la fila 1, CUALQUIER orden):
//   email | nombre | estado | fecha_alta | perfil | datos | ubicacion | ne
// Las columnas se buscan por el TEXTO del encabezado (normalizado a
// minuscula/trim), nunca por posicion fija - reordenar columnas en la
// hoja no rompe nada. Si falta alguna de las 4 columnas de permiso, ese
// permiso da false para todos (fail-closed), sin lanzar error.
//
// "estado" debe valer exactamente "activo" (normalizado) para
// considerarse habilitado. Cualquier otro valor, o el email ausente de
// la hoja, se trata como no habilitado.
//
// Permisos: SOLO "si" (normalizado - acepta "SI", "Si", "si ", etc.)
// dat true. Cualquier otra cosa da false: "NO", vacio, "1", "true",
// texto desconocido, o la columna directamente inexistente en el header.
// No hay ningun valor que se interprete como "permitido por defecto".
var USUARIOS_COLUMNAS = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne'];
var USUARIOS_COLUMNAS_PERMISO = ['perfil', 'datos', 'ubicacion', 'ne'];

function sheetUserRepository_indiceColumnas(headerRow) {
  var normalizados = headerRow.map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  USUARIOS_COLUMNAS.forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre);
  });
  return indices;
}

function sheetUserRepository_leerPermiso(row, indices, nombreColumna) {
  var idx = indices[nombreColumna];
  if (idx < 0) {
    return false;
  }
  return String(row[idx]).trim().toLowerCase() === 'si';
}

function sheetUserRepository_permisosVacios() {
  return { perfil: false, datos: false, ubicacion: false, ne: false };
}

function sheetUserRepository_getUserStatus(email) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName('Usuarios');
  if (!sheet) {
    throw new Error('No existe una hoja llamada "Usuarios" en el spreadsheet configurado');
  }

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    return { found: false, active: false, permisos: sheetUserRepository_permisosVacios(), nombre: null };
  }

  var indices = sheetUserRepository_indiceColumnas(data[0]);
  var normalizedEmail = String(email).trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowEmail = indices.email >= 0 ? String(row[indices.email]).trim().toLowerCase() : '';
    if (rowEmail === normalizedEmail) {
      var estado = indices.estado >= 0 ? String(row[indices.estado]).trim().toLowerCase() : '';
      var permisos = {};
      USUARIOS_COLUMNAS_PERMISO.forEach(function (columna) {
        permisos[columna] = sheetUserRepository_leerPermiso(row, indices, columna);
      });
      var nombreUsuario = indices.nombre >= 0 ? (String(row[indices.nombre]).trim() || null) : null;
      return { found: true, active: estado === 'activo', permisos: permisos, nombre: nombreUsuario };
    }
  }

  return { found: false, active: false, permisos: sheetUserRepository_permisosVacios(), nombre: null };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sheetUserRepository_getUserStatus,
    sheetUserRepository_indiceColumnas,
    sheetUserRepository_leerPermiso
  };
}
