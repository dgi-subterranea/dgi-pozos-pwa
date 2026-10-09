// Reglas de negocio de las correcciones de ubicacion con el repositorio REAL sobre hojas en memoria (fakeSheets) y el padron
// simulado (registryService_getWellLocation / getMetadata). Cubre: validaciones, snapshot de Irrigacion tomado por el backend,
// distancia/observacion/advertencia, idempotencia por clientRequestId, estado derivado, transiciones, SUPERADA, auto-validacion,
// concurrencia (lock con carrera simulada) y que las vistas no filtren emails.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const W = '04-0263';
const OTRO_POZO = '04-0999';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', x: 2500000, y: 6350000, lat: -32.9, lon: -68.8 };
const METROS_POR_GRADO = 111195;

let Repo;
let S;
let hojas;
let ubicacion;      // lo que "devuelve el padron" por wellId

const norte = (metros) => ({ lat: OFICIAL.lat + metros / METROS_POR_GRADO, lon: OFICIAL.lon });
const filasDe = (nombre) => hojas[nombre].filas.slice(1);
const correcciones = () => filasDe('UbicacionCorrecciones');
const eventos = () => filasDe('UbicacionCorreccionesLog');

function instalarLock(hook) {
  const c = { waits: 0, releases: 0 };
  global.LockService = {
    getScriptLock: () => ({
      waitLock: () => { c.waits += 1; if (hook) { hook(c.waits); } },
      releaseLock: () => { c.releases += 1; }
    })
  };
  return c;
}

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  Repo = require('../src/UbicacionCorreccionRepository');
  S = require('../src/UbicacionCorreccionService');
  Object.assign(global, Repo);
  hojas = instalarSheetsFalsos({
    UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS],
    UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS]
  });
  ubicacion = { [W]: OFICIAL, [OTRO_POZO]: OFICIAL };
  global.registryService_getWellLocation = jest.fn((id) => (ubicacion[id] === undefined
    ? { found: false }
    : { found: true, location: { wellId: id, ubicacionResuelta: ubicacion[id] } }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
});

let contador = 0;
function datos(extra) {
  contador += 1;
  return Object.assign({ clientRequestId: 'req-' + String(contador).padStart(8, '0'), metodo: 'PUNTO_EN_MAPA', lat: norte(80).lat, lon: norte(80).lon, precisionGpsM: null, observacion: '' }, extra || {});
}
const proponer = (extra, email, nombre, wellId) => S.ubicacionCorreccionService_proponer(email || 'ana@x.com', nombre === undefined ? 'Ana' : nombre, wellId || W, datos(extra));
function propuesta(extra, email, wellId) {
  const r = proponer(extra, email, undefined, wellId);
  expect(r.ok).toBe(true);
  return r.correccion.correccionId;
}
const validar = (id, email, motivo) => S.ubicacionCorreccionService_validar(email || 'val@x.com', 'Valeria', id, motivo);
const rechazar = (id, motivo, email) => S.ubicacionCorreccionService_rechazar(email || 'val@x.com', 'Valeria', id, motivo);
const revertir = (id, motivo, email) => S.ubicacionCorreccionService_revertir(email || 'val@x.com', 'Valeria', id, motivo);
const eventosDe = (id) => eventos().filter((f) => f[0] === id).map((f) => f[2]);

describe('catalogos y constantes', () => {
  test('metodos y eventos tal como se aprobaron', () => {
    expect(S.UBICACION_CORR_METODOS).toEqual(['GPS_ACTUAL', 'PUNTO_EN_MAPA']);
    expect(S.UBICACION_CORR_EVENTOS).toEqual(['PROPUESTA', 'VALIDADA', 'RECHAZADA', 'SUPERADA', 'REVERTIDA']);
    expect(S.UBICACION_CORR_GPS_PRECISION_MAX_M).toBe(50);
    expect(S.UBICACION_CORR_OBSERVACION_DESDE_M).toBe(250);
    expect(S.UBICACION_CORR_ADVERTENCIA_DESDE_M).toBe(1000);
    expect(S.UBICACION_CORR_OBSERVACION_MAX).toBe(300);
  });

  test('transiciones: solo PROPUESTA->VALIDADA|RECHAZADA y VALIDADA->SUPERADA|REVERTIDA; el resto es terminal', () => {
    expect(S.UBICACION_CORR_TRANSICIONES).toEqual({ PROPUESTA: ['VALIDADA', 'RECHAZADA'], VALIDADA: ['SUPERADA', 'REVERTIDA'], RECHAZADA: [], SUPERADA: [], REVERTIDA: [] });
  });
});

describe('distancia y geografia', () => {
  test('haversine: 0 m, simetrica y ~111,2 km por grado de latitud', () => {
    expect(S.ubicacionCorreccionService_distanciaMetros(-32.9, -68.8, -32.9, -68.8)).toBe(0);
    const d = S.ubicacionCorreccionService_distanciaMetros(-33, -68.8, -32, -68.8);
    expect(d).toBeGreaterThan(111000);
    expect(d).toBeLessThan(111400);
    expect(S.ubicacionCorreccionService_distanciaMetros(-33, -68.8, -32, -68.8)).toBe(S.ubicacionCorreccionService_distanciaMetros(-32, -68.8, -33, -68.8));
  });

  test.each([
    ['Ciudad de Mendoza', -32.8908, -68.8272],
    ['Uspallata', -32.5961, -69.3472],
    ['San Rafael', -34.6177, -68.3301],
    ['Malargue', -35.4757, -69.5859],
    ['Tupungato', -33.3668, -69.1457],
    ['Lavalle (norte)', -32.2, -68.2]
  ])('dentro de Mendoza: %s', (n, lat, lon) => {
    expect(S.ubicacionCorreccionService_dentroDeMendoza(lat, lon)).toBe(true);
  });

  test.each([
    ['Buenos Aires', -34.6037, -58.3816],
    ['Santiago de Chile', -33.4489, -70.6693],
    ['San Luis', -33.2950, -66.3356],
    ['Neuquen', -38.9516, -68.0591],
    ['San Juan (norte)', -31.5375, -68.5364],
    ['Ocano Atlantico', -35, -40],
    ['lat/lon invertidos', -68.8272, -32.8908]
  ])('fuera de Mendoza: %s', (n, lat, lon) => {
    expect(S.ubicacionCorreccionService_dentroDeMendoza(lat, lon)).toBe(false);
  });
});

describe('validarPropuesta (contenido, sin leer nada)', () => {
  const v = (extra) => S.ubicacionCorreccionService_validarPropuesta(datos(extra));

  test('una propuesta valida devuelve los valores normalizados (6 decimales)', () => {
    const r = v({ lat: -32.12345678, lon: -68.87654321 });
    expect(r.ok).toBe(true);
    expect(r.valores).toMatchObject({ lat: -32.123457, lon: -68.876543, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' });
  });

  test.each([undefined, null, '', 'corto', 'x'.repeat(65), 'con espacio 123', 'caracter/raro1', 12345678])('clientRequestId invalido (%p): INVALID_CLIENT_REQUEST_ID', (id) => {
    expect(S.ubicacionCorreccionService_validarPropuesta(Object.assign(datos(), { clientRequestId: id })).code).toBe('INVALID_CLIENT_REQUEST_ID');
  });

  test('clientRequestId acepta un uuid y 8 a 64 caracteres seguros', () => {
    expect(v({ clientRequestId: '3f2b8c1e-9a4d-4e7a-8b6c-1d2e3f4a5b6c' }).ok).toBe(true);
    expect(v({ clientRequestId: 'a'.repeat(8) }).ok).toBe(true);
    expect(v({ clientRequestId: 'a'.repeat(64) }).ok).toBe(true);
  });

  test.each([undefined, '', 'gps_actual', 'MANUAL', 'FOTO', 5, null])('metodo invalido (%p): INVALID_METODO', (m) => {
    expect(v({ metodo: m }).code).toBe('INVALID_METODO');
  });

  test.each([['lat no numerica', { lat: '-32.9' }], ['lon null', { lon: null }], ['NaN', { lat: NaN }], ['Infinity', { lon: Infinity }],
    ['lat > 90', { lat: 91 }], ['lon < -180', { lon: -181 }], ['0,0', { lat: 0, lon: 0 }]])('coordenadas invalidas: %s', (n, extra) => {
    expect(v(extra).code).toBe('INVALID_COORDENADAS');
  });

  test('punto claramente fuera de Mendoza: FUERA_DE_MENDOZA (no se guarda nada)', () => {
    const r = proponer({ lat: -34.6037, lon: -58.3816 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('FUERA_DE_MENDOZA');
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
  });

  describe('GPS_ACTUAL', () => {
    test('requiere precisionGpsM (positiva)', () => {
      [undefined, null, 0, -3, '10', NaN].forEach((p) => expect(v({ metodo: 'GPS_ACTUAL', precisionGpsM: p }).code).toBe('INVALID_PRECISION'));
    });
    test('hasta 50 m se acepta (50 incluido); la precision se guarda con 1 decimal', () => {
      expect(v({ metodo: 'GPS_ACTUAL', precisionGpsM: 50 }).valores.precisionGpsM).toBe(50);
      expect(v({ metodo: 'GPS_ACTUAL', precisionGpsM: 4.26 }).valores.precisionGpsM).toBe(4.3);
    });
    test('mas de 50 m se rechaza explicando el motivo y sin guardar', () => {
      const r = proponer({ metodo: 'GPS_ACTUAL', precisionGpsM: 50.1 });
      expect(r.code).toBe('PRECISION_INSUFICIENTE');
      expect(r.message).toMatch(/50 m/);
      expect(r.message).toMatch(/mapa/);
      expect(proponer({ metodo: 'GPS_ACTUAL', precisionGpsM: 120 }).code).toBe('PRECISION_INSUFICIENTE');
      expect(correcciones()).toHaveLength(0);
    });
  });

  describe('PUNTO_EN_MAPA', () => {
    test('precisionGpsM debe ser nula: con cualquier valor, INVALID_PRECISION', () => {
      [0, 5, 100, '5'].forEach((p) => expect(v({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: p }).code).toBe('INVALID_PRECISION'));
      expect(v({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: null }).ok).toBe(true);
      expect(v({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: undefined }).ok).toBe(true);
    });
  });

  describe('observacion', () => {
    test('hasta 300 caracteres; 301 se rechaza (no se trunca en silencio)', () => {
      expect(v({ observacion: 'a'.repeat(300) }).ok).toBe(true);
      expect(v({ observacion: 'a'.repeat(301) }).code).toBe('INVALID_OBSERVACION');
    });
    test('debe ser texto; se recorta y se limpian caracteres de control', () => {
      expect(v({ observacion: 5 }).code).toBe('INVALID_OBSERVACION');
      expect(v({ observacion: '  boca del pozo\u0000\u0007 ' }).valores.observacion).toBe('boca del pozo');
      expect(v({ observacion: null }).valores.observacion).toBe('');
    });
    test('un texto que empieza con "=" se conserva tal cual (la hoja lo guarda como texto)', () => {
      expect(v({ observacion: '=HYPERLINK("x")' }).valores.observacion).toBe('=HYPERLINK("x")');
    });
  });
});

describe('snapshot de la ubicacion de Irrigacion (lo toma el backend)', () => {
  test('unica: coordenada, estado, fuente y periodo del padron', () => {
    expect(S.ubicacionCorreccionService_snapshotIrrigacion(W)).toEqual({
      ok: true, snapshot: { irrLat: -32.9, irrLon: -68.8, irrEstado: 'unica', irrFuente: 'reportePozos', padronPeriodo: '2026-09' }
    });
  });

  test('corroborada: sin campo fuente en el padron -> VARIAS_FUENTES', () => {
    ubicacion[W] = { estado: 'corroborada', x: 1, y: 2, lat: -32.91, lon: -68.81, distanciaCorroboracion: 3 };
    const s = S.ubicacionCorreccionService_snapshotIrrigacion(W).snapshot;
    expect(s).toMatchObject({ irrLat: -32.91, irrLon: -68.81, irrEstado: 'corroborada', irrFuente: 'VARIAS_FUENTES' });
  });

  test.each(['dudosoLeve', 'revisar', 'revisarGrave', 'sinCoordenadas'])('%s: no hay "la" coordenada oficial -> lat/lon nulos, el estado queda registrado', (estado) => {
    ubicacion[W] = { estado, distanciaMaxima: 700 };
    expect(S.ubicacionCorreccionService_snapshotIrrigacion(W).snapshot).toMatchObject({ irrLat: null, irrLon: null, irrEstado: estado });
  });

  test('un registro sin ubicacionResuelta cuenta como sinCoordenadas', () => {
    global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: { wellId: W } }));
    expect(S.ubicacionCorreccionService_snapshotIrrigacion(W).snapshot).toMatchObject({ irrLat: null, irrEstado: 'sinCoordenadas' });
  });

  test('pozo inexistente en el padron: WELL_NOT_FOUND (fail-closed)', () => {
    expect(S.ubicacionCorreccionService_snapshotIrrigacion('04-0001')).toMatchObject({ ok: false, code: 'WELL_NOT_FOUND' });
  });

  test('sin metadata del padron (o con error al leerla) el periodo queda vacio, pero la propuesta no se cae', () => {
    global.registryService_getMetadata = jest.fn(() => ({ found: false }));
    expect(S.ubicacionCorreccionService_snapshotIrrigacion(W).snapshot.padronPeriodo).toBe('');
    global.registryService_getMetadata = jest.fn(() => { throw new Error('Drive'); });
    expect(S.ubicacionCorreccionService_snapshotIrrigacion(W).snapshot.padronPeriodo).toBe('');
  });
});

describe('proponer', () => {
  test('crea la correccion + el evento PROPUESTA y devuelve la vista (sin emails)', () => {
    const r = proponer({ observacion: 'Boca del pozo corrida' }, 'Ana@X.com');
    expect(r.ok).toBe(true);
    expect(r.duplicada).toBe(false);
    expect(r.correccion).toMatchObject({
      wellId: W, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'Boca del pozo corrida', nombrePropone: 'Ana',
      estado: 'PROPUESTA', resolucion: null, propia: true, advertenciaDistancia: false,
      irrigacion: { lat: -32.9, lon: -68.8, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' }
    });
    expect(r.correccion.distanciaM).toBeGreaterThan(75);
    expect(r.correccion.distanciaM).toBeLessThan(85);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
    expect(eventos()[0].slice(2, 4)).toEqual(['PROPUESTA', 'ana@x.com']);
    expect(r.correccion.correccionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('guarda las columnas exactas de la hoja (emailPropone normalizado, clientRequestId, snapshot, distancia)', () => {
    const d = datos({ metodo: 'GPS_ACTUAL', precisionGpsM: 8.4, observacion: 'ok' });
    S.ubicacionCorreccionService_proponer('Ana@X.com', 'Ana', W, d);
    const cols = Repo.UBICACION_CORRECCIONES_COLUMNAS;
    const celda = (n) => correcciones()[0][cols.indexOf(n)];
    expect(celda('wellId')).toBe(W);
    expect(celda('metodo')).toBe('GPS_ACTUAL');
    expect(celda('precisionGpsM')).toBe(8.4);
    expect(celda('emailPropone')).toBe('ana@x.com');
    expect(celda('nombrePropone')).toBe('Ana');
    expect(celda('clientRequestId')).toBe(d.clientRequestId);
    expect(celda('irrLat')).toBe(-32.9);
    expect(celda('irrEstado')).toBe('unica');
    expect(celda('padronPeriodo')).toBe('2026-09');
    expect(celda('timestamp')).toBeInstanceOf(Date);
    expect(celda('advertenciaDistancia')).toBe('');
  });

  test('lo que mande el cliente sobre el snapshot NO se usa: manda lo que dice el padron', () => {
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, Object.assign(datos(), { irrLat: 1, irrLon: 2, irrEstado: 'corroborada', irrFuente: 'x', padronPeriodo: '1999-01', distanciaM: 0, estado: 'VALIDADA' }));
    expect(r.correccion.irrigacion).toEqual({ lat: -32.9, lon: -68.8, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' });
    expect(r.correccion.distanciaM).toBeGreaterThan(75);
    expect(r.correccion.estado).toBe('PROPUESTA');
  });

  test('la distancia la calcula el servidor (el padron cambia -> cambia la distancia)', () => {
    ubicacion[W] = Object.assign({}, OFICIAL, { lat: norte(60).lat });
    const r = proponer();
    expect(r.correccion.distanciaM).toBeGreaterThan(15);
    expect(r.correccion.distanciaM).toBeLessThan(25);
  });

  describe('distancia respecto de Irrigacion', () => {
    test('hasta 250 m: observacion opcional', () => {
      const p = norte(200);
      const r = proponer({ lat: p.lat, lon: p.lon, observacion: '' });
      expect(r.ok).toBe(true);
      expect(r.correccion.advertenciaDistancia).toBe(false);
    });

    test('mas de 250 m sin observacion: OBSERVACION_REQUERIDA (con la distancia calculada) y no se guarda nada', () => {
      const p = norte(300);
      const r = proponer({ lat: p.lat, lon: p.lon, observacion: '   ' });
      expect(r.ok).toBe(false);
      expect(r.code).toBe('OBSERVACION_REQUERIDA');
      expect(r.distanciaM).toBeGreaterThan(295);
      expect(r.distanciaM).toBeLessThan(305);
      expect(correcciones()).toHaveLength(0);
      expect(eventos()).toHaveLength(0);
    });

    test('mas de 250 m con observacion: se guarda', () => {
      const p = norte(300);
      expect(proponer({ lat: p.lat, lon: p.lon, observacion: 'El pozo esta en otro lote' }).ok).toBe(true);
    });

    test('hasta 1 km: sin advertencia fuerte; mas de 1 km: se permite pero con advertencia (guardada)', () => {
      const cerca = norte(900);
      expect(proponer({ lat: cerca.lat, lon: cerca.lon, observacion: 'motivo' }).correccion.advertenciaDistancia).toBe(false);
      const lejos = norte(1200);
      const r = proponer({ lat: lejos.lat, lon: lejos.lon, observacion: 'La coordenada historica estaba mal' });
      expect(r.ok).toBe(true);
      expect(r.correccion.advertenciaDistancia).toBe(true);
      expect(r.correccion.distanciaM).toBeGreaterThan(1190);
      const cols = Repo.UBICACION_CORRECCIONES_COLUMNAS;
      expect(correcciones()[1][cols.indexOf('advertenciaDistancia')]).toBe('SI');
    });

    test('NO hay maximo duro: 30 km (todavia dentro de Mendoza) se permite con observacion y advertencia', () => {
      const r = proponer({ lat: OFICIAL.lat - 0.27, lon: OFICIAL.lon, observacion: 'Coordenada historica totalmente equivocada' });
      expect(r.ok).toBe(true);
      expect(r.correccion.distanciaM).toBeGreaterThan(29000);
      expect(r.correccion.advertenciaDistancia).toBe(true);
    });
  });

  describe('pozo sin coordenada de Irrigacion', () => {
    test.each(['sinCoordenadas', 'revisar', 'revisarGrave', 'dudosoLeve'])('%s: se puede proponer, distanciaM nula y sin observacion obligatoria', (estado) => {
      ubicacion[W] = { estado };
      const r = proponer({ lat: -34, lon: -69, observacion: '' });
      expect(r.ok).toBe(true);
      expect(r.correccion.distanciaM).toBeNull();
      expect(r.correccion.advertenciaDistancia).toBe(false);
      expect(r.correccion.irrigacion).toMatchObject({ lat: null, lon: null, estado });
      const cols = Repo.UBICACION_CORRECCIONES_COLUMNAS;
      expect(correcciones()[0][cols.indexOf('distanciaM')]).toBe('');
      expect(correcciones()[0][cols.indexOf('irrLat')]).toBe('');
    });
  });

  test('pozo que no existe en el padron: WELL_NOT_FOUND y no se escribe nada', () => {
    const r = proponer({}, 'ana@x.com', 'Ana', '04-0001');
    expect(r).toMatchObject({ ok: false, code: 'WELL_NOT_FOUND' });
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
  });

  test('si el padron no se puede leer, se propaga el error (fail-closed, no se guarda nada)', () => {
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('Drive caido'); });
    expect(() => proponer()).toThrow('Drive caido');
    expect(correcciones()).toHaveLength(0);
  });

  test('varias propuestas pendientes para el mismo pozo pueden coexistir', () => {
    propuesta();
    propuesta({}, 'beto@x.com');
    expect(S.ubicacionCorreccionService_getPorPozo('x@x.com', W).pendientes).toHaveLength(2);
  });
});

describe('idempotencia por clientRequestId', () => {
  test('repetir la MISMA solicitud no crea otra correccion: devuelve la primera (duplicada:true)', () => {
    const d = datos({ observacion: 'ok' });
    const a = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    const b = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(a.duplicada).toBe(false);
    expect(b.ok).toBe(true);
    expect(b.duplicada).toBe(true);
    expect(b.correccion.correccionId).toBe(a.correccion.correccionId);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('el reintento es identico aunque el email venga con otras mayusculas', () => {
    const d = datos();
    const a = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(S.ubicacionCorreccionService_proponer(' ANA@x.com ', 'Ana', W, d).correccion.correccionId).toBe(a.correccion.correccionId);
    expect(correcciones()).toHaveLength(1);
  });

  test('el reintento NO vuelve a leer el padron ni se rompe si el padron cambio (la distancia ya no exigiria lo mismo)', () => {
    const d = datos();
    S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    global.registryService_getWellLocation.mockClear();
    ubicacion[W] = Object.assign({}, OFICIAL, { lat: OFICIAL.lat + 0.05 });   // ahora estaria a ~5 km: pediria observacion
    const b = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(b.ok).toBe(true);
    expect(b.duplicada).toBe(true);
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('otro usuario con el mismo clientRequestId es otra solicitud', () => {
    const d = datos();
    S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    const r = S.ubicacionCorreccionService_proponer('beto@x.com', 'Beto', W, d);
    expect(r.duplicada).toBe(false);
    expect(correcciones()).toHaveLength(2);
  });

  test('el mismo clientRequestId con OTRO contenido: IDEMPOTENCY_CONFLICT y nada nuevo', () => {
    const d = datos();
    S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    const otro = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, Object.assign({}, d, { lat: norte(150).lat }));
    expect(otro).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const otroPozo = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', OTRO_POZO, d);
    expect(otroPozo).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(correcciones()).toHaveLength(1);
  });
});

// Falla UNA vez la escritura en la hoja indicada (simula un corte de red / de Sheets entre las dos escrituras)
function fallarProximaEscrituraEn(nombreHoja) {
  const hoja = hojas[nombreHoja];
  const original = hoja.getRange.bind(hoja);
  let fallo = false;
  hoja.getRange = (f, c, nf, nc) => {
    const r = original(f, c, nf, nc);
    return Object.assign({}, r, {
      setValues: (v) => {
        if (!fallo) { fallo = true; throw new Error('Sheets rechazo la escritura en ' + nombreHoja); }
        return r.setValues(v);
      }
    });
  };
  return () => fallo;
}
const eventosDe2 = (id) => eventos().filter((f) => f[0] === id);

describe('escritura parcial: corte entre la correccion y su evento PROPUESTA', () => {
  test('creacion normal: la fila de la correccion y su evento inicial PROPUESTA (orden: primero la correccion)', () => {
    const r = proponer();
    expect(correcciones()).toHaveLength(1);
    expect(eventosDe2(r.correccion.correccionId).map((f) => f[2])).toEqual(['PROPUESTA']);
    expect(r.curada).toBe(false);
  });

  test('un corte tras escribir la correccion la deja INCONSISTENTE: NO es una propuesta valida (ni pendiente, ni vigente)', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos({ observacion: 'ok' });
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow(/Sheets rechazo/);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(0);
    const id = correcciones()[0][0];

    const pozo = S.ubicacionCorreccionService_getPorPozo('val@x.com', W);
    expect(pozo.pendientes).toEqual([]);
    expect(pozo.vigente).toBeNull();
    expect(pozo.historial.map((c) => [c.correccionId, c.estado])).toEqual([[id, 'INCONSISTENTE']]);
    expect(pozo.historial[0].resolucion).toBeNull();
    const cola = S.ubicacionCorreccionService_getPendientes('val@x.com');
    expect(cola.pendientes).toEqual([]);
    expect(cola.total).toBe(0);
    expect(cola.inconsistentes).toBe(1);
  });

  test('una correccion INCONSISTENTE no se puede validar, rechazar ni revertir (fail-closed) y no se escribe nada', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    expect(() => proponer()).toThrow();
    const id = correcciones()[0][0];
    [validar(id), rechazar(id, 'x'), revertir(id, 'x')].forEach((r) => {
      expect(r).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE', wellId: W });
    });
    expect(eventos()).toHaveLength(0);
  });

  test('el reintento con el MISMO clientRequestId AUTOCURA: agrega el PROPUESTA faltante, sin duplicar la correccion', () => {
    const lock = instalarLock();
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos({ observacion: 'ok' });
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    const id = correcciones()[0][0];
    const momentoOriginal = hojas.UbicacionCorrecciones.filas[1][Repo.UBICACION_CORRECCIONES_COLUMNAS.indexOf('timestamp')];

    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(r.ok).toBe(true);
    expect(r.duplicada).toBe(true);
    expect(r.curada).toBe(true);
    expect(r.correccion.correccionId).toBe(id);
    expect(r.correccion.estado).toBe('PROPUESTA');
    expect(correcciones()).toHaveLength(1);                                   // no se duplico la correccion
    const evs = eventosDe2(id);
    expect(evs).toHaveLength(1);
    expect(evs[0][2]).toBe('PROPUESTA');
    expect(evs[0][3]).toBe('ana@x.com');
    expect(evs[0][5]).toMatch(/completado por un reintento/);                 // queda constancia del autocurado
    expect(evs[0][1]).toEqual(momentoOriginal);                               // con la fecha ORIGINAL de la propuesta
    expect(lock.releases).toBe(lock.waits);
    // y ahora si es una propuesta valida
    expect(S.ubicacionCorreccionService_getPendientes('val@x.com').pendientes.map((c) => c.correccionId)).toEqual([id]);
    expect(validar(id).ok).toBe(true);
  });

  test('despues del autocurado, un nuevo reintento es un reenvio idempotente normal (curada:false) y no escribe nada', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    expect(S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d).curada).toBe(true);
    const filas = [correcciones().length, eventos().length];
    const otra = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(otra).toMatchObject({ ok: true, duplicada: true, curada: false });
    expect([correcciones().length, eventos().length]).toEqual(filas);
  });

  test('el autocurado no vuelve a leer el padron ni exige de nuevo la observacion (la correccion ya tiene su snapshot)', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const lejos = norte(400);
    const d = datos({ lat: lejos.lat, lon: lejos.lon, observacion: 'motivo' });
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    global.registryService_getWellLocation.mockClear();
    ubicacion[W] = { estado: 'sinCoordenadas' };                               // el padron cambio entretanto
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(r.curada).toBe(true);
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
    expect(r.correccion.irrigacion).toMatchObject({ estado: 'unica', lat: -32.9 });    // sigue el snapshot original
  });

  test('si el reintento tambien falla, sigue INCONSISTENTE y sin duplicados; el siguiente reintento cura', () => {
    const fallo = fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    expect(fallo()).toBe(true);
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');                      // el log sigue fallando una vez mas
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(0);
    expect(S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d).curada).toBe(true);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('NO se cura una solicitud distinta: mismo clientRequestId con otro contenido = IDEMPOTENCY_CONFLICT y no se escribe', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, Object.assign({}, d, { lat: norte(150).lat }));
    expect(r).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(eventos()).toHaveLength(0);
  });

  test('otro usuario NO cura la correccion ajena: crea la suya y la inconsistente queda inconsistente', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    const r = S.ubicacionCorreccionService_proponer('beto@x.com', 'Beto', W, d);
    expect(r.duplicada).toBe(false);
    expect(correcciones()).toHaveLength(2);
    const estados = S.ubicacionCorreccionService_getPorPozo('x@x.com', W).historial.map((c) => c.estado).sort();
    expect(estados).toEqual(['INCONSISTENTE', 'PROPUESTA']);
  });

  test('un corte en la PRIMERA escritura no deja nada: el reintento crea la correccion normalmente', () => {
    fallarProximaEscrituraEn('UbicacionCorrecciones');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    expect(correcciones()).toHaveLength(0);
    expect(eventos()).toHaveLength(0);
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(r).toMatchObject({ ok: true, duplicada: false, curada: false });
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('reduccion de la ventana: si la hoja de LOG no existe o tiene el esquema roto, falla ANTES de escribir la correccion', () => {
    delete hojas.UbicacionCorreccionesLog;
    global.SpreadsheetApp = {
      openById: () => ({ getSheetByName: (nombre) => hojas[nombre] || null, insertSheet: () => { throw new Error('no deberia crearse'); } }),
      flush: () => {}
    };
    expect(() => proponer()).toThrow(/UbicacionCorreccionesLog/);
    expect(correcciones()).toHaveLength(0);
    // esquema roto: falta una columna del log
    hojas.UbicacionCorreccionesLog = { filas: [['correccionId', 'evento']], getLastColumn: () => 2, getRange: () => ({ getValues: () => [['correccionId', 'evento']] }), getDataRange: () => ({ getValues: () => [['correccionId', 'evento']] }) };
    expect(() => proponer()).toThrow(/no tiene las columnas/);
    expect(correcciones()).toHaveLength(0);
  });

  test('un corte NO es atomico entre hojas: el codigo no lo disimula (la correccion queda escrita hasta el reintento)', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    expect(() => proponer()).toThrow();
    expect(correcciones()).toHaveLength(1);                                   // evidencia honesta: hay una fila sin evento
  });

  test('un reintento concurrente: otra ejecucion cura primero mientras se espera el lock -> no se duplica el evento', () => {
    fallarProximaEscrituraEn('UbicacionCorreccionesLog');
    const d = datos();
    expect(() => S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d)).toThrow();
    const id = correcciones()[0][0];
    instalarLock((n) => {
      if (n === 1) {
        Repo.ubicacionCorreccionRepository_agregarEventos([{ correccionId: id, timestamp: new Date(), evento: 'PROPUESTA', email: 'ana@x.com', nombre: 'Ana', motivo: 'otra ejecucion' }]);
      }
    });
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(r).toMatchObject({ ok: true, duplicada: true, curada: false });
    expect(eventosDe2(id)).toHaveLength(1);
  });
});

describe('log inconsistente (fail-closed)', () => {
  test('un log con eventos pero invalido: el reintento NO lo toca y responde INCONSISTENT_STATE', () => {
    const d = datos();
    const a = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    Repo.ubicacionCorreccionRepository_agregarEventos([{ correccionId: a.correccion.correccionId, timestamp: new Date(), evento: 'PROPUESTA', email: 'x', nombre: 'x', motivo: 'doble' }]);
    const antes = eventos().length;
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(r).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE', wellId: W });
    expect(eventos()).toHaveLength(antes);
  });
});

describe('concurrencia (LockService)', () => {
  test('proponer toma el lock una vez, lee y escribe dentro, y lo libera', () => {
    const lock = instalarLock();
    proponer();
    expect(lock).toEqual({ waits: 1, releases: 1 });
  });

  test('carrera: otra ejecucion guarda la MISMA solicitud mientras se espera el lock -> no se duplica (duplicada:true)', () => {
    const d = datos({ observacion: 'ok' });
    let ajena = null;
    instalarLock((n) => {
      if (n !== 1) { return; }
      // la "otra ejecucion" escribio la misma solicitud mientras esta esperaba el lock
      const base = S.ubicacionCorreccionService_validarPropuesta(d).valores;
      ajena = {
        correccionId: '11111111-1111-4111-8111-111111111111', wellId: W, lat: base.lat, lon: base.lon, metodo: base.metodo, precisionGpsM: null, observacion: 'ok',
        emailPropone: 'ana@x.com', nombrePropone: 'Ana', timestamp: new Date(), irrLat: -32.9, irrLon: -68.8, irrEstado: 'unica', irrFuente: 'reportePozos',
        padronPeriodo: '2026-09', distanciaM: 80, advertenciaDistancia: false, clientRequestId: d.clientRequestId
      };
      Repo.ubicacionCorreccionRepository_agregarCorreccion(ajena);
      Repo.ubicacionCorreccionRepository_agregarEventos([{ correccionId: ajena.correccionId, timestamp: new Date(), evento: 'PROPUESTA', email: 'ana@x.com', nombre: 'Ana', motivo: '' }]);
    });
    const r = S.ubicacionCorreccionService_proponer('ana@x.com', 'Ana', W, d);
    expect(ajena).not.toBeNull();
    expect(r.duplicada).toBe(true);
    expect(r.correccion.correccionId).toBe(ajena.correccionId);
    expect(correcciones()).toHaveLength(1);
    expect(eventos()).toHaveLength(1);
  });

  test('el lock se libera aunque la escritura falle (Sheets rechaza)', () => {
    const lock = instalarLock();
    const original = hojas.UbicacionCorrecciones.getRange.bind(hojas.UbicacionCorrecciones);
    hojas.UbicacionCorrecciones.getRange = (f, c, nf, nc) => {
      const r = original(f, c, nf, nc);
      return Object.assign({}, r, { setValues: () => { throw new Error('Sheets rechazo la escritura'); } });
    };
    expect(() => proponer()).toThrow('Sheets rechazo');
    expect(lock).toEqual({ waits: 1, releases: 1 });
    expect(eventos()).toHaveLength(0);
  });

  test('validar/rechazar/revertir tambien lo toman y lo liberan', () => {
    const id = propuesta();
    const lock = instalarLock();
    validar(id);
    revertir(id, 'error de carga');
    expect(lock).toEqual({ waits: 2, releases: 2 });
  });

  test('carrera: dos validadores sobre la MISMA propuesta -> solo el primero gana, el segundo recibe INVALID_TRANSITION', () => {
    const id = propuesta();
    instalarLock((n) => {
      if (n === 1) {
        // otro validador se adelanto mientras este esperaba el lock
        Repo.ubicacionCorreccionRepository_agregarEventos([{ correccionId: id, timestamp: new Date(), evento: 'VALIDADA', email: 'otro@x.com', nombre: 'Otro', motivo: '' }]);
      }
    });
    const r = validar(id);
    expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION', wellId: W });
    expect(eventosDe(id)).toEqual(['PROPUESTA', 'VALIDADA']);
  });

  test('carrera: otra propuesta del mismo pozo se valida mientras se espera el lock -> al validar esta, la otra queda SUPERADA (una sola vigente)', () => {
    const a = propuesta({}, 'ana@x.com');
    const b = propuesta({}, 'beto@x.com');
    instalarLock((n) => {
      if (n === 1) {
        Repo.ubicacionCorreccionRepository_agregarEventos([{ correccionId: b, timestamp: new Date(), evento: 'VALIDADA', email: 'otro@x.com', nombre: 'Otro', motivo: '' }]);
      }
    });
    expect(validar(a).ok).toBe(true);
    const estado = S.ubicacionCorreccionService_getPorPozo('x@x.com', W);
    expect(estado.vigente.correccionId).toBe(a);
    expect(estado.historial.filter((c) => c.estado === 'VALIDADA')).toHaveLength(1);
    expect(estado.historial.find((c) => c.correccionId === b).estado).toBe('SUPERADA');
  });
});

describe('estado derivado del log', () => {
  const corr = (id) => ({ correccionId: id, wellId: W, emailPropone: 'a@x.com', timestamp: '2026-10-01T00:00:00.000Z' });
  const estados = (correcciones, eventos) => S.ubicacionCorreccionService_derivar(correcciones, eventos).map((c) => c.estado);
  const ev = (id, evento) => ({ correccionId: id, evento });

  test('el estado es el ULTIMO evento de una cadena valida', () => {
    expect(estados([corr('b')], [ev('b', 'PROPUESTA'), ev('b', 'VALIDADA'), ev('b', 'REVERTIDA')])).toEqual(['REVERTIDA']);
    expect(estados([corr('b')], [ev('b', 'PROPUESTA'), ev('b', 'VALIDADA'), ev('b', 'SUPERADA')])).toEqual(['SUPERADA']);
    expect(estados([corr('b')], [ev('b', 'PROPUESTA'), ev('b', 'RECHAZADA')])).toEqual(['RECHAZADA']);
    expect(estados([corr('b')], [ev('b', 'PROPUESTA')])).toEqual(['PROPUESTA']);
  });

  test('SIN eventos: INCONSISTENTE (nunca se supone PROPUESTA)', () => {
    expect(estados([corr('a'), corr('b')], [ev('b', 'PROPUESTA')])).toEqual(['INCONSISTENTE', 'PROPUESTA']);
    expect(estados([corr('a')], [])).toEqual(['INCONSISTENTE']);
    expect(estados([corr('a')], undefined)).toEqual(['INCONSISTENTE']);
  });

  test.each([
    ['no empieza con PROPUESTA', [['VALIDADA']]],
    ['dos PROPUESTA', [['PROPUESTA', 'PROPUESTA']]],
    ['salto imposible (RECHAZADA -> VALIDADA)', [['PROPUESTA', 'RECHAZADA', 'VALIDADA']]],
    ['salto imposible (PROPUESTA -> REVERTIDA)', [['PROPUESTA', 'REVERTIDA']]],
    ['despues de un estado terminal', [['PROPUESTA', 'VALIDADA', 'REVERTIDA', 'PROPUESTA']]],
    ['evento de tipo desconocido', [['PROPUESTA', 'BORRADA']]]
  ])('cadena invalida (%s): INCONSISTENTE', (n, [cadena]) => {
    expect(estados([corr('a')], cadena.map((e) => ev('a', e)))).toEqual(['INCONSISTENTE']);
  });

  test('una cadena invalida no se vuelve vigente aunque su ultimo evento sea VALIDADA', () => {
    const id = propuesta();
    Repo.ubicacionCorreccionRepository_agregarEventos([ev2(id, 'VALIDADA'), ev2(id, 'VALIDADA')]);
    const pozo = S.ubicacionCorreccionService_getPorPozo('x@x.com', W);
    expect(pozo.vigente).toBeNull();
    expect(pozo.historial[0].estado).toBe('INCONSISTENTE');
    function ev2(cid, evento) { return { correccionId: cid, timestamp: new Date(), evento, email: 'v@x.com', nombre: 'V', motivo: '' }; }
  });

  test('eventos de una correccion que no existe en la hoja se ignoran', () => {
    expect(estados([corr('a')], [ev('a', 'PROPUESTA'), ev('zzz', 'VALIDADA'), ev('zzz', 'BORRADA')])).toEqual(['PROPUESTA']);
  });
});

describe('validar / rechazar / revertir', () => {
  test('validar una PROPUESTA: pasa a VALIDADA y la vista trae quien la valido (nombre) y cuando', () => {
    const id = propuesta();
    const r = validar(id, 'val@x.com', 'Verificado en campo');
    expect(r.ok).toBe(true);
    expect(r.supersedidas).toEqual([]);
    expect(r.correccion.estado).toBe('VALIDADA');
    expect(r.correccion.resolucion).toMatchObject({ evento: 'VALIDADA', nombre: 'Valeria', motivo: 'Verificado en campo' });
    expect(r.correccion.resolucion.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(eventosDe(id)).toEqual(['PROPUESTA', 'VALIDADA']);
  });

  test('el motivo es opcional al validar y obligatorio al rechazar y al revertir', () => {
    const id = propuesta();
    expect(rechazar(id, '').code).toBe('INVALID_MOTIVO');
    expect(rechazar(id, '   ').code).toBe('INVALID_MOTIVO');
    expect(rechazar(id, undefined).code).toBe('INVALID_MOTIVO');
    expect(validar(id).ok).toBe(true);
    expect(revertir(id, '').code).toBe('INVALID_MOTIVO');
    expect(revertir(id, 'x'.repeat(301)).code).toBe('INVALID_MOTIVO');
    expect(revertir(id, 'se cargo mal').ok).toBe(true);
  });

  test('rechazar una PROPUESTA -> RECHAZADA (terminal)', () => {
    const id = propuesta();
    const r = rechazar(id, 'La coordenada no coincide con la boca del pozo');
    expect(r.correccion.estado).toBe('RECHAZADA');
    expect(r.correccion.resolucion.motivo).toMatch(/no coincide/);
    expect(validar(id).code).toBe('INVALID_TRANSITION');
    expect(rechazar(id, 'otra vez').code).toBe('INVALID_TRANSITION');
    expect(revertir(id, 'x').code).toBe('INVALID_TRANSITION');
  });

  test('revertir solo una VALIDADA; la deja REVERTIDA (terminal)', () => {
    const id = propuesta();
    expect(revertir(id, 'x').code).toBe('INVALID_TRANSITION');           // todavia es PROPUESTA
    validar(id);
    const r = revertir(id, 'Se valido por error');
    expect(r.ok).toBe(true);
    expect(r.correccion.estado).toBe('REVERTIDA');
    expect(S.ubicacionCorreccionService_getPorPozo('x@x.com', W).vigente).toBeNull();
    expect(validar(id).code).toBe('INVALID_TRANSITION');
    expect(rechazar(id, 'x').code).toBe('INVALID_TRANSITION');
    expect(revertir(id, 'x').code).toBe('INVALID_TRANSITION');
  });

  test.each([['validar', validar], ['rechazar', (id) => rechazar(id, 'm')], ['revertir', (id) => revertir(id, 'm')]])('%s sobre una VALIDADA: validar y rechazar son transiciones invalidas; revertir es la valida', (n, fn) => {
    const id = propuesta();
    validar(id);
    const r = fn(id);
    if (n === 'revertir') { expect(r.ok).toBe(true); } else { expect(r).toMatchObject({ ok: false, code: 'INVALID_TRANSITION', wellId: W }); }
  });

  test('una transicion invalida no escribe nada', () => {
    const id = propuesta();
    rechazar(id, 'no');
    const antes = eventos().length;
    expect(validar(id).ok).toBe(false);
    expect(revertir(id, 'x').ok).toBe(false);
    expect(eventos()).toHaveLength(antes);
  });

  test('correccionId invalido o inexistente', () => {
    ['', null, undefined, 'abc', 123, '1234'].forEach((id) => expect(validar(id).code).toBe('INVALID_CORRECCION_ID'));
    expect(validar('99999999-9999-4999-8999-999999999999')).toMatchObject({ ok: false, code: 'CORRECCION_NOT_FOUND' });
  });

  describe('quien propone no puede validar su propia propuesta', () => {
    test('SELF_VALIDATION (aunque cambien mayusculas/espacios del email) y no se escribe nada', () => {
      const id = propuesta({}, 'ana@x.com');
      ['ana@x.com', 'ANA@X.COM', '  Ana@x.com '].forEach((email) => {
        expect(validar(id, email)).toMatchObject({ ok: false, code: 'SELF_VALIDATION', wellId: W });
      });
      expect(eventosDe(id)).toEqual(['PROPUESTA']);
    });

    test('otro usuario si puede validarla', () => {
      const id = propuesta({}, 'ana@x.com');
      expect(validar(id, 'otro@x.com').ok).toBe(true);
    });

    test('quien propone TAMPOCO puede rechazarla (SELF_REJECTION): RECHAZADA es de quien valida; no se escribe nada', () => {
      const id = propuesta({}, 'ana@x.com');
      ['ana@x.com', 'ANA@X.COM', '  Ana@x.com '].forEach((email) => {
        expect(rechazar(id, 'Me equivoque de punto', email)).toMatchObject({ ok: false, code: 'SELF_REJECTION', wellId: W });
      });
      expect(eventosDe(id)).toEqual(['PROPUESTA']);
      expect(S.ubicacionCorreccionService_getPendientes('x@x.com').pendientes.map((c) => c.correccionId)).toEqual([id]);
    });

    test('ni siquiera con ubicacion_validar: quien valida pero tambien propuso no rechaza la suya; otro validador si', () => {
      const id = propuesta({}, 'carla@x.com');
      expect(rechazar(id, 'x', 'carla@x.com').code).toBe('SELF_REJECTION');
      expect(rechazar(id, 'La coordenada no coincide', 'val@x.com').ok).toBe(true);
    });

    test('no existe el evento RETIRADA (queda para una etapa futura, como evento separado)', () => {
      expect(S.UBICACION_CORR_EVENTOS).not.toContain('RETIRADA');
    });

    test('si no es PROPUESTA, la transicion invalida se informa antes que la auto-validacion', () => {
      const id = propuesta({}, 'ana@x.com');
      rechazar(id, 'x', 'otro@x.com');
      expect(validar(id, 'ana@x.com').code).toBe('INVALID_TRANSITION');
      expect(rechazar(id, 'x', 'ana@x.com').code).toBe('INVALID_TRANSITION');
    });
  });

  describe('SUPERADA: una sola validada vigente por pozo', () => {
    test('validar una nueva marca SUPERADA a la anterior ANTES de registrar VALIDADA, en filas contiguas del log', () => {
      const a = propuesta({}, 'ana@x.com');
      const b = propuesta({}, 'beto@x.com');
      validar(a);
      const r = validar(b);
      expect(r.supersedidas).toEqual([a]);
      expect(r.correccion.estado).toBe('VALIDADA');
      const log = eventos().map((f) => [f[0], f[2]]);
      const ultimos = log.slice(-2);
      expect(ultimos).toEqual([[a, 'SUPERADA'], [b, 'VALIDADA']]);
      const porPozo = S.ubicacionCorreccionService_getPorPozo('x@x.com', W);
      expect(porPozo.vigente.correccionId).toBe(b);
      expect(porPozo.historial.find((c) => c.correccionId === a)).toMatchObject({ estado: 'SUPERADA' });
      expect(porPozo.historial.find((c) => c.correccionId === a).resolucion.motivo).toContain(b);
    });

    test('la SUPERADA es terminal (no se puede revertir ni volver a validar)', () => {
      const a = propuesta({}, 'ana@x.com');
      const b = propuesta({}, 'beto@x.com');
      validar(a);
      validar(b);
      expect(revertir(a, 'x').code).toBe('INVALID_TRANSITION');
      expect(validar(a).code).toBe('INVALID_TRANSITION');
    });

    test('revertir la vigente NO revive a la superada anterior', () => {
      const a = propuesta({}, 'ana@x.com');
      const b = propuesta({}, 'beto@x.com');
      validar(a);
      validar(b);
      revertir(b, 'x');
      const porPozo = S.ubicacionCorreccionService_getPorPozo('x@x.com', W);
      expect(porPozo.vigente).toBeNull();
      expect(porPozo.historial.find((c) => c.correccionId === a).estado).toBe('SUPERADA');
    });

    test('solo supera a la validada del MISMO pozo', () => {
      const a = propuesta({}, 'ana@x.com', W);
      const otro = propuesta({}, 'ana@x.com', OTRO_POZO);
      validar(otro);
      validar(a);
      expect(S.ubicacionCorreccionService_getPorPozo('x@x.com', OTRO_POZO).vigente.correccionId).toBe(otro);
      expect(S.ubicacionCorreccionService_getPorPozo('x@x.com', W).vigente.correccionId).toBe(a);
    });

    test('si por una inconsistencia hubiera mas de una VALIDADA del pozo, al validar quedan todas SUPERADAS menos la nueva', () => {
      const a = propuesta({}, 'ana@x.com');
      const b = propuesta({}, 'beto@x.com');
      const c = propuesta({}, 'carla@x.com');
      Repo.ubicacionCorreccionRepository_agregarEventos([
        { correccionId: a, timestamp: new Date(), evento: 'VALIDADA', email: 'v@x.com', nombre: 'V', motivo: '' },
        { correccionId: b, timestamp: new Date(), evento: 'VALIDADA', email: 'v@x.com', nombre: 'V', motivo: '' }
      ]);
      const r = validar(c);
      expect(r.supersedidas.sort()).toEqual([a, b].sort());
      expect(S.ubicacionCorreccionService_getPorPozo('x@x.com', W).historial.filter((x) => x.estado === 'VALIDADA').map((x) => x.correccionId)).toEqual([c]);
    });
  });
});

describe('REVERTIDA: motivo, registro del usuario y reversion por quien propuso', () => {
  const ultimoEvento = () => {
    const f = eventos()[eventos().length - 1];
    const c = Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS;
    return { correccionId: f[c.indexOf('correccionId')], timestamp: f[c.indexOf('timestamp')], evento: f[c.indexOf('evento')], email: f[c.indexOf('email')], nombre: f[c.indexOf('nombre')], motivo: f[c.indexOf('motivo')] };
  };

  test('el motivo es obligatorio: vacio, solo espacios o ausente = INVALID_MOTIVO y no se escribe nada', () => {
    const id = propuesta({}, 'ana@x.com');
    validar(id, 'val@x.com');
    const antes = eventos().length;
    ['', '   ', null, undefined].forEach((m) => {
      expect(S.ubicacionCorreccionService_revertir('val@x.com', 'Valeria', id, m)).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    });
    expect(eventos()).toHaveLength(antes);
  });

  test('registra usuario (email), nombre, fecha/hora y motivo en el log', () => {
    const id = propuesta({}, 'ana@x.com');
    validar(id, 'val@x.com');
    const r = S.ubicacionCorreccionService_revertir(' Val@X.com ', 'Valeria Gomez', id, '  Se valido el pozo equivocado  ');
    expect(r.ok).toBe(true);
    const e = ultimoEvento();
    expect(e).toMatchObject({ correccionId: id, evento: 'REVERTIDA', email: 'val@x.com', nombre: 'Valeria Gomez', motivo: 'Se valido el pozo equivocado' });
    expect(e.timestamp).toBeInstanceOf(Date);
    expect(r.correccion.resolucion).toMatchObject({ evento: 'REVERTIDA', nombre: 'Valeria Gomez', motivo: 'Se valido el pozo equivocado' });
    expect(r.correccion.resolucion.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('quien PROPUSO puede revertirla despues de que OTRO usuario la valido (no es auto-validacion)', () => {
    const id = propuesta({}, 'carla@x.com');
    expect(S.ubicacionCorreccionService_validar('carla@x.com', 'Carla', id).code).toBe('SELF_VALIDATION');
    expect(validar(id, 'val@x.com').ok).toBe(true);                                    // la valida otro usuario
    const r = S.ubicacionCorreccionService_revertir('carla@x.com', 'Carla', id, 'Fue un error mio, el punto no era ese');
    expect(r.ok).toBe(true);
    expect(r.correccion.estado).toBe('REVERTIDA');
    expect(ultimoEvento()).toMatchObject({ evento: 'REVERTIDA', email: 'carla@x.com', nombre: 'Carla', motivo: 'Fue un error mio, el punto no era ese' });
    expect(eventosDe(id)).toEqual(['PROPUESTA', 'VALIDADA', 'REVERTIDA']);
  });
});

describe('consultas', () => {
  test('getPorPozo: vigente, pendientes e historial (mas nuevo primero) solo del pozo pedido', () => {
    const a = propuesta({}, 'ana@x.com');
    const b = propuesta({}, 'beto@x.com');
    propuesta({}, 'ana@x.com', OTRO_POZO);
    validar(a);
    const r = S.ubicacionCorreccionService_getPorPozo('ana@x.com', W);
    expect(r.wellId).toBe(W);
    expect(r.vigente.correccionId).toBe(a);
    expect(r.pendientes.map((c) => c.correccionId)).toEqual([b]);
    expect(r.historial).toHaveLength(2);
    expect(r.historial.every((c) => c.wellId === W)).toBe(true);
  });

  test('getPorPozo de un pozo sin correcciones: todo vacio', () => {
    expect(S.ubicacionCorreccionService_getPorPozo('a@x.com', W)).toEqual({ wellId: W, vigente: null, pendientes: [], historial: [] });
  });

  test('"propia" distingue la correccion de quien consulta, sin exponer emails', () => {
    propuesta({}, 'ana@x.com');
    expect(S.ubicacionCorreccionService_getPorPozo('ana@x.com', W).pendientes[0].propia).toBe(true);
    expect(S.ubicacionCorreccionService_getPorPozo('beto@x.com', W).pendientes[0].propia).toBe(false);
  });

  test('getPendientes: solo PROPUESTA de toda la provincia, las mas viejas primero, con total', () => {
    const a = propuesta({}, 'ana@x.com', W);
    const b = propuesta({}, 'beto@x.com', OTRO_POZO);
    const c = propuesta({}, 'carla@x.com', W);
    validar(c, 'val@x.com');
    rechazar(b, 'no');
    const r = S.ubicacionCorreccionService_getPendientes('val@x.com');
    expect(r.total).toBe(1);
    expect(r.pendientes.map((x) => x.correccionId)).toEqual([a]);
  });

  test('getPendientes: tope de 200 filas pero total real', () => {
    for (let i = 0; i < 205; i++) {
      Repo.ubicacionCorreccionRepository_agregarCorreccion({
        correccionId: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), wellId: W, lat: -32.9, lon: -68.8, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null,
        observacion: '', emailPropone: 'x@x.com', nombrePropone: 'X', timestamp: new Date(2026, 0, 1, 0, 0, i), irrLat: null, irrLon: null, irrEstado: 'sinCoordenadas',
        irrFuente: '', padronPeriodo: '', distanciaM: null, advertenciaDistancia: false, clientRequestId: 'bulk-' + String(i).padStart(8, '0')
      });
      Repo.ubicacionCorreccionRepository_agregarEventos([{
        correccionId: '00000000-0000-4000-8000-' + String(i).padStart(12, '0'), timestamp: new Date(2026, 0, 1, 0, 0, i), evento: 'PROPUESTA', email: 'x@x.com', nombre: 'X', motivo: ''
      }]);
    }
    const r = S.ubicacionCorreccionService_getPendientes('val@x.com');
    expect(r.total).toBe(205);
    expect(r.pendientes).toHaveLength(200);
    expect(r.pendientes[0].correccionId.endsWith('000000000000')).toBe(true);   // la mas vieja primero
  });
});

describe('sin fuga de emails', () => {
  test('ninguna vista (propuesta, validacion, supersedida, consultas) contiene un email', () => {
    const a = proponer({ observacion: 'Fotografiado' }, 'ana.secreta@x.com');
    const b = proponer({}, 'beto.secreto@x.com');
    const v1 = validar(a.correccion.correccionId, 'valida.secreta@x.com');
    const v2 = validar(b.correccion.correccionId, 'valida.secreta@x.com');
    const todo = JSON.stringify([a, b, v1, v2,
      S.ubicacionCorreccionService_getPorPozo('ana.secreta@x.com', W),
      S.ubicacionCorreccionService_getPendientes('valida.secreta@x.com')]);
    expect(todo).not.toMatch(/@/);
    expect(todo).not.toMatch(/secret/);
    expect(todo).not.toContain('emailPropone');
  });

  test('las respuestas de error tampoco incluyen emails', () => {
    const id = propuesta({}, 'ana.secreta@x.com');
    expect(JSON.stringify(validar(id, 'ana.secreta@x.com'))).not.toMatch(/@/);
  });
});
