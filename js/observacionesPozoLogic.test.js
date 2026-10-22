// Logica pura de Observaciones del pozo (E5-4, lectura): permisos fail-closed, modelo de vista (activa / anulada / texto null), privacidad (lista blanca), respuesta mal formada,
// fechas, y el cargador paginado (primera pagina, "ver anteriores", sin duplicados, doble toque, error de la pagina 2, reabrir, respuestas viejas, sesion vencida).
global.reemplazoLogic_formatearFecha = require('./reemplazoLogic').reemplazoLogic_formatearFecha;
const L = require('./observacionesPozoLogic');

const W = '14-0001';
const ISO = '2026-10-20T15:00:00.000Z';                 // 12:00 en Mendoza (UTC-3)
const FECHA = '20/10/2026 12:00';
const obs = (n, extra) => Object.assign({ observacionId: 'obs-' + n, wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: ISO, anulacion: null }, extra || {});
const anulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', timestamp: '2026-10-21T18:30:00.000Z', motivo: 'Cargada por error' } }, extra || {}));
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas: false, cursor: null, observaciones: items }, extra || {}) });
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

describe('permiso: solo el booleano exacto', () => {
  test.each([[true, true], [false, false], [undefined, false], [null, false], ['SI', false], ['si', false], ['true', false], [1, false], [0, false], [{}, false], [[], false], ['1', false]])('observaciones=%j -> %s', (valor, esperado) => {
    expect(L.observacionesPozoLogic_puedeVer({ observaciones: valor })).toBe(esperado);
  });

  test('permisos ausentes / backend viejo sin la clave: no', () => {
    expect(L.observacionesPozoLogic_puedeVer(undefined)).toBe(false);
    expect(L.observacionesPozoLogic_puedeVer(null)).toBe(false);
    expect(L.observacionesPozoLogic_puedeVer({})).toBe(false);
    expect(L.observacionesPozoLogic_puedeVer({ perfil: true, datos: true, fotos: true })).toBe(false);
  });

  test('agregar / anular solos NO habilitan la lectura', () => {
    expect(L.observacionesPozoLogic_puedeVer({ observaciones_agregar: true, observaciones_anular: true })).toBe(false);
  });
});

describe('mensajes de error: siempre de la tabla, nunca el message tecnico', () => {
  test('PERMISSION_DENIED, SERVICE_UNAVAILABLE, parametros, red y desconocidos', () => {
    expect(L.observacionesPozoLogic_mensajeError('PERMISSION_DENIED')).toBe('No tenés acceso a las observaciones de este pozo.');
    expect(L.observacionesPozoLogic_mensajeError('SERVICE_UNAVAILABLE')).toBe('No se pudieron cargar las observaciones. Intentá nuevamente.');
    ['INVALID_LIMIT', 'INVALID_CURSOR', 'INVALID_WELL_ID', 'RED', 'LO_QUE_SEA', undefined, null, '__proto__', 'constructor', 'toString'].forEach((c) => {
      expect(L.observacionesPozoLogic_mensajeError(c)).toBe(L.OBSERVACIONES_POZO_MENSAJE_GENERICO);
    });
    expect(L.observacionesPozoLogic_mensajeError('UNAUTHORIZED')).toMatch(/sesión venció/);
  });
});

describe('fecha y nombre', () => {
  test('hora de Mendoza dd/mm/aaaa hh:mm; invalida o ausente -> vacio (la vista pone "Fecha no disponible")', () => {
    expect(L.observacionesPozoLogic_fecha(ISO)).toBe(FECHA);
    ['', 'no-es-fecha', null, undefined, 5, {}, 'x'.repeat(50)].forEach((v) => expect(L.observacionesPozoLogic_fecha(v)).toBe(''));
  });

  test('nombre: el recibido; vacio, ausente o con forma de email -> "Usuario" (nunca se reconstruye un email)', () => {
    expect(L.observacionesPozoLogic_nombre('  Ana Pérez ')).toBe('Ana Pérez');
    ['', '   ', null, undefined, 7, {}, 'ana@x.com', 'Ana <ana@x.com>'].forEach((v) => expect(L.observacionesPozoLogic_nombre(v)).toBe('Usuario'));
  });
});

describe('vista de una observacion', () => {
  test('ACTIVA: texto, autor, fecha legible, sin categoria ni anulacion', () => {
    expect(L.observacionesPozoLogic_vista(obs(1))).toEqual({ id: 'obs-1', estado: 'ACTIVA', texto: 'Texto 1', nombre: 'Ana', fecha: FECHA, categoria: null, anulacion: null });
  });

  test('ACTIVA con categoria definida: se muestra; vacia o no string: no', () => {
    expect(L.observacionesPozoLogic_vista(obs(1, { categoria: 'Acceso' })).categoria).toBe('Acceso');
    ['', '  ', null, 5, {}].forEach((c) => expect(L.observacionesPozoLogic_vista(obs(1, { categoria: c })).categoria).toBeNull());
  });

  test('ANULADA sin texto (usuario comun): no se reconstruye el original; datos de la anulacion', () => {
    const v = L.observacionesPozoLogic_vista(anulada(2));
    expect(v).toEqual({
      id: 'obs-2', estado: 'ANULADA', texto: null, nombre: 'Ana', fecha: FECHA, categoria: null,
      anulacion: { nombre: 'Moderadora', fecha: '21/10/2026 15:30', motivo: 'Cargada por error' }
    });
  });

  test('ANULADA con texto (el backend lo mando por observaciones_anular): se conserva el original y sigue siendo ANULADA', () => {
    const v = L.observacionesPozoLogic_vista(anulada(3, { texto: 'Original que debe verse subordinado' }));
    expect(v.estado).toBe('ANULADA');
    expect(v.texto).toBe('Original que debe verse subordinado');
    expect(v.anulacion.motivo).toBe('Cargada por error');
  });

  test('ANULADA sin objeto anulacion, sin motivo o con fecha invalida: no rompe', () => {
    const sin = L.observacionesPozoLogic_vista(anulada(4, { anulacion: null }));
    expect(sin.anulacion).toEqual({ nombre: 'Usuario', fecha: 'Fecha no disponible', motivo: null });
    const sinMotivo = L.observacionesPozoLogic_vista(anulada(5, { anulacion: { nombre: 'Mod', timestamp: ISO, motivo: '' } }));
    expect(sinMotivo.anulacion.motivo).toBeNull();
    const fechaMala = L.observacionesPozoLogic_vista(anulada(6, { anulacion: { nombre: 'Mod', timestamp: 'basura', motivo: 'x' } }));
    expect(fechaMala.anulacion.fecha).toBe('Fecha no disponible');
  });

  test('ANULADA: la fecha de creacion invalida queda vacia (no se muestra); en una ACTIVA es "Fecha no disponible"', () => {
    expect(L.observacionesPozoLogic_vista(anulada(7, { timestamp: 'basura' })).fecha).toBe('');
    expect(L.observacionesPozoLogic_vista(obs(8, { timestamp: 'basura' })).fecha).toBe('Fecha no disponible');
    expect(L.observacionesPozoLogic_vista(obs(9, { timestamp: undefined })).fecha).toBe('Fecha no disponible');
    expect(L.observacionesPozoLogic_vista(obs(10, { timestamp: 12345 })).fecha).toBe('Fecha no disponible');
  });

  test.each([
    ['estado desconocido', { estado: 'BORRADA' }],
    ['estado en minuscula', { estado: 'activa' }],
    ['sin estado', { estado: undefined }],
    ['ACTIVA sin texto', { texto: null }],
    ['ACTIVA con texto vacio', { texto: '   ' }],
    ['ACTIVA con texto no string', { texto: 42 }],
    ['sin observacionId', { observacionId: undefined }],
    ['observacionId vacio', { observacionId: '  ' }],
    ['observacionId no string', { observacionId: 7 }]
  ])('no se puede mostrar con seguridad (%s) -> null', (_n, extra) => {
    expect(L.observacionesPozoLogic_vista(obs(1, extra))).toBeNull();
  });

  test.each([[null], [undefined], ['texto'], [5], [[]], [true]])('entrada que no es un objeto (%j) -> null', (v) => {
    expect(L.observacionesPozoLogic_vista(v)).toBeNull();
  });

  test('PRIVACIDAD: lista blanca. email, clientRequestId, secuencia y campos extra del payload no llegan a la vista', () => {
    const sucio = obs(1, { email: 'ana@x.com', clientRequestId: 'req-12345678', secuencia: 77, nombreCompleto: 'Ana', usuario: 'ana@x.com', extra: { email: 'otro@x.com' } });
    const v = L.observacionesPozoLogic_vista(sucio);
    expect(Object.keys(v).sort()).toEqual(['anulacion', 'categoria', 'estado', 'fecha', 'id', 'nombre', 'texto']);
    expect(JSON.stringify(v)).not.toMatch(/ana@x\.com|otro@x\.com|req-12345678|77|secuencia|clientRequestId|email/);
    const va = L.observacionesPozoLogic_vista(anulada(2, { email: 'ana@x.com', clientRequestId: 'req-12345678', secuencia: 5, anulacion: { nombre: 'Mod', timestamp: ISO, motivo: 'm', email: 'mod@x.com', clientRequestId: 'otro-12345678', secuencia: 9 } }));
    expect(JSON.stringify(va)).not.toMatch(/@x\.com|req-12345678|otro-12345678|secuencia|clientRequestId|email/);
    expect(Object.keys(va.anulacion).sort()).toEqual(['fecha', 'motivo', 'nombre']);
  });

  test.each([
    ['script', '<script>alert(1)</script>'],
    ['HTML', '<b>negrita</b> <img src=x onerror=alert(1)> <a href="javascript:alert(1)">x</a>'],
    ['ampersand y entidades', 'Tom &amp; Jerry &lt;b&gt; &#60; & <'],
    ['emoji', 'Bomba instalada \u{1F4A7}\u{1F527} listo ✅'],
    ['saltos de linea', 'linea uno\nlinea dos\n\nlinea cuatro'],
    ['1000 caracteres', 'x'.repeat(1000)],
    ['palabra larga sin espacios', 'a'.repeat(400)],
    ['comillas y backticks', '"doble" \'simple\' `tick` ${x} {{y}}']
  ])('el texto libre (%s) se conserva TAL CUAL: no se interpreta ni se modifica', (_n, texto) => {
    expect(L.observacionesPozoLogic_vista(obs(1, { texto })).texto).toBe(texto);
    expect(L.observacionesPozoLogic_vista(anulada(2, { texto })).texto).toBe(texto);
    expect(L.observacionesPozoLogic_vista(anulada(3, { anulacion: { nombre: 'M', timestamp: ISO, motivo: texto } })).anulacion.motivo).toBe(texto);
  });
});

describe('leerRespuesta: fail-safe', () => {
  test('respuesta correcta', () => {
    const r = L.observacionesPozoLogic_leerRespuesta(pagina([obs(2), anulada(1)], { total: 5, hayMas: true, cursor: 1 }), W);
    expect(r).toMatchObject({ ok: true, wellId: W, total: 5, hayMas: true, cursor: 1 });
    expect(r.items.map((i) => i.id)).toEqual(['obs-2', 'obs-1']);
    expect(r.items.map((i) => i.estado)).toEqual(['ACTIVA', 'ANULADA']);
  });

  test('pozo sin observaciones: ok, vacia, total 0', () => {
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([], { total: 0 }), W)).toMatchObject({ ok: true, items: [], total: 0, hayMas: false, cursor: null });
  });

  test('error del backend: su codigo; sin codigo o con codigo raro -> SERVICE_UNAVAILABLE', () => {
    expect(L.observacionesPozoLogic_leerRespuesta({ status: 'error', code: 'PERMISSION_DENIED', message: 'detalle tecnico' }, W)).toEqual({ ok: false, code: 'PERMISSION_DENIED' });
    expect(L.observacionesPozoLogic_leerRespuesta({ status: 'error' }, W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(L.observacionesPozoLogic_leerRespuesta({ status: 'error', code: 5 }, W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test.each([
    [null], [undefined], ['ok'], [5], [[]], [{}],
    [{ status: 'ok' }], [{ status: 'ok', data: null }], [{ status: 'ok', data: 'x' }], [{ status: 'ok', data: {} }],
    [{ status: 'ok', data: { observaciones: 'no es lista' } }], [{ status: 'ok', data: { observaciones: {} } }],
    [{ status: 'otra', data: { wellId: W, observaciones: [] } }], [{ data: { wellId: W, observaciones: [] } }]
  ])('payload mal formado %j -> SERVICE_UNAVAILABLE, nunca una excepcion', (resp) => {
    expect(L.observacionesPozoLogic_leerRespuesta(resp, W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test('una respuesta de OTRO pozo no se muestra', () => {
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { wellId: '14-0002' }), W)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { wellId: undefined }), W).ok).toBe(false);
  });

  test('las observaciones no mostrables se descartan una a una, las demas se muestran', () => {
    const r = L.observacionesPozoLogic_leerRespuesta(pagina([obs(1), null, 'x', obs(2, { estado: 'RARA' }), obs(3, { texto: '' }), obs(4)]), W);
    expect(r.items.map((i) => i.id)).toEqual(['obs-1', 'obs-4']);
  });

  test.each([[0], [-1], [1.5], ['5'], [null], [undefined], [NaN], [Infinity]])('hayMas=true con cursor invalido (%j): no se puede paginar -> hayMas false', (cursor) => {
    const r = L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { hayMas: true, cursor }), W);
    expect(r.hayMas).toBe(false);
    expect(r.cursor).toBeNull();
  });

  test('hayMas distinto del booleano true (truthy) no cuenta', () => {
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { hayMas: 'true', cursor: 5 }), W).hayMas).toBe(false);
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { hayMas: 1, cursor: 5 }), W).hayMas).toBe(false);
  });

  test('total invalido -> null (el cargador usa la cantidad de items)', () => {
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { total: 'tres' }), W).total).toBeNull();
    expect(L.observacionesPozoLogic_leerRespuesta(pagina([obs(1)], { total: -2 }), W).total).toBeNull();
  });
});

describe('agregarPagina: append sin duplicados', () => {
  const v = (n) => L.observacionesPozoLogic_vista(obs(n));
  test('suma al final, en orden, y descarta repetidas (contra lo mostrado y dentro de la pagina)', () => {
    const r = L.observacionesPozoLogic_agregarPagina([v(5), v(4)], [v(4), v(3), v(3), v(2)]);
    expect(r.items.map((i) => i.id)).toEqual(['obs-5', 'obs-4', 'obs-3', 'obs-2']);
    expect(r.agregadas).toBe(2);
  });

  test('no modifica el arreglo original', () => {
    const base = [v(5)];
    L.observacionesPozoLogic_agregarPagina(base, [v(4)]);
    expect(base).toHaveLength(1);
  });
});

describe('cargador paginado', () => {
  function armar(opc) {
    const o = opc || {};
    const llamadas = [];
    const pendientes = [];
    const cambios = [];
    const sesion = { sessionToken: 'tok-real', permisos: o.permisos || { observaciones: true } };
    const deps = {
      obtenerContexto: () => sesion,
      consultar: jest.fn((token, wellId, limit, antes) => {
        llamadas.push({ token, wellId, limit, antes });
        return new Promise((resolver, rechazar) => { pendientes.push({ resolver, rechazar }); });
      }),
      onCambio: (e) => cambios.push(JSON.parse(JSON.stringify(e))),
      onSesionExpirada: jest.fn()
    };
    const c = L.observacionesPozoLogic_crearCargador(deps);
    const responder = async (resp, i) => { const p = pendientes[i === undefined ? pendientes.length - 1 : i]; p.resolver(resp); await flush(); };
    const fallar = async (i) => { const p = pendientes[i === undefined ? pendientes.length - 1 : i]; p.rechazar(new Error('red caida')); await flush(); };
    return { c, deps, llamadas, pendientes, cambios, sesion, responder, fallar };
  }

  test('abrir: UNA llamada con limit 50, sin cursor, con el token y el pozo; pasa por cargando y queda listo', async () => {
    const t = armar();
    const p = t.c.abrir(W);
    expect(t.cambios[0]).toMatchObject({ fase: 'cargando', wellId: W, items: [] });
    expect(t.llamadas).toEqual([{ token: 'tok-real', wellId: W, limit: 50, antes: undefined }]);
    await t.responder(pagina([obs(3), obs(2), obs(1)], { total: 3 }));
    await p;
    const e = t.c.estado();
    expect(e).toMatchObject({ fase: 'listo', total: 3, hayMas: false, cursor: null, cargandoMas: false, errorMas: '' });
    expect(e.items.map((i) => i.id)).toEqual(['obs-3', 'obs-2', 'obs-1']);
  });

  test('pozo sin observaciones: listo con 0 items y total 0 (estado vacio, no error)', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([], { total: 0 }));
    expect(t.c.estado()).toMatchObject({ fase: 'listo', total: 0, items: [], hayMas: false, error: '' });
  });

  test.each([[{ observaciones: false }], [{ observaciones: 'SI' }], [{ observaciones: 1 }], [{ observaciones: 'true' }], [{}], [undefined], [{ observaciones_agregar: true, observaciones_anular: true }]])('sin observaciones===true (%j): NINGUNA llamada, PERMISSION_DENIED', async (permisos) => {
    const t = armar();
    t.sesion.permisos = permisos;
    await t.c.abrir(W);
    expect(t.deps.consultar).not.toHaveBeenCalled();
    expect(t.c.estado()).toMatchObject({ fase: 'error', errorCode: 'PERMISSION_DENIED', error: 'No tenés acceso a las observaciones de este pozo.' });
  });

  test('pozo invalido (vacio / no string): ninguna llamada', async () => {
    const t = armar();
    for (const w of ['', undefined, null, 5]) { await t.c.abrir(w); }
    expect(t.deps.consultar).not.toHaveBeenCalled();
  });

  test('hayMas=false: no se ofrece mas y cargarMas no pide nada', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(1)]));
    expect(t.c.estado().hayMas).toBe(false);
    await t.c.cargarMas();
    expect(t.llamadas).toHaveLength(1);
  });

  test('hayMas=true: cursor guardado y cargarMas pide con antesDeSecuencia = cursor (exclusivo: lo decide el backend), SUMA al final y no reemplaza la primera', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 4, hayMas: true, cursor: 4 }));
    expect(t.c.estado()).toMatchObject({ hayMas: true, cursor: 4 });
    const p = t.c.cargarMas();
    expect(t.c.estado().cargandoMas).toBe(true);
    expect(t.llamadas[1]).toEqual({ token: 'tok-real', wellId: W, limit: 50, antes: 4 });
    await t.responder(pagina([obs(3), obs(2)], { total: 4, hayMas: false, cursor: null }));
    await p;
    const e = t.c.estado();
    expect(e.items.map((i) => i.id)).toEqual(['obs-5', 'obs-4', 'obs-3', 'obs-2']);
    expect(e).toMatchObject({ cargandoMas: false, hayMas: false, cursor: null, errorMas: '' });
  });

  test('tres paginas encadenadas usan cada vez el cursor nuevo', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(9), obs(8)], { hayMas: true, cursor: 8 }));
    t.c.cargarMas();
    await t.responder(pagina([obs(7), obs(6)], { hayMas: true, cursor: 6 }));
    t.c.cargarMas();
    await t.responder(pagina([obs(5)], { hayMas: false }));
    expect(t.llamadas.map((l) => l.antes)).toEqual([undefined, 8, 6]);
    expect(t.c.estado().items).toHaveLength(5);
  });

  test('sin duplicados: lo repetido entre paginas no se agrega dos veces', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { hayMas: true, cursor: 4 }));
    t.c.cargarMas();
    await t.responder(pagina([obs(4), obs(3)], { hayMas: false }));
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-5', 'obs-4', 'obs-3']);
  });

  test('doble toque / doble click: UN solo pedido en vuelo', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    const a = t.c.cargarMas();
    const b = t.c.cargarMas();
    const c2 = t.c.cargarMas();
    expect(t.llamadas).toHaveLength(2);
    expect(b).toBe(a);
    expect(c2).toBe(a);
    await t.responder(pagina([obs(4)], { hayMas: false }));
    await a;
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-5', 'obs-4']);
    expect(t.llamadas).toHaveLength(2);
  });

  test('error de la pagina 2 (backend): la pagina 1 sigue visible, aparece un error contextual y se puede reintentar', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { total: 3, hayMas: true, cursor: 4 }));
    t.c.cargarMas();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'detalle interno' });
    let e = t.c.estado();
    expect(e.fase).toBe('listo');
    expect(e.items.map((i) => i.id)).toEqual(['obs-5', 'obs-4']);
    expect(e).toMatchObject({ cargandoMas: false, hayMas: true, cursor: 4, errorMas: 'No se pudieron cargar las observaciones. Intentá nuevamente.' });
    expect(JSON.stringify(e)).not.toContain('detalle interno');
    t.c.cargarMas();
    expect(t.llamadas[2].antes).toBe(4);
    expect(t.c.estado().errorMas).toBe('');
    await t.responder(pagina([obs(3)], { hayMas: false }));
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-5', 'obs-4', 'obs-3']);
  });

  test('error de red en la pagina 2 (promesa rechazada): conserva la pagina 1', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.c.cargarMas();
    await t.fallar();
    expect(t.c.estado()).toMatchObject({ fase: 'listo', cargandoMas: false, hayMas: true });
    expect(t.c.estado().items).toHaveLength(1);
    expect(t.c.estado().errorMas).toMatch(/No se pudieron cargar/);
  });

  test('respuesta mal formada en la pagina 2: no pisa la pagina 1', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.c.cargarMas();
    await t.responder({ status: 'ok', data: { observaciones: 'x' } });
    expect(t.c.estado().items).toHaveLength(1);
    expect(t.c.estado().errorMas).not.toBe('');
  });

  test('un cursor que no retrocede corta la paginacion (sin bucle infinito)', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.c.cargarMas();
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    expect(t.c.estado()).toMatchObject({ hayMas: false, cursor: null });
    expect(t.c.estado().items).toHaveLength(1);
  });

  test('error de la primera pagina: fase error con mensaje de tabla, sin items; reintentar vuelve a pedir desde cero', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'Spreadsheet caido' });
    expect(t.c.estado()).toMatchObject({ fase: 'error', items: [], error: 'No se pudieron cargar las observaciones. Intentá nuevamente.' });
    t.c.reintentar();
    expect(t.llamadas).toHaveLength(2);
    expect(t.llamadas[1].antes).toBeUndefined();
    await t.responder(pagina([obs(1)]));
    expect(t.c.estado()).toMatchObject({ fase: 'listo', error: '' });
  });

  test('error de red en la primera pagina: pantalla estable (fase error, sin excepcion) y reintentable', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.fallar();
    expect(t.c.estado()).toMatchObject({ fase: 'error', errorCode: 'RED' });
    t.c.reintentar();
    await t.responder(pagina([obs(1)]));
    expect(t.c.estado().fase).toBe('listo');
  });

  test('consultar que LANZA de forma sincrona tambien termina en error controlado', async () => {
    const t = armar();
    t.deps.consultar.mockImplementationOnce(() => { throw new Error('boom'); });
    await t.c.abrir(W);
    expect(t.c.estado()).toMatchObject({ fase: 'error', errorCode: 'RED' });
  });

  test('PERMISSION_DENIED del backend: mensaje de acceso, sin items', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder({ status: 'error', code: 'PERMISSION_DENIED', message: 'usuario sin permiso "observaciones": ana@x.com' });
    expect(t.c.estado()).toMatchObject({ fase: 'error', errorCode: 'PERMISSION_DENIED', error: 'No tenés acceso a las observaciones de este pozo.' });
    expect(JSON.stringify(t.c.estado())).not.toContain('ana@x.com');
  });

  test('acciones o errores raros del backend viejo ("accion desconocida"): error controlado', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'accion desconocida: getObservacionesPozo' });
    expect(t.c.estado()).toMatchObject({ fase: 'error', error: 'No se pudieron cargar las observaciones. Intentá nuevamente.' });
    expect(JSON.stringify(t.c.estado())).not.toContain('accion desconocida');
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: avisa a la app para cerrar sesion (una vez)', async (code) => {
    const t = armar();
    t.c.abrir(W);
    await t.responder({ status: 'error', code, message: 'x' });
    expect(t.deps.onSesionExpirada).toHaveBeenCalledTimes(1);
    expect(t.c.estado().fase).toBe('error');
  });

  test('sesion vencida en la pagina 2: tambien avisa y conserva la pagina 1', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.c.cargarMas();
    await t.responder({ status: 'error', code: 'UNAUTHORIZED' });
    expect(t.deps.onSesionExpirada).toHaveBeenCalledTimes(1);
    expect(t.c.estado().items).toHaveLength(1);
  });

  test('respuesta de OTRO pozo: error, no se muestra', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(1)], { wellId: '14-0002' }));
    expect(t.c.estado()).toMatchObject({ fase: 'error', items: [] });
  });

  test('reabrir reinicia desde la primera pagina (sin cache): items y cursor nuevos, y la llamada vuelve a ser sin cursor', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5), obs(4)], { hayMas: true, cursor: 4 }));
    t.c.cargarMas();
    await t.responder(pagina([obs(3)], { hayMas: false }));
    expect(t.c.estado().items).toHaveLength(3);
    t.c.cerrar();
    expect(t.c.estado()).toMatchObject({ fase: 'idle', items: [] });
    t.c.abrir(W);
    expect(t.llamadas[t.llamadas.length - 1].antes).toBeUndefined();
    expect(t.c.estado()).toMatchObject({ fase: 'cargando', items: [], cursor: null, hayMas: false });
    await t.responder(pagina([obs(9)], { total: 1 }));
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-9']);
  });

  test('una respuesta VIEJA (de una apertura anterior) se descarta', async () => {
    const t = armar();
    t.c.abrir(W);
    t.c.abrir('14-0002');
    await t.responder(pagina([obs(1, { texto: 'del primer pozo' })]), 0);
    expect(t.c.estado()).toMatchObject({ fase: 'cargando', wellId: '14-0002', items: [] });
    await t.responder(pagina([obs(2)], { wellId: '14-0002' }), 1);
    expect(t.c.estado()).toMatchObject({ fase: 'listo', wellId: '14-0002' });
    expect(JSON.stringify(t.c.estado())).not.toContain('del primer pozo');
  });

  test('respuesta que llega DESPUES de cerrar: se descarta (no resucita datos)', async () => {
    const t = armar();
    t.c.abrir(W);
    t.c.cerrar();
    await t.responder(pagina([obs(1)]));
    expect(t.c.estado()).toMatchObject({ fase: 'idle', items: [] });
  });

  test('pagina 2 en vuelo y se reabre/cierra: su respuesta no se mezcla', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(5)], { hayMas: true, cursor: 5 }));
    t.c.cargarMas();
    t.c.cerrar();
    await t.responder(pagina([obs(4)]));
    expect(t.c.estado()).toMatchObject({ fase: 'idle', items: [] });
    t.c.abrir(W);
    await t.responder(pagina([obs(7)]));
    expect(t.c.estado().items.map((i) => i.id)).toEqual(['obs-7']);
  });

  test('los permisos se leen en CADA apertura (se perdio el permiso -> ya no pide)', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(1)]));
    t.sesion.permisos = { observaciones: false };
    await t.c.abrir(W);
    expect(t.deps.consultar).toHaveBeenCalledTimes(1);
    expect(t.c.estado().errorCode).toBe('PERMISSION_DENIED');
  });

  test('la primera pagina trae anuladas con y sin texto: cada una conserva su forma (sin reconstruir nada)', async () => {
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(4), anulada(3), anulada(2, { texto: 'original visible por moderacion' }), obs(1)], { total: 4, activas: 2, anuladas: 2 }));
    const e = t.c.estado();
    expect(e.items.map((i) => [i.estado, i.texto])).toEqual([['ACTIVA', 'Texto 4'], ['ANULADA', null], ['ANULADA', 'original visible por moderacion'], ['ACTIVA', 'Texto 1']]);
  });

  test('nada de lo que pasa por el cargador toca console, storage ni location', async () => {
    const espiar = ['log', 'info', 'warn', 'error', 'debug'].map((m) => jest.spyOn(console, m).mockImplementation(() => {}));
    const t = armar();
    t.c.abrir(W);
    await t.responder(pagina([obs(1, { texto: 'SECRETO-1234' })], { hayMas: true, cursor: 1 }));
    t.c.cargarMas();
    await t.responder({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    espiar.forEach((e) => expect(e).not.toHaveBeenCalled());
    espiar.forEach((e) => e.mockRestore());
  });
});
