const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();
global.Logger = { log: jest.fn() };

// En Apps Script todos los archivos comparten el scope global; en Jest se publica a mano
const Reemplazo = require('../src/FotosReemplazoService');
global.fotosService_bytesDeBase64 = Reemplazo.fotosService_bytesDeBase64;
global.fotosService_esJpeg = Reemplazo.fotosService_esJpeg;
global.fotosService_limpiar = Reemplazo.fotosService_limpiar;
const Service = require('../src/FotosPozosService');

const WELL = '04-0263';
const AHORA = new Date('2026-10-06T15:00:00Z');

// JPEG minimo con cabecera JFIF + SOF0 (ancho/alto reales) + relleno
function jpegB64(ancho, alto, relleno) {
  const cab = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, alto >> 8, alto & 255, ancho >> 8, ancho & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1];
  return Buffer.concat([Buffer.from(cab), Buffer.from(sof), Buffer.alloc(relleno === undefined ? 200 : relleno, 7)]).toString('base64');
}
const IMG = jpegB64(1600, 1200);
const THUMB = jpegB64(256, 192, 100);

function datos(extra) {
  return Object.assign({
    wellId: WELL, monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
    fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO',
    observacion: 'Se ve la boca del pozo', gps: { lat: -33.123456789, lon: -68.5 },
    mimeType: 'image/jpeg', imagenBase64: IMG, thumbBase64: THUMB,
    sha1Original: 'a'.repeat(40), procesamiento: 'JPEG_1600_Q72', tamanoOriginalBytes: 4200000
  }, extra || {});
}

let cacheStore;
beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.fotosService_bytesDeBase64 = Reemplazo.fotosService_bytesDeBase64;
  global.fotosService_esJpeg = Reemplazo.fotosService_esJpeg;
  global.fotosService_limpiar = Reemplazo.fotosService_limpiar;
  global.nivelesEstaticosRepository_getPunto = jest.fn().mockReturnValue({ found: false });
  global.registryRepository_getWellRecord = jest.fn().mockReturnValue({ found: true, record: {} });
  global.fotosPozosRepository_listarVisiblesPorEntidad = jest.fn().mockReturnValue([]);
  global.fotosPozosRepository_buscarVisiblePorFotoId = jest.fn().mockReturnValue(null);
  global.fotosPozosRepository_contarVisiblesPorEntidad = jest.fn().mockReturnValue({});
  global.fotosPozosRepository_buscarDuplicado = jest.fn().mockReturnValue(null);
  global.fotosPozosRepository_agregarSinDuplicar = jest.fn().mockReturnValue({ agregada: true });
  global.fotosStorageClient_subirPozo = jest.fn().mockReturnValue({ driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001', tamanoBytes: 123456 });
  global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
  global.fotosStorageClient_descartarPozo = jest.fn();
  cacheStore = global.CacheService.getScriptCache();
});

describe('entidad: wellId o monitoringId', () => {
  const n = Service.fotosPozosService_normalizarEntidad;

  test('wellId valido: clave = wellId', () => {
    expect(n(WELL, '')).toEqual({ ok: true, wellId: WELL, monitoringId: '', clave: WELL });
    expect(n(' ' + WELL + ' ', undefined).clave).toBe(WELL);
  });
  test('punto NE normal: monitoringId igual al wellId es la misma entidad; distinto es inconsistente', () => {
    expect(n(WELL, WELL).clave).toBe(WELL);
    expect(n(WELL, 'INA 2055').code).toBe('ENTIDAD_INCONSISTENTE');
  });
  test('punto NE especial: solo monitoringId', () => {
    expect(n('', 'INA 2055')).toEqual({ ok: true, wellId: '', monitoringId: 'INA 2055', clave: 'INA 2055' });
    expect(n(null, '7').clave).toBe('7');
  });
  test('monitoringId con forma de wellId se trata como wellId (galeria compartida)', () => {
    expect(n('', WELL)).toEqual({ ok: true, wellId: WELL, monitoringId: '', clave: WELL });
  });
  test.each([
    ['sin nada', '', ''],
    ['wellId mal formado', '4-263', ''],
    ['departamento fuera de rango', '20-0001', ''],
    ['monitoringId con caracteres peligrosos', '', "x'; DROP"],
    ['monitoringId demasiado largo', '', 'A'.repeat(41)],
    ['no strings', 12, {}]
  ])('invalida: %s', (nombre, w, m) => {
    expect(n(w, m).code).toBe('INVALID_ENTIDAD');
  });
});

describe('entidad existente (padron U red NE)', () => {
  const r = Service.fotosPozosService_resolverEntidadExistente;
  const ent = (w, m) => Service.fotosPozosService_normalizarEntidad(w, m);

  test('pozo del padron: OK, y NO es de la red NE', () => {
    expect(r(ent(WELL, '')).ok).toBe(true);
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: false });
    expect(r(ent(WELL, '')).esNE).toBe(false);
  });
  test('punto de la red NE (con o sin numero de pozo): esNE', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { wellId: WELL } });
    expect(r(ent(WELL, '')).esNE).toBe(true);
  });
  test('punto NE que no esta en el padron: OK (red NE)', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { wellId: WELL } });
    expect(r(ent(WELL, '')).ok).toBe(true);
  });
  test('pozo inexistente en ambas: ENTIDAD_NOT_FOUND', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    expect(r(ent('09-9999', ''))).toMatchObject({ ok: false, code: 'ENTIDAD_NOT_FOUND' });
  });
  test('punto NE especial existente: queda por monitoringId', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { monitoringId: 'INA 2055', wellId: null } });
    expect(r(ent('', 'INA 2055'))).toEqual({ ok: true, esNE: true, entidad: { ok: true, wellId: '', monitoringId: 'INA 2055', clave: 'INA 2055' } });
  });
  test('monitoringId de un punto NE que SI tiene numero de pozo: la entidad pasa a ser ese wellId', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { monitoringId: 'INA 9', wellId: '05-0001' } });
    const x = r(ent('', 'INA 9'));
    expect(x.entidad.wellId).toBe('05-0001');
    expect(x.entidad.monitoringId).toBe('');
  });
  test('punto especial inexistente: ENTIDAD_NOT_FOUND', () => {
    expect(r(ent('', 'INA 777')).code).toBe('ENTIDAD_NOT_FOUND');
  });
  test('un wellId se valida primero en la red NE (barata) y solo despues en el padron', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: {} });
    r(ent(WELL, ''));
    expect(global.registryRepository_getWellRecord).not.toHaveBeenCalled();
  });
});

describe('observacion', () => {
  const o = Service.fotosPozosService_normalizarObservacion;
  test('vacia o ausente: ok vacia', () => {
    expect(o(undefined)).toEqual({ ok: true, valor: '' });
    expect(o('')).toEqual({ ok: true, valor: '' });
    expect(o(null).valor).toBe('');
  });
  test('recorta, colapsa espacios, saltos de linea a espacio, quita caracteres de control', () => {
    expect(o('  boca\ndel   pozo\t\u0000ok ').valor).toBe('boca del pozo ok');
  });
  test('140 caracteres pasan; 141 no', () => {
    expect(o('a'.repeat(140)).ok).toBe(true);
    expect(o('a'.repeat(141))).toMatchObject({ ok: false, code: 'INVALID_OBSERVACION' });
  });
  test('no strings: invalida', () => {
    expect(o(12).code).toBe('INVALID_OBSERVACION');
    expect(o({}).code).toBe('INVALID_OBSERVACION');
  });
  test('un texto con HTML se conserva tal cual (el frontend lo pinta con textContent)', () => {
    expect(o('<b>hola</b>').valor).toBe('<b>hola</b>');
  });
});

describe('fecha con precision parcial', () => {
  const f = (v, p, o) => Service.fotosPozosService_validarFecha(v, p, o, AHORA);

  test('DIA / MES / ANIO validos, sin completar lo que no se sabe', () => {
    expect(f('2026-10-05', 'DIA', 'USUARIO')).toEqual({ ok: true, valor: '2026-10-05', precision: 'DIA', fuente: 'USUARIO' });
    expect(f('2025-06', 'MES', 'USUARIO').valor).toBe('2025-06');
    expect(f('2025', 'ANIO', 'USUARIO').valor).toBe('2025');
  });
  test('desde EXIF', () => {
    expect(f('2026-09-30', 'DIA', 'EXIF').fuente).toBe('EXIF');
  });
  test('desconocida: sin valor y con origen DESCONOCIDA (valores por defecto)', () => {
    expect(f(undefined, undefined, undefined)).toEqual({ ok: true, valor: '', precision: 'DESCONOCIDA', fuente: 'DESCONOCIDA' });
    expect(f('', 'DESCONOCIDA', 'DESCONOCIDA').ok).toBe(true);
  });
  test('desconocida con valor, o con origen distinto, es incoherente', () => {
    expect(f('2025', 'DESCONOCIDA', 'USUARIO').code).toBe('INVALID_FECHA');
    expect(f('', 'DESCONOCIDA', 'USUARIO').code).toBe('INVALID_FECHA');
  });
  test('con fecha, el origen no puede ser DESCONOCIDA ni uno de la importacion', () => {
    expect(f('2025', 'ANIO', 'DESCONOCIDA').code).toBe('INVALID_FECHA');
    expect(f('2025', 'ANIO', 'CARPETA').code).toBe('INVALID_FECHA');
    expect(f('2025', 'ANIO', 'ARCHIVO').code).toBe('INVALID_FECHA');
    expect(f('2025', 'ANIO', 'NOMBRE_ANIO').code).toBe('INVALID_FECHA');
  });
  test.each([
    ['dia inexistente', '2026-02-31', 'DIA'],
    ['mes 13', '2026-13', 'MES'],
    ['formato que no corresponde a la precision', '2026-10-05', 'ANIO'],
    ['anio de 2 digitos', '26', 'ANIO'],
    ['texto', 'ayer', 'DIA'],
    ['anterior a 2000', '1999-12-31', 'DIA'],
    ['futura (mas de un dia)', '2026-10-09', 'DIA'],
    ['anio futuro', '2027', 'ANIO'],
    ['no string', 2025, 'ANIO'],
    ['precision invalida', '2025', 'SEMANA']
  ])('rechaza: %s', (n, v, p) => {
    expect(f(v, p, 'USUARIO').code).toBe('INVALID_FECHA');
  });
  test('hoy y mañana (margen por husos horarios) se aceptan', () => {
    expect(f('2026-10-06', 'DIA', 'USUARIO').ok).toBe(true);
    expect(f('2026-10-07', 'DIA', 'USUARIO').ok).toBe(true);
  });
  test('29 de febrero solo en anio bisiesto', () => {
    expect(f('2024-02-29', 'DIA', 'USUARIO').ok).toBe(true);
    expect(f('2025-02-29', 'DIA', 'USUARIO').code).toBe('INVALID_FECHA');
  });
});

describe('gps', () => {
  const g = Service.fotosPozosService_validarGps;
  test('ausente: sin gps', () => {
    expect(g(undefined)).toEqual({ ok: true, lat: null, lon: null });
    expect(g(null).lat).toBeNull();
  });
  test('valido: se redondea a 6 decimales', () => {
    expect(g({ lat: -33.123456789, lon: -68.5 })).toEqual({ ok: true, lat: -33.123457, lon: -68.5 });
  });
  test.each([
    ['solo lat', { lat: -33 }],
    ['strings', { lat: '-33', lon: '-68' }],
    ['NaN', { lat: NaN, lon: 1 }],
    ['Infinity', { lat: Infinity, lon: 1 }],
    ['lat fuera de rango', { lat: 91, lon: 0 }],
    ['lon fuera de rango', { lat: 0, lon: -181 }],
    ['no objeto', 'x']
  ])('rechaza: %s', (n, v) => {
    expect(g(v).code).toBe('INVALID_GPS');
  });
});

describe('dimensiones e imagenes', () => {
  test('lee ancho y alto del SOF', () => {
    expect(Service.fotosPozosService_dimensionesJpeg(jpegB64(1600, 1200))).toEqual({ ancho: 1600, alto: 1200 });
    expect(Service.fotosPozosService_dimensionesJpeg(jpegB64(320, 4000))).toEqual({ ancho: 320, alto: 4000 });
  });
  test('sin SOF o corrupto: null', () => {
    expect(Service.fotosPozosService_dimensionesJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2]).toString('base64'))).toBeNull();
    expect(Service.fotosPozosService_dimensionesJpeg(Buffer.from('basura').toString('base64'))).toBeNull();
  });
  const v = Service.fotosPozosService_validarImagenes;
  test('valida imagen y miniatura', () => {
    expect(v('image/jpeg', IMG, THUMB)).toEqual({ ok: true, ancho: 1600, alto: 1200 });
  });
  test.each([
    ['mime png', ['image/png', IMG, THUMB], 'INVALID_MIME'],
    ['imagen vacia', ['image/jpeg', '', THUMB], 'INVALID_IMAGEN'],
    ['imagen con prefijo data:', ['image/jpeg', 'data:image/jpeg;base64,' + IMG, THUMB], 'INVALID_IMAGEN'],
    ['imagen que no es JPEG', ['image/jpeg', Buffer.from('esto no es una imagen jpeg real').toString('base64'), THUMB], 'INVALID_IMAGEN'],
    ['imagen mayor a 2 MB', ['image/jpeg', jpegB64(1600, 1200, 2 * 1024 * 1024), THUMB], 'FILE_TOO_LARGE'],
    ['miniatura vacia', ['image/jpeg', IMG, ''], 'INVALID_THUMB'],
    ['miniatura que no es JPEG', ['image/jpeg', IMG, Buffer.from('xxxxxxxxxxxxxxxxxxxx').toString('base64')], 'INVALID_THUMB'],
    ['miniatura mayor a 60 KB', ['image/jpeg', IMG, jpegB64(256, 192, 61 * 1024)], 'INVALID_THUMB'],
    ['miniatura grande en pixeles', ['image/jpeg', IMG, jpegB64(1600, 1200, 100)], 'INVALID_THUMB'],
    ['imagen mas grande de 2000 px', ['image/jpeg', jpegB64(2001, 1000), THUMB], 'INVALID_DIMENSIONES'],
    ['imagen de 8 px', ['image/jpeg', jpegB64(8, 8), THUMB], 'INVALID_DIMENSIONES'],
    ['JPEG sin SOF legible', ['image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]).toString('base64'), THUMB], 'INVALID_DIMENSIONES']
  ])('rechaza: %s', (n, args, codigo) => {
    expect(v(...args).code).toBe(codigo);
  });
});

describe('validarSubida (todo lo que manda el usuario)', () => {
  const val = (extra) => Service.fotosPozosService_validarSubida(datos(extra), AHORA);

  test('subida valida: valores normalizados', () => {
    const r = val();
    expect(r.ok).toBe(true);
    expect(r.valores).toMatchObject({ fuente: 'CAMPO_APP', tipoFoto: 'CERCA', observacion: 'Se ve la boca del pozo', ancho: 1600, alto: 1200, procesamiento: 'JPEG_1600_Q72', tamanoOriginalBytes: 4200000 });
    expect(r.valores.gps).toEqual({ ok: true, lat: -33.123457, lon: -68.5 });
    expect(r.valores.fecha).toMatchObject({ valor: '2026-10-05', precision: 'DIA', fuente: 'USUARIO' });
  });
  test('defaults: fuente CAMPO_APP, tipo OTRA, fecha desconocida, procesamiento NAVEGADOR', () => {
    const r = Service.fotosPozosService_validarSubida({ mimeType: 'image/jpeg', imagenBase64: IMG, thumbBase64: THUMB }, AHORA);
    expect(r.valores).toMatchObject({ fuente: 'CAMPO_APP', tipoFoto: 'OTRA', procesamiento: 'NAVEGADOR', sha1Original: '', tamanoOriginalBytes: '' });
    expect(r.valores.fecha.precision).toBe('DESCONOCIDA');
    expect(r.valores.gps.lat).toBeNull();
  });
  test('fuentes permitidas al cargar desde la app: CAMPO_APP y MONITOREO_NE; la historica RELEVAMIENTO_2018 no', () => {
    expect(val({ fuente: 'MONITOREO_NE' }).ok).toBe(true);
    expect(val({ fuente: 'RELEVAMIENTO_2018' }).code).toBe('INVALID_FUENTE');
    expect(val({ fuente: 'OTRA_COSA' }).code).toBe('INVALID_FUENTE');
    expect(val({ fuente: '../x' }).code).toBe('INVALID_FUENTE');
  });
  test('tipoFoto: CERCA / PANORAMICA / OTRA', () => {
    ['CERCA', 'PANORAMICA', 'OTRA'].forEach((t) => expect(val({ tipoFoto: t }).ok).toBe(true));
    expect(val({ tipoFoto: 'cerca' }).code).toBe('INVALID_TIPO');
    expect(val({ tipoFoto: 'AEREA' }).code).toBe('INVALID_TIPO');
  });
  test('sha1Original: 40 hex en minuscula o vacio', () => {
    expect(val({ sha1Original: '' }).ok).toBe(true);
    expect(val({ sha1Original: 'A'.repeat(40) }).code).toBe('INVALID_SHA1');
    expect(val({ sha1Original: 'g'.repeat(40) }).code).toBe('INVALID_SHA1');
    expect(val({ sha1Original: 123 }).code).toBe('INVALID_SHA1');
  });
  test('procesamiento y tamanoOriginalBytes', () => {
    expect(val({ procesamiento: 'minusculas' }).code).toBe('INVALID_PROCESAMIENTO');
    expect(val({ procesamiento: 'JPEG 1600' }).code).toBe('INVALID_PROCESAMIENTO');
    expect(val({ tamanoOriginalBytes: -1 }).code).toBe('INVALID_ORIGINAL');
    expect(val({ tamanoOriginalBytes: '5' }).code).toBe('INVALID_ORIGINAL');
    expect(val({ tamanoOriginalBytes: 999999999999 }).code).toBe('INVALID_ORIGINAL');
    expect(val({ tamanoOriginalBytes: 1234.6 }).valores.tamanoOriginalBytes).toBe(1235);
  });
  test('el origen del GPS no se acepta del cliente: no hay campo para ello', () => {
    const r = val({ gps: { lat: -33, lon: -68, origen: 'EXIF_ORIGINAL' } });
    expect(JSON.stringify(r.valores)).not.toContain('EXIF_ORIGINAL');
  });
});

describe('sanitizar: lo que sale hacia el frontend', () => {
  const completa = {
    fotoId: 'f1', timestampRegistro: '2026-10-06T00:00:00.000Z', wellId: WELL, monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
    fechaFotoValor: '2025', fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'USUARIO', observacion: 'ok', estadoVinculo: 'CONFIRMADO',
    vinculoMetodo: 'CAMPO_APP', gpsLat: -33.1, gpsLon: -68.5, gpsOrigen: 'DISPOSITIVO_CARGA', emailUsuarioCarga: 'secreto@x.com',
    loteImportacion: 'LOTE-1', sha1Original: 'a'.repeat(40), procesamiento: 'JPEG', mimeType: 'image/jpeg', tamanoBytes: 1, ancho: 1600, alto: 1200,
    tamanoOriginalBytes: 9, driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001', estado: 'ACTIVA'
  };

  test('solo los campos publicos, exactamente', () => {
    expect(Object.keys(Service.fotosPozosService_sanitizar(completa)).sort()).toEqual(
      ['alto', 'ancho', 'fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fotoId', 'fuente', 'observacion', 'tieneGps', 'tipoFoto']);
  });
  test('nunca driveFileId, driveThumbId, email, sha1, coordenadas, lote ni estado interno', () => {
    const json = JSON.stringify(Service.fotosPozosService_sanitizar(completa));
    ['DRIVE_FILE_ID', 'DRIVE_THUMB_ID', 'secreto@x.com', 'a'.repeat(40), '-33.1', '-68.5', 'LOTE-1', 'DISPOSITIVO_CARGA', 'emailUsuarioCarga', 'driveFileId', 'driveThumbId', 'sha1Original', 'gpsLat', 'gpsLon'].forEach((t) => expect(json).not.toContain(t));
  });
  test('tieneGps solo informa que existe ubicacion, no cual', () => {
    expect(Service.fotosPozosService_sanitizar(completa).tieneGps).toBe(true);
    expect(Service.fotosPozosService_sanitizar({ ...completa, gpsLat: null, gpsLon: null }).tieneGps).toBe(false);
  });
});

describe('orden', () => {
  const mk = (id, valor, precision, ts) => ({ fotoId: id, fechaFotoValor: valor, fechaFotoPrecision: precision, timestampRegistro: ts || '2026-01-01T00:00:00.000Z' });
  const fotos = [
    mk('a', '2024-05-01', 'DIA'), mk('b', '2026-03', 'MES'), mk('c', '', 'DESCONOCIDA'),
    mk('d', '2025', 'ANIO'), mk('e', '2026-03-15', 'DIA'), mk('f', '2026-03', 'MES', '2026-02-01T00:00:00.000Z')
  ];
  const ids = (l) => l.map((f) => f.fotoId);

  test('recientes primero (por defecto); mes y anio ordenan como su primer dia; sin fecha al final', () => {
    // b y f tienen el mismo mes: desempata el registro (f se registro despues -> primero entre las recientes)
    expect(ids(Service.fotosPozosService_ordenar(fotos))).toEqual(['e', 'f', 'b', 'd', 'a', 'c']);
    expect(ids(Service.fotosPozosService_ordenar(fotos, 'recientes'))).toEqual(['e', 'f', 'b', 'd', 'a', 'c']);
  });
  test('antiguas primero; sin fecha igual al final', () => {
    expect(ids(Service.fotosPozosService_ordenar(fotos, 'antiguas'))).toEqual(['a', 'd', 'b', 'f', 'e', 'c']);
  });
  test('no muta la entrada', () => {
    const copia = fotos.slice();
    Service.fotosPozosService_ordenar(fotos, 'antiguas');
    expect(fotos).toEqual(copia);
  });
  test('claveFecha no inventa dia/mes para mostrar: solo para ordenar', () => {
    expect(Service.fotosPozosService_claveFecha(mk('x', '2025', 'ANIO'))).toBe('2025-01-01');
    expect(Service.fotosPozosService_claveFecha(mk('x', '', 'DESCONOCIDA'))).toBe('');
  });
});

describe('listar', () => {
  const guardada = (id, extra) => Object.assign({
    fotoId: id, fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO',
    observacion: '', ancho: 1600, alto: 1200, gpsLat: null, gpsLon: null, timestampRegistro: '2026-10-06T00:00:00.000Z',
    emailUsuarioCarga: 'x@x.com', driveFileId: 'DRIVE_FILE_ID_' + id, driveThumbId: 'DRIVE_THUMB_ID_' + id, sha1Original: 'a'.repeat(40)
  }, extra || {});

  test('cero fotos: lista vacia (no revela si la entidad existe)', () => {
    const r = Service.fotosPozosService_listar(WELL, '', 'recientes');
    expect(r).toMatchObject({ ok: true, entidad: WELL, total: 0, fotos: [] });
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
    expect(global.registryRepository_getWellRecord).not.toHaveBeenCalled();
  });
  test('una o varias fotos, sanitizadas y ordenadas; consulta por la entidad correcta', () => {
    global.fotosPozosRepository_listarVisiblesPorEntidad.mockReturnValue([
      guardada('f1', { fechaFotoValor: '2025-01-01' }), guardada('f2', { fechaFotoValor: '2026-10-05' })
    ]);
    const r = Service.fotosPozosService_listar(WELL, '', 'recientes');
    expect(r.total).toBe(2);
    expect(r.fotos.map((f) => f.fotoId)).toEqual(['f2', 'f1']);
    expect(global.fotosPozosRepository_listarVisiblesPorEntidad).toHaveBeenCalledWith({ ok: true, wellId: WELL, monitoringId: '', clave: WELL });
    expect(JSON.stringify(r)).not.toMatch(/DRIVE_|x@x\.com|a{40}/);
  });
  test('punto NE especial: consulta por monitoringId', () => {
    Service.fotosPozosService_listar('', 'INA 2055', 'recientes');
    expect(global.fotosPozosRepository_listarVisiblesPorEntidad).toHaveBeenCalledWith({ ok: true, wellId: '', monitoringId: 'INA 2055', clave: 'INA 2055' });
  });
  test('entidad invalida: error sin tocar la hoja', () => {
    expect(Service.fotosPozosService_listar('', '', 'recientes').code).toBe('INVALID_ENTIDAD');
    expect(global.fotosPozosRepository_listarVisiblesPorEntidad).not.toHaveBeenCalled();
  });
  test('deja en cache los ids internos de las fotos listadas (para no releer la hoja por cada miniatura)', () => {
    global.fotosPozosRepository_listarVisiblesPorEntidad.mockReturnValue([guardada('f1')]);
    Service.fotosPozosService_listar(WELL, '', 'recientes');
    expect(JSON.parse(cacheStore.get('fotospozos_m_f1'))).toEqual({ d: 'DRIVE_FILE_ID_f1', t: 'DRIVE_THUMB_ID_f1' });
  });
  test('muchas fotos: el cache se carga en lotes (limite de putAll)', () => {
    const muchas = [];
    for (let i = 0; i < 120; i++) { muchas.push(guardada('id' + i)); }
    global.fotosPozosRepository_listarVisiblesPorEntidad.mockReturnValue(muchas);
    const putAll = jest.fn();
    cacheStore.putAll = putAll;
    Service.fotosPozosService_listar(WELL, '', 'recientes');
    expect(putAll).toHaveBeenCalledTimes(3);
    expect(Object.keys(putAll.mock.calls[0][0])).toHaveLength(50);
    delete cacheStore.putAll;
  });
});

describe('resumen', () => {
  test('devuelve {clave: n} desde la hoja y lo cachea', () => {
    global.fotosPozosRepository_contarVisiblesPorEntidad.mockReturnValue({ '01-0012': 4, '03-0652': 12 });
    expect(Service.fotosPozosService_resumen()).toEqual({ '01-0012': 4, '03-0652': 12 });
    expect(Service.fotosPozosService_resumen()).toEqual({ '01-0012': 4, '03-0652': 12 });
    expect(global.fotosPozosRepository_contarVisiblesPorEntidad).toHaveBeenCalledTimes(1);
  });
  test('invalidarResumen fuerza releer', () => {
    global.fotosPozosRepository_contarVisiblesPorEntidad.mockReturnValueOnce({ a: 1 }).mockReturnValueOnce({ a: 2 });
    expect(Service.fotosPozosService_resumen()).toEqual({ a: 1 });
    Service.fotosPozosService_invalidarResumen();
    expect(Service.fotosPozosService_resumen()).toEqual({ a: 2 });
  });
  test('resumen vacio: {} (sin entidades con fotos)', () => {
    expect(Service.fotosPozosService_resumen()).toEqual({});
  });
  test('un resumen demasiado grande para el cache se devuelve igual, sin cachear (no falla)', () => {
    const grande = {};
    for (let i = 0; i < 9000; i++) { grande['01-' + String(i).padStart(4, '0')] = 1; }
    global.fotosPozosRepository_contarVisiblesPorEntidad.mockReturnValue(grande);
    expect(Object.keys(Service.fotosPozosService_resumen())).toHaveLength(9000);
    expect(cacheStore.get('fotospozos_resumen')).toBeNull();
  });
});

describe('obtenerImagen (proxy)', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  const visible = { fotoId: ID, driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001' };

  test.each([['no UUID', 'abc', 'thumb', 'INVALID_FOTO_ID'], ['variante invalida', ID, 'original', 'INVALID_VARIANTE'], ['no string', null, 'thumb', 'INVALID_FOTO_ID']])('%s', (n, id, variante, codigo) => {
    expect(Service.fotosPozosService_obtenerImagen(id, variante).code).toBe(codigo);
    expect(global.fotosStorageClient_obtenerPozo).not.toHaveBeenCalled();
  });

  test('foto inexistente, oculta o sin confirmar: FOTO_NOT_FOUND y no toca el storage', () => {
    expect(Service.fotosPozosService_obtenerImagen(ID, 'thumb').code).toBe('FOTO_NOT_FOUND');
    expect(global.fotosStorageClient_obtenerPozo).not.toHaveBeenCalled();
  });

  test('foto visible: resuelve los ids internos desde la hoja, los usa con el storage y NO los devuelve', () => {
    global.fotosPozosRepository_buscarVisiblePorFotoId.mockReturnValue(visible);
    const r = Service.fotosPozosService_obtenerImagen(ID, 'full');
    expect(r).toEqual({ ok: true, imagen: { fotoId: ID, variante: 'full', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
    expect(global.fotosStorageClient_obtenerPozo).toHaveBeenCalledWith('DRIVE_FILE_ID_0001', 'DRIVE_THUMB_ID_0001', 'full');
    expect(JSON.stringify(r)).not.toContain('DRIVE_');
  });

  test('con los ids en cache no relee la hoja', () => {
    cacheStore.put('fotospozos_m_' + ID, JSON.stringify({ d: 'DRIVE_FILE_ID_0001', t: '' }));
    Service.fotosPozosService_obtenerImagen(ID, 'thumb');
    expect(global.fotosPozosRepository_buscarVisiblePorFotoId).not.toHaveBeenCalled();
    expect(global.fotosStorageClient_obtenerPozo).toHaveBeenCalledWith('DRIVE_FILE_ID_0001', '', 'thumb');
  });

  test('la miniatura se cachea; la completa no', () => {
    global.fotosPozosRepository_buscarVisiblePorFotoId.mockReturnValue(visible);
    Service.fotosPozosService_obtenerImagen(ID, 'thumb');
    Service.fotosPozosService_obtenerImagen(ID, 'thumb');
    expect(global.fotosStorageClient_obtenerPozo).toHaveBeenCalledTimes(1);
    Service.fotosPozosService_obtenerImagen(ID, 'full');
    Service.fotosPozosService_obtenerImagen(ID, 'full');
    expect(global.fotosStorageClient_obtenerPozo).toHaveBeenCalledTimes(3);
  });

  test('una miniatura en cache NO se sirve si la foto dejo de ser visible (oculta) y el cache de ids vencio', () => {
    global.fotosPozosRepository_buscarVisiblePorFotoId.mockReturnValueOnce(visible).mockReturnValue(null);
    expect(Service.fotosPozosService_obtenerImagen(ID, 'thumb').ok).toBe(true);
    cacheStore.remove('fotospozos_m_' + ID);   // vence el cache de ids (10 min)
    expect(Service.fotosPozosService_obtenerImagen(ID, 'thumb').code).toBe('FOTO_NOT_FOUND');
  });

  test('error del storage: STORAGE_UNAVAILABLE, log sin URL ni ids largos', () => {
    global.fotosPozosRepository_buscarVisiblePorFotoId.mockReturnValue(visible);
    global.fotosStorageClient_obtenerPozo.mockImplementation(() => { throw new Error('storage HTTP 500 https://script.google.com/macros/s/AKfycbxSECRETOSECRETOSECRETO/exec DRIVE_FILE_ID_0001'); });
    const r = Service.fotosPozosService_obtenerImagen(ID, 'full');
    expect(r.code).toBe('STORAGE_UNAVAILABLE');
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join(' ');
    expect(log).not.toMatch(/https?:|AKfyc|DRIVE_FILE_ID_0001/);
  });
});

describe('subir', () => {
  const sub = (extra) => Service.fotosPozosService_subir('quien@x.com', datos(extra), AHORA);
  const ultimaFila = () => global.fotosPozosRepository_agregarSinDuplicar.mock.calls[0][0];

  test('camino feliz: storage + fila CONFIRMADO/CAMPO_APP + resumen invalidado + respuesta sanitizada', () => {
    cacheStore.put('fotospozos_resumen', '{"x":1}');
    const r = sub();
    expect(r.ok).toBe(true);
    expect(r.duplicada).toBe(false);
    expect(Object.keys(r.foto).sort()).toEqual(['alto', 'ancho', 'fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fotoId', 'fuente', 'observacion', 'tieneGps', 'tipoFoto']);
    expect(r.foto.tieneGps).toBe(true);
    expect(cacheStore.get('fotospozos_resumen')).toBeNull();
    const fila = ultimaFila();
    expect(fila).toMatchObject({
      wellId: WELL, monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
      fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO', observacion: 'Se ve la boca del pozo',
      estadoVinculo: 'CONFIRMADO', vinculoMetodo: 'CAMPO_APP', gpsLat: -33.123457, gpsLon: -68.5, gpsOrigen: 'DISPOSITIVO_CARGA',
      emailUsuarioCarga: 'quien@x.com', loteImportacion: '', sha1Original: 'a'.repeat(40), procesamiento: 'JPEG_1600_Q72',
      mimeType: 'image/jpeg', tamanoBytes: 123456, ancho: 1600, alto: 1200, tamanoOriginalBytes: 4200000,
      driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001', estado: 'ACTIVA'
    });
    expect(fila.fotoId).toBe(r.foto.fotoId);
    expect(fila.timestampRegistro instanceof Date).toBe(true);
  });

  test('al storage va SOLO lo necesario: fotoId, fuente, carpetaFecha, mime e imagenes (nada de email, entidad ni observacion)', () => {
    sub();
    const payload = global.fotosStorageClient_subirPozo.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['carpetaFecha', 'fotoId', 'fuente', 'imagenBase64', 'mimeType', 'thumbBase64']);
    expect(payload).toMatchObject({ fuente: 'CAMPO_APP', carpetaFecha: '2026' });
  });

  test.each([
    ['fecha de otro anio', { fechaFotoValor: '2025-03-01' }, '2025'],
    ['fecha parcial (mes)', { fechaFotoValor: '2025-03', fechaFotoPrecision: 'MES' }, '2025'],
    ['solo anio', { fechaFotoValor: '2024', fechaFotoPrecision: 'ANIO' }, '2024'],
    ['fecha desconocida', { fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA' }, 'sin_fecha']
  ])('carpeta de storage segun la fecha DE LA FOTO (%s)', (n, extra, carpeta) => {
    sub(extra);
    expect(global.fotosStorageClient_subirPozo.mock.calls[0][0].carpetaFecha).toBe(carpeta);
  });

  test('fecha desconocida: la fila no inventa ningun valor', () => {
    sub({ fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA' });
    expect(ultimaFila()).toMatchObject({ fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA' });
  });

  test('sin GPS: coordenadas y origen vacios', () => {
    sub({ gps: null });
    expect(ultimaFila()).toMatchObject({ gpsLat: null, gpsLon: null, gpsOrigen: '' });
  });

  test('punto NE especial: la fila lleva monitoringId y wellId vacio', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { monitoringId: 'INA 2055', wellId: null } });
    const r = sub({ wellId: '', monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' });
    expect(r.ok).toBe(true);
    expect(ultimaFila()).toMatchObject({ wellId: '', monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' });
  });

  test('punto NE con numero de pozo: la fila usa el wellId (galeria compartida con Provincia)', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { monitoringId: 'INA 9', wellId: '05-0001' } });
    sub({ wellId: '', monitoringId: 'INA 9' });
    expect(ultimaFila()).toMatchObject({ wellId: '05-0001', monitoringId: '' });
  });

  test('MONITOREO_NE solo sobre un punto de la red NE: un pozo del padron que no esta en la red no puede declararla', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: false });
    global.registryRepository_getWellRecord.mockReturnValue({ found: true });
    expect(sub({ fuente: 'MONITOREO_NE' }).code).toBe('INVALID_FUENTE');
    expect(global.fotosStorageClient_subirPozo).not.toHaveBeenCalled();
    expect(global.fotosPozosRepository_agregarSinDuplicar).not.toHaveBeenCalled();
    // CAMPO_APP sigue valida para ese mismo pozo
    expect(sub({ fuente: 'CAMPO_APP' }).ok).toBe(true);
  });

  test('MONITOREO_NE sobre un punto NE (con numero de pozo o especial): permitido', () => {
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { wellId: WELL } });
    expect(sub({ fuente: 'MONITOREO_NE' }).ok).toBe(true);
    global.nivelesEstaticosRepository_getPunto.mockReturnValue({ found: true, punto: { monitoringId: 'INA 2055', wellId: null } });
    expect(sub({ wellId: '', monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' }).ok).toBe(true);
  });

  test('pozo inexistente: ENTIDAD_NOT_FOUND, nada se sube ni se escribe', () => {
    global.registryRepository_getWellRecord.mockReturnValue({ found: false });
    expect(sub({ wellId: '09-9999' }).code).toBe('ENTIDAD_NOT_FOUND');
    expect(global.fotosStorageClient_subirPozo).not.toHaveBeenCalled();
    expect(global.fotosPozosRepository_agregarSinDuplicar).not.toHaveBeenCalled();
  });

  test.each([
    ['entidad invalida', { wellId: '', monitoringId: '' }, 'INVALID_ENTIDAD'],
    ['fuente invalida', { fuente: 'RELEVAMIENTO_2018' }, 'INVALID_FUENTE'],
    ['tipo invalido', { tipoFoto: 'X' }, 'INVALID_TIPO'],
    ['fecha invalida', { fechaFotoValor: '2026-02-31' }, 'INVALID_FECHA'],
    ['observacion larga', { observacion: 'a'.repeat(141) }, 'INVALID_OBSERVACION'],
    ['gps invalido', { gps: { lat: 100, lon: 0 } }, 'INVALID_GPS'],
    ['mime invalido', { mimeType: 'image/png' }, 'INVALID_MIME'],
    ['imagen que no es JPEG', { imagenBase64: Buffer.from('no es una imagen de verdad').toString('base64') }, 'INVALID_IMAGEN'],
    ['imagen grande en bytes', { imagenBase64: jpegB64(1600, 1200, 2 * 1024 * 1024) }, 'FILE_TOO_LARGE'],
    ['dimensiones absurdas', { imagenBase64: jpegB64(5000, 5000) }, 'INVALID_DIMENSIONES'],
    ['miniatura invalida', { thumbBase64: 'AAAA' }, 'INVALID_THUMB'],
    ['sha1 invalido', { sha1Original: 'xyz' }, 'INVALID_SHA1']
  ])('validacion previa: %s -> %s, sin tocar storage ni hoja', (n, extra, codigo) => {
    expect(sub(extra).code).toBe(codigo);
    expect(global.fotosStorageClient_subirPozo).not.toHaveBeenCalled();
    expect(global.fotosPozosRepository_agregarSinDuplicar).not.toHaveBeenCalled();
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
  });

  test('mismo archivo ya subido a la entidad (sha1): idempotente, no vuelve a subir ni a escribir', () => {
    global.fotosPozosRepository_buscarDuplicado.mockReturnValue({ fotoId: 'previa', fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-01', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO', observacion: '', ancho: 1600, alto: 1200, gpsLat: null, gpsLon: null, driveFileId: 'DRIVE_FILE_ID_9' });
    const r = sub();
    expect(r).toMatchObject({ ok: true, duplicada: true });
    expect(r.foto.fotoId).toBe('previa');
    expect(JSON.stringify(r)).not.toContain('DRIVE_');
    expect(global.fotosStorageClient_subirPozo).not.toHaveBeenCalled();
    expect(global.fotosPozosRepository_agregarSinDuplicar).not.toHaveBeenCalled();
  });

  test('storage caido: STORAGE_UNAVAILABLE, sin fila, con log limpio', () => {
    global.fotosStorageClient_subirPozo.mockImplementation(() => { throw new Error('storage HTTP 500 https://script.google.com/macros/s/AKfycbxSECRETOSECRETOSECRETO/exec'); });
    expect(sub().code).toBe('STORAGE_UNAVAILABLE');
    expect(global.fotosPozosRepository_agregarSinDuplicar).not.toHaveBeenCalled();
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join(' ')).not.toMatch(/https?:|AKfyc/);
  });

  test('COMPENSACION: si falla la hoja despues de subir, el archivo va a la papelera y el error se propaga', () => {
    global.fotosPozosRepository_agregarSinDuplicar.mockImplementation(() => { throw new Error('Sheets no responde'); });
    expect(() => sub()).toThrow('Sheets no responde');
    expect(global.fotosStorageClient_descartarPozo).toHaveBeenCalledWith('DRIVE_FILE_ID_0001');
  });

  test('si ademas falla la compensacion, solo se loguea (huerfano) y se propaga el error original', () => {
    global.fotosPozosRepository_agregarSinDuplicar.mockImplementation(() => { throw new Error('Sheets no responde'); });
    global.fotosStorageClient_descartarPozo.mockImplementation(() => { throw new Error('storage HTTP 500'); });
    expect(() => sub()).toThrow('Sheets no responde');
    expect(global.Logger.log).toHaveBeenCalledWith(expect.stringMatching(/No se pudo descartar una foto huerfana/));
  });

  test('carrera: otra subida igual se registro entre el chequeo y el append -> se descarta el archivo sobrante y se devuelve la existente', () => {
    global.fotosPozosRepository_agregarSinDuplicar.mockReturnValue({ agregada: false, existente: { fotoId: 'ganadora', fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA', observacion: '', ancho: 10, alto: 10, gpsLat: null, gpsLon: null } });
    const r = sub();
    expect(r).toMatchObject({ ok: true, duplicada: true });
    expect(r.foto.fotoId).toBe('ganadora');
    expect(global.fotosStorageClient_descartarPozo).toHaveBeenCalledWith('DRIVE_FILE_ID_0001');
  });

  test('no se invalida el resumen si la subida no escribio nada nuevo', () => {
    cacheStore.put('fotospozos_resumen', '{"x":1}');
    global.fotosPozosRepository_buscarDuplicado.mockReturnValue({ fotoId: 'previa', fechaFotoPrecision: 'DIA', gpsLat: null, gpsLon: null });
    sub();
    expect(cacheStore.get('fotospozos_resumen')).toBe('{"x":1}');
  });

  test('la identidad es el email de la sesion (parametro), no algo que mande el cliente', () => {
    Service.fotosPozosService_subir('sesion@x.com', Object.assign(datos(), { emailUsuarioCarga: 'falso@x.com', email: 'falso@x.com', estado: 'OCULTA', estadoVinculo: 'POR_REVISAR', gpsOrigen: 'EXIF_ORIGINAL', driveFileId: 'INVENTADO', loteImportacion: 'LOTE-X' }), AHORA);
    expect(ultimaFila()).toMatchObject({ emailUsuarioCarga: 'sesion@x.com', estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', gpsOrigen: 'DISPOSITIVO_CARGA', driveFileId: 'DRIVE_FILE_ID_0001', loteImportacion: '' });
  });
});
