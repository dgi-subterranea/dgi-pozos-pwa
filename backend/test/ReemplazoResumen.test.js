const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();
global.Logger = { log: jest.fn() };

const Service = require('../src/ReemplazoService');
const Repo = require('../src/ReemplazoRepository');
const Api = require('../src/Api');

function ev(wellId, timestamp, estado, extra) {
  return Object.assign({ wellId, timestamp, estado, email: 'a@x.com', nombre: 'Ana', motivo: 'SECO', observacion: 'secreto', evaluacionId: 'id-' + wellId + timestamp }, extra || {});
}

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  global.reemplazoRepository_listarParaResumen = jest.fn().mockReturnValue([]);
  global.reemplazoRepository_agregar = jest.fn();
});

describe('reemplazoService_calcularResumen', () => {
  test('ningun evaluado: objeto vacio (los SIN_EVALUAR no se devuelven)', () => {
    expect(Service.reemplazoService_calcularResumen([])).toEqual({});
    expect(Service.reemplazoService_calcularResumen(undefined)).toEqual({});
  });

  test('un pozo', () => {
    expect(Service.reemplazoService_calcularResumen([ev('01-0012', '2026-01-01T00:00:00.000Z', 'APTO')])).toEqual({ '01-0012': 'APTO' });
  });

  test('multiples pozos y estados', () => {
    const r = Service.reemplazoService_calcularResumen([
      ev('01-0012', '2026-01-01T00:00:00.000Z', 'APTO'),
      ev('01-0045', '2026-01-02T00:00:00.000Z', 'NO_APTO'),
      ev('02-0007', '2026-01-03T00:00:00.000Z', 'DUDOSO')
    ]);
    expect(r).toEqual({ '01-0012': 'APTO', '01-0045': 'NO_APTO', '02-0007': 'DUDOSO' });
  });

  test('varias evaluaciones del mismo pozo: la ultima valida gana, sin importar el orden de las filas', () => {
    const r = Service.reemplazoService_calcularResumen([
      ev('01-0012', '2026-05-01T00:00:00.000Z', 'NO_APTO'),
      ev('01-0012', '2026-01-01T00:00:00.000Z', 'APTO'),
      ev('01-0012', '2026-03-01T00:00:00.000Z', 'DUDOSO')
    ]);
    expect(r).toEqual({ '01-0012': 'NO_APTO' });
  });

  test('mismo timestamp: gana la fila escrita despues (igual que getEstadoReemplazo)', () => {
    const r = Service.reemplazoService_calcularResumen([
      ev('01-0012', '2026-03-01T00:00:00.000Z', 'NO_APTO'),
      ev('01-0012', '2026-03-01T00:00:00.000Z', 'APTO')
    ]);
    expect(r['01-0012']).toBe('APTO');
  });

  test('filas corruptas ignoradas: estado fuera de catalogo (incl. SIN_EVALUAR), timestamp invalido, wellId invalido', () => {
    const r = Service.reemplazoService_calcularResumen([
      ev('01-0012', '2026-01-01T00:00:00.000Z', 'APTO'),
      ev('01-0012', '2026-09-01T00:00:00.000Z', 'SIN_EVALUAR'),
      ev('01-0012', '2026-08-01T00:00:00.000Z', 'basura'),
      ev('01-0012', null, 'NO_APTO'),
      ev('XX-9999', '2026-01-01T00:00:00.000Z', 'APTO'),
      ev('1-12', '2026-01-01T00:00:00.000Z', 'APTO'),
      null
    ]);
    expect(r).toEqual({ '01-0012': 'APTO' });
  });

  test('un pozo con SOLO filas corruptas no aparece (queda SIN_EVALUAR)', () => {
    expect(Service.reemplazoService_calcularResumen([ev('03-0001', '2026-01-01T00:00:00.000Z', 'basura')])).toEqual({});
  });

  test('coincide con la regla de getEstadoReemplazo para cada pozo', () => {
    const filas = [
      ev('01-0012', '2026-02-01T00:00:00.000Z', 'DUDOSO'), ev('01-0012', '2026-04-01T00:00:00.000Z', 'APTO'),
      ev('02-0001', '2026-01-01T00:00:00.000Z', 'NO_APTO')
    ];
    const resumen = Service.reemplazoService_calcularResumen(filas);
    Object.keys(resumen).forEach((w) => {
      expect(Service.reemplazoService_calcularEstado(w, filas.filter((f) => f.wellId === w)).estado).toBe(resumen[w]);
    });
  });

  test('solo wellId -> estado: nunca email, nombre, motivo, observacion, ids ni timestamps', () => {
    const r = Service.reemplazoService_calcularResumen([ev('01-0012', '2026-01-01T00:00:00.000Z', 'NO_APTO')]);
    expect(JSON.stringify(r)).toBe('{"01-0012":"NO_APTO"}');
  });
});

describe('forma compacta del cache', () => {
  test('ida y vuelta conserva el resumen', () => {
    const r = { '01-0012': 'APTO', '01-0045': 'NO_APTO', '02-0007': 'DUDOSO', '02-0008': 'APTO' };
    expect(Service.reemplazoService_expandirResumen(Service.reemplazoService_comprimirResumen(r))).toEqual(r);
  });
  test('es mas chica que el objeto plano', () => {
    const r = {};
    for (let i = 1; i <= 2000; i++) { r['04-' + String(i).padStart(4, '0')] = i % 3 ? 'APTO' : 'NO_APTO'; }
    expect(Service.reemplazoService_comprimirResumen(r).length).toBeLessThan(JSON.stringify(r).length);
  });
  test('al expandir se descartan wellId invalidos y estados desconocidos', () => {
    const texto = JSON.stringify({ APTO: ['01-0012', 'raro'], NO_APTO: [], DUDOSO: [], OTRO: ['01-0099'] });
    expect(Service.reemplazoService_expandirResumen(texto)).toEqual({ '01-0012': 'APTO' });
  });
  test('resumen vacio: ida y vuelta', () => {
    expect(Service.reemplazoService_expandirResumen(Service.reemplazoService_comprimirResumen({}))).toEqual({});
  });
});

describe('reemplazoService_getResumenMapa: cache e invalidacion', () => {
  const filas = [ev('01-0012', '2026-01-01T00:00:00.000Z', 'APTO')];

  test('primera llamada lee la hoja; la segunda sale del cache (una sola lectura)', () => {
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO' });
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO' });
    expect(global.reemplazoRepository_listarParaResumen).toHaveBeenCalledTimes(1);
  });

  test('un resumen vacio tambien se cachea (no relee la hoja por no haber evaluados)', () => {
    Service.reemplazoService_getResumenMapa();
    Service.reemplazoService_getResumenMapa();
    expect(global.reemplazoRepository_listarParaResumen).toHaveBeenCalledTimes(1);
  });

  test('el cache vive pocos minutos (180 s)', () => {
    const put = jest.spyOn(global.CacheService.getScriptCache(), 'put');
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    Service.reemplazoService_getResumenMapa();
    expect(put).toHaveBeenCalledWith(Service.REEMPLAZO_RESUMEN_CACHE_KEY, expect.any(String), 180);
  });

  test('invalidar fuerza una relectura', () => {
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    Service.reemplazoService_getResumenMapa();
    Service.reemplazoService_invalidarResumen();
    global.reemplazoRepository_listarParaResumen.mockReturnValue([...filas, ev('02-0007', '2026-02-01T00:00:00.000Z', 'DUDOSO')]);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO', '02-0007': 'DUDOSO' });
    expect(global.reemplazoRepository_listarParaResumen).toHaveBeenCalledTimes(2);
  });

  test('registrar una evaluacion nueva INVALIDA el cache: el estado nuevo aparece en el resumen siguiente', () => {
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO' });

    const r = Service.reemplazoService_registrar('u@x.com', 'U', '01-0012', { estado: 'NO_APTO', motivo: 'SECO', observacion: '', puntoNEReferencia: '' });
    expect(r.ok).toBe(true);

    global.reemplazoRepository_listarParaResumen.mockReturnValue([...filas, ev('01-0012', '2026-12-01T00:00:00.000Z', 'NO_APTO')]);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'NO_APTO' });
  });

  test('una validacion fallida al registrar NO invalida (no cambio nada)', () => {
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    Service.reemplazoService_getResumenMapa();
    Service.reemplazoService_registrar('u@x.com', 'U', '01-0012', { estado: 'NO_APTO', motivo: 'OTRO', observacion: '' });
    Service.reemplazoService_getResumenMapa();
    expect(global.reemplazoRepository_listarParaResumen).toHaveBeenCalledTimes(1);
  });

  test('si el cache falla (excepcion), igual responde leyendo la hoja', () => {
    jest.spyOn(global.CacheService.getScriptCache(), 'get').mockImplementation(() => { throw new Error('cache caido'); });
    jest.spyOn(global.CacheService.getScriptCache(), 'put').mockImplementation(() => { throw new Error('cache caido'); });
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO' });
  });

  test('cache con contenido ilegible: se ignora y se relee', () => {
    global.CacheService.getScriptCache().put(Service.REEMPLAZO_RESUMEN_CACHE_KEY, 'no es json', 180);
    global.reemplazoRepository_listarParaResumen.mockReturnValue(filas);
    expect(Service.reemplazoService_getResumenMapa()).toEqual({ '01-0012': 'APTO' });
  });

  test('error de la hoja se propaga (Api lo traduce a SERVICE_UNAVAILABLE)', () => {
    global.reemplazoRepository_listarParaResumen.mockImplementation(() => { throw new Error('hoja inexistente'); });
    expect(() => Service.reemplazoService_getResumenMapa()).toThrow('hoja inexistente');
  });
});

describe('rendimiento del calculo', () => {
  test('30.000 filas (varios anios de uso) se resumen en pocos ms', () => {
    const filas = [];
    for (let i = 0; i < 30000; i++) {
      filas.push(ev('0' + (1 + (i % 9)) + '-' + String(i % 3000).padStart(4, '0'), new Date(2026, 0, 1 + (i % 300)).toISOString(), ['APTO', 'NO_APTO', 'DUDOSO'][i % 3]));
    }
    const t0 = Date.now();
    const r = Service.reemplazoService_calcularResumen(filas);
    expect(Date.now() - t0).toBeLessThan(300);
    expect(Object.keys(r).length).toBeGreaterThan(1000);
  });
});

describe('reemplazoRepository_resumenDesdeColumnas (lectura de 3 columnas)', () => {
  test('une wellId/estado/timestamp, recorta espacios y pasa fechas a ISO', () => {
    const r = Repo.reemplazoRepository_resumenDesdeColumnas(
      [[' 01-0012 '], ['02-0007']],
      [['APTO'], [' NO_APTO ']],
      [[new Date('2026-05-01T12:00:00Z')], ['no es fecha']]
    );
    expect(r).toEqual([
      { wellId: '01-0012', estado: 'APTO', timestamp: '2026-05-01T12:00:00.000Z' },
      { wellId: '02-0007', estado: 'NO_APTO', timestamp: null }
    ]);
  });
  test('celdas vacias no rompen', () => {
    expect(Repo.reemplazoRepository_resumenDesdeColumnas([[null]], [[undefined]], [['']])).toEqual([{ wellId: '', estado: '', timestamp: null }]);
  });
});

describe('handleGetResumenReemplazoMapa (Api)', () => {
  function como(permisos, activo) {
    global.verifySessionToken.mockReturnValue({ valid: true, email: 'u@x.com' });
    global.isUserActive.mockReturnValue(activo !== false);
    global.hasPermission.mockImplementation((e, m) => activo !== false && permisos[m] === true);
  }

  test('reemplazo=NO: PERMISSION_DENIED, no lee nada y se audita el rechazo', () => {
    como({ perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: false });
    const r = Api.handleGetResumenReemplazoMapa('t');
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(global.reemplazoService_getResumenMapa).not.toHaveBeenCalled();
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@x.com', 'getResumenReemplazoMapa', null, 'PERMISSION_DENIED');
  });

  test('columna ausente / sin ningun permiso: PERMISSION_DENIED', () => {
    como({});
    expect(Api.handleGetResumenReemplazoMapa('t').code).toBe('PERMISSION_DENIED');
  });

  test('reemplazo=SI (y nada mas): devuelve el mapa wellId -> estado tal cual', () => {
    como({ reemplazo: true });
    global.reemplazoService_getResumenMapa.mockReturnValue({ '01-0012': 'APTO', '02-0007': 'DUDOSO' });
    expect(Api.handleGetResumenReemplazoMapa('t')).toEqual({ status: 'ok', data: { '01-0012': 'APTO', '02-0007': 'DUDOSO' } });
  });

  test('ningun evaluado: data vacio', () => {
    como({ reemplazo: true });
    global.reemplazoService_getResumenMapa.mockReturnValue({});
    expect(Api.handleGetResumenReemplazoMapa('t')).toEqual({ status: 'ok', data: {} });
  });

  test('sesion invalida: UNAUTHORIZED; usuario inactivo: USER_DISABLED', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    expect(Api.handleGetResumenReemplazoMapa('t').code).toBe('UNAUTHORIZED');
    como({ reemplazo: true }, false);
    expect(Api.handleGetResumenReemplazoMapa('t').code).toBe('USER_DISABLED');
    expect(global.reemplazoService_getResumenMapa).not.toHaveBeenCalled();
  });

  test('lectura OK: SIN fila de Historial y sin Telegram (sin ruido)', () => {
    como({ reemplazo: true });
    global.reemplazoService_getResumenMapa.mockReturnValue({});
    Api.handleGetResumenReemplazoMapa('t');
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
    expect(global.notificationService_notifyWellSearch).not.toHaveBeenCalled();
    expect(global.notificationService_notifyDescargaItf).not.toHaveBeenCalled();
  });

  test('falla de la hoja: SERVICE_UNAVAILABLE y se audita', () => {
    como({ reemplazo: true });
    global.reemplazoService_getResumenMapa.mockImplementation(() => { throw new Error('boom'); });
    expect(Api.handleGetResumenReemplazoMapa('t').code).toBe('SERVICE_UNAVAILABLE');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@x.com', 'getResumenReemplazoMapa', null, 'SERVICE_UNAVAILABLE');
  });

  test('doPost enruta la accion', () => {
    como({ reemplazo: true });
    global.reemplazoService_getResumenMapa.mockReturnValue({ '01-0012': 'APTO' });
    const r = JSON.parse(Api.doPost({ postData: { contents: JSON.stringify({ action: 'getResumenReemplazoMapa', sessionToken: 't' }) } }).text);
    expect(r).toEqual({ status: 'ok', data: { '01-0012': 'APTO' } });
  });
});
