// CONTRATO frontend <-> backend de la VALIDACION de correcciones de ubicacion (bandeja, detalle, Validar / Rechazar), contra el codigo REAL de hoy: el frontend
// (js/api.js ejecutado de verdad + js/ubicacionCorreccionLogic.js: bandeja, detalle, flujo de resolucion) habla con Api.doPost -> servicio -> repositorio sobre hojas
// en memoria. NO hay endpoints nuevos: se reutilizan getCorreccionesUbicacionPendientes / getCorreccionesUbicacionPozo / validarCorreccionUbicacion /
// rechazarCorreccionUbicacion. Si un campo, una accion, un permiso o un codigo cambia de un lado y no del otro, falla aca.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const F = require('../../js/ubicacionCorreccionLogic');

const raiz = path.join(__dirname, '..', '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const apiFrontend = leer('js', 'api.js');
const fuenteApi = leer('backend', 'src', 'Api.js');

const W = '14-0001';
const OFICIAL = { estado: 'unica', fuente: 'reportePozos', lat: -33.34765, lon: -69.14545 };
const norte = (grados) => OFICIAL.lat + grados;
const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'carla@x.com': { nombre: 'Carla', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { ubicacion: true } },
  'val@x.com': { nombre: 'Valeria', permisos: { ubicacion: true, ubicacion_validar: true } },
  'vero@x.com': { nombre: 'Vero', permisos: { ubicacion: true, ubicacion_validar: true } }
};

let Api;
let ctxFrontend;
let hojas;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  const Repo = require('../src/UbicacionCorreccionRepository');
  const Service = require('../src/UbicacionCorreccionService');
  Object.assign(global, Repo, Service);
  hojas = instalarSheetsFalsos({ UbicacionCorrecciones: [Repo.UBICACION_CORRECCIONES_COLUMNAS], UbicacionCorreccionesLog: [Repo.UBICACION_CORRECCIONES_LOG_COLUMNAS] });
  global.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
  global.registryService_getWellLocation = jest.fn((id) => (id === W ? { found: true, location: { wellId: id, ubicacionResuelta: OFICIAL } } : { found: false }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: { periodo: '2026-09' } }));
  global.logHistoryEvent = jest.fn();
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);
  ctxFrontend = vm.createContext({
    JSON, Object,
    fetch: (url, opciones) => Promise.resolve({ json: () => Promise.resolve(JSON.parse(Api.doPost({ postData: { contents: opciones.body } }).text)) })
  });
  vm.runInContext(apiFrontend, ctxFrontend);
});

let n = 0;
const proponer = (usuario, valores) => {
  n += 1;
  const v = Object.assign({ lat: norte(0.0002), lon: OFICIAL.lon, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '' }, valores || {});
  return ctxFrontend.apiProponerCorreccionUbicacion('tok-' + usuario, F.ubicacionCorreccionLogic_construirPayload(W, v, 'validacion-' + String(n).padStart(8, '0')));
};
// una propuesta que queda PENDIENTE aunque quien la crea tenga permiso de validar (para probar SELF_REJECTION): se le quita el permiso solo mientras propone
async function proponerSinAutoValidar(usuario, valores) {
  const original = USUARIOS[usuario].permisos;
  USUARIOS[usuario].permisos = { ubicacion: true, ubicacion_corregir: true };
  try {
    return await proponer(usuario, valores);
  } finally {
    USUARIOS[usuario].permisos = original;
  }
}
const idDe = (r) => r.data.correccion.correccionId;
const leerPozo = async (usuario) => (await ctxFrontend.apiGetCorreccionesUbicacionPozo('tok-' + usuario, W)).data;
const claves = (o) => Object.keys(o).sort();

// el MISMO flujo que usa la app (bandeja y ficha): permisos del usuario + las dos funciones reales de js/api.js
function flujoDe(usuario, permisos) {
  return F.ubicacionCorreccionLogic_crearFlujoResolucion({
    permisos: () => (permisos === undefined ? (USUARIOS[usuario] ? USUARIOS[usuario].permisos : null) : permisos),
    validar: (id) => ctxFrontend.apiValidarCorreccionUbicacion('tok-' + usuario, id),
    rechazar: (id, motivo) => ctxFrontend.apiRechazarCorreccionUbicacion('tok-' + usuario, id, motivo)
  });
}

describe('bandeja: getCorreccionesUbicacionPendientes real -> resumen y renglones del frontend', () => {
  test('la vista de cada pendiente trae TODO lo que la bandeja y el detalle leen (campos reales del backend)', async () => {
    await proponer('ana@x.com', { observacion: 'Boca corrida', lat: norte(0.003) });
    const r = await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com');
    expect(r.status).toBe('ok');
    const c = r.data.pendientes[0];
    ['correccionId', 'wellId', 'lat', 'lon', 'metodo', 'precisionGpsM', 'coordenadaOriginalTexto', 'crsOriginal', 'observacion', 'nombrePropone', 'timestamp', 'distanciaM',
      'advertenciaDistancia', 'irrigacion', 'estado', 'resolucion', 'propia'].forEach((campo) => expect(Object.keys(c)).toContain(campo));
    expect(c.estado).toBe('PROPUESTA');
    expect(c.propia).toBe(false);
    expect(c.irrigacion).toMatchObject({ lat: OFICIAL.lat, lon: OFICIAL.lon });
    expect(JSON.stringify(r)).not.toMatch(/@/);                                             // ni emails
  });

  test('resumenPendientes y el renglon se arman con una respuesta REAL: pozo, quien propone, metodo, coordenada, distancia y advertencia >250 m', async () => {
    await proponer('ana@x.com', { observacion: 'Boca corrida', lat: norte(0.003) });                   // ~333 m
    const resp = await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com');
    const r = F.ubicacionCorreccionLogic_resumenPendientes(resp);
    expect(r).toMatchObject({ ok: true, total: 1, nota: '' });
    const html = F.ubicacionCorreccionLogic_htmlItemPendiente(r.items[0]);
    expect(html).toContain(W);
    expect(html).toContain('Propuesta por Ana');
    expect(html).toContain('Elegida en mapa');
    expect(html).toContain('Más de 250 m de Irrigación');
    expect(html).toContain('Observación: Boca corrida');
    expect(html).toContain('data-uval-correccion="' + r.items[0].correccionId + '"');
  });

  test('>1 km: el backend marca advertenciaDistancia y el frontend lo muestra como advertencia fuerte', async () => {
    await proponer('ana@x.com', { observacion: 'Lejos', lat: norte(0.012) });
    const r = F.ubicacionCorreccionLogic_resumenPendientes(await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com'));
    expect(r.items[0].advertenciaDistancia).toBe(true);
    expect(F.ubicacionCorreccionLogic_htmlItemPendiente(r.items[0])).toContain('uval-adv-fuerte');
    expect(F.ubicacionCorreccionLogic_htmlDetalleValidacion(r.items[0], { vigenteEstado: 'ok' })).toContain('Verificala con cuidado antes de validarla.');
  });

  test('metodos de coordenadas ingresadas: la bandeja muestra el original y el sistema que entrega el backend', async () => {
    await proponer('ana@x.com', { metodo: 'COORDENADAS_GMS', coordenadaOriginal: { lat: { g: 33, m: 20, s: 51.54, h: 'S' }, lon: { g: 69, m: 8, s: 43.62, h: 'O' } }, lat: -33.3476500, lon: -69.1454500 });
    const r = F.ubicacionCorreccionLogic_resumenPendientes(await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com'));
    if (r.items.length === 1 && r.items[0].metodo === 'COORDENADAS_GMS') {
      const html = F.ubicacionCorreccionLogic_htmlItemPendiente(r.items[0]);
      expect(html).toContain('Coordenadas GMS / WGS84');
      expect(html).toContain('Ingresada:');
    } else {
      // si el payload GMS del contrato cambiara de forma, que falle fuerte: esto debe ser una propuesta GMS pendiente
      expect(r.items).toHaveLength(1);
      expect(r.items[0].metodo).toBe('COORDENADAS_GMS');
    }
  });

  test('quien no valida (corrige o solo lee) recibe PERMISSION_DENIED; el frontend lo traduce sin mostrar codigos', async () => {
    for (const u of ['ana@x.com', 'lector@x.com']) {
      const resp = await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-' + u);
      expect(resp).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(F.ubicacionCorreccionLogic_resumenPendientes(resp).ok).toBe(false);
    }
  });
});

describe('validar: contra el backend real', () => {
  test('validar una propuesta ajena: pasa a ser la vigente, sale de las pendientes y queda en el historial como VALIDADA', async () => {
    const id = idDe(await proponer('ana@x.com'));
    const r = await flujoDe('val@x.com').resolver('validar', { correccionId: id, propia: false });
    expect(r).toMatchObject({ tipo: 'ok', accion: 'validar', mensaje: 'Ubicación validada.' });
    expect(r.correccion.estado).toBe('VALIDADA');
    const lectura = await leerPozo('lector@x.com');
    expect(lectura.vigente.correccionId).toBe(id);
    expect(lectura.pendientes).toEqual([]);
    expect(lectura.historial.find((c) => c.correccionId === id).estado).toBe('VALIDADA');
    expect(lectura.vigente.resolucion).toMatchObject({ evento: 'VALIDADA', nombre: 'Valeria' });
  });

  test('con una vigente previa: la anterior queda SUPERADA (supersedidas) y la nueva es la vigente; Irrigacion NO cambia', async () => {
    const previa = idDe(await proponer('carla@x.com'));
    const nueva = idDe(await proponer('ana@x.com', { lat: norte(0.0004) }));
    const r = await flujoDe('val@x.com').resolver('validar', { correccionId: nueva });
    expect(r.tipo).toBe('ok');
    expect(r.supersedidas).toEqual([previa]);
    const lectura = await leerPozo('lector@x.com');
    expect(lectura.vigente.correccionId).toBe(nueva);
    expect(lectura.historial.find((c) => c.correccionId === previa).estado).toBe('SUPERADA');
    expect(lectura.vigente.irrigacion).toMatchObject({ lat: OFICIAL.lat, lon: OFICIAL.lon });
    expect(global.registryService_getWellLocation(W).location.ubicacionResuelta).toEqual(OFICIAL);
  });

  test('validar la PROPIA propuesta esta permitido (quien propone y valida); el flujo del frontend no lo bloquea', async () => {
    const id = idDe(await proponerSinAutoValidar('carla@x.com'));
    expect((await flujoDe('carla@x.com').resolver('validar', { correccionId: id, propia: true })).tipo).toBe('ok');
  });

  test('validar dos veces la misma (otro validador ya la resolvio): INVALID_TRANSITION -> "Esta corrección ya fue resuelta."', async () => {
    const id = idDe(await proponer('ana@x.com'));
    expect((await flujoDe('val@x.com').resolver('validar', { correccionId: id })).tipo).toBe('ok');
    expect(await flujoDe('vero@x.com').resolver('validar', { correccionId: id })).toEqual({ tipo: 'resuelta', mensaje: 'Esta corrección ya fue resuelta.' });
    expect(await flujoDe('vero@x.com').resolver('rechazar', { correccionId: id }, 'tarde')).toEqual({ tipo: 'resuelta', mensaje: 'Esta corrección ya fue resuelta.' });
  });

  test('id inexistente: CORRECCION_NOT_FOUND tambien es "ya resuelta" para el usuario', async () => {
    expect((await flujoDe('val@x.com').resolver('validar', { correccionId: '00000000-0000-4000-8000-000000000000' })).tipo).toBe('resuelta');
  });

  test('sin permiso de validar (el backend es la autoridad): PERMISSION_DENIED aunque el frontend se saltee el chequeo, y la propuesta sigue pendiente', async () => {
    const id = idDe(await proponer('ana@x.com'));
    for (const u of ['ana@x.com', 'lector@x.com']) {
      expect(await ctxFrontend.apiValidarCorreccionUbicacion('tok-' + u, id)).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
      expect(await ctxFrontend.apiRechazarCorreccionUbicacion('tok-' + u, id, 'x')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    }
    expect((await leerPozo('lector@x.com')).pendientes.map((c) => c.correccionId)).toEqual([id]);
  });

  test('FAIL-CLOSED en el frontend: con permisos incompletos el flujo no llega ni a llamar al backend (la propuesta sigue intacta)', async () => {
    const id = idDe(await proponer('ana@x.com'));
    for (const permisos of [null, { ubicacion: true }, { ubicacion_validar: true }, { ubicacion: true, ubicacion_corregir: true }]) {
      expect((await flujoDe('val@x.com', permisos).resolver('validar', { correccionId: id })).tipo).toBe('sin_permiso');
    }
    expect((await leerPozo('val@x.com')).pendientes).toHaveLength(1);
  });

  test('sesion vencida: UNAUTHORIZED -> tipo sesion', async () => {
    const id = idDe(await proponer('ana@x.com'));
    const flujo = F.ubicacionCorreccionLogic_crearFlujoResolucion({
      permisos: () => USUARIOS['val@x.com'].permisos,
      validar: (i) => ctxFrontend.apiValidarCorreccionUbicacion('tok-fantasma@x.com', i),
      rechazar: (i, m) => ctxFrontend.apiRechazarCorreccionUbicacion('tok-fantasma@x.com', i, m)
    });
    expect(await flujo.resolver('validar', { correccionId: id })).toEqual({ tipo: 'sesion', code: 'UNAUTHORIZED' });
  });

  test('doble toque: una sola validacion en el backend (un unico evento VALIDADA en el log)', async () => {
    const id = idDe(await proponer('ana@x.com'));
    const flujo = flujoDe('val@x.com');
    const [a, b] = [flujo.resolver('validar', { correccionId: id }), flujo.resolver('validar', { correccionId: id })];
    expect(a).toBe(b);
    expect((await a).tipo).toBe('ok');
    const lectura = await leerPozo('val@x.com');
    expect(lectura.historial.filter((c) => c.estado === 'VALIDADA')).toHaveLength(1);
  });

  test('la correccion directa de quien corrige y valida (auto-validacion) NO cambia: sigue naciendo VALIDADA, sin pasar por la bandeja', async () => {
    const r = await proponer('carla@x.com');
    expect(r.data.autoValidada).toBe(true);
    expect(r.data.correccion.estado).toBe('VALIDADA');
    const pend = F.ubicacionCorreccionLogic_resumenPendientes(await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com'));
    expect(pend).toMatchObject({ ok: true, total: 0, items: [] });
  });
});

describe('rechazar: contra el backend real', () => {
  test('rechazar con motivo: sale de las pendientes, queda RECHAZADA con su motivo y NUNCA es la vigente (la anterior sigue vigente)', async () => {
    const vigente = idDe(await proponer('carla@x.com'));
    const id = idDe(await proponer('ana@x.com', { lat: norte(0.0004) }));
    const r = await flujoDe('val@x.com').resolver('rechazar', { correccionId: id, propia: false }, '  No coincide con la boca  ');
    expect(r).toMatchObject({ tipo: 'ok', accion: 'rechazar', mensaje: 'Corrección rechazada.' });
    expect(r.correccion.estado).toBe('RECHAZADA');
    const lectura = await leerPozo('lector@x.com');
    expect(lectura.vigente.correccionId).toBe(vigente);
    expect(lectura.pendientes).toEqual([]);
    const rechazada = lectura.historial.find((c) => c.correccionId === id);
    expect(rechazada.estado).toBe('RECHAZADA');
    expect(rechazada.resolucion).toMatchObject({ evento: 'RECHAZADA', nombre: 'Valeria', motivo: 'No coincide con la boca' });
  });

  test('sin motivo no sale ningun pedido del frontend; si se fuerza, el backend responde INVALID_MOTIVO y la propuesta sigue pendiente', async () => {
    const id = idDe(await proponer('ana@x.com'));
    expect(await flujoDe('val@x.com').resolver('rechazar', { correccionId: id }, '   ')).toEqual({ tipo: 'invalido', mensaje: 'Indicá el motivo del rechazo.' });
    expect(await ctxFrontend.apiRechazarCorreccionUbicacion('tok-val@x.com', id, '   ')).toMatchObject({ status: 'error', code: 'INVALID_MOTIVO' });
    expect(F.ubicacionCorreccionLogic_mensajeErrorResolver('INVALID_MOTIVO')).toBe('El motivo no es válido (obligatorio al rechazar, hasta 300 caracteres).');
    expect((await leerPozo('val@x.com')).pendientes).toHaveLength(1);
  });

  test('rechazar la PROPIA: el frontend no lo ofrece; si se fuerza (propia:false falso), el backend responde SELF_REJECTION con mensaje claro; otro validador si puede', async () => {
    const id = idDe(await proponerSinAutoValidar('carla@x.com'));
    const propiaReal = (await leerPozo('carla@x.com')).pendientes[0];
    expect(propiaReal.propia).toBe(true);
    expect(F.ubicacionCorreccionLogic_puedeRechazarPropuesta(USUARIOS['carla@x.com'].permisos, propiaReal)).toBe(false);
    expect((await flujoDe('carla@x.com').resolver('rechazar', propiaReal, 'La retiro')).tipo).toBe('invalido');
    const forzada = await flujoDe('carla@x.com').resolver('rechazar', { correccionId: id, propia: false }, 'La retiro');
    expect(forzada).toEqual({ tipo: 'error', code: 'SELF_REJECTION', mensaje: 'No podés rechazar una corrección que propusiste vos.' });
    expect((await flujoDe('val@x.com').resolver('rechazar', { correccionId: id, propia: false }, 'No coincide')).tipo).toBe('ok');
  });

  test('motivo de 300 caracteres: aceptado; de 301: el frontend no lo envia', async () => {
    const id = idDe(await proponer('ana@x.com'));
    const largo = await flujoDe('val@x.com').resolver('rechazar', { correccionId: id }, 'x'.repeat(301));
    expect(largo).toEqual({ tipo: 'invalido', mensaje: 'El motivo admite hasta 300 caracteres.' });
    expect((await flujoDe('val@x.com').resolver('rechazar', { correccionId: id }, 'x'.repeat(300))).tipo).toBe('ok');
  });
});

describe('indicador + bandeja + ficha: el circuito completo con el backend real', () => {
  test('3 propuestas: bandeja 3 -> validar una (2) -> rechazar otra (1) -> la ultima (0); cada paso releido del backend', async () => {
    const ids = [];
    for (let i = 0; i < 3; i += 1) { ids.push(idDe(await proponer('ana@x.com', { lat: norte(0.0002 * (i + 1)) }))); }
    const total = async () => F.ubicacionCorreccionLogic_resumenPendientes(await ctxFrontend.apiGetCorreccionesUbicacionPendientes('tok-val@x.com'));
    expect((await total()).total).toBe(3);
    expect((await flujoDe('val@x.com').resolver('validar', { correccionId: ids[0] })).tipo).toBe('ok');
    expect((await total()).total).toBe(2);
    expect((await flujoDe('val@x.com').resolver('rechazar', { correccionId: ids[1] }, 'No coincide')).tipo).toBe('ok');
    const t = await total();
    expect(t.total).toBe(1);
    expect(t.items.map((c) => c.correccionId)).toEqual([ids[2]]);
    expect((await flujoDe('val@x.com').resolver('validar', { correccionId: ids[2] })).tipo).toBe('ok');
    expect((await total()).total).toBe(0);
    const lectura = await leerPozo('lector@x.com');
    expect(lectura.vigente.correccionId).toBe(ids[2]);
    expect(lectura.historial.map((c) => c.estado).sort()).toEqual(['RECHAZADA', 'SUPERADA', 'VALIDADA']);
  });

  test('la ficha del pozo (lectura real) ofrece Validar / Rechazar SOLO a quien tiene los dos permisos; la propia solo Validar', async () => {
    const ajena = idDe(await proponer('ana@x.com'));
    const propia = idDe(await proponerSinAutoValidar('carla@x.com', { lat: norte(0.0006) }));
    const lectura = await leerPozo('carla@x.com');
    const conPermiso = F.ubicacionCorreccionLogic_htmlSeccion(lectura, { puedeCorregir: true, puedeValidar: F.ubicacionCorreccionLogic_puedeValidar(USUARIOS['carla@x.com'].permisos) });
    expect(conPermiso).toContain('data-uval-accion="validar" data-uval-correccion="' + ajena + '"');
    expect(conPermiso).toContain('data-uval-accion="rechazar" data-uval-correccion="' + ajena + '"');
    expect(conPermiso).toContain('data-uval-accion="validar" data-uval-correccion="' + propia + '"');
    expect(conPermiso).not.toContain('data-uval-accion="rechazar" data-uval-correccion="' + propia + '"');
    const lectorLectura = await leerPozo('ana@x.com');
    const sinPermiso = F.ubicacionCorreccionLogic_htmlSeccion(lectorLectura, { puedeCorregir: true, puedeValidar: F.ubicacionCorreccionLogic_puedeValidar(USUARIOS['ana@x.com'].permisos) });
    expect(sinPermiso).toContain('Pendiente');
    expect(sinPermiso).not.toContain('data-uval-accion');
  });
});

describe('contrato de acciones, permisos y errores', () => {
  test('las acciones que usa el frontend estan ruteadas en doPost con los permisos exactos ubicacion + ubicacion_validar', () => {
    ['validarCorreccionUbicacion', 'rechazarCorreccionUbicacion', 'getCorreccionesUbicacionPendientes'].forEach((a) => {
      expect(apiFrontend).toContain("callBackend('" + a + "'");
      expect(fuenteApi).toContain("body.action === '" + a + "'");
    });
    expect(fuenteApi).toMatch(/validarPermisosTodos\(session, 'getCorreccionesUbicacionPendientes', null, \['ubicacion', 'ubicacion_validar'\]\)/);
    expect(F.ubicacionCorreccionLogic_puedeValidar({ ubicacion: true, ubicacion_validar: true })).toBe(true);
  });

  test('todo codigo de error de resolver que el backend puede devolver tiene tratamiento en el frontend (mensaje propio, "ya resuelta" o sesion)', () => {
    const servicio = leer('backend', 'src', 'UbicacionCorreccionService.js');
    const codigos = Array.from(new Set((servicio.match(/ubicacionCorreccionService_error\('([A-Z_]+)'/g) || []).map((m) => m.match(/'([A-Z_]+)'/)[1])));
    ['INVALID_TRANSITION', 'CORRECCION_NOT_FOUND', 'SELF_REJECTION', 'INVALID_MOTIVO', 'INCONSISTENT_STATE', 'PERMISSION_DENIED'].forEach((c) => {
      expect(codigos.concat(['PERMISSION_DENIED'])).toContain(c);
      const tratado = F.UCORR_MENSAJES_ERROR_RESOLVER[c] !== undefined || ['INVALID_TRANSITION', 'CORRECCION_NOT_FOUND'].indexOf(c) !== -1;
      expect(tratado).toBe(true);
    });
  });

  test('no hay endpoints nuevos: el frontend no llama ninguna accion que el backend no tuviera antes de esta etapa', () => {
    const acciones = Array.from(new Set((apiFrontend.match(/callBackend\('([A-Za-z]+)'/g) || []).map((m) => m.match(/'([A-Za-z]+)'/)[1])));
    acciones.forEach((a) => expect(fuenteApi).toContain("body.action === '" + a + "'"));
  });
});
