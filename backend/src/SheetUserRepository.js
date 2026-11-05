// Unica pieza que sabe que existe una hoja "Usuarios" en Sheets (lectura por request, lectura/escritura de la administracion y de la migracion).
//
// Esquema (header en la fila 1, CUALQUIER orden; las columnas se buscan por el TEXTO del encabezado, normalizado a minuscula/trim, nunca por posicion):
//   base      email | nombre | estado | fecha_alta
//   permisos  los ids de PermisosCatalogo (fuente unica: perfil, perfil_subir, perfil_validar, datos, ubicacion, ubicacion_corregir, ubicacion_validar, mapa, ne, fotos, fotos_carga, fotos_moderar,
//             observaciones, observaciones_agregar, observaciones_anular, reemplazo, usuarios_admin)
//   control   tipo | version | actualizado_utc | actualizado_por        (E10-1)
// NO hay ninguna lista de permisos en este archivo: sale del catalogo (a llamada, nunca al cargar: el orden de carga de Apps Script no esta garantizado).
//
// LECTURA POR REQUEST (getUserStatus), FAIL-CLOSED:
//   - "estado" debe valer exactamente "activo" (normalizado). Cualquier otro valor, o el email ausente de la hoja, se trata como no habilitado.
//   - Permisos: SOLO "si" (normalizado) da true. Cualquier otra cosa da false: "NO", vacio, "1", "true", texto desconocido, o la columna directamente inexistente.
//   - tipo: INTERNO | EXTERNO | '' (vacio, invalido o columna inexistente). `tipo` NO concede nada; solo hace efectivo (o no) un permiso no aplicable a EXTERNO (usuarios_admin).
//   - version: entero >= 0; vacio o invalido = 0.
// Una columna ausente nunca rompe la lectura: ese dato da su valor restrictivo para todos.
var USUARIOS_HOJA = 'Usuarios';

function sheetUserRepository_columnasBase() {
  return ['email', 'nombre', 'estado', 'fecha_alta'];
}

function sheetUserRepository_columnasControl() {
  return ['tipo', 'version', 'actualizado_utc', 'actualizado_por'];
}

function sheetUserRepository_columnasPermiso() {
  return permisosCatalogo_ids();
}

function sheetUserRepository_columnas() {
  return sheetUserRepository_columnasBase().concat(sheetUserRepository_columnasPermiso(), sheetUserRepository_columnasControl());
}

function sheetUserRepository_indiceColumnas(headerRow) {
  var normalizados = headerRow.map(function (h) { return String(h).trim().toLowerCase(); });
  var indices = {};
  sheetUserRepository_columnas().forEach(function (nombre) {
    indices[nombre] = normalizados.indexOf(nombre);
  });
  return indices;
}

function sheetUserRepository_leerPermiso(row, indices, nombreColumna) {
  var idx = indices[nombreColumna];
  if (idx === undefined || idx < 0) {
    return false;
  }
  return String(row[idx]).trim().toLowerCase() === 'si';
}

// Permisos CRUDOS de una fila (tal cual dice la hoja, sin aplicar ninguna regla de tipo).
function sheetUserRepository_permisosDeFila(row, indices) {
  var permisos = {};
  sheetUserRepository_columnasPermiso().forEach(function (columna) {
    permisos[columna] = sheetUserRepository_leerPermiso(row, indices, columna);
  });
  return permisos;
}

function sheetUserRepository_celda(row, indices, columna) {
  var idx = indices[columna];
  return idx === undefined || idx < 0 || row[idx] === undefined || row[idx] === null ? '' : row[idx];
}

function sheetUserRepository_noEncontrado() {
  return { found: false, active: false, permisos: permisosCatalogo_vacios(), nombre: null, tipo: '', version: 0 };
}

// Estado CRUDO de un usuario (lo que dice la hoja). El acceso efectivo (reglas de tipo) lo calcula UsuariosDominio.usuariosDominio_accesoEfectivo.
function sheetUserRepository_getUserStatus(email) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "Usuarios" en el spreadsheet configurado');
  }

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    return sheetUserRepository_noEncontrado();
  }

  var indices = sheetUserRepository_indiceColumnas(data[0]);
  var normalizedEmail = String(email).trim().toLowerCase();

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rowEmail = indices.email >= 0 ? String(row[indices.email]).trim().toLowerCase() : '';
    if (rowEmail === normalizedEmail) {
      var estado = indices.estado >= 0 ? String(row[indices.estado]).trim().toLowerCase() : '';
      var nombreUsuario = indices.nombre >= 0 ? (String(row[indices.nombre]).trim() || null) : null;
      return {
        found: true,
        active: estado === 'activo',
        permisos: sheetUserRepository_permisosDeFila(row, indices),
        nombre: nombreUsuario,
        tipo: usuariosDominio_normalizarTipo(sheetUserRepository_celda(row, indices, 'tipo')),
        version: usuariosDominio_normalizarVersion(sheetUserRepository_celda(row, indices, 'version'))
      };
    }
  }

  return sheetUserRepository_noEncontrado();
}

// Usuarios ACTIVOS (estado "activo" exacto) que tienen TODOS los permisos indicados (cada uno SOLO con "SI", igual que getUserStatus, y con la misma regla de tipo: un permiso no aplicable a EXTERNO
// solo cuenta para un INTERNO), sin emails vacios ni repetidos. Fail-closed: si falta la columna de algun permiso pedido, nadie lo tiene y la lista queda vacia. data = valores de la hoja
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
    var tipo = usuariosDominio_normalizarTipo(sheetUserRepository_celda(row, indices, 'tipo'));
    var efectivos = usuariosDominio_permisosEfectivos(sheetUserRepository_permisosDeFila(row, indices), tipo);
    var todos = (permisosRequeridos || []).length > 0 && permisosRequeridos.every(function (p) {
      return efectivos[p] === true;
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
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!sheet) {
    throw new Error('No existe una hoja llamada "Usuarios" en el spreadsheet configurado');
  }
  return sheetUserRepository_filtrarConPermisos(sheet.getDataRange().getValues(), permisosRequeridos);
}

// --- ESCRITURA (administracion y migracion): SIEMPRE bajo el lock del servicio que llama; este archivo no toma lock ---

// {ok:true} o {ok:false, faltantes:[...], repetidas:[...]}: la ADMINISTRACION exige el esquema completo (base + todos los permisos + control).
function sheetUserRepository_planEsquemaCompleto(headerRow) {
  var normalizados = (headerRow || []).map(function (h) { return String(h).trim().toLowerCase(); });
  var esperadas = sheetUserRepository_columnas();
  var faltantes = esperadas.filter(function (c) { return normalizados.indexOf(c) < 0; });
  var repetidas = esperadas.filter(function (c) {
    return normalizados.indexOf(c) >= 0 && normalizados.indexOf(c) !== normalizados.lastIndexOf(c);
  });
  return { ok: faltantes.length === 0 && repetidas.length === 0, faltantes: faltantes, repetidas: repetidas };
}

// Abre la hoja y exige el esquema completo; si no, lanza (fail-closed: nunca se escribe en una hoja con un esquema que no se reconoce).
function sheetUserRepository_abrirParaEscritura() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!sheet) {
    throw new Error('USUARIOS_NO_EXISTE: no existe una hoja llamada "Usuarios"');
  }
  var ancho = sheet.getLastColumn();
  if (ancho < 1) {
    throw new Error('USUARIOS_ESQUEMA_INCOMPLETO: la hoja Usuarios no tiene encabezado');
  }
  var header = sheet.getRange(1, 1, 1, ancho).getValues()[0];
  var plan = sheetUserRepository_planEsquemaCompleto(header);
  if (!plan.ok) {
    throw new Error('USUARIOS_ESQUEMA_INCOMPLETO: faltan ' + plan.faltantes.join(', ') + '; repetidas ' + plan.repetidas.join(', '));
  }
  return { spreadsheet: spreadsheet, sheet: sheet, header: header, indices: sheetUserRepository_indiceColumnas(header), ancho: ancho };
}

// Usuarios de la hoja (fresco, sin cache), una entrada por fila con datos: [{fila (1-based), email, nombre, estado, tipo, version, permisos, fechaAlta}]. `estado`: 'activo' | 'inactivo' | '' (otro).
function sheetUserRepository_leerUsuarios(abierta) {
  var h = abierta || sheetUserRepository_abrirParaEscritura();
  var data = h.sheet.getDataRange().getValues();
  var usuarios = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (!Array.isArray(row) || row.every(function (c) { return String(c === null || c === undefined ? '' : c).trim() === ''; })) {
      continue;
    }
    usuarios.push({
      fila: i + 1,
      email: usuariosDominio_normalizarEmail(row[h.indices.email]),
      nombre: String(row[h.indices.nombre] === null || row[h.indices.nombre] === undefined ? '' : row[h.indices.nombre]).trim(),
      estado: usuariosDominio_normalizarEstado(row[h.indices.estado]),
      tipo: usuariosDominio_normalizarTipo(row[h.indices.tipo]),
      version: usuariosDominio_normalizarVersion(row[h.indices.version]),
      permisos: sheetUserRepository_permisosDeFila(row, h.indices),
      fechaAlta: row[h.indices.fecha_alta]
    });
  }
  return usuarios;
}

// Fila COMPLETA tal cual esta (para poder restaurarla si falla la auditoria).
function sheetUserRepository_leerFilaCruda(abierta, fila) {
  return abierta.sheet.getRange(fila, 1, 1, abierta.ancho).getValues()[0].slice();
}

function sheetUserRepository_aSiNo(valor) {
  return valor === true ? 'SI' : 'NO';
}

// Escribe en la fila `fila` los valores de `cambios` ({columna: valor}); las demas celdas quedan EXACTAMENTE como estaban. Los permisos se escriben siempre como SI / NO.
function sheetUserRepository_escribirFila(abierta, fila, cambios) {
  var valores = sheetUserRepository_leerFilaCruda(abierta, fila);
  Object.keys(cambios).forEach(function (col) {
    var idx = abierta.indices[col];
    if (idx === undefined || idx < 0) {
      throw new Error('USUARIOS_ESQUEMA_INCOMPLETO: columna inexistente ' + col);
    }
    valores[idx] = cambios[col];
  });
  abierta.sheet.getRange(fila, 1, 1, abierta.ancho).setValues([valores]);
  return valores;
}

// Deshace una escritura: vuelve a poner la fila cruda anterior.
function sheetUserRepository_restaurarFila(abierta, fila, valoresCrudos) {
  abierta.sheet.getRange(fila, 1, 1, abierta.ancho).setValues([valoresCrudos]);
}

// Agrega una fila al final (alta) con los valores {columna: valor}; devuelve el numero de fila. Las columnas sin valor quedan vacias.
function sheetUserRepository_agregarFila(abierta, cambios) {
  var fila = abierta.sheet.getLastRow() + 1;
  var valores = new Array(abierta.ancho).fill('');
  Object.keys(cambios).forEach(function (col) {
    var idx = abierta.indices[col];
    if (idx === undefined || idx < 0) {
      throw new Error('USUARIOS_ESQUEMA_INCOMPLETO: columna inexistente ' + col);
    }
    valores[idx] = cambios[col];
  });
  abierta.sheet.getRange(fila, 1, 1, abierta.ancho).setValues([valores]);
  return fila;
}

// Deshace un alta cuya auditoria fallo: quita la fila recien agregada (solo si sigue siendo la ULTIMA). NO es un borrado de un usuario real: esa fila nunca llego a existir para el sistema.
function sheetUserRepository_quitarUltimaFilaSiEs(abierta, fila) {
  if (abierta.sheet.getLastRow() === fila) {
    abierta.sheet.deleteRow(fila);
    return true;
  }
  return false;
}

// --- MIGRACION (E10Migracion.js): lectura de la tabla, respaldo, columnas nuevas ---

// {existe, header (valores), filas (valores sin encabezado)} o {existe:false}. Sin cache.
function sheetUserRepository_leerTabla() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!sheet) {
    return { existe: false, header: [], filas: [] };
  }
  var data = sheet.getDataRange().getValues();
  return { existe: true, header: data.length > 0 ? data[0].slice() : [], filas: data.slice(1).map(function (f) { return f.slice(); }) };
}

// Copia de SOLO LECTURA de la hoja Usuarios en otra hoja del mismo spreadsheet (valores, no formulas). Devuelve el nombre. Lanza si ya existe una hoja con ese nombre (nunca pisa un respaldo).
function sheetUserRepository_crearRespaldo(nombre) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var origen = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!origen) {
    throw new Error('USUARIOS_NO_EXISTE: no existe una hoja llamada "Usuarios"');
  }
  if (spreadsheet.getSheetByName(nombre)) {
    throw new Error('RESPALDO_YA_EXISTE: ya hay una hoja llamada ' + nombre);
  }
  var valores = origen.getDataRange().getValues();
  var copia = spreadsheet.insertSheet(nombre);
  if (valores.length > 0 && valores[0].length > 0) {
    copia.getRange(1, 1, valores.length, valores[0].length).setValues(valores);
  }
  return nombre;
}

// Agrega columnas AL FINAL de la tabla en UNA sola escritura (encabezados + valores de todas las filas juntos). `nombres`: encabezados nuevos. `valoresPorFila`: matriz [fila de datos][columna nueva].
// Lanza si algun encabezado ya existe. No toca ninguna celda existente.
function sheetUserRepository_agregarColumnas(nombres, valoresPorFila) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  if (!sheet) {
    throw new Error('USUARIOS_NO_EXISTE: no existe una hoja llamada "Usuarios"');
  }
  var ancho = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  nombres.forEach(function (n) {
    if (header.indexOf(n) >= 0) {
      throw new Error('COLUMNA_YA_EXISTE: ' + n);
    }
  });
  var necesarias = ancho + nombres.length;
  if (sheet.getMaxColumns() < necesarias) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), necesarias - sheet.getMaxColumns());
  }
  var bloque = [nombres.slice()].concat(valoresPorFila);
  sheet.getRange(1, ancho + 1, bloque.length, nombres.length).setValues(bloque);
  return { primeraColumna: ancho + 1, cantidad: nombres.length };
}

// Escribe valores en columnas YA existentes de filas concretas: cambios = [{fila, columna, valor}]. Solo para completar celdas vacias de la migracion.
function sheetUserRepository_escribirCeldas(cambios) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  var ancho = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  cambios.forEach(function (c) {
    var idx = header.indexOf(c.columna);
    if (idx < 0) {
      throw new Error('USUARIOS_ESQUEMA_INCOMPLETO: columna inexistente ' + c.columna);
    }
    sheet.getRange(c.fila, idx + 1, 1, 1).setValues([[c.valor]]);
  });
}

// Quita columnas por encabezado (rollback de la migracion: solo las que agrego la migracion). De derecha a izquierda para no correr los indices.
function sheetUserRepository_quitarColumnas(nombres) {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  var sheet = spreadsheet.getSheetByName(USUARIOS_HOJA);
  var ancho = sheet.getLastColumn();
  var header = sheet.getRange(1, 1, 1, ancho).getValues()[0].map(function (h) { return String(h).trim().toLowerCase(); });
  var idxs = nombres.map(function (n) { return header.indexOf(n); }).filter(function (i) { return i >= 0; }).sort(function (a, b) { return b - a; });
  idxs.forEach(function (i) { sheet.deleteColumn(i + 1); });
  return idxs.length;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUARIOS_HOJA,
    sheetUserRepository_columnasBase,
    sheetUserRepository_columnasControl,
    sheetUserRepository_columnasPermiso,
    sheetUserRepository_columnas,
    sheetUserRepository_filtrarConPermisos,
    sheetUserRepository_listarConPermisos,
    sheetUserRepository_getUserStatus,
    sheetUserRepository_indiceColumnas,
    sheetUserRepository_leerPermiso,
    sheetUserRepository_permisosDeFila,
    sheetUserRepository_planEsquemaCompleto,
    sheetUserRepository_abrirParaEscritura,
    sheetUserRepository_leerUsuarios,
    sheetUserRepository_leerFilaCruda,
    sheetUserRepository_aSiNo,
    sheetUserRepository_escribirFila,
    sheetUserRepository_restaurarFila,
    sheetUserRepository_agregarFila,
    sheetUserRepository_quitarUltimaFilaSiEs,
    sheetUserRepository_leerTabla,
    sheetUserRepository_crearRespaldo,
    sheetUserRepository_agregarColumnas,
    sheetUserRepository_escribirCeldas,
    sheetUserRepository_quitarColumnas
  };
}
