// COMPOSICION POR CAPAS del punto operativo (E3-2, logica PURA; todavia no la usa ninguna pantalla):
//   BASE (pozos.json: D | C)  ->  DELTA REGISTRAL (D | C | R | N)  ->  VALIDADA EN CAMPO (V)  ->  punto final o NINGUNO
// Contrato bajo prueba: el orden (el "sin punto" se decide al FINAL), los atributos auxiliares del base se conservan, la `base` de una V es la resolucion registral efectiva
// (D | C | R | null), una entrada invalida del delta NUNCA retira un punto (jamas se convierte en N), nada se muta y la logica anterior de D / C / V sigue igual.
const fs = require('fs');
const path = require('path');
const U = require('./ubicacionOperativaLogic');
const { cercaMioLogic_buscarCercanos } = require('./cercaMioLogic');
const { seleccionLogic_filtrarPorPoligono } = require('./seleccionLogic');

const W = '14-0001';
const IRR = { lat: -33.34765, lon: -69.14545 };              // el punto del padron (base D)
const ACEP = { lat: -33.34864, lon: -69.14406 };             // la fuente aceptada (a ~170 m)
const CAMPO = { lat: -33.34745, lon: -69.14545 };            // la validada en campo (a 22 m del padron)
const OTRO = { lat: -33.4, lon: -69.2 };

// punto de pozos.json tal como lo entrega getMapaPozos (con un atributo "futuro" para probar que se conserva TODO lo auxiliar)
const pozo = (wellId, extra) => Object.assign({
  wellId: wellId, lat: IRR.lat, lon: IRR.lon, estado: 'D', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo', atributoFuturo: { x: 1 }
}, extra || {});
const dR = (estado, wellId, coord) => (estado === 'N' ? { wellId: wellId || W, estado: 'N' } : { wellId: wellId || W, estado: estado, lat: (coord || ACEP).lat, lon: (coord || ACEP).lon });
const dV = (wellId, extra) => Object.assign({ wellId: wellId || W, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-12T14:05:00' }, extra || {});
const AUX = ['atributoFuturo', 'cuenca', 'profundidad', 'surgencia', 'tramosFiltrantes', 'wellId'];

function congelar(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.keys(v).forEach((k) => congelar(v[k]));
  }
  return v;
}
const clon = (v) => JSON.parse(JSON.stringify(v));
const componer = U.ubicacionOperativaLogic_componerPunto;
const detallado = U.ubicacionOperativaLogic_componerPuntoDetallado;

describe('R = ACEPTADA en las tablas (sin romper D / C / V)', () => {
  test('R <-> ACEPTADA en los dos sentidos; D / C / V no cambian', () => {
    expect(U.ubicacionOperativaLogic_estadoDeCodigo('R')).toBe('ACEPTADA');
    expect(U.ubicacionOperativaLogic_codigoDeEstado('ACEPTADA')).toBe('R');
    expect(U.UOP_ESTADOS.ACEPTADA).toBe('ACEPTADA');
    expect(U.UOP_CODIGO_A_ESTADO).toEqual({ D: 'DISPONIBLE', C: 'COINCIDENTE', R: 'ACEPTADA', V: 'VALIDADA_CAMPO' });
    ['r', 'N', 'X', '', null, undefined, 'constructor'].forEach((c) => expect(U.ubicacionOperativaLogic_estadoDeCodigo(c)).toBeNull());
  });

  test('etiquetas y confianza de ACEPTADA (eleccion humana explicita: B)', () => {
    expect(U.ubicacionOperativaLogic_etiquetaEstado('ACEPTADA')).toBe('Ubicación aceptada');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('R', true)).toBe('Aceptada');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('R', false)).toBe('Ubicación aceptada');
    expect(U.ubicacionOperativaLogic_confianzaDeEstado('ACEPTADA')).toBe('B');
    expect(JSON.stringify([U.UOP_ETIQUETAS_ESTADO, U.UOP_ETIQUETAS_CODIGO_CORTAS])).not.toMatch(/onfirmad/);
  });

  test('los codigos de la resolucion registral son D | C | R (V no: es de campo); el delta acepta D | C | R | N', () => {
    expect(U.UOP_CODIGOS_REGISTRALES).toEqual(['D', 'C', 'R']);
    expect(U.UOP_DELTA_REGISTRAL_ESTADOS).toEqual({ D: 'DISPONIBLE', C: 'COINCIDENTE', R: 'ACEPTADA', N: 'SIN_PUNTO' });
  });

  test('el estado de un punto con R se informa completo (estado, fuente generica de Irrigacion, confianza y etiqueta)', () => {
    expect(U.ubicacionOperativaLogic_infoDePuntoDataset({ wellId: W, lat: ACEP.lat, lon: ACEP.lon, estado: 'R' })).toEqual({ estado: 'ACEPTADA', fuente: 'IRR', confianza: 'B', etiqueta: 'Ubicación aceptada' });
  });

  test('fuente, estado y confianza siguen siendo tres vocabularios distintos', () => {
    const fuentes = Object.values(U.UOP_FUENTES);
    const estados = Object.values(U.UOP_ESTADOS);
    fuentes.forEach((f) => expect(estados).not.toContain(f));
    estados.forEach((e) => expect(['A', 'B', 'C', 'D']).not.toContain(e));
  });
});

describe('delta registral: validacion de una entrada', () => {
  const n = U.ubicacionOperativaLogic_normalizarDeltaRegistral;

  test.each(['D', 'C', 'R'])('%s con coordenadas validas se acepta (solo wellId, estado, lat, lon)', (estado) => {
    expect(n({ wellId: W, estado: estado, lat: ACEP.lat, lon: ACEP.lon, email: 'x@x.com', motivo: 'secreto', nombre: 'Ana', x: 1 })).toEqual({ wellId: W, estado: estado, lat: ACEP.lat, lon: ACEP.lon });
  });

  test('N solo exige un wellId valido; si trae coordenadas (aunque sean basura) se descartan', () => {
    expect(n({ wellId: W, estado: 'N' })).toEqual({ wellId: W, estado: 'N' });
    expect(n({ wellId: W, estado: 'N', lat: 'abc', lon: NaN })).toEqual({ wellId: W, estado: 'N' });
  });

  test('wellId invalido o ausente -> null (incluidos los departamentos fuera de 01-19)', () => {
    ['', '14-001', '14_0001', '1-0001', '20-0001', '00-0001', 14, null, undefined, {}, ['14-0001']].forEach((w) => {
      expect(n({ wellId: w, estado: 'R', lat: ACEP.lat, lon: ACEP.lon })).toBeNull();
      expect(n({ wellId: w, estado: 'N' })).toBeNull();
    });
  });

  test('estado desconocido -> null, NO N (V no es un estado del delta registral; tampoco minusculas ni claves heredadas)', () => {
    ['V', 'X', 'r', 'n', 'd', '', 'ACEPTADA', 'SIN_PUNTO', 'constructor', '__proto__', 'toString', 5, null, undefined, ['R'], {}].forEach((e) => {
      expect(n({ wellId: W, estado: e, lat: ACEP.lat, lon: ACEP.lon })).toBeNull();
    });
  });

  test.each([
    ['sin coordenadas', {}],
    ['lat NaN', { lat: NaN, lon: ACEP.lon }],
    ['lon Infinity', { lat: ACEP.lat, lon: Infinity }],
    ['lat como texto', { lat: '-33.3', lon: ACEP.lon }],
    ['null', { lat: null, lon: null }],
    ['fuera de Mendoza (sur)', { lat: -55, lon: ACEP.lon }],
    ['fuera de Mendoza (este)', { lat: ACEP.lat, lon: -10 }],
    ['0,0', { lat: 0, lon: 0 }]
  ])('D / C / R con coordenada invalida (%s) -> null, NO N', (nombre, coord) => {
    ['D', 'C', 'R'].forEach((estado) => expect(n(Object.assign({ wellId: W, estado: estado }, coord))).toBeNull());
  });

  test('lo que no es un objeto -> null', () => {
    [null, undefined, 'texto', 7, true, [], [W]].forEach((x) => expect(n(x)).toBeNull());
  });
});

describe('delta registral: indexado de la lista completa', () => {
  const idx = U.ubicacionOperativaLogic_indexarDeltasRegistrales;

  test('indexa por wellId y reporta lo descartado con su motivo (nada invalido se vuelve N)', () => {
    const r = idx([dR('R', '14-0001'), dR('N', '14-0002'), { wellId: '14-0003', estado: 'R', lat: NaN, lon: 1 }, { wellId: '14-0004', estado: 'Q' }, { wellId: 'malo', estado: 'N' }, null, 'x', { wellId: '14-0005', estado: 'D', lat: -55, lon: -69 }]);
    expect(Object.keys(r.porWell).sort()).toEqual(['14-0001', '14-0002']);
    expect(r.porWell['14-0002']).toEqual({ wellId: '14-0002', estado: 'N' });
    expect(r.descartadas).toEqual([
      { wellId: '14-0003', motivo: 'COORDENADA_INVALIDA' }, { wellId: '14-0004', motivo: 'ESTADO_DESCONOCIDO' }, { wellId: 'malo', motivo: 'WELL_ID_INVALIDO' },
      { wellId: null, motivo: 'NO_ES_OBJETO' }, { wellId: null, motivo: 'NO_ES_OBJETO' }, { wellId: '14-0005', motivo: 'COORDENADA_INVALIDA' }
    ]);
    expect(r.duplicadas).toBe(0);
  });

  test('un pozo repetido con el MISMO contenido queda una vez (duplicada); con contenido DISTINTO se descartan todas sus entradas', () => {
    const igual = idx([dR('R'), dR('R')]);
    expect(igual.porWell[W]).toEqual(dR('R'));
    expect(igual.duplicadas).toBe(1);
    expect(igual.descartadas).toEqual([]);
    const conflicto = idx([dR('R'), dR('N'), dR('D', W, OTRO)]);
    expect(conflicto.porWell[W]).toBeUndefined();
    expect(conflicto.descartadas).toEqual([{ wellId: W, motivo: 'DUPLICADA_CONFLICTIVA' }]);
    expect(conflicto.duplicadas).toBe(2);
  });

  test('entradas que no son lista -> vacio; jamas lanza', () => {
    [null, undefined, 'x', 5, {}, { length: 3 }].forEach((x) => {
      const r = idx(x);
      expect(Object.keys(r.porWell)).toEqual([]);
      expect(r.descartadas).toEqual([]);
    });
  });

  test('las claves heredadas del prototipo no cuentan como pozos', () => {
    const r = idx([dR('R')]);
    expect(r.porWell.constructor).toBeUndefined();
    expect(r.porWell.toString).toBeUndefined();
  });
});

describe('componerPunto: la matriz de capas', () => {
  test('A. base sola -> el MISMO objeto base (sin copia)', () => {
    const base = congelar(pozo(W));
    expect(componer(base, null, null)).toBe(base);
    const d = detallado(base, null, null);
    expect(d.capa).toBe('BASE');
    expect(d.sinPuntoRegistral).toBe(false);
    expect(d.baseRegistral).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'D' });
  });

  test('B. base + R -> punto R con las coordenadas de la fuente aceptada y TODOS los atributos auxiliares del base', () => {
    const base = congelar(pozo(W));
    const r = componer(base, dR('R'), null);
    expect(r).not.toBe(base);
    expect(r.estado).toBe('R');
    expect(r.lat).toBe(ACEP.lat);
    expect(r.lon).toBe(ACEP.lon);
    AUX.forEach((k) => expect(r[k]).toEqual(base[k]));
    expect(Object.keys(r).sort()).toEqual(['atributoFuturo', 'cuenca', 'estado', 'lat', 'lon', 'profundidad', 'surgencia', 'tramosFiltrantes', 'wellId']);
    expect(r.fuente).toBeUndefined();
    expect(r.base).toBeUndefined();
    expect(r.vts).toBeUndefined();
    expect(detallado(base, dR('R'), null).capa).toBe('REGISTRAL');
  });

  test('C. base + N -> SIN punto (null), indicado de forma inequivoca', () => {
    const d = detallado(congelar(pozo(W)), dR('N'), null);
    expect(d.punto).toBeNull();
    expect(d.capa).toBe('NINGUNA');
    expect(d.sinPuntoRegistral).toBe(true);
    expect(d.baseRegistral).toBeNull();
    expect(componer(pozo(W), dR('N'), null)).toBeNull();
  });

  test('D. base + V -> punto V; su `base` es la resolucion registral (D)', () => {
    const r = componer(congelar(pozo(W)), null, dV());
    expect(r).toMatchObject({ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', fuente: 'CAMPO', vts: '2026-10-12T14:05:00', base: { lat: IRR.lat, lon: IRR.lon, estado: 'D' } });
    AUX.forEach((k) => expect(r[k]).toEqual(pozo(W)[k]));
  });

  test('E. base + R + V -> V es operativa y R queda de respaldo en `base`', () => {
    const d = detallado(congelar(pozo(W)), dR('R'), dV());
    expect(d.punto.estado).toBe('V');
    expect(d.punto.lat).toBe(CAMPO.lat);
    expect(d.punto.base).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
    expect(d.baseRegistral).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
    expect(d.capa).toBe('CAMPO');
    AUX.forEach((k) => expect(d.punto[k]).toEqual(pozo(W)[k]));
  });

  test('F. base + N + V -> el pozo NO se elimina: V operativa, con los atributos del base y `base` null', () => {
    const d = detallado(congelar(pozo(W)), dR('N'), dV());
    expect(d.punto).not.toBeNull();
    expect(d.punto.estado).toBe('V');
    expect(d.punto.base).toBeNull();
    expect(d.sinPuntoRegistral).toBe(true);
    expect(d.baseRegistral).toBeNull();
    AUX.forEach((k) => expect(d.punto[k]).toEqual(pozo(W)[k]));
  });

  test('G. sin base + R -> punto nuevo con wellId, coordenadas, estado y atributos "Sin dato"', () => {
    const r = componer(null, dR('R'), null);
    expect(r).toEqual({ wellId: W, lat: ACEP.lat, lon: ACEP.lon, estado: 'R', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null });
  });

  test('G2. sin base + R con atributos conocidos del padron -> los usa (los mismos que ya usa el overlay de V)', () => {
    const r = componer(undefined, dR('D'), null, { profundidad: 80, tramosFiltrantes: [{ desde: 10, hasta: 20 }], surgencia: 'Natural', cuenca: 'Río Atuel' });
    expect(r).toMatchObject({ estado: 'D', profundidad: 80, tramosFiltrantes: [{ desde: 10, hasta: 20 }], surgencia: 'Natural', cuenca: 'Río Atuel' });
  });

  test('H. sin base + V -> punto V con base null (como antes)', () => {
    const r = componer(null, null, dV());
    expect(r).toEqual({ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', fuente: 'CAMPO', base: null, vts: '2026-10-12T14:05:00', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null });
  });

  test('H2. sin base + R + V -> V operativa y base R', () => {
    const r = componer(null, dR('R'), dV());
    expect(r.estado).toBe('V');
    expect(r.base).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
  });

  test('I. sin base + N -> ninguno; sin base + N + V -> V con base null', () => {
    expect(componer(null, dR('N'), null)).toBeNull();
    const r = componer(null, dR('N'), dV());
    expect(r.estado).toBe('V');
    expect(r.base).toBeNull();
  });

  test('J. todo vacio -> ninguno (no se inventa ninguna coordenada)', () => {
    expect(componer(null, null, null)).toBeNull();
    expect(componer(undefined, undefined, undefined)).toBeNull();
    const d = detallado(null, null, null);
    expect(d).toEqual({ punto: null, capa: 'NINGUNA', sinPuntoRegistral: false, baseRegistral: null });
  });
});

describe('componerPunto: D / C / R sobre D / C, y V sobre cada uno', () => {
  const porEstado = { D: pozo(W, { estado: 'D' }), C: pozo(W, { estado: 'C' }) };

  test.each([['D', 'D'], ['D', 'C'], ['D', 'R'], ['C', 'D'], ['C', 'C'], ['C', 'R']])('base %s + delta %s -> el delta reemplaza la resolucion registral', (b, d) => {
    const base = congelar(clon(porEstado[b]));
    const r = componer(base, dR(d, W, OTRO), null);
    expect(r.estado).toBe(d);
    expect(r.lat).toBe(OTRO.lat);
    expect(r.lon).toBe(OTRO.lon);
    AUX.forEach((k) => expect(r[k]).toEqual(base[k]));
  });

  test.each(['D', 'C'])('base %s + V -> la `base` de la V conserva ese estado', (b) => {
    const r = componer(porEstado[b], null, dV());
    expect(r.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: b });
  });

  test.each(['D', 'C', 'R'])('V sobre un delta %s -> la `base` de la V es ese delta (D | C | R)', (d) => {
    const r = componer(pozo(W), dR(d, W, OTRO), dV());
    expect(r.base).toEqual({ lat: OTRO.lat, lon: OTRO.lon, estado: d });
  });

  test('V sobre N y V sin base (ver la matriz): base null en los dos', () => {
    expect(componer(pozo(W), dR('N'), dV()).base).toBeNull();
    expect(componer(null, null, dV()).base).toBeNull();
  });

  test('un delta IGUAL a la base (mismo estado y coordenadas) no cambia nada: el MISMO objeto', () => {
    const base = congelar(pozo(W));
    expect(componer(base, dR('D', W, IRR), null)).toBe(base);
    expect(detallado(base, dR('D', W, IRR), null).capa).toBe('BASE');
    expect(componer(base, dR('C', W, IRR), null)).not.toBe(base);                 // mismo lugar pero otro estado: SI cambia
    expect(componer(base, dR('D', W, OTRO), null)).not.toBe(base);                // mismo estado, otro lugar: SI cambia
  });
});

describe('conceptualmente: revertir V -> queda R; quitar R -> vuelve el automatico', () => {
  test('con V + R la base de la V es exactamente lo que queda al desaparecer la V', () => {
    const base = congelar(pozo(W));
    const conV = componer(base, dR('R'), dV());
    const sinV = componer(base, dR('R'), null);
    expect(sinV.estado).toBe('R');
    expect({ lat: sinV.lat, lon: sinV.lon, estado: sinV.estado }).toEqual(conV.base);
  });

  test('con V + D automatico, revertir V deja el automatico original', () => {
    const base = congelar(pozo(W));
    const conV = componer(base, null, dV());
    const sinV = componer(base, null, null);
    expect(sinV).toBe(base);
    expect({ lat: sinV.lat, lon: sinV.lon, estado: sinV.estado }).toEqual(conV.base);
  });

  test('quitar la aceptacion (ya no hay delta) vuelve al punto automatico, tambien con V', () => {
    const base = congelar(pozo(W, { estado: 'C' }));
    expect(componer(base, null, null)).toBe(base);
    expect(componer(base, null, dV()).base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'C' });
  });

  test('V + todas descartadas (N): sigue la V; si ademas se revierte la V, el pozo queda sin ubicacion', () => {
    const base = congelar(pozo(W));
    expect(componer(base, dR('N'), dV()).estado).toBe('V');
    expect(componer(base, dR('N'), null)).toBeNull();
  });
});

describe('el orden es obligatorio: el "sin punto" se decide AL FINAL', () => {
  test('base D + delta N + V -> V operativa (NO se elimina el pozo antes de componer la V)', () => {
    const r = componer(congelar(pozo(W)), dR('N'), dV());
    expect(r).not.toBeNull();
    expect(r.estado).toBe('V');
    expect(r.cuenca).toBe('Río Mendoza');
    expect(r.profundidad).toBe(120);
  });

  test('la V gana sobre R, C y D del delta; el delta N nunca le gana a una V', () => {
    ['D', 'C', 'R', 'N'].forEach((e) => expect(componer(pozo(W), dR(e), dV()).estado).toBe('V'));
  });

  test('sin V, N retira el punto; con una V INVALIDA tambien (la V invalida se ignora, no salva ni rompe)', () => {
    expect(componer(pozo(W), dR('N'), null)).toBeNull();
    expect(componer(pozo(W), dR('N'), dV(W, { lat: NaN }))).toBeNull();
    expect(componer(pozo(W), dR('N'), dV(W, { lat: -55 }))).toBeNull();
  });
});

describe('una entrada invalida NUNCA retira ni cambia un punto', () => {
  const invalidas = [
    ['R con lat NaN', { wellId: W, estado: 'R', lat: NaN, lon: ACEP.lon }],
    ['R fuera de Mendoza', { wellId: W, estado: 'R', lat: -55, lon: -69 }],
    ['C sin coordenadas', { wellId: W, estado: 'C' }],
    ['estado desconocido', { wellId: W, estado: 'Q', lat: ACEP.lat, lon: ACEP.lon }],
    ['estado en minuscula', { wellId: W, estado: 'n' }],
    ['estado V', { wellId: W, estado: 'V', lat: ACEP.lat, lon: ACEP.lon }],
    ['wellId invalido', { wellId: 'x', estado: 'N' }],
    ['no es objeto', 'N']
  ];

  test.each(invalidas)('%s -> el punto base queda tal cual (mismo objeto)', (nombre, entrada) => {
    const base = congelar(pozo(W));
    expect(componer(base, entrada, null)).toBe(base);
    const r = componer(base, entrada, dV());
    expect(r.estado).toBe('V');
    expect(r.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'D' });            // la base sigue siendo la del padron
  });

  test('una coordenada fuera de Mendoza NO se transforma en N (el pozo conserva su punto)', () => {
    const base = congelar(pozo(W));
    const r = detallado(base, { wellId: W, estado: 'R', lat: -40, lon: -69 }, null);
    expect(r.punto).toBe(base);
    expect(r.sinPuntoRegistral).toBe(false);
  });

  test('una capa de OTRO pozo se ignora (nunca se aplica la coordenada de un pozo a otro)', () => {
    const base = congelar(pozo(W));
    expect(componer(base, dR('N', '14-0002'), null)).toBe(base);
    expect(componer(base, dR('R', '14-0002'), null)).toBe(base);
    expect(componer(base, null, dV('14-0002'))).toBe(base);
    expect(componer(base, dR('R'), dV('14-0002')).estado).toBe('R');
    expect(componer(null, dR('R', W), dV('14-0002'))).toMatchObject({ wellId: W, estado: 'R' });
  });

  test('una base sin punto valido (coordenadas rotas) y sin capas queda igual que antes (no se descarta en silencio)', () => {
    const rota = congelar(pozo(W, { lat: NaN }));
    expect(componer(rota, null, null)).toBe(rota);
    expect(componer(rota, null, dV()).base).toBeNull();
  });
});

describe('inmutabilidad, referencias y determinismo', () => {
  test('ninguna entrada se muta (todo congelado en profundidad) y la salida no comparte arreglos mutables con la entrada de forma peligrosa', () => {
    const base = congelar(pozo(W));
    const dr = congelar(dR('R'));
    const dv = congelar(dV());
    const reg = congelar({ profundidad: 5, tramosFiltrantes: [{ desde: 1, hasta: 2 }] });
    expect(() => {
      componer(base, dr, dv, reg);
      componer(base, dr, null);
      componer(null, dr, dv, reg);
      detallado(base, dR('N'), dv);
      U.ubicacionOperativaLogic_aplicarCapas([base], [dr], [dv]);
    }).not.toThrow();
    expect(base).toEqual(pozo(W));
  });

  test('es determinista: mismas entradas, mismo resultado (profundo) y cada llamada con cambios devuelve un objeto NUEVO', () => {
    const base = pozo(W);
    const a = componer(base, dR('R'), dV());
    const b = componer(base, dR('R'), dV());
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  test('si la entrada ya es un punto COMPUESTO con V, componer de nuevo con la misma V no anida: la base sigue siendo la registral', () => {
    const base = pozo(W);
    const una = componer(base, dR('R'), dV());
    const dos = componer(una, dR('R'), dV());
    expect(dos.base).toEqual({ lat: ACEP.lat, lon: ACEP.lon, estado: 'R' });
    expect(dos.base.base).toBeUndefined();
    expect(dos).toEqual(una);
  });

  test('un punto con V compuesto, al aplicarle un delta registral SIN V, queda como punto registral limpio (sin fuente / base / vts)', () => {
    const conV = componer(pozo(W), null, dV());
    const r = componer(conV, dR('R'), null);
    expect(r.estado).toBe('R');
    expect(r.fuente).toBeUndefined();
    expect(r.base).toBeUndefined();
    expect(r.vts).toBeUndefined();
    AUX.forEach((k) => expect(r[k]).toEqual(pozo(W)[k]));
  });

  test('el objeto de salida solo agrega fuente / base / vts a una V; un punto D / C / R no los lleva', () => {
    ['D', 'C', 'R'].forEach((e) => {
      const r = componer(pozo(W), dR(e, W, OTRO), null);
      expect(r.fuente).toBeUndefined();
      expect(Object.keys(r)).not.toContain('base');
    });
    expect(Object.keys(componer(pozo(W), null, dV())).sort()).toEqual([...AUX, 'base', 'estado', 'fuente', 'lat', 'lon', 'vts'].sort());
  });
});

describe('compatibilidad con la logica anterior (D / C / V)', () => {
  const base = congelar(pozo(W));

  test('resolverPuntoDataset (solo capa de campo) es la composicion con la capa registral vacia', () => {
    [dV(), dV(W, { lat: NaN }), null, undefined].forEach((v) => {
      expect(U.ubicacionOperativaLogic_resolverPuntoDataset(base, v)).toEqual(componer(base, null, v));
    });
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, dV())).toEqual(componer(null, null, dV()));
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, null)).toBeNull();
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(base, null)).toBe(base);
  });

  test('aplicarCapas sin deltas registrales produce EXACTAMENTE lo que produce aplicarOverlay', () => {
    const pozos = [pozo('14-0001'), pozo('14-0002', { estado: 'C', lat: OTRO.lat, lon: OTRO.lon }), pozo('15-0100')];
    const deltas = [dV('14-0001'), dV('14-0900', { lat: -33.4005, lon: -69.2005 }), dV('15-0100', { lat: -99 })];
    const viejo = U.ubicacionOperativaLogic_aplicarOverlay(pozos, deltas);
    const nuevo = U.ubicacionOperativaLogic_aplicarCapas(pozos, [], deltas);
    expect(nuevo.pozos).toEqual(viejo.pozos);
    expect(nuevo.resumen.campo.descartadas).toEqual(viejo.resumen.descartadas);
    expect(nuevo.resumen.nuevos).toBe(viejo.resumen.nuevos);
    expect(nuevo.resumen.aplicadas).toBe(viejo.resumen.aplicadas);
  });

  test('un punto con V que trae `base` D / C sigue funcionando como antes; con base R tambien', () => {
    ['D', 'C', 'R'].forEach((e) => {
      const punto = { wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', fuente: 'CAMPO', base: { lat: IRR.lat, lon: IRR.lon, estado: e }, vts: 'x', cuenca: 'A' };
      const r = U.ubicacionOperativaLogic_resolverPuntoDataset(punto, dV(W, { vts: 'y' }));
      expect(r.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: e });
    });
    const desconocido = { wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', fuente: 'CAMPO', base: { lat: IRR.lat, lon: IRR.lon, estado: 'Z' }, vts: 'x' };
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(desconocido, dV()).base.estado).toBeNull();
  });

  test('aplicarOverlay (V) sigue sin conocer el delta registral y no cambia', () => {
    const r = U.ubicacionOperativaLogic_aplicarOverlay([pozo(W)], [dV()]);
    expect(r.pozos[0].estado).toBe('V');
    expect(r.resumen).toEqual({ recibidas: 1, aplicadas: 1, nuevos: 0, nuevosEnriquecidos: 0, nuevosSinRegistral: 0, duplicadas: 0, descartadas: [] });
  });
});

describe('aplicarCapas: el dataset completo', () => {
  const dataset = () => [pozo('14-0001'), pozo('14-0002', { lat: OTRO.lat, lon: OTRO.lon, estado: 'C' }), pozo('14-0003', { lat: -33.5, lon: -69.3 }), pozo('15-0100', { lat: -33.6, lon: -69.3 })];

  test('aplica R / D / C, quita N, respeta V y conserva el ORDEN de la base; los pozos sin capas son los mismos objetos', () => {
    const pozos = congelar(dataset());
    const r = U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('R', '14-0001'), dR('N', '14-0002'), dR('D', '15-0100', OTRO)], [dV('14-0002')]);
    expect(r.pozos.map((p) => p.wellId)).toEqual(['14-0001', '14-0002', '14-0003', '15-0100']);
    expect(r.pozos[0].estado).toBe('R');
    expect(r.pozos[1].estado).toBe('V');                       // N + V: el pozo se queda
    expect(r.pozos[1].base).toBeNull();
    expect(r.pozos[2]).toBe(pozos[2]);                         // sin capas: el mismo objeto
    expect(r.pozos[3]).toMatchObject({ estado: 'D', lat: OTRO.lat, lon: OTRO.lon });
    expect(r.resumen.aplicadas).toBe(3);
    expect(r.resumen.quitados).toBe(0);
  });

  test('N sin V retira el pozo de la lista (y se cuenta en quitados); el resto no se corre', () => {
    const pozos = congelar(dataset());
    const r = U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('N', '14-0002')], []);
    expect(r.pozos.map((p) => p.wellId)).toEqual(['14-0001', '14-0003', '15-0100']);
    expect(r.resumen.quitados).toBe(1);
    expect(r.resumen.aplicadas).toBe(0);
  });

  test('los pozos que solo existen por una capa van AL FINAL ordenados por wellId; N o nada sobre un pozo sin base no crea punto (sinPunto)', () => {
    const pozos = congelar(dataset());
    const r = U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('R', '16-0002'), dR('N', '16-0003'), dR('C', '02-0001')], [dV('16-0001'), dV('16-0003')]);
    expect(r.pozos.map((p) => p.wellId)).toEqual(['14-0001', '14-0002', '14-0003', '15-0100', '02-0001', '16-0001', '16-0002', '16-0003']);
    expect(r.resumen.nuevos).toBe(4);
    const n003 = r.pozos.filter((p) => p.wellId === '16-0003')[0];
    expect(n003.estado).toBe('V');                             // N + V sin base: V
    expect(r.pozos.filter((p) => p.wellId === '16-0002')[0].estado).toBe('R');
    const solo = U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('N', '17-0001')], []);
    expect(solo.pozos).toBe(pozos);
    expect(solo.resumen.sinPunto).toBe(1);
  });

  test('si ninguna capa cambia nada, devuelve la MISMA lista (referencia estable)', () => {
    const pozos = congelar(dataset());
    expect(U.ubicacionOperativaLogic_aplicarCapas(pozos, [], []).pozos).toBe(pozos);
    expect(U.ubicacionOperativaLogic_aplicarCapas(pozos, null, undefined).pozos).toBe(pozos);
    expect(U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('D', '14-0001', IRR)], []).pozos).toBe(pozos);      // el delta coincide con la base
    expect(U.ubicacionOperativaLogic_aplicarCapas(pozos, [{ wellId: '14-0001', estado: 'R', lat: NaN, lon: 1 }], []).pozos).toBe(pozos);
  });

  test('entradas invalidas o repetidas se informan en el resumen y NO cambian ningun punto', () => {
    const pozos = congelar(dataset());
    const r = U.ubicacionOperativaLogic_aplicarCapas(pozos, [
      { wellId: '14-0001', estado: 'R', lat: -55, lon: -69 }, { wellId: '14-0002', estado: 'Z' }, dR('R', '14-0003'), dR('N', '14-0003'), { wellId: '15-0100', estado: 'N' }, { wellId: '15-0100', estado: 'N' }
    ], [dV('14-0001', { lat: NaN })]);
    expect(r.resumen.registral.recibidas).toBe(6);
    expect(r.resumen.registral.descartadas).toEqual([{ wellId: '14-0001', motivo: 'COORDENADA_INVALIDA' }, { wellId: '14-0002', motivo: 'ESTADO_DESCONOCIDO' }, { wellId: '14-0003', motivo: 'DUPLICADA_CONFLICTIVA' }]);
    expect(r.resumen.registral.duplicadas).toBe(2);
    expect(r.resumen.campo.recibidas).toBe(1);
    expect(r.resumen.campo.descartadas).toEqual([{ wellId: '14-0001', motivo: 'COORDENADA_INVALIDA' }]);
    expect(r.pozos.map((p) => p.wellId)).toEqual(['14-0001', '14-0002', '14-0003']);              // 15-0100 con N valido se retira; los demas intactos
    expect(r.pozos[0]).toBe(pozos[0]);
    expect(r.pozos[2]).toBe(pozos[2]);
    expect(r.resumen.quitados).toBe(1);
  });

  test('obtenerRegistral solo se llama para pozos SIN punto base; si lanza, el pozo se agrega igual con "Sin dato"', () => {
    const pozos = congelar(dataset());
    const llamadas = [];
    const r = U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('R', '14-0001'), dR('R', '16-0002'), dR('D', '16-0003')], [], {
      obtenerRegistral: (w) => { llamadas.push(w); if (w === '16-0003') { throw new Error('padron caido'); } return { profundidad: 77 }; }
    });
    expect(llamadas).toEqual(['16-0002', '16-0003']);
    expect(r.pozos.filter((p) => p.wellId === '16-0002')[0].profundidad).toBe(77);
    expect(r.pozos.filter((p) => p.wellId === '16-0003')[0].profundidad).toBeNull();
  });

  test('entradas que no son lista no rompen nada', () => {
    const pozos = congelar(dataset());
    [null, undefined, 'x', 5, {}].forEach((x) => expect(U.ubicacionOperativaLogic_aplicarCapas(pozos, x, x).pozos).toBe(pozos));
    expect(U.ubicacionOperativaLogic_aplicarCapas(null, [dR('R')], []).pozos.map((p) => p.wellId)).toEqual([W]);
  });

  test('un elemento de la lista que no es un punto (null) se conserva donde esta', () => {
    const r = U.ubicacionOperativaLogic_aplicarCapas([null, pozo(W)], [dR('R')], []);
    expect(r.pozos[0]).toBeNull();
    expect(r.pozos[1].estado).toBe('R');
  });
});

describe('los consumidores heredan el resultado sin cambios (logica pura existente)', () => {
  const pozos = [pozo('14-0001'), pozo('14-0002', { lat: OTRO.lat, lon: OTRO.lon }), pozo('15-0100', { lat: -33.6, lon: -69.3, estado: 'C' })];
  const compuesto = () => U.ubicacionOperativaLogic_aplicarCapas(pozos, [dR('R', '14-0001', { lat: -33.5, lon: -69.25 }), dR('N', '14-0002')], []).pozos;

  test('Cerca Mio: el pozo con R aparece en SU lugar; el que quedo sin punto no aparece', () => {
    const r = compuesto();
    expect(cercaMioLogic_buscarCercanos(pozos, IRR.lat, IRR.lon, 1000, 100).map((p) => p.wellId)).toEqual(['14-0001']);
    expect(cercaMioLogic_buscarCercanos(r, IRR.lat, IRR.lon, 1000, 100)).toEqual([]);
    const nuevo = cercaMioLogic_buscarCercanos(r, -33.5, -69.25, 50, 100);
    expect(nuevo.map((p) => p.wellId)).toEqual(['14-0001']);
    expect(nuevo[0].estado).toBe('R');
    expect(cercaMioLogic_buscarCercanos(r, OTRO.lat, OTRO.lon, 500, 100)).toEqual([]);
  });

  test('Seleccion por poligono: el pozo con R entra por su punto aceptado; el que quedo sin punto no participa', () => {
    const poligono = [{ lat: -33.51, lon: -69.26 }, { lat: -33.51, lon: -69.24 }, { lat: -33.49, lon: -69.24 }, { lat: -33.49, lon: -69.26 }];
    const grande = [{ lat: -33.45, lon: -69.25 }, { lat: -33.45, lon: -69.15 }, { lat: -33.35, lon: -69.15 }, { lat: -33.35, lon: -69.25 }];
    expect(seleccionLogic_filtrarPorPoligono(pozos, poligono, 0)).toEqual([]);
    expect(seleccionLogic_filtrarPorPoligono(compuesto(), poligono, 0)).toEqual(['14-0001']);
    expect(seleccionLogic_filtrarPorPoligono(pozos, grande, 0)).toContain('14-0002');
    expect(seleccionLogic_filtrarPorPoligono(compuesto(), grande, 0)).not.toContain('14-0002');
  });
});

describe('aislamiento: la composicion es logica pura y solo la cablea mapaDataset', () => {
  const raiz = path.join(__dirname, '..');
  const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
  const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('SOLO js/mapaDataset.js usa la composicion (aplicarCapas, nada mas) y SOLO js/api.js nombra el endpoint del delta; el resto del frontend no conoce ninguno', () => {
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'ubicacionOperativaLogic.js').forEach((f) => {
      const codigo = sinComentarios(leer('js', f));
      if (f === 'mapaDataset.js') {
        expect(codigo).toMatch(/ubicacionOperativaLogic_aplicarCapas/);
        expect(codigo).not.toMatch(/componerPunto|DeltasRegistrales|normalizarDeltaRegistral|UOP_DELTA_REGISTRAL|ubicacionOperativaLogic_aplicarOverlay|resolverPuntoDataset/);
      } else {
        expect(codigo).not.toMatch(/componerPunto|aplicarCapas|DeltasRegistrales|normalizarDeltaRegistral|UOP_DELTA_REGISTRAL/);
      }
      if (f !== 'api.js') {
        expect(codigo).not.toMatch(/getDecisionesFuentesDelta/);
      }
    });
  });

  test('el modulo sigue puro (sin DOM, red ni almacenamiento) y no usa nombres ambiguos con el estado de reemplazo', () => {
    const codigo = sinComentarios(leer('js', 'ubicacionOperativaLogic.js'));
    expect(codigo).not.toMatch(/document\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\bL\.|navigator\.|console\./);
    expect(codigo).not.toMatch(/\bapi[A-Z]\w+\(|callBackend|Logger/);
    expect(codigo).not.toMatch(/estadoR\b|estadoReemplazo/);
  });

  test('el backend no referencia el modulo del frontend', () => {
    fs.readdirSync(path.join(raiz, 'backend', 'src')).forEach((f) => expect(leer('backend', 'src', f)).not.toMatch(/ubicacionOperativa/));
  });
});

describe('rendimiento (humo, umbral generoso)', () => {
  test('componer 14.000 puntos con 1.000 deltas registrales y 1.000 de campo es instantaneo y no cambia la lista de entrada', () => {
    const base = [];
    for (let i = 0; i < 14000; i += 1) {
      base.push(pozo(String(1 + (i % 19)).padStart(2, '0') + '-' + String(1000 + Math.floor(i / 19)).padStart(4, '0'), { lat: -33.3 - i * 0.00001, lon: -69.1 }));
    }
    const reg = [];
    const campo = [];
    for (let i = 0; i < 1000; i += 1) {
      reg.push({ wellId: base[i * 7].wellId, estado: i % 5 === 0 ? 'N' : 'R', lat: -33.3 - i * 0.00002, lon: -69.2 });
      campo.push({ wellId: base[i * 7 + 3].wellId, lat: -33.31, lon: -69.11, vts: '2026-10-12T14:05:00' });
    }
    const copia = base.length;
    const t0 = Date.now();
    const r = U.ubicacionOperativaLogic_aplicarCapas(base, reg, campo);
    const ms = Date.now() - t0;
    expect(base).toHaveLength(copia);
    expect(r.resumen.quitados).toBe(200);
    expect(r.pozos.length).toBe(14000 - 200);
    expect(ms).toBeLessThan(1000);
  });
});
