// Secuencia global de UbicacionFuenteDecisiones: MAX(secuencia de TODA la hoja) + 1, calculada bajo el lock de script, sin contador mutable aparte.
// Casos explicitos: hoja vacia, 1-2-3, huecos, filas fuera de orden, timestamp irrelevante, valores invalidos (fail-closed) y concurrencia simulada bajo lock.
const { armar, solicitud, P_REPORTE, P_IRR1, P_IRR2, P_UNICA } = require('./decisionesFuentesHelper');

let t;
const W = '14-0001';
const OTRO = '09-0001'; // pozo con filas sembradas a mano (no hace falta que este en el padron: la secuencia es global y no mira el padron)

beforeEach(() => { t = armar(); });
afterEach(() => { jest.restoreAllMocks(); });

const VAL = 'val@x.com';
const decidir = (extra, quien) => t.S.ubicacionFuenteDecisionesService_decidir(quien || VAL, USUARIOS_NOMBRE[quien || VAL], solicitud(extra));
const USUARIOS_NOMBRE = { 'val@x.com': 'Valeria Validadora', 'vero@x.com': 'Vero Validadora' };
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };

// siembra filas a mano en la hoja (como si ya existieran); cada una: { secuencia, wellId?, timestampUtc?, evento? ... } (el resto, valores validos)
function sembrar(...especificaciones) {
  especificaciones.forEach((e, i) => {
    const base = { decisionId: 'sembrada-' + i, secuencia: 1, wellId: OTRO, fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1, evento: 'ACEPTADA', motivo: '', email: 'otro@x.com', nombre: 'Otro', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'sembrada-' + String(i).padStart(3, '0'), versionVista: 0, padronPeriodo: '2026-09' };
    const o = { ...base, ...e };
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => o[c]));
  });
  t.cache.store = {};
}
const secuencias = () => t.filas().map((f) => f[t.columnas.indexOf('secuencia')]);

describe('MAX + 1: casos base', () => {
  test('hoja vacia -> 1', () => {
    expect(t.filas()).toHaveLength(0);
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    expect(r.ok).toBe(true);
    expect(r.decision.secuencia).toBe(1);
    expect(secuencias()).toEqual([1]);
  });

  test('1, 2, 3 -> 4', () => {
    sembrar({ secuencia: 1 }, { secuencia: 2 }, { secuencia: 3 });
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    expect(r.decision.secuencia).toBe(4);
    expect(secuencias()).toEqual([1, 2, 3, 4]);
  });

  test('huecos 1, 2, 7 -> 8 (los huecos no se rellenan)', () => {
    sembrar({ secuencia: 1 }, { secuencia: 2 }, { secuencia: 7 });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(8);
    expect(secuencias()).toEqual([1, 2, 7, 8]);
  });

  test('filas fuera de orden (7, 1, 3, 2) -> 8: el maximo no depende de la posicion fisica', () => {
    sembrar({ secuencia: 7 }, { secuencia: 1 }, { secuencia: 3 }, { secuencia: 2 });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(8);
  });

  test('el maximo puede estar en CUALQUIER pozo: es global, no por pozo', () => {
    sembrar({ secuencia: 5, wellId: '01-0012' }, { secuencia: 20, wellId: '09-0001' }, { secuencia: 3, wellId: W, evento: 'ACEPTADA' });
    // (la fila sembrada de W apunta a una coordenada que no existe en el padron: queda obsoleta, no inconsistente)
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 3 }).decision.secuencia).toBe(21);
  });

  test('una secuencia numerica guardada como texto ("9") cuenta (la hoja guarda texto a veces): -> 10', () => {
    sembrar({ secuencia: '9' });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(10);
  });

  test('cada escritura consume exactamente una secuencia, siempre creciente', () => {
    const r1 = decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    const r2 = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: r1.data.version });
    const r3 = decidir({ wellId: W, ...I2, accion: 'DESCARTAR', motivo: 'x', versionVista: r2.data.version });
    expect([r1, r2, r3].map((r) => r.decision.secuencia)).toEqual([1, 2, 3]);
  });

  test('un rechazo (STALE_STATE, transicion invalida, fuente inexistente, permiso) NO consume secuencia', () => {
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });                       // 1
    expect(decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 }).code).toBe('STALE_STATE');
    expect(decidir({ wellId: W, ...I1, accion: 'QUITAR_ACEPTACION', versionVista: 1 }).ok).toBe(false);
    expect(decidir({ wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 1, accion: 'ACEPTAR', versionVista: 1 }).code).toBe('SOURCE_NOT_FOUND');
    expect(decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1 }).decision.secuencia).toBe(2);   // la siguiente es 2, no 5
    expect(secuencias()).toEqual([1, 2]);
  });
});

describe('el timestamp es irrelevante para la secuencia', () => {
  test('la mayor secuencia con el timestamp mas VIEJO sigue siendo el maximo', () => {
    sembrar({ secuencia: 10, timestampUtc: '2020-01-01T00:00:00.000Z' }, { secuencia: 2, timestampUtc: '2030-12-31T23:59:59.999Z' });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(11);
  });

  test('timestamps vacios, rotos o futuros en otras filas no cambian el calculo', () => {
    sembrar({ secuencia: 4, timestampUtc: '' }, { secuencia: 5, timestampUtc: 'no-es-fecha' }, { secuencia: 6, timestampUtc: '2999-01-01T00:00:00.000Z' });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(7);
  });

  test('el reloj hacia atras no altera la secuencia: dos escrituras con el reloj retrocediendo igual dan 1 y 2', () => {
    const r1 = decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    t.reloj -= 30 * 24 * 3600 * 1000;
    const r2 = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: r1.data.version });
    expect([r1.decision.secuencia, r2.decision.secuencia]).toEqual([1, 2]);
    expect(r2.decision.timestampUtc < r1.decision.timestampUtc).toBe(true);
  });
});

describe('valores de secuencia invalidos o corruptos: FAIL-CLOSED (no se escribe nada)', () => {
  // En una fila de OTRO pozo: el pozo que se decide esta sano, pero MAX + 1 deja de ser confiable (la fila corrupta podria "ser" cualquier numero).
  test.each([
    ['texto no numerico', 'abc'],
    ['vacia con el resto de la fila completo', ''],
    ['cero', 0],
    ['negativa', -3],
    ['decimal', 2.5],
    ['mayor que el maximo entero seguro', 1e21],
    ['Infinity en texto', 'Infinity'],
    ['NaN en texto', 'NaN'],
    ['fecha en vez de numero', '2026-10-14']
  ])('secuencia %s en la fila de otro pozo: la escritura se rechaza y la hoja queda intacta', (_n, valor) => {
    sembrar({ secuencia: 3 }, { secuencia: valor, decisionId: 'corrupta' });
    const antes = JSON.stringify(t.hojas.UbicacionFuenteDecisiones.filas);
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    expect(r).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    expect(JSON.stringify(t.hojas.UbicacionFuenteDecisiones.filas)).toBe(antes);                // nada escrito
    expect(global.Logger.log.mock.calls.some((c) => /secuencia/i.test(String(c[0])) && /corrupta/.test(String(c[0])))).toBe(true);   // el detalle queda en el log (con el id de la fila)
    expect(JSON.stringify(r)).not.toMatch(/corrupta|abc|1e\+21/);                                  // y no sale al cliente
  });

  test('con la fila corrupta en el MISMO pozo tambien se rechaza (el dominio lo marca no integro)', () => {
    sembrar({ secuencia: 'abc', wellId: W, decisionId: 'corrupta' });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' })).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    expect(t.filas()).toHaveLength(1);
  });

  test('la LECTURA no se bloquea por la fila corrupta de otro pozo: el pozo sano se sigue viendo', () => {
    sembrar({ secuencia: 'abc', decisionId: 'corrupta' });
    const r = t.S.ubicacionFuenteDecisionesService_getPorPozo(W);
    expect(r.ok).toBe(true);
    expect(r.data.integro).toBe(true);
  });

  test('un reintento idempotente de una decision ya escrita se sigue atendiendo aunque otra fila sea corrupta (no escribe: no necesita la secuencia)', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR' });
    const r1 = t.S.ubicacionFuenteDecisionesService_decidir(VAL, 'Valeria Validadora', sol);
    expect(r1.ok).toBe(true);
    sembrar({ secuencia: 'abc', decisionId: 'corrupta' });
    const r2 = t.S.ubicacionFuenteDecisionesService_decidir(VAL, 'Valeria Validadora', sol);
    expect(r2).toMatchObject({ ok: true, duplicada: true });
    expect(r2.decision.secuencia).toBe(1);
    expect(t.filas()).toHaveLength(2);
  });

  test('al corregir a mano la fila corrupta, las escrituras vuelven a funcionar (no queda trabado para siempre)', () => {
    sembrar({ secuencia: 'abc', decisionId: 'corrupta' });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).code).toBe('INCONSISTENT_STATE');
    t.hojas.UbicacionFuenteDecisiones.filas[1][t.columnas.indexOf('secuencia')] = 6;
    t.cache.store = {};
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(7);
  });

  test('una fila completamente vacia NO es corrupta (se ignora, como siempre)', () => {
    sembrar({ secuencia: 4 });
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map(() => ''));
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(5);
  });

  test('el diagnostico manual NO lanza ante la fila corrupta (es la herramienta para encontrarla)', () => {
    sembrar({ secuencia: 'abc', decisionId: 'corrupta' });
    expect(() => t.S.ubicacionFuenteDecisionesService_diagnosticar()).not.toThrow();
  });
});

describe('concurrencia simulada bajo lock', () => {
  test('la lectura del maximo y la escritura ocurren DENTRO del lock (lock -> leer -> escribir -> liberar)', () => {
    const orden = [];
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const getDataRange = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { orden.push('leer'); return getDataRange(); };
    const original = global.LockService.getScriptLock;
    global.LockService.getScriptLock = () => {
      const l = original();
      return { waitLock: (ms) => { orden.push('lock'); l.waitLock(ms); }, releaseLock: () => { orden.push('libera'); l.releaseLock(); } };
    };
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    const iLock = orden.indexOf('lock');
    const iLibera = orden.lastIndexOf('libera');
    const lecturasEnLock = orden.slice(iLock, iLibera).filter((x) => x === 'leer').length;
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(lecturasEnLock).toBeGreaterThanOrEqual(1);            // se relee DENTRO del lock
    expect(orden.indexOf('libera')).toBeGreaterThan(iLock);
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });

  test('otro validador escribe justo cuando este toma el lock (otro pozo): esta escritura relee y toma la secuencia SIGUIENTE, sin repetir', () => {
    t.alTomarLock = () => {
      // "el otro proceso": escribe en 01-0012 mientras este esperaba el lock
      t.S.ubicacionFuenteDecisionesService_decidir('vero@x.com', 'Vero Validadora', solicitud({ wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y, accion: 'ACEPTAR', versionVista: 0 }));
    };
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    expect(r.ok).toBe(true);
    expect(r.decision.secuencia).toBe(2);                         // la 1 ya la uso el otro
    expect(secuencias()).toEqual([1, 2]);
    expect(new Set(secuencias()).size).toBe(2);
  });

  test('tres escritores intercalados (cada uno entra justo cuando otro toma el lock) -> 1, 2, 3 sin repeticiones ni saltos', () => {
    let nivel = 0;
    const sol = (wellId, f) => solicitud({ wellId, ...f, accion: 'ACEPTAR', versionVista: 0 });
    const escritorB = () => t.S.ubicacionFuenteDecisionesService_decidir('vero@x.com', 'Vero', sol('01-0012', { fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y }));
    t.alTomarLock = () => {
      nivel += 1;
      // al tomar el lock el escritor A, entra B; y al tomar el lock B, no hay mas hooks (alTomarLock se consume)
      escritorB();
    };
    const rA = decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    const rC = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: rA.data.version });
    expect(nivel).toBe(1);
    expect(secuencias()).toEqual([1, 2, 3]);
    expect(new Set(secuencias()).size).toBe(3);
    expect([rA.decision.secuencia, rC.decision.secuencia]).toEqual([2, 3]);
  });

  test('dos validadores sobre EL MISMO pozo con la misma version: uno gana (secuencia siguiente), el otro recibe STALE_STATE y no consume secuencia', () => {
    t.alTomarLock = () => {
      t.S.ubicacionFuenteDecisionesService_decidir('vero@x.com', 'Vero Validadora', solicitud({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 }));
    };
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    expect(secuencias()).toEqual([1]);
    const r2 = decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 1 });
    expect(r2.decision.secuencia).toBe(2);                         // sin hueco: el rechazo no gasto numero
  });

  test('si el lock no se consigue (timeout) la escritura falla (el Api la responde generica) y NO escribe', () => {
    global.LockService.getScriptLock = () => ({ waitLock: () => { throw new Error('Lock timeout'); }, releaseLock: () => { t.locks.liberados += 1; } });
    // el servicio deja subir el error (el Api lo convierte en SERVICE_UNAVAILABLE generico, ver ApiDecisionesFuentes.test.js)
    expect(() => decidir({ wellId: W, ...REP, accion: 'ACEPTAR' })).toThrow(/Lock timeout/);
    expect(t.filas()).toHaveLength(0);
  });

  test('si la escritura falla (hoja caida) el lock se libera y la secuencia no se consume', () => {
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const original = hoja.getRange.bind(hoja);
    let fallar = true;
    hoja.getRange = (...a) => {
      const rango = original(...a);
      const setValues = rango.setValues && rango.setValues.bind(rango);
      if (fallar && setValues) { rango.setValues = () => { throw new Error('Sheets caido'); }; }
      return rango;
    };
    expect(() => decidir({ wellId: W, ...REP, accion: 'ACEPTAR' })).toThrow();
    expect(t.locks.tomados).toBe(t.locks.liberados);
    fallar = false;
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR' }).decision.secuencia).toBe(1);
  });
});

describe('sin contador mutable aparte', () => {
  test('el servicio no usa PropertiesService ni ninguna celda/clave auxiliar para la secuencia: solo la hoja', () => {
    const fs = require('fs');
    const path = require('path');
    const dir = path.join(__dirname, '..', 'src');
    ['UbicacionFuenteDecisionesService.js', 'UbicacionFuenteDecisionesRepository.js'].forEach((f) => {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src).not.toMatch(/PropertiesService/);
      expect(src).not.toMatch(/setProperty|getProperty/);
    });
    // y lo unico que escribe el servicio es UNA fila por decision (agregar), sin tocar celdas sueltas
    expect(fs.readFileSync(path.join(dir, 'UbicacionFuenteDecisionesRepository.js'), 'utf8')).not.toMatch(/getRange\([^)]*\)\.setValue\(/);
  });

  test('despues de borrar filas a mano las ultimas, la secuencia se reutiliza (limite conocido y documentado: no se intenta detectar)', () => {
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR' });
    decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1 });
    t.hojas.UbicacionFuenteDecisiones.filas.pop();                 // alguien borra la ultima fila a mano
    t.cache.store = {};
    expect(decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1 }).decision.secuencia).toBe(2);
  });
});
