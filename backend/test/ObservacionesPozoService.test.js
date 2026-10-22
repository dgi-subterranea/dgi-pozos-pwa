// ObservacionesPozoService (E5-1): derivacion pura de las observaciones desde los eventos (fail-safe), privacidad de las anuladas, paginacion por cursor y la lectura de un pozo.
// Sin Sheets: el repositorio se simula (los eventos son datos).
const S = require('../src/ObservacionesPozoService');

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const alta = (n, extra) => Object.assign({ fila: n + 1, observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto ' + n, categoria: '', motivo: '', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n }, extra || {});
const anula = (n, id, extra) => Object.assign({ fila: n + 1, observacionId: uuid(id), evento: 'ANULADA', wellId: W, texto: '', categoria: '', motivo: 'Dato erroneo', email: 'val@x.com', nombre: 'Val', timestampUtc: ISO, secuencia: n }, extra || {});
const derivar = (e) => S.observacionesPozoService_derivar(e);
const ids = (d) => d.observaciones.map((o) => o.observacionId);
const codigos = (d) => d.inconsistencias.map((i) => i.codigo).sort();

describe('derivacion: lo basico', () => {
  test('una ALTA sin anulacion -> ACTIVA, con todo lo suyo', () => {
    const d = derivar([alta(1)]);
    expect(d.activas).toBe(1);
    expect(d.anuladas).toBe(0);
    expect(d.inconsistencias).toEqual([]);
    expect(d.observaciones[0]).toEqual({
      observacionId: uuid(1), wellId: W, secuencia: 1, texto: 'Texto 1', categoria: '', email: 'ana@x.com', nombre: 'Ana', timestamp: ISO, estado: 'ACTIVA', anulacion: null
    });
  });

  test('ALTA + ANULADA posterior -> ANULADA, con quien, cuando y por que', () => {
    const d = derivar([alta(1), anula(2, 1, { nombre: 'Valeria', motivo: 'Tenia un dato personal', timestampUtc: '2026-10-21T10:00:00.000Z' })]);
    expect(d.observaciones).toHaveLength(1);                                    // la ANULADA NO es una observacion independiente
    expect(d.observaciones[0]).toMatchObject({ observacionId: uuid(1), estado: 'ANULADA', anulacion: { nombre: 'Valeria', timestamp: '2026-10-21T10:00:00.000Z', motivo: 'Tenia un dato personal' } });
    expect([d.activas, d.anuladas]).toEqual([0, 1]);
  });

  test('varias observaciones: orden por secuencia DESCENDENTE (la mas reciente primero), no por el orden de la hoja ni por la fecha', () => {
    const d = derivar([alta(5, { timestampUtc: '2026-01-01T00:00:00.000Z' }), alta(9), alta(2, { timestampUtc: '2030-01-01T00:00:00.000Z' }), alta(7)]);
    expect(d.observaciones.map((o) => o.secuencia)).toEqual([9, 7, 5, 2]);
  });

  test('conteos: activas y anuladas', () => {
    const d = derivar([alta(1), alta(2), alta(3), anula(4, 2)]);
    expect([d.activas, d.anuladas]).toEqual([2, 1]);
  });

  test('sin eventos o entradas nulas: vacio', () => {
    expect(derivar([])).toMatchObject({ observaciones: [], activas: 0, anuladas: 0, inconsistencias: [] });
    expect(derivar(null).observaciones).toEqual([]);
    expect(derivar(undefined).observaciones).toEqual([]);
  });

  test('los valores se normalizan: id en mayuscula, evento en minuscula, email, espacios', () => {
    const d = derivar([alta(1, { observacionId: uuid(1).toUpperCase(), evento: ' alta ', email: ' ANA@X.COM ', texto: '  hola  ' }), anula(2, 1, { observacionId: uuid(1).toUpperCase(), evento: 'anulada' })]);
    expect(d.observaciones).toHaveLength(1);
    expect(d.observaciones[0]).toMatchObject({ observacionId: uuid(1), texto: 'hola', email: 'ana@x.com', estado: 'ANULADA' });
  });
});

describe('derivacion: inconsistencias (cada criterio, fail-safe)', () => {
  test('evento desconocido: se ignora', () => {
    const d = derivar([alta(1), alta(2, { evento: 'EDITADA' }), alta(3, { evento: '' })]);
    expect(ids(d)).toEqual([uuid(1)]);
    expect(codigos(d)).toEqual(['EVENTO_DESCONOCIDO', 'EVENTO_DESCONOCIDO']);
  });

  test('fila rota (no es un objeto): se ignora', () => {
    const d = derivar([null, undefined, 'x', 7, alta(1)]);
    expect(ids(d)).toEqual([uuid(1)]);
    expect(codigos(d)).toEqual(['FILA_ROTA', 'FILA_ROTA', 'FILA_ROTA', 'FILA_ROTA']);
  });

  test('observacionId que no es un UUID: se ignora (ALTA y ANULADA)', () => {
    const d = derivar([alta(1), alta(2, { observacionId: 'abc' }), alta(3, { observacionId: '' }), anula(4, 1, { observacionId: 'no-es-uuid' })]);
    expect(ids(d)).toEqual([uuid(1)]);
    expect(d.observaciones[0].estado).toBe('ACTIVA');                           // una anulacion con id roto no puede referenciar nada: ni anula ni inventa
    expect(codigos(d)).toEqual(['ID_INVALIDO', 'ID_INVALIDO', 'ID_INVALIDO']);
  });

  test.each([
    ['texto vacio', { texto: '' }], ['texto solo espacios', { texto: '   ' }], ['texto nulo', { texto: null }],
    ['wellId vacio', { wellId: '' }], ['wellId mal formado', { wellId: '14-1' }], ['wellId con otro formato', { wellId: 'x' }],
    ['secuencia 0', { secuencia: 0 }], ['secuencia negativa', { secuencia: -3 }], ['secuencia fraccionaria', { secuencia: 1.5 }], ['secuencia nula', { secuencia: null }],
    ['secuencia texto', { secuencia: '3' }], ['secuencia infinita', { secuencia: Infinity }]
  ])('ALTA invalida (%s): no se muestra contenido dudoso', (nombre, extra) => {
    const d = derivar([alta(1, extra), alta(2)]);
    expect(ids(d)).toEqual([uuid(2)]);
    expect(codigos(d)).toEqual(['ALTA_INVALIDA']);
  });

  test('ANULADA huerfana (sin ALTA): se ignora; NO es una observacion', () => {
    const d = derivar([alta(1), anula(2, 99)]);
    expect(ids(d)).toEqual([uuid(1)]);
    expect(d.observaciones[0].estado).toBe('ACTIVA');
    expect(codigos(d)).toEqual(['ANULACION_HUERFANA']);
  });

  test('ANULADA huerfana de una ALTA invalida: tambien huerfana (la alta no se muestra)', () => {
    const d = derivar([alta(1, { texto: '' }), anula(2, 1)]);
    expect(d.observaciones).toEqual([]);
    expect(codigos(d)).toEqual(['ALTA_INVALIDA', 'ANULACION_HUERFANA']);
  });

  test('doble anulacion corrupta: vale la PRIMERA (menor secuencia); autor y motivo son los de esa; nunca "des-anula"', () => {
    const d = derivar([alta(1), anula(8, 1, { nombre: 'Segunda', motivo: 'segunda' }), anula(3, 1, { nombre: 'Primera', motivo: 'primera' }), anula(5, 1, { nombre: 'Tercera', motivo: 'tercera' })]);
    expect(d.observaciones[0]).toMatchObject({ estado: 'ANULADA', anulacion: { nombre: 'Primera', motivo: 'primera' } });
    expect(codigos(d)).toEqual(['ANULACION_DUPLICADA', 'ANULACION_DUPLICADA']);
    expect(d.anuladas).toBe(1);
  });

  test('doble anulacion con la primera SIN secuencia valida: gana la que tiene secuencia; sigue anulada', () => {
    const d = derivar([alta(1), anula(0, 1, { secuencia: null, nombre: 'Sin secuencia' }), anula(6, 1, { nombre: 'Con secuencia' })]);
    expect(d.observaciones[0]).toMatchObject({ estado: 'ANULADA', anulacion: { nombre: 'Con secuencia' } });
  });

  test('ANULADA ANTERIOR al ALTA (secuencia menor): FAIL-SAFE, queda anulada (si no, el texto saldria a la luz)', () => {
    const d = derivar([anula(1, 5), alta(5)]);
    expect(d.observaciones).toHaveLength(1);
    expect(d.observaciones[0].estado).toBe('ANULADA');
    expect(codigos(d)).toEqual(['ANULACION_ANTERIOR_AL_ALTA']);
  });

  test('ANULADA con el resto de la fila roto (sin secuencia, fecha invalida, sin motivo, sin wellId, sin nombre): igual anula', () => {
    const d = derivar([alta(1), anula(2, 1, { secuencia: null, timestampUtc: 'basura', motivo: '', wellId: '', nombre: '', email: '' })]);
    expect(d.observaciones[0]).toMatchObject({ estado: 'ANULADA', anulacion: { nombre: '', timestamp: null, motivo: '' } });
  });

  test('ANULADA con el wellId de OTRO pozo: igual anula la observacion (y queda marcada)', () => {
    const d = derivar([alta(1), anula(2, 1, { wellId: '14-0002' })]);
    expect(d.observaciones[0].estado).toBe('ANULADA');
    expect(codigos(d)).toEqual(['ANULACION_OTRO_POZO']);
  });

  test('timestamp invalido o ausente en una ALTA: se muestra igual (el orden es la secuencia), con timestamp null', () => {
    const d = derivar([alta(1, { timestampUtc: 'ayer' }), alta(2, { timestampUtc: '' })]);
    expect(d.observaciones.map((o) => o.timestamp)).toEqual([null, null]);
    expect(d.inconsistencias).toEqual([]);
  });

});

describe('identidad y secuencia DUPLICADAS: se oculta la observacion ambigua, nunca se elige en silencio', () => {
  const hayLog = (d, codigo) => d.inconsistencias.some((i) => i.codigo === codigo);

  test('A. dos ALTA con el mismo observacionId y DISTINTO texto: ninguna se devuelve', () => {
    const d = derivar([alta(1, { texto: 'version A' }), alta(2, { observacionId: uuid(1), texto: 'version B' }), alta(3)]);
    expect(ids(d)).toEqual([uuid(3)]);
    expect(JSON.stringify(d.observaciones)).not.toMatch(/version A|version B/);
    expect(d.ocultas).toEqual([uuid(1)]);
    expect(d.inconsistencias.find((i) => i.codigo === 'ID_DUPLICADO')).toMatchObject({ observacionIds: [uuid(1)], filas: [2, 3], secuencias: [1, 2] });
  });

  test('B. dos ALTA con el mismo observacionId y distinta secuencia: ninguna (no se elige la de menor secuencia, ni la primera, ni la ultima)', () => {
    [[1, 9], [9, 1]].forEach(([s1, s2]) => {
      const d = derivar([alta(s1, { observacionId: uuid(5), secuencia: s1, texto: 'primera fila' }), alta(s2, { observacionId: uuid(5), secuencia: s2, texto: 'segunda fila' })]);
      expect(d.observaciones).toEqual([]);
      expect([d.activas, d.anuladas]).toEqual([0, 0]);
    });
  });

  test('un id duplicado donde una de las filas tiene contenido invalido: tambien se oculta (compite por la identidad)', () => {
    const d = derivar([alta(1), alta(2, { observacionId: uuid(1), texto: '' })]);
    expect(d.observaciones).toEqual([]);
    expect(hayLog(d, 'ID_DUPLICADO')).toBe(true);
  });

  test('un id duplicado en OTRO pozo (mismo observacionId): la observacion queda ambigua en ambos; las demas del pozo siguen sanas', () => {
    const d = derivar([alta(1), alta(2, { observacionId: uuid(1), wellId: '14-0002' }), alta(3), alta(4)]);
    expect(ids(d)).toEqual([uuid(4), uuid(3)]);
  });

  test('una ANULADA que refiere un id duplicado NO selecciona ni hace reaparecer ninguna ALTA', () => {
    const d = derivar([alta(1, { texto: 'A' }), alta(2, { observacionId: uuid(1), texto: 'B' }), anula(3, 1)]);
    expect(d.observaciones).toEqual([]);
    expect(codigos(d)).toEqual(['ID_DUPLICADO']);                              // y la anulacion no se informa como huerfana: la observacion simplemente sigue oculta
  });

  test('C. dos ALTA distintas con la misma secuencia: ambas quedan fuera; no se usa el orden de fila como sustituto de la secuencia', () => {
    const d = derivar([alta(1, { secuencia: 4, texto: 'A' }), alta(2, { secuencia: 4, texto: 'B' }), alta(3)]);
    expect(ids(d)).toEqual([uuid(3)]);
    expect(d.ocultas.sort()).toEqual([uuid(1), uuid(2)]);
    expect(d.inconsistencias.find((i) => i.codigo === 'SECUENCIA_DUPLICADA')).toMatchObject({ observacionIds: [uuid(1), uuid(2)], filas: [2, 3], secuencias: [4] });
    const invertido = derivar([alta(2, { secuencia: 4, texto: 'B' }), alta(1, { secuencia: 4, texto: 'A' }), alta(3)]);
    expect(ids(invertido)).toEqual([uuid(3)]);                                 // el orden de las filas no cambia nada
  });

  test('tres eventos con la misma secuencia: todos los involucrados fuera', () => {
    const d = derivar([alta(1, { secuencia: 7 }), alta(2, { secuencia: 7 }), alta(3, { secuencia: 7 }), alta(4)]);
    expect(ids(d)).toEqual([uuid(4)]);
  });

  test('E. ALTA sana + ANULADA cuya secuencia choca con otro evento: la observacion anulada queda OCULTA (nunca ACTIVA ni con texto) y el otro evento tambien', () => {
    const d = derivar([alta(1, { texto: 'confidencial' }), alta(2, { texto: 'otra' }), anula(7, 1), alta(3, { secuencia: 7, texto: 'colisiona' }), alta(4)]);
    expect(ids(d)).toEqual([uuid(4), uuid(2)]);
    expect(JSON.stringify(d.observaciones)).not.toMatch(/confidencial|colisiona/);
    expect(d.ocultas.sort()).toEqual([uuid(1), uuid(3)]);
  });

  test('E2. dos ANULADA de la misma observacion con la misma secuencia: la observacion queda oculta (no se elige quien anulo)', () => {
    const d = derivar([alta(1), anula(4, 1, { nombre: 'A' }), anula(4, 1, { nombre: 'B' }), alta(2)]);
    expect(ids(d)).toEqual([uuid(2)]);
  });

  test('una ANULADA y una ALTA de otra observacion con la misma secuencia: ambas observaciones fuera (la corrupcion no expone texto)', () => {
    const d = derivar([alta(1), alta(2, { secuencia: 8 }), anula(8, 1), alta(5)]);
    expect(ids(d)).toEqual([uuid(5)]);
  });

  test('una ANULADA sin secuencia valida NO es una colision: sigue anulando (fail-safe de siempre)', () => {
    const d = derivar([alta(1), anula(0, 1, { secuencia: null }), anula(0, 1, { secuencia: null, nombre: 'otra' })]);
    expect(d.observaciones[0].estado).toBe('ANULADA');
  });

  test('D. un duplicado corrupto de OTRO pozo con otra identidad y otra secuencia no elimina ninguna observacion sana de este pozo', () => {
    const d = derivar([alta(1), alta(2), alta(900, { wellId: '14-0002', observacionId: uuid(900), secuencia: 900 }), alta(901, { wellId: '14-0002', observacionId: uuid(901), secuencia: 900 })]);
    expect(ids(d).filter((i) => i === uuid(1) || i === uuid(2)).sort()).toEqual([uuid(1), uuid(2)]);
    // y por el servicio: solo salen las del pozo pedido
  });

  test('anular una de las dos ALTA ambiguas NO la hace valida', () => {
    const d = derivar([alta(1), alta(2, { observacionId: uuid(1) }), anula(3, 1), anula(4, 1)]);
    expect(d.observaciones).toEqual([]);
  });

  test('las observaciones sanas conservan una secuencia INEQUIVOCA: unicas, en orden descendente', () => {
    const d = derivar([alta(1), alta(2, { secuencia: 3 }), alta(3), alta(4, { secuencia: 3 }), alta(5), alta(6, { observacionId: uuid(5) })]);
    const secs = d.observaciones.map((o) => o.secuencia);
    expect(new Set(secs).size).toBe(secs.length);
    expect(secs).toEqual(secs.slice().sort((a, b) => b - a));
  });

  test('G. los totales cuentan SOLO lo retornable: las ambiguas no suman a activas ni a anuladas', () => {
    const d = derivar([
      alta(1), alta(2), anula(3, 2),                                           // 1 activa + 1 anulada
      alta(4, { secuencia: 10 }), alta(5, { secuencia: 10 }),                  // secuencia duplicada: no cuentan
      alta(6, { observacionId: uuid(20) }), alta(7, { observacionId: uuid(20) })    // id duplicado: no cuentan
    ]);
    expect([d.activas, d.anuladas]).toEqual([1, 1]);
    expect(d.observaciones).toHaveLength(2);
  });
});

describe('derivacion: PROPIEDADES con datos aleatorios (semilla fija)', () => {
  // generador congruencial: reproducible
  function azar(semilla) {
    let x = semilla;
    return () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  }
  function evento(r, n) {
    const id = uuid(1 + Math.floor(r() * 8));
    const esAlta = r() < 0.55;
    const base = esAlta ? alta(1) : anula(1, 1);
    const e = Object.assign({}, base, { observacionId: r() < 0.1 ? 'roto' : id, fila: n });
    e.secuencia = r() < 0.15 ? null : Math.floor(r() * 12);
    if (r() < 0.1) { e.texto = ''; }
    if (r() < 0.1) { e.wellId = ['', '14-0002', 'x'][Math.floor(r() * 3)]; }
    if (r() < 0.05) { e.evento = 'OTRO'; }
    if (r() < 0.05) { e.timestampUtc = 'basura'; }
    return e;
  }

  test.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20])('semilla %i: nada ambiguo se devuelve; una anulacion que referencia siempre oculta; secuencias unicas y en orden', (semilla) => {
    const r = azar(semilla * 7919);
    const eventos = [];
    const n = 5 + Math.floor(r() * 40);
    for (let i = 0; i < n; i += 1) { eventos.push(evento(r, i)); }
    const d = derivar(eventos);
    const valido = (e) => ['ALTA', 'ANULADA'].indexOf(String(e.evento).toUpperCase()) !== -1 && /^[0-9a-f-]{36}$/.test(e.observacionId);
    const ev = eventos.filter(valido);
    const anulados = new Set(ev.filter((e) => e.evento === 'ANULADA').map((e) => e.observacionId));
    d.observaciones.forEach((o) => {
      const altasDelId = ev.filter((e) => e.evento === 'ALTA' && e.observacionId === o.observacionId);
      expect(altasDelId).toHaveLength(1);                                              // identidad inequivoca: UNA sola ALTA
      expect(ev.filter((e) => e.secuencia === o.secuencia && e.secuencia !== null)).toHaveLength(1);   // secuencia inequivoca: la usa UN solo evento
      if (anulados.has(o.observacionId)) { expect(o.estado).toBe('ANULADA'); }       // FAIL-SAFE: una anulacion que la referencia siempre la oculta
      // y si la anula un evento cuya secuencia choca con otro, la observacion no sale
      ev.filter((e) => e.evento === 'ANULADA' && e.observacionId === o.observacionId && e.secuencia !== null).forEach((e) => {
        expect(ev.filter((x) => x.secuencia === e.secuencia)).toHaveLength(1);
      });
    });
    const secs = d.observaciones.map((o) => o.secuencia);
    expect(new Set(secs).size).toBe(secs.length);
    expect(secs.slice().sort((a, b) => b - a)).toEqual(secs);
    expect(d.activas + d.anuladas).toBe(d.observaciones.length);
  });
});

describe('privacidad: lo que sale hacia el cliente', () => {
  const activa = () => derivar([alta(1)]).observaciones[0];
  const anulada = (extra) => derivar([alta(1, { texto: 'Telefono del propietario 2614444444' }), anula(2, 1, extra)]).observaciones[0];
  const vista = (o, moderador) => S.observacionesPozoService_vista(o, { moderador: moderador });

  test('lista blanca EXACTA de campos (nada de email, secuencia, clientRequestId ni datos tecnicos)', () => {
    expect(Object.keys(vista(activa(), false)).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'texto', 'timestamp', 'wellId']);
    expect(Object.keys(vista(anulada(), true).anulacion).sort()).toEqual(['motivo', 'nombre', 'timestamp']);
  });

  test('una ACTIVA muestra su texto a cualquiera que pueda leer (con o sin moderacion)', () => {
    expect(vista(activa(), false)).toMatchObject({ estado: 'ACTIVA', texto: 'Texto 1', anulacion: null });
    expect(vista(activa(), true).texto).toBe('Texto 1');
  });

  test('una ANULADA + moderador (observaciones_anular): ve el texto original para auditoria', () => {
    expect(vista(anulada(), true)).toMatchObject({ estado: 'ANULADA', texto: 'Telefono del propietario 2614444444' });
  });

  test('una ANULADA + lector comun: texto NULL (no se omite la clave: el contrato es el mismo), y si ve cuando, quien y por que se anulo', () => {
    const v = vista(anulada({ nombre: 'Valeria', motivo: 'Tenia un telefono' }), false);
    expect(v.texto).toBeNull();
    expect('texto' in v).toBe(true);
    expect(v.anulacion).toEqual({ nombre: 'Valeria', timestamp: ISO, motivo: 'Tenia un telefono' });
    expect(JSON.stringify(v)).not.toContain('2614444444');
  });

  test('moderador ausente, null, "true" o 1 NO cuenta: solo un true exacto (fail-closed)', () => {
    [undefined, null, 'true', 1, {}, false].forEach((m) => {
      expect(S.observacionesPozoService_vista(anulada(), { moderador: m }).texto).toBeNull();
    });
    expect(S.observacionesPozoService_vista(anulada()).texto).toBeNull();
    expect(S.observacionesPozoService_vista(anulada(), null).texto).toBeNull();
  });

  test('el email NUNCA sale (ni del autor ni de quien anulo), en ninguna de las dos vistas', () => {
    [vista(activa(), true), vista(activa(), false), vista(anulada(), true), vista(anulada(), false)].forEach((v) => {
      expect(JSON.stringify(v)).not.toMatch(/@|ana@x\.com|val@x\.com/);
    });
  });

  test('autor: solo el nombre; si falta o parece un email, la etiqueta neutra "Usuario"', () => {
    ['', '   ', null, undefined, 'ana@x.com', 'Ana <ana@x.com>'].forEach((nombre) => {
      const o = derivar([alta(1, { nombre: nombre }), anula(2, 1, { nombre: nombre })]).observaciones[0];
      expect(vista(o, true).nombre).toBe('Usuario');
      expect(vista(o, true).anulacion.nombre).toBe('Usuario');
    });
    expect(S.OBSERVACIONES_POZO_NOMBRE_NEUTRO).toBe('Usuario');
    expect(S.observacionesPozoService_nombreVisible('Ana Pérez')).toBe('Ana Pérez');
  });

  test('categoria: reservada, null mientras no haya catalogo; motivo vacio -> null', () => {
    expect(vista(activa(), false).categoria).toBeNull();
    expect(vista(anulada({ motivo: '' }), false).anulacion.motivo).toBeNull();
  });

  test('el texto de una ANULADA se conserva en la derivacion interna (auditoria) aunque no salga para el lector', () => {
    expect(anulada().texto).toBe('Telefono del propietario 2614444444');
  });
});

describe('paginacion por cursor (secuencia)', () => {
  const muchas = (n) => derivar(Array.from({ length: n }, (_, i) => alta(i + 1))).observaciones;       // desc: n .. 1

  test('limit: por defecto 50, maximo 100 (lo que excede se acota), enteros >= 1', () => {
    const p = S.observacionesPozoService_normalizarParametros;
    expect(p(undefined, undefined)).toEqual({ ok: true, limit: 50, antes: null });
    expect(p(null, null)).toEqual({ ok: true, limit: 50, antes: null });
    expect(p(1, undefined).limit).toBe(1);
    expect(p(100, undefined).limit).toBe(100);
    expect(p(101, undefined).limit).toBe(100);
    expect(p(100000, undefined).limit).toBe(100);
    expect(S.OBSERVACIONES_POZO_LIMITE_DEFECTO).toBe(50);
    expect(S.OBSERVACIONES_POZO_LIMITE_MAX).toBe(100);
  });

  test.each([[0], [-1], [1.5], ['10'], ['abc'], [NaN], [Infinity], [true], [{}], [[]]])('limit %j -> INVALID_LIMIT', (limit) => {
    expect(S.observacionesPozoService_normalizarParametros(limit, undefined)).toMatchObject({ ok: false, code: 'INVALID_LIMIT' });
  });

  test.each([[0], [-5], [2.5], ['7'], [NaN], [Infinity], [false], [{}]])('antesDeSecuencia %j -> INVALID_CURSOR', (antes) => {
    expect(S.observacionesPozoService_normalizarParametros(10, antes)).toMatchObject({ ok: false, code: 'INVALID_CURSOR' });
  });

  test('primera pagina: las `limit` mas recientes; hayMas y cursor (la secuencia de la ultima) solo si quedan', () => {
    const todas = muchas(120);
    const p1 = S.observacionesPozoService_pagina(todas, 50, null);
    expect(p1.items).toHaveLength(50);
    expect(p1.items[0].secuencia).toBe(120);
    expect(p1.items[49].secuencia).toBe(71);
    expect(p1.hayMas).toBe(true);
    expect(p1.cursor).toBe(71);
  });

  test('con el cursor se pide lo SIGUIENTE (strictly menor); la ultima pagina no tiene cursor; sin duplicados ni huecos', () => {
    const todas = muchas(120);
    const recorridas = [];
    let cursor = null;
    let paginas = 0;
    do {
      const p = S.observacionesPozoService_pagina(todas, 50, cursor);
      p.items.forEach((o) => recorridas.push(o.secuencia));
      cursor = p.cursor;
      paginas += 1;
    } while (cursor !== null);
    expect(paginas).toBe(3);
    expect(recorridas).toEqual(Array.from({ length: 120 }, (_, i) => 120 - i));
    expect(new Set(recorridas).size).toBe(120);
  });

  test('exactamente `limit` observaciones: no hay mas ni cursor', () => {
    const p = S.observacionesPozoService_pagina(muchas(50), 50, null);
    expect(p).toMatchObject({ hayMas: false, cursor: null });
    expect(p.items).toHaveLength(50);
  });

  test('un cursor mas alla de todo: pagina vacia; un cursor por debajo de la mas vieja: vacia', () => {
    expect(S.observacionesPozoService_pagina(muchas(10), 50, 1)).toEqual({ items: [], hayMas: false, cursor: null });
    expect(S.observacionesPozoService_pagina(muchas(10), 50, 1000).items).toHaveLength(10);
  });

  test('ESTABLE: una observacion nueva (secuencia mayor) o una anulacion entre la pagina 1 y la 2 no cambian la pagina 2 ni repiten items', () => {
    const base = Array.from({ length: 120 }, (_, i) => alta(i + 1));
    const p1 = S.observacionesPozoService_pagina(derivar(base).observaciones, 50, null);
    const conNuevas = derivar(base.concat([alta(121), alta(122), anula(123, 100)])).observaciones;
    const p2 = S.observacionesPozoService_pagina(conNuevas, 50, p1.cursor);
    expect(p2.items.map((o) => o.secuencia)).toEqual(Array.from({ length: 50 }, (_, i) => 70 - i));
    const vistos = p1.items.map((o) => o.secuencia).concat(p2.items.map((o) => o.secuencia));
    expect(new Set(vistos).size).toBe(vistos.length);
  });
});

describe('F. paginacion con una secuencia corrupta en el medio', () => {
  // sanas 1..12; la secuencia 6 la usan DOS altas distintas (corrupta); la 9 es de un id duplicado
  const eventos = () => {
    const e = [];
    for (let i = 1; i <= 12; i += 1) {
      if (i === 6) { e.push(alta(60, { secuencia: 6 }), alta(61, { secuencia: 6 })); } else if (i === 9) { e.push(alta(90, { secuencia: 9 }), alta(90, { observacionId: uuid(90), secuencia: 99, texto: 'dup' })); } else { e.push(alta(i)); }
    }
    return e;
  };

  test('recorrer con limit 3: no se repite ni se pierde ninguna observacion sana, y el cursor es estricto', () => {
    const todas = derivar(eventos()).observaciones;
    const secs = todas.map((o) => o.secuencia);
    expect(secs).toEqual([12, 11, 10, 8, 7, 5, 4, 3, 2, 1]);                    // 6 y 9 fuera
    const vistas = [];
    let cursor = null;
    let paginas = 0;
    do {
      const p = S.observacionesPozoService_pagina(todas, 3, cursor);
      p.items.forEach((o) => vistas.push(o.secuencia));
      cursor = p.cursor;
      paginas += 1;
    } while (cursor !== null);
    expect(vistas).toEqual(secs);
    expect(paginas).toBe(4);
  });

  test('un cursor que apunta JUSTO a una secuencia corrupta (6) o a la mas alta oculta: devuelve lo sano que sigue, estricto', () => {
    const todas = derivar(eventos()).observaciones;
    expect(S.observacionesPozoService_pagina(todas, 50, 6).items.map((o) => o.secuencia)).toEqual([5, 4, 3, 2, 1]);
    expect(S.observacionesPozoService_pagina(todas, 50, 9).items.map((o) => o.secuencia)).toEqual([8, 7, 5, 4, 3, 2, 1]);
    expect(S.observacionesPozoService_pagina(todas, 50, 7).items.map((o) => o.secuencia)).toEqual([5, 4, 3, 2, 1]);
  });

  test('hayMas y cursor ignoran lo oculto (nunca apuntan a una observacion que no se devuelve)', () => {
    const todas = derivar(eventos()).observaciones;
    const p = S.observacionesPozoService_pagina(todas, 4, null);
    expect(p.items.map((o) => o.secuencia)).toEqual([12, 11, 10, 8]);
    expect(p).toMatchObject({ hayMas: true, cursor: 8 });
  });
});

describe('lectura de un pozo (servicio)', () => {
  let eventos;
  beforeEach(() => {
    eventos = [];
    global.observacionesPozoRepository_listarEventosDelPozo = jest.fn(() => ({ eventos: eventos, modo: 'COMPLETA' }));
    global.pozoExistenciaService_verificar = jest.fn();
    global.Logger = { log: jest.fn() };
  });
  afterEach(() => { delete global.observacionesPozoRepository_listarEventosDelPozo; delete global.pozoExistenciaService_verificar; });

  const leer = (p, o) => S.observacionesPozoService_getObservaciones(W, p, o);

  test('pozo sin filas: lista vacia, no es un error, y NO se verifica la existencia', () => {
    const r = leer({}, {});
    expect(r).toEqual({ ok: true, data: { wellId: W, total: 0, activas: 0, anuladas: 0, hayMas: false, cursor: null, observaciones: [] } });
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
  });

  test('total / activas / anuladas son GLOBALES del pozo (no de la pagina)', () => {
    eventos = [];
    for (let i = 1; i <= 120; i += 1) { eventos.push(alta(i)); }
    eventos.push(anula(200, 10), anula(201, 20), anula(202, 30));
    const r = leer({ limit: 10 }, {});
    expect(r.data).toMatchObject({ total: 120, activas: 117, anuladas: 3, hayMas: true, cursor: 111 });
    expect(r.data.observaciones).toHaveLength(10);
    expect(r.data.observaciones[0].observacionId).toBe(uuid(120));
  });

  test('forma de la respuesta: solo los campos del contrato', () => {
    eventos = [alta(1)];
    const r = leer({}, {});
    expect(Object.keys(r.data).sort()).toEqual(['activas', 'anuladas', 'cursor', 'hayMas', 'observaciones', 'total', 'wellId']);
  });

  test('moderador: ve el texto de las anuladas; el resto, no', () => {
    eventos = [alta(1, { texto: 'secreto' }), anula(2, 1)];
    expect(leer({}, { moderador: true }).data.observaciones[0].texto).toBe('secreto');
    expect(leer({}, { moderador: false }).data.observaciones[0].texto).toBeNull();
    expect(leer({}, {}).data.observaciones[0].texto).toBeNull();
    expect(leer({}).data.observaciones[0].texto).toBeNull();
  });

  test('solo salen las observaciones DEL pozo pedido (una alta bajo otro pozo no se cuela)', () => {
    eventos = [alta(1, { wellId: '14-0002' }), alta(2)];
    expect(leer({}, {}).data.observaciones.map((o) => o.observacionId)).toEqual([uuid(2)]);
    expect(leer({}, {}).data.total).toBe(1);
  });

  test('parametros invalidos: se rechazan ANTES de leer la hoja', () => {
    expect(leer({ limit: 0 }, {})).toMatchObject({ ok: false, code: 'INVALID_LIMIT' });
    expect(leer({ antesDeSecuencia: 'x' }, {})).toMatchObject({ ok: false, code: 'INVALID_CURSOR' });
    expect(global.observacionesPozoRepository_listarEventosDelPozo).not.toHaveBeenCalled();
  });

  test('la hoja que no se puede leer: la excepcion sube (Api.js la traduce a SERVICE_UNAVAILABLE)', () => {
    global.observacionesPozoRepository_listarEventosDelPozo = jest.fn(() => { throw new Error('No existe una hoja'); });
    expect(() => leer({}, {})).toThrow(/No existe una hoja/);
  });

  test('las inconsistencias quedan en Logger con el codigo y el pozo, SIN texto ni email', () => {
    eventos = [alta(1, { texto: 'confidencial', email: 'ana@x.com' }), anula(5, 99), alta(2, { texto: '' })];
    leer({}, {});
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toContain(W);
    expect(log).toContain('ANULACION_HUERFANA');
    expect(log).toContain('ALTA_INVALIDA');
    expect(log).not.toMatch(/confidencial|ana@x\.com/);
  });

  test('H. duplicados: el Logger recibe codigo + observacionId + filas + secuencias, y NUNCA el texto, el motivo, el nombre ni el email', () => {
    eventos = [
      alta(1, { texto: 'texto-secreto-1', email: 'autor1@x.com', nombre: 'Nombre Secreto' }), alta(2, { observacionId: uuid(1), texto: 'texto-secreto-2', email: 'autor2@x.com' }),
      alta(3, { secuencia: 8, texto: 'texto-secreto-3' }), alta(4, { secuencia: 8, texto: 'texto-secreto-4' }), anula(9, 3, { motivo: 'motivo-secreto', email: 'mod@x.com' }), alta(5)
    ];
    const r = leer({}, {});
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toContain(W);
    expect(log).toContain('ID_DUPLICADO ids=[' + uuid(1) + '] filas=[2,3] secuencias=[1,2]');
    expect(log).toContain('SECUENCIA_DUPLICADA');
    expect(log).toContain(uuid(3));
    expect(log).toContain(uuid(4));
    expect(log).not.toMatch(/texto-secreto|motivo-secreto|Nombre Secreto|@/);
    expect(r.data.observaciones.map((o) => o.observacionId)).toEqual([uuid(5)]);
  });

  test('G. los totales del servicio cuentan solo las observaciones retornables (no las ocultas por ambiguedad)', () => {
    eventos = [alta(1), alta(2), anula(3, 2), alta(4, { secuencia: 10 }), alta(5, { secuencia: 10 }), alta(6, { observacionId: uuid(20) }), alta(7, { observacionId: uuid(20) })];
    const r = leer({}, {});
    expect(r.data).toMatchObject({ total: 2, activas: 1, anuladas: 1, hayMas: false });
    expect(r.data.observaciones).toHaveLength(2);
  });

  test('el log acota los detalles (no inunda) y avisa cuantos faltan', () => {
    eventos = [];
    for (let i = 1; i <= 30; i += 1) { eventos.push(anula(100 + i, 5000 + i)); }                // 30 huerfanas
    leer({}, {});
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toContain('30 eventos inconsistentes');
    expect(log).toContain('y 20 mas');
    expect(log.split('ANULACION_HUERFANA').length - 1).toBe(10);
  });

  test('sin inconsistencias no se loguea nada', () => {
    eventos = [alta(1)];
    leer({}, {});
    expect(global.Logger.log).not.toHaveBeenCalled();
  });

  test('segunda pagina por cursor', () => {
    eventos = [];
    for (let i = 1; i <= 7; i += 1) { eventos.push(alta(i)); }
    const p1 = leer({ limit: 3 }, {}).data;
    const p2 = leer({ limit: 3, antesDeSecuencia: p1.cursor }, {}).data;
    const p3 = leer({ limit: 3, antesDeSecuencia: p2.cursor }, {}).data;
    expect([p1, p2, p3].map((p) => p.observaciones.map((o) => o.observacionId))).toEqual([[uuid(7), uuid(6), uuid(5)], [uuid(4), uuid(3), uuid(2)], [uuid(1)]]);
    expect([p1.hayMas, p2.hayMas, p3.hayMas]).toEqual([true, true, false]);
    expect(p3.cursor).toBeNull();
  });
});
