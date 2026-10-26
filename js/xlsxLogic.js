// Escritor XLSX minimo y PURO (sin DOM, sin red, sin descarga): arma un libro de Excel a partir de una descripcion de hojas. Solo necesita JSZip (el del vendor), que se INYECTA:
// en el navegador es el que carga mapaShared_cargarJSZip(); en los tests, vendor/jszip/jszip.min.js. No agrega ninguna libreria.
//
// Reglas (cada una la fija un test):
//   - TODO texto va como `inlineStr` (celda de texto literal). Nunca se escribe una formula (`<f>`): un texto que empieza con = + - @ o tabulacion queda como texto, igual que "1/2" o "1-2".
//   - Los numeros van como celda numerica (`<v>`), nunca como texto localizado. Un numero no finito (NaN, Infinity) o cualquier otro tipo de valor -> celda vacia.
//   - Texto -> caracteres de control ilegales en XML (U+0000-0008, 000B, 000C, 000E-001F, FFFE, FFFF) y sustitutos sueltos se eliminan; CR/CRLF se normalizan a LF; se conservan
//     tabulacion, salto de linea, acentos y emoji (par sustituto valido); se escapan & < > ". Limite de Excel: 32.767 caracteres por celda (se corta sin partir un par sustituto).
//   - Nombre de hoja valido: sin [ ] : * ? / \ , sin apostrofe al principio ni al final, 1 a 31 caracteres, unico sin distinguir mayusculas.
//
// Celda de una fila: string -> texto; number finito -> numero; null / undefined / '' -> vacia; {texto, estilo} o {numero, estilo} -> con estilo (ver XLSX_ESTILOS).
// Hoja: {nombre, filas: [[celda]], anchos: [numero por columna], congelarPrimeraFila: bool, autofiltro: bool}. Libro: {hojas: [hoja]}.

var XLSX_MAX_CARACTERES_CELDA = 32767;
var XLSX_MAX_CARACTERES_NOMBRE_HOJA = 31;

// Indices de estilo (cellXfs de xl/styles.xml): 0 normal, 1 encabezado (negrita), 2 coordenada (0.000000).
var XLSX_ESTILOS = { normal: 0, encabezado: 1, coordenada: 2 };

var XLSX_NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
var XLSX_NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
var XLSX_NS_PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
var XLSX_CABECERA_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xlsxLogic_esSustitutoAlto(codigo) {
  return codigo >= 0xD800 && codigo <= 0xDBFF;
}

function xlsxLogic_esSustitutoBajo(codigo) {
  return codigo >= 0xDC00 && codigo <= 0xDFFF;
}

// Texto seguro para una celda: sin caracteres ilegales, con saltos de linea normalizados y recortado al limite de Excel (sin partir un par sustituto). No escapa XML (eso es xlsxLogic_escaparXml).
function xlsxLogic_sanitizarTexto(valor) {
  var s = valor === null || valor === undefined ? '' : String(valor);
  var salida = [];
  var largo = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    var pieza;
    if (c === 0x0D) {
      if (s.charCodeAt(i + 1) === 0x0A) { i += 1; }
      pieza = '\n';
    } else if (c === 0x09 || c === 0x0A) {
      pieza = s.charAt(i);
    } else if (c < 0x20 || c === 0xFFFE || c === 0xFFFF) {
      continue;
    } else if (xlsxLogic_esSustitutoAlto(c)) {
      if (xlsxLogic_esSustitutoBajo(s.charCodeAt(i + 1))) {
        pieza = s.charAt(i) + s.charAt(i + 1);
        i += 1;
      } else {
        continue;                                    // sustituto alto suelto
      }
    } else if (xlsxLogic_esSustitutoBajo(c)) {
      continue;                                      // sustituto bajo suelto
    } else {
      pieza = s.charAt(i);
    }
    if (largo + pieza.length > XLSX_MAX_CARACTERES_CELDA) {
      break;
    }
    salida.push(pieza);
    largo += pieza.length;
  }
  return salida.join('');
}

function xlsxLogic_escaparXml(texto) {
  return String(texto).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Nombre de hoja valido para Excel (ver reglas arriba). Vacio tras limpiar -> 'Hoja'.
function xlsxLogic_nombreHojaValido(nombre) {
  var s = xlsxLogic_sanitizarTexto(nombre).replace(/[\[\]:*?\/\\\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^'+/, '').replace(/'+$/, '').trim();
  if (s.length > XLSX_MAX_CARACTERES_NOMBRE_HOJA) {
    s = s.substring(0, XLSX_MAX_CARACTERES_NOMBRE_HOJA);
    if (xlsxLogic_esSustitutoAlto(s.charCodeAt(s.length - 1))) { s = s.substring(0, s.length - 1); }
    s = s.replace(/'+$/, '').trim();
  }
  return s === '' ? 'Hoja' : s;
}

// Nombres unicos (Excel compara sin distinguir mayusculas): el repetido lleva " (2)", " (3)"... dentro del limite de 31.
function xlsxLogic_nombresUnicos(nombres) {
  var usados = {};
  return nombres.map(function (nombre) {
    var base = xlsxLogic_nombreHojaValido(nombre);
    var candidato = base;
    var n = 2;
    while (usados[candidato.toLowerCase()] === true) {
      var sufijo = ' (' + n + ')';
      candidato = xlsxLogic_nombreHojaValido(base.substring(0, XLSX_MAX_CARACTERES_NOMBRE_HOJA - sufijo.length) + sufijo);
      n += 1;
    }
    usados[candidato.toLowerCase()] = true;
    return candidato;
  });
}

// Letra de columna: 0 -> A, 25 -> Z, 26 -> AA ...
function xlsxLogic_letraColumna(indice) {
  var s = '';
  var n = indice + 1;
  while (n > 0) {
    var resto = (n - 1) % 26;
    s = String.fromCharCode(65 + resto) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function xlsxLogic_numeroXml(n) {
  return String(n);                                  // JS usa siempre punto decimal (nunca coma local) y escribe -0 como "0"
}

function xlsxLogic_xmlCelda(celda, fila, columna) {
  var ref = xlsxLogic_letraColumna(columna) + (fila + 1);
  var estilo = 0;
  var valor = celda;
  if (celda !== null && typeof celda === 'object' && !Array.isArray(celda)) {
    estilo = celda.estilo === XLSX_ESTILOS.encabezado || celda.estilo === XLSX_ESTILOS.coordenada ? celda.estilo : 0;
    valor = celda.numero !== undefined ? celda.numero : celda.texto;
  }
  var atributoEstilo = estilo ? ' s="' + estilo + '"' : '';
  if (typeof valor === 'number') {
    return isFinite(valor) ? '<c r="' + ref + '"' + atributoEstilo + '><v>' + xlsxLogic_numeroXml(valor) + '</v></c>' : '';
  }
  if (typeof valor === 'string' && valor !== '') {
    var texto = xlsxLogic_sanitizarTexto(valor);
    if (texto === '') { return ''; }
    return '<c r="' + ref + '"' + atributoEstilo + ' t="inlineStr"><is><t xml:space="preserve">' + xlsxLogic_escaparXml(texto) + '</t></is></c>';
  }
  return '';
}

function xlsxLogic_xmlHoja(hoja) {
  var filas = hoja.filas || [];
  var maxColumnas = 0;
  filas.forEach(function (f) { if (f.length > maxColumnas) { maxColumnas = f.length; } });
  var ultimaCol = Math.max(maxColumnas, 1);
  var ultimaFila = Math.max(filas.length, 1);
  var partes = [XLSX_CABECERA_XML, '<worksheet xmlns="' + XLSX_NS_MAIN + '">'];
  partes.push('<dimension ref="A1:' + xlsxLogic_letraColumna(ultimaCol - 1) + ultimaFila + '"/>');
  if (hoja.congelarPrimeraFila === true) {
    partes.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>');
  }
  if (hoja.anchos && hoja.anchos.length > 0) {
    partes.push('<cols>' + hoja.anchos.map(function (a, i) {
      var ancho = typeof a === 'number' && isFinite(a) && a > 0 ? Math.min(a, 255) : 10;
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + xlsxLogic_numeroXml(ancho) + '" customWidth="1"/>';
    }).join('') + '</cols>');
  }
  var cuerpo = filas.map(function (celdas, r) {
    var xmlCeldas = celdas.map(function (celda, c) { return xlsxLogic_xmlCelda(celda, r, c); }).join('');
    return '<row r="' + (r + 1) + '">' + xmlCeldas + '</row>';
  });
  partes.push('<sheetData>' + cuerpo.join('') + '</sheetData>');
  if (hoja.autofiltro === true && maxColumnas > 0) {
    partes.push('<autoFilter ref="A1:' + xlsxLogic_letraColumna(maxColumnas - 1) + ultimaFila + '"/>');
  }
  partes.push('</worksheet>');
  return partes.join('');
}

function xlsxLogic_xmlEstilos() {
  return XLSX_CABECERA_XML + '<styleSheet xmlns="' + XLSX_NS_MAIN + '">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="0.000000"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';
}

// Todas las partes del paquete como {ruta: texto}. Pura: no necesita JSZip (la usan los tests para mirar el XML).
function xlsxLogic_construirPartes(libro) {
  var hojas = (libro && libro.hojas && libro.hojas.length > 0) ? libro.hojas : [{ nombre: 'Hoja', filas: [] }];
  var nombres = xlsxLogic_nombresUnicos(hojas.map(function (h) { return h.nombre; }));
  var partes = {};

  var overrides = hojas.map(function (h, i) {
    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
  }).join('');
  partes['[Content_Types].xml'] = XLSX_CABECERA_XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    overrides +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';

  partes['_rels/.rels'] = XLSX_CABECERA_XML + '<Relationships xmlns="' + XLSX_NS_PKG_REL + '">' +
    '<Relationship Id="rId1" Type="' + XLSX_NS_REL + '/officeDocument" Target="xl/workbook.xml"/></Relationships>';

  partes['xl/workbook.xml'] = XLSX_CABECERA_XML + '<workbook xmlns="' + XLSX_NS_MAIN + '" xmlns:r="' + XLSX_NS_REL + '"><sheets>' +
    nombres.map(function (n, i) {
      return '<sheet name="' + xlsxLogic_escaparXml(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    }).join('') + '</sheets></workbook>';

  partes['xl/_rels/workbook.xml.rels'] = XLSX_CABECERA_XML + '<Relationships xmlns="' + XLSX_NS_PKG_REL + '">' +
    hojas.map(function (h, i) {
      return '<Relationship Id="rId' + (i + 1) + '" Type="' + XLSX_NS_REL + '/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
    }).join('') +
    '<Relationship Id="rId' + (hojas.length + 1) + '" Type="' + XLSX_NS_REL + '/styles" Target="styles.xml"/></Relationships>';

  partes['xl/styles.xml'] = xlsxLogic_xmlEstilos();
  hojas.forEach(function (h, i) {
    partes['xl/worksheets/sheet' + (i + 1) + '.xml'] = xlsxLogic_xmlHoja(h);
  });
  return partes;
}

// Genera el .xlsx. JSZipCtor: el constructor de JSZip (inyectado). tipo: 'uint8array' (default) | 'blob' | 'nodebuffer'... lo que acepte generateAsync.
// Devuelve una Promise del contenido; rechaza si JSZip falta.
function xlsxLogic_generar(libro, JSZipCtor, tipo) {
  if (typeof JSZipCtor !== 'function') {
    return Promise.reject(new Error('JSZip no disponible'));
  }
  var partes = xlsxLogic_construirPartes(libro);
  var zip = new JSZipCtor();
  Object.keys(partes).forEach(function (ruta) { zip.file(ruta, partes[ruta]); });
  return zip.generateAsync({ type: tipo || 'uint8array', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

var XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    XLSX_MAX_CARACTERES_CELDA,
    XLSX_MAX_CARACTERES_NOMBRE_HOJA,
    XLSX_ESTILOS,
    XLSX_MIME,
    xlsxLogic_sanitizarTexto,
    xlsxLogic_escaparXml,
    xlsxLogic_nombreHojaValido,
    xlsxLogic_nombresUnicos,
    xlsxLogic_letraColumna,
    xlsxLogic_xmlCelda,
    xlsxLogic_xmlHoja,
    xlsxLogic_xmlEstilos,
    xlsxLogic_construirPartes,
    xlsxLogic_generar
  };
}
