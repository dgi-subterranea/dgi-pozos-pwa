// Logica pura de "Observaciones del pozo" (E5-4, solo LECTURA): permisos, normalizacion fail-safe de la respuesta de getObservacionesPozo, modelo de vista de cada observacion
// (activa / anulada), mensajes de error y el cargador paginado (primera pagina + "ver anteriores"). Sin DOM ni red propios: la red entra por deps.consultar y el repintado por
// deps.onCambio, asi todo se prueba con Jest (js/observacionesPozoLogic.test.js). El controlador DOM es js/observacionesPozo.js.
//
// EL BACKEND ES LA AUTORIDAD: el frontend nunca decide que se puede ver. Lo que el backend manda se renderiza; lo que no manda (texto null de una anulada) no se reconstruye ni se
// pide de otra forma. Privacidad: el modelo de vista es una LISTA BLANCA (id, estado, texto, nombre, fecha, categoria, anulacion): cualquier otro campo del payload (email,
// clientRequestId, secuencia, lo que sea) se descarta aca y no llega nunca al DOM. Nada de esto toca Logger, console, URL ni storage.
//
// Fechas: misma politica que Reemplazo (reemplazoLogic_formatearFecha: hora de Mendoza, "dd/mm/aaaa hh:mm"); el timestamp UTC del backend queda intacto. Una fecha ausente o
// invalida no rompe nada: "Fecha no disponible".
// Dependencia de orden de carga: reemplazoLogic.js antes que este archivo (index.html y sw.test.js / el wiring test lo verifican).

var OBSERVACIONES_POZO_PAGINA = 50;
var OBSERVACIONES_POZO_NOMBRE_NEUTRO = 'Usuario';
var OBSERVACIONES_POZO_FECHA_NO_DISPONIBLE = 'Fecha no disponible';
var OBSERVACIONES_POZO_MENSAJE_GENERICO = 'No se pudieron cargar las observaciones. Intentá nuevamente.';

var OBSERVACIONES_POZO_MENSAJES = {
  PERMISSION_DENIED: 'No tenés acceso a las observaciones de este pozo.',
  SERVICE_UNAVAILABLE: OBSERVACIONES_POZO_MENSAJE_GENERICO,
  INVALID_LIMIT: OBSERVACIONES_POZO_MENSAJE_GENERICO,
  INVALID_CURSOR: OBSERVACIONES_POZO_MENSAJE_GENERICO,
  INVALID_WELL_ID: OBSERVACIONES_POZO_MENSAJE_GENERICO,
  RED: OBSERVACIONES_POZO_MENSAJE_GENERICO,
  UNAUTHORIZED: 'Tu sesión venció. Iniciá sesión de nuevo.',
  USER_DISABLED: 'Tu cuenta no tiene acceso habilitado. Contactá al administrador.'
};

// Solo el booleano exacto habilita (fail-closed): "SI", 1, "true" o cualquier otro valor "verdadero" NO cuentan; un permiso ausente (backend viejo) tampoco.
function observacionesPozoLogic_puedeVer(permisos) {
  return !!permisos && permisos.observaciones === true;
}

// El texto de un error SIEMPRE sale de esta tabla: el "message" tecnico del backend no se muestra nunca. Un codigo desconocido cae en el mensaje generico.
function observacionesPozoLogic_mensajeError(code) {
  return Object.prototype.hasOwnProperty.call(OBSERVACIONES_POZO_MENSAJES, code) ? OBSERVACIONES_POZO_MENSAJES[code] : OBSERVACIONES_POZO_MENSAJE_GENERICO;
}

// "dd/mm/aaaa hh:mm" (hora de Mendoza) o '' si no es un timestamp valido.
function observacionesPozoLogic_fecha(iso) {
  if (typeof iso !== 'string' || iso === '' || typeof reemplazoLogic_formatearFecha !== 'function') {
    return '';
  }
  var f = reemplazoLogic_formatearFecha(iso);
  return f === '—' ? '' : f;
}

// El backend ya entrega un nombre visible (o "Usuario"). Si faltara, o pareciera un email, se usa el neutro: el frontend jamas reconstruye ni muestra un email.
function observacionesPozoLogic_nombre(nombre) {
  if (typeof nombre !== 'string') {
    return OBSERVACIONES_POZO_NOMBRE_NEUTRO;
  }
  var n = nombre.trim();
  return n === '' || /\S+@\S+/.test(n) ? OBSERVACIONES_POZO_NOMBRE_NEUTRO : n;
}

function observacionesPozoLogic_textoOpcional(valor) {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : null;
}

// Una observacion del backend -> modelo de vista (lista blanca) o null si no se puede mostrar con seguridad (no es un objeto, sin observacionId, estado desconocido, una ACTIVA
// sin texto). El texto se conserva TAL CUAL (saltos de linea incluidos): es texto plano que el controlador pone con textContent.
//   ACTIVA : {id, estado:'ACTIVA', texto, nombre, fecha, categoria, anulacion:null}
//   ANULADA: {id, estado:'ANULADA', texto (string si el backend lo mando, null si no), nombre, fecha ('' si no hay), categoria,
//             anulacion:{nombre, fecha, motivo|null}}
function observacionesPozoLogic_vista(obs) {
  if (!obs || typeof obs !== 'object' || typeof obs.observacionId !== 'string' || obs.observacionId.trim() === '') {
    return null;
  }
  var id = obs.observacionId;
  var categoria = observacionesPozoLogic_textoOpcional(obs.categoria);
  var fecha = observacionesPozoLogic_fecha(obs.timestamp);
  if (obs.estado === 'ACTIVA') {
    var texto = observacionesPozoLogic_textoOpcional(obs.texto);
    if (texto === null) {
      return null;
    }
    return {
      id: id,
      estado: 'ACTIVA',
      texto: texto,
      nombre: observacionesPozoLogic_nombre(obs.nombre),
      fecha: fecha === '' ? OBSERVACIONES_POZO_FECHA_NO_DISPONIBLE : fecha,
      categoria: categoria,
      anulacion: null
    };
  }
  if (obs.estado === 'ANULADA') {
    var a = obs.anulacion && typeof obs.anulacion === 'object' ? obs.anulacion : {};
    var fechaAnulacion = observacionesPozoLogic_fecha(a.timestamp);
    return {
      id: id,
      estado: 'ANULADA',
      texto: observacionesPozoLogic_textoOpcional(obs.texto),        // string solo si el backend lo mando; null = no se intenta recuperar
      nombre: observacionesPozoLogic_nombre(obs.nombre),
      fecha: fecha,
      categoria: categoria,
      anulacion: {
        nombre: observacionesPozoLogic_nombre(a.nombre),
        fecha: fechaAnulacion === '' ? OBSERVACIONES_POZO_FECHA_NO_DISPONIBLE : fechaAnulacion,
        motivo: observacionesPozoLogic_textoOpcional(a.motivo)
      }
    };
  }
  return null;
}

function observacionesPozoLogic_esEnteroPositivo(n) {
  return typeof n === 'number' && isFinite(n) && Math.floor(n) === n && n >= 1;
}

// Respuesta cruda del backend -> {ok:true, wellId, items[], total, hayMas, cursor} | {ok:false, code}. Fail-safe: una respuesta que no tiene la forma esperada, o que es de OTRO pozo,
// es un error generico (SERVICE_UNAVAILABLE): jamas se muestra. Las observaciones no mostrables se descartan una a una; un hayMas sin cursor valido se baja a false (no se puede paginar).
function observacionesPozoLogic_leerRespuesta(resp, wellIdEsperado) {
  var falla = { ok: false, code: 'SERVICE_UNAVAILABLE' };
  if (!resp || typeof resp !== 'object') {
    return falla;
  }
  if (resp.status === 'error') {
    return { ok: false, code: typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE' };
  }
  var d = resp.data;
  if (resp.status !== 'ok' || !d || typeof d !== 'object' || !Array.isArray(d.observaciones)) {
    return falla;
  }
  if (wellIdEsperado !== undefined && d.wellId !== wellIdEsperado) {
    return falla;
  }
  var items = [];
  d.observaciones.forEach(function (o) {
    var v = observacionesPozoLogic_vista(o);
    if (v) {
      items.push(v);
    }
  });
  var hayMas = d.hayMas === true && observacionesPozoLogic_esEnteroPositivo(d.cursor);
  return {
    ok: true,
    wellId: d.wellId,
    items: items,
    total: observacionesPozoLogic_esEnteroPositivo(d.total) || d.total === 0 ? d.total : null,
    hayMas: hayMas,
    cursor: hayMas ? d.cursor : null
  };
}

// Suma una pagina al final SIN duplicar (por observacionId, contra lo ya mostrado y dentro de la propia pagina). Devuelve {items, agregadas}.
function observacionesPozoLogic_agregarPagina(actuales, pagina) {
  var vistos = {};
  var items = actuales.slice();
  items.forEach(function (i) { vistos[i.id] = true; });
  var agregadas = 0;
  pagina.forEach(function (i) {
    if (!vistos[i.id]) {
      vistos[i.id] = true;
      items.push(i);
      agregadas += 1;
    }
  });
  return { items: items, agregadas: agregadas };
}

function observacionesPozoLogic_estadoInicial() {
  return { fase: 'idle', wellId: null, items: [], total: 0, hayMas: false, cursor: null, cargandoMas: false, error: '', errorCode: '', errorMas: '' };
}

// Cargador paginado. deps:
//   obtenerContexto() -> {sessionToken, permisos}              (SIEMPRE fresco: la sesion y los permisos pueden cambiar)
//   consultar(sessionToken, wellId, limit, antesDeSecuencia) -> Promise<respuesta del backend>   (antesDeSecuencia: undefined en la primera pagina)
//   onCambio(estado)                                           (repintar)
//   onSesionExpirada()                                         (UNAUTHORIZED / USER_DISABLED)
// Fases: idle -> cargando -> listo | error. En 'listo' puede haber cargandoMas / errorMas (fallo de una pagina siguiente: la primera pagina sigue visible).
// Cada abrir()/cerrar() invalida las respuestas en vuelo (descarte de respuestas viejas). Sin permiso `observaciones === true` no se hace NINGUNA llamada.
function observacionesPozoLogic_crearCargador(deps) {
  var estado = observacionesPozoLogic_estadoInicial();
  var apertura = 0;
  var pendienteMas = null;

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(estado);
    }
  }

  function sesionVencida(code) {
    if ((code === 'UNAUTHORIZED' || code === 'USER_DISABLED') && deps.onSesionExpirada) {
      deps.onSesionExpirada();
    }
  }

  function consultar(wellId, antes) {
    var ctx = deps.obtenerContexto() || {};
    return new Promise(function (resolver) {
      resolver(deps.consultar(ctx.sessionToken, wellId, OBSERVACIONES_POZO_PAGINA, antes));
    });
  }

  function abrir(wellId) {
    apertura += 1;
    var mia = apertura;
    pendienteMas = null;
    estado = observacionesPozoLogic_estadoInicial();
    estado.wellId = wellId;
    var ctx = deps.obtenerContexto() || {};
    if (!observacionesPozoLogic_puedeVer(ctx.permisos) || typeof wellId !== 'string' || wellId === '') {
      estado.fase = 'error';
      estado.errorCode = 'PERMISSION_DENIED';
      estado.error = observacionesPozoLogic_mensajeError('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(estado);
    }
    estado.fase = 'cargando';
    cambio();
    return consultar(wellId, undefined).then(function (resp) {
      return observacionesPozoLogic_leerRespuesta(resp, wellId);
    }, function () {
      return { ok: false, code: 'RED' };
    }).then(function (lectura) {
      if (mia !== apertura) {
        return estado;
      }
      if (!lectura.ok) {
        estado.fase = 'error';
        estado.errorCode = lectura.code;
        estado.error = observacionesPozoLogic_mensajeError(lectura.code);
        cambio();
        sesionVencida(lectura.code);
        return estado;
      }
      var unicas = observacionesPozoLogic_agregarPagina([], lectura.items);
      estado.fase = 'listo';
      estado.items = unicas.items;
      estado.total = lectura.total === null ? unicas.items.length : lectura.total;
      estado.hayMas = lectura.hayMas;
      estado.cursor = lectura.cursor;
      cambio();
      return estado;
    });
  }

  // "Ver observaciones anteriores": pide la pagina siguiente con el cursor del backend y la SUMA al final. Un segundo toque mientras hay un pedido en vuelo no hace otro pedido.
  function cargarMas() {
    if (pendienteMas) {
      return pendienteMas;
    }
    if (estado.fase !== 'listo' || !estado.hayMas) {
      return Promise.resolve(estado);
    }
    var mia = apertura;
    var wellId = estado.wellId;
    var cursorPedido = estado.cursor;
    estado.cargandoMas = true;
    estado.errorMas = '';
    cambio();
    pendienteMas = consultar(wellId, cursorPedido).then(function (resp) {
      return observacionesPozoLogic_leerRespuesta(resp, wellId);
    }, function () {
      return { ok: false, code: 'RED' };
    }).then(function (lectura) {
      if (mia !== apertura) {
        return estado;
      }
      pendienteMas = null;
      estado.cargandoMas = false;
      if (!lectura.ok) {
        estado.errorMas = observacionesPozoLogic_mensajeError(lectura.code);
        cambio();
        sesionVencida(lectura.code);
        return estado;
      }
      var suma = observacionesPozoLogic_agregarPagina(estado.items, lectura.items);
      estado.items = suma.items;
      // un cursor que no retrocede (o una pagina sin nada nuevo con el mismo cursor) cortaria en un bucle infinito: se deja de ofrecer "anteriores"
      estado.hayMas = lectura.hayMas && lectura.cursor < cursorPedido;
      estado.cursor = estado.hayMas ? lectura.cursor : null;
      cambio();
      return estado;
    });
    return pendienteMas;
  }

  function reintentar() {
    return estado.fase === 'error' && estado.wellId ? abrir(estado.wellId) : Promise.resolve(estado);
  }

  // Salir de la pantalla / cerrar sesion: se descartan las respuestas en vuelo y se olvida todo (no hay cache: reabrir pide datos frescos).
  function cerrar() {
    apertura += 1;
    pendienteMas = null;
    estado = observacionesPozoLogic_estadoInicial();
  }

  return {
    abrir: abrir,
    cargarMas: cargarMas,
    reintentar: reintentar,
    cerrar: cerrar,
    estado: function () { return estado; }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    OBSERVACIONES_POZO_PAGINA,
    OBSERVACIONES_POZO_NOMBRE_NEUTRO,
    OBSERVACIONES_POZO_FECHA_NO_DISPONIBLE,
    OBSERVACIONES_POZO_MENSAJE_GENERICO,
    observacionesPozoLogic_puedeVer,
    observacionesPozoLogic_mensajeError,
    observacionesPozoLogic_fecha,
    observacionesPozoLogic_nombre,
    observacionesPozoLogic_vista,
    observacionesPozoLogic_leerRespuesta,
    observacionesPozoLogic_agregarPagina,
    observacionesPozoLogic_estadoInicial,
    observacionesPozoLogic_crearCargador
  };
}
