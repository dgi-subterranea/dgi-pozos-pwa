// mapaNEDataset.js llama a apiGetMapaNE como global (ver js/api.js,
// cargado antes en el navegador) - aca se fakea. jest.resetModules() +
// require() fresco en cada test, mismo patron que mapaDataset.test.js.
describe('mapaNEDataset_obtener', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('primera llamada: dispara apiGetMapaNE y devuelve su resultado', async () => {
    global.apiGetMapaNE = jest.fn().mockResolvedValue({
      status: 'ok',
      data: { puntos: [{ monitoringId: '04-0263', wellId: '04-0263', lat: -32.8, lon: -68.7, nombreOriginal: null }] }
    });
    const { mapaNEDataset_obtener } = require('./mapaNEDataset');

    const result = await mapaNEDataset_obtener('token-x');

    expect(global.apiGetMapaNE).toHaveBeenCalledTimes(1);
    expect(global.apiGetMapaNE).toHaveBeenCalledWith('token-x');
    expect(result.data.puntos).toEqual([{ monitoringId: '04-0263', wellId: '04-0263', lat: -32.8, lon: -68.7, nombreOriginal: null }]);
  });

  test('segunda llamada tras exito: reusa el cache, NO vuelve a llamar a apiGetMapaNE', async () => {
    global.apiGetMapaNE = jest.fn().mockResolvedValue({
      status: 'ok', data: { puntos: [{ monitoringId: 'INA 2055', wellId: null, lat: -32.9, lon: -68.9, nombreOriginal: 'X' }] }
    });
    const { mapaNEDataset_obtener } = require('./mapaNEDataset');

    await mapaNEDataset_obtener('token-x');
    const segunda = await mapaNEDataset_obtener('token-x');

    expect(global.apiGetMapaNE).toHaveBeenCalledTimes(1);
    expect(segunda.data.puntos.length).toBe(1);
  });

  // La capa NE solo se activa al tocar el chip - si el usuario lo activa
  // y desactiva y vuelve a activar varias veces en la misma apertura del
  // mapa, nunca debe volver a pedir el dataset (ver mapa.js).
  test('dos llamadas concurrentes antes de resolver: comparten la misma promesa, un solo fetch', async () => {
    let resolverFetch;
    global.apiGetMapaNE = jest.fn(() => new Promise((resolve) => { resolverFetch = resolve; }));
    const { mapaNEDataset_obtener } = require('./mapaNEDataset');

    const p1 = mapaNEDataset_obtener('token-x');
    const p2 = mapaNEDataset_obtener('token-x');
    resolverFetch({ status: 'ok', data: { puntos: [{ monitoringId: 'x' }] } });
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(global.apiGetMapaNE).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(r2);
  });

  test('respuesta de error NO se cachea: una llamada posterior reintenta el fetch', async () => {
    global.apiGetMapaNE = jest.fn()
      .mockResolvedValueOnce({ status: 'error', code: 'PERMISSION_DENIED' })
      .mockResolvedValueOnce({ status: 'ok', data: { puntos: [{ monitoringId: 'x' }] } });
    const { mapaNEDataset_obtener } = require('./mapaNEDataset');

    const r1 = await mapaNEDataset_obtener('token-x');
    expect(r1.status).toBe('error');

    const r2 = await mapaNEDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetMapaNE).toHaveBeenCalledTimes(2);
  });

  test('excepcion de red: se propaga (no se traga el error), y una llamada posterior reintenta', async () => {
    global.apiGetMapaNE = jest.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ status: 'ok', data: { puntos: [] } });
    const { mapaNEDataset_obtener } = require('./mapaNEDataset');

    await expect(mapaNEDataset_obtener('token-x')).rejects.toThrow('network down');

    const r2 = await mapaNEDataset_obtener('token-x');
    expect(r2.status).toBe('ok');
    expect(global.apiGetMapaNE).toHaveBeenCalledTimes(2);
  });
});
