const fs = require('fs');
const path = require('path');

const {
  SELECCION_POLIGONO_TOLERANCIA_DEFAULT,
  seleccionLogic_normalizar,
  seleccionLogic_reemplazar,
  seleccionLogic_agregar,
  seleccionLogic_quitar,
  seleccionLogic_limpiar,
  seleccionLogic_distanciaPuntoASegmento,
  seleccionLogic_pointInPolygonOrBoundary,
  seleccionLogic_filtrarPorPoligono,
  seleccionLogic_resolverContexto,
  seleccionLogic_claveContexto,
  seleccionLogic_filtrarPorWellIds,
  seleccionLogic_describirVista
} = require('./seleccionLogic');

// ---- Seleccion: operaciones de set ----

describe('seleccionLogic_normalizar', () => {
  test('quita duplicados, preserva el resto', () => {
    expect(seleccionLogic_normalizar(['01-0001', '01-0002', '01-0001'])).toEqual(['01-0001', '01-0002']);
  });
  test('undefined/null -> array vacio', () => {
    expect(seleccionLogic_normalizar(undefined)).toEqual([]);
    expect(seleccionLogic_normalizar(null)).toEqual([]);
  });
});

describe('seleccionLogic_reemplazar', () => {
  test('ignora lo que habia antes, usa solo los nuevos (normalizados)', () => {
    const resultado = seleccionLogic_reemplazar(['01-0001', '01-0001', '02-0005']);
    expect(resultado).toEqual(['01-0001', '02-0005']);
  });
});

describe('seleccionLogic_agregar', () => {
  test('une sin duplicar', () => {
    const resultado = seleccionLogic_agregar(['01-0001', '02-0005'], ['02-0005', '03-0010']);
    expect(resultado).toEqual(['01-0001', '02-0005', '03-0010']);
  });
  test('seleccion vacia + nuevos -> igual a reemplazar', () => {
    expect(seleccionLogic_agregar([], ['01-0001'])).toEqual(['01-0001']);
  });
});

describe('seleccionLogic_quitar', () => {
  test('quita un wellId puntual, conserva el resto en orden', () => {
    const resultado = seleccionLogic_quitar(['01-0001', '02-0005', '03-0010'], '02-0005');
    expect(resultado).toEqual(['01-0001', '03-0010']);
  });
  test('wellId no presente -> no rompe, devuelve igual', () => {
    expect(seleccionLogic_quitar(['01-0001'], '99-9999')).toEqual(['01-0001']);
  });
});

describe('seleccionLogic_limpiar', () => {
  test('siempre array vacio', () => {
    expect(seleccionLogic_limpiar()).toEqual([]);
  });
});

// ---- Poligono: point-in-polygon-or-boundary ----
// Cuadrado (0,0)-(0,10)-(10,10)-(10,0) en {lat,lon} - lado 0,0->0,10 es
// HORIZONTAL (lat constante), lado 0,10->10,10 es VERTICAL (lon
// constante). Triangulo aparte para el lado DIAGONAL.

const CUADRADO = [
  { lat: 0, lon: 0 },
  { lat: 0, lon: 10 },
  { lat: 10, lon: 10 },
  { lat: 10, lon: 0 }
];

const TRIANGULO = [
  { lat: 0, lon: 0 },
  { lat: 10, lon: 0 },
  { lat: 0, lon: 10 }
]; // el lado (10,0)-(0,10) es diagonal (lat+lon=10)

describe('seleccionLogic_pointInPolygonOrBoundary ("interior O borde = seleccionado")', () => {
  test('vertice exacto -> true', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(0, 0, CUADRADO)).toBe(true);
  });

  test('punto sobre un segmento HORIZONTAL (lat constante) -> true', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(0, 5, CUADRADO)).toBe(true);
  });

  test('punto sobre un segmento VERTICAL (lon constante) -> true', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 10, CUADRADO)).toBe(true);
  });

  test('punto sobre un segmento DIAGONAL -> true', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 5, TRIANGULO)).toBe(true);
  });

  test('punto interior (lejos de cualquier borde) -> true', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 5, CUADRADO)).toBe(true);
  });

  test('punto exterior -> false', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(20, 20, CUADRADO)).toBe(false);
  });

  test('punto exterior cerca de un borde pero fuera de tolerancia -> false', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(0, -0.5, CUADRADO)).toBe(false);
  });

  test('menos de 3 vertices -> false, no rompe', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 5, [{ lat: 0, lon: 0 }, { lat: 10, lon: 10 }])).toBe(false);
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 5, [])).toBe(false);
    expect(seleccionLogic_pointInPolygonOrBoundary(5, 5, null)).toBe(false);
  });

  test('poligono con muchos vertices (circulo aproximado, 50 puntos): interior y exterior correctos', () => {
    const vertices = [];
    for (let i = 0; i < 50; i++) {
      const angulo = (2 * Math.PI * i) / 50;
      vertices.push({ lat: 10 * Math.sin(angulo), lon: 10 * Math.cos(angulo) });
    }
    expect(seleccionLogic_pointInPolygonOrBoundary(0, 0, vertices)).toBe(true); // centro
    expect(seleccionLogic_pointInPolygonOrBoundary(100, 100, vertices)).toBe(false); // bien afuera
  });

  test('tolerancia custom: un punto cerca del borde entra con tolerancia mayor', () => {
    expect(seleccionLogic_pointInPolygonOrBoundary(0, -0.05, CUADRADO, 0.1)).toBe(true);
    expect(seleccionLogic_pointInPolygonOrBoundary(0, -0.05, CUADRADO, 1e-9)).toBe(false);
  });

  test('poligono triangular chico (lado 0.001 grados, similar a una manzana urbana): sigue funcionando', () => {
    const chico = [{ lat: 0, lon: 0 }, { lat: 0.001, lon: 0 }, { lat: 0, lon: 0.001 }];
    expect(seleccionLogic_pointInPolygonOrBoundary(0.0003, 0.0003, chico)).toBe(true);
    expect(seleccionLogic_pointInPolygonOrBoundary(1, 1, chico)).toBe(false);
  });
});

describe('seleccionLogic_distanciaPuntoASegmento', () => {
  test('punto sobre el segmento -> distancia 0', () => {
    expect(seleccionLogic_distanciaPuntoASegmento(5, 0, 0, 0, 10, 0)).toBe(0);
  });
  test('punto fuera del rango del segmento usa el extremo mas cercano', () => {
    const d = seleccionLogic_distanciaPuntoASegmento(-5, 0, 0, 0, 10, 0);
    expect(d).toBe(5); // distancia al extremo (0,0), no a la recta infinita
  });
  test('segmento degenerado (2 vertices iguales) no rompe', () => {
    expect(seleccionLogic_distanciaPuntoASegmento(3, 4, 0, 0, 0, 0)).toBe(5);
  });
});

describe('seleccionLogic_filtrarPorPoligono', () => {
  function pozo(wellId, lat, lon) {
    return { wellId, lat, lon };
  }

  test('devuelve solo los wellId dentro o en el borde', () => {
    const puntos = [pozo('a-adentro', 5, 5), pozo('b-borde', 0, 5), pozo('c-afuera', 50, 50)];
    expect(seleccionLogic_filtrarPorPoligono(puntos, CUADRADO)).toEqual(['a-adentro', 'b-borde']);
  });

  test('sin pozos dentro -> array vacio', () => {
    const puntos = [pozo('lejos', 500, 500)];
    expect(seleccionLogic_filtrarPorPoligono(puntos, CUADRADO)).toEqual([]);
  });

  test('poligono invalido (menos de 3 vertices) -> array vacio', () => {
    const puntos = [pozo('a', 5, 5)];
    expect(seleccionLogic_filtrarPorPoligono(puntos, [{ lat: 0, lon: 0 }])).toEqual([]);
  });

  test('dataset vacio -> array vacio', () => {
    expect(seleccionLogic_filtrarPorPoligono([], CUADRADO)).toEqual([]);
  });
});

// ---- Contexto geografico + alcance + filtros (ajuste UX: seleccion
// geografica combinada con los filtros del mapa) ----

const GEO_RADIO = { lat: -32.89, lon: -68.84, radioMetros: 2000, tipoReferencia: 'elegirMapa' };
const GEO_POLI = { vertices: [{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 0, lon: 1 }] };

describe('seleccionLogic_resolverContexto', () => {
  const seleccion = { wellIds: ['01-0001', '01-0002'], origen: 'poligono', geometria: GEO_POLI };
  const vista = { wellIds: ['05-0001'], origen: 'radio', geometria: GEO_RADIO };

  test('sin nada -> null', () => {
    expect(seleccionLogic_resolverContexto(null, null)).toBeNull();
  });
  test('solo seleccion confirmada -> tipo "seleccion"', () => {
    const ctx = seleccionLogic_resolverContexto(null, seleccion);
    expect(ctx.tipo).toBe('seleccion');
    expect(ctx.origen).toBe('poligono');
    expect(ctx.wellIds).toEqual(['01-0001', '01-0002']);
  });
  test('solo vista previa -> tipo "vistaPrevia"', () => {
    expect(seleccionLogic_resolverContexto(vista, null).tipo).toBe('vistaPrevia');
  });
  test('las dos: la vista previa tiene prioridad', () => {
    const ctx = seleccionLogic_resolverContexto(vista, seleccion);
    expect(ctx.tipo).toBe('vistaPrevia');
    expect(ctx.wellIds).toEqual(['05-0001']);
  });
  test('seleccion vacia (wellIds=[]) no cuenta como contexto', () => {
    expect(seleccionLogic_resolverContexto(null, { wellIds: [], origen: 'radio', geometria: GEO_RADIO })).toBeNull();
  });
  test('vista previa vacia cae a la seleccion', () => {
    const ctx = seleccionLogic_resolverContexto({ wellIds: [], origen: 'radio', geometria: GEO_RADIO }, seleccion);
    expect(ctx.tipo).toBe('seleccion');
  });
  test('quitar/cancelar la vista previa hace reaparecer la seleccion confirmada (misma geometria y pozos)', () => {
    const conPrevia = seleccionLogic_resolverContexto(vista, seleccion);
    expect(conPrevia.tipo).toBe('vistaPrevia');
    const sinPrevia = seleccionLogic_resolverContexto(null, seleccion);
    expect(sinPrevia.tipo).toBe('seleccion');
    expect(sinPrevia.wellIds).toEqual(seleccion.wellIds);
    expect(sinPrevia.geometria).toEqual(GEO_POLI);
    // cambia de contexto -> el mapa vuelve a alcance "todo"
    expect(seleccionLogic_claveContexto(sinPrevia)).not.toBe(seleccionLogic_claveContexto(conPrevia));
  });
});

describe('seleccionLogic_claveContexto', () => {
  test('null -> cadena vacia', () => {
    expect(seleccionLogic_claveContexto(null)).toBe('');
  });
  test('quitar un pozo (mismos tipo/origen/geometria) NO cambia la clave', () => {
    const a = { tipo: 'seleccion', origen: 'radio', geometria: GEO_RADIO, wellIds: ['01-0001', '01-0002'] };
    const b = { tipo: 'seleccion', origen: 'radio', geometria: GEO_RADIO, wellIds: ['01-0001'] };
    expect(seleccionLogic_claveContexto(a)).toBe(seleccionLogic_claveContexto(b));
  });
  test('otro radio, otro tipo u otro origen SI cambian la clave', () => {
    const base = { tipo: 'seleccion', origen: 'radio', geometria: GEO_RADIO, wellIds: [] };
    const otroRadio = Object.assign({}, base, { geometria: Object.assign({}, GEO_RADIO, { radioMetros: 5000 }) });
    const otroTipo = Object.assign({}, base, { tipo: 'vistaPrevia' });
    const otroOrigen = Object.assign({}, base, { origen: 'poligono', geometria: GEO_POLI });
    const k = seleccionLogic_claveContexto(base);
    expect(seleccionLogic_claveContexto(otroRadio)).not.toBe(k);
    expect(seleccionLogic_claveContexto(otroTipo)).not.toBe(k);
    expect(seleccionLogic_claveContexto(otroOrigen)).not.toBe(k);
  });
});

describe('seleccionLogic_filtrarPorWellIds', () => {
  test('conserva solo los puntos cuyo wellId esta en el set', () => {
    const puntos = [{ wellId: 'a' }, { wellId: 'b' }, { wellId: 'c' }];
    expect(seleccionLogic_filtrarPorWellIds(puntos, new Set(['a', 'c']))).toEqual([{ wellId: 'a' }, { wellId: 'c' }]);
  });
  test('set vacio -> nada', () => {
    expect(seleccionLogic_filtrarPorWellIds([{ wellId: 'a' }], new Set())).toEqual([]);
  });
});

describe('seleccionLogic_describirVista (3 modos: todo / solo / interseccion)', () => {
  const ctxSel = { tipo: 'seleccion', origen: 'poligono', geometria: GEO_POLI, wellIds: new Array(40).fill('x') };
  const ctxPrev = { tipo: 'vistaPrevia', origen: 'radio', geometria: GEO_RADIO, wellIds: new Array(14).fill('x') };

  test('sin contexto: modo "todo", sin titulo, contador sobre todo el dataset', () => {
    const v = seleccionLogic_describirVista({ contexto: null, alcance: 'todo', filtrosActivos: false, visibles: 13804, totalDataset: 13804 });
    expect(v.modo).toBe('todo');
    expect(v.titulo).toBeNull();
    expect(v.contador).toBe('13804 de 13804 pozos');
  });
  test('sin contexto + filtros: el contador sigue siendo sobre todo el dataset', () => {
    const v = seleccionLogic_describirVista({ contexto: null, alcance: 'todo', filtrosActivos: true, visibles: 3762, totalDataset: 13804 });
    expect(v.contador).toBe('3762 de 13804 pozos');
  });
  test('seleccion + alcance "todo": se ven todos, la seleccion solo esta resaltada', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxSel, alcance: 'todo', filtrosActivos: false, visibles: 13804, totalDataset: 13804 });
    expect(v.modo).toBe('todo');
    expect(v.titulo).toBe('Selección por polígono · 40 pozos');
    expect(v.estado).toContain('todos los pozos del mapa');
    expect(v.estado).toContain('resaltada');
    expect(v.contador).toBe('13804 de 13804 pozos');
  });
  test('seleccion + alcance "solo" sin filtros: modo "solo", contador sobre la seleccion', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxSel, alcance: 'solo', filtrosActivos: false, visibles: 40, totalDataset: 13804 });
    expect(v.modo).toBe('solo');
    expect(v.estado).toBe('Viendo: solo la selección');
    expect(v.contador).toBe('40 de 40 pozos de la selección');
  });
  test('seleccion + alcance "solo" + filtros: modo "interseccion" con X de N', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxSel, alcance: 'solo', filtrosActivos: true, visibles: 12, totalDataset: 13804 });
    expect(v.modo).toBe('interseccion');
    expect(v.estado).toBe('Viendo: la selección ∩ filtros · 12 de 40');
    expect(v.contador).toBe('12 de 40 pozos de la selección (con filtros)');
  });
  test('interseccion vacia: 0 de N, no rompe', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxSel, alcance: 'solo', filtrosActivos: true, visibles: 0, totalDataset: 13804 });
    expect(v.contador).toBe('0 de 40 pozos de la selección (con filtros)');
  });
  test('alcance "todo" con filtros lo aclara en el estado', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxSel, alcance: 'todo', filtrosActivos: true, visibles: 3762, totalDataset: 13804 });
    expect(v.estado).toContain('(con filtros)');
  });
  test('vista previa: el texto habla de "vista previa", no de "selección"', () => {
    const v = seleccionLogic_describirVista({ contexto: ctxPrev, alcance: 'solo', filtrosActivos: false, visibles: 14, totalDataset: 13804 });
    expect(v.titulo).toBe('Vista previa por radio · 14 pozos');
    expect(v.estado).toBe('Viendo: solo la vista previa');
  });
  test('seleccion por radio: titulo "Selección por radio"; 1 solo pozo en singular', () => {
    const ctx = { tipo: 'seleccion', origen: 'radio', geometria: GEO_RADIO, wellIds: ['x'] };
    const v = seleccionLogic_describirVista({ contexto: ctx, alcance: 'todo', filtrosActivos: false, visibles: 1, totalDataset: 13804 });
    expect(v.titulo).toBe('Selección por radio · 1 pozo');
  });
});

// ---- Rendimiento real (item 11 del cierre): point-in-polygon contra los
// 13.804 pozos reales de scripts/out/mapa/pozos.json, con poligonos de
// 3/10/50/100 vertices. "Si el calculo es trivial, perfecto. No agregar
// optimizacion espacial compleja salvo que las mediciones indiquen que
// realmente hace falta" - este test IMPRIME los tiempos (consola) y
// ademas los afirma por debajo de un umbral generoso, para que una
// regresion real futura rompa el test en vez de pasar desapercibida.
describe('rendimiento: filtrarPorPoligono contra el dataset real (13.804 pozos)', () => {
  const rutaPozos = path.join(__dirname, '..', 'scripts', 'out', 'mapa', 'pozos.json');
  const hayDatasetReal = fs.existsSync(rutaPozos);
  const pozosReales = hayDatasetReal ? JSON.parse(fs.readFileSync(rutaPozos, 'utf8')) : null;

  // Centro aproximado de la provincia (mismo usado en otras mediciones de
  // la sesion) - los poligonos son circulos regulares de ~0.5 grados de
  // radio (~50km), area que en la practica contiene una porcion real del
  // dataset, ni vacia ni "casi todo".
  function poligonoRegular(nVertices, radioGrados) {
    const vertices = [];
    for (let i = 0; i < nVertices; i++) {
      const angulo = (2 * Math.PI * i) / nVertices;
      vertices.push({ lat: -32.89 + radioGrados * Math.sin(angulo), lon: -68.84 + radioGrados * Math.cos(angulo) });
    }
    return vertices;
  }

  if (!hayDatasetReal) {
    test.skip('scripts/out/mapa/pozos.json no esta generado localmente - se salta la medicion real', () => {});
    return;
  }

  test.each([3, 10, 50, 100])('poligono de %i vertices (pocos pozos adentro, radio chico ~5km): tiempo y conteo', (n) => {
    const vertices = poligonoRegular(n, 0.05);
    const inicio = Date.now();
    const resultado = seleccionLogic_filtrarPorPoligono(pozosReales, vertices);
    const elapsedMs = Date.now() - inicio;

    // eslint-disable-next-line no-console
    console.log('[perf] poligono ' + n + ' vertices, radio chico: ' + resultado.length + ' pozos, ' + elapsedMs + 'ms');
    // Umbral generoso a proposito (medido en la practica: unos pocos ms
    // hasta 100 vertices con el prefiltro de bounding box) - el objetivo
    // es documentar y detectar una regresion real, no microoptimizar ni
    // ser fragil ante variacion de maquina/carga.
    expect(elapsedMs).toBeLessThan(1000);
  });

  test.each([3, 10, 50, 100])('poligono de %i vertices (casi todo el dataset, radio grande ~1 grado): tiempo y conteo', (n) => {
    const vertices = poligonoRegular(n, 1.0);
    const inicio = Date.now();
    const resultado = seleccionLogic_filtrarPorPoligono(pozosReales, vertices);
    const elapsedMs = Date.now() - inicio;

    // eslint-disable-next-line no-console
    console.log('[perf] poligono ' + n + ' vertices, radio grande: ' + resultado.length + ' de ' + pozosReales.length + ' pozos, ' + elapsedMs + 'ms');
    // Caso mas caro medido (poligono de 100 vertices cubriendo ~83% del
    // dataset): ronda los 500-620ms segun maquina/carga - umbral 1000ms
    // para no ser fragil, sigue sirviendo para atrapar una regresion real
    // (ej. si alguien saca el prefiltro de bounding box).
    expect(elapsedMs).toBeLessThan(1000);
  });

  test('poligono sin ningun pozo adentro (radio minusculo en zona sin dataset) -> 0, rapido igual', () => {
    const vertices = poligonoRegular(6, 0.0001);
    const inicio = Date.now();
    const resultado = seleccionLogic_filtrarPorPoligono(pozosReales, vertices);
    const elapsedMs = Date.now() - inicio;

    expect(Array.isArray(resultado)).toBe(true);
    expect(elapsedMs).toBeLessThan(1000);
  });
});

describe('seleccionLogic_debeConservarVista (Mi seleccion conserva buscar/filtro al volver)', () => {
  const { seleccionLogic_debeConservarVista } = require('./seleccionLogic');
  test('misma seleccion: se conserva', () => {
    expect(seleccionLogic_debeConservarVista(['01-0001', '01-0002'], ['01-0001', '01-0002'])).toBe(true);
  });
  test('se quito un pozo (subconjunto): se conserva', () => {
    expect(seleccionLogic_debeConservarVista(['01-0001', '01-0002', '01-0003'], ['01-0001', '01-0003'])).toBe(true);
  });
  test('entro un pozo nuevo (otra seleccion / agregar): se reinicia', () => {
    expect(seleccionLogic_debeConservarVista(['01-0001'], ['01-0001', '01-0002'])).toBe(false);
    expect(seleccionLogic_debeConservarVista(['01-0001'], ['09-0009'])).toBe(false);
  });
  test('primera apertura (sin seleccion anterior): se reinicia', () => {
    expect(seleccionLogic_debeConservarVista(null, ['01-0001'])).toBe(false);
  });
  test('seleccion vacia ahora y luego una nueva: la nueva reinicia', () => {
    expect(seleccionLogic_debeConservarVista([], [])).toBe(true);
    expect(seleccionLogic_debeConservarVista([], ['01-0001'])).toBe(false);
  });
});
