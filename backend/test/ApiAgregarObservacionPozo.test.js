// agregarObservacionPozo (E5-2) de punta a punta por doPost, con el codigo REAL (Api -> permisos -> ObservacionesPozoService -> PozoExistenciaService -> repositorio con hoja en memoria).
// Solo se simulan la sesion/usuarios, Sheets, el Historial, el lock y las FUENTES de existencia (padron, ITF, NE, correcciones previas). Cubre permisos, existencia, texto, categoria,
// idempotencia, lock y secuencia, concurrencia (intercalando otra ejecucion justo al tomar el lock), fila escrita, formulas, Historial, payload, privacidad y la lectura posterior.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

let Api;
let Repo;
let hojas;
let ctx;
let contador = 0;

const W = '14-0001';                 // en el padron
const W_ITF = '14-0777';             // solo ITF
const W_NE = '14-0888';              // solo NE
const W_PREVIA = '14-0555';          // solo una correccion previa de ubicacion
const W_NADA = '14-0999';            // ninguna fuente
const W_OBS = '14-0666';             // tiene una observacion en la hoja, pero NINGUNA fuente institucional
const ISO = '2026-10-20T15:00:00.000Z';
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const COLUMNAS = require('../src/ObservacionesPozoRepository').OBSERVACIONES_POZO_COLUMNAS;

const USUARIOS = {
  'ana@x.com': { nombre: 'Ana', permisos: { observaciones: true, observaciones_agregar: true } },
  'beto@x.com': { nombre: 'Beto', permisos: { observaciones: true, observaciones_agregar: true } },
  'sinnombre@x.com': { nombre: null, permisos: { observaciones: true, observaciones_agregar: true } },
  'lector@x.com': { nombre: 'Lector', permisos: { observaciones: true } },
  'soloagregar@x.com': { nombre: 'Solo agregar', permisos: { observaciones_agregar: true } },
  'mod@x.com': { nombre: 'Moderadora', permisos: { observaciones: true, observaciones_anular: true } },
  'soloanular@x.com': { nombre: 'Solo anular', permisos: { observaciones_anular: true } },
  'todo@x.com': { nombre: 'Todo', permisos: { observaciones: true, observaciones_agregar: true, observaciones_anular: true } },
  'ubic@x.com': { nombre: 'Ubicacion', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true, datos: true, perfil: true, reemplazo: true, fotos: true, fotos_carga: true } },
  'nada@x.com': { nombre: 'Nada', permisos: {} },
  'sinclaves@x.com': { nombre: 'Sin claves', permisos: { perfil: true } },
  'baja@x.com': { nombre: 'Baja', permisos: { observaciones: true, observaciones_agregar: true }, inactivo: true }
};

const fila = (o) => COLUMNAS.map((c) => (o[c] === undefined ? '' : o[c]));
const alta = (n, extra) => fila(Object.assign({ observacionId: uuid(n), evento: 'ALTA', wellId: W, texto: 'Texto previo ' + n, email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: n, clientRequestId: 'prev-' + String(n).padStart(8, '0') }, extra || {}));

function armar(filas, opciones) {
  const o = opciones || {};
  contador = 0;
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  Api = require('../src/Api');
  Repo = require('../src/ObservacionesPozoRepository');
  const Service = require('../src/ObservacionesPozoService');
  Object.assign(global, Repo, Service);
  hojas = instalarSheetsFalsos(o.sinHoja ? {} : { ObservacionesPozo: [o.header || COLUMNAS].concat(filas || []) });
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[t.slice(4)] ? { valid: true, email: t.slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e] && USUARIOS[e].inactivo !== true, nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true && USUARIOS[e].permisos[m] === true);

  // FUENTES de existencia (PozoExistenciaService es el REAL; solo se simulan sus fuentes)
  ctx = { padron: new Set([W]), itf: new Set([W_ITF]), ne: new Set([W_NE]), correcciones: [W_PREVIA], itfFalla: false, escrituras: [], falla: null };
  global.registryService_getWellLocation = jest.fn((id) => (ctx.padron.has(id) ? { found: true, location: { wellId: id } } : { found: false }));
  global.driveProfileRepository_existe = jest.fn((id) => { if (ctx.itfFalla) { throw new Error('Drive caido'); } return ctx.itf.has(id); });
  global.nivelesEstaticosRepository_getPunto = jest.fn((id) => (ctx.ne.has(id) ? { found: true, punto: { wellId: id } } : { found: false }));
  global.ubicacionCorreccionRepository_listarCorrecciones = jest.fn(() => ctx.correcciones.map((w) => ({ wellId: w })));
  const real = global.pozoExistenciaService_verificar;
  global.pozoExistenciaService_verificar = jest.fn(real);

  // LOCK: registra si esta tomado, cuantas veces se toma / libera, y permite intercalar OTRA ejecucion justo al tomarlo (concurrencia)
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

  // ESCRITURAS: cada setValues de una fila de datos queda registrado (y si el lock estaba tomado); se puede hacer fallar
  const hoja = hojas.ObservacionesPozo;
  if (hoja) {
    const original = hoja.getRange.bind(hoja);
    hoja.getRange = (f, c, nf, nc) => {
      const g = original(f, c, nf, nc);
      if (f > 1 && nf === 1 && nc === (o.header || COLUMNAS).length) {
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
const agregar = (extra, usuario) => post(Object.assign({ action: 'agregarObservacionPozo', sessionToken: 'tok-' + (usuario || 'ana@x.com'), wellId: W, texto: 'Se observa bomba instalada', clientRequestId: rid() }, extra || {}));
const leer = (extra, usuario) => post(Object.assign({ action: 'getObservacionesPozo', sessionToken: 'tok-' + (usuario || 'lector@x.com'), wellId: W }, extra || {}));
const historial = () => global.logHistoryEvent.mock.calls.map((c) => c.slice());
const datos = () => hojas.ObservacionesPozo.filas.slice(1);
const comoObjeto = (f) => { const x = {}; COLUMNAS.forEach((c, i) => { x[c] = f[i]; }); return x; };
const secuencias = () => datos().map((f) => comoObjeto(f).secuencia);

beforeEach(() => { armar([]); });
afterEach(() => { jest.restoreAllMocks(); });

describe('enrutado y contrato de la respuesta', () => {
  test('la accion existe; anular y editar siguen sin existir (E5-3 / nunca)', () => {
    expect(agregar().status).toBe('ok');
    expect(post({ action: 'anularObservacionPozo', sessionToken: 'tok-ana@x.com' }).message).toMatch(/accion desconocida/);
    expect(post({ action: 'editarObservacionPozo', sessionToken: 'tok-ana@x.com' }).message).toMatch(/accion desconocida/);
  });

  test('payload: {wellId, duplicada, observacion} con la observacion en el MISMO contrato que la lectura (sin email, sin secuencia, sin clientRequestId)', () => {
    const r = agregar({ texto: '  Hola\r\nmundo  ' });
    expect(Object.keys(r.data).sort()).toEqual(['duplicada', 'observacion', 'wellId']);
    expect(r.data).toMatchObject({ wellId: W, duplicada: false });
    expect(Object.keys(r.data.observacion).sort()).toEqual(['anulacion', 'categoria', 'estado', 'nombre', 'observacionId', 'texto', 'timestamp', 'wellId']);
    expect(r.data.observacion).toMatchObject({ wellId: W, estado: 'ACTIVA', texto: 'Hola\nmundo', categoria: null, nombre: 'Ana', anulacion: null });
    expect(r.data.observacion.observacionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(new Date(r.data.observacion.timestamp).toISOString()).toBe(r.data.observacion.timestamp);
    expect(Math.abs(Date.now() - new Date(r.data.observacion.timestamp).getTime())).toBeLessThan(5000);
  });

  test('la respuesta no trae email, clientRequestId ni secuencia', () => {
    const r = agregar({ clientRequestId: 'privado-12345' });
    const txt = JSON.stringify(r);
    expect(txt).not.toMatch(/@|ana@x\.com|clientRequestId|privado-12345|secuencia/);
  });

  test('autor sin nombre en Usuarios: la etiqueta neutra "Usuario" (nunca el email)', () => {
    const r = agregar({}, 'sinnombre@x.com');
    expect(r.data.observacion.nombre).toBe('Usuario');
    expect(JSON.stringify(r)).not.toContain('@');
  });
});

describe('permisos: observaciones + observaciones_agregar, ambos exactos (fail-closed)', () => {
  test.each([['ana@x.com'], ['beto@x.com'], ['todo@x.com']])('%s (observaciones + observaciones_agregar): puede', (u) => {
    expect(agregar({}, u).status).toBe('ok');
  });

  test.each([
    ['observaciones SIN agregar', 'lector@x.com'], ['agregar SIN observaciones', 'soloagregar@x.com'], ['observaciones + anular, sin agregar (anular no sustituye a agregar)', 'mod@x.com'],
    ['solo anular', 'soloanular@x.com'], ['todos los permisos de ubicacion / datos / perfil / reemplazo / fotos', 'ubic@x.com'], ['sin ningun permiso', 'nada@x.com'],
    ['permisos ausentes (las columnas no existen en Usuarios)', 'sinclaves@x.com']
  ])('%s -> PERMISSION_DENIED: no se escribe, no se verifica existencia y queda en Historial', (n, u) => {
    const r = agregar({}, u);
    expect(r).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    expect(datos()).toEqual([]);
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
    expect(historial()).toEqual([[u, 'agregarObservacionPozo', W, 'PERMISSION_DENIED']]);
  });

  test('valores truthy que no son exactamente true (1, "SI", "true", objetos) no habilitan', () => {
    [1, 'SI', 'true', {}, [], 'x'].forEach((v) => {
      USUARIOS['raro@x.com'] = { nombre: 'Raro', permisos: { observaciones: v, observaciones_agregar: v } };
      expect(agregar({}, 'raro@x.com')).toMatchObject({ status: 'error', code: 'PERMISSION_DENIED' });
    });
    USUARIOS['raro@x.com'] = { nombre: 'Raro', permisos: { observaciones: true, observaciones_agregar: 'SI' } };
    expect(agregar({}, 'raro@x.com').code).toBe('PERMISSION_DENIED');
    delete USUARIOS['raro@x.com'];
    expect(datos()).toEqual([]);
  });

  test.each([['baja@x.com', 'USER_DISABLED'], ['nadie@x.com', 'UNAUTHORIZED']])('%s -> %s', (u, code) => {
    expect(agregar({}, u)).toMatchObject({ status: 'error', code });
    expect(datos()).toEqual([]);
  });

  test('token vacio o ausente -> UNAUTHORIZED', () => {
    expect(post({ action: 'agregarObservacionPozo', sessionToken: '', wellId: W, texto: 'abc', clientRequestId: rid() }).code).toBe('UNAUTHORIZED');
    expect(post({ action: 'agregarObservacionPozo', wellId: W, texto: 'abc', clientRequestId: rid() }).code).toBe('UNAUTHORIZED');
  });

  test('el formato del wellId se valida DESPUES de la sesion y ANTES del permiso', () => {
    expect(agregar({ wellId: 'x' }, 'nada@x.com').code).toBe('INVALID_WELL_ID');
    expect(agregar({ wellId: 'x' }, 'nadie@x.com').code).toBe('UNAUTHORIZED');
  });

  test.each([['x'], ['99-0001'], ['00-0001'], ['14-001'], [''], [null], [undefined], [['14-0001']], [{ a: 1 }], [14]])('wellId invalido %j -> INVALID_WELL_ID, nada escrito', (w) => {
    expect(agregar({ wellId: w })).toMatchObject({ status: 'error', code: 'INVALID_WELL_ID' });
    expect(datos()).toEqual([]);
  });

  test('el cuerpo no puede pedir permisos ni identidad: email / nombre / permisos / moderador se ignoran', () => {
    const r = agregar({ email: 'mod@x.com', nombre: 'Falso', permisos: { observaciones_agregar: true }, moderador: true }, 'lector@x.com');
    expect(r.code).toBe('PERMISSION_DENIED');
  });
});

describe('existencia del pozo: PozoExistenciaService (padron, ITF, NE, correccion previa)', () => {
  test.each([
    ['en el padron', W], ['solo conocido por el ITF', W_ITF], ['solo conocido por NE', W_NE], ['solo con una correccion previa de ubicacion', W_PREVIA]
  ])('%s: se escribe', (n, wellId) => {
    const r = agregar({ wellId: wellId });
    expect(r.status).toBe('ok');
    expect(datos()).toHaveLength(1);
    expect(comoObjeto(datos()[0]).wellId).toBe(wellId);
    expect(global.pozoExistenciaService_verificar).toHaveBeenCalledWith(wellId);
  });

  test('un pozo que ninguna fuente conoce -> WELL_NOT_FOUND: no se escribe nada y queda en Historial', () => {
    const r = agregar({ wellId: W_NADA });
    expect(r).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(datos()).toEqual([]);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W_NADA, 'WELL_NOT_FOUND']]);
  });

  test('una fuente que no se pudo verificar y ninguna confirma -> SERVICE_UNAVAILABLE (un error de Drive no es "no existe"): nada escrito', () => {
    ctx.itfFalla = true;
    const r = agregar({ wellId: W_NADA });
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(datos()).toEqual([]);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W_NADA, 'SERVICE_UNAVAILABLE']]);
  });

  test('una fuente que falla pero otra confirma: existe y se escribe (el servicio corta en la primera que confirma)', () => {
    ctx.itfFalla = true;
    ctx.ne.add(W_NADA);
    expect(agregar({ wellId: W_NADA }).status).toBe('ok');
  });

  test('un pozo con una OBSERVACION previa pero ninguna evidencia institucional NO existe por Observaciones: WELL_NOT_FOUND', () => {
    armar([alta(1, { wellId: W_OBS })]);
    const r = agregar({ wellId: W_OBS });
    expect(r).toMatchObject({ status: 'error', code: 'WELL_NOT_FOUND' });
    expect(datos()).toHaveLength(1);
    // pero SE LEE (leer no verifica existencia)
    expect(leer({ wellId: W_OBS }).data.total).toBe(1);
  });

  test('usa PozoExistenciaService y NO agrega Observaciones como fuente ni duplica su logica', () => {
    const fs = require('fs');
    const path = require('path');
    const servicio = fs.readFileSync(path.join(__dirname, '..', 'src', 'ObservacionesPozoService.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(servicio).toMatch(/pozoExistenciaService_verificar\(wellId\)/);
    expect(servicio).not.toMatch(/driveProfileRepository_|nivelesEstaticosRepository_|registryService_|registryRepository_|ubicacionCorreccionRepository_/);
    const existencia = require('../src/PozoExistenciaService');
    expect(Object.keys(existencia.POZO_EXISTENCIA_FUENTES).sort()).toEqual(['CORRECCION_PREVIA', 'ITF', 'NE', 'PADRON']);
    const codigoExistencia = fs.readFileSync(path.join(__dirname, '..', 'src', 'PozoExistenciaService.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');       // sin comentarios
    expect(codigoExistencia).not.toMatch(/ObservacionesPozo|observacionesPozo|OBSERVACION_PREVIA|OBSERVACION/);
  });

  test('con una entrada invalida NO se consulta la existencia (primero lo barato)', () => {
    agregar({ texto: 'a' });
    agregar({ categoria: 'X' });
    agregar({ clientRequestId: 'x' });
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
  });

  test('un reenvio idempotente NO vuelve a verificar la existencia (aunque la fuente haya desaparecido)', () => {
    const id = rid();
    expect(agregar({ wellId: W_ITF, clientRequestId: id }).status).toBe('ok');
    ctx.itf.delete(W_ITF);
    global.pozoExistenciaService_verificar.mockClear();
    global.CacheService = { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {} }) };           // vence el cache de existencia
    const r = agregar({ wellId: W_ITF, clientRequestId: id });
    expect(r).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
  });
});

describe('texto', () => {
  test('se guarda NORMALIZADO: trim, CRLF -> LF, tabulador -> espacio, sin controles; se conservan emoji, acentos, espacios internos y lineas en blanco', () => {
    const r = agregar({ texto: '  Pozo con ñ y acentos: cañería 🚧\r\n\r\nSegunda  linea\tcon tab\u0000\u0007 ' });
    expect(r.status).toBe('ok');
    expect(comoObjeto(datos()[0]).texto).toBe('Pozo con ñ y acentos: cañería 🚧\n\nSegunda  linea con tab');
    expect(r.data.observacion.texto).toBe('Pozo con ñ y acentos: cañería 🚧\n\nSegunda  linea con tab');
  });

  test.each([[3, true], [2, false], [1000, true], [1001, false]])('%i caracteres -> ok: %s', (n, ok) => {
    const r = agregar({ texto: 'a'.repeat(n) });
    expect(r.status).toBe(ok ? 'ok' : 'error');
    if (!ok) { expect(r.code).toBe('INVALID_TEXTO'); }
  });

  test.each([[undefined], [null], [''], ['   '], ['\n\t\r\n'], ['\u0000\u0001'], [42], [{}], [['abc']], ['ab'], ['  ab  ']])('texto %j -> INVALID_TEXTO y NO se escribe', (texto) => {
    const r = agregar({ texto: texto });
    expect(r).toMatchObject({ status: 'error', code: 'INVALID_TEXTO' });
    expect(datos()).toEqual([]);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'INVALID_TEXTO']]);
  });

  test('el error NO repite el contenido (ni en el mensaje ni en Historial ni en Logger)', () => {
    const r = agregar({ texto: 'zz' });
    expect(r.message).not.toContain('zz');
    expect(JSON.stringify(historial())).not.toContain('zz');
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).not.toContain('zz');
  });

  test.each([['='], ['+'], ['-'], ['@'], ['=SUM(1)'], ["'="], ['+54 261 4444444'], ['-1 metro'], ['@usuario']])('un texto que empieza con %j se guarda como TEXTO, tal cual, con formato de texto plano', (inicio) => {
    const texto = inicio + ' observacion';
    const r = agregar({ texto: texto });
    expect(r.status).toBe('ok');
    expect(comoObjeto(datos()[0]).texto).toBe(texto);
    expect(hojas.ObservacionesPozo.formatos['2:' + (COLUMNAS.indexOf('texto') + 1)]).toBe('@');
    expect(leer().data.observaciones[0].texto).toBe(texto);
  });

  test('una formula completa como texto: no se modifica ni se evalua (el valor guardado es exactamente el escrito)', () => {
    const f = '=HYPERLINK("http://malo.example","clic")';
    agregar({ texto: f });
    expect(comoObjeto(datos()[0]).texto).toBe(f);
    COLUMNAS.forEach((c, i) => expect(hojas.ObservacionesPozo.formatos['2:' + (i + 1)]).toBe(c === 'secuencia' ? '0' : '@'));
  });
});

describe('categoria (reservada)', () => {
  test.each([[{}], [{ categoria: undefined }], [{ categoria: null }], [{ categoria: '' }], [{ categoria: '  ' }]])('%j -> ok, se guarda vacia y la respuesta trae categoria null', (extra) => {
    armar([]);
    const r = agregar(extra);
    expect(r.status).toBe('ok');
    expect(comoObjeto(datos()[0]).categoria).toBe('');
    expect(r.data.observacion.categoria).toBeNull();
  });

  test.each([['OTRO'], ['Acceso'], [' OTRO '], [0], [1], [false], [true], [{}], [[]], [{ id: 1 }]])('categoria %j -> INVALID_CATEGORIA (no se ignora): nada escrito', (categoria) => {
    const r = agregar({ categoria: categoria });
    expect(r).toMatchObject({ status: 'error', code: 'INVALID_CATEGORIA' });
    expect(datos()).toEqual([]);
    expect(global.pozoExistenciaService_verificar).not.toHaveBeenCalled();
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'INVALID_CATEGORIA']]);
  });
});

describe('clientRequestId', () => {
  test.each([[undefined], [null], [''], ['abc'], ['con espacio!'], ['x'.repeat(65)], [12345678], [{}]])('%j -> INVALID_CLIENT_REQUEST_ID', (id) => {
    expect(agregar({ clientRequestId: id })).toMatchObject({ status: 'error', code: 'INVALID_CLIENT_REQUEST_ID' });
    expect(datos()).toEqual([]);
  });

  test.each([['abcd1234'], ['A_b-C_d-1'], ['x'.repeat(64)]])('%s es valido', (id) => {
    expect(agregar({ clientRequestId: id }).status).toBe('ok');
  });
});

describe('idempotencia por (usuario normalizado, clientRequestId)', () => {
  test('mismo request exacto: devuelve la observacion YA creada con duplicada:true, sin segunda fila, sin consumir secuencia y SIN segundo Historial', () => {
    const id = rid();
    const a = agregar({ clientRequestId: id });
    const b = agregar({ clientRequestId: id });
    expect(a.data.duplicada).toBe(false);
    expect(b).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(b.data.observacion).toEqual(a.data.observacion);                          // la misma (mismo observacionId y fecha)
    expect(datos()).toHaveLength(1);
    expect(secuencias()).toEqual([1]);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'OK']]);
    expect(agregar().data.observacion.observacionId).not.toBe(a.data.observacion.observacionId);
    expect(secuencias()).toEqual([1, 2]);                                            // la siguiente alta toma la 2: la duplicada no consumio ninguna
  });

  test('tras un error de red (el servidor SI guardo pero el cliente no lo supo): el reintento con los mismos datos devuelve la ya creada', () => {
    const id = rid();
    const original = agregar({ clientRequestId: id });
    // el cliente nunca vio la respuesta y reintenta tal cual
    const reintento = agregar({ clientRequestId: id });
    expect(reintento.data).toMatchObject({ duplicada: true });
    expect(reintento.data.observacion.observacionId).toBe(original.data.observacion.observacionId);
    expect(datos()).toHaveLength(1);
  });

  test('el reintento de una solicitud que FALLO antes de guardar (la escritura se cayo) SI crea la observacion, y recien el siguiente reintento es duplicado', () => {
    const id = rid();
    ctx.falla = 'setValues';
    const falla = agregar({ clientRequestId: id });
    expect(falla).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(datos()).toEqual([]);
    const ok = agregar({ clientRequestId: id });
    expect(ok).toMatchObject({ status: 'ok', data: { duplicada: false } });
    expect(agregar({ clientRequestId: id }).data.duplicada).toBe(true);
    expect(datos()).toHaveLength(1);
    expect(secuencias()).toEqual([1]);
  });

  test('la escritura se completo pero algo fallo DESPUES (flush): SERVICE_UNAVAILABLE, y el reintento encuentra la fila (duplicada:true, una sola)', () => {
    const id = rid();
    global.SpreadsheetApp.flush = () => { throw new Error('flush caido'); };
    expect(agregar({ clientRequestId: id }).code).toBe('SERVICE_UNAVAILABLE');
    expect(datos()).toHaveLength(1);
    global.SpreadsheetApp.flush = () => {};
    expect(agregar({ clientRequestId: id }).data.duplicada).toBe(true);
    expect(datos()).toHaveLength(1);
  });

  test('mismo id con el texto normalizado EQUIVALENTE (otros espacios en los extremos, CRLF, tab) es el mismo contenido: duplicada', () => {
    const id = rid();
    agregar({ clientRequestId: id, texto: 'linea 1\nlinea 2 final' });
    expect(agregar({ clientRequestId: id, texto: '  linea 1\r\nlinea 2 final \n' }).data.duplicada).toBe(true);
    expect(agregar({ clientRequestId: id, texto: 'linea 1\nlinea 2\u0000 final' }).data.duplicada).toBe(true);
    expect(datos()).toHaveLength(1);
  });

  test('mismo id con otro TEXTO -> IDEMPOTENCY_CONFLICT (nada escrito, sin eco del contenido)', () => {
    const id = rid();
    agregar({ clientRequestId: id, texto: 'primero' });
    const r = agregar({ clientRequestId: id, texto: 'segundo-secreto' });
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(JSON.stringify(r)).not.toContain('segundo-secreto');
    expect(datos()).toHaveLength(1);
    expect(historial().map((h) => h[3])).toEqual(['OK', 'IDEMPOTENCY_CONFLICT']);
  });

  test('mismo id con otro wellId -> IDEMPOTENCY_CONFLICT (aunque el pozo nuevo existiria)', () => {
    const id = rid();
    agregar({ clientRequestId: id });
    expect(agregar({ clientRequestId: id, wellId: W_ITF })).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(agregar({ clientRequestId: id, wellId: W_NADA })).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(1);
  });

  test('mismo id con otra CATEGORIA: se rechaza por INVALID_CATEGORIA antes de cualquier otra cosa; y una fila ya guardada con categoria no vacia (manual) tambien es conflicto', () => {
    const id = rid();
    agregar({ clientRequestId: id });
    expect(agregar({ clientRequestId: id, categoria: 'OTRO' }).code).toBe('INVALID_CATEGORIA');
    armar([alta(1, { categoria: 'Acceso', clientRequestId: 'manual-12345', texto: 'Se observa bomba instalada' })]);
    expect(agregar({ clientRequestId: 'manual-12345' }).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  test('el id es por USUARIO: otro usuario con el mismo clientRequestId crea la suya', () => {
    const id = rid();
    const a = agregar({ clientRequestId: id }, 'ana@x.com');
    const b = agregar({ clientRequestId: id }, 'beto@x.com');
    expect(b.data.duplicada).toBe(false);
    expect(b.data.observacion.observacionId).not.toBe(a.data.observacion.observacionId);
    expect(datos()).toHaveLength(2);
    expect(secuencias()).toEqual([1, 2]);
  });

  test('el usuario se compara normalizado (el email de la sesion y el guardado en minuscula)', () => {
    const id = rid();
    agregar({ clientRequestId: id });
    expect(comoObjeto(datos()[0]).email).toBe('ana@x.com');
    expect(agregar({ clientRequestId: id }).data.duplicada).toBe(true);
  });

  test('el mismo id ya usado por una ANULADA (otro tipo de evento) -> IDEMPOTENCY_CONFLICT', () => {
    // la ANULADA tiene el MISMO wellId y texto que el pedido: solo el TIPO de evento la distingue de un reenvio
    armar([alta(1), fila({ observacionId: uuid(1), evento: 'ANULADA', wellId: W, texto: 'Se observa bomba instalada', motivo: 'x', email: 'ana@x.com', secuencia: 2, clientRequestId: 'anul-1234567' })]);
    expect(agregar({ clientRequestId: 'anul-1234567' })).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('el id aparece dos veces para el mismo usuario (hoja corrupta) -> INCONSISTENT_STATE: no se elige ni se escribe', () => {
    armar([alta(1, { clientRequestId: 'dup-1234567' }), alta(2, { clientRequestId: 'dup-1234567' })]);
    expect(agregar({ clientRequestId: 'dup-1234567' })).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(datos()).toHaveLength(2);
  });

  test('un reenvio cuya observacion existente es AMBIGUA para el modelo de lectura (identidad duplicada) -> INCONSISTENT_STATE', () => {
    armar([alta(1, { clientRequestId: 'amb-1234567', texto: 'Se observa bomba instalada' }), alta(2, { observacionId: uuid(1), clientRequestId: 'otro-1234567' })]);
    expect(agregar({ clientRequestId: 'amb-1234567' })).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
  });
});

describe('lock y secuencia global', () => {
  test('la secuencia empieza en 1 y crece de a 1; el id y la fecha los genera el servidor', () => {
    agregar();
    agregar();
    agregar();
    expect(secuencias()).toEqual([1, 2, 3]);
    expect(new Set(datos().map((f) => comoObjeto(f).observacionId)).size).toBe(3);
  });

  test('continua desde el MAXIMO existente (no desde la cantidad de filas ni por fecha)', () => {
    armar([alta(5), alta(9), alta(2)]);
    agregar();
    expect(secuencias()[3]).toBe(10);
  });

  test('TODA escritura ocurre con el lock tomado; se libera siempre (tambien tras un error) y no quedan locks colgados', () => {
    agregar();
    ctx.falla = 'setValues';
    agregar();
    agregar({ texto: 'x' });                                                          // invalido: ni siquiera toma el lock
    agregar({ wellId: W_NADA });                                                      // WELL_NOT_FOUND: no toma el lock
    expect(ctx.escrituras.every((e) => e.lockTomado === true)).toBe(true);
    expect(ctx.lock.held).toBe(false);
    expect(ctx.lock.waits).toBe(ctx.lock.releases);
    expect(ctx.lock.waits).toBe(2);
  });

  test('una hoja con una secuencia ilegible -> SERVICE_UNAVAILABLE y NO se escribe nada (no se arregla en silencio)', () => {
    armar([alta(1), alta(2, { secuencia: 'abc' })]);
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    const r = agregar();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
    expect(ctx.lock.held).toBe(false);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'SERVICE_UNAVAILABLE']]);
  });

  test('un observacionId sin secuencia en la hoja tambien impide escribir', () => {
    armar([alta(1, { secuencia: '' })]);
    expect(agregar().code).toBe('SERVICE_UNAVAILABLE');
    expect(datos()).toHaveLength(1);
  });

  test('E. con secuencias sanas: max + 1 como siempre (y sin importar el orden de las filas)', () => {
    armar([alta(5), alta(2), alta(9)]);
    expect(agregar().status).toBe('ok');
    expect(secuencias()).toEqual([5, 2, 9, 10]);
  });
});

describe('integridad GLOBAL de las secuencias: una repetida bloquea toda NUEVA escritura (pero no un reintento inequivoco)', () => {
  const sinTextoLibre = () => {
    const todo = JSON.stringify(historial()) + global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(todo).not.toContain('texto-secreto-777');
  };

  test('A. dos eventos con la misma secuencia + alta nueva -> SERVICE_UNAVAILABLE, 0 filas nuevas, 0 secuencias consumidas', () => {
    armar([alta(1, { secuencia: 4 }), alta(2, { secuencia: 4 })]);
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    const r = agregar({ texto: 'texto-secreto-777' });
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(r.message).toBe('no se pudo guardar la observacion: intenta de nuevo en unos minutos');
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
    expect(ctx.escrituras).toEqual([]);
    expect(ctx.lock.held).toBe(false);
    expect(ctx.lock.waits).toBe(ctx.lock.releases);
    // 0 secuencias consumidas: tras reparar la hoja a mano, la siguiente alta toma max + 1 (sin saltos)
    hojas.ObservacionesPozo.filas[2][COLUMNAS.indexOf('secuencia')] = 5;
    expect(agregar().status).toBe('ok');
    expect(secuencias()).toEqual([4, 5, 6]);
  });

  test('una repetida que NO es la maxima, y entre pozos distintos, tambien bloquea (la secuencia es global)', () => {
    armar([alta(1, { secuencia: 1 }), alta(2, { secuencia: 9 }), alta(3, { secuencia: 1, wellId: '14-0002' })]);
    expect(agregar().code).toBe('SERVICE_UNAVAILABLE');
    expect(datos()).toHaveLength(3);
  });

  test('D. dos eventos distintos con la misma secuencia aunque sean ALTA y ANULADA: la nueva escritura queda bloqueada', () => {
    armar([alta(1), fila({ observacionId: uuid(1), evento: 'ANULADA', wellId: W, motivo: 'x', email: 'mod@x.com', secuencia: 1, clientRequestId: 'anul-1234567' })]);
    expect(agregar().code).toBe('SERVICE_UNAVAILABLE');
    expect(datos()).toHaveLength(2);
    expect(ctx.escrituras).toEqual([]);
  });

  test('B. secuencia repetida NO relacionada + reintento idempotente inequivoco existente: duplicada:true, no escribe y no consume secuencia', () => {
    const id = rid();
    const original = agregar({ clientRequestId: id });
    expect(original.data.duplicada).toBe(false);
    // despues aparece una corrupcion ajena (en otro pozo y en el mismo pozo, entre otras observaciones)
    hojas.ObservacionesPozo.filas.push(alta(600, { wellId: '14-0002', secuencia: 50 }), alta(601, { wellId: '14-0002', secuencia: 50 }), alta(602, { secuencia: 60 }), alta(603, { secuencia: 60 }));
    const filasAntes = datos().length;
    const escriturasAntes = ctx.escrituras.length;
    const historialAntes = historial().length;
    const reintento = agregar({ clientRequestId: id });
    expect(reintento).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(reintento.data.observacion).toEqual(original.data.observacion);
    expect(datos()).toHaveLength(filasAntes);
    expect(ctx.escrituras).toHaveLength(escriturasAntes);
    expect(historial()).toHaveLength(historialAntes);
    // y una alta NUEVA si queda bloqueada por esa misma corrupcion
    expect(agregar().code).toBe('SERVICE_UNAVAILABLE');
    expect(datos()).toHaveLength(filasAntes);
  });

  test('B2. la secuencia repetida involucra a la PROPIA observacion del reintento: el modelo de lectura la oculta (ambigua), asi que no se devuelve -> INCONSISTENT_STATE, sin escribir', () => {
    const id = rid();
    agregar({ clientRequestId: id });                                                // seq 1
    hojas.ObservacionesPozo.filas.push(alta(700, { secuencia: 1 }));
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    expect(agregar({ clientRequestId: id })).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
  });

  test('C. secuencia repetida + el MISMO clientRequestId ambiguo (figura dos veces) -> INCONSISTENT_STATE, sin escribir', () => {
    armar([alta(1, { secuencia: 4, clientRequestId: 'dup-1234567' }), alta(2, { secuencia: 4, clientRequestId: 'dup-1234567' })]);
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    expect(agregar({ clientRequestId: 'dup-1234567' })).toMatchObject({ status: 'error', code: 'INCONSISTENT_STATE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
    expect(ctx.escrituras).toEqual([]);
  });

  test('F. concurrencia: otra ejecucion deja la fila de ESTE pedido y una corrupcion ajena justo al tomar el lock -> el reintento inequivoco gana (duplicada:true), sin segunda escritura ni secuencia', () => {
    const id = 'carrera-1234567';
    ctx.lock.alAdquirir = () => {
      hojas.ObservacionesPozo.filas.push(
        fila({ observacionId: uuid(500), evento: 'ALTA', wellId: W, texto: 'Se observa bomba instalada', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, secuencia: 7, clientRequestId: id }),
        alta(600, { wellId: '14-0002', secuencia: 9 }), alta(601, { wellId: '14-0002', secuencia: 9 })
      );
    };
    const r = agregar({ clientRequestId: id });
    expect(r).toMatchObject({ status: 'ok', data: { duplicada: true } });
    expect(r.data.observacion.observacionId).toBe(uuid(500));
    expect(ctx.escrituras).toEqual([]);
    expect(datos()).toHaveLength(3);
    expect(historial()).toEqual([]);
  });

  test('F2. concurrencia sin corrupcion: sigue sin producir secuencias duplicadas', () => {
    for (let i = 0; i < 12; i += 1) {
      if (i % 2 === 0) { ctx.lock.alAdquirir = () => { agregar({ texto: 'intercalada ' + i }, 'beto@x.com'); }; }
      expect(agregar({ texto: 'alta ' + i }).status).toBe('ok');
    }
    expect(secuencias()).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  test('G. Historial: una escritura bloqueada por corrupcion sigue el patron de error (SERVICE_UNAVAILABLE), sin texto libre ni detalle de la hoja en la respuesta', () => {
    armar([alta(1, { secuencia: 3 }), alta(2, { secuencia: 3 })]);
    const r = agregar({ texto: 'texto-secreto-777' });
    expect(r.code).toBe('SERVICE_UNAVAILABLE');
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'SERVICE_UNAVAILABLE']]);
    expect(JSON.stringify(r)).not.toMatch(/figura en mas de una fila|ObservacionesPozo|texto-secreto-777/);
    sinTextoLibre();
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).toContain('excepcion');                                              // el diagnostico tecnico existe, pero sin el texto
  });
});

describe('concurrencia (otra ejecucion se intercala justo al tomar el lock)', () => {
  test('A. dos altas DIFERENTES simultaneas -> secuencias distintas', () => {
    ctx.lock.alAdquirir = () => { agregar({ texto: 'la de Beto', clientRequestId: 'beto-1234567' }, 'beto@x.com'); };
    const r = agregar({ texto: 'la de Ana', clientRequestId: 'ana--1234567' });
    expect(r.status).toBe('ok');
    expect(datos()).toHaveLength(2);
    expect(secuencias().slice().sort()).toEqual([1, 2]);
    expect(comoObjeto(datos()[0]).email).toBe('beto@x.com');                          // la intercalada gano el lock
    expect(comoObjeto(datos()[1]).secuencia).toBe(2);
  });

  test('B. el MISMO clientRequestId simultaneo -> UNA sola fila, y la que llego segunda recibe duplicada:true; un solo Historial', () => {
    const id = 'mismo-1234567';
    let interna;
    ctx.lock.alAdquirir = () => { interna = agregar({ clientRequestId: id }); };
    const externa = agregar({ clientRequestId: id });
    expect(interna.data.duplicada).toBe(false);
    expect(externa.data.duplicada).toBe(true);
    expect(externa.data.observacion.observacionId).toBe(interna.data.observacion.observacionId);
    expect(datos()).toHaveLength(1);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'OK']]);
    expect(secuencias()).toEqual([1]);
  });

  test('C. dos usuarios distintos con el mismo clientRequestId: cada uno crea la suya', () => {
    ctx.lock.alAdquirir = () => { agregar({ clientRequestId: 'compartido-1' + '2345' }, 'beto@x.com'); };
    const r = agregar({ clientRequestId: 'compartido-12345' }, 'ana@x.com');
    expect(r.data.duplicada).toBe(false);
    expect(datos()).toHaveLength(2);
    expect(datos().map((f) => comoObjeto(f).email).sort()).toEqual(['ana@x.com', 'beto@x.com']);
  });

  test('D. mismo usuario, mismo id y texto DISTINTO, simultaneos -> la segunda es IDEMPOTENCY_CONFLICT', () => {
    ctx.lock.alAdquirir = () => { agregar({ clientRequestId: 'conf--1234567', texto: 'texto uno' }); };
    const r = agregar({ clientRequestId: 'conf--1234567', texto: 'texto dos' });
    expect(r).toMatchObject({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    expect(datos()).toHaveLength(1);
  });

  test('E. muchas escrituras intercaladas nunca producen una secuencia duplicada: unicas, consecutivas y estrictamente crecientes', () => {
    for (let i = 0; i < 30; i += 1) {
      if (i % 3 === 0) {
        ctx.lock.alAdquirir = () => { agregar({ texto: 'intercalada ' + i }, 'beto@x.com'); };
      }
      agregar({ texto: 'alta ' + i });
    }
    const s = secuencias();
    expect(s).toHaveLength(40);
    expect(new Set(s).size).toBe(40);
    expect(s).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));                    // 1..40 en el orden exacto en que se escribieron (estrictamente crecientes)
    expect(ctx.escrituras.every((e) => e.lockTomado)).toBe(true);
  });
});

describe('la fila escrita', () => {
  test('EXACTAMENTE una fila ALTA con todos los campos; categoria y motivo vacios; email / nombre de la sesion', () => {
    const id = rid();
    const r = agregar({ clientRequestId: id, texto: 'Tapa dañada' });
    expect(datos()).toHaveLength(1);
    expect(comoObjeto(datos()[0])).toEqual({
      observacionId: r.data.observacion.observacionId, evento: 'ALTA', wellId: W, texto: 'Tapa dañada', categoria: '', motivo: '', email: 'ana@x.com', nombre: 'Ana',
      timestampUtc: r.data.observacion.timestamp, secuencia: 1, clientRequestId: id
    });
    expect(ctx.escrituras).toHaveLength(1);
  });

  test('el cliente NO puede elegir observacionId, evento, secuencia, email, nombre, fecha, estado ni motivo: se ignoran', () => {
    const r = agregar({
      observacionId: uuid(999), evento: 'ANULADA', secuencia: 999, email: 'otro@x.com', nombre: 'Falso', timestampUtc: '2000-01-01T00:00:00.000Z', timestamp: '2000-01-01T00:00:00.000Z', estado: 'ANULADA', motivo: 'x'
    });
    const f = comoObjeto(datos()[0]);
    expect(f).toMatchObject({ evento: 'ALTA', secuencia: 1, email: 'ana@x.com', nombre: 'Ana', motivo: '' });
    expect(f.observacionId).not.toBe(uuid(999));
    expect(f.timestampUtc).not.toBe('2000-01-01T00:00:00.000Z');
    expect(r.data.observacion.estado).toBe('ACTIVA');
  });

  test('la lectura posterior (getObservacionesPozo) ve lo escrito: mas reciente primero, con el mismo contenido, y los totales suben', () => {
    const a = agregar({ texto: 'primera' });
    const b = agregar({ texto: 'segunda', clientRequestId: rid() });
    const l = leer();
    expect(l.data).toMatchObject({ total: 2, activas: 2, anuladas: 0 });
    expect(l.data.observaciones.map((o) => o.texto)).toEqual(['segunda', 'primera']);
    expect(l.data.observaciones[1]).toEqual(a.data.observacion);
    expect(l.data.observaciones[0]).toEqual(b.data.observacion);
  });

  test('lo escrito en un pozo no aparece en otro', () => {
    agregar({ wellId: W_ITF, texto: 'solo del ITF' });
    expect(leer().data.total).toBe(0);
    expect(leer({ wellId: W_ITF }).data.total).toBe(1);
  });
});

describe('Historial', () => {
  test('alta exitosa: UNA fila con accion + wellId + OK; nunca el texto, el clientRequestId ni el observacionId', () => {
    const id = 'oculto-1234567';
    const r = agregar({ clientRequestId: id, texto: 'texto muy confidencial' });
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'OK']]);
    const txt = JSON.stringify(historial());
    expect(txt).not.toMatch(/confidencial|oculto-1234567/);
    expect(txt).not.toContain(r.data.observacion.observacionId);
  });

  test('duplicada: no escribe otra fila', () => {
    const id = rid();
    agregar({ clientRequestId: id });
    agregar({ clientRequestId: id });
    agregar({ clientRequestId: id });
    expect(historial()).toHaveLength(1);
  });

  test('errores: una fila por intento con su codigo (como el resto del repo)', () => {
    agregar({ texto: 'a' });
    agregar({ wellId: W_NADA });
    agregar({}, 'lector@x.com');
    expect(historial().map((h) => [h[0], h[3]])).toEqual([['ana@x.com', 'INVALID_TEXTO'], ['ana@x.com', 'WELL_NOT_FOUND'], ['lector@x.com', 'PERMISSION_DENIED']]);
  });
});

describe('hoja ausente o mal formada: SERVICE_UNAVAILABLE, nunca se autocrea', () => {
  test('hoja inexistente: SERVICE_UNAVAILABLE, no se crea y queda en Historial', () => {
    armar([], { sinHoja: true });
    const r = agregar();
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(Object.keys(hojas)).toEqual([]);
    expect(historial()).toEqual([['ana@x.com', 'agregarObservacionPozo', W, 'SERVICE_UNAVAILABLE']]);
  });

  test.each([
    ['le falta una columna', COLUMNAS.filter((c) => c !== 'secuencia')],
    ['tiene una columna repetida', COLUMNAS.concat(['texto'])],
    ['no tiene encabezado util', ['a', 'b', 'c']]
  ])('el encabezado %s: SERVICE_UNAVAILABLE y la hoja queda intacta', (n, header) => {
    armar([], { header: header });
    const antes = JSON.stringify(hojas.ObservacionesPozo.filas);
    expect(agregar()).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(hojas.ObservacionesPozo.filas)).toBe(antes);
  });

  test('con la hoja ausente y un reenvio: tampoco crea nada', () => {
    armar([], { sinHoja: true });
    const id = rid();
    agregar({ clientRequestId: id });
    agregar({ clientRequestId: id });
    expect(Object.keys(hojas)).toEqual([]);
  });

  test('una hoja con las columnas en otro orden funciona (se buscan por el texto del encabezado)', () => {
    const header = COLUMNAS.slice().reverse();
    armar([], { header: header });
    const r = agregar({ texto: 'orden distinto' });
    expect(r.status).toBe('ok');
    const f = hojas.ObservacionesPozo.filas[1];
    expect(f[header.indexOf('texto')]).toBe('orden distinto');
    expect(f[header.indexOf('evento')]).toBe('ALTA');
    expect(f[header.indexOf('secuencia')]).toBe(1);
  });
});

describe('privacidad', () => {
  test('ni Logger ni Historial ni los mensajes de error reciben el texto de la observacion, en ningun camino', () => {
    const secreto = 'texto-ultra-secreto-9999';
    agregar({ texto: secreto });                                                       // ok
    agregar({ texto: secreto, wellId: W_NADA });                                       // WELL_NOT_FOUND
    agregar({ texto: secreto, categoria: 'X' });                                       // INVALID_CATEGORIA
    agregar({ texto: secreto }, 'lector@x.com');                                       // PERMISSION_DENIED
    ctx.falla = 'setValues';
    agregar({ texto: secreto });                                                       // SERVICE_UNAVAILABLE
    const id = rid();
    agregar({ texto: secreto, clientRequestId: id });
    const respuestas = [agregar({ texto: secreto + 'x', clientRequestId: id })];       // IDEMPOTENCY_CONFLICT
    expect(JSON.stringify(respuestas)).not.toContain(secreto);
    expect(JSON.stringify(historial())).not.toContain(secreto);
    expect(global.Logger.log.mock.calls.map((c) => c[0]).join('\n')).not.toContain(secreto);
  });

  test('un fallo interno devuelve un mensaje FIJO (no el detalle de la excepcion)', () => {
    ctx.falla = 'setValues';
    const r = agregar({ texto: 'abc' });
    expect(r.message).toBe('no se pudo guardar la observacion: intenta de nuevo en unos minutos');
    expect(r.message).not.toContain('Spreadsheets');
  });

  test('la respuesta de una duplicada tampoco trae email ni clientRequestId', () => {
    const id = 'priv--1234567';
    agregar({ clientRequestId: id });
    const dup = agregar({ clientRequestId: id });
    expect(JSON.stringify(dup)).not.toMatch(/@|priv--1234567|secuencia/);
  });
});
