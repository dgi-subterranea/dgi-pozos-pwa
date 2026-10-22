// Alta de observaciones (E5-2), nivel unitario: normalizacion y validacion del texto, de la categoria y del clientRequestId; calculo FAIL-CLOSED de la secuencia; busqueda por
// clientRequestId; y la escritura de la fila ALTA en el repositorio (una sola fila, formato de texto plano antes de los valores, nada escrito si algo falla). Hoja en memoria.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const S = require('../src/ObservacionesPozoService');
const R0 = require('../src/ObservacionesPozoRepository');

let R;
let hojas;

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COLS = R0.OBSERVACIONES_POZO_COLUMNAS;
const fila = (o) => COLS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'req-' + String(n).padStart(8, '0') }, extra || {}));

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  R = require('../src/ObservacionesPozoRepository');
  Object.assign(global, R);
});

const armar = (filas, header) => { hojas = instalarSheetsFalsos({ ObservacionesPozo: [header || COLS].concat(filas || []) }); return hojas.ObservacionesPozo; };
const norm = S.observacionesPozoService_normalizarTexto;

describe('normalizarTexto: la regla exacta', () => {
  test.each([
    ['trim de los extremos', '  abc  ', 'abc'],
    ['trim de saltos de linea y espacios mezclados en los extremos', '\n \n  hola \n\n', 'hola'],
    ['conserva los espacios internos (no los colapsa)', 'a   b    c', 'a   b    c'],
    ['conserva las lineas en blanco internas (no las colapsa)', 'uno\n\n\ndos', 'uno\n\n\ndos'],
    ['multilinea conserva los saltos', 'linea 1\nlinea 2\nlinea 3', 'linea 1\nlinea 2\nlinea 3'],
    ['CRLF -> LF', 'a\r\nb\r\nc', 'a\nb\nc'],
    ['CR solo -> LF', 'a\rb', 'a\nb'],
    ['mezcla CRLF / CR / LF -> LF', 'a\r\nb\rc\nd', 'a\nb\nc\nd'],
    ['NEL, LS y PS -> LF', 'a\u0085b c d', 'a\nb\nc\nd'],
    ['el tabulador pasa a UN espacio (no pega palabras)', 'a\tb', 'a b'],
    ['conserva acentos y enie', 'Pozo ubicado en Maipu: cañería rota, ¡revisar!', 'Pozo ubicado en Maipu: cañería rota, ¡revisar!'],
    ['conserva emoji (incluidos los compuestos con ZWJ)', 'Tapa dañada 🚧 familia 👨‍👩‍👧', 'Tapa dañada 🚧 familia 👨‍👩‍👧'],
    ['conserva otros alfabetos y marcas de direccion RTL', 'مرحبا‏abc 你好', 'مرحبا‏abc 你好'],
    ['conserva el espacio de no separacion interno', 'a b', 'a b'],
    ['elimina controles C0 (NUL, BEL, BS, VT, FF, ESC, US)', 'a\u0000b\u0007c\u0008d\u000be\u000cf\u001bg\u001fh', 'abcdefgh'],
    ['elimina DEL y los controles C1', 'a\u007fb\u0080c\u0090d\u009fe', 'abcde'],
    ['elimina los controles direccionales explicitos y el BOM', 'a‪b‮c⁦d⁩e﻿f', 'abcdef'],
    ['elimina surrogates sueltos (UTF-16 invalido) pero no los pares', 'a\ud83db \ude00c 😀', 'ab c 😀'],
    ['una formula queda como TEXTO tal cual (no se toca)', '=SUM(A1:A9)', '=SUM(A1:A9)'],
    ['no hace nada con una cadena vacia', '', '']
  ])('%s', (n, entrada, esperado) => {
    expect(norm(entrada)).toBe(esperado);
  });

  test('un valor que no es un string -> null (no se coacciona)', () => {
    [undefined, null, 5, true, false, {}, [], ['abc']].forEach((v) => expect(norm(v)).toBeNull());
  });

  test('solo espacios / saltos / controles -> cadena vacia', () => {
    expect(norm('   \n\t  \r\n ')).toBe('');
    expect(norm('\u0000\u0001\u0002')).toBe('');
  });

  test('es idempotente: normalizar dos veces da lo mismo', () => {
    ['  a\r\nb\t\u0000c  ', '\n\nx y\n', '=1+1', 'ok 😀'].forEach((x) => expect(norm(norm(x))).toBe(norm(x)));
  });
});

describe('validarAlta: texto', () => {
  const v = (texto, extra) => S.observacionesPozoService_validarAlta(Object.assign({ texto: texto, clientRequestId: 'abc-12345' }, extra || {}));
  const rep = (c, n) => c.repeat(n);

  test('limites exactos: 3 caracteres si, 2 no; 1000 si, 1001 no', () => {
    expect(v('abc')).toMatchObject({ ok: true, valores: { texto: 'abc' } });
    expect(v('ab')).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
    expect(v(rep('a', 1000)).ok).toBe(true);
    expect(v(rep('a', 1001))).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
  });

  test('el largo se cuenta DESPUES de normalizar (trim, CRLF, controles)', () => {
    expect(v('  ab  ')).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });             // 2 tras el trim
    expect(v('  abc  ').ok).toBe(true);
    expect(v('a\u0000b\u0000')).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });    // 2 tras quitar controles
    expect(v('a\r\nb').ok).toBe(true);                                                  // "a\nb" = 3 (CRLF cuenta como un solo salto)
    expect(v(rep('a', 1000) + '   \n  ').ok).toBe(true);                                // el trim lo deja en 1000
    expect(v(rep('a', 1000) + '\u0000\u0000').ok).toBe(true);                           // los controles no cuentan: sigue en 1000
    expect(v(rep('a', 1001) + '\u0000').ok).toBe(false);                                // 1001 tras quitar controles
  });

  test('el largo se cuenta en caracteres unicos: un emoji es 1 (no 2)', () => {
    expect(v('😀😀😀').ok).toBe(true);
    expect(v('😀😀')).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
    expect(v(rep('😀', 1000)).ok).toBe(true);
    expect(v(rep('😀', 1001)).ok).toBe(false);
    expect(S.observacionesPozoService_largoTexto('a😀ñ')).toBe(3);
  });

  test.each([[undefined], [null], [''], ['   '], ['\n\n'], ['\t \r\n'], ['\u0000\u0001\u0002\u0003'], [123], [true], [{}], [['abc']]])('texto %j -> INVALID_TEXTO', (texto) => {
    expect(S.observacionesPozoService_validarAlta({ texto: texto, clientRequestId: 'abc-12345' })).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
  });

  test('sin datos: INVALID_TEXTO', () => {
    expect(S.observacionesPozoService_validarAlta()).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
    expect(S.observacionesPozoService_validarAlta(null)).toMatchObject({ ok: false, code: 'INVALID_TEXTO' });
  });

  test('el mensaje de error NUNCA repite el texto', () => {
    const r = v('xy');
    expect(JSON.stringify(r)).not.toContain('xy"');
    expect(r.message).not.toContain('xy');
    expect(S.observacionesPozoService_validarAlta({ texto: 'contenido-secreto', categoria: 'CAT', clientRequestId: 'abc-12345' }).message).not.toContain('contenido-secreto');
  });

  test('devuelve el texto YA normalizado y la categoria vacia', () => {
    expect(v('  hola\r\nmundo  ')).toEqual({ ok: true, valores: { texto: 'hola\nmundo', categoria: '', clientRequestId: 'abc-12345' } });
  });
});

describe('validarAlta: categoria (reservada: solo vacio)', () => {
  const v = (extra) => S.observacionesPozoService_validarAlta(Object.assign({ texto: 'abc', clientRequestId: 'abc-12345' }, extra));

  test.each([[{}], [{ categoria: undefined }], [{ categoria: null }], [{ categoria: '' }], [{ categoria: '   ' }], [{ categoria: '\n\t ' }]])('%j -> ok, se guarda vacia', (extra) => {
    expect(v(extra)).toMatchObject({ ok: true, valores: { categoria: '' } });
  });

  test.each([[{ categoria: 'OTRO' }], [{ categoria: 'Acceso' }], [{ categoria: ' OTRO ' }], [{ categoria: '0' }], [{ categoria: 0 }], [{ categoria: 1 }], [{ categoria: false }], [{ categoria: true }], [{ categoria: {} }], [{ categoria: [] }], [{ categoria: [''] }], [{ categoria: { id: 1 } }]])('%j -> INVALID_CATEGORIA (no se ignora ni se coacciona)', (extra) => {
    expect(v(extra)).toMatchObject({ ok: false, code: 'INVALID_CATEGORIA' });
  });
});

describe('validarAlta: clientRequestId', () => {
  const v = (id) => S.observacionesPozoService_validarAlta({ texto: 'abc', clientRequestId: id });

  test.each([['abcd1234'], ['A_b-C_d-1'], ['x'.repeat(64)], ['550e8400-e29b-41d4-a716-446655440000']])('%s: valido', (id) => {
    expect(v(id).ok).toBe(true);
  });

  test.each([[undefined], [null], [''], ['abc'], ['a'.repeat(7)], ['x'.repeat(65)], ['con espacio'], ['con.punto!'], ['ñandu12345'], [12345678], [{}], [['abcd1234']]])('%j: INVALID_CLIENT_REQUEST_ID', (id) => {
    expect(v(id)).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' });
  });
});

describe('calcularSiguienteSecuencia: max + 1, FAIL-CLOSED', () => {
  const calc = (ids, secs) => R.observacionesPozoRepository_calcularSiguienteSecuencia(ids, secs);

  test('hoja sin filas -> 1', () => {
    expect(calc([], [])).toEqual({ ok: true, siguiente: 1 });
    expect(calc(undefined, undefined)).toEqual({ ok: true, siguiente: 1 });
  });

  test('max + 1, sin depender del orden de las filas', () => {
    expect(calc([uuid(1), uuid(2), uuid(3)], [1, 2, 3])).toEqual({ ok: true, siguiente: 4 });
    expect(calc([uuid(1), uuid(2), uuid(3)], [7, 2, 5])).toEqual({ ok: true, siguiente: 8 });
  });

  test('salta las filas totalmente vacias; acepta numeros como texto de solo digitos y floats enteros', () => {
    expect(calc([uuid(1), '', null, uuid(4)], [3, '', null, '9'])).toEqual({ ok: true, siguiente: 10 });
    expect(calc([uuid(1)], [4.0])).toEqual({ ok: true, siguiente: 5 });
    expect(calc([uuid(1)], [' 12 '])).toEqual({ ok: true, siguiente: 13 });
  });

  test.each([
    ['una secuencia de texto', [uuid(1), uuid(2)], [3, 'abc']],
    ['una secuencia cero', [uuid(1)], [0]],
    ['una secuencia negativa', [uuid(1)], [-2]],
    ['una secuencia fraccionaria', [uuid(1)], [2.5]],
    ['una secuencia con notacion cientifica', [uuid(1)], ['1e3']],
    ['una secuencia infinita', [uuid(1)], [Infinity]],
    ['una secuencia NaN', [uuid(1)], [NaN]],
    ['un observacionId sin secuencia', [uuid(1), uuid(2)], [3, '']],
    ['un observacionId con secuencia nula', [uuid(1)], [null]],
    ['una secuencia sin observacionId', [uuid(1), ''], [3, 4]],
    ['una secuencia booleana', [uuid(1)], [true]]
  ])('%s -> {ok:false} (no se puede calcular el maximo con seguridad)', (n, ids, secs) => {
    const r = calc(ids, secs);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/fila \d+|secuencia maxima/);
  });

  test('el motivo nombra la fila (numero de fila de la hoja) y nunca contenido', () => {
    expect(calc([uuid(1), uuid(2)], [3, 'xyz']).motivo).toBe('la secuencia de la fila 3 no es un entero >= 1');
    expect(calc([uuid(1)], ['']).motivo).toBe('la fila 2 tiene observacionId sin secuencia');
    expect(calc([uuid(1), uuid(2)], [3, null]).motivo).toBe('la fila 3 tiene observacionId sin secuencia');
    expect(calc(['', uuid(2)], [4, 5]).motivo).toBe('la fila 2 tiene secuencia sin observacionId');
  });

  test('una secuencia REPETIDA es una hoja estructuralmente corrupta: {ok:false}, con las dos filas en el motivo (no se renumera ni se elige una)', () => {
    expect(calc([uuid(1), uuid(2)], [5, 5])).toEqual({ ok: false, motivo: 'la secuencia 5 figura en mas de una fila (filas 2 y 3)' });
    expect(calc([uuid(1), uuid(2), uuid(3), uuid(4)], [1, 2, 3, 2]).motivo).toBe('la secuencia 2 figura en mas de una fila (filas 3 y 5)');
  });

  test('la repeticion se detecta aunque una este como numero y otra como texto de digitos, y aunque no sean consecutivas ni el maximo', () => {
    expect(calc([uuid(1), uuid(2)], [5, '5']).ok).toBe(false);
    expect(calc([uuid(1), uuid(2)], ['5', 5]).ok).toBe(false);                       // en el orden inverso tambien
    expect(calc([uuid(1), uuid(2)], [' 7 ', '7']).ok).toBe(false);
    expect(calc([uuid(1), uuid(2), uuid(3)], [1, 9, ' 1 ']).ok).toBe(false);
    expect(calc([uuid(1), uuid(2), uuid(3)], [7, 3, 7]).ok).toBe(false);
  });

  test('tres eventos con la misma secuencia: tambien corrupta', () => {
    expect(calc([uuid(1), uuid(2), uuid(3)], [4, 4, 4]).ok).toBe(false);
  });

  test('filas vacias intercaladas y secuencias distintas: sin corrupcion, max + 1 como siempre', () => {
    expect(calc([uuid(1), '', uuid(3), null, uuid(5)], [1, '', 3, null, 9])).toEqual({ ok: true, siguiente: 10 });
    expect(calc([uuid(1), uuid(2), uuid(3)], [3, 1, 2])).toEqual({ ok: true, siguiente: 4 });
  });

  test('una secuencia repetida impide escribir: agregarAlta LANZA y no escribe nada (ni consume secuencia)', () => {
    const hoja = armar([alta(1, { secuencia: 4 }), alta(2, { secuencia: 4 })]);
    const antes = JSON.stringify(hoja.filas);
    expect(() => R.observacionesPozoRepository_agregarAlta({ observacionId: uuid(77), wellId: W, texto: 'abc', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'req-00000077' })).toThrow(/la secuencia 4 figura en mas de una fila \(filas 2 y 3\).*no se escribio nada/);
    expect(JSON.stringify(hoja.filas)).toBe(antes);
  });

  test('en el limite de enteros seguros no incrementa', () => {
    expect(calc([uuid(1)], [Number.MAX_SAFE_INTEGER - 1]).ok).toBe(false);
  });

  test('siguienteSecuencia lee solo 2 columnas de la hoja y LANZA si no se puede calcular', () => {
    const hoja = armar([alta(1), alta(2, { secuencia: 'x' })]);
    expect(() => R.observacionesPozoRepository_siguienteSecuencia(R.observacionesPozoRepository_hoja())).toThrow(/No se puede calcular la secuencia de forma segura.*fila 3.*no se escribio nada/);
    armar([alta(1), alta(2), alta(3, { secuencia: 10 })]);
    expect(R.observacionesPozoRepository_siguienteSecuencia(R.observacionesPozoRepository_hoja())).toBe(11);
    expect(hoja).toBeDefined();
  });
});

describe('buscarPorClientRequestId', () => {
  test('hoja sin filas: nada', () => {
    armar([]);
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'req-00000001')).toEqual({ total: 0, eventos: [] });
  });

  test('encuentra el evento del usuario con ese id; no el de otro usuario ni el de otro id', () => {
    armar([alta(1), alta(2, { email: 'beto@x.com', clientRequestId: 'req-00000001' }), alta(3)]);
    const r = R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'req-00000001');
    expect(r.total).toBe(1);
    expect(r.eventos[0]).toMatchObject({ observacionId: uuid(1), email: 'ana@x.com', fila: 2 });
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('beto@x.com', 'req-00000001').eventos[0].observacionId).toBe(uuid(2));
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('carla@x.com', 'req-00000001').total).toBe(0);
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'req-99999999').total).toBe(0);
  });

  test('el id distingue mayusculas y el email se normaliza (minuscula, sin espacios)', () => {
    armar([alta(1, { email: ' ANA@X.COM ', clientRequestId: 'ReqAbc123' })]);
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'ReqAbc123').total).toBe(1);
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'reqabc123').total).toBe(0);
  });

  test('busca en CUALQUIER evento (una ANULADA con ese id tambien lo usa)', () => {
    armar([alta(1), fila({ observacionId: uuid(1), evento: 'ANULADA', wellId: W, email: 'ana@x.com', secuencia: 2, clientRequestId: 'req-anul0001' })]);
    expect(R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'req-anul0001').eventos[0].evento).toBe('ANULADA');
  });

  test('con coincidencias repetidas devuelve el total y solo las dos primeras (inconsistencia)', () => {
    armar([alta(1, { clientRequestId: 'dup-0000001' }), alta(2, { clientRequestId: 'dup-0000001' }), alta(3, { clientRequestId: 'dup-0000001' })]);
    const r = R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'dup-0000001');
    expect(r.total).toBe(3);
    expect(r.eventos).toHaveLength(2);
  });

  test('lee 2 columnas completas y despues SOLO las filas que coinciden (no toda la hoja)', () => {
    const filas = [];
    for (let i = 1; i <= 500; i += 1) { filas.push(alta(i, { texto: 'x'.repeat(100) })); }
    const hoja = armar(filas);
    let celdas = 0;
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => { const g = original(f, c, nf, nc); const gv = g.getValues.bind(g); g.getValues = () => { if (f > 1) { celdas += nf * nc; } return gv(); }; return g; };
    R.observacionesPozoRepository_buscarPorClientRequestId('ana@x.com', 'req-' + String(250).padStart(8, '0'));
    expect(celdas).toBe(500 + 500 + 11);                                             // email + clientRequestId + la fila encontrada
  });
});

describe('agregarAlta: la fila que se escribe', () => {
  const datos = (extra) => Object.assign({ observacionId: uuid(77), wellId: W, texto: 'Hola\nmundo', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'req-00000077' }, extra || {});

  test('escribe EXACTAMENTE una fila al final, con todos los campos en las columnas correctas, evento ALTA, categoria y motivo vacios y la secuencia asignada', () => {
    const hoja = armar([alta(1), alta(2)]);
    const e = R.observacionesPozoRepository_agregarAlta(datos());
    expect(hoja.filas).toHaveLength(4);
    expect(hoja.filas[3]).toEqual([uuid(77), 'ALTA', W, 'Hola\nmundo', '', '', 'ana@x.com', 'Ana', ISO, 3, 'req-00000077']);
    expect(e).toMatchObject({ evento: 'ALTA', secuencia: 3, categoria: '', motivo: '' });
  });

  test('en una hoja con solo el encabezado: secuencia 1, en la fila 2', () => {
    const hoja = armar([]);
    expect(R.observacionesPozoRepository_agregarAlta(datos()).secuencia).toBe(1);
    expect(hoja.filas[1][COLS.indexOf('secuencia')]).toBe(1);
  });

  test('respeta el orden REAL de las columnas de la hoja (reordenadas) y deja vacias las desconocidas', () => {
    const header = COLS.slice().reverse().concat(['extra']);
    const hoja = armar([], header);
    R.observacionesPozoRepository_agregarAlta(datos());
    const f = hoja.filas[1];
    const por = {};
    header.forEach((c, i) => { por[c] = f[i]; });
    expect(por).toMatchObject({ observacionId: uuid(77), evento: 'ALTA', wellId: W, texto: 'Hola\nmundo', categoria: '', motivo: '', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: 1, clientRequestId: 'req-00000077', extra: '' });
  });

  test('el cliente NO elige evento, categoria, motivo ni secuencia: se ignoran lo que traiga el objeto', () => {
    const hoja = armar([alta(1)]);
    R.observacionesPozoRepository_agregarAlta(datos({ evento: 'ANULADA', categoria: 'OTRO', motivo: 'x', secuencia: 99 }));
    expect(hoja.filas[2]).toEqual([uuid(77), 'ALTA', W, 'Hola\nmundo', '', '', 'ana@x.com', 'Ana', ISO, 2, 'req-00000077']);
  });

  test('FORMATO DE TEXTO PLANO antes de los valores, en una sola operacion (una formula nunca se evalua)', () => {
    const hoja = armar([alta(1)]);
    const orden = [];
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => {
      const g = original(f, c, nf, nc);
      if (f > 1 && nf === 1 && nc === COLS.length) {
        const sf = g.setNumberFormats.bind(g);
        const sv = g.setValues.bind(g);
        g.setNumberFormats = (x) => { orden.push('formato'); return sf(x); };
        g.setValues = (x) => { orden.push('valores'); return sv(x); };
      }
      return g;
    };
    global.SpreadsheetApp.flush = jest.fn();
    R.observacionesPozoRepository_agregarAlta(datos({ texto: '=HYPERLINK("http://x","y")' }));
    expect(orden).toEqual(['formato', 'valores']);
    COLS.forEach((c, i) => { expect(hoja.formatos['3:' + (i + 1)]).toBe(c === 'secuencia' ? '0' : '@'); });
    expect(hoja.filas[2][COLS.indexOf('texto')]).toBe('=HYPERLINK("http://x","y")');
    expect(global.SpreadsheetApp.flush).toHaveBeenCalledTimes(1);
  });

  test.each([['='], ['+1'], ['-1'], ['@SUM(1)'], ["'=1"], ['\t=1']])('un texto que empieza con %j se guarda tal cual, como texto', (inicio) => {
    const hoja = armar([]);
    const texto = inicio + ' resto';
    R.observacionesPozoRepository_agregarAlta(datos({ texto: texto }));
    expect(hoja.filas[1][COLS.indexOf('texto')]).toBe(texto);
    expect(hoja.formatos['2:' + (COLS.indexOf('texto') + 1)]).toBe('@');
  });

  test('sin escribir NADA si la hoja no existe, esta vacia o tiene el esquema mal (y no se crea)', () => {
    hojas = instalarSheetsFalsos({});
    expect(() => R.observacionesPozoRepository_agregarAlta(datos())).toThrow(/No existe una hoja/);
    expect(hojas.ObservacionesPozo).toBeUndefined();
    const hoja = armar([alta(1)], COLS.filter((c) => c !== 'wellId'));
    const antes = JSON.stringify(hoja.filas);
    expect(() => R.observacionesPozoRepository_agregarAlta(datos())).toThrow(/esquema esperado/);
    expect(JSON.stringify(hoja.filas)).toBe(antes);
    const dup = armar([], COLS.concat(['texto']));
    expect(() => R.observacionesPozoRepository_agregarAlta(datos())).toThrow(/repetidas: texto/);
    expect(dup.filas).toHaveLength(1);
  });

  test('sin escribir NADA si la secuencia no se puede calcular con seguridad (no se "arregla")', () => {
    const hoja = armar([alta(1), alta(2, { secuencia: 'oops' })]);
    const antes = JSON.stringify(hoja.filas);
    expect(() => R.observacionesPozoRepository_agregarAlta(datos())).toThrow(/No se puede calcular la secuencia/);
    expect(JSON.stringify(hoja.filas)).toBe(antes);
  });

  test('una fila en blanco intermedia en la hoja no rompe el calculo ni la posicion de la nueva fila', () => {
    const hoja = armar([alta(1), ['', '', '', '', '', '', '', '', '', '', ''], alta(3)]);
    expect(R.observacionesPozoRepository_agregarAlta(datos()).secuencia).toBe(4);
    expect(hoja.filas).toHaveLength(5);
  });
});
