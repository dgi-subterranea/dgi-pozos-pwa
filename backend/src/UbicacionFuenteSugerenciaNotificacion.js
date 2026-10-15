// Aviso por email a quienes validan cuando una SUGERENCIA sobre una fuente de ubicacion queda PENDIENTE. Mismo patron que UbicacionCorreccionNotificacion.js (se reutilizan sus
// funciones de destinatarios, limpieza, fecha y errores seguros); lo propio de este archivo es el mensaje y la RESERVA DE CUOTA.
//
// COSTO $0: solo MailApp de Apps Script (la cuenta que despliega el Web App es la que envia).
//
// Principios:
//  - BEST EFFORT: un fallo al buscar destinatarios o al enviar NUNCA deshace ni cambia la respuesta de una sugerencia ya creada; se registra (Historial, sin cuerpo) y se sigue.
//    Esta funcion no lanza.
//  - Destinatarios = usuarios ACTIVOS con ubicacion=SI y ubicacion_validar=SI, sin repetidos y SIN el propio proponente (aunque tambien validara). Un email por destinatario.
//  - El cuerpo NO lleva emails, ids internos, payload tecnico ni coordenadas: pozo, tipo de sugerencia, fuente («Irrigacion (2)»), nombre del proponente, fecha, motivo (si hay)
//    y, si esta configurada, la URL publica de la PWA.
//  - RESERVA DE CUOTA: las correcciones de ubicacion comparten la cuota diaria de MailApp (100 en Gmail personal, 1500 en Workspace) y NO deben quedarse sin aviso por culpa de
//    las sugerencias: estas nunca usan los ultimos UFS_MAIL_RESERVA_CUOTA destinatarios disponibles (con 25 restantes, a lo sumo 5). Si no se puede consultar la cuota, no se
//    envia nada (no se puede garantizar la reserva). Las correcciones mantienen su comportamiento.
var UFS_MAIL_RESERVA_CUOTA = 20;
var UFS_MAIL_DEDUPE_SEGUNDOS = 21600;       // maximo de CacheService (6 h)
var UFS_MAIL_REGEX_WELL_ID = /^[0-9]{2}-[0-9]{4}$/;
var UFS_MAIL_NOMBRE_REMITENTE = 'DGI Pozos';
var UFS_MAIL_VERBO = { ACEPTAR: 'Aceptar', DESCARTAR: 'Descartar', RESTAURAR: 'Restaurar' };

// sug: lo que devuelve ubicacionFuenteSugerenciasService_sugerir en `notificar` (sin emails). pwaUrl: URL https publica o ''.
function ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug, pwaUrl) {
  var s = sug || {};
  var wellId = UFS_MAIL_REGEX_WELL_ID.test(String(s.wellId)) ? s.wellId : 'sin identificar';
  var verbo = Object.prototype.hasOwnProperty.call(UFS_MAIL_VERBO, s.accionSugerida) ? UFS_MAIL_VERBO[s.accionSugerida] : 'Revisar';
  var fuente = ubicacionCorreccionNotificacion_limpiar(s.etiquetaFuente, 40) || 'una fuente';
  var asunto = 'DGI Pozos — Sugerencia de ubicación pendiente: ' + wellId;

  var lineas = ['Hay una sugerencia sobre una fuente de ubicación pendiente de revisión.', ''];
  lineas.push('Pozo: ' + wellId);
  lineas.push('Sugerencia: ' + verbo + ' la fuente «' + fuente + '»');
  lineas.push('Propuesta por: ' + (ubicacionCorreccionNotificacion_limpiar(s.nombre, 80) || '(sin nombre)'));
  var fecha = ubicacionCorreccionNotificacion_formatearFecha(s.timestampUtc);
  if (fecha) {
    lineas.push('Fecha: ' + fecha);
  }
  var motivo = ubicacionCorreccionNotificacion_limpiar(s.motivo, UBICACION_CORR_MOTIVO_MAX);
  if (motivo) {
    lineas.push('Motivo: ' + motivo);
  }
  lineas.push('', 'Hasta que la apruebes, la sugerencia no cambia nada: ni el estado de la fuente ni la ubicación que usa la aplicación.');
  if (pwaUrl) {
    lineas.push('', 'Abrí la app para revisarla: ' + pwaUrl);
  }
  lineas.push('', '— DGI Pozos. Aviso automático: no respondas este correo.');
  return { asunto: asunto, cuerpo: lineas.join('\n') };
}

// Cuantos destinatarios se pueden avisar sin tocar la reserva: min(destinatarios, cuota restante - reserva), nunca negativo. null = no se pudo consultar la cuota.
function ubicacionFuenteSugerenciaNotificacion_cupo(cantidadDestinatarios) {
  var restante;
  try {
    if (typeof MailApp === 'undefined' || typeof MailApp.getRemainingDailyQuota !== 'function') {
      return null;
    }
    restante = MailApp.getRemainingDailyQuota();
  } catch (e) {
    return null;
  }
  if (typeof restante !== 'number' || !isFinite(restante)) {
    return null;
  }
  return Math.max(0, Math.min(cantidadDestinatarios, restante - UFS_MAIL_RESERVA_CUOTA));
}

// Un solo aviso por sugerencia. Devuelve
//   {resultado: 'ENVIADO'|'PARCIAL'|'FALLO'|'SIN_DESTINATARIOS'|'ERROR'|'DEDUPED'|'NO_APLICA', destinatarios, enviados, fallidos, sinCuota}
// y NUNCA lanza.
function ubicacionFuenteSugerenciaNotificacion_notificarPendiente(emailProponente, sug) {
  var resumen = { resultado: 'NO_APLICA', destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false };
  try {
    if (!sug || !sug.sugerenciaId) {
      return resumen;
    }
    // Marca ANTES de enviar: dos ejecuciones sobre la misma sugerencia no mandan dos veces, y un fallo no se reintenta solo.
    var cache = CacheService.getScriptCache();
    var clave = 'ufs_mail_' + sug.sugerenciaId;
    if (cache.get(clave) !== null) {
      resumen.resultado = 'DEDUPED';
      return resumen;
    }
    cache.put(clave, '1', UFS_MAIL_DEDUPE_SEGUNDOS);

    var destinatarios;
    try {
      destinatarios = ubicacionCorreccionNotificacion_destinatarios(emailProponente);
    } catch (err) {
      Logger.log('Aviso de sugerencia: no se pudo leer la lista de validadores: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
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
    var mensaje = ubicacionFuenteSugerenciaNotificacion_armarMensaje(sug, pwaUrl);

    var cupo = ubicacionFuenteSugerenciaNotificacion_cupo(destinatarios.length);
    var disponibles = cupo === null ? 0 : cupo;
    if (cupo === null || cupo < destinatarios.length) {
      resumen.sinCuota = true;
    }

    destinatarios.forEach(function (u, i) {
      if (i >= disponibles) {
        resumen.fallidos += 1;
        return;
      }
      try {
        MailApp.sendEmail({ to: u.email, subject: mensaje.asunto, body: mensaje.cuerpo, name: UFS_MAIL_NOMBRE_REMITENTE });
        resumen.enviados += 1;
      } catch (err) {
        resumen.fallidos += 1;
        Logger.log('Aviso de sugerencia: fallo el envio a un validador: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
      }
    });
    resumen.resultado = resumen.enviados === 0 ? 'FALLO' : (resumen.fallidos > 0 ? 'PARCIAL' : 'ENVIADO');
    return resumen;
  } catch (err) {
    Logger.log('Aviso de sugerencia: error inesperado: ' + ubicacionCorreccionNotificacion_errorSeguro(err));
    resumen.resultado = 'ERROR';
    return resumen;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFS_MAIL_RESERVA_CUOTA,
    UFS_MAIL_DEDUPE_SEGUNDOS,
    ubicacionFuenteSugerenciaNotificacion_armarMensaje,
    ubicacionFuenteSugerenciaNotificacion_cupo,
    ubicacionFuenteSugerenciaNotificacion_notificarPendiente
  };
}
