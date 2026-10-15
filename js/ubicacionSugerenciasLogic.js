// Cola de REVISION de sugerencias sobre las fuentes registrales (solo quien tiene ubicacion + ubicacion_validar): logica PURA, sin DOM ni red. Arma el indicador del hub
// «Sugerencias de ubicación: N», la lista de pendientes (mas antiguas primero) y los textos de cada tarjeta. El estado de cada sugerencia y la aprobacion / rechazo los decide el
// BACKEND (resolverSugerenciaFuente reutiliza el nucleo autoritativo de decidirFuenteUbicacion): aca solo se muestra lo que informa y se arma el pedido.
//
// Privacidad: se muestra el NOMBRE del proponente, nunca su email, ni ids de pedidos, ni secuencias, ni detalles tecnicos. Los enlaces a Google Maps llevan solo latitud y longitud.
//
// Dependencias (globales en el navegador, cargadas antes): ufdui_* (js/ubicacionFuenteDecisionesUiLogic.js), ubicacionesConocidasLogic_{escapar, urlGoogleMaps}.
var USUG_TEXTO_VACIO = 'No hay sugerencias pendientes.';
var USUG_TEXTO_NO_APLICABLE_COLA = 'Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.';
var USUG_TEXTO_ERROR_CARGA = 'No se pudo cargar la lista. Revisá tu conexión e intentá de nuevo.';
var USUG_TEXTO_APROBADA = 'Sugerencia aprobada.';
var USUG_TEXTO_RECHAZADA = 'Sugerencia rechazada.';

function usug_escapar(t) {
  return typeof ubicacionesConocidasLogic_escapar === 'function' ? ubicacionesConocidasLogic_escapar(t) :
    String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// «Sugerencias de ubicación: 3». '' (oculto) si no hay nada para revisar o el dato no es un entero >= 0.
function usug_textoBadge(total) {
  return typeof total === 'number' && isFinite(total) && total > 0 && Math.floor(total) === total ? 'Sugerencias de ubicación: ' + total : '';
}

function usug_itemValido(i) {
  return !!i && typeof i === 'object' && typeof i.sugerenciaId === 'string' && i.sugerenciaId !== '' && /^\d{2}-\d{4}$/.test(String(i.wellId)) &&
    typeof ufdui_clave3 === 'function' && ufdui_clave3(i.fuenteTipo, i.x, i.y) !== null && UFDUI_TEXTO_ACCION_SUGERIDA[i.accionSugerida] !== undefined;
}

// data de getSugerenciasFuentesPendientes -> {total, noAplicables, items} con los items validos: primero las APLICABLES (mas antiguas primero, como las entrega el backend) y despues
// las que ya no se pueden aplicar (no suman al indicador). null si la respuesta no es usable.
function usug_normalizarCola(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.pendientes)) {
    return null;
  }
  var validos = data.pendientes.filter(usug_itemValido);
  var aplicables = validos.filter(function (i) { return i.aplicable === true; });
  var otros = validos.filter(function (i) { return i.aplicable !== true; });
  return {
    total: typeof data.total === 'number' && isFinite(data.total) && data.total >= 0 ? data.total : aplicables.length,
    noAplicables: otros.length,
    items: aplicables.concat(otros)
  };
}

function usug_textoEstadoFuente(i) {
  return UFDUI_ETIQUETA_ESTADO[i.estadoFuente] || '';
}

function usug_accionesDeItem(i) {
  // Aprobar solo si se puede aplicar HOY (y hay version del pozo para revisar el conflicto). Rechazar (motivo obligatorio) siempre: asi se limpian las que ya no aplican.
  var acciones = [];
  if (i.aplicable === true && typeof i.versionVista === 'number') {
    acciones.push('APROBAR_SUGERENCIA');
  }
  acciones.push('RECHAZAR_SUGERENCIA');
  return acciones;
}

// Una tarjeta de la cola.
function usug_htmlItem(i, opciones) {
  var esc = usug_escapar;
  var o = opciones || {};
  var aplicable = i.aplicable === true;
  var h = '<li class="usug-item' + (aplicable ? '' : ' usug-no-aplicable') + '" data-usug-id="' + esc(i.sugerenciaId) + '">';
  h += '<div class="usug-cab"><span class="usug-pozo mono">' + esc(i.wellId) + '</span><span class="usug-fuente">' + esc(i.etiquetaFuente || '') + '</span>';
  var estadoFuente = usug_textoEstadoFuente(i);
  if (estadoFuente) {
    h += '<span class="ufd-estado ufd-estado-' + esc(String(i.estadoFuente).toLowerCase().replace(/_/g, '-')) + '">' + esc(estadoFuente) + '</span>';
  }
  h += '</div>';
  h += '<div class="usug-accion">Sugiere ' + esc(UFDUI_TEXTO_ACCION_SUGERIDA[i.accionSugerida]) + '</div>';
  var quien = [i.nombre ? 'Propuesta por ' + i.nombre : 'Propuesta'];
  var fecha = ufdui_fechaCorta(i.timestampUtc);
  if (fecha) {
    quien.push(fecha);
  }
  h += '<div class="usug-meta">' + esc(quien.join(' · ')) + '</div>';
  if (i.motivo) {
    h += '<div class="usug-motivo">Motivo: ' + esc(i.motivo) + '</div>';
  }
  if (typeof i.lat === 'number' && typeof i.lon === 'number') {
    h += '<div class="ucon-coord mono">' + esc(i.lat + ', ' + i.lon) + '</div>';
    var url = typeof ubicacionesConocidasLogic_urlGoogleMaps === 'function' ? ubicacionesConocidasLogic_urlGoogleMaps(i.lat, i.lon) : null;
    if (url) {
      h += '<a class="maps-btn ucon-maps" href="' + esc(url) + '" target="_blank" rel="noopener">' + (o.iconoMaps || '') + 'Abrir en Google Maps</a>';
    }
  }
  if (!aplicable) {
    h += '<p class="ufd-aviso ufd-aviso-aviso usug-aviso-no-aplicable" role="status">' + esc(USUG_TEXTO_NO_APLICABLE_COLA) + '</p>';
  }
  h += '<div class="ufd-acciones" role="group" aria-label="Revisar la sugerencia">';
  usug_accionesDeItem(i).forEach(function (a) {
    h += '<button type="button" class="button ' + (a === 'APROBAR_SUGERENCIA' ? '' : 'button-secondary ') + 'ufd-btn usug-btn" data-usug-accion="' + a + '" data-usug-id="' + esc(i.sugerenciaId) + '">' + esc(UFDUI_ACCIONES[a].boton) + '</button>';
  });
  if (o.puedeAbrirPozo) {
    h += '<button type="button" class="button button-secondary ufd-btn usug-btn" data-usug-pozo="' + esc(i.wellId) + '">Ver ficha del pozo</button>';
  }
  return h + '</div></li>';
}

function usug_htmlLista(cola, opciones) {
  if (!cola || cola.items.length === 0) {
    return '';
  }
  return cola.items.map(function (i) { return usug_htmlItem(i, opciones); }).join('');
}

// "3 sugerencias para revisar" / "1 sugerencia para revisar" (+ cuantas ya no se pueden aplicar).
function usug_textoResumen(cola) {
  if (!cola) {
    return '';
  }
  var t = cola.total === 0 ? '' : (cola.total === 1 ? '1 sugerencia para revisar' : cola.total + ' sugerencias para revisar');
  if (cola.noAplicables > 0) {
    t += (t ? ' · ' : '') + (cola.noAplicables === 1 ? '1 ya no aplicable' : cola.noAplicables + ' ya no aplicables');
  }
  return t;
}

// Mensaje de exito de una resolucion. Si se aprobo una ACEPTAR y habia una validada en campo vigente, el texto pedido: la fuente queda aceptada pero la ubicacion operativa sigue siendo la validada.
function usug_mensajeResolucion(r, accionSugerida, hayValidadaVigente) {
  if (!r || r.tipo !== 'ok') {
    return '';
  }
  if (r.resultado === 'OBSOLETA') {
    return UFDUI_TEXTO_APROBADA_OBSOLETA;
  }
  if (r.resultado === 'RECHAZADA') {
    return USUG_TEXTO_RECHAZADA;
  }
  if (accionSugerida === 'ACEPTAR' && hayValidadaVigente) {
    return UFDUI_TEXTO_ACEPTADA_CON_CAMPO;
  }
  return USUG_TEXTO_APROBADA;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    USUG_TEXTO_VACIO, USUG_TEXTO_NO_APLICABLE_COLA, USUG_TEXTO_ERROR_CARGA, USUG_TEXTO_APROBADA, USUG_TEXTO_RECHAZADA,
    usug_textoBadge, usug_itemValido, usug_normalizarCola, usug_accionesDeItem, usug_htmlItem, usug_htmlLista, usug_textoResumen, usug_mensajeResolucion
  };
}
