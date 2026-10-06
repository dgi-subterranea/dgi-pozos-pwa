// En el navegador estas funciones son globales (scripts planos)
Object.assign(global, require('./cercaMioLogic'));
Object.assign(global, require('./reemplazoResumenLogic'));
const L = require('./buscarReemplazoLogic');

// Centro de referencia (Mendoza). Con el radio terrestre de haversine
// (6.371 km) 1 grado de latitud mide 111.194,93 m: asi los metros del test son exactos.
const BASE = { lat: -33.0, lon: -68.8 };
const METROS_POR_GRADO = 6371000 * Math.PI / 180;
const enLat = (metros) => BASE.lat + metros / METROS_POR_GRADO; // al norte

function pozo(wellId, metrosAlNorte, extra) {
  return Object.assign({
    wellId,
    lat: enLat(metrosAlNorte),
    lon: BASE.lon,
    estado: 'D',
    cuenca: 'Río Mendoza',
    profundidad: 100,
    tramosFiltrantes: [{ desde: 80, hasta: 100 }],
    surgencia: 'Profundo'
  }, extra || {});
}

function puntoNE(extra) {
  return Object.assign({
    monitoringId: '04-0263',
    wellId: '04-0263',
    lat: BASE.lat,
    lon: BASE.lon,
    nombreOriginal: null,
    cuenca: 'MI',
    zona: 'Libre',
    estadoMonitoreo: 'ACTIVO',
    tieneMedicion2026: true,
    profundidad: 100
  }, extra || {});
}

function referencia(extra, pozos) {
  return L.buscarReemplazoLogic_construirReferencia(puntoNE(extra), pozos || []);
}

describe('formato', () => {
  test('numeros con miles y coma decimal', () => {
    expect(L.buscarReemplazoLogic_formatearNumero(120)).toBe('120');
    expect(L.buscarReemplazoLogic_formatearNumero(1234.5)).toBe('1.234,5');
    expect(L.buscarReemplazoLogic_formatearNumero(29600)).toBe('29.600');
    expect(L.buscarReemplazoLogic_formatearNumero(12.04)).toBe('12');
  });
  test('diferencia con signo explicito', () => {
    expect(L.buscarReemplazoLogic_formatearDiferencia(12)).toBe('+12 m');
    expect(L.buscarReemplazoLogic_formatearDiferencia(-8.5)).toBe('-8,5 m');
    expect(L.buscarReemplazoLogic_formatearDiferencia(0)).toBe('0 m');
  });
});

describe('distancia con coma decimal', () => {
  test('metros, kilometros con una coma y sin decimal redondo', () => {
    expect(L.buscarReemplazoLogic_formatearDistancia(820.4)).toBe('820 m');
    expect(L.buscarReemplazoLogic_formatearDistancia(999.4)).toBe('999 m');
    expect(L.buscarReemplazoLogic_formatearDistancia(1000)).toBe('1 km');
    expect(L.buscarReemplazoLogic_formatearDistancia(1900)).toBe('1,9 km');
    expect(L.buscarReemplazoLogic_formatearDistancia(1949)).toBe('1,9 km');
    expect(L.buscarReemplazoLogic_formatearDistancia(5000)).toBe('5 km');
    expect(L.buscarReemplazoLogic_formatearDistancia(12340)).toBe('12,3 km');
  });
  test('la advertencia usa ese formato', () => {
    const ref = L.buscarReemplazoLogic_construirReferencia({ monitoringId: 'X', wellId: '01-0001', lat: BASE.lat, lon: BASE.lon, profundidad: null }, [pozo('01-0001', 1900)]);
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).toMatch(/1,9 km/);
  });
});

describe('profundidad: nunca se infiere', () => {
  test('solo numeros positivos y no atipicos son comparables', () => {
    expect(L.buscarReemplazoLogic_profundidadValida(120)).toBe(120);
    expect(L.buscarReemplazoLogic_profundidadValida(null)).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadValida(undefined)).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadValida(0)).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadValida(-5)).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadValida('120')).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadValida(NaN)).toBeNull();
  });
  test('> 1000 m es atipica: se muestra pero no se compara', () => {
    expect(L.buscarReemplazoLogic_profundidadValida(1000)).toBe(1000);
    expect(L.buscarReemplazoLogic_profundidadValida(29600)).toBeNull();
    expect(L.buscarReemplazoLogic_profundidadAtipica(29600)).toBe(true);
    expect(L.buscarReemplazoLogic_profundidadAtipica(1000)).toBe(false);
    expect(L.buscarReemplazoLogic_profundidadAtipica(null)).toBe(false);
  });
});

describe('referencia: coordenada propia del punto NE', () => {
  test('usa lat/lon del punto NE y sus datos', () => {
    const ref = referencia();
    expect(ref).toMatchObject({ monitoringId: '04-0263', wellId: '04-0263', lat: BASE.lat, lon: BASE.lon, profundidad: 100, profundidadValida: 100, esEspecial: false, estadoMonitoreo: 'ACTIVO' });
  });
  test('punto especial: sin wellId, monitoringId numerico como string', () => {
    const ref = referencia({ monitoringId: 7, wellId: null, profundidad: null, nombreOriginal: 'Pozo del club' });
    expect(ref.monitoringId).toBe('7');
    expect(ref.wellId).toBeNull();
    expect(ref.esEspecial).toBe(true);
    expect(ref.nombre).toBe('Pozo del club');
    expect(ref.profundidadValida).toBeNull();
  });
  test('sin coordenada propia no hay referencia (no se rescata la de Provincia)', () => {
    expect(L.buscarReemplazoLogic_construirReferencia(puntoNE({ lat: null, lon: null }), [pozo('04-0263', 10)])).toBeNull();
    expect(L.buscarReemplazoLogic_construirReferencia(puntoNE({ lat: undefined }), [])).toBeNull();
    expect(L.buscarReemplazoLogic_construirReferencia(null, [])).toBeNull();
  });
  test('profundidad atipica del punto NE: sin comparacion', () => {
    const ref = referencia({ profundidad: 29600 });
    expect(ref.profundidadAtipica).toBe(true);
    expect(ref.profundidadValida).toBeNull();
  });
  test('buscarPuntoNE compara por string', () => {
    const puntos = [puntoNE({ monitoringId: '7', wellId: null }), puntoNE()];
    expect(L.buscarReemplazoLogic_buscarPuntoNE(puntos, 7).monitoringId).toBe('7');
    expect(L.buscarReemplazoLogic_buscarPuntoNE(puntos, '04-0263').wellId).toBe('04-0263');
    expect(L.buscarReemplazoLogic_buscarPuntoNE(puntos, '99')).toBeNull();
    expect(L.buscarReemplazoLogic_buscarPuntoNE(null, '7')).toBeNull();
  });
});

describe('advertencia de coordenada discrepante (no bloqueante)', () => {
  test('>= 500 m: avisa y sigue usando la coordenada del punto NE', () => {
    const ref = referencia({}, [pozo('04-0263', 800)]);
    expect(ref.coordenadaProvincia.discrepante).toBe(true);
    expect(ref.lat).toBe(BASE.lat);
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).toMatch(/800 m/);
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(ref)).toMatch(/coordenada propia del punto NE/);
  });
  test('justo en el umbral (500 m) ya avisa; 499 m no', () => {
    expect(referencia({}, [pozo('04-0263', 500.5)]).coordenadaProvincia.discrepante).toBe(true);
    expect(referencia({}, [pozo('04-0263', 450)]).coordenadaProvincia.discrepante).toBe(false);
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(referencia({}, [pozo('04-0263', 450)]))).toBeNull();
  });
  test('sin coordenada de Provincia o punto especial: no hay aviso', () => {
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(referencia({}, []))).toBeNull();
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(referencia({ wellId: null, monitoringId: '7' }, [pozo('04-0263', 900)]))).toBeNull();
    expect(L.buscarReemplazoLogic_textoAdvertenciaCoordenada(null)).toBeNull();
  });
});

describe('candidatos: radio, exclusiones y diferencia de profundidad', () => {
  const pozos = [
    pozo('01-0001', 300),
    pozo('01-0002', 900, { profundidad: 130 }),
    pozo('01-0003', 1200),              // fuera de 1 km
    pozo('04-0263', 50),                // el propio pozo de la referencia
    pozo('01-0004', 600, { profundidad: null }),
    pozo('01-0005', 700),               // pertenece a la red NE
    pozo('01-0006', 400, { profundidad: 29600 })
  ];
  const redNE = { '01-0005': true, '04-0263': true };

  test('radio exacto (circulo), ordenados por distancia', () => {
    const ref = referencia();
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 1000, { redNE });
    expect(r.map((c) => c.wellId)).toEqual(['01-0001', '01-0006', '01-0004', '01-0002']);
  });
  test('el propio pozo de la referencia nunca es candidato, ni con la red NE incluida', () => {
    const ref = referencia();
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 1000, { redNE, incluirRedNE: true });
    expect(r.map((c) => c.wellId)).not.toContain('04-0263');
    expect(r.map((c) => c.wellId)).toContain('01-0005');
    expect(r.find((c) => c.wellId === '01-0005').enRedNE).toBe(true);
  });
  test('los puntos de la red NE quedan excluidos por defecto', () => {
    const ref = referencia();
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 1000, { redNE });
    expect(r.map((c) => c.wellId)).not.toContain('01-0005');
  });
  test('punto especial (sin wellId) no excluye a ningun pozo propio', () => {
    const ref = referencia({ wellId: null, monitoringId: '7' });
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 100, { redNE: {} });
    expect(r.map((c) => c.wellId)).toEqual(['04-0263']);
  });
  test('diferencia de profundidad firmada; sin dato y atipica quedan en null', () => {
    const ref = referencia();
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 1000, { redNE });
    const por = Object.fromEntries(r.map((c) => [c.wellId, c]));
    expect(por['01-0001'].difProfundidad).toBe(0);
    expect(por['01-0002'].difProfundidad).toBe(30);
    expect(por['01-0004'].difProfundidad).toBeNull();
    expect(por['01-0006'].difProfundidad).toBeNull();
    expect(por['01-0006'].profundidadAtipica).toBe(true);
    expect(por['01-0006'].profundidad).toBe(29600);
  });
  test('punto NE sin profundidad: ninguna diferencia (nada se inventa)', () => {
    const ref = referencia({ profundidad: null });
    const r = L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 1000, { redNE });
    expect(r.every((c) => c.difProfundidad === null)).toBe(true);
  });
  test('radio mayor amplia el conjunto', () => {
    const ref = referencia();
    expect(L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 5000, { redNE }).length).toBe(5);
    expect(L.buscarReemplazoLogic_buscarCandidatos(pozos, ref, 500, { redNE }).map((c) => c.wellId)).toEqual(['01-0001', '01-0006']);
  });
  test('sin pozos o dataset vacio no falla', () => {
    expect(L.buscarReemplazoLogic_buscarCandidatos([], referencia(), 1000, {})).toEqual([]);
    expect(L.buscarReemplazoLogic_buscarCandidatos(null, referencia(), 1000)).toEqual([]);
  });
  test('wellIdsRedNE arma el set desde los puntos NE', () => {
    expect(L.buscarReemplazoLogic_wellIdsRedNE([puntoNE(), puntoNE({ wellId: null, monitoringId: '7' })])).toEqual({ '04-0263': true });
    expect(L.buscarReemplazoLogic_wellIdsRedNE(null)).toEqual({});
  });
  test('wellIdsRedNE incluye los miembros SIN coordenada propia (union con los puntos dibujables)', () => {
    const set = L.buscarReemplazoLogic_wellIdsRedNE([puntoNE()], ['06-1902', '04-0577', '', null, 12]);
    expect(set).toEqual({ '04-0263': true, '06-1902': true, '04-0577': true });
    expect(L.buscarReemplazoLogic_wellIdsRedNE([], undefined)).toEqual({});
  });
  test('un miembro de la red sin coordenada propia queda excluido por defecto y entra con el interruptor', () => {
    const ref = referencia();
    const redNE = L.buscarReemplazoLogic_wellIdsRedNE([puntoNE()], ['01-0007']);   // 01-0007 no esta dibujado en el mapa NE
    const sinCoord = [pozo('01-0007', 300), pozo('01-0008', 400)];
    expect(L.buscarReemplazoLogic_buscarCandidatos(sinCoord, ref, 1000, { redNE }).map((c) => c.wellId)).toEqual(['01-0008']);
    const con = L.buscarReemplazoLogic_buscarCandidatos(sinCoord, ref, 1000, { redNE, incluirRedNE: true });
    expect(con.map((c) => c.wellId)).toEqual(['01-0007', '01-0008']);
    expect(con[0].enRedNE).toBe(true);
  });
  test('un punto NE sin coordenada propia no puede ser referencia aunque siga siendo miembro de la red', () => {
    expect(L.buscarReemplazoLogic_construirReferencia(puntoNE({ lat: null, lon: null }), [pozo('04-0263', 10)])).toBeNull();
    expect(L.buscarReemplazoLogic_wellIdsRedNE([], ['04-0263'])['04-0263']).toBe(true);
  });
});

describe('filtros', () => {
  const ref = referencia();
  const base = [
    pozo('01-0001', 100, { profundidad: 100, surgencia: 'Natural', cuenca: 'Río Mendoza' }),
    pozo('01-0002', 200, { profundidad: 150, surgencia: 'Profundo', cuenca: 'Río Atuel', tramosFiltrantes: [] }),
    pozo('01-0003', 300, { profundidad: null, surgencia: null, cuenca: null }),
    pozo('01-0004', 400, { profundidad: 29600, surgencia: 'SemiSurgente' }),
    pozo('01-0005', 500, { profundidad: 80, surgencia: 'Profundo' })
  ];
  const candidatos = L.buscarReemplazoLogic_buscarCandidatos(base, ref, 2000, {});
  const f = (extra) => Object.assign(L.buscarReemplazoLogic_filtrosPorDefecto(), extra);
  const ids = (lista) => lista.map((c) => c.wellId);
  const resumen = { '01-0001': 'APTO', '01-0002': 'NO_APTO', '01-0003': 'DUDOSO', '01-0005': 'NO_APTO' };

  test('sin filtros y sin resumen: todo', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f()))).toEqual(['01-0001', '01-0002', '01-0003', '01-0004', '01-0005']);
  });
  test('sin resumen (sin permiso) los interruptores de aptitud no ocultan nada', () => {
    expect(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ mostrarNoAptos: false, estados: { APTO: true } })).length).toBe(5);
  });
  test('No aptos ocultos por defecto; el interruptor los muestra', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f()))).toEqual(['01-0001', '01-0003', '01-0004']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ mostrarNoAptos: true })))).toEqual(['01-0001', '01-0002', '01-0003', '01-0004', '01-0005']);
  });
  test('Sin evaluar se muestra por defecto (es el estado implicito)', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ estados: { SIN_EVALUAR: true } })))).toEqual(['01-0004']);
  });
  test('chips de aptitud: OR; elegir "No apto" los muestra aunque el interruptor este apagado', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ estados: { APTO: true, DUDOSO: true } })))).toEqual(['01-0001', '01-0003']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ estados: { NO_APTO: true } })))).toEqual(['01-0002', '01-0005']);
  });
  test('tipo de pozo: Sin dato es una opcion mas', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ surgencias: { Profundo: true } })))).toEqual(['01-0002', '01-0005']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ surgencias: { SIN_DATO: true, Natural: true } })))).toEqual(['01-0001', '01-0003']);
  });
  test('cuenca del candidato (Provincia), con Sin dato', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ cuencas: { 'Río Atuel': true } })))).toEqual(['01-0002']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ cuencas: { SIN_DATO: true } })))).toEqual(['01-0003']);
  });
  test('rango de profundidad: sin dato y atipica NO pasan (no se infiere)', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ profDesde: 90, profHasta: 160 })))).toEqual(['01-0001', '01-0002']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ profDesde: 0 })))).toEqual(['01-0001', '01-0002', '01-0005']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ profHasta: 100 })))).toEqual(['01-0001', '01-0005']);
  });
  test('solo con profundidad / solo con tramos', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ soloConProfundidad: true })))).toEqual(['01-0001', '01-0002', '01-0005']);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, null, f({ soloConTramos: true })))).toEqual(['01-0001', '01-0003', '01-0004', '01-0005']);
  });
  test('los filtros combinan con AND entre grupos', () => {
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ surgencias: { Profundo: true }, soloConTramos: true })))).toEqual([]);
    expect(ids(L.buscarReemplazoLogic_filtrar(candidatos, resumen, f({ surgencias: { Profundo: true }, mostrarNoAptos: true, soloConTramos: true })))).toEqual(['01-0005']);
  });
  test('conteos de aptitud: universo sin los filtros de aptitud y cuantos No apto estan ocultos', () => {
    const c = L.buscarReemplazoLogic_conteosAptitud(candidatos, resumen, f());
    expect(c.conteos).toEqual({ APTO: 1, DUDOSO: 1, NO_APTO: 2, SIN_EVALUAR: 1 });
    expect(c.noAptosOcultos).toBe(2);
    expect(c.universo).toBe(5);
    expect(L.buscarReemplazoLogic_conteosAptitud(candidatos, resumen, f({ mostrarNoAptos: true })).noAptosOcultos).toBe(0);
    const conOtroFiltro = L.buscarReemplazoLogic_conteosAptitud(candidatos, resumen, f({ surgencias: { Profundo: true } }));
    expect(conOtroFiltro.conteos).toEqual({ APTO: 0, DUDOSO: 0, NO_APTO: 2, SIN_EVALUAR: 0 });
  });
  test('sin resumen no hay ocultos', () => {
    expect(L.buscarReemplazoLogic_conteosAptitud(candidatos, null, f()).noAptosOcultos).toBe(0);
  });
  test('opciones de cuenca: conteo y "sin dato" al final', () => {
    expect(L.buscarReemplazoLogic_opcionesCuenca(candidatos)).toEqual([
      { valor: 'Río Atuel', cantidad: 1 },
      { valor: 'Río Mendoza', cantidad: 3 },
      { valor: 'SIN_DATO', cantidad: 1 }
    ]);
  });
  test('cantidad de filtros activos (para el indicador del panel)', () => {
    expect(L.buscarReemplazoLogic_cantidadFiltrosActivos(f())).toBe(0);
    expect(L.buscarReemplazoLogic_cantidadFiltrosActivos(f({ estados: { APTO: true }, profDesde: 10, soloConTramos: true }))).toBe(3);
    expect(L.buscarReemplazoLogic_cantidadFiltrosActivos(null)).toBe(0);
  });
  test('"Mostrar no aptos" amplia, no cuenta como filtro activo', () => {
    expect(L.buscarReemplazoLogic_cantidadFiltrosActivos(f({ mostrarNoAptos: true }))).toBe(0);
  });
  test('contador: no aptos ocultos se dicen como tales, no como "filtros activos"', () => {
    const t = L.buscarReemplazoLogic_textoContador;
    expect(t(12, 12, 0, '1 km', false)).toBe('12 pozos dentro de 1 km');
    expect(t(1, 1, 0, '500 m', false)).toBe('1 pozo dentro de 500 m');
    expect(t(12, 10, 2, '1 km', false)).toBe('10 pozos dentro de 1 km (2 no aptos ocultos)');
    expect(t(12, 11, 1, '1 km', false)).toBe('11 pozos dentro de 1 km (1 no apto oculto)');
    expect(t(12, 5, 2, '1 km', true)).toBe('5 de 12 pozos dentro de 1 km (filtros activos)');
    expect(t(12, 0, 0, '1 km', true)).toBe('Ningún pozo cumple los filtros (12 pozos dentro de 1 km).');
    expect(t(0, 0, 0, '1 km', false)).toBe('');
  });
});

describe('orden: uno a la vez, auditable', () => {
  const ref = referencia();
  const base = [
    pozo('01-0001', 100, { profundidad: 150 }),                 // dif +50
    pozo('01-0002', 200, { profundidad: 105 }),                 // dif +5
    pozo('01-0003', 300, { profundidad: null }),                // sin dato
    pozo('01-0004', 400, { profundidad: 95 }),                  // dif -5
    pozo('01-0005', 500, { profundidad: 29600 }),               // atipica -> sin dato
    pozo('01-0006', 600, { profundidad: 100 })                  // dif 0
  ];
  const candidatos = L.buscarReemplazoLogic_buscarCandidatos(base, ref, 2000, {});
  const ids = (lista) => lista.map((c) => c.wellId);
  const resumen = { '01-0001': 'NO_APTO', '01-0002': 'DUDOSO', '01-0004': 'APTO', '01-0006': 'APTO' };

  test('distancia ascendente', () => {
    expect(ids(L.buscarReemplazoLogic_ordenar(candidatos.slice().reverse(), 'distancia', null))).toEqual(['01-0001', '01-0002', '01-0003', '01-0004', '01-0005', '01-0006']);
  });
  test('diferencia de profundidad: |dif| ascendente, empate por distancia, sin dato al final por distancia', () => {
    expect(ids(L.buscarReemplazoLogic_ordenar(candidatos, 'profundidad', null))).toEqual(['01-0006', '01-0002', '01-0004', '01-0001', '01-0003', '01-0005']);
  });
  test('estado: Apto, Dudoso, Sin evaluar, No apto; desempate por distancia', () => {
    expect(ids(L.buscarReemplazoLogic_ordenar(candidatos, 'estado', resumen))).toEqual(['01-0004', '01-0006', '01-0002', '01-0003', '01-0005', '01-0001']);
  });
  test('estado sin resumen cae a distancia', () => {
    expect(ids(L.buscarReemplazoLogic_ordenar(candidatos, 'estado', null))).toEqual(ids(candidatos));
  });
  test('orden desconocido = distancia; no muta la entrada', () => {
    const copia = candidatos.slice();
    L.buscarReemplazoLogic_ordenar(candidatos, 'profundidad', null);
    expect(candidatos).toEqual(copia);
    expect(ids(L.buscarReemplazoLogic_ordenar(candidatos, 'otro', null))).toEqual(ids(candidatos));
  });
  test('desempate determinista por wellId a igual distancia', () => {
    const a = { wellId: 'B', distanciaMetros: 10, difProfundidad: null };
    const b = { wellId: 'A', distanciaMetros: 10, difProfundidad: null };
    expect(L.buscarReemplazoLogic_ordenar([a, b], 'distancia', null).map((c) => c.wellId)).toEqual(['A', 'B']);
  });
  test('frases que explican cada orden', () => {
    expect(L.buscarReemplazoLogic_textoOrden('distancia', true, true)).toMatch(/distancia al punto NE/);
    expect(L.buscarReemplazoLogic_textoOrden('profundidad', true, true)).toMatch(/diferencia de profundidad/);
    expect(L.buscarReemplazoLogic_textoOrden('profundidad', true, false)).toMatch(/no tiene profundidad total/);
    expect(L.buscarReemplazoLogic_textoOrden('estado', true, true)).toMatch(/Apto, Dudoso, Sin evaluar, No apto/);
    expect(L.buscarReemplazoLogic_textoOrden('estado', false, true)).toMatch(/distancia/);
  });
});

describe('explicacion por candidato: datos crudos y "Sin dato"', () => {
  const ref = referencia();
  const textos = (c) => L.buscarReemplazoLogic_explicar(c, ref).map((i) => i.texto);
  const una = (extra) => L.buscarReemplazoLogic_buscarCandidatos([pozo('01-0001', 820, extra)], ref, 2000, {})[0];

  test('candidato completo', () => {
    const t = textos(una({ profundidad: 112, estado: 'C', surgencia: 'SemiSurgente' }));
    expect(t).toEqual([
      '820 m del punto NE',
      'Prof. 112 m (+12 m vs. punto NE)',
      'Filtros: 80–100 m',
      'Semisurgente',
      'Río Mendoza',
      'Coordenada confirmada'
    ]);
  });
  test('todo lo que falta se dice Sin dato y nunca se completa', () => {
    const items = L.buscarReemplazoLogic_explicar(una({ profundidad: null, tramosFiltrantes: [], surgencia: null, cuenca: null }), ref);
    const por = Object.fromEntries(items.map((i) => [i.clave, i]));
    expect(por.profundidad).toEqual({ clave: 'profundidad', texto: 'Profundidad: Sin dato', tipo: 'sin-dato' });
    expect(por.tramos.texto).toBe('Filtros: Sin dato');
    expect(por.surgencia.texto).toBe('Tipo: Sin dato');
    expect(por.cuenca.texto).toBe('Cuenca: Sin dato');
    expect(por.coordenada.texto).toBe('Coordenada disponible (1 fuente)');
    expect(por.coordenada.tipo).toBe('dato');
  });
  test('profundidad atipica: aviso, sin diferencia', () => {
    const item = L.buscarReemplazoLogic_explicar(una({ profundidad: 29600 }), ref).find((i) => i.clave === 'profundidad');
    expect(item.tipo).toBe('aviso');
    expect(item.texto).toBe('Profundidad atípica (29.600 m): no se compara');
  });
  test('punto NE sin profundidad: se muestra la del candidato sin comparar', () => {
    const refSin = referencia({ profundidad: null });
    const c = L.buscarReemplazoLogic_buscarCandidatos([pozo('01-0001', 100)], refSin, 1000, {})[0];
    const item = L.buscarReemplazoLogic_explicar(c, refSin).find((i) => i.clave === 'profundidad');
    expect(item.texto).toBe('Prof. 100 m (punto NE sin profundidad)');
  });
  test('varios tramos: muestra 2 y cuenta el resto', () => {
    expect(L.buscarReemplazoLogic_textoTramos([{ desde: 1, hasta: 2 }, { desde: 3.5, hasta: 4 }, { desde: 5, hasta: 6 }])).toBe('1–2 m · 3,5–4 m · +1');
    expect(L.buscarReemplazoLogic_textoTramos([])).toBeNull();
  });
  test('pozo de la red NE incluido: aviso', () => {
    const c = L.buscarReemplazoLogic_buscarCandidatos([pozo('01-0001', 100)], ref, 1000, { incluirRedNE: true, redNE: { '01-0001': true } })[0];
    expect(L.buscarReemplazoLogic_explicar(c, ref).map((i) => i.clave)).toContain('redNE');
  });
  test('no hay ningun puntaje compuesto en la salida', () => {
    const c = una({});
    expect(Object.keys(c).some((k) => /score|puntaje|ranking/i.test(k))).toBe(false);
  });
});

describe('punto NE de referencia desde el contexto del mapa (Evaluar conserva el contexto)', () => {
  const ctx = (extra) => Object.assign({
    tipo: 'vistaPrevia', origen: 'radio', wellIds: ['01-0001', '01-0002'],
    geometria: { lat: BASE.lat, lon: BASE.lon, radioMetros: 1000, tipoReferencia: 'puntoNE', etiqueta: '04-0263' }
  }, extra);

  test('contexto de una busqueda de reemplazo y pozo incluido: devuelve el monitoringId', () => {
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx(), '01-0002')).toBe('04-0263');
  });
  test('tambien si la vista previa paso a seleccion confirmada (misma geometria)', () => {
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx({ tipo: 'seleccion' }), '01-0001')).toBe('04-0263');
  });
  test('monitoringId numerico de punto especial (string)', () => {
    const c = ctx();
    c.geometria.etiqueta = 7;
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(c, '01-0001')).toBe('7');
  });
  test('pozo que no es parte del contexto: no se inventa referencia', () => {
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx(), '09-9999')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx(), '')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx(), undefined)).toBeNull();
  });
  test('mapa normal, Cerca Mio (GPS / punto elegido), poligono o sin contexto: null', () => {
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(null, '01-0001')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(undefined, '01-0001')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx({ geometria: null }), '01-0001')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx({ geometria: { lat: 1, lon: 2, radioMetros: 500, tipoReferencia: 'miUbicacion' } }), '01-0001')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx({ geometria: { lat: 1, lon: 2, radioMetros: 500, tipoReferencia: 'elegirMapa' } }), '01-0001')).toBeNull();
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(ctx({ origen: 'poligono', geometria: { vertices: [] } }), '01-0001')).toBeNull();
  });
  test('puntoNE sin etiqueta: null', () => {
    const c = ctx();
    delete c.geometria.etiqueta;
    expect(L.buscarReemplazoLogic_puntoNEDeContexto(c, '01-0001')).toBeNull();
  });
});

describe('permiso: Buscar reemplazo requiere reemplazo=SI (y ne=SI)', () => {
  test('solo con ne y reemplazo', () => {
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: true, reemplazo: true })).toBe(true);
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: true, reemplazo: true, perfil: false })).toBe(true);
  });
  test('ne=SI con reemplazo=NO: no (sigue usando el Mapa NE normalmente)', () => {
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: true, reemplazo: false })).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: true })).toBe(false);
  });
  test('reemplazo=SI sin ne: no (la referencia es un punto de la red NE)', () => {
    expect(L.buscarReemplazoLogic_puedeBuscar({ reemplazo: true })).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar({ reemplazo: true, ne: false, perfil: true })).toBe(false);
  });
  test('sin permisos o valores no booleanos: no', () => {
    expect(L.buscarReemplazoLogic_puedeBuscar(null)).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar(undefined)).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar({})).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: 'SI', reemplazo: 'SI' })).toBe(false);
    expect(L.buscarReemplazoLogic_puedeBuscar({ ne: 1, reemplazo: 1 })).toBe(false);
  });
});

describe('geometria y radios', () => {
  test('geometria para la vista previa del mapa', () => {
    expect(L.buscarReemplazoLogic_geometria(referencia(), 1000)).toEqual({ lat: BASE.lat, lon: BASE.lon, radioMetros: 1000, tipoReferencia: 'puntoNE', etiqueta: '04-0263' });
  });
  test('radio inicial 1 km y siguiente preset', () => {
    expect(L.BUSCAR_REEMPLAZO_RADIO_DEFAULT_METROS).toBe(1000);
    expect(L.buscarReemplazoLogic_siguienteRadio(1000)).toBe(2000);
    expect(L.buscarReemplazoLogic_siguienteRadio(500)).toBe(1000);
    expect(L.buscarReemplazoLogic_siguienteRadio(1500)).toBe(2000);
    expect(L.buscarReemplazoLogic_siguienteRadio(5000)).toBeNull();
    expect(L.buscarReemplazoLogic_siguienteRadio(20000)).toBeNull();
  });
});
