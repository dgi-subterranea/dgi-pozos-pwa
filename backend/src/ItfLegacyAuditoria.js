// ItfLegacyAuditoria (E9-4): auditoria de SOLO LECTURA de la carpeta institucional de ITF legacy (FOLDER_ID, '<wellId>.jpg'). La corre una persona a mano desde el editor de Apps Script
// (auditarCarpetaItfLegacy); NINGUN endpoint, trigger ni pantalla la llama. No escribe en Drive, en Sheets ni en el cache; no cambia permisos ni mueve archivos.
//
// Para que sirve: la politica legacy de E9 (ItfLegacyProvider.js) solo acepta el nombre exacto '<wellId>.jpg'. Antes de activar ITF_E9_ACTIVO hay que SABER cuantos pozos caen en cada caso
// (unico / ambiguo / no canonico) y que tan grandes son los archivos reales; sin esa medicion el limite de 3 MB y el costo del indice son suposiciones.
//
// QUE INFORMA (todo agregado; nada de ids de Drive ni de enlaces; los ejemplos son wellIds o nombres de archivo, maximo EJEMPLOS por categoria):
//   totalArchivos, canonicos (DD-PPPP.jpg), variantesExtension (DD-PPPP.JPG / .Jpg ...), noCoinciden (nombres que no parecen un ITF), sinPozoValido (parecen un ITF pero el pozo no es valido),
//   duplicadosCanonicos (pozos con >=2 archivos '<wellId>.jpg'), pozosConMasDeUnCandidato (>=2 archivos del mismo pozo, canonicos o no), pozosPorEstado {UNICO, AMBIGUO, NO_CANONICO},
//   tamanos {cantidad, sinTamano, minBytes, medianaBytes, p95Bytes, p99Bytes, maxBytes, totalBytes, sobreElLimite, distribucion[]}.
// El estado por pozo usa EXACTAMENTE la misma regla que el proveedor legacy (UNICO / AMBIGUO / NO_CANONICO); el test lo cruza contra itfLegacy_estadoDe para que no puedan divergir.
//
// POZO VALIDO: departamento 01..19 y numero distinto de 0000 (la misma cobertura que el indice legacy: itfLegacy_departamentos).
// TIEMPO: Apps Script corta a los 6 minutos. La lectura se detiene a los AUDITORIA_MAX_MS (4,5 min) y el informe sale con incompleto=true: nunca se informa un conteo parcial como si fuera total.
var ITF_AUDITORIA_NOMBRE_REGEX = /^(\d{2})-(\d{4})\.([A-Za-z0-9]+)$/;
var ITF_AUDITORIA_EXTENSION_CANONICA = 'jpg';
var ITF_AUDITORIA_EJEMPLOS = 10;
var ITF_AUDITORIA_MAX_MS = 270000;
var ITF_AUDITORIA_LIMITE_BYTES = 3 * 1024 * 1024;
var ITF_AUDITORIA_TRAMOS = [
  { etiqueta: '< 50 KB', hasta: 50 * 1024 },
  { etiqueta: '50-100 KB', hasta: 100 * 1024 },
  { etiqueta: '100-250 KB', hasta: 250 * 1024 },
  { etiqueta: '250-500 KB', hasta: 500 * 1024 },
  { etiqueta: '500 KB - 1 MB', hasta: 1024 * 1024 },
  { etiqueta: '1-3 MB', hasta: 3 * 1024 * 1024 },
  { etiqueta: '> 3 MB', hasta: Infinity }
];

function itfAuditoria_pozoValido(depto, numero) {
  var d = parseInt(depto, 10);
  return d >= 1 && d <= 19 && parseInt(numero, 10) > 0;
}

function itfAuditoria_percentil(ordenados, p) {
  if (ordenados.length === 0) {
    return null;
  }
  var indice = Math.min(ordenados.length - 1, Math.max(0, Math.ceil(p * ordenados.length) - 1));
  return ordenados[indice];
}

function itfAuditoria_agregarEjemplo(lista, valor) {
  if (lista.length < ITF_AUDITORIA_EJEMPLOS) {
    lista.push(valor);
  }
}

// PURA. archivos: [{nombre, bytes}] (bytes puede faltar o ser null: se cuenta en sinTamano y no entra en las estadisticas). opciones.incompleto: la lectura se corto por tiempo.
function itfAuditoria_analizar(archivos, opciones) {
  var lista = archivos || [];
  var informe = {
    totalArchivos: lista.length,
    incompleto: !!(opciones && opciones.incompleto),
    canonicos: 0,
    variantesExtension: 0,
    variantesDetalle: {},
    noCoinciden: 0,
    sinPozoValido: 0,
    duplicadosCanonicos: 0,
    archivosCanonicosSobrantes: 0,
    pozosConMasDeUnCandidato: 0,
    pozosPorEstado: { UNICO: 0, AMBIGUO: 0, NO_CANONICO: 0 },
    tamanos: null,
    ejemplos: { noCoinciden: [], sinPozoValido: [], variantesExtension: [], duplicadosCanonicos: [], pozosConMasDeUnCandidato: [] }
  };
  var porPozo = {};
  var tamanos = [];
  var sinTamano = 0;

  lista.forEach(function (archivo) {
    var nombre = String(archivo && archivo.nombre !== undefined ? archivo.nombre : '');
    var m = ITF_AUDITORIA_NOMBRE_REGEX.exec(nombre);
    var esJpg = m && m[3].toLowerCase() === ITF_AUDITORIA_EXTENSION_CANONICA;
    if (!m || !esJpg) {
      informe.noCoinciden += 1;
      itfAuditoria_agregarEjemplo(informe.ejemplos.noCoinciden, nombre.substring(0, 60));
      return;
    }
    var wellId = m[1] + '-' + m[2];
    if (!itfAuditoria_pozoValido(m[1], m[2])) {
      informe.sinPozoValido += 1;
      itfAuditoria_agregarEjemplo(informe.ejemplos.sinPozoValido, nombre.substring(0, 60));
      return;
    }
    var entrada = porPozo[wellId] = porPozo[wellId] || { canonicos: 0, noCanonicos: 0 };
    if (m[3] === ITF_AUDITORIA_EXTENSION_CANONICA) {
      entrada.canonicos += 1;
      informe.canonicos += 1;
    } else {
      entrada.noCanonicos += 1;
      informe.variantesExtension += 1;
      informe.variantesDetalle['.' + m[3]] = (informe.variantesDetalle['.' + m[3]] || 0) + 1;
      itfAuditoria_agregarEjemplo(informe.ejemplos.variantesExtension, nombre.substring(0, 60));
    }
    var bytes = archivo.bytes;
    if (typeof bytes === 'number' && isFinite(bytes) && bytes >= 0) {
      tamanos.push(bytes);
    } else {
      sinTamano += 1;
    }
  });

  Object.keys(porPozo).sort().forEach(function (wellId) {
    var entrada = porPozo[wellId];
    if (entrada.canonicos >= 2) {
      informe.duplicadosCanonicos += 1;
      informe.archivosCanonicosSobrantes += entrada.canonicos - 1;
      informe.pozosPorEstado.AMBIGUO += 1;
      itfAuditoria_agregarEjemplo(informe.ejemplos.duplicadosCanonicos, wellId);
    } else if (entrada.canonicos === 1) {
      informe.pozosPorEstado.UNICO += 1;
    } else {
      informe.pozosPorEstado.NO_CANONICO += 1;
    }
    if (entrada.canonicos + entrada.noCanonicos >= 2) {
      informe.pozosConMasDeUnCandidato += 1;
      itfAuditoria_agregarEjemplo(informe.ejemplos.pozosConMasDeUnCandidato, wellId);
    }
  });

  var ordenados = tamanos.slice().sort(function (a, b) { return a - b; });
  var total = ordenados.reduce(function (acc, v) { return acc + v; }, 0);
  var desde = 0;
  informe.tamanos = {
    cantidad: ordenados.length,
    sinTamano: sinTamano,
    minBytes: ordenados.length ? ordenados[0] : null,
    medianaBytes: itfAuditoria_percentil(ordenados, 0.5),
    p95Bytes: itfAuditoria_percentil(ordenados, 0.95),
    p99Bytes: itfAuditoria_percentil(ordenados, 0.99),
    maxBytes: ordenados.length ? ordenados[ordenados.length - 1] : null,
    totalBytes: total,
    sobreElLimite: ordenados.filter(function (v) { return v > ITF_AUDITORIA_LIMITE_BYTES; }).length,
    distribucion: ITF_AUDITORIA_TRAMOS.map(function (tramo) {
      var cantidad = ordenados.filter(function (v) { return v >= desde && v < tramo.hasta; }).length;
      desde = tramo.hasta;
      return { tramo: tramo.etiqueta, cantidad: cantidad };
    })
  };
  return informe;
}

// ENTRADA DE APPS SCRIPT (a mano, desde el editor). Solo lee nombres y tamanos de la carpeta FOLDER_ID; no abre los archivos. Devuelve el informe y lo deja en el Logger.
function auditarCarpetaItfLegacy() {
  var inicio = new Date().getTime();
  var carpeta = DriveApp.getFolderById(getFolderId());
  var archivos = carpeta.getFiles();
  var lista = [];
  var incompleto = false;
  while (archivos.hasNext()) {
    var f = archivos.next();
    lista.push({ nombre: f.getName(), bytes: f.getSize() });
    if (new Date().getTime() - inicio > ITF_AUDITORIA_MAX_MS) {
      incompleto = true;
      break;
    }
  }
  var informe = itfAuditoria_analizar(lista, { incompleto: incompleto });
  informe.duracionMs = new Date().getTime() - inicio;
  Logger.log(JSON.stringify(informe, null, 2));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_AUDITORIA_NOMBRE_REGEX,
    ITF_AUDITORIA_EJEMPLOS,
    ITF_AUDITORIA_MAX_MS,
    ITF_AUDITORIA_TRAMOS,
    itfAuditoria_pozoValido,
    itfAuditoria_percentil,
    itfAuditoria_analizar,
    auditarCarpetaItfLegacy
  };
}
