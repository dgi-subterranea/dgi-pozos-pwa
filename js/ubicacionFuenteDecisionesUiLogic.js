// Decisiones sobre las fuentes registrales de ubicacion (Aceptar / Descartar / Quitar aceptacion / Restaurar): logica PURA de la interfaz, sin DOM, sin red.
// La usan las tarjetas de "Ubicaciones conocidas" Y el popup del visor "Ver todas en el mapa": un solo lugar decide que acciones corresponden, que texto lleva
// cada confirmacion, como se arma el pedido y como se traduce cada error. El dominio (maquina de estados, resolver) NO esta aca: vive en el backend
// (backend/src/UbicacionFuenteDecisionesLogic.js) y el frontend solo muestra lo que ese backend informa.
//
// Principios:
//   - NUNCA se borra ni se modifica la coordenada original de una fuente: la UI habla de Aceptar / Descartar / Restaurar / Quitar aceptacion, jamas de "eliminar".
//   - "Validada en campo" pertenece a UbicacionCorrecciones, no a estas decisiones: nunca lleva estado ni acciones.
//   - Fail-closed: sin decisiones leidas del backend (o con el historial del pozo inconsistente) no se ofrece ninguna accion.
//   - Quien no tiene ubicacion_validar NO ve acciones autoritativas (las sugerencias son otra etapa).
//
// Dependencias (globales en el navegador, cargadas antes): ubicacionesConocidasLogic_escapar (se usa solo para el HTML).
var UFDUI_ROL = { VALIDADOR: 'VALIDADOR', LECTOR: 'LECTOR' };
var UFDUI_ESTADOS = { SIN_REVISAR: 'SIN_REVISAR', ACEPTADA: 'ACEPTADA', DESCARTADA: 'DESCARTADA' };
var UFDUI_ETIQUETA_ESTADO = { SIN_REVISAR: 'Sin revisar', ACEPTADA: 'Aceptada', DESCARTADA: 'Descartada' };
var UFDUI_TIPOS_REGISTRALES = { REPORTE_POZOS: true, IRRIGACION: true };
var UFDUI_MOTIVO_MAX = 300;
var UFDUI_CODIGOS_SESION = ['UNAUTHORIZED', 'USER_DISABLED'];

var UFDUI_ACCIONES = {
  ACEPTAR: {
    boton: 'Aceptar', titulo: '¿Aceptar esta fuente como referencia registral?', parrafos: [], motivo: 'opcional', ok: 'Sí, aceptar',
    exito: 'Fuente aceptada como referencia registral.'
  },
  DESCARTAR: {
    boton: 'Descartar', titulo: '¿Descartar esta fuente?', parrafos: ['La coordenada original no se eliminará. Quedará conservada y marcada como descartada.'],
    motivo: 'obligatorio', ok: 'Sí, descartar', exito: 'Fuente descartada. La coordenada original se conserva.'
  },
  QUITAR_ACEPTACION: {
    boton: 'Quitar aceptación', titulo: '¿Quitar la aceptación de esta fuente?', parrafos: ['La fuente volverá a quedar sin revisar y participará del cálculo automático.'],
    motivo: 'opcional', ok: 'Sí, quitar aceptación', exito: 'Se quitó la aceptación de la fuente.'
  },
  RESTAURAR: {
    boton: 'Restaurar', titulo: '¿Restaurar esta fuente?', parrafos: ['La fuente volverá a participar del cálculo automático. No quedará aceptada automáticamente.'],
    motivo: 'opcional', ok: 'Sí, restaurar', exito: 'Fuente restaurada: vuelve a participar del cálculo automático.'
  }
};
var UFDUI_TEXTO_ACEPTAR_CON_CAMPO = 'Esta fuente quedará aceptada como referencia registral, pero la ubicación operativa seguirá siendo la validada en campo.';
var UFDUI_TEXTO_DESCARTAR_ACEPTADA = 'Esta fuente está aceptada: al descartarla también se quita su aceptación.';
var UFDUI_TEXTO_STALE = 'Esta información cambió mientras la estabas revisando.';
var UFDUI_TEXTO_STALE_ACCION = 'Esta información cambió mientras la estabas revisando. Revisá el estado actual y volvé a decidir si corresponde.';
var UFDUI_TEXTO_RED = 'No se pudo guardar la decisión. Revisá tu conexión e intentá de nuevo.';
var UFDUI_TEXTO_INCONSISTENTE = 'El historial de decisiones de este pozo necesita una revisión técnica. Por ahora no se pueden tomar decisiones sobre sus fuentes.';
var UFDUI_TEXTO_TODAS_DESCARTADAS = 'Sin ubicación operativa de Irrigación. Todas las fuentes conocidas fueron descartadas.';
var UFDUI_TEXTO_SIN_EFECTO_MAPAS = 'Las decisiones tomadas todavía no cambian el punto que usan los mapas.';

var UFDUI_MENSAJES_ERROR = {
  STALE_STATE: UFDUI_TEXTO_STALE_ACCION,
  ALREADY_IN_STATE: UFDUI_TEXTO_STALE_ACCION,
  INVALID_TRANSITION: UFDUI_TEXTO_STALE_ACCION,
  SOURCE_NOT_FOUND: 'Esa fuente ya no figura en el padrón. Se actualizó la información.',
  INCONSISTENT_STATE: UFDUI_TEXTO_INCONSISTENTE,
  PERMISSION_DENIED: 'No tenés permiso para tomar decisiones sobre las fuentes.',
  INVALID_MOTIVO: 'Indicá el motivo (hasta 300 caracteres).',
  WELL_NOT_FOUND: 'No se encontró el pozo.',
  SERVICE_UNAVAILABLE: 'No se pudo guardar la decisión. Intentá de nuevo en unos minutos.'
};
// Estos errores significan "lo que viste ya no es lo vigente": hay que releer y NO reintentar solo.
var UFDUI_CODIGOS_DESACTUALIZADO = ['STALE_STATE', 'ALREADY_IN_STATE', 'INVALID_TRANSITION', 'SOURCE_NOT_FOUND'];

function ufdui_escapar(t) {
  return typeof ubicacionesConocidasLogic_escapar === 'function' ? ubicacionesConocidasLogic_escapar(t) :
    String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// --- Rol (fail-closed: solo con los permisos EXACTAMENTE en true) ---

function ufdui_rol(permisos) {
  if (!permisos || permisos.ubicacion !== true) {
    return null;
  }
  return permisos.ubicacion_validar === true ? UFDUI_ROL.VALIDADOR : UFDUI_ROL.LECTOR;
}

// --- Vinculo entre las fuentes que dibuja la ficha y las que informa el backend ---

function ufdui_clave3(tipo, x, y) {
  var nx = Number(x);
  var ny = Number(y);
  if (typeof tipo !== 'string' || !isFinite(nx) || !isFinite(ny) || x === null || y === null || x === '' || y === '') {
    return null;
  }
  return tipo + '|' + nx.toFixed(3) + '|' + ny.toFixed(3);
}

// La vista que devuelve getDecisionesFuentesPozo es "usable" si es del pozo y trae la lista de fuentes.
function ufdui_vistaValida(vista, wellId) {
  return !!vista && typeof vista === 'object' && vista.wellId === wellId && Array.isArray(vista.fuentes) && typeof vista.version === 'number' && isFinite(vista.version);
}

// modelo: lo que devuelve ubicacionesConocidasLogic_construir. Le agrega a cada fuente registral `decision` ({estado, x, y, fuenteTipo, ultima, ...} o null) y a
// modelo.decisiones el resumen {integro, version, todasDescartadas, cambiaPuntoRegistral}. "Validada en campo" nunca recibe decision. Devuelve el mismo modelo.
function ufdui_aplicarDecisiones(modelo, vista, hayValidadaVigente) {
  if (!modelo || !Array.isArray(modelo.fuentes)) {
    return modelo;
  }
  modelo.decisiones = null;
  modelo.fuentes.forEach(function (f) { f.decision = null; });
  if (!ufdui_vistaValida(vista, modelo.wellId)) {
    return modelo;
  }
  var porClave = {};
  vista.fuentes.forEach(function (d) {
    var k = ufdui_clave3(d.fuenteTipo, d.x, d.y);
    if (k && !porClave[k]) {
      porClave[k] = d;
    }
  });
  var integro = vista.integro === true;
  modelo.fuentes.forEach(function (f) {
    if (!UFDUI_TIPOS_REGISTRALES[f.tipo] || f.invalida) {
      return;
    }
    var d = porClave[ufdui_clave3(f.tipo, f.x, f.y)];
    if (d && UFDUI_ESTADOS[d.estado]) {
      f.decision = { estado: d.estado, fuenteTipo: d.fuenteTipo, x: d.x, y: d.y, clave: d.clave, ultima: d.ultima || null };
    }
  });
  var res = vista.resolucion && typeof vista.resolucion === 'object' ? vista.resolucion : {};
  modelo.decisiones = {
    integro: integro, version: vista.version, hayValidadaVigente: !!hayValidadaVigente,
    todasDescartadas: integro && res.todasDescartadas === true && !hayValidadaVigente,
    cambiaPuntoRegistral: integro && res.cambiaRespectoDelOriginal === true && !hayValidadaVigente
  };
  return modelo;
}

// --- Acciones disponibles ---

// Validador: SIN_REVISAR -> Aceptar, Descartar | ACEPTADA -> Quitar aceptacion, Descartar | DESCARTADA -> Restaurar. Lector: ninguna (las sugerencias son otra etapa).
function ufdui_accionesPara(estadoFuente, rol) {
  if (rol !== UFDUI_ROL.VALIDADOR) {
    return [];
  }
  if (estadoFuente === UFDUI_ESTADOS.SIN_REVISAR) {
    return ['ACEPTAR', 'DESCARTAR'];
  }
  if (estadoFuente === UFDUI_ESTADOS.ACEPTADA) {
    return ['QUITAR_ACEPTACION', 'DESCARTAR'];
  }
  if (estadoFuente === UFDUI_ESTADOS.DESCARTADA) {
    return ['RESTAURAR'];
  }
  return [];
}

// Las acciones de UNA fuente de un modelo ya vinculado: [] si no hay decision, el pozo no es integro o no es validador.
function ufdui_accionesDeFuente(f, modelo, rol) {
  if (!f || !f.decision || !modelo || !modelo.decisiones || modelo.decisiones.integro !== true || f.tipo === 'CAMPO_VALIDADA') {
    return [];
  }
  return ufdui_accionesPara(f.decision.estado, rol);
}

// --- Confirmaciones ---

// {accion, titulo, fuente, parrafos[], motivo:'obligatorio'|'opcional', ok}
function ufdui_confirmacion(accion, fuente, contexto) {
  var a = UFDUI_ACCIONES[accion];
  if (!a) {
    return null;
  }
  var c = contexto || {};
  var parrafos = a.parrafos.slice();
  if (accion === 'ACEPTAR' && c.hayValidadaVigente) {
    parrafos.push(UFDUI_TEXTO_ACEPTAR_CON_CAMPO);
  }
  if (accion === 'DESCARTAR' && fuente && fuente.decision && fuente.decision.estado === UFDUI_ESTADOS.ACEPTADA) {
    parrafos.unshift(UFDUI_TEXTO_DESCARTAR_ACEPTADA);
  }
  return { accion: accion, titulo: a.titulo, fuente: fuente ? fuente.etiqueta : '', parrafos: parrafos, motivo: a.motivo, ok: a.ok };
}

// null si esta bien; si no, el mensaje. DESCARTAR exige motivo; en las demas es opcional pero acotado.
function ufdui_validarMotivo(accion, motivo) {
  var m = typeof motivo === 'string' ? motivo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
  if (m.length > UFDUI_MOTIVO_MAX) {
    return 'El motivo no puede superar los ' + UFDUI_MOTIVO_MAX + ' caracteres.';
  }
  if (accion === 'DESCARTAR' && m === '') {
    return 'Indicá el motivo del descarte.';
  }
  return null;
}

// --- Pedido al backend: LISTA BLANCA exacta ---

function ufdui_nuevoClientRequestId(aleatorio) {
  if (!aleatorio && typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    return 'ufd-' + crypto.randomUUID();
  }
  var azar = aleatorio || Math.random;
  var s = '';
  while (s.length < 24) {
    s += Math.floor(azar() * 36).toString(36);
  }
  return 'ufd-' + Date.now().toString(36) + '-' + s;
}

// Exactamente: wellId, fuenteTipo, x, y, accion, motivo, versionVista, clientRequestId. x/y son los que informo el backend para esa fuente (no los de pantalla).
function ufdui_construirPedido(wellId, decision, accion, motivo, versionVista, clientRequestId) {
  return {
    wellId: wellId,
    fuenteTipo: decision.fuenteTipo,
    x: decision.x,
    y: decision.y,
    accion: accion,
    motivo: typeof motivo === 'string' ? motivo.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '',
    versionVista: versionVista,
    clientRequestId: clientRequestId
  };
}

function ufdui_firma(p) {
  return JSON.stringify([p.wellId, p.fuenteTipo, p.x, p.y, p.accion, p.motivo, p.versionVista]);
}

function ufdui_mensajeError(code) {
  return Object.prototype.hasOwnProperty.call(UFDUI_MENSAJES_ERROR, code) ? UFDUI_MENSAJES_ERROR[code] : 'No se pudo guardar la decisión. Intentá de nuevo.';
}

// --- Flujo: clientRequestId estable por intento, sin doble envio, relectura cuando lo visto quedo viejo ---
//
// deps: {enviar(pedido) -> Promise<respuesta>, leer(wellId) -> Promise<respuesta de getDecisionesFuentesPozo>, generarId() -> string}
// decidir(entrada) resuelve (nunca rechaza) con:
//   {tipo:'invalido', mensaje}
//   {tipo:'ok', accion, mensaje, vista, duplicada, decision}            vista: la vista ACTUALIZADA que devuelve el backend (o null si no vino)
//   {tipo:'desactualizado', code, mensaje, vista|null}                  otro usuario cambio algo: se RELEYO y NO se repite la decision sola
//   {tipo:'error', code, mensaje, sesionVencida}
//   {tipo:'red', mensaje}                                               el id queda guardado: reintentar el MISMO contenido lo reutiliza (el backend lo deduplica)
// El clientRequestId se reutiliza mientras el contenido (pozo, fuente, accion, motivo, versionVista) sea el mismo y no haya terminado bien. Cambiar el motivo o releer
// la version es otro contenido => otro id (si no, el backend responderia IDEMPOTENCY_CONFLICT).
function ufdui_crearFlujo(deps) {
  var intento = null;
  var enCurso = null;

  function idPara(sinId) {
    var firma = ufdui_firma(sinId);
    if (!intento || intento.firma !== firma) {
      intento = { firma: firma, id: deps.generarId() };
    }
    return intento.id;
  }

  function releer(wellId) {
    return Promise.resolve().then(function () { return deps.leer(wellId); }).then(function (r) {
      return r && r.status === 'ok' && ufdui_vistaValida(r.data, wellId) ? r.data : null;
    }, function () { return null; });
  }

  function decidir(entrada) {
    if (enCurso) {
      return enCurso;
    }
    var e = entrada || {};
    var errorMotivo = ufdui_validarMotivo(e.accion, e.motivo);
    if (!UFDUI_ACCIONES[e.accion] || !e.decision || errorMotivo) {
      return Promise.resolve({ tipo: 'invalido', mensaje: errorMotivo || 'La acción no es válida.' });
    }
    var sinId = ufdui_construirPedido(e.wellId, e.decision, e.accion, e.motivo, e.versionVista, null);
    var pedido = ufdui_construirPedido(e.wellId, e.decision, e.accion, e.motivo, e.versionVista, idPara(sinId));

    enCurso = Promise.resolve()
      .then(function () { return deps.enviar(pedido); })
      .then(function (resp) {
        if (resp && resp.status === 'ok') {
          intento = null;                                           // decidido: la proxima decision es otro intento
          var data = resp.data && typeof resp.data === 'object' ? resp.data : null;
          return {
            tipo: 'ok', accion: e.accion, mensaje: UFDUI_ACCIONES[e.accion].exito, duplicada: !!(data && data.duplicada),
            decision: data ? data.decision || null : null, vista: data && ufdui_vistaValida(data, e.wellId) ? data : null
          };
        }
        var code = resp && resp.code;
        if (UFDUI_CODIGOS_DESACTUALIZADO.indexOf(code) !== -1) {
          intento = null;
          return releer(e.wellId).then(function (vista) {
            return { tipo: 'desactualizado', code: code, mensaje: ufdui_mensajeError(code), vista: vista };
          });
        }
        return {
          tipo: 'error', code: code, mensaje: ufdui_mensajeError(code), sesionVencida: UFDUI_CODIGOS_SESION.indexOf(code) !== -1
        };
      }, function () {
        return { tipo: 'red', mensaje: UFDUI_TEXTO_RED };
      })
      .then(function (r) { enCurso = null; return r; });
    return enCurso;
  }

  return { decidir: decidir, enCurso: function () { return enCurso !== null; } };
}

// --- Texto / HTML compartido por la tarjeta y el popup ---

// 14/10/2026 (hora de Argentina, UTC-3 todo el anio). '' si la fecha no es valida.
function ufdui_fechaCorta(iso) {
  var t = typeof iso === 'string' ? Date.parse(iso) : NaN;
  if (!isFinite(t)) {
    return '';
  }
  var d = new Date(t - 3 * 3600 * 1000);
  var dd = ('0' + d.getUTCDate()).slice(-2);
  var mm = ('0' + (d.getUTCMonth() + 1)).slice(-2);
  return dd + '/' + mm + '/' + d.getUTCFullYear();
}

// "Descartada por Ana Perez · 14/10/2026 · motivo". '' para una fuente sin revisar o sin ultima decision.
function ufdui_textoUltima(f) {
  var d = f && f.decision;
  if (!d || d.estado === UFDUI_ESTADOS.SIN_REVISAR || !d.ultima) {
    return '';
  }
  var u = d.ultima;
  var partes = [UFDUI_ETIQUETA_ESTADO[d.estado] + (u.nombre ? ' por ' + u.nombre : '')];
  var fecha = ufdui_fechaCorta(u.timestampUtc);
  if (fecha) {
    partes.push(fecha);
  }
  if (d.estado === UFDUI_ESTADOS.DESCARTADA && u.motivo) {
    partes.push(u.motivo);
  }
  return partes.join(' · ');
}

// Chip de estado. '' si la fuente no tiene decision (Validada en campo, coordenada invalida, decisiones no leidas).
function ufdui_htmlEstado(f) {
  if (!f || !f.decision) {
    return '';
  }
  var e = f.decision.estado;
  return '<span class="ufd-estado ufd-estado-' + e.toLowerCase().replace(/_/g, '-') + '">' + ufdui_escapar(UFDUI_ETIQUETA_ESTADO[e]) + '</span>';
}

function ufdui_htmlHistoria(f) {
  var t = ufdui_textoUltima(f);
  return t ? '<div class="ufd-historia">' + ufdui_escapar(t) + '</div>' : '';
}

// Botones de las acciones permitidas (los mismos en la tarjeta y en el popup). '' si no hay ninguna. data-ufd-fuente = id de la fuente en el modelo.
function ufdui_htmlAcciones(f, modelo, rol) {
  var acciones = ufdui_accionesDeFuente(f, modelo, rol);
  if (acciones.length === 0) {
    return '';
  }
  return '<div class="ufd-acciones" role="group" aria-label="Decisiones sobre esta fuente">' + acciones.map(function (a) {
    var principal = a === 'ACEPTAR' || a === 'RESTAURAR';
    return '<button type="button" class="button ' + (principal ? '' : 'button-secondary ') + 'ufd-btn ufd-btn-' + a.toLowerCase().replace(/_/g, '-') +
      '" data-ufd-accion="' + a + '" data-ufd-fuente="' + ufdui_escapar(f.id) + '">' + ufdui_escapar(UFDUI_ACCIONES[a].boton) + '</button>';
  }).join('') + '</div>';
}

// Avisos de la seccion: historial inconsistente, todas descartadas, "todavia no cambia los mapas" y el aviso del ultimo intento ({tipo:'ok'|'aviso'|'error', texto}).
function ufdui_htmlNotasSeccion(modelo, aviso) {
  var h = '';
  var d = modelo && modelo.decisiones;
  if (aviso && aviso.texto) {
    h += '<p class="ufd-aviso ufd-aviso-' + ufdui_escapar(aviso.tipo || 'aviso') + '" role="status">' + ufdui_escapar(aviso.texto) + '</p>';
  }
  if (d && d.integro === false) {
    h += '<p class="ucon-nota ucon-nota-aviso" role="status">' + ufdui_escapar(UFDUI_TEXTO_INCONSISTENTE) + '</p>';
  }
  if (d && d.todasDescartadas) {
    h += '<p class="ucon-nota ucon-nota-aviso" role="status">' + ufdui_escapar(UFDUI_TEXTO_TODAS_DESCARTADAS) + '</p>';
  }
  if (d && (d.todasDescartadas || d.cambiaPuntoRegistral)) {
    h += '<p class="ucon-nota" role="status">' + ufdui_escapar(UFDUI_TEXTO_SIN_EFECTO_MAPAS) + '</p>';
  }
  return h;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFDUI_ROL, UFDUI_ESTADOS, UFDUI_ETIQUETA_ESTADO, UFDUI_ACCIONES, UFDUI_MOTIVO_MAX, UFDUI_MENSAJES_ERROR, UFDUI_CODIGOS_DESACTUALIZADO,
    UFDUI_TEXTO_STALE, UFDUI_TEXTO_STALE_ACCION, UFDUI_TEXTO_RED, UFDUI_TEXTO_INCONSISTENTE, UFDUI_TEXTO_TODAS_DESCARTADAS, UFDUI_TEXTO_SIN_EFECTO_MAPAS,
    UFDUI_TEXTO_ACEPTAR_CON_CAMPO, UFDUI_TEXTO_DESCARTAR_ACEPTADA,
    ufdui_rol, ufdui_clave3, ufdui_vistaValida, ufdui_aplicarDecisiones, ufdui_accionesPara, ufdui_accionesDeFuente, ufdui_confirmacion, ufdui_validarMotivo,
    ufdui_nuevoClientRequestId, ufdui_construirPedido, ufdui_mensajeError, ufdui_crearFlujo, ufdui_fechaCorta, ufdui_textoUltima, ufdui_htmlEstado,
    ufdui_htmlHistoria, ufdui_htmlAcciones, ufdui_htmlNotasSeccion
  };
}
