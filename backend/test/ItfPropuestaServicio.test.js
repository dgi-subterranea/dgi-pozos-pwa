// E9-4, servicio de PROPUESTAS (itfService_ejecutar PROPONER): el orden prevalidacion sin lock -> subida al storage FUERA del lock -> lock + relectura + append -> compensacion, la regla "nunca se sube lo que
// despues no se puede registrar", y que NUNCA se borra un archivo que alguna fila referencia (incluso con incertidumbre tras un error de Sheets). Hoja y Drive en memoria, storage falso; nada toca Google.
const { crearEntorno, depsDe, JPEG, PNG, sha256 } = require('./itfEntorno');
const H = require('./itfHelper');

const { ana } = H.USUARIOS;
const W = '14-0001';
const LEGACY_FILE = { id: 'legacy-14-0001', name: W + '.jpg', bytes: JPEG(300, 5) };

let E;
let S;
let n = 0;
const crid = () => { n += 1; return 'prop-req-' + String(n).padStart(8, '0'); };
const entorno = (op) => { E = crearEntorno(Object.assign({ archivos: [LEGACY_FILE], props: { ITF_E9_ACTIVO: 'SI' } }, op || {})); S = E.mods.servicio; n = 0; return E; };
beforeEach(() => entorno());

const filas = () => E.hoja.filas.slice(1);
const eventos = () => E.mods.repo.itfEventosRepository_leerTodos().eventos;
const arch = (relleno, tam, mimeType) => ({ bytes: mimeType === 'image/png' ? PNG(tam || 400) : JPEG(tam || 400, relleno), mimeType: mimeType || 'image/jpeg', nombreOriginal: 'itf-' + relleno + '.jpg' });
const proponer = (usuario, archivo, extra, deps) => S.itfService_ejecutar(usuario || ana, Object.assign({ accion: 'PROPONER', wellId: W, clientRequestId: crid() }, extra || {}), { archivo: archivo }, deps || depsDe(E));

describe('orden de pasos: nada se sube hasta saber que se puede registrar', () => {
  test('el upload ocurre FUERA del lock (una subida lenta no retiene el ScriptLock)', () => {
    const deps = depsDe(E);
    const rep = deps.repo;
    let dentro = false;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => { dentro = true; try { return rep.conLock(fn); } finally { dentro = false; } } });
    const guardar = deps.storage.guardarPropuesta;
    const observado = [];
    deps.storage = Object.assign({}, deps.storage, { guardarPropuesta: (p) => { observado.push(dentro); return guardar(p); } });
    expect(proponer(ana, arch(1), {}, deps).ok).toBe(true);
    expect(observado).toEqual([false]);
  });
  test('la escritura del evento SI ocurre dentro del lock, releyendo el estado', () => {
    const deps = depsDe(E);
    const rep = deps.repo;
    let dentro = false;
    const vistos = [];
    deps.repo = {
      conLock: (fn) => { dentro = true; try { return rep.conLock(fn); } finally { dentro = false; } },
      leerTodos: () => { vistos.push(['leer', dentro]); return rep.leerTodos(); },
      buscarPorClientRequestId: (a, b) => rep.buscarPorClientRequestId(a, b),
      escribirEventos: (e) => { vistos.push(['escribir', dentro]); return rep.escribirEventos(e); }
    };
    proponer(ana, arch(1), {}, deps);
    expect(vistos.filter(([x]) => x === 'escribir')).toEqual([['escribir', true]]);
    expect(vistos.filter(([x, d]) => x === 'leer' && d === true).length).toBeGreaterThanOrEqual(1);       // releyo adentro
    expect(vistos.filter(([x, d]) => x === 'leer' && d === false).length).toBeGreaterThanOrEqual(1);      // y prevalido afuera
  });
  test('el storage recibe EXACTAMENTE {documentoId, bytes, mimeType}: sin nombre original, wellId, hash ni actor', () => {
    const deps = depsDe(E);
    const guardar = jest.fn(deps.storage.guardarPropuesta);
    deps.storage = Object.assign({}, deps.storage, { guardarPropuesta: guardar });
    const r = proponer(ana, Object.assign(arch(2), { nombreOriginal: 'NOMBRE-ORIGINAL-SENSIBLE.jpg' }), {}, deps);
    expect(guardar).toHaveBeenCalledTimes(1);
    const arg = guardar.mock.calls[0][0];
    expect(Object.keys(arg).sort()).toEqual(['bytes', 'documentoId', 'mimeType']);
    expect(arg.documentoId).toBe(r.resultado.documentoId);
    expect(JSON.stringify(Object.assign({}, arg, { bytes: undefined }))).not.toMatch(/SENSIBLE|14-0001|@x\.com/);
  });
  test('el documentoId lo genera el SERVIDOR una vez, ANTES de subir: es el mismo en el storage y en el evento', () => {
    const r = proponer(ana, arch(3));
    expect(eventos()[0].documentoId).toBe(r.resultado.documentoId);
    expect(E.storage.docs['e9-storage-000001']).toBeDefined();
    expect(r.resultado.documentoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.resultado.documentoId).not.toBe(eventos()[0].eventoId);
  });
  test.each([
    ['archivo invalido', () => ({ bytes: Array.from(Buffer.from('%PDF-1.4 ....')), mimeType: 'application/pdf' }), 'MIME_NO_PERMITIDO'],
    ['archivo vacio', () => ({ bytes: [], mimeType: 'image/jpeg' }), 'ARCHIVO_VACIO'],
    ['mas grande que el maximo', () => ({ bytes: JPEG(3 * 1024 * 1024 + 1), mimeType: 'image/jpeg' }), 'ARCHIVO_DEMASIADO_GRANDE']
  ])('%s: se rechaza ANTES de subir', (nombre, f, code) => {
    expect(proponer(ana, f()).code).toBe(code);
    expect(E.storage.guardados).toBe(0);
  });
  test('11 pendientes -> TOO_MANY_PENDING antes de subir; duplicado -> antes de subir; estado no derivable -> antes de subir', () => {
    for (let i = 1; i <= 10; i += 1) { expect(proponer(ana, arch(i)).ok).toBe(true); }
    const subidos = E.storage.guardados;
    expect(proponer(ana, arch(99))).toMatchObject({ ok: false, code: 'TOO_MANY_PENDING' });
    expect(proponer(ana, arch(1))).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO' });
    expect(E.storage.guardados).toBe(subidos);
    entorno();
    E.hoja.filas.push(E.mods.repo.ITF_EVENTOS_COLUMNAS.map((c) => ({ eventoId: H.uuid(1), secuencia: 1, evento: 'ITF_BORRADO', wellId: W, documentoId: H.uuid(2), email: 'x@x.com', timestampUtc: H.ISO, clientRequestId: 'corrupto-0001' }[c] || '')));
    expect(proponer(ana, arch(1)).code).toBe('ITF_STATE_UNKNOWN');
    expect(E.storage.guardados).toBe(0);
  });
  test('un reintento NO genera otro documentoId ni sube otra copia', () => {
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'reintento-doc-01' };
    const deps = depsDe(E);
    const nuevo = jest.fn(deps.nuevoDocumentoId);
    deps.nuevoDocumentoId = nuevo;
    const a = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, deps);
    const llamadas = nuevo.mock.calls.length;
    const b = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, deps);
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(b.resultado.documentoId).toBe(a.resultado.documentoId);
    expect(nuevo.mock.calls.length).toBe(llamadas);
    expect(E.storage.guardados).toBe(1);
    expect(filas()).toHaveLength(1);
  });
  test('el servicio reintenta con los datos del evento original (tipo, tamano, nombre, fecha), no con los del nuevo pedido', () => {
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'reintento-doc-02' };
    const a = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, depsDe(E));
    const b = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, depsDe(E, { ahora: () => new Date('2030-01-01T00:00:00.000Z') }));
    expect(b.propuesta).toEqual(a.propuesta);
    expect(a.propuesta).toEqual({ mimeType: 'image/jpeg', bytes: 400, nombreOriginal: 'itf-1.jpg', timestampUtc: H.ISO });
  });
});

describe('hash SHA-256 de los bytes REALES aceptados', () => {
  test('se calcula en el backend sobre los bytes validados; el del cliente no existe como entrada', () => {
    const a = arch(4, 777);
    proponer(ana, a);
    expect(eventos()[0].sha256).toBe(sha256(a.bytes));
    expect(S.itfService_ejecutar(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid(), sha256: 'a'.repeat(64) }, { archivo: arch(5) }, depsDe(E)).code).toBe('INVALID_REQUEST');
  });
  test('mismo contenido -> mismo hash; un byte distinto -> otro hash; PNG y JPEG de igual relleno -> hashes distintos', () => {
    const x = arch(1, 400);
    const y = arch(1, 400);
    y.bytes[200] = 77;
    proponer(ana, x);
    proponer(ana, y);
    const [e1, e2] = eventos();
    expect(e1.sha256).not.toBe(e2.sha256);
    expect(e1.sha256).toBe(sha256(x.bytes));
  });
});

describe('fallas y compensacion: nunca se borra un archivo referenciado', () => {
  const referenciados = () => new Set(eventos().map((e) => e.storageFileId));
  const invarianteSinHuerfanos = () => {
    // todo lo que una fila referencia sigue en el storage
    referenciados().forEach((ref) => expect(E.storage.docs[ref]).toBeDefined());
  };

  test('el storage falla al guardar: error del storage, sin fila, sin nada que compensar', () => {
    E.storage.fallarGuardar = true;
    expect(proponer(ana, arch(1))).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(filas()).toHaveLength(0);
    expect(E.storage.eliminados).toEqual([]);
  });
  test('Sheets falla ANTES de escribir; la relectura confirma que NINGUNA fila referencia el archivo -> se compensa (papelera)', () => {
    const deps = depsDe(E);
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: () => { throw new Error('Sheets caido'); } });
    expect(proponer(ana, arch(1), {}, deps)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(E.storage.eliminados).toEqual(['e9-storage-000001']);
    expect(filas()).toHaveLength(0);
  });
  test('Sheets falla DESPUES de escribir; la relectura confirma la fila -> NO se borra el archivo y el reintento recupera la propuesta', () => {
    const deps = depsDe(E);
    const real = deps.repo.escribirEventos;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: (evs) => { real(evs); throw new Error('timeout despues de escribir'); } });
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'corte-despues-001' };
    expect(S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, deps).code).toBe('SERVICE_UNAVAILABLE');
    expect(E.storage.eliminados).toEqual([]);
    invarianteSinHuerfanos();
    const reintento = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, depsDe(E));
    expect(reintento).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(E.storage.guardados).toBe(1);
    expect(filas()).toHaveLength(1);
  });
  test('Sheets falla y TAMBIEN falla la relectura: no se puede asegurar nada -> NO se borra', () => {
    const deps = depsDe(E);
    const real = deps.repo.leerTodos;
    let lecturas = 0;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: () => { throw new Error('caido'); }, leerTodos: () => { lecturas += 1; if (lecturas > 3) { throw new Error('caido'); } return real(); } });
    expect(proponer(ana, arch(1), {}, deps).ok).toBe(false);
    expect(E.storage.eliminados).toEqual([]);
  });
  test('el lock no se consigue: SERVICE_UNAVAILABLE; el archivo ya subido se compensa (nadie lo referencia)', () => {
    E.lock.waitLock.mockImplementation(() => { throw new Error('Lock timeout'); });
    expect(proponer(ana, arch(1)).code).toBe('SERVICE_UNAVAILABLE');
    expect(E.storage.eliminados).toEqual(['e9-storage-000001']);
    expect(filas()).toHaveLength(0);
  });
  test('la compensacion falla: se informa y se registra, y la causa original no se oculta', () => {
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
      if (interferir) { interferir = false; expect(proponer(H.USUARIOS.ambos, arch(1)).ok).toBe(true); }
      return fn();
    }) });
    E.storage.fallarEliminar = true;
    expect(proponer(ana, arch(1), {}, deps)).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO', compensacion: 'FALLO' });
    expect(Logger.log).toHaveBeenCalledWith(expect.stringMatching(/huerfano/));
    invarianteSinHuerfanos();
  });
  test('INVARIANTE: en cualquier mezcla de exitos y fallos, todo archivo referenciado por una fila sigue existiendo', () => {
    proponer(ana, arch(1));
    const deps = depsDe(E);
    const real = deps.repo.escribirEventos;
    let k = 0;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: (evs) => { k += 1; if (k === 1) { throw new Error('antes'); } real(evs); if (k === 2) { throw new Error('despues'); } return undefined; } });
    proponer(ana, arch(2), {}, deps);
    proponer(ana, arch(3), {}, deps);
    proponer(ana, arch(4), {}, deps);
    E.storage.fallarEliminar = true;
    proponer(ana, arch(5), {}, deps);
    invarianteSinHuerfanos();
    expect(referenciados().size).toBe(filas().length);
  });
  test('una propuesta duplicada detectada DENTRO del lock (carrera) compensa SOLO su archivo, no el de la otra persona', () => {
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
      if (interferir) { interferir = false; proponer(H.USUARIOS.ambos, arch(1)); }
      return fn();
    }) });
    const r = proponer(ana, arch(1), {}, deps);
    expect(r).toMatchObject({ code: 'DUPLICADO_DOCUMENTO', compensacion: 'OK' });
    expect(E.storage.eliminados).toHaveLength(1);
    invarianteSinHuerfanos();
  });
});

describe('limites y casos de contenido', () => {
  test('exactamente 3 MB entra de punta a punta (validar + hash + storage + evento); un byte mas no', () => {
    const justo = { bytes: JPEG(3 * 1024 * 1024, 1), mimeType: 'image/jpeg', nombreOriginal: 'grande.jpg' };
    const r = proponer(ana, justo);
    expect(r.ok).toBe(true);
    expect(eventos()[0].bytes).toBe(3 * 1024 * 1024);
    expect(proponer(ana, { bytes: JPEG(3 * 1024 * 1024 + 1, 2), mimeType: 'image/jpeg' }).code).toBe('ARCHIVO_DEMASIADO_GRANDE');
  });
  test('JPEG y PNG se guardan con su tipo real', () => {
    proponer(ana, arch(1, 300, 'image/jpeg'));
    proponer(ana, arch(2, 300, 'image/png'));
    expect(eventos().map((e) => e.mimeType)).toEqual(['image/jpeg', 'image/png']);
    expect(E.storage.docs['e9-storage-000002'].mimeType).toBe('image/png');
  });
  test('nombres raros: se normalizan y quedan SOLO como metadata (jamas como nombre fisico)', () => {
    const casos = [
      ['C:\\fotos\\a b.jpg', 'a b.jpg'],
      ['../../etc/passwd', 'passwd'],
      ['=HYPERLINK("x").jpg', '=HYPERLINK("x").jpg'],
      ['a\nb\tc.jpg', 'a b c.jpg'],
      ['x'.repeat(400) + '.jpg', null],
      ['', 'sin-nombre'],
      [undefined, 'sin-nombre']
    ];
    casos.forEach(([entrada, esperado], i) => {
      proponer(ana, Object.assign(arch(i + 1), { nombreOriginal: entrada }));
    });
    const nombres = eventos().map((e) => e.nombreOriginal);
    casos.forEach(([, esperado], i) => { if (esperado !== null) { expect(nombres[i]).toBe(esperado); } else { expect(Array.from(nombres[i]).length).toBeLessThanOrEqual(150); } });
    Object.keys(E.storage.docs).forEach((ref) => expect(ref).toMatch(/^e9-storage-\d{6}$/));
  });
});

describe('reglas de existencia con las dependencias inyectadas (A-D)', () => {
  const sin = (extra) => depsDe(E, extra);
  test('B. legacy unico habilita aunque la existencia independiente diga que no (ni se consulta)', () => {
    const existencia = jest.fn(() => ({ existe: false, indeterminado: false }));
    expect(proponer(ana, arch(1), {}, sin({ existencia: existencia })).ok).toBe(true);
    expect(existencia).not.toHaveBeenCalled();
  });
  test('A. sin legacy se consulta la existencia independiente (y solo ahi)', () => {
    entorno({ archivos: [] });
    const existencia = jest.fn(() => ({ existe: true, indeterminado: false }));
    expect(proponer(ana, arch(1), {}, sin({ existencia: existencia })).ok).toBe(true);
    expect(existencia).toHaveBeenCalledTimes(1);
    expect(existencia).toHaveBeenCalledWith(W);
  });
  test('C. legacy ambiguo: no consulta la existencia ni habilita (aunque el padron lo conozca)', () => {
    entorno({ archivos: [LEGACY_FILE, { id: 'dup-14-0001-xx', name: W + '.jpg', bytes: JPEG(100) }] });
    const existencia = jest.fn(() => ({ existe: true, indeterminado: false }));
    expect(proponer(ana, arch(1), {}, sin({ existencia: existencia })).code).toBe('LEGACY_AMBIGUO');
    expect(existencia).not.toHaveBeenCalled();
    expect(E.storage.guardados).toBe(0);
  });
  test('B. el hash del legacy vigente se usa para detectar la misma imagen', () => {
    expect(proponer(ana, { bytes: LEGACY_FILE.bytes, mimeType: 'image/jpeg' }).code).toBe('DUPLICADO_DOCUMENTO');
    expect(E.storage.guardados).toBe(0);
  });
  test('D. con vigente E9 no se mira Drive ni la existencia', () => {
    entorno({ archivos: [] });
    const cols = E.mods.repo.ITF_EVENTOS_COLUMNAS;
    [E.H.propuesto(1), E.H.aprobado(1)].forEach((ev) => E.hoja.filas.push(cols.map((c) => (ev[c] === undefined ? '' : ev[c]))));
    const existencia = jest.fn();
    expect(proponer(ana, arch(9), {}, sin({ existencia: existencia })).ok).toBe(true);
    expect(existencia).not.toHaveBeenCalled();
    expect(E.drive.calls.getFilesByName).toBe(0);
  });
  test('la propuesta no prueba existencia: con solo propuestas y sin fuentes -> POZO_NOT_FOUND', () => {
    entorno({ archivos: [] });
    const fuentes = sin({ existencia: () => ({ existe: true, indeterminado: false }) });
    expect(proponer(ana, arch(1), {}, fuentes).ok).toBe(true);
    expect(proponer(ana, arch(2), {}, sin({ existencia: () => ({ existe: false, indeterminado: false }) })).code).toBe('POZO_NOT_FOUND');
  });
});

describe('seguridad: la carpeta legacy nunca recibe una propuesta', () => {
  test('con el storage no configurado no hay fallback a la carpeta legacy', () => {
    const deps = depsDe(E);
    deps.storage = require('../src/ItfStorageProvider').itfStorage_noConfigurado();
    expect(proponer(ana, arch(1), {}, deps)).toMatchObject({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
    expect(E.drive.estado.archivos).toEqual([LEGACY_FILE]);
    expect(filas()).toHaveLength(0);
  });
  test('el servicio no tiene ninguna forma de escribir en Drive: DriveApp no se usa para crear nada', () => {
    proponer(ana, arch(1));
    expect(E.drive.estado.archivos).toEqual([LEGACY_FILE]);
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'ItfService.js'), 'utf8').replace(/\/\/.*$/gm, '');
    expect(fuente).not.toMatch(/createFile|setTrashed|DriveApp|moveTo|setContent/);
  });
});

// ===========================================================================
// Orden real de llamadas, concurrencia entre dos solicitudes y los casos A-F de idempotencia
// ===========================================================================
describe('ORDEN DE LLAMADAS del flujo de propuesta (el storage lento NUNCA con el ScriptLock retenido)', () => {
  // arma deps que registran, en orden, cada paso relevante
  const trazar = (traza, extra) => {
    const deps = depsDe(E, extra);
    const rep = deps.repo;
    let dentro = false;
    const marca = (nombre) => traza.push(nombre + (dentro ? '@lock' : ''));
    deps.repo = {
      conLock: (fn) => { traza.push('lock.toma'); return rep.conLock(() => { dentro = true; traza.push('lock.dentro'); try { return fn(); } finally { dentro = false; traza.push('lock.libera'); } }); },
      buscarPorClientRequestId: (a, b) => { marca('crid'); return rep.buscarPorClientRequestId(a, b); },
      leerTodos: () => { marca('eventos.leer'); return rep.leerTodos(); },
      escribirEventos: (e) => { marca('eventos.escribir'); return rep.escribirEventos(e); }
    };
    const lg = deps.legacy;
    deps.legacy = Object.assign({}, lg, { buscar: (w) => { marca('legacy.buscar'); return lg.buscar(w); }, huella: (w) => { marca('legacy.huella'); return lg.huella(w); } });
    const st = deps.storage;
    deps.storage = Object.assign({}, st, { guardarPropuesta: (p) => { marca('storage.guardar'); return st.guardarPropuesta(p); }, eliminarTemporal: (r) => { marca('storage.compensar'); return st.eliminarTemporal(r); } });
    const inval = deps.invalidarCaches;
    deps.invalidarCaches = (w) => { marca('cache.invalida'); return inval(w); };
    const ex = deps.existencia;
    deps.existencia = (w) => { marca('existencia'); return ex(w); };
    return deps;
  };
  const antes = (traza, a, b) => expect(traza.indexOf(a)).toBeGreaterThanOrEqual(0) && expect(traza.indexOf(a)).toBeLessThan(traza.indexOf(b));

  test('pasos en orden: idempotencia -> evidencia -> prevalidacion (SIN lock) -> UPLOAD (sin lock) -> lock: releer + escribir -> libera -> invalida cache', () => {
    entorno({ archivos: [] });
    const traza = [];
    const deps = trazar(traza);
    expect(proponer(ana, arch(1), {}, deps).ok).toBe(true);
    const iUpload = traza.indexOf('storage.guardar');
    const iToma = traza.indexOf('lock.toma');
    const iEscribe = traza.indexOf('eventos.escribir@lock');
    const iLibera = traza.indexOf('lock.libera');
    const iInvalida = traza.indexOf('cache.invalida');
    expect(traza[0]).toBe('crid');                                                  // 1) idempotencia conocida: lo primero
    expect(traza.indexOf('existencia')).toBeGreaterThan(traza.indexOf('crid'));     // 2) evidencia / existencia
    expect(iUpload).toBeGreaterThan(traza.indexOf('existencia'));                    // 3) recien despues se sube
    expect(traza.slice(0, iUpload).filter((x) => x.endsWith('@lock'))).toEqual([]); // nada antes del upload corre con el lock
    expect(traza.indexOf('eventos.leer')).toBeLessThan(iUpload);                     // prevalidacion: derivo el estado ANTES de subir
    expect(iUpload).toBeLessThan(iToma);                                             // upload ANTES de tomar el lock
    expect(traza.slice(iToma, iLibera).filter((x) => x === 'storage.guardar')).toEqual([]);     // ningun upload con el lock retenido
    expect(traza.indexOf('crid@lock')).toBeGreaterThan(iToma);                       // adentro del lock: relee clientRequestId ...
    expect(traza.indexOf('eventos.leer@lock')).toBeGreaterThan(traza.indexOf('crid@lock'));     // ... y el estado
    expect(iEscribe).toBeGreaterThan(traza.indexOf('eventos.leer@lock'));            // recien entonces escribe
    expect(iLibera).toBeGreaterThan(iEscribe);
    expect(iInvalida).toBeGreaterThan(iLibera);                                      // la cache se invalida despues de liberar
    expect(traza.slice(iToma, iLibera).filter((x) => x === 'storage.compensar')).toEqual([]);
    antes(traza, 'lock.toma', 'lock.dentro');
  });
  test('con un legacy vigente la evidencia lee el archivo (huella) ANTES de subir, siempre sin lock', () => {
    const traza = [];
    const deps = trazar(traza);
    expect(proponer(ana, arch(1), {}, deps).ok).toBe(true);
    expect(traza.indexOf('legacy.buscar')).toBeLessThan(traza.indexOf('storage.guardar'));
    expect(traza.indexOf('legacy.huella')).toBeLessThan(traza.indexOf('storage.guardar'));
    expect(traza.indexOf('existencia')).toBe(-1);                                    // B: el legacy es evidencia, no se consulta otra fuente
  });
  test('la compensacion tambien ocurre DESPUES de liberar el lock', () => {
    const traza = [];
    const deps = trazar(traza);
    const rep = deps.repo;
    let interferir = true;
    const conLock = rep.conLock;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => conLock(() => { if (interferir) { interferir = false; proponer(H.USUARIOS.ambos, arch(1)); } return fn(); }) });
    const r = proponer(ana, arch(1), {}, deps);
    expect(r).toMatchObject({ code: 'DUPLICADO_DOCUMENTO', compensacion: 'OK' });
    expect(traza.indexOf('storage.compensar')).toBeGreaterThan(traza.lastIndexOf('lock.libera'));
  });
  test('Api: el orden completo termina en Historial -> respuesta, despues de liberar el lock y de invalidar', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'Api.js'), 'utf8');
    const i = fuente.indexOf('function handleProponerItf');
    const cuerpo = fuente.slice(i, fuente.indexOf('// --- Modulo Reemplazos v1', i)).split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const orden = ['validateSession(', 'api_validarPermisosEstrictos(', 'itfService_e9Activo()', 'PROPONER_ITF_CAMPOS.indexOf', 'PROPONER_ITF_BASE64_REGEX.test', 'Utilities.base64Decode(', 'itfService_ejecutar(', "logHistoryEvent(session.email, 'proponerItf', b.wellId, 'OK')", 'return {\n    status: \'ok\''];
    const posiciones = orden.map((t) => cuerpo.indexOf(t));
    posiciones.forEach((p, k) => expect({ paso: orden[k], presente: p >= 0 }).toEqual({ paso: orden[k], presente: true }));
    expect(posiciones).toEqual(posiciones.slice().sort((a, b) => a - b));
  });
});

describe('CONCURRENCIA: dos solicitudes casi simultaneas (cada una puede pasar la prevalidacion)', () => {
  // ejecuta `otra()` en medio del upload de la solicitud principal: ambas ya pasaron la prevalidacion sin lock
  const conOtraDuranteElUpload = (otra) => {
    const deps = depsDe(E);
    const st = deps.storage;
    let una = true;
    deps.storage = Object.assign({}, st, { guardarPropuesta: (p) => { const r = st.guardarPropuesta(p); if (una) { una = false; otra(); } return r; } });
    return deps;
  };

  test('A y B suben el MISMO archivo: A escribe primero; B entra al lock, relee, detecta el duplicado -> NO escribe y compensa SU archivo', () => {
    entorno({ archivos: [] });
    const existencia = () => ({ existe: true, indeterminado: false });
    const subidasB = [];
    const deps = conOtraDuranteElUpload(() => {
      const a = proponer(H.USUARIOS.ambos, arch(1), {}, depsDe(E, { existencia: existencia }));        // A completa TODO su flujo mientras B sube
      expect(a).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
    });
    deps.existencia = existencia;
    const b = proponer(ana, arch(1), {}, deps);
    expect(b).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO', compensacion: 'OK' });
    expect(filas()).toHaveLength(1);
    expect(eventos()[0].email).toBe('carla@x.com');
    expect(E.storage.guardados).toBe(2);
    expect(E.storage.eliminados).toEqual(['e9-storage-000001']);                       // el archivo de B (subido primero), no el de A
    expect(Object.keys(E.storage.docs)).toEqual(['e9-storage-000002']);                // sin temporales huerfanos
    expect(eventos()[0].storageFileId).toBe('e9-storage-000002');
    subidasB.push(1);
  });
  test('LIMITE DE 10: dos solicitudes ven 9 pendientes; la primera crea la #10; la segunda relee DENTRO del lock y falla por el limite, y compensa', () => {
    entorno({ archivos: [] });
    const existencia = () => ({ existe: true, indeterminado: false });
    for (let i = 1; i <= 9; i += 1) { expect(proponer(ana, arch(i), {}, depsDe(E, { existencia: existencia })).ok).toBe(true); }
    const deps = conOtraDuranteElUpload(() => {
      expect(proponer(H.USUARIOS.ambos, arch(50), {}, depsDe(E, { existencia: existencia })).ok).toBe(true);     // la #10
    });
    deps.existencia = existencia;
    const r = proponer(ana, arch(60), {}, deps);
    expect(r).toMatchObject({ ok: false, code: 'TOO_MANY_PENDING', compensacion: 'OK' });
    expect(filas()).toHaveLength(10);
    const d = E.mods.dominio.itfDominio_estadoPozo(W, E.mods.dominio.itfDominio_derivar(eventos()), false);
    expect(d.propuestasPendientes).toHaveLength(10);                                    // exactamente 10, ni 11
    expect(E.storage.eliminados).toHaveLength(1);
    Object.values(eventos().map((e) => e.storageFileId)).forEach((ref) => expect(E.storage.docs[ref]).toBeDefined());
  });
  test('con 10 pendientes ya registrados, la 11 ni sube nada (prevalidacion); con 9 entra la #10', () => {
    entorno({ archivos: [] });
    const existencia = () => ({ existe: true, indeterminado: false });
    for (let i = 1; i <= 9; i += 1) { proponer(ana, arch(i), {}, depsDe(E, { existencia: existencia })); }
    expect(proponer(ana, arch(10), {}, depsDe(E, { existencia: existencia })).ok).toBe(true);
    const subidas = E.storage.guardados;
    expect(proponer(ana, arch(11), {}, depsDe(E, { existencia: existencia })).code).toBe('TOO_MANY_PENDING');
    expect(E.storage.guardados).toBe(subidas);
  });
  test('el mismo usuario reenvia (doble tap) mientras la primera todavia sube: la segunda NO crea otra propuesta', () => {
    entorno({ archivos: [] });
    const existencia = () => ({ existe: true, indeterminado: false });
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'doble-tap-0001' };
    let segunda;
    const deps = conOtraDuranteElUpload(() => { segunda = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, depsDe(E, { existencia: existencia })); });
    deps.existencia = existencia;
    const primera = S.itfService_ejecutar(ana, comando, { archivo: arch(1) }, deps);
    // la "segunda" (que llego mientras la primera subia) escribio; la primera, al entrar al lock, encuentra su propio clientRequestId ya usado -> es un reintento y compensa su archivo
    expect(segunda).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
    expect(primera).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(primera.resultado.documentoId).toBe(segunda.resultado.documentoId);
    expect(filas()).toHaveLength(1);
    expect(Object.keys(E.storage.docs)).toHaveLength(1);
    expect(primera.compensacion).toBe('OK');
  });
});

describe('IDEMPOTENCIA A-F', () => {
  const comando = (extra) => Object.assign({ accion: 'PROPONER', wellId: W, clientRequestId: 'idem-propuesta-01' }, extra || {});
  const ejecutar = (usuario, c, a) => S.itfService_ejecutar(usuario, c, { archivo: a }, depsDe(E));

  test('A. retry exacto con el evento ya existente: no se sube de nuevo', () => {
    ejecutar(ana, comando(), arch(1));
    const subidas = E.storage.guardados;
    expect(ejecutar(ana, comando(), arch(1))).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(E.storage.guardados).toBe(subidas);
  });
  test('B. retry tras perder la respuesta: mismo documentoId, mismo resultado, 0 eventos nuevos, 0 storage nuevo', () => {
    const a = ejecutar(ana, comando(), arch(1));
    const b = ejecutar(ana, comando(), arch(1));
    expect(b.resultado).toEqual(a.resultado);
    expect(b.propuesta).toEqual(a.propuesta);
    expect(b.eventosEscritos).toBe(0);
    expect(filas()).toHaveLength(1);
    expect(E.storage.guardados).toBe(1);
  });
  test('C. mismo clientRequestId + bytes distintos: IDEMPOTENCY_CONFLICT (sin subir ni escribir)', () => {
    ejecutar(ana, comando(), arch(1));
    expect(ejecutar(ana, comando(), arch(2))).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(E.storage.guardados).toBe(1);
    expect(filas()).toHaveLength(1);
  });
  test('D. mismo clientRequestId + MISMO hash pero wellId distinto: IDEMPOTENCY_CONFLICT (sin subir ni escribir)', () => {
    ejecutar(ana, comando(), arch(1));
    expect(ejecutar(ana, comando({ wellId: '14-0002' }), arch(1))).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(E.storage.guardados).toBe(1);
    expect(filas()).toHaveLength(1);
  });
  test('E. el email se compara sin distinguir mayusculas ni espacios', () => {
    ejecutar(ana, comando(), arch(1));
    expect(ejecutar(Object.assign({}, ana, { email: '  ANA@X.COM ' }), comando(), arch(1))).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(filas()).toHaveLength(1);
  });
  test('F. otro usuario puede reutilizar el mismo clientRequestId (con otro archivo)', () => {
    ejecutar(ana, comando(), arch(1));
    expect(ejecutar(H.USUARIOS.ambos, comando(), arch(2))).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
    expect(filas()).toHaveLength(2);
    expect(E.mods.dominio.itfDominio_derivar(eventos()).porPozo[W].integridad).toBe('OK');
  });
  test('un reintento con otro nombre de archivo (mismo contenido) sigue siendo el mismo pedido', () => {
    const a = ejecutar(ana, comando(), arch(1));
    const b = ejecutar(ana, comando(), Object.assign(arch(1), { nombreOriginal: 'otro-nombre.jpg' }));
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(b.resultado.documentoId).toBe(a.resultado.documentoId);
  });
});

describe('invalidacion de la cache despues de liberar el lock', () => {
  test('si la invalidacion falla, la escritura (ya hecha) sigue siendo un exito', () => {
    entorno({ archivos: [] });
    const deps = depsDe(E, { existencia: () => ({ existe: true, indeterminado: false }) });
    deps.invalidarCaches = jest.fn(() => { throw new Error('cache caida'); });
    const r = proponer(ana, arch(1), {}, deps);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
    expect(filas()).toHaveLength(1);
    expect(deps.invalidarCaches).toHaveBeenCalledWith([W]);
    expect(E.storage.eliminados).toEqual([]);                  // y el archivo NO se compensa: la fila existe
  });
});

describe('el servidor decide el hash, el id y los argumentos del storage', () => {
  test('un sha256 que venga junto al archivo se ignora: se guarda el del servidor', () => {
    entorno({ archivos: [] });
    const deps = depsDe(E, { existencia: () => ({ existe: true, indeterminado: false }) });
    const a = Object.assign({}, arch(1), { sha256: 'f'.repeat(64) });
    const r = proponer(ana, a, {}, deps);
    expect(r.ok).toBe(true);
    expect(filas()).toHaveLength(1);
    expect(eventos()[0].sha256).toBe(sha256(a.bytes));
  });
  test('el documentoId lo genera el servidor (no es el clientRequestId ni nada del cliente)', () => {
    entorno({ archivos: [] });
    const deps = depsDe(E, { existencia: () => ({ existe: true, indeterminado: false }) });
    const cr = crid();
    const r = proponer(ana, arch(1), { clientRequestId: cr }, deps);
    expect(r.ok).toBe(true);
    expect(r.resultado.documentoId).not.toBe(cr);
    expect(r.resultado.documentoId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
  test('al storage solo viajan documentoId, bytes y mimeType (jamas el nombre original, el hash ni el pozo)', () => {
    entorno({ archivos: [] });
    const deps = depsDe(E, { existencia: () => ({ existe: true, indeterminado: false }) });
    const a = Object.assign({}, arch(1), { nombreOriginal: '../../etc/passwd.jpg' });
    expect(proponer(ana, a, {}, deps).ok).toBe(true);
    expect(E.storage.argumentos).toEqual([['bytes', 'documentoId', 'mimeType']]);
  });
});
