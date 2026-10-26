// Exportacion de "Mi seleccion" a XLSX (E7): modelo PURO (sin DOM, sin red, sin descarga, sin permisos propios). Arma, a partir de lo que la tabla de Mi seleccion ya muestra, las columnas,
// las filas tipadas, la hoja "Informacion" y el nombre de archivo; el escritor del archivo es js/xlsxLogic.js. Documento de diseno: docs/exportacion-seleccion.md.
//
// DATOS: solo operativos y tecnicos. NUNCA titular, NC16, domicilios, nombres de agentes, emails, observaciones libres, ids internos, secuencias ni ids de Drive: las filas se arman campo por campo
// desde una lista cerrada (EXPORTACION_SELECCION_COLUMNAS); un campo extra en los datasets no tiene por donde entrar.
//
// PERMISOS (fail-closed): una columna condicionada existe SOLO si su permiso es exactamente el booleano `true` (ni "SI", ni 1, ni objetos). Sin permiso la columna NO EXISTE: no hay columna
// vacia, ni "—", ni "sin permiso". Permisos: ubicacion -> estado + latitud + longitud; perfil -> tiene ITF; ne -> tiene NE; reemplazo -> aptitud.
//
// VALORES: celda vacia = no se sabe (dataset no cargado, lote ITF que fallo, pozo sin dato). Solo se escribe "No"/"Sin evaluar" cuando el origen lo afirma.
//
// ORDEN Y FILTROS: la exportacion recibe los wellId YA filtrados y ordenados por la tabla (seleccionLogic_filtrarYOrdenarFilas, la misma logica que dibuja la tabla) y NO reordena nada.
//
// Dependencias (globales en el navegador; los tests las instalan): mapaLogic_nombreDepartamento, mapaLogic_textoEstadoUbicacion, reemplazoResumenLogic_*, REEMPLAZO_RESUMEN_ESTADOS,
// SELECCION_ETIQUETAS_TIPO_POZO, XLSX_ESTILOS.

var EXPORTACION_SELECCION_ORIGEN = 'Mi selección';
var EXPORTACION_SELECCION_HOJA_POZOS = 'Pozos';
var EXPORTACION_SELECCION_HOJA_INFORMACION = 'Información';
var EXPORTACION_SELECCION_ZONA_HORARIA = 'America/Argentina/Mendoza';
var EXPORTACION_SELECCION_MAX_BUSQUEDA = 200;

// Columnas, en el orden del archivo. permiso: null = siempre; si no, nombre del permiso que la habilita. tipo: 'texto' | 'numero' | 'coordenada'.
var EXPORTACION_SELECCION_COLUMNAS = [
  { clave: 'wellId', encabezado: 'Pozo', permiso: null, tipo: 'texto', ancho: 12 },
  { clave: 'departamento', encabezado: 'Departamento', permiso: null, tipo: 'texto', ancho: 18 },
  { clave: 'cuenca', encabezado: 'Cuenca', permiso: null, tipo: 'texto', ancho: 22 },
  { clave: 'profundidad_m', encabezado: 'Profundidad (m)', permiso: null, tipo: 'numero', ancho: 16 },
  { clave: 'tipo_pozo', encabezado: 'Tipo de pozo', permiso: null, tipo: 'texto', ancho: 14 },
  { clave: 'estado_ubicacion', encabezado: 'Estado de ubicación', permiso: 'ubicacion', tipo: 'texto', ancho: 24 },
  { clave: 'latitud', encabezado: 'Latitud', permiso: 'ubicacion', tipo: 'coordenada', ancho: 13 },
  { clave: 'longitud', encabezado: 'Longitud', permiso: 'ubicacion', tipo: 'coordenada', ancho: 13 },
  { clave: 'tiene_itf', encabezado: 'Tiene ITF', permiso: 'perfil', tipo: 'texto', ancho: 11 },
  { clave: 'tiene_ne', encabezado: 'Tiene NE', permiso: 'ne', tipo: 'texto', ancho: 11 },
  { clave: 'aptitud_reemplazo', encabezado: 'Aptitud para reemplazo', permiso: 'reemplazo', tipo: 'texto', ancho: 24 }
];

var EXPORTACION_SELECCION_ETIQUETAS_ORDEN = {
  wellId: 'Pozo',
  departamento: 'Departamento',
  cuenca: 'Cuenca',
  profundidad: 'Profundidad (mayor a menor)'
};

var EXPORTACION_SELECCION_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Columnas que corresponden a estos permisos (solo `=== true`). permisos ausente o invalido -> solo las siempre presentes.
function exportacionSeleccion_columnasPara(permisos) {
  var p = permisos || {};                               // solo cuenta p[permiso] === true: un texto, un numero o un arreglo no tienen esas propiedades
  return EXPORTACION_SELECCION_COLUMNAS.filter(function (c) {
    return c.permiso === null || p[c.permiso] === true;
  });
}

function exportacionSeleccion_textoSeguro(valor) {
  if (typeof valor === 'string') {
    return valor.trim();
  }
  if (typeof valor === 'number' && isFinite(valor)) {
    return String(valor);
  }
  return '';
}

function exportacionSeleccion_numeroOVacio(valor) {
  return typeof valor === 'number' && isFinite(valor) ? valor : null;
}

function exportacionSeleccion_siNo(valor) {
  return valor === true ? 'Sí' : (valor === false ? 'No' : '');
}

// Fila de un pozo, SOLO con las claves de las columnas incluidas. Valores: texto / numero / '' (vacio).
// ctx: {indicePozos, neSet, itf, itfDesconocidos (Set | null), resumenReemplazo}; ver exportacionSeleccion_construirLibro.
function exportacionSeleccion_construirFila(wellId, columnas, ctx) {
  var indice = ctx.indicePozos !== null && typeof ctx.indicePozos === 'object' ? ctx.indicePozos : null;
  var punto = indice !== null && indice[wellId] !== null && typeof indice[wellId] === 'object' ? indice[wellId] : null;
  var fila = {};
  columnas.forEach(function (c) {
    var v = '';
    if (c.clave === 'wellId') {
      v = String(wellId);
    } else if (c.clave === 'departamento') {
      v = exportacionSeleccion_textoSeguro(mapaLogic_nombreDepartamento(String(wellId).substring(0, 2)));
    } else if (c.clave === 'cuenca') {
      v = punto ? exportacionSeleccion_textoSeguro(punto.cuenca) : '';
    } else if (c.clave === 'profundidad_m') {
      v = punto ? exportacionSeleccion_numeroOVacio(punto.profundidad) : null;
    } else if (c.clave === 'tipo_pozo') {
      v = punto && punto.surgencia ? exportacionSeleccion_textoSeguro(SELECCION_ETIQUETAS_TIPO_POZO[punto.surgencia] || punto.surgencia) : '';
    } else if (c.clave === 'estado_ubicacion') {
      // dataset cargado y pozo ausente -> "Sin ubicación operativa"; dataset no cargado -> '—' en la tabla, aca celda vacia
      var texto = mapaLogic_textoEstadoUbicacion(punto || undefined, indice !== null);
      v = texto === '—' ? '' : texto;
    } else if (c.clave === 'latitud') {
      v = punto ? exportacionSeleccion_numeroOVacio(punto.lat) : null;
    } else if (c.clave === 'longitud') {
      v = punto ? exportacionSeleccion_numeroOVacio(punto.lon) : null;
    } else if (c.clave === 'tiene_itf') {
      // sin datos de disponibilidad, o pozo de un lote que fallo -> vacio (NUNCA "No"); solo un booleano afirmado por el backend da Si / No
      var itf = ctx.itf;
      v = !itf || !itf.disponibilidad || ctx.itfDesconocidos === null || ctx.itfDesconocidos.has(wellId) ? '' : exportacionSeleccion_siNo(itf.disponibilidad[wellId]);
    } else if (c.clave === 'tiene_ne') {
      v = ctx.neSet instanceof Set ? exportacionSeleccion_siNo(ctx.neSet.has(wellId)) : '';
    } else if (c.clave === 'aptitud_reemplazo') {
      var estadoApt = ctx.resumenReemplazo ? reemplazoResumenLogic_estadoDe(ctx.resumenReemplazo, wellId) : null;
      v = estadoApt === null ? '' : reemplazoResumenLogic_etiqueta(estadoApt);
    }
    fila[c.clave] = v;
  });
  return fila;
}

// "2026-05" -> "mayo 2026"; cualquier otra cosa -> null.
function exportacionSeleccion_formatearPeriodo(periodo) {
  if (typeof periodo !== 'string') {
    return null;
  }
  var m = /^(\d{4})-(\d{2})$/.exec(periodo.trim());
  var mes = m ? EXPORTACION_SELECCION_MESES[parseInt(m[2], 10) - 1] : undefined;
  return mes ? mes + ' ' + m[1] : null;
}

function exportacionSeleccion_dos(n) {
  return n < 10 ? '0' + n : String(n);
}

// Partes de fecha/hora en Mendoza (Intl; si falta, UTC-3 fijo: Argentina no usa horario de verano).
function exportacionSeleccion_partesMendoza(ahora) {
  var fecha = ahora instanceof Date && !isNaN(ahora.getTime()) ? ahora : new Date();
  try {
    var f = new Intl.DateTimeFormat('en-CA', {
      timeZone: EXPORTACION_SELECCION_ZONA_HORARIA, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    var out = {};
    f.formatToParts(fecha).forEach(function (p) { out[p.type] = p.value; });
    if (out.year && out.month && out.day && out.hour && out.minute && out.second) {
      return out;
    }
  } catch (e) { /* cae al respaldo */ }
  var d = new Date(fecha.getTime() - 3 * 3600 * 1000);
  return {
    year: String(d.getUTCFullYear()), month: exportacionSeleccion_dos(d.getUTCMonth() + 1), day: exportacionSeleccion_dos(d.getUTCDate()),
    hour: exportacionSeleccion_dos(d.getUTCHours()), minute: exportacionSeleccion_dos(d.getUTCMinutes()), second: exportacionSeleccion_dos(d.getUTCSeconds())
  };
}

// dgi-pozos-seleccion-YYYY-MM-DD.xlsx con la fecha de Mendoza. Sin cantidades, wellId, usuario ni filtros.
function exportacionSeleccion_nombreArchivo(ahora) {
  var p = exportacionSeleccion_partesMendoza(ahora);
  return 'dgi-pozos-seleccion-' + p.year + '-' + p.month + '-' + p.day + '.xlsx';
}

function exportacionSeleccion_fechaHoraMendoza(ahora) {
  var p = exportacionSeleccion_partesMendoza(ahora);
  return p.year + '-' + p.month + '-' + p.day + ' ' + p.hour + ':' + p.minute + ':' + p.second + ' (Mendoza, UTC-3)';
}

function exportacionSeleccion_fechaHoraUtc(ahora) {
  var fecha = ahora instanceof Date && !isNaN(ahora.getTime()) ? ahora : new Date();
  return fecha.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Filtro de aptitud realmente activo -> "Apto, Dudoso" (orden canonico) o null. Solo cuenta con permiso reemplazo === true.
function exportacionSeleccion_textoFiltroAptitud(permisos, filtros) {
  var activos = filtros && filtros.aptitudActivos;
  if (!permisos || permisos.reemplazo !== true || !activos || !reemplazoResumenLogic_hayActivos(activos)) {
    return null;
  }
  var nombres = REEMPLAZO_RESUMEN_ESTADOS.filter(function (e) { return activos[e] === true; }).map(reemplazoResumenLogic_etiqueta);
  return nombres.length > 0 ? nombres.join(', ') : null;
}

// Filas [clave, valor] de la hoja "Informacion". Solo describe lo que de verdad esta activo; nada de usuario, email, token ni ids.
function exportacionSeleccion_construirInformacion(datos) {
  var d = datos || {};
  var filtros = d.filtros || {};
  var texto = typeof filtros.texto === 'string' ? filtros.texto.trim() : '';
  if (texto.length > EXPORTACION_SELECCION_MAX_BUSQUEDA) {
    texto = texto.substring(0, EXPORTACION_SELECCION_MAX_BUSQUEDA);
  }
  var aptitud = exportacionSeleccion_textoFiltroAptitud(d.permisos, filtros);
  var cantidad = d.filas.length;
  var pares = [
    ['Generado (Mendoza)', exportacionSeleccion_fechaHoraMendoza(d.ahora)],
    ['Generado (UTC)', exportacionSeleccion_fechaHoraUtc(d.ahora)],
    ['Cantidad de pozos', cantidad]
  ];
  if ((texto !== '' || aptitud !== null) && typeof d.totalSeleccion === 'number') {
    pares.push(['Pozos en la selección (sin filtrar)', d.totalSeleccion]);
  }
  var periodo = exportacionSeleccion_formatearPeriodo(d.periodoPadron);
  if (periodo !== null) {
    pares.push(['Período del padrón', periodo]);
  }
  pares.push(['Origen', EXPORTACION_SELECCION_ORIGEN]);
  if (texto !== '') {
    pares.push(['Búsqueda aplicada', texto]);
  }
  if (aptitud !== null) {
    pares.push(['Filtro de aptitud', aptitud]);
  }
  pares.push(['Orden actual', EXPORTACION_SELECCION_ETIQUETAS_ORDEN[filtros.orden] || EXPORTACION_SELECCION_ETIQUETAS_ORDEN.wellId]);
  pares.push(['Columnas incluidas', d.columnas.map(function (c) { return c.encabezado; }).join(', ')]);
  return pares;
}

// Hoja "Pozos": encabezado en negrita, primera fila congelada, autofiltro, anchos razonables; lat/lon con formato 0.000000.
function exportacionSeleccion_construirHojaPozos(columnas, filas) {
  var encabezado = columnas.map(function (c) { return { texto: c.encabezado, estilo: XLSX_ESTILOS.encabezado }; });
  var cuerpo = filas.map(function (fila) {
    return columnas.map(function (c) {
      var v = fila[c.clave];
      if (c.tipo === 'coordenada' && typeof v === 'number') {
        return { numero: v, estilo: XLSX_ESTILOS.coordenada };
      }
      return v;
    });
  });
  return {
    nombre: EXPORTACION_SELECCION_HOJA_POZOS,
    filas: [encabezado].concat(cuerpo),
    anchos: columnas.map(function (c) { return c.ancho; }),
    congelarPrimeraFila: true,
    autofiltro: true
  };
}

function exportacionSeleccion_construirHojaInformacion(pares) {
  var encabezado = [{ texto: 'Dato', estilo: XLSX_ESTILOS.encabezado }, { texto: 'Valor', estilo: XLSX_ESTILOS.encabezado }];
  return {
    nombre: EXPORTACION_SELECCION_HOJA_INFORMACION,
    filas: [encabezado].concat(pares.map(function (par) { return [par[0], par[1]]; })),
    anchos: [34, 60],
    congelarPrimeraFila: true,
    autofiltro: false
  };
}

// Modelo completo de la exportacion.
//   wellIds           -> los de la tabla, YA filtrados y ordenados (se exportan en ese orden exacto)
//   totalSeleccion    -> cantidad de la seleccion sin filtrar (solo se informa si hay busqueda o filtro)
//   permisos          -> {ubicacion, perfil, ne, reemplazo} (solo `true` habilita)
//   indicePozos       -> {wellId: punto} del dataset operativo, o null si no se cargo
//   neSet             -> Set de wellId con NE, o null si no se cargo
//   itf               -> {disponibilidad: {wellId: bool}, desconocidos: [wellId]} o null
//   resumenReemplazo  -> {wellId: estado} o null
//   filtros           -> {texto, orden, aptitudActivos}
//   periodoPadron     -> "AAAA-MM" o null
//   ahora             -> Date inyectable
// Devuelve {nombreArchivo, columnas, filas, informacion, libro}.
function exportacionSeleccion_construirLibro(datos) {
  var d = datos || {};
  var columnas = exportacionSeleccion_columnasPara(d.permisos);
  var ctx = {
    indicePozos: d.indicePozos || null,
    neSet: d.neSet || null,
    itf: d.itf || null,
    itfDesconocidos: d.itf && Array.isArray(d.itf.desconocidos) ? new Set(d.itf.desconocidos) : null,
    resumenReemplazo: d.resumenReemplazo || null
  };
  var filas = (d.wellIds || []).map(function (wellId) { return exportacionSeleccion_construirFila(wellId, columnas, ctx); });
  var informacion = exportacionSeleccion_construirInformacion({
    ahora: d.ahora, filas: filas, columnas: columnas, permisos: d.permisos, filtros: d.filtros,
    totalSeleccion: d.totalSeleccion, periodoPadron: d.periodoPadron
  });
  return {
    nombreArchivo: exportacionSeleccion_nombreArchivo(d.ahora),
    columnas: columnas,
    filas: filas,
    informacion: informacion,
    libro: { hojas: [exportacionSeleccion_construirHojaPozos(columnas, filas), exportacionSeleccion_construirHojaInformacion(informacion)] }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    EXPORTACION_SELECCION_COLUMNAS,
    EXPORTACION_SELECCION_ORIGEN,
    EXPORTACION_SELECCION_HOJA_POZOS,
    EXPORTACION_SELECCION_HOJA_INFORMACION,
    EXPORTACION_SELECCION_MAX_BUSQUEDA,
    exportacionSeleccion_columnasPara,
    exportacionSeleccion_construirFila,
    exportacionSeleccion_formatearPeriodo,
    exportacionSeleccion_nombreArchivo,
    exportacionSeleccion_fechaHoraMendoza,
    exportacionSeleccion_fechaHoraUtc,
    exportacionSeleccion_textoFiltroAptitud,
    exportacionSeleccion_construirInformacion,
    exportacionSeleccion_construirHojaPozos,
    exportacionSeleccion_construirHojaInformacion,
    exportacionSeleccion_construirLibro
  };
}
