// getDecisionesFuentesDelta (E3-1): el EFECTO REGISTRAL de las decisiones sobre el padron actual. Servicio, repositorio de la hoja y dominio REALES; padron, hoja, cache y reloj falsos.
// Contrato bajo prueba:
//   - respuesta {version, periodo, parcial, decisiones}; entradas {wellId, estado:'R'|'C'|'D', lat, lon} o {wellId, estado:'N'}; sin PII;
//   - solo entran los pozos cuyo punto operativo registral CAMBIA respecto del que da el padron sin decisiones;
//   - se reutiliza el dominio (ufd_derivar + ufd_resolverRegistral): el delta coincide SIEMPRE con la `resolucion` de getDecisionesFuentesPozo;
//   - la validada en campo (V) y NE no participan;
//   - lectura eficiente: una lectura de la hoja, padron en lote, cache por pozo versionado + cache del delta completo con invalidacion;
//   - fail-closed: nada inventado cuando falta tiempo, un archivo, o el historial de un pozo es inconsistente; coordenadas fuera de Mendoza jamas salen.
const fs = require('fs');
const path = require('path');
const { armar, solicitud, P_REPORTE, P_IRR1, P_IRR2, P_UNICA } = require('./decisionesFuentesHelper');

let t;
const VAL = 'val@x.com';
const NOMBRE = 'Valeria Validadora';
const W = '14-0001';          // Reporte Pozos + Irrigacion (1) coinciden a 5 m; Irrigacion (2) a ~170 m. Sin decisiones: COINCIDENTE
const U = '01-0012';          // una sola fuente (Irrigacion): DISPONIBLE
const VACIO = '03-0003';      // sin fuentes
const DOS = '15-0002';        // dos fuentes a 3 m: COINCIDENTE
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };
const UNICA = { fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y };
const DOS_A = { fuenteTipo: 'REPORTE_POZOS', x: 2400000, y: 6300000 };
const DOS_B = { fuenteTipo: 'IRRIGACION', x: 2400003, y: 6300000 };
const K_COMPLETO = 'ufd_delta_v1';
const K_MARCA = 'ufd_delta_v1_inval';

beforeEach(() => {
  t = armar();
  t.padron[DOS] = { coordenadas: { x: DOS_A.x, y: DOS_A.y }, coordenadasProvincia: [{ x: DOS_B.x, y: DOS_B.y }] };
});
afterEach(() => { jest.restoreAllMocks(); });

const ver = (w) => t.filas().filter((f) => f[2] === w).reduce((m, f) => Math.max(m, f[1]), 0);
const dec = (w, fuente, accion, extra, quien) => t.S.ubicacionFuenteDecisionesService_decidir(quien || VAL, NOMBRE, solicitud(Object.assign(
  { wellId: w }, fuente, { accion: accion, versionVista: ver(w), motivo: accion === 'DESCARTAR' ? 'no corresponde' : '' }, extra || {})));
const ok = (r) => { expect(r.ok).toBe(true); return r; };
const delta = (o) => { t.calmar(); return t.S.ubicacionFuenteDecisionesService_getDelta(o); };
const fuenteDe = (w, f) => t.Dominio.ufd_fuentesDePadron(w, t.padron[w]).fuentes.filter((x) => x.x === f.x && x.y === f.y && x.tipo === f.fuenteTipo)[0];
const entrada = (d, w) => d.decisiones.filter((e) => e.wellId === w)[0];
const resolucion = (w) => t.S.ubicacionFuenteDecisionesService_getPorPozo(w).data.resolucion;
const logs = () => global.Logger.log.mock.calls.map((c) => String(c[0]));
const deltaInvalidado = () => t.cache.remove.mock.calls.some((c) => c[0] === K_COMPLETO) || t.cache.put.mock.calls.some((c) => c[0] === K_MARCA);
const limpiarEspias = () => { t.cache.remove.mockClear(); t.cache.put.mockClear(); t.cache.putAll.mockClear(); t.cache.getAll.mockClear(); t.cache.get.mockClear(); global.registryService_getWellLocations.mockClear(); t.padronLotes.length = 0; };

describe('contrato de la respuesta', () => {
  test('sin decisiones: delta vacio, version 0, periodo del padron, parcial 0 y NI SIQUIERA se lee el padron', () => {
    expect(delta()).toEqual({ version: 0, periodo: '2026-09', parcial: 0, decisiones: [] });
    expect(global.registryService_getWellLocations).not.toHaveBeenCalled();
  });

  test('exactamente 4 claves; cada entrada solo wellId, estado, lat, lon (la de "sin punto": wellId y estado)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, REP, 'DESCARTAR'));
    const d = delta();
    expect(Object.keys(d).sort()).toEqual(['decisiones', 'parcial', 'periodo', 'version']);
    d.decisiones.forEach((e) => {
      expect(Object.keys(e).sort()).toEqual(e.estado === 'N' ? ['estado', 'wellId'] : ['estado', 'lat', 'lon', 'wellId']);
      expect(['R', 'C', 'D', 'N']).toContain(e.estado);
    });
  });

  test('sin PII: ni emails, nombres, motivos, ids, clientRequestId, x/y ni diagnosticos', () => {
    ok(dec(W, I2, 'ACEPTAR', { motivo: 'motivo-secreto-123', clientRequestId: 'req-pii-000001' }));
    ok(dec(U, UNICA, 'DESCARTAR', { motivo: 'otro-motivo-secreto' }));
    const crudo = JSON.stringify(delta());
    [VAL, 'Valeria', 'secreto', 'req-pii', 'decisionId', 'clientRequestId', 'padronPeriodo', 'secuencia', 'anomalias', 'INCONSISTENT', '"x"', '"y"', 'motivo', 'email', 'nombre'].forEach((s) => {
      expect(crudo).not.toContain(s);
    });
  });

  test('las entradas salen ordenadas por wellId', () => {
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    expect(delta().decisiones.map((e) => e.wellId)).toEqual([U, W, DOS]);
  });

  test('hoja inexistente: el servicio LANZA (el Api responde un SERVICE_UNAVAILABLE generico)', () => {
    t = armar({ sinHoja: true });
    expect(() => t.S.ubicacionFuenteDecisionesService_getDelta()).toThrow(/UbicacionFuenteDecisiones/);
  });
});

describe('efecto de cada decision (el mismo dominio que getDecisionesFuentesPozo)', () => {
  test('aceptar la UNICA fuente -> R en su coordenada (el estado cambia de D a R aunque el punto sea el mismo)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    const f = fuenteDe(U, UNICA);
    expect(delta().decisiones).toEqual([{ wellId: U, estado: 'R', lat: f.lat, lon: f.lon }]);
  });

  test('aceptar UNA ENTRE VARIAS -> R con las coordenadas de esa fuente (aunque el automatico dijera coincidente)', () => {
    ok(dec(W, I2, 'ACEPTAR'));
    const f = fuenteDe(W, I2);
    expect(delta().decisiones).toEqual([{ wellId: W, estado: 'R', lat: f.lat, lon: f.lon }]);
    expect(resolucion(W).estado).toBe('ACEPTADA');
  });

  test('aceptar la fuente que ya coincidia tambien es R (el estado difiere del original coincidente)', () => {
    ok(dec(W, REP, 'ACEPTAR'));
    const d = delta();
    expect(entrada(d, W).estado).toBe('R');
  });

  test('aceptar otra fuente REEMPLAZA a la aceptada anterior: queda la ultima', () => {
    ok(dec(W, REP, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    const f = fuenteDe(W, I2);
    expect(delta().decisiones).toEqual([{ wellId: W, estado: 'R', lat: f.lat, lon: f.lon }]);
  });

  test('descartar UNA de dos que coinciden (C) -> D con la que queda; descartar la otra -> D con la primera', () => {
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    const b = fuenteDe(DOS, DOS_B);
    expect(delta().decisiones).toEqual([{ wellId: DOS, estado: 'D', lat: b.lat, lon: b.lon }]);

    t = armar();
    t.padron[DOS] = { coordenadas: { x: DOS_A.x, y: DOS_A.y }, coordenadasProvincia: [{ x: DOS_B.x, y: DOS_B.y }] };
    ok(dec(DOS, DOS_B, 'DESCARTAR'));
    const a = fuenteDe(DOS, DOS_A);
    expect(delta().decisiones).toEqual([{ wellId: DOS, estado: 'D', lat: a.lat, lon: a.lon }]);
  });

  test('descartar la que SOBRA (la lejana) no cambia nada: el resultado es el original y el pozo NO sale', () => {
    ok(dec(W, I2, 'DESCARTAR'));
    expect(resolucion(W).cambiaRespectoDelOriginal).toBe(false);
    expect(delta().decisiones).toEqual([]);
  });

  test('descartar TODAS las fuentes -> N (con una sola y con varias)', () => {
    ok(dec(U, UNICA, 'DESCARTAR'));
    ok(dec(W, REP, 'DESCARTAR'));
    ok(dec(W, I1, 'DESCARTAR'));
    ok(dec(W, I2, 'DESCARTAR'));
    expect(resolucion(W).todasDescartadas).toBe(true);
    expect(delta().decisiones).toEqual([{ wellId: U, estado: 'N' }, { wellId: W, estado: 'N' }]);
  });

  test('descartes que dejan DISCREPANCIA entre las restantes -> N', () => {
    ok(dec(W, REP, 'DESCARTAR'));                     // quedan Irrigacion (1) e Irrigacion (2), a ~170 m
    expect(resolucion(W).estado).toBe('DISCREPANCIA');
    expect(delta().decisiones).toEqual([{ wellId: W, estado: 'N' }]);
  });

  test('restaurar una descartada vuelve al resultado original: el pozo sale del delta', () => {
    ok(dec(U, UNICA, 'DESCARTAR'));
    expect(delta().decisiones).toEqual([{ wellId: U, estado: 'N' }]);
    ok(dec(U, UNICA, 'RESTAURAR'));
    expect(delta().decisiones).toEqual([]);
  });

  test('quitar la aceptacion vuelve al original (no deja la fuente descartada)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    expect(delta().decisiones).toHaveLength(1);
    ok(dec(U, UNICA, 'QUITAR_ACEPTACION'));
    expect(delta().decisiones).toEqual([]);
  });

  test('descartar la aceptada (un solo paso) vuelve al automatico sobre las restantes', () => {
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(W, I2, 'DESCARTAR'));                       // quedan REP e I1 (coinciden): igual que el original
    expect(delta().decisiones).toEqual([]);
  });

  test('un pozo sin fuentes y sin decisiones efectivas no aparece; el resultado sin cambio de otro pozo tampoco', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    expect(delta().decisiones.map((e) => e.wellId)).toEqual([U]);
    expect(delta().decisiones.map((e) => e.wellId)).not.toContain(VACIO);
  });

  test('cada entrada coincide con la `resolucion` de getDecisionesFuentesPozo (no hay una segunda logica)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    const codigo = { ACEPTADA: 'R', COINCIDENTE: 'C', DISPONIBLE: 'D' };
    delta().decisiones.forEach((e) => {
      const r = resolucion(e.wellId);
      expect(e.estado).toBe(r.operativo ? codigo[r.estado] : 'N');
      if (e.estado !== 'N') {
        expect(e.lat).toBe(r.lat);
        expect(e.lon).toBe(r.lon);
      }
    });
  });

  test('la idempotencia existente no se rompe: reenviar la misma solicitud no cambia el delta', () => {
    const sol = solicitud({ wellId: U, ...UNICA, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-000001' });
    const a = t.S.ubicacionFuenteDecisionesService_decidir(VAL, NOMBRE, sol);
    const antes = delta();
    const b = t.S.ubicacionFuenteDecisionesService_decidir(VAL, NOMBRE, sol);
    expect(a.ok && b.ok).toBe(true);
    expect(b.duplicada).toBe(true);
    expect(t.filas()).toHaveLength(1);
    expect(delta()).toEqual(antes);
  });
});

describe('V (validada en campo) y NE NO participan', () => {
  test('el delta no lee ni nombra las correcciones de campo ni la red NE', () => {
    global.ubicacionCorreccionService_getUbicacionesValidadas = jest.fn(() => ({ ubicaciones: [{ wellId: W, lat: -33, lon: -69, vts: 'x' }] }));
    global.ubicacionCorreccionService_leerDerivadas = jest.fn(() => []);
    global.mapaNEService_getPuntos = jest.fn();
    ok(dec(W, I2, 'ACEPTAR'));
    const d = delta();
    expect(global.ubicacionCorreccionService_getUbicacionesValidadas).not.toHaveBeenCalled();
    expect(global.ubicacionCorreccionService_leerDerivadas).not.toHaveBeenCalled();
    expect(global.mapaNEService_getPuntos).not.toHaveBeenCalled();
    // aunque el pozo tenga una validada, el resultado REGISTRAL es el mismo: la validada la compone el cliente despues
    expect(entrada(d, W).estado).toBe('R');
  });

  test('guardia de codigo: la seccion del delta no referencia correcciones de campo, VALIDADA, NE ni el dataset del mapa', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteDecisionesService.js'), 'utf8');
    const ini = src.indexOf('// --- Lectura: getDecisionesFuentesDelta');
    const fin = src.indexOf('// --- Escritura: decidirFuenteUbicacion ---');
    expect(ini).toBeGreaterThan(-1);
    expect(fin).toBeGreaterThan(ini);
    const seccion = src.slice(ini, fin).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(seccion).not.toMatch(/ubicacionCorreccion|UbicacionCorrecciones|VALIDADA|mapaNE|NivelesEstaticos|nivelesEstaticos|mapaService_|getMapaPozos|pozos\.json/);
  });

  test('el dominio no se toco: sigue siendo la copia exacta del frontend (sin logica nueva de resolucion en el servicio)', () => {
    const front = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'ubicacionFuenteDecisionesLogic.js'), 'utf8').replace(/\r\n?/g, '\n');
    const back = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteDecisionesLogic.js'), 'utf8').replace(/\r\n?/g, '\n');
    expect(back).toBe(front);
  });
});

describe('datos que no se pueden aplicar (fail-closed)', () => {
  test('fuente OBSOLETA tras un reindexado: la decision no se hereda a la coordenada nueva', () => {
    ok(dec(W, I2, 'ACEPTAR'));
    expect(delta().decisiones).toHaveLength(1);
    t.padron[W].coordenadasProvincia[1] = { x: P_IRR2.x + 25, y: P_IRR2.y };         // el padron cambio la coordenada de Irrigacion (2)
    t.metadata = { periodo: '2026-10', generadoEl: '2026-10-20T10:00:00-03:00' };
    const d = delta();
    expect(d.periodo).toBe('2026-10');
    expect(d.decisiones).toEqual([]);                                                // la aceptada ya no existe: vuelve el automatico, igual al original
    expect(d.parcial).toBe(0);                                                       // una decision obsoleta se ignora correctamente: NO es un fallo
  });

  test('reindexado del MISMO periodo (otra corrida del indexador): no se sirve lo calculado con el padron anterior', () => {
    t.metadata = { periodo: '2026-09', generadoEl: '2026-09-14T12:58:36-03:00' };
    ok(dec(W, I2, 'ACEPTAR'));
    expect(delta().decisiones).toHaveLength(1);
    t.padron[W].coordenadasProvincia[1] = { x: P_IRR2.x + 25, y: P_IRR2.y };
    t.calmar();
    t.metadata = { periodo: '2026-09', generadoEl: '2026-09-30T08:00:00-03:00' };
    expect(delta().decisiones).toEqual([]);
  });

  test('el pozo ya no esta en el padron: sus decisiones se ignoran, no es un fallo (parcial 0) y queda en el log', () => {
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    delete t.padron[W];
    const d = delta();
    expect(d.parcial).toBe(0);
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);
    expect(logs().some((l) => /no estan en el padron actual/.test(l))).toBe(true);
  });

  test('HISTORIAL INCONSISTENTE de un pozo: sus decisiones no se aplican (ni punto ni N), se informa en `parcial` y los demas pozos siguen bien', () => {
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'roto', secuencia: 'abc', wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 1, evento: 'ACEPTADA', email: 'x@x.com', nombre: 'x', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'req-roto-0001', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);                          // W no sale: ni R, ni N, ni nada
    expect(d.parcial).toBe(1);                                                       // hay decisiones de W que no se pudieron interpretar: no se oculta
    expect(d.version).toBe(2);                                                       // la fila con secuencia invalida no cuenta para el maximo
    expect(logs().some((l) => /INCONSISTENTE/.test(l))).toBe(true);
    expect(logs().some((l) => /pozo 14-0001 sin resolver \(determinista, HISTORIAL_INCONSISTENTE\)/.test(l))).toBe(true);
  });

  test('evento de un tipo desconocido o secuencia duplicada: el pozo queda inconsistente, sin efecto y SUMA a parcial', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'dup', secuencia: 1, wellId: U, fuenteTipo: 'IRRIGACION', x: UNICA.x, y: UNICA.y, evento: 'BORRADA', email: 'x@x.com', nombre: 'x', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'req-dup-000001', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    const d = delta();
    expect(d.decisiones).toEqual([]);
    expect(d.parcial).toBe(1);
  });

  test('fila sin wellId valido: no pertenece a ningun pozo (se ignora, con log, y NO suma a parcial); su secuencia valida cuenta para la version', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'sinpozo', secuencia: 99, wellId: '', fuenteTipo: 'IRRIGACION', x: 1, y: 1, evento: 'ACEPTADA', email: 'x@x.com', nombre: 'x', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'req-sp-000001', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'raro', secuencia: 100, wellId: '99-9999', fuenteTipo: 'IRRIGACION', x: 1, y: 1, evento: 'ACEPTADA', email: 'x@x.com', nombre: 'x', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'req-rr-000001', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);
    expect(d.version).toBe(100);
    expect(d.parcial).toBe(0);                                                       // '99-9999' es un wellId valido que no esta en el padron: se ignora correctamente
    expect(logs().some((l) => /sin wellId valido/.test(l))).toBe(true);
  });

  test('fila a medias (celdas vacias) de un pozo: ese pozo queda inconsistente (parcial 1) y no rompe a los demas', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => (c === 'wellId' ? W : '')));
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);
    expect(d.parcial).toBe(1);
  });

  test('COORDENADA FUERA DE MENDOZA (D): aceptarla NO produce punto ni N: se omite el pozo y suma a parcial', () => {
    t.padron['02-0001'] = { coordenadas: null, coordenadasProvincia: [{ x: 2500000, y: 4000000 }] };      // ~21 grados mas al sur
    const f = t.Dominio.ufd_fuentesDePadron('02-0001', t.padron['02-0001']).fuentes[0];
    expect(f.lat).toBeLessThan(t.Dominio.UFD_MENDOZA_BBOX.latMin);
    ok(dec('02-0001', { fuenteTipo: 'IRRIGACION', x: 2500000, y: 4000000 }, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);                          // 02-0001 ausente: NO se retira un punto valido por un dato corrupto
    expect(d.parcial).toBe(1);
    expect(JSON.stringify(d)).not.toMatch(/"lat":-5/);
    expect(logs().some((l) => /pozo 02-0001 sin resolver \(determinista, COORDENADA_FUERA_DE_MENDOZA\)/.test(l))).toBe(true);
  });

  test('puntoOperativoRegistral: N solo para "sin punto" VALIDO; todo lo que no se pueda interpretar es `invalido` (jamas N)', () => {
    const p = t.S.ubicacionFuenteDecisionesService_puntoOperativoRegistral;
    expect(p({ estado: 'DISPONIBLE', operativo: true, lat: -33, lon: -69 })).toEqual({ estado: 'D', lat: -33, lon: -69 });
    expect(p({ estado: 'ACEPTADA', operativo: true, lat: -33, lon: -69 })).toEqual({ estado: 'R', lat: -33, lon: -69 });
    expect(p({ estado: 'COINCIDENTE', operativo: true, lat: -33, lon: -69 })).toEqual({ estado: 'C', lat: -33, lon: -69 });
    // "sin punto" valido del dominio
    expect(p({ estado: 'SIN_COORDENADAS', operativo: false, lat: null, lon: null })).toEqual({ estado: 'N' });
    expect(p({ estado: 'DISCREPANCIA', operativo: false, lat: null, lon: null })).toEqual({ estado: 'N' });
    // dato imposible de interpretar: NO es N
    const invalidos = [
      { estado: 'DISPONIBLE', operativo: true, lat: -55, lon: -69 },        // fuera de Mendoza (lat)
      { estado: 'DISPONIBLE', operativo: true, lat: -33, lon: -10 },        // fuera de Mendoza (lon)
      { estado: 'DISPONIBLE', operativo: true, lat: NaN, lon: -69 },
      { estado: 'DISPONIBLE', operativo: true, lat: Infinity, lon: -69 },
      { estado: 'DISPONIBLE', operativo: true, lat: '-33', lon: -69 },
      { estado: 'DISPONIBLE', operativo: true, lat: null, lon: null },
      { estado: 'DISPONIBLE', operativo: false, lat: -33, lon: -69 },       // dice disponible pero no operativo: incoherente
      { estado: 'DISCREPANCIA', operativo: true, lat: -33, lon: -69 },      // discrepancia operativa: incoherente
      { estado: 'SIN_COORDENADAS', operativo: true, lat: -33, lon: -69 },
      { estado: 'toString', operativo: true, lat: -33, lon: -69 },
      { estado: undefined, operativo: false },
      {}, null, undefined, 'texto', 7
    ];
    invalidos.forEach((r) => {
      const c = p(r);
      expect(c.invalido).toEqual(expect.any(String));
      expect(c.estado).toBeUndefined();
    });
  });

  test('entradaDelta: ok:true con entrada o null; ok:false (con motivo) ante cualquier dato que no se pueda interpretar; NUNCA convierte un dato corrupto en N', () => {
    const e = t.S.ubicacionFuenteDecisionesService_entradaDelta;
    const orig = { estado: 'COINCIDENTE', operativo: true, lat: -33, lon: -69 };
    // N legitimo
    expect(e('14-0001', { estado: 'SIN_COORDENADAS', operativo: false, todasDescartadas: true, original: orig })).toEqual({ ok: true, entrada: { wellId: '14-0001', estado: 'N' } });
    expect(e('14-0001', { estado: 'DISCREPANCIA', operativo: false, original: orig })).toEqual({ ok: true, entrada: { wellId: '14-0001', estado: 'N' } });
    // sin cambio
    expect(e('14-0001', { estado: 'COINCIDENTE', operativo: true, lat: -33, lon: -69, original: orig })).toEqual({ ok: true, entrada: null });
    expect(e('14-0001', { estado: 'SIN_COORDENADAS', operativo: false, original: { estado: 'DISCREPANCIA', operativo: false } })).toEqual({ ok: true, entrada: null });
    // cambio con punto
    expect(e('14-0001', { estado: 'ACEPTADA', operativo: true, lat: -33.5, lon: -69.1, original: orig })).toEqual({ ok: true, entrada: { wellId: '14-0001', estado: 'R', lat: -33.5, lon: -69.1 } });
    // fallos: el final es invalido, el original es invalido, no hay resolucion, o el dominio "absorbio" una coordenada fuera de Mendoza como sin punto
    expect(e('14-0001', { estado: 'ACEPTADA', operativo: true, lat: -55, lon: -69, original: orig })).toEqual({ ok: false, motivo: 'COORDENADA_INVALIDA' });
    expect(e('14-0001', { estado: 'ACEPTADA', operativo: true, lat: -33, lon: -69, original: { estado: 'DISPONIBLE', operativo: true, lat: NaN, lon: 1 } })).toEqual({ ok: false, motivo: 'COORDENADA_INVALIDA' });
    expect(e('14-0001', null)).toEqual({ ok: false, motivo: 'RESOLUCION_AUSENTE' });
    expect(e('14-0001', { estado: 'ACEPTADA', operativo: true, lat: -33, lon: -69 })).toEqual({ ok: false, motivo: 'RESOLUCION_AUSENTE' });
    expect(e('14-0001', { estado: 'SIN_COORDENADAS', operativo: false, anomalias: [{ codigo: 'COORDENADA_FUERA_DE_MENDOZA' }], original: orig })).toEqual({ ok: false, motivo: 'COORDENADA_FUERA_DE_MENDOZA' });
    expect(e('14-0001', { estado: 'COINCIDENTE', operativo: true, lat: -33, lon: -69, anomalias: [{ codigo: 'ACEPTADA_FUERA_DE_MENDOZA' }], original: orig })).toEqual({ ok: false, motivo: 'COORDENADA_FUERA_DE_MENDOZA' });
    expect(e('14-0001', { estado: 'SIN_COORDENADAS', operativo: false, original: { estado: 'SIN_COORDENADAS', operativo: false, anomalias: [{ codigo: 'COORDENADA_FUERA_DE_MENDOZA' }] } })).toEqual({ ok: false, motivo: 'COORDENADA_FUERA_DE_MENDOZA' });
  });
});

describe('version y periodo', () => {
  test('version = secuencia maxima de TODA la hoja (cualquier pozo); 0 si no hay decisiones', () => {
    expect(delta().version).toBe(0);
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(W, REP, 'DESCARTAR'));
    expect(delta().version).toBe(3);
  });

  test('la version cuenta aunque la decision no cambie el punto operativo', () => {
    ok(dec(W, I2, 'DESCARTAR'));
    const d = delta();
    expect(d.decisiones).toEqual([]);
    expect(d.version).toBe(1);
  });

  test('las secuencias invalidas (0, negativa, decimal, enorme, no numerica) NO cuentan para la version', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    [0, -5, 2.5, 1e20, 'abc', ''].forEach((sec, i) => {
      t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'inv-' + i, secuencia: sec, wellId: '16-0001', fuenteTipo: 'IRRIGACION', x: 1, y: 1, evento: 'ACEPTADA', email: 'x@x.com', nombre: 'x', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'req-inv-00000' + i, versionVista: 0, padronPeriodo: '2026-09' }[c])));
    });
    expect(delta().version).toBe(1);
  });

  test('periodo = el de la metadata del padron actual (nada hardcodeado): cambia cuando cambia la metadata', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.metadata = { periodo: '2027-03' };
    expect(delta().periodo).toBe('2027-03');
    t.metadata = { periodo: '2031-12', generadoEl: '2031-12-02T00:00:00-03:00' };
    expect(delta().periodo).toBe('2031-12');
  });

  test('SIN periodo confiable el delta FALLA (no devuelve periodo vacio): metadata ausente, sin periodo, vacio, no textual, nula o con la lectura caida', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    const casos = [
      () => ({ found: false }),
      () => ({ found: true, metadata: { generadoEl: 'x' } }),
      () => ({ found: true, metadata: { periodo: null } }),
      () => ({ found: true, metadata: { periodo: '' } }),
      () => ({ found: true, metadata: { periodo: '   ' } }),
      () => ({ found: true, metadata: { periodo: 202609 } }),
      () => ({ found: true, metadata: null }),
      () => null,
      () => undefined,
      () => { throw new Error('drive caido'); }
    ];
    casos.forEach((caso) => {
      global.registryService_getMetadata.mockImplementation(caso);
      t.cache.store = {};
      expect(() => delta()).toThrow(/periodo valido|drive caido|Cannot read/);
    });
  });

  test('sin periodo confiable tampoco se sirve un delta que estaba en cache (no se puede verificar con que padron se calculo)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    delta();
    expect(t.cache.store[K_COMPLETO]).toBeDefined();
    global.registryService_getMetadata.mockImplementation(() => ({ found: false }));
    expect(() => t.S.ubicacionFuenteDecisionesService_getDelta()).toThrow(/periodo valido/);
  });

  test('el Api responde SERVICE_UNAVAILABLE generico (sin detalle) si el padron no tiene periodo; el detalle va al log', () => {
    global.registryService_getMetadata.mockImplementation(() => ({ found: false }));
    const r = JSON.parse(t.Api.doPost({ postData: { contents: JSON.stringify({ action: 'getDecisionesFuentesDelta', sessionToken: 'tok-lee@x.com' }) } }).text);
    expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(global.Logger.log.mock.calls.some((c) => /getDecisionesFuentesDelta fallo.*periodo valido/.test(String(c[0])))).toBe(true);
  });

  test('escribir una decision NO depende de la metadata (como antes): sin periodo se guarda padronPeriodo vacio', () => {
    global.registryService_getMetadata.mockImplementation(() => ({ found: false }));
    ok(dec(U, UNICA, 'ACEPTAR'));
    expect(t.fila(0).padronPeriodo).toBe('');
  });

  test('guardia de codigo: el periodo no esta hardcodeado en el codigo del delta', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteDecisionesService.js'), 'utf8');
    const seccion = src.slice(src.indexOf('// --- Lectura: getDecisionesFuentesDelta'), src.indexOf('// --- Escritura: decidirFuenteUbicacion ---')).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(seccion).not.toMatch(/['"]20\d\d-\d\d['"]/);
    expect(seccion).toMatch(/registryService_getMetadata\(\)/);
  });
});

describe('lectura eficiente', () => {
  test('la hoja se lee UNA vez y el padron de todos los pozos con decisiones se pide en UN lote', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    limpiarEspias();
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const rango = hoja.getDataRange.bind(hoja);
    let lecturas = 0;
    hoja.getDataRange = (...a) => { lecturas += 1; return rango(...a); };
    t.cache.store = {};
    const d = delta();
    expect(lecturas).toBe(1);
    expect(t.padronLotes).toHaveLength(1);
    expect(t.padronLotes[0].ids).toEqual([U, W, DOS]);                       // un lote, con los tres, ordenados
    expect(t.padronLotes[0].deadlineMs).toBeGreaterThan(Date.now());
    expect(d.decisiones).toHaveLength(3);
  });

  test('deja UNA linea de log por calculo con la duracion y los conteos (para medir el costo en frio en produccion); un acierto del delta completo no escribe esa linea', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    global.Logger.log.mockClear();
    t.alLeerLotePadron = () => { t.reloj += 250; };
    delta();
    const lineas = logs().filter((l) => /delta calculado en/.test(l));
    expect(lineas).toHaveLength(1);
    expect(lineas[0]).toMatch(/delta calculado en \d+ ms: 2 pozo\(s\) con decisiones, 0 por cache, 2 a calcular, 0 archivo\(s\) del padron, 2 entrada\(s\), parcial 0/);
    global.Logger.log.mockClear();
    t.S.ubicacionFuenteDecisionesService_getDelta();                         // acierto del delta completo
    expect(logs().filter((l) => /delta calculado en/.test(l))).toHaveLength(0);
    expect(JSON.stringify(lineas)).not.toMatch(/@|Valeria|motivo/);
  });

  test('no usa registryService_getWellLocation pozo por pozo (la lectura N veces que abre un departamento cada vez)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    global.registryService_getWellLocation.mockClear();
    t.cache.store = {};
    delta();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });
});

describe('presupuesto de tiempo y parcial', () => {
  test('lo que no se pudo leer cuenta en `parcial`, NO se inventa y no se cachea el delta completo', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    t.cache.store = {};
    t.padronNoResuelto.add(U);
    const d = delta();
    expect(d.parcial).toBe(1);
    expect(d.decisiones.map((e) => e.wellId)).toEqual([W, DOS]);
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();                       // un parcial jamas se cachea como completo
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_' + U) === 0)).toEqual([]);   // ni el pozo sin resolver
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_' + W) === 0)).toHaveLength(1);
    expect(logs().some((l) => /delta con 1 pozo\(s\) sin resolver por causas transitorias/.test(l))).toBe(true);
    // cuando la lectura vuelve, el siguiente delta esta completo
    t.padronNoResuelto.clear();
    const d2 = delta();
    expect(d2.parcial).toBe(0);
    expect(d2.decisiones.map((e) => e.wellId)).toEqual([U, W, DOS]);
  });

  test('se agota el presupuesto durante la lectura del padron: parcial = todos los que faltaban y la lista queda vacia', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    t.alLeerLotePadron = () => { t.reloj += 20000; };
    const d = delta();
    expect(d.parcial).toBe(2);
    expect(d.decisiones).toEqual([]);
  });

  test('se agota despues de leer el padron pero antes de calcular: lo calculado antes se conserva, lo que sigue es parcial', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    const original = global.registryService_getWellLocations;
    global.registryService_getWellLocations = jest.fn((ids, op) => {
      const r = original(ids, op);
      t.reloj += 20000;                                                      // la lectura "tardo" mas que el presupuesto
      return r;
    });
    const d = delta();
    expect(d.parcial).toBe(2);
    expect(d.decisiones).toEqual([]);
  });

  test('presupuestoMs en 0: nada se resuelve, todo es parcial; con el cache por pozo tibio, nada es parcial', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    expect(delta({ presupuestoMs: 0 }).parcial).toBe(2);
    t.cache.store = {};
    delta();                                                                 // entibia el cache por pozo
    delete t.cache.store[K_COMPLETO];
    limpiarEspias();
    t.calmar();
    const d = t.S.ubicacionFuenteDecisionesService_getDelta({ presupuestoMs: 0 });
    expect(d.parcial).toBe(0);
    expect(d.decisiones).toHaveLength(2);
    expect(global.registryService_getWellLocations).not.toHaveBeenCalled();
  });

  test('el presupuesto por defecto es de 15 s', () => {
    expect(t.S.UFD_SVC_DELTA_PRESUPUESTO_MS).toBe(15000);
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    delta();
    const lote = t.padronLotes[t.padronLotes.length - 1];
    expect(lote.deadlineMs - Date.now()).toBeLessThanOrEqual(15000);
    expect(lote.deadlineMs - Date.now()).toBeGreaterThan(14000);
  });

  test('un pozo cuyo calculo lanza (ficha corrupta) cuenta como parcial y no tumba a los demas', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    const original = global.registryService_getWellLocations;
    global.registryService_getWellLocations = jest.fn((ids, op) => {
      const r = original(ids, op);
      r.locations[U] = Object.defineProperty({ wellId: U }, 'coordenadas', { get() { throw new Error('ficha corrupta'); }, enumerable: true });
      return r;
    });
    const d = delta();
    expect(d.parcial).toBe(1);
    expect(d.decisiones.map((e) => e.wellId)).toEqual([W]);
    expect(logs().some((l) => /pozo 01-0012 sin resolver \(transitorio, CALCULO\)/.test(l))).toBe(true);
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_' + U) === 0)).toEqual([]);          // un error inesperado NO se cachea: se reintenta
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();
  });

  test('un pozo que no figura en el padron NO es parcial (es un dato, no un fallo)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    delete t.padron[U];
    t.cache.store = {};
    expect(delta().parcial).toBe(0);
  });
});

describe('cache', () => {
  test('primera llamada: cache vacio -> un lote, se guardan el delta completo (120 s) y el resultado de CADA pozo (6 h); la segunda no lee hoja ni padron', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ok(dec(DOS, DOS_A, 'DESCARTAR'));
    t.cache.store = {};
    t.cache.ttl = {};
    limpiarEspias();
    const primero = delta();
    expect(t.padronLotes).toHaveLength(1);
    expect(t.cache.ttl[K_COMPLETO]).toBe(120);
    const clavesPozo = Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_') === 0);
    expect(clavesPozo).toHaveLength(3);
    clavesPozo.forEach((k) => expect(t.cache.ttl[k]).toBe(21600));
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const rango = hoja.getDataRange.bind(hoja);
    let lecturas = 0;
    hoja.getDataRange = (...a) => { lecturas += 1; return rango(...a); };
    limpiarEspias();
    const segundo = delta();
    expect(segundo).toEqual(primero);
    expect(lecturas).toBe(0);
    expect(t.padronLotes).toHaveLength(0);
  });

  test('la clave por pozo incluye pozo, cantidad de filas, secuencia maxima del pozo y la version del padron', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.metadata = { periodo: '2026-09', generadoEl: '2026-09-14T12:58:36-03:00' };
    t.cache.store = {};
    delta();
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_') === 0)).toEqual(['ufd_res_v1_' + U + '_1_1_2026-09@2026-09-14T12:58:36-03:00']);
  });

  test('vencido el delta completo: se vuelve a leer la hoja pero el padron NO (acierto por pozo)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    delta();
    delete t.cache.store[K_COMPLETO];
    limpiarEspias();
    const d = delta();
    expect(t.padronLotes).toHaveLength(0);
    expect(d.decisiones).toHaveLength(2);
  });

  test('una decision nueva produce otra clave: solo ESE pozo se recalcula', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    t.cache.store = {};
    delta();
    ok(dec(W, REP, 'ACEPTAR'));                                               // cambia el pozo W (aceptada distinta)
    limpiarEspias();
    const d = delta();
    expect(t.padronLotes).toHaveLength(1);
    expect(t.padronLotes[0].ids).toEqual([W]);
    expect(entrada(d, W).estado).toBe('R');
    expect(d.decisiones).toHaveLength(2);
  });

  test('resultado sin efecto tambien se cachea ("=") y no vuelve a pedir el padron', () => {
    ok(dec(W, I2, 'DESCARTAR'));                                              // sin efecto operativo
    t.cache.store = {};
    expect(delta().decisiones).toEqual([]);
    delete t.cache.store[K_COMPLETO];
    limpiarEspias();
    delta();
    expect(t.padronLotes).toHaveLength(0);
  });

  test('delta completo demasiado grande (> 90.000 caracteres): NO se trunca ni se cachea completo, el cache por pozo sigue y la segunda llamada no lee el padron', () => {
    const N = 1600;
    const filas = t.hojas.UbicacionFuenteDecisiones.filas;
    for (let i = 0; i < N; i++) {
      const id = String(1 + (i % 19)).padStart(2, '0') + '-' + String(2000 + Math.floor(i / 19)).padStart(4, '0');
      const x = 2400000 + i * 7;
      const y = 6300000 + i * 5;
      t.padron[id] = { coordenadas: null, coordenadasProvincia: [{ x: x, y: y }] };
      filas.push(t.columnas.map((c) => ({ decisionId: 'seed-' + i, secuencia: 10 + i, wellId: id, fuenteTipo: 'IRRIGACION', x: x, y: y, evento: 'ACEPTADA', motivo: '', email: 'seed@x.com', nombre: 'seed', timestampUtc: '2026-10-01T00:00:00.000Z', clientRequestId: 'seed-req-' + String(i).padStart(6, '0'), versionVista: 0, padronPeriodo: '2026-09' }[c])));
    }
    t.cache.store = {};
    limpiarEspias();
    const d = delta();
    expect(d.decisiones).toHaveLength(N);                                     // nada se pierde
    expect(d.parcial).toBe(0);
    expect(JSON.stringify({ p: d, g: '' }).length).toBeGreaterThan(t.S.UFD_SVC_DELTA_CACHE_MAX_CARACTERES);
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();
    expect(logs().some((l) => /supera el limite de CacheService/.test(l))).toBe(true);
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_') === 0)).toHaveLength(N);
    t.cache.putAll.mock.calls.forEach((c) => expect(Object.keys(c[0]).length).toBeLessThanOrEqual(100));
    t.cache.getAll.mock.calls.forEach((c) => expect(c[0].length).toBeLessThanOrEqual(100));
    expect(t.padronLotes).toHaveLength(1);
    expect(t.padronLotes[0].ids).toHaveLength(N);
    limpiarEspias();
    const otra = delta();
    expect(otra).toEqual(d);
    expect(t.padronLotes).toHaveLength(0);                                    // todo por acierto de cache por pozo
  });

  test('si el cache falla (get, getAll, put, putAll, remove) el delta se calcula igual y nunca lanza', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    ok(dec(W, I2, 'ACEPTAR'));
    ['get', 'getAll', 'put', 'putAll', 'remove'].forEach((k) => {
      t.cache.store = {};
      t.cache.falla[k] = true;
      const d = delta();
      expect(d.decisiones.map((e) => e.wellId)).toEqual([U, W]);
      expect(d.parcial).toBe(0);
      t.cache.falla[k] = false;
    });
  });

  test('sin CacheService disponible el delta se calcula igual', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);
  });

  test('un cache por pozo corrupto o con coordenadas invalidas se recalcula (nunca se sirve)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    delta();
    const k = Object.keys(t.cache.store).filter((x) => x.indexOf('ufd_res_v1_') === 0)[0];
    ['{roto', '{"e":"R","lat":0,"lon":0}', '{"e":"X"}', '{"e":"R","lat":-33}', 'null', ''].forEach((malo) => {
      delete t.cache.store[K_COMPLETO];
      t.cache.store[k] = malo;
      limpiarEspias();
      const d = delta();
      expect(t.padronLotes).toHaveLength(1);
      expect(entrada(d, U).estado).toBe('R');
    });
  });

  test('un delta completo cacheado con OTRA version del padron o mal formado no se sirve; con `parcial` valido (> 0 por fallos deterministas) SI', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    const bueno = delta();
    expect(JSON.parse(t.cache.store[K_COMPLETO]).p).toEqual(bueno);
    const otros = [
      JSON.stringify({ p: bueno, g: 'otro@padron' }),
      JSON.stringify({ p: Object.assign({}, bueno, { parcial: -1 }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { parcial: 1.5 }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { parcial: '1' }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { parcial: undefined }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { decisiones: 'no' }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { version: '1' }), g: '2026-09@' }),
      JSON.stringify({ p: Object.assign({}, bueno, { periodo: '' }), g: '2026-09@' }),
      '{roto', 'null'
    ];
    otros.forEach((malo) => {
      t.cache.store[K_COMPLETO] = malo;
      limpiarEspias();
      const d = t.S.ubicacionFuenteDecisionesService_getDelta();
      expect(d).toEqual(bueno);
    });
    // un parcial > 0 bien formado (solo se cachea si todos los fallos son deterministas) se sirve tal cual
    t.cache.store[K_COMPLETO] = JSON.stringify({ p: Object.assign({}, bueno, { parcial: 2 }), g: '2026-09@' });
    limpiarEspias();
    expect(t.S.ubicacionFuenteDecisionesService_getDelta().parcial).toBe(2);
    expect(t.padronLotes).toHaveLength(0);
  });

  test('una invalidacion reciente (la marca) impide guardar el resultado calculado ANTES de ella; pasado el margen se guarda', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    t.cache.store[K_MARCA] = String(Date.now());
    t.S.ubicacionFuenteDecisionesService_getDelta();                          // sin calmar el reloj: la marca es de "ahora"
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();
    expect(logs().some((l) => /se invalido mientras se calculaba/.test(l))).toBe(true);
    t.calmar();
    t.S.ubicacionFuenteDecisionesService_getDelta();
    expect(t.cache.store[K_COMPLETO]).toBeDefined();
  });
});

describe('invalidacion del delta completo', () => {
  const invalidaPor = {
    'aceptar': () => dec(U, UNICA, 'ACEPTAR'),
    'descartar con efecto (todas -> N)': () => dec(U, UNICA, 'DESCARTAR'),
    'descartar que cambia C -> D': () => dec(DOS, DOS_A, 'DESCARTAR')
  };
  test.each(Object.keys(invalidaPor))('%s -> invalida el delta completo (marca + borrado) DESPUES de escribir la fila', (nombre) => {
    t.calmar();
    delta();
    limpiarEspias();
    const orden = [];
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const getRange = hoja.getRange.bind(hoja);
    hoja.getRange = (...a) => { const r = getRange(...a); const sv = r.setValues && r.setValues.bind(r); if (sv) { r.setValues = (v) => { orden.push('escribe'); return sv(v); }; } return r; };
    t.cache.remove.mockImplementation((k) => { if (k === K_COMPLETO) { orden.push('invalida'); } });
    ok(invalidaPor[nombre]());
    expect(deltaInvalidado()).toBe(true);
    expect(t.cache.put.mock.calls.some((c) => c[0] === K_MARCA)).toBe(true);
    expect(orden.indexOf('invalida')).toBeGreaterThan(orden.indexOf('escribe'));
  });

  test('restaurar, quitar la aceptacion y reemplazar la aceptada tambien invalidan (cambian el punto)', () => {
    ok(dec(U, UNICA, 'DESCARTAR'));
    limpiarEspias();
    ok(dec(U, UNICA, 'RESTAURAR'));
    expect(deltaInvalidado()).toBe(true);
    ok(dec(U, UNICA, 'ACEPTAR'));
    limpiarEspias();
    ok(dec(U, UNICA, 'QUITAR_ACEPTACION'));
    expect(deltaInvalidado()).toBe(true);
    ok(dec(W, REP, 'ACEPTAR'));
    limpiarEspias();
    ok(dec(W, I2, 'ACEPTAR'));
    expect(deltaInvalidado()).toBe(true);
  });

  test('una decision SIN cambio del punto operativo registral NO invalida el delta (si invalida la vista del pozo)', () => {
    limpiarEspias();
    ok(dec(W, I2, 'DESCARTAR'));                                              // descartar la lejana: sigue coincidente, mismas coordenadas
    expect(deltaInvalidado()).toBe(false);
    expect(t.cache.remove).toHaveBeenCalledWith('ufd_vista_v1_' + W);
  });

  test('los rechazos (STALE_STATE, transicion invalida, fuente inexistente, motivo vacio...) no invalidan nada', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    limpiarEspias();
    expect(dec(U, UNICA, 'ACEPTAR', { versionVista: 0 }).code).toBe('STALE_STATE');
    expect(dec(U, UNICA, 'ACEPTAR').code).toBe('ALREADY_IN_STATE');
    expect(dec(U, UNICA, 'RESTAURAR').code).toBe('INVALID_TRANSITION');
    expect(dec(U, { fuenteTipo: 'IRRIGACION', x: 1, y: 1 }, 'ACEPTAR').code).toBe('SOURCE_NOT_FOUND');
    expect(dec(U, UNICA, 'DESCARTAR', { motivo: '' }).code).toBe('INVALID_MOTIVO');
    expect(deltaInvalidado()).toBe(false);
  });

  test('un reintento idempotente no invalida', () => {
    const sol = solicitud({ wellId: U, ...UNICA, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-reintento-1' });
    ok(t.S.ubicacionFuenteDecisionesService_decidir(VAL, NOMBRE, sol));
    limpiarEspias();
    expect(t.S.ubicacionFuenteDecisionesService_decidir(VAL, NOMBRE, sol).duplicada).toBe(true);
    expect(deltaInvalidado()).toBe(false);
  });

  test('tras invalidar, la lectura siguiente ve el efecto nuevo (aunque el delta completo estuviera cacheado)', () => {
    t.calmar();
    expect(t.S.ubicacionFuenteDecisionesService_getDelta().decisiones).toEqual([]);
    expect(t.cache.store[K_COMPLETO]).toBeDefined();
    ok(dec(U, UNICA, 'DESCARTAR'));
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();
    t.calmar();
    expect(t.S.ubicacionFuenteDecisionesService_getDelta().decisiones).toEqual([{ wellId: U, estado: 'N' }]);
  });

  test('invalidarDelta nunca lanza aunque el cache falle y informa false', () => {
    t.cache.falla.put = true;
    t.cache.falla.remove = true;
    expect(t.S.ubicacionFuenteDecisionesService_invalidarDelta()).toBe(false);
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    expect(t.S.ubicacionFuenteDecisionesService_invalidarDelta()).toBe(false);
  });

  test('si el cache del delta falla al invalidar, la decision igual se escribe', () => {
    t.cache.falla.remove = true;
    const r = dec(U, UNICA, 'ACEPTAR');
    expect(r.ok).toBe(true);
    expect(t.filas()).toHaveLength(1);
  });
});

describe('N solo significa "sin punto" por una resolucion VALIDA; un dato corrupto es un fallo (omitido + parcial), nunca N', () => {
  const FUERA = { x: 2500000, y: 4000000 };                                  // ~21 grados al sur de Mendoza

  test('A) todas las fuentes descartadas -> N (parcial 0)', () => {
    ok(dec(U, UNICA, 'DESCARTAR'));
    const d = delta();
    expect(d.decisiones).toEqual([{ wellId: U, estado: 'N' }]);
    expect(d.parcial).toBe(0);
  });

  test('B) las restantes siguen en discrepancia VALIDA -> N (parcial 0)', () => {
    ok(dec(W, REP, 'DESCARTAR'));
    expect(resolucion(W).estado).toBe('DISCREPANCIA');
    const d = delta();
    expect(d.decisiones).toEqual([{ wellId: W, estado: 'N' }]);
    expect(d.parcial).toBe(0);
  });

  test.each([
    ['texto no numerico', 'abc'],
    ['nula', null],
    ['NaN (llega como nula por JSON)', NaN]
  ])('C) coordenada del padron corrupta (%s) -> el pozo se OMITE, parcial 1, y NO se retira ningun punto valido', (nombre, malo) => {
    t.padron['02-0002'] = { coordenadas: null, coordenadasProvincia: [{ x: P_UNICA.x, y: P_UNICA.y }, { x: malo, y: 6350000 }] };
    ok(dec('02-0002', UNICA, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    const d = delta();
    expect(d.decisiones.map((e) => e.wellId)).toEqual([U]);                    // ni R ni N para 02-0002
    expect(d.parcial).toBe(1);
    expect(logs().some((l) => /pozo 02-0002 sin resolver \(determinista, FUENTE_PADRON_INVALIDA\)/.test(l))).toBe(true);
  });

  test('C2) una coordenada corrupta en TODAS las fuentes tampoco es "sin punto": se omite y suma a parcial', () => {
    t.padron['02-0003'] = { coordenadas: null, coordenadasProvincia: [{ x: P_UNICA.x, y: P_UNICA.y }] };
    ok(dec('02-0003', UNICA, 'ACEPTAR'));
    t.padron['02-0003'] = { coordenadas: null, coordenadasProvincia: [{ x: 'abc', y: 'def' }] };          // el padron quedo corrupto
    t.metadata = { periodo: '2026-09', generadoEl: 'otra-corrida' };
    const d = delta();
    expect(d.decisiones).toEqual([]);
    expect(d.parcial).toBe(1);
  });

  test('D) coordenada fuera de Mendoza -> el pozo se OMITE y suma a parcial (aceptarla o descartarla), nunca N', () => {
    t.padron['02-0001'] = { coordenadas: null, coordenadasProvincia: [{ x: FUERA.x, y: FUERA.y }] };
    t.padron['02-0004'] = { coordenadas: null, coordenadasProvincia: [{ x: FUERA.x, y: FUERA.y }] };
    ok(dec('02-0001', { fuenteTipo: 'IRRIGACION', x: FUERA.x, y: FUERA.y }, 'ACEPTAR'));
    ok(dec('02-0004', { fuenteTipo: 'IRRIGACION', x: FUERA.x, y: FUERA.y }, 'DESCARTAR'));    // descartar la unica fuente (fuera de Mendoza): tampoco es un N confiable
    ok(dec(U, UNICA, 'DESCARTAR'));                                                           // este SI es un N valido
    const d = delta();
    expect(d.decisiones).toEqual([{ wellId: U, estado: 'N' }]);
    expect(d.parcial).toBe(2);
    expect(JSON.stringify(d)).not.toContain('02-0001');
    expect(JSON.stringify(d)).not.toContain('02-0004');
  });

  test('un dato corrupto no retira un punto valido: si el pozo sigue sin resolverse, el cliente conserva base + V (no hay entrada que lo quite)', () => {
    t.padron['02-0001'] = { coordenadas: null, coordenadasProvincia: [{ x: FUERA.x, y: FUERA.y }] };
    ok(dec('02-0001', { fuenteTipo: 'IRRIGACION', x: FUERA.x, y: FUERA.y }, 'ACEPTAR'));
    const d = delta();
    expect(d.decisiones.filter((e) => e.estado === 'N')).toEqual([]);
    expect(d.parcial).toBe(1);
  });

  test('los fallos deterministas se cachean por pozo (no se vuelve a leer el padron) y siguen contando en parcial; el delta completo tambien se cachea', () => {
    t.padron['02-0001'] = { coordenadas: null, coordenadasProvincia: [{ x: FUERA.x, y: FUERA.y }] };
    ok(dec('02-0001', { fuenteTipo: 'IRRIGACION', x: FUERA.x, y: FUERA.y }, 'ACEPTAR'));
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    const primero = delta();
    expect(primero.parcial).toBe(1);
    expect(t.cache.store[K_COMPLETO]).toBeDefined();                           // sin fallos transitorios: se cachea aunque parcial > 0
    delete t.cache.store[K_COMPLETO];
    limpiarEspias();
    const segundo = delta();
    expect(segundo).toEqual(primero);
    expect(t.padronLotes).toHaveLength(0);                                     // el fallo determinista salio del cache por pozo
    expect(Object.keys(t.cache.store).some((k) => k.indexOf('ufd_res_v1_02-0001') === 0 && /"e":"!"/.test(t.cache.store[k]))).toBe(true);
  });

  test('los fallos TRANSITORIOS no se cachean (por pozo ni el delta completo) y se reintentan en la llamada siguiente', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    t.cache.store = {};
    t.padronNoResuelto.add(U);
    expect(delta().parcial).toBe(1);
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufd_res_v1_') === 0)).toEqual([]);
    expect(t.cache.store[K_COMPLETO]).toBeUndefined();
    t.padronNoResuelto.clear();
    const d = delta();
    expect(d.parcial).toBe(0);
    expect(d.decisiones).toHaveLength(1);
  });
});

describe('contrato de `parcial`: parcial > 0 NO invalida el resto del delta', () => {
  function sembrar(n) {
    const filas = t.hojas.UbicacionFuenteDecisiones.filas;
    const ids = [];
    for (let i = 0; i < n; i++) {
      const id = String(1 + (i % 19)).padStart(2, '0') + '-' + String(3000 + Math.floor(i / 19)).padStart(4, '0');
      const x = 2400000 + i * 7;
      const y = 6300000 + i * 5;
      t.padron[id] = { coordenadas: null, coordenadasProvincia: [{ x: x, y: y }] };
      filas.push(t.columnas.map((c) => ({ decisionId: 'p-' + i, secuencia: 10 + i, wellId: id, fuenteTipo: 'IRRIGACION', x: x, y: y, evento: 'ACEPTADA', motivo: '', email: 'seed@x.com', nombre: 'seed', timestampUtc: '2026-10-01T00:00:00.000Z', clientRequestId: 'p-req-' + String(i).padStart(6, '0'), versionVista: 0, padronPeriodo: '2026-09' }[c])));
      ids.push(id);
    }
    return ids.sort();
  }

  test('{parcial: 3, decisiones: 97 entradas validas}: las 97 son utilizables, identicas a las de una corrida completa; los 3 pozos no resueltos simplemente no aparecen', () => {
    const ids = sembrar(100);
    t.cache.store = {};
    const completo = delta();
    expect(completo.parcial).toBe(0);
    expect(completo.decisiones).toHaveLength(100);
    t.cache.store = {};
    const sinResolver = [ids[5], ids[40], ids[77]];
    sinResolver.forEach((id) => t.padronNoResuelto.add(id));
    const d = delta();
    expect(d.parcial).toBe(3);
    expect(d.decisiones).toHaveLength(97);
    d.decisiones.forEach((e) => {
      expect(sinResolver).not.toContain(e.wellId);
      expect(['R', 'C', 'D']).toContain(e.estado);
      expect(completo.decisiones).toContainEqual(e);                           // cada entrada recibida es exactamente la de la corrida completa
    });
    expect(d.decisiones.filter((e) => e.estado === 'N')).toEqual([]);          // los no resueltos NO se convierten en N
  });

  test('mezcla de causas: transitorio + determinista + obsoleta + pozo ausente del padron: solo los dos primeros suman', () => {
    const ids = sembrar(10);
    t.padronNoResuelto.add(ids[0]);                                             // transitorio
    t.padron[ids[1]].coordenadasProvincia[0] = { x: 'abc', y: 1 };              // determinista (fuente del padron corrupta)
    delete t.padron[ids[2]];                                                    // pozo que ya no esta en el padron (legitimo)
    t.padron[ids[3]].coordenadasProvincia[0] = { x: t.padron[ids[3]].coordenadasProvincia[0].x + 40, y: t.padron[ids[3]].coordenadasProvincia[0].y };      // la fuente cambio (sigue en Mendoza): la decision queda obsoleta (legitimo)
    t.cache.store = {};
    const d = delta();
    expect(d.parcial).toBe(2);
    expect(d.decisiones.map((e) => e.wellId)).not.toContain(ids[0]);
    expect(d.decisiones.map((e) => e.wellId)).not.toContain(ids[1]);
    expect(d.decisiones.map((e) => e.wellId)).not.toContain(ids[2]);
    expect(d.decisiones.map((e) => e.wellId)).not.toContain(ids[3]);
    expect(d.decisiones).toHaveLength(6);
  });
});

describe('Api: getDecisionesFuentesDelta', () => {
  const post = (body) => JSON.parse(t.Api.doPost({ postData: { contents: JSON.stringify(body) } }).text);
  const pedir = (token) => post({ action: 'getDecisionesFuentesDelta', sessionToken: token === undefined ? 'tok-lee@x.com' : token });

  test('enrutado por doPost: devuelve {status:ok, data:{version, periodo, parcial, decisiones}}', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    const r = pedir();
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data).sort()).toEqual(['decisiones', 'parcial', 'periodo', 'version']);
    expect(r.data.decisiones[0]).toMatchObject({ wellId: U, estado: 'R' });
  });

  test.each([
    ['sin ningun permiso funcional (solo activo)', 'tok-nada@x.com'],
    ['solo ubicacion', 'tok-lee@x.com'],
    ['validador', 'tok-val@x.com'],
    ['solo ubicacion_validar (sin ubicacion)', 'tok-soloval@x.com']
  ])('usuario activo %s -> OK (como getMapaPozos y getUbicacionesValidadas: no exige permiso de modulo)', (nombre, token) => {
    expect(pedir(token).status).toBe('ok');
  });

  test('usuario inactivo -> USER_DISABLED; token invalido o vacio -> UNAUTHORIZED; el servicio ni se consulta', () => {
    const espia = jest.spyOn(t.S, 'ubicacionFuenteDecisionesService_getDelta');
    expect(pedir('tok-baja@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
    expect(pedir('basura')).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(pedir('')).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(global.registryService_getWellLocations).not.toHaveBeenCalled();
    espia.mockRestore();
  });

  test('un fallo del servicio (hoja inexistente) responde SERVICE_UNAVAILABLE generico, sin detalle interno; el detalle va a Logger y el fallo se audita', () => {
    t = armar({ sinHoja: true });
    const r = pedir('tok-lee@x.com');
    expect(r).toEqual({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(JSON.stringify(r)).not.toMatch(/UbicacionFuenteDecisiones|hoja|spreadsheet/i);
    expect(global.Logger.log.mock.calls.some((c) => /getDecisionesFuentesDelta fallo/.test(String(c[0])))).toBe(true);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('lee@x.com', 'getDecisionesFuentesDelta', null, 'SERVICE_UNAVAILABLE');
  });

  test('una lectura correcta NO se audita (no hay wellId ni accion que registrar)', () => {
    global.logHistoryEvent.mockClear();
    pedir('tok-lee@x.com');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('ignora cualquier campo extra del pedido (no hay forma de pedir un pozo, un periodo o una version)', () => {
    ok(dec(U, UNICA, 'ACEPTAR'));
    const r = post({ action: 'getDecisionesFuentesDelta', sessionToken: 'tok-lee@x.com', wellId: W, version: 99, periodo: 'x', email: 'otro@x.com' });
    expect(r.status).toBe('ok');
    expect(r.data.decisiones.map((e) => e.wellId)).toEqual([U]);
  });

  test('decidir por el Api (decidirFuenteUbicacion) invalida el delta y la lectura siguiente ve el efecto', () => {
    t.calmar();
    expect(pedir().data.decisiones).toEqual([]);
    const r = post({ action: 'decidirFuenteUbicacion', sessionToken: 'tok-val@x.com', ...solicitud({ wellId: U, ...UNICA, accion: 'DESCARTAR', motivo: 'x', versionVista: 0 }) });
    expect(r.status).toBe('ok');
    t.calmar();
    expect(pedir().data.decisiones).toEqual([{ wellId: U, estado: 'N' }]);
  });
});
