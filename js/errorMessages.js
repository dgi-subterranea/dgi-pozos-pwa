// Tabla code -> mensaje en espanol. La UI nunca muestra el "message"
// tecnico que devuelve el backend, siempre pasa por aca.
var ERROR_MESSAGES = {
  // Generico: solo se usa si el backend devuelve INVALID_WELL_ID sin que
  // la validacion local ya lo haya detectado antes (no deberia pasar en
  // uso normal, es un respaldo). La UI en pantalla usa las dos variantes
  // de abajo, que sí distinguen el motivo.
  INVALID_WELL_ID: 'Formato inválido. Usá DD-PPPP (ej: 03-0123).',
  INVALID_WELL_ID_FORMAT: 'El formato debe ser DD-PPPP.',
  INVALID_WELL_ID_RANGE: 'El departamento debe estar entre 01 y 19.',
  UNAUTHORIZED: 'Tu sesión venció. Iniciá sesión de nuevo.',
  USER_DISABLED: 'Tu cuenta no tiene acceso habilitado. Contactá al administrador.',
  PROFILE_NOT_FOUND: 'No se encontró información para el pozo {wellId}.',
  PERMISSION_DENIED: 'No tenés permiso para esta función.',
  SERVICE_UNAVAILABLE: 'No se pudo completar la consulta. Intentá nuevamente.',
  OFFLINE: 'No tenés conexión a internet.'
};

function getErrorMessage(code, wellId) {
  var template = ERROR_MESSAGES[code] || 'Ocurrió un error inesperado. Intentá nuevamente.';
  return template.replace('{wellId}', wellId || '');
}
