// "Ubicaciones conocidas": fuentes por separado, punto operativo, distancias, enlaces a Google Maps (solo lat,lon) y HTML. Logica pura.
const fs = require('fs');
const path = require('path');

const conv = require('./coordenadasConversion.js');
const uop = require('./ubicacionOperativaLogic.js');
Object.assign(global, conv, uop);                       // las dependencias son globales en el navegador
const U = require('./ubicacionesConocidasLogic.js');

// --- Datos de prueba: una coordenada WGS84 -> el {x, y} (Este, Norte) POSGAR que trae el padron ---
const posgar = (lat, lon) => { const p = conv.coordenadas_wgs84APosgar(lat, lon); return { x: Math.round(p.este * 1000) / 1000, y: Math.round(p.norte * 1000) / 1000 }; };
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const metros = (a, b) => uop.ubicacionOperativaLogic_distanciaMetros(a.lat, a.lon, b.lat, b.lon);

// 14-0001 (el caso real visto en el celular): tres coordenadas del padron y, aparte, una validada en campo.
const REPORTE = { lat: -33.34765, lon: -69.14545 };
const IRR1 = { lat: -33.34755, lon: -69.14550 };           // ~11 m del Reporte
const IRR2 = { lat: -33.34880, lon: -69.14400 };           // ~170 m
const CAMPO = { lat: -33.34745, lon: -69.14545 };           // validada en campo, ~22 m del Reporte

function resuelta(estado, punto, extra) {
  const p = posgar(punto.lat, punto.lon);
  const c = U_back(p);
  return Object.assign({ estado: estado, x: p.x, y: p.y, lat: c.lat, lon: c.lon }, extra || {});
}
function U_back(p) { const g = conv.coordenadas_posgarAWgs84(p.x, p.y); return { lat: r5(g.lat), lon: r5(g.lon) }; }

function ubicacion(opc) {
  const o = opc || {};
  const loc = { wellId: '14-0001' };
  if (o.reporte) { loc.coordenadas = posgar(o.reporte.lat, o.reporte.lon); }
  loc.coordenadasProvincia = (o.provincia || []).map((c) => posgar(c.lat, c.lon));
  loc.ubicacionResuelta = o.resuelta || null;
  return loc;
}
const vigente = (extra) => Object.assign({
  correccionId: 'a1b2c3d4-0000-4000-8000-000000000001', wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, metodo: 'COORDENADAS_GMS', estado: 'VALIDADA',
  emailPropone: 'secreto@dgi.gob.ar', nombrePropone: 'Persona Secreta', observacion: 'Observacion privada del campo', resolucion: { evento: 'VALIDADA', motivo: 'motivo privado', timestamp: '2026-10-13T12:00:00.000Z' }
}, extra || {});

const construir = (loc, vig) => U.ubicacionesConocidasLogic_construir({ wellId: '14-0001', location: loc, vigente: vig === undefined ? null : vig });
const ids = (m) => m.fuentes.map((f) => f.id);
const fuente = (m, id) => m.fuentes.filter((f) => f.id === id)[0];

describe('enlace a Google Maps: solo latitud y longitud', () => {
  test('formato exacto https://www.google.com/maps/search/?api=1&query=LAT,LON', () => {
    expect(U.ubicacionesConocidasLogic_urlGoogleMaps(-33.34765, -69.14545)).toBe('https://www.google.com/maps/search/?api=1&query=-33.34765,-69.14545');
  });
  test('redondea a 5 decimales y no mete nada mas', () => {
    expect(U.ubicacionesConocidasLogic_urlGoogleMaps(-33.347654321, -69.145449876)).toBe('https://www.google.com/maps/search/?api=1&query=-33.34765,-69.14545');
  });
  test('coordenada invalida -> null (sin enlace): NaN, null, texto, undefined, infinito y fuera de Mendoza', () => {
    [[NaN, -69], [-33, NaN], [null, null], ['-33.3', '-69.1'], [undefined, undefined], [Infinity, -69], [0, 0], [-34.6, -60], [10, -69.1]].forEach((par) => {
      expect(U.ubicacionesConocidasLogic_urlGoogleMaps(par[0], par[1])).toBeNull();
    });
  });
  test('la URL solo tiene caracteres de una coordenada despues de query= (nada de wellId, titular ni textos)', () => {
    const u = U.ubicacionesConocidasLogic_urlGoogleMaps(-33.34765, -69.14545);
    expect(u.split('query=')[1]).toMatch(/^-?\d+\.\d+,-?\d+\.\d+$/);
    expect(u).not.toMatch(/key=|wellId|14-0001|@|%/);
  });
});

describe('construir: cuantas fuentes hay', () => {
  test('1 fuente: solo Reporte Pozos -> es el punto operativo, sin distancia', () => {
    const m = construir(ubicacion({ reporte: REPORTE, resuelta: resuelta('unica', REPORTE, { fuente: 'reportePozos' }) }));
    expect(ids(m)).toEqual(['REPORTE_POZOS']);
    expect(m.validas).toBe(1);
    expect(fuente(m, 'REPORTE_POZOS')).toMatchObject({ etiqueta: 'Reporte Pozos', tipo: 'REPORTE_POZOS', esOperativo: true, distanciaOperativoM: null, invalida: false });
    expect(m.operativo.fuenteId).toBe('REPORTE_POZOS');
    expect(m.sinOperativo).toBe(false);
  });

  test('1 fuente: una sola de Irrigacion se rotula "Irrigación" (sin numero)', () => {
    const m = construir(ubicacion({ provincia: [IRR1], resuelta: resuelta('unica', IRR1, { fuente: 'coordProvincia' }) }));
    expect(m.fuentes.map((f) => f.etiqueta)).toEqual(['Irrigación']);
    expect(m.fuentes[0].esOperativo).toBe(true);
  });

  test('2 fuentes (Reporte + Irrigacion coincidentes): el operativo es la que eligio el padron; la otra dice a cuantos metros esta', () => {
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1], resuelta: resuelta('corroborada', IRR1, { distanciaCorroboracion: 11.3 }) }));
    expect(ids(m)).toEqual(['REPORTE_POZOS', 'IRRIGACION_1']);
    expect(fuente(m, 'IRRIGACION_1').esOperativo).toBe(true);
    expect(fuente(m, 'REPORTE_POZOS').esOperativo).toBe(false);
    expect(fuente(m, 'REPORTE_POZOS').distanciaOperativoM).toBeCloseTo(metros(REPORTE, IRR1), 0);
    expect(m.operativo.estado).toBe('COINCIDENTE');
  });

  test('3 fuentes (el caso 14-0001): Reporte Pozos, Irrigación (1) e Irrigación (2), cada una con su coordenada', () => {
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1, IRR2], resuelta: resuelta('corroborada', REPORTE, { distanciaCorroboracion: 11.3 }) }));
    expect(m.fuentes.map((f) => f.etiqueta)).toEqual(['Reporte Pozos', 'Irrigación (1)', 'Irrigación (2)']);
    expect(m.validas).toBe(3);
    expect(fuente(m, 'REPORTE_POZOS').lat).toBe(r5(conv.coordenadas_posgarAWgs84(posgar(REPORTE.lat, REPORTE.lon).x, posgar(REPORTE.lat, REPORTE.lon).y).lat));
    expect(fuente(m, 'IRRIGACION_1').distanciaOperativoM).toBeCloseTo(metros(REPORTE, IRR1), 0);
    expect(fuente(m, 'IRRIGACION_2').distanciaOperativoM).toBeCloseTo(metros(REPORTE, IRR2), 0);
    expect(m.fuentes.filter((f) => f.esOperativo).map((f) => f.id)).toEqual(['REPORTE_POZOS']);          // una sola es el punto operativo
  });

  test('4 fuentes: las 3 del padron + la validada en campo, que pasa a ser el punto operativo (R1) y las demas miden contra ella', () => {
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1, IRR2], resuelta: resuelta('corroborada', REPORTE, { distanciaCorroboracion: 11.3 }) }), vigente());
    expect(ids(m)).toEqual(['REPORTE_POZOS', 'IRRIGACION_1', 'IRRIGACION_2', 'CAMPO_VALIDADA']);
    expect(m.fuentes.filter((f) => f.esOperativo).map((f) => f.id)).toEqual(['CAMPO_VALIDADA']);
    expect(m.operativo).toMatchObject({ estado: 'VALIDADA_CAMPO', regla: 'R1_CAMPO_VALIDADA', fuenteId: 'CAMPO_VALIDADA', lat: CAMPO.lat, lon: CAMPO.lon });
    expect(fuente(m, 'REPORTE_POZOS').distanciaOperativoM).toBeCloseTo(metros(REPORTE, CAMPO), 0);
    expect(fuente(m, 'CAMPO_VALIDADA')).toMatchObject({ etiqueta: 'Validada en campo', tipo: 'CAMPO_VALIDADA', distanciaOperativoM: null });
  });

  test('mas de 4 fuentes (N): 6 coordenadas de Irrigacion numeradas, todas con su enlace y una sola operativa', () => {
    const muchas = [0, 1, 2, 3, 4, 5].map((i) => ({ lat: -33.3476 - i * 0.0004, lon: -69.1454 + i * 0.0003 }));
    const m = construir(ubicacion({ reporte: REPORTE, provincia: muchas, resuelta: resuelta('corroborada', muchas[2], { distanciaCorroboracion: 8 }) }), vigente());
    expect(m.fuentes).toHaveLength(8);
    expect(m.fuentes.map((f) => f.etiqueta).slice(1, 7)).toEqual(['Irrigación (1)', 'Irrigación (2)', 'Irrigación (3)', 'Irrigación (4)', 'Irrigación (5)', 'Irrigación (6)']);
    expect(m.validas).toBe(8);
    expect(m.fuentes.every((f) => /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d+\.\d+,-?\d+\.\d+$/.test(f.urlMaps))).toBe(true);
    expect(m.fuentes.filter((f) => f.esOperativo)).toHaveLength(1);
    expect(new Set(m.fuentes.map((f) => f.urlMaps)).size).toBe(8);                  // cada enlace lleva SU coordenada
  });

  test('sin ninguna fuente -> lista vacia, sin operativo (la ficha no muestra la seccion)', () => {
    const m = construir({ wellId: '14-0001', coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'sinCoordenadas' } });
    expect(m.fuentes).toEqual([]);
    expect(m.validas).toBe(0);
    expect(m.operativo).toBeNull();
    expect(U.ubicacionesConocidasLogic_htmlSeccion(m)).toBe('');
  });

  test('pozo sin coordenadas del padron pero con una correccion validada: la validada es la unica fuente y el punto operativo', () => {
    const m = construir({ wellId: '14-0001', coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'sinCoordenadas' } }, vigente());
    expect(ids(m)).toEqual(['CAMPO_VALIDADA']);
    expect(m.fuentes[0].esOperativo).toBe(true);
  });

  test('entradas rotas no lanzan', () => {
    expect(() => U.ubicacionesConocidasLogic_construir(undefined)).not.toThrow();
    expect(() => U.ubicacionesConocidasLogic_construir({ location: 'x', vigente: 3 })).not.toThrow();
    expect(U.ubicacionesConocidasLogic_construir(null).fuentes).toEqual([]);
    expect(construir({ coordenadasProvincia: 'no-es-lista', coordenadas: 5 }).fuentes).toHaveLength(1);       // coordenadas=5 es una fuente invalida
  });
});

describe('construir: el punto operativo lo dice el resolvedor', () => {
  test('discrepancia entre fuentes: NINGUNA es operativa, no hay distancias y todas conservan su enlace', () => {
    const lejos = { lat: -33.3600, lon: -69.1300 };
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [lejos], resuelta: { estado: 'revisar', distanciaMaxima: 2000 } }));
    expect(m.sinOperativo).toBe(true);
    expect(m.operativo).toBeNull();
    expect(m.fuentes.some((f) => f.esOperativo)).toBe(false);
    expect(m.fuentes.every((f) => f.distanciaOperativoM === null)).toBe(true);
    expect(m.fuentes.every((f) => typeof f.urlMaps === 'string')).toBe(true);
    expect(m.validas).toBe(2);
  });

  test('la validada en campo gana aunque el padron este en discrepancia', () => {
    const lejos = { lat: -33.3600, lon: -69.1300 };
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [lejos], resuelta: { estado: 'revisar', distanciaMaxima: 2000 } }), vigente());
    expect(m.sinOperativo).toBe(false);
    expect(m.fuentes.filter((f) => f.esOperativo).map((f) => f.id)).toEqual(['CAMPO_VALIDADA']);
    expect(fuente(m, 'IRRIGACION_1').distanciaOperativoM).toBeGreaterThan(1000);
  });

  test('caso real 14-0001 con la validada a 0 m de Irrigacion: sigue siendo la operativa y la otra queda a menos de 1 m', () => {
    const base = { lat: -33.34765, lon: -69.14545 };
    const m = construir(ubicacion({ provincia: [base], resuelta: resuelta('unica', base, { fuente: 'coordProvincia' }) }), vigente({ lat: base.lat, lon: base.lon }));
    expect(m.fuentes.filter((f) => f.esOperativo).map((f) => f.id)).toEqual(['CAMPO_VALIDADA']);
    expect(fuente(m, 'IRRIGACION_1').distanciaOperativoM).toBeLessThan(1);
    expect(U.ubicacionesConocidasLogic_textoDistancia(fuente(m, 'IRRIGACION_1').distanciaOperativoM)).toBe('A menos de 1 m del punto operativo');
  });

  test('si x/y del punto operativo no coinciden exacto, se reconoce la fuente por cercania (<= 2 m)', () => {
    const r = resuelta('unica', REPORTE, { fuente: 'reportePozos' });
    r.x = r.x + 0.4;                                    // no coincide con ninguna x exacta, pero esta a < 1 m
    const m = construir(ubicacion({ reporte: REPORTE, resuelta: r }));
    expect(m.fuentes[0].esOperativo).toBe(true);
  });

  test('un vigente que no esta VALIDADA, de otro formato o fuera de Mendoza se ignora', () => {
    const base = ubicacion({ reporte: REPORTE, resuelta: resuelta('unica', REPORTE, { fuente: 'reportePozos' }) });
    expect(ids(construir(base, vigente({ estado: 'PROPUESTA' })))).toEqual(['REPORTE_POZOS']);
    expect(ids(construir(base, vigente({ estado: 'RECHAZADA' })))).toEqual(['REPORTE_POZOS']);
    expect(ids(construir(base, vigente({ lat: 10, lon: 10 })))).toEqual(['REPORTE_POZOS']);
    expect(ids(construir(base, vigente({ lat: 'x' })))).toEqual(['REPORTE_POZOS']);
    expect(ids(construir(base, 'texto'))).toEqual(['REPORTE_POZOS']);
  });

  test('un delta del backend (sin campo estado) tambien cuenta como validada', () => {
    const base = ubicacion({ reporte: REPORTE, resuelta: resuelta('unica', REPORTE, { fuente: 'reportePozos' }) });
    const m = construir(base, { wellId: '14-0001', lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-13T12:00:00.000Z' });
    expect(ids(m)).toContain('CAMPO_VALIDADA');
  });
});

describe('coordenada invalida de una fuente', () => {
  test('x/y ausentes, no numericas o fuera de Mendoza -> la fuente se lista como invalida: sin enlace, sin marcador, sin distancia', () => {
    const loc = ubicacion({ reporte: REPORTE, resuelta: resuelta('unica', REPORTE, { fuente: 'reportePozos' }) });
    loc.coordenadasProvincia = [{ x: null, y: 6000000 }, { x: 'abc', y: 'def' }, { x: 100, y: 100 }, null, {}];
    const m = construir(loc);
    expect(m.fuentes).toHaveLength(6);
    expect(m.validas).toBe(1);
    m.fuentes.slice(1).forEach((f) => {
      expect(f.invalida).toBe(true);
      expect(f.urlMaps).toBeNull();
      expect(f.lat).toBeNull();
      expect(f.distanciaOperativoM).toBeNull();
    });
    const html = U.ubicacionesConocidasLogic_htmlSeccion(m);
    expect((html.match(/Coordenada no válida/g) || []).length).toBe(5);
    expect((html.match(/Abrir en Google Maps/g) || []).length).toBe(1);
    expect(U.ubicacionesConocidasLogic_htmlLeyenda(m).match(/data-ucon-foco/g)).toHaveLength(1);
  });

  test('x/y como texto numerico se aceptan (el padron puede traerlos asi)', () => {
    const p = posgar(REPORTE.lat, REPORTE.lon);
    const m = construir({ wellId: '14-0001', coordenadas: { x: String(p.x), y: String(p.y) }, coordenadasProvincia: [], ubicacionResuelta: { estado: 'sinCoordenadas' } });
    expect(m.fuentes[0].invalida).toBe(false);
    expect(m.fuentes[0].lat).toBeCloseTo(REPORTE.lat, 4);
  });
});

describe('distancias', () => {
  test('textoDistancia: menos de 1 m, metros con coma, metros enteros y kilometros', () => {
    const t = U.ubicacionesConocidasLogic_textoDistancia;
    expect(t(0)).toBe('A menos de 1 m del punto operativo');
    expect(t(0.4)).toBe('A menos de 1 m del punto operativo');
    expect(t(3.46)).toBe('A 3,5 m del punto operativo');
    expect(t(22.2)).toBe('A 22 m del punto operativo');
    expect(t(999.4)).toBe('A 999 m del punto operativo');
    expect(t(1234)).toBe('A 1,2 km del punto operativo');
    expect(t(15000)).toBe('A 15 km del punto operativo');
    [null, undefined, NaN, -5, '12', Infinity].forEach((v) => expect(t(v)).toBeNull());
  });
});

describe('HTML de la seccion: cada fuente individual', () => {
  const m4 = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1, IRR2], resuelta: resuelta('corroborada', REPORTE, { distanciaCorroboracion: 11.3 }) }), vigente());
  const html = U.ubicacionesConocidasLogic_htmlSeccion(m4, { iconoMaps: '<svg data-icono></svg>' });

  test('titulo, una fila por fuente con nombre, coordenada, x/y del padron y distancia', () => {
    expect(html).toContain('Ubicaciones conocidas');
    expect((html.match(/<li class="ucon-fuente/g) || []).length).toBe(4);
    ['Reporte Pozos', 'Irrigación (1)', 'Irrigación (2)', 'Validada en campo'].forEach((n) => expect(html).toContain('<span class="ucon-nombre">' + n + '</span>'));
    expect(html).toMatch(/x \d+(\.\d+)? \/ y \d+(\.\d+)?/);
    expect(html).toContain('del punto operativo');
  });

  test('exactamente UNA fuente lleva el indicador "Punto operativo"', () => {
    expect((html.match(/<span class="ucon-chip-operativo">Punto operativo<\/span>/g) || []).length).toBe(1);
    expect(html).toMatch(/ucon-operativa" data-ucon-id="CAMPO_VALIDADA"/);
  });

  test('un boton "Abrir en Google Maps" por fuente y cada uno usa SU lat/lon', () => {
    const enlaces = html.match(/<a class="maps-btn ucon-maps" href="[^"]+" target="_blank" rel="noopener">/g) || [];
    expect(enlaces).toHaveLength(4);
    m4.fuentes.forEach((f) => {
      expect(html).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=' + f.lat + ',' + f.lon + '"');
    });
    expect((html.match(/Abrir en Google Maps/g) || []).length).toBe(4);
    expect(html).toContain('<svg data-icono></svg>');
  });

  test('boton general "Ver todas en el mapa" una sola vez', () => {
    expect((html.match(/id="btn-ucon-ver-todas"/g) || []).length).toBe(1);
    expect(html).toContain('>Ver todas en el mapa</button>');
  });

  test('sin punto operativo: nota explicativa y ninguna fila lleva el chip', () => {
    const m = construir(ubicacion({ reporte: REPORTE, provincia: [{ lat: -33.36, lon: -69.13 }], resuelta: { estado: 'revisar', distanciaMaxima: 2000 } }));
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m);
    expect(h).toContain('No hay punto operativo');
    expect(h).not.toContain('ucon-chip-operativo');
    expect(h).toContain('id="btn-ucon-ver-todas"');
  });

  test('con punto operativo, la nota aclara que cada fuente conserva su ubicacion original', () => {
    expect(html).toContain('Cada fuente conserva su ubicación original');
    expect(html).not.toContain('No hay punto operativo');
  });

  test('todas invalidas: se listan pero NO hay boton para ver el mapa', () => {
    const m = construir({ wellId: '14-0001', coordenadas: { x: 1, y: 1 }, coordenadasProvincia: [], ubicacionResuelta: { estado: 'sinCoordenadas' } });
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m);
    expect(h).toContain('Coordenada no válida');
    expect(h).not.toContain('btn-ucon-ver-todas');
    expect(h).not.toContain('Abrir en Google Maps');
  });

  test('escapa HTML en las etiquetas', () => {
    expect(U.ubicacionesConocidasLogic_htmlFuente({ id: 'X', tipo: 'IRRIGACION', etiqueta: '<img src=x onerror=1>', x: null, y: null, lat: -33.3, lon: -69.1, invalida: false, esOperativo: false, distanciaOperativoM: null, urlMaps: null, detalle: '"&' })).not.toMatch(/<img/);
  });
});

describe('visor: popup y leyenda', () => {
  const m = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1], resuelta: resuelta('corroborada', REPORTE, { distanciaCorroboracion: 11.3 }) }), vigente());

  test('el popup muestra fuente, lat/lon, distancia y el enlace a Google Maps de ESA fuente', () => {
    const f = fuente(m, 'IRRIGACION_1');
    const h = U.ubicacionesConocidasLogic_htmlPopup(f);
    expect(h).toContain('<strong>Irrigación</strong>');            // una sola de Irrigacion: sin numero
    expect(h).toContain(f.lat + ', ' + f.lon);
    expect(h).toContain('del punto operativo');
    expect(h).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=' + f.lat + ',' + f.lon + '"');
    expect(h).toContain('rel="noopener"');
    expect(h).not.toContain('ucon-chip-operativo');
  });

  test('el popup del punto operativo lo dice y no muestra distancia', () => {
    const h = U.ubicacionesConocidasLogic_htmlPopup(fuente(m, 'CAMPO_VALIDADA'));
    expect(h).toContain('Punto operativo');
    expect(h).not.toContain('del punto operativo');
  });

  test('la leyenda tiene una fila enfocable por fuente valida con su distancia al operativo', () => {
    const l = U.ubicacionesConocidasLogic_htmlLeyenda(m);
    expect((l.match(/data-ucon-foco="/g) || []).length).toBe(3);
    expect(l).toContain('data-ucon-foco="CAMPO_VALIDADA"');
    expect(l).toContain('<span>Punto operativo</span>');
    expect(l).toContain('del punto operativo');
  });

  test('la clase del marcador distingue el tipo de fuente y marca al operativo', () => {
    expect(U.ubicacionesConocidasLogic_claseMarcador(fuente(m, 'REPORTE_POZOS'))).toBe('ucon-marker-reporte');
    expect(U.ubicacionesConocidasLogic_claseMarcador(fuente(m, 'IRRIGACION_1'))).toBe('ucon-marker-irr');
    expect(U.ubicacionesConocidasLogic_claseMarcador(fuente(m, 'CAMPO_VALIDADA'))).toBe('ucon-marker-campo ucon-marker-op');
  });
});

describe('privacidad: nada personal en el HTML ni en las URL', () => {
  const m = construir(ubicacion({ reporte: REPORTE, provincia: [IRR1, IRR2], resuelta: resuelta('corroborada', REPORTE, { distanciaCorroboracion: 11.3 }) }), vigente());
  const todo = [
    U.ubicacionesConocidasLogic_htmlSeccion(m), U.ubicacionesConocidasLogic_htmlLeyenda(m), JSON.stringify(m),
    m.fuentes.map((f) => U.ubicacionesConocidasLogic_htmlPopup(f)).join('')
  ].join('\n');

  test('ni email, ni nombre, ni observacion, ni motivo, ni id de correccion aparecen en ningun lado', () => {
    ['secreto@dgi.gob.ar', 'Persona Secreta', 'Observacion privada', 'motivo privado', 'a1b2c3d4-0000-4000-8000-000000000001', 'emailPropone', 'observacion'].forEach((s) => expect(todo).not.toContain(s));
  });

  test('las URL de Google Maps no llevan el wellId ni nada fuera de lat,lon', () => {
    const urls = m.fuentes.map((f) => f.urlMaps);
    expect(urls.length).toBe(4);
    urls.forEach((u) => {
      expect(u).toMatch(/^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=-?\d+\.\d+,-?\d+\.\d+$/);
      expect(u).not.toContain('14-0001');
    });
    expect((U.ubicacionesConocidasLogic_htmlSeccion(m).match(/href="[^"]*14-0001/g) || [])).toHaveLength(0);
  });

  test('el HTML de la seccion tampoco repite el wellId (ya esta en el encabezado de la ficha)', () => {
    expect(U.ubicacionesConocidasLogic_htmlSeccion(m)).not.toContain('14-0001');
  });
});

describe('el modulo es puro y de solo lectura', () => {
  const fuenteLogica = fs.readFileSync(path.join(__dirname, 'ubicacionesConocidasLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test('sin DOM, red, almacenamiento ni Leaflet', () => {
    expect(fuenteLogica).not.toMatch(/document\.|window\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\bL\.|navigator\.|api[A-Z]\w+\(/);
  });
  test('no decide ni escribe nada de las decisiones: solo pide el HTML a las funciones ufdui_ compartidas (nunca el dominio ufd_, ni la API, ni "eliminar")', () => {
    expect(fuenteLogica).not.toMatch(/\bufd_|aceptarFuente|validarFuente|eliminar|borrar|\bapi[A-Z]/i);
    expect(fuenteLogica).not.toMatch(/ACEPTADA|SIN_REVISAR/);          // la maquina de estados no esta aca
  });
  test('la unica URL externa es la de Google Maps con api=1&query=', () => {
    const urls = fuenteLogica.match(/https?:\/\/[^'"\s)]+/g) || [];
    expect(urls).toEqual(['https://www.google.com/maps/search/?api=1&query=']);
  });
});
