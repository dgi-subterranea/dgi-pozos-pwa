// E8-3: operaciones de moderacion de fotos de pozos sobre hojas EN MEMORIA con los repositorios REALES (FotosPozos + FotosPozoEventos): escrituras bajo lock, idempotencia, revalidacion de estado
// DENTRO del lock, invalidacion de cache exacta y DESPUES del lock, fail-closed si falta la hoja, historial, cola y lecturas de galeria. El dominio puro esta en FotosPozosModeracionService.test.js
// y el cableado HTTP en ApiFotosPozosModeracion.test.js.
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

const Repo = require('../src/FotosPozosRepository');
const Eventos = require('../src/FotosPozoEventosRepository');
const M = require('../src/FotosPozosModeracionService');
const Ops = require('../src/FotosPozosModeracionOperaciones');
const Service = require('../src/FotosPozosService');

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const F1 = uuid(1);
const F2 = uuid(2);
const F3 = uuid(3);
const MOD = { email: 'mod@x.com', nombre: 'Moderadora Uno', permisos: { fotos: true, fotos_moderar: true } };
const ANA = { email: 'ana@x.com', nombre: 'Ana', permisos: { fotos: true, fotos_carga: true } };
const COLS = Eventos.FOTOS_POZO_EVENTOS_COLUMNAS;

let hojas;
let bitacora;
let cache;
let nCrid;
const crid = () => 'req-' + String(++nCrid).padStart(8, '0');

function filaFoto(id, extra) {
  const indices = Repo.fotosPozosRepository_indiceColumnas(Repo.FOTOS_POZOS_COLUMNAS);
  return Repo.fotosPozosRepository_filaDesdeFoto(Object.assign({
    fotoId: id, wellId: '14-0001', monitoringId: '', estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', fuente: 'CAMPO_APP', tipoFoto: 'OTRA',
    fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES', emailUsuarioCarga: 'ana@x.com', timestampRegistro: '2026-10-07 12:55:23',
    driveFileId: 'DRIVE_FILE_ID_' + id.slice(-4), driveThumbId: 'DRIVE_THUMB_ID_' + id.slice(-4)
  }, extra || {}), indices, Repo.FOTOS_POZOS_COLUMNAS.length);
}

function instalar(fotos, filasEventos, sinHojaEventos) {
  const def = { FotosPozos: [Repo.FOTOS_POZOS_COLUMNAS].concat(fotos) };
  if (!sinHojaEventos) {
    def.FotosPozoEventos = [COLS].concat(filasEventos || []);
  }
  hojas = instalarSheetsFalsos(def);
  // lock instrumentado: deja constancia en una bitacora comun con el cache
  global.LockService = { getScriptLock: () => ({ waitLock: () => { bitacora.push('lock'); }, releaseLock: () => { bitacora.push('unlock'); } }) };
}

function filaEvento(e) {
  return COLS.map((c) => (e[c] === undefined ? '' : e[c]));
}
const evSol = (n, foto, extra) => filaEvento(Object.assign({ eventoId: uuid(500 + n), secuencia: n, evento: 'RETIRO_SOLICITADO', fotoId: foto, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', email: 'ana@x.com', nombre: 'Ana', timestampUtc: '2026-10-2' + n + 'T10:00:00.000Z', clientRequestId: 'seed-' + String(n).padStart(8, '0') }, extra || {}));
const evRet = (n, foto, extra) => filaEvento(Object.assign({ eventoId: uuid(500 + n), secuencia: n, evento: 'RETIRADA', fotoId: foto, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', email: 'mod@x.com', nombre: 'Moderadora Uno', timestampUtc: '2026-10-2' + n + 'T10:00:00.000Z', clientRequestId: 'seed-' + String(n).padStart(8, '0') }, extra || {}));

const filasEventos = () => hojas.FotosPozoEventos.filas.slice(1);
const colEv = (c) => COLS.indexOf(c);

function ejecutar(accion, datos, actor) {
  const a = actor || MOD;
  return Ops.fotosPozosModeracionOps_ejecutar(Object.assign({ accion: accion, clientRequestId: crid() }, datos), { email: a.email, nombre: a.nombre, permisos: a.permisos });
}

beforeEach(() => {
  installAppsScriptFakes();
  global.Logger = { log: jest.fn() };
  Object.assign(global, Repo, Eventos, M, Ops);
  nCrid = 0;
  bitacora = [];
  cache = global.CacheService.getScriptCache();
  const remove = cache.remove.bind(cache);
  cache.remove = jest.fn((k) => { bitacora.push('remove:' + k); return remove(k); });
  instalar([filaFoto(F1), filaFoto(F2), filaFoto(F3, { wellId: '', monitoringId: 'INA 536' })]);
});

describe('escritura basica: un evento por operacion, entidad y datos tomados del SERVIDOR', () => {
  test('solicitar retiro: escribe RETIRO_SOLICITADO con la entidad de la foto (no la del cliente) y secuencia 1', () => {
    const r = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(r).toMatchObject({ ok: true, duplicada: false, evento: { evento: 'RETIRO_SOLICITADO', fotoId: F1 }, entidad: { tipo: 'WELL', id: '14-0001' } });
    expect(filasEventos()).toHaveLength(1);
    const f = filasEventos()[0];
    expect(f[colEv('evento')]).toBe('RETIRO_SOLICITADO');
    expect(f[colEv('secuencia')]).toBe(1);
    expect(f[colEv('email')]).toBe('ana@x.com');
    expect(f[colEv('entidadId')]).toBe('14-0001');
    expect(r.evento.eventoId).toBe(f[colEv('eventoId')]);
  });

  test('un punto NE especial se resuelve por monitoringId (entidad MONITORING)', () => {
    const r = ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'MALA_CALIDAD' });
    expect(r).toMatchObject({ ok: true, entidad: { tipo: 'MONITORING', id: 'INA 536' } });
  });

  test('retirar escribe RETIRADA; la secuencia es global y consecutiva', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RETIRAR', { fotoId: F2, motivoCodigo: 'MALA_CALIDAD' });
    ejecutar('SOLICITAR_RETIRO', { fotoId: F3, motivoCodigo: 'OTRO', motivoTexto: 'borrosa del todo' }, ANA);
    expect(filasEventos().map((f) => f[colEv('secuencia')])).toEqual([1, 2, 3]);
    expect(filasEventos().map((f) => f[colEv('evento')])).toEqual(['RETIRO_SOLICITADO', 'RETIRADA', 'RETIRO_SOLICITADO']);
  });

  test('resolver: la foto y la entidad salen de la SOLICITUD; el cliente solo manda solicitudId + resolucion', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const r = ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' });
    expect(r).toMatchObject({ ok: true, evento: { evento: 'RETIRO_RESUELTO', fotoId: F1, solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' }, entidad: { tipo: 'WELL', id: '14-0001' } });
    const f = filasEventos()[1];
    expect(f[colEv('fotoId')]).toBe(F1);
    expect(f[colEv('entidadId')]).toBe('14-0001');
  });

  test('foto inexistente en FotosPozos -> FOTO_NOT_FOUND y no se escribe nada', () => {
    expect(ejecutar('RETIRAR', { fotoId: uuid(99), motivoCodigo: 'DUPLICADA' })).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(filasEventos()).toHaveLength(0);
  });

  test('solicitud inexistente -> error y no se escribe nada', () => {
    const r = ejecutar('RESOLVER_RETIRO', { solicitudId: uuid(98), resolucion: 'APROBADO' });
    expect(r.ok).toBe(false);
    expect(filasEventos()).toHaveLength(0);
  });

  test('RETIRAR con una solicitud ABIERTA -> SOLICITUD_ABIERTA (nunca resuelve implicitamente)', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toMatchObject({ ok: false, code: 'SOLICITUD_ABIERTA' });
    expect(filasEventos()).toHaveLength(1);
  });

  test('reponer: solo lo retirado por eventos; una OCULTA legacy NO se repone', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(ejecutar('REPONER', { fotoId: F1 })).toMatchObject({ ok: true, evento: { evento: 'REPUESTA' } });
    expect(ejecutar('REPONER', { fotoId: F1 })).toMatchObject({ ok: false, code: 'FOTO_NO_RETIRADA' });
    instalar([filaFoto(F1, { estado: 'OCULTA' })]);
    expect(ejecutar('REPONER', { fotoId: F1 })).toMatchObject({ ok: false, code: 'REPOSICION_NO_PERMITIDA' });
    expect(filasEventos()).toHaveLength(0);
  });

  test('permiso insuficiente (defensa en profundidad): PERMISSION_DENIED sin leer ni escribir', () => {
    const r = ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(r).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(filasEventos()).toHaveLength(0);
    expect(bitacora).toEqual([]);
  });

  test('entrada invalida: se rechaza ANTES de tomar el lock', () => {
    expect(ejecutar('RETIRAR', { fotoId: 'no-es-uuid', motivoCodigo: 'DUPLICADA' })).toMatchObject({ ok: false, code: 'INVALID_FOTO_ID' });
    expect(Ops.fotosPozosModeracionOps_ejecutar({ accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'corto' }, MOD)).toMatchObject({ code: 'INVALID_CLIENT_REQUEST_ID' });
    expect(bitacora).toEqual([]);
  });

  test('el no-moderador no distingue "no existe" de "retirada" (solicitar: mismo codigo)', () => {
    ejecutar('RETIRAR', { fotoId: F2, motivoCodigo: 'DUPLICADA' });
    const inexistente = ejecutar('SOLICITAR_RETIRO', { fotoId: uuid(77), motivoCodigo: 'DUPLICADA' }, ANA);
    const retirada = ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(inexistente).toEqual(retirada);
    expect(inexistente.code).toBe('FOTO_NOT_FOUND');
  });
});

describe('idempotencia', () => {
  test('el reintento exacto devuelve el mismo resultado como duplicada, sin fila nueva, sin lock y sin invalidar cache', () => {
    const datos = { fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000001' };
    const a = Ops.fotosPozosModeracionOps_ejecutar(Object.assign({ accion: 'RETIRAR' }, datos), MOD);
    bitacora.length = 0;
    cache.remove.mockClear();
    const b = Ops.fotosPozosModeracionOps_ejecutar(Object.assign({ accion: 'RETIRAR' }, datos), MOD);
    expect(b).toMatchObject({ ok: true, duplicada: true, evento: { eventoId: a.evento.eventoId, evento: 'RETIRADA' } });
    expect(filasEventos()).toHaveLength(1);
    expect(bitacora).toEqual([]);
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('mismo clientRequestId con OTRO contenido -> IDEMPOTENCY_CONFLICT (no se escribe nada)', () => {
    Ops.fotosPozosModeracionOps_ejecutar({ accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000002' }, MOD);
    const r = Ops.fotosPozosModeracionOps_ejecutar({ accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'MALA_CALIDAD', clientRequestId: 'retry-0000002' }, MOD);
    expect(r).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    const r2 = Ops.fotosPozosModeracionOps_ejecutar({ accion: 'RETIRAR', fotoId: F2, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000002' }, MOD);
    expect(r2).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(filasEventos()).toHaveLength(1);
  });

  test('la idempotencia es por usuario: otro usuario con el mismo clientRequestId es una operacion distinta', () => {
    Ops.fotosPozosModeracionOps_ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'mismo-id-0001' }, ANA);
    const otro = { email: 'luis@x.com', nombre: 'Luis', permisos: { fotos: true, fotos_carga: true } };
    expect(Ops.fotosPozosModeracionOps_ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: F2, motivoCodigo: 'DUPLICADA', clientRequestId: 'mismo-id-0001' }, otro)).toMatchObject({ ok: true, duplicada: false });
    expect(filasEventos()).toHaveLength(2);
  });

  test('el email de la sesion se normaliza (mayusculas / espacios): el mismo usuario reintenta con otra grafia y es el mismo pedido', () => {
    const datos = { accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000009' };
    Ops.fotosPozosModeracionOps_ejecutar(datos, Object.assign({}, MOD, { email: 'Mod@X.com' }));
    expect(filasEventos()[0][colEv('email')]).toBe('mod@x.com');
    const otra = Ops.fotosPozosModeracionOps_ejecutar(datos, Object.assign({}, MOD, { email: ' MOD@x.COM ' }));
    expect(otra).toMatchObject({ ok: true, duplicada: true });
    expect(filasEventos()).toHaveLength(1);
  });

  test('un reintento DESPUES de que otro cambio el estado sigue siendo duplicada (no un error de transicion)', () => {
    const datos = { accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'retry-0000003' };
    Ops.fotosPozosModeracionOps_ejecutar(datos, MOD);
    ejecutar('REPONER', { fotoId: F1 });
    expect(Ops.fotosPozosModeracionOps_ejecutar(datos, MOD)).toMatchObject({ ok: true, duplicada: true });
    expect(filasEventos()).toHaveLength(2);
  });

  test('el retry dentro del lock (carrera entre dos copias del mismo pedido) tambien se reconoce', () => {
    const datos = { accion: 'RETIRAR', fotoId: F1, motivoCodigo: 'DUPLICADA', clientRequestId: 'carrera-00001' };
    let primera = true;
    global.LockService = {
      getScriptLock: () => ({
        waitLock: () => {
          if (primera) {
            primera = false;
            hojas.FotosPozoEventos.filas.push(evRet(1, F1, { eventoId: uuid(800), email: 'mod@x.com', clientRequestId: 'carrera-00001' }));
          }
        },
        releaseLock: () => {}
      })
    };
    const r = Ops.fotosPozosModeracionOps_ejecutar(datos, MOD);
    expect(r).toMatchObject({ ok: true, duplicada: true, evento: { eventoId: uuid(800) } });
    expect(filasEventos()).toHaveLength(1);
  });
});

describe('concurrencia: el estado se revalida DENTRO del lock', () => {
  const concurrente = (fila) => {
    let hecho = false;
    global.LockService = {
      getScriptLock: () => ({
        waitLock: () => { bitacora.push('lock'); if (!hecho) { hecho = true; hojas.FotosPozoEventos.filas.push(fila); } },
        releaseLock: () => { bitacora.push('unlock'); }
      })
    };
  };

  test('otro moderador retiro la foto mientras esperaba el lock: FOTO_YA_RETIRADA y no se duplica el evento', () => {
    concurrente(evRet(1, F1));
    expect(ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toMatchObject({ ok: false, code: 'FOTO_YA_RETIRADA' });
    expect(filasEventos()).toHaveLength(1);
    expect(bitacora).toContain('unlock');
  });

  test('otro moderador resolvio la solicitud mientras esperaba: SOLICITUD_YA_RESUELTA', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    concurrente(filaEvento({ eventoId: uuid(810), secuencia: 2, evento: 'RETIRO_RESUELTO', fotoId: F1, entidadTipo: 'WELL', entidadId: '14-0001', solicitudId: sol.evento.eventoId, resolucion: 'RECHAZADO', email: 'otro@x.com', nombre: 'Otro', timestampUtc: '2026-10-27T11:00:00.000Z', clientRequestId: 'otro-0000001' }));
    expect(ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' })).toMatchObject({ ok: false, code: 'SOLICITUD_YA_RESUELTA' });
    expect(filasEventos()).toHaveLength(2);
  });

  test('alguien abrio una solicitud mientras esperaba: RETIRAR devuelve SOLICITUD_ABIERTA', () => {
    concurrente(evSol(1, F1));
    expect(ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toMatchObject({ ok: false, code: 'SOLICITUD_ABIERTA' });
    expect(filasEventos()).toHaveLength(1);
  });

  test('la secuencia se calcula dentro del lock sobre lo que hay AHORA en la hoja (no se pisa la del otro)', () => {
    concurrente(evSol(1, F2));
    const r = ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(r.ok).toBe(true);
    expect(filasEventos().map((f) => f[colEv('secuencia')])).toEqual([1, 2]);
  });

  test('un cambio rechazado por el estado dentro del lock NO invalida el cache', () => {
    concurrente(evRet(1, F1));
    cache.remove.mockClear();
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('si la lectura de eventos DENTRO del lock falla, se lanza: nunca se planifica "sin moderar" ni se escribe', () => {
    let lecturas = 0;
    const real = Eventos.fotosPozoEventosRepository_leerTodos;
    global.fotosPozoEventosRepository_leerTodos = () => { lecturas += 1; throw new Error('lectura rota'); };
    expect(() => ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toThrow();
    expect(lecturas).toBe(1);
    expect(filasEventos()).toHaveLength(0);
    expect(cache.remove).not.toHaveBeenCalled();
    expect(bitacora).toEqual(['lock', 'unlock']);
    global.fotosPozoEventosRepository_leerTodos = real;
  });

  test('si no se consigue el lock se lanza, no se escribe nada y no se invalida el cache', () => {
    global.LockService = { getScriptLock: () => ({ waitLock: () => { throw new Error('timeout del lock'); }, releaseLock: () => {} }) };
    expect(() => ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toThrow();
    expect(filasEventos()).toHaveLength(0);
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('si falla la escritura, el lock se libera y el cache no se toca', () => {
    const getRange = hojas.FotosPozoEventos.getRange.bind(hojas.FotosPozoEventos);
    hojas.FotosPozoEventos.getRange = (...a) => {
      const rango = getRange(...a);
      rango.setValues = () => { throw new Error('Sheets no disponible'); };
      return rango;
    };
    expect(() => ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toThrow();
    expect(bitacora).toEqual(['lock', 'unlock']);
    expect(cache.remove).not.toHaveBeenCalled();
  });
});

describe('invalidacion de cache: exactamente las claves de la foto + el resumen, y solo despues de liberar el lock', () => {
  const CLAVES = ['fotospozos_m_' + F1, 'fotospozos_t_' + F1, 'fotospozos_resumen'];
  const removidas = () => bitacora.filter((b) => b.indexOf('remove:') === 0).map((b) => b.slice(7));

  test('RETIRADA invalida el conjunto exacto y siempre despues de unlock', () => {
    const r = ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(removidas().sort()).toEqual(CLAVES.slice().sort());
    expect(r.cacheInvalidado.slice().sort()).toEqual(CLAVES.slice().sort());
    expect(bitacora.indexOf('unlock')).toBeLessThan(bitacora.findIndex((b) => b.indexOf('remove:') === 0));
  });

  test('RETIRO_RESUELTO APROBADO invalida; RETIRO_RESUELTO RECHAZADO no', () => {
    const s1 = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const s2 = ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(removidas()).toEqual([]);
    ejecutar('RESOLVER_RETIRO', { solicitudId: s2.evento.eventoId, resolucion: 'RECHAZADO' });
    expect(removidas()).toEqual([]);
    ejecutar('RESOLVER_RETIRO', { solicitudId: s1.evento.eventoId, resolucion: 'APROBADO' });
    expect(removidas().sort()).toEqual(CLAVES.slice().sort());
  });

  test('REPUESTA invalida', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    bitacora.length = 0;
    ejecutar('REPONER', { fotoId: F1 });
    expect(removidas().sort()).toEqual(CLAVES.slice().sort());
  });

  test('RETIRO_SOLICITADO no invalida nada (la foto sigue visible)', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('no se invalida el cache de OTRAS fotos', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(removidas().filter((k) => k.indexOf(F2) >= 0)).toEqual([]);
  });

  test('si el cache falla, la escritura ya hecha se informa como OK (se loguea) y la imagen igual se protege por eventos', () => {
    cache.remove.mockImplementation(() => { throw new Error('cache caido'); });
    const r = ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(r).toMatchObject({ ok: true, duplicada: false });
    expect(filasEventos()).toHaveLength(1);
    expect(global.Logger.log).toHaveBeenCalled();
    const log = global.Logger.log.mock.calls.map((c) => c[0]).join('\n');
    expect(log).not.toContain('ana@x.com');
  });
});

describe('fail-closed: la hoja de eventos es parte necesaria del contrato', () => {
  test('hoja FotosPozoEventos inexistente: las escrituras LANZAN y la hoja NO se auto-crea', () => {
    instalar([filaFoto(F1)], [], true);
    expect(() => ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toThrow();
    expect(() => ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA)).toThrow();
    expect(Object.keys(hojas)).toEqual(['FotosPozos']);
    expect(cache.remove).not.toHaveBeenCalled();
  });

  test('hoja con esquema roto (falta una columna): lanza', () => {
    hojas.FotosPozoEventos.filas[0] = COLS.slice(0, 5);
    expect(() => ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' })).toThrow();
    expect(() => Ops.fotosPozosModeracionOps_cargarDerivacion()).toThrow();
  });

  test('la derivacion, el historial, la cola y la imagen del moderador tambien lanzan sin la hoja', () => {
    instalar([filaFoto(F1)], [], true);
    expect(() => Ops.fotosPozosModeracionOps_cargarDerivacion()).toThrow();
    expect(() => Ops.fotosPozosModeracionOps_historial(F1)).toThrow();
    expect(() => Ops.fotosPozosModeracionOps_cola()).toThrow();
  });

  test('la galeria, el resumen y la imagen NO muestran fotos sin la hoja (nada de "sin moderar")', () => {
    instalar([filaFoto(F1)], [], true);
    expect(() => Service.fotosPozosService_listar('14-0001', '', 'recientes')).toThrow();
    expect(() => Service.fotosPozosService_resumen()).toThrow();
    expect(() => Service.fotosPozosService_obtenerImagen(F1, 'thumb')).toThrow();
  });

  test('una foto con historial NO derivable (secuencia duplicada) nunca se muestra como activa', () => {
    instalar([filaFoto(F1), filaFoto(F2)], [evRet(5, F1), evRet(5, F1, { eventoId: uuid(900), evento: 'REPUESTA' })]);
    const lista = Service.fotosPozosService_listar('14-0001', '', 'recientes');
    // solo la afectada desaparece: F1 no es derivable; F2 no tiene eventos y sigue siendo ACTIVA por baseline
    expect(lista.fotos.map((f) => f.fotoId)).toEqual([F2]);
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
  });
});

describe('lecturas de galeria con la hoja de eventos', () => {
  beforeEach(() => {
    global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
  });
  const ids = (r) => r.fotos.map((f) => f.fotoId).sort();

  test('listar: una foto retirada (por eventos) deja de aparecer; una con solicitud abierta SIGUE apareciendo', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([F2]);
  });

  test('listar: una OCULTA legacy no aparece y una repuesta vuelve a aparecer', () => {
    instalar([filaFoto(F1), filaFoto(F2, { estado: 'OCULTA' })]);
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([F1]);
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([]);
    ejecutar('REPONER', { fotoId: F1 });
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([F1]);
  });

  test('una foto nueva (sin eventos) es ACTIVA por baseline: subirFotoPozo no necesita escribir eventos', () => {
    instalar([filaFoto(F1)]);
    expect(filasEventos()).toHaveLength(0);
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([F1]);
  });

  test('resumen: cuenta solo las visibles (la solicitud abierta cuenta, la retirada no, la OCULTA no)', () => {
    instalar([filaFoto(F1), filaFoto(F2), filaFoto(uuid(4), { estado: 'OCULTA' }), filaFoto(F3, { wellId: '', monitoringId: 'INA 536' })]);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(Service.fotosPozosService_resumen()).toEqual({ '14-0001': 2, 'INA 536': 1 });
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'DUPLICADA' });
    expect(Service.fotosPozosService_resumen()).toEqual({ '14-0001': 2 });
  });

  test('imagen: retirar invalida y la foto deja de servirse (miniatura y completa); reponer la sirve de nuevo', () => {
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb').ok).toBe(true);
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(Service.fotosPozosService_obtenerImagen(F1, 'full')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    ejecutar('REPONER', { fotoId: F1 });
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb').ok).toBe(true);
  });

  test('imagen con CACHE VIEJO: aunque el cache no se haya invalidado, una retirada por eventos no se sirve', () => {
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb').ok).toBe(true);
    hojas.FotosPozoEventos.filas.push(evRet(1, F1));
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
  });

  test('eventos atribuidos a OTRA entidad: la foto no es derivable y no se sirve ni se lista, aunque los eventos solos parezcan consistentes', () => {
    hojas.FotosPozoEventos.filas.push(evSol(1, F1, { entidadId: '99-9999' }));
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, Ops.fotosPozosModeracionOps_cargarDerivacion())).toBe(true);
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb')).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(ids(Service.fotosPozosService_listar('14-0001', '', 'recientes'))).toEqual([F2]);
    expect(Service.fotosPozosService_resumen()).toEqual({ '14-0001': 1, 'INA 536': 1 });
  });

  test('una solicitud abierta no corta la imagen', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb').ok).toBe(true);
  });

  test('la hoja de eventos se lee UNA vez por llamada de galeria', () => {
    const espia = jest.spyOn(Eventos, 'fotosPozoEventosRepository_leerTodos');
    global.fotosPozoEventosRepository_leerTodos = Eventos.fotosPozoEventosRepository_leerTodos;
    const real = Eventos.fotosPozoEventosRepository_leerTodos;
    const contador = jest.fn(real);
    global.fotosPozoEventosRepository_leerTodos = contador;
    Service.fotosPozosService_listar('14-0001', '', 'recientes');
    expect(contador).toHaveBeenCalledTimes(1);
    espia.mockRestore();
  });
});

describe('historial de una foto (vista de moderador)', () => {
  test('eventos MAS RECIENTE PRIMERO con la resolucion de la solicitud, sin email / clientRequestId / secuencia', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' });
    ejecutar('REPONER', { fotoId: F1 });
    ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    const h = Ops.fotosPozosModeracionOps_historial(F1);
    expect(h.ok).toBe(true);
    expect(h.eventos.map((e) => e.evento)).toEqual(['REPUESTA', 'RETIRO_RESUELTO', 'RETIRO_SOLICITADO']);
    expect(h.eventos[2]).toMatchObject({ solicitudId: sol.evento.eventoId, motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara', nombre: 'Ana' });
    expect(h.eventos[1]).toMatchObject({ solicitudId: sol.evento.eventoId, resolucion: 'APROBADO', nombre: 'Moderadora Uno', motivoTexto: '' });
    expect(h.estado).toMatchObject({ estado: 'ACTIVA', visible: true, solicitudAbierta: null, integridad: 'OK' });
    const json = JSON.stringify(h);
    expect(json).not.toMatch(/ana@x\.com|mod@x\.com|clientRequestId|secuencia|DRIVE_|req-0000/);
    h.eventos.forEach((e) => {
      expect(Object.keys(e).sort()).toEqual(['evento', 'motivoCodigo', 'motivoTexto', 'nombre', 'resolucion', 'solicitudId', 'timestampUtc']);
      expect(e.timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  test('foto: solo metadata basica de la entidad, sin ids de Drive', () => {
    const h = Ops.fotosPozosModeracionOps_historial(F1);
    expect(h.foto).toEqual({ fotoId: F1, entidadTipo: 'WELL', entidadId: '14-0001', tipoFoto: 'OTRA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' });
    expect(h.eventos).toEqual([]);
  });

  test('PRIVACIDAD: marca requiereRevisionBorrado; una OCULTA legacy informa su origen', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'PRIVACIDAD' });
    expect(Ops.fotosPozosModeracionOps_historial(F1).estado).toMatchObject({ estado: 'RETIRADA', visible: false, requiereRevisionBorrado: true, origenRetiro: 'EVENTO', puedeReponerse: true });
    instalar([filaFoto(F2, { estado: 'OCULTA' })]);
    expect(Ops.fotosPozosModeracionOps_historial(F2).estado).toMatchObject({ estado: 'RETIRADA', origenRetiro: 'LEGACY_OCULTA', puedeReponerse: false });
  });

  test('foto inexistente y fotoId invalido', () => {
    expect(Ops.fotosPozosModeracionOps_historial(uuid(97))).toMatchObject({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(Ops.fotosPozosModeracionOps_historial('x')).toMatchObject({ ok: false, code: 'INVALID_FOTO_ID' });
    expect(Ops.fotosPozosModeracionOps_historial(undefined)).toMatchObject({ ok: false, code: 'INVALID_FOTO_ID' });
  });

  test('una foto retirada tambien tiene historial (el moderador la ve)', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'MALA_CALIDAD' });
    const h = Ops.fotosPozosModeracionOps_historial(F1);
    expect(h.ok).toBe(true);
    expect(h.eventos).toHaveLength(1);
    expect(h.eventos[0]).toMatchObject({ evento: 'RETIRADA', motivoCodigo: 'MALA_CALIDAD' });
  });

  test('un evento de tipo desconocido no se filtra tal cual al cliente', () => {
    hojas.FotosPozoEventos.filas.push(evRet(1, F2, { evento: 'EVENTO_RARO', motivoTexto: 'secreto interno' }));
    const h = Ops.fotosPozosModeracionOps_historial(F2);
    expect(h.eventos[0].evento).toBe('DESCONOCIDO');
    expect(h.eventos[0].motivoTexto).toBe('');
    expect(h.estado.integridad).toBe('NO_DERIVABLE');
  });
});

describe('cola de solicitudes abiertas', () => {
  test('solo abiertas, mas reciente primero, sin email / secuencia / ids de Drive / base64', () => {
    const a = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const b = ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'OTRO', motivoTexto: 'no es el pozo' }, ANA);
    const c = ejecutar('SOLICITAR_RETIRO', { fotoId: F3, motivoCodigo: 'MALA_CALIDAD' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: a.evento.eventoId, resolucion: 'RECHAZADO' });
    const r = Ops.fotosPozosModeracionOps_cola();
    expect(r).toMatchObject({ ok: true, total: 2, hayMas: false, cursor: null });
    expect(r.items.map((i) => i.solicitudId)).toEqual([c.evento.eventoId, b.evento.eventoId]);
    expect(r.items[1]).toMatchObject({ fotoId: F2, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'OTRO', motivoTexto: 'no es el pozo', nombre: 'Ana' });
    expect(r.items[0]).toMatchObject({ entidadTipo: 'MONITORING', entidadId: 'INA 536' });
    expect(JSON.stringify(r)).not.toMatch(/ana@x\.com|clientRequestId|secuencia|DRIVE_|base64|req-0000/i);
    r.items.forEach((i) => { expect(typeof i.timestampUtc).toBe('string'); });
  });

  test('una solicitud ya aprobada, o de una foto retirada, no queda en la cola', () => {
    const a = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: a.evento.eventoId, resolucion: 'APROBADO' });
    expect(Ops.fotosPozosModeracionOps_cola()).toMatchObject({ total: 0, items: [] });
  });

  test('paginacion por cursor: determinista, sin repetir ni saltear', () => {
    const fotos = [];
    for (let i = 10; i < 17; i++) { fotos.push(filaFoto(uuid(i))); }
    instalar(fotos);
    const sol = [];
    for (let i = 10; i < 17; i++) { sol.push(ejecutar('SOLICITAR_RETIRO', { fotoId: uuid(i), motivoCodigo: 'DUPLICADA' }, ANA).evento.eventoId); }
    const orden = sol.slice().reverse();
    const p1 = Ops.fotosPozosModeracionOps_cola(3);
    expect(p1).toMatchObject({ total: 7, hayMas: true });
    expect(p1.items.map((i) => i.solicitudId)).toEqual(orden.slice(0, 3));
    const p2 = Ops.fotosPozosModeracionOps_cola(3, p1.cursor);
    expect(p2.items.map((i) => i.solicitudId)).toEqual(orden.slice(3, 6));
    expect(p2.hayMas).toBe(true);
    const p3 = Ops.fotosPozosModeracionOps_cola(3, p2.cursor);
    expect(p3.items.map((i) => i.solicitudId)).toEqual(orden.slice(6));
    expect(p3).toMatchObject({ hayMas: false, cursor: null });
  });

  test('limit y cursor invalidos se rechazan; el limite maximo es 100 y el defecto 50', () => {
    [0, -1, 101, 1.5, '5', NaN, Infinity, {}].forEach((l) => { expect(Ops.fotosPozosModeracionOps_cola(l)).toMatchObject({ ok: false, code: 'INVALID_LIMIT' }); });
    [0, -3, 2.5, 'x', NaN].forEach((c) => { expect(Ops.fotosPozosModeracionOps_cola(10, c)).toMatchObject({ ok: false, code: 'INVALID_CURSOR' }); });
    expect(Ops.fotosPozosModeracionOps_parametrosCola(undefined, undefined)).toEqual({ ok: true, limit: 50, cursor: null });
    expect(Ops.fotosPozosModeracionOps_parametrosCola(100, 7)).toEqual({ ok: true, limit: 100, cursor: 7 });
    expect(Ops.FOTOS_MOD_OPS_LIMITE_MAX).toBe(100);
    expect(Ops.FOTOS_MOD_OPS_LIMITE_DEFECTO).toBe(50);
  });

  test('lee la hoja de eventos UNA vez y FotosPozos UNA vez (sin N+1)', () => {
    for (let i = 0; i < 5; i++) { ejecutar('SOLICITAR_RETIRO', { fotoId: [F1, F2, F3][i % 3], motivoCodigo: 'DUPLICADA' }, ANA); }
    const eventos = jest.fn(Eventos.fotosPozoEventosRepository_leerTodos);
    const fotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozoEventosRepository_leerTodos = eventos;
    global.fotosPozosRepository_leerTodasLasFotos = fotos;
    Ops.fotosPozosModeracionOps_cola();
    expect(eventos).toHaveBeenCalledTimes(1);
    expect(fotos).toHaveBeenCalledTimes(1);
  });

  test('la cantidad de lecturas de las hojas NO crece con la cantidad de solicitudes (sin N+1)', () => {
    const contar = () => {
      let n = 0;
      ['FotosPozos', 'FotoPozoEventos', 'FotosPozoEventos'].forEach((nombre) => {
        const h = hojas[nombre];
        if (!h) { return; }
        const gr = h.getRange.bind(h);
        const gd = h.getDataRange.bind(h);
        h.getRange = (...a) => { n += 1; return gr(...a); };
        h.getDataRange = (...a) => { n += 1; return gd(...a); };
      });
      return () => n;
    };
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const leidasUna = contar();
    Ops.fotosPozosModeracionOps_cola();
    const conUna = leidasUna();
    ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F3, motivoCodigo: 'DUPLICADA' }, ANA);
    const leidasTres = contar();
    Ops.fotosPozosModeracionOps_cola();
    expect(leidasTres()).toBe(conUna);
    expect(conUna).toBeGreaterThan(0);
  });

  test('cola vacia: no lee FotosPozos', () => {
    const fotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozosRepository_leerTodasLasFotos = fotos;
    expect(Ops.fotosPozosModeracionOps_cola()).toMatchObject({ ok: true, total: 0, items: [], hayMas: false, cursor: null });
    expect(fotos).not.toHaveBeenCalled();
  });
});

describe('imagen para el moderador', () => {
  beforeEach(() => {
    global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA', driveFileId: 'SECRETO', extra: 'x' });
  });

  test('sirve una foto ACTIVA y tambien una RETIRADA, solo con {fotoId, variante, mimeType, imagenBase64}', () => {
    expect(Ops.fotosPozosModeracionOps_imagen(F1, 'thumb')).toEqual({ ok: true, imagen: { fotoId: F1, variante: 'thumb', mimeType: 'image/jpeg', imagenBase64: 'AAAA' } });
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'PRIVACIDAD' });
    const r = Ops.fotosPozosModeracionOps_imagen(F1, 'full');
    expect(r.ok).toBe(true);
    expect(Object.keys(r.imagen).sort()).toEqual(['fotoId', 'imagenBase64', 'mimeType', 'variante']);
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|DRIVE_/);
    expect(global.fotosStorageClient_obtenerPozo).toHaveBeenLastCalledWith('DRIVE_FILE_ID_0001', 'DRIVE_THUMB_ID_0001', 'full');
  });

  test('tambien sirve una OCULTA legacy', () => {
    instalar([filaFoto(F1, { estado: 'OCULTA' })]);
    expect(Ops.fotosPozosModeracionOps_imagen(F1, 'thumb').ok).toBe(true);
  });

  test('no usa ni llena el cache de la galeria', () => {
    Ops.fotosPozosModeracionOps_imagen(F1, 'thumb');
    expect(cache.get('fotospozos_m_' + F1)).toBeNull();
    expect(cache.get('fotospozos_t_' + F1)).toBeNull();
  });

  test('fotoId / variante invalidos, foto inexistente y storage caido', () => {
    expect(Ops.fotosPozosModeracionOps_imagen('x', 'thumb')).toMatchObject({ code: 'INVALID_FOTO_ID' });
    expect(Ops.fotosPozosModeracionOps_imagen(F1, 'grande')).toMatchObject({ code: 'INVALID_VARIANTE' });
    expect(Ops.fotosPozosModeracionOps_imagen(uuid(96), 'thumb')).toMatchObject({ code: 'FOTO_NOT_FOUND' });
    global.fotosStorageClient_obtenerPozo.mockImplementation(() => { throw new Error('storage caido https://script.google.com/macros/s/SECRETO/exec'); });
    const r = Ops.fotosPozosModeracionOps_imagen(F1, 'thumb');
    expect(r).toMatchObject({ ok: false, code: 'STORAGE_UNAVAILABLE' });
    expect(JSON.stringify(r)).not.toMatch(/SECRETO|script\.google/);
  });

  test('no escribe eventos ni toca Drive', () => {
    Ops.fotosPozosModeracionOps_imagen(F1, 'thumb');
    expect(filasEventos()).toHaveLength(0);
    expect(global.DriveApp).toBeUndefined();
  });
});

describe('permitidaPorEventos (puerta previa a servir una imagen)', () => {
  const D = (filas) => M.fotosPozosModeracion_derivar(Eventos.fotosPozoEventosRepository_leerTodos().eventos);
  test('sin eventos de la foto -> permitida; retirada -> no; repuesta -> si; solicitud abierta -> si', () => {
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, D())).toBe(true);
    hojas.FotosPozoEventos.filas.push(evSol(1, F1));
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, D())).toBe(true);
    hojas.FotosPozoEventos.filas.push(evRet(2, F2));
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F2, D())).toBe(false);
    hojas.FotosPozoEventos.filas.push(filaEvento({ eventoId: uuid(600), secuencia: 3, evento: 'REPUESTA', fotoId: F2, entidadTipo: 'WELL', entidadId: '14-0001', email: 'mod@x.com', nombre: 'M', timestampUtc: '2026-10-27T10:00:00.000Z', clientRequestId: 'seed-00000003' }));
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F2, D())).toBe(true);
  });

  test('historial NO derivable (secuencia duplicada) -> false aunque su estado parcial parezca activo', () => {
    hojas.FotosPozoEventos.filas.push(evSol(5, F1));
    hojas.FotosPozoEventos.filas.push(evSol(5, F1, { eventoId: uuid(901), clientRequestId: 'seed-00000099' }));
    const d = D();
    expect(d.porFoto[F1].integridad).toBe('NO_DERIVABLE');
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, d)).toBe(false);
  });

  test('id invalido o derivacion invalida -> false (fail-closed)', () => {
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos('', D())).toBe(false);
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, null)).toBe(false);
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1, {})).toBe(false);
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(null, D())).toBe(false);
  });

  test('id con mayusculas se normaliza', () => {
    hojas.FotosPozoEventos.filas.push(evRet(1, F1));
    expect(Ops.fotosPozosModeracionOps_permitidaPorEventos(F1.toUpperCase(), D())).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// E8-5
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

// cuenta lecturas de las hojas (getRange / getDataRange) desde que se llama
function contadorDeLecturas() {
  let n = 0;
  ['FotosPozos', 'FotosPozoEventos'].forEach((nombre) => {
    const h = hojas[nombre];
    if (!h) { return; }
    const gr = h.getRange.bind(h);
    const gd = h.getDataRange.bind(h);
    h.getRange = (...a) => { n += 1; return gr(...a); };
    h.getDataRange = (...a) => { n += 1; return gd(...a); };
  });
  return () => n;
}

describe('galeria: tieneSolicitudRetiro (booleano derivado de los eventos reales)', () => {
  const galeria = () => Service.fotosPozosService_listar('14-0001', '', 'recientes');
  const flags = () => {
    const r = galeria();
    const m = {};
    r.fotos.forEach((f) => { m[f.fotoId] = f.tieneSolicitudRetiro; });
    return m;
  };

  test('activa sin solicitud -> false', () => {
    expect(flags()).toEqual({ [F1]: false, [F2]: false });
  });

  test('activa con solicitud ABIERTA -> true, la foto SIGUE en la galeria y el resto sigue en false', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(flags()).toEqual({ [F1]: true, [F2]: false });
    expect(galeria().total).toBe(2);
  });

  test('solicitud RECHAZADA -> false (y la foto sigue activa)', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'RECHAZADO' });
    expect(flags()).toEqual({ [F1]: false, [F2]: false });
  });

  test('solicitud APROBADA -> la foto ya no aparece en la galeria normal', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' });
    expect(flags()).toEqual({ [F2]: false });
  });

  test('rechazada y una NUEVA solicitud -> vuelve a true; aprobada y repuesta -> false', () => {
    const a = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: a.evento.eventoId, resolucion: 'RECHAZADO' });
    const b = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'MALA_CALIDAD' }, ANA);
    expect(flags()[F1]).toBe(true);
    ejecutar('RESOLVER_RETIRO', { solicitudId: b.evento.eventoId, resolucion: 'APROBADO' });
    ejecutar('REPONER', { fotoId: F1 });
    expect(flags()[F1]).toBe(false);
  });

  test('retirada directa y repuesta -> false; una OCULTA legacy no aparece', () => {
    instalar([filaFoto(F1), filaFoto(F2, { estado: 'OCULTA' })]);
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    expect(flags()).toEqual({});
    ejecutar('REPONER', { fotoId: F1 });
    expect(flags()).toEqual({ [F1]: false });
  });

  test('varias fotos con estados distintos a la vez: cada una con SU solicitud', () => {
    instalar([filaFoto(F1), filaFoto(F2), filaFoto(uuid(4)), filaFoto(uuid(5)), filaFoto(F3, { wellId: '', monitoringId: 'INA 536' })]);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const r = ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: r.evento.eventoId, resolucion: 'RECHAZADO' });
    ejecutar('SOLICITAR_RETIRO', { fotoId: uuid(5), motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F3, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(flags()).toEqual({ [F1]: true, [F2]: false, [uuid(4)]: false, [uuid(5)]: true });
    expect(Service.fotosPozosService_listar('', 'INA 536', 'recientes').fotos.map((f) => f.tieneSolicitudRetiro)).toEqual([true]);
  });

  test('historial corrupto (secuencia duplicada) -> fail-closed: la foto no aparece, ni siquiera con la solicitud abierta', () => {
    hojas.FotosPozoEventos.filas.push(evSol(1, F1), evSol(1, F1, { eventoId: uuid(777) }));
    expect(flags()).toEqual({ [F2]: false });
  });

  test('una solicitud atribuida a OTRA entidad (no coincide con la foto) no es derivable: fail-closed, la foto no se muestra', () => {
    hojas.FotosPozoEventos.filas.push(evSol(1, F1, { entidadId: '99-9999' }));
    expect(flags()).toEqual({ [F2]: false });
  });

  test('sin hoja de eventos: la galeria lanza (nada de mostrar "sin moderar")', () => {
    instalar([filaFoto(F1)], null, true);
    expect(() => galeria()).toThrow();
  });

  test('SOLO un booleano: nada de la solicitud (id, motivo, texto, nombre, fecha, email) sale en la galeria y las claves son exactas', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'OTRO', motivoTexto: 'texto privado de Ana' }, ANA);
    const r = galeria();
    r.fotos.forEach((f) => {
      expect(Object.keys(f).sort()).toEqual(['alto', 'ancho', 'fechaFotoFuente', 'fechaFotoPrecision', 'fechaFotoValor', 'fotoId', 'fuente', 'observacion', 'tieneGps', 'tieneSolicitudRetiro', 'tipoFoto']);
      expect(typeof f.tieneSolicitudRetiro).toBe('boolean');
    });
    expect(JSON.stringify(r)).not.toMatch(/ana@x\.com|texto privado|"Ana"|motivo|DRIVE_|clientRequestId|secuencia|timestamp|solicitudId/);
  });

  test('el booleano NO cambia el contador: una foto con solicitud abierta sigue contando', () => {
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(Service.fotosPozosService_resumen()).toEqual({ '14-0001': 2, 'INA 536': 1 });
    expect(galeria().total).toBe(2);
  });

  test('la imagen de una foto con solicitud abierta se sigue sirviendo', () => {
    global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(Service.fotosPozosService_obtenerImagen(F1, 'thumb').ok).toBe(true);
  });

  test('sin N+1: leer la galeria cuesta las MISMAS lecturas de hoja con 2 fotos que con 42, y la hoja de eventos se lee una vez', () => {
    const fotos40 = [];
    for (let i = 10; i < 50; i++) { fotos40.push(filaFoto(uuid(i))); }
    instalar([filaFoto(F1), filaFoto(F2)]);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    const leidasPocas = contadorDeLecturas();
    galeria();
    const pocas = leidasPocas();

    instalar([filaFoto(F1), filaFoto(F2)].concat(fotos40));
    for (let i = 10; i < 30; i++) { ejecutar('SOLICITAR_RETIRO', { fotoId: uuid(i), motivoCodigo: 'DUPLICADA' }, ANA); }
    const leidasMuchas = contadorDeLecturas();
    const eventos = jest.fn(Eventos.fotosPozoEventosRepository_leerTodos);
    global.fotosPozoEventosRepository_leerTodos = eventos;
    const r = galeria();
    expect(r.total).toBe(42);
    expect(r.fotos.filter((f) => f.tieneSolicitudRetiro)).toHaveLength(20);
    expect(leidasMuchas()).toBe(pocas);
    expect(pocas).toBeGreaterThan(0);
    expect(eventos).toHaveBeenCalledTimes(1);
  });
});

describe('galeria: cache y solicitudes (auditoria de E8-5)', () => {
  beforeEach(() => {
    global.fotosStorageClient_obtenerPozo = jest.fn().mockReturnValue({ mimeType: 'image/jpeg', imagenBase64: 'AAAA' });
  });
  const flagF1 = () => Service.fotosPozosService_listar('14-0001', '', 'recientes').fotos.find((f) => f.fotoId === F1).tieneSolicitudRetiro;
  const quitados = () => bitacora.filter((b) => b.indexOf('remove:') === 0);

  test('la lista de la galeria NO se cachea: el booleano refleja la solicitud aunque el cache de ids / miniaturas / resumen este lleno', () => {
    Service.fotosPozosService_resumen();
    Service.fotosPozosService_obtenerImagen(F1, 'thumb');
    expect(flagF1()).toBe(false);
    ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(flagF1()).toBe(true);
  });

  test('solicitar y rechazar NO invalidan ninguna clave (no cambian la visibilidad): el booleano cambia igual, sin tocar el cache', () => {
    Service.fotosPozosService_resumen();
    Service.fotosPozosService_obtenerImagen(F1, 'thumb');
    bitacora.length = 0;
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    expect(sol.cacheInvalidado).toEqual([]);
    expect(flagF1()).toBe(true);
    const rech = ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'RECHAZADO' });
    expect(rech.cacheInvalidado).toEqual([]);
    expect(flagF1()).toBe(false);
    expect(quitados()).toEqual([]);
    expect(cache.get('fotospozos_resumen')).not.toBeNull();
    expect(cache.get('fotospozos_t_' + F1)).not.toBeNull();
  });

  test('aprobar SI usa la invalidacion completa de E8-3 (metadata, miniatura y resumen de esa foto)', () => {
    Service.fotosPozosService_resumen();
    Service.fotosPozosService_obtenerImagen(F1, 'thumb');
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    bitacora.length = 0;
    const ap = ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' });
    expect(ap.cacheInvalidado.slice().sort()).toEqual(['fotospozos_m_' + F1, 'fotospozos_resumen', 'fotospozos_t_' + F1].sort());
    expect(quitados().sort()).toEqual(['remove:fotospozos_m_' + F1, 'remove:fotospozos_resumen', 'remove:fotospozos_t_' + F1].sort());
  });
});

describe('fotos retiradas (listado institucional para moderadores)', () => {
  const retiradas = (l, c) => Ops.fotosPozosModeracionOps_retiradas(l, c);

  test('vacio: sin retiradas no lee FotosPozos y devuelve un listado vacio', () => {
    const fotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozosRepository_leerTodasLasFotos = fotos;
    expect(retiradas()).toEqual({ ok: true, total: 0, items: [], hayMas: false, cursor: null });
    expect(fotos).not.toHaveBeenCalled();
  });

  test('retirada directa: motivo, detalle, quien la retiro, metadata de la foto y entidad; la mas reciente primero', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'OTRO', motivoTexto: 'no es el punto' }, { email: 'otro@x.com', nombre: 'Otro Moderador', permisos: MOD.permisos });
    const r = retiradas();
    expect(r).toMatchObject({ ok: true, total: 2, hayMas: false, cursor: null });
    expect(r.items.map((i) => i.fotoId)).toEqual([F3, F1]);
    expect(r.items[0]).toEqual({
      fotoId: F3, entidadTipo: 'MONITORING', entidadId: 'INA 536', origenRetiro: 'EVENTO', motivoCodigo: 'OTRO', motivoTexto: 'no es el punto', nombre: 'Otro Moderador',
      timestampUtc: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), viaSolicitud: false, requiereRevisionBorrado: false,
      foto: { tipoFoto: 'OTRA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' }
    });
    expect(r.items[1]).toMatchObject({ fotoId: F1, entidadTipo: 'WELL', entidadId: '14-0001', motivoCodigo: 'DUPLICADA', motivoTexto: '', nombre: 'Moderadora Uno' });
  });

  test('retirada por APROBAR una solicitud: el motivo es el de la solicitud y el nombre es de quien aprobo', () => {
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' }, { email: 'jefe@x.com', nombre: 'Jefe Foto', permisos: MOD.permisos });
    const [item] = retiradas().items;
    expect(item).toMatchObject({ fotoId: F1, origenRetiro: 'EVENTO', motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara', nombre: 'Jefe Foto', viaSolicitud: true });
  });

  test('una solicitud RECHAZADA o ABIERTA no es una retirada; tampoco una foto repuesta', () => {
    const a = ejecutar('SOLICITAR_RETIRO', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: a.evento.eventoId, resolucion: 'RECHAZADO' });
    ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'DUPLICADA' }, ANA);
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'DUPLICADA' });
    ejecutar('REPONER', { fotoId: F3 });
    expect(retiradas()).toMatchObject({ total: 0, items: [] });
  });

  test('PRIVACIDAD marca requiereRevisionBorrado (retirada directa y aprobada); los demas motivos no', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'PRIVACIDAD' });
    const sol = ejecutar('SOLICITAR_RETIRO', { fotoId: F2, motivoCodigo: 'PRIVACIDAD' }, ANA);
    ejecutar('RESOLVER_RETIRO', { solicitudId: sol.evento.eventoId, resolucion: 'APROBADO' });
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'MALA_CALIDAD' });
    const m = {};
    retiradas().items.forEach((i) => { m[i.fotoId] = i.requiereRevisionBorrado; });
    expect(m).toEqual({ [F1]: true, [F2]: true, [F3]: false });
  });

  test('una OCULTA legacy NO aparece (ningun evento la revive): ni sola ni con eventos', () => {
    instalar([filaFoto(F1, { estado: 'OCULTA' }), filaFoto(F2, { estado: 'OCULTA' }), filaFoto(F3, { wellId: '', monitoringId: 'INA 536' })]);
    hojas.FotosPozoEventos.filas.push(evRet(1, F2));
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'DUPLICADA' });
    expect(retiradas().items.map((i) => i.fotoId)).toEqual([F3]);
    expect(retiradas().total).toBe(1);
  });

  test('una foto con historial NO derivable no aparece; una foto sin fila en FotosPozos tampoco; ni una con el vinculo sin confirmar', () => {
    instalar([filaFoto(F1), filaFoto(F2, { estadoVinculo: 'PENDIENTE' }), filaFoto(F3, { wellId: '', monitoringId: 'INA 536' })]);
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'DUPLICADA' });
    hojas.FotosPozoEventos.filas.push(evRet(11, F1), evRet(11, F1, { eventoId: uuid(888) }));      // secuencia duplicada
    hojas.FotosPozoEventos.filas.push(evRet(12, F2));
    hojas.FotosPozoEventos.filas.push(evRet(13, uuid(99)));                                        // sin fila en FotosPozos
    expect(retiradas().items.map((i) => i.fotoId)).toEqual([F3]);
  });

  test('una foto retirada con eventos de OTRA entidad no es derivable y no aparece', () => {
    hojas.FotosPozoEventos.filas.push(evRet(1, F1, { entidadId: '99-9999' }));
    expect(retiradas().total).toBe(0);
  });

  test('la que se repone sale del listado y la que se vuelve a retirar vuelve a entrar (mas reciente primero)', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    ejecutar('RETIRAR', { fotoId: F2, motivoCodigo: 'DUPLICADA' });
    ejecutar('REPONER', { fotoId: F1 });
    expect(retiradas().items.map((i) => i.fotoId)).toEqual([F2]);
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'MALA_CALIDAD' });
    expect(retiradas().items.map((i) => i.fotoId)).toEqual([F1, F2]);
    expect(retiradas().items[0].motivoCodigo).toBe('MALA_CALIDAD');
  });

  test('paginacion por cursor: determinista, sin repetir ni saltear, y el cursor es estable aunque se agreguen retiradas nuevas', () => {
    const fotos = [];
    for (let i = 10; i < 17; i++) { fotos.push(filaFoto(uuid(i))); }
    fotos.push(filaFoto(uuid(40)));
    instalar(fotos);
    for (let i = 10; i < 17; i++) { ejecutar('RETIRAR', { fotoId: uuid(i), motivoCodigo: 'DUPLICADA' }); }
    const orden = [16, 15, 14, 13, 12, 11, 10].map(uuid);
    const p1 = retiradas(3);
    expect(p1).toMatchObject({ total: 7, hayMas: true });
    expect(p1.items.map((i) => i.fotoId)).toEqual(orden.slice(0, 3));
    const p2 = retiradas(3, p1.cursor);
    expect(p2.items.map((i) => i.fotoId)).toEqual(orden.slice(3, 6));
    expect(p2.hayMas).toBe(true);
    const p3 = retiradas(3, p2.cursor);
    expect(p3.items.map((i) => i.fotoId)).toEqual(orden.slice(6));
    expect(p3).toMatchObject({ hayMas: false, cursor: null });
    // una retirada nueva (secuencia mayor) no desplaza lo que falta de la pagina siguiente
    ejecutar('RETIRAR', { fotoId: uuid(40), motivoCodigo: 'DUPLICADA' });
    expect(retiradas(3, p1.cursor).items.map((i) => i.fotoId)).toEqual(orden.slice(3, 6));
  });

  test('limit y cursor invalidos se rechazan igual que en la cola (defecto 50, maximo 100)', () => {
    [0, -1, 101, 1.5, '5', NaN, Infinity, {}].forEach((l) => { expect(retiradas(l)).toMatchObject({ ok: false, code: 'INVALID_LIMIT' }); });
    [0, -3, 2.5, 'x', NaN].forEach((c) => { expect(retiradas(10, c)).toMatchObject({ ok: false, code: 'INVALID_CURSOR' }); });
  });

  test('con mas de 50 retiradas el defecto pagina en 50', () => {
    const fotos = [];
    for (let i = 100; i < 160; i++) { fotos.push(filaFoto(uuid(i))); }
    instalar(fotos);
    for (let i = 100; i < 160; i++) { ejecutar('RETIRAR', { fotoId: uuid(i), motivoCodigo: 'DUPLICADA' }); }
    const r = retiradas();
    expect(r.items).toHaveLength(50);
    expect(r).toMatchObject({ total: 60, hayMas: true });
    expect(retiradas(undefined, r.cursor).items).toHaveLength(10);
  });

  test('sin email / clientRequestId / secuencia / ids de Drive / base64 / URLs, y las claves del item son exactas', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'OTRO', motivoTexto: 'detalle' });
    const r = retiradas();
    expect(Object.keys(r.items[0]).sort()).toEqual(['entidadId', 'entidadTipo', 'foto', 'fotoId', 'motivoCodigo', 'motivoTexto', 'nombre', 'origenRetiro', 'requiereRevisionBorrado', 'timestampUtc', 'viaSolicitud']);
    expect(Object.keys(r.items[0].foto).sort()).toEqual(['fechaFotoPrecision', 'fechaFotoValor', 'fuente', 'tipoFoto']);
    expect(JSON.stringify(r)).not.toMatch(/mod@x\.com|ana@x\.com|clientRequestId|secuencia|DRIVE_|base64|https?:|req-0000/i);
  });

  test('un nombre que parece un email se muestra neutro', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' }, { email: 'mod@x.com', nombre: 'mod@x.com', permisos: MOD.permisos });
    expect(retiradas().items[0].nombre).toBe('Usuario');
  });

  test('lee la hoja de eventos UNA vez y FotosPozos UNA vez (sin N+1)', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    ejecutar('RETIRAR', { fotoId: F2, motivoCodigo: 'DUPLICADA' });
    ejecutar('RETIRAR', { fotoId: F3, motivoCodigo: 'DUPLICADA' });
    const eventos = jest.fn(Eventos.fotosPozoEventosRepository_leerTodos);
    const fotos = jest.fn(Repo.fotosPozosRepository_leerTodasLasFotos);
    global.fotosPozoEventosRepository_leerTodos = eventos;
    global.fotosPozosRepository_leerTodasLasFotos = fotos;
    expect(retiradas().total).toBe(3);
    expect(eventos).toHaveBeenCalledTimes(1);
    expect(fotos).toHaveBeenCalledTimes(1);
  });

  test('la cantidad de lecturas de hoja NO crece con la cantidad de retiradas (sin N+1)', () => {
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    const unaLectura = contadorDeLecturas();
    retiradas();
    const conUna = unaLectura();
    const fotos = [];
    for (let i = 10; i < 40; i++) { fotos.push(filaFoto(uuid(i))); }
    instalar([filaFoto(F1), filaFoto(F2), filaFoto(F3)].concat(fotos));
    ejecutar('RETIRAR', { fotoId: F1, motivoCodigo: 'DUPLICADA' });
    for (let i = 10; i < 40; i++) { ejecutar('RETIRAR', { fotoId: uuid(i), motivoCodigo: 'DUPLICADA' }); }
    const muchas = contadorDeLecturas();
    expect(retiradas(100).items).toHaveLength(31);
    expect(muchas()).toBe(conUna);
    expect(conUna).toBeGreaterThan(0);
  });

  test('sin la hoja de eventos el listado lanza (fail-closed)', () => {
    instalar([filaFoto(F1)], null, true);
    expect(() => retiradas()).toThrow();
  });
});
