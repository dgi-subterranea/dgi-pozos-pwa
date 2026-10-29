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
  'IDEMPOTENCY_CONFLICT', 'INCONSISTENT_STATE', 'SERVICE_UNAVAILABLE', 'ITF_E9_INACTIVO', 'ITF_STORAGE_NO_CONFIGURADO'
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
    storage: itfStorage_noConfigurado(),
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

// TODO adentro del lock: buscar clientRequestId -> leer TODOS los eventos -> derivar -> (legacy: estado, huella, verificacion) -> planificar -> escribir (1 o 2 eventos consecutivos en UNA operacion)
// -> invalidar. El estado se RELEE aca adentro: nada de lo decidido antes del lock se reutiliza. archivoMeta: solo PROPONER (metadata ya validada + storageFileId). Devuelve el resultado del servicio;
// puede lanzar (Sheets / Drive / lock): quien llama lo traduce a SERVICE_UNAVAILABLE.
function itfService_dentroDelLock(s, email, comando, valores, archivoMeta, d) {
  return d.repo.conLock(function () {
    var existentes = d.repo.buscarPorClientRequestId(email, valores.clientRequestId);
    var eventos = d.repo.leerTodos().eventos;
    var derivacion = itfDominio_derivar(eventos);
    var wellId = itfService_pozoDelComando(valores, derivacion);
    var accion = valores.accion;
    var legacy = { disponible: null, huellaCoincide: false };
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
      nuevoEventoId: d.nuevoEventoId, nuevoDocumentoId: d.nuevoDocumentoId, proponenteDe: itfService_proponentes(eventos),
      archivo: archivoMeta, pozoExiste: true
    };
    var plan = itfDominio_planificar(comando, ctx);
    if (!plan.ok && plan.code === 'LEGACY_SNAPSHOT_REQUERIDO') {
      var h = d.legacy.huella(wellId);
      if (!h.ok) {
        return itfService_falla(h.code, h.message);
      }
      ctx.legacy.snapshot = h.huella;
      plan = itfDominio_planificar(comando, ctx);
    }
    if (!plan.ok) {
      return itfService_falla(itfService_traducirCodigo(plan.code, legacyEstado), plan.message);
    }
    if (plan.accion !== 'ESCRIBIR') {
      return { ok: true, accion: plan.accion, resultado: plan.resultado, advertencias: plan.advertencias, eventosEscritos: 0 };
    }
    d.repo.escribirEventos(plan.eventos);
    d.invalidarCaches([plan.resultado.wellId]);
    return { ok: true, accion: plan.accion, resultado: plan.resultado, advertencias: plan.advertencias, eventosEscritos: plan.eventos.length };
  });
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

// opciones.archivo = {bytes, mimeType, nombreOriginal} (lo que mandaria el cliente al proponer). Orden: validar el archivo -> hash -> el pozo existe (fuente previa) -> reintento exacto SIN subir nada ->
// guardar en el storage -> lock + decidir + escribir -> si no se escribio, COMPENSAR (retirar el temporal).
function itfService_proponer(s, email, comando, valores, archivo, d) {
  var a = archivo !== null && typeof archivo === 'object' ? archivo : {};
  var v = itfArchivo_validar({ mimeType: a.mimeType, bytes: a.bytes });
  if (!v.ok) {
    return itfService_falla(v.code, v.message);
  }
  var base = { mimeType: v.mimeType, bytes: v.bytes, sha256: itfArchivo_sha256Hex(a.bytes, d.calcularDigest), nombreOriginal: itfArchivo_nombreOriginal(a.nombreOriginal) };
  var ex = d.existencia(valores.wellId);
  if (ex.indeterminado === true && ex.existe !== true) {
    return itfService_falla('SERVICE_UNAVAILABLE', 'no se pudo comprobar el pozo');
  }
  if (ex.existe !== true) {
    return itfService_falla('POZO_NOT_FOUND', 'el pozo no existe');
  }
  var previos = d.repo.buscarPorClientRequestId(email, valores.clientRequestId);
  if (previos.total > 0) {
    // reintento o conflicto: se decide con el MISMO camino (adentro del lock) pero SIN subir otra copia al storage
    return itfService_dentroDelLock(s, email, comando, valores, Object.assign({ storageFileId: ITF_SIN_STORAGE_REF }, base), d);
  }
  var guardado = d.storage.guardarPropuesta({ bytes: a.bytes, mimeType: v.mimeType, nombreSugerido: base.nombreOriginal });
  if (!guardado || guardado.ok !== true) {
    return itfService_falla(guardado && guardado.code ? guardado.code : 'SERVICE_UNAVAILABLE', 'no se pudo guardar el archivo');
  }
  var res;
  try {
    res = itfService_dentroDelLock(s, email, comando, valores, Object.assign({ storageFileId: guardado.storageRef }, base), d);
  } catch (err) {
    itfService_compensar(guardado.storageRef, d, false);
    throw err;
  }
  if (!res.ok || res.accion !== 'ESCRIBIR') {
    res.compensacion = itfService_compensar(guardado.storageRef, d, true);       // no hubo escritura: ninguna fila lo referencia
  }
  return res;
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
    return itfService_dentroDelLock(s, email, comando, v.valores, undefined, d);
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
    itfService_ejecutar
  };
}
