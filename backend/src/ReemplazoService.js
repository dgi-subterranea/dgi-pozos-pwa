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
    reemplazoService_registrar
  };
}
