// Identificacion de la cabecera del hub modular: que id principal y que
// segunda linea (titular o nombre) mostrar, dado el estado actual de
// pozoActual. Extraido de app.js como modulo separado (mismo patron que
// wellIdValidator.js) para poder testear esta decision con Jest sin
// depender del DOM.
//
// Regla de seguridad: el titular SOLO puede salir de Datos
// (record.titularidad), nunca de NE - aunque el usuario tenga ne=SI,
// mostrar el nombreOriginal de un punto NE en la cabecera GLOBAL
// filtraria indirectamente algo equivalente a Datos (nombreOriginal
// suele contener el mismo nombre de propietario) a alguien sin permiso
// "datos". Esta restriccion es especifica de la cabecera del hub -
// dentro del modulo Niveles Estaticos, con permiso ne, se puede mostrar
// lo que corresponda de NE sin este limite.
//
// Unica excepcion: un punto especial sin wellId (INA/RTR/Puesto/etc.) no
// tiene ficha registral posible - ahi identificarlo con su propio
// monitoringId/nombreOriginal de NE es la unica opcion, no hay Datos que
// filtrar.
function resolverIdentificacionHub(pozo) {
  var idPrincipal = pozo.wellId || (pozo.ne.found ? pozo.ne.data.monitoringId : null) || null;

  var identificacionSecundaria = null;
  if (pozo.wellId) {
    identificacionSecundaria = pozo.registro.found ? (pozo.registro.data.titularidad || {}).titular || null : null;
  } else if (pozo.ne.found) {
    identificacionSecundaria = pozo.ne.data.nombreOriginal || null;
  }

  return { idPrincipal: idPrincipal, identificacionSecundaria: identificacionSecundaria };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { resolverIdentificacionHub };
}
