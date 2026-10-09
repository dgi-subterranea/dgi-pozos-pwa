const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();

const Diag = require('../src/FotosDiagnostico');

describe('fotosDiagnostico_buscarFugas', () => {
  const prohibidos = { driveFileId: 'DRV_123', secreto: 'S3CRET0', urlStorage: 'https://script.google.com/macros/s/X/exec' };

  test('sin fugas: respuesta sanitizada', () => {
    expect(Diag.fotosDiagnostico_buscarFugas([{ foto: { fotoId: 'f', tamanoBytes: 1 } }], prohibidos)).toEqual([]);
  });
  test('detecta driveFileId, secreto y URL en cualquier parte de las respuestas', () => {
    const r = [{ a: { b: 'x DRV_123 y' } }, { c: 'https://script.google.com/macros/s/X/exec' }, ['S3CRET0']];
    expect(Diag.fotosDiagnostico_buscarFugas(r, prohibidos).sort()).toEqual(['driveFileId', 'secreto', 'urlStorage']);
  });
  test('valores vacios no generan falsos positivos', () => {
    expect(Diag.fotosDiagnostico_buscarFugas([{ x: 'a' }], { driveFileId: '', secreto: null })).toEqual([]);
  });
});

describe('diagnosticarFotosReemplazo (sin tocar Google)', () => {
  beforeEach(() => {
    global.Logger = { log: jest.fn() };
    global.getFotosStorageSecret = () => 's'.repeat(40);
    global.getFotosStorageUrl = () => 'https://script.google.com/macros/s/ABC/exec';
    global.DriveApp = { getStorageUsed: () => 1000 };
    global.Session = { getEffectiveUser: () => ({ getEmail: () => 'principal@x.com' }) };
    global.fotosService_subir = jest.fn();
    global.fotosService_obtenerImagen = jest.fn();
    global.fotosService_listarPorEvaluacion = jest.fn();
    global.fotosRepository_buscarPorFotoId = jest.fn();
  });

  const logs = () => global.Logger.log.mock.calls.map((c) => c[0]).join('\n');

  test('sin evaluacion configurada: explica que hacer y NO sube nada', () => {
    Diag.diagnosticarFotosReemplazo();
    expect(logs()).toMatch(/Completar FOTOS_DIAG_EVALUACION_ID/);
    expect(global.fotosService_subir).not.toHaveBeenCalled();
  });

  test('nunca loguea el secreto ni la URL completa', () => {
    Diag.diagnosticarFotosReemplazo();
    expect(logs()).not.toContain('s'.repeat(40));
    expect(logs()).not.toContain('macros/s/ABC');
  });

  test('sin Script Properties: avisa y corta', () => {
    global.getFotosStorageSecret = () => { throw new Error('FOTOS_STORAGE_SECRET no configurado'); };
    Diag.diagnosticarFotosReemplazo();
    expect(logs()).toMatch(/FALLA .*FOTOS_STORAGE_SECRET/);
  });
});

describe('fotosDiagnostico_pista: errores HTTP de la plataforma', () => {
  test('un error HTTP (con el detalle que ahora trae el mensaje) remite a ese detalle', () => {
    const p = Diag.fotosDiagnostico_pista;
    expect(p('storage HTTP 404 getFotoPozo/thumb 1210c text/html 230ms "Error 404"')).toBe('La plataforma de Google respondio con un error HTTP (ver el detalle del mensaje).');
    expect(p('storage HTTP 500')).toMatch(/error HTTP.*detalle del mensaje/);
    expect(p('storage HTTP 502 putFotoPozo 11c text/plain 90ms "Bad Gateway"')).toMatch(/HTTP/);
  });

  test('las demas pistas no cambian', () => {
    const p = Diag.fotosDiagnostico_pista;
    expect(p('RESPUESTA_SIN_FIRMA (el storage dijo UNAUTHORIZED)')).toMatch(/secreto/);
    expect(p('algo raro')).toBe('');
  });
});
