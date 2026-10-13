// Aviso por email a quienes validan correcciones de ubicacion cuando una correccion nueva queda PENDIENTE (PROPUESTA).
//
// COSTO $0: solo MailApp de Apps Script (la cuenta que despliega el Web App es la que envia; nada de proveedores externos).
//
// Principios:
//  - BEST EFFORT: un fallo al buscar destinatarios o al enviar NUNCA deshace ni demora el error de una propuesta ya creada; se registra (Historial, sin
//    cuerpo del email) y se sigue. Esta funcion no lanza.
//  - Solo se avisa cuando la correccion quedo realmente PROPUESTA: una VALIDADA directa (corregir + validar) no manda nada, y un reintento idempotente
//    (duplicada) tampoco (lo decide Api.js, y ademas hay una marca en cache por correccionId como segunda defensa contra una carrera).
//  - Destinatarios = usuarios ACTIVOS con ubicacion=SI y ubicacion_validar=SI (los dos permisos que el backend exige para ver la cola y validar), sin
//    repetidos y SIN el propio proponente. Se manda un email por destinatario: los validadores no ven las direcciones de los demas y un fallo individual
//    no afecta al resto.
//  - El cuerpo no lleva coordenadas, emails ni datos del padron: pozo, quien propuso (nombre), fecha, metodo, distancia a Irrigacion, observacion,
//    advertencias de distancia y, si esta configurada, la URL publica de la PWA.
//  - Cuotas de MailApp (ver docs/ubicacion-correcciones.md): cada destinatario cuenta contra la cuota diaria de la cuenta que despliega
//    (100 en Gmail personal, 1500 en Google Workspace); se consulta MailApp.getRemainingDailyQuota() antes de enviar y no se pasa de lo disponible.
var UBICACION_CORR_MAIL_DEDUPE_SEGUNDOS = 21600;       // maximo de CacheService (6 h)
var UBICACION_CORR_MAIL_REGEX_EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
var UBICACION_CORR_MAIL_REGEX_WELL_ID = /^[0-9]{2}-[0-9]{4}$/;
var UBICACION_CORR_MAIL_NOMBRE_REMITENTE = 'DGI Pozos';
var UBICACION_CORR_MAIL_PERMISOS_VALIDADOR = ['ubicacion', 'ubicacion_validar'];

function ubicacionCorreccionNotificacion_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

// Reemplaza TODOS los caracteres de control (saltos de linea y tabs incluidos) de un texto de usuario que va en el cuerpo: asi nadie puede fabricar
// lineas falsas ("Propuesta por: ...", advertencias) dentro de su observacion o su nombre.
function ubicacionCorreccionNotificacion_limpiar(texto, max) {
  var t = String(texto === null || texto === undefined ? '' : texto).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
  return t.length > max ? t.slice(0, max) : t;
}

function ubicacionCorreccionNotificacion_formatearDistancia(metros) {
  if (typeof metros !== 'number' || !isFinite(metros)) {
    return '';
  }
  if (metros >= 1000) {
    return String(Math.round(metros / 100) / 10).replace('.', ',') + ' km';
  }
  return String(Math.round(metros * 10) / 10).replace('.', ',') + ' m';
}

function ubicacionCorreccionNotificacion_formatearFecha(iso) {
  var d = new Date(iso);
  if (!iso || isNaN(d.getTime())) {
    return '';
  }
  return Utilities.formatDate(d, 'America/Argentina/Mendoza', 'dd/MM/yyyy HH:mm');
}

// Usuarios a avisar: activos, con los permisos de validar, sin el proponente, sin repetidos y con un email de forma valida (nunca se confia en el
// contenido de la hoja para armar encabezados). Lanza si no se puede leer la hoja de Usuarios (lo atiende notificarPendiente).
function ubicacionCorreccionNotificacion_destinatarios(emailProponente) {
  var propio = ubicacionCorreccionNotificacion_normalizarEmail(emailProponente);
  var vistos = {};
  var lista = [];
  sheetUserRepository_listarConPermisos(UBICACION_CORR_MAIL_PERMISOS_VALIDADOR).forEach(function (u) {
    var e = ubicacionCorreccionNotificacion_normalizarEmail(u.email);
    if (!e || e === propio || vistos[e] === true || !UBICACION_CORR_MAIL_REGEX_EMAIL.test(e)) {
      return;
    }
    vistos[e] = true;
    lista.push({ email: e, nombre: u.nombre || null });
  });
  return lista;
}

// correccion: vista de UbicacionCorreccionService (sin emails). pwaUrl: URL https publica o ''.
function ubicacionCorreccionNotificacion_armarMensaje(correccion, pwaUrl) {
  var c = correccion || {};
  var wellId = UBICACION_CORR_MAIL_REGEX_WELL_ID.test(String(c.wellId)) ? c.wellId : 'sin identificar';
  var asunto = 'DGI Pozos — Corrección de ubicación pendiente: ' + wellId;

  var metodo = c.metodo === 'GPS_ACTUAL'
    ? 'GPS' + (typeof c.precisionGpsM === 'number' ? ' (± ' + String(c.precisionGpsM).replace('.', ',') + ' m)' : '')
    : (c.metodo === 'PUNTO_EN_MAPA' ? 'Elegida en mapa' : ubicacionCorreccionNotificacion_limpiar(c.metodo, 40));

  var lineas = ['Hay una corrección de ubicación pendiente de validación.', ''];
  lineas.push('Pozo: ' + wellId);
  lineas.push('Propuesta por: ' + (ubicacionCorreccionNotificacion_limpiar(c.nombrePropone, 80) || '(sin nombre)'));
  var fecha = ubicacionCorreccionNotificacion_formatearFecha(c.timestamp);
  if (fecha) {
    lineas.push('Fecha: ' + fecha);
  }
  lineas.push('Método: ' + metodo);
  var distancia = ubicacionCorreccionNotificacion_formatearDistancia(c.distanciaM);
  if (distancia) {
    lineas.push('Distancia a la ubicación de Irrigación: ' + distancia);
  }
  var observacion = ubicacionCorreccionNotificacion_limpiar(c.observacion, UBICACION_CORR_OBSERVACION_MAX);
  if (observacion) {
    lineas.push('Observación: ' + observacion);
  }
  if (typeof c.distanciaM === 'number' && c.distanciaM > UBICACION_CORR_ADVERTENCIA_DESDE_M) {
    lineas.push('', 'ATENCIÓN: la ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificala con cuidado antes de validarla.');
  } else if (typeof c.distanciaM === 'number' && c.distanciaM > UBICACION_CORR_OBSERVACION_DESDE_M) {
    lineas.push('', 'Atención: la ubicación propuesta está a más de 250 m de la ubicación de Irrigación.');
  }
  if (pwaUrl) {
    lineas.push('', 'Abrí la app para revisarla: ' + pwaUrl);
  }
  lineas.push('', '— DGI Pozos. Aviso automático: no respondas este correo.');
  return { asunto: asunto, cuerpo: lineas.join('\n') };
}

// Un solo aviso por correccion. Devuelve
//   {resultado: 'ENVIADO'|'PARCIAL'|'FALLO'|'SIN_DESTINATARIOS'|'ERROR'|'DEDUPED'|'NO_APLICA', destinatarios, enviados, fallidos, sinCuota}
// y NUNCA lanza.
function ubicacionCorreccionNotificacion_notificarPendiente(emailProponente, correccion) {
  var resumen = { resultado: 'NO_APLICA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false };
  try {
    if (!correccion || correccion.estado !== 'PROPUESTA' || !correccion.correccionId) {
      return resumen;
    }
    // Marca ANTES de enviar: dos ejecuciones sobre la misma correccion no mandan dos veces, y un fallo no se reintenta solo.
    var cache = CacheService.getScriptCache();
    var clave = 'ucorr_mail_' + correccion.correccionId;
    if (cache.get(clave) !== null) {
      resumen.resultado = 'DEDUPED';
      return resumen;
    }
    cache.put(clave, '1', UBICACION_CORR_MAIL_DEDUPE_SEGUNDOS);

    var destinatarios;
    try {
      destinatarios = ubicacionCorreccionNotificacion_destinatarios(emailProponente);
    } catch (err) {
      Logger.log('Aviso de correccion: no se pudo leer la lista de validadores: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
      resumen.resultado = 'ERROR';
      return resumen;
    }
    resumen.destinatarios = destinatarios.length;
    if (!destinatarios.length) {
      resumen.resultado = 'SIN_DESTINATARIOS';
      return resumen;
    }

    var pwaUrl = '';
    try { pwaUrl = getPwaUrl(); } catch (e) { pwaUrl = ''; }
    var mensaje = ubicacionCorreccionNotificacion_armarMensaje(correccion, pwaUrl);

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
        MailApp.sendEmail({ to: u.email, subject: mensaje.asunto, body: mensaje.cuerpo, name: UBICACION_CORR_MAIL_NOMBRE_REMITENTE });
        resumen.enviados += 1;
      } catch (err) {
        resumen.fallidos += 1;
        Logger.log('Aviso de correccion: fallo el envio a un validador: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
      }
    });
    resumen.resultado = resumen.enviados === 0 ? 'FALLO' : (resumen.fallidos > 0 ? 'PARCIAL' : 'ENVIADO');
    return resumen;
  } catch (err) {
    Logger.log('Aviso de correccion: error inesperado: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
    resumen.resultado = 'ERROR';
    return resumen;
  }
}

// Texto de un error para el log: sin direcciones de email y acotado.
function ubicacionCorreccionNotificacion_errorSeguro(err) {
  var t = String(err && err.message ? err.message : err);
  return t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').slice(0, 160);
}

// Texto para la hoja Historial (resultado de la accion 'notificarCorreccionUbicacion'): cantidad de destinatarios y resultado, nunca el cuerpo ni las
// direcciones. null = no se registra (nada que informar: correccion no pendiente o aviso repetido).
function ubicacionCorreccionNotificacion_textoAuditoria(r) {
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

// Correr UNA VEZ manualmente desde el editor de Apps Script (Ejecutar > diagnosticoCorreccionesEmail) despues de subir esta version: pide a la cuenta
// que despliega AUTORIZAR el permiso de enviar correo (script.send_mail) - sin eso MailApp falla y los avisos quedan como EMAIL_FALLO - y muestra en
// el log cuota restante, URL configurada y cantidad de destinatarios (sin imprimir direcciones). No envia ningun email.
function diagnosticoCorreccionesEmail() {
  Logger.log('Cuota diaria restante de MailApp: ' + MailApp.getRemainingDailyQuota());
  var url = '';
  try { url = getPwaUrl(); } catch (e) { url = ''; }
  Logger.log('PWA_URL: ' + (url ? url : '(no configurada: los avisos salen sin enlace)'));
  var lista = ubicacionCorreccionNotificacion_destinatarios('');
  Logger.log('Validadores que recibirian el aviso (activos, ubicacion=SI y ubicacion_validar=SI): ' + lista.length);
  lista.forEach(function (u) {
    Logger.log(' - ' + (u.nombre || '(sin nombre)') + ' · ' + u.email.replace(/^(.).*(@.*)$/, '$1***$2'));
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UBICACION_CORR_MAIL_DEDUPE_SEGUNDOS,
    ubicacionCorreccionNotificacion_destinatarios,
    ubicacionCorreccionNotificacion_armarMensaje,
    ubicacionCorreccionNotificacion_notificarPendiente,
    ubicacionCorreccionNotificacion_textoAuditoria,
    diagnosticoCorreccionesEmail
  };
}
