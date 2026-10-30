// E9-7 (pre-rollout), matriz de COMPATIBILIDAD de versiones, con el frontend REAL (controladores sobre un DOM falso) hablando con el backend REAL (Api -> servicios -> hoja / Drive / storage en memoria):
//   A. frontend NUEVO + backend con el interruptor APAGADO (el estado de la propagacion): el Perfil sigue funcionando como siempre y E9 no toca ni la hoja ni el storage.
//   B. hoja ItfEventos VACIA con el interruptor encendido: identico al legacy.
//   C. columnas perfil_subir / perfil_validar AUSENTES en Usuarios: permisos false.
//   D. backend NUEVO + frontend VIEJO: las respuestas de getProfile / getItfAvailability no cambian de forma.
//   E. storage SIN configurar con el interruptor encendido: proponer jamas queda habilitado.
//   F. apagar el interruptor (rollback) con eventos ya escritos: no se borra nada y el Perfil vuelve al legacy.
// Nada toca Google.
const { crearEntorno, JPEG } = require('./itfEntorno');
const { instalarSheetsFalsos } = require('./fakeSheets');
const front = require('../../js/fixtures/domFalsoItf');

const PROPONENTE = 'ana.proponente@example.com';
const VALIDADOR = 'val.validador@example.com';
const SOLO = 'solo.perfil@example.com';
const AMBOS = 'carla.ambos@example.com';
const W = '14-0001';
const W2 = '14-0002';
const BYTES_LEGACY = JPEG(300, 5);
const PERMISOS = {
  [SOLO]: { perfil: true },
  [PROPONENTE]: { perfil: true, perfil_subir: true },
  [VALIDADOR]: { perfil: true, perfil_validar: true },
  [AMBOS]: { perfil: true, perfil_subir: true, perfil_validar: true }
};

let E;
let Api;
let almacen;
let llamadasStorage;
let actual;
let n = 0;
const crid = () => { n += 1; return 'compat-req-' + String(n).padStart(8, '0'); };
const b64 = (arr) => Buffer.from(arr.map((v) => v & 0xFF)).toString('base64');

function como(email, permisos) {
  actual = email;
  const p = permisos || PERMISOS[email] || {};
  global.verifySessionToken.mockReturnValue({ valid: true, email: email });
  global.isUserActive.mockReturnValue(true);
  global.hasPermission.mockImplementation((e, modulo) => p[modulo] === true);
  global.getUserAccess.mockReturnValue({ nombre: 'Persona' });
}

function montar(opciones) {
  const o = opciones || {};
  E = crearEntorno({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: o.props === undefined ? {} : o.props, sinHoja: o.sinHoja });
  Api = require('../src/Api');
  almacen = {};
  llamadasStorage = [];
  global.fotosStorageClient_llamar = jest.fn((accion, payload) => {
    llamadasStorage.push(accion);
    if (o.storageSinConfigurar) { throw new Error('FOTOS_STORAGE_URL no configurado en Script Properties'); }
    if (accion === 'putItf') {
      const ref = 'itf-ref-' + String(Object.keys(almacen).length + 1).padStart(6, '0');
      almacen[ref] = payload;
      return { status: 'ok', driveFileId: ref, tamanoBytes: Buffer.from(payload.imagenBase64, 'base64').length };
    }
    if (accion === 'metaItf' || accion === 'getItf') {
      const f = almacen[payload.driveFileId];
      if (!f) { throw new Error('storage devolvio error: NOT_FOUND'); }
      return accion === 'metaItf' ? { status: 'ok', mimeType: f.mimeType, tamanoBytes: Buffer.from(f.imagenBase64, 'base64').length } : { status: 'ok', mimeType: f.mimeType, imagenBase64: f.imagenBase64, tamanoBytes: 1 };
    }
    throw new Error('accion inesperada ' + accion);
  });
  global.registryService_getWellLocation = jest.fn(() => ({ found: true, location: {} }));
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  global.UrlFetchApp = { fetch: jest.fn() };
  como(SOLO);
}

const filas = () => E.hoja.filas.slice(1);

// El frontend REAL: los controladores en un DOM falso; cada api* llama al handler REAL del backend con la sesion actual.
function frontend(permisos) {
  const estado = { permisos: permisos || PERMISOS[actual] };
  const api = {
    apiGetProfile: jest.fn((tok, w) => Promise.resolve(Api.handleGetProfile(tok, w))),
    apiGetItfAvailability: jest.fn((tok, ids) => Promise.resolve(Api.handleGetItfAvailability(tok, ids))),
    apiProponerItf: jest.fn((tok, p) => Promise.resolve(Api.handleProponerItf(tok, Object.assign({ action: 'proponerItf', sessionToken: tok }, p)))),
    apiGetMisPropuestasItf: jest.fn((tok, w, l, c) => Promise.resolve(Api.handleGetMisPropuestasItf(tok, { action: 'getMisPropuestasItf', sessionToken: tok, wellId: w || undefined, limite: l, cursor: c }))),
    apiRetirarPropuestaItf: jest.fn(),
    itfImagen_preparar: jest.fn(() => Promise.resolve({ base64: b64(JPEG(400, 9)), bytes: 400, mimeType: 'image/jpeg', ancho: 100, alto: 100, accion: 'CONSERVADA', previewUrl: 'blob:p' })),
    itfModeracionController_abrirHistorial: jest.fn(),
    itfModeracionController_pedirRetirarVigente: jest.fn()
  };
  const entorno = front.crearEntorno(['itfLogic.js', 'itfFlujosLogic.js', 'itfPerfil.js'], api);
  entorno.ctx.itfPerfilController_inicializar(() => ({ sessionToken: 't', permisos: estado.permisos, onSessionExpired: () => {} }), { esIOS: () => false });
  return Object.assign(entorno, { api, c: entorno.ctx });
}

function frontendModeracion(permisos) {
  const api = {
    apiGetItfPendientes: jest.fn((tok, l, c) => Promise.resolve(Api.handleGetItfPendientes(tok, { action: 'getItfPendientes', sessionToken: tok, limite: l, cursor: c }))),
    apiGetItfDocumentoModeracion: jest.fn(), apiGetHistorialItf: jest.fn(), apiAprobarItf: jest.fn(), apiRechazarItf: jest.fn(), apiRetirarItf: jest.fn(), apiRevertirItf: jest.fn()
  };
  const entorno = front.crearEntorno(['itfLogic.js', 'itfFlujosLogic.js', 'itfModeracion.js'], api);
  entorno.ctx.itfModeracionController_inicializar(() => ({ sessionToken: 't', permisos: permisos, onSessionExpired: () => {} }), { onVerPozo: () => {}, onCambioDeVigente: () => {} });
  return Object.assign(entorno, { api, c: entorno.ctx });
}

describe('A. frontend NUEVO + backend con el interruptor APAGADO (propagacion)', () => {
  test('quien solo tiene perfil: availability al buscar, getProfile al abrir y la imagen legacy de siempre; NADA colaborativo; ni la hoja ni el storage se tocan', async () => {
    montar();
    const leer = jest.spyOn(global, 'itfEventosRepository_leerTodos');
    como(SOLO);
    expect(Api.handleGetItfAvailability('t', [W, W2]).data).toEqual({ [W]: true, [W2]: false });         // lo que hace el hub al buscar
    const f = frontend();
    f.c.itfPerfilController_abrir(W);
    await front.flush();
    expect(f.el['perfil-vigente'].hidden).toBe(false);
    expect(f.el['perfil-imagen'].getAttribute('src')).toBe('data:image/jpeg;base64,' + b64(BYTES_LEGACY));
    expect(f.el['itf-colab'].hidden).toBe(true);
    expect(leer).not.toHaveBeenCalled();
    expect(llamadasStorage).toEqual([]);
    expect(filas()).toHaveLength(0);
  });

  test('un pozo sin ITF: el mensaje de siempre ("No hay un ITF vigente registrado para este pozo.")', async () => {
    montar();
    como(SOLO);
    const f = frontend();
    f.c.itfPerfilController_abrir(W2);
    await front.flush();
    expect(f.el['perfil-aviso-texto'].textContent).toBe('No hay un ITF vigente registrado para este pozo.');
  });

  test('permisos E9 dados por adelantado (con el interruptor apagado): el Perfil funciona, proponer responde "todavía no están habilitadas" y NO escribe ni toca el storage', async () => {
    montar();
    como(AMBOS);
    const f = frontend();
    f.c.itfPerfilController_abrir(W);
    await front.flush();
    expect(f.el['perfil-vigente'].hidden).toBe(false);
    f.el['btn-itf-proponer'].click();
    f.el['itf-archivo-input'].files = [{ type: 'image/jpeg', size: 400, name: 'itf.jpg' }];
    f.el['itf-archivo-input'].emitir('change');
    await front.flush();
    f.el['btn-itf-prop-enviar'].click();
    await front.flush();
    expect(f.el['itf-prop-mensaje'].textContent).toBe('La propuesta y validación de ITF todavía no están habilitadas.');
    expect(filas()).toHaveLength(0);
    expect(llamadasStorage).toEqual([]);
    // Mis propuestas y la cola tambien responden con el mensaje, sin romper nada
    f.el['btn-itf-mis-propuestas'].click();
    await front.flush();
    expect(f.el['itf-mis-error-texto'].textContent).toBe('La propuesta y validación de ITF todavía no están habilitadas.');
    const m = frontendModeracion(PERMISOS[AMBOS]);
    m.c.itfModeracionController_abrir();
    await front.flush();
    expect(m.el['itf-cola-error-texto'].textContent).toBe('La propuesta y validación de ITF todavía no están habilitadas.');
    expect(filas()).toHaveLength(0);
    expect(llamadasStorage).toEqual([]);
  });

  test('con el interruptor en "NO", "no" o cualquier valor que no sea exactamente SI: apagado', () => {
    ['NO', 'no', '', 'true', '1', 'Si', ' SI', 'SI '].forEach((v) => {
      montar({ props: { ITF_E9_ACTIVO: v } });
      como(AMBOS);
      expect(Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' }).code).toBe('ITF_E9_INACTIVO');
      expect(Api.handleProponerItf('t', { action: 'proponerItf', sessionToken: 't', wellId: W, imageBase64: b64(JPEG(300, 1)), mimeType: 'image/jpeg', clientRequestId: crid() }).code).toBe('ITF_E9_INACTIVO');
      expect(filas()).toHaveLength(0);
      expect(llamadasStorage).toEqual([]);
    });
  });
});

describe('B. hoja ItfEventos VACIA con el interruptor encendido', () => {
  test('availability, getProfile, cola y Mis propuestas = legacy / vacios', () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' } });
    como(SOLO);
    const encendido = { disp: Api.handleGetItfAvailability('t', [W, W2]), perfil: Api.handleGetProfile('t', W), sin: Api.handleGetProfile('t', W2) };
    E.props.ITF_E9_ACTIVO = 'NO';
    const apagado = { disp: Api.handleGetItfAvailability('t', [W, W2]), perfil: Api.handleGetProfile('t', W), sin: Api.handleGetProfile('t', W2) };
    expect(encendido.disp).toEqual(apagado.disp);
    expect(encendido.perfil.data).toMatchObject({ wellId: W, mimeType: 'image/jpeg', imageBase64: apagado.perfil.data.imageBase64, originalSizeBytes: apagado.perfil.data.originalSizeBytes });
    expect(encendido.sin).toMatchObject({ status: 'error', code: 'PROFILE_NOT_FOUND' });
    E.props.ITF_E9_ACTIVO = 'SI';
    como(VALIDADOR);
    expect(Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' }).data).toEqual({ items: [], siguienteCursor: null, total: 0, pozosSinDerivar: 0 });
    como(PROPONENTE);
    expect(Api.handleGetMisPropuestasItf('t', { action: 'getMisPropuestasItf', sessionToken: 't' }).data).toEqual({ items: [], siguienteCursor: null, total: 0, incompleta: false });
    expect(filas()).toHaveLength(0);
  });

  test('la hoja ItfEventos AUSENTE con el interruptor encendido NO cae al legacy (SERVICE_UNAVAILABLE): por eso el preflight exige la hoja ANTES de encender', () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' }, sinHoja: true });
    como(SOLO);
    expect(Api.handleGetProfile('t', W)).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(Api.handleGetItfAvailability('t', [W])).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
  });
});

describe('C. columnas perfil_subir / perfil_validar AUSENTES en Usuarios', () => {
  test('con la hoja Usuarios REAL (repositorio real): sin las columnas nadie tiene esos permisos aunque tenga perfil = SI', () => {
    montar();
    const sheets = instalarSheetsFalsos({ Usuarios: [['email', 'nombre', 'estado', 'perfil', 'datos'], ['ana@example.com', 'Ana', 'activo', 'SI', 'SI']] });
    expect(sheets.Usuarios).toBeTruthy();
    const u = require('../src/SheetUserRepository').sheetUserRepository_getUserStatus('ana@example.com');
    expect(u.active).toBe(true);
    expect(u.permisos).toMatchObject({ perfil: true, datos: true, perfil_subir: false, perfil_validar: false });
  });

  test('esos permisos (false) hacen que el frontend NO ofrezca nada colaborativo y el backend responda PERMISSION_DENIED aunque el interruptor este encendido', async () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' } });
    como(SOLO);
    for (const f of [() => Api.handleProponerItf('t', { action: 'proponerItf', sessionToken: 't', wellId: W, imageBase64: b64(JPEG(300, 1)), mimeType: 'image/jpeg', clientRequestId: crid() }),
      () => Api.handleGetMisPropuestasItf('t', { action: 'getMisPropuestasItf', sessionToken: 't' }), () => Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' })]) {
      expect(f().code).toBe('PERMISSION_DENIED');
    }
    const fe = frontend({ perfil: true, perfil_subir: false, perfil_validar: false });
    fe.c.itfPerfilController_abrir(W);
    await front.flush();
    expect(fe.el['itf-colab'].hidden).toBe(true);
  });
});

describe('D. backend NUEVO + frontend VIEJO', () => {
  const CLAVES_GETPROFILE = ['base64SizeBytes', 'elapsedMsEnDrive', 'imageBase64', 'mimeType', 'originalSizeBytes', 'wellId'];
  test.each([['apagado', {}], ['encendido', { ITF_E9_ACTIVO: 'SI' }]])('interruptor %s: getProfile y getItfAvailability conservan EXACTAMENTE su forma (el frontend viejo no se entera)', (_n, props) => {
    montar({ props });
    como(SOLO);
    const perfil = Api.handleGetProfile('t', W);
    expect(perfil.status).toBe('ok');
    expect(Object.keys(perfil.data).sort()).toEqual(CLAVES_GETPROFILE);
    const disp = Api.handleGetItfAvailability('t', [W, W2]);
    expect(Object.keys(disp)).toEqual(['status', 'data']);
    Object.values(disp.data).forEach((v) => expect(typeof v).toBe('boolean'));
    expect(Api.handleGetProfile('t', W2)).toEqual({ status: 'error', code: 'PROFILE_NOT_FOUND', message: expect.any(String) });
    expect(JSON.stringify([perfil, disp])).not.toMatch(/LEGACY|origen|storageFileId|itf-ref/);
  });

  test('las acciones nuevas son rutas nuevas: un frontend viejo no las llama y ninguna ruta vieja cambio de nombre', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '../src/Api.js'), 'utf8');
    ['getProfile', 'getItfAvailability', 'registerDescargaItf', 'registerWellSearch', 'getWellRecord', 'getWellLocation', 'getMonitoringPoint'].forEach((a) => expect(fuente).toContain("body.action === '" + a + "'"));
  });
});

describe('E. storage SIN configurar con el interruptor encendido', () => {
  test('proponer jamas queda habilitado: ITF_STORAGE_NO_CONFIGURADO, ninguna fila escrita, ningun archivo', () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' }, storageSinConfigurar: true });
    como(PROPONENTE);
    const r = Api.handleProponerItf('t', { action: 'proponerItf', sessionToken: 't', wellId: W, imageBase64: b64(JPEG(400, 1)), mimeType: 'image/jpeg', nombreOriginal: 'a.jpg', clientRequestId: crid() });
    expect(r).toMatchObject({ status: 'error', code: 'ITF_STORAGE_NO_CONFIGURADO' });
    expect(filas()).toHaveLength(0);
    expect(Object.keys(almacen)).toHaveLength(0);
  });

  test('un storage sin las acciones de ITF (version vieja: UNKNOWN_ACTION) tambien es "no configurado"', () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' } });
    global.fotosStorageClient_llamar = jest.fn(() => { throw new Error('storage devolvio error: UNKNOWN_ACTION'); });
    como(PROPONENTE);
    const r = Api.handleProponerItf('t', { action: 'proponerItf', sessionToken: 't', wellId: W, imageBase64: b64(JPEG(400, 1)), mimeType: 'image/jpeg', nombreOriginal: 'a.jpg', clientRequestId: crid() });
    expect(r.code).toBe('ITF_STORAGE_NO_CONFIGURADO');
    expect(filas()).toHaveLength(0);
  });
});

describe('F. rollback: apagar el interruptor con eventos ya escritos', () => {
  test('no se borra ningun evento ni documento; el Perfil vuelve al ITF legacy; las acciones de E9 vuelven a ITF_E9_INACTIVO; al volver a encender todo reaparece', () => {
    montar({ props: { ITF_E9_ACTIVO: 'SI' } });
    como(PROPONENTE);
    const p = Api.handleProponerItf('t', { action: 'proponerItf', sessionToken: 't', wellId: W, imageBase64: b64(JPEG(500, 7)), mimeType: 'image/jpeg', nombreOriginal: 'nuevo.jpg', clientRequestId: crid() });
    expect(p.status).toBe('ok');
    como(VALIDADOR);
    expect(Api.handleAprobarItf('t', { action: 'aprobarItf', sessionToken: 't', documentoId: p.data.documentoId, vigenteEsperadoDocumentoId: 'LEGACY:' + W, motivoCodigo: 'ACTUALIZACION', clientRequestId: crid() }).status).toBe('ok');
    como(SOLO);
    expect(Api.handleGetProfile('t', W).data.originalSizeBytes).toBe(500);                 // el vigente institucional (E9)
    const antes = JSON.stringify(E.hoja.filas);
    const docsAntes = Object.keys(almacen).length;
    E.props.ITF_E9_ACTIVO = 'NO';                                                          // ROLLBACK
    expect(Api.handleGetProfile('t', W).data.originalSizeBytes).toBe(BYTES_LEGACY.length); // el archivo legacy de siempre
    como(VALIDADOR);
    expect(Api.handleGetItfPendientes('t', { action: 'getItfPendientes', sessionToken: 't' }).code).toBe('ITF_E9_INACTIVO');
    expect(JSON.stringify(E.hoja.filas)).toBe(antes);
    expect(Object.keys(almacen)).toHaveLength(docsAntes);
    E.props.ITF_E9_ACTIVO = 'SI';
    como(SOLO);
    expect(Api.handleGetProfile('t', W).data.originalSizeBytes).toBe(500);
  });
});
