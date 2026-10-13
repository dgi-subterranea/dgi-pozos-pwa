// Logica pura de las correcciones de ubicacion (ficha del pozo): permisos, GPS, distancia/observacion, payload en lista blanca,
// flujo de guardado (sin doble envio, clientRequestId estable, resultado segun el backend, refresco posterior) y HTML de la seccion.
const L = require('./ubicacionCorreccionLogic');

const W = '14-0001';
// Caso real: pozo 14-0001, Irrigacion en (-33.34765, -69.14545) y una correccion VALIDADA a 22,2 m.
const IRR = { lat: -33.34765, lon: -69.14545 };
const PUNTO_REAL = { lat: -33.34745, lon: -69.14545 };
const norte = (grados) => ({ lat: Math.round((IRR.lat + grados) * 1e6) / 1e6, lon: IRR.lon });
const A_333_M = norte(0.003);          // ~333,6 m
const A_1_1_KM = norte(0.01);          // ~1112 m

const vigenteReal = () => ({
  correccionId: '618615f2-3f2b-4a8d-ae3c-1ebd49041190', wellId: W, lat: PUNTO_REAL.lat, lon: PUNTO_REAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null,
  observacion: '', nombrePropone: 'Federico Albrieu', timestamp: new Date(2026, 9, 12, 14, 5, 30).toISOString(), distanciaM: 22.2, advertenciaDistancia: false,
  irrigacion: { lat: IRR.lat, lon: IRR.lon, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' },
  estado: 'VALIDADA', resolucion: { evento: 'VALIDADA', nombre: 'Federico Albrieu', timestamp: new Date(2026, 9, 12, 14, 5, 30).toISOString(), motivo: 'Validada automaticamente al crearla: quien la creo tiene permiso para validar ubicaciones' }, propia: true
});
const pendiente = (extra) => Object.assign({
  correccionId: '11111111-1111-4111-8111-111111111111', wellId: W, lat: -33.3478, lon: -69.1456, metodo: 'GPS_ACTUAL', precisionGpsM: 9.5, observacion: 'Boca corrida al norte',
  nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 18.4, advertenciaDistancia: false,
  irrigacion: { lat: IRR.lat, lon: IRR.lon, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' }, estado: 'PROPUESTA', resolucion: null, propia: false
}, extra || {});

describe('permisos: el boton solo con ubicacion y ubicacion_corregir EXACTAMENTE verdaderos', () => {
  test('ambos true -> puede corregir', () => {
    expect(L.ubicacionCorreccionLogic_puedeCorregir({ ubicacion: true, ubicacion_corregir: true })).toBe(true);
  });

  test.each([
    ['sin ubicacion_corregir', { ubicacion: true }],
    ['ubicacion_corregir=false', { ubicacion: true, ubicacion_corregir: false }],
    ['sin ubicacion', { ubicacion_corregir: true }],
    ['ubicacion=false', { ubicacion: false, ubicacion_corregir: true }],
    ['solo validar', { ubicacion: true, ubicacion_validar: true }],
    ['valores truthy no booleanos ("SI", 1)', { ubicacion: 'SI', ubicacion_corregir: 1 }],
    ['corregir "SI"', { ubicacion: true, ubicacion_corregir: 'SI' }],
    ['vacio', {}],
    ['null', null],
    ['undefined', undefined]
  ])('%s -> NO puede corregir (no se asume permiso por ausencia o por otro valor)', (n, permisos) => {
    expect(L.ubicacionCorreccionLogic_puedeCorregir(permisos)).toBe(false);
  });
});

describe('GPS: precision', () => {
  test('hasta 50 m es valida (50 exacto incluido) y se redondea a 1 decimal', () => {
    expect(L.ubicacionCorreccionLogic_evaluarGps(9.46)).toMatchObject({ valido: true, precisionM: 9.5, mensaje: '' });
    expect(L.ubicacionCorreccionLogic_evaluarGps(50)).toMatchObject({ valido: true, precisionM: 50 });
  });

  test('mas de 50 m NO se puede guardar y explica por que: "La precision actual es de 73 m. Necesitamos 50 m o menos para guardar."', () => {
    const r = L.ubicacionCorreccionLogic_evaluarGps(73);
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe('insuficiente');
    expect(r.mensaje).toBe('La precisión actual es de 73 m. Necesitamos 50 m o menos para guardar.');
    expect(L.ubicacionCorreccionLogic_evaluarGps(50.1).valido).toBe(false);
  });

  test.each([[0], [-5], [NaN], [Infinity], [null], [undefined], ['12'], [{}]])('accuracy invalida (%p) -> no se puede guardar', (acc) => {
    const r = L.ubicacionCorreccionLogic_evaluarGps(acc);
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe('invalida');
    expect(r.mensaje).toMatch(/No pudimos medir la precisión/);
  });
});

describe('distancia y formato', () => {
  test('haversine: ~22,2 m entre la ubicacion de Irrigacion del 14-0001 y la correccion real', () => {
    expect(L.ubicacionCorreccionLogic_distanciaMetros(IRR.lat, IRR.lon, PUNTO_REAL.lat, PUNTO_REAL.lon)).toBe(22.2);
    expect(L.ubicacionCorreccionLogic_distanciaMetros(IRR.lat, IRR.lon, IRR.lat, IRR.lon)).toBe(0);
  });

  test.each([[22.2, '22,2 m'], [120, '120 m'], [999.94, '999,9 m'], [1000, '1 km'], [1430, '1,4 km'], [12500, '12,5 km']])('formatearDistancia(%p) = %p', (m, t) => {
    expect(L.ubicacionCorreccionLogic_formatearDistancia(m)).toBe(t);
  });

  test('coordenadas: hasta 6 decimales sin ceros de relleno', () => {
    expect(L.ubicacionCorreccionLogic_formatearCoordenadas(-33.34745, -69.14545)).toBe('-33.34745, -69.14545');
    expect(L.ubicacionCorreccionLogic_formatearCoord(-33.3474500001)).toBe('-33.34745');
    expect(L.ubicacionCorreccionLogic_formatearCoord('x')).toBe('');
  });

  test('fecha local legible; vacia si no es valida', () => {
    expect(L.ubicacionCorreccionLogic_formatearFecha(new Date(2026, 9, 12, 14, 5).toISOString())).toBe('12/10/2026 14:05');
    expect(L.ubicacionCorreccionLogic_formatearFecha('no es fecha')).toBe('');
    expect(L.ubicacionCorreccionLogic_formatearFecha(null)).toBe('');
  });

  test('enlace a Google Maps con la coordenada', () => {
    expect(L.ubicacionCorreccionLogic_urlGoogleMaps(-33.34745, -69.14545)).toBe('https://www.google.com/maps?q=-33.34745,-69.14545');
  });

  test('etiquetas de estado y de metodo', () => {
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('PROPUESTA')).toBe('Pendiente');
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('VALIDADA')).toBe('Validada en campo');
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('RECHAZADA')).toBe('Rechazada');
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('SUPERADA')).toBe('Reemplazada por una corrección posterior');
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('REVERTIDA')).toBe('Revertida');
    expect(L.ubicacionCorreccionLogic_etiquetaEstado('INCONSISTENTE')).toBe('Inconsistente');
    expect(L.ubicacionCorreccionLogic_etiquetaMetodo('PUNTO_EN_MAPA')).toBe('Elegida en mapa');
    expect(L.ubicacionCorreccionLogic_etiquetaMetodo('GPS_ACTUAL')).toBe('GPS');
  });
});

describe('ubicacion de Irrigacion (la oficial)', () => {
  const loc = (estado, extra) => ({ wellId: W, ubicacionResuelta: Object.assign({ estado: estado, lat: IRR.lat, lon: IRR.lon }, extra || {}) });

  test('corroborada y unica tienen coordenada; el resto no (igual que el backend)', () => {
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(loc('unica'))).toEqual({ lat: IRR.lat, lon: IRR.lon, estado: 'unica' });
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(loc('corroborada')).lat).toBe(IRR.lat);
    ['revisar', 'revisarLeve', 'dudosoLeve', 'sinCoordenadas', 'otro'].forEach((e) => expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(loc(e))).toBeNull());
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(null)).toBeNull();
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion({})).toBeNull();
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(loc('unica', { lat: null }))).toBeNull();
  });
});

describe('evaluarPropuesta: distancia, observacion obligatoria y advertencia fuerte', () => {
  const base = (p, extra) => Object.assign({ lat: p.lat, lon: p.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: IRR }, extra || {});
  const ev = (p, extra) => L.ubicacionCorreccionLogic_evaluarPropuesta(base(p, extra));

  test('a 22 m: se puede guardar sin observacion', () => {
    const r = ev(PUNTO_REAL);
    expect(r).toMatchObject({ ok: true, distanciaM: 22.2, observacionObligatoria: false, advertenciaFuerte: false });
  });

  test('hasta 250 m inclusive la observacion es opcional; mas de 250 m es obligatoria', () => {
    const justo = ev(norte(0.002248));
    expect(justo.distanciaM).toBe(250);
    expect(justo.observacionObligatoria).toBe(false);
    expect(justo.ok).toBe(true);
    const pasado = ev(norte(0.00226));
    expect(pasado.distanciaM).toBeGreaterThan(250);
    expect(pasado.observacionObligatoria).toBe(true);
    expect(pasado.ok).toBe(false);
  });

  test('a mas de 250 m, sin observacion NO deja guardar (ni con solo espacios); con observacion si', () => {
    const vacia = ev(A_333_M);
    expect(vacia.ok).toBe(false);
    expect(vacia.errores.observacion).toMatch(/indicá el motivo en la observación \(obligatoria a más de 250 m\)/);
    expect(ev(A_333_M, { observacion: '    ' }).ok).toBe(false);
    expect(ev(A_333_M, { observacion: 'La boca esta corrida' }).ok).toBe(true);
  });

  test('a mas de 1 km: advertencia fuerte (no bloquea si hay observacion)', () => {
    const r = ev(A_1_1_KM, { observacion: 'Verificado en campo' });
    expect(r.advertenciaFuerte).toBe(true);
    expect(r.ok).toBe(true);
    expect(L.UCORR_TEXTO_ADVERTENCIA_1KM).toBe('La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificá cuidadosamente antes de guardar.');
    expect(ev(A_333_M, { observacion: 'x' }).advertenciaFuerte).toBe(false);
    expect(ev(A_1_1_KM).ok).toBe(false);                     // a mas de 1 km sin observacion: sigue siendo obligatoria
  });

  test('SIN ubicacion de Irrigacion: se puede proponer, sin distancia, con observacion opcional', () => {
    const r = ev(A_1_1_KM, { irrigacion: null });
    expect(r).toMatchObject({ ok: true, distanciaM: null, observacionObligatoria: false, advertenciaFuerte: false });
    expect(ev(A_1_1_KM, { irrigacion: undefined }).ok).toBe(true);
  });

  test('observacion de mas de 300 caracteres no se acepta', () => {
    expect(ev(PUNTO_REAL, { observacion: 'x'.repeat(301) }).errores.observacion).toMatch(/hasta 300 caracteres/);
    expect(ev(PUNTO_REAL, { observacion: 'x'.repeat(300) }).ok).toBe(true);
  });

  test('GPS_ACTUAL: exige precision valida (>50 m, 0 o ausente bloquean); PUNTO_EN_MAPA no depende de ella', () => {
    const gps = (prec) => ev(PUNTO_REAL, { metodo: 'GPS_ACTUAL', precisionGpsM: prec });
    expect(gps(9).ok).toBe(true);
    expect(gps(73).ok).toBe(false);
    expect(gps(73).errores.gps).toBe('La precisión actual es de 73 m. Necesitamos 50 m o menos para guardar.');
    expect(gps(0).ok).toBe(false);
    expect(gps(null).ok).toBe(false);
    expect(ev(PUNTO_REAL, { metodo: 'PUNTO_EN_MAPA', precisionGpsM: null }).ok).toBe(true);
  });

  test('punto o metodo invalidos', () => {
    expect(ev({ lat: null, lon: null }).ok).toBe(false);
    expect(ev({ lat: 0, lon: 0 }).ok).toBe(false);
    expect(ev({ lat: 95, lon: -69 }).ok).toBe(false);
    expect(ev(PUNTO_REAL, { metodo: 'MANUAL' }).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(undefined).ok).toBe(false);
  });
});

describe('payload: lista blanca de campos', () => {
  const CAMPOS = ['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId'];
  // todo lo que el cliente NO debe mandar, aunque llegue mezclado en "valores"
  const MALOS = {
    email: 'x@y.com', nombre: 'Falso', emailPropone: 'x@y.com', nombrePropone: 'Falso', autoValidar: true, autoValidada: true, validar: true,
    distanciaM: 0, advertenciaDistancia: false, estado: 'VALIDADA', irrigacion: IRR, irrLat: 1, irrLon: 2, irrEstado: 'unica', timestamp: '2000-01-01', correccionId: 'x'
  };

  test('exactamente wellId, lat, lon, metodo, precisionGpsM, observacion y clientRequestId', () => {
    const p = L.ubicacionCorreccionLogic_construirPayload(W, Object.assign({ lat: PUNTO_REAL.lat, lon: PUNTO_REAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: 12, observacion: '  nota  ' }, MALOS), 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(CAMPOS);
    expect(p).toEqual({ wellId: W, lat: -33.34745, lon: -69.14545, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'nota', clientRequestId: 'ucorr-abc12345' });
  });

  test('GPS_ACTUAL manda la precision (redondeada); PUNTO_EN_MAPA siempre null', () => {
    const g = L.ubicacionCorreccionLogic_construirPayload(W, { lat: -33.123456789, lon: -69.1, metodo: 'GPS_ACTUAL', precisionGpsM: 9.46, observacion: '' }, 'id-12345678');
    expect(g).toMatchObject({ lat: -33.123457, lon: -69.1, metodo: 'GPS_ACTUAL', precisionGpsM: 9.5, observacion: '' });
    expect(L.ubicacionCorreccionLogic_construirPayload(W, { lat: -33.1, lon: -69.1, metodo: 'PUNTO_EN_MAPA', precisionGpsM: 9, observacion: '' }, 'id-12345678').precisionGpsM).toBeNull();
  });

  test('clientRequestId generado cumple el formato del backend (8-64, A-Za-z0-9_-) y no se repite', () => {
    const ids = new Set();
    for (let i = 0; i < 50; i += 1) {
      const id = L.ubicacionCorreccionLogic_nuevoClientRequestId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
    expect(L.ubicacionCorreccionLogic_nuevoClientRequestId(() => 0.5)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);       // sin crypto.randomUUID
  });
});

describe('flujo de guardado', () => {
  const VALORES = (extra) => Object.assign({ lat: PUNTO_REAL.lat, lon: PUNTO_REAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: IRR }, extra || {});
  const respuestaOk = (correccion, extra) => ({ status: 'ok', data: Object.assign({ correccion: correccion, duplicada: false, curada: false }, extra || {}) });
  const lecturaOk = () => ({ status: 'ok', data: { vigente: vigenteReal(), pendientes: [], historial: [vigenteReal()] } });

  function crear(opciones) {
    const o = opciones || {};
    let n = 0;
    const llamadas = { enviar: [], leer: [] };
    const flujo = L.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: jest.fn((payload) => { llamadas.enviar.push(payload); return o.enviar ? o.enviar(payload, llamadas.enviar.length) : Promise.resolve(respuestaOk(vigenteReal(), { autoValidada: true })); }),
      leer: jest.fn((wellId) => { llamadas.leer.push(wellId); return o.leer ? o.leer(wellId) : Promise.resolve(lecturaOk()); }),
      generarId: jest.fn(() => 'ucorr-test-' + String(++n).padStart(4, '0'))
    });
    return { flujo, llamadas };
  }

  test('respuesta AUTO-VALIDADA (autoValidada:true): "Ubicación corregida y validada."; la decision es del backend', async () => {
    const { flujo } = crear();
    const r = await flujo.guardar(W, VALORES());
    expect(r).toMatchObject({ tipo: 'ok', resultado: 'validada', mensaje: 'Ubicación corregida y validada.' });
  });

  test('tambien es validada si el backend devuelve la correccion en estado VALIDADA (sin el flag)', async () => {
    const { flujo } = crear({ enviar: () => Promise.resolve(respuestaOk(vigenteReal())) });
    expect((await flujo.guardar(W, VALORES())).resultado).toBe('validada');
  });

  test('respuesta PENDIENTE (PROPUESTA): "Corrección enviada para validación."', async () => {
    const { flujo } = crear({ enviar: () => Promise.resolve(respuestaOk(pendiente())) });
    const r = await flujo.guardar(W, VALORES());
    expect(r).toMatchObject({ tipo: 'ok', resultado: 'pendiente', mensaje: 'Corrección enviada para validación.' });
  });

  test('la UI NO decide: un usuario con permiso de corregir pero el backend dice PROPUESTA -> pendiente (y al reves)', async () => {
    const a = await crear({ enviar: () => Promise.resolve(respuestaOk(pendiente())) }).flujo.guardar(W, VALORES());
    expect(a.resultado).toBe('pendiente');
    const b = await crear({ enviar: () => Promise.resolve(respuestaOk(vigenteReal(), { autoValidada: true })) }).flujo.guardar(W, VALORES());
    expect(b.resultado).toBe('validada');
  });

  test('SIEMPRE refresca con getCorreccionesUbicacionPozo del pozo guardado y devuelve esa lectura', async () => {
    const { flujo, llamadas } = crear();
    const r = await flujo.guardar(W, VALORES());
    expect(llamadas.leer).toEqual([W]);
    expect(r.lectura.vigente.correccionId).toBe('618615f2-3f2b-4a8d-ae3c-1ebd49041190');
    expect(r.lecturaFallida).toBe(false);
  });

  test('si el refresco falla, el guardado igual se informa como exitoso y se avisa que la lista no se actualizo', async () => {
    const a = await crear({ leer: () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) }).flujo.guardar(W, VALORES());
    expect(a).toMatchObject({ tipo: 'ok', resultado: 'validada', lectura: null, lecturaFallida: true });
    const b = await crear({ leer: () => Promise.reject(new Error('red')) }).flujo.guardar(W, VALORES());
    expect(b).toMatchObject({ tipo: 'ok', lectura: null, lecturaFallida: true });
  });

  test('ERROR del backend: mensaje en espanol (nunca el texto tecnico), sin refrescar, y el intento queda reintentable', async () => {
    const { flujo, llamadas } = crear({ enviar: () => Promise.resolve({ status: 'error', code: 'FUERA_DE_MENDOZA', message: 'texto tecnico interno' }) });
    const r = await flujo.guardar(W, VALORES());
    expect(r).toMatchObject({ tipo: 'error', code: 'FUERA_DE_MENDOZA', mensaje: 'La ubicación queda fuera de Mendoza.', sesionVencida: false });
    expect(r.mensaje).not.toMatch(/tecnico/);
    expect(llamadas.leer).toHaveLength(0);
  });

  test('OBSERVACION_REQUERIDA del backend incluye la distancia', async () => {
    const { flujo } = crear({ enviar: () => Promise.resolve({ status: 'error', code: 'OBSERVACION_REQUERIDA', distanciaM: 333.6 }) });
    expect((await flujo.guardar(W, VALORES())).mensaje).toMatch(/\(a 333,6 m de Irrigación\)/);
  });

  test('sesion vencida (UNAUTHORIZED / USER_DISABLED) se marca para que la app cierre sesion', async () => {
    for (const code of ['UNAUTHORIZED', 'USER_DISABLED']) {
      const r = await crear({ enviar: () => Promise.resolve({ status: 'error', code }) }).flujo.guardar(W, VALORES());
      expect(r).toMatchObject({ tipo: 'error', code, sesionVencida: true });
    }
    const permiso = await crear({ enviar: () => Promise.resolve({ status: 'error', code: 'PERMISSION_DENIED' }) }).flujo.guardar(W, VALORES());
    expect(permiso).toMatchObject({ sesionVencida: false, mensaje: 'No tenés permiso para corregir la ubicación.' });
  });

  test('error de red: mensaje claro y no rechaza la promesa', async () => {
    const { flujo } = crear({ enviar: () => Promise.reject(new Error('Failed to fetch')) });
    expect(await flujo.guardar(W, VALORES())).toEqual({ tipo: 'red', mensaje: 'No se pudo guardar. Revisá tu conexión e intentá de nuevo.' });
  });

  test('DOBLE CLICK no duplica: el segundo guardar() mientras hay uno en curso no envia nada y devuelve la misma promesa', async () => {
    let resolver;
    const { flujo, llamadas } = crear({ enviar: () => new Promise((res) => { resolver = res; }) });
    const p1 = flujo.guardar(W, VALORES());
    const p2 = flujo.guardar(W, VALORES());
    const p3 = flujo.guardar(W, VALORES());
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);
    expect(flujo.enCurso()).toBe(true);
    await Promise.resolve();
    resolver(respuestaOk(vigenteReal(), { autoValidada: true }));
    const r = await p1;
    expect(r.tipo).toBe('ok');
    expect(llamadas.enviar).toHaveLength(1);
    expect(llamadas.leer).toHaveLength(1);
    expect(flujo.enCurso()).toBe(false);
  });

  test('RETRY del mismo intento reutiliza el clientRequestId (tras un corte de red y tras un error del servidor)', async () => {
    const respuestas = [() => Promise.reject(new Error('timeout')), () => Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }), () => Promise.resolve(respuestaOk(vigenteReal(), { autoValidada: true }))];
    const { flujo, llamadas } = crear({ enviar: (p, k) => respuestas[k - 1]() });
    expect((await flujo.guardar(W, VALORES())).tipo).toBe('red');
    expect((await flujo.guardar(W, VALORES())).tipo).toBe('error');
    expect((await flujo.guardar(W, VALORES())).tipo).toBe('ok');
    expect(llamadas.enviar.map((p) => p.clientRequestId)).toEqual(['ucorr-test-0001', 'ucorr-test-0001', 'ucorr-test-0001']);
  });

  test('si el usuario CAMBIA algo (punto, observacion, metodo) es otro contenido: id nuevo (evita IDEMPOTENCY_CONFLICT)', async () => {
    const { flujo, llamadas } = crear({ enviar: () => Promise.reject(new Error('red')) });
    await flujo.guardar(W, VALORES());
    await flujo.guardar(W, VALORES({ observacion: 'otra nota' }));
    await flujo.guardar(W, VALORES({ lat: -33.3475 }));
    await flujo.guardar(W, VALORES({ lat: -33.3475 }));
    expect(llamadas.enviar.map((p) => p.clientRequestId)).toEqual(['ucorr-test-0001', 'ucorr-test-0002', 'ucorr-test-0003', 'ucorr-test-0003']);
  });

  test('tras un guardado exitoso el siguiente es OTRO intento (id nuevo), aunque el contenido sea igual', async () => {
    const { flujo, llamadas } = crear();
    await flujo.guardar(W, VALORES());
    await flujo.guardar(W, VALORES());
    expect(llamadas.enviar.map((p) => p.clientRequestId)).toEqual(['ucorr-test-0001', 'ucorr-test-0002']);
  });

  test('NUNCA envia autoValidar, email, nombre, distancia ni estado, aunque "valores" los traiga', async () => {
    const { flujo, llamadas } = crear();
    await flujo.guardar(W, Object.assign(VALORES({ observacion: 'ok' }), {
      email: 'x@y.com', nombre: 'Falso', autoValidar: true, autoValidada: true, distanciaM: 5, estado: 'VALIDADA', emailPropone: 'x@y.com', nombrePropone: 'Falso', irrLat: 1
    }));
    expect(Object.keys(llamadas.enviar[0]).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(JSON.stringify(llamadas.enviar[0])).not.toMatch(/autoValid|email|nombre|distancia|estado|irr/i);
  });

  test('un valor invalido (GPS > 50 m, observacion faltante a mas de 250 m) no se envia', async () => {
    const { flujo, llamadas } = crear();
    const gps = await flujo.guardar(W, VALORES({ metodo: 'GPS_ACTUAL', precisionGpsM: 73 }));
    expect(gps).toMatchObject({ tipo: 'invalido' });
    expect(gps.errores.gps).toMatch(/73 m/);
    const obs = await flujo.guardar(W, VALORES(Object.assign({}, A_333_M)));
    expect(obs.tipo).toBe('invalido');
    expect(obs.errores.observacion).toBeDefined();
    expect(llamadas.enviar).toHaveLength(0);
  });

  test('GPS valido se envia con metodo GPS_ACTUAL y precisionGpsM', async () => {
    const { flujo, llamadas } = crear();
    await flujo.guardar(W, VALORES({ metodo: 'GPS_ACTUAL', precisionGpsM: 12.34 }));
    expect(llamadas.enviar[0]).toMatchObject({ metodo: 'GPS_ACTUAL', precisionGpsM: 12.3 });
  });

  test('punto en mapa se envia con metodo PUNTO_EN_MAPA y precisionGpsM null', async () => {
    const { flujo, llamadas } = crear();
    await flujo.guardar(W, VALORES());
    expect(llamadas.enviar[0]).toMatchObject({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, wellId: W, lat: -33.34745, lon: -69.14545 });
  });

  test('SIN ubicacion de Irrigacion se puede guardar una propuesta (sin distancia)', async () => {
    const { flujo, llamadas } = crear({ enviar: () => Promise.resolve(respuestaOk(pendiente())) });
    const r = await flujo.guardar(W, VALORES({ irrigacion: null, lat: -33.9, lon: -68.9 }));
    expect(r.tipo).toBe('ok');
    expect(llamadas.enviar).toHaveLength(1);
  });
});

describe('centro inicial del mapa', () => {
  const vig = { lat: -33.34745, lon: -69.14545 };
  const disp = { lat: -32.9, lon: -68.8 };

  test('prioridad: vigente > Irrigacion > dispositivo > vista general de Mendoza', () => {
    expect(L.ubicacionCorreccionLogic_centroInicialMapa({ vigente: vig, irrigacion: IRR, dispositivo: disp })).toMatchObject({ origen: 'vigente', lat: vig.lat, lon: vig.lon });
    expect(L.ubicacionCorreccionLogic_centroInicialMapa({ vigente: null, irrigacion: IRR, dispositivo: disp })).toMatchObject({ origen: 'irrigacion', lat: IRR.lat });
    expect(L.ubicacionCorreccionLogic_centroInicialMapa({ irrigacion: null, dispositivo: disp })).toMatchObject({ origen: 'dispositivo', lat: disp.lat });
    expect(L.ubicacionCorreccionLogic_centroInicialMapa({})).toMatchObject({ origen: 'defecto', zoom: 7 });
    expect(L.ubicacionCorreccionLogic_centroInicialMapa(undefined).origen).toBe('defecto');
  });

  test('datos no numericos se saltean al siguiente', () => {
    expect(L.ubicacionCorreccionLogic_centroInicialMapa({ vigente: { lat: 'x', lon: 1 }, irrigacion: IRR }).origen).toBe('irrigacion');
  });
});

describe('seccion "Ubicacion corregida" (HTML)', () => {
  const seccion = (data, opc) => L.ubicacionCorreccionLogic_htmlSeccion(data, opc);

  test('SIN correcciones: estado vacio claro, nota de que no reemplaza a Irrigacion; sin tarjetas ni historial', () => {
    const h = seccion({ vigente: null, pendientes: [], historial: [] }, { puedeCorregir: false });
    expect(h).toContain('Ubicación corregida');
    expect(h).toContain('Todavía no hay correcciones de ubicación para este pozo.');
    expect(h).toContain('La ubicación vigente es la de Irrigación');
    expect(h).toContain(L.UCORR_TEXTO_NO_REEMPLAZA);
    expect(h).not.toContain('ucorr-card');
    expect(h).not.toContain('Historial de correcciones');
  });

  test('con VIGENTE validada (caso real 14-0001): badge, coordenadas, autor, fecha, metodo, distancia y enlace a Google Maps', () => {
    const v = vigenteReal();
    const h = seccion({ vigente: v, pendientes: [], historial: [v] }, { puedeCorregir: false });
    expect(h).toContain('Validada en campo');
    expect(h).toContain('-33.34745, -69.14545');
    expect(h).toContain('Federico Albrieu');
    expect(h).toContain('12/10/2026 14:05');
    expect(h).toContain('Elegida en mapa');
    expect(h).toContain('22,2 m');
    expect(h).toContain('href="https://www.google.com/maps?q=-33.34745,-69.14545"');
    expect(h).toContain('target="_blank" rel="noopener"');
    expect(h).toContain('Corregida por');
    expect(h).not.toContain('Todavía no hay correcciones');
  });

  test('la coordenada de Irrigacion NO se reemplaza ni se muestra como corregida: la seccion deja explicito que son datos separados', () => {
    const h = seccion({ vigente: vigenteReal(), pendientes: [], historial: [] }, {});
    expect(h).toContain('no reemplaza ni modifica la ubicación de Irrigación');
    expect(h).not.toContain('-33.34765');                       // la oficial no aparece en esta seccion (la dibuja la ficha, aparte)
  });

  test('vigente con GPS muestra "GPS" y la precision; con observacion la muestra', () => {
    const v = Object.assign(vigenteReal(), { metodo: 'GPS_ACTUAL', precisionGpsM: 9.5, observacion: 'Boca corrida 20 m al norte' });
    const h = seccion({ vigente: v, pendientes: [], historial: [] }, {});
    expect(h).toContain('GPS (± 9,5 m)');
    expect(h).toContain('Observación');
    expect(h).toContain('Boca corrida 20 m al norte');
  });

  test('sin observacion no hay fila de observacion; sin distancia no hay fila de distancia', () => {
    const v = Object.assign(vigenteReal(), { observacion: '', distanciaM: null });
    const h = seccion({ vigente: v, pendientes: [], historial: [] }, {});
    expect(h).not.toContain('<dt>Observación</dt>');
    expect(h).not.toContain('Distancia a Irrigación');
  });

  test('advertencia de mas de 1 km visible en la tarjeta', () => {
    const v = Object.assign(vigenteReal(), { advertenciaDistancia: true, distanciaM: 1430 });
    const h = seccion({ vigente: v, pendientes: [], historial: [] }, {});
    expect(h).toContain('A más de 1 km de Irrigación');
    expect(h).toContain('1,4 km');
  });

  test('sin vigente pero con PENDIENTE: "Corrección pendiente de validación" con autor, fecha, coordenadas, metodo, distancia y observacion', () => {
    const p = pendiente();
    const h = seccion({ vigente: null, pendientes: [p], historial: [p] }, { puedeCorregir: false });
    expect(h).toContain('Corrección pendiente de validación (1)');
    expect(h).toContain('Pendiente');
    expect(h).toContain('Ana Pérez');
    expect(h).toContain('13/10/2026 09:30');
    expect(h).toContain('-33.3478, -69.1456');
    expect(h).toContain('GPS (± 9,5 m)');
    expect(h).toContain('18,4 m');
    expect(h).toContain('Boca corrida al norte');
    expect(h).not.toContain('Validada en campo');
    expect(h).not.toContain('Todavía no hay correcciones');
    expect(h).toContain('Propuesta por');
  });

  test('VARIAS pendientes: se muestran todas, de forma compacta (ninguna oculta)', () => {
    const ps = [pendiente({ correccionId: 'a', nombrePropone: 'Ana' }), pendiente({ correccionId: 'b', nombrePropone: 'Beto', lat: -33.349 }), pendiente({ correccionId: 'c', nombrePropone: 'Carla', lat: -33.35 })];
    const h = seccion({ vigente: null, pendientes: ps, historial: ps }, {});
    expect(h).toContain('Corrección pendiente de validación (3)');
    ['Ana', 'Beto', 'Carla'].forEach((n) => expect(h).toContain(n));
    expect((h.match(/ucorr-card-pendiente/g) || []).length).toBe(3);
  });

  test('con vigente Y pendientes: se ven las dos cosas', () => {
    const v = vigenteReal();
    const h = seccion({ vigente: v, pendientes: [pendiente()], historial: [] }, {});
    expect(h).toContain('Validada en campo');
    expect(h).toContain('Correcciones pendientes de validación (1)');
  });

  test('boton "Corregir ubicacion" solo con puedeCorregir === true (sin permiso: ni habilitado ni deshabilitado)', () => {
    const data = { vigente: null, pendientes: [], historial: [] };
    expect(seccion(data, { puedeCorregir: true })).toContain('id="btn-ubic-corr-abrir"');
    expect(seccion(data, { puedeCorregir: true })).toContain('Corregir ubicación</button>');
    [false, undefined, null, 'true', 1].forEach((v) => {
      const h = seccion(data, { puedeCorregir: v });
      expect(h).not.toContain('btn-ubic-corr-abrir');
      expect(h).not.toMatch(/Corregir ubicación<\/button>/);
      expect(h).not.toContain('disabled');
    });
    expect(seccion(data)).not.toContain('btn-ubic-corr-abrir');
  });

  test('HISTORIAL colapsable (details) con todos los estados legibles, autor, fecha, metodo, distancia, observacion y resolucion', () => {
    const t = (d, h, m) => new Date(2026, 9, d, h, m).toISOString();
    const historial = [
      { ...pendiente({ correccionId: 'e', nombrePropone: 'Eva', timestamp: t(16, 8, 0) }), estado: 'PROPUESTA', resolucion: null },
      { ...vigenteReal(), correccionId: 'd', timestamp: t(15, 8, 0), estado: 'VALIDADA', resolucion: { evento: 'VALIDADA', nombre: 'Valeria', timestamp: t(15, 9, 0), motivo: 'Confirmado con fotos' } },
      { ...pendiente({ correccionId: 'c', nombrePropone: 'Carla', timestamp: t(14, 8, 0) }), estado: 'REVERTIDA', resolucion: { evento: 'REVERTIDA', nombre: 'Valeria', timestamp: t(14, 12, 0), motivo: 'Era el pozo de al lado' } },
      { ...pendiente({ correccionId: 'b', nombrePropone: 'Beto', timestamp: t(13, 8, 0) }), estado: 'SUPERADA', resolucion: { evento: 'SUPERADA', nombre: 'Valeria', timestamp: t(14, 8, 0), motivo: 'Superada por la correccion 618615f2-3f2b-4a8d-ae3c-1ebd49041190' } },
      { ...pendiente({ correccionId: 'a', nombrePropone: 'Ana', timestamp: t(12, 8, 0) }), estado: 'RECHAZADA', resolucion: { evento: 'RECHAZADA', nombre: 'Valeria', timestamp: t(12, 10, 0), motivo: 'No coincide con la boca' } },
      { ...pendiente({ correccionId: 'x', nombrePropone: 'Rota', timestamp: t(11, 8, 0) }), estado: 'INCONSISTENTE', resolucion: null }
    ];
    const h = seccion({ vigente: historial[1], pendientes: [historial[0]], historial: historial }, {});
    expect(h).toMatch(/<details class="ucorr-historial"><summary>Historial de correcciones \(6\)<\/summary>/);
    ['Pendiente', 'Validada en campo', 'Revertida', 'Reemplazada por una corrección posterior', 'Rechazada', 'Inconsistente'].forEach((e) => expect(h).toContain(e));
    expect(h).toContain('Validada por Valeria el 15/10/2026 09:00');
    expect(h).toContain('Motivo: Confirmado con fotos');
    expect(h).toContain('Revertida por Valeria el 14/10/2026 12:00');
    expect(h).toContain('Motivo: Era el pozo de al lado');
    expect(h).toContain('Rechazada por Valeria el 12/10/2026 10:00');
    expect(h).toContain('Motivo: No coincide con la boca');
    expect(h).toContain('Reemplazada el 14/10/2026 08:00');
    expect(h).not.toContain('618615f2-3f2b-4a8d-ae3c-1ebd49041190 ');           // el id interno del motivo de SUPERADA no se muestra
    expect(h).not.toMatch(/Motivo: Superada por la correccion/);
  });

  test('el historial se muestra en orden cronologico (la mas antigua primero) aunque la API lo entregue al reves', () => {
    const t = (d) => new Date(2026, 9, d, 10, 0).toISOString();
    const nuevoPrimero = [pendiente({ correccionId: 'c3', nombrePropone: 'Tercera', timestamp: t(3) }), pendiente({ correccionId: 'c2', nombrePropone: 'Segunda', timestamp: t(2) }), pendiente({ correccionId: 'c1', nombrePropone: 'Primera', timestamp: t(1) })];
    const h = seccion({ vigente: null, pendientes: [], historial: nuevoPrimero }, {});
    const dentro = h.slice(h.indexOf('<details'));
    expect(dentro.indexOf('Primera')).toBeLessThan(dentro.indexOf('Segunda'));
    expect(dentro.indexOf('Segunda')).toBeLessThan(dentro.indexOf('Tercera'));
    expect(L.ubicacionCorreccionLogic_ordenCronologico(nuevoPrimero).map((c) => c.correccionId)).toEqual(['c1', 'c2', 'c3']);
  });

  test('la validacion directa se muestra en lenguaje de usuario (no el texto tecnico)', () => {
    const v = vigenteReal();
    const h = seccion({ vigente: v, pendientes: [], historial: [v] }, {});
    expect(h).toContain('Validada al crearla, por un usuario con permiso de validación.');
    expect(h).not.toContain('Validada automaticamente');
  });

  test('aviso de resultado (ok) y aviso con boton "Actualizar" cuando la relectura fallo', () => {
    const ok = seccion({ vigente: null, pendientes: [], historial: [] }, { aviso: { tipo: 'ok', texto: 'Ubicación corregida y validada.' } });
    expect(ok).toContain('ucorr-aviso-ok');
    expect(ok).toContain('Ubicación corregida y validada.');
    expect(ok).not.toContain('btn-ubic-corr-recargar');
    const fallo = seccion({ vigente: null, pendientes: [], historial: [] }, { aviso: { tipo: 'ok', texto: 'x No pudimos actualizar la lista de correcciones.', recargar: true } });
    expect(fallo).toContain('id="btn-ubic-corr-recargar"');
  });

  test('todo texto de usuario va escapado (nombre, observacion, motivo)', () => {
    const p = pendiente({ nombrePropone: '<img src=x onerror=alert(1)>', observacion: '"><script>alert(1)</script>' });
    const r = { ...pendiente({ correccionId: 'z', estado: 'RECHAZADA' }), resolucion: { evento: 'RECHAZADA', nombre: '<b>V</b>', timestamp: new Date(2026, 9, 1).toISOString(), motivo: '<i>motivo</i>' } };
    const h = seccion({ vigente: null, pendientes: [p], historial: [p, r] }, {});
    expect(h).not.toMatch(/<img |<script|<b>V|<i>motivo/);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(h).toContain('&lt;script&gt;');
  });

  test('nunca expone emails (la API no los manda y la seccion tampoco inventa ninguno)', () => {
    const v = vigenteReal();
    const h = seccion({ vigente: v, pendientes: [pendiente()], historial: [v, pendiente()] }, { puedeCorregir: true });
    expect(h).not.toMatch(/@/);
    expect(h).not.toMatch(/email/i);
  });

  test('data ausente o vacia no rompe', () => {
    expect(() => seccion(null, {})).not.toThrow();
    expect(() => seccion(undefined)).not.toThrow();
    expect(seccion({}, {})).toContain('Todavía no hay correcciones');
  });
});

describe('mensajes de error', () => {
  test('cada codigo conocido tiene un texto en espanol; los desconocidos, uno generico', () => {
    ['INVALID_COORDENADAS', 'FUERA_DE_MENDOZA', 'PRECISION_INSUFICIENTE', 'IDEMPOTENCY_CONFLICT', 'WELL_NOT_FOUND', 'PERMISSION_DENIED', 'SERVICE_UNAVAILABLE', 'UNAUTHORIZED', 'USER_DISABLED'].forEach((c) => {
      expect(L.ubicacionCorreccionLogic_mensajeError(c)).toMatch(/\.$/);
    });
    expect(L.ubicacionCorreccionLogic_mensajeError('CODIGO_RARO')).toBe('No se pudo guardar la corrección. Intentá nuevamente.');
    expect(L.ubicacionCorreccionLogic_mensajeError(undefined)).toBe('No se pudo guardar la corrección. Intentá nuevamente.');
  });

  test('lectura: permiso, sesion y generico', () => {
    expect(L.ubicacionCorreccionLogic_mensajeErrorLectura('PERMISSION_DENIED')).toMatch(/permiso para ver/);
    expect(L.ubicacionCorreccionLogic_mensajeErrorLectura('UNAUTHORIZED')).toMatch(/sesión venció/);
    expect(L.ubicacionCorreccionLogic_mensajeErrorLectura('X')).toBe('No se pudieron cargar las correcciones. Intentá nuevamente.');
  });
});

describe('resultado del guardado: se lee de data.correccion.estado (autoValidada no es dependencia)', () => {
  const r = (data) => L.ubicacionCorreccionLogic_resultadoDeRespuesta({ status: 'ok', data: data });

  test('VALIDADA -> validada; PROPUESTA -> pendiente (con o sin flags extra)', () => {
    expect(r({ correccion: { estado: 'VALIDADA' } })).toBe('validada');
    expect(r({ correccion: { estado: 'PROPUESTA' } })).toBe('pendiente');
    expect(r({ correccion: { estado: 'VALIDADA' }, duplicada: true, curada: false })).toBe('validada');
  });

  test('forma v36 (sin autoValidada ni supersedidas): un usuario con ambos permisos recibe PROPUESTA y se muestra como pendiente', () => {
    expect(r({ correccion: { estado: 'PROPUESTA' }, duplicada: false, curada: false })).toBe('pendiente');
  });

  test('forma actual (con autoValidada y supersedidas): validada, por el estado', () => {
    expect(r({ correccion: { estado: 'VALIDADA' }, duplicada: false, curada: false, autoValidada: true, supersedidas: [] })).toBe('validada');
  });

  test('el flag solo NUNCA decide: autoValidada:true con estado PROPUESTA es pendiente; sin correccion es "otro"', () => {
    expect(r({ correccion: { estado: 'PROPUESTA' }, autoValidada: true })).toBe('pendiente');
    expect(r({ autoValidada: true })).toBe('otro');
    expect(r({ autoValidada: true, correccion: null })).toBe('otro');
    expect(L.ubicacionCorreccionLogic_resultadoDeRespuesta(null)).toBe('otro');
    expect(L.ubicacionCorreccionLogic_resultadoDeRespuesta({ status: 'ok' })).toBe('otro');
  });

  test('estados que no son resultado de crear (RECHAZADA, SUPERADA...) -> "otro" con el mensaje generico', () => {
    expect(r({ correccion: { estado: 'RECHAZADA' } })).toBe('otro');
    expect(L.ubicacionCorreccionLogic_mensajeResultado('otro')).toBe('Corrección registrada.');
  });
});

describe('visibilidad del modulo Ubicacion: corregir controla el boton, no la informacion', () => {
  const SIN = { wellId: W, ubicacionResuelta: { estado: 'sinCoordenadas' } };
  const CON = { wellId: W, ubicacionResuelta: { estado: 'unica', lat: IRR.lat, lon: IRR.lon } };
  const REVISAR = { wellId: W, ubicacionResuelta: { estado: 'revisar' } };
  const LECTOR = { ubicacion: true };
  const CORRECTOR = { ubicacion: true, ubicacion_corregir: true };
  const lectura = (x) => Object.assign({ vigente: null, pendientes: [], historial: [] }, x || {});
  const ofrecer = (o) => L.ubicacionCorreccionLogic_ofrecerModulo(o);

  test('oficialDisponible: corroborada/unica/revisar si; sinCoordenadas y datos ausentes no', () => {
    expect(L.ubicacionCorreccionLogic_oficialDisponible(CON)).toBe(true);
    expect(L.ubicacionCorreccionLogic_oficialDisponible(REVISAR)).toBe(true);
    expect(L.ubicacionCorreccionLogic_oficialDisponible(SIN)).toBe(false);
    expect(L.ubicacionCorreccionLogic_oficialDisponible({})).toBe(false);
    expect(L.ubicacionCorreccionLogic_oficialDisponible(null)).toBe(false);
  });

  test('tieneCorrecciones: vigente, pendientes o historial; una lectura vacia o ausente no', () => {
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones(lectura({ vigente: vigenteReal() }))).toBe(true);
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones(lectura({ pendientes: [pendiente()] }))).toBe(true);
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones(lectura({ historial: [pendiente({ estado: 'RECHAZADA' })] }))).toBe(true);
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones(lectura())).toBe(false);
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones(null)).toBe(false);
    expect(L.ubicacionCorreccionLogic_tieneCorrecciones({})).toBe(false);
  });

  test('pozo CON coordenada oficial: el modulo se ofrece a cualquiera que pueda leer la ubicacion (sin cambios respecto de antes)', () => {
    expect(ofrecer({ ubicacionFound: true, location: CON, permisos: LECTOR, correcciones: null })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: CON, permisos: CORRECTOR, correcciones: null })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: REVISAR, permisos: LECTOR, correcciones: null })).toBe(true);
  });

  test('pozo SIN coordenada oficial, lector (ubicacion=SI, corregir=NO): SOLO si hay una correccion registrada', () => {
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: LECTOR, correcciones: lectura({ vigente: vigenteReal(), historial: [vigenteReal()] }) })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: LECTOR, correcciones: lectura({ pendientes: [pendiente()] }) })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: LECTOR, correcciones: lectura({ historial: [pendiente({ estado: 'REVERTIDA' })] }) })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: LECTOR, correcciones: lectura() })).toBe(false);
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: LECTOR, correcciones: null })).toBe(false);
  });

  test('pozo SIN coordenada oficial, con permiso de corregir: se ofrece aunque no haya nada (para cargar la primera)', () => {
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: CORRECTOR, correcciones: null })).toBe(true);
    expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: CORRECTOR, correcciones: lectura() })).toBe(true);
  });

  test('sin permiso exacto de corregir (validar solo, "SI", 1, ausente) el permiso NO abre el modulo por si mismo', () => {
    [{ ubicacion: true, ubicacion_validar: true }, { ubicacion: true, ubicacion_corregir: 'SI' }, { ubicacion: true, ubicacion_corregir: 1 }, { ubicacion_corregir: true }, {}, null].forEach((permisos) => {
      expect(ofrecer({ ubicacionFound: true, location: SIN, permisos: permisos, correcciones: lectura() })).toBe(false);
    });
  });

  test('si el backend no dejo leer la ubicacion (found=false) nunca se ofrece, ni con correcciones ni con permiso', () => {
    expect(ofrecer({ ubicacionFound: false, location: CON, permisos: CORRECTOR, correcciones: lectura({ vigente: vigenteReal() }) })).toBe(false);
    expect(ofrecer({ ubicacionFound: false, location: SIN, permisos: CORRECTOR, correcciones: null })).toBe(false);
    expect(ofrecer(undefined)).toBe(false);
  });

  test('necesitaConsultarCorrecciones: solo pozo sin coordenada oficial + lector sin permiso de corregir', () => {
    const necesita = (o) => L.ubicacionCorreccionLogic_necesitaConsultarCorrecciones(o);
    expect(necesita({ ubicacionFound: true, location: SIN, permisos: LECTOR })).toBe(true);
    expect(necesita({ ubicacionFound: true, location: { wellId: W }, permisos: LECTOR })).toBe(true);          // sin ubicacionResuelta = sin coordenada
    expect(necesita({ ubicacionFound: true, location: CON, permisos: LECTOR })).toBe(false);                    // ya se ofrece
    expect(necesita({ ubicacionFound: true, location: SIN, permisos: CORRECTOR })).toBe(false);                 // ya se ofrece
    expect(necesita({ ubicacionFound: false, location: SIN, permisos: LECTOR })).toBe(false);
    expect(necesita({ ubicacionFound: true, location: SIN, permisos: { ubicacion: 'SI' } })).toBe(false);       // permiso no exacto: no se pregunta nada
    expect(necesita({ ubicacionFound: true, location: SIN, permisos: {} })).toBe(false);
    expect(necesita({ ubicacionFound: true, location: SIN, permisos: null })).toBe(false);
    expect(necesita(undefined)).toBe(false);
  });
});

describe('indicador "Correcciones pendientes: N" del hub', () => {
  const VALIDADOR = { ubicacion: true, ubicacion_validar: true };
  const okTotal = (total) => ({ status: 'ok', data: { total: total, inconsistentes: 0, pendientes: [] } });

  // reloj y consultas controlados; "pinta" registra cada valor que se mostraria
  function crear(opc) {
    const o = opc || {};
    const est = { permisos: o.permisos === undefined ? VALIDADOR : o.permisos, token: o.token === undefined ? 'tok-real' : o.token, ahora: 1000000, pintados: [], consultas: [], sesion: 0, deshabilitado: 0 };
    const respuestas = o.respuestas || [];
    const b = L.ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: () => (est.sinContexto ? null : { sessionToken: est.token, permisos: est.permisos, onSessionExpired: () => { est.sesion += 1; }, onUserDisabled: () => { est.deshabilitado += 1; } }),
      consultar: jest.fn((token) => {
        est.consultas.push(token);
        const r = respuestas.length ? respuestas[Math.min(est.consultas.length - 1, respuestas.length - 1)] : okTotal(3);
        return typeof r === 'function' ? r() : Promise.resolve(r);
      }),
      pintar: (t) => { est.pintados.push(t); },
      ahora: () => est.ahora
    });
    return { b, est };
  }

  describe('texto y validacion del dato', () => {
    test('"Correcciones pendientes: N" con N > 0; vacio con 0 o dato invalido', () => {
      expect(L.ubicacionCorreccionLogic_textoBadgePendientes(3)).toBe('Correcciones pendientes: 3');
      expect(L.ubicacionCorreccionLogic_textoBadgePendientes(1)).toBe('Correcciones pendientes: 1');
      [0, -1, 1.5, NaN, Infinity, null, undefined, '3', {}].forEach((v) => expect(L.ubicacionCorreccionLogic_textoBadgePendientes(v)).toBe(''));
    });

    test('totalDePendientes: solo un entero >= 0 de una respuesta ok', () => {
      expect(L.ubicacionCorreccionLogic_totalDePendientes(okTotal(0))).toBe(0);
      expect(L.ubicacionCorreccionLogic_totalDePendientes(okTotal(7))).toBe(7);
      [okTotal(-1), okTotal(2.5), okTotal('3'), okTotal(null), { status: 'ok', data: {} }, { status: 'ok' }, { status: 'error', code: 'X', data: { total: 3 } }, null, undefined].forEach((r) => {
        expect(L.ubicacionCorreccionLogic_totalDePendientes(r)).toBeNull();
      });
    });
  });

  describe('permisos fail-closed', () => {
    test('puedeValidar exige ubicacion Y ubicacion_validar EXACTAMENTE true', () => {
      expect(L.ubicacionCorreccionLogic_puedeValidar({ ubicacion: true, ubicacion_validar: true })).toBe(true);
      [{ ubicacion: true }, { ubicacion_validar: true }, { ubicacion: true, ubicacion_validar: 'SI' }, { ubicacion: 1, ubicacion_validar: true }, { ubicacion: true, ubicacion_corregir: true }, {}, null, undefined].forEach((p) => {
        expect(L.ubicacionCorreccionLogic_puedeValidar(p)).toBe(false);
      });
    });

    test.each([
      ['solo corregir', { ubicacion: true, ubicacion_corregir: true }],
      ['validar sin ubicacion', { ubicacion_validar: true }],
      ['valores no exactos', { ubicacion: true, ubicacion_validar: 'SI' }],
      ['sin permisos', {}],
      ['permisos nulos', null]
    ])('%s: NO consulta nada y el indicador queda oculto', async (n, permisos) => {
      const { b, est } = crear({ permisos: permisos });
      expect(await b.refrescar()).toEqual({ tipo: 'sin_permiso' });
      expect(await b.refrescar(true)).toEqual({ tipo: 'sin_permiso' });
      expect(est.consultas).toHaveLength(0);
      expect(est.pintados[est.pintados.length - 1]).toBeNull();
    });

    test('sin sesion (sin token o sin contexto): no consulta y se oculta', async () => {
      const a = crear({ token: null });
      expect((await a.b.refrescar()).tipo).toBe('sin_permiso');
      const c = crear();
      c.est.sinContexto = true;
      expect((await c.b.refrescar()).tipo).toBe('sin_permiso');
      expect(a.est.consultas.concat(c.est.consultas)).toHaveLength(0);
    });

    test('si el permiso se pierde (cambio de cuenta o de permisos), el indicador se oculta en la siguiente actualizacion y deja de consultar', async () => {
      const { b, est } = crear();
      await b.refrescar();
      expect(est.pintados[est.pintados.length - 1]).toBe(3);
      est.permisos = { ubicacion: true };
      await b.refrescar(true);
      expect(est.pintados[est.pintados.length - 1]).toBeNull();
      expect(est.consultas).toHaveLength(1);
    });
  });

  describe('visible / oculto', () => {
    test('con pendientes se muestra el total del backend; usa el token fresco', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3)] });
      expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 3 });
      expect(est.pintados).toEqual([3]);
      expect(est.consultas).toEqual(['tok-real']);
      expect(L.ubicacionCorreccionLogic_textoBadgePendientes(b.total())).toBe('Correcciones pendientes: 3');
    });

    test('con 0 pendientes se pinta 0 (el DOM lo oculta: texto vacio)', async () => {
      const { b, est } = crear({ respuestas: [okTotal(0)] });
      await b.refrescar();
      expect(est.pintados).toEqual([0]);
      expect(L.ubicacionCorreccionLogic_textoBadgePendientes(0)).toBe('');
    });

    test('el total cambia en cada actualizacion forzada', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), okTotal(2), okTotal(0)] });
      await b.refrescar(true);
      await b.refrescar(true);
      await b.refrescar(true);
      expect(est.pintados).toEqual([3, 2, 0]);
    });
  });

  describe('refresco despues de validar o rechazar', () => {
    test('alResolver() vuelve a consultar SIEMPRE (aunque se haya consultado hace instantes) y actualiza el numero', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), okTotal(2), okTotal(1)] });
      await b.refrescar();                              // 3 (al entrar al hub)
      est.ahora += 500;                                 // 0,5 s despues: un refresco automatico se saltearia
      expect((await b.refrescar()).tipo).toBe('reciente');
      expect(await b.alResolver()).toEqual({ tipo: 'ok', total: 2 });        // validar una
      est.ahora += 100;
      expect(await b.alResolver()).toEqual({ tipo: 'ok', total: 1 });        // rechazar otra
      expect(est.pintados).toEqual([3, 2, 1]);
      expect(est.consultas).toHaveLength(3);
    });

    test('alResolver() tambien oculta el indicador cuando era la ultima pendiente', async () => {
      const { b, est } = crear({ respuestas: [okTotal(1), okTotal(0)] });
      await b.refrescar();
      await b.alResolver();
      expect(est.pintados).toEqual([1, 0]);
    });

    test('alResolver() sin permiso no consulta', async () => {
      const { b, est } = crear({ permisos: { ubicacion: true } });
      expect((await b.alResolver()).tipo).toBe('sin_permiso');
      expect(est.consultas).toHaveLength(0);
    });
  });

  describe('refresco automatico al entrar al hub', () => {
    test('respeta el intervalo minimo (15 s) y despues vuelve a consultar', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), okTotal(4)] });
      expect(L.UCORR_BADGE_INTERVALO_MS).toBe(15000);
      await b.refrescar();
      est.ahora += 14999;
      expect((await b.refrescar()).tipo).toBe('reciente');
      expect(est.consultas).toHaveLength(1);
      est.ahora += 2;
      expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 4 });
      expect(est.consultas).toHaveLength(2);
    });

    test('entradas simultaneas al hub comparten UNA consulta en curso', async () => {
      let resolver;
      const { b, est } = crear({ respuestas: [() => new Promise((r) => { resolver = r; })] });
      const p1 = b.refrescar();
      const p2 = b.refrescar();
      expect(p2).toBe(p1);
      await Promise.resolve();
      resolver(okTotal(5));
      expect(await p1).toEqual({ tipo: 'ok', total: 5 });
      expect(est.consultas).toHaveLength(1);
    });

    test('un refresco FORZADO mientras hay otra consulta en curso gana: la respuesta vieja se descarta', async () => {
      const resolvers = [];
      const { b, est } = crear({ respuestas: [() => new Promise((r) => { resolvers.push(r); }), () => new Promise((r) => { resolvers.push(r); })] });
      const vieja = b.refrescar();
      await Promise.resolve();
      const nueva = b.alResolver();
      await Promise.resolve();
      resolvers[1](okTotal(1));
      expect(await nueva).toEqual({ tipo: 'ok', total: 1 });
      resolvers[0](okTotal(9));
      expect(await vieja).toEqual({ tipo: 'obsoleta' });
      expect(est.pintados).toEqual([1]);
    });
  });

  describe('un fallo NO bloquea nada', () => {
    test('error de servidor o de red: conserva el ultimo valor, no lanza y la proxima entrada reintenta de inmediato', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), { status: 'error', code: 'SERVICE_UNAVAILABLE' }, () => Promise.reject(new Error('Failed to fetch')), okTotal(2)] });
      await b.refrescar();
      expect(await b.refrescar(true)).toEqual({ tipo: 'error' });
      expect(b.total()).toBe(3);
      expect(await b.refrescar()).toEqual({ tipo: 'error' });          // sin esperar el intervalo: el error no lo consume
      expect(b.total()).toBe(3);
      expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 2 });
      expect(est.pintados).toEqual([3, 2]);
      expect(est.sesion + est.deshabilitado).toBe(0);
    });

    test('una respuesta con dato invalido se trata como error (no pinta basura)', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), { status: 'ok', data: { total: 'muchas' } }] });
      await b.refrescar();
      expect((await b.refrescar(true)).tipo).toBe('error');
      expect(est.pintados).toEqual([3]);
    });

    test('sin valor previo, un fallo deja el indicador oculto (nunca un numero inventado)', async () => {
      const { b, est } = crear({ respuestas: [() => Promise.reject(new Error('x'))] });
      expect(await b.refrescar()).toEqual({ tipo: 'error' });
      expect(est.pintados).toEqual([]);
      expect(b.total()).toBeNull();
    });

    test('PERMISSION_DENIED del backend (permiso revocado): se oculta, sin cerrar sesion', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), { status: 'error', code: 'PERMISSION_DENIED' }] });
      await b.refrescar();
      expect(await b.refrescar(true)).toEqual({ tipo: 'sin_acceso' });
      expect(est.pintados).toEqual([3, null]);
      expect(est.sesion + est.deshabilitado).toBe(0);
    });
  });

  describe('sesion vencida', () => {
    test('UNAUTHORIZED: avisa a la app (que cierra sesion), oculta el indicador y no reintenta solo', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), { status: 'error', code: 'UNAUTHORIZED' }] });
      await b.refrescar();
      expect(await b.refrescar(true)).toEqual({ tipo: 'sesion' });
      expect(est.sesion).toBe(1);
      expect(est.deshabilitado).toBe(0);
      expect(est.pintados).toEqual([3, null]);
    });

    test('USER_DISABLED: va a la pantalla de usuario deshabilitado (no a cerrar sesion)', async () => {
      const { b, est } = crear({ respuestas: [{ status: 'error', code: 'USER_DISABLED' }] });
      expect(await b.refrescar()).toEqual({ tipo: 'sesion' });
      expect(est.deshabilitado).toBe(1);
      expect(est.sesion).toBe(0);
    });

    test('despues de reset() (logout) una respuesta tardia de la sesion anterior no pinta nada', async () => {
      let resolver;
      const { b, est } = crear({ respuestas: [() => new Promise((r) => { resolver = r; })] });
      const p = b.refrescar();
      await Promise.resolve();
      b.reset();
      resolver(okTotal(8));
      expect(await p).toEqual({ tipo: 'obsoleta' });
      expect(est.pintados).toEqual([null]);
    });

    test('reset() oculta, y el primer refresco de la sesion siguiente no espera el intervalo', async () => {
      const { b, est } = crear({ respuestas: [okTotal(3), okTotal(1)] });
      await b.refrescar();
      b.reset();
      expect(est.pintados).toEqual([3, null]);
      expect(b.total()).toBeNull();
      expect(await b.refrescar()).toEqual({ tipo: 'ok', total: 1 });
    });
  });
});
