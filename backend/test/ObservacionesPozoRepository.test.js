// ObservacionesPozoRepository (E5-1): la hoja ObservacionesPozo, su esquema fail-closed, el setup explicito, la seleccion de filas de un pozo y la estrategia de lectura en lotes
// (cuantas llamadas a Sheets y cuantas celdas se leen). Hoja en memoria; no se escribe nada salvo en el setup.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let R;
let hojas;

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  R = require('../src/ObservacionesPozoRepository');
  Object.assign(global, R);
});

const CONSTANTES = require('../src/ObservacionesPozoRepository');
const COLUMNAS = CONSTANTES.OBSERVACIONES_POZO_COLUMNAS;          // constante: sirve antes de armar el entorno (test.each)
const COLS = () => COLUMNAS;
const fila = (o) => COLS().map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-' + n }, extra || {}));
const anula = (n, id, extra) => fila(Object.assign({ observacionId: uuid(id), evento: 'ANULADA', wellId: W, motivo: 'error', email: 'val@x.com', nombre: 'Val', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-a-' + n }, extra || {}));
const armar = (filas, header) => { hojas = instalarSheetsFalsos({ ObservacionesPozo: [header || COLS()].concat(filas || []) }); return hojas.ObservacionesPozo; };

// instrumenta la hoja: cuantas lecturas (getValues) y cuantas celdas se leyeron
function instrumentar(hoja) {
  const reg = { lecturas: [], celdas: 0 };
  const original = hoja.getRange.bind(hoja);
  hoja.getRange = (fila0, col, nFilas, nCols) => {
    const rango = original(fila0, col, nFilas, nCols);
    const gv = rango.getValues.bind(rango);
    rango.getValues = () => { reg.lecturas.push({ fila: fila0, col: col, nFilas: nFilas, nCols: nCols }); reg.celdas += nFilas * nCols; return gv(); };
    return rango;
  };
  return reg;
}

describe('esquema: 11 columnas, en este orden', () => {
  test('el orden exacto del esquema', () => {
    expect(R.OBSERVACIONES_POZO_COLUMNAS).toEqual(['observacionId', 'evento', 'wellId', 'texto', 'categoria', 'motivo', 'email', 'nombre', 'timestampUtc', 'secuencia', 'clientRequestId']);
    expect(R.OBSERVACIONES_POZO_HOJA).toBe('ObservacionesPozo');
    expect(R.OBSERVACIONES_POZO_EVENTOS).toEqual(['ALTA', 'ANULADA']);
  });

  test('no hay columna de estado (se deriva de los eventos)', () => {
    expect(R.OBSERVACIONES_POZO_COLUMNAS).not.toContain('estado');
  });

  test('planEsquema: valido, reordenado y con mayusculas/espacios; faltantes y repetidas', () => {
    expect(R.observacionesPozoRepository_planEsquema(COLS())).toEqual({ ok: true, faltantes: [], repetidas: [] });
    expect(R.observacionesPozoRepository_planEsquema(COLS().slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    const sinTexto = COLS().filter((c) => c !== 'texto');
    expect(R.observacionesPozoRepository_planEsquema(sinTexto)).toMatchObject({ ok: false, faltantes: ['texto'] });
    expect(R.observacionesPozoRepository_planEsquema(COLS().concat(['wellId']))).toMatchObject({ ok: false, repetidas: ['wellId'] });
    expect(R.observacionesPozoRepository_planEsquema(null).ok).toBe(false);
  });
});

describe('hoja: inexistente, encabezado faltante y valida (fail-closed; nada se crea sola)', () => {
  test('hoja inexistente: LANZA y NO se crea', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow(/No existe una hoja llamada "ObservacionesPozo"/);
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('hoja vacia (sin encabezado): LANZA y no se toca', () => {
    armar([], []);
    hojas.ObservacionesPozo.filas = [];
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow(/no tiene encabezado/);
    expect(hojas.ObservacionesPozo.filas).toEqual([]);
  });

  test.each(COLS().map((c) => [c]))('falta la columna %s: LANZA con el esquema inesperado', (columna) => {
    armar([alta(1)], COLS().filter((c) => c !== columna));
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow(/no tiene el esquema esperado \(faltan: /);
  });

  test('columna repetida: LANZA', () => {
    armar([], COLS().concat(['texto']));
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow(/repetidas: texto/);
  });

  test('encabezados validos: lee; con las columnas en otro orden tambien (se buscan por el texto del encabezado)', () => {
    armar([alta(1)]);
    expect(R.observacionesPozoRepository_listarEventosDelPozo(W).eventos).toHaveLength(1);
    const invertido = COLS().slice().reverse();
    armar([invertido.map((c) => alta(1)[COLS().indexOf(c)])], invertido);
    const e = R.observacionesPozoRepository_listarEventosDelPozo(W).eventos;
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ observacionId: uuid(1), evento: 'ALTA', wellId: W, texto: 'Texto 1', secuencia: 1 });
  });

  test('una lectura NO escribe nada (ni la hoja ni el encabezado)', () => {
    const hoja = armar([alta(1), anula(2, 1)]);
    const antes = JSON.stringify(hoja.filas);
    R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(JSON.stringify(hoja.filas)).toBe(antes);
    expect(hoja.formatos).toEqual({});
  });
});

describe('setupObservacionesPozoSheet: explicito e idempotente', () => {
  test('crea la hoja con los 11 encabezados y la fila congelada', () => {
    hojas = instalarSheetsFalsos({});
    expect(R.setupObservacionesPozoSheet()).toBe('CREADA');
    expect(hojas.ObservacionesPozo.filas).toEqual([COLS()]);
    expect(hojas.ObservacionesPozo.congeladas).toBe(1);
  });

  test('si ya existe con el esquema correcto: no la toca (ni una fila)', () => {
    const hoja = armar([alta(1)]);
    const antes = JSON.stringify(hoja.filas);
    expect(R.setupObservacionesPozoSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(hoja.filas)).toBe(antes);
  });

  test('si existe con un esquema inesperado o vacia: falla y no modifica nada', () => {
    const hoja = armar([], COLS().filter((c) => c !== 'secuencia'));
    const antes = JSON.stringify(hoja.filas);
    expect(() => R.setupObservacionesPozoSheet()).toThrow(/esquema inesperado/);
    expect(JSON.stringify(hoja.filas)).toBe(antes);
    hoja.filas = [];
    expect(() => R.setupObservacionesPozoSheet()).toThrow(/esta vacia/);
  });

  test('NO se ejecuta durante una lectura normal (la lectura de una hoja ausente no la crea)', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow();
    expect(hojas.ObservacionesPozo).toBeUndefined();
  });
});

describe('seleccion de filas de un pozo', () => {
  const id = (n, evento, wellId) => ({ observacionId: uuid(n), evento: evento, wellId: wellId });
  const sel = (identidades) => R.observacionesPozoRepository_filasDeInteres(identidades, W);

  test('las filas del pozo (la fila i corresponde a la numero i + 2) y no las de otro', () => {
    expect(sel([id(1, 'ALTA', W), id(2, 'ALTA', '14-0002'), id(3, 'ALTA', W)])).toEqual([2, 4]);
  });

  test('una ANULADA que referencia una alta del pozo se lee SIEMPRE, aunque su wellId este vacio, roto o sea de otro pozo', () => {
    expect(sel([id(1, 'ALTA', W), id(2, 'ALTA', '14-0002'), id(1, 'ANULADA', ''), id(1, 'ANULADA', 'xx'), id(2, 'ANULADA', '14-0002'), id(1, 'ANULADA', '14-0002')])).toEqual([2, 4, 5, 7]);
  });

  test('una ANULADA de una alta de OTRO pozo no se lee; una huerfana con wellId del pozo si (el servicio la descarta)', () => {
    expect(sel([id(2, 'ALTA', '14-0002'), id(2, 'ANULADA', '14-0002'), id(9, 'ANULADA', W)])).toEqual([4]);
  });

  test('una ALTA con el MISMO observacionId en otro pozo (identidad duplicada) tambien se lee: sin leerla no se podria detectar la ambiguedad', () => {
    expect(sel([id(1, 'ALTA', W), id(1, 'ALTA', '14-0002'), id(2, 'ALTA', '14-0002')])).toEqual([2, 3]);
  });

  test('sin filas o entradas nulas: lista vacia', () => {
    expect(sel([])).toEqual([]);
    expect(sel(null)).toEqual([]);
    expect(sel([null, id(1, 'ALTA', W)])).toEqual([3]);
  });
});

describe('planificarLectura: pocos rangos, nunca una llamada por fila', () => {
  const plan = (filas, gap, max) => R.observacionesPozoRepository_planificarLectura(filas, gap, max);

  test('vacio -> sin rangos; una fila -> un rango', () => {
    expect(plan([], 40, 5)).toEqual([]);
    expect(plan([7], 40, 5)).toEqual([{ desde: 7, hasta: 7 }]);
  });

  test('filas consecutivas o separadas por hasta gapMax se unen', () => {
    expect(plan([2, 3, 4], 40, 5)).toEqual([{ desde: 2, hasta: 4 }]);
    expect(plan([2, 43], 40, 5)).toEqual([{ desde: 2, hasta: 43 }]);                 // 40 filas de hueco: se une
    expect(plan([2, 44], 40, 5)).toEqual([{ desde: 2, hasta: 2 }, { desde: 44, hasta: 44 }]);   // 41: no
  });

  test('si quedan mas de maxRangos, se unen primero los huecos mas chicos hasta llegar al tope', () => {
    const filas = [10, 100, 120, 1000, 1010, 5000];
    const rangos = plan(filas, 0, 3);
    expect(rangos).toHaveLength(3);
    expect(rangos).toEqual([{ desde: 10, hasta: 120 }, { desde: 1000, hasta: 1010 }, { desde: 5000, hasta: 5000 }]);
    expect(plan(filas, 0, 1)).toEqual([{ desde: 10, hasta: 5000 }]);
    expect(plan(filas, 0, 0)).toHaveLength(1);                                       // un tope invalido se toma como 1
  });

  test('con muchas filas dispersas nunca supera el tope, y siempre cubre todas las filas', () => {
    const filas = [];
    for (let i = 0; i < 200; i += 1) { filas.push(2 + i * 997); }
    const rangos = plan(filas, R.OBSERVACIONES_POZO_GAP_MAX, R.OBSERVACIONES_POZO_MAX_RANGOS);
    expect(rangos.length).toBeLessThanOrEqual(R.OBSERVACIONES_POZO_MAX_RANGOS);
    filas.forEach((f) => expect(rangos.some((r) => f >= r.desde && f <= r.hasta)).toBe(true));
  });
});

describe('lectura por pozo: contenido y modos', () => {
  test('hoja sin filas de datos: lista vacia (no es un error)', () => {
    armar([]);
    expect(R.observacionesPozoRepository_listarEventosDelPozo(W)).toMatchObject({ eventos: [], modo: 'VACIA' });
  });

  test('un pozo sin filas en una hoja con datos de otros: lista vacia', () => {
    armar([alta(1, { wellId: '14-0002' })]);
    expect(R.observacionesPozoRepository_listarEventosDelPozo(W).eventos).toEqual([]);
  });

  test('normaliza: id en minuscula, evento en mayuscula, email en minuscula, fecha de Sheets (Date) a ISO, secuencia numerica o texto', () => {
    armar([
      alta(1, { observacionId: uuid(1).toUpperCase(), evento: ' alta ', email: ' ANA@X.COM ', timestampUtc: new Date('2026-10-20T15:00:00.000Z'), secuencia: '7' }),
      alta(2, { secuencia: 'abc', timestampUtc: 'no-es-fecha' })
    ]);
    const e = R.observacionesPozoRepository_listarEventosDelPozo(W).eventos;
    expect(e[0]).toMatchObject({ observacionId: uuid(1), evento: 'ALTA', email: 'ana@x.com', timestampUtc: '2026-10-20T15:00:00.000Z', secuencia: 7, fila: 2 });
    expect(e[1]).toMatchObject({ secuencia: null, timestampUtc: 'no-es-fecha', fila: 3 });          // no se corrige en silencio: lo marca el servicio
  });

  test('una fila totalmente vacia no es un evento; las filas a medias si se leen (las marca el servicio)', () => {
    armar([alta(1), ['', '', '', '', '', '', '', '', '', '', ''], fila({ wellId: W })]);
    const e = R.observacionesPozoRepository_listarEventosDelPozo(W).eventos;
    expect(e).toHaveLength(2);
    expect(e[1]).toMatchObject({ wellId: W, observacionId: '', evento: '' });
  });

  test('hoja chica: UNA sola lectura de datos (modo COMPLETA)', () => {
    const hoja = armar([alta(1), alta(2), anula(3, 1)]);
    const reg = instrumentar(hoja);
    const r = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(r.modo).toBe('COMPLETA');
    expect(r.eventos).toHaveLength(3);
    expect(reg.lecturas.filter((l) => l.fila > 1)).toHaveLength(1);                  // el encabezado se lee aparte (fila 1)
  });
});

describe('lectura selectiva (hoja grande): pocas llamadas y las celdas minimas', () => {
  // n filas de relleno de OTROS pozos (con texto largo: lo pesado) y las del pozo repartidas
  function hojaGrande(n, dePozo) {
    const filas = [];
    for (let i = 1; i <= n; i += 1) {
      filas.push(alta(i, { observacionId: uuid(1000000 + i), wellId: '14-' + String(2 + (i % 400)).padStart(4, '0'), texto: 'x'.repeat(200) }));          // ids propios: no chocan con los del pozo
    }
    Object.keys(dePozo || {}).forEach((pos) => { filas[Number(pos)] = dePozo[pos]; });
    return armar(filas);
  }
  const N = CONSTANTES.OBSERVACIONES_POZO_FILAS_LECTURA_COMPLETA + 500;

  test('encuentra exactamente las filas del pozo y las anulaciones que las referencian (incluida una con wellId roto)', () => {
    const hoja = hojaGrande(N, {
      10: alta(9001), 11: alta(9002), 1500: anula(9003, 9001), 2400: anula(9004, 9002, { wellId: '' })
    });
    const r = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(r.modo).toBe('SELECTIVA');
    expect(r.eventos.map((e) => [e.fila, e.evento, e.observacionId])).toEqual([
      [12, 'ALTA', uuid(9001)], [13, 'ALTA', uuid(9002)], [1502, 'ANULADA', uuid(9001)], [2402, 'ANULADA', uuid(9002)]
    ]);
    expect(hoja.filas.length).toBe(N + 1);
  });

  test('llamadas acotadas: encabezado + identidad + a lo sumo MAX_RANGOS lecturas de filas (nunca una por fila)', () => {
    const dePozo = {};
    for (let i = 0; i < 60; i += 1) { dePozo[20 + i * 40 * 2] = alta(8000 + i); }            // 60 filas del pozo dispersas, separadas por mas del hueco
    const hoja = hojaGrande(N + 6000, dePozo);
    const reg = instrumentar(hoja);
    const r = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(r.eventos).toHaveLength(60);
    expect(reg.lecturas.length).toBeLessThanOrEqual(1 + 1 + R.OBSERVACIONES_POZO_MAX_RANGOS);
    expect(r.rangos).toBeLessThanOrEqual(R.OBSERVACIONES_POZO_MAX_RANGOS);
  });

  test('NO lee los textos de todas las filas: se leen 3 columnas de todas y las 11 solo de las filas elegidas', () => {
    const n = 20000;
    const hoja = hojaGrande(n, { 5000: alta(9001), 15000: alta(9002) });
    const reg = instrumentar(hoja);
    R.observacionesPozoRepository_listarEventosDelPozo(W);
    const identidad = reg.lecturas.find((l) => l.nFilas === n);
    expect(identidad.nCols).toBe(3);
    expect(reg.celdas).toBeLessThan(n * 3 + 5 * 41 * 11 + 11 + 1000);                // muy por debajo de n * 11 (lectura completa)
    expect(reg.celdas).toBeLessThan(n * 11 / 3);
  });

  test('100.000 filas: una lectura de identidad (300.000 celdas) en vez de 1.100.000, y el resultado es el correcto', () => {
    const n = 100000;
    const hoja = hojaGrande(n, { 70000: alta(9001), 70001: anula(9002, 9001), 99990: alta(9003) });
    const reg = instrumentar(hoja);
    const r = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(r.eventos.map((e) => e.observacionId)).toEqual([uuid(9001), uuid(9001), uuid(9003)]);
    expect(reg.celdas).toBeLessThan(n * 3 + 2000);
    expect(reg.lecturas.length).toBeLessThanOrEqual(1 + 1 + R.OBSERVACIONES_POZO_MAX_RANGOS);
  });

  test('la hoja cambio entre las dos lecturas (se corrieron las filas): reintenta una vez y devuelve lo correcto', () => {
    const hoja = hojaGrande(N, { 100: alta(9001), 300: alta(9002) });
    const original = hoja.getRange.bind(hoja);
    let corrio = false;
    hoja.getRange = (f, c, nf, nc) => {
      const rango = original(f, c, nf, nc);
      const gv = rango.getValues.bind(rango);
      rango.getValues = () => {
        if (!corrio && c === 1 && nc === 11 && f > 1) {                                // la primera lectura de filas completas: alguien inserto una fila arriba
          corrio = true;
          hoja.filas.splice(1, 0, alta(7777, { wellId: '14-0300' }));
        }
        return gv();
      };
      return rango;
    };
    const r = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(corrio).toBe(true);
    expect(r.eventos.map((e) => e.observacionId)).toEqual([uuid(9001), uuid(9002)]);
  });

  test('si la hoja sigue cambiando: LANZA (nunca datos mezclados)', () => {
    const hoja = hojaGrande(N, { 100: alta(9001) });
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => {
      const rango = original(f, c, nf, nc);
      const gv = rango.getValues.bind(rango);
      rango.getValues = () => {
        if (c === 1 && nc === 11 && f > 1) { hoja.filas.splice(1, 0, alta(7777, { wellId: '14-0300' })); }
        return gv();
      };
      return rango;
    };
    expect(() => R.observacionesPozoRepository_listarEventosDelPozo(W)).toThrow(/cambio mientras se leia/);
  });

  test('la lectura selectiva y la completa dan el MISMO resultado para un mismo contenido', () => {
    const base = [alta(9001), alta(9002), anula(9003, 9001), alta(9004, { wellId: '14-0002' }), anula(9005, 9004, { wellId: '14-0002' }), anula(9006, 9002, { wellId: '' })];
    armar(base);
    const chica = R.observacionesPozoRepository_listarEventosDelPozo(W);
    const relleno = [];
    for (let i = 0; i < N; i += 1) { relleno.push(alta(i + 1, { observacionId: uuid(1000000 + i), wellId: '14-0002' })); }
    armar(base.concat(relleno));
    const grande = R.observacionesPozoRepository_listarEventosDelPozo(W);
    expect(chica.modo).toBe('COMPLETA');
    expect(grande.modo).toBe('SELECTIVA');
    expect(grande.eventos).toEqual(chica.eventos);
  });
});

describe('el repositorio solo agrega ALTAs (E5-2); no anula, edita ni borra', () => {
  test('la unica escritura de eventos es agregarAlta (mas el setup explicito); no hay anular / actualizar / borrar', () => {
    const nombres = Object.keys(R).filter((k) => typeof R[k] === 'function');
    expect(nombres.filter((n) => /agregar|escribir|anular|actualizar|borrar|editar|eliminar/i.test(n))).toEqual(['observacionesPozoRepository_agregarAlta']);
    expect(nombres).toContain('setupObservacionesPozoSheet');
  });

  test('el lock se toma y SIEMPRE se libera', () => {
    const lock = { waits: 0, releases: 0 };
    global.LockService = { getScriptLock: () => ({ waitLock: () => { lock.waits += 1; }, releaseLock: () => { lock.releases += 1; } }) };
    expect(R.observacionesPozoRepository_conLock(() => 7)).toBe(7);
    expect(() => R.observacionesPozoRepository_conLock(() => { throw new Error('x'); })).toThrow('x');
    expect(lock).toEqual({ waits: 2, releases: 2 });
  });
});
