// Verificacion MANUAL del storage para el rollout de los ITF colaborativos (E9-7). Se corre desde el editor de Apps Script del proyecto STORAGE,
// con la SEGUNDA cuenta (Ejecutar > verificarRaicesStorage / smokeItfStorage). NO es parte de la API (doPost no las expone), no reciben parametros
// y NUNCA loguean el secreto, ids de Drive ni correos: solo el nombre de cada chequeo y OK / FALLA.
//
//   verificarRaicesStorage(): SOLO LECTURA. Comprueba que las tres propiedades de raiz (Reemplazos, Pozos, ITF) y el secreto HMAC estan configurados, que
//     las tres carpetas son accesibles, se llaman como corresponde, no estan en la papelera, son DISTINTAS y ninguna cuelga de otra.
//   smokeItfStorage(): smoke de punta a punta con archivos de prueba generados en el momento y retirados al final. Llama a storageApi_procesar (la misma
//     funcion que usa doPost: autenticacion HMAC, anti-replay, despacho y respuesta firmada) con solicitudes firmadas con el secreto REAL del proyecto,
//     contra el Drive REAL. Cubre putItf / metaItf / getItf / trashItf con JPEG y PNG, la seguridad HMAC, el aislamiento entre las tres raices y la
//     regresion de Fotos y Reemplazos (PNG sigue rechazado). No toca ningun archivo existente: solo crea y retira los suyos (papelera, nunca borrado
//     definitivo). Lo que NO cubre es el transporte (la URL /exec): eso lo mide preflightItfE9 del backend (check storage_itf).
var VERIF_FUENTE_SMOKE = 'SMOKE_ITF_E9';
var VERIF_PREFIJO_ARCHIVO = 'smoke-itf-e9-';
var VERIF_MAX_NIVELES = 12;
var VERIF_RAICES = [
  { clave: 'FOTOS_ROOT_FOLDER_ID', nombre: 'FotosReemplazo', etiqueta: 'Reemplazos' },
  { clave: 'FOTOS_POZOS_ROOT_FOLDER_ID', nombre: 'FotosPozos', etiqueta: 'Pozos' },
  { clave: 'ITF_ROOT_FOLDER_ID', nombre: 'ItfPropuestas', etiqueta: 'ITF' }
];
// JPEG valido de 1x1 px y PNG valido de 1x1 px (IHDR / IDAT / IEND con CRC correctos).
var VERIF_JPEG_B64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
var VERIF_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

function verif_nuevoInforme() {
  return { ok: true, checks: [] };
}

// Registra un chequeo y lo loguea. Solo cuenta como OK lo que es exactamente true. El detalle nunca debe llevar secretos ni ids.
function verif_anotar(inf, nombre, condicion, detalle) {
  var ok = condicion === true;
  if (!ok) {
    inf.ok = false;
  }
  inf.checks.push({ nombre: nombre, ok: ok });
  Logger.log((ok ? 'OK    ' : 'FALLA ') + nombre + (!ok && detalle ? ' -> ' + detalle : ''));
  return ok;
}

// Mensaje de una excepcion, acotado y sin ids de Drive (cadenas largas de [A-Za-z0-9_-]).
function verif_mensaje(err) {
  var m = String(err && err.message ? err.message : err).replace(/[A-Za-z0-9_-]{25,}/g, '<id>');
  return m.length > 120 ? m.substring(0, 120) : m;
}

// Ids de todos los ancestros de una carpeta o archivo (primer padre de cada nivel).
function verif_ancestros(item) {
  var ids = [];
  var actual = item;
  for (var i = 0; i < VERIF_MAX_NIVELES; i++) {
    var it = actual.getParents();
    if (!it.hasNext()) {
      break;
    }
    actual = it.next();
    ids.push(actual.getId());
  }
  return ids;
}

// Cantidad de archivos VIVOS (fuera de la papelera) bajo una carpeta, recursivo. Solo se usa con la raiz de ITF (chica), nunca con las de Fotos.
function verif_contarVivos(carpeta) {
  var n = 0;
  var archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    archivos.next();
    n++;
  }
  var hijas = carpeta.getFolders();
  while (hijas.hasNext()) {
    n += verif_contarVivos(hijas.next());
  }
  return n;
}

function verificarRaicesStorage() {
  var inf = verif_nuevoInforme();
  var props = PropertiesService.getScriptProperties();
  var secreto = props.getProperty('FOTOS_STORAGE_SECRET');
  verif_anotar(inf, 'secreto HMAC configurado (minimo ' + STORAGE_SECRET_MIN_LENGTH + ' caracteres)', typeof secreto === 'string' && secreto.length >= STORAGE_SECRET_MIN_LENGTH);

  var ids = [];
  var carpetas = [];
  for (var i = 0; i < VERIF_RAICES.length; i++) {
    var r = VERIF_RAICES[i];
    var id = props.getProperty(r.clave);
    var configurada = verif_anotar(inf, r.clave + ' configurada', typeof id === 'string' && id.length > 0);
    var carpeta = null;
    if (configurada) {
      try {
        carpeta = DriveApp.getFolderById(id);
      } catch (err) {
        carpeta = null;
      }
    }
    var accesible = verif_anotar(inf, 'raiz ' + r.etiqueta + ' accesible', carpeta !== null);
    if (accesible) {
      verif_anotar(inf, 'raiz ' + r.etiqueta + ' se llama ' + r.nombre, carpeta.getName() === r.nombre);
      verif_anotar(inf, 'raiz ' + r.etiqueta + ' fuera de la papelera', carpeta.isTrashed() === false);
    }
    ids.push(configurada ? id : null);
    carpetas.push(accesible ? carpeta : null);
  }

  var completas = ids.every(function (x) { return x !== null; });
  var distintas = completas && ids[0] !== ids[1] && ids[0] !== ids[2] && ids[1] !== ids[2];
  verif_anotar(inf, 'las tres raices (Reemplazos, Pozos, ITF) son carpetas DISTINTAS', distintas);

  var anidada = !completas || carpetas.some(function (c) { return c === null; });
  if (!anidada) {
    for (var a = 0; a < carpetas.length; a++) {
      var ancestros = verif_ancestros(carpetas[a]);
      for (var b = 0; b < ids.length; b++) {
        if (a !== b && ancestros.indexOf(ids[b]) >= 0) {
          anidada = true;
        }
      }
    }
  }
  verif_anotar(inf, 'ninguna raiz cuelga de otra', !anidada);

  Logger.log('VERIFICACION DE RAICES: ' + (inf.ok ? 'OK' : 'FALLO'));
  return inf;
}

// --- Cliente HMAC en proceso ---

// Solicitud firmada exactamente como la arma el backend principal (FotosStorageClient): v, action, ts, nonce, payload (JSON en texto), sig.
function verif_firmar(accion, payloadObj, ts) {
  var secreto = getStorageSecret();
  var marca = ts === undefined ? Math.floor(Date.now() / 1000) : ts;
  var nonce = Utilities.getUuid();
  var payload = JSON.stringify(payloadObj);
  return { v: STORAGE_AUTH_VERSION, action: accion, ts: marca, nonce: nonce, payload: payload, sig: storageAuth_firmar(secreto, accion, marca, nonce, payload) };
}

// Envia un cuerpo ya armado por la misma funcion que usa doPost y devuelve la respuesta ya interpretada:
// {status, code, ..., _firmada} donde _firmada es true solo si la respuesta trae la firma correcta del servidor y el mismo nonce.
function verif_enviar(cuerpo) {
  var salida = storageApi_procesar(JSON.stringify(cuerpo));
  if (!salida || typeof salida.payload !== 'string') {
    return { status: salida && salida.status, code: salida && salida.code, _firmada: false };
  }
  var esperada = storageAuth_firmar(getStorageSecret(), 'response', salida.ts, salida.nonce, salida.payload);
  var firmada = salida.nonce === cuerpo.nonce && storageAuth_igualesConstante(esperada, salida.sig);
  var datos = JSON.parse(salida.payload);
  datos._firmada = firmada;
  return datos;
}

function verif_llamar(accion, payloadObj) {
  return verif_enviar(verif_firmar(accion, payloadObj));
}

function verif_esError(r, code) {
  return !!r && r.status === 'error' && r.code === code;
}

// Rechazo SIN respuesta firmada: la solicitud nunca llego a ejecutarse.
function verif_noAutorizada(r) {
  return verif_esError(r, 'UNAUTHORIZED') && r._firmada === false;
}

function verif_bytesDeBase64(b64) {
  var relleno = b64.slice(-2) === '==' ? 2 : (b64.slice(-1) === '=' ? 1 : 0);
  return Math.floor(b64.length * 3 / 4) - relleno;
}

// Si una respuesta trae un archivo creado, se anota para que la limpieza final lo retire aunque el chequeo que lo origino haya fallado.
function verif_registrar(lista, respuesta) {
  if (respuesta && respuesta.status === 'ok' && typeof respuesta.driveFileId === 'string' && lista.indexOf(respuesta.driveFileId) < 0) {
    lista.push(respuesta.driveFileId);
  }
}

function verif_estaVivo(id) {
  try {
    return DriveApp.getFileById(id).isTrashed() === false;
  } catch (err) {
    return false;
  }
}

function verif_estaEnPapelera(id) {
  try {
    return DriveApp.getFileById(id).isTrashed() === true;
  } catch (err) {
    return false;
  }
}

// Ciclo completo de un documento ITF (JPEG o PNG): put -> meta -> get -> re-put idempotente -> intentos desde Fotos / Reemplazos -> trash.
function verif_cicloItf(inf, creados, etiqueta, mime, b64, extension, itfRaizId) {
  var documentoId = Utilities.getUuid();
  var tamano = verif_bytesDeBase64(b64);
  var put = verif_llamar('putItf', { documentoId: documentoId, mimeType: mime, imagenBase64: b64 });
  verif_registrar(creados.itf, put);
  var guardado = verif_anotar(inf, etiqueta + ': putItf ok, respuesta firmada, documento nuevo y tamano igual al enviado',
    put.status === 'ok' && put._firmada === true && put.existente === false && put.tamanoBytes === tamano, 'status=' + put.status + ' code=' + put.code);
  if (!guardado) {
    return;
  }

  var archivo = DriveApp.getFileById(put.driveFileId);
  verif_anotar(inf, etiqueta + ': nombre fisico = documentoId + extension (no el nombre original)', archivo.getName() === documentoId.toLowerCase() + extension, 'nombre inesperado');
  var ancestros = verif_ancestros(archivo);
  verif_anotar(inf, etiqueta + ': cuelga de ItfPropuestas/<anio>/ (2 niveles) y solo de la raiz ITF', ancestros.length >= 2 && ancestros[1] === itfRaizId, 'ubicacion inesperada');

  var meta = verif_llamar('metaItf', { driveFileId: put.driveFileId });
  verif_anotar(inf, etiqueta + ': metaItf devuelve mime y tamano sin entregar el contenido',
    meta.status === 'ok' && meta._firmada === true && meta.mimeType === mime && meta.tamanoBytes === tamano && meta.imagenBase64 === undefined, 'status=' + meta.status + ' code=' + meta.code);

  var get = verif_llamar('getItf', { driveFileId: put.driveFileId });
  verif_anotar(inf, etiqueta + ': getItf devuelve exactamente los bytes y el mime enviados',
    get.status === 'ok' && get._firmada === true && get.mimeType === mime && get.imagenBase64 === b64 && get.tamanoBytes === tamano, 'status=' + get.status + ' code=' + get.code);

  var otra = verif_llamar('putItf', { documentoId: documentoId, mimeType: mime, imagenBase64: b64 });
  verif_registrar(creados.itf, otra);
  verif_anotar(inf, etiqueta + ': reintento del mismo documento es idempotente (mismo archivo, sin duplicar)',
    otra.status === 'ok' && otra.existente === true && otra.driveFileId === put.driveFileId, 'status=' + otra.status + ' code=' + otra.code);

  var intentos = [
    verif_llamar('getFoto', { driveFileId: put.driveFileId, variante: 'full' }),
    verif_llamar('getFotoPozo', { driveFileId: put.driveFileId, variante: 'full' }),
    verif_llamar('trashFoto', { driveFileId: put.driveFileId }),
    verif_llamar('trashFotoPozo', { driveFileId: put.driveFileId })
  ];
  verif_anotar(inf, etiqueta + ': getFoto / getFotoPozo / trashFoto / trashFotoPozo sobre el archivo ITF -> NOT_FOUND y el archivo sigue vivo',
    intentos.every(function (r) { return verif_esError(r, 'NOT_FOUND'); }) && verif_estaVivo(put.driveFileId), 'una accion de Fotos alcanzo un archivo de ITF');

  var papelera = verif_llamar('trashItf', { driveFileId: put.driveFileId });
  verif_anotar(inf, etiqueta + ': trashItf manda ese archivo a la papelera (nunca borrado definitivo)',
    papelera.status === 'ok' && papelera._firmada === true && verif_estaEnPapelera(put.driveFileId), 'status=' + papelera.status + ' code=' + papelera.code);
}

// Quita (a la papelera) la carpeta que el smoke creo, solo si NO existia antes y quedo sin archivos.
function verif_retirarCarpetaCreada(padre, nombre, existiaAntes) {
  if (existiaAntes) {
    return;
  }
  var it = padre.getFoldersByName(nombre);
  while (it.hasNext()) {
    var carpeta = it.next();
    if (verif_contarVivos(carpeta) === 0) {
      carpeta.setTrashed(true);
    }
  }
}

function smokeItfStorage() {
  var inf = verif_nuevoInforme();
  var raices = verificarRaicesStorage();
  if (!raices.ok) {
    verif_anotar(inf, 'raices bien configuradas (el smoke no se ejecuta si no)', false, 'corregir primero verificarRaicesStorage');
    Logger.log('SMOKE ITF STORAGE: NO SE EJECUTO');
    return inf;
  }

  var itfRaizId = getStorageItfRootFolderId();
  var pozosRaiz = DriveApp.getFolderById(getStoragePozosRootFolderId());
  var reemplazosRaiz = DriveApp.getFolderById(getStorageRootFolderId());
  var anio = String(new Date().getFullYear());
  var fuenteExistia = pozosRaiz.getFoldersByName(VERIF_FUENTE_SMOKE).hasNext();
  var anioExistia = reemplazosRaiz.getFoldersByName(anio).hasNext();
  var vivosAntes = verif_contarVivos(DriveApp.getFolderById(itfRaizId));
  var creados = { itf: [], pozos: [], reemplazos: [], fuera: [] };
  var sufijo = Utilities.getUuid().substring(0, 8);

  try {
    // 1) Fixtures de Fotos y Reemplazos (nuevos, con nombre de smoke) y un archivo FUERA de las tres raices.
    var fotoPozoId = Utilities.getUuid();
    var pozo = verif_llamar('putFotoPozo', { fotoId: fotoPozoId, fuente: VERIF_FUENTE_SMOKE, carpetaFecha: 'sin_fecha', mimeType: 'image/jpeg', imagenBase64: VERIF_JPEG_B64, thumbBase64: VERIF_JPEG_B64 });
    var pozoOk = verif_anotar(inf, 'Fotos (Pozos): putFotoPozo JPEG sigue funcionando', pozo.status === 'ok' && pozo._firmada === true, 'status=' + pozo.status + ' code=' + pozo.code);
    verif_registrar(creados.pozos, pozo);
    verif_registrar(creados.pozos, { status: pozo.status, driveFileId: pozo.driveThumbId });

    var fotoId = Utilities.getUuid();
    var nombreRee = VERIF_PREFIJO_ARCHIVO + sufijo + '.jpg';
    var ree = verif_llamar('putFoto', { fotoId: fotoId, evaluacionId: Utilities.getUuid(), wellId: '00-0000', nombreArchivo: nombreRee, mimeType: 'image/jpeg', imagenBase64: VERIF_JPEG_B64, thumbBase64: VERIF_JPEG_B64 });
    var reeOk = verif_anotar(inf, 'Reemplazos: putFoto JPEG sigue funcionando', ree.status === 'ok' && ree._firmada === true, 'status=' + ree.status + ' code=' + ree.code);
    verif_registrar(creados.reemplazos, ree);
    if (ree.status === 'ok' && typeof ree.driveFileId === 'string') {
      var m = /^thumb:([A-Za-z0-9_-]{10,100})$/.exec(DriveApp.getFileById(ree.driveFileId).getDescription() || '');
      if (m) {
        creados.reemplazos.push(m[1]);
      }
    }

    var fuera = DriveApp.getRootFolder().createFile(Utilities.newBlob(Utilities.base64Decode(VERIF_JPEG_B64), 'image/jpeg', VERIF_PREFIJO_ARCHIVO + 'fuera-de-raiz-' + sufijo + '.jpg'));
    creados.fuera.push(fuera.getId());

    // 2) ITF: JPEG y PNG, ciclo completo.
    verif_cicloItf(inf, creados, 'ITF JPEG', 'image/jpeg', VERIF_JPEG_B64, '.jpg', itfRaizId);
    verif_cicloItf(inf, creados, 'ITF PNG', 'image/png', VERIF_PNG_B64, '.png', itfRaizId);

    // 3) ITF no alcanza nada fuera de su raiz: ni archivos de Fotos / Reemplazos ni cualquier otro archivo de la cuenta.
    var ajenos = [];
    if (pozoOk) { ajenos.push({ nombre: 'un archivo de Fotos (Pozos)', id: pozo.driveFileId }); }
    if (reeOk) { ajenos.push({ nombre: 'un archivo de Reemplazos', id: ree.driveFileId }); }
    ajenos.push({ nombre: 'un archivo fuera de las tres raices', id: fuera.getId() });
    ajenos.forEach(function (a) {
      var g = verif_llamar('getItf', { driveFileId: a.id });
      var me = verif_llamar('metaItf', { driveFileId: a.id });
      var t = verif_llamar('trashItf', { driveFileId: a.id });
      verif_anotar(inf, 'aislamiento: getItf / metaItf / trashItf sobre ' + a.nombre + ' -> NOT_FOUND y el archivo sigue vivo',
        verif_esError(g, 'NOT_FOUND') && verif_esError(me, 'NOT_FOUND') && verif_esError(t, 'NOT_FOUND') && verif_estaVivo(a.id), 'ITF alcanzo un archivo ajeno');
    });

    // 4) Seguridad HMAC: todo debe fallar cerrado, SIN respuesta firmada y sin ejecutar nada.
    var ahora = Math.floor(Date.now() / 1000);
    var idInexistente = 'smokeItfE9SinArchivoAlguno';
    var firmaMala = verif_firmar('metaItf', { driveFileId: idInexistente });
    firmaMala.sig = firmaMala.sig.substring(0, firmaMala.sig.length - 1) + (firmaMala.sig.slice(-1) === '0' ? '1' : '0');
    verif_anotar(inf, 'HMAC: firma invalida -> UNAUTHORIZED', verif_noAutorizada(verif_enviar(firmaMala)), 'la firma alterada fue aceptada');

    var alterada = verif_firmar('metaItf', { driveFileId: idInexistente });
    alterada.action = 'trashItf';
    verif_anotar(inf, 'HMAC: accion alterada con la firma de otra -> UNAUTHORIZED', verif_noAutorizada(verif_enviar(alterada)), 'la accion alterada fue aceptada');

    var vencida = verif_firmar('metaItf', { driveFileId: idInexistente }, ahora - 3600);
    verif_anotar(inf, 'HMAC: timestamp vencido (firma correcta) -> UNAUTHORIZED', verif_noAutorizada(verif_enviar(vencida)), 'el timestamp vencido fue aceptado');

    var futura = verif_firmar('metaItf', { driveFileId: idInexistente }, ahora + 3600);
    verif_anotar(inf, 'HMAC: timestamp del futuro (firma correcta) -> UNAUTHORIZED', verif_noAutorizada(verif_enviar(futura)), 'el timestamp futuro fue aceptado');

    var original = verif_firmar('metaItf', { driveFileId: idInexistente });
    var primera = verif_enviar(original);
    var repetida = verif_enviar(original);
    verif_anotar(inf, 'HMAC: la solicitud valida se procesa una vez (NOT_FOUND firmado) y su replay -> UNAUTHORIZED',
      verif_esError(primera, 'NOT_FOUND') && primera._firmada === true && verif_noAutorizada(repetida), 'replay aceptado o solicitud valida rechazada');

    var sinFirma = verif_firmar('metaItf', { driveFileId: idInexistente });
    delete sinFirma.sig;
    verif_anotar(inf, 'HMAC: solicitud sin firma -> UNAUTHORIZED', verif_noAutorizada(verif_enviar(sinFirma)), 'una solicitud sin firma fue aceptada');

    // 5) Entradas invalidas de putItf: nada se crea.
    var invalidos = [
      { nombre: 'documentoId que no es UUID', p: { documentoId: 'no-es-un-uuid', mimeType: 'image/jpeg', imagenBase64: VERIF_JPEG_B64 }, code: 'INVALID_DOCUMENTO_ID' },
      { nombre: 'documentoId con ruta (../)', p: { documentoId: '../../etc/passwd', mimeType: 'image/jpeg', imagenBase64: VERIF_JPEG_B64 }, code: 'INVALID_DOCUMENTO_ID' },
      { nombre: 'PNG declarado como JPEG', p: { documentoId: Utilities.getUuid(), mimeType: 'image/jpeg', imagenBase64: VERIF_PNG_B64 }, code: 'INVALID_IMAGEN' },
      { nombre: 'JPEG declarado como PNG', p: { documentoId: Utilities.getUuid(), mimeType: 'image/png', imagenBase64: VERIF_JPEG_B64 }, code: 'INVALID_IMAGEN' },
      { nombre: 'mime no permitido (GIF)', p: { documentoId: Utilities.getUuid(), mimeType: 'image/gif', imagenBase64: VERIF_JPEG_B64 }, code: 'INVALID_MIME' },
      { nombre: 'clave de mas en el payload', p: { documentoId: Utilities.getUuid(), mimeType: 'image/jpeg', imagenBase64: VERIF_JPEG_B64, nombreArchivo: 'x.jpg' }, code: 'MALFORMED' }
    ];
    invalidos.forEach(function (c) {
      var r = verif_llamar('putItf', c.p);
      verif_registrar(creados.itf, r);
      verif_anotar(inf, 'putItf invalido (' + c.nombre + ') -> ' + c.code, verif_esError(r, c.code), 'no fallo cerrado');
    });
    verif_anotar(inf, 'getItf / metaItf / trashItf con driveFileId invalido -> NOT_FOUND',
      ['getItf', 'metaItf', 'trashItf'].every(function (a) { return verif_esError(verif_llamar(a, { driveFileId: '../x' }), 'NOT_FOUND'); }), 'un id invalido no fallo cerrado');

    // 6) Regresion de Fotos y Reemplazos: lectura, miniatura, PNG rechazado y papelera de sus propios archivos.
    if (pozoOk) {
      var pg = verif_llamar('getFotoPozo', { driveFileId: pozo.driveFileId, driveThumbId: pozo.driveThumbId, variante: 'full' });
      var pt = verif_llamar('getFotoPozo', { driveFileId: pozo.driveFileId, driveThumbId: pozo.driveThumbId, variante: 'thumb' });
      verif_anotar(inf, 'Fotos (Pozos): getFotoPozo completa y miniatura = bytes enviados, image/jpeg',
        pg.status === 'ok' && pg.mimeType === 'image/jpeg' && pg.imagenBase64 === VERIF_JPEG_B64 && pt.status === 'ok' && pt.imagenBase64 === VERIF_JPEG_B64, 'status=' + pg.status + '/' + pt.status);
      var pozoArchivo = DriveApp.getFileById(pozo.driveFileId);
      verif_anotar(inf, 'Fotos (Pozos): el archivo cuelga de la raiz de Pozos y NO de la de ITF',
        verif_ancestros(pozoArchivo).indexOf(pozosRaiz.getId()) >= 0 && verif_ancestros(pozoArchivo).indexOf(itfRaizId) < 0, 'ubicacion inesperada');
      var pngPozo = verif_llamar('putFotoPozo', { fotoId: Utilities.getUuid(), fuente: VERIF_FUENTE_SMOKE, carpetaFecha: 'sin_fecha', mimeType: 'image/png', imagenBase64: VERIF_PNG_B64, thumbBase64: VERIF_JPEG_B64 });
      var pngPozoJpg = verif_llamar('putFotoPozo', { fotoId: Utilities.getUuid(), fuente: VERIF_FUENTE_SMOKE, carpetaFecha: 'sin_fecha', mimeType: 'image/jpeg', imagenBase64: VERIF_PNG_B64, thumbBase64: VERIF_JPEG_B64 });
      verif_anotar(inf, 'Fotos (Pozos): un PNG sigue rechazado (INVALID_MIME / INVALID_IMAGEN)', verif_esError(pngPozo, 'INVALID_MIME') && verif_esError(pngPozoJpg, 'INVALID_IMAGEN'), 'Fotos acepto un PNG');
      var tp = verif_llamar('trashFotoPozo', { driveFileId: pozo.driveFileId });
      verif_anotar(inf, 'Fotos (Pozos): trashFotoPozo manda foto y miniatura a la papelera',
        tp.status === 'ok' && verif_estaEnPapelera(pozo.driveFileId) && verif_estaEnPapelera(pozo.driveThumbId), 'status=' + tp.status + ' code=' + tp.code);
    }
    if (reeOk) {
      var rg = verif_llamar('getFoto', { driveFileId: ree.driveFileId, variante: 'full' });
      var rt = verif_llamar('getFoto', { driveFileId: ree.driveFileId, variante: 'thumb' });
      verif_anotar(inf, 'Reemplazos: getFoto completa y miniatura = bytes enviados, image/jpeg',
        rg.status === 'ok' && rg.mimeType === 'image/jpeg' && rg.imagenBase64 === VERIF_JPEG_B64 && rt.status === 'ok' && rt.imagenBase64 === VERIF_JPEG_B64, 'status=' + rg.status + '/' + rt.status);
      var reeArchivo2 = DriveApp.getFileById(ree.driveFileId);
      verif_anotar(inf, 'Reemplazos: el archivo cuelga de la raiz de Reemplazos y NO de la de ITF',
        verif_ancestros(reeArchivo2).indexOf(reemplazosRaiz.getId()) >= 0 && verif_ancestros(reeArchivo2).indexOf(itfRaizId) < 0, 'ubicacion inesperada');
      var pngRee = verif_llamar('putFoto', { fotoId: Utilities.getUuid(), evaluacionId: Utilities.getUuid(), wellId: '00-0000', nombreArchivo: VERIF_PREFIJO_ARCHIVO + sufijo + '-png.jpg', mimeType: 'image/png', imagenBase64: VERIF_PNG_B64, thumbBase64: VERIF_JPEG_B64 });
      verif_anotar(inf, 'Reemplazos: un PNG sigue rechazado (INVALID_MIME)', verif_esError(pngRee, 'INVALID_MIME'), 'Reemplazos acepto un PNG');
      var tr = verif_llamar('trashFoto', { driveFileId: ree.driveFileId });
      verif_anotar(inf, 'Reemplazos: trashFoto manda foto y miniatura a la papelera',
        tr.status === 'ok' && creados.reemplazos.every(verif_estaEnPapelera), 'status=' + tr.status + ' code=' + tr.code);
    }
  } catch (err) {
    verif_anotar(inf, 'el smoke termino sin excepciones', false, verif_mensaje(err));
  } finally {
    // 7) Limpieza: todo lo que el smoke creo y siga vivo va a la papelera (nunca borrado definitivo). Solo ids creados por esta corrida.
    var retirados = 0;
    try {
      [].concat(creados.itf, creados.pozos, creados.reemplazos, creados.fuera).forEach(function (id) {
        if (verif_estaVivo(id)) {
          DriveApp.getFileById(id).setTrashed(true);
          retirados++;
        }
      });
      verif_retirarCarpetaCreada(pozosRaiz, VERIF_FUENTE_SMOKE, fuenteExistia);
      verif_retirarCarpetaCreada(reemplazosRaiz, anio, anioExistia);
    } catch (err2) {
      verif_anotar(inf, 'limpieza de los archivos de smoke', false, verif_mensaje(err2));
    }
    Logger.log('Archivos de smoke retirados en la limpieza final (los que quedaban vivos): ' + retirados);
  }

  var creadosTotal = [].concat(creados.itf, creados.pozos, creados.reemplazos, creados.fuera);
  verif_anotar(inf, 'ningun archivo de smoke queda vivo (' + creadosTotal.length + ' creados)', creadosTotal.every(verif_estaEnPapelera), 'quedan archivos de smoke vivos');
  var vivosDespues = verif_contarVivos(DriveApp.getFolderById(itfRaizId));
  verif_anotar(inf, 'la raiz ITF tiene los mismos archivos vivos que antes del smoke (' + vivosAntes + ')', vivosDespues === vivosAntes, 'antes=' + vivosAntes + ' despues=' + vivosDespues);

  Logger.log('SMOKE ITF STORAGE: ' + (inf.ok ? 'OK' : 'FALLO') + ' (' + inf.checks.filter(function (c) { return c.ok; }).length + '/' + inf.checks.length + ' chequeos)');
  return inf;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VERIF_FUENTE_SMOKE,
    VERIF_JPEG_B64,
    VERIF_PNG_B64,
    verificarRaicesStorage,
    smokeItfStorage
  };
}
