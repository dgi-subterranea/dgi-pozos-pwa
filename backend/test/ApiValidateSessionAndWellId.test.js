const { installAppsScriptFakes } = require('./appsScriptFakes');
const Api = require('../src/Api');

// Regresion de validateSessionAndWellId (la validacion de sesion + formato de wellId que comparten TODOS los endpoints con wellId).
// Cambio auditado: ahora exige typeof wellId === 'string' ANTES del regex. Antes un arreglo ['14-0001'] pasaba el regex (se convertia a texto),
// seguia de largo y rompia mas abajo con un TypeError cuyo mensaje se devolvia al cliente. Contrato que fija este archivo:
//   - un wellId string y valido sigue funcionando EXACTAMENTE igual en cada endpoint que lo usa;
//   - un string invalido sigue dando INVALID_WELL_ID con el mismo mensaje de siempre;
//   - cualquier cosa que no sea string (arreglo, numero, null, undefined, objeto, booleano, funcion...) da INVALID_WELL_ID y NUNCA llega a un servicio;
//   - ningun texto interno (TypeError, stack, nombres de hoja) llega al cliente.

beforeEach(() => {
  installAppsScriptFakes();
  global.verifySessionToken.mockReturnValue({ valid: true, email: 'u@example.com' });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockReturnValue(true);
  global.getUserAccess.mockReturnValue({ nombre: 'Ana' });
  global.registryService_getWellLocation.mockReturnValue({ found: true, location: {} });
  global.registryService_getWellRecord.mockReturnValue({ found: true, record: {} });
  global.registryService_getWellSummary.mockReturnValue({ found: true, summary: {} });
  global.profileService_getProfile.mockReturnValue({ found: true, blob: { getBytes: () => [1], getContentType: () => 'image/jpeg' } });
  global.reemplazoService_getEstado.mockReturnValue({ wellId: '04-0263', estado: 'SIN_EVALUAR', ultimaEvaluacion: null });
  global.reemplazoService_getHistorial.mockReturnValue({ wellId: '04-0263', evaluaciones: [] });
  global.ubicacionCorreccionService_getPorPozo.mockReturnValue({ ok: true, data: { wellId: '04-0263' } });
  global.fotosPozosService_listar.mockReturnValue({ ok: true, entidad: '04-0263', total: 0, fotos: [] });
  // servicios de escritura: con un wellId valido el handler llega hasta aca; devuelven un rechazo de negocio cualquiera (lo que importa es que NO sea INVALID_WELL_ID)
  const rechazo = { ok: false, code: 'RECHAZO_DE_NEGOCIO', message: 'rechazado' };
  global.reemplazoService_registrar.mockReturnValue(rechazo);
  global.ubicacionCorreccionService_proponer.mockReturnValue(rechazo);
  global.ubicacionFuenteDecisionesService_decidir.mockReturnValue(rechazo);
  global.fotosService_subir.mockReturnValue(rechazo);
});

const VALIDO = '04-0263';

// cada endpoint que pasa por validateSessionAndWellId; "ir" arma la llamada con el wellId a probar
const endpoints = {
  getProfile: (w) => Api.handleGetProfile('t', w),
  getWellRecord: (w) => Api.handleGetWellRecord('t', w),
  getWellLocation: (w) => Api.handleGetWellLocation('t', w),
  registerWellSearch: (w) => Api.handleRegisterWellSearch('t', w, ['datos']),
  getWellSummary: (w) => Api.handleGetWellSummary('t', w),
  getEstadoReemplazo: (w) => Api.handleGetEstadoReemplazo('t', w),
  getHistorialReemplazo: (w) => Api.handleGetHistorialReemplazo('t', w),
  registrarEvaluacionReemplazo: (w) => Api.handleRegistrarEvaluacionReemplazo('t', w, 'EVALUADO', 'motivo', '', null),
  proponerCorreccionUbicacion: (w) => Api.handleProponerCorreccionUbicacion('t', { wellId: w }),
  getCorreccionesUbicacionPozo: (w) => Api.handleGetCorreccionesUbicacionPozo('t', w),
  getDecisionesFuentesPozo: (w) => Api.handleGetDecisionesFuentesPozo('t', w),
  decidirFuenteUbicacion: (w) => Api.handleDecidirFuenteUbicacion('t', { wellId: w, accion: 'ACEPTAR' })
};

// valores que NO son un wellId bien formado. "enTexto" = como se veria si se convirtiera a texto (el caso peligroso: pasaba el regex)
const NO_STRING = [
  ['arreglo con un wellId valido', [VALIDO]],
  ['arreglo vacio', []],
  ['arreglo anidado', [[VALIDO]]],
  ['numero', 140263],
  ['numero 0', 0],
  ['NaN', NaN],
  ['null', null],
  ['undefined', undefined],
  ['objeto vacio', {}],
  ['objeto con toString que devuelve un wellId valido', { toString: () => VALIDO }],
  ['objeto con valueOf que devuelve un wellId valido', { valueOf: () => VALIDO }],
  ['boolean true', true],
  ['boolean false', false],
  ['funcion', () => VALIDO],
  ['Date', new Date(0)],
  ['String boxeado (new String)', new String(VALIDO)] // eslint-disable-line no-new-wrappers
];

const STRING_INVALIDO = [
  ['vacio', ''],
  ['sin guion', '040263'],
  ['letras', 'ab-cdef'],
  ['demasiado corto', '4-0263'],
  ['demasiado largo', '004-0263'],
  ['con espacios', ' 04-0263'],
  ['con salto de linea final', '04-0263\n'],
  ['con sufijo', '04-0263x'],
  ['departamento 00', '00-0263'],
  ['departamento 20', '20-0263'],
  ['departamento 99', '99-0263']
];

const TEXTOS_INTERNOS = /TypeError|ReferenceError|RangeError|Cannot read|is not a function|undefined is not|\bat \w+.*\(|Exception|stack|hoja|sheet|Spreadsheet/i;

function serviciosDeNegocio() {
  return [
    global.registryService_getWellLocation, global.registryService_getWellRecord, global.registryService_getWellSummary,
    global.profileService_getProfile, global.reemplazoService_getEstado, global.reemplazoService_getHistorial, global.reemplazoService_registrar,
    global.ubicacionCorreccionService_proponer, global.ubicacionCorreccionService_getPorPozo,
    global.ubicacionFuenteDecisionesService_getPorPozo, global.ubicacionFuenteDecisionesService_decidir, global.fotosService_subir
  ];
}

describe('validateSessionAndWellId directo: sesion -> formato -> departamento', () => {
  test('string valido: ok y devuelve la sesion', () => {
    const r = Api.validateSessionAndWellId('t', VALIDO, 'accionX');
    expect(r.ok).toBe(true);
    expect(r.session.email).toBe('u@example.com');
  });

  test.each(['01-0001', '19-9999', '10-0000'])('limites validos del departamento (%s)', (w) => {
    expect(Api.validateSessionAndWellId('t', w, 'accionX').ok).toBe(true);
  });

  test.each(STRING_INVALIDO)('string invalido (%s): INVALID_WELL_ID, mensaje de siempre y auditoria con el wellId recibido', (_n, w) => {
    const r = Api.validateSessionAndWellId('t', w, 'accionX');
    expect(r.ok).toBe(false);
    expect(r.response.status).toBe('error');
    expect(r.response.code).toBe('INVALID_WELL_ID');
    expect(r.response.message).toMatch(/^(formato invalido|departamento fuera de rango): /);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@example.com', 'accionX', w, 'INVALID_WELL_ID');
  });

  test.each(NO_STRING)('no es string (%s): INVALID_WELL_ID sin filtrar nada interno', (_n, w) => {
    const r = Api.validateSessionAndWellId('t', w, 'accionX');
    expect(r.ok).toBe(false);
    expect(r.response).toEqual({ status: 'error', code: 'INVALID_WELL_ID', message: expect.any(String) });
    expect(r.response.message).not.toMatch(TEXTOS_INTERNOS);
    expect(r.response.message.length).toBeLessThan(60);
    // lo que mando el cliente no se vuelca al mensaje ni a Historial: solo su tipo en el mensaje y null en la auditoria
    expect(r.response.message).toBe('formato invalido: ' + typeof w);
    expect(global.logHistoryEvent).toHaveBeenCalledWith('u@example.com', 'accionX', null, 'INVALID_WELL_ID');
  });

  test('con la sesion invalida responde UNAUTHORIZED ANTES de mirar el wellId (cualquier tipo)', () => {
    global.verifySessionToken.mockReturnValue({ valid: false, reason: 'expirado' });
    [VALIDO, 'x', [VALIDO], null, undefined, {}].forEach((w) => {
      const r = Api.validateSessionAndWellId('t', w, 'accionX');
      expect(r.ok).toBe(false);
      expect(r.response.code).toBe('UNAUTHORIZED');
    });
    expect(global.logHistoryEvent).not.toHaveBeenCalled();
  });

  test('con el usuario inactivo responde USER_DISABLED ANTES de mirar el wellId', () => {
    global.isUserActive.mockReturnValue(false);
    [VALIDO, 'x', [VALIDO], null, {}].forEach((w) => {
      expect(Api.validateSessionAndWellId('t', w, 'accionX').response.code).toBe('USER_DISABLED');
    });
  });
});

describe.each(Object.keys(endpoints))('%s', (nombre) => {
  const ir = endpoints[nombre];

  test('wellId string valido: no se rechaza por el formato (el comportamiento de siempre)', () => {
    const r = ir(VALIDO);
    expect(r.code).not.toBe('INVALID_WELL_ID');
  });

  test.each(STRING_INVALIDO)('string invalido (%s): INVALID_WELL_ID y ningun servicio de negocio se invoca', (_n, w) => {
    const r = ir(w);
    expect(r.status).toBe('error');
    expect(r.code).toBe('INVALID_WELL_ID');
    serviciosDeNegocio().forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  test.each(NO_STRING)('no es string (%s): INVALID_WELL_ID, sin TypeError ni textos internos y ningun servicio se invoca', (_n, w) => {
    const r = ir(w);
    expect(r.status).toBe('error');
    expect(r.code).toBe('INVALID_WELL_ID');
    expect(JSON.stringify(r)).not.toMatch(TEXTOS_INTERNOS);
    serviciosDeNegocio().forEach((s) => expect(s).not.toHaveBeenCalled());
  });

  test('el wellId invalido se rechaza ANTES del permiso: un usuario sin permisos recibe INVALID_WELL_ID, no PERMISSION_DENIED (orden de siempre)', () => {
    global.hasPermission.mockReturnValue(false);
    expect(ir([VALIDO]).code).toBe('INVALID_WELL_ID');
    expect(ir('x').code).toBe('INVALID_WELL_ID');
    // registerWellSearch no exige permiso de modulo (solo usuario activo): no tiene PERMISSION_DENIED que comparar
    if (nombre !== 'registerWellSearch') {
      expect(ir(VALIDO).code).toBe('PERMISSION_DENIED');
    }
  });
});

describe('endpoints de fotos de reemplazo (validarSesionPermisoFotos)', () => {
  // getFotosReemplazoPozo y subirFotoReemplazo reciben wellId y pasan por validateSessionAndWellId (wellId === undefined = "sin pozo", solo en los que lo permiten)
  const fotos = {
    getFotosReemplazoPozo: (w) => Api.handleGetFotosReemplazoPozo('t', w),
    subirFotoReemplazo: (w) => Api.handleSubirFotoReemplazo('t', w, 'ev', 'a.jpg', 'image/jpeg', 'AAAA', 'AAAA')
  };

  describe.each(Object.keys(fotos))('%s', (nombre) => {
    test.each([['arreglo', [VALIDO]], ['numero', 4], ['objeto', {}], ['null', null], ['boolean', true], ['string invalido', '99-0001'], ['string mal formado', 'x']])('wellId %s: INVALID_WELL_ID sin textos internos', (_n, w) => {
      const r = fotos[nombre](w);
      expect(r.status).toBe('error');
      expect(r.code).toBe('INVALID_WELL_ID');
      expect(JSON.stringify(r)).not.toMatch(TEXTOS_INTERNOS);
    });

    test('wellId string valido: no se rechaza por el formato', () => {
      expect(fotos[nombre](VALIDO).code).not.toBe('INVALID_WELL_ID');
    });
  });
});

describe('doPost: el wellId manipulado llega como JSON y no rompe nada', () => {
  function post(body) {
    const salida = Api.doPost({ postData: { contents: JSON.stringify(body) } });
    return JSON.parse(salida.content || salida.getContent());
  }

  beforeEach(() => {
    global.ContentService = {
      MimeType: { JSON: 'json' },
      createTextOutput: (s) => ({ content: s, setMimeType() { return this; }, getContent() { return s; } })
    };
  });

  test.each([
    ['getProfile'], ['getWellRecord'], ['getWellLocation'], ['getWellSummary'], ['getEstadoReemplazo'],
    ['getCorreccionesUbicacionPozo'], ['getDecisionesFuentesPozo']
  ])('%s con wellId arreglo / objeto / numero / null: INVALID_WELL_ID', (action) => {
    [[VALIDO], { a: 1 }, 140263, null].forEach((w) => {
      const r = post({ action, sessionToken: 't', wellId: w });
      expect(r.status).toBe('error');
      expect(r.code).toBe('INVALID_WELL_ID');
      expect(JSON.stringify(r)).not.toMatch(TEXTOS_INTERNOS);
    });
  });

  test('wellId ausente en el JSON (undefined): INVALID_WELL_ID', () => {
    expect(post({ action: 'getWellRecord', sessionToken: 't' }).code).toBe('INVALID_WELL_ID');
  });
});
