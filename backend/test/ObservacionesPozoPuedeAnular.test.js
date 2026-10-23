// puedeAnular (E5-6b): booleano estricto que acompana a cada observacion y le dice a la interfaz si LA SESION que consulta puede anularla. Se calcula en UN solo lugar
// (observacionesPozoService_capacidadAnular, usado por la vista central) con la sesion y los permisos de HOY, con la MISMA regla que usa anularObservacionPozo para autorizar. Es solo una senal:
// no reemplaza la autorizacion real. Cubre la regla, la privacidad (nunca email ni "es autor / es moderador"), los tres payloads (lectura, alta, anulacion), el recalculo con permisos actuales y la
// PARIDAD con la autorizacion real.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Api;
let Servicio;
let hojas;
let USUARIOS;
let contador = 0;
let gancho = null;                                       // se ejecuta justo al tomar el lock (intercala otra ejecucion)

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COLUMNAS = require('../src/ObservacionesPozoRepository').OBSERVACIONES_POZO_COLUMNAS;

const usuariosBase = () => ({
  'ana@x.com': { nombre: 'Ana', permisos: { observaciones: true, observaciones_agregar: true } },
  'beto@x.com': { nombre: 'Beto', permisos: { observaciones: true, observaciones_agregar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { observaciones: true } },
  'soloagregar@x.com': { nombre: 'Solo agregar', permisos: { observaciones_agregar: true } },
  'mod@x.com': { nombre: 'Moderadora', permisos: { observaciones: true, observaciones_anular: true } },
  'soloanular@x.com': { nombre: 'Solo anular', permisos: { observaciones_anular: true } },
  'todo@x.com': { nombre: 'Todo', permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'nada@x.com': { nombre: 'Nada', permisos: {} }
});

const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto previo ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'prev-' + String(n).padStart(8, '0') }, extra || {}));
const anuladaFila = (n, id, extra) => fila(Object.assign({ observacionId: uuid(id), evento: 'ANULADA', wellId: W, motivo: 'ya anulada', email: 'mod@x.com', nombre: 'Moderadora', timestampUtc: ISO, secuencia: n, clientRequestId: 'prevA-' + String(n).padStart(7, '0') }, extra || {}));
const BASE = () => [alta(1), alta(2, { email: 'beto@x.com', nombre: 'Beto' })];

function armar(filas) {
  contador = 0;
  USUARIOS = usuariosBase();
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  const Repo = require('../src/ObservacionesPozoRepository');
  Servicio = require('../src/ObservacionesPozoService');
  Object.assign(global, Repo, Servicio);
  hojas = instalarSheetsFalsos({ ObservacionesPozo: [COLUMNAS].concat(filas === undefined ? BASE() : filas) });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e]);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].permisos[m] === true);
  global.registryService_getWellLocation = jest.fn((id) => (id === W ? { found: true, location: { wellId: id } } : { found: false }));
  global.driveProfileRepository_existe = jest.fn(() => false);
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  gancho = null;
  global.LockService = { getScriptLock: () => ({ waitLock: () => { if (gancho) { const g = gancho; gancho = null; g(); } }, releaseLock: () => {} }) };
}

const post = (cuerpo) => JSON.parse(Api.doPost({ postData: { contents: JSON.stringify(cuerpo) } }).text);
const rid = () => 'req-' + String(++contador).padStart(8, '0');
const leer = (usuario) => post({ action: 'getObservacionesPozo', sessionToken: 'tok-' + usuario, wellId: W });
const agregar = (usuario, extra) => post(Object.assign({ action: 'agregarObservacionPozo', sessionToken: 'tok-' + usuario, wellId: W, texto: 'Se observa bomba instalada', clientRequestId: rid() }, extra || {}));
const anular = (usuario, extra) => post(Object.assign({ action: 'anularObservacionPozo', sessionToken: 'tok-' + usuario, observacionId: uuid(1), motivo: 'Dato cargado por error', clientRequestId: rid() }, extra || {}));
const senal = (usuario, n) => leer(usuario).data.observaciones.find((o) => o.observacionId === uuid(n)).puedeAnular;

beforeEach(() => { armar(); });
afterEach(() => { jest.restoreAllMocks(); });

describe('capacidadAnular: la regla exacta (unidad)', () => {
  const cap = (obs, sesion) => Servicio.observacionesPozoService_capacidadAnular(obs, sesion);
  const activa = (email) => ({ estado: 'ACTIVA', email: email === undefined ? 'ana@x.com' : email, nombre: 'Ana' });
  const sesion = (email, permisos) => ({ email, permisos });
  const P = (o) => Object.assign({ observaciones: false, agregar: false, anular: false }, o);

  test.each([
    ['A. autor de una activa: observaciones + agregar, y el email coincide', activa(), sesion('ana@x.com', P({ observaciones: true, agregar: true })), true],
    ['B. autor SIN agregar', activa(), sesion('ana@x.com', P({ observaciones: true })), false],
    ['C. ajena con agregar', activa(), sesion('beto@x.com', P({ observaciones: true, agregar: true })), false],
    ['D. moderador: observaciones + anular, cualquier autor', activa(), sesion('mod@x.com', P({ observaciones: true, anular: true })), true],
    ['E. anular SIN observaciones', activa(), sesion('mod@x.com', P({ anular: true })), false],
    ['E2. agregar SIN observaciones (aunque sea la propia)', activa(), sesion('ana@x.com', P({ agregar: true })), false],
    ['F. autor + moderador', activa(), sesion('ana@x.com', P({ observaciones: true, agregar: true, anular: true })), true],
    ['F2. moderador sobre una ajena aunque tambien agregue', activa(), sesion('beto@x.com', P({ observaciones: true, agregar: true, anular: true })), true],
    ['G. email historico VACIO + agregar', activa(''), sesion('ana@x.com', P({ observaciones: true, agregar: true })), false],
    ['G2. email historico sin forma de email + agregar', activa('ana'), sesion('ana', P({ observaciones: true, agregar: true })), false],
    ['G3. email historico NULL / undefined', activa(null), sesion('ana@x.com', P({ observaciones: true, agregar: true })), false],
    ['G4. moderador con email historico invalido: true (deriva igual)', activa(''), sesion('mod@x.com', P({ observaciones: true, anular: true })), true],
    ['H. el email se normaliza (mayusculas y espacios en la ALTA)', activa('  ANA@X.Com  '), sesion('ana@x.com', P({ observaciones: true, agregar: true })), true],
    ['H2. el email se normaliza (mayusculas y espacios en la sesion)', activa('ana@x.com'), sesion('  Ana@X.COM ', P({ observaciones: true, agregar: true })), true],
    ['I. ANULADA: false (aunque sea moderador)', { estado: 'ANULADA', email: 'ana@x.com' }, sesion('mod@x.com', P({ observaciones: true, anular: true })), false],
    ['I2. ANULADA propia: false', { estado: 'ANULADA', email: 'ana@x.com' }, sesion('ana@x.com', P({ observaciones: true, agregar: true })), false],
    ['I3. estado desconocido: false', { estado: 'BORRADA', email: 'ana@x.com' }, sesion('mod@x.com', P({ observaciones: true, anular: true })), false],
    ['sin estado: false', { email: 'ana@x.com' }, sesion('mod@x.com', P({ observaciones: true, anular: true })), false],
    ['sin permisos de ningun tipo', activa(), sesion('ana@x.com', P({})), false]
  ])('%s -> %s', (_n, obs, ses, esperado) => {
    expect(cap(obs, ses)).toBe(esperado);
  });

  test.each([[1], ['SI'], ['true'], [{}], [[]], ['1']])('J. permisos truthy que NO son el booleano (%j): false siempre', (valor) => {
    expect(cap(activa(), sesion('mod@x.com', { observaciones: valor, agregar: false, anular: true }))).toBe(false);
    expect(cap(activa(), sesion('mod@x.com', { observaciones: true, agregar: false, anular: valor }))).toBe(false);
    expect(cap(activa(), sesion('ana@x.com', { observaciones: true, agregar: valor, anular: false }))).toBe(false);
    expect(cap(activa(), sesion('ana@x.com', { observaciones: valor, agregar: true, anular: false }))).toBe(false);
  });

  test('el NOMBRE no cuenta: el mismo nombre con otro email da false; otro nombre con el mismo email da true', () => {
    const p = P({ observaciones: true, agregar: true });
    expect(cap({ estado: 'ACTIVA', email: 'beto@x.com', nombre: 'Ana' }, sesion('ana@x.com', p))).toBe(false);
    expect(cap({ estado: 'ACTIVA', email: 'ana@x.com', nombre: 'Beto' }, sesion('ana@x.com', p))).toBe(true);
    expect(cap({ estado: 'ACTIVA', email: 'ana@x.com', nombre: '' }, sesion('ana@x.com', p))).toBe(true);
  });

  test.each([[undefined], [null], [{}], [{ email: 'ana@x.com' }], [{ permisos: null }], ['ana@x.com'], [5]])('sin sesion o sesion incompleta (%j): false, nunca una excepcion', (ses) => {
    expect(cap(activa(), ses)).toBe(false);
  });

  test.each([[null], [undefined], ['x'], [5]])('observacion invalida (%j): false', (obs) => {
    expect(cap(obs, sesion('mod@x.com', P({ observaciones: true, anular: true })))).toBe(false);
  });

  test('el resultado es SIEMPRE un booleano (nunca undefined / truthy)', () => {
    [activa(), { estado: 'ANULADA' }, null].forEach((o) => {
      [undefined, sesion('ana@x.com', P({ observaciones: true, agregar: true })), sesion('mod@x.com', P({ observaciones: true, anular: true }))].forEach((s) => {
        expect(typeof cap(o, s)).toBe('boolean');
      });
    });
  });
});

describe('la vista central lo incluye y no filtra nada mas', () => {
  const vista = Servicio => Servicio.observacionesPozoService_vista;
  const obsDerivada = { observacionId: uuid(1), wellId: W, secuencia: 3, texto: 'Hola mundo', categoria: '', email: 'ana@x.com', nombre: 'Ana', timestamp: ISO, estado: 'ACTIVA', anulacion: null };

  test('con sesion: puedeAnular booleano; sin sesion: false; las claves son la lista blanca de siempre mas puedeAnular', () => {
    const v = vista(Servicio);
    const conSesion = v(obsDerivada, { moderador: false, sesion: { email: 'ana@x.com', permisos: { observaciones: true, agregar: true, anular: false } } });
    expect(conSesion.puedeAnular).toBe(true);
    expect(v(obsDerivada, { moderador: false }).puedeAnular).toBe(false);
    expect(v(obsDerivada).puedeAnular).toBe(false);
    expect(Object.keys(conSesion).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'puedeAnular', 'texto', 'timestamp', 'wellId']);
    expect(JSON.stringify(conSesion)).not.toMatch(/ana@x\.com|secuencia|"email"|esPropia|esModerador|autorEmail/);
  });

  test('una anulada: false aunque la sesion sea de moderador; el texto sigue la privacidad de siempre', () => {
    const anulada = Object.assign({}, obsDerivada, { estado: 'ANULADA', anulacion: { nombre: 'Mod', timestamp: ISO, motivo: 'm', email: 'mod@x.com' } });
    const v = vista(Servicio)(anulada, { moderador: true, sesion: { email: 'mod@x.com', permisos: { observaciones: true, agregar: false, anular: true } } });
    expect(v.puedeAnular).toBe(false);
    expect(v.texto).toBe('Hola mundo');
    expect(vista(Servicio)(anulada, { moderador: false, sesion: { email: 'ana@x.com', permisos: { observaciones: true, agregar: true, anular: false } } })).toMatchObject({ puedeAnular: false, texto: null });
  });
});

describe('getObservacionesPozo: puedeAnular segun la sesion que consulta', () => {
  test('autora (observaciones + agregar): true en la propia activa, false en la ajena', () => {
    expect(senal('ana@x.com', 1)).toBe(true);
    expect(senal('ana@x.com', 2)).toBe(false);
    expect(senal('beto@x.com', 2)).toBe(true);
    expect(senal('beto@x.com', 1)).toBe(false);
  });

  test('lector (solo observaciones): false en todas', () => {
    expect(senal('lector@x.com', 1)).toBe(false);
    expect(senal('lector@x.com', 2)).toBe(false);
  });

  test('moderadora (observaciones + anular): true en todas las ACTIVAS, de cualquier autor', () => {
    expect(senal('mod@x.com', 1)).toBe(true);
    expect(senal('mod@x.com', 2)).toBe(true);
  });

  test('autor + moderador: true en todas', () => {
    expect(senal('todo@x.com', 1)).toBe(true);
    expect(senal('todo@x.com', 2)).toBe(true);
  });

  test('anular SIN observaciones: ni siquiera puede leer (PERMISSION_DENIED): no hay payload que lo lleve', () => {
    expect(leer('soloanular@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(leer('soloagregar@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test('email historico vacio / invalido: la autora NO puede (false); la moderadora si (true)', () => {
    armar([alta(1, { email: '' }), alta(2, { email: 'no-es-un-email' })]);
    expect(senal('ana@x.com', 1)).toBe(false);
    expect(senal('ana@x.com', 2)).toBe(false);
    expect(senal('mod@x.com', 1)).toBe(true);
    expect(senal('mod@x.com', 2)).toBe(true);
  });

  test('email con mayusculas y espacios en la ALTA: se normaliza (true para la autora)', () => {
    armar([alta(1, { email: '  ANA@X.Com ' })]);
    expect(senal('ana@x.com', 1)).toBe(true);
  });

  test('una ANULADA: false para todos (moderadora, autora, otros) y sin botón fantasma', () => {
    armar([alta(1), anuladaFila(2, 1), alta(3, { email: 'beto@x.com' })]);
    ['ana@x.com', 'mod@x.com', 'todo@x.com', 'lector@x.com'].forEach((u) => {
      const o = leer(u).data.observaciones.find((x) => x.observacionId === uuid(1));
      expect(o.estado).toBe('ANULADA');
      expect(o.puedeAnular).toBe(false);
    });
    expect(senal('mod@x.com', 3)).toBe(true);
  });

  test.each([[1], ['SI'], ['true'], [{}]])('J. permisos truthy que no son el booleano (%j): la lectura funciona (como siempre) pero puedeAnular es false', (valor) => {
    global.hasPermission.mockImplementation((e, m) => valor);
    const r = leer('mod@x.com');
    expect(r.status).toBe('ok');
    r.data.observaciones.forEach((o) => expect(o.puedeAnular).toBe(false));
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones' ? true : valor));
    leer('ana@x.com').data.observaciones.forEach((o) => expect(o.puedeAnular).toBe(false));
  });

  test('la lectura con observaciones truthy (no true) y el resto en true: se lee como siempre y puedeAnular es false para todas', () => {
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones' ? 1 : true));
    const r = leer('mod@x.com');
    expect(r.status).toBe('ok');
    r.data.observaciones.forEach((o) => expect(o.puedeAnular).toBe(false));
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones_agregar' ? 1 : (m === 'observaciones_anular' ? false : true)));
    leer('ana@x.com').data.observaciones.forEach((o) => expect(o.puedeAnular).toBe(false));
  });

  test('todas las observaciones traen puedeAnular como booleano estricto', () => {
    ['ana@x.com', 'mod@x.com', 'lector@x.com'].forEach((u) => leer(u).data.observaciones.forEach((o) => expect(typeof o.puedeAnular).toBe('boolean')));
  });

  test('K. la respuesta nunca trae email ni nada que diga si es autor o moderador', () => {
    ['ana@x.com', 'mod@x.com', 'todo@x.com', 'lector@x.com'].forEach((u) => {
      const t = JSON.stringify(leer(u));
      expect(t).not.toMatch(/@x\.com|"email"|esPropia|esAutor|esModerador|autorEmail|moderador/);
      leer(u).data.observaciones.forEach((o) => expect(Object.keys(o).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'puedeAnular', 'texto', 'timestamp', 'wellId']));
    });
  });

  test('N. se recalcula con los permisos de HOY (no hay valor congelado)', () => {
    expect(senal('ana@x.com', 1)).toBe(true);
    USUARIOS['ana@x.com'].permisos.observaciones_agregar = false;                // pierde agregar
    expect(senal('ana@x.com', 1)).toBe(false);
    USUARIOS['ana@x.com'].permisos.observaciones_agregar = true;
    expect(senal('ana@x.com', 1)).toBe(true);
    expect(senal('mod@x.com', 2)).toBe(true);
    USUARIOS['mod@x.com'].permisos.observaciones_anular = false;                 // la moderadora pierde anular y no es autora
    expect(senal('mod@x.com', 2)).toBe(false);
    USUARIOS['mod@x.com'].permisos.observaciones_anular = true;
    USUARIOS['mod@x.com'].permisos.observaciones = false;                        // sin permiso base ni siquiera lee
    expect(leer('mod@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('N2. moderador que pierde anular pero conserva agregar: true en lo PROPIO, false en lo ajeno', () => {
    armar([alta(1, { email: 'todo@x.com', nombre: 'Todo' }), alta(2)]);
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;
    expect(senal('todo@x.com', 1)).toBe(true);
    expect(senal('todo@x.com', 2)).toBe(false);
  });
});

describe('agregarObservacionPozo: la recien creada usa la MISMA regla', () => {
  test('L. autora con agregar: puedeAnular true en la respuesta; y es lo que la lectura le dice despues', () => {
    const r = agregar('ana@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.observacion.puedeAnular).toBe(true);
    const id = r.data.observacion.observacionId;
    expect(leer('ana@x.com').data.observaciones.find((o) => o.observacionId === id).puedeAnular).toBe(true);
    expect(leer('beto@x.com').data.observaciones.find((o) => o.observacionId === id).puedeAnular).toBe(false);
  });

  test('autor + moderador: true; permisos truthy no booleanos (la alta funciona como siempre): false', () => {
    expect(agregar('todo@x.com').data.observacion.puedeAnular).toBe(true);
    global.hasPermission.mockImplementation(() => 1);
    const r = agregar('ana@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.observacion.puedeAnular).toBe(false);
  });

  test('no esta hardcodeado: depende de la sesion de HOY (agregar sin observaciones_anular = true solo por ser la propia)', () => {
    const a = agregar('ana@x.com');
    expect(a.data.observacion.puedeAnular).toBe(true);
    USUARIOS['ana@x.com'].permisos.observaciones_anular = false;
    expect(agregar('ana@x.com').data.observacion.puedeAnular).toBe(true);
  });

  test('el reintento idempotente (duplicada:true) recalcula con los permisos de HOY y con el estado de HOY', () => {
    const crid = 'retry-12345678';
    const primera = agregar('ana@x.com', { clientRequestId: crid });
    expect(primera.data.observacion.puedeAnular).toBe(true);
    const igual = agregar('ana@x.com', { clientRequestId: crid });
    expect(igual.data).toMatchObject({ duplicada: true });
    expect(igual.data.observacion).toEqual(primera.data.observacion);
    // otra persona la anula: el reintento devuelve la anulada y la senal ya no es true
    expect(anular('mod@x.com', { observacionId: primera.data.observacion.observacionId }).status).toBe('ok');
    const tardio = agregar('ana@x.com', { clientRequestId: crid });
    expect(tardio.data.duplicada).toBe(true);
    expect(tardio.data.observacion).toMatchObject({ estado: 'ANULADA', puedeAnular: false, texto: null });
  });

  test('el reintento que se resuelve DENTRO del lock (otra ejecucion escribio justo antes) tambien lleva puedeAnular recalculado', () => {
    const crid = 'carrera-1234567';
    let interna;
    gancho = () => { interna = agregar('ana@x.com', { clientRequestId: crid }); };
    const externa = agregar('ana@x.com', { clientRequestId: crid });
    expect(interna.data.duplicada).toBe(false);
    expect(externa.data.duplicada).toBe(true);
    expect(externa.data.observacion.puedeAnular).toBe(true);
    expect(externa.data.observacion).toEqual(interna.data.observacion);
  });

  test('la alta con permisos que NO son el booleano exacto funciona como siempre pero puedeAnular es false (observaciones / agregar truthy)', () => {
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones' ? 1 : true));
    const a = agregar('ana@x.com');
    expect(a.status).toBe('ok');
    expect(a.data.observacion.puedeAnular).toBe(false);
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones_agregar' ? 1 : (m === 'observaciones_anular' ? false : true)));
    const b = agregar('ana@x.com');
    expect(b.status).toBe('ok');
    expect(b.data.observacion.puedeAnular).toBe(false);
  });

  test('la respuesta no trae email ni la razon', () => {
    expect(JSON.stringify(agregar('ana@x.com'))).not.toMatch(/@x\.com|"email"|esPropia|esModerador/);
  });
});

describe('anularObservacionPozo: la observacion resultante ANULADA devuelve false', () => {
  test('M. moderadora y autora: puedeAnular false en la ANULADA (y el resto del payload igual)', () => {
    const m = anular('mod@x.com');
    expect(m.status).toBe('ok');
    expect(m.data.observacion).toMatchObject({ estado: 'ANULADA', puedeAnular: false, texto: 'Texto previo 1' });
    armar();
    const a = anular('ana@x.com');
    expect(a.data.observacion).toMatchObject({ estado: 'ANULADA', puedeAnular: false, texto: null });
    expect(Object.keys(a.data.observacion).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'puedeAnular', 'texto', 'timestamp', 'wellId']);
  });

  test('N. el reintento (duplicada:true) sigue devolviendo false y lo recalcula', () => {
    const crid = 'anul-12345678';
    expect(anular('mod@x.com', { clientRequestId: crid }).data.observacion.puedeAnular).toBe(false);
    const re = anular('mod@x.com', { clientRequestId: crid });
    expect(re.data).toMatchObject({ duplicada: true });
    expect(re.data.observacion.puedeAnular).toBe(false);
    expect(typeof re.data.observacion.puedeAnular).toBe('boolean');
  });

  test('la lectura posterior de la anulada: false', () => {
    anular('mod@x.com');
    expect(senal('mod@x.com', 1)).toBe(false);
    expect(senal('ana@x.com', 1)).toBe(false);
  });
});

describe('el backend sigue siendo la autoridad', () => {
  test('un puedeAnular enviado por el cliente se ignora: un lector que lo manda true sigue recibiendo PERMISSION_DENIED (anular) y no cambia la alta', () => {
    expect(anular('lector@x.com', { puedeAnular: true })).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(anular('beto@x.com', { puedeAnular: true, esPropia: true, observacionId: uuid(1) })).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    const r = agregar('ana@x.com', { puedeAnular: false });
    expect(r.data.observacion.puedeAnular).toBe(true);                          // lo decide el servidor, no el cliente
    expect(hojas.ObservacionesPozo.filas.length).toBe(4);
  });

  test('PARIDAD: puedeAnular === true  <=>  anularObservacionPozo de esa sesion sobre esa observacion se autoriza (todas las combinaciones usuario x observacion x estado del email)', () => {
    const usuarios = ['ana@x.com', 'beto@x.com', 'lector@x.com', 'mod@x.com', 'todo@x.com'];
    const escenarios = [
      ['propias normales', () => [alta(1), alta(2, { email: 'beto@x.com', nombre: 'Beto' })]],
      ['email con mayusculas y espacios', () => [alta(1, { email: '  ANA@x.COM ' }), alta(2, { email: ' Beto@X.com', nombre: 'Beto' })]],
      ['email historico invalido', () => [alta(1, { email: '' }), alta(2, { email: 'no-es-un-email' })]]
    ];
    let comparaciones = 0;
    escenarios.forEach(([, filas]) => {
      usuarios.forEach((u) => {
        [1, 2].forEach((n) => {
          armar(filas());
          const prometida = senal(u, n);
          armar(filas());
          const r = anular(u, { observacionId: uuid(n) });
          expect([u, n, r.status === 'ok']).toEqual([u, n, prometida]);          // true <=> se autoriza; false <=> PERMISSION_DENIED
          if (!prometida) { expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' }); }
          comparaciones += 1;
        });
      });
    });
    expect(comparaciones).toBe(30);
  });
});

describe('guardas de codigo', () => {
  const fs = require('fs');
  const path = require('path');
  const codigo = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('puedeAnular se calcula en UN solo lugar (la vista central, via capacidadAnular): ningun handler lo arma', () => {
    const api = codigo('Api.js');
    expect(api).not.toMatch(/puedeAnular\s*:|\.puedeAnular|\[.puedeAnular.\]/);          // (la variable local `puedeAnular` del handler de anulacion es el permiso observaciones_anular, no el campo)
    const svc = codigo('ObservacionesPozoService.js');
    expect(svc.match(/puedeAnular:/g)).toHaveLength(1);                           // solo la clave de la vista
    expect(svc).toMatch(/puedeAnular: observacionesPozoService_capacidadAnular\(obs, opciones && opciones\.sesion\)/);
  });

  test('la capacidad reutiliza la regla de la autorizacion real (no una copia) y no mira el nombre', () => {
    const svc = codigo('ObservacionesPozoService.js');
    const f = svc.slice(svc.indexOf('function observacionesPozoService_capacidadAnular('), svc.indexOf('function observacionesPozoService_vistaAnulacion('));
    expect(f).toMatch(/observacionesPozoService_puedeAnular\(/);
    expect(f).not.toMatch(/nombre/i);
  });

  test('ningun archivo de backend agrega columnas, endpoints ni toca el historial por esto', () => {
    const repo = codigo('ObservacionesPozoRepository.js');
    expect(repo).not.toMatch(/puedeAnular/);
    expect(codigo('Api.js')).not.toMatch(/anularObservacionPozo[\s\S]{0,40}puedeAnular/);
  });
});
