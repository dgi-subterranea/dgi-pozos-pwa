// Logica pura de "Observaciones del pozo" (E5-4 lectura, E5-5 alta, E5-6 anulacion): permisos, normalizacion fail-safe de la respuesta de getObservacionesPozo, modelo de vista de cada observacion
// (activa / anulada), mensajes de error, el cargador paginado (primera pagina + "ver anteriores") y el formulario de alta (texto normalizado, clientRequestId por intencion, reintento seguro). Sin DOM ni red propios: la red entra por deps.consultar y el repintado por
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
      anulacion: null,
      puedeAnular: obs.puedeAnular === true                          // senal del BACKEND (E5-6b), booleano exacto; ausente / null / "true" / 1 = false. El frontend NUNCA decide la autoria
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
      puedeAnular: false,                                            // una anulada no se anula de nuevo
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

  // Una observacion recien guardada (E5-5) entra ARRIBA de lo ya cargado, sin recargar: dedupe por observacionId (un reintento idempotente que ya esta en la lista no se duplica), suma al total y NO
  // toca el cursor (sigue apuntando a las observaciones anteriores, que no cambian). Solo si la lista sigue siendo la del pozo y esta lista. Devuelve si se inserto.
  function agregarNueva(vista, wellId) {
    if (estado.fase !== 'listo' || !vista || estado.wellId !== wellId) {
      return false;
    }
    for (var i = 0; i < estado.items.length; i++) {
      if (estado.items[i].id === vista.id) {
        return false;
      }
    }
    estado.items = [vista].concat(estado.items);
    estado.total += 1;
    cambio();
    return true;
  }

  // Una observacion recien ANULADA (E5-6) REEMPLAZA a su entrada, por observacionId y en el mismo lugar: es el modelo normalizado que devolvio el backend, tomado ENTERO (no se mezcla con
  // el viejo: si el nuevo trae texto null, el texto original que estaba cargado desaparece del estado; el backend es la autoridad de lo que se puede ver). No toca el cursor, el total
  // ni las demas paginas. Solo si la lista sigue siendo la del pozo y la entrada esta cargada. Devuelve si reemplazo.
  function reemplazarObservacion(vista, wellId) {
    if (estado.fase !== 'listo' || !vista || estado.wellId !== wellId) {
      return false;
    }
    var indice = -1;
    for (var i = 0; i < estado.items.length; i++) {
      if (estado.items[i].id === vista.id) {
        indice = i;
      }
    }
    if (indice < 0) {
      return false;
    }
    var nuevos = estado.items.slice();
    nuevos[indice] = vista;
    estado.items = nuevos;
    cambio();
    return true;
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
    agregarNueva: agregarNueva,
    reemplazarObservacion: reemplazarObservacion,
    estado: function () { return estado; }
  };
}

// =====================================================================================================================================================================
// ALTA (E5-5): agregar una observacion. Permiso, normalizacion del texto (la MISMA regla que el backend), clientRequestId por intencion, errores y la maquina de estados del formulario.
// =====================================================================================================================================================================

var OBSERVACIONES_POZO_TEXTO_MIN = 3;
var OBSERVACIONES_POZO_TEXTO_MAX = 1000;
var OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;
var OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO = 'No se pudo guardar la observación. Intentá nuevamente.';
var OBSERVACIONES_POZO_MENSAJE_TEXTO = 'La observación debe tener entre 3 y 1000 caracteres.';
var OBSERVACIONES_POZO_MENSAJE_EXITO = 'Observación agregada.';

var OBSERVACIONES_POZO_MENSAJES_ALTA = {
  INVALID_TEXTO: OBSERVACIONES_POZO_MENSAJE_TEXTO,
  INVALID_CATEGORIA: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,                   // el MVP no manda categoria: si apareciera es un fallo tecnico, no del usuario
  INVALID_CLIENT_REQUEST_ID: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
  INVALID_WELL_ID: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
  WELL_NOT_FOUND: 'No se pudo confirmar que este pozo exista en las fuentes disponibles.',
  SERVICE_UNAVAILABLE: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
  INCONSISTENT_STATE: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
  RED: OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
  IDEMPOTENCY_CONFLICT: 'La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.',
  PERMISSION_DENIED: 'No tenés permiso para agregar observaciones.',
  UNAUTHORIZED: OBSERVACIONES_POZO_MENSAJES.UNAUTHORIZED,
  USER_DISABLED: OBSERVACIONES_POZO_MENSAJES.USER_DISABLED
};

// El boton "Agregar observacion" exige AMBOS permisos con el booleano exacto (solo `observaciones`, solo `observaciones_agregar`, "SI", 1 o cualquier truthy NO alcanzan). El backend vuelve a validarlo.
function observacionesPozoLogic_puedeAgregar(permisos) {
  return observacionesPozoLogic_puedeVer(permisos) && permisos.observaciones_agregar === true;
}

// Mensaje de error del alta: siempre de la tabla (nunca el message tecnico), generico si el codigo no se conoce.
function observacionesPozoLogic_mensajeErrorAlta(code) {
  return Object.prototype.hasOwnProperty.call(OBSERVACIONES_POZO_MENSAJES_ALTA, code) ? OBSERVACIONES_POZO_MENSAJES_ALTA[code] : OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO;
}

// Quita los surrogates sueltos (UTF-16 invalido) y conserva los pares validos. Es lo que hace el backend con una regex con lookbehind; aca se hace con un bucle porque un lookbehind es un
// error de SINTAXIS en navegadores viejos (Safari < 16.4) y romperia todo el script.
function observacionesPozoLogic_sinSurrogatesSueltos(s) {
  var salida = '';
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    if (c >= 0xD800 && c <= 0xDBFF) {
      var n = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (n >= 0xDC00 && n <= 0xDFFF) {
        salida += s.charAt(i) + s.charAt(i + 1);
        i += 1;
      }
    } else if (c < 0xDC00 || c > 0xDFFF) {
      salida += s.charAt(i);
    }
  }
  return salida;
}

// NORMALIZACION del texto: la MISMA regla que el backend (observacionesPozoService_normalizarTexto, que sigue siendo la autoridad y vuelve a normalizar): saltos de linea (CRLF, CR, NEL, LS, PS)
// -> "\n"; tabulador -> un espacio; se eliminan los controles incompatibles con texto plano (C0 salvo "\n", DEL, C1, U+202A-202E, U+2066-2069, U+FEFF) y los surrogates sueltos; trim de los
// extremos. NO se colapsan espacios internos ni lineas en blanco. Hay un test de PARIDAD con el backend. Devuelve '' si no es un string.
function observacionesPozoLogic_normalizarTexto(texto) {
  if (typeof texto !== 'string') {
    return '';
  }
  return observacionesPozoLogic_sinSurrogatesSueltos(texto
    .replace(/\r\n|\r|\u0085|\u2028|\u2029/g, '\n')
    .replace(/\t/g, ' ')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u0084\u0086-\u009F\u202A-\u202E\u2066-\u2069\uFEFF]/g, '')).trim();
}

// Largo en CARACTERES UNICOS (code points: un emoji cuenta 1; .length contaria 2), igual que el backend.
function observacionesPozoLogic_largoTexto(textoNormalizado) {
  return Array.from(textoNormalizado).length;
}

// {texto (normalizado, es lo que se envia), largo, valido, motivo: null | 'VACIO' | 'CORTO' | 'LARGO'}
function observacionesPozoLogic_validarTexto(crudo) {
  return observacionesPozoLogic_validarContenido(crudo, OBSERVACIONES_POZO_TEXTO_MIN, OBSERVACIONES_POZO_TEXTO_MAX);
}

// Misma validacion para el texto de una alta (3..1000) y el motivo de una anulacion (3..300): se normaliza como el backend y se mide en code points.
function observacionesPozoLogic_validarContenido(crudo, minimo, maximo) {
  var texto = observacionesPozoLogic_normalizarTexto(crudo);
  var largo = observacionesPozoLogic_largoTexto(texto);
  var motivo = null;
  if (largo === 0) {
    motivo = 'VACIO';
  } else if (largo < minimo) {
    motivo = 'CORTO';
  } else if (largo > maximo) {
    motivo = 'LARGO';
  }
  return { texto: texto, largo: largo, valido: motivo === null, motivo: motivo };
}

// "n / 1000" y, si se pasa, tambien con palabras (no se depende solo del color).
function observacionesPozoLogic_textoContador(largo, maximo) {
  var max = maximo === undefined ? OBSERVACIONES_POZO_TEXTO_MAX : maximo;
  var base = largo + ' / ' + max;
  return largo > max ? base + ' · te pasaste por ' + (largo - max) : base;
}

// 8 a 64 caracteres [A-Za-z0-9_-] (lo que exige el backend). `aleatorio`: funcion opcional para tests. Mismo criterio que el resto de los modulos (ucorr-, ufd-).
function observacionesPozoLogic_nuevoClientRequestId(aleatorio, prefijo) {
  var pre = prefijo || 'obs';                               // el alta usa "obs", la anulacion "anu": el espacio de ids es compartido en el backend, pero asi nunca se parecen
  if (!aleatorio && typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    var id = pre + '-' + crypto.randomUUID();
    if (OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX.test(id)) {
      return id;
    }
  }
  var azar = aleatorio || Math.random;
  var s = '';
  while (s.length < 24) {
    s += Math.floor(azar() * 36).toString(36);
  }
  return pre + '-' + Date.now().toString(36) + '-' + s;
}

// Respuesta de agregarObservacionPozo -> {ok:true, duplicada, vista} | {ok:false, code}. `duplicada` true y false son AMBOS exito. Fail-safe: una respuesta sin la forma esperada, de otro pozo
// o cuya observacion no es una ACTIVA mostrable NO se aplica a la lista (la escritura pudo ocurrir: el reintento con el mismo id es idempotente y la devuelve).
function observacionesPozoLogic_leerRespuestaAlta(resp, wellIdEsperado) {
  var falla = { ok: false, code: 'SERVICE_UNAVAILABLE' };
  if (!resp || typeof resp !== 'object') {
    return falla;
  }
  if (resp.status === 'error') {
    return { ok: false, code: typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE' };
  }
  var d = resp.data;
  if (resp.status !== 'ok' || !d || typeof d !== 'object' || d.wellId !== wellIdEsperado) {
    return falla;
  }
  var vista = observacionesPozoLogic_vista(d.observacion);
  if (!vista || vista.estado !== 'ACTIVA') {
    return falla;
  }
  return { ok: true, duplicada: d.duplicada === true, vista: vista };
}

// Siguiente indice al tabular dentro del modal (rotacion): sin foco conocido (-1) arranca en el primero (o el ultimo hacia atras).
function observacionesPozoLogic_siguienteFoco(cantidad, actual, atras) {
  if (cantidad <= 0) {
    return -1;
  }
  if (actual < 0 || actual >= cantidad) {
    return atras ? cantidad - 1 : 0;
  }
  return atras ? (actual - 1 + cantidad) % cantidad : (actual + 1) % cantidad;
}

// Formulario de alta. deps:
//   obtenerContexto() -> {sessionToken, permisos}                  (SIEMPRE fresco)
//   enviar(sessionToken, wellId, texto, clientRequestId) -> Promise<respuesta del backend>   (texto = el normalizado)
//   generarId() -> clientRequestId                                  (por defecto observacionesPozoLogic_nuevoClientRequestId)
//   onCambio(estado)                                                (repintar)
//   onExito(vista, duplicada, wellId)                               (solo si la respuesta sigue siendo del contexto vigente: aplica la observacion a la lista)
//   onSesionExpirada()                                              (UNAUTHORIZED / USER_DISABLED)
//
// clientRequestId = UNA INTENCION de alta (un texto normalizado que se quiere guardar una vez):
//   - abrir el formulario => id nuevo; cancelar y reabrir => id nuevo; despues de un exito, la proxima alta => id nuevo;
//   - editar antes del primer envio, o reintentar el MISMO texto (red caida, error del servidor, definitivo o incierto) => el MISMO id (el backend deduplica: si la primera vez llego a escribir, el
//     reintento devuelve esa misma observacion con duplicada:true);
//   - si ya hubo un intento y el texto normalizado CAMBIO => id nuevo antes de enviar (ya es otra intencion; reusar el id daria IDEMPOTENCY_CONFLICT);
//   - tras IDEMPOTENCY_CONFLICT (el id ya pertenece a otro contenido) o INVALID_CLIENT_REQUEST_ID (rechazado antes de escribir) el id queda "quemado": el SIGUIENTE envio, por accion del usuario,
//     usa uno nuevo (nunca se reenvia solo ni en bucle).
// Descarte de respuestas viejas: cada abrir / cancelar / cerrar invalida lo que este en vuelo; si la escritura llego a hacerse en el backend, la UI simplemente no la aplica a un contexto que ya no es ese.
function observacionesPozoLogic_crearFormulario(deps) {
  var s = observacionesPozoLogic_formularioInicial();
  var sesion = 0;

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(snapshot());
    }
  }

  function snapshot() {
    var v = observacionesPozoLogic_validarTexto(s.texto);
    return {
      abierto: s.abierto,
      wellId: s.wellId,
      texto: s.texto,
      largo: v.largo,
      contador: observacionesPozoLogic_textoContador(v.largo),
      excede: v.motivo === 'LARGO',
      valido: v.valido,
      enviando: s.enviando,
      puedeGuardar: s.abierto && !s.enviando && v.valido,
      error: s.error,
      clientRequestId: s.id
    };
  }

  function generar() {
    return (deps.generarId || observacionesPozoLogic_nuevoClientRequestId)();
  }

  function abrir(wellId) {
    sesion += 1;
    var ctx = deps.obtenerContexto() || {};
    s = observacionesPozoLogic_formularioInicial();
    if (!observacionesPozoLogic_puedeAgregar(ctx.permisos) || typeof wellId !== 'string' || wellId === '') {
      cambio();
      return false;
    }
    s.abierto = true;
    s.wellId = wellId;
    s.id = generar();
    cambio();
    return true;
  }

  function setTexto(texto) {
    if (!s.abierto) {
      return;
    }
    s.texto = typeof texto === 'string' ? texto : '';
    s.error = null;                                         // lo editado reemplaza al aviso anterior; la decision del id se toma recien al enviar
    cambio();
  }

  function falla(code) {
    s.error = { code: code, mensaje: observacionesPozoLogic_mensajeErrorAlta(code), campo: code === 'INVALID_TEXTO' ? 'texto' : null };
  }

  function guardar() {
    if (!s.abierto || s.enviando) {
      return Promise.resolve(snapshot());              // doble submit: no hay otro pedido
    }
    var ctx = deps.obtenerContexto() || {};
    if (!observacionesPozoLogic_puedeAgregar(ctx.permisos)) {
      falla('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(snapshot());
    }
    var v = observacionesPozoLogic_validarTexto(s.texto);
    if (!v.valido) {
      falla('INVALID_TEXTO');
      cambio();
      return Promise.resolve(snapshot());
    }
    if (s.ultimoIntento !== null && (s.ultimoIntento !== v.texto || s.idQuemado)) {
      s.id = generar();                                 // otra intencion: texto distinto, o un id que el backend ya asocio a otro contenido
      s.idQuemado = false;
    }
    s.ultimoIntento = v.texto;
    s.enviando = true;
    s.error = null;
    var mia = sesion;
    var wellId = s.wellId;
    var id = s.id;
    cambio();
    return new Promise(function (resolver) {
      resolver(deps.enviar(ctx.sessionToken, wellId, v.texto, id));
    }).then(function (resp) {
      return observacionesPozoLogic_leerRespuestaAlta(resp, wellId);
    }, function () {
      return { ok: false, code: 'RED' };
    }).then(function (lectura) {
      if (mia !== sesion) {
        return snapshot();                              // contexto viejo (salio de la pantalla / cerro sesion / otro pozo): no se aplica nada
      }
      s.enviando = false;
      if (lectura.ok) {
        s = observacionesPozoLogic_formularioInicial();   // exito: el formulario se cierra y se descarta todo (la proxima alta es otra intencion)
        sesion += 1;
        if (deps.onExito) {
          deps.onExito(lectura.vista, lectura.duplicada, wellId);
        }
        cambio();
        return snapshot();
      }
      falla(lectura.code);
      if (lectura.code === 'IDEMPOTENCY_CONFLICT' || lectura.code === 'INVALID_CLIENT_REQUEST_ID') {
        s.idQuemado = true;
      }
      cambio();
      if ((lectura.code === 'UNAUTHORIZED' || lectura.code === 'USER_DISABLED') && deps.onSesionExpirada) {
        deps.onSesionExpirada();
      }
      return snapshot();
    });
  }

  // Cancelar (boton / Escape): mientras se guarda no se puede (la respuesta todavia tiene que aplicarse o descartarse con criterio).
  function cancelar() {
    if (s.enviando) {
      return false;
    }
    cerrar();
    cambio();
    return true;
  }

  // Salir de la pantalla / cerrar sesion / abrir otro pozo: se descarta todo, incluida cualquier respuesta en vuelo.
  function cerrar() {
    sesion += 1;
    s = observacionesPozoLogic_formularioInicial();
  }

  return { abrir: abrir, setTexto: setTexto, guardar: guardar, cancelar: cancelar, cerrar: cerrar, estado: snapshot };
}

function observacionesPozoLogic_formularioInicial() {
  return { abierto: false, wellId: null, texto: '', id: null, ultimoIntento: null, idQuemado: false, enviando: false, error: null };
}

// =====================================================================================================================================================================
// ANULACION (E5-6): anular una observacion ACTIVA con un motivo. Quien ve el boton, motivo, clientRequestId por intencion, errores y la maquina de estados del modal.
// =====================================================================================================================================================================

var OBSERVACIONES_POZO_MOTIVO_MIN = 3;
var OBSERVACIONES_POZO_MOTIVO_MAX = 300;
var OBSERVACIONES_POZO_MENSAJE_ANULADA = 'Observación anulada.';
var OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO = 'No se pudo anular la observación. Intentá nuevamente.';

var OBSERVACIONES_POZO_MENSAJES_ANULAR = {
  INVALID_MOTIVO: 'El motivo debe tener entre 3 y 300 caracteres.',
  INVALID_TRANSITION: 'Esta observación ya no puede anularse.',
  OBSERVACION_NOT_FOUND: 'La observación ya no está disponible.',
  PERMISSION_DENIED: 'No tenés permiso para anular esta observación.',
  IDEMPOTENCY_CONFLICT: 'La anulación cambió después de un intento anterior. Revisá el motivo e intentá nuevamente.',
  INVALID_OBSERVACION_ID: OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
  INVALID_CLIENT_REQUEST_ID: OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
  INCONSISTENT_STATE: OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
  SERVICE_UNAVAILABLE: OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
  RED: OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
  UNAUTHORIZED: OBSERVACIONES_POZO_MENSAJES.UNAUTHORIZED,
  USER_DISABLED: OBSERVACIONES_POZO_MENSAJES.USER_DISABLED
};

// ¿Se ofrece "Anular" sobre esta observacion? SOLO con la senal del BACKEND: `vista.puedeAnular === true` (el backend la calcula por observacion con la sesion y los permisos de HOY: moderador, o autor
// de esa observacion), y solo en una ACTIVA (una anulada o un estado desconocido nunca, aunque un payload corrupto trajera true). `observaciones === true` sigue siendo la guarda global de la
// pantalla. El frontend NO conoce el email de nadie, NO combina los permisos observaciones_agregar / observaciones_anular y NO usa el nombre: jamas infiere la autoria. Una observacion sin la senal
// (payload viejo, null, "true", 1...) no tiene boton. El backend vuelve a autorizar al anular de todos modos.
function observacionesPozoLogic_puedeAnular(permisos, vista) {
  return observacionesPozoLogic_puedeVer(permisos) && !!vista && vista.estado === 'ACTIVA' && vista.puedeAnular === true;
}

function observacionesPozoLogic_validarMotivo(crudo) {
  return observacionesPozoLogic_validarContenido(crudo, OBSERVACIONES_POZO_MOTIVO_MIN, OBSERVACIONES_POZO_MOTIVO_MAX);
}

function observacionesPozoLogic_mensajeErrorAnular(code) {
  return Object.prototype.hasOwnProperty.call(OBSERVACIONES_POZO_MENSAJES_ANULAR, code) ? OBSERVACIONES_POZO_MENSAJES_ANULAR[code] : OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO;
}

// Respuesta de anularObservacionPozo -> {ok:true, duplicada, vista} | {ok:false, code}. `duplicada` true y false son AMBOS exito. La vista sale de la lista blanca (el modelo ENTERO
// normalizado que devolvio el backend) y tiene que ser una ANULADA de ESTA observacion y de ESTE pozo; si no, no se aplica (la anulacion pudo ocurrir: el reintento es idempotente).
function observacionesPozoLogic_leerRespuestaAnulacion(resp, wellIdEsperado, observacionIdEsperado) {
  var falla = { ok: false, code: 'SERVICE_UNAVAILABLE' };
  if (!resp || typeof resp !== 'object') {
    return falla;
  }
  if (resp.status === 'error') {
    return { ok: false, code: typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE' };
  }
  var d = resp.data;
  if (resp.status !== 'ok' || !d || typeof d !== 'object' || d.wellId !== wellIdEsperado) {
    return falla;
  }
  var vista = observacionesPozoLogic_vista(d.observacion);
  if (!vista || vista.estado !== 'ANULADA' || vista.id !== observacionIdEsperado) {
    return falla;
  }
  return { ok: true, duplicada: d.duplicada === true, vista: vista };
}

function observacionesPozoLogic_anulacionInicial() {
  return { abierto: false, wellId: null, objetivo: null, motivo: '', id: null, ultimoIntento: null, idQuemado: false, enviando: false, error: null };
}

// Modal de anulacion. deps:
//   obtenerContexto() -> {sessionToken, permisos}                              (SIEMPRE fresco)
//   enviar(sessionToken, observacionId, motivo, clientRequestId) -> Promise<respuesta del backend>   (motivo = el normalizado; NO viaja el pozo, el autor ni el texto)
//   generarId() -> clientRequestId                                              (por defecto observacionesPozoLogic_nuevoClientRequestId con prefijo "anu")
//   onCambio(estado)                                                            (repintar)
//   onExito(vista, duplicada, observacionId, wellId)                           (solo si la respuesta sigue siendo del contexto vigente: reemplaza la observacion en la lista)
//   onTransicionInvalida(wellId)                                                (la observacion ya no se puede anular: se cierra el modal y la pantalla refresca)
//   onSesionExpirada()                                                          (UNAUTHORIZED / USER_DISABLED)
//
// clientRequestId = UNA intencion de anulacion (esta observacion + este motivo normalizado), con las mismas reglas que el alta (E5-5):
//   abrir el modal => id nuevo (tambien al abrirlo para OTRA observacion), cancelar y reabrir => id nuevo, tras un exito => id nuevo en la proxima;
//   editar el motivo antes del primer envio, o reintentar el MISMO motivo (red caida, error del servidor) => el MISMO id (el backend deduplica: duplicada:true);
//   ya hubo un intento y el motivo normalizado cambio => id nuevo antes de enviar;
//   tras IDEMPOTENCY_CONFLICT o INVALID_CLIENT_REQUEST_ID => el id queda "quemado": el SIGUIENTE envio del usuario usa uno nuevo (nunca se reenvia solo).
// PRIVACIDAD: el estado del modal guarda solo {id, nombre, fecha, puedeAnular} de la observacion (NUNCA su texto).
// Descarte de respuestas viejas: cada abrir / cancelar / cerrar invalida lo que este en vuelo (otra observacion, otro pozo, salir de la pantalla, cerrar sesion).
function observacionesPozoLogic_crearAnulacion(deps) {
  var s = observacionesPozoLogic_anulacionInicial();
  var sesion = 0;

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(snapshot());
    }
  }

  function snapshot() {
    var v = observacionesPozoLogic_validarMotivo(s.motivo);
    return {
      abierto: s.abierto,
      wellId: s.wellId,
      objetivo: s.objetivo,
      motivo: s.motivo,
      largo: v.largo,
      contador: observacionesPozoLogic_textoContador(v.largo, OBSERVACIONES_POZO_MOTIVO_MAX),
      excede: v.motivo === 'LARGO',
      valido: v.valido,
      enviando: s.enviando,
      puedeGuardar: s.abierto && !s.enviando && v.valido,
      error: s.error,
      clientRequestId: s.id
    };
  }

  function generar() {
    return deps.generarId ? deps.generarId() : observacionesPozoLogic_nuevoClientRequestId(undefined, 'anu');
  }

  function falla(code) {
    s.error = { code: code, mensaje: observacionesPozoLogic_mensajeErrorAnular(code), campo: code === 'INVALID_MOTIVO' ? 'motivo' : null };
  }

  function cerrar() {
    sesion += 1;
    s = observacionesPozoLogic_anulacionInicial();
  }

  // vista: la observacion (de la lista) que se quiere anular.
  function abrir(wellId, vista) {
    sesion += 1;
    var ctx = deps.obtenerContexto() || {};
    s = observacionesPozoLogic_anulacionInicial();
    if (!observacionesPozoLogic_puedeAnular(ctx.permisos, vista) || typeof wellId !== 'string' || wellId === '') {
      cambio();
      return false;
    }
    s.abierto = true;
    s.wellId = wellId;
    s.objetivo = { id: vista.id, nombre: vista.nombre, fecha: vista.fecha, puedeAnular: vista.puedeAnular === true };       // sin texto
    s.id = generar();
    cambio();
    return true;
  }

  function setMotivo(motivo) {
    if (!s.abierto) {
      return;
    }
    s.motivo = typeof motivo === 'string' ? motivo : '';
    s.error = null;
    cambio();
  }

  function guardar() {
    if (!s.abierto || s.enviando) {
      return Promise.resolve(snapshot());               // doble submit: no hay otro pedido
    }
    var ctx = deps.obtenerContexto() || {};
    if (!observacionesPozoLogic_puedeAnular(ctx.permisos, { estado: 'ACTIVA', puedeAnular: s.objetivo.puedeAnular })) {
      falla('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(snapshot());
    }
    var v = observacionesPozoLogic_validarMotivo(s.motivo);
    if (!v.valido) {
      falla('INVALID_MOTIVO');
      cambio();
      return Promise.resolve(snapshot());
    }
    if (s.ultimoIntento !== null && (s.ultimoIntento !== v.texto || s.idQuemado)) {
      s.id = generar();                                 // otra intencion: motivo distinto, o un id que el backend ya asocio a otro contenido
      s.idQuemado = false;
    }
    s.ultimoIntento = v.texto;
    s.enviando = true;
    s.error = null;
    var mia = sesion;
    var wellId = s.wellId;
    var observacionId = s.objetivo.id;
    var id = s.id;
    cambio();
    return new Promise(function (resolver) {
      resolver(deps.enviar(ctx.sessionToken, observacionId, v.texto, id));
    }).then(function (resp) {
      return observacionesPozoLogic_leerRespuestaAnulacion(resp, wellId, observacionId);
    }, function () {
      return { ok: false, code: 'RED' };
    }).then(function (lectura) {
      if (mia !== sesion) {
        return snapshot();                              // contexto viejo: no se aplica nada
      }
      s.enviando = false;
      if (lectura.ok) {
        cerrar();                                       // exito: se descarta todo (la proxima anulacion es otra intencion)
        if (deps.onExito) {
          deps.onExito(lectura.vista, lectura.duplicada, observacionId, wellId);
        }
        cambio();
        return snapshot();
      }
      if (lectura.code === 'INVALID_TRANSITION') {      // ya no se puede anular (otro la anulo): se cierra y la pantalla refresca
        cerrar();
        if (deps.onTransicionInvalida) {
          deps.onTransicionInvalida(wellId);
        }
        cambio();
        return snapshot();
      }
      falla(lectura.code);
      if (lectura.code === 'IDEMPOTENCY_CONFLICT' || lectura.code === 'INVALID_CLIENT_REQUEST_ID') {
        s.idQuemado = true;
      }
      cambio();
      if ((lectura.code === 'UNAUTHORIZED' || lectura.code === 'USER_DISABLED') && deps.onSesionExpirada) {
        deps.onSesionExpirada();
      }
      return snapshot();
    });
  }

  // Cancelar (boton / Escape): mientras se anula no se puede.
  function cancelar() {
    if (s.enviando) {
      return false;
    }
    cerrar();
    cambio();
    return true;
  }

  return { abrir: abrir, setMotivo: setMotivo, guardar: guardar, cancelar: cancelar, cerrar: cerrar, estado: snapshot };
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
    observacionesPozoLogic_crearCargador,
    OBSERVACIONES_POZO_TEXTO_MIN,
    OBSERVACIONES_POZO_TEXTO_MAX,
    OBSERVACIONES_POZO_MENSAJE_EXITO,
    OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO,
    observacionesPozoLogic_puedeAgregar,
    observacionesPozoLogic_mensajeErrorAlta,
    observacionesPozoLogic_sinSurrogatesSueltos,
    observacionesPozoLogic_normalizarTexto,
    observacionesPozoLogic_largoTexto,
    observacionesPozoLogic_validarTexto,
    observacionesPozoLogic_textoContador,
    observacionesPozoLogic_nuevoClientRequestId,
    observacionesPozoLogic_leerRespuestaAlta,
    observacionesPozoLogic_siguienteFoco,
    observacionesPozoLogic_crearFormulario,
    OBSERVACIONES_POZO_MOTIVO_MIN,
    OBSERVACIONES_POZO_MOTIVO_MAX,
    OBSERVACIONES_POZO_MENSAJE_ANULADA,
    OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO,
    observacionesPozoLogic_validarContenido,
    observacionesPozoLogic_puedeAnular,
    observacionesPozoLogic_validarMotivo,
    observacionesPozoLogic_mensajeErrorAnular,
    observacionesPozoLogic_leerRespuestaAnulacion,
    observacionesPozoLogic_crearAnulacion
  };
}
