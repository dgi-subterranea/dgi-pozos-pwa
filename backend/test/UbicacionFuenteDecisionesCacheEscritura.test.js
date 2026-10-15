// Cache de lectura vs escritura de UbicacionFuenteDecisiones. Contrato:
//   - una escritura CONFIRMADA invalida la vista del pozo; ningun rechazo (STALE_STATE, transicion invalida, error de dominio o de servicio) invalida nada;
//   - un reintento idempotente no invalida ni deja inconsistencias;
//   - un cache viejo (o mentiroso) NUNCA se usa para decidir ni para escribir;
//   - la escritura relee hoja + padron DENTRO del lock.
const { armar, solicitud, P_REPORTE, P_IRR1, P_IRR2 } = require('./decisionesFuentesHelper');

let t;
const W = '14-0001';
const VAL = 'val@x.com';
const NOMBRE = 'Valeria Validadora';
const CLAVE = 'ufd_vista_v1_' + W;
const INVAL = 'ufd_vista_v1_inval';
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };

beforeEach(() => { t = armar(); });
afterEach(() => { jest.restoreAllMocks(); });

const decidirSol = (sol, quien) => t.S.ubicacionFuenteDecisionesService_decidir(quien || VAL, NOMBRE, sol);
const decidir = (extra) => decidirSol(solicitud(extra));
const leer = (w) => t.S.ubicacionFuenteDecisionesService_getPorPozo(w || W);
// deja el cache del pozo lleno y "al dia" (hay que calmar el reloj: la marca de invalidacion tiene un margen de carrera de 2 s)
const calentar = () => { t.calmar(); leer(); expect(t.cache.store[CLAVE]).toBeDefined(); t.cache.put.mockClear(); t.cache.remove.mockClear(); };
const tocoElCache = () => t.cache.remove.mock.calls.length + t.cache.put.mock.calls.filter((c) => c[0] === INVAL).length;

describe('una escritura confirmada invalida; un rechazo no', () => {
  test('escritura OK: se borra la clave del pozo, se marca la invalidacion global y la lectura siguiente ve el estado nuevo', () => {
    calentar();
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(t.cache.remove).toHaveBeenCalledWith(CLAVE);
    expect(t.cache.put.mock.calls.some((c) => c[0] === INVAL)).toBe(true);
    expect(t.cache.store[CLAVE]).toBeUndefined();
    expect(leer().data.version).toBe(1);
  });

  test('la invalidacion ocurre DESPUES de escribir la fila (nunca antes: se podria recachear el estado viejo)', () => {
    calentar();
    const orden = [];
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const getRange = hoja.getRange.bind(hoja);
    hoja.getRange = (...a) => { const r = getRange(...a); const sv = r.setValues && r.setValues.bind(r); if (sv) { r.setValues = (v) => { orden.push('escribe'); return sv(v); }; } return r; };
    t.cache.remove.mockImplementation(() => { orden.push('invalida'); });
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(orden.indexOf('escribe')).toBeGreaterThanOrEqual(0);
    expect(orden.indexOf('invalida')).toBeGreaterThan(orden.indexOf('escribe'));
  });

  describe('NINGUN rechazo toca el cache (ni la clave del pozo ni la marca global)', () => {
    const preparar = {
      STALE_STATE: () => { decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }); calentar(); return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 }; },
      INVALID_TRANSITION: () => { decidir({ wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 0 }); calentar(); return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1 }; },
      ALREADY_IN_STATE: () => { decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }); calentar(); return { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 1 }; },
      INVALID_MOTIVO: () => { calentar(); return { wellId: W, ...I1, accion: 'DESCARTAR', motivo: '', versionVista: 0 }; },
      SOURCE_NOT_FOUND: () => { calentar(); return { wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 1, accion: 'ACEPTAR', versionVista: 0 }; },
      INVALID_ACCION: () => { calentar(); return { wellId: W, ...I1, accion: 'BORRAR', versionVista: 0 }; },
      INVALID_VERSION: () => { calentar(); return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: -1 }; },
      INVALID_CLIENT_REQUEST_ID: () => { calentar(); return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'x' }; },
      WELL_NOT_FOUND: () => { calentar(); return { wellId: '15-0005', ...I1, accion: 'ACEPTAR', versionVista: 0 }; },
      IDEMPOTENCY_CONFLICT: () => { decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-cache-conf' }); calentar(); return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 1, clientRequestId: 'req-cache-conf' }; },
      INCONSISTENT_STATE: () => {
        t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'x', secuencia: 'abc', wellId: '09-0001', fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1, evento: 'ACEPTADA', email: 'o@x.com', nombre: 'O', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'otra-0001', versionVista: 0, padronPeriodo: '2026-09' }[c] || '')));
        t.cache.store = {};
        calentar();
        return { wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 };
      }
    };
    test.each(Object.keys(preparar))('%s', (codigo) => {
      const sol = preparar[codigo]();
      const filasAntes = t.filas().length;
      const cacheAntes = JSON.stringify(t.cache.store);
      t.cache.put.mockClear(); t.cache.remove.mockClear();
      const r = decidirSol(solicitud(sol));
      expect(r.ok).toBe(false);
      expect(r.code).toBe(codigo);
      expect(t.filas()).toHaveLength(filasAntes);                           // nada escrito
      expect(tocoElCache()).toBe(0);                                         // ni remove ni marca de invalidacion
      expect(JSON.stringify(t.cache.store)).toBe(cacheAntes);                // y el cache queda exactamente igual
    });

    test('una falla del padron o de la hoja al escribir tampoco toca el cache', () => {
      calentar();
      global.registryService_getWellLocation.mockImplementation(() => { throw new Error('Drive caido'); });
      expect(() => decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 })).toThrow();
      expect(tocoElCache()).toBe(0);
      expect(t.filas()).toHaveLength(0);
    });

    test('un fallo al ESCRIBIR la fila (hoja caida) no invalida: no hubo escritura confirmada', () => {
      calentar();
      const hoja = t.hojas.UbicacionFuenteDecisiones;
      const getRange = hoja.getRange.bind(hoja);
      hoja.getRange = (...a) => { const r = getRange(...a); if (r.setValues) { r.setValues = () => { throw new Error('Sheets caido'); }; } return r; };
      expect(() => decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 })).toThrow();
      expect(tocoElCache()).toBe(0);
    });

    test('un permiso denegado en el Api nunca llega al servicio ni al cache', () => {
      calentar();
      const r = t.Api.handleDecidirFuenteUbicacion('tok-lee@x.com', { wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'req-sin-permiso' });
      expect(r.code).toBe('PERMISSION_DENIED');
      expect(tocoElCache()).toBe(0);
    });
  });
});

describe('reintento idempotente: sin invalidar y sin inconsistencias', () => {
  test('el duplicado devuelve la decision original, no invalida y deja el cache intacto', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    const r1 = decidirSol(sol);
    calentar();
    const antes = JSON.stringify(t.cache.store);
    const r2 = decidirSol({ ...sol });
    expect(r2).toMatchObject({ ok: true, duplicada: true });
    expect(r2.decision).toEqual(r1.decision);
    expect(tocoElCache()).toBe(0);
    expect(JSON.stringify(t.cache.store)).toBe(antes);
    expect(t.filas()).toHaveLength(1);
  });

  test('el duplicado con el cache vacio o roto responde igual y la vista que devuelve sale de la HOJA (no del cache)', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    decidirSol(sol);
    t.cache.store[CLAVE] = JSON.stringify({ wellId: W, version: 99, fuentes: [] });      // cache mentiroso
    const r2 = decidirSol({ ...sol });
    expect(r2.duplicada).toBe(true);
    expect(r2.data.version).toBe(1);                                                    // no 99
    expect(r2.data.fuentes.length).toBe(3);
  });

  test('retry + decision de otro validador entre medio: el duplicado igual devuelve la original y la vista incluye la nueva', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    const r1 = decidirSol(sol);
    decidirSol(solicitud({ wellId: W, ...I1, accion: 'DESCARTAR', motivo: 'x', versionVista: 1 }), 'vero@x.com');
    const r2 = decidirSol({ ...sol });
    expect(r2.decision).toEqual(r1.decision);
    expect(r2.duplicada).toBe(true);
    expect(r2.data.version).toBe(2);
    expect(t.filas()).toHaveLength(2);
  });

  test('N reintentos seguidos = 1 sola fila y 1 sola invalidacion', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    t.cache.remove.mockClear();
    for (let i = 0; i < 5; i += 1) { decidirSol({ ...sol }); }
    expect(t.filas()).toHaveLength(1);
    expect(t.cache.remove).toHaveBeenCalledTimes(1);
  });
});

describe('un cache viejo o mentiroso NUNCA se usa para decidir ni para escribir', () => {
  test('el cache dice version 77: se decide contra la hoja (version 0) y se acepta', () => {
    leer();
    t.cache.store[CLAVE] = JSON.stringify({ ...leer().data, version: 77 });
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
  });

  test('el cache dice "I1 ya esta ACEPTADA" pero la hoja esta vacia: aceptar I1 funciona (no ALREADY_IN_STATE)', () => {
    leer();
    const v = leer().data;
    v.fuentes = v.fuentes.map((f) => (f.fuenteTipo === 'IRRIGACION' && f.x === P_IRR1.x ? { ...f, estado: 'ACEPTADA', esAceptadaVigente: true } : f));
    t.cache.store[CLAVE] = JSON.stringify(v);
    const r = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 });
    expect(r.ok).toBe(true);
    expect(t.filas()).toHaveLength(1);
  });

  test('el cache dice "todo sin revisar" pero la hoja tiene I1 aceptada (escritura fuera de la app): aceptar I1 es ALREADY_IN_STATE', () => {
    leer();                                                                 // cache: version 0, todo SIN_REVISAR
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'fuera', secuencia: 1, wellId: W, ...I1, evento: 'ACEPTADA', motivo: '', email: 'o@x.com', nombre: 'O', timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'fuera-0001', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    expect(leer().data.version).toBe(0);                                    // la lectura SI sirve el cache (hasta 120 s): version vieja
    const r = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });   // la escritura vio la hoja real
  });

  test('un cliente que decide con la version que le dio el cache viejo recibe STALE_STATE con la version real (se entera y relee)', () => {
    leer();
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'fuera', secuencia: 4, wellId: W, ...REP, evento: 'ACEPTADA', motivo: '', email: 'o@x.com', nombre: 'O', timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'fuera-0002', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    const versionDelCache = leer().data.version;
    const r = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: versionDelCache });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 4 });
  });

  test('durante una escritura NO se consulta el cache de lectura del pozo (solo se escribe/invalida)', () => {
    leer();
    t.cache.get.mockClear();
    decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(t.cache.get.mock.calls.filter((c) => String(c[0]).startsWith('ufd_'))).toEqual([]);
  });

  test('la vista que devuelve la escritura sale del estado recien calculado, no de una lectura cacheada', () => {
    leer();
    t.cache.store[CLAVE] = JSON.stringify({ ...leer().data, version: 77 });
    const r = decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(r.data.version).toBe(1);
  });

  test('con CacheService caido, escribir y leer siguen funcionando y consistentes', () => {
    t.cache.falla = { get: true, put: true, remove: true };
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    expect(leer().data.version).toBe(1);
  });
});

describe('la escritura relee hoja + padron DENTRO del lock', () => {
  function espiarOrden() {
    const orden = [];
    const hoja = t.hojas.UbicacionFuenteDecisiones;
    const getDataRange = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { orden.push('hoja'); return getDataRange(); };
    const getPadron = global.registryService_getWellLocation;
    global.registryService_getWellLocation = jest.fn((...a) => { orden.push('padron'); return getPadron(...a); });
    const original = global.LockService.getScriptLock;
    global.LockService.getScriptLock = () => {
      const l = original();
      return { waitLock: (ms) => { orden.push('lock'); l.waitLock(ms); }, releaseLock: () => { orden.push('libera'); l.releaseLock(); } };
    };
    return orden;
  }

  test('el padron se lee DESPUES de tomar el lock y antes de liberarlo; la hoja se relee dentro; nada del padron antes del lock', () => {
    const orden = espiarOrden();
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 }).ok).toBe(true);
    const iLock = orden.indexOf('lock');
    const iLibera = orden.indexOf('libera');
    expect(iLock).toBeGreaterThanOrEqual(0);
    expect(orden.slice(0, iLock)).not.toContain('padron');               // antes del lock solo se mira la hoja (idempotencia)
    expect(orden.slice(iLock, iLibera)).toContain('hoja');
    expect(orden.slice(iLock, iLibera)).toContain('padron');
  });

  test('REINDEXADO entre el pedido y el lock: la coordenada que existia ya no existe -> SOURCE_NOT_FOUND y no se escribe', () => {
    t.alTomarLock = () => { t.padron[W].coordenadasProvincia = [{ ...P_IRR2 }]; };      // otro proceso reindexa el padron mientras esperabamos el lock
    const r = decidir({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_FOUND' });
    expect(t.filas()).toHaveLength(0);
    expect(tocoElCache()).toBe(0);
  });

  test('REINDEXADO a favor: una coordenada nueva que aparece entre el pedido y el lock SI se puede decidir', () => {
    const NUEVA = { x: 2487000, y: 6311000 };
    t.alTomarLock = () => { t.padron[W].coordenadasProvincia = [{ ...P_IRR1 }, { ...P_IRR2 }, { ...NUEVA }]; };
    const r = decidir({ wellId: W, fuenteTipo: 'IRRIGACION', ...NUEVA, accion: 'ACEPTAR', versionVista: 0 });
    expect(r.ok).toBe(true);
  });

  test('otro validador escribe entre el pedido y el lock: se relee la hoja y la version vieja es STALE_STATE', () => {
    t.alTomarLock = () => { decidirSol(solicitud({ wellId: W, ...I1, accion: 'ACEPTAR', versionVista: 0 }), 'vero@x.com'); };
    expect(decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 })).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    expect(t.filas()).toHaveLength(1);
  });

  test('el mismo pedido llega dos veces a la vez (el 2do ya lo encuentra escrito al tomar el lock): una sola fila, el segundo es duplicado', () => {
    const sol = solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 });
    t.alTomarLock = () => { decidirSol({ ...sol }); };                                  // la copia "concurrente" gana el lock primero
    const r = decidirSol({ ...sol });
    expect(r).toMatchObject({ ok: true, duplicada: true });
    expect(t.filas()).toHaveLength(1);
  });

  test('padron caido DENTRO del lock: error del servicio, lock liberado, nada escrito', () => {
    t.alTomarLock = () => { global.registryService_getWellLocation.mockImplementation(() => { throw new Error('Drive caido'); }); };
    expect(() => decidir({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0 })).toThrow(/Drive caido/);
    expect(t.locks.tomados).toBe(t.locks.liberados);
    expect(t.filas()).toHaveLength(0);
  });

  test('el padron que no encuentra el pozo dentro del lock: WELL_NOT_FOUND y lock liberado', () => {
    const r = decidir({ wellId: '15-0005', ...REP, accion: 'ACEPTAR', versionVista: 0 });
    expect(r).toMatchObject({ ok: false, code: 'WELL_NOT_FOUND' });
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });
});
