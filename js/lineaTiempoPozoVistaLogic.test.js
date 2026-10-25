// Presentacion pura de la Linea de tiempo (E6-3): filtros por fuente, avisos de carga incompleta (sin codigos tecnicos), notas con lista blanca de metadata, forma de cada item, tipo de
// pantalla (vacio / error total / lista), orden intacto y privacidad. El modelo de eventos es el REAL (js/lineaTiempoPozoLogic.js).
const fs = require('fs');
const path = require('path');
const L = require('./lineaTiempoPozoLogic');
const V = require('./lineaTiempoPozoVistaLogic');

const W = '14-0006';
const T1 = '2026-10-20T15:00:00.000Z';
const T2 = '2026-10-21T18:30:00.000Z';
const T3 = '2026-10-22T09:15:30.250Z';
const motivos = { SIN_ACCESO: 'Sin acceso', POZO_CEGADO: 'Pozo cegado' };
const deps = {
  formatearFecha: (iso) => 'F(' + iso + ')',
  etiquetaMotivo: (c) => (Object.prototype.hasOwnProperty.call(motivos, c) ? motivos[c] : c),
  filtrar: L.lineaTiempoPozoLogic_filtrarPorFuente
};

// --- eventos reales del modelo ---
const obsPayload = (items) => ({ wellId: W, observaciones: items });
const obs = (n, extra) => Object.assign({ observacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, nombre: 'Ana', timestamp: T1, anulacion: null }, extra || {});
const evaluacion = (n, extra) => Object.assign({ evaluacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, timestamp: T2, nombre: 'Marta', estado: 'NO_APTO', motivo: 'SIN_ACCESO', observacion: 'Portón cerrado' }, extra || {});
const correccion = (n, extra) => Object.assign({ correccionId: 'corr-' + String(n).padStart(4, '0'), wellId: W, metodo: 'PUNTO_EN_MAPA', observacion: 'Medido', nombrePropone: 'Carla', timestamp: T3, estado: 'PROPUESTA', resolucion: null }, extra || {});
const eventos = {
  obs: (items) => L.lineaTiempoPozoLogic_normalizarObservaciones(obsPayload(items), W).eventos,
  reemp: (items) => L.lineaTiempoPozoLogic_normalizarReemplazo({ wellId: W, evaluaciones: items }, W).eventos,
  corr: (items) => L.lineaTiempoPozoLogic_normalizarCorrecciones({ wellId: W, historial: items }, W).eventos
};

const fuente = (estado, extra) => Object.assign({ estado, cantidadEventos: 0, omitidos: [], duracionMs: 0, motivoParcial: null, codigoError: null }, extra || {});
const resultado = (extra) => Object.assign({
  wellId: W, generacion: 1, puedeVer: true, auth: null, eventos: [], completa: true, parcial: false, duracionMs: 5,
  fuentes: { ubicacion: fuente('OK'), reemplazo: fuente('OK'), observaciones: fuente('OK') }
}, extra || {});
const conFuentes = (u, r, o, extra) => resultado(Object.assign({ fuentes: { ubicacion: u, reemplazo: r, observaciones: o } }, extra || {}));
const completo = () => {
  const e = L.lineaTiempoPozoLogic_ordenar([].concat(eventos.obs([obs(1)]), eventos.reemp([evaluacion(1)]), eventos.corr([correccion(1)])));
  return resultado({ eventos: e });
};

describe('etiquetas y filtros por fuente', () => {
  test('etiquetas de fuente legibles', () => {
    expect(V.lineaTiempoPozoVista_etiquetaFuente('UBICACION')).toBe('Ubicación');
    expect(V.lineaTiempoPozoVista_etiquetaFuente('REEMPLAZO')).toBe('Reemplazo');
    expect(V.lineaTiempoPozoVista_etiquetaFuente('OBSERVACIONES')).toBe('Observaciones');
    ['FOTOS', '', null, undefined, 5, 'constructor', '__proto__'].forEach((f) => expect(V.lineaTiempoPozoVista_etiquetaFuente(f)).toBe(''));
  });

  test('tres fuentes: Todas + una por fuente, en orden fijo', () => {
    expect(V.lineaTiempoPozoVista_filtros(completo())).toEqual([
      { valor: 'TODAS', etiqueta: 'Todas' }, { valor: 'UBICACION', etiqueta: 'Ubicación' }, { valor: 'REEMPLAZO', etiqueta: 'Reemplazo' }, { valor: 'OBSERVACIONES', etiqueta: 'Observaciones' }
    ]);
  });

  test('dos fuentes: solo esas dos; una sola (o ninguna): sin filtros', () => {
    const dos = conFuentes(fuente('SIN_PERMISO'), fuente('OK'), fuente('VACIA'));
    expect(V.lineaTiempoPozoVista_filtros(dos).map((f) => f.valor)).toEqual(['TODAS', 'REEMPLAZO', 'OBSERVACIONES']);
    expect(V.lineaTiempoPozoVista_filtros(conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('OK')))).toEqual([]);
    expect(V.lineaTiempoPozoVista_filtros(conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('SIN_PERMISO')))).toEqual([]);
  });

  test('una fuente SIN_PERMISO o NO_CARGADA no tiene filtro; una ERROR o PARCIAL si (su estado es relevante)', () => {
    const r = conFuentes(fuente('SIN_PERMISO'), fuente('ERROR'), fuente('PARCIAL'));
    expect(V.lineaTiempoPozoVista_filtros(r).map((f) => f.valor)).toEqual(['TODAS', 'REEMPLAZO', 'OBSERVACIONES']);
    const n = conFuentes(fuente('NO_CARGADA'), fuente('OK'), fuente('OK'));
    expect(V.lineaTiempoPozoVista_filtros(n).map((f) => f.valor)).toEqual(['TODAS', 'REEMPLAZO', 'OBSERVACIONES']);
  });

  test('resultado ausente o mal formado: sin filtros, sin lanzar', () => {
    [null, undefined, {}, 'x', 5, { fuentes: null }, { fuentes: {} }].forEach((r) => expect(V.lineaTiempoPozoVista_filtros(r)).toEqual([]));
  });

  test('filtroValido: el pedido si existe; si no, Todas', () => {
    const filtros = V.lineaTiempoPozoVista_filtros(completo());
    expect(V.lineaTiempoPozoVista_filtroValido(filtros, 'REEMPLAZO')).toBe('REEMPLAZO');
    expect(V.lineaTiempoPozoVista_filtroValido(filtros, 'TODAS')).toBe('TODAS');
    ['FOTOS', '', null, undefined, 'reemplazo', 'constructor'].forEach((v) => expect(V.lineaTiempoPozoVista_filtroValido(filtros, v)).toBe('TODAS'));
    expect(V.lineaTiempoPozoVista_filtroValido([], 'REEMPLAZO')).toBe('TODAS');
    expect(V.lineaTiempoPozoVista_filtroValido(null, 'REEMPLAZO')).toBe('TODAS');
  });
});

describe('avisos de carga incompleta', () => {
  const avisos = V.lineaTiempoPozoVista_avisos;

  test('todo cargado: sin avisos', () => {
    expect(avisos(completo())).toEqual([]);
    expect(avisos(conFuentes(fuente('VACIA'), fuente('OK'), fuente('SIN_PERMISO')))).toEqual([]);
  });

  test('una fuente ERROR: aviso general + una linea con su nombre', () => {
    expect(avisos(conFuentes(fuente('OK'), fuente('ERROR'), fuente('OK')))).toEqual(['Parte de la información no pudo cargarse.', 'Reemplazo no pudo cargarse.']);
    expect(avisos(conFuentes(fuente('ERROR'), fuente('OK'), fuente('ERROR')))).toEqual(['Parte de la información no pudo cargarse.', 'Ubicación no pudo cargarse.', 'Observaciones no pudo cargarse.']);
  });

  test('Ubicacion PARCIAL: copy simple, sin hablar de correcciones ni decisiones', () => {
    const r = conFuentes(fuente('PARCIAL', { motivoParcial: 'SUBFUENTE_DECISIONES', codigoError: 'SERVICE_UNAVAILABLE' }), fuente('OK'), fuente('OK'));
    expect(avisos(r)).toEqual(['Parte de la información no pudo cargarse.', 'Parte del historial de ubicación no pudo cargarse.']);
    expect(avisos(r).join(' ')).not.toMatch(/correcci|decision|SUBFUENTE|SERVICE/i);
  });

  test('Observaciones PARCIAL por LIMIT_REACHED: aviso propio, sin "error" ni aviso general', () => {
    const r = conFuentes(fuente('OK'), fuente('OK'), fuente('PARCIAL', { motivoParcial: 'LIMIT_REACHED' }));
    expect(avisos(r)).toEqual(['Hay más observaciones antiguas que no se incluyeron en esta vista.']);
    expect(avisos(r).join(' ')).not.toMatch(/error|no pudo/i);
  });

  test.each([['CURSOR_REPETIDO'], ['CURSOR_INVALIDO'], ['CURSOR_NO_AVANZA'], ['ERROR_PAGINA'], ['RESPUESTA_INVALIDA']])('Observaciones PARCIAL por %s: "no pudo cargarse por completo", sin el motivo tecnico', (motivo) => {
    const r = conFuentes(fuente('OK'), fuente('OK'), fuente('PARCIAL', { motivoParcial: motivo, codigoError: 'SERVICE_UNAVAILABLE' }));
    expect(avisos(r)).toEqual(['Parte de la información no pudo cargarse.', 'Observaciones no pudo cargarse por completo.']);
    expect(avisos(r).join(' ')).not.toContain(motivo);
    expect(avisos(r).join(' ')).not.toContain('SERVICE');
  });

  test('LIMIT_REACHED solo cuenta para Observaciones: en otra fuente es una carga incompleta comun', () => {
    expect(avisos(conFuentes(fuente('PARCIAL', { motivoParcial: 'LIMIT_REACHED' }), fuente('OK'), fuente('OK')))).toEqual(['Parte de la información no pudo cargarse.', 'Parte del historial de ubicación no pudo cargarse.']);
  });

  test('CANCELADA no se avisa nunca (es un detalle interno)', () => {
    const r = conFuentes(fuente('OK'), fuente('OK'), fuente('PARCIAL', { motivoParcial: 'CANCELADA' }));
    expect(avisos(r)).toEqual([]);
  });

  test('SIN_PERMISO y NO_CARGADA son invisibles: no se menciona informacion oculta', () => {
    const r = conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('NO_CARGADA'));
    expect(avisos(r)).toEqual([]);
  });

  test('el limite y un error conviven: el general aparece solo por el error', () => {
    const r = conFuentes(fuente('OK'), fuente('ERROR'), fuente('PARCIAL', { motivoParcial: 'LIMIT_REACHED' }));
    expect(avisos(r)).toEqual(['Parte de la información no pudo cargarse.', 'Reemplazo no pudo cargarse.', 'Hay más observaciones antiguas que no se incluyeron en esta vista.']);
  });

  test('ningun aviso contiene codigos tecnicos, stack ni mensajes del backend', () => {
    const feo = conFuentes(fuente('ERROR', { codigoError: 'SERVICE_UNAVAILABLE' }), fuente('ERROR', { codigoError: 'RED' }), fuente('PARCIAL', { motivoParcial: 'CURSOR_REPETIDO', codigoError: 'ERROR_PAGINA' }));
    const texto = avisos(feo).join(' ');
    ['SERVICE_UNAVAILABLE', 'RED', 'CURSOR', 'ERROR_PAGINA', 'undefined', 'null', '[object'].forEach((s) => expect(texto).not.toContain(s));
  });

  test('resultado mal formado: sin avisos y sin lanzar', () => {
    [null, undefined, {}, 'x', { fuentes: null }].forEach((r) => expect(avisos(r)).toEqual([]));
  });
});

describe('notas: lista blanca de metadata', () => {
  const nota = (tipo, estado, metadata, d) => V.lineaTiempoPozoVista_notas({ tipo, estado, metadata }, d === undefined ? deps : d);

  test('propuesta de ubicacion: metodo y estado actual, con etiquetas legibles', () => {
    expect(nota('UBICACION_PROPUESTA', 'PROPUESTA', { metodo: 'GPS_ACTUAL' })).toEqual(['Método: GPS del dispositivo', 'Estado actual: pendiente de validación']);
    expect(nota('UBICACION_PROPUESTA', 'VALIDADA', { metodo: 'PUNTO_EN_MAPA' })).toEqual(['Método: Punto elegido en el mapa', 'Estado actual: validada en campo']);
    expect(nota('UBICACION_PROPUESTA', 'REVERTIDA', { metodo: 'COORDENADAS_GMS' })).toEqual(['Método: Coordenadas GMS / WGS84', 'Estado actual: revertida']);
    expect(nota('UBICACION_PROPUESTA', 'SUPERADA', { metodo: 'COORDENADAS_POSGAR94_AR2' })).toEqual(['Método: Coordenadas POSGAR 94 / Argentina 2', 'Estado actual: reemplazada por otra ubicación']);
    expect(nota('UBICACION_PROPUESTA', 'RECHAZADA', { metodo: null })).toEqual(['Estado actual: rechazada']);
  });

  test('validacion: "Primera ubicación del pozo" solo si primeraUbicacion === true', () => {
    expect(nota('UBICACION_VALIDADA', 'VALIDADA', { primeraUbicacion: true })).toEqual(['Primera ubicación del pozo']);
    ['SI', 1, 'true', null, false, undefined].forEach((v) => expect(nota('UBICACION_VALIDADA', 'VALIDADA', { primeraUbicacion: v })).toEqual([]));
  });

  test('decisiones sobre fuentes: tipo de fuente registral y obsoleta (solo === true)', () => {
    expect(nota('FUENTE_ACEPTADA', null, { fuenteTipo: 'REPORTE_POZOS' })).toEqual(['Fuente: Reporte de pozos']);
    expect(nota('FUENTE_DESCARTADA', null, { fuenteTipo: 'IRRIGACION', obsoleta: true })).toEqual(['Fuente: Irrigación', 'La fuente ya no figura en el padrón actual']);
    expect(nota('FUENTE_RESTAURADA', null, { fuenteTipo: null, obsoleta: 'SI' })).toEqual([]);
    expect(nota('FUENTE_ACEPTACION_QUITADA', null, { fuenteTipo: 'OTRA' })).toEqual([]);
  });

  test('reemplazo: motivo con la etiqueta del catalogo; un codigo sin etiqueta conocida NO se muestra', () => {
    expect(nota('REEMPLAZO_NO_APTO', 'NO_APTO', { motivo: 'SIN_ACCESO' })).toEqual(['Motivo: Sin acceso']);
    expect(nota('REEMPLAZO_DUDOSO', 'DUDOSO', { motivo: 'CODIGO_NUEVO_DEL_BACKEND' })).toEqual([]);
    expect(nota('REEMPLAZO_APTO', 'APTO', { motivo: null })).toEqual([]);
    expect(nota('REEMPLAZO_NO_APTO', 'NO_APTO', { motivo: 'POZO_CEGADO' }, {})).toEqual([]);                 // sin helper de etiquetas no se inventa nada
    expect(nota('REEMPLAZO_NO_APTO', 'NO_APTO', { motivo: 'POZO_CEGADO' }, null)).toEqual([]);
  });

  test('observacion agregada que hoy esta anulada: lo dice; activa: sin nota', () => {
    expect(nota('OBSERVACION_AGREGADA', 'ANULADA', {})).toEqual(['Estado actual: anulada']);
    expect(nota('OBSERVACION_AGREGADA', 'ACTIVA', {})).toEqual([]);
    expect(nota('OBSERVACION_ANULADA', 'ANULADA', {})).toEqual([]);
  });

  test('metadata desconocida o con claves crudas: NO se vuelca (nada de JSON, keys ni valores)', () => {
    const toxica = { metodo: 'GPS_ACTUAL', email: 'secreto@x.com', clientRequestId: 'req-secreto', secuencia: 987654321, secreto: 'XYZ', otro: { a: 1 } };
    const notas = nota('UBICACION_PROPUESTA', 'PROPUESTA', toxica).join(' | ');
    ['secreto@x.com', 'req-secreto', '987654321', 'XYZ', 'clientRequestId', '{', '[object'].forEach((s) => expect(notas).not.toContain(s));
    expect(nota('OBSERVACION_AGREGADA', 'ACTIVA', toxica)).toEqual([]);
    expect(nota('REEMPLAZO_APTO', 'APTO', toxica)).toEqual([]);
  });

  test('un valor de metadata que es un nombre heredado ("constructor", "__proto__") no se interpreta', () => {
    expect(nota('UBICACION_PROPUESTA', 'constructor', { metodo: 'constructor' })).toEqual([]);
    expect(nota('UBICACION_PROPUESTA', '__proto__', { metodo: '__proto__' })).toEqual([]);
    expect(nota('FUENTE_ACEPTADA', null, { fuenteTipo: 'toString' })).toEqual([]);
  });

  test('metadata ausente o rara: sin lanzar', () => {
    [undefined, null, 5, 'x', []].forEach((m) => expect(() => nota('UBICACION_PROPUESTA', 'PROPUESTA', m)).not.toThrow());
    expect(nota('UBICACION_PROPUESTA', 'PROPUESTA', undefined)).toEqual(['Estado actual: pendiente de validación']);
  });
});

describe('item de la lista', () => {
  test('forma exacta: sin id, sin estado crudo, sin metadata', () => {
    const e = eventos.reemp([evaluacion(1)])[0];
    const item = V.lineaTiempoPozoVista_item(e, deps);
    expect(item).toEqual({
      fuente: 'REEMPLAZO', fuenteEtiqueta: 'Reemplazo', titulo: 'Evaluación de reemplazo: no apto', fecha: 'F(' + T2 + ')', instante: T2, nombre: 'Marta', detalle: 'Portón cerrado', notas: ['Motivo: Sin acceso']
    });
    expect(Object.keys(item).sort()).toEqual(['detalle', 'fecha', 'fuente', 'fuenteEtiqueta', 'instante', 'nombre', 'notas', 'titulo']);
  });

  test('la fecha viene del helper de fecha local sobre el instante canonico; sin helper queda vacia (no se parsea nada aca)', () => {
    const e = eventos.obs([obs(1)])[0];
    expect(V.lineaTiempoPozoVista_item(e, deps).fecha).toBe('F(' + T1 + ')');
    expect(V.lineaTiempoPozoVista_item(e, {}).fecha).toBe('');
    expect(V.lineaTiempoPozoVista_item(e, undefined).fecha).toBe('');
  });

  test('detalle: texto literal tal cual (HTML, ampersand, comillas, emoji); vacio -> null', () => {
    const textos = ['<script>alert("x")</script> & <b>negrita</b>', 'a & b < c > d', 'pozo 💧 ok', "O'Brien \"dijo\" 100%"];
    textos.forEach((t) => {
      const e = eventos.obs([obs(1, { texto: t })])[0];
      expect(V.lineaTiempoPozoVista_item(e, deps).detalle).toBe(t);
    });
    const sinTexto = eventos.obs([obs(2, { texto: '   ' })])[0];
    expect(V.lineaTiempoPozoVista_item(sinTexto, deps).detalle).toBeNull();
  });

  test('nombre largo se conserva (el recorte ya lo hizo el modelo) y no se interpreta', () => {
    const e = eventos.obs([obs(1, { nombre: '<img src=x onerror=alert(1)> ' + 'N'.repeat(200) })])[0];
    const item = V.lineaTiempoPozoVista_item(e, deps);
    expect(item.nombre.indexOf('<img')).toBe(0);
    expect(Array.from(item.nombre).length).toBeLessThanOrEqual(80);
  });

  test('observacion anulada: la alta no tiene texto y la anulacion es conceptual (nunca el texto original)', () => {
    const evs = eventos.obs([obs(1, { estado: 'ANULADA', texto: 'TEXTO-ORIGINAL-QUE-VE-EL-MODERADOR', anulacion: { nombre: 'Moderadora', timestamp: T2, motivo: 'Cargada por error' } })]);
    const items = evs.map((e) => V.lineaTiempoPozoVista_item(e, deps));
    expect(JSON.stringify(items)).not.toContain('TEXTO-ORIGINAL-QUE-VE-EL-MODERADOR');
    const anulacion = items.find((i) => i.titulo === 'Observación anulada');
    expect(anulacion).toMatchObject({ nombre: 'Moderadora', detalle: 'Cargada por error', fuente: 'OBSERVACIONES' });
    const alta = items.find((i) => i.titulo === 'Observación agregada');
    expect(alta.detalle).toBeNull();
    expect(alta.notas).toEqual(['Estado actual: anulada']);
  });
});

describe('modelo de vista', () => {
  const modelo = (r, f) => V.lineaTiempoPozoVista_modelo(r, f, deps);

  test('todo cargado sin eventos (completa): VACIO con el texto pedido, sin filtros ni avisos', () => {
    const m = modelo(resultado());
    expect(m).toMatchObject({ tipo: 'VACIO', mensaje: 'Este pozo todavía no tiene eventos en la línea de tiempo.', filtros: [], avisos: [], items: [] });
  });

  test('ninguna fuente participa (todas SIN_PERMISO): VACIO neutro, sin sugerir que hay informacion oculta', () => {
    const m = modelo(conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), { completa: false }));
    expect(m.tipo).toBe('VACIO');
    expect(m.mensaje).toBe('No hay información disponible para mostrar.');
    expect(m.mensaje).not.toMatch(/permiso|oculta|acceso|eventos|error/i);         // no afirma que no haya eventos: no pudo leerlos
    expect(m.mensaje).not.toBe(modelo(resultado()).mensaje);                          // y es distinto del vacio verdadero
    expect(m.filtros).toEqual([]);
    expect(m.avisos).toEqual([]);
  });

  test('sin eventos, no completa y no parcial: ERROR_TOTAL con el texto pedido y sin codigos', () => {
    const m = modelo(conFuentes(fuente('ERROR', { codigoError: 'SERVICE_UNAVAILABLE' }), fuente('ERROR', { codigoError: 'RED' }), fuente('ERROR'), { completa: false, parcial: false }));
    expect(m.tipo).toBe('ERROR_TOTAL');
    expect(m.mensaje).toBe('No se pudo cargar la línea de tiempo.');
    expect(JSON.stringify(m)).not.toMatch(/SERVICE_UNAVAILABLE|RED/);
  });

  test('una unica fuente permitida que fallo: ERROR_TOTAL; resultado ausente o mal formado: ERROR_TOTAL', () => {
    expect(modelo(conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('ERROR'), { completa: false })).tipo).toBe('ERROR_TOTAL');
    [null, undefined, {}, 'x', 5, { eventos: null, fuentes: {} }, { eventos: [], fuentes: null }].forEach((r) => expect(modelo(r).tipo).toBe('ERROR_TOTAL'));
  });

  test('lista: items en el MISMO orden que el modelo (no se reordena), con filtros y sin avisos si todo cargo', () => {
    const r = completo();
    const m = modelo(r);
    expect(m.tipo).toBe('LISTA');
    expect(m.items.map((i) => i.instante)).toEqual(r.eventos.map((e) => e.timestamp));
    expect(m.items.length).toBe(3);
    expect(m.avisos).toEqual([]);
    expect(m.filtros.length).toBe(4);
    expect(m.filtro).toBe('TODAS');
    expect(m.mensaje).toBeNull();
  });

  test('NO reordena: un orden que no es cronologico (arreglo armado a mano) sale tal cual', () => {
    const base = completo();
    const desordenado = resultado({ eventos: base.eventos.slice().reverse() });
    expect(modelo(desordenado).items.map((i) => i.instante)).toEqual(desordenado.eventos.map((e) => e.timestamp));
  });

  test('filtrar por fuente usa la funcion pura del modelo y conserva el orden; Todas vuelve al total', () => {
    const r = completo();
    const reemp = modelo(r, 'REEMPLAZO');
    expect(reemp.filtro).toBe('REEMPLAZO');
    expect(reemp.items.map((i) => i.fuente)).toEqual(['REEMPLAZO']);
    expect(modelo(r, 'OBSERVACIONES').items.map((i) => i.fuente)).toEqual(['OBSERVACIONES']);
    expect(modelo(r, 'UBICACION').items.map((i) => i.fuente)).toEqual(['UBICACION']);
    expect(modelo(r, 'TODAS').items.length).toBe(3);
    const espia = jest.fn(L.lineaTiempoPozoLogic_filtrarPorFuente);
    V.lineaTiempoPozoVista_modelo(r, 'REEMPLAZO', { filtrar: espia, formatearFecha: deps.formatearFecha });
    expect(espia).toHaveBeenCalledWith(r.eventos, 'REEMPLAZO');
  });

  test('filtro sin resultados: lista vacia con el mensaje de la fuente; la barra de filtros sigue', () => {
    const r = resultado({ eventos: eventos.obs([obs(1)]), fuentes: { ubicacion: fuente('OK'), reemplazo: fuente('VACIA'), observaciones: fuente('OK') } });
    const m = modelo(r, 'REEMPLAZO');
    expect(m.tipo).toBe('LISTA');
    expect(m.items).toEqual([]);
    expect(m.mensaje).toBe('No hay eventos de esta fuente.');
    expect(m.filtros.length).toBe(4);
  });

  test('un filtro inexistente o de una fuente que no participa cae en Todas', () => {
    const r = conFuentes(fuente('SIN_PERMISO'), fuente('OK'), fuente('OK'), { eventos: eventos.obs([obs(1)]).concat(eventos.reemp([evaluacion(1)])) });
    expect(modelo(r, 'UBICACION').filtro).toBe('TODAS');
    expect(modelo(r, 'FOTOS').filtro).toBe('TODAS');
    expect(modelo(r, undefined).filtro).toBe('TODAS');
    expect(modelo(r, 'UBICACION').items.length).toBe(2);
  });

  test('con una sola fuente no hay barra de filtros y cualquier filtro se ignora', () => {
    const r = conFuentes(fuente('SIN_PERMISO'), fuente('SIN_PERMISO'), fuente('OK'), { eventos: eventos.obs([obs(1)]) });
    const m = modelo(r, 'OBSERVACIONES');
    expect(m.filtros).toEqual([]);
    expect(m.filtro).toBe('TODAS');
    expect(m.items.length).toBe(1);
  });

  test('resultado parcial con eventos: lista + avisos; el aviso NO depende del filtro', () => {
    const r = resultado({
      eventos: eventos.obs([obs(1)]).concat(eventos.reemp([evaluacion(1)])), completa: false, parcial: true,
      fuentes: { ubicacion: fuente('ERROR'), reemplazo: fuente('OK'), observaciones: fuente('OK') }
    });
    const todas = modelo(r, 'TODAS');
    const reemp = modelo(r, 'REEMPLAZO');
    expect(todas.avisos).toEqual(['Parte de la información no pudo cargarse.', 'Ubicación no pudo cargarse.']);
    expect(reemp.avisos).toEqual(todas.avisos);
    expect(modelo(r, 'UBICACION').items).toEqual([]);                                           // filtrar la fuente caida no "arregla" nada: sigue el aviso
    expect(modelo(r, 'UBICACION').avisos).toEqual(todas.avisos);
  });

  test('parcial sin eventos (una fuente vacia y otra caida): lista vacia con aviso, no error total', () => {
    const r = conFuentes(fuente('VACIA'), fuente('ERROR'), fuente('SIN_PERMISO'), { completa: false, parcial: true });
    const m = modelo(r);
    expect(m.tipo).toBe('LISTA');
    expect(m.mensaje).toBe('No hay eventos disponibles para mostrar.');
    expect(m.avisos).toEqual(['Parte de la información no pudo cargarse.', 'Reemplazo no pudo cargarse.']);
  });

  test('LIMIT_REACHED: la lista visible sigue siendo valida y el aviso lo dice sin llamarlo error', () => {
    const r = resultado({ eventos: eventos.obs([obs(1)]), completa: false, parcial: true, fuentes: { ubicacion: fuente('SIN_PERMISO'), reemplazo: fuente('SIN_PERMISO'), observaciones: fuente('PARCIAL', { motivoParcial: 'LIMIT_REACHED' }) } });
    const m = modelo(r);
    expect(m.tipo).toBe('LISTA');
    expect(m.avisos).toEqual(['Hay más observaciones antiguas que no se incluyeron en esta vista.']);
    expect(m.items.length).toBe(1);
  });

  test('SIN_PERMISO es invisible en el modelo completo (ni filtros ni avisos ni mensajes)', () => {
    const r = conFuentes(fuente('SIN_PERMISO'), fuente('OK'), fuente('OK'), { eventos: eventos.obs([obs(1)]).concat(eventos.reemp([evaluacion(1)])) });
    const m = modelo(r);
    expect(JSON.stringify(m)).not.toMatch(/Ubicaci/);
    expect(m.avisos).toEqual([]);
  });

  test('no incluye ids tecnicos, emails ni claves del evento en ningun item', () => {
    const toxico = L.lineaTiempoPozoLogic_ordenar(eventos.obs([obs(1, { email: 'secreto@x.com', clientRequestId: 'req-secreto', secuencia: 987654321 })]));
    const m = modelo(resultado({ eventos: toxico, fuentes: { ubicacion: fuente('SIN_PERMISO'), reemplazo: fuente('SIN_PERMISO'), observaciones: fuente('OK') } }));
    const s = JSON.stringify(m);
    ['secreto@x.com', 'req-secreto', '987654321', '00000000-0000-4000', 'OBSERVACION:', '"id"', 'metadata', 'timestamp'].forEach((x) => expect(s).not.toContain(x));
  });

  test('el modelo no muta el resultado', () => {
    const r = completo();
    const antes = JSON.stringify(r);
    modelo(r, 'REEMPLAZO');
    expect(JSON.stringify(r)).toBe(antes);
  });

  test('no muestra tiempos ni diagnosticos del cargador', () => {
    const r = completo();
    r.duracionMs = 1234;
    r.fuentes.ubicacion.duracionMs = 987;
    const s = JSON.stringify(modelo(r));
    expect(s).not.toMatch(/1234|987|duracion/i);
  });
});

describe('guardas del codigo fuente', () => {
  const fuenteCodigo = fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoVistaLogic.js'), 'utf8');
  const sinComentarios = fuenteCodigo.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('logica pura: sin DOM, red, almacenamiento, console, fechas del dispositivo ni requires', () => {
    [/\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/, /localStorage|sessionStorage|indexedDB/, /\bconsole\b/, /\brequire\s*\(/, /\bimport\b/, /innerHTML|insertAdjacentHTML/, /new Date|Date\.now|Intl\./, /JSON\.stringify/].forEach((re) => {
      expect(sinComentarios).not.toMatch(re);
    });
  });

  test('ES5 y sin invisibles crudos', () => {
    expect(sinComentarios).not.toMatch(/=>|\blet\b|\bconst\b|`|\bclass\b|\basync\b|\bawait\b|\.\.\.|\?\.|\?\?/);
    expect(fuenteCodigo).not.toMatch(/\(\?<[=!]/);
    const invisibles = fuenteCodigo.split('').filter((c) => {
      const o = c.charCodeAt(0);
      return (o < 32 && c !== '\n') || (o >= 0x7F && o <= 0x9F) || o === 0x2028 || o === 0x2029 || o === 0xFEFF || (o >= 0x200B && o <= 0x200F) || (o >= 0x202A && o <= 0x202E) || (o >= 0x2060 && o <= 0x2064) || (o >= 0x2066 && o <= 0x2069);
    });
    expect(invisibles).toEqual([]);
  });

  test('no define titulos del modelo (el titulo de cada evento viene del modelo); los nombres de tipo solo se usan para elegir notas', () => {
    Object.keys(L.LINEA_TIEMPO_TIPOS).forEach((t) => expect(sinComentarios).not.toContain(L.LINEA_TIEMPO_TIPOS[t].titulo));
    const usados = (sinComentarios.match(/'[A-Z]+_[A-Z_]+'/g) || []).map((s) => s.slice(1, -1)).filter((s) => Object.prototype.hasOwnProperty.call(L.LINEA_TIEMPO_TIPOS, s));
    usados.forEach((s) => expect(Object.keys(L.LINEA_TIEMPO_TIPOS)).toContain(s));              // y todos existen en el catalogo
  });

  test('no reordena: ni sort ni reverse', () => {
    expect(sinComentarios).not.toMatch(/\.sort\(|\.reverse\(/);
  });
});
