// En el navegador las funciones de reemplazoResumenLogic.js son globales
Object.assign(global, require('./reemplazoResumenLogic'));
const { reemplazoEstados_crear, REEMPLAZO_ESTADOS_TTL_MS } = require('./reemplazoEstados');

function crear(opciones) {
  const o = Object.assign({ reemplazo: true, respuesta: { status: 'ok', data: { '01-0001': 'APTO', '01-0002': 'NO_APTO' } } }, opciones || {});
  const estado = { ahora: 1000000, permisos: { reemplazo: o.reemplazo }, respuesta: o.respuesta };
  const api = jest.fn(() => Promise.resolve(estado.respuesta));
  const store = reemplazoEstados_crear({
    obtenerContexto: () => ({ sessionToken: 'tok', permisos: estado.permisos }),
    apiGetResumen: api,
    ahora: () => estado.ahora
  });
  return { store, api, estado };
}

describe('sin permiso reemplazo: cero llamadas, cero estados', () => {
  test('cargar no hace fetch y devuelve null', async () => {
    const { store, api } = crear({ reemplazo: false });
    expect(await store.cargar()).toBeNull();
    expect(await store.cargar(true)).toBeNull();
    expect(api).not.toHaveBeenCalled();
  });
  test('nada disponible: ni resumen ni estado de un pozo', async () => {
    const { store } = crear({ reemplazo: false });
    await store.cargar();
    expect(store.habilitado()).toBe(false);
    expect(store.disponible()).toBe(false);
    expect(store.resumen()).toBeNull();
    expect(store.estadoDe('01-0001')).toBeNull();
  });
  test('si el permiso se pierde despues de cargar, el resumen deja de exponerse', async () => {
    const { store, estado } = crear();
    await store.cargar();
    expect(store.estadoDe('01-0001')).toBe('APTO');
    estado.permisos.reemplazo = false;
    expect(store.resumen()).toBeNull();
    expect(store.estadoDe('01-0001')).toBeNull();
  });
  test('permiso solo con valor estrictamente true (SI): otros valores no habilitan', () => {
    const { store, estado } = crear();
    estado.permisos.reemplazo = 'SI';
    expect(store.habilitado()).toBe(false);
    estado.permisos.reemplazo = 1;
    expect(store.habilitado()).toBe(false);
  });
});

describe('con permiso: carga, cache y TTL', () => {
  test('carga una vez y reusa (una sola llamada para mapa + Cerca Mio + seleccion)', async () => {
    const { store, api } = crear();
    await store.cargar();
    await store.cargar();
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith('tok');
  });
  test('estado de un pozo: evaluado o SIN_EVALUAR (ausente)', async () => {
    const { store } = crear();
    await store.cargar();
    expect(store.estadoDe('01-0001')).toBe('APTO');
    expect(store.estadoDe('01-0002')).toBe('NO_APTO');
    expect(store.estadoDe('09-0009')).toBe('SIN_EVALUAR');
    expect(store.disponible()).toBe(true);
  });
  test('antes de cargar: no disponible y estadoDe es null (no se afirma "Sin evaluar")', () => {
    const { store } = crear();
    expect(store.disponible()).toBe(false);
    expect(store.estadoDe('01-0001')).toBeNull();
  });
  test('llamadas simultaneas se deduplican (una sola request en vuelo)', async () => {
    const { store, api } = crear();
    await Promise.all([store.cargar(), store.cargar(), store.cargar()]);
    expect(api).toHaveBeenCalledTimes(1);
  });
  test('vencido el TTL (3 min) vuelve a pedir; antes no', async () => {
    const { store, api, estado } = crear();
    await store.cargar();
    estado.ahora += REEMPLAZO_ESTADOS_TTL_MS - 1000;
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(1);
    estado.ahora += 2000;
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(2);
  });
  test('forzar=true ignora el TTL', async () => {
    const { store, api } = crear();
    await store.cargar();
    await store.cargar(true);
    expect(api).toHaveBeenCalledTimes(2);
  });
  test('invalidar fuerza una recarga en el proximo cargar', async () => {
    const { store, api } = crear();
    await store.cargar();
    store.invalidar();
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(2);
  });
  test('el payload se sanitiza (descarta ids/estados invalidos)', async () => {
    const { store } = crear({ respuesta: { status: 'ok', data: { '01-0001': 'APTO', 'raro': 'APTO', '01-0002': 'SIN_EVALUAR', '01-0003': 'OTRO' } } });
    await store.cargar();
    expect(store.resumen()).toEqual({ '01-0001': 'APTO' });
  });
  test('ningun evaluado: resumen vacio pero DISPONIBLE (todos Sin evaluar)', async () => {
    const { store } = crear({ respuesta: { status: 'ok', data: {} } });
    await store.cargar();
    expect(store.disponible()).toBe(true);
    expect(store.estadoDe('01-0001')).toBe('SIN_EVALUAR');
  });
});

describe('errores', () => {
  test('falla de red sin datos previos: null, y se puede reintentar', async () => {
    const { store, api } = crear();
    api.mockImplementationOnce(() => Promise.reject(new Error('sin red')));
    expect(await store.cargar()).toBeNull();
    expect(store.disponible()).toBe(false);
    expect(await store.cargar()).toEqual({ '01-0001': 'APTO', '01-0002': 'NO_APTO' });
  });
  test('falla de red con datos previos: conserva lo que habia', async () => {
    const { store, api } = crear();
    await store.cargar();
    api.mockImplementationOnce(() => Promise.reject(new Error('sin red')));
    await store.cargar(true);
    expect(store.estadoDe('01-0001')).toBe('APTO');
  });
  test('PERMISSION_DENIED del backend: no se conserva nada', async () => {
    const { store, estado } = crear();
    await store.cargar();
    estado.respuesta = { status: 'error', code: 'PERMISSION_DENIED' };
    await store.cargar(true);
    expect(store.disponible()).toBe(false);
  });
  test('otro error (SERVICE_UNAVAILABLE) conserva lo previo', async () => {
    const { store, estado } = crear();
    await store.cargar();
    estado.respuesta = { status: 'error', code: 'SERVICE_UNAVAILABLE' };
    await store.cargar(true);
    expect(store.estadoDe('01-0001')).toBe('APTO');
  });
});

describe('actualizacion reactiva despues de evaluar', () => {
  test('actualizar cambia el estado al instante, sin llamar a la red', async () => {
    const { store, api } = crear();
    await store.cargar();
    const v = store.version();
    store.actualizar('09-0009', 'NO_APTO');
    expect(store.estadoDe('09-0009')).toBe('NO_APTO');
    expect(store.version()).toBeGreaterThan(v);
    expect(api).toHaveBeenCalledTimes(1);
  });
  test('un pozo evaluado puede cambiar de estado (la ultima evaluacion manda)', async () => {
    const { store } = crear();
    await store.cargar();
    store.actualizar('01-0001', 'NO_APTO');
    expect(store.estadoDe('01-0001')).toBe('NO_APTO');
  });
  test('el cambio local sobrevive dentro del TTL (no se pisa con una recarga innecesaria)', async () => {
    const { store, api } = crear();
    await store.cargar();
    store.actualizar('09-0009', 'APTO');
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(1);
    expect(store.estadoDe('09-0009')).toBe('APTO');
  });
  test('sin resumen cargado no se inventa uno (el proximo cargar trae todo del backend)', () => {
    const { store } = crear();
    store.actualizar('09-0009', 'APTO');
    expect(store.disponible()).toBe(false);
  });
  test('sin permiso, actualizar no expone nada', async () => {
    const { store } = crear({ reemplazo: false });
    store.actualizar('09-0009', 'APTO');
    expect(store.estadoDe('09-0009')).toBeNull();
  });
});

describe('reset (cerrar sesion)', () => {
  test('borra todo y una respuesta que llega despues del reset se descarta', async () => {
    const { store, api } = crear();
    let resolver;
    api.mockImplementationOnce(() => new Promise((r) => { resolver = r; }));
    const p = store.cargar();
    store.reset();
    resolver({ status: 'ok', data: { '01-0001': 'APTO' } });
    expect(await p).toBeNull();
    expect(store.disponible()).toBe(false);
  });
  test('tras reset se vuelve a cargar de cero', async () => {
    const { store, api } = crear();
    await store.cargar();
    store.reset();
    expect(store.disponible()).toBe(false);
    await store.cargar();
    expect(api).toHaveBeenCalledTimes(2);
  });
});
