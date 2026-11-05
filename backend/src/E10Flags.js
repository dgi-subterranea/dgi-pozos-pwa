// E10Flags (E10-1): interruptores de E10, fail-closed y SEPARADOS de los de E9. Son Script Properties del proyecto dgi-pozos-backend; se leen en cada pedido (sin cache), asi que apagar una corta
// la funcion al instante, tambien en @HEAD y en las versiones numeradas.
//
//   E10_ADMIN_USUARIOS_ACTIVO   Encendido = EXACTAMENTE 'SI'. Habilita las operaciones administrativas de usuarios (UsuariosAdminService.js; los endpoints llegan en E10-2). Apagado (propiedad ausente, vacia,
//                               distinta de 'SI' o error al leerla): toda operacion administrativa responde E10_ADMIN_INACTIVO ANTES de abrir ninguna hoja.
//   E10_GESTION_EXTERNOS_ACTIVO Encendido = EXACTAMENTE 'SI'. Gobierna SOLO la GESTION ADMINISTRATIVA de usuarios EXTERNOS (UsuariosAdminService), nunca el acceso:
//                               APAGADO (propiedad ausente, vacia, distinta de 'SI' o error al leerla): no se crea un usuario EXTERNO nuevo, no se convierte un INTERNO a EXTERNO y no se reactiva un
//                               EXTERNO desde la administracion; esas operaciones responden E10_GESTION_EXTERNOS_INACTIVA. ENCENDIDO: se habilitan esas tres operaciones.
//                               NO es un gate de login: los EXTERNOS ya existentes (hoy los dos tecnicos externos) mantienen su acceso segun SU ESTADO y SUS PERMISOS, con el flag apagado o encendido.
//                               Lo que un externo puede ver o hacer lo definiran E10-3 / E10-4.
//   EMAIL_VERIFIED_MODO         'OBSERVAR' | 'EXIGIR' (se acepta cualquier combinacion de mayusculas y espacios alrededor). Ver e10Flags_emailVerifiedModo.
//
// En E10-1 los dos primeros quedan APAGADOS y EMAIL_VERIFIED_MODO queda ausente (= OBSERVAR).
var E10_PROP_ADMIN_USUARIOS = 'E10_ADMIN_USUARIOS_ACTIVO';
var E10_PROP_GESTION_EXTERNOS = 'E10_GESTION_EXTERNOS_ACTIVO';
var E10_PROP_EMAIL_VERIFIED_MODO = 'EMAIL_VERIFIED_MODO';

// Texto crudo de la propiedad, o null si no esta o no se pudo leer (nunca lanza).
function e10Flags_leerPropiedad(nombre) {
  try {
    var v = PropertiesService.getScriptProperties().getProperty(nombre);
    return v === null || v === undefined ? null : String(v);
  } catch (err) {
    return null;
  }
}

function e10Flags_adminUsuariosActivo() {
  return e10Flags_leerPropiedad(E10_PROP_ADMIN_USUARIOS) === 'SI';
}

function e10Flags_gestionExternosActivo() {
  return e10Flags_leerPropiedad(E10_PROP_GESTION_EXTERNOS) === 'SI';
}

// Modo de la verificacion de email_verified en el login: {modo: 'OBSERVAR' | 'EXIGIR', origen: 'AUSENTE' | 'VALIDO' | 'INVALIDO'}.
//   EXIGIR    solo con el valor EXIGIR.
//   OBSERVAR  con el valor OBSERVAR, con la propiedad AUSENTE (estado inicial del rollout) y con CUALQUIER otro valor (origen INVALIDO).
// FAIL-SAFE elegido (y documentado): un valor ausente o invalido NUNCA bloquea un login. OBSERVAR es exactamente el comportamiento de hoy (no se exige nada), asi que un error de tipeo en la
// propiedad (p. ej. "OBSERBAR") no puede dejar sin acceso a todos los usuarios; el valor invalido queda a la vista porque cada login registra la categoria con origen MODO_INVALIDO.
function e10Flags_emailVerifiedModo() {
  var crudo = e10Flags_leerPropiedad(E10_PROP_EMAIL_VERIFIED_MODO);
  if (crudo === null || String(crudo).trim() === '') {
    return { modo: 'OBSERVAR', origen: 'AUSENTE' };
  }
  var v = String(crudo).trim().toUpperCase();
  if (v === 'EXIGIR') {
    return { modo: 'EXIGIR', origen: 'VALIDO' };
  }
  if (v === 'OBSERVAR') {
    return { modo: 'OBSERVAR', origen: 'VALIDO' };
  }
  return { modo: 'OBSERVAR', origen: 'INVALIDO' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    E10_PROP_ADMIN_USUARIOS,
    E10_PROP_GESTION_EXTERNOS,
    E10_PROP_EMAIL_VERIFIED_MODO,
    e10Flags_leerPropiedad,
    e10Flags_adminUsuariosActivo,
    e10Flags_gestionExternosActivo,
    e10Flags_emailVerifiedModo
  };
}
