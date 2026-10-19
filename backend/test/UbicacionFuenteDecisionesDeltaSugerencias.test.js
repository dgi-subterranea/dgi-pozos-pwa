// El delta registral (E3-1) y las SUGERENCIAS: solo APROBAR una sugerencia escribe una decision (por el mismo nucleo autoritativo aplicarDecision) y por eso es lo unico que
// puede invalidar el delta; crear, rechazar o cancelar una sugerencia no escribe decisiones y no toca el delta. Y una sugerencia PENDIENTE no cambia el resultado.
const { armarSug, W, LEE, VAL, REP, I2, UNICA } = require('./sugerenciasHelper');

let t;
const U = '01-0012';
const K_COMPLETO = 'ufd_delta_v1';
const K_MARCA = 'ufd_delta_v1_inval';

beforeEach(() => { t = armarSug(); });
afterEach(() => { jest.restoreAllMocks(); });

const delta = () => { t.calmar(); return t.S.ubicacionFuenteDecisionesService_getDelta(); };
const deltaInvalidado = () => t.cache.remove.mock.calls.some((c) => c[0] === K_COMPLETO) || t.cache.put.mock.calls.some((c) => c[0] === K_MARCA);
const limpiar = () => { t.cache.remove.mockClear(); t.cache.put.mockClear(); };

test('una sugerencia PENDIENTE no cambia el delta (ni lo invalida)', () => {
  delta();
  limpiar();
  const r = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...REP });
  expect(r.ok).toBe(true);
  expect(deltaInvalidado()).toBe(false);
  expect(delta().decisiones).toEqual([]);
  expect(t.filasDec()).toHaveLength(0);
});

test('rechazar y cancelar una sugerencia no invalidan el delta ni escriben decisiones', () => {
  const a = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...REP });
  const b = t.sugerir({ wellId: W, accionSugerida: 'DESCARTAR', motivo: 'x', ...I2 });
  delta();
  limpiar();
  expect(t.rechazar(t.idDe(a)).ok).toBe(true);
  expect(t.cancelar(t.idDe(b)).ok).toBe(true);
  expect(deltaInvalidado()).toBe(false);
  expect(t.filasDec()).toHaveLength(0);
  expect(delta().decisiones).toEqual([]);
});

test('aprobar una sugerencia que CAMBIA el punto (aceptar) invalida el delta y el efecto se ve en la lectura siguiente', () => {
  const r = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...I2 });
  delta();
  limpiar();
  const ap = t.resolver(t.idDe(r));
  expect(ap.ok).toBe(true);
  expect(ap.resultado).toBe('APROBADA');
  expect(deltaInvalidado()).toBe(true);
  expect(t.cache.store[K_COMPLETO]).toBeUndefined();
  const d = delta();
  expect(d.decisiones).toHaveLength(1);
  expect(d.decisiones[0]).toMatchObject({ wellId: W, estado: 'R' });
});

test('aprobar el descarte de la unica fuente de un pozo -> invalida y el pozo queda N', () => {
  const r = t.sugerir({ wellId: U, accionSugerida: 'DESCARTAR', motivo: 'x', ...UNICA });
  delta();
  limpiar();
  expect(t.resolver(t.idDe(r), { versionVista: 0 }).ok).toBe(true);
  expect(deltaInvalidado()).toBe(true);
  expect(delta().decisiones).toEqual([{ wellId: U, estado: 'N' }]);
});

test('aprobar una sugerencia SIN efecto en el punto operativo escribe la decision pero NO invalida el delta', () => {
  const r = t.sugerir({ wellId: W, accionSugerida: 'DESCARTAR', motivo: 'x', ...I2 });      // descartar la lejana: sigue coincidente
  delta();
  limpiar();
  expect(t.resolver(t.idDe(r)).ok).toBe(true);
  expect(t.filasDec()).toHaveLength(1);
  expect(deltaInvalidado()).toBe(false);
  expect(delta().decisiones).toEqual([]);
});

test('el reintento idempotente de la aprobacion no vuelve a invalidar', () => {
  const r = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...I2 });
  const ap = t.resolver(t.idDe(r), { clientRequestId: 'req-aprobar-fijo-1', versionVista: 0 });
  expect(ap.ok).toBe(true);
  delta();
  limpiar();
  const otra = t.resolver(t.idDe(r), { clientRequestId: 'req-aprobar-fijo-1', versionVista: 0 });
  expect(otra.ok).toBe(true);
  expect(otra.duplicada).toBe(true);
  expect(deltaInvalidado()).toBe(false);
});

test('una aprobacion que queda OBSOLETA (la fuente cambio) no escribe decision y no invalida', () => {
  const r = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...I2 });
  t.padron[W].coordenadasProvincia[1] = { x: I2.x + 40, y: I2.y };                              // reindexado: la fuente ya no existe
  delta();
  limpiar();
  const ap = t.resolver(t.idDe(r));
  expect(ap.ok).toBe(true);
  expect(ap.resultado).toBe('OBSOLETA');
  expect(t.filasDec()).toHaveLength(0);
  expect(deltaInvalidado()).toBe(false);
});

const entradaEsperadaR = (w, f) => {
  const fu = t.Dominio.ufd_fuentesDePadron(w, t.padron[w]).fuentes.filter((x) => x.x === f.x && x.y === f.y)[0];
  return { wellId: w, estado: 'R', lat: fu.lat, lon: fu.lon };
};

test('aprobar una sugerencia produce EXACTAMENTE el delta que produce la decision directa equivalente (mismo nucleo)', () => {
  const r = t.sugerir({ wellId: W, accionSugerida: 'ACEPTAR', ...I2 });
  expect(t.resolver(t.idDe(r)).ok).toBe(true);
  expect(delta().decisiones).toEqual([entradaEsperadaR(W, I2)]);
});

test('la decision directa de un validador produce ese mismo delta', () => {
  expect(t.decidirDirecto('ACEPTAR', I2, { versionVista: 0 }).ok).toBe(true);
  expect(delta().decisiones).toEqual([entradaEsperadaR(W, I2)]);
  expect(VAL).toBeDefined();
  expect(LEE).toBeDefined();
});
