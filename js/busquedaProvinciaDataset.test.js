// busquedaProvinciaDataset.js llama a apiGetIndiceBusquedaProvincia como
// global (ver js/api.js) - aca se fakea. Mismo patron que
// mapaNEDataset.test.js.
describe('busquedaProvinciaDataset_obtener', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('primera llamada: dispara apiGetIndiceBusquedaProvincia y devuelve su resultado', async () => {
    global.apiGetIndiceBusquedaProvincia = jest.fn().mockResolvedValue({
      status: 'ok',
      data: { pozos: [{ wellId: '04-0263', titular: 'PEREZ, JUAN' }] }
    });
    const { busquedaProvinciaDataset_obtener } = require('./busquedaProvinciaDataset');

    const result = await busquedaProvinciaDataset_obtener('token-x');

    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledTimes(1);
    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledWith('token-x');
    expect(result.data.pozos).toEqual([{ wellId: '04-0263', titular: 'PEREZ, JUAN' }]);
  });

  test('segunda llamada tras exito: reusa el cache, NO vuelve a llamar al endpoint', async () => {
    global.apiGetIndiceBusquedaProvincia = jest.fn().mockResolvedValue({
      status: 'ok', data: { pozos: [{ wellId: '04-0263', titular: 'PEREZ, JUAN' }] }
    });
    const { busquedaProvinciaDataset_obtener } = require('./busquedaProvinciaDataset');

    await busquedaProvinciaDataset_obtener('token-x');
    const segunda = await busquedaProvinciaDataset_obtener('token-x');

    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledTimes(1);
    expect(segunda.data.pozos.length).toBe(1);
  });

  test('dos llamadas concurrentes antes de resolver: comparten la misma promesa, un solo fetch', async () => {
    let resolverFetch;
    global.apiGetIndiceBusquedaProvincia = jest.fn(() => new Promise((resolve) => { resolverFetch = resolve; }));
    const { busquedaProvinciaDataset_obtener } = require('./busquedaProvinciaDataset');

    const p1 = busquedaProvinciaDataset_obtener('token-x');
    const p2 = busquedaProvinciaDataset_obtener('token-x');
    resolverFetch({ status: 'ok', data: { pozos: [{ wellId: 'x', titular: null }] } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  test('respuesta de error NO se cachea: una llamada posterior reintenta el fetch', async () => {
    global.apiGetIndiceBusquedaProvincia = jest.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'PERMISSION_DENIED' })
      .mockResolvedValueOnce({ status: 'ok', data: { pozos: [{ wellId: 'x', titular: null }] } });
    const { busquedaProvinciaDataset_obtener } = require('./busquedaProvinciaDataset');

    const r1 = await busquedaProvinciaDataset_obtener('token-x');
    expect(r1.status).toBe('error');

    const r2 = await busquedaProvinciaDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledTimes(2);
  });

  test('excepcion de red: se propaga (no se traga el error), y una llamada posterior reintenta', async () => {
    global.apiGetIndiceBusquedaProvincia = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 'ok', data: { pozos: [] } });
    const { busquedaProvinciaDataset_obtener } = require('./busquedaProvinciaDataset');

    await expect(busquedaProvinciaDataset_obtener('token-x')).rejects.toThrow('network down');

    const r2 = await busquedaProvinciaDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetIndiceBusquedaProvincia).toHaveBeenCalledTimes(2);
  });
});
