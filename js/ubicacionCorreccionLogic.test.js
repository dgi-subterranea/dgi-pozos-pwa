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
    expect(r).toMatchObject({ tipo: 'error', code: 'FUERA_DE_MENDOZA', mensaje: L.UCORR_MENSAJES_ERROR.FUERA_DE_MENDOZA, sesionVencida: false });
    expect(r.mensaje).toMatch(/fuera de Mendoza/);
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

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Ingresar coordenadas (GMS / WGS84): interpretacion de los campos, validacion en vivo, payload exacto y mensajes. El modulo de conversion es el de la etapa 1.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('Ingresar coordenadas: evaluarEntradaGms (validacion en vivo, errores en contexto)', () => {
  const gms = (lat, lon) => ({ lat: Object.assign({ g: '', m: '', s: '', h: 'S' }, lat), lon: Object.assign({ g: '', m: '', s: '', h: 'O' }, lon) });
  const OK = gms({ g: '33', m: '20', s: '51,54' }, { g: '69', m: '8', s: '43.62' });

  test('los campos vacios (con los hemisferios por defecto S y O) no muestran NINGUN error: todavia no escribio nada', () => {
    const v = L.ubicacionCorreccionLogic_entradaGmsVacia();
    expect(v).toEqual({ lat: { g: '', m: '', s: '', h: 'S' }, lon: { g: '', m: '', s: '', h: 'O' } });
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(v);
    expect(r).toMatchObject({ estado: 'vacio', errores: {}, derivado: null, original: null });
    expect(L.ubicacionCorreccionLogic_evaluarEntradaGms(null).estado).toBe('vacio');
    expect(L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '  ' }, {})).estado).toBe('vacio');
  });

  test('valido: convierte a WGS84 (6 decimales y valor exacto), con coma o punto decimal, y arma el original numerico', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(OK);
    expect(r.estado).toBe('valido');
    expect(r.errores).toEqual({});
    expect(r.derivado).toMatchObject({ lat: -33.34765, lon: -69.14545 });
    expect(r.derivado.latExacta).toBeCloseTo(-(33 + 20 / 60 + 51.54 / 3600), 12);
    expect(r.derivado.lonExacta).toBeCloseTo(-(69 + 8 / 60 + 43.62 / 3600), 12);
    expect(r.original).toEqual({ lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } });
    expect(r.textoOriginal).toBe('33° 20\' 51.54" S, 69° 8\' 43.62" O');
    const conPunto = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '33', m: '20', s: '51.54' }, { g: '69', m: '8', s: '43,62' }));
    expect(conPunto.derivado).toEqual(r.derivado);
  });

  test('el ejemplo del pedido: 32° 53\' 10,2" S, 68° 50\' 25,4" O -> -32.886167, -68.840389', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '32', m: '53', s: '10,2' }, { g: '68', m: '50', s: '25,4' }));
    expect(r.estado).toBe('valido');
    expect([r.derivado.lat, r.derivado.lon]).toEqual([-32.886167, -68.840389]);
  });

  test('minutos y segundos vacios valen 0 (solo los grados son obligatorios)', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '33' }, { g: '69' }));
    expect(r.estado).toBe('valido');
    expect(r.original).toEqual({ lat: { g: 33, m: 0, s: 0, h: 'S' }, lon: { g: 69, m: 0, s: 0, h: 'O' } });
  });

  test('un eje valido y el otro sin escribir: "incompleto" (sin mensajes, sin propuesta)', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '33', m: '20', s: '51' }, {}));
    expect(r).toMatchObject({ estado: 'incompleto', errores: {}, derivado: null });
  });

  test.each([
    ['minutos = 60', gms({ g: '33', m: '60' }, { g: '69' }), 'lat', 'm', /minutos.*0 y 59/],
    ['minutos con decimales', gms({ g: '33', m: '20,5' }, { g: '69' }), 'lat', 'm', /minutos.*entero/],
    ['segundos = 60', gms({ g: '33', s: '60' }, { g: '69' }), 'lat', 's', /segundos.*menores que 60/],
    ['segundos no numericos', gms({ g: '33' }, { g: '69', s: 'abc' }), 'lon', 's', /segundos/],
    ['grados con decimales', gms({ g: '33,5' }, { g: '69' }), 'lat', 'g', /grados.*entero/],
    ['grados no numericos', gms({ g: 'treinta' }, { g: '69' }), 'lat', 'g', /grados/],
    ['grados negativos (el signo lo da el hemisferio)', gms({ g: '-33' }, { g: '69' }), 'lat', 'g', /negativos/],
    ['segundos negativos', gms({ g: '33', s: '-1' }, { g: '69' }), 'lat', 's', /negativos/],
    ['latitud con grados > 90', gms({ g: '91' }, { g: '69' }), 'lat', 'g', /entre 0 y 90/],
    ['longitud con grados > 180', gms({ g: '33' }, { g: '181' }), 'lon', 'g', /entre 0 y 180/],
    ['latitud con hemisferio E', gms({ g: '33', h: 'E' }, { g: '69' }), 'lat', 'h', /N o S/],
    ['longitud con hemisferio N', gms({ g: '33' }, { g: '69', h: 'N' }), 'lon', 'h', /E u O/],
    ['hemisferio vacio', gms({ g: '33', h: '' }, { g: '69' }), 'lat', 'h', /hemisferio/]
  ])('invalido: %s -> error en el eje y el campo correctos, sin propuesta', (_n, entrada, eje, campo, texto) => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(entrada);
    expect(r.estado).toBe('invalido');
    expect(r.errores[eje]).toMatch(texto);
    expect(r.campos[eje]).toBe(campo);
    expect(r.derivado).toBeNull();
    expect(r.original).toBeNull();
  });

  test('un error en un eje no se muestra si ese eje esta vacio; el otro eje SI informa el suyo', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({}, { g: '69', m: '75' }));
    expect(r.errores.lat).toBeUndefined();
    expect(r.errores.lon).toMatch(/minutos/);
    expect(r.estado).toBe('invalido');
  });

  test('hemisferio equivocado (lat N): fuera de Mendoza con la PISTA del hemisferio; no se corrige solo', () => {
    const entrada = gms({ g: '33', m: '20', s: '51.54', h: 'N' }, { g: '69', m: '8', s: '43.62' });
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(entrada);
    expect(r.estado).toBe('invalido');
    expect(r.errores.general).toMatch(/fuera de Mendoza/);
    expect(r.errores.general).toMatch(/hemisferio/i);
    expect(entrada.lat.h).toBe('N');                              // la entrada no se toca
    expect(r.derivado).toBeNull();
  });

  test('fuera de Mendoza (Buenos Aires, Chile, el origen): general, sin propuesta', () => {
    [gms({ g: '34', m: '36' }, { g: '58', m: '22' }), gms({ g: '33', m: '27' }, { g: '70', m: '45', h: 'O' }), gms({ g: '0', h: 'N' }, { g: '0', h: 'E' })].forEach((e) => {
      const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(e);
      expect(r.estado).toBe('invalido');
      expect(r.errores.general).toMatch(/fuera de Mendoza/);
    });
  });

  test('NO corrige silenciosamente: la entrada que se pasa no se modifica ni se normaliza', () => {
    const entrada = gms({ g: ' 33 ', m: '20', s: '99' }, { g: '69', h: 'o' });
    const copia = JSON.parse(JSON.stringify(entrada));
    L.ubicacionCorreccionLogic_evaluarEntradaGms(entrada);
    expect(entrada).toEqual(copia);
  });

  test('el original que sale es solo {lat:{g,m,s,h}, lon:{g,m,s,h}} con numeros y hemisferio en mayuscula', () => {
    const r = L.ubicacionCorreccionLogic_evaluarEntradaGms(gms({ g: '33', m: '20', s: '51,54', h: 's' }, { g: '69', m: '8', s: '43,62', h: 'o' }));
    expect(r.estado).toBe('valido');
    expect(Object.keys(r.original).sort()).toEqual(['lat', 'lon']);
    expect(Object.keys(r.original.lat).sort()).toEqual(['g', 'h', 'm', 's']);
    expect(typeof r.original.lat.g).toBe('number');
    expect(r.original.lat.h).toBe('S');
    expect(r.original.lon.h).toBe('O');
  });
});

describe('Ingresar coordenadas: evaluarPropuesta y payload de COORDENADAS_GMS', () => {
  const ORIGINAL = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };
  const EXACTO = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '51.54', h: 'S' }, lon: { g: '69', m: '8', s: '43.62', h: 'O' } }).derivado;
  const VALORES_GMS = (extra) => Object.assign({
    lat: EXACTO.latExacta, lon: EXACTO.lonExacta, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: '', coordenadaOriginal: ORIGINAL, irrigacion: IRR
  }, extra || {});

  test('el catalogo del frontend incluye COORDENADAS_GMS con la etiqueta "Coordenadas GMS / WGS84"', () => {
    expect(L.UCORR_METODOS).toContain('COORDENADAS_GMS');
    expect(L.ubicacionCorreccionLogic_etiquetaMetodo('COORDENADAS_GMS')).toBe('Coordenadas GMS / WGS84');
    expect(L.UCORR_SISTEMAS_COORDENADAS[0]).toMatchObject({ id: 'GMS', metodo: 'COORDENADAS_GMS', etiqueta: 'GMS / WGS84' });
  });

  test('propuesta valida: ok, con distancia orientativa calculada sobre el punto redondeado', () => {
    const ev = L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS());
    expect(ev.ok).toBe(true);
    expect(ev.distanciaM).toBeLessThan(0.5);
  });

  test('>250 m exige observacion y >1 km agrega la advertencia fuerte (mismas reglas que GPS y mapa)', () => {
    const g300 = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '41', h: 'S' }, lon: { g: '69', m: '8', s: '43.62', h: 'O' } });
    const v300 = VALORES_GMS({ lat: g300.derivado.latExacta, lon: g300.derivado.lonExacta, coordenadaOriginal: g300.original });
    const e300 = L.ubicacionCorreccionLogic_evaluarPropuesta(v300);
    expect(e300.distanciaM).toBeGreaterThan(250);
    expect(e300.observacionObligatoria).toBe(true);
    expect(e300.advertenciaFuerte).toBe(false);
    expect(e300.ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({}, v300, { observacion: 'motivo' })).ok).toBe(true);
    const g1k = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '11', h: 'S' }, lon: { g: '69', m: '8', s: '43.62', h: 'O' } });
    const e1k = L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ lat: g1k.derivado.latExacta, lon: g1k.derivado.lonExacta, coordenadaOriginal: g1k.original, observacion: 'lejos' }));
    expect(e1k.advertenciaFuerte).toBe(true);
    expect(e1k.ok).toBe(true);
  });

  test('sin ubicacion de Irrigacion: se puede continuar sin distancia', () => {
    const ev = L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ irrigacion: null }));
    expect(ev).toMatchObject({ ok: true, distanciaM: null, observacionObligatoria: false });
  });

  test('FAIL-CLOSED: si el punto ya no es la conversion de lo ingresado, o falta/esta mal el original, NO es una propuesta valida de COORDENADAS_GMS', () => {
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ lat: EXACTO.latExacta + 0.0001 })).errores.punto).toBeTruthy();
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ coordenadaOriginal: undefined })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ coordenadaOriginal: { lat: { g: 33, m: 60, s: 0, h: 'S' }, lon: ORIGINAL.lon } })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ coordenadaOriginal: { lat: Object.assign({}, ORIGINAL.lat, { h: 'N' }), lon: ORIGINAL.lon } })).ok).toBe(false);
  });

  test('un metodo que NO es de coordenadas con coordenadaOriginal tampoco es valido (nunca viaja un original junto a un punto movido)', () => {
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ metodo: 'PUNTO_EN_MAPA' })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VALORES_GMS({ metodo: 'PUNTO_EN_MAPA', coordenadaOriginal: undefined })).ok).toBe(true);
  });

  test('payload de COORDENADAS_GMS: EXACTAMENTE 8 campos, lat/lon SIN redondear y coordenadaOriginal estructurada', () => {
    const p = L.ubicacionCorreccionLogic_construirPayload(W, VALORES_GMS({ observacion: ' nota ' }), 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(p).toMatchObject({ wellId: W, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: 'nota', clientRequestId: 'ucorr-abc12345' });
    expect(p.lat).toBe(EXACTO.latExacta);
    expect(p.lon).toBe(EXACTO.lonExacta);
    // con segundos que NO caen en la grilla de 6 decimales, redondear perderia hasta ~5,5 cm: el payload manda el valor exacto
    const fino = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '51.541764', h: 'S' }, lon: { g: '69', m: '8', s: '43.62', h: 'O' } });
    const pf = L.ubicacionCorreccionLogic_construirPayload(W, VALORES_GMS({ lat: fino.derivado.latExacta, lon: fino.derivado.lonExacta, coordenadaOriginal: fino.original }), 'ucorr-abc12345');
    expect(pf.lat).toBe(fino.derivado.latExacta);
    expect(pf.lat).not.toBe(Math.round(pf.lat * 1e6) / 1e6);
    expect(p.coordenadaOriginal).toEqual(ORIGINAL);
    expect(Object.keys(p.coordenadaOriginal.lat).sort()).toEqual(['g', 'h', 'm', 's']);
  });

  test('el payload NO lleva coordenadaOriginalTexto, crsOriginal, distancia, estado, email, nombre ni flags, aunque "valores" los traiga', () => {
    const sucio = VALORES_GMS({
      coordenadaOriginalTexto: 'X', crsOriginal: 'Y', distanciaM: 1, estado: 'VALIDADA', email: 'a@x.com', nombre: 'Ana', autoValidar: true, validada: true,
      coordenadaOriginal: Object.assign({ coordenadaOriginalTexto: 'Z', extra: 1 }, { lat: Object.assign({ x: 1 }, ORIGINAL.lat), lon: ORIGINAL.lon })
    });
    const p = L.ubicacionCorreccionLogic_construirPayload(W, sucio, 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(Object.keys(p.coordenadaOriginal).sort()).toEqual(['lat', 'lon']);
    expect(Object.keys(p.coordenadaOriginal.lat).sort()).toEqual(['g', 'h', 'm', 's']);
    expect(JSON.stringify(p)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|distancia|estado|email|nombre|autoValid|validada|"x"|extra/);
  });

  test('GPS y mapa siguen mandando SIEMPRE los 7 campos de antes (sin coordenadaOriginal) y lat/lon redondeados a 6 decimales', () => {
    ['GPS_ACTUAL', 'PUNTO_EN_MAPA'].forEach((metodo) => {
      const p = L.ubicacionCorreccionLogic_construirPayload(W, { lat: -33.3474512345, lon: -69.1454512345, metodo, precisionGpsM: 8.44, observacion: '', coordenadaOriginal: ORIGINAL }, 'ucorr-abc12345');
      expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
      expect([p.lat, p.lon]).toEqual([-33.347451, -69.145451]);
    });
  });

  test('la firma incluye la coordenada ingresada: cambiar un segundo es OTRO contenido; lo mismo es lo mismo', () => {
    const a = L.ubicacionCorreccionLogic_construirPayload(W, VALORES_GMS(), 'a');
    const b = L.ubicacionCorreccionLogic_construirPayload(W, VALORES_GMS(), 'b');
    const otra = L.ubicacionCorreccionLogic_construirPayload(W, VALORES_GMS({ coordenadaOriginal: { lat: Object.assign({}, ORIGINAL.lat, { s: 52 }), lon: ORIGINAL.lon } }), 'c');
    expect(L.ubicacionCorreccionLogic_firmaPayload(a)).toBe(L.ubicacionCorreccionLogic_firmaPayload(b));
    expect(L.ubicacionCorreccionLogic_firmaPayload(a)).not.toBe(L.ubicacionCorreccionLogic_firmaPayload(otra));
  });

  test('flujo de guardado: el reintento del MISMO contenido reutiliza el clientRequestId; si cambia el original, es otro; guardado ok -> otro intento', async () => {
    const enviados = [];
    let n = 0;
    let falla = true;
    const flujo = L.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: (p) => { enviados.push(p); return falla ? Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) : Promise.resolve({ status: 'ok', data: { correccion: { estado: 'PROPUESTA' }, duplicada: false } }); },
      leer: () => Promise.resolve({ status: 'ok', data: { vigente: null, pendientes: [], historial: [] } }),
      generarId: () => { n += 1; return 'ucorr-id-' + n; }
    });
    await flujo.guardar(W, VALORES_GMS());
    await flujo.guardar(W, VALORES_GMS());
    expect(enviados.map((p) => p.clientRequestId)).toEqual(['ucorr-id-1', 'ucorr-id-1']);
    const g52 = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '52', h: 'S' }, lon: { g: '69', m: '8', s: '43.62', h: 'O' } });
    const OTRA = () => VALORES_GMS({ lat: g52.derivado.latExacta, lon: g52.derivado.lonExacta, coordenadaOriginal: g52.original });
    await flujo.guardar(W, OTRA());                                    // otro segundo = otro contenido = otro clientRequestId
    expect(enviados[2].clientRequestId).toBe('ucorr-id-2');
    falla = false;
    const ok = await flujo.guardar(W, OTRA());                         // reintento del mismo contenido: reutiliza el id y esta vez guarda
    expect(ok).toMatchObject({ tipo: 'ok', resultado: 'pendiente' });
    expect(enviados[3].clientRequestId).toBe('ucorr-id-2');
    await flujo.guardar(W, OTRA());                                    // guardado ok: el proximo es otro intento
    expect(enviados[4].clientRequestId).toBe('ucorr-id-3');
  });

  test('doble guardado simultaneo: una sola llamada', async () => {
    let llamadas = 0;
    const flujo = L.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: () => { llamadas += 1; return new Promise((r) => setTimeout(() => r({ status: 'ok', data: { correccion: { estado: 'PROPUESTA' } } }), 5)); },
      leer: () => Promise.resolve({ status: 'ok', data: {} }),
      generarId: () => 'ucorr-unico-1'
    });
    const [a, b] = await Promise.all([flujo.guardar(W, VALORES_GMS()), flujo.guardar(W, VALORES_GMS())]);
    expect(llamadas).toBe(1);
    expect(a).toBe(b);
  });
});

describe('Ingresar coordenadas: mensajes de error amigables', () => {
  test.each([
    ['COORDENADA_INVALIDA', /coordenada ingresada no es válida/],
    ['XY_INVERTIDOS', /X e Y están intercambiados/],
    ['COORDENADA_INCONSISTENTE', /no coincide con el punto calculado/],
    ['INVALID_COORDENADA_ORIGINAL', /No se pudo interpretar la coordenada/],
    ['ESQUEMA_DESACTUALIZADO', /todavía no está disponible/],
    ['FUERA_DE_MENDOZA', /fuera de Mendoza/]
  ])('%s tiene mensaje propio, en espanol y sin el codigo tecnico', (code, texto) => {
    const m = L.ubicacionCorreccionLogic_mensajeError(code, { message: 'texto tecnico del backend', detalle: 'MINUTOS_FUERA_DE_RANGO' });
    expect(m).toMatch(texto);
    expect(m).not.toMatch(new RegExp(code));
    expect(m).not.toMatch(/tecnico|MINUTOS|_/);
    expect(m).not.toBe(L.ubicacionCorreccionLogic_mensajeError('__nunca__'));
  });
});

describe('Ingresar coordenadas: ficha e historial muestran el valor original (secundario) sin reemplazar la lat/lon', () => {
  const GMS_CORR = {
    correccionId: '33333333-3333-4333-8333-333333333333', wellId: W, lat: -33.34765, lon: -69.14545, metodo: 'COORDENADAS_GMS', precisionGpsM: null,
    coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O', crsOriginal: 'GMS_WGS84', observacion: '', nombrePropone: 'Ana Pérez',
    timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 0.1, advertenciaDistancia: false, estado: 'VALIDADA', resolucion: null, propia: false
  };
  const VIEJA = Object.assign({}, GMS_CORR, { correccionId: '44444444-4444-4444-8444-444444444444', metodo: 'PUNTO_EN_MAPA', coordenadaOriginalTexto: '', crsOriginal: '' });
  const SIN_CAMPOS = (() => { const c = Object.assign({}, VIEJA); delete c.coordenadaOriginalTexto; delete c.crsOriginal; return c; })();

  test('la tarjeta muestra "Coordenadas GMS / WGS84", el valor original y el sistema, ademas de la lat/lon normalizada', () => {
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(GMS_CORR, { modo: 'vigente' });
    expect(h).toContain('Coordenadas GMS / WGS84');
    expect(h).toContain('-33.34765, -69.14545');
    expect(h).toContain('Coordenada ingresada');
    expect(h).toContain('33° 20&#39; 51.54&quot; S, 69° 8&#39; 43.62&quot; O');
    expect(h).toContain('GMS / WGS84');
    expect(h).toContain('ucorr-dato-original');
    expect(h.indexOf('-33.34765, -69.14545')).toBeLessThan(h.indexOf('Coordenada ingresada'));
  });

  test('filas historicas con los campos vacios o AUSENTES se ven como siempre (sin fila de coordenada ingresada)', () => {
    [VIEJA, SIN_CAMPOS].forEach((c) => {
      const h = L.ubicacionCorreccionLogic_htmlTarjeta(c, { modo: 'historial' });
      expect(h).not.toContain('Coordenada ingresada');
      expect(h).not.toContain('ucorr-dato-original');
      expect(h).toContain('Elegida en mapa');
      expect(h).not.toMatch(/undefined|null/);
    });
  });

  test('el texto original se escapa (nunca HTML sin escapar)', () => {
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(Object.assign({}, GMS_CORR, { coordenadaOriginalTexto: '<img src=x onerror=alert(1)>', crsOriginal: '<b>' }), { modo: 'historial' });
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });

  test('la seccion con vigente GMS y un historial mixto (GMS + mapa) pinta ambos', () => {
    const h = L.ubicacionCorreccionLogic_htmlSeccion({ vigente: GMS_CORR, pendientes: [], historial: [GMS_CORR, VIEJA] }, { puedeCorregir: true });
    expect(h.match(/Coordenada ingresada/g)).toHaveLength(2);          // en la vigente y en su fila del historial; la fila vieja no suma
    expect(h).toContain('Elegida en mapa');
    expect(h).toContain('Coordenadas GMS / WGS84');
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Etapa 4: Ingresar coordenadas con POSGAR 94 / Argentina 2 (EPSG:22182). X = Este, Y = Norte.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('POSGAR: catalogo, sistemas y etiquetas', () => {
  test('el frontend conoce los 4 metodos del backend; los sistemas son GMS y POSGAR', () => {
    expect(L.UCORR_METODOS).toEqual(['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2']);
    expect(L.UCORR_SISTEMAS_COORDENADAS.map((s) => s.id)).toEqual(['GMS', 'POSGAR']);
    expect(L.ubicacionCorreccionLogic_sistemaPorId('POSGAR')).toMatchObject({ metodo: 'COORDENADAS_POSGAR94_AR2', etiqueta: 'POSGAR 94 / Argentina 2', etiquetaLarga: 'POSGAR 94 / Argentina 2 · EPSG:22182' });
    expect(L.ubicacionCorreccionLogic_sistemaPorMetodo('COORDENADAS_GMS').id).toBe('GMS');
    expect(L.ubicacionCorreccionLogic_sistemaPorMetodo('COORDENADAS_POSGAR94_AR2').id).toBe('POSGAR');
    ['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'otro', undefined, null].forEach((m) => expect(L.ubicacionCorreccionLogic_sistemaPorMetodo(m)).toBeNull());
    expect(L.ubicacionCorreccionLogic_sistemaPorId('UTM')).toBeNull();
  });

  test('etiquetas: "Coordenadas POSGAR 94 / Argentina 2" y el sistema "POSGAR 94 / Argentina 2 · EPSG:22182"', () => {
    expect(L.ubicacionCorreccionLogic_etiquetaMetodo('COORDENADAS_POSGAR94_AR2')).toBe('Coordenadas POSGAR 94 / Argentina 2');
    expect(L.ubicacionCorreccionLogic_etiquetaCrs('EPSG:22182')).toBe('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(L.ubicacionCorreccionLogic_etiquetaCrs('GMS_WGS84')).toBe('GMS / WGS84');
    expect(L.ubicacionCorreccionLogic_etiquetaCrs('')).toBe('');
    expect(L.ubicacionCorreccionLogic_etiquetaCrs('algo-raro')).toBe('');
  });

  test('la ayuda de la convencion es la pedida, sin cambiar de convencion', () => {
    expect(L.UCORR_TEXTO_AYUDA_XY).toBe('En esta aplicación se ingresa X = Este e Y = Norte.');
  });
});

describe('POSGAR: evaluarEntradaPosgar (validacion en vivo)', () => {
  const P = (x, y) => L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x, y });

  test('campos vacios: sin errores; con un solo eje bien escrito: "incompleto", sin errores ni propuesta', () => {
    expect(L.ubicacionCorreccionLogic_entradaPosgarVacia()).toEqual({ x: '', y: '' });
    expect(P('', '')).toMatchObject({ estado: 'vacio', errores: {}, derivado: null, original: null });
    expect(P('  ', '')).toMatchObject({ estado: 'vacio' });
    expect(P('2500000', '')).toMatchObject({ estado: 'incompleto', errores: {}, derivado: null });
    expect(P('', '6350000')).toMatchObject({ estado: 'incompleto', errores: {}, derivado: null });
    expect(L.ubicacionCorreccionLogic_evaluarEntradaPosgar(null).estado).toBe('vacio');
  });

  test.each([
    ['entero', '2500000', '6350000', 2500000, 6350000],
    ['punto decimal', '2500000.50', '6350000.25', 2500000.5, 6350000.25],
    ['coma decimal', '2500000,50', '6350000,25', 2500000.5, 6350000.25],
    ['separador de miles', '2.500.000', '6.350.000', 2500000, 6350000],
    ['formato argentino 2.500.000,50', '2.500.000,50', '6.350.000,25', 2500000.5, 6350000.25],
    ['con espacios', ' 2 500 000 ', ' 6 350 000,5 ', 2500000, 6350000.5],
    ['numeros', 2500000, 6350000, 2500000, 6350000]
  ])('valido (%s): se convierte y el original viaja como numeros', (_n, x, y, nx, ny) => {
    const r = P(x, y);
    expect(r.estado).toBe('valido');
    expect(r.errores).toEqual({});
    expect(r.original).toEqual({ x: nx, y: ny });
    expect(r.invertido).toBe(false);
    const tec = L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: nx, y: ny });
    expect(r.derivado).toEqual(tec.derivado);                     // cualquier escritura del mismo numero da el MISMO punto
  });

  test('transformacion conocida (pyproj): X(Este)=2500000, Y(Norte)=6350000 -> -32.992946, -69', () => {
    const r = P('2.500.000', '6.350.000');
    expect([r.derivado.lat, r.derivado.lon]).toEqual([-32.992946, -69]);
    expect(r.textoOriginal).toBe('X(Este)=2500000.00, Y(Norte)=6350000.00');
    expect(P('2.500.000,50', '6.350.000').textoOriginal).toBe('X(Este)=2500000.50, Y(Norte)=6350000.00');
  });

  test('el derivado trae el valor EXACTO (sin redondear) ademas del redondeado a 6 decimales', () => {
    const r = P('2400000,123', '6200000,456');
    expect(r.derivado.lat).toBe(Math.round(r.derivado.latExacta * 1e6) / 1e6);
    expect(r.derivado.latExacta).not.toBe(r.derivado.lat);
  });

  test.each([
    ['X no numerico', 'abc', '6350000', 'x', /X \/ Este.*número/],
    ['Y no numerico', '2500000', '12a', 'y', /Y \/ Norte.*número/],
    ['X con notacion cientifica', '2.5e6', '6350000', 'x', /X \/ Este/],
    ['X NaN', 'NaN', '6350000', 'x', /X \/ Este/],
    ['Y Infinity', '2500000', 'Infinity', 'y', /Y \/ Norte/],
    ['X con dos separadores raros', '2.500.00', '6350000', 'x', /X \/ Este/],
    ['Y con miles mal formados', '2500000', '6.35.000', 'y', /Y \/ Norte/],
    ['X fuera de rango (muy chico)', '100', '6350000', 'x', /fuera de rango/],
    ['X fuera de rango (muy grande)', '3500000', '6350000', 'x', /fuera de rango/],
    ['Y fuera de rango', '2500000', '5000000', 'y', /fuera de rango/],
    ['X con un solo grupo de miles (ambiguo)', '2.500', '6350000', 'x', /fuera de rango/]
  ])('invalido: %s -> error EN el campo, sin propuesta', (_n, x, y, campo, texto) => {
    const r = P(x, y);
    expect(r.estado).toBe('invalido');
    expect(r.errores[campo]).toMatch(texto);
    expect(r.derivado).toBeNull();
    expect(r.original).toBeNull();
    expect(r.invertido).toBe(false);
  });

  test('un solo eje escrito y con error: el error se muestra YA (sin esperar al otro eje)', () => {
    expect(P('100', '')).toMatchObject({ estado: 'invalido' });
    expect(P('100', '').errores.x).toMatch(/fuera de rango/);
    expect(P('', 'abc').errores.y).toMatch(/número/);
    expect(P('100', '').errores.y).toBeUndefined();
  });

  test('dentro del rango pero fuera de la caja de Mendoza (esquina SO): error general; nunca se acepta', () => {
    const r = P('2300000', '5800000');
    expect(r.estado).toBe('invalido');
    expect(r.errores.general).toMatch(/fuera de Mendoza/);
    expect(r.derivado).toBeNull();
    expect(r.invertido).toBe(false);
  });

  test('negativos: error general', () => {
    const r = P('-2500000', '6350000');
    expect(r.estado).toBe('invalido');
    expect(r.errores.general || r.errores.x).toBeTruthy();
  });

  test('X/Y INVERTIDOS: invalido + invertido:true + sugerencia, SIN corregir nada', () => {
    const entrada = { x: '6.350.000', y: '2.500.000' };
    const copia = JSON.parse(JSON.stringify(entrada));
    const r = L.ubicacionCorreccionLogic_evaluarEntradaPosgar(entrada);
    expect(r.estado).toBe('invalido');
    expect(r.invertido).toBe(true);
    expect(r.errores.general).toMatch(/X e Y están intercambiados/);
    expect(r.sugerencia).toEqual({ x: 2500000, y: 6350000 });
    expect(r.derivado).toBeNull();
    expect(r.original).toBeNull();
    expect(entrada).toEqual(copia);                                   // la entrada no se toca
  });

  test('intercambiarXY intercambia los textos TAL CUAL (sin reformatear) y es lo unico que lo hace', () => {
    expect(L.ubicacionCorreccionLogic_intercambiarXY({ x: '6.350.000,5', y: '2500000' })).toEqual({ x: '2500000', y: '6.350.000,5' });
    expect(L.ubicacionCorreccionLogic_intercambiarXY({ x: 'a', y: undefined })).toEqual({ x: '', y: 'a' });
    const inv = { x: '6350000', y: '2500000' };
    const luego = L.ubicacionCorreccionLogic_evaluarEntradaPosgar(L.ubicacionCorreccionLogic_intercambiarXY(inv));
    expect(luego.estado).toBe('valido');
    expect(luego.original).toEqual({ x: 2500000, y: 6350000 });
    // evaluar NUNCA intercambia: el mismo par invertido sigue invalido una y otra vez
    expect(L.ubicacionCorreccionLogic_evaluarEntradaPosgar(inv).estado).toBe('invalido');
    expect(L.ubicacionCorreccionLogic_evaluarEntradaPosgar(inv).estado).toBe('invalido');
  });

  test('evaluarEntrada despacha por sistema y entradaVacia da la forma de cada uno', () => {
    expect(L.ubicacionCorreccionLogic_entradaVacia('GMS')).toEqual(L.ubicacionCorreccionLogic_entradaGmsVacia());
    expect(L.ubicacionCorreccionLogic_entradaVacia('POSGAR')).toEqual({ x: '', y: '' });
    expect(L.ubicacionCorreccionLogic_evaluarEntrada('POSGAR', { x: '2500000', y: '6350000' }).estado).toBe('valido');
    expect(L.ubicacionCorreccionLogic_evaluarEntrada('GMS', { x: '2500000', y: '6350000' }).estado).toBe('vacio');       // no reutiliza valores del otro sistema
    expect(L.ubicacionCorreccionLogic_evaluarEntrada('POSGAR', L.ubicacionCorreccionLogic_entradaGmsVacia()).estado).toBe('vacio');
  });
});

describe('POSGAR: evaluarPropuesta, payload y flujo de guardado', () => {
  const EV = L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: '2.500.000,50', y: '6.350.000,25' });
  const OFICIAL_POS = { lat: EV.derivado.lat, lon: EV.derivado.lon };
  const VAL = (extra) => Object.assign({
    lat: EV.derivado.latExacta, lon: EV.derivado.lonExacta, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null, observacion: '', coordenadaOriginal: EV.original, irrigacion: OFICIAL_POS
  }, extra || {});

  test('propuesta valida: ok y distancia orientativa', () => {
    const ev = L.ubicacionCorreccionLogic_evaluarPropuesta(VAL());
    expect(ev.ok).toBe(true);
    expect(ev.distanciaM).toBeLessThan(0.5);
  });

  test('>250 m exige observacion; >1 km advertencia fuerte; sin Irrigacion se continua sin distancia', () => {
    const lejos = (m) => { const e = L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: '2500000.5', y: String(6350000.25 + m) }); return VAL({ lat: e.derivado.latExacta, lon: e.derivado.lonExacta, coordenadaOriginal: e.original }); };
    const e300 = L.ubicacionCorreccionLogic_evaluarPropuesta(lejos(300));
    expect(e300.distanciaM).toBeGreaterThan(290);
    expect(e300.observacionObligatoria).toBe(true);
    expect(e300.advertenciaFuerte).toBe(false);
    expect(e300.ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign(lejos(300), { observacion: 'motivo' })).ok).toBe(true);
    const e1500 = L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign(lejos(1500), { observacion: 'lejos' }));
    expect(e1500.advertenciaFuerte).toBe(true);
    expect(e1500.ok).toBe(true);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ irrigacion: null }))).toMatchObject({ ok: true, distanciaM: null, observacionObligatoria: false });
  });

  test('FAIL-CLOSED: si el punto ya no es la conversion de X/Y, o el original falta o es de otro sistema, NO es una propuesta valida', () => {
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ lat: EV.derivado.latExacta + 0.0001 })).errores.punto).toBeTruthy();
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ coordenadaOriginal: undefined })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ coordenadaOriginal: { x: 6350000, y: 2500000 } })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ coordenadaOriginal: { lat: { g: 33, m: 0, s: 0, h: 'S' }, lon: { g: 69, m: 0, s: 0, h: 'O' } } })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_puntoCoincideConCoordenada('COORDENADAS_POSGAR94_AR2', EV.original, EV.derivado.latExacta, EV.derivado.lonExacta)).toBe(true);
    expect(L.ubicacionCorreccionLogic_puntoCoincideConCoordenada('COORDENADAS_GMS', EV.original, EV.derivado.latExacta, EV.derivado.lonExacta)).toBe(false);
  });

  test('un punto movido a mano (PUNTO_EN_MAPA) con coordenadaOriginal POSGAR NO es valido (el original no viaja)', () => {
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ metodo: 'PUNTO_EN_MAPA' })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(VAL({ metodo: 'PUNTO_EN_MAPA', coordenadaOriginal: undefined })).ok).toBe(true);
  });

  test('payload: 8 campos, lat/lon de MAXIMA precision (sin redondear) y coordenadaOriginal {x, y} numerica', () => {
    const p = L.ubicacionCorreccionLogic_construirPayload(W, VAL({ observacion: ' nota ' }), 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(p).toMatchObject({ wellId: W, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null, observacion: 'nota', clientRequestId: 'ucorr-abc12345' });
    expect(p.lat).toBe(EV.derivado.latExacta);
    expect(p.lon).toBe(EV.derivado.lonExacta);
    expect(p.lat).not.toBe(EV.derivado.lat);
    expect(p.coordenadaOriginal).toEqual({ x: 2500000.5, y: 6350000.25 });
    expect(Object.keys(p.coordenadaOriginal).sort()).toEqual(['x', 'y']);
    expect(typeof p.coordenadaOriginal.x).toBe('number');
  });

  test('el payload NO lleva coordenadaOriginalTexto, crsOriginal, distancia, estado, email, nombre ni flags, aunque "valores" los traiga', () => {
    const p = L.ubicacionCorreccionLogic_construirPayload(W, VAL({
      coordenadaOriginalTexto: 'X', crsOriginal: 'Y', distanciaM: 1, estado: 'VALIDADA', email: 'a@x.com', nombre: 'Ana', autoValidar: true, coordenadaOriginal: { x: 2500000.5, y: 6350000.25, z: 9, crsOriginal: 'E' }
    }), 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(Object.keys(p.coordenadaOriginal).sort()).toEqual(['x', 'y']);
    expect(JSON.stringify(p)).not.toMatch(/coordenadaOriginalTexto|crsOriginal|distancia|estado|email|nombre|autoValid|"z"/);
  });

  test('la firma incluye {x, y}: cambiar un metro es otro contenido; lo mismo es lo mismo; GMS y POSGAR nunca comparten firma', () => {
    const a = L.ubicacionCorreccionLogic_construirPayload(W, VAL(), 'a');
    const b = L.ubicacionCorreccionLogic_construirPayload(W, VAL(), 'b');
    const e2 = L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: '2500001.5', y: '6350000.25' });
    const c = L.ubicacionCorreccionLogic_construirPayload(W, VAL({ lat: e2.derivado.latExacta, lon: e2.derivado.lonExacta, coordenadaOriginal: e2.original }), 'c');
    expect(L.ubicacionCorreccionLogic_firmaPayload(a)).toBe(L.ubicacionCorreccionLogic_firmaPayload(b));
    expect(L.ubicacionCorreccionLogic_firmaPayload(a)).not.toBe(L.ubicacionCorreccionLogic_firmaPayload(c));
  });

  test('flujo de guardado: reintento del MISMO contenido reutiliza el clientRequestId; otro X/Y es otro id; guardado ok -> otro intento', async () => {
    const enviados = [];
    let n = 0;
    let falla = true;
    const flujo = L.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: (p) => { enviados.push(p); return falla ? Promise.resolve({ status: 'error', code: 'SERVICE_UNAVAILABLE' }) : Promise.resolve({ status: 'ok', data: { correccion: { estado: 'PROPUESTA' } } }); },
      leer: () => Promise.resolve({ status: 'ok', data: { vigente: null, pendientes: [], historial: [] } }),
      generarId: () => { n += 1; return 'ucorr-id-' + n; }
    });
    await flujo.guardar(W, VAL());
    await flujo.guardar(W, VAL());
    expect(enviados.map((p) => p.clientRequestId)).toEqual(['ucorr-id-1', 'ucorr-id-1']);
    const e2 = L.ubicacionCorreccionLogic_evaluarEntradaPosgar({ x: '2500001.5', y: '6350000.25' });
    const OTRO = () => VAL({ lat: e2.derivado.latExacta, lon: e2.derivado.lonExacta, coordenadaOriginal: e2.original });
    await flujo.guardar(W, OTRO());
    expect(enviados[2].clientRequestId).toBe('ucorr-id-2');
    falla = false;
    expect(await flujo.guardar(W, OTRO())).toMatchObject({ tipo: 'ok', resultado: 'pendiente' });
    expect(enviados[3].clientRequestId).toBe('ucorr-id-2');
    await flujo.guardar(W, OTRO());
    expect(enviados[4].clientRequestId).toBe('ucorr-id-3');
  });

  test('XY_INVERTIDOS del backend tiene mensaje amigable en el frontend', () => {
    expect(L.ubicacionCorreccionLogic_mensajeError('XY_INVERTIDOS')).toMatch(/X e Y están intercambiados/);
  });
});

describe('POSGAR: ficha e historial', () => {
  const POS_CORR = {
    correccionId: '55555555-5555-4555-8555-555555555555', wellId: W, lat: -32.992946, lon: -69, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null,
    coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182', observacion: '', nombrePropone: 'Ana Pérez',
    timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 10, advertenciaDistancia: false, estado: 'VALIDADA', resolucion: null, propia: false
  };

  test('la tarjeta muestra el metodo, la coordenada ingresada y el sistema (secundarios); la lat/lon normalizada sigue siendo lo principal', () => {
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(POS_CORR, { modo: 'vigente' });
    expect(h).toContain('Coordenadas POSGAR 94 / Argentina 2');
    expect(h).toContain('-32.992946, -69');
    expect(h).toContain('Coordenada ingresada');
    expect(h).toContain('X(Este)=2500000.00, Y(Norte)=6350000.00');
    expect(h).toContain('<dt>Sistema</dt>');
    expect(h).toContain('POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(h.indexOf('-32.992946, -69')).toBeLessThan(h.indexOf('Coordenada ingresada'));
    expect(h.indexOf('Coordenada ingresada')).toBeLessThan(h.indexOf('<dt>Sistema</dt>'));
  });

  test('GMS tambien muestra su sistema en fila aparte; las filas historicas sin campos no muestran ni coordenada ni sistema', () => {
    const gms = L.ubicacionCorreccionLogic_htmlTarjeta(Object.assign({}, POS_CORR, { metodo: 'COORDENADAS_GMS', coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O', crsOriginal: 'GMS_WGS84' }), { modo: 'historial' });
    expect(gms).toContain('<dt>Sistema</dt>');
    expect(gms).toContain('GMS / WGS84');
    const vieja = Object.assign({}, POS_CORR, { metodo: 'PUNTO_EN_MAPA', coordenadaOriginalTexto: '', crsOriginal: '' });
    delete vieja.crsOriginal;
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(vieja, { modo: 'historial' });
    expect(h).not.toContain('Coordenada ingresada');
    expect(h).not.toContain('<dt>Sistema</dt>');
    expect(h).not.toMatch(/undefined|null/);
  });

  test('un crsOriginal desconocido no muestra la fila "Sistema"; un texto con HTML se escapa', () => {
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(Object.assign({}, POS_CORR, { crsOriginal: 'raro', coordenadaOriginalTexto: '<b>x</b>' }), { modo: 'historial' });
    expect(h).not.toContain('<dt>Sistema</dt>');
    expect(h).not.toContain('<b>x</b>');
    expect(h).toContain('&lt;b&gt;');
  });
});

describe('REGRESION GMS, GPS y mapa al sumar POSGAR', () => {
  test('GMS sigue valido, con el mismo payload de 8 campos', () => {
    const ev = L.ubicacionCorreccionLogic_evaluarEntradaGms({ lat: { g: '33', m: '20', s: '51,54', h: 'S' }, lon: { g: '69', m: '8', s: '43,62', h: 'O' } });
    expect(ev.estado).toBe('valido');
    const p = L.ubicacionCorreccionLogic_construirPayload(W, { lat: ev.derivado.latExacta, lon: ev.derivado.lonExacta, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: '', coordenadaOriginal: ev.original }, 'ucorr-abc12345');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'coordenadaOriginal', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
    expect(Object.keys(p.coordenadaOriginal).sort()).toEqual(['lat', 'lon']);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta({ lat: ev.derivado.latExacta, lon: ev.derivado.lonExacta, metodo: 'COORDENADAS_GMS', precisionGpsM: null, observacion: '', coordenadaOriginal: ev.original, irrigacion: IRR }).ok).toBe(true);
  });

  test('un GMS no acepta un original POSGAR ni al reves; GPS y mapa no aceptan ningun original', () => {
    const pos = { x: 2500000, y: 6350000 };
    const gms = { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } };
    const base = { lat: -33.34765, lon: -69.14545, precisionGpsM: null, observacion: '', irrigacion: IRR };
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({}, base, { metodo: 'COORDENADAS_GMS', coordenadaOriginal: pos })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({}, base, { metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginal: gms })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({}, base, { metodo: 'PUNTO_EN_MAPA', coordenadaOriginal: pos })).ok).toBe(false);
    expect(L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({}, base, { metodo: 'GPS_ACTUAL', precisionGpsM: 8, coordenadaOriginal: gms })).ok).toBe(false);
  });

  test('GPS y mapa: payload de 7 campos con lat/lon a 6 decimales, como siempre', () => {
    ['GPS_ACTUAL', 'PUNTO_EN_MAPA'].forEach((metodo) => {
      const p = L.ubicacionCorreccionLogic_construirPayload(W, { lat: -33.3474512345, lon: -69.1454512345, metodo, precisionGpsM: 8.44, observacion: '', coordenadaOriginal: { x: 1, y: 2 } }, 'ucorr-abc12345');
      expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
      expect([p.lat, p.lon]).toEqual([-33.347451, -69.145451]);
    });
  });

  test('las reglas de distancia / observacion son las mismas en los cuatro metodos', () => {
    const lejos = { lat: IRR.lat + 0.003, lon: IRR.lon, irrigacion: IRR, observacion: '' };        // ~333 m
    const gps = L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({ metodo: 'GPS_ACTUAL', precisionGpsM: 8 }, lejos));
    const mapa = L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({ metodo: 'PUNTO_EN_MAPA', precisionGpsM: null }, lejos));
    expect(gps.observacionObligatoria).toBe(true);
    expect(mapa.observacionObligatoria).toBe(true);
    expect(gps.distanciaM).toBe(mapa.distanciaM);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------
// Validacion de correcciones pendientes: bandeja, detalle, confirmaciones y flujo de resolucion (logica pura)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------
describe('validacion: permisos y advertencias de distancia', () => {
  const VAL = { ubicacion: true, ubicacion_validar: true };

  test('puede validar solo con ubicacion + ubicacion_validar EXACTOS (fail-closed)', () => {
    expect(L.ubicacionCorreccionLogic_puedeValidar(VAL)).toBe(true);
    [null, undefined, {}, { ubicacion: true }, { ubicacion_validar: true }, { ubicacion: true, ubicacion_validar: 'SI' }, { ubicacion: 1, ubicacion_validar: true },
      { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: false }].forEach((p) => expect(L.ubicacionCorreccionLogic_puedeValidar(p)).toBe(false));
  });

  test('rechazar NO se ofrece sobre una propuesta propia (el backend responde SELF_REJECTION) ni sin el permiso', () => {
    expect(L.ubicacionCorreccionLogic_puedeRechazarPropuesta(VAL, { propia: false })).toBe(true);
    expect(L.ubicacionCorreccionLogic_puedeRechazarPropuesta(VAL, { propia: true })).toBe(false);
    expect(L.ubicacionCorreccionLogic_puedeRechazarPropuesta({ ubicacion: true }, { propia: false })).toBe(false);
    expect(L.ubicacionCorreccionLogic_puedeRechazarPropuesta(VAL, null)).toBe(false);
  });

  test.each([
    [0, null, null], [250, null, null], [250.1, 'media', 'Más de 250 m de Irrigación'], [1000, 'media', 'Más de 250 m de Irrigación'],
    [1000.1, 'fuerte', 'Más de 1 km de Irrigación'], [5000, 'fuerte', 'Más de 1 km de Irrigación']
  ])('distancia %p m -> advertencia %p', (d, nivel, corto) => {
    const a = L.ubicacionCorreccionLogic_advertenciaDistancia(d, false);
    if (nivel === null) { expect(a).toBeNull(); } else { expect(a).toMatchObject({ nivel, corto }); }
  });

  test('sin distancia (sin Irrigacion) manda la bandera del backend; sin ninguna, nada', () => {
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(null, true)).toMatchObject({ nivel: 'fuerte' });
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(null, false)).toBeNull();
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(undefined, undefined)).toBeNull();
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(NaN, true)).toMatchObject({ nivel: 'fuerte' });
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(300, true).nivel).toBe('media');           // con distancia numerica manda ella
  });

  test('textos de la advertencia fuerte: claros y orientados a quien VALIDA', () => {
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(2000).texto).toBe('La ubicación propuesta está a más de 1 km de la ubicación de Irrigación. Verificala con cuidado antes de validarla.');
    expect(L.ubicacionCorreccionLogic_advertenciaDistancia(300).texto).toBe('La ubicación propuesta está a más de 250 m de la ubicación de Irrigación.');
  });
});

describe('validacion: renglon de la bandeja', () => {
  const BASE = {
    correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wellId: '14-0001', lat: -33.34765, lon: -69.14545, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '',
    nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 22.2, advertenciaDistancia: false, estado: 'PROPUESTA', propia: false,
    coordenadaOriginalTexto: '', crsOriginal: '', irrigacion: { lat: -33.3478, lon: -69.1456, estado: 'unica' }
  };
  const item = (extra) => L.ubicacionCorreccionLogic_htmlItemPendiente(Object.assign({}, BASE, extra || {}));

  test('el renglon ENTERO es un boton con el id de la correccion y muestra pozo, quien, cuando, metodo, coordenada, distancia', () => {
    const h = item();
    expect(h).toMatch(/^<li class="uval-item-li"><button type="button" class="uval-item" data-uval-correccion="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">/);
    expect(h.match(/<button/g)).toHaveLength(1);
    expect(h).toContain('14-0001');
    expect(h).toContain('Propuesta por Ana Pérez · 13/10/2026 09:30');
    expect(h).toContain('Elegida en mapa');
    expect(h).toContain('-33.34765, -69.14545');
    expect(h).toContain('A 22,2 m de la ubicación de Irrigación');
    expect(h).not.toContain('uval-adv');
    expect(h).not.toContain('Ingresada:');
  });

  test.each([
    ['GPS_ACTUAL', { precisionGpsM: 8.4 }, 'GPS (± 8,4 m)'],
    ['PUNTO_EN_MAPA', {}, 'Elegida en mapa'],
    ['COORDENADAS_GMS', { coordenadaOriginalTexto: '33° 20\' 51.54" S, 69° 8\' 43.62" O', crsOriginal: 'GMS_WGS84' }, 'Coordenadas GMS / WGS84'],
    ['COORDENADAS_POSGAR94_AR2', { coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182' }, 'Coordenadas POSGAR 94 / Argentina 2']
  ])('metodo %s se rotula con su etiqueta', (metodo, extra, etiqueta) => {
    const h = item(Object.assign({ metodo }, extra));
    expect(h).toContain(etiqueta);
  });

  test('con coordenada ingresada muestra el valor original y el sistema (secundario); la lat/lon normalizada sigue ahi', () => {
    const h = item({ metodo: 'COORDENADAS_POSGAR94_AR2', coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182' });
    expect(h).toContain('Ingresada: <span class="mono">X(Este)=2500000.00, Y(Norte)=6350000.00</span> · POSGAR 94 / Argentina 2 · EPSG:22182');
    expect(h).toContain('-33.34765, -69.14545');
  });

  test('advertencias: >250 m (media) y >1 km (fuerte, con estilo propio); con texto y no solo color', () => {
    const media = item({ distanciaM: 300 });
    expect(media).toContain('uval-adv uval-adv-media">Más de 250 m de Irrigación<');
    expect(media).not.toContain('uval-item-fuerte');
    const fuerte = item({ distanciaM: 1800, advertenciaDistancia: true });
    expect(fuerte).toContain('uval-adv uval-adv-fuerte">Más de 1 km de Irrigación<');
    expect(fuerte).toContain('class="uval-item uval-item-fuerte"');
  });

  test('sin Irrigacion para comparar: lo dice, sin distancia inventada', () => {
    const h = item({ distanciaM: null, irrigacion: { lat: null, lon: null, estado: 'sinCoordenadas' } });
    expect(h).toContain('Sin ubicación de Irrigación para comparar');
    expect(h).not.toMatch(/ A \d/);
  });

  test('la observacion se muestra (y se escapa); texto de usuario nunca como HTML', () => {
    const h = item({ observacion: '<img src=x onerror=alert(1)> el pozo esta al otro lado', nombrePropone: '<b>Ana</b>' });
    expect(h).toContain('Observación: &lt;img src=x onerror=alert(1)&gt; el pozo esta al otro lado');
    expect(h).not.toContain('<img');
    expect(h).not.toContain('<b>Ana</b>');
    expect(h).toContain('&lt;b&gt;Ana&lt;/b&gt;');
    expect(item({ observacion: '   ' })).not.toContain('Observación:');
  });

  test('un id con comillas no rompe el atributo', () => {
    const h = item({ correccionId: '" onclick="x' });
    expect(h).toContain('data-uval-correccion="&quot; onclick=&quot;x"');
  });

  test('sin datos opcionales no muestra undefined ni null', () => {
    const h = L.ubicacionCorreccionLogic_htmlItemPendiente({ correccionId: 'x', wellId: '14-0001', lat: -33.1, lon: -69.1, metodo: 'GPS_ACTUAL', estado: 'PROPUESTA' });
    expect(h).not.toMatch(/undefined|null|NaN/);
    expect(h).toContain('Propuesta por —');
  });
});

describe('validacion: resumen de la bandeja (getCorreccionesUbicacionPendientes)', () => {
  const P = (id, extra) => Object.assign({ correccionId: id, wellId: '14-0001', estado: 'PROPUESTA' }, extra || {});

  test('lee total, items y notas; solo PROPUESTA con id', () => {
    const r = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 2, inconsistentes: 0, pendientes: [P('a'), P('b'), P('c', { estado: 'VALIDADA' }), { wellId: 'x', estado: 'PROPUESTA' }, null] } });
    expect(r).toMatchObject({ ok: true, total: 2, nota: '' });
    expect(r.items.map((c) => c.correccionId)).toEqual(['a', 'b']);
  });

  test('con mas pendientes que las listadas (tope del backend) lo avisa; con inconsistentes tambien', () => {
    const r = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 250, inconsistentes: 2, pendientes: [P('a')] } });
    expect(r.total).toBe(250);
    expect(r.nota).toMatch(/Se muestran las 1 más antiguas de 250/);
    expect(r.nota).toMatch(/2 corrección\(es\) con un historial inconsistente/);
  });

  test('sin total valido usa la cantidad listada; respuestas de error o invalidas no son ok', () => {
    expect(L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { pendientes: [P('a')] } }).total).toBe(1);
    [null, undefined, { status: 'error', code: 'X' }, { status: 'ok' }, { status: 'ok', data: {} }, { status: 'ok', data: { pendientes: 'x' } }].forEach((r) => {
      expect(L.ubicacionCorreccionLogic_resumenPendientes(r)).toMatchObject({ ok: false, items: [] });
    });
  });
});

describe('validacion: detalle y confirmaciones', () => {
  const C = {
    correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wellId: '14-0001', lat: -33.34765, lon: -69.14545, metodo: 'COORDENADAS_POSGAR94_AR2', precisionGpsM: null,
    observacion: 'La boca del pozo está dentro del predio, junto al tanque, a unos 40 m de la ruta', nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(),
    distanciaM: 1500, advertenciaDistancia: true, estado: 'PROPUESTA', propia: false, coordenadaOriginalTexto: 'X(Este)=2500000.00, Y(Norte)=6350000.00', crsOriginal: 'EPSG:22182',
    irrigacion: { lat: -33.3478, lon: -69.1456, estado: 'unica' }
  };
  const VIG = { lat: -33.3474, lon: -69.1455, nombrePropone: 'Federico', estado: 'VALIDADA' };

  test('muestra todo lo necesario para decidir', () => {
    const h = L.ubicacionCorreccionLogic_htmlDetalleValidacion(C, { vigente: VIG, vigenteEstado: 'ok' });
    ['14-0001', '-33.34765, -69.14545', 'Ana Pérez', '13/10/2026 09:30', 'Coordenadas POSGAR 94 / Argentina 2', 'X(Este)=2500000.00, Y(Norte)=6350000.00',
      'POSGAR 94 / Argentina 2 · EPSG:22182', '1,5 km', '-33.3478, -69.1456', '-33.3474, -69.1455 (Federico)', 'La boca del pozo está dentro del predio'].forEach((t) => expect(h).toContain(t));
    expect(h).toContain('class="ucorr-advertencia" role="alert"');
    expect(h).toContain('Verificala con cuidado antes de validarla.');
  });

  test('advertencia media (>250 m) con estilo de aviso; sin advertencia si esta cerca', () => {
    expect(L.ubicacionCorreccionLogic_htmlDetalleValidacion(Object.assign({}, C, { distanciaM: 300, advertenciaDistancia: false }), {})).toContain('class="ucorr-mensaje" role="alert">La ubicación propuesta está a más de 250 m');
    const cerca = L.ubicacionCorreccionLogic_htmlDetalleValidacion(Object.assign({}, C, { distanciaM: 20, advertenciaDistancia: false }), {});
    expect(cerca).not.toContain('role="alert"');
  });

  test('estados de la vigente: ninguna, cargando, con error', () => {
    expect(L.ubicacionCorreccionLogic_htmlDetalleValidacion(C, { vigente: null, vigenteEstado: 'ok' })).toContain('Ninguna: hoy rige la de Irrigación');
    expect(L.ubicacionCorreccionLogic_htmlDetalleValidacion(C, { vigenteEstado: 'cargando' })).toContain('Cargando…');
    expect(L.ubicacionCorreccionLogic_htmlDetalleValidacion(C, { vigenteEstado: 'error' })).toContain('No se pudo cargar');
  });

  test('sin Irrigacion ni observacion: lo dice; nada de undefined; texto escapado', () => {
    const h = L.ubicacionCorreccionLogic_htmlDetalleValidacion({ correccionId: 'x', wellId: '14-0001', lat: -33.1, lon: -69.1, metodo: 'GPS_ACTUAL', precisionGpsM: 9, estado: 'PROPUESTA', nombrePropone: '<i>x</i>' }, {});
    expect(h).toContain('Sin ubicación de Irrigación para comparar');
    expect(h).toContain('No disponible');
    expect(h).toContain('Sin observación');
    expect(h).toContain('GPS (± 9 m)');
    expect(h).not.toMatch(/undefined|null|NaN/);
    expect(h).not.toContain('<i>');
  });

  test('confirmacion de Validar: pasa a ser la vigente; si hay otra queda SUPERADA; Irrigacion NO se modifica ni se elimina', () => {
    const con = L.ubicacionCorreccionLogic_textosConfirmacionValidar(true);
    expect(con.titulo).toBe('¿Validar esta ubicación?');
    expect(con.puntos).toEqual([
      'Pasará a ser la ubicación validada vigente de este pozo.',
      'La ubicación validada anterior quedará reemplazada (estado SUPERADA).',
      'La ubicación de Irrigación NO se modifica ni se elimina.'
    ]);
    const sin = L.ubicacionCorreccionLogic_textosConfirmacionValidar(false);
    expect(sin.puntos).toHaveLength(2);
    expect(sin.puntos.join(' ')).not.toMatch(/SUPERADA/);
    const nose = L.ubicacionCorreccionLogic_textosConfirmacionValidar(null);
    expect(nose.puntos.join(' ')).toMatch(/Si ya existe otra ubicación validada, quedará reemplazada/);
    [con, sin, nose].forEach((t) => expect(t.puntos[t.puntos.length - 1]).toBe('La ubicación de Irrigación NO se modifica ni se elimina.'));
  });
});

describe('validacion: motivo del rechazo y mensajes', () => {
  test.each([[''], ['   '], ['\n\t '], [null], [undefined], [123]])('motivo vacio o invalido %j: obligatorio', (m) => {
    expect(L.ubicacionCorreccionLogic_validarMotivoRechazo(m)).toEqual({ ok: false, motivo: '', error: 'Indicá el motivo del rechazo.' });
  });

  test('motivo valido: se recorta; hasta 300 caracteres; mas de 300 no', () => {
    expect(L.ubicacionCorreccionLogic_validarMotivoRechazo('  no coincide  ')).toEqual({ ok: true, motivo: 'no coincide', error: '' });
    expect(L.ubicacionCorreccionLogic_validarMotivoRechazo('x'.repeat(300)).ok).toBe(true);
    const largo = L.ubicacionCorreccionLogic_validarMotivoRechazo('x'.repeat(301));
    expect(largo.ok).toBe(false);
    expect(largo.error).toBe('El motivo admite hasta 300 caracteres.');
    expect(L.UCORR_MOTIVO_MAX).toBe(300);
  });

  test('mensajes de error de la resolucion: en espanol, sin codigos tecnicos', () => {
    ['PERMISSION_DENIED', 'SELF_REJECTION', 'INVALID_MOTIVO', 'INVALID_CORRECCION_ID', 'INCONSISTENT_STATE', 'SERVICE_UNAVAILABLE', 'SERVICE_RETRY'].forEach((code) => {
      const m = L.ubicacionCorreccionLogic_mensajeErrorResolver(code);
      expect(m).toBe(L.UCORR_MENSAJES_ERROR_RESOLVER[code]);
      expect(m).not.toMatch(/[A-Z]{3,}_[A-Z]/);
    });
    expect(L.ubicacionCorreccionLogic_mensajeErrorResolver('ALGO_RARO')).toBe('No se pudo completar la operación. Intentá nuevamente.');
    expect(L.UCORR_MENSAJE_VALIDADA_OK).toBe('Ubicación validada.');
    expect(L.UCORR_MENSAJE_RECHAZADA_OK).toBe('Corrección rechazada.');
    expect(L.UCORR_MENSAJE_YA_RESUELTA).toBe('Esta corrección ya fue resuelta.');
  });
});

describe('validacion: flujo de resolucion (un solo camino para la bandeja y la ficha)', () => {
  const PERM = { ubicacion: true, ubicacion_validar: true };
  const C = { correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wellId: '14-0001', estado: 'PROPUESTA', propia: false };
  const OK = (estado) => ({ status: 'ok', data: { correccion: Object.assign({}, C, { estado }), supersedidas: ['x'] } });
  function crear(opc) {
    const o = opc || {};
    const llamadas = { validar: [], rechazar: [] };
    const flujo = L.ubicacionCorreccionLogic_crearFlujoResolucion({
      permisos: () => (o.permisos === undefined ? PERM : o.permisos),
      validar: (id) => { llamadas.validar.push(id); return o.validar ? o.validar(id) : Promise.resolve(OK('VALIDADA')); },
      rechazar: (id, m) => { llamadas.rechazar.push([id, m]); return o.rechazar ? o.rechazar(id, m) : Promise.resolve(OK('RECHAZADA')); }
    });
    return { flujo, llamadas };
  }

  test('validar: envia SOLO el id y devuelve ok con el mensaje, la correccion y las supersedidas', async () => {
    const { flujo, llamadas } = crear();
    const r = await flujo.resolver('validar', C, 'texto que no debe viajar');
    expect(r).toMatchObject({ tipo: 'ok', accion: 'validar', mensaje: 'Ubicación validada.', supersedidas: ['x'] });
    expect(r.correccion.estado).toBe('VALIDADA');
    expect(llamadas.validar).toEqual([C.correccionId]);
    expect(llamadas.rechazar).toEqual([]);
  });

  test('rechazar: envia id y motivo recortado; mensaje "Corrección rechazada."', async () => {
    const { flujo, llamadas } = crear();
    const r = await flujo.resolver('rechazar', C, '  no coincide con el pozo ');
    expect(r).toMatchObject({ tipo: 'ok', accion: 'rechazar', mensaje: 'Corrección rechazada.' });
    expect(llamadas.rechazar).toEqual([[C.correccionId, 'no coincide con el pozo']]);
  });

  test('rechazar sin motivo (o solo espacios): NO se envia nada', async () => {
    const { flujo, llamadas } = crear();
    for (const m of ['', '   ', null, undefined]) {
      expect(await flujo.resolver('rechazar', C, m)).toEqual({ tipo: 'invalido', mensaje: 'Indicá el motivo del rechazo.' });
    }
    expect(llamadas.rechazar).toEqual([]);
  });

  test('rechazar una propuesta PROPIA: no se envia (el backend diria SELF_REJECTION); validar la propia si se puede', async () => {
    const { flujo, llamadas } = crear();
    expect(await flujo.resolver('rechazar', Object.assign({}, C, { propia: true }), 'motivo')).toMatchObject({ tipo: 'invalido', mensaje: 'No podés rechazar una corrección que propusiste vos.' });
    expect(llamadas.rechazar).toEqual([]);
    expect((await flujo.resolver('validar', Object.assign({}, C, { propia: true }))).tipo).toBe('ok');
  });

  test.each([
    ['sin ningun permiso', null], ['solo ubicacion', { ubicacion: true }], ['solo ubicacion_validar', { ubicacion_validar: true }],
    ['permiso no exacto ("SI")', { ubicacion: true, ubicacion_validar: 'SI' }], ['corregir pero no validar', { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: false }]
  ])('FAIL-CLOSED (%s): no se envia NADA, ni validar ni rechazar', async (_n, permisos) => {
    const { flujo, llamadas } = crear({ permisos });
    expect(await flujo.resolver('validar', C)).toMatchObject({ tipo: 'sin_permiso' });
    expect(await flujo.resolver('rechazar', C, 'motivo')).toMatchObject({ tipo: 'sin_permiso' });
    expect(llamadas).toEqual({ validar: [], rechazar: [] });
  });

  test('el permiso se consulta EN CADA envio (si se pierde mientras la pantalla estaba abierta, no se envia)', async () => {
    let permisos = PERM;
    const llamadas = [];
    const flujo = L.ubicacionCorreccionLogic_crearFlujoResolucion({ permisos: () => permisos, validar: (id) => { llamadas.push(id); return Promise.resolve(OK('VALIDADA')); }, rechazar: () => Promise.resolve(OK('RECHAZADA')) });
    expect((await flujo.resolver('validar', C)).tipo).toBe('ok');
    permisos = { ubicacion: true, ubicacion_validar: false };
    expect((await flujo.resolver('validar', C)).tipo).toBe('sin_permiso');
    expect(llamadas).toHaveLength(1);
  });

  test.each([[undefined], [null], [{}], [{ correccionId: '' }], [{ correccionId: 5 }]])('correccion invalida %p: no se envia', async (c) => {
    const { flujo, llamadas } = crear();
    expect((await flujo.resolver('validar', c)).tipo).toBe('invalido');
    expect(llamadas.validar).toEqual([]);
  });

  test('accion desconocida: no se envia', async () => {
    const { flujo, llamadas } = crear();
    expect((await flujo.resolver('revertir', C, 'x')).tipo).toBe('invalido');
    expect(llamadas).toEqual({ validar: [], rechazar: [] });
  });

  test('DOBLE TOQUE: mientras hay un envio en curso devuelve la MISMA promesa y no manda nada mas', async () => {
    let resolver;
    const { flujo, llamadas } = crear({ validar: () => new Promise((r) => { resolver = r; }) });
    const a = flujo.resolver('validar', C);
    const b = flujo.resolver('validar', C);
    const c = flujo.resolver('rechazar', C, 'motivo');
    expect(flujo.enCurso()).toBe(true);
    expect(b).toBe(a);
    expect(c).toBe(a);
    await new Promise((r) => setTimeout(r, 0));                                       // el envio sale en un turno posterior
    resolver(OK('VALIDADA'));
    await a;
    expect(llamadas.validar).toHaveLength(1);
    expect(llamadas.rechazar).toHaveLength(0);
    expect(flujo.enCurso()).toBe(false);
  });

  test.each([['INVALID_TRANSITION'], ['CORRECCION_NOT_FOUND']])('%s = "ya fue resuelta" (otra persona la resolvio)', async (code) => {
    for (const accion of ['validar', 'rechazar']) {
      const { flujo } = crear({ validar: () => Promise.resolve({ status: 'error', code }), rechazar: () => Promise.resolve({ status: 'error', code }) });
      expect(await flujo.resolver(accion, C, 'motivo')).toEqual({ tipo: 'resuelta', mensaje: 'Esta corrección ya fue resuelta.' });
    }
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: sesion (la app cierra sesion o va a su pantalla)', async (code) => {
    const { flujo } = crear({ validar: () => Promise.resolve({ status: 'error', code }) });
    expect(await flujo.resolver('validar', C)).toEqual({ tipo: 'sesion', code });
  });

  test.each([
    ['PERMISSION_DENIED', 'No tenés permiso para validar o rechazar correcciones.'],
    ['SELF_REJECTION', 'No podés rechazar una corrección que propusiste vos.'],
    ['INCONSISTENT_STATE', 'Esta corrección tiene un problema en su historial y requiere revisión manual.'],
    ['SERVICE_UNAVAILABLE', 'No se pudo completar la operación. Intentá nuevamente.'],
    ['OTRO_CODIGO', 'No se pudo completar la operación. Intentá nuevamente.']
  ])('error del backend %s: mensaje amigable (nunca el texto tecnico)', async (code, mensaje) => {
    const { flujo } = crear({ validar: () => Promise.resolve({ status: 'error', code, message: 'texto tecnico interno' }) });
    const r = await flujo.resolver('validar', C);
    expect(r).toEqual({ tipo: 'error', code, mensaje });
    expect(r.mensaje).not.toMatch(/tecnico/);
  });

  test('sin conexion (la promesa rechaza): tipo red con mensaje claro, y el flujo queda libre para reintentar', async () => {
    let n = 0;
    const { flujo, llamadas } = crear({ validar: () => { n += 1; return n === 1 ? Promise.reject(new Error('Failed to fetch')) : Promise.resolve(OK('VALIDADA')); } });
    expect(await flujo.resolver('validar', C)).toEqual({ tipo: 'red', mensaje: 'No se pudo completar. Revisá tu conexión e intentá de nuevo.' });
    expect(flujo.enCurso()).toBe(false);
    expect((await flujo.resolver('validar', C)).tipo).toBe('ok');
    expect(llamadas.validar).toHaveLength(2);
  });

  test('una respuesta ok sin correccion no se toma por exito', async () => {
    const { flujo } = crear({ validar: () => Promise.resolve({ status: 'ok', data: {} }) });
    expect((await flujo.resolver('validar', C)).tipo).toBe('error');
  });
});

describe('validacion: tarjeta pendiente de la ficha del pozo (botones)', () => {
  const PEND = {
    correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', wellId: '14-0001', lat: -33.34765, lon: -69.14545, metodo: 'GPS_ACTUAL', precisionGpsM: 8, observacion: '',
    nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: 20, advertenciaDistancia: false, estado: 'PROPUESTA', propia: false
  };
  const tarjeta = (c, opc) => L.ubicacionCorreccionLogic_htmlTarjeta(c, Object.assign({ modo: 'pendiente' }, opc || {}));

  test('con puedeValidar: [Validar] y [Rechazar] con el id de la correccion', () => {
    const h = tarjeta(PEND, { puedeValidar: true });
    expect(h).toContain('<button type="button" class="button uval-btn-validar" data-uval-accion="validar" data-uval-correccion="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">Validar</button>');
    expect(h).toContain('<button type="button" class="button button-secondary uval-btn-rechazar" data-uval-accion="rechazar" data-uval-correccion="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa">Rechazar</button>');
    expect(h.indexOf('Validar</button>')).toBeLessThan(h.indexOf('Rechazar</button>'));
  });

  test('propia: solo Validar (no se puede rechazar la propia)', () => {
    const h = tarjeta(Object.assign({}, PEND, { propia: true }), { puedeValidar: true });
    expect(h).toContain('data-uval-accion="validar"');
    expect(h).not.toContain('data-uval-accion="rechazar"');
  });

  test('FAIL-CLOSED: sin puedeValidar === true (undefined, false, "SI", 1) no hay botones', () => {
    [undefined, false, 'SI', 1, null].forEach((v) => expect(tarjeta(PEND, { puedeValidar: v })).not.toContain('data-uval-accion'));
    expect(tarjeta(PEND)).not.toContain('<button');
  });

  test('solo las tarjetas PENDIENTES y en estado PROPUESTA llevan botones (no la vigente, no el historial, no una ya resuelta)', () => {
    expect(L.ubicacionCorreccionLogic_htmlTarjeta(Object.assign({}, PEND, { estado: 'VALIDADA' }), { modo: 'vigente', puedeValidar: true })).not.toContain('data-uval-accion');
    expect(L.ubicacionCorreccionLogic_htmlTarjeta(PEND, { modo: 'historial', puedeValidar: true })).not.toContain('data-uval-accion');
    expect(tarjeta(Object.assign({}, PEND, { estado: 'RECHAZADA' }), { puedeValidar: true })).not.toContain('data-uval-accion');
  });

  test('la seccion pasa el permiso SOLO a las pendientes; con vigente + pendiente, la vigente no lleva botones', () => {
    const VIG = Object.assign({}, PEND, { correccionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', estado: 'VALIDADA', resolucion: null });
    const h = L.ubicacionCorreccionLogic_htmlSeccion({ vigente: VIG, pendientes: [PEND], historial: [PEND, VIG] }, { puedeCorregir: true, puedeValidar: true });
    expect((h.match(/data-uval-accion="validar"/g) || [])).toHaveLength(1);
    expect((h.match(/data-uval-accion="rechazar"/g) || [])).toHaveLength(1);
    expect(L.ubicacionCorreccionLogic_htmlSeccion({ vigente: VIG, pendientes: [PEND], historial: [PEND, VIG] }, { puedeCorregir: true })).not.toContain('data-uval-accion');
    expect(L.ubicacionCorreccionLogic_htmlSeccion({ vigente: VIG, pendientes: [PEND], historial: [PEND, VIG] }, { puedeCorregir: true, puedeValidar: 'SI' })).not.toContain('data-uval-accion');
  });
});

describe('validacion: fijarTotal del indicador', () => {
  test('el indicador toma el total de la bandeja sin consultar; con 0 se oculta; sin permiso no hace nada', () => {
    const pintados = [];
    const b = L.ubicacionCorreccionLogic_crearBadgePendientes({
      obtenerContexto: () => ({ sessionToken: 't', permisos: { ubicacion: true, ubicacion_validar: true } }), consultar: () => { throw new Error('no debe consultar'); }, pintar: (t) => pintados.push(t)
    });
    expect(b.fijarTotal(4)).toBe(true);
    expect(b.fijarTotal(0)).toBe(true);
    expect(b.fijarTotal(-1)).toBe(false);
    expect(b.fijarTotal(2.5)).toBe(false);
    expect(b.fijarTotal('3')).toBe(false);
    expect(pintados).toEqual([4, 0]);
    expect(b.total()).toBe(0);
    const sin = L.ubicacionCorreccionLogic_crearBadgePendientes({ obtenerContexto: () => ({ sessionToken: 't', permisos: { ubicacion: true } }), consultar: () => {}, pintar: (t) => pintados.push(t) });
    expect(sin.fijarTotal(9)).toBe(false);
    expect(pintados).toEqual([4, 0]);
  });
});
