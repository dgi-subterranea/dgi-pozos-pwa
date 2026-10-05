// Logica PURA del modulo Evaluacion / Reemplazo (sin DOM, sin red) - la
// testea Jest (js/reemplazoLogic.test.js). js/reemplazo.js es el
// controlador que la usa. Las reglas de validacion repiten a proposito las
// del backend (backend/src/ReemplazoService.js) SOLO para guiar al usuario
// antes de enviar: el backend vuelve a validar todo y es la unica barrera
// real.

var REEMPLAZO_ESTADOS_UI = [
  { valor: 'APTO', etiqueta: 'Apto' },
  { valor: 'NO_APTO', etiqueta: 'No apto' },
  { valor: 'DUDOSO', etiqueta: 'Dudoso' }
];

// Catalogo de motivos: mismo orden y mismos valores que el backend.
var REEMPLAZO_MOTIVOS_UI = [
  { valor: 'SIN_ACCESO', etiqueta: 'Sin acceso' },
  { valor: 'PROPIETARIO_NO_AUTORIZA', etiqueta: 'Propietario no autoriza' },
  { valor: 'POZO_NO_LOCALIZADO', etiqueta: 'Pozo no localizado' },
  { valor: 'POZO_CEGADO', etiqueta: 'Pozo cegado' },
  { valor: 'POZO_OBSTRUIDO', etiqueta: 'Pozo obstruido' },
  { valor: 'INSTALACION_IMPIDE_MEDICION', etiqueta: 'La instalación impide medir' },
  { valor: 'SECO', etiqueta: 'Seco' },
  { valor: 'CONDICION_INSEGURA', etiqueta: 'Condición insegura' },
  { valor: 'NO_REPRESENTATIVO', etiqueta: 'No representativo' },
  { valor: 'APTO_SIN_OBSERVACIONES', etiqueta: 'Apto sin observaciones' },
  { valor: 'OTRO', etiqueta: 'Otro (requiere observación)' }
];

var REEMPLAZO_OBSERVACION_MAX = 1000;
var REEMPLAZO_PUNTO_NE_MAX = 40;
var REEMPLAZO_PUNTO_NE_REGEX = /^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ][A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .\-_\/]*$/;

function reemplazoLogic_etiquetaEstado(estado) {
  if (estado === 'SIN_EVALUAR' || !estado) {
    return 'Sin evaluar';
  }
  for (var i = 0; i < REEMPLAZO_ESTADOS_UI.length; i++) {
    if (REEMPLAZO_ESTADOS_UI[i].valor === estado) {
      return REEMPLAZO_ESTADOS_UI[i].etiqueta;
    }
  }
  return estado;
}

function reemplazoLogic_etiquetaMotivo(motivo) {
  if (!motivo) {
    return '';
  }
  for (var i = 0; i < REEMPLAZO_MOTIVOS_UI.length; i++) {
    if (REEMPLAZO_MOTIVOS_UI[i].valor === motivo) {
      return REEMPLAZO_MOTIVOS_UI[i].etiqueta;
    }
  }
  return motivo;
}

// Sufijo de clase CSS por estado (colores del badge).
function reemplazoLogic_claseEstado(estado) {
  if (estado === 'APTO') { return 'apto'; }
  if (estado === 'NO_APTO') { return 'no-apto'; }
  if (estado === 'DUDOSO') { return 'dudoso'; }
  return 'sin-evaluar';
}

// Motivos permitidos por estado - MISMA tabla que el backend
// (REEMPLAZO_MOTIVOS_POR_ESTADO en backend/src/ReemplazoService.js, que es
// la que manda). DUDOSO no admite las condiciones fisicamente concluyentes
// (cegado, obstruido, seco, condicion insegura): esas son NO_APTO. El
// estado lo decide siempre el tecnico, el motivo nunca lo infiere.
var REEMPLAZO_MOTIVOS_POR_ESTADO_UI = {
  APTO: ['APTO_SIN_OBSERVACIONES', 'OTRO'],
  DUDOSO: ['SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'INSTALACION_IMPIDE_MEDICION', 'NO_REPRESENTATIVO', 'OTRO'],
  NO_APTO: [
    'SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'POZO_CEGADO', 'POZO_OBSTRUIDO',
    'INSTALACION_IMPIDE_MEDICION', 'SECO', 'CONDICION_INSEGURA', 'NO_REPRESENTATIVO', 'OTRO'
  ]
};

// Motivos que ofrece el selector segun el estado elegido. Sin estado
// elegido todavia: lista vacia.
function reemplazoLogic_motivosParaEstado(estado) {
  var permitidos = REEMPLAZO_MOTIVOS_POR_ESTADO_UI[estado];
  if (!permitidos) {
    return [];
  }
  return REEMPLAZO_MOTIVOS_UI.filter(function (m) { return permitidos.indexOf(m.valor) >= 0; });
}

function reemplazoLogic_motivoRequerido(estado) {
  return estado === 'NO_APTO' || estado === 'DUDOSO';
}

// {valido, errores:{estado, motivo, observacion, puntoNE}, valores}
// - mismas reglas que el backend. valores = lo que se envia (recortado).
function reemplazoLogic_validarFormulario(form) {
  var f = form || {};
  var errores = {};
  var estado = f.estado || '';
  var motivo = f.motivo || '';
  var observacion = (f.observacion || '').trim();
  var puntoNE = (f.puntoNE || '').trim();

  if (!estado) {
    errores.estado = 'Elegí un estado.';
  }
  if (estado && motivo && reemplazoLogic_motivosParaEstado(estado).every(function (m) { return m.valor !== motivo; })) {
    errores.motivo = 'Ese motivo no corresponde al estado elegido.';
  }
  if (estado && !motivo && reemplazoLogic_motivoRequerido(estado)) {
    errores.motivo = 'Elegí un motivo.';
  }
  if (observacion.length > REEMPLAZO_OBSERVACION_MAX) {
    errores.observacion = 'La observación admite hasta ' + REEMPLAZO_OBSERVACION_MAX + ' caracteres.';
  } else if (motivo === 'OTRO' && !observacion) {
    errores.observacion = 'Con el motivo "Otro" la observación es obligatoria.';
  }
  if (puntoNE && (puntoNE.length > REEMPLAZO_PUNTO_NE_MAX || !REEMPLAZO_PUNTO_NE_REGEX.test(puntoNE))) {
    errores.puntoNE = 'Punto NE inválido (letras, números, espacios y . - _ /).';
  }

  return {
    valido: Object.keys(errores).length === 0,
    errores: errores,
    valores: { estado: estado, motivo: motivo, observacion: observacion, puntoNEReferencia: puntoNE }
  };
}

// "dd/mm/aaaa hh:mm" en hora de Mendoza (la de quienes usan el modulo),
// sin depender del huso del dispositivo ni del locale del navegador.
// Fecha invalida/ausente: "—".
function reemplazoLogic_formatearFecha(iso, timeZone) {
  var fecha = new Date(iso);
  if (!iso || isNaN(fecha.getTime())) {
    return '—';
  }
  var partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'America/Argentina/Mendoza',
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(fecha);
  var p = {};
  partes.forEach(function (x) { p[x.type] = x.value; });
  var hora = p.hour === '24' ? '00' : p.hour;
  return p.day + '/' + p.month + '/' + p.year + ' ' + hora + ':' + p.minute;
}

// Solo el nombre: el email del evaluador nunca se muestra (ni siquiera
// como respaldo). Sin nombre, una etiqueta neutra.
function reemplazoLogic_nombreUsuario(evaluacion) {
  return (evaluacion && evaluacion.nombre) || 'Usuario';
}

// Agrega una evaluacion recien creada AL PRINCIPIO del historial (mas
// reciente primero) sin mutar el array original ni duplicar por id - asi
// la UI refresca el historial sin volver a pedirlo al backend.
function reemplazoLogic_agregarAlHistorial(historial, evaluacion) {
  var base = (historial || []).filter(function (e) { return e.evaluacionId !== evaluacion.evaluacionId; });
  return [evaluacion].concat(base);
}

// Estado actual segun un historial ya ordenado (mas reciente primero) -
// misma regla que el backend: la ultima evaluacion; sin ninguna,
// SIN_EVALUAR (implicito).
function reemplazoLogic_estadoDesdeHistorial(historial) {
  if (!historial || historial.length === 0) {
    return { estado: 'SIN_EVALUAR', ultimaEvaluacion: null };
  }
  return { estado: historial[0].estado, ultimaEvaluacion: historial[0] };
}

// Mensaje para cada codigo de error del modulo (nunca el "message"
// tecnico del backend).
var REEMPLAZO_MENSAJES_ERROR = {
  PERMISSION_DENIED: 'No tenés permiso para usar el módulo de reemplazos.',
  INVALID_ESTADO: 'Elegí un estado válido.',
  INVALID_MOTIVO: 'El motivo elegido no es válido.',
  MOTIVO_REQUERIDO: 'Elegí un motivo.',
  OBSERVACION_REQUERIDA: 'Con el motivo "Otro" la observación es obligatoria.',
  ESTADO_MOTIVO_INCOMPATIBLE: 'Ese motivo no corresponde al estado elegido.',
  INVALID_OBSERVACION: 'La observación no es válida (máximo ' + REEMPLAZO_OBSERVACION_MAX + ' caracteres).',
  INVALID_PUNTO_NE: 'El punto NE de referencia no es válido.',
  INVALID_WELL_ID: 'Formato inválido. Usá DD-PPPP (ej: 03-0123).',
  USER_DISABLED: 'Tu cuenta no tiene acceso habilitado. Contactá al administrador.',
  SERVICE_UNAVAILABLE: 'No se pudo completar la operación. Intentá nuevamente.'
};

function reemplazoLogic_mensajeError(code) {
  return REEMPLAZO_MENSAJES_ERROR[code] || 'Ocurrió un error inesperado. Intentá nuevamente.';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    REEMPLAZO_ESTADOS_UI,
    REEMPLAZO_MOTIVOS_UI,
    reemplazoLogic_etiquetaEstado,
    reemplazoLogic_etiquetaMotivo,
    reemplazoLogic_claseEstado,
    reemplazoLogic_motivosParaEstado,
    reemplazoLogic_motivoRequerido,
    reemplazoLogic_validarFormulario,
    reemplazoLogic_formatearFecha,
    reemplazoLogic_nombreUsuario,
    reemplazoLogic_agregarAlHistorial,
    reemplazoLogic_estadoDesdeHistorial,
    reemplazoLogic_mensajeError
  };
}
