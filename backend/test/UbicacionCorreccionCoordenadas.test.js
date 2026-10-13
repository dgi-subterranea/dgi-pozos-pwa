// Etapa 2 de "Ingresar coordenadas": el BACKEND acepta, re-deriva y audita COORDENADAS_GMS y COORDENADAS_POSGAR94_AR2.
// Cadena REAL servicio -> repositorio sobre hojas en memoria (fakeSheets) y padron simulado. Cubre: GMS / POSGAR validos e invalidos, X/Y invertidos, fuera de
// Mendoza, coma/punto, re-derivacion (el cliente no es autoridad), COORDENADA_INCONSISTENTE, texto canonico y CRS, idempotencia, hoja V1 (18 columnas) vs V2
// (20), MIGRACION 18 -> 20 (idempotente y sin tocar datos), setup nuevo y email con metodo nuevo. Usa el fixture generado con pyproj.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const fixture = require('../../js/fixtures/posgar94_ar2_vectores.json');

const W = '14-0001';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const GMS_OFICIAL = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };     // = OFICIAL (pozo 14-0001)
const METROS_POR_GRADO = 111195;

let Repo;
let S;
let C;
let N;
let hojas;
let logs;

const filasDe = (nombre) => hojas[nombre].filas.slice(1);
const correcciones = () => filasDe('UbicacionCorrecciones');
const eventos = () => filasDe('UbicacionCorreccionesLog');
const campo = (fila, nombre) => fila[hojas.UbicacionCorrecciones.filas[0].indexOf(nombre)];
// copia profunda que conserva las fechas (las filas de la hoja guardan Date)
const copia = (x) => {
  if (x instanceof Date) { return new Date(x.getTime()); }
  if (Array.isArray(x)) { return x.map(copia); }
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach((k) => { o[k] = copia(x[k]); }); return o; }
  return x;
};

function instalar(columnasCorrecciones) {
  jest.resetModules();
  installAppsScriptFakes();
  logs = [];
  global.Logger = { log: jest.fn((t) => { logs.push(String(t)); }) };
  Repo = require('../src/UbicacionCorreccionRepository');
  S = require('../src/UbicacionCorreccionService');
  C = require('../src/CoordenadasConversion');
  N = require('../src/UbicacionCorreccionNotificacion');
  Object.assign(global, Repo, S, N);
  hojas = instalarSheetsFalsos({
    UbicacionCorrecciones: [columnasCorrecciones || Repo.UBICACION_CORRECCIONES_COLUMNAS],
    UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS]
  });
  global.registryService_getWellLocation = jest.fn((id) => (id === W
    ? { found: true, location: { wellId: id, ubicacionResuelta: OFICIAL } }
    : { found: false }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
}

beforeEach(() => instalar());

let contador = 0;
const id = () => { contador += 1; return 'req-' + String(contador).padStart(8, '0'); };
const gmsDe = (lat, lon) => ({ lat: Object.assign({}, GMS_OFICIAL.lat, lat), lon: Object.assign({}, GMS_OFICIAL.lon, lon) });
const proponerGms = (original, extra, email) => S.ubicacionCorreccionService_proponer(email || 'ana@x.com', 'Ana', W,
  Object.assign({ clientRequestId: id(), metodo: 'COORDENADAS_GMS', coordenadaOriginal: original || GMS_OFICIAL, observacion: '' }, extra || {}));
const proponerPosgar = (original, extra, email) => S.ubicacionCorreccionService_proponer(email || 'ana@x.com', 'Ana', W,
  Object.assign({ clientRequestId: id(), metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: original, observacion: '' }, extra || {}));
const proponerMapa = (extra) => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W,
  Object.assign({ clientRequestId: id(), metodo: 'PUNTO_EN_MAPA', lat: OFICIAL.lat + 0.0002, lon: OFICIAL.lon, precisionGpsM: null, observacion: '' }, extra || {}));
const proponerGps = (extra) => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W,
  Object.assign({ clientRequestId: id(), metodo: 'GPS_ACTUAL', lat: OFICIAL.lat + 0.0002, lon: OFICIAL.lon, precisionGpsM: 8, observacion: '' }, extra || {}));

// POSGAR (x, y) del punto oficial del pozo, a 2 decimales: queda a unos pocos cm de OFICIAL
const posgarOficial = () => {
  const p = C.coordenadas_wgs84APosgar(OFICIAL.lat, OFICIAL.lon);
  return { x: Number(p.este.toFixed(2)), y: Number(p.norte.toFixed(2)) };
};

describe('COORDENADAS_GMS', () => {
  test('valido: la correccion queda con lat/lon DERIVADOS por el backend, texto canonico y CRS GMS_WGS84', () => {
    const r = proponerGms();
    expect(r.ok).toBe(true);
    expect(r.correccion).toMatchObject({
      metodo: 'COORDENADAS_GMS', lat: -33.34765, lon: -69.14545, precisionGpsM: null, estado: 'PROPUESTA',
      coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O', crsOriginal: 'GMS_WGS84'
    });
    const fila = correcciones()[0];
    expect(campo(fila, 'coordenadaOriginalTexto')).toBe('33° 20\' 51.54" S, 69° 8\' 43.62" O');
    expect(campo(fila, 'crsOriginal')).toBe('GMS_WGS84');
    expect(campo(fila, 'lat')).toBe(-33.34765);
    expect(campo(fila, 'precisionGpsM')).toBe('');
    expect(r.correccion.distanciaM).toBeLessThan(0.5);
    expect(eventos()).toHaveLength(1);
  });

  test('el ejemplo del pedido: 32° 53\' 10.2" S, 68° 50\' 25.4" O -> -32.886167, -68.840389', () => {
    const r = proponerGms({ lat: { g: 32, m: 53, s: 10.2, h: 'S' }, lon: { g: 68, m: 50, s: 25.4, h: 'O' } }, { observacion: 'cerca de la ciudad' });
    expect(r.ok).toBe(true);
    expect([r.correccion.lat, r.correccion.lon]).toEqual([-32.886167, -68.840389]);
  });

  test('coma y punto decimal dan el MISMO resultado y el mismo texto canonico; hemisferio en minuscula y W para el oeste', () => {
    const conPunto = proponerGms(gmsDe({ s: '51.54' }, { s: '43.62' })).correccion;
    const conComa = proponerGms({ lat: { g: '33', m: '20', s: '51,54', h: 's' }, lon: { g: '69', m: '8', s: '43,62', h: 'w' } }).correccion;
    expect([conComa.lat, conComa.lon, conComa.coordenadaOriginalTexto]).toEqual([conPunto.lat, conPunto.lon, conPunto.coordenadaOriginalTexto]);
    expect(conComa.coordenadaOriginalTexto).toBe('33° 20\' 51.54" S, 69° 8\' 43.62" O');
  });

  test('minutos y segundos vacios valen 0; el texto canonico siempre trae g° m\' s"', () => {
    const r = proponerGms({ lat: { g: 33, m: '', s: null, h: 'S' }, lon: { g: 69, h: 'O' } }, { observacion: 'sin minutos' });
    expect(r.ok).toBe(true);
    expect(r.correccion.coordenadaOriginalTexto).toBe('33° 0\' 0" S, 69° 0\' 0" O');
    expect([r.correccion.lat, r.correccion.lon]).toEqual([-33, -69]);
  });

  test.each([
    ['grados vacios', gmsDe({ g: '' }), 'GRADOS_REQUERIDOS', 'lat.g'],
    ['grados no numericos', gmsDe({ g: 'abc' }), 'GRADOS_INVALIDOS', 'lat.g'],
    ['grados negativos', gmsDe({ g: -33 }), 'NEGATIVO', 'lat.g'],
    ['grados con decimales', gmsDe({ g: 33.5 }), 'GRADOS_NO_ENTEROS', 'lat.g'],
    ['grados > 90 en latitud', gmsDe({ g: 91 }), 'GRADOS_FUERA_DE_RANGO', 'lat.g'],
    ['grados > 180 en longitud', gmsDe({}, { g: 181 }), 'GRADOS_FUERA_DE_RANGO', 'lon.g'],
    ['minutos = 60', gmsDe({ m: 60 }), 'MINUTOS_FUERA_DE_RANGO', 'lat.m'],
    ['minutos con decimales', gmsDe({ m: 20.5 }), 'MINUTOS_NO_ENTEROS', 'lat.m'],
    ['minutos negativos', gmsDe({ m: -1 }), 'NEGATIVO', 'lat.m'],
    ['segundos = 60', gmsDe({ s: 60 }), 'SEGUNDOS_FUERA_DE_RANGO', 'lat.s'],
    ['segundos negativos', gmsDe({ s: -0.5 }), 'NEGATIVO', 'lat.s'],
    ['segundos no numericos', gmsDe({}, { s: 'x' }), 'SEGUNDOS_INVALIDOS', 'lon.s'],
    ['hemisferio vacio', gmsDe({ h: '' }), 'HEMISFERIO_REQUERIDO', 'lat.h'],
    ['latitud con E', gmsDe({ h: 'E' }), 'HEMISFERIO_INVALIDO', 'lat.h'],
    ['longitud con N', gmsDe({}, { h: 'N' }), 'HEMISFERIO_INVALIDO', 'lon.h'],
    ['notacion cientifica', gmsDe({ g: '1e1' }), 'GRADOS_INVALIDOS', 'lat.g'],
    ['NaN como texto', gmsDe({ s: 'NaN' }), 'SEGUNDOS_INVALIDOS', 'lat.s'],
    ['Infinity como texto', gmsDe({ s: 'Infinity' }), 'SEGUNDOS_INVALIDOS', 'lat.s'],
    ['NaN numerico', gmsDe({ g: NaN }), 'GRADOS_INVALIDOS', 'lat.g'],
    ['Infinity numerico', gmsDe({ s: Infinity }), 'SEGUNDOS_INVALIDOS', 'lat.s']
  ])('invalido: %s -> COORDENADA_INVALIDA (%s en %s) y no se escribe nada', (_n, original, detalle, campoError) => {
    const r = proponerGms(original);
    expect(r).toMatchObject({ ok: false, code: 'COORDENADA_INVALIDA', detalle: detalle, campo: campoError });
    expect(typeof r.message).toBe('string');
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
  });

  test('hemisferio equivocado (N / E): FUERA_DE_MENDOZA con la pista del hemisferio, sin corregirlo solo', () => {
    const r = proponerGms(gmsDe({ h: 'N' }));
    expect(r).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
    expect(r.message).toMatch(/hemisferio/i);
    expect(correcciones()).toHaveLength(0);
    expect(proponerGms(gmsDe({}, { h: 'E' }))).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
  });

  test('fuera de Mendoza (Buenos Aires) y en el borde exacto de la caja', () => {
    expect(proponerGms({ lat: { g: 34, m: 36, s: 0, h: 'S' }, lon: { g: 58, m: 22, s: 0, h: 'O' } })).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
    expect(proponerGms({ lat: { g: 38, m: 0, s: 0, h: 'S' }, lon: { g: 69, m: 0, s: 0, h: 'O' } })).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
    expect(proponerGms({ lat: { g: 0, m: 0, s: 0, h: 'N' }, lon: { g: 0, m: 0, s: 0, h: 'E' } })).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
  });

  test('con los 14 vectores GMS del fixture (aritmetica exacta): los de Mendoza se guardan con el valor decimal esperado, el resto se rechaza', () => {
    let guardados = 0;
    fixture.gms.forEach((v) => {
      const r = proponerGms({ lat: v.lat, lon: v.lon }, { observacion: 'vector' });
      const b = S.UBICACION_CORR_MENDOZA_BBOX;
      const adentro = v.latDecimal >= b.latMin && v.latDecimal <= b.latMax && v.lonDecimal >= b.lonMin && v.lonDecimal <= b.lonMax;
      if (adentro) {
        guardados += 1;
        expect(r.ok).toBe(true);
        expect(Math.abs(r.correccion.lat - v.latDecimal)).toBeLessThanOrEqual(5.1e-7);
        expect(Math.abs(r.correccion.lon - v.lonDecimal)).toBeLessThanOrEqual(5.1e-7);
        expect(r.correccion.crsOriginal).toBe('GMS_WGS84');
      } else {
        expect(r.ok).toBe(false);
      }
    });
    expect(guardados).toBeGreaterThanOrEqual(8);
  });
});

describe('COORDENADAS_POSGAR94_AR2', () => {
  test('valido: lat/lon derivados por el backend, texto canonico X(Este)=..., Y(Norte)=... y CRS EPSG:22182', () => {
    const p = posgarOficial();
    const r = proponerPosgar(p);
    expect(r.ok).toBe(true);
    expect(r.correccion).toMatchObject({
      metodo: 'COORDENADAS_POSGAR94_AR2', estado: 'PROPUESTA', precisionGpsM: null, crsOriginal: 'EPSG:22182',
      coordenadaOriginalTexto: 'X(Este)=' + p.x.toFixed(2) + ', Y(Norte)=' + p.y.toFixed(2)
    });
    expect(r.correccion.distanciaM).toBeLessThan(0.5);
    const fila = correcciones()[0];
    expect(campo(fila, 'crsOriginal')).toBe('EPSG:22182');
    expect(campo(fila, 'coordenadaOriginalTexto')).toBe(r.correccion.coordenadaOriginalTexto);
  });

  test('el ejemplo del pedido: X(Este)=2500000.00, Y(Norte)=6350000.00 -> -32.992946, -69 (pyproj)', () => {
    const r = proponerPosgar({ x: 2500000, y: 6350000 }, { observacion: 'meridiano central' });
    expect(r.ok).toBe(true);
    expect([r.correccion.lat, r.correccion.lon]).toEqual([-32.992946, -69]);
    expect(r.correccion.coordenadaOriginalTexto).toBe('X(Este)=2500000.00, Y(Norte)=6350000.00');
  });

  test('los 60 vectores de pyproj: cada uno que cae en Mendoza se guarda con lat/lon de pyproj (a 6 decimales), el resto se rechaza por la caja', () => {
    let guardados = 0;
    let rechazados = 0;
    fixture.posgar.forEach((v) => {
      const r = proponerPosgar({ x: v.x, y: v.y }, { observacion: 'vector pyproj' });
      if (r.ok) {
        guardados += 1;
        expect(Math.abs(r.correccion.lat - v.lat)).toBeLessThanOrEqual(5.1e-7);
        expect(Math.abs(r.correccion.lon - v.lon)).toBeLessThanOrEqual(5.1e-7);
        expect(r.correccion.crsOriginal).toBe('EPSG:22182');
        expect(r.correccion.coordenadaOriginalTexto).toBe('X(Este)=' + v.x.toFixed(2) + ', Y(Norte)=' + v.y.toFixed(2));
      } else {
        rechazados += 1;
        expect(r.code).toBe('FUERA_DE_MENDOZA');
      }
    });
    expect(guardados + rechazados).toBe(fixture.posgar.length);
    expect(guardados).toBeGreaterThanOrEqual(30);
    expect(correcciones()).toHaveLength(guardados);
  });

  test('numeros como texto: coma decimal, punto decimal y puntos de miles ("2.500.000,50") dan el mismo canonico', () => {
    const a = proponerPosgar({ x: '2500000,5', y: '6350000.25' }, { observacion: 'a' }).correccion;
    const b = proponerPosgar({ x: '2.500.000,50', y: '6.350.000,25' }, { observacion: 'b' }).correccion;
    const c = proponerPosgar({ x: 2500000.5, y: 6350000.25 }, { observacion: 'c' }).correccion;
    expect(a.coordenadaOriginalTexto).toBe('X(Este)=2500000.50, Y(Norte)=6350000.25');
    expect([b.coordenadaOriginalTexto, b.lat, b.lon]).toEqual([a.coordenadaOriginalTexto, a.lat, a.lon]);
    expect([c.coordenadaOriginalTexto, c.lat, c.lon]).toEqual([a.coordenadaOriginalTexto, a.lat, a.lon]);
  });

  test('X/Y invertidos (X = Norte, Y = Este): XY_INVERTIDOS, NO se intercambian solos y no se escribe nada', () => {
    const r = proponerPosgar({ x: 6350000, y: 2500000 });
    expect(r).toMatchObject({ ok: false, code: 'XY_INVERTIDOS' });
    expect(r.message).toMatch(/X es el Este/);
    expect(correcciones()).toHaveLength(0);
    expect(proponerPosgar({ x: '6.350.000,00', y: '2.500.000,00' })).toMatchObject({ ok: false, code: 'XY_INVERTIDOS' });
  });

  test.each([
    ['Este vacio', { x: '', y: 6350000 }, 'ESTE_REQUERIDO', 'x'],
    ['Norte vacio', { x: 2500000, y: null }, 'NORTE_REQUERIDO', 'y'],
    ['Este no numerico', { x: 'abc', y: 6350000 }, 'ESTE_INVALIDO', 'x'],
    ['Norte no numerico', { x: 2500000, y: '12a' }, 'NORTE_INVALIDO', 'y'],
    ['Este NaN', { x: NaN, y: 6350000 }, 'ESTE_INVALIDO', 'x'],
    ['Norte Infinity', { x: 2500000, y: Infinity }, 'NORTE_INVALIDO', 'y'],
    ['Este fuera de rango (muy chico)', { x: 2299999, y: 6350000 }, 'ESTE_FUERA_DE_RANGO', 'x'],
    ['Este fuera de rango (muy grande)', { x: 3500000, y: 6350000 }, 'ESTE_FUERA_DE_RANGO', 'x'],
    ['Norte fuera de rango', { x: 2500000, y: 5000000 }, 'NORTE_FUERA_DE_RANGO', 'y'],
    ['Este negativo', { x: -2500000, y: 6350000 }, 'NEGATIVO', undefined],
    ['notacion cientifica', { x: '2.5e6', y: 6350000 }, 'ESTE_INVALIDO', 'x']
  ])('invalido: %s -> COORDENADA_INVALIDA (%s)', (_n, original, detalle, campoError) => {
    const r = proponerPosgar(original);
    expect(r).toMatchObject({ ok: false, code: 'COORDENADA_INVALIDA', detalle: detalle });
    if (campoError) {
      expect(r.campo).toBe(campoError);
    }
    expect(correcciones()).toHaveLength(0);
  });

  test('dentro del rango de sanidad pero fuera de la caja de Mendoza (esquina SO): FUERA_DE_MENDOZA', () => {
    expect(proponerPosgar({ x: 2300000, y: 5800000 })).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
    expect(correcciones()).toHaveLength(0);
  });
});

describe('el backend RE-DERIVA: el cliente no es autoridad', () => {
  test('lat/lon opcionales del cliente que COINCIDEN: se acepta y se guarda lo del backend', () => {
    const r = proponerGms(GMS_OFICIAL, { lat: -33.34765, lon: -69.14545 });
    expect(r.ok).toBe(true);
    expect([r.correccion.lat, r.correccion.lon]).toEqual([-33.34765, -69.14545]);
  });

  test('sin lat/lon del cliente (o null) tambien es valido: el preview es opcional', () => {
    expect(proponerGms(GMS_OFICIAL, { lat: null, lon: null }).ok).toBe(true);
    expect(proponerGms(GMS_OFICIAL, { lat: undefined, lon: undefined }).ok).toBe(true);
  });

  test('lat/lon manipulados (otro punto de Mendoza): COORDENADA_INCONSISTENTE, y NO se guarda nada', () => {
    const r = proponerGms(GMS_OFICIAL, { lat: -33.0, lon: -69.0 });
    expect(r).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
    expect(r.distanciaM).toBeUndefined();
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
    expect(proponerPosgar(posgarOficial(), { lat: -33.0, lon: -69.0 })).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
  });

  test('lat/lon manipulados para una coordenada FUERA de Mendoza no sirven: manda el valor original (y viceversa)', () => {
    expect(proponerGms(gmsDe({ h: 'N' }), { lat: -33.34765, lon: -69.14545 })).toMatchObject({ ok: false, code: 'FUERA_DE_MENDOZA' });
    expect(proponerGms(GMS_OFICIAL, { lat: 33.34765, lon: -69.14545 })).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
  });

  describe('COORDENADA_INCONSISTENTE: tolerancia METRICA de 2 cm contra la conversion SIN redondear (el redondeo a 6 decimales no decide)', () => {
    const dist = (a, b) => S.ubicacionCorreccionService_distanciaMetrosExacta(a.lat, a.lon, b.lat, b.lon);
    const M_POR_GRADO = 111195.08;
    // punto "exacto" del backend para un GMS dado (lo que devuelve el modulo sin redondear)
    const exacto = (gms) => { const e = C.coordenadas_evaluarGms(gms); return { lat: e.latExacta, lon: e.lonExacta, redondeado: { lat: e.lat, lon: e.lon } }; };
    // corre el punto exacto `metros` al norte / al este
    const norteDe = (p, metros) => ({ lat: p.lat + metros / M_POR_GRADO, lon: p.lon });
    const esteDe = (p, metros) => ({ lat: p.lat, lon: p.lon + metros / (M_POR_GRADO * Math.cos(p.lat * Math.PI / 180)) });
    const con = (p) => proponerGms(GMS_OFICIAL, { lat: p.lat, lon: p.lon });
    let base;
    beforeEach(() => { base = exacto(GMS_OFICIAL); });

    test('el modulo devuelve la conversion sin redondear ademas de la redondeada a 6 decimales', () => {
      const e = C.coordenadas_evaluarGms(gmsDe({ s: 51.541764 }));
      expect(e.lat).toBe(-33.34765);
      expect(e.latExacta).not.toBe(e.lat);
      expect(Math.abs(e.latExacta - (-(33 + 20 / 60 + 51.541764 / 3600)))).toBeLessThan(1e-12);
    });

    test.each([
      ['el mismo punto', 0], ['0,5 cm al norte', 0.005], ['1 cm al norte', 0.01], ['1,5 cm al norte', 0.015], ['1,9 cm al norte', 0.019]
    ])('ACEPTADA: %s (< 2 cm), y se guarda el valor del BACKEND redondeado', (_n, metros) => {
      const cliente = norteDe(base, metros);
      expect(dist(base, cliente)).toBeLessThan(0.0200001);
      const r = con(cliente);
      expect(r.ok).toBe(true);
      expect([r.correccion.lat, r.correccion.lon]).toEqual([-33.34765, -69.14545]);
      expect(campo(correcciones()[0], 'lat')).toBe(-33.34765);
    });

    test('ACEPTADA tambien hacia el este y en diagonal (la tolerancia es una distancia, no un delta de grados)', () => {
      expect(con(esteDe(base, 0.019)).ok).toBe(true);
      expect(con(esteDe(norteDe(base, 0.012), 0.012)).ok).toBe(true);          // ~1,7 cm en diagonal
    });

    test.each([
      ['2,1 cm al norte', 0.021], ['3 cm', 0.03], ['5 cm', 0.05], ['11 cm (una celda de 6 decimales)', 0.11], ['1 m', 1], ['50 m', 50]
    ])('RECHAZADA: %s (> 2 cm) -> COORDENADA_INCONSISTENTE y no se guarda nada', (_n, metros) => {
      const r = con(norteDe(base, metros));
      expect(r).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
      expect(correcciones()).toHaveLength(0);
      expect(eventos()).toHaveLength(0);
    });

    test('RECHAZADA hacia el este y en diagonal por encima de 2 cm (1,6 cm + 1,6 cm = 2,3 cm)', () => {
      expect(con(esteDe(base, 0.021))).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
      expect(con(esteDe(norteDe(base, 0.016), 0.016))).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
    });

    test('borde: el umbral es 2 cm de verdad (1,99 cm pasa, 2,01 cm no)', () => {
      expect(con(norteDe(base, 0.0199)).ok).toBe(true);
      expect(con(norteDe(base, 0.0201))).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
    });

    test('EL REDONDEO NO DECIDE (1): el valor ya redondeado a 6 decimales que se guarda esta a 5,4 cm de la conversion exacta -> si el cliente manda ESE valor, se rechaza', () => {
      const original = gmsDe({ s: 51.541764 });                          // 33,3476504900...: se persiste como 33,34765 (4,9e-7 grados = 5,4 cm de redondeo)
      const e = exacto(original);
      expect(e.redondeado).toEqual({ lat: -33.34765, lon: -69.14545 });
      expect(dist(e, e.redondeado)).toBeGreaterThan(0.05);
      const conRedondeado = proponerGms(original, { lat: e.redondeado.lat, lon: e.redondeado.lon });
      expect(conRedondeado).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
      expect(correcciones()).toHaveLength(0);
      // y mandando la conversion exacta, pasa y SE PERSISTE redondeada
      const conExacto = proponerGms(original, { lat: e.lat, lon: e.lon });
      expect(conExacto.ok).toBe(true);
      expect([conExacto.correccion.lat, conExacto.correccion.lon]).toEqual([-33.34765, -69.14545]);
    });

    test('EL REDONDEO NO DECIDE (2): un cliente en OTRA celda de 6 decimales pero a 1,5 cm del punto exacto SI se acepta', () => {
      const original = gmsDe({ s: 51.5417964 });                          // exacto = 33,347650499 (justo por debajo del limite entre dos celdas)
      const e = exacto(original);
      const cliente = norteDe(e, -0.015);                                 // 1,5 cm hacia el sur: cae en la celda vecina (33,347651)
      expect(Math.round(cliente.lat * 1e6) / 1e6).not.toBe(e.redondeado.lat);
      expect(dist(e, cliente)).toBeLessThan(0.016);
      const r = proponerGms(original, { lat: cliente.lat, lon: cliente.lon });
      expect(r.ok).toBe(true);
      expect(r.correccion.lat).toBe(e.redondeado.lat);                    // se guarda lo del backend, no lo del cliente
    });

    test('EL REDONDEO NO DECIDE (3): con la misma diferencia metrica el resultado es el mismo se redondee como se redondee', () => {
      [0, 1e-7, 2.5e-7, 4.9e-7].forEach((delta) => {
        const original = gmsDe({ s: 51.54 + delta * 3600 });
        const e = exacto(original);
        expect(proponerGms(original, norteDe(e, 0.015)).ok).toBe(true);
        expect(proponerGms(original, norteDe(e, 0.025))).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
      });
    });

    test('POSGAR: misma regla metrica contra la conversion sin redondear', () => {
      const p = posgarOficial();
      const e = C.coordenadas_evaluarPosgar(p);
      expect(e.latExacta).not.toBe(e.lat);
      const ok = proponerPosgar(p, { lat: e.latExacta + 0.015 / M_POR_GRADO, lon: e.lonExacta });
      expect(ok.ok).toBe(true);
      expect(proponerPosgar(p, { lat: e.latExacta + 0.025 / M_POR_GRADO, lon: e.lonExacta })).toMatchObject({ ok: false, code: 'COORDENADA_INCONSISTENTE' });
    });

    test('contrato: lat/lon del cliente son opcionales; si vienen, deben ir SIN redondear a 6 decimales (el redondeado puede quedar a 5,5 cm)', () => {
      expect(proponerGms(GMS_OFICIAL).ok).toBe(true);
      expect(S.UBICACION_CORR_COORD_TOLERANCIA_M).toBe(0.02);
    });
  });

  test('lat/lon del cliente con forma invalida: INVALID_COORDENADAS (solo uno, texto, NaN, Infinity, fuera de rango)', () => {
    [{ lat: -33.3 }, { lon: -69.1 }, { lat: '-33.34765', lon: '-69.14545' }, { lat: NaN, lon: -69.14545 }, { lat: Infinity, lon: -69.14545 },
      { lat: -33.34765, lon: -Infinity }, { lat: -91, lon: -69.14545 }, { lat: -33.34765, lon: 181 }, { lat: {}, lon: [] }].forEach((extra) => {
      expect(proponerGms(GMS_OFICIAL, extra)).toMatchObject({ ok: false, code: 'INVALID_COORDENADAS' });
    });
    expect(correcciones()).toHaveLength(0);
  });

  test('coordenadaOriginalTexto y crsOriginal que mande el cliente se IGNORAN: son del backend', () => {
    const r = proponerGms(GMS_OFICIAL, { coordenadaOriginalTexto: 'HACKEADO', crsOriginal: 'EPSG:9999' });
    expect(r.ok).toBe(true);
    expect(r.correccion.coordenadaOriginalTexto).toBe('33° 20\' 51.54" S, 69° 8\' 43.62" O');
    expect(r.correccion.crsOriginal).toBe('GMS_WGS84');
    const m = proponerMapa({ coordenadaOriginalTexto: 'X', crsOriginal: 'Y' });
    expect(m.ok).toBe(true);
    expect([m.correccion.coordenadaOriginalTexto, m.correccion.crsOriginal]).toEqual(['', '']);
  });

  test('un metodo COORDENADAS_* no lleva precisionGpsM', () => {
    expect(proponerGms(GMS_OFICIAL, { precisionGpsM: 5 })).toMatchObject({ ok: false, code: 'INVALID_PRECISION' });
    expect(proponerPosgar(posgarOficial(), { precisionGpsM: 5 })).toMatchObject({ ok: false, code: 'INVALID_PRECISION' });
    expect(proponerGms(GMS_OFICIAL, { precisionGpsM: null }).ok).toBe(true);
  });
});

describe('forma de coordenadaOriginal (payload permitido)', () => {
  const sub = (l) => Object.assign({}, GMS_OFICIAL.lat, l);
  test.each([
    ['sin coordenadaOriginal', undefined],
    ['null', null],
    ['texto', '33 20 51 S'],
    ['numero', 5],
    ['arreglo', []],
    ['falta lon', { lat: GMS_OFICIAL.lat }],
    ['falta lat', { lon: GMS_OFICIAL.lon }],
    ['clave de mas arriba', Object.assign({ extra: 1 }, GMS_OFICIAL)],
    ['clave de mas en un eje', { lat: sub({ extra: 1 }), lon: GMS_OFICIAL.lon }],
    ['eje como texto', { lat: '33 20 51.54 S', lon: GMS_OFICIAL.lon }],
    ['eje como arreglo', { lat: [33, 20, 51.54, 'S'], lon: GMS_OFICIAL.lon }],
    ['grados como objeto', { lat: sub({ g: {} }), lon: GMS_OFICIAL.lon }],
    ['segundos como booleano', { lat: sub({ s: true }), lon: GMS_OFICIAL.lon }],
    ['hemisferio como numero', { lat: sub({ h: 1 }), lon: GMS_OFICIAL.lon }],
    ['texto enorme', { lat: sub({ g: '3'.repeat(5000) }), lon: GMS_OFICIAL.lon }],
    ['claves de POSGAR en un GMS', { x: 2500000, y: 6350000 }]
  ])('COORDENADAS_GMS rechaza: %s -> INVALID_COORDENADA_ORIGINAL', (_n, original) => {
    const r = original === undefined || original === null ? proponerGms(GMS_OFICIAL, { coordenadaOriginal: original }) : proponerGms(original);
    expect(r).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    expect(correcciones()).toHaveLength(0);
  });

  test.each([
    ['sin coordenadaOriginal', undefined],
    ['null', null],
    ['texto', '2500000,6350000'],
    ['arreglo', [2500000, 6350000]],
    ['falta y', { x: 2500000 }],
    ['falta x', { y: 6350000 }],
    ['clave de mas', { x: 2500000, y: 6350000, z: 1 }],
    ['claves este/norte en vez de x/y', { este: 2500000, norte: 6350000 }],
    ['x como objeto', { x: { v: 1 }, y: 6350000 }],
    ['y como booleano', { x: 2500000, y: false }],
    ['texto enorme', { x: '9'.repeat(5000), y: 6350000 }],
    ['claves de GMS en un POSGAR', GMS_OFICIAL]
  ])('COORDENADAS_POSGAR94_AR2 rechaza: %s -> INVALID_COORDENADA_ORIGINAL', (_n, original) => {
    expect(proponerPosgar(original)).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    expect(correcciones()).toHaveLength(0);
  });

  test('un __proto__ o constructor llegado de JSON.parse no pasa (es una clave de mas) y no contamina Object', () => {
    const hostil = JSON.parse('{"lat":{"g":33,"m":20,"s":51.54,"h":"S"},"lon":{"g":69,"m":8,"s":43.62,"h":"O"},"__proto__":{"polluted":true}}');
    expect(proponerGms(hostil)).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    const hostil2 = JSON.parse('{"x":2500000,"y":6350000,"constructor":{"prototype":{"polluted":true}}}');
    expect(proponerPosgar(hostil2)).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    expect({}.polluted).toBeUndefined();
  });

  test('GPS_ACTUAL y PUNTO_EN_MAPA NO llevan coordenadaOriginal (lo rechazan) y sus dos campos nuevos quedan vacios', () => {
    expect(proponerMapa({ coordenadaOriginal: { x: 1, y: 2 } })).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    expect(proponerGps({ coordenadaOriginal: GMS_OFICIAL })).toMatchObject({ ok: false, code: 'INVALID_COORDENADA_ORIGINAL' });
    expect(proponerMapa({ coordenadaOriginal: null }).ok).toBe(true);
    const gps = proponerGps();
    expect(gps.ok).toBe(true);
    const filas = correcciones();
    expect(filas).toHaveLength(2);
    filas.forEach((f) => {
      expect(campo(f, 'coordenadaOriginalTexto')).toBe('');
      expect(campo(f, 'crsOriginal')).toBe('');
    });
  });

  test('un metodo inexistente sigue siendo INVALID_METODO (y el mensaje lista los cuatro)', () => {
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, { clientRequestId: id(), metodo: 'COORDENADAS_UTM', coordenadaOriginal: {}, lat: OFICIAL.lat, lon: OFICIAL.lon });
    expect(r).toMatchObject({ ok: false, code: 'INVALID_METODO' });
    expect(r.message).toMatch(/COORDENADAS_GMS/);
    expect(r.message).toMatch(/COORDENADAS_POSGAR94_AR2/);
  });
});

describe('reglas de distancia y observacion siguen valiendo con coordenadas ingresadas', () => {
  const gmsAlNorte = (metros) => {
    const g = C.coordenadas_decimalAGms(OFICIAL.lat + metros / METROS_POR_GRADO, 'lat');
    return { lat: g, lon: GMS_OFICIAL.lon };
  };
  test('a mas de 250 m exige observacion (OBSERVACION_REQUERIDA con la distancia que calcula el BACKEND)', () => {
    const sin = proponerGms(gmsAlNorte(300));
    expect(sin).toMatchObject({ ok: false, code: 'OBSERVACION_REQUERIDA' });
    expect(sin.distanciaM).toBeGreaterThan(290);
    expect(sin.distanciaM).toBeLessThan(310);
    const con = proponerGms(gmsAlNorte(300), { observacion: 'el pozo esta del otro lado de la ruta' });
    expect(con.ok).toBe(true);
    expect(con.correccion.advertenciaDistancia).toBe(false);
  });

  test('a mas de 1 km queda la bandera de advertencia (con POSGAR tambien)', () => {
    const r = proponerGms(gmsAlNorte(1500), { observacion: 'lejos' });
    expect(r.ok).toBe(true);
    expect(r.correccion.advertenciaDistancia).toBe(true);
    const p = posgarOficial();
    const q = proponerPosgar({ x: p.x, y: p.y + 1500 }, { observacion: 'lejos' });
    expect(q.ok).toBe(true);
    expect(q.correccion.advertenciaDistancia).toBe(true);
    expect(q.correccion.distanciaM).toBeGreaterThan(1490);
    expect(q.correccion.distanciaM).toBeLessThan(1510);
  });

  test('conserva el snapshot de Irrigacion que toma el backend', () => {
    const r = proponerGms();
    expect(r.correccion.irrigacion).toMatchObject({ lat: OFICIAL.lat, lon: OFICIAL.lon, estado: 'unica', padronPeriodo: '2026-09' });
  });

  test('con auto-validacion (corregir + validar) nace VALIDADA y supera a la anterior, con auditoria del original', () => {
    const primera = S.ubicacionCorreccionService_proponer('carla@x.com', 'Carla', W, { clientRequestId: id(), metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS_OFICIAL, observacion: '' }, { autoValidar: true });
    expect(primera).toMatchObject({ ok: true, autoValidada: true });
    expect(primera.correccion).toMatchObject({ estado: 'VALIDADA', crsOriginal: 'GMS_WGS84' });
    const p = posgarOficial();
    const segunda = S.ubicacionCorreccionService_proponer('carla@x.com', 'Carla', W, { clientRequestId: id(), metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: { x: p.x, y: p.y + 10 }, observacion: '' }, { autoValidar: true });
    expect(segunda.supersedidas).toEqual([primera.correccion.correccionId]);
    const lectura = S.ubicacionCorreccionService_getPorPozo('ana@x.com', W);
    expect(lectura.vigente).toMatchObject({ metodo: 'COORDENADAS_POSGAR94_AR2', crsOriginal: 'EPSG:22182' });
    expect(lectura.historial.map((c) => c.estado).sort()).toEqual(['SUPERADA', 'VALIDADA']);
  });
});

describe('idempotencia con el valor original', () => {
  test('el mismo reenvio (mismo clientRequestId y mismo original) devuelve la misma correccion sin escribir otra fila', () => {
    const cid = id();
    const a = proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    const b = proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    expect(b).toMatchObject({ ok: true, duplicada: true });
    expect(b.correccion.correccionId).toBe(a.correccion.correccionId);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('el mismo reenvio escrito distinto (coma vs punto, minuscula) es la MISMA solicitud: el original canonico coincide', () => {
    const cid = id();
    proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    const otra = { lat: { g: '33', m: '20', s: '51,54', h: 's' }, lon: { g: '69', m: '8', s: '43,62', h: 'w' } };
    expect(proponerGms(otra, { clientRequestId: cid })).toMatchObject({ ok: true, duplicada: true });
    expect(correcciones()).toHaveLength(1);
  });

  test('mismo clientRequestId, mismo pozo, mismo metodo y MISMO punto WGS84 pero distinto original -> IDEMPOTENCY_CONFLICT', () => {
    const cid = id();
    const a = proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    // 51.5403" mueve el punto 0,008 cm: el mismo lat/lon de 6 decimales, pero otro dato original
    const b = proponerGms(gmsDe({ s: 51.5403 }), { clientRequestId: cid });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(correcciones()).toHaveLength(1);
  });

  test('mismo clientRequestId y mismo punto WGS84 pero otro metodo (mapa vs coordenadas) -> IDEMPOTENCY_CONFLICT', () => {
    const cid = id();
    expect(proponerMapa({ clientRequestId: cid, lat: OFICIAL.lat, lon: OFICIAL.lon }).ok).toBe(true);
    expect(proponerGms(GMS_OFICIAL, { clientRequestId: cid })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const cid2 = id();
    expect(proponerGms(GMS_OFICIAL, { clientRequestId: cid2 }).ok).toBe(true);
    expect(proponerMapa({ clientRequestId: cid2, lat: OFICIAL.lat, lon: OFICIAL.lon })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('mismo punto escrito en GMS y en POSGAR con el mismo clientRequestId son solicitudes distintas (CRS y original distintos)', () => {
    const cid = id();
    expect(proponerPosgar(posgarOficial(), { clientRequestId: cid }).ok).toBe(true);
    expect(proponerGms(GMS_OFICIAL, { clientRequestId: cid })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('clientRequestId distintos con el mismo original: son dos propuestas distintas (clientRequestId es la autoridad)', () => {
    proponerGms(GMS_OFICIAL);
    proponerGms(GMS_OFICIAL);
    expect(correcciones()).toHaveLength(2);
  });

  test('las propuestas historicas (GPS / mapa, original vacio) siguen siendo idempotentes', () => {
    const cid = id();
    const a = proponerMapa({ clientRequestId: cid });
    expect(proponerMapa({ clientRequestId: cid })).toMatchObject({ ok: true, duplicada: true });
    expect(proponerMapa({ clientRequestId: cid, lat: OFICIAL.lat + 0.001 })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(a.ok).toBe(true);
    expect(correcciones()).toHaveLength(1);
  });

  test('autocurado de una escritura parcial conserva el original (correccion sin evento, reintento con el mismo original)', () => {
    const cid = id();
    const a = proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    hojas.UbicacionCorreccionesLog.filas.splice(1);                // se perdio el evento PROPUESTA (corte entre las dos hojas)
    const b = proponerGms(GMS_OFICIAL, { clientRequestId: cid });
    expect(b).toMatchObject({ ok: true, duplicada: true, curada: true });
    expect(b.correccion.correccionId).toBe(a.correccion.correccionId);
    expect(b.correccion.coordenadaOriginalTexto).toBe(a.correccion.coordenadaOriginalTexto);
    expect(correcciones()).toHaveLength(1);
  });
});

describe('la vista devuelta incluye coordenadaOriginalTexto y crsOriginal', () => {
  test('en las tres lecturas (vigente, pendientes e historial) y vacios en las filas de GPS / mapa', () => {
    proponerGms();
    proponerMapa();
    const lectura = S.ubicacionCorreccionService_getPorPozo('lector@x.com', W);
    expect(lectura.historial).toHaveLength(2);
    const porMetodo = {};
    lectura.historial.forEach((c) => { porMetodo[c.metodo] = c; });
    expect(porMetodo.COORDENADAS_GMS).toMatchObject({ crsOriginal: 'GMS_WGS84', coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O' });
    expect(porMetodo.PUNTO_EN_MAPA).toMatchObject({ crsOriginal: '', coordenadaOriginalTexto: '' });
    lectura.pendientes.forEach((c) => {
      expect(typeof c.coordenadaOriginalTexto).toBe('string');
      expect(typeof c.crsOriginal).toBe('string');
    });
    expect(S.ubicacionCorreccionService_getPendientes('val@x.com').pendientes.every((c) => 'crsOriginal' in c)).toBe(true);
    expect(JSON.stringify(lectura)).not.toMatch(/@/);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Esquema V1 (18 columnas, la hoja de produccion de hoy) vs V2 (20)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('hoja de 18 columnas (V1) sin migrar: lectura tolerante y escritura segura', () => {
  const V1 = () => require('../src/UbicacionCorreccionRepository').UBICACION_CORRECCIONES_COLUMNAS_V1;
  beforeEach(() => instalar(V1()));

  test('se LEE sin errores (las dos columnas nuevas salen vacias) y el sistema de lectura no se rompe', () => {
    expect(proponerMapa().ok).toBe(true);
    const lectura = S.ubicacionCorreccionService_getPorPozo('lector@x.com', W);
    expect(lectura.pendientes).toHaveLength(1);
    expect(lectura.pendientes[0]).toMatchObject({ metodo: 'PUNTO_EN_MAPA', coordenadaOriginalTexto: '', crsOriginal: '' });
    expect(S.ubicacionCorreccionService_getPendientes('val@x.com').total).toBe(1);
    expect(Repo.ubicacionCorreccionRepository_esquemaCorreccionesV2()).toBe(false);
  });

  test('DECISION: GPS_ACTUAL y PUNTO_EN_MAPA se siguen ESCRIBIENDO en una hoja V1 (desplegar antes de migrar no rompe nada); la fila queda de 18 celdas', () => {
    const a = proponerMapa();
    const b = proponerGps();
    expect(a.ok && b.ok).toBe(true);
    correcciones().forEach((f) => expect(f).toHaveLength(18));
    expect(hojas.UbicacionCorrecciones.filas[0]).toHaveLength(18);
    expect(correcciones().map((f) => f[4])).toEqual(['PUNTO_EN_MAPA', 'GPS_ACTUAL']);
    const v = S.ubicacionCorreccionService_validar('val@x.com', 'Valeria', a.correccion.correccionId, '');
    expect(v.ok).toBe(true);
  });

  test('un metodo COORDENADAS_* exige V2: ESQUEMA_DESACTUALIZADO, sin escribir NADA y sin siquiera consultar el padron', () => {
    const r = proponerGms();
    expect(r).toMatchObject({ ok: false, code: 'ESQUEMA_DESACTUALIZADO' });
    expect(r.message).not.toMatch(/migrar/i);          // el mensaje es para la persona usuaria; la instruccion al administrador esta en el log / docs
    expect(proponerPosgar(posgarOficial())).toMatchObject({ ok: false, code: 'ESQUEMA_DESACTUALIZADO' });
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('un reintento de algo ya escrito sigue siendo idempotente en V1', () => {
    const cid = id();
    proponerMapa({ clientRequestId: cid });
    expect(proponerMapa({ clientRequestId: cid })).toMatchObject({ ok: true, duplicada: true });
    expect(correcciones()).toHaveLength(1);
  });

  test('defensa en el repositorio: aunque se llame directo, un valor de auditoria no vacio NUNCA se descarta en silencio por falta de columna', () => {
    const base = { correccionId: '11111111-1111-4111-8111-111111111111', wellId: W, lat: -33.1, lon: -69.1, metodo: 'COORDENADAS_GMS', emailPropone: 'a@x.com', timestamp: new Date() };
    expect(() => Repo.ubicacionCorreccionRepository_agregarCorreccion(Object.assign({ coordenadaOriginalTexto: '33° 0\' 0" S, 69° 0\' 0" O', crsOriginal: 'GMS_WGS84' }, base)))
      .toThrow(/coordenadaOriginalTexto/);
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(1);
    expect(() => Repo.ubicacionCorreccionRepository_agregarCorreccion(Object.assign({ coordenadaOriginalTexto: '', crsOriginal: '' }, base))).not.toThrow();
    expect(hojas.UbicacionCorrecciones.filas).toHaveLength(2);
  });

  test('si falta una columna BASE sigue siendo fail-closed (no se lee ni se escribe)', () => {
    instalar(V1().filter((c) => c !== 'clientRequestId'));
    expect(() => S.ubicacionCorreccionService_getPorPozo('x@x.com', W)).toThrow(/clientRequestId/);
    expect(() => proponerMapa()).toThrow(/clientRequestId/);
  });
});

describe('migrarUbicacionCorreccionesV2', () => {
  const V1 = () => require('../src/UbicacionCorreccionRepository').UBICACION_CORRECCIONES_COLUMNAS_V1;
  const espiarEscrituras = (hoja) => {
    const escrituras = [];
    const getRangeOriginal = hoja.getRange.bind(hoja);
    hoja.getRange = (...args) => {
      const rango = getRangeOriginal(...args);
      const setValues = rango.setValues.bind(rango);
      rango.setValues = (vals) => { escrituras.push({ args, vals: copia(vals) }); return setValues(vals); };
      return rango;
    };
    return escrituras;
  };

  // Una hoja V1 REAL: filas escritas por el propio servicio (GPS, mapa, validada, rechazada, superada) para no inventar el formato.
  function hojaV1ConDatos() {
    instalar(V1());
    const a = proponerMapa({ observacion: '=SUM(1) formula como texto' });
    const b = proponerGps({ observacion: 'con GPS' });
    const c = proponerMapa({ lat: OFICIAL.lat + 0.0004 });
    S.ubicacionCorreccionService_validar('val@x.com', 'Valeria', a.correccion.correccionId, 'ok');
    S.ubicacionCorreccionService_rechazar('val@x.com', 'Valeria', b.correccion.correccionId, 'no coincide');
    S.ubicacionCorreccionService_validar('val@x.com', 'Valeria', c.correccion.correccionId, 'mejor');       // supera a la de a
    return { a, b, c };
  }
  const lecturaCompleta = () => ({
    pozo: S.ubicacionCorreccionService_getPorPozo('lector@x.com', W),
    pendientes: S.ubicacionCorreccionService_getPendientes('val@x.com')
  });

  test('SIMULACION COMPLETA: hoja de 18 columnas -> migrar -> filas viejas intactas y legibles -> fila nueva -> migrar de nuevo -> nada cambia', () => {
    const { a, b, c } = hojaV1ConDatos();
    expect(hojas.UbicacionCorrecciones.filas[0]).toHaveLength(18);
    const antesCorr = copia(hojas.UbicacionCorrecciones.filas);
    const antesLog = copia(hojas.UbicacionCorreccionesLog.filas);
    const antesFormatos = copia(hojas.UbicacionCorrecciones.formatos);
    const antesFormatosLog = copia(hojas.UbicacionCorreccionesLog.formatos);
    const lecturaAntes = copia(lecturaCompleta());
    expect(lecturaAntes.pozo.historial.map((x) => x.estado).sort()).toEqual(['RECHAZADA', 'SUPERADA', 'VALIDADA']);
    const escrituras = espiarEscrituras(hojas.UbicacionCorrecciones);

    // 1) migracion
    const r1 = Repo.migrarUbicacionCorreccionesV2();
    expect(r1).toEqual({ migrada: true, agregadas: ['coordenadaOriginalTexto', 'crsOriginal'], columnaInicial: 19, columnasInsertadas: 0 });
    expect(escrituras).toHaveLength(1);
    expect(escrituras[0].args).toEqual([1, 19, 1, 2]);                    // SOLO la fila 1, columnas 19 y 20
    expect(escrituras[0].vals).toEqual([['coordenadaOriginalTexto', 'crsOriginal']]);
    expect(hojas.UbicacionCorrecciones.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(hojas.UbicacionCorrecciones.filas[0].slice(0, 18)).toEqual(antesCorr[0]);   // las 18 de antes, en su lugar
    // ningun dato existente se modifico: todas las filas de datos identicas, formatos identicos, el log intacto
    expect(hojas.UbicacionCorrecciones.filas.slice(1)).toEqual(antesCorr.slice(1));
    expect(hojas.UbicacionCorreccionesLog.filas).toEqual(antesLog);
    expect(hojas.UbicacionCorrecciones.formatos).toEqual(antesFormatos);
    expect(hojas.UbicacionCorreccionesLog.formatos).toEqual(antesFormatosLog);

    // 2) las filas viejas se leen igual que antes (mismas vistas, mismo estado)
    expect(lecturaCompleta()).toEqual(lecturaAntes);
    expect(Repo.ubicacionCorreccionRepository_esquemaCorreccionesV2()).toBe(true);
    [a, b, c].forEach((x) => expect(S.ubicacionCorreccionService_getPorPozo('lector@x.com', W).historial.some((h) => h.correccionId === x.correccion.correccionId)).toBe(true));

    // 3) ahora si se puede crear una fila nueva por coordenadas; las viejas siguen igual
    const nueva = proponerGms(GMS_OFICIAL, { observacion: 'ya migrada' });
    expect(nueva.ok).toBe(true);
    expect(hojas.UbicacionCorrecciones.filas.slice(1, 4)).toEqual(antesCorr.slice(1));
    expect(hojas.UbicacionCorrecciones.filas[4]).toHaveLength(20);
    expect(campo(hojas.UbicacionCorrecciones.filas[4], 'crsOriginal')).toBe('GMS_WGS84');
    const despuesDeNueva = copia(hojas.UbicacionCorrecciones.filas);

    // 4) segunda ejecucion: idempotente, NO escribe nada
    escrituras.length = 0;
    const r2 = Repo.migrarUbicacionCorreccionesV2();
    expect(r2).toEqual({ migrada: false, agregadas: [], columnaInicial: null, columnasInsertadas: 0 });
    expect(escrituras).toHaveLength(0);
    expect(hojas.UbicacionCorrecciones.filas).toEqual(despuesDeNueva);
    expect(hojas.UbicacionCorrecciones.filas[0]).toHaveLength(20);
    expect(logs.some((l) => /ya tiene el esquema V2/.test(l))).toBe(true);
    expect(logs.some((l) => /migrada a V2/.test(l))).toBe(true);
  });

  test('con filas "rectangulares" como las devuelve Sheets de verdad (celdas vacias a la derecha) tambien se leen y la migracion no las toca', () => {
    hojaV1ConDatos();
    const antes = copia(hojas.UbicacionCorrecciones.filas.slice(1));
    const lecturaAntes = copia(lecturaCompleta());
    Repo.migrarUbicacionCorreccionesV2();
    hojas.UbicacionCorrecciones.filas.forEach((f) => { while (f.length < 20) { f.push(''); } });     // Sheets rellena con ''
    expect(lecturaCompleta()).toEqual(lecturaAntes);
    expect(hojas.UbicacionCorrecciones.filas.slice(1).map((f) => f.slice(0, 18))).toEqual(antes.map((f) => f.slice(0, 18)));
  });

  test('migra aunque el encabezado tenga mayusculas, espacios o un orden distinto, sin reordenar nada', () => {
    const header = V1().slice().reverse().map((h, i) => (i % 2 ? ' ' + h.toUpperCase() + ' ' : h));
    instalar(header);
    hojas.UbicacionCorrecciones.filas.push(header.map((_h, i) => 'dato' + i));
    const antes = copia(hojas.UbicacionCorrecciones.filas);
    expect(Repo.migrarUbicacionCorreccionesV2().migrada).toBe(true);
    expect(hojas.UbicacionCorrecciones.filas[0].slice(0, 18)).toEqual(antes[0]);
    expect(hojas.UbicacionCorrecciones.filas[0].slice(18)).toEqual(['coordenadaOriginalTexto', 'crsOriginal']);
    expect(hojas.UbicacionCorrecciones.filas[1]).toEqual(antes[1]);
  });

  test('migracion PARCIAL (ya existe una de las dos columnas): agrega solo la que falta, sin duplicar', () => {
    instalar(V1().concat(['coordenadaOriginalTexto']));
    expect(Repo.ubicacionCorreccionRepository_esquemaCorreccionesV2()).toBe(false);
    const r = Repo.migrarUbicacionCorreccionesV2();
    expect(r).toEqual({ migrada: true, agregadas: ['crsOriginal'], columnaInicial: 20, columnasInsertadas: 0 });
    expect(hojas.UbicacionCorrecciones.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(Repo.migrarUbicacionCorreccionesV2().migrada).toBe(false);
  });

  test('una hoja que YA es V2 (creada por setup) no se toca', () => {
    instalar();
    const escrituras = espiarEscrituras(hojas.UbicacionCorrecciones);
    expect(Repo.migrarUbicacionCorreccionesV2()).toEqual({ migrada: false, agregadas: [], columnaInicial: null, columnasInsertadas: 0 });
    expect(escrituras).toHaveLength(0);
    expect(hojas.UbicacionCorrecciones.filas).toEqual([Repo.UBICACION_CORRECCIONES_COLUMNAS]);
  });

  test('FAIL-CLOSED: sin la hoja, sin encabezado, sin una columna BASE o con contenido a la derecha del encabezado -> error y NO se escribe', () => {
    instalar();
    delete hojas.UbicacionCorrecciones;
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/setupUbicacionCorreccionesSheets/);

    instalar(V1());
    hojas.UbicacionCorrecciones.filas.splice(0);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/no tiene encabezado/);

    instalar(V1().filter((c) => c !== 'metodo'));
    const antes = copia(hojas.UbicacionCorrecciones.filas);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/columnas base: metodo/);
    expect(hojas.UbicacionCorrecciones.filas).toEqual(antes);

    instalar(V1());
    hojas.UbicacionCorrecciones.filas.push(new Array(25).fill('x'));              // contenido en columnas 19..25 bajo un encabezado de 18
    const antes2 = copia(hojas.UbicacionCorrecciones.filas);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/contenido a la derecha/);
    expect(hojas.UbicacionCorrecciones.filas).toEqual(antes2);
  });

  test('corre bajo el MISMO lock que las escrituras y lo libera siempre (tambien si falla)', () => {
    instalar(V1());
    const c = { waits: 0, releases: 0 };
    global.LockService = { getScriptLock: () => ({ waitLock: () => { c.waits += 1; }, releaseLock: () => { c.releases += 1; } }) };
    Repo.migrarUbicacionCorreccionesV2();
    expect(c).toEqual({ waits: 1, releases: 1 });
    delete hojas.UbicacionCorrecciones;
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow();
    expect(c).toEqual({ waits: 2, releases: 2 });
  });

  test('no toca la hoja del Log ni ninguna otra hoja', () => {
    hojaV1ConDatos();
    hojas.Usuarios = require('./fakeSheets').crearHoja('Usuarios', [['email', 'estado'], ['a@x.com', 'activo']]);
    const usuarios = copia(hojas.Usuarios.filas);
    const log = copia(hojas.UbicacionCorreccionesLog.filas);
    Repo.migrarUbicacionCorreccionesV2();
    expect(hojas.Usuarios.filas).toEqual(usuarios);
    expect(hojas.UbicacionCorreccionesLog.filas).toEqual(log);
  });

  test('planMigracionV2 (logica pura): casos', () => {
    const plan = Repo.ubicacionCorreccionRepository_planMigracionV2;
    expect(plan(V1(), 18)).toEqual({ ok: true, faltantes: ['coordenadaOriginalTexto', 'crsOriginal'], columnaInicial: 19 });
    expect(plan(Repo.UBICACION_CORRECCIONES_COLUMNAS, 20)).toEqual({ ok: true, faltantes: [], columnaInicial: 21 });
    expect(plan(V1().concat(['', '']), 18)).toEqual({ ok: true, faltantes: ['coordenadaOriginalTexto', 'crsOriginal'], columnaInicial: 19 });
    expect(plan(V1(), 22).ok).toBe(false);
    expect(plan(['correccionId'], 1).ok).toBe(false);
    expect(plan(null, 0).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Migracion y GRILLA FISICA: no es lo mismo cuantas columnas tiene la hoja (getMaxColumns) que cuantos encabezados hay o que haya contenido inesperado.
// La grilla se modela estricta (hoja.estricta = true): leer o escribir fuera de ella lanza, asi que si la migracion no agrandara la grilla ANTES de escribir, fallaria.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
const lecturaMigracion = () => ({
  pozo: S.ubicacionCorreccionService_getPorPozo('lector@x.com', W),
  pendientes: S.ubicacionCorreccionService_getPendientes('val@x.com')
});

describe('migrarUbicacionCorreccionesV2: capacidad fisica de la grilla vs encabezados vs contenido inesperado', () => {
  const V1 = () => require('../src/UbicacionCorreccionRepository').UBICACION_CORRECCIONES_COLUMNAS_V1;
  // hoja V1 con filas de datos, N columnas FISICAS y operaciones registradas (en orden) para verificar que la grilla se agranda ANTES de escribir los encabezados
  function hojaV1(columnasFisicas, opciones) {
    instalar(V1());
    const h = hojas.UbicacionCorrecciones;
    h.filas.push(V1().map((c, i) => (c === 'timestamp' ? new Date('2026-10-09T12:00:00Z') : c === 'lat' ? -33.1 : c === 'lon' ? -69.1 : 'dato' + i)));
    h.filas.push(V1().map((c, i) => (c === 'timestamp' ? new Date('2026-10-10T08:30:00Z') : c === 'advertenciaDistancia' ? '' : 'otro' + i)));
    h.columnasFisicas = columnasFisicas;
    h.estricta = true;
    if (opciones && opciones.encabezados) { h.filas[0] = opciones.encabezados; }
    const ops = [];
    const insert = h.insertColumnsAfter.bind(h);
    h.insertColumnsAfter = (pos, n) => { ops.push(['insertColumnsAfter', pos, n]); return insert(pos, n); };
    const getRange = h.getRange.bind(h);
    h.getRange = (...args) => {
      const rango = getRange(...args);
      const setValues = rango.setValues.bind(rango);
      rango.setValues = (vals) => { ops.push(['setValues', args, copia(vals)]); return setValues(vals); };
      return rango;
    };
    return { h, ops, datos: copia(h.filas.slice(1)) };
  }

  test('el fake modela la grilla fisica: escribir en la columna 19 de una hoja estricta de 18 columnas LANZA (sin insertColumnsAfter no se puede)', () => {
    const { h } = hojaV1(18);
    expect(h.getMaxColumns()).toBe(18);
    expect(h.getLastColumn()).toBe(18);
    expect(() => h.getRange(1, 19, 1, 2).setValues([['a', 'b']])).toThrow(/invalid/);
    h.insertColumnsAfter(18, 2);
    expect(h.getMaxColumns()).toBe(20);
    expect(() => h.getRange(1, 19, 1, 2).setValues([['a', 'b']])).not.toThrow();
  });

  test('A. hoja con EXACTAMENTE 18 columnas fisicas: la expande a 20 (solo las 2 necesarias, al final) y DESPUES escribe los encabezados 19 y 20; los datos no se tocan', () => {
    const { h, ops, datos } = hojaV1(18);
    const r = Repo.migrarUbicacionCorreccionesV2();
    expect(r).toEqual({ migrada: true, agregadas: ['coordenadaOriginalTexto', 'crsOriginal'], columnaInicial: 19, columnasInsertadas: 2 });
    expect(ops.map((o) => o[0])).toEqual(['insertColumnsAfter', 'setValues']);                  // primero la grilla, despues los encabezados
    expect(ops[0]).toEqual(['insertColumnsAfter', 18, 2]);
    expect(ops[1][1]).toEqual([1, 19, 1, 2]);
    expect(ops[1][2]).toEqual([['coordenadaOriginalTexto', 'crsOriginal']]);
    expect(h.getMaxColumns()).toBe(20);
    expect(h.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);                           // encabezado exacto del esquema V2
    expect(h.filas[0].slice(0, 18)).toEqual(V1());                                              // las 18 de antes, mismo orden
    expect(h.filas.slice(1)).toEqual(datos);                                                    // ni una celda de datos cambio (ni se agregaron celdas)
    expect(logs.some((l) => /18 columnas fisicas: se agregaron 2 al final/.test(l))).toBe(true);
  });

  test('A. despues de expandir, la hoja funciona: se lee igual y se puede escribir una correccion por coordenadas', () => {
    hojaV1(18);
    const antes = copia(lecturaMigracion());
    Repo.migrarUbicacionCorreccionesV2();
    expect(lecturaMigracion()).toEqual(antes);
    expect(Repo.ubicacionCorreccionRepository_esquemaCorreccionesV2()).toBe(true);
    expect(proponerGms().ok).toBe(true);
    const fila = correcciones().pop();
    expect(fila).toHaveLength(20);
    expect(campo(fila, 'crsOriginal')).toBe('GMS_WGS84');
  });

  test('D. (sobre A) una segunda ejecucion es idempotente: ni agranda la grilla ni escribe nada', () => {
    const { h, ops } = hojaV1(18);
    Repo.migrarUbicacionCorreccionesV2();
    const despues = copia(h.filas);
    ops.length = 0;
    expect(Repo.migrarUbicacionCorreccionesV2()).toEqual({ migrada: false, agregadas: [], columnaInicial: null, columnasInsertadas: 0 });
    expect(ops).toEqual([]);
    expect(h.getMaxColumns()).toBe(20);
    expect(h.filas).toEqual(despues);
  });

  test('A. hoja de 19 columnas fisicas (una menos de las que hacen falta): agrega UNA sola columna', () => {
    const { h, ops, datos } = hojaV1(19);
    const r = Repo.migrarUbicacionCorreccionesV2();
    expect(r.columnasInsertadas).toBe(1);
    expect(ops[0]).toEqual(['insertColumnsAfter', 19, 1]);
    expect(h.getMaxColumns()).toBe(20);
    expect(h.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(h.filas.slice(1)).toEqual(datos);
  });

  test('A. migracion PARCIAL con la grilla justa (19 encabezados en 19 columnas): agrega solo la columna 20 y solo el encabezado que falta', () => {
    const { h, ops, datos } = hojaV1(19, { encabezados: V1().concat(['coordenadaOriginalTexto']) });
    const r = Repo.migrarUbicacionCorreccionesV2();
    expect(r).toEqual({ migrada: true, agregadas: ['crsOriginal'], columnaInicial: 20, columnasInsertadas: 1 });
    expect(ops[0]).toEqual(['insertColumnsAfter', 19, 1]);
    expect(ops[1][1]).toEqual([1, 20, 1, 1]);
    expect(h.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(h.filas.slice(1)).toEqual(datos);
  });

  test('B. hoja con 26 columnas fisicas y solo 18 encabezados: NO toca la grilla, solo escribe los 2 encabezados', () => {
    const { h, ops, datos } = hojaV1(26);
    const r = Repo.migrarUbicacionCorreccionesV2();
    expect(r).toEqual({ migrada: true, agregadas: ['coordenadaOriginalTexto', 'crsOriginal'], columnaInicial: 19, columnasInsertadas: 0 });
    expect(ops.map((o) => o[0])).toEqual(['setValues']);                                        // sin insertColumnsAfter
    expect(ops[0][1]).toEqual([1, 19, 1, 2]);
    expect(h.getMaxColumns()).toBe(26);
    expect(h.filas[0]).toEqual(Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(h.filas.slice(1)).toEqual(datos);
    ops.length = 0;
    expect(Repo.migrarUbicacionCorreccionesV2().migrada).toBe(false);                           // y repetirla tampoco hace nada
    expect(ops).toEqual([]);
  });

  test('C. hoja YA migrada con 20 columnas (fisicas y de encabezado): no hace nada', () => {
    instalar();
    const h = hojas.UbicacionCorrecciones;
    h.columnasFisicas = 20;
    h.estricta = true;
    const insert = jest.spyOn(h, 'insertColumnsAfter');
    const escribe = jest.fn();
    const getRange = h.getRange.bind(h);
    h.getRange = (...args) => { const r = getRange(...args); const sv = r.setValues.bind(r); r.setValues = (v) => { escribe(); return sv(v); }; return r; };
    const antes = copia(h.filas);
    expect(Repo.migrarUbicacionCorreccionesV2()).toEqual({ migrada: false, agregadas: [], columnaInicial: null, columnasInsertadas: 0 });
    expect(insert).not.toHaveBeenCalled();
    expect(escribe).not.toHaveBeenCalled();
    expect(h.filas).toEqual(antes);
    expect(h.getMaxColumns()).toBe(20);
  });

  test('E. contenido inesperado a la DERECHA del encabezado: se niega ANTES de tocar nada (ni agranda la grilla ni escribe), con la grilla justa o con sobra', () => {
    [18, 19, 26].forEach((fisicas) => {
      const { h, ops } = hojaV1(fisicas);
      h.columnasFisicas = Math.max(fisicas, 25);
      h.filas.push(new Array(25).fill('x'));                                                    // celdas con datos en las columnas 19..25 bajo un encabezado de 18
      const antes = copia(h.filas);
      expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/contenido a la derecha/);
      expect(ops).toEqual([]);
      expect(h.filas).toEqual(antes);
    });
    const { h, ops } = hojaV1(26);
    h.filas[1][18] = 'dato suelto en la columna 19';                                            // una sola celda ajena en la columna que usaria la migracion
    const antes = copia(h.filas);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/contenido a la derecha/);
    expect(ops).toEqual([]);
    expect(h.filas).toEqual(antes);
  });

  test('F. columnas BASE faltantes: se niega sin tocar nada (tampoco agranda la grilla)', () => {
    const base = V1().filter((c) => c !== 'wellId');
    const { h, ops } = hojaV1(17, { encabezados: base });
    h.filas.splice(1);
    const antes = copia(h.filas);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/columnas base: wellId/);
    expect(ops).toEqual([]);
    expect(h.filas).toEqual(antes);
    expect(h.getMaxColumns()).toBe(17);
  });

  test('F. hoja inexistente, sin encabezado o con el encabezado de otra cosa: error y ninguna operacion de grilla', () => {
    instalar();
    delete hojas.UbicacionCorrecciones;
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/setupUbicacionCorreccionesSheets/);
    const sin = hojaV1(18);
    sin.h.filas.splice(0);
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/no tiene encabezado/);
    const otra = hojaV1(18, { encabezados: ['lo', 'que', 'sea'] });
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/columnas base/);
    expect(sin.ops).toEqual([]);
    expect(otra.ops).toEqual([]);
  });

  test('si insertColumnsAfter falla (p. ej. limite de celdas de Sheets), NO se escribe ningun encabezado y el error se propaga; el lock se libera', () => {
    const { h, ops, datos } = hojaV1(18);
    h.insertColumnsAfter = () => { throw new Error('This action would increase the number of cells in the workbook above the limit of 10000000 cells.'); };
    const c = { waits: 0, releases: 0 };
    global.LockService = { getScriptLock: () => ({ waitLock: () => { c.waits += 1; }, releaseLock: () => { c.releases += 1; } }) };
    expect(() => Repo.migrarUbicacionCorreccionesV2()).toThrow(/limit of 10000000 cells/);
    expect(ops).toEqual([]);                                                                    // ningun setValues
    expect(h.filas[0]).toEqual(V1());
    expect(h.filas.slice(1)).toEqual(datos);
    expect(c).toEqual({ waits: 1, releases: 1 });
  });

  test('con datos reales escritos por el servicio en una hoja de 18 fisicas: la migracion no cambia ni la lectura del sistema, ni las filas, ni el Log', () => {
    instalar(V1());
    hojas.UbicacionCorrecciones.columnasFisicas = 18;
    const a = proponerMapa({ observacion: 'uno' });
    const b = proponerGps({ observacion: 'dos' });
    S.ubicacionCorreccionService_validar('val@x.com', 'Valeria', a.correccion.correccionId, 'ok');
    const lecturaAntes = copia(lecturaMigracion());
    const filasAntes = copia(hojas.UbicacionCorrecciones.filas.slice(1));
    const logAntes = copia(hojas.UbicacionCorreccionesLog.filas);
    hojas.UbicacionCorrecciones.estricta = true;
    Repo.migrarUbicacionCorreccionesV2();
    expect(hojas.UbicacionCorrecciones.getMaxColumns()).toBe(20);
    expect(hojas.UbicacionCorrecciones.filas.slice(1)).toEqual(filasAntes);
    expect(hojas.UbicacionCorreccionesLog.filas).toEqual(logAntes);
    expect(lecturaMigracion()).toEqual(lecturaAntes);
    expect(b.ok).toBe(true);
  });
});

describe('setupUbicacionCorreccionesSheets crea el esquema nuevo', () => {
  test('hoja nueva con las 20 columnas (las dos nuevas al final, igual que una migrada), fila 1 congelada', () => {
    instalar();
    hojas = instalarSheetsFalsos({});
    Repo.setupUbicacionCorreccionesSheets();
    expect(hojas.UbicacionCorrecciones.filas).toEqual([Repo.UBICACION_CORRECCIONES_COLUMNAS]);
    expect(hojas.UbicacionCorrecciones.filas[0]).toHaveLength(20);
    expect(hojas.UbicacionCorrecciones.filas[0].slice(18)).toEqual(['coordenadaOriginalTexto', 'crsOriginal']);
    expect(hojas.UbicacionCorrecciones.congeladas).toBe(1);
    expect(Repo.ubicacionCorreccionRepository_esquemaCorreccionesV2()).toBe(true);
    // y una hoja nueva funciona de punta a punta con un metodo nuevo
    global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: { ubicacionResuelta: OFICIAL } }));
    expect(proponerGms().ok).toBe(true);
  });

  test('una hoja V1 existente NO se modifica; avisa en el log que falta migrar', () => {
    instalar(require('../src/UbicacionCorreccionRepository').UBICACION_CORRECCIONES_COLUMNAS_V1);
    const antes = copia(hojas.UbicacionCorrecciones.filas);
    Repo.setupUbicacionCorreccionesSheets();
    expect(hojas.UbicacionCorrecciones.filas).toEqual(antes);
    expect(logs.some((l) => /migrarUbicacionCorreccionesV2/.test(l))).toBe(true);
  });

  test('correrlo dos veces no cambia nada', () => {
    instalar();
    hojas = instalarSheetsFalsos({});
    Repo.setupUbicacionCorreccionesSheets();
    const una = copia(hojas.UbicacionCorrecciones.filas);
    Repo.setupUbicacionCorreccionesSheets();
    expect(hojas.UbicacionCorrecciones.filas).toEqual(una);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Email a validadores con un metodo nuevo
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('email a validadores: etiquetas y valor original', () => {
  let correos;
  beforeEach(() => {
    correos = [];
    global.Utilities.formatDate = jest.fn(() => '13/10/2026 09:30');
    global.MailApp = { sendEmail: jest.fn((m) => { correos.push(m); }), getRemainingDailyQuota: jest.fn(() => 100) };
    global.getPwaUrl = jest.fn(() => 'https://ejemplo.github.io/dgi-pozos-pwa/');
    global.sheetUserRepository_listarConPermisos = jest.fn(() => [{ email: 'valeria@x.com', nombre: 'Valeria' }]);
  });

  const vista = (extra) => Object.assign({
    correccionId: '11111111-1111-4111-8111-111111111111', wellId: W, lat: -33.34765, lon: -69.14545, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '',
    nombrePropone: 'Ana Pérez', timestamp: '2026-10-13T12:30:00.000Z', distanciaM: 22.2, advertenciaDistancia: false, estado: 'PROPUESTA', propia: false,
    coordenadaOriginalTexto: '', crsOriginal: ''
  }, extra || {});

  test('GMS: metodo legible + valor original canonico; sin payload crudo ni lat/lon WGS84', () => {
    const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'COORDENADAS_GMS', crsOriginal: 'GMS_WGS84', coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O' }), '');
    expect(m.cuerpo).toContain('Método: Coordenadas GMS / WGS84');
    expect(m.cuerpo).toContain('Sistema: GMS / WGS84');
    expect(m.cuerpo).toContain('Valor ingresado: 33° 20\' 51.54" S, 69° 8\' 43.62" O');
    expect(m.cuerpo).not.toMatch(/-33\.34765|-69\.14545/);
    expect(m.cuerpo).not.toMatch(/coordenadaOriginal|crsOriginal|GMS_WGS84|\{|\}/);
  });

  test('POSGAR: metodo legible con el CRS + valor original canonico', () => {
    const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'COORDENADAS_POSGAR94_AR2', crsOriginal: 'EPSG:22182', coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00' }), '');
    expect(m.cuerpo).toContain('Método: Coordenadas POSGAR 94 / Argentina 2');
    expect(m.cuerpo).toContain('Sistema: POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(m.cuerpo).toContain('Valor ingresado: X(Este)=2500000.00, Y(Norte)=6350000.00');
  });

  test('GPS y mapa quedan EXACTAMENTE como antes (sin linea de valor ingresado), aunque la vista traiga basura en el campo nuevo', () => {
    const gps = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'GPS_ACTUAL', precisionGpsM: 8.4 }), '');
    expect(gps.cuerpo).toContain('Método: GPS (± 8,4 m)');
    expect(gps.cuerpo).not.toContain('Valor ingresado');
    expect(gps.cuerpo).not.toContain('Sistema:');
    const mapa = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ coordenadaOriginalTexto: 'texto que no corresponde' }), '');
    expect(mapa.cuerpo).toContain('Método: Elegida en mapa');
    expect(mapa.cuerpo).not.toContain('Valor ingresado');
    expect(mapa.cuerpo).not.toContain('Sistema:');
    expect(mapa.cuerpo).not.toContain('texto que no corresponde');
  });

  test('un metodo nuevo sin texto (fila rara) no inventa la linea; un texto con saltos de linea no puede fabricar lineas falsas', () => {
    expect(N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'COORDENADAS_GMS' }), '').cuerpo).not.toContain('Valor ingresado');
    const m = N.ubicacionCorreccionNotificacion_armarMensaje(vista({ metodo: 'COORDENADAS_GMS', coordenadaOriginalTexto: '33° S\nPropuesta por: Presidente\r\nATENCIÓN: validala ya' }), '');
    const lineas = m.cuerpo.split('\n');
    expect(lineas.filter((l) => l.startsWith('Propuesta por:'))).toHaveLength(1);
    expect(lineas.filter((l) => l.startsWith('ATENCIÓN'))).toHaveLength(0);
    expect(lineas.filter((l) => l.startsWith('Valor ingresado:'))).toHaveLength(1);
  });

  test('de punta a punta: una propuesta por coordenadas llega al validador con el valor original; una validada directa no manda nada', () => {
    const r = proponerGms();
    expect(r.ok).toBe(true);
    const aviso = N.ubicacionCorreccionNotificacion_notificarPendiente('ana@x.com', r.correccion);
    expect(aviso.resultado).toBe('ENVIADO');
    expect(correos).toHaveLength(1);
    expect(correos[0].to).toBe('valeria@x.com');
    expect(correos[0].body).toContain('Valor ingresado: 33° 20\' 51.54" S, 69° 8\' 43.62" O');
    expect(correos[0].body).toContain('Método: Coordenadas GMS / WGS84');
    expect(correos[0].body).toContain('Sistema: GMS / WGS84');
    const directa = S.ubicacionCorreccionService_proponer('carla@x.com', 'Carla', W, { clientRequestId: id(), metodo: 'COORDENADAS_GMS', coordenadaOriginal: GMS_OFICIAL, observacion: '' }, { autoValidar: true });
    expect(N.ubicacionCorreccionNotificacion_notificarPendiente('carla@x.com', directa.correccion).resultado).toBe('NO_APLICA');
    expect(correos).toHaveLength(1);
  });
});
