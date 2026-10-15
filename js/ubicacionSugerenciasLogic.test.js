// Logica pura de la cola de revision de sugerencias (js/ubicacionSugerenciasLogic.js): indicador del hub, normalizacion de la cola, tarjetas y mensajes.
const U = require('./ubicacionFuenteDecisionesUiLogic');
global.ubicacionesConocidasLogic_escapar = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
global.ubicacionesConocidasLogic_urlGoogleMaps = (lat, lon) => (typeof lat === 'number' && typeof lon === 'number' ? 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon : null);
Object.assign(global, U);
const Q = require('./ubicacionSugerenciasLogic');

let n = 0;
const item = (extra) => { n += 1; return Object.assign({
  sugerenciaId: 'sug-' + String(n).padStart(8, '0'), wellId: '14-0001', fuenteTipo: 'IRRIGACION', x: 2486590.782, y: 6310541.228, etiquetaFuente: 'Irrigación (2)', accionSugerida: 'DESCARTAR', motivo: 'queda lejos',
  nombre: 'Ana Pérez', timestampUtc: '2026-10-14T15:00:00.000Z', estado: 'PENDIENTE', resolucion: null, aplicable: true, motivoNoAplicable: null, estadoFuente: 'SIN_REVISAR', versionVista: 4, lat: -33.3488, lon: -69.144
}, extra || {}); };

describe('indicador del hub', () => {
  test.each([[3, 'Sugerencias de ubicación: 3'], [1, 'Sugerencias de ubicación: 1'], [12, 'Sugerencias de ubicación: 12']])('total %i -> "%s"', (total, texto) => {
    expect(Q.usug_textoBadge(total)).toBe(texto);
  });
  test.each([[0], [-1], [1.5], [NaN], [Infinity], [null], [undefined], ['3'], [{}]])('total %p -> oculto (texto vacio)', (total) => {
    expect(Q.usug_textoBadge(total)).toBe('');
  });
});

describe('normalizar la cola', () => {
  test('aplicables primero (mas antiguas primero, como las entrega el backend) y despues las que ya no aplican; el total viene del backend', () => {
    const a = item(); const b = item({ aplicable: false }); const c = item();
    const cola = Q.usug_normalizarCola({ total: 2, noAplicables: 1, pendientes: [a, b, c] });
    expect(cola.items.map((i) => i.sugerenciaId)).toEqual([a.sugerenciaId, c.sugerenciaId, b.sugerenciaId]);
    expect(cola).toMatchObject({ total: 2, noAplicables: 1 });
  });
  test('items rotos o con acciones no sugeribles se descartan; una respuesta inutil es null', () => {
    const cola = Q.usug_normalizarCola({ total: 1, pendientes: [item(), null, 5, { sugerenciaId: 'x' }, item({ accionSugerida: 'QUITAR_ACEPTACION' }), item({ wellId: 'zz' }), item({ x: null })] });
    expect(cola.items).toHaveLength(1);
    [null, undefined, 'x', {}, { pendientes: 'no' }].forEach((d) => expect(Q.usug_normalizarCola(d)).toBeNull());
  });
  test('sin total valido se usa la cantidad de aplicables', () => {
    expect(Q.usug_normalizarCola({ pendientes: [item(), item({ aplicable: false })] }).total).toBe(1);
  });
});

describe('tarjeta de la cola', () => {
  const html = (i, o) => Q.usug_htmlItem(i, o || {});

  test('muestra pozo, fuente, estado actual de la fuente, accion sugerida, proponente (nombre), fecha, motivo y coordenadas con Google Maps (solo lat,lon)', () => {
    const h = html(item(), { iconoMaps: '<svg></svg>' });
    ['14-0001', 'Irrigación (2)', 'Sin revisar', 'Sugiere descartar esta fuente', 'Propuesta por Ana Pérez · 14/10/2026', 'Motivo: queda lejos', '-33.3488, -69.144'].forEach((t) => expect(h).toContain(t));
    expect(h).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=-33.3488,-69.144"');
    expect(h).not.toMatch(/14-0001.*maps\/search[^"]*14-0001/);
  });

  test('aplicable: Aprobar y Rechazar (Aprobar primero); con puedeAbrirPozo agrega "Ver ficha del pozo"', () => {
    const h = html(item(), { puedeAbrirPozo: true });
    expect((h.match(/data-usug-accion="(\w+)"/g) || []).map((s) => s.slice(18, -1))).toEqual(['APROBAR_SUGERENCIA', 'RECHAZAR_SUGERENCIA']);
    expect(h).toContain('>Aprobar<');
    expect(h).toContain('>Rechazar<');
    expect(h).toContain('data-usug-pozo="14-0001"');
    expect(html(item())).not.toContain('data-usug-pozo');
  });

  test('NO aplicable: el texto pedido, sin Aprobar (solo Rechazar con motivo para limpiarla)', () => {
    const h = html(item({ aplicable: false, motivoNoAplicable: 'YA_NO_CORRESPONDE' }));
    expect(h).toContain('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    expect((h.match(/data-usug-accion="(\w+)"/g) || []).map((s) => s.slice(18, -1))).toEqual(['RECHAZAR_SUGERENCIA']);
    expect(h).toContain('usug-no-aplicable');
    expect(h).not.toMatch(/YA_NO_CORRESPONDE/);
  });

  test('sin version del pozo no se ofrece Aprobar (no se podria revisar el conflicto)', () => {
    expect(Q.usug_accionesDeItem(item({ versionVista: undefined }))).toEqual(['RECHAZAR_SUGERENCIA']);
  });

  test('sin emails, sin clientRequestId, sin secuencia; escapa HTML; el id solo vive en data-usug-id', () => {
    const i = item({ nombre: '<b>Ana</b>', motivo: '<script>x</script>', email: 'a@x.com', clientRequestId: 'req-1', secuencia: 8 });
    const h = html(i);
    expect(h).not.toMatch(/<script|<b>Ana/);
    const visible = h.replace(/data-usug-id="[^"]*"/g, '').replace(/<[^>]+>/g, ' ');
    expect(visible).not.toMatch(/@|req-1|secuencia|sug-0|PENDIENTE|APROBAR_|YA_NO|SIN_REVISAR/);
  });

  test('una fuente sin coordenada informada no rompe', () => {
    expect(() => html(item({ lat: undefined, lon: undefined }))).not.toThrow();
    expect(html(item({ lat: undefined, lon: undefined }))).not.toContain('Abrir en Google Maps');
  });

  test('botones tactiles: usan las clases de 44 px de las acciones', () => {
    expect(html(item())).toContain('ufd-btn usug-btn');
  });
});

describe('textos', () => {
  test('resumen: cuantas para revisar y cuantas ya no aplican', () => {
    expect(Q.usug_textoResumen({ total: 3, noAplicables: 0, items: [] })).toBe('3 sugerencias para revisar');
    expect(Q.usug_textoResumen({ total: 1, noAplicables: 2, items: [] })).toBe('1 sugerencia para revisar · 2 ya no aplicables');
    expect(Q.usug_textoResumen({ total: 0, noAplicables: 1, items: [] })).toBe('1 ya no aplicable');
    expect(Q.usug_textoResumen({ total: 0, noAplicables: 0, items: [] })).toBe('');
    expect(Q.usug_textoResumen(null)).toBe('');
  });

  test('mensaje de una aprobacion: la aclaracion de la validada en campo SOLO al aceptar con una vigente', () => {
    const ok = { tipo: 'ok', resultado: 'APROBADA' };
    expect(Q.usug_mensajeResolucion(ok, 'ACEPTAR', true)).toBe('Esta fuente quedó aceptada como referencia registral. La ubicación operativa actual sigue siendo la validada en campo.');
    expect(Q.usug_mensajeResolucion(ok, 'ACEPTAR', false)).toBe('Sugerencia aprobada.');
    expect(Q.usug_mensajeResolucion(ok, 'DESCARTAR', true)).toBe('Sugerencia aprobada.');
    expect(Q.usug_mensajeResolucion({ tipo: 'ok', resultado: 'OBSOLETA' }, 'ACEPTAR', true)).toBe('Esta sugerencia ya no puede aplicarse porque cambió la información de la fuente.');
    expect(Q.usug_mensajeResolucion({ tipo: 'ok', resultado: 'RECHAZADA' }, 'ACEPTAR', true)).toBe('Sugerencia rechazada.');
    expect(Q.usug_mensajeResolucion({ tipo: 'error' }, 'ACEPTAR', true)).toBe('');
  });

  test('lista vacia no genera HTML', () => {
    expect(Q.usug_htmlLista(null)).toBe('');
    expect(Q.usug_htmlLista({ total: 0, noAplicables: 0, items: [] })).toBe('');
  });
});
