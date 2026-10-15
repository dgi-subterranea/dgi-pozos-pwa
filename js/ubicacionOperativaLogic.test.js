// PUNTO OPERATIVO del pozo (Etapa 1, modulo puro): reglas R1/R2/R0, overlay sobre el dataset del mapa, enriquecimiento de pozos nuevos, inmutabilidad,
// contrato (fuente / estado / confianza separados, nada sensible en el camino caliente) y compatibilidad con los consumidores futuros (Cerca Mio, seleccion).
const fs = require('fs');
const path = require('path');
const U = require('./ubicacionOperativaLogic');
const { cercaMioLogic_buscarCercanos } = require('./cercaMioLogic');
const { seleccionLogic_filtrarPorPoligono } = require('./seleccionLogic');
const Corr = require('./ubicacionCorreccionLogic');
const Backend = require('../backend/src/UbicacionCorreccionService');

const IRR = { lat: -33.34765, lon: -69.14545 };
const CAMPO = { lat: -33.34745, lon: -69.14545 };       // a 22,2 m, el caso real del proyecto

// punto de pozos.json tal como lo entrega getMapaPozos
const pozo = (wellId, extra) => Object.assign({
  wellId: wellId, lat: IRR.lat, lon: IRR.lon, estado: 'D', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo'
}, extra || {});
const delta = (wellId, extra) => Object.assign({ wellId: wellId, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-12T14:05:00' }, extra || {});

// congela en profundidad: cualquier mutacion accidental lanza TypeError (los tests corren en modo estricto de Jest/Babel)
function congelar(v) {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    Object.keys(v).forEach((k) => congelar(v[k]));
  }
  return v;
}

describe('tablas: estados, codigos, etiquetas y confianza', () => {
  test('D / C / V <-> DISPONIBLE / COINCIDENTE / VALIDADA_CAMPO, en los dos sentidos', () => {
    expect(U.ubicacionOperativaLogic_estadoDeCodigo('D')).toBe('DISPONIBLE');
    expect(U.ubicacionOperativaLogic_estadoDeCodigo('C')).toBe('COINCIDENTE');
    expect(U.ubicacionOperativaLogic_estadoDeCodigo('V')).toBe('VALIDADA_CAMPO');
    ['X', '', null, undefined, 'constructor', '__proto__', 5].forEach((c) => expect(U.ubicacionOperativaLogic_estadoDeCodigo(c)).toBeNull());
    expect(U.ubicacionOperativaLogic_codigoDeEstado('DISPONIBLE')).toBe('D');
    expect(U.ubicacionOperativaLogic_codigoDeEstado('COINCIDENTE')).toBe('C');
    expect(U.ubicacionOperativaLogic_codigoDeEstado('VALIDADA_CAMPO')).toBe('V');
    ['DISCREPANCIA', 'SIN_COORDENADAS', 'toString', null].forEach((e) => expect(U.ubicacionOperativaLogic_codigoDeEstado(e)).toBeNull());
  });

  test('confianza por TABLA: A validada, B coincidente, C disponible, D discrepancia, null sin coordenadas', () => {
    expect(U.UOP_CONFIANZA_POR_ESTADO).toEqual({ VALIDADA_CAMPO: 'A', COINCIDENTE: 'B', DISPONIBLE: 'C', DISCREPANCIA: 'D', SIN_COORDENADAS: null });
    expect(U.ubicacionOperativaLogic_confianzaDeEstado('VALIDADA_CAMPO')).toBe('A');
    expect(U.ubicacionOperativaLogic_confianzaDeEstado('inventado')).toBeNull();
    expect(U.ubicacionOperativaLogic_confianzaDeEstado('hasOwnProperty')).toBeNull();
  });

  test('etiquetas humanas largas y cortas (D = disponible, C = coincidente, V = validada en campo)', () => {
    expect(U.ubicacionOperativaLogic_etiquetaEstado('DISPONIBLE')).toBe('Ubicación disponible');
    expect(U.ubicacionOperativaLogic_etiquetaEstado('COINCIDENTE')).toBe('Ubicación coincidente');
    expect(U.ubicacionOperativaLogic_etiquetaEstado('VALIDADA_CAMPO')).toBe('Validada en campo');
    expect(U.ubicacionOperativaLogic_etiquetaEstado('DISCREPANCIA')).toBe('Discrepancia');
    expect(U.ubicacionOperativaLogic_etiquetaEstado('SIN_COORDENADAS')).toBe('Sin coordenadas');
    expect(U.ubicacionOperativaLogic_etiquetaEstado('x')).toBe('');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('D', true)).toBe('Disponible');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('C', true)).toBe('Coincidente');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('V', true)).toBe('Validada en campo');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('C', false)).toBe('Ubicación coincidente');
    expect(U.ubicacionOperativaLogic_etiquetaCodigo('Z', true)).toBe('');
  });

  test('"Confirmada en campo" queda RESERVADA: ninguna etiqueta, estado ni codigo la usa todavia; "confirmada" a secas tampoco', () => {
    const todo = JSON.stringify([U.UOP_ETIQUETAS_ESTADO, U.UOP_ETIQUETAS_CODIGO_CORTAS, U.UOP_ESTADOS, U.UOP_FUENTES]);
    expect(todo).not.toMatch(/onfirmad/);
    expect(Object.keys(U.UOP_ESTADOS)).not.toContain('CONFIRMADA_CAMPO');
  });

  test('fuente, estado y confianza son tres vocabularios DISTINTOS (ningun valor se repite entre ellos)', () => {
    const fuentes = Object.values(U.UOP_FUENTES);
    const estados = Object.values(U.UOP_ESTADOS);
    const confianzas = ['A', 'B', 'C', 'D'];
    fuentes.forEach((f) => { expect(estados).not.toContain(f); expect(confianzas).not.toContain(f); });
    estados.forEach((e) => expect(confianzas).not.toContain(e));
  });

  test('mapeo del padron: los 6 estados de ubicacionResuelta, con los tres niveles de DISCREPANCIA', () => {
    expect(U.UOP_ESTADO_PADRON).toEqual({
      sinCoordenadas: { estado: 'SIN_COORDENADAS' }, unica: { estado: 'DISPONIBLE' }, corroborada: { estado: 'COINCIDENTE' },
      dudosoLeve: { estado: 'DISCREPANCIA', nivel: 'leve' }, revisar: { estado: 'DISCREPANCIA', nivel: 'revisar' }, revisarGrave: { estado: 'DISCREPANCIA', nivel: 'grave' }
    });
  });

  test('el recuadro de Mendoza es el MISMO que el del backend', () => {
    expect(U.UOP_MENDOZA_BBOX).toEqual(Backend.UBICACION_CORR_MENDOZA_BBOX);
  });

  test('la distancia coincide con la de las correcciones (mismo haversine, mismo radio, redondeo a 0,1 m)', () => {
    const casos = [[IRR.lat, IRR.lon, CAMPO.lat, CAMPO.lon], [-33, -68, -34, -69], [-32.5, -68.5, -32.5, -68.5], [-35.2, -69.9, -33.1, -67.2]];
    casos.forEach(([a, b, c, d]) => expect(U.ubicacionOperativaLogic_distanciaMetros(a, b, c, d)).toBe(Corr.ubicacionCorreccionLogic_distanciaMetros(a, b, c, d)));
    expect(U.ubicacionOperativaLogic_distanciaMetros(IRR.lat, IRR.lon, CAMPO.lat, CAMPO.lon)).toBeCloseTo(22.2, 1);
  });

  test('coordenada valida: finita, numerica y dentro de Mendoza; texto, NaN, Infinity y fuera del recuadro NO', () => {
    expect(U.ubicacionOperativaLogic_coordenadaValida(-33.3, -68.8)).toBe(true);
    [[-33.3, '-68.8'], ['-33.3', -68.8], [NaN, -68.8], [-33.3, Infinity], [null, null], [undefined, -68], [0, 0], [-40, -68.8], [-33.3, -60], [-30, -68.8]].forEach(([a, b]) => {
      expect(U.ubicacionOperativaLogic_coordenadaValida(a, b)).toBe(false);
    });
  });
});

describe('deltas: normalizacion e indexado', () => {
  test('un delta valido conserva SOLO wellId, lat, lon y vts; nada mas pasa', () => {
    const r = U.ubicacionOperativaLogic_normalizarDelta(delta('14-0001', { nombre: 'Ana', email: 'a@x.com', observacion: 'obs', motivo: 'm', correccionId: 'abc', metodo: 'PUNTO_EN_MAPA', historial: [1] }));
    expect(r).toEqual({ wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-12T14:05:00' });
    expect(Object.keys(r).sort()).toEqual(['lat', 'lon', 'vts', 'wellId']);
  });

  test.each([
    ['sin wellId', { lat: -33.3, lon: -68.8 }], ['wellId mal formado', { wellId: '14-001', lat: -33.3, lon: -68.8 }], ['departamento 00', { wellId: '00-0001', lat: -33.3, lon: -68.8 }],
    ['departamento 20', { wellId: '20-0001', lat: -33.3, lon: -68.8 }], ['wellId numerico', { wellId: 140001, lat: -33.3, lon: -68.8 }],
    ['lat texto', { wellId: '14-0001', lat: '-33.3', lon: -68.8 }], ['lon NaN', { wellId: '14-0001', lat: -33.3, lon: NaN }],
    ['fuera de Mendoza', { wellId: '14-0001', lat: 10, lon: -68.8 }], ['sin coordenadas', { wellId: '14-0001' }]
  ])('delta invalido (%s): se descarta', (_n, d) => {
    expect(U.ubicacionOperativaLogic_normalizarDelta(d)).toBeNull();
  });

  test.each([[null], [undefined], ['x'], [5], [[]], [() => 1]])('entrada no objeto (%p): null', (v) => {
    expect(U.ubicacionOperativaLogic_normalizarDelta(v)).toBeNull();
  });

  test('vts: texto o numero se conserva; vacio, enorme, objeto o ausente queda null (no invalida el delta)', () => {
    const v = (x) => U.ubicacionOperativaLogic_normalizarDelta({ wellId: '14-0001', lat: -33.3, lon: -68.8, vts: x }).vts;
    expect(v('2026-10-12T14:05:00')).toBe('2026-10-12T14:05:00');
    expect(v(1760000000)).toBe(1760000000);
    [undefined, null, '', 'x'.repeat(41), {}, NaN, [], true].forEach((x) => expect(v(x)).toBeNull());
  });

  test('indexar: descarta lo invalido con su motivo, sin lanzar; no-lista = vacio', () => {
    const r = U.ubicacionOperativaLogic_indexarDeltas([delta('14-0001'), null, 'x', { wellId: '14-0002', lat: 'a', lon: 1 }, { wellId: 'zz', lat: -33, lon: -68 }, delta('14-0003')]);
    expect(Object.keys(r.porWell).sort()).toEqual(['14-0001', '14-0003']);
    expect(r.descartadas).toEqual([
      { wellId: null, motivo: 'NO_ES_OBJETO' }, { wellId: null, motivo: 'NO_ES_OBJETO' },
      { wellId: '14-0002', motivo: 'COORDENADA_INVALIDA' }, { wellId: 'zz', motivo: 'WELL_ID_INVALIDO' }
    ]);
    [null, undefined, 'x', 5, {}].forEach((v) => expect(U.ubicacionOperativaLogic_indexarDeltas(v)).toEqual({ porWell: {}, descartadas: [], duplicadas: 0 }));
  });

  test('duplicados del mismo pozo: gana el vts mas reciente, sin importar el orden; sin vts comparable gana el ultimo', () => {
    const viejo = delta('14-0001', { lat: -33.1, lon: -68.1, vts: '2026-10-01T10:00:00' });
    const nuevo = delta('14-0001', { lat: -33.2, lon: -68.2, vts: '2026-10-12T10:00:00' });
    [[viejo, nuevo], [nuevo, viejo]].forEach((lista) => {
      const r = U.ubicacionOperativaLogic_indexarDeltas(lista);
      expect(r.porWell['14-0001'].lat).toBe(-33.2);
      expect(r.duplicadas).toBe(1);
    });
    const a = delta('14-0001', { lat: -33.1, vts: null });
    const b = delta('14-0001', { lat: -33.2, vts: null });
    expect(U.ubicacionOperativaLogic_indexarDeltas([a, b]).porWell['14-0001'].lat).toBe(-33.2);
  });

  test('el indice no hereda del prototipo ("constructor" o "__proto__" no son pozos)', () => {
    const r = U.ubicacionOperativaLogic_indexarDeltas([delta('14-0001')]);
    expect(r.porWell.constructor).toBeUndefined();
    expect(r.porWell.__proto__).toBeUndefined();
  });
});

describe('vigente de una lista de correcciones', () => {
  const c = (id, estado, ts) => ({ correccionId: id, estado: estado, timestamp: ts, lat: -33.3, lon: -68.8 });

  test('solo VALIDADA es vigente; SUPERADA, REVERTIDA, RECHAZADA, PROPUESTA e INCONSISTENTE no', () => {
    ['SUPERADA', 'REVERTIDA', 'RECHAZADA', 'PROPUESTA', 'INCONSISTENTE', 'validada', undefined].forEach((estado) => {
      expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones([c('a', estado, '2026-10-12 10:00:00')])).toBeNull();
    });
    expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones([c('a', 'VALIDADA', '2026-10-12 10:00:00')]).correccionId).toBe('a');
  });

  test('varias historicas y UNA vigente: devuelve la vigente, sin importar el orden', () => {
    const lista = [c('a', 'SUPERADA', '2026-10-01 10:00:00'), c('b', 'VALIDADA', '2026-10-12 10:00:00'), c('c', 'RECHAZADA', '2026-10-13 10:00:00'), c('d', 'REVERTIDA', '2026-09-01 10:00:00')];
    expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones(lista).correccionId).toBe('b');
    expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones(lista.slice().reverse()).correccionId).toBe('b');
  });

  test('inconsistencia (dos VALIDADA): la mas reciente, igual que el backend', () => {
    expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones([c('a', 'VALIDADA', '2026-10-01 10:00:00'), c('b', 'VALIDADA', '2026-10-12 10:00:00')]).correccionId).toBe('b');
  });

  test.each([[null], [undefined], [[]], ['x'], [{}], [[null, 5, 'x']]])('entrada rara (%p): null', (v) => {
    expect(U.ubicacionOperativaLogic_vigenteDeCorrecciones(v)).toBeNull();
  });
});

describe('punto del dataset: un pozo', () => {
  test('A. pozo con punto de padron + validada: usa lat/lon validada, estado V, fuente CAMPO, y conserva la base y los atributos', () => {
    const base = pozo('14-0001');
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(base, delta('14-0001'));
    expect(r).toEqual({
      wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', cuenca: 'Río Mendoza', profundidad: 120, tramosFiltrantes: [{ desde: 60, hasta: 100 }], surgencia: 'Profundo',
      fuente: 'CAMPO', base: { lat: IRR.lat, lon: IRR.lon, estado: 'D' }, vts: '2026-10-12T14:05:00'
    });
  });

  test('un punto COINCIDENTE (C) tambien: la base guarda estado C', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001', { estado: 'C' }), delta('14-0001'));
    expect(r.estado).toBe('V');
    expect(r.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'C' });
  });

  test('NO muta el punto base ni el delta (profundamente congelados) y devuelve un objeto NUEVO', () => {
    const base = congelar(pozo('14-0001'));
    const d = congelar(delta('14-0001'));
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(base, d);
    expect(r).not.toBe(base);
    expect(base.estado).toBe('D');
    expect(base.lat).toBe(IRR.lat);
    expect('base' in base).toBe(false);
    expect('fuente' in base).toBe(false);
    expect(Object.isFrozen(r)).toBe(false);
  });

  test('sin override: devuelve el MISMO punto base (sin copiar) y sin override ni base: null (R0)', () => {
    const base = pozo('14-0001');
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(base, null)).toBe(base);
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(base, undefined)).toBe(base);
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, null)).toBeNull();
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(undefined, undefined, { profundidad: 5 })).toBeNull();
  });

  test('un delta INVALIDO no reemplaza nada: se conserva el base', () => {
    const base = pozo('14-0001');
    ['x', { wellId: '14-0001', lat: 'a', lon: 1 }, { wellId: '14-0001', lat: 5, lon: 5 }].forEach((d) => {
      expect(U.ubicacionOperativaLogic_resolverPuntoDataset(base, d)).toBe(base);
    });
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, { wellId: '14-0001', lat: 'a', lon: 1 }, { profundidad: 5 })).toBeNull();
  });

  test('B. pozo SIN punto en el mapa + validada: aparece, con base null, estado V y fuente CAMPO', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'), null);
    expect(r).toEqual({
      wellId: '14-0500', lat: CAMPO.lat, lon: CAMPO.lon, estado: 'V', cuenca: null, profundidad: null, tramosFiltrantes: [], surgencia: null,
      fuente: 'CAMPO', base: null, vts: '2026-10-12T14:05:00'
    });
  });

  test('B. con metadata registral: se enriquece con profundidad, tramos y surgencia; la cuenca solo si la trae (el padron no la guarda)', () => {
    const registral = { profundidadTotal: 150, tramosFiltrantes: [{ desde: 80, hasta: 120, diametro: 8 }, { desde: 130, hasta: 140 }], surgencia: 'Natural', titular: 'NO DEBE PASAR', nc16: 'x' };
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'), registral);
    expect(r.profundidad).toBe(150);
    expect(r.tramosFiltrantes).toEqual([{ desde: 80, hasta: 120 }, { desde: 130, hasta: 140 }]);
    expect(r.surgencia).toBe('Natural');
    expect(r.cuenca).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/titular|NO DEBE PASAR|nc16|diametro/);
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'), { profundidad: 99, cuenca: 'Río Atuel' })).toMatchObject({ profundidad: 99, cuenca: 'Río Atuel' });
  });

  test('B. registral parcial o rara: "Sin dato" solo donde realmente falta (null / lista vacia), nunca inventado', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'), { profundidadTotal: 'mucha', tramosFiltrantes: [null, 'x', { desde: '5', hasta: 9 }], surgencia: '', cuenca: 7 });
    expect(r.profundidad).toBeNull();
    expect(r.tramosFiltrantes).toEqual([{ desde: null, hasta: 9 }]);
    expect(r.surgencia).toBeNull();
    expect(r.cuenca).toBeNull();
    ['x', 5, [], null, undefined].forEach((reg) => expect(U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'), reg)).toMatchObject({ profundidad: null, tramosFiltrantes: [], surgencia: null, cuenca: null }));
  });

  test('con punto base la metadata del padron NO pisa la del dataset (la cuenca existente se mantiene aunque el pozo se mueva)', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001', { cuenca: 'Río Tunuyán Superior' }), delta('14-0001', { lat: -34.9, lon: -68.9 }), { cuenca: 'Río Atuel', profundidad: 1, surgencia: 'Natural' });
    expect(r.cuenca).toBe('Río Tunuyán Superior');
    expect(r.profundidad).toBe(120);
    expect(r.surgencia).toBe('Profundo');
  });

  test('C. pozo antes dudoso/revisar (no estaba en el mapa) + validada: entra como V; la discrepancia vive en el contrato completo', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0700'), { profundidad: 80 });
    expect(r).toMatchObject({ wellId: '14-0700', estado: 'V', fuente: 'CAMPO', base: null, profundidad: 80 });
  });

  test('misma coordenada que la base: sigue siendo V (validada en campo); la base queda registrada', () => {
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001'), delta('14-0001', { lat: IRR.lat, lon: IRR.lon }));
    expect(r.estado).toBe('V');
    expect(r.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'D' });
  });

  test('IDEMPOTENTE: aplicar dos veces (o con un delta mas nuevo) NO anida la base: siempre guarda la ORIGINAL de Irrigacion', () => {
    const base = pozo('14-0001');
    const una = U.ubicacionOperativaLogic_resolverPuntoDataset(base, delta('14-0001'));
    const dos = U.ubicacionOperativaLogic_resolverPuntoDataset(una, delta('14-0001', { lat: -33.349, lon: -69.15, vts: '2026-10-13T09:00:00' }));
    expect(dos.base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'D' });
    expect(dos.lat).toBe(-33.349);
    expect(dos.vts).toBe('2026-10-13T09:00:00');
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(una, delta('14-0001'))).toEqual(una);
    const sinBase = U.ubicacionOperativaLogic_resolverPuntoDataset(null, delta('14-0500'));
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(sinBase, delta('14-0500', { vts: '2026-10-14T00:00:00' })).base).toBeNull();
  });

  test('base con estado raro o sin coordenada valida: la base del override queda con estado null / base null, sin romper', () => {
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001', { estado: 'Z' }), delta('14-0001')).base).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: null });
    expect(U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001', { lat: null }), delta('14-0001')).base).toBeNull();
  });

  test('el camino caliente NUNCA lleva datos sensibles: ni con un delta cargado de campos de mas', () => {
    const sucio = delta('14-0001', { nombre: 'Ana Pérez', nombrePropone: 'Ana', email: 'a@x.com', emailPropone: 'a@x.com', observacion: 'obs', motivo: 'm', correccionId: 'uuid', metodo: 'GPS_ACTUAL', historial: [{}], resolucion: {}, titular: 'T', nc16: 'N' });
    const r = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001'), sucio);
    expect(Object.keys(r).sort()).toEqual(['base', 'cuenca', 'estado', 'fuente', 'lat', 'lon', 'profundidad', 'surgencia', 'tramosFiltrantes', 'vts', 'wellId']);
    expect(JSON.stringify(r)).not.toMatch(/Ana|@|obs|uuid|GPS_ACTUAL|historial|titular|nc16|confianza/);
    const nuevo = U.ubicacionOperativaLogic_resolverPuntoDataset(null, sucio, { titular: 'T' });
    expect(JSON.stringify(nuevo)).not.toMatch(/Ana|@|obs|uuid|GPS_ACTUAL|historial|titular|nc16|confianza/);
  });

  test('info de un punto del dataset: estado completo, fuente generica (IRR o CAMPO_CORREGIDA) y confianza derivada, sin viajar en el punto', () => {
    expect(U.ubicacionOperativaLogic_infoDePuntoDataset(pozo('14-0001'))).toEqual({ estado: 'DISPONIBLE', fuente: 'IRR', confianza: 'C', etiqueta: 'Ubicación disponible' });
    expect(U.ubicacionOperativaLogic_infoDePuntoDataset(pozo('14-0001', { estado: 'C' }))).toEqual({ estado: 'COINCIDENTE', fuente: 'IRR', confianza: 'B', etiqueta: 'Ubicación coincidente' });
    const v = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001'), delta('14-0001'));
    expect(U.ubicacionOperativaLogic_infoDePuntoDataset(v)).toEqual({ estado: 'VALIDADA_CAMPO', fuente: 'CAMPO_CORREGIDA', confianza: 'A', etiqueta: 'Validada en campo' });
    [null, undefined, {}, { estado: 'Q' }, 'x'].forEach((p) => expect(U.ubicacionOperativaLogic_infoDePuntoDataset(p)).toBeNull());
  });
});

describe('overlay sobre el dataset completo', () => {
  const dataset = () => [pozo('04-0001'), pozo('14-0001'), pozo('14-0002', { estado: 'C' }), pozo('15-0100')];

  test('F. sin ninguna correccion: la MISMA lista (identidad), resumen en cero', () => {
    const base = dataset();
    [[], null, undefined, 'x'].forEach((deltas) => {
      const r = U.ubicacionOperativaLogic_aplicarOverlay(base, deltas);
      expect(r.pozos).toBe(base);
      expect(r.resumen).toMatchObject({ aplicadas: 0, nuevos: 0, nuevosEnriquecidos: 0, nuevosSinRegistral: 0, duplicadas: 0 });
    });
    expect(U.ubicacionOperativaLogic_aplicarOverlay(base, [null, { wellId: 'zz' }]).pozos).toBe(base);
  });

  test('con overrides: lista NUEVA, mismo orden, los puntos sin override son los MISMOS objetos y la lista original no cambia', () => {
    const base = congelar(dataset());
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001')]);
    expect(r.pozos).not.toBe(base);
    expect(r.pozos.map((p) => p.wellId)).toEqual(['04-0001', '14-0001', '14-0002', '15-0100']);
    expect(r.pozos[0]).toBe(base[0]);
    expect(r.pozos[2]).toBe(base[2]);
    expect(r.pozos[3]).toBe(base[3]);
    expect(r.pozos[1]).not.toBe(base[1]);
    expect(r.pozos[1].estado).toBe('V');
    expect(base[1].estado).toBe('D');
    expect(r.resumen).toMatchObject({ recibidas: 1, aplicadas: 1, nuevos: 0 });
  });

  test('UN solo punto por pozo: el movido reemplaza al anterior (no se agrega otro), y la cantidad solo crece con pozos nuevos', () => {
    const base = dataset();
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001'), delta('14-0002')]);
    expect(r.pozos).toHaveLength(base.length);
    expect(new Set(r.pozos.map((p) => p.wellId)).size).toBe(r.pozos.length);
    const r2 = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001'), delta('14-0900')]);
    expect(r2.pozos).toHaveLength(base.length + 1);
    expect(new Set(r2.pozos.map((p) => p.wellId)).size).toBe(r2.pozos.length);
  });

  test('pozos NUEVOS: van al final ordenados por wellId; se enriquecen del padron y se cuentan (con y sin metadata)', () => {
    const base = dataset();
    const registrales = { '14-0900': { profundidadTotal: 100, surgencia: 'Natural' }, '05-0010': { tramosFiltrantes: [{ desde: 1, hasta: 2 }] } };
    const pedidos = [];
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0900'), delta('05-0010'), delta('07-0777')], {
      obtenerRegistral: (w) => { pedidos.push(w); return registrales[w] || null; }
    });
    expect(r.pozos.slice(4).map((p) => p.wellId)).toEqual(['05-0010', '07-0777', '14-0900']);
    expect(r.pozos.find((p) => p.wellId === '14-0900')).toMatchObject({ profundidad: 100, surgencia: 'Natural', estado: 'V', base: null });
    expect(r.pozos.find((p) => p.wellId === '05-0010').tramosFiltrantes).toEqual([{ desde: 1, hasta: 2 }]);
    expect(r.pozos.find((p) => p.wellId === '07-0777')).toMatchObject({ profundidad: null, tramosFiltrantes: [], surgencia: null });
    expect(r.resumen).toMatchObject({ aplicadas: 3, nuevos: 3, nuevosEnriquecidos: 2, nuevosSinRegistral: 1 });
    expect(pedidos.sort()).toEqual(['05-0010', '07-0777', '14-0900']);
  });

  test('obtenerRegistral SOLO se consulta para pozos sin punto base (los que ya estan conservan su metadata del dataset)', () => {
    const obtenerRegistral = jest.fn(() => ({ profundidad: 1 }));
    U.ubicacionOperativaLogic_aplicarOverlay(dataset(), [delta('14-0001'), delta('14-0002')], { obtenerRegistral: obtenerRegistral });
    expect(obtenerRegistral).not.toHaveBeenCalled();
  });

  test('si obtenerRegistral LANZA, el override valido no se pierde: el pozo entra sin esos datos ("Sin dato")', () => {
    const r = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), [delta('14-0900')], { obtenerRegistral: () => { throw new Error('Drive caido'); } });
    expect(r.pozos[r.pozos.length - 1]).toMatchObject({ wellId: '14-0900', estado: 'V', profundidad: null, tramosFiltrantes: [], surgencia: null });
    expect(r.resumen).toMatchObject({ nuevos: 1, nuevosEnriquecidos: 0, nuevosSinRegistral: 1 });
  });

  test('sin opciones.obtenerRegistral los nuevos entran igual, sin metadata', () => {
    const r = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), [delta('14-0900')]);
    expect(r.pozos).toHaveLength(5);
    expect(r.resumen.nuevosSinRegistral).toBe(1);
  });

  test('deltas invalidos o duplicados: se informan en el resumen y no rompen nada; el valido se aplica', () => {
    const r = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), [delta('14-0001'), { wellId: '14-0002', lat: 'x', lon: 1 }, delta('14-0001', { lat: -33.2, vts: '2026-10-20T00:00:00' }), 7]);
    expect(r.resumen).toMatchObject({ recibidas: 4, aplicadas: 1, duplicadas: 1 });
    expect(r.resumen.descartadas).toHaveLength(2);
    expect(r.pozos.find((p) => p.wellId === '14-0001').lat).toBe(-33.2);
    expect(r.pozos.find((p) => p.wellId === '14-0002').estado).toBe('C');
  });

  test('H. REVERTIDA / SUPERADA / RECHAZADA / PROPUESTA: el backend ya no manda delta -> el pozo vuelve a su base (lo mismo que el punto de pozos.json)', () => {
    const base = dataset();
    const conOverride = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001')]);
    expect(conOverride.pozos[1].estado).toBe('V');
    const revertida = U.ubicacionOperativaLogic_aplicarOverlay(base, []);
    expect(revertida.pozos[1]).toBe(base[1]);
    expect(revertida.pozos[1]).toEqual(pozo('14-0001'));
  });

  test('puntos de base raros (null, sin wellId) no rompen el overlay y se conservan', () => {
    const base = [null, { lat: 1 }, pozo('14-0001')];
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001')]);
    expect(r.pozos[0]).toBeNull();
    expect(r.pozos[1]).toBe(base[1]);
    expect(r.pozos[2].estado).toBe('V');
    expect(U.ubicacionOperativaLogic_aplicarOverlay(null, [delta('14-0001')]).pozos).toHaveLength(1);
  });

  test('el overlay es DETERMINISTA: mismo resultado con los deltas en cualquier orden', () => {
    const d = [delta('14-0001'), delta('14-0900', { lat: -33.4 }), delta('05-0010', { lat: -33.5 }), delta('04-0001', { lon: -69.2 })];
    const a = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), d).pozos;
    const b = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), d.slice().reverse()).pozos;
    expect(b).toEqual(a);
  });

  test('aplicar el overlay dos veces sobre su propio resultado da lo mismo (idempotente)', () => {
    const d = [delta('14-0001'), delta('14-0900')];
    const una = U.ubicacionOperativaLogic_aplicarOverlay(dataset(), d).pozos;
    const dos = U.ubicacionOperativaLogic_aplicarOverlay(una, d).pozos;
    expect(dos).toEqual(una);
  });
});

describe('los consumidores futuros heredan el punto operativo sin cambios (logica pura existente)', () => {
  const base = [pozo('14-0001'), pozo('14-0002', { lat: -33.4, lon: -69.2 }), pozo('15-0100', { lat: -33.6, lon: -69.3, estado: 'C' })];

  test('Cerca Mio: una validada MUEVE el pozo (sale del radio viejo, entra al nuevo) y un pozo sin punto base aparece', () => {
    const lejos = { lat: -33.5, lon: -69.25 };
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001', lejos), delta('14-0900', { lat: -33.4005, lon: -69.2005 })]).pozos;
    const antes = cercaMioLogic_buscarCercanos(base, IRR.lat, IRR.lon, 1000, 100).map((p) => p.wellId);
    const despues = cercaMioLogic_buscarCercanos(r, IRR.lat, IRR.lon, 1000, 100).map((p) => p.wellId);
    expect(antes).toEqual(['14-0001']);
    expect(despues).toEqual([]);
    const cerca = cercaMioLogic_buscarCercanos(r, -33.4, -69.2, 200, 100);
    expect(cerca.map((p) => p.wellId)).toEqual(['14-0002', '14-0900']);
    expect(cerca[1].estado).toBe('V');
    const nuevoLugar = cercaMioLogic_buscarCercanos(r, lejos.lat, lejos.lon, 50, 100);
    expect(nuevoLugar.map((p) => p.wellId)).toEqual(['14-0001']);
  });

  test('Cerca Mio: el ranking usa la distancia al punto OPERATIVO y el maximo (30) se aplica sobre el resultado', () => {
    const muchos = [];
    for (let i = 0; i < 40; i += 1) { muchos.push(pozo('14-' + String(i + 1).padStart(4, '0'), { lat: -33.3 - (i + 1) * 0.0001, lon: -69.1 })); }
    const r = U.ubicacionOperativaLogic_aplicarOverlay(muchos, [delta('14-0040', { lat: -33.3, lon: -69.1 })]).pozos;
    const top = cercaMioLogic_buscarCercanos(r, -33.3, -69.1, 5000, 30);
    expect(top).toHaveLength(30);
    expect(top[0].wellId).toBe('14-0040');
    expect(top[0].distanciaMetros).toBeLessThan(1);
  });

  test('Seleccion por poligono: el pozo movido entra/sale segun su punto operativo', () => {
    const poligono = [{ lat: -33.51, lon: -69.26 }, { lat: -33.51, lon: -69.24 }, { lat: -33.49, lon: -69.24 }, { lat: -33.49, lon: -69.26 }];
    expect(seleccionLogic_filtrarPorPoligono(base, poligono, 0)).toEqual([]);
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, [delta('14-0001', { lat: -33.5, lon: -69.25 })]).pozos;
    expect(seleccionLogic_filtrarPorPoligono(r, poligono, 0)).toEqual(['14-0001']);
  });
});

describe('punto operativo COMPLETO: base del padron', () => {
  const resuelta = (extra) => Object.assign({ estado: 'unica', fuente: 'reportePozos', lat: IRR.lat, lon: IRR.lon, x: 1, y: 2 }, extra || {});

  test('unica -> DISPONIBLE (fuente por origen), corroborada -> COINCIDENTE (IRR_VARIAS)', () => {
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta())).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_REPORTE', lat: IRR.lat, lon: IRR.lon, estadoPadron: 'unica', nivel: null });
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta({ fuente: 'coordProvincia' }))).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_PROVINCIA' });
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta({ estado: 'corroborada', fuente: undefined, distanciaCorroboracion: 3.2 })))
      .toMatchObject({ estado: 'COINCIDENTE', fuente: 'IRR_VARIAS', distanciaCorroboracionM: 3.2 });
  });

  test('dudosoLeve / revisar / revisarGrave -> DISCREPANCIA con su nivel; el padron no elige una candidata (sin lat/lon)', () => {
    [['dudosoLeve', 'leve'], ['revisar', 'revisar'], ['revisarGrave', 'grave']].forEach(([estado, nivel]) => {
      const b = U.ubicacionOperativaLogic_baseDeUbicacionResuelta({ estado: estado, distanciaMaxima: 120.5, lat: 1, lon: 1 });
      expect(b).toMatchObject({ estado: 'DISCREPANCIA', nivel: nivel, lat: null, lon: null, fuente: null, distanciaMaximaM: 120.5, estadoPadron: estado });
    });
  });

  test('sinCoordenadas, estado desconocido o ausente -> SIN_COORDENADAS; el desconocido deja una anomalia', () => {
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta({ estado: 'sinCoordenadas' })).toMatchObject({ estado: 'SIN_COORDENADAS', lat: null, anomalias: [] });
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta({ estado: 'rarisimo' })).toMatchObject({ estado: 'SIN_COORDENADAS', anomalias: ['ESTADO_BASE_DESCONOCIDO'] });
    [null, undefined, 'x', 5].forEach((v) => expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(v)).toMatchObject({ estado: 'SIN_COORDENADAS', anomalias: ['BASE_AUSENTE'] }));
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta({ estado: 'constructor' })).toMatchObject({ anomalias: ['ESTADO_BASE_DESCONOCIDO'] });
  });

  test('unica / corroborada con coordenada invalida (null, fuera de Mendoza, texto): nunca se inventa un punto', () => {
    [{ lat: null, lon: null }, { lat: 5, lon: 5 }, { lat: '-33', lon: '-68' }, { lat: undefined, lon: undefined }].forEach((c) => {
      expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta(c))).toMatchObject({ estado: 'SIN_COORDENADAS', lat: null, lon: null, anomalias: ['BASE_SIN_COORDENADA_VALIDA'] });
    });
  });

  test('unica con fuente desconocida: sigue siendo punto operativo, con anomalia FUENTE_BASE_DESCONOCIDA', () => {
    expect(U.ubicacionOperativaLogic_baseDeUbicacionResuelta(resuelta({ fuente: 'otra' }))).toMatchObject({ estado: 'DISPONIBLE', fuente: null, anomalias: ['FUENTE_BASE_DESCONOCIDA'] });
  });
});

describe('punto operativo COMPLETO: resolver (R1 / R2 / R0)', () => {
  const resuelta = (extra) => Object.assign({ estado: 'unica', fuente: 'reportePozos', lat: IRR.lat, lon: IRR.lon }, extra || {});
  const vigente = (extra) => Object.assign({
    correccionId: '618615f2-3f2b-4a8d-ae3c-1ebd49041190', wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, metodo: 'PUNTO_EN_MAPA', estado: 'VALIDADA',
    timestamp: '2026-10-12 14:05:00', irrigacion: { lat: IRR.lat, lon: IRR.lon, estado: 'unica' }, resolucion: { evento: 'VALIDADA', nombre: 'Federico', timestamp: '2026-10-12 14:06:00', motivo: 'ok' },
    nombrePropone: 'Ana', observacion: 'obs', propia: true
  }, extra || {});
  const resolver = (e) => U.ubicacionOperativaLogic_resolver(Object.assign({ wellId: '14-0001' }, e));

  test('R2: sin validada y base DISPONIBLE -> el punto del padron (fuente IRR_REPORTE, estado DISPONIBLE, confianza C)', () => {
    const r = resolver({ ubicacionResuelta: resuelta() });
    expect(r).toMatchObject({ wellId: '14-0001', lat: IRR.lat, lon: IRR.lon, fuente: 'IRR_REPORTE', estado: 'DISPONIBLE', confianza: 'C', operativo: true, regla: 'R2_BASE', override: null, etiqueta: 'Ubicación disponible', version: 1 });
  });

  test('R2: base COINCIDENTE -> fuente IRR_VARIAS, confianza B', () => {
    const r = resolver({ ubicacionResuelta: resuelta({ estado: 'corroborada', distanciaCorroboracion: 2 }) });
    expect(r).toMatchObject({ fuente: 'IRR_VARIAS', estado: 'COINCIDENTE', confianza: 'B', operativo: true, regla: 'R2_BASE' });
  });

  test('R1: validada vigente sobre base DISPONIBLE -> lat/lon validada, CAMPO_CORREGIDA / VALIDADA_CAMPO / A, y la base queda INTACTA', () => {
    const r = resolver({ ubicacionResuelta: resuelta(), vigente: vigente() });
    expect(r).toMatchObject({ lat: CAMPO.lat, lon: CAMPO.lon, fuente: 'CAMPO_CORREGIDA', estado: 'VALIDADA_CAMPO', confianza: 'A', operativo: true, regla: 'R1_CAMPO_VALIDADA', etiqueta: 'Validada en campo' });
    expect(r.base).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_REPORTE', lat: IRR.lat, lon: IRR.lon });
    expect(r.override).toEqual({
      lat: CAMPO.lat, lon: CAMPO.lon, correccionId: '618615f2-3f2b-4a8d-ae3c-1ebd49041190', metodo: 'PUNTO_EN_MAPA', validadaEl: '2026-10-12 14:06:00',
      distanciaBaseM: 22.2, baseCambioM: 0
    });
  });

  test('R1 sobre base COINCIDENTE: manda la validada; la base conserva su estado', () => {
    const r = resolver({ ubicacionResuelta: resuelta({ estado: 'corroborada' }), vigente: vigente() });
    expect(r).toMatchObject({ estado: 'VALIDADA_CAMPO', regla: 'R1_CAMPO_VALIDADA' });
    expect(r.base.estado).toBe('COINCIDENTE');
  });

  test.each([['dudosoLeve', 'leve'], ['revisar', 'revisar'], ['revisarGrave', 'grave']])('C. base en DISCREPANCIA (%s) + validada: manda la validada; la discrepancia NO se pierde en base', (estado, nivel) => {
    const r = resolver({ ubicacionResuelta: { estado: estado, distanciaMaxima: 300 }, vigente: vigente({ irrigacion: null }) });
    expect(r).toMatchObject({ estado: 'VALIDADA_CAMPO', confianza: 'A', operativo: true, regla: 'R1_CAMPO_VALIDADA', lat: CAMPO.lat });
    expect(r.base).toMatchObject({ estado: 'DISCREPANCIA', nivel: nivel, lat: null, lon: null, distanciaMaximaM: 300 });
    expect(r.override.distanciaBaseM).toBeNull();
    expect(r.override.baseCambioM).toBeNull();
  });

  test('B. pozo SIN coordenada de padron + validada: operativo por R1 (distancia a la base null)', () => {
    const r = resolver({ ubicacionResuelta: { estado: 'sinCoordenadas' }, vigente: vigente({ irrigacion: { lat: null, lon: null } }) });
    expect(r).toMatchObject({ operativo: true, regla: 'R1_CAMPO_VALIDADA', estado: 'VALIDADA_CAMPO' });
    expect(r.base.estado).toBe('SIN_COORDENADAS');
    expect(r.override.distanciaBaseM).toBeNull();
  });

  test('R0: base DISCREPANCIA sin validada -> sin punto operativo, estado DISCREPANCIA, confianza D (no se elige una candidata)', () => {
    const r = resolver({ ubicacionResuelta: { estado: 'revisarGrave', distanciaMaxima: 900 } });
    expect(r).toMatchObject({ lat: null, lon: null, fuente: null, estado: 'DISCREPANCIA', confianza: 'D', operativo: false, regla: 'R0_NINGUNA', etiqueta: 'Discrepancia', override: null });
  });

  test('R0: sin coordenadas y sin validada -> SIN_COORDENADAS, confianza null', () => {
    const r = resolver({ ubicacionResuelta: { estado: 'sinCoordenadas' } });
    expect(r).toMatchObject({ lat: null, lon: null, fuente: null, estado: 'SIN_COORDENADAS', confianza: null, operativo: false, regla: 'R0_NINGUNA', etiqueta: 'Sin coordenadas' });
  });

  test('E. REVERTIDA: sin vigente (el backend ya no la informa) -> vuelve a la base (R2), aunque haya una SUPERADA anterior en el historial', () => {
    const historial = [vigente({ correccionId: 'a', estado: 'REVERTIDA' }), vigente({ correccionId: 'b', estado: 'SUPERADA', timestamp: '2026-09-01 10:00:00' })];
    const r = resolver({ ubicacionResuelta: resuelta(), correcciones: historial });
    expect(r).toMatchObject({ regla: 'R2_BASE', estado: 'DISPONIBLE', lat: IRR.lat, override: null });
  });

  test('histÓrica SUPERADA / RECHAZADA / PROPUESTA nunca reemplaza la ubicacion base', () => {
    ['SUPERADA', 'RECHAZADA', 'PROPUESTA', 'INCONSISTENTE', 'REVERTIDA'].forEach((estado) => {
      const r = resolver({ ubicacionResuelta: resuelta(), vigente: vigente({ estado: estado }) });
      expect(r).toMatchObject({ regla: 'R2_BASE', lat: IRR.lat });
      expect(r.anomalias).toContain('OVERRIDE_NO_VALIDADA');
    });
  });

  test('D. varias correcciones historicas y UNA vigente: se usa la vigente de la lista', () => {
    const lista = [
      vigente({ correccionId: 'v1', estado: 'SUPERADA', lat: -33.1, lon: -69.1, timestamp: '2026-09-01 10:00:00' }),
      vigente({ correccionId: 'v2', estado: 'VALIDADA', lat: -33.2, lon: -69.2, timestamp: '2026-10-01 10:00:00', resolucion: null }),
      vigente({ correccionId: 'v3', estado: 'RECHAZADA', lat: -33.3, lon: -69.3, timestamp: '2026-10-05 10:00:00' }),
      vigente({ correccionId: 'v4', estado: 'PROPUESTA', lat: -33.4, lon: -69.4, timestamp: '2026-10-06 10:00:00' })
    ];
    const r = resolver({ ubicacionResuelta: resuelta(), correcciones: lista });
    expect(r).toMatchObject({ regla: 'R1_CAMPO_VALIDADA', lat: -33.2, lon: -69.2 });
    expect(r.override.correccionId).toBe('v2');
    expect(r.override.validadaEl).toBe('2026-10-01 10:00:00');
  });

  test('vigente explicito gana sobre la lista; un delta ({wellId, lat, lon, vts}) tambien sirve como override', () => {
    const r = resolver({ ubicacionResuelta: resuelta(), vigente: delta('14-0001'), correcciones: [vigente({ lat: -33.2, lon: -69.2 })] });
    expect(r).toMatchObject({ regla: 'R1_CAMPO_VALIDADA', lat: CAMPO.lat });
    expect(r.override).toMatchObject({ correccionId: null, metodo: null, validadaEl: '2026-10-12T14:05:00', distanciaBaseM: 22.2, baseCambioM: null });
  });

  test('override invalido (otro pozo, coordenada mala, no objeto): se IGNORA con anomalia y manda la base; nunca rompe', () => {
    const casos = [
      [vigente({ wellId: '14-0002' }), 'OVERRIDE_OTRO_POZO'], [vigente({ lat: 'x' }), 'OVERRIDE_COORDENADA_INVALIDA'], [vigente({ lat: 5, lon: 5 }), 'OVERRIDE_COORDENADA_INVALIDA'], ['x', 'OVERRIDE_NO_ES_OBJETO'], [5, 'OVERRIDE_NO_ES_OBJETO']
    ];
    casos.forEach(([v, anomalia]) => {
      const r = resolver({ ubicacionResuelta: resuelta(), vigente: v });
      expect(r).toMatchObject({ regla: 'R2_BASE', lat: IRR.lat });
      expect(r.anomalias).toContain(anomalia);
    });
  });

  test('baseCambioM: metros entre la base que vio la correccion y la base de HOY (informativo; la validada igual manda)', () => {
    const r = resolver({ ubicacionResuelta: resuelta({ lat: IRR.lat + 0.001 }), vigente: vigente() });
    expect(r.regla).toBe('R1_CAMPO_VALIDADA');
    expect(r.override.baseCambioM).toBeCloseTo(111.2, 0);
  });

  test('el override NO copia autor, observacion, email ni motivo (lista cerrada de campos), ni el historial', () => {
    const r = resolver({ ubicacionResuelta: resuelta(), vigente: vigente({ emailPropone: 'a@x.com', nombrePropone: 'Ana', observacion: 'secreto', historial: [{}] }), correcciones: [vigente()] });
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/Ana|Federico|a@x\.com|secreto|obs|"motivo"|historial|propia/);
    expect(Object.keys(r.override).sort()).toEqual(['baseCambioM', 'correccionId', 'distanciaBaseM', 'lat', 'lon', 'metodo', 'validadaEl']);
  });

  test('metodo desconocido y correccionId raro no pasan (null)', () => {
    const r = resolver({ ubicacionResuelta: resuelta(), vigente: vigente({ metodo: 'HACK', correccionId: 'x'.repeat(65) }) });
    expect(r.override.metodo).toBeNull();
    expect(r.override.correccionId).toBeNull();
    ['COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2', 'GPS_ACTUAL'].forEach((m) => {
      expect(resolver({ ubicacionResuelta: resuelta(), vigente: vigente({ metodo: m }) }).override.metodo).toBe(m);
    });
  });

  test('no muta la entrada (congelada en profundidad)', () => {
    const entrada = congelar({ wellId: '14-0001', ubicacionResuelta: resuelta(), vigente: vigente(), correcciones: [vigente({ correccionId: 'z', estado: 'SUPERADA' })] });
    expect(() => U.ubicacionOperativaLogic_resolver(entrada)).not.toThrow();
  });

  test('el resultado SIEMPRE trae los tres campos separados, evidencias reservadas (vacias), anomalias y version', () => {
    [resolver({ ubicacionResuelta: resuelta() }), resolver({ ubicacionResuelta: resuelta(), vigente: vigente() }), resolver({ ubicacionResuelta: { estado: 'sinCoordenadas' } })].forEach((r) => {
      ['fuente', 'estado', 'confianza'].forEach((k) => expect(Object.prototype.hasOwnProperty.call(r, k)).toBe(true));
      expect(r.evidencias).toEqual([]);
      expect(Array.isArray(r.anomalias)).toBe(true);
      expect(r.version).toBe(1);
      expect(Object.values(U.UOP_FUENTES).concat([null])).toContain(r.fuente);
      expect(Object.values(U.UOP_ESTADOS)).toContain(r.estado);
      expect(['A', 'B', 'C', 'D', null]).toContain(r.confianza);
    });
  });

  test('no integra NE, Relevamiento, Confirmada en campo ni candidatos satelitales: ninguna fuente ni estado los menciona', () => {
    const todo = JSON.stringify([U.UOP_FUENTES, U.UOP_ESTADOS, U.UOP_REGLAS]);
    expect(todo).not.toMatch(/NIVEL|NE_|RELEVAMIENTO|SATELIT|CONFIRMADA/);
  });

  test('wellId invalido o entrada rara: sin override, sin romper, con anomalia', () => {
    expect(U.ubicacionOperativaLogic_resolver({ wellId: 'zz', ubicacionResuelta: resuelta(), vigente: vigente({ wellId: 'zz' }) })).toMatchObject({ wellId: 'zz', regla: 'R2_BASE', override: null, anomalias: ['WELL_ID_INVALIDO'] });
    [undefined, null, 5, 'x', []].forEach((e) => {
      expect(U.ubicacionOperativaLogic_resolver(e)).toMatchObject({ wellId: null, operativo: false, estado: 'SIN_COORDENADAS', confianza: null, regla: 'R0_NINGUNA' });
    });
  });

  test('coherencia: el punto del dataset (overlay) y el contrato completo dicen lo mismo (lat, lon, estado, fuente, confianza)', () => {
    const completo = resolver({ ubicacionResuelta: resuelta(), vigente: vigente() });
    const hot = U.ubicacionOperativaLogic_resolverPuntoDataset(pozo('14-0001'), delta('14-0001'));
    const info = U.ubicacionOperativaLogic_infoDePuntoDataset(hot);
    expect([hot.lat, hot.lon]).toEqual([completo.lat, completo.lon]);
    expect(info).toMatchObject({ estado: completo.estado, fuente: completo.fuente, confianza: completo.confianza });
    const sinOverride = U.ubicacionOperativaLogic_infoDePuntoDataset(pozo('14-0001'));
    const completoBase = resolver({ ubicacionResuelta: resuelta() });
    expect(sinOverride).toMatchObject({ estado: completoBase.estado, confianza: completoBase.confianza });
  });
});

describe('rendimiento y datos reales', () => {
  function grande(n) {
    const base = [];
    for (let i = 0; i < n; i += 1) {
      base.push(pozo(String(1 + (i % 19)).padStart(2, '0') + '-' + String(i + 1).padStart(4, '0').slice(-4), { lat: -33 - (i % 1000) * 0.001, lon: -68 - Math.floor(i / 1000) * 0.01 }));
    }
    return base;
  }
  const deltasDe = (base, n) => { const d = []; for (let i = 0; i < n; i += 1) { const p = base[(i * 7919) % base.length]; d.push(delta(p.wellId, { lat: p.lat + 0.0005, lon: p.lon + 0.0005 })); } return d; };

  test.each([[13804, 1000], [13804, 5000], [24180, 5000]])('%i puntos con %i correcciones: el overlay termina muy por debajo de un segundo y deja los puntos sin override intactos', (n, k) => {
    const base = grande(n);
    const deltas = deltasDe(base, k);
    const t0 = Date.now();
    const r = U.ubicacionOperativaLogic_aplicarOverlay(base, deltas);
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(1000);                                  // en la practica son pocos milisegundos; el margen es para que no falle bajo carga
    const movidos = new Set(deltas.map((d) => d.wellId));
    expect(r.pozos).toHaveLength(base.length);
    expect(r.resumen.aplicadas).toBe(movidos.size);
    const sinCambio = r.pozos.filter((p, i) => p === base[i]).length;
    expect(sinCambio).toBe(base.length - movidos.size);
  });

  const rutaReal = path.join(__dirname, '..', 'scripts', 'out', 'mapa', 'pozos.json');
  const real = fs.existsSync(rutaReal) ? JSON.parse(fs.readFileSync(rutaReal, 'utf8')) : null;
  (real ? test : test.skip)('con el pozos.json REAL (si existe en esta maquina): un overlay no cambia la cantidad ni toca los demas puntos', () => {
    const deltas = [delta(real[0].wellId, { lat: real[0].lat + 0.001, lon: real[0].lon }), delta('19-9999', { lat: -34.5, lon: -68.0 })];
    const r = U.ubicacionOperativaLogic_aplicarOverlay(real, deltas);
    expect(r.pozos).toHaveLength(real.length + 1);
    expect(r.pozos[0].estado).toBe('V');
    expect(r.pozos[0].cuenca).toBe(real[0].cuenca);
    expect(r.pozos[1]).toBe(real[1]);
    expect(r.pozos[real.length].wellId).toBe('19-9999');
  });
});

describe('aislamiento: solo lo consumen mapaDataset_obtener (overlay de los mapas) y la logica de "Ubicaciones conocidas" (ficha del pozo)', () => {
  const raiz = path.join(__dirname, '..');
  const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');

  test('solo js/mapaDataset.js y js/ubicacionesConocidasLogic.js lo usan (ni mapa, Cerca Mio, seleccion ni reemplazos); se carga en index.html y se precachea; el backend no lo referencia', () => {
    expect(leer('index.html')).toMatch(/<script src="js\/ubicacionOperativaLogic\.js"><\/script>/);
    expect(leer('sw.js')).toContain("'./js/ubicacionOperativaLogic.js'");
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'ubicacionOperativaLogic.js').forEach((f) => {
      if (f === 'mapaDataset.js') {
        expect(leer('js', f)).toMatch(/ubicacionOperativaLogic_aplicarOverlay/);
      } else if (f === 'ubicacionesConocidasLogic.js') {
        expect(leer('js', f)).toMatch(/ubicacionOperativaLogic_resolver/);
      } else {
        expect(leer('js', f)).not.toMatch(/ubicacionOperativa/);
      }
    });
    fs.readdirSync(path.join(raiz, 'backend', 'src')).forEach((f) => expect(leer('backend', 'src', f)).not.toMatch(/ubicacionOperativa/));
  });

  test('es puro: sin DOM, red, almacenamiento ni Leaflet', () => {
    const codigo = leer('js', 'ubicacionOperativaLogic.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(codigo).not.toMatch(/document\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\bL\.|navigator\./);
    expect(codigo).not.toMatch(/\bapi[A-Z]\w+\(|callBackend/);
  });
});
