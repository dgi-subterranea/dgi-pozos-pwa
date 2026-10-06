// Contador de fotos por pozo / punto NE ({wellId | monitoringId: cantidad}),
// compartido por el hub, la ficha NE, el popup del mapa NE, Buscar reemplazo y
// Pozos cerca mio (FotosPozos v1). Mismo patron que js/reemplazoEstados.js.
//
// - FAIL-CLOSED: sin fotos=SI NO hay ninguna llamada, ningun contador y ningun
//   dato ("no revelar si un pozo tiene fotos"). fotos_carga solo NO alcanza.
// - UNA llamada batch (getResumenFotosPozos) + cache de unos minutos (TTL) +
//   actualizacion LOCAL inmediata al subir (incrementar): el contador ya refleja
//   la foto nueva sin esperar el TTL ni volver a pedir todo (el backend tambien
//   invalida su cache al subir).
// - Resumen null = no disponible (sin permiso, sin cargar o fallo la carga): ahi
//   NO hay contador ni se afirma "0 fotos".
//
// La logica vive en una fabrica para testearla con Jest inyectando
// permisos/red/reloj; el navegador usa la instancia real al final del archivo.
var FOTOS_POZOS_RESUMEN_TTL_MS = 3 * 60 * 1000;

function fotosPozosResumen_crear(deps) {
  var interno = { resumen: null, cargadoEn: 0, cargando: null, version: 0, tokenReset: 0 };

  function habilitado() {
    var ctx = deps.obtenerContexto();
    return !!(ctx && ctx.permisos && ctx.permisos.fotos === true);
  }

  function fresco() {
    return interno.resumen !== null && (deps.ahora() - interno.cargadoEn) < FOTOS_POZOS_RESUMEN_TTL_MS;
  }

  // Defensa en el borde de red: solo claves de texto con cantidades enteras > 0
  function sanitizar(data) {
    var limpio = {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return limpio;
    }
    Object.keys(data).forEach(function (clave) {
      var n = data[clave];
      if (clave && clave.length <= 40 && typeof n === 'number' && isFinite(n) && n > 0 && Math.floor(n) === n) {
        limpio[clave] = n;
      }
    });
    return limpio;
  }

  // Promesa del resumen (o null si no esta habilitado o la carga fallo sin datos
  // previos). Deduplica llamadas simultaneas. Nunca rechaza.
  function cargar(forzar) {
    if (!habilitado()) {
      return Promise.resolve(null);
    }
    if (!forzar && fresco()) {
      return Promise.resolve(interno.resumen);
    }
    if (interno.cargando) {
      return interno.cargando;
    }
    var ctx = deps.obtenerContexto();
    var token = interno.tokenReset;
    interno.cargando = deps.apiGetResumen(ctx.sessionToken).then(function (r) {
      interno.cargando = null;
      if (token !== interno.tokenReset) {
        return null;                // se reseteo (logout) mientras volaba
      }
      if (r && r.status === 'ok') {
        interno.resumen = sanitizar(r.data);
        interno.cargadoEn = deps.ahora();
        interno.version += 1;
      } else if (r && (r.code === 'PERMISSION_DENIED' || r.code === 'UNAUTHORIZED' || r.code === 'USER_DISABLED')) {
        interno.resumen = null;     // el backend dice que no: no se conserva nada
        interno.version += 1;
      }
      return interno.resumen;
    }).catch(function () {
      interno.cargando = null;
      return interno.resumen;       // sin red: se conserva lo que hubiera
    });
    return interno.cargando;
  }

  return {
    habilitado: habilitado,
    cargar: cargar,
    // El resumen SOLO se expone si el permiso sigue vigente
    resumen: function () { return habilitado() ? interno.resumen : null; },
    disponible: function () { return habilitado() && interno.resumen !== null; },
    version: function () { return interno.version; },
    // cantidad de una entidad: null si no hay resumen disponible (sin permiso o sin cargar); 0 si cargo y no tiene
    cantidadDe: function (clave) {
      if (!habilitado() || interno.resumen === null) {
        return null;
      }
      return interno.resumen[clave] || 0;
    },
    // Actualizacion local inmediata tras subir. Sin resumen cargado no se inventa uno.
    incrementar: function (clave, cantidad) {
      if (!clave || interno.resumen === null) {
        return;
      }
      var copia = {};
      Object.keys(interno.resumen).forEach(function (k) { copia[k] = interno.resumen[k]; });
      copia[clave] = (copia[clave] || 0) + (cantidad || 1);
      interno.resumen = copia;
      interno.version += 1;
    },
    invalidar: function () { interno.cargadoEn = 0; },
    reset: function () {
      interno.resumen = null;
      interno.cargadoEn = 0;
      interno.cargando = null;
      interno.version += 1;
      interno.tokenReset += 1;
    }
  };
}

// --- Navegador: instancia real ---
if (typeof window !== 'undefined') {
  (function () {
    var obtenerContexto = function () { return null; };
    var store = fotosPozosResumen_crear({
      obtenerContexto: function () { return obtenerContexto(); },
      apiGetResumen: function (token) { return apiGetResumenFotosPozos(token); },
      ahora: function () { return Date.now(); }
    });
    window.fotosPozosResumenController_inicializar = function (fn) { obtenerContexto = fn; };
    window.fotosPozosResumenController_habilitado = store.habilitado;
    window.fotosPozosResumenController_cargar = store.cargar;
    window.fotosPozosResumenController_resumen = store.resumen;
    window.fotosPozosResumenController_disponible = store.disponible;
    window.fotosPozosResumenController_version = store.version;
    window.fotosPozosResumenController_cantidadDe = store.cantidadDe;
    window.fotosPozosResumenController_incrementar = store.incrementar;
    window.fotosPozosResumenController_invalidar = store.invalidar;
    window.fotosPozosResumenController_reset = store.reset;
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fotosPozosResumen_crear, FOTOS_POZOS_RESUMEN_TTL_MS };
}
