// Modelo puro de la Linea de tiempo del pozo (E6-1): fechas (unica funcion), texto seguro, normalizacion por fuente (Ubicacion: correcciones + decisiones, Reemplazo, Observaciones), forma
// del evento (lista blanca), dedupe, orden determinista, filtro por fuente, armado con fallos parciales y PRIVACIDAD (la linea de tiempo nunca muestra mas que el modulo fuente).
const fs = require('fs');
const path = require('path');
const L = require('./lineaTiempoPozoLogic');

const W = '14-0006';
const OTRO = '14-0007';
const T1 = '2026-10-20T15:00:00.000Z';
const T2 = '2026-10-21T18:30:00.000Z';
const T3 = '2026-10-22T09:15:30.250Z';
const pad = (n) => String(n).padStart(4, '0');
const CC = (...codigos) => String.fromCharCode(...codigos);                      // caracteres invisibles sin escribirlos crudos en el codigo

// --- payloads con la forma REAL de cada endpoint (verificada contra el backend en js/lineaTiempoPozoContrato.test.js) ---
const correccion = (n, extra) => Object.assign({
  correccionId: 'corr-' + pad(n), wellId: W, lat: -33.3, lon: -69.1, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, coordenadaOriginalTexto: '', crsOriginal: '', observacion: 'Observacion ' + n,
  nombrePropone: 'Ana', timestamp: T1, distanciaM: 12, advertenciaDistancia: false, primeraUbicacion: false, candidataPrimeraUbicacion: false,
  irrigacion: { lat: -33.3, lon: -69.1, estado: 'unica', fuente: 'reportePozos', padronPeriodo: '2026-09' }, estado: 'PROPUESTA', resolucion: null, propia: true
}, extra || {});
const resuelta = (n, estado, extra, res) => correccion(n, Object.assign({ estado, resolucion: Object.assign({ evento: estado, nombre: 'Valeria', timestamp: T2, motivo: 'Motivo ' + estado }, res || {}) }, extra || {}));
const pozoUbic = (historial, extra) => Object.assign({ wellId: W, vigente: null, pendientes: [], historial }, extra || {});

const decision = (sec, extra) => Object.assign({ secuencia: sec, evento: 'ACEPTADA', fuenteTipo: 'REPORTE_POZOS', x: 2486460.782, y: 6310651.228, nombre: 'Valeria', timestampUtc: T1, motivo: null, obsoleta: false, reemplazaA: null, reemplazadaPor: null, descartaLaAceptada: false, quitaAceptacion: false }, extra || {});
const pozoDec = (historial, extra) => Object.assign({ wellId: W, version: 1, integro: true, padronPeriodo: '2026-09', fuentes: [], obsoletas: [], historial, resolucion: {} }, extra || {});

const evaluacion = (n, extra) => Object.assign({ evaluacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, timestamp: T1, nombre: 'Marta', estado: 'APTO', motivo: 'APTO_SIN_OBSERVACIONES', observacion: null, puntoNEReferencia: null }, extra || {});
const pozoReemp = (evaluaciones) => ({ wellId: W, evaluaciones });

const obs = (n, extra) => Object.assign({ observacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: T1, puedeAnular: true, anulacion: null }, extra || {});
const obsAnulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, puedeAnular: false, anulacion: { nombre: 'Moderadora', timestamp: T2, motivo: 'Cargada por error' } }, extra || {}));
const pozoObs = (observaciones) => ({ wellId: W, total: observaciones.length, activas: 0, anuladas: 0, hayMas: false, cursor: null, observaciones });

const tipos = (r) => r.eventos.map((e) => e.tipo);
const omit = (r) => r.omitidos.reduce((acc, o) => Object.assign(acc, { [o.codigo]: o.cantidad }), {});
const copia = (x) => JSON.parse(JSON.stringify(x));

describe('lineaTiempoPozoLogic_normalizarTimestamp: unica funcion de fechas', () => {
  test.each([
    ['2026-10-20T15:00:00.000Z', '2026-10-20T15:00:00.000Z'],
    ['2026-10-20T15:00:00Z', '2026-10-20T15:00:00.000Z'],
    ['2026-10-20T15:00:00.5Z', '2026-10-20T15:00:00.500Z'],
    ['2026-10-20T15:00:00.12Z', '2026-10-20T15:00:00.120Z'],
    ['2026-10-20T12:00:00-03:00', '2026-10-20T15:00:00.000Z'],
    ['2026-10-20T12:00:00.250-03:00', '2026-10-20T15:00:00.250Z'],
    ['2026-10-20T18:30:00+03:30', '2026-10-20T15:00:00.000Z'],
    ['2026-12-31T23:00:00-03:00', '2027-01-01T02:00:00.000Z'],
    ['2024-02-29T10:00:00Z', '2024-02-29T10:00:00.000Z'],
    ['2000-01-01T00:00:00Z', '2000-01-01T00:00:00.000Z'],
    ['2100-12-31T23:59:59.999Z', '2100-12-31T23:59:59.999Z']
  ])('valido: %s -> %s', (entrada, esperado) => {
    expect(L.lineaTiempoPozoLogic_normalizarTimestamp(entrada)).toBe(esperado);
  });

  test.each([
    ['sin zona (no se adivina)', '2026-10-20T15:00:00'],
    ['sin zona, con milisegundos', '2026-10-20T15:00:00.000'],
    ['formato de Sheets (espacio, sin zona)', '2026-10-20 15:00:00'],
    ['espacio con Z', '2026-10-20 15:00:00Z'],
    ['solo fecha', '2026-10-20'],
    ['z minuscula', '2026-10-20T15:00:00z'],
    ['offset sin dos puntos', '2026-10-20T15:00:00-0300'],
    ['mas de tres decimales', '2026-10-20T15:00:00.1234Z'],
    ['basura al final', '2026-10-20T15:00:00.000Z '],
    ['basura al principio', ' 2026-10-20T15:00:00.000Z'],
    ['31 de febrero', '2026-02-31T10:00:00Z'],
    ['29 de febrero de un anio no bisiesto', '2026-02-29T10:00:00Z'],
    ['31 de abril', '2026-04-31T10:00:00Z'],
    ['mes 13', '2026-13-01T10:00:00Z'],
    ['mes 00', '2026-00-10T10:00:00Z'],
    ['dia 00', '2026-10-00T10:00:00Z'],
    ['hora 24', '2026-10-20T24:00:00Z'],
    ['minuto 60', '2026-10-20T15:60:00Z'],
    ['segundo 60', '2026-10-20T15:00:60Z'],
    ['offset con hora 24', '2026-10-20T15:00:00+24:00'],
    ['offset con minuto 60', '2026-10-20T15:00:00+03:60'],
    ['anio 1999', '1999-12-31T23:59:59Z'],
    ['anio 2101', '2101-01-01T00:00:00Z'],
    ['el offset lo saca del rango (2101)', '2100-12-31T23:00:00-05:00'],
    ['el offset lo saca del rango (1999)', '2000-01-01T01:00:00+03:00'],
    ['cadena vacia', ''],
    ['texto cualquiera', 'ayer'],
    ['epoch como string', '1760972400000']
  ])('invalido: %s', (_nombre, entrada) => {
    expect(L.lineaTiempoPozoLogic_normalizarTimestamp(entrada)).toBeNull();
  });

  test.each([[null], [undefined], [1760972400000], [new Date(T1)], [{}], [[]], [true], [NaN]])('no es un string: %p -> null (ni numeros ni Date se interpretan)', (valor) => {
    expect(L.lineaTiempoPozoLogic_normalizarTimestamp(valor)).toBeNull();
  });

  test('idempotente: normalizar lo ya normalizado no cambia nada', () => {
    ['2026-10-20T12:00:00-03:00', T3, '2026-10-20T15:00:00Z'].forEach((t) => {
      const n = L.lineaTiempoPozoLogic_normalizarTimestamp(t);
      expect(L.lineaTiempoPozoLogic_normalizarTimestamp(n)).toBe(n);
    });
  });

  test('no depende de la zona horaria de la maquina (jamas consulta la zona local)', () => {
    const espia = jest.spyOn(Date.prototype, 'getTimezoneOffset').mockImplementation(() => { throw new Error('no debe usar la zona local'); });
    const getHours = jest.spyOn(Date.prototype, 'getHours').mockImplementation(() => { throw new Error('no debe usar la zona local'); });
    try {
      expect(L.lineaTiempoPozoLogic_normalizarTimestamp('2026-10-20T12:00:00-03:00')).toBe('2026-10-20T15:00:00.000Z');
      expect(L.lineaTiempoPozoLogic_normalizarTimestamp(T1)).toBe(T1);
    } finally {
      espia.mockRestore();
      getHours.mockRestore();
    }
  });

  test('el formato canonico tiene ancho fijo: comparar strings es comparar instantes', () => {
    const a = L.lineaTiempoPozoLogic_normalizarTimestamp('2026-10-20T15:00:00Z');
    const b = L.lineaTiempoPozoLogic_normalizarTimestamp('2026-10-20T15:00:00.001Z');
    const c = L.lineaTiempoPozoLogic_normalizarTimestamp('2026-10-20T12:00:00.002-03:00');
    expect(a.length).toBe(24);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
  });
});

describe('lineaTiempoPozoLogic_limpiarTexto / nombreVisible', () => {
  const limpiar = L.lineaTiempoPozoLogic_limpiarTexto;

  test('colapsa espacios y saltos de linea en una sola linea', () => {
    expect(limpiar('  uno \n\n dos\r\ntres\t\tcuatro  ')).toBe('uno dos tres cuatro');
    expect(limpiar('a' + CC(0x2028) + 'b' + CC(0x2029) + 'c' + CC(0x85) + 'd' + CC(0xA0) + 'e')).toBe('a b c d e');
  });

  test('quita caracteres de control, de direccion y de ancho cero (no los convierte en texto visible)', () => {
    expect(limpiar('a' + CC(0) + CC(7) + CC(0x1F) + CC(0x7F) + CC(0x9F) + 'b')).toBe('ab');
    expect(limpiar('x' + CC(0x202E) + 'y' + CC(0x2066) + CC(0x2069) + 'z')).toBe('xyz');
    expect(limpiar('x' + CC(0x200B) + CC(0x200F) + 'y' + CC(0x2060) + CC(0xFEFF) + 'z')).toBe('xyz');
  });

  test('HTML y marcado se conservan como TEXTO PLANO (la interfaz muestra con textContent; no se escapa dos veces)', () => {
    expect(limpiar('<script>alert(1)</script> & "comillas"')).toBe('<script>alert(1)</script> & "comillas"');
    expect(limpiar('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>');
  });

  test('emoji y caracteres fuera del BMP se conservan completos', () => {
    expect(limpiar('pozo 💧 ok 👍🏽')).toBe('pozo 💧 ok 👍🏽');
  });

  test('un surrogate suelto (UTF-16 invalido) se elimina; un par valido se conserva', () => {
    expect(limpiar('a' + String.fromCharCode(0xD83D) + 'b')).toBe('ab');
    expect(limpiar('a' + String.fromCharCode(0xDCA7) + 'b')).toBe('ab');
    expect(limpiar('a💧b')).toBe('a💧b');
  });

  test('largo maximo en code points: nunca parte un emoji por la mitad', () => {
    const emojis = '💧'.repeat(10);
    expect(limpiar(emojis, 5)).toBe('💧💧💧💧…');
    expect(limpiar(emojis, 10)).toBe(emojis);                              // justo en el limite: no se corta
    expect(limpiar(emojis, 9)).toBe('💧'.repeat(8) + '…');
    const largo = limpiar('palabra '.repeat(100));
    expect(Array.from(largo).length).toBe(140);
    expect(L.LINEA_TIEMPO_DETALLE_MAX).toBe(140);
    expect(largo.endsWith('…')).toBe(true);
    expect(largo.endsWith(' …')).toBe(false);                              // sin espacio colgado antes de los puntos suspensivos
  });

  test('no es un string, o queda vacio: null', () => {
    [null, undefined, 5, true, {}, [], ''].forEach((v) => expect(limpiar(v)).toBeNull());
    expect(limpiar('   \n\t  ')).toBeNull();
    expect(limpiar(CC(0x200B) + CC(0x202E))).toBeNull();
  });

  test('nombre visible: el del payload; vacio, ausente o con "@" (un email colado) -> "Usuario"', () => {
    const nombre = L.lineaTiempoPozoLogic_nombreVisible;
    expect(nombre('Ana Perez')).toBe('Ana Perez');
    expect(nombre('  Ana \n Perez ')).toBe('Ana Perez');
    ['', '   ', null, undefined, 3, {}].forEach((v) => expect(nombre(v)).toBe('Usuario'));
    expect(nombre('ana@example.com')).toBe('Usuario');
    expect(nombre('Ana (ana@x.com)')).toBe('Usuario');
    expect(Array.from(nombre('N'.repeat(300))).length).toBe(80);
    expect(L.LINEA_TIEMPO_NOMBRE_MAX).toBe(80);
  });
});

describe('Ubicacion: correcciones (getCorreccionesUbicacionPozo)', () => {
  const norm = (data, w) => L.lineaTiempoPozoLogic_normalizarCorrecciones(data, w === undefined ? W : w);

  test('una propuesta pendiente: UBICACION_PROPUESTA con instante, autor, observacion y metodo', () => {
    const r = norm(pozoUbic([correccion(1)]));
    expect(r.ok).toBe(true);
    expect(r.omitidos).toEqual([]);
    expect(r.eventos).toEqual([{
      id: 'UBICACION:corr-0001:PROPUESTA', fuente: 'UBICACION', tipo: 'UBICACION_PROPUESTA', timestamp: T1, nombre: 'Ana', titulo: 'Ubicación propuesta',
      detalle: 'Observacion 1', estado: 'PROPUESTA', metadata: { metodo: 'PUNTO_EN_MAPA' }
    }]);
  });

  test('validada (o autovalidada): propuesta + UBICACION_VALIDADA con el instante de la RESOLUCION', () => {
    const r = norm(pozoUbic([resuelta(1, 'VALIDADA', { nombrePropone: 'Carla' }, { nombre: 'Carla', timestamp: T1, motivo: 'Validada automaticamente al crearla' })]));
    expect(tipos(r)).toEqual(['UBICACION_PROPUESTA', 'UBICACION_VALIDADA']);
    expect(r.eventos[1]).toMatchObject({ id: 'UBICACION:corr-0001:VALIDADA', timestamp: T1, nombre: 'Carla', titulo: 'Ubicación validada en campo', detalle: 'Validada automaticamente al crearla', estado: 'VALIDADA', metadata: {} });
  });

  test.each([['RECHAZADA', 'UBICACION_RECHAZADA'], ['SUPERADA', 'UBICACION_SUPERADA'], ['REVERTIDA', 'UBICACION_REVERTIDA']])('%s: propuesta + %s con el instante del ultimo evento', (estado, tipo) => {
    const r = norm(pozoUbic([resuelta(1, estado)]));
    expect(tipos(r)).toEqual(['UBICACION_PROPUESTA', tipo]);
    expect(r.eventos[1]).toMatchObject({ id: 'UBICACION:corr-0001:' + estado, timestamp: T2, nombre: 'Valeria', detalle: 'Motivo ' + estado, estado });
    expect(r.eventos[0].estado).toBe(estado);                              // la propuesta informa el estado ACTUAL de la correccion (para atenuarla en la interfaz)
  });

  test('SUPERADA / REVERTIDA: la VALIDADA intermedia NO se fabrica (el payload no trae su instante)', () => {
    ['SUPERADA', 'REVERTIDA'].forEach((estado) => {
      const r = norm(pozoUbic([resuelta(1, estado)]));
      expect(tipos(r)).not.toContain('UBICACION_VALIDADA');
      expect(r.eventos.length).toBe(2);
    });
  });

  test('primeraUbicacion solo se informa en la VALIDADA y solo si es exactamente true', () => {
    expect(norm(pozoUbic([resuelta(1, 'VALIDADA', { primeraUbicacion: true })])).eventos[1].metadata).toEqual({ primeraUbicacion: true });
    ['SI', 1, 'true', null, false, undefined].forEach((v) => expect(norm(pozoUbic([resuelta(1, 'VALIDADA', { primeraUbicacion: v })])).eventos[1].metadata).toEqual({}));
    expect(norm(pozoUbic([resuelta(1, 'REVERTIDA', { primeraUbicacion: true })])).eventos[1].metadata).toEqual({});
    expect(norm(pozoUbic([correccion(1, { primeraUbicacion: true })])).eventos[0].metadata).toEqual({ metodo: 'PUNTO_EN_MAPA' });
  });

  test('metodo desconocido -> null (no se copia un valor ajeno al catalogo)', () => {
    expect(norm(pozoUbic([correccion(1, { metodo: 'TELEPATIA' })])).eventos[0].metadata).toEqual({ metodo: null });
    expect(norm(pozoUbic([correccion(1, { metodo: { a: 1 } })])).eventos[0].metadata).toEqual({ metodo: null });
    ['GPS_ACTUAL', 'PUNTO_EN_MAPA', 'COORDENADAS_GMS', 'COORDENADAS_POSGAR94_AR2'].forEach((m) => expect(norm(pozoUbic([correccion(1, { metodo: m })])).eventos[0].metadata.metodo).toBe(m));
  });

  test('observacion vacia, ausente o solo con espacios: detalle null', () => {
    ['', '   ', null, undefined].forEach((o) => expect(norm(pozoUbic([correccion(1, { observacion: o })])).eventos[0].detalle).toBeNull());
  });

  test('INCONSISTENTE se omite entera (no se afirma nada de una cadena dudosa)', () => {
    const r = norm(pozoUbic([correccion(1, { estado: 'INCONSISTENTE' }), correccion(2)]));
    expect(r.eventos.map((e) => e.id)).toEqual(['UBICACION:corr-0002:PROPUESTA']);
    expect(omit(r)).toEqual({ ESTADO_INCONSISTENTE: 1 });
  });

  test('estado desconocido: se omite', () => {
    [{ estado: 'EN_REVISION' }, { estado: null }, { estado: undefined }, { estado: 7 }, { estado: 'validada' }].forEach((extra) => {
      const r = norm(pozoUbic([correccion(1, extra)]));
      expect(r.eventos).toEqual([]);
      expect(omit(r)).toEqual({ ESTADO_DESCONOCIDO: 1 });
    });
  });

  test('resolucion que no coincide con el estado, o ausente en una resuelta: solo la propuesta, y queda anotado', () => {
    const incoherente = norm(pozoUbic([correccion(1, { estado: 'VALIDADA', resolucion: { evento: 'RECHAZADA', nombre: 'V', timestamp: T2, motivo: null } })]));
    expect(tipos(incoherente)).toEqual(['UBICACION_PROPUESTA']);
    expect(omit(incoherente)).toEqual({ RESOLUCION_INCONSISTENTE: 1 });
    const sinResolucion = norm(pozoUbic([correccion(1, { estado: 'VALIDADA', resolucion: null })]));
    expect(tipos(sinResolucion)).toEqual(['UBICACION_PROPUESTA']);
    expect(omit(sinResolucion)).toEqual({ RESOLUCION_INCONSISTENTE: 1 });
    const pendienteConResolucion = norm(pozoUbic([correccion(1, { estado: 'PROPUESTA', resolucion: { evento: 'VALIDADA', nombre: 'V', timestamp: T2, motivo: null } })]));
    expect(tipos(pendienteConResolucion)).toEqual(['UBICACION_PROPUESTA']);
    expect(omit(pendienteConResolucion)).toEqual({ RESOLUCION_INCONSISTENTE: 1 });
  });

  test('timestamp invalido: se omite ESE evento, no el otro', () => {
    const sinPropuesta = norm(pozoUbic([resuelta(1, 'VALIDADA', { timestamp: '2026-10-20 15:00:00' })]));
    expect(tipos(sinPropuesta)).toEqual(['UBICACION_VALIDADA']);
    expect(omit(sinPropuesta)).toEqual({ TIMESTAMP_INVALIDO: 1 });
    const sinResolucion = norm(pozoUbic([resuelta(1, 'VALIDADA', {}, { timestamp: 'ayer' })]));
    expect(tipos(sinResolucion)).toEqual(['UBICACION_PROPUESTA']);
    expect(omit(sinResolucion)).toEqual({ TIMESTAMP_INVALIDO: 1 });
    const nulo = norm(pozoUbic([correccion(1, { timestamp: null })]));
    expect(nulo.eventos).toEqual([]);
    expect(omit(nulo)).toEqual({ TIMESTAMP_INVALIDO: 1 });
  });

  test('timestamp con offset: se lleva a UTC', () => {
    expect(norm(pozoUbic([correccion(1, { timestamp: '2026-10-20T12:00:00-03:00' })])).eventos[0].timestamp).toBe(T1);
  });

  test('una correccion de OTRO pozo, o sin id usable, se omite', () => {
    const r = norm(pozoUbic([correccion(1, { wellId: OTRO }), correccion(2, { correccionId: '' }), correccion(3, { correccionId: 'corto' }), correccion(4, { correccionId: 'con espacio 1' }), null, 'x', 7, correccion(5)]));
    expect(r.eventos.map((e) => e.id)).toEqual(['UBICACION:corr-0005:PROPUESTA']);
    expect(omit(r)).toEqual({ ITEM_INVALIDO: 6, WELL_ID_DISTINTO: 1 });
  });

  test('solo se lee `historial`: vigente y pendientes (subconjuntos) no duplican ni agregan', () => {
    const c = resuelta(1, 'VALIDADA');
    const r = norm(pozoUbic([c], { vigente: c, pendientes: [correccion(9)] }));
    expect(r.eventos.map((e) => e.id)).toEqual(['UBICACION:corr-0001:PROPUESTA', 'UBICACION:corr-0001:VALIDADA']);
  });

  test('payload mal formado: ok=false con un codigo, sin lanzar', () => {
    [null, undefined, 'x', 5, [], {}, { wellId: W }, { wellId: W, historial: 'no' }, { wellId: W, historial: {} }].forEach((data) => {
      const r = norm(data);
      expect(r).toEqual({ ok: false, eventos: [], omitidos: [{ codigo: 'PAYLOAD_INVALIDO', cantidad: 1 }] });
    });
  });

  test('payload de otro pozo (respuesta vieja de otra apertura): ok=false', () => {
    expect(norm(pozoUbic([correccion(1)], { wellId: OTRO }))).toEqual({ ok: false, eventos: [], omitidos: [{ codigo: 'WELL_ID_DISTINTO', cantidad: 1 }] });
  });

  test('wellId pedido invalido: ok=false', () => {
    ['', 'x', '14-006', '1-0006', null, undefined, 1406].forEach((w) => expect(L.lineaTiempoPozoLogic_normalizarCorrecciones(pozoUbic([correccion(1)]), w).omitidos[0].codigo).toBe('WELL_ID_INVALIDO'));
  });

  test('un historial vacio es valido', () => {
    expect(norm(pozoUbic([]))).toEqual({ ok: true, eventos: [], omitidos: [] });
  });
});

describe('Ubicacion: decisiones sobre fuentes (getDecisionesFuentesPozo)', () => {
  const norm = (data, w) => L.lineaTiempoPozoLogic_normalizarDecisiones(data, w === undefined ? W : w);

  test.each([
    ['ACEPTADA', 'FUENTE_ACEPTADA', 'Fuente de ubicación aceptada'],
    ['DESCARTADA', 'FUENTE_DESCARTADA', 'Fuente de ubicación descartada'],
    ['ACEPTACION_QUITADA', 'FUENTE_ACEPTACION_QUITADA', 'Aceptación de fuente quitada'],
    ['RESTAURADA', 'FUENTE_RESTAURADA', 'Fuente de ubicación restaurada']
  ])('%s -> %s', (evento, tipo, titulo) => {
    const r = norm(pozoDec([decision(7, { evento, motivo: 'Por X' })]));
    expect(r.eventos).toEqual([{
      id: 'DECISION:14-0006:000000007', fuente: 'UBICACION', tipo, timestamp: T1, nombre: 'Valeria', titulo, detalle: 'Por X', estado: null, metadata: { fuenteTipo: 'REPORTE_POZOS' }
    }]);
  });

  test('es un historial real: un evento por fila, en cualquier orden de llegada', () => {
    const r = norm(pozoDec([decision(3, { evento: 'DESCARTADA', timestampUtc: T3 }), decision(1, { timestampUtc: T1 }), decision(2, { evento: 'RESTAURADA', timestampUtc: T2 })]));
    expect(r.eventos.map((e) => e.tipo)).toEqual(['FUENTE_DESCARTADA', 'FUENTE_ACEPTADA', 'FUENTE_RESTAURADA']);
  });

  test('el id usa la secuencia con relleno (el orden de los ids es el orden de escritura) y la coordenada de la fuente NO se copia', () => {
    const r = norm(pozoDec([decision(9), decision(10)]));
    expect(r.eventos.map((e) => e.id)).toEqual(['DECISION:14-0006:000000009', 'DECISION:14-0006:000000010']);
    expect(JSON.stringify(r)).not.toMatch(/2486460|6310651/);
    expect(Object.keys(r.eventos[0])).not.toContain('x');
    expect(Object.keys(r.eventos[0].metadata)).toEqual(['fuenteTipo']);
  });

  test('fuenteTipo desconocida -> null; obsoleta solo si es exactamente true', () => {
    expect(norm(pozoDec([decision(1, { fuenteTipo: 'OTRA' })])).eventos[0].metadata).toEqual({ fuenteTipo: null });
    expect(norm(pozoDec([decision(1, { fuenteTipo: 'IRRIGACION', obsoleta: true })])).eventos[0].metadata).toEqual({ fuenteTipo: 'IRRIGACION', obsoleta: true });
    ['SI', 1, 'true', null, undefined].forEach((v) => expect(norm(pozoDec([decision(1, { obsoleta: v })])).eventos[0].metadata).toEqual({ fuenteTipo: 'REPORTE_POZOS' }));
  });

  test('nombre vacio -> "Usuario"; motivo vacio -> detalle null', () => {
    const e = norm(pozoDec([decision(1, { nombre: '', motivo: '' })])).eventos[0];
    expect(e.nombre).toBe('Usuario');
    expect(e.detalle).toBeNull();
  });

  test('log NO integro: no hay eventos (ninguna decision aplica) y queda anotado; no es un error', () => {
    const r = norm(pozoDec([], { integro: false }));
    expect(r).toEqual({ ok: true, eventos: [], omitidos: [{ codigo: 'HISTORIAL_NO_INTEGRO', cantidad: 1 }] });
    const sinCampo = norm({ wellId: W, historial: [decision(1)] });
    expect(sinCampo.eventos).toEqual([]);                                  // sin `integro === true` no se confia en el historial
    expect(omit(sinCampo)).toEqual({ HISTORIAL_NO_INTEGRO: 1 });
  });

  test('secuencia invalida, evento desconocido o timestamp invalido: se omite ese item', () => {
    const r = norm(pozoDec([
      decision(0), decision(-1), decision(1.5), decision('3'), decision(null), decision(1000000000),
      decision(4, { evento: 'BORRADA' }), decision(5, { evento: undefined }),
      decision(6, { timestampUtc: '' }), decision(7, { timestampUtc: '2026-10-14 14:32:10' }),
      null, 'x',
      decision(8)
    ]));
    expect(r.eventos.map((e) => e.id)).toEqual(['DECISION:14-0006:000000008']);
    expect(omit(r)).toEqual({ EVENTO_DESCONOCIDO: 2, ITEM_INVALIDO: 8, TIMESTAMP_INVALIDO: 2 });
  });

  test('no se confunde con propiedades heredadas como nombre de evento', () => {
    ['constructor', 'toString', '__proto__', 'hasOwnProperty'].forEach((evento) => expect(norm(pozoDec([decision(1, { evento })])).eventos).toEqual([]));
  });

  test('payload mal formado u otro pozo: ok=false', () => {
    expect(norm(null).ok).toBe(false);
    expect(norm({ wellId: W, integro: true }).ok).toBe(false);
    expect(norm(pozoDec([decision(1)], { wellId: OTRO })).omitidos[0].codigo).toBe('WELL_ID_DISTINTO');
  });
});

describe('Reemplazo (getHistorialReemplazo)', () => {
  const norm = (data, w) => L.lineaTiempoPozoLogic_normalizarReemplazo(data, w === undefined ? W : w);

  test.each([['APTO', 'REEMPLAZO_APTO', 'Evaluación de reemplazo: apto'], ['NO_APTO', 'REEMPLAZO_NO_APTO', 'Evaluación de reemplazo: no apto'], ['DUDOSO', 'REEMPLAZO_DUDOSO', 'Evaluación de reemplazo: dudoso']])('%s -> %s', (estado, tipo, titulo) => {
    const r = norm(pozoReemp([evaluacion(1, { estado, motivo: 'SIN_ACCESO', observacion: 'Portón cerrado' })]));
    expect(r.eventos).toEqual([{
      id: 'REEMPLAZO:00000000-0000-4000-8000-000000000001', fuente: 'REEMPLAZO', tipo, timestamp: T1, nombre: 'Marta', titulo, detalle: 'Portón cerrado', estado, metadata: { motivo: 'SIN_ACCESO' }
    }]);
  });

  test('cada fila es un evento: el historial completo, no solo el estado vigente', () => {
    const r = norm(pozoReemp([evaluacion(3, { estado: 'APTO', timestamp: T3 }), evaluacion(2, { estado: 'DUDOSO', timestamp: T2 }), evaluacion(1, { estado: 'NO_APTO', timestamp: T1 })]));
    expect(tipos(r)).toEqual(['REEMPLAZO_APTO', 'REEMPLAZO_DUDOSO', 'REEMPLAZO_NO_APTO']);
  });

  test('SIN_EVALUAR y estados desconocidos NO son eventos (SIN_EVALUAR es la ausencia de evaluaciones)', () => {
    ['SIN_EVALUAR', 'PENDIENTE', '', null, undefined, 'apto', 3, 'constructor'].forEach((estado) => {
      const r = norm(pozoReemp([evaluacion(1, { estado })]));
      expect(r.eventos).toEqual([]);
      expect(omit(r)).toEqual({ ESTADO_DESCONOCIDO: 1 });
    });
  });

  test('motivo: solo un CODIGO del catalogo (mayusculas y guion bajo); un texto libre en ese campo no pasa', () => {
    expect(norm(pozoReemp([evaluacion(1, { motivo: null })])).eventos[0].metadata).toEqual({ motivo: null });
    expect(norm(pozoReemp([evaluacion(1, { motivo: 'el vecino dijo que no' })])).eventos[0].metadata).toEqual({ motivo: null });
    expect(norm(pozoReemp([evaluacion(1, { motivo: 'POZO_CEGADO' })])).eventos[0].metadata).toEqual({ motivo: 'POZO_CEGADO' });
    expect(norm(pozoReemp([evaluacion(1, { motivo: 'X'.repeat(41) })])).eventos[0].metadata).toEqual({ motivo: null });
  });

  test('el punto NE de referencia no se copia', () => {
    const r = norm(pozoReemp([evaluacion(1, { puntoNEReferencia: 'INA 2055' })]));
    expect(JSON.stringify(r)).not.toContain('INA 2055');
  });

  test('sin evaluacionId usable: clave determinista con campos estables (pozo, instante y estado), sin texto libre', () => {
    const a = norm(pozoReemp([evaluacion(1, { evaluacionId: '', observacion: 'uno', nombre: 'A' })])).eventos[0];
    const b = norm(pozoReemp([evaluacion(1, { evaluacionId: undefined, observacion: 'otro', nombre: 'B' })])).eventos[0];
    expect(a.id).toBe('REEMPLAZO:14-0006:' + T1 + ':APTO');
    expect(b.id).toBe(a.id);
    expect(norm(pozoReemp([evaluacion(1, { evaluacionId: 'corto', estado: 'DUDOSO', motivo: 'SIN_ACCESO' })])).eventos[0].id).toBe('REEMPLAZO:14-0006:' + T1 + ':DUDOSO');
    expect(a.id).not.toContain('uno');
  });

  test('timestamp invalido, otro pozo o item invalido: se omite', () => {
    const r = norm(pozoReemp([evaluacion(1, { timestamp: null }), evaluacion(2, { timestamp: '2026-10-20' }), evaluacion(3, { wellId: OTRO }), null, 'x', evaluacion(4)]));
    expect(r.eventos.length).toBe(1);
    expect(omit(r)).toEqual({ ITEM_INVALIDO: 2, TIMESTAMP_INVALIDO: 2, WELL_ID_DISTINTO: 1 });
  });

  test('observacion con HTML, multilinea y emoji: extracto de una linea, texto plano', () => {
    const d = norm(pozoReemp([evaluacion(1, { observacion: '<b>Hola</b>\n\nlinea 2 💧' })])).eventos[0].detalle;
    expect(d).toBe('<b>Hola</b> linea 2 💧');
  });

  test('payload mal formado u otro pozo: ok=false', () => {
    expect(norm({ wellId: W }).ok).toBe(false);
    expect(norm({ wellId: W, evaluaciones: 'x' }).ok).toBe(false);
    expect(norm(pozoReemp([evaluacion(1)]), OTRO).ok).toBe(false);
  });
});

describe('Observaciones (getObservacionesPozo)', () => {
  const norm = (data, w) => L.lineaTiempoPozoLogic_normalizarObservaciones(data, w === undefined ? W : w);

  test('activa: OBSERVACION_AGREGADA con extracto del texto', () => {
    const r = norm(pozoObs([obs(1, { texto: 'Acceso por el camino de tierra' })]));
    expect(r.eventos).toEqual([{
      id: 'OBSERVACION:00000000-0000-4000-8000-000000000001:ALTA', fuente: 'OBSERVACIONES', tipo: 'OBSERVACION_AGREGADA', timestamp: T1, nombre: 'Ana', titulo: 'Observación agregada',
      detalle: 'Acceso por el camino de tierra', estado: 'ACTIVA', metadata: {}
    }]);
  });

  test('anulada: AGREGADA (sin texto) + ANULADA con instante, nombre y motivo de la anulacion', () => {
    const r = norm(pozoObs([obsAnulada(1)]));
    expect(r.eventos).toEqual([
      { id: 'OBSERVACION:00000000-0000-4000-8000-000000000001:ALTA', fuente: 'OBSERVACIONES', tipo: 'OBSERVACION_AGREGADA', timestamp: T1, nombre: 'Ana', titulo: 'Observación agregada', detalle: null, estado: 'ANULADA', metadata: {} },
      { id: 'OBSERVACION:00000000-0000-4000-8000-000000000001:ANULADA', fuente: 'OBSERVACIONES', tipo: 'OBSERVACION_ANULADA', timestamp: T2, nombre: 'Moderadora', titulo: 'Observación anulada', detalle: 'Cargada por error', estado: 'ANULADA', metadata: {} }
    ]);
  });

  test('anulada con texto null: ningun evento conserva ni reconstruye el texto', () => {
    const r = norm(pozoObs([obsAnulada(1, { texto: null })]));
    r.eventos.forEach((e) => {
      expect(e.detalle === null || e.tipo === 'OBSERVACION_ANULADA').toBe(true);
    });
    expect(r.eventos[0].detalle).toBeNull();
  });

  test('anulada que SI trae texto (lo recibe un moderador): la linea de tiempo lo descarta igual', () => {
    const r = norm(pozoObs([obsAnulada(1, { texto: 'TEXTO-SENSIBLE-DE-UNA-ANULADA' })]));
    expect(JSON.stringify(r)).not.toContain('TEXTO-SENSIBLE-DE-UNA-ANULADA');
    expect(r.eventos[0].detalle).toBeNull();
  });

  test('la ANULADA sin texto vuelve a leerse como activa de una carga vieja: el dedupe se queda con la anulada en CUALQUIER orden', () => {
    const vieja = norm(pozoObs([obs(1, { texto: 'TEXTO-DE-LA-LECTURA-VIEJA' })])).eventos;
    const nueva = norm(pozoObs([obsAnulada(1)])).eventos;
    [vieja.concat(nueva), nueva.concat(vieja)].forEach((entrada) => {
      const salida = L.lineaTiempoPozoLogic_deduplicar(entrada);
      expect(JSON.stringify(salida)).not.toContain('TEXTO-DE-LA-LECTURA-VIEJA');
      expect(salida.find((e) => e.tipo === 'OBSERVACION_AGREGADA')).toMatchObject({ estado: 'ANULADA', detalle: null });
    });
  });

  test('anulada sin objeto `anulacion` o con instante invalido: solo la alta, anotado', () => {
    const sin = norm(pozoObs([obsAnulada(1, { anulacion: null })]));
    expect(tipos(sin)).toEqual(['OBSERVACION_AGREGADA']);
    expect(omit(sin)).toEqual({ ANULACION_AUSENTE: 1 });
    const mala = norm(pozoObs([obsAnulada(1, { anulacion: { nombre: 'M', timestamp: 'x', motivo: 'm' } })]));
    expect(tipos(mala)).toEqual(['OBSERVACION_AGREGADA']);
    expect(omit(mala)).toEqual({ TIMESTAMP_INVALIDO: 1 });
  });

  test('alta con instante invalido pero anulacion valida: queda la anulacion', () => {
    const r = norm(pozoObs([obsAnulada(1, { timestamp: 'mal' })]));
    expect(tipos(r)).toEqual(['OBSERVACION_ANULADA']);
    expect(omit(r)).toEqual({ TIMESTAMP_INVALIDO: 1 });
  });

  test('estado desconocido, otro pozo, id invalido: se omite', () => {
    const r = norm(pozoObs([obs(1, { estado: 'EDITADA' }), obs(2, { estado: undefined }), obs(3, { wellId: OTRO }), obs(4, { observacionId: 'x' }), obs(5, { observacionId: 7 }), null, obs(6)]));
    expect(r.eventos.length).toBe(1);
    expect(omit(r)).toEqual({ ESTADO_DESCONOCIDO: 2, ITEM_INVALIDO: 3, WELL_ID_DISTINTO: 1 });
  });

  test('texto con HTML, multilinea, emoji y largo: extracto seguro de una linea', () => {
    expect(norm(pozoObs([obs(1, { texto: '<script>alert("x")</script>' })])).eventos[0].detalle).toBe('<script>alert("x")</script>');
    expect(norm(pozoObs([obs(1, { texto: 'Linea 1\nLinea 2\r\n\r\nLinea 3 💧' })])).eventos[0].detalle).toBe('Linea 1 Linea 2 Linea 3 💧');
    const largo = norm(pozoObs([obs(1, { texto: 'a'.repeat(1000) })])).eventos[0].detalle;
    expect(Array.from(largo).length).toBe(140);
  });

  test('un moderador y un lector reciben payloads distintos de una anulada y producen la MISMA linea de tiempo', () => {
    const lector = norm(pozoObs([obsAnulada(1, { texto: null })]));
    const moderador = norm(pozoObs([obsAnulada(1, { texto: 'lo que vio el moderador' })]));
    expect(moderador).toEqual(lector);
  });

  test('campos extra (email, clientRequestId, secuencia, categoria, puedeAnular) se ignoran', () => {
    const r = norm(pozoObs([obs(1, { email: 'secreto@x.com', clientRequestId: 'req-secreto', secuencia: 987654321, categoria: 'ACCESO', puedeAnular: true, otro: { a: 1 } })]));
    const s = JSON.stringify(r);
    ['secreto@x.com', 'req-secreto', '987654321', 'ACCESO', 'puedeAnular'].forEach((x) => expect(s).not.toContain(x));
  });

  test('una pagina vacia es valida; payload mal formado u otro pozo: ok=false', () => {
    expect(norm(pozoObs([]))).toEqual({ ok: true, eventos: [], omitidos: [] });
    expect(norm({ wellId: W }).ok).toBe(false);
    expect(norm({ wellId: W, observaciones: null }).ok).toBe(false);
    expect(norm(Object.assign(pozoObs([obs(1)]), { wellId: OTRO })).ok).toBe(false);
  });

  test('dos paginas que se solapan no duplican eventos', () => {
    const p1 = norm(pozoObs([obs(3), obs(2)])).eventos;
    const p2 = norm(pozoObs([obs(2), obs(1)])).eventos;
    expect(L.lineaTiempoPozoLogic_deduplicar(p1.concat(p2)).length).toBe(3);
  });
});

describe('Ubicacion combinada (correcciones + decisiones)', () => {
  const norm = (data, w) => L.lineaTiempoPozoLogic_normalizarUbicacion(data, w === undefined ? W : w);

  test('junta los eventos de las dos partes y suma los omitidos', () => {
    const r = norm({ correcciones: pozoUbic([correccion(1), correccion(2, { estado: 'INCONSISTENTE' })]), decisiones: pozoDec([decision(1), decision(2, { evento: 'X' })]) });
    expect(r.ok).toBe(true);
    expect(r.eventos.map((e) => e.tipo).sort()).toEqual(['FUENTE_ACEPTADA', 'UBICACION_PROPUESTA']);
    expect(omit(r)).toEqual({ ESTADO_INCONSISTENTE: 1, EVENTO_DESCONOCIDO: 1 });
  });

  test('una parte puede faltar o estar rota: la otra sigue valiendo', () => {
    expect(norm({ correcciones: pozoUbic([correccion(1)]) }).eventos.length).toBe(1);
    expect(norm({ decisiones: pozoDec([decision(1)]) }).eventos.length).toBe(1);
    const rota = norm({ correcciones: { wellId: W, historial: 'no' }, decisiones: pozoDec([decision(1)]) });
    expect(rota.ok).toBe(true);
    expect(rota.eventos.length).toBe(1);
    expect(omit(rota)).toEqual({ PAYLOAD_INVALIDO: 1 });
  });

  test('ninguna parte utilizable: ok=false', () => {
    expect(norm({ correcciones: null, decisiones: null }).ok).toBe(false);
    expect(norm({}).ok).toBe(false);
    expect(norm(null).ok).toBe(false);
    expect(norm({ correcciones: { x: 1 }, decisiones: { y: 2 } }).ok).toBe(false);
    expect(norm({ correcciones: pozoUbic([correccion(1)], { wellId: OTRO }), decisiones: pozoDec([], { wellId: OTRO }) }).ok).toBe(false);
  });
});

describe('lineaTiempoPozoLogic_normalizarFuente', () => {
  test('despacha por fuente y rechaza las desconocidas (FOTOS no existe en v1)', () => {
    expect(L.lineaTiempoPozoLogic_normalizarFuente('REEMPLAZO', pozoReemp([evaluacion(1)]), W).eventos.length).toBe(1);
    expect(L.lineaTiempoPozoLogic_normalizarFuente('OBSERVACIONES', pozoObs([obs(1)]), W).eventos.length).toBe(1);
    expect(L.lineaTiempoPozoLogic_normalizarFuente('UBICACION', { correcciones: pozoUbic([correccion(1)]) }, W).eventos.length).toBe(1);
    ['FOTOS', 'fotos', 'NE', '', null, undefined, 'constructor', '__proto__'].forEach((f) => {
      expect(L.lineaTiempoPozoLogic_normalizarFuente(f, {}, W)).toEqual({ ok: false, eventos: [], omitidos: [{ codigo: 'FUENTE_DESCONOCIDA', cantidad: 1 }] });
    });
  });

  test('nunca lanza, aunque el payload sea cualquier cosa', () => {
    const basura = [null, undefined, 0, 1, 'x', true, [], {}, [[]], { historial: {} }, { historial: [null] }, { evaluaciones: [undefined, 1, 'x', []] }, { observaciones: [[], {}, { anulacion: 3 }] }, { correcciones: 7, decisiones: [] }];
    ['UBICACION', 'REEMPLAZO', 'OBSERVACIONES'].forEach((f) => basura.forEach((b) => {
      expect(() => L.lineaTiempoPozoLogic_normalizarFuente(f, b, W)).not.toThrow();
    }));
  });
});

describe('forma del evento: lista blanca', () => {
  const valido = () => copia(L.lineaTiempoPozoLogic_normalizarObservaciones(pozoObs([obs(1)]), W).eventos[0]);

  test('un evento normalizado es valido; todos los eventos de todas las fuentes lo son', () => {
    const todos = []
      .concat(L.lineaTiempoPozoLogic_normalizarUbicacion({ correcciones: pozoUbic([resuelta(1, 'VALIDADA', { primeraUbicacion: true }), resuelta(2, 'SUPERADA'), resuelta(3, 'RECHAZADA'), resuelta(4, 'REVERTIDA'), correccion(5)]), decisiones: pozoDec([decision(1), decision(2, { evento: 'DESCARTADA' }), decision(3, { evento: 'ACEPTACION_QUITADA' }), decision(4, { evento: 'RESTAURADA', obsoleta: true })]) }, W).eventos)
      .concat(L.lineaTiempoPozoLogic_normalizarReemplazo(pozoReemp([evaluacion(1), evaluacion(2, { estado: 'NO_APTO', motivo: 'SECO' }), evaluacion(3, { estado: 'DUDOSO', motivo: 'SIN_ACCESO' })]), W).eventos)
      .concat(L.lineaTiempoPozoLogic_normalizarObservaciones(pozoObs([obs(1), obsAnulada(2)]), W).eventos);
    expect(todos.length).toBe(19);
    todos.forEach((e) => expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(true));
    expect(new Set(todos.map((e) => e.tipo)).size).toBe(Object.keys(L.LINEA_TIEMPO_TIPOS).length);          // se ejercitaron TODOS los tipos del catalogo
  });

  test.each([
    ['una clave de mas', (e) => { e.email = 'a@b.com'; }],
    ['falta una clave', (e) => { delete e.detalle; }],
    ['id vacio', (e) => { e.id = ''; }],
    ['id no string', (e) => { e.id = 5; }],
    ['id gigante', (e) => { e.id = 'x'.repeat(121); }],
    ['fuente que no corresponde al tipo', (e) => { e.fuente = 'REEMPLAZO'; }],
    ['fuente desconocida', (e) => { e.fuente = 'FOTOS'; }],
    ['tipo desconocido', (e) => { e.tipo = 'FOTO_AGREGADA'; }],
    ['tipo heredado', (e) => { e.tipo = 'constructor'; }],
    ['titulo que no es el del catalogo', (e) => { e.titulo = 'Observación de Ana'; }],
    ['timestamp sin normalizar', (e) => { e.timestamp = '2026-10-20T12:00:00-03:00'; }],
    ['timestamp invalido', (e) => { e.timestamp = 'ayer'; }],
    ['timestamp no string', (e) => { e.timestamp = 1760972400000; }],
    ['nombre vacio', (e) => { e.nombre = ''; }],
    ['nombre no string', (e) => { e.nombre = null; }],
    ['detalle vacio', (e) => { e.detalle = ''; }],
    ['detalle no string', (e) => { e.detalle = 5; }],
    ['estado no string', (e) => { e.estado = 5; }],
    ['metadata no objeto', (e) => { e.metadata = null; }],
    ['metadata arreglo', (e) => { e.metadata = []; }],
    ['metadata con una clave no permitida para el tipo', (e) => { e.metadata = { motivo: 'X' }; }],
    ['metadata con email', (e) => { e.metadata = { email: 'a@b.com' }; }]
  ])('invalido: %s', (_n, rompe) => {
    const e = valido();
    rompe(e);
    expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(false);
  });

  test('metadata con un valor que no es string, booleano o null: invalido', () => {
    const e = L.lineaTiempoPozoLogic_normalizarReemplazo(pozoReemp([evaluacion(1)]), W).eventos[0];
    expect(L.lineaTiempoPozoLogic_esEventoValido(Object.assign({}, e, { metadata: { motivo: { a: 1 } } }))).toBe(false);
    expect(L.lineaTiempoPozoLogic_esEventoValido(Object.assign({}, e, { metadata: { motivo: 5 } }))).toBe(false);
    expect(L.lineaTiempoPozoLogic_esEventoValido(Object.assign({}, e, { metadata: { motivo: null } }))).toBe(true);
  });

  test('no son eventos: null, string, numero, arreglo', () => {
    [null, undefined, 'x', 5, [], true].forEach((x) => expect(L.lineaTiempoPozoLogic_esEventoValido(x)).toBe(false));
  });

  test('cada tipo del catalogo pertenece a una de las tres fuentes y tiene titulo fijo; FOTOS no esta', () => {
    Object.keys(L.LINEA_TIEMPO_TIPOS).forEach((t) => {
      expect(L.LINEA_TIEMPO_ORDEN_FUENTES).toContain(L.LINEA_TIEMPO_TIPOS[t].fuente);
      expect(typeof L.LINEA_TIEMPO_TIPOS[t].titulo).toBe('string');
    });
    expect(Object.keys(L.LINEA_TIEMPO_TIPOS).some((t) => /FOTO/.test(t))).toBe(false);
    expect(L.LINEA_TIEMPO_ORDEN_FUENTES).toEqual(['UBICACION', 'REEMPLAZO', 'OBSERVACIONES']);
  });
});

describe('deduplicar', () => {
  const ev = (id, extra) => Object.assign(copia(L.lineaTiempoPozoLogic_normalizarObservaciones(pozoObs([obs(1)]), W).eventos[0]), { id }, extra || {});

  test('un id repetido queda una sola vez; a igual avance gana la ULTIMA aparicion, en la posicion de la primera', () => {
    const r = L.lineaTiempoPozoLogic_deduplicar([ev('A', { detalle: 'primero' }), ev('B'), ev('A', { detalle: 'segundo' })]);
    expect(r.map((e) => e.id)).toEqual(['A', 'B']);
    expect(r[0].detalle).toBe('segundo');
  });

  test('la misma correccion leida pendiente y luego validada: gana la de mayor avance sin importar el orden', () => {
    const pendiente = L.lineaTiempoPozoLogic_normalizarCorrecciones(pozoUbic([correccion(1)]), W).eventos;
    const validada = L.lineaTiempoPozoLogic_normalizarCorrecciones(pozoUbic([resuelta(1, 'VALIDADA')]), W).eventos;
    [pendiente.concat(validada), validada.concat(pendiente)].forEach((entrada) => {
      const r = L.lineaTiempoPozoLogic_deduplicar(entrada);
      expect(r.length).toBe(2);
      expect(r.find((e) => e.tipo === 'UBICACION_PROPUESTA').estado).toBe('VALIDADA');
    });
  });

  test('descarta lo que no es un evento valido y tolera entradas que no son arreglos', () => {
    expect(L.lineaTiempoPozoLogic_deduplicar([null, 'x', {}, ev('A'), { id: 'Z' }]).map((e) => e.id)).toEqual(['A']);
    [null, undefined, 'x', 5, {}].forEach((x) => expect(L.lineaTiempoPozoLogic_deduplicar(x)).toEqual([]));
  });

  test('no muta la entrada', () => {
    const entrada = [ev('A'), ev('A')];
    const antes = copia(entrada);
    L.lineaTiempoPozoLogic_deduplicar(entrada);
    expect(entrada).toEqual(antes);
  });

  test('ids distintos con mismo contenido no se confunden', () => {
    expect(L.lineaTiempoPozoLogic_deduplicar([ev('A'), ev('B'), ev('C')]).length).toBe(3);
  });
});

describe('orden: mas reciente primero, empates deterministas', () => {
  const E = (id, tipo, timestamp, extra) => {
    const fuente = L.LINEA_TIEMPO_TIPOS[tipo].fuente;
    return Object.assign({ id, fuente, tipo, timestamp, nombre: 'Ana', titulo: L.LINEA_TIEMPO_TIPOS[tipo].titulo, detalle: null, estado: null, metadata: tipo === 'REEMPLAZO_APTO' ? { motivo: null } : (tipo === 'FUENTE_ACEPTADA' ? { fuenteTipo: null } : (tipo === 'UBICACION_PROPUESTA' ? { metodo: null } : {})) }, extra || {});
  };
  const ids = (lista) => lista.map((e) => e.id);

  test('descendente por instante (no ascendente)', () => {
    const r = L.lineaTiempoPozoLogic_ordenar([E('a', 'OBSERVACION_AGREGADA', T1), E('c', 'OBSERVACION_AGREGADA', T3), E('b', 'OBSERVACION_AGREGADA', T2)]);
    expect(ids(r)).toEqual(['c', 'b', 'a']);
  });

  test('mezcla fuentes por instante, no por fuente', () => {
    const r = L.lineaTiempoPozoLogic_ordenar([E('o1', 'OBSERVACION_AGREGADA', T1), E('r2', 'REEMPLAZO_APTO', T2), E('u3', 'UBICACION_PROPUESTA', T3), E('o4', 'OBSERVACION_AGREGADA', T2 + '')]);
    expect(r.map((e) => e.timestamp)).toEqual([T3, T2, T2, T1]);
  });

  test('milisegundos distintos se ordenan', () => {
    const r = L.lineaTiempoPozoLogic_ordenar([E('a', 'OBSERVACION_AGREGADA', '2026-10-20T15:00:00.001Z'), E('b', 'OBSERVACION_AGREGADA', '2026-10-20T15:00:00.002Z'), E('c', 'OBSERVACION_AGREGADA', '2026-10-20T15:00:00.000Z')]);
    expect(ids(r)).toEqual(['b', 'a', 'c']);
  });

  test('mismo instante: el rango causal manda (VALIDADA arriba, SUPERADA, PROPUESTA abajo; ANULADA arriba de su alta)', () => {
    const r = L.lineaTiempoPozoLogic_ordenar([E('p', 'UBICACION_PROPUESTA', T1), E('v', 'UBICACION_VALIDADA', T1), E('s', 'UBICACION_SUPERADA', T1)]);
    expect(ids(r)).toEqual(['v', 's', 'p']);
    const o = L.lineaTiempoPozoLogic_ordenar([E('alta', 'OBSERVACION_AGREGADA', T1), E('baja', 'OBSERVACION_ANULADA', T1)]);
    expect(ids(o)).toEqual(['baja', 'alta']);
  });

  test('mismo instante y rango: fuente ascendente, luego tipo ascendente, luego id DESCENDENTE', () => {
    const r = L.lineaTiempoPozoLogic_ordenar([E('x', 'REEMPLAZO_APTO', T1), E('x', 'OBSERVACION_AGREGADA', T1), E('x', 'FUENTE_ACEPTADA', T1), E('x', 'UBICACION_PROPUESTA', T1)]);
    expect(r.map((e) => e.fuente + ':' + e.tipo)).toEqual(['OBSERVACIONES:OBSERVACION_AGREGADA', 'REEMPLAZO:REEMPLAZO_APTO', 'UBICACION:FUENTE_ACEPTADA', 'UBICACION:UBICACION_PROPUESTA']);
    const mismos = L.lineaTiempoPozoLogic_ordenar([E('DECISION:14-0006:000000001', 'FUENTE_ACEPTADA', T1), E('DECISION:14-0006:000000003', 'FUENTE_ACEPTADA', T1), E('DECISION:14-0006:000000002', 'FUENTE_ACEPTADA', T1)]);
    expect(ids(mismos)).toEqual(['DECISION:14-0006:000000003', 'DECISION:14-0006:000000002', 'DECISION:14-0006:000000001']);
  });

  test('el resultado NO depende del orden de llegada: 200 permutaciones al azar dan lo mismo', () => {
    const base = [];
    ['OBSERVACION_AGREGADA', 'OBSERVACION_ANULADA', 'REEMPLAZO_APTO', 'UBICACION_PROPUESTA', 'UBICACION_VALIDADA', 'FUENTE_ACEPTADA'].forEach((tipo, i) => {
      [T1, T1, T2, T3].forEach((t, j) => base.push(E('id-' + i + '-' + j, tipo, t)));
    });
    const esperado = ids(L.lineaTiempoPozoLogic_ordenar(base));
    let semilla = 12345;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla / 2147483648; };
    for (let k = 0; k < 200; k += 1) {
      const mezcla = base.slice().sort(() => azar() - 0.5);
      expect(ids(L.lineaTiempoPozoLogic_ordenar(mezcla))).toEqual(esperado);
    }
  });

  test('comparar es un orden total y antisimetrico', () => {
    const a = E('a', 'OBSERVACION_AGREGADA', T1);
    const b = E('b', 'OBSERVACION_AGREGADA', T1);
    expect(L.lineaTiempoPozoLogic_comparar(a, a)).toBe(0);
    expect(Math.sign(L.lineaTiempoPozoLogic_comparar(a, b))).toBe(-Math.sign(L.lineaTiempoPozoLogic_comparar(b, a)));
    expect(L.lineaTiempoPozoLogic_comparar(a, b)).not.toBe(0);
  });

  test('no muta la entrada, descarta lo invalido y tolera lo que no es un arreglo', () => {
    const entrada = [E('a', 'OBSERVACION_AGREGADA', T1), null, { id: 'z' }, E('b', 'OBSERVACION_AGREGADA', T3)];
    const antes = copia(entrada);
    const r = L.lineaTiempoPozoLogic_ordenar(entrada);
    expect(ids(r)).toEqual(['b', 'a']);
    expect(entrada).toEqual(antes);
    [null, undefined, 'x', 5, {}].forEach((x) => expect(L.lineaTiempoPozoLogic_ordenar(x)).toEqual([]));
  });
});

describe('filtrarPorFuente', () => {
  const lista = L.lineaTiempoPozoLogic_armar({
    UBICACION: { estado: 'OK', data: { correcciones: pozoUbic([correccion(1)]) } },
    REEMPLAZO: { estado: 'OK', data: pozoReemp([evaluacion(1, { timestamp: T2 })]) },
    OBSERVACIONES: { estado: 'OK', data: pozoObs([obs(1, { timestamp: T3 })]) }
  }, W).eventos;
  const fuentes = (r) => r.map((e) => e.fuente);

  test('sin filtro: todos; con un nombre o un arreglo: solo esas fuentes, en el orden recibido', () => {
    expect(fuentes(L.lineaTiempoPozoLogic_filtrarPorFuente(lista))).toEqual(['OBSERVACIONES', 'REEMPLAZO', 'UBICACION']);
    expect(fuentes(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, null))).toEqual(['OBSERVACIONES', 'REEMPLAZO', 'UBICACION']);
    expect(fuentes(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, 'REEMPLAZO'))).toEqual(['REEMPLAZO']);
    expect(fuentes(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, ['UBICACION', 'OBSERVACIONES']))).toEqual(['OBSERVACIONES', 'UBICACION']);
  });

  test('un arreglo vacio o fuentes desconocidas no dejan ninguno (no equivale a "todas")', () => {
    expect(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, [])).toEqual([]);
    expect(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, ['FOTOS'])).toEqual([]);
    expect(L.lineaTiempoPozoLogic_filtrarPorFuente(lista, '')).toEqual([]);
  });

  test('no muta, devuelve una copia y tolera una entrada que no es arreglo', () => {
    const r = L.lineaTiempoPozoLogic_filtrarPorFuente(lista);
    expect(r).not.toBe(lista);
    expect(r).toEqual(lista);
    [null, undefined, 'x', {}].forEach((x) => expect(L.lineaTiempoPozoLogic_filtrarPorFuente(x, 'UBICACION')).toEqual([]));
  });
});

describe('armar: fuentes mezcladas y fallos parciales', () => {
  const buenas = () => ({
    UBICACION: { estado: 'OK', data: { correcciones: pozoUbic([resuelta(1, 'VALIDADA', {}, { timestamp: T3 })]), decisiones: pozoDec([decision(1, { timestampUtc: T1 })]) } },
    REEMPLAZO: { estado: 'OK', data: pozoReemp([evaluacion(1, { timestamp: T2 })]) },
    OBSERVACIONES: { estado: 'OK', data: pozoObs([obs(1, { timestamp: T1 }), obsAnulada(2, { timestamp: T1 })]) }
  });
  const armar = (entradas, w) => L.lineaTiempoPozoLogic_armar(entradas, w === undefined ? W : w);

  test('mezcla las tres fuentes, ordenadas por instante descendente', () => {
    const r = armar(buenas());
    expect(r.wellId).toBe(W);
    expect(r.parcial).toBe(false);
    const ts = r.eventos.map((e) => e.timestamp);
    expect(ts).toEqual(ts.slice().sort().reverse());
    expect(new Set(r.eventos.map((e) => e.fuente))).toEqual(new Set(['UBICACION', 'REEMPLAZO', 'OBSERVACIONES']));
    expect(r.fuentes).toEqual({
      UBICACION: { estado: 'OK', cantidad: 3, omitidos: [] },
      REEMPLAZO: { estado: 'OK', cantidad: 1, omitidos: [] },
      OBSERVACIONES: { estado: 'OK', cantidad: 3, omitidos: [] }
    });
    expect(r.eventos.length).toBe(7);
  });

  test('una fuente sin permiso: no es un fallo, las demas siguen', () => {
    const e = buenas();
    e.REEMPLAZO = { estado: 'SIN_PERMISO' };
    const r = armar(e);
    expect(r.fuentes.REEMPLAZO).toEqual({ estado: 'SIN_PERMISO', cantidad: 0, omitidos: [] });
    expect(r.parcial).toBe(false);
    expect(r.eventos.some((x) => x.fuente === 'REEMPLAZO')).toBe(false);
    expect(r.eventos.length).toBe(6);
  });

  test('una fuente que fallo: ERROR y parcial, pero las demas siguen siendo utilizables', () => {
    const e = buenas();
    e.OBSERVACIONES = { estado: 'ERROR' };
    const r = armar(e);
    expect(r.fuentes.OBSERVACIONES.estado).toBe('ERROR');
    expect(r.parcial).toBe(true);
    expect(r.eventos.length).toBe(4);
  });

  test('una fuente vacia: VACIA (no es un fallo)', () => {
    const e = buenas();
    e.REEMPLAZO = { estado: 'OK', data: pozoReemp([]) };
    const r = armar(e);
    expect(r.fuentes.REEMPLAZO).toEqual({ estado: 'VACIA', cantidad: 0, omitidos: [] });
    expect(r.parcial).toBe(false);
  });

  test('una fuente que falta: NO_CARGADA y parcial', () => {
    const e = buenas();
    delete e.UBICACION;
    const r = armar(e);
    expect(r.fuentes.UBICACION).toEqual({ estado: 'NO_CARGADA', cantidad: 0, omitidos: [] });
    expect(r.parcial).toBe(true);
  });

  test('OK con payload mal formado -> ERROR (y las demas siguen)', () => {
    const e = buenas();
    e.OBSERVACIONES = { estado: 'OK', data: { wellId: W, observaciones: 'no' } };
    const r = armar(e);
    expect(r.fuentes.OBSERVACIONES).toEqual({ estado: 'ERROR', cantidad: 0, omitidos: [{ codigo: 'PAYLOAD_INVALIDO', cantidad: 1 }] });
    expect(r.parcial).toBe(true);
    expect(r.eventos.length).toBe(4);
  });

  test('OK con payload de OTRO pozo (respuesta vieja) -> ERROR: no se mezclan pozos', () => {
    const e = buenas();
    e.REEMPLAZO = { estado: 'OK', data: { wellId: OTRO, evaluaciones: [evaluacion(1, { wellId: OTRO })] } };
    const r = armar(e);
    expect(r.fuentes.REEMPLAZO.estado).toBe('ERROR');
    expect(r.eventos.some((x) => x.fuente === 'REEMPLAZO')).toBe(false);
  });

  test('estado de entrada desconocido o entrada que no es objeto: ERROR / NO_CARGADA, sin lanzar', () => {
    const e = buenas();
    e.REEMPLAZO = { estado: 'QUIZAS' };
    e.OBSERVACIONES = 'x';
    const r = armar(e);
    expect(r.fuentes.REEMPLAZO.estado).toBe('ERROR');
    expect(r.fuentes.OBSERVACIONES.estado).toBe('NO_CARGADA');
  });

  test('todas fallan o no hay entradas: la linea de tiempo existe y esta vacia (no hay "global invalida")', () => {
    [armar({ UBICACION: { estado: 'ERROR' }, REEMPLAZO: { estado: 'ERROR' }, OBSERVACIONES: { estado: 'ERROR' } }), armar({}), armar(null), armar(undefined), armar('x')].forEach((r) => {
      expect(r.eventos).toEqual([]);
      expect(r.parcial).toBe(true);
      expect(Object.keys(r.fuentes)).toEqual(['UBICACION', 'REEMPLAZO', 'OBSERVACIONES']);
    });
  });

  test('wellId invalido: todas las fuentes OK pasan a ERROR', () => {
    const r = armar(buenas(), 'abc');
    expect(r.eventos).toEqual([]);
    expect(Object.keys(r.fuentes).map((f) => r.fuentes[f].estado)).toEqual(['ERROR', 'ERROR', 'ERROR']);
    [123, null, {}].forEach((w) => expect(armar(buenas(), w).wellId).toBeNull());
    expect(L.lineaTiempoPozoLogic_armar(buenas(), undefined).wellId).toBeNull();
    expect(armar(buenas(), W).wellId).toBe(W);
  });

  test('las claves ajenas (FOTOS, NE, __proto__) se ignoran: no producen eventos ni fuentes', () => {
    const e = buenas();
    e.FOTOS = { estado: 'OK', data: { total: 1, fotos: [{ fotoId: 'f1' }] } };
    e.NE = { estado: 'OK', data: {} };
    const r = armar(e);
    expect(Object.keys(r.fuentes)).toEqual(['UBICACION', 'REEMPLAZO', 'OBSERVACIONES']);
    expect(r.eventos.some((x) => /FOTO/.test(x.tipo))).toBe(false);
    expect(r.eventos.length).toBe(7);
  });

  test('una clave heredada del prototipo no cuenta como entrada de una fuente', () => {
    Object.prototype.UBICACION = { estado: 'OK', data: { correcciones: pozoUbic([correccion(1)]) } };
    try {
      const r = armar({});
      expect(r.fuentes.UBICACION.estado).toBe('NO_CARGADA');
      expect(r.eventos).toEqual([]);
    } finally {
      delete Object.prototype.UBICACION;
    }
  });

  test('el resultado no depende del orden de las claves ni de la llegada de las fuentes (Promise.all)', () => {
    const e = buenas();
    const reves = { OBSERVACIONES: e.OBSERVACIONES, REEMPLAZO: e.REEMPLAZO, UBICACION: e.UBICACION };
    expect(armar(reves)).toEqual(armar(e));
  });

  test('la cantidad por fuente cuenta los eventos que SOBREVIVEN al dedupe', () => {
    const e = buenas();
    e.OBSERVACIONES = { estado: 'OK', data: pozoObs([obs(1), obs(1, { texto: 'repetida' })]) };
    const r = armar(e);
    expect(r.fuentes.OBSERVACIONES.cantidad).toBe(1);
    expect(r.eventos.filter((x) => x.fuente === 'OBSERVACIONES').length).toBe(1);
  });

  test('los omitidos de cada fuente quedan reportados por separado (codigos, sin contenido)', () => {
    const e = buenas();
    e.REEMPLAZO = { estado: 'OK', data: pozoReemp([evaluacion(1), evaluacion(2, { timestamp: 'mal' })]) };
    const r = armar(e);
    expect(r.fuentes.REEMPLAZO).toEqual({ estado: 'OK', cantidad: 1, omitidos: [{ codigo: 'TIMESTAMP_INVALIDO', cantidad: 1 }] });
  });

  test('la salida es JSON puro (sin funciones ni undefined) y no comparte referencias con la entrada', () => {
    const entrada = buenas();
    const r = armar(entrada);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    r.eventos[0].metadata.nuevo = 'x';
    expect(JSON.stringify(entrada)).not.toContain('"nuevo"');
  });
});

describe('PRIVACIDAD: la linea de tiempo nunca muestra mas que el modulo fuente', () => {
  const SECRETOS = ['secreto@dominio.test', 'req-secreto-123', '987654321', 'tok-secreto', 'drive-id-secreto', 'TEXTO-OCULTO-ANULADA', '-33.987654', 'sha1-secreto', 'COORD-ORIGINAL-SECRETA'];

  const toxicas = () => ({
    UBICACION: {
      estado: 'OK',
      data: {
        correcciones: pozoUbic([
          correccion(1, { emailPropone: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', sessionToken: 'tok-secreto', lat: -33.987654, lon: -69.987654, coordenadaOriginalTexto: 'COORD-ORIGINAL-SECRETA', secuencia: 987654321 }),
          resuelta(2, 'VALIDADA', { emailPropone: 'secreto@dominio.test' }, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123' }),
          resuelta(3, 'REVERTIDA', {}, { email: 'secreto@dominio.test' })
        ]),
        decisiones: pozoDec([decision(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', versionVista: 987654321, x: 11111.5, y: 22222.5, lat: -33.987654, lon: -69.987654 })], { sessionToken: 'tok-secreto' })
      }
    },
    REEMPLAZO: { estado: 'OK', data: pozoReemp([evaluacion(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', puntoNEReferencia: 'drive-id-secreto' })]) },
    OBSERVACIONES: {
      estado: 'OK',
      data: Object.assign(pozoObs([
        obs(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', secuencia: 987654321, sessionToken: 'tok-secreto' }),
        obsAnulada(2, { texto: 'TEXTO-OCULTO-ANULADA', email: 'secreto@dominio.test', secuencia: 987654321, sha1Original: 'sha1-secreto', driveFileId: 'drive-id-secreto' })
      ]), { cursor: 987654321 })
    }
  });

  test('ningun valor sensible o interno aparece en la salida (email, clientRequestId, secuencia, sessionToken, coordenadas, texto de anuladas, ids de Drive)', () => {
    const salida = JSON.stringify(L.lineaTiempoPozoLogic_armar(toxicas(), W));
    SECRETOS.forEach((s) => expect(salida).not.toContain(s));
  });

  test('ningun evento tiene claves fuera del modelo, y la metadata solo las permitidas de su tipo', () => {
    const r = L.lineaTiempoPozoLogic_armar(toxicas(), W);
    const permitidas = ['detalle', 'estado', 'fuente', 'id', 'metadata', 'nombre', 'timestamp', 'tipo', 'titulo'];
    expect(r.eventos.length).toBeGreaterThan(5);
    r.eventos.forEach((e) => {
      expect(Object.keys(e).sort()).toEqual(permitidas);
      Object.keys(e.metadata).forEach((k) => expect(L.LINEA_TIEMPO_METADATA_PERMITIDA[e.tipo]).toContain(k));
    });
    const claves = JSON.stringify(r).match(/"[A-Za-z]+":/g).map((c) => c.slice(1, -2));
    ['email', 'emailPropone', 'clientRequestId', 'secuencia', 'sessionToken', 'texto', 'lat', 'lon', 'x', 'y', 'driveFileId', 'puedeAnular', 'categoria', 'propia', 'versionVista', 'observacionId', 'correccionId', 'evaluacionId'].forEach((k) => {
      expect(claves).not.toContain(k);
    });
  });

  test('ningun id de evento lleva email, texto libre ni valores internos (solo ids del backend o secuencia publica de decisiones)', () => {
    const r = L.lineaTiempoPozoLogic_armar(toxicas(), W);
    r.eventos.forEach((e) => {
      expect(e.id).toMatch(/^(UBICACION:corr-\d{4}:(PROPUESTA|VALIDADA|REVERTIDA)|DECISION:14-0006:\d{9}|REEMPLAZO:[0-9a-f-]{36}|OBSERVACION:[0-9a-f-]{36}:(ALTA|ANULADA))$/);
    });
  });

  test('un texto oculto no se recupera de NINGUN objeto anterior: normalizar de nuevo con texto null no arrastra el texto de la lectura previa', () => {
    const previa = L.lineaTiempoPozoLogic_normalizarObservaciones(pozoObs([obs(1, { texto: 'TEXTO-OCULTO-ANULADA' })]), W);
    const posterior = L.lineaTiempoPozoLogic_normalizarObservaciones(pozoObs([obsAnulada(1)]), W);
    expect(JSON.stringify(posterior)).not.toContain('TEXTO-OCULTO-ANULADA');
    expect(JSON.stringify(L.lineaTiempoPozoLogic_deduplicar(previa.eventos.concat(posterior.eventos)))).not.toContain('TEXTO-OCULTO-ANULADA');
    expect(JSON.stringify(L.lineaTiempoPozoLogic_deduplicar(posterior.eventos.concat(previa.eventos)))).not.toContain('TEXTO-OCULTO-ANULADA');
  });

  test('los eventos no comparten referencias con el payload (modificar uno no altera el otro)', () => {
    const payload = pozoObs([obs(1)]);
    const e = L.lineaTiempoPozoLogic_normalizarObservaciones(payload, W).eventos[0];
    e.nombre = 'Cambiado';
    e.metadata.x = 1;
    expect(payload.observaciones[0].nombre).toBe('Ana');
  });

  test('los normalizadores no mutan el payload', () => {
    const payloads = toxicas();
    const antes = copia(payloads);
    L.lineaTiempoPozoLogic_armar(payloads, W);
    expect(payloads).toEqual(antes);
  });

  test('nombres con email colado se muestran como "Usuario" en todas las fuentes', () => {
    const r = L.lineaTiempoPozoLogic_armar({
      UBICACION: { estado: 'OK', data: { correcciones: pozoUbic([correccion(1, { nombrePropone: 'ana@x.com' })]), decisiones: pozoDec([decision(1, { nombre: 'val@x.com' })]) } },
      REEMPLAZO: { estado: 'OK', data: pozoReemp([evaluacion(1, { nombre: 'marta@x.com' })]) },
      OBSERVACIONES: { estado: 'OK', data: pozoObs([obs(1, { nombre: 'ana@x.com' })]) }
    }, W);
    r.eventos.forEach((e) => expect(e.nombre).toBe('Usuario'));
    expect(JSON.stringify(r)).not.toContain('@');
  });
});

describe('guardas del codigo fuente', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoLogic.js'), 'utf8');
  const sinComentarios = fuente.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('es logica pura: sin DOM, red, almacenamiento, API, consola, modulos ni otros archivos del frontend', () => {
    [/\bdocument\b/, /\bwindow\b/, /\bfetch\s*\(/, /XMLHttpRequest/, /localStorage|sessionStorage|indexedDB/, /\bconsole\b/, /\brequire\s*\(/, /\bimport\b/, /\bapi[A-Z]\w*\(/, /callBackend/, /setTimeout|setInterval|Promise/, /\bDate\.now\b|new Date\(\)/].forEach((re) => {
      expect(sinComentarios).not.toMatch(re);
    });
    expect(sinComentarios).not.toMatch(/\b(observacionesPozoLogic|reemplazoLogic|ubicacionCorreccionLogic|ubicacionFuenteDecisionesLogic|ubicacionesConocidasLogic)_/);
  });

  test('compatibilidad con navegadores viejos: sin regex con lookbehind, sin caracteres invisibles crudos, sin sintaxis posterior a ES5 en el codigo', () => {
    expect(fuente).not.toMatch(/\(\?<[=!]/);
    const invisibles = fuente.split('').filter((c) => {
      const o = c.charCodeAt(0);
      return (o < 32 && c !== '\n') || (o >= 0x7F && o <= 0x9F) || o === 0x2028 || o === 0x2029 || o === 0xFEFF || (o >= 0x200B && o <= 0x200F) || (o >= 0x202A && o <= 0x202E) || (o >= 0x2060 && o <= 0x2064) || (o >= 0x2066 && o <= 0x2069);
    });
    expect(invisibles).toEqual([]);
    expect(sinComentarios).not.toMatch(/=>|\blet\b|\bconst\b|`|\.\.\.|\bclass\b|\basync\b|\bawait\b/);
    expect(sinComentarios).not.toMatch(/\.(includes|startsWith|endsWith|padStart|padEnd|repeat|find|findIndex)\(/);
  });

  test('toda funcion y constante publica lleva el prefijo del modulo y esta exportada', () => {
    const nombres = (sinComentarios.match(/^function (\w+)/gm) || []).map((l) => l.replace('function ', ''));
    expect(nombres.length).toBeGreaterThan(15);
    nombres.forEach((n) => expect(n).toMatch(/^lineaTiempoPozoLogic_/));
    const constantes = (sinComentarios.match(/^var (\w+)/gm) || []).map((l) => l.replace('var ', ''));
    constantes.forEach((n) => expect(n).toMatch(/^LINEA_TIEMPO_/));
    const internas = ['tieneClave', 'esObjeto', 'enLista', 'crearEvento', 'contarOmitidos', 'problemaDePayload', 'resultadoFallido', 'avance'].map((n) => 'lineaTiempoPozoLogic_' + n);
    nombres.filter((n) => internas.indexOf(n) === -1).forEach((n) => expect(Object.keys(L)).toContain(n));
    internas.forEach((n) => expect(nombres).toContain(n));                  // la lista de internas no queda desactualizada
  });

  test('api.js (cliente de la API) no conoce el modelo: la interfaz de la linea de tiempo (E6-3) lo usa desde sus propios archivos', () => {
    const raiz = path.join(__dirname, '..');
    expect(fs.readFileSync(path.join(raiz, 'js', 'api.js'), 'utf8')).not.toMatch(/lineaTiempoPozo/);
  });
});
