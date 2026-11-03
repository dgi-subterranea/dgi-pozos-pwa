// Outbox de avisos de propuestas (hoja PropuestaNotificaciones): esquema exacto, setup idempotente que no se ejecuta solo, una fila por (tipo, propuestaId), reserva de intentos con lease, resultado solo en los
// campos permitidos y filtro de reintentables. Hojas, lock y fechas son falsos: nada toca Google.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let R;
let hojas;
let lock;

const T0 = Date.parse('2026-11-03T17:05:00.000Z');
const ISO0 = new Date(T0).toISOString();
const NOMBRE = 'PropuestaNotificaciones';
const ID1 = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const NID1 = '11111111-1111-4111-8111-111111111111';
const NID2 = '22222222-2222-4222-8222-222222222222';
const entrada = (extra) => Object.assign({
  tipo: 'ITF', propuestaId: ID1, wellId: '14-0130', permisosValidador: 'perfil,perfil_validar', proponenteNombre: 'Ana Proponente', proponenteEmail: 'ana@example.com', propuestaTimestampUtc: '2026-11-03T17:00:00.000Z'
}, extra || {});

function montar(hojasIniciales) {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  R = require('../src/PropuestaNotificacionesRepository');
  hojas = instalarSheetsFalsos(hojasIniciales === undefined ? { [NOMBRE]: [R.PROPUESTA_NOTIF_COLUMNAS] } : hojasIniciales);
  lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
  global.LockService = { getScriptLock: () => lock };
  Object.assign(global, R);
}

beforeEach(() => montar());

describe('esquema', () => {
  test('las 15 columnas exactas, en este orden', () => {
    expect(R.PROPUESTA_NOTIF_HOJA).toBe('PropuestaNotificaciones');
    expect(R.PROPUESTA_NOTIF_COLUMNAS).toEqual([
      'notificacionId', 'tipo', 'propuestaId', 'wellId', 'permisosValidador', 'proponenteNombre', 'proponenteEmail', 'propuestaTimestampUtc',
      'estado', 'intentos', 'creadoUtc', 'ultimoIntentoUtc', 'enviadoUtc', 'ultimoError', 'destinatariosEnviados'
    ]);
  });

  test('no guarda cuerpo, secretos, hashes, storageFileId ni clientRequestId', () => {
    R.PROPUESTA_NOTIF_COLUMNAS.forEach((c) => expect(c).not.toMatch(/cuerpo|body|secret|token|hash|sha|storage|clientRequest|imagen|base64|documentoId/i));
  });

  test('estados y topes', () => {
    expect(R.PROPUESTA_NOTIF_ESTADOS).toEqual({ PENDIENTE: 'PENDIENTE', ENVIADA: 'ENVIADA', ERROR: 'ERROR', OMITIDA: 'OMITIDA' });
    expect(R.PROPUESTA_NOTIF_MAX_INTENTOS).toBe(5);
    expect(R.PROPUESTA_NOTIF_LEASE_MS).toBe(300000);
  });

  test('planEsquema: completo, faltante, repetida y encabezado en otro orden o con mayusculas/espacios', () => {
    expect(R.propuestaNotificacionesRepository_planEsquema(R.PROPUESTA_NOTIF_COLUMNAS).ok).toBe(true);
    expect(R.propuestaNotificacionesRepository_planEsquema(R.PROPUESTA_NOTIF_COLUMNAS.slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    const sin = R.PROPUESTA_NOTIF_COLUMNAS.filter((c) => c !== 'estado');
    expect(R.propuestaNotificacionesRepository_planEsquema(sin)).toEqual({ ok: false, faltantes: ['estado'], repetidas: [] });
    expect(R.propuestaNotificacionesRepository_planEsquema(R.PROPUESTA_NOTIF_COLUMNAS.concat(['tipo']))).toEqual({ ok: false, faltantes: [], repetidas: ['tipo'] });
    expect(R.propuestaNotificacionesRepository_planEsquema(undefined).ok).toBe(false);
  });
});

describe('setupPropuestaNotificacionesSheet (idempotente, no se ejecuta sola)', () => {
  test('crea la hoja con el encabezado exacto y la fila 1 congelada; no escribe ninguna fila de datos', () => {
    montar({});
    expect(R.setupPropuestaNotificacionesSheet()).toBe('CREADA');
    expect(hojas[NOMBRE].filas).toEqual([R.PROPUESTA_NOTIF_COLUMNAS]);
    expect(hojas[NOMBRE].congeladas).toBe(1);
  });

  test('si ya existe con el esquema correcto: YA_EXISTE y no toca ni encabezado ni filas', () => {
    montar({ [NOMBRE]: [R.PROPUESTA_NOTIF_COLUMNAS, ['x']] });
    const antes = JSON.stringify(hojas[NOMBRE].filas);
    expect(R.setupPropuestaNotificacionesSheet()).toBe('YA_EXISTE');
    expect(R.setupPropuestaNotificacionesSheet()).toBe('YA_EXISTE');
    expect(JSON.stringify(hojas[NOMBRE].filas)).toBe(antes);
  });

  test('si existe con un esquema distinto: lanza y NO modifica nada', () => {
    const rara = ['notificacionId', 'tipo'];
    montar({ [NOMBRE]: [rara, ['a', 'b']] });
    expect(() => R.setupPropuestaNotificacionesSheet()).toThrow(/esquema inesperado/);
    expect(hojas[NOMBRE].filas).toEqual([rara, ['a', 'b']]);
  });

  test('si existe pero vacia: lanza y no la toca', () => {
    montar({ [NOMBRE]: [] });
    expect(() => R.setupPropuestaNotificacionesSheet()).toThrow(/vacia/);
    expect(hojas[NOMBRE].filas).toEqual([]);
  });

  test('ninguna lectura ni escritura crea la hoja: sin ella lanzan y la hoja sigue sin existir', () => {
    montar({});
    expect(() => R.propuestaNotificacionesRepository_leerTodas()).toThrow(/setupPropuestaNotificacionesSheet/);
    expect(() => R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1)).toThrow(/setupPropuestaNotificacionesSheet/);
    expect(() => R.propuestaNotificacionesRepository_reservarIntento(NID1, T0)).toThrow();
    expect(() => R.propuestaNotificacionesRepository_registrarResultado(NID1, { estado: 'ENVIADA' })).toThrow();
    expect(() => R.propuestaNotificacionesRepository_listarReintentables(T0, 10)).toThrow();
    expect(hojas[NOMBRE]).toBeUndefined();
  });

  test('hoja con encabezado vacio o esquema roto: toda operacion falla cerrado', () => {
    montar({ [NOMBRE]: [[]] });
    expect(() => R.propuestaNotificacionesRepository_leerTodas()).toThrow(/no tiene encabezado/);
    montar({ [NOMBRE]: [R.PROPUESTA_NOTIF_COLUMNAS.filter((c) => c !== 'intentos')] });
    expect(() => R.propuestaNotificacionesRepository_leerTodas()).toThrow(/faltan: intentos/);
    montar({ [NOMBRE]: [R.PROPUESTA_NOTIF_COLUMNAS.concat(['estado'])] });
    expect(() => R.propuestaNotificacionesRepository_leerTodas()).toThrow(/repetidas: estado/);
  });
});

describe('asegurar: UNA fila por (tipo, propuestaId)', () => {
  test('crea la fila PENDIENTE con intentos 0 y solo lo necesario', () => {
    const r = R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    expect(r.creada).toBe(true);
    expect(hojas[NOMBRE].filas[1]).toEqual([NID1, 'ITF', ID1, '14-0130', 'perfil,perfil_validar', 'Ana Proponente', 'ana@example.com', '2026-11-03T17:00:00.000Z', 'PENDIENTE', 0, ISO0, '', '', '', '']);
    expect(r.notificacion).toMatchObject({ estado: 'PENDIENTE', intentos: 0, fila: 2, notificacionId: NID1 });
  });

  test('la segunda vez con la misma clave NO crea otra fila ni toca la existente, en cualquier estado', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    ['PENDIENTE', 'ERROR', 'ENVIADA', 'OMITIDA'].forEach((estado) => {
      hojas[NOMBRE].filas[1][8] = estado;
      const r = R.propuestaNotificacionesRepository_asegurar(entrada({ wellId: '99-9999' }), '2030-01-01T00:00:00.000Z', NID2);
      expect(r.creada).toBe(false);
      expect(r.notificacion).toMatchObject({ notificacionId: NID1, estado, wellId: '14-0130' });
      expect(hojas[NOMBRE].filas).toHaveLength(2);
    });
  });

  test('otro propuestaId, o el mismo propuestaId con otro tipo, son otra notificacion', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    expect(R.propuestaNotificacionesRepository_asegurar(entrada({ propuestaId: 'bbbb' }), ISO0, NID2).creada).toBe(true);
    expect(R.propuestaNotificacionesRepository_asegurar(entrada({ tipo: 'FOTO' }), ISO0, '33333333-3333-4333-8333-333333333333').creada).toBe(true);
    expect(hojas[NOMBRE].filas).toHaveLength(4);
  });

  test('todo va como TEXTO PLANO (nada se evalua como formula) salvo intentos', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada({ proponenteNombre: '=HYPERLINK("http://x")' }), ISO0, NID1);
    const formatos = [];
    for (let c = 1; c <= 15; c += 1) { formatos.push(hojas[NOMBRE].formatos['2:' + c]); }
    expect(formatos).toEqual(R.PROPUESTA_NOTIF_COLUMNAS.map((n) => (n === 'intentos' ? '0' : '@')));
  });

  test('con el encabezado en otro orden respeta el orden real y deja intacta una columna extra', () => {
    const header = ['extra'].concat(R.PROPUESTA_NOTIF_COLUMNAS.slice().reverse());
    montar({ [NOMBRE]: [header] });
    const r = R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    const fila = hojas[NOMBRE].filas[1];
    expect(fila[0]).toBe('');
    expect(fila[header.indexOf('tipo')]).toBe('ITF');
    expect(fila[header.indexOf('notificacionId')]).toBe(NID1);
    expect(r.notificacion.propuestaId).toBe(ID1);
  });

  test('se hace bajo lock y el lock se libera aunque falle', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    expect(lock.waitLock).toHaveBeenCalledWith(R.PROPUESTA_NOTIF_LOCK_TIMEOUT_MS);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
    montar({});
    expect(() => R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1)).toThrow();
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
  });

  test('si el lock no se consigue, lanza y NO escribe nada', () => {
    lock.waitLock.mockImplementation(() => { throw new Error('timeout de lock'); });
    expect(() => R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1)).toThrow(/timeout/);
    expect(hojas[NOMBRE].filas).toHaveLength(1);
    expect(lock.releaseLock).not.toHaveBeenCalled();
  });

  test('si la hoja ya tiene la misma clave repetida (edicion manual), todos usan la PRIMERA', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    hojas[NOMBRE].filas.push(hojas[NOMBRE].filas[1].slice());
    hojas[NOMBRE].filas[2][0] = NID2;
    expect(R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, 'x').notificacion.notificacionId).toBe(NID1);
    expect(hojas[NOMBRE].filas).toHaveLength(3);
  });
});

describe('lectura de filas', () => {
  const fila = (extra) => R.propuestaNotificacionesRepository_objetoDesdeFila(
    R.PROPUESTA_NOTIF_COLUMNAS.map((c) => (extra && c in extra ? extra[c] : '')), R.propuestaNotificacionesRepository_indiceColumnas(R.PROPUESTA_NOTIF_COLUMNAS), 7);

  test.each([['', 0], [0, 0], ['3', 3], [2, 2], ['x', 5], [-1, 5], ['2.5', 5], [' 4 ', 4]])('intentos %j se lee como %j (lo roto cuenta como agotado: no se reintenta sin fin)', (crudo, esperado) => {
    expect(fila({ intentos: crudo }).intentos).toBe(esperado);
  });

  test('normaliza: ids y emails en minuscula, texto recortado, fecha de Sheets a ISO y numero de fila', () => {
    const o = fila({ notificacionId: ' ' + NID1.toUpperCase() + ' ', proponenteEmail: ' ANA@Example.com ', tipo: ' ITF ', creadoUtc: new Date(T0) });
    expect(o).toMatchObject({ notificacionId: NID1, proponenteEmail: 'ana@example.com', tipo: 'ITF', creadoUtc: ISO0, fila: 7 });
    expect(fila({ creadoUtc: new Date('x') }).creadoUtc).toBe('');
  });

  test('leerTodas salta las filas totalmente vacias', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    hojas[NOMBRE].filas.push(['', '', ''], []);
    R.propuestaNotificacionesRepository_asegurar(entrada({ propuestaId: 'bbbb' }), ISO0, NID2);
    expect(R.propuestaNotificacionesRepository_leerTodas().map((n) => n.propuestaId)).toEqual([ID1, 'bbbb']);
  });
});

describe('reservarIntento: un intento por vez', () => {
  beforeEach(() => { R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1); });

  test('reserva: suma 1 intento, marca ultimoIntentoUtc y NO toca ninguna otra celda', () => {
    const antes = hojas[NOMBRE].filas[1].slice();
    const r = R.propuestaNotificacionesRepository_reservarIntento(NID1, T0 + 1000);
    expect(r.reservada).toBe(true);
    expect(r.notificacion).toMatchObject({ intentos: 1, ultimoIntentoUtc: new Date(T0 + 1000).toISOString() });
    const despues = hojas[NOMBRE].filas[1];
    const idx = (n) => R.PROPUESTA_NOTIF_COLUMNAS.indexOf(n);
    despues.forEach((v, i) => { if (i !== idx('intentos') && i !== idx('ultimoIntentoUtc')) { expect(v).toBe(antes[i]); } });
    expect(despues[idx('intentos')]).toBe(1);
  });

  test('mientras hay un intento en curso (lease) nadie mas lo reserva; pasado el lease, si', () => {
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0).reservada).toBe(true);
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0 + R.PROPUESTA_NOTIF_LEASE_MS - 1)).toMatchObject({ reservada: false, motivo: 'EN_CURSO' });
    expect(hojas[NOMBRE].filas[1][9]).toBe(1);
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0 + R.PROPUESTA_NOTIF_LEASE_MS).reservada).toBe(true);
    expect(hojas[NOMBRE].filas[1][9]).toBe(2);
  });

  test('ENVIADA y OMITIDA no se reservan (YA_PROCESADA) y no se modifican', () => {
    ['ENVIADA', 'OMITIDA'].forEach((estado) => {
      hojas[NOMBRE].filas[1][8] = estado;
      const antes = JSON.stringify(hojas[NOMBRE].filas);
      expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0 + 10 * R.PROPUESTA_NOTIF_LEASE_MS)).toMatchObject({ reservada: false, motivo: 'YA_PROCESADA' });
      expect(JSON.stringify(hojas[NOMBRE].filas)).toBe(antes);
    });
  });

  test('con el maximo de intentos: AGOTADA y no se modifica', () => {
    hojas[NOMBRE].filas[1][8] = 'ERROR';
    hojas[NOMBRE].filas[1][9] = R.PROPUESTA_NOTIF_MAX_INTENTOS;
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0 + 99 * R.PROPUESTA_NOTIF_LEASE_MS)).toMatchObject({ reservada: false, motivo: 'AGOTADA' });
    expect(hojas[NOMBRE].filas[1][9]).toBe(R.PROPUESTA_NOTIF_MAX_INTENTOS);
  });

  test('un intento menos que el maximo todavia se reserva', () => {
    hojas[NOMBRE].filas[1][8] = 'ERROR';
    hojas[NOMBRE].filas[1][9] = R.PROPUESTA_NOTIF_MAX_INTENTOS - 1;
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0).reservada).toBe(true);
    expect(hojas[NOMBRE].filas[1][9]).toBe(R.PROPUESTA_NOTIF_MAX_INTENTOS);
  });

  test('un id que no existe: NO_EXISTE', () => {
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID2, T0)).toEqual({ reservada: false, motivo: 'NO_EXISTE' });
  });

  test('una fecha de ultimo intento ilegible no bloquea el reintento', () => {
    hojas[NOMBRE].filas[1][11] = 'no es fecha';
    expect(R.propuestaNotificacionesRepository_reservarIntento(NID1, T0).reservada).toBe(true);
  });

  test('es bajo lock, que se libera', () => {
    R.propuestaNotificacionesRepository_reservarIntento(NID1, T0);
    expect(lock.waitLock).toHaveBeenCalledTimes(2);
    expect(lock.releaseLock).toHaveBeenCalledTimes(2);
  });
});

describe('registrarResultado: solo los campos permitidos', () => {
  beforeEach(() => { R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1); });

  test('escribe estado, enviadoUtc, ultimoError y destinatariosEnviados; devuelve true', () => {
    expect(R.propuestaNotificacionesRepository_registrarResultado(NID1, { estado: 'ENVIADA', enviadoUtc: ISO0, ultimoError: '', destinatariosEnviados: 'a@example.com;b@example.com' })).toBe(true);
    const o = R.propuestaNotificacionesRepository_leerTodas()[0];
    expect(o).toMatchObject({ estado: 'ENVIADA', enviadoUtc: ISO0, ultimoError: '', destinatariosEnviados: 'a@example.com;b@example.com', intentos: 0 });
  });

  test('un campo que no esta permitido (tipo, propuestaId, intentos, permisos...) se IGNORA', () => {
    R.propuestaNotificacionesRepository_registrarResultado(NID1, { estado: 'ERROR', tipo: 'OTRO', propuestaId: 'zzz', intentos: 99, permisosValidador: 'datos', wellId: '00-0000', notificacionId: 'x' });
    expect(R.propuestaNotificacionesRepository_leerTodas()[0]).toMatchObject({ estado: 'ERROR', tipo: 'ITF', propuestaId: ID1, intentos: 0, permisosValidador: 'perfil,perfil_validar', wellId: '14-0130', notificacionId: NID1 });
  });

  test('lo que se actualiza tambien va como TEXTO PLANO (un error que empiece con "=" no se evalua) e intentos como numero', () => {
    hojas[NOMBRE].formatos = {};
    R.propuestaNotificacionesRepository_registrarResultado(NID1, { ultimoError: '=1+1' });
    const col = (nombre) => R.PROPUESTA_NOTIF_COLUMNAS.indexOf(nombre) + 1;
    expect(hojas[NOMBRE].formatos['2:' + col('ultimoError')]).toBe('@');
    expect(hojas[NOMBRE].formatos['2:' + col('destinatariosEnviados')]).toBe('@');
    hojas[NOMBRE].formatos = {};
    R.propuestaNotificacionesRepository_reservarIntento(NID1, T0);
    expect(hojas[NOMBRE].formatos['2:' + col('intentos')]).toBe('0');
    expect(hojas[NOMBRE].formatos['2:' + col('ultimoIntentoUtc')]).toBe('@');
  });

  test('ultimoError se acota a 160 caracteres', () => {
    R.propuestaNotificacionesRepository_registrarResultado(NID1, { ultimoError: 'e'.repeat(500) });
    expect(R.propuestaNotificacionesRepository_leerTodas()[0].ultimoError).toHaveLength(R.PROPUESTA_NOTIF_ULTIMO_ERROR_MAX);
  });

  test('una fila que no existe devuelve false y no escribe', () => {
    const antes = JSON.stringify(hojas[NOMBRE].filas);
    expect(R.propuestaNotificacionesRepository_registrarResultado(NID2, { estado: 'ENVIADA' })).toBe(false);
    expect(JSON.stringify(hojas[NOMBRE].filas)).toBe(antes);
  });

  test('conserva una columna extra que alguien agrego a la hoja', () => {
    const header = R.PROPUESTA_NOTIF_COLUMNAS.concat(['nota manual']);
    montar({ [NOMBRE]: [header] });
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    hojas[NOMBRE].filas[1][15] = 'revisar con Ana';
    R.propuestaNotificacionesRepository_registrarResultado(NID1, { estado: 'ENVIADA' });
    R.propuestaNotificacionesRepository_reservarIntento(NID1, T0);
    expect(hojas[NOMBRE].filas[1][15]).toBe('revisar con Ana');
  });
});

describe('reintentables (para procesar pendientes)', () => {
  const n = (extra) => Object.assign({ tipo: 'ITF', propuestaId: 'a', estado: 'PENDIENTE', intentos: 0, ultimoIntentoUtc: '' }, extra || {});

  test.each([
    ['PENDIENTE nueva', n(), true],
    ['ERROR con intentos', n({ estado: 'ERROR', intentos: 2, ultimoIntentoUtc: new Date(T0 - 400000).toISOString() }), true],
    ['ENVIADA', n({ estado: 'ENVIADA' }), false],
    ['OMITIDA', n({ estado: 'OMITIDA' }), false],
    ['estado desconocido', n({ estado: 'RARO' }), false],
    ['agotada', n({ estado: 'ERROR', intentos: 5 }), false],
    ['en curso (lease)', n({ estado: 'ERROR', intentos: 1, ultimoIntentoUtc: new Date(T0 - 1000).toISOString() }), false],
    ['justo al vencer el lease', n({ estado: 'ERROR', intentos: 1, ultimoIntentoUtc: new Date(T0 - 300000).toISOString() }), true],
    ['fecha ilegible', n({ estado: 'ERROR', intentos: 1, ultimoIntentoUtc: 'nada' }), true]
  ])('%s -> %s', (nombre, fila, esperado) => {
    expect(R.propuestaNotificacionesRepository_esReintentable(fila, T0)).toBe(esperado);
  });

  test('filtrar: respeta el orden de la hoja, el limite, ignora repetidas y no cuenta las que no son reintentables', () => {
    const lista = [n({ propuestaId: '1', estado: 'ENVIADA' }), n({ propuestaId: '2' }), n({ propuestaId: '2' }), n({ propuestaId: '3', estado: 'ERROR', intentos: 5 }), n({ propuestaId: '4' }), n({ propuestaId: '5' }), n({ tipo: 'FOTO', propuestaId: '2' })];
    expect(R.propuestaNotificacionesRepository_filtrarReintentables(lista, T0, 3).map((x) => x.tipo + x.propuestaId)).toEqual(['ITF2', 'ITF4', 'ITF5']);
    expect(R.propuestaNotificacionesRepository_filtrarReintentables(lista, T0, 1).map((x) => x.propuestaId)).toEqual(['2']);
    expect(R.propuestaNotificacionesRepository_filtrarReintentables(lista, T0, 0)).toEqual([]);
    expect(R.propuestaNotificacionesRepository_filtrarReintentables(null, T0, 5)).toEqual([]);
  });

  test('listarReintentables lee la hoja una vez y filtra', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    R.propuestaNotificacionesRepository_asegurar(entrada({ propuestaId: 'bbbb' }), ISO0, NID2);
    R.propuestaNotificacionesRepository_registrarResultado(NID1, { estado: 'ENVIADA' });
    expect(R.propuestaNotificacionesRepository_listarReintentables(T0, 10).map((x) => x.propuestaId)).toEqual(['bbbb']);
  });

  test('contarPorEstado', () => {
    R.propuestaNotificacionesRepository_asegurar(entrada(), ISO0, NID1);
    R.propuestaNotificacionesRepository_asegurar(entrada({ propuestaId: 'bbbb' }), ISO0, NID2);
    R.propuestaNotificacionesRepository_registrarResultado(NID2, { estado: 'ERROR' });
    hojas[NOMBRE].filas.push(['3', 'ITF', 'c', '', '', '', '', '', 'RARO', 0, '', '', '', '', '']);
    expect(R.propuestaNotificacionesRepository_contarPorEstado()).toEqual({ PENDIENTE: 1, ENVIADA: 0, ERROR: 1, OMITIDA: 0, OTRO: 1 });
  });
});
