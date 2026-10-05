const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Matriz de permisos del backend (fail-closed). Contrato:
//  - getMapaPozos (dataset general que usan Pozos cerca mio y el mapa
//    Pozos Provincia): TODO usuario activo, sin permiso de modulo.
//  - Todo lo protegido sigue gateado por SU permiso: getMapaNE ("ne"),
//    getWellLocation ("ubicacion"), getWellRecord/getWellSummary/
//    getIndiceBusquedaProvincia ("datos"), getProfile/getItfAvailability
//    ("perfil"), endpoints de reemplazo ("reemplazo").
//  - Usuario inactivo: nada, aunque tenga todos los permisos.
beforeEach(() => {
  installAppsScriptFakes();
  global.mapaService_getPozos.mockReturnValue({ found: true, pozos: [{ wellId: '04-0263', lat: -32.8, lon: -68.7, estado: 'C' }], metadata: null });
  global.mapaNEService_getPuntos.mockReturnValue({ found: true, puntos: [] });
  global.registryService_getWellLocation.mockReturnValue({ found: true, location: {} });
  global.registryService_getWellRecord.mockReturnValue({ found: true, record: {} });
  global.registryService_getWellSummary.mockReturnValue({ found: true, summary: {} });
  global.mapaService_getIndiceBusqueda.mockReturnValue({ found: true, pozos: [] });
  global.profileService_getProfile.mockReturnValue({ found: true, blob: { getBytes: () => [1], getContentType: () => 'image/jpeg' } });
  global.profileService_checkDisponibilidad.mockReturnValue({ '04-0263': true });
  global.reemplazoService_getEstado.mockReturnValue({ wellId: '04-0263', estado: 'SIN_EVALUAR', ultimaEvaluacion: null });
});

function como(permisos, activo) {
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'u@example.com' });
  global.isUserActive.mockReturnValue(activo !== false);
  global.hasPermission.mockImplementation((email, modulo) => activo !== false && permisos[modulo] === true);
}

const W = '04-0263';
const endpoints = {
  getMapaPozos: () => Api.handleGetMapaPozos('t'),
  getMapaNE: () => Api.handleGetMapaNE('t'),
  getWellLocation: () => Api.handleGetWellLocation('t', W),
  getWellRecord: () => Api.handleGetWellRecord('t', W),
  getWellSummary: () => Api.handleGetWellSummary('t', W),
  getIndiceBusquedaProvincia: () => Api.handleGetIndiceBusquedaProvincia('t'),
  getProfile: () => Api.handleGetProfile('t', W),
  getItfAvailability: () => Api.handleGetItfAvailability('t', [W]),
  getEstadoReemplazo: () => Api.handleGetEstadoReemplazo('t', W)
};
// permiso que exige cada endpoint (null = solo usuario activo)
const exige = {
  getMapaPozos: null,
  getMapaNE: 'ne',
  getWellLocation: 'ubicacion',
  getWellRecord: 'datos',
  getWellSummary: 'datos',
  getIndiceBusquedaProvincia: 'datos',
  getProfile: 'perfil',
  getItfAvailability: 'perfil',
  getEstadoReemplazo: 'reemplazo'
};

const perfiles = [
  ['solo perfil', { perfil: true }],
  ['solo ne', { ne: true }],
  ['perfil + ne', { perfil: true, ne: true }],
  ['solo reemplazo', { reemplazo: true }],
  ['perfil + reemplazo (datos/ubicacion/ne = NO)', { perfil: true, reemplazo: true }],
  ['ningun permiso funcional (activo)', {}],
  ['todos los permisos', { perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: true }]
];

describe.each(perfiles)('usuario activo: %s', (nombre, permisos) => {
  Object.keys(endpoints).forEach((ep) => {
    const necesario = exige[ep];
    const permitido = necesario === null || permisos[necesario] === true;
    test(ep + ' -> ' + (permitido ? 'OK' : 'PERMISSION_DENIED'), () => {
      como(permisos, true);
      const r = endpoints[ep]();
      if (permitido) {
        expect(r.status).toBe('ok');
      } else {
        expect(r.status).toBe('error');
        expect(r.code).toBe('PERMISSION_DENIED');
      }
    });
  });

  test('Pozos cerca mio / Provincia: el dataset llega aunque ubicacion=NO', () => {
    como({ ...permisos, ubicacion: false }, true);
    expect(endpoints.getMapaPozos().status).toBe('ok');
  });
});

describe('usuario inactivo: nada, aunque tenga todos los permisos', () => {
  Object.keys(endpoints).forEach((ep) => {
    test(ep + ' -> USER_DISABLED', () => {
      como({ perfil: true, datos: true, ubicacion: true, ne: true, reemplazo: true }, false);
      const r = endpoints[ep]();
      expect(r.status).toBe('error');
      expect(r.code).toBe('USER_DISABLED');
    });
  });
});

describe('la ubicacion individual sigue protegida (no se relajo)', () => {
  test('ubicacion=NO: getWellLocation denegado y el servicio nunca se consulta', () => {
    como({ perfil: true, datos: true, ne: true, reemplazo: true }, true);
    const r = Api.handleGetWellLocation('t', W);
    expect(r.code).toBe('PERMISSION_DENIED');
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('el dataset general no trae titular ni campos registrales', () => {
    como({}, true);
    const r = Api.handleGetMapaPozos('t');
    Object.keys(r.data.pozos[0]).forEach((k) => {
      expect(['wellId', 'lat', 'lon', 'estado', 'cuenca', 'profundidad', 'tramosFiltrantes', 'surgencia']).toContain(k);
    });
  });
});
