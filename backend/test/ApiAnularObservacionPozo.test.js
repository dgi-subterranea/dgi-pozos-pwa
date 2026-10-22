// anularObservacionPozo (E5-3) de punta a punta por doPost, con el codigo REAL (Api -> permisos -> ObservacionesPozoService -> repositorio con hoja en memoria).
// Solo se simulan la sesion/usuarios, Sheets, el Historial, el lock y las FUENTES de existencia (para probar que la anulacion NO las consulta).
// Cubre permisos (autor / moderador), propiedad por email, motivo, observacion objetivo, idempotencia compartida con la alta, reintento con los permisos ACTUALES, secuencia e integridad,
// transiciones y concurrencia (intercalando otra ejecucion justo al tomar el lock), fila escrita, privacidad, Historial / Logger y la lectura posterior.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Api;
let Repo;
let hojas;
let ctx;
let USUARIOS;
let contador = 0;

const W = '14-0001';
const W_OTRO = '14-0002';
const W_OBS = '14-0666';             // tiene una observacion en la hoja, pero NINGUNA fuente institucional
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COLUMNAS = require('../src/ObservacionesPozoRepository').OBSERVACIONES_POZO_COLUMNAS;
const OBS_ANA = uuid(1);
const OBS_BETO = uuid(2);

const usuariosBase = () => ({
  'ana@x.com': { nombre: 'Ana', permisos: { observaciones: true, observaciones_agregar: true } },
  'beto@x.com': { nombre: 'Beto', permisos: { observaciones: true, observaciones_agregar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { observaciones: true } },
  'soloagregar@x.com': { nombre: 'Solo agregar', permisos: { observaciones_agregar: true } },
  'mod@x.com': { nombre: 'Moderadora', permisos: { observaciones: true, observaciones_anular: true } },
  'mod2@x.com': { nombre: 'Moderador Dos', permisos: { observaciones: true, observaciones_anular: true } },
  'soloanular@x.com': { nombre: 'Solo anular', permisos: { observaciones_anular: true } },
  'todo@x.com': { nombre: 'Todo', permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'nada@x.com': { nombre: 'Nada', permisos: {} },
  'sinclaves@x.com': { nombre: 'Sin claves', permisos: { perfil: true } },
  'baja@x.com': { nombre: 'Baja', permisos: { observaciones: true, observaciones_agregar: true }, inactivo: true }
});

const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto previo ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'prev-' + String(n).padStart(8, '0') }, extra || {}));
const anulada = (n, id, extra) => fila(Object.assign({ observacionId: uuid(id), evento: 'ANULADA', wellId: W, motivo: 'ya estaba anulada', email: 'mod@x.com', nombre: 'Moderadora', timestampUtc: ISO, secuencia: n, clientRequestId: 'prevA-' + String(n).padStart(7, '0') }, extra || {}));
const BASE = () => [alta(1), alta(2, { email: 'beto@x.com', nombre: 'Beto' })];

function armar(filas, opciones) {
  const o = opciones || {};
  contador = 0;
  USUARIOS = usuariosBase();
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  Repo = require('../src/ObservacionesPozoRepository');
  const Service = require('../src/ObservacionesPozoService');
  Object.assign(global, Repo, Service);
  hojas = instalarSheetsFalsos(o.sinHoja ? {} : { ObservacionesPozo: [COLUMNAS].concat(filas === undefined ? BASE() : filas) });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e] && USUARIOS[e].inactivo !== true, nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true && USUARIOS[e].permisos[m] === true);

  // FUENTES de existencia: la anulacion NO las consulta (se registran las llamadas para probarlo)
  ctx = { padron: new Set([W]), itfFalla: false, escrituras: [], falla: null };
  global.registryService_getWellLocation = jest.fn((id) => (ctx.padron.has(id) ? { found: true, location: { wellId: id } } : { found: false }));
  global.driveProfileRepository_existe = jest.fn(() => { if (ctx.itfFalla) { throw new Error('Drive caido'); } return false; });
  global.nivelesEstaticosRepository_getPunto = jest.fn(() => ({ found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => []);
  const real = global.pozoExistenciaService_verificar;
  global.pozoExistenciaService_verificar = jest.fn(real);

  ctx.lock = { held: false, waits: 0, releases: 0, alAdquirir: null };
  global.LockService = {
    getScriptLock: () => ({
      waitLock: () => {
        ctx.lock.waits += 1;
        if (ctx.lock.alAdquirir) { const f = ctx.lock.alAdquirir; ctx.lock.alAdquirir = null; f(); }
        ctx.lock.held = true;
      },
      releaseLock: () => { ctx.lock.held = false; ctx.lock.releases += 1; }
    })
  };

  const hoja = hojas.ObservacionesPozo;
  if (hoja) {
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => {
      const g = original(f, c, nf, nc);
      if (f > 1 && nf === 1 && nc === COLUMNAS.length) {
        const sv = g.setValues.bind(g);
        g.setValues = (x) => {
          if (ctx.falla === 'setValues') { ctx.falla = null; throw new Error('Service error: Spreadsheets'); }
          ctx.escrituras.push({ lockTomado: ctx.lock.held, fila: f, valores: x[0].slice() });
          return sv(x);
        };
      }
      return g;
    };
  }
}

const post = (cuerpo) => JSON.parse(Api.doPost({ postData: { contents: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) } }).text);
const rid = () => 'req-' + String(++contador).padStart(8, '0');
const anular = (extra, usuario) => post(Object.assign({ action: 'anularObservacionPozo', sessionToken: 'tok-' + (usuario || 'ana@x.com'), observacionId: OBS_ANA, motivo: 'Dato cargado por error', clientRequestId: rid() }, extra || {}));
const agregar = (extra, usuario) => post(Object.assign({ action: 'agregarObservacionPozo', sessionToken: 'tok-' + (usuario || 'ana@x.com'), wellId: W, texto: 'Se observa bomba instalada', clientRequestId: rid() }, extra || {}));
const leer = (extra, usuario) => post(Object.assign({ action: 'getObservacionesPozo', sessionToken: 'tok-' + (usuario || 'lector@x.com'), wellId: W }, extra || {}));
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());
const datos = () => hojas.ObservacionesPozo.filas.slice(1);
const comoObjeto = (f) => { const x = {}; COLUMNAS.forEach((c, i) => { x[c] = f[i]; }); return x; };
const secuencias = () => datos().map((f) => comoObjeto(f).secuencia);
const log = () => global.Logger.log.mock.calls.map((c) => String(c[0])).join('\n');
const sinRastro = (...secretos) => {
  const todo = JSON.stringify(historial()) + '\n' + log();
  secretos.forEach((s) => expect(todo).not.toContain(s));
};

beforeEach(() => { armar(); });
afterEach(() => { jest.restoreAllMocks(); });

describe('contrato de la respuesta y de la fila escrita', () => {
  test('la accion existe y el payload es {wellId, duplicada, observacion} en el MISMO contrato que la lectura (sin email, sin secuencia, sin clientRequestId)', () => {
    const r = anular({}, 'mod@x.com');
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data).sort()).toEqual(['duplicada', 'observacion', 'wellId']);
    expect(r.data).toMatchObject({ wellId: W, duplicada: false });
    expect(Object.keys(r.data.observacion).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'texto', 'timestamp', 'wellId']);
    expect(r.data.observacion).toMatchObject({ observacionId: OBS_ANA, wellId: W, estado: 'ANULADA', texto: 'Texto previo 1', categoria: null, nombre: 'Ana' });
    expect(Object.keys(r.data.observacion.anulacion).sort()).toEqual(['motivo', 'nombre', 'timestamp']);
    expect(r.data.observacion.anulacion).toMatchObject({ nombre: 'Moderadora', motivo: 'Dato cargado por error' });
    expect(new Date(r.data.observacion.anulacion.timestamp).toISOString()).toBe(r.data.observacion.anulacion.timestamp);
    expect(r.data.observacion.timestamp).toBe(ISO);                                   // el timestamp de la observacion es el de la ALTA
    expect(JSON.stringify(r)).not.toMatch(/@x\.com|clientRequestId|secuencia|"email"/);
  });

  test('una fila ANULADA exacta: referencia el id de la ALTA, copia el wellId de la ALTA, texto y categoria vacios, motivo normalizado, secuencia max + 1, sesion como autor; la ALTA no se toca', () => {
    const antes = JSON.stringify(datos());
    const r = anular({ motivo: '  Dato   cargado\r\npor error  ', clientRequestId: 'crid-1234567' }, 'mod@x.com');
    expect(r.status).toBe('ok');
    expect(datos()).toHaveLength(3);
    expect(JSON.stringify(datos().slice(0, 2))).toBe(antes);
    const e = comoObjeto(datos()[2]);
    expect(e).toMatchObject({ observacionId: OBS_ANA, evento: 'ANULADA', wellId: W, texto: '', categoria: '', motivo: 'Dato   cargado\npor error', email: 'mod@x.com', nombre: 'Moderadora', secuencia: 3, clientRequestId: 'crid-1234567' });
    expect(Math.abs(Date.now() - new Date(e.timestampUtc).getTime())).toBeLessThan(5000);
    expect(new Date(e.timestampUtc).toISOString()).toBe(e.timestampUtc);
    expect(JSON.stringify(datos()[2])).not.toContain('Texto previo 1');               // jamas se copia el texto original a la anulacion
    expect(ctx.escrituras).toHaveLength(1);
    COLUMNAS.forEach((c, i) => expect(hojas.ObservacionesPozo.formatos['4:' + (i + 1)]).toBe(c === 'secuencia' ? '0' : '@'));
  });

  test('el cliente NO decide el pozo, el autor, el estado, el texto ni la secuencia: los campos extra se ignoran', () => {
    const r = anular({ wellId: '99-9999', email: 'otro@x.com', nombre: 'Falso', estado: 'ACTIVA', texto: 'texto-inyectado', secuencia: 77, evento: 'ALTA', categoria: 'x', timestampUtc: '2000-01-01T00:00:00.000Z' }, 'mod@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.wellId).toBe(W);
    const e = comoObjeto(datos()[2]);
    expect(e).toMatchObject({ evento: 'ANULADA', wellId: W, texto: '', categoria: '', email: 'mod@x.com', nombre: 'Moderadora', secuencia: 3 });
    expect(e.timestampUtc).not.toBe('2000-01-01T00:00:00.000Z');
    expect(JSON.stringify(datos())).not.toContain('texto-inyectado');
  });

  test('el nombre del usuario sin nombre en Usuarios queda vacio (la lectura muestra el neutro) y la anulacion funciona', () => {
    USUARIOS['mod@x.com'].nombre = null;
    const r = anular({}, 'mod@x.com');
    expect(r.status).toBe('ok');
    expect(comoObjeto(datos()[2]).nombre).toBe('');
    expect(r.data.observacion.anulacion.nombre).toBe('Usuario');
  });

  test('el orden de claves y el JSON de error no filtran nada de la hoja', () => {
    const r = anular({ observacionId: uuid(99) });
    expect(Object.keys(r).sort()).toEqual(['code', 'message', 'status']);
  });
});

describe('permisos: autor (propia) y moderador (cualquiera); fail-closed; el nombre no cuenta', () => {
  test.each([
    ['A. autor con observaciones + agregar, su propia observacion', 'ana@x.com', 'ana@x.com', 'OK'],
    ['A2. autor: el email de la ALTA tiene mayusculas y espacios', 'ana@x.com', '  ANA@X.Com  ', 'OK'],
    ['B. no autor con agregar', 'beto@x.com', 'ana@x.com', 'PERMISSION_DENIED'],
    ['B2. solo lectura, aunque la observacion sea suya', 'lector@x.com', 'lector@x.com', 'PERMISSION_DENIED'],
    ['C. observaciones_anular SIN observaciones', 'soloanular@x.com', 'ana@x.com', 'PERMISSION_DENIED'],
    ['D. observaciones_agregar SIN observaciones, aunque sea la propia', 'soloagregar@x.com', 'soloagregar@x.com', 'PERMISSION_DENIED'],
    ['E. moderador con observaciones + anular, ajena', 'mod@x.com', 'ana@x.com', 'OK'],
    ['E2. moderador, email historico VACIO (derivable sin ambiguedad)', 'mod@x.com', '', 'OK'],
    ['E3. moderador, email historico sin forma de email', 'mod@x.com', 'no-es-un-email', 'OK'],
    ['F. autor con email historico VACIO: no se puede afirmar que es propia', 'ana@x.com', '', 'PERMISSION_DENIED'],
    ['F2. autor con email historico sin forma de email', 'ana@x.com', 'ana', 'PERMISSION_DENIED'],
    ['G. agregar + anular, ajena', 'todo@x.com', 'ana@x.com', 'OK'],
    ['H. sin ningun permiso', 'nada@x.com', 'ana@x.com', 'PERMISSION_DENIED'],
    ['H2. usuario con otros permisos pero ninguno de observaciones', 'sinclaves@x.com', 'ana@x.com', 'PERMISSION_DENIED']
  ])('%s', (_caso, usuario, emailAlta, esperado) => {
    armar([alta(1, { email: emailAlta })]);
    const r = anular({}, usuario);
    if (esperado === 'OK') {
      expect(r.status).toBe('ok');
      expect(datos()).toHaveLength(2);
      expect(comoObjeto(datos()[1]).evento).toBe('ANULADA');
    } else {
      expect(r).toMatchObject({ status: 'error', code: esperado });
      expect(datos()).toHaveLength(1);
      expect(ctx.escrituras).toEqual([]);
      expect(ctx.lock.waits).toBe(0);
    }
  });

  test('un usuario con observaciones pero sin agregar ni anular lo rechaza el handler (mensaje con su email), sin leer la hoja', () => {
    const r = anular({}, 'lector@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED', message: expect.stringContaining('lector@x.com') });
    expect(historial()).toEqual([['lector@x.com', 'anularObservacionPozo', null, 'PERMISSION_DENIED']]);
  });

  test('el nombre NUNCA determina la propiedad: mismo nombre, otro email -> no es propia; otro nombre, mismo email -> es propia', () => {
    armar([alta(1, { email: 'beto@x.com', nombre: 'Ana' })]);                         // el nombre dice "Ana", el email es de Beto
    expect(anular({}, 'ana@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    armar([alta(1, { email: 'ana@x.com', nombre: 'Beto' })]);                         // el nombre dice "Beto", el email es de Ana
    expect(anular({}, 'ana@x.com').status).toBe('ok');
    armar([alta(1, { email: 'ana@x.com', nombre: '' })]);
    expect(anular({}, 'ana@x.com').status).toBe('ok');
  });

  test('con observaciones_anular una moderadora que TAMBIEN agrega sigue anulando la ajena; sin agregar ni anular (solo observaciones) nunca', () => {
    expect(anular({}, 'todo@x.com').status).toBe('ok');
    armar();
    expect(anular({}, 'lector@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test.each([[1], ['SI'], ['true'], ['yes'], [{}], [[]], ['1']])('valores truthy que no son el booleano %j: no habilitan nada (observaciones)', (valor) => {
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones' ? valor : true));
    expect(anular({}, 'todo@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(datos()).toHaveLength(2);
    expect(ctx.lock.waits).toBe(0);
  });

  test.each([[1], ['SI'], ['true'], [{}]])('valores truthy que no son el booleano %j en agregar / anular: no alcanzan', (valor) => {
    global.hasPermission.mockImplementation((e, m) => (m === 'observaciones' ? true : valor));
    expect(anular({}, 'ana@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(anular({}, 'mod@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(datos()).toHaveLength(2);
  });

  test('los permisos se evaluan ANTES que el contenido y que la observacion: un lector con motivo invalido y un id inexistente recibe PERMISSION_DENIED', () => {
    expect(anular({ motivo: '', observacionId: uuid(99) }, 'lector@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(anular({ motivo: '', observacionId: uuid(99) }, 'nada@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('sesion invalida / usuario dado de baja', () => {
    expect(anular({ sessionToken: 'basura' })).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
    expect(anular({}, 'baja@x.com')).toMatchObject({ status: 'error', code: 'USER_DISABLED' });
    expect(datos()).toHaveLength(2);
  });

  test('la anulacion no implica poder agregar ni a la inversa (permisos independientes)', () => {
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    expect(agregar({}, 'mod@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    const nueva = agregar({}, 'ana@x.com');
    expect(nueva.status).toBe('ok');
    expect(anular({ observacionId: nueva.data.observacion.observacionId }, 'ana@x.com').status).toBe('ok');        // y su propia alta nueva si la puede anular
  });
});

describe('motivo: obligatorio, normalizado como el texto, 3 a 300 caracteres, jamas repetido en errores ni en logs', () => {
  const sinMotivo = (extra) => { const c = { action: 'anularObservacionPozo', sessionToken: 'tok-ana@x.com', observacionId: OBS_ANA, clientRequestId: rid() }; return post(Object.assign(c, extra || {})); };

  test('ausente / null / vacio / solo espacios / solo controles / no string -> INVALID_MOTIVO, sin escribir', () => {
    expect(sinMotivo().message).toMatch(/obligatorio/);
    expect(anular({ motivo: '   ' }).message).toMatch(/obligatorio/);
    [sinMotivo(), anular({ motivo: null }), anular({ motivo: '' }), anular({ motivo: '     ' }), anular({ motivo: '\n\t \u0000\u0007' }), anular({ motivo: 123 }), anular({ motivo: {} }), anular({ motivo: ['abc'] }), anular({ motivo: true })]
      .forEach((r) => expect(r).toMatchObject({ status: 'error', code: 'INVALID_MOTIVO' }));
    expect(datos()).toHaveLength(2);
    expect(ctx.escrituras).toEqual([]);
  });

  test.each([[2, false], [3, true], [4, true], [300, true], [301, false]])('largo %i (despues de normalizar): admitido=%s', (largo, ok) => {
    const r = anular({ motivo: 'a'.repeat(largo) });
    if (ok) { expect(r.status).toBe('ok'); expect(comoObjeto(datos()[2]).motivo).toBe('a'.repeat(largo)); } else { expect(r).toMatchObject({ code: 'INVALID_MOTIVO' }); expect(datos()).toHaveLength(2); }
  });

  test('el largo se cuenta en caracteres unicos: 300 emoji entran, 301 no; 2 emoji no alcanzan y 3 si', () => {
    expect(anular({ motivo: '\u{1F600}'.repeat(2) })).toMatchObject({ code: 'INVALID_MOTIVO' });
    expect(anular({ motivo: '\u{1F600}'.repeat(300) }).status).toBe('ok');
    armar();
    expect(anular({ motivo: '\u{1F600}'.repeat(301) })).toMatchObject({ code: 'INVALID_MOTIVO' });
    expect(anular({ motivo: '\u{1F600}'.repeat(3) }).status).toBe('ok');
    expect(comoObjeto(datos()[2]).motivo).toBe('\u{1F600}\u{1F600}\u{1F600}');
  });

  test('el recorte es de los extremos: los espacios del medio y los saltos de linea se conservan; CRLF -> \\n; controles fuera; unicode intacto', () => {
    expect(anular({ motivo: '  \r\n  uno   dos\r\n\r\ntres\tcuatro\u0007 \u{1F4A7} acentos ñá  \n ' }).status).toBe('ok');
    expect(comoObjeto(datos()[2]).motivo).toBe('uno   dos\n\ntres cuatro \u{1F4A7} acentos ñá');
  });

  test('una formula como motivo se guarda como TEXTO PLANO, tal cual', () => {
    expect(anular({ motivo: '=HYPERLINK("http://x","clic")' }).status).toBe('ok');
    expect(comoObjeto(datos()[2]).motivo).toBe('=HYPERLINK("http://x","clic")');
    expect(hojas.ObservacionesPozo.formatos['4:' + (COLUMNAS.indexOf('motivo') + 1)]).toBe('@');
  });

  test('un motivo con 3 caracteres que NO alcanzan tras normalizar (espacios y controles) -> INVALID_MOTIVO', () => {
    expect(anular({ motivo: ' a\u0007\u0000b ' })).toMatchObject({ code: 'INVALID_MOTIVO' });
  });

  test('los errores y los logs NUNCA repiten el motivo', () => {
    const secreto = 'MOTIVO-SECRETO-424242';
    expect(anular({ motivo: secreto + 'x'.repeat(300) })).toMatchObject({ code: 'INVALID_MOTIVO' });
    const mala = anular({ motivo: secreto, observacionId: uuid(99) }, 'mod@x.com');
    expect(mala.code).toBe('OBSERVACION_NOT_FOUND');
    expect(anular({ motivo: secreto }, 'beto@x.com').code).toBe('PERMISSION_DENIED');
    ctx.falla = 'setValues';
    expect(anular({ motivo: secreto }).code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify([mala])).not.toContain(secreto);
    sinRastro(secreto);
  });

  test('observacionId invalido -> INVALID_OBSERVACION_ID; clientRequestId invalido -> INVALID_CLIENT_REQUEST_ID (sin eco)', () => {
    [undefined, null, '', 'abc', 123, {}, [OBS_ANA], uuid(1) + 'x', uuid(1).replace(/-/g, '')].forEach((v) => {
      expect(anular({ observacionId: v })).toMatchObject({ status: 'error', code: 'INVALID_OBSERVACION_ID' });
    });
    [undefined, null, '', 'corto', 'a'.repeat(65), 'con espacio 123', 'raro/123456', 12345678, {}].forEach((v) => {
      expect(anular({ clientRequestId: v })).toMatchObject({ status: 'error', code: 'INVALID_CLIENT_REQUEST_ID' });
    });
    expect(datos()).toHaveLength(2);
  });

  test('el observacionId en mayusculas o con espacios se normaliza y encuentra la observacion', () => {
    expect(anular({ observacionId: '  ' + OBS_ANA.toUpperCase() + ' ' }).status).toBe('ok');
    expect(comoObjeto(datos()[2]).observacionId).toBe(OBS_ANA);
  });
});

describe('observacion objetivo: existente, inequivoca, derivable y no anulada', () => {
  test('inexistente -> OBSERVACION_NOT_FOUND para el moderador, sin escribir (Historial sin pozo conocido); el autor recibe PERMISSION_DENIED (ver "sin oraculo")', () => {
    const r = anular({ observacionId: uuid(99) }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'OBSERVACION_NOT_FOUND' });
    expect(datos()).toHaveLength(2);
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', null, 'OBSERVACION_NOT_FOUND']]);
  });

  test('hoja vacia (solo encabezado) -> OBSERVACION_NOT_FOUND', () => {
    armar([]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'OBSERVACION_NOT_FOUND' });
    expect(anular({})).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('una ANULADA huerfana (sin ALTA) NO es una observacion: OBSERVACION_NOT_FOUND', () => {
    armar([anulada(1, 50)]);
    expect(anular({ observacionId: uuid(50) }, 'mod@x.com')).toMatchObject({ code: 'OBSERVACION_NOT_FOUND' });
    expect(datos()).toHaveLength(1);
  });

  test('varias ALTA con el mismo observacionId -> INCONSISTENT_STATE (ni la primera ni la ultima), sin escribir', () => {
    armar([alta(1), alta(1, { secuencia: 2, texto: 'otro texto', clientRequestId: 'prev-dup00002' })]);
    const dup = anular({}, 'mod@x.com');
    expect(dup).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE', message: expect.stringMatching(/historial inconsistente/) });
    expect(datos()).toHaveLength(2);
    expect(ctx.escrituras).toEqual([]);
  });

  test('ALTA duplicada en OTRO pozo: tambien ambigua', () => {
    armar([alta(1), alta(1, { wellId: W_OTRO, secuencia: 2, clientRequestId: 'prev-dup00002' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
  });

  test('ALTA cuyo wellId esta roto -> INCONSISTENT_STATE (no se adivina el pozo)', () => {
    armar([alta(1, { wellId: 'mal' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE', message: expect.stringMatching(/historial inconsistente/) });
    armar([alta(1, { wellId: '' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(datos()).toHaveLength(1);
  });

  test('demasiadas filas con el mismo id (ALTA + muchas ANULADA) -> INCONSISTENT_STATE', () => {
    const filas = [alta(1)];
    for (let i = 0; i < 12; i += 1) { filas.push(anulada(10 + i, 1)); }
    armar(filas);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
  });

  test('la secuencia de la ALTA objetivo repetida con otro evento -> la observacion no es derivable: INCONSISTENT_STATE, sin escribir', () => {
    armar([alta(1, { secuencia: 5 }), alta(2, { secuencia: 5, email: 'beto@x.com' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(datos()).toHaveLength(2);
    expect(ctx.escrituras).toEqual([]);
  });

  test('una ALTA con secuencia ilegible tampoco es derivable', () => {
    armar([alta(1, { secuencia: 'abc' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
  });

  test('ya anulada -> INVALID_TRANSITION (con un clientRequestId nuevo), sin segunda fila', () => {
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    const r = anular({}, 'mod2@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(3);
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', W, 'OK'], ['mod2@x.com', 'anularObservacionPozo', W, 'INVALID_TRANSITION']]);
  });

  test('ya anulada por OTRO: el autor tampoco puede volver a anularla (INVALID_TRANSITION), ni siquiera con otro motivo', () => {
    armar([alta(1), anulada(2, 1)]);
    expect(anular({ motivo: 'otro motivo distinto' }, 'ana@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(2);
  });

  test('una anulacion con la fila rota (secuencia, fecha, motivo y pozo ilegibles) igual cuenta como "ya anulada": prefiere NO escribir de nuevo', () => {
    armar([alta(1), anulada('', 1, { wellId: 'mal', motivo: '', timestampUtc: 'no-es-fecha' })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(2);
    expect(ctx.escrituras).toEqual([]);
  });

  test('una anulacion con OTRO wellId (copia rota) que referencia la ALTA tambien la deja anulada', () => {
    armar([alta(1), anulada(2, 1, { wellId: W_OTRO })]);
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(2);
  });

  test('una anulacion ANTERIOR al alta (por secuencia) tambien la deja anulada', () => {
    armar([anulada(1, 5), alta(5, { secuencia: 2 })]);
    expect(anular({ observacionId: uuid(5) }, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  test('la fila ANULADA no se trata como observacion: no se puede anular "por el id de la anulacion" ni aparece como una nueva', () => {
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    const l = leer({}, 'mod@x.com');
    expect(l.data.observaciones).toHaveLength(2);                                     // 2 observaciones (1 anulada), no 3 filas
    expect(l.data.observaciones.filter((o) => o.estado === 'ANULADA')).toHaveLength(1);
  });

  test('una observacion de otro pozo se anula igual: el pozo sale de la ALTA', () => {
    armar([alta(1, { wellId: W_OTRO })]);
    const r = anular({}, 'ana@x.com');
    expect(r.data.wellId).toBe(W_OTRO);
    expect(comoObjeto(datos()[1]).wellId).toBe(W_OTRO);
    expect(historial()).toEqual([['ana@x.com', 'anularObservacionPozo', W_OTRO, 'OK']]);
  });

  test('sin la hoja ObservacionesPozo -> SERVICE_UNAVAILABLE (nunca se crea sola), sin lock', () => {
    armar([], { sinHoja: true });
    expect(anular({})).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(ctx.lock.waits).toBe(0);
  });
});

describe('sin oraculo de observacionId: quien no es moderador no distingue inexistente / ajena / no verificable', () => {
  let buscar;
  beforeEach(() => {
    buscar = jest.fn(global.observacionesPozoRepository_buscarPorObservacionId);
    global.observacionesPozoRepository_buscarPorObservacionId = buscar;
  });

  test.each([['lector@x.com'], ['soloagregar@x.com'], ['soloanular@x.com'], ['nada@x.com'], ['sinclaves@x.com']])('A/I. %s (sin observaciones, o sin agregar ni anular): PERMISSION_DENIED SIN consultar el observacionId ni leer la hoja', (usuario) => {
    const leidas = jest.spyOn(hojas.ObservacionesPozo, 'getRange');
    const existente = anular({ observacionId: OBS_ANA }, usuario);
    const inexistente = anular({ observacionId: uuid(99) }, usuario);
    expect(existente).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(inexistente.code).toBe('PERMISSION_DENIED');
    expect(existente.message).toBe(inexistente.message);                              // existente o no: idem
    expect(buscar).not.toHaveBeenCalled();
    expect(leidas).not.toHaveBeenCalled();
    expect(historial().every((h) => h[2] === null && h[3] === 'PERMISSION_DENIED')).toBe(true);
  });

  const casos = () => {
    armar([
      alta(1), alta(2, { email: 'beto@x.com', nombre: 'Beto' }), alta(3, { email: 'no-es-un-email' }), alta(4, { email: '' }),
      alta(5, { email: 'beto@x.com', nombre: 'Beto' }), anulada(6, 5),                                                          // ajena y YA anulada
      alta(7, { secuencia: 8, email: 'ana@x.com' }), alta(8, { secuencia: 8, email: 'ana@x.com' }),                              // propia pero NO derivable (secuencia repetida)
      alta(9, { email: 'ana@x.com' }), alta(9, { email: 'ana@x.com', secuencia: 10, clientRequestId: 'prev-dup00010' })           // propia pero con ALTA duplicada
    ]);
    return {
      inexistente: uuid(99), ajena: uuid(2), emailInvalido: uuid(3), emailVacio: uuid(4), ajenaYaAnulada: uuid(5), propiaNoDerivable: uuid(7), propiaAltaDuplicada: uuid(9)
    };
  };

  test('B/C/D/E. autor con agregar: inexistente, ajena, email historico invalido o vacio, ajena ya anulada, propia no derivable y propia ambigua -> la MISMA respuesta PERMISSION_DENIED (codigo y mensaje), sin escribir', () => {
    const ids = casos();
    const respuestas = Object.keys(ids).map((k) => anular({ observacionId: ids[k] }, 'ana@x.com'));
    respuestas.forEach((r) => expect(r).toEqual({ status: 'error', code: 'PERMISSION_DENIED', message: 'no podes anular esta observacion' }));
    expect(datos()).toHaveLength(10);
    expect(ctx.escrituras).toEqual([]);
    expect(ctx.lock.waits).toBe(0);
  });

  test('la causa tecnica va a Logger como etiqueta fija, sin texto, motivo, email, nombre ni ids', () => {
    const ids = casos();
    Object.keys(ids).forEach((k) => anular({ observacionId: ids[k], motivo: 'MOTIVO-SECRETO-3' }, 'ana@x.com'));
    const registro = log();
    expect(registro).toMatch(/anulacion denegada \(NO_ENCONTRADA\)/);
    expect(registro).toMatch(/anulacion denegada \(AJENA\)/);
    expect(registro).toMatch(/anulacion denegada \(PROPIEDAD_NO_VERIFICABLE\)/);
    expect(registro).toMatch(/anulacion denegada \(NO_DERIVABLE\)/);
    sinRastro('MOTIVO-SECRETO-3', 'Texto previo', 'beto@x.com', 'no-es-un-email', OBS_ANA, uuid(99));
  });

  test('F. moderador + UUID inexistente -> OBSERVACION_NOT_FOUND; target ambiguo -> INCONSISTENT_STATE (el moderador si distingue)', () => {
    const ids = casos();
    expect(anular({ observacionId: ids.inexistente }, 'mod@x.com')).toMatchObject({ code: 'OBSERVACION_NOT_FOUND' });
    expect(anular({ observacionId: ids.propiaAltaDuplicada }, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(anular({ observacionId: ids.propiaNoDerivable }, 'mod@x.com')).toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(anular({ observacionId: ids.ajenaYaAnulada }, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  test('G. moderador + target ajeno (y con email historico invalido / vacio) -> puede anular', () => {
    armar([alta(2, { email: 'beto@x.com', nombre: 'Beto' }), alta(3, { email: 'no-es-un-email' }), alta(4, { email: '' })]);
    [uuid(2), uuid(3), uuid(4)].forEach((id) => expect(anular({ observacionId: id }, 'mod@x.com').status).toBe('ok'));
    expect(datos()).toHaveLength(6);
  });

  test('el usuario con agregar + anular (moderador) distingue como un moderador, aunque tambien sea autor', () => {
    casos();
    expect(anular({ observacionId: uuid(99) }, 'todo@x.com')).toMatchObject({ code: 'OBSERVACION_NOT_FOUND' });
  });

  test('autor con agregar + propia e inequivoca: continua; sobre su propia ya anulada ve INVALID_TRANSITION (es suya, no hay nada que ocultar)', () => {
    armar([alta(1)]);
    expect(anular({}, 'ana@x.com').status).toBe('ok');
    expect(anular({}, 'ana@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(anular({ clientRequestId: 'otro--12345678', motivo: 'otro motivo' }, 'ana@x.com').code).toBe('INVALID_TRANSITION');
  });

  test('H. reintento tras cambio de permisos: se recalcula el rol de HOY (moderador que pierde anular conserva agregar)', () => {
    // ajena: pierde -> PERMISSION_DENIED (identico a "no existe")
    anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;
    expect(anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com')).toEqual({ status: 'error', code: 'PERMISSION_DENIED', message: 'no podes anular esta observacion' });
    // propia: se resuelve como autor segun los permisos actuales (y sin texto)
    armar([alta(1, { email: 'todo@x.com', nombre: 'Todo' })]);
    const primera = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(primera.data.observacion.texto).toBe('Texto previo 1');
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;
    const reintento = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(reintento).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(reintento.data.observacion.texto).toBeNull();
    // y el autor que pierde agregar: PERMISSION_DENIED
    USUARIOS['todo@x.com'].permisos.observaciones_agregar = false;
    expect(anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com').code).toBe('PERMISSION_DENIED');
    expect(datos()).toHaveLength(2);
  });
});

describe('NO se consulta la existencia del pozo: la ALTA es la autoridad', () => {
  test('una observacion de un pozo sin NINGUNA fuente institucional se puede anular', () => {
    armar([alta(1, { wellId: W_OBS })]);
    const r = anular({}, 'ana@x.com');
    expect(r.status).toBe('ok');
    expect(r.data.wellId).toBe(W_OBS);
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
    expect(global.driveProfileRepository_existe).not.toHaveBeenCalled();
    expect(global.nivelesEstaticosRepository_getPunto).not.toHaveBeenCalled();
    expect(global.ubicacionCorreccionRepository_listarCorrecciones).not.toHaveBeenCalled();
  });

  test('aunque el ITF este caido (no se podria verificar el pozo) se anula igual', () => {
    armar([alta(1, { wellId: W_OBS })]);
    ctx.itfFalla = true;
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    expect(global.driveProfileRepository_existe).not.toHaveBeenCalled();
  });

  test('el pozo "desaparece" del padron entre la alta y la anulacion: se anula igual', () => {
    expect(agregar({ clientRequestId: 'alta--12345678' }).status).toBe('ok');
    ctx.padron.clear();
    const id = datos()[2][0];
    expect(anular({ observacionId: id }, 'ana@x.com').status).toBe('ok');
  });
});

describe('privacidad de la respuesta: el texto original solo con observaciones_anular', () => {
  test('el moderador recibe el texto original; el autor sin observaciones_anular recibe texto:null (sin excepcion por autoria); nadie recibe email ni clientRequestId', () => {
    const mod = anular({}, 'mod@x.com');
    expect(mod.data.observacion.texto).toBe('Texto previo 1');
    armar();
    const autor = anular({}, 'ana@x.com');
    expect(autor.status).toBe('ok');
    expect(autor.data.observacion.texto).toBeNull();
    expect(autor.data.observacion.estado).toBe('ANULADA');
    expect(autor.data.observacion.anulacion.motivo).toBe('Dato cargado por error');
    expect(JSON.stringify(autor)).not.toContain('Texto previo 1');
    expect(JSON.stringify([mod, autor])).not.toMatch(/@x\.com|clientRequestId|req-0/);
  });

  test('un usuario con agregar + anular anulando la PROPIA recibe el texto (tiene observaciones_anular)', () => {
    armar([alta(1, { email: 'todo@x.com', nombre: 'Todo' })]);
    expect(anular({}, 'todo@x.com').data.observacion.texto).toBe('Texto previo 1');
  });

  test('despues de anular, un lector comun ve la observacion ANULADA con texto null y el motivo; la moderadora ve el texto original', () => {
    expect(anular({ motivo: 'Cargada en el pozo equivocado' }, 'mod@x.com').status).toBe('ok');
    const comun = leer({}, 'lector@x.com');
    const o = comun.data.observaciones.find((x) => x.observacionId === OBS_ANA);
    expect(o).toMatchObject({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', motivo: 'Cargada en el pozo equivocado' } });
    expect(JSON.stringify(comun)).not.toContain('Texto previo 1');
    const moderadora = leer({}, 'mod@x.com').data.observaciones.find((x) => x.observacionId === OBS_ANA);
    expect(moderadora.texto).toBe('Texto previo 1');
    expect(comun.data.activas).toBe(1);
    expect(comun.data.anuladas).toBe(1);
  });

  test('el Historial y el Logger no contienen texto, motivo, email, observacionId ni clientRequestId', () => {
    expect(anular({ motivo: 'MOTIVO-PRIVADO-999', clientRequestId: 'privado-crid-123' }, 'mod@x.com').status).toBe('ok');
    anular({ motivo: 'MOTIVO-PRIVADO-999', clientRequestId: 'privado-crid-123' }, 'mod@x.com');               // reintento
    anular({ motivo: 'MOTIVO-PRIVADO-999' }, 'mod2@x.com');                                                    // transicion invalida
    sinRastro('MOTIVO-PRIVADO-999', 'Texto previo 1', OBS_ANA, 'privado-crid-123');
    expect(JSON.stringify(global.logHistoryEvent.mock.calls.map((c) => c.slice(1)))).not.toMatch(/@x\.com/);
  });
});

describe('Historial', () => {
  test('una fila anularObservacionPozo + pozo derivado de la ALTA + OK por anulacion creada; el reintento idempotente no escribe otra', () => {
    anular({ clientRequestId: 'hist--12345678' }, 'mod@x.com');
    anular({ clientRequestId: 'hist--12345678' }, 'mod@x.com');
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', W, 'OK']]);
  });

  test('errores con su codigo y sin texto libre (el pozo solo si ya se conocia por la ALTA)', () => {
    anular({}, 'beto@x.com');
    anular({ motivo: '' }, 'ana@x.com');
    anular({ observacionId: uuid(99) }, 'ana@x.com');
    anular({}, 'lector@x.com');
    expect(historial()).toEqual([
      ['beto@x.com', 'anularObservacionPozo', W, 'PERMISSION_DENIED'],
      ['ana@x.com', 'anularObservacionPozo', null, 'INVALID_MOTIVO'],
      ['ana@x.com', 'anularObservacionPozo', null, 'PERMISSION_DENIED'],
      ['lector@x.com', 'anularObservacionPozo', null, 'PERMISSION_DENIED']
    ]);
  });
});

describe('idempotencia: el clientRequestId se comparte con la alta (por usuario)', () => {
  test('mismo usuario + mismo id + misma intencion -> duplicada:true, SIN segunda fila, sin nueva secuencia, sin segundo Historial', () => {
    const primera = anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    const segunda = anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(primera.data.duplicada).toBe(false);
    expect(segunda).toMatchObject({ status: 'ok', data: { duplicada: true, wellId: W } });
    expect(segunda.data.observacion).toEqual(primera.data.observacion);
    expect(datos()).toHaveLength(3);
    expect(secuencias()).toEqual([1, 2, 3]);
    expect(ctx.escrituras).toHaveLength(1);
    expect(historial()).toHaveLength(1);
  });

  test('el reintento no toma el lock ni vuelve a escribir cuando la anulacion ya existe', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    const waits = ctx.lock.waits;
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(ctx.lock.waits).toBe(waits);
  });

  test('el motivo se compara NORMALIZADO: el mismo motivo con espacios y CRLF distintos en los extremos es la misma intencion', () => {
    anular({ clientRequestId: 'idem--12345678', motivo: 'linea uno\r\nlinea dos' }, 'mod@x.com');
    const r = anular({ clientRequestId: 'idem--12345678', motivo: '  linea uno\nlinea dos  ' }, 'mod@x.com');
    expect(r.data.duplicada).toBe(true);
    expect(datos()).toHaveLength(3);
  });

  test('mismo id con OTRO motivo -> IDEMPOTENCY_CONFLICT, sin escribir', () => {
    anular({ clientRequestId: 'idem--12345678', motivo: 'motivo uno' }, 'mod@x.com');
    const r = anular({ clientRequestId: 'idem--12345678', motivo: 'motivo dos' }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(3);
    sinRastro('motivo uno', 'motivo dos');
  });

  test('mismo id para OTRA observacion -> IDEMPOTENCY_CONFLICT', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    const r = anular({ clientRequestId: 'idem--12345678', observacionId: OBS_BETO }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(3);
  });

  test('un id usado antes para una ALTA (mismo usuario) -> IDEMPOTENCY_CONFLICT', () => {
    expect(agregar({ clientRequestId: 'alta--12345678' }).status).toBe('ok');
    const r = anular({ clientRequestId: 'alta--12345678' }, 'ana@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(3);
  });

  test('un id usado antes para anular no se puede reusar para una alta (el espacio es compartido)', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(agregar({ clientRequestId: 'idem--12345678' }, 'mod@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });   // la moderadora no agrega
    anular({ clientRequestId: 'otro--12345678', observacionId: OBS_BETO }, 'beto@x.com');
    const r = agregar({ clientRequestId: 'otro--12345678' }, 'beto@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('otro usuario con el MISMO id es independiente (cada uno anula lo suyo)', () => {
    expect(anular({ clientRequestId: 'comun-12345678' }, 'ana@x.com').data.duplicada).toBe(false);
    expect(anular({ clientRequestId: 'comun-12345678', observacionId: OBS_BETO }, 'beto@x.com').data.duplicada).toBe(false);
    expect(anular({ clientRequestId: 'comun-12345678', observacionId: uuid(77) }, 'mod@x.com')).toMatchObject({ code: 'OBSERVACION_NOT_FOUND' });
    expect(datos()).toHaveLength(4);
  });

  test('el mismo clientRequestId en varias filas del mismo usuario -> INCONSISTENT_STATE (no se elige)', () => {
    armar([alta(1), anulada(2, 1, { email: 'ana@x.com', nombre: 'Ana', clientRequestId: 'dupl--12345678' }), anulada(3, 1, { email: 'ana@x.com', nombre: 'Ana', clientRequestId: 'dupl--12345678' })]);
    expect(anular({ clientRequestId: 'dupl--12345678' }, 'ana@x.com')).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(datos()).toHaveLength(3);
  });

  test('el id de un usuario con otro email en mayusculas / espacios en la hoja sigue siendo SU id (email normalizado)', () => {
    armar([alta(1), anulada(2, 1, { email: '  ANA@x.com ', nombre: 'Ana', clientRequestId: 'norm--12345678', motivo: 'Dato cargado por error' })]);
    expect(anular({ clientRequestId: 'norm--12345678' }, 'ana@x.com')).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(datos()).toHaveLength(2);
  });

  test('un reintento cuya anulacion existe pero la observacion no figura como ANULADA en la lectura (inconsistencia) -> INCONSISTENT_STATE', () => {
    // la anulacion del usuario existe con ese id pero referencia OTRA observacion existente -> conflicto; y una que referencia una inexistente -> la observacion pedida sigue activa
    armar([alta(1), alta(2, { email: 'beto@x.com' }), anulada(3, 2, { email: 'ana@x.com', nombre: 'Ana', clientRequestId: 'otra--12345678' })]);
    expect(anular({ clientRequestId: 'otra--12345678' }, 'ana@x.com')).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('la idempotencia va despues de la autorizacion pero antes de la transicion: el reintento de una anulacion YA hecha no es "ya anulada"', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com').status).toBe('ok');
    expect(anular({ clientRequestId: 'nuevo-12345678' }, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
  });
});

describe('el reintento aplica los permisos ACTUALES: la idempotencia nunca es un bypass; el payload se reconstruye', () => {
  test('sin permiso hoy -> PERMISSION_DENIED aunque la anulacion ya exista (observaciones revocado)', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    USUARIOS['mod@x.com'].permisos.observaciones = false;
    expect(anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
  });

  test('un moderador que ademas agrega pierde observaciones_anular: el reintento de una anulacion AJENA ya hecha es PERMISSION_DENIED (la autorizacion del servicio va antes que la idempotencia)', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');                     // ajena: la ALTA es de Ana
    expect(anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com').data.duplicada).toBe(true);
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;                       // sigue pasando el handler (tiene agregar) pero ya no es moderador ni autora
    const r = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(JSON.stringify(r)).not.toContain('Texto previo 1');
    expect(datos()).toHaveLength(3);
  });

  test('sin permiso hoy -> PERMISSION_DENIED (se le saco observaciones_anular y no es el autor)', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    USUARIOS['mod@x.com'].permisos.observaciones_anular = false;
    const r = anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(JSON.stringify(r)).not.toContain('Texto previo 1');
  });

  test('el autor que pierde agregar: PERMISSION_DENIED en el reintento', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'ana@x.com');
    USUARIOS['ana@x.com'].permisos.observaciones_agregar = false;
    expect(anular({ clientRequestId: 'idem--12345678' }, 'ana@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('quien anulo con observaciones_anular (texto visible) y despues lo pierde pero sigue siendo el autor con agregar: el reintento llega con texto:null (payload reconstruido)', () => {
    armar([alta(1, { email: 'todo@x.com', nombre: 'Todo' })]);
    const primera = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(primera.data.observacion.texto).toBe('Texto previo 1');
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;
    const reintento = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(reintento).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(reintento.data.observacion.texto).toBeNull();
    expect(JSON.stringify(reintento)).not.toContain('Texto previo 1');
  });

  test('en el otro sentido: el autor sin observaciones_anular que luego lo recibe, ve el texto en el reintento', () => {
    armar([alta(1, { email: 'todo@x.com', nombre: 'Todo' })]);
    USUARIOS['todo@x.com'].permisos.observaciones_anular = false;
    const primera = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(primera.data.observacion.texto).toBeNull();
    USUARIOS['todo@x.com'].permisos.observaciones_anular = true;
    const reintento = anular({ clientRequestId: 'idem--12345678' }, 'todo@x.com');
    expect(reintento.data.duplicada).toBe(true);
    expect(reintento.data.observacion.texto).toBe('Texto previo 1');
  });

  test('un reintento no consume permisos para algo que NO hizo: otro usuario sin permiso con el mismo id recibe PERMISSION_DENIED, no el resultado del primero', () => {
    anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(anular({ clientRequestId: 'idem--12345678' }, 'beto@x.com')).toMatchObject({ code: 'PERMISSION_DENIED' });
  });
});

describe('secuencia, lock e integridad (como E5-2)', () => {
  test('la secuencia es max + 1 (global, no la del pozo) y la fila se escribe DENTRO del lock, una sola vez; el lock se libera', () => {
    armar([alta(1, { secuencia: 1 }), alta(2, { wellId: W_OTRO, secuencia: 9 })]);
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    expect(comoObjeto(datos()[2]).secuencia).toBe(10);
    expect(ctx.escrituras).toHaveLength(1);
    expect(ctx.escrituras[0].lockTomado).toBe(true);
    expect(ctx.lock).toMatchObject({ waits: 1, releases: 1, held: false });
  });

  test.each([['repetida', 9], ['cero', 0], ['negativa', -1], ['fraccionaria', 2.5], ['texto', 'abc']])('integridad global: una secuencia %s en OTRO pozo bloquea la escritura (SERVICE_UNAVAILABLE), sin escribir ni consumir secuencia', (_n, valor) => {
    armar(BASE().concat([alta(10, { wellId: W_OTRO, secuencia: valor }), alta(11, { wellId: W_OTRO, secuencia: 9 })]));
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    const r = anular({}, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
    expect(ctx.escrituras).toEqual([]);
    expect(ctx.lock).toMatchObject({ waits: 1, releases: 1, held: false });
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', null, 'SERVICE_UNAVAILABLE']]);
    expect(JSON.stringify(r)).not.toMatch(/figura en mas de una fila|ObservacionesPozo|secuencia/);
  });

  test('secuencia vacia (con observacionId) en otro pozo: tambien bloquea', () => {
    armar(BASE().concat([alta(10, { wellId: W_OTRO, secuencia: '' })]));
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(datos()).toHaveLength(3);
  });

  test('el detalle tecnico va a Logger SIN el motivo ni el texto', () => {
    armar(BASE().concat([alta(10, { wellId: W_OTRO, secuencia: 2 })]));
    anular({ motivo: 'MOTIVO-SECRETO-1' }, 'mod@x.com');
    expect(log()).toContain('excepcion');
    sinRastro('MOTIVO-SECRETO-1', 'Texto previo');
  });

  test('un reintento INEQUIVOCO sigue devolviendo duplicada:true aunque despues aparezca una corrupcion ajena', () => {
    const primera = anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(primera.status).toBe('ok');
    hojas.ObservacionesPozo.filas.push(alta(20, { wellId: W_OTRO, secuencia: 9 }), alta(21, { wellId: W_OTRO, secuencia: 9 }));
    const r = anular({ clientRequestId: 'idem--12345678' }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(ctx.escrituras).toHaveLength(1);
    expect(datos()).toHaveLength(5);
  });

  test('la corrupcion aparece MIENTRAS se espera el lock -> no se escribe', () => {
    ctx.lock.alAdquirir = () => { hojas.ObservacionesPozo.filas.push(alta(20, { wellId: W_OTRO, secuencia: 9 }), alta(21, { wellId: W_OTRO, secuencia: 9 })); };
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(ctx.escrituras).toEqual([]);
    expect(ctx.lock).toMatchObject({ waits: 1, releases: 1, held: false });
  });

  test('una falla de Sheets al escribir -> SERVICE_UNAVAILABLE, mensaje fijo, lock liberado, sin rastro de la fila', () => {
    ctx.falla = 'setValues';
    const r = anular({ motivo: 'MOTIVO-SECRETO-2' }, 'mod@x.com');
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: expect.stringMatching(/no se pudo anular/) });
    expect(JSON.stringify(r)).not.toMatch(/Spreadsheets|MOTIVO-SECRETO-2/);
    expect(datos()).toHaveLength(2);
    expect(ctx.lock).toMatchObject({ waits: 1, releases: 1, held: false });
    sinRastro('MOTIVO-SECRETO-2');
    expect(anular({}, 'mod@x.com').status).toBe('ok');                                  // y se puede reintentar
  });
});

describe('concurrencia (otra ejecucion se intercala justo al tomar el lock)', () => {
  test('A. autor vs moderador sobre la MISMA observacion: gana el primero en tomar el lock; el otro relee y falla coherente (INVALID_TRANSITION); una sola ANULADA', () => {
    let interna;
    ctx.lock.alAdquirir = () => { interna = anular({}, 'mod@x.com'); };
    const externa = anular({}, 'ana@x.com');
    expect(interna.status).toBe('ok');
    expect(interna.data.duplicada).toBe(false);
    expect(externa).toMatchObject({ status: 'error', code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(3);
    expect(datos().filter((f) => comoObjeto(f).evento === 'ANULADA')).toHaveLength(1);
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', W, 'OK'], ['ana@x.com', 'anularObservacionPozo', W, 'INVALID_TRANSITION']]);
  });

  test('A2. al reves: gana el autor, el moderador falla', () => {
    ctx.lock.alAdquirir = () => { anular({}, 'ana@x.com'); };
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(3);
    expect(comoObjeto(datos()[2]).email).toBe('ana@x.com');
  });

  test('B. dos moderadores a la vez: una sola ANULADA', () => {
    ctx.lock.alAdquirir = () => { anular({}, 'mod2@x.com'); };
    expect(anular({}, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(3);
    expect(comoObjeto(datos()[2]).email).toBe('mod2@x.com');
  });

  test('C. el MISMO clientRequestId simultaneo: UNA fila; la que llego segunda recibe duplicada:true; un solo Historial; una sola secuencia', () => {
    let interna;
    ctx.lock.alAdquirir = () => { interna = anular({ clientRequestId: 'mismo-12345678' }, 'mod@x.com'); };
    const externa = anular({ clientRequestId: 'mismo-12345678' }, 'mod@x.com');
    expect(interna.data.duplicada).toBe(false);
    expect(externa).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(externa.data.observacion).toEqual(interna.data.observacion);
    expect(datos()).toHaveLength(3);
    expect(secuencias()).toEqual([1, 2, 3]);
    expect(historial()).toEqual([['mod@x.com', 'anularObservacionPozo', W, 'OK']]);
  });

  test('D. dos clientRequestId DISTINTOS del mismo usuario sobre la misma observacion: la segunda es INVALID_TRANSITION', () => {
    ctx.lock.alAdquirir = () => { anular({ clientRequestId: 'uno---12345678' }, 'mod@x.com'); };
    expect(anular({ clientRequestId: 'dos---12345678' }, 'mod@x.com')).toMatchObject({ code: 'INVALID_TRANSITION' });
    expect(datos()).toHaveLength(3);
  });

  test('E. misma id y motivo DISTINTO simultaneos: la segunda es IDEMPOTENCY_CONFLICT', () => {
    ctx.lock.alAdquirir = () => { anular({ clientRequestId: 'conf--12345678', motivo: 'motivo uno' }, 'mod@x.com'); };
    expect(anular({ clientRequestId: 'conf--12345678', motivo: 'motivo dos' }, 'mod@x.com')).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(3);
  });

  test('F. una ALTA de OTRA observacion mientras se anula: las secuencias no se duplican', () => {
    ctx.lock.alAdquirir = () => { expect(agregar({ clientRequestId: 'beto--12345678', texto: 'otra observacion' }, 'beto@x.com').status).toBe('ok'); };
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    expect(secuencias()).toEqual([1, 2, 3, 4]);
    expect(comoObjeto(datos()[2]).evento).toBe('ALTA');
    expect(comoObjeto(datos()[3]).evento).toBe('ANULADA');
  });

  test('F2. al reves: una anulacion mientras se agrega', () => {
    ctx.lock.alAdquirir = () => { expect(anular({}, 'mod@x.com').status).toBe('ok'); };
    expect(agregar({ clientRequestId: 'beto--12345678', texto: 'otra observacion' }, 'beto@x.com').status).toBe('ok');
    expect(secuencias()).toEqual([1, 2, 3, 4]);
  });

  test('F3. varias anulaciones de observaciones DISTINTAS intercaladas: secuencias unicas y consecutivas', () => {
    for (let i = 0; i < 6; i += 1) {
      armar([alta(1), alta(2, { email: 'beto@x.com' }), alta(3, { email: 'ana@x.com' }), alta(4, { email: 'beto@x.com' })]);
      ctx.lock.alAdquirir = () => { anular({ observacionId: uuid(2) }, 'mod@x.com'); };
      expect(anular({ observacionId: uuid(1) }, 'ana@x.com').status).toBe('ok');
      expect(secuencias()).toEqual([1, 2, 3, 4, 5, 6]);
    }
  });

  test('G. la observacion se anula antes de que se tome el lock, con un reintento propio del mismo id: duplicada:true, sin nada nuevo', () => {
    ctx.lock.alAdquirir = () => { anular({ clientRequestId: 'mismo-12345678' }, 'ana@x.com'); };
    const r = anular({ clientRequestId: 'mismo-12345678' }, 'ana@x.com');
    expect(r.data.duplicada).toBe(true);
    expect(datos()).toHaveLength(3);
  });

  test('H. dentro del lock se relee la AUTORIZACION de la observacion: si el objetivo se vuelve ambiguo mientras se esperaba, no se escribe', () => {
    ctx.lock.alAdquirir = () => { hojas.ObservacionesPozo.filas.push(alta(1, { secuencia: 8, texto: 'duplicada', clientRequestId: 'prev-dup00008' })); };
    expect(anular({}, 'mod@x.com')).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(ctx.escrituras).toEqual([]);
  });
});

describe('contrato con la lectura y el resto del sistema', () => {
  test('la lectura (E5-1) y el alta (E5-2) siguen funcionando igual despues de anular', () => {
    expect(anular({}, 'mod@x.com').status).toBe('ok');
    const a = agregar({ texto: 'despues de anular' }, 'beto@x.com');
    expect(a.status).toBe('ok');
    expect(a.data.observacion.estado).toBe('ACTIVA');
    const l = leer({}, 'lector@x.com').data;
    expect(l.observaciones.map((o) => o.estado).sort()).toEqual(['ACTIVA', 'ACTIVA', 'ANULADA']);
  });

  test('"editar" sigue sin existir', () => {
    expect(post({ action: 'editarObservacionPozo', sessionToken: 'tok-ana@x.com' }).message).toMatch(/accion desconocida/);
  });

  test('la accion pasa por doPost con un cuerpo no objeto / sin datos sin romper: error de contenido o de permisos, nunca una excepcion', () => {
    expect(post({ action: 'anularObservacionPozo', sessionToken: 'tok-ana@x.com' })).toMatchObject({ status: 'error', code: 'INVALID_OBSERVACION_ID' });
    expect(post({ action: 'anularObservacionPozo' })).toMatchObject({ status: 'error', code: 'UNAUTHORIZED' });
  });
});

describe('guardas de codigo (fuente)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const cuerpoFuncion = (texto, nombre) => {
    const i = texto.indexOf('function ' + nombre + '(');
    const j = texto.indexOf('\nfunction ', i + 1);
    const k = texto.indexOf('\nif (typeof module', i + 1);
    return texto.slice(i, [j, k].filter((x) => x > 0).sort((a, b) => a - b)[0]);
  };

  test('el handler solo pasa observacionId, motivo y clientRequestId al servicio (no wellId, email, estado ni texto del cliente)', () => {
    const h = cuerpoFuncion(src('Api.js'), 'handleAnularObservacionPozo');
    expect(h).toMatch(/observacionId: d\.observacionId,\s*motivo: d\.motivo,\s*clientRequestId: d\.clientRequestId\s*\}/);
    expect(h).not.toMatch(/d\.(wellId|email|nombre|estado|texto|secuencia)/);
    const ruta = src('Api.js').slice(src('Api.js').indexOf("body.action === 'anularObservacionPozo'"));
    expect(ruta.slice(0, 400)).toMatch(/observacionId: body\.observacionId,\s*motivo: body\.motivo,\s*clientRequestId: body\.clientRequestId\s*\}\)/);
  });

  test('ninguna llamada al Historial ni a Logger del handler incluye motivo, texto, observacionId ni clientRequestId', () => {
    const h = cuerpoFuncion(src('Api.js'), 'handleAnularObservacionPozo');
    h.split('\n').filter((l) => /logHistoryEvent\(|Logger\.log\(/.test(l)).forEach((l) => expect(l).not.toMatch(/motivo|texto|observacionId|clientRequestId|d\.|datos/));
  });

  test('el servicio de anulacion no verifica existencia ni escribe en Logger el motivo / texto / email', () => {
    const s = src('ObservacionesPozoService.js');
    ['observacionesPozoService_anular', 'observacionesPozoService_decidirAnulacion', 'observacionesPozoService_resolverObjetivo', 'observacionesPozoService_atenderAnulacionExistente'].forEach((n) => {
      const c = cuerpoFuncion(s, n);
      expect(c).not.toMatch(/pozoExistenciaService_/);
      expect(c).not.toMatch(/Logger|observacionesPozoService_log\(/);
    });
  });
});
