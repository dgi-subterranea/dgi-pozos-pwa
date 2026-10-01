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
  seleccionLogic_filtrarPorPoligono
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
