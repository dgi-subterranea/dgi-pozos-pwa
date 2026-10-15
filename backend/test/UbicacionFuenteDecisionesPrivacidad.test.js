// Privacidad de las respuestas al cliente de getDecisionesFuentesPozo y decidirFuenteUbicacion: forma exacta y ausencia de datos internos o ajenos.
const { armar, solicitud, P_REPORTE, P_IRR1 } = require('./decisionesFuentesHelper');

let t;
const W = '14-0001';
beforeEach(() => { t = armar(); });
afterEach(() => { jest.restoreAllMocks(); });

const PROHIBIDAS = ['email', 'decisionId', 'clientRequestId', 'versionVista', 'anomalias', 'stack', 'padron', 'telefono', 'titular', 'propietario', 'usuario'];
function claves(o, acc) {
  acc = acc || [];
  if (Array.isArray(o)) { o.forEach((x) => claves(x, acc)); } else if (o && typeof o === 'object') { Object.keys(o).forEach((k) => { acc.push(k); claves(o[k], acc); }); }
  return acc;
}
const REP = { fuenteTipo: 'REPORTE_POZOS', x: P_REPORTE.x, y: P_REPORTE.y };
const escribir = (token, extra) => t.Api.handleDecidirFuenteUbicacion(token, solicitud({ wellId: W, accion: 'ACEPTAR', versionVista: 0, ...REP, ...(extra || {}) }));

describe('payloads al cliente', () => {
  test('decidirFuenteUbicacion: forma exacta, sin emails, ids internos ni clientRequestId', () => {
    const r = escribir('tok-val@x.com');
    expect(r.status).toBe('ok');
    expect(Object.keys(r.data).sort()).toEqual(['decision', 'duplicada', 'fuentes', 'historial', 'integro', 'obsoletas', 'padronPeriodo', 'resolucion', 'version', 'wellId']);
    expect(Object.keys(r.data.decision).sort()).toEqual(['evento', 'fuenteTipo', 'motivo', 'nombre', 'secuencia', 'timestampUtc', 'x', 'y']);
    const ks = claves(r);
    PROHIBIDAS.forEach((k) => expect(ks).not.toContain(k));
    expect(JSON.stringify(r)).not.toMatch(/@|val@x\.com|req-0/);
  });

  test('getDecisionesFuentesPozo: nombre humano si, email de otros no, tampoco clientRequestId ajeno', () => {
    escribir('tok-val@x.com');
    t.cache.store = {};
    const r = t.Api.handleGetDecisionesFuentesPozo('tok-lee@x.com', W);
    expect(r.status).toBe('ok');
    expect(r.data.historial[0].nombre).toBe('Valeria Validadora');
    const ks = claves(r);
    PROHIBIDAS.forEach((k) => expect(ks).not.toContain(k));
    expect(JSON.stringify(r)).not.toMatch(/@|req-0/);
    expect(Object.keys(r.data.historial[0]).sort()).toEqual(['descartaLaAceptada', 'evento', 'fuenteTipo', 'motivo', 'nombre', 'obsoleta', 'quitaAceptacion', 'reemplazaA', 'reemplazadaPor', 'secuencia', 'timestampUtc', 'x', 'y']);
  });

  test('el padron entrega solo coordenadas y periodo: ningun otro dato del registro', () => {
    t.padron[W].titular = 'Juan Perez'; t.padron[W].telefono = '2615550000';
    const r = t.Api.handleGetDecisionesFuentesPozo('tok-lee@x.com', W);
    expect(JSON.stringify(r)).not.toMatch(/Juan|2615550000/);
  });

  test('errores: sin stack, sin nombres de hoja, sin emails ni detalle tecnico', () => {
    t.hojas.UbicacionFuenteDecisiones.filas.push(t.columnas.map((c) => ({ decisionId: 'i', secuencia: 'abc', wellId: '09-0001', fuenteTipo: 'REPORTE_POZOS', x: 1, y: 1, evento: 'ACEPTADA', email: 'o@x.com' }[c] || '')));
    const casos = [escribir('tok-val@x.com'), escribir('tok-val@x.com', { versionVista: -1 }), escribir('tok-lee@x.com'), escribir('tok-val@x.com', { fuenteTipo: 'IRRIGACION', x: 1, y: 1 })];
    // (PERMISSION_DENIED nombra al propio usuario, como en todo el backend; lo que no puede salir es el email de OTRA persona)
    casos.forEach((r) => {
      expect(r.status).toBe('error');
      expect(JSON.stringify(r)).not.toMatch(/o@x.com|val@x.com|\bat \w+.*\(|TypeError|Spreadsheet|UbicacionFuenteDecisiones|decisionId|sembrada|abc/);
    });
  });

  test('falla interna: mensaje generico', () => {
    t.hojas = null;
    global.SpreadsheetApp = { openById: () => { throw new Error('Spreadsheet 1AbC secreto'); } };
    const r = t.Api.handleGetDecisionesFuentesPozo('tok-lee@x.com', W);
    expect(r).toMatchObject({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'servicio no disponible' });
  });
});
