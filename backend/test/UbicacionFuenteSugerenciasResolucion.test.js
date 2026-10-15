// Resolucion de SUGERENCIAS: aprobar (produce una decision REAL con el mismo nucleo autoritativo de decidirFuenteUbicacion), rechazar, cancelar, obsolescencia por cambio de estado
// o reindexado, recuperacion ante un corte ENTRE las dos escrituras de una aprobacion, concurrencia bajo lock, secuencia y cache.
const fs = require('fs');
const path = require('path');
const { armarSug, W, LEE, ANA, VAL, VERO, REP, I1, I2, P_REPORTE } = require('./sugerenciasHelper');
const { solicitud } = require('./decisionesFuentesHelper');

let t;
beforeEach(() => { t = armarSug(); });
afterEach(() => { jest.restoreAllMocks(); });

const idsDec = () => t.filasDec().map((f) => f.clientRequestId);
const evSug = () => t.filasSug().map((f) => f.evento);
const sinCambios = (fn) => {
  const antes = JSON.stringify([t.filasSug(), t.filasDec()]);
  fn();
  expect(JSON.stringify([t.filasSug(), t.filasDec()])).toBe(antes);
};

describe('aprobar: produce la decision REAL y el evento APROBADA', () => {
  test('ACEPTAR: crea la decision (con el motivo de la sugerencia, el validador como autor y clientRequestId sug-<id>), escribe APROBADA y la fuente queda ACEPTADA', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', motivo: 'es la buena', ...I1 });
    const id = t.idDe(s);
    const r = t.resolver(id, { motivo: 'validado en gabinete' });
    expect(r).toMatchObject({ ok: true, duplicada: false, resultado: 'APROBADA', wellId: W, auditoria: 'FUENTE_SUGERENCIA_APROBADA', auditoriaDecision: 'FUENTE_ACEPTADA', curada: false });
    expect(r.sugerencia).toMatchObject({ sugerenciaId: id, estado: 'APROBADA', resolucion: { evento: 'APROBADA', nombre: 'Valeria Validadora', motivo: 'validado en gabinete' } });
    expect(t.filasDec()).toHaveLength(1);
    expect(t.filasDec()[0]).toMatchObject({ evento: 'ACEPTADA', email: VAL, nombre: 'Valeria Validadora', clientRequestId: 'sug-' + id, motivo: 'es la buena', wellId: W, versionVista: 0 });
    expect(evSug()).toEqual(['PROPUESTA', 'APROBADA']);
    expect(t.filasSug()[1]).toMatchObject({ sugerenciaId: id, email: VAL, motivo: 'validado en gabinete', wellId: W, fuenteTipo: 'IRRIGACION', accionSugerida: 'ACEPTAR' });
    expect(r.decision).toMatchObject({ evento: 'ACEPTADA', nombre: 'Valeria Validadora' });
    expect(r.data.fuentes.filter((f) => f.x === I1.x)[0].estado).toBe('ACEPTADA');
    expect(t.vistaDecisiones().fuentes.filter((f) => f.x === I1.x)[0].estado).toBe('ACEPTADA');
  });

  test('DESCARTAR: la decision lleva el motivo de la sugerencia (obligatorio); RESTAURAR: vuelve a SIN_REVISAR (no queda aceptada)', () => {
    const d = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'cae en el rio', ...I2 });
    expect(t.resolver(t.idDe(d)).ok).toBe(true);
    expect(t.filasDec()[0]).toMatchObject({ evento: 'DESCARTADA', motivo: 'cae en el rio' });
    const rst = t.sugerir({ accionSugerida: 'RESTAURAR', ...I2 });
    const r = t.resolver(t.idDe(rst));
    expect(r).toMatchObject({ ok: true, resultado: 'APROBADA', auditoriaDecision: 'FUENTE_RESTAURADA' });
    expect(t.vistaDecisiones().fuentes.filter((f) => f.x === I2.x)[0].estado).toBe('SIN_REVISAR');
  });

  test('usa el MISMO nucleo autoritativo que decidirFuenteUbicacion (aplicarDecision) y el MISMO dominio (ufd_decidir); nunca escribe una decision por su cuenta', () => {
    const aplicar = jest.fn(global.ubicacionFuenteDecisionesService_aplicarDecision);
    global.ubicacionFuenteDecisionesService_aplicarDecision = aplicar;
    const ufd = jest.fn(global.ufd_decidir);
    global.ufd_decidir = ufd;
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP });
    ufd.mockClear();            // (sugerir consulta el dominio en seco para validar que la sugerencia sea razonable)
    t.resolver(t.idDe(s));                                                           // camino por sugerencia
    expect(aplicar).toHaveBeenCalledTimes(1);
    expect(aplicar.mock.calls[0][0]).toBe(VAL);                                       // email del VALIDADOR
    expect(aplicar.mock.calls[0][2]).toMatchObject({ wellId: W, decision: 'ACEPTAR', clientRequestId: 'sug-' + t.idDe(s) });
    expect(ufd).toHaveBeenCalledTimes(1);                                             // el dominio se consulta UNA vez dentro del nucleo
    // el camino directo usa exactamente la misma funcion (esta definida en el servicio de decisiones y decidirFuenteUbicacion la llama)
    const fuenteDec = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteDecisionesService.js'), 'utf8');
    expect(fuenteDec).toMatch(/return ubicacionFuenteDecisionesService_aplicarDecision\(emailN, nombre, s, filas, padron\);/);
    const fuenteSug = fs.readFileSync(path.join(__dirname, '..', 'src', 'UbicacionFuenteSugerenciasService.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuenteSug).not.toMatch(/ubicacionFuenteDecisionesRepository_agregar\(/);    // jamas escribe decisiones directamente
    expect(fuenteSug).toMatch(/ubicacionFuenteDecisionesService_aplicarDecision\(/);
  });

  test('con una VALIDADA EN CAMPO vigente la decision registral se crea igual (la prioridad operativa es de la validada; no se mira ni se toca)', () => {
    global.ubicacionCorreccionService_getPorPozo = jest.fn(() => ({ ok: true, data: { vigente: { lat: -33.3, lon: -69.1, estado: 'VALIDADA' } } }));
    global.ubicacionCorreccionService_proponer = jest.fn();
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    const r = t.resolver(t.idDe(s));
    expect(r).toMatchObject({ ok: true, resultado: 'APROBADA' });
    expect(t.filasDec()).toHaveLength(1);
    expect(global.ubicacionCorreccionService_getPorPozo).not.toHaveBeenCalled();
    expect(global.ubicacionCorreccionService_proponer).not.toHaveBeenCalled();
  });

  test('la sugerencia por si sola NO cambia nada; recien al aprobar cambia la resolucion registral', () => {
    const antes = t.vistaDecisiones().resolucion;
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'x', ...REP });
    expect(t.vistaDecisiones().resolucion).toEqual(antes);
    t.resolver(t.idDe(s));
    expect(t.vistaDecisiones().resolucion).not.toEqual(antes);
  });

  test('NO se confia en la versionVista vieja de quien sugirio: se aprueba con la version ACTUAL aunque la sugerencia se haya hecho con otra', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP, versionVista: 0 });
    t.decidirDirecto('ACEPTAR', I1);
    t.decidirDirecto('DESCARTAR', I2);                                                // el pozo ya va por la version 2
    const r = t.resolver(t.idDe(s), { versionVista: 2 });
    expect(r.ok).toBe(true);
    expect(t.filasDec().filter((f) => f.clientRequestId === 'sug-' + t.idDe(s))[0].versionVista).toBe(2);
    expect(t.filasSug()[0].versionVista).toBe(0);                                      // lo que vio el proponente queda como auditoria
  });

  test('la versionVista del VALIDADOR vieja: STALE_STATE con la version actual y no se escribe nada; con la correcta se aprueba', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('ACEPTAR', I1);
    sinCambios(() => {
      expect(t.resolver(t.idDe(s), { versionVista: 0 })).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: 1 });
    });
    expect(t.resolver(t.idDe(s), { versionVista: 1 }).ok).toBe(true);
  });

  test('versionVista del validador invalida al APROBAR: INVALID_VERSION (al rechazar no hace falta)', () => {
    const s = t.sugerir({});
    [undefined, null, -1, 1.5, '1', NaN].forEach((v) => expect(t.resolver(t.idDe(s), { versionVista: v })).toMatchObject({ ok: false, code: 'INVALID_VERSION' }));
    expect(t.rechazar(t.idDe(s)).ok).toBe(true);
  });

  test('el aprobador puede ser quien mas tarde ve la sugerencia de otro; aprobar lo propio tambien se permite (decide como validador)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' }, VAL);
    expect(t.resolver(t.idDe(s), {}, VAL).ok).toBe(true);
  });
});

describe('aprobar cuando lo sugerido ya no corresponde o la fuente desaparecio: OBSOLETA (sin aplicar nada)', () => {
  test.each([
    ['ACEPTAR y la fuente ya fue aceptada', 'ACEPTAR', () => t.decidirDirecto('ACEPTAR', REP), 'YA_ESTA_ASI'],
    ['DESCARTAR y la fuente ya fue descartada', 'DESCARTAR', () => t.decidirDirecto('DESCARTAR', REP), 'YA_ESTA_ASI'],
    ['ACEPTAR y la fuente fue descartada (primero hay que restaurar)', 'ACEPTAR', () => t.decidirDirecto('DESCARTAR', REP), 'YA_NO_CORRESPONDE']
  ])('%s', (_n, accion, mover, motivoNo) => {
    const s = t.sugerir({ accionSugerida: accion, motivo: 'm', ...REP });
    mover();
    const decisionesAntes = t.filasDec().length;
    const r = t.resolver(t.idDe(s));
    expect(r).toMatchObject({ ok: true, resultado: 'OBSOLETA', motivoNoAplicable: motivoNo, auditoria: 'FUENTE_SUGERENCIA_OBSOLETA' });
    expect(r.sugerencia.estado).toBe('OBSOLETA');
    expect(t.filasDec()).toHaveLength(decisionesAntes);                                // NO se creo ninguna decision
    expect(evSug()).toEqual(['PROPUESTA', 'OBSOLETA']);
  });

  test('RESTAURAR cuando ya fue restaurada: OBSOLETA', () => {
    t.decidirDirecto('DESCARTAR', REP);
    const s = t.sugerir({ accionSugerida: 'RESTAURAR', ...REP });
    t.decidirDirecto('RESTAURAR', REP);
    expect(t.resolver(t.idDe(s))).toMatchObject({ ok: true, resultado: 'OBSOLETA', motivoNoAplicable: 'YA_ESTA_ASI' });
  });

  test('REINDEXADO: la coordenada ya no existe -> OBSOLETA FUENTE_NO_EXISTE; la sugerencia NUNCA se transfiere a una fuente nueva', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I1 });
    t.padron[W].coordenadasProvincia = [{ x: 2490000, y: 6311000 }, { ...I2 }];      // I1 desaparece; aparece otra fuente "en el mismo lugar" de la lista
    const decisionesAntes = JSON.stringify(t.filasDec());
    const r = t.resolver(t.idDe(s));
    expect(r).toMatchObject({ ok: true, resultado: 'OBSOLETA', motivoNoAplicable: 'FUENTE_NO_EXISTE' });
    expect(JSON.stringify(t.filasDec())).toBe(decisionesAntes);
    expect(t.vistaDecisiones().fuentes.every((f) => f.estado === 'SIN_REVISAR')).toBe(true);        // la fuente nueva quedo SIN_REVISAR
  });

  test('si el pozo ya no esta en el padron: OBSOLETA (no hay a quien aplicarla)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.padron[W] = undefined;
    expect(t.resolver(t.idDe(s))).toMatchObject({ ok: true, resultado: 'OBSOLETA', motivoNoAplicable: 'FUENTE_NO_EXISTE' });
    expect(t.filasDec()).toHaveLength(0);
  });

  test('la obsoleta queda auditada (evento OBSOLETA con el validador) y ya no es pendiente ni cuenta para el limite', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.decidirDirecto('ACEPTAR', REP);
    t.resolver(t.idDe(s));
    expect(t.filasSug()[1]).toMatchObject({ evento: 'OBSOLETA', email: VAL });
    expect(t.verCola().data.total).toBe(0);
    expect(t.verCola().data.pendientes).toHaveLength(0);
  });

  test('si cambio la version del pozo Y la accion ya no aplica, el validador primero ve STALE_STATE; con la version nueva recien se marca OBSOLETA', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('ACEPTAR', REP);
    expect(t.resolver(t.idDe(s), { versionVista: 0 })).toMatchObject({ ok: false, code: 'STALE_STATE' });
    expect(t.resolver(t.idDe(s), { versionVista: 1 })).toMatchObject({ ok: true, resultado: 'OBSOLETA' });
  });

  test('pozo con historial inconsistente: INCONSISTENT_STATE y no se escribe nada (no se marca obsoleta a ciegas)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'd', secuencia: 1, wellId: W, fuenteTipo: 'REPORTE_POZOS', x: REP.x, y: REP.y, evento: 'RESTAURADA', email: 'x@x.com', nombre: 'X', timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'corrupto-3', versionVista: 0, padronPeriodo: '2026-09' }[c])));
    t.cache.store = {};
    sinCambios(() => {
      expect(t.resolver(t.idDe(s), { versionVista: 1 })).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    });
  });
});

describe('aprobar: errores de forma y de estado de la sugerencia', () => {
  test('sugerencia inexistente / id invalido / ya resuelta', () => {
    expect(t.resolver('no-existe-0001')).toMatchObject({ ok: false, code: 'SUGGESTION_NOT_FOUND' });
    ['', 'x', null, undefined, 5, {}, ['a'], 'a'.repeat(65), 'con espacio 1', '../../etc'].forEach((id) => expect(t.resolver(id)).toMatchObject({ ok: false, code: 'INVALID_SUGERENCIA_ID' }));
    const s = t.sugerir({});
    t.resolver(t.idDe(s));
    expect(t.resolver(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'APROBADA' });
    expect(t.rechazar(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED' });
    expect(t.filasDec()).toHaveLength(1);
  });

  test('resolucion invalida y clientRequestId invalido', () => {
    const s = t.sugerir({});
    ['', 'aprobar', 'APROBAR ', null, undefined, 5, {}, ['APROBAR'], '__proto__', 'constructor'].forEach((x) => expect(t.resolver(t.idDe(s), { resolucion: x })).toMatchObject({ ok: false, code: 'INVALID_RESOLUCION' }));
    ['', 'corto', null, undefined, 5, 'con espacios en el id', 'x'.repeat(65)].forEach((x) => expect(t.resolver(t.idDe(s), { clientRequestId: x })).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' }));
    expect(t.filasSug()).toHaveLength(1);
  });

  test('motivo de la aprobacion: opcional, limitado y limpio', () => {
    const s = t.sugerir({});
    expect(t.resolver(t.idDe(s), { motivo: 'x'.repeat(301) })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(t.resolver(t.idDe(s), { motivo: 5 })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(t.resolver(t.idDe(s), { motivo: '' }).ok).toBe(true);
  });

  test('un clientRequestId "sug-..." reservado NO se puede usar en decidirFuenteUbicacion (lo escribe solo el servidor)', () => {
    const r = t.S.ubicacionFuenteDecisionesService_decidir(VAL, 'V', solicitud({ wellId: W, ...REP, accion: 'ACEPTAR', versionVista: 0, clientRequestId: 'sug-abcdefgh-1234' }));
    expect(r).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' });
    expect(t.filasDec()).toHaveLength(0);
  });
});

describe('idempotencia de resolver (por usuario)', () => {
  test('el mismo pedido repetido: duplicada:true, mismo resultado, ni una fila mas', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    const p = { clientRequestId: 'req-res-idem-1', versionVista: 0 };
    const a = t.resolver(t.idDe(s), p);
    const b = t.resolver(t.idDe(s), p);
    expect(a.resultado).toBe('APROBADA');
    expect(b).toMatchObject({ ok: true, duplicada: true, resultado: 'APROBADA' });
    expect(t.filasSug()).toHaveLength(2);
    expect(t.filasDec()).toHaveLength(1);
  });

  test('un reintento de una aprobacion que termino OBSOLETA devuelve OBSOLETA (no la vuelve a intentar)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('ACEPTAR', REP);
    const p = { clientRequestId: 'req-res-idem-2', versionVista: 1 };
    expect(t.resolver(t.idDe(s), p).resultado).toBe('OBSOLETA');
    expect(t.resolver(t.idDe(s), p)).toMatchObject({ ok: true, duplicada: true, resultado: 'OBSOLETA' });
  });

  test('mismo clientRequestId con otro contenido (otra resolucion, otro motivo, otra version, otra sugerencia): IDEMPOTENCY_CONFLICT', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    const s2 = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    t.resolver(t.idDe(s), { clientRequestId: 'req-res-idem-3', motivo: 'a' });
    expect(t.rechazar(t.idDe(s), { clientRequestId: 'req-res-idem-3' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.resolver(t.idDe(s), { clientRequestId: 'req-res-idem-3', motivo: 'b' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.resolver(t.idDe(s), { clientRequestId: 'req-res-idem-3', motivo: 'a', versionVista: 9 })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.resolver(t.idDe(s2), { clientRequestId: 'req-res-idem-3', motivo: 'a' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('una solicitud rechazada antes de escribir no consume el id', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    expect(t.rechazar(t.idDe(s), { clientRequestId: 'req-res-idem-4', motivo: '' }).ok).toBe(false);
    expect(t.rechazar(t.idDe(s), { clientRequestId: 'req-res-idem-4', motivo: 'ahora si' }).ok).toBe(true);
  });

  test('el id es POR USUARIO: otro validador puede usar el mismo clientRequestId', () => {
    const a = t.sugerir({ accionSugerida: 'ACEPTAR' });
    const b = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    expect(t.resolver(t.idDe(a), { clientRequestId: 'req-res-comun-9' }, VAL).ok).toBe(true);
    expect(t.resolver(t.idDe(b), { clientRequestId: 'req-res-comun-9', versionVista: 1 }, VERO).ok).toBe(true);
  });
});

describe('rechazar', () => {
  test('motivo OBLIGATORIO: sin motivo no se escribe nada', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    sinCambios(() => {
      ['', '   ', undefined, null].forEach((m) => expect(t.rechazar(t.idDe(s), { motivo: m })).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' }));
    });
  });

  test('escribe RECHAZADA con el motivo y el validador; NO crea decision, no cambia la fuente ni el punto operativo; el autor ve el motivo', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'creo que esta mal', ...I1 });
    const antes = JSON.stringify(t.vistaDecisiones());
    const r = t.rechazar(t.idDe(s), { motivo: 'esta bien ubicada' }, VERO);
    expect(r).toMatchObject({ ok: true, resultado: 'RECHAZADA', auditoria: 'FUENTE_SUGERENCIA_RECHAZADA' });
    expect(t.filasSug()[1]).toMatchObject({ evento: 'RECHAZADA', email: VERO, nombre: 'Vero Validadora', motivo: 'esta bien ubicada', versionVista: '' === '' ? t.filasSug()[1].versionVista : 0 });
    expect(t.filasDec()).toHaveLength(0);
    expect(JSON.stringify(t.vistaDecisiones())).toBe(antes);
    const mia = t.verPozo(LEE, false).data.sugerencias[0];
    expect(mia).toMatchObject({ estado: 'RECHAZADA', resolucion: { motivo: 'esta bien ubicada', nombre: 'Vero Validadora' } });
    expect(t.verCola().data.total).toBe(0);
  });

  test('se puede rechazar una sugerencia que ya no es aplicable (para limpiar la cola)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('ACEPTAR', REP);
    expect(t.rechazar(t.idDe(s)).resultado).toBe('RECHAZADA');
  });

  test('despues de rechazar, el autor puede volver a sugerir lo mismo', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.rechazar(t.idDe(s));
    expect(t.sugerir({ accionSugerida: 'ACEPTAR' }).ok).toBe(true);
  });

  test('reintento idempotente del rechazo', () => {
    const s = t.sugerir({});
    const p = { clientRequestId: 'req-rech-1', motivo: 'no' };
    t.rechazar(t.idDe(s), p);
    expect(t.rechazar(t.idDe(s), p)).toMatchObject({ ok: true, duplicada: true, resultado: 'RECHAZADA' });
    expect(t.filasSug()).toHaveLength(2);
  });
});

describe('cancelar', () => {
  test('el AUTOR cancela mientras sigue PENDIENTE: escribe CANCELADA, no toca las decisiones y la libera del limite', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    const r = t.cancelar(t.idDe(s), { motivo: 'me equivoque' });
    expect(r).toMatchObject({ ok: true, duplicada: false, auditoria: 'FUENTE_SUGERENCIA_CANCELADA', wellId: W });
    expect(r.sugerencia.estado).toBe('CANCELADA');
    expect(t.filasSug()[1]).toMatchObject({ evento: 'CANCELADA', email: LEE, motivo: 'me equivoque' });
    expect(t.filasDec()).toHaveLength(0);
    expect(t.verCola().data.total).toBe(0);
  });

  test('NO el autor (otro usuario, otro que no valida, o un validador): SUGGESTION_NOT_FOUND y no se escribe', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' }, LEE);
    sinCambios(() => {
      expect(t.cancelar(t.idDe(s), {}, ANA)).toMatchObject({ ok: false, code: 'SUGGESTION_NOT_FOUND' });
      expect(t.cancelar(t.idDe(s), {}, VAL)).toMatchObject({ ok: false, code: 'SUGGESTION_NOT_FOUND' });
    });
  });

  test('un validador que sugirio algo puede cancelar lo SUYO', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' }, VAL);
    expect(t.cancelar(t.idDe(s), {}, VAL).ok).toBe(true);
  });

  test('ya resuelta (aprobada, rechazada, cancelada, obsoleta): ALREADY_RESOLVED con el estado', () => {
    const a = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.resolver(t.idDe(a));
    const b = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    t.rechazar(t.idDe(b));
    const c = t.sugerir({ accionSugerida: 'ACEPTAR', ...I2 });
    t.cancelar(t.idDe(c));
    expect(t.cancelar(t.idDe(a))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'APROBADA' });
    expect(t.cancelar(t.idDe(b))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'RECHAZADA' });
    expect(t.cancelar(t.idDe(c))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'CANCELADA' });
  });

  test('inexistente o id invalido', () => {
    expect(t.cancelar('no-existe-0001')).toMatchObject({ ok: false, code: 'SUGGESTION_NOT_FOUND' });
    expect(t.cancelar('x')).toMatchObject({ ok: false, code: 'INVALID_SUGERENCIA_ID' });
    expect(t.cancelar(null)).toMatchObject({ ok: false, code: 'INVALID_SUGERENCIA_ID' });
  });

  test('idempotente: el mismo pedido es duplicada:true; con otro contenido, IDEMPOTENCY_CONFLICT', () => {
    const s = t.sugerir({});
    const p = { clientRequestId: 'req-canc-1', motivo: 'a' };
    t.cancelar(t.idDe(s), p);
    expect(t.cancelar(t.idDe(s), p)).toMatchObject({ ok: true, duplicada: true });
    expect(t.cancelar(t.idDe(s), { clientRequestId: 'req-canc-1', motivo: 'b' })).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(t.filasSug()).toHaveLength(2);
  });

  test('una vez cancelada ya no se puede aprobar ni rechazar', () => {
    const s = t.sugerir({});
    t.cancelar(t.idDe(s));
    expect(t.resolver(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'CANCELADA' });
    expect(t.rechazar(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED' });
    expect(t.filasDec()).toHaveLength(0);
  });
});

describe('CORTE entre las dos escrituras de una aprobacion (decision escrita, falta el evento APROBADA)', () => {
  function cortarEventoAprobada() {
    const original = global.ubicacionFuenteSugerenciasRepository_agregar;
    const estado = { falla: true };
    global.ubicacionFuenteSugerenciasRepository_agregar = jest.fn((fila) => {
      if (estado.falla && fila.evento === 'APROBADA') { throw new Error('Sheets caido'); }
      return original(fila);
    });
    return estado;
  }

  test('el corte deja la decision escrita y SIN evento; el lock se libera', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 });
    cortarEventoAprobada();
    expect(() => t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-1' })).toThrow(/Sheets caido/);
    expect(idsDec()).toEqual(['sug-' + t.idDe(s)]);
    expect(evSug()).toEqual(['PROPUESTA']);
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });

  test('mientras tanto la sugerencia se LEE como APROBADA (autocuracion): sale de la cola y del limite, y el autor la ve aprobada', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 });
    cortarEventoAprobada();
    expect(() => t.resolver(t.idDe(s))).toThrow();
    expect(t.verCola().data).toMatchObject({ total: 0, pendientes: [] });
    expect(t.verPozo(LEE, false).data.sugerencias[0]).toMatchObject({ sugerenciaId: t.idDe(s), estado: 'APROBADA' });
    t.sembrar(...Array.from({ length: 9 }, () => ({ email: LEE })));
    expect(t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);                          // no cuenta como pendiente: aun hay lugar
  });

  test('el REINTENTO cura: completa solo el evento APROBADA, NO crea otra decision y devuelve la decision original', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 });
    const corte = cortarEventoAprobada();
    expect(() => t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-2' })).toThrow();
    corte.falla = false;
    const r = t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-2' });
    expect(r).toMatchObject({ ok: true, resultado: 'APROBADA', curada: true, duplicada: false });
    expect(r.decision).toMatchObject({ evento: 'DESCARTADA' });
    expect(t.filasDec()).toHaveLength(1);                                                            // UNA sola decision
    expect(evSug()).toEqual(['PROPUESTA', 'APROBADA']);
    expect(t.filasSug()[1]).toMatchObject({ clientRequestId: 'req-res-corte-2', email: VAL });
    const otra = t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-2' });                      // y un tercer intento ya es un duplicado
    expect(otra).toMatchObject({ ok: true, duplicada: true, resultado: 'APROBADA' });
    expect(t.filasSug()).toHaveLength(2);
    expect(t.filasDec()).toHaveLength(1);
  });

  test('el reintento lo puede completar OTRO validador (otro clientRequestId): sigue habiendo una sola decision', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    const corte = cortarEventoAprobada();
    expect(() => t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-3' }, VAL)).toThrow();
    corte.falla = false;
    const r = t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-4', versionVista: 0 }, VERO);
    expect(r).toMatchObject({ ok: true, resultado: 'APROBADA', curada: true });
    expect(t.filasDec()).toHaveLength(1);
    expect(t.filasDec()[0].email).toBe(VAL);                                                         // la decision es de quien la escribio
    expect(t.filasSug()[1].email).toBe(VERO);                                                        // el evento, de quien lo completo
  });

  test('con la decision ya escrita no se puede rechazar ni cancelar (ya esta aprobada de hecho)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    cortarEventoAprobada();
    expect(() => t.resolver(t.idDe(s))).toThrow();
    expect(t.rechazar(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'APROBADA' });
    expect(t.cancelar(t.idDe(s))).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'APROBADA' });
    expect(evSug()).toEqual(['PROPUESTA']);
  });

  test('corte ANTES de escribir la decision: no queda nada a medias y el reintento crea exactamente una decision', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    const original = global.ubicacionFuenteDecisionesRepository_agregar;
    let falla = true;
    global.ubicacionFuenteDecisionesRepository_agregar = jest.fn((fila) => { if (falla) { throw new Error('Sheets caido'); } return original(fila); });
    expect(() => t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-5' })).toThrow();
    expect(t.filasDec()).toHaveLength(0);
    expect(evSug()).toEqual(['PROPUESTA']);
    falla = false;
    expect(t.resolver(t.idDe(s), { clientRequestId: 'req-res-corte-5' })).toMatchObject({ ok: true, resultado: 'APROBADA', curada: false });
    expect(t.filasDec()).toHaveLength(1);
  });

  test('una decision con el id sug-<id> pero de OTRA fuente/accion no se acepta como la de esta sugerencia: INCONSISTENT_STATE, no se escribe nada', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'x', secuencia: 1, wellId: W, fuenteTipo: 'IRRIGACION', x: I2.x, y: I2.y, evento: 'DESCARTADA', motivo: 'm', email: VAL, nombre: 'V', timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'sug-' + t.idDe(s), versionVista: 0, padronPeriodo: '2026-09' }[c])));
    t.cache.store = {};
    sinCambios(() => {
      expect(t.resolver(t.idDe(s), { versionVista: 1 })).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    });
    expect(t.verCola().data.inconsistentes).toBe(1);
  });
});

describe('concurrencia bajo el lock de script', () => {
  test('aprobar toma UN solo lock y lo libera (decision + evento van en la misma seccion critica)', () => {
    const s = t.sugerir({});
    const antes = t.locks.tomados;
    t.resolver(t.idDe(s));
    expect(t.locks.tomados - antes).toBe(1);
    expect(t.locks.tomados).toBe(t.locks.liberados);
  });

  test('dos validadores aprueban la MISMA sugerencia a la vez: se crea UNA decision; el segundo recibe ALREADY_RESOLVED', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.alTomarLock = () => { expect(t.resolver(t.idDe(s), { clientRequestId: 'req-conc-1' }, VERO).ok).toBe(true); };
    expect(t.resolver(t.idDe(s), { clientRequestId: 'req-conc-2' }, VAL)).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'APROBADA' });
    expect(t.filasDec()).toHaveLength(1);
    expect(evSug()).toEqual(['PROPUESTA', 'APROBADA']);
  });

  test('otro validador decide sobre el pozo justo antes de que se tome el lock: STALE_STATE y no se escribe nada', () => {
    const s = t.sugerir({ accionSugerida: 'DESCARTAR', motivo: 'm', ...REP });
    const v = t.versionDe(W);
    t.alTomarLock = () => { t.decidirDirecto('ACEPTAR', I1, null, VERO); };
    const r = t.resolver(t.idDe(s), { versionVista: v });
    expect(r).toMatchObject({ ok: false, code: 'STALE_STATE', versionActual: v + 1 });
    expect(evSug()).toEqual(['PROPUESTA']);
    expect(t.filasDec()).toHaveLength(1);
  });

  test('rechazar y aprobar a la vez: gana el primero y el otro ve ALREADY_RESOLVED', () => {
    const s = t.sugerir({});
    t.alTomarLock = () => { expect(t.rechazar(t.idDe(s), {}, VERO).ok).toBe(true); };
    expect(t.resolver(t.idDe(s), {}, VAL)).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'RECHAZADA' });
    expect(t.filasDec()).toHaveLength(0);
  });

  test('cancelar y aprobar a la vez: gana el primero', () => {
    const s = t.sugerir({});
    t.alTomarLock = () => { expect(t.cancelar(t.idDe(s)).ok).toBe(true); };
    expect(t.resolver(t.idDe(s), {}, VAL)).toMatchObject({ ok: false, code: 'ALREADY_RESOLVED', estado: 'CANCELADA' });
    expect(t.filasDec()).toHaveLength(0);
  });

  test('dos pedidos IGUALES del mismo usuario a la vez (distinto clientRequestId): se crea una sola; la otra es ALREADY_PENDING', () => {
    t.alTomarLock = () => { expect(t.sugerir({ accionSugerida: 'ACEPTAR' }, LEE).ok).toBe(true); };
    expect(t.sugerir({ accionSugerida: 'ACEPTAR' }, LEE)).toMatchObject({ ok: false, code: 'ALREADY_PENDING' });
    expect(t.filasSug()).toHaveLength(1);
  });

  test('el padron se relee DENTRO del lock: un reindexado entre el pedido y el lock se ve como OBSOLETA', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 });
    t.alTomarLock = () => { t.padron[W].coordenadasProvincia = [{ ...I2 }]; };
    expect(t.resolver(t.idDe(s))).toMatchObject({ ok: true, resultado: 'OBSOLETA', motivoNoAplicable: 'FUENTE_NO_EXISTE' });
    expect(t.filasDec()).toHaveLength(0);
  });

  test('una falla del padron dentro del lock: el error sube, el lock se libera y no se escribe nada', () => {
    const s = t.sugerir({});
    t.alTomarLock = () => { global.registryService_getWellLocation.mockImplementation(() => { throw new Error('Drive caido'); }); };
    expect(() => t.resolver(t.idDe(s))).toThrow(/Drive caido/);
    expect(t.locks.tomados).toBe(t.locks.liberados);
    expect(t.filasDec()).toHaveLength(0);
    expect(evSug()).toEqual(['PROPUESTA']);
  });
});

describe('secuencia del registro de sugerencias', () => {
  test('max + 1 global: 1, 2, 3...; rechazos no consumen secuencia', () => {
    t.sugerir({});
    t.sugerir({ accionSugerida: 'RESTAURAR' });                        // rechazada: no escribe
    t.sugerir({ ...I1 });
    expect(t.filasSug().map((f) => f.secuencia)).toEqual([1, 2]);
  });

  test('con una secuencia invalida en CUALQUIER fila se bloquea toda escritura (sugerir, resolver, cancelar) con INCONSISTENT_STATE; la lectura sigue', () => {
    const s = t.sugerir({});
    const otra = t.sugerir({ ...I1 }, ANA);
    t.sembrar({ secuencia: 'abc', sugerenciaId: 'corrupta-0001-aaaa', email: ANA });
    t.hojas.UbicacionFuenteSugerencias.filas[t.hojas.UbicacionFuenteSugerencias.filas.length - 1][1] = 'abc';
    t.cache.store = {};
    sinCambios(() => {
      expect(t.sugerir({ ...I2 })).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
      expect(t.resolver(t.idDe(s))).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
      expect(t.cancelar(t.idDe(otra), {}, ANA)).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    });
    expect(t.verPozo(LEE, false).ok).toBe(true);
    expect(t.verCola().ok).toBe(true);
  });
});

describe('cache de lectura', () => {
  const CLAVE_COLA = 'ufs_v1_cola';
  const CLAVE_POZO = 'ufs_v1_pozo_' + W;
  const calentar = () => { t.calmar(); t.verCola(); t.verPozo(VAL, true); expect(t.cache.store[CLAVE_COLA]).toBeDefined(); expect(t.cache.store[CLAVE_POZO]).toBeDefined(); };

  test('la cola y la vista del validador por pozo salen del cache la segunda vez (sin releer hojas ni padron); TTL 120 s', () => {
    t.sugerir({});
    t.calmar();
    t.verCola();
    t.verPozo(VAL, true);
    expect(t.cache.ttl[CLAVE_COLA]).toBe(120);
    expect(t.cache.ttl[CLAVE_POZO]).toBe(120);
    const listarSug = jest.fn(t.RepoSug.ubicacionFuenteSugerenciasRepository_listar);
    global.ubicacionFuenteSugerenciasRepository_listar = listarSug;
    global.registryService_getWellLocation.mockClear();
    t.verCola();
    t.verPozo(VAL, true);
    expect(listarSug).not.toHaveBeenCalled();
    expect(global.registryService_getWellLocation).not.toHaveBeenCalled();
  });

  test('la vista de quien NO valida no se cachea (depende de quien pregunta): cada lectura relee', () => {
    t.sugerir({});
    t.calmar();
    t.verPozo(LEE, false);
    expect(Object.keys(t.cache.store).filter((k) => k.indexOf('ufs_v1_pozo_') === 0)).toEqual([]);
  });

  test.each([
    ['sugerir', () => null, () => t.sugerir({ ...I1 })],
    ['aprobar', () => t.sugerir({ ...I2 }), (s) => t.resolver(t.idDe(s))],
    ['rechazar', () => t.sugerir({ ...I2 }), (s) => t.rechazar(t.idDe(s))],
    ['cancelar', () => t.sugerir({ ...I2 }), (s) => t.cancelar(t.idDe(s))],
    ['una decision DIRECTA (cambia lo que dicen las sugerencias)', () => null, () => t.decidirDirecto('ACEPTAR', I1)]
  ])('%s invalida la cola y la vista del pozo; la lectura siguiente ve lo nuevo', (_n, preparar, ejecutar) => {
    t.sugerir({});
    const previa = preparar();
    calentar();
    const antes = t.cache.store[CLAVE_COLA];
    const r = ejecutar(previa);
    expect(r.ok).toBe(true);
    expect(t.cache.store[CLAVE_COLA]).toBeUndefined();
    expect(t.cache.store[CLAVE_POZO]).toBeUndefined();
    expect(t.cache.store['ufs_v1_inval']).toBeDefined();
    const nueva = t.verCola().data;
    expect(JSON.stringify(nueva)).not.toBe(antes);
  });

  test('un rechazo de escritura (ALREADY_PENDING, limite, STALE_STATE, ALREADY_RESOLVED) NO invalida ni toca el cache', () => {
    const s = t.sugerir({});
    calentar();
    const foto = JSON.stringify(t.cache.store);
    t.cache.put.mockClear();
    t.cache.remove.mockClear();
    expect(t.sugerir({}).code).toBe('ALREADY_PENDING');
    expect(t.resolver(t.idDe(s), { versionVista: 99 }).code).toBe('STALE_STATE');
    expect(t.cancelar(t.idDe(s), {}, ANA).code).toBe('SUGGESTION_NOT_FOUND');
    expect(t.cache.put).not.toHaveBeenCalled();
    expect(t.cache.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(t.cache.store)).toBe(foto);
  });

  test('un cache viejo o mentiroso NUNCA se usa para escribir ni resolver (las escrituras ni siquiera lo leen)', () => {
    const s = t.sugerir({ accionSugerida: 'ACEPTAR' });
    t.cache.store[CLAVE_COLA] = JSON.stringify({ total: 77, noAplicables: 0, inconsistentes: 0, pendientes: [] });
    t.cache.store[CLAVE_POZO] = JSON.stringify({ wellId: W, version: 77, integro: true, sugerencias: [] });
    t.cache.get.mockClear();
    expect(t.sugerir({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);
    expect(t.resolver(t.idDe(s), { versionVista: t.versionDe(W) }).ok).toBe(true);
    expect(t.cancelar(t.idDe(t.sugerir({ ...I2 }))).ok).toBe(true);
    expect(t.cache.get.mock.calls.filter((c) => String(c[0]).indexOf('ufs_v1_cola') === 0 || String(c[0]).indexOf('ufs_v1_pozo_') === 0)).toEqual([]);
  });

  test('cache roto o de otro pozo: se ignora y se recalcula', () => {
    t.sugerir({});
    t.cache.store[CLAVE_COLA] = '{no es json';
    expect(t.verCola().data.total).toBe(1);
    t.cache.store[CLAVE_POZO] = JSON.stringify({ wellId: '01-0012', sugerencias: [] });
    expect(t.verPozo(VAL, true).data.wellId).toBe(W);
  });

  test('si CacheService falla (leer, guardar, invalidar) nada se rompe', () => {
    t.cache.falla = { get: true, put: true, remove: true };
    const s = t.sugerir({});
    expect(s.ok).toBe(true);
    expect(t.verCola().data.total).toBe(1);
    expect(t.resolver(t.idDe(s)).ok).toBe(true);
    global.CacheService = { getScriptCache: () => { throw new Error('sin cache'); } };
    expect(t.verCola().data.total).toBe(0);
  });

  test('si se invalido mientras se calculaba (marca reciente), el resultado viejo NO se guarda', () => {
    t.sugerir({});
    t.cache.store['ufs_v1_inval'] = String(t.reloj);
    t.verCola();
    expect(t.cache.store[CLAVE_COLA]).toBeUndefined();
    t.calmar();
    t.verCola();
    expect(t.cache.store[CLAVE_COLA]).toBeDefined();
  });

  test('lo cacheado no tiene emails ni datos del solicitante', () => {
    t.sugerir({ accionSugerida: 'ACEPTAR' }, LEE);
    calentar();
    expect(t.cache.store[CLAVE_COLA]).not.toMatch(/@|clientRequestId|secuencia/);
    expect(t.cache.store[CLAVE_POZO]).not.toMatch(/@|clientRequestId|secuencia/);
  });

  test('el contador de pendientes (para el futuro indicador) sale de la cola cacheada y se actualiza al escribir', () => {
    t.sugerir({});
    t.calmar();
    expect(t.verCola().data.total).toBe(1);
    t.sugerir({ ...I1 }, ANA);
    expect(t.verCola().data.total).toBe(2);
  });
});

describe('derivacion pura del estado (ufs_derivar)', () => {
  const ev = (extra) => Object.assign({ sugerenciaId: 'sug-aaaaaaaa', secuencia: 1, evento: 'PROPUESTA', wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, accionSugerida: 'ACEPTAR', motivo: '', email: LEE, nombre: 'L', timestampUtc: '2026-10-14T00:00:00.000Z', clientRequestId: 'req-pura-1', versionVista: 0 }, extra || {});
  const der = (filas, dec) => t.Sug.ufs_derivar(filas, dec || []);

  test('PROPUESTA sola = PENDIENTE; con cada evento terminal = su estado', () => {
    expect(der([ev()]).sugerencias[0].estado).toBe('PENDIENTE');
    ['APROBADA', 'RECHAZADA', 'CANCELADA', 'OBSOLETA'].forEach((e) => {
      expect(der([ev(), ev({ secuencia: 2, evento: e, email: VAL, motivo: e === 'RECHAZADA' ? 'no' : '' })]).sugerencias[0].estado).toBe(e);
    });
  });

  test('el orden lo da la secuencia (no la posicion en la hoja ni la fecha)', () => {
    const filas = [ev({ secuencia: 2, evento: 'CANCELADA', timestampUtc: '2000-01-01T00:00:00.000Z' }), ev({ secuencia: 1, timestampUtc: '2030-01-01T00:00:00.000Z' })];
    expect(der(filas).sugerencias[0]).toMatchObject({ estado: 'CANCELADA', anomalias: [] });
  });

  test.each([
    ['resolucion sin propuesta', [ev({ evento: 'APROBADA', email: VAL })], 'SIN_PROPUESTA'],
    ['resolucion ANTES de la propuesta', [ev({ secuencia: 1, evento: 'CANCELADA' }), ev({ secuencia: 2 })], 'EVENTO_ANTES_DE_LA_PROPUESTA'],
    ['dos propuestas con el mismo id', [ev(), ev({ secuencia: 2 })], 'PROPUESTA_REPETIDA'],
    ['dos resoluciones', [ev(), ev({ secuencia: 2, evento: 'CANCELADA' }), ev({ secuencia: 3, evento: 'APROBADA' })], 'RESOLUCION_REPETIDA'],
    ['la resolucion nombra otra fuente', [ev(), ev({ secuencia: 2, evento: 'CANCELADA', x: 1 })], 'NO_COINCIDE_CON_LA_PROPUESTA'],
    ['la resolucion cambia la accion', [ev(), ev({ secuencia: 2, evento: 'CANCELADA', accionSugerida: 'RESTAURAR' })], 'NO_COINCIDE_CON_LA_PROPUESTA'],
    ['secuencia repetida', [ev(), ev({ sugerenciaId: 'sug-bbbbbbbb' })], 'SECUENCIA_REPETIDA'],
    ['secuencia invalida', [ev({ secuencia: 'x' })], 'SECUENCIA_INVALIDA'],
    ['evento desconocido', [ev({ evento: 'SUPERADA' })], 'EVENTO_DESCONOCIDO'],
    ['QUITAR_ACEPTACION en la hoja', [ev({ accionSugerida: 'QUITAR_ACEPTACION' })], 'ACCION_INVALIDA'],
    ['descartar sin motivo', [ev({ accionSugerida: 'DESCARTAR', motivo: '' })], 'MOTIVO_REQUERIDO'],
    ['rechazo sin motivo', [ev(), ev({ secuencia: 2, evento: 'RECHAZADA', motivo: '' })], 'MOTIVO_REQUERIDO'],
    ['fuente invalida', [ev({ x: null })], 'FUENTE_INVALIDA'],
    ['pozo invalido', [ev({ wellId: 'zz' })], 'POZO_INVALIDO'],
    ['sin email', [ev({ email: '' })], 'SIN_EMAIL'],
    ['fecha invalida', [ev({ timestampUtc: 'ayer' })], 'FECHA_INVALIDA'],
    ['version invalida en la propuesta', [ev({ versionVista: null })], 'VERSION_INVALIDA']
  ])('inconsistente: %s -> %s (y esa sugerencia no tiene estado)', (_n, filas, codigo) => {
    const g = der(filas).sugerencias.filter((x) => x.anomalias.length > 0)[0];
    expect(g.anomalias).toContain(codigo);
    expect(g.estado).toBeNull();
  });

  test('una sugerencia rota NO contamina a las demas', () => {
    const d = der([ev({ evento: 'TRALALA' }), ev({ sugerenciaId: 'sug-cccccccc', secuencia: 2 })]);
    expect(d.sugerencias.map((x) => x.estado).sort()).toEqual(['PENDIENTE', null]);
  });

  test('filas sin id valido van a anomaliasGlobales', () => {
    expect(der([ev({ sugerenciaId: '' })]).anomaliasGlobales).toHaveLength(1);
  });

  test('autocuracion: PENDIENTE + decision sug-<id> que coincide = APROBADA (curada); que no coincide = inconsistente', () => {
    const dec = (extra) => Object.assign({ wellId: W, fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, evento: 'ACEPTADA', clientRequestId: 'sug-sug-aaaaaaaa' }, extra || {});
    expect(der([ev()], [dec()]).sugerencias[0]).toMatchObject({ estado: 'APROBADA', curada: true });
    expect(der([ev()], [dec({ evento: 'DESCARTADA' })]).sugerencias[0]).toMatchObject({ estado: null });
    expect(der([ev()], [dec({ clientRequestId: 'otro' })]).sugerencias[0]).toMatchObject({ estado: 'PENDIENTE', curada: false });
  });
});
