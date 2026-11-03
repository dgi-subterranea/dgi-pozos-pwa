// Aviso por email, REUTILIZABLE, a quienes validan cuando una PROPUESTA nueva queda pendiente de validacion. Hoy lo usa solo ITF (E9); otros tipos (ubicacion, fotos, reemplazo...) se suman agregando UNA
// entrada a PROPUESTA_TIPOS y llamando a propuestaNotificacion_notificar desde su handler: ninguno de los modulos existentes (E3 / E4 / E8) cambia por esto.
//
// COSTO $0: solo MailApp de Apps Script (la cuenta que despliega el Web App es la que envia; el permiso de enviar correo ya lo pide el aviso de correcciones de ubicacion). Sin servicios externos.
//
// Contrato (conceptual): propuestaNotificacion_notificar({tipo, wellId, propuestaId, proponente:{email, nombre}, timestamp, permisosValidador})
//   tipo ............ clave de PROPUESTA_TIPOS (hoy 'ITF'). Un tipo desconocido NO avisa a nadie (fail-closed: jamas se difunde a "todos").
//   wellId .......... el pozo (solo se muestra si tiene formato NN-NNNN; si no, «sin identificar»).
//   propuestaId ..... identidad LOGICA de la propuesta (para ITF, su documentoId). Con el tipo forma la clave unica del aviso; nunca viaja en el email.
//   proponente ...... {email, nombre}. Del nombre sale el «Propuesta por»; el email NUNCA se muestra (solo sirve para excluirlo si el tipo lo pide).
//   timestamp ....... fecha de creacion de la propuesta (ISO).
//   permisosValidador  opcional: lista de permisos que debe tener QUIEN VALIDA (TODOS, cada uno exactamente 'SI'). Si no se pasa, se usa la del tipo. NO se agrega ningun permiso implicito: el notificador
//                      evalua EXACTAMENTE esa lista (un tipo puede pedir solo ['ubicacion_validar'] o ['fotos_moderar'], sin 'perfil').
//
// OUTBOX (cola persistente, hoja PropuestaNotificaciones, ver PropuestaNotificacionesRepository.js): el aviso se REGISTRA antes de intentar enviarlo, asi no puede perderse:
//   1. quien llama ya confirmo la propuesta (para ITF: ITF_PROPUESTO escrito);  2. se asegura UNA fila por (tipo, propuestaId) (idempotente, bajo lock);  3. se intenta enviar;
//   4. si salio -> ENVIADA; si fallo -> ERROR (reintentable), con intentos y ultimo error.
//   La propuesta NO falla ni se revierte por un problema de email, y el aviso tampoco desaparece. La garantia de "un solo aviso por propuesta" es la HOJA (persistente), no CacheService.
//   Un reintento parcial (por ejemplo cuota agotada a mitad) solo manda a los validadores que faltan: la fila guarda quienes ya lo recibieron.
//   procesarNotificacionesPropuestasPendientes() reintenta las pendientes (limite por corrida, una que falla no frena a las demas). NO hay trigger: solo esta la funcion lista y probada.
//
// Principios:
//  - QUIEN LLAMA decide CUANDO: solo despues de que la propuesta quedo REALMENTE creada. Para ITF tambien en el reintento idempotente del proponente (asi se recupera un aviso que no llego a registrarse).
//  - BEST EFFORT: las funciones publicas NUNCA lanzan y nunca deshacen nada. El estado tecnico del aviso queda en la hoja del outbox y en el log de Apps Script; NO se escribe en el Historial funcional del pozo.
//  - Antes de enviar (tambien en los reintentos) cada tipo puede verificar que la propuesta SIGUE pendiente (config.verificar): si ya se aprobo, rechazo o retiro, el aviso se OMITE en vez de mandar un
//    «pendiente de validacion» falso; y si el modulo esta apagado (ITF_E9_ACTIVO) el aviso espera.
//  - Destinatarios = usuarios ACTIVOS (estado 'activo'), con TODOS los permisos de validador en 'SI', con email de forma valida, sin repetidos. Un email por destinatario: los validadores no ven las
//    direcciones de los demas y un fallo individual no afecta al resto. Si el proponente tambien valida, recibe el aviso igual salvo que el tipo diga lo contrario (incluirProponente: false).
//  - El cuerpo no lleva imagen ni datos tecnicos: tipo, pozo, nombre de quien propuso, fecha y hora (Mendoza), estado «pendiente de validacion», enlace a la app y donde revisarla.
//  - Cuota de MailApp: cada destinatario cuenta contra la cuota diaria (100 en Gmail personal, 1500 en Workspace); se consulta antes de enviar y no se pasa de lo disponible.
var PROPUESTA_MAIL_REGEX_EMAIL = /^[^\s@<>"',;:\\]+@[^\s@<>"',;:\\]+\.[^\s@<>"',;:\\]+$/;
var PROPUESTA_MAIL_REGEX_WELL_ID = /^[0-9]{2}-[0-9]{4}$/;
var PROPUESTA_MAIL_REGEX_ID = /^[A-Za-z0-9_-]{1,100}$/;
var PROPUESTA_MAIL_REGEX_PERMISO = /^[a-z_]{1,40}$/;
var PROPUESTA_MAIL_NOMBRE_REMITENTE = 'DGI Pozos';
var PROPUESTA_NOTIF_LIMITE_POR_CORRIDA = 10;
var PROPUESTA_NOTIF_LIMITE_MAXIMO = 50;
var PROPUESTA_ITF_EVENTOS_QUE_CIERRAN = ['ITF_APROBADO', 'ITF_RECHAZADO', 'ITF_RETIRADO'];

// Un tipo por modulo de propuestas. titulo = lo que va en el asunto; intro = primera linea del cuerpo; etiquetaTipo = «Tipo de propuesta»; lugarRevision = donde se revisa dentro de la app.
// permisosValidador = EXACTAMENTE los permisos que debe tener quien valida este tipo (todos en SI); nada se agrega por detras. incluirProponente: si el proponente tambien valida, recibe el aviso.
// verificar (opcional) = function (n) -> 'PENDIENTE' (se avisa) | 'CERRADA' (ya no corresponde: se omite) | cualquier otra cosa (el aviso espera). Puede lanzar (el aviso queda como esta y se reintenta).
// ITF: pueden validar quienes tienen perfil Y perfil_validar (los dos permisos que el backend exige para ver la cola de ITF y decidir: ITF_MOD_ENDPOINTS en Api.js).
var PROPUESTA_TIPOS = {
  ITF: {
    titulo: 'Nueva propuesta de ITF',
    intro: 'Hay una nueva propuesta de ITF pendiente de validación.',
    etiquetaTipo: 'ITF',
    lugarRevision: 'ITF pendientes',
    permisosValidador: ['perfil', 'perfil_validar'],
    incluirProponente: true,
    verificar: propuestaNotificacion_verificarItf
  }
};

// ITF: el aviso solo corresponde mientras la propuesta (el documento) esta propuesta y SIN cerrar (ni aprobada, ni rechazada, ni retirada) y los ITF colaborativos estan encendidos.
function propuestaNotificacion_verificarItf(n) {
  if (!itfService_e9Activo()) {
    return 'ESPERAR';
  }
  var propuesto = false;
  var cerrado = false;
  itfEventosRepository_listarPorDocumento(n.propuestaId).eventos.forEach(function (e) {
    if (e.documentoId !== n.propuestaId) {
      return;
    }
    if (e.evento === 'ITF_PROPUESTO') {
      propuesto = true;
    }
    if (PROPUESTA_ITF_EVENTOS_QUE_CIERRAN.indexOf(e.evento) >= 0) {
      cerrado = true;
    }
  });
  return propuesto && !cerrado ? 'PENDIENTE' : 'CERRADA';
}

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

// Texto de un error para el log o para la hoja: sin direcciones de email y acotado.
function propuestaNotificacion_errorSeguro(err) {
  var t = String(err && err.message ? err.message : err);
  return t.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').slice(0, 160);
}

// Ordena el pedido: {config, tipo, wellId, propuestaId, nombre, emailProponente, timestamp, permisosValidador}. null = no se puede avisar (tipo desconocido, sin propuestaId o permisos invalidos).
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
    permisosValidador: permisos
  };
}

// Usuarios a avisar: activos, con TODOS los permisos de validador (exactamente los indicados, ninguno implicito), email de forma valida (nunca se confia en la hoja para armar encabezados), sin repetidos y,
// si el tipo lo pide, sin el proponente. Lanza si no se puede leer la hoja de Usuarios (lo atiende quien llama).
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

function propuestaNotificacion_resumen(resultado) {
  return { resultado: resultado, destinatarios: 0, enviados: 0, fallidos: 0, sinCuota: false };
}

// Emails separados por «;» (como se guardan en destinatariosEnviados) -> lista normalizada, sin vacios.
function propuestaNotificacion_listaEmails(texto) {
  return String(texto === null || texto === undefined ? '' : texto).split(';').map(propuestaNotificacion_normalizarEmail).filter(function (e) { return e !== ''; });
}

// Texto corto y seguro para ultimoError cuando no llegaron todos: cantidades y, si corresponde, la cuota. Nunca direcciones.
function propuestaNotificacion_textoIncompleto(entregados, destinatarios, sinCuota) {
  return (entregados === 0 ? 'FALLO' : 'PARCIAL') + ' (' + entregados + ' de ' + destinatarios + ' enviados' + (sinCuota ? ', cuota diaria agotada' : '') + ')';
}

// Escribe el resultado de un intento en la hoja. Nunca lanza: si no se pudo, queda en el log (la fila sigue PENDIENTE / ERROR con el intento ya contado y se reintenta mas tarde).
function propuestaNotificacion_guardar(notificacionId, cambios) {
  try {
    return propuestaNotificacionesRepository_registrarResultado(notificacionId, cambios) === true;
  } catch (err) {
    Logger.log('Aviso de propuesta: no se pudo guardar el resultado en la hoja del outbox: ' + propuestaNotificacion_errorSeguro(err));
    return false;
  }
}

// Una fila del outbox -> el pedido que entiende propuestaNotificacion_normalizar (con los permisos tal como se registraron).
function propuestaNotificacion_propuestaDesdeFila(fila) {
  return {
    tipo: fila.tipo,
    wellId: fila.wellId,
    propuestaId: fila.propuestaId,
    proponente: { email: fila.proponenteEmail, nombre: fila.proponenteNombre },
    timestamp: fila.propuestaTimestampUtc,
    permisosValidador: String(fila.permisosValidador).split(',').map(function (x) { return x.trim(); })
  };
}

// UN intento de entrega de UNA fila del outbox. Devuelve
//   {resultado, destinatarios, enviados, fallidos, sinCuota} con resultado:
//   ENVIADO | PARCIAL | FALLO | SIN_DESTINATARIOS | ERROR (se reintentara) | YA_ENVIADA | OMITIDA | EN_CURSO (otro intento activo) | AGOTADA (llego al maximo de intentos) | EN_ESPERA (el modulo esta apagado)
// y NUNCA lanza. Orden: la fila sigue siendo candidata -> la propuesta sigue pendiente -> se RESERVA el intento (bajo lock; evita que dos ejecuciones manden a la vez) -> destinatarios -> envio ->
// se guarda el resultado (ENVIADA solo si TODOS los validadores actuales ya lo recibieron).
function propuestaNotificacion_entregar(fila) {
  var resumen = propuestaNotificacion_resumen('ERROR');
  try {
    var ESTADOS = PROPUESTA_NOTIF_ESTADOS;
    if (fila.estado === ESTADOS.ENVIADA) {
      resumen.resultado = 'YA_ENVIADA';
      return resumen;
    }
    if (fila.estado === ESTADOS.OMITIDA) {
      resumen.resultado = 'OMITIDA';
      return resumen;
    }
    if (fila.estado !== ESTADOS.PENDIENTE && fila.estado !== ESTADOS.ERROR) {
      Logger.log('Aviso de propuesta: una fila del outbox tiene un estado desconocido y no se toca.');
      return resumen;
    }
    var ahora = Date.now();
    if (!propuestaNotificacionesRepository_esReintentable(fila, ahora)) {
      resumen.resultado = fila.intentos >= PROPUESTA_NOTIF_MAX_INTENTOS ? 'AGOTADA' : 'EN_CURSO';
      return resumen;
    }
    var n = propuestaNotificacion_normalizar(propuestaNotificacion_propuestaDesdeFila(fila));
    if (n === null) {
      propuestaNotificacion_guardar(fila.notificacionId, { estado: ESTADOS.OMITIDA, ultimoError: 'DATOS_INVALIDOS' });
      resumen.resultado = 'OMITIDA';
      return resumen;
    }
    if (typeof n.config.verificar === 'function') {
      var vigencia = n.config.verificar(n);
      if (vigencia === 'CERRADA') {
        propuestaNotificacion_guardar(fila.notificacionId, { estado: ESTADOS.OMITIDA, ultimoError: 'YA_NO_PENDIENTE' });
        resumen.resultado = 'OMITIDA';
        return resumen;
      }
      if (vigencia !== 'PENDIENTE') {
        resumen.resultado = 'EN_ESPERA';
        return resumen;
      }
    }

    var reserva = propuestaNotificacionesRepository_reservarIntento(fila.notificacionId, ahora);
    if (!reserva.reservada) {
      if (reserva.motivo === 'YA_PROCESADA') {
        resumen.resultado = reserva.notificacion.estado === ESTADOS.ENVIADA ? 'YA_ENVIADA' : 'OMITIDA';
      } else if (reserva.motivo === 'AGOTADA' || reserva.motivo === 'EN_CURSO') {
        resumen.resultado = reserva.motivo;
      }
      return resumen;
    }
    var yaEnviados = propuestaNotificacion_listaEmails(reserva.notificacion.destinatariosEnviados);

    var destinatarios;
    try {
      destinatarios = propuestaNotificacion_destinatarios(n.permisosValidador, n.emailProponente, n.config.incluirProponente);
    } catch (err) {
      Logger.log('Aviso de propuesta (' + n.tipo + '): no se pudo leer la lista de validadores: ' + propuestaNotificacion_errorSeguro(err));
      propuestaNotificacion_guardar(fila.notificacionId, { estado: ESTADOS.ERROR, ultimoError: 'LECTURA_USUARIOS' });
      return resumen;
    }
    resumen.destinatarios = destinatarios.length;
    if (!destinatarios.length) {
      propuestaNotificacion_guardar(fila.notificacionId, { estado: ESTADOS.ERROR, ultimoError: 'SIN_DESTINATARIOS' });
      resumen.resultado = 'SIN_DESTINATARIOS';
      return resumen;
    }
    var faltan = destinatarios.filter(function (u) { return yaEnviados.indexOf(u.email) < 0; });
    var previos = destinatarios.length - faltan.length;

    var nuevos = [];
    if (faltan.length > 0) {
      var pwaUrl = '';
      try { pwaUrl = getPwaUrl(); } catch (e) { pwaUrl = ''; }
      var mensaje = propuestaNotificacion_armarMensaje(n, pwaUrl);

      // Cuota diaria de la cuenta que envia: no se intenta mas de lo que queda (cada destinatario cuenta).
      var disponibles = faltan.length;
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

      faltan.forEach(function (u, i) {
        if (i >= disponibles) {
          resumen.fallidos += 1;
          return;
        }
        try {
          MailApp.sendEmail({ to: u.email, subject: mensaje.asunto, body: mensaje.cuerpo, name: PROPUESTA_MAIL_NOMBRE_REMITENTE });
          nuevos.push(u.email);
          resumen.enviados += 1;
        } catch (err) {
          resumen.fallidos += 1;
          Logger.log('Aviso de propuesta (' + n.tipo + '): fallo el envio a un validador: ' + propuestaNotificacion_errorSeguro(err));
        }
      });
    }

    var entregados = previos + nuevos.length;
    var todos = yaEnviados.concat(nuevos).join(';');
    if (entregados === destinatarios.length) {
      propuestaNotificacion_guardar(fila.notificacionId, { estado: ESTADOS.ENVIADA, enviadoUtc: new Date(Date.now()).toISOString(), ultimoError: '', destinatariosEnviados: todos });
      resumen.resultado = 'ENVIADO';
      return resumen;
    }
    propuestaNotificacion_guardar(fila.notificacionId, {
      estado: ESTADOS.ERROR,
      ultimoError: propuestaNotificacion_textoIncompleto(entregados, destinatarios.length, resumen.sinCuota),
      destinatariosEnviados: todos
    });
    resumen.resultado = entregados === 0 ? 'FALLO' : 'PARCIAL';
    return resumen;
  } catch (err) {
    Logger.log('Aviso de propuesta: error inesperado: ' + propuestaNotificacion_errorSeguro(err));
    resumen.resultado = 'ERROR';
    return resumen;
  }
}

// REGISTRA el aviso de una propuesta (una fila por tipo + propuestaId, idempotente) y lo INTENTA enviar. Se llama SOLO despues de confirmar la propuesta (y tambien en su reintento idempotente: si el aviso no
// llego a registrarse, aca se recupera; si ya estaba ENVIADA no hace nada). Devuelve el mismo resumen que entregar, mas NO_APLICA (pedido invalido o tipo desconocido) y OUTBOX_NO_DISPONIBLE (la hoja
// PropuestaNotificaciones no existe o esta mal: el aviso NO se guarda ni se envia; la propuesta sigue valida). NUNCA lanza.
function propuestaNotificacion_notificar(propuesta) {
  var resumen = propuestaNotificacion_resumen('NO_APLICA');
  try {
    var n = propuestaNotificacion_normalizar(propuesta);
    if (n === null) {
      return resumen;
    }
    var fila;
    try {
      var d = new Date(n.timestamp);
      fila = propuestaNotificacionesRepository_asegurar({
        tipo: n.tipo,
        propuestaId: n.propuestaId,
        wellId: n.wellId,
        permisosValidador: n.permisosValidador.join(','),
        proponenteNombre: n.nombre,
        proponenteEmail: n.emailProponente,
        propuestaTimestampUtc: n.timestamp && !isNaN(d.getTime()) ? d.toISOString() : ''
      }, new Date(Date.now()).toISOString(), Utilities.getUuid()).notificacion;
    } catch (err) {
      Logger.log('Aviso de propuesta (' + n.tipo + '): no se pudo registrar en el outbox: ' + propuestaNotificacion_errorSeguro(err));
      resumen.resultado = 'OUTBOX_NO_DISPONIBLE';
      return resumen;
    }
    return propuestaNotificacion_entregar(fila);
  } catch (err) {
    Logger.log('Aviso de propuesta: error inesperado: ' + propuestaNotificacion_errorSeguro(err));
    resumen.resultado = 'ERROR';
    return resumen;
  }
}

// Reintenta las notificaciones PENDIENTE / ERROR (con intentos disponibles y sin otro intento en curso), las mas viejas primero, hasta `limite` por corrida (por defecto 10, tope 50). Una que falla no
// frena a las demas. Devuelve {revisadas, enviadas, omitidas, enEspera, errores, fallo} y NUNCA lanza (fallo = no se pudo ni leer la hoja).
function propuestaNotificacion_procesarPendientes(limite) {
  var r = { revisadas: 0, enviadas: 0, omitidas: 0, enEspera: 0, errores: 0, fallo: false };
  try {
    var tope = typeof limite === 'number' && isFinite(limite) && limite >= 1 ? Math.min(Math.floor(limite), PROPUESTA_NOTIF_LIMITE_MAXIMO) : PROPUESTA_NOTIF_LIMITE_POR_CORRIDA;
    var lista = propuestaNotificacionesRepository_listarReintentables(Date.now(), tope);
    lista.forEach(function (fila) {
      r.revisadas += 1;
      var x;
      try {
        x = propuestaNotificacion_entregar(fila);
      } catch (err) {
        x = { resultado: 'ERROR' };
      }
      if (x.resultado === 'ENVIADO') {
        r.enviadas += 1;
      } else if (x.resultado === 'OMITIDA') {
        r.omitidas += 1;
      } else if (x.resultado === 'EN_ESPERA' || x.resultado === 'EN_CURSO' || x.resultado === 'YA_ENVIADA') {
        r.enEspera += 1;
      } else {
        r.errores += 1;
      }
    });
    return r;
  } catch (err) {
    Logger.log('Aviso de propuesta: no se pudo procesar el outbox: ' + propuestaNotificacion_errorSeguro(err));
    r.fallo = true;
    return r;
  }
}

// Funcion lista para un trigger por tiempo (NO hay trigger creado) o para correrla a mano desde el editor: reintenta los avisos pendientes y deja el resumen en el log.
function procesarNotificacionesPropuestasPendientes() {
  var r = propuestaNotificacion_procesarPendientes();
  Logger.log('Avisos de propuestas pendientes: revisadas ' + r.revisadas + ', enviadas ' + r.enviadas + ', omitidas ' + r.omitidas + ', en espera ' + r.enEspera + ', con error ' + r.errores + (r.fallo ? ' (no se pudo leer el outbox)' : '') + '.');
  return r;
}

// Correr manualmente desde el editor de Apps Script (Ejecutar > diagnosticoPropuestasItfEmail): muestra cuota restante de MailApp, URL configurada, CUANTOS validadores de ITF recibirian el aviso (activos y con
// los permisos de validador del tipo ITF en SI), con las direcciones enmascaradas, y cuantos avisos hay en cada estado del outbox (si la hoja existe). NO envia ningun email y no escribe nada.
function diagnosticoPropuestasItfEmail() {
  Logger.log('Cuota diaria restante de MailApp: ' + MailApp.getRemainingDailyQuota());
  var url = '';
  try { url = getPwaUrl(); } catch (e) { url = ''; }
  Logger.log('PWA_URL: ' + (url ? url : '(no configurada: los avisos salen sin enlace)'));
  var permisos = PROPUESTA_TIPOS.ITF.permisosValidador;
  var lista = propuestaNotificacion_destinatarios(permisos, '', true);
  Logger.log('Validadores de ITF que recibirian el aviso (activos, con ' + permisos.join(' y ') + ' = SI): ' + lista.length);
  lista.forEach(function (u) {
    Logger.log(' - ' + (u.nombre || '(sin nombre)') + ' · ' + u.email.replace(/^(.).*(@.*)$/, '$1***$2'));
  });
  try {
    var c = propuestaNotificacionesRepository_contarPorEstado();
    Logger.log('Outbox ' + PROPUESTA_NOTIF_HOJA + ': PENDIENTE ' + c.PENDIENTE + ', ENVIADA ' + c.ENVIADA + ', ERROR ' + c.ERROR + ', OMITIDA ' + c.OMITIDA + (c.OTRO ? ', otro estado ' + c.OTRO : ''));
  } catch (err) {
    Logger.log('Outbox ' + PROPUESTA_NOTIF_HOJA + ': ' + propuestaNotificacion_errorSeguro(err));
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    PROPUESTA_TIPOS,
    PROPUESTA_NOTIF_LIMITE_POR_CORRIDA,
    PROPUESTA_NOTIF_LIMITE_MAXIMO,
    propuestaNotificacion_verificarItf,
    propuestaNotificacion_limpiar,
    propuestaNotificacion_formatearFecha,
    propuestaNotificacion_errorSeguro,
    propuestaNotificacion_normalizar,
    propuestaNotificacion_destinatarios,
    propuestaNotificacion_armarMensaje,
    propuestaNotificacion_entregar,
    propuestaNotificacion_notificar,
    propuestaNotificacion_procesarPendientes,
    procesarNotificacionesPropuestasPendientes,
    diagnosticoPropuestasItfEmail
  };
}
