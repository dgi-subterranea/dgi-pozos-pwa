// ItfDominioService (E9-2): derivacion pura de los ITF colaborativos. Baseline legacy, propuestas, aprobacion / autoaprobacion, rechazo, reemplazo, retiro, reversion, integridad fail-closed
// (por pozo, sin romper a los demas), contrato "Tiene ITF", DTO sin email / storage / hash y permisos. Sin hojas, sin red, sin Apps Script.
// NOTA de estilo: los caracteres especiales se arman con String.fromCharCode (no con secuencias de escape en el texto del test).
Object.assign(global, require('../src/ItfArchivoLogic'));
const D = require('../src/ItfDominioService');
const E8 = require('../src/FotosPozosModeracionService');
const H = require('./itfHelper');

const { WELL, uuid, sha, propuesto, aprobado, rechazado, retirado, revertido, legacy, crudo, doc } = H;
const OTRO_POZO = '14-0002';
const ch = (...codes) => String.fromCharCode(...codes);
const LEGACY_ID = 'LEGACY:' + WELL;

beforeEach(() => { H.reiniciar(); });

const der = (eventos) => D.itfDominio_derivar(eventos);
const est = (eventos, legacyDisp, wellId) => D.itfDominio_estadoPozo(wellId || WELL, der(eventos), legacyDisp);
const codigos = (eventos, wellId) => der(eventos).porPozo[wellId || WELL].inconsistencias;
const noDerivable = (eventos, codigo, wellId) => {
  const p = der(eventos).porPozo[wellId || WELL];
  expect(p.integridad).toBe('NO_DERIVABLE');
  if (codigo) { expect(p.inconsistencias).toContain(codigo); }
  return p;
};
const ids = (docs) => docs.map((d) => d.documentoId);

describe('catalogo y constantes', () => {
  test('los 6 eventos, los 5 estados de documento y los 3 estados de pozo exactos', () => {
    expect(D.ITF_EVENTOS).toEqual(['ITF_PROPUESTO', 'ITF_APROBADO', 'ITF_RECHAZADO', 'ITF_RETIRADO', 'ITF_REVERTIDO', 'ITF_LEGACY_REGISTRADO']);
    expect(Object.values(D.ITF_ESTADOS_DOCUMENTO)).toEqual(['PROPUESTO', 'VIGENTE', 'REEMPLAZADO', 'RECHAZADO', 'RETIRADO']);
    expect(Object.values(D.ITF_ESTADOS_POZO)).toEqual(['SIN_ITF', 'PENDIENTE', 'VIGENTE']);
    expect(Object.values(D.ITF_TIENE_ITF)).toEqual(['SI', 'NO', 'DESCONOCIDO']);
  });
  test('no hay un estado HISTORICO aparte (es presentacion) ni un evento REEMPLAZADO (lo declara la aprobacion)', () => {
    expect(Object.values(D.ITF_ESTADOS_DOCUMENTO)).not.toContain('HISTORICO');
    expect(D.ITF_EVENTOS.join(',')).not.toMatch(/REEMPLAZADO/);
  });
  test('catalogos de motivos', () => {
    expect(D.ITF_MOTIVOS_RECHAZO).toEqual(['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA', 'OTRO']);
    expect(D.ITF_MOTIVOS_REEMPLAZO).toEqual(['ACTUALIZACION', 'CORRECCION', 'MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO', 'OTRO']);
    expect(D.ITF_MOTIVOS_RETIRO).toEqual(['ERROR_DE_APROBACION', 'DOCUMENTO_INCORRECTO', 'NO_CORRESPONDE_POZO', 'DESACTUALIZADO', 'OTRO']);
  });
  test('clientRequestId: 8 a 64 caracteres [A-Za-z0-9_-]', () => {
    expect(D.ITF_CLIENT_REQUEST_ID_REGEX.test('abcdefgh')).toBe(true);
    expect(D.ITF_CLIENT_REQUEST_ID_REGEX.test('a'.repeat(64))).toBe(true);
    ['abcdefg', 'a'.repeat(65), 'abc defgh', 'abcdefg!', ''].forEach((v) => expect(D.ITF_CLIENT_REQUEST_ID_REGEX.test(v)).toBe(false));
  });
  test('la normalizacion de texto es la misma que la de E8 (no se desvia)', () => {
    const corpus = ['  hola  ', 'a' + ch(13, 10) + 'b' + ch(13) + 'c' + ch(0x85) + 'd' + ch(0x2028) + 'e' + ch(0x2029) + 'f', 'a' + ch(9) + 'b', 'a' + ch(0) + 'b' + ch(0x7F) + ch(0x9F) + 'c',
      'a' + ch(0x202E) + 'b' + ch(0x2066) + 'c' + ch(0xFEFF), 'a' + ch(0xD800) + 'b' + ch(0xDC00) + 'c', String.fromCodePoint(0x1F600) + ' ok', 'x' + ch(0x200D) + 'y', '', 5, null];
    corpus.forEach((t) => expect(D.itfDominio_normalizarTexto(t)).toEqual(E8.fotosPozosModeracion_normalizarTexto(t)));
  });
});

describe('BASELINE LEGACY: sin eventos E9 todo se comporta como hoy', () => {
  test('legacy presente y sin eventos: VIGENTE legacy implicito, Tiene ITF = SI', () => {
    const e = est([], true);
    expect(e).toMatchObject({ integridad: 'OK', estado: 'VIGENTE', tieneItf: 'SI', legacy: 'DISPONIBLE', propuestasPendientes: [], historicos: [], rechazados: [], retirados: [] });
    expect(e.vigente).toMatchObject({ documentoId: LEGACY_ID, origen: 'LEGACY', estado: 'VIGENTE', implicito: true });
    expect(D.itfTieneVigente(WELL, der([]), true)).toBe(true);
  });
  test('sin legacy y sin eventos: SIN_ITF, Tiene ITF = NO', () => {
    expect(est([], false)).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO', vigente: null, legacy: 'NO_DISPONIBLE' });
    expect(D.itfTieneVigente(WELL, der([]), false)).toBe(false);
  });
  test('legacy de estado desconocido (error de Drive): DESCONOCIDO, nunca SI ni NO', () => {
    [null, undefined, 'si', 1, 'true'].forEach((v) => {
      const e = est([], v);
      expect(e).toMatchObject({ estado: null, tieneItf: 'DESCONOCIDO', vigente: null, legacy: 'DESCONOCIDO' });
      expect(D.itfTieneVigente(WELL, der([]), v)).toBe(false);
    });
  });
  test('un pozo sin eventos no aparece en la derivacion (no se crea ningun registro)', () => {
    const d = der([propuesto(1)]);
    expect(Object.keys(d.porPozo)).toEqual([WELL]);
    expect(D.itfDominio_estadoPozo(OTRO_POZO, d, true)).toMatchObject({ tieneItf: 'SI', estado: 'VIGENTE' });
  });
  test('legacy + propuesta pendiente: el legacy SIGUE vigente (lo pendiente no lo oculta)', () => {
    const e = est([propuesto(1), propuesto(2)], true);
    expect(e.estado).toBe('VIGENTE');
    expect(e.vigente.documentoId).toBe(LEGACY_ID);
    expect(ids(e.propuestasPendientes)).toEqual([doc(1), doc(2)]);
    expect(e.tieneItf).toBe('SI');
  });
  test('sin legacy + propuesta pendiente: PENDIENTE y Tiene ITF = NO (una propuesta no cuenta)', () => {
    const e = est([propuesto(1)], false);
    expect(e).toMatchObject({ estado: 'PENDIENTE', tieneItf: 'NO', vigente: null });
    expect(D.itfTieneVigente(WELL, der([propuesto(1)]), false)).toBe(false);
  });
  test('legacy desconocido + propuesta pendiente: sigue siendo DESCONOCIDO', () => {
    expect(est([propuesto(1)], null)).toMatchObject({ estado: null, tieneItf: 'DESCONOCIDO' });
  });
  test('primer reemplazo del legacy: registro + aprobacion que declara LEGACY:<wellId>', () => {
    const e = est([propuesto(1), legacy(), aprobado(1, LEGACY_ID)], true);
    expect(e.vigente.documentoId).toBe(doc(1));
    expect(e.vigente.origen).toBe('E9');
    expect(e.historicos).toHaveLength(1);
    expect(e.historicos[0]).toMatchObject({ documentoId: LEGACY_ID, origen: 'LEGACY', estado: 'REEMPLAZADO', reemplazadoPor: doc(1), mimeType: 'image/jpeg', nombreOriginal: WELL + '.jpg' });
    expect(e.vigente.reemplazaA).toBe(LEGACY_ID);
    expect(e.advertencias).toEqual([]);
  });
  test('tras el reemplazo, el archivo legacy NO se baja ademas (una sola fuente por pozo)', () => {
    const e = est([propuesto(1), legacy(), aprobado(1, LEGACY_ID)], true);
    expect(D.itfDominio_documentoParaDescarga(e)).toEqual({ documentoId: doc(1), origen: 'E9' });
  });
  test('el legacy reemplazado sigue referenciable aunque el archivo no este: advertencia y NO se pierde el historial', () => {
    const e = est([propuesto(1), legacy(), aprobado(1, LEGACY_ID)], false);
    expect(e.vigente.documentoId).toBe(doc(1));
    expect(e.advertencias).toContain('LEGACY_HISTORICO_AUSENTE');
    expect(e.historicos).toHaveLength(1);
  });
  test('restauracion del legacy: revertir al LEGACY desplaza a B (B queda REEMPLAZADO) y el legacy vuelve a ser el vigente', () => {
    const eventos = [propuesto(1), legacy(), aprobado(1, LEGACY_ID), revertido(LEGACY_ID, 1)];
    const e = est(eventos, true);
    expect(e).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(e.vigente).toMatchObject({ documentoId: LEGACY_ID, origen: 'LEGACY', estado: 'VIGENTE' });
    expect(e.vigente.reemplazadoPor).toBeNull();
    expect(e.historicos.map((d) => [d.documentoId, d.estado])).toEqual([[doc(1), 'REEMPLAZADO']]);
    expect(D.itfDominio_documentoParaDescarga(e)).toEqual({ documentoId: LEGACY_ID, origen: 'LEGACY' });
  });
  test('legacy registrado y vigente pero el archivo ya no esta: no se afirma Tiene ITF', () => {
    const e = est([legacy()], false);
    expect(e).toMatchObject({ tieneItf: 'NO', vigente: null, estado: 'SIN_ITF' });
    expect(e.advertencias).toContain('LEGACY_AUSENTE');
    expect(est([legacy()], null)).toMatchObject({ tieneItf: 'DESCONOCIDO', estado: null });
  });
  test('retirar el legacy deja SIN_ITF aunque el archivo siga en la carpeta (no hay vuelta al legacy implicito)', () => {
    const e = est([legacy(), retirado(LEGACY_ID)], true);
    expect(e).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO', vigente: null });
    expect(e.historicos).toHaveLength(1);
    expect(e.historicos[0]).toMatchObject({ documentoId: LEGACY_ID, estado: 'RETIRADO' });
  });
  test('restaurar el legacy retirado: otra accion explicita (ITF_REVERTIDO), no un efecto del retiro', () => {
    const e = est([legacy(), retirado(LEGACY_ID), revertido(LEGACY_ID)], true);
    expect(e).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(e.vigente.documentoId).toBe(LEGACY_ID);
  });
  test('un legacy que aparece DESPUES de que el flujo E9 definio el vigente se ignora con advertencia', () => {
    const e = est([propuesto(1), aprobado(1)], true);
    expect(e.vigente.documentoId).toBe(doc(1));
    expect(e.advertencias).toContain('LEGACY_IGNORADO');
    expect(D.itfDominio_documentoParaDescarga(e)).toEqual({ documentoId: doc(1), origen: 'E9' });
  });
  test('sin legacy, primera aprobacion: queda VIGENTE sin reemplazar nada', () => {
    const e = est([propuesto(1), aprobado(1)], false);
    expect(e).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(e.vigente.reemplazaA).toBeNull();
  });
});

describe('PROPUESTAS', () => {
  test('una propuesta: pendiente, con su metadata inmutable y sin vigente', () => {
    const p = der([propuesto(1)]).porPozo[WELL];
    expect(p.integridad).toBe('OK');
    expect(p.documentos[doc(1)]).toMatchObject({
      estado: 'PROPUESTO', origen: 'E9', wellId: WELL, mimeType: 'image/jpeg', bytes: 1001, sha256: sha(1), storageFileId: H.storageId(1), nombreOriginal: 'itf-1.jpg', fueVigente: false
    });
    expect(p.vigenteId).toBeNull();
  });
  test('varias propuestas pendientes por pozo, en orden de secuencia', () => {
    const e = est([propuesto(3), propuesto(1), propuesto(2)], false);
    expect(ids(e.propuestasPendientes)).toEqual([doc(3), doc(1), doc(2)]);
    expect(e.estado).toBe('PENDIENTE');
  });
  test('la derivacion no decide duplicados por hash (eso lo decide la escritura): dos propuestas con el mismo hash conviven', () => {
    const e = est([propuesto(1), propuesto(2, { sha256: sha(1) })], false);
    expect(e.propuestasPendientes).toHaveLength(2);
  });
  test('mismo hash en OTRO pozo: se permite pero se MARCA para revision (en ambos pozos)', () => {
    const d = der([propuesto(1), propuesto(2, { wellId: OTRO_POZO, sha256: sha(1) }), propuesto(3)]);
    expect(d.porPozo[WELL].documentos[doc(1)].marcaRevision).toEqual(['MISMO_HASH_OTRO_POZO']);
    expect(d.porPozo[OTRO_POZO].documentos[doc(2)].marcaRevision).toEqual(['MISMO_HASH_OTRO_POZO']);
    expect(d.porPozo[WELL].documentos[doc(3)].marcaRevision).toEqual([]);
    expect(d.porPozo[WELL].integridad).toBe('OK');
  });
  test('una propuesta NO crea un pozo: el unico pozo de la derivacion es el del evento y no hay vigente', () => {
    const d = der([propuesto(1, { wellId: '99-9999' })]);
    expect(Object.keys(d.porPozo)).toEqual(['99-9999']);
    expect(D.itfTieneVigente('99-9999', d, false)).toBe(false);
  });
});

describe('APROBACION y AUTOAPROBACION', () => {
  test('sin vigente: la propuesta pasa a VIGENTE', () => {
    const e = est([propuesto(1), aprobado(1)], false);
    expect(e.vigente).toMatchObject({ documentoId: doc(1), estado: 'VIGENTE', fueVigente: true });
    expect(e.propuestasPendientes).toEqual([]);
  });
  test('reemplaza un documento E9: UN solo evento hace B vigente y A reemplazado (nunca 0 ni 2 vigentes)', () => {
    const eventos = [propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1)];
    const p = der(eventos).porPozo[WELL];
    expect(p.integridad).toBe('OK');
    const vigentes = Object.values(p.documentos).filter((d) => d.estado === 'VIGENTE');
    expect(vigentes.map((d) => d.documentoId)).toEqual([doc(2)]);
    expect(p.documentos[doc(1)]).toMatchObject({ estado: 'REEMPLAZADO', reemplazadoPor: doc(2), fueVigente: true });
    expect(p.documentos[doc(2)].reemplazaA).toBe(doc(1));
    // en el estado INTERMEDIO (antes del evento de aprobacion) hay exactamente un vigente
    const antes = der(eventos.slice(0, 3)).porPozo[WELL];
    expect(Object.values(antes.documentos).filter((d) => d.estado === 'VIGENTE').map((d) => d.documentoId)).toEqual([doc(1)]);
  });
  test('el reemplazo conserva al anterior: nunca se borra, queda como historico', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1)], false);
    expect(e.historicos.map((d) => [d.documentoId, d.estado])).toEqual([[doc(1), 'REEMPLAZADO']]);
  });
  test('quien aprueba puede ser quien propuso: queda marcado como autoaprobado, sin estado especial', () => {
    const e = est([propuesto(1, { email: 'ana@x.com' }), aprobado(1, null, { email: 'ana@x.com' })], false);
    expect(e.estado).toBe('VIGENTE');
    expect(e.vigente.autoaprobado).toBe(true);
    expect(Object.values(D.ITF_ESTADOS_DOCUMENTO)).not.toContain('AUTOAPROBADO');
  });
  test('la autoaprobacion se reconoce sin importar mayusculas ni espacios del email', () => {
    const e = est([propuesto(1, { email: 'ana@x.com' }), aprobado(1, null, { email: '  ANA@X.COM ' })], false);
    expect(e.vigente.autoaprobado).toBe(true);
  });
  test('aprobar con otra persona NO es autoaprobacion', () => {
    expect(est([propuesto(1), aprobado(1)], false).vigente.autoaprobado).toBe(false);
  });
  test('son dos eventos distintos aunque sea la misma persona (la derivacion exige los dos)', () => {
    const e = est([propuesto(1, { email: 'ana@x.com' }), aprobado(1, null, { email: 'ana@x.com' })], false);
    expect(e.historial.map((h) => h.evento)).toEqual(['ITF_PROPUESTO', 'ITF_APROBADO']);
    expect(e.historial[0].secuencia).not.toBe(e.historial[1].secuencia);
  });
  test('aprobar una propuesta rechazada: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), rechazado(1), aprobado(1)], 'APROBACION_DE_DOCUMENTO_NO_PROPUESTO');
  });
  test('doble aprobacion del mismo documento: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), aprobado(1), aprobado(1)], 'APROBACION_DE_DOCUMENTO_NO_PROPUESTO');
  });
  test('aprobar con vigente sin declarar el reemplazo: NO_DERIVABLE (nunca reemplazo silencioso)', () => {
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2)], 'REEMPLAZO_NO_DECLARADO');
  });
  test('dos aprobaciones incompatibles (dos vigentes): NO_DERIVABLE', () => {
    noDerivable([propuesto(1), propuesto(2), aprobado(1), aprobado(2)], 'REEMPLAZO_NO_DECLARADO');
  });
  test('declarar como reemplazado algo que no es el vigente: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), aprobado(1), propuesto(2), propuesto(3), aprobado(3, 2)], 'REEMPLAZO_NO_VIGENTE');
  });
  test('declarar un reemplazo cuando no hay vigente: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), propuesto(2), aprobado(2, 1)], 'REEMPLAZO_SIN_VIGENTE');
  });
  test('aprobar un documento inexistente: NO_DERIVABLE', () => {
    noDerivable([aprobado(7)], 'DOCUMENTO_INEXISTENTE');
  });
  test('reemplazar exige motivo del catalogo; sin reemplazo no lleva motivo', () => {
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1, { motivoCodigo: '' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1, { motivoCodigo: 'ILEGIBLE' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), aprobado(1, null, { motivoCodigo: 'ACTUALIZACION' })], 'CAMPOS_INCOHERENTES');
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1, { motivoCodigo: 'OTRO' })], 'MOTIVO_INVALIDO');
    expect(der([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1, { motivoCodigo: 'OTRO', motivoTexto: 'Escaneo mas nitido' })]).porPozo[WELL].integridad).toBe('OK');
  });
  test('el motivo del reemplazo queda en el historico del anterior', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1, { motivoCodigo: 'MEJOR_CALIDAD' })], false);
    expect(e.historicos[0].cierre).toMatchObject({ evento: 'ITF_APROBADO', motivoCodigo: 'MEJOR_CALIDAD' });
  });
});

describe('RECHAZO', () => {
  test('una propuesta rechazada queda RECHAZADA, con motivo, y nunca es vigente', () => {
    const e = est([propuesto(1), rechazado(1, { motivoCodigo: 'INCOMPLETO' })], false);
    expect(e.rechazados).toHaveLength(1);
    expect(e.rechazados[0]).toMatchObject({ documentoId: doc(1), estado: 'RECHAZADO', fueVigente: false });
    expect(e.rechazados[0].cierre).toMatchObject({ motivoCodigo: 'INCOMPLETO' });
    expect(e).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO', vigente: null });
    expect(e.propuestasPendientes).toEqual([]);
  });
  test('el rechazo de una propuesta NO toca al vigente', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), rechazado(2)], false);
    expect(e.vigente.documentoId).toBe(doc(1));
    expect(e.tieneItf).toBe('SI');
  });
  test('OTRO exige texto; el texto se valida (3 a 300) y el codigo debe ser del catalogo de rechazo', () => {
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: 'OTRO' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: 'OTRO', motivoTexto: 'ab' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: 'OTRO', motivoTexto: 'x'.repeat(301) })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: 'ACTUALIZACION' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: '' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1, { motivoCodigo: 'ilegible' })], 'MOTIVO_INVALIDO');
    expect(der([propuesto(1), rechazado(1, { motivoCodigo: 'OTRO', motivoTexto: 'No es del pozo' })]).porPozo[WELL].integridad).toBe('OK');
  });
  test('rechazar despues de aprobar: NO_DERIVABLE (un vigente no se rechaza, se retira)', () => {
    noDerivable([propuesto(1), aprobado(1), rechazado(1)], 'RECHAZO_DE_DOCUMENTO_NO_PROPUESTO');
  });
  test('doble rechazo: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), rechazado(1), rechazado(1)], 'RECHAZO_DE_DOCUMENTO_NO_PROPUESTO');
  });
});

describe('RETIRO', () => {
  test('retirar el vigente deja el pozo SIN_ITF y el documento queda como historico retirado (no se borra)', () => {
    const e = est([propuesto(1), aprobado(1), retirado(1)], false);
    expect(e).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO', vigente: null });
    expect(e.historicos.map((d) => [d.documentoId, d.estado, d.fueVigente])).toEqual([[doc(1), 'RETIRADO', true]]);
  });
  test('retirar el vigente con propuestas pendientes deja el pozo PENDIENTE', () => {
    expect(est([propuesto(1), aprobado(1), propuesto(2), retirado(1)], false)).toMatchObject({ estado: 'PENDIENTE', tieneItf: 'NO' });
  });
  test('retirar una propuesta pendiente: sale de pendientes, no es historico y no toca al vigente', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), retirado(2)], false);
    expect(e.propuestasPendientes).toEqual([]);
    expect(e.retirados.map((d) => d.documentoId)).toEqual([doc(2)]);
    expect(e.historicos).toEqual([]);
    expect(e.vigente.documentoId).toBe(doc(1));
  });
  test('retirar dos veces: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), aprobado(1), retirado(1), retirado(1)], 'RETIRO_DE_DOCUMENTO_NO_RETIRABLE');
    noDerivable([propuesto(1), retirado(1), retirado(1)], 'RETIRO_DE_DOCUMENTO_NO_RETIRABLE');
  });
  test('retirar un rechazado o un reemplazado: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), rechazado(1), retirado(1)], 'RETIRO_DE_DOCUMENTO_NO_RETIRABLE');
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), retirado(1)], 'RETIRO_DE_DOCUMENTO_NO_RETIRABLE');
  });
  test('el motivo es obligatorio y del catalogo de retiro', () => {
    noDerivable([propuesto(1), retirado(1, { motivoCodigo: '' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), retirado(1, { motivoCodigo: 'ILEGIBLE' })], 'MOTIVO_INVALIDO');
    noDerivable([propuesto(1), retirado(1, { motivoCodigo: 'OTRO' })], 'MOTIVO_INVALIDO');
  });
  test('retirar un legacy que nunca se registro: NO_DERIVABLE (primero se registra su huella)', () => {
    noDerivable([retirado(LEGACY_ID)], 'LEGACY_NO_REGISTRADO');
  });
});

describe('REVERSION', () => {
  test('restaurar un E9 historico: vuelve a ser vigente y desplaza al actual (que queda REEMPLAZADO)', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), revertido(1, 2)], false);
    expect(e.vigente.documentoId).toBe(doc(1));
    expect(e.historicos.map((d) => [d.documentoId, d.estado])).toEqual([[doc(2), 'REEMPLAZADO']]);
  });
  test('restaurar un vigente retirado (sin otro vigente): no declara reemplazo', () => {
    const e = est([propuesto(1), aprobado(1), retirado(1), revertido(1)], false);
    expect(e).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(e.vigente.documentoId).toBe(doc(1));
  });
  test('revertir sin declarar al vigente actual, o declarando otro: NO_DERIVABLE', () => {
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), revertido(1)], 'REEMPLAZO_NO_DECLARADO');
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), propuesto(3), revertido(1, 3)], 'REEMPLAZO_NO_VIGENTE');
    noDerivable([propuesto(1), aprobado(1), retirado(1), revertido(1, 1)], 'REEMPLAZO_IGUAL_AL_DOCUMENTO');
  });
  test('destino invalido: propuesta, rechazada, ya vigente, o propuesta retirada que nunca fue vigente', () => {
    noDerivable([propuesto(1), revertido(1)], 'REVERSION_DESTINO_INVALIDO');
    noDerivable([propuesto(1), rechazado(1), revertido(1)], 'REVERSION_DESTINO_INVALIDO');
    noDerivable([propuesto(1), aprobado(1), revertido(1)], 'REVERSION_DESTINO_INVALIDO');
    noDerivable([propuesto(1), retirado(1), revertido(1)], 'REVERSION_DESTINO_INVALIDO');
  });
  test('revertir a un documento inexistente o a un legacy no registrado: NO_DERIVABLE', () => {
    noDerivable([revertido(7)], 'DOCUMENTO_INEXISTENTE');
    noDerivable([revertido(LEGACY_ID)], 'LEGACY_NO_REGISTRADO');
  });
  test('la reversion NO borra historia: todos los eventos y documentos siguen, en orden', () => {
    const eventos = [propuesto(1), legacy(), aprobado(1, LEGACY_ID), revertido(LEGACY_ID, 1)];
    const p = der(eventos).porPozo[WELL];
    expect(p.historial.map((h) => h.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO', 'ITF_APROBADO', 'ITF_REVERTIDO']);
    expect(Object.keys(p.documentos).sort()).toEqual([LEGACY_ID, doc(1)].sort());
  });
  test('ida y vuelta repetida: A -> B -> A -> B sigue teniendo UN vigente', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), revertido(1, 2), revertido(2, 1)], false);
    expect(e.vigente.documentoId).toBe(doc(2));
    expect(e.historicos.map((d) => d.documentoId)).toEqual([doc(1)]);
  });
});

describe('INTEGRIDAD (fail-closed, por pozo)', () => {
  test('evento desconocido o mal escrito (mayusculas)', () => {
    noDerivable([propuesto(1), crudo('ITF_BORRADO', { documentoId: doc(1) })], 'EVENTO_DESCONOCIDO');
    noDerivable([propuesto(1), crudo('itf_aprobado', { documentoId: doc(1) })], 'EVENTO_DESCONOCIDO');
  });
  test('secuencia duplicada: afecta a los pozos de las filas involucradas (y solo a ellos)', () => {
    const a = propuesto(1);
    const b = propuesto(2, { wellId: OTRO_POZO, secuencia: a.secuencia });
    const c = propuesto(3, { wellId: '14-0003' });
    const d = der([a, b, c]);
    expect(d.porPozo[WELL].inconsistencias).toContain('SECUENCIA_DUPLICADA');
    expect(d.porPozo[OTRO_POZO].inconsistencias).toContain('SECUENCIA_DUPLICADA');
    expect(d.porPozo['14-0003'].integridad).toBe('OK');
  });
  test('secuencia invalida: 0, negativa, fraccionaria, vacia, texto', () => {
    [0, -1, 1.5, '', 'abc', null, NaN].forEach((s) => {
      noDerivable([propuesto(1), propuesto(2, { secuencia: s })], 'SECUENCIA_INVALIDA');
    });
  });
  test('eventoId duplicado o invalido', () => {
    const a = propuesto(1);
    noDerivable([a, propuesto(2, { eventoId: a.eventoId })], 'EVENTO_ID_DUPLICADO');
    noDerivable([propuesto(1), propuesto(2, { eventoId: 'no-es-uuid' })], 'ID_INVALIDO');
  });
  test('documentoId reutilizado con metadata distinta (o hash cambiado)', () => {
    noDerivable([propuesto(1), propuesto(1, { sha256: sha(99) })], 'DOCUMENTO_REUTILIZADO_METADATA_DISTINTA');
    noDerivable([propuesto(1), propuesto(1, { mimeType: 'image/png' })], 'DOCUMENTO_REUTILIZADO_METADATA_DISTINTA');
    noDerivable([propuesto(1), propuesto(1, { storageFileId: H.storageId(55) })], 'DOCUMENTO_REUTILIZADO_METADATA_DISTINTA');
  });
  test('documentoId repetido aunque la metadata sea la misma: tambien es inconsistente', () => {
    const p = noDerivable([propuesto(1), propuesto(1)], 'DOCUMENTO_ID_DUPLICADO');
    expect(p.inconsistencias).not.toContain('DOCUMENTO_REUTILIZADO_METADATA_DISTINTA');
  });
  test('documentoId repetido en dos pozos: afecta a los dos', () => {
    const d = der([propuesto(1), propuesto(1, { wellId: OTRO_POZO })]);
    expect(d.porPozo[WELL].integridad).toBe('NO_DERIVABLE');
    expect(d.porPozo[OTRO_POZO].integridad).toBe('NO_DERIVABLE');
  });
  test('un evento posterior NO puede traer metadata (ninguno de los 5 campos)', () => {
    [{ mimeType: 'image/jpeg' }, { bytes: 10 }, { sha256: sha(1) }, { storageFileId: H.storageId(1) }, { nombreOriginal: 'otro.jpg' }].forEach((extra) => {
      H.reiniciar();
      ['aprobado', 'rechazado', 'retirado'].forEach((tipo) => {
        H.reiniciar();
        const ev = tipo === 'aprobado' ? aprobado(1, null, extra) : (tipo === 'rechazado' ? rechazado(1, extra) : retirado(1, extra));
        noDerivable([propuesto(1), ev], 'METADATA_EN_EVENTO_POSTERIOR');
      });
    });
    H.reiniciar();
    noDerivable([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), revertido(1, 2, { sha256: sha(1) })], 'METADATA_EN_EVENTO_POSTERIOR');
  });
  test('metadata invalida en una propuesta (mime, bytes, hash, storage, nombre)', () => {
    [{ mimeType: 'application/pdf' }, { mimeType: '' }, { bytes: 0 }, { bytes: -5 }, { bytes: 3 * 1024 * 1024 + 1 }, { bytes: 'abc' }, { bytes: 1.5 }, { bytes: '' },
      { sha256: sha(255).toUpperCase() }, { sha256: 'abc' }, { sha256: '' }, { storageFileId: 'corto' }, { storageFileId: 'tiene/barra/xx' }, { storageFileId: '' }, { nombreOriginal: '' }].forEach((extra) => {
      H.reiniciar();
      noDerivable([propuesto(1, extra)], 'METADATA_INVALIDA');
    });
  });
  test('evento de otro pozo (wellId cruzado): afecta a los dos pozos, no al tercero', () => {
    const d = der([propuesto(1), propuesto(5, { wellId: '14-0003' }), aprobado(1, null, { wellId: OTRO_POZO })]);
    expect(d.porPozo[WELL].inconsistencias).toContain('WELL_CRUZADO');
    expect(d.porPozo[OTRO_POZO].inconsistencias).toContain('WELL_CRUZADO');
    expect(d.porPozo['14-0003'].integridad).toBe('OK');
  });
  test('un LEGACY:<otro pozo> en un evento: WELL_CRUZADO', () => {
    noDerivable([legacy(OTRO_POZO, { wellId: WELL })], 'WELL_CRUZADO');
    noDerivable([propuesto(1), aprobado(1, 'LEGACY:' + OTRO_POZO)], 'WELL_CRUZADO');
  });
  test('registro del legacy: una sola vez, solo antes de que haya vigente, sin clientRequestId y con metadata valida', () => {
    noDerivable([legacy(), legacy()], 'LEGACY_REGISTRADO_DUPLICADO');
    noDerivable([propuesto(1), aprobado(1), legacy()], 'LEGACY_REGISTRADO_CON_VIGENTE');
    noDerivable([legacy(WELL, { clientRequestId: 'req-00000001' })], 'CLIENT_REQUEST_ID_INVALIDO');
    noDerivable([legacy(WELL, { sha256: 'xx' })], 'METADATA_INVALIDA');
    noDerivable([legacy(WELL, { documentoId: doc(1) })], 'DOCUMENTO_ID_INCOHERENTE');
  });
  test('ids de documento con forma incorrecta', () => {
    noDerivable([propuesto(1, { documentoId: 'LEGACY:' + WELL })], 'DOCUMENTO_ID_INCOHERENTE');
    noDerivable([propuesto(1), aprobado(1, null, { documentoId: LEGACY_ID })], 'DOCUMENTO_ID_INCOHERENTE');
    noDerivable([propuesto(1, { documentoId: 'legacy:' + WELL })], 'DOCUMENTO_ID_INVALIDO');
    noDerivable([propuesto(1, { documentoId: '' })], 'DOCUMENTO_ID_INVALIDO');
    noDerivable([propuesto(1), aprobado(1, 'cualquier-cosa', { motivoCodigo: 'ACTUALIZACION' })], 'DOCUMENTO_REEMPLAZADO_INVALIDO');
    noDerivable([propuesto(1, { documentoReemplazadoId: doc(2) })], 'CAMPOS_INCOHERENTES');
    noDerivable([propuesto(1), rechazado(1, { documentoReemplazadoId: doc(2) })], 'CAMPOS_INCOHERENTES');
  });
  test('propuesta y registro del legacy no llevan motivo', () => {
    noDerivable([propuesto(1, { motivoCodigo: 'OTRO', motivoTexto: 'hola' })], 'CAMPOS_INCOHERENTES');
    noDerivable([legacy(WELL, { motivoTexto: 'hola' })], 'CAMPOS_INCOHERENTES');
  });
  test('timestamp invalido o no confiable (sin hora, sin zona, vacio)', () => {
    ['', 'ayer', '2026-10-28', '2026-10-28T15:00:00', '2026-10-28 15:00:00Z', '2026-13-45T25:00:00Z', null].forEach((t) => {
      H.reiniciar();
      noDerivable([propuesto(1, { timestampUtc: t })], 'TIMESTAMP_INVALIDO');
    });
    H.reiniciar();
    expect(der([propuesto(1, { timestampUtc: '2026-10-28T15:00:00Z' })]).porPozo[WELL].integridad).toBe('OK');
    H.reiniciar();
    expect(der([propuesto(1, { timestampUtc: new Date('2026-10-28T15:00:00.000Z') })]).porPozo[WELL].integridad).toBe('OK');
  });
  test('email invalido o ausente', () => {
    ['', 'sin-arroba', 'a b@x.com', null].forEach((m) => {
      H.reiniciar();
      noDerivable([propuesto(1, { email: m })], 'EMAIL_INVALIDO');
    });
  });
  test('clientRequestId invalido, o repetido por el MISMO usuario (idempotencia violada); usuarios distintos pueden repetirlo', () => {
    noDerivable([propuesto(1, { clientRequestId: 'corto' })], 'CLIENT_REQUEST_ID_INVALIDO');
    noDerivable([propuesto(1, { clientRequestId: '' })], 'CLIENT_REQUEST_ID_INVALIDO');
    H.reiniciar();
    noDerivable([propuesto(1, { clientRequestId: 'misma-req-1' }), propuesto(2, { clientRequestId: 'misma-req-1' })], 'CLIENT_REQUEST_ID_DUPLICADO');
    H.reiniciar();
    noDerivable([propuesto(1, { clientRequestId: 'misma-req-1', email: 'ANA@X.COM' }), propuesto(2, { clientRequestId: 'misma-req-1', email: 'ana@x.com' })], 'CLIENT_REQUEST_ID_DUPLICADO');
    H.reiniciar();
    expect(der([propuesto(1, { clientRequestId: 'misma-req-1', email: 'ana@x.com' }), propuesto(2, { clientRequestId: 'misma-req-1', email: 'otra@x.com' })]).porPozo[WELL].integridad).toBe('OK');
  });
  test('filas rotas: sin pozo atribuible quedan como globales y no afectan a nadie; con documento conocido se atribuyen a su pozo', () => {
    const d = der([propuesto(1), null, undefined, 'texto', { evento: 'ITF_APROBADO', wellId: 'xx', documentoId: uuid(77) }]);
    expect(d.porPozo[WELL].integridad).toBe('OK');
    expect(d.globales.map((g) => g.codigo)).toEqual(['FILA_ROTA', 'FILA_ROTA', 'FILA_ROTA', 'WELL_ID_INVALIDO']);
    const e = der([propuesto(1), { evento: 'ITF_APROBADO', wellId: 'xx', documentoId: doc(1) }]);
    expect(e.porPozo[WELL].inconsistencias).toContain('WELL_ID_INVALIDO');
  });
  test('AISLAMIENTO: un pozo corrupto no rompe a los demas ni a los que no tienen eventos', () => {
    const eventos = [propuesto(1), aprobado(1), aprobado(1), propuesto(2, { wellId: OTRO_POZO }), aprobado(2, null, { wellId: OTRO_POZO })];
    const d = der(eventos);
    expect(D.itfDominio_estadoPozo(WELL, d, true)).toMatchObject({ integridad: 'NO_DERIVABLE', tieneItf: 'DESCONOCIDO', estado: null, vigente: null });
    expect(D.itfDominio_estadoPozo(OTRO_POZO, d, false)).toMatchObject({ integridad: 'OK', tieneItf: 'SI', estado: 'VIGENTE' });
    expect(D.itfDominio_estadoPozo('01-0001', d, true)).toMatchObject({ integridad: 'OK', tieneItf: 'SI' });
  });
  test('un pozo no derivable NO afirma Tiene ITF aunque el legacy exista (fail-closed)', () => {
    const e = est([propuesto(1), aprobado(1), aprobado(1)], true);
    expect(e.tieneItf).toBe('DESCONOCIDO');
    expect(D.itfTieneVigente(WELL, der([propuesto(1), aprobado(1), aprobado(1)]), true)).toBe(false);
    expect(D.itfDominio_documentoParaDescarga(e)).toBeNull();
  });
  test('la derivacion no se rompe con una hoja enorme de pozos sanos y uno roto', () => {
    const eventos = [];
    for (let i = 0; i < 200; i += 1) {
      const w = '10-' + String(i).padStart(4, '0');
      eventos.push(propuesto(1000 + i * 2, { wellId: w }));
      eventos.push(aprobado(1000 + i * 2, null, { wellId: w }));
    }
    eventos.push(aprobado(5000));
    const d = der(eventos);
    expect(Object.keys(d.porPozo)).toHaveLength(201);
    expect(Object.values(d.porPozo).filter((p) => p.integridad === 'OK')).toHaveLength(200);
  });
});

describe('contrato "Tiene ITF": existe un ITF VIGENTE valido', () => {
  const casos = [
    ['legacy implicito presente', [], true, 'SI'],
    ['legacy ausente', [], false, 'NO'],
    ['legacy desconocido', [], null, 'DESCONOCIDO'],
    ['solo una propuesta pendiente (sin legacy)', [propuesto(1)], false, 'NO'],
    ['propuesta rechazada (sin legacy)', [propuesto(1), rechazado(1)], false, 'NO'],
    ['vigente E9', [propuesto(1), aprobado(1)], false, 'SI'],
    ['vigente retirado', [propuesto(1), aprobado(1), retirado(1)], false, 'NO'],
    ['vigente reemplazado por otro (el nuevo cuenta)', [propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1)], false, 'SI'],
    ['legacy retirado con el archivo todavia en la carpeta', [legacy(), retirado(LEGACY_ID)], true, 'NO'],
    ['legacy registrado y vigente, archivo presente', [legacy()], true, 'SI'],
    ['historial corrupto', [propuesto(1), aprobado(2)], true, 'DESCONOCIDO']
  ];
  test.each(casos)('%s', (nombre, eventos, legacyDisp, esperado) => {
    H.reiniciar();
    const evs = eventos.map((e) => e);
    const d = der(evs);
    expect(D.itfDominio_tieneItf(WELL, d, legacyDisp)).toBe(esperado);
    expect(D.itfTieneVigente(WELL, d, legacyDisp)).toBe(esperado === 'SI');
  });
  test('itfTieneVigente devuelve un booleano estricto', () => {
    expect(D.itfTieneVigente(WELL, der([]), true)).toBe(true);
    expect(D.itfTieneVigente(WELL, der([]), null)).toBe(false);
  });
  test('descarga / ZIP: solo el vigente; propuestas, rechazados, historicos y retirados nunca', () => {
    const e = est([propuesto(1), aprobado(1), propuesto(2), aprobado(2, 1), propuesto(3), propuesto(4), rechazado(4), propuesto(5), retirado(5)], false);
    expect(D.itfDominio_documentoParaDescarga(e)).toEqual({ documentoId: doc(2), origen: 'E9' });
    const sinVigente = est([propuesto(1), propuesto(2), rechazado(2)], false);
    expect(D.itfDominio_documentoParaDescarga(sinVigente)).toBeNull();
    expect(D.itfDominio_documentoParaDescarga(est([], null))).toBeNull();
    expect(D.itfDominio_documentoParaDescarga(null)).toBeNull();
  });
});

describe('PRIVACIDAD: ni email, ni storageFileId, ni hash completo, ni clientRequestId, ni secuencia hacia el cliente', () => {
  const eventos = () => {
    H.reiniciar();
    return [propuesto(1, { email: 'ana.secreta@x.com', nombre: 'Ana' }), legacy(), aprobado(1, LEGACY_ID, { email: 'val.secreto@x.com', nombre: 'Valeria' }), propuesto(2, { email: 'otra.secreta@x.com', nombre: 'otra.secreta@x.com' }), propuesto(3), rechazado(3)];
  };
  const prohibidos = ['secreta', 'val.secreto', H.storageId(1), H.storageId(2), H.storageId(9000), sha(1), sha(2), sha(9000), 'req-0000', '"secuencia"', 'storageFileId', 'clientRequestId', 'email'];

  test('DTO de lectura: solo tieneItf, estado y el vigente (documentoId, origen, mime, bytes, desde)', () => {
    const e = est(eventos(), true);
    const dto = D.itfDominio_dtoLectura(e);
    expect(Object.keys(dto).sort()).toEqual(['estado', 'tieneItf', 'vigente', 'wellId']);
    expect(Object.keys(dto.vigente).sort()).toEqual(['bytes', 'desde', 'documentoId', 'mimeType', 'origen']);
    const json = JSON.stringify(dto);
    prohibidos.forEach((p) => expect(json).not.toContain(p));
    ['propuest', 'rechaz', 'historial', 'Ana', 'Valeria', 'autoaprobado', 'itf-2.jpg'].forEach((p) => expect(json).not.toContain(p));
  });
  test('DTO de lectura de un pozo sin ITF o no derivable: sin detalle de la inconsistencia', () => {
    expect(D.itfDominio_dtoLectura(est([], false))).toEqual({ wellId: WELL, tieneItf: 'NO', estado: 'SIN_ITF', vigente: null });
    const roto = D.itfDominio_dtoLectura(est([aprobado(9)], true));
    expect(roto).toEqual({ wellId: WELL, tieneItf: 'DESCONOCIDO', estado: null, vigente: null });
    expect(JSON.stringify(roto)).not.toMatch(/DOCUMENTO_INEXISTENTE|inconsistencias/);
  });
  test('DTO del validador: pendientes, historicos, rechazados y historial con nombres y huella corta, sin los datos internos', () => {
    const e = est(eventos(), true);
    const dto = D.itfDominio_dtoValidador(e);
    expect(dto.vigente).toMatchObject({ documentoId: doc(1), propuestoPor: 'Ana', aprobadoPor: 'Valeria', autoaprobado: false, reemplazaA: LEGACY_ID });
    expect(dto.vigente.huella).toBe(sha(1).slice(0, D.ITF_HUELLA_LARGO || 12));
    expect(dto.vigente.huella).toHaveLength(12);
    expect(dto.propuestasPendientes.map((d) => d.documentoId)).toEqual([doc(2)]);
    expect(dto.historicos.map((d) => d.documentoId)).toEqual([LEGACY_ID]);
    expect(dto.rechazados.map((d) => d.documentoId)).toEqual([doc(3)]);
    expect(dto.historial).toHaveLength(6);
    const json = JSON.stringify(dto);
    prohibidos.forEach((p) => expect(json).not.toContain(p));
  });
  test('un nombre que parece un email se muestra neutro', () => {
    const dto = D.itfDominio_dtoValidador(est(eventos(), true));
    expect(dto.propuestasPendientes[0].propuestoPor).toBe('Usuario');
  });
  test('el estado INTERNO si lleva storageFileId y hash (lo necesita el backend), pero los DTO no', () => {
    const e = est(eventos(), true);
    expect(e.vigente.storageFileId).toBe(H.storageId(1));
    expect(e.vigente.sha256).toBe(sha(1));
  });
  test('la derivacion no guarda el email en ningun lado', () => {
    const d = der(eventos());
    expect(JSON.stringify(d)).not.toMatch(/ana\.secreta|val\.secreto/);
    expect(JSON.stringify(d)).not.toContain('"actor"');
    expect(JSON.stringify(d)).not.toContain('"email"');
  });
  test('el documento legacy implicito no expone datos que no tiene', () => {
    const dto = D.itfDominio_dtoValidador(est([], true));
    expect(dto.vigente).toMatchObject({ documentoId: LEGACY_ID, origen: 'LEGACY', mimeType: null, bytes: null, huella: null, propuestoPor: null, aprobadoPor: null, autoaprobado: false });
  });
  test('el DTO de lectura no cambia con la autoaprobacion ni con las propuestas', () => {
    const a = D.itfDominio_dtoLectura(est([propuesto(1), aprobado(1)], false));
    H.reiniciar();
    const b = D.itfDominio_dtoLectura(est([propuesto(1, { email: 'ana@x.com' }), aprobado(1, null, { email: 'ana@x.com' }), propuesto(2)], false));
    expect(Object.keys(a)).toEqual(Object.keys(b));
    expect(JSON.stringify(b)).not.toContain('autoaprobado');
  });
});

describe('PERMISOS (exactos, fail-closed)', () => {
  const p = (extra) => Object.assign({ perfil: true }, extra);
  test('proponer: perfil + perfil_subir', () => {
    expect(D.itfDominio_puede('PROPONER', p({ perfil_subir: true }))).toBe(true);
    expect(D.itfDominio_puede('PROPONER', p({ perfil_validar: true }))).toBe(false);
    expect(D.itfDominio_puede('PROPONER', { perfil_subir: true })).toBe(false);
    expect(D.itfDominio_puede('PROPONER', { perfil: false, perfil_subir: true })).toBe(false);
  });
  test('aprobar, rechazar, retirar y revertir: perfil + perfil_validar', () => {
    ['APROBAR', 'RECHAZAR', 'RETIRAR', 'REVERTIR'].forEach((a) => {
      expect(D.itfDominio_puede(a, p({ perfil_validar: true }))).toBe(true);
      expect(D.itfDominio_puede(a, p({ perfil_subir: true }))).toBe(false);
      expect(D.itfDominio_puede(a, { perfil_validar: true })).toBe(false);
    });
  });
  test('la autoaprobacion exige AMBOS permisos', () => {
    const ambos = p({ perfil_subir: true, perfil_validar: true });
    expect(D.itfDominio_puede('PROPONER', ambos) && D.itfDominio_puede('APROBAR', ambos)).toBe(true);
    expect(D.itfDominio_puede('PROPONER', p({ perfil_validar: true })) && D.itfDominio_puede('APROBAR', p({ perfil_validar: true }))).toBe(false);
  });
  test('solo el booleano true cuenta (nada de "SI", 1, "true", objetos)', () => {
    ['SI', 'si', 1, 'true', {}, [], null, undefined, 0, ''].forEach((v) => {
      expect(D.itfDominio_puede('PROPONER', { perfil: v, perfil_subir: true })).toBe(false);
      expect(D.itfDominio_puede('PROPONER', { perfil: true, perfil_subir: v })).toBe(false);
      expect(D.itfDominio_puede('APROBAR', { perfil: true, perfil_validar: v })).toBe(false);
    });
  });
  test('acciones desconocidas o permisos ausentes: false', () => {
    ['', 'BORRAR', 'PROPONER_Y_APROBAR', null, undefined, 5].forEach((a) => expect(D.itfDominio_puede(a, p({ perfil_subir: true, perfil_validar: true }))).toBe(false));
    [null, undefined, 'x', 5].forEach((permisos) => expect(D.itfDominio_puede('PROPONER', permisos)).toBe(false));
  });
});
