// Anulacion de observaciones en el frontend (E5-6): quien ve "Anular" (moderador por permiso; autor SOLO con una senal del backend; nunca por nombre; nunca en una anulada), motivo (3..300,
// normalizado como el backend, code points), clientRequestId por intencion, respuestas / errores, descarte de respuestas viejas y el REEMPLAZO en sitio de la observacion anulada (sin merge:
// un texto null del backend borra el original). El DOM esta en observacionesPozoAnularController.test.js.
global.reemplazoLogic_formatearFecha = require('./reemplazoLogic').reemplazoLogic_formatearFecha;
const L = require('./observacionesPozoLogic');
const backend = require('../backend/src/ObservacionesPozoService');

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null, puedeAnular: true }, extra || {});
const anulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Cargada por error' } }, extra || {}));
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });
const respuesta = (o, duplicada) => ({ status: 'ok', data: { wellId: W, duplicada: duplicada === true, observacion: o } });
const CRID = /^[A-Za-z0-9_-]{8,64}$/;
const vista = (o) => L.observacionesPozoLogic_vista(o);
const MOD = { observaciones: true, observaciones_anular: true };
const AUTOR = { observaciones: true, observaciones_agregar: true };

describe('quien ve "Anular": SOLO la senal del backend (puedeAnular === true) en una ACTIVA', () => {
  const activa = vista(obs(1));
  const sinSenal = vista(obs(1, { puedeAnular: false }));
  const anuladaV = vista(anulada(2));

  test.each([
    ['ACTIVA con la senal', { observaciones: true }, activa, true],
    ['ACTIVA con la senal, aunque no tenga agregar ni anular (el backend ya decidio)', { observaciones: true }, activa, true],
    ['ACTIVA sin la senal (false)', { observaciones: true }, sinSenal, false],
    ['moderador SIN la senal: no (no hay fallback a observaciones_anular)', MOD, sinSenal, false],
    ['autor con agregar SIN la senal: no (no hay fallback a observaciones_agregar)', AUTOR, sinSenal, false],
    ['moderador + agregar + anular sin la senal: no', { observaciones: true, observaciones_agregar: true, observaciones_anular: true }, sinSenal, false],
    ['ANULADA con la senal corrupta en true: nunca', MOD, vista(anulada(3, { puedeAnular: true })), false],
    ['ANULADA', MOD, anuladaV, false],
    ['estado desconocido con la senal: nunca', MOD, { id: 'x', estado: 'BORRADA', puedeAnular: true }, false],
    ['sin estado: nunca', MOD, { id: 'x', puedeAnular: true }, false],
    ['observaciones false (guarda global)', { observaciones: false }, activa, false],
    ['observaciones ausente', { observaciones_anular: true, observaciones_agregar: true }, activa, false],
    ['permisos ausentes', undefined, activa, false],
    ['permisos null', null, activa, false],
    ['vista nula', MOD, null, false],
    ['vista undefined', MOD, undefined, false]
  ])('%s -> %s', (_n, permisos, v, esperado) => {
    expect(L.observacionesPozoLogic_puedeAnular(permisos, v)).toBe(esperado);
  });

  test.each([['SI'], [1], ['true'], [{}], [[]], ['1'], [null], [undefined], [0], ['']])('puedeAnular del payload = %j (no es el booleano true): sin boton', (valor) => {
    const v = vista(obs(1, { puedeAnular: valor }));
    expect(v.puedeAnular).toBe(false);
    expect(L.observacionesPozoLogic_puedeAnular(MOD, v)).toBe(false);
    expect(L.observacionesPozoLogic_puedeAnular(AUTOR, v)).toBe(false);
    expect(L.observacionesPozoLogic_puedeAnular(MOD, { id: 'x', estado: 'ACTIVA', puedeAnular: valor })).toBe(false);
  });

  test('un payload SIN el campo (backend viejo) no rompe la lectura y no da boton', () => {
    const viejo = { observacionId: 'obs-9', wellId: W, estado: 'ACTIVA', texto: 'Texto', categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null };
    expect(vista(viejo)).toMatchObject({ id: 'obs-9', estado: 'ACTIVA', puedeAnular: false });
    const r = L.observacionesPozoLogic_leerRespuesta(pagina([viejo]), W);
    expect(r.ok).toBe(true);
    expect(L.observacionesPozoLogic_puedeAnular(MOD, r.items[0])).toBe(false);
  });

  test('el NOMBRE no cuenta y la funcion no recibe nada de la sesion salvo los permisos: mismo resultado con cualquier nombre', () => {
    ['Ana', 'Beto', '', 'Moderadora'].forEach((nombre) => {
      expect(L.observacionesPozoLogic_puedeAnular(AUTOR, vista(obs(1, { nombre, puedeAnular: false })))).toBe(false);
      expect(L.observacionesPozoLogic_puedeAnular(AUTOR, vista(obs(1, { nombre, puedeAnular: true })))).toBe(true);
    });
    expect(L.observacionesPozoLogic_puedeAnular.length).toBe(2);
  });

  test('la vista toma puedeAnular SOLO como booleano exacto del backend y solo en una ACTIVA', () => {
    expect(vista(obs(1, { puedeAnular: undefined })).puedeAnular).toBe(false);
    expect(vista(obs(1, { puedeAnular: true })).puedeAnular).toBe(true);
    ['true', 1, 'SI', {}, [], null].forEach((v) => expect(vista(obs(1, { puedeAnular: v })).puedeAnular).toBe(false));
    expect(vista(anulada(2, { puedeAnular: true })).puedeAnular).toBe(false);
  });
});

describe('motivo: 3..300, code points, la misma normalizacion del backend', () => {
  const v = L.observacionesPozoLogic_validarMotivo;

  test('los limites son los del backend', () => {
    expect(L.OBSERVACIONES_POZO_MOTIVO_MIN).toBe(backend.OBSERVACIONES_POZO_MOTIVO_MIN);
    expect(L.OBSERVACIONES_POZO_MOTIVO_MAX).toBe(backend.OBSERVACIONES_POZO_MOTIVO_MAX);
  });

  test.each([
    ['', false, 'VACIO', 0], ['  \n ', false, 'VACIO', 0], ['ab', false, 'CORTO', 2], ['abc', true, null, 3], ['  abc  ', true, null, 3],
    ['a'.repeat(300), true, null, 300], ['a'.repeat(301), false, 'LARGO', 301]
  ])('%j -> valido=%s (%s, largo %i)', (motivo, valido, razon, largo) => {
    expect(v(motivo)).toMatchObject({ valido, motivo: razon, largo });
  });

  test('emoji cuentan 1 (300 entran, 301 no; 2 no alcanzan y 3 si); multilinea y unicode son validos', () => {
    expect(v('\u{1F600}'.repeat(300)).valido).toBe(true);
    expect('\u{1F600}'.repeat(300).length).toBe(600);
    expect(v('\u{1F600}'.repeat(301)).valido).toBe(false);
    expect(v('\u{1F600}\u{1F600}').motivo).toBe('CORTO');
    expect(v('\u{1F600}'.repeat(3)).valido).toBe(true);
    expect(v('Duplicada\nver observacion anterior ñ').valido).toBe(true);
    expect(v('<script>alert(1)</script>').texto).toBe('<script>alert(1)</script>');
  });

  test('PARIDAD con el backend: normaliza y mide igual que el backend real', () => {
    ['  uno\r\ndos\t \u0007 tres \u{1F4A7}  ', '\u202Eabc\u202C', 'a‍b', 'x\uD800yz  ', '\u0085\u2028abc\u2029'].forEach((t) => {
      expect(v(t).texto).toBe(backend.observacionesPozoService_normalizarTexto(t));
      expect(v(t).largo).toBe(backend.observacionesPozoService_largoTexto(backend.observacionesPozoService_normalizarTexto(t)));
    });
  });

  test('el contador usa el maximo del motivo; el del alta sigue en 1000', () => {
    expect(L.observacionesPozoLogic_textoContador(0, 300)).toBe('0 / 300');
    expect(L.observacionesPozoLogic_textoContador(300, 300)).toBe('300 / 300');
    expect(L.observacionesPozoLogic_textoContador(301, 300)).toBe('301 / 300 · te pasaste por 1');
    expect(L.observacionesPozoLogic_textoContador(5)).toBe('5 / 1000');
    expect(L.observacionesPozoLogic_textoContador(1001)).toBe('1001 / 1000 · te pasaste por 1');
  });

  test('el validador del alta no cambio (3..1000)', () => {
    expect(L.observacionesPozoLogic_validarTexto('a'.repeat(1000)).valido).toBe(true);
    expect(L.observacionesPozoLogic_validarTexto('a'.repeat(1001)).valido).toBe(false);
    expect(L.observacionesPozoLogic_validarTexto('ab').valido).toBe(false);
  });
});

describe('clientRequestId de la anulacion', () => {
  test('prefijo "anu-" (el alta sigue con "obs-"), siempre dentro del regex del backend', () => {
    const a = L.observacionesPozoLogic_nuevoClientRequestId(undefined, 'anu');
    expect(a).toMatch(CRID);
    expect(a.startsWith('anu-')).toBe(true);
    expect(L.observacionesPozoLogic_nuevoClientRequestId().startsWith('obs-')).toBe(true);
    expect(L.observacionesPozoLogic_nuevoClientRequestId(() => 0.5, 'anu')).toMatch(CRID);
    expect(L.observacionesPozoLogic_nuevoClientRequestId(() => 0.5, 'anu').startsWith('anu-')).toBe(true);
    const ids = new Set();
    for (let i = 0; i < 100; i += 1) { ids.add(L.observacionesPozoLogic_nuevoClientRequestId(undefined, 'anu')); }
    expect(ids.size).toBe(100);
  });
});

describe('mensajes de error de la anulacion', () => {
  test('los de la especificacion; el resto generico; nunca el message tecnico', () => {
    const m = L.observacionesPozoLogic_mensajeErrorAnular;
    expect(m('INVALID_MOTIVO')).toBe('El motivo debe tener entre 3 y 300 caracteres.');
    expect(m('INVALID_TRANSITION')).toBe('Esta observación ya no puede anularse.');
    expect(m('OBSERVACION_NOT_FOUND')).toBe('La observación ya no está disponible.');
    expect(m('PERMISSION_DENIED')).toBe('No tenés permiso para anular esta observación.');
    expect(m('SERVICE_UNAVAILABLE')).toBe('No se pudo anular la observación. Intentá nuevamente.');
    expect(m('IDEMPOTENCY_CONFLICT')).toMatch(/cambió después de un intento anterior/);
    expect(m('UNAUTHORIZED')).toMatch(/sesión venció/);
    expect(m('USER_DISABLED')).toMatch(/acceso habilitado/);
    ['INVALID_CLIENT_REQUEST_ID', 'INVALID_OBSERVACION_ID', 'INCONSISTENT_STATE', 'RED', 'LO_QUE_SEA', undefined, null, '__proto__', 'constructor'].forEach((c) => {
      expect(m(c)).toBe(L.OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO);
    });
  });
});

describe('leerRespuestaAnulacion', () => {
  const ID = 'obs-1';

  test('exito con duplicada false y true; el modelo sale de la lista blanca (texto null para el autor, texto string para quien el backend lo mande)', () => {
    const a = L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(1, { email: 'ana@x.com', clientRequestId: 'x-12345678', secuencia: 9 })), W, ID);
    expect(a).toMatchObject({ ok: true, duplicada: false });
    expect(a.vista).toMatchObject({ id: ID, estado: 'ANULADA', texto: null, puedeAnular: false });
    expect(JSON.stringify(a)).not.toMatch(/ana@x\.com|x-12345678|secuencia/);
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(1), true), W, ID)).toMatchObject({ ok: true, duplicada: true });
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(1), 'true'), W, ID).duplicada).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(1, { texto: 'original visible' })), W, ID).vista.texto).toBe('original visible');
  });

  test('errores del backend: su codigo; sin codigo -> SERVICE_UNAVAILABLE', () => {
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion({ status: 'error', code: 'INVALID_TRANSITION', message: 'x' }, W, ID)).toEqual({ ok: false, code: 'INVALID_TRANSITION' });
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion({ status: 'error' }, W, ID)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test.each([
    [null], [undefined], [5], ['ok'], [{}], [{ status: 'ok' }], [{ status: 'ok', data: null }], [{ status: 'ok', data: { wellId: W } }],
    [{ status: 'ok', data: { wellId: W, observacion: null } }], [{ status: 'ok', data: { wellId: W, observacion: 'x' } }]
  ])('respuesta mal formada %j -> SERVICE_UNAVAILABLE (no se aplica)', (resp) => {
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(resp, W, ID)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test('de otro pozo, de OTRA observacion o que no es una ANULADA: no se aplica', () => {
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion({ status: 'ok', data: { wellId: '14-0002', duplicada: false, observacion: anulada(1) } }, W, ID).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(2)), W, ID).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(obs(1)), W, ID).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAnulacion(respuesta(anulada(1, { observacionId: '' })), W, ID).ok).toBe(false);
  });
});

describe('modal de anulacion', () => {
  function armar(opc) {
    const o = opc || {};
    let n = 0;
    const sesion = { sessionToken: 'tok-real', permisos: o.permisos || MOD };
    const pendientes = [];
    const llamadas = [];
    const exitos = [];
    const transiciones = [];
    const cambios = [];
    const deps = {
      obtenerContexto: () => sesion,
      generarId: () => 'anu-' + String(++n).padStart(8, '0'),
      enviar: jest.fn((token, observacionId, motivo, clientRequestId) => {
        llamadas.push({ token, observacionId, motivo, clientRequestId });
        return new Promise((resolver, rechazar) => { pendientes.push({ resolver, rechazar }); });
      }),
      onCambio: (e) => cambios.push(e),
      onExito: jest.fn((v, duplicada, observacionId, wellId) => exitos.push({ v, duplicada, observacionId, wellId })),
      onTransicionInvalida: jest.fn((wellId) => transiciones.push(wellId)),
      onSesionExpirada: jest.fn()
    };
    const f = L.observacionesPozoLogic_crearAnulacion(deps);
    const responder = async (resp, i) => { pendientes[i === undefined ? pendientes.length - 1 : i].resolver(resp); await flush(); };
    const fallar = async (i) => { pendientes[i === undefined ? pendientes.length - 1 : i].rechazar(new Error('red caida')); await flush(); };
    return { f, deps, sesion, llamadas, exitos, transiciones, cambios, pendientes, responder, fallar };
  }
  const obj = (n, extra) => vista(obs(n, extra));

  describe('abrir', () => {
    test('moderador: abre con la observacion (solo quien y cuando, SIN su texto), motivo vacio, id nuevo y confirmar deshabilitado', () => {
      const t = armar();
      expect(t.f.abrir(W, obj(1, { texto: 'TEXTO-ORIGINAL-SECRETO' }))).toBe(true);
      const e = t.f.estado();
      expect(e).toMatchObject({ abierto: true, wellId: W, motivo: '', largo: 0, contador: '0 / 300', valido: false, puedeGuardar: false, enviando: false, error: null, clientRequestId: 'anu-00000001' });
      expect(e.objetivo).toEqual({ id: 'obs-1', nombre: 'Ana', fecha: '20/10/2026 12:00', puedeAnular: true });
      expect(JSON.stringify(e)).not.toContain('TEXTO-ORIGINAL-SECRETO');
    });

    test.each([
      ['con la senal del backend', AUTOR, obj(1, { puedeAnular: true }), true],
      ['sin la senal (el backend dijo que no)', AUTOR, obj(1, { puedeAnular: false }), false],
      ['moderador sin la senal', MOD, obj(1, { puedeAnular: false }), false],
      ['lector (el backend manda false)', { observaciones: true }, obj(1, { puedeAnular: false }), false],
      ['moderador sobre una anulada', MOD, vista(anulada(2)), false],
      ['senal truthy que no es el booleano', MOD, vista(obs(1, { puedeAnular: 'true' })), false],
      ['sin permisos', undefined, obj(1), false],
      ['sin vista', MOD, null, false]
    ])('%s -> abre=%s', (_n, permisos, v, abre) => {
      const t = armar();
      t.sesion.permisos = permisos;
      expect(t.f.abrir(W, v)).toBe(abre);
      expect(t.f.estado().abierto).toBe(abre);
    });

    test.each([[''], [undefined], [null], [5]])('pozo invalido (%j): no abre', (w) => {
      const t = armar();
      expect(t.f.abrir(w, obj(1))).toBe(false);
    });

    test('puedeGuardar: 2 -> no, 3 -> si, 300 -> si, 301 -> no', () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('ab');
      expect(t.f.estado().puedeGuardar).toBe(false);
      t.f.setMotivo('abc');
      expect(t.f.estado().puedeGuardar).toBe(true);
      t.f.setMotivo('a'.repeat(300));
      expect(t.f.estado()).toMatchObject({ puedeGuardar: true, excede: false, contador: '300 / 300' });
      t.f.setMotivo('a'.repeat(301));
      expect(t.f.estado()).toMatchObject({ puedeGuardar: false, excede: true, contador: '301 / 300 · te pasaste por 1' });
    });

    test('guardar con motivo invalido o con el permiso revocado despues de abrir: error local, ningun pedido', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('ab');
      let e = await t.f.guardar();
      expect(e.error).toEqual({ code: 'INVALID_MOTIVO', mensaje: 'El motivo debe tener entre 3 y 300 caracteres.', campo: 'motivo' });
      t.f.setMotivo('motivo valido');
      t.sesion.permisos = { observaciones: false };
      e = await t.f.guardar();
      expect(e.error.code).toBe('PERMISSION_DENIED');
      expect(t.deps.enviar).not.toHaveBeenCalled();
    });
  });

  describe('envio', () => {
    test('manda exactamente (token, observacionId, motivo NORMALIZADO, id) -ni pozo, ni autor, ni texto- y bloquea mientras anula', async () => {
      const t = armar();
      t.f.abrir(W, obj(7, { texto: 'TEXTO-ORIGINAL-SECRETO' }));
      t.f.setMotivo('  Cargada en el pozo\r\nequivocado\u0007  ');
      const p = t.f.guardar();
      expect(t.llamadas).toEqual([{ token: 'tok-real', observacionId: 'obs-7', motivo: 'Cargada en el pozo\nequivocado', clientRequestId: 'anu-00000001' }]);
      expect(JSON.stringify(t.llamadas)).not.toContain('TEXTO-ORIGINAL-SECRETO');
      expect(t.f.estado()).toMatchObject({ enviando: true, puedeGuardar: false });
      await t.responder(respuesta(anulada(7)));
      await p;
      expect(t.f.estado().abierto).toBe(false);
    });

    test('H. doble submit: UNA sola request', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo valido');
      const a = t.f.guardar();
      const b = t.f.guardar();
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      await t.responder(respuesta(anulada(1)));
      await Promise.all([a, b]);
      expect(t.exitos).toHaveLength(1);
    });

    test('cancelar mientras anula no cierra; despues del error si', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      expect(t.f.cancelar()).toBe(false);
      await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      expect(t.f.cancelar()).toBe(true);
      expect(t.f.estado().abierto).toBe(false);
    });
  });

  describe('clientRequestId: una intencion de anulacion', () => {
    test('A/B. abrir -> id1; editar el motivo antes del primer envio no lo cambia', () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      ['uno', 'uno dos', 'otro motivo'].forEach((x) => t.f.setMotivo(x));
      expect(t.f.estado().clientRequestId).toBe('anu-00000001');
      t.f.guardar();
      expect(t.llamadas[0].clientRequestId).toBe('anu-00000001');
      expect(t.llamadas[0].clientRequestId).toMatch(CRID);
    });

    test('C. error de red -> reintentar el MISMO motivo -> mismo id; motivo conservado', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      expect(t.f.estado()).toMatchObject({ abierto: true, motivo: 'motivo A', enviando: false, puedeGuardar: true });
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['anu-00000001', 'anu-00000001']);
    });

    test('C2. el reintento puede terminar con duplicada:true: es exito', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      t.f.guardar();
      await t.responder(respuesta(anulada(1), true));
      expect(t.exitos).toEqual([expect.objectContaining({ duplicada: true, observacionId: 'obs-1', wellId: W })]);
      expect(t.f.estado().abierto).toBe(false);
    });

    test('D. error de red -> cambia el motivo -> id NUEVO; D2 volver al anterior tras enviar el otro -> otro id; D3 sin enviar -> mismo; D4/D5 normalizado igual -> mismo', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      t.f.setMotivo('motivo B');
      t.f.setMotivo('motivo A');                                   // D3: cambia y vuelve sin enviar
      t.f.guardar();
      await t.fallar();
      t.f.setMotivo('  motivo A \r\n\u0007 ');                     // D4/D5: el backend lo normaliza igual
      t.f.guardar();
      await t.fallar();
      t.f.setMotivo('motivo B');                                   // D: otro motivo
      t.f.guardar();
      await t.fallar();
      t.f.setMotivo('motivo A');                                   // D2: ya se envio B
      t.f.guardar();
      expect(t.llamadas.map((l) => [l.motivo, l.clientRequestId])).toEqual([
        ['motivo A', 'anu-00000001'], ['motivo A', 'anu-00000001'], ['motivo A', 'anu-00000001'], ['motivo B', 'anu-00000002'], ['motivo A', 'anu-00000003']
      ]);
    });

    test('D5. el motivo se compara NORMALIZADO aunque lo escrito traiga espacios, CRLF o controles: reintentar el mismo motivo crudo conserva el id', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('  motivo A \r\n\u0007  ');
      t.f.guardar();
      await t.fallar();
      t.f.guardar();
      expect(t.llamadas.map((l) => [l.motivo, l.clientRequestId])).toEqual([['motivo A', 'anu-00000001'], ['motivo A', 'anu-00000001']]);
    });

    test('E. error definitivo antes de escribir: mientras el motivo no cambie se mantiene el id', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['anu-00000001', 'anu-00000001']);
    });

    test('F. cancelar y reabrir (la misma u OTRA observacion) -> formulario limpio e id nuevo', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      t.f.cancelar();
      expect(t.f.estado()).toMatchObject({ abierto: false, motivo: '', error: null, objetivo: null });
      t.f.abrir(W, obj(1));
      expect(t.f.estado()).toMatchObject({ abierto: true, motivo: '', error: null, clientRequestId: 'anu-00000002' });
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      t.f.abrir(W, obj(2));                                         // cambiar la observacion objetivo
      expect(t.f.estado().clientRequestId).toBe('anu-00000003');
      expect(t.f.estado().objetivo.id).toBe('obs-2');
      t.f.setMotivo('motivo A');
      t.f.guardar();
      expect(t.llamadas[t.llamadas.length - 1]).toMatchObject({ observacionId: 'obs-2', clientRequestId: 'anu-00000003' });
    });

    test('G. tras un exito, la proxima anulacion usa un id NUEVO (aunque sea el mismo motivo)', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.responder(respuesta(anulada(1)));
      t.f.abrir(W, obj(2));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['anu-00000001', 'anu-00000002']);
    });

    test.each([['IDEMPOTENCY_CONFLICT'], ['INVALID_CLIENT_REQUEST_ID']])('%s: no se reenvia solo; el id queda quemado y el SIGUIENTE envio (por accion del usuario) usa uno nuevo aunque el motivo sea el mismo', async (code) => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.responder({ status: 'error', code });
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      expect(t.f.estado().motivo).toBe('motivo A');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['anu-00000001', 'anu-00000002']);
    });
  });

  describe('respuesta y descarte de respuestas viejas', () => {
    test('exito: onExito con el modelo de la respuesta, el id de la observacion y el pozo; el modal se cierra y descarta todo', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      await t.responder(respuesta(anulada(5, { texto: 'visible' })));
      expect(t.exitos).toHaveLength(1);
      expect(t.exitos[0]).toMatchObject({ duplicada: false, observacionId: 'obs-5', wellId: W });
      expect(t.exitos[0].v).toMatchObject({ id: 'obs-5', estado: 'ANULADA', texto: 'visible' });
      expect(t.f.estado()).toMatchObject({ abierto: false, motivo: '', error: null, enviando: false, objetivo: null });
    });

    test('INVALID_TRANSITION: se cierra el modal, se avisa a la pantalla para refrescar y NO es un exito', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'INVALID_TRANSITION', message: 'x' });
      expect(t.transiciones).toEqual([W]);
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado().abierto).toBe(false);
    });

    test('una respuesta que llega DESPUES de cerrar (salir de la pantalla / logout / otro pozo) no se aplica', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      t.f.cerrar();
      await t.responder(respuesta(anulada(5)));
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado().abierto).toBe(false);
    });

    test('abrir el modal para OTRA observacion con el pedido en vuelo: la respuesta vieja no se aplica ni pisa el modal nuevo', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo viejo');
      t.f.guardar();
      t.f.abrir(W, obj(6));
      t.f.setMotivo('motivo nuevo');
      await t.responder(respuesta(anulada(5)), 0);
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado()).toMatchObject({ abierto: true, motivo: 'motivo nuevo', enviando: false });
      expect(t.f.estado().objetivo.id).toBe('obs-6');
    });

    test('un error o una transicion invalida tardios de un contexto viejo tampoco se aplican (ni cierran sesion ni refrescan)', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      t.f.cerrar();
      await t.responder({ status: 'error', code: 'UNAUTHORIZED' });
      expect(t.deps.onSesionExpirada).not.toHaveBeenCalled();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      t.f.cerrar();
      await t.responder({ status: 'error', code: 'INVALID_TRANSITION' });
      expect(t.transiciones).toEqual([]);
    });

    test('la respuesta de OTRO pozo, de otra observacion o mal formada no se aplica: error generico, motivo e id conservados', async () => {
      const t = armar();
      t.f.abrir(W, obj(5));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      await t.responder({ status: 'ok', data: { wellId: '14-0002', duplicada: false, observacion: anulada(5) } });
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado()).toMatchObject({ abierto: true, motivo: 'motivo valido' });
      expect(t.f.estado().error.mensaje).toBe(L.OBSERVACIONES_POZO_MENSAJE_ANULAR_GENERICO);
      t.f.guardar();
      await t.responder(respuesta(anulada(99)));
      expect(t.exitos).toHaveLength(0);
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['anu-00000001', 'anu-00000001', 'anu-00000001']);
    });
  });

  describe('errores: el motivo se conserva', () => {
    test.each([
      ['INVALID_MOTIVO', 'El motivo debe tener entre 3 y 300 caracteres.', 'motivo'],
      ['OBSERVACION_NOT_FOUND', 'La observación ya no está disponible.', null],
      ['PERMISSION_DENIED', 'No tenés permiso para anular esta observación.', null],
      ['IDEMPOTENCY_CONFLICT', 'La anulación cambió después de un intento anterior. Revisá el motivo e intentá nuevamente.', null],
      ['SERVICE_UNAVAILABLE', 'No se pudo anular la observación. Intentá nuevamente.', null],
      ['INCONSISTENT_STATE', 'No se pudo anular la observación. Intentá nuevamente.', null],
      ['CODIGO_RARO', 'No se pudo anular la observación. Intentá nuevamente.', null]
    ])('%s: mensaje de tabla (sin detalle tecnico), campo correcto, motivo conservado y modal abierto', async (code, mensaje, campo) => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('Motivo que no se pierde');
      t.f.guardar();
      await t.responder({ status: 'error', code, message: 'DETALLE-TECNICO-SECRETO' });
      const e = t.f.estado();
      expect(e.error).toEqual({ code, mensaje, campo });
      expect(JSON.stringify(e)).not.toContain('DETALLE-TECNICO-SECRETO');
      expect(e).toMatchObject({ abierto: true, motivo: 'Motivo que no se pierde', enviando: false, puedeGuardar: true });
      expect(t.deps.onSesionExpirada).not.toHaveBeenCalled();
    });

    test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: flujo global de sesion, una vez, sin reenvio', async (code) => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo valido');
      t.f.guardar();
      await t.responder({ status: 'error', code });
      expect(t.deps.onSesionExpirada).toHaveBeenCalledTimes(1);
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
    });

    test('error de red y fallo sincrono de enviar: motivo e id conservados, sin tocar nada mas', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.fallar();
      expect(t.f.estado()).toMatchObject({ motivo: 'motivo A', enviando: false, error: { code: 'RED' } });
      t.deps.enviar.mockImplementationOnce(() => { throw new Error('boom'); });
      await t.f.guardar();
      expect(t.f.estado()).toMatchObject({ motivo: 'motivo A', enviando: false, error: { code: 'RED' } });
      expect(t.f.estado().clientRequestId).toBe('anu-00000001');
      expect(t.exitos).toHaveLength(0);
    });

    test('editar despues de un error borra el aviso', async () => {
      const t = armar();
      t.f.abrir(W, obj(1));
      t.f.setMotivo('motivo A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'INVALID_MOTIVO' });
      t.f.setMotivo('motivo A mejorado');
      expect(t.f.estado().error).toBeNull();
    });
  });

  test('nada de lo que pasa por el modal toca console', async () => {
    const espiar = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const t = armar();
    t.f.abrir(W, obj(1, { texto: 'TEXTO-SECRETO-1' }));
    t.f.setMotivo('MOTIVO-SECRETO-2');
    t.f.guardar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    espiar.forEach((e) => expect(e).not.toHaveBeenCalled());
    espiar.forEach((e) => e.mockRestore());
  });
});

describe('reemplazarObservacion: la anulada REEMPLAZA a su entrada (sin merge)', () => {
  function armarLista() {
    const llamadas = [];
    const pendientes = [];
    const sesion = { sessionToken: 'tok', permisos: { observaciones: true } };
    const c = L.observacionesPozoLogic_crearCargador({
      obtenerContexto: () => sesion,
      consultar: (t, w, limit, antes) => { llamadas.push({ antes }); return new Promise((res) => { pendientes.push(res); }); },
      onCambio: () => {}
    });
    const responder = async (resp, i) => { pendientes[i === undefined ? pendientes.length - 1 : i](resp); await flush(); };
    return { c, llamadas, responder };
  }

  test('reemplaza EN SITIO (mismo indice, misma cantidad), sin tocar las demas ni el total ni el cursor ni hayMas', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4), obs(3)], { total: 6, hayMas: true, cursor: 3 }));
    const antes = t.c.estado().items.slice();
    expect(t.c.reemplazarObservacion(vista(anulada(4)), W)).toBe(true);
    const e = t.c.estado();
    expect(e.items.map((i) => [i.id, i.estado])).toEqual([['obs-5', 'ACTIVA'], ['obs-4', 'ANULADA'], ['obs-3', 'ACTIVA']]);
    expect(e.items[0]).toBe(antes[0]);
    expect(e.items[2]).toBe(antes[2]);
    expect(e).toMatchObject({ total: 6, hayMas: true, cursor: 3, fase: 'listo' });
  });

  test('PRIVACIDAD: si el backend devuelve texto null, el texto original desaparece del estado (ningun resto en ninguna parte)', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5, { texto: 'TEXTO-ORIGINAL-PRIVADO' }), obs(4)]));
    expect(JSON.stringify(t.c.estado())).toContain('TEXTO-ORIGINAL-PRIVADO');
    t.c.reemplazarObservacion(vista(anulada(5)), W);
    expect(t.c.estado().items[0].texto).toBeNull();
    expect(JSON.stringify(t.c.estado())).not.toContain('TEXTO-ORIGINAL-PRIVADO');
  });

  test('NO es un merge: nada del modelo viejo sobrevive (ni el texto ni la senal puedeAnular ni la categoria)', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5, { texto: 'viejo', puedeAnular: true, categoria: 'Acceso' })]));
    expect(t.c.estado().items[0]).toMatchObject({ texto: 'viejo', puedeAnular: true, categoria: 'Acceso' });
    t.c.reemplazarObservacion(vista(anulada(5)), W);
    expect(t.c.estado().items[0]).toEqual(vista(anulada(5)));
    expect(t.c.estado().items[0]).toMatchObject({ texto: null, puedeAnular: false, categoria: null });
  });

  test('si el backend si manda el texto (moderacion) se usa ESE texto, y si manda otro distinto se usa el del backend (nunca el cargado antes)', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5, { texto: 'cargado antes' })]));
    t.c.reemplazarObservacion(vista(anulada(5, { texto: 'lo que manda el backend' })), W);
    expect(t.c.estado().items[0].texto).toBe('lo que manda el backend');
  });

  test('no inserta una segunda tarjeta: si la entrada no esta cargada, es un no-op; tampoco con la lista no lista o de otro pozo', async () => {
    const t = armarLista();
    expect(t.c.reemplazarObservacion(vista(anulada(5)), W)).toBe(false);          // idle
    t.c.abrir(W);
    expect(t.c.reemplazarObservacion(vista(anulada(5)), W)).toBe(false);          // cargando
    await t.responder(pagina([obs(4)]));
    expect(t.c.reemplazarObservacion(vista(anulada(5)), W)).toBe(false);          // no esta en la lista
    expect(t.c.reemplazarObservacion(vista(anulada(4)), '14-0002')).toBe(false);
    expect(t.c.reemplazarObservacion(null, W)).toBe(false);
    expect(t.c.estado().items.map((i) => i.estado)).toEqual(['ACTIVA']);
  });

  test('la paginacion sigue intacta: despues de anular una cargada, "anteriores" usa el cursor del backend y suma al final sin duplicar', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 }));
    t.c.reemplazarObservacion(vista(anulada(5)), W);
    t.c.cargarMas();
    expect(t.llamadas[1].antes).toBe(4);
    await t.responder(pagina([obs(3), obs(2)], { total: 4, hayMas: false }));
    expect(t.c.estado().items.map((i) => [i.id, i.estado])).toEqual([['obs-5', 'ANULADA'], ['obs-4', 'ACTIVA'], ['obs-3', 'ACTIVA'], ['obs-2', 'ACTIVA']]);
  });

  test('convive con el alta: agregarNueva sigue arriba y reemplazar actua sobre la entrada correcta', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)]));
    t.c.agregarNueva(vista(obs(9)), W);
    t.c.reemplazarObservacion(vista(anulada(4)), W);
    expect(t.c.estado().items.map((i) => [i.id, i.estado])).toEqual([['obs-9', 'ACTIVA'], ['obs-5', 'ACTIVA'], ['obs-4', 'ANULADA']]);
  });
});
