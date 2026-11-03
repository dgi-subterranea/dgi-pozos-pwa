// Aviso por email, REUTILIZABLE, a quienes validan cuando una PROPUESTA nueva queda pendiente de validacion. Hoy lo usa solo ITF (E9); otros tipos (ubicacion, fotos, reemplazo...) se suman agregando UNA
// entrada a PROPUESTA_TIPOS y llamando a propuestaNotificacion_notificar desde su handler: ninguno de los modulos existentes (E3 / E4 / E8) cambia por esto.
//
// COSTO $0: solo MailApp de Apps Script (la cuenta que despliega el Web App es la que envia; el permiso de enviar correo ya lo pide el aviso de correcciones de ubicacion). Sin servicios externos.
//
// Contrato (conceptual): propuestaNotificacion_notificar({tipo, objetoId, wellId, propuestaId, proponente:{email, nombre}, timestamp, url, permisosValidador})
//   tipo ............ clave de PROPUESTA_TIPOS (hoy 'ITF'). Un tipo desconocido NO avisa a nadie (fail-closed: jamas se difunde a "todos").
//   objetoId ........ referencia opcional del objeto propuesto (para ITF, el pozo). Hoy no se muestra ni se registra: queda reservado para tipos cuyo objeto no es el pozo.
//   wellId .......... el pozo (solo se muestra si tiene formato NN-NNNN; si no, «sin identificar»).
//   propuestaId ..... identidad LOGICA de la propuesta (para ITF, su documentoId). SOLO sirve para no avisar dos veces: nunca viaja en el email.
//   proponente ...... {email, nombre}. Del nombre sale el «Propuesta por»; el email NUNCA se muestra (solo sirve para excluirlo si el tipo lo pide).
//   timestamp ....... fecha de creacion de la propuesta (ISO).
//   url ............. enlace a la app (opcional; por defecto PWA_URL de Script Properties; si no hay, el aviso sale sin enlace).
//   permisosValidador  opcional: lista de permisos que debe tener QUIEN VALIDA (todos, cada uno exactamente 'SI'). Si no se pasa, se usa el del tipo.
//
// Principios (los mismos que el aviso de correcciones de ubicacion):
//  - QUIEN LLAMA decide CUANDO: solo despues de que la propuesta quedo REALMENTE creada (no por entrar al endpoint, no por un intento fallido, no por un reintento idempotente). Como segunda defensa contra
//    una carrera hay una marca en CacheService por (tipo, propuestaId) que se pone ANTES de enviar: dos ejecuciones sobre la misma propuesta no mandan dos veces y un fallo no se reintenta solo.
//  - BEST EFFORT: esta funcion NUNCA lanza y nunca deshace nada: una propuesta ya creada sigue valida aunque falle MailApp, la cuota o la lectura de Usuarios. El resultado vuelve en un resumen para
//    que quien llama lo audite (Historial, sin cuerpo ni direcciones).
//  - Destinatarios = usuarios ACTIVOS (estado 'activo'), con TODOS los permisos de validador en 'SI', con email de forma valida, sin repetidos. Un email por destinatario: los validadores no ven las
//    direcciones de los demas y un fallo individual no afecta al resto. Si el proponente tambien valida, recibe el aviso igual salvo que el tipo diga lo contrario (incluirProponente: false).
//  - El cuerpo no lleva imagen ni datos tecnicos: tipo, pozo, nombre de quien propuso, fecha y hora (Mendoza), estado «pendiente de validacion», enlace a la app y donde revisarla.
//  - Cuota de MailApp: cada destinatario cuenta contra la cuota diaria (100 en Gmail personal, 1500 en Workspace); se consulta antes de enviar y no se pasa de lo disponible.
var PROPUESTA_MAIL_DEDUPE_SEGUNDOS = 21600;       // maximo de CacheService (6 h)
var PROPUESTA_MAIL_REGEX_EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
var PROPUESTA_MAIL_REGEX_WELL_ID = /^[0-9]{2}-[0-9]{4}$/;
var PROPUESTA_MAIL_REGEX_ID = /^[A-Za-z0-9_-]{1,100}$/;
var PROPUESTA_MAIL_REGEX_PERMISO = /^[a-z_]{1,40}$/;
var PROPUESTA_MAIL_REGEX_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[A-Za-z0-9._~\-\/%]*)?$/;
var PROPUESTA_MAIL_NOMBRE_REMITENTE = 'DGI Pozos';

// Un tipo por modulo de propuestas. titulo = lo que va en el asunto; intro = primera linea del cuerpo; etiquetaTipo = «Tipo de propuesta»; lugarRevision = donde se revisa dentro de la app.
// ITF: pueden validar quienes tienen perfil Y perfil_validar (los dos permisos que el backend exige para ver la cola de ITF y decidir). incluirProponente: un validador que propone tambien recibe el aviso.
var PROPUESTA_TIPOS = {
  ITF: {
    titulo: 'Nueva propuesta de ITF',
    intro: 'Hay una nueva propuesta de ITF pendiente de validación.',
    etiquetaTipo: 'ITF',
    lugarRevision: 'ITF pendientes',
    permisosValidador: ['perfil', 'perfil_validar'],
    incluirProponente: true
  }
};

function propuestaNotificacion_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

// Reemplaza TODOS los caracteres de control (saltos de linea y tabs incluidos) de un texto que va en el asunto o el cuerpo: nadie puede fabricar lineas falsas con su nombre.
function propuestaNotificacion_limpiar(texto, max) {
  var t = String(texto === null || texto === undefined ? '' : texto).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function propuestaNotificacion_formatearFecha(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d.getTime())) {
    return '';
  }
  return Utilities.formatDate(d, 'America/Argentina/Mendoza', 'dd/MM/yyyy HH:mm');
}

// Texto de un error para el log: sin direcciones de email y acotado.
function propuestaNotificacion_errorSeguro(err) {
  var t = String(err && err.message ? err.message : err);
  return t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').slice(0, 160);
}

// Ordena el pedido: {config, tipo, wellId, propuestaId, nombre, emailProponente, timestamp, url, permisosValidador}. null = no se puede avisar (tipo desconocido, sin propuestaId o permisos invalidos).
function propuestaNotificacion_normalizar(propuesta) {
  var p = propuesta !== null && typeof propuesta === 'object' ? propuesta : {};
  if (typeof p.tipo !== 'string' || !Object.prototype.hasOwnProperty.call(PROPUESTA_TIPOS, p.tipo)) {
    return null;
  }
  var config = PROPUESTA_TIPOS[p.tipo];
  if (typeof p.propuestaId !== 'string' || !PROPUESTA_MAIL_REGEX_ID.test(p.propuestaId)) {
    return null;
  }
  var permisos = p.permisosValidador === undefined ? config.permisosValidador : p.permisosValidador;
  if (!Array.isArray(permisos) || permisos.length === 0 || !permisos.every(function (x) { return typeof x === 'string' && PROPUESTA_MAIL_REGEX_PERMISO.test(x); })) {
    return null;
  }
  var proponente = p.proponente !== null && typeof p.proponente === 'object' ? p.proponente : {};
  return {
    config: config,
    tipo: p.tipo,
    wellId: PROPUESTA_MAIL_REGEX_WELL_ID.test(String(p.wellId)) ? p.wellId : 'sin identificar',
    propuestaId: p.propuestaId,
    nombre: propuestaNotificacion_limpiar(proponente.nombre, 80) || '(sin nombre)',
    emailProponente: propuestaNotificacion_normalizarEmail(proponente.email),
    timestamp: p.timestamp,
    url: typeof p.url === 'string' && PROPUESTA_MAIL_REGEX_URL.test(p.url) ? p.url : '',
    permisosValidador: permisos
  };
}

// Usuarios a avisar: activos, con TODOS los permisos de validador, email de forma valida (nunca se confia en la hoja para armar encabezados), sin repetidos y, si el tipo lo pide, sin el proponente.
// Lanza si no se puede leer la hoja de Usuarios (lo atiende notificar).
function propuestaNotificacion_destinatarios(permisosValidador, emailProponente, incluirProponente) {
  var propio = propuestaNotificacion_normalizarEmail(emailProponente);
  var vistos = {};
  var lista = [];
  sheetUserRepository_listarConPermisos(permisosValidador).forEach(function (u) {
    var e = propuestaNotificacion_normalizarEmail(u.email);
    if (!e || vistos[e] === true || !PROPUESTA_MAIL_REGEX_EMAIL.test(e) || (incluirProponente !== true && e === propio)) {
      return;
    }
    vistos[e] = true;
    lista.push({ email: e, nombre: u.nombre || null });
  });
  return lista;
}

// n = lo que devuelve propuestaNotificacion_normalizar. pwaUrl: URL https publica o ''.
function propuestaNotificacion_armarMensaje(n, pwaUrl) {
  var c = n.config;
  var asunto = 'DGI Pozos | ' + c.titulo + ' | ' + n.wellId;
  var lineas = [c.intro, ''];
  lineas.push('Tipo de propuesta: ' + c.etiquetaTipo);
  lineas.push('Pozo: ' + n.wellId);
  lineas.push('Propuesta por: ' + n.nombre);
  var fecha = propuestaNotificacion_formatearFecha(n.timestamp);
  if (fecha) {
    lineas.push('Fecha y hora: ' + fecha);
  }
  lineas.push('Estado: pendiente de validación');
  lineas.push('');
  if (pwaUrl) {
    lineas.push('Abrí la app: ' + pwaUrl);
  }
  lineas.push('Para revisarla, entrá a «' + c.lugarRevision + '».');
  lineas.push('', '— DGI Pozos. Aviso automático: no respondas este correo.');
  return { asunto: asunto, cuerpo: lineas.join('\n') };
}

// Un solo aviso por propuesta. Devuelve
//   {resultado: 'ENVIADO'|'PARCIAL'|'FALLO'|'SIN_DESTINATARIOS'|'ERROR'|'DEDUPED'|'NO_APLICA', destinatarios, enviados, fallidos, sinCuota}
// y NUNCA lanza.
function propuestaNotificacion_notificar(propuesta) {
  var resumen = { resultado: 'NO_APLICA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false };
  try {
    var n = propuestaNotificacion_normalizar(propuesta);
    if (n === null) {
      return resumen;
    }
    // Marca ANTES de enviar: dos ejecuciones sobre la misma propuesta no mandan dos veces, y un fallo no se reintenta solo.
    var cache = CacheService.getScriptCache();
    var clave = 'prop_mail_' + n.tipo + '_' + n.propuestaId;
    if (cache.get(clave) !== null) {
      resumen.resultado = 'DEDUPED';
      return resumen;
    }
    cache.put(clave, '1', PROPUESTA_MAIL_DEDUPE_SEGUNDOS);

    var destinatarios;
    try {
      destinatarios = propuestaNotificacion_destinatarios(n.permisosValidador, n.emailProponente, n.config.incluirProponente);
    } catch (err) {
      Logger.log('Aviso de propuesta (' + n.tipo + '): no se pudo leer la lista de validadores: ' + propuestaNotificacion_errorSeguro(err));
      resumen.resultado = 'ERROR';
      return resumen;
    }
    resumen.destinatarios = destinatarios.length;
    if (!destinatarios.length) {
      resumen.resultado = 'SIN_DESTINATARIOS';
      return resumen;
    }

    var pwaUrl = n.url;
    if (!pwaUrl) {
      try { pwaUrl = getPwaUrl(); } catch (e) { pwaUrl = ''; }
    }
    var mensaje = propuestaNotificacion_armarMensaje(n, pwaUrl);

    // Cuota diaria de la cuenta que envia: no se intenta mas de lo que queda (cada destinatario cuenta).
    var disponibles = destinatarios.length;
    try {
      if (typeof MailApp.getRemainingDailyQuota === 'function') {
        var restante = MailApp.getRemainingDailyQuota();
        if (typeof restante === 'number' && restante < disponibles) {
          disponibles = Math.max(0, restante);
          resumen.sinCuota = true;
        }
      }
    } catch (e) {
      // no se pudo consultar la cuota: se intenta igual (si MailApp rechaza, queda como fallo)
    }

    destinatarios.forEach(function (u, i) {
      if (i >= disponibles) {
        resumen.fallidos += 1;
        return;
      }
      try {
        MailApp.sendEmail({ to: u.email, subject: mensaje.asunto, body: mensaje.cuerpo, name: PROPUESTA_MAIL_NOMBRE_REMITENTE });
        resumen.enviados += 1;
      } catch (err) {
        resumen.fallidos += 1;
        Logger.log('Aviso de propuesta (' + n.tipo + '): fallo el envio a un validador: ' + propuestaNotificacion_errorSeguro(err));
      }
    });
    resumen.resultado = resumen.enviados === 0 ? 'FALLO' : (resumen.fallidos > 0 ? 'PARCIAL' : 'ENVIADO');
    return resumen;
  } catch (err) {
    Logger.log('Aviso de propuesta: error inesperado: ' + propuestaNotificacion_errorSeguro(err));
    resumen.resultado = 'ERROR';
    return resumen;
  }
}

// Texto para la hoja Historial: cantidad de destinatarios y resultado, nunca el cuerpo ni las direcciones. null = no se registra (nada que informar: tipo no aplicable o aviso repetido).
function propuestaNotificacion_textoAuditoria(r) {
  if (!r) {
    return null;
  }
  if (r.resultado === 'ENVIADO') {
    return 'EMAIL_ENVIADO (' + r.enviados + ' destinatario' + (r.enviados === 1 ? '' : 's') + ')';
  }
  if (r.resultado === 'PARCIAL') {
    return 'EMAIL_PARCIAL (' + r.enviados + ' de ' + r.destinatarios + ' enviados' + (r.sinCuota ? ', cuota diaria agotada' : '') + ')';
  }
  if (r.resultado === 'FALLO') {
    return 'EMAIL_FALLO (0 de ' + r.destinatarios + ' enviados' + (r.sinCuota ? ', cuota diaria agotada' : '') + ')';
  }
  if (r.resultado === 'SIN_DESTINATARIOS') {
    return 'EMAIL_SIN_DESTINATARIOS';
  }
  if (r.resultado === 'ERROR') {
    return 'EMAIL_ERROR';
  }
  return null;
}

// Correr manualmente desde el editor de Apps Script (Ejecutar > diagnosticoPropuestasItfEmail): muestra cuota restante de MailApp, URL configurada y CUANTOS validadores de ITF recibirian el aviso (activos, perfil=SI y
// perfil_validar=SI), con las direcciones enmascaradas. NO envia ningun email y no escribe nada.
function diagnosticoPropuestasItfEmail() {
  Logger.log('Cuota diaria restante de MailApp: ' + MailApp.getRemainingDailyQuota());
  var url = '';
  try { url = getPwaUrl(); } catch (e) { url = ''; }
  Logger.log('PWA_URL: ' + (url ? url : '(no configurada: los avisos salen sin enlace)'));
  var lista = propuestaNotificacion_destinatarios(PROPUESTA_TIPOS.ITF.permisosValidador, '', true);
  Logger.log('Validadores de ITF que recibirian el aviso (activos, perfil=SI y perfil_validar=SI): ' + lista.length);
  lista.forEach(function (u) {
    Logger.log(' - ' + (u.nombre || '(sin nombre)') + ' · ' + u.email.replace(/^(.).*(@.*)$/, '$1***$2'));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROPUESTA_MAIL_DEDUPE_SEGUNDOS,
    PROPUESTA_TIPOS,
    propuestaNotificacion_limpiar,
    propuestaNotificacion_formatearFecha,
    propuestaNotificacion_errorSeguro,
    propuestaNotificacion_normalizar,
    propuestaNotificacion_destinatarios,
    propuestaNotificacion_armarMensaje,
    propuestaNotificacion_notificar,
    propuestaNotificacion_textoAuditoria,
    diagnosticoPropuestasItfEmail
  };
}
