// Alta de observaciones en el frontend (E5-5): permiso exacto, normalizacion del texto (con un test de PARIDAD contra el backend), contador por code points, clientRequestId por intencion
// (A-H), respuestas / errores, descarte de respuestas viejas, y la insercion arriba de la lista ya cargada (agregarNueva). El DOM esta en observacionesPozoAltaController.test.js.
global.reemplazoLogic_formatearFecha = require('./reemplazoLogic').reemplazoLogic_formatearFecha;
const L = require('./observacionesPozoLogic');
const backend = require('../backend/src/ObservacionesPozoService');

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null }, extra || {});
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });
const alta = (o, duplicada) => ({ status: 'ok', data: { wellId: W, duplicada: duplicada === true, observacion: o } });
const CRID = /^[A-Za-z0-9_-]{8,64}$/;

describe('permiso del boton: AMBOS permisos con el booleano exacto', () => {
  test.each([
    [{ observaciones: true, observaciones_agregar: true }, true],
    [{ observaciones: true, observaciones_agregar: false }, false],
    [{ observaciones: false, observaciones_agregar: true }, false],
    [{ observaciones: true }, false],
    [{ observaciones_agregar: true }, false],
    [{}, false],
    [undefined, false],
    [null, false],
    [{ observaciones: 'SI', observaciones_agregar: 'SI' }, false],
    [{ observaciones: 1, observaciones_agregar: 1 }, false],
    [{ observaciones: true, observaciones_agregar: 1 }, false],
    [{ observaciones: true, observaciones_agregar: 'SI' }, false],
    [{ observaciones: true, observaciones_agregar: 'true' }, false],
    [{ observaciones: 'true', observaciones_agregar: true }, false],
    [{ observaciones: true, observaciones_agregar: {} }, false],
    [{ observaciones: true, observaciones_anular: true }, false],
    [{ observaciones: true, observaciones_agregar: [] }, false]
  ])('%j -> %s', (permisos, esperado) => {
    expect(L.observacionesPozoLogic_puedeAgregar(permisos)).toBe(esperado);
  });
});

describe('normalizacion del texto: la misma regla que el backend', () => {
  test('reglas basicas', () => {
    const n = L.observacionesPozoLogic_normalizarTexto;
    expect(n('  hola  ')).toBe('hola');
    expect(n('a\r\nb\rc\u0085d\u2028e\u2029f')).toBe('a\nb\nc\nd\ne\nf');
    expect(n('a\tb')).toBe('a b');
    expect(n('a\u0000b\u0007c\u007fd\u0090e\u202Af\u202Eg\u2066h\u2069i\uFEFFj')).toBe('abcdefghij');
    expect(n('a   b\n\n\nc')).toBe('a   b\n\n\nc');                          // no se colapsan espacios ni lineas en blanco
    expect(n('é \u{1F468}‍\u{1F469} ‎')).toBe('é \u{1F468}‍\u{1F469} ‎');   // ZWJ, marcas RTL y acentos combinados se conservan
    expect(n('x\uD800y')).toBe('xy');
    expect(n('x\uDC00y')).toBe('xy');
    expect(n('x\u{1F600}y')).toBe('x\u{1F600}y');
  });

  test.each([[undefined], [null], [5], [{}], [[]], [true]])('un valor que no es string (%j) -> vacio', (v) => {
    expect(L.observacionesPozoLogic_normalizarTexto(v)).toBe('');
  });

  test('PARIDAD con el backend: 6000 cadenas con los caracteres problematicos dan el mismo texto normalizado y el mismo largo', () => {
    const alfabeto = ['a', 'B', ' ', ' ', '\t', '\n', '\r', '\r\n', '\u0085', '\u2028', '\u2029', '\u0000', '\u0007', '\u000B', '\u000C', '\u001F', '\u007F', '\u0084', '\u0086', '\u009F', '\u202A', '\u202E', '\u2066', '\u2069', '\uFEFF', '‍', '‌', '‎', '‏', '\uD800', '\uDBFF', '\uDC00', '\uDFFF', 'é', 'é', '\u{1F600}', '\u{1F468}', 'ñ', '<', '&', '"'];
    let semilla = 12345;
    const azar = () => { semilla = (semilla * 1103515245 + 12345) & 0x7fffffff; return semilla / 0x7fffffff; };
    for (let i = 0; i < 6000; i += 1) {
      const largo = Math.floor(azar() * 14);
      let s = '';
      for (let j = 0; j < largo; j += 1) { s += alfabeto[Math.floor(azar() * alfabeto.length)]; }
      const esperado = backend.observacionesPozoService_normalizarTexto(s);
      const obtenido = L.observacionesPozoLogic_normalizarTexto(s);
      if (obtenido !== esperado) { throw new Error('difiere para ' + JSON.stringify(s) + ': backend ' + JSON.stringify(esperado) + ' / frontend ' + JSON.stringify(obtenido)); }
      expect(L.observacionesPozoLogic_largoTexto(obtenido)).toBe(backend.observacionesPozoService_largoTexto(esperado));
    }
  });

  test('los limites son los del backend', () => {
    expect(L.OBSERVACIONES_POZO_TEXTO_MIN).toBe(backend.OBSERVACIONES_POZO_TEXTO_MIN);
    expect(L.OBSERVACIONES_POZO_TEXTO_MAX).toBe(backend.OBSERVACIONES_POZO_TEXTO_MAX);
  });

  test('el regex de clientRequestId es el del backend', () => {
    expect(String(CRID)).toBe(String(backend.OBSERVACIONES_POZO_CLIENT_REQUEST_ID_REGEX));
  });
});

describe('validacion y contador (code points)', () => {
  const v = L.observacionesPozoLogic_validarTexto;

  test.each([
    ['', false, 'VACIO', 0], ['   \n  ', false, 'VACIO', 0], ['\u0007\u0000', false, 'VACIO', 0],
    ['ab', false, 'CORTO', 2], ['abc', true, null, 3], ['  abc  ', true, null, 3],
    ['a'.repeat(1000), true, null, 1000], ['a'.repeat(1001), false, 'LARGO', 1001]
  ])('%j -> valido=%s (%s, largo %i)', (texto, valido, motivo, largo) => {
    expect(v(texto)).toMatchObject({ valido, motivo, largo });
  });

  test('los emoji cuentan 1: 1000 emoji entran (2000 unidades UTF-16), 1001 no; 2 emoji no alcanzan y 3 si', () => {
    expect(v('\u{1F600}'.repeat(1000)).valido).toBe(true);
    expect(v('\u{1F600}'.repeat(1000)).largo).toBe(1000);
    expect('\u{1F600}'.repeat(1000).length).toBe(2000);                        // .length contaria 2000
    expect(v('\u{1F600}'.repeat(1001)).valido).toBe(false);
    expect(v('\u{1F600}\u{1F600}').motivo).toBe('CORTO');
    expect(v('\u{1F600}'.repeat(3)).valido).toBe(true);
    expect(v('\u{1F468}‍\u{1F469}‍\u{1F467}').largo).toBe(5);        // una familia compuesta son 5 code points (igual que el backend)
  });

  test('el largo se mide DESPUES de normalizar: espacios de los extremos, controles y CRLF', () => {
    expect(v('  ab  ').largo).toBe(2);
    expect(v('a\u0007b\u0000c').largo).toBe(3);
    expect(v('a\r\nb').largo).toBe(3);                                         // CRLF = 1 salto
  });

  test('acentos, saltos de linea y HTML son validos y se conservan', () => {
    expect(v('Caño de 4" instalado\n<b>nuevo</b> & listo').valido).toBe(true);
    expect(v('<script>alert(1)</script>').texto).toBe('<script>alert(1)</script>');
  });

  test('el contador muestra n / 1000 y, si se pasa, lo dice con palabras (no solo con color)', () => {
    expect(L.observacionesPozoLogic_textoContador(0)).toBe('0 / 1000');
    expect(L.observacionesPozoLogic_textoContador(1000)).toBe('1000 / 1000');
    expect(L.observacionesPozoLogic_textoContador(1003)).toBe('1003 / 1000 · te pasaste por 3');
  });
});

describe('clientRequestId', () => {
  test('el generador cumple el regex del backend (con crypto.randomUUID, sin el y con azar fijo)', () => {
    expect(L.observacionesPozoLogic_nuevoClientRequestId()).toMatch(CRID);
    const ids = new Set();
    for (let i = 0; i < 200; i += 1) { ids.add(L.observacionesPozoLogic_nuevoClientRequestId()); }
    expect(ids.size).toBe(200);
    expect(L.observacionesPozoLogic_nuevoClientRequestId(() => 0.5)).toMatch(CRID);
    expect(L.observacionesPozoLogic_nuevoClientRequestId(() => 0)).toMatch(CRID);
    expect(L.observacionesPozoLogic_nuevoClientRequestId(() => 0.999999)).toMatch(CRID);
  });

  test('sin crypto.randomUUID usa el respaldo y sigue siendo valido', () => {
    const original = global.crypto;
    Object.defineProperty(global, 'crypto', { value: undefined, configurable: true });
    try {
      const id = L.observacionesPozoLogic_nuevoClientRequestId();
      expect(id).toMatch(CRID);
      expect(id.startsWith('obs-')).toBe(true);
    } finally {
      Object.defineProperty(global, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('mensajes de error del alta', () => {
  test('los de la especificacion, y el resto generico; nunca el message tecnico', () => {
    const m = L.observacionesPozoLogic_mensajeErrorAlta;
    expect(m('INVALID_TEXTO')).toBe('La observación debe tener entre 3 y 1000 caracteres.');
    expect(m('WELL_NOT_FOUND')).toBe('No se pudo confirmar que este pozo exista en las fuentes disponibles.');
    expect(m('SERVICE_UNAVAILABLE')).toBe('No se pudo guardar la observación. Intentá nuevamente.');
    expect(m('IDEMPOTENCY_CONFLICT')).toBe('La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.');
    expect(m('PERMISSION_DENIED')).toMatch(/permiso/);
    expect(m('UNAUTHORIZED')).toMatch(/sesión venció/);
    expect(m('USER_DISABLED')).toMatch(/acceso habilitado/);
    ['INVALID_CATEGORIA', 'INVALID_CLIENT_REQUEST_ID', 'INCONSISTENT_STATE', 'RED', 'LO_QUE_SEA', undefined, null, '__proto__', 'constructor'].forEach((c) => {
      expect(m(c)).toBe(L.OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO);
    });
  });
});

describe('leerRespuestaAlta', () => {
  test('exito con duplicada false y true (ambos son exito); la vista pasa por la lista blanca', () => {
    const a = L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1, { email: 'ana@x.com', clientRequestId: 'x-12345678', secuencia: 9 })), W);
    expect(a).toMatchObject({ ok: true, duplicada: false });
    expect(JSON.stringify(a)).not.toMatch(/ana@x\.com|x-12345678|secuencia/);
    expect(L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1), true), W)).toMatchObject({ ok: true, duplicada: true });
    expect(L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1), 'true'), W).duplicada).toBe(false);
  });

  test('errores del backend: su codigo; sin codigo -> SERVICE_UNAVAILABLE', () => {
    expect(L.observacionesPozoLogic_leerRespuestaAlta({ status: 'error', code: 'WELL_NOT_FOUND', message: 'x' }, W)).toEqual({ ok: false, code: 'WELL_NOT_FOUND' });
    expect(L.observacionesPozoLogic_leerRespuestaAlta({ status: 'error' }, W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test.each([
    [null], [undefined], [5], ['ok'], [{}], [{ status: 'ok' }], [{ status: 'ok', data: null }], [{ status: 'ok', data: {} }],
    [{ status: 'ok', data: { wellId: W } }], [{ status: 'ok', data: { wellId: W, observacion: null } }], [{ status: 'ok', data: { wellId: W, observacion: 'x' } }]
  ])('respuesta mal formada %j -> SERVICE_UNAVAILABLE (no se aplica)', (resp) => {
    expect(L.observacionesPozoLogic_leerRespuestaAlta(resp, W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test('de otro pozo, o con una observacion que no es ACTIVA mostrable: no se aplica', () => {
    expect(L.observacionesPozoLogic_leerRespuestaAlta({ status: 'ok', data: { wellId: '14-0002', duplicada: false, observacion: obs(1) } }, W).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1, { estado: 'ANULADA', texto: null, anulacion: {} })), W).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1, { texto: '' })), W).ok).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuestaAlta(alta(obs(1, { observacionId: '' })), W).ok).toBe(false);
  });
});

describe('siguienteFoco (rotacion de Tab en el modal)', () => {
  test.each([
    [4, 0, false, 1], [4, 3, false, 0], [4, 0, true, 3], [4, 2, true, 1], [4, -1, false, 0], [4, -1, true, 3], [4, 9, false, 0], [0, 0, false, -1], [1, 0, false, 0], [1, 0, true, 0]
  ])('cantidad %i, actual %i, atras=%s -> %i', (n, actual, atras, esperado) => {
    expect(L.observacionesPozoLogic_siguienteFoco(n, actual, atras)).toBe(esperado);
  });
});

describe('formulario de alta', () => {
  function armar(opc) {
    const o = opc || {};
    let n = 0;
    const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { observaciones: true, observaciones_agregar: true } };
    const pendientes = [];
    const llamadas = [];
    const exitos = [];
    const cambios = [];
    const deps = {
      obtenerContexto: () => sesion,
      generarId: () => 'id-' + String(++n).padStart(8, '0'),
      enviar: jest.fn((token, wellId, texto, clientRequestId) => {
        llamadas.push({ token, wellId, texto, clientRequestId });
        return new Promise((resolver, rechazar) => { pendientes.push({ resolver, rechazar }); });
      }),
      onCambio: (e) => cambios.push(e),
      onExito: jest.fn((vista, duplicada, wellId) => exitos.push({ vista, duplicada, wellId })),
      onSesionExpirada: jest.fn()
    };
    const f = L.observacionesPozoLogic_crearFormulario(deps);
    const responder = async (resp, i) => { pendientes[i === undefined ? pendientes.length - 1 : i].resolver(resp); await flush(); };
    const fallar = async (i) => { pendientes[i === undefined ? pendientes.length - 1 : i].rechazar(new Error('red caida')); await flush(); };
    return { f, deps, sesion, llamadas, exitos, cambios, pendientes, responder, fallar };
  }

  describe('abrir y estado', () => {
    test('abre con permisos, texto vacio, id nuevo y Guardar deshabilitado', () => {
      const t = armar();
      expect(t.f.abrir(W)).toBe(true);
      expect(t.f.estado()).toMatchObject({ abierto: true, wellId: W, texto: '', largo: 0, contador: '0 / 1000', valido: false, puedeGuardar: false, enviando: false, error: null, clientRequestId: 'id-00000001' });
    });

    test.each([[{ observaciones: true }], [{ observaciones_agregar: true }], [{ observaciones: 'SI', observaciones_agregar: 'SI' }], [undefined], [{}]])('sin ambos permisos exactos (%j): no abre', (permisos) => {
      const t = armar();
      t.sesion.permisos = permisos;
      expect(t.f.abrir(W)).toBe(false);
      expect(t.f.estado().abierto).toBe(false);
    });

    test.each([[''], [undefined], [null], [5]])('pozo invalido (%j): no abre', (w) => {
      const t = armar();
      expect(t.f.abrir(w)).toBe(false);
    });

    test('puedeGuardar: 2 -> no, 3 -> si, 1000 -> si, 1001 -> no (contador y exceso)', () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('ab');
      expect(t.f.estado().puedeGuardar).toBe(false);
      t.f.setTexto('abc');
      expect(t.f.estado().puedeGuardar).toBe(true);
      t.f.setTexto('a'.repeat(1000));
      expect(t.f.estado()).toMatchObject({ puedeGuardar: true, excede: false, contador: '1000 / 1000' });
      t.f.setTexto('a'.repeat(1001));
      expect(t.f.estado()).toMatchObject({ puedeGuardar: false, excede: true, contador: '1001 / 1000 · te pasaste por 1' });
    });

    test('setTexto con un valor que no es string -> vacio; con el formulario cerrado no hace nada', () => {
      const t = armar();
      t.f.setTexto('hola');
      expect(t.f.estado().texto).toBe('');
      t.f.abrir(W);
      t.f.setTexto(null);
      expect(t.f.estado().texto).toBe('');
    });

    test('guardar con texto invalido no hace ningun pedido y marca el error junto al campo', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('ab');
      const e = await t.f.guardar();
      expect(t.deps.enviar).not.toHaveBeenCalled();
      expect(e.error).toEqual({ code: 'INVALID_TEXTO', mensaje: 'La observación debe tener entre 3 y 1000 caracteres.', campo: 'texto' });
    });

    test('guardar con el permiso revocado despues de abrir: PERMISSION_DENIED local, sin pedido', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto valido');
      t.sesion.permisos = { observaciones: true, observaciones_agregar: false };
      const e = await t.f.guardar();
      expect(t.deps.enviar).not.toHaveBeenCalled();
      expect(e.error.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('envio', () => {
    test('manda exactamente (token de sesion, pozo del formulario, texto NORMALIZADO, clientRequestId) y Guardar queda deshabilitado mientras se guarda', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('  Se observa\r\nbomba\u0007 nueva  ');
      const p = t.f.guardar();
      expect(t.llamadas).toEqual([{ token: 'tok-real', wellId: W, texto: 'Se observa\nbomba nueva', clientRequestId: 'id-00000001' }]);
      expect(t.f.estado()).toMatchObject({ enviando: true, puedeGuardar: false });
      await t.responder(alta(obs(1, { texto: 'Se observa\nbomba nueva' })));
      await p;
      expect(t.f.estado().abierto).toBe(false);
    });

    test('el texto enviado es el normalizado y vuelve a normalizarse igual en el backend (idempotente)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('\t  a\u2028b\uFEFF  \n');
      t.f.guardar();
      const enviado = t.llamadas[0].texto;
      expect(enviado).toBe('a\nb');
      expect(backend.observacionesPozoService_normalizarTexto(enviado)).toBe(enviado);
    });

    test('H. doble click / doble submit: UNA sola request', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto valido');
      const a = t.f.guardar();
      const b = t.f.guardar();
      const c = t.f.guardar();
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      await t.responder(alta(obs(1)));
      await Promise.all([a, b, c]);
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      expect(t.exitos).toHaveLength(1);
    });

    test('cancelar mientras se guarda no cierra (la respuesta todavia hay que aplicarla); despues del error si', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto valido');
      t.f.guardar();
      expect(t.f.cancelar()).toBe(false);
      expect(t.f.estado().abierto).toBe(true);
      await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      expect(t.f.cancelar()).toBe(true);
      expect(t.f.estado().abierto).toBe(false);
    });
  });

  describe('clientRequestId: una intencion de alta', () => {
    test('A. abrir un formulario -> id1', () => {
      const t = armar();
      t.f.abrir(W);
      expect(t.f.estado().clientRequestId).toBe('id-00000001');
      expect(t.f.estado().clientRequestId).toMatch(CRID);
    });

    test('B. editar ANTES del primer envio no cambia el id (se usa el id1 en el envio)', async () => {
      const t = armar();
      t.f.abrir(W);
      ['uno', 'uno dos', 'otra cosa', 'texto final'].forEach((x) => t.f.setTexto(x));
      expect(t.f.estado().clientRequestId).toBe('id-00000001');
      t.f.guardar();
      expect(t.llamadas[0].clientRequestId).toBe('id-00000001');
    });

    test('C. error de red -> reintentar el MISMO texto -> mismo id; el texto se conserva', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      expect(t.f.estado()).toMatchObject({ abierto: true, texto: 'texto A', enviando: false, puedeGuardar: true });
      expect(t.f.estado().error).toMatchObject({ code: 'RED' });
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000001']);
      expect(t.llamadas.map((l) => l.texto)).toEqual(['texto A', 'texto A']);
    });

    test('C2. un retry puede terminar siendo duplicada:true (la primera vez si llego a escribir): es exito y no hay segunda observacion', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      t.f.guardar();
      await t.responder(alta(obs(7, { texto: 'texto A' }), true));
      expect(t.exitos).toHaveLength(1);
      expect(t.exitos[0]).toMatchObject({ duplicada: true, wellId: W });
      expect(t.f.estado().abierto).toBe(false);
    });

    test('D. error de red -> CAMBIA el texto -> id NUEVO (no se reutiliza el id del texto anterior)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      t.f.setTexto('texto B');
      t.f.guardar();
      expect(t.llamadas.map((l) => [l.texto, l.clientRequestId])).toEqual([['texto A', 'id-00000001'], ['texto B', 'id-00000002']]);
    });

    test('D2. cambia y vuelve al texto A tras haber enviado B: ya no es la intencion original -> otro id', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      t.f.setTexto('texto B');
      t.f.guardar();
      await t.fallar();
      t.f.setTexto('texto A');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000002', 'id-00000003']);
    });

    test('D3. cambiar y volver al texto A SIN enviar B: sigue siendo la intencion A -> mismo id', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      t.f.setTexto('texto B');
      t.f.setTexto('texto A');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000001']);
    });

    test('D4. cambios que el backend normaliza igual (espacios de los extremos, CRLF) NO son otra intencion: mismo id', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('linea uno\nlinea dos');
      t.f.guardar();
      await t.fallar();
      t.f.setTexto('  linea uno\r\nlinea dos   ');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000001']);
    });

    test('D5. el texto se compara NORMALIZADO aunque lo escrito traiga espacios, CRLF o controles: reintentar el mismo texto crudo conserva el id', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('  texto A \r\n\u0007  ');
      t.f.guardar();
      await t.fallar();
      t.f.guardar();
      expect(t.llamadas.map((l) => [l.texto, l.clientRequestId])).toEqual([['texto A', 'id-00000001'], ['texto A', 'id-00000001']]);
    });

    test('E. error DEFINITIVO del backend (antes de escribir): mientras el texto no cambie se mantiene el id; si cambia, id nuevo', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'WELL_NOT_FOUND', message: 'x' });
      expect(t.f.estado().error.code).toBe('WELL_NOT_FOUND');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      t.f.setTexto('texto A corregido');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000001', 'id-00000002']);
    });

    test('F. cancelar y volver a abrir -> formulario limpio e id nuevo', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      t.f.cancelar();
      expect(t.f.estado()).toMatchObject({ abierto: false, texto: '', error: null });
      t.f.abrir(W);
      expect(t.f.estado()).toMatchObject({ abierto: true, texto: '', error: null, clientRequestId: 'id-00000002' });
      t.f.setTexto('texto A');
      t.f.guardar();
      expect(t.llamadas[1].clientRequestId).toBe('id-00000002');
    });

    test('G. tras un exito el formulario se cierra y la proxima alta usa un id NUEVO', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder(alta(obs(1, { texto: 'texto A' })));
      expect(t.f.estado()).toMatchObject({ abierto: false, texto: '' });
      t.f.abrir(W);
      t.f.setTexto('texto A');                                   // aunque sea el mismo texto: es otra alta
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000002']);
    });

    test('IDEMPOTENCY_CONFLICT: no se reenvia solo; el id queda quemado y el SIGUIENTE envio (por accion del usuario) usa uno nuevo aunque el texto sea el mismo', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'IDEMPOTENCY_CONFLICT', message: 'x' });
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      expect(t.f.estado().error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT', mensaje: 'La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.' });
      expect(t.f.estado().texto).toBe('texto A');
      t.f.guardar();
      expect(t.llamadas.map((l) => l.clientRequestId)).toEqual(['id-00000001', 'id-00000002']);
      await t.responder(alta(obs(1, { texto: 'texto A' })));
      expect(t.exitos).toHaveLength(1);
    });

    test('INVALID_CLIENT_REQUEST_ID (rechazado antes de escribir): error controlado, sin bucle; el siguiente envio del usuario usa un id nuevo', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'INVALID_CLIENT_REQUEST_ID', message: 'x' });
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
      expect(t.f.estado().error.mensaje).toBe(L.OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO);
      t.f.guardar();
      expect(t.llamadas[1].clientRequestId).toBe('id-00000002');
    });

    test('los ids que se generan cumplen siempre el regex (con el generador real)', async () => {
      const t = armar();
      delete t.deps.generarId;
      const f = L.observacionesPozoLogic_crearFormulario(t.deps);
      f.abrir(W);
      f.setTexto('texto A');
      f.guardar();
      f.setTexto('texto B');
      expect(t.llamadas[0].clientRequestId).toMatch(CRID);
    });
  });

  describe('respuesta y descarte de respuestas viejas', () => {
    test('exito (duplicada false): se aplica a la lista una vez, el formulario se cierra y se descarta el texto', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('Bomba nueva');
      t.f.guardar();
      await t.responder(alta(obs(5, { texto: 'Bomba nueva' })));
      expect(t.exitos).toHaveLength(1);
      expect(t.exitos[0]).toMatchObject({ duplicada: false, wellId: W });
      expect(t.exitos[0].vista).toMatchObject({ id: 'obs-5', estado: 'ACTIVA', texto: 'Bomba nueva' });
      expect(t.f.estado()).toMatchObject({ abierto: false, texto: '', error: null, enviando: false });
    });

    test('una respuesta que llega DESPUES de cerrar (salir de la pantalla / logout / otro pozo) no se aplica a nada', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('Bomba nueva');
      t.f.guardar();
      t.f.cerrar();
      await t.responder(alta(obs(5)));
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado().abierto).toBe(false);
    });

    test('una respuesta vieja tampoco pisa un formulario NUEVO abierto despues (otra apertura)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('viejo texto');
      t.f.guardar();
      t.f.cerrar();
      t.f.abrir('14-0002');
      t.f.setTexto('texto nuevo');
      await t.responder(alta(obs(5)), 0);
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado()).toMatchObject({ abierto: true, wellId: '14-0002', texto: 'texto nuevo', enviando: false });
    });

    test('un ERROR que llega despues de cerrar tampoco se aplica (ni avisa de sesion vencida)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto valido');
      t.f.guardar();
      t.f.cerrar();
      await t.responder({ status: 'error', code: 'UNAUTHORIZED' });
      expect(t.deps.onSesionExpirada).not.toHaveBeenCalled();
    });

    test('la respuesta de OTRO pozo, o mal formada, no se aplica: error generico, texto e id conservados (el retry es idempotente)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder({ status: 'ok', data: { wellId: '14-0002', duplicada: false, observacion: obs(1) } });
      expect(t.exitos).toHaveLength(0);
      expect(t.f.estado()).toMatchObject({ abierto: true, texto: 'texto A' });
      expect(t.f.estado().error.mensaje).toBe(L.OBSERVACIONES_POZO_MENSAJE_ALTA_GENERICO);
      t.f.guardar();
      expect(t.llamadas[1].clientRequestId).toBe('id-00000001');
    });
  });

  describe('errores', () => {
    test.each([
      ['INVALID_TEXTO', 'La observación debe tener entre 3 y 1000 caracteres.', 'texto'],
      ['INVALID_CATEGORIA', 'No se pudo guardar la observación. Intentá nuevamente.', null],
      ['WELL_NOT_FOUND', 'No se pudo confirmar que este pozo exista en las fuentes disponibles.', null],
      ['SERVICE_UNAVAILABLE', 'No se pudo guardar la observación. Intentá nuevamente.', null],
      ['IDEMPOTENCY_CONFLICT', 'La observación cambió después de un intento anterior. Revisá el texto e intentá nuevamente.', null],
      ['PERMISSION_DENIED', 'No tenés permiso para agregar observaciones.', null],
      ['INCONSISTENT_STATE', 'No se pudo guardar la observación. Intentá nuevamente.', null],
      ['CODIGO_RARO', 'No se pudo guardar la observación. Intentá nuevamente.', null]
    ])('%s: mensaje de tabla (nunca el detalle tecnico), campo correcto y el texto se conserva', async (code, mensaje, campo) => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('Texto que NO debe perderse');
      t.f.guardar();
      await t.responder({ status: 'error', code, message: 'DETALLE-TECNICO-SECRETO' });
      const e = t.f.estado();
      expect(e.error).toEqual({ code, mensaje, campo });
      expect(JSON.stringify(e)).not.toContain('DETALLE-TECNICO-SECRETO');
      expect(e).toMatchObject({ abierto: true, texto: 'Texto que NO debe perderse', enviando: false, puedeGuardar: true });
      expect(t.deps.onSesionExpirada).not.toHaveBeenCalled();
    });

    test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: avisa a la app (flujo global de sesion) y no se reenvia', async (code) => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto valido');
      t.f.guardar();
      await t.responder({ status: 'error', code });
      expect(t.deps.onSesionExpirada).toHaveBeenCalledTimes(1);
      expect(t.deps.enviar).toHaveBeenCalledTimes(1);
    });

    test('error de red (promesa rechazada) y fallo sincrono de enviar: error controlado, texto e id conservados', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.fallar();
      expect(t.f.estado()).toMatchObject({ texto: 'texto A', enviando: false, error: { code: 'RED' } });
      t.deps.enviar.mockImplementationOnce(() => { throw new Error('boom'); });
      await t.f.guardar();
      expect(t.f.estado()).toMatchObject({ texto: 'texto A', enviando: false, error: { code: 'RED' } });
      expect(t.f.estado().clientRequestId).toBe('id-00000001');
    });

    test('editar despues de un error borra el aviso (y se vuelve a validar)', async () => {
      const t = armar();
      t.f.abrir(W);
      t.f.setTexto('texto A');
      t.f.guardar();
      await t.responder({ status: 'error', code: 'INVALID_TEXTO' });
      expect(t.f.estado().error).not.toBeNull();
      t.f.setTexto('texto A mejorado');
      expect(t.f.estado().error).toBeNull();
    });
  });

  test('nada de lo que pasa por el formulario toca console', async () => {
    const espiar = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const t = armar();
    t.f.abrir(W);
    t.f.setTexto('SECRETO-ALTA-1234');
    t.f.guardar();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    t.f.guardar();
    await t.fallar();
    espiar.forEach((e) => expect(e).not.toHaveBeenCalled());
    espiar.forEach((e) => e.mockRestore());
  });
});

describe('agregarNueva: entra ARRIBA de la lista ya cargada', () => {
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
  const vista = (n, extra) => L.observacionesPozoLogic_vista(obs(n, extra));

  test('inserta al principio, suma al total y no toca cursor ni hayMas ni las paginas ya cargadas', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 }));
    expect(t.c.agregarNueva(vista(9), W)).toBe(true);
    const e = t.c.estado();
    expect(e.items.map((i) => i.id)).toEqual(['obs-9', 'obs-5', 'obs-4']);
    expect(e).toMatchObject({ total: 5, hayMas: true, cursor: 4, fase: 'listo' });
  });

  test('el estado vacio desaparece (total 0 -> 1) sin recargar', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([], { total: 0 }));
    t.c.agregarNueva(vista(1), W);
    expect(t.c.estado()).toMatchObject({ total: 1 });
    expect(t.c.estado().items).toHaveLength(1);
    expect(t.llamadas).toHaveLength(1);                         // ningun pedido extra
  });

  test('dedupe: una observacion que ya esta (retry idempotente con duplicada:true) no se duplica ni suma', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 2 }));
    expect(t.c.agregarNueva(vista(5), W)).toBe(false);
    expect(t.c.estado().items).toHaveLength(2);
    expect(t.c.estado().total).toBe(2);
    t.c.agregarNueva(vista(9), W);
    expect(t.c.agregarNueva(vista(9), W)).toBe(false);
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-9', 'obs-5', 'obs-4']);
  });

  test('la paginacion sigue funcionando despues de insertar: el cursor es el del backend y la pagina siguiente se agrega al final', async () => {
    const t = armarLista();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 }));
    t.c.agregarNueva(vista(9), W);
    t.c.cargarMas();
    expect(t.llamadas[1].antes).toBe(4);                        // NO se recalcula desde la nueva alta
    await t.responder(pagina([obs(3), obs(2)], { total: 4, hayMas: false }));
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-9', 'obs-5', 'obs-4', 'obs-3', 'obs-2']);
  });

  test('no aplica si la lista no esta lista, es de otro pozo o la vista es nula', async () => {
    const t = armarLista();
    expect(t.c.agregarNueva(vista(1), W)).toBe(false);          // idle
    t.c.abrir(W);
    expect(t.c.agregarNueva(vista(1), W)).toBe(false);          // cargando
    await t.responder(pagina([obs(5)]));
    expect(t.c.agregarNueva(vista(1), '14-0002')).toBe(false);
    expect(t.c.agregarNueva(null, W)).toBe(false);
    expect(t.c.estado().items).toHaveLength(1);
  });
});
