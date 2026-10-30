// Contrato de E9-2 (ITF colaborativos): lo que esta etapa NO hace (sin endpoints, sin permisos nuevos, sin tocar el Perfil actual, sin hoja real, sin frontend) y lo que la documentacion debe decir.
// Si alguno de estos tests falla, alguien cableo E9 antes de tiempo: la etapa siguiente (E9-3) es la que actualiza estas guardas, no un cambio de pasada.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');
const leer = (...partes) => fs.readFileSync(path.join(RAIZ, ...partes), 'utf8');
const SRC = (nombre) => leer('backend', 'src', nombre);
const DOC = () => leer('docs', 'itf-colaborativos.md');
// codigo sin comentarios (los comentarios documentan y nombran cosas; las guardas miran lo que se EJECUTA)
const CODIGO = (nombre) => SRC(nombre).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const MODULOS_NUEVOS = ['ItfArchivoLogic.js', 'ItfDominioService.js', 'ItfEventosRepository.js', 'ItfLegacyAuditoria.js', 'ItfLegacyProvider.js', 'ItfPreflight.js', 'ItfStorageProvider.js', 'ItfService.js'];
const MARCAS_E9 = /itfDominio_|itfEventosRepository_|itfArchivo_|itfLegacy_|itfStorage_|itfService_|itfAuditoria_|auditarCarpetaItfLegacy|ItfLegacyAuditoria|setupItfEventosSheet|ItfEventos|ItfArchivoLogic|ItfDominioService|ItfLegacyProvider|ItfStorageProvider|ItfService|ITF_E9_ACTIVO|perfil_subir|perfil_validar|itfTieneVigente/;

describe('E9-2 no esta cableado: ningun archivo vivo de la app lo referencia', () => {
  test.each([
    'Config.js', 'ProfileService.js', 'ItfAvailabilityService.js', 'PozoExistenciaService.js',
    'SheetHistoryRepository.js', 'HistoryService.js', 'NotificationService.js', 'MapaService.js', 'FotosPozosService.js', 'FotosPozosModeracionService.js', 'RegistryService.js'
  ])('backend/src/%s no usa los modulos de E9', (archivo) => {
    expect(SRC(archivo)).not.toMatch(MARCAS_E9);
  });

  test('DriveProfileRepository: getFile / existe / listarArchivosThumb siguen IGUAL; solo se agregaron buscarPorNombre, buscarCandidatosLegacy y leerPorId (que usa el proveedor legacy) y el codigo no menciona a E9', () => {
    const src = CODIGO('DriveProfileRepository.js');
    expect(src).toMatch(/folder\.getFilesByName\(wellId \+ '\.jpg'\);\n  if \(!files\.hasNext\(\)\) \{\n    return \{ found: false \};\n  \}\n  var file = files\.next\(\);\n  return \{ found: true, blob: file\.getBlob\(\) \};/);
    expect(src).toMatch(/return folder\.getFilesByName\(wellId \+ '\.jpg'\)\.hasNext\(\);/);
    expect(src).not.toMatch(MARCAS_E9);
    const m = require('../src/DriveProfileRepository');
    expect(Object.keys(m).sort()).toEqual(['driveProfileRepository_buscarCandidatosLegacy', 'driveProfileRepository_buscarPorNombre', 'driveProfileRepository_existe', 'driveProfileRepository_getFile', 'driveProfileRepository_leerPorId', 'driveProfileRepository_listarArchivosThumb']);
  });

  // E9-6 (UI local): el frontend SI conoce los permisos perfil_subir / perfil_validar (compuertas exactas de la UI), pero NUNCA el interior del backend: la hoja de eventos, el dominio, el servicio, el proveedor legacy ni el interruptor.
  test('el frontend (index.html, sw.js, js/*.js, css) no menciona el interior de E9: ItfEventos, dominio, servicio, legacy ni el interruptor', () => {
    const archivos = ['index.html', 'sw.js', path.join('css', 'styles.css')];
    fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => archivos.push(path.join('js', f)));
    archivos.forEach((f) => {
      expect({ archivo: f, menciona: /ItfEventos|itfDominio_|itfService_|itfLegacy_|itfTieneVigente|ITF_E9_ACTIVO/.test(leer(f)) }).toEqual({ archivo: f, menciona: false });
    });
  });

  test('E9-6: los permisos perfil_subir / perfil_validar solo aparecen en la UI de ITF, el cableado del hub y los comentarios del HTML (ningun otro modulo los usa)', () => {
    const permitidos = ['index.html', 'js/app.js', 'js/api.js', 'js/itfLogic.js', 'js/itfFlujosLogic.js', 'js/itfPerfil.js', 'js/itfModeracion.js'];
    const archivos = ['index.html', 'sw.js', path.join('css', 'styles.css')];
    fs.readdirSync(path.join(RAIZ, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => archivos.push(path.join('js', f)));
    archivos.forEach((f) => {
      const menciona = /perfil_subir|perfil_validar/.test(leer(f));
      expect({ archivo: f, menciona: menciona && permitidos.indexOf(f.split(path.sep).join('/')) < 0 }).toEqual({ archivo: f, menciona: false });
    });
  });

  test('E9-4: perfil_subir y perfil_validar existen en el parser del backend (mismo patron exacto SI -> true, columna ausente -> false) pero NO hay UI ni frontend', () => {
    const src = SRC('SheetUserRepository.js');
    const permisos = /var USUARIOS_COLUMNAS_PERMISO = \[([^\]]*)\]/.exec(src)[1].split(',').map((c) => c.trim().replace(/'/g, ''));
    expect(permisos).toHaveLength(15);
    expect(permisos).toEqual(expect.arrayContaining(['perfil', 'perfil_subir', 'perfil_validar']));
    expect(SRC('AuthService.js')).toContain('perfil_subir: false, perfil_validar: false');
    expect(src).toContain('perfil_subir: false, perfil_validar: false');
  });

  test('E9-5: Api.js expone SOLO las rutas de ITF colaborativos esperadas y solo habla con el servicio (nunca con el dominio, la hoja, Drive ni el storage)', () => {
    const api = CODIGO('Api.js');
    ['proponerItf', 'getItfPendientes', 'getItfDocumentoModeracion', 'getHistorialItf', 'getMisPropuestasItf', 'aprobarItf', 'rechazarItf', 'retirarItf', 'revertirItf', 'retirarPropuestaItf'].forEach((accion) => {
      expect(api).toContain("body.action === '" + accion + "'");
    });
    const usadas = Array.from(new Set(api.match(/itf[A-Z][A-Za-z]*_\w+/g) || [])).sort();
    expect(usadas).toEqual(['itfService_disponibilidad', 'itfService_documentoModeracion', 'itfService_e9Activo', 'itfService_ejecutar', 'itfService_getProfile', 'itfService_historial', 'itfService_misPropuestas', 'itfService_pendientes']);
    expect(api).not.toMatch(/getItfEstado|itfPropuesta|PROPONER_Y_APROBAR|proponerYAprobar/i);
  });

  test('el Perfil actual sigue igual: getProfile y la disponibilidad se apoyan solo en Drive (<wellId>.jpg)', () => {
    expect(SRC('DriveProfileRepository.js')).toMatch(/getFilesByName\(wellId \+ '\.jpg'\)/);
    expect(SRC('ItfAvailabilityService.js')).toMatch(/driveProfileRepository_listarArchivosThumb/);
    expect(SRC('ProfileService.js')).not.toMatch(/itfDominio_|itfEventosRepository_|ItfEventos/);
  });

  test('PozoExistenciaService no cambio: sus fuentes siguen siendo PADRON, ITF (el archivo legacy), NE y CORRECCION_PREVIA; una propuesta no es una fuente', () => {
    const src = SRC('PozoExistenciaService.js');
    expect(src).toMatch(/POZO_EXISTENCIA_FUENTES = \{ PADRON: 'PADRON', ITF: 'ITF', NE: 'NE', CORRECCION_PREVIA: 'CORRECCION_PREVIA' \}/);
    expect(src).not.toMatch(/PROPUESTA|ItfEventos|itfDominio/i);
  });

  test('ninguna accion combinada: no existe "proponer y aprobar" en ninguna capa', () => {
    ['Api.js', 'ItfService.js', 'ItfDominioService.js'].forEach((archivo) => expect(CODIGO(archivo)).not.toMatch(/PROPONER_Y_APROBAR|proponerYAprobar|proponerYAprobarItf/));
  });

  test('los scripts del repo no ejecutan el setup de la hoja (scripts/gas)', () => {
    const gas = leer('scripts', 'gas', 'gas.js');
    expect(gas).not.toMatch(/setupItfEventosSheet|ItfEventos/);
  });
});

describe('los modulos nuevos', () => {
  test('existen exactamente estos archivos de E9 (mas el ItfAvailabilityService existente) en backend/src', () => {
    const itf = fs.readdirSync(path.join(RAIZ, 'backend', 'src')).filter((f) => /^Itf/.test(f)).sort();
    expect(itf).toEqual(['ItfArchivoLogic.js', 'ItfAvailabilityService.js', 'ItfDominioService.js', 'ItfEventosRepository.js', 'ItfLegacyAuditoria.js', 'ItfLegacyProvider.js', 'ItfPreflight.js', 'ItfService.js', 'ItfStorageProvider.js'].sort());
  });

  test.each(MODULOS_NUEVOS)('%s es ES5 de Apps Script (sin import / export / async / arrow / const / let)', (archivo) => {
    const fuente = SRC(archivo).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
    const sinExportsNode = fuente.split("if (typeof module !== 'undefined'")[0];
    expect(sinExportsNode).not.toMatch(/^\s*(import|export)\s/m);
    expect(sinExportsNode).not.toMatch(/=>/);
    expect(sinExportsNode).not.toMatch(/\basync\b|\bawait\b/);
    expect(sinExportsNode).not.toMatch(/^\s*(const|let)\s/m);
  });

  test.each(MODULOS_NUEVOS)('%s no tiene caracteres de control ni especiales literales en el codigo (se escriben como escapes)', (archivo) => {
    const raros = Array.from(SRC(archivo)).filter((c) => { const o = c.charCodeAt(0); return (o < 32 && o !== 10) || (o >= 0x2028 && o <= 0x2029) || (o >= 0x202A && o <= 0x202E) || (o >= 0x2066 && o <= 0x2069) || o === 0xFEFF; });
    expect(raros).toEqual([]);
  });

  test('los modulos no se llaman entre si mas alla de las constantes de ItfArchivoLogic', () => {
    expect(CODIGO('ItfEventosRepository.js')).not.toMatch(/itfDominio_|itfArchivo_/);
    expect(CODIGO('ItfArchivoLogic.js')).not.toMatch(/itfDominio_|itfEventosRepository_/);
    const dominio = CODIGO('ItfDominioService.js');
    expect(dominio).not.toMatch(/itfEventosRepository_|SpreadsheetApp|DriveApp|CacheService|LockService|UrlFetchApp|PropertiesService|Utilities/);
    expect(dominio).not.toMatch(/\bitfArchivo_/);       // solo usa las CONSTANTES ITF_* de ItfArchivoLogic, no sus funciones
    expect(CODIGO('ItfDominioService.js')).not.toMatch(/itfLegacy_|itfService_|itfStorage_/);                // el dominio no conoce a quien lo usa
  });

  test('el dominio y los validadores no dependen de Apps Script salvo el digest inyectable', () => {
    expect(CODIGO('ItfArchivoLogic.js')).not.toMatch(/SpreadsheetApp|DriveApp|CacheService|LockService|UrlFetchApp/);
    expect(CODIGO('ItfArchivoLogic.js').match(/Utilities\./g)).toHaveLength(2);                // computeDigest + DigestAlgorithm, solo como valor por defecto
  });

  test('E9-3: el servicio y el proveedor legacy no hablan con Drive ni con Sheets directamente (solo por los repositorios) y el servicio no usa Drive para los documentos E9', () => {
    expect(CODIGO('ItfService.js')).not.toMatch(/DriveApp|SpreadsheetApp|CacheService|LockService|UrlFetchApp/);
    expect(CODIGO('ItfLegacyProvider.js')).not.toMatch(/DriveApp|SpreadsheetApp|LockService|UrlFetchApp|PropertiesService/);
    expect(CODIGO('ItfStorageProvider.js')).not.toMatch(/DriveApp|SpreadsheetApp|CacheService|LockService|UrlFetchApp|PropertiesService/);        // habla con el storage SOLO por el cliente HMAC de Fotos
    expect(CODIGO('ItfService.js').match(/PropertiesService/g)).toHaveLength(1);                  // solo el interruptor ITF_E9_ACTIVO
  });

  test('E9-3: el servicio NO escribe Historial ni manda Telegram (esa auditoria sigue siendo de Api.js)', () => {
    expect(CODIGO('ItfService.js')).not.toMatch(/logHistoryEvent|sheetHistoryRepository|notificationService|telegram/i);
  });

  test('E9-3: el interruptor ITF_E9_ACTIVO vive solo en ItfService.js (Config.js no cambia)', () => {
    expect(SRC('Config.js')).not.toMatch(/ITF_E9/);
    expect(CODIGO('ItfService.js')).toMatch(/getProperty\(ITF_E9_PROPIEDAD\) === 'SI'/);
  });

  test('solo el repositorio sabe que existe la hoja ItfEventos', () => {
    expect(CODIGO('ItfDominioService.js')).not.toMatch(/SpreadsheetApp|getSheetByName/);
    expect(SRC('ItfEventosRepository.js')).toMatch(/var ITF_EVENTOS_HOJA = 'ItfEventos';/);
  });
});

describe('docs/itf-colaborativos.md', () => {
  test('existe y fija las decisiones cerradas de E9-1', () => {
    const d = DOC();
    expect(d).toMatch(/JPEG/);
    expect(d).toMatch(/PNG/);
    expect(d).toMatch(/NO PDF|sin PDF|no hay PDF/i);
    expect(d).toMatch(/autoaprobaci/i);
    expect(d).toMatch(/ItfEventos/);
    expect(d).toMatch(/LEGACY:<wellId>/);
    expect(d).toMatch(/ITF_LEGACY_REGISTRADO/);
    expect(d).toMatch(/append-only/i);
    expect(d).toMatch(/Tiene ITF/);
    expect(d).toMatch(/NO_DERIVABLE/);
  });

  test('declara la etapa y NO la marca productiva', () => {
    const d = DOC();
    expect(d).toMatch(/E9-2/);
    expect(d).toMatch(/NO productivo|no esta en produccion|todavia no esta en produccion/i);
    expect(d).not.toMatch(/E9 PRODUCTIVO/);
    expect(d).toMatch(/setupItfEventosSheet/);
    expect(d).toMatch(/NO se ejecut/i);
  });

  test('documenta todos los eventos, estados, motivos y el schema de 17 columnas', () => {
    const d = DOC();
    ['ITF_PROPUESTO', 'ITF_APROBADO', 'ITF_RECHAZADO', 'ITF_RETIRADO', 'ITF_REVERTIDO', 'ITF_LEGACY_REGISTRADO'].forEach((e) => expect(d).toContain(e));
    ['PROPUESTO', 'VIGENTE', 'REEMPLAZADO', 'RECHAZADO', 'RETIRADO', 'SIN_ITF', 'PENDIENTE'].forEach((e) => expect(d).toContain(e));
    ['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA', 'ACTUALIZACION', 'CORRECCION', 'MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO', 'ERROR_DE_APROBACION'].forEach((e) => expect(d).toContain(e));
    const columnas = require('../src/ItfEventosRepository').ITF_EVENTOS_COLUMNAS;
    columnas.forEach((c) => expect(d).toContain(c));
    expect(columnas).toHaveLength(17);
  });

  test('no contiene e-mails ni ids de Drive reales', () => {
    const d = DOC();
    expect(d).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(d).not.toMatch(/\b1[A-Za-z0-9_-]{32,43}\b/);                       // forma tipica de un id de Drive
    expect(d).not.toMatch(/script\.google\.com\/macros\/s\//);
  });

  test('registra lo que NO se pudo medir (sin sesion) en lugar de inventar cifras', () => {
    const d = DOC();
    expect(d).toMatch(/medir_itf_consola/);
    expect(d).toMatch(/no se pudo medir|NO se midio|sin sesion/i);
  });

  test('E9-3: documenta la etapa como local y no productiva, el interruptor, el retiro propio y la politica del legacy', () => {
    const d = DOC();
    expect(d).toMatch(/E9-3/);
    expect(d).toMatch(/ITF_E9_ACTIVO/);
    expect(d).toMatch(/RETIRAR_PROPUESTA/);
    expect(d).toMatch(/CANCELADO_POR_PROPONENTE/);
    ['LEGACY_AMBIGUO', 'LEGACY_CAMBIO', 'LEGACY_NOMBRE_NO_CANONICO', 'ITF_STATE_UNKNOWN', 'ITF_NOT_FOUND', 'VIGENTE_CAMBIO', 'ITF_STORAGE_NO_CONFIGURADO'].forEach((c) => expect(d).toContain(c));
    expect(d).toMatch(/itfService_resolverVigente/);
    expect(d).toMatch(/Q1/);
    expect(d).toMatch(/Q2/);
    expect(d).not.toMatch(/E9 PRODUCTIVO/);
  });

  test('el tamano maximo documentado coincide con el codigo', () => {
    const { ITF_ARCHIVO_BYTES_MAX } = require('../src/ItfArchivoLogic');
    expect(ITF_ARCHIVO_BYTES_MAX).toBe(3145728);
    expect(DOC()).toMatch(/3 MB/);
    expect(DOC()).toMatch(/3\.145\.728|3145728/);
  });
});

describe('docs/itf-colaborativos.md: E9-4', () => {
  test('documenta la etapa como local, el flujo A-Q, el limite provisional, la auditoria legacy y la raiz aislada', () => {
    const d = DOC();
    expect(d).toMatch(/## 15\. E9-4/);
    expect(d).toMatch(/NO productivo/);
    expect(d).toMatch(/ITF_E9_INACTIVO/);
    expect(d).toMatch(/proponerItf/);
    expect(d).toMatch(/PROVISIONAL/);
    expect(d).toMatch(/4\.194\.304/);
    expect(d).toMatch(/auditarCarpetaItfLegacy/);
    expect(d).toMatch(/ItfPropuestas/);
    expect(d).toMatch(/putItf/);
    expect(d).toMatch(/TOO_MANY_PENDING/);
    expect(d).toMatch(/MISMO_HASH_OTRO_POZO/);
    expect(d).toMatch(/FUERA del lock/);
    expect(d).toMatch(/Desviaciones/);
  });
  test('la auditoria legacy no la llama ningun archivo vivo de la app', () => {
    ['Api.js', 'Config.js', 'ProfileService.js', 'ItfService.js', 'ItfLegacyProvider.js', 'ItfAvailabilityService.js'].forEach((archivo) => {
      expect(CODIGO(archivo)).not.toMatch(/itfAuditoria_|auditarCarpetaItfLegacy|ItfLegacyAuditoria/);
    });
  });
});

describe('docs/itf-colaborativos.md: E9-5', () => {
  test('documenta la etapa como local y no productiva, los endpoints, la cola, la paginacion, la aprobacion, el reemplazo, el rechazo, el retiro, la reversion, la autoaprobacion, el historial y la concurrencia', () => {
    const d = DOC();
    expect(d).toMatch(/## 16\. E9-5/);
    expect(d).toMatch(/E9-5[^\n]*NO productivo/);
    ['getItfPendientes', 'getItfDocumentoModeracion', 'getHistorialItf', 'aprobarItf', 'rechazarItf', 'retirarItf', 'revertirItf', 'retirarPropuestaItf', 'vigenteEsperadoDocumentoId',
      'VIGENTE_CAMBIO', 'ITF_ARCHIVO_NO_DISPONIBLE', 'LEGACY_CAMBIO', 'LEGACY_NO_DISPONIBLE', 'CANCELADO_POR_PROPONENTE', 'DESTINO_INVALIDO', 'siguienteCursor'].forEach((t) => expect(d).toContain(t));
    expect(d).toMatch(/autoaprobaci/i);
    expect(d).toMatch(/no mueven archivos/i);
    expect(d).toMatch(/UNA lectura de `ItfEventos`/);
    expect(d).toMatch(/no restaura el anterior/);
    expect(d).toMatch(/auditarCarpetaItfLegacy/);
  });
  test('los DTO de E9-5 no llevan hash (ni su prefijo), storage, email, clientRequestId ni secuencia: lo dicen el codigo y las pruebas', () => {
    const dom = CODIGO('ItfDominioService.js');
    const bloque = dom.slice(dom.indexOf('function itfDominio_dtoPendiente'), dom.indexOf("if (typeof module !== 'undefined'"));
    expect(bloque).not.toMatch(/sha256|huella|storageFileId|\.email|clientRequestId|secuencia:/);
  });
});
