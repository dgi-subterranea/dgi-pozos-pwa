// Decisiones sobre las fuentes registrales de ubicacion (Aceptar / Descartar / Quitar aceptacion / Restaurar): logica PURA de la interfaz, sin DOM, sin red.
// La usan las tarjetas de "Ubicaciones conocidas" Y el popup del visor "Ver todas en el mapa": un solo lugar decide que acciones corresponden, que texto lleva
// cada confirmacion, como se arma el pedido y como se traduce cada error. El dominio (maquina de estados, resolver) NO esta aca: vive en el backend
// (backend/src/UbicacionFuenteDecisionesLogic.js) y el frontend solo muestra lo que ese backend informa.
//
// Principios:
//   - NUNCA se borra ni se modifica la coordenada original de una fuente: la UI habla de Aceptar / Descartar / Restaurar / Quitar aceptacion, jamas de "eliminar".
//   - "Validada en campo" pertenece a UbicacionCorrecciones, no a estas decisiones: nunca lleva estado ni acciones.
//   - Fail-closed: sin decisiones leidas del backend (o con el historial del pozo inconsistente) no se ofrece ninguna accion.
//   - Quien no tiene ubicacion_validar NO ve acciones autoritativas: ve las SUGERENCIAS (Sugerir aceptar / descartar / restaurar y Cancelar la propia), que no cambian nada
//     hasta que un validador las aprueba. El validador NO ve botones «Sugerir»: decide directo (y revisa las sugerencias en su cola).
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
// Sugerencias (quien NO valida) y su revision (quien valida). Las claves SUGERIR_* se traducen a la accion del backend con UFDUI_ACCION_SUGERIDA.
var UFDUI_ACCION_SUGERIDA = { SUGERIR_ACEPTAR: 'ACEPTAR', SUGERIR_DESCARTAR: 'DESCARTAR', SUGERIR_RESTAURAR: 'RESTAURAR' };
var UFDUI_TEXTO_SIN_CAMBIOS = 'Un validador va a revisar tu sugerencia. Hasta entonces no cambia nada.';
UFDUI_ACCIONES.SUGERIR_ACEPTAR = {
  boton: 'Sugerir aceptar', titulo: '¿Sugerir aceptar esta fuente como referencia registral?', parrafos: [UFDUI_TEXTO_SIN_CAMBIOS], motivo: 'opcional', ok: 'Sí, enviar sugerencia',
  exito: 'Sugerencia enviada. Un validador la va a revisar.'
};
UFDUI_ACCIONES.SUGERIR_DESCARTAR = {
  boton: 'Sugerir descartar', titulo: '¿Sugerir descartar esta fuente?', parrafos: ['La coordenada original no se eliminará.', UFDUI_TEXTO_SIN_CAMBIOS], motivo: 'obligatorio',
  ok: 'Sí, enviar sugerencia', exito: 'Sugerencia enviada. Un validador la va a revisar.'
};
UFDUI_ACCIONES.SUGERIR_RESTAURAR = {
  boton: 'Sugerir restaurar', titulo: '¿Sugerir que esta fuente vuelva a participar del cálculo?', parrafos: [UFDUI_TEXTO_SIN_CAMBIOS], motivo: 'opcional', ok: 'Sí, enviar sugerencia',
  exito: 'Sugerencia enviada. Un validador la va a revisar.'
};
UFDUI_ACCIONES.CANCELAR_SUGERENCIA = {
  boton: 'Cancelar sugerencia', titulo: '¿Cancelar esta sugerencia?', parrafos: ['Esto no modifica el estado de la fuente.'], motivo: 'ninguno', ok: 'Sí, cancelar sugerencia',
  exito: 'Sugerencia cancelada.'
};
UFDUI_ACCIONES.APROBAR_SUGERENCIA = {
  boton: 'Aprobar', titulo: '¿Aprobar esta sugerencia?', parrafos: [], motivo: 'opcional', ok: 'Sí, aprobar', exito: 'Sugerencia aprobada.'
};
UFDUI_ACCIONES.RECHAZAR_SUGERENCIA = {
  boton: 'Rechazar', titulo: '¿Rechazar esta sugerencia?', parrafos: ['La fuente no cambia. La persona que sugirió va a ver el motivo.'], motivo: 'obligatorio', ok: 'Sí, rechazar',
  exito: 'Sugerencia rechazada.'
};
var UFDUI_TEXTO_ACEPTADA_CON_CAMPO = 'Esta fuente quedó aceptada como referencia registral. La ubicación operativa actual sigue siendo la validada en campo.';
var UFDUI_TEXTO_APROBADA_OBSOLETA = 'Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.';
var UFDUI_TEXTO_NO_APLICABLE = 'Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.';
var UFDUI_TEXTO_SUGERENCIA_RESUELTA = 'La sugerencia ya fue resuelta o dejó de estar disponible.';
var UFDUI_TEXTO_LIMITE_SUGERENCIAS = 'Ya tenés 10 sugerencias pendientes de revisión. Esperá a que las revisen o cancelá alguna.';
var UFDUI_ETIQUETA_SUGERENCIA = { PENDIENTE: 'Pendiente de revisión', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada', OBSOLETA: 'Ya no aplicable' };
var UFDUI_TEXTO_ACCION_SUGERIDA = { ACEPTAR: 'aceptar esta fuente', DESCARTAR: 'descartar esta fuente', RESTAURAR: 'restaurar esta fuente' };
var UFDUI_VERBO_SUGERIDO = { ACEPTAR: 'Aceptar', DESCARTAR: 'Descartar', RESTAURAR: 'Restaurar' };
var UFDUI_LIMITE_SUGERENCIAS_VISIBLES = 3;

var UFDUI_TEXTO_ACEPTAR_CON_CAMPO = 'Esta fuente quedará aceptada como referencia registral, pero la ubicación operativa seguirá siendo la validada en campo.';
var UFDUI_TEXTO_DESCARTAR_ACEPTADA = 'Esta fuente está aceptada: al descartarla también se quita su aceptación.';
var UFDUI_TEXTO_STALE = 'Esta información cambió mientras la estabas revisando.';
var UFDUI_TEXTO_STALE_ACCION = 'Esta información cambió mientras la estabas revisando. Revisá el estado actual y volvé a decidir si corresponde.';
var UFDUI_TEXTO_RED = 'No se pudo guardar la decisión. Revisá tu conexión e intentá de nuevo.';
var UFDUI_TEXTO_RED_SUGERENCIA = 'No se pudo enviar. Revisá tu conexión e intentá de nuevo.';
var UFDUI_TEXTO_INCONSISTENTE = 'El historial de decisiones de este pozo necesita una revisión técnica. Por ahora no se pueden tomar decisiones sobre sus fuentes.';
var UFDUI_TEXTO_TODAS_DESCARTADAS = 'Sin ubicación operativa de Irrigación. Todas las fuentes conocidas fueron descartadas.';

var UFDUI_MENSAJES_ERROR = {
  STALE_STATE: UFDUI_TEXTO_STALE_ACCION,
  ALREADY_IN_STATE: UFDUI_TEXTO_STALE_ACCION,
  INVALID_TRANSITION: UFDUI_TEXTO_STALE_ACCION,
  SOURCE_NOT_FOUND: 'Esa fuente ya no figura en el padrón. Se actualizó la información.',
  INCONSISTENT_STATE: UFDUI_TEXTO_INCONSISTENTE,
  PERMISSION_DENIED: 'No tenés permiso para tomar decisiones sobre las fuentes.',
  INVALID_MOTIVO: 'Indicá el motivo (hasta 300 caracteres).',
  WELL_NOT_FOUND: 'No se encontró el pozo.',
  SERVICE_UNAVAILABLE: 'No se pudo guardar la decisión. Intentá de nuevo en unos minutos.',
  PENDING_LIMIT_REACHED: 'Ya tenés 10 sugerencias pendientes de revisión. Esperá a que las revisen o cancelá alguna.',
  SUGGESTION_NOT_FOUND: 'La sugerencia ya fue resuelta o dejó de estar disponible.',
  ALREADY_RESOLVED: 'La sugerencia ya fue resuelta o dejó de estar disponible.'
};
// Estos errores significan "lo que viste ya no es lo vigente": hay que releer y NO reintentar solo.
var UFDUI_CODIGOS_DESACTUALIZADO = ['STALE_STATE', 'ALREADY_IN_STATE', 'INVALID_TRANSITION', 'SOURCE_NOT_FOUND'];
// Errores de una SUGERENCIA que significan "lo que viste ya cambio" (se refresca y no se reintenta solo). ALREADY_PENDING se trata aparte: la sugerencia ya existe.
var UFDUI_CODIGOS_SUGERENCIA_DESACTUALIZADA = UFDUI_CODIGOS_DESACTUALIZADO.concat(['SUGGESTION_NOT_FOUND', 'ALREADY_RESOLVED']);

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

// Quien NO valida: SIN_REVISAR -> Sugerir aceptar, Sugerir descartar | ACEPTADA -> Sugerir descartar | DESCARTADA -> Sugerir restaurar. NUNCA «quitar aceptacion».
function ufdui_accionesSugerirPara(estadoFuente) {
  if (estadoFuente === UFDUI_ESTADOS.SIN_REVISAR) {
    return ['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR'];
  }
  if (estadoFuente === UFDUI_ESTADOS.ACEPTADA) {
    return ['SUGERIR_DESCARTAR'];
  }
  if (estadoFuente === UFDUI_ESTADOS.DESCARTADA) {
    return ['SUGERIR_RESTAURAR'];
  }
  return [];
}

// Una sugerencia equivalente (misma accion) del propio usuario que sigue PENDIENTE y aplicable: no se vuelve a ofrecer la misma accion (se muestra "enviada").
function ufdui_hayPendienteEquivalente(f, accionSugerida) {
  var lista = f && f.sugerencias && Array.isArray(f.sugerencias.pendientes) ? f.sugerencias.pendientes : [];
  return lista.some(function (p) { return p.accionSugerida === accionSugerida && p.aplicable === true; });
}

// Las acciones de UNA fuente de un modelo ya vinculado. Validador: las decisiones directas ([] si no hay decision o el pozo no es integro). Quien no valida: las sugerencias que
// correspondan al estado actual (sin repetir una ya pendiente) y, si tiene una pendiente propia, CANCELAR_SUGERENCIA. "Validada en campo": nunca.
function ufdui_accionesDeFuente(f, modelo, rol) {
  if (!f || !modelo || f.tipo === 'CAMPO_VALIDADA') {
    return [];
  }
  var integro = !!f.decision && !!modelo.decisiones && modelo.decisiones.integro === true;
  if (rol === UFDUI_ROL.VALIDADOR) {
    return integro ? ufdui_accionesPara(f.decision.estado, rol) : [];
  }
  if (rol !== UFDUI_ROL.LECTOR) {
    return [];
  }
  var acciones = [];
  if (integro) {
    ufdui_accionesSugerirPara(f.decision.estado).forEach(function (a) {
      if (!ufdui_hayPendienteEquivalente(f, UFDUI_ACCION_SUGERIDA[a])) {
        acciones.push(a);
      }
    });
  }
  if (f.sugerencias && Array.isArray(f.sugerencias.pendientes) && f.sugerencias.pendientes.length > 0) {
    acciones.push('CANCELAR_SUGERENCIA');
  }
  return acciones;
}

// --- Sugerencias por fuente ---

function ufdui_sugerenciaValida(i) {
  return !!i && typeof i === 'object' && typeof i.sugerenciaId === 'string' && UFDUI_ETIQUETA_SUGERENCIA[i.estado] !== undefined && UFDUI_ACCION_SUGERIDA['SUGERIR_' + i.accionSugerida] !== undefined &&
    typeof i.fuenteTipo === 'string' && ufdui_clave3(i.fuenteTipo, i.x, i.y) !== null;
}

// lista: data.sugerencias de getSugerenciasFuentesPozo (las mas nuevas primero). A cada fuente registral de la ficha le agrega f.sugerencias = {pendientes: [...], ultima: item|null}
// (ultima = la resuelta mas reciente, solo si no hay pendientes). Una lista invalida o de otro pozo no se aplica. Devuelve el mismo modelo.
function ufdui_aplicarSugerencias(modelo, lista) {
  if (!modelo || !Array.isArray(modelo.fuentes)) {
    return modelo;
  }
  modelo.fuentes.forEach(function (f) { f.sugerencias = null; });
  if (!Array.isArray(lista)) {
    return modelo;
  }
  var validas = lista.filter(function (i) { return ufdui_sugerenciaValida(i) && i.wellId === modelo.wellId; });
  modelo.fuentes.forEach(function (f) {
    if (!UFDUI_TIPOS_REGISTRALES[f.tipo] || f.invalida) {
      return;
    }
    var clave = ufdui_clave3(f.tipo, f.x, f.y);
    var mias = validas.filter(function (i) { return ufdui_clave3(i.fuenteTipo, i.x, i.y) === clave; });
    var pendientes = mias.filter(function (i) { return i.estado === 'PENDIENTE'; });
    var resueltas = mias.filter(function (i) { return i.estado !== 'PENDIENTE'; });
    f.sugerencias = { pendientes: pendientes, ultima: pendientes.length === 0 && resueltas.length > 0 ? resueltas[0] : null };
  });
  return modelo;
}

// El texto "Sugeriste descartar esta fuente · 14/10/2026".
function ufdui_textoSugerencia(i, propia) {
  var accion = UFDUI_TEXTO_ACCION_SUGERIDA[i.accionSugerida] || 'revisar esta fuente';
  var partes = [(propia ? 'Sugeriste ' : 'Sugiere ') + accion];
  var fecha = ufdui_fechaCorta(i.timestampUtc);
  if (fecha) {
    partes.push(fecha);
  }
  return partes.join(' · ');
}

// Estado de UNA sugerencia propia, en palabras humanas (jamas codigos internos).
function ufdui_htmlSugerenciaPropia(i) {
  var esc = ufdui_escapar;
  var h = '<div class="ufd-sug" data-ufd-sugerencia-estado="' + esc(i.estado.toLowerCase()) + '">';
  if (i.estado === 'PENDIENTE' && i.aplicable === false) {
    h += '<span class="ufd-sug-chip ufd-sug-obsoleta">Ya no aplicable</span><div class="ufd-sug-detalle">' + esc(UFDUI_TEXTO_NO_APLICABLE) + '</div>';
  } else if (i.estado === 'PENDIENTE') {
    h += '<span class="ufd-sug-chip ufd-sug-pendiente">Sugerencia enviada · ' + esc(UFDUI_ETIQUETA_SUGERENCIA.PENDIENTE) + '</span><div class="ufd-sug-detalle">' + esc(ufdui_textoSugerencia(i, true)) + '</div>';
  } else if (i.estado === 'OBSOLETA') {
    h += '<span class="ufd-sug-chip ufd-sug-obsoleta">Sugerencia: ' + esc(UFDUI_ETIQUETA_SUGERENCIA.OBSOLETA) + '</span><div class="ufd-sug-detalle">' + esc(UFDUI_TEXTO_NO_APLICABLE) + '</div>';
  } else {
    h += '<span class="ufd-sug-chip ufd-sug-' + i.estado.toLowerCase() + '">Sugerencia ' + esc(UFDUI_ETIQUETA_SUGERENCIA[i.estado].toLowerCase()) + '</span>';
    var detalle = [ufdui_textoSugerencia(i, true)];
    var r = i.resolucion;
    if (r && r.nombre && i.estado !== 'CANCELADA') {
      detalle.push((i.estado === 'APROBADA' ? 'Aprobada por ' : 'Rechazada por ') + r.nombre);
    }
    h += '<div class="ufd-sug-detalle">' + esc(detalle.join(' · ')) + '</div>';
    if (i.estado === 'RECHAZADA' && r && r.motivo) {
      h += '<div class="ufd-sug-motivo">Motivo: ' + esc(r.motivo) + '</div>';
    }
  }
  return h + '</div>';
}

// Lo que ve cada rol debajo de la fuente: quien NO valida, el estado de SU sugerencia; el validador, un aviso de las pendientes (sin botones: las resuelve en su cola).
function ufdui_htmlSugerencias(f, modelo, rol) {
  if (!f || !f.sugerencias || f.tipo === 'CAMPO_VALIDADA') {
    return '';
  }
  var esc = ufdui_escapar;
  if (rol === UFDUI_ROL.VALIDADOR) {
    var aplicables = f.sugerencias.pendientes.filter(function (i) { return i.aplicable !== false; });
    if (aplicables.length === 0) {
      return '';
    }
    var visibles = aplicables.slice(0, UFDUI_LIMITE_SUGERENCIAS_VISIBLES);
    var h = '<div class="ufd-sug ufd-sug-revisar"><span class="ufd-sug-chip ufd-sug-pendiente">' + (aplicables.length === 1 ? '1 sugerencia pendiente de revisión' : aplicables.length + ' sugerencias pendientes de revisión') + '</span>';
    visibles.forEach(function (i) {
      h += '<div class="ufd-sug-detalle">' + esc((UFDUI_VERBO_SUGERIDO[i.accionSugerida] || 'Revisar') + (i.nombre ? ' · ' + i.nombre : '')) + '</div>';
    });
    if (aplicables.length > visibles.length) {
      h += '<div class="ufd-sug-detalle">y ' + (aplicables.length - visibles.length) + ' más</div>';
    }
    return h + '</div>';
  }
  if (rol !== UFDUI_ROL.LECTOR) {
    return '';
  }
  var propias = f.sugerencias.pendientes.length > 0 ? f.sugerencias.pendientes : (f.sugerencias.ultima ? [f.sugerencias.ultima] : []);
  return propias.map(ufdui_htmlSugerenciaPropia).join('');
}

// Cabecera sobre la cantidad total de aplicables (para el badge) no hace falta aca: la calcula el backend.

// --- Confirmaciones ---

// {accion, titulo, fuente, parrafos[], motivo:'obligatorio'|'opcional', ok}
function ufdui_confirmacion(accion, fuente, contexto) {
  var a = UFDUI_ACCIONES[accion];
  if (!a) {
    return null;
  }
  var c = contexto || {};
  var parrafos = a.parrafos.slice();
  if (accion === 'APROBAR_SUGERENCIA') {
    var nombreFuente = fuente && fuente.etiqueta ? fuente.etiqueta : 'la fuente';
    if (c.accionSugerida === 'ACEPTAR') {
      parrafos.push('Se aceptará la fuente «' + nombreFuente + '» como referencia registral.');
    } else if (c.accionSugerida === 'DESCARTAR') {
      parrafos.push('Se descartará la fuente «' + nombreFuente + '». La coordenada original no se eliminará.');
    } else if (c.accionSugerida === 'RESTAURAR') {
      parrafos.push('La fuente «' + nombreFuente + '» volverá a participar del cálculo automático. No quedará aceptada automáticamente.');
    }
  }
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
  var obligatorio = UFDUI_ACCIONES[accion] ? UFDUI_ACCIONES[accion].motivo === 'obligatorio' : accion === 'DESCARTAR';
  if (obligatorio && m === '') {
    return accion === 'RECHAZAR_SUGERENCIA' ? 'Indicá el motivo del rechazo.' : (accion === 'DESCARTAR' ? 'Indicá el motivo del descarte.' : 'Indicá el motivo.');
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

// --- Flujo de las operaciones de SUGERENCIAS: sugerir, cancelar, aprobar, rechazar ---
//
// deps: {sugerir(pedido), cancelar(pedido), resolver(pedido) -> Promise<respuesta del endpoint>, generarId() -> string}
// Cada metodo resuelve (nunca rechaza) con:
//   {tipo:'invalido', mensaje}
//   {tipo:'ok', accion, mensaje, sugerencia, resultado?, duplicada}      resultado: 'APROBADA' | 'RECHAZADA' | 'OBSOLETA' al resolver
//   {tipo:'ya_pendiente', mensaje, sugerencia}                           ALREADY_PENDING: la sugerencia ya existia; se muestra la existente
//   {tipo:'desactualizado', code, mensaje}                                 lo visto cambio (otro validador, reindexado...): REFRESCAR y NO reintentar solo
//   {tipo:'error', code, mensaje, sesionVencida}
//   {tipo:'red', mensaje}                                                  el id queda guardado: reintentar el MISMO contenido lo reutiliza (el backend lo deduplica)
// El clientRequestId se reutiliza mientras el contenido sea el mismo y no haya terminado bien; durante un envio, un segundo toque devuelve LA MISMA promesa.
function ufdui_crearFlujoSugerencias(deps) {
  var intentos = {};
  var enCurso = null;

  function idPara(tipo, sinId) {
    var firma = tipo + JSON.stringify(sinId);
    if (!intentos[tipo] || intentos[tipo].firma !== firma) {
      intentos[tipo] = { firma: firma, id: deps.generarId() };
    }
    return intentos[tipo].id;
  }

  function mensajeOk(accion, resultado, duplicada) {
    if (resultado === 'OBSOLETA') {
      return UFDUI_TEXTO_APROBADA_OBSOLETA;
    }
    return UFDUI_ACCIONES[accion].exito;
  }

  function ejecutar(tipo, accion, sinId, construir, enviar) {
    if (enCurso) {
      return enCurso;
    }
    var pedido = construir(idPara(tipo, sinId));
    enCurso = Promise.resolve()
      .then(function () { return enviar(pedido); })
      .then(function (resp) {
        if (resp && resp.status === 'ok') {
          intentos[tipo] = null;
          var d = resp.data && typeof resp.data === 'object' ? resp.data : {};
          return { tipo: 'ok', accion: accion, mensaje: mensajeOk(accion, d.resultado, d.duplicada), sugerencia: d.sugerencia || null, resultado: d.resultado || null, duplicada: d.duplicada === true, decision: d.decision || null, fuentes: d.fuentes || null, motivoNoAplicable: d.motivoNoAplicable || null };
        }
        var code = resp && resp.code;
        if (code === 'ALREADY_PENDING') {
          intentos[tipo] = null;
          return { tipo: 'ya_pendiente', mensaje: 'Ya enviaste esta sugerencia y está pendiente de revisión.', sugerencia: resp.sugerencia || null };
        }
        if (UFDUI_CODIGOS_SUGERENCIA_DESACTUALIZADA.indexOf(code) !== -1) {
          intentos[tipo] = null;
          return { tipo: 'desactualizado', code: code, mensaje: ufdui_mensajeError(code) };
        }
        return { tipo: 'error', code: code, mensaje: ufdui_mensajeError(code), sesionVencida: UFDUI_CODIGOS_SESION.indexOf(code) !== -1 };
      }, function () {
        return { tipo: 'red', mensaje: UFDUI_TEXTO_RED_SUGERENCIA };
      })
      .then(function (r) { enCurso = null; return r; });
    return enCurso;
  }

  function invalido(mensaje) {
    return Promise.resolve({ tipo: 'invalido', mensaje: mensaje });
  }

  // e: {wellId, decision (la fuente segun el backend: fuenteTipo, x, y), accion: 'SUGERIR_ACEPTAR'|..., motivo, versionVista}
  function sugerir(e) {
    var x = e || {};
    var accionSug = UFDUI_ACCION_SUGERIDA[x.accion];
    var errorMotivo = ufdui_validarMotivo(x.accion, x.motivo);
    if (!accionSug || !x.decision || errorMotivo) {
      return invalido(errorMotivo || 'La acción no es válida.');
    }
    var motivo = ufdui_limpiarMotivo(x.motivo);
    var sinId = { wellId: x.wellId, t: x.decision.fuenteTipo, x: x.decision.x, y: x.decision.y, a: accionSug, m: motivo, v: x.versionVista };
    return ejecutar('sugerir', x.accion, sinId, function (id) {
      return { wellId: x.wellId, fuenteTipo: x.decision.fuenteTipo, x: x.decision.x, y: x.decision.y, accionSugerida: accionSug, motivo: motivo, versionVista: x.versionVista, clientRequestId: id };
    }, function (pedido) { return deps.sugerir(pedido); });
  }

  // e: {sugerenciaId}
  function cancelar(e) {
    var x = e || {};
    if (typeof x.sugerenciaId !== 'string' || x.sugerenciaId === '') {
      return invalido('La sugerencia no es válida.');
    }
    return ejecutar('cancelar', 'CANCELAR_SUGERENCIA', { s: x.sugerenciaId }, function (id) {
      return { sugerenciaId: x.sugerenciaId, motivo: '', clientRequestId: id };
    }, function (pedido) { return deps.cancelar(pedido); });
  }

  // e: {sugerenciaId, resolucion: 'APROBAR'|'RECHAZAR', motivo, versionVista}
  function resolver(e) {
    var x = e || {};
    var accion = x.resolucion === 'APROBAR' ? 'APROBAR_SUGERENCIA' : (x.resolucion === 'RECHAZAR' ? 'RECHAZAR_SUGERENCIA' : null);
    var errorMotivo = accion ? ufdui_validarMotivo(accion, x.motivo) : null;
    if (!accion || typeof x.sugerenciaId !== 'string' || x.sugerenciaId === '' || errorMotivo) {
      return invalido(errorMotivo || 'La acción no es válida.');
    }
    var motivo = ufdui_limpiarMotivo(x.motivo);
    var aprobar = x.resolucion === 'APROBAR';
    return ejecutar('resolver', accion, { s: x.sugerenciaId, r: x.resolucion, m: motivo, v: aprobar ? x.versionVista : null }, function (id) {
      var p = { sugerenciaId: x.sugerenciaId, resolucion: x.resolucion, motivo: motivo, clientRequestId: id };
      if (aprobar) {
        p.versionVista = x.versionVista;
      }
      return p;
    }, function (pedido) { return deps.resolver(pedido); }).then(function (r) {
      if (r.tipo === 'ok' && r.resultado === 'RECHAZADA') {
        r.mensaje = UFDUI_ACCIONES.RECHAZAR_SUGERENCIA.exito;
      }
      return r;
    });
  }

  return { sugerir: sugerir, cancelar: cancelar, resolver: resolver, enCurso: function () { return enCurso !== null; } };
}

function ufdui_limpiarMotivo(m) {
  return typeof m === 'string' ? m.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
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
  var botones = [];
  acciones.forEach(function (a) {
    var principal = a === 'ACEPTAR' || a === 'RESTAURAR';
    var base = '<button type="button" class="button ' + (principal ? '' : 'button-secondary ') + 'ufd-btn ufd-btn-' + a.toLowerCase().replace(/_/g, '-') + '" data-ufd-accion="' + a + '" data-ufd-fuente="' + ufdui_escapar(f.id) + '"';
    if (a === 'CANCELAR_SUGERENCIA') {
      // una por sugerencia propia pendiente (casi siempre es una sola)
      f.sugerencias.pendientes.forEach(function (i) {
        botones.push(base + ' data-ufd-sugerencia="' + ufdui_escapar(i.sugerenciaId) + '">' + ufdui_escapar(UFDUI_ACCIONES[a].boton) + '</button>');
      });
    } else {
      botones.push(base + '>' + ufdui_escapar(UFDUI_ACCIONES[a].boton) + '</button>');
    }
  });
  return '<div class="ufd-acciones" role="group" aria-label="' + (rol === UFDUI_ROL.VALIDADOR ? 'Decisiones sobre esta fuente' : 'Sugerencias sobre esta fuente') + '">' + botones.join('') + '</div>';
}

// Avisos de la seccion: historial inconsistente, todas descartadas y el aviso del ultimo intento ({tipo:'ok'|'aviso'|'error', texto}).
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
  return h;
}

// --- Cuando un resultado cambia de verdad la resolucion (E3-6) ---

// Las acciones que son una DECISION AUTORITATIVA sobre una fuente. Una sugerencia, su cancelacion o su rechazo no cambian nada: solo aprobarla (el backend crea ahi la decision real).
var UFDUI_ACCIONES_AUTORITATIVAS = ['ACEPTAR', 'DESCARTAR', 'QUITAR_ACEPTACION', 'RESTAURAR'];

// r: lo que resuelve ufdui_crearFlujo().decidir o ufdui_crearFlujoSugerencias().{sugerir, cancelar, resolver}. true SOLO si el backend confirmo una decision autoritativa:
//   - decidir con exito (ACEPTAR / DESCARTAR / QUITAR_ACEPTACION / RESTAURAR), incluso si fue un reintento deduplicado (la decision existe igual);
//   - resolver una sugerencia con resultado APROBADA.
// Todo lo demas -sugerir, cancelar, rechazar, una sugerencia que quedo OBSOLETA, STALE_STATE, ya en ese estado, errores, red, un dialogo cancelado- es false: no hubo decision y el mapa no tiene
// por que volver a pedir nada.
function ufdui_cambiaResolucion(r) {
  if (!r || typeof r !== 'object' || r.tipo !== 'ok') {
    return false;
  }
  if (UFDUI_ACCIONES_AUTORITATIVAS.indexOf(r.accion) !== -1) {
    return true;
  }
  return r.accion === 'APROBAR_SUGERENCIA' && r.resultado === 'APROBADA';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UFDUI_ROL, UFDUI_ESTADOS, UFDUI_ETIQUETA_ESTADO, UFDUI_ACCIONES, UFDUI_MOTIVO_MAX, UFDUI_MENSAJES_ERROR, UFDUI_CODIGOS_DESACTUALIZADO,
    UFDUI_TEXTO_STALE, UFDUI_TEXTO_STALE_ACCION, UFDUI_TEXTO_RED, UFDUI_TEXTO_INCONSISTENTE, UFDUI_TEXTO_TODAS_DESCARTADAS,
    UFDUI_TEXTO_ACEPTAR_CON_CAMPO, UFDUI_TEXTO_DESCARTAR_ACEPTADA,
    ufdui_rol, ufdui_clave3, ufdui_vistaValida, ufdui_aplicarDecisiones, ufdui_accionesPara, ufdui_accionesDeFuente, ufdui_confirmacion, ufdui_validarMotivo,
    ufdui_nuevoClientRequestId, ufdui_construirPedido, ufdui_mensajeError, ufdui_crearFlujo, ufdui_fechaCorta, ufdui_textoUltima, ufdui_htmlEstado,
    ufdui_htmlHistoria, ufdui_htmlAcciones, ufdui_htmlNotasSeccion, UFDUI_ACCIONES_AUTORITATIVAS, ufdui_cambiaResolucion,
    UFDUI_ACCION_SUGERIDA, UFDUI_ETIQUETA_SUGERENCIA, UFDUI_TEXTO_ACEPTADA_CON_CAMPO, UFDUI_TEXTO_NO_APLICABLE, UFDUI_TEXTO_SUGERENCIA_RESUELTA, UFDUI_TEXTO_LIMITE_SUGERENCIAS,
    UFDUI_TEXTO_APROBADA_OBSOLETA, UFDUI_TEXTO_SIN_CAMBIOS, UFDUI_CODIGOS_SUGERENCIA_DESACTUALIZADA, UFDUI_TEXTO_ACCION_SUGERIDA, UFDUI_VERBO_SUGERIDO,
    ufdui_accionesSugerirPara, ufdui_hayPendienteEquivalente, ufdui_aplicarSugerencias, ufdui_textoSugerencia, ufdui_htmlSugerencias, ufdui_htmlSugerenciaPropia, ufdui_crearFlujoSugerencias,
    ufdui_limpiarMotivo
  };
}
