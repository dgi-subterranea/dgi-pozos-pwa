// ItfService (E9-3), ESCRITURA: itfService_ejecutar con hoja en memoria, Drive falso y storage falso. Lock + relectura adentro del lock, carrera simulada, reintento, conflicto, doble evento
// (registro del legacy + aprobacion) en UNA operacion, fallo parcial, huella del legacy, compensacion del archivo temporal, retiro de la PROPIA propuesta, privacidad. Api.js no participa.
const { crearEntorno, depsDe, JPEG, JPEG_GRANDE, PNG, sha256 } = require('./itfEntorno');
const H = require('./itfHelper');

const { ana, val, ambos, lee } = H.USUARIOS;
const W = '14-0001';
const OTRO = '14-0002';
const LEGACY_ID = 'LEGACY:' + W;
const BYTES_LEGACY = JPEG(300, 5);

let E;
let S;
let n;
const crid = () => { n += 1; return 'esc-req-' + String(n).padStart(8, '0'); };
const entorno = (op) => { E = crearEntorno(Object.assign({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } }, op || {})); S = E.mods.servicio; H.reiniciar(); n = 0; return E; };
beforeEach(() => entorno());

const filas = () => E.hoja.filas.slice(1);
const eventos = () => E.mods.repo.itfEventosRepository_leerTodos().eventos;
const cols = () => E.mods.repo.ITF_EVENTOS_COLUMNAS;
const cargar = (...evs) => evs.forEach((e) => E.hoja.filas.push(cols().map((c) => (e[c] === undefined ? '' : e[c]))));
const archivoJpeg = (relleno, tam) => ({ bytes: JPEG(tam || 400, relleno), mimeType: 'image/jpeg', nombreOriginal: 'itf-' + relleno + '.jpg' });
const ej = (usuario, comando, opciones, deps) => S.itfService_ejecutar(usuario, comando, opciones || {}, deps || depsDe(E));
const proponer = (usuario, relleno, extra, deps) => ej(usuario || ana, Object.assign({ accion: 'PROPONER', wellId: W, clientRequestId: crid() }, extra || {}), { archivo: archivoJpeg(relleno || 1) }, deps);
const docDe = (r) => r.resultado.documentoId;
const aprobar = (usuario, documentoId, reemplaza, extra, deps) => ej(usuario || val, Object.assign({ accion: 'APROBAR', documentoId: documentoId, clientRequestId: crid() }, reemplaza ? { documentoReemplazadoId: reemplaza, motivoCodigo: 'ACTUALIZACION' } : {}, extra || {}), {}, deps);
const vigente = (w) => S.itfService_resolverVigente(w || W, depsDe(E));

describe('puertas de entrada (antes de tocar nada)', () => {
  test('E9 apagado: ITF_E9_INACTIVO y no se lee ni se escribe nada', () => {
    entorno({ props: {} });
    const r = proponer(ana, 1);
    expect(r).toMatchObject({ ok: false, code: 'ITF_E9_INACTIVO' });
    expect(filas()).toHaveLength(0);
    expect(E.storage.guardados).toBe(0);
  });
  test('comando invalido, sin permiso o sin email: error sin tocar la hoja ni el storage', () => {
    expect(ej(ana, { accion: 'NADA', clientRequestId: crid() }).code).toBe('INVALID_ACCION');
    expect(ej(lee, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: archivoJpeg(1) }).code).toBe('PERMISSION_DENIED');
    expect(ej(val, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: archivoJpeg(1) }).code).toBe('PERMISSION_DENIED');
    expect(ej({ email: 'sin-arroba', nombre: 'x', permisos: ana.permisos }, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: archivoJpeg(1) }).code).toBe('INVALID_REQUEST');
    expect(ej(null, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }).code).toBe('PERMISSION_DENIED');
    expect(filas()).toHaveLength(0);
    expect(E.storage.guardados).toBe(0);
  });
  test('el cliente NO puede elegir el actor: cualquier campo email / actor / nombre se rechaza y el evento lleva la sesion', () => {
    ['email', 'actor', 'nombre', 'emailUsuario', 'usuario'].forEach((campo) => {
      expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid(), [campo]: 'otro@x.com' }, { archivo: archivoJpeg(1) }).code).toBe('INVALID_REQUEST');
    });
    expect(filas()).toHaveLength(0);
    proponer(ana, 1);
    expect(eventos()[0].email).toBe('ana@x.com');
    expect(eventos()[0].nombre).toBe('Ana');
  });
  test('una excepcion interna se traduce a SERVICE_UNAVAILABLE sin detalles (ni texto del error)', () => {
    entorno({ archivos: [] });                                                                    // sin vigente: la existencia sale de las fuentes independientes
    const r = proponer(ana, 1, {}, depsDe(E, { existencia: () => { throw new Error('SECRETO-INTERNO'); } }));
    expect(r).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });
});

describe('PROPONER (con storage falso)', () => {
  test('caso feliz: valida, hashea los bytes reales, guarda, escribe UNA fila con la metadata y devuelve solo evento / documentoId / wellId', () => {
    const a = archivoJpeg(7, 500);
    const r = ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: 'prop-feliz-001' }, { archivo: a });
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 1 });
    expect(Object.keys(r.resultado).sort()).toEqual(['documentoId', 'evento', 'wellId']);
    expect(E.storage.guardados).toBe(1);
    const e = eventos()[0];
    expect(e).toMatchObject({ evento: 'ITF_PROPUESTO', wellId: W, documentoId: docDe(r), mimeType: 'image/jpeg', bytes: 500, sha256: sha256(a.bytes), storageFileId: 'e9-storage-000001', nombreOriginal: 'itf-7.jpg', secuencia: 1, clientRequestId: 'prop-feliz-001' });
    expect(e.documentoId).not.toBe(e.storageFileId);
    expect(JSON.stringify(r)).not.toMatch(/@x\.com|e9-storage|req-|sha256|secuencia/);
  });
  test('una propuesta NO cambia el vigente: el legacy sigue siendo el ITF', () => {
    proponer(ana, 1);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'LEGACY' });
    expect(S.itfService_disponibilidad([W], depsDe(E))).toEqual({ [W]: true });
  });
  test('archivo invalido (PDF, vacio, otro formato): error y el storage ni se toca', () => {
    expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: { bytes: Array.from(Buffer.from('%PDF-1.4 ...')), mimeType: 'application/pdf', nombreOriginal: 'a.pdf' } }).code).toBe('MIME_NO_PERMITIDO');
    expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: { bytes: [], mimeType: 'image/jpeg' } }).code).toBe('ARCHIVO_VACIO');
    expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: { bytes: PNG(50), mimeType: 'image/jpeg' } }).code).toBe('MIME_NO_COINCIDE');
    expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, {}).code).toBe('INVALID_ARCHIVO');
    expect(E.storage.guardados).toBe(0);
    expect(filas()).toHaveLength(0);
  });
  test('sin ITF vigente el pozo tiene que existir por una fuente INDEPENDIENTE; si no se puede comprobar, SERVICE_UNAVAILABLE; el storage no se toca', () => {
    entorno({ archivos: [] });
    expect(proponer(ana, 1, {}, depsDe(E, { existencia: () => ({ existe: false, indeterminado: false }) })).code).toBe('POZO_NOT_FOUND');
    expect(proponer(ana, 1, {}, depsDe(E, { existencia: () => ({ existe: false, indeterminado: true }) })).code).toBe('SERVICE_UNAVAILABLE');
    expect(E.storage.guardados).toBe(0);
    expect(filas()).toHaveLength(0);
  });
  test('REINTENTO exacto: mismo resultado, sin fila nueva y SIN subir otra copia al storage', () => {
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'prop-reintento-1' };
    const a = ej(ana, comando, { archivo: archivoJpeg(1) });
    const b = ej(ana, comando, { archivo: archivoJpeg(1) });
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO', eventosEscritos: 0 });
    expect(docDe(b)).toBe(docDe(a));
    expect(filas()).toHaveLength(1);
    expect(E.storage.guardados).toBe(1);
  });
  test('mismo clientRequestId con OTRO archivo: IDEMPOTENCY_CONFLICT, sin fila y sin storage nuevo', () => {
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'prop-conflicto-1' };
    ej(ana, comando, { archivo: archivoJpeg(1) });
    expect(ej(ana, comando, { archivo: archivoJpeg(2) }).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(filas()).toHaveLength(1);
    expect(E.storage.guardados).toBe(1);
  });
  test('duplicado documental (mismo hash, otro clientRequestId): DUPLICADO_DOCUMENTO ANTES de subir (no se guarda nada que despues no se pueda registrar)', () => {
    proponer(ana, 1);
    const r = proponer(ana, 1);
    expect(r).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO' });
    expect(r.compensacion).toBeUndefined();
    expect(E.storage.guardados).toBe(1);
    expect(E.storage.eliminados).toEqual([]);
    expect(E.storage.docs['e9-storage-000001']).toBeDefined();
    expect(filas()).toHaveLength(1);
  });
  // simula una carrera: entre la prevalidacion (sin lock) y el lock aparece una propuesta con el MISMO archivo de otra persona
  const conPropuestaIntermedia = (relleno) => {
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
      if (interferir) { interferir = false; expect(ej(ambos, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: archivoJpeg(relleno) }, depsDe(E)).ok).toBe(true); }
      return fn();
    }) });
    return deps;
  };
  test('CARRERA: el mismo archivo lo registra otra persona entre la prevalidacion y el lock -> DUPLICADO_DOCUMENTO y se COMPENSA el archivo recien subido', () => {
    const r = proponer(ana, 1, {}, conPropuestaIntermedia(1));
    expect(r).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO', compensacion: 'OK' });
    expect(E.storage.guardados).toBe(2);
    expect(E.storage.eliminados).toEqual(['e9-storage-000001']);              // el archivo de ESTA solicitud (subido antes del lock) se retira
    expect(E.storage.docs['e9-storage-000002']).toBeDefined();                // el de la otra persona (referenciado por su fila) NO se toca
    expect(filas()).toHaveLength(1);
  });
  test('el storage falla al guardar: error del storage, sin fila', () => {
    E.storage.fallarGuardar = true;
    expect(proponer(ana, 1)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(filas()).toHaveLength(0);
  });
  test('el storage por defecto (E9-3) no esta configurado: ITF_STORAGE_NO_CONFIGURADO y no se escribe nada', () => {
    const d = depsDe(E);
    delete d.storage;
    expect(ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: archivoJpeg(1) }, Object.assign({}, d, { storage: undefined }))).toMatchObject({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
    expect(filas()).toHaveLength(0);
  });
  test('COMPENSACION: si la escritura del evento falla ANTES de escribir, el archivo temporal se retira (no queda huerfano en silencio)', () => {
    const deps = depsDe(E);
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: () => { throw new Error('Sheets caido'); } });
    const r = proponer(ana, 1, {}, deps);
    expect(r).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(E.storage.eliminados).toEqual(['e9-storage-000001']);
    expect(deps.invalidarCaches).not.toHaveBeenCalled();
  });
  test('si la escritura LANZA pero la fila SI quedo escrita (corte despues del append), NO se borra el archivo: esta referenciado', () => {
    const deps = depsDe(E);
    const real = deps.repo.escribirEventos;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: (evs) => { real(evs); throw new Error('timeout despues de escribir'); } });
    const comando = { accion: 'PROPONER', wellId: W, clientRequestId: 'prop-corte-0001' };
    expect(ej(ana, comando, { archivo: archivoJpeg(1) }, deps)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(E.storage.eliminados).toEqual([]);
    expect(filas()).toHaveLength(1);
    // y el reintento con el mismo id reconoce la fila ya escrita
    expect(ej(ana, comando, { archivo: archivoJpeg(1) })).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(E.storage.guardados).toBe(1);
  });
  test('si ni siquiera se puede releer la hoja para comprobar, NO se borra nada', () => {
    const deps = depsDe(E);
    let lecturas = 0;
    const real = deps.repo.leerTodos;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: () => { throw new Error('caido'); }, leerTodos: () => { lecturas += 1; if (lecturas >= 2) { throw new Error('caido'); } return real(); } });
    expect(proponer(ana, 1, {}, deps).ok).toBe(false);
    expect(E.storage.eliminados).toEqual([]);
  });
  test('la compensacion puede fallar: se informa (compensacion:FALLO) y no se oculta el motivo original', () => {
    E.storage.fallarEliminar = true;
    expect(proponer(ana, 1, {}, conPropuestaIntermedia(1))).toMatchObject({ ok: false, code: 'DUPLICADO_DOCUMENTO', compensacion: 'FALLO' });
    expect(Logger.log).toHaveBeenCalledWith(expect.stringMatching(/huerfano/));
  });
});

describe('APROBAR / registro del legacy / lock', () => {
  test('primer reemplazo del legacy: DOS filas consecutivas (registro con la huella + aprobacion) en UNA operacion bajo el lock', () => {
    const p = proponer(ana, 1);
    let setValues = 0;
    const getRange = E.hoja.getRange.bind(E.hoja);
    E.hoja.getRange = (f, c, nf, nc) => { const r = getRange(f, c, nf, nc); const sv = r.setValues.bind(r); r.setValues = (v) => { setValues += 1; return sv(v); }; return r; };
    const a = aprobar(val, docDe(p), LEGACY_ID);
    expect(a).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 2 });
    expect(setValues).toBe(1);
    const ev = eventos();
    expect(ev.map((e) => [e.secuencia, e.evento])).toEqual([[1, 'ITF_PROPUESTO'], [2, 'ITF_LEGACY_REGISTRADO'], [3, 'ITF_APROBADO']]);
    expect(ev[1]).toMatchObject({ documentoId: LEGACY_ID, mimeType: 'image/jpeg', bytes: 300, sha256: sha256(BYTES_LEGACY), storageFileId: 'legacy-' + W, nombreOriginal: W + '.jpg', clientRequestId: '', motivoCodigo: '' });
    expect(ev[2]).toMatchObject({ documentoId: docDe(p), documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION' });
    expect(E.lock.waitLock).toHaveBeenCalled();
    expect(E.lock.releaseLock).toHaveBeenCalledTimes(E.lock.waitLock.mock.calls.length);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: docDe(p) });
  });
  test('el archivo legacy NO se toca: sigue en la carpeta, mismo contenido (Drive solo se lee)', () => {
    const p = proponer(ana, 1);
    aprobar(val, docDe(p), LEGACY_ID);
    expect(E.drive.estado.archivos).toEqual([{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }]);
  });
  test('reintento de la aprobacion: no duplica ni el registro ni la aprobacion', () => {
    const p = proponer(ana, 1);
    const comando = { accion: 'APROBAR', documentoId: docDe(p), documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'CORRECCION', clientRequestId: 'aprob-reintento-1' };
    expect(ej(val, comando).eventosEscritos).toBe(2);
    expect(ej(val, comando)).toMatchObject({ ok: true, accion: 'REINTENTO', eventosEscritos: 0 });
    expect(filas()).toHaveLength(3);
  });
  test('mismo clientRequestId con otro contenido: IDEMPOTENCY_CONFLICT y nada nuevo', () => {
    const p = proponer(ana, 1);
    const q = proponer(ana, 2);
    const base = { accion: 'APROBAR', documentoId: docDe(p), documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'CORRECCION', clientRequestId: 'aprob-conflicto-1' };
    ej(val, base);
    const antes = filas().length;
    expect(ej(val, Object.assign({}, base, { documentoId: docDe(q) })).code).toBe('IDEMPOTENCY_CONFLICT');
    expect(filas()).toHaveLength(antes);
  });
  test('si el registro del legacy YA existe (reintento tras un corte), NO se vuelve a registrar', () => {
    const p = proponer(ana, 1);
    cargar(H.legacy(W, { secuencia: 2, eventoId: H.uuid(555), storageFileId: 'legacy-' + W, sha256: sha256(BYTES_LEGACY), bytes: 300, email: 'val@x.com' }));
    const a = aprobar(val, docDe(p), LEGACY_ID);
    expect(a).toMatchObject({ ok: true, eventosEscritos: 1 });
    expect(eventos().filter((e) => e.evento === 'ITF_LEGACY_REGISTRADO')).toHaveLength(1);
    expect(eventos().map((e) => e.secuencia)).toEqual([1, 2, 3]);
  });
  test('FALLO PARCIAL: si solo la primera fila llega a escribirse, el estado sigue consistente (legacy vigente) y el reintento completa SIN duplicar el registro', () => {
    const p = proponer(ana, 1);
    const deps = depsDe(E);
    const real = deps.repo.escribirEventos;
    let primera = true;
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: (evs) => { if (primera) { primera = false; real([evs[0]]); throw new Error('corte entre filas'); } return real(evs); } });
    const comando = { accion: 'APROBAR', documentoId: docDe(p), documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION', clientRequestId: 'aprob-parcial-01' };
    expect(ej(val, comando, {}, deps)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO']);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'LEGACY' });            // el registro por si solo NO reemplaza nada
    expect(deps.invalidarCaches).not.toHaveBeenCalled();
    const reintento = ej(val, comando, {}, deps);
    expect(reintento).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 1 });
    expect(eventos().map((e) => [e.secuencia, e.evento])).toEqual([[1, 'ITF_PROPUESTO'], [2, 'ITF_LEGACY_REGISTRADO'], [3, 'ITF_APROBADO']]);
    expect(vigente()).toMatchObject({ origen: 'E9', documentoId: docDe(p) });
  });
  test('FALLO TOTAL de la escritura: nada queda escrito, no se invalida cache y el resultado no filtra detalles', () => {
    const p = proponer(ana, 1);
    const deps = depsDe(E);
    deps.repo = Object.assign({}, deps.repo, { escribirEventos: () => { throw new Error('Sheets DETALLE-INTERNO'); } });
    const r = aprobar(val, docDe(p), LEGACY_ID, {}, deps);
    expect(r).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
    expect(filas()).toHaveLength(1);
    expect(deps.invalidarCaches).not.toHaveBeenCalled();
  });
  test('LOCK: todas las lecturas y la escritura ocurren DENTRO del lock; el lock se libera siempre', () => {
    const p = proponer(ana, 1);
    const deps = depsDe(E);
    let dentro = false;
    const dentroEn = [];
    const rep = deps.repo;
    deps.repo = {
      conLock: (fn) => { dentro = true; try { return rep.conLock(fn); } finally { dentro = false; } },
      leerTodos: () => { dentroEn.push(['leerTodos', dentro]); return rep.leerTodos(); },
      buscarPorClientRequestId: (a, b) => { dentroEn.push(['buscar', dentro]); return rep.buscarPorClientRequestId(a, b); },
      escribirEventos: (e) => { dentroEn.push(['escribir', dentro]); return rep.escribirEventos(e); }
    };
    aprobar(val, docDe(p), LEGACY_ID, {}, deps);
    expect(dentroEn.length).toBeGreaterThanOrEqual(3);
    expect(dentroEn.every(([, d]) => d === true)).toBe(true);
    expect(dentroEn.map(([x]) => x)).toEqual(['buscar', 'leerTodos', 'escribir']);
    expect(E.lock.releaseLock).toHaveBeenCalled();
  });
  test('LOCK: si no se consigue (waitLock lanza), SERVICE_UNAVAILABLE y no se escribe nada', () => {
    const p = proponer(ana, 1);
    E.lock.waitLock.mockImplementation(() => { throw new Error('Lock timeout'); });
    const antes = filas().length;
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(filas()).toHaveLength(antes);
  });
  test('REVALIDACION dentro del lock (carrera): otro validador cambio el vigente despues de que este vio el legacy -> VIGENTE_CAMBIO y nada se escribe', () => {
    const p = proponer(ana, 1);
    const q = proponer(ana, 2);
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
      if (interferir) { interferir = false; const otro = aprobar(val, docDe(q), LEGACY_ID); expect(otro.ok).toBe(true); }
      return fn();
    }) });
    const antes = () => filas().length;
    const r = aprobar(val, docDe(p), LEGACY_ID, {}, deps);
    expect(r).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(vigente().documentoId).toBe(docDe(q));
    expect(antes()).toBe(4);                                                // 2 propuestas + registro + aprobacion de q (nada de p)
    expect(D().derivar(eventos()).porPozo[W].integridad).toBe('OK');
  });
  test('REVALIDACION: otro validador rechazo la propuesta entre medio -> DOCUMENTO_NO_PROPUESTO (gana el primero)', () => {
    const p = proponer(ana, 1);
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
      if (interferir) { interferir = false; expect(ej(val, { accion: 'RECHAZAR', documentoId: docDe(p), motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }).ok).toBe(true); }
      return fn();
    }) });
    expect(aprobar(val, docDe(p), LEGACY_ID, {}, deps)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_PROPUESTO' });
  });
  test('SECUENCIAS: consecutivas y sin huecos aunque haya reintentos, conflictos y errores en el medio', () => {
    const p = proponer(ana, 1);
    aprobar(val, docDe(p), LEGACY_ID);
    proponer(ana, 1);                                                     // duplicado: no escribe
    const q = proponer(ana, 3);
    aprobar(val, docDe(q), docDe(p));
    expect(eventos().map((e) => e.secuencia)).toEqual([1, 2, 3, 4, 5]);
  });
  test('INVALIDACION: se llama una vez por escritura exitosa con el pozo, y nunca en reintentos, planes fallidos ni errores', () => {
    const deps = depsDe(E);
    const p = proponer(ana, 1, {}, deps);
    expect(deps.invalidarCaches).toHaveBeenCalledTimes(1);
    expect(deps.invalidarCaches).toHaveBeenLastCalledWith([W]);
    const comando = { accion: 'APROBAR', documentoId: docDe(p), documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION', clientRequestId: 'inval-001-aprob' };
    ej(val, comando, {}, deps);
    expect(deps.invalidarCaches).toHaveBeenCalledTimes(2);                // un solo llamado aunque se escribieron dos filas
    ej(val, comando, {}, deps);                                           // reintento
    ej(val, { accion: 'RECHAZAR', documentoId: docDe(p), motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }, {}, deps);   // plan fallido (ya aprobado)
    proponer(ana, 1, {}, deps);                                           // duplicado
    expect(deps.invalidarCaches).toHaveBeenCalledTimes(2);
  });
  test('legacy ambiguo (tambien jpg + JPG) / Drive caido / formato invalido al aprobar: LEGACY_AMBIGUO, SERVICE_UNAVAILABLE, LEGACY_FORMATO_INVALIDO; nada se escribe', () => {
    const p = proponer(ana, 1);
    const antes = filas().length;
    E.drive.agregar({ id: 'dup-' + W, name: W + '.jpg', bytes: JPEG(10) });
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'LEGACY_AMBIGUO' });
    E.drive.quitar('dup-' + W);
    E.drive.agregar({ id: 'may-' + W + '-x', name: W + '.JPG', bytes: JPEG(10) });               // <wellId>.jpg + <wellId>.JPG: dos candidatos equivalentes -> AMBIGUO, jamas uno arbitrario
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'LEGACY_AMBIGUO' });
    E.drive.quitar('may-' + W + '-x');
    E.drive.quitar('legacy-' + W);
    E.drive.agregar({ id: 'pdf-' + W + '-xxx', name: W + '.jpg', bytes: Array.from(Buffer.from('%PDF-1.4 xxxxx')) });
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });
    E.drive.estado.fallar = 'Drive caido';
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(filas()).toHaveLength(antes);
  });
  test('sin legacy: aprobar sin reemplazar nada escribe UNA fila (no hay registro)', () => {
    entorno({ archivos: [] });
    const p = proponer(ana, 1);
    const a = aprobar(val, docDe(p));
    expect(a).toMatchObject({ ok: true, eventosEscritos: 1 });
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'E9' });
  });
  test('historial NO_DERIVABLE en el pozo: ITF_STATE_UNKNOWN y no se escribe', () => {
    const p = proponer(ana, 1);
    cargar(H.crudo('ITF_BORRADO', { documentoId: H.doc(9), secuencia: 50, eventoId: H.uuid(900), email: 'x@x.com' }));
    const antes = filas().length;
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'ITF_STATE_UNKNOWN' });
    expect(filas()).toHaveLength(antes);
  });
  test('un documento inexistente: ITF_NOT_FOUND; autoaprobacion: dos acciones, dos filas, una sola persona', () => {
    expect(aprobar(val, H.doc(77))).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    entorno({ archivos: [] });
    const p = proponer(ambos, 1);
    expect(filas()).toHaveLength(1);
    expect(aprobar(ambos, docDe(p)).ok).toBe(true);
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_APROBADO']);
    expect(S.itfService_resolverVigente(W, depsDe(E)).origen).toBe('E9');
    expect(E.mods.dominio.itfDominio_dtoValidador(E.mods.dominio.itfDominio_estadoPozo(W, E.mods.dominio.itfDominio_derivar(eventos()), false)).vigente.autoaprobado).toBe(true);
  });
});

describe('RECHAZAR / RETIRAR / REVERTIR y la huella del legacy', () => {
  const conLegacyReemplazado = () => { const p = proponer(ana, 1); aprobar(val, docDe(p), LEGACY_ID); return docDe(p); };
  const revertirLegacy = (reemplaza, deps) => ej(val, { accion: 'REVERTIR', documentoId: LEGACY_ID, documentoReemplazadoId: reemplaza, motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() }, {}, deps);

  test('restaurar el legacy: se vuelve a leer el archivo, se verifica su existencia y su hash contra el registro; si coincide, vuelve a ser vigente', () => {
    const b = conLegacyReemplazado();
    E.drive.calls.getBlob = 0;
    const r = revertirLegacy(b);
    expect(r).toMatchObject({ ok: true, eventosEscritos: 1 });
    expect(E.drive.calls.getBlob).toBeGreaterThanOrEqual(1);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO', 'ITF_REVERTIDO']);
  });
  test('el legacy CAMBIO desde que se registro (mismo archivo, otro contenido): LEGACY_CAMBIO, no se restaura y nada se escribe', () => {
    const b = conLegacyReemplazado();
    E.drive.estado.archivos[0].bytes = JPEG(300, 6);
    const antes = filas().length;
    expect(revertirLegacy(b)).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
    expect(filas()).toHaveLength(antes);
    expect(vigente()).toMatchObject({ origen: 'E9' });
  });
  test('el legacy fue reemplazado por OTRO archivo con el mismo nombre (otro id): LEGACY_CAMBIO', () => {
    const b = conLegacyReemplazado();
    E.drive.estado.archivos[0].name = W + '.viejo.jpg';                                   // el archivo registrado sigue ahi, intacto, pero ya no es el <wellId>.jpg
    E.drive.agregar({ id: 'otro-archivo-' + W, name: W + '.jpg', bytes: BYTES_LEGACY });   // y hay OTRO archivo, con el mismo contenido, llamado <wellId>.jpg
    expect(revertirLegacy(b)).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
  });
  test('el legacy ya no esta: LEGACY_NO_DISPONIBLE', () => {
    const b = conLegacyReemplazado();
    E.drive.quitar('legacy-' + W);
    expect(revertirLegacy(b)).toMatchObject({ ok: false, code: 'LEGACY_NO_DISPONIBLE' });
  });
  test('restaurar un E9 historico no necesita mirar el hash del legacy', () => {
    entorno({ archivos: [] });
    const a = docDe(proponer(ana, 1));
    aprobar(val, a);
    const b = docDe(proponer(ana, 2));
    aprobar(val, b, a);
    const r = ej(val, { accion: 'REVERTIR', documentoId: a, documentoReemplazadoId: b, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() });
    expect(r.ok).toBe(true);
    expect(vigente().documentoId).toBe(a);
  });
  test('retirar el legacy implicito: se registra su huella y despues el retiro (dos filas); el pozo queda SIN ITF aunque el archivo siga en la carpeta', () => {
    const r = ej(val, { accion: 'RETIRAR', documentoId: LEGACY_ID, motivoCodigo: 'DESACTUALIZADO', clientRequestId: crid() });
    expect(r).toMatchObject({ ok: true, eventosEscritos: 2 });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_RETIRADO']);
    expect(vigente()).toMatchObject({ estado: 'NO' });
    expect(E.drive.estado.archivos).toHaveLength(1);
  });
  test('retirar un vigente: solo un validador; el proponente (perfil_subir) no puede', () => {
    entorno({ archivos: [] });
    const a = docDe(proponer(ana, 1));
    aprobar(val, a);
    expect(ej(ana, { accion: 'RETIRAR', documentoId: a, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() }).code).toBe('PERMISSION_DENIED');
    expect(ej(ana, { accion: 'RETIRAR_PROPUESTA', documentoId: a, clientRequestId: crid() }).code).toBe('DOCUMENTO_NO_RETIRABLE');
    expect(vigente().estado).toBe('SI');
    expect(ej(val, { accion: 'RETIRAR', documentoId: a, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() }).ok).toBe(true);
    expect(vigente().estado).toBe('NO');
  });
  test('rechazar una propuesta no depende del legacy ni de Drive', () => {
    const a = docDe(proponer(ana, 1));
    E.drive.estado.fallar = 'Drive caido';
    expect(ej(val, { accion: 'RECHAZAR', documentoId: a, motivoCodigo: 'INCOMPLETO', clientRequestId: crid() }).ok).toBe(true);
  });
});

// El limite de 3 MB es SOLO de las propuestas NUEVAS. Un legacy existente (la auditoria real midio hasta 11,54 MB; 42 archivos sobre 3 MB) se registra, reemplaza, retira y restaura sin recodificarlo ni moverlo,
// con su propio tope defensivo de 20 MB (fail-closed por encima).
describe('legacy GRANDE: ciclo de vida completo, con limites de propuesta y de legacy separados', () => {
  const MAX_AUDITADO = 11540150;
  const MB20 = 20 * 1024 * 1024;
  const conLegacy = (bytes) => entorno({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: bytes }] });
  const reemplazarLegacy = () => { const p = proponer(ana, 1); return { p: p, a: aprobar(val, docDe(p), LEGACY_ID) }; };

  test.each([
    ['2 MB', 2 * 1024 * 1024], ['3 MB exactos', 3 * 1024 * 1024], ['3,1 MB', 3250586], ['11,54 MB (el maximo auditado)', MAX_AUDITADO], ['12 MB', 12 * 1024 * 1024], ['20 MB exactos', MB20]
  ])('reemplazar un legacy de %s por una propuesta nueva: registra el legacy (hash real) + aprueba la nueva', (_n, tam) => {
    const bytes = JPEG_GRANDE(tam, 5);
    conLegacy(bytes);
    const { p, a } = reemplazarLegacy();
    expect(a).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 2 });
    const ev = eventos();
    expect(ev.map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO']);
    expect(ev[1]).toMatchObject({ documentoId: LEGACY_ID, mimeType: 'image/jpeg', bytes: tam, sha256: sha256(bytes), storageFileId: 'legacy-' + W });
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: docDe(p) });
  });
  test('retirar un legacy de 11,54 MB: registra su huella y despues el retiro (dos filas); el pozo queda SIN ITF', () => {
    conLegacy(JPEG_GRANDE(MAX_AUDITADO, 6));
    const r = ej(val, { accion: 'RETIRAR', documentoId: LEGACY_ID, motivoCodigo: 'DESACTUALIZADO', clientRequestId: crid() });
    expect(r).toMatchObject({ ok: true, eventosEscritos: 2 });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_RETIRADO']);
    expect(eventos()[0].bytes).toBe(MAX_AUDITADO);
    expect(vigente()).toMatchObject({ estado: 'NO' });
  });
  test('restaurar un legacy de 11,54 MB: se vuelve a leer, recalcula el hash y vuelve a ser vigente', () => {
    conLegacy(JPEG_GRANDE(MAX_AUDITADO, 7));
    const { p } = reemplazarLegacy();
    E.drive.calls.getBlob = 0;
    const r = ej(val, { accion: 'REVERTIR', documentoId: LEGACY_ID, documentoReemplazadoId: docDe(p), motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() });
    expect(r).toMatchObject({ ok: true, eventosEscritos: 1 });
    expect(E.drive.calls.getBlob).toBeGreaterThanOrEqual(1);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'LEGACY', documentoId: LEGACY_ID });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO', 'ITF_REVERTIDO']);
  });
  test('hash cambiado en un legacy de 11,54 MB (un byte): LEGACY_CAMBIO, no se restaura y nada se escribe', () => {
    const bytes = JPEG_GRANDE(MAX_AUDITADO, 8);
    conLegacy(bytes);
    const { p } = reemplazarLegacy();
    bytes[6000000] = 1;
    const antes = filas().length;
    expect(ej(val, { accion: 'REVERTIR', documentoId: LEGACY_ID, documentoReemplazadoId: docDe(p), motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() })).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
    expect(filas()).toHaveLength(antes);
    expect(vigente()).toMatchObject({ origen: 'E9' });
  });
  test('un legacy por encima del tope defensivo (20 MB + 1): reemplazar y retirar fallan de forma explicita y fail-closed (LEGACY_FORMATO_INVALIDO), sin escribir nada', () => {
    conLegacy(JPEG_GRANDE(MB20 + 1, 2));
    expect(proponer(ana, 1)).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });          // ya al proponer: no se sube nada que despues no se pueda registrar
    expect(E.storage.guardados).toBe(0);
    conLegacy(JPEG_GRANDE(300, 2));
    const p = proponer(ana, 1);
    E.drive.estado.archivos[0].bytes = JPEG_GRANDE(MB20 + 1, 2);                                     // el legacy crecio por encima del tope despues de proponer
    const antes = filas().length;
    expect(aprobar(val, docDe(p), LEGACY_ID)).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });
    expect(ej(val, { accion: 'RETIRAR', documentoId: LEGACY_ID, motivoCodigo: 'DESACTUALIZADO', clientRequestId: crid() })).toMatchObject({ ok: false, code: 'LEGACY_FORMATO_INVALIDO' });
    expect(filas()).toHaveLength(antes);
  });
  test('una propuesta NUEVA de 3,1 MB sigue rechazada (ARCHIVO_DEMASIADO_GRANDE), aunque el pozo tenga un legacy grande: nada se sube ni se escribe', () => {
    conLegacy(JPEG_GRANDE(MAX_AUDITADO, 3));
    const r = ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: { bytes: JPEG_GRANDE(3250586, 1), mimeType: 'image/jpeg', nombreOriginal: 'grande.jpg' } });
    expect(r).toMatchObject({ ok: false, code: 'ARCHIVO_DEMASIADO_GRANDE' });
    expect(filas()).toHaveLength(0);
    expect(E.storage.guardados).toBe(0);
  });
  test('una propuesta nueva de exactamente 3 MB entra aunque el legacy sea de 11,54 MB', () => {
    conLegacy(JPEG_GRANDE(MAX_AUDITADO, 3));
    const r = ej(ana, { accion: 'PROPONER', wellId: W, clientRequestId: crid() }, { archivo: { bytes: JPEG_GRANDE(3 * 1024 * 1024, 1), mimeType: 'image/jpeg', nombreOriginal: 'justo.jpg' } });
    expect(r).toMatchObject({ ok: true });
    expect(E.storage.guardados).toBe(1);
  });
});

describe('RETIRAR_PROPUESTA: el proponente retira SOLO su propia propuesta pendiente', () => {
  const retirarPropia = (usuario, documentoId, extra) => ej(usuario, Object.assign({ accion: 'RETIRAR_PROPUESTA', documentoId: documentoId, clientRequestId: crid() }, extra || {}));
  test('el proponente (perfil + perfil_subir, SIN perfil_validar) la retira: mismo ITF_RETIRADO, motivo CANCELADO_POR_PROPONENTE, sin texto', () => {
    const a = docDe(proponer(ana, 1));
    const r = retirarPropia(ana, a);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 1, resultado: { evento: 'ITF_RETIRADO', documentoId: a, wellId: W } });
    expect(eventos()[1]).toMatchObject({ evento: 'ITF_RETIRADO', documentoId: a, motivoCodigo: 'CANCELADO_POR_PROPONENTE', motivoTexto: '', email: 'ana@x.com' });
    expect(E.mods.dominio.itfDominio_estadoPozo(W, E.mods.dominio.itfDominio_derivar(eventos()), true).propuestasPendientes).toEqual([]);
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'LEGACY' });
  });
  test('puede dar un texto opcional; el codigo lo fija el servidor (el cliente no lo elige)', () => {
    const a = docDe(proponer(ana, 1));
    expect(retirarPropia(ana, a, { motivoCodigo: 'OTRO' }).code).toBe('INVALID_REQUEST');
    expect(retirarPropia(ana, a, { motivoTexto: 'ab' }).code).toBe('INVALID_MOTIVO_TEXTO');
    expect(retirarPropia(ana, a, { motivoTexto: 'Me equivoque de pozo' }).ok).toBe(true);
    expect(eventos()[1]).toMatchObject({ motivoCodigo: 'CANCELADO_POR_PROPONENTE', motivoTexto: 'Me equivoque de pozo' });
  });
  test('OWNERSHIP por email normalizado, NUNCA por nombre: otra persona con el MISMO nombre no puede', () => {
    const a = docDe(proponer(ana, 1));
    const homonima = { email: 'otra.ana@x.com', nombre: 'Ana', permisos: ana.permisos };
    expect(retirarPropia(homonima, a).code).toBe('PERMISSION_DENIED');
    const mismoEmailOtroCaso = { email: '  ANA@X.COM ', nombre: 'Otro Nombre', permisos: ana.permisos };
    expect(retirarPropia(mismoEmailOtroCaso, a).ok).toBe(true);
  });
  test('la propuesta de OTRA persona no se puede retirar con RETIRAR_PROPUESTA (ni siquiera siendo validador); inexistente da el MISMO error (sin oraculo)', () => {
    const a = docDe(proponer(ana, 1));
    expect(retirarPropia(ambos, a).code).toBe('PERMISSION_DENIED');
    expect(retirarPropia(ambos, H.doc(77)).code).toBe('PERMISSION_DENIED');
    expect(retirarPropia(val, a).code).toBe('PERMISSION_DENIED');
    expect(retirarPropia(ana, H.doc(77)).code).toBe('PERMISSION_DENIED');
  });
  test('sin perfil_subir no puede, aunque haya sido el proponente (le sacaron el permiso)', () => {
    const a = docDe(proponer(ana, 1));
    expect(retirarPropia({ email: 'ana@x.com', nombre: 'Ana', permisos: { perfil: true } }, a).code).toBe('PERMISSION_DENIED');
    expect(retirarPropia({ email: 'ana@x.com', nombre: 'Ana', permisos: { perfil_subir: true } }, a).code).toBe('PERMISSION_DENIED');
  });
  test('el proponente NO puede retirar algo aprobado, vigente, reemplazado, rechazado ni ya retirado', () => {
    entorno({ archivos: [] });
    const vig = docDe(proponer(ambos, 1));
    aprobar(ambos, vig);
    const reemp = docDe(proponer(ambos, 2));
    aprobar(ambos, reemp, vig);
    const rech = docDe(proponer(ambos, 3));
    ej(val, { accion: 'RECHAZAR', documentoId: rech, motivoCodigo: 'ILEGIBLE', clientRequestId: crid() });
    const ret = docDe(proponer(ambos, 4));
    retirarPropia(ambos, ret);
    [vig, reemp, rech, ret].forEach((id) => expect(retirarPropia(ambos, id).code).toBe('DOCUMENTO_NO_RETIRABLE'));
    expect(vigente().documentoId).toBe(reemp);
  });
  test('un VALIDADOR retira cualquier propuesta pendiente con el catalogo institucional (no necesita perfil_subir)', () => {
    const a = docDe(proponer(ana, 1));
    expect(ej(val, { accion: 'RETIRAR', documentoId: a, motivoCodigo: 'NO_CORRESPONDE_POZO', clientRequestId: crid() }).ok).toBe(true);
    expect(eventos()[1]).toMatchObject({ motivoCodigo: 'NO_CORRESPONDE_POZO', email: 'val@x.com' });
  });
  test('el motivo CANCELADO_POR_PROPONENTE no es del catalogo institucional: un validador no puede elegirlo en RETIRAR', () => {
    const a = docDe(proponer(ana, 1));
    expect(ej(val, { accion: 'RETIRAR', documentoId: a, motivoCodigo: 'CANCELADO_POR_PROPONENTE', clientRequestId: crid() }).code).toBe('INVALID_MOTIVO');
    expect(ej(val, { accion: 'REVERTIR', documentoId: a, motivoCodigo: 'CANCELADO_POR_PROPONENTE', clientRequestId: crid() }).code).toBe('INVALID_MOTIVO');
  });
  test('reintento idempotente del retiro propio', () => {
    const a = docDe(proponer(ana, 1));
    const comando = { accion: 'RETIRAR_PROPUESTA', documentoId: a, clientRequestId: 'retiro-propio-01' };
    expect(ej(ana, comando).accion).toBe('ESCRIBIR');
    expect(ej(ana, comando)).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(eventos().filter((e) => e.evento === 'ITF_RETIRADO')).toHaveLength(1);
  });
  test('la propuesta retirada por su autor ya no se puede aprobar (queda RETIRADO)', () => {
    const a = docDe(proponer(ana, 1));
    retirarPropia(ana, a);
    expect(aprobar(val, a, LEGACY_ID).code).toBe('DOCUMENTO_NO_PROPUESTO');
  });
  test('retirar la propia propuesta no necesita el legacy ni Drive', () => {
    const a = docDe(proponer(ana, 1));
    E.drive.estado.fallar = 'Drive caido';
    expect(retirarPropia(ana, a).ok).toBe(true);
  });
  test('carrera: el validador aprueba mientras el proponente retira -> gana el primero, el segundo recibe DOCUMENTO_NO_RETIRABLE / DOCUMENTO_NO_PROPUESTO', () => {
    const a = docDe(proponer(ana, 1));
    const deps = depsDe(E);
    const rep = deps.repo;
    let interferir = true;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => { if (interferir) { interferir = false; expect(aprobar(val, a, LEGACY_ID).ok).toBe(true); } return fn(); }) });
    expect(ej(ana, { accion: 'RETIRAR_PROPUESTA', documentoId: a, clientRequestId: crid() }, {}, deps).code).toBe('DOCUMENTO_NO_RETIRABLE');
    expect(vigente().documentoId).toBe(a);
  });
  test('la derivacion tambien lo exige: un ITF_RETIRADO con motivo de cancelacion hecho por OTRA persona deja el pozo NO_DERIVABLE', () => {
    const a = docDe(proponer(ana, 1));
    cargar(H.retirado(a, { motivoCodigo: 'CANCELADO_POR_PROPONENTE', email: 'val@x.com', secuencia: 2, eventoId: H.uuid(600), clientRequestId: 'trampa-0001' }));
    expect(S.itfService_resolverVigente(W, depsDe(E))).toMatchObject({ estado: 'DESCONOCIDO', integridad: 'NO_DERIVABLE' });
  });
});

describe('privacidad de los resultados del servicio', () => {
  test('ningun resultado de ejecutar lleva email, referencia de storage, hash completo, clientRequestId ni secuencia', () => {
    const resultados = [];
    const p = proponer(ana, 1);
    resultados.push(p, proponer(ana, 1), aprobar(val, docDe(p), LEGACY_ID), aprobar(val, docDe(p), LEGACY_ID));
    resultados.push(ej(val, { accion: 'RECHAZAR', documentoId: H.doc(77), motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }));
    resultados.forEach((r) => expect(JSON.stringify(r)).not.toMatch(/@x\.com|e9-storage|legacy-14|req-|"secuencia"|"sha256"|"email"|"storageFileId"|"clientRequestId"/));
  });
  test('los codigos de error son del catalogo estable (o del dominio), nunca texto de Drive', () => {
    const permitidos = new Set(S.ITF_SERVICE_CODIGOS.concat(['PERMISSION_DENIED', 'INVALID_REQUEST', 'INVALID_ACCION', 'INVALID_CLIENT_REQUEST_ID', 'POZO_NOT_FOUND', 'DOCUMENTO_NO_PROPUESTO', 'DOCUMENTO_NO_RETIRABLE', 'DESTINO_INVALIDO',
      'LEGACY_NO_DISPONIBLE', 'LEGACY_SNAPSHOT_REQUERIDO', 'PROPUESTAS_PENDIENTES_MAX', 'INVALID_ARCHIVO', 'INVALID_MOTIVO', 'INVALID_MOTIVO_TEXTO', 'INVALID_DOCUMENTO_ID', 'MIME_NO_PERMITIDO', 'ARCHIVO_VACIO', 'MIME_NO_COINCIDE']));
    const p = proponer(ana, 1);
    E.drive.estado.fallar = 'ID-DE-DRIVE-SECRETO';
    const r = aprobar(val, docDe(p), LEGACY_ID);
    expect(permitidos.has(r.code)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SECRETO');
  });
});

function D() {
  return { derivar: E.mods.dominio.itfDominio_derivar };
}
