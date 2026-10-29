// ItfLegacyProvider (E9-3): el UNICO componente nuevo que sabe como se resuelve el ITF LEGACY (<wellId>.jpg en la carpeta institucional de Drive). Existencia, archivo, disponibilidad en lote,
// huella para el registro (ITF_LEGACY_REGISTRADO) y verificacion de esa huella al restaurar. Todo lo que toca Drive pasa por DriveProfileRepository.js; este archivo es logica.
//
// ESTADO DE ESTA ETAPA: NADA de esto esta cableado a Api.js. Lo usa ItfService.js. getProfile / getItfAvailability de produccion siguen usando ProfileService + ItfAvailabilityService, sin cambios.
//
// POLITICA UNICA DE NOMBRE LEGACY (auditoria E9-1: el indice aceptaba .jpg / .JPG con /i pero la descarga buscaba '<wellId>.jpg' exacto, y Drive puede devolver mas de un archivo):
//   - Un ITF legacy es EXACTAMENTE '<wellId>.jpg' (extension en minuscula). Eso es lo que resuelve getFilesByName y lo que se puede descargar.
//   - Se RECONOCE sin importar mayusculas al indexar (.JPG, .Jpg...), pero esas variantes NO son descargables: el pozo queda NO_CANONICO (DESCONOCIDO), nunca "Si" y nunca un "No" enganoso.
//   - Un solo archivo canonico -> UNICO. Cero -> NO. Dos o mas con el mismo nombre -> AMBIGUO (fail-closed, nunca se toma el primero en silencio).
//   Estados: 'NO' | 'UNICO' | 'AMBIGUO' | 'NO_CANONICO'. Solo UNICO es "tiene ITF legacy"; solo NO es "no tiene"; los otros dos son "no se sabe".
//   Efecto frente a hoy (que toma el primero y acepta /i): un pozo con archivo duplicado o con extension en mayuscula pasa de "Si (y a veces la descarga falla)" a "no se sabe". Es la unica diferencia.
//
// INDICE DE DISPONIBILIDAD (nuevo, aparte del existente 'itf_idx_' que NO se toca): CacheService, por departamento 01..19, clave 'itf_leg_v1_DD', TTL 1 hora, valor
// {"u":[PPPP unicos], "a":[PPPP ambiguos], "n":[PPPP no canonicos]}; lo que no esta en ninguna lista es 'NO'. Se reconstruye entero (una pasada por la carpeta) ante cualquier departamento faltante.
// Q4 (single-flight): mientras una ejecucion reconstruye, deja una bandera corta en el cache y las demas esperan (hasta ~6 s) a que aparezca el indice en vez de recorrer la carpeta todas a la vez.
// NO usa el ScriptLock: es el mismo lock global que serializa TODAS las escrituras de hojas y recorrer la carpeta lleva segundos.
//
// HUELLA: mimeType (por los bytes reales, no por el nombre), bytes, SHA-256 de los bytes reales, id de Drive del archivo (referencia INTERNA, nunca sale al cliente) y nombre. Se calcula SOLO cuando se
// va a registrar el legacy (primer reemplazo / retiro) o a verificar (restauracion): no se hashean miles de archivos.
var ITF_LEGACY_EXTENSION = '.jpg';
var ITF_LEGACY_INDEX_PREFIX = 'itf_leg_v1_';
var ITF_LEGACY_INDEX_SECONDS = 3600;
var ITF_LEGACY_REBUILD_FLAG = 'itf_leg_v1_rebuilding';
var ITF_LEGACY_REBUILD_FLAG_SECONDS = 60;
var ITF_LEGACY_ESPERA_MS = 500;
var ITF_LEGACY_ESPERA_MAX = 12;
var ITF_LEGACY_NOMBRE_REGEX = /^(\d{2})-(\d{4})\.jpg$/i;
var ITF_LEGACY_ESTADOS = { NO: 'NO', UNICO: 'UNICO', AMBIGUO: 'AMBIGUO', NO_CANONICO: 'NO_CANONICO' };

function itfLegacy_departamentos() {
  var deptos = [];
  for (var d = 1; d <= 19; d++) {
    deptos.push(('0' + d).slice(-2));
  }
  return deptos;
}

// Nombre canonico del archivo legacy de un pozo.
function itfLegacy_nombre(wellId) {
  return wellId + ITF_LEGACY_EXTENSION;
}

// PURA. Lista de nombres de la carpeta -> {wellId: {canonicos, noCanonicos}} SOLO para los que parecen un ITF (DD-PPPP.jpg, sin importar mayusculas). Cualquier otro nombre se ignora, nunca rompe.
function itfLegacy_clasificarNombres(nombres) {
  var porPozo = {};
  (nombres || []).forEach(function (nombre) {
    var m = ITF_LEGACY_NOMBRE_REGEX.exec(String(nombre));
    if (!m) {
      return;
    }
    var wellId = m[1] + '-' + m[2];
    var entrada = porPozo[wellId] = porPozo[wellId] || { canonicos: 0, noCanonicos: 0 };
    if (String(nombre) === itfLegacy_nombre(wellId)) {
      entrada.canonicos += 1;
    } else {
      entrada.noCanonicos += 1;
    }
  });
  return porPozo;
}

// PURA. {canonicos, noCanonicos} (o undefined) -> estado.
function itfLegacy_estadoDe(entrada) {
  if (!entrada) {
    return ITF_LEGACY_ESTADOS.NO;
  }
  if (entrada.canonicos >= 2) {
    return ITF_LEGACY_ESTADOS.AMBIGUO;
  }
  if (entrada.canonicos === 1) {
    return ITF_LEGACY_ESTADOS.UNICO;
  }
  return entrada.noCanonicos > 0 ? ITF_LEGACY_ESTADOS.NO_CANONICO : ITF_LEGACY_ESTADOS.NO;
}

// --- indice de disponibilidad ---

// Una pasada por la carpeta; escribe los 19 departamentos en el cache. Devuelve los buckets.
function itfLegacy_reconstruirIndice() {
  var cache = CacheService.getScriptCache();
  var deptos = itfLegacy_departamentos();
  var buckets = {};
  deptos.forEach(function (d) { buckets[d] = { u: [], a: [], n: [] }; });
  var porPozo = itfLegacy_clasificarNombres(driveProfileRepository_listarArchivosThumb());
  Object.keys(porPozo).forEach(function (wellId) {
    var bucket = buckets[wellId.substring(0, 2)];
    if (!bucket) {
      return;                                              // departamento fuera de 01..19: igual que el indice existente, no se indexa
    }
    var estado = itfLegacy_estadoDe(porPozo[wellId]);
    var pppp = wellId.substring(3);
    if (estado === ITF_LEGACY_ESTADOS.UNICO) {
      bucket.u.push(pppp);
    } else if (estado === ITF_LEGACY_ESTADOS.AMBIGUO) {
      bucket.a.push(pppp);
    } else if (estado === ITF_LEGACY_ESTADOS.NO_CANONICO) {
      bucket.n.push(pppp);
    }
  });
  deptos.forEach(function (d) {
    cache.put(ITF_LEGACY_INDEX_PREFIX + d, JSON.stringify(buckets[d]), ITF_LEGACY_INDEX_SECONDS);
  });
  return buckets;
}

function itfLegacy_asegurarIndice(deptosNecesarios) {
  var cache = CacheService.getScriptCache();
  var deptos = deptosNecesarios && deptosNecesarios.length > 0 ? deptosNecesarios : itfLegacy_departamentos();
  function falta() {
    return deptos.some(function (d) { return cache.get(ITF_LEGACY_INDEX_PREFIX + d) === null; });
  }
  if (!falta()) {
    return;
  }
  var esperas = 0;
  while (cache.get(ITF_LEGACY_REBUILD_FLAG) !== null && esperas < ITF_LEGACY_ESPERA_MAX) {
    Utilities.sleep(ITF_LEGACY_ESPERA_MS);
    esperas += 1;
    if (!falta()) {
      return;                                              // otra ejecucion ya lo reconstruyo
    }
  }
  cache.put(ITF_LEGACY_REBUILD_FLAG, '1', ITF_LEGACY_REBUILD_FLAG_SECONDS);
  try {
    itfLegacy_reconstruirIndice();
  } finally {
    cache.remove(ITF_LEGACY_REBUILD_FLAG);
  }
}

// Estado legacy de MUCHOS pozos con UNA lectura del indice (y a lo sumo UNA pasada por la carpeta): {wellId: 'NO'|'UNICO'|'AMBIGUO'|'NO_CANONICO'|'DESCONOCIDO'}. 'DESCONOCIDO' solo si un
// departamento sigue sin aparecer en el cache despues de reconstruir (CacheService lo expulso en el medio): nunca se lo toma como "sin archivos". Lanza si Drive falla.
function itfLegacy_disponibilidad(wellIds) {
  var resultado = {};
  if (!wellIds || wellIds.length === 0) {
    return resultado;
  }
  var validos = itfLegacy_departamentos();
  var necesarios = {};
  wellIds.forEach(function (w) {
    var depto = w.substring(0, 2);
    if (validos.indexOf(depto) >= 0) {
      necesarios[depto] = true;
    }
  });
  var deptos = Object.keys(necesarios);
  if (deptos.length > 0) {
    itfLegacy_asegurarIndice(deptos);
  }
  var cache = CacheService.getScriptCache();
  var buckets = {};
  wellIds.forEach(function (w) {
    var depto = w.substring(0, 2);
    if (validos.indexOf(depto) < 0) {
      resultado[w] = ITF_LEGACY_ESTADOS.NO;                // fuera de 01..19 no hay ITF indexable (igual que el indice existente)
      return;
    }
    if (!(depto in buckets)) {
      var raw = cache.get(ITF_LEGACY_INDEX_PREFIX + depto);
      var parsed = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch (err) {
        parsed = null;
      }
      buckets[depto] = parsed && Array.isArray(parsed.u) && Array.isArray(parsed.a) && Array.isArray(parsed.n) ? parsed : null;
    }
    var bucket = buckets[depto];
    if (bucket === null) {
      resultado[w] = 'DESCONOCIDO';
      return;
    }
    var pppp = w.substring(3);
    resultado[w] = bucket.u.indexOf(pppp) >= 0 ? ITF_LEGACY_ESTADOS.UNICO
      : (bucket.a.indexOf(pppp) >= 0 ? ITF_LEGACY_ESTADOS.AMBIGUO
        : (bucket.n.indexOf(pppp) >= 0 ? ITF_LEGACY_ESTADOS.NO_CANONICO : ITF_LEGACY_ESTADOS.NO));
  });
  return resultado;
}

// --- resolucion de UN pozo ---

// {estado, cantidad, fileId?, nombre?, leerBlob?}. Una sola llamada a Drive (getFilesByName). Como Drive puede devolver variantes de mayusculas, se filtra por nombre EXACTO. Lanza si Drive falla.
// fileId es INTERNO (referencia para el registro del legacy): jamas sale hacia el cliente.
function itfLegacy_buscar(wellId) {
  var nombre = itfLegacy_nombre(wellId);
  var coincidencias = driveProfileRepository_buscarPorNombre(nombre);
  var exactas = coincidencias.filter(function (c) { return c.nombre === nombre; });
  if (exactas.length === 0) {
    return { estado: coincidencias.length > 0 ? ITF_LEGACY_ESTADOS.NO_CANONICO : ITF_LEGACY_ESTADOS.NO, cantidad: 0 };
  }
  if (exactas.length >= 2) {
    return { estado: ITF_LEGACY_ESTADOS.AMBIGUO, cantidad: exactas.length };
  }
  return { estado: ITF_LEGACY_ESTADOS.UNICO, cantidad: 1, fileId: exactas[0].fileId, nombre: exactas[0].nombre, leerBlob: exactas[0].leerBlob };
}

// 'NO'|'UNICO'|... -> true / false / null para el dominio (itfDominio_estadoPozo): solo UNICO es true, solo NO es false; ambiguo, no canonico o desconocido son null (no se sabe).
function itfLegacy_aDisponible(estado) {
  return estado === ITF_LEGACY_ESTADOS.UNICO ? true : (estado === ITF_LEGACY_ESTADOS.NO ? false : null);
}

// --- huella (ITF_LEGACY_REGISTRADO) y verificacion ---

function itfLegacy_huellaDeBlob(blob, fileId, nombre) {
  var bytes = blob.getBytes();
  var mimeType = itfArchivo_detectarFormato(bytes);
  if (mimeType === null) {
    return { ok: false, code: 'LEGACY_FORMATO_INVALIDO', message: 'el archivo legacy no es una imagen JPEG o PNG valida' };
  }
  if (bytes.length > ITF_ARCHIVO_BYTES_MAX) {
    return { ok: false, code: 'LEGACY_FORMATO_INVALIDO', message: 'el archivo legacy supera el tamano maximo' };
  }
  return {
    ok: true,
    huella: { mimeType: mimeType, bytes: bytes.length, sha256: itfArchivo_sha256Hex(bytes), storageFileId: fileId, nombreOriginal: nombre }
  };
}

// Huella del legacy ACTUAL de un pozo, para escribir ITF_LEGACY_REGISTRADO justo antes de la accion que lo toca. {ok:true, huella} | {ok:false, code}. Lee y hashea el archivo (una vez por pozo, jamas por
// lote). Requiere exactamente UN archivo canonico: ambiguo / no canonico / inexistente no se registran.
function itfLegacy_huella(wellId) {
  var r = itfLegacy_buscar(wellId);
  if (r.estado === ITF_LEGACY_ESTADOS.AMBIGUO) {
    return { ok: false, code: 'LEGACY_AMBIGUO', message: 'hay mas de un archivo legacy para el pozo' };
  }
  if (r.estado === ITF_LEGACY_ESTADOS.NO_CANONICO) {
    return { ok: false, code: 'LEGACY_NOMBRE_NO_CANONICO', message: 'el archivo legacy no tiene el nombre canonico' };
  }
  if (r.estado !== ITF_LEGACY_ESTADOS.UNICO) {
    return { ok: false, code: 'ITF_NOT_FOUND', message: 'no hay archivo legacy' };
  }
  return itfLegacy_huellaDeBlob(r.leerBlob(), r.fileId, r.nombre);
}

// Verifica el archivo legacy REGISTRADO (por su id de Drive) contra la huella guardada en ITF_LEGACY_REGISTRADO: 'COINCIDE' | 'CAMBIO' | 'AUSENTE'. Vuelve a LEER el archivo y recalcula el SHA-256:
// nunca se restaura en silencio un archivo distinto. registrado = {storageFileId, sha256, bytes}. Lanza si Drive falla.
function itfLegacy_verificarHuella(registrado) {
  if (!registrado || typeof registrado.storageFileId !== 'string' || typeof registrado.sha256 !== 'string') {
    return 'AUSENTE';
  }
  var leido = driveProfileRepository_leerPorId(registrado.storageFileId);
  if (!leido || leido.found !== true) {
    return 'AUSENTE';
  }
  var bytes = leido.blob.getBytes();
  if (registrado.bytes !== undefined && bytes.length !== registrado.bytes) {
    return 'CAMBIO';
  }
  return itfArchivo_sha256Hex(bytes) === registrado.sha256 ? 'COINCIDE' : 'CAMBIO';
}

// Lee un legacy registrado por su id (descarga historica, desde el historial): {found, blob, verificado:'COINCIDE'|'CAMBIO'}. Si el contenido ya no coincide con la huella, NO lo entrega.
function itfLegacy_leerRegistrado(registrado) {
  var leido = driveProfileRepository_leerPorId(registrado.storageFileId);
  if (!leido || leido.found !== true) {
    return { found: false, code: 'ITF_NOT_FOUND' };
  }
  var bytes = leido.blob.getBytes();
  if (itfArchivo_sha256Hex(bytes) !== registrado.sha256) {
    return { found: false, code: 'LEGACY_CAMBIO' };
  }
  return { found: true, blob: leido.blob };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ITF_LEGACY_EXTENSION,
    ITF_LEGACY_INDEX_PREFIX,
    ITF_LEGACY_INDEX_SECONDS,
    ITF_LEGACY_REBUILD_FLAG,
    ITF_LEGACY_ESPERA_MAX,
    ITF_LEGACY_ESTADOS,
    itfLegacy_departamentos,
    itfLegacy_nombre,
    itfLegacy_clasificarNombres,
    itfLegacy_estadoDe,
    itfLegacy_reconstruirIndice,
    itfLegacy_asegurarIndice,
    itfLegacy_disponibilidad,
    itfLegacy_buscar,
    itfLegacy_aDisponible,
    itfLegacy_huella,
    itfLegacy_verificarHuella,
    itfLegacy_leerRegistrado
  };
}
