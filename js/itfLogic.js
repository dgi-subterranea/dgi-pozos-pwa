// Logica PURA de los ITF colaborativos en el navegador (E9-6, local, NO productivo): permisos, catalogos de motivos, textos, mensajes de error, formatos, validacion de archivo y plan de reduccion de la imagen.
// No toca el DOM ni la red: los flujos con estado viven en js/itfFlujosLogic.js y el DOM en js/itfPerfil.js / js/itfModeracion.js. El servidor es SIEMPRE la autoridad: todo lo de aca es comodidad (no pedir lo
// que se sabe que va a fallar) y nunca el limite de seguridad. Mismo permiso exacto que el backend: `=== true` (un "SI", un 1 o un objeto NO alcanzan).
//
// Privacidad / lenguaje: la pantalla nunca muestra ids internos (LEGACY:<wellId> se ve como "ITF existente"), emails, hashes ni nombres de storage. Todo texto que viene del servidor (nombre del archivo, nombre de
// la persona, detalle de un motivo) se pinta SOLO con textContent en los controladores.

// --- permisos ---

function itfLogic_puedeVerPerfil(permisos) {
  return !!permisos && permisos.perfil === true;
}

// Proponer / "Mis propuestas" / retirar la propia propuesta: perfil Y perfil_subir.
function itfLogic_puedeProponer(permisos) {
  return !!permisos && permisos.perfil === true && permisos.perfil_subir === true;
}

// Cola, visor de moderacion, historial, aprobar, rechazar, retirar, restaurar: perfil Y perfil_validar.
function itfLogic_puedeValidar(permisos) {
  return !!permisos && permisos.perfil === true && permisos.perfil_validar === true;
}

// --- catalogos (los mismos codigos que el backend; el servidor los vuelve a validar) ---

var ITF_MOTIVOS_REEMPLAZO = [
  { codigo: 'ACTUALIZACION', texto: 'Es una versión más reciente' },
  { codigo: 'CORRECCION', texto: 'Corrige un error del ITF actual' },
  { codigo: 'MEJOR_CALIDAD', texto: 'Tiene mejor calidad o se lee mejor' },
  { codigo: 'DOCUMENTO_COMPLETO', texto: 'Es el documento completo' },
  { codigo: 'OTRO', texto: 'Otro motivo' }
];

var ITF_MOTIVOS_RECHAZO = [
  { codigo: 'NO_CORRESPONDE_POZO', texto: 'No corresponde a este pozo' },
  { codigo: 'INCOMPLETO', texto: 'Está incompleto' },
  { codigo: 'ILEGIBLE', texto: 'No se puede leer' },
  { codigo: 'DUPLICADO', texto: 'Ya existe (duplicado)' },
  { codigo: 'VERSION_INCORRECTA', texto: 'Es una versión incorrecta' },
  { codigo: 'OTRO', texto: 'Otro motivo' }
];

var ITF_MOTIVOS_RETIRO = [
  { codigo: 'DOCUMENTO_INCORRECTO', texto: 'El documento es incorrecto' },
  { codigo: 'NO_CORRESPONDE_POZO', texto: 'No corresponde a este pozo' },
  { codigo: 'DESACTUALIZADO', texto: 'Está desactualizado' },
  { codigo: 'ERROR_DE_APROBACION', texto: 'Se aprobó por error' },
  { codigo: 'OTRO', texto: 'Otro motivo' }
];

// Restaurar usa el catalogo de retiro del backend, pero la frase tiene que tener sentido al VOLVER a un documento anterior.
var ITF_MOTIVOS_RESTAURACION = [
  { codigo: 'ERROR_DE_APROBACION', texto: 'El ITF vigente se aprobó por error' },
  { codigo: 'DOCUMENTO_INCORRECTO', texto: 'El ITF vigente es incorrecto' },
  { codigo: 'NO_CORRESPONDE_POZO', texto: 'El ITF vigente no corresponde a este pozo' },
  { codigo: 'DESACTUALIZADO', texto: 'Este documento es el que corresponde' },
  { codigo: 'OTRO', texto: 'Otro motivo' }
];

var ITF_MOTIVO_TEXTO_MIN = 3;
var ITF_MOTIVO_TEXTO_MAX = 300;
var ITF_CODIGO_OTRO = 'OTRO';

// Las acciones institucionales y sus textos. `catalogo` null = no pide motivo (aprobar sin ITF vigente).
var ITF_ACCIONES_UI = {
  APROBAR: { titulo: 'Aprobar como ITF vigente', boton: 'Aprobar como ITF vigente', enviando: 'Aprobando…', exito: 'ITF aprobado. Ya es el ITF vigente del pozo.' },
  RECHAZAR: { titulo: 'Rechazar propuesta', boton: 'Rechazar propuesta', enviando: 'Rechazando…', exito: 'Propuesta rechazada.' },
  RETIRAR: { titulo: 'Retirar ITF vigente', boton: 'Retirar ITF vigente', enviando: 'Retirando…', exito: 'ITF retirado. El pozo quedó sin ITF vigente.' },
  RESTAURAR: { titulo: 'Restaurar como vigente', boton: 'Restaurar como vigente', enviando: 'Restaurando…', exito: 'ITF restaurado. Ya es el ITF vigente del pozo.' },
  RETIRAR_PROPUESTA: { titulo: 'Retirar propuesta', boton: 'Retirar propuesta', enviando: 'Retirando…', exito: 'Propuesta retirada.' }
};

var ITF_TEXTO_REEMPLAZA = 'Esta aprobación reemplazará el ITF vigente actual.';
var ITF_TEXTO_RETIRAR = 'El pozo quedará sin ITF vigente hasta que se apruebe o restaure otro.';
var ITF_TEXTO_VIGENTE_CAMBIO = 'El ITF vigente cambió desde que abriste esta propuesta. Actualizá la información antes de decidir.';
var ITF_TEXTO_SIN_VIGENTE = 'No hay un ITF vigente registrado para este pozo.';
var ITF_TEXTO_ITF_EXISTENTE = 'ITF existente';

function itfLogic_catalogoDe(tipo, hayVigente) {
  if (tipo === 'APROBAR') {
    return hayVigente ? ITF_MOTIVOS_REEMPLAZO : null;
  }
  if (tipo === 'RESTAURAR') {
    return ITF_MOTIVOS_RESTAURACION;
  }
  if (tipo === 'RECHAZAR') {
    return ITF_MOTIVOS_RECHAZO;
  }
  if (tipo === 'RETIRAR') {
    return ITF_MOTIVOS_RETIRO;
  }
  return null;
}

// Un motivo valido para el formulario: {ok:true, motivoCodigo, motivoTexto} | {ok:false, code, mensaje}. OTRO exige texto de 3 a 300 caracteres; un texto con otro motivo es opcional (si lo hay, tambien se valida).
function itfLogic_validarMotivo(catalogo, codigo, texto) {
  if (catalogo === null) {
    return { ok: true, motivoCodigo: undefined, motivoTexto: undefined };
  }
  var valido = false;
  for (var i = 0; i < catalogo.length; i++) {
    if (catalogo[i].codigo === codigo) {
      valido = true;
    }
  }
  if (!valido) {
    return { ok: false, code: 'INVALID_MOTIVO', mensaje: 'Elegí un motivo.' };
  }
  var limpio = typeof texto === 'string' ? texto.replace(/\s+/g, ' ').trim() : '';
  if (codigo === ITF_CODIGO_OTRO && limpio === '') {
    return { ok: false, code: 'INVALID_MOTIVO_TEXTO', mensaje: 'Escribí el detalle del motivo.' };
  }
  if (limpio !== '' && (limpio.length < ITF_MOTIVO_TEXTO_MIN || limpio.length > ITF_MOTIVO_TEXTO_MAX)) {
    return { ok: false, code: 'INVALID_MOTIVO_TEXTO', mensaje: 'El detalle debe tener entre ' + ITF_MOTIVO_TEXTO_MIN + ' y ' + ITF_MOTIVO_TEXTO_MAX + ' caracteres.' };
  }
  return { ok: true, motivoCodigo: codigo, motivoTexto: limpio === '' ? undefined : limpio };
}

function itfLogic_textoMotivo(catalogo, codigo) {
  for (var i = 0; i < catalogo.length; i++) {
    if (catalogo[i].codigo === codigo) {
      return catalogo[i].texto;
    }
  }
  return '';
}

// Texto de un motivo ya guardado (rechazo / retiro institucional) para el proponente y el historial. El codigo desconocido no se muestra crudo.
function itfLogic_textoMotivoGuardado(codigo) {
  var catalogos = [ITF_MOTIVOS_RECHAZO, ITF_MOTIVOS_RETIRO, ITF_MOTIVOS_REEMPLAZO];
  for (var i = 0; i < catalogos.length; i++) {
    var t = itfLogic_textoMotivo(catalogos[i], codigo);
    if (t !== '') {
      return t;
    }
  }
  return codigo === 'CANCELADO_POR_PROPONENTE' ? 'Retirada por quien la propuso' : '';
}

// --- estados y eventos ---

var ITF_ESTADOS_PROPUESTA = {
  PROPUESTO: 'Pendiente de validación',
  APROBADO: 'Aprobada: es el ITF vigente',
  REEMPLAZADO: 'Aprobada, luego reemplazada',
  RECHAZADO: 'Rechazada',
  RETIRADO: 'Retirada'
};

function itfLogic_textoEstadoPropuesta(estado) {
  return Object.prototype.hasOwnProperty.call(ITF_ESTADOS_PROPUESTA, estado) ? ITF_ESTADOS_PROPUESTA[estado] : '';
}

var ITF_ESTADOS_DOCUMENTO_TEXTO = {
  PROPUESTO: 'Propuesto',
  VIGENTE: 'Vigente',
  REEMPLAZADO: 'Reemplazado',
  RECHAZADO: 'Rechazado',
  RETIRADO: 'Retirado'
};

function itfLogic_textoEstadoDocumento(estado) {
  return Object.prototype.hasOwnProperty.call(ITF_ESTADOS_DOCUMENTO_TEXTO, estado) ? ITF_ESTADOS_DOCUMENTO_TEXTO[estado] : '';
}

var ITF_EVENTOS_TEXTO = {
  ITF_PROPUESTO: 'Propuesto',
  ITF_APROBADO: 'Aprobado',
  ITF_RECHAZADO: 'Rechazado',
  ITF_RETIRADO: 'Retirado',
  ITF_REVERTIDO: 'Restaurado'
};

// El registro del ITF existente (ITF_LEGACY_REGISTRADO) es contabilidad interna que el sistema escribe solo antes del primer reemplazo / retiro / restauracion: la linea de tiempo NO lo muestra (el documento
// sigue apareciendo como "ITF existente" en la lista de documentos). Un evento desconocido tampoco se muestra crudo.
function itfLogic_textoEvento(evento) {
  return Object.prototype.hasOwnProperty.call(ITF_EVENTOS_TEXTO, evento) ? ITF_EVENTOS_TEXTO[evento] : '';
}

// Nombre para mostrar de un documento: el existente (legacy) no tiene nombre de archivo ni id visible.
function itfLogic_nombreDocumento(doc) {
  if (!doc) {
    return '';
  }
  if (doc.origen === 'LEGACY' || (typeof doc.documentoId === 'string' && doc.documentoId.indexOf('LEGACY:') === 0)) {
    return ITF_TEXTO_ITF_EXISTENTE;
  }
  return typeof doc.nombreOriginal === 'string' && doc.nombreOriginal !== '' ? doc.nombreOriginal : 'Documento propuesto';
}

// La frase de cada movimiento la arma la PANTALLA (con tildes y sin lenguaje tecnico); no se muestra el `detalle` crudo del servidor. Una aprobacion de quien habia propuesto se dice sin alarma.
function itfLogic_detalleEvento(h, doc) {
  var reemplaza = typeof h.documentoReemplazadoId === 'string' && h.documentoReemplazadoId !== '';
  if (h.evento === 'ITF_PROPUESTO') {
    return 'Se propuso un ITF para el pozo.';
  }
  if (h.evento === 'ITF_APROBADO') {
    return (reemplaza ? 'Se aprobó y reemplazó al ITF vigente anterior.' : 'Se aprobó como ITF vigente del pozo.') + (doc && doc.autoaprobado === true ? ' Propuesto y aprobado por la misma persona.' : '');
  }
  if (h.evento === 'ITF_RECHAZADO') {
    return 'Se rechazó la propuesta.';
  }
  if (h.evento === 'ITF_RETIRADO') {
    return h.motivoCodigo === 'CANCELADO_POR_PROPONENTE' ? 'Quien la propuso retiró su propuesta.' : 'Se retiró el documento.';
  }
  if (h.evento === 'ITF_REVERTIDO') {
    return reemplaza ? 'Se restauró como ITF vigente y dejó de serlo el anterior.' : 'Se restauró como ITF vigente.';
  }
  return '';
}

// Filas de la linea de tiempo del historial: del evento mas nuevo al mas viejo (el servidor ya los ordena asi), sin el registro interno del ITF existente.
// Cada fila: {clave, titulo, quien, cuando, detalle, motivo, documento}. `docs` = {documentoId: documento del historial}.
function itfLogic_filasHistorial(historial, documentos) {
  var porId = {};
  (documentos || []).forEach(function (d) { porId[d.documentoId] = d; });
  var filas = [];
  (historial || []).forEach(function (h, i) {
    var titulo = itfLogic_textoEvento(h.evento);
    if (titulo === '') {
      return;
    }
    var motivo = '';
    var t = itfLogic_textoMotivoGuardado(h.motivoCodigo);
    if (t !== '' && h.motivoCodigo !== ITF_CODIGO_OTRO && h.motivoCodigo !== 'CANCELADO_POR_PROPONENTE') {
      motivo = t;
    }
    if (typeof h.motivoTexto === 'string' && h.motivoTexto !== '') {
      motivo = motivo === '' ? h.motivoTexto : motivo + ': ' + h.motivoTexto;
    }
    filas.push({
      clave: h.evento + '|' + h.documentoId + '|' + h.timestamp + '|' + i,
      titulo: titulo,
      quien: typeof h.nombre === 'string' ? h.nombre : '',
      cuando: itfLogic_formatearFecha(h.timestamp),
      detalle: itfLogic_detalleEvento(h, porId[h.documentoId]),
      motivo: motivo,
      documento: itfLogic_nombreDocumento(porId[h.documentoId])
    });
  });
  return filas;
}

// Documentos "historicos": los que fueron vigentes y ya no lo son (reemplazados o retirados). Acciones: Ver y Restaurar. Se excluyen el vigente actual, las propuestas y los rechazados.
function itfLogic_documentosRestaurables(documentos) {
  return (documentos || []).filter(function (d) { return d.restaurable === true; });
}

function itfLogic_documentoVigente(documentos) {
  var vigentes = (documentos || []).filter(function (d) { return d.estado === 'VIGENTE'; });
  return vigentes.length === 1 ? vigentes[0] : null;
}

// --- mensajes de error ---

var ITF_ERRORES_SESION = ['UNAUTHORIZED', 'USER_DISABLED'];
var ITF_ERRORES_REINTENTABLES = ['SERVICE_UNAVAILABLE', 'ITF_STORAGE_NO_CONFIGURADO', 'RED', 'ERROR'];

var ITF_MENSAJES_ERROR = {
  PERMISSION_DENIED: 'No tenés permiso para hacer esto.',
  ITF_E9_INACTIVO: 'La propuesta y validación de ITF todavía no están habilitadas.',
  INVALID_ARCHIVO: 'El archivo no es una imagen JPEG o PNG válida.',
  FORMATO_NO_RECONOCIDO: 'El archivo no es una imagen JPEG o PNG válida.',
  MIME_NO_PERMITIDO: 'Solo se aceptan imágenes JPEG o PNG.',
  MIME_NO_COINCIDE: 'El archivo no es una imagen JPEG o PNG válida.',
  ARCHIVO_VACIO: 'El archivo está vacío.',
  ARCHIVO_DEMASIADO_GRANDE: 'La imagen supera el tamaño máximo de 3 MB.',
  POZO_NOT_FOUND: 'Este pozo no figura en los registros: no se puede proponer un ITF.',
  TOO_MANY_PENDING: 'Este pozo ya tiene demasiadas propuestas pendientes. Esperá a que se validen.',
  DUPLICADO_DOCUMENTO: 'Este mismo archivo ya fue propuesto para este pozo.',
  LEGACY_AMBIGUO: 'El ITF de este pozo requiere una revisión antes de poder cambiarlo. Avisá a quien administra el sistema.',
  LEGACY_NOMBRE_NO_CANONICO: 'El ITF de este pozo requiere una revisión antes de poder cambiarlo. Avisá a quien administra el sistema.',
  LEGACY_FORMATO_INVALIDO: 'El ITF de este pozo requiere una revisión antes de poder cambiarlo. Avisá a quien administra el sistema.',
  ITF_STATE_UNKNOWN: 'No se puede determinar cuál es el ITF vigente de este pozo. Avisá a quien administra el sistema.',
  INCONSISTENT_STATE: 'El historial de ITF de este pozo requiere una revisión. Avisá a quien administra el sistema.',
  IDEMPOTENCY_CONFLICT: 'No se pudo reintentar este envío. Volvé a elegir el archivo y enviá de nuevo.',
  VIGENTE_CAMBIO: ITF_TEXTO_VIGENTE_CAMBIO,
  DOCUMENTO_NO_PROPUESTO: 'Esta propuesta ya fue resuelta. Actualizá la lista.',
  DOCUMENTO_NO_RETIRABLE: 'Este documento ya no se puede retirar.',
  DESTINO_INVALIDO: 'Este ITF ya no se puede restaurar.',
  ITF_NOT_FOUND: 'El documento ya no está disponible.',
  LEGACY_CAMBIO: 'El ITF existente cambió desde que se registró: no se puede restaurar.',
  LEGACY_NO_DISPONIBLE: 'El ITF existente ya no está disponible.',
  ITF_ARCHIVO_NO_DISPONIBLE: 'El archivo de esta propuesta ya no está disponible: no se puede aprobar.',
  ITF_ARCHIVO_NO_COINCIDE: 'El archivo de esta propuesta no coincide con lo registrado: no se puede aprobar.',
  INVALID_MOTIVO: 'Elegí un motivo.',
  INVALID_MOTIVO_TEXTO: 'El detalle del motivo debe tener entre 3 y 300 caracteres.',
  INVALID_REQUEST: 'No se pudo enviar la solicitud.',
  INVALID_WELL_ID: 'El número de pozo no es válido.',
  INVALID_DOCUMENTO_ID: 'El documento ya no está disponible.',
  SERVICE_UNAVAILABLE: 'No se pudo completar la operación. Probá de nuevo en unos minutos.',
  ITF_STORAGE_NO_CONFIGURADO: 'No se pudo completar la operación. Probá de nuevo en unos minutos.',
  RED: 'No se pudo conectar. Revisá tu conexión e intentá de nuevo.',
  ERROR: 'No se pudo completar la operación. Probá de nuevo en unos minutos.'
};

function itfLogic_codigoDeRespuesta(resp) {
  return resp && typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'ERROR';
}

function itfLogic_esErrorDeSesion(code) {
  return ITF_ERRORES_SESION.indexOf(code) >= 0;
}

function itfLogic_esReintentable(code) {
  return ITF_ERRORES_REINTENTABLES.indexOf(code) >= 0;
}

// Un codigo desconocido o crudo nunca se muestra: cae al mensaje generico.
function itfLogic_mensajeError(code) {
  return Object.prototype.hasOwnProperty.call(ITF_MENSAJES_ERROR, code) ? ITF_MENSAJES_ERROR[code] : ITF_MENSAJES_ERROR.ERROR;
}

// El Perfil al abrir: PROFILE_NOT_FOUND es el mensaje de "no hay ITF vigente"; "no se sabe" jamas se presenta como "no hay".
function itfLogic_mensajePerfil(code) {
  if (code === 'PROFILE_NOT_FOUND') {
    return ITF_TEXTO_SIN_VIGENTE;
  }
  return itfLogic_mensajeError(code);
}

// --- formatos ---

function itfLogic_formatearBytes(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 0) {
    return '';
  }
  if (n < 1024) {
    return n + ' B';
  }
  if (n < 1024 * 1024) {
    return Math.round(n / 1024) + ' KB';
  }
  return (Math.round(n / (1024 * 1024) * 10) / 10).toString().replace('.', ',') + ' MB';
}

// dd/mm/aaaa hh:mm en hora de Mendoza (UTC-3, sin horario de verano). '' si no es una fecha.
function itfLogic_formatearFecha(iso) {
  if (typeof iso !== 'string') {
    return '';
  }
  var t = Date.parse(iso);
  if (isNaN(t)) {
    return '';
  }
  var d = new Date(t - 3 * 3600 * 1000);
  function dos(x) { return (x < 10 ? '0' : '') + x; }
  return dos(d.getUTCDate()) + '/' + dos(d.getUTCMonth() + 1) + '/' + d.getUTCFullYear() + ' ' + dos(d.getUTCHours()) + ':' + dos(d.getUTCMinutes());
}

// --- archivo elegido y reduccion de la imagen ---

var ITF_IMG_TIPOS = ['image/jpeg', 'image/png'];
var ITF_IMG_EXTENSIONES = /\.(jpe?g|png)$/i;
var ITF_IMG_ENTRADA_MAX_BYTES = 40 * 1024 * 1024;   // lo que se acepta ELEGIR (una foto de celular o un escaneo grande); se reduce antes de enviar
var ITF_IMG_LIMITE_BYTES = 3 * 1024 * 1024;         // el maximo del servidor (PROVISORIO hasta medir en Apps Script)
var ITF_IMG_OBJETIVO_BYTES = Math.floor(2.5 * 1024 * 1024);   // lo que se apunta a enviar: deja margen bajo el maximo (el base64 pesa ~4/3)
var ITF_IMG_CONSERVAR_LADO_MAX = 4096;              // un archivo que ya entra en el objetivo y no pasa de este lado no se toca
var ITF_IMG_LADO_MAX = 2400;                        // al reducir: ~A4 a 200 dpi, el texto de un ITF sigue legible
var ITF_IMG_LADO_MIN = 1600;                        // no se baja de esto: por debajo el texto deja de leerse
var ITF_IMG_PASO_LADO = 400;
var ITF_IMG_CALIDADES = [0.92, 0.88, 0.84, 0.80, 0.76];

// Tipo aparente (el servidor mira los bytes reales) y tamano. {ok:true, mimeType} | {ok:false, code, mensaje}.
function itfLogic_validarArchivoElegido(archivo) {
  if (!archivo || typeof archivo !== 'object') {
    return { ok: false, code: 'SIN_ARCHIVO', mensaje: 'Elegí una imagen.' };
  }
  var tipo = typeof archivo.type === 'string' ? archivo.type.toLowerCase() : '';
  var nombre = typeof archivo.name === 'string' ? archivo.name : '';
  if (ITF_IMG_TIPOS.indexOf(tipo) < 0 || (nombre !== '' && !ITF_IMG_EXTENSIONES.test(nombre))) {
    return { ok: false, code: 'TIPO_NO_PERMITIDO', mensaje: 'Solo se aceptan imágenes JPEG o PNG.' };
  }
  if (typeof archivo.size !== 'number' || !isFinite(archivo.size) || archivo.size <= 0) {
    return { ok: false, code: 'ARCHIVO_VACIO', mensaje: 'El archivo está vacío.' };
  }
  if (archivo.size > ITF_IMG_ENTRADA_MAX_BYTES) {
    return { ok: false, code: 'ARCHIVO_ENORME', mensaje: 'La imagen es demasiado grande (máximo ' + itfLogic_formatearBytes(ITF_IMG_ENTRADA_MAX_BYTES) + ').' };
  }
  return { ok: true, mimeType: tipo };
}

// Decide si el archivo se envia TAL CUAL o se reduce. info = {bytes, ancho, alto, mimeType}.
// - Ya entra en el objetivo y no es enorme -> CONSERVAR (los mismos bytes, sin recomprimir: un ITF bien escaneado no se degrada).
// - Si no -> REDUCIR a JPEG (un PNG grande de un escaneo se convierte; una transparencia se aplana sobre blanco).
function itfLogic_planificarImagen(info) {
  var lado = Math.max(info.ancho, info.alto);
  if (info.bytes <= ITF_IMG_OBJETIVO_BYTES && lado <= ITF_IMG_CONSERVAR_LADO_MAX) {
    return { accion: 'CONSERVAR', mimeType: info.mimeType, lado: lado, calidad: null };
  }
  return { accion: 'REDUCIR', mimeType: 'image/jpeg', lado: Math.min(lado, ITF_IMG_LADO_MAX), calidad: ITF_IMG_CALIDADES[0] };
}

// Dimensiones finales: la imagen se reduce proporcionalmente para que su lado mayor sea `lado` (nunca se agranda).
function itfLogic_dimensiones(ancho, alto, lado) {
  var mayor = Math.max(ancho, alto);
  if (mayor <= lado) {
    return { ancho: ancho, alto: alto };
  }
  var f = lado / mayor;
  return { ancho: Math.max(1, Math.round(ancho * f)), alto: Math.max(1, Math.round(alto * f)) };
}

// Escalera de reduccion: primero baja la calidad (0.92 -> 0.76) y recien despues baja el lado (2400 -> 2000 -> 1600), siempre con la calidad mas alta de nuevo. null = ya no hay mas (se bloquea).
// paso = {lado, calidad}. Cada paso mas chico esta pensado para mantener legible el texto de un documento.
function itfLogic_siguientePaso(paso) {
  var i = ITF_IMG_CALIDADES.indexOf(paso.calidad);
  if (i >= 0 && i < ITF_IMG_CALIDADES.length - 1) {
    return { lado: paso.lado, calidad: ITF_IMG_CALIDADES[i + 1] };
  }
  var menor = paso.lado - ITF_IMG_PASO_LADO;
  if (menor >= ITF_IMG_LADO_MIN) {
    return { lado: menor, calidad: ITF_IMG_CALIDADES[0] };
  }
  return null;
}

// Despues de reducir: {ok:true} si entra en el objetivo, si no {ok:false, mensaje}. Nunca se envia algo que el servidor va a rechazar por tamano.
function itfLogic_resultadoDeTamano(bytes) {
  if (typeof bytes !== 'number' || bytes <= 0) {
    return { ok: false, code: 'ARCHIVO_VACIO', mensaje: 'No se pudo preparar la imagen.' };
  }
  if (bytes > ITF_IMG_LIMITE_BYTES) {
    return { ok: false, code: 'ARCHIVO_DEMASIADO_GRANDE', mensaje: 'La imagen sigue pesando ' + itfLogic_formatearBytes(bytes) + ' aun reducida (máximo ' + itfLogic_formatearBytes(ITF_IMG_LIMITE_BYTES) + '). Probá con una imagen más liviana.' };
  }
  return { ok: true };
}

// Nombre sugerido al descargar el ITF segun el tipo REAL de la imagen (un PNG aprobado no se llama .jpg).
function itfLogic_nombreDescarga(wellId, mimeType) {
  return String(wellId) + (mimeType === 'image/png' ? '.png' : '.jpg');
}

// Un data: URI solo con un tipo y un base64 que el servidor realmente puede mandar (jamas un valor arbitrario en src).
var ITF_BASE64_REGEX = /^[A-Za-z0-9+\/]+={0,2}$/;
function itfLogic_dataUri(mimeType, base64) {
  if (ITF_IMG_TIPOS.indexOf(mimeType) < 0 || typeof base64 !== 'string' || base64 === '' || !ITF_BASE64_REGEX.test(base64)) {
    return null;
  }
  return 'data:' + mimeType + ';base64,' + base64;
}

// Foco dentro de un dialogo: -1 = dejar que el navegador mueva el foco; un indice = ir a ESE elemento (se da la vuelta en los bordes).
function itfLogic_siguienteFoco(total, actual, atras) {
  if (total <= 0) {
    return -1;
  }
  if (actual < 0) {
    return atras ? total - 1 : 0;
  }
  if (atras && actual === 0) {
    return total - 1;
  }
  if (!atras && actual === total - 1) {
    return 0;
  }
  return -1;
}

// --- ids de intencion ---

// clientRequestId (A-Za-z0-9_-, 8 a 64). Se crea UNA vez por intencion y se reusa en cada reintento de esa misma intencion.
function itfLogic_nuevoId() {
  try {
    if (typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (err) {
    // sin crypto.randomUUID: se arma uno equivalente abajo
  }
  var hex = '';
  for (var i = 0; i < 32; i++) {
    hex += Math.floor(Math.random() * 16).toString(16);
  }
  return hex;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_MOTIVOS_REEMPLAZO, ITF_MOTIVOS_RECHAZO, ITF_MOTIVOS_RETIRO, ITF_MOTIVOS_RESTAURACION, ITF_MOTIVO_TEXTO_MIN, ITF_MOTIVO_TEXTO_MAX, ITF_CODIGO_OTRO, ITF_ACCIONES_UI,
    ITF_TEXTO_REEMPLAZA, ITF_TEXTO_RETIRAR, ITF_TEXTO_VIGENTE_CAMBIO, ITF_TEXTO_SIN_VIGENTE, ITF_TEXTO_ITF_EXISTENTE, ITF_ESTADOS_PROPUESTA, ITF_ESTADOS_DOCUMENTO_TEXTO, ITF_EVENTOS_TEXTO,
    ITF_MENSAJES_ERROR, ITF_ERRORES_SESION, ITF_ERRORES_REINTENTABLES,
    ITF_IMG_TIPOS, ITF_IMG_ENTRADA_MAX_BYTES, ITF_IMG_LIMITE_BYTES, ITF_IMG_OBJETIVO_BYTES, ITF_IMG_CONSERVAR_LADO_MAX, ITF_IMG_LADO_MAX, ITF_IMG_LADO_MIN, ITF_IMG_PASO_LADO, ITF_IMG_CALIDADES,
    itfLogic_puedeVerPerfil, itfLogic_puedeProponer, itfLogic_puedeValidar, itfLogic_catalogoDe, itfLogic_validarMotivo, itfLogic_textoMotivo, itfLogic_textoMotivoGuardado,
    itfLogic_textoEstadoPropuesta, itfLogic_textoEstadoDocumento, itfLogic_textoEvento, itfLogic_detalleEvento, itfLogic_nombreDocumento, itfLogic_filasHistorial, itfLogic_documentosRestaurables, itfLogic_documentoVigente,
    itfLogic_codigoDeRespuesta, itfLogic_esErrorDeSesion, itfLogic_esReintentable, itfLogic_mensajeError, itfLogic_mensajePerfil, itfLogic_formatearBytes, itfLogic_formatearFecha,
    itfLogic_validarArchivoElegido, itfLogic_planificarImagen, itfLogic_dimensiones, itfLogic_siguientePaso, itfLogic_resultadoDeTamano, itfLogic_nombreDescarga, itfLogic_dataUri, itfLogic_siguienteFoco, itfLogic_nuevoId
  };
}
