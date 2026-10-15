// Wrapper de fetch hacia el Web App de Apps Script. POST con
// Content-Type: text/plain a proposito (evita el preflight de CORS que
// Apps Script no maneja de forma confiable) - ver docs/architecture.md.
var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycby_fttbCjlZaE7qjhZipqRxvLtdXZV1kCaEjyOeK8UZEJy9VgC5LmAGiyUtVeUZRq1Z/exec';

function callBackend(action, payload, fetchOptions) {
  var body = Object.assign({ action: action }, payload || {});
  var options = Object.assign({
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(body)
  }, fetchOptions || {});
  return fetch(APPS_SCRIPT_URL, options).then(function (response) {
    return response.json();
  });
}

function apiLogin(idToken) {
  return callBackend('login', { idToken: idToken });
}

function apiCheckSession(sessionToken) {
  return callBackend('checkSession', { sessionToken: sessionToken });
}

function apiGetProfile(sessionToken, wellId) {
  return callBackend('getProfile', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetWellRecord(sessionToken, wellId) {
  return callBackend('getWellRecord', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetRegistryMetadata(sessionToken) {
  return callBackend('getMetadata', { sessionToken: sessionToken });
}

function apiGetMonitoringPoint(sessionToken, monitoringId) {
  return callBackend('getMonitoringPoint', { sessionToken: sessionToken, monitoringId: monitoringId });
}

function apiGetWellLocation(sessionToken, wellId) {
  return callBackend('getWellLocation', { sessionToken: sessionToken, wellId: wellId });
}

// Dataset general del Mapa de Pozos - una sola vez por apertura del mapa,
// nunca por wellId (ver js/mapa.js). Requiere ubicacion=SI del lado del
// backend; el frontend no dispara este fetch si permisosActuales.ubicacion
// es false (ver btn-abrir-mapa en app.js), pero el backend vuelve a
// validarlo igual.
function apiGetMapaPozos(sessionToken) {
  return callBackend('getMapaPozos', { sessionToken: sessionToken });
}

// Ubicaciones VALIDADAS vigentes (delta del punto operativo): [{wellId, lat, lon, vts}], sin autor ni datos internos. Cualquier usuario activo, igual que
// getMapaPozos. TODAVIA no la llama nadie (el overlay en mapaDataset_obtener es una etapa posterior); queda lista para probar el contrato frontend/backend.
function apiGetUbicacionesValidadas(sessionToken) {
  return callBackend('getUbicacionesValidadas', { sessionToken: sessionToken });
}

// Popup liviano del mapa: solo se llama si datos=SI (ver
// mapaLogic_debeConsultarSummary) - nunca para mostrar "denegado", el
// permiso se respeta antes de disparar la llamada de red.
function apiGetWellSummary(sessionToken, wellId) {
  return callBackend('getWellSummary', { sessionToken: sessionToken, wellId: wellId });
}

// Capa Mapa NE (v2.1.0) - dataset SEPARADO de getMapaPozos, requiere el
// permiso "ne" del lado del backend. El frontend no dispara este fetch
// si permisos.ne es false (el chip "Niveles estáticos" ni siquiera se
// muestra - ver mapa.js), pero el backend vuelve a validarlo igual.
function apiGetMapaNE(sessionToken) {
  return callBackend('getMapaNE', { sessionToken: sessionToken });
}

// Indice de busqueda por titular de Pozos Provincia (Etapa 1A) - dataset
// SEPARADO de getMapaPozos, requiere "datos" del lado del backend. El
// frontend no dispara este fetch si permisos.datos es false (el campo de
// busqueda por nombre ni siquiera se muestra - ver mapa.js), pero el
// backend vuelve a validarlo igual.
function apiGetIndiceBusquedaProvincia(sessionToken) {
  return callBackend('getIndiceBusquedaProvincia', { sessionToken: sessionToken });
}

// keepalive: true - para que el request tenga mas chance de llegar
// aunque el usuario cierre/navegue afuera de la PWA justo despues de
// buscar (fire-and-forget, no se espera ni se usa la respuesta). Un
// solo registro por busqueda, disparado una vez al terminar buscarPozo() -
// nunca desde los fetches individuales de cada modulo. Registra en la
// hoja Busquedas y dispara la notificacion Telegram (efectos
// independientes del lado del backend).
function apiRegisterWellSearch(sessionToken, wellId, modulos) {
  return callBackend('registerWellSearch', { sessionToken: sessionToken, wellId: wellId, modulos: modulos }, { keepalive: true });
}

// Etapa "seleccion multiple + lote": disponibilidad de ITF para un LOTE
// de wellId (solo booleanos, nunca ids/urls de Drive - ver
// ItfAvailabilityService.js). Requiere perfil=SI del lado del backend.
// Se audita del lado del backend (Historial, nunca Telegram) en CADA
// llamada real - el frontend solo llama aca cuando su propio cache esta
// vencido/vacio (ver asegurarDisponibilidadItf en js/seleccion.js), asi
// que abrir una pantalla que ya tiene el resultado en memoria NUNCA
// dispara esto.
function apiGetItfAvailability(sessionToken, wellIds) {
  return callBackend('getItfAvailability', { sessionToken: sessionToken, wellIds: wellIds });
}

// Auditoria de UNA descarga ITF real (cierre revisado del item K): UN
// evento resumido por descarga, nunca por pozo - resumen =
// {totalSeleccionados, solicitados, descargados, fallidos, wellIds}.
// keepalive igual que registerWellSearch - fire-and-forget, nunca
// bloquea la UI. Es la UNICA accion de esta etapa que genera Telegram;
// seleccionar geograficamente o ver la tabla/disponibilidad nunca llega
// aca.
function apiRegisterDescargaItf(sessionToken, resumen) {
  return callBackend('registerDescargaItf', { sessionToken: sessionToken, resumen: resumen }, { keepalive: true });
}


// --- Modulo Evaluacion / Reemplazo (v1) ---
// Los 3 endpoints se gatean en el backend EXCLUSIVAMENTE por el permiso
// reemplazo=SI (lectura y escritura). La identidad (email/nombre) NUNCA se
// manda: el backend la toma de la sesion. registrarEvaluacionReemplazo NO
// lleva keepalive a proposito: el usuario espera la confirmacion para
// refrescar estado/historial (ver js/reemplazo.js).
function apiGetEstadoReemplazo(sessionToken, wellId) {
  return callBackend('getEstadoReemplazo', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetHistorialReemplazo(sessionToken, wellId) {
  return callBackend('getHistorialReemplazo', { sessionToken: sessionToken, wellId: wellId });
}

function apiRegistrarEvaluacionReemplazo(sessionToken, wellId, estado, motivo, observacion, puntoNEReferencia) {
  return callBackend('registrarEvaluacionReemplazo', {
    sessionToken: sessionToken,
    wellId: wellId,
    estado: estado,
    motivo: motivo,
    observacion: observacion,
    puntoNEReferencia: puntoNEReferencia
  });
}

// --- Fotos de evaluaciones de reemplazo (v2) ---
// Todas gateadas por reemplazo=SI en el backend. El navegador habla SOLO
// con el backend principal (que firma y llama al storage de la segunda
// cuenta): nunca ve URLs de Drive ni Drive IDs. Una foto por request
// (cola secuencial en js/reemplazoFotos.js); la imagen viaja en base64
// ya comprimida por el navegador (JPEG, sin EXIF/GPS).
function apiSubirFotoReemplazo(sessionToken, wellId, evaluacionId, nombreArchivo, mimeType, imagenBase64, thumbBase64) {
  return callBackend('subirFotoReemplazo', {
    sessionToken: sessionToken, wellId: wellId, evaluacionId: evaluacionId, nombreArchivo: nombreArchivo,
    mimeType: mimeType, imagenBase64: imagenBase64, thumbBase64: thumbBase64
  });
}

// Metadata de TODAS las fotos de un pozo (una llamada por apertura del pozo)
function apiGetFotosReemplazoPozo(sessionToken, wellId) {
  return callBackend('getFotosReemplazoPozo', { sessionToken: sessionToken, wellId: wellId });
}

function apiGetFotosReemplazo(sessionToken, evaluacionId) {
  return callBackend('getFotosReemplazo', { sessionToken: sessionToken, evaluacionId: evaluacionId });
}

// variante: 'thumb' (miniatura, lazy en el historial) | 'full' (solo al abrir el visor)
function apiGetFotoReemplazo(sessionToken, fotoId, variante) {
  return callBackend('getFotoReemplazo', { sessionToken: sessionToken, fotoId: fotoId, variante: variante });
}

// --- Reemplazos v3: resumen batch para mapa, Cerca Mio y Mi seleccion ---
// UNA llamada devuelve {wellId: "APTO"|"DUDOSO"|"NO_APTO"} solo de los
// pozos evaluados (el resto es SIN_EVALUAR). Gateada por reemplazo=SI en el
// backend; el frontend ni siquiera la dispara sin el permiso (ver
// js/reemplazoEstados.js). Sin email, motivo, fotos, ids ni fechas.
function apiGetResumenReemplazoMapa(sessionToken) {
  return callBackend('getResumenReemplazoMapa', { sessionToken: sessionToken });
}

// --- Galeria general de fotos de pozos / puntos NE (FotosPozos v1) ---
// Separada de las fotos de Reemplazos. Ver y contar = permiso "fotos"; cargar =
// "fotos_carga" (independientes entre si y de "reemplazo"). El frontend ni siquiera
// dispara las lecturas sin "fotos" (ver js/fotosPozosResumen.js / js/fotosPozos.js);
// el backend vuelve a validar igual. El navegador habla SOLO con el backend
// principal: nunca recibe URLs de Drive, Drive IDs, emails ni sha1.
// La entidad es wellId (pozo Provincia o punto NE con numero de pozo) o, para un
// punto NE especial sin wellId, monitoringId.
function apiGetFotosPozo(sessionToken, wellId, monitoringId, orden) {
  return callBackend('getFotosPozo', { sessionToken: sessionToken, wellId: wellId, monitoringId: monitoringId, orden: orden });
}

// variante: 'thumb' (miniaturas, lazy) | 'full' (solo al abrir el visor)
function apiGetFotoPozo(sessionToken, fotoId, variante) {
  return callBackend('getFotoPozo', { sessionToken: sessionToken, fotoId: fotoId, variante: variante });
}

// UNA llamada: {wellId | monitoringId: cantidad}, solo entidades con al menos una foto
function apiGetResumenFotosPozos(sessionToken) {
  return callBackend('getResumenFotosPozos', { sessionToken: sessionToken });
}

// Una foto por request (cola secuencial). datos: {wellId, monitoringId, fuente, tipoFoto,
// fechaFotoValor, fechaFotoPrecision, fechaFotoFuente, observacion, gps:{lat,lon}|null,
// mimeType, imagenBase64, thumbBase64, sha1Original, procesamiento, tamanoOriginalBytes}.
// La identidad de quien sube nunca se manda: sale de la sesion.
function apiSubirFotoPozo(sessionToken, datos) {
  var d = datos || {};
  return callBackend('subirFotoPozo', {
    sessionToken: sessionToken,
    wellId: d.wellId,
    monitoringId: d.monitoringId,
    fuente: d.fuente,
    tipoFoto: d.tipoFoto,
    fechaFotoValor: d.fechaFotoValor,
    fechaFotoPrecision: d.fechaFotoPrecision,
    fechaFotoFuente: d.fechaFotoFuente,
    observacion: d.observacion,
    gps: d.gps,
    mimeType: d.mimeType,
    imagenBase64: d.imagenBase64,
    thumbBase64: d.thumbBase64,
    sha1Original: d.sha1Original,
    procesamiento: d.procesamiento,
    tamanoOriginalBytes: d.tamanoOriginalBytes
  });
}

// --- Correcciones de ubicacion de pozos (ficha individual) ---
// La coordenada de Irrigacion NUNCA se modifica: una correccion es otro dato (hojas append-only del backend).
// Leer = permiso "ubicacion". Proponer = "ubicacion" + "ubicacion_corregir"; con ademas "ubicacion_validar" el BACKEND deja la
// correccion vigente en la misma operacion. El frontend no decide eso ni lo puede pedir: lee el estado de data.correccion.estado.
// Devuelve {vigente, pendientes[], historial[]}: sin emails (solo nombres).
function apiGetCorreccionesUbicacionPozo(sessionToken, wellId) {
  return callBackend('getCorreccionesUbicacionPozo', { sessionToken: sessionToken, wellId: wellId });
}

// Cola de validacion (solo con ubicacion + ubicacion_validar): el indicador "Correcciones pendientes: N" del hub lee data.total y la bandeja lista data.pendientes.
function apiGetCorreccionesUbicacionPendientes(sessionToken) {
  return callBackend('getCorreccionesUbicacionPendientes', { sessionToken: sessionToken });
}

// Validar / rechazar una correccion pendiente (solo con ubicacion + ubicacion_validar; el backend lo exige). Solo viajan sessionToken, correccionId y motivo
// (obligatorio al rechazar): la identidad del validador sale de la sesion del lado del backend.
function apiValidarCorreccionUbicacion(sessionToken, correccionId) {
  return callBackend('validarCorreccionUbicacion', { sessionToken: sessionToken, correccionId: correccionId });
}

function apiRechazarCorreccionUbicacion(sessionToken, correccionId, motivo) {
  return callBackend('rechazarCorreccionUbicacion', { sessionToken: sessionToken, correccionId: correccionId, motivo: motivo });
}

// LISTA BLANCA de campos: wellId, lat, lon, metodo, precisionGpsM, observacion, clientRequestId y, solo en los metodos por coordenadas ingresadas,
// coordenadaOriginal ({lat:{g,m,s,h}, lon:{g,m,s,h}} en COORDENADAS_GMS; {x, y} con x = Este e y = Norte en COORDENADAS_POSGAR94_AR2). coordenadaOriginalTexto y crsOriginal NO viajan: los genera el backend. La identidad (email/nombre) sale de la
// sesion del lado del backend; la distancia, el snapshot de Irrigacion y el estado los calcula el backend. Nada mas viaja, aunque
// "datos" traiga mas campos. Sin keepalive: el usuario espera la confirmacion para refrescar la ficha.
function apiProponerCorreccionUbicacion(sessionToken, datos) {
  var d = datos || {};
  return callBackend('proponerCorreccionUbicacion', {
    sessionToken: sessionToken,
    wellId: d.wellId,
    lat: d.lat,
    lon: d.lon,
    metodo: d.metodo,
    precisionGpsM: d.precisionGpsM,
    observacion: d.observacion,
    clientRequestId: d.clientRequestId,
    coordenadaOriginal: d.coordenadaOriginal
  });
}


// --- Decisiones sobre las fuentes registrales de ubicacion (Aceptar / Descartar / Quitar aceptacion / Restaurar) ---
// La coordenada original de una fuente NUNCA se borra ni se modifica: una decision es otra fila append-only en el backend.
// Leer = permiso "ubicacion". Decidir = "ubicacion" + "ubicacion_validar" (el BACKEND lo exige; "ubicacion_corregir" no alcanza).
// Devuelve {wellId, version, integro, padronPeriodo, fuentes[], obsoletas[], historial[], resolucion}: sin emails (solo nombres).
function apiGetDecisionesFuentesPozo(sessionToken, wellId) {
  return callBackend('getDecisionesFuentesPozo', { sessionToken: sessionToken, wellId: wellId });
}

// LISTA BLANCA de campos: wellId, fuenteTipo, x, y, accion (ACEPTAR | DESCARTAR | QUITAR_ACEPTACION | RESTAURAR), motivo, versionVista y clientRequestId.
// La identidad (email/nombre), la secuencia, la fecha y el estado NUNCA viajan: los pone el backend. Devuelve la vista actualizada + decision + duplicada.
function apiDecidirFuenteUbicacion(sessionToken, datos) {
  var d = datos || {};
  return callBackend('decidirFuenteUbicacion', {
    sessionToken: sessionToken,
    wellId: d.wellId,
    fuenteTipo: d.fuenteTipo,
    x: d.x,
    y: d.y,
    accion: d.accion,
    motivo: d.motivo,
    versionVista: d.versionVista,
    clientRequestId: d.clientRequestId
  });
}
