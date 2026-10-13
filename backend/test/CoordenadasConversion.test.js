// Modulo de conversion de coordenadas del BACKEND (backend/src/CoordenadasConversion.js). Tres garantias:
//  1) CONTRATO NUMERICO contra el fixture generado con pyproj (js/fixtures/posgar94_ar2_vectores.json): el mismo que usa el frontend.
//  2) PARIDAD con el modulo del frontend (js/coordenadasConversion.js): mismas respuestas, bit a bit, ante entradas validas e invalidas.
//  3) NO DERIVA: el codigo (sin comentarios) de las dos copias es identico; si alguien toca una y no la otra, falla aca.
const fs = require('fs');
const path = require('path');
const Back = require('../src/CoordenadasConversion');
const Front = require('../../js/coordenadasConversion');
const Servicio = require('../src/UbicacionCorreccionService');
const fixture = require('../../js/fixtures/posgar94_ar2_vectores.json');

const raiz = path.join(__dirname, '..', '..');
const fuenteBack = fs.readFileSync(path.join(raiz, 'backend', 'src', 'CoordenadasConversion.js'), 'utf8');
const fuenteFront = fs.readFileSync(path.join(raiz, 'js', 'coordenadasConversion.js'), 'utf8');

const METROS_POR_GRADO_LAT = 111195;
function errorMetros(lat1, lon1, lat2, lon2) {
  const dn = (lat1 - lat2) * METROS_POR_GRADO_LAT;
  const de = (lon1 - lon2) * METROS_POR_GRADO_LAT * Math.cos(lat1 * Math.PI / 180);
  return Math.hypot(dn, de);
}

describe('contrato numerico contra pyproj (fixture compartido con el frontend)', () => {
  test('el fixture es el generado por pyproj para EPSG:22182 -> EPSG:4326 con x = Este', () => {
    expect(fixture.meta.crs).toBe('EPSG:22182');
    expect(fixture.meta.destino).toBe('EPSG:4326');
    expect(fixture.meta.ejes).toMatch(/Este/);
    expect(fixture.posgar.length).toBeGreaterThanOrEqual(50);
    expect(fixture.gms.length).toBeGreaterThanOrEqual(10);
  });

  test('EPSG:22182 -> WGS84: error maximo < 1 mm en TODOS los vectores (sin redondear)', () => {
    let max = 0;
    fixture.posgar.forEach((v) => {
      const r = Back.coordenadas_posgarAWgs84(v.x, v.y);
      max = Math.max(max, errorMetros(r.lat, r.lon, v.lat, v.lon));
    });
    expect(max).toBeLessThan(0.001);
  });

  test('WGS84 -> EPSG:22182 (inversa): error maximo < 1 mm y la ida y vuelta no se mueve', () => {
    let maxInversa = 0;
    let maxVuelta = 0;
    fixture.posgar.forEach((v) => {
      const p = Back.coordenadas_wgs84APosgar(v.lat, v.lon);
      maxInversa = Math.max(maxInversa, Math.hypot(p.este - v.x, p.norte - v.y));
      const r = Back.coordenadas_posgarAWgs84(v.x, v.y);
      const ida = Back.coordenadas_wgs84APosgar(r.lat, r.lon);
      maxVuelta = Math.max(maxVuelta, Math.hypot(ida.este - v.x, ida.norte - v.y));
    });
    expect(maxInversa).toBeLessThan(0.001);
    expect(maxVuelta).toBeLessThan(0.001);
  });

  test('evaluarPosgar con el valor de cada vector da el lat/lon de pyproj redondeado a 6 decimales (11 cm) y el texto canonico', () => {
    fixture.posgar.forEach((v) => {
      const r = Back.coordenadas_evaluarPosgar({ x: v.x, y: v.y });
      expect(r.crsOriginal).toBe('EPSG:22182');
      expect(r.textoOriginal).toBe('X(Este)=' + v.x.toFixed(2) + ', Y(Norte)=' + v.y.toFixed(2));
      if (r.ok) {
        expect(Math.abs(r.lat - v.lat)).toBeLessThanOrEqual(5.1e-7);
        expect(Math.abs(r.lon - v.lon)).toBeLessThanOrEqual(5.1e-7);
      } else {
        // los vectores de borde del rango de sanidad pueden caer fuera de la caja de Mendoza: ahi el rechazo es la respuesta correcta
        expect(r.errores.general.codigo).toBe('FUERA_DE_MENDOZA');
      }
    });
  });

  test('GMS -> decimal: coincide con la aritmetica exacta del fixture (< 1e-9 grados)', () => {
    fixture.gms.forEach((v) => {
      const la = Back.coordenadas_gmsEjeADecimal('lat', v.lat);
      const lo = Back.coordenadas_gmsEjeADecimal('lon', v.lon);
      expect(la.ok).toBe(true);
      expect(lo.ok).toBe(true);
      expect(Math.abs(la.valor - v.latDecimal)).toBeLessThan(1e-9);
      expect(Math.abs(lo.valor - v.lonDecimal)).toBeLessThan(1e-9);
    });
  });

  test('vectores conocidos', () => {
    const c = Back.coordenadas_evaluarPosgar({ x: 2500000, y: 6350000 });
    expect(c).toMatchObject({ ok: true, lat: -32.992946, lon: -69, textoOriginal: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182' });
    const g = Back.coordenadas_evaluarGms({ lat: { g: 32, m: 53, s: 10.2, h: 'S' }, lon: { g: 68, m: 50, s: 25.4, h: 'O' } });
    expect(g).toMatchObject({ ok: true, lat: -32.886167, lon: -68.840389, crsOriginal: 'GMS_WGS84' });
    expect(g.textoOriginal).toBe('32° 53\' 10.2" S, 68° 50\' 25.4" O');
  });
});

describe('paridad bit a bit con el modulo del frontend', () => {
  test('exporta las mismas funciones y constantes', () => {
    expect(Object.keys(Back).sort()).toEqual(Object.keys(Front).sort());
  });

  test('misma conversion directa e inversa en los vectores del fixture y en 500 puntos pseudoaleatorios (semilla fija)', () => {
    let semilla = 94;
    const azar = () => { semilla = (semilla * 1664525 + 1013904223) % 4294967296; return semilla / 4294967296; };
    const puntos = fixture.posgar.map((v) => [v.x, v.y]);
    for (let i = 0; i < 500; i += 1) {
      puntos.push([2300000 + azar() * 500000, 5800000 + azar() * 700000]);
    }
    puntos.forEach(([x, y]) => {
      const b = Back.coordenadas_posgarAWgs84(x, y);
      expect(b).toEqual(Front.coordenadas_posgarAWgs84(x, y));
      expect(Back.coordenadas_wgs84APosgar(b.lat, b.lon)).toEqual(Front.coordenadas_wgs84APosgar(b.lat, b.lon));
      expect(Back.coordenadas_evaluarPosgar({ x, y })).toEqual(Front.coordenadas_evaluarPosgar({ x, y }));
    });
  });

  test('mismas respuestas (ok, valores, textos, errores y mensajes) ante entradas GMS y POSGAR validas, invalidas y raras', () => {
    const gms = (la, lo) => ({ lat: la, lon: lo });
    const ok = { g: 33, m: 20, s: 51.54, h: 'S' };
    const okLon = { g: 69, m: 8, s: 43.62, h: 'O' };
    const entradasGms = [
      gms(ok, okLon), gms({ g: '33', m: '20', s: '51,54', h: 's' }, { g: '69', m: '8', s: '43.62', h: 'w' }),
      gms({ g: 33, m: '', s: '', h: 'S' }, okLon), gms({ g: 33, m: 60, s: 0, h: 'S' }, okLon), gms({ g: 33, m: 0, s: 60, h: 'S' }, okLon),
      gms({ g: -33, m: 0, s: 0, h: 'S' }, okLon), gms({ g: 33.5, m: 0, s: 0, h: 'S' }, okLon), gms({ g: 33, m: 0.5, s: 0, h: 'S' }, okLon),
      gms({ g: 33, m: 0, s: 0, h: 'N' }, okLon), gms({ g: 33, m: 0, s: 0, h: 'E' }, okLon), gms({ g: 33, m: 0, s: 0, h: '' }, okLon),
      gms({ g: 33, m: 0, s: 0 }, okLon), gms({ g: 91, m: 0, s: 0, h: 'S' }, okLon), gms({ g: 33, m: 0, s: 0, h: 'S' }, { g: 181, m: 0, s: 0, h: 'O' }),
      gms({ g: 90, m: 0, s: 1, h: 'S' }, okLon), gms({ g: NaN, m: 0, s: 0, h: 'S' }, okLon), gms({ g: 33, m: Infinity, s: 0, h: 'S' }, okLon),
      gms({ g: 33, m: 0, s: 1e400, h: 'S' }, okLon), gms({ g: '1e2', m: 0, s: 0, h: 'S' }, okLon), gms({ g: {}, m: [], s: true, h: 5 }, okLon),
      gms({ g: 10, m: 0, s: 0, h: 'S' }, okLon), gms({ g: 33, m: 0, s: 0, h: 'S' }, { g: 10, m: 0, s: 0, h: 'O' }),
      gms({ g: '', m: '', s: '', h: 'S' }, okLon), gms(null, null), gms(undefined, undefined), {}, null, undefined, 'texto', 5
    ];
    entradasGms.forEach((e) => expect(Back.coordenadas_evaluarGms(e)).toEqual(Front.coordenadas_evaluarGms(e)));

    const entradasPosgar = [
      { x: 2500000, y: 6350000 }, { x: '2.500.000,50', y: '6.350.000' }, { x: '2500000,5', y: '6350000.25' }, { x: ' 2 500 000 ', y: '6350000' },
      { x: 6350000, y: 2500000 }, { x: 2500000, y: 6350000.99 }, { x: -1, y: 6350000 }, { x: 2500000, y: -6350000 }, { x: 0, y: 0 },
      { x: 2300000, y: 5800000 }, { x: 2800000, y: 6500000 }, { x: 2299999, y: 6350000 }, { x: 2500000, y: 6500001 }, { x: 3500000, y: 6350000 },
      { x: 'abc', y: 6350000 }, { x: '', y: 6350000 }, { x: 2500000 }, { y: 6350000 }, { x: NaN, y: 6350000 }, { x: Infinity, y: 6350000 },
      { x: '1e6', y: 6350000 }, { x: '2.500.000.000', y: 6350000 }, { x: [], y: {} }, { x: true, y: false }, {}, null, undefined, 'x', 7
    ];
    entradasPosgar.forEach((e) => expect(Back.coordenadas_evaluarPosgar(e)).toEqual(Front.coordenadas_evaluarPosgar(e)));

    ['', ' ', '12', '1,5', '1.5', '2.500.000,50', '1e3', '--1', '+3', '.5', '5.', 'NaN', 'Infinity', null, undefined, 0, -0, 1.5, NaN, [], {}, true]
      .forEach((e) => {
        expect(Back.coordenadas_parsearNumero(e)).toEqual(Front.coordenadas_parsearNumero(e));
        expect(Back.coordenadas_parsearNumero(e, { permitirMiles: true })).toEqual(Front.coordenadas_parsearNumero(e, { permitirMiles: true }));
      });
  });

  test('NO DERIVA: el codigo sin comentarios de las dos copias es identico', () => {
    const codigo = (fuente) => fuente.split('\n')
      .map((l) => l.replace(/\s+\/\/ .*$/, '').replace(/^\s*\/\/.*$/, '').trimEnd())
      .filter((l) => l.trim() !== '')
      .join('\n');
    const b = codigo(fuenteBack);
    const f = codigo(fuenteFront);
    expect(b.length).toBeGreaterThan(5000);
    expect(b).toBe(f);
  });
});

describe('integracion con el backend y con Apps Script', () => {
  test('la caja de Mendoza del modulo es la MISMA que usa el servicio de correcciones', () => {
    expect(Back.COORD_MENDOZA_BBOX).toEqual(Servicio.UBICACION_CORR_MENDOZA_BBOX);
  });

  test('es codigo de Apps Script V8: sin require / import / DOM / red, y el unico module.exports esta protegido por typeof', () => {
    expect(fuenteBack).not.toMatch(/\brequire\(/);
    expect(fuenteBack).not.toMatch(/\bimport\b\s/);
    expect(fuenteBack).not.toMatch(/\b(document|window|fetch|XMLHttpRequest|UrlFetchApp|SpreadsheetApp)\b/);
    expect(fuenteBack).toMatch(/if \(typeof module !== 'undefined' && module\.exports\)/);
  });

  test('es autocontenido: se evalua solo (como un archivo del proyecto de Apps Script) y deja sus funciones como globales', () => {
    const vm = require('vm');
    const ctx = vm.createContext({ Math, Number, String, isFinite, Object });
    vm.runInContext(fuenteBack, ctx);
    const r = vm.runInContext("coordenadas_evaluarPosgar({ x: 2500000, y: 6350000 })", ctx);
    expect(r.ok).toBe(true);
    expect(r.lat).toBe(-32.992946);
    expect(vm.runInContext("typeof coordenadas_evaluarGms + typeof COORD_CRS_GMS", ctx)).toBe('functionstring');
  });

  test('los nombres globales del modulo no pisan nada del resto del backend (prefijo coordenadas_ / COORD_)', () => {
    const dir = path.join(raiz, 'backend', 'src');
    const nombres = [...fuenteBack.matchAll(/^(?:function|var) ([A-Za-z0-9_]+)/gm)].map((m) => m[1]);
    expect(nombres.length).toBeGreaterThan(20);
    nombres.forEach((n) => expect(n).toMatch(/^(coordenadas_|COORD_)/));
    fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'CoordenadasConversion.js').forEach((f) => {
      const otro = fs.readFileSync(path.join(dir, f), 'utf8');
      nombres.forEach((n) => {
        expect(new RegExp('^(?:function|var|const|let) ' + n + '\\b', 'm').test(otro)).toBe(false);
      });
    });
  });
});
