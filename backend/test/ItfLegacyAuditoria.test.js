const A = require('../src/ItfLegacyAuditoria');
const L = require('../src/ItfLegacyProvider');

const KB = 1024;
const MB = 1024 * 1024;
const f = (nombre, bytes) => ({ nombre, bytes: bytes === undefined ? 100 * KB : bytes });

describe('ItfLegacyAuditoria: analisis puro de la carpeta', () => {
  test('carpeta vacia: todo en cero y estadisticas nulas, sin romper', () => {
    const r = A.itfAuditoria_analizar([]);
    expect(r).toMatchObject({ totalArchivos: 0, canonicos: 0, variantesExtension: 0, noCoinciden: 0, sinPozoValido: 0, duplicadosCanonicos: 0, pozosConMasDeUnCandidato: 0, incompleto: false });
    expect(r.pozosPorEstado).toEqual({ UNICO: 0, AMBIGUO: 0, NO_CANONICO: 0 });
    expect(r.tamanos).toMatchObject({ cantidad: 0, minBytes: null, medianaBytes: null, p95Bytes: null, p99Bytes: null, maxBytes: null, totalBytes: 0, sobreElLimite: 0 });
    expect(A.itfAuditoria_analizar(undefined).totalArchivos).toBe(0);
  });

  test('cuenta canonicos, variantes de extension, nombres que no coinciden y pozos sin departamento valido', () => {
    const r = A.itfAuditoria_analizar([
      f('01-0001.jpg'), f('01-0002.jpg'), f('14-0003.JPG'), f('14-0004.Jpg'),
      f('foto.jpg'), f('14-0005.png'), f('14-0005.jpeg'), f('14-0006.jpg.bak'), f('Thumbs.db'),
      f('20-0001.jpg'), f('00-0001.jpg'), f('14-0000.jpg')
    ]);
    expect(r.totalArchivos).toBe(12);
    expect(r.canonicos).toBe(2);
    expect(r.variantesExtension).toBe(2);
    expect(r.variantesDetalle).toEqual({ '.JPG': 1, '.Jpg': 1 });
    expect(r.noCoinciden).toBe(5);
    expect(r.sinPozoValido).toBe(3);
    expect(r.pozosPorEstado).toEqual({ UNICO: 2, AMBIGUO: 0, NO_CANONICO: 2 });
  });

  test('duplicados canonicos: el pozo cuenta como AMBIGUO y se informan los archivos sobrantes', () => {
    const r = A.itfAuditoria_analizar([f('05-0100.jpg'), f('05-0100.jpg'), f('05-0100.jpg'), f('05-0101.jpg'), f('05-0102.jpg'), f('05-0102.jpg')]);
    expect(r.duplicadosCanonicos).toBe(2);
    expect(r.archivosCanonicosSobrantes).toBe(3);
    expect(r.pozosPorEstado).toEqual({ UNICO: 1, AMBIGUO: 2, NO_CANONICO: 0 });
    expect(r.ejemplos.duplicadosCanonicos).toEqual(['05-0100', '05-0102']);
  });

  test('pozos con mas de un candidato: incluye canonico + variante y dos variantes, no un archivo solo', () => {
    const r = A.itfAuditoria_analizar([f('02-0001.jpg'), f('02-0001.JPG'), f('02-0002.JPG'), f('02-0002.Jpg'), f('02-0003.jpg'), f('02-0004.JPG')]);
    expect(r.pozosConMasDeUnCandidato).toBe(2);
    expect(r.ejemplos.pozosConMasDeUnCandidato).toEqual(['02-0001', '02-0002']);
    expect(r.pozosPorEstado).toEqual({ UNICO: 2, AMBIGUO: 0, NO_CANONICO: 2 });        // 02-0001 tiene UN canonico: UNICO (la variante convive); 02-0002 solo variantes
  });

  test('los ejemplos estan acotados y no incluyen ids ni contenido', () => {
    const muchos = [];
    for (let i = 0; i < 40; i += 1) { muchos.push(f('basura-' + i + '.txt')); }
    const r = A.itfAuditoria_analizar(muchos);
    expect(r.noCoinciden).toBe(40);
    expect(r.ejemplos.noCoinciden).toHaveLength(A.ITF_AUDITORIA_EJEMPLOS);
    expect(Object.keys(r)).not.toEqual(expect.arrayContaining(['ids', 'fileIds', 'urls']));
    expect(JSON.stringify(r)).not.toMatch(/drive\.google|fileId|https?:/i);
  });

  test('tamanos: minimo, mediana, percentiles, maximo, total y archivos sobre 3 MB', () => {
    const bytes = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((n) => n * KB);
    const archivos = bytes.map((b, i) => f('03-' + String(i + 1).padStart(4, '0') + '.jpg', b));
    archivos.push(f('03-0050.jpg', 4 * MB));
    const r = A.itfAuditoria_analizar(archivos).tamanos;
    expect(r.cantidad).toBe(11);
    expect(r.minBytes).toBe(10 * KB);
    expect(r.maxBytes).toBe(4 * MB);
    expect(r.medianaBytes).toBe(60 * KB);
    expect(r.p95Bytes).toBe(4 * MB);
    expect(r.p99Bytes).toBe(4 * MB);
    expect(r.totalBytes).toBe(bytes.reduce((a, b) => a + b, 0) + 4 * MB);
    expect(r.sobreElLimite).toBe(1);
  });

  test('un archivo de exactamente 3 MB NO esta sobre el limite (el tope es inclusivo)', () => {
    const r = A.itfAuditoria_analizar([f('03-0001.jpg', 3 * MB), f('03-0002.jpg', 3 * MB + 1)]).tamanos;
    expect(r.sobreElLimite).toBe(1);
  });

  test('distribucion por tramos: cada archivo cae en un solo tramo y la suma da la cantidad con tamano', () => {
    const r = A.itfAuditoria_analizar([
      f('04-0001.jpg', 10 * KB), f('04-0002.jpg', 50 * KB), f('04-0003.jpg', 99 * KB), f('04-0004.jpg', 100 * KB), f('04-0005.jpg', 400 * KB),
      f('04-0006.jpg', 900 * KB), f('04-0007.jpg', 2 * MB), f('04-0008.jpg', 5 * MB)
    ]).tamanos.distribucion;
    expect(r.map((t) => t.cantidad)).toEqual([1, 2, 1, 1, 1, 1, 1]);
    expect(r.map((t) => t.tramo)[0]).toBe('< 50 KB');
    expect(r.reduce((a, t) => a + t.cantidad, 0)).toBe(8);
  });

  test('archivos sin tamano se cuentan aparte y no falsean el minimo ni el total', () => {
    const r = A.itfAuditoria_analizar([f('06-0001.jpg', 200 * KB), { nombre: '06-0002.jpg' }, { nombre: '06-0003.jpg', bytes: null }, { nombre: '06-0004.jpg', bytes: 'x' }]).tamanos;
    expect(r.cantidad).toBe(1);
    expect(r.sinTamano).toBe(3);
    expect(r.minBytes).toBe(200 * KB);
    expect(r.totalBytes).toBe(200 * KB);
  });

  test('lectura incompleta: el informe lo declara y no la presenta como total', () => {
    expect(A.itfAuditoria_analizar([f('01-0001.jpg')], { incompleto: true }).incompleto).toBe(true);
    expect(A.itfAuditoria_analizar([f('01-0001.jpg')]).incompleto).toBe(false);
  });

  test('COHERENCIA con el proveedor legacy: el estado por pozo coincide con itfLegacy_estadoDe en todos los casos', () => {
    const nombres = [
      '01-0001.jpg', '01-0002.jpg', '01-0002.jpg', '01-0003.JPG', '01-0004.jpg', '01-0004.JPG', '01-0005.Jpg', '01-0005.jPG', '07-0010.jpg', '19-9999.JPG'
    ];
    const r = A.itfAuditoria_analizar(nombres.map((n) => f(n)));
    const porPozo = L.itfLegacy_clasificarNombres(nombres);
    const cuenta = { UNICO: 0, AMBIGUO: 0, NO_CANONICO: 0 };
    Object.keys(porPozo).forEach((w) => { cuenta[L.itfLegacy_estadoDe(porPozo[w])] += 1; });
    expect(r.pozosPorEstado).toEqual(cuenta);
  });

  test('pozo valido: departamentos 01..19 y numero distinto de 0000', () => {
    expect(A.itfAuditoria_pozoValido('01', '0001')).toBe(true);
    expect(A.itfAuditoria_pozoValido('19', '9999')).toBe(true);
    expect(A.itfAuditoria_pozoValido('00', '0001')).toBe(false);
    expect(A.itfAuditoria_pozoValido('20', '0001')).toBe(false);
    expect(A.itfAuditoria_pozoValido('14', '0000')).toBe(false);
  });

  test('percentil: lista vacia -> null; un elemento -> ese elemento', () => {
    expect(A.itfAuditoria_percentil([], 0.5)).toBeNull();
    expect(A.itfAuditoria_percentil([7], 0.99)).toBe(7);
    expect(A.itfAuditoria_percentil([1, 2, 3, 4], 0.5)).toBe(2);
  });
});

describe('auditarCarpetaItfLegacy: entrada de Apps Script, SOLO LECTURA', () => {
  function instalar(archivos, relojes) {
    const llamadas = [];
    let i = 0;
    const iterador = { hasNext: () => i < archivos.length, next: () => { const a = archivos[i]; i += 1; return { getName: () => a.name, getSize: () => a.size, setTrashed: () => llamadas.push('setTrashed'), setName: () => llamadas.push('setName'), getBlob: () => llamadas.push('getBlob') }; } };
    global.getFolderId = () => 'CARPETA';
    global.DriveApp = { getFolderById: (id) => { llamadas.push('getFolderById:' + id); return { getFiles: () => iterador, createFile: () => llamadas.push('createFile'), addFile: () => llamadas.push('addFile') }; } };
    global.Logger = { log: jest.fn() };
    if (relojes) {
      const reloj = relojes.slice();
      jest.spyOn(Date.prototype, 'getTime').mockImplementation(() => (reloj.length > 1 ? reloj.shift() : reloj[0]));
    }
    return llamadas;
  }
  afterEach(() => { jest.restoreAllMocks(); delete global.getFolderId; delete global.DriveApp; delete global.Logger; });

  test('lee nombres y tamanos, devuelve el informe y lo deja en el Logger; no abre ni modifica ningun archivo', () => {
    const llamadas = instalar([{ name: '01-0001.jpg', size: 120 * KB }, { name: '01-0001.JPG', size: 80 * KB }, { name: 'x.txt', size: 1 }]);
    const r = A.auditarCarpetaItfLegacy();
    expect(r).toMatchObject({ totalArchivos: 3, canonicos: 1, variantesExtension: 1, noCoinciden: 1, incompleto: false });
    expect(typeof r.duracionMs).toBe('number');
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    expect(llamadas).toEqual(['getFolderById:CARPETA']);
  });

  test('se corta por tiempo y lo declara como incompleto', () => {
    instalar([{ name: '01-0001.jpg', size: 1 }, { name: '01-0002.jpg', size: 1 }, { name: '01-0003.jpg', size: 1 }], [1000, 1000, 1000 + A.ITF_AUDITORIA_MAX_MS + 1, 1000 + A.ITF_AUDITORIA_MAX_MS + 1]);
    const r = A.auditarCarpetaItfLegacy();
    expect(r.incompleto).toBe(true);
    expect(r.totalArchivos).toBeLessThan(3);
  });

  test('si Drive falla, el error sale tal cual (no se devuelve un informe en cero)', () => {
    global.getFolderId = () => 'CARPETA';
    global.DriveApp = { getFolderById: () => { throw new Error('Drive caido'); } };
    global.Logger = { log: jest.fn() };
    expect(() => A.auditarCarpetaItfLegacy()).toThrow('Drive caido');
    expect(global.Logger.log).not.toHaveBeenCalled();
  });

  test('el archivo fuente solo usa operaciones de lectura de Drive (contrato)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, '../src/ItfLegacyAuditoria.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(src).not.toMatch(/setTrashed|setName|createFile|addFile|makeCopy|moveTo|setSharing|setContent|removeFile|Drive\.Files|SpreadsheetApp|PropertiesService|CacheService|UrlFetchApp|MailApp/);
    expect(src).toMatch(/getFiles\(\)/);
  });
});
