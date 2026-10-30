// E9-5, ESCRITURAS de moderacion (servicio): aprobar, rechazar, retirar (propuesta propia, ajena, vigente E9 y legacy) y revertir (E9 y legacy) con hoja, Drive y storage en memoria. Cada bloque
// cubre la matriz pedida (sin vigente, reemplazo de legacy y de E9, autoaprobacion, vigente que cambio, estados invalidos, reintento, conflicto y CARRERAS) y comprueba el resultado DERIVADO
// (itfService_resolverVigente) y que nunca haya dos vigentes. Nada toca Google.
const { crearEntorno, depsDe, JPEG } = require('./itfEntorno');
const H = require('./itfHelper');

const { ana, val, ambos, lee } = H.USUARIOS;
const W = '14-0001';
const OTRO = '14-0002';
const LEGACY_ID = 'LEGACY:' + W;
const BYTES_LEGACY = JPEG(300, 5);

let E;
let S;
let n;
const crid = () => { n += 1; return 'flj-req-' + String(n).padStart(8, '0'); };
const entorno = (op) => { E = crearEntorno(Object.assign({ archivos: [{ id: 'legacy-' + W, name: W + '.jpg', bytes: BYTES_LEGACY }], props: { ITF_E9_ACTIVO: 'SI' } }, op || {})); S = E.mods.servicio; H.reiniciar(); n = 0; return E; };
beforeEach(() => entorno());

const D = () => E.mods.dominio;
const filas = () => E.hoja.filas.slice(1);
const eventos = () => E.mods.repo.itfEventosRepository_leerTodos().eventos;
const archivoJpeg = (relleno, tam) => ({ bytes: JPEG(tam || 400, relleno), mimeType: 'image/jpeg', nombreOriginal: 'itf-' + relleno + '.jpg' });
const ej = (usuario, comando, opciones, deps) => S.itfService_ejecutar(usuario, comando, opciones || {}, deps || depsDe(E));
const proponer = (usuario, relleno, extra) => ej(usuario || ana, Object.assign({ accion: 'PROPONER', wellId: W, clientRequestId: crid() }, extra || {}), { archivo: archivoJpeg(relleno || 1) });
const docDe = (r) => r.resultado.documentoId;
const nueva = (relleno, wellId, usuario) => docDe(proponer(usuario || ana, relleno, wellId ? { wellId: wellId } : {}));
const aprobar = (usuario, documentoId, esperado, extra, deps) => ej(usuario || val, Object.assign({ accion: 'APROBAR', documentoId: documentoId, clientRequestId: crid() }, esperado ? { documentoReemplazadoId: esperado, motivoCodigo: 'ACTUALIZACION' } : {}, extra || {}), {}, deps);
const rechazar = (documentoId, extra, usuario, deps) => ej(usuario || val, Object.assign({ accion: 'RECHAZAR', documentoId: documentoId, motivoCodigo: 'ILEGIBLE', clientRequestId: crid() }, extra || {}), {}, deps);
const retirar = (documentoId, extra, usuario, deps) => ej(usuario || val, Object.assign({ accion: 'RETIRAR', documentoId: documentoId, motivoCodigo: 'DOCUMENTO_INCORRECTO', clientRequestId: crid() }, extra || {}), {}, deps);
const retirarPropia = (usuario, documentoId, extra) => ej(usuario, Object.assign({ accion: 'RETIRAR_PROPUESTA', documentoId: documentoId, clientRequestId: crid() }, extra || {}));
const revertir = (documentoId, esperado, extra, usuario, deps) => ej(usuario || val, Object.assign({ accion: 'REVERTIR', documentoId: documentoId, documentoReemplazadoId: esperado || undefined, motivoCodigo: 'ERROR_DE_APROBACION', clientRequestId: crid() }, extra || {}), {}, deps);
const vigente = (w) => S.itfService_resolverVigente(w || W, depsDe(E));
const estadoDe = (id, w) => D().itfDominio_derivar(eventos()).porPozo[w || W].documentos[id].estado;
const pozo = (w) => D().itfDominio_derivar(eventos()).porPozo[w || W];
// nunca dos vigentes, nunca un pozo roto
function sanoPozo(w) {
  const p = pozo(w || W);
  expect(p.integridad).toBe('OK');
  expect(p.orden.filter((id) => p.documentos[id].estado === 'VIGENTE').length).toBeLessThanOrEqual(1);
}
// ejecuta `interferencia` UNA vez, adentro del lock de la operacion principal y antes de que esta lea el estado (carrera simulada)
function conCarrera(interferencia) {
  const deps = depsDe(E);
  const rep = deps.repo;
  let hecho = false;
  deps.repo = Object.assign({}, rep, { conLock: (fn) => rep.conLock(() => {
    if (!hecho) { hecho = true; interferencia(); }
    return fn();
  }) });
  return deps;
}

describe('APROBAR', () => {
  test('pozo SIN vigente: primera aprobacion, UNA fila, sin motivo; el vigente derivado es el documento aprobado', () => {
    entorno({ archivos: [] });
    const b = nueva(1);
    const r = aprobar(val, b);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', eventosEscritos: 1, autoaprobado: false, resultado: { evento: 'ITF_APROBADO', documentoId: b, wellId: W } });
    const e = eventos()[1];
    expect(e).toMatchObject({ evento: 'ITF_APROBADO', documentoId: b, documentoReemplazadoId: '', motivoCodigo: '', motivoTexto: '' });
    expect(vigente()).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: b });
    sanoPozo();
  });
  test('REEMPLAZA AL LEGACY: registro de la huella + aprobacion (2 filas consecutivas, mismo lock); el legacy sigue intacto en Drive', () => {
    const b = nueva(1);
    const r = aprobar(val, b, LEGACY_ID);
    expect(r).toMatchObject({ ok: true, eventosEscritos: 2 });
    const evs = eventos();
    expect(evs.map((x) => x.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO']);
    expect(evs.map((x) => x.secuencia)).toEqual([1, 2, 3]);
    expect(evs[2]).toMatchObject({ documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION' });
    expect(vigente()).toMatchObject({ origen: 'E9', documentoId: b });
    expect(estadoDe(LEGACY_ID)).toBe('REEMPLAZADO');
    expect(E.drive.estado.archivos).toHaveLength(1);
    expect(Array.from(E.drive.estado.archivos[0].bytes)).toEqual(BYTES_LEGACY);
    sanoPozo();
  });
  test('REEMPLAZA A UN E9: una sola fila; el anterior queda REEMPLAZADO y el nuevo VIGENTE', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    expect(aprobar(val, b, a, { motivoCodigo: 'MEJOR_CALIDAD' })).toMatchObject({ ok: true, eventosEscritos: 1 });
    expect(estadoDe(a)).toBe('REEMPLAZADO');
    expect(estadoDe(b)).toBe('VIGENTE');
    expect(vigente().documentoId).toBe(b);
    expect(pozo().documentos[b].reemplazaA).toBe(a);
    sanoPozo();
  });
  test('el vigente que el cliente vio es OBLIGATORIO cuando hay vigente: ausente, equivocado o de otro pozo -> VIGENTE_CAMBIO y no se escribe nada', () => {
    const b = nueva(1);
    const antes = filas().length;
    expect(aprobar(val, b, null)).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });                 // ni siquiera lo declara
    expect(aprobar(val, b, H.doc(999))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });           // declara otro
    expect(aprobar(val, b, 'LEGACY:14-0002')).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });     // el legacy de OTRO pozo
    expect(filas()).toHaveLength(antes);
    expect(vigente()).toMatchObject({ origen: 'LEGACY' });
  });
  test('declara un vigente pero ya NO hay (lo retiraron): VIGENTE_CAMBIO; el cliente no puede aprobar "a ciegas"', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    retirar(a);
    expect(aprobar(val, b, a)).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(aprobar(val, b, null)).toMatchObject({ ok: true });
  });
  test('motivo de reemplazo: catalogo v1, OTRO exige texto, el texto es opcional en los demas y se normaliza', () => {
    const ids = [1, 2, 3, 4, 5].map((i) => nueva(i));
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: undefined })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'ILEGIBLE' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });         // es del catalogo de RECHAZO
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'actualizacion' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });      // exacto, sin minusculas
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'OTRO' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'OTRO', motivoTexto: '   ' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'CORRECCION', motivoTexto: 'ab' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'CORRECCION', motivoTexto: 5 })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(filas()).toHaveLength(5);                                                                   // nada se escribio con motivos malos
    const r = aprobar(val, ids[0], LEGACY_ID, { motivoCodigo: 'OTRO', motivoTexto: '  Escaneo\r\nmas   claro\u0007  ' });
    expect(r.ok).toBe(true);
    expect(eventos().find((e) => e.evento === 'ITF_APROBADO').motivoTexto).toBe('Escaneo\nmas   claro');
    ['MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO'].forEach((codigo, i) => {
      const vig = vigente().documentoId;
      expect(aprobar(val, ids[i + 1], vig, { motivoCodigo: codigo }).ok).toBe(true);
    });
    expect(aprobar(val, ids[3], vigente().documentoId, { motivoCodigo: 'CORRECCION', motivoTexto: 'Se corrigio el pozo' }).ok).toBe(true);
    sanoPozo();
  });
  test('la primera aprobacion de un pozo sin vigente NO lleva motivo (no reemplaza nada)', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    expect(aprobar(val, a, null, { motivoCodigo: 'ACTUALIZACION' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(aprobar(val, a, null, { motivoTexto: 'algo' })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    expect(aprobar(val, a).ok).toBe(true);
  });
  test('AUTOAPROBACION: quien propuso y tiene perfil_validar la aprueba como OTRA accion (dos eventos, dos clientRequestId); queda marcada, sin estado especial ni accion combinada', () => {
    entorno({ archivos: [] });
    const a = nueva(1, null, ambos);
    const r = aprobar(ambos, a);
    expect(r).toMatchObject({ ok: true, autoaprobado: true });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_APROBADO']);
    expect(eventos()[0].clientRequestId).not.toBe(eventos()[1].clientRequestId);
    expect(pozo().documentos[a]).toMatchObject({ estado: 'VIGENTE', autoaprobado: true });
    expect(ej(ambos, { accion: 'PROPONER_Y_APROBAR', wellId: W, clientRequestId: crid() }).code).toBe('INVALID_ACCION');
    expect(ej(ambos, { accion: 'PROPONER', wellId: W, documentoId: a, clientRequestId: crid() }, { archivo: archivoJpeg(2) }).code).toBe('INVALID_REQUEST');
  });
  test('otro validador aprueba la propuesta de alguien: autoaprobado=false; quien solo propone NO puede aprobar ni su propia propuesta', () => {
    entorno({ archivos: [] });
    const a = nueva(1, null, ana);
    expect(aprobar(ana, a)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(aprobar(lee, a)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(aprobar(val, a)).toMatchObject({ ok: true, autoaprobado: false });
  });
  test('la autoaprobacion se decide por EMAIL normalizado, no por nombre: un homonimo no es autoaprobacion', () => {
    entorno({ archivos: [] });
    const a = nueva(1, null, ambos);
    const homonimo = { email: 'otra.carla@x.com', nombre: 'Carla', permisos: ambos.permisos };
    expect(aprobar(homonimo, a)).toMatchObject({ ok: true, autoaprobado: false });
  });
  test('una propuesta ya RECHAZADA, RETIRADA o ya VIGENTE no se aprueba: DOCUMENTO_NO_PROPUESTO', () => {
    entorno({ archivos: [] });
    const r1 = nueva(1);
    const r2 = nueva(2);
    const r3 = nueva(3);
    rechazar(r1);
    retirar(r2);
    aprobar(val, r3);
    [r1, r2, r3].forEach((id) => expect(aprobar(val, id, null)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_PROPUESTO' }));
    sanoPozo();
  });
  test('documento inexistente: ITF_NOT_FOUND; historial roto en el pozo: ITF_STATE_UNKNOWN; el cliente no puede mandar el pozo', () => {
    expect(aprobar(val, H.doc(555))).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    const a = nueva(1);
    expect(ej(val, { accion: 'APROBAR', documentoId: a, wellId: W, clientRequestId: crid() })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    E.hoja.filas.push(E.mods.repo.ITF_EVENTOS_COLUMNAS.map((c) => ({ eventoId: H.uuid(5555), secuencia: 99, evento: 'ITF_BORRADO', wellId: W, documentoId: a, email: 'x@x.com', timestampUtc: H.ISO, clientRequestId: 'corrupto-0001' }[c] || '')));
    expect(aprobar(val, a, LEGACY_ID)).toMatchObject({ ok: false, code: 'ITF_STATE_UNKNOWN' });
  });
  test('el pozo sale del DOCUMENTO: un documento del pozo B no se aprueba "contra" el vigente del pozo A', () => {
    const b = nueva(1, OTRO);                                                                          // propuesta del pozo 14-0002 (sin legacy)
    expect(aprobar(val, b, LEGACY_ID)).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(aprobar(val, b).ok).toBe(true);
    expect(vigente(OTRO)).toMatchObject({ estado: 'SI', documentoId: b });
    expect(vigente(W)).toMatchObject({ origen: 'LEGACY' });
  });
  test('REINTENTO exacto: mismo resultado, ninguna fila nueva; con otro contenido: IDEMPOTENCY_CONFLICT; el email se normaliza', () => {
    const b = nueva(1);
    const cr = crid();
    const r1 = aprobar(val, b, LEGACY_ID, { clientRequestId: cr });
    const filasAntes = filas().length;
    const r2 = aprobar(val, b, LEGACY_ID, { clientRequestId: cr });
    expect(r2).toMatchObject({ ok: true, accion: 'REINTENTO', resultado: r1.resultado, autoaprobado: false });
    const r3 = aprobar({ email: ' VAL@X.COM ', nombre: 'Valeria', permisos: val.permisos }, b, LEGACY_ID, { clientRequestId: cr });
    expect(r3.accion).toBe('REINTENTO');
    expect(aprobar(val, b, LEGACY_ID, { clientRequestId: cr, motivoCodigo: 'CORRECCION' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(rechazar(b, { clientRequestId: cr })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(filas()).toHaveLength(filasAntes);
    // otro usuario puede reutilizar el mismo id (namespace por email)
    expect(aprobar(ambos, nueva(2), LEGACY_ID, { clientRequestId: cr })).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
  });
  test('el ARCHIVO de la propuesta tiene que seguir en el storage y ser el registrado: falta -> ITF_ARCHIVO_NO_DISPONIBLE; otro tamano / tipo -> ITF_ARCHIVO_NO_COINCIDE; storage caido -> SERVICE_UNAVAILABLE; nada se escribe', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    const ref = Object.keys(E.storage.docs)[0];
    const antes = filas().length;
    const copia = E.storage.docs[ref];
    delete E.storage.docs[ref];
    expect(aprobar(val, a)).toMatchObject({ ok: false, code: 'ITF_ARCHIVO_NO_DISPONIBLE' });
    E.storage.docs[ref] = { bytes: JPEG(401, 1), mimeType: 'image/jpeg' };
    expect(aprobar(val, a)).toMatchObject({ ok: false, code: 'ITF_ARCHIVO_NO_COINCIDE' });
    E.storage.docs[ref] = { bytes: copia.bytes, mimeType: 'image/png' };
    expect(aprobar(val, a)).toMatchObject({ ok: false, code: 'ITF_ARCHIVO_NO_COINCIDE' });
    E.storage.docs[ref] = copia;
    const deps = depsDe(E);
    deps.storage = Object.assign({}, deps.storage, { obtenerMetadata: () => ({ ok: false, code: 'SERVICE_UNAVAILABLE' }) });
    expect(aprobar(val, a, null, {}, deps)).toMatchObject({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    deps.storage = Object.assign({}, deps.storage, { obtenerMetadata: () => ({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' }) });
    expect(aprobar(val, a, null, {}, deps)).toMatchObject({ ok: false, code: 'ITF_STORAGE_NO_CONFIGURADO' });
    expect(filas()).toHaveLength(antes);
    expect(aprobar(val, a).ok).toBe(true);                                                             // con el archivo bien, aprueba
  });
  test('la comprobacion del archivo ocurre ADENTRO del lock y NO se pide para rechazar ni retirar una propuesta', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    const b = nueva(2);
    const c = nueva(3);
    const deps = depsDe(E);
    const rep = deps.repo;
    let dentro = false;
    deps.repo = Object.assign({}, rep, { conLock: (fn) => { dentro = true; try { return rep.conLock(fn); } finally { dentro = false; } } });
    const observado = [];
    const meta = deps.storage.obtenerMetadata;
    deps.storage = Object.assign({}, deps.storage, { obtenerMetadata: (ref) => { observado.push(dentro); return meta(ref); } });
    expect(aprobar(val, a, null, {}, deps).ok).toBe(true);
    expect(observado).toEqual([true]);
    expect(rechazar(b, {}, val, deps).ok).toBe(true);
    expect(retirar(c, {}, val, deps).ok).toBe(true);
    expect(observado).toEqual([true]);
  });
  test('tras aprobar B, resolverVigente devuelve B y los bytes de B salen del storage; el legacy ya no es el ITF aunque el archivo siga ahi', () => {
    const b = nueva(2);
    aprobar(val, b, LEGACY_ID);
    const v = vigente();
    expect(v).toMatchObject({ estado: 'SI', origen: 'E9', documentoId: b });
    const g = S.itfService_getProfile(W, depsDe(E));
    expect(g.found).toBe(true);
    expect(Array.from(g.blob.getBytes())).toEqual(JPEG(400, 2));
  });
});

describe('RECHAZAR', () => {
  test('catalogo de rechazo: cada motivo vale; OTRO exige texto; el texto es opcional en los demas; motivo de otro catalogo o ausente se rechaza', () => {
    const ids = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => nueva(i, '14-00' + String(10 + i)));
    ['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA'].forEach((m, i) => expect(rechazar(ids[i], { motivoCodigo: m }).ok).toBe(true));
    expect(rechazar(ids[5], { motivoCodigo: 'OTRO' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(rechazar(ids[5], { motivoCodigo: 'OTRO', motivoTexto: '' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(rechazar(ids[5], { motivoCodigo: undefined })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(rechazar(ids[5], { motivoCodigo: 'ACTUALIZACION' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(rechazar(ids[5], { motivoCodigo: 'CANCELADO_POR_PROPONENTE' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(rechazar(ids[5], { motivoCodigo: 'OTRO', motivoTexto: 'No es el pozo' }).ok).toBe(true);
    expect(rechazar(ids[6], { motivoCodigo: 'ILEGIBLE', motivoTexto: 'Muy borroso' }).ok).toBe(true);
    expect(eventos().filter((e) => e.evento === 'ITF_RECHAZADO')).toHaveLength(7);
  });
  test('el rechazado queda CONSERVADO (el archivo NO se borra ni se mueve), nunca es vigente y el vigente no cambia', () => {
    const a = nueva(1);
    const guardados = Object.keys(E.storage.docs).length;
    const r = rechazar(a);
    expect(r).toMatchObject({ ok: true, resultado: { evento: 'ITF_RECHAZADO', documentoId: a } });
    expect(estadoDe(a)).toBe('RECHAZADO');
    expect(E.storage.eliminados).toEqual([]);
    expect(Object.keys(E.storage.docs)).toHaveLength(guardados);
    expect(vigente()).toMatchObject({ origen: 'LEGACY' });
  });
  test('solo PROPUESTO: aprobada, retirada o ya rechazada -> DOCUMENTO_NO_PROPUESTO; sin permiso -> PERMISSION_DENIED', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    const b = nueva(2);
    const c = nueva(3);
    aprobar(val, a);
    retirar(b);
    rechazar(c);
    [a, b, c].forEach((id) => expect(rechazar(id)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_PROPUESTO' }));
    expect(rechazar(nueva(4), {}, ana)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
  test('no depende del legacy ni de Drive ni del storage', () => {
    const a = nueva(1);
    E.drive.estado.fallar = 'Drive caido';
    const deps = depsDe(E);
    deps.storage = { guardarPropuesta: () => { throw new Error('no'); }, leerDocumento: () => { throw new Error('no'); }, obtenerMetadata: () => { throw new Error('no'); }, eliminarTemporal: () => { throw new Error('no'); } };
    expect(rechazar(a, {}, val, deps).ok).toBe(true);
  });
  test('REINTENTO exacto y conflicto', () => {
    const a = nueva(1);
    const cr = crid();
    expect(rechazar(a, { clientRequestId: cr }).accion).toBe('ESCRIBIR');
    const filasAntes = filas().length;
    expect(rechazar(a, { clientRequestId: cr })).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(rechazar(a, { clientRequestId: cr, motivoCodigo: 'INCOMPLETO' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(filas()).toHaveLength(filasAntes);
  });
  test('CARRERA B: uno aprueba y otro rechaza la misma propuesta -> gana el primero, el segundo falla por estado cambiado', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    expect(rechazar(a, {}, val, conCarrera(() => expect(aprobar(ambos, a).ok).toBe(true)))).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_PROPUESTO' });
    expect(estadoDe(a)).toBe('VIGENTE');
    const b = nueva(2);
    expect(aprobar(val, b, a, {}, conCarrera(() => expect(rechazar(b).ok).toBe(true)))).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_PROPUESTO' });
    expect(estadoDe(b)).toBe('RECHAZADO');
    expect(vigente().documentoId).toBe(a);
    sanoPozo();
  });
});

describe('RETIRAR', () => {
  test('propuesta PROPIA (perfil_subir): CANCELADO_POR_PROPONENTE sin texto obligatorio; sale de la cola; no toca el vigente', () => {
    const a = nueva(1, null, ana);
    const r = retirarPropia(ana, a);
    expect(r).toMatchObject({ ok: true, resultado: { evento: 'ITF_RETIRADO', documentoId: a } });
    expect(eventos()[1]).toMatchObject({ motivoCodigo: 'CANCELADO_POR_PROPONENTE', motivoTexto: '' });
    expect(estadoDe(a)).toBe('RETIRADO');
    expect(S.itfService_pendientes(val, {}, depsDe(E)).items).toEqual([]);
    expect(vigente()).toMatchObject({ origen: 'LEGACY' });
  });
  test('propuesta AJENA: el proponente no puede retirar la de otro (ni siendo validador via RETIRAR_PROPUESTA); inexistente da el MISMO error', () => {
    const a = nueva(1, null, ana);
    const otra = { email: 'otra@x.com', nombre: 'Otra', permisos: { perfil: true, perfil_subir: true } };
    expect(retirarPropia(otra, a)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(retirarPropia(ambos, a)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(retirarPropia(otra, H.doc(555))).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(estadoDe(a)).toBe('PROPUESTO');
  });
  test('un VALIDADOR retira cualquier propuesta pendiente con el catalogo institucional (no el motivo del proponente)', () => {
    const a = nueva(1, null, ana);
    expect(retirar(a, { motivoCodigo: 'CANCELADO_POR_PROPONENTE' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(retirar(a, { motivoCodigo: 'ILEGIBLE' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(retirar(a, { motivoCodigo: 'OTRO' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(retirar(a, { motivoCodigo: 'NO_CORRESPONDE_POZO' }).ok).toBe(true);
    expect(estadoDe(a)).toBe('RETIRADO');
  });
  test('retirar el VIGENTE E9: el pozo queda SIN_ITF y NO se restaura el anterior (restaurar es otra accion explicita)', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    aprobar(val, b, a);
    expect(retirar(b, { motivoCodigo: 'ERROR_DE_APROBACION' }).ok).toBe(true);
    expect(vigente()).toMatchObject({ estado: 'NO' });
    expect(estadoDe(a)).toBe('REEMPLAZADO');                                                           // el anterior sigue siendo historico
    expect(estadoDe(b)).toBe('RETIRADO');
    expect(S.itfService_disponibilidad([W], depsDe(E))).toEqual({ [W]: false });
    sanoPozo();
  });
  test('retirar el LEGACY (vigente implicito): registro de la huella + retiro (2 filas); el archivo fisico no se mueve ni se borra; el overlay deja de considerarlo vigente', () => {
    const r = retirar(LEGACY_ID, { motivoCodigo: 'DESACTUALIZADO' });
    expect(r).toMatchObject({ ok: true, eventosEscritos: 2 });
    expect(eventos().map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_RETIRADO']);
    expect(vigente()).toMatchObject({ estado: 'NO' });
    expect(E.drive.estado.archivos).toHaveLength(1);
    expect(E.drive.estado.archivos[0].name).toBe(W + '.jpg');
    expect(S.itfService_disponibilidad([W], depsDe(E))).toEqual({ [W]: false });
    expect(S.itfService_getProfile(W, depsDe(E))).toMatchObject({ found: false, code: 'ITF_NOT_FOUND' });
    sanoPozo();
  });
  test('doble retiro: el segundo es DOCUMENTO_NO_RETIRABLE (un retirado, reemplazado o rechazado no se retira)', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    const c = nueva(3);
    rechazar(c);
    aprobar(val, b, a);
    expect(retirar(b).ok).toBe(true);
    expect(retirar(b)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_RETIRABLE' });
    expect(retirar(a)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_RETIRABLE' });                  // reemplazado
    expect(retirar(c)).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_RETIRABLE' });                  // rechazado
    expect(retirar(LEGACY_ID)).toMatchObject({ ok: false });                                          // sin legacy en este entorno
  });
  test('sin permiso de validar: PERMISSION_DENIED (perfil + perfil_subir no retiran un vigente)', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    expect(retirar(a, {}, ana)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(retirar(a, {}, lee)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(vigente().documentoId).toBe(a);
  });
  test('REINTENTO exacto y conflicto (retiro de vigente y retiro propio)', () => {
    const a = nueva(1, null, ana);
    const cr = crid();
    expect(retirarPropia(ana, a, { clientRequestId: cr }).accion).toBe('ESCRIBIR');
    const antes = filas().length;
    expect(retirarPropia(ana, a, { clientRequestId: cr }).accion).toBe('REINTENTO');
    expect(retirarPropia(ana, a, { clientRequestId: cr, motivoTexto: 'otro texto' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const v = nueva(2);
    aprobar(val, v, LEGACY_ID);
    const cr2 = crid();
    expect(retirar(v, { clientRequestId: cr2 }).accion).toBe('ESCRIBIR');
    const despues = filas().length;
    expect(retirar(v, { clientRequestId: cr2 }).accion).toBe('REINTENTO');
    expect(retirar(v, { clientRequestId: cr2, motivoCodigo: 'OTRO', motivoTexto: 'xx otro' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(filas()).toHaveLength(despues);
    expect(despues).toBeGreaterThan(antes);
  });
  test('CARRERA C: retiro mientras otro reemplaza (y al reves) -> gana el primero; el pozo nunca queda con dos vigentes', () => {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    // 1) otro reemplaza a A mientras yo intento retirar A -> A ya es REEMPLAZADO
    expect(retirar(a, {}, val, conCarrera(() => expect(aprobar(ambos, b, a).ok).toBe(true)))).toMatchObject({ ok: false, code: 'DOCUMENTO_NO_RETIRABLE' });
    expect(vigente().documentoId).toBe(b);
    // 2) otro retira B mientras yo reemplazo B por C -> VIGENTE_CAMBIO
    const c = nueva(3);
    expect(aprobar(val, c, b, {}, conCarrera(() => expect(retirar(b).ok).toBe(true)))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(vigente()).toMatchObject({ estado: 'NO' });
    sanoPozo();
  });
});

describe('REVERTIR / restaurar un historico', () => {
  function conHistoria() {
    entorno({ archivos: [] });
    const a = nueva(1);
    aprobar(val, a);
    const b = nueva(2);
    aprobar(val, b, a);
    return { a, b };
  }
  test('restaurar un E9 REEMPLAZADO: declara destino A y el vigente que reemplaza (B); A queda VIGENTE y B REEMPLAZADO (derivado)', () => {
    const { a, b } = conHistoria();
    const r = revertir(a, b);
    expect(r).toMatchObject({ ok: true, eventosEscritos: 1, resultado: { evento: 'ITF_REVERTIDO', documentoId: a } });
    expect(eventos().pop()).toMatchObject({ evento: 'ITF_REVERTIDO', documentoId: a, documentoReemplazadoId: b, motivoCodigo: 'ERROR_DE_APROBACION' });
    expect(estadoDe(a)).toBe('VIGENTE');
    expect(estadoDe(b)).toBe('REEMPLAZADO');
    expect(vigente()).toMatchObject({ documentoId: a, origen: 'E9' });
    expect(S.itfService_getProfile(W, depsDe(E)).found).toBe(true);
    sanoPozo();
  });
  test('restaurar un RETIRADO que fue vigente cuando el pozo quedo SIN_ITF: no declara reemplazo', () => {
    const { a, b } = conHistoria();
    retirar(b);
    expect(revertir(b, null)).toMatchObject({ ok: true });                                              // vuelve B
    expect(vigente().documentoId).toBe(b);
    retirar(b);
    expect(revertir(a, null).ok).toBe(true);                                                           // o un reemplazado anterior
    expect(vigente().documentoId).toBe(a);
    sanoPozo();
  });
  test('DESTINO INVALIDO: una propuesta, un rechazado, una propuesta retirada, el vigente actual y un documento que nunca fue vigente no se restauran', () => {
    const { a, b } = conHistoria();
    const p = nueva(3);
    const r = nueva(4);
    const q = nueva(5);
    rechazar(r);
    retirar(q);
    [p, r, q, b].forEach((id) => expect(revertir(id, id === b ? null : b)).toMatchObject({ ok: false, code: 'DESTINO_INVALIDO' }));
    expect(revertir(H.doc(555), b)).toMatchObject({ ok: false, code: 'ITF_NOT_FOUND' });
    expect(vigente().documentoId).toBe(b);
    expect(estadoDe(a)).toBe('REEMPLAZADO');
  });
  test('el VIGENTE QUE VIO el cliente es obligatorio: sin declararlo o declarando otro -> VIGENTE_CAMBIO y nada se escribe', () => {
    const { a, b } = conHistoria();
    const antes = filas().length;
    expect(revertir(a, null)).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(revertir(a, a)).toMatchObject({ ok: false });
    expect(revertir(a, H.doc(999))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(filas()).toHaveLength(antes);
    expect(vigente().documentoId).toBe(b);
  });
  test('motivo obligatorio del catalogo de retiro; sin permiso -> PERMISSION_DENIED', () => {
    const { a, b } = conHistoria();
    expect(revertir(a, b, { motivoCodigo: undefined })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(revertir(a, b, { motivoCodigo: 'ACTUALIZACION' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(revertir(a, b, { motivoCodigo: 'OTRO' })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(revertir(a, b, {}, ana)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(revertir(a, b, {}, lee)).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
  });
  test('restaurar el LEGACY: se vuelve a leer por el id REGISTRADO, se recalcula la huella y debe coincidir; entonces el legacy vuelve a ser el vigente', () => {
    const b = nueva(1);
    aprobar(val, b, LEGACY_ID);
    E.drive.calls.getBlob = 0;
    const r = revertir(LEGACY_ID, b);
    expect(r).toMatchObject({ ok: true, resultado: { evento: 'ITF_REVERTIDO', documentoId: LEGACY_ID } });
    expect(E.drive.calls.getBlob).toBeGreaterThanOrEqual(1);
    expect(vigente()).toMatchObject({ origen: 'LEGACY', documentoId: LEGACY_ID });
    expect(estadoDe(b)).toBe('REEMPLAZADO');
    sanoPozo();
  });
  test('legacy CAMBIADO (mismo archivo otro contenido, o OTRO archivo con el mismo nombre): LEGACY_CAMBIO; legacy AUSENTE: LEGACY_NO_DISPONIBLE; nunca se restaura "lo que tenga ese nombre"', () => {
    const b = nueva(1);
    aprobar(val, b, LEGACY_ID);
    const antes = filas().length;
    E.drive.estado.archivos[0].bytes = JPEG(300, 6);
    expect(revertir(LEGACY_ID, b)).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
    E.drive.estado.archivos[0].bytes = BYTES_LEGACY;
    E.drive.estado.archivos[0].name = W + '.viejo.jpg';
    E.drive.agregar({ id: 'otro-archivo', name: W + '.jpg', bytes: BYTES_LEGACY });
    expect(revertir(LEGACY_ID, b)).toMatchObject({ ok: false, code: 'LEGACY_CAMBIO' });
    E.drive.quitar('otro-archivo');
    E.drive.quitar('legacy-' + W);
    expect(revertir(LEGACY_ID, b)).toMatchObject({ ok: false, code: 'LEGACY_NO_DISPONIBLE' });
    expect(filas()).toHaveLength(antes);
    expect(vigente().documentoId).toBe(b);
  });
  test('restaurar un E9 historico cuyo archivo desaparecio del storage: ITF_ARCHIVO_NO_DISPONIBLE y nada se escribe', () => {
    const { a, b } = conHistoria();
    const ref = Object.keys(E.storage.docs)[0];
    const antes = filas().length;
    delete E.storage.docs[ref];
    expect(revertir(a, b)).toMatchObject({ ok: false, code: 'ITF_ARCHIVO_NO_DISPONIBLE' });
    expect(filas()).toHaveLength(antes);
  });
  test('REINTENTO exacto y conflicto', () => {
    const { a, b } = conHistoria();
    const cr = crid();
    expect(revertir(a, b, { clientRequestId: cr }).accion).toBe('ESCRIBIR');
    const antes = filas().length;
    expect(revertir(a, b, { clientRequestId: cr })).toMatchObject({ ok: true, accion: 'REINTENTO', resultado: { documentoId: a } });
    expect(revertir(a, b, { clientRequestId: cr, motivoCodigo: 'DESACTUALIZADO' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(filas()).toHaveLength(antes);
  });
  test('CARRERA D: la reversion contra otro que aprueba (y al reves) -> gana el primero; nunca dos vigentes', () => {
    const { a, b } = conHistoria();
    const c = nueva(3);
    expect(revertir(a, b, {}, val, conCarrera(() => expect(aprobar(ambos, c, b).ok).toBe(true)))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(vigente().documentoId).toBe(c);
    const d = nueva(4);
    expect(aprobar(val, d, c, {}, conCarrera(() => expect(revertir(b, c, {}, ambos).ok).toBe(true)))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(vigente().documentoId).toBe(b);
    sanoPozo();
  });
  test('CARRERA A: dos validadores aprueban propuestas DISTINTAS del mismo pozo -> solo una gana, la otra recibe VIGENTE_CAMBIO', () => {
    const p = nueva(1);
    const q = nueva(2);
    expect(aprobar(val, p, LEGACY_ID, {}, conCarrera(() => expect(aprobar(ambos, q, LEGACY_ID).ok).toBe(true)))).toMatchObject({ ok: false, code: 'VIGENTE_CAMBIO' });
    expect(vigente().documentoId).toBe(q);
    expect(estadoDe(p)).toBe('PROPUESTO');                                                             // p sigue pendiente, aprobable de nuevo viendo el nuevo vigente
    expect(aprobar(val, p, q).ok).toBe(true);
    expect(vigente().documentoId).toBe(p);
    expect(eventos().filter((e) => e.evento === 'ITF_LEGACY_REGISTRADO')).toHaveLength(1);              // el legacy se registro UNA sola vez
    sanoPozo();
  });
});

describe('invariantes entre acciones', () => {
  test('una cadena larga (aprobar, reemplazar, rechazar, retirar, restaurar, retirar el legacy) deja SIEMPRE un pozo derivable y a lo sumo un vigente, con secuencias consecutivas', () => {
    const a = nueva(1);
    const b = nueva(2);
    const c = nueva(3);
    const d = nueva(4);
    aprobar(val, a, LEGACY_ID);
    sanoPozo();
    aprobar(val, b, a);
    sanoPozo();
    rechazar(c);
    sanoPozo();
    revertir(LEGACY_ID, b);
    sanoPozo();
    retirar(LEGACY_ID);
    sanoPozo();
    aprobar(val, d);
    sanoPozo();
    revertir(a, d);
    sanoPozo();
    expect(eventos().map((e) => e.secuencia)).toEqual(eventos().map((e, i) => i + 1));
    expect(vigente().documentoId).toBe(a);
    expect(S.itfService_pendientes(val, {}, depsDe(E)).items).toEqual([]);
  });
  test('cada escritura exitosa invalida la cache del pozo UNA vez; un reintento, un plan fallido o una lectura, nunca', () => {
    const deps = depsDe(E);
    const a = nueva(1);
    expect(aprobar(val, a, LEGACY_ID, {}, deps).ok).toBe(true);
    expect(deps.invalidarCaches).toHaveBeenCalledTimes(1);
    expect(deps.invalidarCaches).toHaveBeenCalledWith([W]);
    expect(aprobar(val, a, LEGACY_ID, {}, deps).ok).toBe(false);                                       // DOCUMENTO_NO_PROPUESTO
    expect(deps.invalidarCaches).toHaveBeenCalledTimes(1);
  });
});
