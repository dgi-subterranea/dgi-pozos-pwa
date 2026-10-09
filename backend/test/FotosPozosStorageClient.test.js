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

describe('FotosStorageClient: detalle seguro de un error HTTP (fotosStorageClient_detalleHttp)', () => {
  const pagina404 = '<html><head><title>Error</title></head><body><h1>Error 404</h1><p>Lo sentimos,   no se pudo abrir   el archivo.</p></body></html>';
  const respuesta = (texto, headers) => ({ getContentText: () => texto, getHeaders: () => headers });

  test('formato: accion/variante, tamano del cuerpo, tipo sin charset, milisegundos y extracto sin etiquetas HTML ni espacios repetidos', () => {
    const d = Client.fotosStorageClient_detalleHttp(respuesta(pagina404, { 'Content-Type': 'text/html; charset=utf-8' }), 'getFotoPozo', { driveFileId: 'X', variante: 'thumb' }, 250);
    expect(d).toBe('getFotoPozo/thumb ' + pagina404.length + 'c text/html 250ms "Error Error 404 Lo sentimos, no se pudo abrir el archivo."');
  });

  test('sin variante no agrega la barra; el nombre del header puede venir en minuscula', () => {
    const d = Client.fotosStorageClient_detalleHttp(respuesta('boom', { 'content-type': 'application/json' }), 'putFotoPozo', { fotoId: 'f' }, 5);
    expect(d).toBe('putFotoPozo 4c application/json 5ms "boom"');
  });

  test('el extracto se corta a 70 caracteres y el detalle completo cabe en el recorte de 160 del log', () => {
    const d = Client.fotosStorageClient_detalleHttp(respuesta('x'.repeat(500), { 'Content-Type': 'text/plain' }), 'getFotoPozo', { variante: 'full' }, 1234);
    expect(d).toContain('"' + 'x'.repeat(70) + '"');
    expect(d).not.toContain('x'.repeat(71));
    expect(('storage HTTP 404 ' + d).length).toBeLessThan(160);
  });

  test('NUNCA incluye ids, imagenes del payload, el secreto ni la URL del storage', () => {
    const payload = { driveFileId: 'DRV_SECRETO_123', driveThumbId: 'THUMB_SECRETO_456', fotoId: 'FOTO_ID_789', imagenBase64: 'AAAA'.repeat(200), variante: 'thumb' };
    const d = Client.fotosStorageClient_detalleHttp(respuesta(pagina404, { 'Content-Type': 'text/html' }), 'getFotoPozo', payload, 10);
    ['DRV_SECRETO_123', 'THUMB_SECRETO_456', 'FOTO_ID_789', 'AAAA', SECRET, 'script.google.com/macros'].forEach((prohibido) => expect(d).not.toContain(prohibido));
    expect(d).toContain('getFotoPozo/thumb');
  });

  test('cuerpo vacio: sin comillas y con tipo "sin-tipo"; no rompe si faltan los metodos de la respuesta', () => {
    expect(Client.fotosStorageClient_detalleHttp({ getContentText: () => '' }, 'getFotoPozo', {}, 3)).toBe('getFotoPozo 0c sin-tipo 3ms');
    expect(Client.fotosStorageClient_detalleHttp({ getContentText: () => null, getHeaders: () => null }, 'getFotoPozo', null, 3)).toBe('getFotoPozo 0c sin-tipo 3ms');
    expect(Client.fotosStorageClient_detalleHttp({}, 'getFotoPozo', undefined, 3)).toBe('getFotoPozo 0c sin-tipo 3ms');
  });

  test('si leer el cuerpo o los headers lanza una excepcion, el detalle se arma igual', () => {
    const r = { getContentText: () => { throw new Error('boom'); }, getHeaders: () => { throw new Error('boom2'); } };
    expect(Client.fotosStorageClient_detalleHttp(r, 'trashFotoPozo', {}, 7)).toBe('trashFotoPozo 0c sin-tipo 7ms');
  });
});

describe('FotosStorageClient: el error HTTP de llamar() lleva el detalle', () => {
  const http = (codigo, texto, headers) => ({ getResponseCode: () => codigo, getContentText: () => texto, getHeaders: () => headers || {} });
  const intentar = (fn) => { try { fn(); } catch (e) { return e.message; } return ''; };

  test('HTTP != 200: "storage HTTP <codigo> <detalle>" con accion, variante, tamano, tipo, ms y extracto; sin URL, secreto ni payload', () => {
    const t = jest.spyOn(Date, 'now');
    t.mockReturnValueOnce(1700000000000).mockReturnValueOnce(1700000000000 + 1000).mockReturnValue(1700000000000 + 1000);   // secreto/solicitud usan Date.now; el cronometro mide la diferencia
    global.UrlFetchApp.fetch.mockImplementation(() => http(404, '<h1>Error 404</h1> No se pudo abrir', { 'Content-Type': 'text/html; charset=UTF-8' }));
    const mensaje = intentar(() => Client.fotosStorageClient_obtenerPozo('DRV_SECRETO_123', 'THUMB_SECRETO_456', 'thumb'));
    t.mockRestore();
    expect(mensaje).toMatch(/^storage HTTP 404 getFotoPozo\/thumb \d+c text\/html \d+ms "Error 404 No se pudo abrir"$/);
    ['DRV_SECRETO_123', 'THUMB_SECRETO_456', SECRET, 'script.google.com'].forEach((prohibido) => expect(mensaje).not.toContain(prohibido));
  });

  test('la duracion informada es la de la llamada a Google (milisegundos medidos alrededor del fetch)', () => {
    let reloj = 1700000000000;
    const t = jest.spyOn(Date, 'now').mockImplementation(() => reloj);
    global.UrlFetchApp.fetch.mockImplementation(() => { reloj += 987; return http(502, 'Bad Gateway', { 'Content-Type': 'text/plain' }); });
    const mensaje = intentar(() => Client.fotosStorageClient_descartarPozo('DRV1'));
    t.mockRestore();
    expect(mensaje).toContain(' 987ms');
    expect(mensaje).toMatch(/^storage HTTP 502 trashFotoPozo 11c text\/plain 987ms "Bad Gateway"$/);
  });

  test('tambien el cliente de Reemplazos (putFoto/getFoto/trashFoto) informa el detalle', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => http(500, 'Internal', { 'Content-Type': 'text/plain' }));
    expect(intentar(() => Client.fotosStorageClient_subir({ fotoId: 'f' }))).toMatch(/^storage HTTP 500 putFoto \d+c text\/plain \d+ms "Internal"$/);
    expect(intentar(() => Client.fotosStorageClient_obtener('D', 'full'))).toMatch(/^storage HTTP 500 getFoto\/full /);
  });

  test('una respuesta 200 no cambia: sigue funcionando y no agrega detalle', () => {
    storageResponde({ status: 'ok', driveFileId: 'D', tamanoBytes: 9 });
    expect(Client.fotosStorageClient_subir({ fotoId: 'f' })).toEqual({ driveFileId: 'D', tamanoBytes: 9 });
  });

  test('el cuerpo con basura no se interpreta ni se ejecuta: solo se recorta y se muestra como texto', () => {
    global.UrlFetchApp.fetch.mockImplementation(() => http(503, '<script>alert(1)</script>' + '=HYPERLINK("x")' + '\u0000', { 'Content-Type': 'text/html' }));
    const mensaje = intentar(() => Client.fotosStorageClient_descartarPozo('D'));
    expect(mensaje).not.toContain('<script>');
    expect(mensaje).toContain('storage HTTP 503');
  });
});
