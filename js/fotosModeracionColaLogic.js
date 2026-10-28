// Logica pura de la pantalla institucional "Fotos pendientes" (E8-5): las dos listas (Pendientes = solicitudes de retiro abiertas; Retiradas = fotos retiradas que se pueden reponer), su paginacion por
// cursor, las respuestas viejas, la vista de cada item, la cola de miniaturas y las acciones de la pantalla (aprobar, rechazar, reponer). Sin DOM ni red propios: la red entra por deps.consultar /
// deps.enviar y el repintado por deps.onCambio. El controlador (js/fotosModeracionCola.js) solo pinta. Backend: docs/fotos-pozos-moderacion.md.
//
// Principios:
//  - Solo fotos + fotos_moderar (booleanos exactos, fotosModeracionLogic_puedeModerar). Sin ese permiso no se pide NADA.
//  - La verdad es del backend: nada se arma en memoria de sesion. Tras una accion, el item sale de SU lista y la otra lista se marca para recargarse; si el backend dice que el estado cambio, se
//    recarga la primera pagina.
//  - Las dos listas son INDEPENDIENTES (cada una con su estado y su token): una respuesta vieja de Pendientes jamas pisa Retiradas, y una respuesta vieja de la misma lista (recarga, cambio de
//    pantalla, cierre de sesion) se descarta.
//  - Paginacion honesta: una pagina por vez ("Ver mas"), cursor del backend, dedupe por clave. No hay filtros de cliente: filtrar solo la pagina cargada haria creer que se busca en toda la cola.
//  - Nada tecnico llega a pantalla: ni email, ni clientRequestId, ni secuencia, ni ids de Drive. Los codigos se traducen con las tablas de fotosModeracionLogic.js.
//
// Depende de js/fotosModeracionLogic.js (permisos, etiquetas, ids, maquina de acciones), js/observacionesPozoLogic.js, js/reemplazoLogic.js y js/fotosPozosLogic.js (etiquetas de la foto).

var FOTOS_COLA_PENDIENTES = 'PENDIENTES';
var FOTOS_COLA_RETIRADAS = 'RETIRADAS';
var FOTOS_COLA_PESTANAS = [FOTOS_COLA_PENDIENTES, FOTOS_COLA_RETIRADAS];
var FOTOS_COLA_ETIQUETAS_PESTANA = { PENDIENTES: 'Pendientes', RETIRADAS: 'Retiradas' };
var FOTOS_COLA_LIMITE = 20;                 // por pagina (el backend acepta hasta 100)
var FOTOS_COLA_MINIATURAS_PARALELAS = 3;    // igual que la galeria

var FOTOS_COLA_TITULO = 'Fotos pendientes';
var FOTOS_COLA_SUBTITULO = 'Revisá solicitudes de retiro';
var FOTOS_COLA_VACIO = { PENDIENTES: 'No hay solicitudes de retiro pendientes.', RETIRADAS: 'No hay fotos retiradas para revisar.' };
var FOTOS_COLA_MENSAJE_ERROR = 'No se pudo cargar la moderación de fotos.';
var FOTOS_COLA_MENSAJE_ERROR_MAS = 'No se pudieron cargar más. Intentá nuevamente.';
var FOTOS_COLA_MENSAJE_RESUELTA = 'La solicitud ya fue resuelta. Actualizamos la lista.';
var FOTOS_COLA_MENSAJE_FOTO_NO_DISPONIBLE = 'La foto ya no está disponible. Actualizamos la lista.';
var FOTOS_COLA_MENSAJE_ESTADO_CAMBIO = 'El estado de la foto cambió. Actualizamos la lista.';
var FOTOS_COLA_MENSAJE_EXITO = {
  APROBAR: 'Retiro aprobado. La foto ya no se muestra en la galería.',
  RECHAZAR: 'Retiro rechazado. La foto sigue visible.',
  REPONER: 'Foto repuesta en la galería.'
};
var FOTOS_COLA_MENSAJE_SIN_VISTA_PREVIA = 'Sin vista previa';
var FOTOS_COLA_AVISO_BORRADO_REPONER = 'También dejará de quedar marcada para revisión de borrado.';

// Confirmaciones de las acciones de la pantalla (titulo, texto y boton). El texto de REPONER es el de la reposicion de E8-4.
var FOTOS_COLA_CONFIRMACIONES = {
  APROBAR: { titulo: 'Aprobar retiro', texto: 'La foto dejará de mostrarse en la galería.', boton: 'Aprobar retiro', enviando: 'Aprobando…' },
  RECHAZAR: { titulo: 'Rechazar retiro', texto: 'La foto seguirá visible en la galería.', boton: 'Rechazar', enviando: 'Rechazando…' },
  REPONER: { titulo: 'Reponer foto', texto: '¿Querés volver a mostrar esta foto en la galería?', boton: 'Reponer foto', enviando: 'Reponiendo…' }
};

var FOTOS_COLA_CODIGOS_RESUELTA = ['SOLICITUD_YA_RESUELTA', 'SOLICITUD_NOT_FOUND', 'INVALID_TRANSITION'];

// --- Permisos, pestañas, teclado ---

function fotosModeracionColaLogic_puedeVer(permisos) {
  return fotosModeracionLogic_puedeModerar(permisos);
}

function fotosModeracionColaLogic_esPestana(p) {
  return FOTOS_COLA_PESTANAS.indexOf(p) >= 0;
}

// Flechas / Inicio / Fin sobre la lista de pestañas (patron WAI-ARIA): devuelve la pestaña a activar o null si la tecla no es de navegacion.
function fotosModeracionColaLogic_pestanaPorTecla(actual, tecla) {
  var i = FOTOS_COLA_PESTANAS.indexOf(actual);
  if (i < 0) {
    return null;
  }
  if (tecla === 'ArrowRight' || tecla === 'ArrowDown') {
    return FOTOS_COLA_PESTANAS[(i + 1) % FOTOS_COLA_PESTANAS.length];
  }
  if (tecla === 'ArrowLeft' || tecla === 'ArrowUp') {
    return FOTOS_COLA_PESTANAS[(i - 1 + FOTOS_COLA_PESTANAS.length) % FOTOS_COLA_PESTANAS.length];
  }
  if (tecla === 'Home') {
    return FOTOS_COLA_PESTANAS[0];
  }
  if (tecla === 'End') {
    return FOTOS_COLA_PESTANAS[FOTOS_COLA_PESTANAS.length - 1];
  }
  return null;
}

// --- Vistas (lista blanca) ---

// "Pozo 14-0001" / "Punto NE INA 536"; '' si la entidad no tiene la forma esperada (el item no se muestra).
function fotosModeracionColaLogic_etiquetaEntidad(tipo, id) {
  if (typeof id !== 'string' || id.trim() === '') {
    return '';
  }
  if (tipo === 'WELL') {
    return 'Pozo ' + id.trim();
  }
  if (tipo === 'MONITORING') {
    return 'Punto NE ' + id.trim();
  }
  return '';
}

function fotosModeracionColaLogic_nombre(nombre) {
  var neutro = typeof OBSERVACIONES_POZO_NOMBRE_NEUTRO === 'string' ? OBSERVACIONES_POZO_NOMBRE_NEUTRO : 'Usuario';
  var n = typeof nombre === 'string' ? nombre.trim() : '';
  return n === '' || /\S+@\S+/.test(n) ? neutro : n;
}

// Metadata basica de la foto (tipo, fuente, fecha de la foto) o null si el backend no la trajo.
function fotosModeracionColaLogic_vistaFoto(f) {
  if (!f || typeof f !== 'object') {
    return null;
  }
  var fecha = typeof fotosPozosLogic_formatearFecha === 'function' ? fotosPozosLogic_formatearFecha(f.fechaFotoValor, f.fechaFotoPrecision) : '';
  var fuente = typeof fotosPozosLogic_etiquetaFuente === 'function' ? fotosPozosLogic_etiquetaFuente(f.fuente) : '';
  var tipo = typeof fotosPozosLogic_etiquetaTipo === 'function' ? fotosPozosLogic_etiquetaTipo(f.tipoFoto) : '';
  return { fecha: fecha, fuente: fuente, tipo: tipo };
}

function fotosModeracionColaLogic_textoMotivo(codigo) {
  return typeof codigo === 'string' && codigo !== '' ? fotosModeracionLogic_etiquetaMotivo(codigo) : '';
}

// Solicitud abierta del backend -> tarjeta de Pendientes, o null si no tiene la forma esperada. Lista blanca: sin email, secuencia, clientRequestId ni ids de Drive.
function fotosModeracionColaLogic_vistaPendiente(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  var solicitudId = fotosModeracionLogic_idNormalizado(raw.solicitudId);
  var fotoId = fotosModeracionLogic_idNormalizado(raw.fotoId);
  var entidad = fotosModeracionColaLogic_etiquetaEntidad(raw.entidadTipo, raw.entidadId);
  if (solicitudId === '' || fotoId === '' || entidad === '') {
    return null;
  }
  return {
    clave: solicitudId,
    solicitudId: solicitudId,
    fotoId: fotoId,
    entidad: entidad,
    fecha: fotosModeracionLogic_fechaEvento(raw.timestampUtc),
    nombre: fotosModeracionColaLogic_nombre(raw.nombre),
    motivo: fotosModeracionColaLogic_textoMotivo(raw.motivoCodigo),
    texto: typeof raw.motivoTexto === 'string' ? raw.motivoTexto : '',
    foto: fotosModeracionColaLogic_vistaFoto(raw.foto)
  };
}

// Foto retirada del backend -> tarjeta de Retiradas, o null. `pendienteBorrado` solo si el backend lo dice (PRIVACIDAD): se muestra a moderadores, nunca hay boton de borrar.
function fotosModeracionColaLogic_vistaRetirada(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  var fotoId = fotosModeracionLogic_idNormalizado(raw.fotoId);
  var entidad = fotosModeracionColaLogic_etiquetaEntidad(raw.entidadTipo, raw.entidadId);
  if (fotoId === '' || entidad === '' || raw.origenRetiro !== 'EVENTO') {
    return null;
  }
  var nombre = fotosModeracionColaLogic_nombre(raw.nombre);
  return {
    clave: fotoId,
    fotoId: fotoId,
    entidad: entidad,
    fecha: fotosModeracionLogic_fechaEvento(raw.timestampUtc),
    nombre: nombre,
    quien: (raw.viaSolicitud === true ? 'Retiro aprobado por ' : 'Retirada por ') + nombre,
    motivo: fotosModeracionColaLogic_textoMotivo(raw.motivoCodigo),
    texto: typeof raw.motivoTexto === 'string' ? raw.motivoTexto : '',
    pendienteBorrado: raw.requiereRevisionBorrado === true,
    foto: fotosModeracionColaLogic_vistaFoto(raw.foto)
  };
}

// Pagina del backend -> {items (vistas, sin repetidos ni removidos), total, hayMas, cursor} | null si no tiene la forma esperada. Un item mal formado se descarta (no rompe la lista).
function fotosModeracionColaLogic_vistaPagina(pestana, data, yaVistas, removidos) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.items)) {
    return null;
  }
  var vista = pestana === FOTOS_COLA_RETIRADAS ? fotosModeracionColaLogic_vistaRetirada : fotosModeracionColaLogic_vistaPendiente;
  var vistas = yaVistas || {};
  var quitados = removidos || {};
  var items = [];
  data.items.forEach(function (raw) {
    var v = vista(raw);
    if (v === null || vistas[v.clave] === true || quitados[v.clave] === true) {
      return;
    }
    vistas[v.clave] = true;
    items.push(v);
  });
  var cursorValido = typeof data.cursor === 'number' && isFinite(data.cursor) && Math.floor(data.cursor) === data.cursor && data.cursor >= 1;
  return {
    items: items,
    total: typeof data.total === 'number' && isFinite(data.total) && data.total >= 0 ? Math.floor(data.total) : null,
    hayMas: data.hayMas === true && cursorValido,
    cursor: cursorValido ? data.cursor : null
  };
}

// "3 solicitudes pendientes" / "1 foto retirada": el total que informa el backend (o los items cargados si no lo trajo). '' si todavia no hay nada que contar.
function fotosModeracionColaLogic_textoTotal(pestana, n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 1) {
    return '';
  }
  if (pestana === FOTOS_COLA_RETIRADAS) {
    return n + (n === 1 ? ' foto retirada' : ' fotos retiradas');
  }
  return n + (n === 1 ? ' solicitud pendiente' : ' solicitudes pendientes');
}

function fotosModeracionColaLogic_mensajeCarga(code) {
  return code === 'PERMISSION_DENIED' ? fotosModeracionLogic_mensajeError('PERMISSION_DENIED') : FOTOS_COLA_MENSAJE_ERROR;
}

// Mensaje cuando el backend dice que el estado cambio (otro moderador ya resolvio, la foto ya no esta...). tipo: APROBAR | RECHAZAR | REPONER.
function fotosModeracionColaLogic_mensajeCambioEstado(tipo, code) {
  if (code === 'FOTO_NOT_FOUND') {
    return FOTOS_COLA_MENSAJE_FOTO_NO_DISPONIBLE;
  }
  if ((tipo === 'APROBAR' || tipo === 'RECHAZAR') && FOTOS_COLA_CODIGOS_RESUELTA.indexOf(code) >= 0) {
    return FOTOS_COLA_MENSAJE_RESUELTA;
  }
  return FOTOS_COLA_MENSAJE_ESTADO_CAMBIO;
}

// --- Cola de miniaturas: maximo N pedidos en paralelo, sin repetir el mismo, con cache en memoria ---
// cargar(fotoId) -> Promise<url>. pedir(fotoId) -> Promise<url> (rechaza si falla: el controlador deja el recuadro de "sin vista previa"). reset() descarta lo que esta esperando y el cache.
function fotosModeracionColaLogic_crearColaMiniaturas(max, cargar) {
  var cache = {};
  var enVuelo = {};
  var espera = [];
  var activas = 0;
  var generacion = 0;

  function avanzar() {
    while (activas < max && espera.length > 0) {
      var tarea = espera.shift();
      activas += 1;
      (function (t) {
        var mia = generacion;
        new Promise(function (resolver) { resolver(cargar(t.fotoId)); }).then(function (url) {
          if (mia === generacion) {
            cache[t.fotoId] = url;
          }
          delete enVuelo[t.fotoId];
          t.resolver(url);
        }, function (err) {
          delete enVuelo[t.fotoId];
          t.rechazar(err);
        }).then(function () {
          activas -= 1;
          avanzar();
        });
      })(tarea);
    }
  }

  return {
    pedir: function (fotoId) {
      if (cache[fotoId]) {
        return Promise.resolve(cache[fotoId]);
      }
      if (enVuelo[fotoId]) {
        return enVuelo[fotoId];
      }
      var p = new Promise(function (resolver, rechazar) {
        espera.push({ fotoId: fotoId, resolver: resolver, rechazar: rechazar });
      });
      enVuelo[fotoId] = p;
      avanzar();
      return p;
    },
    reset: function () {
      generacion += 1;
      cache = {};
      var pendientes = espera;
      espera = [];
      pendientes.forEach(function (t) {
        delete enVuelo[t.fotoId];
        t.rechazar(new Error('DESCARTADA'));
      });
    },
    activas: function () { return activas; },
    enEspera: function () { return espera.length; }
  };
}

// --- La pantalla ---
// deps:
//   obtenerContexto() -> {sessionToken, permisos}                                     (SIEMPRE fresco)
//   consultar(pestana, sessionToken, limit, cursor) -> Promise<respuesta del backend>  (PENDIENTES -> cola, RETIRADAS -> listado de retiradas)
//   enviar(tipo, sessionToken, datos, clientRequestId) -> Promise<respuesta>           (APROBAR | RECHAZAR | REPONER; ver fotosModeracionLogic_crearAccion)
//   generarId(tipo)                                                                    (opcional, para tests)
//   onCambio(estado)                                                                   (repintar)
//   onSesionExpirada()                                                                 (UNAUTHORIZED / USER_DISABLED, de la lista o de una accion)
//   onVisibilidadCambio({tipo, fotoId})                                                (aprobar o reponer cambian lo que ve la galeria: el controlador refresca contadores)
function fotosModeracionColaLogic_listaVacia() {
  return { items: [], vistas: {}, removidos: {}, total: null, hayMas: false, cursor: null, cargando: false, cargandoMas: false, error: null, errorMas: null, cargada: false, token: 0 };
}

function fotosModeracionColaLogic_crear(deps) {
  var s = { abierta: false, pestana: FOTOS_COLA_PENDIENTES, aviso: { texto: '', error: false }, listas: {} };
  var generacion = 0;
  FOTOS_COLA_PESTANAS.forEach(function (p) { s.listas[p] = fotosModeracionColaLogic_listaVacia(); });
  var accion = null;

  function contexto() {
    return (deps.obtenerContexto ? deps.obtenerContexto() : null) || {};
  }

  function snapshotLista(p) {
    var l = s.listas[p];
    return {
      items: l.items.slice(),
      total: l.total,
      hayMas: l.hayMas,
      cargando: l.cargando,
      cargandoMas: l.cargandoMas,
      error: l.error,
      errorMas: l.errorMas,
      cargada: l.cargada,
      vacia: l.cargada && !l.cargando && l.error === null && l.items.length === 0 && !l.hayMas
    };
  }

  function snapshot() {
    var a = accion ? accion.estado() : null;
    var item = null;
    if (a && a.abierto && a.foto) {
      var l = s.listas[a.tipo === 'REPONER' ? FOTOS_COLA_RETIRADAS : FOTOS_COLA_PENDIENTES];
      item = null;
      l.items.forEach(function (it) { if (it.clave === a.foto.clave) { item = it; } });
    }
    var conf = a && a.abierto ? FOTOS_COLA_CONFIRMACIONES[a.tipo] : null;
    return {
      abierta: s.abierta,
      pestana: s.pestana,
      aviso: { texto: s.aviso.texto, error: s.aviso.error },
      pendientes: snapshotLista(FOTOS_COLA_PENDIENTES),
      retiradas: snapshotLista(FOTOS_COLA_RETIRADAS),
      accion: a && a.abierto && conf ? {
        tipo: a.tipo,
        titulo: conf.titulo,
        texto: conf.texto,
        extra: a.tipo === 'REPONER' && item && item.pendienteBorrado ? FOTOS_COLA_AVISO_BORRADO_REPONER : '',
        boton: a.enviando ? conf.enviando : conf.boton,
        entidad: item ? item.entidad : '',
        enviando: a.enviando,
        puedeEnviar: a.puedeEnviar,
        error: a.error
      } : null
    };
  }

  function cambio() {
    if (deps.onCambio) {
      deps.onCambio(snapshot());
    }
  }

  function avisar(texto, error) {
    s.aviso = { texto: texto || '', error: error === true };
  }

  function sesionVencida() {
    if (deps.onSesionExpirada) {
      deps.onSesionExpirada();
    }
  }

  // --- carga de listas ---

  function consultar(p, cursor) {
    var ctx = contexto();
    return new Promise(function (resolver) {
      resolver(deps.consultar(p, ctx.sessionToken, FOTOS_COLA_LIMITE, cursor));
    });
  }

  function falloCarga(l, code, esMas) {
    var mensaje = fotosModeracionColaLogic_mensajeCarga(code);
    if (esMas) {
      l.errorMas = code === 'PERMISSION_DENIED' ? mensaje : FOTOS_COLA_MENSAJE_ERROR_MAS;
    } else {
      l.error = { code: code, mensaje: mensaje };
    }
  }

  // La pagina de una respuesta OK, o null si no se puede leer (una respuesta rara nunca deja la lista "cargando" para siempre).
  function paginaSegura(p, resp, lista) {
    try {
      return resp && resp.status === 'ok' ? fotosModeracionColaLogic_vistaPagina(p, resp.data, lista.vistas, lista.removidos) : null;
    } catch (err) {
      return null;
    }
  }

  // Primera pagina de una lista. Siempre parte de cero (items, vistas, removidos): nunca se muestra una lista vieja mientras se vuelve a pedir.
  function cargarPrimera(p) {
    var l = s.listas[p];
    l.token += 1;
    var mio = l.token;
    var gen = generacion;
    var ctx = contexto();
    var nueva = fotosModeracionColaLogic_listaVacia();
    nueva.token = l.token;
    s.listas[p] = nueva;
    l = nueva;
    if (!fotosModeracionColaLogic_puedeVer(ctx.permisos)) {
      l.error = { code: 'PERMISSION_DENIED', mensaje: fotosModeracionColaLogic_mensajeCarga('PERMISSION_DENIED') };
      cambio();
      return Promise.resolve(snapshot());
    }
    l.cargando = true;
    cambio();
    return consultar(p, undefined).then(function (resp) {
      if (mio !== s.listas[p].token || gen !== generacion) {
        return snapshot();
      }
      var lista = s.listas[p];
      lista.cargando = false;
      var pagina = paginaSegura(p, resp, lista);
      if (pagina) {
        lista.items = pagina.items;
        lista.total = pagina.total;
        lista.hayMas = pagina.hayMas;
        lista.cursor = pagina.cursor;
        lista.cargada = true;
        cambio();
        return snapshot();
      }
      var code = resp && typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE';
      if (fotosModeracionLogic_esErrorDeSesion(code)) {
        cambio();
        sesionVencida();
        return snapshot();
      }
      falloCarga(lista, code, false);
      cambio();
      return snapshot();
    }, function () {
      if (mio !== s.listas[p].token || gen !== generacion) {
        return snapshot();
      }
      s.listas[p].cargando = false;
      falloCarga(s.listas[p], 'RED', false);
      cambio();
      return snapshot();
    });
  }

  function cargarMas(p) {
    var l = s.listas[p];
    if (!l.hayMas || l.cargando || l.cargandoMas || l.cursor === null) {
      return Promise.resolve(snapshot());
    }
    var ctx = contexto();
    if (!fotosModeracionColaLogic_puedeVer(ctx.permisos)) {
      falloCarga(l, 'PERMISSION_DENIED', true);
      cambio();
      return Promise.resolve(snapshot());
    }
    l.token += 1;
    var mio = l.token;
    var gen = generacion;
    l.cargandoMas = true;
    l.errorMas = null;
    cambio();
    return consultar(p, l.cursor).then(function (resp) {
      if (mio !== s.listas[p].token || gen !== generacion) {
        return snapshot();
      }
      var lista = s.listas[p];
      lista.cargandoMas = false;
      var pagina = paginaSegura(p, resp, lista);
      if (pagina) {
        lista.items = lista.items.concat(pagina.items);
        lista.total = pagina.total === null ? lista.total : pagina.total;
        lista.hayMas = pagina.hayMas;
        lista.cursor = pagina.cursor;
        cambio();
        return snapshot();
      }
      var code = resp && typeof resp.code === 'string' && resp.code !== '' ? resp.code : 'SERVICE_UNAVAILABLE';
      if (fotosModeracionLogic_esErrorDeSesion(code)) {
        cambio();
        sesionVencida();
        return snapshot();
      }
      falloCarga(lista, code, true);
      cambio();
      return snapshot();
    }, function () {
      if (mio !== s.listas[p].token || gen !== generacion) {
        return snapshot();
      }
      s.listas[p].cargandoMas = false;
      falloCarga(s.listas[p], 'RED', true);
      cambio();
      return snapshot();
    });
  }

  // --- acciones ---

  function marcarParaRecargar(p) {
    var l = s.listas[p];
    l.token += 1;            // lo que este en vuelo ya no vale
    l.cargada = false;
    l.cargando = false;
    l.cargandoMas = false;
  }

  function quitar(p, clave) {
    var l = s.listas[p];
    l.removidos[clave] = true;
    var antes = l.items.length;
    l.items = l.items.filter(function (it) { return it.clave !== clave; });
    if (l.items.length < antes && l.total !== null) {
      l.total = Math.max(0, l.total - 1);
    }
    return l;
  }

  function alExito(info) {
    var propia = info.tipo === 'REPONER' ? FOTOS_COLA_RETIRADAS : FOTOS_COLA_PENDIENTES;
    var clave = info.tipo === 'REPONER' ? fotosModeracionLogic_idNormalizado(info.fotoId) : fotosModeracionLogic_idNormalizado(info.foto && info.foto.solicitudId);
    var l = quitar(propia, clave);
    if (info.tipo === 'APROBAR') {
      marcarParaRecargar(FOTOS_COLA_RETIRADAS);        // la foto aprobada pasa a Retiradas
    }
    avisar(FOTOS_COLA_MENSAJE_EXITO[info.tipo], false);
    if (l.items.length === 0 && l.hayMas) {
      cargarPrimera(propia);                           // quedo vacia la pagina pero hay mas: se vuelve a pedir
    } else {
      cambio();
    }
    if (info.tipo !== 'RECHAZAR' && deps.onVisibilidadCambio) {
      deps.onVisibilidadCambio({ tipo: info.tipo, fotoId: info.fotoId });
    }
  }

  function alEstadoCambiado(info) {
    var propia = info.tipo === 'REPONER' ? FOTOS_COLA_RETIRADAS : FOTOS_COLA_PENDIENTES;
    avisar(fotosModeracionColaLogic_mensajeCambioEstado(info.tipo, info.code), true);
    marcarParaRecargar(info.tipo === 'REPONER' ? FOTOS_COLA_PENDIENTES : FOTOS_COLA_RETIRADAS);
    cargarPrimera(propia);
  }

  accion = fotosModeracionLogic_crearAccion({
    obtenerContexto: deps.obtenerContexto,
    generarId: deps.generarId,
    enviar: function (tipo, sessionToken, datos, clientRequestId) { return deps.enviar(tipo, sessionToken, datos, clientRequestId); },
    onCambio: cambio,
    onExito: alExito,
    onEstadoCambiado: alEstadoCambiado,
    onSesionExpirada: sesionVencida
  });

  // --- API ---

  function pestanaActual() {
    return s.listas[s.pestana];
  }

  return {
    // Abre la pantalla en Pendientes. false (y no se pide nada) sin fotos + fotos_moderar.
    abrir: function () {
      generacion += 1;
      accion.descartar();
      FOTOS_COLA_PESTANAS.forEach(function (p) { s.listas[p] = fotosModeracionColaLogic_listaVacia(); });
      s.aviso = { texto: '', error: false };
      s.pestana = FOTOS_COLA_PENDIENTES;
      if (!fotosModeracionColaLogic_puedeVer(contexto().permisos)) {
        s.abierta = false;
        cambio();
        return Promise.resolve(false);
      }
      s.abierta = true;
      return cargarPrimera(FOTOS_COLA_PENDIENTES).then(function () { return true; });
    },
    // Cambia de pestaña; si esa lista no esta cargada (nunca, o se marco para recargar) pide su primera pagina. Una lista ya cargada se muestra tal cual.
    seleccionarPestana: function (p) {
      if (!s.abierta || !fotosModeracionColaLogic_esPestana(p)) {
        return Promise.resolve(snapshot());
      }
      s.pestana = p;
      var l = s.listas[p];
      if (!l.cargada && !l.cargando) {
        return cargarPrimera(p);
      }
      cambio();
      return Promise.resolve(snapshot());
    },
    // Reintentar / Actualizar: vuelve a pedir la primera pagina de la pestaña actual.
    recargar: function () {
      if (!s.abierta) {
        return Promise.resolve(snapshot());
      }
      avisar('', false);
      return cargarPrimera(s.pestana);
    },
    // Vuelve a pedir la primera pagina de la pestaña actual y deja un aviso (p. ej. tras reponer o ver que el estado cambio desde el dialogo de historial).
    actualizarConAviso: function (texto, error) {
      if (!s.abierta) {
        return Promise.resolve(snapshot());
      }
      avisar(texto, error === true);
      return cargarPrimera(s.pestana);
    },
    verMas: function () {
      if (!s.abierta) {
        return Promise.resolve(snapshot());
      }
      return cargarMas(s.pestana);
    },
    // Abre la confirmacion de una accion sobre un item de la pestaña actual. APROBAR / RECHAZAR solo en Pendientes; REPONER solo en Retiradas. false si no corresponde o no hay permiso.
    pedirAccion: function (tipo, clave) {
      if (!s.abierta || accion.estado().abierto) {
        return false;
      }
      var esperada = tipo === 'REPONER' ? FOTOS_COLA_RETIRADAS : ((tipo === 'APROBAR' || tipo === 'RECHAZAR') ? FOTOS_COLA_PENDIENTES : null);
      if (esperada === null || s.pestana !== esperada) {
        return false;
      }
      var item = null;
      pestanaActual().items.forEach(function (it) { if (it.clave === clave) { item = it; } });
      if (item === null) {
        return false;
      }
      var abrio = accion.abrir(tipo, { fotoId: item.fotoId, solicitudId: item.solicitudId, clave: item.clave });
      avisar('', false);
      cambio();
      return abrio;
    },
    confirmar: function () { return accion.guardar().then(snapshot); },
    cancelarAccion: function () { return accion.cancelar(); },
    // Cierre de la pantalla o de la sesion: se descarta TODO (respuestas en vuelo incluidas).
    cerrar: function () {
      generacion += 1;
      accion.descartar();
      FOTOS_COLA_PESTANAS.forEach(function (p) { s.listas[p] = fotosModeracionColaLogic_listaVacia(); });
      s.abierta = false;
      s.pestana = FOTOS_COLA_PENDIENTES;
      s.aviso = { texto: '', error: false };
      cambio();
    },
    estado: snapshot,
    // el item completo (vista) de la pestaña actual, para "Abrir foto" e "Historial"
    item: function (clave) {
      var r = null;
      pestanaActual().items.forEach(function (it) { if (it.clave === clave) { r = it; } });
      return r;
    }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FOTOS_COLA_PENDIENTES,
    FOTOS_COLA_RETIRADAS,
    FOTOS_COLA_PESTANAS,
    FOTOS_COLA_ETIQUETAS_PESTANA,
    FOTOS_COLA_LIMITE,
    FOTOS_COLA_MINIATURAS_PARALELAS,
    FOTOS_COLA_TITULO,
    FOTOS_COLA_SUBTITULO,
    FOTOS_COLA_VACIO,
    FOTOS_COLA_MENSAJE_ERROR,
    FOTOS_COLA_MENSAJE_ERROR_MAS,
    FOTOS_COLA_MENSAJE_RESUELTA,
    FOTOS_COLA_MENSAJE_FOTO_NO_DISPONIBLE,
    FOTOS_COLA_MENSAJE_ESTADO_CAMBIO,
    FOTOS_COLA_MENSAJE_EXITO,
    FOTOS_COLA_MENSAJE_SIN_VISTA_PREVIA,
    FOTOS_COLA_AVISO_BORRADO_REPONER,
    FOTOS_COLA_CONFIRMACIONES,
    fotosModeracionColaLogic_puedeVer,
    fotosModeracionColaLogic_esPestana,
    fotosModeracionColaLogic_pestanaPorTecla,
    fotosModeracionColaLogic_etiquetaEntidad,
    fotosModeracionColaLogic_nombre,
    fotosModeracionColaLogic_vistaFoto,
    fotosModeracionColaLogic_vistaPendiente,
    fotosModeracionColaLogic_vistaRetirada,
    fotosModeracionColaLogic_vistaPagina,
    fotosModeracionColaLogic_textoTotal,
    fotosModeracionColaLogic_mensajeCarga,
    fotosModeracionColaLogic_mensajeCambioEstado,
    fotosModeracionColaLogic_crearColaMiniaturas,
    fotosModeracionColaLogic_crear
  };
}
