const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();
global.Logger = { log: jest.fn() };

const Client = require('../src/FotosStorageClient');

const SECRET = 's'.repeat(40);

beforeEach(() => {
  installAppsScriptFakes();
  global.getFotosStorageSecret = () => SECRET;
  global.getFotosStorageUrl = () => 'https://script.google.com/macros/s/STORAGE/exec';
});

// El "storage" responde (firmado) y deja ver que accion y payload recibio
function storageResponde(dataObj) {
  const visto = {};
  global.UrlFetchApp.fetch.mockImplementation((url, opts) => {
    const sol = JSON.parse(opts.payload);
    visto.accion = sol.action;
    visto.payload = JSON.parse(sol.payload);
    visto.firmaOk = Client.fotosStorageClient_firmar(SECRET, sol.action, sol.ts, sol.nonce, sol.payload) === sol.sig;
    const ts = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify(dataObj);
    const resp = { v: 'v1', ts, nonce: sol.nonce, payload, sig: Client.fotosStorageClient_firmar(SECRET, 'response', ts, sol.nonce, payload) };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(resp) };
  });
  return visto;
}

describe('FotosStorageClient: acciones de la galeria general de pozos', () => {
  test('subirPozo: accion putFotoPozo firmada; devuelve driveFileId, driveThumbId y tamano', () => {
    const visto = storageResponde({ status: 'ok', driveFileId: 'DRV1', driveThumbId: 'THB1', tamanoBytes: 321 });
    const datos = { fotoId: 'f', fuente: 'CAMPO_APP', carpetaFecha: '2026', mimeType: 'image/jpeg', imagenBase64: 'AAAA', thumbBase64: 'BBBB' };
    expect(Client.fotosStorageClient_subirPozo(datos)).toEqual({ driveFileId: 'DRV1', driveThumbId: 'THB1', tamanoBytes: 321 });
    expect(visto.accion).toBe('putFotoPozo');
    expect(visto.payload).toEqual(datos);
    expect(visto.firmaOk).toBe(true);
  });

  test('subirPozo: un storage que no devuelve driveThumbId da cadena vacia (no undefined)', () => {
    storageResponde({ status: 'ok', driveFileId: 'DRV1', tamanoBytes: 1 });
    expect(Client.fotosStorageClient_subirPozo({}).driveThumbId).toBe('');
  });

  test('obtenerPozo: accion getFotoPozo; manda driveThumbId solo si existe', () => {
    let visto = storageResponde({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
    expect(Client.fotosStorageClient_obtenerPozo('DRV1', 'THB1', 'thumb')).toEqual({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
    expect(visto.accion).toBe('getFotoPozo');
    expect(visto.payload).toEqual({ driveFileId: 'DRV1', driveThumbId: 'THB1', variante: 'thumb' });
    visto = storageResponde({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
    Client.fotosStorageClient_obtenerPozo('DRV1', '', 'full');
    expect(visto.payload).toEqual({ driveFileId: 'DRV1', variante: 'full' });
  });

  test('descartarPozo: accion trashFotoPozo (solo compensacion interna)', () => {
    const visto = storageResponde({ status: 'ok' });
    Client.fotosStorageClient_descartarPozo('DRV1');
    expect(visto.accion).toBe('trashFotoPozo');
    expect(visto.payload).toEqual({ driveFileId: 'DRV1' });
  });

  test('un error del storage se propaga como excepcion con el codigo, sin payload ni secreto', () => {
    storageResponde({ status: 'error', code: 'INVALID_FUENTE' });
    let mensaje = '';
    try { Client.fotosStorageClient_subirPozo({ imagenBase64: 'AAAA'.repeat(50) }); } catch (e) { mensaje = e.message; }
    expect(mensaje).toMatch(/INVALID_FUENTE/);
    expect(mensaje).not.toContain(SECRET);
    expect(mensaje).not.toContain('AAAA');
  });

  test('no se modificaron las acciones de Reemplazos (putFoto / getFoto / trashFoto)', () => {
    let visto = storageResponde({ status: 'ok', driveFileId: 'D', tamanoBytes: 1 });
    Client.fotosStorageClient_subir({ fotoId: 'f' });
    expect(visto.accion).toBe('putFoto');
    visto = storageResponde({ status: 'ok', mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
    Client.fotosStorageClient_obtener('D', 'thumb');
    expect(visto.accion).toBe('getFoto');
    expect(visto.payload).toEqual({ driveFileId: 'D', variante: 'thumb' });
    visto = storageResponde({ status: 'ok' });
    Client.fotosStorageClient_descartar('D');
    expect(visto.accion).toBe('trashFoto');
  });
});
