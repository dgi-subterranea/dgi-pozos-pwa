// E4-3 (frontend): copy, bandeja e historial de la PRIMERA UBICACION. El backend define dos marcas distintas y la UI no las mezcla ni las vuelve a inferir:
//   - candidataPrimeraUbicacion (solo una propuesta PENDIENTE: "si se validara ahora, seria la primera") -> "Primera ubicación conocida del pozo"
//   - primeraUbicacion (hecho historico: "llego a ser la primera ubicacion VALIDADA") -> "Primera ubicación validada del pozo"; se conserva si esa V se revirtio o la supero otra.
// Cubre la logica pura (marca, item de la bandeja, detalle de validacion, tarjetas y seccion de la ficha) y la compatibilidad con un backend que no manda las marcas.
// Los controladores ejecutados de verdad (bandeja y ficha) se prueban en js/ubicacionValidacionController.test.js y js/ubicacionCorreccionController.test.js (describe "E4-3").
const fs = require('fs');
const path = require('path');

const L = require('./ubicacionCorreccionLogic');

const W = '14-0123';
const CANDIDATA = 'Primera ubicación conocida del pozo';
const VALIDADA = 'Primera ubicación validada del pozo';

const base = (estado, extra) => Object.assign({
  correccionId: '11111111-1111-4111-8111-' + String(Math.floor(Math.random() * 1e12)).padStart(12, '0'), wellId: W, lat: -33.3478, lon: -69.1456, metodo: 'GPS_ACTUAL', precisionGpsM: 9.5,
  observacion: 'Pozo conocido por ITF', nombrePropone: 'Ana Pérez', timestamp: new Date(2026, 9, 13, 9, 30).toISOString(), distanciaM: null, advertenciaDistancia: false,
  coordenadaOriginalTexto: '', crsOriginal: '', irrigacion: { lat: null, lon: null, estado: 'noEnPadron', fuente: '', padronPeriodo: '2026-09' },
  estado: estado, resolucion: estado === 'PROPUESTA' ? null : { evento: estado === 'RECHAZADA' ? 'RECHAZADA' : estado, nombre: 'Valeria', timestamp: new Date(2026, 9, 14, 10, 0).toISOString(), motivo: '' }, propia: false,
  primeraUbicacion: false, candidataPrimeraUbicacion: false
}, extra || {});
const pendiente = (extra) => base('PROPUESTA', extra);
const candidata = (extra) => pendiente(Object.assign({ candidataPrimeraUbicacion: true }, extra || {}));

const cuenta = (h, texto) => h.split(texto).length - 1;
const sinFlags = (c) => { const x = Object.assign({}, c); delete x.primeraUbicacion; delete x.candidataPrimeraUbicacion; return x; };

describe('E4-3: marcaPrimera (solo lo que informa el backend, solo === true)', () => {
  const m = L.ubicacionCorreccionLogic_marcaPrimera;

  test('copy exacto de las dos frases', () => {
    expect(L.UCORR_TEXTO_PRIMERA_CANDIDATA).toBe(CANDIDATA);
    expect(L.UCORR_TEXTO_PRIMERA_VALIDADA).toBe(VALIDADA);
    expect(CANDIDATA).not.toBe(VALIDADA);
  });

  test('PENDIENTE: solo candidataPrimeraUbicacion cuenta (y es "candidata", no "historica")', () => {
    expect(m(pendiente({ candidataPrimeraUbicacion: true }))).toEqual({ tipo: 'candidata', texto: CANDIDATA });
    expect(m(pendiente({ candidataPrimeraUbicacion: false }))).toBeNull();
    expect(m(pendiente({ candidataPrimeraUbicacion: false, primeraUbicacion: true }))).toBeNull();      // una pendiente no "ya fue" la primera: no se mezclan
  });

  test.each(['VALIDADA', 'REVERTIDA', 'SUPERADA'])('%s: solo primeraUbicacion cuenta (marca "historica"), sin importar el estado actual', (estado) => {
    expect(m(base(estado, { primeraUbicacion: true }))).toEqual({ tipo: 'historica', texto: VALIDADA });
    expect(m(base(estado, { primeraUbicacion: false }))).toBeNull();
    expect(m(base(estado, { primeraUbicacion: false, candidataPrimeraUbicacion: true }))).toBeNull();    // lo resuelto NO usa la candidata
  });

  test('RECHAZADA e INCONSISTENTE nunca se marcan, aunque el dato viniera en true', () => {
    ['RECHAZADA', 'INCONSISTENTE'].forEach((estado) => {
      expect(m(base(estado, { primeraUbicacion: true, candidataPrimeraUbicacion: true }))).toBeNull();
    });
  });

  test('ausente, null o no booleano (backend sin las marcas) = false; nada se infiere', () => {
    expect(m(sinFlags(pendiente()))).toBeNull();
    expect(m(sinFlags(base('VALIDADA')))).toBeNull();
    [undefined, null, 'true', 'si', 1, 0, {}, []].forEach((v) => {
      expect(m(pendiente({ candidataPrimeraUbicacion: v }))).toBeNull();
      expect(m(base('VALIDADA', { primeraUbicacion: v }))).toBeNull();
    });
    expect(m(null)).toBeNull();
    expect(m(undefined)).toBeNull();
    expect(m('x')).toBeNull();
    expect(m({})).toBeNull();
    expect(m({ estado: 'DESCONOCIDO', primeraUbicacion: true })).toBeNull();
  });

  test('no se vuelve a inferir en el frontend: la funcion no mira fechas, ordenes ni eventos', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionCorreccionLogic.js'), 'utf8');
    const cuerpo = fuente.slice(fuente.indexOf('function ubicacionCorreccionLogic_marcaPrimera'), fuente.indexOf('// Texto de Irrigacion del modal'));
    expect(cuerpo.length).toBeGreaterThan(100);
    expect(cuerpo.replace(/\/\/.*$/gm, '')).not.toMatch(/timestamp|orden|resolucion|evento|historial|pendientes|Date/);
  });
});

describe('E4-3: BANDEJA de pendientes (item)', () => {
  const item = (c) => L.ubicacionCorreccionLogic_htmlItemPendiente(c);

  test('pendiente candidata: "Primera ubicación conocida del pozo" y NO dice que ya fue la primera validada', () => {
    const h = item(candidata());
    expect(h).toContain('<span class="uval-primera uval-primera-candidata">' + CANDIDATA + '</span>');
    expect(h).not.toContain(VALIDADA);
  });

  test('pendiente NO candidata (o campos ausentes): el copy normal de siempre, sin ninguna marca', () => {
    [pendiente(), sinFlags(pendiente()), pendiente({ candidataPrimeraUbicacion: 'true' })].forEach((c) => {
      const h = item(c);
      expect(h).not.toContain('uval-primera');
      expect(h).not.toContain('Primera ubicación');
      expect(h).toContain('Propuesta por Ana Pérez');
      expect(h).toContain('Sin ubicación de Irrigación para comparar');                    // el copy legado de una propuesta comun sin referencia
    });
  });

  test('una primera ubicacion no repite "Sin ubicación de Irrigación para comparar": el rotulo ya lo dice', () => {
    expect(item(candidata())).not.toContain('para comparar');
  });

  test('con distancia numerica (caso raro) la distancia se sigue mostrando', () => {
    expect(item(candidata({ distanciaM: 123.4 }))).toContain('A 123,4 m de la ubicación de Irrigación');
  });

  test('la accion sigue siendo la de siempre: todo el renglon abre el detalle (Revisar), con sus datos', () => {
    const h = item(candidata({ correccionId: 'abc-id' }));
    expect(h).toContain('data-uval-correccion="abc-id"');
    expect(h).toContain('Revisar ›');
    expect(h).toContain('Observación: Pozo conocido por ITF');
    expect(h).toContain('14-0123');
  });

  test('texto escapado', () => {
    expect(item(candidata({ nombrePropone: '<img src=x>' }))).not.toContain('<img');
  });

  test('DOS pendientes candidatas a la vez: ambas se marcan (la competencia la resuelve el backend, no el frontend)', () => {
    const a = candidata({ correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const b = candidata({ correccionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nombrePropone: 'Beto' });
    const r = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 2, pendientes: [a, b] } });
    const html = r.items.map(L.ubicacionCorreccionLogic_htmlItemPendiente).join('');
    expect(cuenta(html, CANDIDATA)).toBe(2);
  });

  test('refresco posterior: si una se valido, la cola nueva trae la otra SIN candidata y deja de marcarse (el frontend solo pinta lo que llega)', () => {
    const a = candidata({ correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const b = candidata({ correccionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', nombrePropone: 'Beto' });
    const antes = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 2, pendientes: [a, b] } }).items.map(L.ubicacionCorreccionLogic_htmlItemPendiente).join('');
    expect(cuenta(antes, CANDIDATA)).toBe(2);
    const despues = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 1, pendientes: [Object.assign({}, b, { candidataPrimeraUbicacion: false })] } });
    const html = despues.items.map(L.ubicacionCorreccionLogic_htmlItemPendiente).join('');
    expect(html).not.toContain(CANDIDATA);
    expect(html).toContain('Beto');
  });

  test('el resumen no pierde ni inventa las marcas: pasan tal cual como las manda el backend', () => {
    const r = L.ubicacionCorreccionLogic_resumenPendientes({ status: 'ok', data: { total: 2, pendientes: [candidata(), sinFlags(pendiente())] } });
    expect(r.items.map((c) => L.ubicacionCorreccionLogic_marcaPrimera(c) && L.ubicacionCorreccionLogic_marcaPrimera(c).tipo)).toEqual(['candidata', null]);
  });
});

describe('E4-3: DETALLE de validacion', () => {
  const det = (c, o) => L.ubicacionCorreccionLogic_htmlDetalleValidacion(c, o || { vigente: null, vigenteEstado: 'ok' });

  test('candidata fuera del padron: rotulo + "no figura en el padrón actual" (sin "Sin ubicación de Irrigación para comparar" ni fila de distancia)', () => {
    const h = det(candidata());
    expect(h).toContain('<p class="uval-primera uval-primera-candidata">' + CANDIDATA + '</p>');
    expect(h).toContain('Este pozo no figura en el padrón actual.');
    expect(h).not.toContain('para comparar');
    expect(h).not.toContain('Distancia a Irrigación');
    expect(h).not.toContain('No disponible');
  });

  test('candidata de un pozo del padron sin coordenada: "figura en el padrón, pero no tiene una coordenada cargada"', () => {
    const h = det(candidata({ irrigacion: { lat: null, lon: null, estado: 'sinCoordenadas' } }));
    expect(h).toContain('Este pozo figura en el padrón, pero no tiene una coordenada cargada.');
  });

  test('candidata con un snapshot desconocido: "No disponible" (no se inventa nada)', () => {
    expect(det(candidata({ irrigacion: null }))).toContain('No disponible');
    expect(det(candidata({ irrigacion: { lat: null, lon: null, estado: 'otraCosa' } }))).toContain('No disponible');
  });

  test('pendiente NO candidata sin Irrigacion: el copy legado intacto', () => {
    const h = det(pendiente());
    expect(h).not.toContain('uval-primera');
    expect(h).toContain('Sin ubicación de Irrigación para comparar');
    expect(h).toContain('No disponible');
  });

  test('con coordenada de Irrigacion y distancia: sin cambios (distancia y coordenada)', () => {
    const h = det(pendiente({ distanciaM: 22.2, irrigacion: { lat: -33.34765, lon: -69.14545, estado: 'unica' } }));
    expect(h).toContain('22,2 m');
    expect(h).toContain('-33.34765, -69.14545');
    expect(h).not.toContain('uval-primera');
  });
});

describe('E4-3: HISTORIAL y correcciones de la ficha (tarjetas)', () => {
  const tarjeta = (c, modo) => L.ubicacionCorreccionLogic_htmlTarjeta(c, { modo: modo || 'historial' });
  const SPAN_HIST = '<span class="ucorr-tag-primera ucorr-tag-primera-historica">' + VALIDADA + '</span>';
  const SPAN_CAND = '<span class="ucorr-tag-primera ucorr-tag-primera-candidata">' + CANDIDATA + '</span>';

  test('primeraUbicacion=true VALIDADA (vigente): "Primera ubicación validada del pozo"', () => {
    const h = tarjeta(base('VALIDADA', { primeraUbicacion: true }), 'vigente');
    expect(h).toContain(SPAN_HIST);
    expect(h).not.toContain(CANDIDATA);
  });

  test.each(['VALIDADA', 'REVERTIDA', 'SUPERADA'])('primeraUbicacion=true %s en el historial: la marca historica SE CONSERVA (es un hecho; el estado actual no la oculta)', (estado) => {
    const h = tarjeta(base(estado, { primeraUbicacion: true }));
    expect(h).toContain(SPAN_HIST);
    expect(h).not.toContain(CANDIDATA);
    expect(h).toContain(L.ubicacionCorreccionLogic_etiquetaEstado(estado));                  // y el estado actual sigue siendo el suyo
  });

  test.each(['VALIDADA', 'REVERTIDA', 'SUPERADA'])('primeraUbicacion=false %s: ninguna marca', (estado) => {
    const h = tarjeta(base(estado));
    expect(h).not.toContain('Primera ubicación');
    expect(h).not.toContain('ucorr-tag-primera');
  });

  test('RECHAZADA nunca queda rotulada (ni con el dato en true por error)', () => {
    expect(tarjeta(base('RECHAZADA'))).not.toContain('Primera ubicación');
    expect(tarjeta(base('RECHAZADA', { primeraUbicacion: true, candidataPrimeraUbicacion: true }))).not.toContain('Primera ubicación');
  });

  test('pendiente candidata en la ficha: "Primera ubicación conocida del pozo" (y nunca la frase historica)', () => {
    const h = tarjeta(candidata(), 'pendiente');
    expect(h).toContain(SPAN_CAND);
    expect(h).not.toContain(VALIDADA);
  });

  test('NO se mezclan: una validada con candidata=true y primera=false no muestra nada; una pendiente con primera=true y candidata=false tampoco', () => {
    expect(tarjeta(base('VALIDADA', { primeraUbicacion: false, candidataPrimeraUbicacion: true }))).not.toContain('Primera ubicación');
    expect(tarjeta(pendiente({ primeraUbicacion: true, candidataPrimeraUbicacion: false }), 'pendiente')).not.toContain('Primera ubicación');
  });

  test('el rotulo no pisa lo demas de la tarjeta (estado, advertencia, datos, acciones de validar)', () => {
    const h = L.ubicacionCorreccionLogic_htmlTarjeta(candidata({ advertenciaDistancia: true }), { modo: 'pendiente', puedeValidar: true });
    expect(h).toContain('Pendiente');
    expect(h).toContain('A más de 1 km de Irrigación');
    expect(h).toContain('data-uval-accion="validar"');
    expect(h).toContain('data-uval-accion="rechazar"');
    expect(h).toContain(CANDIDATA);
  });
});

describe('E4-3: seccion de la ficha: autovalidacion, historia y rechazos', () => {
  const sec = (data, opc) => L.ubicacionCorreccionLogic_htmlSeccion(data, Object.assign({ puedeCorregir: true, textoBoton: 'Agregar ubicación', sinUbicacion: true }, opc || {}));

  test('primera ubicacion AUTOVALIDADA: la vigente dice "validada del pozo" y no aparece ninguna "candidata" (coherente con el exito inmediato)', () => {
    const v = base('VALIDADA', { primeraUbicacion: true, candidataPrimeraUbicacion: false });
    const h = sec({ vigente: v, pendientes: [], historial: [v] }, { sinUbicacion: false });
    expect(cuenta(h, VALIDADA)).toBe(2);                                                    // la vigente y su entrada del historial: el mismo hecho
    expect(h).not.toContain(CANDIDATA);
  });

  test('una correccion POSTERIOR no es primera: la primera (superada) conserva la marca y la vigente nueva no la tiene', () => {
    const primera = base('SUPERADA', { primeraUbicacion: true, correccionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', timestamp: new Date(2026, 9, 13).toISOString() });
    const posterior = base('VALIDADA', { primeraUbicacion: false, correccionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', timestamp: new Date(2026, 9, 15).toISOString(), nombrePropone: 'Carla' });
    const h = sec({ vigente: posterior, pendientes: [], historial: [posterior, primera] }, { sinUbicacion: false });
    expect(cuenta(h, VALIDADA)).toBe(1);                                                    // solo la historia de la primera
    expect(h).not.toContain(CANDIDATA);
    const vigente = h.slice(h.indexOf('ucorr-card-vigente'), h.indexOf('<details'));
    expect(vigente).not.toContain('Primera ubicación');
  });

  test('revertida: la primera sigue marcada en el historial aunque no haya vigente', () => {
    const primera = base('REVERTIDA', { primeraUbicacion: true });
    const h = sec({ vigente: null, pendientes: [], historial: [primera] });
    expect(h).toContain(VALIDADA);
    expect(h).toContain('Revertida');
  });

  test('propuesta rechazada: sin marca; la nueva propuesta candidata SI se rotula', () => {
    const rechazada = base('RECHAZADA');
    const nueva = candidata({ correccionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', nombrePropone: 'Beto' });
    const h = sec({ vigente: null, pendientes: [nueva], historial: [rechazada, nueva] });
    const historial = h.slice(h.indexOf('<details'));
    expect(historial).toContain('Rechazada');
    expect(cuenta(h, CANDIDATA)).toBe(2);                                                   // la pendiente y su entrada del historial (esta aun PROPUESTA)
    expect(cuenta(h, VALIDADA)).toBe(0);
    const tarjetaRechazada = historial.split('<div class="ucorr-card').filter((x) => x.indexOf('Rechazada') !== -1)[0];
    expect(tarjetaRechazada).not.toContain('Primera ubicación');
  });

  test('backend viejo (sin marcas en ninguna vista): la seccion se pinta igual que antes, sin ninguna marca ni error', () => {
    const v = sinFlags(base('VALIDADA'));
    const p = sinFlags(pendiente());
    const r = sinFlags(base('RECHAZADA'));
    const h = sec({ vigente: v, pendientes: [p], historial: [v, p, r] }, { sinUbicacion: false });
    expect(h).not.toContain('Primera ubicación');
    expect(h).not.toContain('ucorr-tag-primera');
    expect(h).toContain('Historial de correcciones (3)');
  });

  test('datos nulos o incompletos no rompen', () => {
    expect(() => sec(null)).not.toThrow();
    expect(() => sec({ vigente: null, pendientes: null, historial: null })).not.toThrow();
    expect(() => sec({ vigente: {}, pendientes: [{}], historial: [{}] })).not.toThrow();
  });
});

describe('E4-3: mensajes de exito (se mantienen; el copy no se sobreexplica)', () => {
  const m = L.ubicacionCorreccionLogic_mensajeResultado;

  test.each([
    ['primera ubicacion propuesta', 'pendiente', true, 'Ubicación sugerida. Queda pendiente de validación.'],
    ['primera ubicacion autovalidada', 'validada', true, 'Ubicación agregada y validada.'],
    ['correccion propuesta', 'pendiente', false, 'Corrección enviada para validación.'],
    ['correccion autovalidada', 'validada', false, 'Ubicación corregida y validada.']
  ])('%s -> "%s"', (n, resultado, primera, esperado) => {
    expect(m(resultado, primera)).toBe(esperado);
  });

  test('ninguno de los mensajes usa las frases de las marcas (el mensaje no mezcla conceptos)', () => {
    ['pendiente', 'validada'].forEach((r) => [true, false].forEach((p) => {
      expect(m(r, p)).not.toContain(CANDIDATA);
      expect(m(r, p)).not.toContain(VALIDADA);
    }));
  });
});
