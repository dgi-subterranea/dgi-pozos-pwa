// Lectura en LOTE del padron (E3-1): registryRepository_getWellRecordsBatch / registryService_getWellLocations. Contrato:
//   - cada archivo de departamento (o particion) se abre UNA sola vez por llamada, aunque pidan muchos pozos de el;
//   - el cache por pozo que ya usa getWellRecord se LEE (acierto = no se abre nada) pero el lote no lo escribe;
//   - "el pozo no esta en el archivo" (null) es una respuesta; "no se pudo leer / se acabo el tiempo" va a noResueltos y nunca se inventa;
//   - getWellRecord / getWellLocation siguen igual (misma vista geografica, mismo limpiado).
const { installAppsScriptFakes } = require('./appsScriptFakes');

let Repo;
let Svc;
let cache;
let lecturas;          // nombre de archivo cada vez que se LEE su contenido
let busquedas;         // nombre de archivo cada vez que se pide a Drive
let archivos;          // nombre -> objeto | texto crudo | Error
let ahora;

const ficha = (id, extra) => Object.assign({
  wellId: id,
  ubicacion: { coordenadas: { x: 2500000, y: 6350000 }, coordenadasProvincia: [{ x: 2500010, y: 6350010 }], ubicacionResuelta: { estado: 'corroborada', lat: -33.3, lon: -69.1 } },
  titularidad: { titular: 'Juan Perez' }
}, extra || {});

function crearCache() {
  const c = {
    store: {},
    get: jest.fn((k) => (Object.prototype.hasOwnProperty.call(c.store, k) ? c.store[k] : null)),
    put: jest.fn((k, v) => { c.store[k] = v; }),
    putAll: jest.fn((o) => { Object.keys(o).forEach((k) => { c.store[k] = o[k]; }); }),
    getAll: jest.fn((keys) => {
      if (keys.length > 100) { throw new Error('getAll admite hasta 100 claves'); }
      const r = {};
      keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(c.store, k)) { r[k] = c.store[k]; } });
      return r;
    })
  };
  return c;
}

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  lecturas = [];
  busquedas = [];
  ahora = 1000000;
  archivos = {};
  cache = crearCache();
  global.CacheService = { getScriptCache: () => cache };
  global.getRegistryFolderId = () => 'carpeta-registro';
  global.DriveApp = {
    getFolderById: () => ({
      getFilesByName: (nombre) => {
        busquedas.push(nombre);
        if (!Object.prototype.hasOwnProperty.call(archivos, nombre)) { return { hasNext: () => false }; }
        let usado = false;
        return {
          hasNext: () => !usado,
          next: () => {
            usado = true;
            return { getBlob: () => ({ getDataAsString: () => {
              lecturas.push(nombre);
              ahora += 1000;                                   // cada lectura "tarda" 1 s (reloj controlado)
              const c = archivos[nombre];
              if (c instanceof Error) { throw c; }
              return typeof c === 'string' ? c : JSON.stringify(c);
            } }) };
          }
        };
      }
    })
  };
  jest.spyOn(Date, 'now').mockImplementation(() => ahora);
  Repo = require('../src/RegistryRepository');
  Object.assign(global, Repo);
  Svc = require('../src/RegistryService');
});
afterEach(() => { jest.restoreAllMocks(); });

describe('un archivo se abre UNA vez aunque pidan muchos pozos', () => {
  test('pozos de un departamento simple y de dos particiones: 3 archivos, 3 lecturas', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001'), '01-0012': ficha('01-0012'), '01-0500': ficha('01-0500') };
    archivos['07-1.json'] = { '07-1005': ficha('07-1005'), '07-1006': ficha('07-1006') };
    archivos['07-2.json'] = { '07-2001': ficha('07-2001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '07-1005', '01-0012', '07-2001', '01-0500', '07-1006']);
    expect(lecturas.sort()).toEqual(['01.json', '07-1.json', '07-2.json']);
    expect(busquedas.sort()).toEqual(['01.json', '07-1.json', '07-2.json']);
    expect(r.archivosAbiertos).toBe(3);
    expect(Object.keys(r.registros).sort()).toEqual(['01-0001', '01-0012', '01-0500', '07-1005', '07-1006', '07-2001']);
    expect(r.registros['07-1006'].wellId).toBe('07-1006');
    expect(r.noResueltos).toEqual([]);
    expect(r.errores).toEqual([]);
  });

  test('muchos pozos del mismo archivo (2.000) siguen siendo UNA lectura', () => {
    const grande = {};
    const ids = [];
    for (let i = 1; i <= 2000; i++) { const id = '05-' + String(i).padStart(4, '0'); grande[id] = ficha(id); ids.push(id); }
    archivos['05.json'] = grande;
    const r = Repo.registryRepository_getWellRecordsBatch(ids);
    expect(lecturas).toEqual(['05.json']);
    expect(Object.keys(r.registros)).toHaveLength(2000);
    expect(cache.getAll.mock.calls.length).toBe(20);                      // 2.000 claves de cache en lotes de 100
  });

  test('repetidos y valores que no son texto se ignoran', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '01-0001', null, 42, undefined, { a: 1 }]);
    expect(Object.keys(r.registros)).toEqual(['01-0001']);
    expect(Repo.registryRepository_getWellRecordsBatch('no es un arreglo').registros).toEqual({});
    expect(Repo.registryRepository_getWellRecordsBatch().noResueltos).toEqual([]);
  });
});

describe('"no esta" es una respuesta; "no se pudo" es otra', () => {
  test('el pozo no figura en su archivo -> null (no es noResuelto)', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '01-9999']);
    expect(r.registros['01-9999']).toBeNull();
    expect(r.noResueltos).toEqual([]);
  });

  test('el archivo no existe en Drive -> null para todos sus pozos', () => {
    const r = Repo.registryRepository_getWellRecordsBatch(['02-0001', '02-0002']);
    expect(r.registros).toEqual({ '02-0001': null, '02-0002': null });
    expect(r.noResueltos).toEqual([]);
    expect(r.archivosAbiertos).toBe(0);
  });

  test('un archivo ilegible deja SUS pozos en noResueltos (con el detalle en errores) y no afecta a los demas', () => {
    archivos['01.json'] = '{esto no es json';
    archivos['03.json'] = { '03-0001': ficha('03-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '01-0002', '03-0001']);
    expect(r.noResueltos.sort()).toEqual(['01-0001', '01-0002']);
    expect(r.registros['03-0001'].wellId).toBe('03-0001');
    expect(r.registros['01-0001']).toBeUndefined();                        // jamas se inventa un valor
    expect(r.errores).toHaveLength(1);
    expect(r.errores[0].archivo).toBe('01.json');
    expect(typeof r.errores[0].detalle).toBe('string');
  });

  test('Drive que lanza al leer -> noResueltos', () => {
    archivos['01.json'] = new Error('Drive caido');
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001']);
    expect(r.noResueltos).toEqual(['01-0001']);
    expect(r.errores[0].detalle).toMatch(/Drive caido/);
  });

  test('las claves heredadas del prototipo no cuentan como pozos del archivo', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '01-constructor']);
    expect(r.registros['01-constructor']).toBeNull();
  });
});

describe('presupuesto de tiempo (deadlineMs)', () => {
  test('con el limite ya vencido no se abre NINGUN archivo y todo queda sin resolver', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '03-0001'], { deadlineMs: ahora });
    expect(busquedas).toEqual([]);
    expect(r.noResueltos.sort()).toEqual(['01-0001', '03-0001']);
    expect(r.registros).toEqual({});
  });

  test('se acaba a mitad de camino: lo ya leido se conserva y el resto queda sin resolver (ordenado por archivo)', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    archivos['02.json'] = { '02-0001': ficha('02-0001') };
    archivos['03.json'] = { '03-0001': ficha('03-0001') };
    // cada lectura suma 1 s: con 1,5 s de margen se alcanza a leer 01 (1 s) y 02 (2 s, el control se hace ANTES de abrir), pero no 03
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '02-0001', '03-0001'], { deadlineMs: ahora + 1500 });
    expect(lecturas).toEqual(['01.json', '02.json']);
    expect(Object.keys(r.registros).sort()).toEqual(['01-0001', '02-0001']);
    expect(r.noResueltos).toEqual(['03-0001']);
  });

  test('sin limite se lee todo', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    expect(Repo.registryRepository_getWellRecordsBatch(['01-0001']).noResueltos).toEqual([]);
  });
});

describe('cache por pozo (el que ya usa getWellRecord)', () => {
  test('acierto: no se abre el archivo; "null" cacheado = el pozo no existe', () => {
    cache.store['registry_01-0001'] = JSON.stringify(ficha('01-0001'));
    cache.store['registry_01-0002'] = 'null';
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '01-0002']);
    expect(busquedas).toEqual([]);
    expect(r.desdeCache).toBe(2);
    expect(r.registros['01-0001'].wellId).toBe('01-0001');
    expect(r.registros['01-0002']).toBeNull();
  });

  test('mezcla: solo se lee el archivo de los que faltan', () => {
    cache.store['registry_01-0001'] = JSON.stringify(ficha('01-0001'));
    archivos['03.json'] = { '03-0001': ficha('03-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001', '03-0001']);
    expect(lecturas).toEqual(['03.json']);
    expect(Object.keys(r.registros).sort()).toEqual(['01-0001', '03-0001']);
  });

  test('un valor ilegible en el cache se trata como si no estuviera', () => {
    cache.store['registry_01-0001'] = '{roto';
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecordsBatch(['01-0001']);
    expect(lecturas).toEqual(['01.json']);
    expect(r.registros['01-0001'].wellId).toBe('01-0001');
  });

  test('si el cache falla (getAll lanza) se lee del archivo y el resultado es el mismo', () => {
    cache.getAll.mockImplementation(() => { throw new Error('cache caido'); });
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    expect(Repo.registryRepository_getWellRecordsBatch(['01-0001']).registros['01-0001'].wellId).toBe('01-0001');
  });

  test('sin CacheService tambien funciona', () => {
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    expect(Repo.registryRepository_getWellRecordsBatch(['01-0001']).registros['01-0001'].wellId).toBe('01-0001');
  });

  test('el lote NO escribe en el cache (put / putAll nunca se llaman)', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    Repo.registryRepository_getWellRecordsBatch(['01-0001']);
    expect(cache.put).not.toHaveBeenCalled();
    expect(cache.putAll).not.toHaveBeenCalled();
  });
});

describe('getWellRecord y getWellLocation no cambiaron', () => {
  test('getWellRecord sigue cacheando por pozo', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Repo.registryRepository_getWellRecord('01-0001');
    expect(r.found).toBe(true);
    expect(cache.put).toHaveBeenCalledWith('registry_01-0001', expect.any(String), 600);
  });

  test('registryService_getWellLocation devuelve la misma vista que antes (solo lo geografico, sin nulos)', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    const r = Svc.registryService_getWellLocation('01-0001');
    expect(r).toEqual({ found: true, location: { wellId: '01-0001', coordenadas: { x: 2500000, y: 6350000 }, coordenadasProvincia: [{ x: 2500010, y: 6350010 }], ubicacionResuelta: { estado: 'corroborada', lat: -33.3, lon: -69.1 } } });
    expect(Svc.registryService_getWellLocation('01-9999')).toEqual({ found: false });
  });
});

describe('registryService_getWellLocations (vista geografica en lote)', () => {
  test('cada pozo trae EXACTAMENTE la vista de getWellLocation; nada de titular ni del resto de la ficha', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001'), '01-0012': ficha('01-0012', { ubicacion: { coordenadas: null, coordenadasProvincia: [{ x: 1, y: 2 }] } }) };
    const lote = Svc.registryService_getWellLocations(['01-0001', '01-0012']);
    ['01-0001', '01-0012'].forEach((id) => {
      expect(lote.locations[id]).toEqual(Svc.registryService_getWellLocation(id).location);
    });
    expect(JSON.stringify(lote.locations)).not.toMatch(/Juan Perez|titular/);
    expect(lote.archivosAbiertos).toBeGreaterThanOrEqual(1);
  });

  test('pozo ausente -> null; pozo que no se pudo leer -> noResueltos y sin entrada en locations', () => {
    archivos['01.json'] = { '01-0001': ficha('01-0001') };
    archivos['03.json'] = '{roto';
    const lote = Svc.registryService_getWellLocations(['01-0001', '01-0404', '03-0001']);
    expect(lote.locations['01-0404']).toBeNull();
    expect(lote.locations['03-0001']).toBeUndefined();
    expect(lote.noResueltos).toEqual(['03-0001']);
    expect(lote.errores).toHaveLength(1);
  });
});
