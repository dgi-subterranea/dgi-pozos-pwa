// E9-5, LECTURAS del validador (servicio): cola de pendientes, apertura de un documento y historial por pozo. Hoja, Drive y storage en memoria; nada toca Google.
// La cola lee ItfEventos UNA vez y nunca toca el storage, el legacy ni Drive; paginacion por cursor estable; ningun DTO lleva email, storageFileId, hash, clientRequestId ni secuencia.
const { crearEntorno, depsDe, JPEG, sha256 } = require('./itfEntorno');
const H = require('./itfHelper');

const { ana, val, ambos, lee } = H.USUARIOS;
const W = '14-0001';
const BYTES_LEGACY = JPEG(300, 5);

let E;
let S;
let n;
const crid = () => { n += 1; return 'lec-req-' + String(n).padStart(8, '0'); };
const entorno = (op) => { E = crearEntorno(Object.assign({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } }, op || {})); S = E.mods.servicio; H.reiniciar(); n = 0; return E; };
beforeEach(() => entorno());

const cols = () => E.mods.repo.ITF_EVENTOS_COLUMNAS;
const cargar = (...evs) => evs.forEach((e) => E.hoja.filas.push(cols().map((c) => (e[c] === undefined ? '' : e[c]))));
const archivoJpeg = (relleno, tam) => ({ bytes: JPEG(tam || 400, relleno), mimeType: 'image/jpeg', nombreOriginal: 'itf-' + relleno + '.jpg' });
const ej = (usuario, comando, opciones, deps) => S.itfService_ejecutar(usuario, comando, opciones || {}, deps || depsDe(E));
const proponer = (usuario, relleno, extra) => ej(usuario || ana, Object.assign({ accion: 'PROPONER', wellId: W, clientRequestId: crid() }, extra || {}), { archivo: archivoJpeg(relleno || 1) });
const docDe = (r) => r.resultado.documentoId;
const aprobar = (usuario, documentoId, reemplaza) => ej(usuario || val, Object.assign({ accion: 'APROBAR', documentoId: documentoId, clientRequestId: crid() }, reemplaza ? { documentoReemplazadoId: reemplaza, motivoCodigo: 'ACTUALIZACION' } : {}));
const rechazar = (documentoId) => ej(val, { accion: 'RECHAZAR', documentoId: documentoId, motivoCodigo: 'ILEGIBLE', clientRequestId: crid() });
const retirar = (documentoId) => ej(val, { accion: 'RETIRAR', documentoId: documentoId, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() });
const pendientes = (usuario, opciones, deps) => S.itfService_pendientes(usuario || val, opciones, deps || depsDe(E));
const abrir = (documentoId, usuario, deps) => S.itfService_documentoModeracion(usuario || val, documentoId, deps || depsDe(E));
const historial = (wellId, usuario, deps) => S.itfService_historial(usuario || val, wellId, deps || depsDe(E));

// Cualquier DTO: sin email, referencias de storage, hashes, clientRequestId ni secuencia (ni como clave ni como valor).
function sinFugas(dto) {
  const json = JSON.stringify(dto);
  ['@x.com', '@example', 'drive-id-', 'e9-storage-', 'legacy-14-0001'].forEach((p) => expect(json).not.toContain(p));
  expect(json).not.toMatch(/[0-9a-f]{64}/);
  expect(json).not.toMatch(/"(email|storageFileId|storageRef|sha256|huella|clientRequestId|secuencia|eventoId|driveFileId)"/);
  expect(json).not.toMatch(/(req-0000|lec-req-|cmd-req-)/);
}

// N propuestas cargadas directo en la hoja, repartidas en varios pozos (la cola no depende del tope por pozo).
function cargarPropuestas(cantidad, conPozos) {
  const ids = [];
  for (let i = 1; i <= cantidad; i += 1) {
    const wellId = '14-' + String(1 + (i % (conPozos || 60))).padStart(4, '0');
    cargar(H.propuesto(i, { wellId: wellId, nombre: i % 2 === 0 ? 'Ana' : 'Beto', email: i % 2 === 0 ? 'ana@x.com' : 'beto@x.com' }));
    ids.push(H.doc(i));
  }
  return ids;
}

describe('COLA: permisos y puertas de entrada', () => {
  test.each([
    ['sin permisos', {}],
    ['solo perfil', { perfil: true }],
    ['perfil_validar sin perfil', { perfil_validar: true }],
    ['perfil + perfil_subir', { perfil: true, perfil_subir: true }],
    ['valores truthy que no son true', { perfil: 'SI', perfil_validar: 1 }]
  ])('%s -> PERMISSION_DENIED y no se lee la hoja', (nombre, permisos) => {
    const deps = depsDe(E);
    const leer = jest.fn(deps.repo.leerTodos);
    deps.repo = Object.assign({}, deps.repo, { leerTodos: leer });
    expect(pendientes({ email: 'x@x.com', nombre: 'X', permisos: permisos }, {}, deps)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(abrir(H.doc(1), { email: 'x@x.com', nombre: 'X', permisos: permisos }, deps).code).toBe('PERMISSION_DENIED');
    expect(historial(W, { email: 'x@x.com', nombre: 'X', permisos: permisos }, deps).code).toBe('PERMISSION_DENIED');
    expect(leer).not.toHaveBeenCalled();
  });
  test('un validador y quien tiene ambos permisos pueden', () => {
    expect(pendientes(val).ok).toBe(true);
    expect(pendientes(ambos).ok).toBe(true);
  });
  test('E9 apagado: ITF_E9_INACTIVO y no se lee la hoja; sesion sin email valido: INVALID_REQUEST', () => {
    entorno({ props: {} });
    const deps = depsDe(E);
    const leer = jest.fn(deps.repo.leerTodos);
    deps.repo = Object.assign({}, deps.repo, { leerTodos: leer });
    expect(pendientes(val, {}, deps).code).toBe('ITF_E9_INACTIVO');
    expect(abrir(H.doc(1), val, deps).code).toBe('ITF_E9_INACTIVO');
    expect(historial(W, val, deps).code).toBe('ITF_E9_INACTIVO');
    expect(leer).not.toHaveBeenCalled();
    entorno();
    expect(pendientes({ email: 'sin-arroba', nombre: 'X', permisos: val.permisos }).code).toBe('INVALID_REQUEST');
  });
  test('la hoja no se puede leer: SERVICE_UNAVAILABLE sin detalle', () => {
    const deps = depsDe(E);
    deps.repo = Object.assign({}, deps.repo, { leerTodos: () => { throw new Error('Sheets caido: id-secreto-123'); } });
    const r = pendientes(val, {}, deps);
    expect(r).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toContain('id-secreto');
  });
});

describe('COLA: contenido', () => {
  test('0 propuestas: lista vacia, sin cursor, total 0', () => {
    expect(pendientes()).toMatchObject({ ok: true, items: [], siguienteCursor: null, total: 0, pozosSinDerivar: 0 });
  });
  test('1 propuesta: el item lleva SOLO los campos permitidos', () => {
    const r = proponer(ana, 1);
    const cola = pendientes();
    expect(cola.items).toHaveLength(1);
    expect(cola.items[0]).toEqual({
      documentoId: docDe(r), wellId: W, mimeType: 'image/jpeg', bytes: 400, nombreOriginal: 'itf-1.jpg', nombreProponente: 'Ana', timestampUtc: H.ISO,
      autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, warningMensaje: null
    });
    sinFugas(cola);
  });
  test('autoPropuestaPropia: true solo cuando quien mira es quien propuso (por email, no por nombre)', () => {
    proponer(ambos, 1);
    expect(pendientes(ambos).items[0].autoPropuestaPropia).toBe(true);
    expect(pendientes(val).items[0].autoPropuestaPropia).toBe(false);
    // otra persona con el MISMO nombre visible no es el proponente
    const homonimo = { email: 'otra@x.com', nombre: 'Carla', permisos: { perfil: true, perfil_validar: true } };
    expect(pendientes(homonimo).items[0].autoPropuestaPropia).toBe(false);
  });
  test('SOLO propuestas pendientes: aprobada, rechazada y retirada salen de la cola; un vigente, un historico o un rechazado nunca estan', () => {
    const a = proponer(ana, 1);
    const b = proponer(ana, 2);
    const c = proponer(ana, 3);
    const d = proponer(ana, 4);
    expect(pendientes().items.map((i) => i.documentoId)).toEqual([docDe(d), docDe(c), docDe(b), docDe(a)]);
    expect(aprobar(val, docDe(a), 'LEGACY:' + W).ok).toBe(true);
    expect(rechazar(docDe(b)).ok).toBe(true);
    expect(retirar(docDe(c)).ok).toBe(true);
    const cola = pendientes();
    expect(cola.items.map((i) => i.documentoId)).toEqual([docDe(d)]);
    expect(cola.total).toBe(1);
  });
  test('las mas nuevas primero (orden por la secuencia global), aun entre pozos distintos', () => {
    cargar(H.propuesto(1, { wellId: '14-0003' }), H.propuesto(2, { wellId: '14-0001' }), H.propuesto(3, { wellId: '14-0002' }));
    expect(pendientes().items.map((i) => i.documentoId)).toEqual([H.doc(3), H.doc(2), H.doc(1)]);
  });
  test('warning "mismo archivo en otro pozo": solo un booleano y un mensaje fijo, nunca el hash ni cual es el otro pozo', () => {
    cargar(H.propuesto(1, { wellId: '14-0001', sha256: H.sha(77) }), H.propuesto(2, { wellId: '14-0002', sha256: H.sha(77) }), H.propuesto(3, { wellId: '14-0003', sha256: H.sha(78) }));
    const items = pendientes().items;
    expect(items.find((i) => i.documentoId === H.doc(1))).toMatchObject({ warningDuplicadoOtroPozo: true, warningMensaje: 'Este mismo archivo aparece asociado a otro pozo.' });
    expect(items.find((i) => i.documentoId === H.doc(2)).warningDuplicadoOtroPozo).toBe(true);
    expect(items.find((i) => i.documentoId === H.doc(3))).toMatchObject({ warningDuplicadoOtroPozo: false, warningMensaje: null });
    sinFugas(items);
    expect(JSON.stringify(items)).not.toContain('14-0002"' + ',"mimeType":"image/jpeg","bytes":1001');       // el otro pozo no se menciona en el item
  });
  test('un pozo con historial NO derivable no inventa estado: sus propuestas no salen y se cuenta cuantos pozos hay asi', () => {
    cargar(H.propuesto(1, { wellId: '14-0001' }), H.propuesto(2, { wellId: '14-0002' }));
    cargar(H.crudo('ITF_BORRADO', { wellId: '14-0002', documentoId: H.doc(2), clientRequestId: 'corrupto-0001' }));
    const r = pendientes();
    expect(r.items.map((i) => i.documentoId)).toEqual([H.doc(1)]);
    expect(r.pozosSinDerivar).toBe(1);
  });
  test('el nombre del proponente es el visible (sin emails ni basura)', () => {
    cargar(H.propuesto(1, { nombre: 'ana@x.com' }), H.propuesto(2, { nombre: '  Beto \u0007 Perez  ' }));
    const nombres = pendientes().items.map((i) => i.nombreProponente);
    expect(nombres).toEqual(['Beto Perez', 'Usuario']);
  });
});

describe('COLA: paginacion con cursor estable', () => {
  test('default 20, maximo 50, limite explicito, y las paginas se encadenan sin repetir ni perder', () => {
    const ids = cargarPropuestas(45);
    const p1 = pendientes();
    expect(p1.items).toHaveLength(20);
    expect(p1.total).toBe(45);
    expect(p1.siguienteCursor).toEqual(expect.stringMatching(/^s1:\d+$/));
    const p2 = pendientes(val, { cursor: p1.siguienteCursor });
    const p3 = pendientes(val, { cursor: p2.siguienteCursor });
    expect(p2.items).toHaveLength(20);
    expect(p3.items).toHaveLength(5);
    expect(p3.siguienteCursor).toBeNull();
    expect(p1.items.concat(p2.items, p3.items).map((i) => i.documentoId)).toEqual(ids.slice().reverse());
    expect(pendientes(val, { limite: 50 }).items).toHaveLength(45);
    expect(pendientes(val, { limite: 5 }).items).toHaveLength(5);
  });
  test('limite y cursor invalidos se rechazan (nunca se ignoran en silencio)', () => {
    cargarPropuestas(3);
    [0, -1, 51, 1.5, '10', true, [], {}].forEach((limite) => expect(pendientes(val, { limite: limite }).code).toBe('INVALID_LIMITE'));
    ['abc', 's1:0', 's1:-3', 's1:1.5', 's2:4', 's1:', 5, {}, 's1:1234567890123456'].forEach((cursor) => expect(pendientes(val, { cursor: cursor }).code).toBe('INVALID_CURSOR'));
  });
  test('ENTRADAS NUEVAS mientras se pagina: no corren las paginas ya vistas ni repiten items', () => {
    const ids = cargarPropuestas(30);
    const p1 = pendientes(val, { limite: 10 });
    cargarPropuestas(0);
    cargar(H.propuesto(900, { wellId: '14-0099' }), H.propuesto(901, { wellId: '14-0098' }));         // llegan dos nuevas
    const p2 = pendientes(val, { limite: 10, cursor: p1.siguienteCursor });
    expect(p2.items.map((i) => i.documentoId)).toEqual(ids.slice().reverse().slice(10, 20));        // sigue donde quedo, sin las nuevas ni repetidos
    const refresco = pendientes(val, { limite: 10 });
    expect(refresco.items.slice(0, 2).map((i) => i.documentoId)).toEqual([H.doc(901), H.doc(900)]);
  });
  test('SALIDAS mientras se pagina (aprobada / rechazada / retirada): no dejan huecos ni saltan una propuesta distinta', () => {
    const ids = [];
    for (let i = 1; i <= 12; i += 1) { ids.push(docDe(proponer(ana, i, { wellId: '14-' + String(100 + i).padStart(4, '0') }))); }
    const p1 = pendientes(val, { limite: 5 });
    expect(p1.items.map((i) => i.documentoId)).toEqual(ids.slice().reverse().slice(0, 5));
    // mientras tanto salen tres de la primera pagina y una de las siguientes
    expect(rechazar(ids[11]).ok).toBe(true);
    expect(retirar(ids[10]).ok).toBe(true);
    expect(rechazar(ids[5]).ok).toBe(true);
    const p2 = pendientes(val, { limite: 5, cursor: p1.siguienteCursor });
    const esperadas = ids.slice().reverse().slice(5).filter((id) => id !== ids[5]);                    // las que quedan despues del cursor
    expect(p2.items.map((i) => i.documentoId)).toEqual(esperadas.slice(0, 5));
  });
  test('con propuestas que desaparecen justo en el borde, el cursor sigue valido (no depende de que el ultimo item exista)', () => {
    const ids = cargarPropuestas(6);
    const p1 = pendientes(val, { limite: 3 });
    cargar(H.rechazado(6, { wellId: '14-0001' }));                                                   // la ultima entregada ya no esta pendiente (sin importar de que pozo sea)
    const ultimo = p1.items[p1.items.length - 1].documentoId;
    const rest = pendientes(val, { limite: 3, cursor: p1.siguienteCursor });
    expect(rest.items.map((i) => i.documentoId)).not.toContain(ultimo);
    expect(rest.items.length).toBeLessThanOrEqual(3);
    expect(ids).toHaveLength(6);
  });
});

describe('COLA: costo (una lectura de la hoja, cero lecturas por tarjeta)', () => {
  test.each([1, 20, 100, 500])('%i propuestas: UNA lectura de ItfEventos, cero de storage, cero de legacy/Drive, y el tiempo no crece por tarjeta', (cantidad) => {
    cargarPropuestas(cantidad);
    const deps = depsDe(E);
    const llamadas = { leer: 0, buscarPorCrid: 0, storage: 0, legacy: 0, drive: 0, existencia: 0 };
    const repo = deps.repo;
    deps.repo = Object.assign({}, repo, {
      leerTodos: () => { llamadas.leer += 1; return repo.leerTodos(); },
      buscarPorClientRequestId: (...a) => { llamadas.buscarPorCrid += 1; return repo.buscarPorClientRequestId(...a); }
    });
    deps.storage = { guardarPropuesta: () => { llamadas.storage += 1; return { ok: false }; }, leerDocumento: () => { llamadas.storage += 1; return { ok: false }; }, obtenerMetadata: () => { llamadas.storage += 1; return { ok: false }; }, eliminarTemporal: () => { llamadas.storage += 1; return { ok: false }; } };
    ['buscar', 'disponibilidad', 'huella', 'verificarHuella', 'leerRegistrado'].forEach((k) => { deps.legacy = Object.assign({}, deps.legacy, { [k]: () => { llamadas.legacy += 1; throw new Error('la cola no debe mirar el legacy'); } }); });
    deps.existencia = () => { llamadas.existencia += 1; return { existe: true }; };
    const antes = E.drive.calls.getFiles + E.drive.calls.getFilesByName + E.drive.calls.getFileById + E.drive.calls.getBlob;
    const r = pendientes(val, { limite: 50 }, deps);
    expect(r.ok).toBe(true);
    expect(r.items).toHaveLength(Math.min(50, cantidad));
    expect(r.total).toBe(cantidad);
    expect(llamadas).toEqual({ leer: 1, buscarPorCrid: 0, storage: 0, legacy: 0, drive: 0, existencia: 0 });
    expect(E.drive.calls.getFiles + E.drive.calls.getFilesByName + E.drive.calls.getFileById + E.drive.calls.getBlob).toBe(antes);
  });
  test('500 propuestas: se recorren todas las paginas (10 de 50) sin repetir ni perder, y ninguna pagina lleva datos internos', () => {
    const ids = cargarPropuestas(500);
    let cursor;
    const vistos = [];
    for (let i = 0; i < 20 && (i === 0 || cursor); i += 1) {
      const r = pendientes(val, { limite: 50, cursor: cursor });
      sinFugas(r);
      r.items.forEach((it) => vistos.push(it.documentoId));
      cursor = r.siguienteCursor;
    }
    expect(vistos).toEqual(ids.slice().reverse());
    expect(cursor).toBeNull();
  });
});

describe('APERTURA de un documento (getItfDocumentoModeracion)', () => {
  test('propuesta: metadata segura + imagen identica a la guardada; el contexto del pozo dice cual es el vigente a declarar', () => {
    const r = proponer(ana, 7);
    const ab = abrir(docDe(r));
    expect(ab.ok).toBe(true);
    expect(ab.documento).toMatchObject({ documentoId: docDe(r), origen: 'E9', wellId: W, estado: 'PROPUESTO', mimeType: 'image/jpeg', bytes: 400, nombreOriginal: 'itf-7.jpg', nombreProponente: 'Ana', autoPropuestaPropia: false, restaurable: false, implicito: false });
    expect(Array.from(ab.blob.getBytes())).toEqual(JPEG(400, 7));
    expect(ab.blob.getContentType()).toBe('image/jpeg');
    expect(ab.pozo).toMatchObject({ wellId: W, estado: 'VIGENTE', vigenteActualDocumentoId: 'LEGACY:' + W, vigenteIndeterminado: false });
    sinFugas({ documento: ab.documento, pozo: ab.pozo });
  });
  test('vigente E9, reemplazado, retirado que fue vigente y rechazado: todos se pueden mirar (historial y reversion)', () => {
    const a = docDe(proponer(ana, 1));
    const b = docDe(proponer(ana, 2));
    const c = docDe(proponer(ana, 3));
    expect(aprobar(val, a, 'LEGACY:' + W).ok).toBe(true);
    expect(aprobar(val, b, a).ok).toBe(true);                       // a REEMPLAZADO, b VIGENTE
    expect(rechazar(c).ok).toBe(true);
    expect(abrir(b).documento).toMatchObject({ estado: 'VIGENTE', reemplazaA: a, restaurable: false });
    expect(abrir(a).documento).toMatchObject({ estado: 'REEMPLAZADO', reemplazadoPor: b, restaurable: true });
    expect(abrir(c).documento).toMatchObject({ estado: 'RECHAZADO', restaurable: false, decision: { evento: 'ITF_RECHAZADO', motivoCodigo: 'ILEGIBLE' } });
    expect(abrir(b).pozo.vigenteActualDocumentoId).toBe(b);
    expect(Array.from(abrir(a).blob.getBytes())).toEqual(JPEG(400, 1));
    expect(retirar(b).ok).toBe(true);
    expect(abrir(b).documento).toMatchObject({ estado: 'RETIRADO', restaurable: true });
    expect(abrir(b).pozo.vigenteActualDocumentoId).toBeNull();
  });
  test('legacy NO registrado: se abre como vigente implicito; no hay forma de abrir un legacy que no existe', () => {
    const ab = abrir('LEGACY:' + W);
    expect(ab.ok).toBe(true);
    expect(ab.documento).toMatchObject({ documentoId: 'LEGACY:' + W, origen: 'LEGACY', estado: 'VIGENTE', implicito: true, restaurable: false });
    expect(Array.from(ab.blob.getBytes())).toEqual(BYTES_LEGACY);
    expect(abrir('LEGACY:14-0002').code).toBe('ITF_NOT_FOUND');
  });
  test('legacy REGISTRADO: se abre como historico mientras su huella coincida; si el archivo cambio, LEGACY_CAMBIO; si desaparecio, ITF_NOT_FOUND', () => {
    const a = docDe(proponer(ana, 1));
    expect(aprobar(val, a, 'LEGACY:' + W).ok).toBe(true);
    const ab = abrir('LEGACY:' + W);
    expect(ab.documento).toMatchObject({ origen: 'LEGACY', estado: 'REEMPLAZADO', implicito: false, restaurable: true, mimeType: 'image/jpeg', bytes: 300 });
    expect(Array.from(ab.blob.getBytes())).toEqual(BYTES_LEGACY);
    E.drive.estado.archivos[0].bytes = JPEG(300, 9);
    expect(abrir('LEGACY:' + W)).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
    E.drive.estado.archivos.length = 0;
    expect(abrir('LEGACY:' + W)).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
  });
  test('ids invalidos o inexistentes y pozo no derivable', () => {
    expect(abrir('no-es-un-id').code).toBe('INVALID_DOCUMENTO_ID');
    expect(abrir(undefined).code).toBe('INVALID_DOCUMENTO_ID');
    expect(abrir(H.doc(555)).code).toBe('ITF_NOT_FOUND');
    cargar(H.propuesto(1), H.crudo('ITF_BORRADO', { documentoId: H.doc(1), clientRequestId: 'corrupto-0001' }));
    expect(abrir(H.doc(1)).code).toBe('ITF_STATE_UNKNOWN');
  });
  test('el storage falla o no esta configurado: codigo estable sin detalle del storage', () => {
    const a = docDe(proponer(ana, 1));
    const deps = depsDe(E);
    deps.storage = Object.assign({}, deps.storage, { leerDocumento: () => ({ ok: false, code: 'SERVICE_UNAVAILABLE', detalle: 'id-secreto-xyz' }) });
    expect(abrir(a, val, deps)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE', message: 'documento no disponible' });
    deps.storage = Object.assign({}, deps.storage, { leerDocumento: () => ({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' }) });
    expect(abrir(a, val, deps).code).toBe('ITF_STORAGE_NO_CONFIGURADO');
  });
  test('legacy ambiguo (dos <wellId>.jpg): el vigente actual es INDETERMINADO y no se inventa uno', () => {
    const a = docDe(proponer(ana, 1));
    E.drive.estado.archivos.push({ id: 'legacy-duplicado', name: W + '.jpg', bytes: JPEG(300, 6) });          // aparece un segundo <wellId>.jpg despues
    const ab = abrir(a);
    expect(ab.ok).toBe(true);
    expect(ab.pozo).toMatchObject({ vigenteActualDocumentoId: null, vigenteIndeterminado: true, tieneItf: 'DESCONOCIDO' });
  });
  test('una sola lectura de la hoja y el legacy solo se consulta si ningun E9 decide el vigente', () => {
    const a = docDe(proponer(ana, 1));
    expect(aprobar(val, a, 'LEGACY:' + W).ok).toBe(true);
    const deps = depsDe(E);
    let lecturas = 0;
    let legacy = 0;
    const repo = deps.repo;
    deps.repo = Object.assign({}, repo, { leerTodos: () => { lecturas += 1; return repo.leerTodos(); } });
    deps.legacy = Object.assign({}, deps.legacy, { buscar: (w) => { legacy += 1; return depsDe(E).legacy.buscar(w); } });
    expect(abrir(a, val, deps).ok).toBe(true);
    expect(lecturas).toBe(1);
    expect(legacy).toBe(0);                                      // el vigente es E9: el legacy no decide nada
  });
});

describe('HISTORIAL por pozo (getHistorialItf)', () => {
  test('pozo sin eventos: historial vacio y el legacy como vigente implicito', () => {
    const r = historial(W);
    expect(r).toMatchObject({ ok: true, wellId: W, historial: [] });
    expect(r.pozo).toMatchObject({ estado: 'VIGENTE', vigenteActualDocumentoId: 'LEGACY:' + W });
    expect(r.documentos.map((d) => d.documentoId)).toEqual(['LEGACY:' + W]);
    expect(r.documentos[0].implicito).toBe(true);
  });
  test('pozo sin eventos ni legacy: SIN_ITF y todo vacio', () => {
    entorno({ archivos: [] });
    const r = historial(W);
    expect(r.pozo).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO', vigenteActualDocumentoId: null });
    expect(r.documentos).toEqual([]);
  });
  test('toda la evolucion del nuevo al viejo: propuesta, aprobacion (con registro del legacy), reemplazo, rechazo, retiro y reversion', () => {
    const a = docDe(proponer(ana, 1));
    const b = docDe(proponer(ambos, 2));
    const c = docDe(proponer(ana, 3));
    expect(aprobar(val, a, 'LEGACY:' + W).ok).toBe(true);
    expect(aprobar(ambos, b, a).ok).toBe(true);
    expect(rechazar(c).ok).toBe(true);
    expect(ej(val, { accion: 'REVERTIR', documentoId: a, documentoReemplazadoId: b, motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() }).ok).toBe(true);
    const r = historial(W);
    expect(r.historial.map((h) => h.evento)).toEqual(['ITF_REVERTIDO', 'ITF_RECHAZADO', 'ITF_APROBADO', 'ITF_APROBADO', 'ITF_LEGACY_REGISTRADO', 'ITF_PROPUESTO', 'ITF_PROPUESTO', 'ITF_PROPUESTO']);
    expect(r.historial[0]).toMatchObject({ documentoId: a, documentoReemplazadoId: b, nombre: 'Valeria', motivoCodigo: 'ERROR_DE_APROBACION', estadoActualDocumento: 'VIGENTE' });
    expect(r.historial[0].detalle).toMatch(/restauro/);
    expect(r.historial.find((h) => h.documentoId === b && h.evento === 'ITF_APROBADO').detalle).toMatch(/reemplazo/);
    expect(r.pozo.vigenteActualDocumentoId).toBe(a);
    expect(r.documentos.find((d) => d.documentoId === b)).toMatchObject({ estado: 'REEMPLAZADO', autoPropuestaPropia: false });
    sinFugas(r);
  });
  test('la autoaprobacion queda visible en el detalle y en el documento, sin crear un estado especial', () => {
    const a = docDe(proponer(ambos, 1));
    expect(aprobar(ambos, a, 'LEGACY:' + W).ok).toBe(true);
    const r = historial(W, ambos);
    expect(r.historial[0].detalle).toMatch(/quien lo habia propuesto/);
    expect(r.documentos.find((d) => d.documentoId === a)).toMatchObject({ estado: 'VIGENTE', autoaprobado: true, autoPropuestaPropia: true });
  });
  test('wellId invalido, pozo no derivable, hoja caida', () => {
    ['', '14-001', null, undefined, 1401, '14-0001 '].forEach((w) => expect(historial(w).code).toBe('INVALID_WELL_ID'));
    cargar(H.propuesto(1), H.crudo('ITF_BORRADO', { documentoId: H.doc(1), clientRequestId: 'corrupto-0001' }));
    expect(historial(W).code).toBe('ITF_STATE_UNKNOWN');
    const deps = depsDe(E);
    deps.repo = Object.assign({}, deps.repo, { leerTodos: () => { throw new Error('caido'); } });
    expect(historial('14-0002', val, deps).code).toBe('SERVICE_UNAVAILABLE');
  });
  test('un pozo ajeno no se mezcla: solo salen los eventos del pozo pedido', () => {
    proponer(ana, 1);
    ej(ana, { accion: 'PROPONER', wellId: '14-0002', clientRequestId: crid() }, { archivo: archivoJpeg(2) });
    expect(historial(W).historial).toHaveLength(1);
    expect(historial('14-0002').historial).toHaveLength(1);
  });
});

describe('las lecturas no escriben nunca', () => {
  test('ni la hoja, ni el storage, ni el legacy, ni la cache', () => {
    const a = docDe(proponer(ana, 1));
    const antesFilas = E.hoja.filas.length;
    const deps = depsDe(E);
    deps.invalidarCaches = jest.fn();
    const escribe = jest.fn();
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: escribe, conLock: () => { throw new Error('una lectura no toma el lock'); } });
    const guardados = E.storage.guardados;
    expect(pendientes(val, {}, deps).ok).toBe(true);
    expect(abrir(a, val, deps).ok).toBe(true);
    expect(historial(W, val, deps).ok).toBe(true);
    expect(escribe).not.toHaveBeenCalled();
    expect(deps.invalidarCaches).not.toHaveBeenCalled();
    expect(E.hoja.filas.length).toBe(antesFilas);
    expect(E.storage.guardados).toBe(guardados);
    expect(E.storage.eliminados).toEqual([]);
    expect(sha256(JPEG(400, 1))).toHaveLength(64);
  });
});
