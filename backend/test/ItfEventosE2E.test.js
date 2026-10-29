// E2E de E9-2 sin endpoints: repositorio REAL (hoja en memoria) + dominio REAL, orquestados como lo hara el servicio de E9-3 (lock -> buscar clientRequestId -> leer todo -> derivar -> planificar ->
// escribir). Prueba el circuito completo, la idempotencia sobre la hoja, el append-only, el aislamiento de un pozo corrupto, la disponibilidad en lote y que nada de esto toque produccion.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');
const H = require('./itfHelper');

let R;
let D;
let hoja;
let n;

const { WELL, uuid, sha, doc, USUARIOS, SNAP, archivo } = H;
const { ana, val, ambos } = USUARIOS;
const OTRO = '14-0002';
const LEGACY_ID = 'LEGACY:' + WELL;

beforeEach(() => {
  jest.resetModules();
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Object.assign(global, require('../src/ItfArchivoLogic'));
  R = require('../src/ItfEventosRepository');
  D = require('../src/ItfDominioService');
  Object.assign(global, R, D);
  const hojas = instalarSheetsFalsos({ ItfEventos: [R.ITF_EVENTOS_COLUMNAS] });
  hoja = hojas.ItfEventos;
  n = 0;
  legacyEstado = { [WELL]: true };
});

let legacyEstado;
const nuevoId = (base) => () => { n += 1; return uuid(base + n); };
let crids = 0;
const crid = () => { crids += 1; return 'e2e-req-' + String(crids).padStart(8, '0'); };

// El orquestador del servicio futuro (en E9-3). TODO dentro del lock.
function ejecutar(usuario, comando, extra) {
  const e = extra || {};
  return R.itfEventosRepository_conLock(() => {
    const email = String(usuario.email).trim().toLowerCase();
    const existentes = R.itfEventosRepository_buscarPorClientRequestId(email, comando.clientRequestId);
    const todos = R.itfEventosRepository_leerTodos().eventos;
    const wellId = comando.wellId || (e.wellId || WELL);
    const plan = D.itfDominio_planificar(comando, {
      email: usuario.email, nombre: usuario.nombre, permisos: usuario.permisos, ahora: new Date(H.ISO), derivacion: D.itfDominio_derivar(todos), existentes: existentes,
      nuevoEventoId: nuevoId(40000), nuevoDocumentoId: nuevoId(60000), legacy: { disponible: legacyEstado[wellId] === undefined ? false : legacyEstado[wellId], snapshot: SNAP },
      archivo: e.archivo, pozoExiste: e.pozoExiste === undefined ? true : e.pozoExiste
    });
    if (plan.ok && plan.accion === 'ESCRIBIR') {
      R.itfEventosRepository_escribirEventos(plan.eventos);
    }
    return plan;
  });
}
const leer = () => R.itfEventosRepository_leerTodos().eventos;
const derivar = () => D.itfDominio_derivar(leer());
const estado = (wellId, legacy) => D.itfDominio_estadoPozo(wellId || WELL, derivar(), legacy === undefined ? (legacyEstado[wellId || WELL] === undefined ? false : legacyEstado[wellId || WELL]) : legacy);
const proponer = (k, usuario, wellId) => ejecutar(usuario || ana, { accion: 'PROPONER', wellId: wellId || WELL, clientRequestId: crid() }, { archivo: archivo(k), wellId: wellId || WELL });
const decidir = (usuario, comando) => ejecutar(usuario || val, Object.assign({ clientRequestId: crid() }, comando));

describe('circuito completo sobre la hoja', () => {
  test('legacy -> propuesta -> aprobacion que reemplaza al legacy -> nueva version -> retiro -> restauracion, todo append-only', () => {
    const p1 = proponer(1);
    expect(p1.ok).toBe(true);
    const d1 = p1.resultado.documentoId;
    expect(estado()).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });                       // el legacy sigue vigente
    expect(estado().vigente.documentoId).toBe(LEGACY_ID);

    const filasAntes = JSON.stringify(hoja.filas);
    const ap = decidir(val, { accion: 'APROBAR', documentoId: d1, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'MEJOR_CALIDAD' });
    expect(ap.ok).toBe(true);
    expect(ap.eventos.map((e) => e.evento)).toEqual(['ITF_LEGACY_REGISTRADO', 'ITF_APROBADO']);
    expect(JSON.stringify(hoja.filas.slice(0, 2))).toBe(filasAntes);                          // las filas anteriores no cambiaron
    expect(hoja.filas).toHaveLength(4);
    expect(estado().vigente.documentoId).toBe(d1);

    const d2 = proponer(2).resultado.documentoId;
    expect(decidir(val, { accion: 'APROBAR', documentoId: d2, documentoReemplazadoId: d1, motivoCodigo: 'ACTUALIZACION' }).ok).toBe(true);
    expect(estado().vigente.documentoId).toBe(d2);

    expect(decidir(val, { accion: 'RETIRAR', documentoId: d2, motivoCodigo: 'DOCUMENTO_INCORRECTO' }).ok).toBe(true);
    expect(estado()).toMatchObject({ estado: 'SIN_ITF', tieneItf: 'NO' });

    expect(decidir(val, { accion: 'REVERTIR', documentoId: LEGACY_ID, motivoCodigo: 'ERROR_DE_APROBACION' }).ok).toBe(true);
    expect(estado().vigente.documentoId).toBe(LEGACY_ID);

    const secuencias = leer().map((e) => e.secuencia);
    expect(secuencias).toEqual(secuencias.map((_, i) => i + 1));                                   // 1..n sin huecos ni repetidos
    expect(derivar().porPozo[WELL].integridad).toBe('OK');
    expect(Object.keys(derivar().porPozo[WELL].documentos).sort()).toEqual([LEGACY_ID, d1, d2].sort());
  });

  test('la metadata del documento se escribe una sola vez (en la propuesta) y no cambia nunca', () => {
    const d1 = proponer(1).resultado.documentoId;
    decidir(val, { accion: 'APROBAR', documentoId: d1, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'CORRECCION' });
    decidir(val, { accion: 'REVERTIR', documentoId: LEGACY_ID, documentoReemplazadoId: d1, motivoCodigo: 'ERROR_DE_APROBACION' });
    const conMeta = leer().filter((e) => e.sha256 !== '' || e.storageFileId !== '' || e.mimeType !== '');
    expect(conMeta.map((e) => e.evento)).toEqual(['ITF_PROPUESTO', 'ITF_LEGACY_REGISTRADO']);
    expect(derivar().porPozo[WELL].documentos[d1]).toMatchObject({ sha256: sha(1), storageFileId: H.storageId(1) });
  });

  test('la hoja no guarda base64 ni contenido: ninguna celda es larga', () => {
    proponer(1);
    const maximo = Math.max(...hoja.filas.slice(1).flat().map((c) => String(c).length));
    expect(maximo).toBeLessThan(100);
  });

  test('un evento escrito vuelve a leerse y derivarse igual (ida y vuelta por la hoja)', () => {
    const d1 = proponer(1).resultado.documentoId;
    const p = derivar().porPozo[WELL];
    expect(p.documentos[d1]).toMatchObject({ estado: 'PROPUESTO', wellId: WELL, mimeType: 'image/jpeg', bytes: 5001, nombreOriginal: 'f1.jpg', propuesto: { nombre: 'Ana', timestamp: H.ISO } });
  });
});

describe('autoaprobacion: dos acciones, dos filas', () => {
  test('quien tiene perfil_subir y perfil_validar propone y despues aprueba lo suyo', () => {
    legacyEstado[WELL] = false;                                                                   // sin legacy: la propuesta es lo unico que hay
    const d1 = proponer(1, ambos).resultado.documentoId;
    expect(leer()).toHaveLength(1);
    expect(estado()).toMatchObject({ estado: 'PENDIENTE', tieneItf: 'NO' });
    expect(decidir(ambos, { accion: 'APROBAR', documentoId: d1 }).ok).toBe(true);
    expect(leer().map((e) => [e.secuencia, e.evento])).toEqual([[1, 'ITF_PROPUESTO'], [2, 'ITF_APROBADO']]);
    expect(estado()).toMatchObject({ estado: 'VIGENTE', tieneItf: 'SI' });
    expect(D.itfDominio_dtoValidador(estado()).vigente.autoaprobado).toBe(true);
    expect(D.itfDominio_dtoLectura(estado())).not.toHaveProperty('vigente.autoaprobado');
  });
});

describe('idempotencia sobre la hoja', () => {
  test('el reintento exacto no escribe nada ni consume secuencia', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'reintento-e2e-01' };
    const a = ejecutar(ana, comando, { archivo: archivo(1) });
    const filas = hoja.filas.length;
    const b = ejecutar(ana, comando, { archivo: archivo(1) });
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(b.resultado.documentoId).toBe(a.resultado.documentoId);
    expect(hoja.filas).toHaveLength(filas);
    expect(leer().map((e) => e.secuencia)).toEqual([1]);
  });
  test('el mismo clientRequestId con otro contenido es IDEMPOTENCY_CONFLICT y no escribe', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'reintento-e2e-02' };
    ejecutar(ana, comando, { archivo: archivo(1) });
    const r = ejecutar(ana, comando, { archivo: archivo(2) });
    expect(r.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(leer()).toHaveLength(1);
  });
  test('el email se compara normalizado: otras mayusculas del mismo usuario es el mismo usuario', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'reintento-e2e-03' };
    ejecutar(ana, comando, { archivo: archivo(1) });
    expect(ejecutar(Object.assign({}, ana, { email: ' ANA@X.COM ' }), comando, { archivo: archivo(1) }).accion).toBe('REINTENTO');
    expect(leer()).toHaveLength(1);
  });
  test('usuarios distintos pueden reutilizar el clientRequestId', () => {
    const comando = { accion: 'PROPONER', wellId: WELL, clientRequestId: 'compartido-e2e1' };
    expect(ejecutar(ana, comando, { archivo: archivo(1) }).accion).toBe('ESCRIBIR');
    expect(ejecutar(ambos, comando, { archivo: archivo(2) }).accion).toBe('ESCRIBIR');
    expect(leer()).toHaveLength(2);
    expect(derivar().porPozo[WELL].integridad).toBe('OK');
  });
  test('duplicado documental (mismo hash, nuevo clientRequestId) no escribe', () => {
    proponer(1);
    expect(proponer(1).code).toBe('DUPLICADO_DOCUMENTO');
    expect(leer()).toHaveLength(1);
  });
  test('si el registro previo del legacy se escribio pero la aprobacion no (corte), el reintento de la aprobacion no duplica el registro', () => {
    const d1 = proponer(1).resultado.documentoId;
    // simula el corte: solo el registro del legacy quedo escrito
    const registro = D.itfDominio_planificar({ accion: 'RETIRAR', documentoId: LEGACY_ID, motivoCodigo: 'OTRO', motivoTexto: 'x x', clientRequestId: 'corte-e2e-001' },
      { email: val.email, nombre: val.nombre, permisos: val.permisos, ahora: new Date(H.ISO), derivacion: derivar(), existentes: { total: 0, eventos: [] }, nuevoEventoId: nuevoId(70000),
        legacy: { disponible: true, snapshot: SNAP } }).eventos[0];
    R.itfEventosRepository_escribirEvento(registro);
    expect(derivar().porPozo[WELL].legacyRegistrado).toBe(true);
    expect(estado().vigente.documentoId).toBe(LEGACY_ID);
    const r = decidir(val, { accion: 'APROBAR', documentoId: d1, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION' });
    expect(r.ok).toBe(true);
    expect(r.eventos.map((e) => e.evento)).toEqual(['ITF_APROBADO']);                            // no se registra dos veces
    expect(derivar().porPozo[WELL].integridad).toBe('OK');
  });
});

describe('AISLAMIENTO: un pozo corrupto no rompe el acceso a los demas', () => {
  test('eventos corruptos de un pozo: los demas siguen derivandose y se puede escribir en ellos', () => {
    legacyEstado[OTRO] = true;
    proponer(1);
    const d2 = proponer(2, ana, OTRO).resultado.documentoId;
    R.itfEventosRepository_escribirEvento({ eventoId: uuid(900), evento: 'ITF_BORRADO', documentoId: doc(1), wellId: WELL, email: 'x@x.com', nombre: 'X', timestampUtc: H.ISO, clientRequestId: 'corrupto-e2e-1' });
    expect(estado(WELL)).toMatchObject({ integridad: 'NO_DERIVABLE', tieneItf: 'DESCONOCIDO' });
    expect(estado(OTRO)).toMatchObject({ integridad: 'OK', tieneItf: 'SI' });
    expect(decidir(val, { accion: 'APROBAR', documentoId: d2, documentoReemplazadoId: 'LEGACY:' + OTRO, motivoCodigo: 'ACTUALIZACION' }, { wellId: OTRO }).ok).toBe(true);
    expect(estado(OTRO).vigente.documentoId).toBe(d2);
    expect(proponer(3).code).toBe('ESTADO_NO_DERIVABLE');
    delete legacyEstado[OTRO];
  });
  test('un pozo sin eventos E9 conserva su comportamiento legacy aunque la hoja tenga otro pozo roto', () => {
    legacyEstado['10-0001'] = true;
    R.itfEventosRepository_escribirEvento({ eventoId: uuid(900), evento: 'ITF_BORRADO', documentoId: doc(1), wellId: WELL, email: 'x@x.com', nombre: 'X', timestampUtc: H.ISO, clientRequestId: 'corrupto-e2e-2' });
    expect(estado('10-0001')).toMatchObject({ tieneItf: 'SI', estado: 'VIGENTE' });
    delete legacyEstado['10-0001'];
  });
  test('si la secuencia de la hoja no se puede calcular (corrupcion global) las LECTURAS siguen, pero NINGUNA escritura se hace', () => {
    proponer(1);
    hoja.filas.push(hoja.filas[1].slice());                                                       // duplica una fila completa (eventoId y secuencia repetidos)
    const filas = hoja.filas.length;
    expect(estado(WELL).tieneItf).toBe('DESCONOCIDO');
    expect(estado(OTRO)).toMatchObject({ integridad: 'OK' });
    expect(proponer(2).code).toBe('ESTADO_NO_DERIVABLE');                                          // el pozo roto ni siquiera planifica
    expect(() => proponer(3, ana, OTRO)).toThrow(/no se escribio nada/);                            // y en los sanos la escritura falla cerrado
    expect(hoja.filas).toHaveLength(filas);
  });
});

describe('disponibilidad en lote (E7) y ZIP / Mi seleccion', () => {
  test('700 pozos: se deriva UNA vez y cada pozo se contesta por memoria (sin leer la hoja por pozo)', () => {
    const pozos = [];
    for (let i = 1; i <= 700; i += 1) { pozos.push('20-' + String(i).padStart(4, '0')); }
    proponer(1);
    pozos.slice(0, 462).forEach((w) => { legacyEstado[w] = true; });
    let lecturas = 0;
    const original = hoja.getDataRange.bind(hoja);
    hoja.getDataRange = () => { lecturas += 1; return original(); };
    const derivacion = D.itfDominio_derivar(R.itfEventosRepository_leerTodos().eventos);
    const resultado = {};
    pozos.forEach((w) => { resultado[w] = D.itfTieneVigente(w, derivacion, legacyEstado[w] === true); });
    expect(lecturas).toBe(1);
    expect(Object.values(resultado).filter((v) => v === true)).toHaveLength(462);
    expect(Object.values(resultado).filter((v) => v === false)).toHaveLength(238);
    pozos.forEach((w) => { delete legacyEstado[w]; });
  });
  test('la disponibilidad de un pozo con legacy y solo propuestas pendientes sigue siendo la del legacy (como hoy)', () => {
    legacyEstado[WELL] = true;
    proponer(1);
    proponer(2);
    expect(D.itfTieneVigente(WELL, derivar(), true)).toBe(true);
    expect(D.itfDominio_documentoParaDescarga(estado()).documentoId).toBe(LEGACY_ID);
  });
  test('sin legacy, las propuestas pendientes NO cuentan como "Tiene ITF" ni se descargan', () => {
    legacyEstado[WELL] = false;
    proponer(1);
    expect(D.itfTieneVigente(WELL, derivar(), false)).toBe(false);
    expect(D.itfDominio_documentoParaDescarga(estado())).toBeNull();
  });
  test('con un vigente E9 se descarga SOLO ese documento (no tambien el legacy), y nunca propuestas, rechazados ni historicos', () => {
    legacyEstado[WELL] = true;
    const d1 = proponer(1).resultado.documentoId;
    decidir(val, { accion: 'APROBAR', documentoId: d1, documentoReemplazadoId: LEGACY_ID, motivoCodigo: 'ACTUALIZACION' });
    const d2 = proponer(2).resultado.documentoId;
    decidir(val, { accion: 'RECHAZAR', documentoId: d2, motivoCodigo: 'ILEGIBLE' });
    proponer(3);
    expect(D.itfDominio_documentoParaDescarga(estado())).toEqual({ documentoId: d1, origen: 'E9' });
  });
});

describe('E9-2 no toca produccion', () => {
  test('cargar los modulos y derivar NO crea ninguna hoja', () => {
    const hojas = instalarSheetsFalsos({});
    D.itfDominio_derivar([]);
    require('../src/ItfEventosRepository');
    expect(Object.keys(hojas)).toEqual([]);
  });
  test('el setup crea la hoja solo cuando se lo llama a mano, y es idempotente', () => {
    const hojas = instalarSheetsFalsos({});
    expect(R.setupItfEventosSheet()).toBe('CREADA');
    expect(R.setupItfEventosSheet()).toBe('YA_EXISTE');
    expect(Object.keys(hojas)).toEqual(['ItfEventos']);
  });
});
