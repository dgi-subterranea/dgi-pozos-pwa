// "¿Este pozo existe para la aplicacion?" (E4-1): politica de existencia, orden de fuentes, fail-closed, cache solo de positivos y que ni Fotos, ni evaluaciones de reemplazo,
// ni el historial de Busquedas cuenten como prueba. Las fuentes se simulan como globals (asi es Apps Script); aca no hay Drive ni Sheets.
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');

const W = '14-0123';

let P;
let cacheAlmacen;
let orden;

function instalarCache(opciones) {
  const o = opciones || {};
  cacheAlmacen = {};
  global.CacheService = {
    getScriptCache: () => {
      if (o.getScriptCacheLanza) { throw new Error('CacheService caido'); }
      return {
        get: (k) => { if (o.getLanza) { throw new Error('get caido'); } return Object.prototype.hasOwnProperty.call(cacheAlmacen, k) ? cacheAlmacen[k] : null; },
        put: (k, v, ttl) => { if (o.putLanza) { throw new Error('put caido'); } cacheAlmacen[k] = v; cacheAlmacen.__ttl = ttl; },
        remove: (k) => { delete cacheAlmacen[k]; }
      };
    }
  };
}

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  P = require('../src/PozoExistenciaService');
  Object.assign(global, P);
  instalarCache();
  orden = [];
  // por defecto NINGUNA fuente confirma; cada una registra su orden de consulta
  global.registryService_getWellLocation = jest.fn(() => { orden.push('PADRON'); return { found: false }; });
  global.driveProfileRepository_existe = jest.fn(() => { orden.push('ITF'); return false; });
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => { orden.push('NE'); return { found: false }; });
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { orden.push('CORRECCION_PREVIA'); return []; });
});

const verificar = (id, opciones) => P.pozoExistenciaService_verificar(id === undefined ? W : id, opciones);

describe('wellId: primero el formato (no se amplia el universo de ids)', () => {
  test.each([['14-123'], ['1-0123'], ['14_0123'], ['AB-0123'], ['14-01234'], [' 14-0123'], [''], ['00-0001'], ['20-0001'], ['99-9999'], [null], [undefined], [14], [['14-0123']], [{ wellId: W }]])('%j no es valido: no se consulta ninguna fuente', (id) => {
    expect(P.pozoExistenciaService_verificar(id)).toEqual({ existe: false, enPadron: false, fuentes: [], indeterminado: false, noVerificadas: [] });
    expect(orden).toEqual([]);
    expect(global.CacheService.getScriptCache).toBeDefined();
  });

  test.each([['01-0001'], ['14-0123'], ['19-9999']])('%s es valido (departamentos 01 a 19)', (id) => {
    expect(P.pozoExistenciaService_wellIdValido(id)).toBe(true);
  });
});

describe('cada fuente por separado', () => {
  test('PADRON: existe, enPadron, y trae la vista de ubicacion para el snapshot; las demas fuentes ni se consultan', () => {
    const location = { wellId: W, ubicacionResuelta: { estado: 'unica' } };
    global.registryService_getWellLocation = jest.fn(() => { orden.push('PADRON'); return { found: true, location }; });
    const r = verificar();
    expect(r).toMatchObject({ existe: true, enPadron: true, fuentes: ['PADRON'], indeterminado: false });
    expect(r.location).toBe(location);
    expect(orden).toEqual(['PADRON']);
  });

  test('ITF: existe, fuera del padron, por <wellId>.jpg (solo existencia: se consulta con el wellId, no se descarga nada)', () => {
    global.driveProfileRepository_existe = jest.fn(() => { orden.push('ITF'); return true; });
    const r = verificar();
    expect(r).toEqual({ existe: true, enPadron: false, fuentes: ['ITF'], indeterminado: false, noVerificadas: [] });
    expect(global.driveProfileRepository_existe).toHaveBeenCalledWith(W);
    expect(orden).toEqual(['PADRON', 'ITF']);
  });

  test('NE: existe (solo prueba existencia; la coordenada del punto NE no se usa)', () => {
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => { orden.push('NE'); return { found: true, punto: { coordenadas: { lat: -33.1, lon: -69.1 } } }; });
    const r = verificar();
    expect(r).toEqual({ existe: true, enPadron: false, fuentes: ['NE'], indeterminado: false, noVerificadas: [] });
    expect(global.nivelesEstaticosRepository_getPunto).toHaveBeenCalledWith(W);
    expect(JSON.stringify(r)).not.toMatch(/-33\.1|lat|lon/);                       // ninguna coordenada del NE sale del helper
    expect(orden).toEqual(['PADRON', 'ITF', 'NE']);
  });

  test('CORRECCION PREVIA: cualquier fila del pozo en UbicacionCorrecciones cuenta, sin importar su estado', () => {
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { orden.push('CORRECCION_PREVIA'); return [{ wellId: '14-0001' }, { wellId: W, irrEstado: 'noEnPadron' }]; });
    const r = verificar();
    expect(r).toEqual({ existe: true, enPadron: false, fuentes: ['CORRECCION_PREVIA'], indeterminado: false, noVerificadas: [] });
    expect(orden).toEqual(['PADRON', 'ITF', 'NE', 'CORRECCION_PREVIA']);
  });

  test('una correccion de OTRO pozo no cuenta', () => {
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => [{ wellId: '14-0124' }, { wellId: '13-0123' }]);
    expect(verificar()).toMatchObject({ existe: false, indeterminado: false });
  });

  test('todas dicen que no: no existe y NO es indeterminado (quien llama responde WELL_NOT_FOUND)', () => {
    expect(verificar()).toEqual({ existe: false, enPadron: false, fuentes: [], indeterminado: false, noVerificadas: [] });
    expect(orden).toEqual(['PADRON', 'ITF', 'NE', 'CORRECCION_PREVIA']);
  });
});

describe('se corta en la primera fuente que confirma', () => {
  test('ITF confirma: ni NE ni las correcciones se consultan', () => {
    global.driveProfileRepository_existe = jest.fn(() => { orden.push('ITF'); return true; });
    verificar();
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
    expect(global.ubicacionCorreccionRepository_listarCorrecciones).not.toHaveBeenCalled();
  });

  test('NE confirma: no se lee la hoja de correcciones', () => {
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: true }));
    verificar();
    expect(global.ubicacionCorreccionRepository_listarCorrecciones).not.toHaveBeenCalled();
  });

  test('una fuente confirma ANTES de otra que fallaria: no se bloquea por la falla posterior (ni se la consulta)', () => {
    global.driveProfileRepository_existe = jest.fn(() => true);
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => { throw new Error('NE caido'); });
    global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { throw new Error('hoja caida'); });
    expect(verificar()).toEqual({ existe: true, enPadron: false, fuentes: ['ITF'], indeterminado: false, noVerificadas: [] });
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
  });

  test('una fuente que FALLA antes de una que confirma: se anota, se sigue y existe=true (la falla queda en Logger)', () => {
    global.driveProfileRepository_existe = jest.fn(() => { throw new Error('Drive caido'); });
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: true }));
    const r = verificar();
    expect(r).toEqual({ existe: true, enPadron: false, fuentes: ['NE'], indeterminado: false, noVerificadas: ['ITF'] });
    expect(global.Logger.log).toHaveBeenCalledWith(expect.stringContaining('ITF no se pudo verificar para ' + W));
  });
});

describe('FAIL-CLOSED: un error nunca se vuelve "no existe" ni "existe"', () => {
  test.each([
    ['ITF', () => { global.driveProfileRepository_existe = jest.fn(() => { throw new Error('Drive caido'); }); }, ['ITF']],
    ['NE', () => { global.nivelesEstaticosRepository_getPunto = jest.fn(() => { throw new Error('NE caido'); }); }, ['NE']],
    ['CORRECCION_PREVIA', () => { global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => { throw new Error('hoja caida'); }); }, ['CORRECCION_PREVIA']]
  ])('una falla (%s) y ninguna otra confirma: indeterminado (SERVICE_UNAVAILABLE), existe=false', (_n, romper, noVerificadas) => {
    romper();
    expect(verificar()).toEqual({ existe: false, enPadron: false, fuentes: [], indeterminado: true, noVerificadas: noVerificadas });
  });

  test('varias fallan y ninguna confirma: indeterminado con todas anotadas', () => {
    global.driveProfileRepository_existe = jest.fn(() => { throw new Error('a'); });
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => { throw new Error('b'); });
    expect(verificar()).toMatchObject({ existe: false, indeterminado: true, noVerificadas: ['ITF', 'NE'] });
  });

  test('el PADRON no se puede consultar: indeterminado de inmediato (sin padron no se puede afirmar "fuera del padron"), y NO se prueba otra fuente', () => {
    global.registryService_getWellLocation = jest.fn(() => { throw new Error('padron caido'); });
    global.driveProfileRepository_existe = jest.fn(() => true);                // aunque el ITF confirmaria
    expect(verificar()).toEqual({ existe: false, enPadron: false, fuentes: [], indeterminado: true, noVerificadas: ['PADRON'] });
    expect(global.driveProfileRepository_existe).not.toHaveBeenCalled();
    expect(global.Logger.log).toHaveBeenCalledWith(expect.stringContaining('el padron no se pudo consultar para ' + W));
  });

  test('una funcion de lectura que no existe es una fuente no verificable (nunca se supone una respuesta)', () => {
    delete global.driveProfileRepository_existe;
    expect(verificar()).toMatchObject({ existe: false, indeterminado: true, noVerificadas: ['ITF'] });
  });

  test('un valor raro de una fuente (undefined, 1, "si") NO es una confirmacion: solo true confirma', () => {
    ['si', 1, {}, undefined, null].forEach((valor) => {
      global.driveProfileRepository_existe = jest.fn(() => valor);
      global.nivelesEstaticosRepository_getPunto = jest.fn(() => valor);
      expect(verificar()).toMatchObject({ existe: false, indeterminado: false });
    });
  });

  test('NE: solo found:true cuenta (found:"true", truthy o un objeto sin found no)', () => {
    [{ found: 'true' }, { found: 1 }, { punto: {} }, null, undefined, 'x'].forEach((r) => {
      global.nivelesEstaticosRepository_getPunto = jest.fn(() => r);
      expect(verificar()).toMatchObject({ existe: false });
    });
  });
});

describe('opciones.padron: quien ya consulto el padron no lo consulta dos veces', () => {
  test('{found:false} ya obtenido: no se vuelve a llamar al padron', () => {
    global.driveProfileRepository_existe = jest.fn(() => true);
    const r = verificar(W, { padron: { found: false } });
    expect(r.existe).toBe(true);
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('{found:true, location} ya obtenido: se usa tal cual', () => {
    const location = { wellId: W };
    const r = verificar(W, { padron: { found: true, location } });
    expect(r).toMatchObject({ existe: true, enPadron: true });
    expect(r.location).toBe(location);
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });
});

describe('CACHE: solo positivos de las fuentes que no son el padron, ~10 minutos', () => {
  test('un positivo (ITF) se cachea por pozo con TTL de 600 s y la siguiente verificacion no vuelve a consultar ITF ni NE', () => {
    global.driveProfileRepository_existe = jest.fn(() => true);
    verificar();
    expect(cacheAlmacen[P.POZO_EXISTENCIA_CACHE_PREFIJO + W]).toBe('["ITF"]');
    expect(cacheAlmacen.__ttl).toBe(600);
    expect(P.POZO_EXISTENCIA_CACHE_SEGUNDOS).toBe(600);
    global.driveProfileRepository_existe.mockClear();
    const r = verificar();
    expect(r).toEqual({ existe: true, enPadron: false, fuentes: ['ITF'], indeterminado: false, noVerificadas: [] });
    expect(global.driveProfileRepository_existe).not.toHaveBeenCalled();
  });

  test('el cache va por pozo: otro pozo se verifica igual', () => {
    global.driveProfileRepository_existe = jest.fn(() => true);
    verificar(W);
    global.driveProfileRepository_existe.mockClear();
    verificar('14-0124');
    expect(global.driveProfileRepository_existe).toHaveBeenCalledWith('14-0124');
  });

  test('un NEGATIVO no se cachea (se vuelve a consultar siempre)', () => {
    verificar();
    verificar();
    expect(global.driveProfileRepository_existe).toHaveBeenCalledTimes(2);
    expect(Object.keys(cacheAlmacen)).toEqual([]);
  });

  test('un INDETERMINADO no se cachea', () => {
    global.driveProfileRepository_existe = jest.fn(() => { throw new Error('Drive caido'); });
    verificar();
    verificar();
    expect(global.driveProfileRepository_existe).toHaveBeenCalledTimes(2);
    expect(Object.keys(cacheAlmacen)).toEqual([]);
  });

  test('el PADRON no se cachea (ya tiene su cache y de ahi sale la ubicacion): el padron se consulta siempre primero', () => {
    global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: { wellId: W } }));
    verificar();
    verificar();
    expect(global.registryService_getWellLocation).toHaveBeenCalledTimes(2);
    expect(Object.keys(cacheAlmacen)).toEqual([]);
  });

  test('un positivo cacheado NO tapa al padron: si el pozo entra al padron, manda el padron', () => {
    global.driveProfileRepository_existe = jest.fn(() => true);
    verificar();
    global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: { wellId: W } }));
    expect(verificar()).toMatchObject({ existe: true, enPadron: true, fuentes: ['PADRON'] });
  });

  test.each([
    ['getScriptCache lanza', { getScriptCacheLanza: true }],
    ['get lanza', { getLanza: true }],
    ['put lanza', { putLanza: true }]
  ])('CacheService caido (%s): la verificacion sigue y da el mismo resultado', (_n, opciones) => {
    instalarCache(opciones);
    global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: true }));
    expect(verificar()).toEqual({ existe: true, enPadron: false, fuentes: ['NE'], indeterminado: false, noVerificadas: [] });
    expect(global.Logger.log).toHaveBeenCalled();
  });

  test.each([['no es JSON', 'xx'], ['no es lista', '{"a":1}'], ['lista vacia', '[]'], ['fuente desconocida', '["FOTOS"]'], ['padron cacheado (no se cachea)', '["PADRON"]']])('un valor ilegible en el cache (%s) se ignora y se verifica de nuevo', (_n, valor) => {
    cacheAlmacen[P.POZO_EXISTENCIA_CACHE_PREFIJO + W] = valor;
    expect(verificar()).toMatchObject({ existe: false });
    expect(global.driveProfileRepository_existe).toHaveBeenCalled();
  });
});

describe('lo que NO prueba existencia', () => {
  test('el helper no lee Fotos, evaluaciones de reemplazo ni el historial de Busquedas (ni siquiera existen como dependencia)', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'PozoExistenciaService.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/fotosPozos|fotosReemplazo|reemplazoRepository|reemplazoService|searchHistory|sheetSearchHistory|sheetHistory|logHistoryEvent|Busquedas/i);
    expect(fuente).not.toMatch(/fotos/i);
  });

  test('aunque Fotos / reemplazos / Busquedas dijeran que el pozo existe, el resultado es que no existe', () => {
    global.fotosPozosRepository_listarVisiblesPorEntidad = jest.fn(() => [{ wellId: W }]);
    global.fotosPozosRepository_contarVisiblesPorEntidad = jest.fn(() => ({ [W]: 3 }));
    global.reemplazoRepository_listarPorWellId = jest.fn(() => [{ wellId: W }]);
    global.reemplazoRepository_listarParaResumen = jest.fn(() => [{ wellId: W }]);
    global.sheetSearchHistoryRepository_logSearch = jest.fn();
    expect(verificar()).toMatchObject({ existe: false, indeterminado: false });
    expect(global.fotosPozosRepository_listarVisiblesPorEntidad).not.toHaveBeenCalled();
    expect(global.fotosPozosRepository_contarVisiblesPorEntidad).not.toHaveBeenCalled();
    expect(global.reemplazoRepository_listarPorWellId).not.toHaveBeenCalled();
    expect(global.reemplazoRepository_listarParaResumen).not.toHaveBeenCalled();
  });

  test('es de solo lectura: ninguna escritura (ni cache salvo el positivo) ni historial', () => {
    verificar();
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });
});

describe('vista sintetica de un pozo fuera del padron', () => {
  test('sin coordenadas ni ficha: estado noEnPadron (distinto de sinCoordenadas)', () => {
    expect(P.pozoExistenciaService_ubicacionFueraDelPadron(W)).toEqual({ wellId: W, coordenadas: null, coordenadasProvincia: [], ubicacionResuelta: { estado: 'noEnPadron' } });
  });

  test('no inventa lat/lon/x/y en ningun lado', () => {
    expect(JSON.stringify(P.pozoExistenciaService_ubicacionFueraDelPadron(W))).not.toMatch(/"lat"|"lon"|"x"|"y"/);
  });
});

describe('el helper es el UNICO lugar: nadie mas consulta ITF por existencia', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

  test('solo lo llaman: la correccion de ubicacion (snapshot), el handler de getWellLocation y -desde E5-2- agregar una observacion', () => {
    const usuarios = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => f !== 'PozoExistenciaService.js' && /pozoExistenciaService_/.test(src(f)));
    expect(usuarios.sort()).toEqual(['Api.js', 'ObservacionesPozoService.js', 'UbicacionCorreccionService.js']);
  });

  test('Observaciones lo usa SOLO al escribir (agregar): la lectura no verifica existencia, y no es una de sus fuentes', () => {
    const codigo = (f) => src(f).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const servicio = codigo('ObservacionesPozoService.js');
    const inicio = servicio.indexOf('function observacionesPozoService_agregar(');
    const llamadasFuera = servicio.slice(0, inicio) + servicio.slice(servicio.indexOf('if (typeof module', inicio));
    expect(servicio.slice(inicio)).toMatch(/pozoExistenciaService_verificar\(wellId\)/);
    expect(llamadasFuera).not.toMatch(/pozoExistenciaService_/);
    expect(codigo('PozoExistenciaService.js')).not.toMatch(/bservacion/);                    // ni como fuente ni de ninguna otra forma
  });

  test('driveProfileRepository_existe solo lo usa el helper (y se define en el repositorio de ITF)', () => {
    const usuarios = fs.readdirSync(path.join(__dirname, '..', 'src')).filter((f) => /driveProfileRepository_existe/.test(src(f)));
    expect(usuarios.sort()).toEqual(['DriveProfileRepository.js', 'PozoExistenciaService.js']);
  });
});
