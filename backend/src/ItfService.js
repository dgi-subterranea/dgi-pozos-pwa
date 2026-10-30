// ItfService (E9-3): el ORQUESTADOR de los ITF. Junta el dominio puro (ItfDominioService.js), el repositorio de eventos (ItfEventosRepository.js), el proveedor del ITF legacy (ItfLegacyProvider.js) y el
// contrato del storage E9 (ItfStorageProvider.js). Las reglas de dominio viven en el dominio; Api.js no decide nada de esto. Todo se arma con dependencias INYECTABLES (deps): en produccion salen de
// itfService_depsReales(); los tests pasan hojas, Drive y storage falsos. Documento de diseno: docs/itf-colaborativos.md.
//
// ESTADO DE ESTA ETAPA (E9-3, local, NO productivo): NADA de esto esta cableado a Api.js. ProfileService / getProfile / getItfAvailability de produccion siguen exactamente igual. Justificacion de no
// cablear ahora: (1) la politica nueva de nombre legacy (ambiguo / extension en mayuscula -> "no se sabe" en vez de "el primero") rompe la equivalencia estricta en casos exoticos, y eso se decide al
// cablear; (2) con E9 activo ItfEventos pasa a ser parte del contrato y todavia no existe la hoja ni el storage; (3) cablear es una linea (ProfileService delega aca) que se agrega en E9-4.
//
// INTERRUPTOR: ITF_E9_ACTIVO (Script Property) === 'SI'. Apagado (o ausente) = MODO LEGACY PURO: nunca se lee ItfEventos y el resultado es el del ITF legacy. Encendido = ItfEventos es PARTE DEL
// CONTRATO: si no se puede leer (hoja inexistente, esquema roto, error de Sheets) NO hay fallback al legacy (seria un fallback inseguro: podria mostrar como vigente un ITF ya reemplazado o retirado);
// se responde "no se sabe" / se lanza. Sin eventos para un pozo, el legacy es el vigente: con la hoja vacia el comportamiento es el de hoy.
//
// LECTURA:
//   itfService_resolverVigente(wellId) -> UNA decision institucional por pozo (ver abajo). itfService_getProfile(wellId) la usa y devuelve lo mismo que profileService_getProfile ({found, blob}):
//   resolver cual es el vigente / obtener sus bytes / armar la respuesta son tres pasos separados. itfService_disponibilidad(wellIds) contesta MUCHOS pozos con UNA lectura de ItfEventos, UNA del indice
//   legacy y la derivacion en memoria (cero lecturas por pozo). Un pozo cuyo estado no se puede afirmar se OMITE de la respuesta (el cliente ya lo trata como "no se sabe": nunca como "No").
// ESCRITURA (no expuesta todavia): itfService_ejecutar(sesion, comando, opciones). El actor sale de la SESION (nunca del comando); todo bajo el lock global y RELEYENDO el estado adentro del lock.
//
// CODIGOS INTERNOS (no se exponen ids de Drive ni detalles): ITF_NOT_FOUND, ITF_STATE_UNKNOWN, LEGACY_AMBIGUO, LEGACY_NOMBRE_NO_CANONICO, LEGACY_CAMBIO, LEGACY_FORMATO_INVALIDO, VIGENTE_CAMBIO,
// DUPLICADO_DOCUMENTO, IDEMPOTENCY_CONFLICT, INCONSISTENT_STATE, SERVICE_UNAVAILABLE, ITF_E9_INACTIVO, ITF_STORAGE_NO_CONFIGURADO (+ los de validacion / permisos del dominio).
var ITF_E9_PROPIEDAD = 'ITF_E9_ACTIVO';
var ITF_SERVICE_CODIGOS = [
  'ITF_NOT_FOUND', 'ITF_STATE_UNKNOWN', 'LEGACY_AMBIGUO', 'LEGACY_NOMBRE_NO_CANONICO', 'LEGACY_CAMBIO', 'LEGACY_FORMATO_INVALIDO', 'VIGENTE_CAMBIO', 'DUPLICADO_DOCUMENTO',
  'IDEMPOTENCY_CONFLICT', 'INCONSISTENT_STATE', 'SERVICE_UNAVAILABLE', 'ITF_E9_INACTIVO', 'ITF_STORAGE_NO_CONFIGURADO', 'TOO_MANY_PENDING', 'ITF_ARCHIVO_NO_DISPONIBLE', 'ITF_ARCHIVO_NO_COINCIDE'
];
var ITF_SIN_STORAGE_REF = 'sin-storage-aun';        // valor de relleno valido para el dominio cuando la decision es solo "reintento / conflicto" y no se guardo ningun archivo

// --- dependencias ---

function itfService_e9Activo() {
  return PropertiesService.getScriptProperties().getProperty(ITF_E9_PROPIEDAD) === 'SI';
}

// Pozo conocido por una fuente institucional PREVIA que NO sea un ITF: padron, punto NE o correccion previa. AUDITADO (E9-3): PozoExistenciaService tambien acepta como evidencia el archivo
// <wellId>.jpg legacy (la fuente 'ITF'); para los ITF colaborativos esa rama se EXCLUYE (opciones.excluirFuentes): ningun ITF, ni el legacy ni un documento nuevo, puede ser la evidencia de que el pozo
// existe. (Las propuestas y los documentos E9 de todos modos no estan en la carpeta legacy ni en ninguna otra fuente: no hay circularidad por ahi.) Se reutiliza el servicio existente, con su
// cache y su fail-closed. {existe, indeterminado}. Consecuencia a decidir: un pozo conocido SOLO por su ITF legacy no admite propuestas.
function itfService_pozoExiste(wellId) {
  var r = pozoExistenciaService_verificar(wellId, { excluirFuentes: [POZO_EXISTENCIA_FUENTES.ITF] });
  return { existe: r.existe === true, indeterminado: r.indeterminado === true };
}

function itfService_depsReales() {
  return {
    e9Activo: itfService_e9Activo,
    repo: {
      leerTodos: itfEventosRepository_leerTodos,
      escribirEventos: itfEventosRepository_escribirEventos,
      buscarPorClientRequestId: itfEventosRepository_buscarPorClientRequestId,
      conLock: itfEventosRepository_conLock
    },
    legacy: {
      buscar: itfLegacy_buscar,
      disponibilidad: itfLegacy_disponibilidad,
      huella: itfLegacy_huella,
      verificarHuella: itfLegacy_verificarHuella,
      leerRegistrado: itfLegacy_leerRegistrado
    },
    storage: itfStorage_crearReal(),
    existencia: itfService_pozoExiste,
    // Cache: E9-3 NO cachea la derivacion (una lectura de ItfEventos por pedido, no por pozo; sin evidencia de que haga falta). Este gancho se llama despues de CADA escritura exitosa y de ninguna otra cosa:
    // si E9-4 agrega un cache de estado, se invalida aca. Nunca se cachea un pozo corrupto como vigente.
    invalidarCaches: function () {},
    ahora: function () { return new Date(); },
    nuevoEventoId: function () { return Utilities.getUuid(); },
    nuevoDocumentoId: function () { return Utilities.getUuid(); },
    calcularDigest: undefined
  };
}

function itfService_deps(deps) {
  var reales = itfService_depsReales();
  if (!deps) {
    return reales;
  }
  var d = {};
  Object.keys(reales).forEach(function (k) { d[k] = deps[k] !== undefined ? deps[k] : reales[k]; });
  return d;
}

function itfService_falla(code, message) {
  return { ok: false, code: code, message: message };
}

// Traduce un codigo del dominio al catalogo interno estable del servicio.
function itfService_traducirCodigo(code, legacyEstado) {
  if (code === 'ESTADO_NO_DERIVABLE') {
    return 'ITF_STATE_UNKNOWN';
  }
  if (code === 'DOCUMENTO_NOT_FOUND') {
    return 'ITF_NOT_FOUND';
  }
  if (code === 'PROPUESTAS_PENDIENTES_MAX') {
    return 'TOO_MANY_PENDING';
  }
  if (code === 'LEGACY_ESTADO_DESCONOCIDO') {
    return legacyEstado === ITF_LEGACY_ESTADOS.AMBIGUO ? 'LEGACY_AMBIGUO' : (legacyEstado === ITF_LEGACY_ESTADOS.NO_CANONICO ? 'LEGACY_NOMBRE_NO_CANONICO' : 'ITF_STATE_UNKNOWN');
  }
  return code;
}

function itfService_log(mensaje) {
  try {
    Logger.log('[ItfService] ' + mensaje);
  } catch (err) {
    // sin logger (tests): no pasa nada
  }
}

// --- resolver el vigente ---

// {wellId, estado:'SI'|'NO'|'DESCONOCIDO', origen:'LEGACY'|'E9'|null, documentoId, storageRef, mimeType, bytes, integridad:'OK'|'NO_DERIVABLE', codigo, legacy}
//   storageRef es INTERNO (id de Drive del legacy o storageFileId del documento E9): nunca sale hacia el cliente. mimeType / bytes solo se conocen para un documento E9 (del legacy se sabe al leerlo).
//   codigo: null si SI; ITF_NOT_FOUND si NO; ITF_STATE_UNKNOWN / LEGACY_AMBIGUO / LEGACY_NOMBRE_NO_CANONICO si DESCONOCIDO.
//   Tambien lleva (no enumerable) abrir(): devuelve el blob legacy ya encontrado (evita una segunda llamada a Drive).
// Casos: A sin eventos + legacy unico -> LEGACY vigente. B sin eventos + sin legacy -> NO. C documento E9 vigente -> E9 (no se mira el legacy). D historial NO_DERIVABLE -> DESCONOCIDO (fail-closed).
// Lanza si Drive o Sheets fallan (quien llama responde SERVICE_UNAVAILABLE): un error de infraestructura jamas se vuelve "no existe".
function itfService_resolverVigente(wellId, deps) {
  var d = itfService_deps(deps);
  var res = { wellId: wellId, estado: 'DESCONOCIDO', origen: null, documentoId: null, storageRef: null, mimeType: null, bytes: null, integridad: 'OK', codigo: 'ITF_STATE_UNKNOWN', legacy: null };
  var derivacion = null;
  var p;
  if (d.e9Activo()) {
    derivacion = itfDominio_derivar(d.repo.leerTodos().eventos);
    p = derivacion.porPozo[wellId];
    if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
      res.integridad = ITF_INTEGRIDAD.NO_DERIVABLE;
      return res;
    }
  }
  // el legacy solo se mira si puede decidir algo: con un documento E9 vigente no se toca Drive
  var vigenteE9 = p !== undefined && p.vigenteId !== null && p.documentos[p.vigenteId].origen === ITF_ORIGEN.E9;
  var info = null;
  if (!vigenteE9) {
    info = d.legacy.buscar(wellId);
    res.legacy = info.estado;
  }
  var est = derivacion === null
    ? itfDominio_estadoPozo(wellId, { porPozo: {}, documentoPozo: {}, globales: [] }, itfLegacy_aDisponible(info.estado))
    : itfDominio_estadoPozo(wellId, derivacion, info === null ? false : itfLegacy_aDisponible(info.estado));
  if (est.tieneItf === ITF_TIENE_ITF.NO) {
    res.estado = 'NO';
    res.codigo = 'ITF_NOT_FOUND';
    return res;
  }
  if (est.tieneItf !== ITF_TIENE_ITF.SI) {
    res.codigo = itfService_traducirCodigo('LEGACY_ESTADO_DESCONOCIDO', info === null ? null : info.estado);
    return res;
  }
  var v = est.vigente;
  res.estado = 'SI';
  res.codigo = null;
  res.origen = v.origen;
  res.documentoId = v.documentoId;
  if (v.origen === ITF_ORIGEN.E9) {
    res.storageRef = v.storageFileId;
    res.mimeType = v.mimeType;
    res.bytes = v.bytes;
  } else {
    res.storageRef = info.fileId;
    Object.defineProperty(res, 'abrir', { value: info.leerBlob, enumerable: false });
  }
  return res;
}

// --- obtener los bytes del vigente ---

// {found:true, blob} | {found:false, code} | {found:false, unknown:true, code}: misma forma que profileService_getProfile ({found, blob}); blob tiene getBytes() / getContentType().
function itfService_obtenerBytes(vigente, deps) {
  var d = itfService_deps(deps);
  if (vigente.origen === ITF_ORIGEN.LEGACY) {
    return { found: true, blob: vigente.abrir() };
  }
  var leido = d.storage.leerDocumento(vigente.storageRef);
  if (!leido || leido.ok !== true) {
    itfService_log('el storage no pudo leer el documento vigente de ' + vigente.wellId + ' (' + (leido && leido.code) + ')');
    return { found: false, unknown: true, code: leido && leido.code === ITF_STORAGE_NO_CONFIGURADO ? ITF_STORAGE_NO_CONFIGURADO : 'SERVICE_UNAVAILABLE' };
  }
  return { found: true, blob: itfStorage_comoBlob(leido.bytes, leido.mimeType || vigente.mimeType) };
}

// getProfile desacoplado de donde viene el ITF: resolver -> bytes -> respuesta. El cliente no sabe si es legacy o E9. Con CERO eventos (o modo legacy puro) devuelve el ITF legacy actual.
function itfService_getProfile(wellId, deps) {
  var vigente = itfService_resolverVigente(wellId, deps);
  if (vigente.estado === 'NO') {
    return { found: false, code: 'ITF_NOT_FOUND' };
  }
  if (vigente.estado !== 'SI') {
    return { found: false, unknown: true, code: vigente.codigo };
  }
  return itfService_obtenerBytes(vigente, deps);
}

// --- disponibilidad en lote ---

// {wellId: boolean} para los pozos cuyo estado se puede afirmar. true = hay ITF vigente; false = no hay; un pozo DESCONOCIDO (historial no derivable, legacy ambiguo / no canonico / sin comprobar) se OMITE:
// el contrato actual devuelve booleanos y el cliente ya trata la ausencia como "no se sabe" (E7), asi que es la opcion compatible; JAMAS se devuelve un falso "No". Lecturas: UNA de ItfEventos, UNA del
// indice legacy, derivacion en memoria; independiente de la cantidad de pozos. Lanza si ItfEventos (con E9 activo) o Drive fallan.
function itfService_disponibilidad(wellIds, deps) {
  var d = itfService_deps(deps);
  var resultado = {};
  if (!wellIds || wellIds.length === 0) {
    return resultado;
  }
  var legacy = d.legacy.disponibilidad(wellIds);
  var derivacion = d.e9Activo() ? itfDominio_derivar(d.repo.leerTodos().eventos) : { porPozo: {}, documentoPozo: {}, globales: [] };
  wellIds.forEach(function (wellId) {
    var est = itfDominio_estadoPozo(wellId, derivacion, itfLegacy_aDisponible(legacy[wellId]));
    if (est.tieneItf === ITF_TIENE_ITF.SI) {
      resultado[wellId] = true;
    } else if (est.tieneItf === ITF_TIENE_ITF.NO) {
      resultado[wellId] = false;
    }
  });
  return resultado;
}

// --- descargar un documento cualquiera (historial / validador) ---

// Bytes de un documento por su id, en cualquier estado (vigente, historico, propuesta pendiente): para el historial futuro del validador. Un legacy registrado se lee por el id de Drive que quedo en su
// registro y SOLO se entrega si su contenido sigue coincidiendo con la huella (LEGACY_CAMBIO si no). Un documento E9 sale del storage. {ok:true, blob, estado} | {ok:false, code}.
function itfService_obtenerDocumento(documentoId, deps) {
  var d = itfService_deps(deps);
  var id = itfDominio_idDocumento(documentoId);
  if (id === null || !d.e9Activo()) {
    return itfService_falla(id === null ? 'ITF_NOT_FOUND' : 'ITF_E9_INACTIVO', 'documento no disponible');
  }
  var derivacion = itfDominio_derivar(d.repo.leerTodos().eventos);
  var wellId = id.tipo === ITF_ORIGEN.LEGACY ? id.wellId : derivacion.documentoPozo[id.id];
  var p = wellId === undefined ? undefined : derivacion.porPozo[wellId];
  if (p === undefined || p.integridad !== ITF_INTEGRIDAD.OK) {
    return itfService_falla(p === undefined ? 'ITF_NOT_FOUND' : 'ITF_STATE_UNKNOWN', 'documento no disponible');
  }
  var doc = p.documentos[id.id];
  if (doc === undefined) {
    return itfService_falla('ITF_NOT_FOUND', 'documento no disponible');
  }
  if (doc.origen === ITF_ORIGEN.LEGACY) {
    var r = d.legacy.leerRegistrado(doc);
    return r.found ? { ok: true, blob: r.blob, estado: doc.estado } : itfService_falla(r.code, 'documento no disponible');
  }
  var leido = d.storage.leerDocumento(doc.storageFileId);
  if (!leido || leido.ok !== true) {
    return itfService_falla(leido && leido.code === ITF_STORAGE_NO_CONFIGURADO ? ITF_STORAGE_NO_CONFIGURADO : 'SERVICE_UNAVAILABLE', 'documento no disponible');
  }
  return { ok: true, blob: itfStorage_comoBlob(leido.bytes, leido.mimeType || doc.mimeType), estado: doc.estado };
}

// --- escritura ---

// email normalizado del ITF_PROPUESTO de cada documento (para RETIRAR_PROPUESTA): el DUENO es el email del evento, nunca el nombre.
function itfService_proponentes(eventos) {
  var mapa = {};
  eventos.forEach(function (e) {
    if (e.evento === ITF_EVENTO.PROPUESTO && e.documentoId !== '' && mapa[e.documentoId] === undefined) {
      mapa[e.documentoId] = itfDominio_normalizarEmail(e.email);
    }
  });
  return function (documentoId) { return mapa[documentoId] === undefined ? '' : mapa[documentoId]; };
}

function itfService_pozoDelComando(valores, derivacion) {
  if (valores.wellId) {
    return valores.wellId;
  }
  var id = itfDominio_idDocumento(valores.documentoId);
  if (id === null) {
    return '';
  }
  if (id.tipo === ITF_ORIGEN.LEGACY) {
    return id.wellId;
  }
  return derivacion.documentoPozo[id.id] === undefined ? '' : derivacion.documentoPozo[id.id];
}

// Lee el estado y PLANIFICA (nunca escribe): buscar clientRequestId -> leer TODOS los eventos -> derivar -> (legacy: estado, huella, verificacion) -> planificar. Lo usan la prevalidacion de una
// propuesta (SIN lock, antes de subir nada) y la decision definitiva (adentro del lock). extra (solo PROPONER): {archivo: metadata + storageFileId, documentoId (generado por el servidor ANTES de
// subir, para nombrar el archivo), legacySha256 (huella del legacy vigente, para detectar el mismo archivo)}. Devuelve {plan, legacyEstado, wellId} | {falla}. Puede lanzar (Sheets / Drive).
function itfService_planificar(s, email, comando, valores, d, extra) {
  var e = extra || {};
  var existentes = d.repo.buscarPorClientRequestId(email, valores.clientRequestId);
  var eventos = d.repo.leerTodos().eventos;
  var derivacion = itfDominio_derivar(eventos);
  var wellId = itfService_pozoDelComando(valores, derivacion);
  var accion = valores.accion;
  var legacy = { disponible: null, huellaCoincide: false };
  if (typeof e.legacySha256 === 'string') {
    legacy.sha256 = e.legacySha256;
  }
  var legacyEstado = null;
  if (wellId !== '' && (accion === ITF_ACCIONES.APROBAR || accion === ITF_ACCIONES.RETIRAR || accion === ITF_ACCIONES.REVERTIR)) {
    var info = d.legacy.buscar(wellId);
    legacyEstado = info.estado;
    legacy.disponible = itfLegacy_aDisponible(info.estado);
    var p = derivacion.porPozo[wellId];
    var registrado = p !== undefined && valores.documentoId === itfDominio_idLegacy(wellId) ? p.documentos[valores.documentoId] : undefined;
    if (accion === ITF_ACCIONES.REVERTIR && registrado !== undefined) {
      // restaurar el legacy: se vuelve a LEER el archivo y se verifica contra la huella registrada; nunca se restaura en silencio uno distinto
      legacy.huellaCoincide = info.estado === ITF_LEGACY_ESTADOS.UNICO && info.fileId === registrado.storageFileId && d.legacy.verificarHuella(registrado) === 'COINCIDE';
    }
  }
  var ctx = {
    email: email, nombre: s.nombre, permisos: s.permisos, ahora: d.ahora(), derivacion: derivacion, existentes: existentes, legacy: legacy,
    nuevoEventoId: d.nuevoEventoId, nuevoDocumentoId: e.documentoId ? function () { return e.documentoId; } : d.nuevoDocumentoId, proponenteDe: itfService_proponentes(eventos),
    archivo: e.archivo, pozoExiste: true       // la existencia ya se comprobo ANTES (itfService_evidenciaPropuesta): una propuesta nunca es evidencia de existencia
  };
  var plan = itfDominio_planificar(comando, ctx);
  if (!plan.ok && plan.code === 'LEGACY_SNAPSHOT_REQUERIDO') {
    var h = d.legacy.huella(wellId);
    if (!h.ok) {
      return { falla: itfService_falla(h.code, h.message) };
    }
    ctx.legacy.snapshot = h.huella;
    plan = itfDominio_planificar(comando, ctx);
  }
  if (!plan.ok) {
    return { falla: itfService_falla(itfService_traducirCodigo(plan.code, legacyEstado), plan.message) };
  }
  if (plan.accion === 'ESCRIBIR' && (accion === ITF_ACCIONES.APROBAR || accion === ITF_ACCIONES.REVERTIR)) {
    var archivoFalla = itfService_verificarArchivo(derivacion, wellId, valores.documentoId, d);
    if (archivoFalla !== null) {
      return { falla: archivoFalla };
    }
  }
  if (accion === ITF_ACCIONES.APROBAR) {
    plan.autoaprobado = ctx.proponenteDe(valores.documentoId) === email;                  // se marca, no cambia nada: es la misma accion con otro dato
  }
  return { plan: plan, legacyEstado: legacyEstado, wellId: wellId };
}

// Un documento E9 que va a quedar VIGENTE (aprobar, restaurar) tiene que seguir existiendo en el storage y ser el que se registro (tipo y tamano). Se pregunta adentro del lock, justo antes de escribir.
// El legacy se verifica por su huella (itfService_planificar). null si esta bien | falla.
function itfService_verificarArchivo(derivacion, wellId, documentoId, d) {
  var p = derivacion.porPozo[wellId];
  var doc = p === undefined ? undefined : p.documentos[documentoId];
  if (doc === undefined || doc.origen !== ITF_ORIGEN.E9) {
    return null;
  }
  var meta = d.storage.obtenerMetadata(doc.storageFileId);
  if (!meta || meta.ok !== true) {
    var code = meta && meta.code === ITF_STORAGE_NO_CONFIGURADO ? ITF_STORAGE_NO_CONFIGURADO : (meta && meta.code === 'ITF_NOT_FOUND' ? 'ITF_ARCHIVO_NO_DISPONIBLE' : 'SERVICE_UNAVAILABLE');
    return itfService_falla(code, 'el archivo del documento no esta disponible');
  }
  if (meta.bytes !== doc.bytes || meta.mimeType !== doc.mimeType) {
    return itfService_falla('ITF_ARCHIVO_NO_COINCIDE', 'el archivo guardado no es el que se registro');
  }
  return null;
}

function itfService_resultadoDe(plan, escritos) {
  var r = { ok: true, accion: plan.accion, resultado: plan.resultado, advertencias: plan.advertencias, eventosEscritos: escritos };
  if (plan.propuesta) {
    r.propuesta = plan.propuesta;
  }
  if (plan.autoaprobado !== undefined) {
    r.autoaprobado = plan.autoaprobado;
  }
  return r;
}

// TODO adentro del lock: el estado se RELEE aca (nada de lo decidido antes del lock se reutiliza), se planifica y se escribe (1 o 2 eventos consecutivos en UNA operacion); se invalida la cache DESPUES de liberar el lock. Devuelve el
// resultado del servicio; puede lanzar (Sheets / Drive / lock): quien llama lo traduce a SERVICE_UNAVAILABLE.
function itfService_dentroDelLock(s, email, comando, valores, d, extra) {
  var invalidar = null;
  var res = d.repo.conLock(function () {
    var r = itfService_planificar(s, email, comando, valores, d, extra);
    if (r.falla) {
      return r.falla;
    }
    if (r.plan.accion !== 'ESCRIBIR') {
      return itfService_resultadoDe(r.plan, 0);
    }
    d.repo.escribirEventos(r.plan.eventos);
    invalidar = [r.plan.resultado.wellId];
    return itfService_resultadoDe(r.plan, r.plan.eventos.length);
  });
  // la cache se invalida DESPUES de liberar el lock; si la invalidacion falla, la escritura (ya hecha) no se vuelve un error
  if (invalidar !== null) {
    try {
      d.invalidarCaches(invalidar);
    } catch (err) {
      itfService_log('no se pudo invalidar la cache tras escribir: ' + String(err));
    }
  }
  return res;
}

// Compensacion: SOLO si ninguna fila referencia el archivo. Si la escritura lanzo, puede haberse escrito igual (timeout despues del append): se vuelve a leer ItfEventos y, si no se puede asegurar que
// no hay referencia, NO se borra nada (un archivo huerfano se limpia a mano; uno referenciado que desaparece, no se recupera).
function itfService_compensar(storageRef, d, seguroNoReferenciado) {
  var puedeBorrar = seguroNoReferenciado === true;
  if (!puedeBorrar) {
    try {
      puedeBorrar = !d.repo.leerTodos().eventos.some(function (e) { return e.storageFileId === storageRef; });
    } catch (err) {
      puedeBorrar = false;
    }
  }
  if (!puedeBorrar) {
    itfService_log('archivo temporal sin compensar (no se pudo asegurar que ninguna fila lo referencia): ' + storageRef);
    return 'OMITIDA';
  }
  try {
    var r = d.storage.eliminarTemporal(storageRef);
    if (r && r.ok === true) {
      return 'OK';
    }
  } catch (err) {
    // cae al log de abajo
  }
  itfService_log('archivo temporal huerfano (la compensacion fallo): ' + storageRef);
  return 'FALLO';
}

// REGLA DE EVIDENCIA para proponer (ver docs): una propuesta NUNCA prueba la existencia del pozo.
//   B/D. Hay un ITF vigente: un legacy UNICO / canonico y legible (preexistente a la propuesta: no es circular) o un documento E9 derivable -> se puede proponer una nueva version.
//   C.   Legacy ambiguo, de nombre no canonico, ilegible, o historial no derivable -> NO habilita nada: LEGACY_AMBIGUO / LEGACY_NOMBRE_NO_CANONICO / LEGACY_FORMATO_INVALIDO / ITF_STATE_UNKNOWN (requiere revision).
//   A.   No hay vigente (ni legacy ni E9) -> el pozo debe existir por una fuente institucional INDEPENDIENTE: padron, punto NE o correccion previa (PozoExistenciaService con la rama ITF excluida).
// {ok:true, legacySha256?} | {ok:false, falla}. Lee (eventos, Drive, fuentes) pero no escribe.
function itfService_evidenciaPropuesta(wellId, d) {
  var v = itfService_resolverVigente(wellId, d);
  if (v.estado === 'SI') {
    if (v.origen === ITF_ORIGEN.LEGACY) {
      var h = d.legacy.huella(wellId);
      if (!h.ok) {
        return { ok: false, falla: itfService_falla(h.code, h.message) };
      }
      return { ok: true, legacySha256: h.huella.sha256 };
    }
    return { ok: true };
  }
  if (v.estado === 'DESCONOCIDO') {
    return { ok: false, falla: itfService_falla(v.codigo, 'el estado del ITF del pozo requiere revision') };
  }
  var ex = d.existencia(wellId);
  if (ex.existe !== true && ex.indeterminado === true) {
    return { ok: false, falla: itfService_falla('SERVICE_UNAVAILABLE', 'no se pudo comprobar el pozo') };
  }
  if (ex.existe !== true) {
    return { ok: false, falla: itfService_falla('POZO_NOT_FOUND', 'el pozo no existe') };
  }
  return { ok: true };
}

// opciones.archivo = {bytes, mimeType, nombreOriginal} (lo que mandaria el cliente al proponer). Orden (nada se sube hasta saber que se puede registrar):
//   1 validar el archivo (JPEG / PNG por los bytes reales, tamano) -> 2 hash SHA-256 de los bytes aceptados (nunca el del cliente) -> 3 reintento exacto (no se sube nada)
//   -> 4 evidencia / existencia -> 5 PREVALIDACION sin lock (derivar, duplicado, pendientes, idempotencia) -> 6 generar documentoId -> 7 subir al storage (FUERA del lock: es lento)
//   -> 8 lock: releer, revalidar, escribir ITF_PROPUESTO -> 9 invalidar -> si no se escribio, COMPENSAR (retirar el temporal).
function itfService_proponer(s, email, comando, valores, archivo, d) {
  var a = archivo !== null && typeof archivo === 'object' ? archivo : {};
  var v = itfArchivo_validar({ mimeType: a.mimeType, bytes: a.bytes });
  if (!v.ok) {
    return itfService_falla(v.code, v.message);
  }
  var base = { mimeType: v.mimeType, bytes: v.bytes, sha256: itfArchivo_sha256Hex(a.bytes, d.calcularDigest), nombreOriginal: itfArchivo_nombreOriginal(a.nombreOriginal) };
  var previos = d.repo.buscarPorClientRequestId(email, valores.clientRequestId);
  if (previos.total > 0) {
    // reintento (p. ej. se perdio la respuesta) o conflicto: se decide con el MISMO camino, SIN subir otra copia y SIN generar otro documentoId (devuelve el evento original)
    return itfService_dentroDelLock(s, email, comando, valores, d, { archivo: Object.assign({ storageFileId: ITF_SIN_STORAGE_REF }, base) });
  }
  var documentoId = itfDominio_uuid(d.nuevoDocumentoId());
  if (documentoId === '') {
    throw new Error('itfService_proponer: nuevoDocumentoId() no devolvio un UUID');
  }
  var evidencia = itfService_evidenciaPropuesta(valores.wellId, d);
  if (!evidencia.ok) {
    return evidencia.falla;
  }
  var extra = { archivo: Object.assign({ storageFileId: ITF_SIN_STORAGE_REF }, base), documentoId: documentoId, legacySha256: evidencia.legacySha256 };
  var pre = itfService_planificar(s, email, comando, valores, d, extra);             // sin lock y sin escribir: si ya sabemos que no se puede registrar, no se sube nada
  if (pre.falla) {
    return pre.falla;
  }
  if (pre.plan.accion !== 'ESCRIBIR') {
    return itfService_resultadoDe(pre.plan, 0);
  }
  var guardado = d.storage.guardarPropuesta({ documentoId: documentoId, bytes: a.bytes, mimeType: v.mimeType });
  if (!guardado || guardado.ok !== true) {
    return itfService_falla(guardado && guardado.code ? guardado.code : 'SERVICE_UNAVAILABLE', 'no se pudo guardar el archivo');
  }
  var res;
  try {
    res = itfService_dentroDelLock(s, email, comando, valores, d, { archivo: Object.assign({}, base, { storageFileId: guardado.storageRef }), documentoId: documentoId, legacySha256: evidencia.legacySha256 });
  } catch (err) {
    itfService_compensar(guardado.storageRef, d, false);
    throw err;
  }
  if (!res.ok || res.accion !== 'ESCRIBIR') {
    res.compensacion = itfService_compensar(guardado.storageRef, d, true);       // no hubo escritura: ninguna fila lo referencia
  }
  return res;
}

// --- E9-5: lectura del validador (cola, documento, historial) ---
// Las tres lecturas exigen perfil + perfil_validar (exactos) y ITF_E9_ACTIVO; leen ItfEventos UNA vez y derivan en memoria. Ninguna escribe. Errores de infraestructura -> SERVICE_UNAVAILABLE sin detalle.

// {ok:true, email} | falla. El permiso se comprueba aca ademas de en Api.js: el servicio no confia en que quien lo llama ya lo hizo.
function itfService_exigirValidador(sesion) {
  var s = sesion !== null && typeof sesion === 'object' ? sesion : {};
  if (!itfDominio_puede(ITF_ACCIONES.APROBAR, s.permisos)) {
    return itfService_falla('PERMISSION_DENIED', 'permiso insuficiente');
  }
  var email = itfDominio_normalizarEmail(s.email);
  if (!ITF_EMAIL_REGEX.test(email)) {
    return itfService_falla('INVALID_REQUEST', 'sesion sin email valido');
  }
  return { ok: true, email: email };
}

// Cola de propuestas PENDIENTES (solo PROPUESTO), de todos los pozos, las mas nuevas primero. opciones = {limite, cursor}. Una sola lectura de la hoja; sin storage, sin Drive, sin lecturas por tarjeta.
// {ok:true, items, siguienteCursor, total, pozosSinDerivar} | falla.
function itfService_pendientes(sesion, opciones, deps) {
  var d = itfService_deps(deps);
  var v = itfService_exigirValidador(sesion);
  if (!v.ok) {
    return v;
  }
  var o = opciones !== null && typeof opciones === 'object' ? opciones : {};
  var pag = itfDominio_validarPaginacion(o.limite, o.cursor);
  if (!pag.ok) {
    return itfService_falla(pag.code, pag.message);
  }
  if (!d.e9Activo()) {
    return itfService_falla('ITF_E9_INACTIVO', 'los ITF colaborativos no estan activos');
  }
  try {
    var eventos = d.repo.leerTodos().eventos;
    var derivacion = itfDominio_derivar(eventos);
    var r = itfDominio_listarPendientes(derivacion, { emailActor: v.email, proponenteDe: itfService_proponentes(eventos), limite: pag.limite, cursor: pag.cursor });
    return { ok: true, items: r.items, siguienteCursor: r.siguienteCursor, total: r.total, pozosSinDerivar: r.pozosSinDerivar };
  } catch (err) {
    itfService_log('fallo la cola de pendientes: ' + String(err));
    return itfService_falla('SERVICE_UNAVAILABLE', 'servicio no disponible');
  }
}

// Contexto del pozo para el validador a partir de UNA derivacion: el estado del pozo con el legacy incluido (una sola consulta al indice si ningun documento E9 decide el vigente).
function itfService_estadoDelPozo(wellId, derivacion, d) {
  var p = derivacion.porPozo[wellId];
  var vigenteE9 = p !== undefined && p.integridad === ITF_INTEGRIDAD.OK && p.vigenteId !== null && p.documentos[p.vigenteId].origen === ITF_ORIGEN.E9;
  var info = vigenteE9 || (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) ? null : d.legacy.buscar(wellId);
  return { est: itfDominio_estadoPozo(wellId, derivacion, info === null ? false : itfLegacy_aDisponible(info.estado)), info: info };
}

function itfService_resumenPozo(est) {
  return {
    wellId: est.wellId,
    estado: est.estado,
    tieneItf: est.tieneItf,
    vigenteActualDocumentoId: est.vigente === null ? null : est.vigente.documentoId,
    vigenteIndeterminado: est.tieneItf === ITF_TIENE_ITF.DESCONOCIDO,
    advertencias: est.advertencias.slice()
  };
}

// Un documento del pozo (propuesto, vigente, reemplazado, retirado, rechazado, o el legacy) con su imagen, para que el validador lo MIRE antes de decidir. Devuelve la metadata segura, el contexto del
// pozo (incluido el vigente que hay que declarar al aprobar / restaurar) y el blob. Nunca ids de Drive. Un legacy registrado se entrega SOLO si sigue coincidiendo con su huella.
// {ok:true, documento, pozo, blob} | falla (ITF_NOT_FOUND, ITF_STATE_UNKNOWN, LEGACY_CAMBIO, LEGACY_NO_DISPONIBLE, ...).
function itfService_documentoModeracion(sesion, documentoId, deps) {
  var d = itfService_deps(deps);
  var v = itfService_exigirValidador(sesion);
  if (!v.ok) {
    return v;
  }
  var id = itfDominio_idDocumento(documentoId);
  if (id === null) {
    return itfService_falla('INVALID_DOCUMENTO_ID', 'documentoId invalido');
  }
  if (!d.e9Activo()) {
    return itfService_falla('ITF_E9_INACTIVO', 'los ITF colaborativos no estan activos');
  }
  try {
    var eventos = d.repo.leerTodos().eventos;
    var derivacion = itfDominio_derivar(eventos);
    var wellId = id.tipo === ITF_ORIGEN.LEGACY ? id.wellId : derivacion.documentoPozo[id.id];
    if (wellId === undefined) {
      return itfService_falla('ITF_NOT_FOUND', 'documento no disponible');
    }
    var p = derivacion.porPozo[wellId];
    if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
      return itfService_falla('ITF_STATE_UNKNOWN', 'el historial del pozo no se puede derivar: requiere revision');
    }
    var ctx = itfService_estadoDelPozo(wellId, derivacion, d);
    var doc = p === undefined ? undefined : p.documentos[id.id];
    if (doc === undefined) {
      // el legacy todavia NO registrado: solo existe como vigente implicito
      if (id.tipo === ITF_ORIGEN.LEGACY && ctx.est.vigente !== null && ctx.est.vigente.implicito === true && ctx.est.vigente.documentoId === id.id) {
        doc = ctx.est.vigente;
      } else {
        return itfService_falla('ITF_NOT_FOUND', 'documento no disponible');
      }
    }
    var blob;
    if (doc.origen === ITF_ORIGEN.LEGACY) {
      if (doc.implicito === true) {
        blob = ctx.info.leerBlob();
      } else {
        var r = d.legacy.leerRegistrado(doc);
        if (!r.found) {
          return itfService_falla(r.code, 'documento no disponible');
        }
        blob = r.blob;
      }
    } else {
      var leido = d.storage.leerDocumento(doc.storageFileId);
      if (!leido || leido.ok !== true) {
        return itfService_falla(leido && leido.code === ITF_STORAGE_NO_CONFIGURADO ? ITF_STORAGE_NO_CONFIGURADO : 'SERVICE_UNAVAILABLE', 'documento no disponible');
      }
      blob = itfStorage_comoBlob(leido.bytes, leido.mimeType || doc.mimeType);
    }
    return { ok: true, documento: itfDominio_dtoDocumentoModeracion(doc, itfService_proponentes(eventos), v.email), pozo: itfService_resumenPozo(ctx.est), blob: blob };
  } catch (err) {
    itfService_log('fallo la apertura de un documento: ' + String(err));
    return itfService_falla('SERVICE_UNAVAILABLE', 'servicio no disponible');
  }
}

// Historial institucional de UN pozo: eventos del mas nuevo al mas viejo (sin email, hash, storage, clientRequestId ni secuencia) y los documentos con su estado actual. wellId, no documento: permite ver
// toda la evolucion (propuestas, aprobaciones, reemplazos, retiros, reversiones) de una sola vez.
// {ok:true, wellId, pozo, historial, documentos} | falla.
function itfService_historial(sesion, wellId, deps) {
  var d = itfService_deps(deps);
  var v = itfService_exigirValidador(sesion);
  if (!v.ok) {
    return v;
  }
  if (typeof wellId !== 'string' || !ITF_WELLID_REGEX.test(wellId)) {
    return itfService_falla('INVALID_WELL_ID', 'wellId invalido');
  }
  if (!d.e9Activo()) {
    return itfService_falla('ITF_E9_INACTIVO', 'los ITF colaborativos no estan activos');
  }
  try {
    var eventos = d.repo.leerTodos().eventos;
    var derivacion = itfDominio_derivar(eventos);
    var p = derivacion.porPozo[wellId];
    if (p !== undefined && p.integridad !== ITF_INTEGRIDAD.OK) {
      return itfService_falla('ITF_STATE_UNKNOWN', 'el historial del pozo no se puede derivar: requiere revision');
    }
    var est = itfService_estadoDelPozo(wellId, derivacion, d).est;
    var proponentes = itfService_proponentes(eventos);
    var documentos = p === undefined ? [] : p.orden.slice().reverse().map(function (id) { return itfDominio_dtoDocumentoModeracion(p.documentos[id], proponentes, v.email); });
    if (est.vigente !== null && est.vigente.implicito === true) {
      documentos.push(itfDominio_dtoDocumentoModeracion(est.vigente, proponentes, v.email));
    }
    return { ok: true, wellId: wellId, pozo: itfService_resumenPozo(est), historial: p === undefined ? [] : itfDominio_dtoHistorialPozo(p), documentos: documentos };
  } catch (err) {
    itfService_log('fallo el historial: ' + String(err));
    return itfService_falla('SERVICE_UNAVAILABLE', 'servicio no disponible');
  }
}

// Ejecuta una accion institucional. sesion = {email, nombre, permisos} (lo arma Api.js a partir del token, NUNCA del cuerpo del pedido); comando = el pedido del cliente (el dominio rechaza campos de mas, entre
// ellos cualquier intento de elegir otro actor); opciones.archivo solo para PROPONER. Devuelve {ok:true, accion:'ESCRIBIR'|'REINTENTO', resultado:{evento, documentoId, wellId}, advertencias,
// eventosEscritos} | {ok:false, code, message}. Nunca devuelve email, storageRef, hash completo, clientRequestId ni secuencia.
function itfService_ejecutar(sesion, comando, opciones, deps) {
  var d = itfService_deps(deps);
  var op = opciones || {};
  var s = sesion !== null && typeof sesion === 'object' ? sesion : {};
  var v = itfDominio_validarComando(comando);
  if (!v.ok) {
    return itfService_falla(v.code, v.message);
  }
  if (!itfDominio_puede(v.valores.accion, s.permisos)) {
    return itfService_falla('PERMISSION_DENIED', 'permiso insuficiente');
  }
  var email = itfDominio_normalizarEmail(s.email);
  if (!ITF_EMAIL_REGEX.test(email)) {
    return itfService_falla('INVALID_REQUEST', 'sesion sin email valido');
  }
  if (!d.e9Activo()) {
    return itfService_falla('ITF_E9_INACTIVO', 'los ITF colaborativos no estan activos');
  }
  try {
    if (v.valores.accion === ITF_ACCIONES.PROPONER) {
      return itfService_proponer(s, email, comando, v.valores, op.archivo, d);
    }
    return itfService_dentroDelLock(s, email, comando, v.valores, d);
  } catch (err) {
    itfService_log('fallo la ejecucion de ' + v.valores.accion + ': ' + String(err));
    return itfService_falla('SERVICE_UNAVAILABLE', 'servicio no disponible');
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_E9_PROPIEDAD,
    ITF_SERVICE_CODIGOS,
    ITF_SIN_STORAGE_REF,
    itfService_e9Activo,
    itfService_pozoExiste,
    itfService_depsReales,
    itfService_traducirCodigo,
    itfService_resolverVigente,
    itfService_obtenerBytes,
    itfService_getProfile,
    itfService_disponibilidad,
    itfService_obtenerDocumento,
    itfService_proponentes,
    itfService_planificar,
    itfService_evidenciaPropuesta,
    itfService_proponer,
    itfService_ejecutar,
    itfService_exigirValidador,
    itfService_pendientes,
    itfService_estadoDelPozo,
    itfService_documentoModeracion,
    itfService_historial,
    itfService_verificarArchivo
  };
}
