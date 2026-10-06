const R = require('./reemplazoResumenLogic');
const { mapaLogic_filtrarPorCampoMultipleNE, mapaLogic_filtrarPorRangoProfundidad, mapaLogic_toggleFiltroMultiple } = require('./mapaLogic');
const { seleccionLogic_filtrarPorWellIds } = require('./seleccionLogic');

const pozo = (wellId, extra) => Object.assign({ wellId, lat: -32.8, lon: -68.8, estado: 'D', cuenca: 'Río Mendoza', profundidad: 100 }, extra || {});
const RESUMEN = { '01-0001': 'APTO', '01-0002': 'NO_APTO', '01-0003': 'DUDOSO', '01-0004': 'APTO' };
const PUNTOS = ['01-0001', '01-0002', '01-0003', '01-0004', '01-0005', '01-0006'].map((w) => pozo(w));

describe('estado de un pozo', () => {
  test('evaluado: su estado; ausente: SIN_EVALUAR', () => {
    expect(R.reemplazoResumenLogic_estadoDe(RESUMEN, '01-0001')).toBe('APTO');
    expect(R.reemplazoResumenLogic_estadoDe(RESUMEN, '01-0003')).toBe('DUDOSO');
    expect(R.reemplazoResumenLogic_estadoDe(RESUMEN, '99-9999')).toBe('SIN_EVALUAR');
  });
  test('sin resumen disponible (sin permiso / no cargado / fallo): null, NUNCA "Sin evaluar"', () => {
    expect(R.reemplazoResumenLogic_estadoDe(null, '01-0001')).toBeNull();
    expect(R.reemplazoResumenLogic_estadoDe(undefined, '01-0001')).toBeNull();
  });
  test('un valor raro en el resumen se trata como SIN_EVALUAR', () => {
    expect(R.reemplazoResumenLogic_estadoDe({ '01-0001': 'basura' }, '01-0001')).toBe('SIN_EVALUAR');
  });
  test('etiquetas', () => {
    expect(R.reemplazoResumenLogic_etiqueta('APTO')).toBe('Apto');
    expect(R.reemplazoResumenLogic_etiqueta('DUDOSO')).toBe('Dudoso');
    expect(R.reemplazoResumenLogic_etiqueta('NO_APTO')).toBe('No apto');
    expect(R.reemplazoResumenLogic_etiqueta('SIN_EVALUAR')).toBe('Sin evaluar');
    expect(R.reemplazoResumenLogic_etiqueta(undefined)).toBe('Sin evaluar');
  });
});

describe('sanitizar el payload de red', () => {
  test('conserva pares validos', () => {
    expect(R.reemplazoResumenLogic_sanitizar(RESUMEN)).toEqual(RESUMEN);
  });
  test('descarta wellId invalidos, estados desconocidos y SIN_EVALUAR explicito', () => {
    expect(R.reemplazoResumenLogic_sanitizar({ '01-0001': 'APTO', 'x': 'APTO', '01-0002': 'SIN_EVALUAR', '01-0003': 'OTRO', '01-0004': null })).toEqual({ '01-0001': 'APTO' });
  });
  test('no objeto: vacio', () => {
    expect(R.reemplazoResumenLogic_sanitizar(null)).toEqual({});
    expect(R.reemplazoResumenLogic_sanitizar([1, 2])).toEqual({});
    expect(R.reemplazoResumenLogic_sanitizar('x')).toEqual({});
  });
});

describe('filtro por aptitud', () => {
  const ids = (l) => l.map((p) => p.wellId);
  test('sin activos (Todos): no filtra', () => {
    expect(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, {})).toBe(PUNTOS);
  });
  test('filtro simple', () => {
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { APTO: true }))).toEqual(['01-0001', '01-0004']);
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { NO_APTO: true }))).toEqual(['01-0002']);
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { DUDOSO: true }))).toEqual(['01-0003']);
  });
  test('Sin evaluar: los que no estan en el resumen', () => {
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { SIN_EVALUAR: true }))).toEqual(['01-0005', '01-0006']);
  });
  test('multiseleccion = OR dentro del grupo', () => {
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { APTO: true, DUDOSO: true }))).toEqual(['01-0001', '01-0003', '01-0004']);
    expect(ids(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { NO_APTO: true, SIN_EVALUAR: true }))).toEqual(['01-0002', '01-0005', '01-0006']);
  });
  test('los 4 estados juntos = todos los pozos', () => {
    expect(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { APTO: true, DUDOSO: true, NO_APTO: true, SIN_EVALUAR: true })).toHaveLength(PUNTOS.length);
  });
  test('un activo en false no cuenta como activo', () => {
    expect(R.reemplazoResumenLogic_filtrar(PUNTOS, RESUMEN, { APTO: false })).toBe(PUNTOS);
  });
  test('sin resumen disponible: no filtra (nunca oculta pozos por no saber su estado)', () => {
    expect(R.reemplazoResumenLogic_filtrar(PUNTOS, null, { APTO: true })).toBe(PUNTOS);
  });
  test('combinacion AND con Cuenca', () => {
    const puntos = [pozo('01-0001', { cuenca: 'Río Mendoza' }), pozo('01-0002', { cuenca: 'Río Mendoza' }), pozo('01-0004', { cuenca: 'Río Atuel' })];
    const porCuenca = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { 'Río Mendoza': true });
    expect(ids(R.reemplazoResumenLogic_filtrar(porCuenca, RESUMEN, { APTO: true }))).toEqual(['01-0001']); // 01-0004 es Apto pero de otra cuenca
  });
  test('combinacion AND con Profundidad', () => {
    const puntos = [pozo('01-0001', { profundidad: 50 }), pozo('01-0004', { profundidad: 200 }), pozo('01-0002', { profundidad: 200 })];
    const porProf = mapaLogic_filtrarPorRangoProfundidad(puntos, 100, null, 'profundidad');
    expect(ids(R.reemplazoResumenLogic_filtrar(porProf, RESUMEN, { APTO: true }))).toEqual(['01-0004']);
  });
  test('seleccion geografica: el filtro actua sobre el universo de la seleccion', () => {
    const seleccion = new Set(['01-0001', '01-0002', '01-0005']);
    const enSeleccion = seleccionLogic_filtrarPorWellIds(PUNTOS, seleccion);
    expect(ids(R.reemplazoResumenLogic_filtrar(enSeleccion, RESUMEN, { APTO: true }))).toEqual(['01-0001']);
    expect(ids(R.reemplazoResumenLogic_filtrar(enSeleccion, RESUMEN, { SIN_EVALUAR: true }))).toEqual(['01-0005']);
  });
  test('toggle del grupo con la misma semantica que el resto (Todos limpia)', () => {
    let a = mapaLogic_toggleFiltroMultiple({}, 'APTO');
    a = mapaLogic_toggleFiltroMultiple(a, 'DUDOSO');
    expect(a).toEqual({ APTO: true, DUDOSO: true });
    expect(mapaLogic_toggleFiltroMultiple(a, 'todos')).toEqual({});
    expect(mapaLogic_toggleFiltroMultiple(a, 'APTO')).toEqual({ DUDOSO: true });
  });
});

describe('conteos contextuales', () => {
  test('universo completo: suman el total', () => {
    const c = R.reemplazoResumenLogic_contar(PUNTOS, RESUMEN);
    expect(c).toEqual({ APTO: 2, DUDOSO: 1, NO_APTO: 1, SIN_EVALUAR: 2 });
    expect(c.APTO + c.DUDOSO + c.NO_APTO + c.SIN_EVALUAR).toBe(PUNTOS.length);
  });
  test('ejemplo del pedido: seleccion de 40 -> Apto 12, Dudoso 3, No apto 7, Sin evaluar 18 = 40', () => {
    const resumen = {};
    const seleccion = [];
    for (let i = 1; i <= 40; i++) {
      const w = '04-' + String(i).padStart(4, '0');
      seleccion.push(pozo(w));
      if (i <= 12) { resumen[w] = 'APTO'; } else if (i <= 15) { resumen[w] = 'DUDOSO'; } else if (i <= 22) { resumen[w] = 'NO_APTO'; }
    }
    // evaluados fuera de la seleccion no cuentan
    resumen['05-0001'] = 'APTO';
    resumen['05-0002'] = 'NO_APTO';
    const c = R.reemplazoResumenLogic_contar(seleccion, resumen);
    expect(c).toEqual({ APTO: 12, DUDOSO: 3, NO_APTO: 7, SIN_EVALUAR: 18 });
    expect(c.APTO + c.DUDOSO + c.NO_APTO + c.SIN_EVALUAR).toBe(40);
  });
  test('universo vacio', () => {
    expect(R.reemplazoResumenLogic_contar([], RESUMEN)).toEqual({ APTO: 0, DUDOSO: 0, NO_APTO: 0, SIN_EVALUAR: 0 });
  });
});

describe('actualizacion inmediata despues de evaluar (sin refetch)', () => {
  test('un pozo sin evaluar pasa a NO_APTO', () => {
    const nuevo = R.reemplazoResumenLogic_actualizar(RESUMEN, '01-0005', 'NO_APTO');
    expect(R.reemplazoResumenLogic_estadoDe(nuevo, '01-0005')).toBe('NO_APTO');
    expect(R.reemplazoResumenLogic_contar(PUNTOS, nuevo)).toEqual({ APTO: 2, DUDOSO: 1, NO_APTO: 2, SIN_EVALUAR: 1 });
  });
  test('un pozo evaluado cambia de estado (la ultima gana)', () => {
    expect(R.reemplazoResumenLogic_actualizar(RESUMEN, '01-0001', 'DUDOSO')['01-0001']).toBe('DUDOSO');
  });
  test('no muta el resumen original', () => {
    const copia = JSON.parse(JSON.stringify(RESUMEN));
    R.reemplazoResumenLogic_actualizar(RESUMEN, '01-0005', 'APTO');
    expect(RESUMEN).toEqual(copia);
  });
  test('SIN_EVALUAR o invalido lo quita; sin resumen no hace nada', () => {
    expect('01-0001' in R.reemplazoResumenLogic_actualizar(RESUMEN, '01-0001', 'SIN_EVALUAR')).toBe(false);
    expect(R.reemplazoResumenLogic_actualizar(null, '01-0001', 'APTO')).toBeNull();
  });
  test('el filtro refleja el cambio al instante', () => {
    const nuevo = R.reemplazoResumenLogic_actualizar(RESUMEN, '01-0005', 'APTO');
    expect(R.reemplazoResumenLogic_filtrar(PUNTOS, nuevo, { APTO: true }).map((p) => p.wellId)).toEqual(['01-0001', '01-0004', '01-0005']);
  });
});

describe('reemplazoResumenLogic_pozosParaAcciones (Cerca Mio: las acciones operan sobre lo que se ve)', () => {
  // 14 pozos dentro del radio, ordenados por distancia; 4 son Apto
  const radio = [];
  const resumenRadio = {};
  for (let i = 1; i <= 14; i++) {
    const w = '04-' + String(i).padStart(4, '0');
    radio.push({ wellId: w, distanciaMetros: i * 100 });
    if (i % 3 === 1 && i <= 10) { resumenRadio[w] = 'APTO'; }      // 1,4,7,10 -> 4 aptos
    else if (i === 2 || i === 5) { resumenRadio[w] = 'NO_APTO'; }
    else if (i === 3) { resumenRadio[w] = 'DUDOSO'; }
  }

  test('sin filtros: todos los pozos del radio (14)', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, resumenRadio, {});
    expect(a.wellIds).toHaveLength(14);
    expect(a.filtrado).toBe(false);
    expect(a.vacio).toBe(false);
    expect(a.total).toBe(14);
  });

  test('14 -> filtro Apto -> 4: "Ver todos en el mapa" y "Usar estos pozos" usan esos 4 (en orden de distancia)', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, resumenRadio, { APTO: true });
    expect(a.wellIds).toEqual(['04-0001', '04-0004', '04-0007', '04-0010']);
    expect(a.filtrado).toBe(true);
    expect(a.total).toBe(14);
  });

  test('varios filtros (OR): Apto + No apto', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, resumenRadio, { APTO: true, NO_APTO: true });
    expect(a.wellIds).toHaveLength(6);
  });

  test('Sin evaluar: los del radio que no estan en el resumen', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, resumenRadio, { SIN_EVALUAR: true });
    expect(a.wellIds).toHaveLength(14 - Object.keys(resumenRadio).length);
  });

  test('un filtro que deja 0 pozos: vacio=true (las acciones se deshabilitan; nunca una seleccion vacia)', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, {}, { APTO: true });
    expect(a.wellIds).toEqual([]);
    expect(a.vacio).toBe(true);
    expect(a.filtrado).toBe(true);
  });

  test('radio sin pozos y sin filtros: vacio tambien (no hay nada que usar)', () => {
    expect(R.reemplazoResumenLogic_pozosParaAcciones([], resumenRadio, {}).vacio).toBe(true);
    expect(R.reemplazoResumenLogic_pozosParaAcciones(undefined, null, {}).wellIds).toEqual([]);
  });

  test('sin resumen disponible (sin reemplazo=SI) los filtros no existen: todos los pozos', () => {
    const a = R.reemplazoResumenLogic_pozosParaAcciones(radio, null, { APTO: true });
    expect(a.wellIds).toHaveLength(14);
    expect(a.filtrado).toBe(false);
  });

  test('no se limita a 30: con 45 pozos que cumplen, las acciones usan los 45 (el tope de 30 es solo de la lista visible)', () => {
    const muchos = [];
    const rs = {};
    for (let i = 1; i <= 60; i++) {
      const w = '05-' + String(i).padStart(4, '0');
      muchos.push({ wellId: w });
      if (i <= 45) { rs[w] = 'APTO'; }
    }
    expect(R.reemplazoResumenLogic_pozosParaAcciones(muchos, rs, { APTO: true }).wellIds).toHaveLength(45);
  });

  test('despues de evaluar un pozo, el subconjunto refleja el estado nuevo al instante', () => {
    const nuevo = R.reemplazoResumenLogic_actualizar(resumenRadio, '04-0006', 'APTO');
    expect(R.reemplazoResumenLogic_pozosParaAcciones(radio, nuevo, { APTO: true }).wellIds).toHaveLength(5);
  });
});
