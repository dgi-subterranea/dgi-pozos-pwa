const {
  CERCA_MIO_RADIOS_METROS,
  CERCA_MIO_RADIO_DEFAULT_METROS,
  CERCA_MIO_MAX_RESULTADOS,
  cercaMioLogic_haversineMetros,
  cercaMioLogic_boundingBox,
  cercaMioLogic_formatearDistancia,
  cercaMioLogic_buscarCercanos
} = require('./cercaMioLogic');

// Punto de referencia real del dataset (04-0263, ya usado en otros
// tests del proyecto).
const LAT_REF = -32.86865;
const LON_REF = -68.7507;

describe('constantes', () => {
  test('radios y default coinciden con lo aprobado', () => {
    expect(CERCA_MIO_RADIOS_METROS).toEqual([500, 1000, 2000, 5000]);
    expect(CERCA_MIO_RADIO_DEFAULT_METROS).toBe(2000);
    expect(CERCA_MIO_MAX_RESULTADOS).toBe(30);
  });
});

describe('cercaMioLogic_haversineMetros', () => {
  test('distancia de un punto a si mismo es 0', () => {
    expect(cercaMioLogic_haversineMetros(LAT_REF, LON_REF, LAT_REF, LON_REF)).toBe(0);
  });

  // 1 grado de latitud son ~111.32km - referencia conocida e
  // independiente de la formula de Haversine, sirve para detectar un
  // error de unidades/signo grosero.
  test('1 grado de latitud son ~111.32km (tolerancia 1%)', () => {
    const d = cercaMioLogic_haversineMetros(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111320 * 0.99);
    expect(d).toBeLessThan(111320 * 1.01);
  });

  test('simetrica: A->B es igual a B->A', () => {
    const ab = cercaMioLogic_haversineMetros(LAT_REF, LON_REF, -32.9, -68.8);
    const ba = cercaMioLogic_haversineMetros(-32.9, -68.8, LAT_REF, LON_REF);
    expect(ab).toBeCloseTo(ba, 6);
  });

  // ~0.001 grado de latitud ~= 111.32m - un desplazamiento chico y
  // conocido, util para verificar que la funcion responde en la escala
  // correcta (metros, no km ni grados sueltos).
  test('desplazamiento chico conocido (~0.001 grado de latitud) da ~111m', () => {
    const d = cercaMioLogic_haversineMetros(LAT_REF, LON_REF, LAT_REF + 0.001, LON_REF);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe('cercaMioLogic_boundingBox', () => {
  test('el punto de origen queda estrictamente adentro del box', () => {
    const box = cercaMioLogic_boundingBox(LAT_REF, LON_REF, 2000);
    expect(LAT_REF).toBeGreaterThan(box.latMin);
    expect(LAT_REF).toBeLessThan(box.latMax);
    expect(LON_REF).toBeGreaterThan(box.lonMin);
    expect(LON_REF).toBeLessThan(box.lonMax);
  });

  test('un radio mayor produce un box estrictamente mas grande', () => {
    const chico = cercaMioLogic_boundingBox(LAT_REF, LON_REF, 500);
    const grande = cercaMioLogic_boundingBox(LAT_REF, LON_REF, 5000);
    expect(grande.latMax - grande.latMin).toBeGreaterThan(chico.latMax - chico.latMin);
    expect(grande.lonMax - grande.lonMin).toBeGreaterThan(chico.lonMax - chico.lonMin);
  });

  // El bounding box es un CUADRADO en grados, no un circulo - a esta
  // latitud (~-33, Mendoza) cos(lat) < 1, asi que el ancho en longitud
  // (grados) tiene que ser mayor que el alto en latitud para cubrir el
  // mismo radio en metros. Si esto alguna vez da igual, es un indicio de
  // que la correccion por coseno de latitud se rompio.
  test('a latitud -33 (Mendoza) el box es mas ancho en longitud que en latitud (correccion por coseno)', () => {
    const box = cercaMioLogic_boundingBox(LAT_REF, LON_REF, 2000);
    const altoLat = box.latMax - box.latMin;
    const anchoLon = box.lonMax - box.lonMin;
    expect(anchoLon).toBeGreaterThan(altoLat);
  });
});

describe('cercaMioLogic_formatearDistancia', () => {
  test('menos de 1000m: metros redondeados', () => {
    expect(cercaMioLogic_formatearDistancia(184.4)).toBe('184 m');
    expect(cercaMioLogic_formatearDistancia(999.6)).toBe('1000 m');
  });

  test('1000m o mas, valor no redondo: km con 1 decimal', () => {
    expect(cercaMioLogic_formatearDistancia(1834)).toBe('1.8 km');
    expect(cercaMioLogic_formatearDistancia(2350)).toBe('2.4 km');
  });

  // Los 4 radios de la app (500m/1km/2km/5km) son siempre valores
  // redondos - "2 km" se lee mejor que "2.0 km" en los chips/mensajes,
  // sin perder precision donde si hace falta (test de arriba).
  test('1000m o mas, valor redondo de km: sin decimal', () => {
    expect(cercaMioLogic_formatearDistancia(1000)).toBe('1 km');
    expect(cercaMioLogic_formatearDistancia(2000)).toBe('2 km');
    expect(cercaMioLogic_formatearDistancia(5000)).toBe('5 km');
  });
});

describe('cercaMioLogic_buscarCercanos', () => {
  function pozo(wellId, deltaLatGrados, estado) {
    // Cada 0.001 grado de latitud ~= 111m - fixture facil de razonar.
    return { wellId: wellId, lat: LAT_REF + deltaLatGrados, lon: LON_REF, estado: estado || 'D' };
  }

  test('ordena ascendente por distancia', () => {
    const pozos = [pozo('C-lejos', 0.01), pozo('A-cerca', 0.001), pozo('B-medio', 0.005)];
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 5000);
    expect(r.map((x) => x.wellId)).toEqual(['A-cerca', 'B-medio', 'C-lejos']);
    expect(r[0].distanciaMetros).toBeLessThan(r[1].distanciaMetros);
    expect(r[1].distanciaMetros).toBeLessThan(r[2].distanciaMetros);
  });

  test('excluye puntos fuera del radio exacto (Haversine), no solo fuera del bounding box', () => {
    // ~0.01 grado de latitud ~= 1113m - fuera de un radio de 500m.
    const pozos = [pozo('adentro', 0.001), pozo('afuera', 0.01)];
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 500);
    expect(r.map((x) => x.wellId)).toEqual(['adentro']);
  });

  test('respeta el radio pedido: mismo dataset, radios distintos dan resultados distintos', () => {
    const pozos = [pozo('a-111m', 0.001), pozo('a-556m', 0.005), pozo('a-1113m', 0.01)];
    const r500 = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 500);
    const r1000 = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 1000);
    const r2000 = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 2000);
    expect(r500.map((x) => x.wellId)).toEqual(['a-111m']);
    expect(r1000.map((x) => x.wellId)).toEqual(['a-111m', 'a-556m']);
    expect(r2000.map((x) => x.wellId)).toEqual(['a-111m', 'a-556m', 'a-1113m']);
  });

  test('maximo 30 resultados aunque haya mas candidatos dentro del radio', () => {
    const pozos = [];
    for (let i = 0; i < 50; i++) {
      pozos.push(pozo('w-' + i, 0.0001 * i)); // todos dentro de ~500m, distancias distintas entre si
    }
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 5000);
    expect(r.length).toBe(30);
  });

  test('respeta un maxResultados custom menor a 30', () => {
    const pozos = [pozo('a', 0.0001), pozo('b', 0.0002), pozo('c', 0.0003)];
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 5000, 2);
    expect(r.length).toBe(2);
    expect(r.map((x) => x.wellId)).toEqual(['a', 'b']);
  });

  test('sin candidatos dentro del radio -> lista vacia, no rompe', () => {
    const pozos = [pozo('lejos', 1)]; // ~111km, muy afuera de cualquier radio de la app
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 5000);
    expect(r).toEqual([]);
  });

  test('dataset vacio -> lista vacia, no rompe', () => {
    expect(cercaMioLogic_buscarCercanos([], LAT_REF, LON_REF, 2000)).toEqual([]);
  });

  test('conserva wellId/lat/lon/estado del punto original ademas de distanciaMetros', () => {
    const pozos = [pozo('04-0263', 0.001, 'C')];
    const r = cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 2000);
    expect(r[0]).toMatchObject({ wellId: '04-0263', estado: 'C' });
    expect(typeof r[0].distanciaMetros).toBe('number');
  });
});

// Requisito de privacidad explicito: estas funciones son puras, nunca
// hacen red. La garantia de que la posicion del usuario no se envia a
// ningun lado depende del ARQUITECTURA (js/cercaMio.js nunca pasa
// lat/lon a ningun apiXxx), pero esto verifica el piso: ni siquiera la
// funcion que mas cerca esta de "usar" la posicion toca fetch.
describe('privacidad: las funciones puras nunca hacen red', () => {
  test('cercaMioLogic_buscarCercanos no llama a fetch/XMLHttpRequest', () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    const pozos = [{ wellId: '01-0001', lat: LAT_REF, lon: LON_REF, estado: 'D' }];
    cercaMioLogic_buscarCercanos(pozos, LAT_REF, LON_REF, 2000);

    expect(fetchMock).not.toHaveBeenCalled();
    global.fetch = originalFetch;
  });
});
