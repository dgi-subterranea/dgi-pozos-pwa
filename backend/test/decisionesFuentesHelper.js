// Entorno comun de los tests de las decisiones sobre fuentes registrales (backend): Apps Script falso, hoja en memoria, padron falso (modificable para simular un
// reindexado), usuarios con permisos, reloj controlado, CacheService con espias y los modulos REALES (dominio + repositorio + servicio + Api).
const { installAppsScriptFakes } = require('./appsScriptFakes');
const { instalarSheetsFalsos } = require('./fakeSheets');

// Las tres fuentes de 14-0001 (Reporte Pozos + Irrigacion (1) coinciden a 5 m; Irrigacion (2) esta a ~170 m) y una sola de 01-0012.
const P_REPORTE = { x: 2486460.782, y: 6310651.228 };
const P_IRR1 = { x: 2486464.782, y: 6310654.228 };
const P_IRR2 = { x: 2486590.782, y: 6310541.228 };
const P_UNICA = { x: 2500000, y: 6350000 };
const padronInicial = () => ({
  '14-0001': { coordenadas: { ...P_REPORTE }, coordenadasProvincia: [{ ...P_IRR1 }, { ...P_IRR2 }] },
  '01-0012': { coordenadas: null, coordenadasProvincia: [{ ...P_UNICA }] },
  '03-0003': { coordenadas: null, coordenadasProvincia: [] }
});

const USUARIOS = {
  'val@x.com': { nombre: 'Valeria Validadora', permisos: { ubicacion: true, ubicacion_validar: true } },
  'vero@x.com': { nombre: 'Vero Validadora', permisos: { ubicacion: true, ubicacion_validar: true } },
  'ana@x.com': { nombre: 'Ana Corrige', permisos: { ubicacion: true, ubicacion_corregir: true } },
  'carla@x.com': { nombre: 'Carla Directa', permisos: { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true } },
  'lee@x.com': { nombre: 'Lee Soloubicacion', permisos: { ubicacion: true } },
  'soloval@x.com': { nombre: 'Solo Validar', permisos: { ubicacion_validar: true } },
  'nada@x.com': { nombre: 'Sin Permisos', permisos: {} },
  'baja@x.com': { nombre: 'Usuario Inactivo', permisos: { ubicacion: true, ubicacion_validar: true }, inactivo: true }
};

function crearCache() {
  // el almacenamiento se lee SIEMPRE de c.store (no de una variable cerrada): asi un test puede vaciar el cache con `t.cache.store = {}` y realmente se vacia
  const c = {
    store: {},
    ttl: {},
    falla: { get: false, put: false, remove: false, getAll: false, putAll: false },
    get: jest.fn((k) => { if (c.falla.get) { throw new Error('cache get caido'); } return Object.prototype.hasOwnProperty.call(c.store, k) ? c.store[k] : null; }),
    put: jest.fn((k, v, ttl) => { if (c.falla.put) { throw new Error('cache put caido'); } c.store[k] = v; c.ttl[k] = ttl; }),
    remove: jest.fn((k) => { if (c.falla.remove) { throw new Error('cache remove caido'); } delete c.store[k]; }),
    // como el real: hasta 100 claves por llamada; solo devuelve las que estan
    getAll: jest.fn((keys) => {
      if (c.falla.getAll) { throw new Error('cache getAll caido'); }
      if (keys.length > 100) { throw new Error('getAll admite hasta 100 claves'); }
      const r = {};
      keys.forEach((k) => { if (Object.prototype.hasOwnProperty.call(c.store, k)) { r[k] = c.store[k]; } });
      return r;
    }),
    putAll: jest.fn((obj, ttl) => {
      if (c.falla.putAll) { throw new Error('cache putAll caido'); }
      if (Object.keys(obj).length > 100) { throw new Error('putAll admite hasta 100 claves'); }
      Object.keys(obj).forEach((k) => { c.store[k] = obj[k]; c.ttl[k] = ttl; });
    })
  };
  return c;
}

// Devuelve el contexto. Llamar en un beforeEach.
function armar(opciones) {
  const o = opciones || {};
  jest.resetModules();
  installAppsScriptFakes();
  const ctx = {};
  global.Logger = { log: jest.fn() };
  global.ContentService = { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }) };
  ctx.Api = require('../src/Api');
  ctx.Dominio = require('../src/UbicacionFuenteDecisionesLogic');
  ctx.Repo = require('../src/UbicacionFuenteDecisionesRepository');
  ctx.Corr = require('../src/UbicacionCorreccionService');
  ctx.S = require('../src/UbicacionFuenteDecisionesService');
  ctx.RepoSug = require('../src/UbicacionFuenteSugerenciasRepository');
  ctx.Sug = require('../src/UbicacionFuenteSugerenciasService');
  ctx.CorrNotif = require('../src/UbicacionCorreccionNotificacion');
  ctx.Notif = require('../src/UbicacionFuenteSugerenciaNotificacion');
  Object.assign(global, ctx.Dominio, ctx.Repo, ctx.Corr, ctx.S, ctx.RepoSug, ctx.Sug, ctx.CorrNotif, ctx.Notif);                    // en Apps Script todo es global
  const hojasIniciales = {};
  if (!o.sinHoja) {
    hojasIniciales.UbicacionFuenteDecisiones = [ctx.Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS];
    if (!o.sinHojaSug) {
      hojasIniciales.UbicacionFuenteSugerencias = [ctx.RepoSug.UBICACION_FUENTE_SUGERENCIAS_COLUMNAS];
    }
  }
  ctx.hojas = instalarSheetsFalsos(hojasIniciales);
  ctx.padron = padronInicial();
  ctx.metadata = { periodo: '2026-09' };
  global.registryService_getWellLocation = jest.fn((id) => (ctx.padron[id] ? { found: true, location: { wellId: id, ...JSON.parse(JSON.stringify(ctx.padron[id])), ubicacionResuelta: { estado: 'x' } } } : { found: false }));
  global.registryService_getMetadata = jest.fn(() => ({ found: true, metadata: ctx.metadata }));
  // lectura en LOTE del padron (la usa el delta): mismo padron falso; `padronNoResuelto` simula pozos cuyo archivo no se pudo leer y `alLeerLotePadron` una lectura lenta
  ctx.padronNoResuelto = new Set();
  ctx.padronLotes = [];
  ctx.alLeerLotePadron = null;
  global.registryService_getWellLocations = jest.fn((ids, op) => {
    ctx.padronLotes.push({ ids: ids.slice(), deadlineMs: op && op.deadlineMs });
    if (ctx.alLeerLotePadron) { ctx.alLeerLotePadron(ids); }
    const locations = {};
    const noResueltos = [];
    ids.forEach((id) => {
      if (ctx.padronNoResuelto.has(id) || (op && typeof op.deadlineMs === 'number' && Date.now() >= op.deadlineMs)) { noResueltos.push(id); return; }
      locations[id] = ctx.padron[id] ? { wellId: id, ...JSON.parse(JSON.stringify(ctx.padron[id])), ubicacionResuelta: { estado: 'x' } } : null;
    });
    return { locations, noResueltos, archivosAbiertos: 0, desdeCache: 0, errores: [] };
  });
  global.logHistoryEvent = jest.fn();
  global.verifySessionToken.mockImplementation((t) => (String(t).startsWith('tok-') && USUARIOS[String(t).slice(4)] ? { valid: true, email: String(t).slice(4) } : { valid: false, reason: 'token' }));
  global.isUserActive.mockImplementation((e) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true);
  global.getUserAccess.mockImplementation((e) => ({ active: !!USUARIOS[e], nombre: USUARIOS[e].nombre, permisos: USUARIOS[e].permisos }));
  global.hasPermission.mockImplementation((e, m) => !!USUARIOS[e] && USUARIOS[e].inactivo !== true && USUARIOS[e].permisos[m] === true);
  // reloj controlado (Date.now): el servicio fecha con Date.now() y el cache usa la marca de invalidacion con margen de 2 s
  ctx.reloj = Date.UTC(2026, 9, 14, 14, 32, 10, 123);
  jest.spyOn(Date, 'now').mockImplementation(() => ctx.reloj);
  ctx.calmar = () => { ctx.reloj += 60000; };
  ctx.cache = crearCache();
  global.CacheService = { getScriptCache: () => ctx.cache };
  // lock: permite ejecutar un "otro validador" justo cuando este toma el lock (simula escrituras simultaneas entre el pedido y la lectura bajo lock)
  ctx.alTomarLock = null;
  ctx.locks = { tomados: 0, liberados: 0 };
  global.LockService = {
    getScriptLock: () => ({
      waitLock: () => { ctx.locks.tomados += 1; if (ctx.alTomarLock) { const h = ctx.alTomarLock; ctx.alTomarLock = null; h(); } },
      releaseLock: () => { ctx.locks.liberados += 1; }
    })
  };
  ctx.filas = () => ctx.hojas.UbicacionFuenteDecisiones.filas.slice(1).map((f) => f.slice());
  ctx.columnas = ctx.Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS;
  ctx.fila = (i) => { const f = ctx.hojas.UbicacionFuenteDecisiones.filas[i + 1]; const o2 = {}; ctx.columnas.forEach((c, k) => { o2[c] = f[k]; }); return o2; };
  return ctx;
}

let contadorId = 0;
const nuevoId = () => { contadorId += 1; return 'req-' + String(contadorId).padStart(6, '0'); };

// Solicitud al servicio (por defecto: ACEPTAR el Reporte Pozos de 14-0001 con la version actual 0)
function solicitud(extra) {
  return { wellId: '14-0001', fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y, accion: 'ACEPTAR', motivo: '', versionVista: 0, clientRequestId: nuevoId(), ...(extra || {}) };
}

module.exports = { armar, solicitud, nuevoId, crearCache, USUARIOS, P_REPORTE, P_IRR1, P_IRR2, P_UNICA, padronInicial };
