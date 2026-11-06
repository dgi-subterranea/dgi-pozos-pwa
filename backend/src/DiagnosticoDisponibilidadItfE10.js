// DiagnosticoDisponibilidadItfE10 (E10-1, validacion del fix del cold start de getItfAvailability): herramienta MANUAL que demuestra, en el runtime REAL de Apps Script y con EVIDENCIA DIRECTA, que la
// consulta de disponibilidad de UN solo pozo es un lookup directo: NO lee el indice (itf_leg_v2_* / itf_idx_*), NO lo reconstruye, NO recorre la carpeta THUMB y NO toma el ScriptLock.
//
//   diagnosticoDisponibilidadItfE10()   Se corre a mano desde el editor (sin parametros). Para cada pozo de DIAG_DISP_E10_POZOS llama al handler REAL (doPost, accion getItfAvailability, 1 wellId) con una
//                                       sesion creada en memoria para un usuario activo con perfil, y registra: duracion, forma de la respuesta (status / code / el booleano de disponibilidad), y los CONTADORES de
//                                       lo que NO debe pasar. Informa en el Logger (y devuelve) UN JSON.
//
// EVIDENCIA, independiente de si el indice esta caliente, frio o vencido (un contador de claves es mejor que mirar tiempos):
//   - cache OBSERVADA: durante cada consulta, CacheService se reemplaza por un envoltorio que delega TODO al cache real (mismo comportamiento) y solo CUENTA los accesos a claves de los indices
//     (itf_leg_v2_*, itf_idx_*, incluidas las banderas de reconstruccion). Una consulta individual correcta da 0 lecturas, 0 escrituras y 0 borrados de esas claves.
//   - recorrido de THUMB BLOQUEADO: driveProfileRepository_listarArchivosThumb se reemplaza por una funcion que CUENTA y LANZA (nunca devuelve una lista vacia: una reconstruccion que la usara no podria
//     escribir un indice vacio en el cache de produccion). Una consulta individual correcta da 0 llamadas.
//   - ScriptLock OBSERVADO: LockService se reemplaza por un envoltorio que delega y cuenta getScriptLock. Una consulta individual correcta da 0.
//   Todo se restaura SIEMPRE (finally) y se verifica que el reemplazo quedo instalado ANTES de llamar al handler; si no queda instalado no se llama a nada y se informa.
// ADEMAS informa, solo de lectura, el estado del indice antes de empezar (cuantos departamentos hay en cache y si hay una bandera de reconstruccion): sirve para saber si la corrida fue en frio o en caliente.
//
// EFECTOS: los del uso normal de getItfAvailability (el handler escribe una fila en Historial por consulta: durante la corrida logHistoryEvent se reemplaza por un contador y NO se escribe). No escribe hojas,
// no manda Telegram, no escribe Busquedas, no toca Script Properties ni triggers. No usa secretos y no imprime tokens, ids de Drive ni el email completo.
var DIAG_DISP_E10_VERSION = 1;
var DIAG_DISP_E10_POZOS = ['07-0001', '01-0005', '08-0003'];
var DIAG_DISP_E10_PATRON_INDICE = /^itf_(idx|leg_v2)_/;
var DIAG_DISP_E10_PREFIJOS = [{ nombre: 'indiceE9', prefijo: 'itf_leg_v2_', bandera: 'itf_leg_v2_rebuilding' }, { nombre: 'indiceAntiguo', prefijo: 'itf_idx_', bandera: 'itf_idx_rebuilding' }];

function diagDispE10_mascara(email) {
  var t = String(email || '').trim();
  var arroba = t.indexOf('@');
  return arroba < 1 ? '***' : t.charAt(0) + '***' + t.substring(arroba);
}

function diagDispE10_errorSeguro(err) {
  var mensaje = err && err.message !== undefined ? String(err.message) : String(err);
  mensaje = mensaje.replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9+\/=_-]{24,}/g, '[...]').substring(0, 160);
  return { tipo: err && err.name ? String(err.name).substring(0, 40) : 'Error', mensaje: mensaje };
}

// Estado del indice, solo lectura: por cada indice, cuantos de los 19 departamentos estan en cache y si hay bandera de reconstruccion.
function diagDispE10_estadoIndice() {
  var cache = CacheService.getScriptCache();
  var estado = {};
  DIAG_DISP_E10_PREFIJOS.forEach(function (p) {
    var presentes = 0;
    for (var d = 1; d <= 19; d++) {
      if (cache.get(p.prefijo + ('0' + d).slice(-2)) !== null) {
        presentes += 1;
      }
    }
    estado[p.nombre] = { departamentosEnCache: presentes, de: 19, banderaDeReconstruccion: cache.get(p.bandera) !== null };
  });
  return estado;
}

// Envoltorio del cache: delega TODO en el cache real y solo cuenta los accesos a claves de los indices.
function diagDispE10_envolverCache(real, registro) {
  function marcar(operacion, clave) {
    if (DIAG_DISP_E10_PATRON_INDICE.test(String(clave))) {
      registro.indice[operacion] = (registro.indice[operacion] || 0) + 1;
    }
  }
  return {
    get: function (k) { marcar('lecturas', k); return real.get(k); },
    getAll: function (ks) { (ks || []).forEach(function (k) { marcar('lecturas', k); }); return real.getAll(ks); },
    put: function (k, v, t) { marcar('escrituras', k); return t === undefined ? real.put(k, v) : real.put(k, v, t); },
    putAll: function (o, t) { Object.keys(o || {}).forEach(function (k) { marcar('escrituras', k); }); return t === undefined ? real.putAll(o) : real.putAll(o, t); },
    remove: function (k) { marcar('borrados', k); return real.remove(k); },
    removeAll: function (ks) { (ks || []).forEach(function (k) { marcar('borrados', k); }); return real.removeAll(ks); }
  };
}

// Instala los observadores, corre fn() y SIEMPRE restaura. Devuelve {instalado}.
function diagDispE10_observando(registro, fn) {
  var g = typeof globalThis !== 'undefined' ? globalThis : this;
  var originales = { CacheService: g.CacheService, LockService: g.LockService, listar: g.driveProfileRepository_listarArchivosThumb, historial: g.logHistoryEvent };
  var instalado = true;
  try {
    var cacheReal = originales.CacheService.getScriptCache();
    var envoltorio = diagDispE10_envolverCache(cacheReal, registro);
    g.CacheService = { getScriptCache: function () { return envoltorio; } };
    var lockReal = originales.LockService;
    g.LockService = {
      getScriptLock: function () { registro.locks += 1; return lockReal.getScriptLock(); },
      getUserLock: function () { registro.locks += 1; return lockReal.getUserLock(); },
      getDocumentLock: function () { registro.locks += 1; return lockReal.getDocumentLock(); }
    };
    g.driveProfileRepository_listarArchivosThumb = function () {
      registro.recorridosThumb += 1;
      throw new Error('DIAG: el recorrido de THUMB esta bloqueado por el diagnostico');
    };
    g.logHistoryEvent = function () { registro.historialSuprimido += 1; };
    if (g.CacheService.getScriptCache() !== envoltorio || typeof g.LockService.getScriptLock !== 'function' || g.driveProfileRepository_listarArchivosThumb === originales.listar || g.logHistoryEvent === originales.historial) {
      instalado = false;
    }
    if (instalado) {
      fn();
    }
  } finally {
    g.CacheService = originales.CacheService;
    g.LockService = originales.LockService;
    g.driveProfileRepository_listarArchivosThumb = originales.listar;
    g.logHistoryEvent = originales.historial;
  }
  return { instalado: instalado };
}

function diagDispE10_forma(respuesta) {
  var forma = { status: respuesta && typeof respuesta.status === 'string' ? respuesta.status : '?' };
  if (respuesta && typeof respuesta.code === 'string') {
    forma.code = respuesta.code.substring(0, 40);
  }
  if (respuesta && respuesta.data && typeof respuesta.data === 'object') {
    forma.data = {};
    Object.keys(respuesta.data).forEach(function (k) { forma.data[k] = typeof respuesta.data[k] === 'boolean' ? respuesta.data[k] : '(no booleano)'; });
  }
  try {
    forma.bytes = JSON.stringify(respuesta).length;
  } catch (err) {
    forma.bytes = -1;
  }
  return forma;
}

function diagDispE10_correr() {
  var t0 = Date.now();
  var notas = [];
  var informe = { diagnostico: 'disponibilidad-itf-E10', version: DIAG_DISP_E10_VERSION, usuario: null, estadoIndiceAntes: null, pozos: [], notas: notas };
  informe.estadoIndiceAntes = diagDispE10_estadoIndice();
  var candidatos = sheetUserRepository_listarConPermisos(['perfil']);
  if (!Array.isArray(candidatos) || candidatos.length === 0) {
    notas.push('SIN_USUARIO_CON_PERFIL: no se llama a ningun handler');
    informe.totalMs = Date.now() - t0;
    return informe;
  }
  var email = String(candidatos[0].email).trim().toLowerCase();
  informe.usuario = diagDispE10_mascara(email);
  var token = createSessionToken(email);
  DIAG_DISP_E10_POZOS.forEach(function (wellId) {
    var registro = { indice: {}, locks: 0, recorridosThumb: 0, historialSuprimido: 0 };
    var fila = { wellId: wellId, duracionMs: null, respuesta: null, accesosAlIndice: { lecturas: 0, escrituras: 0, borrados: 0 }, recorridosThumb: 0, locksTomados: 0, historialSuprimido: 0, resultado: 'OK' };
    var inicio = Date.now();
    var observacion;
    try {
      observacion = diagDispE10_observando(registro, function () {
        var salida = doPost({ postData: { contents: JSON.stringify({ action: 'getItfAvailability', sessionToken: token, wellIds: [wellId] }) } });
        fila.respuesta = diagDispE10_forma(JSON.parse(salida.getContent()));
      });
      fila.duracionMs = Date.now() - inicio;
      if (!observacion.instalado) {
        fila.resultado = 'OBSERVADORES_NO_INSTALADOS';
        notas.push('OBSERVADORES_NO_INSTALADOS: no se llamo al handler para ' + wellId);
      }
    } catch (err) {
      fila.duracionMs = Date.now() - inicio;
      fila.resultado = 'ERROR';
      fila.error = diagDispE10_errorSeguro(err);
    }
    fila.accesosAlIndice = { lecturas: registro.indice.lecturas || 0, escrituras: registro.indice.escrituras || 0, borrados: registro.indice.borrados || 0 };
    fila.recorridosThumb = registro.recorridosThumb;
    fila.locksTomados = registro.locks;
    fila.historialSuprimido = registro.historialSuprimido;
    informe.pozos.push(fila);
  });
  informe.estadoIndiceDespues = diagDispE10_estadoIndice();
  var limpio = informe.pozos.every(function (f) {
    return f.resultado === 'OK' && f.recorridosThumb === 0 && f.locksTomados === 0 && f.accesosAlIndice.lecturas === 0 && f.accesosAlIndice.escrituras === 0 && f.accesosAlIndice.borrados === 0;
  });
  informe.consultaIndividualSinIndice = limpio;
  informe.totalMs = Date.now() - t0;
  return informe;
}

function diagnosticoDisponibilidadItfE10() {
  var informe;
  try {
    informe = diagDispE10_correr();
  } catch (err) {
    informe = { diagnostico: 'disponibilidad-itf-E10', version: DIAG_DISP_E10_VERSION, error: diagDispE10_errorSeguro(err) };
  }
  Logger.log(JSON.stringify(informe));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    diagnosticoDisponibilidadItfE10,
    diagDispE10_correr,
    diagDispE10_estadoIndice,
    diagDispE10_envolverCache,
    diagDispE10_observando,
    diagDispE10_forma,
    diagDispE10_mascara,
    DIAG_DISP_E10_POZOS
  };
}
