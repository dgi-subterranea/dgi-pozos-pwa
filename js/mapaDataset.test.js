// mapaDataset.js llama a apiGetMapaPozos como global (ver js/api.js,
// cargado antes en el navegador) - aca se fakea. jest.resetModules() +
// require() fresco en cada test para que mapaDatasetEstado (modulo-level,
// mutable) no arrastre cache entre tests - ver mapaDataset.js.
describe('mapaDataset_obtener', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('primera llamada: dispara apiGetMapaPozos y devuelve su resultado', async () => {
    global.apiGetMapaPozos = jest.fn().mockResolvedValue({
      status: 'ok',
      data: { pozos: [{ wellId: '04-0263', lat: -32.8, lon: -68.7, estado: 'C' }], metadata: { totalPuntos: 1 } }
    });
    const { mapaDataset_obtener } = require('./mapaDataset');

    const result = await mapaDataset_obtener('token-x');

    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(global.apiGetMapaPozos).toHaveBeenCalledWith('token-x');
    expect(result.data.pozos).toEqual([{ wellId: '04-0263', lat: -32.8, lon: -68.7, estado: 'C' }]);
  });

  test('segunda llamada tras exito: reusa el cache, NO vuelve a llamar a apiGetMapaPozos', async () => {
    global.apiGetMapaPozos = jest.fn().mockResolvedValue({
      status: 'ok', data: { pozos: [{ wellId: '04-0263' }], metadata: null }
    });
    const { mapaDataset_obtener } = require('./mapaDataset');

    await mapaDataset_obtener('token-x');
    const segunda = await mapaDataset_obtener('token-x');

    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(segunda.data.pozos).toEqual([{ wellId: '04-0263' }]);
  });

  // Caso central del requisito "no hacer un segundo fetch si ya esta
  // disponible": dos consumidores (Mapa de Pozos y Cerca Mio) pidiendo
  // el dataset casi al mismo tiempo, ANTES de que el primer fetch
  // resuelva, comparten la misma promesa - un solo viaje de red para
  // los dos.
  test('dos llamadas concurrentes antes de resolver: comparten la misma promesa, un solo fetch', async () => {
    let resolverFetch;
    global.apiGetMapaPozos = jest.fn(() => new Promise((resolve) => { resolverFetch = resolve; }));
    const { mapaDataset_obtener } = require('./mapaDataset');

    const p1 = mapaDataset_obtener('token-x');
    const p2 = mapaDataset_obtener('token-x');
    resolverFetch({ status: 'ok', data: { pozos: [{ wellId: 'x' }], metadata: null } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  test('respuesta de error NO se cachea: una llamada posterior reintenta el fetch', async () => {
    global.apiGetMapaPozos = jest.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'SERVICE_UNAVAILABLE' })
      .mockResolvedValueOnce({ status: 'ok', data: { pozos: [{ wellId: 'x' }], metadata: null } });
    const { mapaDataset_obtener } = require('./mapaDataset');

    const r1 = await mapaDataset_obtener('token-x');
    expect(r1.status).toBe('error');

    const r2 = await mapaDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(2);
  });

  test('excepcion de red: se propaga (no se traga el error), y una llamada posterior reintenta', async () => {
    global.apiGetMapaPozos = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 'ok', data: { pozos: [], metadata: null } });
    const { mapaDataset_obtener } = require('./mapaDataset');

    await expect(mapaDataset_obtener('token-x')).rejects.toThrow('network down');

    const r2 = await mapaDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetMapaPozos).toHaveBeenCalledTimes(2);
  });
});
