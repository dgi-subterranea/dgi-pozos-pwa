// E7-2: lotes de disponibilidad ITF (el backend rechaza mas de 500 wellId por llamada) y filtro/orden de la tabla de Mi seleccion, compartido con la exportacion.
const R = require('./reemplazoResumenLogic');
const S = require('./seleccionLogic');

beforeAll(() => { global.reemplazoResumenLogic_filtrar = R.reemplazoResumenLogic_filtrar; });

const ids = (n, desde) => Array.from({ length: n }, (_, i) => '14-' + String((desde || 0) + i).padStart(4, '0'));

describe('disponibilidad ITF por lotes', () => {
  test('el tope es el del backend (500)', () => {
    expect(S.SELECCION_ITF_LOTE_MAX).toBe(500);
  });

  test.each([[0, []], [1, [1]], [499, [499]], [500, [500]], [501, [500, 1]], [1000, [500, 500]], [1200, [500, 500, 200]], [13804, Array(27).fill(500).concat([304])]])(
    '%i pozos -> lotes de %j', (n, tamanos) => {
      const lotes = S.seleccionLogic_dividirEnLotes(ids(n));
      expect(lotes.map((l) => l.length)).toEqual(tamanos);
      expect(lotes.every((l) => l.length <= 500)).toBe(true);
      expect([].concat(...lotes)).toEqual(ids(n));                              // todos, en orden, sin duplicar ni perder
    });

  test('tamano propio; invalido cae al default', () => {
    expect(S.seleccionLogic_dividirEnLotes(ids(5), 2).map((l) => l.length)).toEqual([2, 2, 1]);
    expect(S.seleccionLogic_dividirEnLotes(ids(5), 0).map((l) => l.length)).toEqual([5]);
    expect(S.seleccionLogic_dividirEnLotes(ids(5), NaN).map((l) => l.length)).toEqual([5]);
    expect(S.seleccionLogic_dividirEnLotes(null)).toEqual([]);
  });

  test('todos los lotes OK: cada pozo con su Si / No y nada desconocido', () => {
    const lotes = [['a', 'b'], ['c']];
    const r = S.seleccionLogic_combinarDisponibilidadItf(lotes, [{ status: 'ok', data: { a: true, b: false } }, { status: 'ok', data: { c: true } }]);
    expect(r).toEqual({ disponibilidad: { a: true, b: false, c: true }, desconocidos: [], completo: true });
  });

  test('un lote con error NO da "No": sus pozos quedan desconocidos y fuera de la disponibilidad', () => {
    const lotes = [['a', 'b'], ['c', 'd']];
    const r = S.seleccionLogic_combinarDisponibilidadItf(lotes, [{ status: 'ok', data: { a: true, b: false } }, { status: 'error', code: 'SERVICE_UNAVAILABLE' }]);
    expect(r.disponibilidad).toEqual({ a: true, b: false });
    expect(r.desconocidos).toEqual(['c', 'd']);
    expect(r.completo).toBe(false);
    expect('c' in r.disponibilidad).toBe(false);
  });

  test.each([[null], [undefined], [{}], [{ status: 'ok' }], [{ status: 'ok', data: null }], [{ status: 'ok', data: [] }], [{ status: 'ok', data: 'x' }], [{ status: 'error' }], [{ status: 'OK', data: { a: true } }]])(
    'respuesta de lote invalida (%j): todo desconocido', (resp) => {
      const r = S.seleccionLogic_combinarDisponibilidadItf([['a']], [resp]);
      expect(r.desconocidos).toEqual(['a']);
      expect(r.disponibilidad).toEqual({});
    });

  test('un lote OK que no trae un booleano para un pozo (falta, 1, "true", null) lo deja desconocido', () => {
    const r = S.seleccionLogic_combinarDisponibilidadItf([['a', 'b', 'c', 'd']], [{ status: 'ok', data: { a: 1, b: 'true', c: null } }]);
    expect(r.desconocidos).toEqual(['a', 'b', 'c', 'd']);
  });

  test('un wellId repetido se cuenta una vez; sin respuestas todo es desconocido', () => {
    const r = S.seleccionLogic_combinarDisponibilidadItf([['a', 'a'], ['a']], [{ status: 'ok', data: { a: true } }, { status: 'ok', data: { a: false } }]);
    expect(r.disponibilidad).toEqual({ a: true });
    expect(S.seleccionLogic_combinarDisponibilidadItf([['a']], null).desconocidos).toEqual(['a']);
    expect(S.seleccionLogic_combinarDisponibilidadItf(null, null)).toEqual({ disponibilidad: {}, desconocidos: [], completo: true });
  });
});

describe('seleccionLogic_filtrarYOrdenarFilas (tabla de Mi seleccion y exportacion)', () => {
  const f = (wellId, extra) => Object.assign({ wellId, titular: 'T', departamento: 'Capital', cuenca: 'C', profundidadNum: -1 }, extra || {});
  const orden = (lista) => lista.map((x) => x.wellId);

  test('sin opciones: copia ordenada por wellId, sin mutar la entrada', () => {
    const entrada = [f('14-0002'), f('01-0001')];
    const r = S.seleccionLogic_filtrarYOrdenarFilas(entrada);
    expect(orden(r)).toEqual(['01-0001', '14-0002']);
    expect(orden(entrada)).toEqual(['14-0002', '01-0001']);
    expect(r).not.toBe(entrada);
  });

  test('orden por departamento / cuenca / profundidad (mayor primero) con desempate por wellId', () => {
    const e = [f('01-0003', { departamento: 'B', cuenca: 'Y', profundidadNum: 10 }), f('01-0001', { departamento: 'B', cuenca: 'X', profundidadNum: 10 }), f('01-0002', { departamento: 'A', cuenca: 'Y', profundidadNum: 50 })];
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { orden: 'departamento' }))).toEqual(['01-0002', '01-0001', '01-0003']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { orden: 'cuenca' }))).toEqual(['01-0001', '01-0002', '01-0003']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { orden: 'profundidad' }))).toEqual(['01-0002', '01-0001', '01-0003']);
  });

  test('busqueda: wellId, titular, departamento y cuenca; sin distinguir mayusculas; recorta espacios', () => {
    const e = [f('14-0001', { titular: 'García' }), f('01-0001', { departamento: 'Lavalle' }), f('01-0002', { cuenca: 'Valle de Uco' })];
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: '  GARCÍA ' }))).toEqual(['14-0001']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: 'lavalle' }))).toEqual(['01-0001']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: 'uco' }))).toEqual(['01-0002']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: '14-' }))).toEqual(['14-0001']);
    expect(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: 'nada' })).toEqual([]);
    expect(S.seleccionLogic_filtrarYOrdenarFilas(e, { texto: null })).toHaveLength(3);
  });

  test('aptitud: filtra solo con resumen y chips; se combina (AND) con la busqueda', () => {
    const e = [f('01-0001'), f('01-0002'), f('01-0003')];
    const resumen = { '01-0001': 'APTO', '01-0002': 'NO_APTO' };
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { resumen, aptitudActivos: { APTO: true } }))).toEqual(['01-0001']);
    expect(orden(S.seleccionLogic_filtrarYOrdenarFilas(e, { resumen, aptitudActivos: { SIN_EVALUAR: true } }))).toEqual(['01-0003']);
    expect(S.seleccionLogic_filtrarYOrdenarFilas(e, { resumen, aptitudActivos: { APTO: true }, texto: '0002' })).toEqual([]);
    expect(S.seleccionLogic_filtrarYOrdenarFilas(e, { resumen: null, aptitudActivos: { APTO: true } })).toHaveLength(3);
    expect(S.seleccionLogic_filtrarYOrdenarFilas(e, { resumen, aptitudActivos: {} })).toHaveLength(3);
  });
});
