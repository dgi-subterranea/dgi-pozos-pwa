// ItfDominioService.itfDominio_planificar (E9-2): validar -> permiso -> idempotencia -> estado -> eventos. Propuesta, aprobacion, autoaprobacion (dos acciones), rechazo, reemplazo, retiro,
// reversion, registro previo del legacy, duplicado documental vs idempotencia, concurrencia (revalidacion del vigente), privacidad. Dominio puro, sin hojas.
Object.assign(global, require('../src/ItfArchivoLogic'));
const D = require('../src/ItfDominioService');
const H = require('./itfHelper');

const { WELL, uuid, sha, doc, USUARIOS, archivo, crid } = H;
const OTRO_POZO = '14-0002';
const LEGACY_ID = 'LEGACY:' + WELL;
const { ana, val, ambos, lee } = USUARIOS;

let sim;
beforeEach(() => {
  H.reiniciar();
  sim = H.crearSim(D);
});

const proponer = (n, usuario, extra) => sim.ejecutar(usuario || ana, { accion: 'PROPONER', wellId: WELL, clientRequestId: crid() }, Object.assign({ archivo: archivo(n) }, extra || {}));
const aprobar = (documentoId, reemplaza, usuario, motivo) => sim.ejecutar(usuario || val, Object.assign(
  { accion: 'APROBAR', documentoId: documentoId, documentoReemplazadoId: reemplaza || '', clientRequestId: crid() }, reemplaza ? (motivo || { motivoCodigo: 'ACTUALIZACION' }) : {}));
const rechazar = (documentoId, usuario, motivo) => sim.ejecutar(usuario || val, Object.assign({ accion: 'RECHAZAR', documentoId: documentoId, clientRequestId: crid() }, motivo || { motivoCodigo: 'ILEGIBLE' }));
const retirar = (documentoId, usuario, motivo) => sim.ejecutar(usuario || val, Object.assign({ accion: 'RETIRAR', documentoId: documentoId, clientRequestId: crid() }, motivo || { motivoCodigo: 'DOCUMENTO_INCORRECTO' }));
const revertir = (documentoId, reemplaza, usuario, motivo) => sim.ejecutar(usuario || val, Object.assign(
  { accion: 'REVERTIR', documentoId: documentoId, documentoReemplazadoId: reemplaza || '', clientRequestId: crid() }, motivo || { motivoCodigo: 'ERROR_DE_APROBACION' }));
const docDe = (plan) => plan.resultado.documentoId;
const codigo = (plan) => plan.code;

describe('validacion del comando', () => {
  const ok = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'abcdefgh' };
  const planificar = (c, extra) => D.itfDominio_planificar(c, sim.contexto(ana, Object.assign({ archivo: archivo(1) }, extra || {})));
  test('accion invalida o ausente', () => {
    ['', 'BORRAR', 'PROPONER_Y_APROBAR', 'proponer', null, undefined, 5].forEach((a) => expect(codigo(planificar(Object.assign({}, ok, { accion: a })))).toBe('INVALID_ACCION'));
    expect(codigo(planificar(null))).toBe('INVALID_ACCION');
    expect(codigo(planificar('texto'))).toBe('INVALID_ACCION');
  });
  test('clientRequestId obligatorio de 8 a 64 caracteres', () => {
    ['', 'corto', 'a'.repeat(65), 'con espacio ok', 'ñandú-1234', null, undefined, 12345678].forEach((id) => {
      expect(codigo(planificar(Object.assign({}, ok, { clientRequestId: id })))).toBe('INVALID_CLIENT_REQUEST_ID');
    });
    expect(planificar(Object.assign({}, ok, { clientRequestId: 'a'.repeat(64) })).ok).toBe(true);
    expect(planificar(Object.assign({}, ok, { clientRequestId: 'abc_DEF-123' })).ok).toBe(true);
  });
  test('PROPONER: wellId valido y sin campos de otras acciones', () => {
    ['', '14-001', '1-0001', '14_0001', 'AA-0001', null, undefined, 1401].forEach((w) => expect(codigo(planificar(Object.assign({}, ok, { wellId: w })))).toBe('INVALID_WELL_ID'));
    [{ documentoId: doc(1) }, { documentoReemplazadoId: doc(1) }, { motivoCodigo: 'OTRO' }, { motivoTexto: 'hola' }].forEach((extra) => {
      expect(codigo(planificar(Object.assign({}, ok, extra)))).toBe('INVALID_REQUEST');
    });
  });
  test('las demas acciones: documentoId valido, el pozo sale del documento (no se manda)', () => {
    const base = { accion: 'RECHAZAR', clientRequestId: 'abcdefgh', motivoCodigo: 'ILEGIBLE' };
    ['', 'no-uuid', null, undefined, 'legacy:14-0001', 'LEGACY:14-001'].forEach((d) => expect(codigo(planificar(Object.assign({}, base, { documentoId: d })))).toBe('INVALID_DOCUMENTO_ID'));
    expect(codigo(planificar(Object.assign({}, base, { documentoId: doc(1), wellId: WELL })))).toBe('INVALID_REQUEST');
  });
  test('el ITF legacy solo se puede retirar o restaurar, nunca aprobar ni rechazar', () => {
    expect(codigo(planificar({ accion: 'APROBAR', documentoId: LEGACY_ID, clientRequestId: 'abcdefgh' }))).toBe('INVALID_DOCUMENTO_ID');
    expect(codigo(planificar({ accion: 'RECHAZAR', documentoId: LEGACY_ID, clientRequestId: 'abcdefgh', motivoCodigo: 'ILEGIBLE' }))).toBe('INVALID_DOCUMENTO_ID');
    expect(D.itfDominio_validarComando({ accion: 'RETIRAR', documentoId: LEGACY_ID, clientRequestId: 'abcdefgh', motivoCodigo: 'DESACTUALIZADO' }).ok).toBe(true);
    expect(D.itfDominio_validarComando({ accion: 'REVERTIR', documentoId: LEGACY_ID, clientRequestId: 'abcdefgh', motivoCodigo: 'ERROR_DE_APROBACION' }).ok).toBe(true);
  });
  test('cada accion usa SU catalogo de motivos', () => {
    const v = (accion, motivoCodigo, extra) => D.itfDominio_validarComando(Object.assign({ accion: accion, documentoId: doc(1), clientRequestId: 'abcdefgh', motivoCodigo: motivoCodigo }, extra || {}));
    expect(v('RECHAZAR', 'ILEGIBLE').ok).toBe(true);
    expect(v('RECHAZAR', 'ACTUALIZACION').code).toBe('INVALID_MOTIVO');
    expect(v('RECHAZAR', 'DOCUMENTO_INCORRECTO').code).toBe('INVALID_MOTIVO');
    expect(v('RETIRAR', 'DOCUMENTO_INCORRECTO').ok).toBe(true);
    expect(v('RETIRAR', 'ILEGIBLE').code).toBe('INVALID_MOTIVO');
    expect(v('REVERTIR', 'ERROR_DE_APROBACION').ok).toBe(true);
    expect(v('REVERTIR', 'MEJOR_CALIDAD').code).toBe('INVALID_MOTIVO');
    expect(v('APROBAR', 'MEJOR_CALIDAD', { documentoReemplazadoId: doc(2) }).ok).toBe(true);
    expect(v('APROBAR', 'ILEGIBLE', { documentoReemplazadoId: doc(2) }).code).toBe('INVALID_MOTIVO');
  });
  test('motivo: codigo exacto (sin trim ni minusculas), OTRO exige texto, texto de 3 a 300', () => {
    const v = (motivoCodigo, motivoTexto) => D.itfDominio_validarComando({ accion: 'RECHAZAR', documentoId: doc(1), clientRequestId: 'abcdefgh', motivoCodigo: motivoCodigo, motivoTexto: motivoTexto });
    [' ILEGIBLE', 'ilegible', 'ILEGIBLE ', '', null, undefined, 5].forEach((m) => expect(v(m).code).toBe('INVALID_MOTIVO'));
    expect(v('OTRO').code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v('OTRO', '   ').code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v('ILEGIBLE', 'ab').code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v('ILEGIBLE', 'x'.repeat(301)).code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v('ILEGIBLE', 5).code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v('ILEGIBLE', '  Borroso en la esquina  ')).toMatchObject({ ok: true, valores: { motivoTexto: 'Borroso en la esquina' } });
    expect(v('ILEGIBLE')).toMatchObject({ ok: true, valores: { motivoTexto: '' } });
  });
  test('la primera aprobacion (sin reemplazo) no lleva motivo; reemplazar lo exige; no se reemplaza a si mismo', () => {
    const v = (extra) => D.itfDominio_validarComando(Object.assign({ accion: 'APROBAR', documentoId: doc(1), clientRequestId: 'abcdefgh' }, extra));
    expect(v({}).ok).toBe(true);
    expect(v({ motivoCodigo: 'ACTUALIZACION' }).code).toBe('INVALID_REQUEST');
    expect(v({ motivoTexto: 'hola' }).code).toBe('INVALID_REQUEST');
    expect(v({ documentoReemplazadoId: doc(2) }).code).toBe('INVALID_MOTIVO');
    expect(v({ documentoReemplazadoId: doc(2), motivoCodigo: 'OTRO' }).code).toBe('INVALID_MOTIVO_TEXTO');
    expect(v({ documentoReemplazadoId: doc(1), motivoCodigo: 'ACTUALIZACION' }).code).toBe('INVALID_REQUEST');
    expect(v({ documentoReemplazadoId: 'basura', motivoCodigo: 'ACTUALIZACION' }).code).toBe('INVALID_DOCUMENTO_ID');
  });
  test('documentoReemplazadoId solo en APROBAR y REVERTIR', () => {
    ['RECHAZAR', 'RETIRAR'].forEach((accion) => {
      expect(D.itfDominio_validarComando({ accion: accion, documentoId: doc(1), documentoReemplazadoId: doc(2), clientRequestId: 'abcdefgh', motivoCodigo: 'OTRO', motivoTexto: 'hola' }).code).toBe('INVALID_REQUEST');
    });
  });
  test('los mensajes de error no devuelven el contenido recibido', () => {
    const r = D.itfDominio_validarComando({ accion: 'RECHAZAR', documentoId: doc(1), clientRequestId: 'abcdefgh', motivoCodigo: 'ILEGIBLE', motivoTexto: 'x'.repeat(301) });
    expect(JSON.stringify(r)).not.toContain('xxxx');
  });
});

describe('permisos: el chequeo va antes que el estado (no hay oraculo)', () => {
  test('sin perfil_subir no se propone; sin perfil_validar no se aprueba / rechaza / retira / revierte', () => {
    expect(codigo(proponer(1, val))).toBe('PERMISSION_DENIED');
    expect(codigo(proponer(1, lee))).toBe('PERMISSION_DENIED');
    expect(codigo(aprobar(doc(1), null, ana))).toBe('PERMISSION_DENIED');
    expect(codigo(rechazar(doc(1), ana))).toBe('PERMISSION_DENIED');
    expect(codigo(retirar(doc(1), ana))).toBe('PERMISSION_DENIED');
    expect(codigo(revertir(doc(1), null, lee))).toBe('PERMISSION_DENIED');
  });
  test('un documento inexistente da PERMISSION_DENIED a quien no puede, y NOT_FOUND a quien si (no se filtra la existencia)', () => {
    expect(codigo(aprobar(doc(77), null, ana))).toBe('PERMISSION_DENIED');
    expect(codigo(aprobar(doc(77), null, val))).toBe('DOCUMENTO_NOT_FOUND');
  });
  test('perfil_subir sin perfil no alcanza', () => {
    const solo = { email: 'x@x.com', nombre: 'X', permisos: { perfil_subir: true, perfil_validar: true } };
    expect(codigo(proponer(1, solo))).toBe('PERMISSION_DENIED');
    expect(codigo(aprobar(doc(1), null, solo))).toBe('PERMISSION_DENIED');
  });
  test('permisos truthy no booleanos no cuentan', () => {
    const raro = { email: 'x@x.com', nombre: 'X', permisos: { perfil: true, perfil_subir: 'SI' } };
    expect(codigo(proponer(1, raro))).toBe('PERMISSION_DENIED');
  });
  test('sesion sin email valido', () => {
    expect(codigo(proponer(1, { email: '', nombre: 'X', permisos: ana.permisos }))).toBe('INVALID_REQUEST');
    expect(codigo(proponer(1, { email: 'sin-arroba', nombre: 'X', permisos: ana.permisos }))).toBe('INVALID_REQUEST');
  });
});

describe('PROPONER', () => {
  test('caso feliz: UN evento ITF_PROPUESTO con metadata del servidor, documentoId opaco generado por el servidor y auditoria de la sesion', () => {
    const plan = proponer(1);
    expect(plan).toMatchObject({ ok: true, accion: 'ESCRIBIR', advertencias: [] });
    expect(plan.eventos).toHaveLength(1);
    const e = plan.eventos[0];
    expect(e).toMatchObject({
      evento: 'ITF_PROPUESTO', wellId: WELL, mimeType: 'image/jpeg', bytes: 5001, sha256: sha(1), storageFileId: H.storageId(1), nombreOriginal: 'f1.jpg',
      documentoReemplazadoId: '', motivoCodigo: '', motivoTexto: '', email: 'ana@x.com', nombre: 'Ana', timestampUtc: H.ISO
    });
    expect(e.documentoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.documentoId).not.toBe(e.eventoId);
    expect(e.documentoId).not.toContain(H.storageId(1));
    expect(e.clientRequestId).toMatch(/^cmd-req-/);
    expect(plan.resultado).toEqual({ evento: 'ITF_PROPUESTO', documentoId: e.documentoId, wellId: WELL });
    expect('secuencia' in e).toBe(false);
  });
  test('el servidor decide el archivo: el cliente no puede mandar metadata, hash ni ids de storage', () => {
    const plan = sim.ejecutar(ana, { accion: 'PROPONER', wellId: WELL, clientRequestId: crid(), sha256: 'a'.repeat(64), storageFileId: 'robado' }, { archivo: archivo(1) });
    expect(plan.ok).toBe(true);
    expect(plan.eventos[0].sha256).toBe(sha(1));
    expect(plan.eventos[0].storageFileId).toBe(H.storageId(1));
  });
  test('los datos del archivo del servidor se validan: solo JPEG / PNG, hash, storage, tamano, nombre', () => {
    [{ mimeType: 'application/pdf' }, { bytes: 0 }, { bytes: 3 * 1024 * 1024 + 1 }, { sha256: 'xx' }, { storageFileId: 'c' }, { nombreOriginal: '' }, null, undefined, 'texto'].forEach((cambio) => {
      const a = cambio !== null && typeof cambio === 'object' ? Object.assign(archivo(1), cambio) : cambio;
      expect(codigo(proponer(1, ana, { archivo: a }))).toBe('INVALID_ARCHIVO');
    });
    expect(proponer(1, ana, { archivo: Object.assign(archivo(1), { mimeType: 'image/png' }) }).ok).toBe(true);
  });
  test('una PROPUESTA no prueba que el pozo exista: solo una fuente institucional PREVIA', () => {
    sim.pozoExiste = false;
    expect(codigo(proponer(1))).toBe('POZO_NOT_FOUND');
    [undefined, null, 'true', 1, 'SI', {}].forEach((v) => expect(codigo(proponer(1, ana, { pozoExiste: v }))).toBe('POZO_NOT_FOUND'));
    sim.pozoExiste = true;
    const primera = proponer(1);
    expect(primera.ok).toBe(true);
    // con eventos de propuesta en el pozo, si ninguna fuente previa lo conoce, sigue sin existir
    sim.pozoExiste = false;
    expect(codigo(proponer(2))).toBe('POZO_NOT_FOUND');
  });
  test('proponer NO cambia el vigente: el legacy y un vigente E9 siguen funcionando', () => {
    const p = proponer(1);
    expect(sim.estado()).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(sim.estado().vigente.documentoId).toBe(LEGACY_ID);
    expect(sim.estado().propuestasPendientes.map((d) => d.documentoId)).toEqual([docDe(p)]);
    aprobar(docDe(p), LEGACY_ID);
    proponer(2);
    expect(sim.estado().vigente.documentoId).toBe(docDe(p));
    expect(sim.estado().propuestasPendientes).toHaveLength(1);
  });
  test('sin vigente, la propuesta deja el pozo PENDIENTE y "Tiene ITF" en NO', () => {
    sim.legacy.disponible = false;
    proponer(1);
    expect(sim.estado()).toMatchObject({ estado: 'PENDIENTE', tieneItf: 'NO' });
  });
  test('puede haber VARIAS propuestas pendientes por pozo', () => {
    proponer(1);
    proponer(2);
    proponer(3);
    expect(sim.estado().propuestasPendientes).toHaveLength(3);
  });
  test('tope de propuestas pendientes por pozo', () => {
    for (let i = 1; i <= D.ITF_PROPUESTAS_PENDIENTES_MAX; i += 1) {
      expect(proponer(i).ok).toBe(true);
    }
    expect(codigo(proponer(99))).toBe('PROPUESTAS_PENDIENTES_MAX');
    rechazar(sim.estado().propuestasPendientes[0].documentoId);
    expect(proponer(99).ok).toBe(true);
  });
  test('DUPLICADO_DOCUMENTO: mismo hash + mismo pozo mientras la otra esta propuesta, vigente, reemplazada o retirada tras ser vigente', () => {
    const a = proponer(1);
    expect(codigo(proponer(1))).toBe('DUPLICADO_DOCUMENTO');                      // pendiente
    aprobar(docDe(a), LEGACY_ID);
    expect(codigo(proponer(1))).toBe('DUPLICADO_DOCUMENTO');                      // vigente
    const b = proponer(2);
    aprobar(docDe(b), docDe(a));
    expect(codigo(proponer(1))).toBe('DUPLICADO_DOCUMENTO');                      // reemplazada: para volver a ella hay que REVERTIR
    retirar(docDe(b));
    expect(codigo(proponer(2))).toBe('DUPLICADO_DOCUMENTO');                      // retirada tras ser vigente
  });
  test('el rechazo no es una lista negra: se puede volver a proponer el mismo archivo (otro documentoId); una propuesta retirada tampoco', () => {
    const a = proponer(1);
    rechazar(docDe(a));
    const otra = proponer(1);
    expect(otra.ok).toBe(true);
    expect(docDe(otra)).not.toBe(docDe(a));
    retirar(docDe(otra));
    expect(proponer(1).ok).toBe(true);
  });
  test('mismo hash que el legacy actual (si se conoce): duplicado; una vez reemplazado el legacy, la huella que cuenta es la del registro', () => {
    expect(codigo(proponer(9000, ana, { legacy: Object.assign({}, sim.legacy, { sha256: sha(9000) }) }))).toBe('DUPLICADO_DOCUMENTO');
    expect(proponer(1, ana, { legacy: Object.assign({}, sim.legacy, { sha256: sha(9000) }) }).ok).toBe(true);
  });
  test('mismo hash en OTRO pozo: se permite y se avisa para revision (no se bloquea)', () => {
    sim.eventos.push(...[H.propuesto(1, { wellId: OTRO_POZO })]);
    const plan = proponer(1);
    expect(plan.ok).toBe(true);
    expect(plan.advertencias).toEqual(['MISMO_HASH_OTRO_POZO']);
  });
  test('un pozo con historial no derivable no recibe propuestas', () => {
    sim.eventos.push(H.crudo('ITF_DESCONOCIDO', { documentoId: doc(1) }));
    expect(codigo(proponer(1))).toBe('ESTADO_NO_DERIVABLE');
  });
  test('un pozo no derivable NO bloquea las propuestas de otro pozo', () => {
    sim.eventos.push(H.crudo('ITF_DESCONOCIDO', { documentoId: doc(1) }));
    const plan = sim.ejecutar(ana, { accion: 'PROPONER', wellId: OTRO_POZO, clientRequestId: crid() }, { archivo: archivo(2) });
    expect(plan.ok).toBe(true);
  });
  test('un legacy de estado desconocido no bloquea proponer (proponer no toca al vigente)', () => {
    sim.legacy.disponible = null;
    expect(proponer(1).ok).toBe(true);
  });
});

describe('APROBAR', () => {
  test('sin vigente (sin legacy): UN evento ITF_APROBADO, sin reemplazo y sin motivo', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    const plan = aprobar(a);
    expect(plan.ok).toBe(true);
    expect(plan.eventos).toHaveLength(1);
    expect(plan.eventos[0]).toMatchObject({ evento: 'ITF_APROBADO', documentoId: a, wellId: WELL, documentoReemplazadoId: '', motivoCodigo: '', motivoTexto: '', email: 'val@x.com', nombre: 'Valeria' });
    expect(sim.estado()).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
  });
  test('reemplaza al legacy: DOS eventos juntos, el registro de su huella y la aprobacion que declara LEGACY:<wellId>', () => {
    const a = docDe(proponer(1));
    const plan = aprobar(a, LEGACY_ID, val, { motivoCodigo: 'MEJOR_CALIDAD', motivoTexto: 'Escaneo nuevo' });
    expect(plan.ok).toBe(true);
    expect(plan.eventos.map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_APROBADO']);
    expect(plan.eventos[0]).toMatchObject({
      documentoId: LEGACY_ID, wellId: WELL, mimeType: 'image/jpeg', bytes: 150000, sha256: sha(9000), storageFileId: H.storageId(9000), nombreOriginal: WELL + '.jpg', clientRequestId: '', motivoCodigo: ''
    });
    expect(plan.eventos[1]).toMatchObject({ documentoId: a, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'MEJOR_CALIDAD', motivoTexto: 'Escaneo nuevo' });
    expect(plan.eventos[0].eventoId).not.toBe(plan.eventos[1].eventoId);
    // el idempotency key va solo en el evento principal: buscar por clientRequestId encuentra UNO
    expect(plan.eventos[1].clientRequestId).toMatch(/^cmd-req-/);
    const e = sim.estado();
    expect(e.vigente.documentoId).toBe(a);
    expect(e.historicos.map((d) => [d.documentoId, d.estado])).toEqual([[LEGACY_ID, 'REEMPLAZADO']]);
  });
  test('falta o es invalida la huella del legacy: no se reemplaza (LEGACY_SNAPSHOT_REQUERIDO)', () => {
    const a = docDe(proponer(1));
    [undefined, null, {}, Object.assign({}, H.SNAP, { sha256: 'xx' }), Object.assign({}, H.SNAP, { mimeType: 'application/pdf' })].forEach((snapshot) => {
      const ctxLegacy = Object.assign({}, sim.legacy, { snapshot });
      const plan = sim.ejecutar(val, { accion: 'APROBAR', documentoId: a, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION', clientRequestId: crid() }, { legacy: ctxLegacy });
      expect(codigo(plan)).toBe('LEGACY_SNAPSHOT_REQUERIDO');
    });
    expect(sim.estado().vigente.documentoId).toBe(LEGACY_ID);
  });
  test('no se reemplaza en silencio: sin declarar el vigente que se ve, VIGENTE_CAMBIO', () => {
    const a = docDe(proponer(1));
    expect(codigo(aprobar(a))).toBe('VIGENTE_CAMBIO');                              // hay legacy y no lo declare
    expect(sim.eventos).toHaveLength(1);                                             // y no se escribio nada
  });
  test('declarar un vigente que ya no es el actual (otro lo cambio mientras tanto): VIGENTE_CAMBIO y nada se escribe', () => {
    const a = docDe(proponer(1));
    const b = docDe(proponer(2));
    aprobar(b, LEGACY_ID);
    const antes = sim.eventos.length;
    expect(codigo(aprobar(a, LEGACY_ID))).toBe('VIGENTE_CAMBIO');
    expect(sim.eventos).toHaveLength(antes);
    expect(sim.estado().vigente.documentoId).toBe(b);
  });
  test('declarar un vigente cuando no hay ninguno: VIGENTE_CAMBIO', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    expect(codigo(aprobar(a, doc(77)))).toBe('VIGENTE_CAMBIO');
  });
  test('reemplaza a un documento E9: UN evento; el anterior queda REEMPLAZADO', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    aprobar(a);
    const b = docDe(proponer(2));
    const plan = aprobar(b, a);
    expect(plan.eventos).toHaveLength(1);
    expect(plan.eventos[0]).toMatchObject({ documentoId: b, documentoReemplazadoId: a, motivoCodigo: 'ACTUALIZACION' });
    expect(sim.estado().vigente.documentoId).toBe(b);
    expect(sim.estado().historicos.map((d) => [d.documentoId, d.estado])).toEqual([[a, 'REEMPLAZADO']]);
  });
  test('dos validadores aprueban propuestas distintas a la vez: el segundo, con la vista vieja, falla y NO queda ningun estado imposible', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    const b = docDe(proponer(2));
    expect(aprobar(a, null, val).ok).toBe(true);
    expect(codigo(aprobar(b, null, val))).toBe('VIGENTE_CAMBIO');                    // vio "sin vigente"
    expect(D.itfDominio_derivar(sim.eventos).porPozo[WELL].integridad).toBe('OK');
    expect(aprobar(b, a).ok).toBe(true);                                             // con la vista nueva, reemplazar es explicito
  });
  test('aprobar y rechazar a la vez la misma propuesta: gana el primero, el segundo recibe DOCUMENTO_NO_PROPUESTO', () => {
    const a = docDe(proponer(1));
    expect(rechazar(a).ok).toBe(true);
    expect(codigo(aprobar(a, LEGACY_ID))).toBe('DOCUMENTO_NO_PROPUESTO');
    const b = docDe(proponer(2));
    expect(aprobar(b, LEGACY_ID).ok).toBe(true);
    expect(codigo(rechazar(b))).toBe('DOCUMENTO_NO_PROPUESTO');
  });
  test('doble aprobacion: DOCUMENTO_NO_PROPUESTO', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    expect(codigo(aprobar(a, LEGACY_ID))).toBe('DOCUMENTO_NO_PROPUESTO');
  });
  test('aprobar un documento inexistente', () => {
    expect(codigo(aprobar(doc(77)))).toBe('DOCUMENTO_NOT_FOUND');
  });
  test('legacy de estado desconocido: no se puede declarar el vigente, no se aprueba (fail-closed)', () => {
    const a = docDe(proponer(1));
    sim.legacy.disponible = null;
    expect(codigo(aprobar(a, LEGACY_ID))).toBe('LEGACY_ESTADO_DESCONOCIDO');
    expect(codigo(aprobar(a))).toBe('LEGACY_ESTADO_DESCONOCIDO');
  });
  test('legacy de estado desconocido pero ya hay un vigente E9: se aprueba normalmente (el legacy no decide)', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    aprobar(a);
    const b = docDe(proponer(2));
    sim.legacy.disponible = null;
    expect(aprobar(b, a).ok).toBe(true);
  });
  test('pozo no derivable: ESTADO_NO_DERIVABLE', () => {
    const a = docDe(proponer(1));
    sim.eventos.push(H.crudo('ITF_DESCONOCIDO', { documentoId: doc(1) }));
    expect(codigo(aprobar(a, LEGACY_ID))).toBe('ESTADO_NO_DERIVABLE');
  });
});

describe('AUTOAPROBACION: permitida, pero siempre como DOS acciones y dos eventos', () => {
  test('quien tiene perfil_subir y perfil_validar propone y despues aprueba su propia propuesta', () => {
    sim.legacy.disponible = false;
    const p = proponer(1, ambos);
    expect(p.ok).toBe(true);
    expect(sim.estado().estado).toBe('PENDIENTE');                                  // proponer NO aprueba solo
    const a = aprobar(docDe(p), null, ambos);
    expect(a.ok).toBe(true);
    expect(sim.estado()).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(sim.estado().vigente.autoaprobado).toBe(true);
    expect(D.itfDominio_dtoValidador(sim.estado()).vigente.autoaprobado).toBe(true);
  });
  test('son eventos separados con ids, secuencias y clientRequestId propios', () => {
    sim.legacy.disponible = false;
    const p = proponer(1, ambos);
    const a = aprobar(docDe(p), null, ambos);
    expect(p.eventos[0].eventoId).not.toBe(a.eventos[0].eventoId);
    expect(p.eventos[0].clientRequestId).not.toBe(a.eventos[0].clientRequestId);
    expect(sim.eventos.map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_APROBADO']);
    expect(sim.eventos.map((e) => e.secuencia)).toEqual([1, 2]);
  });
  test('no existe una accion que proponga y apruebe a la vez, ni una propuesta que nazca aprobada', () => {
    expect(codigo(sim.ejecutar(ambos, { accion: 'PROPONER_Y_APROBAR', wellId: WELL, clientRequestId: crid() }, { archivo: archivo(1) }))).toBe('INVALID_ACCION');
    expect(codigo(sim.ejecutar(ambos, { accion: 'AUTOAPROBAR', documentoId: doc(1), clientRequestId: crid() }))).toBe('INVALID_ACCION');
    const p = proponer(1, ambos);
    expect(p.eventos).toHaveLength(1);
    expect(p.eventos[0].evento).toBe('ITF_PROPUESTO');
  });
  test('reintentar el mismo clientRequestId de la propuesta NO aprueba: un id no sirve para dos acciones', () => {
    sim.legacy.disponible = false;
    const id = 'mismo-id-0001';
    const p = sim.ejecutar(ambos, { accion: 'PROPONER', wellId: WELL, clientRequestId: id }, { archivo: archivo(1) });
    const intento = sim.ejecutar(ambos, { accion: 'APROBAR', documentoId: docDe(p), clientRequestId: id });
    expect(codigo(intento)).toBe('IDEMPOTENCY_CONFLICT');
    expect(sim.estado().estado).toBe('PENDIENTE');
  });
  test('la autoaprobacion se reconoce aunque el email llegue con otras mayusculas', () => {
    sim.legacy.disponible = false;
    const p = proponer(1, ambos);
    aprobar(docDe(p), null, Object.assign({}, ambos, { email: ' CARLA@X.COM ' }));
    expect(sim.estado().vigente.autoaprobado).toBe(true);
  });
  test('quien solo tiene perfil_subir no puede aprobar lo suyo, y quien solo tiene perfil_validar no puede proponer', () => {
    const p = proponer(1, ana);
    expect(codigo(aprobar(docDe(p), LEGACY_ID, ana))).toBe('PERMISSION_DENIED');
    expect(codigo(proponer(2, val))).toBe('PERMISSION_DENIED');
  });
  test('un validador que aprueba lo de OTRA persona no es autoaprobacion', () => {
    sim.legacy.disponible = false;
    const p = proponer(1, ana);
    aprobar(docDe(p), null, val);
    expect(sim.estado().vigente.autoaprobado).toBe(false);
  });
});

describe('RECHAZAR', () => {
  test('la propuesta pasa a RECHAZADA con motivo y no es vigente', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    const plan = rechazar(a, val, { motivoCodigo: 'OTRO', motivoTexto: 'No es del pozo' });
    expect(plan.eventos[0]).toMatchObject({ evento: 'ITF_RECHAZADO', documentoId: a, motivoCodigo: 'OTRO', motivoTexto: 'No es del pozo' });
    expect(sim.estado()).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO' });
    expect(sim.estado().rechazados.map((d) => d.documentoId)).toEqual([a]);
  });
  test('rechazar no depende del vigente ni del legacy (aunque este caido)', () => {
    const a = docDe(proponer(1));
    sim.legacy.disponible = null;
    expect(rechazar(a).ok).toBe(true);
  });
  test('rechazar un documento aprobado, ya rechazado o inexistente', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    expect(codigo(rechazar(a))).toBe('DOCUMENTO_NO_PROPUESTO');
    const b = docDe(proponer(2));
    rechazar(b);
    expect(codigo(rechazar(b))).toBe('DOCUMENTO_NO_PROPUESTO');
    expect(codigo(rechazar(doc(77)))).toBe('DOCUMENTO_NOT_FOUND');
  });
});

describe('RETIRAR', () => {
  test('el vigente E9: queda SIN_ITF, el documento se conserva como historico retirado', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    aprobar(a);
    const plan = retirar(a);
    expect(plan.eventos).toHaveLength(1);
    expect(plan.eventos[0]).toMatchObject({ evento: 'ITF_RETIRADO', documentoId: a, motivoCodigo: 'DOCUMENTO_INCORRECTO' });
    expect(sim.estado()).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO' });
    expect(sim.estado().historicos.map((d) => [d.documentoId, d.estado])).toEqual([[a, 'RETIRADO']]);
  });
  test('una propuesta pendiente', () => {
    const a = docDe(proponer(1));
    expect(retirar(a).ok).toBe(true);
    expect(sim.estado().propuestasPendientes).toEqual([]);
    expect(sim.estado().retirados.map((d) => d.documentoId)).toEqual([a]);
  });
  test('el legacy implicito: se registra su huella ANTES (dos eventos) y el pozo queda SIN_ITF aunque el archivo siga ahi', () => {
    const plan = retirar(LEGACY_ID);
    expect(plan.eventos.map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_RETIRADO']);
    expect(plan.eventos[1]).toMatchObject({ documentoId: LEGACY_ID, documentoReemplazadoId: '' });
    expect(sim.estado()).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO' });
    expect(sim.legacy.disponible).toBe(true);
  });
  test('el legacy ya registrado y vigente: UN evento', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    revertir(LEGACY_ID, a);
    const plan = retirar(LEGACY_ID);
    expect(plan.eventos).toHaveLength(1);
  });
  test('el legacy cuando no es el vigente, o sin archivo: DOCUMENTO_NO_RETIRABLE', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    expect(codigo(retirar(LEGACY_ID))).toBe('DOCUMENTO_NO_RETIRABLE');
    const otro = H.crearSim(D, { legacy: { disponible: false } });
    expect(codigo(otro.ejecutar(val, { accion: 'RETIRAR', documentoId: LEGACY_ID, clientRequestId: crid(), motivoCodigo: 'DESACTUALIZADO' }))).toBe('DOCUMENTO_NO_RETIRABLE');
  });
  test('retirar dos veces, un rechazado, un reemplazado o un inexistente', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    const b = docDe(proponer(2));
    aprobar(b, a);
    expect(codigo(retirar(a))).toBe('DOCUMENTO_NO_RETIRABLE');                        // reemplazado
    expect(retirar(b).ok).toBe(true);
    expect(codigo(retirar(b))).toBe('DOCUMENTO_NO_RETIRABLE');                        // dos veces
    const c = docDe(proponer(3));
    rechazar(c);
    expect(codigo(retirar(c))).toBe('DOCUMENTO_NO_RETIRABLE');
    expect(codigo(retirar(doc(77)))).toBe('DOCUMENTO_NOT_FOUND');
  });
  test('retirar una propuesta funciona aunque el legacy este caido', () => {
    const a = docDe(proponer(1));
    sim.legacy.disponible = null;
    expect(retirar(a).ok).toBe(true);
  });
  test('retirar el vigente legacy con el legacy de estado desconocido: no se hace', () => {
    sim.legacy.disponible = null;
    expect(codigo(retirar(LEGACY_ID))).toBe('LEGACY_ESTADO_DESCONOCIDO');
  });
});

describe('REVERTIR', () => {
  test('A legacy -> B aprobada reemplaza A -> B revertida: A vuelve a ser vigente por un evento explicito, B se conserva', () => {
    const b = docDe(proponer(1));
    aprobar(b, LEGACY_ID);
    const plan = revertir(LEGACY_ID, b);
    expect(plan.ok).toBe(true);
    expect(plan.eventos).toHaveLength(1);                                           // el legacy ya esta registrado
    expect(plan.eventos[0]).toMatchObject({ evento: 'ITF_REVERTIDO', documentoId: LEGACY_ID, documentoReemplazadoId: b, motivoCodigo: 'ERROR_DE_APROBACION' });
    const e = sim.estado();
    expect(e.vigente.documentoId).toBe(LEGACY_ID);
    expect(e.historicos.map((d) => [d.documentoId, d.estado])).toEqual([[b, 'REEMPLAZADO']]);
    expect(sim.eventos.map((x) => x.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO', 'ITF_REVERTIDO']);     // nada se borro
  });
  test('restaurar el legacy exige que su archivo siga disponible', () => {
    const b = docDe(proponer(1));
    aprobar(b, LEGACY_ID);
    sim.legacy.disponible = false;
    expect(codigo(revertir(LEGACY_ID, b))).toBe('LEGACY_NO_DISPONIBLE');
    sim.legacy.disponible = null;
    expect(codigo(revertir(LEGACY_ID, b))).toBe('LEGACY_NO_DISPONIBLE');
  });
  test('restaurar un E9 historico, y restaurar un vigente retirado (sin otro vigente)', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    aprobar(a);
    const b = docDe(proponer(2));
    aprobar(b, a);
    expect(revertir(a, b).ok).toBe(true);
    expect(sim.estado().vigente.documentoId).toBe(a);
    retirar(a);
    expect(sim.estado().estado).toBe('SIN_ITF');
    const plan = revertir(a, null);
    expect(plan.ok).toBe(true);
    expect(sim.estado().vigente.documentoId).toBe(a);
  });
  test('el ITF_RETIRADO deja SIN_ITF y NO restaura nada solo: restaurar es una accion distinta', () => {
    const b = docDe(proponer(1));
    aprobar(b, LEGACY_ID);
    retirar(b);
    expect(sim.estado()).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO' });
    expect(sim.estado().historicos.map((d) => d.documentoId).sort()).toEqual([LEGACY_ID, b].sort());
    expect(revertir(LEGACY_ID, null).ok).toBe(true);
    expect(sim.estado().vigente.documentoId).toBe(LEGACY_ID);
  });
  test('sin declarar el vigente actual: VIGENTE_CAMBIO', () => {
    sim.legacy.disponible = false;
    const a = docDe(proponer(1));
    aprobar(a);
    const b = docDe(proponer(2));
    aprobar(b, a);
    expect(codigo(revertir(a, null))).toBe('VIGENTE_CAMBIO');
    expect(codigo(revertir(a, a))).toBe('INVALID_REQUEST');
  });
  test('destino invalido: propuesta, rechazada, ya vigente, propuesta retirada, inexistente', () => {
    sim.legacy.disponible = false;
    const p = docDe(proponer(1));
    expect(codigo(revertir(p, null))).toBe('DESTINO_INVALIDO');
    const r = docDe(proponer(2));
    rechazar(r);
    expect(codigo(revertir(r, null))).toBe('DESTINO_INVALIDO');
    const v = docDe(proponer(3));
    aprobar(v);
    expect(codigo(revertir(v, null))).toBe('DESTINO_INVALIDO');
    const w = docDe(proponer(4));
    retirar(w);
    expect(codigo(revertir(w, v))).toBe('DESTINO_INVALIDO');
    expect(codigo(revertir(doc(77), null))).toBe('DOCUMENTO_NOT_FOUND');
  });
  test('revertir al legacy que nunca se registro: no hay destino (nunca fue vigente por un evento) y no se escribe nada', () => {
    const plan = revertir(LEGACY_ID, null);
    expect(codigo(plan)).toBe('DOCUMENTO_NOT_FOUND');
    expect(sim.eventos).toHaveLength(0);
  });
});

describe('IDEMPOTENCIA (mismo clientRequestId + mismo contenido) vs DUPLICADO DOCUMENTAL (mismo hash)', () => {
  const comandos = (a) => ({
    PROPONER: { accion: 'PROPONER', wellId: WELL },
    APROBAR: { accion: 'APROBAR', documentoId: a, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'CORRECCION', motivoTexto: 'Fecha mal cargada' },
    RECHAZAR: { accion: 'RECHAZAR', documentoId: a, motivoCodigo: 'OTRO', motivoTexto: 'No corresponde' },
    RETIRAR: { accion: 'RETIRAR', documentoId: a, motivoCodigo: 'DESACTUALIZADO' },
    REVERTIR: { accion: 'REVERTIR', documentoId: LEGACY_ID, documentoReemplazadoId: a, motivoCodigo: 'ERROR_DE_APROBACION' }
  });
  const preparar = (accion) => {
    const a = docDe(proponer(accion === 'RECHAZAR' || accion === 'RETIRAR' ? 1 : 1));
    if (accion === 'REVERTIR') { aprobar(a, LEGACY_ID); }
    return a;
  };
  test.each(['PROPONER', 'APROBAR', 'RECHAZAR', 'RETIRAR', 'REVERTIR'])('%s: el reintento exacto devuelve lo mismo, sin eventos nuevos y sin consumir ids', (accion) => {
    const a = preparar(accion);
    const comando = Object.assign({}, comandos(a)[accion], { clientRequestId: 'reintento-' + accion });
    const extra = accion === 'PROPONER' ? { archivo: archivo(50) } : {};
    const primero = sim.ejecutar(accion === 'PROPONER' ? ana : val, comando, extra);
    expect(primero.ok).toBe(true);
    const cantidad = sim.eventos.length;
    const ids = sim.llamadasId;
    const segundo = sim.ejecutar(accion === 'PROPONER' ? ana : val, comando, extra);
    expect(segundo).toMatchObject({ ok: true, accion: 'REINTENTO', eventos: [] });
    expect(segundo.resultado.documentoId).toBe(primero.resultado.documentoId);
    expect(segundo.resultado.evento).toBe(primero.resultado.evento);
    expect(sim.eventos).toHaveLength(cantidad);
    expect(sim.llamadasId).toBe(ids);
    expect(JSON.stringify(segundo)).not.toMatch(/@x\.com/);
  });
  test.each(['APROBAR', 'RECHAZAR', 'RETIRAR', 'REVERTIR'])('%s: el mismo clientRequestId con otro contenido es IDEMPOTENCY_CONFLICT', (accion) => {
    const a = preparar(accion);
    const comando = Object.assign({}, comandos(a)[accion], { clientRequestId: 'conflicto-' + accion });
    expect(sim.ejecutar(val, comando).ok).toBe(true);
    const otro = accion === 'REVERTIR' ? Object.assign({}, comando, { motivoCodigo: 'DOCUMENTO_INCORRECTO' }) : Object.assign({}, comando, { documentoId: doc(77) });
    const cantidad = sim.eventos.length;
    expect(codigo(sim.ejecutar(val, otro))).toBe('IDEMPOTENCY_CONFLICT');
    expect(codigo(sim.ejecutar(val, Object.assign({}, comando, { motivoTexto: 'otro texto distinto' })))).toBe('IDEMPOTENCY_CONFLICT');
    expect(sim.eventos).toHaveLength(cantidad);
  });
  test('PROPONER: mismo clientRequestId pero otro archivo u otro pozo: IDEMPOTENCY_CONFLICT; otro tipo de accion tambien', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'prop-idem-001' };
    expect(sim.ejecutar(ana, comando, { archivo: archivo(1) }).ok).toBe(true);
    expect(codigo(sim.ejecutar(ana, comando, { archivo: archivo(2) }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(codigo(sim.ejecutar(ana, Object.assign({}, comando, { wellId: OTRO_POZO }), { archivo: archivo(1) }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(sim.eventos).toHaveLength(1);
  });
  test('PROPONER: mismo clientRequestId, mismo pozo, mismo tipo y mismo tamano pero OTRO hash: IDEMPOTENCY_CONFLICT (el hash es parte del contenido)', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'prop-idem-004' };
    expect(sim.ejecutar(ana, comando, { archivo: archivo(1) }).ok).toBe(true);
    const otroHash = Object.assign({}, archivo(1), { sha256: sha(2) });
    expect(codigo(sim.ejecutar(ana, comando, { archivo: otroHash }))).toBe('IDEMPOTENCY_CONFLICT');
    expect(sim.eventos).toHaveLength(1);
  });
  test('el reintento de una propuesta duplicada por hash NO es un duplicado: es el mismo pedido (idempotencia primero)', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'prop-idem-002' };
    const primero = sim.ejecutar(ana, comando, { archivo: archivo(1) });
    const segundo = sim.ejecutar(ana, comando, { archivo: archivo(1) });
    expect(segundo.accion).toBe('REINTENTO');
    expect(docDe(segundo)).toBe(docDe(primero));
    // en cambio un clientRequestId NUEVO con el mismo archivo si es duplicado documental
    expect(codigo(proponer(1))).toBe('DUPLICADO_DOCUMENTO');
  });
  test('usuarios distintos pueden reutilizar el mismo clientRequestId', () => {
    sim.legacy.disponible = false;
    const a = sim.ejecutar(ana, { accion: 'PROPONER', wellId: WELL, clientRequestId: 'compartido-01' }, { archivo: archivo(1) });
    const b = sim.ejecutar(ambos, { accion: 'PROPONER', wellId: WELL, clientRequestId: 'compartido-01' }, { archivo: archivo(2) });
    expect(a.accion).toBe('ESCRIBIR');
    expect(b.accion).toBe('ESCRIBIR');
    expect(sim.eventos).toHaveLength(2);
    expect(D.itfDominio_derivar(sim.eventos).porPozo[WELL].integridad).toBe('OK');
  });
  test('el email se normaliza: el mismo usuario con otras mayusculas es el mismo usuario (reintento)', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'prop-idem-003' };
    sim.ejecutar(ana, comando, { archivo: archivo(1) });
    const mismo = sim.ejecutar(Object.assign({}, ana, { email: '  ANA@X.COM ' }), comando, { archivo: archivo(1) });
    expect(mismo.accion).toBe('REINTENTO');
  });
  test('si el clientRequestId figura mas de una vez (o el evento no se puede leer): INCONSISTENT_STATE', () => {
    const comando = { accion: 'RECHAZAR', documentoId: doc(1), clientRequestId: 'duplicado-01', motivoCodigo: 'ILEGIBLE' };
    [{ total: 2, eventos: [{}, {}] }, { total: 1, eventos: [] }, { total: 1 }].forEach((existentes) => {
      expect(codigo(D.itfDominio_planificar(comando, sim.contexto(val, { existentes: existentes })))).toBe('INCONSISTENT_STATE');
    });
  });
  test('un evento previo de otro tipo con el mismo clientRequestId es conflicto', () => {
    const existentes = { total: 1, eventos: [{ evento: 'ITF_APROBADO', documentoId: doc(1), wellId: WELL, documentoReemplazadoId: '', motivoCodigo: '', motivoTexto: '' }] };
    const comando = { accion: 'RECHAZAR', documentoId: doc(1), clientRequestId: 'duplicado-01', motivoCodigo: 'ILEGIBLE' };
    expect(codigo(D.itfDominio_planificar(comando, sim.contexto(val, { existentes: existentes })))).toBe('IDEMPOTENCY_CONFLICT');
  });
});

describe('cadena completa y propiedades del historial', () => {
  test('legacy -> propuesta -> aprobacion -> nueva version -> retiro -> restauracion: siempre 0 o 1 vigente y el historial intacto', () => {
    const a = docDe(proponer(1));
    const pasos = [
      () => aprobar(a, LEGACY_ID),
      () => { const b = docDe(proponer(2)); return aprobar(b, a); },
      () => { const v = sim.estado().vigente.documentoId; return retirar(v); },
      () => revertir(a, null),
      () => revertir(LEGACY_ID, a)
    ];
    pasos.forEach((paso) => {
      expect(paso().ok).toBe(true);
      const p = D.itfDominio_derivar(sim.eventos).porPozo[WELL];
      expect(p.integridad).toBe('OK');
      const vigentes = Object.values(p.documentos).filter((d) => d.estado === 'VIGENTE');
      expect(vigentes.length).toBeLessThanOrEqual(1);
      expect(p.vigenteId === null ? 0 : 1).toBe(vigentes.length);
    });
    expect(sim.estado().vigente.documentoId).toBe(LEGACY_ID);
    const p = D.itfDominio_derivar(sim.eventos).porPozo[WELL];
    expect(Object.keys(p.documentos)).toHaveLength(3);            // A, B y el legacy: nada se perdio
  });
  test('las secuencias son 1..n consecutivas y la metadata de un documento nunca cambia entre eventos', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    revertir(LEGACY_ID, a);
    expect(sim.eventos.map((e) => e.secuencia)).toEqual([1, 2, 3, 4]);
    const p = D.itfDominio_derivar(sim.eventos).porPozo[WELL];
    expect(p.documentos[a]).toMatchObject({ sha256: sha(1), storageFileId: H.storageId(1), mimeType: 'image/jpeg', bytes: 5001, nombreOriginal: 'f1.jpg' });
  });
  test('planificar no modifica la derivacion recibida', () => {
    const a = docDe(proponer(1));
    const derivacion = D.itfDominio_derivar(sim.eventos);
    const antes = JSON.stringify(derivacion);
    D.itfDominio_planificar({ accion: 'APROBAR', documentoId: a, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION', clientRequestId: 'sin-efectos-01' }, sim.contexto(val, { derivacion: derivacion }));
    expect(JSON.stringify(derivacion)).toBe(antes);
  });
  test('el timestamp y los ids vienen del contexto (reloj y generador inyectados); sin ellos, falla en vez de inventar', () => {
    const comando = { accion: 'RECHAZAR', documentoId: docDe(proponer(1)), clientRequestId: 'tiempo-0001', motivoCodigo: 'ILEGIBLE' };
    expect(() => D.itfDominio_planificar(comando, sim.contexto(val, { ahora: null }))).toThrow(/ahora/);
    expect(() => D.itfDominio_planificar(comando, sim.contexto(val, { ahora: new Date('x') }))).toThrow(/ahora/);
    expect(() => D.itfDominio_planificar(comando, sim.contexto(val, { nuevoEventoId: undefined }))).toThrow(/nuevoEventoId/);
    expect(() => D.itfDominio_planificar(comando, sim.contexto(val, { nuevoEventoId: () => 'no-uuid' }))).toThrow(/UUID/);
    const bien = D.itfDominio_planificar(comando, sim.contexto(val, { ahora: new Date('2026-11-02T10:20:30.456Z') }));
    expect(bien.eventos[0].timestampUtc).toBe('2026-11-02T10:20:30.456Z');
  });
  test('proponer sin generador de documentoId: falla', () => {
    expect(() => proponer(1, ana, { nuevoDocumentoId: undefined })).toThrow(/nuevoDocumentoId/);
    expect(() => proponer(1, ana, { nuevoDocumentoId: () => 'no-uuid' })).toThrow(/nuevoDocumentoId/);
  });
  test('los eventos planificados llevan el nombre de la sesion normalizado, vacio si falta, y nunca llevan secuencia', () => {
    const a = proponer(1, Object.assign({}, ana, { nombre: '  Ana   Maria ' }));
    expect(a.eventos[0].nombre).toBe('Ana Maria');
    const b = proponer(2, Object.assign({}, ana, { nombre: '' }));
    expect(b.eventos[0].nombre).toBe('');
    const c = proponer(3, Object.assign({}, ana, { nombre: 'ana@x.com' }));
    expect(c.eventos[0].nombre).toBe('Usuario');
    [a, b, c].forEach((p) => expect('secuencia' in p.eventos[0]).toBe(false));
  });
  test('un evento planificado se puede derivar tal cual (parseable, sin campos de mas)', () => {
    const a = docDe(proponer(1));
    aprobar(a, LEGACY_ID);
    const columnas = require('../src/ItfEventosRepository').ITF_EVENTOS_COLUMNAS.filter((c) => c !== 'secuencia');
    sim.eventos.forEach((e) => expect(Object.keys(e).filter((k) => k !== 'secuencia' && k !== 'fila').sort()).toEqual(columnas.slice().sort()));
  });
});
