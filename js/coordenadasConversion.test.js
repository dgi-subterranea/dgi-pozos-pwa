// Etapa 1 de "Ingresar coordenadas": conversion y validacion PURAS (js/coordenadasConversion.js).
// Contrato numerico contra js/fixtures/posgar94_ar2_vectores.json (generado con pyproj/PROJ por scripts/gen_vectores_posgar.py), parseo, GMS y POSGAR 94 / Argentina 2.
const fs = require('fs');
const path = require('path');
const C = require('./coordenadasConversion');
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'posgar94_ar2_vectores.json'), 'utf8'));

// distancia aproximada en metros entre dos puntos cercanos (suficiente para medir errores de micras a metros)
const metros = (lat1, lon1, lat2, lon2) => Math.hypot((lat1 - lat2) * 111195, (lon1 - lon2) * 111195 * Math.cos(lat1 * Math.PI / 180));
const gms = (g, m, s, h) => ({ g: g, m: m, s: s, h: h });
const eje = (lat, lon) => ({ lat: lat, lon: lon });
const MENDOZA_CIUDAD = eje(gms(32, 53, 10.2, 'S'), gms(68, 50, 25.4, 'O'));          // ejemplo del pedido (zona de la ciudad de Mendoza)

describe('contrato numerico contra pyproj (fixture)', () => {
  test('el fixture es el esperado: EPSG:22182 -> EPSG:4326, x = Este, y = Norte, con vectores suficientes', () => {
    expect(fixture.meta.crs).toBe('EPSG:22182');
    expect(fixture.meta.destino).toBe('EPSG:4326');
    expect(fixture.meta.ejes).toMatch(/Este/);
    expect(fixture.posgar.length).toBeGreaterThanOrEqual(50);
    expect(fixture.gms.length).toBeGreaterThanOrEqual(10);
  });

  test('POSGAR -> WGS84: el error contra pyproj es menor a 1 mm en TODOS los vectores', () => {
    let max = 0;
    fixture.posgar.forEach((v) => {
      const r = C.coordenadas_posgarAWgs84(v.x, v.y);
      max = Math.max(max, metros(r.lat, r.lon, v.lat, v.lon));
    });
    expect(max).toBeLessThan(0.001);
  });

  test('cada vector, uno por uno (mensaje claro si alguno falla)', () => {
    fixture.posgar.forEach((v) => {
      const r = C.coordenadas_posgarAWgs84(v.x, v.y);
      expect({ x: v.x, y: v.y, errorM: metros(r.lat, r.lon, v.lat, v.lon) < 0.001 }).toEqual({ x: v.x, y: v.y, errorM: true });
    });
  });

  test('WGS84 -> POSGAR (inversa) tambien coincide con pyproj a menos de 1 mm', () => {
    let max = 0;
    fixture.posgar.forEach((v) => {
      const r = C.coordenadas_wgs84APosgar(v.lat, v.lon);
      max = Math.max(max, Math.hypot(r.este - v.x, r.norte - v.y));
    });
    expect(max).toBeLessThan(0.001);
  });

  test('ida y vuelta POSGAR -> WGS84 -> POSGAR conserva el punto (< 0,1 mm)', () => {
    fixture.posgar.forEach((v) => {
      const w = C.coordenadas_posgarAWgs84(v.x, v.y);
      const p = C.coordenadas_wgs84APosgar(w.lat, w.lon);
      expect(Math.hypot(p.este - v.x, p.norte - v.y)).toBeLessThan(0.0001);
    });
  });

  test('GMS -> decimal coincide con la aritmetica EXACTA del fixture (< 1e-12 grados) en todos los casos', () => {
    fixture.gms.forEach((v) => {
      const la = C.coordenadas_gmsEjeADecimal('lat', v.lat);
      const lo = C.coordenadas_gmsEjeADecimal('lon', v.lon);
      expect(la.ok && lo.ok).toBe(true);
      expect(Math.abs(la.valor - v.latDecimal)).toBeLessThan(1e-12);
      expect(Math.abs(lo.valor - v.lonDecimal)).toBeLessThan(1e-12);
    });
  });

  test('la ecuacion de la conversion usa los mismos parametros que EPSG:22182 (meridiano central, falso este, GRS80)', () => {
    const centro = C.coordenadas_posgarAWgs84(2500000, 6350000);
    expect(centro.lon).toBeCloseTo(-69, 9);                                  // en el meridiano central
    expect(centro.lat).toBeCloseTo(-32.99294605169676, 8);                   // valor de pyproj
    expect(C.coordenadas_posgarAWgs84(2500000, 6000000).lon).toBeCloseTo(-69, 9);
    expect(C.coordenadas_posgarAWgs84(2600000, 6350000).lon).toBeGreaterThan(-69);        // mas Este = mas cerca de 0 (menos negativo)
    expect(C.coordenadas_posgarAWgs84(2400000, 6350000).lon).toBeLessThan(-69);
  });
});

describe('vectores conocidos', () => {
  test.each([
    [2500000, 6350000, -32.992946, -69.0],
    [2500000, 6000000, -36.148008, -69.0],
    [2300000, 5800000, -37.928166, -71.274698],
    [2800000, 6500000, -31.601156, -65.839502],
    [2300000, 6500000, -31.622883, -71.107758],
    [2800000, 5800000, -37.90071, -65.589499]
  ])('POSGAR (%p, %p) -> lat %p, lon %p (6 decimales, como pyproj)', (x, y, lat, lon) => {
    const r = C.coordenadas_posgarAWgs84(x, y);
    expect(C.coordenadas_redondear(r.lat, 6)).toBeCloseTo(lat, 5);
    expect(C.coordenadas_redondear(r.lon, 6)).toBeCloseTo(lon, 5);
  });

  test('GMS 32° 53\' 10.2" S, 68° 50\' 25.4" O -> -32.886167, -68.840389', () => {
    const r = C.coordenadas_evaluarGms(MENDOZA_CIUDAD);
    expect(r).toMatchObject({ ok: true, lat: -32.886167, lon: -68.840389, crsOriginal: 'GMS_WGS84' });
    expect(r.textoOriginal).toBe('32° 53\' 10.2" S, 68° 50\' 25.4" O');
  });

  test('pozo 14-0001 del padron (-33.34765, -69.14545) en GMS y en POSGAR da el mismo punto (diferencia de GMS redondeado a 0,01")', () => {
    const g = C.coordenadas_evaluarGms(eje(gms(33, 20, 51.54, 'S'), gms(69, 8, 43.62, 'O')));
    expect(g.lat).toBeCloseTo(-33.34765, 5);
    expect(g.lon).toBeCloseTo(-69.14545, 5);
    const p = C.coordenadas_wgs84APosgar(-33.34765, -69.14545);
    const r = C.coordenadas_evaluarPosgar({ x: p.este, y: p.norte });
    expect(metros(r.lat, r.lon, -33.34765, -69.14545)).toBeLessThan(0.2);          // el redondeo a 6 decimales (~0,11 m)
  });

  test('POSGAR del padron (2500000, 6350000): texto canonico y CRS de auditoria', () => {
    const r = C.coordenadas_evaluarPosgar({ x: 2500000, y: 6350000 });
    expect(r).toMatchObject({ ok: true, lat: -32.992946, lon: -69, crsOriginal: 'EPSG:22182', invertido: false });
    expect(r.textoOriginal).toBe('X(Este)=2500000.00, Y(Norte)=6350000.00');
  });
});

describe('parsearNumero', () => {
  const p = (t, o) => C.coordenadas_parsearNumero(t, o);

  test.each([
    ['10.2', 10.2], ['10,2', 10.2], ['  10 , 2 '.replace(/ /g, ''), 10.2], ['0', 0], ['007', 7], ['.5', 0.5], [',5', 0.5], ['5.', 5], ['5,', 5], ['+3', 3], ['-3', -3], [' 59.999 ', 59.999], [12, 12], [0.5, 0.5]
  ])('acepta %p -> %p', (entrada, valor) => {
    expect(p(entrada)).toEqual({ ok: true, valor: valor });
  });

  test.each([[''], ['   '], [null], [undefined]])('vacio: %p', (e) => {
    expect(p(e)).toEqual({ ok: false, motivo: 'vacio' });
  });

  test.each([['abc'], ['1e3'], ['1,2,3'], ['1.2.3'], ['--3'], ['3-'], ['NaN'], ['Infinity'], ['0x10'], ['12 abc'], ['１２'], [NaN], [Infinity], [-Infinity], [{}], [[]], [true]])('invalido: %p', (e) => {
    expect(p(e)).toMatchObject({ ok: false, motivo: 'invalido' });
  });

  test('en GMS el punto SIEMPRE es decimal: "1.234" son 1,234 (sin separador de miles)', () => {
    expect(p('1.234')).toEqual({ ok: true, valor: 1.234 });
    expect(p('1.234', { permitirMiles: false })).toEqual({ ok: true, valor: 1.234 });
  });

  test('en POSGAR (metros) con permitirMiles: "2.500.000,50" = 2500000,5; el punto decimal sigue valiendo', () => {
    const o = { permitirMiles: true };
    expect(p('2.500.000,50', o)).toEqual({ ok: true, valor: 2500000.5 });
    expect(p('2.500.000', o)).toEqual({ ok: true, valor: 2500000 });
    expect(p('6.350.000', o)).toEqual({ ok: true, valor: 6350000 });
    expect(p('2500000.5', o)).toEqual({ ok: true, valor: 2500000.5 });
    expect(p('2500000,5', o)).toEqual({ ok: true, valor: 2500000.5 });
    expect(p('2500000', o)).toEqual({ ok: true, valor: 2500000 });
    expect(p('2 500 000', o)).toEqual({ ok: true, valor: 2500000 });
    expect(p('2.500.00', o)).toMatchObject({ ok: false });            // miles mal agrupados
    expect(p('2,500.000', o)).toMatchObject({ ok: false });
  });
});

describe('GMS', () => {
  const evaluar = (la, lo) => C.coordenadas_evaluarGms(eje(la, lo));
  const OK_LON = gms(68, 50, 25.4, 'O');
  const OK_LAT = gms(32, 53, 10.2, 'S');
  const err = (r, ejeNombre) => r.errores[ejeNombre];

  describe('validos', () => {
    test('conversion conocida y valores con 6 decimales', () => {
      const r = evaluar(OK_LAT, OK_LON);
      expect(r.ok).toBe(true);
      expect(r.lat).toBe(-32.886167);
      expect(r.lon).toBe(-68.840389);
    });

    test('segundos con coma o con punto decimal dan lo mismo', () => {
      const a = evaluar(gms(32, 53, '10,2', 'S'), gms(68, 50, '25,4', 'O'));
      const b = evaluar(gms(32, 53, '10.2', 'S'), gms(68, 50, '25.4', 'O'));
      expect(a.ok && b.ok).toBe(true);
      expect(a.lat).toBe(b.lat);
      expect(a.lon).toBe(b.lon);
      expect(a.textoOriginal).toBe(b.textoOriginal);
    });

    test('minutos y segundos vacios (o ausentes) valen 0; los grados son obligatorios', () => {
      const r = evaluar({ g: '33', m: '', s: '', h: 'S' }, { g: 69, h: 'O' });
      expect(r).toMatchObject({ ok: true, lat: -33, lon: -69 });
      expect(r.textoOriginal).toBe('33° 0\' 0" S, 69° 0\' 0" O');
    });

    test('valores como numeros o como texto', () => {
      expect(evaluar(gms('32', '53', '10.2', 'S'), gms('68', '50', '25.4', 'O')).lat).toBe(-32.886167);
      expect(evaluar(gms(32, 53, 10.2, 'S'), gms(68, 50, 25.4, 'O')).lat).toBe(-32.886167);
    });

    test('hemisferio en mayuscula, minuscula, con espacios y alias (W, Sur, Oeste)', () => {
      ['s', 'S', ' s ', 'Sur', 'SUR', 'sur'].forEach((h) => expect(evaluar(gms(32, 53, 10.2, h), OK_LON).lat).toBe(-32.886167));
      ['o', 'O', 'w', 'W', 'Oeste', 'oeste', ' O '].forEach((h) => expect(evaluar(OK_LAT, gms(68, 50, 25.4, h)).lon).toBe(-68.840389));
    });

    test('segundos justo por debajo de 60 y minutos 59 son validos', () => {
      expect(C.coordenadas_gmsEjeADecimal('lat', gms(33, 59, 59.9999, 'S')).ok).toBe(true);
      expect(C.coordenadas_gmsEjeADecimal('lat', gms(33, 59, 59.999999999, 'S')).ok).toBe(true);
    });

    test('el texto canonico normaliza (segundos hasta 4 decimales; hemisferio en letra O para Oeste)', () => {
      expect(evaluar(gms(32, 53, '10,20', 's'), gms(68, 50, 25.123456, 'w')).textoOriginal).toBe('32° 53\' 10.2" S, 68° 50\' 25.1235" O');
    });

    test('ida y vuelta decimal -> GMS -> decimal', () => {
      [-32.886167, -68.840389, -33.34765, -69.14545, -37.6499, -70.6499, -31.9501, -66.4501, -0.0001].forEach((d) => {
        const eje1 = Math.abs(d) > 60 || d === -70.6499 ? 'lon' : 'lat';
        const x = C.coordenadas_decimalAGms(d, eje1);
        const back = C.coordenadas_gmsEjeADecimal(eje1, x);
        expect(back.ok).toBe(true);
        expect(Math.abs(back.valor - d)).toBeLessThan(2e-8);        // 4 decimales de segundo = 3e-8 grados
      });
    });

    test('decimalAGms nunca produce 60 segundos ni 60 minutos', () => {
      const x = C.coordenadas_decimalAGms(-32.99999999, 'lat');
      expect(x.s).toBeLessThan(60);
      expect(x.m).toBeLessThan(60);
      expect(C.coordenadas_decimalAGms(-33.9999999999, 'lat')).toEqual({ g: 34, m: 0, s: 0, h: 'S' });
    });
  });

  describe('invalidos', () => {
    test('grados vacios o no numericos', () => {
      expect(err(evaluar(gms('', 53, 10, 'S'), OK_LON), 'lat')).toMatchObject({ campo: 'g', codigo: 'GRADOS_REQUERIDOS' });
      expect(err(evaluar(gms(null, 53, 10, 'S'), OK_LON), 'lat').codigo).toBe('GRADOS_REQUERIDOS');
      expect(err(evaluar(OK_LAT, gms('abc', 50, 25, 'O')), 'lon')).toMatchObject({ campo: 'g', codigo: 'GRADOS_INVALIDOS' });
      expect(evaluar(gms('', 53, 10, 'S'), OK_LON).ok).toBe(false);
    });

    test('minutos mayores a 59 (60, 61, 99)', () => {
      [60, 61, 99, '60'].forEach((m) => expect(err(evaluar(gms(32, m, 10, 'S'), OK_LON), 'lat')).toMatchObject({ campo: 'm', codigo: 'MINUTOS_FUERA_DE_RANGO' }));
    });

    test('segundos >= 60 (60, 60.0, 60,5, 75)', () => {
      [60, '60.0', '60,5', 75, 120].forEach((s) => expect(err(evaluar(gms(32, 53, s, 'S'), OK_LON), 'lat')).toMatchObject({ campo: 's', codigo: 'SEGUNDOS_FUERA_DE_RANGO' }));
    });

    test('grados o minutos con decimales (los decimales van en los segundos)', () => {
      expect(err(evaluar(gms('32.5', 53, 10, 'S'), OK_LON), 'lat').codigo).toBe('GRADOS_NO_ENTEROS');
      expect(err(evaluar(gms('32,5', 53, 10, 'S'), OK_LON), 'lat').codigo).toBe('GRADOS_NO_ENTEROS');
      expect(err(evaluar(gms(32, '53.5', 10, 'S'), OK_LON), 'lat').codigo).toBe('MINUTOS_NO_ENTEROS');
    });

    test('negativos inesperados: el signo lo da SOLO el hemisferio', () => {
      [-32, '-32', ' -32', '-0', '-32,0'].forEach((g) => expect(err(evaluar(gms(g, 53, 10, 'S'), OK_LON), 'lat')).toMatchObject({ campo: 'g', codigo: 'NEGATIVO' }));
      expect(err(evaluar(gms(32, -53, 10, 'S'), OK_LON), 'lat')).toMatchObject({ campo: 'm', codigo: 'NEGATIVO' });
      expect(err(evaluar(gms(32, 53, '-10.2', 'S'), OK_LON), 'lat')).toMatchObject({ campo: 's', codigo: 'NEGATIVO' });
      expect(err(evaluar(OK_LAT, gms(-68, 50, 25.4, 'O')), 'lon').codigo).toBe('NEGATIVO');
      expect(err(evaluar(gms(-32, 53, 10, 'N'), OK_LON), 'lat').mensaje).toMatch(/hemisferio/);
    });

    test('hemisferio faltante o que no corresponde al eje', () => {
      expect(err(evaluar(gms(32, 53, 10, ''), OK_LON), 'lat')).toMatchObject({ campo: 'h', codigo: 'HEMISFERIO_REQUERIDO' });
      expect(err(evaluar(gms(32, 53, 10, undefined), OK_LON), 'lat').codigo).toBe('HEMISFERIO_REQUERIDO');
      expect(err(evaluar(gms(32, 53, 10, 'E'), OK_LON), 'lat')).toMatchObject({ campo: 'h', codigo: 'HEMISFERIO_INVALIDO' });       // E no es de latitud
      expect(err(evaluar(gms(32, 53, 10, 'O'), OK_LON), 'lat').codigo).toBe('HEMISFERIO_INVALIDO');
      expect(err(evaluar(OK_LAT, gms(68, 50, 25, 'N')), 'lon')).toMatchObject({ campo: 'h', codigo: 'HEMISFERIO_INVALIDO' });       // N no es de longitud
      expect(err(evaluar(OK_LAT, gms(68, 50, 25, 'S')), 'lon').codigo).toBe('HEMISFERIO_INVALIDO');
      expect(err(evaluar(gms(32, 53, 10, 'X'), OK_LON), 'lat').codigo).toBe('HEMISFERIO_INVALIDO');
      expect(err(evaluar(gms(32, 53, 10, 5), OK_LON), 'lat').codigo).toBe('HEMISFERIO_REQUERIDO');
    });

    test('latitud mayor a 90 y longitud mayor a 180 (incluidos 90°0\'1" y 180°0\'0.1")', () => {
      expect(err(evaluar(gms(91, 0, 0, 'S'), OK_LON), 'lat').codigo).toBe('GRADOS_FUERA_DE_RANGO');
      expect(err(evaluar(gms(90, 0, 1, 'S'), OK_LON), 'lat').codigo).toBe('FUERA_DE_RANGO');
      expect(err(evaluar(OK_LAT, gms(181, 0, 0, 'O')), 'lon').codigo).toBe('GRADOS_FUERA_DE_RANGO');
      expect(err(evaluar(OK_LAT, gms(180, 0, 0.1, 'O')), 'lon').codigo).toBe('FUERA_DE_RANGO');
    });

    test('un eje invalido no oculta al otro: se informan los dos', () => {
      const r = evaluar(gms(32, 61, 10, 'S'), gms(68, 50, 70, 'O'));
      expect(r.ok).toBe(false);
      expect(r.errores.lat.campo).toBe('m');
      expect(r.errores.lon.campo).toBe('s');
      expect(r.lat).toBeUndefined();
      expect(r.textoOriginal).toBeUndefined();
    });

    test('entrada ausente o rara nunca lanza', () => {
      [undefined, null, {}, { lat: null, lon: null }, { lat: 5, lon: 'x' }, 'texto', 42, []].forEach((e) => {
        let r;
        expect(() => { r = C.coordenadas_evaluarGms(e); }).not.toThrow();
        expect(r.ok).toBe(false);
      });
    });
  });

  describe('hemisferios y punto fuera de Mendoza', () => {
    test('latitud N en vez de S: fuera de Mendoza, con sugerencia de revisar la latitud', () => {
      const r = evaluar(gms(32, 53, 10.2, 'N'), OK_LON);
      expect(r.ok).toBe(false);
      expect(r.errores.general).toMatchObject({ codigo: 'FUERA_DE_MENDOZA', sugerencia: { lat: true, lon: false } });
      expect(r.errores.general.mensaje).toMatch(/Revisá el hemisferio.*Sur \(S\).*Oeste \(O\)/);
      expect(r.lat).toBe(32.886167);                       // se informa el punto leido, pero NO se acepta
    });

    test('longitud E en vez de O: sugerencia de revisar la longitud', () => {
      const r = evaluar(OK_LAT, gms(68, 50, 25.4, 'E'));
      expect(r.ok).toBe(false);
      expect(r.errores.general.sugerencia).toEqual({ lat: false, lon: true });
    });

    test('los dos hemisferios al reves: sugerencia de revisar ambos', () => {
      const r = evaluar(gms(32, 53, 10.2, 'N'), gms(68, 50, 25.4, 'E'));
      expect(r.errores.general.sugerencia).toEqual({ lat: true, lon: true });
    });

    test('NUNCA se corrige el hemisferio en silencio', () => {
      const r = evaluar(gms(32, 53, 10.2, 'N'), OK_LON);
      expect(r.ok).toBe(false);
      expect(r.lat).toBeGreaterThan(0);
    });

    test('un punto claramente ajeno (Buenos Aires, Santiago, el oceano) esta fuera de Mendoza, sin hablar de hemisferios', () => {
      [[gms(34, 36, 13, 'S'), gms(58, 22, 54, 'O')], [gms(33, 26, 56, 'S'), gms(70, 40, 10, 'O')], [gms(35, 0, 0, 'S'), gms(40, 0, 0, 'O')]].forEach(([la, lo]) => {
        const r = evaluar(la, lo);
        expect(r.ok).toBe(false);
        expect(r.errores.general.codigo).toBe('FUERA_DE_MENDOZA');
        expect(r.errores.general.sugerencia).toBeNull();
        expect(r.errores.general.mensaje).not.toMatch(/hemisferio/);
      });
    });

    test('los bordes de la caja de Mendoza son validos y apenas afuera no', () => {
      expect(evaluar(gms(37, 39, 0, 'S'), gms(70, 38, 59.9, 'O')).ok).toBe(true);        // -37.65, -70.6499722
      expect(evaluar(gms(37, 39, 1, 'S'), gms(70, 30, 0, 'O')).ok).toBe(false);          // un segundo mas al sur de -37.65
      expect(evaluar(gms(31, 57, 0, 'S'), gms(66, 27, 0, 'O')).ok).toBe(true);           // -31.95, -66.45
      expect(evaluar(gms(31, 56, 59, 'S'), gms(66, 30, 0, 'O')).ok).toBe(false);
    });
  });

  test('el texto canonico y el CRS de auditoria (GMS_WGS84) estan en el resultado valido', () => {
    const r = evaluar(OK_LAT, OK_LON);
    expect(r.crsOriginal).toBe('GMS_WGS84');
    expect(C.COORD_CRS_GMS).toBe('GMS_WGS84');
    expect(r.textoOriginal).toBe('32° 53\' 10.2" S, 68° 50\' 25.4" O');
  });
});

describe('POSGAR 94 / Argentina 2 · EPSG:22182', () => {
  const evaluar = (x, y) => C.coordenadas_evaluarPosgar({ x: x, y: y });

  describe('validos', () => {
    test('conversion conocida, texto canonico y CRS', () => {
      const r = evaluar(2500000, 6350000);
      expect(r).toMatchObject({ ok: true, lat: -32.992946, lon: -69, invertido: false, crsOriginal: 'EPSG:22182', textoOriginal: 'X(Este)=2500000.00, Y(Norte)=6350000.00' });
      expect(C.COORD_CRS_POSGAR94_AR2).toBe('EPSG:22182');
      expect(C.COORD_POSGAR_ETIQUETA).toBe('POSGAR 94 / Argentina 2 · EPSG:22182');
    });

    test('numeros o texto, con punto o coma decimal y con puntos de miles', () => {
      const base = evaluar(2400123.45, 6200456.78);
      ['2400123.45', '2400123,45', '2.400.123,45', ' 2 400 123,45 '].forEach((x) => {
        const r = evaluar(x, '6200456,78');
        expect(r.ok).toBe(true);
        expect(r.lat).toBe(base.lat);
        expect(r.lon).toBe(base.lon);
        expect(r.textoOriginal).toBe('X(Este)=2400123.45, Y(Norte)=6200456.78');
      });
    });

    test('los metros se guardan en el texto con 2 decimales (redondeo estandar)', () => {
      expect(evaluar('2500000.006', '6350000.004').textoOriginal).toBe('X(Este)=2500000.01, Y(Norte)=6350000.00');
      expect(evaluar(2500000, 6350000.1).textoOriginal).toBe('X(Este)=2500000.00, Y(Norte)=6350000.10');
    });

    test('todos los vectores del fixture que caen en Mendoza se aceptan y dan lat/lon con 6 decimales', () => {
      let aceptados = 0;
      fixture.posgar.forEach((v) => {
        const r = evaluar(v.x, v.y);
        if (C.coordenadas_dentroDeMendoza(v.lat, v.lon)) {
          expect(r.ok).toBe(true);
          expect(metros(r.lat, r.lon, v.lat, v.lon)).toBeLessThan(0.2);      // el redondeo a 6 decimales (~0,11 m)
          aceptados += 1;
        } else {
          expect(r.ok).toBe(false);
          expect(r.errores.general.codigo).toBe('FUERA_DE_MENDOZA');
        }
      });
      expect(aceptados).toBeGreaterThan(30);
    });

    test('los rangos de sanidad contienen TODA la caja de Mendoza: ningun punto valido se rechaza por rango', () => {
      const b = C.COORD_MENDOZA_BBOX;
      for (let i = 0; i <= 60; i++) {
        for (let j = 0; j <= 60; j++) {
          if (i > 0 && i < 60 && j > 0 && j < 60) { continue; }
          const p = C.coordenadas_wgs84APosgar(b.latMin + (b.latMax - b.latMin) * i / 60, b.lonMin + (b.lonMax - b.lonMin) * j / 60);
          expect(p.este).toBeGreaterThanOrEqual(C.COORD_POSGAR_ESTE_MIN);
          expect(p.este).toBeLessThanOrEqual(C.COORD_POSGAR_ESTE_MAX);
          expect(p.norte).toBeGreaterThanOrEqual(C.COORD_POSGAR_NORTE_MIN);
          expect(p.norte).toBeLessThanOrEqual(C.COORD_POSGAR_NORTE_MAX);
        }
      }
    });

    test('limites de rango inclusivos', () => {
      expect(C.coordenadas_evaluarPosgar({ x: C.COORD_POSGAR_ESTE_MIN, y: 6200000 }).errores.x).toBeUndefined();
      expect(C.coordenadas_evaluarPosgar({ x: C.COORD_POSGAR_ESTE_MAX, y: 6200000 }).errores.x).toBeUndefined();
      expect(C.coordenadas_evaluarPosgar({ x: 2500000, y: C.COORD_POSGAR_NORTE_MIN }).errores.y).toBeUndefined();
      expect(C.coordenadas_evaluarPosgar({ x: 2500000, y: C.COORD_POSGAR_NORTE_MAX }).errores.y).toBeUndefined();
    });
  });

  describe('invalidos', () => {
    test('vacios y no numericos, por campo', () => {
      expect(evaluar('', 6350000).errores.x).toMatchObject({ codigo: 'ESTE_REQUERIDO' });
      expect(evaluar(2500000, '').errores.y).toMatchObject({ codigo: 'NORTE_REQUERIDO' });
      expect(evaluar(null, undefined).errores).toMatchObject({ x: { codigo: 'ESTE_REQUERIDO' }, y: { codigo: 'NORTE_REQUERIDO' } });
      expect(evaluar('abc', 6350000).errores.x).toMatchObject({ codigo: 'ESTE_INVALIDO' });
      expect(evaluar(2500000, '63x').errores.y).toMatchObject({ codigo: 'NORTE_INVALIDO' });
      expect(evaluar('1e6', '6e6').ok).toBe(false);
      expect(evaluar(NaN, Infinity).ok).toBe(false);
      expect(evaluar('', 6350000).ok).toBe(false);
    });

    test('valores fuera de rango (cada campo por separado), con el rango en el mensaje', () => {
      const bajo = evaluar(2299999, 6350000);
      expect(bajo.ok).toBe(false);
      expect(bajo.errores.x).toMatchObject({ codigo: 'ESTE_FUERA_DE_RANGO' });
      expect(bajo.errores.x.mensaje).toMatch(/2\.300\.000 y 2\.800\.000/);
      expect(evaluar(2800001, 6350000).errores.x.codigo).toBe('ESTE_FUERA_DE_RANGO');
      expect(evaluar(2500000, 5799999).errores.y).toMatchObject({ codigo: 'NORTE_FUERA_DE_RANGO' });
      expect(evaluar(2500000, 5799999).errores.y.mensaje).toMatch(/5\.800\.000 y 6\.500\.000/);
      expect(evaluar(2500000, 6500001).errores.y.codigo).toBe('NORTE_FUERA_DE_RANGO');
      const ambos = evaluar(100, 100);
      expect(ambos.errores.x.codigo).toBe('ESTE_FUERA_DE_RANGO');
      expect(ambos.errores.y.codigo).toBe('NORTE_FUERA_DE_RANGO');
      expect(evaluar(9e9, 9e9).ok).toBe(false);
    });

    test('negativos', () => {
      const r = evaluar(-2500000, -6350000);
      expect(r.ok).toBe(false);
      expect(r.errores.general.codigo).toBe('NEGATIVO');
      expect(evaluar(-2500000, 6350000).ok).toBe(false);
    });

    test('un valor valido y otro invalido: se informa solo el invalido y no se convierte', () => {
      const r = evaluar(2500000, 'xx');
      expect(r.ok).toBe(false);
      expect(r.errores.x).toBeUndefined();
      expect(r.errores.y).toBeDefined();
      expect(r.lat).toBeUndefined();
    });
  });

  describe('X/Y invertidos', () => {
    test('Este y Norte intercambiados: se detecta con certeza y se SUGIERE el intercambio (no se aplica)', () => {
      const r = evaluar(6350000, 2500000);
      expect(r.ok).toBe(false);
      expect(r.invertido).toBe(true);
      expect(r.errores.general.codigo).toBe('XY_INVERTIDOS');
      expect(r.errores.general.mensaje).toMatch(/X es el Este.*Y es el Norte/);
      expect(r.sugerencia).toEqual({ x: 2500000, y: 6350000 });
      expect(r.lat).toBeUndefined();
    });

    test('con texto y puntos de miles tambien', () => {
      const r = evaluar('6.350.000,5', '2.500.000');
      expect(r.invertido).toBe(true);
      expect(r.sugerencia).toEqual({ x: 2500000, y: 6350000.5 });
    });

    test('aplicar la sugerencia da un punto valido', () => {
      const r = evaluar(6350000, 2500000);
      expect(evaluar(r.sugerencia.x, r.sugerencia.y).ok).toBe(true);
    });

    test('la deteccion es inequivoca: ningun par valido de Mendoza se confunde con uno invertido, y viceversa', () => {
      fixture.posgar.forEach((v) => {
        expect(evaluar(v.x, v.y).invertido).toBe(false);
        expect(evaluar(v.y, v.x).invertido).toBe(true);
      });
    });

    test('solo UN valor en el rango del otro eje no se considera inversion (es fuera de rango comun)', () => {
      const r = evaluar(6350000, 6350000);
      expect(r.invertido).toBe(false);
      expect(r.errores.x.codigo).toBe('ESTE_FUERA_DE_RANGO');
    });
  });

  describe('punto fuera de Mendoza', () => {
    test('dentro del rango de sanidad pero fuera de la caja de Mendoza: FUERA_DE_MENDOZA', () => {
      const r = evaluar(2300000, 5800000);                           // ~ -37.93, -71.27
      expect(r.ok).toBe(false);
      expect(r.errores.general).toMatchObject({ codigo: 'FUERA_DE_MENDOZA', sugerencia: null });
      expect(r.lat).toBeLessThan(-37.65);
      const r2 = evaluar(2800000, 6500000);                          // ~ -31.62, -66.26
      expect(r2.ok).toBe(false);
      expect(r2.errores.general.codigo).toBe('FUERA_DE_MENDOZA');
    });

    test('el mensaje no habla de hemisferios (no aplica a POSGAR) cuando no hay sugerencia', () => {
      expect(evaluar(2300000, 5800000).errores.general.mensaje).toBe('La ubicación queda fuera de Mendoza.');
    });
  });

  test('entrada ausente o rara nunca lanza', () => {
    [undefined, null, {}, { x: {}, y: [] }, 'texto', 7, []].forEach((e) => {
      let r;
      expect(() => { r = C.coordenadas_evaluarPosgar(e); }).not.toThrow();
      expect(r.ok).toBe(false);
    });
  });
});

describe('consistencia con el resto del proyecto', () => {
  test('la caja de Mendoza es la MISMA que usa el backend', () => {
    const S = require('../backend/src/UbicacionCorreccionService');
    expect(C.COORD_MENDOZA_BBOX).toEqual(S.UBICACION_CORR_MENDOZA_BBOX);
    const L = require('./ubicacionCorreccionLogic');
    expect(C.coordenadas_dentroDeMendoza(-32.9, -68.8)).toBe(S.ubicacionCorreccionService_dentroDeMendoza(-32.9, -68.8));
    [[-31.95, -66.45], [-37.65, -70.65], [-31.9499, -66.4499], [-37.6501, -70.6501], [0, 0], [-34.6, -58.4], [NaN, -68]].forEach(([la, lo]) => {
      expect(C.coordenadas_dentroDeMendoza(la, lo)).toBe(S.ubicacionCorreccionService_dentroDeMendoza(la, lo) && isFinite(la) && isFinite(lo));
    });
    expect(typeof L).toBe('object');
  });

  test('el redondeo a 6 decimales es el del backend (lat/lon con 0,11 m)', () => {
    expect(C.coordenadas_redondear(-32.88616666666667, 6)).toBe(-32.886167);
    expect(C.coordenadas_redondear(-68.84038888888889, 6)).toBe(-68.840389);
  });

  test('el modulo es puro: sin DOM, red, almacenamiento ni librerias', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'coordenadasConversion.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(fuente).not.toMatch(/\b(document|window|navigator|fetch|XMLHttpRequest|localStorage|sessionStorage|require\(|import )/);
    expect(fuente).not.toMatch(/proj4/i);
  });

  test('todas las funciones publicas tienen el prefijo coordenadas_ (espacio de nombres compartido con Apps Script y la pagina)', () => {
    Object.keys(C).filter((k) => typeof C[k] === 'function').forEach((k) => expect(k).toMatch(/^coordenadas_/));
  });

  test('peso: el modulo es chico (< 20 KB sin minificar, comentarios incluidos) frente a proj4js (126 KB min)', () => {
    expect(fs.statSync(path.join(__dirname, 'coordenadasConversion.js')).size).toBeLessThan(20 * 1024);
  });
});
