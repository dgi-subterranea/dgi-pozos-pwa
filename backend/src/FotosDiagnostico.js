// Diagnostico MANUAL del almacenamiento de fotos (Reemplazos v2): se corre
// desde el editor de Apps Script del proyecto PRINCIPAL (Ejecutar >
// diagnosticarFotosReemplazo) para validar de punta a punta la arquitectura
// multi-cuenta SIN pasar por la app ni por una sesion de usuario. No es
// parte de la API (doPost no lo expone) y nunca loguea el secreto, la URL
// completa del storage ni el driveFileId.
//
// Antes de correrlo, completar las dos constantes de abajo con una
// evaluacion EXISTENTE (creada desde la app o a mano en la hoja
// EvaluacionesReemplazo): columna evaluacionId y columna wellId de la misma
// fila, y que tenga menos de 5 fotos. Sube UNA foto de prueba (1x1 px) a esa
// evaluacion: la fila queda en FotosReemplazo (append-only) y el archivo en
// el Drive de la segunda cuenta; se pueden borrar a mano despues.
var FOTOS_DIAG_EVALUACION_ID = '';
var FOTOS_DIAG_WELL_ID = '';

// JPEG valido de 1x1 px
var FOTOS_DIAG_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

// Pura (testeable): que cadenas NO pueden aparecer en lo que ve el frontend.
function fotosDiagnostico_buscarFugas(respuestas, prohibidos) {
  var texto = JSON.stringify(respuestas);
  var fugas = [];
  Object.keys(prohibidos).forEach(function (nombre) {
    var valor = prohibidos[nombre];
    if (valor && texto.indexOf(valor) >= 0) {
      fugas.push(nombre);
    }
  });
  return fugas;
}

// Pura (testeable): que hacer segun el motivo con el que fallo una llamada al storage (el mensaje ya viene sin URL ni
// secreto). Cubre las causas tipicas de "STORAGE_UNAVAILABLE" en la galeria general de pozos.
function fotosDiagnostico_pista(mensaje) {
  var m = String(mensaje || '');
  if (/UNAUTHORIZED/.test(m)) {
    return 'El storage rechazo la firma: el secreto (FOTOS_STORAGE_SECRET) no coincide entre los dos proyectos o el reloj esta desfasado.';
  }
  if (/UNKNOWN_ACTION/.test(m)) {
    return 'La Web App DESPLEGADA del storage no tiene esta accion: pegar StorageApi.js, StorageDrive.js y StorageConfig.js y publicar una NUEVA VERSION de la implementacion (la URL /exec sigue sirviendo la version anterior hasta entonces).';
  }
  if (/INTERNAL/.test(m)) {
    return 'El storage lanzo una excepcion: lo mas probable es que falte correr setupFotosPozosStorage() en la cuenta del storage (propiedad FOTOS_POZOS_ROOT_FOLDER_ID) o que StorageDrive.js / StorageConfig.js esten sin actualizar.';
  }
  if (/INVALID_|FILE_TOO_LARGE/.test(m)) {
    return 'El storage rechazo el contenido de la foto de prueba (ver el codigo).';
  }
  if (/HTTP \d{3}/.test(m)) {
    return 'La plataforma de Google respondio con un error HTTP (no es un error de la logica del storage: reintentar y revisar el estado de la implementacion).';
  }
  if (/sin firma|RESPUESTA_|NONCE|FIRMA/.test(m)) {
    return 'La respuesta del storage no es valida: revisar el secreto y que la URL sea la de la Web App del storage.';
  }
  return '';
}

// Diagnostico MANUAL de la galeria general de pozos (FotosPozos): "Fotos del pozo > Agregar foto". Se corre desde el editor del
// proyecto PRINCIPAL (Ejecutar > diagnosticarFotosPozos). NO pasa por la app ni por una sesion, NO escribe nada en ninguna
// hoja y NO depende de evaluaciones (esta galeria no usa evaluacionId). Sube UNA foto de prueba al storage, la lee (miniatura y
// completa), comprueba que son archivos distintos y la manda a la papelera; imprime el motivo EXACTO del primer paso que falle.
function diagnosticarFotosPozos() {
  var ok = true;
  function paso(titulo, pasa, detalle) {
    Logger.log((pasa ? 'OK    ' : 'FALLA ') + titulo + (detalle ? ' - ' + detalle : ''));
    if (!pasa) { ok = false; }
  }
  function falla(titulo, err) {
    var texto = fotosService_limpiar(err);
    var pista = fotosDiagnostico_pista(texto);
    paso(titulo, false, texto + (pista ? '  =>  ' + pista : ''));
  }

  var secreto = null;
  var url = null;
  try { secreto = getFotosStorageSecret(); paso('FOTOS_STORAGE_SECRET configurado', true, 'longitud ' + secreto.length); } catch (e) { paso('FOTOS_STORAGE_SECRET configurado', false, e.message); }
  try { url = getFotosStorageUrl(); paso('FOTOS_STORAGE_URL configurado', /^https:\/\/script\.google\.com\//.test(url), 'termina en ' + (/\/exec$/.test(url) ? '/exec' : 'algo distinto de /exec (revisar)')); } catch (e) { paso('FOTOS_STORAGE_URL configurado', false, e.message); }
  if (!secreto || !url) {
    Logger.log('Configurar las Script Properties del proyecto principal y volver a correr.');
    return;
  }

  try { fotosPozosRepository_abrirHoja(); paso('hoja FotosPozos accesible y con todas sus columnas', true); } catch (e) { falla('hoja FotosPozos accesible y con todas sus columnas (correr setupFotosPozos)', e); }

  var almacenada = null;
  try {
    almacenada = fotosStorageClient_subirPozo({
      fotoId: Utilities.getUuid(), fuente: 'CAMPO_APP', carpetaFecha: 'sin_fecha', mimeType: 'image/jpeg',
      imagenBase64: FOTOS_DIAG_JPEG_B64, thumbBase64: FOTOS_DIAG_JPEG_B64
    });
    paso('1) putFotoPozo: subir una foto de prueba al storage (FotosPozos/CAMPO_APP/sin_fecha)', !!almacenada.driveFileId && !!almacenada.driveThumbId);
  } catch (e) {
    falla('1) putFotoPozo: subir una foto de prueba al storage', e);
    Logger.log('DIAGNOSTICO CON FALLAS: la carga de "Fotos del pozo" falla en el storage (no en la asociacion con una evaluacion: esta galeria no usa evaluaciones).');
    return;
  }
  paso('2) original y miniatura son archivos distintos', almacenada.driveFileId !== almacenada.driveThumbId);

  try {
    var thumb = fotosStorageClient_obtenerPozo(almacenada.driveFileId, almacenada.driveThumbId, 'thumb');
    paso('3) getFotoPozo miniatura', thumb.imagenBase64 === FOTOS_DIAG_JPEG_B64, 'bytes ' + (thumb.imagenBase64 === FOTOS_DIAG_JPEG_B64 ? 'coinciden' : 'NO coinciden'));
  } catch (e) { falla('3) getFotoPozo miniatura', e); }
  try {
    var full = fotosStorageClient_obtenerPozo(almacenada.driveFileId, almacenada.driveThumbId, 'full');
    paso('4) getFotoPozo imagen completa', full.imagenBase64 === FOTOS_DIAG_JPEG_B64, 'bytes ' + (full.imagenBase64 === FOTOS_DIAG_JPEG_B64 ? 'coinciden' : 'NO coinciden'));
  } catch (e) { falla('4) getFotoPozo imagen completa', e); }

  try { fotosStorageClient_descartarPozo(almacenada.driveFileId); paso('5) trashFotoPozo: la foto de prueba se mando a la papelera del storage', true); } catch (e) { falla('5) trashFotoPozo', e); }
  Logger.log('No se escribio ninguna fila en FotosPozos. En el Drive del storage pueden quedar las carpetas vacias FotosPozos/CAMPO_APP/sin_fecha.');
  Logger.log(ok ? 'DIAGNOSTICO COMPLETO: el storage de FotosPozos funciona' : 'DIAGNOSTICO CON FALLAS: revisar las lineas FALLA');
}

function diagnosticarFotosReemplazo() {
  var ok = true;
  function paso(titulo, pasa, detalle) {
    Logger.log((pasa ? 'OK    ' : 'FALLA ') + titulo + (detalle ? ' - ' + detalle : ''));
    if (!pasa) { ok = false; }
  }

  // 1) configuracion (sin mostrar valores sensibles)
  var secreto = null;
  var url = null;
  try { secreto = getFotosStorageSecret(); paso('FOTOS_STORAGE_SECRET configurado', true, 'longitud ' + secreto.length); } catch (e) { paso('FOTOS_STORAGE_SECRET configurado', false, e.message); }
  try { url = getFotosStorageUrl(); paso('FOTOS_STORAGE_URL configurado', /^https:\/\/script\.google\.com\//.test(url), 'termina en ' + (/\/exec$/.test(url) ? '/exec' : 'algo distinto de /exec (revisar)')); } catch (e) { paso('FOTOS_STORAGE_URL configurado', false, e.message); }
  if (!secreto || !url) {
    Logger.log('Configurar las Script Properties del proyecto principal y volver a correr.');
    return;
  }
  if (!FOTOS_DIAG_EVALUACION_ID || !FOTOS_DIAG_WELL_ID) {
    Logger.log('Completar FOTOS_DIAG_EVALUACION_ID y FOTOS_DIAG_WELL_ID (arriba en este archivo) con una evaluacion existente y volver a correr.');
    return;
  }

  var cuotaAntes = DriveApp.getStorageUsed();
  Logger.log('Drive usado por la cuenta PRINCIPAL (antes): ' + cuotaAntes + ' bytes');

  // 2) subir una foto por el MISMO camino que usa la app
  var email = Session.getEffectiveUser().getEmail();
  var subida = fotosService_subir(email, FOTOS_DIAG_WELL_ID, FOTOS_DIAG_EVALUACION_ID, {
    nombreArchivo: 'diagnostico.jpg', mimeType: 'image/jpeg', imagenBase64: FOTOS_DIAG_JPEG_B64, thumbBase64: FOTOS_DIAG_JPEG_B64
  });
  paso('1) subir una foto (backend principal -> storage firmado)', subida.ok, subida.ok ? 'fotoId ' + subida.foto.fotoId : subida.code + ' ' + subida.message);
  if (!subida.ok) {
    return;
  }
  var fotoId = subida.foto.fotoId;

  // 3) fila en FotosReemplazo
  var fila = fotosRepository_buscarPorFotoId(fotoId);
  paso('6) fila registrada en FotosReemplazo', !!fila && fila.evaluacionId === FOTOS_DIAG_EVALUACION_ID && fila.wellId === FOTOS_DIAG_WELL_ID && fila.email === email && fila.tamanoBytes > 0,
    fila ? 'evaluacionId/wellId/email ok, ' + fila.tamanoBytes + ' bytes, mimeType ' + fila.mimeType : 'no encontrada');
  if (fila) {
    Logger.log('Archivo para buscar en el Drive de la SEGUNDA cuenta (Mi unidad/FotosReemplazo/' + new Date().getFullYear() + '): ' + fila.nombreArchivo);
  }

  // 4) lectura miniatura e imagen completa (proxy por el backend)
  var thumb = fotosService_obtenerImagen(fotoId, 'thumb');
  paso('4) lectura de la miniatura', thumb.ok && thumb.imagen.imagenBase64 === FOTOS_DIAG_JPEG_B64, thumb.ok ? 'bytes coinciden' : thumb.code);
  var full = fotosService_obtenerImagen(fotoId, 'full');
  paso('5) lectura de la imagen completa', full.ok && full.imagen.imagenBase64 === FOTOS_DIAG_JPEG_B64, full.ok ? 'bytes coinciden' : full.code);

  // 5) lo que veria el frontend no filtra URL / secreto / driveFileId
  var listado = fotosService_listarPorEvaluacion(FOTOS_DIAG_EVALUACION_ID);
  var fugas = fotosDiagnostico_buscarFugas([subida, thumb, full, listado], {
    driveFileId: fila ? fila.driveFileId : '',
    secreto: secreto,
    urlStorage: url,
    dominioDrive: 'drive.google.com',
    emailQueSubio: email
  });
  paso('7) respuestas del backend sin URL, secreto, driveFileId ni email', fugas.length === 0, fugas.length ? 'FUGA: ' + fugas.join(', ') : 'sin fugas');

  // 6) cuota de la cuenta principal
  Logger.log('Drive usado por la cuenta PRINCIPAL (despues): ' + DriveApp.getStorageUsed() + ' bytes (Drive puede tardar unos minutos en reflejar el uso; comparar de nuevo mas tarde)');
  Logger.log('8) Cuota: comparar con diagnosticarCuotaStorage() en la SEGUNDA cuenta (antes/despues). Ver docs/fotos-reemplazo-storage.md');
  Logger.log(ok ? 'DIAGNOSTICO COMPLETO: todo OK' : 'DIAGNOSTICO CON FALLAS: revisar las lineas FALLA');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fotosDiagnostico_buscarFugas, fotosDiagnostico_pista, diagnosticarFotosReemplazo, diagnosticarFotosPozos };
}
