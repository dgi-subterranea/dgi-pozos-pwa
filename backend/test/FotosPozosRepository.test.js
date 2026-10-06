const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const Repo = require('../src/FotosPozosRepository');

const COLS = Repo.FOTOS_POZOS_COLUMNAS;

function foto(extra) {
  return Object.assign({
    fotoId: '11111111-1111-4111-8111-111111111111', timestampRegistro: new Date('2026-10-06T12:00:00Z'),
    wellId: '04-0263', monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
    fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'USUARIO', observacion: 'Boca del pozo',
    estadoVinculo: 'CONFIRMADO', vinculoMetodo: 'CAMPO_APP', gpsLat: -33.1, gpsLon: -68.5, gpsOrigen: 'DISPOSITIVO_CARGA',
    emailUsuarioCarga: 'a@x.com', loteImportacion: '', sha1Original: '', procesamiento: 'NAVEGADOR',
    mimeType: 'image/jpeg', tamanoBytes: 300000, ancho: 1600, alto: 1200, tamanoOriginalBytes: 4000000,
    driveFileId: 'DRIVE_FILE_ID_0001', driveThumbId: 'DRIVE_THUMB_ID_0001', estado: 'ACTIVA'
  }, extra || {});
}

function filaDe(f) {
  return COLS.map((c) => (f[c] === null || f[c] === undefined ? '' : f[c]));
}

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
});

describe('schema de las hojas', () => {
  test('FotosPozos: encabezado exacto, en el orden aprobado (27 columnas)', () => {
    expect(COLS).toEqual([
      'fotoId', 'timestampRegistro', 'wellId', 'monitoringId', 'fuente', 'tipoFoto',
      'fechaFotoValor', 'fechaFotoPrecision', 'fechaFotoFuente', 'observacion',
      'estadoVinculo', 'vinculoMetodo', 'gpsLat', 'gpsLon', 'gpsOrigen',
      'emailUsuarioCarga', 'loteImportacion', 'sha1Original', 'procesamiento',
      'mimeType', 'tamanoBytes', 'ancho', 'alto', 'tamanoOriginalBytes',
      'driveFileId', 'driveThumbId', 'estado'
    ]);
    expect(COLS).toHaveLength(27);
  });

  test('FotosPozosCambios: timestamp, fotoId, campo, valorAnterior, valorNuevo, email', () => {
    expect(Repo.FOTOS_POZOS_CAMBIOS_COLUMNAS).toEqual(['timestamp', 'fotoId', 'campo', 'valorAnterior', 'valorNuevo', 'email']);
  });

  test('ninguna columna guarda base64, URL, nombre original ni ruta', () => {
    COLS.forEach((c) => expect(c.toLowerCase()).not.toMatch(/base64|url|nombrearchivo|ruta|titular|path/));
  });

  test('columnas por texto: tolera orden, mayusculas y espacios; informa las faltantes', () => {
    const idx = Repo.fotosPozosRepository_indiceColumnas([' ESTADO', 'fotoId'].concat(COLS.slice(1, -1).filter((c) => c !== 'fotoId')));
    expect(idx.estado).toBe(0);
    expect(idx.fotoId).toBe(1);
    expect(Repo.fotosPozosRepository_columnasFaltantes(idx)).toEqual([]);
    expect(Repo.fotosPozosRepository_columnasFaltantes(Repo.fotosPozosRepository_indiceColumnas(['fotoId']))).toHaveLength(26);
  });
});

describe('ida y vuelta fila <-> foto', () => {
  const idx = Repo.fotosPozosRepository_indiceColumnas(COLS);

  test('conserva tipos: coordenadas y tamanos numericos, fecha parcial como texto', () => {
    const f = foto({ fechaFotoValor: '2025', fechaFotoPrecision: 'ANIO' });
    const fila = Repo.fotosPozosRepository_filaDesdeFoto(f, idx, COLS.length);
    const vuelta = Repo.fotosPozosRepository_fotoDesdeFila(fila, idx);
    expect(vuelta).toEqual({ ...f, timestampRegistro: '2026-10-06T12:00:00.000Z' });
    expect(typeof vuelta.gpsLat).toBe('number');
    expect(vuelta.fechaFotoValor).toBe('2025');
  });

  test('sin GPS y sin tamano original: null (no cero, no texto)', () => {
    const f = foto({ gpsLat: null, gpsLon: null, gpsOrigen: '', tamanoOriginalBytes: '' });
    const v = Repo.fotosPozosRepository_fotoDesdeFila(Repo.fotosPozosRepository_filaDesdeFoto(f, idx, COLS.length), idx);
    expect([v.gpsLat, v.gpsLon, v.tamanoOriginalBytes]).toEqual([null, null, null]);
  });

  test('una fecha parcial que Sheets convirtio en numero o en Date se normaliza a texto', () => {
    expect(Repo.fotosPozosRepository_textoFecha(2025)).toBe('2025');
    expect(Repo.fotosPozosRepository_textoFecha(new Date(2026, 5, 14))).toBe('2026-06-14');
    expect(Repo.fotosPozosRepository_textoFecha('  2025-06 ')).toBe('2025-06');
    expect(Repo.fotosPozosRepository_textoFecha(null)).toBe('');
  });

  test('la fila no contiene base64 ni URL', () => {
    const fila = Repo.fotosPozosRepository_filaDesdeFoto(foto(), idx, COLS.length);
    expect(fila.join('|')).not.toMatch(/base64|https?:/);
  });
});

describe('visibilidad y pertenencia', () => {
  test('solo ACTIVA + CONFIRMADO es visible', () => {
    expect(Repo.fotosPozosRepository_esVisible(foto())).toBe(true);
    expect(Repo.fotosPozosRepository_esVisible(foto({ estado: 'OCULTA' }))).toBe(false);
    expect(Repo.fotosPozosRepository_esVisible(foto({ estadoVinculo: 'POR_REVISAR' }))).toBe(false);
    expect(Repo.fotosPozosRepository_esVisible(foto({ estado: '' }))).toBe(false);
  });

  test('pertenece por wellId o por monitoringId (el informado), nunca cruzado', () => {
    const pozo = foto();
    const especial = foto({ wellId: '', monitoringId: 'INA 2055' });
    expect(Repo.fotosPozosRepository_perteneceAEntidad(pozo, { wellId: '04-0263', monitoringId: '' })).toBe(true);
    expect(Repo.fotosPozosRepository_perteneceAEntidad(pozo, { wellId: '04-0264', monitoringId: '' })).toBe(false);
    expect(Repo.fotosPozosRepository_perteneceAEntidad(especial, { wellId: '', monitoringId: 'INA 2055' })).toBe(true);
    expect(Repo.fotosPozosRepository_perteneceAEntidad(especial, { wellId: '04-0263', monitoringId: '' })).toBe(false);
    expect(Repo.fotosPozosRepository_perteneceAEntidad(pozo, { wellId: '', monitoringId: '' })).toBe(false);
  });
});

describe('lecturas sobre la hoja (SpreadsheetApp en memoria)', () => {
  function hojaCon(fotos) {
    return instalarSheetsFalsos({ FotosPozos: [COLS].concat(fotos.map(filaDe)) });
  }

  test('listarVisiblesPorEntidad: solo la entidad pedida, solo visibles', () => {
    hojaCon([
      foto({ fotoId: 'f1' }),
      foto({ fotoId: 'f2', estado: 'OCULTA' }),
      foto({ fotoId: 'f3', estadoVinculo: 'POR_REVISAR' }),
      foto({ fotoId: 'f4', wellId: '05-0001' }),
      foto({ fotoId: 'f5', wellId: '', monitoringId: 'INA 2055' })
    ]);
    expect(Repo.fotosPozosRepository_listarVisiblesPorEntidad({ wellId: '04-0263', monitoringId: '' }).map((f) => f.fotoId)).toEqual(['f1']);
    expect(Repo.fotosPozosRepository_listarVisiblesPorEntidad({ wellId: '', monitoringId: 'INA 2055' }).map((f) => f.fotoId)).toEqual(['f5']);
    expect(Repo.fotosPozosRepository_listarVisiblesPorEntidad({ wellId: '09-0009', monitoringId: '' })).toEqual([]);
  });

  test('buscarVisiblePorFotoId: oculta o sin confirmar no se encuentra', () => {
    hojaCon([foto({ fotoId: 'ok' }), foto({ fotoId: 'oculta', estado: 'OCULTA' }), foto({ fotoId: 'sinconf', estadoVinculo: 'POR_REVISAR' })]);
    expect(Repo.fotosPozosRepository_buscarVisiblePorFotoId('ok').fotoId).toBe('ok');
    expect(Repo.fotosPozosRepository_buscarVisiblePorFotoId('oculta')).toBeNull();
    expect(Repo.fotosPozosRepository_buscarVisiblePorFotoId('sinconf')).toBeNull();
    expect(Repo.fotosPozosRepository_buscarVisiblePorFotoId('noexiste')).toBeNull();
  });

  test('contarVisiblesPorEntidad: por wellId o monitoringId, solo claves con fotos visibles', () => {
    hojaCon([
      foto({ fotoId: 'a' }), foto({ fotoId: 'b' }), foto({ fotoId: 'c', estado: 'OCULTA' }),
      foto({ fotoId: 'd', wellId: '', monitoringId: 'INA 2055' }), foto({ fotoId: 'e', wellId: '06-0001', estado: 'OCULTA' })
    ]);
    expect(Repo.fotosPozosRepository_contarVisiblesPorEntidad()).toEqual({ '04-0263': 2, 'INA 2055': 1 });
  });

  test('filas vacias a mitad de la hoja se ignoran', () => {
    const h = hojaCon([foto({ fotoId: 'a' })]);
    h.FotosPozos.filas.push(COLS.map(() => ''));
    h.FotosPozos.filas.push(filaDe(foto({ fotoId: 'b' })));
    expect(Repo.fotosPozosRepository_contarVisiblesPorEntidad()).toEqual({ '04-0263': 2 });
  });

  test('hoja inexistente o sin columnas: error claro (fail-closed)', () => {
    instalarSheetsFalsos({});
    expect(() => Repo.fotosPozosRepository_contarVisiblesPorEntidad()).toThrow(/setupFotosPozosSheet/);
    instalarSheetsFalsos({ FotosPozos: [['fotoId', 'estado']] });
    expect(() => Repo.fotosPozosRepository_contarVisiblesPorEntidad()).toThrow(/no tiene las columnas/);
  });
});

describe('agregarSinDuplicar', () => {
  test('agrega una fila con formatos: texto para ids/fechas, numerico para tamanos, coordenadas con 6 decimales', () => {
    const h = instalarSheetsFalsos({ FotosPozos: [COLS] });
    const r = Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fechaFotoValor: '2025', fechaFotoPrecision: 'ANIO' }));
    expect(r).toEqual({ agregada: true });
    expect(h.FotosPozos.filas).toHaveLength(2);
    const col = (n) => COLS.indexOf(n) + 1;
    expect(h.FotosPozos.formatos['2:' + col('fechaFotoValor')]).toBe('@');
    expect(h.FotosPozos.formatos['2:' + col('wellId')]).toBe('@');
    expect(h.FotosPozos.formatos['2:' + col('timestampRegistro')]).toBe('yyyy-mm-dd hh:mm:ss');
    expect(h.FotosPozos.formatos['2:' + col('tamanoBytes')]).toBe('0');
    expect(h.FotosPozos.formatos['2:' + col('gpsLat')]).toBe('0.000000');
    expect(h.FotosPozos.filas[1][COLS.indexOf('fechaFotoValor')]).toBe('2025');
  });

  test('sha1Original repetido para la MISMA entidad: no agrega, devuelve la existente', () => {
    const sha = 'a'.repeat(40);
    const h = instalarSheetsFalsos({ FotosPozos: [COLS, filaDe(foto({ fotoId: 'previa', sha1Original: sha }))] });
    const r = Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fotoId: 'nueva', sha1Original: sha }));
    expect(r.agregada).toBe(false);
    expect(r.existente.fotoId).toBe('previa');
    expect(h.FotosPozos.filas).toHaveLength(2);
  });

  test('el mismo sha1 en OTRA entidad no es duplicado; sin sha1 nunca hay duplicado', () => {
    const sha = 'b'.repeat(40);
    const h = instalarSheetsFalsos({ FotosPozos: [COLS, filaDe(foto({ fotoId: 'previa', sha1Original: sha }))] });
    expect(Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fotoId: 'otro', wellId: '05-0001', sha1Original: sha })).agregada).toBe(true);
    expect(Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fotoId: 'x1', sha1Original: '' })).agregada).toBe(true);
    expect(Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fotoId: 'x2', sha1Original: '' })).agregada).toBe(true);
    expect(h.FotosPozos.filas).toHaveLength(5);
  });

  test('una foto OCULTA con ese sha1 no cuenta como duplicado (se puede volver a subir)', () => {
    const sha = 'c'.repeat(40);
    instalarSheetsFalsos({ FotosPozos: [COLS, filaDe(foto({ fotoId: 'previa', sha1Original: sha, estado: 'OCULTA' }))] });
    expect(Repo.fotosPozosRepository_agregarSinDuplicar(foto({ fotoId: 'nueva', sha1Original: sha })).agregada).toBe(true);
  });

  test('buscarDuplicado: lectura sin escribir', () => {
    const sha = 'd'.repeat(40);
    const h = instalarSheetsFalsos({ FotosPozos: [COLS, filaDe(foto({ fotoId: 'previa', sha1Original: sha }))] });
    expect(Repo.fotosPozosRepository_buscarDuplicado({ wellId: '04-0263', monitoringId: '' }, sha).fotoId).toBe('previa');
    expect(Repo.fotosPozosRepository_buscarDuplicado({ wellId: '04-0263', monitoringId: '' }, '')).toBeNull();
    expect(Repo.fotosPozosRepository_buscarDuplicado({ wellId: '05-0001', monitoringId: '' }, sha)).toBeNull();
    expect(h.FotosPozos.filas).toHaveLength(2);
  });
});

describe('FotosPozosCambios (auditoria de correcciones)', () => {
  test('registrar agrega quien/cuando/campo/anterior/nuevo', () => {
    const h = instalarSheetsFalsos({ FotosPozosCambios: [Repo.FOTOS_POZOS_CAMBIOS_COLUMNAS] });
    Repo.fotosPozosCambiosRepository_registrar({ fotoId: 'f1', campo: 'observacion', valorAnterior: 'a', valorNuevo: 'b', email: 'admin@x.com' });
    const fila = h.FotosPozosCambios.filas[1];
    expect(fila[1]).toBe('f1');
    expect(fila.slice(2)).toEqual(['observacion', 'a', 'b', 'admin@x.com']);
    expect(fila[0] instanceof Date).toBe(true);
  });

  test('sin la hoja: error claro que apunta al setup', () => {
    instalarSheetsFalsos({});
    expect(() => Repo.fotosPozosCambiosRepository_registrar({ fotoId: 'f' })).toThrow(/setupFotosPozosCambiosSheet/);
  });
});

describe('setup idempotente (no se ejecuta en produccion: aca corre sobre hojas en memoria)', () => {
  test('crea FotosPozos con el encabezado exacto y la fila congelada; una segunda corrida no hace nada', () => {
    const h = instalarSheetsFalsos({});
    Repo.setupFotosPozosSheet();
    expect(h.FotosPozos.filas).toEqual([COLS]);
    expect(h.FotosPozos.congeladas).toBe(1);
    Repo.setupFotosPozosSheet();
    expect(h.FotosPozos.filas).toEqual([COLS]);
    expect(global.Logger.log).toHaveBeenLastCalledWith(expect.stringMatching(/ya existe con su encabezado/));
  });

  test('crea FotosPozosCambios', () => {
    const h = instalarSheetsFalsos({});
    Repo.setupFotosPozosCambiosSheet();
    expect(h.FotosPozosCambios.filas).toEqual([Repo.FOTOS_POZOS_CAMBIOS_COLUMNAS]);
  });

  test('si la hoja existe con datos o con otro encabezado, NO la toca (nunca pisa datos) y avisa', () => {
    const datos = [['otra', 'cosa'], ['x', 'y']];
    const h = instalarSheetsFalsos({ FotosPozos: datos });
    Repo.setupFotosPozosSheet();
    expect(h.FotosPozos.filas).toEqual(datos);
    expect(global.Logger.log).toHaveBeenLastCalledWith(expect.stringMatching(/le faltan columnas/));
  });

  test('si la hoja ya tiene datos y el encabezado completo, conserva las filas', () => {
    const h = instalarSheetsFalsos({ FotosPozos: [COLS, filaDe(foto())] });
    Repo.setupFotosPozosSheet();
    expect(h.FotosPozos.filas).toHaveLength(2);
  });

  test('setupFotosPozos crea las dos hojas y es repetible', () => {
    const h = instalarSheetsFalsos({});
    Repo.setupFotosPozos();
    Repo.setupFotosPozos();
    expect(Object.keys(h).sort()).toEqual(['FotosPozos', 'FotosPozosCambios']);
  });

  test('no toca otras hojas (Usuarios, FotosReemplazo...)', () => {
    const h = instalarSheetsFalsos({ Usuarios: [['email']], FotosReemplazo: [['timestamp']] });
    Repo.setupFotosPozos();
    expect(h.Usuarios.filas).toEqual([['email']]);
    expect(h.FotosReemplazo.filas).toEqual([['timestamp']]);
  });
});
