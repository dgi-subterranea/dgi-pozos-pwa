// Importacion historica desde la hoja de staging (backend/src/FotosPozosImport.js): se ejecuta A MANO desde el editor,
// nunca por la Web App. Se prueba con Sheets en memoria y el codigo REAL del repositorio/servicio de FotosPozos.
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const SRC = path.join(__dirname, '..', 'src');
const AHORA = new Date(2026, 9, 7, 10, 0, 0);          // 7/10/2026 (mes 0-based)

let Repo;
let Imp;
let Registry;
let hojas;
let invalidarResumen;

function cargar() {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Repo = require('../src/FotosPozosRepository');
  const Service = require('../src/FotosPozosService');
  Registry = require('../src/RegistryRepository');
  Imp = require('../src/FotosPozosImport');
  Object.assign(global, Repo, Service, Imp);
  global.registryRepository_resolveFileName = Registry.registryRepository_resolveFileName;
  global.registryRepository_getWellIdsDeArchivo = jest.fn(() => ({}));
  global.nivelesEstaticosRepository_getTodosLosPuntos = jest.fn(() => ({ found: true, puntos: {} }));
  invalidarResumen = jest.fn();
  global.fotosPozosService_invalidarResumen = invalidarResumen;
}

const COLS_STAGING = () => Repo.FOTOS_POZOS_COLUMNAS.concat(['estadoImportacion', 'detalleImportacion']);

function filaValida(i, extra) {
  const hex = (n) => ('0'.repeat(12) + n.toString(16)).slice(-12);
  const base = {
    fotoId: '6695f80f-3539-5619-9b13-' + hex(i), timestampRegistro: '', wellId: '15-0268', monitoringId: '', fuente: 'RELEVAMIENTO_2018',
    tipoFoto: 'OTRA', fechaFotoValor: '2018-08-06', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'EXIF', observacion: '',
    estadoVinculo: 'CONFIRMADO', vinculoMetodo: 'NOMBRE_ARCHIVO', gpsLat: '', gpsLon: '', gpsOrigen: '', emailUsuarioCarga: 'IMPORTACION',
    loteImportacion: 'PILOTO-2026-10', sha1Original: ('ab' + hex(i)).padEnd(40, 'c'), procesamiento: 'JPEG_1600_Q72', mimeType: 'image/jpeg',
    tamanoBytes: 400123, ancho: 1600, alto: 1200, tamanoOriginalBytes: 4200000, driveFileId: 'DriveFile' + hex(i), driveThumbId: 'DriveThumb' + hex(i), estado: 'ACTIVA'
  };
  return Object.assign(base, extra || {});
}
const comoFila = (obj, columnas) => columnas.map((c) => (obj[c] === undefined ? '' : obj[c]));

function armarHojas(filasStaging, filasFotosPozos) {
  hojas = instalarSheetsFalsos({
    FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS].concat((filasFotosPozos || []).map((o) => comoFila(o, Repo.FOTOS_POZOS_COLUMNAS))),
    FotosPozosImport: [COLS_STAGING()].concat((filasStaging || []).map((o) => comoFila(o, COLS_STAGING()))),
    FotosReemplazo: [['fotoId', 'evaluacionId'], ['sentinela', 'e1']]
  });
}

const siempre = () => true;
beforeEach(cargar);

describe('normalizar una fila de staging', () => {
  const norm = (extra) => Imp.fotosPozosImport_normalizarFila(filaValida(1, extra), AHORA);

  test('fila valida: los valores quedan tipados y la fecha NO se completa', () => {
    const r = norm({ fechaFotoValor: 2018, fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'NOMBRE_ANIO', fuente: 'MONITOREO_NE', tipoFoto: 'CERCA' });
    expect(r.ok).toBe(true);
    expect(r.foto).toMatchObject({ fechaFotoValor: '2018', fechaFotoPrecision: 'ANIO', tamanoBytes: 400123, gpsLat: null, estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', emailUsuarioCarga: 'IMPORTACION', observacion: '' });
  });

  test('Sheets puede convertir la fecha en Date: se reconstruye segun la precision (nunca inventa dia ni mes)', () => {
    expect(norm({ fechaFotoValor: new Date(2018, 4, 3), fechaFotoPrecision: 'DIA' }).foto.fechaFotoValor).toBe('2018-05-03');
    expect(norm({ fechaFotoValor: new Date(2018, 2, 1), fechaFotoPrecision: 'MES', fechaFotoFuente: 'CARPETA' }).foto.fechaFotoValor).toBe('2018-03');
    expect(norm({ fechaFotoValor: new Date(2018, 0, 1), fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'NOMBRE_ANIO' }).foto.fechaFotoValor).toBe('2018');
  });

  test('fecha desconocida: sin valor y con fuente DESCONOCIDA', () => {
    expect(norm({ fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA' }).ok).toBe(true);
  });

  test('GPS historico: ambas coordenadas y origen EXIF_ORIGINAL', () => {
    const r = norm({ gpsLat: -33.123456, gpsLon: -68.654321, gpsOrigen: 'EXIF_ORIGINAL' });
    expect(r.ok).toBe(true);
    expect(r.foto).toMatchObject({ gpsLat: -33.123456, gpsLon: -68.654321, gpsOrigen: 'EXIF_ORIGINAL' });
  });

  test.each([
    ['fotoId que no es UUID', { fotoId: 'abc' }, 'fotoId'],
    ['wellId inexistente en formato', { wellId: '99-0001' }, 'entidad'],
    ['wellId mal formado', { wellId: '15-26' }, 'entidad'],
    ['sin entidad', { wellId: '', monitoringId: '' }, 'entidad'],
    ['wellId y monitoringId distintos', { wellId: '15-0268', monitoringId: 'INA 1' }, 'entidad'],
    ['CAMPO_APP no es historica', { fuente: 'CAMPO_APP' }, 'fuente'],
    ['fuente inventada', { fuente: 'OTRA_COSA' }, 'fuente'],
    ['tipo invalido', { tipoFoto: 'X' }, 'tipoFoto'],
    ['precision invalida', { fechaFotoPrecision: 'SEMANA' }, 'precision'],
    ['fuente de fecha de la app (USUARIO)', { fechaFotoFuente: 'USUARIO' }, 'fechaFotoFuente'],
    ['ANIO con un dia completo', { fechaFotoValor: '2018-05-03', fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'NOMBRE_ANIO' }, 'no corresponde'],
    ['DIA solo con el anio', { fechaFotoValor: '2018' }, 'no corresponde'],
    ['dia inexistente', { fechaFotoValor: '2018-02-31' }, 'fuera de rango'],
    ['fecha futura', { fechaFotoValor: '2026-12-31' }, 'futura'],
    ['anio muy viejo', { fechaFotoValor: '1980-01-01' }, 'fuera de rango'],
    ['DESCONOCIDA con valor', { fechaFotoPrecision: 'DESCONOCIDA', fechaFotoFuente: 'DESCONOCIDA' }, 'DESCONOCIDA'],
    ['fecha conocida con fuente DESCONOCIDA', { fechaFotoFuente: 'DESCONOCIDA' }, 'DESCONOCIDA'],
    ['POR_REVISAR', { estadoVinculo: 'POR_REVISAR' }, 'CONFIRMADO'],
    ['OCULTA', { estado: 'OCULTA' }, 'ACTIVA'],
    ['metodo de vinculo de la app', { vinculoMetodo: 'CAMPO_APP' }, 'vinculoMetodo'],
    ['gps incompleto', { gpsLat: -33, gpsLon: '', gpsOrigen: 'EXIF_ORIGINAL' }, 'gps incompleto'],
    ['gps fuera de rango', { gpsLat: 120, gpsLon: -68, gpsOrigen: 'EXIF_ORIGINAL' }, 'gps fuera'],
    ['gps 0,0', { gpsLat: 0, gpsLon: 0, gpsOrigen: 'EXIF_ORIGINAL' }, 'gps fuera'],
    ['gps sin origen', { gpsLat: -33, gpsLon: -68, gpsOrigen: 'DISPOSITIVO_CARGA' }, 'gpsOrigen'],
    ['origen de gps sin coordenadas', { gpsOrigen: 'EXIF_ORIGINAL' }, 'gpsOrigen'],
    ['otro usuario de carga', { emailUsuarioCarga: 'alguien@x.com' }, 'emailUsuarioCarga'],
    ['con observacion', { observacion: 'Fulano de tal' }, 'observacion'],
    ['lote con espacios o rutas', { loteImportacion: 'carpeta/lote 1' }, 'loteImportacion'],
    ['sha1 corto', { sha1Original: 'abc' }, 'sha1'],
    ['procesamiento raro', { procesamiento: 'a/b.jpg' }, 'procesamiento'],
    ['mime png', { mimeType: 'image/png' }, 'mimeType'],
    ['peso cero', { tamanoBytes: 0 }, 'tamanoBytes'],
    ['peso enorme', { tamanoBytes: 3 * 1024 * 1024 }, 'tamanoBytes'],
    ['peso decimal', { tamanoBytes: 10.5 }, 'tamanoBytes'],
    ['ancho enorme', { ancho: 5000 }, 'ancho'],
    ['alto ausente', { alto: '' }, 'ancho'],
    ['driveFileId vacio', { driveFileId: '' }, 'drive'],
    ['driveThumbId con caracteres raros', { driveThumbId: 'abc def/ghi' }, 'drive'],
    ['driveFileId = driveThumbId', { driveThumbId: 'DriveFile000000000001' }, 'mismo archivo'],
    ['ruta de archivo en el procesamiento', { procesamiento: 'C:\\x' }, 'procesamiento'],
  ])('rechaza: %s', (nombre, extra, motivo) => {
    const r = norm(extra);
    expect(r.ok).toBe(false);
    expect(r.motivo.toLowerCase()).toContain(motivo.toLowerCase());
  });

  test('un monitoringId con forma de wellId se toma como wellId; uno especial se conserva', () => {
    expect(norm({ wellId: '', monitoringId: '15-0268' }).foto).toMatchObject({ wellId: '15-0268', monitoringId: '' });
    expect(norm({ wellId: '', monitoringId: 'INA 2055' }).foto).toMatchObject({ wellId: '', monitoringId: 'INA 2055' });
  });

  test('el fotoId se normaliza a minusculas (el storage usa UUID en minusculas)', () => {
    expect(norm({ fotoId: filaValida(1).fotoId.toUpperCase() }).foto.fotoId).toBe(filaValida(1).fotoId);
  });
});

describe('clasificar contra FotosPozos', () => {
  const items = (...objs) => objs.map((o, i) => ({ numeroFila: i + 2, cruda: o }));
  const clas = (its, existentes, existe) => Imp.fotosPozosImport_clasificar(its, existentes, existe || siempre, AHORA);
  const existente = (extra) => Repo.fotosPozosRepository_fotoDesdeFila(comoFila(filaValida(50, extra), Repo.FOTOS_POZOS_COLUMNAS), { ...Object.fromEntries(Repo.FOTOS_POZOS_COLUMNAS.map((c, i) => [c, i])) });

  test('filas nuevas validas: INSERTADA', () => {
    const r = clas(items(filaValida(1), filaValida(2)), []);
    expect(r.map((x) => x.estado)).toEqual(['INSERTADA', 'INSERTADA']);
  });

  test('un fotoId que ya esta en FotosPozos: YA_EXISTE (tambien si esta OCULTA: no revive)', () => {
    const f = existente({ fotoId: filaValida(1).fotoId, estado: 'OCULTA' });
    expect(clas(items(filaValida(1)), [f])[0]).toMatchObject({ estado: 'YA_EXISTE' });
    expect(clas(items(filaValida(1)), [existente({ fotoId: filaValida(1).fotoId.toUpperCase() })])[0].estado).toBe('YA_EXISTE');
  });

  test('mismo contenido (sha1) ya visible en la misma entidad: YA_EXISTE; en otra entidad no', () => {
    const otra = existente({ fotoId: '11111111-1111-4111-8111-111111111111', sha1Original: filaValida(1).sha1Original, driveFileId: 'OtroFile000000001', driveThumbId: 'OtroThumb00000001' });
    expect(clas(items(filaValida(1)), [otra])[0].estado).toBe('YA_EXISTE');
    expect(clas(items(filaValida(1, { wellId: '15-0999' })), [otra])[0].estado).toBe('INSERTADA');
  });

  test('un id de Drive ya usado por otra foto: INVALIDA', () => {
    const usada = existente({ fotoId: '22222222-2222-4222-8222-222222222222', sha1Original: 'f'.repeat(40), driveFileId: filaValida(1).driveFileId, driveThumbId: 'OtroThumb00000002' });
    expect(clas(items(filaValida(1)), [usada])[0]).toMatchObject({ estado: 'INVALIDA' });
  });

  test('fotoId repetido dentro del staging: gana la primera, la segunda es INVALIDA', () => {
    const r = clas(items(filaValida(1), filaValida(1)), []);
    expect(r.map((x) => x.estado)).toEqual(['INSERTADA', 'INVALIDA']);
    expect(r[1].detalle).toMatch(/repetido/);
  });

  test('mismo contenido o mismos ids de Drive en dos filas del staging: la segunda no entra', () => {
    const a = filaValida(1);
    const mismoContenido = filaValida(2, { sha1Original: a.sha1Original });
    const mismosIds = filaValida(3, { driveFileId: a.driveFileId });
    expect(clas(items(a, mismoContenido), []).map((x) => x.estado)).toEqual(['INSERTADA', 'YA_EXISTE']);
    expect(clas(items(a, mismosIds), []).map((x) => x.estado)).toEqual(['INSERTADA', 'INVALIDA']);
  });

  test('entidad inexistente (padron U red NE): INVALIDA', () => {
    const r = clas(items(filaValida(1), filaValida(2, { wellId: '15-0999' })), [], (e) => e.wellId === '15-0268');
    expect(r.map((x) => x.estado)).toEqual(['INSERTADA', 'INVALIDA']);
    expect(r[1].detalle).toMatch(/no existe/);
  });

  test('una fila invalida no frena a las demas y conserva su numero de fila', () => {
    const r = clas(items(filaValida(1), filaValida(2, { estadoVinculo: 'POR_REVISAR' }), filaValida(3)), []);
    expect(r.map((x) => [x.numeroFila, x.estado])).toEqual([[2, 'INSERTADA'], [3, 'INVALIDA'], [4, 'INSERTADA']]);
  });

  test('resumen: insertadas / ya existentes / invalidas', () => {
    const r = clas(items(filaValida(1), filaValida(1), filaValida(2, { tipoFoto: 'X' })), [existente({ fotoId: filaValida(1).fotoId })]);
    expect(Imp.fotosPozosImport_resumir(r)).toEqual({ leidas: 3, insertadas: 0, yaExistentes: 1, invalidas: 2 });
  });
});

describe('setupFotosPozosImportStaging', () => {
  test('crea la hoja con las 27 columnas + 2 de resultado, todo como texto, y es idempotente', () => {
    hojas = instalarSheetsFalsos({});
    Imp.setupFotosPozosImportStaging();
    expect(Object.keys(hojas)).toEqual(['FotosPozosImport']);
    expect(hojas.FotosPozosImport.filas[0]).toEqual(COLS_STAGING());
    expect(hojas.FotosPozosImport.filas[0]).toHaveLength(29);
    expect(hojas.FotosPozosImport.congeladas).toBe(1);
    expect(hojas.FotosPozosImport.formatoColumnas[0]).toMatchObject({ fmt: '@', col: 1, nCols: 29 });
    hojas.FotosPozosImport.filas.push(['dato que no hay que pisar']);
    const antes = JSON.stringify(hojas.FotosPozosImport.filas);
    Imp.setupFotosPozosImportStaging();
    expect(JSON.stringify(hojas.FotosPozosImport.filas)).toBe(antes);
  });

  test('si existe con otro encabezado NO la toca y avisa', () => {
    hojas = instalarSheetsFalsos({ FotosPozosImport: [['a', 'b'], ['1', '2']] });
    Imp.setupFotosPozosImportStaging();
    expect(hojas.FotosPozosImport.filas).toEqual([['a', 'b'], ['1', '2']]);
    expect(global.Logger.log).toHaveBeenCalledWith(expect.stringMatching(/le faltan columnas/));
  });

  test('no toca ninguna otra hoja (ni FotosPozos ni FotosReemplazo)', () => {
    hojas = instalarSheetsFalsos({ FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS], FotosReemplazo: [['x'], ['y']] });
    Imp.setupFotosPozosImportStaging();
    expect(hojas.FotosPozos.filas).toEqual([Repo.FOTOS_POZOS_COLUMNAS]);
    expect(hojas.FotosReemplazo.filas).toEqual([['x'], ['y']]);
  });
});

describe('importar desde la hoja (de punta a punta)', () => {
  const correr = (opciones) => Imp.fotosPozosImport_ejecutar(Object.assign({ ahora: AHORA, existeEntidad: siempre }, opciones || {}));
  const idx = (n) => Repo.FOTOS_POZOS_COLUMNAS.indexOf(n);

  test('simular no escribe nada en FotosPozos ni en el staging', () => {
    armarHojas([filaValida(1), filaValida(2, { tipoFoto: 'X' })]);
    const staging = JSON.stringify(hojas.FotosPozosImport.filas);
    const r = correr({ simular: true });
    expect(r).toEqual({ leidas: 2, insertadas: 1, yaExistentes: 0, invalidas: 1, simulada: true });
    expect(hojas.FotosPozos.filas).toHaveLength(1);
    expect(JSON.stringify(hojas.FotosPozosImport.filas)).toBe(staging);
    expect(invalidarResumen).not.toHaveBeenCalled();
  });

  test('importa: agrega solo filas nuevas, con timestamp y tipos correctos, y deja el resultado en el staging', () => {
    armarHojas([filaValida(1), filaValida(2, { gpsLat: -33.1, gpsLon: -68.5, gpsOrigen: 'EXIF_ORIGINAL', fechaFotoValor: 2019, fechaFotoPrecision: 'ANIO', fechaFotoFuente: 'NOMBRE_ANIO', fuente: 'MONITOREO_NE', tipoFoto: 'PANORAMICA' }), filaValida(3, { wellId: '' , monitoringId: 'INA 2055', fuente: 'MONITOREO_NE' })]);
    const r = correr();
    expect(r).toEqual({ leidas: 3, insertadas: 3, yaExistentes: 0, invalidas: 0, simulada: false });
    const filas = hojas.FotosPozos.filas;
    expect(filas).toHaveLength(4);
    expect(filas[0]).toEqual(Repo.FOTOS_POZOS_COLUMNAS);
    expect(filas[1][idx('fotoId')]).toBe(filaValida(1).fotoId);
    expect(filas[1][idx('timestampRegistro')]).toEqual(AHORA);
    expect(filas[1][idx('tamanoBytes')]).toBe(400123);
    expect(filas[1][idx('emailUsuarioCarga')]).toBe('IMPORTACION');
    expect(filas[2][idx('fechaFotoValor')]).toBe('2019');
    expect(filas[2][idx('gpsLat')]).toBe(-33.1);
    expect(filas[3][idx('wellId')]).toBe('');
    expect(filas[3][idx('monitoringId')]).toBe('INA 2055');
    // resultado por fila en el staging
    const st = hojas.FotosPozosImport.filas;
    expect(st[1][27]).toBe('INSERTADA');
    expect(st[3][27]).toBe('INSERTADA');
    expect(invalidarResumen).toHaveBeenCalledTimes(1);
  });

  test('las fotos importadas se ven en la galeria y en el contador; las demas filas no', () => {
    armarHojas([filaValida(1), filaValida(2, { wellId: '15-0999' })]);
    correr();
    expect(Repo.fotosPozosRepository_contarVisiblesPorEntidad()).toEqual({ '15-0268': 1, '15-0999': 1 });
    expect(Repo.fotosPozosRepository_listarVisiblesPorEntidad({ wellId: '15-0268', monitoringId: '' })).toHaveLength(1);
  });

  test('IDEMPOTENTE: correrla de nuevo no agrega nada (todo queda YA_EXISTE)', () => {
    armarHojas([filaValida(1), filaValida(2), filaValida(3, { estadoVinculo: 'POR_REVISAR' })]);
    expect(correr()).toMatchObject({ insertadas: 2, invalidas: 1 });
    const despues = JSON.stringify(hojas.FotosPozos.filas);
    invalidarResumen.mockClear();
    const r2 = correr();
    expect(r2).toMatchObject({ insertadas: 0, yaExistentes: 2, invalidas: 1 });
    expect(JSON.stringify(hojas.FotosPozos.filas)).toBe(despues);
    expect(hojas.FotosPozosImport.filas[1][27]).toBe('YA_EXISTE');
    expect(invalidarResumen).not.toHaveBeenCalled();
  });

  test('con filas ya existentes mezcladas: solo entran las nuevas', () => {
    armarHojas([filaValida(1), filaValida(2), filaValida(3)], [filaValida(2)]);
    expect(correr()).toMatchObject({ leidas: 3, insertadas: 2, yaExistentes: 1, invalidas: 0 });
    expect(hojas.FotosPozos.filas).toHaveLength(4);
  });

  test('una foto OCULTA en FotosPozos no revive al reimportar', () => {
    armarHojas([filaValida(1)], [filaValida(1, { estado: 'OCULTA' })]);
    expect(correr()).toMatchObject({ insertadas: 0, yaExistentes: 1 });
    expect(hojas.FotosPozos.filas[1][idx('estado')]).toBe('OCULTA');
  });

  test('NO borra ni modifica el staging salvo las dos columnas de resultado', () => {
    armarHojas([filaValida(1), filaValida(2, { tipoFoto: 'X' })]);
    const antes = hojas.FotosPozosImport.filas.map((f) => f.slice(0, 27));
    correr();
    expect(hojas.FotosPozosImport.filas).toHaveLength(3);
    expect(hojas.FotosPozosImport.filas.map((f) => f.slice(0, 27))).toEqual(antes);
    expect(hojas.FotosPozosImport.filas[2][27]).toBe('INVALIDA');
    expect(hojas.FotosPozosImport.filas[2][28]).toMatch(/tipoFoto/);
  });

  test('no toca FotosReemplazo', () => {
    armarHojas([filaValida(1)]);
    correr();
    expect(hojas.FotosReemplazo.filas).toEqual([['fotoId', 'evaluacionId'], ['sentinela', 'e1']]);
  });

  test('ignora las filas totalmente vacias del staging y conserva el numero de fila real', () => {
    armarHojas([filaValida(1), {}, filaValida(2, { tipoFoto: 'X' })]);
    const r = correr();
    expect(r).toMatchObject({ leidas: 2, insertadas: 1, invalidas: 1 });
    expect(hojas.FotosPozosImport.filas[3][27]).toBe('INVALIDA');       // fila 4 de la hoja
    expect(hojas.FotosPozosImport.filas[2][27] || '').toBe('');
  });

  test('un lote grande entra por lotes (1.200 filas) sin duplicar', () => {
    armarHojas(Array.from({ length: 1200 }, (_, i) => filaValida(i + 1, { wellId: '15-' + String(1000 + (i % 700)).padStart(4, '0') })));
    const r = correr();
    expect(r).toMatchObject({ leidas: 1200, insertadas: 1200 });
    expect(hojas.FotosPozos.filas).toHaveLength(1201);
    expect(new Set(hojas.FotosPozos.filas.slice(1).map((f) => f[0])).size).toBe(1200);
    expect(correr()).toMatchObject({ insertadas: 0, yaExistentes: 1200 });
  });

  test('valida la existencia de la entidad: una entidad inventada no entra', () => {
    armarHojas([filaValida(1), filaValida(2, { wellId: '15-0999' })]);
    const r = correr({ existeEntidad: (e) => e.wellId === '15-0268' });
    expect(r).toMatchObject({ insertadas: 1, invalidas: 1 });
    expect(hojas.FotosPozosImport.filas[2][28]).toMatch(/no existe/);
  });

  test('sin hoja de staging o sin FotosPozos: error claro, nada se escribe', () => {
    hojas = instalarSheetsFalsos({ FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS] });
    expect(() => correr()).toThrow(/setupFotosPozosImportStaging/);
    hojas = instalarSheetsFalsos({ FotosPozosImport: [COLS_STAGING()] });
    expect(() => correr()).toThrow(/setupFotosPozosSheet/);
  });

  test('si faltan columnas obligatorias en el staging: error y no se procesa nada', () => {
    hojas = instalarSheetsFalsos({ FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS], FotosPozosImport: [['fotoId', 'wellId'], ['x', 'y']] });
    expect(() => correr()).toThrow(/no tiene las columnas/);
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('las funciones para correr a mano ejecutan la importacion real y la simulada', () => {
    armarHojas([filaValida(1)]);
    global.nivelesEstaticosRepository_getTodosLosPuntos = jest.fn(() => ({ found: true, puntos: { '15-0268': {} } }));
    expect(Imp.simularImportacionFotosPozosDesdeHoja()).toMatchObject({ simulada: true, insertadas: 1 });
    expect(hojas.FotosPozos.filas).toHaveLength(1);
    expect(Imp.importarFotosPozosDesdeHoja()).toMatchObject({ simulada: false, insertadas: 1 });
    expect(hojas.FotosPozos.filas).toHaveLength(2);
  });

  test('el log lleva solo contadores y motivos: nunca ids de Drive ni sha1', () => {
    armarHojas([filaValida(1), filaValida(2, { tipoFoto: 'X' })]);
    correr();
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toMatch(/insertadas=1/);
    expect(log).not.toMatch(/Drive(File|Thumb)/);
    expect(log).not.toContain(filaValida(1).sha1Original);
  });
});

describe('verificador de entidades (una lectura por archivo, no por foto)', () => {
  test('wellId en la red NE o en el padron; monitoringId solo en la red NE', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos = jest.fn(() => ({ found: true, puntos: { '03-0652': {}, 'INA 2055': {} } }));
    global.registryRepository_getWellIdsDeArchivo = jest.fn((archivo) => (archivo === '15.json' ? { '15-0268': true } : {}));
    const items = ['03-0652', '15-0268', '15-0999', '15-0268'].map((w, i) => ({ numeroFila: i + 2, cruda: { wellId: w, monitoringId: '' } }));
    const existe = Imp.fotosPozosImport_crearVerificadorEntidades(items);
    expect(existe({ wellId: '03-0652', monitoringId: '' })).toBe(true);
    expect(existe({ wellId: '15-0268', monitoringId: '' })).toBe(true);
    expect(existe({ wellId: '15-0999', monitoringId: '' })).toBe(false);
    expect(existe({ wellId: '', monitoringId: 'INA 2055' })).toBe(true);
    expect(existe({ wellId: '', monitoringId: 'INA 9' })).toBe(false);
    expect(global.registryRepository_getWellIdsDeArchivo).toHaveBeenCalledTimes(1);     // un archivo, no cuatro pozos
    expect(global.registryRepository_getWellIdsDeArchivo).toHaveBeenCalledWith('15.json');
  });

  test('los departamentos particionados leen su particion (DD-n.json)', () => {
    global.nivelesEstaticosRepository_getTodosLosPuntos = jest.fn(() => ({ found: true, puntos: {} }));
    global.registryRepository_getWellIdsDeArchivo = jest.fn(() => ({ '07-1245': true }));
    const items = [{ numeroFila: 2, cruda: { wellId: '07-1245', monitoringId: '' } }, { numeroFila: 3, cruda: { wellId: '07-2106', monitoringId: '' } }];
    Imp.fotosPozosImport_crearVerificadorEntidades(items);
    expect(global.registryRepository_getWellIdsDeArchivo.mock.calls.map((c) => c[0]).sort()).toEqual(['07-1.json', '07-2.json']);
  });

  test('registryRepository_getWellIdsDeArchivo devuelve las claves del archivo (y {} si no existe)', () => {
    global.getRegistryFolderId = () => 'CARPETA';
    const archivo = (obj) => ({ getBlob: () => ({ getDataAsString: () => JSON.stringify(obj) }) });
    const it = (l) => { let i = 0; return { hasNext: () => i < l.length, next: () => l[i++] }; };
    global.DriveApp = { getFolderById: () => ({ getFilesByName: (n) => it(n === '15.json' ? [archivo({ '15-0001': {}, '15-0002': {} })] : []) }) };
    expect(Registry.registryRepository_getWellIdsDeArchivo('15.json')).toEqual({ '15-0001': true, '15-0002': true });
    expect(Registry.registryRepository_getWellIdsDeArchivo('99.json')).toEqual({});
  });
});

describe('no es un endpoint web y no toca lo que no debe', () => {
  const leer = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

  test('Api.js no enruta ni nombra la importacion', () => {
    const api = leer('Api.js');
    expect(api).not.toMatch(/FotosPozosImport|importarFotosPozosDesdeHoja|simularImportacion|setupFotosPozosImportStaging/);
  });

  test('doPost no ejecuta la importacion aunque se pida por su nombre', () => {
    armarHojas([filaValida(1)]);
    global.verifySessionToken = jest.fn(() => ({ valid: true, email: 'admin@x.com' }));
    global.isUserActive = jest.fn(() => true);
    global.hasPermission = jest.fn(() => true);
    global.getUserAccess = jest.fn(() => ({ active: true, nombre: 'Admin', permisos: { fotos: true, fotos_carga: true } }));
    global.logHistoryEvent = jest.fn();
    global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
    const Api = require('../src/Api');
    for (const accion of ['importarFotosPozosDesdeHoja', 'simularImportacionFotosPozosDesdeHoja', 'setupFotosPozosImportStaging', 'fotosPozosImport_ejecutar']) {
      const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify({ action: accion, sessionToken: 't' }) } }).text);
      expect(r.status).toBe('error');
    }
    expect(hojas.FotosPozos.filas).toHaveLength(1);
  });

  test('el codigo de la importacion no menciona FotosReemplazo ni borra/limpia hojas', () => {
    const src = leer('FotosPozosImport.js').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/FotosReemplazo|deleteSheet|deleteRow|\.clear\(|clearContent|setTrashed|getFolderById|DriveApp/);
  });

  test('no usa la URL ni el secreto del storage (no se comunica con el storage)', () => {
    const src = leer('FotosPozosImport.js');
    expect(src).not.toMatch(/getFotosStorage|UrlFetchApp|fotosStorageClient/);
  });
});
