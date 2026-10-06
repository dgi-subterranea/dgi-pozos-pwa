// Estado de aptitud de reemplazo de TODOS los pozos evaluados, compartido por
// el mapa Provincia, Pozos cerca mio y Mi seleccion (Reemplazos v3).
//
// - Una sola llamada batch (getResumenReemplazoMapa) devuelve {wellId:
//   estado} solo de los pozos evaluados; los ausentes son SIN_EVALUAR. Se
//   guarda en memoria y se reusa en las 3 pantallas.
// - Sin reemplazo=SI: NINGUNA llamada, ningun estado (el backend tampoco
//   devuelve nada sin el permiso; esto solo evita el viaje inutil).
// - Cache frontend de pocos minutos (TTL) + actualizacion LOCAL inmediata
//   cuando el usuario evalua un pozo (actualizar): al volver a la
//   pantalla de origen el badge ya refleja el estado nuevo, sin esperar el
//   TTL ni refetchear todo (el backend tambien invalida su cache al
//   registrar).
// - Resumen null = no disponible (sin permiso, sin cargar o fallo): ningun
//   badge ni filtro, y ningun pozo se muestra como "Sin evaluar".
//
// La logica vive en una fabrica (reemplazoEstados_crear) para poder
// testearla con Jest inyectando permisos/red/reloj; el navegador usa la
// instancia real al final del archivo.
var REEMPLAZO_ESTADOS_TTL_MS = 3 * 60 * 1000;

function reemplazoEstados_crear(deps) {
  var interno = {
    resumen: null,
    cargadoEn: 0,
    cargando: null,
    version: 0,
    tokenReset: 0
  };

  function habilitado() {
    var ctx = deps.obtenerContexto();
    return !!(ctx && ctx.permisos && ctx.permisos.reemplazo === true);
  }

  function fresco() {
    return interno.resumen !== null && (deps.ahora() - interno.cargadoEn) < REEMPLAZO_ESTADOS_TTL_MS;
  }

  // Devuelve una promesa del resumen (o null si no esta habilitado o la
  // carga fallo y no hay datos previos). Deduplica llamadas simultaneas.
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
        return null; // se reseteo (logout) mientras volaba
      }
      if (r && r.status === 'ok') {
        interno.resumen = reemplazoResumenLogic_sanitizar(r.data);
        interno.cargadoEn = deps.ahora();
        interno.version += 1;
      } else if (r && (r.code === 'PERMISSION_DENIED' || r.code === 'UNAUTHORIZED' || r.code === 'USER_DISABLED')) {
        interno.resumen = null; // el backend dice que no: no se conserva nada
        interno.version += 1;
      }
      return interno.resumen;
    }).catch(function () {
      interno.cargando = null;
      return interno.resumen; // sin red: se conserva lo que hubiera
    });
    return interno.cargando;
  }

  return {
    habilitado: habilitado,
    cargar: cargar,
    // El resumen SOLO se expone si el permiso sigue vigente (si se perdio
    // la sesion o el permiso, nada).
    resumen: function () { return habilitado() ? interno.resumen : null; },
    disponible: function () { return habilitado() && interno.resumen !== null; },
    version: function () { return interno.version; },
    estadoDe: function (wellId) { return habilitado() ? reemplazoResumenLogic_estadoDe(interno.resumen, wellId) : null; },
    // Actualizacion local inmediata tras evaluar. Sin resumen cargado no se
    // inventa uno (el proximo cargar() lo trae completo del backend).
    actualizar: function (wellId, estado) {
      if (interno.resumen === null) {
        return;
      }
      interno.resumen = reemplazoResumenLogic_actualizar(interno.resumen, wellId, estado);
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
    var store = reemplazoEstados_crear({
      obtenerContexto: function () { return obtenerContexto(); },
      apiGetResumen: function (token) { return apiGetResumenReemplazoMapa(token); },
      ahora: function () { return Date.now(); }
    });

    window.reemplazoEstadosController_inicializar = function (fn) { obtenerContexto = fn; };
    window.reemplazoEstadosController_habilitado = store.habilitado;
    window.reemplazoEstadosController_cargar = store.cargar;
    window.reemplazoEstadosController_resumen = store.resumen;
    window.reemplazoEstadosController_disponible = store.disponible;
    window.reemplazoEstadosController_version = store.version;
    window.reemplazoEstadosController_estadoDe = store.estadoDe;
    window.reemplazoEstadosController_actualizar = store.actualizar;
    window.reemplazoEstadosController_invalidar = store.invalidar;
    window.reemplazoEstadosController_reset = store.reset;

    // Grupo de chips "Aptitud para reemplazo" reutilizado por el mapa, Cerca
    // Mio y Mi seleccion (mismo aspecto y misma semantica: Todos limpia, se
    // pueden sumar varios, OR dentro del grupo). conteos = {APTO, DUDOSO,
    // NO_APTO, SIN_EVALUAR}; onCambio(nuevosActivos) lo llama al tocar un chip.
    window.reemplazoEstadosUI_pintarFiltro = function (contenedorEl, activos, conteos, onCambio) {
      contenedorEl.innerHTML = '';
      var total = conteos.APTO + conteos.DUDOSO + conteos.NO_APTO + conteos.SIN_EVALUAR;
      var sinSeleccion = !reemplazoResumenLogic_hayActivos(activos);

      function chip(valor, etiqueta, activo, claseEstado) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'reemplazo-filtro-chip' + (claseEstado ? ' reemplazo-filtro-chip-' + claseEstado : '') + (activo ? ' active' : '');
        b.setAttribute('data-estado', valor);
        b.setAttribute('aria-pressed', activo ? 'true' : 'false');
        b.textContent = etiqueta;
        b.addEventListener('click', function () {
          onCambio(mapaLogic_toggleFiltroMultiple(activos, valor));
        });
        contenedorEl.appendChild(b);
      }

      chip('todos', 'Todos (' + total + ')', sinSeleccion, '');
      REEMPLAZO_RESUMEN_ESTADOS.forEach(function (e) {
        chip(e, reemplazoResumenLogic_etiqueta(e) + ' (' + conteos[e] + ')', !!(activos && activos[e]), reemplazoLogic_claseEstado(e));
      });
    };
  })();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reemplazoEstados_crear, REEMPLAZO_ESTADOS_TTL_MS };
}
