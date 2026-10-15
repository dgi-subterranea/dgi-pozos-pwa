// Entorno comun de los tests de SUGERENCIAS de decisiones sobre fuentes registrales (Etapa C): el mismo entorno de las decisiones (Apps Script falso, hojas en memoria, padron falso
// modificable, usuarios, reloj controlado, cache con espias, lock simulado) mas atajos para sugerir / resolver / cancelar y para leer las hojas como objetos.
const { armar, solicitud, nuevoId, P_REPORTE, P_IRR1, P_IRR2, P_UNICA } = require('./decisionesFuentesHelper');

const W = '14-0001';
const LEE = 'lee@x.com';          // ubicacion, sin ubicacion_validar: NO valida
const ANA = 'ana@x.com';          // ubicacion + ubicacion_corregir, sin validar: tampoco valida
const VAL = 'val@x.com';          // valida
const VERO = 'vero@x.com';        // valida
const NOMBRES = { 'lee@x.com': 'Lee Soloubicacion', 'ana@x.com': 'Ana Corrige', 'val@x.com': 'Valeria Validadora', 'vero@x.com': 'Vero Validadora', 'carla@x.com': 'Carla Directa' };
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const I1 = { fuenteTipo: 'IRRIGACION', x: P_IRR1.x, y: P_IRR1.y };
const I2 = { fuenteTipo: 'IRRIGACION', x: P_IRR2.x, y: P_IRR2.y };
const UNICA = { fuenteTipo: 'IRRIGACION', x: P_UNICA.x, y: P_UNICA.y };

function armarSug(opciones) {
  const t = armar(opciones);
  const S = t.Sug;
  const dec = t.S;
  t.objetosDe = (hoja, columnas) => hoja.filas.slice(1).map((f) => { const o = {}; columnas.forEach((c, k) => { o[c] = f[k]; }); return o; });
  t.filasSug = () => t.objetosDe(t.hojas.UbicacionFuenteSugerencias, t.RepoSug.UBICACION_FUENTE_SUGERENCIAS_COLUMNAS);
  t.filasDec = () => t.objetosDe(t.hojas.UbicacionFuenteDecisiones, t.Repo.UBICACION_FUENTE_DECISIONES_COLUMNAS);
  t.versionDe = (w) => t.filasDec().filter((f) => f.wellId === (w || W)).reduce((m, f) => Math.max(m, f.secuencia), 0);

  // --- decisiones DIRECTAS (las de siempre): sirven para dejar una fuente en un estado antes de sugerir ---
  t.decidirDirecto = (accion, fuente, extra, quien) => dec.ubicacionFuenteDecisionesService_decidir(quien || VAL, NOMBRES[quien || VAL], solicitud(Object.assign({ wellId: W, accion: accion, versionVista: t.versionDe(W), motivo: accion === 'DESCARTAR' ? 'motivo directo' : '' }, fuente, extra || {})));
  t.vistaDecisiones = () => { t.cache.store = {}; return dec.ubicacionFuenteDecisionesService_getPorPozo(W).data; };

  // --- sugerencias ---
  t.payloadSug = (extra) => Object.assign({ wellId: W, accionSugerida: 'ACEPTAR', motivo: '', versionVista: 0, clientRequestId: nuevoId() }, REP, extra || {});
  t.sugerir = (extra, quien) => S.ubicacionFuenteSugerenciasService_sugerir(quien || LEE, NOMBRES[quien || LEE], t.payloadSug(extra));
  t.payloadRes = (sugerenciaId, extra) => Object.assign({ sugerenciaId: sugerenciaId, resolucion: 'APROBAR', motivo: '', versionVista: t.versionDe(W), clientRequestId: nuevoId() }, extra || {});
  t.resolver = (sugerenciaId, extra, quien) => S.ubicacionFuenteSugerenciasService_resolver(quien || VAL, NOMBRES[quien || VAL], t.payloadRes(sugerenciaId, extra));
  t.rechazar = (sugerenciaId, extra, quien) => t.resolver(sugerenciaId, Object.assign({ resolucion: 'RECHAZAR', motivo: 'no corresponde', versionVista: undefined }, extra || {}), quien);
  t.cancelar = (sugerenciaId, extra, quien) => S.ubicacionFuenteSugerenciasService_cancelar(quien || LEE, NOMBRES[quien || LEE], Object.assign({ sugerenciaId: sugerenciaId, motivo: '', clientRequestId: nuevoId() }, extra || {}));
  t.verPozo = (quien, esValidador, w) => S.ubicacionFuenteSugerenciasService_getPorPozo(quien || LEE, esValidador === true, w || W);
  t.verCola = () => { return S.ubicacionFuenteSugerenciasService_getPendientes(); };
  t.idDe = (r) => r.sugerencia.sugerenciaId;

  // siembra eventos "a mano" en la hoja de sugerencias (como si ya existieran); cada spec pisa los valores por defecto
  let n = 0;
  t.sembrar = (...specs) => {
    specs.forEach((e) => {
      n += 1;
      const id = 'semilla-' + String(n).padStart(5, '0');
      const maxExistente = t.filasSug().reduce((m, f) => (typeof f.secuencia === 'number' ? Math.max(m, f.secuencia) : m), 0);
      const o = Object.assign({
        sugerenciaId: id, secuencia: maxExistente + 1, evento: 'PROPUESTA', wellId: '09-0001', fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1, accionSugerida: 'ACEPTAR', motivo: '', email: LEE, nombre: 'Lee',
        timestampUtc: '2026-01-01T00:00:00.000Z', clientRequestId: 'semilla-req-' + n, versionVista: 0
      }, e);
      t.hojas.UbicacionFuenteSugerencias.filas.push(t.RepoSug.UBICACION_FUENTE_SUGERENCIAS_COLUMNAS.map((c) => o[c]));
    });
    t.cache.store = {};
  };
  // n pendientes APLICABLES hoy de `email` (Reporte Pozos de 14-0001 sin revisar, ACEPTAR): las que SI cuentan para el limite de 10
  t.sembrarAplicables = (cantidad, email, extra) => t.sembrar(...Array.from({ length: cantidad }, () => Object.assign({ email: email || LEE, wellId: W, accionSugerida: 'ACEPTAR' }, REP, extra || {})));
  return t;
}

module.exports = { armarSug, W, LEE, ANA, VAL, VERO, NOMBRES, REP, I1, I2, UNICA, solicitud, nuevoId, P_REPORTE, P_IRR1, P_IRR2, P_UNICA };
