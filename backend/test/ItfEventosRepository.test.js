// ItfEventosRepository (E9-2): la hoja ItfEventos (futura), su esquema fail-closed de 17 columnas, la lectura completa / por pozo / por documento / pendientes, la busqueda por
// (usuario, clientRequestId), la secuencia global y la escritura de uno o varios eventos. Hoja en memoria; la hoja NO existe en produccion: ninguna lectura la crea y el setup solo corre a mano.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let R;
let hojas;

const ISO = '2026-10-28T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const WELL = '14-0001';
const sha = (n) => n.toString(16).padStart(64, '0');

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  R = require('../src/ItfEventosRepository');
  Object.assign(global, R);
});

const COLUMNAS = require('../src/ItfEventosRepository').ITF_EVENTOS_COLUMNAS;
const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const evento = (n, extra) => fila(Object.assign({
  eventoId: uuid(100 + n), secuencia: n, evento: 'ITF_PROPUESTO', documentoId: uuid(n), wellId: WELL, mimeType: 'image/jpeg', bytes: 1000 + n, sha256: sha(n), storageFileId: 'drive-id-' + String(n).padStart(6, '0'),
  nombreOriginal: 'itf-' + n + '.jpg', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'req-' + String(n).padStart(8, '0')
}, extra || {}));
const armar = (filas, header) => { hojas = instalarSheetsFalsos({ ItfEventos: [header || COLUMNAS].concat(filas || []) }); return hojas.ItfEventos; };

const nuevo = (extra) => Object.assign({
  eventoId: uuid(500), evento: 'ITF_PROPUESTO', documentoId: uuid(50), wellId: WELL, documentoReemplazadoId: '', mimeType: 'image/png', bytes: 2048, sha256: sha(50), storageFileId: 'drive-id-000050',
  nombreOriginal: '=HYPERLINK("x").png', motivoCodigo: '', motivoTexto: '', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'escribir-0001'
}, extra || {});

describe('esquema: 17 columnas, en este orden', () => {
  test('el orden exacto y el nombre de la hoja', () => {
    expect(R.ITF_EVENTOS_COLUMNAS).toEqual([
      'eventoId', 'secuencia', 'evento', 'documentoId', 'wellId', 'documentoReemplazadoId', 'mimeType', 'bytes', 'sha256', 'storageFileId', 'nombreOriginal',
      'motivoCodigo', 'motivoTexto', 'email', 'nombre', 'timestampUtc', 'clientRequestId'
    ]);
    expect(R.ITF_EVENTOS_HOJA).toBe('ItfEventos');
  });

  test('no hay columna de estado (se deriva), ni base64, ni URL, ni "publicable"', () => {
    const texto = R.ITF_EVENTOS_COLUMNAS.join(',').toLowerCase();
    ['estado', 'base64', 'imagen', 'url', 'publicable', 'publico', 'driveid'].forEach((x) => { expect(texto).not.toContain(x); });
  });

  test('los ids del storage y el email son columnas del backend (existen solo aca; los DTO no las llevan)', () => {
    expect(R.ITF_EVENTOS_COLUMNAS).toEqual(expect.arrayContaining(['storageFileId', 'email', 'clientRequestId', 'secuencia']));
  });

  test('planEsquema: valido, reordenado y con mayusculas/espacios; faltantes y repetidas', () => {
    expect(R.itfEventosRepository_planEsquema(COLUMNAS)).toEqual({ ok: true, faltantes: [], repetidas: [] });
    expect(R.itfEventosRepository_planEsquema(COLUMNAS.slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    expect(R.itfEventosRepository_planEsquema(COLUMNAS.filter((c) => c !== 'sha256'))).toMatchObject({ ok: false, faltantes: ['sha256'] });
    expect(R.itfEventosRepository_planEsquema(COLUMNAS.concat(['wellId']))).toMatchObject({ ok: false, repetidas: ['wellId'] });
    expect(R.itfEventosRepository_planEsquema(null).ok).toBe(false);
  });
});

describe('hoja: fail-closed y sin autocreacion', () => {
  test('si la hoja no existe, LANZA y NO la crea', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.itfEventosRepository_leerTodos()).toThrow(/setupItfEventosSheet/);
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('hoja vacia (sin encabezado) o con esquema inesperado: lanza', () => {
    hojas = instalarSheetsFalsos({ ItfEventos: [] });
    expect(() => R.itfEventosRepository_leerTodos()).toThrow(/encabezado/);
    armar([], COLUMNAS.filter((c) => c !== 'email'));
    expect(() => R.itfEventosRepository_leerTodos()).toThrow(/email/);
    armar([], COLUMNAS.concat(['email']));
    expect(() => R.itfEventosRepository_leerTodos()).toThrow(/repetidas/);
  });

  test('una hoja con las columnas en otro orden se lee bien', () => {
    const header = COLUMNAS.slice().reverse();
    const filaReves = COLUMNAS.slice().reverse().map((c) => evento(1)[COLUMNAS.indexOf(c)]);
    armar([filaReves], header);
    expect(R.itfEventosRepository_leerTodos().eventos[0]).toMatchObject({ eventoId: uuid(101), evento: 'ITF_PROPUESTO', documentoId: uuid(1), secuencia: 1, wellId: WELL });
  });
});

describe('lectura cruda', () => {
  test('ids de evento y de documento (UUID) y email en minuscula; LEGACY:<wellId> y el resto TAL CUAL', () => {
    const HEX = (c) => 'abcdef0' + c + '-2345-4abc-8def-0123456789ab';
    armar([
      evento(1, { eventoId: HEX(1).toUpperCase(), documentoId: HEX(2).toUpperCase(), documentoReemplazadoId: HEX(3).toUpperCase(), evento: 'itf_aprobado', email: ' ANA@X.com ', sha256: sha(255).toUpperCase() }),
      evento(2, { documentoId: ' LEGACY:14-0001 ', documentoReemplazadoId: 'legacy:14-0001' })
    ]);
    const [a, b] = R.itfEventosRepository_leerTodos().eventos;
    expect(a).toMatchObject({ eventoId: HEX(1), documentoId: HEX(2), documentoReemplazadoId: HEX(3), evento: 'itf_aprobado', email: 'ana@x.com', sha256: sha(255).toUpperCase(), fila: 2 });
    expect(b).toMatchObject({ documentoId: 'LEGACY:14-0001', documentoReemplazadoId: 'legacy:14-0001' });
  });

  test('una secuencia vacia o no numerica se lee como null (la derivacion la marca invalida); un texto de digitos se lee como numero', () => {
    armar([evento(1, { secuencia: '' }), evento(2, { secuencia: 'x' }), evento(3, { secuencia: '7' }), evento(4, { secuencia: 8 })]);
    expect(R.itfEventosRepository_leerTodos().eventos.map((e) => e.secuencia)).toEqual([null, null, 7, 8]);
  });

  test('bytes: vacio -> "", numero o digitos -> numero, cualquier otra cosa se conserva (un valor roto nunca se vuelve "vacio")', () => {
    armar([evento(1, { bytes: '' }), evento(2, { bytes: 2048 }), evento(3, { bytes: ' 4096 ' }), evento(4, { bytes: 'abc' }), evento(5, { bytes: '12.5' }), evento(6, { bytes: -3 })]);
    expect(R.itfEventosRepository_leerTodos().eventos.map((e) => e.bytes)).toEqual(['', 2048, 4096, 'abc', '12.5', -3]);
  });

  test('timestamp: texto ISO tal cual; una Date (Sheets lo convirtio) vuelve a ISO', () => {
    armar([evento(1), evento(2, { timestampUtc: new Date(ISO) })]);
    expect(R.itfEventosRepository_leerTodos().eventos.map((e) => e.timestampUtc)).toEqual([ISO, ISO]);
  });

  test('leerTodos: filas en orden, con numero de fila; salta las filas totalmente vacias; UNA sola lectura de la hoja', () => {
    const hoja = armar([evento(1), fila({}), evento(2)]);
    let lecturas = 0;
    const original = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { lecturas += 1; return original(); };
    const todos = R.itfEventosRepository_leerTodos().eventos;
    expect(todos.map((e) => [e.fila, e.secuencia])).toEqual([[2, 1], [4, 2]]);
    expect(lecturas).toBe(1);
  });

  test('hoja con solo encabezado: sin eventos', () => {
    armar([]);
    expect(R.itfEventosRepository_leerTodos().eventos).toEqual([]);
  });

  test('el evento crudo lleva TODOS los campos del esquema (menos nada) y solo esos', () => {
    armar([evento(1)]);
    const e = R.itfEventosRepository_leerTodos().eventos[0];
    expect(Object.keys(e).filter((k) => k !== 'fila').sort()).toEqual(COLUMNAS.slice().sort());
  });
});

describe('lecturas por pozo, por documento, agrupadas y pendientes', () => {
  const OTRO = '14-0002';
  const cargar = () => armar([
    evento(1),                                                                                                    // propuesta doc1 en WELL
    evento(2, { wellId: OTRO }),                                                                                  // propuesta doc2 en OTRO
    evento(3, { evento: 'ITF_APROBADO', documentoId: uuid(1), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '' }),
    evento(4, { evento: 'ITF_APROBADO', wellId: OTRO, documentoId: uuid(2), documentoReemplazadoId: uuid(1), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '' }),   // cruzado
    evento(5, { documentoId: uuid(5) }),                                                                          // propuesta doc5 en WELL (pendiente)
    evento(6, { evento: 'ITF_RECHAZADO', documentoId: uuid(6), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '' }),
    evento(7, { evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', clientRequestId: '' })
  ]);

  test('listarPorPozo: eventos del pozo + los que referencian un documento propuesto en ese pozo (aunque tengan otro wellId)', () => {
    cargar();
    expect(R.itfEventosRepository_listarPorPozo(WELL).eventos.map((e) => e.secuencia)).toEqual([1, 3, 4, 5, 6, 7]);
    expect(R.itfEventosRepository_listarPorPozo(OTRO).eventos.map((e) => e.secuencia)).toEqual([2, 4]);
    expect(R.itfEventosRepository_listarPorPozo('99-9999').eventos).toEqual([]);
  });

  test('listarPorDocumento: eventos que lo mencionan como documento o como el reemplazado', () => {
    cargar();
    expect(R.itfEventosRepository_listarPorDocumento(uuid(1)).eventos.map((e) => e.secuencia)).toEqual([1, 3, 4]);
    expect(R.itfEventosRepository_listarPorDocumento('LEGACY:14-0001').eventos.map((e) => e.secuencia)).toEqual([7]);
    expect(R.itfEventosRepository_listarPorDocumento(uuid(77)).eventos).toEqual([]);
  });

  test('agruparPorPozo: por wellId, en el orden de la hoja; las filas sin pozo usable quedan bajo ""', () => {
    armar([evento(1), evento(2, { wellId: OTRO }), evento(3), evento(4, { wellId: '' })]);
    const g = R.itfEventosRepository_listarAgrupadosPorPozo().porPozo;
    expect(Object.keys(g).sort()).toEqual(['', WELL, OTRO].sort());
    expect(g[WELL].map((e) => e.secuencia)).toEqual([1, 3]);
    expect(g[''].map((e) => e.secuencia)).toEqual([4]);
  });

  test('listarPropuestasPendientes: propuestas que ningun evento cierra (aprobacion, rechazo o retiro); lectura cruda; UNA lectura de la hoja', () => {
    const hoja = cargar();
    let lecturas = 0;
    const original = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { lecturas += 1; return original(); };
    expect(R.itfEventosRepository_listarPropuestasPendientes().eventos.map((e) => e.documentoId)).toEqual([uuid(5)]);
    expect(lecturas).toBe(1);
  });

  test('una propuesta retirada deja de ser pendiente; un REVERTIDO no cierra nada', () => {
    armar([evento(1), evento(2, { documentoId: uuid(2) }), evento(3, { evento: 'ITF_RETIRADO', documentoId: uuid(1), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '' }),
      evento(4, { evento: 'ITF_REVERTIDO', documentoId: uuid(2), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '' })]);
    expect(R.itfEventosRepository_listarPropuestasPendientes().eventos.map((e) => e.documentoId)).toEqual([uuid(2)]);
  });

  test('las funciones puras no tocan la entrada y toleran entradas vacias', () => {
    expect(R.itfEventosRepository_agruparPorPozo(null)).toEqual({});
    expect(R.itfEventosRepository_filtrarPorPozo(undefined, WELL)).toEqual([]);
    expect(R.itfEventosRepository_filtrarPorDocumento(null, uuid(1))).toEqual([]);
    expect(R.itfEventosRepository_filtrarPropuestasSinCerrar(undefined)).toEqual([]);
  });
});

describe('secuencia global (fail-closed)', () => {
  const calc = (...a) => R.itfEventosRepository_calcularSiguienteSecuencia(...a);
  test('hoja vacia -> 1; max + 1; se saltan las filas totalmente vacias', () => {
    expect(calc([], [])).toEqual({ ok: true, siguiente: 1 });
    expect(calc(['a', 'b'], [3, 7])).toEqual({ ok: true, siguiente: 8 });
    expect(calc(['a', '', 'b'], [1, '', 2])).toEqual({ ok: true, siguiente: 3 });
  });

  test('secuencia como texto de solo digitos vale', () => {
    expect(calc(['a'], ['5'])).toEqual({ ok: true, siguiente: 6 });
  });

  test.each([[1.5], [0], [-1], ['x'], ['1.5'], ['-2'], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER]])('secuencia invalida (%j) -> ok:false', (s) => {
    const r = calc(['a'], [s]);
    expect(r.ok).toBe(false);
    expect(r.motivo).toBeTruthy();
  });

  test('secuencia faltante con eventoId (o al reves) -> ok:false', () => {
    expect(calc(['a'], [''])).toMatchObject({ ok: false });
    expect(calc([''], [4])).toMatchObject({ ok: false });
    expect(calc([null], [4])).toMatchObject({ ok: false });
  });

  test('secuencia duplicada -> ok:false, el motivo nombra filas y numero (nunca contenido)', () => {
    const r = calc(['ID-SECRETO-A', 'ID-SECRETO-B', 'ID-SECRETO-C'], [1, 2, 2]);
    expect(r).toMatchObject({ ok: false });
    expect(r.motivo).toContain('2');
    expect(r.motivo).not.toContain('SECRETO');
  });

  test('siguienteSecuencia lanza si la hoja esta corrupta', () => {
    armar([evento(1, { secuencia: 4 }), evento(2, { secuencia: 4 })]);
    expect(() => R.itfEventosRepository_siguienteSecuencia(R.itfEventosRepository_hoja())).toThrow(/no se escribio nada/);
  });
});

describe('buscarPorClientRequestId: por usuario', () => {
  test('encuentra solo el evento del usuario con ese id (aunque otro usuario tenga el mismo)', () => {
    armar([evento(1, { email: 'ana@x.com', clientRequestId: 'mismo-id-0001' }), evento(2, { email: 'otro@x.com', clientRequestId: 'mismo-id-0001' }), evento(3, { email: 'ana@x.com', clientRequestId: 'distinto-0001' })]);
    const r = R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'mismo-id-0001');
    expect(r.total).toBe(1);
    expect(r.eventos[0]).toMatchObject({ secuencia: 1, email: 'ana@x.com' });
    expect(R.itfEventosRepository_buscarPorClientRequestId('otro@x.com', 'mismo-id-0001').eventos[0].secuencia).toBe(2);
    expect(R.itfEventosRepository_buscarPorClientRequestId('nadie@x.com', 'mismo-id-0001')).toEqual({ total: 0, eventos: [] });
  });

  test('el email de la hoja se compara normalizado', () => {
    armar([evento(1, { email: ' ANA@X.COM ', clientRequestId: 'id-normal-01' })]);
    expect(R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'id-normal-01').total).toBe(1);
  });

  test('mas de uno: total real y solo los 2 primeros eventos', () => {
    armar([evento(1, { clientRequestId: 'repetido-01' }), evento(2, { clientRequestId: 'repetido-01' }), evento(3, { clientRequestId: 'repetido-01' })]);
    const r = R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'repetido-01');
    expect(r.total).toBe(3);
    expect(r.eventos).toHaveLength(2);
  });

  test('hoja sin filas de datos -> sin coincidencias; el id exacto (sin recortes ni mayusculas)', () => {
    armar([]);
    expect(R.itfEventosRepository_buscarPorClientRequestId('a@x.com', 'abcdefgh')).toEqual({ total: 0, eventos: [] });
    armar([evento(1, { clientRequestId: 'AbCdEfGh' })]);
    expect(R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'abcdefgh').total).toBe(0);
    expect(R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'AbCdEfGh').total).toBe(1);
  });

  test('el registro del legacy (sin clientRequestId) nunca coincide con un id', () => {
    armar([evento(1, { evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', clientRequestId: '' }), evento(2, { clientRequestId: 'req-real-0002' })]);
    expect(R.itfEventosRepository_buscarPorClientRequestId('ana@x.com', 'req-real-0002').total).toBe(1);
  });
});

describe('escribirEvento / escribirEventos', () => {
  test('asigna la secuencia (max + 1), escribe UNA fila al final y devuelve el evento con su secuencia', () => {
    const hoja = armar([evento(1), evento(2)]);
    const r = R.itfEventosRepository_escribirEvento(nuevo());
    expect(r.secuencia).toBe(3);
    expect(hoja.filas).toHaveLength(4);
    expect(R.itfEventosRepository_leerTodos().eventos[2]).toMatchObject({
      eventoId: uuid(500), secuencia: 3, evento: 'ITF_PROPUESTO', documentoId: uuid(50), mimeType: 'image/png', bytes: 2048, sha256: sha(50), storageFileId: 'drive-id-000050', clientRequestId: 'escribir-0001', fila: 4
    });
  });

  test('primera escritura: secuencia 1', () => {
    armar([]);
    expect(R.itfEventosRepository_escribirEvento(nuevo()).secuencia).toBe(1);
  });

  test('DOS eventos juntos (registro del legacy + evento): secuencias consecutivas, una sola operacion de escritura', () => {
    const hoja = armar([evento(1)]);
    let escrituras = 0;
    const getRange = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => {
      const r = getRange(f, c, nf, nc);
      const sv = r.setValues.bind(r);
      r.setValues = (v) => { escrituras += 1; return sv(v); };
      return r;
    };
    const legacy = nuevo({ eventoId: uuid(501), evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', clientRequestId: '', nombreOriginal: '14-0001.jpg' });
    const aprobado = nuevo({ eventoId: uuid(502), evento: 'ITF_APROBADO', documentoId: uuid(50), documentoReemplazadoId: 'LEGACY:14-0001', mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '', motivoCodigo: 'ACTUALIZACION' });
    const r = R.itfEventosRepository_escribirEventos([legacy, aprobado]);
    expect(r.map((e) => e.secuencia)).toEqual([2, 3]);
    expect(escrituras).toBe(1);
    expect(hoja.filas).toHaveLength(4);
    expect(R.itfEventosRepository_leerTodos().eventos.map((e) => [e.secuencia, e.evento])).toEqual([[1, 'ITF_PROPUESTO'], [2, 'ITF_LEGACY_REGISTRADO'], [3, 'ITF_APROBADO']]);
  });

  test('lista vacia o que no es lista: lanza y no escribe', () => {
    const hoja = armar([evento(1)]);
    [[], null, undefined, 'x', {}].forEach((v) => expect(() => R.itfEventosRepository_escribirEventos(v)).toThrow(/no hay eventos/));
    expect(hoja.filas).toHaveLength(2);
  });

  test('formato de texto plano ANTES de escribir (un "=" no se evalua); secuencia y bytes con formato 0', () => {
    const hoja = armar([]);
    R.itfEventosRepository_escribirEvento(nuevo());
    const col = (n) => COLUMNAS.indexOf(n) + 1;
    expect(hoja.formatos['2:' + col('nombreOriginal')]).toBe('@');
    expect(hoja.formatos['2:' + col('email')]).toBe('@');
    expect(hoja.formatos['2:' + col('sha256')]).toBe('@');
    expect(hoja.formatos['2:' + col('storageFileId')]).toBe('@');
    expect(hoja.formatos['2:' + col('secuencia')]).toBe('0');
    expect(hoja.formatos['2:' + col('bytes')]).toBe('0');
    expect(hoja.filas[1][col('nombreOriginal') - 1]).toBe('=HYPERLINK("x").png');
  });

  test('formatos de cada fila cuando se escriben dos', () => {
    const hoja = armar([]);
    R.itfEventosRepository_escribirEventos([nuevo(), nuevo({ eventoId: uuid(501), clientRequestId: 'escribir-0002' })]);
    const col = (n) => COLUMNAS.indexOf(n) + 1;
    expect(hoja.formatos['2:' + col('motivoTexto')]).toBe('@');
    expect(hoja.formatos['3:' + col('motivoTexto')]).toBe('@');
    expect(hoja.formatos['3:' + col('secuencia')]).toBe('0');
  });

  test('ignora cualquier campo que no sea del esquema (no se cuela un payload, una URL ni una imagen)', () => {
    const hoja = armar([]);
    R.itfEventosRepository_escribirEvento(Object.assign(nuevo(), { driveFileId: 'DRIVE-SECRETO', url: 'http://x', imagenBase64: 'AAAA', payload: '{}' }));
    expect(JSON.stringify(hoja.filas)).not.toMatch(/DRIVE-SECRETO|http:|AAAA|payload/);
    expect(hoja.filas[1]).toHaveLength(COLUMNAS.length);
    const devuelto = R.itfEventosRepository_escribirEvento(Object.assign(nuevo({ eventoId: uuid(501), clientRequestId: 'escribir-0002' }), { driveFileId: 'DRIVE-SECRETO' }));
    expect(Object.keys(devuelto).sort()).toEqual(COLUMNAS.slice().sort());
  });

  test('respeta el orden REAL de las columnas de la hoja', () => {
    const header = COLUMNAS.slice().reverse();
    const hoja = armar([], header);
    R.itfEventosRepository_escribirEvento(nuevo());
    expect(hoja.filas[1][header.indexOf('evento')]).toBe('ITF_PROPUESTO');
    expect(hoja.filas[1][header.indexOf('secuencia')]).toBe(1);
    expect(hoja.filas[1][header.indexOf('sha256')]).toBe(sha(50));
  });

  test('es APPEND-ONLY: escribir no modifica ninguna fila anterior', () => {
    const hoja = armar([evento(1), evento(2)]);
    const antes = JSON.stringify(hoja.filas);
    R.itfEventosRepository_escribirEvento(nuevo());
    R.itfEventosRepository_escribirEvento(nuevo({ eventoId: uuid(501), clientRequestId: 'escribir-0002' }));
    expect(JSON.stringify(hoja.filas.slice(0, 3))).toBe(antes);
    expect(hoja.filas).toHaveLength(5);
  });

  test('hoja con secuencia corrupta: LANZA y NO escribe nada (tampoco el primero de dos)', () => {
    const hoja = armar([evento(1, { secuencia: 3 }), evento(2, { secuencia: 3 })]);
    expect(() => R.itfEventosRepository_escribirEventos([nuevo(), nuevo({ eventoId: uuid(501) })])).toThrow(/no se escribio nada/);
    expect(hoja.filas).toHaveLength(3);
  });

  test('hoja inexistente: LANZA y no se crea', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.itfEventosRepository_escribirEvento(nuevo())).toThrow();
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('una fila escrita se lee de vuelta con los mismos valores (ida y vuelta)', () => {
    armar([]);
    R.itfEventosRepository_escribirEvento(nuevo({ evento: 'ITF_RECHAZADO', documentoId: uuid(60), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '', motivoCodigo: 'OTRO', motivoTexto: 'Texto del motivo' }));
    expect(R.itfEventosRepository_leerTodos().eventos[0]).toMatchObject({
      evento: 'ITF_RECHAZADO', documentoId: uuid(60), mimeType: '', bytes: '', sha256: '', storageFileId: '', nombreOriginal: '', motivoCodigo: 'OTRO', motivoTexto: 'Texto del motivo'
    });
  });
});

describe('lock', () => {
  test('conLock devuelve el resultado y libera; libera tambien si la funcion lanza', () => {
    const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
    global.LockService = { getScriptLock: () => lock };
    expect(R.itfEventosRepository_conLock(() => 42)).toBe(42);
    expect(lock.waitLock).toHaveBeenCalledWith(R.ITF_EVENTOS_LOCK_TIMEOUT_MS);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
    expect(() => R.itfEventosRepository_conLock(() => { throw new Error('x'); })).toThrow('x');
    expect(lock.releaseLock).toHaveBeenCalledTimes(2);
  });
});

describe('setup: SOLO manual, idempotente, nunca pisa datos (implementado y probado, NO ejecutado)', () => {
  test('cargar el modulo y leer NO crea la hoja; el setup la crea con su encabezado y la congela', () => {
    hojas = instalarSheetsFalsos({});
    expect(Object.keys(hojas)).toEqual([]);
    expect(R.setupItfEventosSheet()).toBe('CREADA');
    expect(hojas.ItfEventos.filas[0]).toEqual(COLUMNAS);
    expect(hojas.ItfEventos.congeladas).toBe(1);
  });

  test('si ya existe con el esquema correcto: no hace nada', () => {
    const hoja = armar([evento(1)]);
    expect(R.setupItfEventosSheet()).toBe('YA_EXISTE');
    expect(hoja.filas).toHaveLength(2);
  });

  test('si existe con otro esquema: LANZA y no modifica nada', () => {
    const hoja = armar([['x', 'y']], ['a', 'b']);
    expect(() => R.setupItfEventosSheet()).toThrow(/esquema inesperado/);
    expect(hoja.filas).toEqual([['a', 'b'], ['x', 'y']]);
  });

  test('si existe vacia: LANZA (no la toca)', () => {
    hojas = instalarSheetsFalsos({ ItfEventos: [] });
    expect(() => R.setupItfEventosSheet()).toThrow(/vacia/);
  });

  test('ninguna otra funcion del repositorio llama al setup', () => {
    const fs = require('fs');
    const path = require('path');
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'ItfEventosRepository.js'), 'utf8');
    const llamadas = fuente.split('setupItfEventosSheet(').length - 1;
    expect(llamadas).toBe(1);                      // solo su definicion
  });
});
