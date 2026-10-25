// Cargador de datos de la "Linea de tiempo del pozo" (E6-2). SIN DOM: consulta las fuentes permitidas, las normaliza con js/lineaTiempoPozoLogic.js y devuelve UN resultado agregado con el
// estado de cada fuente. No renderiza nada, no guarda nada (ni localStorage, ni Sheet, ni analytics, ni console) y no toca el backend: usa los wrappers de lectura que ya existen en js/api.js
// (apiGetCorreccionesUbicacionPozo, apiGetDecisionesFuentesPozo, apiGetHistorialReemplazo, apiGetObservacionesPozo). Se prueba con Jest (js/lineaTiempoPozoLoader.test.js).
//
// FUENTES Y PERMISOS (cada una solo si su permiso es exactamente `true`; sin permiso NO se hace ningun request):
//   ubicacion       <- DOS lecturas independientes: correcciones y decisiones sobre fuentes.
//   reemplazo       <- una lectura (historial).
//   observaciones   <- lecturas paginadas por cursor (limit 100, siguiente pagina con antesDeSecuencia = cursor).
//   Fotos no esta (ver docs/linea-tiempo-pozo.md).
//
// PARALELISMO: las tres lecturas iniciales independientes (correcciones, decisiones, reemplazo) y la primera pagina de observaciones se inician en el mismo instante, sin esperarse. Solo las
// paginas de observaciones siguientes son secuenciales (cada cursor sale de la pagina anterior). La duracion total es la de la fuente mas lenta, no la suma.
//
// ESTADOS POR FUENTE: OK | VACIA | SIN_PERMISO | ERROR | PARCIAL | NO_CARGADA.
//   OK: la lectura fue valida y hay eventos. VACIA: fue valida y no hay eventos (los eventos omitidos por el modelo quedan en `omitidos`, como diagnostico: no cambian el estado).
//   ERROR: no se pudo obtener o interpretar la fuente. PARCIAL: hay datos utiles pero faltan otros (ver `motivoParcial`). SIN_PERMISO: no se pidio nada.
//   Ubicacion combina sus dos lecturas: ambas ERROR -> ERROR; una ERROR -> PARCIAL (motivoParcial SUBFUENTE_CORRECCIONES / SUBFUENTE_DECISIONES); ambas VACIA -> VACIA; si no, OK.
//   WELL_NOT_FOUND de decisiones (pozo fuera del padron) NO es un fallo: esa subfuente no tiene decisiones (VACIA).
//   Observaciones: PARCIAL si la paginacion se corto con datos ya cargados. motivoParcial: LIMIT_REACHED (tope de 5 paginas / 500 observaciones con hayMas), CURSOR_INVALIDO, CURSOR_REPETIDO,
//   CURSOR_NO_AVANZA, ERROR_PAGINA (fallo de una pagina posterior), RESPUESTA_INVALIDA (pagina posterior mal formada) o CANCELADA (empezo otra carga). Si falla la PRIMERA pagina -> ERROR.
//
// COMPLETA / PARCIAL GLOBAL (sobre las fuentes permitidas, es decir, todas las que no son SIN_PERMISO):
//   completa = hay al menos una fuente permitida y todas terminaron OK o VACIA. Sin ninguna fuente permitida, completa=false (no se cargo nada).
//   parcial  = alguna fuente permitida quedo ERROR/PARCIAL Y alguna fuente permitida dio datos utiles (OK, VACIA o PARCIAL). Si todas las permitidas fallan: parcial=false y completa=false.
//
// ERRORES DE SESION: UNAUTHORIZED / USER_DISABLED no son un fallo de fuente. Se propagan en `resultado.auth` (y en el callback opcional `onSesionExpirada(code)`), se corta lo pendiente y el
// resultado queda sin eventos: la pantalla debe usar el cierre de sesion de siempre.
//
// RESPUESTAS VIEJAS: cada llamada a `cargar` abre una generacion nueva. `esVigente(resultado)` dice si ese resultado sigue siendo el de la ultima carga; una carga desplazada deja de pedir
// paginas. `cancelar()` invalida lo que este en vuelo (por ejemplo al salir de la pantalla). El resultado de una carga vieja NO debe aplicarse.
//
// BEST-EFFORT: son varias llamadas separadas, no un snapshot. Si durante la carga se agrega o se anula una observacion, la paginacion puede repetir o saltear elementos; el modelo (deduplicar
// por id con avance de estado) evita que una ANULADA vuelva a verse ACTIVA, pero no se intenta una lectura transaccional ni se toma ningun lock.
//
// PRIVACIDAD: lo unico que sale es el resultado normalizado por el modelo (lista blanca) y contadores / codigos. La respuesta cruda se descarta apenas se normaliza: no se conservan emails,
// clientRequestId, secuencias, el sessionToken, payloads ni el texto de una observacion anulada. Los codigos de error se sanean (solo MAYUSCULAS_Y_GUION).
//
// Dependencias de carga: lineaTiempoPozoLogic.js y js/api.js antes que este archivo (en los tests se inyectan con `deps`).

var LINEA_TIEMPO_CARGA_LIMITE_PAGINA = 100;
var LINEA_TIEMPO_CARGA_MAX_PAGINAS = 5;
var LINEA_TIEMPO_CARGA_MAX_OBSERVACIONES = 500;
var LINEA_TIEMPO_CARGA_ESTADOS = { OK: 'OK', VACIA: 'VACIA', SIN_PERMISO: 'SIN_PERMISO', ERROR: 'ERROR', PARCIAL: 'PARCIAL', NO_CARGADA: 'NO_CARGADA' };
var LINEA_TIEMPO_CARGA_REGEX_WELL_ID = /^\d{2}-\d{4}$/;
var LINEA_TIEMPO_CARGA_REGEX_CODIGO = /^[A-Z][A-Z0-9_]{0,39}$/;

// --- dependencias por defecto (se resuelven al cargar, no al definir el archivo) ---

function lineaTiempoPozoLoader_apiPorDefecto() {
  return {
    correcciones: typeof apiGetCorreccionesUbicacionPozo === 'function' ? apiGetCorreccionesUbicacionPozo : null,
    decisiones: typeof apiGetDecisionesFuentesPozo === 'function' ? apiGetDecisionesFuentesPozo : null,
    reemplazo: typeof apiGetHistorialReemplazo === 'function' ? apiGetHistorialReemplazo : null,
    observaciones: typeof apiGetObservacionesPozo === 'function' ? apiGetObservacionesPozo : null
  };
}

// El modelo se recibe como "espacio de nombres" con los nombres de lineaTiempoPozoLogic.js (en el navegador son globales; en los tests, el module.exports del archivo).
function lineaTiempoPozoLoader_espacioGlobal() {
  return {
    LINEA_TIEMPO_FUENTES: typeof LINEA_TIEMPO_FUENTES !== 'undefined' ? LINEA_TIEMPO_FUENTES : null,
    lineaTiempoPozoLogic_puedeVerLineaTiempo: typeof lineaTiempoPozoLogic_puedeVerLineaTiempo === 'function' ? lineaTiempoPozoLogic_puedeVerLineaTiempo : null,
    lineaTiempoPozoLogic_normalizarCorrecciones: typeof lineaTiempoPozoLogic_normalizarCorrecciones === 'function' ? lineaTiempoPozoLogic_normalizarCorrecciones : null,
    lineaTiempoPozoLogic_normalizarDecisiones: typeof lineaTiempoPozoLogic_normalizarDecisiones === 'function' ? lineaTiempoPozoLogic_normalizarDecisiones : null,
    lineaTiempoPozoLogic_normalizarReemplazo: typeof lineaTiempoPozoLogic_normalizarReemplazo === 'function' ? lineaTiempoPozoLogic_normalizarReemplazo : null,
    lineaTiempoPozoLogic_normalizarObservaciones: typeof lineaTiempoPozoLogic_normalizarObservaciones === 'function' ? lineaTiempoPozoLogic_normalizarObservaciones : null,
    lineaTiempoPozoLogic_deduplicar: typeof lineaTiempoPozoLogic_deduplicar === 'function' ? lineaTiempoPozoLogic_deduplicar : null,
    lineaTiempoPozoLogic_ordenar: typeof lineaTiempoPozoLogic_ordenar === 'function' ? lineaTiempoPozoLogic_ordenar : null,
    lineaTiempoPozoLogic_filtrarPorFuente: typeof lineaTiempoPozoLogic_filtrarPorFuente === 'function' ? lineaTiempoPozoLogic_filtrarPorFuente : null
  };
}

function lineaTiempoPozoLoader_logicaDe(ns) {
  return {
    FUENTES: ns.LINEA_TIEMPO_FUENTES,
    puedeVerLineaTiempo: ns.lineaTiempoPozoLogic_puedeVerLineaTiempo,
    normalizarCorrecciones: ns.lineaTiempoPozoLogic_normalizarCorrecciones,
    normalizarDecisiones: ns.lineaTiempoPozoLogic_normalizarDecisiones,
    normalizarReemplazo: ns.lineaTiempoPozoLogic_normalizarReemplazo,
    normalizarObservaciones: ns.lineaTiempoPozoLogic_normalizarObservaciones,
    deduplicar: ns.lineaTiempoPozoLogic_deduplicar,
    ordenar: ns.lineaTiempoPozoLogic_ordenar,
    filtrarPorFuente: ns.lineaTiempoPozoLogic_filtrarPorFuente
  };
}

function lineaTiempoPozoLoader_relojPorDefecto() {
  return typeof performance !== 'undefined' && performance && typeof performance.now === 'function' ? performance.now() : new Date().getTime();
}

// --- clasificacion de respuestas ---

function lineaTiempoPozoLoader_codigoSeguro(codigo) {
  return typeof codigo === 'string' && LINEA_TIEMPO_CARGA_REGEX_CODIGO.test(codigo) ? codigo : 'ERROR_DESCONOCIDO';
}

// Una respuesta del backend -> {tipo: 'OK', data} | 'AUTH' | 'SIN_PERMISO' | 'NO_ENCONTRADO' | 'ERROR' | 'RED' | 'INVALIDA'. Nunca lanza.
function lineaTiempoPozoLoader_clasificar(respuesta) {
  if (respuesta === null || typeof respuesta !== 'object' || typeof respuesta.status !== 'string') {
    return { tipo: 'INVALIDA' };
  }
  if (respuesta.status === 'ok') {
    return { tipo: 'OK', data: respuesta.data };
  }
  if (respuesta.status !== 'error') {
    return { tipo: 'INVALIDA' };
  }
  if (respuesta.code === 'UNAUTHORIZED' || respuesta.code === 'USER_DISABLED') {
    return { tipo: 'AUTH', code: respuesta.code };
  }
  if (respuesta.code === 'PERMISSION_DENIED') {
    return { tipo: 'SIN_PERMISO' };
  }
  if (respuesta.code === 'WELL_NOT_FOUND') {
    return { tipo: 'NO_ENCONTRADO' };
  }
  return { tipo: 'ERROR', codigo: lineaTiempoPozoLoader_codigoSeguro(respuesta.code) };
}

// Llama a una lectura y devuelve SIEMPRE una promesa que se resuelve con la clasificacion (un throw sincrono, un rechazo o una respuesta rara son 'RED' / 'INVALIDA').
function lineaTiempoPozoLoader_pedir(lectura, argumentos) {
  var promesa;
  try {
    promesa = Promise.resolve(lectura.apply(null, argumentos));
  } catch (err) {
    return Promise.resolve({ tipo: 'RED' });
  }
  return promesa.then(lineaTiempoPozoLoader_clasificar, function () { return { tipo: 'RED' }; });
}

function lineaTiempoPozoLoader_codigoDeFallo(clasificacion) {
  if (clasificacion.tipo === 'RED') { return 'RED'; }
  if (clasificacion.tipo === 'ERROR') { return clasificacion.codigo; }
  if (clasificacion.tipo === 'NO_ENCONTRADO') { return 'WELL_NOT_FOUND'; }
  if (clasificacion.tipo === 'SIN_PERMISO') { return 'PERMISSION_DENIED'; }
  return 'RESPUESTA_INVALIDA';
}

// Resultado de UNA lectura: {estado, eventos, omitidos, codigoError, duracionMs}
function lineaTiempoPozoLoader_lectura(estado, eventos, omitidos, codigoError) {
  return { estado: estado, eventos: eventos || [], omitidos: omitidos || [], codigoError: codigoError || null, duracionMs: 0 };
}

// Lectura simple (correcciones, decisiones, reemplazo): clasificacion + normalizador del modelo -> lectura. `vacioSiNoEncontrado`: solo decisiones.
function lineaTiempoPozoLoader_lecturaDe(clasificacion, normalizar, wellId, vacioSiNoEncontrado) {
  if (clasificacion.tipo === 'OK') {
    var r = normalizar(clasificacion.data, wellId);
    if (!r || r.ok !== true) {
      return lineaTiempoPozoLoader_lectura(LINEA_TIEMPO_CARGA_ESTADOS.ERROR, [], [], 'RESPUESTA_INVALIDA');
    }
    return lineaTiempoPozoLoader_lectura(r.eventos.length > 0 ? LINEA_TIEMPO_CARGA_ESTADOS.OK : LINEA_TIEMPO_CARGA_ESTADOS.VACIA, r.eventos, r.omitidos, null);
  }
  if (clasificacion.tipo === 'NO_ENCONTRADO' && vacioSiNoEncontrado === true) {
    return lineaTiempoPozoLoader_lectura(LINEA_TIEMPO_CARGA_ESTADOS.VACIA, [], [], null);
  }
  if (clasificacion.tipo === 'SIN_PERMISO') {
    return lineaTiempoPozoLoader_lectura(LINEA_TIEMPO_CARGA_ESTADOS.SIN_PERMISO, [], [], 'PERMISSION_DENIED');
  }
  if (clasificacion.tipo === 'AUTH') {
    return lineaTiempoPozoLoader_lectura(LINEA_TIEMPO_CARGA_ESTADOS.NO_CARGADA, [], [], null);
  }
  return lineaTiempoPozoLoader_lectura(LINEA_TIEMPO_CARGA_ESTADOS.ERROR, [], [], lineaTiempoPozoLoader_codigoDeFallo(clasificacion));
}

// Suma listas de omitidos [{codigo, cantidad}] en una sola, ordenada por codigo.
function lineaTiempoPozoLoader_sumarOmitidos(listas) {
  var cuenta = {};
  listas.forEach(function (lista) {
    (lista || []).forEach(function (o) { cuenta[o.codigo] = (cuenta[o.codigo] || 0) + o.cantidad; });
  });
  return Object.keys(cuenta).sort().map(function (c) { return { codigo: c, cantidad: cuenta[c] }; });
}

// Cursor valido segun el contrato: entero >= 1. La igualdad estricta con Math.floor descarta strings, booleanos, null y NaN; isFinite descarta Infinity.
function lineaTiempoPozoLoader_cursorValido(cursor) {
  return isFinite(cursor) && Math.floor(cursor) === cursor && cursor >= 1;
}

// Combina las dos lecturas de Ubicacion en el estado de la fuente.
function lineaTiempoPozoLoader_combinarUbicacion(correcciones, decisiones) {
  var E = LINEA_TIEMPO_CARGA_ESTADOS;
  var eventos = correcciones.eventos.concat(decisiones.eventos);
  var omitidos = lineaTiempoPozoLoader_sumarOmitidos([correcciones.omitidos, decisiones.omitidos]);
  if (correcciones.estado === E.SIN_PERMISO && decisiones.estado === E.SIN_PERMISO) {
    return { estado: E.SIN_PERMISO, eventos: [], omitidos: [], motivoParcial: null, codigoError: 'PERMISSION_DENIED' };
  }
  var cFalla = correcciones.estado === E.ERROR || correcciones.estado === E.SIN_PERMISO || correcciones.estado === E.NO_CARGADA;
  var dFalla = decisiones.estado === E.ERROR || decisiones.estado === E.SIN_PERMISO || decisiones.estado === E.NO_CARGADA;
  if (cFalla && dFalla) {
    return { estado: E.ERROR, eventos: [], omitidos: omitidos, motivoParcial: null, codigoError: correcciones.codigoError || decisiones.codigoError };
  }
  if (cFalla || dFalla) {
    return { estado: E.PARCIAL, eventos: eventos, omitidos: omitidos, motivoParcial: cFalla ? 'SUBFUENTE_CORRECCIONES' : 'SUBFUENTE_DECISIONES', codigoError: cFalla ? correcciones.codigoError : decisiones.codigoError };
  }
  return { estado: eventos.length > 0 ? E.OK : E.VACIA, eventos: eventos, omitidos: omitidos, motivoParcial: null, codigoError: null };
}

// --- el cargador ---

// deps (todo opcional; por defecto se usan los wrappers globales de js/api.js, el modelo global y performance.now):
//   api: {correcciones, decisiones, reemplazo, observaciones}   funciones (sessionToken, wellId[, limit, antesDeSecuencia]) -> promesa de la respuesta del backend
//   logica: el modelo, con los nombres de lineaTiempoPozoLogic.js   ahora: () => milisegundos (reloj inyectable)
//   onSesionExpirada(code): se llama una vez por carga vigente cuando el backend responde UNAUTHORIZED / USER_DISABLED
// Devuelve {cargar(sessionToken, wellId, permisos) -> Promise<resultado>, esVigente(resultado), cancelar(), generacionActual()}. La promesa de `cargar` nunca se rechaza.
function lineaTiempoPozoLoader_crear(deps) {
  var d = deps || {};
  var E = LINEA_TIEMPO_CARGA_ESTADOS;
  var api = d.api || lineaTiempoPozoLoader_apiPorDefecto();
  var L = lineaTiempoPozoLoader_logicaDe(d.logica || lineaTiempoPozoLoader_espacioGlobal());
  var ahora = typeof d.ahora === 'function' ? d.ahora : lineaTiempoPozoLoader_relojPorDefecto;
  var generacion = 0;

  function fuenteSinPermiso() {
    return { estado: E.SIN_PERMISO, cantidadEventos: 0, omitidos: [], duracionMs: 0, motivoParcial: null, codigoError: null };
  }

  function resultadoSinCarga(wellId, mi, permisos, auth, puedeVer, codigoError) {
    var fuentes = {
      ubicacion: fuenteSinPermiso(),
      reemplazo: fuenteSinPermiso(),
      observaciones: fuenteSinPermiso()
    };
    fuentes.ubicacion.partes = { correcciones: { estado: E.SIN_PERMISO, duracionMs: 0, codigoError: null }, decisiones: { estado: E.SIN_PERMISO, duracionMs: 0, codigoError: null } };
    fuentes.observaciones.paginas = 0;
    fuentes.observaciones.cargadas = 0;
    var claves = { ubicacion: permisos.ubicacion === true, reemplazo: permisos.reemplazo === true, observaciones: permisos.observaciones === true };
    Object.keys(claves).forEach(function (k) {
      if (claves[k]) {
        fuentes[k].estado = codigoError ? E.ERROR : E.NO_CARGADA;
        fuentes[k].codigoError = codigoError || null;
        if (k === 'ubicacion') {
          fuentes.ubicacion.partes.correcciones.estado = fuentes[k].estado;
          fuentes.ubicacion.partes.decisiones.estado = fuentes[k].estado;
        }
      }
    });
    return { wellId: typeof wellId === 'string' ? wellId : null, generacion: mi, puedeVer: puedeVer, auth: auth, eventos: [], fuentes: fuentes, completa: false, parcial: false, duracionMs: 0 };
  }

  function cargar(sessionToken, wellId, permisos) {
    generacion += 1;
    var mi = generacion;
    var p = permisos !== null && typeof permisos === 'object' ? permisos : {};
    var puedeVer = L.puedeVerLineaTiempo(p) === true;
    var quiere = { ubicacion: p.ubicacion === true, reemplazo: p.reemplazo === true, observaciones: p.observaciones === true };

    if (!puedeVer) {
      return Promise.resolve(resultadoSinCarga(wellId, mi, p, null, false, null));
    }
    if (typeof sessionToken !== 'string' || sessionToken === '' || typeof wellId !== 'string' || !LINEA_TIEMPO_CARGA_REGEX_WELL_ID.test(wellId)) {
      return Promise.resolve(resultadoSinCarga(wellId, mi, p, null, true, 'PARAMETROS_INVALIDOS'));
    }

    var inicio = ahora();
    var auth = null;
    var avisoAuth = false;
    function vigente() { return mi === generacion && auth === null; }
    function registrarAuth(clasificacion) {
      if (clasificacion.tipo !== 'AUTH') {
        return;
      }
      if (auth === null || clasificacion.code === 'USER_DISABLED') {
        auth = clasificacion.code;
      }
      if (!avisoAuth && mi === generacion && typeof d.onSesionExpirada === 'function') {
        avisoAuth = true;
        d.onSesionExpirada(auth);
      }
    }
    function conDuracion(lectura) {
      lectura.duracionMs = Math.max(0, Math.round(ahora() - inicio));
      return lectura;
    }
    function leerSimple(lectura, normalizar, vacioSiNoEncontrado) {
      return lineaTiempoPozoLoader_pedir(lectura, [sessionToken, wellId]).then(function (c) {
        registrarAuth(c);
        return conDuracion(lineaTiempoPozoLoader_lecturaDe(c, normalizar, wellId, vacioSiNoEncontrado));
      });
    }

    // Observaciones: paginas secuenciales por cursor, con tope y cortes fail-safe. Lo cargado se conserva siempre.
    function leerObservaciones() {
      var paginas = 0;
      var cargadas = 0;
      var items = [];
      var cursoresPedidos = [];
      var ultimoCursor = null;
      function cerrar(motivoParcial, codigoError) {
        var r = L.normalizarObservaciones({ wellId: wellId, observaciones: items }, wellId);
        var lectura = lineaTiempoPozoLoader_lectura(E.OK, r.eventos, r.omitidos, codigoError);
        lectura.estado = motivoParcial ? E.PARCIAL : (r.eventos.length > 0 ? E.OK : E.VACIA);
        lectura.motivoParcial = motivoParcial || null;
        lectura.paginas = paginas;
        lectura.cargadas = cargadas;
        items = [];
        return conDuracion(lectura);
      }
      function fallar(estado, codigoError) {
        var lectura = lineaTiempoPozoLoader_lectura(estado, [], [], codigoError);
        lectura.paginas = paginas;
        lectura.cargadas = cargadas;
        return conDuracion(lectura);
      }
      function pagina(cursor) {
        if (!vigente()) {
          return Promise.resolve(paginas === 0 ? fallar(E.NO_CARGADA, null) : cerrar('CANCELADA', null));
        }
        return lineaTiempoPozoLoader_pedir(api.observaciones, [sessionToken, wellId, LINEA_TIEMPO_CARGA_LIMITE_PAGINA, cursor]).then(function (c) {
          registrarAuth(c);
          if (c.tipo === 'AUTH') {
            return fallar(E.NO_CARGADA, null);
          }
          var datos = c.tipo === 'OK' ? c.data : null;
          var valida = datos !== null && typeof datos === 'object' && Array.isArray(datos.observaciones) && typeof datos.hayMas === 'boolean' && datos.wellId === wellId;
          if (c.tipo !== 'OK' || !valida) {
            var codigo = c.tipo === 'OK' ? 'RESPUESTA_INVALIDA' : lineaTiempoPozoLoader_codigoDeFallo(c);
            if (paginas === 0) {
              return fallar(c.tipo === 'SIN_PERMISO' ? E.SIN_PERMISO : E.ERROR, codigo);
            }
            return cerrar(c.tipo === 'OK' ? 'RESPUESTA_INVALIDA' : 'ERROR_PAGINA', codigo);
          }
          paginas += 1;
          cargadas += datos.observaciones.length;
          items = items.concat(datos.observaciones);
          if (datos.hayMas !== true) {
            return cerrar(null, null);
          }
          if (paginas >= LINEA_TIEMPO_CARGA_MAX_PAGINAS || cargadas >= LINEA_TIEMPO_CARGA_MAX_OBSERVACIONES) {
            return cerrar('LIMIT_REACHED', null);
          }
          var siguiente = datos.cursor;
          if (!lineaTiempoPozoLoader_cursorValido(siguiente)) {
            return cerrar('CURSOR_INVALIDO', null);
          }
          if (cursoresPedidos.indexOf(siguiente) !== -1) {
            return cerrar('CURSOR_REPETIDO', null);
          }
          if (ultimoCursor !== null && siguiente > ultimoCursor) {          // (igual al anterior ya lo cubrio CURSOR_REPETIDO)
            return cerrar('CURSOR_NO_AVANZA', null);
          }
          cursoresPedidos.push(siguiente);
          ultimoCursor = siguiente;
          return pagina(siguiente);
        });
      }
      return pagina(undefined);
    }

    // Las lecturas independientes arrancan TODAS ahora, antes de esperar ninguna.
    var pCorrecciones = quiere.ubicacion ? leerSimple(api.correcciones, L.normalizarCorrecciones, false) : null;
    var pDecisiones = quiere.ubicacion ? leerSimple(api.decisiones, L.normalizarDecisiones, true) : null;
    var pReemplazo = quiere.reemplazo ? leerSimple(api.reemplazo, L.normalizarReemplazo, false) : null;
    var pObservaciones = quiere.observaciones ? leerObservaciones() : null;

    return Promise.all([pCorrecciones, pDecisiones, pReemplazo, pObservaciones]).then(function (r) {
      var correcciones = r[0];
      var decisiones = r[1];
      var reemplazo = r[2];
      var observaciones = r[3];
      if (auth !== null) {
        var cortado = resultadoSinCarga(wellId, mi, p, auth, true, null);
        cortado.duracionMs = Math.max(0, Math.round(ahora() - inicio));
        return cortado;
      }

      var fuentes = { ubicacion: fuenteSinPermiso(), reemplazo: fuenteSinPermiso(), observaciones: fuenteSinPermiso() };
      var todos = [];
      fuentes.ubicacion.partes = { correcciones: { estado: E.SIN_PERMISO, duracionMs: 0, codigoError: null }, decisiones: { estado: E.SIN_PERMISO, duracionMs: 0, codigoError: null } };
      fuentes.observaciones.paginas = 0;
      fuentes.observaciones.cargadas = 0;

      if (correcciones !== null) {
        var u = lineaTiempoPozoLoader_combinarUbicacion(correcciones, decisiones);
        fuentes.ubicacion = { estado: u.estado, cantidadEventos: 0, omitidos: u.omitidos, duracionMs: Math.max(correcciones.duracionMs, decisiones.duracionMs), motivoParcial: u.motivoParcial, codigoError: u.codigoError };
        fuentes.ubicacion.partes = {
          correcciones: { estado: correcciones.estado, duracionMs: correcciones.duracionMs, codigoError: correcciones.codigoError },
          decisiones: { estado: decisiones.estado, duracionMs: decisiones.duracionMs, codigoError: decisiones.codigoError }
        };
        u.eventos.forEach(function (e) { todos.push(e); });
      }
      if (reemplazo !== null) {
        fuentes.reemplazo = { estado: reemplazo.estado, cantidadEventos: 0, omitidos: reemplazo.omitidos, duracionMs: reemplazo.duracionMs, motivoParcial: null, codigoError: reemplazo.codigoError };
        reemplazo.eventos.forEach(function (e) { todos.push(e); });
      }
      if (observaciones !== null) {
        fuentes.observaciones = {
          estado: observaciones.estado, cantidadEventos: 0, omitidos: observaciones.omitidos, duracionMs: observaciones.duracionMs,
          motivoParcial: observaciones.motivoParcial || null, codigoError: observaciones.codigoError, paginas: observaciones.paginas, cargadas: observaciones.cargadas
        };
        observaciones.eventos.forEach(function (e) { todos.push(e); });
      }

      var eventos = L.ordenar(L.deduplicar(todos));
      fuentes.ubicacion.cantidadEventos = L.filtrarPorFuente(eventos, L.FUENTES.UBICACION).length;
      fuentes.reemplazo.cantidadEventos = L.filtrarPorFuente(eventos, L.FUENTES.REEMPLAZO).length;
      fuentes.observaciones.cantidadEventos = L.filtrarPorFuente(eventos, L.FUENTES.OBSERVACIONES).length;

      var permitidas = Object.keys(fuentes).filter(function (k) { return fuentes[k].estado !== E.SIN_PERMISO; }).map(function (k) { return fuentes[k].estado; });
      var completa = permitidas.length > 0 && permitidas.every(function (s) { return s === E.OK || s === E.VACIA; });
      var hayFalla = permitidas.some(function (s) { return s === E.ERROR || s === E.PARCIAL; });
      var hayUtil = permitidas.some(function (s) { return s === E.OK || s === E.VACIA || s === E.PARCIAL; });
      return {
        wellId: wellId, generacion: mi, puedeVer: true, auth: null, eventos: eventos, fuentes: fuentes,
        completa: completa, parcial: hayFalla && hayUtil, duracionMs: Math.max(0, Math.round(ahora() - inicio))
      };
    });
  }

  return {
    cargar: cargar,
    esVigente: function (resultado) { return !!resultado && typeof resultado === 'object' && resultado.generacion === generacion; },
    cancelar: function () { generacion += 1; },
    generacionActual: function () { return generacion; }
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LINEA_TIEMPO_CARGA_LIMITE_PAGINA,
    LINEA_TIEMPO_CARGA_MAX_PAGINAS,
    LINEA_TIEMPO_CARGA_MAX_OBSERVACIONES,
    LINEA_TIEMPO_CARGA_ESTADOS,
    lineaTiempoPozoLoader_clasificar,
    lineaTiempoPozoLoader_cursorValido,
    lineaTiempoPozoLoader_combinarUbicacion,
    lineaTiempoPozoLoader_crear
  };
}
