// FotosPozoEventosRepository (E8-2): la hoja FotosPozoEventos (futura), su esquema fail-closed, la lectura completa / por foto / de solicitudes sin resolver, la busqueda por
// (usuario, clientRequestId), la secuencia global y la escritura. Hoja en memoria; la hoja NO existe en produccion: ninguna lectura la crea y el setup solo corre a mano.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let R;
let hojas;

const ISO = '2026-10-27T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const FOTO = uuid(1);

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  R = require('../src/FotosPozoEventosRepository');
  Object.assign(global, R);
});

const COLUMNAS = require('../src/FotosPozoEventosRepository').FOTOS_POZO_EVENTOS_COLUMNAS;
const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const evento = (n, extra) => fila(Object.assign({
  eventoId: uuid(100 + n), secuencia: n, evento: 'RETIRADA', fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', email: 'mod@x.com', nombre: 'Mod',
  timestampUtc: ISO, clientRequestId: 'req-' + String(n).padStart(8, '0')
}, extra || {}));
const armar = (filas, header) => { hojas = instalarSheetsFalsos({ FotosPozoEventos: [header || COLUMNAS].concat(filas || []) }); return hojas.FotosPozoEventos; };

describe('esquema: 14 columnas, en este orden', () => {
  test('el orden exacto y el nombre de la hoja', () => {
    expect(R.FOTOS_POZO_EVENTOS_COLUMNAS).toEqual([
      'eventoId', 'secuencia', 'evento', 'fotoId', 'entidadTipo', 'entidadId', 'solicitudId', 'resolucion', 'motivoCodigo', 'motivoTexto', 'email', 'nombre', 'timestampUtc', 'clientRequestId'
    ]);
    expect(R.FOTOS_POZO_EVENTOS_HOJA).toBe('FotosPozoEventos');
  });

  test('no hay columna de estado (se deriva) ni payloads, ids de Drive, URLs ni imagen', () => {
    const texto = R.FOTOS_POZO_EVENTOS_COLUMNAS.join(',').toLowerCase();
    ['estado', 'drive', 'url', 'base64', 'imagen', 'payload', 'coord'].forEach((x) => { expect(texto).not.toContain(x); });
  });

  test('planEsquema: valido, reordenado y con mayusculas/espacios; faltantes y repetidas', () => {
    expect(R.fotosPozoEventosRepository_planEsquema(COLUMNAS)).toEqual({ ok: true, faltantes: [], repetidas: [] });
    expect(R.fotosPozoEventosRepository_planEsquema(COLUMNAS.slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    expect(R.fotosPozoEventosRepository_planEsquema(COLUMNAS.filter((c) => c !== 'resolucion'))).toMatchObject({ ok: false, faltantes: ['resolucion'] });
    expect(R.fotosPozoEventosRepository_planEsquema(COLUMNAS.concat(['fotoId']))).toMatchObject({ ok: false, repetidas: ['fotoId'] });
    expect(R.fotosPozoEventosRepository_planEsquema(null).ok).toBe(false);
  });
});

describe('hoja: fail-closed y sin autocreacion', () => {
  test('si la hoja no existe, LANZA y NO la crea', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.fotosPozoEventosRepository_leerTodos()).toThrow(/setupFotosPozoEventosSheet/);
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('hoja vacia (sin encabezado) o con esquema inesperado: lanza', () => {
    hojas = instalarSheetsFalsos({ FotosPozoEventos: [] });
    expect(() => R.fotosPozoEventosRepository_leerTodos()).toThrow(/encabezado/);
    armar([], COLUMNAS.filter((c) => c !== 'email'));
    expect(() => R.fotosPozoEventosRepository_leerTodos()).toThrow(/email/);
    armar([], COLUMNAS.concat(['email']));
    expect(() => R.fotosPozoEventosRepository_leerTodos()).toThrow(/repetidas/);
  });

  test('una hoja con las columnas en otro orden se lee bien', () => {
    const header = COLUMNAS.slice().reverse();
    const filaReves = COLUMNAS.slice().reverse().map((c) => evento(1)[COLUMNAS.indexOf(c)]);
    armar([filaReves], header);
    const e = R.fotosPozoEventosRepository_leerTodos().eventos[0];
    expect(e).toMatchObject({ eventoId: uuid(101), evento: 'RETIRADA', fotoId: FOTO, secuencia: 1, entidadTipo: 'WELL', entidadId: '14-0001' });
  });
});

describe('lectura cruda', () => {
  test('eventoDesdeFila: ids y email en minuscula; el resto TAL CUAL (sin pasar a mayuscula)', () => {
    const HEX = (c) => 'abcdef0' + c + '-2345-4abc-8def-0123456789ab';
    armar([evento(1, { eventoId: HEX(1).toUpperCase(), fotoId: HEX(2).toUpperCase(), evento: 'retirada', email: ' MOD@X.com ', motivoCodigo: 'duplicada', solicitudId: HEX(3).toUpperCase() })]);
    expect(R.fotosPozoEventosRepository_leerTodos().eventos[0]).toMatchObject({
      eventoId: HEX(1), fotoId: HEX(2), evento: 'retirada', email: 'mod@x.com', motivoCodigo: 'duplicada', solicitudId: HEX(3), fila: 2
    });
  });

  test('una secuencia vacia o no numerica se lee como null (la derivacion la marca invalida); un texto de digitos se lee como numero', () => {
    armar([evento(1, { secuencia: '' }), evento(2, { secuencia: 'x' }), evento(3, { secuencia: '7' }), evento(4, { secuencia: 8 })]);
    expect(R.fotosPozoEventosRepository_leerTodos().eventos.map((e) => e.secuencia)).toEqual([null, null, 7, 8]);
  });

  test('timestamp: texto ISO tal cual; una Date (Sheets lo convirtio) vuelve a ISO', () => {
    armar([evento(1), evento(2, { timestampUtc: new Date(ISO) })]);
    expect(R.fotosPozoEventosRepository_leerTodos().eventos.map((e) => e.timestampUtc)).toEqual([ISO, ISO]);
  });

  test('leerTodos: filas en orden, con numero de fila; salta las filas totalmente vacias; UNA sola lectura de la hoja', () => {
    const hoja = armar([evento(1), fila({}), evento(2)]);
    let lecturas = 0;
    const original = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { lecturas += 1; return original(); };
    const todos = R.fotosPozoEventosRepository_leerTodos().eventos;
    expect(todos.map((e) => [e.fila, e.secuencia])).toEqual([[2, 1], [4, 2]]);
    expect(lecturas).toBe(1);
  });

  test('hoja con solo encabezado: sin eventos', () => {
    armar([]);
    expect(R.fotosPozoEventosRepository_leerTodos().eventos).toEqual([]);
  });
});

describe('lectura por foto y solicitudes sin resolver', () => {
  test('listarPorFoto: eventos de la foto + resoluciones que apuntan a una solicitud de la foto (aunque su fotoId este roto o sea de otra)', () => {
    armar([
      evento(1, { evento: 'RETIRO_SOLICITADO', eventoId: uuid(201) }),
      evento(2, { evento: 'RETIRO_RESUELTO', fotoId: uuid(9), solicitudId: uuid(201), resolucion: 'APROBADO', motivoCodigo: '' }),
      evento(3, { evento: 'RETIRO_RESUELTO', fotoId: '', solicitudId: uuid(201), resolucion: 'RECHAZADO', motivoCodigo: '' }),
      evento(4, { fotoId: uuid(2) }),
      evento(5, { evento: 'RETIRO_RESUELTO', fotoId: uuid(2), solicitudId: uuid(999), resolucion: 'APROBADO', motivoCodigo: '' })
    ]);
    expect(R.fotosPozoEventosRepository_listarPorFoto(FOTO).eventos.map((e) => e.secuencia)).toEqual([1, 2, 3]);
    expect(R.fotosPozoEventosRepository_listarPorFoto(uuid(2)).eventos.map((e) => e.secuencia)).toEqual([4, 5]);
    expect(R.fotosPozoEventosRepository_listarPorFoto(uuid(77)).eventos).toEqual([]);
  });

  test('listarSolicitudesSinResolver: las RETIRO_SOLICITADO que ninguna resolucion referencia (lectura cruda)', () => {
    armar([
      evento(1, { evento: 'RETIRO_SOLICITADO', eventoId: uuid(201) }),
      evento(2, { evento: 'RETIRO_SOLICITADO', eventoId: uuid(202), fotoId: uuid(2) }),
      evento(3, { evento: 'RETIRO_RESUELTO', solicitudId: uuid(201), resolucion: 'RECHAZADO', motivoCodigo: '' }),
      evento(4)
    ]);
    expect(R.fotosPozoEventosRepository_listarSolicitudesSinResolver().eventos.map((e) => e.eventoId)).toEqual([uuid(202)]);
  });
});

describe('secuencia global (fail-closed)', () => {
  const calc = R => R.fotosPozoEventosRepository_calcularSiguienteSecuencia;
  test('hoja vacia -> 1; max + 1; se saltan las filas totalmente vacias', () => {
    expect(calc(R)([], [])).toEqual({ ok: true, siguiente: 1 });
    expect(calc(R)(['a', 'b'], [3, 7])).toEqual({ ok: true, siguiente: 8 });
    expect(calc(R)(['a', '', 'b'], [1, '', 2])).toEqual({ ok: true, siguiente: 3 });
  });

  test('secuencia como texto de solo digitos vale', () => {
    expect(calc(R)(['a'], ['5'])).toEqual({ ok: true, siguiente: 6 });
  });

  test.each([[1.5], [0], [-1], ['x'], ['1.5'], ['-2'], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER]])('secuencia invalida (%j) -> ok:false', (s) => {
    const r = calc(R)(['a'], [s]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  test('secuencia faltante con eventoId (o al reves) -> ok:false', () => {
    expect(calc(R)(['a'], [''])).toMatchObject({ ok: false });
    expect(calc(R)([''], [4])).toMatchObject({ ok: false });
    expect(calc(R)([null], [4])).toMatchObject({ ok: false });
  });

  test('secuencia duplicada -> ok:false, el motivo nombra filas y numero (nunca contenido)', () => {
    const r = calc(R)(['ID-SECRETO-A', 'ID-SECRETO-B', 'ID-SECRETO-C'], [1, 2, 2]);
    expect(r).toMatchObject({ ok: false });
    expect(r.motivo).toContain('2');
    expect(r.motivo).not.toContain('SECRETO');
  });

  test('siguienteSecuencia lanza si la hoja esta corrupta', () => {
    armar([evento(1, { secuencia: 4 }), evento(2, { secuencia: 4 })]);
    expect(() => R.fotosPozoEventosRepository_siguienteSecuencia(R.fotosPozoEventosRepository_hoja())).toThrow(/no se escribio nada/);
  });
});

describe('buscarPorClientRequestId: por usuario', () => {
  test('encuentra solo el evento del usuario con ese id (aunque otro usuario tenga el mismo)', () => {
    armar([evento(1, { email: 'ana@x.com', clientRequestId: 'mismo-id-0001' }), evento(2, { email: 'otro@x.com', clientRequestId: 'mismo-id-0001' }), evento(3, { email: 'ana@x.com', clientRequestId: 'distinto-0001' })]);
    const r = R.fotosPozoEventosRepository_buscarPorClientRequestId('ana@x.com', 'mismo-id-0001');
    expect(r.total).toBe(1);
    expect(r.eventos[0]).toMatchObject({ secuencia: 1, email: 'ana@x.com' });
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('otro@x.com', 'mismo-id-0001').eventos[0].secuencia).toBe(2);
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('nadie@x.com', 'mismo-id-0001')).toEqual({ total: 0, eventos: [] });
  });

  test('el email de la hoja se compara normalizado', () => {
    armar([evento(1, { email: ' ANA@X.COM ', clientRequestId: 'id-normal-01' })]);
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('ana@x.com', 'id-normal-01').total).toBe(1);
  });

  test('mas de uno: total real y solo los 2 primeros eventos', () => {
    armar([evento(1, { clientRequestId: 'repetido-01' }), evento(2, { clientRequestId: 'repetido-01' }), evento(3, { clientRequestId: 'repetido-01' })]);
    const r = R.fotosPozoEventosRepository_buscarPorClientRequestId('mod@x.com', 'repetido-01');
    expect(r.total).toBe(3);
    expect(r.eventos).toHaveLength(2);
  });

  test('hoja sin filas de datos -> sin coincidencias; el id exacto (sin recortes ni mayusculas)', () => {
    armar([]);
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('a@x.com', 'abcdefgh')).toEqual({ total: 0, eventos: [] });
    armar([evento(1, { clientRequestId: 'AbCdEfGh' })]);
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('mod@x.com', 'abcdefgh').total).toBe(0);
    expect(R.fotosPozoEventosRepository_buscarPorClientRequestId('mod@x.com', 'AbCdEfGh').total).toBe(1);
  });
});

describe('escribirEvento', () => {
  const nuevo = (extra) => Object.assign({
    eventoId: uuid(500), evento: 'RETIRADA', fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', solicitudId: '', resolucion: '', motivoCodigo: 'OTRO', motivoTexto: '=1+1',
    email: 'mod@x.com', nombre: 'Mod', timestampUtc: ISO, clientRequestId: 'escribir-0001'
  }, extra || {});

  test('asigna la secuencia (max + 1), escribe UNA fila al final y devuelve el evento con su secuencia', () => {
    const hoja = armar([evento(1), evento(2)]);
    const r = R.fotosPozoEventosRepository_escribirEvento(nuevo());
    expect(r.secuencia).toBe(3);
    expect(hoja.filas).toHaveLength(4);
    const escrito = R.fotosPozoEventosRepository_leerTodos().eventos[2];
    expect(escrito).toMatchObject({ eventoId: uuid(500), secuencia: 3, evento: 'RETIRADA', motivoCodigo: 'OTRO', motivoTexto: '=1+1', clientRequestId: 'escribir-0001', fila: 4 });
  });

  test('primera escritura: secuencia 1', () => {
    armar([]);
    expect(R.fotosPozoEventosRepository_escribirEvento(nuevo()).secuencia).toBe(1);
  });

  test('formato de texto plano ANTES de escribir (un "=" no se evalua) y secuencia con formato 0', () => {
    const hoja = armar([]);
    R.fotosPozoEventosRepository_escribirEvento(nuevo());
    const col = (n) => COLUMNAS.indexOf(n) + 1;
    expect(hoja.formatos['2:' + col('motivoTexto')]).toBe('@');
    expect(hoja.formatos['2:' + col('email')]).toBe('@');
    expect(hoja.formatos['2:' + col('secuencia')]).toBe('0');
  });

  test('ignora cualquier campo que no sea del esquema (no se cuela un payload ni un id de Drive)', () => {
    const hoja = armar([]);
    R.fotosPozoEventosRepository_escribirEvento(Object.assign(nuevo(), { driveFileId: 'DRIVE-SECRETO', url: 'http://x', imagenBase64: 'AAAA', payload: '{}' }));
    expect(JSON.stringify(hoja.filas)).not.toMatch(/DRIVE-SECRETO|http:|AAAA|payload/);
    expect(hoja.filas[1]).toHaveLength(COLUMNAS.length);
    const devuelto = R.fotosPozoEventosRepository_escribirEvento(Object.assign(nuevo({ eventoId: uuid(501), clientRequestId: 'escribir-0002' }), { driveFileId: 'DRIVE-SECRETO' }));
    expect(Object.keys(devuelto).sort()).toEqual(COLUMNAS.slice().sort());
  });

  test('respeta el orden REAL de las columnas de la hoja', () => {
    const header = COLUMNAS.slice().reverse();
    const hoja = armar([], header);
    R.fotosPozoEventosRepository_escribirEvento(nuevo());
    expect(hoja.filas[1][header.indexOf('evento')]).toBe('RETIRADA');
    expect(hoja.filas[1][header.indexOf('secuencia')]).toBe(1);
  });

  test('hoja con secuencia corrupta: LANZA y NO escribe nada', () => {
    const hoja = armar([evento(1, { secuencia: 3 }), evento(2, { secuencia: 3 })]);
    expect(() => R.fotosPozoEventosRepository_escribirEvento(nuevo())).toThrow(/no se escribio nada/);
    expect(hoja.filas).toHaveLength(3);
  });

  test('hoja inexistente: LANZA y no se crea', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.fotosPozoEventosRepository_escribirEvento(nuevo())).toThrow();
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('una fila escrita se lee de vuelta con los mismos valores (ida y vuelta)', () => {
    armar([]);
    R.fotosPozoEventosRepository_escribirEvento(nuevo({ evento: 'RETIRO_RESUELTO', solicitudId: uuid(300), resolucion: 'APROBADO', motivoCodigo: '', motivoTexto: '' }));
    expect(R.fotosPozoEventosRepository_leerTodos().eventos[0]).toMatchObject({ evento: 'RETIRO_RESUELTO', solicitudId: uuid(300), resolucion: 'APROBADO', motivoCodigo: '', motivoTexto: '' });
  });
});

describe('lock', () => {
  test('conLock devuelve el resultado y libera; libera tambien si la funcion lanza', () => {
    const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
    global.LockService = { getScriptLock: () => lock };
    expect(R.fotosPozoEventosRepository_conLock(() => 42)).toBe(42);
    expect(lock.waitLock).toHaveBeenCalledWith(R.FOTOS_POZO_EVENTOS_LOCK_TIMEOUT_MS);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
    expect(() => R.fotosPozoEventosRepository_conLock(() => { throw new Error('x'); })).toThrow('x');
    expect(lock.releaseLock).toHaveBeenCalledTimes(2);
  });
});

describe('setup: SOLO manual, idempotente, nunca pisa datos', () => {
  test('cargar el modulo y leer NO crea la hoja; el setup la crea con su encabezado y la congela', () => {
    hojas = instalarSheetsFalsos({});
    expect(Object.keys(hojas)).toEqual([]);
    expect(R.setupFotosPozoEventosSheet()).toBe('CREADA');
    expect(hojas.FotosPozoEventos.filas[0]).toEqual(COLUMNAS);
    expect(hojas.FotosPozoEventos.congeladas).toBe(1);
  });

  test('si ya existe con el esquema correcto: no hace nada', () => {
    const hoja = armar([evento(1)]);
    expect(R.setupFotosPozoEventosSheet()).toBe('YA_EXISTE');
    expect(hoja.filas).toHaveLength(2);
  });

  test('si existe con otro esquema: LANZA y no modifica nada', () => {
    const hoja = armar([['x', 'y']], ['a', 'b']);
    expect(() => R.setupFotosPozoEventosSheet()).toThrow(/esquema inesperado/);
    expect(hoja.filas).toEqual([['a', 'b'], ['x', 'y']]);
  });

  test('si existe vacia: LANZA (no la toca)', () => {
    hojas = instalarSheetsFalsos({ FotosPozoEventos: [] });
    expect(() => R.setupFotosPozoEventosSheet()).toThrow(/vacia/);
  });
});
