// ItfDominioService (E9-2): DOMINIO de los ITF colaborativos (propuesta -> validacion -> vigente -> reemplazo -> retiro -> reversion). Puro: no sabe nada de HTTP (Api.js), de Sheets
// (ItfEventosRepository.js), de Drive ni de caches. Documento de diseno: docs/itf-colaborativos.md. Depende de las constantes de ItfArchivoLogic.js (archivos del mismo proyecto Apps Script).
//
// ESTADO DE ESTA ETAPA: NADA de esto esta cableado (sin endpoints, sin permisos en Usuarios, sin hoja en produccion, sin tocar Drive). El Perfil sigue funcionando EXACTAMENTE como hoy.
//
// MODELO. Una hoja APPEND-ONLY (ItfEventos): una fila = un EVENTO inmutable. No hay columna de estado: el estado de cada documento y del pozo se DERIVA de los eventos.
//   ITF_PROPUESTO         alguien con perfil_subir propone un archivo. Esta fila lleva TODA la metadata inmutable del documento (wellId, mimeType, bytes, sha256, storageFileId, nombreOriginal).
//   ITF_APROBADO          un validador (perfil_validar) aprueba una propuesta: pasa a VIGENTE. Si el pozo ya tenia vigente, el MISMO evento declara cual reemplaza (documentoReemplazadoId): la
//                         propuesta pasa a VIGENTE y el anterior a REEMPLAZADO en una sola fila, asi nunca hay 0 ni 2 vigentes. Reemplazar exige motivo.
//   ITF_RECHAZADO         un validador rechaza una propuesta (motivo obligatorio). Un rechazado jamas es vigente.
//   ITF_RETIRADO          un validador retira un VIGENTE (el pozo queda SIN_ITF) o una propuesta pendiente. Motivo obligatorio. No restaura nada: restaurar es otra accion.
//   ITF_REVERTIDO         un validador restaura un documento que ya fue vigente (REEMPLAZADO o RETIRADO) y lo vuelve VIGENTE; si habia otro vigente, lo declara y pasa a REEMPLAZADO.
//   ITF_LEGACY_REGISTRADO el backend registra, UNA vez y bajo demanda, la huella del ITF legacy (<wellId>.jpg) justo ANTES del primer evento que lo reemplaza, retira o revierte.
// Nunca se borra un archivo ni una fila: retirar / reemplazar / revertir son eventos nuevos.
//
// ESTADOS POR DOCUMENTO (derivados): PROPUESTO | VIGENTE | REEMPLAZADO | RECHAZADO | RETIRADO. "Historico" es una PRESENTACION (REEMPLAZADO, o RETIRADO que alguna vez fue vigente), no un estado mas.
// ESTADO POR POZO: SIN_ITF | PENDIENTE | VIGENTE. Puede haber VIGENTE + propuestas pendientes: lo pendiente NUNCA oculta ni reemplaza al vigente.
//
// BASELINE LEGACY. <wellId>.jpg en la carpeta actual es el ITF VIGENTE LEGACY implicito de ese pozo mientras NINGUN evento E9 lo toque: sin eventos todo se comporta EXACTAMENTE como hoy y no
// se migra, hashea ni mueve nada. Su identificador logico es LEGACY:<wellId> (determinista, NO es un id de Drive ni un hash). Cuando un evento tiene que referirlo (reemplazarlo, retirarlo o
// revertirlo) el backend escribe ANTES un ITF_LEGACY_REGISTRADO con su huella (mimeType, bytes, sha256, id de Drive del archivo y nombre) y recien despues el evento: asi el legacy queda
// referenciable, descargable como historico y restaurable, y se puede verificar que el archivo no cambio. Los dos eventos se escriben juntos (una sola operacion).
// Reglas: el overlay E9 DECIDE el vigente apenas hay un evento E9 que lo defina; si el legacy aparece (o cambia) por fuera del flujo, se ignora con una advertencia. Las cargas manuales a la
// carpeta legacy estan FUERA del flujo institucional: no se bloquean tecnicamente, pero no deben usarse.
//
// FAIL-CLOSED. Si el historial de un pozo es ambiguo o esta corrupto (eventoId o secuencia duplicados, secuencia invalida, evento desconocido, aprobar un documento inexistente / rechazado /
// ya aprobado, dos vigentes incompatibles, evento de otro pozo, documentoId reutilizado con otra metadata, hash cambiado, orfandad...) NO se inventa un estado: el pozo queda
// integridad:'NO_DERIVABLE'. Un problema en los eventos de un pozo NO afecta a los demas ni al ITF legacy de otros pozos.
//
// "TIENE ITF" (contrato): SI solo si existe un ITF VIGENTE valido y derivable. Una propuesta pendiente, un rechazado, un retirado, un reemplazado o un historial corrupto NO cuentan.
// Ante un historial no derivable o un legacy de estado desconocido la respuesta es DESCONOCIDO (en E7 la celda queda vacia), nunca SI.
//
// RETIRO DE LA PROPIA PROPUESTA (E9-3): quien propuso (email del ITF_PROPUESTO, nunca el nombre) con perfil + perfil_subir puede retirarla SOLO mientras siga PROPUESTO, con el mismo evento
// ITF_RETIRADO y el motivo reservado CANCELADO_POR_PROPONENTE (sin texto obligatorio). NO puede retirar algo aprobado, vigente, reemplazado, rechazado ni retirado. Un validador (perfil_validar)
// puede retirar cualquier propuesta pendiente y es el UNICO que retira un vigente, con el catalogo institucional.
//
// AUTORIZACION: permisos exactos (=== true). Proponer: perfil + perfil_subir. Aprobar / rechazar / retirar / revertir: perfil + perfil_validar. Quien tiene ambos puede aprobar su propia
// propuesta (AUTOAPROBACION): son dos acciones y dos eventos distintos, con su propio clientRequestId, y la derivacion lo marca (autoaprobado:true) sin crear un estado especial. No existe una
// accion "proponer y aprobar".
//
// PRIVACIDAD. El email se usa SOLO para idempotencia y para marcar la autoaprobacion; nunca sale en un DTO. Tampoco salen el storageFileId, el sha256 completo (el validador ve una huella
// corta), el clientRequestId ni la secuencia. Un ITF vigente interno NO es publicable: la politica publica (E10) sera otra, encima de esta.
var ITF_EVENTO = {
  PROPUESTO: 'ITF_PROPUESTO',
  APROBADO: 'ITF_APROBADO',
  RECHAZADO: 'ITF_RECHAZADO',
  RETIRADO: 'ITF_RETIRADO',
  REVERTIDO: 'ITF_REVERTIDO',
  LEGACY_REGISTRADO: 'ITF_LEGACY_REGISTRADO'
};
var ITF_EVENTOS = ['ITF_PROPUESTO', 'ITF_APROBADO', 'ITF_RECHAZADO', 'ITF_RETIRADO', 'ITF_REVERTIDO', 'ITF_LEGACY_REGISTRADO'];
var ITF_ESTADOS_DOCUMENTO = { PROPUESTO: 'PROPUESTO', VIGENTE: 'VIGENTE', REEMPLAZADO: 'REEMPLAZADO', RECHAZADO: 'RECHAZADO', RETIRADO: 'RETIRADO' };
var ITF_ESTADOS_POZO = { SIN_ITF: 'SIN_ITF', PENDIENTE: 'PENDIENTE', VIGENTE: 'VIGENTE' };
var ITF_INTEGRIDAD = { OK: 'OK', NO_DERIVABLE: 'NO_DERIVABLE' };
var ITF_ORIGEN = { LEGACY: 'LEGACY', E9: 'E9' };
var ITF_TIENE_ITF = { SI: 'SI', NO: 'NO', DESCONOCIDO: 'DESCONOCIDO' };
var ITF_ACCIONES = { PROPONER: 'PROPONER', APROBAR: 'APROBAR', RECHAZAR: 'RECHAZAR', RETIRAR: 'RETIRAR', RETIRAR_PROPUESTA: 'RETIRAR_PROPUESTA', REVERTIR: 'REVERTIR' };
var ITF_EVENTO_DE_ACCION = { PROPONER: 'ITF_PROPUESTO', APROBAR: 'ITF_APROBADO', RECHAZAR: 'ITF_RECHAZADO', RETIRAR: 'ITF_RETIRADO', RETIRAR_PROPUESTA: 'ITF_RETIRADO', REVERTIR: 'ITF_REVERTIDO' };

// Catalogos de motivos (TENTATIVOS: se ajustan con los casos reales de E9-8). OTRO exige texto.
var ITF_MOTIVOS_RECHAZO = ['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA', 'OTRO'];
var ITF_MOTIVOS_REEMPLAZO = ['ACTUALIZACION', 'CORRECCION', 'MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO', 'OTRO'];
var ITF_MOTIVOS_RETIRO = ['ERROR_DE_APROBACION', 'DOCUMENTO_INCORRECTO', 'NO_CORRESPONDE_POZO', 'DESACTUALIZADO', 'OTRO'];
// Motivo RESERVADO al retiro voluntario de la propia propuesta (RETIRAR_PROPUESTA). No es del catalogo institucional: un validador no puede elegirlo, y la derivacion lo acepta SOLO si
// quien retira es quien propuso (email del ITF_PROPUESTO) y el documento sigue PROPUESTO. No exige texto.
var ITF_MOTIVO_CANCELACION = 'CANCELADO_POR_PROPONENTE';

var ITF_MOTIVO_TEXTO_MIN = 3;
var ITF_MOTIVO_TEXTO_MAX = 300;
var ITF_NOMBRE_MAX = 120;
var ITF_NOMBRE_NEUTRO = 'Usuario';
var ITF_PROPUESTAS_PENDIENTES_MAX = 10;
var ITF_HUELLA_LARGO = 12;
var ITF_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
var ITF_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var ITF_WELLID_REGEX = /^\d{2}-\d{4}$/;
var ITF_LEGACY_ID_REGEX = /^LEGACY:(\d{2}-\d{4})$/;
var ITF_EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;
var ITF_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;        // ISO 8601 UTC: un timestamp sin hora o sin zona no es confiable

function itfDominio_error(code, message) {
  return { ok: false, code: code, message: message };
}

// --- Normalizacion ---

function itfDominio_texto(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Entero >= 1 o null.
function itfDominio_secuencia(v) {
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
  return isFinite(n) && Math.floor(n) === n && n >= 1 ? n : null;
}

// ISO 8601 o null.
function itfDominio_fechaIso(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  var d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function itfDominio_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

// Misma regla que las observaciones (E5) y la moderacion de fotos (E8): CRLF / CR / NEL / LS / PS -> "\n"; tab -> espacio; se eliminan controles, direccionales y surrogates sueltos; trim.
// Devuelve el texto normalizado o null si no es un string. (Un test compara esta funcion con la de E8 para que no se desvien.)
function itfDominio_normalizarTexto(texto) {
  if (typeof texto !== 'string') {
    return null;
  }
  return texto
    .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim();
}

function itfDominio_largoTexto(texto) {
  return Array.from(texto).length;
}

// Nombre de presentacion: una linea, sin controles, acotado; neutro si falta o parece un email. NUNCA se usa para autorizar.
function itfDominio_nombreVisible(nombre) {
  var n = itfDominio_normalizarTexto(typeof nombre === 'string' ? nombre : '') || '';
  n = n.replace(/\s+/g, ' ').trim();
  if (Array.from(n).length > ITF_NOMBRE_MAX) {
    n = Array.from(n).slice(0, ITF_NOMBRE_MAX).join('');
  }
  return n === '' || n.indexOf('@') !== -1 ? ITF_NOMBRE_NEUTRO : n;
}

// UUID en minuscula o '' si no lo es.
function itfDominio_uuid(v) {
  var s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return ITF_UUID_REGEX.test(s) ? s : '';
}

// --- Identificadores de documento ---

// Identificador logico del ITF legacy de un pozo. NO es un id de Drive ni un hash; se puede mostrar sin riesgo (solo contiene el wellId).
function itfDominio_idLegacy(wellId) {
  return 'LEGACY:' + wellId;
}

// {tipo:'E9', id} (UUID en minuscula) | {tipo:'LEGACY', id:'LEGACY:DD-PPPP', wellId} | null. No hay otra "magia": ni mayusculas en LEGACY ni espacios internos.
function itfDominio_idDocumento(v) {
  if (typeof v !== 'string') {
    return null;
  }
  var s = v.trim();
  var m = ITF_LEGACY_ID_REGEX.exec(s);
  if (m) {
    return { tipo: ITF_ORIGEN.LEGACY, id: s, wellId: m[1] };
  }
  var u = itfDominio_uuid(s);
  return u === '' ? null : { tipo: ITF_ORIGEN.E9, id: u, wellId: null };
}

// --- Metadata de un documento ---

// Campos {mimeType, bytes, sha256, storageFileId, nombreOriginal} -> {ok:true, meta} | {ok:false}. Es la MISMA regla para leer una fila y para validar lo que va a escribirse.
function itfDominio_metadataDeCampos(c) {
  var d = c !== null && typeof c === 'object' ? c : {};
  var mime = typeof d.mimeType === 'string' ? d.mimeType.trim() : '';
  if (ITF_MIME_PERMITIDOS.indexOf(mime) < 0) {
    return { ok: false };
  }
  var b = d.bytes;
  var bytes = typeof b === 'number' ? b : (typeof b === 'string' && /^\d+$/.test(b.trim()) ? Number(b.trim()) : NaN);
  if (!isFinite(bytes) || Math.floor(bytes) !== bytes || bytes < 1 || bytes > ITF_ARCHIVO_BYTES_MAX) {
    return { ok: false };
  }
  var sha = typeof d.sha256 === 'string' ? d.sha256.trim() : '';
  if (!ITF_SHA256_REGEX.test(sha)) {
    return { ok: false };
  }
  var storage = typeof d.storageFileId === 'string' ? d.storageFileId.trim() : '';
  if (!ITF_STORAGE_ID_REGEX.test(storage)) {
    return { ok: false };
  }
  var nombre = typeof d.nombreOriginal === 'string' ? d.nombreOriginal.trim() : '';
  if (nombre === '' || Array.from(nombre).length > ITF_NOMBRE_ORIGINAL_MAX || /[\u0000-\u001F\u007F]/.test(nombre)) {
    return { ok: false };
  }
  return { ok: true, meta: { mimeType: mime, bytes: bytes, sha256: sha, storageFileId: storage, nombreOriginal: nombre } };
}

// --- Motivos ---

function itfDominio_motivoAlmacenadoValido(catalogo, codigo, texto) {
  if (catalogo.indexOf(codigo) < 0) {
    return false;
  }
  if (texto === '') {
    return codigo !== 'OTRO';
  }
  var largo = itfDominio_largoTexto(texto);
  return largo >= ITF_MOTIVO_TEXTO_MIN && largo <= ITF_MOTIVO_TEXTO_MAX;
}

// Codigo EXACTO del catalogo (sin trim, sin mayusculas / minusculas) + texto. {ok:true, motivoCodigo, motivoTexto} | {ok:false, code, message} (sin eco del contenido).
function itfDominio_validarMotivo(catalogo, motivoCodigo, motivoTexto) {
  if (typeof motivoCodigo !== 'string' || catalogo.indexOf(motivoCodigo) < 0) {
    return itfDominio_error('INVALID_MOTIVO', 'motivoCodigo obligatorio y del catalogo');
  }
  var texto = '';
  if (motivoTexto !== undefined && motivoTexto !== null) {
    var normalizado = itfDominio_normalizarTexto(motivoTexto);
    if (normalizado === null) {
      return itfDominio_error('INVALID_MOTIVO_TEXTO', 'motivoTexto invalido');
    }
    texto = normalizado;
  }
  if (texto === '') {
    if (motivoCodigo === 'OTRO') {
      return itfDominio_error('INVALID_MOTIVO_TEXTO', 'con el motivo OTRO el texto es obligatorio');
    }
    return { ok: true, motivoCodigo: motivoCodigo, motivoTexto: '' };
  }
  var largo = itfDominio_largoTexto(texto);
  if (largo < ITF_MOTIVO_TEXTO_MIN || largo > ITF_MOTIVO_TEXTO_MAX) {
    return itfDominio_error('INVALID_MOTIVO_TEXTO', 'el texto debe tener entre ' + ITF_MOTIVO_TEXTO_MIN + ' y ' + ITF_MOTIVO_TEXTO_MAX + ' caracteres');
  }
  return { ok: true, motivoCodigo: motivoCodigo, motivoTexto: texto };
}

// --- Permisos (exactos; nunca por nombre) ---

// PROPONER y RETIRAR_PROPUESTA (retirar la PROPIA propuesta, solo mientras siga PROPUESTA): perfil === true Y perfil_subir === true (NO exige perfil_validar). APROBAR / RECHAZAR / RETIRAR / REVERTIR: perfil === true Y perfil_validar === true. Cualquier otro valor (truthy, "SI", 1) o accion
// desconocida -> false. Tener ambos permisos habilita la autoaprobacion, pero siempre como DOS acciones.
function itfDominio_puede(accion, permisos) {
  var p = permisos !== null && typeof permisos === 'object' ? permisos : {};
  if (p.perfil !== true) {
    return false;
  }
  if (accion === ITF_ACCIONES.PROPONER || accion === ITF_ACCIONES.RETIRAR_PROPUESTA) {
    return p.perfil_subir === true;                           // RETIRAR_PROPUESTA ademas exige ser el proponente (se comprueba contra el evento, no aca)
  }
  if (accion === ITF_ACCIONES.APROBAR || accion === ITF_ACCIONES.RECHAZAR || accion === ITF_ACCIONES.RETIRAR || accion === ITF_ACCIONES.REVERTIR) {
    return p.perfil_validar === true;
  }
  return false;
}

// --- Derivacion pura ---

// Un evento "crudo" (fila de la hoja) -> {ok:true, ev} | {ok:false, codigo, wellId, documentoId, fila}. wellId / documentoId = los de la fila si son validos ('' si no): permiten atribuir
// el problema a un pozo. Es la UNICA validacion de forma de una fila: lo que no calza es una fila corrupta, nunca se "corrige".
function itfDominio_parsearEvento(e, orden) {
  if (!e || typeof e !== 'object') {
    return { ok: false, codigo: 'FILA_ROTA', wellId: '', documentoId: '', fila: null };
  }
  var fila = typeof e.fila === 'number' ? e.fila : null;
  var wellId = itfDominio_texto(e.wellId);
  wellId = ITF_WELLID_REGEX.test(wellId) ? wellId : '';
  var docCrudo = itfDominio_idDocumento(itfDominio_texto(e.documentoId));
  function falla(codigo) { return { ok: false, codigo: codigo, wellId: wellId, documentoId: docCrudo !== null && docCrudo.tipo === ITF_ORIGEN.E9 ? docCrudo.id : '', fila: fila }; }
  if (wellId === '') {
    return falla('WELL_ID_INVALIDO');
  }
  var evento = itfDominio_texto(e.evento);
  if (ITF_EVENTOS.indexOf(evento) < 0) {
    return falla('EVENTO_DESCONOCIDO');
  }
  var eventoId = itfDominio_uuid(itfDominio_texto(e.eventoId));
  if (eventoId === '') {
    return falla('ID_INVALIDO');
  }
  var secuencia = itfDominio_secuencia(e.secuencia);
  if (secuencia === null) {
    return falla('SECUENCIA_INVALIDA');
  }
  if (docCrudo === null) {
    return falla('DOCUMENTO_ID_INVALIDO');
  }
  var esLegacy = evento === ITF_EVENTO.LEGACY_REGISTRADO;
  var admiteLegacy = esLegacy || evento === ITF_EVENTO.RETIRADO || evento === ITF_EVENTO.REVERTIDO;
  if (esLegacy ? docCrudo.tipo !== ITF_ORIGEN.LEGACY : (docCrudo.tipo === ITF_ORIGEN.LEGACY && !admiteLegacy)) {
    return falla('DOCUMENTO_ID_INCOHERENTE');
  }
  if (docCrudo.tipo === ITF_ORIGEN.LEGACY && docCrudo.wellId !== wellId) {
    return falla('WELL_CRUZADO');
  }
  var reemplazadoTexto = itfDominio_texto(e.documentoReemplazadoId);
  var reemplazado = null;
  if (reemplazadoTexto !== '') {
    if (evento !== ITF_EVENTO.APROBADO && evento !== ITF_EVENTO.REVERTIDO) {
      return falla('CAMPOS_INCOHERENTES');
    }
    reemplazado = itfDominio_idDocumento(reemplazadoTexto);
    if (reemplazado === null) {
      return falla('DOCUMENTO_REEMPLAZADO_INVALIDO');
    }
    if (reemplazado.tipo === ITF_ORIGEN.LEGACY && reemplazado.wellId !== wellId) {
      return falla('WELL_CRUZADO');
    }
    if (reemplazado.id === docCrudo.id) {
      return falla('REEMPLAZO_IGUAL_AL_DOCUMENTO');
    }
  }
  var conMetadata = evento === ITF_EVENTO.PROPUESTO || esLegacy;
  var camposMeta = { mimeType: itfDominio_texto(e.mimeType), bytes: (e.bytes === null || e.bytes === undefined) ? '' : e.bytes, sha256: itfDominio_texto(e.sha256), storageFileId: itfDominio_texto(e.storageFileId), nombreOriginal: itfDominio_texto(e.nombreOriginal) };
  var meta = null;
  if (conMetadata) {
    var m = itfDominio_metadataDeCampos(camposMeta);
    if (!m.ok) {
      return falla('METADATA_INVALIDA');
    }
    meta = m.meta;
  } else if (camposMeta.mimeType !== '' || itfDominio_texto(camposMeta.bytes) !== '' || camposMeta.sha256 !== '' || camposMeta.storageFileId !== '' || camposMeta.nombreOriginal !== '') {
    return falla('METADATA_EN_EVENTO_POSTERIOR');             // la metadata la fija ITF_PROPUESTO (o el registro del legacy) y nadie mas
  }
  var motivoCodigo = itfDominio_texto(e.motivoCodigo);
  var motivoTexto = itfDominio_texto(e.motivoTexto);
  if (evento === ITF_EVENTO.RECHAZADO) {
    if (!itfDominio_motivoAlmacenadoValido(ITF_MOTIVOS_RECHAZO, motivoCodigo, motivoTexto)) {
      return falla('MOTIVO_INVALIDO');
    }
  } else if (evento === ITF_EVENTO.RETIRADO || evento === ITF_EVENTO.REVERTIDO) {
    var catalogoRetiro = evento === ITF_EVENTO.RETIRADO ? ITF_MOTIVOS_RETIRO.concat([ITF_MOTIVO_CANCELACION]) : ITF_MOTIVOS_RETIRO;
    if (!itfDominio_motivoAlmacenadoValido(catalogoRetiro, motivoCodigo, motivoTexto)) {
      return falla('MOTIVO_INVALIDO');
    }
  } else if (evento === ITF_EVENTO.APROBADO && reemplazado !== null) {
    if (!itfDominio_motivoAlmacenadoValido(ITF_MOTIVOS_REEMPLAZO, motivoCodigo, motivoTexto)) {
      return falla('MOTIVO_INVALIDO');
    }
  } else if (motivoCodigo !== '' || motivoTexto !== '') {
    return falla('CAMPOS_INCOHERENTES');                      // propuesta, registro legacy o primera aprobacion: sin motivo
  }
  var actor = itfDominio_normalizarEmail(e.email);
  if (!ITF_EMAIL_REGEX.test(actor)) {
    return falla('EMAIL_INVALIDO');
  }
  var timestamp = typeof e.timestampUtc === 'string' && !ITF_TIMESTAMP_REGEX.test(e.timestampUtc.trim()) ? null : itfDominio_fechaIso(e.timestampUtc);
  if (timestamp === null) {
    return falla('TIMESTAMP_INVALIDO');
  }
  var clientRequestId = itfDominio_texto(e.clientRequestId);
  if (esLegacy ? clientRequestId !== '' : !ITF_CLIENT_REQUEST_ID_REGEX.test(clientRequestId)) {
    return falla('CLIENT_REQUEST_ID_INVALIDO');
  }
  return {
    ok: true,
    ev: {
      orden: orden, fila: fila, evento: evento, eventoId: eventoId, secuencia: secuencia, wellId: wellId,
      documentoId: docCrudo.id, documentoTipo: docCrudo.tipo, reemplazadoId: reemplazado === null ? '' : reemplazado.id, meta: meta,
      motivoCodigo: motivoCodigo, motivoTexto: motivoTexto, actor: actor, nombre: itfDominio_texto(e.nombre), timestamp: timestamp, clientRequestId: clientRequestId
    }
  };
}

// Resumen de un evento para el historial: lista blanca SIN email, sin clientRequestId, sin storageFileId, sin hash.
function itfDominio_resumenEvento(x) {
  return {
    evento: x.evento, secuencia: x.secuencia, documentoId: x.documentoId, documentoReemplazadoId: x.reemplazadoId,
    nombre: x.nombre, timestamp: x.timestamp, motivoCodigo: x.motivoCodigo, motivoTexto: x.motivoTexto
  };
}

function itfDominio_documentoNuevo(x, origen) {
  return {
    documentoId: x.documentoId, origen: origen, wellId: x.wellId, estado: ITF_ESTADOS_DOCUMENTO.PROPUESTO, fueVigente: false,
    mimeType: x.meta.mimeType, bytes: x.meta.bytes, sha256: x.meta.sha256, storageFileId: x.meta.storageFileId, nombreOriginal: x.meta.nombreOriginal,
    propuesto: { nombre: x.nombre, timestamp: x.timestamp, secuencia: x.secuencia }, aprobacion: null, vigenteDesde: null, cierre: null,
    autoaprobado: false, reemplazaA: null, reemplazadoPor: null, marcaRevision: []
  };
}

function itfDominio_mismaMetadata(a, b) {
  return a.wellId === b.wellId && a.meta.mimeType === b.meta.mimeType && a.meta.bytes === b.meta.bytes && a.meta.sha256 === b.meta.sha256 &&
    a.meta.storageFileId === b.meta.storageFileId && a.meta.nombreOriginal === b.meta.nombreOriginal;
}

// Aplica en orden de secuencia los eventos YA validados de UN pozo. {estado} o {invalido: codigo}.
function itfDominio_aplicarEventos(lista) {
  var st = { docs: {}, orden: [], vigenteId: null, legacyRegistrado: false, huboVigente: false, historial: [] };
  var proponentes = {};
  var invalido = null;
  function exige(id) {
    var d = st.docs[id];
    if (d === undefined) {
      invalido = id.indexOf('LEGACY:') === 0 ? 'LEGACY_NO_REGISTRADO' : 'DOCUMENTO_INEXISTENTE';
      return null;
    }
    return d;
  }
  // El documento que deja de ser vigente por un nuevo vigente (aprobacion o reversion): tiene que ser EXACTAMENTE el vigente actual.
  function desplazar(x, nuevo) {
    if (st.vigenteId !== null) {
      if (x.reemplazadoId === '') {
        invalido = 'REEMPLAZO_NO_DECLARADO';
        return false;
      }
      if (x.reemplazadoId !== st.vigenteId) {
        invalido = 'REEMPLAZO_NO_VIGENTE';
        return false;
      }
      var previo = st.docs[st.vigenteId];
      previo.estado = ITF_ESTADOS_DOCUMENTO.REEMPLAZADO;
      previo.reemplazadoPor = nuevo.documentoId;
      previo.cierre = itfDominio_resumenEvento(x);
      nuevo.reemplazaA = previo.documentoId;
    } else if (x.reemplazadoId !== '') {
      invalido = 'REEMPLAZO_SIN_VIGENTE';
      return false;
    }
    return true;
  }
  for (var i = 0; i < lista.length && invalido === null; i++) {
    var x = lista[i];
    st.historial.push(itfDominio_resumenEvento(x));
    var d;
    if (x.evento === ITF_EVENTO.PROPUESTO) {
      if (st.docs[x.documentoId] !== undefined) {
        invalido = 'DOCUMENTO_ID_DUPLICADO';
      } else {
        st.docs[x.documentoId] = itfDominio_documentoNuevo(x, ITF_ORIGEN.E9);
        st.orden.push(x.documentoId);
        proponentes[x.documentoId] = x.actor;
      }
    } else if (x.evento === ITF_EVENTO.LEGACY_REGISTRADO) {
      if (st.legacyRegistrado) {
        invalido = 'LEGACY_REGISTRADO_DUPLICADO';
      } else if (st.huboVigente || st.vigenteId !== null) {
        invalido = 'LEGACY_REGISTRADO_CON_VIGENTE';
      } else {
        d = itfDominio_documentoNuevo(x, ITF_ORIGEN.LEGACY);
        d.estado = ITF_ESTADOS_DOCUMENTO.VIGENTE;
        d.fueVigente = true;
        d.propuesto = null;
        d.vigenteDesde = x.timestamp;
        st.docs[x.documentoId] = d;
        st.orden.push(x.documentoId);
        st.legacyRegistrado = true;
        st.vigenteId = x.documentoId;
      }
    } else if (x.evento === ITF_EVENTO.APROBADO) {
      d = exige(x.documentoId);
      if (d !== null) {
        if (d.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
          invalido = 'APROBACION_DE_DOCUMENTO_NO_PROPUESTO';
        } else if (desplazar(x, d)) {
          d.estado = ITF_ESTADOS_DOCUMENTO.VIGENTE;
          d.fueVigente = true;
          d.aprobacion = itfDominio_resumenEvento(x);
          d.vigenteDesde = x.timestamp;
          d.autoaprobado = proponentes[d.documentoId] === x.actor;
          st.vigenteId = d.documentoId;
          st.huboVigente = true;
        }
      }
    } else if (x.evento === ITF_EVENTO.RECHAZADO) {
      d = exige(x.documentoId);
      if (d !== null) {
        if (d.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
          invalido = 'RECHAZO_DE_DOCUMENTO_NO_PROPUESTO';
        } else {
          d.estado = ITF_ESTADOS_DOCUMENTO.RECHAZADO;
          d.cierre = itfDominio_resumenEvento(x);
        }
      }
    } else if (x.evento === ITF_EVENTO.RETIRADO) {
      d = exige(x.documentoId);
      if (d !== null && x.motivoCodigo === ITF_MOTIVO_CANCELACION && (d.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO || proponentes[d.documentoId] !== x.actor)) {
        invalido = 'CANCELACION_INVALIDA';                      // el motivo de cancelacion es solo del proponente y solo sobre su propuesta pendiente
      } else if (d !== null) {
        if (d.estado === ITF_ESTADOS_DOCUMENTO.VIGENTE) {
          st.vigenteId = null;
        } else if (d.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
          invalido = 'RETIRO_DE_DOCUMENTO_NO_RETIRABLE';
        }
        if (invalido === null) {
          d.estado = ITF_ESTADOS_DOCUMENTO.RETIRADO;
          d.cierre = itfDominio_resumenEvento(x);
        }
      }
    } else if (x.evento === ITF_EVENTO.REVERTIDO) {
      d = exige(x.documentoId);
      if (d !== null) {
        if (d.fueVigente !== true || (d.estado !== ITF_ESTADOS_DOCUMENTO.REEMPLAZADO && d.estado !== ITF_ESTADOS_DOCUMENTO.RETIRADO)) {
          invalido = 'REVERSION_DESTINO_INVALIDO';
        } else if (desplazar(x, d)) {
          d.estado = ITF_ESTADOS_DOCUMENTO.VIGENTE;
          d.vigenteDesde = x.timestamp;
          d.reemplazadoPor = null;
          d.cierre = null;
          st.vigenteId = d.documentoId;
        }
      }
    }
  }
  return invalido === null ? { estado: st } : { invalido: invalido };
}

// eventos: lista de eventos "crudos" del repositorio (ver itfEventosRepository_eventoDesdeFila). Devuelve
//   {porPozo, documentoPozo, globales}
//   porPozo[wellId] (solo pozos con algun evento o afectados por una inconsistencia):
//     {integridad, inconsistencias:[codigos], documentos:{documentoId -> documento}, orden:[documentoId...], vigenteId, legacyRegistrado, huboVigente, historial:[resumen...]}.
//     integridad 'NO_DERIVABLE' -> sin documentos ni vigente. vigenteId es el vigente segun los EVENTOS (puede ser 'LEGACY:<wellId>' si se registro); null si no hay.
//   documentoPozo[documentoId] = wellId de la propuesta (de TODA ITF_PROPUESTO bien formada, aun de un pozo no derivable): permite distinguir "no existe" de "no se puede derivar".
//   globales: [{codigo, fila}] filas que no se pueden atribuir a ningun pozo (solo diagnostico: no afectan a ninguno).
// Es de USO INTERNO (los documentos llevan storageFileId y sha256): al cliente solo salen los DTO. Nunca incluye el email.
function itfDominio_derivar(eventos) {
  var globales = [];
  var afectados = {};                                   // wellId -> [codigos]
  function marcar(wellId, codigo) {
    if (wellId === '') {
      globales.push({ codigo: codigo, fila: null });
      return;
    }
    afectados[wellId] = afectados[wellId] || [];
    if (afectados[wellId].indexOf(codigo) < 0) {
      afectados[wellId].push(codigo);
    }
  }

  // 1) parseo
  var parseados = [];
  var fallidos = [];
  (eventos || []).forEach(function (e, orden) {
    var p = itfDominio_parsearEvento(e, orden);
    if (p.ok) {
      parseados.push(p.ev);
    } else {
      fallidos.push(p);
    }
  });

  // 2) documentos propuestos: documentoId unico en toda la hoja y una sola metadata por documento
  var propuestas = {};                                  // documentoId -> [eventos ITF_PROPUESTO]
  var documentoPozo = {};
  parseados.forEach(function (x) {
    if (x.evento === ITF_EVENTO.PROPUESTO) {
      (propuestas[x.documentoId] = propuestas[x.documentoId] || []).push(x);
      if (documentoPozo[x.documentoId] === undefined) {
        documentoPozo[x.documentoId] = x.wellId;
      }
    }
  });
  Object.keys(propuestas).forEach(function (id) {
    var lista = propuestas[id];
    if (lista.length >= 2) {
      lista.forEach(function (x) { marcar(x.wellId, 'DOCUMENTO_ID_DUPLICADO'); });
      lista.forEach(function (x) {
        if (!itfDominio_mismaMetadata(lista[0], x)) {
          marcar(x.wellId, 'DOCUMENTO_REUTILIZADO_METADATA_DISTINTA');
        }
      });
    }
  });

  // 3) filas ilegibles: se atribuyen a su pozo, o al pozo de su documento si se conoce; si no, quedan como globales
  fallidos.forEach(function (p) {
    if (p.wellId !== '') {
      marcar(p.wellId, p.codigo);
    } else if (p.documentoId !== '' && documentoPozo[p.documentoId] !== undefined) {
      marcar(documentoPozo[p.documentoId], p.codigo);
    } else {
      globales.push({ codigo: p.codigo, fila: p.fila });
    }
  });

  // 4) eventoId unico, secuencia unica y (usuario, clientRequestId) unico entre TODOS los eventos: una colision afecta a los pozos de las filas involucradas
  var porEventoId = {};
  var porSecuencia = {};
  var porRequest = {};
  parseados.forEach(function (x) {
    (porEventoId[x.eventoId] = porEventoId[x.eventoId] || []).push(x);
    (porSecuencia[x.secuencia] = porSecuencia[x.secuencia] || []).push(x);
    if (x.clientRequestId !== '') {
      var clave = x.actor + '\u0000' + x.clientRequestId;
      (porRequest[clave] = porRequest[clave] || []).push(x);
    }
  });
  function marcarDuplicados(grupos, codigo) {
    Object.keys(grupos).forEach(function (k) {
      if (grupos[k].length >= 2) {
        grupos[k].forEach(function (x) { marcar(x.wellId, codigo); });
      }
    });
  }
  marcarDuplicados(porEventoId, 'EVENTO_ID_DUPLICADO');
  marcarDuplicados(porSecuencia, 'SECUENCIA_DUPLICADA');
  marcarDuplicados(porRequest, 'CLIENT_REQUEST_ID_DUPLICADO');

  // 5) referencias a documentos: tienen que existir y ser del MISMO pozo que el evento
  parseados.forEach(function (x) {
    if (x.evento === ITF_EVENTO.PROPUESTO) {
      return;
    }
    [x.documentoId, x.reemplazadoId].forEach(function (id) {
      if (id === '' || id.indexOf('LEGACY:') === 0) {
        return;
      }
      if (documentoPozo[id] === undefined) {
        marcar(x.wellId, 'DOCUMENTO_INEXISTENTE');
      } else if (documentoPozo[id] !== x.wellId) {
        marcar(x.wellId, 'WELL_CRUZADO');
        marcar(documentoPozo[id], 'WELL_CRUZADO');
      }
    });
  });

  // 6) por pozo: la secuencia de eventos tiene que ser una transicion valida
  var porPozoEventos = {};
  parseados.forEach(function (x) { (porPozoEventos[x.wellId] = porPozoEventos[x.wellId] || []).push(x); });
  var porPozo = {};
  Object.keys(afectados).forEach(function (wellId) {
    porPozo[wellId] = { integridad: ITF_INTEGRIDAD.NO_DERIVABLE, inconsistencias: afectados[wellId].slice(), documentos: {}, orden: [], vigenteId: null, legacyRegistrado: false, huboVigente: false, historial: [] };
  });
  Object.keys(porPozoEventos).forEach(function (wellId) {
    if (afectados[wellId]) {
      return;
    }
    var lista = porPozoEventos[wellId].slice().sort(function (a, b) { return a.secuencia - b.secuencia; });
    var r = itfDominio_aplicarEventos(lista);
    if (r.invalido) {
      porPozo[wellId] = { integridad: ITF_INTEGRIDAD.NO_DERIVABLE, inconsistencias: [r.invalido], documentos: {}, orden: [], vigenteId: null, legacyRegistrado: false, huboVigente: false, historial: [] };
      return;
    }
    var st = r.estado;
    porPozo[wellId] = {
      integridad: ITF_INTEGRIDAD.OK, inconsistencias: [], documentos: st.docs, orden: st.orden, vigenteId: st.vigenteId,
      legacyRegistrado: st.legacyRegistrado, huboVigente: st.huboVigente, historial: st.historial
    };
  });

  // 7) misma huella en OTRO pozo: no se bloquea (un mismo escaneo pudo asociarse mal y justamente necesitar correccion), se MARCA para que el validador lo mire
  var pozosPorHuella = {};
  parseados.forEach(function (x) {
    if (x.meta !== null) {
      (pozosPorHuella[x.meta.sha256] = pozosPorHuella[x.meta.sha256] || {})[x.wellId] = true;
    }
  });
  Object.keys(porPozo).forEach(function (wellId) {
    var p = porPozo[wellId];
    p.orden.forEach(function (id) {
      var d = p.documentos[id];
      var otros = Object.keys(pozosPorHuella[d.sha256] || {}).filter(function (w) { return w !== wellId; });
      if (otros.length > 0) {
        d.marcaRevision.push('MISMO_HASH_OTRO_POZO');
      }
    });
  });

  return { porPozo: porPozo, documentoPozo: documentoPozo, globales: globales };
}

// --- Estado de un pozo (overlay del legacy) ---

function itfDominio_legacyDisponible(v) {
  return v === true ? true : (v === false ? false : null);
}

function itfDominio_documentosEnOrden(p, filtro) {
  return p.orden.map(function (id) { return p.documentos[id]; }).filter(filtro);
}

// Estado interno de UN pozo: la derivacion de los eventos + el ITF legacy (<wellId>.jpg: true = existe, false = no existe, null/undefined = no se pudo saber).
//   {wellId, integridad, inconsistencias, tieneItf:'SI'|'NO'|'DESCONOCIDO', estado:'SIN_ITF'|'PENDIENTE'|'VIGENTE'|null, vigente, propuestasPendientes, historicos, rechazados, retirados,
//    historial, advertencias, legacy:'DISPONIBLE'|'NO_DISPONIBLE'|'DESCONOCIDO'}
// Reglas: sin ningun evento que lo toque, el legacy existente es el VIGENTE (implicito); en cuanto un evento E9 define el vigente (o el legacy se registro), decide el overlay y el archivo legacy
// suelto se ignora (advertencia). `estado` es null cuando no se puede afirmar (historial no derivable, o vigente que depende de un legacy de estado desconocido).
// Es de USO INTERNO (los documentos llevan storageFileId y sha256): al cliente solo salen itfDominio_dtoLectura / itfDominio_dtoValidador.
function itfDominio_estadoPozo(wellId, derivacion, legacyDisponible) {
  var legacy = itfDominio_legacyDisponible(legacyDisponible);
  var legacyEtiqueta = legacy === true ? 'DISPONIBLE' : (legacy === false ? 'NO_DISPONIBLE' : 'DESCONOCIDO');
  var p = derivacion && derivacion.porPozo ? derivacion.porPozo[wellId] : undefined;
  var base = {
    wellId: wellId, integridad: ITF_INTEGRIDAD.OK, inconsistencias: [], tieneItf: ITF_TIENE_ITF.DESCONOCIDO, estado: null, vigente: null,
    propuestasPendientes: [], historicos: [], rechazados: [], retirados: [], historial: [], advertencias: [], legacy: legacyEtiqueta
  };
  if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
    base.integridad = ITF_INTEGRIDAD.NO_DERIVABLE;
    base.inconsistencias = p.inconsistencias.slice();
    return base;
  }
  var pendientes = p === undefined ? [] : itfDominio_documentosEnOrden(p, function (d) { return d.estado === ITF_ESTADOS_DOCUMENTO.PROPUESTO; });
  base.propuestasPendientes = pendientes;
  if (p !== undefined) {
    base.historicos = itfDominio_documentosEnOrden(p, function (d) { return d.estado === ITF_ESTADOS_DOCUMENTO.REEMPLAZADO || (d.estado === ITF_ESTADOS_DOCUMENTO.RETIRADO && d.fueVigente === true); });
    base.rechazados = itfDominio_documentosEnOrden(p, function (d) { return d.estado === ITF_ESTADOS_DOCUMENTO.RECHAZADO; });
    base.retirados = itfDominio_documentosEnOrden(p, function (d) { return d.estado === ITF_ESTADOS_DOCUMENTO.RETIRADO && d.fueVigente !== true; });
    base.historial = p.historial.slice();
  }

  var vigente = null;
  var incierto = false;
  if (p !== undefined && p.vigenteId !== null) {
    var doc = p.documentos[p.vigenteId];
    if (doc.origen === ITF_ORIGEN.LEGACY) {
      if (legacy === true) {
        vigente = doc;
      } else if (legacy === false) {
        base.advertencias.push('LEGACY_AUSENTE');
      } else {
        incierto = true;
      }
    } else {
      vigente = doc;
    }
  } else if (p === undefined || (p.legacyRegistrado !== true && p.huboVigente !== true)) {
    if (legacy === true) {
      vigente = {
        documentoId: itfDominio_idLegacy(wellId), origen: ITF_ORIGEN.LEGACY, wellId: wellId, estado: ITF_ESTADOS_DOCUMENTO.VIGENTE, fueVigente: true, implicito: true,
        mimeType: null, bytes: null, sha256: null, storageFileId: null, nombreOriginal: null, propuesto: null, aprobacion: null, vigenteDesde: null, cierre: null,
        autoaprobado: false, reemplazaA: null, reemplazadoPor: null, marcaRevision: []
      };
    } else if (legacy === null) {
      incierto = true;
    }
  }
  if (p !== undefined && legacy === true && p.huboVigente === true && p.legacyRegistrado !== true) {
    base.advertencias.push('LEGACY_IGNORADO');                // el archivo suelto del legacy no decide: ya hay un vigente E9
  }
  if (p !== undefined && p.legacyRegistrado === true && p.vigenteId !== itfDominio_idLegacy(wellId) && legacy === false) {
    base.advertencias.push('LEGACY_HISTORICO_AUSENTE');
  }

  base.vigente = vigente;
  if (incierto) {
    return base;
  }
  base.estado = vigente !== null ? ITF_ESTADOS_POZO.VIGENTE : (pendientes.length > 0 ? ITF_ESTADOS_POZO.PENDIENTE : ITF_ESTADOS_POZO.SIN_ITF);
  base.tieneItf = vigente !== null ? ITF_TIENE_ITF.SI : ITF_TIENE_ITF.NO;
  return base;
}

// 'SI' | 'NO' | 'DESCONOCIDO'. SI solo con un ITF VIGENTE derivable (legacy implicito o registrado y presente, o documento E9 vigente). Una propuesta pendiente, un rechazado, un retirado, un
// reemplazado, un historial corrupto o un legacy de estado desconocido NUNCA dan SI.
function itfDominio_tieneItf(wellId, derivacion, legacyDisponible) {
  return itfDominio_estadoPozo(wellId, derivacion, legacyDisponible).tieneItf;
}

// Contrato "Tiene ITF" para Mi seleccion, el ZIP y la disponibilidad: true SOLO si hay ITF vigente derivable. Para distinguir "No" de "no se sabe" (celda vacia en E7) usar itfDominio_tieneItf.
function itfTieneVigente(wellId, derivacion, legacyDisponible) {
  return itfDominio_tieneItf(wellId, derivacion, legacyDisponible) === ITF_TIENE_ITF.SI;
}

// --- DTO hacia el cliente (listas blancas) ---

function itfDominio_huella(sha256) {
  return typeof sha256 === 'string' ? sha256.slice(0, ITF_HUELLA_LARGO) : null;
}

function itfDominio_dtoVigente(doc) {
  if (doc === null) {
    return null;
  }
  return {
    documentoId: doc.documentoId,
    origen: doc.origen,
    mimeType: doc.mimeType,
    bytes: doc.bytes,
    desde: doc.vigenteDesde
  };
}

// Lo que ve quien SOLO consulta (perfil): si hay ITF vigente y cual descargar. Nada de propuestas, rechazos, historial, nombres de personas, hash ni ids internos.
function itfDominio_dtoLectura(estadoPozo) {
  return {
    wellId: estadoPozo.wellId,
    tieneItf: estadoPozo.tieneItf,
    estado: estadoPozo.estado,
    vigente: itfDominio_dtoVigente(estadoPozo.vigente)
  };
}

function itfDominio_dtoDocumentoValidador(d) {
  var decision = d.cierre || d.aprobacion || null;
  return {
    documentoId: d.documentoId,
    origen: d.origen,
    estado: d.estado,
    mimeType: d.mimeType,
    bytes: d.bytes,
    nombreOriginal: d.nombreOriginal,
    huella: itfDominio_huella(d.sha256),
    propuestoPor: d.propuesto ? itfDominio_nombreVisible(d.propuesto.nombre) : null,
    propuestoEn: d.propuesto ? d.propuesto.timestamp : null,
    aprobadoPor: d.aprobacion ? itfDominio_nombreVisible(d.aprobacion.nombre) : null,
    aprobadoEn: d.aprobacion ? d.aprobacion.timestamp : null,
    vigenteDesde: d.vigenteDesde,
    autoaprobado: d.autoaprobado === true,
    reemplazaA: d.reemplazaA,
    reemplazadoPor: d.reemplazadoPor,
    marcaRevision: d.marcaRevision.slice(),
    decision: decision === null ? null : {
      evento: decision.evento, nombre: itfDominio_nombreVisible(decision.nombre), timestamp: decision.timestamp, motivoCodigo: decision.motivoCodigo, motivoTexto: decision.motivoTexto
    }
  };
}

// El UNICO documento que el ZIP, "Mi seleccion" y la descarga usan para un pozo: el VIGENTE ({documentoId, origen}) o null. Nunca una propuesta, un rechazado, un retirado ni un historico; y
// cuando hay un vigente E9 NO se baja ademas el legacy (aunque el archivo siga en la carpeta): una sola fuente por pozo.
function itfDominio_documentoParaDescarga(estadoPozo) {
  if (!estadoPozo || estadoPozo.tieneItf !== ITF_TIENE_ITF.SI || estadoPozo.vigente === null) {
    return null;
  }
  return { documentoId: estadoPozo.vigente.documentoId, origen: estadoPozo.vigente.origen };
}

// Lo que ve quien valida (perfil_validar): vigente, propuestas pendientes, historicos, rechazados y retirados, sin email, sin storageFileId, sin hash completo y sin secuencias.
function itfDominio_dtoValidador(estadoPozo) {
  var historial = estadoPozo.historial.map(function (h) {
    return { evento: h.evento, documentoId: h.documentoId, documentoReemplazadoId: h.documentoReemplazadoId, nombre: itfDominio_nombreVisible(h.nombre), timestamp: h.timestamp, motivoCodigo: h.motivoCodigo, motivoTexto: h.motivoTexto };
  });
  return {
    wellId: estadoPozo.wellId,
    integridad: estadoPozo.integridad,
    inconsistencias: estadoPozo.inconsistencias.slice(),
    tieneItf: estadoPozo.tieneItf,
    estado: estadoPozo.estado,
    vigente: estadoPozo.vigente === null ? null : itfDominio_dtoDocumentoValidador(estadoPozo.vigente),
    propuestasPendientes: estadoPozo.propuestasPendientes.map(itfDominio_dtoDocumentoValidador),
    historicos: estadoPozo.historicos.map(itfDominio_dtoDocumentoValidador),
    rechazados: estadoPozo.rechazados.map(itfDominio_dtoDocumentoValidador),
    retirados: estadoPozo.retirados.map(itfDominio_dtoDocumentoValidador),
    historial: historial,
    advertencias: estadoPozo.advertencias.slice(),
    legacy: estadoPozo.legacy
  };
}

// --- Escritura: validar -> permiso -> idempotencia -> estado -> eventos ---

// datos (lo que manda el cliente): {accion, clientRequestId, ...}. Cada accion usa SOLO sus campos; uno de otra accion se RECHAZA (no se ignora en silencio).
//   PROPONER: wellId (el archivo y su huella los aporta el servidor en el contexto, nunca el cliente).
//   APROBAR:  documentoId + documentoReemplazadoId (el vigente que quien valida VIO: '' / ausente si no habia; el servidor lo contrasta con el real) + motivo SOLO si reemplaza.
//   RECHAZAR: documentoId + motivo (catalogo de rechazo). RETIRAR: documentoId (vigente, propuesta o LEGACY:<wellId>) + motivo (catalogo de retiro).
//   REVERTIR: documentoId (el que vuelve a ser vigente) + documentoReemplazadoId (el vigente que vio, '' si ninguno) + motivo (catalogo de retiro).
// {ok:true, valores} | {ok:false, code, message} (sin eco del contenido).
function itfDominio_validarComando(datos) {
  var d = datos !== null && typeof datos === 'object' ? datos : {};
  var accion = d.accion;
  if (typeof accion !== 'string' || !Object.prototype.hasOwnProperty.call(ITF_ACCIONES, accion)) {
    return itfDominio_error('INVALID_ACCION', 'accion invalida');
  }
  if (typeof d.clientRequestId !== 'string' || !ITF_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return itfDominio_error('INVALID_CLIENT_REQUEST_ID', 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)');
  }
  function ausente(v) { return v === undefined || v === null || v === ''; }
  // Lista blanca de campos: un campo desconocido (email, actor, nombre, sha256, storageFileId, ...) se RECHAZA, no se ignora en silencio. El actor y los datos del archivo salen de la sesion / del servidor.
  var permitidos = ['accion', 'clientRequestId', 'wellId', 'documentoId', 'documentoReemplazadoId', 'motivoCodigo', 'motivoTexto'];
  var desconocido = Object.keys(d).some(function (k) { return permitidos.indexOf(k) < 0; });
  if (desconocido) {
    return itfDominio_error('INVALID_REQUEST', 'campos que no corresponden a la accion');
  }
  var valores = { accion: accion, clientRequestId: d.clientRequestId };
  if (accion === ITF_ACCIONES.RETIRAR_PROPUESTA) {
    var propia = itfDominio_idDocumento(d.documentoId);
    if (propia === null || propia.tipo !== ITF_ORIGEN.E9) {
      return itfDominio_error('INVALID_DOCUMENTO_ID', 'documentoId invalido');
    }
    if (!ausente(d.wellId) || !ausente(d.documentoReemplazadoId) || !ausente(d.motivoCodigo)) {
      return itfDominio_error('INVALID_REQUEST', 'campos que no corresponden a la accion');
    }
    var textoPropia = '';
    if (!ausente(d.motivoTexto)) {
      var m = itfDominio_validarMotivo(['OTRO'], 'OTRO', d.motivoTexto);
      if (!m.ok) {
        return itfDominio_error('INVALID_MOTIVO_TEXTO', m.message);
      }
      textoPropia = m.motivoTexto;
    }
    valores.documentoId = propia.id;
    valores.documentoReemplazadoId = '';
    valores.motivoCodigo = ITF_MOTIVO_CANCELACION;
    valores.motivoTexto = textoPropia;
    return { ok: true, valores: valores };
  }
  if (accion === ITF_ACCIONES.PROPONER) {
    if (typeof d.wellId !== 'string' || !ITF_WELLID_REGEX.test(d.wellId)) {
      return itfDominio_error('INVALID_WELL_ID', 'wellId invalido');
    }
    if (!ausente(d.documentoId) || !ausente(d.documentoReemplazadoId) || !ausente(d.motivoCodigo) || !ausente(d.motivoTexto)) {
      return itfDominio_error('INVALID_REQUEST', 'campos que no corresponden a la accion');
    }
    valores.wellId = d.wellId;
    return { ok: true, valores: valores };
  }
  var doc = itfDominio_idDocumento(d.documentoId);
  if (doc === null) {
    return itfDominio_error('INVALID_DOCUMENTO_ID', 'documentoId invalido');
  }
  if (!ausente(d.wellId)) {
    return itfDominio_error('INVALID_REQUEST', 'el pozo sale del documento, no se manda');
  }
  valores.documentoId = doc.id;
  if (doc.tipo === ITF_ORIGEN.LEGACY && accion !== ITF_ACCIONES.RETIRAR && accion !== ITF_ACCIONES.REVERTIR) {
    return itfDominio_error('INVALID_DOCUMENTO_ID', 'el ITF legacy no se puede aprobar ni rechazar');
  }
  var admiteReemplazo = accion === ITF_ACCIONES.APROBAR || accion === ITF_ACCIONES.REVERTIR;
  var reemplazado = '';
  if (!ausente(d.documentoReemplazadoId)) {
    if (!admiteReemplazo) {
      return itfDominio_error('INVALID_REQUEST', 'campos que no corresponden a la accion');
    }
    var r = itfDominio_idDocumento(d.documentoReemplazadoId);
    if (r === null) {
      return itfDominio_error('INVALID_DOCUMENTO_ID', 'documentoReemplazadoId invalido');
    }
    if (r.id === doc.id) {
      return itfDominio_error('INVALID_REQUEST', 'un documento no se reemplaza a si mismo');
    }
    reemplazado = r.id;
  }
  valores.documentoReemplazadoId = reemplazado;
  var conMotivo = accion !== ITF_ACCIONES.APROBAR || reemplazado !== '';
  if (!conMotivo) {
    if (!ausente(d.motivoCodigo) || !ausente(d.motivoTexto)) {
      return itfDominio_error('INVALID_REQUEST', 'la primera aprobacion de un pozo sin vigente no lleva motivo');
    }
    valores.motivoCodigo = '';
    valores.motivoTexto = '';
    return { ok: true, valores: valores };
  }
  var catalogo = accion === ITF_ACCIONES.RECHAZAR ? ITF_MOTIVOS_RECHAZO : (accion === ITF_ACCIONES.APROBAR ? ITF_MOTIVOS_REEMPLAZO : ITF_MOTIVOS_RETIRO);
  var motivo = itfDominio_validarMotivo(catalogo, d.motivoCodigo, d.motivoTexto);
  if (!motivo.ok) {
    return motivo;
  }
  valores.motivoCodigo = motivo.motivoCodigo;
  valores.motivoTexto = motivo.motivoTexto;
  return { ok: true, valores: valores };
}

// Ya hay UN evento del usuario con ese clientRequestId (existentes = lo que devuelve itfEventosRepository_buscarPorClientRequestId): ¿es el MISMO pedido?
//   - mas de una coincidencia o sin evento legible -> INCONSISTENT_STATE; otro tipo de evento o con otro contenido -> IDEMPOTENCY_CONFLICT;
//   - mismo contenido -> reintento exacto: {ok:true, accion:'REINTENTO', resultado} (el original, SIN email); no se escribe nada ni se consume secuencia.
// IDEMPOTENCIA (mismo clientRequestId + mismo contenido) y DUPLICADO DOCUMENTAL (mismo sha256) son cosas distintas: esto es lo primero, lo segundo se decide despues y SOLO si no es un reintento.
// Contenido comparado: PROPONER: pozo + sha256 + mimeType + bytes; APROBAR / REVERTIR: documento + reemplazado + motivo; RECHAZAR / RETIRAR: documento + motivo. Timestamp y secuencia no cuentan.
function itfDominio_atenderExistente(existentes, valores, archivo) {
  if (!existentes || existentes.total !== 1 || !existentes.eventos || existentes.eventos.length !== 1) {
    return itfDominio_error('INCONSISTENT_STATE', 'el clientRequestId figura mas de una vez: requiere revision manual');
  }
  var e = existentes.eventos[0];
  var mismo = e.evento === ITF_EVENTO_DE_ACCION[valores.accion];
  if (mismo && valores.accion === ITF_ACCIONES.PROPONER) {
    mismo = e.wellId === valores.wellId && archivo !== null && archivo !== undefined && e.sha256 === archivo.sha256 && e.mimeType === archivo.mimeType && Number(e.bytes) === archivo.bytes;
  } else if (mismo) {
    mismo = e.documentoId === valores.documentoId && itfDominio_texto(e.documentoReemplazadoId) === valores.documentoReemplazadoId &&
      itfDominio_texto(e.motivoCodigo) === valores.motivoCodigo && itfDominio_texto(e.motivoTexto) === valores.motivoTexto;
  }
  if (!mismo) {
    return itfDominio_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido');
  }
  var salida = { ok: true, accion: 'REINTENTO', eventos: [], resultado: { evento: e.evento, documentoId: e.documentoId, wellId: e.wellId }, advertencias: [] };
  if (valores.accion === ITF_ACCIONES.PROPONER) {
    salida.propuesta = { mimeType: e.mimeType, bytes: Number(e.bytes), nombreOriginal: e.nombreOriginal, timestampUtc: e.timestampUtc };
  }
  return salida;
}

// El contexto de un pozo para decidir: el vigente EFECTIVO (el que hay que declarar al reemplazar) y si es el legacy implicito (que hay que registrar antes de tocarlo).
// {ok:true, pozo, vigenteId ('' si ninguno), implicito} | {ok:false, code, message}.
function itfDominio_contextoPozo(wellId, ctx) {
  var derivacion = ctx.derivacion;
  var p = derivacion && derivacion.porPozo ? derivacion.porPozo[wellId] : undefined;
  if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
    return itfDominio_error('ESTADO_NO_DERIVABLE', 'el historial del pozo no se puede derivar: requiere revision manual');
  }
  var legacy = itfDominio_legacyDisponible(ctx.legacy ? ctx.legacy.disponible : null);
  if (p !== undefined && p.vigenteId !== null) {
    return { ok: true, pozo: p, vigenteId: p.vigenteId, implicito: false };
  }
  if (p === undefined || (p.legacyRegistrado !== true && p.huboVigente !== true)) {
    if (legacy === true) {
      return { ok: true, pozo: p, vigenteId: itfDominio_idLegacy(wellId), implicito: true };
    }
    if (legacy === null) {
      return itfDominio_error('LEGACY_ESTADO_DESCONOCIDO', 'no se pudo comprobar el ITF actual del pozo');
    }
  }
  return { ok: true, pozo: p, vigenteId: '', implicito: false };
}

// El evento de registro del legacy, a partir de la huella que arma el servicio (lee el archivo, calcula el hash). null si la huella no es valida.
function itfDominio_eventoLegacy(wellId, snapshot, comun) {
  var s = snapshot !== null && typeof snapshot === 'object' ? snapshot : {};
  var m = itfDominio_metadataDeCampos(s);
  if (!m.ok) {
    return null;
  }
  return itfDominio_eventoBase(comun, {
    evento: ITF_EVENTO.LEGACY_REGISTRADO, documentoId: itfDominio_idLegacy(wellId), wellId: wellId,
    mimeType: m.meta.mimeType, bytes: m.meta.bytes, sha256: m.meta.sha256, storageFileId: m.meta.storageFileId, nombreOriginal: m.meta.nombreOriginal, clientRequestId: ''
  });
}

function itfDominio_eventoBase(comun, campos) {
  return {
    eventoId: comun.nuevoEventoId(),
    evento: campos.evento,
    documentoId: campos.documentoId,
    wellId: campos.wellId,
    documentoReemplazadoId: campos.documentoReemplazadoId || '',
    mimeType: campos.mimeType || '',
    bytes: campos.bytes === undefined ? '' : campos.bytes,
    sha256: campos.sha256 || '',
    storageFileId: campos.storageFileId || '',
    nombreOriginal: campos.nombreOriginal || '',
    motivoCodigo: campos.motivoCodigo || '',
    motivoTexto: campos.motivoTexto || '',
    email: comun.email,
    nombre: comun.nombre,
    timestampUtc: comun.timestampUtc,
    clientRequestId: campos.clientRequestId
  };
}

// Decide TODO lo que hace falta antes de escribir, sin tocar hojas: validar -> permiso -> idempotencia -> estado -> eventos. contexto:
//   {email, nombre, permisos, ahora (Date), derivacion (itfDominio_derivar de TODA la hoja, armada DENTRO del lock), existentes ({total, eventos} del repositorio),
//    nuevoEventoId() -> uuid, nuevoDocumentoId() -> uuid (solo PROPONER),
//    legacy: {disponible: true|false|null, snapshot?: huella del legacy {mimeType, bytes, sha256, storageFileId, nombreOriginal}, sha256?: hash del legacy si se conoce},
//    archivo (solo PROPONER, lo arma el servidor tras validar y guardar el archivo): {mimeType, bytes, sha256, storageFileId, nombreOriginal},
//    pozoExiste (solo PROPONER): true SOLO si una fuente institucional PREVIA (padron, NE, correccion previa o el ITF legacy actual) conoce el pozo. Una propuesta NO prueba que el pozo exista.}
// Resultado: {ok:true, accion:'ESCRIBIR', eventos:[...], resultado:{evento, documentoId, wellId}, advertencias:[...]} (eventos completos MENOS `secuencia`: la pone el repositorio bajo lock; llevan
//   el email SOLO para escribirlos: no reenviar al cliente; pueden ser DOS: el registro del legacy y el evento pedido, que se escriben juntos)
//   | {ok:true, accion:'REINTENTO', eventos:[], resultado, advertencias:[]} | {ok:false, code, message}.
function itfDominio_planificar(comando, contexto) {
  var ctx = contexto || {};
  var v = itfDominio_validarComando(comando);
  if (!v.ok) {
    return v;
  }
  var valores = v.valores;
  if (!itfDominio_puede(valores.accion, ctx.permisos)) {
    return itfDominio_error('PERMISSION_DENIED', 'permiso insuficiente');
  }
  var email = itfDominio_normalizarEmail(ctx.email);
  if (!ITF_EMAIL_REGEX.test(email)) {
    return itfDominio_error('INVALID_REQUEST', 'sesion sin email valido');
  }
  var archivo = null;
  if (valores.accion === ITF_ACCIONES.PROPONER) {
    var m = itfDominio_metadataDeCampos(ctx.archivo);
    if (!m.ok) {
      return itfDominio_error('INVALID_ARCHIVO', 'los datos del archivo no son validos');
    }
    archivo = m.meta;
  }
  if (ctx.existentes && ctx.existentes.total > 0) {
    return itfDominio_atenderExistente(ctx.existentes, valores, archivo);
  }
  var ahora = ctx.ahora instanceof Date && !isNaN(ctx.ahora.getTime()) ? ctx.ahora : null;
  if (ahora === null || typeof ctx.nuevoEventoId !== 'function') {
    throw new Error('itfDominio_planificar: falta ahora (Date) o nuevoEventoId()');
  }
  var comun = {
    email: email,
    nombre: itfDominio_texto(ctx.nombre) === '' ? '' : itfDominio_nombreVisible(ctx.nombre),
    timestampUtc: ahora.toISOString(),
    nuevoEventoId: function () {
      var id = itfDominio_uuid(ctx.nuevoEventoId());
      if (id === '') {
        throw new Error('itfDominio_planificar: nuevoEventoId() no devolvio un UUID');
      }
      return id;
    }
  };
  var legacySnapshot = ctx.legacy ? ctx.legacy.snapshot : null;
  var accion = valores.accion;
  var eventos = [];
  var wellId;
  var documentoId;
  var advertencias = [];

  if (accion === ITF_ACCIONES.PROPONER) {
    wellId = valores.wellId;
    if (ctx.pozoExiste !== true) {
      return itfDominio_error('POZO_NOT_FOUND', 'el pozo no existe');
    }
    var cp = itfDominio_contextoPozoSimple(wellId, ctx);
    if (!cp.ok) {
      return cp;
    }
    var docs = cp.pozo === undefined ? [] : itfDominio_documentosEnOrden(cp.pozo, function () { return true; });
    var legacyHash = ctx.legacy && typeof ctx.legacy.sha256 === 'string' ? ctx.legacy.sha256 : '';
    var duplicado = docs.some(function (d) {
      return d.sha256 === archivo.sha256 && (d.estado === ITF_ESTADOS_DOCUMENTO.PROPUESTO || d.estado === ITF_ESTADOS_DOCUMENTO.VIGENTE || d.estado === ITF_ESTADOS_DOCUMENTO.REEMPLAZADO ||
        (d.estado === ITF_ESTADOS_DOCUMENTO.RETIRADO && d.fueVigente === true));
    }) || (legacyHash !== '' && legacyHash === archivo.sha256 && (cp.pozo === undefined || cp.pozo.legacyRegistrado !== true) && (cp.pozo === undefined || cp.pozo.huboVigente !== true));
    if (duplicado) {
      return itfDominio_error('DUPLICADO_DOCUMENTO', 'ese mismo archivo ya esta propuesto o fue ITF de este pozo');
    }
    var pendientes = docs.filter(function (d) { return d.estado === ITF_ESTADOS_DOCUMENTO.PROPUESTO; }).length;
    if (pendientes >= ITF_PROPUESTAS_PENDIENTES_MAX) {
      return itfDominio_error('PROPUESTAS_PENDIENTES_MAX', 'el pozo ya tiene el maximo de propuestas pendientes');
    }
    var otros = Object.keys((ctx.derivacion && ctx.derivacion.porPozo) || {}).some(function (w) {
      var q = ctx.derivacion.porPozo[w];
      return w !== wellId && q.integridad === ITF_INTEGRIDAD.OK && q.orden.some(function (id) { return q.documentos[id].sha256 === archivo.sha256; });
    });
    if (otros) {
      advertencias.push('MISMO_HASH_OTRO_POZO');
    }
    documentoId = typeof ctx.nuevoDocumentoId === 'function' ? itfDominio_uuid(ctx.nuevoDocumentoId()) : '';
    if (documentoId === '') {
      throw new Error('itfDominio_planificar: nuevoDocumentoId() no devolvio un UUID');
    }
    eventos.push(itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.PROPUESTO, documentoId: documentoId, wellId: wellId, mimeType: archivo.mimeType, bytes: archivo.bytes, sha256: archivo.sha256,
      storageFileId: archivo.storageFileId, nombreOriginal: archivo.nombreOriginal, clientRequestId: valores.clientRequestId
    }));
    return {
      ok: true, accion: 'ESCRIBIR', eventos: eventos, resultado: { evento: ITF_EVENTO.PROPUESTO, documentoId: documentoId, wellId: wellId }, advertencias: advertencias,
      propuesta: { mimeType: archivo.mimeType, bytes: archivo.bytes, nombreOriginal: archivo.nombreOriginal, timestampUtc: comun.timestampUtc }
    };
  }

  // RETIRAR_PROPUESTA: solo el PROPONENTE (el email del evento ITF_PROPUESTO, nunca el nombre) y solo mientras siga PROPUESTO. El documento de otra persona, o inexistente, da el MISMO error:
  // no se filtra que existe. ctx.proponenteDe(documentoId) -> email normalizado del ITF_PROPUESTO ('' si no hay): lo arma el servicio con los eventos crudos.
  if (accion === ITF_ACCIONES.RETIRAR_PROPUESTA) {
    if (typeof ctx.proponenteDe !== 'function') {
      throw new Error('itfDominio_planificar: RETIRAR_PROPUESTA necesita ctx.proponenteDe');
    }
    var proponente = itfDominio_normalizarEmail(ctx.proponenteDe(valores.documentoId));
    if (proponente === '' || proponente !== email) {
      return itfDominio_error('PERMISSION_DENIED', 'permiso insuficiente');
    }
  }
  // acciones sobre un documento existente: el pozo sale del documento, nunca del cliente
  var destino = itfDominio_idDocumento(valores.documentoId);
  var pozoDelDocumento = destino.tipo === ITF_ORIGEN.LEGACY ? destino.wellId : (ctx.derivacion && ctx.derivacion.documentoPozo ? ctx.derivacion.documentoPozo[destino.id] : undefined);
  if (pozoDelDocumento === undefined) {
    return itfDominio_error('DOCUMENTO_NOT_FOUND', 'no existe el documento');
  }
  wellId = pozoDelDocumento;
  documentoId = valores.documentoId;
  var base = itfDominio_contextoPozoSimple(wellId, ctx);          // el historial del pozo tiene que ser derivable
  if (!base.ok) {
    return base;
  }
  var p = base.pozo;
  var doc = p !== undefined ? p.documentos[documentoId] : undefined;
  // El vigente efectivo solo hace falta cuando la accion lo toca: rechazar o retirar una propuesta pendiente no depende de el (ni de que el legacy se pueda leer).
  var tocaVigente = accion === ITF_ACCIONES.APROBAR || accion === ITF_ACCIONES.REVERTIR ||
    (accion === ITF_ACCIONES.RETIRAR && (destino.tipo === ITF_ORIGEN.LEGACY || (doc !== undefined && doc.estado === ITF_ESTADOS_DOCUMENTO.VIGENTE)));
  var cx = { ok: true, pozo: p, vigenteId: '', implicito: false };
  if (tocaVigente) {
    cx = itfDominio_contextoPozo(wellId, ctx);
    if (!cx.ok) {
      return cx;
    }
  }

  function conRegistroLegacy(principal) {
    if (cx.implicito !== true) {
      return [principal];
    }
    var registro = itfDominio_eventoLegacy(wellId, legacySnapshot, comun);
    return registro === null ? null : [registro, principal];
  }

  if (accion === ITF_ACCIONES.APROBAR) {
    if (doc === undefined) {
      return itfDominio_error('DOCUMENTO_NOT_FOUND', 'no existe el documento');
    }
    if (doc.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
      return itfDominio_error('DOCUMENTO_NO_PROPUESTO', 'el documento no esta pendiente de revision');
    }
    if (valores.documentoReemplazadoId !== cx.vigenteId) {
      return itfDominio_error('VIGENTE_CAMBIO', 'el ITF vigente del pozo cambio: revisar antes de aprobar');
    }
    var aprobado = itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.APROBADO, documentoId: documentoId, wellId: wellId, documentoReemplazadoId: valores.documentoReemplazadoId,
      motivoCodigo: valores.motivoCodigo, motivoTexto: valores.motivoTexto, clientRequestId: valores.clientRequestId
    });
    eventos = conRegistroLegacy(aprobado);
  } else if (accion === ITF_ACCIONES.RECHAZAR) {
    if (doc === undefined) {
      return itfDominio_error('DOCUMENTO_NOT_FOUND', 'no existe el documento');
    }
    if (doc.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
      return itfDominio_error('DOCUMENTO_NO_PROPUESTO', 'el documento no esta pendiente de revision');
    }
    eventos = [itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.RECHAZADO, documentoId: documentoId, wellId: wellId, motivoCodigo: valores.motivoCodigo, motivoTexto: valores.motivoTexto, clientRequestId: valores.clientRequestId
    })];
  } else if (accion === ITF_ACCIONES.RETIRAR_PROPUESTA) {
    if (doc === undefined || doc.estado !== ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
      return itfDominio_error('DOCUMENTO_NO_RETIRABLE', 'solo se puede retirar una propuesta que sigue pendiente');
    }
    eventos = [itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.RETIRADO, documentoId: documentoId, wellId: wellId, motivoCodigo: valores.motivoCodigo, motivoTexto: valores.motivoTexto, clientRequestId: valores.clientRequestId
    })];
  } else if (accion === ITF_ACCIONES.RETIRAR) {
    var retirable = destino.tipo === ITF_ORIGEN.LEGACY
      ? cx.vigenteId === documentoId
      : (doc !== undefined && (doc.estado === ITF_ESTADOS_DOCUMENTO.VIGENTE || doc.estado === ITF_ESTADOS_DOCUMENTO.PROPUESTO));
    if (destino.tipo === ITF_ORIGEN.E9 && doc === undefined) {
      return itfDominio_error('DOCUMENTO_NOT_FOUND', 'no existe el documento');
    }
    if (!retirable) {
      return itfDominio_error('DOCUMENTO_NO_RETIRABLE', 'el documento no es el vigente ni una propuesta pendiente');
    }
    var retirado = itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.RETIRADO, documentoId: documentoId, wellId: wellId, motivoCodigo: valores.motivoCodigo, motivoTexto: valores.motivoTexto, clientRequestId: valores.clientRequestId
    });
    eventos = conRegistroLegacy(retirado);
  } else {                                                // REVERTIR
    if (doc === undefined) {
      return itfDominio_error('DOCUMENTO_NOT_FOUND', 'no existe el documento');
    }
    if (doc.fueVigente !== true || (doc.estado !== ITF_ESTADOS_DOCUMENTO.REEMPLAZADO && doc.estado !== ITF_ESTADOS_DOCUMENTO.RETIRADO)) {
      return itfDominio_error('DESTINO_INVALIDO', 'solo se puede restaurar un documento que ya fue vigente y dejo de serlo');
    }
    if (doc.origen === ITF_ORIGEN.LEGACY && itfDominio_legacyDisponible(ctx.legacy ? ctx.legacy.disponible : null) !== true) {
      return itfDominio_error('LEGACY_NO_DISPONIBLE', 'el archivo legacy ya no esta disponible');
    }
    if (doc.origen === ITF_ORIGEN.LEGACY && ctx.legacy.huellaCoincide !== true) {
      return itfDominio_error('LEGACY_CAMBIO', 'el archivo legacy ya no es el que se registro: no se restaura');          // nunca se restaura en silencio un archivo distinto
    }
    if (valores.documentoReemplazadoId !== cx.vigenteId) {
      return itfDominio_error('VIGENTE_CAMBIO', 'el ITF vigente del pozo cambio: revisar antes de restaurar');
    }
    eventos = [itfDominio_eventoBase(comun, {
      evento: ITF_EVENTO.REVERTIDO, documentoId: documentoId, wellId: wellId, documentoReemplazadoId: valores.documentoReemplazadoId,
      motivoCodigo: valores.motivoCodigo, motivoTexto: valores.motivoTexto, clientRequestId: valores.clientRequestId
    })];
  }
  if (eventos === null) {
    return itfDominio_error('LEGACY_SNAPSHOT_REQUERIDO', 'falta la huella del ITF legacy para registrarlo antes de modificarlo');
  }
  return { ok: true, accion: 'ESCRIBIR', eventos: eventos, resultado: { evento: ITF_EVENTO_DE_ACCION[accion], documentoId: documentoId, wellId: wellId }, advertencias: advertencias };
}

// Para PROPONER: el pozo tiene que ser derivable. No depende del vigente (proponer nunca lo toca), asi que un legacy de estado desconocido no bloquea.
function itfDominio_contextoPozoSimple(wellId, ctx) {
  var p = ctx.derivacion && ctx.derivacion.porPozo ? ctx.derivacion.porPozo[wellId] : undefined;
  if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
    return itfDominio_error('ESTADO_NO_DERIVABLE', 'el historial del pozo no se puede derivar: requiere revision manual');
  }
  return { ok: true, pozo: p };
}

// --- E9-5: cola de pendientes, documento para moderacion, historial por pozo y respuesta de escritura (todo PURO, sin Sheets ni Drive) ---
// Ningun DTO de esta seccion lleva email, storageFileId, sha256 (ni su huella corta), clientRequestId ni secuencia. La unica "advertencia" derivada del hash es un BOOLEANO (mismo archivo asociado a otro pozo).
var ITF_PENDIENTES_LIMITE_DEFECTO = 20;
var ITF_PENDIENTES_LIMITE_MAX = 50;
var ITF_CURSOR_PREFIJO = 's1:';
var ITF_MARCA_OTRO_POZO = 'MISMO_HASH_OTRO_POZO';
var ITF_MENSAJE_OTRO_POZO = 'Este mismo archivo aparece asociado a otro pozo.';
var ITF_ESTADO_TRAS_EVENTO = { ITF_APROBADO: 'VIGENTE', ITF_RECHAZADO: 'RECHAZADO', ITF_RETIRADO: 'RETIRADO', ITF_REVERTIDO: 'VIGENTE' };

// limite (entero 1..MAX, por defecto 20) y cursor (opaco: 's1:<n>') -> {ok:true, limite, cursor (numero o null)} | {ok:false, code, message}.
// El cursor es la secuencia (unica y creciente en TODA la hoja) de la ultima propuesta entregada: "dame las anteriores a esa". Una propuesta nueva tiene una secuencia mayor, asi que no corre las paginas ya
// vistas; una que sale de la cola (aprobada, rechazada, retirada) no deja un hueco ni repite otra, que es lo que rompe un offset.
function itfDominio_validarPaginacion(limite, cursor) {
  var lim = ITF_PENDIENTES_LIMITE_DEFECTO;
  if (limite !== undefined && limite !== null && limite !== '') {
    if (typeof limite !== 'number' || Math.floor(limite) !== limite || limite < 1 || limite > ITF_PENDIENTES_LIMITE_MAX) {
      return itfDominio_error('INVALID_LIMITE', 'limite invalido (1 a ' + ITF_PENDIENTES_LIMITE_MAX + ')');
    }
    lim = limite;
  }
  var cur = null;
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    var m = typeof cursor === 'string' ? /^s1:([1-9]\d{0,14})$/.exec(cursor) : null;
    if (!m) {
      return itfDominio_error('INVALID_CURSOR', 'cursor invalido');
    }
    cur = Number(m[1]);
  }
  return { ok: true, limite: lim, cursor: cur };
}

function itfDominio_dtoPendiente(d, proponenteDe, emailActor) {
  var otroPozo = d.marcaRevision.indexOf(ITF_MARCA_OTRO_POZO) >= 0;
  return {
    documentoId: d.documentoId,
    wellId: d.wellId,
    mimeType: d.mimeType,
    bytes: d.bytes,
    nombreOriginal: d.nombreOriginal,
    nombreProponente: itfDominio_nombreVisible(d.propuesto.nombre),
    timestampUtc: d.propuesto.timestamp,
    autoPropuestaPropia: itfDominio_normalizarEmail(proponenteDe(d.documentoId)) === itfDominio_normalizarEmail(emailActor),
    warningDuplicadoOtroPozo: otroPozo,
    warningMensaje: otroPozo ? ITF_MENSAJE_OTRO_POZO : null
  };
}

// derivacion (itfDominio_derivar de TODA la hoja, UNA sola vez) + {emailActor, proponenteDe(documentoId) -> email, limite, cursor}. Devuelve SOLO documentos PROPUESTO, las mas nuevas primero.
//   {items, siguienteCursor (null si no hay mas), total (pendientes de toda la cola), pozosSinDerivar (pozos con historial roto: sus propuestas no se pueden listar sin inventar un estado)}
// Todo en memoria: ninguna lectura de storage, de Drive ni de la hoja por tarjeta.
function itfDominio_listarPendientes(derivacion, ctx) {
  var c = ctx || {};
  var pozos = derivacion && derivacion.porPozo ? derivacion.porPozo : {};
  var todos = [];
  var sinDerivar = 0;
  Object.keys(pozos).forEach(function (wellId) {
    var p = pozos[wellId];
    if (p.integridad !== ITF_INTEGRIDAD.OK) {
      sinDerivar += 1;
      return;
    }
    p.orden.forEach(function (id) {
      var d = p.documentos[id];
      if (d.estado === ITF_ESTADOS_DOCUMENTO.PROPUESTO) {
        todos.push(d);
      }
    });
  });
  todos.sort(function (a, b) { return b.propuesto.secuencia - a.propuesto.secuencia; });
  var restantes = c.cursor === null || c.cursor === undefined ? todos : todos.filter(function (d) { return d.propuesto.secuencia < c.cursor; });
  var pagina = restantes.slice(0, c.limite);
  var hayMas = restantes.length > pagina.length;
  return {
    items: pagina.map(function (d) { return itfDominio_dtoPendiente(d, c.proponenteDe, c.emailActor); }),
    siguienteCursor: hayMas ? ITF_CURSOR_PREFIJO + pagina[pagina.length - 1].propuesto.secuencia : null,
    total: todos.length,
    pozosSinDerivar: sinDerivar
  };
}

// Documento para el validador, en cualquier estado. Sin huella: el hash no sale ni siquiera abreviado.
function itfDominio_dtoDocumentoModeracion(d, proponenteDe, emailActor) {
  var decision = d.cierre || d.aprobacion || null;
  var propuestoPorYo = d.propuesto ? itfDominio_normalizarEmail(proponenteDe(d.documentoId)) === itfDominio_normalizarEmail(emailActor) : false;
  return {
    documentoId: d.documentoId,
    origen: d.origen,
    wellId: d.wellId,
    estado: d.estado,
    implicito: d.implicito === true,
    mimeType: d.mimeType,
    bytes: d.bytes,
    nombreOriginal: d.nombreOriginal,
    nombreProponente: d.propuesto ? itfDominio_nombreVisible(d.propuesto.nombre) : null,
    propuestoEn: d.propuesto ? d.propuesto.timestamp : null,
    autoPropuestaPropia: propuestoPorYo,
    aprobadoPor: d.aprobacion ? itfDominio_nombreVisible(d.aprobacion.nombre) : null,
    aprobadoEn: d.aprobacion ? d.aprobacion.timestamp : null,
    vigenteDesde: d.vigenteDesde,
    autoaprobado: d.autoaprobado === true,
    reemplazaA: d.reemplazaA,
    reemplazadoPor: d.reemplazadoPor,
    restaurable: d.fueVigente === true && (d.estado === ITF_ESTADOS_DOCUMENTO.REEMPLAZADO || d.estado === ITF_ESTADOS_DOCUMENTO.RETIRADO),
    warningDuplicadoOtroPozo: d.marcaRevision.indexOf(ITF_MARCA_OTRO_POZO) >= 0,
    decision: decision === null ? null : {
      evento: decision.evento, nombre: itfDominio_nombreVisible(decision.nombre), timestamp: decision.timestamp, motivoCodigo: decision.motivoCodigo, motivoTexto: decision.motivoTexto
    }
  };
}

function itfDominio_detalleEvento(h, doc) {
  if (h.evento === ITF_EVENTO.PROPUESTO) {
    return 'Se propuso un ITF para el pozo.';
  }
  if (h.evento === ITF_EVENTO.APROBADO) {
    var auto = doc !== undefined && doc.autoaprobado === true ? ' La aprobo quien lo habia propuesto.' : '';
    return (h.documentoReemplazadoId === '' ? 'Se aprobo como ITF vigente del pozo.' : 'Se aprobo y reemplazo al ITF vigente anterior.') + auto;
  }
  if (h.evento === ITF_EVENTO.RECHAZADO) {
    return 'Se rechazo la propuesta.';
  }
  if (h.evento === ITF_EVENTO.RETIRADO) {
    return h.motivoCodigo === ITF_MOTIVO_CANCELACION ? 'Quien lo propuso retiro su propuesta.' : 'Se retiro el documento.';
  }
  if (h.evento === ITF_EVENTO.REVERTIDO) {
    return h.documentoReemplazadoId === '' ? 'Se restauro como ITF vigente.' : 'Se restauro como ITF vigente y dejo de serlo el anterior.';
  }
  return 'Se registro el ITF original del pozo para poder referenciarlo.';
}

// Historial de UN pozo (derivacion ya verificada: integridad OK), del evento mas nuevo al mas viejo. La lista del pozo viene en orden de secuencia; la secuencia NO sale.
function itfDominio_dtoHistorialPozo(p) {
  return p.historial.slice().reverse().map(function (h) {
    var doc = p.documentos[h.documentoId];
    return {
      evento: h.evento,
      documentoId: h.documentoId,
      documentoReemplazadoId: h.documentoReemplazadoId,
      nombre: itfDominio_nombreVisible(h.nombre),
      timestamp: h.timestamp,
      motivoCodigo: h.motivoCodigo,
      motivoTexto: h.motivoTexto,
      detalle: itfDominio_detalleEvento(h, doc),
      estadoActualDocumento: doc === undefined ? null : doc.estado
    };
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_EVENTO,
    ITF_EVENTOS,
    ITF_ESTADOS_DOCUMENTO,
    ITF_ESTADOS_POZO,
    ITF_INTEGRIDAD,
    ITF_ORIGEN,
    ITF_TIENE_ITF,
    ITF_ACCIONES,
    ITF_EVENTO_DE_ACCION,
    ITF_MOTIVOS_RECHAZO,
    ITF_MOTIVOS_REEMPLAZO,
    ITF_MOTIVOS_RETIRO,
    ITF_MOTIVO_CANCELACION,
    ITF_MOTIVO_TEXTO_MIN,
    ITF_MOTIVO_TEXTO_MAX,
    ITF_PROPUESTAS_PENDIENTES_MAX,
    ITF_CLIENT_REQUEST_ID_REGEX,
    ITF_EMAIL_REGEX,
    itfDominio_texto,
    itfDominio_uuid,
    itfDominio_normalizarEmail,
    itfDominio_normalizarTexto,
    itfDominio_nombreVisible,
    itfDominio_idLegacy,
    itfDominio_idDocumento,
    itfDominio_metadataDeCampos,
    itfDominio_validarMotivo,
    itfDominio_puede,
    itfDominio_parsearEvento,
    itfDominio_derivar,
    itfDominio_estadoPozo,
    itfDominio_tieneItf,
    itfTieneVigente,
    itfDominio_dtoLectura,
    itfDominio_dtoValidador,
    itfDominio_documentoParaDescarga,
    itfDominio_validarComando,
    itfDominio_atenderExistente,
    ITF_WELLID_REGEX,
    ITF_PENDIENTES_LIMITE_DEFECTO,
    ITF_PENDIENTES_LIMITE_MAX,
    ITF_CURSOR_PREFIJO,
    ITF_MARCA_OTRO_POZO,
    ITF_MENSAJE_OTRO_POZO,
    ITF_ESTADO_TRAS_EVENTO,
    itfDominio_validarPaginacion,
    itfDominio_dtoPendiente,
    itfDominio_listarPendientes,
    itfDominio_dtoDocumentoModeracion,
    itfDominio_detalleEvento,
    itfDominio_dtoHistorialPozo,
    itfDominio_planificar
  };
}
