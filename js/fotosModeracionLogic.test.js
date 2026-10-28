// Logica pura de la moderacion de fotos de pozos (E8-4): permisos exactos, catalogo de motivos, mensajes, validacion del detalle, clientRequestId, lectura segura de respuestas, vista del
// historial (orden, etiquetas, nada tecnico) y las maquinas de estados (accion con envio e historial). El DOM esta en fotosModeracionController.test.js.
Object.assign(global, require('./reemplazoLogic'), require('./observacionesPozoLogic'), require('./fotosPozosLogic'));
const L = require('./fotosModeracionLogic');

const FOTO = '11111111-1111-4111-8111-111111111111';
const OTRA = '22222222-2222-4222-8222-222222222222';
const flush = async () => { for (let i = 0; i < 6; i += 1) { await new Promise((r) => setImmediate(r)); } };
const ok = (extra) => ({ status: 'ok', data: Object.assign({ fotoId: FOTO, duplicada: false }, extra || {}) });
const err = (code) => ({ status: 'error', code: code, message: 'texto crudo del backend: hoja FotosPozoEventos' });

describe('permisos: booleanos exactos', () => {
  const P = (o) => Object.assign({}, o);
  test('ver = fotos === true', () => {
    expect(L.fotosModeracionLogic_puedeVer(P({ fotos: true }))).toBe(true);
    [P({}), P({ fotos: false }), P({ fotos_carga: true }), null, undefined, 'x'].forEach((p) => expect(L.fotosModeracionLogic_puedeVer(p)).toBe(false));
  });

  test('sugerir = fotos + fotos_carga; solo fotos o solo fotos_carga no alcanzan', () => {
    expect(L.fotosModeracionLogic_puedeSugerir(P({ fotos: true, fotos_carga: true }))).toBe(true);
    [P({ fotos: true }), P({ fotos_carga: true }), P({ fotos: true, fotos_moderar: true }), P({ fotos: false, fotos_carga: true })].forEach((p) => expect(L.fotosModeracionLogic_puedeSugerir(p)).toBe(false));
  });

  test('moderar = fotos + fotos_moderar; fotos_carga NO modera y fotos_moderar sin fotos tampoco', () => {
    expect(L.fotosModeracionLogic_puedeModerar(P({ fotos: true, fotos_moderar: true }))).toBe(true);
    [P({ fotos: true }), P({ fotos: true, fotos_carga: true }), P({ fotos_moderar: true }), P({ fotos: false, fotos_moderar: true }), P({ fotos_carga: true, fotos_moderar: true })].forEach((p) => expect(L.fotosModeracionLogic_puedeModerar(p)).toBe(false));
  });

  test.each([['SI'], [1], ['true'], ['TRUE'], [{}], [[]], [2], [' true ']])('un valor truthy que no es el booleano true (%j) no habilita nada', (v) => {
    const p = { fotos: v, fotos_carga: v, fotos_moderar: v };
    expect(L.fotosModeracionLogic_puedeVer(p)).toBe(false);
    expect(L.fotosModeracionLogic_puedeSugerir(p)).toBe(false);
    expect(L.fotosModeracionLogic_puedeModerar(p)).toBe(false);
    const mixto = { fotos: true, fotos_carga: v, fotos_moderar: v };
    expect(L.fotosModeracionLogic_puedeSugerir(mixto)).toBe(false);
    expect(L.fotosModeracionLogic_puedeModerar(mixto)).toBe(false);
  });

  test('todos los permisos: puede las tres cosas; permitida() por tipo de accion', () => {
    const todos = { fotos: true, fotos_carga: true, fotos_moderar: true };
    ['SUGERIR', 'RETIRAR', 'REPONER'].forEach((t) => expect(L.fotosModeracionLogic_permitida(t, todos)).toBe(true));
    expect(L.fotosModeracionLogic_permitida('SUGERIR', { fotos: true, fotos_moderar: true })).toBe(false);
    expect(L.fotosModeracionLogic_permitida('RETIRAR', { fotos: true, fotos_carga: true })).toBe(false);
    expect(L.fotosModeracionLogic_permitida('REPONER', { fotos: true, fotos_carga: true })).toBe(false);
    expect(L.fotosModeracionLogic_permitida('BORRAR', todos)).toBe(false);
    expect(L.fotosModeracionLogic_permitida(undefined, todos)).toBe(false);
  });
});

describe('catalogo de motivos y etiquetas (un solo lugar)', () => {
  test('mismo orden y codigos que el backend, con etiquetas humanas', () => {
    expect(L.FOTOS_MODERACION_MOTIVOS.map((m) => m.codigo)).toEqual(['NO_CORRESPONDE_POZO', 'DUPLICADA', 'MALA_CALIDAD', 'SIN_CONTENIDO_UTIL', 'PRIVACIDAD', 'DESACTUALIZADA', 'OTRO']);
    expect(L.FOTOS_MODERACION_MOTIVOS.map((m) => m.etiqueta)).toEqual(['No corresponde al pozo', 'Duplicada', 'Mala calidad', 'Sin contenido útil', 'Privacidad', 'Desactualizada', 'Otro']);
  });

  test('el catalogo del backend y el del frontend son el mismo', () => {
    const backend = require('../backend/src/FotosPozosModeracionService');
    expect(L.FOTOS_MODERACION_MOTIVOS.map((m) => m.codigo)).toEqual(backend.FOTOS_MOD_MOTIVOS);
    expect(L.FOTOS_MODERACION_TEXTO_MIN).toBe(backend.FOTOS_MOD_MOTIVO_TEXTO_MIN);
    expect(L.FOTOS_MODERACION_TEXTO_MAX).toBe(backend.FOTOS_MOD_MOTIVO_TEXTO_MAX);
  });

  test('etiquetaMotivo: cada codigo a su etiqueta; uno desconocido NUNCA se muestra crudo', () => {
    expect(L.fotosModeracionLogic_etiquetaMotivo('DUPLICADA')).toBe('Duplicada');
    expect(L.fotosModeracionLogic_etiquetaMotivo('PRIVACIDAD')).toBe('Privacidad');
    ['SPAM', '', null, undefined, 'duplicada', {}].forEach((c) => {
      expect(L.fotosModeracionLogic_etiquetaMotivo(c)).toBe('Motivo no reconocido');
    });
  });

  test('etiquetaEvento: los 5 casos pedidos; sin codigos crudos', () => {
    expect(L.fotosModeracionLogic_etiquetaEvento('RETIRO_SOLICITADO')).toBe('Retiro sugerido');
    expect(L.fotosModeracionLogic_etiquetaEvento('RETIRADA')).toBe('Foto retirada');
    expect(L.fotosModeracionLogic_etiquetaEvento('RETIRO_RESUELTO', 'APROBADO')).toBe('Retiro aprobado');
    expect(L.fotosModeracionLogic_etiquetaEvento('RETIRO_RESUELTO', 'RECHAZADO')).toBe('Retiro rechazado');
    expect(L.fotosModeracionLogic_etiquetaEvento('REPUESTA')).toBe('Foto repuesta');
    expect(L.fotosModeracionLogic_etiquetaEvento('RETIRO_RESUELTO', 'RARO')).toBe('Retiro resuelto');
    ['DESCONOCIDO', 'ALGO_NUEVO', '', null].forEach((e) => expect(L.fotosModeracionLogic_etiquetaEvento(e)).toBe('Evento no reconocido'));
  });
});

describe('mensajes de error', () => {
  test('los mensajes pedidos', () => {
    expect(L.fotosModeracionLogic_mensajeError('PERMISSION_DENIED')).toBe('Ya no tenés permiso para realizar esta acción.');
    expect(L.fotosModeracionLogic_mensajeError('FOTO_NOT_FOUND')).toBe('La foto ya no está disponible.');
    expect(L.fotosModeracionLogic_mensajeError('SOLICITUD_ABIERTA')).toBe('Esta foto ya tiene una solicitud de retiro pendiente.');
    expect(L.fotosModeracionLogic_mensajeError('SOLICITUD_YA_ABIERTA')).toBe('Esta foto ya tiene una solicitud de retiro pendiente.');
    expect(L.fotosModeracionLogic_mensajeError('INVALID_TRANSITION')).toBe('El estado de la foto cambió. Actualizamos la galería.');
    expect(L.fotosModeracionLogic_mensajeError('SERVICE_UNAVAILABLE')).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
  });

  test.each([['FOTO_YA_RETIRADA'], ['FOTO_NO_RETIRADA'], ['SOLICITUD_YA_RESUELTA'], ['SOLICITUD_NOT_FOUND']])('%s se explica como cambio de estado', (code) => {
    expect(L.fotosModeracionLogic_mensajeError(code)).toBe('El estado de la foto cambió. Actualizamos la galería.');
  });

  test('una OCULTA legacy no repuesta explica por que', () => {
    expect(L.fotosModeracionLogic_mensajeError('REPOSICION_NO_PERMITIDA')).toBe('Las fotos ocultas históricamente no pueden reponerse desde este flujo.');
  });

  test('codigos desconocidos / vacios / inyectados caen en el mensaje generico, jamas se muestran', () => {
    ['ALGO_RARO', '', null, undefined, 42, { x: 1 }, '<script>alert(1)</script>', '__proto__', 'constructor'].forEach((c) => {
      expect(L.fotosModeracionLogic_mensajeError(c)).toBe(L.FOTOS_MODERACION_MENSAJE_GENERICO);
    });
  });

  test('ningun mensaje deja ver codigos, hojas ni errores raw', () => {
    ['INVALID_MOTIVO', 'INVALID_MOTIVO_TEXTO', 'PERMISSION_DENIED', 'FOTO_NOT_FOUND', 'SOLICITUD_ABIERTA', 'INVALID_TRANSITION', 'IDEMPOTENCY_CONFLICT', 'STORAGE_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'RED', 'ESTADO_NO_DERIVABLE', 'UNAUTHORIZED', 'USER_DISABLED', 'X'].forEach((c) => {
      expect(L.fotosModeracionLogic_mensajeError(c)).not.toMatch(/[A-Z]{3,}_[A-Z_]+|FotosPozoEventos|hoja|Error:|undefined|\[object/);
    });
  });

  test('esErrorDeSesion: solo UNAUTHORIZED y USER_DISABLED', () => {
    expect(L.fotosModeracionLogic_esErrorDeSesion('UNAUTHORIZED')).toBe(true);
    expect(L.fotosModeracionLogic_esErrorDeSesion('USER_DISABLED')).toBe(true);
    ['PERMISSION_DENIED', 'SERVICE_UNAVAILABLE', '', null, undefined].forEach((c) => expect(L.fotosModeracionLogic_esErrorDeSesion(c)).toBe(false));
  });
});

describe('detalle del motivo: validacion y limites', () => {
  const v = L.fotosModeracionLogic_validarContenido;

  test('el motivo es obligatorio y tiene que ser del catalogo', () => {
    ['', undefined, null, 'SPAM', 'duplicada', ' DUPLICADA'].forEach((c) => {
      expect(v(c, '')).toMatchObject({ valido: false, error: { campo: 'motivo', code: 'INVALID_MOTIVO' } });
    });
  });

  test('sin OTRO el detalle es opcional: vacio o solo espacios es valido', () => {
    ['', '   ', undefined, null, '\n\n'].forEach((t) => expect(v('DUPLICADA', t)).toMatchObject({ valido: true, texto: '', error: null }));
  });

  test('con OTRO el detalle es obligatorio', () => {
    ['', '  ', undefined].forEach((t) => expect(v('OTRO', t)).toMatchObject({ valido: false, error: { campo: 'detalle', code: 'INVALID_MOTIVO_TEXTO' } }));
    expect(v('OTRO', 'no es el pozo')).toMatchObject({ valido: true, texto: 'no es el pozo' });
  });

  test('limites 3..300 caracteres cuando existe (con y sin OTRO)', () => {
    ['DUPLICADA', 'OTRO'].forEach((c) => {
      expect(v(c, 'ab').valido).toBe(false);
      expect(v(c, 'abc').valido).toBe(true);
      expect(v(c, 'a'.repeat(300)).valido).toBe(true);
      expect(v(c, 'a'.repeat(301))).toMatchObject({ valido: false, error: { campo: 'detalle', code: 'INVALID_MOTIVO_TEXTO' } });
    });
  });

  test('el largo cuenta caracteres unicos (un emoji cuenta 1) y se normaliza igual que el backend', () => {
    expect(v('DUPLICADA', '\u{1F600}'.repeat(3)).valido).toBe(true);
    expect(v('DUPLICADA', '\u{1F600}'.repeat(300)).valido).toBe(true);
    expect(v('DUPLICADA', '\u{1F600}'.repeat(301)).valido).toBe(false);
    expect(v('DUPLICADA', '  hola  mundo  ').texto).toBe('hola  mundo');
    expect(v('DUPLICADA', 'a\r\nb').texto).toBe('a\nb');
  });

  test('el texto se conserva TAL CUAL (HTML, ampersand, multilinea): no se escapa ni se recorta el contenido', () => {
    const raro = '<img src=x onerror=alert(1)> & <script>1</script>\nsegunda linea';
    expect(v('OTRO', raro)).toMatchObject({ valido: true, texto: raro });
  });

  test('contador con palabras al pasarse del maximo', () => {
    expect(L.fotosModeracionLogic_textoContador(5)).toBe('5 / 300');
    expect(L.fotosModeracionLogic_textoContador(305)).toBe('305 / 300 · te pasaste por 5');
  });
});

describe('clientRequestId', () => {
  test('prefijos por accion y formato que acepta el backend', () => {
    const backend = require('../backend/src/FotosPozosModeracionService');
    const re = backend.FOTOS_MOD_CLIENT_REQUEST_ID_REGEX;
    expect(L.fotosModeracionLogic_nuevoClientRequestId('SUGERIR')).toMatch(/^foto-sol-[0-9a-f-]{36}$/);
    expect(L.fotosModeracionLogic_nuevoClientRequestId('RETIRAR')).toMatch(/^foto-ret-[0-9a-f-]{36}$/);
    expect(L.fotosModeracionLogic_nuevoClientRequestId('REPONER')).toMatch(/^foto-rep-[0-9a-f-]{36}$/);
    expect(L.fotosModeracionLogic_nuevoClientRequestId('RESOLVER')).toMatch(/^foto-res-[0-9a-f-]{36}$/);
    ['SUGERIR', 'RETIRAR', 'REPONER', 'RESOLVER'].forEach((t) => expect(L.fotosModeracionLogic_nuevoClientRequestId(t)).toMatch(re));
  });

  test('sin crypto.randomUUID cae a un id valido y distinto cada vez', () => {
    const real = global.crypto;
    Object.defineProperty(global, 'crypto', { value: undefined, configurable: true });
    try {
      const a = L.fotosModeracionLogic_nuevoClientRequestId('RETIRAR');
      const b = L.fotosModeracionLogic_nuevoClientRequestId('RETIRAR');
      expect(a).toMatch(/^foto-ret-[A-Za-z0-9_-]{8,}$/);
      expect(a.length).toBeLessThanOrEqual(64);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(global, 'crypto', { value: real, configurable: true });
    }
  });

  test('las acciones nunca comparten espacio de ids y una accion desconocida es un error de programacion', () => {
    const ids = ['SUGERIR', 'RETIRAR', 'REPONER'].map((t) => L.fotosModeracionLogic_nuevoClientRequestId(t).slice(0, 8));
    expect(new Set(ids).size).toBe(3);
    expect(() => L.fotosModeracionLogic_nuevoClientRequestId('BORRAR')).toThrow();
  });
});

describe('respuesta de una escritura', () => {
  const lee = L.fotosModeracionLogic_leerRespuestaEscritura;

  test('exito (duplicada true o false) de la foto esperada', () => {
    expect(lee(ok(), FOTO)).toEqual({ ok: true, duplicada: false, solicitudId: null });
    expect(lee(ok({ duplicada: true, solicitudId: 'sol-1' }), FOTO)).toEqual({ ok: true, duplicada: true, solicitudId: 'sol-1' });
    expect(lee(ok({ fotoId: FOTO.toUpperCase() }), FOTO).ok).toBe(true);
  });

  test('una respuesta de OTRA foto, sin forma o sin foto esperada no se da por buena', () => {
    [ok({ fotoId: OTRA }), null, undefined, 'ok', { status: 'ok' }, { status: 'ok', data: null }, { status: 'raro', data: { fotoId: FOTO } }, ok({ fotoId: 5 })].forEach((r) => {
      expect(lee(r, FOTO)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    });
    expect(lee(ok(), '')).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
  });

  test('un error del backend entrega su codigo (jamas su message)', () => {
    expect(lee(err('FOTO_NOT_FOUND'), FOTO)).toEqual({ ok: false, code: 'FOTO_NOT_FOUND' });
    expect(lee({ status: 'error' }, FOTO)).toEqual({ ok: false, code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(lee(err('X'), FOTO))).not.toContain('FotosPozoEventos');
  });
});

describe('vista del historial', () => {
  const evento = (extra) => Object.assign({ evento: 'RETIRADA', solicitudId: '', resolucion: '', motivoCodigo: 'DUPLICADA', motivoTexto: '', nombre: 'Marta', timestampUtc: '2026-10-27T15:00:00.000Z' }, extra || {});
  const data = (eventos, estado, foto) => ({
    foto: Object.assign({ fotoId: FOTO, entidadTipo: 'WELL', entidadId: '14-0001', tipoFoto: 'OTRA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' }, foto || {}),
    estado: Object.assign({ estado: 'RETIRADA', visible: false, solicitudAbierta: null, puedeReponerse: true, requiereRevisionBorrado: false, integridad: 'OK', origenRetiro: 'EVENTO', inconsistencias: [] }, estado || {}),
    eventos: eventos
  });
  const vista = L.fotosModeracionLogic_vistaHistorial;

  test('mantiene el orden recibido (mas reciente primero) y traduce cada evento a su etiqueta', () => {
    const v = vista(data([
      evento({ evento: 'REPUESTA', motivoCodigo: '', nombre: 'Ana', timestampUtc: '2026-10-27T18:00:00.000Z' }),
      evento({ evento: 'RETIRO_RESUELTO', resolucion: 'APROBADO', motivoCodigo: '', nombre: 'Luis', timestampUtc: '2026-10-27T17:00:00.000Z' }),
      evento({ evento: 'RETIRO_RESUELTO', resolucion: 'RECHAZADO', motivoCodigo: '', timestampUtc: '2026-10-27T16:00:00.000Z' }),
      evento({ evento: 'RETIRADA', motivoCodigo: 'PRIVACIDAD', timestampUtc: '2026-10-27T15:00:00.000Z' }),
      evento({ evento: 'RETIRO_SOLICITADO', motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara', timestampUtc: '2026-10-27T14:00:00.000Z' })
    ]), FOTO);
    expect(v.eventos.map((e) => e.titulo)).toEqual(['Foto repuesta', 'Retiro aprobado', 'Retiro rechazado', 'Foto retirada', 'Retiro sugerido']);
    expect(v.eventos[0]).toMatchObject({ nombre: 'Ana', fecha: '27/10/2026 15:00', motivo: '' });
    expect(v.eventos[3]).toMatchObject({ motivo: 'Privacidad', texto: '' });
    expect(v.eventos[4]).toMatchObject({ motivo: 'Otro', texto: 'se ve una cara' });
  });

  test('resumen de la foto con etiquetas humanas', () => {
    const v = vista(data([]), FOTO);
    expect(v).toMatchObject({ fotoId: FOTO, fecha: '06/2025', detalle: 'Carga de campo · Otra' });
    expect(v.estado).toMatchObject({ derivable: true, retirada: true, etiqueta: 'Foto retirada', pendienteBorrado: false, legacy: false });
  });

  test('solo se muestra el texto en solicitud y retiro, nunca en resoluciones ni reposiciones', () => {
    const v = vista(data([
      evento({ evento: 'RETIRO_RESUELTO', resolucion: 'APROBADO', motivoTexto: 'dato que no deberia mostrarse' }),
      evento({ evento: 'REPUESTA', motivoTexto: 'otro dato' })
    ]), FOTO);
    v.eventos.forEach((e) => expect(e.texto).toBe(''));
  });

  test('PRIVACIDAD retirada: pendiente de revision de borrado; solo con retiro vigente', () => {
    expect(vista(data([], { requiereRevisionBorrado: true }), FOTO).estado.pendienteBorrado).toBe(true);
    expect(vista(data([], { estado: 'ACTIVA', requiereRevisionBorrado: true, puedeReponerse: false }), FOTO).estado.pendienteBorrado).toBe(false);
    expect(vista(data([], { requiereRevisionBorrado: 'true' }), FOTO).estado.pendienteBorrado).toBe(false);
  });

  test('reposicion: solo una retirada por eventos con la senal del backend; una OCULTA legacy NO', () => {
    expect(vista(data([]), FOTO).puedeReponer).toBe(true);
    expect(vista(data([], { puedeReponerse: false }), FOTO).puedeReponer).toBe(false);
    expect(vista(data([], { origenRetiro: 'LEGACY_OCULTA', puedeReponerse: true }), FOTO).puedeReponer).toBe(false);
    expect(vista(data([], { origenRetiro: 'LEGACY_OCULTA', puedeReponerse: false }), FOTO).estado.legacy).toBe(true);
    expect(vista(data([], { estado: 'ACTIVA', puedeReponerse: true }), FOTO).puedeReponer).toBe(false);
    expect(vista(data([], { integridad: 'NO_DERIVABLE', estado: null, puedeReponerse: true }), FOTO)).toMatchObject({ puedeReponer: false, estado: { derivable: false, retirada: false } });
    expect(vista(data([], { puedeReponerse: 'true' }), FOTO).puedeReponer).toBe(false);
  });

  test('una solicitud abierta se informa; la foto activa dice que se ve en la galeria', () => {
    const v = vista(data([], { estado: 'ACTIVA', solicitudAbierta: { solicitudId: 'x', motivoCodigo: 'DUPLICADA' }, puedeReponerse: false }), FOTO);
    expect(v.estado).toMatchObject({ retirada: false, etiqueta: 'Visible en la galería', solicitudAbierta: true });
  });

  test('NADA tecnico: ni email, ni clientRequestId, ni secuencia, ni ids, ni codigos crudos', () => {
    const cruda = data([evento({ email: 'secreto@x.com', clientRequestId: 'foto-ret-abc', secuencia: 77, eventoId: 'ev-1', solicitudId: 'sol-9', motivoCodigo: 'MALA_CALIDAD' })]);
    cruda.estado.inconsistencias = ['SECUENCIA_DUPLICADA'];
    const v = vista(cruda, FOTO);
    const json = JSON.stringify(v);
    expect(json).not.toMatch(/secreto@x|clientRequestId|foto-ret-abc|secuencia|ev-1|sol-9|MALA_CALIDAD|RETIRADA|SECUENCIA_DUPLICADA|inconsistencias|entidad/);
    v.eventos.forEach((e) => expect(Object.keys(e).sort()).toEqual(['fecha', 'motivo', 'nombre', 'texto', 'titulo']));
  });

  test('un nombre que parece email o falta se muestra neutro', () => {
    const v = vista(data([evento({ nombre: 'alguien@x.com' }), evento({ nombre: '' }), evento({ nombre: null })]), FOTO);
    v.eventos.forEach((e) => { expect(e.nombre).toBe('Usuario'); });
  });

  test('XSS: el texto llega intacto (el controlador lo pinta con textContent)', () => {
    const xss = '<img src=x onerror=alert(1)>&amp;<script>x</script>\n\u{1F600}';
    const v = vista(data([evento({ evento: 'RETIRADA', motivoTexto: xss, nombre: '<b>Marta</b>' })]), FOTO);
    expect(v.eventos[0].texto).toBe(xss);
    expect(v.eventos[0].nombre).toBe('<b>Marta</b>');
  });

  test('vacio: sin eventos', () => {
    expect(vista(data([]), FOTO).eventos).toEqual([]);
  });

  test('datos de otra foto o sin la forma esperada -> null', () => {
    expect(vista(data([], {}, { fotoId: OTRA }), FOTO)).toBeNull();
    [null, undefined, {}, { foto: {}, estado: {}, eventos: {} }, { foto: { fotoId: FOTO }, estado: null, eventos: [] }, 'x'].forEach((d) => expect(vista(d, FOTO)).toBeNull());
    expect(vista(data([]), '')).toBeNull();
  });

  test('eventos que no son objetos se descartan', () => {
    expect(vista(data([null, 'x', evento()]), FOTO).eventos).toHaveLength(1);
  });
});

describe('historial: carga con descarte de respuestas viejas', () => {
  const MOD = { fotos: true, fotos_moderar: true };
  function armar(permisos) {
    const pendientes = [];
    const consultar = jest.fn(() => new Promise((res) => { pendientes.push(res); }));
    const cambios = [];
    const sesion = jest.fn();
    const h = L.fotosModeracionLogic_crearHistorial({
      obtenerContexto: () => ({ sessionToken: 'tok', permisos: permisos === undefined ? MOD : permisos }),
      consultar: consultar,
      onCambio: (e) => cambios.push(e),
      onSesionExpirada: sesion
    });
    return { h, pendientes, consultar, cambios, sesion };
  }
  const data = (foto) => ({ foto: { fotoId: foto || FOTO }, estado: { estado: 'ACTIVA', integridad: 'OK', puedeReponerse: false }, eventos: [] });

  test('sin fotos + fotos_moderar no se pide nada', async () => {
    for (const p of [{ fotos: true }, { fotos: true, fotos_carga: true }, { fotos_moderar: true }, { fotos: 'SI', fotos_moderar: 'SI' }, undefined]) {
      const t = armar(p === undefined ? {} : p);
      expect(await t.h.abrir(FOTO)).toBe(false);
      expect(t.consultar).not.toHaveBeenCalled();
      expect(t.h.estado().abierto).toBe(false);
    }
  });

  test('abre, muestra cargando y despues la vista', async () => {
    const t = armar();
    const abriendo = t.h.abrir(FOTO.toUpperCase());
    expect(t.h.estado()).toMatchObject({ abierto: true, cargando: true, fotoId: FOTO });
    expect(t.consultar).toHaveBeenCalledWith('tok', FOTO);
    t.pendientes[0]({ status: 'ok', data: data() });
    expect(await abriendo).toBe(true);
    expect(t.h.estado()).toMatchObject({ cargando: false, error: null });
    expect(t.h.estado().vista.fotoId).toBe(FOTO);
  });

  test('una respuesta vieja (otra foto abierta despues, o cerrada) se descarta', async () => {
    const t = armar();
    t.h.abrir(FOTO);
    t.h.abrir(OTRA);
    t.pendientes[0]({ status: 'ok', data: data(FOTO) });
    await flush();
    expect(t.h.estado().vista).toBeNull();
    t.pendientes[1]({ status: 'ok', data: data(OTRA) });
    await flush();
    expect(t.h.estado().vista.fotoId).toBe(OTRA);
    t.h.abrir(FOTO);
    t.h.cerrar();
    t.pendientes[2]({ status: 'ok', data: data(FOTO) });
    await flush();
    expect(t.h.estado()).toMatchObject({ abierto: false, vista: null });
  });

  test('errores: mensaje humano, nunca el raw; reintentar vuelve a pedir', async () => {
    const t = armar();
    t.h.abrir(FOTO);
    t.pendientes[0](err('SERVICE_UNAVAILABLE'));
    await flush();
    expect(t.h.estado().error).toMatchObject({ code: 'SERVICE_UNAVAILABLE', mensaje: 'No se pudo consultar la moderación de fotos. Intentá nuevamente.' });
    expect(JSON.stringify(t.h.estado())).not.toContain('FotosPozoEventos');
    t.h.reintentar();
    expect(t.consultar).toHaveBeenCalledTimes(2);
    t.pendientes[1]({ status: 'ok', data: data() });
    await flush();
    expect(t.h.estado()).toMatchObject({ error: null });
  });

  test('FOTO_NOT_FOUND y PERMISSION_DENIED tienen su mensaje; red caida tambien', async () => {
    const t = armar();
    t.h.abrir(FOTO);
    t.pendientes[0](err('FOTO_NOT_FOUND'));
    await flush();
    expect(t.h.estado().error.mensaje).toBe('La foto ya no está disponible.');
    const t2 = armar();
    t2.consultar.mockImplementationOnce(() => Promise.reject(new Error('fetch failed')));
    t2.h.abrir(FOTO);
    await flush();
    expect(t2.h.estado().error.code).toBe('RED');
  });

  test('UNAUTHORIZED / USER_DISABLED cierran la sesion (no es un error comun)', async () => {
    for (const code of ['UNAUTHORIZED', 'USER_DISABLED']) {
      const t = armar();
      t.h.abrir(FOTO);
      t.pendientes[0](err(code));
      await flush();
      expect(t.sesion).toHaveBeenCalledTimes(1);
    }
    const t = armar();
    t.h.abrir(FOTO);
    t.pendientes[0](err('SERVICE_UNAVAILABLE'));
    await flush();
    expect(t.sesion).not.toHaveBeenCalled();
  });

  test('una respuesta de otra foto no se muestra', async () => {
    const t = armar();
    t.h.abrir(FOTO);
    t.pendientes[0]({ status: 'ok', data: data(OTRA) });
    await flush();
    expect(t.h.estado().vista).toBeNull();
    expect(t.h.estado().error.code).toBe('SERVICE_UNAVAILABLE');
  });
});

describe('accion con envio: sugerir, retirar, reponer', () => {
  const SUG = { fotos: true, fotos_carga: true };
  const MOD = { fotos: true, fotos_moderar: true };
  const TODOS = { fotos: true, fotos_carga: true, fotos_moderar: true };
  const FOTO_GRILLA = { fotoId: FOTO, fuente: 'CAMPO_APP', tipoFoto: 'OTRA', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' };

  function armar(permisos, extra) {
    const ctx = { sessionToken: 'tok', permisos: permisos };
    const envios = [];
    const pendientes = [];
    let n = 0;
    const eventos = { exito: [], cambio: [], sesion: 0, estados: [] };
    const a = L.fotosModeracionLogic_crearAccion(Object.assign({
      obtenerContexto: () => ctx,
      enviar: (tipo, token, datos, id) => { envios.push({ tipo, token, datos: Object.assign({}, datos), id }); return new Promise((res) => { pendientes.push(res); }); },
      generarId: (tipo) => 'foto-' + tipo.slice(0, 3).toLowerCase() + '-id' + String(++n).padStart(8, '0'),
      onCambio: (e) => eventos.estados.push(e),
      onExito: (i) => eventos.exito.push(i),
      onEstadoCambiado: (i) => eventos.cambio.push(i),
      onSesionExpirada: () => { eventos.sesion += 1; }
    }, extra || {}));
    return { a, ctx, envios, pendientes, eventos };
  }

  describe('apertura y permisos', () => {
    test('solo se abre con el permiso de esa accion', () => {
      expect(armar(SUG).a.abrir('SUGERIR', FOTO_GRILLA)).toBe(true);
      expect(armar(SUG).a.abrir('RETIRAR', FOTO_GRILLA)).toBe(false);
      expect(armar(SUG).a.abrir('REPONER', FOTO_GRILLA)).toBe(false);
      expect(armar(MOD).a.abrir('SUGERIR', FOTO_GRILLA)).toBe(false);
      expect(armar(MOD).a.abrir('RETIRAR', FOTO_GRILLA)).toBe(true);
      expect(armar(MOD).a.abrir('REPONER', FOTO_GRILLA)).toBe(true);
      ['SUGERIR', 'RETIRAR', 'REPONER'].forEach((t) => expect(armar(TODOS).a.abrir(t, FOTO_GRILLA)).toBe(true));
      ['SUGERIR', 'RETIRAR', 'REPONER'].forEach((t) => expect(armar({ fotos: true }).a.abrir(t, FOTO_GRILLA)).toBe(false));
      ['SUGERIR', 'RETIRAR', 'REPONER'].forEach((t) => expect(armar({ fotos: 'SI', fotos_carga: 'SI', fotos_moderar: 'SI' }).a.abrir(t, FOTO_GRILLA)).toBe(false));
    });

    test('una foto sin id valido o un tipo desconocido no abre nada', () => {
      const t = armar(TODOS);
      expect(t.a.abrir('SUGERIR', null)).toBe(false);
      expect(t.a.abrir('SUGERIR', { fotoId: '' })).toBe(false);
      expect(t.a.abrir('BORRAR', FOTO_GRILLA)).toBe(false);
      expect(t.a.estado().abierto).toBe(false);
    });

    test('si el permiso se pierde con el modal abierto, enviar no manda nada', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.ctx.permisos = { fotos: true };
      const e = await t.a.guardar();
      expect(t.envios).toHaveLength(0);
      expect(e.error).toMatchObject({ code: 'PERMISSION_DENIED', mensaje: 'Ya no tenés permiso para realizar esta acción.' });
    });
  });

  describe('formulario', () => {
    test('sin motivo no se envia (error en el campo motivo)', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      expect(t.a.estado().puedeEnviar).toBe(false);
      const e = await t.a.guardar();
      expect(t.envios).toHaveLength(0);
      expect(e.error).toMatchObject({ campo: 'motivo', code: 'INVALID_MOTIVO' });
    });

    test('OTRO sin detalle no se envia; con detalle de 3..300 si', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('OTRO');
      expect(t.a.estado()).toMatchObject({ detalleObligatorio: true, puedeEnviar: false });
      expect((await t.a.guardar()).error).toMatchObject({ campo: 'detalle', code: 'INVALID_MOTIVO_TEXTO' });
      t.a.setDetalle('ab');
      expect(t.a.estado().puedeEnviar).toBe(false);
      t.a.setDetalle('abc');
      expect(t.a.estado().puedeEnviar).toBe(true);
      t.a.setDetalle('a'.repeat(301));
      expect(t.a.estado()).toMatchObject({ puedeEnviar: false, excede: true });
      expect(t.envios).toHaveLength(0);
    });

    test('motivo distinto de OTRO: detalle opcional', () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      expect(t.a.estado()).toMatchObject({ detalleObligatorio: false, puedeEnviar: true });
    });

    test('aviso de privacidad SOLO al retirar por PRIVACIDAD; nunca al sugerir ni con otro motivo', () => {
      const r = armar(TODOS);
      r.a.abrir('RETIRAR', FOTO_GRILLA);
      r.a.setCodigo('PRIVACIDAD');
      expect(r.a.estado().avisoPrivacidad).toBe(true);
      r.a.setCodigo('DUPLICADA');
      expect(r.a.estado().avisoPrivacidad).toBe(false);
      const s = armar(TODOS);
      s.a.abrir('SUGERIR', FOTO_GRILLA);
      s.a.setCodigo('PRIVACIDAD');
      expect(s.a.estado().avisoPrivacidad).toBe(false);
    });

    test('lo que viaja: foto, motivo y detalle normalizado; sin detalle no se manda el campo', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      expect(t.envios[0].datos).toEqual({ fotoId: FOTO, motivoCodigo: 'DUPLICADA', motivoTexto: undefined });
      const u = armar(SUG);
      u.a.abrir('SUGERIR', FOTO_GRILLA);
      u.a.setCodigo('OTRO');
      u.a.setDetalle('  no es   el pozo \r\n');
      u.a.guardar();
      expect(u.envios[0].datos).toEqual({ fotoId: FOTO, motivoCodigo: 'OTRO', motivoTexto: 'no es   el pozo' });
      expect(u.envios[0].token).toBe('tok');
    });

    test('la reposicion no lleva motivo', () => {
      const t = armar(MOD);
      t.a.abrir('REPONER', FOTO_GRILLA);
      expect(t.a.estado().puedeEnviar).toBe(true);
      t.a.guardar();
      expect(t.envios[0].datos).toEqual({ fotoId: FOTO });
      expect(t.envios[0].tipo).toBe('REPONER');
    });
  });

  describe('clientRequestId por intencion', () => {
    test('doble clic: un solo pedido mientras hay uno en vuelo', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.a.guardar();
      t.a.guardar();
      expect(t.envios).toHaveLength(1);
      expect(t.a.estado().enviando).toBe(true);
      expect(t.a.estado().puedeEnviar).toBe(false);
    });

    test('reintento del MISMO contenido tras un error recuperable usa el MISMO id', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err('SERVICE_UNAVAILABLE'));
      await flush();
      expect(t.a.estado().error.code).toBe('SERVICE_UNAVAILABLE');
      t.a.guardar();
      t.pendientes[1](err('SERVICE_UNAVAILABLE'));
      await flush();
      t.a.guardar();
      expect(t.envios.map((e) => e.id)).toEqual([t.envios[0].id, t.envios[0].id, t.envios[0].id]);
    });

    test('una red caida tambien es recuperable: mismo id', async () => {
      const t = armar(SUG, { enviar: undefined });
      const ctx = { sessionToken: 'tok', permisos: SUG };
      const ids = [];
      const a = L.fotosModeracionLogic_crearAccion({
        obtenerContexto: () => ctx,
        enviar: (tipo, token, datos, id) => { ids.push(id); return Promise.reject(new Error('fetch failed')); },
        generarId: (tipo) => 'foto-sol-' + ids.length + 'xxxxxxxx'
      });
      a.abrir('SUGERIR', FOTO_GRILLA);
      a.setCodigo('DUPLICADA');
      await a.guardar();
      expect(a.estado().error.code).toBe('RED');
      await a.guardar();
      expect(ids[0]).toBe(ids[1]);
    });

    test('si cambia el motivo o el detalle DESPUES de un intento: id nuevo; si vuelve al original, otro id nuevo', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err('SERVICE_UNAVAILABLE'));
      await flush();
      t.a.setCodigo('MALA_CALIDAD');
      t.a.guardar();
      t.pendientes[1](err('SERVICE_UNAVAILABLE'));
      await flush();
      t.a.setDetalle('con mas detalle');
      t.a.guardar();
      expect(new Set(t.envios.map((e) => e.id)).size).toBe(3);
    });

    test('cambiar el detalle solo en espacios o saltos (misma normalizacion) conserva el id', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('OTRO');
      t.a.setDetalle('no es el pozo');
      t.a.guardar();
      t.pendientes[0](err('SERVICE_UNAVAILABLE'));
      await flush();
      t.a.setDetalle('  no es el pozo  ');
      t.a.guardar();
      expect(t.envios[1].id).toBe(t.envios[0].id);
    });

    test('antes del primer intento editar no cambia el id', () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      const id = t.a.estado().clientRequestId;
      t.a.setCodigo('DUPLICADA');
      t.a.setCodigo('OTRO');
      t.a.setDetalle('algo corto');
      expect(t.a.estado().clientRequestId).toBe(id);
      t.a.guardar();
      expect(t.envios[0].id).toBe(id);
    });

    test('IDEMPOTENCY_CONFLICT / INVALID_CLIENT_REQUEST_ID: el id queda quemado; el siguiente envio usa uno nuevo (nunca solo)', async () => {
      for (const code of ['IDEMPOTENCY_CONFLICT', 'INVALID_CLIENT_REQUEST_ID']) {
        const t = armar(SUG);
        t.a.abrir('SUGERIR', FOTO_GRILLA);
        t.a.setCodigo('DUPLICADA');
        t.a.guardar();
        t.pendientes[0](err(code));
        await flush();
        expect(t.envios).toHaveLength(1);
        expect(t.a.estado().error.code).toBe(code);
        t.a.guardar();
        expect(t.envios).toHaveLength(2);
        expect(t.envios[1].id).not.toBe(t.envios[0].id);
      }
    });

    test('IDEMPOTENCY_CONFLICT muestra el mensaje de reintento', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err('IDEMPOTENCY_CONFLICT'));
      await flush();
      expect(t.a.estado().error.mensaje).toBe('La acción cambió después de un intento anterior. Revisá los datos e intentá nuevamente.');
    });

    test('abrir de nuevo (cancelar y reabrir, otra foto, tras un exito) siempre da un id nuevo; no se reutilizan ids entre acciones', async () => {
      const t = armar(TODOS);
      const ids = [];
      t.a.abrir('SUGERIR', FOTO_GRILLA); ids.push(t.a.estado().clientRequestId);
      t.a.cancelar();
      t.a.abrir('SUGERIR', FOTO_GRILLA); ids.push(t.a.estado().clientRequestId);
      t.a.abrir('SUGERIR', { fotoId: OTRA }); ids.push(t.a.estado().clientRequestId);
      t.a.abrir('RETIRAR', FOTO_GRILLA); ids.push(t.a.estado().clientRequestId);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](ok());
      await flush();
      t.a.abrir('RETIRAR', FOTO_GRILLA); ids.push(t.a.estado().clientRequestId);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('resultado', () => {
    test('exito: se cierra y avisa con los datos de la accion (una sugerencia NO oculta nada: eso lo decide quien escucha)', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('OTRO');
      t.a.setDetalle('no es el pozo');
      t.a.guardar();
      t.pendientes[0](ok({ solicitudId: 'sol-1' }));
      await flush();
      expect(t.a.estado().abierto).toBe(false);
      expect(t.eventos.exito).toEqual([{ tipo: 'SUGERIR', fotoId: FOTO, foto: FOTO_GRILLA, duplicada: false, solicitudId: 'sol-1', motivoCodigo: 'OTRO' }]);
    });

    test('un reintento idempotente (duplicada) tambien es exito', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](ok({ duplicada: true }));
      await flush();
      expect(t.eventos.exito[0].duplicada).toBe(true);
    });

    test('exito de OTRA foto o con forma rara no se aplica: queda abierto con error recuperable', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](ok({ fotoId: OTRA }));
      await flush();
      expect(t.eventos.exito).toHaveLength(0);
      expect(t.a.estado()).toMatchObject({ abierto: true, error: { code: 'SERVICE_UNAVAILABLE' } });
    });

    test.each([['FOTO_NOT_FOUND'], ['FOTO_YA_RETIRADA'], ['FOTO_NO_RETIRADA'], ['SOLICITUD_YA_RESUELTA'], ['INVALID_TRANSITION']])('%s: la foto ya no esta como se la veia -> se cierra y se avisa para refrescar la galeria', async (code) => {
      const t = armar(TODOS);
      t.a.abrir('RETIRAR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err(code));
      await flush();
      expect(t.a.estado().abierto).toBe(false);
      expect(t.eventos.cambio).toEqual([{ tipo: 'RETIRAR', fotoId: FOTO, foto: FOTO_GRILLA, code: code }]);
      expect(t.eventos.exito).toHaveLength(0);
    });

    test('SOLICITUD_YA_ABIERTA al sugerir: se cierra y se avisa (el backend rechaza la segunda sugerencia)', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err('SOLICITUD_YA_ABIERTA'));
      await flush();
      expect(t.a.estado().abierto).toBe(false);
      expect(t.eventos.cambio[0]).toMatchObject({ tipo: 'SUGERIR', code: 'SOLICITUD_YA_ABIERTA' });
    });

    test('SOLICITUD_ABIERTA al retirar: el moderador sigue en el modal con el mensaje (hasta E8-5 no hay como resolverla aca)', async () => {
      const t = armar(MOD);
      t.a.abrir('RETIRAR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err('SOLICITUD_ABIERTA'));
      await flush();
      expect(t.a.estado()).toMatchObject({ abierto: true, error: { mensaje: 'Esta foto ya tiene una solicitud de retiro pendiente.' } });
      expect(t.eventos.cambio).toHaveLength(0);
    });

    test.each([['PERMISSION_DENIED'], ['SERVICE_UNAVAILABLE'], ['REPOSICION_NO_PERMITIDA'], ['ESTADO_NO_DERIVABLE'], ['CODIGO_RARO']])('%s: error en el modal con mensaje humano, el texto se conserva', async (code) => {
      const t = armar(TODOS);
      t.a.abrir('RETIRAR', FOTO_GRILLA);
      t.a.setCodigo('OTRO');
      t.a.setDetalle('texto que no se pierde');
      t.a.guardar();
      t.pendientes[0](err(code));
      await flush();
      const e = t.a.estado();
      expect(e).toMatchObject({ abierto: true, enviando: false, detalle: 'texto que no se pierde' });
      expect(e.error.mensaje).toBe(L.fotosModeracionLogic_mensajeError(code));
      expect(JSON.stringify(e.error)).not.toContain('FotosPozoEventos');
    });

    test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: cierra la sesion global (una vez), no es un error comun de moderacion', async (code) => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.pendientes[0](err(code));
      await flush();
      expect(t.eventos.sesion).toBe(1);
      expect(t.eventos.cambio).toHaveLength(0);
    });

    test('una respuesta que llega despues de cancelar / reabrir / descartar no aplica nada', async () => {
      const t = armar(TODOS);
      t.a.abrir('RETIRAR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      t.a.descartar();
      t.pendientes[0](ok());
      await flush();
      expect(t.eventos.exito).toHaveLength(0);
      expect(t.a.estado().abierto).toBe(false);
      const u = armar(TODOS);
      u.a.abrir('RETIRAR', FOTO_GRILLA);
      u.a.setCodigo('DUPLICADA');
      u.a.guardar();
      u.a.abrir('SUGERIR', { fotoId: OTRA });
      u.pendientes[0](ok());
      await flush();
      expect(u.eventos.exito).toHaveLength(0);
      expect(u.a.estado()).toMatchObject({ abierto: true, tipo: 'SUGERIR' });
    });

    test('no se cancela mientras se envia; si, antes', () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      t.a.guardar();
      expect(t.a.cancelar()).toBe(false);
      expect(t.a.estado().abierto).toBe(true);
      const u = armar(SUG);
      u.a.abrir('SUGERIR', FOTO_GRILLA);
      expect(u.a.cancelar()).toBe(true);
      expect(u.a.estado().abierto).toBe(false);
    });

    test('el estado no guarda imagenes ni nada fuera de la foto de la grilla', async () => {
      const t = armar(SUG);
      t.a.abrir('SUGERIR', FOTO_GRILLA);
      t.a.setCodigo('DUPLICADA');
      expect(Object.keys(t.a.estado()).sort()).toEqual(['abierto', 'avisoPrivacidad', 'clientRequestId', 'codigo', 'contador', 'detalle', 'detalleObligatorio', 'enviando', 'error', 'excede', 'foto', 'largo', 'puedeEnviar', 'tipo', 'valido']);
    });
  });
});

describe('siguienteFoco', () => {
  test('rota dentro del modal y entra por el primero / ultimo', () => {
    expect(L.fotosModeracionLogic_siguienteFoco(0, -1, false)).toBe(-1);
    expect(L.fotosModeracionLogic_siguienteFoco(3, -1, false)).toBe(0);
    expect(L.fotosModeracionLogic_siguienteFoco(3, -1, true)).toBe(2);
    expect(L.fotosModeracionLogic_siguienteFoco(3, 2, false)).toBe(0);
    expect(L.fotosModeracionLogic_siguienteFoco(3, 0, true)).toBe(2);
    expect(L.fotosModeracionLogic_siguienteFoco(3, 1, false)).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// E8-5: estado de la solicitud y resolucion (aprobar / rechazar)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

describe('E8-5: ver el estado "Retiro sugerido" (puedeVerEstadoSolicitud)', () => {
  test('lo ve quien puede sugerir o moderar; un lector, fotos_carga sin fotos o valores truthy no', () => {
    expect(L.fotosModeracionLogic_puedeVerEstadoSolicitud({ fotos: true, fotos_carga: true })).toBe(true);
    expect(L.fotosModeracionLogic_puedeVerEstadoSolicitud({ fotos: true, fotos_moderar: true })).toBe(true);
    [{ fotos: true }, { fotos_carga: true }, { fotos_moderar: true }, { fotos: 'SI', fotos_carga: 'SI' }, { fotos: true, fotos_carga: 1 }, null, undefined].forEach((p) => {
      expect(L.fotosModeracionLogic_puedeVerEstadoSolicitud(p)).toBe(false);
    });
  });
  test('el texto para el moderador lo orienta hacia Fotos pendientes', () => {
    expect(L.FOTOS_MODERACION_MENSAJE_ESTADO_SUGERIDO).toBe('Retiro sugerido');
    expect(L.FOTOS_MODERACION_MENSAJE_SUGERIDO_MODERADOR).toBe('Retiro sugerido. Resolvelo desde Fotos pendientes.');
  });
});

describe('E8-5: aprobar y rechazar con la maquina de acciones', () => {
  const MOD = { fotos: true, fotos_moderar: true };
  const SOL = '33333333-3333-4333-8333-333333333333';
  const ITEM = { fotoId: FOTO, solicitudId: SOL, clave: SOL };
  const respRes = (resolucion, extra) => ({ status: 'ok', data: Object.assign({ fotoId: FOTO, duplicada: false, solicitudId: SOL, resolucion: resolucion }, extra || {}) });

  function armar(permisos, extra) {
    const ctx = { sessionToken: 'tok', permisos: permisos };
    const envios = [];
    const pendientes = [];
    const eventos = { exito: [], cambio: [], sesion: 0 };
    const a = L.fotosModeracionLogic_crearAccion(Object.assign({
      obtenerContexto: () => ctx,
      enviar: (tipo, token, datos, id) => { envios.push({ tipo, token, datos: Object.assign({}, datos), id }); return new Promise((res) => { pendientes.push(res); }); },
      onExito: (i) => eventos.exito.push(i),
      onEstadoCambiado: (i) => eventos.cambio.push(i),
      onSesionExpirada: () => { eventos.sesion += 1; }
    }, extra || {}));
    return { a, ctx, envios, pendientes, eventos };
  }

  test('solo fotos + fotos_moderar abren APROBAR / RECHAZAR; fotos_carga, solo fotos o truthy no', () => {
    ['APROBAR', 'RECHAZAR'].forEach((tipo) => {
      expect(armar(MOD).a.abrir(tipo, ITEM)).toBe(true);
      [{ fotos: true }, { fotos: true, fotos_carga: true }, { fotos_moderar: true }, { fotos: 'SI', fotos_moderar: 'SI' }, {}].forEach((p) => {
        expect(armar(p).a.abrir(tipo, ITEM)).toBe(false);
      });
      expect(L.fotosModeracionLogic_permitida(tipo, MOD)).toBe(true);
      expect(L.fotosModeracionLogic_permitida(tipo, { fotos: true, fotos_carga: true })).toBe(false);
    });
  });

  test('no se abre sin solicitud: la resolucion necesita solicitudId', () => {
    const t = armar(MOD);
    expect(t.a.abrir('APROBAR', { fotoId: FOTO })).toBe(false);
    expect(t.a.abrir('RECHAZAR', { fotoId: FOTO, solicitudId: '' })).toBe(false);
    expect(t.a.abrir('APROBAR', { fotoId: '', solicitudId: SOL })).toBe(false);
  });

  test('aprobar manda solicitudId + resolucion APROBADO (sin motivo) con id foto-res-<uuid>', async () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    expect(t.a.estado().puedeEnviar).toBe(true);
    t.a.guardar();
    expect(t.envios).toHaveLength(1);
    expect(t.envios[0]).toMatchObject({ tipo: 'APROBAR', token: 'tok', datos: { fotoId: FOTO, solicitudId: SOL, resolucion: 'APROBADO' } });
    expect(t.envios[0].datos).not.toHaveProperty('motivoCodigo');
    expect(t.envios[0].datos).not.toHaveProperty('motivoTexto');
    expect(t.envios[0].id).toMatch(/^foto-res-[0-9a-f-]{36}$/);
    t.pendientes[0](respRes('APROBADO'));
    await flush();
    expect(t.eventos.exito).toHaveLength(1);
    expect(t.eventos.exito[0]).toMatchObject({ tipo: 'APROBAR', fotoId: FOTO, duplicada: false });
    expect(t.a.estado().abierto).toBe(false);
  });

  test('rechazar manda resolucion RECHAZADO con id foto-res-<uuid>', async () => {
    const t = armar(MOD);
    t.a.abrir('RECHAZAR', ITEM);
    t.a.guardar();
    expect(t.envios[0].datos).toEqual({ fotoId: FOTO, solicitudId: SOL, resolucion: 'RECHAZADO' });
    expect(t.envios[0].id).toMatch(/^foto-res-[0-9a-f-]{36}$/);
    t.pendientes[0](respRes('RECHAZADO'));
    await flush();
    expect(t.eventos.exito[0].tipo).toBe('RECHAZAR');
  });

  test('el id es estable en el reintento tras un error recuperable y nuevo al cancelar y reabrir o tras un exito', async () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    t.pendientes[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    await flush();
    t.a.guardar();
    t.pendientes[1]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
    await flush();
    expect(t.envios[1].id).toBe(t.envios[0].id);
    t.a.guardar();
    expect(t.envios[2].id).toBe(t.envios[0].id);
    t.a.cancelar();
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    expect(t.envios[3].id).not.toBe(t.envios[0].id);
  });

  test('IDEMPOTENCY_CONFLICT quema el id: el siguiente envio usa otro (nunca se reenvia solo)', async () => {
    const t = armar(MOD);
    t.a.abrir('RECHAZAR', ITEM);
    t.a.guardar();
    t.pendientes[0]({ status: 'error', code: 'IDEMPOTENCY_CONFLICT' });
    await flush();
    expect(t.envios).toHaveLength(1);
    t.a.guardar();
    expect(t.envios[1].id).not.toBe(t.envios[0].id);
  });

  test('doble clic: un solo pedido mientras hay uno en vuelo', () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    t.a.guardar();
    t.a.guardar();
    expect(t.envios).toHaveLength(1);
    expect(t.a.estado().enviando).toBe(true);
    expect(t.a.cancelar()).toBe(false);
  });

  test('una respuesta de OTRA solicitud, o con otra resolucion, no se da por buena (queda abierto con error recuperable)', async () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    t.pendientes[0](respRes('RECHAZADO'));
    await flush();
    expect(t.eventos.exito).toHaveLength(0);
    expect(t.a.estado().abierto).toBe(true);
    expect(t.a.estado().error.code).toBe('SERVICE_UNAVAILABLE');
    t.a.guardar();
    t.pendientes[1](respRes('APROBADO', { solicitudId: '44444444-4444-4444-8444-444444444444' }));
    await flush();
    expect(t.eventos.exito).toHaveLength(0);
    t.a.guardar();
    t.pendientes[2](respRes('APROBADO'));
    await flush();
    expect(t.eventos.exito).toHaveLength(1);
  });

  test('un reintento idempotente (duplicada) tambien es exito', async () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    t.pendientes[0](respRes('APROBADO', { duplicada: true }));
    await flush();
    expect(t.eventos.exito[0].duplicada).toBe(true);
  });

  test.each([['SOLICITUD_YA_RESUELTA'], ['SOLICITUD_NOT_FOUND'], ['INVALID_TRANSITION'], ['FOTO_NOT_FOUND'], ['FOTO_YA_RETIRADA']])('%s al resolver: se cierra y se avisa que el estado cambio', async (code) => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.a.guardar();
    t.pendientes[0]({ status: 'error', code: code });
    await flush();
    expect(t.eventos.cambio).toEqual([{ tipo: 'APROBAR', fotoId: FOTO, foto: ITEM, code: code }]);
    expect(t.a.estado().abierto).toBe(false);
  });

  test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al resolver: cierre de sesion global, una vez', async (code) => {
    const t = armar(MOD);
    t.a.abrir('RECHAZAR', ITEM);
    t.a.guardar();
    t.pendientes[0]({ status: 'error', code: code });
    await flush();
    expect(t.eventos.sesion).toBe(1);
  });

  test('si el permiso se pierde con la confirmacion abierta, no se manda nada', async () => {
    const t = armar(MOD);
    t.a.abrir('APROBAR', ITEM);
    t.ctx.permisos = { fotos: true };
    await t.a.guardar();
    expect(t.envios).toHaveLength(0);
    expect(t.a.estado().error.code).toBe('PERMISSION_DENIED');
  });

  test('los prefijos de clientRequestId: cada accion con su espacio, todos validos para el backend', () => {
    const re = /^[A-Za-z0-9_-]{8,64}$/;
    const prefijo = (tipo) => L.fotosModeracionLogic_nuevoClientRequestId(tipo).replace(/-[0-9a-f-]{36}$/, '');
    expect(['SUGERIR', 'RETIRAR', 'REPONER', 'APROBAR', 'RECHAZAR'].map(prefijo)).toEqual(['foto-sol', 'foto-ret', 'foto-rep', 'foto-res', 'foto-res']);
    ['SUGERIR', 'RETIRAR', 'REPONER', 'APROBAR', 'RECHAZAR', 'RESOLVER'].forEach((t) => { expect(L.fotosModeracionLogic_nuevoClientRequestId(t)).toMatch(re); });
    expect(() => L.fotosModeracionLogic_nuevoClientRequestId('BORRAR')).toThrow();
    expect(() => L.fotosModeracionLogic_nuevoClientRequestId('toString')).toThrow();
  });

  test('leerRespuestaEscritura: sin `esperado` no exige solicitud; con `esperado` contrasta solicitud y resolucion', () => {
    expect(L.fotosModeracionLogic_leerRespuestaEscritura(respRes('APROBADO'), FOTO).ok).toBe(true);
    expect(L.fotosModeracionLogic_leerRespuestaEscritura(respRes('APROBADO'), FOTO, { solicitudId: SOL, resolucion: 'APROBADO' }).ok).toBe(true);
    expect(L.fotosModeracionLogic_leerRespuestaEscritura(respRes('APROBADO'), FOTO, { solicitudId: SOL.toUpperCase(), resolucion: 'APROBADO' }).ok).toBe(true);
    expect(L.fotosModeracionLogic_leerRespuestaEscritura(respRes('APROBADO'), FOTO, { solicitudId: SOL, resolucion: 'RECHAZADO' }).ok).toBe(false);
    expect(L.fotosModeracionLogic_leerRespuestaEscritura(respRes('APROBADO'), FOTO, { solicitudId: 'otra', resolucion: 'APROBADO' }).ok).toBe(false);
  });
});
