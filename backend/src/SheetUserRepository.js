// Unica funcion que sabe que existe una hoja "Usuarios" en Sheets.
// Columnas esperadas (header en la fila 1, CUALQUIER orden):
//   email | nombre | estado | fecha_alta | perfil | datos | ubicacion | ne | reemplazo | fotos | fotos_carga | fotos_moderar | ubicacion_corregir | ubicacion_validar | observaciones | observaciones_agregar | observaciones_anular
// Las columnas se buscan por el TEXTO del encabezado (normalizado a
// minuscula/trim), nunca por posicion fija - reordenar columnas en la
// hoja no rompe nada. Si falta alguna de las columnas de permiso (por ejemplo
// fotos / fotos_carga / fotos_moderar / ubicacion_corregir / ubicacion_validar / observaciones* antes de agregarlas a la hoja), ese permiso da false para
// todos (fail-closed), sin lanzar error.
//
// "estado" debe valer exactamente "activo" (normalizado) para
// considerarse habilitado. Cualquier otro valor, o el email ausente de
// la hoja, se trata como no habilitado.
//
// Permisos: SOLO "si" (normalizado - acepta "SI", "Si", "si ", etc.)
// dat true. Cualquier otra cosa da false: "NO", vacio, "1", "true",
// texto desconocido, o la columna directamente inexistente en el header.
// No hay ningun valor que se interprete como "permitido por defecto".
var USUARIOS_COLUMNAS = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];
var USUARIOS_COLUMNAS_PERMISO = ['perfil', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];

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
  return { perfil: false, datos: false, ubicacion: false, ne: false, reemplazo: false, fotos: false, fotos_carga: false, fotos_moderar: false, ubicacion_corregir: false, ubicacion_validar: false, observaciones: false, observaciones_agregar: false, observaciones_anular: false };
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

// Usuarios ACTIVOS (estado "activo" exacto) que tienen TODOS los permisos indicados (cada uno SOLO con "SI", igual que getUserStatus), sin emails
// vacios ni repetidos. Fail-closed: si falta la columna de algun permiso pedido, nadie lo tiene y la lista queda vacia. data = valores de la hoja
// (fila 1 = encabezado). Devuelve [{email (normalizado), nombre|null}]. Logica pura: se testea sin SpreadsheetApp.
function sheetUserRepository_filtrarConPermisos(data, permisosRequeridos) {
  if (!data || data.length === 0) {
    return [];
  }
  var indices = sheetUserRepository_indiceColumnas(data[0]);
  var vistos = {};
  var lista = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var email = indices.email >= 0 ? String(row[indices.email]).trim().toLowerCase() : '';
    var activo = indices.estado >= 0 && String(row[indices.estado]).trim().toLowerCase() === 'activo';
    if (!email || !activo || vistos[email] === true) {
      continue;
    }
    var todos = (permisosRequeridos || []).length > 0 && permisosRequeridos.every(function (p) {
      return sheetUserRepository_leerPermiso(row, indices, p);
    });
    if (todos) {
      vistos[email] = true;
      lista.push({ email: email, nombre: indices.nombre >= 0 ? (String(row[indices.nombre]).trim() || null) : null });
    }
  }
  return lista;
}

// Lee la hoja "Usuarios" (sin cache: es para avisos, no para autorizar) y aplica el filtro de arriba.
function sheetUserRepository_listarConPermisos(permisosRequeridos) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName('Usuarios');
  if (!sheet) {
    throw new Error('No existe una hoja llamada "Usuarios" en el spreadsheet configurado');
  }
  return sheetUserRepository_filtrarConPermisos(sheet.getDataRange().getValues(), permisosRequeridos);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sheetUserRepository_filtrarConPermisos,
    sheetUserRepository_listarConPermisos,
    sheetUserRepository_getUserStatus,
    sheetUserRepository_indiceColumnas,
    sheetUserRepository_leerPermiso
  };
}
