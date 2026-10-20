// E3-3: mapaDataset_obtener compone el dataset operativo por CAPAS: BASE -> DELTA REGISTRAL (D | C | R | N) -> DELTA DE CAMPO (V) -> punto final o NINGUNO, con
// ubicacionOperativaLogic_aplicarCapas (la unica que decide). Cubre: la composicion extremo a extremo, el periodo, `parcial`, los fallbacks, el aviso unico (`degradado`),
// el cache de 60 s por capa, la invalidacion por capa, la referencia estable, el pedido de los dos deltas en PARALELO y la herencia de Cerca Mio, la seleccion y Buscar reemplazo.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const OP = require('./ubicacionOperativaLogic');
const Cerca = require('./cercaMioLogic');
const Sel = require('./seleccionLogic');
const MapaLogic = require('./mapaLogic');
Object.assign(global, Cerca);
const Reemp = require('./buscarReemplazoLogic');

const PERIODO = '2026-09';
const IRR = { lat: -33.34765, lon: -69.14545 };
const ACEP = { lat: -33.34864, lon: -69.14406 };           // fuente aceptada (R), a ~170 m
const CAMPO = { lat: -33.34745, lon: -69.14545 };          // validada en campo (V)
const T = '2026-10-12T14:05:00.000Z';

const pozo = (wellId, lat, lon, estado) => ({ wellId, lat, lon, estado: estado || 'D', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo' });
const baseDataset = () => [pozo('14-0001', IRR.lat, IRR.lon, 'C'), pozo('14-0002', -33.3480, -69.1460, 'D'), pozo('14-0003', -33.3500, -69.1500, 'D'), pozo('15-0100', -33.6, -69.3, 'C')];
const dR = (wellId, estado, c) => (estado === 'N' ? { wellId, estado: 'N' } : { wellId, estado, lat: (c || ACEP).lat, lon: (c || ACEP).lon });
const dV = (wellId, c, extra) => Object.assign({ wellId, lat: (c || CAMPO).lat, lon: (c || CAMPO).lon, vts: T }, extra || {});
const respReg = (decisiones, extra) => ({ status: 'ok', data: Object.assign({ version: 7, periodo: PERIODO, parcial: 0, decisiones }, extra || {}) });
const respCampo = (ubicaciones) => ({ status: 'ok', data: { ubicaciones } });
const porId = (r, w) => r.data.pozos.find((p) => p.wellId === w);
const ids = (r) => r.data.pozos.map((p) => p.wellId);

let mapaDataset;
let reloj;
let basePozos;

// o.registral / o.campo: funciones que devuelven la promesa de la respuesta; o.periodoBase: periodo del metadata del base (undefined = PERIODO; null = sin periodo)
function instalar(o) {
  const op = o || {};
  jest.resetModules();
  basePozos = op.pozos || baseDataset();
  const metadata = op.metadata !== undefined ? op.metadata : { totalPuntos: basePozos.length, periodo: op.periodoBase === undefined ? PERIODO : op.periodoBase, generadoEl: 'x' };
  global.apiGetMapaPozos = jest.fn(() => (op.base ? op.base() : Promise.resolve({ status: 'ok', data: { pozos: basePozos, metadata } })));
  global.apiGetUbicacionesValidadas = jest.fn(() => (op.campo ? op.campo() : Promise.resolve(respCampo([]))));
  global.apiGetDecisionesFuentesDelta = jest.fn(() => (op.registral ? op.registral() : Promise.resolve(respReg([]))));
  global.apiGetMapaNE = jest.fn();
  global.ubicacionOperativaLogic_aplicarCapas = OP.ubicacionOperativaLogic_aplicarCapas;
  reloj = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => reloj);
  mapaDataset = require('./mapaDataset');
}
afterEach(() => { jest.restoreAllMocks(); });
beforeEach(() => instalar());

const obtener = () => mapaDataset.mapaDataset_obtener('t');

describe('composicion: base -> registral -> campo', () => {
  test('base sola (los dos deltas vacios): el MISMO arreglo que entrego getMapaPozos, sin degradacion', async () => {
    const r = await obtener();
    expect(r.data.pozos).toBe(basePozos);
    expect(r.data.degradado).toBe(false);
    expect(r.data.degradacion).toEqual({
      degradado: false, registral: { estado: 'OK', aplicado: true, parcial: 0, entradasInvalidas: 0 }, campo: { estado: 'OK', aplicado: true, entradasInvalidas: 0 }
    });
    expect(r.data.metadata.periodo).toBe(PERIODO);
  });

  test('base + registral R: el pozo pasa a R en la coordenada de la fuente aceptada, con sus atributos', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R')])) });
    const r = await obtener();
    expect(porId(r, '14-0002')).toEqual({ wellId: '14-0002', lat: ACEP.lat, lon: ACEP.lon, estado: 'R', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo' });
    expect(porId(r, '14-0001')).toBe(basePozos[0]);                  // los demas: los mismos objetos
    expect(r.data.operativo).toMatchObject({ aplicadas: 1, nuevos: 0, quitados: 0 });
    expect(r.data.degradado).toBe(false);
  });

  test('base + registral N: el pozo SALE del dataset (quitados) y no se toca nada mas', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'N')])) });
    const r = await obtener();
    expect(ids(r)).toEqual(['14-0001', '14-0003', '15-0100']);
    expect(r.data.operativo.quitados).toBe(1);
    expect(r.data.degradado).toBe(false);
    expect(basePozos).toHaveLength(4);                                // el base no se modifica
  });

  test('base + V: como siempre (estado V, fuente CAMPO, base D / C del padron)', async () => {
    instalar({ campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const p = porId(await obtener(), '14-0001');
    expect(p).toMatchObject({ estado: 'V', fuente: 'CAMPO', lat: CAMPO.lat, lon: CAMPO.lon, base: { lat: IRR.lat, lon: IRR.lon, estado: 'C' }, vts: T });
  });

  test('base + R + V: V operativa y R queda de respaldo en `base`', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0001', 'R')])), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const p = porId(await obtener(), '14-0001');
    expect(p.estado).toBe('V');
    expect(p.lat).toBe(CAMPO.lat);
    expect(p.base).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
    expect(p.cuenca).toBe('Río Mendoza');
  });

  test('base + N + V: el pozo NO se elimina (V salva al pozo con N); su base es null', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0001', 'N')])), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const r = await obtener();
    const p = porId(r, '14-0001');
    expect(p.estado).toBe('V');
    expect(p.base).toBeNull();
    expect(p.profundidad).toBe(120);
    expect(r.data.operativo.quitados).toBe(0);
  });

  test('pozo NUEVO por R (no esta en pozos.json): entra con atributos "Sin dato"', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('07-0500', 'R')])) });
    const r = await obtener();
    expect(ids(r)).toEqual(['14-0001', '14-0002', '14-0003', '15-0100', '07-0500']);
    expect(porId(r, '07-0500')).toEqual({ wellId: '07-0500', lat: ACEP.lat, lon: ACEP.lon, estado: 'R', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null });
    expect(r.data.operativo.nuevos).toBe(1);
  });

  test('pozo NUEVO por V: igual que antes (V, base null, "Sin dato")', async () => {
    instalar({ campo: () => Promise.resolve(respCampo([dV('07-0500')])) });
    expect(porId(await obtener(), '07-0500')).toEqual({ wellId: '07-0500', lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null, fuente: 'CAMPO', base: null, vts: T });
  });

  test('pozo NUEVO por R + V: V gana y la base es R', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('07-0500', 'R')])), campo: () => Promise.resolve(respCampo([dV('07-0500')])) });
    const p = porId(await obtener(), '07-0500');
    expect(p.estado).toBe('V');
    expect(p.base).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
  });

  test('un N sobre un pozo que no esta en el base no crea nada (sinPunto); N + V crea el pozo con la V', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('07-0500', 'N'), dR('07-0501', 'N')])), campo: () => Promise.resolve(respCampo([dV('07-0501')])) });
    const r = await obtener();
    expect(porId(r, '07-0500')).toBeUndefined();
    expect(porId(r, '07-0501').estado).toBe('V');
    expect(r.data.operativo.sinPunto).toBe(1);
    expect(r.data.operativo.nuevos).toBe(1);
  });

  test('D y C del delta reemplazan la resolucion registral del base', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0001', 'D'), dR('14-0002', 'C')])) });
    const r = await obtener();
    expect(porId(r, '14-0001')).toMatchObject({ estado: 'D', lat: ACEP.lat });
    expect(porId(r, '14-0002')).toMatchObject({ estado: 'C', lat: ACEP.lat });
  });

  test('una validada sobre un pozo que el delta dejo sin punto y sin V invalida: sale (la V invalida no salva)', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'N')])), campo: () => Promise.resolve(respCampo([dV('14-0002', { lat: NaN, lon: 1 })])) });
    const r = await obtener();
    expect(porId(r, '14-0002')).toBeUndefined();
    expect(r.data.degradado).toBe(true);                              // la entrada de campo invalida cuenta como degradacion
  });
});

describe('periodo: el delta registral solo se aplica si es el MISMO padron que el base', () => {
  const decisiones = [dR('14-0002', 'R'), dR('14-0003', 'N')];

  test('periodo igual: se aplica', async () => {
    instalar({ registral: () => Promise.resolve(respReg(decisiones)) });
    const r = await obtener();
    expect(porId(r, '14-0002').estado).toBe('R');
    expect(porId(r, '14-0003')).toBeUndefined();
    expect(r.data.degradacion.registral.estado).toBe('OK');
  });

  test('periodo DISTINTO: se ignora TODO el delta registral (ni una entrada), se conserva base + V y se marca degradado', async () => {
    instalar({ registral: () => Promise.resolve(respReg(decisiones, { periodo: '2026-10' })), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const r = await obtener();
    expect(porId(r, '14-0002')).toBe(basePozos[1]);
    expect(porId(r, '14-0003')).toBe(basePozos[2]);
    expect(porId(r, '14-0001').estado).toBe('V');                     // la V sigue funcionando
    expect(r.data.degradado).toBe(true);
    expect(r.data.degradacion.registral).toMatchObject({ estado: 'PERIODO_INCOMPATIBLE', aplicado: false });
    expect(r.data.degradacion.campo.estado).toBe('OK');
  });

  test.each([['metadata nula', { metadata: null }], ['metadata sin periodo', { metadata: { totalPuntos: 4 } }], ['periodo vacio', { periodoBase: '' }], ['periodo en blanco', { periodoBase: '   ' }], ['periodo nulo', { periodoBase: null }]])(
    'el BASE no trae periodo (%s): degradacion global registral, el delta ni se pide y se conserva base + V', async (_n, op) => {
      instalar(Object.assign({ registral: () => Promise.resolve(respReg(decisiones)), campo: () => Promise.resolve(respCampo([dV('14-0001')])) }, op));
      const r = await obtener();
      expect(global.apiGetDecisionesFuentesDelta).not.toHaveBeenCalled();
      expect(porId(r, '14-0002')).toBe(basePozos[1]);
      expect(porId(r, '14-0001').estado).toBe('V');
      expect(r.data.degradado).toBe(true);
      expect(r.data.degradacion.registral.estado).toBe('PERIODO_FALTANTE_BASE');
    });

  test.each([['sin periodo', undefined], ['periodo vacio', ''], ['periodo en blanco', '  '], ['periodo nulo', null], ['periodo numerico', 202609]])(
    'el DELTA no trae periodo (%s): degradacion global registral, no se aplica ninguna entrada', async (_n, periodo) => {
      instalar({ registral: () => Promise.resolve({ status: 'ok', data: { version: 7, parcial: 0, decisiones, periodo } }) });
      const r = await obtener();
      expect(porId(r, '14-0002')).toBe(basePozos[1]);
      expect(r.data.degradado).toBe(true);
      expect(r.data.degradacion.registral.estado).toBe('PERIODO_FALTANTE_DELTA');
    });

  test('no se inventa ningun periodo (ni se compara por prefijo ni por mayusculas)', async () => {
    for (const p of ['2026-9', '2026-09 ', '2026-09-01', 'x']) {
      instalar({ registral: () => Promise.resolve(respReg(decisiones, { periodo: p })) });
      const r = await obtener();
      expect(r.data.degradacion.registral.estado).toBe('PERIODO_INCOMPATIBLE');
    }
  });
});

describe('parcial > 0 NO descarta el delta: se aplican todas las entradas validas', () => {
  test('{parcial: 3, 2 entradas validas}: ambas se aplican, los no resueltos conservan base + V y se marca degradado', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R'), dR('14-0003', 'N')], { parcial: 3 })) });
    const r = await obtener();
    expect(porId(r, '14-0002').estado).toBe('R');
    expect(porId(r, '14-0003')).toBeUndefined();
    expect(porId(r, '14-0001')).toBe(basePozos[0]);                   // un pozo que no esta en el delta: base intacta
    expect(r.data.degradado).toBe(true);
    expect(r.data.degradacion.registral).toMatchObject({ estado: 'OK', aplicado: true, parcial: 3 });
  });

  test('parcial 0 y delta vacio: nada que aplicar, mismo arreglo, sin degradacion', async () => {
    instalar({ registral: () => Promise.resolve(respReg([], { parcial: 0 })) });
    const r = await obtener();
    expect(r.data.pozos).toBe(basePozos);
    expect(r.data.degradado).toBe(false);
  });

  test('parcial > 0 con delta vacio tambien es degradacion (hay decisiones sin resolver)', async () => {
    instalar({ registral: () => Promise.resolve(respReg([], { parcial: 2 })) });
    const r = await obtener();
    expect(r.data.pozos).toBe(basePozos);
    expect(r.data.degradado).toBe(true);
  });
});

describe('validacion del delta registral', () => {
  test('una entrada individual invalida se ignora (base/V de ese pozo intactos, jamas N), el resto se aplica y cuenta como degradacion', async () => {
    instalar({
      registral: () => Promise.resolve(respReg([
        dR('14-0002', 'R'), { wellId: '14-0003', estado: 'R', lat: NaN, lon: 1 }, { wellId: '15-0100', estado: 'R', lat: -55, lon: -69 }, { wellId: '14-0001', estado: 'Q' }, null, { wellId: 'zz', estado: 'N' }
      ])),
      campo: () => Promise.resolve(respCampo([dV('15-0100')]))
    });
    const r = await obtener();
    expect(porId(r, '14-0002').estado).toBe('R');
    expect(porId(r, '14-0003')).toBe(basePozos[2]);
    expect(porId(r, '14-0001')).toBe(basePozos[0]);
    expect(porId(r, '15-0100').estado).toBe('V');
    expect(r.data.pozos).toHaveLength(4);                             // ningun pozo desaparecio
    expect(r.data.degradado).toBe(true);
    expect(r.data.degradacion.registral.entradasInvalidas).toBe(5);
  });

  test('un pozo repetido con contenido distinto se ignora para ese pozo (base/V) y se marca degradado', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R'), dR('14-0002', 'N'), dR('14-0003', 'R')])) });
    const r = await obtener();
    expect(porId(r, '14-0002')).toBe(basePozos[1]);
    expect(porId(r, '14-0003').estado).toBe('R');
    expect(r.data.degradado).toBe(true);
  });

  test.each([
    ['decisiones no es una lista', respReg('no', {})],
    ['decisiones ausente', { status: 'ok', data: { version: 1, periodo: PERIODO, parcial: 0 } }],
    ['version negativa', respReg([], { version: -1 })],
    ['version decimal', respReg([], { version: 1.5 })],
    ['version como texto', respReg([], { version: '7' })],
    ['version ausente', { status: 'ok', data: { periodo: PERIODO, parcial: 0, decisiones: [] } }],
    ['parcial negativo', respReg([], { parcial: -1 })],
    ['parcial decimal', respReg([], { parcial: 1.5 })],
    ['parcial como texto', respReg([], { parcial: '0' })],
    ['parcial ausente', { status: 'ok', data: { version: 1, periodo: PERIODO, decisiones: [] } }],
    ['data es un arreglo', { status: 'ok', data: [] }],
    ['data nula', { status: 'ok', data: null }]
  ])('respuesta global invalida (%s): se ignora TODO el delta registral y se conserva base + V', async (_n, resp) => {
    instalar({ registral: () => Promise.resolve(resp), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const r = await obtener();
    expect(porId(r, '14-0002')).toBe(basePozos[1]);
    expect(porId(r, '14-0001').estado).toBe('V');
    expect(r.data.degradado).toBe(true);
    expect(['RESPUESTA_INVALIDA', 'FALLA', 'PERIODO_FALTANTE_DELTA']).toContain(r.data.degradacion.registral.estado);
  });
});

describe('fallas de los endpoints: el mapa NO se rompe y el aviso es UNO', () => {
  const fallas = [
    ['respuesta de error', () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle tecnico' })],
    ['accion desconocida (backend viejo)', () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: getDecisionesFuentesDelta' })],
    ['sesion invalida', () => Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' })],
    ['sin conexion (rechaza)', () => Promise.reject(new Error('Failed to fetch'))],
    ['lanza de forma sincrona', () => { throw new Error('boom'); }],
    ['respuesta nula', () => Promise.resolve(null)]
  ];

  test.each(fallas)('registral: %s -> base + V, degradado, sin tecnicismos', async (_n, falla) => {
    instalar({ registral: falla, campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const r = await obtener();
    expect(r.status).toBe('ok');
    expect(porId(r, '14-0002')).toBe(basePozos[1]);
    expect(porId(r, '14-0001').estado).toBe('V');
    expect(r.data.degradado).toBe(true);
    expect(r.data.degradacion.registral).toMatchObject({ estado: 'FALLA', aplicado: false });
    expect(r.data.degradacion.campo.estado).toBe('OK');
    expect(JSON.stringify(r.data.degradacion)).not.toMatch(/detalle tecnico|boom|Failed to fetch|UNAUTHORIZED|accion desconocida/);
  });

  test.each(fallas)('campo: %s -> el registral SI se aplica, sin V, degradado', async (_n, falla) => {
    instalar({ campo: falla, registral: () => Promise.resolve(respReg([dR('14-0002', 'R')])) });
    const r = await obtener();
    expect(r.status).toBe('ok');
    expect(porId(r, '14-0002').estado).toBe('R');
    expect(r.data.degradado).toBe(true);
    expect(r.data.degradacion.campo).toMatchObject({ estado: 'FALLA', aplicado: false });
    expect(r.data.degradacion.registral.estado).toBe('OK');
  });

  test('payload de campo sin la lista tambien es falla de campo', async () => {
    instalar({ campo: () => Promise.resolve({ status: 'ok', data: {} }) });
    const r = await obtener();
    expect(r.data.degradacion.campo.estado).toBe('FALLA');
    expect(r.data.degradado).toBe(true);
  });

  test('las DOS fallan: el dataset base tal cual, UN solo flag de degradacion (el detalle por capa es interno)', async () => {
    instalar({ registral: () => Promise.reject(new Error('x')), campo: () => Promise.reject(new Error('y')) });
    const r = await obtener();
    expect(r.data.pozos).toBe(basePozos);
    expect(r.data.degradado).toBe(true);
    expect(typeof r.data.degradado).toBe('boolean');
    expect(r.data.degradacion.registral.estado).toBe('FALLA');
    expect(r.data.degradacion.campo.estado).toBe('FALLA');
  });

  test('cada causa enciende el mismo aviso unico (el flag es un booleano; ningun otro campo de la respuesta lo duplica)', async () => {
    const causas = [
      { registral: () => Promise.reject(new Error('x')) },
      { campo: () => Promise.reject(new Error('x')) },
      { registral: () => Promise.resolve(respReg([], { parcial: 1 })) },
      { registral: () => Promise.resolve(respReg([{ wellId: 'zz', estado: 'N' }])) },
      { registral: () => Promise.resolve(respReg([], { periodo: '1999-01' })) },
      { campo: () => Promise.resolve(respCampo([{ wellId: 'zz' }])) }
    ];
    for (const c of causas) {
      instalar(c);
      const r = await obtener();
      expect(r.data.degradado).toBe(true);
      expect(Object.keys(r.data).sort()).toEqual(['degradacion', 'degradado', 'metadata', 'operativo', 'pozos']);
    }
  });

  test('una falla registral NO se cachea como exito: cada apertura reintenta; cuando vuelve se aplica y se quita la marca', async () => {
    let falla = true;
    instalar({ registral: () => (falla ? Promise.reject(new Error('x')) : Promise.resolve(respReg([dR('14-0002', 'R')]))) });
    const a = await obtener();
    expect(a.data.degradado).toBe(true);
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    falla = false;
    const c = await obtener();
    expect(c.data.degradado).toBe(false);
    expect(porId(c, '14-0002').estado).toBe('R');
    expect(c.data.pozos).not.toBe(a.data.pozos);
  });

  test('un periodo incompatible tampoco se cachea como exito: la proxima apertura vuelve a pedir', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R')], { periodo: '1999-01' })) });
    await obtener();
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
  });

  test('si ya habia delta registral y la renovacion falla: se muestra base + V (degradado), NO el delta viejo', async () => {
    let falla = false;
    instalar({ registral: () => (falla ? Promise.resolve({ status: 'error' }) : Promise.resolve(respReg([dR('14-0002', 'R')]))) });
    expect(porId(await obtener(), '14-0002').estado).toBe('R');
    reloj += 61000;
    falla = true;
    const r = await obtener();
    expect(porId(r, '14-0002')).toBe(basePozos[1]);
    expect(r.data.degradado).toBe(true);
  });

  test('si el dataset base falla: se devuelve ese error y NO se pide ningun delta', async () => {
    instalar({ base: () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) });
    const r = await obtener();
    expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(global.apiGetDecisionesFuentesDelta).not.toHaveBeenCalled();
    expect(global.apiGetUbicacionesValidadas).not.toHaveBeenCalled();
  });

  test('sin el wrapper del delta registral (o sin el modulo de capas) esa capa no existe: sin degradacion, como antes', async () => {
    instalar({ campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    delete global.apiGetDecisionesFuentesDelta;
    const r = await obtener();
    expect(porId(r, '14-0001').estado).toBe('V');
    expect(r.data.degradado).toBe(false);
    expect(r.data.degradacion.registral.estado).toBe('OMITIDA');
    instalar();
    delete global.ubicacionOperativaLogic_aplicarCapas;
    const s = await obtener();
    expect(s.data.pozos).toBe(basePozos);
    expect(s.data.degradado).toBe(false);
    expect(global.apiGetDecisionesFuentesDelta).not.toHaveBeenCalled();
  });
});

describe('pedidos: los dos deltas EN PARALELO, despues del base', () => {
  function diferido() {
    let resolver;
    const p = new Promise((res) => { resolver = res; });
    return { promesa: p, resolver };
  }
  const turnos = async (n) => { for (let i = 0; i < n; i += 1) { await Promise.resolve(); } };

  test('ambos pedidos salen en el mismo turno, antes de que cualquiera responda (no se suman dos latencias)', async () => {
    const dReg = diferido();
    const dCampo = diferido();
    instalar({ registral: () => dReg.promesa, campo: () => dCampo.promesa });
    const pr = obtener();
    await turnos(20);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);          // el segundo NO esperaba al primero
    dCampo.resolver(respCampo([dV('14-0001')]));
    await turnos(20);
    dReg.resolver(respReg([dR('14-0002', 'R')]));
    const r = await pr;
    expect(porId(r, '14-0001').estado).toBe('V');
    expect(porId(r, '14-0002').estado).toBe('R');
  });

  test('con el base pendiente no se pide ningun delta; al resolver el base salen los dos', async () => {
    const dBase = diferido();
    instalar({ base: () => dBase.promesa });
    const pr = obtener();
    await turnos(20);
    expect(global.apiGetDecisionesFuentesDelta).not.toHaveBeenCalled();
    expect(global.apiGetUbicacionesValidadas).not.toHaveBeenCalled();
    dBase.resolver({ status: 'ok', data: { pozos: basePozos, metadata: { periodo: PERIODO } } });
    await pr;
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
  });

  test('si un delta nunca responde pero el otro falla, el que falla no queda trabado ni bloquea al compositor', async () => {
    instalar({ registral: () => Promise.reject(new Error('x')), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const r = await obtener();
    expect(porId(r, '14-0001').estado).toBe('V');
  });

  test('dos aperturas simultaneas comparten el base y cada delta: un solo pedido de cada uno', async () => {
    const [a, b] = await Promise.all([obtener(), obtener()]);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
    expect(a.data.pozos).toBe(b.data.pozos);
  });
});

describe('cache de 60 s por capa e invalidacion (sin tocar el base)', () => {
  test('dentro de 60 s no se vuelve a pedir ninguno; pasados 60 s se piden los DOS; el base nunca', async () => {
    await obtener();
    reloj += 59999;
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
    reloj += 1;
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(mapaDataset.MAPA_DATASET_DELTAS_TTL_MS).toBe(60000);
  });

  test('mapaDataset_invalidarDeltaRegistral: la proxima llamada pide SOLO el registral (ni el de campo ni el base)', async () => {
    await obtener();
    mapaDataset.mapaDataset_invalidarDeltaRegistral();
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(1);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
  });

  test('mapaDataset_invalidarDeltaCampo: la proxima llamada pide SOLO el de campo', async () => {
    await obtener();
    mapaDataset.mapaDataset_invalidarDeltaCampo();
    await obtener();
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(1);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
  });

  test('mapaDataset_invalidarDeltas (la generica que ya usan validar y revertir) invalida las DOS capas y nunca el base', async () => {
    await obtener();
    mapaDataset.mapaDataset_invalidarDeltas();
    await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    expect(global.apiGetUbicacionesValidadas).toHaveBeenCalledTimes(2);
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
  });

  test('tras invalidar, el cambio del servidor se ve sin esperar los 60 s (aceptar y quitar la aceptacion)', async () => {
    let decisiones = [];
    instalar({ registral: () => Promise.resolve(respReg(decisiones)) });
    expect(porId(await obtener(), '14-0002').estado).toBe('D');
    decisiones = [dR('14-0002', 'R')];
    expect(porId(await obtener(), '14-0002').estado).toBe('D');            // sin invalidar: cache
    mapaDataset.mapaDataset_invalidarDeltaRegistral();
    expect(porId(await obtener(), '14-0002').estado).toBe('R');
    decisiones = [];
    mapaDataset.mapaDataset_invalidarDeltaRegistral();
    expect(porId(await obtener(), '14-0002').estado).toBe('D');
  });

  test('los callers existentes siguen funcionando: validar / revertir / correccion directa llaman a la generica', () => {
    expect(leer('js', 'ubicacionValidacion.js')).toMatch(/mapaDataset_invalidarDeltas\(\)/);
    expect(leer('js', 'ubicacionCorreccion.js')).toMatch(/mapaDataset_invalidarDeltas\(\)/);
  });

  test('las decisiones y sugerencias todavia NO invalidan (eso es E3-6)', () => {
    ['ubicacionFuenteDecisionesUi.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionSugerencias.js', 'ubicacionesConocidas.js'].forEach((f) => {
      expect(leer('js', f)).not.toMatch(/mapaDataset_invalidar/);
    });
  });
});

describe('referencia estable', () => {
  test('el refresco con los MISMOS deltas conserva el arreglo y el resultado (los consumidores guardan la referencia)', async () => {
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R')])), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    const a = await obtener();
    reloj += 61000;
    const b = await obtener();
    expect(global.apiGetDecisionesFuentesDelta).toHaveBeenCalledTimes(2);
    expect(b.data.pozos).toBe(a.data.pozos);
    expect(b).toBe(a);
  });

  test('cambia SOLO la version del delta (decision sin efecto sobre ningun punto): sigue siendo el mismo arreglo', async () => {
    let version = 7;
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R')], { version })) });
    const a = await obtener();
    version = 8;
    reloj += 61000;
    const b = await obtener();
    expect(b).toBe(a);
  });

  test('un cambio en el registral produce un arreglo NUEVO; los puntos que no cambiaron siguen siendo los mismos objetos', async () => {
    let decisiones = [dR('14-0002', 'R')];
    instalar({ registral: () => Promise.resolve(respReg(decisiones)) });
    const a = await obtener();
    decisiones = [dR('14-0002', 'R'), dR('14-0003', 'N')];
    reloj += 61000;
    const b = await obtener();
    expect(b.data.pozos).not.toBe(a.data.pozos);
    expect(porId(b, '14-0001')).toBe(porId(a, '14-0001'));
    expect(ids(a)).toContain('14-0003');
    expect(ids(b)).not.toContain('14-0003');
  });

  test('un cambio en la capa de campo produce un arreglo nuevo aunque el registral sea el mismo', async () => {
    let ub = [];
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R')])), campo: () => Promise.resolve(respCampo(ub)) });
    const a = await obtener();
    ub = [dV('14-0001')];
    reloj += 61000;
    const b = await obtener();
    expect(b.data.pozos).not.toBe(a.data.pozos);
    expect(porId(b, '14-0001').estado).toBe('V');
    expect(porId(b, '14-0002')).toEqual(porId(a, '14-0002'));          // el R se recompone (objeto nuevo) pero igual
    expect(porId(b, '14-0003')).toBe(basePozos[2]);                     // los puntos sin capas siguen siendo los del base
  });

  test('volver de una falla a los mismos datos NO conserva la referencia vieja de la falla (cambia lo que se aplica)', async () => {
    let falla = false;
    instalar({ registral: () => (falla ? Promise.reject(new Error('x')) : Promise.resolve(respReg([dR('14-0002', 'R')]))) });
    const a = await obtener();
    falla = true;
    reloj += 61000;
    const b = await obtener();
    expect(b.data.pozos).not.toBe(a.data.pozos);
    falla = false;
    reloj += 61000;
    const c = await obtener();
    expect(c.data.pozos).not.toBe(b.data.pozos);
    expect(porId(c, '14-0002').estado).toBe('R');
  });

  test('el dataset base nunca se modifica (ni el arreglo ni los puntos)', async () => {
    const copia = JSON.parse(JSON.stringify(baseDataset()));
    instalar({ registral: () => Promise.resolve(respReg([dR('14-0002', 'R'), dR('14-0003', 'N'), dR('07-0500', 'R')])), campo: () => Promise.resolve(respCampo([dV('14-0001')])) });
    basePozos.forEach((p) => Object.freeze(p));
    Object.freeze(basePozos);
    await obtener();
    expect(JSON.parse(JSON.stringify(basePozos))).toEqual(copia);
  });
});

describe('resumen interno (para pruebas y futuro; el usuario solo ve el aviso unico)', () => {
  test('el resumen operativo conserva el contrato anterior (aplicadas, nuevos, descartadas) y suma quitados, sinPunto y el detalle por capa', async () => {
    instalar({
      registral: () => Promise.resolve(respReg([dR('14-0002', 'N'), dR('07-0500', 'R'), { wellId: 'zz', estado: 'R' }])),
      campo: () => Promise.resolve(respCampo([dV('14-0001'), { wellId: '15-0100', lat: 'x', lon: 1 }]))
    });
    const r = await obtener();
    expect(r.data.operativo).toMatchObject({ aplicadas: 2, nuevos: 1, quitados: 1, sinPunto: 0 });
    expect(r.data.operativo.descartadas).toEqual([{ wellId: '15-0100', motivo: 'COORDENADA_INVALIDA' }]);
    expect(r.data.operativo.registral.descartadas).toEqual([{ wellId: 'zz', motivo: 'WELL_ID_INVALIDO' }]);
    expect(r.data.operativo.registral.recibidas).toBe(3);
    expect(r.data.operativo.campo.recibidas).toBe(2);
  });
});

describe('los consumidores heredan el dataset operativo SIN reglas propias', () => {
  const dsReg = (decisiones, ub) => ({ registral: () => Promise.resolve(respReg(decisiones)), campo: () => Promise.resolve(respCampo(ub || [])) });

  test('Cerca Mio: ve R en su lugar nuevo y no ve el pozo que quedo sin punto', async () => {
    instalar(dsReg([dR('14-0002', 'R', { lat: -33.2, lon: -69.0 }), dR('14-0003', 'N')]));
    const r = await obtener();
    const cerca = (lat, lon, rad) => Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, lat, lon, rad, 100);
    expect(cerca(-33.2, -69.0, 100).map((p) => p.wellId)).toEqual(['14-0002']);
    expect(cerca(-33.2, -69.0, 100)[0].estado).toBe('R');
    expect(cerca(-33.3480, -69.1460, 100).map((p) => p.wellId)).not.toContain('14-0002');      // ya no esta en su lugar viejo
    expect(cerca(-33.3500, -69.1500, 200).map((p) => p.wellId)).not.toContain('14-0003');      // sin punto: no aparece
    expect(Cerca.cercaMioLogic_buscarCercanos(basePozos, -33.3500, -69.1500, 200, 100).map((p) => p.wellId)).toContain('14-0003');
  });

  test('Cerca Mio: un R + V muestra la V; un N + V sigue apareciendo', async () => {
    instalar(dsReg([dR('14-0001', 'R'), dR('14-0002', 'N')], [dV('14-0001'), dV('14-0002', { lat: -33.3482, lon: -69.1462 })]));
    const r = await obtener();
    const cerca = Cerca.cercaMioLogic_buscarCercanos(r.data.pozos, -33.3482, -69.1462, 100, 100);
    expect(cerca.map((p) => p.wellId)).toContain('14-0002');
    expect(cerca.find((p) => p.wellId === '14-0002').estado).toBe('V');
  });

  test('seleccion: el poligono usa el punto R; el pozo sin punto no participa; la multiseleccion sobre el dataset operativo', async () => {
    instalar(dsReg([dR('14-0002', 'R', { lat: -33.2, lon: -69.0 }), dR('14-0003', 'N')]));
    const r = await obtener();
    const cercaDeR = [{ lat: -33.21, lon: -69.01 }, { lat: -33.21, lon: -68.99 }, { lat: -33.19, lon: -68.99 }, { lat: -33.19, lon: -69.01 }];
    const cercaDe3 = [{ lat: -33.351, lon: -69.151 }, { lat: -33.351, lon: -69.149 }, { lat: -33.349, lon: -69.149 }, { lat: -33.349, lon: -69.151 }];
    expect(Sel.seleccionLogic_filtrarPorPoligono(basePozos, cercaDeR, 0)).toEqual([]);
    expect(Sel.seleccionLogic_filtrarPorPoligono(r.data.pozos, cercaDeR, 0)).toEqual(['14-0002']);
    expect(Sel.seleccionLogic_filtrarPorPoligono(basePozos, cercaDe3, 0)).toEqual(['14-0003']);
    expect(Sel.seleccionLogic_filtrarPorPoligono(r.data.pozos, cercaDe3, 0)).toEqual([]);
    const sel = Sel.seleccionLogic_filtrarPorWellIds(r.data.pozos, new Set(['14-0002', '14-0003']));
    expect(sel.map((p) => p.wellId)).toEqual(['14-0002']);
  });

  test('Buscar reemplazo: los candidatos incluyen el pozo R en su punto nuevo y EXCLUYEN al que quedo sin punto', async () => {
    instalar(dsReg([dR('14-0002', 'R', { lat: -33.3482, lon: -69.1462 }), dR('14-0003', 'N')]));
    const r = await obtener();
    const ref = { wellId: null, lat: -33.3481, lon: -69.1461, profundidad: 100, profundidadValida: 100 };
    const antes = Reemp.buscarReemplazoLogic_buscarCandidatos(basePozos, ref, 500, {}).map((c) => c.wellId);
    const despues = Reemp.buscarReemplazoLogic_buscarCandidatos(r.data.pozos, ref, 500, {});
    expect(antes).toContain('14-0003');
    expect(despues.map((c) => c.wellId)).toContain('14-0002');
    expect(despues.map((c) => c.wellId)).not.toContain('14-0003');
    const c2 = despues.find((c) => c.wellId === '14-0002');
    expect(c2.lat).toBe(-33.3482);
  });

  test('Buscar reemplazo: la referencia NE sigue siendo la coordenada PROPIA del punto NE; para un pozo R compara contra su punto R; para una V, contra su base', async () => {
    instalar(dsReg([dR('14-0002', 'R', ACEP), dR('14-0001', 'R', ACEP)], [dV('14-0001')]));
    const r = await obtener();
    const ne = (w) => ({ monitoringId: w, wellId: w, lat: -33.36, lon: -69.16, profundidad: 100, nombreOriginal: 'NE', cuenca: 'X' });
    const refR = Reemp.buscarReemplazoLogic_construirReferencia(ne('14-0002'), r.data.pozos);
    expect([refR.lat, refR.lon]).toEqual([-33.36, -69.16]);
    expect([refR.coordenadaProvincia.lat, refR.coordenadaProvincia.lon]).toEqual([ACEP.lat, ACEP.lon]);
    const refV = Reemp.buscarReemplazoLogic_construirReferencia(ne('14-0001'), r.data.pozos);
    expect([refV.coordenadaProvincia.lat, refV.coordenadaProvincia.lon]).toEqual([ACEP.lat, ACEP.lon]);        // la base de la V es R, no la V
  });

  test('NE no participa: mapaDataset no pide ni conoce la capa NE y su codigo no la nombra', async () => {
    instalar(dsReg([dR('14-0002', 'R')]));
    await obtener();
    expect(global.apiGetMapaNE).not.toHaveBeenCalled();
    expect(leer('js', 'mapaDataset.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')).not.toMatch(/MapaNE|mapaNE|nivelesEstaticos|monitoringId/);
  });

  test('R llega a los consumidores con su nombre humano, se cuenta aparte y entra en los filtros (E3-4)', async () => {
    instalar(dsReg([dR('14-0002', 'R')]));
    const r = await obtener();
    const pozos = r.data.pozos;
    expect(MapaLogic.mapaLogic_estadoLabel('R')).toBe('Aceptada');
    expect(MapaLogic.mapaLogic_filtrarPorEstado(pozos, {})).toHaveLength(pozos.length);
    expect(MapaLogic.mapaLogic_filtrarPorEstado(pozos, { R: true }).map((p) => p.wellId)).toEqual(['14-0002']);
    expect(MapaLogic.mapaLogic_contarPorEstado(pozos)).toEqual({ C: 2, D: 1, R: 1, V: 0 });
    expect(() => Cerca.cercaMioLogic_buscarCercanos(pozos, ACEP.lat, ACEP.lon, 1000, 10)).not.toThrow();
  });
});

describe('cableado y aviso unico', () => {
  const html = leer('index.html');

  test('el aviso es UNO por pantalla (mapa y Cerca Mio), con el texto aprobado y sin tecnicismos; el JS lo gobierna con el mismo flag', () => {
    const texto = 'Algunas actualizaciones de ubicación no pudieron cargarse. Se muestra la información disponible.';
    ['mapa-aviso-ubicaciones', 'cercamio-aviso-ubicaciones'].forEach((id) => {
      expect(html).toContain('<p id="' + id + '" class="aviso-ubicaciones" role="status" hidden>' + texto + '</p>');
    });
    expect((html.match(/class="aviso-ubicaciones"/g) || []).length).toBe(2);
    expect(leer('js', 'mapa.js')).toMatch(/avisoUbicacionesEl\.hidden = result\.data\.degradado !== true/);
    expect(leer('js', 'cercaMio.js')).toMatch(/cercamio-aviso-ubicaciones[\s\S]{0,160}hidden = result\.data\.degradado !== true/);
    expect(html).not.toMatch(/No se pudieron actualizar las ubicaciones validadas/);
  });

  test('api.js: el wrapper del delta registral es igual a los demas (solo la sesion, sin parametros inventados)', () => {
    const calls = [];
    global.callBackend = (accion, datos) => { calls.push([accion, datos]); return Promise.resolve({ status: 'ok' }); };
    const vm = require('vm');
    const ctx = vm.createContext({ callBackend: global.callBackend, fetch: () => Promise.resolve({ json: () => Promise.resolve({ status: 'ok' }) }), JSON, Object, Promise });
    vm.runInContext(leer('js', 'api.js'), ctx);
    expect(typeof ctx.apiGetDecisionesFuentesDelta).toBe('function');
    expect(ctx.apiGetDecisionesFuentesDelta.length).toBe(1);
    return ctx.apiGetDecisionesFuentesDelta('tok').then(() => {
      delete global.callBackend;
    });
  });

  test('mapaDataset usa SOLO la composicion pura: no repite reglas de resolucion', () => {
    const codigo = leer('js', 'mapaDataset.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(codigo).toMatch(/ubicacionOperativaLogic_aplicarCapas/);
    expect(codigo).not.toMatch(/ubicacionOperativaLogic_(aplicarOverlay|componerPunto|resolverPuntoDataset|normalizar|indexar)/);
    expect(codigo).not.toMatch(/\.estado\s*===\s*'[DCRVN]'|estado:\s*'[DCRVN]'/);
    expect(codigo).not.toMatch(/lat\b.*lon\b.*Mendoza|coordenadaValida/);
  });
});

describe('rendimiento (humo, umbral generoso)', () => {
  test('13.804 puntos + 1.000 entradas registrales + 1.000 de campo a traves de mapaDataset_obtener: carga muy por debajo de 1 s; la segunda es instantanea y de la misma referencia', async () => {
    const pozos = [];
    for (let i = 0; i < 13804; i += 1) { pozos.push(pozo(String(1 + (i % 19)).padStart(2, '0') + '-' + String(1000 + Math.floor(i / 19)).padStart(4, '0'), -33.3 - i * 0.00001, -69.1, i % 8 === 0 ? 'C' : 'D')); }
    const reg = [];
    const campo = [];
    for (let i = 0; i < 1000; i += 1) {
      reg.push(i % 5 === 0 ? { wellId: pozos[i * 7].wellId, estado: 'N' } : { wellId: pozos[i * 7].wellId, estado: 'R', lat: -33.3 - i * 0.00002, lon: -69.2 });
      campo.push({ wellId: pozos[i * 7 + 3].wellId, lat: -33.31, lon: -69.11, vts: T });
    }
    instalar({ pozos, registral: () => Promise.resolve(respReg(reg)), campo: () => Promise.resolve(respCampo(campo)) });
    const t0 = process.hrtime.bigint();
    const a = await obtener();
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    expect(ms).toBeLessThan(1000);
    expect(a.data.operativo.quitados).toBe(200);
    expect(a.data.pozos.length).toBe(13804 - 200);
    const t1 = process.hrtime.bigint();
    const b = await obtener();
    expect(Number(process.hrtime.bigint() - t1) / 1e6).toBeLessThan(50);
    expect(b).toBe(a);
  });
});
