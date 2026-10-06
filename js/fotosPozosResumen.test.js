const { fotosPozosResumen_crear, FOTOS_POZOS_RESUMEN_TTL_MS } = require('./fotosPozosResumen');

function crear(opciones) {
  const o = Object.assign({ permisos: { fotos: true }, respuesta: { status: 'ok', data: { '01-0012': 4, '03-0652': 12 } } }, opciones || {});
  const estado = { ahora: 1000000, permisos: o.permisos, respuesta: o.respuesta };
  const api = jest.fn(() => Promise.resolve(estado.respuesta));
  const store = fotosPozosResumen_crear({
    obtenerContexto: () => ({ sessionToken: 'tok', permisos: estado.permisos }),
    apiGetResumen: api,
    ahora: () => estado.ahora
  });
  return { store, api, estado };
}

describe('fotos=NO: cero llamadas, cero contadores, cero informacion', () => {
  test.each([
    ['sin ningun permiso de fotos', { perfil: true, ne: true, reemplazo: true }],
    ['fotos=false', { fotos: false }],
    ['SOLO fotos_carga (cargar no da ver)', { fotos_carga: true }],
    ['fotos="SI" como texto (no es booleano)', { fotos: 'SI' }],
    ['sin permisos', {}]
  ])('%s', async (n, permisos) => {
    const { store, api } = crear({ permisos });
    expect(await store.cargar()).toBeNull();
    expect(await store.cargar(true)).toBeNull();
    expect(api).not.toHaveBeenCalled();
    expect(store.habilitado()).toBe(false);
    expect(store.resumen()).toBeNull();
    expect(store.disponible()).toBe(false);
    expect(store.cantidadDe('01-0012')).toBeNull();
  });

  test('si el permiso se pierde, lo ya cargado deja de exponerse', async () => {
    const { store, estado } = crear();
    await store.cargar();
    expect(store.cantidadDe('01-0012')).toBe(4);
    estado.permisos = { fotos: false };
    expect(store.resumen()).toBeNull();
    expect(store.cantidadDe('01-0012')).toBeNull();
  });

  test('incrementar sin permiso no inventa ni expone nada', () => {
    const { store } = crear({ permisos: { fotos_carga: true } });
    store.incrementar('04-0263');
    expect(store.cantidadDe('04-0263')).toBeNull();
  });
});

describe('fotos=SI', () => {
  test('una sola llamada batch; el resultado se reusa dentro del TTL', async () => {
    const { store, api } = crear();
    expect(await store.cargar()).toEqual({ '01-0012': 4, '03-0652': 12 });
    expect(await store.cargar()).toEqual({ '01-0012': 4, '03-0652': 12 });
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('tok');
  });

  test('vencido el TTL, vuelve a pedir; forzar tambien', async () => {
    const { store, api, estado } = crear();
    await store.cargar();
    estado.ahora += FOTOS_POZOS_RESUMEN_TTL_MS - 1;
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(1);
    estado.ahora += 2;
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(2);
    await store.cargar(true);
    expect(api).toHaveBeenCalledTimes(3);
  });

  test('llamadas simultaneas comparten una sola peticion', async () => {
    const { store, api } = crear();
    const [a, b] = await Promise.all([store.cargar(), store.cargar()]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  test('cantidadDe: el numero, 0 si cargo y no tiene, null si todavia no hay resumen', async () => {
    const { store } = crear();
    expect(store.cantidadDe('01-0012')).toBeNull();
    await store.cargar();
    expect(store.cantidadDe('01-0012')).toBe(4);
    expect(store.cantidadDe('09-9999')).toBe(0);
  });

  test('solo entran claves validas: cantidades enteras > 0 (defensa en el borde de red)', async () => {
    const { store } = crear({ respuesta: { status: 'ok', data: { '01-0012': 4, '02-0001': 0, '03-0001': -2, '04-0001': 1.5, '05-0001': '3', '06-0001': null, '': 5, ['x'.repeat(41)]: 2, 'INA 2055': 1 } } });
    expect(await store.cargar()).toEqual({ '01-0012': 4, 'INA 2055': 1 });
  });

  test('payload que no es objeto: resumen vacio, sin romper', async () => {
    for (const data of [null, [1, 2], 'x', 7]) {
      const { store } = crear({ respuesta: { status: 'ok', data } });
      expect(await store.cargar()).toEqual({});
    }
  });

  test('punto NE especial: la clave es su monitoringId', async () => {
    const { store } = crear({ respuesta: { status: 'ok', data: { 'INA 2055': 3 } } });
    await store.cargar();
    expect(store.cantidadDe('INA 2055')).toBe(3);
  });
});

describe('actualizacion local inmediata al subir', () => {
  test('incrementar suma 1 (o n) sin llamar de nuevo y sube la version', async () => {
    const { store, api } = crear();
    await store.cargar();
    const v = store.version();
    store.incrementar('01-0012');
    store.incrementar('09-0001');
    store.incrementar('03-0652', 3);
    expect(store.cantidadDe('01-0012')).toBe(5);
    expect(store.cantidadDe('09-0001')).toBe(1);
    expect(store.cantidadDe('03-0652')).toBe(15);
    expect(store.version()).toBeGreaterThan(v);
    expect(api).toHaveBeenCalledTimes(1);
  });

  test('el resumen anterior no se muta (copia)', async () => {
    const { store } = crear();
    const antes = await store.cargar();
    store.incrementar('01-0012');
    expect(antes['01-0012']).toBe(4);
  });

  test('sin resumen cargado no se inventa uno', () => {
    const { store } = crear();
    store.incrementar('01-0012');
    expect(store.cantidadDe('01-0012')).toBeNull();
    store.incrementar('');
  });

  test('invalidar fuerza releer en la proxima carga', async () => {
    const { store, api } = crear();
    await store.cargar();
    store.invalidar();
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe('fallas', () => {
  test('error de red (rechazo): se conserva lo que hubiera y nunca rechaza', async () => {
    const { store, estado } = crear();
    await store.cargar();
    estado.ahora += FOTOS_POZOS_RESUMEN_TTL_MS + 1;
    const api = jest.fn(() => Promise.reject(new Error('sin red')));
    const sinRed = fotosPozosResumen_crear({ obtenerContexto: () => ({ sessionToken: 't', permisos: { fotos: true } }), apiGetResumen: api, ahora: () => estado.ahora });
    expect(await sinRed.cargar()).toBeNull();
    expect(sinRed.disponible()).toBe(false);
  });

  test('error de red tras haber cargado: conserva el resumen viejo', async () => {
    let falla = false;
    const estado = { ahora: 1 };
    const store = fotosPozosResumen_crear({
      obtenerContexto: () => ({ sessionToken: 't', permisos: { fotos: true } }),
      apiGetResumen: () => (falla ? Promise.reject(new Error('x')) : Promise.resolve({ status: 'ok', data: { a1: 2 } })),
      ahora: () => estado.ahora
    });
    await store.cargar();
    falla = true;
    estado.ahora += FOTOS_POZOS_RESUMEN_TTL_MS + 1;
    expect(await store.cargar()).toEqual({ a1: 2 });
  });

  test('respuesta de error generica: no pisa lo cargado; permiso denegado / sesion vencida: se descarta todo', async () => {
    const c = crear();
    await c.store.cargar();
    c.estado.ahora += FOTOS_POZOS_RESUMEN_TTL_MS + 1;
    c.estado.respuesta = { status: 'error', code: 'SERVICE_UNAVAILABLE' };
    expect(await c.store.cargar()).toEqual({ '01-0012': 4, '03-0652': 12 });
    c.estado.ahora += FOTOS_POZOS_RESUMEN_TTL_MS + 1;
    c.estado.respuesta = { status: 'error', code: 'PERMISSION_DENIED' };
    expect(await c.store.cargar()).toBeNull();
    expect(c.store.cantidadDe('01-0012')).toBeNull();
  });

  test('reset (logout) descarta todo, y una respuesta que vuela durante el reset se ignora', async () => {
    let resolver;
    const estado = { ahora: 1 };
    const store = fotosPozosResumen_crear({
      obtenerContexto: () => ({ sessionToken: 't', permisos: { fotos: true } }),
      apiGetResumen: () => new Promise((r) => { resolver = r; }),
      ahora: () => estado.ahora
    });
    const p = store.cargar();
    store.reset();
    resolver({ status: 'ok', data: { a1: 9 } });
    expect(await p).toBeNull();
    expect(store.disponible()).toBe(false);
  });
});
