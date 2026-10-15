// PARIDAD Python <-> JS del resolver de ubicacion. Los vectores los genera el resolver REAL de Python (scripts/gen_vectores_resolver_ubicacion.py ->
// js/fixtures/resolver_ubicacion_vectores.json; scripts/test_vectores_resolver.py garantiza que el archivo sigue siendo lo que da Python). Aca se exige que la copia en
// JS (js/ubicacionFuenteDecisionesLogic.js) devuelva EXACTAMENTE lo mismo: estados, umbrales, desempates, redondeos y lat/lon.
const fs = require('fs');
const path = require('path');

Object.assign(global, require('./coordenadasConversion.js'));
const U = require('./ubicacionFuenteDecisionesLogic.js');
const uop = require('./ubicacionOperativaLogic.js');
const V = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'resolver_ubicacion_vectores.json'), 'utf8'));

const WELL = '14-0001';
const candidatas = (fuentes) => fuentes.map((f) => ({ tipo: f.tipo, x: f.x, y: f.y }));
const MOTIVO = 'No corresponde a la boca del pozo';

// Arma, con el dominio real, el estado de un pozo donde se descartaron las fuentes indicadas (por posicion en `fuentes`).
function pozoConDescartes(fuentes, descartadas) {
  const loc = { coordenadas: null, coordenadasProvincia: [] };
  fuentes.forEach((f) => { if (f.tipo === 'REPORTE_POZOS') { loc.coordenadas = { x: f.x, y: f.y }; } else { loc.coordenadasProvincia.push({ x: f.x, y: f.y }); } });
  const padron = U.ufd_fuentesDePadron(WELL, loc);
  expect(padron.fuentes).toHaveLength(fuentes.length);
  // una decision por IDENTIDAD (tipo + x + y): dos filas identicas del padron comparten clave y se descartan juntas, con un solo evento
  const vistas = new Set();
  const eventos = [];
  descartadas.forEach((i) => {
    const clave = U.ufd_claveFuente(WELL, fuentes[i].tipo, fuentes[i].x, fuentes[i].y);
    if (vistas.has(clave)) { return; }
    vistas.add(clave);
    eventos.push({ secuencia: eventos.length + 1, evento: 'DESCARTADA', wellId: WELL, fuenteTipo: fuentes[i].tipo, x: fuentes[i].x, y: fuentes[i].y, motivo: MOTIVO });
  });
  return U.ufd_derivar({ wellId: WELL, eventos: eventos, fuentes: padron.fuentes });
}

describe('fixture de Python', () => {
  test('el fixture tiene la forma y el tamano esperados', () => {
    expect(V.meta.fuenteDeVerdad).toBe('scripts/reindex_pozos.py::resolver_ubicacion');
    expect(V.resolver.length).toBeGreaterThanOrEqual(300);
    expect(V.descartes.length).toBeGreaterThanOrEqual(150);
  });

  test('los umbrales del JS son los del indexador de Python (10 / 50 / 500 m)', () => {
    expect(V.meta.umbrales).toEqual({ corroboracionM: U.UFD_UMBRAL_CORROBORACION_M, dudosoM: U.UFD_UMBRAL_DUDOSO_M, graveM: U.UFD_UMBRAL_GRAVE_M });
    expect([U.UFD_UMBRAL_CORROBORACION_M, U.UFD_UMBRAL_DUDOSO_M, U.UFD_UMBRAL_GRAVE_M]).toEqual([10, 50, 500]);
  });

  test('cubre todos los estados del resolver, en las dos secciones', () => {
    const todos = ['sinCoordenadas', 'unica', 'corroborada', 'dudosoLeve', 'revisar', 'revisarGrave'];
    expect([...new Set(V.resolver.map((c) => c.esperado.estado))].sort()).toEqual([...todos].sort());
    expect([...new Set(V.descartes.map((c) => c.esperado.estado))].sort()).toEqual([...todos].sort());
  });
});

describe('paridad del resolver (sin decisiones)', () => {
  test.each(V.resolver.map((c) => [c.id, c]))('%s', (id, c) => {
    expect(U.ufd_resolverAutomatico(candidatas(c.fuentes))).toEqual(c.esperado);
  });

  test('la conversion x/y -> lat/lon del JS coincide con la de Python (coord_utils, 5 decimales) en TODAS las fuentes de TODOS los casos', () => {
    let n = 0;
    V.resolver.concat(V.descartes).forEach((c) => c.fuentes.forEach((f) => {
      const p = U.ufd_fuentesDePadron(WELL, { coordenadas: { x: f.x, y: f.y } }).fuentes[0];
      expect([p.lat, p.lon]).toEqual([f.lat, f.lon]);
      n += 1;
    }));
    expect(n).toBeGreaterThan(1000);
  });

  test('los valores se devuelven con el mismo tipo y precision que Python (x e y tal cual; distancias a 1 decimal)', () => {
    V.resolver.filter((c) => c.esperado.distanciaCorroboracion !== undefined || c.esperado.distanciaMaxima !== undefined).forEach((c) => {
      const r = U.ufd_resolverAutomatico(candidatas(c.fuentes));
      const d = r.distanciaCorroboracion !== undefined ? r.distanciaCorroboracion : r.distanciaMaxima;
      expect(Math.round(d * 10) / 10).toBe(d);
    });
  });
});

describe('paridad con fuentes descartadas (resolver sobre las que quedan)', () => {
  test.each(V.descartes.map((c) => [c.id, c]))('%s', (id, c) => {
    const estado = pozoConDescartes(c.fuentes, c.descartadas);
    expect(estado.integro).toBe(true);
    const r = U.ufd_resolverRegistral(estado);
    // el «automatico» del dominio es exactamente lo que da Python sobre las fuentes que quedan
    const restantes = c.fuentes.filter((f, i) => c.descartadas.indexOf(i) === -1);
    expect(U.ufd_resolverAutomatico(candidatas(restantes))).toEqual(c.esperado);
    expect(r.participantes).toBe(restantes.length);
    // y el «original» es lo que da Python con todas, sin ninguna decision
    expect(U.ufd_resolverAutomatico(candidatas(c.fuentes))).toEqual(c.esperadoSinDescartes);
  });

  test('el estado humano del resultado sale del estado de Python (mismo mapeo que ubicacionOperativaLogic)', () => {
    const mapeo = { sinCoordenadas: 'SIN_COORDENADAS', unica: 'DISPONIBLE', corroborada: 'COINCIDENTE', dudosoLeve: 'DISCREPANCIA', revisar: 'DISCREPANCIA', revisarGrave: 'DISCREPANCIA' };
    let revisados = 0;
    V.descartes.forEach((c) => {
      const r = U.ufd_resolverRegistral(pozoConDescartes(c.fuentes, c.descartadas));
      if (r.anomalias.some((a) => a.codigo === 'COORDENADA_FUERA_DE_MENDOZA')) { return; }
      expect(r.estado).toBe(mapeo[c.esperado.estado]);
      if (c.esperado.lat !== undefined) {
        expect([r.lat, r.lon, r.x, r.y]).toEqual([c.esperado.lat, c.esperado.lon, c.esperado.x, c.esperado.y]);
      } else {
        expect([r.lat, r.lon]).toEqual([null, null]);
      }
      revisados += 1;
    });
    expect(revisados).toBeGreaterThan(100);
    // consistente con el mapeo de ubicacionOperativaLogic
    Object.keys(mapeo).forEach((k) => expect(uop.UOP_ESTADO_PADRON[k].estado).toBe(mapeo[k]));
  });

  test('«todas descartadas» da sinCoordenadas como Python con la lista vacia, y lo marca', () => {
    const c = V.descartes.filter((x) => x.id === 'desc-todas')[0];
    const r = U.ufd_resolverRegistral(pozoConDescartes(c.fuentes, c.descartadas));
    expect(c.esperado).toEqual({ estado: 'sinCoordenadas' });
    expect(r.estado).toBe('SIN_COORDENADAS');
    expect(r.todasDescartadas).toBe(true);
    expect(r.operativo).toBe(false);
  });
});

describe('casos con nombre: bordes de umbral y redondeos de Python', () => {
  const por = (id) => V.resolver.filter((c) => c.id === id)[0];
  const jsDe = (c) => U.ufd_resolverAutomatico(candidatas(c.fuentes));

  test('10 m exactos corrobora; 10,001 no; 50 m exactos es leve; 50,001 revisar; 500 exactos revisar; 500,001 grave', () => {
    expect(jsDe(por('par-10.0')).estado).toBe('corroborada');
    expect(jsDe(por('par-10.001')).estado).toBe('dudosoLeve');
    expect(jsDe(por('par-50.0')).estado).toBe('dudosoLeve');
    expect(jsDe(por('par-50.001')).estado).toBe('revisar');
    expect(jsDe(por('par-500.0')).estado).toBe('revisar');
    expect(jsDe(por('par-500.001')).estado).toBe('revisarGrave');
  });

  test('distancias exactas por diagonal 3-4-5 caen en el mismo lado del umbral que en Python', () => {
    expect(jsDe(por('par-10-diagonal')).estado).toBe('corroborada');
    expect(jsDe(por('par-50-diagonal')).estado).toBe('dudosoLeve');
    expect(jsDe(por('par-500-diagonal')).estado).toBe('revisar');
  });

  test('round de Python: 12.25 -> 12.2 (half-even exacto), 0.15 -> 0.1 (no representable), 20.75 -> 20.8, 0.25 -> 0.2', () => {
    expect(jsDe(por('redondeo-12.25')).distanciaMaxima).toBe(12.2);
    expect(jsDe(por('redondeo-0.15')).distanciaCorroboracion).toBe(0.1);
    expect(jsDe(por('redondeo-20.75')).distanciaMaxima).toBe(20.8);
    expect(jsDe(por('redondeo-0.25')).distanciaCorroboracion).toBe(0.2);
    expect(U.ufd_redondearComoPython(1.25, 1)).toBe(1.2);
    expect(U.ufd_redondearComoPython(3.75, 1)).toBe(3.8);
    expect(U.ufd_redondearComoPython(0.35, 1)).toBe(0.3);
    expect(U.ufd_redondearComoPython(0.45, 1)).toBe(0.5);
    expect(U.ufd_redondearComoPython(2.675, 2)).toBe(2.67);
    expect(U.ufd_redondearComoPython(0.125, 2)).toBe(0.12);
    expect(U.ufd_redondearComoPython(0.375, 2)).toBe(0.38);
  });

  test('desempate de pares con la misma distancia: gana el primero y la candidata es la primera fuente de ese par', () => {
    const c = por('empate-de-pares');
    const det = U.ufd_resolverAutomaticoDetallado(candidatas(c.fuentes));
    expect(det.resultado).toEqual(c.esperado);
    expect(det.indiceElegido).toBe(0);
  });

  test('«el par mas cercano no es el primero»: la candidata es la fuente i del par, no la primera de la lista', () => {
    const c = por('par-mejor-no-es-el-primero');
    const det = U.ufd_resolverAutomaticoDetallado(candidatas(c.fuentes));
    expect(det.resultado).toEqual(c.esperado);
    expect(det.indiceElegido).toBe(1);
  });

  test('14-0001 con tres fuentes: corrobora el par que coincide y la tercera lejana no cuenta', () => {
    const c = por('14-0001-tres-fuentes');
    expect(jsDe(c).estado).toBe('corroborada');
    expect(jsDe(c)).toEqual(c.esperado);
  });

  test('filas identicas dan distancia 0 -> corroborada (el mismo artefacto que Python)', () => {
    expect(jsDe(por('filas-duplicadas-irrigacion'))).toEqual(por('filas-duplicadas-irrigacion').esperado);
    expect(jsDe(por('filas-duplicadas-irrigacion')).estado).toBe('corroborada');
  });
});
