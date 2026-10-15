// Logica pura de las SUGERENCIAS en la ficha (js/ubicacionFuenteDecisionesUiLogic.js): que botones ve quien NO valida, que ve el validador, estado humano de cada sugerencia, textos de
// confirmacion, y el flujo (sugerir / cancelar / aprobar / rechazar) con clientRequestId estable y errores en palabras humanas.
const U = require('./ubicacionFuenteDecisionesUiLogic');
global.ubicacionesConocidasLogic_escapar = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
Object.assign(global, U);

const W = '14-0001';
const REP = { x: 2486460.782, y: 6310651.228 };
const IRR1 = { x: 2486464, y: 6310654 };
const IRR2 = { x: 2486590, y: 6310541 };
const fuenteLocal = (id, tipo, etiqueta, c) => ({ id, tipo, etiqueta, x: c.x, y: c.y, lat: -33.3, lon: -69.1, invalida: false, esOperativo: false, distanciaOperativoM: null, urlMaps: 'u' });
const modeloBase = () => ({
  wellId: W, validas: 4, sinOperativo: false, operativo: null,
  fuentes: [
    fuenteLocal('REPORTE_POZOS', 'REPORTE_POZOS', 'Reporte Pozos', REP), fuenteLocal('IRRIGACION_1', 'IRRIGACION', 'Irrigación (1)', IRR1),
    fuenteLocal('IRRIGACION_2', 'IRRIGACION', 'Irrigación (2)', IRR2), { id: 'CAMPO_VALIDADA', tipo: 'CAMPO_VALIDADA', etiqueta: 'Validada en campo', x: null, y: null, lat: -33.3, lon: -69.1, invalida: false }
  ]
});
const dec = (tipo, c, estado) => ({ clave: W + '|' + tipo + '|' + c.x.toFixed(3) + '|' + c.y.toFixed(3), fuenteTipo: tipo, x: c.x, y: c.y, posicion: 1, estado, esAceptadaVigente: false, esOperativa: false, ultima: null });
const vista = (estados) => ({
  wellId: W, version: 5, integro: true, padronPeriodo: '2026-09', obsoletas: [], historial: [], resolucion: { todasDescartadas: false, cambiaRespectoDelOriginal: false },
  fuentes: [dec('REPORTE_POZOS', REP, estados[0] || 'SIN_REVISAR'), dec('IRRIGACION', IRR1, estados[1] || 'SIN_REVISAR'), dec('IRRIGACION', IRR2, estados[2] || 'SIN_REVISAR')]
});
let n = 0;
const sug = (extra) => { n += 1; return Object.assign({ sugerenciaId: 'sug-' + String(n).padStart(8, '0'), wellId: W, fuenteTipo: 'REPORTE_POZOS', x: REP.x, y: REP.y, etiquetaFuente: 'Reporte Pozos', accionSugerida: 'ACEPTAR', motivo: '', nombre: 'Lee Soloubicacion', timestampUtc: '2026-10-14T15:00:00.000Z', estado: 'PENDIENTE', resolucion: null, aplicable: true, motivoNoAplicable: null, estadoFuente: 'SIN_REVISAR' }, extra || {}); };
const vincular = (estados, lista) => U.ufdui_aplicarSugerencias(U.ufdui_aplicarDecisiones(modeloBase(), vista(estados), false), lista);
const claves = (html) => (html.match(/data-ufd-accion="(\w+)"/g) || []).map((s) => s.slice(17, -1));

describe('acciones de SUGERIR por estado (quien NO valida)', () => {
  test('SIN_REVISAR -> Sugerir aceptar, Sugerir descartar | ACEPTADA -> Sugerir descartar | DESCARTADA -> Sugerir restaurar', () => {
    expect(U.ufdui_accionesSugerirPara('SIN_REVISAR')).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(U.ufdui_accionesSugerirPara('ACEPTADA')).toEqual(['SUGERIR_DESCARTAR']);
    expect(U.ufdui_accionesSugerirPara('DESCARTADA')).toEqual(['SUGERIR_RESTAURAR']);
  });

  test('NUNCA se ofrece "quitar aceptacion" ni ninguna accion autoritativa a quien no valida', () => {
    const m = vincular(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA'], []);
    m.fuentes.forEach((f) => {
      const a = U.ufdui_accionesDeFuente(f, m, 'LECTOR');
      expect(a.filter((x) => ['ACEPTAR', 'DESCARTAR', 'QUITAR_ACEPTACION', 'RESTAURAR'].indexOf(x) !== -1)).toEqual([]);
      expect(JSON.stringify(U.UFDUI_ACCION_SUGERIDA)).not.toMatch(/QUITAR/);
    });
    expect(U.ufdui_accionesDeFuente(m.fuentes[0], m, 'LECTOR')).toEqual(['SUGERIR_DESCARTAR']);
    expect(U.ufdui_accionesDeFuente(m.fuentes[2], m, 'LECTOR')).toEqual(['SUGERIR_RESTAURAR']);
  });

  test('el VALIDADOR no ve botones de sugerir (decide directo), con o sin sugerencias pendientes', () => {
    const m = vincular(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA'], [sug({ nombre: 'Ana' })]);
    m.fuentes.forEach((f) => expect(U.ufdui_accionesDeFuente(f, m, 'VALIDADOR').filter((a) => /SUGERIR|CANCELAR/.test(a))).toEqual([]));
    expect(U.ufdui_accionesDeFuente(m.fuentes[1], m, 'VALIDADOR')).toEqual(['ACEPTAR', 'DESCARTAR']);
  });

  test('"Validada en campo" no tiene acciones de este dominio para nadie', () => {
    const m = vincular([], []);
    ['LECTOR', 'VALIDADOR', null].forEach((rol) => expect(U.ufdui_accionesDeFuente(m.fuentes[3], m, rol)).toEqual([]));
  });

  test('sin decisiones leidas (o pozo inconsistente) no se ofrece sugerir; sin rol, nada', () => {
    const sin = U.ufdui_aplicarSugerencias(U.ufdui_aplicarDecisiones(modeloBase(), null, false), []);
    sin.fuentes.forEach((f) => expect(U.ufdui_accionesDeFuente(f, sin, 'LECTOR')).toEqual([]));
    const inc = U.ufdui_aplicarSugerencias(U.ufdui_aplicarDecisiones(modeloBase(), Object.assign(vista([]), { integro: false }), false), []);
    inc.fuentes.forEach((f) => expect(U.ufdui_accionesDeFuente(f, inc, 'LECTOR')).toEqual([]));
    const m = vincular([], []);
    expect(U.ufdui_accionesDeFuente(m.fuentes[0], m, null)).toEqual([]);
  });
});

describe('sugerencia ya pendiente: se muestra "enviada" y se puede cancelar', () => {
  test('con una pendiente aplicable de la MISMA accion no se vuelve a ofrecer esa accion; la otra si; y aparece Cancelar sugerencia', () => {
    const m = vincular([], [sug({ accionSugerida: 'ACEPTAR' })]);
    expect(U.ufdui_accionesDeFuente(m.fuentes[0], m, 'LECTOR')).toEqual(['SUGERIR_DESCARTAR', 'CANCELAR_SUGERENCIA']);
    const html = U.ufdui_htmlSugerencias(m.fuentes[0], m, 'LECTOR');
    expect(html).toContain('Sugerencia enviada · Pendiente de revisión');
    expect(html).toContain('Sugeriste aceptar esta fuente · 14/10/2026');
  });

  test('una pendiente NO aplicable no oculta la accion (ya no corresponde) y se muestra como "Ya no aplicable" con el texto pedido; se puede cancelar', () => {
    const m = vincular(['DESCARTADA'], [sug({ accionSugerida: 'ACEPTAR', aplicable: false, motivoNoAplicable: 'YA_NO_CORRESPONDE', estadoFuente: 'DESCARTADA' })]);
    expect(U.ufdui_accionesDeFuente(m.fuentes[0], m, 'LECTOR')).toEqual(['SUGERIR_RESTAURAR', 'CANCELAR_SUGERENCIA']);
    const html = U.ufdui_htmlSugerencias(m.fuentes[0], m, 'LECTOR');
    expect(html).toContain('Ya no aplicable');
    expect(html).toContain('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    expect(html).not.toContain('Sugerencia enviada');
  });

  test('el boton de cancelar lleva el id de la sugerencia (una por pendiente propia) y los demas botones no', () => {
    const a = sug({ accionSugerida: 'ACEPTAR' });
    const b = sug({ accionSugerida: 'DESCARTAR', motivo: 'm' });
    const m = vincular([], [a, b]);
    const html = U.ufdui_htmlAcciones(m.fuentes[0], m, 'LECTOR');
    expect(claves(html)).toEqual(['CANCELAR_SUGERENCIA', 'CANCELAR_SUGERENCIA']);
    expect(html).toContain('data-ufd-sugerencia="' + a.sugerenciaId + '"');
    expect(html).toContain('data-ufd-sugerencia="' + b.sugerenciaId + '"');
    expect(html).toContain('>Cancelar sugerencia<');
  });

  test('las pendientes de OTRA fuente o de otro pozo no afectan a esta', () => {
    const m = vincular([], [sug({ fuenteTipo: 'IRRIGACION', x: IRR1.x, y: IRR1.y }), sug({ wellId: '01-0012' })]);
    expect(U.ufdui_accionesDeFuente(m.fuentes[0], m, 'LECTOR')).toEqual(['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR']);
    expect(U.ufdui_accionesDeFuente(m.fuentes[1], m, 'LECTOR')).toEqual(['SUGERIR_DESCARTAR', 'CANCELAR_SUGERENCIA']);
  });
});

describe('estados visibles de la sugerencia (palabras humanas, sin codigos)', () => {
  const html = (i) => { const m = vincular([], [i]); return U.ufdui_htmlSugerencias(m.fuentes[0], m, 'LECTOR'); };

  test('Aprobada', () => {
    const h = html(sug({ estado: 'APROBADA', resolucion: { evento: 'APROBADA', nombre: 'Valeria', timestampUtc: '2026-10-15T01:00:00.000Z', motivo: '' } }));
    expect(h).toContain('Sugerencia aprobada');
    expect(h).toContain('Aprobada por Valeria');
  });

  test('Rechazada: muestra el motivo del rechazo', () => {
    const h = html(sug({ estado: 'RECHAZADA', resolucion: { evento: 'RECHAZADA', nombre: 'Vero', timestampUtc: '2026-10-15T01:00:00.000Z', motivo: 'la coordenada es correcta' } }));
    expect(h).toContain('Sugerencia rechazada');
    expect(h).toContain('Rechazada por Vero');
    expect(h).toContain('Motivo: la coordenada es correcta');
  });

  test('Cancelada y Obsoleta (Ya no aplicable)', () => {
    expect(html(sug({ estado: 'CANCELADA', resolucion: { evento: 'CANCELADA', nombre: 'Lee', timestampUtc: '', motivo: '' } }))).toContain('Sugerencia cancelada');
    const o = html(sug({ estado: 'OBSOLETA', resolucion: { evento: 'OBSOLETA', nombre: 'Vero', timestampUtc: '', motivo: '' } }));
    expect(o).toContain('Ya no aplicable');
    expect(o).toContain('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
  });

  test('si hay una pendiente se muestra SOLO esa (no el historial viejo); sin pendientes, solo la resuelta mas reciente', () => {
    const vieja = sug({ estado: 'RECHAZADA', accionSugerida: 'DESCARTAR', motivo: 'x', resolucion: { evento: 'RECHAZADA', nombre: 'V', timestampUtc: '', motivo: 'no' } });
    const pend = sug({ accionSugerida: 'ACEPTAR' });
    const m = vincular([], [pend, vieja]);
    expect(U.ufdui_htmlSugerencias(m.fuentes[0], m, 'LECTOR')).not.toContain('rechazada');
    const m2 = vincular([], [vieja, sug({ estado: 'CANCELADA', resolucion: { evento: 'CANCELADA', nombre: 'L', timestampUtc: '', motivo: '' } })]);
    expect(U.ufdui_htmlSugerencias(m2.fuentes[0], m2, 'LECTOR')).toContain('Sugerencia rechazada');         // la mas nueva primero en la lista del backend: la 1ra resuelta
  });

  test('nunca se muestran codigos internos, ids, emails ni claves', () => {
    const i = sug({ estado: 'RECHAZADA', email: 'x@x.com', clientRequestId: 'req-1', secuencia: 4, resolucion: { evento: 'RECHAZADA', nombre: 'Vero', timestampUtc: '', motivo: 'no', email: 'v@x.com' } });
    const h = html(i);
    expect(h).not.toMatch(/@|req-1|secuencia|APROBADA|RECHAZADA|PENDIENTE|OBSOLETA|YA_NO|FUENTE_NO/);
  });

  test('escapa HTML en el nombre y el motivo', () => {
    const h = html(sug({ estado: 'RECHAZADA', resolucion: { evento: 'RECHAZADA', nombre: '<b>V</b>', timestampUtc: '', motivo: '<img src=x onerror=1>' } }));
    expect(h).not.toMatch(/<b>V|<img/);
    expect(h).toContain('&lt;img');
  });
});

describe('el validador ve un aviso de las pendientes (sin botones: las resuelve en su cola)', () => {
  test('cantidad y quien sugirio; solo las aplicables; con "y N mas" a partir de 3', () => {
    const lista = [sug({ nombre: 'Ana', accionSugerida: 'DESCARTAR', motivo: 'm' }), sug({ nombre: 'Lee' }), sug({ nombre: 'Rosa' }), sug({ nombre: 'Zoe' }), sug({ nombre: 'Vieja', aplicable: false })];
    const m = vincular([], lista);
    const h = U.ufdui_htmlSugerencias(m.fuentes[0], m, 'VALIDADOR');
    expect(h).toContain('4 sugerencias pendientes de revisión');
    expect(h).toContain('Descartar · Ana');
    expect(h).toContain('y 1 más');
    expect(h).not.toContain('Vieja');
    expect(h).not.toMatch(/<button/);
    expect(h).not.toMatch(/@/);
  });

  test('una sola: "1 sugerencia pendiente de revisión"; ninguna aplicable: nada', () => {
    const m = vincular([], [sug({ nombre: 'Ana' })]);
    expect(U.ufdui_htmlSugerencias(m.fuentes[0], m, 'VALIDADOR')).toContain('1 sugerencia pendiente de revisión');
    const m2 = vincular([], [sug({ aplicable: false })]);
    expect(U.ufdui_htmlSugerencias(m2.fuentes[0], m2, 'VALIDADOR')).toBe('');
  });

  test('"Validada en campo" nunca muestra sugerencias; sin rol, nada', () => {
    const m = vincular([], [sug()]);
    expect(U.ufdui_htmlSugerencias(m.fuentes[3], m, 'LECTOR')).toBe('');
    expect(U.ufdui_htmlSugerencias(m.fuentes[0], m, null)).toBe('');
  });
});

describe('vinculo de las sugerencias con las fuentes', () => {
  test('por tipo + x + y a 3 decimales; una lista invalida, de otro pozo o con items rotos no se aplica', () => {
    const m = vincular([], [sug({ x: String(REP.x) + '0' })]);
    expect(m.fuentes[0].sugerencias.pendientes).toHaveLength(1);
    [null, undefined, 'x', {}, [null, 5, 'a', { sugerenciaId: 1 }], [sug({ wellId: '01-0012' })]].forEach((lista) => {
      const mm = vincular([], lista);
      mm.fuentes.forEach((f) => { if (f.sugerencias) { expect(f.sugerencias.pendientes).toEqual([]); } });
    });
  });

  test('items con una accion no sugerible (p. ej. QUITAR_ACEPTACION) o estado desconocido se ignoran', () => {
    const m = vincular([], [sug({ accionSugerida: 'QUITAR_ACEPTACION' }), sug({ estado: 'RARO' })]);
    expect(m.fuentes[0].sugerencias.pendientes).toEqual([]);
    expect(m.fuentes[0].sugerencias.ultima).toBeNull();
  });
});

describe('confirmaciones (textos exactos)', () => {
  const fuente = { etiqueta: 'Irrigación (2)', decision: { estado: 'SIN_REVISAR' } };

  test('SUGERIR ACEPTAR', () => {
    const c = U.ufdui_confirmacion('SUGERIR_ACEPTAR', fuente, {});
    expect(c).toMatchObject({ titulo: '¿Sugerir aceptar esta fuente como referencia registral?', motivo: 'opcional', fuente: 'Irrigación (2)' });
    expect(c.parrafos).toEqual(['Un validador va a revisar tu sugerencia. Hasta entonces no cambia nada.']);
  });

  test('SUGERIR DESCARTAR: motivo obligatorio y aclara que la coordenada original no se eliminara', () => {
    const c = U.ufdui_confirmacion('SUGERIR_DESCARTAR', fuente, {});
    expect(c).toMatchObject({ titulo: '¿Sugerir descartar esta fuente?', motivo: 'obligatorio' });
    expect(c.parrafos[0]).toBe('La coordenada original no se eliminará.');
  });

  test('SUGERIR RESTAURAR', () => {
    expect(U.ufdui_confirmacion('SUGERIR_RESTAURAR', fuente, {})).toMatchObject({ titulo: '¿Sugerir que esta fuente vuelva a participar del cálculo?', motivo: 'opcional' });
  });

  test('CANCELAR SUGERENCIA: sin motivo; aclara que no modifica la fuente', () => {
    const c = U.ufdui_confirmacion('CANCELAR_SUGERENCIA', fuente, {});
    expect(c).toMatchObject({ titulo: '¿Cancelar esta sugerencia?', motivo: 'ninguno' });
    expect(c.parrafos).toEqual(['Esto no modifica el estado de la fuente.']);
  });

  test('APROBAR: dice que va a pasar segun la accion sugerida; RECHAZAR: motivo obligatorio', () => {
    expect(U.ufdui_confirmacion('APROBAR_SUGERENCIA', fuente, { accionSugerida: 'DESCARTAR' }).parrafos).toEqual(['Se descartará la fuente «Irrigación (2)». La coordenada original no se eliminará.']);
    expect(U.ufdui_confirmacion('APROBAR_SUGERENCIA', fuente, { accionSugerida: 'ACEPTAR' }).parrafos[0]).toContain('Se aceptará la fuente «Irrigación (2)»');
    expect(U.ufdui_confirmacion('APROBAR_SUGERENCIA', fuente, { accionSugerida: 'RESTAURAR' }).parrafos[0]).toContain('No quedará aceptada automáticamente');
    expect(U.ufdui_confirmacion('RECHAZAR_SUGERENCIA', fuente, {})).toMatchObject({ titulo: '¿Rechazar esta sugerencia?', motivo: 'obligatorio' });
  });

  test('el motivo obligatorio de SUGERIR_DESCARTAR y de RECHAZAR se valida; los demas son opcionales', () => {
    ['SUGERIR_DESCARTAR', 'RECHAZAR_SUGERENCIA'].forEach((a) => ['', '  ', null, undefined].forEach((m) => expect(U.ufdui_validarMotivo(a, m)).toMatch(/Indicá el motivo/)));
    ['SUGERIR_ACEPTAR', 'SUGERIR_RESTAURAR', 'APROBAR_SUGERENCIA', 'CANCELAR_SUGERENCIA'].forEach((a) => expect(U.ufdui_validarMotivo(a, '')).toBeNull());
    expect(U.ufdui_validarMotivo('SUGERIR_DESCARTAR', 'x'.repeat(301))).toMatch(/300/);
  });

  test('ningun texto habla de "eliminar" una coordenada', () => {
    const nuevas = ['SUGERIR_ACEPTAR', 'SUGERIR_DESCARTAR', 'SUGERIR_RESTAURAR', 'CANCELAR_SUGERENCIA', 'APROBAR_SUGERENCIA', 'RECHAZAR_SUGERENCIA'].map((k) => U.UFDUI_ACCIONES[k]);
    expect(JSON.stringify(nuevas)).not.toMatch(/eliminar (la |esta )?coordenada(?! original no)|borrar/i);
  });
});

describe('flujo de sugerencias', () => {
  const D = { fuenteTipo: 'IRRIGACION', x: IRR2.x, y: IRR2.y };
  function armar(respuestas) {
    let ids = 0;
    const enviados = { sugerir: [], cancelar: [], resolver: [] };
    const cola = { sugerir: respuestas.sugerir || [], cancelar: respuestas.cancelar || [], resolver: respuestas.resolver || [] };
    const toma = (k, p) => { enviados[k].push(p); const l = cola[k]; const r = l.length > 1 ? l.shift() : l[0]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); };
    const flujo = U.ufdui_crearFlujoSugerencias({ sugerir: (p) => toma('sugerir', p), cancelar: (p) => toma('cancelar', p), resolver: (p) => toma('resolver', p), generarId: () => 'ufd-id-' + (++ids) + '-xxxxxxxx' });
    return { flujo, enviados };
  }
  const okSug = (extra) => ({ status: 'ok', data: Object.assign({ sugerencia: sug(), duplicada: false }, extra || {}) });

  test('sugerir: pedido con la lista blanca exacta (x/y de la decision del backend) y mensaje humano', async () => {
    const { flujo, enviados } = armar({ sugerir: [okSug()] });
    const r = await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    expect(r).toMatchObject({ tipo: 'ok', mensaje: 'Sugerencia enviada. Un validador la va a revisar.', duplicada: false });
    expect(Object.keys(enviados.sugerir[0]).sort()).toEqual(['accionSugerida', 'clientRequestId', 'fuenteTipo', 'motivo', 'versionVista', 'wellId', 'x', 'y']);
    expect(enviados.sugerir[0]).toMatchObject({ wellId: W, fuenteTipo: 'IRRIGACION', x: IRR2.x, y: IRR2.y, accionSugerida: 'ACEPTAR', versionVista: 5 });
  });

  test('sugerir descartar sin motivo: invalido y no se envia; con motivo viaja limpio', async () => {
    const { flujo, enviados } = armar({ sugerir: [okSug()] });
    expect((await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_DESCARTAR', motivo: '  ', versionVista: 5 })).tipo).toBe('invalido');
    expect(enviados.sugerir).toEqual([]);
    await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_DESCARTAR', motivo: ' cae\nen el rio ', versionVista: 5 });
    expect(enviados.sugerir[0].motivo).toBe('cae en el rio');
  });

  test('una accion que no es de sugerir (o quitar aceptacion) es invalida y no se envia', async () => {
    const { flujo, enviados } = armar({ sugerir: [okSug()] });
    for (const accion of ['SUGERIR_QUITAR_ACEPTACION', 'QUITAR_ACEPTACION', 'ACEPTAR', 'ELIMINAR', undefined]) {
      expect((await flujo.sugerir({ wellId: W, decision: D, accion, motivo: '', versionVista: 5 })).tipo).toBe('invalido');
    }
    expect((await flujo.sugerir({ wellId: W, decision: null, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 })).tipo).toBe('invalido');
    expect(enviados.sugerir).toEqual([]);
  });

  test('ALREADY_PENDING: tipo ya_pendiente con la sugerencia existente y el mensaje "Ya enviaste esta sugerencia..."', async () => {
    const existente = sug();
    const { flujo } = armar({ sugerir: [{ status: 'error', code: 'ALREADY_PENDING', message: 'x', sugerencia: existente }] });
    const r = await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    expect(r).toMatchObject({ tipo: 'ya_pendiente', mensaje: 'Ya enviaste esta sugerencia y está pendiente de revisión.' });
    expect(r.sugerencia.sugerenciaId).toBe(existente.sugerenciaId);
  });

  test('PENDING_LIMIT_REACHED: error humano', async () => {
    const { flujo } = armar({ sugerir: [{ status: 'error', code: 'PENDING_LIMIT_REACHED', limite: 10 }] });
    const r = await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    expect(r).toMatchObject({ tipo: 'error', code: 'PENDING_LIMIT_REACHED' });
    expect(r.mensaje).toBe('Ya tenés 10 sugerencias pendientes de revisión. Esperá a que las revisen o cancelá alguna.');
  });

  test.each(['STALE_STATE', 'ALREADY_IN_STATE', 'INVALID_TRANSITION', 'SOURCE_NOT_FOUND'])('sugerir con %s: desactualizado (refrescar), nunca reintenta solo, sin codigo tecnico', async (code) => {
    const { flujo, enviados } = armar({ sugerir: [{ status: 'error', code }] });
    const r = await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    expect(r).toMatchObject({ tipo: 'desactualizado', code });
    expect(r.mensaje).not.toMatch(code);
    expect(enviados.sugerir).toHaveLength(1);
  });

  test('corte de red: el reintento del MISMO contenido reutiliza el clientRequestId; otro contenido, otro id', async () => {
    const { flujo, enviados } = armar({ sugerir: [new Error('sin red'), okSug({ duplicada: true })] });
    expect((await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 })).tipo).toBe('red');
    expect((await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 })).duplicada).toBe(true);
    expect(enviados.sugerir[0].clientRequestId).toBe(enviados.sugerir[1].clientRequestId);
    await flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_DESCARTAR', motivo: 'x', versionVista: 5 });
    expect(enviados.sugerir[2].clientRequestId).not.toBe(enviados.sugerir[0].clientRequestId);
  });

  test('doble toque: la misma promesa y un solo envio', async () => {
    const { flujo, enviados } = armar({ sugerir: [okSug()] });
    const a = flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    const b = flujo.sugerir({ wellId: W, decision: D, accion: 'SUGERIR_ACEPTAR', motivo: '', versionVista: 5 });
    expect(a).toBe(b);
    await a;
    expect(enviados.sugerir).toHaveLength(1);
  });

  test('cancelar: pedido con sugerenciaId, motivo vacio e id; mensaje "Sugerencia cancelada."', async () => {
    const { flujo, enviados } = armar({ cancelar: [okSug()] });
    const r = await flujo.cancelar({ sugerenciaId: 'sug-00000001' });
    expect(r).toMatchObject({ tipo: 'ok', mensaje: 'Sugerencia cancelada.' });
    expect(Object.keys(enviados.cancelar[0]).sort()).toEqual(['clientRequestId', 'motivo', 'sugerenciaId']);
    expect((await flujo.cancelar({ sugerenciaId: '' })).tipo).toBe('invalido');
  });

  test.each(['SUGGESTION_NOT_FOUND', 'ALREADY_RESOLVED'])('cancelar o resolver con %s: "La sugerencia ya fue resuelta o dejó de estar disponible." y hay que refrescar', async (code) => {
    const { flujo } = armar({ cancelar: [{ status: 'error', code }], resolver: [{ status: 'error', code }] });
    const a = await flujo.cancelar({ sugerenciaId: 'sug-00000001' });
    const b = await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'APROBAR', motivo: '', versionVista: 3 });
    [a, b].forEach((r) => {
      expect(r).toMatchObject({ tipo: 'desactualizado', mensaje: 'La sugerencia ya fue resuelta o dejó de estar disponible.' });
    });
  });

  test('aprobar: pedido con la version del validador; resultado APROBADA / OBSOLETA con su mensaje humano', async () => {
    const { flujo, enviados } = armar({ resolver: [okSug({ resultado: 'APROBADA' }), okSug({ resultado: 'OBSOLETA' })] });
    const a = await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'APROBAR', motivo: 'ok', versionVista: 7 });
    expect(a).toMatchObject({ tipo: 'ok', resultado: 'APROBADA', mensaje: 'Sugerencia aprobada.' });
    expect(Object.keys(enviados.resolver[0]).sort()).toEqual(['clientRequestId', 'motivo', 'resolucion', 'sugerenciaId', 'versionVista']);
    expect(enviados.resolver[0]).toMatchObject({ resolucion: 'APROBAR', versionVista: 7, motivo: 'ok' });
    const o = await flujo.resolver({ sugerenciaId: 'sug-00000002', resolucion: 'APROBAR', motivo: '', versionVista: 7 });
    expect(o).toMatchObject({ tipo: 'ok', resultado: 'OBSOLETA', mensaje: 'Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.' });
  });

  test('rechazar: motivo obligatorio (sin motivo no se envia), sin versionVista; mensaje "Sugerencia rechazada."', async () => {
    const { flujo, enviados } = armar({ resolver: [okSug({ resultado: 'RECHAZADA' })] });
    expect((await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'RECHAZAR', motivo: '', versionVista: 7 })).tipo).toBe('invalido');
    expect(enviados.resolver).toEqual([]);
    const r = await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'RECHAZAR', motivo: 'no corresponde', versionVista: 7 });
    expect(r).toMatchObject({ tipo: 'ok', mensaje: 'Sugerencia rechazada.' });
    expect(enviados.resolver[0].versionVista).toBeUndefined();
    expect(enviados.resolver[0]).toMatchObject({ resolucion: 'RECHAZAR', motivo: 'no corresponde' });
  });

  test('STALE_STATE al aprobar: "Esta información cambió mientras la estabas revisando..." y se refresca, sin reintentar', async () => {
    const { flujo, enviados } = armar({ resolver: [{ status: 'error', code: 'STALE_STATE', versionActual: 9 }] });
    const r = await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'APROBAR', motivo: '', versionVista: 7 });
    expect(r.tipo).toBe('desactualizado');
    expect(r.mensaje.indexOf('Esta información cambió mientras la estabas revisando.')).toBe(0);
    expect(enviados.resolver).toHaveLength(1);
  });

  test.each([['UNAUTHORIZED', true], ['USER_DISABLED', true], ['PERMISSION_DENIED', false], ['SERVICE_UNAVAILABLE', false], ['INCONSISTENT_STATE', false]])('error %s: sin codigo tecnico, sesionVencida=%s', async (code, vencida) => {
    const { flujo } = armar({ resolver: [{ status: 'error', code, message: 'detalle interno' }] });
    const r = await flujo.resolver({ sugerenciaId: 'sug-00000001', resolucion: 'APROBAR', motivo: '', versionVista: 7 });
    expect(r).toMatchObject({ tipo: 'error', code, sesionVencida: vencida });
    expect(r.mensaje).not.toMatch(/detalle interno|[A-Z]{3,}_[A-Z_]+/);
  });

  test('resolucion o id invalidos: no se envia', async () => {
    const { flujo, enviados } = armar({ resolver: [okSug()] });
    for (const e of [{ sugerenciaId: 'x', resolucion: 'BORRAR' }, { sugerenciaId: '', resolucion: 'APROBAR' }, { resolucion: 'APROBAR' }, null, undefined]) {
      expect((await flujo.resolver(e)).tipo).toBe('invalido');
    }
    expect(enviados.resolver).toEqual([]);
  });
});
