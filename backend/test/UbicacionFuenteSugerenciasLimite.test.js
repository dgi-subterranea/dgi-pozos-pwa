// Limite de 10 sugerencias: cuenta SOLO las pendientes del usuario que sigan siendo APLICABLES hoy (padron + estado actual de la fuente). Una pendiente que dejo de ser aplicable (reindexado,
// decision posterior) se conserva intacta y auditable, pero NO consume cupo; si vuelve a ser aplicable, vuelve a contar. Nada se escribe al leer ni al contar.
const { armarSug, W, LEE, ANA, VAL, REP, I1, I2, P_IRR1 } = require('./sugerenciasHelper');

let t;
beforeEach(() => { t = armarSug(); });
afterEach(() => { jest.restoreAllMocks(); });

const filasCrudas = () => JSON.stringify([t.filasSug(), t.filasDec()]);
const cola = () => t.verCola().data;
// 10 sugerencias que NO son aplicables: la fuente no existe en el padron
const sembrarNoAplicables = (n, email) => t.sembrar(...Array.from({ length: n }, () => ({ email: email || LEE, wellId: W, fuenteTipo: 'IRRIGACION', x: 1, y: 1, accionSugerida: 'ACEPTAR' })));
const nueva = (extra, quien) => t.sugerir(Object.assign({ accionSugerida: 'ACEPTAR', ...I1 }, extra || {}), quien);

describe('A. 10 pendientes aplicables -> PENDING_LIMIT_REACHED', () => {
  test('con 10 aplicables no se puede crear la 11a (y no se escribe nada)', () => {
    t.sembrarAplicables(10, LEE);
    const antes = filasCrudas();
    expect(nueva()).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED', limite: 10 });
    expect(filasCrudas()).toBe(antes);
  });

  test('con 9 aplicables si se crea la 10a, y despues no la 11a', () => {
    t.sembrarAplicables(9, LEE);
    expect(nueva().ok).toBe(true);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 })).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED' });
  });

  test('es POR USUARIO: las 10 de otra persona no cuentan', () => {
    t.sembrarAplicables(10, ANA);
    expect(nueva({}, LEE).ok).toBe(true);
  });
});

describe('B. 9 aplicables + 1 no aplicable -> permite crear una nueva', () => {
  test('la no aplicable no ocupa lugar', () => {
    t.sembrarAplicables(9, LEE);
    sembrarNoAplicables(1);
    const r = nueva();
    expect(r.ok).toBe(true);
    expect(r.sugerencia.estado).toBe('PENDIENTE');
  });

  test('...y recien con 10 aplicables reales se bloquea', () => {
    t.sembrarAplicables(9, LEE);
    sembrarNoAplicables(3);
    expect(nueva().ok).toBe(true);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 })).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED' });
  });
});

describe('C. 10 no aplicables -> permite crear una nueva', () => {
  test('con 10 (o muchas mas) no aplicables el usuario puede seguir sugiriendo', () => {
    sembrarNoAplicables(10);
    expect(nueva().ok).toBe(true);
    sembrarNoAplicables(15);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 }).ok).toBe(true);
  });

  test('las no aplicables se conservan intactas: ninguna fila se modifica ni se agrega un OBSOLETA; solo se agrega la PROPUESTA nueva', () => {
    sembrarNoAplicables(10);
    const antes = t.filasSug();
    expect(nueva().ok).toBe(true);
    const despues = t.filasSug();
    expect(despues.slice(0, 10)).toEqual(antes);
    expect(despues).toHaveLength(11);
    expect(despues.map((f) => f.evento)).toEqual(Array(11).fill('PROPUESTA'));
  });
});

describe('D. fuente desaparecida por reindexado: la sugerencia vieja no consume cupo', () => {
  test('10 aplicables (2 de ellas sobre Irrigacion (1)); se reindexa y esa fuente desaparece -> quedan 8 y se puede crear', () => {
    t.sembrarAplicables(8, LEE);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I1 }).ok).toBe(true);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 })).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED' });
    t.padron[W].coordenadasProvincia = [{ x: I2.x, y: I2.y }];                          // reindexado: Irrigacion (1) ya no existe
    const antes = filasCrudas();
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 }).ok).toBe(true);
    expect(t.filasSug().slice(0, 10)).toEqual(JSON.parse(antes)[0]);                     // las dos viejas siguen ahi, intactas y PENDIENTES
  });

  test('la vieja nunca se transfiere a una fuente nueva ni vuelve a contar aunque aparezca una coordenada distinta en su lugar', () => {
    t.sembrarAplicables(9, LEE);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);
    t.padron[W].coordenadasProvincia = [{ x: 2490000, y: 6311000 }, { x: I2.x, y: I2.y }];
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 }).ok).toBe(true);                    // la de I1 no cuenta
    const vieja = cola().pendientes.filter((p) => p.x === I1.x)[0];
    expect(vieja).toMatchObject({ aplicable: false, motivoNoAplicable: 'FUENTE_NO_EXISTE', estado: 'PENDIENTE' });
  });

  test('el pozo entero desaparece del padron: sus pendientes no consumen cupo', () => {
    t.sembrar(...Array.from({ length: 10 }, () => ({ email: LEE, wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: 2500000, y: 6350000, accionSugerida: 'ACEPTAR' })));
    expect(nueva().code).toBe('PENDING_LIMIT_REACHED');
    t.padron['01-0012'] = undefined;
    expect(nueva().ok).toBe(true);
  });
});

describe('E. la accion ya no corresponde por una decision posterior: no consume cupo (y vuelve a contar si vuelve a ser aplicable)', () => {
  test('9 ACEPTAR sobre Reporte Pozos + 1 sobre Irrigacion (1) = 10; se DESCARTA Reporte Pozos -> las 9 dejan de aplicar', () => {
    t.sembrarAplicables(9, LEE);                                                            // ACEPTAR sobre REP
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 }).code).toBe('PENDING_LIMIT_REACHED');
    t.decidirDirecto('DESCARTAR', REP);
    const antes = t.filasSug();
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 }).ok).toBe(true);                       // ahora hay lugar
    expect(t.filasSug().slice(0, 10)).toEqual(antes);                                        // las viejas, intactas
    expect(cola().pendientes.filter((p) => p.motivoNoAplicable === 'YA_NO_CORRESPONDE')).toHaveLength(9);
  });

  test('si la fuente se RESTAURA, las viejas vuelven a ser aplicables y vuelven a contar', () => {
    t.sembrarAplicables(9, LEE);
    t.decidirDirecto('DESCARTAR', REP);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);                       // 0 + 1
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I2 }).ok).toBe(true);                       // 0 + 2
    t.decidirDirecto('RESTAURAR', REP);                                                      // las 9 vuelven: 9 + 2 = 11 aplicables
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I1 })).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED' });
    expect(cola().total).toBe(11);
  });

  test('una decision posterior sobre OTRA fuente no cambia nada para el cupo', () => {
    t.sembrarAplicables(10, LEE);
    t.decidirDirecto('ACEPTAR', I1);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I2 }).code).toBe('PENDING_LIMIT_REACHED');
  });

  test('aprobar, rechazar o cancelar una libera su lugar (ya no es PENDIENTE)', () => {
    const a = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.sembrarAplicables(9, LEE, { fuenteTipo: I2.fuenteTipo, x: I2.x, y: I2.y });
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I1 }).code).toBe('PENDING_LIMIT_REACHED');
    expect(t.cancelar(t.idDe(a)).ok).toBe(true);
    expect(nueva({ accionSugerida: 'DESCARTAR', motivo: 'm', ...I1 }).ok).toBe(true);
  });
});

describe('F. la lectura (y contar el limite) por si sola NO escribe nada, ni siquiera OBSOLETA', () => {
  test('leer la cola, la vista del pozo (ambos roles) y la vista de una sugerencia, con sugerencias ya no aplicables, no escribe ninguna fila', () => {
    nueva({ accionSugerida: 'ACEPTAR', ...REP });
    nueva({ accionSugerida: 'ACEPTAR', ...I1 });
    t.decidirDirecto('DESCARTAR', REP);
    t.padron[W].coordenadasProvincia = [{ x: I2.x, y: I2.y }];                                // y ademas I1 desaparece
    const agregarSug = jest.fn(global.ubicacionFuenteSugerenciasRepository_agregar);
    const agregarDec = jest.fn(global.ubicacionFuenteDecisionesRepository_agregar);
    global.ubicacionFuenteSugerenciasRepository_agregar = agregarSug;
    global.ubicacionFuenteDecisionesRepository_agregar = agregarDec;
    const antes = filasCrudas();
    t.cache.store = {};
    t.verCola();
    t.verPozo(LEE, false);
    t.verPozo(VAL, true);
    t.sugerir({ accionSugerida: 'ACEPTAR', ...I1, clientRequestId: 'req-lim-ya-escrito' });          // (se rechaza: la fuente no existe)
    expect(agregarSug).not.toHaveBeenCalled();
    expect(agregarDec).not.toHaveBeenCalled();
    expect(filasCrudas()).toBe(antes);
    expect(t.filasSug().map((f) => f.evento)).toEqual(['PROPUESTA', 'PROPUESTA']);
  });

  test('crear una sugerencia nueva con pendientes no aplicables escribe EXACTAMENTE una fila (la nueva): no convierte las viejas en OBSOLETA', () => {
    nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('DESCARTAR', REP);
    const agregarSug = jest.fn(global.ubicacionFuenteSugerenciasRepository_agregar);
    global.ubicacionFuenteSugerenciasRepository_agregar = agregarSug;
    expect(nueva({ accionSugerida: 'ACEPTAR', ...I1 }).ok).toBe(true);
    expect(agregarSug).toHaveBeenCalledTimes(1);
    expect(agregarSug.mock.calls[0][0]).toMatchObject({ evento: 'PROPUESTA' });
  });

  test('un rechazo por el limite tampoco escribe', () => {
    t.sembrarAplicables(10, LEE);
    const agregarSug = jest.fn(global.ubicacionFuenteSugerenciasRepository_agregar);
    global.ubicacionFuenteSugerenciasRepository_agregar = agregarSug;
    expect(nueva().code).toBe('PENDING_LIMIT_REACHED');
    expect(agregarSug).not.toHaveBeenCalled();
  });

  test('la unica forma de que una no aplicable pase a OBSOLETA es que un validador intente aprobarla (queda auditado)', () => {
    const a = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('DESCARTAR', REP);
    expect(t.filasSug().map((f) => f.evento)).toEqual(['PROPUESTA']);
    expect(t.resolver(t.idDe(a), { versionVista: 1 }).resultado).toBe('OBSOLETA');
    expect(t.filasSug().map((f) => f.evento)).toEqual(['PROPUESTA', 'OBSOLETA']);
  });
});

describe('G. getSugerenciasFuentesPendientes cuenta unicamente las aplicables', () => {
  test('el total del indicador excluye las no aplicables, que se informan aparte (y siguen listadas)', () => {
    t.sembrarAplicables(3, LEE);
    sembrarNoAplicables(4);
    const c = cola();
    expect(c).toMatchObject({ total: 3, noAplicables: 4 });
    expect(c.pendientes).toHaveLength(7);
    expect(c.pendientes.filter((p) => p.aplicable === true)).toHaveLength(3);
  });

  test('el total y el cupo de un usuario usan el MISMO criterio (aplicable hoy)', () => {
    t.sembrarAplicables(10, LEE);
    expect(cola().total).toBe(10);
    t.decidirDirecto('DESCARTAR', REP);
    expect(cola().total).toBe(0);
    expect(nueva().ok).toBe(true);
  });
});

describe('H. deduplicacion: una equivalente pendiente pero no aplicable no bloquea; no se crean duplicados absurdos', () => {
  test('una ACEPTAR pendiente que ya no aplica (la fuente fue descartada) no impide sugerir RESTAURAR (otra accion, hoy valida)', () => {
    const vieja = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('DESCARTAR', REP);
    const r = nueva({ accionSugerida: 'RESTAURAR', ...REP });
    expect(r.ok).toBe(true);
    expect(r.sugerencia.sugerenciaId).not.toBe(t.idDe(vieja));
  });

  test('y no se puede repetir la accion absurda: ACEPTAR sobre una descartada sigue siendo INVALID_TRANSITION', () => {
    nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('DESCARTAR', REP);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...REP })).toMatchObject({ ok: false, code: 'INVALID_TRANSITION' });
    expect(t.filasSug()).toHaveLength(1);
  });

  test('si la fuente vuelve a un estado en que la vieja es aplicable otra vez, repetirla es ALREADY_PENDING con la MISMA (sin duplicado)', () => {
    const vieja = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    t.decidirDirecto('DESCARTAR', REP);
    t.decidirDirecto('RESTAURAR', REP);
    const r = nueva({ accionSugerida: 'ACEPTAR', ...REP });
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_PENDING' });
    expect(r.sugerencia.sugerenciaId).toBe(t.idDe(vieja));
    expect(t.filasSug()).toHaveLength(1);
  });

  test('una equivalente sobre una fuente que desaparecio y una NUEVA fuente con otras coordenadas: son fuentes distintas, no hay conflicto', () => {
    const vieja = nueva({ accionSugerida: 'ACEPTAR', ...I1 });
    t.padron[W].coordenadasProvincia = [{ x: 2490000, y: 6311000 }, { x: I2.x, y: I2.y }];
    const r = nueva({ accionSugerida: 'ACEPTAR', fuenteTipo: 'IRRIGACION', x: 2490000, y: 6311000 });
    expect(r.ok).toBe(true);
    expect(r.sugerencia.sugerenciaId).not.toBe(t.idDe(vieja));
  });

  test('la deduplicacion y el limite son independientes de los de otras personas', () => {
    nueva({ accionSugerida: 'ACEPTAR', ...REP }, LEE);
    expect(nueva({ accionSugerida: 'ACEPTAR', ...REP }, ANA).ok).toBe(true);
  });
});

describe('si no se puede verificar la aplicabilidad de una pendiente, cuenta (el limite no se puede esquivar con una caida)', () => {
  test('el padron de OTRO pozo falla al contar: sus pendientes cuentan y el limite se aplica; queda en el log', () => {
    t.sembrar(...Array.from({ length: 10 }, () => ({ email: LEE, wellId: '01-0012', fuenteTipo: 'IRRIGACION', x: 2500000, y: 6350000, accionSugerida: 'ACEPTAR' })));
    const original = global.registryService_getWellLocation;
    global.registryService_getWellLocation = jest.fn((id) => { if (id === '01-0012') { throw new Error('Drive caido'); } return original(id); });
    expect(nueva()).toMatchObject({ ok: false, code: 'PENDING_LIMIT_REACHED' });
    expect(global.Logger.log.mock.calls.some((c) => /no se pudo verificar/.test(String(c[0])))).toBe(true);
    expect(t.filasSug()).toHaveLength(10);
  });

  test('el padron del pozo de la sugerencia nueva se lee una sola vez aunque el usuario tenga muchas pendientes en ese pozo', () => {
    t.sembrarAplicables(5, LEE);
    global.registryService_getWellLocation.mockClear();
    expect(nueva().ok).toBe(true);
    expect(global.registryService_getWellLocation.mock.calls.filter((c) => c[0] === W)).toHaveLength(1);
  });
});
