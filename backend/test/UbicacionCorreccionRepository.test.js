// Repositorio de correcciones de ubicacion: esquema EXACTO de las dos hojas, lectura por encabezado (fail-closed si falta una
// columna), ida y vuelta de filas, formato de texto/numeros, escritura contigua, lock siempre liberado y setup que no pisa nada.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Repo;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Repo = require('../src/UbicacionCorreccionRepository');
  Object.assign(global, Repo);
});

const correccion = (extra) => Object.assign({
  correccionId: '11111111-1111-4111-8111-111111111111', wellId: '04-0263', lat: -32.9012, lon: -68.80015, metodo: 'GPS_ACTUAL', precisionGpsM: 8.4,
  observacion: '=SUM(1)', emailPropone: 'ana@x.com', nombrePropone: 'Ana', timestamp: new Date('2026-10-09T12:00:00Z'),
  irrLat: -32.9, irrLon: -68.8, irrEstado: 'unica', irrFuente: 'reportePozos', padronPeriodo: '2026-09', distanciaM: 134.2, advertenciaDistancia: true,
  clientRequestId: 'req-00000001'
}, extra || {});

describe('esquema exacto de las hojas', () => {
  test('UbicacionCorrecciones: 18 columnas = las 17 pedidas + advertenciaDistancia, en este orden', () => {
    expect(Repo.UBICACION_CORRECCIONES_HOJA).toBe('UbicacionCorrecciones');
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS).toHaveLength(18);
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS.filter((c) => c !== 'advertenciaDistancia')).toHaveLength(17);
    expect(Repo.UBICACION_CORRECCIONES_COLUMNAS).toEqual([
      'correccionId', 'wellId', 'lat', 'lon', 'metodo', 'precisionGpsM', 'observacion', 'emailPropone', 'nombrePropone', 'timestamp',
      'irrLat', 'irrLon', 'irrEstado', 'irrFuente', 'padronPeriodo', 'distanciaM', 'advertenciaDistancia', 'clientRequestId'
    ]);
  });

  test('UbicacionCorreccionesLog: 6 columnas', () => {
    expect(Repo.UBICACION_CORRECCIONES_LOG_HOJA).toBe('UbicacionCorreccionesLog');
    expect(Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS).toEqual(['correccionId', 'timestamp', 'evento', 'email', 'nombre', 'motivo']);
    expect(Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS).toHaveLength(6);
  });
});

describe('indice de columnas', () => {
  test('tolera mayusculas, espacios y reordenamiento', () => {
    const header = [' Evento', 'CORRECCIONID', 'timestamp', 'email ', 'nombre', 'motivo'];
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(header, Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS);
    expect(idx).toEqual({ correccionId: 1, timestamp: 2, evento: 0, email: 3, nombre: 4, motivo: 5 });
    expect(Repo.ubicacionCorreccionRepository_columnasFaltantes(idx, Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS)).toEqual([]);
  });

  test('columnas faltantes se informan', () => {
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(['correccionId', 'wellId', 'lat'], Repo.UBICACION_CORRECCIONES_COLUMNAS);
    expect(Repo.ubicacionCorreccionRepository_columnasFaltantes(idx, Repo.UBICACION_CORRECCIONES_COLUMNAS)).toContain('clientRequestId');
    expect(Repo.ubicacionCorreccionRepository_columnasFaltantes(idx, Repo.UBICACION_CORRECCIONES_COLUMNAS)).toContain('advertenciaDistancia');
  });
});

describe('fila <-> objeto', () => {
  const cols = require('../src/UbicacionCorreccionRepository').UBICACION_CORRECCIONES_COLUMNAS;

  test('ida y vuelta: la fila se lee como la misma correccion (timestamp en ISO, numeros numericos, bandera boolean)', () => {
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(cols, cols);
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(correccion(), idx, cols.length, cols);
    expect(Repo.ubicacionCorreccionRepository_correccionDesdeFila(fila, idx)).toEqual(correccion({ timestamp: '2026-10-09T12:00:00.000Z' }));
  });

  test('respeta el orden REAL de las columnas de la hoja y deja vacias las desconocidas', () => {
    const header = ['extra'].concat(cols).concat(['otra']);
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(header, cols);
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(correccion(), idx, header.length, cols);
    expect(fila).toHaveLength(header.length);
    expect(fila[0]).toBe('');
    expect(fila[header.length - 1]).toBe('');
    expect(fila[idx.wellId]).toBe('04-0263');
    expect(fila[idx.clientRequestId]).toBe('req-00000001');
  });

  test('valores nulos se escriben como celda vacia y se leen como null (pozo sin coordenada de Irrigacion)', () => {
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(cols, cols);
    const sin = correccion({ irrLat: null, irrLon: null, distanciaM: null, precisionGpsM: null, advertenciaDistancia: false, metodo: 'PUNTO_EN_MAPA' });
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(sin, idx, cols.length, cols);
    expect(fila[idx.irrLat]).toBe('');
    expect(fila[idx.distanciaM]).toBe('');
    expect(fila[idx.advertenciaDistancia]).toBe('');
    const leida = Repo.ubicacionCorreccionRepository_correccionDesdeFila(fila, idx);
    expect(leida).toMatchObject({ irrLat: null, irrLon: null, distanciaM: null, precisionGpsM: null, advertenciaDistancia: false });
  });

  test('numeros que Sheets devuelva como texto (coma decimal) se leen igual; basura da null', () => {
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(cols, cols);
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(correccion(), idx, cols.length, cols);
    fila[idx.lat] = '-32,9012';
    fila[idx.distanciaM] = 'abc';
    const leida = Repo.ubicacionCorreccionRepository_correccionDesdeFila(fila, idx);
    expect(leida.lat).toBe(-32.9012);
    expect(leida.distanciaM).toBeNull();
  });

  test('un timestamp invalido se lee como null (no rompe la lectura)', () => {
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(cols, cols);
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(correccion(), idx, cols.length, cols);
    fila[idx.timestamp] = 'no es fecha';
    expect(Repo.ubicacionCorreccionRepository_correccionDesdeFila(fila, idx).timestamp).toBeNull();
  });

  test('evento: ida y vuelta', () => {
    const lc = Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS;
    const idx = Repo.ubicacionCorreccionRepository_indiceColumnas(lc, lc);
    const ev = { correccionId: 'id-1', timestamp: new Date('2026-10-09T13:00:00Z'), evento: 'VALIDADA', email: 'val@x.com', nombre: 'Valeria', motivo: 'ok' };
    const fila = Repo.ubicacionCorreccionRepository_filaDesdeObjeto(ev, idx, lc.length, lc);
    expect(Repo.ubicacionCorreccionRepository_eventoDesdeFila(fila, idx)).toEqual(Object.assign({}, ev, { timestamp: '2026-10-09T13:00:00.000Z' }));
  });
});

describe('hojas en memoria', () => {
  function hojas(extra) {
    return instalarSheetsFalsos(Object.assign({
      UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS],
      UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS]
    }, extra || {}));
  }
  const ev = (id, evento) => ({ correccionId: id, timestamp: new Date('2026-10-09T13:00:00Z'), evento, email: 'v@x.com', nombre: 'V', motivo: '' });

  test('agregar y listar: append al final, nunca se tocan filas anteriores', () => {
    const h = hojas();
    Repo.ubicacionCorreccionRepository_agregarCorreccion(correccion({ correccionId: 'a' }));
    const primera = h.UbicacionCorrecciones.filas[1].slice();
    Repo.ubicacionCorreccionRepository_agregarCorreccion(correccion({ correccionId: 'b', wellId: '04-0999' }));
    expect(h.UbicacionCorrecciones.filas).toHaveLength(3);
    expect(h.UbicacionCorrecciones.filas[1]).toEqual(primera);
    expect(Repo.ubicacionCorreccionRepository_listarCorrecciones().map((c) => c.correccionId)).toEqual(['a', 'b']);
  });

  test('la observacion se escribe como TEXTO PLANO (nunca como formula) y las coordenadas como numeros con formato fijo', () => {
    const h = hojas();
    Repo.ubicacionCorreccionRepository_agregarCorreccion(correccion());
    const cols = Repo.UBICACION_CORRECCIONES_COLUMNAS;
    const formato = (n) => h.UbicacionCorrecciones.formatos['2:' + (cols.indexOf(n) + 1)];
    expect(formato('observacion')).toBe('@');
    expect(formato('wellId')).toBe('@');
    expect(formato('emailPropone')).toBe('@');
    expect(formato('clientRequestId')).toBe('@');
    expect(formato('lat')).toBe('0.000000');
    expect(formato('irrLon')).toBe('0.000000');
    expect(formato('distanciaM')).toBe('0.0');
    expect(formato('timestamp')).toBe('yyyy-mm-dd hh:mm:ss');
    expect(h.UbicacionCorrecciones.filas[1][cols.indexOf('observacion')]).toBe('=SUM(1)');
    expect(typeof h.UbicacionCorrecciones.filas[1][cols.indexOf('lat')]).toBe('number');
  });

  test('varios eventos se escriben CONTIGUOS con un solo setValues (todo o nada)', () => {
    const h = hojas();
    let llamadas = 0;
    const original = h.UbicacionCorreccionesLog.getRange.bind(h.UbicacionCorreccionesLog);
    h.UbicacionCorreccionesLog.getRange = (f, c, nf, nc) => {
      const r = original(f, c, nf, nc);
      return Object.assign({}, r, { setValues: (v) => { llamadas += 1; return r.setValues(v); } });
    };
    Repo.ubicacionCorreccionRepository_agregarEventos([ev('a', 'SUPERADA'), ev('b', 'VALIDADA')]);
    expect(llamadas).toBe(1);
    expect(Repo.ubicacionCorreccionRepository_listarEventos().map((e) => [e.correccionId, e.evento])).toEqual([['a', 'SUPERADA'], ['b', 'VALIDADA']]);
  });

  test('agregarCorreccionConEvento escribe la correccion y despues su evento; verifica AMBAS hojas antes de escribir la primera', () => {
    const h = hojas();
    Repo.ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion({ correccionId: 'a' }), ev('a', 'PROPUESTA'));
    expect(h.UbicacionCorrecciones.filas).toHaveLength(2);
    expect(h.UbicacionCorreccionesLog.filas).toHaveLength(2);
    // si falta la hoja de log, no se escribe NADA en la de correcciones
    const solo = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS] });
    expect(() => Repo.ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion(), ev('a', 'PROPUESTA'))).toThrow(/UbicacionCorreccionesLog/);
    expect(solo.UbicacionCorrecciones.filas).toHaveLength(1);
    // si al log le falta una columna, tampoco
    const roto = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [['correccionId', 'evento']] });
    expect(() => Repo.ubicacionCorreccionRepository_agregarCorreccionConEvento(correccion(), ev('a', 'PROPUESTA'))).toThrow(/no tiene las columnas/);
    expect(roto.UbicacionCorrecciones.filas).toHaveLength(1);
  });

  test('agregar una lista vacia no escribe nada', () => {
    const h = hojas();
    Repo.ubicacionCorreccionRepository_agregarEventos([]);
    expect(h.UbicacionCorreccionesLog.filas).toHaveLength(1);
  });

  test('filas sin correccionId (hoja con basura) se ignoran al listar', () => {
    const h = hojas();
    h.UbicacionCorrecciones.filas.push(new Array(18).fill(''));
    h.UbicacionCorreccionesLog.filas.push(['', '', '', '', '', '']);
    expect(Repo.ubicacionCorreccionRepository_listarCorrecciones()).toEqual([]);
    expect(Repo.ubicacionCorreccionRepository_listarEventos()).toEqual([]);
  });

  test('FAIL-CLOSED: sin la hoja, o con una columna faltante, o sin encabezado, se lanza error (y no se escribe)', () => {
    instalarSheetsFalsos({});
    expect(() => Repo.ubicacionCorreccionRepository_listarCorrecciones()).toThrow(/setupUbicacionCorreccionesSheets/);
    expect(() => Repo.ubicacionCorreccionRepository_agregarEventos([ev('a', 'PROPUESTA')])).toThrow(/UbicacionCorreccionesLog/);
    const h = instalarSheetsFalsos({ UbicacionCorrecciones: [['correccionId', 'wellId']], UbicacionCorreccionesLog: [] });
    expect(() => Repo.ubicacionCorreccionRepository_listarCorrecciones()).toThrow(/no tiene las columnas/);
    expect(() => Repo.ubicacionCorreccionRepository_agregarCorreccion(correccion())).toThrow(/no tiene las columnas/);
    expect(h.UbicacionCorrecciones.filas).toHaveLength(1);
    expect(() => Repo.ubicacionCorreccionRepository_listarEventos()).toThrow(/no tiene encabezado/);
  });

  test('conLock: toma y libera el lock, devuelve el resultado y libera aunque falle', () => {
    let waits = 0;
    let releases = 0;
    global.LockService = { getScriptLock: () => ({ waitLock: (ms) => { waits += 1; expect(ms).toBe(10000); }, releaseLock: () => { releases += 1; } }) };
    expect(Repo.ubicacionCorreccionRepository_conLock(() => 42)).toBe(42);
    expect(() => Repo.ubicacionCorreccionRepository_conLock(() => { throw new Error('boom'); })).toThrow('boom');
    expect({ waits, releases }).toEqual({ waits: 2, releases: 2 });
  });

  test('si no se consigue el lock, se propaga el error y no se ejecuta nada', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('Lock timeout'); }, releaseLock: () => { throw new Error('no se debe liberar'); } }) };
    const fn = jest.fn();
    expect(() => Repo.ubicacionCorreccionRepository_conLock(fn)).toThrow('Lock timeout');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('setupUbicacionCorreccionesSheets', () => {
  test('crea las dos hojas con su encabezado exacto, fila 1 congelada', () => {
    const h = instalarSheetsFalsos({});
    Repo.setupUbicacionCorreccionesSheets();
    expect(h.UbicacionCorrecciones.filas).toEqual([Repo.UBICACION_CORRECCIONES_COLUMNAS]);
    expect(h.UbicacionCorreccionesLog.filas).toEqual([Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS]);
    expect(h.UbicacionCorrecciones.congeladas).toBe(1);
    expect(h.UbicacionCorreccionesLog.congeladas).toBe(1);
  });

  test('no toca una hoja que ya existe, y NUNCA modifica la hoja Usuarios', () => {
    const usuarios = [['email', 'nombre', 'estado', 'ubicacion'], ['a@x.com', 'A', 'activo', 'SI']];
    const h = instalarSheetsFalsos({ Usuarios: usuarios, UbicacionCorrecciones: [['lo-que-sea']] });
    Repo.setupUbicacionCorreccionesSheets();
    expect(h.UbicacionCorrecciones.filas).toEqual([['lo-que-sea']]);
    expect(h.UbicacionCorreccionesLog.filas).toEqual([Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS]);
    expect(h.Usuarios.filas).toEqual(usuarios);
  });

  test('es idempotente: correrlo dos veces no duplica ni modifica nada', () => {
    const h = instalarSheetsFalsos({});
    Repo.setupUbicacionCorreccionesSheets();
    Repo.setupUbicacionCorreccionesSheets();
    expect(h.UbicacionCorrecciones.filas).toHaveLength(1);
    expect(h.UbicacionCorreccionesLog.filas).toHaveLength(1);
  });
});
