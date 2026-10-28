// Logica pura de la MODERACION de fotos de pozos (E8-4): quien ve cada accion, catalogo de motivos con etiquetas humanas, mensajes de error, lectura segura de las respuestas del backend, vista del
// historial y la maquina de estados de las acciones (sugerir retiro, retirar, reponer) con su clientRequestId por intencion. Sin DOM ni red propios: la red entra por deps.enviar / deps.consultar y el
// repintado por deps.onCambio. El controlador (js/fotosModeracion.js) solo pinta. Backend: docs/fotos-pozos-moderacion.md.
//
// Principios:
//  - Permisos con booleanos EXACTOS (=== true). Nunca por truthy, por nombre ni por autoria. Sugerir = fotos + fotos_carga. Moderar = fotos + fotos_moderar (fotos_carga NO modera, fotos_moderar sin
//    fotos NO modera). El backend vuelve a exigirlos.
//  - El frontend NO reconstruye el estado de una foto: lo que se muestra sale de lo que devuelve el backend (la galeria ya viene filtrada). Lo unico que se recuerda localmente son hechos que el backend
//    acaba de CONFIRMAR en esta sesion (solicitud enviada, foto retirada por esta persona).
//  - Nada tecnico llega a pantalla: ni email, ni clientRequestId, ni secuencia, ni ids, ni el `message` crudo del backend. Los codigos de motivo y de evento se traducen con UNA sola tabla (aca).
//  - El texto libre (motivoTexto) se normaliza con la MISMA regla que el backend (la de las observaciones) y se pinta siempre con textContent.
//
// Depende de js/observacionesPozoLogic.js (normalizacion y largo del texto), js/reemplazoLogic.js (fecha) y js/fotosPozosLogic.js (etiquetas de la foto).

var FOTOS_MODERACION_TEXTO_MIN = 3;
var FOTOS_MODERACION_TEXTO_MAX = 300;
var FOTOS_MODERACION_CLIENT_REQUEST_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

// Catalogo unico de motivos (mismo orden y codigos que el backend).
var FOTOS_MODERACION_MOTIVOS = [
  { codigo: 'NO_CORRESPONDE_POZO', etiqueta: 'No corresponde al pozo' },
  { codigo: 'DUPLICADA', etiqueta: 'Duplicada' },
  { codigo: 'MALA_CALIDAD', etiqueta: 'Mala calidad' },
  { codigo: 'SIN_CONTENIDO_UTIL', etiqueta: 'Sin contenido útil' },
  { codigo: 'PRIVACIDAD', etiqueta: 'Privacidad' },
  { codigo: 'DESACTUALIZADA', etiqueta: 'Desactualizada' },
  { codigo: 'OTRO', etiqueta: 'Otro' }
];
var FOTOS_MODERACION_MOTIVO_DESCONOCIDO = 'Motivo no reconocido';

var FOTOS_MODERACION_TIPOS = ['SUGERIR', 'RETIRAR', 'REPONER'];
var FOTOS_MODERACION_PREFIJOS = { SUGERIR: 'foto-sol', RETIRAR: 'foto-ret', REPONER: 'foto-rep' };     // resolver (E8-5) usara "foto-res"
var FOTOS_MODERACION_PREFIJO_RESOLVER = 'foto-res';

var FOTOS_MODERACION_MENSAJE_GENERICO = 'No se pudo completar la acción. Intentá nuevamente.';
var FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO = 'El estado de la foto cambió. Actualizamos la galería.';
var FOTOS_MODERACION_MENSAJE_SOLICITUD_PENDIENTE = 'Esta foto ya tiene una solicitud de retiro pendiente.';
var FOTOS_MODERACION_MENSAJE_SERVICIO = 'No se pudo consultar la moderación de fotos. Intentá nuevamente.';
var FOTOS_MODERACION_MENSAJE_EXITO_SUGERIR = 'Sugerencia enviada. Un moderador la va a revisar.';
var FOTOS_MODERACION_MENSAJE_EXITO_RETIRAR = 'Foto retirada. El archivo no se eliminó.';
var FOTOS_MODERACION_MENSAJE_EXITO_REPONER = 'Foto repuesta en la galería.';
var FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO = 'Retiro sugerido';
var FOTOS_MODERACION_AVISO_PRIVACIDAD = 'Quedará marcada para revisión de borrado.';
var FOTOS_MODERACION_AVISO_PENDIENTE_BORRADO = 'Pendiente de revisión de borrado';
var FOTOS_MODERACION_AVISO_LEGACY = 'Las fotos ocultas históricamente no pueden reponerse desde este flujo.';

// Un solo lugar para traducir un codigo de error del backend (o de red) a un texto para la persona. Un codigo desconocido NUNCA se muestra: cae en el mensaje generico.
var FOTOS_MODERACION_MENSAJES = {
  INVALID_MOTIVO: 'Elegí un motivo.',
  INVALID_MOTIVO_TEXTO: 'El detalle debe tener entre 3 y 300 caracteres.',
  PERMISSION_DENIED: 'Ya no tenés permiso para realizar esta acción.',
  FOTO_NOT_FOUND: 'La foto ya no está disponible.',
  SOLICITUD_ABIERTA: FOTOS_MODERACION_MENSAJE_SOLICITUD_PENDIENTE,
  SOLICITUD_YA_ABIERTA: FOTOS_MODERACION_MENSAJE_SOLICITUD_PENDIENTE,
  INVALID_TRANSITION: FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
  FOTO_YA_RETIRADA: FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
  FOTO_NO_RETIRADA: FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
  SOLICITUD_YA_RESUELTA: FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
  SOLICITUD_NOT_FOUND: FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
  REPOSICION_NO_PERMITIDA: FOTOS_MODERACION_AVISO_LEGACY,
  ESTADO_NO_DERIVABLE: 'El historial de esta foto requiere revisión manual.',
  IDEMPOTENCY_CONFLICT: 'La acción cambió después de un intento anterior. Revisá los datos e intentá nuevamente.',
  STORAGE_UNAVAILABLE: 'No se pudo cargar la imagen. Intentá nuevamente.',
  SERVICE_UNAVAILABLE: FOTOS_MODERACION_MENSAJE_SERVICIO,
  RED: 'No se pudo conectar. Revisá tu conexión e intentá nuevamente.',
  UNAUTHORIZED: 'Tu sesión venció. Ingresá de nuevo.',
  USER_DISABLED: 'Tu usuario no está habilitado.'
};

// Codigos tras los cuales la foto YA NO esta como se la veia: se cierra el modal y se refresca la galeria con el aviso correspondiente.
var FOTOS_MODERACION_CODIGOS_ESTADO_CAMBIO = ['FOTO_NOT_FOUND', 'FOTO_YA_RETIRADA', 'FOTO_NO_RETIRADA', 'SOLICITUD_YA_RESUELTA', 'SOLICITUD_NOT_FOUND', 'INVALID_TRANSITION'];
var FOTOS_MODERACION_CODIGOS_SESION = ['UNAUTHORIZED', 'USER_DISABLED'];

function fotosModeracionLogic_mensajeError(code) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(FOTOS_MODERACION_MENSAJES, code) ? FOTOS_MODERACION_MENSAJES[code] : FOTOS_MODERACION_MENSAJE_GENERICO;
}

function fotosModeracionLogic_esErrorDeSesion(code) {
  return FOTOS_MODERACION_CODIGOS_SESION.indexOf(code) >= 0;
}

// --- Permisos (booleanos exactos) ---

function fotosModeracionLogic_puedeVer(permisos) {
  return !!permisos && permisos.fotos === true;
}

// "Sugerir retiro": fotos + fotos_carga. Quien solo puede ver no sugiere; fotos_carga sin fotos tampoco (no ve la galeria).
function fotosModeracionLogic_puedeSugerir(permisos) {
  return fotosModeracionLogic_puedeVer(permisos) && permisos.fotos_carga === true;
}

// Retirar / ver historial / reponer: fotos + fotos_moderar. NO se infiere de fotos_carga, ni del nombre, ni de la autoria de la foto.
function fotosModeracionLogic_puedeModerar(permisos) {
  return fotosModeracionLogic_puedeVer(permisos) && permisos.fotos_moderar === true;
}

function fotosModeracionLogic_permitida(tipo, permisos) {
  if (tipo === 'SUGERIR') {
    return fotosModeracionLogic_puedeSugerir(permisos);
  }
  if (tipo === 'RETIRAR' || tipo === 'REPONER') {
    return fotosModeracionLogic_puedeModerar(permisos);
  }
  return false;
}

// --- Etiquetas ---

function fotosModeracionLogic_etiquetaMotivo(codigo) {
  for (var i = 0; i < FOTOS_MODERACION_MOTIVOS.length; i++) {
    if (FOTOS_MODERACION_MOTIVOS[i].codigo === codigo) {
      return FOTOS_MODERACION_MOTIVOS[i].etiqueta;
    }
  }
  return FOTOS_MODERACION_MOTIVO_DESCONOCIDO;
}

function fotosModeracionLogic_esMotivo(codigo) {
  return FOTOS_MODERACION_MOTIVOS.some(function (m) { return m.codigo === codigo; });
}

function fotosModeracionLogic_etiquetaEvento(evento, resolucion) {
  if (evento === 'RETIRO_SOLICITADO') {
    return 'Retiro sugerido';
  }
  if (evento === 'RETIRADA') {
    return 'Foto retirada';
  }
  if (evento === 'RETIRO_RESUELTO') {
    if (resolucion === 'APROBADO') {
      return 'Retiro aprobado';
    }
    if (resolucion === 'RECHAZADO') {
      return 'Retiro rechazado';
    }
    return 'Retiro resuelto';
  }
  if (evento === 'REPUESTA') {
    return 'Foto repuesta';
  }
  return 'Evento no reconocido';
}

// --- Contenido del formulario (motivo + detalle) ---

function fotosModeracionLogic_textoContador(largo) {
  var base = largo + ' / ' + FOTOS_MODERACION_TEXTO_MAX;
  return largo > FOTOS_MODERACION_TEXTO_MAX ? base + ' · te pasaste por ' + (largo - FOTOS_MODERACION_TEXTO_MAX) : base;
}

// codigo: el del select; textoCrudo: lo que escribio. Con OTRO el detalle es obligatorio; con los demas es opcional pero, si se escribe, tiene que tener 3 a 300 caracteres (normalizados).
// -> {valido, codigo, texto (normalizado), largo, error: null | {campo: 'motivo'|'detalle', code}}
function fotosModeracionLogic_validarContenido(codigo, textoCrudo) {
  var v = observacionesPozoLogic_validarContenido(typeof textoCrudo === 'string' ? textoCrudo : '', 1, FOTOS_MODERACION_TEXTO_MAX);
  var salida = { valido: false, codigo: typeof codigo === 'string' ? codigo : '', texto: v.texto, largo: v.largo, error: null };
  if (!fotosModeracionLogic_esMotivo(codigo)) {
    salida.error = { campo: 'motivo', code: 'INVALID_MOTIVO' };
    return salida;
  }
  if (v.largo === 0) {
    if (codigo === 'OTRO') {
      salida.error = { campo: 'detalle', code: 'INVALID_MOTIVO_TEXTO' };
      return salida;
    }
    salida.valido = true;
    return salida;
  }
  if (v.largo < FOTOS_MODERACION_TEXTO_MIN || v.largo > FOTOS_MODERACION_TEXTO_MAX) {
    salida.error = { campo: 'detalle', code: 'INVALID_MOTIVO_TEXTO' };
    return salida;
  }
  salida.valido = true;
  return salida;
}

// --- clientRequestId ---

// "foto-sol-<uuid>", "foto-ret-<uuid>", "foto-rep-<uuid>", "foto-res-<uuid>": cada accion con su propio espacio; 8 a 64 caracteres [A-Za-z0-9_-] (lo que exige el backend). `aleatorio`: solo para tests.
function fotosModeracionLogic_nuevoClientRequestId(tipo, aleatorio) {
  var pre = tipo === 'RESOLVER' ? FOTOS_MODERACION_PREFIJO_RESOLVER : FOTOS_MODERACION_PREFIJOS[tipo];
  if (!pre) {
    throw new Error('tipo de accion de moderacion desconocido');
  }
  if (!aleatorio && typeof crypto !== 'undefined' && crypto && typeof crypto.randomUUID === 'function') {
    var id = pre + '-' + crypto.randomUUID();
    if (FOTOS_MODERACION_CLIENT_REQUEST_ID_REGEX.test(id)) {
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

// --- Respuestas del backend ---

function fotosModeracionLogic_idNormalizado(id) {
  return typeof id === 'string' ? id.trim().toLowerCase() : '';
}

// Respuesta de solicitar / retirar / reponer -> {ok:true, duplicada, solicitudId} | {ok:false, code}. `duplicada` true y false son AMBOS exito (el reintento es idempotente). Una respuesta sin la forma esperada
// o de OTRA foto NO se da por buena (la escritura pudo ocurrir: reintentar con el mismo id es seguro).
function fotosModeracionLogic_leerRespuestaEscritura(resp, fotoIdEsperado) {
  var falla = { ok: false, code: 'SERVICE_UNAVAILABLE' };
  if (!resp || typeof resp !== 'object') {
    return falla;
  }
  if (resp.status === 'error') {
    return { ok: false, code: typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE' };
  }
  var d = resp.data;
  if (resp.status !== 'ok' || !d || typeof d !== 'object' || fotosModeracionLogic_idNormalizado(d.fotoId) !== fotosModeracionLogic_idNormalizado(fotoIdEsperado) || fotosModeracionLogic_idNormalizado(fotoIdEsperado) === '') {
    return falla;
  }
  return { ok: true, duplicada: d.duplicada === true, solicitudId: typeof d.solicitudId === 'string' ? d.solicitudId : null };
}

function fotosModeracionLogic_fechaEvento(iso) {
  return typeof observacionesPozoLogic_fecha === 'function' ? observacionesPozoLogic_fecha(iso) : '';
}

// Historial del backend -> modelo de vista (lista blanca) o null si no es de la foto esperada / no tiene la forma esperada. MANTIENE el orden recibido (el backend entrega el mas reciente primero).
// Sin email, sin clientRequestId, sin secuencia, sin ids tecnicos: solo etiquetas humanas, nombre, fecha, motivo y detalle.
function fotosModeracionLogic_vistaHistorial(data, fotoIdEsperado) {
  if (!data || typeof data !== 'object' || !data.foto || typeof data.foto !== 'object' || !data.estado || typeof data.estado !== 'object' || !Array.isArray(data.eventos)) {
    return null;
  }
  var id = fotosModeracionLogic_idNormalizado(fotoIdEsperado);
  if (id === '' || fotosModeracionLogic_idNormalizado(data.foto.fotoId) !== id) {
    return null;
  }
  var e = data.estado;
  var derivable = e.integridad === 'OK';
  var retirada = derivable && e.estado === 'RETIRADA';
  var nombreNeutro = typeof OBSERVACIONES_POZO_NOMBRE_NEUTRO === 'string' ? OBSERVACIONES_POZO_NOMBRE_NEUTRO : 'Usuario';
  var fecha = typeof fotosPozosLogic_formatearFecha === 'function' ? fotosPozosLogic_formatearFecha(data.foto.fechaFotoValor, data.foto.fechaFotoPrecision) : '';
  var fuente = typeof fotosPozosLogic_etiquetaFuente === 'function' ? fotosPozosLogic_etiquetaFuente(data.foto.fuente) : '';
  var tipo = typeof fotosPozosLogic_etiquetaTipo === 'function' ? fotosPozosLogic_etiquetaTipo(data.foto.tipoFoto) : '';
  return {
    fotoId: id,
    fecha: fecha,
    detalle: fuente && tipo ? fuente + ' · ' + tipo : (fuente || tipo),
    estado: {
      derivable: derivable,
      retirada: retirada,
      etiqueta: !derivable ? 'Historial no disponible: requiere revisión manual' : (retirada ? 'Foto retirada' : 'Visible en la galería'),
      solicitudAbierta: derivable && !!e.solicitudAbierta && typeof e.solicitudAbierta === 'object',
      pendienteBorrado: retirada && e.requiereRevisionBorrado === true,
      legacy: retirada && e.origenRetiro === 'LEGACY_OCULTA'
    },
    puedeReponer: retirada && e.puedeReponerse === true && e.origenRetiro !== 'LEGACY_OCULTA',
    eventos: data.eventos.filter(function (ev) { return !!ev && typeof ev === 'object'; }).map(function (ev) {
      var nombre = typeof ev.nombre === 'string' ? ev.nombre.trim() : '';
      var detalleTexto = (ev.evento === 'RETIRO_SOLICITADO' || ev.evento === 'RETIRADA') && typeof ev.motivoTexto === 'string' ? ev.motivoTexto : '';
      return {
        titulo: fotosModeracionLogic_etiquetaEvento(ev.evento, ev.resolucion),
        nombre: nombre === '' || /\S+@\S+/.test(nombre) ? nombreNeutro : nombre,
        fecha: fotosModeracionLogic_fechaEvento(ev.timestampUtc),
        motivo: ev.motivoCodigo ? fotosModeracionLogic_etiquetaMotivo(ev.motivoCodigo) : '',
        texto: detalleTexto
      };
    })
  };
}

// --- Historial: carga con descarte de respuestas viejas ---
// deps: obtenerContexto() -> {sessionToken, permisos}; consultar(sessionToken, fotoId) -> Promise<respuesta>; onCambio(estado); onSesionExpirada().
// El historial es SOLO de moderadores (fotos + fotos_moderar): sin ese permiso no se pide nada.
function fotosModeracionLogic_crearHistorial(deps) {
  var s = { abierto: false, fotoId: null, cargando: false, error: null, vista: null };
  var token = 0;

  function snapshot() {
    return { abierto: s.abierto, fotoId: s.fotoId, cargando: s.cargando, error: s.error, vista: s.vista };
  }

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(snapshot());
    }
  }

  function cargar() {
    token += 1;
    var mio = token;
    var ctx = deps.obtenerContexto() || {};
    if (!fotosModeracionLogic_puedeModerar(ctx.permisos)) {
      s.cargando = false;
      s.error = { code: 'PERMISSION_DENIED', mensaje: fotosModeracionLogic_mensajeError('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    s.cargando = true;
    s.error = null;
    s.vista = null;
    var fotoId = s.fotoId;
    cambio();
    return new Promise(function (resolver) {
      resolver(deps.consultar(ctx.sessionToken, fotoId));
    }).then(function (resp) {
      if (mio !== token) {
        return snapshot();
      }
      s.cargando = false;
      if (resp && resp.status === 'ok') {
        var vista = fotosModeracionLogic_vistaHistorial(resp.data, fotoId);
        if (vista) {
          s.vista = vista;
        } else {
          s.error = { code: 'SERVICE_UNAVAILABLE', mensaje: fotosModeracionLogic_mensajeError('SERVICE_UNAVAILABLE') };
        }
      } else {
        var code = resp && typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE';
        s.error = { code: code, mensaje: fotosModeracionLogic_mensajeError(code) };
      }
      cambio();
      if (s.error && fotosModeracionLogic_esErrorDeSesion(s.error.code) && deps.onSesionExpirada) {
        deps.onSesionExpirada();
      }
      return snapshot();
    }, function () {
      if (mio !== token) {
        return snapshot();
      }
      s.cargando = false;
      s.error = { code: 'RED', mensaje: fotosModeracionLogic_mensajeError('RED') };
      cambio();
      return snapshot();
    });
  }

  return {
    abrir: function (fotoId) {
      var ctx = deps.obtenerContexto() || {};
      token += 1;
      s = { abierto: false, fotoId: null, cargando: false, error: null, vista: null };
      if (!fotosModeracionLogic_puedeModerar(ctx.permisos) || fotosModeracionLogic_idNormalizado(fotoId) === '') {
        cambio();
        return Promise.resolve(false);
      }
      s.abierto = true;
      s.fotoId = fotosModeracionLogic_idNormalizado(fotoId);
      return cargar().then(function () { return true; });
    },
    reintentar: function () { return s.abierto ? cargar() : Promise.resolve(snapshot()); },
    cerrar: function () {
      token += 1;
      s = { abierto: false, fotoId: null, cargando: false, error: null, vista: null };
      cambio();
    },
    estado: snapshot
  };
}

// --- Acciones con envio: sugerir retiro, retirar, reponer ---
// deps:
//   obtenerContexto() -> {sessionToken, permisos}                                  (SIEMPRE fresco)
//   enviar(tipo, sessionToken, datos{fotoId, motivoCodigo, motivoTexto}, clientRequestId) -> Promise<respuesta del backend>
//   generarId(tipo) -> clientRequestId                                              (por defecto fotosModeracionLogic_nuevoClientRequestId)
//   onCambio(estado)                                                                (repintar)
//   onExito({tipo, fotoId, foto, duplicada, solicitudId, motivoCodigo})             (solo si la respuesta sigue siendo del contexto vigente)
//   onEstadoCambiado({tipo, fotoId, foto, code})                                    (la foto ya no esta como se la veia: se cierra y la galeria refresca)
//   onSesionExpirada()                                                              (UNAUTHORIZED / USER_DISABLED)
//
// clientRequestId = UNA intencion (esta accion sobre esta foto con este motivo y detalle normalizados):
//   abrir => id nuevo; cancelar y reabrir => id nuevo; tras un exito => id nuevo en la proxima;
//   reintentar el MISMO contenido tras un error recuperable (red, servidor) => el MISMO id (el backend deduplica: duplicada:true);
//   ya hubo un intento y el contenido normalizado cambio => id nuevo ANTES de enviar;
//   tras IDEMPOTENCY_CONFLICT o INVALID_CLIENT_REQUEST_ID => el id queda "quemado": el SIGUIENTE envio del usuario usa uno nuevo (nunca se reenvia solo).
// Doble envio: mientras hay un pedido en vuelo, guardar() no lanza otro. Cada abrir / cancelar / cerrar invalida lo que este en vuelo (otra foto, salir de la pantalla, cerrar sesion).
// PRIVACIDAD: el estado guarda de la foto solo lo que hace falta para identificarla (fotoId y los datos de la grilla), nunca imagenes.
function fotosModeracionLogic_accionInicial() {
  return { abierto: false, tipo: null, foto: null, codigo: '', detalle: '', id: null, ultimoIntento: null, idQuemado: false, enviando: false, error: null };
}

function fotosModeracionLogic_crearAccion(deps) {
  var s = fotosModeracionLogic_accionInicial();
  var sesion = 0;

  function conContenido() {
    return s.tipo === 'SUGERIR' || s.tipo === 'RETIRAR';
  }

  function snapshot() {
    var v = fotosModeracionLogic_validarContenido(s.codigo, s.detalle);
    var contenido = conContenido();
    return {
      abierto: s.abierto,
      tipo: s.tipo,
      foto: s.foto,
      codigo: s.codigo,
      detalle: s.detalle,
      largo: v.largo,
      contador: fotosModeracionLogic_textoContador(v.largo),
      excede: v.largo > FOTOS_MODERACION_TEXTO_MAX,
      detalleObligatorio: s.codigo === 'OTRO',
      avisoPrivacidad: s.tipo === 'RETIRAR' && s.codigo === 'PRIVACIDAD',
      valido: contenido ? v.valido : true,
      enviando: s.enviando,
      puedeEnviar: s.abierto && !s.enviando && (contenido ? v.valido : true),
      error: s.error,
      clientRequestId: s.id
    };
  }

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(snapshot());
    }
  }

  function generar(tipo) {
    return deps.generarId ? deps.generarId(tipo) : fotosModeracionLogic_nuevoClientRequestId(tipo);
  }

  function falla(code, campo) {
    s.error = { code: code, mensaje: fotosModeracionLogic_mensajeError(code), campo: campo || null };
  }

  function cerrar() {
    sesion += 1;
    s = fotosModeracionLogic_accionInicial();
  }

  // tipo: 'SUGERIR' | 'RETIRAR' | 'REPONER'. foto: {fotoId, ...datos de la grilla}. false si no hay permiso o la foto no es valida (no se abre nada).
  function abrir(tipo, foto) {
    sesion += 1;
    var ctx = deps.obtenerContexto() || {};
    s = fotosModeracionLogic_accionInicial();
    if (FOTOS_MODERACION_TIPOS.indexOf(tipo) < 0 || !fotosModeracionLogic_permitida(tipo, ctx.permisos) || !foto || fotosModeracionLogic_idNormalizado(foto.fotoId) === '') {
      cambio();
      return false;
    }
    s.abierto = true;
    s.tipo = tipo;
    s.foto = foto;
    s.id = generar(tipo);
    cambio();
    return true;
  }

  function setCodigo(codigo) {
    if (!s.abierto || !conContenido()) {
      return;
    }
    s.codigo = typeof codigo === 'string' ? codigo : '';
    s.error = null;
    cambio();
  }

  function setDetalle(texto) {
    if (!s.abierto || !conContenido()) {
      return;
    }
    s.detalle = typeof texto === 'string' ? texto : '';
    s.error = null;
    cambio();
  }

  function guardar() {
    if (!s.abierto || s.enviando) {
      return Promise.resolve(snapshot());               // doble envio: no hay otro pedido
    }
    var ctx = deps.obtenerContexto() || {};
    if (!fotosModeracionLogic_permitida(s.tipo, ctx.permisos)) {
      falla('PERMISSION_DENIED');
      cambio();
      return Promise.resolve(snapshot());
    }
    var contenido = conContenido();
    var v = contenido ? fotosModeracionLogic_validarContenido(s.codigo, s.detalle) : null;
    if (contenido && !v.valido) {
      falla(v.error.code, v.error.campo);
      cambio();
      return Promise.resolve(snapshot());
    }
    var clave = contenido ? v.codigo + '|' + v.texto : '';
    if (s.ultimoIntento !== null && (s.ultimoIntento !== clave || s.idQuemado)) {
      s.id = generar(s.tipo);                           // otra intencion: contenido distinto, o un id que el backend ya asocio a otro contenido
      s.idQuemado = false;
    }
    s.ultimoIntento = clave;
    s.enviando = true;
    s.error = null;
    var mia = sesion;
    var tipo = s.tipo;
    var foto = s.foto;
    var fotoId = foto.fotoId;
    var id = s.id;
    var datos = { fotoId: fotoId };
    if (contenido) {
      datos.motivoCodigo = v.codigo;
      datos.motivoTexto = v.texto === '' ? undefined : v.texto;
    }
    cambio();
    return new Promise(function (resolver) {
      resolver(deps.enviar(tipo, ctx.sessionToken, datos, id));
    }).then(function (resp) {
      return fotosModeracionLogic_leerRespuestaEscritura(resp, fotoId);
    }, function () {
      return { ok: false, code: 'RED' };
    }).then(function (lectura) {
      if (mia !== sesion) {
        return snapshot();                              // contexto viejo: no se aplica nada
      }
      s.enviando = false;
      if (lectura.ok) {
        cerrar();                                       // exito: se descarta todo (la proxima accion es otra intencion)
        if (deps.onExito) {
          deps.onExito({ tipo: tipo, fotoId: fotoId, foto: foto, duplicada: lectura.duplicada, solicitudId: lectura.solicitudId, motivoCodigo: datos.motivoCodigo || null });
        }
        cambio();
        return snapshot();
      }
      var cierraYRefresca = FOTOS_MODERACION_CODIGOS_ESTADO_CAMBIO.indexOf(lectura.code) >= 0 || (tipo === 'SUGERIR' && lectura.code === 'SOLICITUD_YA_ABIERTA');
      if (cierraYRefresca) {
        cerrar();
        if (deps.onEstadoCambiado) {
          deps.onEstadoCambiado({ tipo: tipo, fotoId: fotoId, foto: foto, code: lectura.code });
        }
        cambio();
        return snapshot();
      }
      falla(lectura.code, null);
      if (lectura.code === 'IDEMPOTENCY_CONFLICT' || lectura.code === 'INVALID_CLIENT_REQUEST_ID') {
        s.idQuemado = true;
      }
      cambio();
      if (fotosModeracionLogic_esErrorDeSesion(lectura.code) && deps.onSesionExpirada) {
        deps.onSesionExpirada();
      }
      return snapshot();
    });
  }

  // Cancelar (boton / Escape): mientras se envia no se puede.
  function cancelar() {
    if (s.enviando) {
      return false;
    }
    cerrar();
    cambio();
    return true;
  }

  // Cierre incondicional (cerrar sesion, salir de la pantalla): descarta lo que este en vuelo.
  function descartar() {
    cerrar();
    cambio();
  }

  return { abrir: abrir, setCodigo: setCodigo, setDetalle: setDetalle, guardar: guardar, cancelar: cancelar, descartar: descartar, estado: snapshot };
}

// Recorrido de foco dentro de un modal (Tab / Shift+Tab): indice a enfocar, o -1 si no hay nada enfocable.
function fotosModeracionLogic_siguienteFoco(cantidad, actual, atras) {
  if (cantidad <= 0) {
    return -1;
  }
  if (actual < 0 || actual >= cantidad) {
    return atras ? cantidad - 1 : 0;
  }
  return atras ? (actual - 1 + cantidad) % cantidad : (actual + 1) % cantidad;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_MODERACION_TEXTO_MIN,
    FOTOS_MODERACION_TEXTO_MAX,
    FOTOS_MODERACION_MOTIVOS,
    FOTOS_MODERACION_MENSAJE_GENERICO,
    FOTOS_MODERACION_MENSAJE_ESTADO_CAMBIO,
    FOTOS_MODERACION_MENSAJE_SOLICITUD_PENDIENTE,
    FOTOS_MODERACION_MENSAJE_SERVICIO,
    FOTOS_MODERACION_MENSAJE_EXITO_SUGERIR,
    FOTOS_MODERACION_MENSAJE_EXITO_RETIRAR,
    FOTOS_MODERACION_MENSAJE_EXITO_REPONER,
    FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO,
    FOTOS_MODERACION_AVISO_PRIVACIDAD,
    FOTOS_MODERACION_AVISO_PENDIENTE_BORRADO,
    FOTOS_MODERACION_AVISO_LEGACY,
    fotosModeracionLogic_mensajeError,
    fotosModeracionLogic_esErrorDeSesion,
    fotosModeracionLogic_puedeVer,
    fotosModeracionLogic_puedeSugerir,
    fotosModeracionLogic_puedeModerar,
    fotosModeracionLogic_permitida,
    fotosModeracionLogic_etiquetaMotivo,
    fotosModeracionLogic_esMotivo,
    fotosModeracionLogic_etiquetaEvento,
    fotosModeracionLogic_textoContador,
    fotosModeracionLogic_validarContenido,
    fotosModeracionLogic_nuevoClientRequestId,
    fotosModeracionLogic_idNormalizado,
    fotosModeracionLogic_leerRespuestaEscritura,
    fotosModeracionLogic_vistaHistorial,
    fotosModeracionLogic_crearHistorial,
    fotosModeracionLogic_crearAccion,
    fotosModeracionLogic_siguienteFoco
  };
}
