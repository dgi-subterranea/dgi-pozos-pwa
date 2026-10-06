// ReemplazoService: logica de negocio del modulo Reemplazos v1 (evaluacion
// de aptitud de un pozo candidato). No sabe nada de HTTP (Api.js) ni de
// Sheets (ReemplazoRepository.js). Toda la validacion vive ACA, en el
// backend - el frontend repite las reglas solo para guiar al usuario, el
// backend nunca confia en eso.
//
// Modelo:
//  - Estados validos: APTO | NO_APTO | DUDOSO. SIN_EVALUAR es IMPLICITO
//    (un pozo sin ninguna evaluacion) - nunca se escribe como fila.
//  - Estado actual = la ultima evaluacion cronologicamente VALIDA del
//    pozo (timestamp valido y estado del catalogo); las filas corruptas
//    (editadas a mano) se ignoran en vez de romper el modulo.
//  - Historial append-only: este servicio solo sabe crear filas nuevas.
var REEMPLAZO_ESTADOS = ['APTO', 'NO_APTO', 'DUDOSO'];
var REEMPLAZO_ESTADO_IMPLICITO = 'SIN_EVALUAR';

var REEMPLAZO_MOTIVOS = [
  'SIN_ACCESO',
  'PROPIETARIO_NO_AUTORIZA',
  'POZO_NO_LOCALIZADO',
  'POZO_CEGADO',
  'POZO_OBSTRUIDO',
  'INSTALACION_IMPIDE_MEDICION',
  'SECO',
  'CONDICION_INSEGURA',
  'NO_REPRESENTATIVO',
  'APTO_SIN_OBSERVACIONES',
  'OTRO'
];

// Reglas estado/motivo (decision de producto, ver
// reemplazoService_validarEvaluacion):
//  - APTO: motivo opcional; solo APTO_SIN_OBSERVACIONES u OTRO.
//  - DUDOSO: motivo obligatorio y solo los que dejan la duda abierta
//    (sin acceso, propietario, no localizado, instalacion, no
//    representativo, otro). Las condiciones fisicamente concluyentes
//    (cegado, obstruido, seco, condicion insegura) NO se aceptan.
//  - NO_APTO: motivo obligatorio, cualquier motivo negativo del catalogo
//    (todos menos APTO_SIN_OBSERVACIONES).
//  - OTRO siempre exige observacion.
var REEMPLAZO_MOTIVOS_POR_ESTADO = {
  APTO: ['APTO_SIN_OBSERVACIONES', 'OTRO'],
  DUDOSO: ['SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'INSTALACION_IMPIDE_MEDICION', 'NO_REPRESENTATIVO', 'OTRO'],
  NO_APTO: [
    'SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'POZO_CEGADO', 'POZO_OBSTRUIDO',
    'INSTALACION_IMPIDE_MEDICION', 'SECO', 'CONDICION_INSEGURA', 'NO_REPRESENTATIVO', 'OTRO'
  ]
};
// Nombre que se muestra cuando la hoja Usuarios no tiene nombre: nunca el
// email (el email queda en la hoja solo por trazabilidad interna).
var REEMPLAZO_NOMBRE_NEUTRO = 'Usuario';
var REEMPLAZO_OBSERVACION_MAX = 1000;
var REEMPLAZO_PUNTO_NE_MAX = 40;
// "Formato razonable" del punto NE de referencia: wellId (DD-PPPP) o un
// monitoringId especial ("INA 2055", "6 RTR7") - letras, digitos, espacio
// y . - _ / ; nunca se inventa un DD-PPPP para un punto especial.
var REEMPLAZO_PUNTO_NE_REGEX = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .\-_\/]*$/;

function reemplazoService_error(code, message) {
  return { ok: false, code: code, message: message };
}

// Valida y normaliza el contenido de una evaluacion nueva. Devuelve
// {ok:true, valores:{estado,motivo,observacion,puntoNEReferencia}} o
// {ok:false, code, message}. NO valida wellId ni identidad (eso es de
// Api.js: la identidad sale de la sesion, nunca de aca).
function reemplazoService_validarEvaluacion(estado, motivo, observacion, puntoNEReferencia) {
  if (typeof estado !== 'string' || REEMPLAZO_ESTADOS.indexOf(estado) < 0) {
    return reemplazoService_error('INVALID_ESTADO', 'estado fuera del catalogo');
  }

  var motivoNormalizado = (motivo === null || motivo === undefined) ? '' : motivo;
  if (typeof motivoNormalizado !== 'string') {
    return reemplazoService_error('INVALID_MOTIVO', 'motivo invalido');
  }
  if (motivoNormalizado !== '' && REEMPLAZO_MOTIVOS.indexOf(motivoNormalizado) < 0) {
    return reemplazoService_error('INVALID_MOTIVO', 'motivo fuera del catalogo');
  }

  // APTO: el motivo es opcional (vacio vale), pero si viene debe ser uno
  // de los suyos. NO_APTO / DUDOSO: motivo obligatorio y del catalogo de
  // ese estado. El estado lo decide el tecnico: el motivo nunca lo infiere.
  if (motivoNormalizado === '') {
    if (estado !== 'APTO') {
      return reemplazoService_error('MOTIVO_REQUERIDO', estado + ' requiere un motivo');
    }
  } else if (REEMPLAZO_MOTIVOS_POR_ESTADO[estado].indexOf(motivoNormalizado) < 0) {
    return reemplazoService_error('ESTADO_MOTIVO_INCOMPATIBLE', 'el motivo ' + motivoNormalizado + ' no es compatible con ' + estado);
  }

  var obs = (observacion === null || observacion === undefined) ? '' : observacion;
  if (typeof obs !== 'string') {
    return reemplazoService_error('INVALID_OBSERVACION', 'observacion invalida');
  }
  obs = obs.trim();
  if (obs.length > REEMPLAZO_OBSERVACION_MAX) {
    return reemplazoService_error('INVALID_OBSERVACION', 'observacion demasiado larga (maximo ' + REEMPLAZO_OBSERVACION_MAX + ')');
  }
  if (motivoNormalizado === 'OTRO' && obs === '') {
    return reemplazoService_error('OBSERVACION_REQUERIDA', 'el motivo OTRO requiere observacion');
  }

  var punto = (puntoNEReferencia === null || puntoNEReferencia === undefined) ? '' : puntoNEReferencia;
  if (typeof punto !== 'string') {
    return reemplazoService_error('INVALID_PUNTO_NE', 'puntoNEReferencia invalido');
  }
  punto = punto.trim();
  if (punto !== '' && (punto.length > REEMPLAZO_PUNTO_NE_MAX || !REEMPLAZO_PUNTO_NE_REGEX.test(punto))) {
    return reemplazoService_error('INVALID_PUNTO_NE', 'puntoNEReferencia con formato invalido');
  }

  return {
    ok: true,
    valores: { estado: estado, motivo: motivoNormalizado, observacion: obs, puntoNEReferencia: punto }
  };
}

// Forma que sale hacia el frontend: sin nada propio de Sheets (filas,
// formatos) y SIN email del evaluador (queda en la hoja para trazabilidad;
// la UI solo muestra el nombre, o "Usuario" si no hay). Un campo vacio
// sale como null.
function reemplazoService_sanitizar(ev) {
  return {
    evaluacionId: ev.evaluacionId,
    wellId: ev.wellId,
    timestamp: ev.timestamp,
    nombre: ev.nombre || REEMPLAZO_NOMBRE_NEUTRO,
    estado: ev.estado,
    motivo: ev.motivo || null,
    observacion: ev.observacion || null,
    puntoNEReferencia: ev.puntoNEReferencia || null
  };
}

function reemplazoService_esValida(ev) {
  return !!ev && !!ev.timestamp && REEMPLAZO_ESTADOS.indexOf(ev.estado) >= 0;
}

// Evaluaciones validas, mas reciente primero. Orden estable: ante el MISMO
// timestamp gana la fila mas abajo en la hoja (la escrita despues).
function reemplazoService_ordenarDescendente(evaluaciones) {
  return (evaluaciones || [])
    .map(function (ev, i) { return { ev: ev, i: i }; })
    .filter(function (x) { return reemplazoService_esValida(x.ev); })
    .sort(function (a, b) {
      var diff = new Date(b.ev.timestamp).getTime() - new Date(a.ev.timestamp).getTime();
      return diff !== 0 ? diff : b.i - a.i;
    })
    .map(function (x) { return reemplazoService_sanitizar(x.ev); });
}

function reemplazoService_calcularEstado(wellId, evaluaciones) {
  var ordenadas = reemplazoService_ordenarDescendente(evaluaciones);
  if (ordenadas.length === 0) {
    return { wellId: wellId, estado: REEMPLAZO_ESTADO_IMPLICITO, ultimaEvaluacion: null };
  }
  return { wellId: wellId, estado: ordenadas[0].estado, ultimaEvaluacion: ordenadas[0] };
}

function reemplazoService_getEstado(wellId) {
  return reemplazoService_calcularEstado(wellId, reemplazoRepository_listarPorWellId(wellId));
}

function reemplazoService_getHistorial(wellId) {
  return { wellId: wellId, evaluaciones: reemplazoService_ordenarDescendente(reemplazoRepository_listarPorWellId(wellId)) };
}

// --- Resumen del mapa: wellId -> estado actual (solo pozos evaluados) ---
// Lo consumen el mapa Provincia, Cerca Mio y Mi seleccion. SOLO wellId y
// estado: nada de email, nombre, motivo, observacion, fotos, ids ni
// timestamps. Los pozos ausentes son SIN_EVALUAR (no se devuelven 13.804
// entradas de "SIN_EVALUAR"). Mismo criterio de "estado actual" que
// getEstadoReemplazo: ultima evaluacion VALIDA por timestamp, y ante empate
// la fila escrita despues; filas corruptas se ignoran.
var REEMPLAZO_WELLID_REGEX = /^\d{2}-\d{4}$/;
var REEMPLAZO_RESUMEN_CACHE_KEY = 'reemplazo_resumen_v1';
var REEMPLAZO_RESUMEN_CACHE_SEG = 180;       // pocos minutos; se invalida al registrar
var REEMPLAZO_RESUMEN_CACHE_MAX_CHARS = 95000; // CacheService: 100 KB por valor

function reemplazoService_calcularResumen(evaluaciones) {
  var ultimo = {}; // wellId -> {estado, t, i}
  (evaluaciones || []).forEach(function (ev, i) {
    if (!ev || !REEMPLAZO_WELLID_REGEX.test(ev.wellId) || !reemplazoService_esValida(ev)) {
      return;
    }
    var t = new Date(ev.timestamp).getTime();
    var previo = ultimo[ev.wellId];
    if (!previo || t > previo.t || (t === previo.t && i > previo.i)) {
      ultimo[ev.wellId] = { estado: ev.estado, t: t, i: i };
    }
  });
  var resumen = {};
  Object.keys(ultimo).forEach(function (wellId) {
    resumen[wellId] = ultimo[wellId].estado;
  });
  return resumen;
}

// Forma compacta para el cache (arrays de wellId por estado: ~10 bytes por
// pozo en vez de ~20) y su inversa.
function reemplazoService_comprimirResumen(resumen) {
  var porEstado = {};
  REEMPLAZO_ESTADOS.forEach(function (e) { porEstado[e] = []; });
  Object.keys(resumen).forEach(function (wellId) {
    porEstado[resumen[wellId]].push(wellId);
  });
  return JSON.stringify(porEstado);
}

function reemplazoService_expandirResumen(texto) {
  var porEstado = JSON.parse(texto);
  var resumen = {};
  REEMPLAZO_ESTADOS.forEach(function (estado) {
    (porEstado[estado] || []).forEach(function (wellId) {
      if (REEMPLAZO_WELLID_REGEX.test(wellId)) {
        resumen[wellId] = estado;
      }
    });
  });
  return resumen;
}

// Cache de script de pocos minutos (compartido entre usuarios: el resumen
// no es por usuario; el PERMISO se valida en Api.js antes de llegar aca).
// Un fallo del cache nunca rompe la consulta: se lee la hoja.
function reemplazoService_getResumenMapa() {
  var cache = CacheService.getScriptCache();
  try {
    var guardado = cache.get(REEMPLAZO_RESUMEN_CACHE_KEY);
    if (guardado !== null) {
      return reemplazoService_expandirResumen(guardado);
    }
  } catch (err) {
    // cache corrupto o no disponible: se recalcula
  }
  var resumen = reemplazoService_calcularResumen(reemplazoRepository_listarParaResumen());
  try {
    var texto = reemplazoService_comprimirResumen(resumen);
    if (texto.length <= REEMPLAZO_RESUMEN_CACHE_MAX_CHARS) {
      cache.put(REEMPLAZO_RESUMEN_CACHE_KEY, texto, REEMPLAZO_RESUMEN_CACHE_SEG);
    }
  } catch (err) {
    // sin cache esta vez
  }
  return resumen;
}

function reemplazoService_invalidarResumen() {
  try {
    CacheService.getScriptCache().remove(REEMPLAZO_RESUMEN_CACHE_KEY);
  } catch (err) {
    // el cache vence solo en pocos minutos
  }
}

// email/nombre llegan SIEMPRE de la sesion (Api.js) - este servicio nunca
// los toma de datos del cliente. timestamp e evaluacionId los genera el
// backend. Devuelve {ok:true, evaluacion} o {ok:false, code, message}.
function reemplazoService_registrar(email, nombre, wellId, datos) {
  var d = datos || {};
  var validacion = reemplazoService_validarEvaluacion(d.estado, d.motivo, d.observacion, d.puntoNEReferencia);
  if (!validacion.ok) {
    return validacion;
  }
  var v = validacion.valores;
  var evaluacion = {
    timestamp: new Date(),
    evaluacionId: Utilities.getUuid(),
    wellId: wellId,
    email: email,
    nombre: nombre || '',
    estado: v.estado,
    motivo: v.motivo,
    observacion: v.observacion,
    puntoNEReferencia: v.puntoNEReferencia
  };
  reemplazoRepository_agregar(evaluacion);
  // La evaluacion nueva cambia el estado actual del pozo: el resumen
  // cacheado queda viejo, se descarta ya (no espera al vencimiento).
  reemplazoService_invalidarResumen();
  return {
    ok: true,
    evaluacion: reemplazoService_sanitizar({
      evaluacionId: evaluacion.evaluacionId,
      wellId: wellId,
      timestamp: evaluacion.timestamp.toISOString(),
      nombre: nombre || '',
      estado: v.estado,
      motivo: v.motivo,
      observacion: v.observacion,
      puntoNEReferencia: v.puntoNEReferencia
    })
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REEMPLAZO_ESTADOS,
    REEMPLAZO_MOTIVOS,
    reemplazoService_validarEvaluacion,
    reemplazoService_sanitizar,
    reemplazoService_ordenarDescendente,
    reemplazoService_calcularEstado,
    reemplazoService_getEstado,
    reemplazoService_getHistorial,
    reemplazoService_registrar,
    reemplazoService_calcularResumen,
    reemplazoService_comprimirResumen,
    reemplazoService_expandirResumen,
    reemplazoService_getResumenMapa,
    reemplazoService_invalidarResumen,
    REEMPLAZO_RESUMEN_CACHE_KEY
  };
}
