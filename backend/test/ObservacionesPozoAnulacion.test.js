// Anulacion de observaciones (E5-3): unidades puras del servicio (validacion de la entrada, propiedad por email normalizado, matriz de permisos, decision) y del repositorio
// (buscarPorObservacionId, escribirEvento / agregarAnulada). El recorrido completo por doPost esta en ApiAnularObservacionPozo.test.js.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const R = require('../src/ObservacionesPozoRepository');
const S = require('../src/ObservacionesPozoService');

const COLUMNAS = R.OBSERVACIONES_POZO_COLUMNAS;
const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-' + String(n).padStart(8, '0') }, extra || {}));
const anulada = (n, id, extra) => fila(Object.assign({ observacionId: uuid(id), evento: 'ANULADA', wellId: W, motivo: 'error', email: 'mod@x.com', nombre: 'Mod', timestampUtc: ISO, secuencia: n, clientRequestId: 'reqA-' + String(n).padStart(7, '0') }, extra || {}));
let hojas;
const armar = (filas) => { hojas = instalarSheetsFalsos({ ObservacionesPozo: [COLUMNAS].concat(filas || []) }); return hojas.ObservacionesPozo; };

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Object.assign(global, R, S);
});

describe('validarAnulacion: entrada {observacionId, motivo, clientRequestId}', () => {
  const ok = { observacionId: uuid(1), motivo: 'Dato duplicado', clientRequestId: 'req-12345678' };
  const v = (extra) => S.observacionesPozoService_validarAnulacion(Object.assign({}, ok, extra || {}));

  test('entrada valida: observacionId en minuscula, motivo normalizado, clientRequestId tal cual', () => {
    expect(v({ observacionId: ' ' + uuid(1).toUpperCase() + ' ', motivo: '  a\r\nb  ' })).toEqual({ ok: true, valores: { observacionId: uuid(1), motivo: 'a\nb', clientRequestId: 'req-12345678' } });
  });

  test('sin datos / datos no objeto', () => {
    expect(S.observacionesPozoService_validarAnulacion(undefined).code).toBe('INVALID_OBSERVACION_ID');
    expect(S.observacionesPozoService_validarAnulacion(null).code).toBe('INVALID_OBSERVACION_ID');
  });

  test.each([[undefined], [null], [''], ['   '], ['ab'], ['a'.repeat(301)], [5], [{}], [[]], [true], ['\u0007\u0000 ']])('motivo %j -> INVALID_MOTIVO', (motivo) => {
    expect(v({ motivo })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
  });

  test('limites exactos 3 y 300 (caracteres unicos)', () => {
    expect(S.OBSERVACIONES_POZO_MOTIVO_MIN).toBe(3);
    expect(S.OBSERVACIONES_POZO_MOTIVO_MAX).toBe(300);
    expect(v({ motivo: 'abc' }).ok).toBe(true);
    expect(v({ motivo: 'a'.repeat(300) }).ok).toBe(true);
    expect(v({ motivo: 'a'.repeat(301) }).ok).toBe(false);
    expect(v({ motivo: '\u{1F600}'.repeat(300) }).ok).toBe(true);
    expect(v({ motivo: '\u{1F600}'.repeat(301) }).ok).toBe(false);
    expect(v({ motivo: '\u{1F600}\u{1F600}' }).ok).toBe(false);
  });

  test('el mensaje de error nunca repite el motivo', () => {
    const r = v({ motivo: 'SECRETO'.padEnd(400, 'x') });
    expect(JSON.stringify(r)).not.toContain('SECRETO');
    expect(JSON.stringify(v({ motivo: 'ab' }))).not.toContain('ab"');
  });

  test.each([[undefined], [null], [''], ['abc'], [123], [{}], [uuid(1) + '0'], [uuid(1).replace(/-/g, '')]])('observacionId %j -> INVALID_OBSERVACION_ID', (observacionId) => {
    expect(v({ observacionId })).toMatchObject({ ok: false, code: 'INVALID_OBSERVACION_ID' });
  });

  test.each([[undefined], [null], [''], ['corto'], ['a'.repeat(65)], ['con espacios 12345'], ['raro/12345678'], [12345678], [{}]])('clientRequestId %j -> INVALID_CLIENT_REQUEST_ID', (clientRequestId) => {
    expect(v({ clientRequestId })).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' });
  });

  test('orden de validacion: observacionId, motivo, clientRequestId', () => {
    expect(v({ observacionId: 'x', motivo: '', clientRequestId: '' }).code).toBe('INVALID_OBSERVACION_ID');
    expect(v({ motivo: '', clientRequestId: '' }).code).toBe('INVALID_MOTIVO');
    expect(v({ clientRequestId: '' }).code).toBe('INVALID_CLIENT_REQUEST_ID');
  });

  test('la normalizacion del motivo es la MISMA que la del texto', () => {
    ['  uno\r\ndos\t \u0007 tres \u{1F4A7}  ', '‮abc‬', 'a‍b', 'x\ud800yz  '].forEach((t) => {
      expect(v({ motivo: t }).valores.motivo).toBe(S.observacionesPozoService_normalizarTexto(t));
    });
  });
});

describe('propiedad: SOLO por email normalizado', () => {
  const p = S.observacionesPozoService_esPropia;

  test.each([
    ['ana@x.com', 'ana@x.com', true],
    ['ana@x.com', '  ANA@X.Com ', true],
    ['  Ana@X.COM', 'ana@x.com\t', true],
    ['ana@x.com', 'beto@x.com', false],
    ['ana@x.com', '', false],
    ['ana@x.com', null, false],
    ['ana@x.com', undefined, false],
    ['', '', false],
    [null, null, false],
    ['ana', 'ana', false],                                // sin forma de email: no se puede afirmar
    ['ana@', 'ana@', false],
    ['@x.com', '@x.com', false],
    ['a na@x.com', 'a na@x.com', false],
    ['ana@x.com', 'ana@x.com.ar', false],
    ['ana@x.com', 'xana@x.com', false]
  ])('esPropia(%j, %j) = %s', (sesion, alta, esperado) => {
    expect(p(sesion, alta)).toBe(esperado);
  });

  test('no mira ningun nombre', () => {
    expect(p.length).toBe(2);
  });
});

describe('puedeAnular: matriz de permisos {observaciones, agregar, anular} x autoria', () => {
  const obs = { email: 'ana@x.com' };
  const puede = (permisos, emailSesion, o) => S.observacionesPozoService_puedeAnular(emailSesion, permisos, o || obs);

  test.each([
    // [observaciones, agregar, anular, esAutor, esperado]
    [true, true, false, true, true],
    [true, true, false, false, false],
    [true, false, false, true, false],
    [true, false, false, false, false],
    [true, false, true, true, true],
    [true, false, true, false, true],
    [true, true, true, true, true],
    [true, true, true, false, true],
    [false, true, false, true, false],                    // D: agregar sin observaciones
    [false, false, true, false, false],                   // C: anular sin observaciones
    [false, true, true, true, false],
    [false, false, false, true, false]
  ])('observaciones=%s agregar=%s anular=%s autor=%s -> %s', (observaciones, agregar, anular, autor, esperado) => {
    expect(puede({ observaciones, agregar, anular }, autor ? 'ana@x.com' : 'beto@x.com')).toBe(esperado);
  });

  test.each([[1], ['SI'], ['true'], [{}], [[]], ['1']])('valores truthy que no son true (%j): nada se habilita', (valor) => {
    expect(puede({ observaciones: valor, agregar: true, anular: true }, 'ana@x.com')).toBe(false);
    expect(puede({ observaciones: true, agregar: valor, anular: valor }, 'ana@x.com')).toBe(false);
  });

  test('el moderador anula aunque el email historico sea invalido; el autor no', () => {
    expect(puede({ observaciones: true, agregar: false, anular: true }, 'mod@x.com', { email: '' })).toBe(true);
    expect(puede({ observaciones: true, agregar: true, anular: false }, 'ana@x.com', { email: '' })).toBe(false);
    expect(puede({ observaciones: true, agregar: true, anular: false }, 'ana@x.com', { email: 'ana' })).toBe(false);
  });

  test('anular() sin permisos suficientes ni siquiera toca la hoja (fail-closed antes de leer)', () => {
    armar([alta(1)]);
    const spy = jest.spyOn(hojas.ObservacionesPozo, 'getRange');
    [{}, { observaciones: true }, { agregar: true }, { anular: true }, { observaciones: 1, anular: true }, { observaciones: true, agregar: 'SI' }, undefined, null].forEach((p) => {
      expect(S.observacionesPozoService_anular('ana@x.com', 'Ana', { observacionId: uuid(1), motivo: 'abc', clientRequestId: 'req-12345678' }, p)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('repositorio: buscarPorObservacionId', () => {
  test('encuentra todas las filas del id (cualquier evento), sin distinguir mayusculas ni espacios de la celda', () => {
    armar([alta(1), alta(2), anulada(3, 1), alta(4, { observacionId: '  ' + uuid(5).toUpperCase() + ' ' })]);
    const r = R.observacionesPozoRepository_buscarPorObservacionId(uuid(1));
    expect(r.total).toBe(2);
    expect(r.eventos.map((e) => [e.evento, e.fila, e.secuencia])).toEqual([['ALTA', 2, 1], ['ANULADA', 4, 3]]);
    expect(R.observacionesPozoRepository_buscarPorObservacionId(uuid(5)).total).toBe(1);
    expect(R.observacionesPozoRepository_buscarPorObservacionId(uuid(9))).toEqual({ total: 0, eventos: [] });
  });

  test('hoja sin filas de datos -> total 0', () => {
    armar([]);
    expect(R.observacionesPozoRepository_buscarPorObservacionId(uuid(1))).toEqual({ total: 0, eventos: [] });
  });

  test('con muchas filas del mismo id devuelve el total real pero solo las primeras 10 (acotado)', () => {
    const filas = [];
    for (let i = 1; i <= 15; i += 1) { filas.push(anulada(i, 1, { clientRequestId: 'r-' + String(i).padStart(8, '0') })); }
    armar(filas);
    const r = R.observacionesPozoRepository_buscarPorObservacionId(uuid(1));
    expect(r.total).toBe(15);
    expect(r.eventos).toHaveLength(R.OBSERVACIONES_POZO_MAX_FILAS_POR_ID);
  });

  test('lee el encabezado, la columna de ids UNA vez y despues solo las filas que coinciden (no toda la hoja)', () => {
    const filas = [];
    for (let i = 1; i <= 300; i += 1) { filas.push(alta(i)); }
    const hoja = armar(filas);
    const lecturas = [];
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => { const g = original(f, c, nf, nc); const gv = g.getValues.bind(g); g.getValues = () => { lecturas.push(nf * nc); return gv(); }; return g; };
    R.observacionesPozoRepository_buscarPorObservacionId(uuid(150));
    expect(lecturas.reduce((a, b) => a + b, 0)).toBeLessThan(300 + 3 * COLUMNAS.length);
    expect(lecturas).toEqual([COLUMNAS.length, 300, COLUMNAS.length]);                     // encabezado, columna de ids, la unica fila que coincide
  });

  test('una hoja con esquema roto o inexistente lanza (fail-closed)', () => {
    instalarSheetsFalsos({});
    expect(() => R.observacionesPozoRepository_buscarPorObservacionId(uuid(1))).toThrow();
    instalarSheetsFalsos({ ObservacionesPozo: [['a', 'b']] });
    expect(() => R.observacionesPozoRepository_buscarPorObservacionId(uuid(1))).toThrow();
  });
});

describe('repositorio: agregarAnulada / escribirEvento', () => {
  const dato = (extra) => Object.assign({ observacionId: uuid(1), wellId: W, motivo: 'Dato duplicado', email: 'mod@x.com', nombre: 'Mod', timestampUtc: ISO, clientRequestId: 'req-12345678' }, extra || {});

  test('escribe UNA fila ANULADA con texto y categoria vacios y la secuencia max + 1, con formatos de texto plano', () => {
    const hoja = armar([alta(1), alta(7)]);
    const e = R.observacionesPozoRepository_agregarAnulada(dato());
    expect(e).toMatchObject({ evento: 'ANULADA', texto: '', categoria: '', secuencia: 8, motivo: 'Dato duplicado' });
    expect(hoja.filas).toHaveLength(4);
    const f = {}; COLUMNAS.forEach((c, i) => { f[c] = hoja.filas[3][i]; });
    expect(f).toMatchObject({ observacionId: uuid(1), evento: 'ANULADA', wellId: W, texto: '', categoria: '', motivo: 'Dato duplicado', email: 'mod@x.com', nombre: 'Mod', timestampUtc: ISO, secuencia: 8, clientRequestId: 'req-12345678' });
    COLUMNAS.forEach((c, i) => expect(hoja.formatos['4:' + (i + 1)]).toBe(c === 'secuencia' ? '0' : '@'));
  });

  test('ignora un texto o una categoria que se le pase: la anulacion NUNCA lleva el texto original', () => {
    const hoja = armar([alta(1)]);
    R.observacionesPozoRepository_agregarAnulada(dato({ texto: 'copia indebida', categoria: 'x' }));
    expect(hoja.filas[2][COLUMNAS.indexOf('texto')]).toBe('');
    expect(hoja.filas[2][COLUMNAS.indexOf('categoria')]).toBe('');
  });

  test('agregarAlta sigue escribiendo una ALTA con motivo vacio', () => {
    const hoja = armar([]);
    const e = R.observacionesPozoRepository_agregarAlta({ observacionId: uuid(1), wellId: W, texto: 'Hola', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'req-12345678' });
    expect(e).toMatchObject({ evento: 'ALTA', motivo: '', categoria: '', texto: 'Hola', secuencia: 1 });
    expect(hoja.filas[1][COLUMNAS.indexOf('motivo')]).toBe('');
  });

  test('escribirEvento SIEMPRE asigna la secuencia: ignora la que traiga el evento', () => {
    const hoja = armar([alta(1)]);
    const e = R.observacionesPozoRepository_escribirEvento({ observacionId: uuid(2), evento: 'ALTA', wellId: W, texto: 'x', categoria: '', motivo: '', email: 'a@x.com', nombre: '', timestampUtc: ISO, clientRequestId: 'req-12345678', secuencia: 99 });
    expect(e.secuencia).toBe(2);
    expect(hoja.filas[2][COLUMNAS.indexOf('secuencia')]).toBe(2);
  });

  test('si la secuencia no se puede calcular con seguridad, LANZA y no escribe', () => {
    const hoja = armar([alta(1, { secuencia: 3 }), alta(2, { secuencia: 3 })]);
    expect(() => R.observacionesPozoRepository_agregarAnulada(dato())).toThrow(/secuencia/);
    expect(hoja.filas).toHaveLength(3);
  });

  test('el nombre vacio queda vacio (no "undefined")', () => {
    const hoja = armar([alta(1)]);
    R.observacionesPozoRepository_agregarAnulada(dato({ nombre: undefined }));
    expect(hoja.filas[2][COLUMNAS.indexOf('nombre')]).toBe('');
  });
});

describe('resolverObjetivo y decidirAnulacion (unidades sobre la hoja en memoria)', () => {
  const valores = (extra) => Object.assign({ observacionId: uuid(1), motivo: 'Dato duplicado', clientRequestId: 'req-12345678' }, extra || {});
  const todos = { observaciones: true, agregar: true, anular: true };

  test('resolverObjetivo: ACTIVA, ANULADA, no existe, ambigua', () => {
    armar([alta(1), alta(2), anulada(3, 2), alta(4), alta(4, { secuencia: 5, clientRequestId: 'req-00000005' })]);
    expect(S.observacionesPozoService_resolverObjetivo(uuid(1))).toMatchObject({ ok: true, wellId: W, obs: { estado: 'ACTIVA', email: 'ana@x.com' } });
    expect(S.observacionesPozoService_resolverObjetivo(uuid(2))).toMatchObject({ ok: true, obs: { estado: 'ANULADA' } });
    expect(S.observacionesPozoService_resolverObjetivo(uuid(9))).toMatchObject({ ok: false, code: 'OBSERVACION_NOT_FOUND' });
    expect(S.observacionesPozoService_resolverObjetivo(uuid(4))).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
  });

  test('decidirAnulacion: orden objetivo -> autorizacion -> idempotencia -> transicion -> escribir', () => {
    armar([alta(1), alta(2, { email: 'beto@x.com' })]);
    expect(S.observacionesPozoService_decidirAnulacion('ana@x.com', todos, valores({ observacionId: uuid(9) })).code).toBe('OBSERVACION_NOT_FOUND');
    expect(S.observacionesPozoService_decidirAnulacion('ana@x.com', { observaciones: true, agregar: true, anular: false }, valores({ observacionId: uuid(2) })).code).toBe('PERMISSION_DENIED');
    expect(S.observacionesPozoService_decidirAnulacion('ana@x.com', todos, valores())).toMatchObject({ ok: true, escribir: true });
  });

  test('decidirAnulacion: un reintento existente NO salta la autorizacion', () => {
    armar([alta(1), anulada(2, 1, { email: 'todo@x.com', nombre: 'Todo', motivo: 'Dato duplicado', clientRequestId: 'req-12345678' })]);
    expect(S.observacionesPozoService_decidirAnulacion('todo@x.com', todos, valores())).toMatchObject({ ok: true, duplicada: true });
    expect(S.observacionesPozoService_decidirAnulacion('todo@x.com', { observaciones: true, agregar: true, anular: false }, valores())).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });

  test('decidirAnulacion con permiso denegado informa el pozo conocido (para el Historial) pero no el contenido', () => {
    armar([alta(1)]);
    const r = S.observacionesPozoService_decidirAnulacion('beto@x.com', { observaciones: true, agregar: true, anular: false }, valores());
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED', wellId: W });
    expect(JSON.stringify(r)).not.toMatch(/Texto 1|ana@x\.com/);
  });
});
