// Regresion E10-1: el frontend PUBLICADO (pre-E10) contra el backend E10-1. Reproduce, request por request y por doPost (el camino real del Web App), lo que ese frontend dispara al buscar un pozo:
//   checkSession -> permisos -> getItfAvailability + getWellRecord + getWellLocation + getMonitoringPoint (en paralelo) -> render -> registerWellSearch.
// Modulos REALES: AuthService, repositorios de Usuarios, catalogo, dominio, flags, Api y PozoExistenciaService; falsos: Google, hojas (en memoria) y los servicios de datos.
const { crearEntornoE10, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');

const POZO = '04-0263';
let E;
let Api;

function usuariosMigrados() {
  const todos = PERMISOS_DE_SIEMPRE.concat(['mapa']);
  return [
    { email: 'admin1@x.com', nombre: 'Admin Uno', permisos: todos.concat(['usuarios_admin']) },
    { email: 'interno@x.com', nombre: 'Interno', permisos: todos },
    { email: 'externo@x.com', nombre: 'Externo', tipo: 'EXTERNO', permisos: ['perfil', 'datos', 'ubicacion', 'ne', 'mapa'] }
  ];
}

function post(cuerpo) {
  const r = Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } });
  return JSON.parse(r.getContent());
}

beforeEach(() => {
  E = crearEntornoE10({ usuarios: usuariosMigrados() });
  Object.assign(global, require('../src/PozoExistenciaService'));
  Api = require('../src/Api');
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  global.registryService_getWellRecord.mockReturnValue({ found: true, record: { wellId: POZO } });
  global.registryService_getWellLocation.mockReturnValue({ found: true, location: { lat: -32.8, lon: -68.7 } });
  global.nivelesEstaticosService_getPunto.mockReturnValue({ found: true, punto: { id: POZO } });
  global.profileService_checkDisponibilidad.mockReturnValue({ [POZO]: true });
  global.itfService_disponibilidad.mockReturnValue({ [POZO]: { estado: 'SI' } });
  global.itfAvailabilityService_checkDisponibilidad.mockReturnValue({ [POZO]: true });
  global.notificationService_notifyWellSearch.mockReturnValue({ sent: true });
  global.searchHistoryService_registerSearch.mockReturnValue({ logged: true });
});

function sesion(email) {
  const token = E.Auth.createSessionToken(email);
  const r = post({ action: 'checkSession', sessionToken: token });
  expect(r.status).toBe('ok');
  return { token: r.data.sessionToken, permisos: r.data.permisos };
}

describe('frontend publicado (pre-E10) + backend E10-1: busqueda de un pozo valido', () => {
  test.each([['interno@x.com'], ['externo@x.com'], ['admin1@x.com']])('%s: las 4 lecturas responden y registerWellSearch registra', (email) => {
    const s = sesion(email);
    // el frontend viejo decide que pedir con ESTOS permisos (permisosActuales = result.data.permisos)
    expect(s.permisos && typeof s.permisos).toBe('object');
    const respuestas = {
      itf: post({ action: 'getItfAvailability', sessionToken: s.token, wellIds: [POZO] }),
      registro: post({ action: 'getWellRecord', sessionToken: s.token, wellId: POZO }),
      ubicacion: post({ action: 'getWellLocation', sessionToken: s.token, wellId: POZO }),
      ne: post({ action: 'getMonitoringPoint', sessionToken: s.token, monitoringId: POZO })
    };
    Object.keys(respuestas).forEach((k) => expect(['ok', 'error']).toContain(respuestas[k].status));
    expect(respuestas.itf.status).toBe('ok');
    expect(respuestas.registro.status).toBe('ok');
    expect(respuestas.ubicacion.status).toBe('ok');
    const reg = post({ action: 'registerWellSearch', sessionToken: s.token, wellId: POZO, modulos: { perfil: true, datos: true, ubicacion: true, ne: true } });
    expect(reg).toEqual({ status: 'ok' });
    expect(global.searchHistoryService_registerSearch).toHaveBeenCalledTimes(1);
  });
});
