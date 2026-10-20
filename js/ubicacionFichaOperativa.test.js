// E3-5: la FICHA del pozo muestra la MISMA ubicacion operativa que el resto del sistema (V > R > C | D > ninguna). Cubre: el dominio compartido
// (ubicacionOperativaLogic_resolverFicha / _deltaDeVistaDecisiones), el modelo y el HTML de la ficha (bloque principal y "Ubicaciones conocidas"), la paridad ficha = mapa
// (ubicacionOperativaLogic_aplicarCapas) para D / C / R / V / V+R / N / N+V, y el controlador ejecutado de verdad (visor comparativo, permisos, falla de las decisiones,
// refresco tras decidir y revertir la V). Sin backend: las lecturas son datos.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const leer = (...p) => fs.readFileSync(path.join(__dirname, ...p), 'utf8');
const conv = require('./coordenadasConversion.js');
const uop = require('./ubicacionOperativaLogic.js');
const ufdui = require('./ubicacionFuenteDecisionesUiLogic.js');
Object.assign(global, conv, uop, ufdui);                    // las dependencias son globales en el navegador
const U = require('./ubicacionesConocidasLogic.js');
const UC = require('./ubicacionCorreccionLogic.js');

const W = '14-0001';
const A = { lat: -33.34765, lon: -69.14545 };                // Reporte Pozos
const B = { lat: -33.34755, lon: -69.14550 };                // Irrigacion (1), ~11 m de A
const C = { lat: -33.34880, lon: -69.14400 };                // Irrigacion (2), ~170 m
const CAMPO = { lat: -33.34745, lon: -69.14545 };            // validada en campo, ~22 m de A

const r5 = (v) => Math.round(v * 1e5) / 1e5;
const posgar = (p) => { const c = conv.coordenadas_wgs84APosgar(p.lat, p.lon); return { x: Math.round(c.este * 1000) / 1000, y: Math.round(c.norte * 1000) / 1000 }; };
const wgs = (p) => { const q = posgar(p); const g = conv.coordenadas_posgarAWgs84(q.x, q.y); return { lat: r5(g.lat), lon: r5(g.lon) }; };
const metros = (p, q) => uop.ubicacionOperativaLogic_distanciaMetros(p.lat, p.lon, q.lat, q.lon);

const TIPO = { A: 'REPORTE_POZOS', B: 'IRRIGACION', C: 'IRRIGACION' };
const PUNTO = { A: A, B: B, C: C };
const ID = { A: 'REPORTE_POZOS', B: 'IRRIGACION_1', C: 'IRRIGACION_2' };
const clave = (k) => W + '|' + TIPO[k] + '|' + posgar(PUNTO[k]).x.toFixed(3) + '|' + posgar(PUNTO[k]).y.toFixed(3);

// location de getWellLocation. fuentes: letras de las fuentes del padron presentes ('A' = Reporte, 'B' y 'C' = Irrigacion). resuelta: {estado, en: 'A'|'B'|'C'}
function location(fuentes, resuelta) {
  const loc = { wellId: W, coordenadasProvincia: [] };
  fuentes.forEach((k) => { if (k === 'A') { loc.coordenadas = posgar(A); } else { loc.coordenadasProvincia.push(posgar(PUNTO[k])); } });
  if (resuelta) {
    const p = posgar(PUNTO[resuelta.en || 'A']);
    const g = wgs(PUNTO[resuelta.en || 'A']);
    loc.ubicacionResuelta = Object.assign({ estado: resuelta.estado, x: p.x, y: p.y, lat: g.lat, lon: g.lon }, resuelta.estado === 'corroborada' ? { distanciaCorroboracion: 11 } : { fuente: resuelta.fuente || 'reportePozos' }, resuelta.extra || {});
  } else {
    loc.ubicacionResuelta = { estado: 'sinCoordenadas' };
  }
  return loc;
}

// vista de getDecisionesFuentesPozo. estados: {A: 'SIN_REVISAR'|'ACEPTADA'|'DESCARTADA', B: .., C: ..} solo de las fuentes presentes. res: resolucion (ver las funciones de abajo)
function vista(estados, res, extra) {
  return Object.assign({
    wellId: W, version: 7, integro: true, padronPeriodo: '2026-09', obsoletas: [], historial: [], resolucion: res,
    fuentes: Object.keys(estados).map((k, i) => Object.assign({
      clave: clave(k), fuenteTipo: TIPO[k], x: posgar(PUNTO[k]).x, y: posgar(PUNTO[k]).y, lat: wgs(PUNTO[k]).lat, lon: wgs(PUNTO[k]).lon, posicion: i, estado: estados[k],
      esAceptadaVigente: estados[k] === 'ACEPTADA', esOperativa: false,
      ultima: estados[k] === 'SIN_REVISAR' ? null : { secuencia: 2 + i, evento: estados[k], nombre: 'Ana Pérez', timestampUtc: '2026-10-15T15:00:00.000Z', motivo: estados[k] === 'DESCARTADA' ? 'cae en el río' : '' }
    }))
  }, extra || {});
}
// resoluciones del backend (ufd_resolverRegistral): ACEPTADA / COINCIDENTE / DISPONIBLE con punto; SIN_COORDENADAS / DISCREPANCIA sin punto
const resPunto = (estado, k, extra) => Object.assign({
  estado: estado, nivel: null, regla: estado === 'ACEPTADA' ? 'R1B_REGISTRAL_ACEPTADA' : 'R2_BASE', operativo: true, lat: wgs(PUNTO[k]).lat, lon: wgs(PUNTO[k]).lon,
  fuente: estado === 'COINCIDENTE' ? 'IRR_VARIAS' : (k === 'A' ? 'IRR_REPORTE' : 'IRR_PROVINCIA'), fuenteClave: clave(k), todasDescartadas: false, participantes: 3, cambiaRespectoDelOriginal: estado === 'ACEPTADA'
}, extra || {});
const resSinPunto = (estado, extra) => Object.assign({
  estado: estado, nivel: null, regla: 'R0_NINGUNA', operativo: false, lat: null, lon: null, fuente: null, fuenteClave: null, todasDescartadas: estado === 'SIN_COORDENADAS', participantes: 0, cambiaRespectoDelOriginal: true
}, extra || {});

const vigente = (extra) => Object.assign({ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, estado: 'VALIDADA', correccionId: 'c-1', resolucion: { timestamp: '2026-10-13T12:00:00.000Z' } }, extra || {});

// --- escenarios (el padron + las decisiones + la validada) ---
const ESC = {
  D: { loc: location(['A'], { estado: 'unica', en: 'A' }), vista: null, vigente: null },
  C: { loc: location(['A', 'B'], { estado: 'corroborada', en: 'A' }), vista: null, vigente: null },
  R: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'SIN_REVISAR', B: 'SIN_REVISAR', C: 'ACEPTADA' }, resPunto('ACEPTADA', 'C')), vigente: null
  },
  V: { loc: location(['A', 'B'], { estado: 'corroborada', en: 'A' }), vista: null, vigente: vigente() },
  VR: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'SIN_REVISAR', B: 'SIN_REVISAR', C: 'ACEPTADA' }, resPunto('ACEPTADA', 'C')), vigente: vigente()
  },
  N: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'DESCARTADA', B: 'DESCARTADA', C: 'DESCARTADA' }, resSinPunto('SIN_COORDENADAS')), vigente: null
  },
  NV: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'DESCARTADA', B: 'DESCARTADA', C: 'DESCARTADA' }, resSinPunto('SIN_COORDENADAS')), vigente: vigente()
  },
  DISC: {
    loc: location(['A', 'C'], { estado: 'revisar', en: 'A', extra: { distanciaMaxima: 170 } }),
    vista: vista({ A: 'SIN_REVISAR', C: 'SIN_REVISAR' }, resSinPunto('DISCREPANCIA', { todasDescartadas: false, participantes: 2, cambiaRespectoDelOriginal: false })), vigente: null
  },
  // descartar la fuente que rompia la coincidencia deja a las otras dos: el automatico sigue siendo C (coincidente) en A
  DESC1: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'SIN_REVISAR', B: 'SIN_REVISAR', C: 'DESCARTADA' }, resPunto('COINCIDENTE', 'A', { participantes: 2, cambiaRespectoDelOriginal: false })), vigente: null
  },
  // se descartan A y B: queda solo C (disponible)
  DESC2: {
    loc: location(['A', 'B', 'C'], { estado: 'corroborada', en: 'A' }),
    vista: vista({ A: 'DESCARTADA', B: 'DESCARTADA', C: 'SIN_REVISAR' }, resPunto('DISPONIBLE', 'C', { participantes: 1, cambiaRespectoDelOriginal: true })), vigente: null
  }
};

const entrada = (k, extra) => Object.assign({ wellId: W, location: ESC[k].loc, vigente: ESC[k].vigente, decisiones: ESC[k].vista }, extra || {});
const modelo = (k, extra) => {
  const m = U.ubicacionesConocidasLogic_construir(entrada(k, extra));
  ufdui.ufdui_aplicarDecisiones(m, ESC[k].vista, !!ESC[k].vigente);
  return m;
};
const ficha = (k, extra) => uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC[k].loc.ubicacionResuelta, vigente: ESC[k].vigente, decisiones: ESC[k].vista, ...(extra || {}) });
const bloque = (m) => U.ubicacionesConocidasLogic_htmlBloquePrincipal(m, { iconoUbicacion: '<svg id="ok"></svg>', iconoUbicacionWarn: '<svg id="warn"></svg>', iconoMaps: '<svg id="maps"></svg>' });
const operativas = (m) => m.fuentes.filter((f) => f.esOperativo).map((f) => f.id);
const texto = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

// =====================================================================================================================

describe('dominio compartido: ubicacionOperativaLogic_resolverFicha', () => {
  test.each([
    ['D', 'D', 'A'], ['C', 'C', 'A'], ['R', 'R', 'C'], ['V', 'V', 'CAMPO'], ['VR', 'V', 'CAMPO'], ['NV', 'V', 'CAMPO'],
    ['DESC1', 'C', 'A'], ['DESC2', 'D', 'C']
  ])('escenario %s -> estado operativo %s en %s', (k, codigo, donde) => {
    const r = ficha(k);
    expect(r.operativo).toBe(true);
    expect(r.codigo).toBe(codigo);
    const p = donde === 'CAMPO' ? CAMPO : wgs(PUNTO[donde]);
    expect(r.lat).toBe(p.lat);
    expect(r.lon).toBe(p.lon);
  });

  test.each([['N', 'TODAS_DESCARTADAS'], ['DISC', 'DISCREPANCIA']])('escenario %s -> SIN ubicacion operativa (%s), sin coordenada ni estado inventados', (k, motivo) => {
    const r = ficha(k);
    expect(r).toMatchObject({ operativo: false, codigo: null, lat: null, lon: null, motivoSinPunto: motivo, regla: 'R0_NINGUNA', capa: 'NINGUNA' });
  });

  test('jerarquia V > R > C | D > ninguna: la regla de cada nivel', () => {
    expect(ficha('V').regla).toBe('R1_CAMPO_VALIDADA');
    expect(ficha('R').regla).toBe('R1B_REGISTRAL_ACEPTADA');
    expect(ficha('C').regla).toBe('R2_BASE');
    expect(ficha('D').regla).toBe('R2_BASE');
    expect(ficha('N').regla).toBe('R0_NINGUNA');
  });

  test('V + R: el operativo es V; R queda como respaldo registral (con su clave) y la base de la V es R', () => {
    const r = ficha('VR');
    expect(r.codigo).toBe('V');
    expect(r.fuente).toBe('CAMPO_CORREGIDA');
    expect(r.respaldoRegistral).toEqual({ codigo: 'R', lat: wgs(C).lat, lon: wgs(C).lon, fuenteClave: clave('C') });
    expect(r.registral).toEqual(r.respaldoRegistral);
  });

  test('V revertida (la validada ya no es vigente): R pasa a ser el punto operativo; no se vuelve al automatico', () => {
    const conV = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC.VR.loc.ubicacionResuelta, vigente: vigente(), decisiones: ESC.VR.vista });
    const sinV = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC.VR.loc.ubicacionResuelta, vigente: null, decisiones: ESC.VR.vista });
    expect(conV.codigo).toBe('V');
    expect(sinV).toMatchObject({ codigo: 'R', lat: wgs(C).lat, lon: wgs(C).lon, fuenteClave: clave('C'), respaldoRegistral: null });
    expect(sinV.lat).not.toBe(wgs(A).lat);                       // NO volvio al automatico (A)
  });

  test('N + V: queda la V, sin respaldo registral (no hay punto registral debajo)', () => {
    const r = ficha('NV');
    expect(r).toMatchObject({ codigo: 'V', respaldoRegistral: null, registral: null });
  });

  test('una validada vencida / invalida / de otro pozo / sin coordenada de Mendoza no cuenta (sin lanzar)', () => {
    [vigente({ estado: 'REVERTIDA' }), vigente({ wellId: '14-0002' }), vigente({ lat: 10, lon: 10 }), vigente({ lat: 'x' }), 5, 'x', []].forEach((v) => {
      expect(uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC.C.loc.ubicacionResuelta, vigente: v, decisiones: null })).toMatchObject({ codigo: 'C' });
    });
  });

  test('wellId invalido o entrada rara: sin punto, sin lanzar', () => {
    [undefined, null, 5, 'x', [], {}].forEach((e) => {
      expect(uop.ubicacionOperativaLogic_resolverFicha(e)).toMatchObject({ operativo: false, codigo: null, lat: null, lon: null });
    });
    expect(uop.ubicacionOperativaLogic_resolverFicha({ wellId: 'zz', ubicacionResuelta: ESC.C.loc.ubicacionResuelta, decisiones: ESC.R.vista, vigente: vigente({ wellId: 'zz' }) })).toMatchObject({ operativo: false });
  });

  test('no muta ninguna de sus entradas', () => {
    const e = { wellId: W, ubicacionResuelta: ESC.VR.loc.ubicacionResuelta, vigente: vigente(), decisiones: ESC.VR.vista };
    const antes = JSON.stringify(e);
    uop.ubicacionOperativaLogic_resolverFicha(e);
    expect(JSON.stringify(e)).toBe(antes);
  });
});

describe('vista de decisiones -> delta registral (mismo contrato que el delta del mapa)', () => {
  const delta = (v) => uop.ubicacionOperativaLogic_deltaDeVistaDecisiones(W, v);

  test('ACEPTADA -> R, COINCIDENTE -> C, DISPONIBLE -> D, con coordenada y clave de la fuente', () => {
    expect(delta(ESC.R.vista)).toMatchObject({ entrada: { wellId: W, estado: 'R', lat: wgs(C).lat, lon: wgs(C).lon }, fuenteClave: clave('C'), motivo: null });
    expect(delta(ESC.DESC1.vista).entrada.estado).toBe('C');
    expect(delta(ESC.DESC2.vista).entrada.estado).toBe('D');
  });

  test('SIN_COORDENADAS / DISCREPANCIA sin punto -> N (con su motivo); nunca N por un dato roto', () => {
    expect(delta(ESC.N.vista)).toMatchObject({ entrada: { wellId: W, estado: 'N' }, motivoN: 'TODAS_DESCARTADAS' });
    expect(delta(ESC.DISC.vista)).toMatchObject({ entrada: { wellId: W, estado: 'N' }, motivoN: 'DISCREPANCIA' });
    expect(delta(vista({ A: 'DESCARTADA' }, resSinPunto('SIN_COORDENADAS', { todasDescartadas: false }))).motivoN).toBe('SIN_COORDENADAS');
  });

  test('una vista que no se puede interpretar se IGNORA (entrada null): ni R ni N inventadas', () => {
    const roto = (mut) => { const v = JSON.parse(JSON.stringify(ESC.R.vista)); mut(v); return delta(v); };
    expect(roto((v) => { v.integro = false; })).toMatchObject({ entrada: null, motivo: 'HISTORIAL_INCONSISTENTE' });
    expect(roto((v) => { v.wellId = '14-0002'; })).toMatchObject({ entrada: null, motivo: 'VISTA_INVALIDA' });
    expect(roto((v) => { v.fuentes = null; })).toMatchObject({ entrada: null, motivo: 'VISTA_INVALIDA' });
    expect(roto((v) => { v.version = 'x'; })).toMatchObject({ entrada: null, motivo: 'VISTA_INVALIDA' });
    expect(roto((v) => { delete v.resolucion; })).toMatchObject({ entrada: null, motivo: 'RESOLUCION_AUSENTE' });
    expect(roto((v) => { v.resolucion.estado = 'RARO'; })).toMatchObject({ entrada: null, motivo: 'ESTADO_DESCONOCIDO' });
    expect(roto((v) => { v.resolucion.operativo = false; })).toMatchObject({ entrada: null, motivo: 'RESOLUCION_INVALIDA' });
    expect(roto((v) => { v.resolucion.lat = 10; v.resolucion.lon = 10; })).toMatchObject({ entrada: null, motivo: 'RESOLUCION_INVALIDA' });
    expect(roto((v) => { v.resolucion = { estado: 'SIN_COORDENADAS', operativo: true }; })).toMatchObject({ entrada: null, motivo: 'RESOLUCION_INCOHERENTE' });
    expect(delta(null)).toMatchObject({ entrada: null, motivo: 'SIN_VISTA' });
    expect(delta(undefined).entrada).toBeNull();
    expect(delta(5).entrada).toBeNull();
  });

  test('con una vista inutilizable la ficha conserva base + V (comportamiento degradado seguro)', () => {
    const v = JSON.parse(JSON.stringify(ESC.VR.vista));
    v.integro = false;
    const r = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC.VR.loc.ubicacionResuelta, vigente: vigente(), decisiones: v });
    expect(r).toMatchObject({ codigo: 'V', respaldoRegistral: { codigo: 'C' }, decisionesAplicadas: false });
    const sinV = uop.ubicacionOperativaLogic_resolverFicha({ wellId: W, ubicacionResuelta: ESC.VR.loc.ubicacionResuelta, vigente: null, decisiones: v });
    expect(sinV).toMatchObject({ codigo: 'C', lat: wgs(A).lat });           // el automatico del padron, NO una R inventada
  });
});

describe('paridad ficha = mapa para D, C, R, V, V+R, N y N+V', () => {
  const baseDataset = (codigo, p) => ({ wellId: W, lat: wgs(p).lat, lon: wgs(p).lon, estado: codigo, cuenca: 'X', profundidad: 100, tramosFiltrantes: [], surgencia: null });
  const campo = () => [{ wellId: W, lat: CAMPO.lat, lon: CAMPO.lon, vts: '2026-10-13T12:00:00.000Z' }];
  // lo que el mapa recibe: el punto de pozos.json (D | C), el delta registral que emite el backend para ese pozo y la capa de campo
  const MAPA = {
    D: { base: baseDataset('D', A), delta: [], campo: [] },
    C: { base: baseDataset('C', A), delta: [], campo: [] },
    R: { base: baseDataset('C', A), delta: [{ wellId: W, estado: 'R', lat: wgs(C).lat, lon: wgs(C).lon }], campo: [] },
    V: { base: baseDataset('C', A), delta: [], campo: campo() },
    VR: { base: baseDataset('C', A), delta: [{ wellId: W, estado: 'R', lat: wgs(C).lat, lon: wgs(C).lon }], campo: campo() },
    N: { base: baseDataset('C', A), delta: [{ wellId: W, estado: 'N' }], campo: [] },
    NV: { base: baseDataset('C', A), delta: [{ wellId: W, estado: 'N' }], campo: campo() }
  };

  test.each(Object.keys(MAPA))('%s: la ficha y la composicion del mapa llegan al MISMO estado y al MISMO punto', (k) => {
    const m = MAPA[k];
    const mapa = uop.ubicacionOperativaLogic_aplicarCapas([m.base], m.delta, m.campo).pozos.filter((p) => p.wellId === W)[0] || null;
    const f = ficha(k);
    if (mapa === null) {
      expect(f.operativo).toBe(false);
    } else {
      expect(f.operativo).toBe(true);
      expect(f.codigo).toBe(mapa.estado);
      expect(f.lat).toBe(mapa.lat);
      expect(f.lon).toBe(mapa.lon);
      if (mapa.estado === 'V') {
        expect(f.respaldoRegistral === null ? null : { lat: f.respaldoRegistral.lat, lon: f.respaldoRegistral.lon, estado: f.respaldoRegistral.codigo }).toEqual(mapa.base);
      }
    }
  });

  test('el estado final es el mismo que cuenta el mapa en sus chips (D / C / R / V)', () => {
    ['D', 'C', 'R', 'V', 'VR'].forEach((k) => {
      const m = MAPA[k];
      const mapa = uop.ubicacionOperativaLogic_aplicarCapas([m.base], m.delta, m.campo).pozos;
      const conteo = require('./mapaLogic.js').mapaLogic_contarPorEstado(mapa);
      expect(conteo[ficha(k).codigo]).toBe(1);
    });
  });
});

describe('bloque principal de la ficha ("Ubicación de Irrigación")', () => {
  test.each([
    ['D', 'Disponible'], ['C', 'Coincidente'], ['R', 'Aceptada'], ['V', 'Validada en campo'], ['VR', 'Validada en campo'], ['NV', 'Validada en campo'], ['DESC2', 'Disponible']
  ])('escenario %s muestra el estado "%s" con su coordenada y el enlace a Google Maps', (k, etiqueta) => {
    const m = modelo(k);
    const h = bloque(m);
    expect(h).toContain('<strong>' + etiqueta + '</strong>');
    expect(h).toContain('data-ubic-estado="' + m.operativo.codigo + '"');
    expect(h).toContain(m.operativo.lat + ', ' + m.operativo.lon);
    expect(h).toContain('class="pin pin-ok"');
    expect((h.match(/Abrir en Google Maps/g) || []).length).toBe(1);
    expect(h).toContain(U.ubicacionesConocidasLogic_urlGoogleMaps(m.operativo.lat, m.operativo.lon).replace(/&/g, '&amp;'));
    expect(h).not.toContain('Sin ubicación operativa');
  });

  test('D: dice de que fuente sale; C: cuantos metros entre si; R: la fuente elegida; V: correccion validada', () => {
    expect(texto(bloque(modelo('D')))).toContain('Fuente: Reporte Pozos · sin corroborar por otra fuente.');
    expect(texto(bloque(modelo('C')))).toContain('2 o más fuentes independientes coinciden a 11 m entre sí.');
    expect(texto(bloque(modelo('R')))).toContain('Fuente registral elegida manualmente como referencia: Irrigación.');
    expect(texto(bloque(modelo('V')))).toContain('Corrección validada por un usuario autorizado.');
  });

  test('R muestra las x/y de SU fuente (no las del automatico); V no inventa x/y', () => {
    const r = bloque(modelo('R'));
    expect(r).toContain('x ' + posgar(C).x + ' / y ' + posgar(C).y);
    expect(r).not.toContain('x ' + posgar(A).x + ' / y ' + posgar(A).y);
    expect(bloque(modelo('V'))).not.toMatch(/ x \d+/);
  });

  test.each([['N', 'Todas las fuentes conocidas fueron descartadas'], ['DISC', 'no coinciden entre sí']])('escenario %s: "Sin ubicación operativa de Irrigación" y el motivo, sin coordenadas', (k, motivo) => {
    const m = modelo(k);
    const h = bloque(m);
    expect(m.sinOperativo).toBe(true);
    expect(h).toContain('<strong>Sin ubicación operativa de Irrigación</strong>');
    expect(texto(h)).toContain(motivo);
    expect(h).toContain('class="pin pin-warn"');
    expect(h).toContain('data-ubic-estado="N"');
    expect(h).not.toMatch(/coord-mono|maps-btn|-33\.\d/);                  // ninguna coordenada falsa o anterior como si fuera operativa
  });

  test('sin coordenadas en el padron: el texto de siempre ("no tiene una coordenada oficial"), con el titulo nuevo', () => {
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: { wellId: W, ubicacionResuelta: { estado: 'sinCoordenadas' } }, vigente: null, decisiones: null });
    const h = bloque(m);
    expect(h).toContain('<strong>Sin ubicación operativa de Irrigación</strong>');
    expect(texto(h)).toContain('Este pozo no tiene una coordenada oficial cargada.');
  });

  test('V + R: el bloque principal dice Validada en campo (no Aceptada) y no menciona el punto de R', () => {
    const h = bloque(modelo('VR'));
    expect(h).toContain('<strong>Validada en campo</strong>');
    expect(h).not.toContain('Aceptada');
    expect(h).not.toContain(String(wgs(C).lat));
  });

  test('el estado nunca sale como letra cruda ni como texto de otra etapa', () => {
    ['D', 'C', 'R', 'V', 'VR', 'N', 'NV', 'DISC'].forEach((k) => {
      const h = bloque(modelo(k));
      expect(h).not.toMatch(/Provincia|[Ee]liminad|confirmada|>[DCRVN]</);
    });
  });

  test('aviso discreto SOLO si las decisiones no se pudieron leer (y con el mismo texto del mapa); si no, ninguno', () => {
    const aviso = 'Algunas actualizaciones de ubicación no pudieron cargarse. Se muestra la información disponible.';
    expect(U.UCON_AVISO_DEGRADADO).toBe(aviso);
    expect(bloque(modelo('C'))).not.toContain(aviso);
    const h = bloque(modelo('C', { decisiones: null, decisionesFallo: true }));
    expect(h).toContain(aviso);
    expect((h.match(/role="status"/g) || []).length).toBe(1);
    expect(h).not.toMatch(/error|fall[óo]|excepci/i);
  });

  test('el texto del aviso es el mismo que el del mapa (index.html)', () => {
    expect(leer('..', 'index.html')).toContain(U.UCON_AVISO_DEGRADADO);
  });
});

describe('"Ubicaciones conocidas": que tarjeta lleva PUNTO OPERATIVO', () => {
  test.each([
    ['D', ['REPORTE_POZOS']], ['C', ['REPORTE_POZOS']], ['R', ['IRRIGACION_2']], ['V', ['CAMPO_VALIDADA']], ['VR', ['CAMPO_VALIDADA']], ['NV', ['CAMPO_VALIDADA']],
    ['N', []], ['DISC', []], ['DESC1', ['REPORTE_POZOS']], ['DESC2', ['IRRIGACION_2']]
  ])('escenario %s -> operativa: %j', (k, ids) => {
    const m = modelo(k);
    expect(operativas(m)).toEqual(ids);
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m, {});
    expect((h.match(/Punto operativo<\/span>/g) || []).length).toBe(ids.length);
  });

  test('R sin V: R lleva PUNTO OPERATIVO y las demas miden contra R', () => {
    const m = modelo('R');
    const c = m.fuentes.filter((f) => f.id === 'IRRIGACION_2')[0];
    expect(c.esOperativo).toBe(true);
    expect(c.distanciaOperativoM).toBeNull();
    ['REPORTE_POZOS', 'IRRIGACION_1'].forEach((id) => {
      const f = m.fuentes.filter((x) => x.id === id)[0];
      expect(f.distanciaOperativoM).toBeCloseTo(metros(wgs(C), f), 1);
    });
  });

  test('V + R: V lleva PUNTO OPERATIVO; la tarjeta de R sigue Aceptada, sin el chip, con el texto de respaldo; las distancias son contra V', () => {
    const m = modelo('VR');
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m, {});
    expect(operativas(m)).toEqual(['CAMPO_VALIDADA']);
    const r = m.fuentes.filter((f) => f.id === 'IRRIGACION_2')[0];
    expect(r.esOperativo).toBe(false);
    expect(r.respaldoRegistral).toBe('R');
    expect(r.decision.estado).toBe('ACEPTADA');
    const tarjetaR = h.split('<li class="ucon-fuente').filter((x) => x.indexOf('data-ucon-id="IRRIGACION_2"') !== -1)[0];
    expect(tarjetaR).toContain('>Aceptada<');
    expect(tarjetaR).not.toContain('Punto operativo');
    expect(tarjetaR).toContain('Aceptada como referencia registral. La ubicación operativa actual es la validada en campo.');
    expect(r.distanciaOperativoM).toBeCloseTo(metros(CAMPO, wgs(C)), 1);
    expect((h.match(/Aceptada como referencia registral/g) || []).length).toBe(1);        // una sola vez, no sobrecarga
  });

  test('el texto de respaldo solo aparece en una R bajo una V (no en R sin V, ni en una V sin R)', () => {
    ['R', 'V', 'D', 'C', 'N', 'NV'].forEach((k) => expect(U.ubicacionesConocidasLogic_htmlSeccion(modelo(k), {})).not.toContain('Aceptada como referencia registral'));
  });

  test('una fuente descartada NUNCA es punto operativo (ni se marca sola) y sigue visible con su coordenada original', () => {
    ['N', 'NV', 'DESC1', 'DESC2'].forEach((k) => {
      const m = modelo(k);
      const h = U.ubicacionesConocidasLogic_htmlSeccion(m, {});
      m.fuentes.filter((f) => f.decision && f.decision.estado === 'DESCARTADA').forEach((f) => {
        expect(f.esOperativo).toBe(false);
        expect(f.invalida).toBe(false);
        expect(h).toContain('data-ucon-id="' + f.id + '"');
        expect(h).toContain(f.lat + ', ' + f.lon);
        expect(h).toContain('ucon-descartada');
      });
    });
  });

  test('todas descartadas sin V: ninguna tarjeta es operativa, sin distancias, el aviso (una sola vez) y las tres fuentes visibles', () => {
    const m = modelo('N');
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m, {});
    expect(operativas(m)).toEqual([]);
    expect(m.fuentes.every((f) => f.distanciaOperativoM === null)).toBe(true);
    expect((h.match(/data-ucon-id=/g) || []).length).toBe(3);
    expect((h.match(/Sin ubicación operativa de Irrigación\. Todas las fuentes conocidas fueron descartadas/g) || []).length).toBe(1);
    expect(h).not.toContain('No hay punto operativo: las ubicaciones de las fuentes no coinciden');
  });

  test('todas descartadas: UN solo aviso de "sin punto operativo" en la seccion (no se repite el de las decisiones con el de la discrepancia)', () => {
    const h = U.ubicacionesConocidasLogic_htmlSeccion(modelo('N'), {});
    expect((h.match(/ucon-nota ucon-nota-aviso/g) || []).length).toBe(1);
    expect(h).not.toContain(U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS);
    // y sin el modulo de decisiones cargado (solo la logica pura) la nota propia ocupa su lugar: nunca queda sin explicar
    const sin = { ...modelo('N') };
    const guardadas = {};
    ['ufdui_htmlEstado', 'ufdui_htmlAcciones', 'ufdui_htmlHistoria', 'ufdui_htmlNotasSeccion', 'ufdui_htmlSugerencias'].forEach((n) => { guardadas[n] = global[n]; delete global[n]; });
    try {
      expect(U.ubicacionesConocidasLogic_htmlSeccion(sin, {})).toContain(U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS);
    } finally {
      Object.assign(global, guardadas);
    }
  });

  test('R y otra fuente en la MISMA coordenada: la tarjeta operativa es la de la clave que informa el backend, no "la primera que queda cerca"', () => {
    const p = posgar(A);
    const loc = { wellId: W, coordenadas: p, coordenadasProvincia: [p], ubicacionResuelta: location(['A'], { estado: 'unica', en: 'A' }).ubicacionResuelta };
    const clv = (tipo) => W + '|' + tipo + '|' + p.x.toFixed(3) + '|' + p.y.toFixed(3);
    const fuente = (tipo, estado, i) => ({ clave: clv(tipo), fuenteTipo: tipo, x: p.x, y: p.y, lat: wgs(A).lat, lon: wgs(A).lon, posicion: i, estado: estado, esAceptadaVigente: estado === 'ACEPTADA', esOperativa: false, ultima: null });
    const v = {
      wellId: W, version: 3, integro: true, padronPeriodo: '2026-09', obsoletas: [], historial: [], fuentes: [fuente('REPORTE_POZOS', 'SIN_REVISAR', 0), fuente('IRRIGACION', 'ACEPTADA', 1)],
      resolucion: { estado: 'ACEPTADA', nivel: null, regla: 'R1B_REGISTRAL_ACEPTADA', operativo: true, lat: wgs(A).lat, lon: wgs(A).lon, fuente: 'IRR_PROVINCIA', fuenteClave: clv('IRRIGACION'), todasDescartadas: false, participantes: 2, cambiaRespectoDelOriginal: true }
    };
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: loc, vigente: null, decisiones: v });
    expect(m.operativo.codigo).toBe('R');
    expect(operativas(m)).toEqual(['IRRIGACION_1']);
  });

  test('todas descartadas + V: V es operativa y las descartadas siguen visibles, medidas contra V', () => {
    const m = modelo('NV');
    expect(operativas(m)).toEqual(['CAMPO_VALIDADA']);
    m.fuentes.filter((f) => f.id !== 'CAMPO_VALIDADA').forEach((f) => expect(f.distanciaOperativoM).toBeCloseTo(metros(CAMPO, f), 1));
  });

  test('discrepancia remanente sin V: ninguna operativa, la nota de discrepancia y las fuentes visibles', () => {
    const m = modelo('DISC');
    const h = U.ubicacionesConocidasLogic_htmlSeccion(m, {});
    expect(operativas(m)).toEqual([]);
    expect(h).toContain(U.UCON_NOTA_SIN_OPERATIVO);
    expect((h.match(/data-ucon-id=/g) || []).length).toBe(2);
  });

  test('"Ver todas en el mapa" sigue ofrecido cuando no hay punto operativo pero hay fuentes validas', () => {
    expect(U.ubicacionesConocidasLogic_htmlSeccion(modelo('N'), {})).toContain('id="btn-ucon-ver-todas"');
  });

  test('leyenda del visor: una fila por fuente valida, "Punto operativo" solo en la operativa', () => {
    expect((U.ubicacionesConocidasLogic_htmlLeyenda(modelo('R')).match(/Punto operativo/g) || []).length).toBe(1);
    expect((U.ubicacionesConocidasLogic_htmlLeyenda(modelo('VR')).match(/Punto operativo/g) || []).length).toBe(1);
    expect(U.ubicacionesConocidasLogic_htmlLeyenda(modelo('N'))).not.toMatch(/Punto operativo<|> Punto operativo/);
    expect((U.ubicacionesConocidasLogic_htmlLeyenda(modelo('N')).match(/<li>/g) || []).length).toBe(3);
  });

  test('el popup de R lo marca operativo (sin V) y, bajo una V, aclara que sigue Aceptada como respaldo', () => {
    const r = modelo('R');
    expect(U.ubicacionesConocidasLogic_htmlPopup(r.fuentes.filter((f) => f.id === 'IRRIGACION_2')[0], { modelo: r })).toContain('Punto operativo');
    const vr = modelo('VR');
    const p = U.ubicacionesConocidasLogic_htmlPopup(vr.fuentes.filter((f) => f.id === 'IRRIGACION_2')[0], { modelo: vr });
    expect(p).not.toContain('Punto operativo');
    expect(p).toContain('Aceptada como referencia registral. La ubicación operativa actual es la validada en campo.');
  });

  test('la clase del marcador del visor marca al operativo (R o V) y a ninguno cuando no hay', () => {
    expect(operativas(modelo('R')).map((id) => U.ubicacionesConocidasLogic_claseMarcador(modelo('R').fuentes.filter((f) => f.id === id)[0]))[0]).toContain('ucon-marker-op');
    expect(modelo('N').fuentes.some((f) => U.ubicacionesConocidasLogic_claseMarcador(f).indexOf('ucon-marker-op') !== -1)).toBe(false);
  });
});

describe('copy humano', () => {
  const logica = leer('ubicacionesConocidasLogic.js');

  test('los textos pedidos, tal cual', () => {
    expect(U.UCON_TITULO_SIN_OPERATIVO).toBe('Sin ubicación operativa de Irrigación');
    expect(U.UCON_TEXTO_RESPALDO_REGISTRAL).toBe('Aceptada como referencia registral. La ubicación operativa actual es la validada en campo.');
    expect(uop.UOP_ETIQUETAS_CODIGO_CORTAS).toEqual({ D: 'Disponible', C: 'Coincidente', R: 'Aceptada', V: 'Validada en campo' });
  });

  test('ningun texto de la ficha llama "Provincia" al punto operativo, "validada" a una R ni "eliminada" a una fuente descartada', () => {
    const codigo = logica.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(codigo).not.toMatch(/\bProvincia\b|[Ee]liminad/);                  // (coordenadasProvincia es el nombre del dato del padron, no un texto)
    const textos = [U.UCON_TITULO_SIN_OPERATIVO, U.UCON_NOTA_SIN_OPERATIVO, U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS, U.UCON_NOTA_SIN_OPERATIVO_SIN_COORDENADAS, U.UCON_TEXTO_RESPALDO_REGISTRAL]
      .concat(Object.values(U.UCON_DETALLE_SIN_OPERATIVO));
    textos.forEach((t) => expect(t).not.toMatch(/\bProvincia\b|[Ee]liminad/));
    expect(bloque(modelo('R'))).not.toMatch(/valid/i);                               // una R no se llama "validada"
  });

  test('las descartadas se llaman "descartadas" y se dice que siguen visibles', () => {
    expect(U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS).toMatch(/descartadas/);
    expect(U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS).toMatch(/visibles/);
    expect(U.UCON_DETALLE_SIN_OPERATIVO.TODAS_DESCARTADAS).toMatch(/visibles/);
  });

  test('app.js ya no trae textos de estado propios (los pone la logica compartida) ni lee la ubicacion automatica para el bloque principal', () => {
    const app = leer('app.js');
    const render = app.slice(app.indexOf('function renderUbicacion'), app.indexOf('// --- Modulo Niveles Estaticos'));
    expect(render).not.toMatch(/Ubicación coincidente|Ubicación disponible|Ubicación a revisar|Sin ubicación de Irrigación|ubicacionResuelta|resuelta\./);
    expect(app).not.toMatch(/UBICACION_ESTADO_LABEL|FUENTE_LABEL/);
  });
});

describe('referencia registral para "Corregir ubicación" (solo informativa)', () => {
  test('sin cambios respecto del padron: null; R en otro punto: {R, lat, lon}; todas descartadas: {N}', () => {
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('D'))).toBeNull();
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('C'))).toBeNull();
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('DESC1'))).toBeNull();               // sigue siendo el mismo punto
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('R'))).toEqual({ tipo: 'R', lat: wgs(C).lat, lon: wgs(C).lon });
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('DESC2'))).toEqual({ tipo: 'D', lat: wgs(C).lat, lon: wgs(C).lon });
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('N'))).toEqual({ tipo: 'N' });
  });

  test('con una V encima, la referencia registral sigue siendo la R de abajo (la V no la oculta)', () => {
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('VR'))).toEqual({ tipo: 'R', lat: wgs(C).lat, lon: wgs(C).lon });
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('V'))).toBeNull();
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(modelo('NV'))).toEqual({ tipo: 'N' });
  });

  test('sin decisiones leidas no se afirma ningun cambio', () => {
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(U.ubicacionesConocidasLogic_construir({ wellId: W, location: ESC.R.loc, vigente: null, decisiones: null, decisionesFallo: true }))).toBeNull();
    expect(U.ubicacionesConocidasLogic_referenciaRegistral(null)).toBeNull();
  });

  test('texto del modal: informa la registral vigente y aclara que la comparacion sigue siendo contra la Irrigacion original; nada si no cambio', () => {
    expect(UC.ubicacionCorreccionLogic_textoRegistralVigente(null)).toBe('');
    expect(UC.ubicacionCorreccionLogic_textoRegistralVigente({ tipo: 'R', lat: -33.3488, lon: -69.144 })).toBe(
      'Ubicación registral vigente (Aceptada): -33.3488, -69.144. La comparación de tu corrección sigue usando la ubicación de Irrigación original.'
    );
    expect(UC.ubicacionCorreccionLogic_textoRegistralVigente({ tipo: 'D', lat: -33.3488, lon: -69.144 })).toContain('(Disponible)');
    expect(UC.ubicacionCorreccionLogic_textoRegistralVigente({ tipo: 'N' })).toMatch(/no hay una ubicación registral vigente/);
    ['x', {}, { tipo: 'Z', lat: 1, lon: 1 }, { tipo: 'R', lat: 'a', lon: 1 }, 5].forEach((i) => expect(UC.ubicacionCorreccionLogic_textoRegistralVigente(i)).toBe(''));
  });

  test('el dato historico no se toca: el front nunca manda irrLat/irrLon ni el backend de correcciones usa decisiones', () => {
    ['ubicacionCorreccion.js', 'ubicacionCorreccionLogic.js', 'api.js'].forEach((f) => expect(leer(f)).not.toMatch(/irrLat|irrLon/));
    const comparacion = leer('ubicacionCorreccion.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(comparacion).toMatch(/estado\.irrigacion = ubicacionCorreccionLogic_irrigacionDeUbicacion\(ap\.location\);/);
    expect(comparacion).toMatch(/irrigacion: estado\.irrigacion/);
    expect(comparacion).not.toMatch(/irrigacion: estado\.registral|estado\.irrigacion = .*registral/);
  });
});

// =====================================================================================================================
// CONTROLADOR ejecutado de verdad: DOM falso, Leaflet simulado y API falsa

const fuentesSrc = ['coordenadasConversion.js', 'ubicacionOperativaLogic.js', 'ubicacionFuenteDecisionesUiLogic.js', 'ubicacionesConocidasLogic.js', 'ubicacionFuenteDecisionesUi.js', 'ubicacionesConocidas.js'].map((f) => leer(f));
const htmlIndex = leer('..', 'index.html');
const OCULTOS_INICIAL = new Set();
htmlIndex.replace(/<[^>]*\sid="([^"]+)"[^>]*>/g, (tag, id) => { if (/\shidden(\s|>|=)/.test(tag)) { OCULTOS_INICIAL.add(id); } return tag; });
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };

function crearElemento(id) {
  const e = {
    id, hidden: false, textContent: '', innerHTML: '', value: '', disabled: false, listeners: {}, atributos: {},
    addEventListener(tipo, f) { (e.listeners[tipo] = e.listeners[tipo] || []).push(f); },
    emit(tipo, ev) { (e.listeners[tipo] || []).forEach((f) => f(ev || {})); },
    click() { e.emit('click', { target: e }); },
    focus() { e.enfocado = (e.enfocado || 0) + 1; },
    getAttribute(n) { return e.atributos[n] === undefined ? null : e.atributos[n]; }
  };
  return e;
}

function cargar(opc) {
  const o = opc || {};
  const els = {};
  const chips = [Object.assign(crearElemento('chip-calle'), { atributos: { 'data-capa': 'calle' } }), Object.assign(crearElemento('chip-sat'), { atributos: { 'data-capa': 'satelite' } })];
  const documento = {
    body: { classList: { add() {}, remove() {} }, contains: () => true },
    getElementById(id) {
      if (id === 'btn-ucon-ver-todas') {
        const cont = els['ubic-conocidas'];
        if (!cont || cont.innerHTML.indexOf('id="btn-ucon-ver-todas"') === -1) { return null; }
        if (!els[id] || els[id].html !== cont.innerHTML) { els[id] = crearElemento(id); els[id].html = cont.innerHTML; }
        return els[id];
      }
      if (!els[id]) { els[id] = crearElemento(id); els[id].hidden = OCULTOS_INICIAL.has(id); }
      return els[id];
    },
    querySelectorAll(sel) { return sel === '.ucon-capa-chip' ? chips : []; }
  };
  const reg = { marcadores: [] };
  const L = {
    map() { const m = { setView() { return m; }, fitBounds() { return m; }, panTo() { return m; }, on() { return m; }, invalidateSize() {} }; return m; },
    layerGroup() { const g = { capas: [], clearLayers() { g.capas = []; }, addTo() { return g; } }; return g; },
    divIcon(opciones) { return { divIcon: opciones }; },
    marker(latlng, opciones) {
      const mk = { latlng, opciones, popup: null, bindPopup(html) { mk.popup = html; return mk; }, openPopup() { return mk; }, getLatLng() { return latlng; }, addTo(d) { if (d && d.capas) { d.capas.push(mk); } return mk; } };
      reg.marcadores.push(mk);
      return mk;
    }
  };
  const ctx = vm.createContext({ console, Promise, JSON, Math, Date, Object, Array, String, Number, isFinite, parseInt, parseFloat, setTimeout });
  ctx.window = ctx;
  ctx.document = documento;
  ctx.L = L;
  ctx.MAPA_CAPA_BASE_DEFAULT = 'calle';
  ctx.mapaShared_cargarLibrerias = jest.fn(() => Promise.resolve());
  ctx.mapaShared_crearCapasBase = jest.fn(() => ({ calle: {}, satelite: {} }));
  ctx.mapaShared_alMostrarMapa = jest.fn((mapa, cb) => cb());
  ctx.mapaShared_cambiarCapaBase = jest.fn();
  const t = { ctx, reg, vista: null, lecturas: 0, el: (id) => documento.getElementById(id), permisos: o.permisos || { ubicacion: true, ubicacion_validar: true }, notificaciones: [] };
  ctx.apiGetDecisionesFuentesPozo = jest.fn(() => {
    t.lecturas += 1;
    if (t.falla === 'red') { return Promise.reject(new Error('sin red')); }
    if (t.falla === 'error') { return Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }); }
    if (t.falla === 'invalida') { return Promise.resolve({ status: 'ok', data: { wellId: 'otro' } }); }
    return Promise.resolve({ status: 'ok', data: JSON.parse(JSON.stringify(t.vista)) });
  });
  ctx.apiDecidirFuenteUbicacion = jest.fn((token, pedido) => Promise.resolve().then(() => t.alDecidir(pedido)));
  ctx.ubicacionCorreccionController_actualizarRegistral = jest.fn((w, info) => t.notificaciones.push({ w, info }));
  fuentesSrc.forEach((src) => vm.runInContext(src, ctx));
  ctx.ubicacionesConocidasController_inicializar(() => ({ sessionToken: 'tok', permisos: t.permisos, onSessionExpired: jest.fn() }));
  return t;
}

const abrir = async (t, k, opc) => {
  const o = opc || {};
  t.vista = o.vista || ESC[k].vista;
  t.falla = o.falla || null;
  t.el('ubic-conocidas');
  t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: o.loc || ESC[k].loc, iconoMaps: '<svg id="maps"></svg>', iconoUbicacion: '<svg id="ok"></svg>', iconoUbicacionWarn: '<svg id="warn"></svg>' });
  if (o.vigente !== false && ESC[k].vigente) { t.ctx.ubicacionesConocidasController_actualizarVigente(W, ESC[k].vigente); }
  await flush();
};
const principal = (t) => t.el('ubic-operativa').innerHTML;
const estadoPrincipal = (t) => (principal(t).match(/data-ubic-estado="(\w)"/) || [])[1];
const abrirVisor = async (t) => { t.el('btn-ucon-ver-todas').click(); await flush(); };
const marcador = (t, etiqueta) => t.reg.marcadores.filter((m) => m.opciones.title === etiqueta).pop();

describe('controlador: el bloque principal sigue a las decisiones y a la validada', () => {
  test.each([['D', 'D'], ['C', 'C'], ['R', 'R'], ['V', 'V'], ['VR', 'V'], ['N', 'N'], ['NV', 'V'], ['DISC', 'N']])('escenario %s: el bloque principal queda en %s', async (k, esperado) => {
    const t = cargar();
    await abrir(t, k);
    expect(estadoPrincipal(t)).toBe(esperado);
  });

  test('al abrir pinta YA el bloque con el padron (D/C) y despues, cuando llegan las decisiones, pasa a Aceptada', async () => {
    const t = cargar();
    t.vista = ESC.R.vista;
    t.el('ubic-conocidas');
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ESC.R.loc, iconoMaps: '', iconoUbicacion: '', iconoUbicacionWarn: '' });
    expect(estadoPrincipal(t)).toBe('C');                       // sincrono: nunca queda vacio
    await flush();
    expect(estadoPrincipal(t)).toBe('R');
  });

  test('la validada llega despues de la ficha: el bloque pasa a Validada en campo; si se revierte (vigente null), R vuelve a ser el punto operativo', async () => {
    const t = cargar();
    await abrir(t, 'R');
    expect(estadoPrincipal(t)).toBe('R');
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    expect(estadoPrincipal(t)).toBe('V');
    expect(t.el('ubic-conocidas').innerHTML).toContain('Aceptada como referencia registral. La ubicación operativa actual es la validada en campo.');
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, null);
    expect(estadoPrincipal(t)).toBe('R');
    expect(t.el('ubic-conocidas').innerHTML).not.toContain('Aceptada como referencia registral.');
    expect(principal(t)).toContain(String(wgs(C).lat));          // R, no el automatico (A)
    expect(principal(t)).not.toContain(String(wgs(A).lat));
  });

  test('validador y quien NO valida ven el MISMO punto operativo (los permisos solo cambian las acciones)', async () => {
    const a = cargar({ permisos: { ubicacion: true, ubicacion_validar: true } });
    const b = cargar({ permisos: { ubicacion: true, ubicacion_validar: false } });
    await abrir(a, 'VR');
    await abrir(b, 'VR');
    expect(principal(a)).toBe(principal(b));
    expect(a.el('ubic-conocidas').innerHTML).toContain('data-ufd-accion=');
    expect(b.el('ubic-conocidas').innerHTML).not.toMatch(/data-ufd-accion="(ACEPTAR|DESCARTAR|QUITAR_ACEPTACION|RESTAURAR)"/);
    const ops = (t) => (t.el('ubic-conocidas').innerHTML.match(/<li class="ucon-fuente ucon-operativa"[^>]*data-ucon-id="(\w+)"/g) || []).map((s) => s.match(/data-ucon-id="(\w+)"/)[1]);
    expect(ops(a)).toEqual(['CAMPO_VALIDADA']);
    expect(ops(b)).toEqual(['CAMPO_VALIDADA']);
    await abrir(a, 'R');
    await abrir(b, 'R');
    expect(principal(a)).toBe(principal(b));
    expect(estadoPrincipal(a)).toBe('R');
  });

  test('sin permiso de ubicacion: no se piden las decisiones y no hay aviso (no es una falla); el bloque muestra base + V', async () => {
    const t = cargar({ permisos: { ubicacion: false } });
    await abrir(t, 'VR');
    expect(t.lecturas).toBe(0);
    expect(estadoPrincipal(t)).toBe('V');
    expect(principal(t)).not.toContain('no pudieron cargarse');
  });

  test.each([['red'], ['error'], ['invalida']])('falla de las decisiones (%s): base + V, aviso discreto, sin inventar R ni N, sin mensajes tecnicos', async (falla) => {
    const t = cargar();
    await abrir(t, 'R', { falla });
    expect(estadoPrincipal(t)).toBe('C');                                     // el automatico del padron, NO una Aceptada
    expect(principal(t)).toContain('Algunas actualizaciones de ubicación no pudieron cargarse. Se muestra la información disponible.');
    expect(principal(t)).not.toMatch(/SERVICE_UNAVAILABLE|sin red|Error|undefined|null/);
    expect(t.el('ubic-conocidas').innerHTML).toContain('data-ucon-id="REPORTE_POZOS"');            // la ficha NO se bloquea: las fuentes se listan igual
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, vigente());
    expect(estadoPrincipal(t)).toBe('V');                                     // y la V sigue disponible
    expect(principal(t)).toContain('no pudieron cargarse');
  });

  test('la falla de las decisiones sobre un pozo con todas descartadas NO lo vuelve "sin ubicacion": muestra el automatico', async () => {
    const t = cargar();
    await abrir(t, 'N', { falla: 'red' });
    expect(estadoPrincipal(t)).toBe('C');
    expect(principal(t)).not.toContain('Sin ubicación operativa');
  });

  test('una relectura fallida NO borra la ultima vista buena (sigue Aceptada) y avisa', async () => {
    const t = cargar();
    await abrir(t, 'R');
    expect(estadoPrincipal(t)).toBe('R');
    t.falla = 'red';
    await t.ctx.ubicacionesConocidasController_refrescar(W);
    await flush();
    expect(estadoPrincipal(t)).toBe('R');
    expect(principal(t)).toContain('no pudieron cargarse');
    t.falla = null;
    await t.ctx.ubicacionesConocidasController_refrescar(W);
    await flush();
    expect(principal(t)).not.toContain('no pudieron cargarse');
  });

  test('un abrir de OTRA ficha descarta una respuesta tardia: no pinta el estado del pozo anterior', async () => {
    const t = cargar();
    t.vista = ESC.R.vista;
    t.el('ubic-conocidas');
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: ESC.R.loc, iconoMaps: '', iconoUbicacion: '', iconoUbicacionWarn: '' });
    t.ctx.ubicacionesConocidasController_abrir({ wellId: '14-0002', location: { wellId: '14-0002', ubicacionResuelta: { estado: 'sinCoordenadas' } }, iconoMaps: '', iconoUbicacion: '', iconoUbicacionWarn: '' });
    await flush();
    expect(estadoPrincipal(t)).toBe('N');
    expect(principal(t)).toContain('Sin ubicación operativa de Irrigación');
  });

  test('Corregir ubicacion se entera de la registral vigente solo cuando cambio (R, descartadas) y no cuando es la del padron', async () => {
    const t = cargar();
    await abrir(t, 'R');
    expect(t.notificaciones[t.notificaciones.length - 1]).toEqual({ w: W, info: { tipo: 'R', lat: wgs(C).lat, lon: wgs(C).lon } });
    await abrir(t, 'C');
    expect(t.notificaciones[t.notificaciones.length - 1].info).toBeNull();
    await abrir(t, 'N');
    expect(t.notificaciones[t.notificaciones.length - 1].info).toEqual({ tipo: 'N' });
  });

  test('sin el modulo de correcciones cargado no se rompe nada', async () => {
    const t = cargar();
    delete t.ctx.ubicacionCorreccionController_actualizarRegistral;
    await abrir(t, 'R');
    expect(estadoPrincipal(t)).toBe('R');
  });
});

describe('controlador: refresco tras una decision (sin tocar la invalidacion del mapa)', () => {
  function boton(accion, fuenteId) {
    const b = { atributos: { 'data-ufd-accion': accion, 'data-ufd-fuente': fuenteId }, getAttribute: (n) => (b.atributos[n] === undefined ? null : b.atributos[n]), closest: (sel) => (sel === '[data-ufd-accion]' ? b : null) };
    return b;
  }

  test('el validador acepta una fuente: el bloque principal pasa a Aceptada con la vista nueva que devuelve el backend', async () => {
    const t = cargar();
    const vistaInicial = vista({ A: 'SIN_REVISAR', B: 'SIN_REVISAR' }, resPunto('COINCIDENTE', 'A'));
    await abrir(t, 'C', { vista: vistaInicial });
    expect(estadoPrincipal(t)).toBe('C');
    t.alDecidir = () => ({ status: 'ok', data: Object.assign({}, vista({ A: 'SIN_REVISAR', B: 'ACEPTADA' }, resPunto('ACEPTADA', 'B', { participantes: 2 })), { version: 8, decision: { secuencia: 8, evento: 'X' }, duplicada: false }) });
    t.el('ubic-conocidas').emit('click', { target: boton('ACEPTAR', 'IRRIGACION_1') });
    await flush();
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(estadoPrincipal(t)).toBe('R');
    expect(principal(t)).toContain(String(wgs(B).lat));
  });

  test('el validador descarta todas: el bloque principal pasa a "Sin ubicación operativa de Irrigación" y las tarjetas siguen ahi', async () => {
    const t = cargar();
    t.vista = vista({ A: 'DESCARTADA', B: 'SIN_REVISAR' }, resPunto('DISPONIBLE', 'B', { participantes: 1 }));
    t.alDecidir = () => ({ status: 'ok', data: Object.assign({}, vista({ A: 'DESCARTADA', B: 'DESCARTADA' }, resSinPunto('SIN_COORDENADAS')), { version: 9, decision: { secuencia: 9, evento: 'X' }, duplicada: false }) });
    t.ctx.ubicacionesConocidasController_abrir && null;
    t.el('ubic-conocidas');
    t.ctx.ubicacionesConocidasController_abrir({ wellId: W, location: location(['A', 'B'], { estado: 'corroborada', en: 'A' }), iconoMaps: '', iconoUbicacion: '', iconoUbicacionWarn: '' });
    await flush();
    expect(estadoPrincipal(t)).toBe('D');
    t.el('ubic-conocidas').emit('click', { target: boton('DESCARTAR', 'IRRIGACION_1') });
    await flush();
    t.el('ufd-motivo').value = 'cae en el río';
    t.el('btn-ufd-confirmar').click();
    await flush();
    expect(estadoPrincipal(t)).toBe('N');
    expect((t.el('ubic-conocidas').innerHTML.match(/data-ucon-id=/g) || []).length).toBe(2);
  });

  test('no cablea la invalidacion del mapa (eso es E3-6): el controlador no llama a mapaDataset_invalidar*', () => {
    ['ubicacionesConocidas.js', 'ubicacionFuenteDecisionesUi.js', 'ubicacionSugerencias.js'].forEach((f) => {
      expect(leer(f)).not.toMatch(/mapaDataset_invalidar/);
    });
  });
});

describe('visor comparativo (Ver todas en el mapa)', () => {
  const textoNota = (t) => t.el('ucon-visor-nota').textContent;
  const icono = (mk) => mk.opciones.icon.divIcon.html;

  test('R sin V: el marcador de R es el operativo (arriba, con estrella) y las demas miden contra R', async () => {
    const t = cargar();
    await abrir(t, 'R');
    await abrirVisor(t);
    const r = marcador(t, 'Irrigación (2)');
    expect(r.opciones.zIndexOffset).toBe(1000);
    expect(icono(r)).toContain('Irrigación (2) ★');
    expect(icono(r)).toContain('ucon-marker-op');
    ['Reporte Pozos', 'Irrigación (1)'].forEach((n) => {
      const m = marcador(t, n);
      expect(m.opciones.zIndexOffset).toBe(300);
      expect(icono(m)).not.toContain('★');
      expect(m.popup).toContain(U.ubicacionesConocidasLogic_textoDistancia(metros(wgs(C), n === 'Reporte Pozos' ? wgs(A) : wgs(B))));
    });
    expect(r.popup).toContain('Punto operativo');
    const leyenda = t.el('ucon-leyenda').innerHTML;
    expect((leyenda.match(/Punto operativo/g) || []).length).toBe(1);
    expect(textoNota(t)).toBe('');
  });

  test('V + R: el marcador de V es el operativo; el de R NO, y su popup dice que sigue Aceptada como respaldo; las distancias son contra V', async () => {
    const t = cargar();
    await abrir(t, 'VR');
    await abrirVisor(t);
    const v = marcador(t, 'Validada en campo');
    expect(v.opciones.zIndexOffset).toBe(1000);
    expect(icono(v)).toContain('Validada en campo ★');
    const r = marcador(t, 'Irrigación (2)');
    expect(r.opciones.zIndexOffset).toBe(300);
    expect(icono(r)).not.toContain('★');
    expect(r.popup).not.toContain('Punto operativo');
    expect(r.popup).toContain('Aceptada como referencia registral. La ubicación operativa actual es la validada en campo.');
    expect(r.popup).toContain(U.ubicacionesConocidasLogic_textoDistancia(metros(CAMPO, wgs(C))));
    expect(r.popup).toContain('>Aceptada<');
  });

  test('sin punto operativo (todas descartadas): los marcadores se muestran igual, NINGUNO es operativo, sin distancias, sin centro inventado', async () => {
    const t = cargar();
    await abrir(t, 'N');
    await abrirVisor(t);
    ['Reporte Pozos', 'Irrigación (1)', 'Irrigación (2)'].forEach((n) => {
      const m = marcador(t, n);
      expect(m).toBeTruthy();
      expect(m.opciones.zIndexOffset).toBe(300);
      expect(icono(m)).not.toMatch(/★|ucon-marker-op/);
      expect(m.popup).not.toMatch(/Punto operativo|del punto operativo/);
      expect(m.popup).toContain('>Descartada<');
    });
    expect(t.reg.marcadores.length).toBe(3);
    expect(t.el('ucon-leyenda').innerHTML).not.toMatch(/Punto operativo/);
    expect(textoNota(t)).toBe(U.UCON_NOTA_SIN_OPERATIVO_DESCARTADAS);
    expect(textoNota(t)).not.toContain('no coinciden entre sí');
    expect(t.el('ucon-visor-nota').hidden).toBe(false);
  });

  test('discrepancia remanente: ninguna operativa y la nota de discrepancia', async () => {
    const t = cargar();
    await abrir(t, 'DISC');
    await abrirVisor(t);
    expect(t.reg.marcadores.length).toBe(2);
    expect(t.reg.marcadores.every((m) => m.opciones.zIndexOffset === 300)).toBe(true);
    expect(textoNota(t)).toBe(U.UCON_NOTA_SIN_OPERATIVO);
  });

  test('todas descartadas + V: V es el operativo y las descartadas siguen en el mapa', async () => {
    const t = cargar();
    await abrir(t, 'NV');
    await abrirVisor(t);
    expect(marcador(t, 'Validada en campo').opciones.zIndexOffset).toBe(1000);
    expect(t.reg.marcadores.length).toBe(4);
    expect(marcador(t, 'Irrigación (2)').opciones.zIndexOffset).toBe(300);
  });

  test('abierto el visor, revertir la V lo repinta: R pasa a ser el operativo (sin mover el mapa)', async () => {
    const t = cargar();
    await abrir(t, 'VR');
    await abrirVisor(t);
    expect(marcador(t, 'Validada en campo').opciones.zIndexOffset).toBe(1000);
    t.ctx.ubicacionesConocidasController_actualizarVigente(W, null);
    const r = marcador(t, 'Irrigación (2)');
    expect(r.opciones.zIndexOffset).toBe(1000);
    expect(icono(r)).toContain('★');
    expect(t.el('ucon-leyenda').innerHTML).not.toContain('Validada en campo');
  });
});

describe('no regresion de acciones existentes', () => {
  test('el validador sigue viendo Quitar aceptacion / Descartar en R y Restaurar en una descartada (las acciones no dependen de cual es el punto operativo)', async () => {
    const t = cargar();
    await abrir(t, 'VR');
    const h = t.el('ubic-conocidas').innerHTML;
    const tarjeta = (id) => '<li class="ucon-fuente' + h.split('<li class="ucon-fuente').filter((x) => x.indexOf('data-ucon-id="' + id + '"') !== -1)[0];
    expect(tarjeta('IRRIGACION_2')).toMatch(/data-ufd-accion="QUITAR_ACEPTACION"/);
    expect(tarjeta('IRRIGACION_2')).toMatch(/data-ufd-accion="DESCARTAR"/);
    expect(tarjeta('CAMPO_VALIDADA')).not.toMatch(/data-ufd-accion/);               // la validada en campo nunca tiene acciones
    await abrir(t, 'N');
    const hn = t.el('ubic-conocidas').innerHTML;
    expect((hn.match(/data-ufd-accion="RESTAURAR"/g) || []).length).toBe(3);
  });

  test('el contrato del modelo de siempre se conserva: fuentes, validas, operativo.{lat,lon,fuenteId,estado,etiquetaEstado,regla}, sinOperativo', () => {
    const m = modelo('C');
    expect(Object.keys(m.operativo)).toEqual(expect.arrayContaining(['lat', 'lon', 'fuenteId', 'estado', 'etiquetaEstado', 'regla']));
    expect(m).toMatchObject({ validas: 2, sinOperativo: false, wellId: W });
    expect(m.operativo).toMatchObject({ estado: 'COINCIDENTE', etiquetaEstado: 'Ubicación coincidente', regla: 'R2_BASE', fuenteId: 'REPORTE_POZOS' });
    expect(modelo('V').operativo).toMatchObject({ estado: 'VALIDADA_CAMPO', regla: 'R1_CAMPO_VALIDADA', fuenteId: 'CAMPO_VALIDADA' });
  });

  test('la ficha no toca el backend ni el delta del mapa: el modulo del bloque principal solo lee', () => {
    ['ubicacionesConocidasLogic.js', 'ubicacionOperativaLogic.js'].forEach((f) => {
      const c = leer(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      expect(c).not.toMatch(/\bapi[A-Z]\w+\(|callBackend|fetch\(|mapaDataset/);
    });
    const ctrl = leer('ubicacionesConocidas.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(ctrl).not.toMatch(/apiDecidir.*\n.*mapaDataset|getDecisionesFuentesDelta|apiGetDecisionesFuentesDelta/);
  });
});

describe('responsive y accesibilidad del bloque (estructura)', () => {
  const css = leer('..', 'css', 'styles.css');

  test('el bloque principal reutiliza las clases que ya hacen wrap (ubic-row / ubic-text / coord-mono) y no tiene anchos fijos', () => {
    const h = bloque(modelo('VR'));
    expect(h).toMatch(/class="ubic-row ubic-operativa-fila"/);
    expect(h).toContain('class="ubic-text"');
    expect(h).not.toMatch(/style=|width=|<table/);
    const regla = (css.match(/\.ubic-text \{[^}]*\}/) || [''])[0];
    expect(regla).not.toMatch(/\bwidth:\s*\d|min-width/);
    expect((css.match(/\.ucon-respaldo \{[^}]*\}/) || [''])[0]).toMatch(/font-size: 0\.72rem/);
    expect(css).toMatch(/\.ucorr-registral\[hidden\] \{\s*display: none;/);
  });

  test('el aviso y los textos nuevos son parrafos / bloques de texto con role=status solo el aviso; las coordenadas largas pueden cortar', () => {
    expect((bloque(modelo('C', { decisiones: null, decisionesFallo: true })).match(/role="status"/g) || []).length).toBe(1);
    expect((css.match(/\.ucorr-registral \{[^}]*\}/) || [''])[0]).toMatch(/overflow-wrap: anywhere/);
  });

  test('el contenedor del bloque principal existe en el DOM de la ficha y los de "Corregir ubicacion" estan en index.html', () => {
    const app = leer('app.js');
    expect(app).toContain('<div id="ubic-operativa" class="ubic-operativa"></div>');
    expect(htmlIndex).toMatch(/<p id="ucorr-registral" class="ucorr-registral" hidden><\/p>/);
    expect(htmlIndex.indexOf('id="ucorr-irrigacion"')).toBeLessThan(htmlIndex.indexOf('id="ucorr-registral"'));
  });

  test('los iconos del bloque son decorativos (los pone app.js) y el estado esta SIEMPRE escrito: no depende del color ni del icono', () => {
    ['D', 'C', 'R', 'V', 'N'].forEach((k) => {
      const t = texto(bloque(modelo(k)));
      expect(t).toMatch(/Disponible|Coincidente|Aceptada|Validada en campo|Sin ubicación operativa de Irrigación/);
    });
  });
});
