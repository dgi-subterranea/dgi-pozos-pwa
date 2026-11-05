// E10-1: AUDITORIA de TODAS las mutaciones de ubicacion. `ubicacion` es LECTURA; originar o cancelar exige `ubicacion_corregir`; resolver / decidir / validar exige `ubicacion_validar`.
// Se prueba dos veces: estaticamente (todo handler que llama a un servicio de escritura de ubicacion exige uno de esos permisos) y dinamicamente (quien solo tiene `ubicacion` es rechazado en cada accion
// y ningun servicio de escritura se invoca).
const fs = require('fs');
const path = require('path');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

const api = fs.readFileSync(path.join(__dirname, '..', 'src', 'Api.js'), 'utf8');
const W = '04-0263';

const SERVICIOS_DE_ESCRITURA = [
  'ubicacionCorreccionService_proponer', 'ubicacionCorreccionService_validar', 'ubicacionCorreccionService_rechazar', 'ubicacionCorreccionService_revertir',
  'ubicacionFuenteDecisionesService_decidir', 'ubicacionFuenteSugerenciasService_sugerir', 'ubicacionFuenteSugerenciasService_resolver', 'ubicacionFuenteSugerenciasService_cancelar'
];

// las 8 acciones de escritura de ubicacion -> permisos que exige cada una
const MUTACIONES = [
  ['proponerCorreccionUbicacion', { wellId: W, lat: -32.8, lon: -68.7, metodo: 'PUNTO_EN_MAPA', clientRequestId: 'r1' }, ['ubicacion', 'ubicacion_corregir'], 'ubicacionCorreccionService_proponer'],
  ['sugerirDecisionFuente', { wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 2, accionSugerida: 'ACEPTAR', versionVista: 0, clientRequestId: 'r2' }, ['ubicacion', 'ubicacion_corregir'], 'ubicacionFuenteSugerenciasService_sugerir'],
  ['cancelarSugerenciaFuente', { sugerenciaId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', clientRequestId: 'r3' }, ['ubicacion', 'ubicacion_corregir'], 'ubicacionFuenteSugerenciasService_cancelar'],
  ['validarCorreccionUbicacion', { correccionId: 'c1', motivo: 'm' }, ['ubicacion', 'ubicacion_validar'], 'ubicacionCorreccionService_validar'],
  ['rechazarCorreccionUbicacion', { correccionId: 'c1', motivo: 'm' }, ['ubicacion', 'ubicacion_validar'], 'ubicacionCorreccionService_rechazar'],
  ['revertirCorreccionUbicacion', { correccionId: 'c1', motivo: 'm' }, ['ubicacion', 'ubicacion_validar'], 'ubicacionCorreccionService_revertir'],
  ['decidirFuenteUbicacion', { wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 2, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'r4' }, ['ubicacion', 'ubicacion_validar'], 'ubicacionFuenteDecisionesService_decidir'],
  ['resolverSugerenciaFuente', { sugerenciaId: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', resolucion: 'APROBAR', versionVista: 0, clientRequestId: 'r5' }, ['ubicacion', 'ubicacion_validar'], 'ubicacionFuenteSugerenciasService_resolver']
];

const post = (accion, cuerpo) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(Object.assign({ action: accion, sessionToken: 't' }, cuerpo)) } }).text);
const como = (ids) => {
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'u@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((email, modulo) => ids.indexOf(modulo) >= 0);
};
beforeEach(() => {
  installAppsScriptFakes();
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
});

describe('auditoria ESTATICA: toda mutacion de ubicacion exige un permiso de escritura o de validacion', () => {
  const handlers = api.split('\nfunction ').slice(1).map((c) => ({ nombre: c.split('(')[0], cuerpo: c }));

  test('el barrido encuentra exactamente 8 puntos de entrada que llaman a un servicio de escritura de ubicacion (3 de originar/cancelar y 5 de resolver/decidir)', () => {
    const llamadores = handlers.filter((h) => SERVICIOS_DE_ESCRITURA.some((s) => h.cuerpo.indexOf(s) >= 0)).map((h) => h.nombre);
    expect(llamadores.sort()).toEqual(['handleCancelarSugerenciaFuente', 'handleDecidirFuenteUbicacion', 'handleProponerCorreccionUbicacion', 'handleRechazarCorreccionUbicacion', 'handleResolverSugerenciaFuente', 'handleRevertirCorreccionUbicacion', 'handleSugerirDecisionFuente', 'handleValidarCorreccionUbicacion']);
  });

  test('ninguno de ellos se conforma con `ubicacion` solo: todos mencionan ubicacion_corregir o ubicacion_validar en su chequeo', () => {
    handlers.filter((h) => SERVICIOS_DE_ESCRITURA.some((s) => h.cuerpo.indexOf(s) >= 0)).forEach((h) => {
      const sinComentarios = h.cuerpo.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
      // validar / rechazar / revertir delegan el chequeo en resolverCorreccionUbicacion (ubicacion + ubicacion_validar): se verifica ese envoltorio en la misma pasada
      const delegaEn = /resolverCorreccionUbicacion\(/.test(sinComentarios) ? handlers.find((x) => x.nombre === 'resolverCorreccionUbicacion').cuerpo : '';
      expect({ handler: h.nombre, escritura: /ubicacion_corregir|ubicacion_validar/.test(sinComentarios + delegaEn) }).toEqual({ handler: h.nombre, escritura: true });
    });
  });

  test('sugerirDecisionFuente y cancelarSugerenciaFuente ya NO se contentan con `ubicacion` (validarPermiso simple)', () => {
    expect(api).not.toMatch(/validarPermiso\(session, 'sugerirDecisionFuente', [^)]*'ubicacion'\)/);
    expect(api).not.toMatch(/validarPermiso\(session, 'cancelarSugerenciaFuente', [^)]*'ubicacion'\)/);
    expect(api).toMatch(/validarPermisosTodos\(session, 'sugerirDecisionFuente', d\.wellId, \['ubicacion', 'ubicacion_corregir'\]\)/);
    expect(api).toMatch(/validarPermisosTodos\(session, 'cancelarSugerenciaFuente', null, \['ubicacion', 'ubicacion_corregir'\]\)/);
  });

  test('las lecturas de ubicacion siguen pidiendo solo `ubicacion`', () => {
    ['getWellLocation', 'getCorreccionesUbicacionPozo', 'getDecisionesFuentesPozo', 'getSugerenciasFuentesPozo'].forEach((accion) => {
      expect(api).toMatch(new RegExp("validarPermiso\\(session, '" + accion + "', [^)]*'ubicacion'\\)"));
    });
  });
});

describe('auditoria DINAMICA: con solo `ubicacion` (lectura) toda mutacion se rechaza y ningun servicio de escritura se invoca', () => {
  test.each(MUTACIONES)('%s con solo ubicacion (+ mapa y todo lo demas, menos corregir / validar) -> PERMISSION_DENIED', (accion, cuerpo, _exige, servicio) => {
    como(['ubicacion', 'mapa', 'perfil', 'datos', 'ne', 'fotos', 'observaciones', 'reemplazo']);
    expect(post(accion, cuerpo)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    SERVICIOS_DE_ESCRITURA.forEach((s) => { if (global[s] && global[s].mock) { expect(global[s]).not.toHaveBeenCalled(); } });
    expect(global[servicio]).not.toHaveBeenCalled();
  });

  test.each(MUTACIONES)('%s sin ubicacion aunque tenga el permiso de escritura / validacion -> PERMISSION_DENIED (la lectura es requisito)', (accion, cuerpo, exige) => {
    como(exige.filter((p) => p !== 'ubicacion'));
    expect(post(accion, cuerpo)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test.each(MUTACIONES.filter((m) => m[2][1] === 'ubicacion_corregir'))('%s: ubicacion_validar NO reemplaza a ubicacion_corregir', (accion, cuerpo) => {
    como(['ubicacion', 'ubicacion_validar']);
    expect(post(accion, cuerpo)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test.each(MUTACIONES.filter((m) => m[2][1] === 'ubicacion_validar'))('%s: ubicacion_corregir NO reemplaza a ubicacion_validar', (accion, cuerpo) => {
    como(['ubicacion', 'ubicacion_corregir']);
    expect(post(accion, cuerpo)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test('cada intento denegado se audita en Historial como PERMISSION_DENIED', () => {
    como(['ubicacion']);
    post('sugerirDecisionFuente', MUTACIONES[1][1]);
    post('cancelarSugerenciaFuente', MUTACIONES[2][1]);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@example.com', 'sugerirDecisionFuente', W, 'PERMISSION_DENIED');
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@example.com', 'cancelarSugerenciaFuente', null, 'PERMISSION_DENIED');
  });
});

describe('las lecturas de ubicacion NO exigen escritura', () => {
  test('con solo `ubicacion` (sin corregir ni validar) las lecturas responden', () => {
    como(['ubicacion']);
    global.registryService_getWellLocation.mockReturnValue({ found: true, location: { wellId: W } });
    global.ubicacionCorreccionService_getPorPozo.mockReturnValue({ vigente: null, correcciones: [] });
    expect(post('getWellLocation', { wellId: W }).status).toBe('ok');
    expect(post('getDecisionesFuentesPozo', { wellId: W }).status).toBe('ok');
    expect(post('getSugerenciasFuentesPozo', { wellId: W }).status).toBe('ok');
  });
});
