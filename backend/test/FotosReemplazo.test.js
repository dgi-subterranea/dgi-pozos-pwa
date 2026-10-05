const crypto = require('crypto');
const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();
global.Logger = { log: jest.fn() };

const Repo = require('../src/FotosReemplazoRepository');
const Client = require('../src/FotosStorageClient');
const Service = require('../src/FotosReemplazoService');

const SECRET = 's'.repeat(40);
const EVAL_ID = '22222222-2222-4222-8222-222222222222';
const WELL = '04-0263';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto')]).toString('base64');
const THUMB = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('min')]).toString('base64');

function datos(extra) {
  return Object.assign({ nombreArchivo: 'IMG_0001.jpg', mimeType: 'image/jpeg', imagenBase64: JPEG, thumbBase64: THUMB }, extra || {});
}

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.getFotosStorageSecret = () => SECRET;
  global.getFotosStorageUrl = () => 'https://script.google.com/macros/s/STORAGE/exec';
  // El Service llama a estas funciones como globals (scope compartido de Apps Script)
  global.fotosStorageClient_subir = jest.fn();
  global.fotosStorageClient_obtener = jest.fn();
  global.fotosStorageClient_descartar = jest.fn();
  global.fotosRepository_agregarSiHayCupo = jest.fn().mockReturnValue(true);
  global.fotosRepository_contarPorEvaluacionId = jest.fn().mockReturnValue(0);
  global.reemplazoRepository_buscarPorEvaluacionId = jest.fn().mockReturnValue({ evaluacionId: EVAL_ID, wellId: WELL, email: 'autor@x.com' });
});

describe('schema de la hoja FotosReemplazo', () => {
  test('encabezado exacto', () => {
    expect(Repo.FOTOS_COLUMNAS).toEqual(['timestamp', 'fotoId', 'evaluacionId', 'wellId', 'email', 'driveFileId', 'nombreArchivo', 'mimeType', 'tamanoBytes']);
  });

  test('columnas por texto, tolera orden/mayusculas; faltantes se informan', () => {
    const idx = Repo.fotosRepository_indiceColumnas([' FotoId', 'timestamp', 'EVALUACIONID', 'wellId', 'email', 'driveFileId', 'nombreArchivo', 'mimeType', 'tamanoBytes']);
    expect(idx.fotoId).toBe(0);
    expect(Repo.fotosRepository_columnasFaltantes(idx)).toEqual([]);
    expect(Repo.fotosRepository_columnasFaltantes(Repo.fotosRepository_indiceColumnas(['timestamp']))).toHaveLength(8);
  });

  test('ida y vuelta fila <-> foto; no hay base64 ni URL en la fila', () => {
    const idx = Repo.fotosRepository_indiceColumnas(Repo.FOTOS_COLUMNAS);
    const foto = { timestamp: new Date('2026-05-01T12:00:00Z'), fotoId: 'f', evaluacionId: 'e', wellId: WELL, email: 'a@x.com', driveFileId: 'DRV123', nombreArchivo: 'n.jpg', mimeType: 'image/jpeg', tamanoBytes: 123456 };
    const fila = Repo.fotosRepository_filaDesdeFoto(foto, idx, 9);
    expect(fila.join('|')).not.toMatch(/base64|https?:/);
    expect(Repo.fotosRepository_fotoDesdeFila(fila, idx)).toEqual({ ...foto, timestamp: '2026-05-01T12:00:00.000Z' });
  });
});

describe('FotosStorageClient: firma servicio-a-servicio', () => {
  test('hex y firma deterministas; la firma depende de accion, ts, nonce y payload', () => {
    const base = Client.fotosStorageClient_firmar(SECRET, 'putFoto', 1, 'n', '{}');
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(Client.fotosStorageClient_firmar(SECRET, 'putFoto', 1, 'n', '{}')).toBe(base);
    expect(Client.fotosStorageClient_firmar(SECRET, 'getFoto', 1, 'n', '{}')).not.toBe(base);
    expect(Client.fotosStorageClient_firmar(SECRET, 'putFoto', 2, 'n', '{}')).not.toBe(base);
    expect(Client.fotosStorageClient_firmar(SECRET, 'putFoto', 1, 'm', '{}')).not.toBe(base);
    expect(Client.fotosStorageClient_firmar(SECRET, 'putFoto', 1, 'n', '{"a":1}')).not.toBe(base);
    expect(Client.fotosStorageClient_firmar('t'.repeat(40), 'putFoto', 1, 'n', '{}')).not.toBe(base);
  });

  test('comparacion en tiempo constante', () => {
    expect(Client.fotosStorageClient_igualesConstante('abc', 'abc')).toBe(true);
    expect(Client.fotosStorageClient_igualesConstante('abc', 'abd')).toBe(false);
    expect(Client.fotosStorageClient_igualesConstante('abc', 'abcd')).toBe(false);
    expect(Client.fotosStorageClient_igualesConstante(null, 'abc')).toBe(false);
  });

  test('la solicitud lleva v, accion, ts, nonce, payload (string) y firma - y NUNCA el secreto', () => {
    const sol = Client.fotosStorageClient_armarSolicitud('putFoto', { x: 1 }, SECRET, 1000, 'nonce-1');
    expect(Object.keys(sol).sort()).toEqual(['action', 'nonce', 'payload', 'sig', 'ts', 'v']);
    expect(typeof sol.payload).toBe('string');
    expect(JSON.stringify(sol)).not.toContain(SECRET);
  });

  describe('fotosStorageClient_llamar', () => {
    function storageResponde(dataObj, over) {
      global.UrlFetchApp.fetch.mockImplementation((url, opts) => {
        const sol = JSON.parse(opts.payload);
        const ts = Math.floor(Date.now() / 1000);
        const payload = JSON.stringify(dataObj);
        const resp = Object.assign({ v: 'v1', ts, nonce: sol.nonce, payload, sig: Client.fotosStorageClient_firmar(SECRET, 'response', ts, sol.nonce, payload) }, over || {});
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify(resp) };
      });
    }

    test('subir OK: manda POST firmado a FOTOS_STORAGE_URL y devuelve driveFileId + tamano', () => {
      storageResponde({ status: 'ok', driveFileId: 'DRV1', tamanoBytes: 321 });
      const r = Client.fotosStorageClient_subir({ fotoId: 'f' });
      expect(r).toEqual({ driveFileId: 'DRV1', tamanoBytes: 321 });
      const [url, opts] = global.UrlFetchApp.fetch.mock.calls[0];
      expect(url).toBe('https://script.google.com/macros/s/STORAGE/exec');
      expect(opts.method).toBe('post');
      expect(opts.payload).not.toContain(SECRET);
    });

    test('HTTP distinto de 200: error', () => {
      global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 500, getContentText: () => 'x' });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/HTTP 500/);
    });

    test('respuesta que no es JSON (p. ej. pagina de login/error de Google): error', () => {
      global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 200, getContentText: () => '<html>' });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/no es JSON/);
    });

    test('respuesta con firma invalida: rechazada (storage suplantado)', () => {
      storageResponde({ status: 'ok', driveFileId: 'X', tamanoBytes: 1 }, { sig: 'f'.repeat(64) });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/FIRMA_INVALIDA/);
    });

    test('respuesta de otra solicitud (nonce distinto) o vencida: rechazada', () => {
      storageResponde({ status: 'ok' }, { nonce: 'otro-nonce-cualquiera' });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/NONCE_DISTINTO/);
      storageResponde({ status: 'ok' }, { ts: 1 });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/RESPUESTA_VENCIDA/);
    });

    test('respuesta sin firmar (error UNAUTHORIZED del storage): rechazada', () => {
      global.UrlFetchApp.fetch.mockReturnValue({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ status: 'error', code: 'UNAUTHORIZED' }) });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/RESPUESTA_SIN_FIRMA/);
    });

    test('storage devuelve error firmado: se propaga como error', () => {
      storageResponde({ status: 'error', code: 'INVALID_IMAGEN' });
      expect(() => Client.fotosStorageClient_subir({})).toThrow(/INVALID_IMAGEN/);
    });

    test('los mensajes de error no incluyen el secreto ni la imagen', () => {
      global.UrlFetchApp.fetch.mockImplementation(() => { throw new Error('Address unavailable'); });
      try { Client.fotosStorageClient_subir({ imagenBase64: JPEG }); } catch (e) {
        expect(e.message).not.toContain(SECRET);
        expect(e.message).not.toContain(JPEG);
      }
    });
  });
});

describe('fotosService_validarSubida', () => {
  const v = (o) => {
    const d = datos(o);
    return Service.fotosService_validarSubida(d.evaluacionId === undefined ? EVAL_ID : d.evaluacionId, d.nombreArchivo, d.mimeType, d.imagenBase64, d.thumbBase64);
  };
  test('valida', () => { expect(v()).toEqual({ ok: true }); });
  test('mime invalido (png, heic, vacio)', () => {
    ['image/png', 'image/heic', '', undefined].forEach((m) => expect(v({ mimeType: m }).code).toBe('INVALID_MIME'));
  });
  test('demasiado grande (> 2 MB)', () => {
    const grande = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 + 10)]).toString('base64');
    expect(v({ imagenBase64: grande }).code).toBe('FILE_TOO_LARGE');
  });
  test('exactamente en el limite pasa', () => {
    const limite = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024 - 3)]).toString('base64');
    expect(v({ imagenBase64: limite })).toEqual({ ok: true });
  });
  test('no es un JPEG real (firma binaria) o base64 invalido', () => {
    expect(v({ imagenBase64: Buffer.from('GIF89a......').toString('base64') }).code).toBe('INVALID_IMAGEN');
    expect(v({ imagenBase64: 'no es base64!!' }).code).toBe('INVALID_IMAGEN');
    expect(v({ imagenBase64: '' }).code).toBe('INVALID_IMAGEN');
  });
  test('miniatura ausente, invalida o enorme', () => {
    expect(v({ thumbBase64: undefined }).code).toBe('INVALID_THUMB');
    expect(v({ thumbBase64: Buffer.from('xxxxxxxxxxxx').toString('base64') }).code).toBe('INVALID_THUMB');
    const enorme = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(61 * 1024)]).toString('base64');
    expect(v({ thumbBase64: enorme }).code).toBe('INVALID_THUMB');
  });
  test('evaluacionId y nombre invalidos', () => {
    expect(Service.fotosService_validarSubida('x', 'a.jpg', 'image/jpeg', JPEG, THUMB).code).toBe('INVALID_EVALUACION_ID');
    expect(Service.fotosService_validarSubida(EVAL_ID, '', 'image/jpeg', JPEG, THUMB).code).toBe('INVALID_NOMBRE_ARCHIVO');
  });
  test('limites declarados: 5 fotos, 2 MB', () => {
    expect(Service.FOTOS_MAX_POR_EVALUACION).toBe(5);
    expect(Service.FOTOS_MAX_BYTES).toBe(2 * 1024 * 1024);
  });
});

describe('fotosService_subir', () => {
  beforeEach(() => {
    global.fotosStorageClient_subir.mockReturnValue({ driveFileId: 'DRIVE_SECRETO_1', tamanoBytes: 4321 });
  });

  test('subida OK: storage + fila en la hoja + metadata sanitizada (sin email, sin driveFileId, sin nombre)', () => {
    const r = Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos());
    expect(r.ok).toBe(true);
    expect(Object.keys(r.foto).sort()).toEqual(['evaluacionId', 'fotoId', 'mimeType', 'tamanoBytes', 'timestamp', 'wellId']);
    expect(JSON.stringify(r)).not.toMatch(/autor@x\.com|DRIVE_SECRETO_1/);
    const [fila, max] = global.fotosRepository_agregarSiHayCupo.mock.calls[0];
    expect(max).toBe(5);
    expect(fila).toMatchObject({ evaluacionId: EVAL_ID, wellId: WELL, email: 'autor@x.com', driveFileId: 'DRIVE_SECRETO_1', tamanoBytes: 4321 });
    expect(fila.fotoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(fila.nombreArchivo).toBe(WELL + '_' + EVAL_ID + '_' + fila.fotoId + '.jpg');
  });

  test('el nombre de archivo del navegador NO se usa (puede traer datos personales)', () => {
    Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos({ nombreArchivo: 'casa_de_juan_perez.jpg' }));
    const enviado = global.fotosStorageClient_subir.mock.calls[0][0];
    expect(enviado.nombreArchivo).not.toMatch(/juan/);
    expect(global.fotosRepository_agregarSiHayCupo.mock.calls[0][0].nombreArchivo).not.toMatch(/juan/);
  });

  test('evaluacionId inexistente: EVALUACION_NOT_FOUND y nada se sube', () => {
    global.reemplazoRepository_buscarPorEvaluacionId.mockReturnValue(null);
    expect(Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos()).code).toBe('EVALUACION_NOT_FOUND');
    expect(global.fotosStorageClient_subir).not.toHaveBeenCalled();
  });

  test('wellId no coincide con la evaluacion: EVALUACION_WELLID_MISMATCH', () => {
    expect(Service.fotosService_subir('autor@x.com', '05-0001', EVAL_ID, datos()).code).toBe('EVALUACION_WELLID_MISMATCH');
    expect(global.fotosStorageClient_subir).not.toHaveBeenCalled();
  });

  test('trabajo colaborativo: otro usuario (no el autor de la evaluacion) puede agregar fotos', () => {
    const r = Service.fotosService_subir('companero@x.com', WELL, EVAL_ID, datos());
    expect(r.ok).toBe(true);
    expect(global.fotosStorageClient_subir).toHaveBeenCalledTimes(1);
  });

  test('la fila de la foto identifica a quien SUBIO esa foto, no al autor de la evaluacion', () => {
    Service.fotosService_subir('companero@x.com', WELL, EVAL_ID, datos());
    const fila = global.fotosRepository_agregarSiHayCupo.mock.calls[0][0];
    expect(fila.email).toBe('companero@x.com');
    expect(fila.email).not.toBe('autor@x.com');
  });

  test('sin ventana temporal: una evaluacion antigua tambien acepta fotos', () => {
    global.reemplazoRepository_buscarPorEvaluacionId.mockReturnValue({ evaluacionId: EVAL_ID, wellId: WELL, email: 'autor@x.com', timestamp: '2020-01-01T00:00:00.000Z' });
    expect(Service.fotosService_subir('companero@x.com', WELL, EVAL_ID, datos()).ok).toBe(true);
  });

  test('colaboracion no salta los limites: wellId, existencia y maximo de 5 siguen aplicando a cualquier usuario', () => {
    expect(Service.fotosService_subir('companero@x.com', '05-0001', EVAL_ID, datos()).code).toBe('EVALUACION_WELLID_MISMATCH');
    global.fotosRepository_contarPorEvaluacionId.mockReturnValue(5);
    expect(Service.fotosService_subir('companero@x.com', WELL, EVAL_ID, datos()).code).toBe('FOTO_LIMIT');
    global.reemplazoRepository_buscarPorEvaluacionId.mockReturnValue(null);
    expect(Service.fotosService_subir('companero@x.com', WELL, EVAL_ID, datos()).code).toBe('EVALUACION_NOT_FOUND');
  });

  test('limite de 5 fotos por evaluacion', () => {
    global.fotosRepository_contarPorEvaluacionId.mockReturnValue(5);
    expect(Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos()).code).toBe('FOTO_LIMIT');
    expect(global.fotosStorageClient_subir).not.toHaveBeenCalled();
  });

  test('carrera: el cupo se agota entre el chequeo y el append -> FOTO_LIMIT y el archivo ya subido se descarta', () => {
    global.fotosRepository_agregarSiHayCupo.mockReturnValue(false);
    expect(Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos()).code).toBe('FOTO_LIMIT');
    expect(global.fotosStorageClient_descartar).toHaveBeenCalledWith('DRIVE_SECRETO_1');
  });

  test('storage caido: STORAGE_UNAVAILABLE, no se escribe fila', () => {
    global.fotosStorageClient_subir.mockImplementation(() => { throw new Error('storage HTTP 500'); });
    expect(Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos()).code).toBe('STORAGE_UNAVAILABLE');
    expect(global.fotosRepository_agregarSiHayCupo).not.toHaveBeenCalled();
  });

  test('compensacion: si falla escribir la fila, se manda a la papelera el archivo subido (y el error se propaga)', () => {
    global.fotosRepository_agregarSiHayCupo.mockImplementation(() => { throw new Error('lock timeout'); });
    expect(() => Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos())).toThrow('lock timeout');
    expect(global.fotosStorageClient_descartar).toHaveBeenCalledWith('DRIVE_SECRETO_1');
  });

  test('contenido invalido corta antes de tocar la hoja o el storage', () => {
    expect(Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos({ mimeType: 'image/png' })).code).toBe('INVALID_MIME');
    expect(global.reemplazoRepository_buscarPorEvaluacionId).not.toHaveBeenCalled();
  });

  test('una foto falla y otra no: son operaciones independientes; el reintento de la fallida funciona', () => {
    global.fotosStorageClient_subir
      .mockReturnValueOnce({ driveFileId: 'D1', tamanoBytes: 1 })
      .mockImplementationOnce(() => { throw new Error('timeout'); })
      .mockReturnValueOnce({ driveFileId: 'D3', tamanoBytes: 1 });
    const a = Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos());
    const b = Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos());
    const reintento = Service.fotosService_subir('autor@x.com', WELL, EVAL_ID, datos());
    expect([a.ok, b.ok, reintento.ok]).toEqual([true, false, true]);
    expect(b.code).toBe('STORAGE_UNAVAILABLE');
    expect(global.fotosRepository_agregarSiHayCupo).toHaveBeenCalledTimes(2);
    expect(a.foto.fotoId).not.toBe(reintento.foto.fotoId);
  });
});

describe('listados (0 / 1 / varias fotos) y sanitizacion', () => {
  const fila = (id, ts, extra) => Object.assign({ timestamp: ts, fotoId: id, evaluacionId: EVAL_ID, wellId: WELL, email: 'autor@x.com', driveFileId: 'DRV_' + id, nombreArchivo: id + '.jpg', mimeType: 'image/jpeg', tamanoBytes: 100 }, extra || {});

  test('0 fotos', () => {
    global.fotosRepository_listarPorEvaluacionId.mockReturnValue([]);
    expect(Service.fotosService_listarPorEvaluacion(EVAL_ID)).toEqual({ evaluacionId: EVAL_ID, fotos: [] });
  });

  test('1 foto y varias: orden cronologico ascendente, sin email ni driveFileId ni nombre', () => {
    global.fotosRepository_listarPorEvaluacionId.mockReturnValue([fila('c', '2026-01-03T00:00:00.000Z'), fila('a', '2026-01-01T00:00:00.000Z'), fila('b', '2026-01-02T00:00:00.000Z')]);
    const r = Service.fotosService_listarPorEvaluacion(EVAL_ID);
    expect(r.fotos.map((f) => f.fotoId)).toEqual(['a', 'b', 'c']);
    expect(JSON.stringify(r)).not.toMatch(/autor@x\.com|DRV_|\.jpg/);
  });

  test('por pozo: mantiene evaluacionId de cada foto (no se mezclan entre evaluaciones)', () => {
    global.fotosRepository_listarPorWellId.mockReturnValue([
      fila('a', '2026-01-01T00:00:00.000Z', { evaluacionId: 'EV-1' }),
      fila('b', '2026-01-02T00:00:00.000Z', { evaluacionId: 'EV-2' })
    ]);
    const r = Service.fotosService_listarPorPozo(WELL);
    expect(r.fotos.map((f) => [f.fotoId, f.evaluacionId])).toEqual([['a', 'EV-1'], ['b', 'EV-2']]);
  });
});

describe('fotosService_obtenerImagen', () => {
  const ID = '11111111-1111-4111-8111-111111111111';
  beforeEach(() => {
    global.fotosRepository_buscarPorFotoId.mockReturnValue({ fotoId: ID, driveFileId: 'DRV_1' });
    global.fotosStorageClient_obtener.mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: THUMB });
  });

  test('resuelve el driveFileId desde la hoja (el navegador solo manda fotoId)', () => {
    const r = Service.fotosService_obtenerImagen(ID, 'full');
    expect(global.fotosStorageClient_obtener).toHaveBeenCalledWith('DRV_1', 'full');
    expect(r.imagen).toEqual({ fotoId: ID, variante: 'full', mimeType: 'image/jpeg', imagenBase64: THUMB });
    expect(JSON.stringify(r)).not.toContain('DRV_1');
  });

  test('miniatura: se cachea y la segunda vez no llama al storage; la completa nunca se cachea', () => {
    Service.fotosService_obtenerImagen(ID, 'thumb');
    Service.fotosService_obtenerImagen(ID, 'thumb');
    expect(global.fotosStorageClient_obtener).toHaveBeenCalledTimes(1);
    Service.fotosService_obtenerImagen(ID, 'full');
    Service.fotosService_obtenerImagen(ID, 'full');
    expect(global.fotosStorageClient_obtener).toHaveBeenCalledTimes(3);
  });

  test('foto inexistente en la hoja: FOTO_NOT_FOUND (y nunca se cachea ni se llama al storage)', () => {
    global.fotosRepository_buscarPorFotoId.mockReturnValue(null);
    expect(Service.fotosService_obtenerImagen(ID, 'thumb').code).toBe('FOTO_NOT_FOUND');
    expect(Service.fotosService_obtenerImagen(ID, 'full').code).toBe('FOTO_NOT_FOUND');
    expect(global.fotosStorageClient_obtener).not.toHaveBeenCalled();
  });

  test('un hit de cache de miniatura no relee la hoja', () => {
    Service.fotosService_obtenerImagen(ID, 'thumb');
    global.fotosRepository_buscarPorFotoId.mockClear();
    Service.fotosService_obtenerImagen(ID, 'thumb');
    expect(global.fotosRepository_buscarPorFotoId).not.toHaveBeenCalled();
  });

  test('id o variante invalidos', () => {
    expect(Service.fotosService_obtenerImagen('x', 'full').code).toBe('INVALID_FOTO_ID');
    expect(Service.fotosService_obtenerImagen(ID, 'raw').code).toBe('INVALID_VARIANTE');
    expect(global.fotosRepository_buscarPorFotoId).not.toHaveBeenCalled();
  });

  test('storage caido: STORAGE_UNAVAILABLE', () => {
    global.fotosStorageClient_obtener.mockImplementation(() => { throw new Error('storage HTTP 502'); });
    expect(Service.fotosService_obtenerImagen(ID, 'full').code).toBe('STORAGE_UNAVAILABLE');
  });
});
