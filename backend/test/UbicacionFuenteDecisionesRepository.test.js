// Repositorio de la hoja UbicacionFuenteDecisiones: esquema, setup idempotente y fail-closed, lectura, escritura append-only (una fila, texto plano, ISO UTC) y lock.
const { armar, P_REPORTE } = require('./decisionesFuentesHelper');
const { crearHoja } = require('./fakeSheets');

let t;
let Repo;
beforeEach(() => { t = armar(); Repo = t.Repo; });
afterEach(() => { jest.restoreAllMocks(); });

const COLUMNAS = ['decisionId', 'secuencia', 'wellId', 'fuenteTipo', 'x', 'y', 'evento', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista', 'padronPeriodo'];
const decision = (extra) => ({
  decisionId: '11111111-1111-4111-8111-111111111111', secuencia: 1, wellId: '14-0001', fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: 'ACEPTADA', motivo: '',
  email: 'val@x.com', nombre: 'Valeria', timestampUtc: '2026-10-14T14:32:10.123Z', clientRequestId: 'req-000001', versionVista: 0, padronPeriodo: '2026-09', ...(extra || {})
});

describe('esquema', () => {
  test('14 columnas exactas, en este orden (las minimas para auditar y derivar)', () => {
    expect(Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS).toEqual(COLUMNAS);
    expect(Repo.UBICACION_FUENTE_DECISIONES_HOJA).toBe('UbicacionFuenteDecisiones');
  });

  test('no hay columnas heredadas de la propuesta vieja: ni SUPERADA / REEVALUADA / causaDecisionId, ni lat/lon, ni etiqueta, ni clave, ni resultado', () => {
    ['causaDecisionId', 'lat', 'lon', 'etiquetaFuente', 'fuenteKey', 'clave', 'resultadoLat', 'resultadoLon', 'resultadoEstado'].forEach((c) => {
      expect(Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS).not.toContain(c);
    });
  });

  test('planEsquema: correcto, con columnas de mas, reordenado (OK) y con faltantes o repetidas (rechazado)', () => {
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS).ok).toBe(true);
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS.concat(['notas'])).ok).toBe(true);
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS.slice().reverse()).ok).toBe(true);
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS.map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    const falta = Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS.filter((c) => c !== 'versionVista'));
    expect(falta).toMatchObject({ ok: false, faltantes: ['versionVista'] });
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(COLUMNAS.concat(['x'])).ok).toBe(false);
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema([]).ok).toBe(false);
    expect(Repo.ubicacionFuenteDecisionesRepository_planEsquema(null).faltantes).toHaveLength(14);
  });

  test('formatos: texto plano salvo secuencia, x, y y versionVista', () => {
    expect(Repo.UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS).toEqual({ secuencia: '0', x: '0.000', y: '0.000', versionVista: '0' });
  });
});

describe('setupUbicacionFuenteDecisionesSheet', () => {
  test('crea la hoja con el encabezado exacto y la fila 1 congelada; no escribe filas de datos', () => {
    const t2 = armar({ sinHoja: true });
    expect(t2.Repo.setupUbicacionFuenteDecisionesSheet()).toBe('CREADA');
    const h = t2.hojas.UbicacionFuenteDecisiones;
    expect(h.filas).toEqual([COLUMNAS]);
    expect(h.congeladas).toBe(1);
  });

  test('es idempotente: la segunda vez no crea nada, no toca el encabezado ni las filas', () => {
    const t2 = armar({ sinHoja: true });
    t2.Repo.setupUbicacionFuenteDecisionesSheet();
    t2.hojas.UbicacionFuenteDecisiones.filas.push(['dato', 1]);
    const antes = JSON.stringify(t2.hojas.UbicacionFuenteDecisiones.filas);
    expect(t2.Repo.setupUbicacionFuenteDecisionesSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(t2.hojas.UbicacionFuenteDecisiones.filas)).toBe(antes);
    expect(Object.keys(t2.hojas)).toEqual(['UbicacionFuenteDecisiones']);
  });

  test('una hoja existente correcta con filas: no se modifica nada (ni reordena ni borra)', () => {
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision());
    const antes = JSON.stringify(t.hojas.UbicacionFuenteDecisiones.filas);
    expect(Repo.setupUbicacionFuenteDecisionesSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(t.hojas.UbicacionFuenteDecisiones.filas)).toBe(antes);
  });

  test('fail-closed: una hoja existente con otro esquema LANZA y no se toca', () => {
    const t2 = armar({ sinHoja: true });
    t2.hojas.UbicacionFuenteDecisiones = crearHoja('UbicacionFuenteDecisiones', [['decisionId', 'secuencia', 'otraCosa'], ['a', 1, 'b']]);
    const original = JSON.stringify(t2.hojas.UbicacionFuenteDecisiones.filas);
    expect(() => t2.Repo.setupUbicacionFuenteDecisionesSheet()).toThrow(/esquema inesperado/);
    expect(JSON.stringify(t2.hojas.UbicacionFuenteDecisiones.filas)).toBe(original);
  });

  test('fail-closed: una hoja existente completamente vacia LANZA (no se improvisa un encabezado sobre algo ajeno)', () => {
    const t2 = armar({ sinHoja: true });
    t2.hojas.UbicacionFuenteDecisiones = crearHoja('UbicacionFuenteDecisiones', []);
    expect(() => t2.Repo.setupUbicacionFuenteDecisionesSheet()).toThrow(/vacia/);
    expect(t2.hojas.UbicacionFuenteDecisiones.filas).toEqual([]);
  });

  test('no toca ninguna otra hoja', () => {
    const t2 = armar({ sinHoja: true });
    t2.hojas.Usuarios = crearHoja('Usuarios', [['email'], ['a@x.com']]);
    t2.Repo.setupUbicacionFuenteDecisionesSheet();
    expect(t2.hojas.Usuarios.filas).toEqual([['email'], ['a@x.com']]);
  });

  test('NO se ejecuta sola: ningun otro archivo de backend/src la invoca', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'src');
    fs.readdirSync(dir).filter((f) => f !== 'UbicacionFuenteDecisionesRepository.js').forEach((f) => {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/setupUbicacionFuenteDecisionesSheet\s*\(/);
    });
  });
});

describe('hoja inexistente o con esquema roto: fail-closed (nunca se escribe)', () => {
  test('sin hoja: leer y escribir lanzan con una indicacion de que correr', () => {
    const t2 = armar({ sinHoja: true });
    expect(() => t2.Repo.ubicacionFuenteDecisionesRepository_listar()).toThrow(/setupUbicacionFuenteDecisionesSheet/);
    expect(() => t2.Repo.ubicacionFuenteDecisionesRepository_agregar(decision())).toThrow(/No existe una hoja/);
    expect(Object.keys(t2.hojas)).toEqual([]);
  });

  test('esquema roto: lanza y no escribe', () => {
    t.hojas.UbicacionFuenteDecisiones.filas[0] = COLUMNAS.filter((c) => c !== 'motivo');
    expect(() => Repo.ubicacionFuenteDecisionesRepository_agregar(decision())).toThrow(/esquema esperado/);
    expect(t.hojas.UbicacionFuenteDecisiones.filas).toHaveLength(1);
  });

  test('hoja sin encabezado: lanza', () => {
    t.hojas.UbicacionFuenteDecisiones.filas.length = 0;
    expect(() => Repo.ubicacionFuenteDecisionesRepository_listar()).toThrow(/no tiene encabezado/);
  });
});

describe('lectura', () => {
  test('hoja vacia -> []', () => {
    expect(Repo.ubicacionFuenteDecisionesRepository_listar()).toEqual([]);
  });

  test('lee las filas tal cual (numeros como numeros, textos recortados)', () => {
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision({ motivo: '  con espacios  ' }));
    const [d] = Repo.ubicacionFuenteDecisionesRepository_listar();
    expect(d).toEqual({ ...decision(), motivo: 'con espacios' });
    expect(typeof d.secuencia).toBe('number');
    expect(typeof d.x).toBe('number');
  });

  test('una fila TOTALMENTE vacia se salta; una a medias NO (el dominio la marcara corrupta)', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    h.filas.push(COLUMNAS.map(() => ''));
    h.filas.push(COLUMNAS.map((c) => (c === 'wellId' ? '14-0001' : '')));
    const lista = Repo.ubicacionFuenteDecisionesRepository_listar();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ wellId: '14-0001', secuencia: null, x: null, evento: '' });
  });

  test('valores numericos rotos -> null (no se inventan); coma decimal se acepta', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    const f = COLUMNAS.map(() => '');
    f[COLUMNAS.indexOf('secuencia')] = 'abc';
    f[COLUMNAS.indexOf('x')] = '2486460,782';
    f[COLUMNAS.indexOf('y')] = Infinity;
    f[COLUMNAS.indexOf('wellId')] = '14-0001';
    h.filas.push(f);
    const [d] = Repo.ubicacionFuenteDecisionesRepository_listar();
    expect(d.secuencia).toBeNull();
    expect(d.x).toBe(2486460.782);
    expect(d.y).toBeNull();
  });

  test('columnas reordenadas a mano: se leen por el texto del encabezado', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    const orden = COLUMNAS.slice().reverse();
    h.filas[0] = orden;
    h.filas.push(orden.map((c) => decision()[c]));
    const [d] = Repo.ubicacionFuenteDecisionesRepository_listar();
    expect(d).toEqual(decision());
  });

  test('un timestamp que Sheets convirtio en fecha se lee igual (ISO UTC)', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    h.filas.push(COLUMNAS.map((c) => (c === 'timestampUtc' ? new Date('2026-10-14T14:32:10.123Z') : (c === 'wellId' ? '14-0001' : ''))));
    expect(Repo.ubicacionFuenteDecisionesRepository_listar()[0].timestampUtc).toBe('2026-10-14T14:32:10.123Z');
  });
});

describe('escritura (append-only)', () => {
  test('agrega UNA fila al final con el timestamp ISO UTC como TEXTO', () => {
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision());
    const filas = t.filas();
    expect(filas).toHaveLength(1);
    expect(filas[0]).toEqual(COLUMNAS.map((c) => decision()[c]));
    expect(t.fila(0).timestampUtc).toBe('2026-10-14T14:32:10.123Z');
    expect(typeof t.fila(0).timestampUtc).toBe('string');
    expect(t.fila(0).timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('nunca modifica ni borra filas existentes: cada escritura solo agrega', () => {
    for (let i = 1; i <= 4; i += 1) { Repo.ubicacionFuenteDecisionesRepository_agregar(decision({ secuencia: i, clientRequestId: 'req-00000' + i })); }
    const antes = JSON.stringify(t.filas().slice(0, 3));
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision({ secuencia: 5, clientRequestId: 'req-000005' }));
    expect(JSON.stringify(t.filas().slice(0, 3))).toBe(antes);
    expect(t.filas()).toHaveLength(5);
  });

  test('formatos: todo texto plano (@) menos secuencia, x, y y versionVista; el motivo con "=" no se evalua', () => {
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision({ motivo: '=1+1', nombre: '+cmd', email: '-x@y.com' }));
    const h = t.hojas.UbicacionFuenteDecisiones;
    const fmt = (c) => h.formatos['2:' + (COLUMNAS.indexOf(c) + 1)];
    COLUMNAS.forEach((c) => {
      const esperado = Repo.UBICACION_FUENTE_DECISIONES_FORMATOS_NUMERICOS[c] || '@';
      expect(fmt(c)).toBe(esperado);
    });
    expect(t.fila(0).motivo).toBe('=1+1');             // guardado como cadena literal, nunca como formula
    expect(fmt('motivo')).toBe('@');
    expect(fmt('timestampUtc')).toBe('@');
  });

  test('respeta el orden REAL de las columnas de la hoja', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    h.filas[0] = COLUMNAS.slice().reverse();
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision());
    expect(Repo.ubicacionFuenteDecisionesRepository_listar()[0]).toEqual(decision());
  });

  test('un valor vacio queda como celda vacia', () => {
    Repo.ubicacionFuenteDecisionesRepository_agregar(decision({ motivo: '', padronPeriodo: null }));
    expect(t.fila(0).motivo).toBe('');
    expect(t.fila(0).padronPeriodo).toBe('');
  });
});

describe('lock', () => {
  test('ejecuta la funcion, devuelve su resultado y libera siempre', () => {
    expect(Repo.ubicacionFuenteDecisionesRepository_conLock(() => 42)).toBe(42);
    expect(t.locks).toEqual({ tomados: 1, liberados: 1 });
  });

  test('si la funcion lanza, el lock se libera igual y el error se propaga', () => {
    expect(() => Repo.ubicacionFuenteDecisionesRepository_conLock(() => { throw new Error('boom'); })).toThrow('boom');
    expect(t.locks).toEqual({ tomados: 1, liberados: 1 });
  });

  test('si no se puede tomar el lock, no se ejecuta nada ni se libera algo que no se tomo', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout'); }, releaseLock: jest.fn() }) };
    const fn = jest.fn();
    expect(() => Repo.ubicacionFuenteDecisionesRepository_conLock(fn)).toThrow('timeout');
    expect(fn).not.toHaveBeenCalled();
  });

  test('el timeout es el mismo que el de las correcciones (10 s)', () => {
    expect(Repo.UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS).toBe(t.Repo.UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS);
    expect(Repo.UBICACION_FUENTE_DECISIONES_LOCK_TIMEOUT_MS).toBe(10000);
  });
});
