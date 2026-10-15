// Servicio de decisiones sobre fuentes registrales (backend): lectura por pozo, escritura append-only bajo lock, secuencia global, idempotencia, versionVista /
// STALE_STATE, reindexado, log inconsistente, cache de lectura, privacidad y contrato de errores. Usa el dominio, el repositorio y el servicio REALES con Sheets,
// padron, cache, reloj y lock en memoria.
const fs = require('fs');
const path = require('path');
const { armar, solicitud, USUARIOS, P_REPORTE, P_IRR1, P_IRR2, P_UNICA } = require('./decisionesFuentesHelper');

let t;
let S;
const VAL = 'val@x.com';
const VERO = 'vero@x.com';
const W = '14-0001';
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };
const ACCION = { ACEPTAR: 'ACEPTAR', DESCARTAR: 'DESCARTAR', QUITAR: 'QUITAR_ACEPTACION', RESTAURAR: 'RESTAURAR' };

beforeEach(() => { t = armar(); S = t.S; });
afterEach(() => { jest.restoreAllMocks(); });

const decidirComo = (user, extra) => S.ubicacionFuenteDecisionesService_decidir(user, USUARIOS[user].nombre, solicitud(extra));
const decidir = (extra) => decidirComo(VAL, extra);
const leer = (...args) => S.ubicacionFuenteDecisionesService_getPorPozo(args.length ? args[0] : W);
const vista = (wellId) => { const r = leer(wellId === undefined ? W : wellId); expect(r.ok).toBe(true); return r.data; };
const estados = (v) => v.fuentes.map((f) => f.estado);
const porClave = (v, f) => v.fuentes.filter((x) => x.fuenteTipo === f.fuenteTipo && x.x === f.x && x.y === f.y)[0];
// aplica una accion con la version vigente del pozo
const ir = (accion, f, extra) => decidir({ wellId: W, ...f, accion: ACCION[accion] || accion, motivo: accion === 'DESCARTAR' ? 'No corresponde' : '', versionVista: vista(W).version, ...(extra || {}) });

describe('lectura vacia y vista segura', () => {
  test('sin decisiones: version 0, todas SIN_REVISAR, sin historial ni obsoletas, resolucion = automatica del padron', () => {
    const v = vista();
    expect(v).toMatchObject({ wellId: W, version: 0, integro: true, padronPeriodo: '2026-09', historial: [], obsoletas: [] });
    expect(estados(v)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(v.fuentes.map((f) => f.fuenteTipo)).toEqual(['REPORTE_POZOS', 'IRRIGACION', 'IRRIGACION']);
    expect(v.fuentes.map((f) => f.posicion)).toEqual([0, 1, 2]);
    expect(v.fuentes.every((f) => f.ultima === null && f.esAceptadaVigente === false)).toBe(true);
    expect(v.resolucion).toMatchObject({ estado: 'COINCIDENTE', regla: 'R2_AUTOMATICO', operativo: true, participantes: 3, todasDescartadas: false, cambiaRespectoDelOriginal: false });
    expect(v.fuentes.filter((f) => f.esOperativa)).toHaveLength(1);
  });

  test('pozo sin fuentes: vista vacia y SIN_COORDENADAS; pozo que no existe en el padron: WELL_NOT_FOUND', () => {
    const v = vista('03-0003');
    expect(v.fuentes).toEqual([]);
    expect(v.resolucion).toMatchObject({ estado: 'SIN_COORDENADAS', operativo: false, todasDescartadas: false });
    expect(leer('09-9999')).toMatchObject({ ok: false, code: 'WELL_NOT_FOUND' });
  });

  test('wellId invalido: INVALID_WELL_ID (nunca se consulta el padron)', () => {
    ['x', '', null, undefined, 5, '99-0001', '14-001', ['14-0001']].forEach((w) => expect(leer(w)).toMatchObject({ ok: false, code: 'INVALID_WELL_ID' }));
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('la lectura no escribe nada y no toma el lock', () => {
    vista();
    expect(t.filas()).toEqual([]);
    expect(t.locks.tomados).toBe(0);
  });
});

describe('decisiones: cada accion y su efecto (una sola fila por decision)', () => {
  test('ACEPTAR (motivo opcional): fuente ACEPTADA, vigente y operativa; la resolucion pasa a ACEPTADA', () => {
    const r = ir('ACEPTAR', REP);
    expect(r).toMatchObject({ ok: true, duplicada: false, evento: 'ACEPTADA' });
    expect(t.filas()).toHaveLength(1);
    const v = r.data;
    expect(estados(v)).toEqual(['ACEPTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(v.version).toBe(1);
    expect(v.resolucion).toMatchObject({ estado: 'ACEPTADA', regla: 'R1B_REGISTRAL_ACEPTADA', operativo: true, fuente: 'IRR_REPORTE', cambiaRespectoDelOriginal: true });     // cambia el ESTADO (C -> R), no el punto
    expect([v.resolucion.lat, v.resolucion.lon]).toEqual([v.resolucion.original.lat, v.resolucion.original.lon]);
    expect(porClave(v, REP)).toMatchObject({ esAceptadaVigente: true, esOperativa: true });
    expect(r.decision).toMatchObject({ secuencia: 1, evento: 'ACEPTADA', fuenteTipo: 'REPORTE_POZOS', nombre: 'Valeria Validadora' });
  });

  test('ACEPTAR con motivo: queda guardado', () => {
    ir('ACEPTAR', I1, { motivo: 'Coincide con el plano' });
    expect(t.fila(0).motivo).toBe('Coincide con el plano');
  });

  test('aceptar OTRA fuente: la anterior deja de ser vigente SIN una segunda fila; queda UNA sola aceptada y el historial lo dice', () => {
    ir('ACEPTAR', REP);
    const r = ir('ACEPTAR', I2);
    expect(t.filas()).toHaveLength(2);
    expect(estados(r.data)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'ACEPTADA']);
    expect(r.data.fuentes.filter((f) => f.estado === 'ACEPTADA')).toHaveLength(1);
    expect(r.data.resolucion).toMatchObject({ estado: 'ACEPTADA', fuente: 'IRR_PROVINCIA', cambiaRespectoDelOriginal: true });
    expect(r.data.historial.map((h) => [h.secuencia, h.evento])).toEqual([[1, 'ACEPTADA'], [2, 'ACEPTADA']]);
    expect(r.data.historial[0].reemplazadaPor).toMatch(/IRRIGACION/);
    expect(r.data.historial[1].reemplazaA).toMatch(/REPORTE_POZOS/);
  });

  test('QUITAR_ACEPTACION: vuelve a SIN_REVISAR (no descartada) y al resolver automatico; la fila se agrega, la anterior se conserva', () => {
    ir('ACEPTAR', I2);
    const r = ir('QUITAR', I2);
    expect(r.evento).toBe('ACEPTACION_QUITADA');
    expect(estados(r.data)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(r.data.resolucion).toMatchObject({ estado: 'COINCIDENTE', regla: 'R2_AUTOMATICO' });
    expect(t.filas().map((f) => f[t.columnas.indexOf('evento')])).toEqual(['ACEPTADA', 'ACEPTACION_QUITADA']);
  });

  test('DESCARTAR una fuente neutral (motivo obligatorio): queda DESCARTADA, visible, y sale del resolver', () => {
    const r = ir('DESCARTAR', I1, { motivo: 'Fuera del predio' });
    expect(estados(r.data)).toEqual(['SIN_REVISAR', 'DESCARTADA', 'SIN_REVISAR']);
    expect(r.data.fuentes).toHaveLength(3);                                                // sigue visible
    expect(r.data.resolucion).toMatchObject({ participantes: 2, estado: 'DISCREPANCIA', operativo: false, cambiaRespectoDelOriginal: true });
    expect(porClave(r.data, I1).ultima).toMatchObject({ evento: 'DESCARTADA', motivo: 'Fuera del predio', nombre: 'Valeria Validadora' });
  });

  test('DESCARTAR la fuente ACEPTADA en un solo paso: una sola fila, deja de ser la aceptada y queda excluida', () => {
    ir('ACEPTAR', REP);
    const r = ir('DESCARTAR', REP, { motivo: 'Era de otro pozo' });
    expect(t.filas()).toHaveLength(2);
    expect(estados(r.data)).toEqual(['DESCARTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(r.data.fuentes.filter((f) => f.esAceptadaVigente)).toHaveLength(0);
    expect(r.data.historial[1]).toMatchObject({ evento: 'DESCARTADA', descartaLaAceptada: true });
    expect(r.data.resolucion.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
  });

  test('RESTAURAR: DESCARTADA -> SIN_REVISAR (NO queda aceptada) y vuelve al resolver', () => {
    ir('DESCARTAR', I1);
    const r = ir('RESTAURAR', I1);
    expect(estados(r.data)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(r.data.resolucion).toMatchObject({ estado: 'COINCIDENTE', participantes: 3 });
  });

  test('TODAS descartadas: sin punto registral, todasDescartadas=true y las coordenadas originales siguen en la vista', () => {
    ir('DESCARTAR', REP); ir('DESCARTAR', I1);
    const r = ir('DESCARTAR', I2);
    expect(r.data.resolucion).toMatchObject({ estado: 'SIN_COORDENADAS', operativo: false, lat: null, todasDescartadas: true, participantes: 0 });
    expect(r.data.fuentes).toHaveLength(3);
    expect(r.data.fuentes.map((f) => [f.x, f.y])).toEqual([[P_REPORTE.x, P_REPORTE.y], [P_IRR1.x, P_IRR1.y], [P_IRR2.x, P_IRR2.y]]);
  });

  test('descartada -> restaurada -> aceptada es el camino para aceptar una descartada', () => {
    ir('DESCARTAR', I1); ir('RESTAURAR', I1);
    expect(ir('ACEPTAR', I1).data.resolucion.estado).toBe('ACEPTADA');
  });

  test('aceptar una DESCARTADA es INVALID_TRANSITION y no escribe', () => {
    ir('DESCARTAR', I1);
    expect(ir('ACEPTAR', I1)).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(t.filas()).toHaveLength(1);
  });

  test('ALREADY_IN_STATE: aceptar una aceptada, descartar una descartada, quitar una neutral, restaurar una neutral', () => {
    ir('ACEPTAR', REP);
    expect(ir('ACEPTAR', REP).code).toBe('ALREADY_IN_STATE');
    ir('DESCARTAR', I1);
    expect(ir('DESCARTAR', I1).code).toBe('ALREADY_IN_STATE');
    expect(ir('QUITAR', I2).code).toBe('ALREADY_IN_STATE');
    expect(ir('RESTAURAR', I2).code).toBe('ALREADY_IN_STATE');
    expect(t.filas()).toHaveLength(2);
  });

  test('INVALID_TRANSITION: restaurar una aceptada; quitar la aceptacion de una descartada', () => {
    ir('ACEPTAR', REP);
    expect(ir('RESTAURAR', REP).code).toBe('INVALID_TRANSITION');
    ir('DESCARTAR', I1);
    expect(ir('QUITAR', I1).code).toBe('INVALID_TRANSITION');
  });

  test('motivo: obligatorio SOLO al descartar; opcional al aceptar, quitar y restaurar; se recorta y no puede pasar de 300', () => {
    expect(ir('DESCARTAR', I1, { motivo: '' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(ir('DESCARTAR', I1, { motivo: '    ' }).code).toBe('INVALID_MOTIVO');
    expect(ir('DESCARTAR', I1, { motivo: undefined }).code).toBe('INVALID_MOTIVO');
    expect(ir('DESCARTAR', I1, { motivo: null }).code).toBe('INVALID_MOTIVO');
    expect(t.filas()).toHaveLength(0);
    expect(ir('ACEPTAR', REP, { motivo: '' }).ok).toBe(true);
    expect(ir('QUITAR', REP, { motivo: '' }).ok).toBe(true);
    ir('DESCARTAR', I1, { motivo: '  recortado  ' });
    expect(t.fila(2).motivo).toBe('recortado');
    expect(ir('RESTAURAR', I1, { motivo: '' }).ok).toBe(true);
    expect(ir('DESCARTAR', I1, { motivo: 'a'.repeat(300) }).ok).toBe(true);
    expect(ir('ACEPTAR', I2, { motivo: 'a'.repeat(301) }).code).toBe('INVALID_MOTIVO');
    expect(ir('ACEPTAR', I2, { motivo: 12 }).code).toBe('INVALID_MOTIVO');
    expect(ir('ACEPTAR', I2, { motivo: { a: 1 } }).code).toBe('INVALID_MOTIVO');
  });

  test('el motivo con = + - @ se guarda como texto literal (nunca formula)', () => {
    ['=HYPERLINK("http://x")', '+1', '-2', '@SUM(A1)'].forEach((m, i) => {
      ir('DESCARTAR', REP, { motivo: m });
      expect(t.fila(i * 2).motivo).toBe(m);
      ir('RESTAURAR', REP);
    });
    expect(t.hojas.UbicacionFuenteDecisiones.formatos['2:' + (t.columnas.indexOf('motivo') + 1)]).toBe('@');
  });

  test('una fuente (tipo + x + y) que no esta en el padron actual: SOURCE_NOT_FOUND; nada se escribe', () => {
    expect(decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 2 })).toMatchObject({ ok: false, code: 'SOURCE_NOT_FOUND' });
    expect(decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: P_REPORTE.x, y: P_REPORTE.y })).toMatchObject({ code: 'SOURCE_NOT_FOUND' });      // la coordenada del Reporte, como Irrigacion
    expect(decidir({ wellId: '01-0012', ...REP })).toMatchObject({ code: 'SOURCE_NOT_FOUND' });                                                  // coordenada de OTRO pozo
    expect(t.filas()).toEqual([]);
  });

  test('pozo inexistente en el padron: WELL_NOT_FOUND', () => {
    expect(decidir({ wellId: '09-9999', ...REP })).toMatchObject({ ok: false, code: 'WELL_NOT_FOUND' });
  });
});

describe('identidad de la fuente: precision de x/y', () => {
  test('el ruido de formato (1e-9) o medio milimetro NO cambia la fuente; un milimetro SI es otra', () => {
    expect(decidir({ wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x + 1e-9, y: P_REPORTE.y - 1e-9, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(t.fila(0).x).toBe(P_REPORTE.x);                                          // se guarda el snapshot NORMALIZADO, no el valor del cliente
    expect(decidir({ wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x + 0.001, y: P_REPORTE.y, accion: 'DESCARTAR', motivo: 'x', versionVista: 1 }).code).toBe('SOURCE_NOT_FOUND');
  });

  test('x/y como texto numerico simple se aceptan; otro formato no', () => {
    expect(decidir({ wellId: W, fuenteTipo: 'REPORTE_POZOS', x: String(P_REPORTE.x), y: ' ' + P_REPORTE.y + ' ', accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(decidir({ wellId: W, ...I1, x: '2.486464782e6', accion: 'ACEPTAR', versionVista: 1 }).code).toBe('INVALID_FUENTE');
  });

  test('dos filas IDENTICAS del padron (mismo tipo, x, y) son UNA fuente logica: una decision las afecta a las dos', () => {
    t.padron['14-0997'] = { coordenadas: null, coordenadasProvincia: [{ x: 2476432, y: 6302410 }, { x: 2476432, y: 6302410 }] };
    expect(vista('14-0997').resolucion).toMatchObject({ estado: 'COINCIDENTE', participantes: 2 });       // el artefacto del padron (corrobora a 0 m)
    const r = decidir({ wellId: '14-0997', fuenteTipo: 'IRRIGACION', x: 2476432, y: 6302410, accion: 'DESCARTAR', motivo: 'Fila repetida', versionVista: 0 });
    expect(t.filas()).toHaveLength(1);
    expect(r.data.fuentes.map((f) => f.estado)).toEqual(['DESCARTADA', 'DESCARTADA']);
    expect(r.data.resolucion).toMatchObject({ estado: 'SIN_COORDENADAS', todasDescartadas: true });
  });

  test('Reporte e Irrigacion en la misma coordenada son fuentes distintas', () => {
    t.padron['14-0998'] = { coordenadas: { x: 2490000, y: 6300000 }, coordenadasProvincia: [{ x: 2490000, y: 6300000 }] };
    decidir({ wellId: '14-0998', fuenteTipo: 'IRRIGACION', x: 2490000, y: 6300000, accion: 'DESCARTAR', motivo: 'x', versionVista: 0 });
    expect(vista('14-0998').fuentes.map((f) => [f.fuenteTipo, f.estado])).toEqual([['REPORTE_POZOS', 'SIN_REVISAR'], ['IRRIGACION', 'DESCARTADA']]);
  });
});

describe('secuencia global, timestamp y orden', () => {
  test('la secuencia es max + 1, global entre pozos, nunca se repite y no depende de la fecha', () => {
    ir('ACEPTAR', REP);                                                              // 1 (14-0001)
    decidir({ wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y, accion: 'ACEPTAR', versionVista: 0 });      // 2 (01-0012)
    ir('DESCARTAR', I1);                                                             // 3 (14-0001)
    expect(t.filas().map((f) => f[t.columnas.indexOf('secuencia')])).toEqual([1, 2, 3]);
    expect(new Set(t.filas().map((f) => f[t.columnas.indexOf('secuencia')])).size).toBe(3);
  });

  test('versionVista es la secuencia maxima DEL POZO: una escritura en otro pozo no la cambia', () => {
    ir('ACEPTAR', REP);
    decidir({ wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y, accion: 'ACEPTAR', versionVista: 0 });
    expect(vista(W).version).toBe(1);
    expect(vista('01-0012').version).toBe(2);
    expect(ir('DESCARTAR', I1).data.version).toBe(3);
    expect(vista('01-0012').version).toBe(2);
  });

  test('continua desde la secuencia maxima aunque haya huecos o filas fuera de orden en la hoja', () => {
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'a', secuencia: 40, wellId: '09-0001', fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1, evento: 'ACEPTADA' }[c] || '')));
    expect(ir('ACEPTAR', REP).decision.secuencia).toBe(41);
  });

  test('timestampUtc: ISO UTC con milisegundos y Z, guardado como texto', () => {
    ir('ACEPTAR', REP);
    expect(t.fila(0).timestampUtc).toBe('2026-10-14T14:32:10.123Z');
    expect(typeof t.fila(0).timestampUtc).toBe('string');
  });

  test('TIMESTAMPS IGUALES: varios eventos del mismo instante se ordenan por secuencia (no se pierde ni se invierte nada)', () => {
    ir('ACEPTAR', REP); ir('ACEPTAR', I1); ir('DESCARTAR', I2);
    expect(new Set(t.filas().map((f) => f[t.columnas.indexOf('timestampUtc')])).size).toBe(1);
    const v = vista();
    expect(estados(v)).toEqual(['SIN_REVISAR', 'ACEPTADA', 'DESCARTADA']);
    expect(v.historial.map((h) => h.secuencia)).toEqual([1, 2, 3]);
  });

  test('FECHAS EN DESORDEN: un evento de mayor secuencia con fecha anterior sigue siendo el mas nuevo', () => {
    ir('ACEPTAR', REP);
    t.reloj -= 7 * 24 * 3600 * 1000;                                                // el reloj "vuelve" una semana
    ir('ACEPTAR', I1);
    expect(t.fila(1).timestampUtc < t.fila(0).timestampUtc).toBe(true);
    expect(estados(vista())).toEqual(['SIN_REVISAR', 'ACEPTADA', 'SIN_REVISAR']);
  });

  test('el orden FISICO de las filas en la hoja no importa: las ordena la secuencia', () => {
    ir('ACEPTAR', REP); ir('DESCARTAR', I2); ir('ACEPTAR', I1);
    const esperado = JSON.stringify(vista());
    const h = t.hojas.UbicacionFuenteDecisiones;
    const datos = h.filas.slice(1).reverse();
    h.filas.length = 1;
    datos.forEach((f) => h.filas.push(f));
    t.cache.store = {};
    Object.keys(t.cache.store).forEach((k) => delete t.cache.store[k]);
    expect(JSON.stringify(vista())).toBe(esperado);
  });
});

describe('versionVista y STALE_STATE', () => {
  test('una version vieja es STALE_STATE (con la version actual) y NO escribe', () => {
    ir('ACEPTAR', REP);
    const r = decidir({ wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 0 });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    expect(t.filas()).toHaveLength(1);
    expect(decidir({ wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 9 }).code).toBe('STALE_STATE');      // tambien una version del futuro
  });

  test('con la version correcta la decision entra', () => {
    ir('ACEPTAR', REP);
    expect(decidir({ wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 1 }).ok).toBe(true);
  });

  test('versionVista obligatoria, entera y >= 0: si no, INVALID_VERSION', () => {
    [undefined, null, '1', -1, 1.5, NaN, Infinity, {}, []].forEach((v) => expect(decidir({ versionVista: v })).toMatchObject({ ok: false, code: 'INVALID_VERSION' }));
    expect(t.filas()).toEqual([]);
  });

  test('DOS VALIDADORES aceptan fuentes distintas casi a la vez: gana el primero, el segundo recibe STALE_STATE y no pisa nada', () => {
    const a = decidirComo(VAL, { ...REP, accion: 'ACEPTAR', versionVista: 0 });
    const b = decidirComo(VERO, { ...I1, accion: 'ACEPTAR', versionVista: 0 });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    expect(estados(vista())).toEqual(['ACEPTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(t.filas()).toHaveLength(1);
  });

  test('ACEPTAR y DESCARTAR la misma fuente simultaneamente: el segundo es STALE_STATE', () => {
    expect(decidirComo(VAL, { ...I1, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(decidirComo(VERO, { ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 0 }).code).toBe('STALE_STATE');
    expect(estados(vista())[1]).toBe('ACEPTADA');
  });

  test('RESTAURAR mientras otro ACEPTA otra fuente: el que restaura (con la version vieja) recibe STALE_STATE', () => {
    ir('DESCARTAR', I1);
    const verAntes = vista().version;
    expect(decidirComo(VERO, { ...REP, accion: 'ACEPTAR', versionVista: verAntes }).ok).toBe(true);
    expect(decidirComo(VAL, { ...I1, accion: 'RESTAURAR', versionVista: verAntes }).code).toBe('STALE_STATE');
    expect(estados(vista())[1]).toBe('DESCARTADA');
  });

  test('la MISMA accion de dos usuarios con la misma version: el segundo es STALE_STATE (la version se mira antes que la transicion)', () => {
    expect(decidirComo(VAL, { ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-aaaaaaaa' }).ok).toBe(true);
    expect(decidirComo(VERO, { ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-bbbbbbbb' }).code).toBe('STALE_STATE');
  });

  test('CONCURRENCIA SIMULADA: otro validador escribe justo ENTRE el pedido y la lectura bajo lock; se relee dentro del lock y se detecta', () => {
    const v0 = vista().version;
    t.alTomarLock = () => { expect(decidirComo(VERO, { ...REP, accion: 'ACEPTAR', versionVista: v0 }).ok).toBe(true); };
    const r = decidirComo(VAL, { ...I1, accion: 'ACEPTAR', versionVista: v0 });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    expect(t.filas()).toHaveLength(1);
    expect(estados(vista())).toEqual(['ACEPTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
  });

  test('la lectura, la decision y la escritura van en UN lock que siempre se libera (tambien ante un rechazo)', () => {
    ir('ACEPTAR', REP);
    expect(t.locks).toEqual({ tomados: 1, liberados: 1 });
    decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 });                   // STALE
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });

  test('si no se puede tomar el lock, la operacion falla sin escribir', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('Lock timeout'); }, releaseLock: () => {} }) };
    expect(() => decidir()).toThrow();
    expect(t.filas()).toEqual([]);
  });
});

describe('idempotencia (clientRequestId unico por usuario)', () => {
  test('el MISMO pedido repetido devuelve la decision original, duplicada:true y NO agrega otra fila', () => {
    const p = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-001' };
    const a = decidirComo(VAL, p);
    t.calmar();
    const b = decidirComo(VAL, p);
    expect(a.duplicada).toBe(false);
    expect(b).toMatchObject({ ok: true, duplicada: true });
    expect(b.decision).toEqual(a.decision);
    expect(t.filas()).toHaveLength(1);
  });

  test('un reintento llega aunque la version ya avanzo con esa misma escritura (no es STALE) y aunque cambiaron otras cosas', () => {
    const p = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-002' };
    decidirComo(VAL, p);
    ir('DESCARTAR', I2);                                                             // la version del pozo avanzo mas
    expect(decidirComo(VAL, p)).toMatchObject({ ok: true, duplicada: true });
    expect(t.filas()).toHaveLength(2);
  });

  test('un reintento tras un reindexado que quito esa fuente tambien devuelve la decision original', () => {
    const p = { wellId: W, ...I2, accion: 'DESCARTAR', motivo: 'x', versionVista: 0, clientRequestId: 'req-idem-003' };
    decidirComo(VAL, p);
    t.padron[W].coordenadasProvincia = [P_IRR1];
    expect(decidirComo(VAL, p)).toMatchObject({ ok: true, duplicada: true });
  });

  test('un reintento se atiende ANTES de mirar el padron: aunque el pozo ya no figure (o el padron falle), devuelve la decision original', () => {
    const p = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-006' };
    const a = decidirComo(VAL, p);
    delete t.padron[W];
    const b = decidirComo(VAL, p);
    expect(b).toMatchObject({ ok: true, duplicada: true });
    expect(b.decision).toEqual(a.decision);
    expect(b.data).toBeNull();                                                      // sin padron no hay vista que armar, pero la decision original esta
    expect(t.filas()).toHaveLength(1);
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('Drive caido'); });
    const c = decidirComo(VAL, p);
    expect(c).toMatchObject({ ok: true, duplicada: true, data: null });
    expect(c.decision).toEqual(a.decision);
  });

  test('versionVista queda guardada tal cual la mando el cliente, y el reintento solo coincide con ESA version', () => {
    ir('ACEPTAR', REP);
    const p = { wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 1, clientRequestId: 'req-idem-007' };
    expect(decidirComo(VAL, p).ok).toBe(true);
    expect([t.fila(0).versionVista, t.fila(1).versionVista]).toEqual([0, 1]);
    expect(decidirComo(VAL, p).duplicada).toBe(true);
    expect(decidirComo(VAL, { ...p, versionVista: 0 })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(decidirComo(VAL, { ...p, versionVista: 2 })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('el reintento NO depende del timestamp ni del reloj', () => {
    const p = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-004' };
    decidirComo(VAL, p);
    t.reloj += 365 * 24 * 3600 * 1000;
    expect(decidirComo(VAL, p).duplicada).toBe(true);
    t.reloj -= 2 * 365 * 24 * 3600 * 1000;
    expect(decidirComo(VAL, p).duplicada).toBe(true);
  });

  test('mismo clientRequestId con OTRO contenido: IDEMPOTENCY_CONFLICT (fail-closed) y no escribe', () => {
    const base = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-idem-005' };
    decidirComo(VAL, base);
    [{ accion: 'DESCARTAR', motivo: 'x' }, { ...I1 }, { motivo: 'otro motivo' }, { versionVista: 1 }, { wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y }].forEach((cambio) => {
      expect(decidirComo(VAL, { ...base, ...cambio })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    });
    expect(t.filas()).toHaveLength(1);
  });

  test('el clientRequestId es POR USUARIO: otro usuario puede usar el mismo valor sin chocar', () => {
    const id = 'req-compartido';
    expect(decidirComo(VAL, { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: id }).ok).toBe(true);
    expect(decidirComo(VERO, { wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y, accion: 'ACEPTAR', versionVista: 0, clientRequestId: id })).toMatchObject({ ok: true, duplicada: false });
    expect(t.filas()).toHaveLength(2);
  });

  test('una solicitud RECHAZADA (p. ej. STALE) no consume el clientRequestId: se puede reintentar con datos nuevos', () => {
    ir('ACEPTAR', REP);
    const id = 'req-reintento-1';
    expect(decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0, clientRequestId: id }).code).toBe('STALE_STATE');
    expect(decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1, clientRequestId: id }).ok).toBe(true);
  });

  test('clientRequestId invalido: INVALID_CLIENT_REQUEST_ID (corto, largo, enorme, caracteres raros, no texto)', () => {
    ['', 'corto', 'a'.repeat(65), 'a'.repeat(100000), 'tiene espacio 1', 'con/barra_123', '=cmd|calc', undefined, null, 12345678, {}].forEach((id) => {
      expect(decidir({ clientRequestId: id })).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' });
    });
    expect(decidir({ clientRequestId: 'a'.repeat(64) }).ok).toBe(true);
    expect(t.filas()).toHaveLength(1);
  });
});

describe('reindexado: decisiones obsoletas y fuentes nuevas', () => {
  const MOVIDA = { x: P_IRR2.x + 25.5, y: P_IRR2.y - 10.25 };

  test('una fuente DESCARTADA cuya coordenada cambia: la vieja queda como obsoleta (historial), la nueva nace SIN_REVISAR y participa', () => {
    ir('DESCARTAR', I2, { motivo: 'Fuera del predio' });
    t.padron[W].coordenadasProvincia = [P_IRR1, MOVIDA];
    t.cache.store = {};
    const v = vista();
    expect(v.fuentes.map((f) => f.estado)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);
    expect(v.obsoletas).toHaveLength(1);
    expect(v.obsoletas[0]).toMatchObject({ fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y, estado: 'DESCARTADA' });
    expect(v.historial[0]).toMatchObject({ evento: 'DESCARTADA', obsoleta: true });
    expect(v.resolucion.participantes).toBe(3);
    expect(v.version).toBe(1);                                                      // el historial se conserva y la version no se pierde
  });

  test('una fuente ACEPTADA cuya coordenada cambia: ya no es la vigente y no se aplica; vuelve el automatico', () => {
    ir('ACEPTAR', I1);
    t.padron[W].coordenadasProvincia = [{ x: P_IRR1.x + 40, y: P_IRR1.y }, P_IRR2];
    t.cache.store = {};
    const v = vista();
    expect(v.fuentes.filter((f) => f.esAceptadaVigente)).toEqual([]);
    expect(v.obsoletas[0]).toMatchObject({ estado: 'ACEPTADA' });
    expect(v.resolucion.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
  });

  test('NO se opera sobre la coordenada vieja (SOURCE_NOT_FOUND) y la nueva se puede aceptar: la vieja queda como reemplazada', () => {
    ir('ACEPTAR', I1);
    const nueva = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x + 40, y: P_IRR1.y };
    t.padron[W].coordenadasProvincia = [{ x: nueva.x, y: nueva.y }, P_IRR2];
    expect(decidir({ wellId: W, ...I1, accion: 'QUITAR_ACEPTACION', versionVista: 1 }).code).toBe('SOURCE_NOT_FOUND');
    const r = decidir({ wellId: W, ...nueva, accion: 'ACEPTAR', versionVista: 1 });
    expect(r.ok).toBe(true);
    expect(r.data.fuentes.filter((f) => f.estado === 'ACEPTADA').map((f) => f.x)).toEqual([nueva.x]);
    expect(r.data.historial[0].reemplazadaPor).toMatch(/IRRIGACION/);
  });

  test('una decision no se hereda a otro tipo de fuente con la misma coordenada', () => {
    ir('DESCARTAR', I1);
    t.padron[W] = { coordenadas: { x: P_IRR1.x, y: P_IRR1.y }, coordenadasProvincia: [] };
    t.cache.store = {};
    expect(vista().fuentes[0]).toMatchObject({ fuenteTipo: 'REPORTE_POZOS', estado: 'SIN_REVISAR' });
  });

  test('cambiar el orden de las fuentes de Irrigacion no afecta las decisiones', () => {
    ir('DESCARTAR', I2);
    t.padron[W].coordenadasProvincia = [P_IRR2, P_IRR1];
    t.cache.store = {};
    expect(porClave(vista(), I2).estado).toBe('DESCARTADA');
    expect(porClave(vista(), I1).estado).toBe('SIN_REVISAR');
  });

  test('se guarda el periodo del padron con el que se decidio', () => {
    ir('ACEPTAR', REP);
    t.metadata.periodo = '2026-10';
    ir('DESCARTAR', I1);
    expect([t.fila(0).padronPeriodo, t.fila(1).padronPeriodo]).toEqual(['2026-09', '2026-10']);
  });

  test('si el padron no informa periodo, queda vacio (no rompe)', () => {
    global.registryService_getMetadata = jest.fn(() => { throw new Error('sin metadata'); });
    expect(ir('ACEPTAR', REP).ok).toBe(true);
    expect(t.fila(0).padronPeriodo).toBe('');
  });
});

describe('log inconsistente: nada del pozo aplica, no se aceptan decisiones nuevas, el diagnostico es solo tecnico', () => {
  const fila = (extra) => t.columnas.map((c) => ({ decisionId: 'd-' + Math.random(), secuencia: 1, wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: 'ACEPTADA', motivo: '', email: 'x@x.com', nombre: 'X', timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'req-corrupto', versionVista: 0, padronPeriodo: '2026-09', ...(extra || {}) }[c]));
  const corromper = (...filas) => { filas.forEach((f) => t.hojas.UbicacionFuenteDecisiones.filas.push(f)); t.cache.store = {}; };

  test.each([
    ['restaurar sin descartar', () => [fila({ evento: 'RESTAURADA' })]],
    ['secuencia repetida', () => [fila({ secuencia: 4 }), fila({ secuencia: 4, fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y })]],
    ['evento desconocido (SUPERADA no existe)', () => [fila({ evento: 'SUPERADA' })]],
    ['descarte sin motivo', () => [fila({ evento: 'DESCARTADA', motivo: '' })]],
    ['secuencia que no es numero', () => [fila({ secuencia: 'abc' })]],
    ['coordenada rota', () => [fila({ x: 'roto' })]],
    ['tipo de fuente desconocido', () => [fila({ fuenteTipo: 'OTRA' })]]
  ])('%s', (nombre, armarFilas) => {
    corromper(...armarFilas());
    const r = leer();
    expect(r.ok).toBe(true);
    const v = r.data;
    expect(v.integro).toBe(false);
    expect(estados(v)).toEqual(['SIN_REVISAR', 'SIN_REVISAR', 'SIN_REVISAR']);          // nada aplica
    expect(v.historial).toEqual([]);
    expect(v.fuentes.filter((f) => f.esAceptadaVigente)).toEqual([]);
    expect(v.resolucion).toMatchObject({ participantes: 3, regla: expect.not.stringMatching(/R1B/) });
    expect(JSON.stringify(v)).not.toMatch(/TRANSICION_INVALIDA|SECUENCIA_|EVENTO_|anomalia/i);           // el diagnostico tecnico no sale al usuario
    expect(global.Logger.log.mock.calls.some((c) => /INCONSISTENTE/.test(String(c[0])))).toBe(true);        // pero queda en el log
    const filasAntes = t.filas().length;
    expect(decidir({ wellId: W, ...I2, accion: 'DESCARTAR', motivo: 'x', versionVista: v.version })).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    expect(t.filas()).toHaveLength(filasAntes);                                                              // no intenta "arreglar" nada
  });

  test('un solo evento malo invalida TODAS las decisiones del pozo (aunque las demas esten bien) pero NO las de otros pozos', () => {
    ir('ACEPTAR', REP);
    decidir({ wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y, accion: 'ACEPTAR', versionVista: 0 });
    corromper(fila({ secuencia: 99, evento: 'RESTAURADA', fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y }));
    expect(vista(W).integro).toBe(false);
    expect(vista(W).resolucion.regla).not.toBe('R1B_REGISTRAL_ACEPTADA');
    expect(vista('01-0012').integro).toBe(true);
    expect(vista('01-0012').fuentes[0].estado).toBe('ACEPTADA');
  });

  test('no hay autocurado: aunque se reintente, el pozo sigue inconsistente y la hoja intacta', () => {
    corromper(fila({ evento: 'RESTAURADA' }));
    const antes = JSON.stringify(t.filas());
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(JSON.stringify(t.filas())).toBe(antes);
  });

  test('las filas que no se pueden atribuir a un pozo valido NO bloquean a los demas y aparecen en el diagnostico manual', () => {
    corromper(fila({ wellId: 'zz' }), fila({ wellId: '' }));
    expect(vista(W).integro).toBe(true);
    const d = S.ubicacionFuenteDecisionesService_diagnosticar();
    expect(d.filasSinPozo).toBe(2);
  });

  test('diagnostico manual: por pozo con decisiones, solo codigos tecnicos (sin emails), y obsoletas', () => {
    ir('ACEPTAR', I2);
    corromper(fila({ wellId: '01-0012', secuencia: 50, evento: 'RESTAURADA', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y }));
    t.padron[W].coordenadasProvincia = [P_IRR1];
    const d = S.ubicacionFuenteDecisionesService_diagnosticar();
    expect(d.pozos).toEqual([
      { wellId: '01-0012', filas: 1, integro: false, padronEncontrado: true, anomalias: ['TRANSICION_INVALIDA_EN_LOG#50'], obsoletas: 0 },
      { wellId: W, filas: 1, integro: true, padronEncontrado: true, anomalias: [], obsoletas: 1 }
    ]);
    expect(JSON.stringify(d)).not.toMatch(/@/);
  });
});

describe('cache de lectura (120 s) e invalidacion', () => {
  test('la segunda lectura sale del cache: ni padron ni hoja (sin N+1); TTL 120 s; clave por pozo', () => {
    vista();
    const reg = global.registryService_getWellLocation.mock.calls.length;
    const lecturas = jest.spyOn(t.Repo, 'ubicacionFuenteDecisionesRepository_listar');
    vista();
    vista();
    expect(global.registryService_getWellLocation.mock.calls.length).toBe(reg);
    expect(t.cache.ttl['ufd_vista_v1_' + W]).toBe(120);
    expect(Object.keys(t.cache.store)).toEqual(['ufd_vista_v1_' + W]);
    expect(lecturas).not.toHaveBeenCalled();
  });

  test('un calculo completo hace UNA lectura del padron y UNA de la hoja', () => {
    const listar = jest.fn(t.Repo.ubicacionFuenteDecisionesRepository_listar);
    global.ubicacionFuenteDecisionesRepository_listar = listar;
    vista();
    expect(global.registryService_getWellLocation).toHaveBeenCalledTimes(1);
    expect(listar).toHaveBeenCalledTimes(1);
  });

  test('despues de una escritura el cache de ESE pozo se invalida y la lectura siguiente ve el estado nuevo', () => {
    vista();
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeDefined();
    ir('ACEPTAR', REP);
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeUndefined();
    expect(t.cache.store['ufd_vista_v1_inval']).toBeDefined();
    expect(vista().version).toBe(1);
    expect(estados(vista())).toEqual(['ACEPTADA', 'SIN_REVISAR', 'SIN_REVISAR']);
  });

  test('escribir en un pozo no borra el cache de otro', () => {
    vista('01-0012');
    t.calmar();
    ir('ACEPTAR', REP);
    expect(t.cache.store['ufd_vista_v1_01-0012']).toBeDefined();
  });

  test('una escritura RECHAZADA (stale, transicion, error) no invalida nada', () => {
    ir('ACEPTAR', REP);
    t.calmar();
    vista();
    const antes = t.cache.remove.mock.calls.length;
    decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 });
    expect(t.cache.remove.mock.calls.length).toBe(antes);
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeDefined();
  });

  test('el duplicado idempotente tampoco invalida', () => {
    const p = { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-cache-01' };
    decidirComo(VAL, p);
    t.calmar();
    vista();
    const antes = t.cache.remove.mock.calls.length;
    decidirComo(VAL, p);
    expect(t.cache.remove.mock.calls.length).toBe(antes);
  });

  test('si se invalido durante el calculo (marca reciente), el resultado viejo NO se guarda', () => {
    t.cache.store['ufd_vista_v1_inval'] = String(t.reloj);
    expect(vista().version).toBe(0);
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeUndefined();
    t.calmar();
    vista();
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeDefined();
  });

  test('un cache viejo no se usa para decidir: la escritura siempre relee la hoja', () => {
    vista();                                                                         // cachea version 0
    t.cache.store['ufd_vista_v1_' + W] = JSON.stringify({ ...vista(), version: 77 });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
  });

  test('cache roto o con otro pozo: se ignora y se recalcula', () => {
    t.cache.store['ufd_vista_v1_' + W] = '{no es json';
    expect(vista().version).toBe(0);
    t.cache.store['ufd_vista_v1_' + W] = JSON.stringify({ wellId: '01-0012', fuentes: [] });
    expect(vista().wellId).toBe(W);
  });

  test('si CacheService falla (leer, guardar, invalidar) NUNCA se rompe la operacion', () => {
    t.cache.falla = { get: true, put: true, remove: true };
    expect(vista().version).toBe(0);
    expect(ir('ACEPTAR', REP).ok).toBe(true);
    expect(vista().version).toBe(1);
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    expect(ir('DESCARTAR', I1).ok).toBe(true);
  });

  test('una vista demasiado grande (> 90.000 caracteres) no se cachea pero se devuelve igual', () => {
    const h = t.hojas.UbicacionFuenteDecisiones;
    let seq = 0;
    for (let i = 0; i < 400; i += 1) {
      seq += 1;
      const obj = { decisionId: 'd' + seq, secuencia: seq, wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: i % 2 === 0 ? 'DESCARTADA' : 'RESTAURADA', motivo: i % 2 === 0 ? 'm'.repeat(250) : '', email: 'x@x.com', nombre: 'N'.repeat(60), timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'req-' + seq, versionVista: seq - 1, padronPeriodo: '2026-09' };
      h.filas.push(t.columnas.map((c) => obj[c]));
    }
    const r = leer();
    expect(r.ok).toBe(true);
    expect(r.data.integro).toBe(true);
    expect(r.data.historial).toHaveLength(400);
    expect(JSON.stringify(r.data).length).toBeGreaterThan(90000);
    expect(t.cache.store['ufd_vista_v1_' + W]).toBeUndefined();
  });

  test('lo que se cachea no tiene emails ni datos del solicitante', () => {
    ir('ACEPTAR', REP);
    t.calmar();
    vista();
    const guardado = t.cache.store['ufd_vista_v1_' + W];
    expect(guardado).toBeDefined();
    expect(guardado).not.toMatch(/@/);
  });
});

describe('privacidad de la vista y de la respuesta', () => {
  test('ni emails, ni ids internos, ni anomalias tecnicas, ni claves de cache: solo nombres, fechas, motivos y coordenadas', () => {
    const r = ir('DESCARTAR', I1, { motivo: 'Fuera del predio' });
    ir('ACEPTAR', REP);
    const texto = JSON.stringify([r, vista()]);
    expect(texto).not.toMatch(/@x\.com|val@|decisionId|email|anomalias|clientRequestId|versionVista"/);
    expect(texto).toContain('Valeria Validadora');                                  // el nombre si (mismo patron que las correcciones)
    expect(texto).toContain('Fuera del predio');
  });

  test('claves de la vista: solo las documentadas', () => {
    ir('ACEPTAR', REP);
    const v = vista();
    expect(Object.keys(v).sort()).toEqual(['fuentes', 'historial', 'integro', 'obsoletas', 'padronPeriodo', 'resolucion', 'version', 'wellId']);
    expect(Object.keys(v.fuentes[0]).sort()).toEqual(['clave', 'esAceptadaVigente', 'esOperativa', 'estado', 'fuenteTipo', 'lat', 'lon', 'posicion', 'ultima', 'x', 'y']);
    expect(Object.keys(v.historial[0]).sort()).toEqual(['descartaLaAceptada', 'evento', 'fuenteTipo', 'motivo', 'nombre', 'obsoleta', 'quitaAceptacion', 'reemplazaA', 'reemplazadaPor', 'secuencia', 'timestampUtc', 'x', 'y']);
    expect(Object.keys(v.resolucion).sort()).toEqual(['automatico', 'cambiaRespectoDelOriginal', 'estado', 'fuente', 'fuenteClave', 'lat', 'lon', 'nivel', 'operativo', 'original', 'participantes', 'regla', 'todasDescartadas']);
  });

  test('la decision devuelta no trae el email de quien decidio', () => {
    const r = decidirComo(VERO, solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }));
    expect(Object.keys(r.decision).sort()).toEqual(['evento', 'fuenteTipo', 'motivo', 'nombre', 'secuencia', 'timestampUtc', 'x', 'y']);
    expect(r.decision.nombre).toBe('Vero Validadora');
  });

  test('en la hoja SI queda el email normalizado y el nombre (auditoria interna)', () => {
    decidirComo('VAL@X.com'.toLowerCase(), solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }));
    expect(t.fila(0)).toMatchObject({ email: 'val@x.com', nombre: 'Valeria Validadora', versionVista: 0, padronPeriodo: '2026-09' });
    expect(t.fila(0).decisionId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('payload manipulado (el backend es la autoridad)', () => {
  test('accion invalida o heredada de Object.prototype: INVALID_ACCION', () => {
    ['', 'aceptar', 'QUITAR', 'SUPERAR', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 5, null, undefined, {}].forEach((a) => {
      expect(decidir({ accion: a })).toMatchObject({ ok: false, code: 'INVALID_ACCION' });
    });
    expect(t.filas()).toEqual([]);
  });

  test('fuenteTipo / x / y invalidos: INVALID_FUENTE (incluye NaN, infinito, vacios y tipos heredados)', () => {
    [{ fuenteTipo: 'constructor' }, { fuenteTipo: '__proto__' }, { fuenteTipo: 'REPORTE_POZOS ' }, { fuenteTipo: 'reporte_pozos' }, { fuenteTipo: null }, { fuenteTipo: 5 },
      { x: NaN }, { x: Infinity }, { y: -Infinity }, { x: 'abc' }, { y: '' }, { x: null }, { y: undefined }, { x: {} }, { x: [1] }, { x: '1e5' }, { x: true }].forEach((extra) => {
      expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, ...extra })).toMatchObject({ ok: false, code: 'INVALID_FUENTE' });
    });
  });

  test('wellId alterado: formato invalido, de otro departamento o de otro pozo', () => {
    ['', 'x', '14-001', '99-0001', '00-0001', 'constructor', '__proto__', '14-0001; DROP', null, 5, ['14-0001'], { a: 1 }].forEach((w) => {
      expect(decidir({ wellId: w })).toMatchObject({ ok: false, code: 'INVALID_WELL_ID' });
    });
    expect(decidir({ wellId: '01-0012', ...REP })).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });

  test('una coordenada de una fuente de OTRO pozo no se puede usar (x/y alterados): SOURCE_NOT_FOUND', () => {
    expect(decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y })).toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  });

  test('campos extra e identidad falsa se ignoran: el servicio solo lee los campos conocidos y la identidad sale de los argumentos de sesion', () => {
    const r = S.ubicacionFuenteDecisionesService_decidir(VAL, 'Valeria Validadora', { ...solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }), email: 'otro@x.com', nombre: 'Falso', secuencia: 999, decisionId: 'x', timestampUtc: '1999-01-01', estado: 'DESCARTADA', evento: 'DESCARTADA' });
    expect(r.ok).toBe(true);
    expect(t.fila(0)).toMatchObject({ email: 'val@x.com', nombre: 'Valeria Validadora', secuencia: 1, evento: 'ACEPTADA' });
    expect(t.fila(0).decisionId).not.toBe('x');
    expect(t.fila(0).timestampUtc).toBe('2026-10-14T14:32:10.123Z');
  });

  test('__proto__ dentro del JSON no contamina nada ni se lee como campo', () => {
    const base = JSON.stringify(solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }));
    const manipulado = JSON.parse(base.slice(0, -1) + ',"__proto__":{"accion":"DESCARTAR","polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    const r = S.ubicacionFuenteDecisionesService_decidir(VAL, 'Valeria', manipulado);
    expect(r.ok).toBe(true);
    expect(t.fila(0).evento).toBe('ACEPTADA');
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
    expect(S.ubicacionFuenteDecisionesService_decidir(VAL, 'V', JSON.parse('{"__proto__":{"wellId":"14-0001"}}'))).toMatchObject({ code: 'INVALID_WELL_ID' });
  });

  test('solicitud que no es un objeto: INVALID_WELL_ID (nada se escribe, nada lanza)', () => {
    [null, undefined, 'texto', 5, []].forEach((s) => expect(S.ubicacionFuenteDecisionesService_decidir(VAL, 'V', s)).toMatchObject({ ok: false, code: 'INVALID_WELL_ID' }));
  });

  test('un motivo enorme se rechaza (no se trunca)', () => {
    expect(decidir({ accion: 'DESCARTAR', motivo: 'a'.repeat(100000) })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(t.filas()).toEqual([]);
  });

  test('la fuente y el estado no los decide el cliente: ni el tipo ni la coordenada guardados salen de otro lugar que del padron actual', () => {
    decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: P_IRR1.x + 0.0004, y: P_IRR1.y, accion: 'ACEPTAR', versionVista: 0 });
    expect(t.fila(0)).toMatchObject({ fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y });
  });
});

describe('contrato de errores (codigos estables, sin detalles internos)', () => {
  const codigoDe = (r) => r.code;

  test('los codigos del contrato', () => {
    ir('ACEPTAR', REP);
    ir('DESCARTAR', I1);
    const casos = {
      SOURCE_NOT_FOUND: decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 1 }),
      STALE_STATE: decidir({ wellId: W, ...I2, accion: 'ACEPTAR', versionVista: 0 }),
      INVALID_TRANSITION: decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 2 }),
      ALREADY_IN_STATE: decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 2 }),
      INVALID_MOTIVO: decidir({ wellId: W, ...I2, accion: 'DESCARTAR', versionVista: 2 }),
      INVALID_CLIENT_REQUEST_ID: decidir({ clientRequestId: 'x' }),
      INVALID_ACCION: decidir({ accion: 'X' }),
      INVALID_FUENTE: decidir({ x: NaN }),
      INVALID_VERSION: decidir({ versionVista: -1 }),
      INVALID_WELL_ID: decidir({ wellId: 'x' }),
      WELL_NOT_FOUND: decidir({ wellId: '09-9999' })
    };
    Object.keys(casos).forEach((k) => { expect(codigoDe(casos[k])).toBe(k); expect(casos[k].ok).toBe(false); expect(typeof casos[k].message).toBe('string'); });
    const p = { wellId: W, ...REP, accion: 'DESCARTAR', motivo: 'x', versionVista: 2, clientRequestId: 'req-conf-001' };
    decidirComo(VAL, p);
    expect(codigoDe(decidirComo(VAL, { ...p, motivo: 'otro' }))).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('INCONSISTENT_STATE', () => {
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'a', secuencia: 1, wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: 'RESTAURADA' }[c] || '')));
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 1 }).code).toBe('INCONSISTENT_STATE');
  });

  test('los mensajes no filtran detalles internos (ids, hojas, stack, emails)', () => {
    ir('ACEPTAR', REP);
    const msgs = [decidir({ wellId: W, ...I2, accion: 'ACEPTAR', versionVista: 0 }), decidir({ x: NaN }), decidir({ wellId: '09-9999' }), decidir({ accion: 'X' })].map((r) => r.message).join(' | ');
    expect(msgs).not.toMatch(/Sheets|SpreadsheetApp|Error:|at |\.js|@x\.com|UbicacionFuenteDecisiones/);
  });

  test('los errores de dominio no escriben nada ni dejan el lock tomado', () => {
    decidir({ wellId: W, ...I2, accion: 'RESTAURAR', versionVista: 0 });
    expect(t.filas()).toEqual([]);
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });
});

describe('frontend / backend: el dominio NO deriva', () => {
  const raiz = path.join(__dirname, '..', '..');
  const codigo = (f) => fs.readFileSync(path.join(raiz, f), 'utf8').replace(/\r\n/g, '\n').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s+$/, '')).join('\n');
  const FRONT = 'js/ubicacionFuenteDecisionesLogic.js';
  const BACK = 'backend/src/UbicacionFuenteDecisionesLogic.js';

  test('el codigo (sin comentarios) de las dos copias es IDENTICO', () => {
    expect(codigo(BACK)).toBe(codigo(FRONT));
    expect(codigo(FRONT).length).toBeGreaterThan(8000);
  });

  test('de hecho el archivo completo es identico (cualquier retoque en una sola copia falla aca)', () => {
    expect(fs.readFileSync(path.join(raiz, BACK), 'utf8')).toBe(fs.readFileSync(path.join(raiz, FRONT), 'utf8'));
  });

  test('exportan exactamente lo mismo', () => {
    const f = require('../../js/ubicacionFuenteDecisionesLogic');
    const b = require('../src/UbicacionFuenteDecisionesLogic');
    expect(Object.keys(b).sort()).toEqual(Object.keys(f).sort());
  });

  test('PARIDAD DE COMPORTAMIENTO: las dos copias dan lo mismo sobre los 563 vectores generados por Python y sobre un guion de decisiones', () => {
    const f = require('../../js/ubicacionFuenteDecisionesLogic');
    const b = require('../src/UbicacionFuenteDecisionesLogic');
    const V = require('../../js/fixtures/resolver_ubicacion_vectores.json');
    V.resolver.concat(V.descartes).forEach((c) => {
      const cand = c.fuentes.map((x) => ({ tipo: x.tipo, x: x.x, y: x.y }));
      expect(JSON.stringify(b.ufd_resolverAutomaticoDetallado(cand))).toBe(JSON.stringify(f.ufd_resolverAutomaticoDetallado(cand)));
    });
    const guion = [
      { secuencia: 1, evento: 'ACEPTADA', wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y },
      { secuencia: 2, evento: 'DESCARTADA', wellId: W, fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y, motivo: 'm' },
      { secuencia: 3, evento: 'ACEPTADA', wellId: W, fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y },
      { secuencia: 4, evento: 'ACEPTACION_QUITADA', wellId: W, fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y },
      { secuencia: 5, evento: 'RESTAURADA', wellId: W, fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y },
      { secuencia: 5, evento: 'ACEPTADA', wellId: W, fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1 }
    ];
    const loc = { coordenadas: P_REPORTE, coordenadasProvincia: [P_IRR1, P_IRR2] };
    for (let n = 0; n <= guion.length; n += 1) {
      const ev = guion.slice(0, n);
      const resF = f.ufd_resolverRegistral(f.ufd_derivar({ wellId: W, eventos: ev, fuentes: f.ufd_fuentesDePadron(W, loc).fuentes }));
      const resB = b.ufd_resolverRegistral(b.ufd_derivar({ wellId: W, eventos: ev, fuentes: b.ufd_fuentesDePadron(W, loc).fuentes }));
      expect(JSON.stringify(resB)).toBe(JSON.stringify(resF));
      const stF = f.ufd_derivar({ wellId: W, eventos: ev, fuentes: f.ufd_fuentesDePadron(W, loc).fuentes });
      const stB = b.ufd_derivar({ wellId: W, eventos: ev, fuentes: b.ufd_fuentesDePadron(W, loc).fuentes });
      expect(JSON.stringify(f.ufd_decidir(stF, { decision: 'DESCARTAR', fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y, motivo: 'x', versionVista: stF.version }))).toBe(JSON.stringify(b.ufd_decidir(stB, { decision: 'DESCARTAR', fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y, motivo: 'x', versionVista: stB.version })));
    }
  });

  test('la copia del backend es compatible con Apps Script: sin imports ni IIFE, solo funciones y variables globales', () => {
    const fuente = fs.readFileSync(path.join(raiz, BACK), 'utf8');
    expect(fuente).not.toMatch(/^\s*\(function|\brequire\(|^\s*import |\bexport\b/m);
    expect(fuente).not.toMatch(/\b(window|document|fetch|SpreadsheetApp|LockService|CacheService)\b/);
  });

  test('ningun otro archivo de backend/src redefine las funciones del dominio (ufd_)', () => {
    fs.readdirSync(path.join(raiz, 'backend', 'src')).filter((f) => f !== 'UbicacionFuenteDecisionesLogic.js').forEach((f) => {
      expect(fs.readFileSync(path.join(raiz, 'backend', 'src', f), 'utf8')).not.toMatch(/^function ufd_/m);
    });
  });
});

describe('aislamiento de la Etapa 2', () => {
  const raiz = path.join(__dirname, '..', '..');

  test('el frontend (index.html, service worker, js/) NO usa nada de esto todavia: sin UI, sin mapa, sin api.js', () => {
    expect(fs.readFileSync(path.join(raiz, 'index.html'), 'utf8')).not.toMatch(/ubicacionFuenteDecisiones|getDecisionesFuentesPozo|decidirFuenteUbicacion/);
    expect(fs.readFileSync(path.join(raiz, 'sw.js'), 'utf8')).not.toMatch(/ubicacionFuenteDecisiones/);
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'ubicacionFuenteDecisionesLogic.js').forEach((f) => {
      expect(fs.readFileSync(path.join(raiz, 'js', f), 'utf8')).not.toMatch(/getDecisionesFuentesPozo|decidirFuenteUbicacion|ufd_|UbicacionFuenteDecisiones/);
    });
  });

  test('las correcciones de campo no se tocaron ni se mezclan: este servicio no lee sus hojas ni las nombra', () => {
    const f = fs.readFileSync(path.join(raiz, 'backend', 'src', 'UbicacionFuenteDecisionesService.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(f).not.toMatch(/UbicacionCorrecciones|ubicacionCorreccionRepository_|ubicacionCorreccionService_(proponer|validar(?!Motivo)|rechazar|revertir|leerDerivadas|getPorPozo|getPendientes)/);
    const d = fs.readFileSync(path.join(raiz, 'backend', 'src', 'UbicacionFuenteDecisionesLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(d).not.toMatch(/VALIDADA|campo|correccion/i);
  });

  test('no hay delta (getDecisionesFuentesDelta): su contrato depende de decisiones de la Etapa 3', () => {
    const api = fs.readFileSync(path.join(raiz, 'backend', 'src', 'Api.js'), 'utf8');
    expect(api).not.toMatch(/getDecisionesFuentesDelta/);
  });
});
