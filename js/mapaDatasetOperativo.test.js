// ETAPA 3 (capa de CAMPO): el punto operativo en el dataset del mapa. mapaDataset_obtener = dataset base (pozos.json, intacto) + getUbicacionesValidadas + la composicion pura
// (aplicarCapas, con la capa registral AUSENTE en este archivo: la cubre js/mapaDatasetCapas.test.js); el mapa,
// Cerca Mio, la seleccion y Buscar reemplazo lo heredan sin reglas propias. Cubre: casos reales (01-0012, 14-0001), pozos nuevos, fallback si el endpoint falla,
// cache de 60 s e invalidacion, estados D / C / V, Cerca Mio, seleccion, reemplazos, etiquetas visibles, cableado (index.html, sw, css) y rendimiento.
const fs = require('fs');
const path = require('path');
const BackendCorr = require('../backend/src/UbicacionCorreccionService');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const OP = require('./ubicacionOperativaLogic');
const Cerca = require('./cercaMioLogic');
const Sel = require('./seleccionLogic');
const MapaLogic = require('./mapaLogic');
Object.assign(global, Cerca);
const Reemp = require('./buscarReemplazoLogic');

let mapaDataset;

// Dataset base tal como lo entrega getMapaPozos (campos del sanitizador)
const pozo = (wellId, lat, lon, estado, extra) => Object.assign({ wellId, lat, lon, estado: estado || 'D', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo' }, extra || {});

// Casos REALES de produccion (medidos): 01-0012 (PUNTO_EN_MAPA a 22,2 m de Irrigacion) y 14-0001 (GMS a 0,0 m, con una anterior SUPERADA).
const IRR_12 = { lat: -32.8925, lon: -68.8455 };
const VAL_12 = { lat: IRR_12.lat + 0.0002, lon: IRR_12.lon };                      // a ~22,2 m
const IRR_14 = { lat: -33.34765, lon: -69.14545 };                                 // la validada GMS cae EXACTAMENTE en la base (0,0 m)

function baseDataset() {
  return [pozo('01-0012', IRR_12.lat, IRR_12.lon, 'D'), pozo('01-0013', -32.8930, -68.8460, 'C'), pozo('14-0001', IRR_14.lat, IRR_14.lon, 'C'), pozo('14-0002', -33.3480, -69.1460, 'D')];
}

// cadenas de correcciones reales (con su log) -> lo que entregaria getUbicacionesValidadas (backend real, funciones puras)
const T = (d, h) => '2026-10-' + String(d).padStart(2, '0') + 'T' + String(h || 10).padStart(2, '0') + ':00:00.000Z';
function cadena(id, wellId, lat, lon, tsProp, eventos, metodo) {
  return {
    c: { correccionId: id, wellId, lat, lon, metodo: metodo || 'PUNTO_EN_MAPA', timestamp: tsProp, emailPropone: 'ana@x.com', nombrePropone: 'Ana', observacion: 'obs privada' },
    e: eventos.map(([ev, ts]) => ({ correccionId: id, evento: ev, timestamp: ts, email: 'v@x.com', nombre: 'Val', motivo: 'motivo privado' }))
  };
}
function deltasReales() {
  const cadenas = [
    cadena('00000000-0000-4000-8000-00000000000a', '01-0012', VAL_12.lat, VAL_12.lon, T(12), [['PROPUESTA', T(12)], ['VALIDADA', T(12, 11)]]),
    // 14-0001: una anterior PROPUESTA -> VALIDADA -> SUPERADA y la nueva (GMS) PROPUESTA -> VALIDADA
    cadena('00000000-0000-4000-8000-00000000000b', '14-0001', -33.3470, -69.1450, T(10), [['PROPUESTA', T(10)], ['VALIDADA', T(10, 11)], ['SUPERADA', T(13, 9)]]),
    cadena('00000000-0000-4000-8000-00000000000c', '14-0001', IRR_14.lat, IRR_14.lon, T(13), [['PROPUESTA', T(13)], ['VALIDADA', T(13, 9)]], 'COORDENADAS_GMS')
  ];
  const derivadas = BackendCorr.ubicacionCorreccionService_derivar(cadenas.map((x) => x.c), [].concat(...cadenas.map((x) => x.e)));
  return BackendCorr.ubicacionCorreccionService_ubicacionesValidadas(derivadas);
}

let reloj;
function instalar(opciones) {
  const o = opciones || {};
  jest.resetModules();
  global.apiGetMapaPozos = jest.fn(() => (o.base ? o.base() : Promise.resolve({ status: 'ok', data: { pozos: baseDataset(), metadata: { totalPuntos: 4 } } })));
  global.apiGetUbicacionesValidadas = jest.fn(() => (o.deltas ? o.deltas() : Promise.resolve({ status: 'ok', data: { ubicaciones: deltasReales() } })));
  delete global.apiGetDecisionesFuentesDelta;                  // la capa registral no existe en estas pruebas: se comporta exactamente como antes de E3-3
  if (o.sinOverlay) {
    delete global.ubicacionOperativaLogic_aplicarCapas;
  } else {
    global.ubicacionOperativaLogic_aplicarCapas = OP.ubicacionOperativaLogic_aplicarCapas;
  }
  reloj = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => reloj);
  mapaDataset = require('./mapaDataset');
}
afterEach(() => { jest.restoreAllMocks(); });
beforeEach(() => instalar());

const porId = (r, w) => r.data.pozos.find((p) => p.wellId === w);

describe('casos REALES de produccion', () => {
  test('el backend real entrega exactamente 2 deltas: 01-0012 y 14-0001 (la SUPERADA y las historicas no salen)', () => {
    const d = deltasReales();
    expect(d.map((x) => x.wellId)).toEqual(['01-0012', '14-0001']);
    expect(d.find((x) => x.wellId === '14-0001')).toMatchObject({ lat: IRR_14.lat, lon: IRR_14.lon, vts: T(13, 9) });
    expect(JSON.stringify(d)).not.toMatch(/Ana|privad|@|0000-4000|GMS/);
  });

  test('CASO 01-0012: base existente + VALIDADA a ~22,2 m -> lat/lon de la validada, estado V, base preservada', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const p = porId(r, '01-0012');
    expect([p.lat, p.lon]).toEqual([VAL_12.lat, VAL_12.lon]);
    expect(p.estado).toBe('V');
    expect(p.fuente).toBe('CAMPO');
    expect(p.base).toEqual({ lat: IRR_12.lat, lon: IRR_12.lon, estado: 'D' });
    expect(OP.ubicacionOperativaLogic_distanciaMetros(p.base.lat, p.base.lon, p.lat, p.lon)).toBeCloseTo(22.2, 1);
    expect(p.cuenca).toBe('Río Mendoza');
    expect(p.profundidad).toBe(120);
  });

  test('CASO 14-0001: base existente (coincidente) + SUPERADA historica + nueva VALIDADA GMS a 0,0 m -> MISMA lat/lon y estado V', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const p = porId(r, '14-0001');
    expect([p.lat, p.lon]).toEqual([IRR_14.lat, IRR_14.lon]);
    expect(p.estado).toBe('V');
    expect(p.base).toEqual({ lat: IRR_14.lat, lon: IRR_14.lon, estado: 'C' });
    expect(p.vts).toBe(T(13, 9));
  });

  test('delta validado con distancia 0 igualmente cambia estado a V (la validacion humana cambia el ESTADO, no solo lat/lon)', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const original = baseDataset().find((p) => p.wellId === '14-0001');
    const p = porId(r, '14-0001');
    expect(p.lat).toBe(original.lat);
    expect(p.lon).toBe(original.lon);
    expect(original.estado).toBe('C');
    expect(p.estado).toBe('V');
    expect(p.estado).not.toBe(original.estado);
  });

  test('la historica SUPERADA de 14-0001 no deja rastro: ni otro punto ni la coordenada vieja', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.pozos.filter((p) => p.wellId === '14-0001')).toHaveLength(1);
    expect(r.data.pozos.some((p) => p.lat === -33.3470 && p.lon === -69.1450)).toBe(false);
  });

  test('los pozos sin correccion quedan IGUALES (mismos objetos del dataset base) y el total no cambia', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.pozos).toHaveLength(4);
    expect(porId(r, '01-0013')).toEqual(baseDataset()[1]);
    expect(porId(r, '14-0002')).toEqual(baseDataset()[3]);
    expect(new Set(r.data.pozos.map((p) => p.wellId)).size).toBe(4);
    expect(r.data.operativo).toMatchObject({ aplicadas: 2, nuevos: 0 });
    expect(r.data.degradado).toBe(false);
  });
});

describe('integracion en mapaDataset_obtener', () => {
  test('el dataset base NO se modifica (pozos.json / lo que devolvio getMapaPozos queda intacto)', async () => {
    const base = baseDataset();
    const copia = JSON.parse(JSON.stringify(base));
    global.apiGetMapaPozos = jest.fn(() => Promise.resolve({ status: 'ok', data: { pozos: base, metadata: null } }));
    jest.resetModules();
    mapaDataset = require('./mapaDataset');
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.pozos).not.toBe(base);
    expect(base).toEqual(copia);
  });

  test('sin delta (lista vacia): devuelve el MISMO arreglo base, sin degradacion', async () => {
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.degradado).toBe(false);
    expect(r.data.pozos).toEqual(baseDataset());
    expect(r.data.pozos.every((p) => p.estado === 'C' || p.estado === 'D')).toBe(true);
  });

  test('delta invalido: se ignora (queda registrado) y el resto se aplica', async () => {
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [{ wellId: '14-0002', lat: 'x', lon: 1 }, { wellId: 'zz', lat: -33, lon: -69 }, null, { wellId: '01-0013', lat: -32.9, lon: -68.9, vts: T(1) }] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(porId(r, '14-0002').estado).toBe('D');
    expect(porId(r, '01-0013').estado).toBe('V');
    expect(r.data.operativo.descartadas).toHaveLength(3);
  });

  test('pozo SIN punto en pozos.json + validada: entra como V, base null, cuenca null; profundidad / tramos / surgencia "Sin dato" (no hay fuente liviana en memoria)', async () => {
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [{ wellId: '07-0500', lat: -33.1, lon: -68.5, vts: T(5) }] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.pozos).toHaveLength(5);
    expect(porId(r, '07-0500')).toEqual({
      wellId: '07-0500', lat: -33.1, lon: -68.5, estado: 'V', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null, fuente: 'CAMPO', base: null, vts: T(5)
    });
    expect(r.data.operativo.nuevos).toBe(1);
  });

  test('el dataset base se pide UNA vez por sesion; dos aperturas simultaneas comparten el fetch del base y el de los deltas', async () => {
    const [a, b] = await Promise.all([mapaDataset.mapaDataset_obtener('t'), mapaDataset.mapaDataset_obtener('t')]);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
    expect(a.data.pozos).toBe(b.data.pozos);
    await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
  });

  test('si el dataset base falla: devuelve ese error, NO pide deltas y nada se cachea (la proxima apertura reintenta)', async () => {
    let n = 0;
    instalar({ base: () => { n += 1; return Promise.resolve(n === 1 ? { status: 'error', code: 'SERVICE_UNAVAILABLE' } : { status: 'ok', data: { pozos: baseDataset(), metadata: null } }); } });
    const r1 = await mapaDataset.mapaDataset_obtener('t');
    expect(r1).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(global.apiGetUbicacionesValidadas).not.toHaveBeenCalled();
    const r2 = await mapaDataset.mapaDataset_obtener('t');
    expect(r2.status).toBe('ok');
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(2);
  });

  test('si el fetch del base RECHAZA, el rechazo se propaga como siempre', async () => {
    instalar({ base: () => Promise.reject(new Error('sin red')) });
    await expect(mapaDataset.mapaDataset_obtener('t')).rejects.toThrow('sin red');
  });

  test('sin el modulo del overlay (o sin la api) no hay overlay ni degradacion: se comporta como antes', async () => {
    instalar({ sinOverlay: true });
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.pozos).toEqual(baseDataset());
    expect(r.data.degradado).toBe(false);
    expect(global.apiGetUbicacionesValidadas).not.toHaveBeenCalled();
  });
});

describe('fallback seguro si getUbicacionesValidadas falla', () => {
  test.each([
    ['respuesta de error', () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle tecnico' })],
    ['accion desconocida (backend viejo sin publicar)', () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: getUbicacionesValidadas' })],
    ['sesion invalida', () => Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' })],
    ['sin conexion (rechaza)', () => Promise.reject(new Error('Failed to fetch'))],
    ['lanza de forma sincrona', () => { throw new Error('boom'); }],
    ['payload sin la lista', () => Promise.resolve({ status: 'ok', data: {} })],
    ['respuesta nula', () => Promise.resolve(null)]
  ])('%s: el mapa NO se rompe, usa el dataset base y marca degradado', async (_n, deltas) => {
    instalar({ deltas });
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.status).toBe('ok');
    expect(r.data.pozos).toEqual(baseDataset());
    expect(r.data.degradado).toBe(true);
    expect(JSON.stringify(r)).not.toMatch(/detalle tecnico|boom|Failed to fetch|UNAUTHORIZED|accion desconocida/);
  });

  test('la falla no se cachea: cada apertura reintenta; cuando vuelve, se aplica el overlay y se quita la marca', async () => {
    let falla = true;
    instalar({ deltas: () => (falla ? Promise.reject(new Error('x')) : Promise.resolve({ status: 'ok', data: { ubicaciones: deltasReales() } })) });
    const a = await mapaDataset.mapaDataset_obtener('t');
    expect(a.data.degradado).toBe(true);
    expect(porId(a, '01-0012').estado).toBe('D');
    const b = await mapaDataset.mapaDataset_obtener('t');
    expect(b.data.degradado).toBe(true);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    falla = false;
    const c = await mapaDataset.mapaDataset_obtener('t');
    expect(c.data.degradado).toBe(false);
    expect(porId(c, '01-0012').estado).toBe('V');
    expect(c.data.pozos).not.toBe(a.data.pozos);
  });

  test('si ya habia deltas y una renovacion falla: se muestra la base (degradado) y NO los deltas viejos', async () => {
    let falla = false;
    instalar({ deltas: () => (falla ? Promise.resolve({ status: 'error', code: 'X' }) : Promise.resolve({ status: 'ok', data: { ubicaciones: deltasReales() } })) });
    expect(porId(await mapaDataset.mapaDataset_obtener('t'), '01-0012').estado).toBe('V');
    reloj += 61000;
    falla = true;
    const r = await mapaDataset.mapaDataset_obtener('t');
    expect(r.data.degradado).toBe(true);
    expect(porId(r, '01-0012').estado).toBe('D');
  });
});

describe('cache frontend de los deltas (60 s) e invalidacion', () => {
  test('dentro de 60 s no se vuelve a pedir; pasados 60 s si; sin polling', async () => {
    await mapaDataset.mapaDataset_obtener('t');
    reloj += 59999;
    await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
    reloj += 1;
    await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(mapaDataset.MAPA_DATASET_DELTAS_TTL_MS).toBe(60000);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
  });

  test('el refresco con los MISMOS deltas conserva la identidad del arreglo (los consumidores guardan la referencia)', async () => {
    const a = await mapaDataset.mapaDataset_obtener('t');
    reloj += 61000;
    const b = await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(b.data.pozos).toBe(a.data.pozos);
    expect(b).toBe(a);
  });

  test('un delta nuevo tras el refresco produce un arreglo NUEVO con la ubicacion actualizada', async () => {
    let extra = [];
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: deltasReales().concat(extra) } }) });
    const a = await mapaDataset.mapaDataset_obtener('t');
    extra = [{ wellId: '14-0002', lat: -33.3490, lon: -69.1470, vts: T(14) }];
    reloj += 61000;
    const b = await mapaDataset.mapaDataset_obtener('t');
    expect(b.data.pozos).not.toBe(a.data.pozos);
    expect(porId(b, '14-0002').estado).toBe('V');
    expect(porId(a, '14-0002').estado).toBe('D');
  });

  test('mapaDataset_invalidarDeltas: la proxima llamada vuelve a pedir los deltas de inmediato (y SOLO los deltas)', async () => {
    await mapaDataset.mapaDataset_obtener('t');
    mapaDataset.mapaDataset_invalidarDeltas();
    await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    await mapaDataset.mapaDataset_obtener('t');
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
  });

  test('validar o revertir en la app invalidan: tras validar se ve el cambio sin esperar los 60 s', async () => {
    let ubic = [];
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: ubic } }) });
    const antes = await mapaDataset.mapaDataset_obtener('t');
    expect(porId(antes, '14-0002').estado).toBe('D');
    ubic = [{ wellId: '14-0002', lat: -33.3485, lon: -69.1465, vts: T(15) }];          // el validador la valido en el servidor
    expect(porId(await mapaDataset.mapaDataset_obtener('t'), '14-0002').estado).toBe('D');   // sin invalidar: cache de 60 s
    mapaDataset.mapaDataset_invalidarDeltas();                                           // lo que hace la app al validar
    expect(porId(await mapaDataset.mapaDataset_obtener('t'), '14-0002').estado).toBe('V');
    ubic = [];                                                                           // revertir: el servidor deja de informarla
    mapaDataset.mapaDataset_invalidarDeltas();
    expect(porId(await mapaDataset.mapaDataset_obtener('t'), '14-0002').estado).toBe('D');
  });

  test('los puntos de la app que cambian la vigente invalidan: validar (cola y ficha), "ya resuelta" y la correccion directa; rechazar no', () => {
    const validacion = leer('js', 'ubicacionValidacion.js');
    expect(validacion).toMatch(/r\.tipo === 'ok' && r\.accion === 'validar'\) \|\| r\.tipo === 'resuelta'[\s\S]{0,260}mapaDataset_invalidarDeltaCampo\(\)/);
    expect(leer('js', 'ubicacionCorreccion.js')).toMatch(/r\.resultado === 'validada'[\s\S]{0,200}mapaDataset_invalidarDeltaCampo\(\)/);
  });
});

describe('estados D / C / V en el dataset operativo', () => {
  test('D = Disponible, C = Coincidente, V = Validada en campo; ningun otro valor', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const etiquetas = r.data.pozos.map((p) => [p.wellId, p.estado, MapaLogic.mapaLogic_estadoLabel(p.estado)]);
    expect(etiquetas).toEqual([['01-0012', 'V', 'Validada en campo'], ['01-0013', 'C', 'Coincidente'], ['14-0001', 'V', 'Validada en campo'], ['14-0002', 'D', 'Disponible']]);
  });

  test('filtros y conteos sobre el dataset operativo: V no desaparece; combinaciones = union; ninguno = todo', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ids = (activos) => MapaLogic.mapaLogic_filtrarPorEstado(r.data.pozos, activos).map((p) => p.wellId);
    expect(ids({})).toEqual(['01-0012', '01-0013', '14-0001', '14-0002']);
    expect(ids({ V: true })).toEqual(['01-0012', '14-0001']);
    expect(ids({ C: true })).toEqual(['01-0013']);
    expect(ids({ D: true })).toEqual(['14-0002']);
    expect(ids({ C: true, V: true })).toEqual(['01-0012', '01-0013', '14-0001']);
    expect(MapaLogic.mapaLogic_contarPorEstado(r.data.pozos)).toEqual({ C: 1, D: 1, R: 0, V: 2 });
  });
});

describe('Cerca Mio hereda el punto operativo (logica matematica intacta)', () => {
  test('un pozo movido por una validada cambia de distancia y de ranking automaticamente', async () => {
    const lejos = { lat: -33.3600, lon: -69.1700 };
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [{ wellId: '14-0002', lat: IRR_14.lat + 0.00001, lon: IRR_14.lon, vts: T(1) }, { wellId: '14-0001', lat: lejos.lat, lon: lejos.lon, vts: T(1) }] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    const antes = Cerca.cercaMioLogic_buscarCercanos(baseDataset(), IRR_14.lat, IRR_14.lon, 2000, 30).map((p) => p.wellId);
    const despues = Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, IRR_14.lat, IRR_14.lon, 2000, 30);
    expect(antes[0]).toBe('14-0001');
    expect(despues[0].wellId).toBe('14-0002');
    expect(despues[0].distanciaMetros).toBeLessThan(5);
    expect(despues.map((p) => p.wellId)).not.toContain('14-0001');                       // se fue a ~2,3 km
    expect(Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, lejos.lat, lejos.lon, 100, 30).map((p) => p.wellId)).toEqual(['14-0001']);
  });

  test('un pozo que no tenia punto aparece por su validada, con estado V, y respeta radio y maximo de 30', async () => {
    const nuevos = [];
    for (let i = 0; i < 40; i += 1) { nuevos.push({ wellId: '10-' + String(i + 1).padStart(4, '0'), lat: -33.5 - i * 0.0001, lon: -69.2, vts: T(1) }); }
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: nuevos } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    const top = Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, -33.5, -69.2, 5000, Cerca.CERCA_MIO_MAX_RESULTADOS);
    expect(Cerca.CERCA_MIO_MAX_RESULTADOS).toBe(30);
    expect(top).toHaveLength(30);
    expect(top[0]).toMatchObject({ wellId: '10-0001', estado: 'V' });
    expect(Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, -33.5, -69.2, 200, 100).length).toBeLessThan(40);   // el radio sigue recortando (los 40 pozos se reparten en ~440 m)
    expect(Cerca.cercaMioLogic_contarDentroDeRadio(r.data.pozos, -33.5, -69.2, 5000)).toBe(40);
  });
});

describe('Seleccion hereda el punto operativo', () => {
  const poligono = [{ lat: -33.3500, lon: -69.1500 }, { lat: -33.3500, lon: -69.1400 }, { lat: -33.3450, lon: -69.1400 }, { lat: -33.3450, lon: -69.1500 }];

  test('poligono: el pozo movido entra/sale segun su punto operativo; un pozo nuevo por V entra', async () => {
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [{ wellId: '14-0002', lat: -32.0000 + -1.5, lon: -69.1450, vts: T(1) }, { wellId: '14-0001', lat: -33.3500 + 0.001, lon: -69.1450, vts: T(1) }, { wellId: '14-0900', lat: -33.3480, lon: -69.1450, vts: T(1) }] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    const base = Sel.seleccionLogic_filtrarPorPoligono(baseDataset(), poligono, 0).sort();
    const op = Sel.seleccionLogic_filtrarPorPoligono(r.data.pozos, poligono, 0).sort();
    expect(base).toEqual(['14-0001', '14-0002']);
    expect(op).toEqual(['14-0001', '14-0900']);
  });

  test('multiseleccion por wellIds: se arma sobre el dataset operativo (V incluida)', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const set = new Set(['01-0012', '14-0001']);
    const sel = Sel.seleccionLogic_filtrarPorWellIds(r.data.pozos, set);
    expect(sel.map((p) => p.wellId)).toEqual(['01-0012', '14-0001']);
    expect(sel.every((p) => p.estado === 'V')).toBe(true);
  });

  test('exportacion / tabla: la etiqueta sale con texto, nunca la letra cruda (V -> Validada en campo)', () => {
    const fuente = leer('js', 'seleccion.js');
    expect(fuente).toContain('mapaLogic_textoEstadoUbicacion(');
    expect(fuente).not.toMatch(/'Confirmada'/);
    ['D', 'C', 'R', 'V'].forEach((c) => expect(MapaLogic.mapaLogic_estadoLabel(c)).not.toBe(c));
    expect(['D', 'C', 'R', 'V'].map(MapaLogic.mapaLogic_estadoLabel)).toEqual(['Disponible', 'Coincidente', 'Aceptada', 'Validada en campo']);
  });
});

describe('Buscar reemplazo hereda el punto operativo y compara contra la BASE de Provincia', () => {
  const NE = { lat: -33.3540, lon: -69.14545 };                                       // a ~700 m de Irrigacion (>= 500 m: discrepante)
  const puntoNE = (extra) => Object.assign({ monitoringId: '14-0001', wellId: '14-0001', lat: NE.lat, lon: NE.lon, profundidad: 100, nombreOriginal: 'NE', cuenca: 'X' }, extra || {});

  test('con overlay: la comparacion y el aviso usan punto.base (Irrigacion), NO la validada; el texto sigue siendo verdadero', async () => {
    const validada = { wellId: '14-0001', lat: NE.lat, lon: NE.lon, vts: T(1) };           // la validada cae EXACTO en el punto NE
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [validada] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ref = Reemp.buscarReemplazoLogic_construirReferencia(puntoNE(), r.data.pozos);
    expect(ref.coordenadaProvincia.lat).toBe(IRR_14.lat);
    expect(ref.coordenadaProvincia.lon).toBe(IRR_14.lon);
    expect(ref.coordenadaProvincia.distanciaMetros).toBeGreaterThan(500);
    expect(ref.coordenadaProvincia.discrepante).toBe(true);
    expect(Reemp.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).toMatch(/en Irrigación está a/);
    expect(Reemp.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).not.toMatch(/padrón de Provincia/);
    // si se hubiera comparado contra la validada, la distancia seria 0 y no habria aviso
    expect(OP.ubicacionOperativaLogic_distanciaMetros(porId(r, '14-0001').lat, porId(r, '14-0001').lon, NE.lat, NE.lon)).toBe(0);
  });

  test('con overlay y base null (el pozo no estaba en el mapa): no se inventa ninguna comparacion', async () => {
    instalar({ deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: [{ wellId: '14-0900', lat: -33.4, lon: -69.2, vts: T(1) }] } }) });
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ref = Reemp.buscarReemplazoLogic_construirReferencia(puntoNE({ wellId: '14-0900', monitoringId: '14-0900' }), r.data.pozos);
    expect(ref.coordenadaProvincia).toBeNull();
    expect(Reemp.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).toBeNull();
  });

  test('sin overlay todo sigue igual (compara contra el punto del dataset)', () => {
    const ref = Reemp.buscarReemplazoLogic_construirReferencia(puntoNE(), baseDataset());
    expect(ref.coordenadaProvincia.lat).toBe(IRR_14.lat);
    expect(ref.coordenadaProvincia.discrepante).toBe(true);
  });

  test('la referencia NE sigue siendo la coordenada PROPIA del punto NE (nunca la de Provincia ni la validada)', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ref = Reemp.buscarReemplazoLogic_construirReferencia(puntoNE(), r.data.pozos);
    expect([ref.lat, ref.lon]).toEqual([NE.lat, NE.lon]);
  });

  test('candidatos: heredan lat/lon y estado V del dataset operativo (y se explican como "validada en campo")', async () => {
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ref = Reemp.buscarReemplazoLogic_construirReferencia(puntoNE({ wellId: null, monitoringId: 'INA 1', lat: IRR_12.lat, lon: IRR_12.lon }), r.data.pozos);
    const cand = Reemp.buscarReemplazoLogic_buscarCandidatos(r.data.pozos, ref, 2000, {}).find((c) => c.wellId === '01-0012');
    expect(cand).toMatchObject({ lat: VAL_12.lat, lon: VAL_12.lon, estadoCoordenada: 'V' });
    expect(Reemp.buscarReemplazoLogic_explicar(cand, ref).map((i) => i.texto)).toContain('Coordenada validada en campo');
  });
});

describe('cableado visible: index.html, service worker, css, ficha', () => {
  const html = leer('index.html');
  const css = leer('css', 'styles.css');

  test('chips de ubicacion: Todos, Coincidente (C), Disponible (D), Aceptada (R) y Validada en campo (V); "Confirmada" ya no existe', () => {
    const chips = html.match(/<button[^>]*class="mapa-estado-chip[^"]*"[^>]*data-estado="[^"]+"[^>]*>[^<]*<\/button>/g) || [];
    const lista = chips.map((c) => [c.match(/data-estado="([^"]+)"/)[1], c.replace(/<[^>]+>/g, '')]);
    expect(lista).toEqual([['todos', 'Todos'], ['C', 'Coincidente'], ['D', 'Disponible'], ['R', 'Aceptada'], ['V', 'Validada en campo']]);
    expect(html).not.toMatch(/>Confirmada</);
    expect(html).toMatch(/mapa-estado-chip mapa-estado-chip-validada/);
  });

  test('la ficha dice "Coincidente" (ya no "confirmada"): los textos de estado de la ficha salen de la misma tabla que el mapa', () => {
    const app = leer('js', 'app.js');
    const logica = leer('js', 'ubicacionOperativaLogic.js');
    expect(logica).toContain("var UOP_ETIQUETAS_CODIGO_CORTAS = { D: 'Disponible', C: 'Coincidente', R: 'Aceptada', V: 'Validada en campo' };");
    expect(app).not.toMatch(/Ubicación confirmada|corroborada: 'Ubicación/);
    expect(leer('js', 'ubicacionesConocidasLogic.js')).toMatch(/etiquetaCorta: ubicacionOperativaLogic_etiquetaCodigo\(res\.codigo, true\)/);
  });

  test('aviso discreto: en el mapa y en Cerca Mio, oculto al inicio, con el texto aprobado y sin tecnicismos', () => {
    const texto = 'Algunas actualizaciones de ubicación no pudieron cargarse. Se muestra la información disponible.';
    ['mapa-aviso-ubicaciones', 'cercamio-aviso-ubicaciones'].forEach((id) => {
      expect(html).toMatch(new RegExp('<p id="' + id + '" class="aviso-ubicaciones" role="status" hidden>' + texto.replace(/\./g, '\\.') + '</p>'));
    });
    expect(leer('js', 'mapa.js')).toMatch(/avisoUbicacionesEl\.hidden = result\.data\.degradado !== true/);
    expect(leer('js', 'cercaMio.js')).toMatch(/cercamio-aviso-ubicaciones[\s\S]{0,160}hidden = result\.data\.degradado !== true/);
  });

  test('ubicacionOperativaLogic.js se carga ANTES de mapaDataset.js y esta en el precache (sw.test lo exige)', () => {
    const tag = (n) => html.indexOf('<script src="js/' + n + '"></script>');
    expect(tag('ubicacionOperativaLogic.js')).toBeGreaterThan(-1);
    expect(tag('ubicacionOperativaLogic.js')).toBeLessThan(tag('mapaDataset.js'));
    expect(tag('mapaDataset.js')).toBeLessThan(tag('mapa.js'));
    expect(leer('sw.js')).toContain("'./js/ubicacionOperativaLogic.js'");
    expect((html.match(/js\/ubicacionOperativaLogic\.js/g) || []).length).toBe(1);
  });

  test('estilo V: verde con borde oscuro y punto mas grande, mismos hex en css y en mapaLogic (MAPA_ESTILO_PUNTO); D y C sin cambios', () => {
    const E = MapaLogic.MAPA_ESTILO_PUNTO;
    expect(css).toMatch(/--color-mapa-validada: #43a047;/);
    expect(css).toMatch(/--color-mapa-validada-borde: #14532d;/);
    expect(E.V).toEqual({ relleno: '#43a047', borde: '#14532d', grosor: 2.5, radio: 8, punteado: null });
    expect(E.C).toEqual({ relleno: '#0b5a7a', borde: '#ffffff', grosor: 1.5, radio: 7, punteado: null });
    expect(E.D).toEqual({ relleno: '#4fa3c4', borde: '#ffffff', grosor: 1.5, radio: 7, punteado: null });
    expect(css).toMatch(/\.mapa-estado-chip-validada\.active \{[^}]*background: var\(--color-mapa-validada\)/);
    expect(css).toMatch(/\.aviso-ubicaciones\[hidden\] \{\s*display: none;/);
  });

  test('un solo punto por pozo en el mapa: no hay capas de puntos historicos ni "mostrar fuentes" todavia', () => {
    const mapa = leer('js', 'mapa.js');
    expect(mapa).not.toMatch(/fuentes anteriores|historic|ubicacionesAnteriores/i);
    expect(html).not.toMatch(/fuentes anteriores/i);
  });

  test('no se tocan NE, Relevamiento, Confirmar ubicacion, tracks, satelite ni se recalcula la cuenca', () => {
    const dataset = leer('js', 'mapaDataset.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(dataset).not.toMatch(/mapaNEDataset|nivelEstatico|relevamiento|confirmarUbicacion|track|satelit|cuenca/i);
    expect(leer('js', 'mapaNE.js')).not.toMatch(/ubicacionOperativa|getUbicacionesValidadas/);
  });
});

describe('rendimiento', () => {
  test('13.804 puntos + 5.000 deltas a traves de mapaDataset_obtener: una carga muy por debajo de 1 s; la segunda (memoizada) es instantanea', async () => {
    const base = [];
    for (let i = 0; i < 13804; i += 1) { base.push(pozo(String(1 + (i % 19)).padStart(2, '0') + '-' + String(i + 1).padStart(4, '0').slice(-4), -33 - (i % 1000) * 0.001, -68 - Math.floor(i / 1000) * 0.01, i % 8 === 0 ? 'C' : 'D')); }
    const ubic = [];
    for (let i = 0; i < 5000; i += 1) { const p = base[(i * 7919) % base.length]; ubic.push({ wellId: p.wellId, lat: p.lat + 0.0005, lon: p.lon + 0.0005, vts: T(1) }); }
    instalar({ base: () => Promise.resolve({ status: 'ok', data: { pozos: base, metadata: null } }), deltas: () => Promise.resolve({ status: 'ok', data: { ubicaciones: ubic } }) });
    const t0 = process.hrtime.bigint();
    const r = await mapaDataset.mapaDataset_obtener('t');
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeLessThan(1000);                                   // en la practica son pocos milisegundos
    const movidos = new Set(ubic.map((d) => d.wellId));
    expect(r.data.pozos).toHaveLength(base.length);
    expect(r.data.pozos.filter((p) => p.estado === 'V')).toHaveLength(movidos.size);
    expect(new Set(r.data.pozos.map((p) => p.wellId)).size).toBe(base.length);
    const t1 = process.hrtime.bigint();
    const r2 = await mapaDataset.mapaDataset_obtener('t');
    expect(r2).toBe(r);
    expect(Number(process.hrtime.bigint() - t1) / 1e6).toBeLessThan(50);
  });
});
