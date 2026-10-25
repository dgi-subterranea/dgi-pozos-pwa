// Logica PURA de presentacion de la "Linea de tiempo del pozo" (E6-3): del resultado del cargador (js/lineaTiempoPozoLoader.js) arma el MODELO DE VISTA que pinta el controlador DOM
// (js/lineaTiempoPozo.js): que se muestra (vacio / error total / lista), los filtros por fuente, los avisos de carga incompleta y los datos de cada evento listos para poner con textContent.
// Sin DOM, sin red, sin estado: se prueba con Jest (js/lineaTiempoPozoVistaLogic.test.js).
//
// REGLAS:
//   - El orden de los eventos es el que entrega el modelo (mas reciente primero): aca NUNCA se reordena; el filtro solo quita (funcion pura del modelo, inyectada como `filtrar`).
//   - Todo texto libre (detalle, nombre) viaja tal cual y se debe pintar SOLO con textContent. Las notas de un evento salen de una LISTA BLANCA de metadata (metodo, primera ubicacion, tipo de
//     fuente registral, motivo de reemplazo, estado actual): nunca se vuelca `metadata` generica, ni se muestran ids, claves crudas ni codigos tecnicos.
//   - Los avisos hablan de FUENTES en lenguaje simple. Nunca muestran codigos de error ni motivos tecnicos (CURSOR_REPETIDO, SERVICE_UNAVAILABLE...). SIN_PERMISO no se menciona (no se
//     dice que existe informacion oculta) y CANCELADA es un detalle interno que no se avisa.
//   - El aviso de carga incompleta es independiente del filtro elegido: filtrar no "arregla" lo que no se cargo.
//
// Dependencias de carga: ninguna (todo lo que necesita del resto de la app llega por `deps`: formatearFecha, etiquetaMotivo y filtrar).

var LINEA_TIEMPO_VISTA_TODAS = 'TODAS';
var LINEA_TIEMPO_VISTA_FUENTES = ['UBICACION', 'REEMPLAZO', 'OBSERVACIONES'];
var LINEA_TIEMPO_VISTA_CLAVE_FUENTE = { UBICACION: 'ubicacion', REEMPLAZO: 'reemplazo', OBSERVACIONES: 'observaciones' };
var LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE = { UBICACION: 'Ubicación', REEMPLAZO: 'Reemplazo', OBSERVACIONES: 'Observaciones' };

var LINEA_TIEMPO_VISTA_TEXTOS = {
  VACIO: 'Este pozo todavía no tiene eventos en la línea de tiempo.',
  ERROR_TOTAL: 'No se pudo cargar la línea de tiempo.',
  PARCIAL: 'Parte de la información no pudo cargarse.',
  LIMITE_OBSERVACIONES: 'Hay más observaciones antiguas que no se incluyeron en esta vista.',
  UBICACION_PARCIAL: 'Parte del historial de ubicación no pudo cargarse.',
  SIN_INFORMACION: 'No hay información disponible para mostrar.',
  SIN_EVENTOS_DISPONIBLES: 'No hay eventos disponibles para mostrar.',
  SIN_EVENTOS_FUENTE: 'No hay eventos de esta fuente.',
  TODAS: 'Todas'
};

var LINEA_TIEMPO_VISTA_ETIQUETA_METODO = {
  GPS_ACTUAL: 'GPS del dispositivo',
  PUNTO_EN_MAPA: 'Punto elegido en el mapa',
  COORDENADAS_GMS: 'Coordenadas GMS / WGS84',
  COORDENADAS_POSGAR94_AR2: 'Coordenadas POSGAR 94 / Argentina 2'
};
var LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE_PADRON = { REPORTE_POZOS: 'Reporte de pozos', IRRIGACION: 'Irrigación' };
// estado ACTUAL de una correccion de ubicacion, visto desde el evento de su propuesta
var LINEA_TIEMPO_VISTA_ESTADO_CORRECCION = {
  PROPUESTA: 'pendiente de validación',
  VALIDADA: 'validada en campo',
  RECHAZADA: 'rechazada',
  SUPERADA: 'reemplazada por otra ubicación',
  REVERTIDA: 'revertida'
};

function lineaTiempoPozoVista_tiene(objeto, clave) {
  return objeto !== null && typeof objeto === 'object' && Object.prototype.hasOwnProperty.call(objeto, clave);
}

function lineaTiempoPozoVista_etiquetaFuente(fuente) {
  return typeof fuente === 'string' && lineaTiempoPozoVista_tiene(LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE, fuente) ? LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE[fuente] : '';
}

// Estado de una fuente del resultado ('' si no existe).
function lineaTiempoPozoVista_estadoDe(resultado, fuente) {
  var clave = LINEA_TIEMPO_VISTA_CLAVE_FUENTE[fuente];
  return resultado && resultado.fuentes && resultado.fuentes[clave] && typeof resultado.fuentes[clave].estado === 'string' ? resultado.fuentes[clave].estado : '';
}

function lineaTiempoPozoVista_motivoDe(resultado, fuente) {
  var clave = LINEA_TIEMPO_VISTA_CLAVE_FUENTE[fuente];
  return resultado && resultado.fuentes && resultado.fuentes[clave] && typeof resultado.fuentes[clave].motivoParcial === 'string' ? resultado.fuentes[clave].motivoParcial : '';
}

// Una fuente "participa" si se intento cargar para este usuario: ni SIN_PERMISO (no existe para el) ni NO_CARGADA (carga cancelada / nunca pedida).
function lineaTiempoPozoVista_participa(resultado, fuente) {
  var estado = lineaTiempoPozoVista_estadoDe(resultado, fuente);
  return estado === 'OK' || estado === 'VACIA' || estado === 'ERROR' || estado === 'PARCIAL';
}

// Filtros por fuente: "Todas" mas una opcion por cada fuente que participa. Con menos de dos fuentes no hay nada que filtrar: lista vacia (la interfaz no muestra la barra).
function lineaTiempoPozoVista_filtros(resultado) {
  var fuentes = LINEA_TIEMPO_VISTA_FUENTES.filter(function (f) { return lineaTiempoPozoVista_participa(resultado, f); });
  if (fuentes.length < 2) {
    return [];
  }
  return [{ valor: LINEA_TIEMPO_VISTA_TODAS, etiqueta: LINEA_TIEMPO_VISTA_TEXTOS.TODAS }].concat(fuentes.map(function (f) {
    return { valor: f, etiqueta: LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE[f] };
  }));
}

// El filtro pedido si existe entre los disponibles; si no (o si no hay barra), "Todas".
function lineaTiempoPozoVista_filtroValido(filtros, valor) {
  return (filtros || []).some(function (f) { return f.valor === valor; }) ? valor : LINEA_TIEMPO_VISTA_TODAS;
}

// Avisos de carga incompleta, en orden: primero el general (si algo "no pudo cargarse") y despues una linea por fuente. Lista vacia si todo se cargo.
function lineaTiempoPozoVista_avisos(resultado) {
  var general = false;
  var lineas = [];
  var T = LINEA_TIEMPO_VISTA_TEXTOS;
  LINEA_TIEMPO_VISTA_FUENTES.forEach(function (fuente) {
    var estado = lineaTiempoPozoVista_estadoDe(resultado, fuente);
    var motivo = lineaTiempoPozoVista_motivoDe(resultado, fuente);
    var nombre = LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE[fuente];
    if (estado === 'ERROR') {
      general = true;
      lineas.push(nombre + ' no pudo cargarse.');
    } else if (estado === 'PARCIAL' && motivo === 'LIMIT_REACHED' && fuente === 'OBSERVACIONES') {
      lineas.push(T.LIMITE_OBSERVACIONES);                    // faltan datos antiguos: no es un fallo
    } else if (estado === 'PARCIAL' && motivo !== 'CANCELADA') {
      general = true;
      lineas.push(fuente === 'UBICACION' ? T.UBICACION_PARCIAL : nombre + ' no pudo cargarse por completo.');
    }
  });
  return (general ? [T.PARCIAL] : []).concat(lineas);
}

// Notas de un evento: SOLO lo que sale de las listas blancas de arriba. Un valor desconocido no se muestra (jamas se copia crudo).
function lineaTiempoPozoVista_notas(evento, deps) {
  var notas = [];
  var m = evento.metadata !== null && typeof evento.metadata === 'object' ? evento.metadata : {};
  var d = deps || {};
  if (evento.tipo === 'UBICACION_PROPUESTA') {
    if (lineaTiempoPozoVista_tiene(LINEA_TIEMPO_VISTA_ETIQUETA_METODO, m.metodo)) {
      notas.push('Método: ' + LINEA_TIEMPO_VISTA_ETIQUETA_METODO[m.metodo]);
    }
    if (lineaTiempoPozoVista_tiene(LINEA_TIEMPO_VISTA_ESTADO_CORRECCION, evento.estado)) {
      notas.push('Estado actual: ' + LINEA_TIEMPO_VISTA_ESTADO_CORRECCION[evento.estado]);
    }
  } else if (evento.tipo === 'UBICACION_VALIDADA') {
    if (m.primeraUbicacion === true) {
      notas.push('Primera ubicación del pozo');
    }
  } else if (typeof evento.tipo === 'string' && evento.tipo.indexOf('FUENTE_') === 0) {
    if (lineaTiempoPozoVista_tiene(LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE_PADRON, m.fuenteTipo)) {
      notas.push('Fuente: ' + LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE_PADRON[m.fuenteTipo]);
    }
    if (m.obsoleta === true) {
      notas.push('La fuente ya no figura en el padrón actual');
    }
  } else if (typeof evento.tipo === 'string' && evento.tipo.indexOf('REEMPLAZO_') === 0) {
    var etiqueta = typeof m.motivo === 'string' && typeof d.etiquetaMotivo === 'function' ? d.etiquetaMotivo(m.motivo) : '';
    if (typeof etiqueta === 'string' && etiqueta !== '' && etiqueta !== m.motivo) {            // un codigo sin etiqueta conocida no se muestra
      notas.push('Motivo: ' + etiqueta);
    }
  } else if (evento.tipo === 'OBSERVACION_AGREGADA') {
    if (evento.estado === 'ANULADA') {
      notas.push('Estado actual: anulada');
    }
  }
  return notas;
}

// Un evento del modelo -> {fuente, fuenteEtiqueta, titulo, fecha, instante, nombre, detalle, notas}. `fecha` ya viene formateada (el modelo entrega el instante UTC canonico; aca no se parsea
// ningun formato de fuente). `instante` es ese mismo ISO canonico, para el atributo datetime. No incluye id, estado crudo ni metadata.
function lineaTiempoPozoVista_item(evento, deps) {
  var d = deps || {};
  return {
    fuente: evento.fuente,
    fuenteEtiqueta: lineaTiempoPozoVista_etiquetaFuente(evento.fuente),
    titulo: String(evento.titulo),
    fecha: typeof d.formatearFecha === 'function' ? d.formatearFecha(evento.timestamp) : '',
    instante: evento.timestamp,
    nombre: String(evento.nombre),
    detalle: typeof evento.detalle === 'string' && evento.detalle !== '' ? evento.detalle : null,
    notas: lineaTiempoPozoVista_notas(evento, d)
  };
}

// Modelo de vista completo.
//   resultado: lo que devuelve el cargador (ya vigente y sin auth).  filtro: 'TODAS' o una fuente.  deps: {formatearFecha(iso), etiquetaMotivo(codigo), filtrar(eventos, fuente)}.
// -> {tipo: 'VACIO' | 'ERROR_TOTAL' | 'LISTA', mensaje, filtros, filtro, avisos, items}
//   VACIO: nada que mostrar y no hay motivo para dudar (todo cargo sin eventos, o ninguna fuente participa: no se dice que haya informacion oculta).
//   ERROR_TOTAL: no hay eventos y no se pudo cargar nada util (completa=false y parcial=false).
//   LISTA: hay eventos o carga incompleta con informacion util; `mensaje` explica una lista vacia por filtro o por carga incompleta.
function lineaTiempoPozoVista_modelo(resultado, filtro, deps) {
  var T = LINEA_TIEMPO_VISTA_TEXTOS;
  var base = { tipo: 'VACIO', mensaje: T.VACIO, filtros: [], filtro: LINEA_TIEMPO_VISTA_TODAS, avisos: [], items: [] };
  if (resultado === null || typeof resultado !== 'object' || !Array.isArray(resultado.eventos) || resultado.fuentes === null || typeof resultado.fuentes !== 'object') {
    base.tipo = 'ERROR_TOTAL';
    base.mensaje = T.ERROR_TOTAL;
    return base;
  }
  var participan = LINEA_TIEMPO_VISTA_FUENTES.filter(function (f) { return lineaTiempoPozoVista_participa(resultado, f); });
  if (participan.length === 0) {
    // ninguna fuente se pudo leer (p. ej. el backend las denego todas): NO se afirma que el pozo no tenga eventos, ni se menciona el permiso ni se sugiere que haya datos ocultos
    base.mensaje = T.SIN_INFORMACION;
    return base;
  }
  if (resultado.eventos.length === 0) {
    if (resultado.completa === true) {
      return base;
    }
    if (resultado.parcial !== true) {
      base.tipo = 'ERROR_TOTAL';
      base.mensaje = T.ERROR_TOTAL;
      return base;
    }
  }
  var d = deps || {};
  var filtros = lineaTiempoPozoVista_filtros(resultado);
  var elegido = lineaTiempoPozoVista_filtroValido(filtros, filtro);
  var visibles = elegido === LINEA_TIEMPO_VISTA_TODAS || typeof d.filtrar !== 'function' ? resultado.eventos : d.filtrar(resultado.eventos, elegido);
  var items = visibles.map(function (e) { return lineaTiempoPozoVista_item(e, d); });
  var mensaje = null;
  if (items.length === 0) {
    mensaje = elegido === LINEA_TIEMPO_VISTA_TODAS ? T.SIN_EVENTOS_DISPONIBLES : T.SIN_EVENTOS_FUENTE;
  }
  return { tipo: 'LISTA', mensaje: mensaje, filtros: filtros, filtro: elegido, avisos: lineaTiempoPozoVista_avisos(resultado), items: items };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LINEA_TIEMPO_VISTA_TODAS,
    LINEA_TIEMPO_VISTA_TEXTOS,
    LINEA_TIEMPO_VISTA_ETIQUETA_FUENTE,
    lineaTiempoPozoVista_etiquetaFuente,
    lineaTiempoPozoVista_participa,
    lineaTiempoPozoVista_filtros,
    lineaTiempoPozoVista_filtroValido,
    lineaTiempoPozoVista_avisos,
    lineaTiempoPozoVista_notas,
    lineaTiempoPozoVista_item,
    lineaTiempoPozoVista_modelo
  };
}
