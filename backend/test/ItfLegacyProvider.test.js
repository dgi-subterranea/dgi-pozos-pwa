// ItfLegacyProvider (E9-3): politica unica de nombre legacy, ambiguedad fail-closed, indice de disponibilidad en lote (una lectura, single-flight), resolucion de un pozo (una llamada a Drive),
// huella para el registro (SHA-256 de los bytes reales) y verificacion al restaurar. Drive falso con contadores; nada toca Google.
const { crearEntorno, JPEG, PNG, sha256 } = require('./itfEntorno');

let E;
let L;

const archivo = (id, name, bytes) => ({ id: id, name: name, bytes: bytes || JPEG(200, 7) });
const entorno = (archivos, opciones) => { E = crearEntorno(Object.assign({ archivos: archivos }, opciones || {})); L = E.mods.legacy; return E; };

describe('politica de nombre: pura', () => {
  beforeEach(() => entorno([]));
  test('el nombre canonico es <wellId>.jpg con extension en minuscula', () => {
    expect(L.itfLegacy_nombre('14-0001')).toBe('14-0001.jpg');
    expect(L.ITF_LEGACY_EXTENSION).toBe('.jpg');
  });
  test('clasificar: canonico, no canonico (cualquier mayuscula), duplicados; lo que no parece un ITF se ignora', () => {
    const r = L.itfLegacy_clasificarNombres(['14-0001.jpg', '14-0001.jpg', '14-0002.JPG', '14-0003.Jpg', '14-0004.jpg', '14-0004.JPG', 'readme.txt', '14-0005.png', '14-001.jpg', 'x14-0006.jpg', '', null, 7]);
    expect(r).toEqual({
      '14-0001': { canonicos: 2, noCanonicos: 0 },
      '14-0002': { canonicos: 0, noCanonicos: 1 },
      '14-0003': { canonicos: 0, noCanonicos: 1 },
      '14-0004': { canonicos: 1, noCanonicos: 1 }
    });
  });
  test('estadoDe: NO / UNICO / AMBIGUO / NO_CANONICO', () => {
    expect(L.itfLegacy_estadoDe(undefined)).toBe('NO');
    expect(L.itfLegacy_estadoDe({ canonicos: 0, noCanonicos: 0 })).toBe('NO');
    expect(L.itfLegacy_estadoDe({ canonicos: 1, noCanonicos: 0 })).toBe('UNICO');
    expect(L.itfLegacy_estadoDe({ canonicos: 1, noCanonicos: 3 })).toBe('UNICO');
    expect(L.itfLegacy_estadoDe({ canonicos: 2, noCanonicos: 0 })).toBe('AMBIGUO');
    expect(L.itfLegacy_estadoDe({ canonicos: 0, noCanonicos: 2 })).toBe('NO_CANONICO');
  });
  test('solo UNICO es true y solo NO es false para el dominio; el resto es "no se sabe" (null)', () => {
    expect(L.itfLegacy_aDisponible('UNICO')).toBe(true);
    expect(L.itfLegacy_aDisponible('NO')).toBe(false);
    ['AMBIGUO', 'NO_CANONICO', 'DESCONOCIDO', undefined, null, 'x'].forEach((e) => expect(L.itfLegacy_aDisponible(e)).toBeNull());
  });
});

describe('disponibilidad en lote: UN indice, UNA pasada por la carpeta', () => {
  test('estados por pozo y una sola listada de la carpeta', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0002.jpg'), archivo('c', '14-0002.jpg'), archivo('d', '14-0003.JPG'), archivo('e', '01-0012.jpg')]);
    const r = L.itfLegacy_disponibilidad(['14-0001', '14-0002', '14-0003', '14-0004', '01-0012']);
    expect(r).toEqual({ '14-0001': 'UNICO', '14-0002': 'AMBIGUO', '14-0003': 'NO_CANONICO', '14-0004': 'NO', '01-0012': 'UNICO' });
    expect(E.drive.calls.getFiles).toBe(1);
    expect(E.drive.calls.getFilesByName).toBe(0);
  });
  test('lista vacia o ausente: nada, sin tocar Drive', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    expect(L.itfLegacy_disponibilidad([])).toEqual({});
    expect(L.itfLegacy_disponibilidad(null)).toEqual({});
    expect(E.drive.calls.getFiles).toBe(0);
  });
  test.each([1, 50, 500, 700])('%i pozos: las lecturas de Drive no dependen de N (1 listada la primera vez, 0 despues)', (n) => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0002.jpg')]);
    const ids = [];
    for (let i = 1; i <= n; i += 1) { ids.push('14-' + String(i).padStart(4, '0')); }
    const r = L.itfLegacy_disponibilidad(ids);
    expect(Object.keys(r)).toHaveLength(n);
    expect(E.drive.calls.getFiles).toBe(1);
    expect(E.drive.calls.getFilesByName).toBe(0);
    expect(E.drive.calls.getFileById).toBe(0);
    L.itfLegacy_disponibilidad(ids);
    expect(E.drive.calls.getFiles).toBe(1);
  });
  test('un departamento fuera de 01..19 no tiene ITF indexable (igual que el indice existente)', () => {
    entorno([archivo('a', '20-0001.jpg')]);
    expect(L.itfLegacy_disponibilidad(['20-0001', '99-0001'])).toEqual({ '20-0001': 'NO', '99-0001': 'NO' });
    expect(E.drive.calls.getFiles).toBe(0);
  });
  test('si el cache expulsa un departamento justo despues de reconstruir: DESCONOCIDO, nunca "sin archivos"', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const original = L.itfLegacy_reconstruirIndice;
    const cache = CacheService.getScriptCache();
    L.itfLegacy_disponibilidad(['14-0001']);
    cache.remove('itf_leg_v1_14');
    const put = cache.put;
    cache.put = (k, v) => { if (k !== 'itf_leg_v1_14') { put(k, v); } };       // el cache "no guarda" ese bucket
    expect(L.itfLegacy_disponibilidad(['14-0001', '01-0001'])).toEqual({ '14-0001': 'DESCONOCIDO', '01-0001': 'NO' });
    cache.put = put;
    expect(original).toBeDefined();
  });
  test('un bucket corrupto en el cache no se interpreta: DESCONOCIDO', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    CacheService.getScriptCache().put('itf_leg_v1_14', 'esto no es json', 3600);
    for (let d = 1; d <= 19; d += 1) { const k = 'itf_leg_v1_' + String(d).padStart(2, '0'); if (k !== 'itf_leg_v1_14') { CacheService.getScriptCache().put(k, '{"u":[],"a":[],"n":[]}', 3600); } }
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'DESCONOCIDO' });
    CacheService.getScriptCache().put('itf_leg_v1_14', '{"u":"no","a":[],"n":[]}', 3600);
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'DESCONOCIDO' });
  });
  test('el indice vive en su propio espacio de claves (no pisa el itf_idx_ existente)', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    L.itfLegacy_disponibilidad(['14-0001']);
    const cache = CacheService.getScriptCache();
    expect(cache.get('itf_idx_14')).toBeNull();
    expect(JSON.parse(cache.get('itf_leg_v1_14'))).toEqual({ u: ['0001'], a: [], n: [] });
  });
  test('Drive caido al reconstruir: LANZA (no se inventa un "No") y no deja la bandera de reconstruccion', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    E.drive.estado.fallar = 'Drive no responde';
    expect(() => L.itfLegacy_disponibilidad(['14-0001'])).toThrow(/Drive/);
    expect(CacheService.getScriptCache().get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
    E.drive.estado.fallar = null;
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'UNICO' });
  });
});

describe('Q4: reconstruccion single-flight (sin ScriptLock)', () => {
  test('si otra ejecucion esta reconstruyendo, espera y NO recorre la carpeta cuando el indice aparece', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const cache = CacheService.getScriptCache();
    cache.put(L.ITF_LEGACY_REBUILD_FLAG, '1', 60);
    Utilities.sleep.mockImplementation(() => { for (let d = 1; d <= 19; d += 1) { cache.put('itf_leg_v1_' + String(d).padStart(2, '0'), '{"u":["0001"],"a":[],"n":[]}', 3600); } });
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'UNICO' });
    expect(Utilities.sleep).toHaveBeenCalledTimes(1);
    expect(E.drive.calls.getFiles).toBe(0);
  });
  test('una bandera trabada no bloquea para siempre: tras el maximo de esperas reconstruye y la limpia', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    CacheService.getScriptCache().put(L.ITF_LEGACY_REBUILD_FLAG, '1', 60);
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'UNICO' });
    expect(Utilities.sleep).toHaveBeenCalledTimes(L.ITF_LEGACY_ESPERA_MAX);
    expect(E.drive.calls.getFiles).toBe(1);
    expect(CacheService.getScriptCache().get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
  });
  test('sin otra ejecucion: no espera, reconstruye una vez y limpia la bandera', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    L.itfLegacy_disponibilidad(['14-0001']);
    expect(Utilities.sleep).not.toHaveBeenCalled();
    expect(E.drive.calls.getFiles).toBe(1);
    expect(CacheService.getScriptCache().get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
  });
  test('NO usa el ScriptLock: es el lock global de las hojas', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    L.itfLegacy_disponibilidad(['14-0001']);
    expect(E.lock.waitLock).not.toHaveBeenCalled();
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ItfLegacyProvider.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(fuente).not.toMatch(/LockService|waitLock|tryLock/);
  });
});

describe('buscar: UNA llamada a Drive; 0 -> NO, 1 -> UNICO, 2+ -> AMBIGUO (nunca el primero en silencio)', () => {
  test('inexistente', () => {
    entorno([archivo('a', '14-0002.jpg')]);
    expect(L.itfLegacy_buscar('14-0001')).toEqual({ estado: 'NO', cantidad: 0 });
    expect(E.drive.calls.getFilesByName).toBe(1);
  });
  test('un archivo: referencia interna y lector de blob, sin segunda llamada a Drive', () => {
    entorno([archivo('id-uno', '14-0001.jpg', JPEG(300, 9))]);
    const r = L.itfLegacy_buscar('14-0001');
    expect(r).toMatchObject({ estado: 'UNICO', cantidad: 1, fileId: 'id-uno', nombre: '14-0001.jpg' });
    expect(r.leerBlob().getBytes()).toHaveLength(300);
    expect(E.drive.calls.getFilesByName).toBe(1);
    expect(E.drive.calls.getFileById).toBe(0);
  });
  test('dos archivos con el mismo nombre: AMBIGUO y no entrega ninguno', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg')]);
    const r = L.itfLegacy_buscar('14-0001');
    expect(r).toEqual({ estado: 'AMBIGUO', cantidad: 2 });
    expect(r.leerBlob).toBeUndefined();
    expect(r.fileId).toBeUndefined();
  });
  test('un Drive que no distingue mayusculas devuelve <wellId>.JPG: no es descargable (NO_CANONICO), no se lo toma por el canonico', () => {
    entorno([archivo('a', '14-0001.JPG')]);
    E.drive.estado.caseInsensitive = true;
    expect(L.itfLegacy_buscar('14-0001')).toEqual({ estado: 'NO_CANONICO', cantidad: 0 });
  });
  test('un Drive que distingue mayusculas no ve la variante: NO (el indice la clasifica NO_CANONICO, que tampoco es "Si")', () => {
    entorno([archivo('a', '14-0001.JPG')]);
    expect(L.itfLegacy_buscar('14-0001')).toEqual({ estado: 'NO', cantidad: 0 });
    expect(L.itfLegacy_disponibilidad(['14-0001'])['14-0001']).toBe('NO_CANONICO');
  });
  test('canonico + variante en mayuscula (Drive insensible): UNICO, la variante se ignora', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0001.JPG')]);
    E.drive.estado.caseInsensitive = true;
    expect(L.itfLegacy_buscar('14-0001')).toMatchObject({ estado: 'UNICO', fileId: 'a' });
  });
  test('Drive caido: LANZA (un error de Drive nunca es "no existe")', () => {
    entorno([]);
    E.drive.estado.fallar = 'Drive caido';
    expect(() => L.itfLegacy_buscar('14-0001')).toThrow(/Drive caido/);
  });
  test('el indice y la resolucion coinciden en todos los casos de la politica (nunca el indice dice Si y la resolucion no)', () => {
    const casos = [[[], 'NO'], [[archivo('a', '14-0001.jpg')], 'UNICO'], [[archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg')], 'AMBIGUO'], [[archivo('a', '14-0001.JPG')], 'NO_CANONICO']];
    casos.forEach(([archivos, indice]) => {
      entorno(archivos);
      const dis = L.itfLegacy_disponibilidad(['14-0001'])['14-0001'];
      expect(dis).toBe(indice);
      const res = L.itfLegacy_buscar('14-0001').estado;
      if (dis === 'UNICO') { expect(res).toBe('UNICO'); }
    });
  });
});

describe('huella (para ITF_LEGACY_REGISTRADO)', () => {
  test('mime por los bytes reales, bytes, SHA-256 de los bytes reales, id de Drive (interno) y nombre', () => {
    const bytes = JPEG(500, 33);
    entorno([archivo('id-huella-001', '14-0001.jpg', bytes)]);
    const r = L.itfLegacy_huella('14-0001');
    expect(r).toEqual({ ok: true, huella: { mimeType: 'image/jpeg', bytes: 500, sha256: sha256(bytes), storageFileId: 'id-huella-001', nombreOriginal: '14-0001.jpg' } });
    expect(E.mods.dominio.itfDominio_metadataDeCampos(r.huella).ok).toBe(true);
  });
  test('un legacy PNG con extension .jpg se registra como image/png (no se cree el nombre)', () => {
    entorno([archivo('id-png', '14-0001.jpg', PNG(60))]);
    expect(L.itfLegacy_huella('14-0001').huella.mimeType).toBe('image/png');
  });
  test('el hash cambia si cambia un solo byte', () => {
    const a = JPEG(100, 1);
    const b = JPEG(100, 1);
    b[50] = 5;
    entorno([archivo('x', '14-0001.jpg', a)]);
    const h1 = L.itfLegacy_huella('14-0001').huella.sha256;
    entorno([archivo('x', '14-0001.jpg', b)]);
    expect(L.itfLegacy_huella('14-0001').huella.sha256).not.toBe(h1);
  });
  test('no registra lo que no es una imagen valida, lo ambiguo, lo no canonico ni lo inexistente', () => {
    entorno([archivo('a', '14-0001.jpg', Array.from(Buffer.from('%PDF-1.4 xxxx')))]);
    expect(L.itfLegacy_huella('14-0001')).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg')]);
    expect(L.itfLegacy_huella('14-0001')).toMatchObject({ ok: false, code: 'LEGACY_AMBIGUO' });
    entorno([archivo('a', '14-0001.JPG')]);
    E.drive.estado.caseInsensitive = true;
    expect(L.itfLegacy_huella('14-0001')).toMatchObject({ ok: false, code: 'LEGACY_NOMBRE_NO_CANONICO' });
    entorno([]);
    expect(L.itfLegacy_huella('14-0001')).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
  });
  test('un legacy mas grande que el maximo de E9 no se registra', () => {
    entorno([archivo('a', '14-0001.jpg', JPEG(3 * 1024 * 1024 + 1))]);
    expect(L.itfLegacy_huella('14-0001')).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });
  });
  test('se hashea SOLO el pozo pedido (no hay hash por lote)', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0002.jpg'), archivo('c', '14-0003.jpg')]);
    L.itfLegacy_huella('14-0002');
    expect(E.drive.calls.getBlob).toBe(1);
  });
});

describe('verificacion de la huella al restaurar (nunca se restaura en silencio un archivo distinto)', () => {
  const registro = (bytes, id) => ({ storageFileId: id || 'id-reg', sha256: sha256(bytes), bytes: bytes.length });
  test('COINCIDE: el archivo sigue y tiene el mismo contenido', () => {
    const bytes = JPEG(400, 4);
    entorno([archivo('id-reg', '14-0001.jpg', bytes)]);
    expect(L.itfLegacy_verificarHuella(registro(bytes))).toBe('COINCIDE');
  });
  test('CAMBIO: mismo id y mismo tamano pero otro contenido', () => {
    const bytes = JPEG(400, 4);
    const otro = JPEG(400, 4);
    otro[200] = 99;
    entorno([archivo('id-reg', '14-0001.jpg', otro)]);
    expect(L.itfLegacy_verificarHuella(registro(bytes))).toBe('CAMBIO');
  });
  test('CAMBIO: otro tamano', () => {
    entorno([archivo('id-reg', '14-0001.jpg', JPEG(401, 4))]);
    expect(L.itfLegacy_verificarHuella(registro(JPEG(400, 4)))).toBe('CAMBIO');
  });
  test('AUSENTE: el archivo ya no existe, no esta en la carpeta, o el registro no trae huella', () => {
    entorno([]);
    expect(L.itfLegacy_verificarHuella(registro(JPEG(10)))).toBe('AUSENTE');
    entorno([{ id: 'id-reg', name: '14-0001.jpg', bytes: JPEG(10), padre: 'OTRA_CARPETA' }]);
    expect(L.itfLegacy_verificarHuella(registro(JPEG(10)))).toBe('AUSENTE');
    [null, undefined, {}, { storageFileId: 'x' }, { sha256: 'x' }].forEach((r) => expect(L.itfLegacy_verificarHuella(r)).toBe('AUSENTE'));
  });
  test('un error de Drive (no "no existe") se propaga', () => {
    entorno([archivo('id-reg', '14-0001.jpg')]);
    E.drive.estado.fallar = 'Drive caido';
    expect(() => L.itfLegacy_verificarHuella(registro(JPEG(200, 7)))).toThrow(/Drive caido/);
  });
  test('un id de Drive que no esta dentro de la carpeta institucional no se lee (no sirve para leer otros archivos)', () => {
    entorno([{ id: 'secreto', name: 'otra-cosa.jpg', bytes: JPEG(10), padre: 'OTRA_CARPETA' }]);
    expect(E.mods.drive.driveProfileRepository_leerPorId('secreto')).toEqual({ found: false });
  });
  test('leerRegistrado entrega el archivo solo si sigue coincidiendo con la huella', () => {
    const bytes = JPEG(250, 8);
    entorno([archivo('id-reg', '14-0001.jpg', bytes)]);
    const ok = L.itfLegacy_leerRegistrado(registro(bytes));
    expect(ok.found).toBe(true);
    expect(ok.blob.getBytes()).toHaveLength(250);
    entorno([archivo('id-reg', '14-0001.jpg', JPEG(250, 9))]);
    expect(L.itfLegacy_leerRegistrado(registro(bytes))).toEqual({ found: false, code: 'LEGACY_CAMBIO' });
    entorno([]);
    expect(L.itfLegacy_leerRegistrado(registro(bytes))).toEqual({ found: false, code: 'ITF_NOT_FOUND' });
  });
});

describe('repositorio de Drive: coincidencias y lectura por id', () => {
  test('buscarPorNombre devuelve TODAS las coincidencias (getFile se queda con la primera)', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg')]);
    const r = E.mods.drive.driveProfileRepository_buscarPorNombre('14-0001.jpg');
    expect(r.map((x) => x.fileId)).toEqual(['a', 'b']);
    expect(E.mods.drive.driveProfileRepository_getFile('14-0001').found).toBe(true);
  });
  test('leerPorId: archivo dentro de la carpeta; id inexistente -> found:false', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    expect(E.mods.drive.driveProfileRepository_leerPorId('a')).toMatchObject({ found: true, nombre: '14-0001.jpg' });
    expect(E.mods.drive.driveProfileRepository_leerPorId('no-existe')).toEqual({ found: false });
  });
});

describe('single-flight con solicitudes simultaneas', () => {
  const ids = ['14-0001', '14-0002', '14-0003'];
  const esperado = { '14-0001': 'UNICO', '14-0002': 'AMBIGUO', '14-0003': 'NO' };
  const carpeta = () => [archivo('a', '14-0001.jpg'), archivo('b', '14-0002.jpg'), archivo('c', '14-0002.jpg')];

  test('B llega mientras A reconstruye: B espera, NO recorre la carpeta; UNA sola reconstruccion; A, B y C reciben el mismo resultado', () => {
    entorno(carpeta());
    const cache = CacheService.getScriptCache();
    cache.put(L.ITF_LEGACY_REBUILD_FLAG, '1', 60);                                       // A esta reconstruyendo
    Utilities.sleep.mockImplementationOnce(() => { const buckets = L.itfLegacy_reconstruirIndice(); cache.remove(L.ITF_LEGACY_REBUILD_FLAG); expect(buckets['14'].u).toEqual(['0001']); });   // A termina mientras B espera
    const b = L.itfLegacy_disponibilidad(ids);
    const c = L.itfLegacy_disponibilidad(ids);
    expect(E.drive.calls.getFiles).toBe(1);                                              // la reconstruccion de A: B y C no recorrieron nada
    expect(Utilities.sleep).toHaveBeenCalledTimes(1);
    expect(b).toEqual(esperado);
    expect(c).toEqual(b);
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
  });
  test('A falla a mitad de la reconstruccion: libera la bandera; un B que esperaba reconstruye y funciona (no queda nada colgado)', () => {
    entorno(carpeta());
    const cache = CacheService.getScriptCache();
    E.drive.estado.fallar = 'Drive caido';
    expect(() => L.itfLegacy_disponibilidad(ids)).toThrow(/Drive caido/);                // A
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
    E.drive.estado.fallar = null;
    cache.put(L.ITF_LEGACY_REBUILD_FLAG, '1', 60);                                       // otra ejecucion A2 esta reconstruyendo y se cae: su bandera se libera
    Utilities.sleep.mockImplementationOnce(() => { cache.remove(L.ITF_LEGACY_REBUILD_FLAG); });
    expect(L.itfLegacy_disponibilidad(ids)).toEqual(esperado);                           // B: ve la bandera libre sin indice -> reconstruye
    expect(E.drive.calls.getFiles).toBe(2);                                              // 1 que fallo + 1 que sirvio
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
  });
  test('retry posterior despues de un error: funciona y deja el indice sano', () => {
    entorno(carpeta());
    E.drive.estado.fallar = 'Drive caido';
    expect(() => L.itfLegacy_disponibilidad(ids)).toThrow();
    expect(() => L.itfLegacy_disponibilidad(ids)).toThrow();
    E.drive.estado.fallar = null;
    expect(L.itfLegacy_disponibilidad(ids)).toEqual(esperado);
    expect(L.itfLegacy_disponibilidad(ids)).toEqual(esperado);
    expect(E.drive.calls.getFiles).toBe(3);                                              // 2 fallidos + 1 exitoso; el cuarto salio del indice
  });
  test('no hay promesas ni locks colgados: ninguna bandera ni lock queda tras exito, error o espera agotada', () => {
    entorno(carpeta());
    const cache = CacheService.getScriptCache();
    L.itfLegacy_disponibilidad(ids);
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
    cache.put(L.ITF_LEGACY_REBUILD_FLAG, '1', 60);
    for (let d = 1; d <= 19; d += 1) { cache.remove('itf_leg_v1_' + String(d).padStart(2, '0')); }
    L.itfLegacy_disponibilidad(ids);                                                     // bandera trabada: agota las esperas y reconstruye
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
    expect(E.lock.waitLock).not.toHaveBeenCalled();
  });
});

describe('nombres invalidos y archivos fuera de la carpeta', () => {
  test('nombres que NO son un ITF legacy se ignoran, nunca rompen ni cuentan', () => {
    entorno([]);
    const nombres = ['14-0001.jpg.bak', '14-0001.jpgx', ' 14-0001.jpg', '14-0001 .jpg', '014-0001.jpg', '14-0001.jpeg', '14-0001.png', '14-0001', '14_0001.jpg', 'x14-0001.jpg', '1-0001.jpg', '14-00001.jpg', '14-0001.jpg.', '.jpg', ''];
    expect(L.itfLegacy_clasificarNombres(nombres)).toEqual({});
    entorno(nombres.map((n, i) => archivo('id-' + i + '-xxxxxx', n)));
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'NO' });
  });
  test('un archivo con el nombre correcto pero en OTRA carpeta no cuenta (ni en el indice ni al resolver)', () => {
    entorno([{ id: 'fuera-0001-xxxx', name: '14-0001.jpg', bytes: JPEG(100), padre: 'OTRA_CARPETA' }]);
    expect(L.itfLegacy_buscar('14-0001')).toEqual({ estado: 'NO', cantidad: 0 });
    expect(L.itfLegacy_disponibilidad(['14-0001'])).toEqual({ '14-0001': 'NO' });
  });
  test('una lectura por id de un archivo que ya no existe es AUSENTE, no un error ni un falso OK', () => {
    entorno([]);
    expect(L.itfLegacy_verificarHuella({ storageFileId: 'id-que-no-existe', sha256: 'a'.repeat(64), bytes: 10 })).toBe('AUSENTE');
    expect(L.itfLegacy_leerRegistrado({ storageFileId: 'id-que-no-existe', sha256: 'a'.repeat(64) })).toEqual({ found: false, code: 'ITF_NOT_FOUND' });
  });
  test('0 coincidencias -> NO; 1 -> UNICO; 2 -> AMBIGUO; .jpg -> canonico; .JPG -> no canonico (la matriz completa de la politica)', () => {
    const matriz = [
      [[], 'NO'],
      [[archivo('a', '14-0001.jpg')], 'UNICO'],
      [[archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg')], 'AMBIGUO'],
      [[archivo('a', '14-0001.jpg'), archivo('b', '14-0001.jpg'), archivo('c', '14-0001.jpg')], 'AMBIGUO'],
      [[archivo('a', '14-0001.JPG')], 'NO_CANONICO'],
      [[archivo('a', '14-0001.Jpg'), archivo('b', '14-0001.JPG')], 'NO_CANONICO'],
      [[archivo('a', '14-0001.jpg'), archivo('b', '14-0001.JPG')], 'UNICO']
    ];
    matriz.forEach(([archivos, estado]) => {
      entorno(archivos);
      expect(L.itfLegacy_disponibilidad(['14-0001'])['14-0001']).toBe(estado);
    });
  });
});

describe('single-flight: la bandera se pone mientras se reconstruye y se limpia siempre', () => {
  test('durante el recorrido de la carpeta la bandera esta puesta (otra ejecucion la veria); despues no', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const cache = CacheService.getScriptCache();
    const original = global.driveProfileRepository_listarArchivosThumb;
    let durante = null;
    global.driveProfileRepository_listarArchivosThumb = () => { durante = cache.get(L.ITF_LEGACY_REBUILD_FLAG); return original(); };
    L.itfLegacy_disponibilidad(['14-0001']);
    global.driveProfileRepository_listarArchivosThumb = original;
    expect(durante).toBe('1');
    expect(cache.get(L.ITF_LEGACY_REBUILD_FLAG)).toBeNull();
  });
  test('la bandera vence sola (TTL corto): una ejecucion muerta no bloquea a nadie para siempre', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const cache = CacheService.getScriptCache();
    const put = jest.spyOn(cache, 'put');
    L.itfLegacy_disponibilidad(['14-0001']);
    const llamada = put.mock.calls.find((c) => c[0] === L.ITF_LEGACY_REBUILD_FLAG);
    expect(llamada[2]).toBe(60);
    put.mockRestore();
  });
});
