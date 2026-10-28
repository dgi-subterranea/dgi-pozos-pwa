// FotosPozosModeracionService (E8-2): DOMINIO de la moderacion de la galeria general de fotos (FotosPozos). Puro / semipuro: no sabe nada de HTTP (Api.js), de Sheets
// (FotosPozoEventosRepository.js), del storage ni de caches. Documento de diseno: docs/fotos-pozos-moderacion.md.
//
// ESTADO DE ESTA ETAPA: NADA de esto esta cableado todavia (sin endpoints, sin permisos en Usuarios, sin hoja en produccion). E8-3 lo cablea.
//
// MODELO. Una foto tiene un estado BASE en FotosPozos (columna `estado`: ACTIVA | OCULTA) y, ENCIMA, una capa APPEND-ONLY de eventos (hoja FotosPozoEventos):
//   RETIRO_SOLICITADO  alguien con fotos_carga pide retirar la foto (no la oculta).
//   RETIRADA           un moderador (fotos_moderar) la retira directo.
//   RETIRO_RESUELTO    un moderador resuelve una solicitud: APROBADO (la foto queda retirada) o RECHAZADO (sigue activa).
//   REPUESTA           un moderador repone una foto retirada POR EVENTOS.
// Estado de la FOTO (derivado): ACTIVA | RETIRADA. Estado de una SOLICITUD (derivado): ABIERTA | APROBADA | RECHAZADA. Son cosas distintas y nunca se mezclan. No existe PENDIENTE para una foto
// productiva (la subida sigue directa).
//
// BASELINE LEGACY (critico). FotosPozos.estado ya existe y ya manda: una fila OCULTA sigue no visible aunque no haya ningun evento, y NINGUN evento la revive (REPUESTA solo repone lo que
// retiraron los eventos: no se conoce el motivo historico de un ocultamiento manual). Un estado base que no es exactamente ACTIVA ni OCULTA no se interpreta: la foto queda NO DERIVABLE.
//
// FAIL-CLOSED. Si el historial de una foto es ambiguo o esta corrupto (eventoId o secuencia duplicados, secuencia invalida, evento desconocido, resolucion huerfana o doble, resolucion de una
// solicitud de OTRA foto, transicion imposible, entidad que no coincide...) NO se inventa un estado: la foto queda integridad:'NO_DERIVABLE', estado:null, visible:false. Una galeria tiene
// que preferir ocultar antes que mostrar como activa una foto cuyo estado no se puede derivar. Un evento corrupto solo afecta a las fotos que involucra (E5: lo mismo con observaciones).
//
// VISIBILIDAD CENTRAL: fotosPozosModeracion_visible(base, derivacion) es LA unica decision de "se muestra en la galeria normal" (baseline ACTIVA Y vinculo CONFIRMADO Y estado derivado ACTIVA
// Y integridad OK). Visible INTERNAMENTE no es lo mismo que publicable: la politica publica (E10) sera otra, encima de esta.
//
// AUTORIZACION: por permisos exactos (=== true), jamas por nombre ni por ser el autor: el autor de una foto NO la puede retirar directo, solo solicitar el retiro como cualquier usuario con
// fotos + fotos_carga. Moderar exige fotos + fotos_moderar. El email se usa SOLO para idempotencia y auditoria y NUNCA sale en un DTO de lectura.
//
// NO ORACULO. Para quien solicita (sin moderacion) estos casos devuelven el MISMO error FOTO_NOT_FOUND: foto inexistente, oculta (legacy), retirada, no derivable o con vinculo sin confirmar.
// Lo unico que se distingue es SOLICITUD_YA_ABIERTA (solo sobre una foto visible). El moderador si ve la diferencia (FOTO_YA_RETIRADA, SOLICITUD_ABIERTA, ESTADO_NO_DERIVABLE...).
//
// CACHE (lo integra E8-3; aca solo se FIJA que claves deben caer): ver fotosPozosModeracion_clavesCacheAInvalidar / fotosPozosModeracion_requiereInvalidarCache.
//
// NO BORRA NADA FISICO. Retirar (tambien por PRIVACIDAD) no toca el storage ni Drive; PRIVACIDAD solo enciende la senal derivada requiereRevisionBorrado. FotosPozosCambios es LEGACY: nada de
// este archivo la lee ni la escribe.
var FOTOS_MOD_EVENTO = {
  RETIRO_SOLICITADO: 'RETIRO_SOLICITADO',
  RETIRADA: 'RETIRADA',
  RETIRO_RESUELTO: 'RETIRO_RESUELTO',
  REPUESTA: 'REPUESTA'
};
var FOTOS_MOD_EVENTOS = ['RETIRO_SOLICITADO', 'RETIRADA', 'RETIRO_RESUELTO', 'REPUESTA'];
var FOTOS_MOD_RESOLUCIONES = ['APROBADO', 'RECHAZADO'];
var FOTOS_MOD_MOTIVOS = ['NO_CORRESPONDE_POZO', 'DUPLICADA', 'MALA_CALIDAD', 'SIN_CONTENIDO_UTIL', 'PRIVACIDAD', 'DESACTUALIZADA', 'OTRO'];
var FOTOS_MOD_ENTIDAD_TIPOS = ['WELL', 'MONITORING'];
var FOTOS_MOD_ESTADOS_BASE = { ACTIVA: 'ACTIVA', OCULTA: 'OCULTA' };
var FOTOS_MOD_ESTADOS_FOTO = { ACTIVA: 'ACTIVA', RETIRADA: 'RETIRADA' };
var FOTOS_MOD_ESTADOS_SOLICITUD = { ABIERTA: 'ABIERTA', APROBADA: 'APROBADA', RECHAZADA: 'RECHAZADA' };
var FOTOS_MOD_ORIGEN_RETIRO = { EVENTO: 'EVENTO', LEGACY_OCULTA: 'LEGACY_OCULTA' };
var FOTOS_MOD_INTEGRIDAD = { OK: 'OK', NO_DERIVABLE: 'NO_DERIVABLE' };
var FOTOS_MOD_ACCIONES = { SOLICITAR_RETIRO: 'SOLICITAR_RETIRO', RETIRAR: 'RETIRAR', RESOLVER_RETIRO: 'RESOLVER_RETIRO', REPONER: 'REPONER' };
var FOTOS_MOD_MOTIVO_TEXTO_MIN = 3;
var FOTOS_MOD_MOTIVO_TEXTO_MAX = 300;
var FOTOS_MOD_NOMBRE_MAX = 120;
var FOTOS_MOD_NOMBRE_NEUTRO = 'Usuario';
var FOTOS_MOD_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
var FOTOS_MOD_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
var FOTOS_MOD_WELLID_REGEX = /^\d{2}-\d{4}$/;
var FOTOS_MOD_MONITORING_REGEX = /^[A-Za-z0-9][A-Za-z0-9 ._\/-]{0,39}$/;
var FOTOS_MOD_EMAIL_REGEX = /^[^\s@]+@[^\s@]+$/;
// Claves de CacheService que dependen de una foto / de la galeria (las crea FotosPozosService.js; un test de contrato las compara con ese archivo). 'full' NO se cachea: solo la miniatura.
var FOTOS_MOD_CACHE_META_PREFIJO = 'fotospozos_m_';
var FOTOS_MOD_CACHE_THUMB_PREFIJO = 'fotospozos_t_';
var FOTOS_MOD_CACHE_RESUMEN_CLAVE = 'fotospozos_resumen';

function fotosPozosModeracion_error(code, message) {
  return { ok: false, code: code, message: message };
}

// --- Normalizacion ---

function fotosPozosModeracion_texto(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}

// Entero >= 1 o null.
function fotosPozosModeracion_secuencia(v) {
  var n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);
  return isFinite(n) && Math.floor(n) === n && n >= 1 ? n : null;
}

// ISO 8601 o null.
function fotosPozosModeracion_fechaIso(v) {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  var d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// UUID en minuscula o '' si no lo es. (No hay otra "magia": ni espacios internos ni otros formatos.)
function fotosPozosModeracion_idNormalizado(v) {
  var s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return FOTOS_MOD_UUID_REGEX.test(s) ? s : '';
}

function fotosPozosModeracion_normalizarEmail(email) {
  return String(email === null || email === undefined ? '' : email).trim().toLowerCase();
}

// Nombre de presentacion: una linea, sin controles, acotado; neutro si falta o parece un email. NUNCA se usa para autorizar.
function fotosPozosModeracion_nombreVisible(nombre) {
  var n = fotosPozosModeracion_normalizarTexto(typeof nombre === 'string' ? nombre : '') || '';
  n = n.replace(/\s+/g, ' ').trim();
  if (Array.from(n).length > FOTOS_MOD_NOMBRE_MAX) {
    n = Array.from(n).slice(0, FOTOS_MOD_NOMBRE_MAX).join('');
  }
  return n === '' || n.indexOf('@') !== -1 ? FOTOS_MOD_NOMBRE_NEUTRO : n;
}

// NORMALIZACION del motivoTexto (misma regla que las observaciones, E5):
//   1. CRLF, CR solo, NEL (U+0085), LS (U+2028) y PS (U+2029) pasan a "\n". 2. El tabulador pasa a UN espacio.
//   3. Se ELIMINAN: controles C0 salvo "\n", DEL y C1, controles direccionales explicitos (U+202A-202E, U+2066-2069), BOM / ZWNBSP (U+FEFF) y surrogates sueltos.
//      NO se tocan U+200D / U+200C (emoji compuestos), selectores de variacion ni U+200E / U+200F. 4. trim.
// Devuelve el texto normalizado o null si no es un string.
function fotosPozosModeracion_normalizarTexto(texto) {
  if (typeof texto !== 'string') {
    return null;
  }
  return texto
    .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
    .trim();
}

function fotosPozosModeracion_largoTexto(texto) {
  return Array.from(texto).length;
}

// --- Catalogo de motivos ---

// Codigo EXACTO (sin trim, sin mayusculas / minusculas, sin sinonimos) + texto. {ok:true, motivoCodigo, motivoTexto} | {ok:false, code, message} (sin eco del contenido).
//   - motivoCodigo: obligatorio y del catalogo (INVALID_MOTIVO).
//   - motivoTexto: ausente / null / "" / solo espacios o controles -> vacio. Si existe: string normalizado de 3 a 300 caracteres unicos (INVALID_MOTIVO_TEXTO). Obligatorio con OTRO.
function fotosPozosModeracion_validarMotivo(motivoCodigo, motivoTexto) {
  if (typeof motivoCodigo !== 'string' || FOTOS_MOD_MOTIVOS.indexOf(motivoCodigo) < 0) {
    return fotosPozosModeracion_error('INVALID_MOTIVO', 'motivoCodigo obligatorio y del catalogo');
  }
  var texto = '';
  if (motivoTexto !== undefined && motivoTexto !== null) {
    var normalizado = fotosPozosModeracion_normalizarTexto(motivoTexto);
    if (normalizado === null) {
      return fotosPozosModeracion_error('INVALID_MOTIVO_TEXTO', 'motivoTexto invalido');
    }
    texto = normalizado;
  }
  if (texto === '') {
    if (motivoCodigo === 'OTRO') {
      return fotosPozosModeracion_error('INVALID_MOTIVO_TEXTO', 'con el motivo OTRO el texto es obligatorio');
    }
    return { ok: true, motivoCodigo: motivoCodigo, motivoTexto: '' };
  }
  var largo = fotosPozosModeracion_largoTexto(texto);
  if (largo < FOTOS_MOD_MOTIVO_TEXTO_MIN || largo > FOTOS_MOD_MOTIVO_TEXTO_MAX) {
    return fotosPozosModeracion_error('INVALID_MOTIVO_TEXTO', 'el texto debe tener entre ' + FOTOS_MOD_MOTIVO_TEXTO_MIN + ' y ' + FOTOS_MOD_MOTIVO_TEXTO_MAX + ' caracteres');
  }
  return { ok: true, motivoCodigo: motivoCodigo, motivoTexto: texto };
}

// --- Permisos (exactos; nunca por nombre ni por autoria) ---

// SOLICITAR_RETIRO: fotos === true Y fotos_carga === true. RETIRAR / RESOLVER_RETIRO / REPONER: fotos === true Y fotos_moderar === true (un moderador que no puede VER las fotos no decide a ciegas).
// Cualquier otro valor (truthy, "SI", 1) o accion desconocida -> false.
function fotosPozosModeracion_puede(accion, permisos) {
  var p = permisos !== null && typeof permisos === 'object' ? permisos : {};
  if (p.fotos !== true) {
    return false;
  }
  if (accion === FOTOS_MOD_ACCIONES.SOLICITAR_RETIRO) {
    return p.fotos_carga === true;
  }
  if (accion === FOTOS_MOD_ACCIONES.RETIRAR || accion === FOTOS_MOD_ACCIONES.RESOLVER_RETIRO || accion === FOTOS_MOD_ACCIONES.REPONER) {
    return p.fotos_moderar === true;
  }
  return false;
}

// --- Identidad de la entidad ---

// Identidad canonica de la foto (la misma que usa el resumen de Fotos: wellId si lo tiene, si no monitoringId). null si no tiene ninguna valida.
function fotosPozosModeracion_entidadDeBase(base) {
  var w = fotosPozosModeracion_texto(base && base.wellId);
  if (w !== '') {
    return FOTOS_MOD_WELLID_REGEX.test(w) ? { tipo: 'WELL', id: w } : null;
  }
  var m = fotosPozosModeracion_texto(base && base.monitoringId);
  if (m !== '') {
    return FOTOS_MOD_MONITORING_REGEX.test(m) ? { tipo: 'MONITORING', id: m } : null;
  }
  return null;
}

function fotosPozosModeracion_entidadValida(tipo, id) {
  if (tipo === 'WELL') {
    return FOTOS_MOD_WELLID_REGEX.test(id);
  }
  if (tipo === 'MONITORING') {
    return FOTOS_MOD_MONITORING_REGEX.test(id);
  }
  return false;
}

// --- Derivacion pura ---

// Un evento "crudo" (fila de la hoja) -> {ok:true, ev} | {ok:false, codigo, fotoId, fila}. fotoId = el de la fila si es un UUID valido ('' si no): permite atribuir el problema a una foto.
// El email NO se lee: la derivacion no lo necesita y asi no puede filtrarse.
function fotosPozosModeracion_parsearEvento(e, orden) {
  if (!e || typeof e !== 'object') {
    return { ok: false, codigo: 'FILA_ROTA', fotoId: '', fila: null };
  }
  var fila = typeof e.fila === 'number' ? e.fila : null;
  var fotoId = fotosPozosModeracion_idNormalizado(e.fotoId);
  function falla(codigo) { return { ok: false, codigo: codigo, fotoId: fotoId, fila: fila }; }
  if (fotoId === '') {
    return falla('FOTO_ID_INVALIDO');
  }
  var evento = fotosPozosModeracion_texto(e.evento);
  if (FOTOS_MOD_EVENTOS.indexOf(evento) < 0) {
    return falla('EVENTO_DESCONOCIDO');
  }
  var eventoId = fotosPozosModeracion_idNormalizado(e.eventoId);
  if (eventoId === '') {
    return falla('ID_INVALIDO');
  }
  var secuencia = fotosPozosModeracion_secuencia(e.secuencia);
  if (secuencia === null) {
    return falla('SECUENCIA_INVALIDA');
  }
  var entidadTipo = fotosPozosModeracion_texto(e.entidadTipo);
  var entidadId = fotosPozosModeracion_texto(e.entidadId);
  if (!fotosPozosModeracion_entidadValida(entidadTipo, entidadId)) {
    return falla('ENTIDAD_INVALIDA');
  }
  var solicitudId = fotosPozosModeracion_texto(e.solicitudId).toLowerCase();
  var resolucion = fotosPozosModeracion_texto(e.resolucion);
  var motivoCodigo = fotosPozosModeracion_texto(e.motivoCodigo);
  var motivoTexto = fotosPozosModeracion_texto(e.motivoTexto);
  if (evento === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO || evento === FOTOS_MOD_EVENTO.RETIRADA) {
    if (solicitudId !== '' || resolucion !== '') {
      return falla('CAMPOS_INCOHERENTES');
    }
    if (FOTOS_MOD_MOTIVOS.indexOf(motivoCodigo) < 0) {
      return falla('MOTIVO_INVALIDO');
    }
    var largo = motivoTexto === '' ? 0 : fotosPozosModeracion_largoTexto(motivoTexto);
    if ((motivoCodigo === 'OTRO' && motivoTexto === '') || (motivoTexto !== '' && (largo < FOTOS_MOD_MOTIVO_TEXTO_MIN || largo > FOTOS_MOD_MOTIVO_TEXTO_MAX))) {
      return falla('MOTIVO_INVALIDO');
    }
  } else if (evento === FOTOS_MOD_EVENTO.RETIRO_RESUELTO) {
    if (fotosPozosModeracion_idNormalizado(solicitudId) === '' || FOTOS_MOD_RESOLUCIONES.indexOf(resolucion) < 0 || motivoCodigo !== '' || motivoTexto !== '') {
      return falla('CAMPOS_INCOHERENTES');
    }
  } else if (solicitudId !== '' || resolucion !== '' || motivoCodigo !== '' || motivoTexto !== '') {
    return falla('CAMPOS_INCOHERENTES');
  }
  return {
    ok: true,
    ev: {
      orden: orden, fila: fila, evento: evento, eventoId: eventoId, secuencia: secuencia, fotoId: fotoId,
      entidadTipo: entidadTipo, entidadId: entidadId, solicitudId: solicitudId, resolucion: resolucion,
      motivoCodigo: motivoCodigo, motivoTexto: motivoTexto,
      nombre: fotosPozosModeracion_texto(e.nombre), timestamp: fotosPozosModeracion_fechaIso(e.timestampUtc)
    }
  };
}

// eventos: lista de eventos "crudos" del repositorio (ver fotosPozoEventosRepository_eventoDesdeFila). Devuelve
//   {porFoto, solicitudes, solicitudFoto, globales}
//   porFoto[fotoId] (solo fotos con algun evento o afectadas por una inconsistencia): {integridad, inconsistencias:[codigos], estado:'ACTIVA'|'RETIRADA'|null, origen:'EVENTO'|null,
//     solicitudAbierta:{solicitudId, motivoCodigo}|null, motivoRetiro:codigo|null, entidad:{tipo,id}|null}. integridad 'NO_DERIVABLE' -> estado null.
//   solicitudes: TODAS las solicitudes de fotos derivables, con su estado derivado (ver fotosPozosModeracion_vistaSolicitud para lo que sale hacia un moderador).
//   solicitudFoto[solicitudId] = fotoId (de TODA RETIRO_SOLICITADO bien formada, aun de una foto no derivable): permite distinguir "no existe" de "no se puede derivar".
//   globales: [{codigo, fila}] filas que no se pueden atribuir a ninguna foto (solo diagnostico: no afectan a ninguna foto).
// Es de USO INTERNO. Nunca incluye el email.
function fotosPozosModeracion_derivar(eventos) {
  var globales = [];
  var afectadas = {};                                    // fotoId -> [codigos]
  function marcar(fotoId, codigo) {
    if (fotoId === '') {
      globales.push({ codigo: codigo, fila: null });
      return;
    }
    afectadas[fotoId] = afectadas[fotoId] || [];
    if (afectadas[fotoId].indexOf(codigo) < 0) {
      afectadas[fotoId].push(codigo);
    }
  }

  // 1) parseo
  var parseados = [];
  (eventos || []).forEach(function (e, orden) {
    var p = fotosPozosModeracion_parsearEvento(e, orden);
    if (!p.ok) {
      if (p.fotoId === '') {
        globales.push({ codigo: p.codigo, fila: p.fila });
      } else {
        marcar(p.fotoId, p.codigo);
      }
      return;
    }
    parseados.push(p.ev);
  });

  // 2) eventoId unico y secuencia unica entre TODOS los eventos: una colision afecta a las fotos de las filas involucradas
  var porEventoId = {};
  var porSecuencia = {};
  parseados.forEach(function (x) {
    (porEventoId[x.eventoId] = porEventoId[x.eventoId] || []).push(x);
    (porSecuencia[x.secuencia] = porSecuencia[x.secuencia] || []).push(x);
  });
  Object.keys(porEventoId).forEach(function (id) {
    if (porEventoId[id].length >= 2) {
      porEventoId[id].forEach(function (x) { marcar(x.fotoId, 'EVENTO_ID_DUPLICADO'); });
    }
  });
  Object.keys(porSecuencia).forEach(function (sec) {
    if (porSecuencia[sec].length >= 2) {
      porSecuencia[sec].forEach(function (x) { marcar(x.fotoId, 'SECUENCIA_DUPLICADA'); });
    }
  });

  // 3) solicitudes y resoluciones
  var solicitudPorId = {};
  var solicitudFoto = {};
  parseados.forEach(function (x) {
    if (x.evento === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO) {
      if (solicitudPorId[x.eventoId] === undefined) {
        solicitudPorId[x.eventoId] = x;
      }
      solicitudFoto[x.eventoId] = x.fotoId;
    }
  });
  var resolucionesPorSolicitud = {};
  parseados.forEach(function (r) {
    if (r.evento !== FOTOS_MOD_EVENTO.RETIRO_RESUELTO) {
      return;
    }
    var s = solicitudPorId[r.solicitudId];
    if (!s) {
      marcar(r.fotoId, 'RESOLUCION_HUERFANA');
      return;
    }
    (resolucionesPorSolicitud[r.solicitudId] = resolucionesPorSolicitud[r.solicitudId] || []).push(r);
    if (s.fotoId !== r.fotoId || s.entidadTipo !== r.entidadTipo || s.entidadId !== r.entidadId) {
      marcar(r.fotoId, 'RESOLUCION_OTRA_FOTO');
      marcar(s.fotoId, 'RESOLUCION_OTRA_FOTO');
    }
    if (r.secuencia < s.secuencia) {
      marcar(r.fotoId, 'RESOLUCION_ANTERIOR_A_SOLICITUD');
      marcar(s.fotoId, 'RESOLUCION_ANTERIOR_A_SOLICITUD');
    }
  });
  Object.keys(resolucionesPorSolicitud).forEach(function (sid) {
    if (resolucionesPorSolicitud[sid].length >= 2) {
      resolucionesPorSolicitud[sid].forEach(function (r) { marcar(r.fotoId, 'RESOLUCION_DOBLE'); });
      marcar(solicitudPorId[sid].fotoId, 'RESOLUCION_DOBLE');
    }
  });

  // 4) por foto: la entidad tiene que ser UNA y la secuencia de eventos tiene que ser una transicion valida
  var porFotoEventos = {};
  parseados.forEach(function (x) { (porFotoEventos[x.fotoId] = porFotoEventos[x.fotoId] || []).push(x); });
  Object.keys(porFotoEventos).forEach(function (fotoId) {
    var lista = porFotoEventos[fotoId];
    lista.forEach(function (x) {
      if (x.entidadTipo !== lista[0].entidadTipo || x.entidadId !== lista[0].entidadId) {
        marcar(fotoId, 'ENTIDAD_INCONSISTENTE_EN_EVENTOS');
      }
    });
  });

  var porFoto = {};
  var solicitudes = [];
  Object.keys(afectadas).forEach(function (fotoId) {
    porFoto[fotoId] = { integridad: FOTOS_MOD_INTEGRIDAD.NO_DERIVABLE, inconsistencias: afectadas[fotoId].slice(), estado: null, origen: null, solicitudAbierta: null, motivoRetiro: null, entidad: null };
  });
  Object.keys(porFotoEventos).forEach(function (fotoId) {
    if (afectadas[fotoId]) {
      return;
    }
    var lista = porFotoEventos[fotoId].slice().sort(function (a, b) { return a.secuencia - b.secuencia; });
    var st = { estado: FOTOS_MOD_ESTADOS_FOTO.ACTIVA, origen: null, abierta: null, motivoRetiro: null };
    var sols = {};
    var solsOrden = [];
    var invalido = null;
    for (var i = 0; i < lista.length && invalido === null; i++) {
      var x = lista[i];
      if (x.evento === FOTOS_MOD_EVENTO.RETIRO_SOLICITADO) {
        if (st.estado !== FOTOS_MOD_ESTADOS_FOTO.ACTIVA) {
          invalido = 'SOLICITUD_SOBRE_FOTO_RETIRADA';
        } else if (st.abierta !== null) {
          invalido = 'SOLICITUD_ABIERTA_DUPLICADA';
        } else {
          st.abierta = x.eventoId;
          sols[x.eventoId] = { ev: x, estado: FOTOS_MOD_ESTADOS_SOLICITUD.ABIERTA, resolucion: null };
          solsOrden.push(x.eventoId);
        }
      } else if (x.evento === FOTOS_MOD_EVENTO.RETIRADA) {
        if (st.estado !== FOTOS_MOD_ESTADOS_FOTO.ACTIVA) {
          invalido = 'RETIRO_DOBLE';
        } else if (st.abierta !== null) {
          invalido = 'RETIRO_CON_SOLICITUD_ABIERTA';
        } else {
          st.estado = FOTOS_MOD_ESTADOS_FOTO.RETIRADA;
          st.origen = FOTOS_MOD_ORIGEN_RETIRO.EVENTO;
          st.motivoRetiro = x.motivoCodigo;
        }
      } else if (x.evento === FOTOS_MOD_EVENTO.RETIRO_RESUELTO) {
        if (st.abierta === null || st.abierta !== x.solicitudId || !sols[x.solicitudId]) {
          invalido = 'RESOLUCION_DE_SOLICITUD_NO_ABIERTA';
        } else {
          var s = sols[x.solicitudId];
          s.estado = x.resolucion === 'APROBADO' ? FOTOS_MOD_ESTADOS_SOLICITUD.APROBADA : FOTOS_MOD_ESTADOS_SOLICITUD.RECHAZADA;
          s.resolucion = x;
          st.abierta = null;
          if (x.resolucion === 'APROBADO') {
            st.estado = FOTOS_MOD_ESTADOS_FOTO.RETIRADA;
            st.origen = FOTOS_MOD_ORIGEN_RETIRO.EVENTO;
            st.motivoRetiro = s.ev.motivoCodigo;
          }
        }
      } else if (x.evento === FOTOS_MOD_EVENTO.REPUESTA) {
        if (st.estado !== FOTOS_MOD_ESTADOS_FOTO.RETIRADA || st.origen !== FOTOS_MOD_ORIGEN_RETIRO.EVENTO) {
          invalido = 'REPOSICION_INVALIDA';
        } else {
          st.estado = FOTOS_MOD_ESTADOS_FOTO.ACTIVA;
          st.origen = null;
          st.motivoRetiro = null;
        }
      }
    }
    if (invalido !== null) {
      porFoto[fotoId] = { integridad: FOTOS_MOD_INTEGRIDAD.NO_DERIVABLE, inconsistencias: [invalido], estado: null, origen: null, solicitudAbierta: null, motivoRetiro: null, entidad: null };
      return;
    }
    var abierta = st.abierta === null ? null : { solicitudId: st.abierta, motivoCodigo: sols[st.abierta].ev.motivoCodigo };
    porFoto[fotoId] = {
      integridad: FOTOS_MOD_INTEGRIDAD.OK, inconsistencias: [], estado: st.estado, origen: st.origen, solicitudAbierta: abierta, motivoRetiro: st.motivoRetiro,
      entidad: { tipo: lista[0].entidadTipo, id: lista[0].entidadId }
    };
    solsOrden.forEach(function (sid) { solicitudes.push({ fotoId: fotoId, entidad: porFoto[fotoId].entidad, solicitud: sols[sid] }); });
  });

  return { porFoto: porFoto, solicitudes: solicitudes, solicitudFoto: solicitudFoto, globales: globales };
}

// Una solicitud de la derivacion -> lo que ve un MODERADOR: lista blanca, sin email. nombre solo de presentacion (neutro si falta o parece un email).
function fotosPozosModeracion_vistaSolicitud(item) {
  var s = item.solicitud;
  var r = s.resolucion;
  return {
    solicitudId: s.ev.eventoId,
    fotoId: item.fotoId,
    entidadTipo: item.entidad.tipo,
    entidadId: item.entidad.id,
    estado: s.estado,
    motivoCodigo: s.ev.motivoCodigo,
    motivoTexto: s.ev.motivoTexto,
    solicitadaPor: fotosPozosModeracion_nombreVisible(s.ev.nombre),
    solicitadaEn: s.ev.timestamp,
    resolucion: r ? r.resolucion : null,
    resueltaPor: r ? fotosPozosModeracion_nombreVisible(r.nombre) : null,
    resueltaEn: r ? r.timestamp : null
  };
}

// Solicitudes derivadas (de fotos derivables) en la vista de moderador. opciones.soloAbiertas: solo las ABIERTA, en orden de solicitud. Sirve a la cola global futura.
function fotosPozosModeracion_solicitudes(derivacion, opciones) {
  var lista = (derivacion && derivacion.solicitudes) || [];
  var soloAbiertas = !!opciones && opciones.soloAbiertas === true;
  return lista
    .filter(function (it) { return !soloAbiertas || it.solicitud.estado === FOTOS_MOD_ESTADOS_SOLICITUD.ABIERTA; })
    .sort(function (a, b) { return a.solicitud.ev.secuencia - b.solicitud.ev.secuencia; })
    .map(fotosPozosModeracion_vistaSolicitud);
}

// --- Estado derivado de UNA foto y visibilidad central ---

function fotosPozosModeracion_dtoNoDerivable(fotoId, codigos) {
  return {
    fotoId: fotoId, estado: null, visible: false, solicitudAbierta: null, puedeReponerse: false, requiereRevisionBorrado: false,
    integridad: FOTOS_MOD_INTEGRIDAD.NO_DERIVABLE, origenRetiro: null, inconsistencias: codigos
  };
}

// base: la foto tal como la lee FotosPozos {fotoId, estado, estadoVinculo, wellId, monitoringId}; derivacion: el resultado de fotosPozosModeracion_derivar sobre los eventos de la hoja.
// DTO interno (sin email, sin motivoTexto, sin nombres):
//   {fotoId, estado:'ACTIVA'|'RETIRADA'|null, visible, solicitudAbierta:{solicitudId, motivoCodigo}|null, puedeReponerse, requiereRevisionBorrado, integridad, origenRetiro, inconsistencias}
//   - baseline ACTIVA sin eventos -> ACTIVA. baseline OCULTA (con o sin eventos) -> RETIRADA, origenRetiro 'LEGACY_OCULTA', puedeReponerse false: NINGUN evento la revive.
//   - una solicitud abierta NO oculta la foto: sigue ACTIVA.
//   - puedeReponerse: baseline ACTIVA y retirada POR EVENTOS. requiereRevisionBorrado: retirada por eventos con motivo PRIVACIDAD (senal derivada: no hay workflow de borrado todavia).
//   - sin derivacion (null / invalida), foto sin id valido, baseline desconocido o entidad de los eventos distinta de la de la foto -> NO_DERIVABLE (visible false).
function fotosPozosModeracion_estadoFoto(base, derivacion) {
  var b = base !== null && typeof base === 'object' ? base : {};
  var fotoId = fotosPozosModeracion_idNormalizado(b.fotoId);
  if (fotoId === '') {
    return fotosPozosModeracion_dtoNoDerivable('', ['FOTO_ID_INVALIDO']);
  }
  if (!derivacion || typeof derivacion !== 'object' || typeof derivacion.porFoto !== 'object' || derivacion.porFoto === null) {
    return fotosPozosModeracion_dtoNoDerivable(fotoId, ['DERIVACION_NO_DISPONIBLE']);
  }
  var baseline = fotosPozosModeracion_texto(b.estado);
  if (baseline !== FOTOS_MOD_ESTADOS_BASE.ACTIVA && baseline !== FOTOS_MOD_ESTADOS_BASE.OCULTA) {
    return fotosPozosModeracion_dtoNoDerivable(fotoId, ['BASELINE_DESCONOCIDO']);
  }
  var ev = Object.prototype.hasOwnProperty.call(derivacion.porFoto, fotoId) ? derivacion.porFoto[fotoId] : null;
  if (ev !== null && ev.integridad !== FOTOS_MOD_INTEGRIDAD.OK) {
    return fotosPozosModeracion_dtoNoDerivable(fotoId, (ev.inconsistencias || []).slice());
  }
  if (ev !== null && ev.entidad) {
    var canon = fotosPozosModeracion_entidadDeBase(b);
    if (canon === null || canon.tipo !== ev.entidad.tipo || canon.id !== ev.entidad.id) {
      return fotosPozosModeracion_dtoNoDerivable(fotoId, ['ENTIDAD_NO_COINCIDE']);
    }
  }
  var estadoEventos = ev === null ? FOTOS_MOD_ESTADOS_FOTO.ACTIVA : ev.estado;
  var legacy = baseline === FOTOS_MOD_ESTADOS_BASE.OCULTA;
  var estado = legacy || estadoEventos === FOTOS_MOD_ESTADOS_FOTO.RETIRADA ? FOTOS_MOD_ESTADOS_FOTO.RETIRADA : FOTOS_MOD_ESTADOS_FOTO.ACTIVA;
  var origen = legacy ? FOTOS_MOD_ORIGEN_RETIRO.LEGACY_OCULTA : (estadoEventos === FOTOS_MOD_ESTADOS_FOTO.RETIRADA ? FOTOS_MOD_ORIGEN_RETIRO.EVENTO : null);
  // baseline ACTIVA ya esta implicito en estado ACTIVA (una base OCULTA fuerza estado RETIRADA arriba)
  var visible = fotosPozosModeracion_texto(b.estadoVinculo) === 'CONFIRMADO' && estado === FOTOS_MOD_ESTADOS_FOTO.ACTIVA;
  return {
    fotoId: fotoId,
    estado: estado,
    visible: visible,
    solicitudAbierta: ev !== null && ev.solicitudAbierta ? { solicitudId: ev.solicitudAbierta.solicitudId, motivoCodigo: ev.solicitudAbierta.motivoCodigo } : null,
    puedeReponerse: !legacy && estadoEventos === FOTOS_MOD_ESTADOS_FOTO.RETIRADA && ev !== null && ev.origen === FOTOS_MOD_ORIGEN_RETIRO.EVENTO,
    requiereRevisionBorrado: ev !== null && estadoEventos === FOTOS_MOD_ESTADOS_FOTO.RETIRADA && ev.motivoRetiro === 'PRIVACIDAD',
    integridad: FOTOS_MOD_INTEGRIDAD.OK,
    origenRetiro: origen,
    inconsistencias: []
  };
}

// LA decision central: ¿se muestra en la galeria normal? baseline ACTIVA Y vinculo CONFIRMADO Y estado derivado ACTIVA Y historial derivable. Fail-closed: cualquier duda -> false.
function fotosPozosModeracion_visible(base, derivacion) {
  return fotosPozosModeracion_estadoFoto(base, derivacion).visible === true;
}

// --- Cache (diseno para E8-3) ---

// Claves de CacheService que hay que botar cuando una foto cambia de visibilidad: metadata (ids internos), miniatura y el resumen / contador (cuenta fotos visibles por entidad). La imagen 'full'
// NO se cachea. La LISTA de la galeria tampoco se cachea (se arma en cada pedido), asi que no hay otra clave.
function fotosPozosModeracion_clavesCacheAInvalidar(fotoId) {
  var id = fotosPozosModeracion_idNormalizado(fotoId);
  if (id === '') {
    return [FOTOS_MOD_CACHE_RESUMEN_CLAVE];
  }
  return [FOTOS_MOD_CACHE_META_PREFIJO + id, FOTOS_MOD_CACHE_THUMB_PREFIJO + id, FOTOS_MOD_CACHE_RESUMEN_CLAVE];
}

// Eventos que cambian la visibilidad (y por lo tanto invalidan el cache): RETIRADA, RETIRO_RESUELTO + APROBADO y REPUESTA. Una solicitud y un rechazo NO la cambian.
function fotosPozosModeracion_requiereInvalidarCache(evento) {
  var e = evento || {};
  return e.evento === FOTOS_MOD_EVENTO.RETIRADA || e.evento === FOTOS_MOD_EVENTO.REPUESTA || (e.evento === FOTOS_MOD_EVENTO.RETIRO_RESUELTO && e.resolucion === 'APROBADO');
}

// --- Comandos: validacion, idempotencia y transiciones (puro) ---

// datos: {accion, fotoId, solicitudId, resolucion, motivoCodigo, motivoTexto, clientRequestId}. Cada accion usa SOLO sus campos; uno de otra accion se RECHAZA (no se ignora en silencio).
//   SOLICITAR_RETIRO y RETIRAR: fotoId + motivo. RESOLVER_RETIRO: solicitudId + resolucion (la foto y la entidad salen de la solicitud, el cliente NO las manda ni hay motivo). REPONER: fotoId.
// {ok:true, valores} | {ok:false, code, message} (sin eco del contenido).
function fotosPozosModeracion_validarComando(datos) {
  var d = datos !== null && typeof datos === 'object' ? datos : {};
  var accion = d.accion;
  if (typeof accion !== 'string' || !Object.prototype.hasOwnProperty.call(FOTOS_MOD_ACCIONES, accion)) {
    return fotosPozosModeracion_error('INVALID_ACCION', 'accion invalida');
  }
  if (typeof d.clientRequestId !== 'string' || !FOTOS_MOD_CLIENT_REQUEST_ID_REGEX.test(d.clientRequestId)) {
    return fotosPozosModeracion_error('INVALID_CLIENT_REQUEST_ID', 'clientRequestId obligatorio (8 a 64 caracteres: letras, numeros, guion y guion bajo)');
  }
  function ausente(v) { return v === undefined || v === null || v === ''; }
  if (accion === FOTOS_MOD_ACCIONES.RESOLVER_RETIRO) {
    var sid = fotosPozosModeracion_idNormalizado(d.solicitudId);
    if (sid === '') {
      return fotosPozosModeracion_error('INVALID_SOLICITUD_ID', 'solicitudId invalido');
    }
    if (typeof d.resolucion !== 'string' || FOTOS_MOD_RESOLUCIONES.indexOf(d.resolucion) < 0) {
      return fotosPozosModeracion_error('INVALID_RESOLUCION', 'resolucion invalida');
    }
    if (!ausente(d.fotoId) || !ausente(d.motivoCodigo) || !ausente(d.motivoTexto)) {
      return fotosPozosModeracion_error('INVALID_REQUEST', 'una resolucion no lleva foto ni motivo');
    }
    return { ok: true, valores: { accion: accion, solicitudId: sid, resolucion: d.resolucion, clientRequestId: d.clientRequestId } };
  }
  var fotoId = fotosPozosModeracion_idNormalizado(d.fotoId);
  if (fotoId === '') {
    return fotosPozosModeracion_error('INVALID_FOTO_ID', 'fotoId invalido');
  }
  if (!ausente(d.solicitudId) || !ausente(d.resolucion)) {
    return fotosPozosModeracion_error('INVALID_REQUEST', 'campos que no corresponden a la accion');
  }
  if (accion === FOTOS_MOD_ACCIONES.REPONER) {
    if (!ausente(d.motivoCodigo) || !ausente(d.motivoTexto)) {
      return fotosPozosModeracion_error('INVALID_REQUEST', 'una reposicion no lleva motivo');
    }
    return { ok: true, valores: { accion: accion, fotoId: fotoId, clientRequestId: d.clientRequestId } };
  }
  var motivo = fotosPozosModeracion_validarMotivo(d.motivoCodigo, d.motivoTexto);
  if (!motivo.ok) {
    return motivo;
  }
  return { ok: true, valores: { accion: accion, fotoId: fotoId, motivoCodigo: motivo.motivoCodigo, motivoTexto: motivo.motivoTexto, clientRequestId: d.clientRequestId } };
}

var FOTOS_MOD_EVENTO_DE_ACCION = {
  SOLICITAR_RETIRO: 'RETIRO_SOLICITADO',
  RETIRAR: 'RETIRADA',
  RESOLVER_RETIRO: 'RETIRO_RESUELTO',
  REPONER: 'REPUESTA'
};

// Ya hay UN evento del usuario con ese clientRequestId (existentes = lo que devuelve fotosPozoEventosRepository_buscarPorClientRequestId): ¿es el MISMO pedido?
//   - mas de una coincidencia o sin evento legible -> INCONSISTENT_STATE; un evento de otro tipo o con otro contenido -> IDEMPOTENCY_CONFLICT;
//   - mismo contenido -> reintento exacto: {ok:true, accion:'REINTENTO', evento} (el original, SIN email); no se escribe nada ni se consume secuencia.
// Contenido comparado: SOLICITAR/RETIRAR: tipo + foto + codigo + texto; RESOLVER: tipo + solicitud + resolucion; REPONER: tipo + foto. Timestamp y secuencia no cuentan.
function fotosPozosModeracion_atenderExistente(existentes, valores) {
  if (!existentes || existentes.total !== 1 || !existentes.eventos || existentes.eventos.length !== 1) {
    return fotosPozosModeracion_error('INCONSISTENT_STATE', 'el clientRequestId figura mas de una vez: requiere revision manual');
  }
  var e = existentes.eventos[0];
  var tipo = FOTOS_MOD_EVENTO_DE_ACCION[valores.accion];
  var mismo = e.evento === tipo;
  if (mismo && valores.accion === FOTOS_MOD_ACCIONES.RESOLVER_RETIRO) {
    mismo = e.solicitudId === valores.solicitudId && e.resolucion === valores.resolucion;
  } else if (mismo && valores.accion === FOTOS_MOD_ACCIONES.REPONER) {
    mismo = e.fotoId === valores.fotoId;
  } else if (mismo) {
    mismo = e.fotoId === valores.fotoId && e.motivoCodigo === valores.motivoCodigo && fotosPozosModeracion_texto(e.motivoTexto) === valores.motivoTexto;
  }
  if (!mismo) {
    return fotosPozosModeracion_error('IDEMPOTENCY_CONFLICT', 'clientRequestId ya usado con otro contenido');
  }
  return {
    ok: true,
    accion: 'REINTENTO',
    evento: { eventoId: e.eventoId, evento: e.evento, fotoId: e.fotoId, solicitudId: e.solicitudId, resolucion: e.resolucion, motivoCodigo: e.motivoCodigo, motivoTexto: e.motivoTexto },
    invalidaCache: false
  };
}

// Decide TODO lo que hace falta antes de escribir, sin tocar hojas: validar -> permiso -> idempotencia -> estado -> evento. contexto:
//   {email, nombre, permisos, ahora (Date), derivacion, obtenerBase(fotoId) -> base|null, existentes ({total, eventos} del repositorio), nuevoEventoId() -> uuid}
// Resultado: {ok:true, accion:'ESCRIBIR', evento, invalidaCache} (evento completo MENOS `secuencia`: la pone el repositorio bajo lock; lleva el email SOLO para escribirlo: no reenviar al cliente)
//   | {ok:true, accion:'REINTENTO', evento, invalidaCache:false} | {ok:false, code, message}.
// El estado se evalua con la derivacion del contexto: E8-3 la arma DENTRO del lock, justo antes de escribir.
function fotosPozosModeracion_planificar(comando, contexto) {
  var ctx = contexto || {};
  var v = fotosPozosModeracion_validarComando(comando);
  if (!v.ok) {
    return v;
  }
  var valores = v.valores;
  if (!fotosPozosModeracion_puede(valores.accion, ctx.permisos)) {
    return fotosPozosModeracion_error('PERMISSION_DENIED', 'permiso insuficiente');
  }
  var email = fotosPozosModeracion_normalizarEmail(ctx.email);
  if (!FOTOS_MOD_EMAIL_REGEX.test(email)) {
    return fotosPozosModeracion_error('INVALID_REQUEST', 'sesion sin email valido');
  }
  if (ctx.existentes && ctx.existentes.total > 0) {
    return fotosPozosModeracion_atenderExistente(ctx.existentes, valores);
  }

  var obtenerBase = typeof ctx.obtenerBase === 'function' ? ctx.obtenerBase : function () { return null; };
  var derivacion = ctx.derivacion;
  var evento = { evento: FOTOS_MOD_EVENTO_DE_ACCION[valores.accion], solicitudId: '', resolucion: '', motivoCodigo: '', motivoTexto: '' };
  var entidad;
  var fotoId;

  if (valores.accion === FOTOS_MOD_ACCIONES.RESOLVER_RETIRO) {
    var items = (derivacion && derivacion.solicitudes) || [];
    var item = null;
    items.forEach(function (it) { if (it.solicitud.ev.eventoId === valores.solicitudId) { item = it; } });
    if (item === null) {
      var conocida = derivacion && derivacion.solicitudFoto && Object.prototype.hasOwnProperty.call(derivacion.solicitudFoto, valores.solicitudId);
      return conocida
        ? fotosPozosModeracion_error('ESTADO_NO_DERIVABLE', 'el historial de la foto no se puede derivar: requiere revision manual')
        : fotosPozosModeracion_error('SOLICITUD_NOT_FOUND', 'no existe la solicitud');
    }
    if (item.solicitud.estado !== FOTOS_MOD_ESTADOS_SOLICITUD.ABIERTA) {
      return fotosPozosModeracion_error('SOLICITUD_YA_RESUELTA', 'la solicitud ya fue resuelta');
    }
    if (fotosPozosModeracion_idNormalizado(((obtenerBase(item.fotoId) || {}).fotoId)) === '') {
      return fotosPozosModeracion_error('INCONSISTENT_STATE', 'la foto de la solicitud no existe: requiere revision manual');
    }
    fotoId = item.fotoId;                                // de la SOLICITUD original, nunca del cliente
    entidad = item.entidad;
    evento.solicitudId = valores.solicitudId;
    evento.resolucion = valores.resolucion;
  } else {
    fotoId = valores.fotoId;
    var base = obtenerBase(fotoId);
    if (base === null || base === undefined) {
      return fotosPozosModeracion_error('FOTO_NOT_FOUND', 'no existe la foto');
    }
    var dto = fotosPozosModeracion_estadoFoto(base, derivacion);
    if (valores.accion === FOTOS_MOD_ACCIONES.SOLICITAR_RETIRO) {
      if (dto.visible !== true) {
        return fotosPozosModeracion_error('FOTO_NOT_FOUND', 'no existe la foto');         // mismo error: inexistente, oculta, retirada, no derivable o sin vinculo confirmado
      }
      if (dto.solicitudAbierta !== null) {
        return fotosPozosModeracion_error('SOLICITUD_YA_ABIERTA', 'la foto ya tiene una solicitud de retiro abierta');
      }
    } else {
      if (dto.integridad !== FOTOS_MOD_INTEGRIDAD.OK) {
        return fotosPozosModeracion_error('ESTADO_NO_DERIVABLE', 'el historial de la foto no se puede derivar: requiere revision manual');
      }
      if (valores.accion === FOTOS_MOD_ACCIONES.RETIRAR) {
        if (dto.estado === FOTOS_MOD_ESTADOS_FOTO.RETIRADA) {
          return fotosPozosModeracion_error('FOTO_YA_RETIRADA', 'la foto ya esta retirada');
        }
        if (dto.solicitudAbierta !== null) {
          return fotosPozosModeracion_error('SOLICITUD_ABIERTA', 'la foto tiene una solicitud abierta: resolverla primero');
        }
      } else {                                           // REPONER
        if (dto.origenRetiro === FOTOS_MOD_ORIGEN_RETIRO.LEGACY_OCULTA) {
          return fotosPozosModeracion_error('REPOSICION_NO_PERMITIDA', 'la foto esta oculta desde antes de la moderacion: no se repone automaticamente');
        }
        if (dto.puedeReponerse !== true) {
          return fotosPozosModeracion_error('FOTO_NO_RETIRADA', 'la foto no esta retirada');
        }
      }
    }
    entidad = fotosPozosModeracion_entidadDeBase(base);
    if (entidad === null) {
      return fotosPozosModeracion_error('INCONSISTENT_STATE', 'la foto no tiene una entidad valida: requiere revision manual');
    }
    if (valores.accion !== FOTOS_MOD_ACCIONES.REPONER) {
      evento.motivoCodigo = valores.motivoCodigo;
      evento.motivoTexto = valores.motivoTexto;
    }
  }

  var ahora = ctx.ahora instanceof Date && !isNaN(ctx.ahora.getTime()) ? ctx.ahora : null;
  var eventoId = typeof ctx.nuevoEventoId === 'function' ? fotosPozosModeracion_idNormalizado(ctx.nuevoEventoId()) : '';
  if (ahora === null || eventoId === '') {
    throw new Error('fotosPozosModeracion_planificar: falta ahora (Date) o nuevoEventoId() no devolvio un UUID');
  }
  var escrito = {
    eventoId: eventoId,
    evento: evento.evento,
    fotoId: fotoId,
    entidadTipo: entidad.tipo,
    entidadId: entidad.id,
    solicitudId: evento.solicitudId,
    resolucion: evento.resolucion,
    motivoCodigo: evento.motivoCodigo,
    motivoTexto: evento.motivoTexto,
    email: email,
    nombre: fotosPozosModeracion_texto(ctx.nombre) === '' ? '' : fotosPozosModeracion_nombreVisible(ctx.nombre),
    timestampUtc: ahora.toISOString(),
    clientRequestId: valores.clientRequestId
  };
  return { ok: true, accion: 'ESCRIBIR', evento: escrito, invalidaCache: fotosPozosModeracion_requiereInvalidarCache(escrito) };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_MOD_EVENTO,
    FOTOS_MOD_EVENTOS,
    FOTOS_MOD_RESOLUCIONES,
    FOTOS_MOD_MOTIVOS,
    FOTOS_MOD_ENTIDAD_TIPOS,
    FOTOS_MOD_ESTADOS_BASE,
    FOTOS_MOD_ESTADOS_FOTO,
    FOTOS_MOD_ESTADOS_SOLICITUD,
    FOTOS_MOD_ORIGEN_RETIRO,
    FOTOS_MOD_INTEGRIDAD,
    FOTOS_MOD_ACCIONES,
    FOTOS_MOD_MOTIVO_TEXTO_MIN,
    FOTOS_MOD_MOTIVO_TEXTO_MAX,
    FOTOS_MOD_CLIENT_REQUEST_ID_REGEX,
    FOTOS_MOD_CACHE_META_PREFIJO,
    FOTOS_MOD_CACHE_THUMB_PREFIJO,
    FOTOS_MOD_CACHE_RESUMEN_CLAVE,
    fotosPozosModeracion_idNormalizado,
    fotosPozosModeracion_normalizarEmail,
    fotosPozosModeracion_fechaIso,
    fotosPozosModeracion_normalizarTexto,
    fotosPozosModeracion_nombreVisible,
    fotosPozosModeracion_validarMotivo,
    fotosPozosModeracion_puede,
    fotosPozosModeracion_entidadDeBase,
    fotosPozosModeracion_parsearEvento,
    fotosPozosModeracion_derivar,
    fotosPozosModeracion_vistaSolicitud,
    fotosPozosModeracion_solicitudes,
    fotosPozosModeracion_estadoFoto,
    fotosPozosModeracion_visible,
    fotosPozosModeracion_clavesCacheAInvalidar,
    fotosPozosModeracion_requiereInvalidarCache,
    fotosPozosModeracion_validarComando,
    fotosPozosModeracion_atenderExistente,
    fotosPozosModeracion_planificar
  };
}
