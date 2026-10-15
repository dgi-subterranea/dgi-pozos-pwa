// Decisiones sobre fuentes registrales (aceptar / descartar / restaurar / quitar aceptacion): dominio puro. Identidad, eventos, estados derivados, transiciones,
// una sola aceptada por pozo, resolver registral, reindexado, orden por secuencia y errores de dominio. (La paridad con el resolver de Python esta en
// js/ubicacionFuenteDecisionesParidad.test.js.)
const fs = require('fs');
const path = require('path');

Object.assign(global, require('./coordenadasConversion.js'));
const U = require('./ubicacionFuenteDecisionesLogic.js');
const uop = require('./ubicacionOperativaLogic.js');

const WELL = '14-0001';
const MOT = 'No corresponde a la boca del pozo';

// Las tres fuentes del caso 14-0001: Reporte Pozos + Irrigacion (1) coinciden (5 m) e Irrigacion (2) esta a ~170 m.
const P_REPORTE = { x: 2486460.782, y: 6310651.228 };
const P_IRR1 = { x: 2486464.782, y: 6310654.228 };
const P_IRR2 = { x: 2486590.782, y: 6310541.228 };
const location = (extra) => Object.assign({ coordenadas: P_REPORTE, coordenadasProvincia: [P_IRR1, P_IRR2] }, extra || {});
const fuentesDe = (loc) => U.ufd_fuentesDePadron(WELL, loc === undefined ? location() : loc).fuentes;

const K_REP = U.ufd_claveFuente(WELL, 'REPORTE_POZOS', P_REPORTE.x, P_REPORTE.y);
const K_I1 = U.ufd_claveFuente(WELL, 'IRRIGACION', P_IRR1.x, P_IRR1.y);
const K_I2 = U.ufd_claveFuente(WELL, 'IRRIGACION', P_IRR2.x, P_IRR2.y);

const ev = (secuencia, evento, tipo, p, motivo, extra) => Object.assign({
  secuencia: secuencia, evento: evento, wellId: WELL, fuenteTipo: tipo, x: p.x, y: p.y, motivo: motivo === undefined ? (evento === 'DESCARTADA' ? MOT : '') : motivo,
  timestamp: '2026-10-14T12:00:00.000Z', email: 'x@dgi.gob.ar', nombre: 'Persona'
}, extra || {});
const ACEPTA = (s, tipo, p) => ev(s, 'ACEPTADA', tipo, p);
const DESCARTA = (s, tipo, p, m) => ev(s, 'DESCARTADA', tipo, p, m);
const QUITA = (s, tipo, p) => ev(s, 'ACEPTACION_QUITADA', tipo, p);
const RESTAURA = (s, tipo, p) => ev(s, 'RESTAURADA', tipo, p);
const REP = 'REPORTE_POZOS';
const IRR = 'IRRIGACION';

const derivar = (eventos, loc) => U.ufd_derivar({ wellId: WELL, eventos: eventos, fuentes: fuentesDe(loc) });
const estadoDe = (st, clave) => st.fuentes.filter((f) => f.clave === clave)[0].estado;
const decidir = (st, decision, tipo, p, motivo, version) => U.ufd_decidir(st, { decision: decision, fuenteTipo: tipo, x: p.x, y: p.y, motivo: motivo, versionVista: version === undefined ? st.version : version });

describe('identidad canonica de la fuente', () => {
  test('wellId|TIPO|x|y con x e y a 3 decimales', () => {
    expect(K_REP).toBe('14-0001|REPORTE_POZOS|2486460.782|6310651.228');
    expect(U.ufd_claveFuente(WELL, 'IRRIGACION', 2486460.7, 6310651)).toBe('14-0001|IRRIGACION|2486460.700|6310651.000');
  });

  test('el ruido de coma flotante y el formato numerico no cambian la identidad', () => {
    expect(U.ufd_claveFuente(WELL, REP, 2486460.7820000001, 6310651.228)).toBe(K_REP);
    expect(U.ufd_claveFuente(WELL, REP, '2486460.782', ' 6310651.2280 ')).toBe(K_REP);
    expect(U.ufd_claveFuente(WELL, REP, 2486460.78200001, 6310651.22799999)).toBe(K_REP);
  });

  test('un milimetro de diferencia SI es otra fuente', () => {
    expect(U.ufd_claveFuente(WELL, REP, 2486460.783, 6310651.228)).not.toBe(K_REP);
    expect(U.ufd_claveFuente(WELL, REP, 2486460.782, 6310651.229)).not.toBe(K_REP);
  });

  test('el tipo y el pozo forman parte de la identidad: Reporte e Irrigacion en la misma coordenada son fuentes distintas', () => {
    expect(U.ufd_claveFuente(WELL, REP, P_REPORTE.x, P_REPORTE.y)).not.toBe(U.ufd_claveFuente(WELL, IRR, P_REPORTE.x, P_REPORTE.y));
    expect(U.ufd_claveFuente('01-0012', REP, P_REPORTE.x, P_REPORTE.y)).not.toBe(K_REP);
  });

  test('la etiqueta posicional «Irrigacion (2)» NO es identidad: intercambiar el orden en el padron no cambia las claves', () => {
    const a = fuentesDe(location({ coordenadasProvincia: [P_IRR1, P_IRR2] })).map((f) => f.clave).sort();
    const b = fuentesDe(location({ coordenadasProvincia: [P_IRR2, P_IRR1] })).map((f) => f.clave).sort();
    expect(a).toEqual(b);
  });

  test('entradas invalidas -> null (nunca una clave a medias)', () => {
    [['x', REP, 1, 1], [WELL, 'OTRO', 1, 1], [WELL, REP, NaN, 1], [WELL, REP, 1, null], [WELL, REP, 'abc', 1], [WELL, REP, Infinity, 1], ['99-0001', REP, 1, 1], [undefined, REP, 1, 1]]
      .forEach((a) => expect(U.ufd_claveFuente(a[0], a[1], a[2], a[3])).toBeNull());
  });

  test('-0 y numeros pequenos negativos no producen «-0.000»', () => {
    expect(U.ufd_claveFuente(WELL, REP, -0, 0)).toBe('14-0001|REPORTE_POZOS|0.000|0.000');
    expect(U.ufd_claveFuente(WELL, REP, -0.0001, 0)).toBe('14-0001|REPORTE_POZOS|0.000|0.000');
  });

  test('partesDeClave deshace la clave', () => {
    expect(U.ufd_partesDeClave(K_I1)).toEqual({ wellId: WELL, tipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y });
    expect(U.ufd_partesDeClave('roto')).toBeNull();
  });

  test('fuentesDePadron: Reporte primero, luego Irrigacion en su orden; con lat/lon; omite lo invalido con una anomalia', () => {
    const r = U.ufd_fuentesDePadron(WELL, location({ coordenadasProvincia: [P_IRR1, { x: null, y: 5 }, P_IRR2] }));
    expect(r.fuentes.map((f) => f.clave)).toEqual([K_REP, K_I1, K_I2]);
    expect(r.fuentes.map((f) => f.posicion)).toEqual([0, 1, 3]);
    expect(r.anomalias).toEqual([{ codigo: 'FUENTE_SIN_COORDENADA_VALIDA', tipo: 'IRRIGACION', posicion: 2 }]);
    expect(r.fuentes[0].lat).toBeCloseTo(-33.3476, 3);
    expect(U.ufd_fuentesDePadron(WELL, null).fuentes).toEqual([]);
    expect(U.ufd_fuentesDePadron(WELL, { coordenadas: null, coordenadasProvincia: 'no' }).fuentes).toEqual([]);
  });
});

describe('estados derivados y eventos', () => {
  test('sin eventos: todas las fuentes SIN_REVISAR, version 0, historial vacio, pozo integro', () => {
    const st = derivar([]);
    expect(st.integro).toBe(true);
    expect(st.version).toBe(0);
    expect(st.fuentes.map((f) => f.estado)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(st.aceptadaClave).toBeNull();
    expect(st.historial).toEqual([]);
    expect(st.obsoletas).toEqual([]);
  });

  test('ACEPTADA -> la fuente queda aceptada y es la vigente', () => {
    const st = derivar([ACEPTA(1, IRR, P_IRR1)]);
    expect(estadoDe(st, K_I1)).toBe('ACEPTADA');
    expect(st.aceptadaClave).toBe(K_I1);
    expect(st.fuentes.filter((f) => f.esAceptadaVigente).map((f) => f.clave)).toEqual([K_I1]);
    expect(st.version).toBe(1);
  });

  test('DESCARTADA -> descartada; las demas siguen sin revisar', () => {
    const st = derivar([DESCARTA(1, IRR, P_IRR2)]);
    expect(estadoDe(st, K_I2)).toBe('DESCARTADA');
    expect(estadoDe(st, K_REP)).toBe('SIN_REVISAR');
    expect(st.aceptadaClave).toBeNull();
  });

  test('ACEPTACION_QUITADA: ACEPTADA -> SIN_REVISAR (no queda descartada)', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), QUITA(2, REP, P_REPORTE)]);
    expect(estadoDe(st, K_REP)).toBe('SIN_REVISAR');
    expect(st.aceptadaClave).toBeNull();
    expect(st.historial[1].quitaAceptacion).toBe(true);
  });

  test('RESTAURADA: DESCARTADA -> SIN_REVISAR (NO queda aceptada)', () => {
    const st = derivar([DESCARTA(1, IRR, P_IRR1), RESTAURA(2, IRR, P_IRR1)]);
    expect(estadoDe(st, K_I1)).toBe('SIN_REVISAR');
    expect(st.aceptadaClave).toBeNull();
  });

  test('aceptar otra fuente: la anterior deja de ser vigente SIN un evento extra; la historia queda inequivoca', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), ACEPTA(2, IRR, P_IRR1)]);
    expect(estadoDe(st, K_REP)).toBe('SIN_REVISAR');
    expect(estadoDe(st, K_I1)).toBe('ACEPTADA');
    expect(st.aceptadaClave).toBe(K_I1);
    expect(st.historial).toHaveLength(2);                                       // dos filas, no tres
    expect(st.historial[0]).toMatchObject({ evento: 'ACEPTADA', clave: K_REP, reemplazadaPor: K_I1, reemplazaA: null });
    expect(st.historial[1]).toMatchObject({ evento: 'ACEPTADA', clave: K_I1, reemplazaA: K_REP, reemplazadaPor: null });
  });

  test('descartar la fuente ACEPTADA, en un solo evento: deja de estar aceptada Y queda excluida', () => {
    const st = derivar([ACEPTA(1, IRR, P_IRR1), DESCARTA(2, IRR, P_IRR1)]);
    expect(estadoDe(st, K_I1)).toBe('DESCARTADA');
    expect(st.aceptadaClave).toBeNull();
    expect(st.historial).toHaveLength(2);
    expect(st.historial[1].descartaLaAceptada).toBe(true);
    expect(st.historial[1].motivo).toBe(MOT);
  });

  test('descartar una fuente que NO es la aceptada no toca a la aceptada', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2)]);
    expect(st.aceptadaClave).toBe(K_REP);
    expect(st.historial[1].descartaLaAceptada).toBe(false);
  });

  test('aceptar, quitar y volver a aceptar la misma fuente es valido; el historial anota solo el ACEPTADA vigente al reemplazar', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), QUITA(2, REP, P_REPORTE), ACEPTA(3, REP, P_REPORTE), ACEPTA(4, IRR, P_IRR1)]);
    expect(st.historial.map((h) => h.reemplazadaPor)).toEqual([null, null, K_I1, null]);
    expect(st.aceptadaClave).toBe(K_I1);
  });

  test('descartada -> restaurada -> aceptada es el camino para aceptar una descartada', () => {
    const st = derivar([DESCARTA(1, IRR, P_IRR1), RESTAURA(2, IRR, P_IRR1), ACEPTA(3, IRR, P_IRR1)]);
    expect(estadoDe(st, K_I1)).toBe('ACEPTADA');
  });

  test('el historial conserva TODO en orden, con motivo y marca de obsoleta', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2), RESTAURA(3, IRR, P_IRR2)]);
    expect(st.historial.map((h) => [h.secuencia, h.evento, h.clave])).toEqual([[1, 'ACEPTADA', K_REP], [2, 'DESCARTADA', K_I2], [3, 'RESTAURADA', K_I2]]);
    expect(st.historial.every((h) => h.obsoleta === false)).toBe(true);
  });
});

describe('transiciones validas e invalidas (solicitudes)', () => {
  const V0 = () => derivar([]);

  test('SIN_REVISAR: aceptar y descartar valen; restaurar y quitar dicen que ya esta asi', () => {
    expect(decidir(V0(), 'ACEPTAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, MOT).ok).toBe(true);
    expect(decidir(V0(), 'RESTAURAR', REP, P_REPORTE).codigo).toBe('ALREADY_IN_STATE');
    expect(decidir(V0(), 'QUITAR', REP, P_REPORTE).codigo).toBe('ALREADY_IN_STATE');
  });

  test('ACEPTADA: quitar vale; descartar vale en un paso; aceptar de nuevo es ALREADY; restaurar es INVALID_TRANSITION', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE)]);
    expect(decidir(st, 'QUITAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(st, 'DESCARTAR', REP, P_REPORTE, MOT).ok).toBe(true);
    expect(decidir(st, 'ACEPTAR', REP, P_REPORTE).codigo).toBe('ALREADY_IN_STATE');
    expect(decidir(st, 'RESTAURAR', REP, P_REPORTE).codigo).toBe('INVALID_TRANSITION');
  });

  test('DESCARTADA: restaurar vale; aceptar y quitar son INVALID_TRANSITION; descartar de nuevo es ALREADY', () => {
    const st = derivar([DESCARTA(1, REP, P_REPORTE)]);
    expect(decidir(st, 'RESTAURAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(st, 'ACEPTAR', REP, P_REPORTE).codigo).toBe('INVALID_TRANSITION');
    expect(decidir(st, 'QUITAR', REP, P_REPORTE).codigo).toBe('INVALID_TRANSITION');
    expect(decidir(st, 'DESCARTAR', REP, P_REPORTE, MOT).codigo).toBe('ALREADY_IN_STATE');
  });

  test('cada decision escribe el evento correcto y SOLO el evento (sin secuencia, fecha ni usuario: eso lo agrega quien escribe)', () => {
    const casos = [['ACEPTAR', 'ACEPTADA', REP, derivar([])], ['QUITAR', 'ACEPTACION_QUITADA', REP, derivar([ACEPTA(1, REP, P_REPORTE)])],
      ['DESCARTAR', 'DESCARTADA', REP, derivar([])], ['RESTAURAR', 'RESTAURADA', REP, derivar([DESCARTA(1, REP, P_REPORTE)])]];
    casos.forEach(([decision, evento, tipo, st]) => {
      const r = decidir(st, decision, tipo, P_REPORTE, MOT);
      expect(r.ok).toBe(true);
      expect(Object.keys(r.evento).sort()).toEqual(['evento', 'fuenteTipo', 'motivo', 'wellId', 'x', 'y']);
      expect(r.evento).toMatchObject({ evento: evento, wellId: WELL, fuenteTipo: tipo, x: P_REPORTE.x, y: P_REPORTE.y });
    });
  });

  test('el efecto informa que reemplaza la aceptada anterior, que descarta la aceptada o que quita la aceptacion', () => {
    const acep = derivar([ACEPTA(1, REP, P_REPORTE)]);
    expect(decidir(acep, 'ACEPTAR', IRR, P_IRR1).efecto).toMatchObject({ desde: 'SIN_REVISAR', hacia: 'ACEPTADA', reemplazaA: K_REP });
    expect(decidir(acep, 'DESCARTAR', REP, P_REPORTE, MOT).efecto).toMatchObject({ desde: 'ACEPTADA', hacia: 'DESCARTADA', descartaLaAceptada: true });
    expect(decidir(acep, 'DESCARTAR', IRR, P_IRR2, MOT).efecto).toMatchObject({ descartaLaAceptada: false });
    expect(decidir(acep, 'QUITAR', REP, P_REPORTE).efecto).toMatchObject({ desde: 'ACEPTADA', hacia: 'SIN_REVISAR', quitaAceptacion: true });
    expect(decidir(derivar([]), 'ACEPTAR', REP, P_REPORTE).efecto.reemplazaA).toBeNull();
  });

  test('motivo: obligatorio al descartar; opcional al aceptar, quitar y restaurar; se recorta; maximo 300', () => {
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE).codigo).toBe('MOTIVO_REQUERIDO');
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, '   ').codigo).toBe('MOTIVO_REQUERIDO');
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, null).codigo).toBe('MOTIVO_REQUERIDO');
    expect(decidir(V0(), 'ACEPTAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(V0(), 'ACEPTAR', REP, P_REPORTE, 'Coincide con el plano').evento.motivo).toBe('Coincide con el plano');
    expect(decidir(derivar([ACEPTA(1, REP, P_REPORTE)]), 'QUITAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(derivar([DESCARTA(1, REP, P_REPORTE)]), 'RESTAURAR', REP, P_REPORTE).ok).toBe(true);
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, '  recortado  ').evento.motivo).toBe('recortado');
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, 'a'.repeat(300)).ok).toBe(true);
    expect(decidir(V0(), 'DESCARTAR', REP, P_REPORTE, 'a'.repeat(301)).codigo).toBe('MOTIVO_INVALIDO');
    expect(decidir(V0(), 'ACEPTAR', REP, P_REPORTE, 5).codigo).toBe('MOTIVO_INVALIDO');
  });

  test('el motivo obligatorio se exige ANTES que cualquier otra cosa del estado (no se descarta sin motivo ni por stale)', () => {
    expect(U.ufd_decidir(V0(), { decision: 'DESCARTAR', fuenteTipo: REP, x: P_REPORTE.x, y: P_REPORTE.y, versionVista: 99 }).codigo).toBe('MOTIVO_REQUERIDO');
  });

  test('la solicitud no modifica el estado (funcion pura)', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE)]);
    const copia = JSON.stringify(st);
    decidir(st, 'ACEPTAR', IRR, P_IRR1);
    decidir(st, 'DESCARTAR', REP, P_REPORTE, MOT);
    decidir(st, 'QUITAR', IRR, P_IRR1);
    expect(JSON.stringify(st)).toBe(copia);
  });
});

describe('errores de dominio', () => {
  test('INVALID_DECISION', () => {
    const st = derivar([]);
    [undefined, null, 'ACEPTADA', 'aceptar', 5, '', 'SUPERAR'].forEach((d) => {
      expect(U.ufd_decidir(st, { decision: d, fuenteTipo: REP, x: 1, y: 1, versionVista: 0 }).codigo).toBe('INVALID_DECISION');
    });
    expect(U.ufd_decidir(st, null).codigo).toBe('INVALID_DECISION');
  });

  test('INVALID_FUENTE: tipo o coordenadas invalidos', () => {
    const st = derivar([]);
    [{ fuenteTipo: 'OTRO', x: 1, y: 1 }, { fuenteTipo: REP, x: 'abc', y: 1 }, { fuenteTipo: REP, x: 1 }, { fuenteTipo: undefined, x: 1, y: 1 }, { fuenteTipo: REP, x: NaN, y: 1 }]
      .forEach((f) => expect(U.ufd_decidir(st, Object.assign({ decision: 'ACEPTAR', versionVista: 0 }, f)).codigo).toBe('INVALID_FUENTE'));
  });

  test('INVALID_VERSION: versionVista obligatoria, entera y >= 0', () => {
    const st = derivar([]);
    [undefined, null, '0', -1, 1.5, NaN, Infinity].forEach((v) => {
      expect(U.ufd_decidir(st, { decision: 'ACEPTAR', fuenteTipo: REP, x: P_REPORTE.x, y: P_REPORTE.y, versionVista: v }).codigo).toBe('INVALID_VERSION');
    });
  });

  test('WELL_ID_INVALIDO: estado sin pozo valido', () => {
    expect(U.ufd_decidir({ wellId: 'x', integro: true, fuentes: [] }, { decision: 'ACEPTAR', fuenteTipo: REP, x: 1, y: 1, versionVista: 0 }).codigo).toBe('WELL_ID_INVALIDO');
    expect(U.ufd_decidir(undefined, { decision: 'ACEPTAR', fuenteTipo: REP, x: 1, y: 1, versionVista: 0 }).codigo).toBe('WELL_ID_INVALIDO');
  });

  test('SOURCE_NOT_FOUND: una coordenada que no esta en el padron de hoy (ni siquiera con decisiones previas)', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE)]);
    expect(decidir(st, 'ACEPTAR', IRR, { x: 2486999.0, y: 6310999.0 }).codigo).toBe('SOURCE_NOT_FOUND');
    expect(decidir(st, 'ACEPTAR', IRR, { x: P_IRR1.x + 0.001, y: P_IRR1.y }).codigo).toBe('SOURCE_NOT_FOUND');          // 1 mm de diferencia
    expect(decidir(st, 'ACEPTAR', IRR, P_REPORTE).codigo).toBe('SOURCE_NOT_FOUND');                                      // misma coordenada, otro tipo
    const sinReporte = derivar([ACEPTA(1, REP, P_REPORTE)], location({ coordenadas: null }));
    expect(decidir(sinReporte, 'QUITAR', REP, P_REPORTE).codigo).toBe('SOURCE_NOT_FOUND');                               // decision obsoleta: no se puede operar
  });

  test('STALE_STATE: la version vista no es la actual (con la version actual para releer)', () => {
    const st = derivar([ACEPTA(5, REP, P_REPORTE)]);
    const r = decidir(st, 'DESCARTAR', IRR, P_IRR2, MOT, 3);
    expect(r).toMatchObject({ ok: false, codigo: 'STALE_STATE', versionActual: 5 });
    expect(decidir(st, 'DESCARTAR', IRR, P_IRR2, MOT, 6).codigo).toBe('STALE_STATE');           // tambien una version del futuro
    expect(decidir(st, 'DESCARTAR', IRR, P_IRR2, MOT, 5).ok).toBe(true);
    expect(decidir(derivar([]), 'ACEPTAR', REP, P_REPORTE, '', 1).codigo).toBe('STALE_STATE');
  });

  test('INCONSISTENT_STATE: un pozo con el log danado no acepta decisiones nuevas', () => {
    const st = derivar([RESTAURA(1, REP, P_REPORTE)]);
    expect(st.integro).toBe(false);
    expect(decidir(st, 'ACEPTAR', REP, P_REPORTE).codigo).toBe('INCONSISTENT_STATE');
  });

  test('precedencia: forma > motivo > integridad > existe la fuente > estado viejo > transicion', () => {
    const roto = derivar([RESTAURA(1, REP, P_REPORTE)]);
    expect(U.ufd_decidir(roto, { decision: 'ACEPTAR', fuenteTipo: REP, x: 1, y: 1, versionVista: 0 }).codigo).toBe('INCONSISTENT_STATE');
    const st = derivar([DESCARTA(1, REP, P_REPORTE)]);
    expect(decidir(st, 'ACEPTAR', IRR, { x: 1, y: 1 }, '', 0).codigo).toBe('SOURCE_NOT_FOUND');          // antes que stale
    expect(decidir(st, 'ACEPTAR', REP, P_REPORTE, '', 0).codigo).toBe('STALE_STATE');                     // antes que transicion
    expect(decidir(st, 'ACEPTAR', REP, P_REPORTE, '', 1).codigo).toBe('INVALID_TRANSITION');
  });

  test('los errores traen mensaje en espanol y nunca lanzan', () => {
    const st = derivar([]);
    [decidir(st, 'RESTAURAR', REP, P_REPORTE), decidir(st, 'DESCARTAR', REP, P_REPORTE), U.ufd_decidir(st, {}), U.ufd_decidir(null, null)].forEach((r) => {
      expect(r.ok).toBe(false);
      expect(typeof r.mensaje).toBe('string');
      expect(r.mensaje.length).toBeGreaterThan(5);
    });
  });
});

describe('eventos corruptos: el pozo queda INCONSISTENTE (fail-closed) y ninguna decision aplica', () => {
  const casos = [
    ['evento que no es objeto', [null], 'EVENTO_NO_ES_OBJETO'],
    ['evento texto', ['ACEPTADA'], 'EVENTO_NO_ES_OBJETO'],
    ['secuencia ausente', [{ evento: 'ACEPTADA', wellId: WELL, fuenteTipo: REP, x: 1, y: 1 }], 'SECUENCIA_INVALIDA'],
    ['secuencia 0', [ACEPTA(0, REP, P_REPORTE)], 'SECUENCIA_INVALIDA'],
    ['secuencia negativa', [ACEPTA(-3, REP, P_REPORTE)], 'SECUENCIA_INVALIDA'],
    ['secuencia decimal', [ACEPTA(1.5, REP, P_REPORTE)], 'SECUENCIA_INVALIDA'],
    ['secuencia en texto', [ACEPTA('7', REP, P_REPORTE)], 'SECUENCIA_INVALIDA'],
    ['secuencia NaN', [ACEPTA(NaN, REP, P_REPORTE)], 'SECUENCIA_INVALIDA'],
    ['evento desconocido (SUPERADA no existe)', [ev(1, 'SUPERADA', REP, P_REPORTE)], 'EVENTO_DESCONOCIDO'],
    ['evento en minuscula', [ev(1, 'aceptada', REP, P_REPORTE)], 'EVENTO_DESCONOCIDO'],
    ['evento heredado de Object.prototype', [ev(1, 'toString', REP, P_REPORTE)], 'EVENTO_DESCONOCIDO'],
    ['pozo invalido', [ACEPTA(1, REP, P_REPORTE)].map((e) => Object.assign(e, { wellId: 'zz' })), 'WELL_ID_INVALIDO'],
    ['evento de otro pozo', [ACEPTA(1, REP, P_REPORTE)].map((e) => Object.assign(e, { wellId: '01-0012' })), 'EVENTO_DE_OTRO_POZO'],
    ['tipo de fuente invalido', [ACEPTA(1, 'OTRA', P_REPORTE)], 'FUENTE_TIPO_INVALIDO'],
    ['coordenada invalida', [ACEPTA(1, REP, { x: 'abc', y: 1 })], 'COORDENADA_INVALIDA'],
    ['coordenada ausente', [ACEPTA(1, REP, { x: 5, y: undefined })], 'COORDENADA_INVALIDA'],
    ['motivo que no es texto', [ev(1, 'ACEPTADA', REP, P_REPORTE, 12)], 'MOTIVO_INVALIDO'],
    ['motivo de mas de 300', [ev(1, 'ACEPTADA', REP, P_REPORTE, 'a'.repeat(301))], 'MOTIVO_INVALIDO'],
    ['descarte sin motivo', [ev(1, 'DESCARTADA', REP, P_REPORTE, '')], 'MOTIVO_AUSENTE_EN_DESCARTE'],
    ['descarte con motivo en blanco', [ev(1, 'DESCARTADA', REP, P_REPORTE, '   ')], 'MOTIVO_AUSENTE_EN_DESCARTE'],
    ['descarte con motivo nulo', [ev(1, 'DESCARTADA', REP, P_REPORTE, null)], 'MOTIVO_AUSENTE_EN_DESCARTE'],
    ['secuencia repetida', [ACEPTA(4, REP, P_REPORTE), DESCARTA(4, IRR, P_IRR2)], 'SECUENCIA_DUPLICADA'],
    ['restaurar sin descartar', [RESTAURA(1, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['quitar sin aceptar', [QUITA(1, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['aceptar dos veces la misma', [ACEPTA(1, REP, P_REPORTE), ACEPTA(2, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['descartar dos veces la misma', [DESCARTA(1, REP, P_REPORTE), DESCARTA(2, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['aceptar una descartada sin restaurarla', [DESCARTA(1, REP, P_REPORTE), ACEPTA(2, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['quitar una descartada', [DESCARTA(1, REP, P_REPORTE), QUITA(2, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG'],
    ['restaurar una aceptada', [ACEPTA(1, REP, P_REPORTE), RESTAURA(2, REP, P_REPORTE)], 'TRANSICION_INVALIDA_EN_LOG']
  ];

  test.each(casos)('%s', (nombre, eventos, codigo) => {
    const st = derivar(eventos);
    expect(st.integro).toBe(false);
    expect(st.anomalias.map((a) => a.codigo)).toContain(codigo);
    expect(st.fuentes.every((f) => f.estado === 'SIN_REVISAR')).toBe(true);                // nada aplica
    expect(st.aceptadaClave).toBeNull();
    expect(st.historial).toEqual([]);
    const r = U.ufd_resolverRegistral(st);
    expect(r.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
    expect(r.descartadas).toEqual([]);                                                       // resuelve como si no hubiera decisiones
    expect(r.anomalias.map((a) => a.codigo)).toContain('POZO_INCONSISTENTE');
  });

  test('un solo evento malo invalida TODAS las decisiones del pozo (aunque las demas esten bien)', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2), ev(3, 'EXTRANO', IRR, P_IRR1)]);
    expect(st.integro).toBe(false);
    expect(st.fuentes.every((f) => f.estado === 'SIN_REVISAR')).toBe(true);
    const r = U.ufd_resolverRegistral(st);
    expect(r.participantes).toBe(3);                                                         // la descartada vuelve a participar
    expect(r.estado).toBe('COINCIDENTE');
  });

  test('el pozo invalido o los datos de entrada rotos no lanzan', () => {
    expect(() => U.ufd_derivar(undefined)).not.toThrow();
    expect(U.ufd_derivar(undefined).integro).toBe(false);
    expect(U.ufd_derivar({ wellId: 'mal', eventos: 'x', fuentes: null }).integro).toBe(false);
    expect(() => U.ufd_resolverRegistral(null)).not.toThrow();
  });

  test('la version sigue siendo la mayor secuencia valida aunque el pozo sea inconsistente (para poder releer)', () => {
    expect(derivar([ACEPTA(7, REP, P_REPORTE), RESTAURA(9, IRR, P_IRR1)]).version).toBe(9);
  });
});

describe('SECUENCIA: el orden depende de la secuencia, no de la fecha', () => {
  const T = '2026-10-13T12:34:13.000Z';

  test('eventos con el MISMO timestamp (como pasa en los datos reales) se ordenan por secuencia', () => {
    const a = ACEPTA(1, REP, P_REPORTE); a.timestamp = T;
    const b = ACEPTA(2, IRR, P_IRR1); b.timestamp = T;
    const st = derivar([a, b]);
    expect(st.aceptadaClave).toBe(K_I1);
    const st2 = derivar([b, a]);                                          // llegan al reves: el resultado es el mismo
    expect(st2.aceptadaClave).toBe(K_I1);
    expect(JSON.stringify(st2)).toBe(JSON.stringify(st));
  });

  test('un timestamp MAS VIEJO en el evento de mayor secuencia no cambia el orden', () => {
    const a = ACEPTA(1, REP, P_REPORTE); a.timestamp = '2026-10-14T12:00:00.000Z';
    const b = ACEPTA(2, IRR, P_IRR1); b.timestamp = '2026-01-01T00:00:00.000Z';
    expect(derivar([a, b]).aceptadaClave).toBe(K_I1);
  });

  test('timestamps rotos, ausentes o en cualquier formato se ignoran', () => {
    const eventos = [ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2), ACEPTA(3, IRR, P_IRR1)];
    eventos[0].timestamp = 'no es una fecha';
    delete eventos[1].timestamp;
    eventos[2].timestamp = 12345;
    const st = derivar(eventos);
    expect(st.integro).toBe(true);
    expect(st.aceptadaClave).toBe(K_I1);
    expect(estadoDe(st, K_I2)).toBe('DESCARTADA');
  });

  test('el orden de llegada del arreglo no importa: cualquier permutacion da el mismo estado', () => {
    const eventos = [ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2), ACEPTA(3, IRR, P_IRR1), QUITA(4, IRR, P_IRR1), RESTAURA(5, IRR, P_IRR2)];
    const base = JSON.stringify(derivar(eventos));
    const permutaciones = [[4, 3, 2, 1, 0], [2, 0, 4, 1, 3], [1, 3, 0, 4, 2], [3, 4, 0, 2, 1]];
    permutaciones.forEach((p) => expect(JSON.stringify(derivar(p.map((i) => eventos[i])))).toBe(base));
  });

  test('las secuencias pueden tener huecos (la secuencia es global de todos los pozos)', () => {
    const st = derivar([ACEPTA(10, REP, P_REPORTE), ACEPTA(57, IRR, P_IRR1)]);
    expect(st.integro).toBe(true);
    expect(st.aceptadaClave).toBe(K_I1);
    expect(st.version).toBe(57);
  });

  test('la version es la secuencia maxima del pozo (0 si no hay eventos)', () => {
    expect(derivar([]).version).toBe(0);
    expect(derivar([DESCARTA(3, IRR, P_IRR2), ACEPTA(8, REP, P_REPORTE)]).version).toBe(8);
  });

  test('una secuencia repetida es corrupcion, no «gana el ultimo»', () => {
    const st = derivar([ACEPTA(4, REP, P_REPORTE), ACEPTA(4, IRR, P_IRR1)]);
    expect(st.integro).toBe(false);
    expect(st.anomalias.map((a) => a.codigo)).toEqual(['SECUENCIA_DUPLICADA']);
  });

  test('agruparPorPozo separa los eventos por pozo y cada pozo se deriva por su cuenta', () => {
    const otro = ACEPTA(2, REP, P_REPORTE); otro.wellId = '01-0012';
    const g = U.ufd_agruparPorPozo([ACEPTA(1, REP, P_REPORTE), otro, DESCARTA(3, IRR, P_IRR2), null, { sinPozo: true }]);
    expect(Object.keys(g).sort()).toEqual(['', '01-0012', WELL]);
    expect(g[WELL]).toHaveLength(2);
    expect(derivar(g[WELL]).integro).toBe(true);
  });
});

describe('UNA sola aceptada vigente por pozo', () => {
  test('por construccion nunca hay dos: aceptar una segunda reemplaza a la primera', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), ACEPTA(2, IRR, P_IRR1), ACEPTA(3, IRR, P_IRR2)]);
    expect(st.fuentes.filter((f) => f.estado === 'ACEPTADA').map((f) => f.clave)).toEqual([K_I2]);
    expect(st.integro).toBe(true);
  });

  test('la solicitud de aceptar con otra aceptada informa a quien reemplaza; escribir ese evento deja una sola vigente', () => {
    let st = derivar([ACEPTA(1, REP, P_REPORTE)]);
    const r = decidir(st, 'ACEPTAR', IRR, P_IRR1);
    expect(r.efecto.reemplazaA).toBe(K_REP);
    st = derivar([ACEPTA(1, REP, P_REPORTE), Object.assign({ secuencia: st.version + 1 }, r.evento)]);
    expect(st.aceptadaClave).toBe(K_I1);
    expect(estadoDe(st, K_REP)).toBe('SIN_REVISAR');
  });

  test('verificarInvariantes detecta dos aceptadas en un estado armado a mano (defensa en profundidad) y la derivacion falla cerrado', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE)]);
    const manipulado = JSON.parse(JSON.stringify(st));
    manipulado.fuentes[1].estado = 'ACEPTADA';
    expect(U.ufd_verificarInvariantes(manipulado)).toEqual([{ codigo: 'ACEPTADAS_MULTIPLES', claves: [K_REP, K_I1] }]);
    expect(U.ufd_verificarInvariantes(st)).toEqual([]);
    expect(U.ufd_verificarInvariantes(null)).toEqual([]);
  });

  test('PROPIEDAD (500 historias al azar): el estado siempre es integro, con a lo sumo una aceptada, y coincide con un modelo de referencia independiente', () => {
    let semilla = 12345;
    const azar = (n) => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla % n; };
    const fuentes = [[REP, P_REPORTE], [IRR, P_IRR1], [IRR, P_IRR2]];
    const claves = [K_REP, K_I1, K_I2];
    const decisiones = ['ACEPTAR', 'DESCARTAR', 'RESTAURAR', 'QUITAR'];
    let escritos = 0;
    let rechazados = 0;
    for (let h = 0; h < 500; h += 1) {
      const eventos = [];
      const modelo = { estados: { [K_REP]: 'SIN_REVISAR', [K_I1]: 'SIN_REVISAR', [K_I2]: 'SIN_REVISAR' }, aceptada: null };
      let seq = 0;
      for (let paso = 0; paso < 25; paso += 1) {
        const st = derivar(eventos);
        expect(st.integro).toBe(true);
        expect(st.fuentes.filter((f) => f.estado === 'ACEPTADA').length).toBeLessThanOrEqual(1);
        const i = azar(3);
        const decision = decisiones[azar(4)];
        const version = azar(10) < 8 ? st.version : st.version + 1 + azar(3);
        const r = decidir(st, decision, fuentes[i][0], fuentes[i][1], azar(2) ? MOT : '', version);
        if (!r.ok) { rechazados += 1; expect(typeof r.codigo).toBe('string'); continue; }
        seq += 1 + azar(3);
        eventos.push(Object.assign({ secuencia: seq, timestamp: '2026-10-14T00:00:00Z' }, r.evento));
        escritos += 1;
        // modelo de referencia (otro algoritmo: tabla directa)
        const k = claves[i];
        if (decision === 'ACEPTAR') { if (modelo.aceptada) { modelo.estados[modelo.aceptada] = 'SIN_REVISAR'; } modelo.estados[k] = 'ACEPTADA'; modelo.aceptada = k; }
        if (decision === 'DESCARTAR') { if (modelo.aceptada === k) { modelo.aceptada = null; } modelo.estados[k] = 'DESCARTADA'; }
        if (decision === 'QUITAR') { modelo.estados[k] = 'SIN_REVISAR'; modelo.aceptada = null; }
        if (decision === 'RESTAURAR') { modelo.estados[k] = 'SIN_REVISAR'; }
        const despues = derivar(eventos);
        expect(despues.integro).toBe(true);
        expect(claves.map((c) => estadoDe(despues, c))).toEqual(claves.map((c) => modelo.estados[c]));
        expect(despues.aceptadaClave).toBe(modelo.aceptada);
        expect(despues.version).toBe(seq);
        expect(r.efecto.hacia).toBe(modelo.estados[k]);
      }
    }
    expect(escritos).toBeGreaterThan(2000);
    expect(rechazados).toBeGreaterThan(1000);
  });
});

describe('resolver registral del punto operativo', () => {
  const resolver = (eventos, loc) => U.ufd_resolverRegistral(derivar(eventos, loc));

  test('sin decisiones es el resolver automatico: 14-0001 corrobora con el par que coincide', () => {
    const r = resolver([]);
    expect(r).toMatchObject({ estado: 'COINCIDENTE', regla: 'R2_AUTOMATICO', operativo: true, fuente: 'IRR_VARIAS', participantes: 3, descartadas: [], todasDescartadas: false });
    expect(r.cambiaRespectoDelOriginal).toBe(false);
    expect(r.distanciaCorroboracionM).toBe(5);
  });

  test('ACEPTADA va primero: gana aunque el automatico diga otra cosa', () => {
    const r = resolver([ACEPTA(1, IRR, P_IRR2)]);
    expect(r).toMatchObject({ estado: 'ACEPTADA', regla: 'R1B_REGISTRAL_ACEPTADA', operativo: true, fuente: 'IRR_PROVINCIA', fuenteClave: K_I2, x: P_IRR2.x, y: P_IRR2.y });
    expect(r.automatico.estado).toBe('COINCIDENTE');                       // el automatico se sigue informando
    expect(r.cambiaRespectoDelOriginal).toBe(true);
    expect(r.lat).toBeCloseTo(-33.3486, 3);
  });

  test('la fuente de una aceptada de Reporte Pozos es IRR_REPORTE; la de Irrigacion, IRR_PROVINCIA; el estado es siempre ACEPTADA (distinto de COINCIDENTE)', () => {
    expect(resolver([ACEPTA(1, REP, P_REPORTE)])).toMatchObject({ estado: 'ACEPTADA', fuente: 'IRR_REPORTE' });
    expect(resolver([ACEPTA(1, IRR, P_IRR1)])).toMatchObject({ estado: 'ACEPTADA', fuente: 'IRR_PROVINCIA' });
  });

  test('si no hay aceptada: automatico sobre las NO descartadas (descartar una del par deja de corroborar)', () => {
    const r = resolver([DESCARTA(1, IRR, P_IRR1)]);
    expect(r.participantes).toBe(2);
    expect(r.estado).toBe('DISCREPANCIA');
    expect(r.nivel).toBe('revisar');
    expect(r.operativo).toBe(false);
    expect(r.lat).toBeNull();
    expect(r.descartadas).toEqual([K_I1]);
    expect(r.cambiaRespectoDelOriginal).toBe(true);
  });

  test('descartar la fuente lejana no cambia nada: sigue corroborada con las otras dos', () => {
    const r = resolver([DESCARTA(1, IRR, P_IRR2)]);
    expect(r.estado).toBe('COINCIDENTE');
    expect(r.cambiaRespectoDelOriginal).toBe(false);
  });

  test('quedan dos fuentes que se corroboran: COINCIDENTE; queda una sola: DISPONIBLE', () => {
    expect(resolver([DESCARTA(1, IRR, P_IRR2)]).estado).toBe('COINCIDENTE');
    const una = resolver([DESCARTA(1, IRR, P_IRR2), DESCARTA(2, IRR, P_IRR1)]);
    expect(una).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_REPORTE', fuenteClave: K_REP, participantes: 1, regla: 'R2_AUTOMATICO' });
  });

  test('TODAS descartadas: sin punto operativo registral, y se marca para poder decir «todas las fuentes conocidas fueron descartadas»', () => {
    const r = resolver([DESCARTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR1), DESCARTA(3, IRR, P_IRR2)]);
    expect(r).toMatchObject({ estado: 'SIN_COORDENADAS', operativo: false, lat: null, lon: null, todasDescartadas: true, participantes: 0, regla: 'R0_NINGUNA' });
    expect(r.descartadas).toHaveLength(3);
    expect(r.cambiaRespectoDelOriginal).toBe(true);
  });

  test('un pozo SIN fuentes no es «todas descartadas»', () => {
    const r = resolver([], { coordenadas: null, coordenadasProvincia: [] });
    expect(r).toMatchObject({ estado: 'SIN_COORDENADAS', todasDescartadas: false, participantes: 0 });
    expect(r.cambiaRespectoDelOriginal).toBe(false);
  });

  test('una descartada NO se pierde: la coordenada original sigue en las fuentes del estado y en las descartadas', () => {
    const st = derivar([DESCARTA(1, IRR, P_IRR2)]);
    const f = st.fuentes.filter((x) => x.clave === K_I2)[0];
    expect(f).toMatchObject({ estado: 'DESCARTADA', x: P_IRR2.x, y: P_IRR2.y });
    expect(f.lat).toBeCloseTo(-33.3486, 3);
  });

  test('restaurar devuelve la fuente al resolver automatico (NO la acepta)', () => {
    const r = resolver([DESCARTA(1, IRR, P_IRR1), RESTAURA(2, IRR, P_IRR1)]);
    expect(r).toMatchObject({ estado: 'COINCIDENTE', participantes: 3, regla: 'R2_AUTOMATICO' });
  });

  test('quitar la aceptacion devuelve la fuente al automatico (y no queda descartada)', () => {
    const r = resolver([ACEPTA(1, IRR, P_IRR2), QUITA(2, IRR, P_IRR2)]);
    expect(r).toMatchObject({ estado: 'COINCIDENTE', participantes: 3, descartadas: [] });
  });

  test('descartar la aceptada la saca de ACEPTADA y ademas del automatico', () => {
    const r = resolver([ACEPTA(1, IRR, P_IRR1), DESCARTA(2, IRR, P_IRR1)]);
    expect(r.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
    expect(r.participantes).toBe(2);
    expect(r.estado).toBe('DISCREPANCIA');                                    // Reporte e Irrigacion (2) estan a ~170 m: sin punto
    expect(r.automatico.estado).toBe('DISCREPANCIA');
  });

  test('aceptar otra fuente cambia el punto operativo a la nueva', () => {
    const r = resolver([ACEPTA(1, REP, P_REPORTE), ACEPTA(2, IRR, P_IRR2)]);
    expect(r).toMatchObject({ estado: 'ACEPTADA', fuenteClave: K_I2 });
  });

  test('una fuente aceptada con coordenada fuera de Mendoza se ignora (anomalia) y resuelve el automatico', () => {
    const lejos = { x: 9000000, y: 1000000 };
    const loc = { coordenadas: lejos, coordenadasProvincia: [P_IRR1] };
    const r = resolver([ev(1, 'ACEPTADA', REP, lejos)], loc);
    expect(r.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
    expect(r.anomalias.map((a) => a.codigo)).toContain('ACEPTADA_FUERA_DE_MENDOZA');
  });

  test('un resultado automatico fuera de Mendoza no es punto operativo (misma regla que ubicacionOperativaLogic)', () => {
    const r = resolver([], { coordenadas: { x: 9000000, y: 1000000 }, coordenadasProvincia: [] });
    expect(r).toMatchObject({ estado: 'SIN_COORDENADAS', operativo: false, lat: null });
    expect(r.anomalias.map((a) => a.codigo)).toContain('COORDENADA_FUERA_DE_MENDOZA');
  });

  test('el resultado nunca trae la validada en campo: este dominio no la conoce (la prioridad V > R se integra despues)', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionFuenteDecisionesLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/VALIDADA_CAMPO|CAMPO_CORREGIDA|correccion|R1_CAMPO/i);
  });

  test('discrepancia sin decisiones: no hay punto; aceptar una de las fuentes SI lo da', () => {
    const lejos = { x: P_REPORTE.x + 900, y: P_REPORTE.y };
    const loc = { coordenadas: P_REPORTE, coordenadasProvincia: [lejos] };
    expect(resolver([], loc)).toMatchObject({ estado: 'DISCREPANCIA', nivel: 'grave', operativo: false });
    const acep = resolver([ev(1, 'ACEPTADA', IRR, lejos)], loc);
    expect(acep).toMatchObject({ estado: 'ACEPTADA', operativo: true, fuente: 'IRR_PROVINCIA' });
    expect(acep.automatico.estado).toBe('DISCREPANCIA');
    const desc = resolver([ev(1, 'DESCARTADA', IRR, lejos, MOT)], loc);
    expect(desc).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_REPORTE' });
  });

  test('el estado humano usa los mismos nombres que ubicacionOperativaLogic (D / C / discrepancia / sin coordenadas)', () => {
    expect(U.UFD_RESULTADO_ESTADOS.DISPONIBLE).toBe(uop.UOP_ESTADOS.DISPONIBLE);
    expect(U.UFD_RESULTADO_ESTADOS.COINCIDENTE).toBe(uop.UOP_ESTADOS.COINCIDENTE);
    expect(U.UFD_RESULTADO_ESTADOS.DISCREPANCIA).toBe(uop.UOP_ESTADOS.DISCREPANCIA);
    expect(U.UFD_RESULTADO_ESTADOS.SIN_COORDENADAS).toBe(uop.UOP_ESTADOS.SIN_COORDENADAS);
    expect(U.UFD_FUENTES_OPERATIVAS.IRR_REPORTE).toBe(uop.UOP_FUENTES.IRR_REPORTE);
    expect(U.UFD_FUENTES_OPERATIVAS.IRR_PROVINCIA).toBe(uop.UOP_FUENTES.IRR_PROVINCIA);
    expect(U.UFD_FUENTES_OPERATIVAS.IRR_VARIAS).toBe(uop.UOP_FUENTES.IRR_VARIAS);
    expect(U.UFD_MENDOZA_BBOX).toEqual(uop.UOP_MENDOZA_BBOX);
  });
});

describe('filas identicas del padron (misma identidad)', () => {
  const dup = { coordenadas: null, coordenadasProvincia: [P_IRR1, P_IRR1, P_IRR2] };

  test('comparten clave y estado: descartar una descarta las dos', () => {
    const st = derivar([DESCARTA(1, IRR, P_IRR1)], dup);
    expect(st.fuentes.map((f) => f.estado)).toEqual(['DESCARTADA', 'DESCARTADA', 'SIN_REVISAR']);
    expect(U.ufd_resolverRegistral(st)).toMatchObject({ participantes: 1, estado: 'DISPONIBLE' });
  });

  test('Reporte e Irrigacion con la MISMA coordenada son fuentes distintas: descartar una no descarta la otra', () => {
    const loc = { coordenadas: P_IRR1, coordenadasProvincia: [P_IRR1] };
    const st = derivar([DESCARTA(1, IRR, P_IRR1)], loc);
    expect(st.fuentes.map((f) => [f.tipo, f.estado])).toEqual([[REP, 'SIN_REVISAR'], [IRR, 'DESCARTADA']]);
    expect(U.ufd_resolverRegistral(st)).toMatchObject({ estado: 'DISPONIBLE', fuente: 'IRR_REPORTE' });
  });

  test('aceptar una de dos filas identicas deja UNA sola aceptada logica', () => {
    const st = derivar([ACEPTA(1, IRR, P_IRR1)], dup);
    expect(st.fuentes.filter((f) => f.esAceptadaVigente).length).toBe(2);       // las dos filas son la misma fuente
    expect(U.ufd_verificarInvariantes(st)).toEqual([]);
  });
});

describe('REINDEXADO: si cambia x/y, la identidad cambia y la decision vieja no se hereda', () => {
  const MOVIDA = { x: P_IRR2.x + 25.5, y: P_IRR2.y - 10.25 };

  test('una fuente DESCARTADA cuya coordenada cambia: la nueva nace SIN_REVISAR y participa; la vieja queda como obsoleta historica', () => {
    const eventos = [DESCARTA(1, IRR, P_IRR2)];
    const antes = derivar(eventos);
    expect(estadoDe(antes, K_I2)).toBe('DESCARTADA');
    const despues = derivar(eventos, location({ coordenadasProvincia: [P_IRR1, MOVIDA] }));
    const kNueva = U.ufd_claveFuente(WELL, IRR, MOVIDA.x, MOVIDA.y);
    expect(kNueva).not.toBe(K_I2);
    expect(estadoDe(despues, kNueva)).toBe('SIN_REVISAR');                       // no hereda el descarte
    expect(despues.obsoletas).toEqual([{ clave: K_I2, tipo: IRR, x: P_IRR2.x, y: P_IRR2.y, estado: 'DESCARTADA', ultimaSecuencia: 1 }]);
    expect(despues.historial[0].obsoleta).toBe(true);
    const r = U.ufd_resolverRegistral(despues);
    expect(r.participantes).toBe(3);                                             // la coordenada nueva participa del automatico
    expect(r.descartadas).toEqual([]);
  });

  test('una fuente ACEPTADA cuya coordenada cambia: ya no hay aceptada vigente (queda como obsoleta) y vuelve el automatico', () => {
    const eventos = [ACEPTA(1, IRR, P_IRR1)];
    expect(U.ufd_resolverRegistral(derivar(eventos)).estado).toBe('ACEPTADA');
    const despues = derivar(eventos, location({ coordenadasProvincia: [{ x: P_IRR1.x + 40, y: P_IRR1.y }, P_IRR2] }));
    expect(despues.aceptadaClave).toBeNull();
    expect(despues.aceptadaObsoletaClave).toBe(K_I1);
    expect(despues.obsoletas.map((o) => [o.clave, o.estado])).toEqual([[K_I1, 'ACEPTADA']]);
    const r = U.ufd_resolverRegistral(despues);
    expect(r.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
    expect(r.estado).not.toBe('ACEPTADA');
    expect(r.participantes).toBe(3);                                         // la coordenada nueva participa del resolver automatico
  });

  test('la nueva coordenada se puede aceptar y reemplaza (en el historial) a la obsoleta; la obsoleta NO se puede operar', () => {
    const loc = location({ coordenadasProvincia: [{ x: P_IRR1.x + 40, y: P_IRR1.y }, P_IRR2] });
    const nueva = { x: P_IRR1.x + 40, y: P_IRR1.y };
    const st = derivar([ACEPTA(1, IRR, P_IRR1)], loc);
    expect(decidir(st, 'QUITAR', IRR, P_IRR1).codigo).toBe('SOURCE_NOT_FOUND');
    const r = decidir(st, 'ACEPTAR', IRR, nueva);
    expect(r.ok).toBe(true);
    expect(r.efecto.reemplazaA).toBe(K_I1);                                      // reemplaza a la obsoleta (queda anotado)
    const st2 = derivar([ACEPTA(1, IRR, P_IRR1), Object.assign({ secuencia: 2 }, r.evento)], loc);
    expect(st2.aceptadaClave).toBe(U.ufd_claveFuente(WELL, IRR, nueva.x, nueva.y));
    expect(st2.historial[0].reemplazadaPor).toBe(st2.aceptadaClave);
    expect(st2.obsoletas[0]).toMatchObject({ clave: K_I1, estado: 'SIN_REVISAR' });
  });

  test('una decision NO se hereda a otro tipo de fuente con la misma coordenada', () => {
    const eventos = [DESCARTA(1, IRR, P_IRR1)];
    const loc = { coordenadas: P_IRR1, coordenadasProvincia: [] };            // ahora esa coordenada es de Reporte Pozos
    const st = derivar(eventos, loc);
    expect(estadoDe(st, U.ufd_claveFuente(WELL, REP, P_IRR1.x, P_IRR1.y))).toBe('SIN_REVISAR');
    expect(st.obsoletas).toHaveLength(1);
  });

  test('reordenar las Irrigacion en el padron NO afecta las decisiones (siguen a la coordenada)', () => {
    const eventos = [DESCARTA(1, IRR, P_IRR2), ACEPTA(2, REP, P_REPORTE)];
    const a = derivar(eventos, location({ coordenadasProvincia: [P_IRR1, P_IRR2] }));
    const b = derivar(eventos, location({ coordenadasProvincia: [P_IRR2, P_IRR1] }));
    expect(estadoDe(b, K_I2)).toBe('DESCARTADA');
    expect(b.aceptadaClave).toBe(K_REP);
    expect(U.ufd_resolverRegistral(b).fuenteClave).toBe(U.ufd_resolverRegistral(a).fuenteClave);
  });

  test('el ruido de formato de la coordenada (1e-10) NO se confunde con un reindexado', () => {
    const eventos = [DESCARTA(1, IRR, P_IRR2)];
    const st = derivar(eventos, location({ coordenadasProvincia: [P_IRR1, { x: P_IRR2.x + 1e-10, y: P_IRR2.y - 1e-10 }] }));
    expect(st.obsoletas).toEqual([]);
    expect(estadoDe(st, K_I2)).toBe('DESCARTADA');
  });

  test('si el reindexado quita TODAS las fuentes, las decisiones quedan historicas y el pozo no tiene punto', () => {
    const st = derivar([ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2)], { coordenadas: null, coordenadasProvincia: [] });
    expect(st.fuentes).toEqual([]);
    expect(st.obsoletas).toHaveLength(2);
    expect(U.ufd_resolverRegistral(st)).toMatchObject({ estado: 'SIN_COORDENADAS', todasDescartadas: false });
  });
});

describe('el modulo es puro, esta aislado y no toca nada', () => {
  const codigo = fs.readFileSync(path.join(__dirname, 'ubicacionFuenteDecisionesLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const raiz = path.join(__dirname, '..');

  test('sin DOM, red, almacenamiento, Leaflet, fecha ni azar', () => {
    expect(codigo).not.toMatch(/document\.|window\.|fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\bL\.|navigator\.|api[A-Z]\w+\(|Date\b|Math\.random|setTimeout/);
  });

  test('es deterministico: la misma entrada da la misma salida (sin depender del reloj)', () => {
    const eventos = [ACEPTA(1, REP, P_REPORTE), DESCARTA(2, IRR, P_IRR2)];
    expect(JSON.stringify(U.ufd_resolverRegistral(derivar(eventos)))).toBe(JSON.stringify(U.ufd_resolverRegistral(derivar(eventos))));
  });

  test('no muta sus entradas', () => {
    const eventos = [ACEPTA(2, IRR, P_IRR1), DESCARTA(1, IRR, P_IRR2)];
    const fuentes = fuentesDe();
    const copiaE = JSON.stringify(eventos);
    const copiaF = JSON.stringify(fuentes);
    U.ufd_derivar({ wellId: WELL, eventos: eventos, fuentes: fuentes });
    expect(JSON.stringify(eventos)).toBe(copiaE);                           // ni siquiera reordena el arreglo del llamador
    expect(JSON.stringify(fuentes)).toBe(copiaF);
  });

  test('ninguna pantalla carga ni usa este dominio (la interfaz solo habla con el backend por js/api.js, con sus propios modulos ubicacionFuenteDecisionesUi*; el backend tiene su copia exacta)', () => {
    expect(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8')).not.toMatch(/ubicacionFuenteDecisionesLogic\.js/);
    expect(fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8')).not.toMatch(/ubicacionFuenteDecisionesLogic\.js/);
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'ubicacionFuenteDecisionesLogic.js').forEach((f) => {
      expect(fs.readFileSync(path.join(raiz, 'js', f), 'utf8')).not.toMatch(/\bufd_|ubicacionFuenteDecisionesLogic/);
    });
    // el backend de decisiones (copia exacta + repositorio + servicio + Api) y el de SUGERENCIAS (Etapa C: reutiliza el servicio de decisiones; su propio test de aislamiento fija el resto)
    const delModulo = ['UbicacionFuenteDecisionesLogic.js', 'UbicacionFuenteDecisionesRepository.js', 'UbicacionFuenteDecisionesService.js', 'UbicacionFuenteSugerenciasRepository.js', 'UbicacionFuenteSugerenciasService.js', 'UbicacionFuenteSugerenciaNotificacion.js', 'Api.js'];
    fs.readdirSync(path.join(raiz, 'backend', 'src')).filter((f) => delModulo.indexOf(f) === -1).forEach((f) => {
      expect(fs.readFileSync(path.join(raiz, 'backend', 'src', f), 'utf8')).not.toMatch(/ufd_|ubicacionFuenteDecisiones|UbicacionFuenteDecisiones/);
    });
  });

  test('no hay Sheets, endpoints ni acciones de backend en este modulo', () => {
    expect(codigo).not.toMatch(/SpreadsheetApp|LockService|CacheService|doPost|action\s*[:=]|sessionToken/);
  });

  test('las decisiones del dominio son exactamente cuatro eventos (y no existe SUPERADA)', () => {
    expect(Object.keys(U.UFD_EVENTOS).sort()).toEqual(['ACEPTACION_QUITADA', 'ACEPTADA', 'DESCARTADA', 'RESTAURADA']);
    expect(Object.keys(U.UFD_ESTADOS).sort()).toEqual(['ACEPTADA', 'DESCARTADA', 'SIN_REVISAR']);
    expect(Object.keys(U.UFD_DECISIONES).sort()).toEqual(['ACEPTAR', 'DESCARTAR', 'QUITAR', 'RESTAURAR']);
  });

  test('el archivo se puede copiar tal cual al backend: sin IIFE ni imports, solo funciones globales ufd_', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionFuenteDecisionesLogic.js'), 'utf8');
    expect(fuente).not.toMatch(/^\s*\(function|require\(|^\s*import /m);
    const nombres = fuente.match(/^function (\w+)/gm).map((l) => l.replace('function ', ''));
    expect(nombres.length).toBeGreaterThan(15);
    nombres.forEach((n) => expect(n).toMatch(/^ufd_/));
  });
});
