// E9-6: flujos con ESTADO de los ITF colaborativos (js/itfFlujosLogic.js) con dependencias falsas: el Perfil, proponer (reduccion, ids de intencion, doble toque, reintentos), Mis propuestas (retiro propio), la cola
// de pendientes, el visor con comparacion, el historial y el dialogo de aprobar / rechazar / retirar / restaurar. Cubre permisos exactos, respuestas viejas (tokens / generaciones), "nada se parcha: se vuelve a
// pedir", VIGENTE_CAMBIO sin reintento automatico y la forma exacta de lo que sale hacia la API (nunca email, actor ni campos de mas).
const L = require('./itfLogic');
Object.assign(global, L);
const F = require('./itfFlujosLogic');

const PROPONE = { perfil: true, perfil_subir: true };
const VALIDA = { perfil: true, perfil_validar: true };
const SOLO = { perfil: true };
const flush = async () => { for (let i = 0; i < 12; i += 1) { await Promise.resolve(); } };
const ok = (data) => ({ status: 'ok', data: data });
const err = (code) => ({ status: 'error', code: code });
const diferida = () => { let resolver; let rechazar; const promesa = new Promise((res, rej) => { resolver = res; rechazar = rej; }); return { promesa, resolver, rechazar }; };
const D = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

function ctxDe(permisos, extra) {
  const estado = { permisos: permisos, sessionToken: 'tok', vencida: 0 };
  const fn = () => Object.assign({ sessionToken: estado.sessionToken, permisos: estado.permisos, onSessionExpired: () => { estado.vencida += 1; } }, extra || {});
  fn.estado = estado;
  return fn;
}

// ---------------------------------------------------------------------------------------------------------
describe('Perfil: el ITF vigente al abrir', () => {
  const IMG = { mimeType: 'image/jpeg', imageBase64: 'QUJD', originalSizeBytes: 3 };
  function armar(permisos, cargar) {
    const snaps = [];
    const ctx = ctxDe(permisos || SOLO);
    const p = F.itfFlujos_crearPerfil({ obtenerContexto: ctx, cargar: cargar || jest.fn(() => Promise.resolve(ok(IMG))), onCambio: (s) => snaps.push(s) });
    return { p, ctx, snaps };
  }

  test('abrir: CARGANDO y despues LISTO con la imagen (data URI del tipo real); pide getProfile del pozo', async () => {
    const cargar = jest.fn(() => Promise.resolve(ok(IMG)));
    const { p, snaps } = armar(SOLO, cargar);
    const r = await p.abrir('14-0001');
    expect(snaps[0]).toMatchObject({ fase: 'CARGANDO', wellId: '14-0001' });
    expect(r).toMatchObject({ fase: 'LISTO', hayVigente: true, imagen: { mimeType: 'image/jpeg', dataUri: 'data:image/jpeg;base64,QUJD' } });
    expect(cargar).toHaveBeenCalledWith('tok', '14-0001');
  });

  test('un PNG aprobado llega como PNG (el tipo no se fuerza a jpeg)', async () => {
    const { p } = armar(SOLO, () => Promise.resolve(ok({ mimeType: 'image/png', imageBase64: 'QUJD' })));
    expect((await p.abrir('14-0001')).imagen.dataUri).toBe('data:image/png;base64,QUJD');
  });

  test('sin perfil === true no se pide nada', async () => {
    const cargar = jest.fn();
    const { p } = armar({ perfil_subir: true }, cargar);
    expect(await p.abrir('14-0001')).toMatchObject({ fase: 'ERROR', mensaje: 'No tenés permiso para hacer esto.' });
    expect(cargar).not.toHaveBeenCalled();
  });

  test('PROFILE_NOT_FOUND -> SIN_ITF con el mensaje pedido', async () => {
    const { p } = armar(SOLO, () => Promise.resolve(err('PROFILE_NOT_FOUND')));
    expect(await p.abrir('14-0009')).toMatchObject({ fase: 'SIN_ITF', mensaje: 'No hay un ITF vigente registrado para este pozo.', hayVigente: false, reintentable: false });
  });

  test('"no se sabe" (ITF_STATE_UNKNOWN) NO es "no hay ITF": es un error, sin reintento automatico', async () => {
    const { p } = armar(SOLO, () => Promise.resolve(err('ITF_STATE_UNKNOWN')));
    const r = await p.abrir('14-0001');
    expect(r.fase).toBe('ERROR');
    expect(r.mensaje).not.toBe('No hay un ITF vigente registrado para este pozo.');
    expect(r.reintentable).toBe(false);
  });

  test.each([['SERVICE_UNAVAILABLE'], ['ERROR']])('%s: error reintentable; reintentar vuelve a pedir y puede recuperarse', async (code) => {
    const cargar = jest.fn().mockResolvedValueOnce(err(code)).mockResolvedValueOnce(ok(IMG));
    const { p } = armar(SOLO, cargar);
    expect(await p.abrir('14-0001')).toMatchObject({ fase: 'ERROR', reintentable: true });
    expect(await p.reintentar()).toMatchObject({ fase: 'LISTO' });
    expect(cargar).toHaveBeenCalledTimes(2);
  });

  test('una caida de red (promesa rechazada) es un error reintentable, no un "no hay ITF"', async () => {
    const { p } = armar(SOLO, () => Promise.reject(new Error('fetch')));
    expect(await p.abrir('14-0001')).toMatchObject({ fase: 'ERROR', reintentable: true });
  });

  test('una imagen que no es JPEG/PNG o con base64 raro se rechaza (no llega a src)', async () => {
    for (const img of [{ mimeType: 'text/html', imageBase64: 'QUJD' }, { mimeType: 'image/jpeg', imageBase64: 'x"onerror=' }, { mimeType: 'image/jpeg' }]) {
      const { p } = armar(SOLO, () => Promise.resolve(ok(img)));
      const r = await p.abrir('14-0001');
      expect(r.fase).toBe('ERROR');
      expect(r.imagen).toBeNull();
    }
  });

  test('UNAUTHORIZED / USER_DISABLED: flujo global de sesion, sin mensaje propio', async () => {
    for (const code of ['UNAUTHORIZED', 'USER_DISABLED']) {
      const { p, ctx } = armar(SOLO, () => Promise.resolve(err(code)));
      await p.abrir('14-0001');
      expect(ctx.estado.vencida).toBe(1);
    }
  });

  test('respuesta VIEJA: abrir A y despues B; si A llega tarde NO pisa a B', async () => {
    const a = diferida();
    const b = diferida();
    const cargar = jest.fn().mockReturnValueOnce(a.promesa).mockReturnValueOnce(b.promesa);
    const { p } = armar(SOLO, cargar);
    p.abrir('14-0001');
    const pb = p.abrir('14-0002');
    b.resolver(ok({ mimeType: 'image/png', imageBase64: 'QkJC' }));
    await pb;
    a.resolver(ok(IMG));
    await flush();
    expect(p.snapshot()).toMatchObject({ wellId: '14-0002', imagen: { dataUri: 'data:image/png;base64,QkJC' } });
  });

  test('cerrar sesion (reset) mientras esta en vuelo: la respuesta no revive nada; no queda ninguna imagen', async () => {
    const a = diferida();
    const { p } = armar(SOLO, () => a.promesa);
    p.abrir('14-0001');
    p.reset();
    a.resolver(ok(IMG));
    await flush();
    expect(p.snapshot()).toMatchObject({ fase: 'VACIO', imagen: null, wellId: null });
  });

  test('refrescar (cambio el vigente): vuelve a pedir y mientras tanto NO se muestra la imagen anterior', async () => {
    const segunda = diferida();
    const cargar = jest.fn().mockResolvedValueOnce(ok(IMG)).mockReturnValueOnce(segunda.promesa);
    const { p } = armar(SOLO, cargar);
    await p.abrir('14-0001');
    p.refrescar();
    expect(p.snapshot()).toMatchObject({ fase: 'CARGANDO', imagen: null });
    segunda.resolver(ok({ mimeType: 'image/png', imageBase64: 'QkJC' }));
    await flush();
    expect(p.snapshot().imagen.mimeType).toBe('image/png');
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Proponer un ITF', () => {
  const ARCH = (extra) => Object.assign({ type: 'image/jpeg', size: 1500000, name: 'ITF escaneado.jpg' }, extra || {});
  const PREP = (extra) => Object.assign({ base64: 'QUJDREVG', bytes: 800000, mimeType: 'image/jpeg', ancho: 2400, alto: 1680, accion: 'REDUCIDA', previewUrl: 'blob:p1' }, extra || {});

  function armar(permisos, opc) {
    const o = opc || {};
    const ids = [];
    let n = 0;
    const deps = {
      obtenerContexto: ctxDe(permisos || PROPONE),
      preparar: o.preparar || jest.fn(() => Promise.resolve(PREP())),
      enviar: o.enviar || jest.fn(() => Promise.resolve(ok({ documentoId: D(1), wellId: '14-0001', estado: 'PROPUESTO', warnings: [] }))),
      nuevoId: jest.fn(() => { n += 1; const id = 'intento-' + String(n).padStart(4, '0'); ids.push(id); return id; }),
      liberarPreview: jest.fn(),
      onCambio: jest.fn(),
      alProponer: jest.fn()
    };
    return { f: F.itfFlujos_crearProponer(deps), deps, ids };
  }

  test.each([
    ['solo perfil', SOLO, false], ['perfil + validar', VALIDA, false], ['perfil_subir sin perfil', { perfil_subir: true }, false], ['truthy invalido', { perfil: 'SI', perfil_subir: 'SI' }, false],
    ['perfil + perfil_subir', PROPONE, true], ['los tres', { perfil: true, perfil_subir: true, perfil_validar: true }, true]
  ])('abrir con %s -> %s', (_n, permisos, esperado) => {
    const { f } = armar(permisos);
    expect(f.abrir('14-0001', false)).toBe(esperado);
    expect(f.snapshot().abierto).toBe(esperado);
  });

  test('el titulo depende de si hay vigente: "Proponer ITF" / "Proponer nueva versión" (nunca "Subir ITF definitivo")', () => {
    const { f } = armar();
    f.abrir('14-0001', false);
    expect(f.snapshot().titulo).toBe('Proponer ITF');
    f.abrir('14-0001', true);
    expect(f.snapshot().titulo).toBe('Proponer nueva versión');
    expect(JSON.stringify(f.snapshot())).not.toMatch(/definitivo/i);
  });

  test('archivo invalido (PDF, GIF, vacio, enorme): ERROR_ARCHIVO con el mensaje, SIN preparar ni enviar', async () => {
    const { f, deps } = armar();
    f.abrir('14-0001', false);
    for (const [archivo, texto] of [[ARCH({ type: 'application/pdf', name: 'a.pdf' }), 'Solo se aceptan imágenes JPEG o PNG.'], [ARCH({ size: 0 }), 'El archivo está vacío.'], [ARCH({ size: 50 * 1024 * 1024 }), /demasiado grande/]]) {
      await f.elegir(archivo);
      const s = f.snapshot();
      expect(s).toMatchObject({ fase: 'ERROR_ARCHIVO', puedeEnviar: false });
      expect(s.mensaje.tipo).toBe('error');
      expect(s.mensaje.texto).toMatch(texto);
    }
    expect(deps.preparar).not.toHaveBeenCalled();
    expect(deps.enviar).not.toHaveBeenCalled();
  });

  test('JPEG valido: PREPARANDO -> LISTO con preview, tamano final y dimensiones; el boton se habilita', async () => {
    const { f, deps } = armar();
    f.abrir('14-0001', false);
    const p = f.elegir(ARCH());
    expect(f.snapshot()).toMatchObject({ fase: 'PREPARANDO', preparando: true, puedeEnviar: false, nombre: 'ITF escaneado.jpg', tamanoOriginal: '1,4 MB' });
    await p;
    expect(f.snapshot()).toMatchObject({ fase: 'LISTO', puedeEnviar: true, preview: 'blob:p1', tamanoFinal: '781 KB', dimensiones: '2400 × 1680 px', accionImagen: 'REDUCIDA', textoBoton: 'Enviar propuesta' });
    expect(deps.preparar).toHaveBeenCalledTimes(1);
  });

  test('PNG valido tambien; el PNG conservado se ve como CONSERVADA', async () => {
    const { f } = armar(PROPONE, { preparar: jest.fn(() => Promise.resolve(PREP({ mimeType: 'image/png', accion: 'CONSERVADA' }))) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH({ type: 'image/png', name: 'a.png' }));
    expect(f.snapshot()).toMatchObject({ fase: 'LISTO', accionImagen: 'CONSERVADA' });
  });

  test('si NI reducida entra en el maximo del servidor: se BLOQUEA con mensaje claro (y el boton sigue deshabilitado)', async () => {
    const { f, deps } = armar(PROPONE, { preparar: jest.fn(() => Promise.resolve(PREP({ bytes: 4 * 1024 * 1024 }))) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    const s = f.snapshot();
    expect(s).toMatchObject({ fase: 'ERROR_ARCHIVO', puedeEnviar: false });
    expect(s.mensaje.texto).toMatch(/4 MB aun reducida \(máximo 3 MB\)/);
    await f.enviar();
    expect(deps.enviar).not.toHaveBeenCalled();
  });

  test('si no se puede abrir la imagen: ERROR_ARCHIVO con el mensaje del pipeline', async () => {
    const { f } = armar(PROPONE, { preparar: jest.fn(() => Promise.reject(Object.assign(new Error('DECODIFICAR'), { mensaje: 'No se pudo abrir la imagen. Probá con otra.' }))) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    expect(f.snapshot()).toMatchObject({ fase: 'ERROR_ARCHIVO', preview: null, mensaje: { texto: 'No se pudo abrir la imagen. Probá con otra.' } });
  });

  test('enviar: el payload lleva SOLO wellId, imageBase64, mimeType, nombreOriginal y clientRequestId (nunca email, actor, hash, estado ni documentoId)', async () => {
    const { f, deps } = armar();
    f.abrir('14-0001', true);
    await f.elegir(ARCH());
    await f.enviar();
    expect(deps.enviar).toHaveBeenCalledTimes(1);
    const [token, payload] = deps.enviar.mock.calls[0];
    expect(token).toBe('tok');
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'imageBase64', 'mimeType', 'nombreOriginal', 'wellId']);
    expect(payload).toMatchObject({ wellId: '14-0001', imageBase64: 'QUJDREVG', mimeType: 'image/jpeg', nombreOriginal: 'ITF escaneado.jpg' });
    expect(payload.clientRequestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  test('exito: "ITF propuesto. Queda pendiente de validación." (jamas dice que ya es vigente), libera el preview y avisa', async () => {
    const { f, deps } = armar();
    f.abrir('14-0001', true);
    await f.elegir(ARCH());
    await f.enviar();
    const s = f.snapshot();
    expect(s).toMatchObject({ fase: 'ENVIADO', enviado: true, preview: null, puedeEnviar: false, mensaje: { texto: 'ITF propuesto. Queda pendiente de validación.', tipo: 'ok' } });
    expect(s.mensaje.texto).not.toMatch(/vigente|aprobad/i);
    expect(deps.liberarPreview).toHaveBeenCalledWith('blob:p1');
    expect(deps.alProponer).toHaveBeenCalledWith(expect.objectContaining({ documentoId: D(1), estado: 'PROPUESTO' }));
  });

  test('DOBLE TOQUE: mientras hay un envio en vuelo, otro toque devuelve la misma promesa y NO envia de nuevo', async () => {
    const e = diferida();
    const { f, deps } = armar(PROPONE, { enviar: jest.fn(() => e.promesa) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    const a = f.enviar();
    const b = f.enviar();
    expect(b).toBe(a);
    expect(f.snapshot()).toMatchObject({ fase: 'ENVIANDO', enviando: true, puedeEnviar: false, textoBoton: 'Enviando…' });
    e.resolver(ok({ documentoId: D(1) }));
    await a;
    expect(deps.enviar).toHaveBeenCalledTimes(1);
    await f.enviar();                                     // ya enviada: no se vuelve a mandar
    expect(deps.enviar).toHaveBeenCalledTimes(1);
  });

  test('REINTENTO con el MISMO clientRequestId: un fallo transitorio deja reintentar y el id NO cambia', async () => {
    const enviar = jest.fn().mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(ok({ documentoId: D(1) }));
    const { f, ids } = armar(PROPONE, { enviar });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    await f.enviar();
    expect(f.snapshot()).toMatchObject({ fase: 'ERROR_ENVIO', puedeEnviar: true, textoBoton: 'Reintentar envío' });
    expect(f.snapshot().mensaje.tipo).toBe('error');
    await f.enviar();
    expect(f.snapshot().fase).toBe('ERROR_ENVIO');
    await f.enviar();
    expect(f.snapshot().fase).toBe('ENVIADO');
    const usados = enviar.mock.calls.map((c) => c[1].clientRequestId);
    expect(usados).toHaveLength(3);
    expect(new Set(usados).size).toBe(1);
    expect(ids).toHaveLength(1);                           // se genero UN solo id para toda la intencion
  });

  test('un archivo NUEVO es una intencion nueva: id nuevo', async () => {
    const enviar = jest.fn(() => Promise.resolve(err('SERVICE_UNAVAILABLE')));
    const { f } = armar(PROPONE, { enviar });
    f.abrir('14-0001', false);
    await f.elegir(ARCH({ name: 'a.jpg' }));
    await f.enviar();
    await f.elegir(ARCH({ name: 'b.jpg' }));
    await f.enviar();
    const [a, b] = enviar.mock.calls.map((c) => c[1].clientRequestId);
    expect(a).not.toBe(b);
  });

  test('errores definitivos tambien dejan reintentar con el mismo id (el servidor es idempotente); cada uno con su mensaje', async () => {
    for (const [code, texto] of [['DUPLICADO_DOCUMENTO', /ya fue propuesto/], ['TOO_MANY_PENDING', /demasiadas propuestas pendientes/], ['POZO_NOT_FOUND', /no figura/], ['ITF_E9_INACTIVO', /todavía no están habilitadas/], ['PERMISSION_DENIED', /No tenés permiso/]]) {
      const { f } = armar(PROPONE, { enviar: jest.fn(() => Promise.resolve(err(code))) });
      f.abrir('14-0001', false);
      await f.elegir(ARCH());
      await f.enviar();
      expect(f.snapshot().mensaje.texto).toMatch(texto);
      expect(f.snapshot().fase).toBe('ERROR_ENVIO');
    }
  });

  test('IDEMPOTENCY_CONFLICT: el id quedo ligado a otro contenido -> hay que volver a elegir el archivo (id nuevo)', async () => {
    const { f } = armar(PROPONE, { enviar: jest.fn(() => Promise.resolve(err('IDEMPOTENCY_CONFLICT'))) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    await f.enviar();
    expect(f.snapshot()).toMatchObject({ fase: 'VACIO', puedeEnviar: false, preview: null });
    expect(f.snapshot().mensaje.texto).toMatch(/Volvé a elegir el archivo/);
  });

  test('sesion vencida al enviar: flujo global, sin mensaje propio', async () => {
    const ctx = ctxDe(PROPONE);
    const f = F.itfFlujos_crearProponer({ obtenerContexto: ctx, preparar: () => Promise.resolve(PREP()), enviar: () => Promise.resolve(err('UNAUTHORIZED')), nuevoId: () => 'intento-0001', liberarPreview: () => {}, onCambio: () => {} });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    await f.enviar();
    expect(ctx.estado.vencida).toBe(1);
  });

  test('permiso revocado entre elegir y enviar: no se envia', async () => {
    const { f, deps } = armar();
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    deps.obtenerContexto.estado.permisos = { perfil: true };
    await f.enviar();
    expect(deps.enviar).not.toHaveBeenCalled();
    expect(f.snapshot().mensaje.texto).toMatch(/No tenés permiso/);
  });

  test('preparacion VIEJA: elegir A y despues B; el resultado de A llega tarde, NO pisa a B y su preview se libera', async () => {
    const a = diferida();
    const b = diferida();
    const preparar = jest.fn().mockReturnValueOnce(a.promesa).mockReturnValueOnce(b.promesa);
    const { f, deps } = armar(PROPONE, { preparar });
    f.abrir('14-0001', false);
    const pa = f.elegir(ARCH({ name: 'a.jpg' }));
    const pb = f.elegir(ARCH({ name: 'b.jpg' }));
    b.resolver(PREP({ previewUrl: 'blob:b' }));
    await pb;
    a.resolver(PREP({ previewUrl: 'blob:a' }));
    await pa;
    expect(f.snapshot()).toMatchObject({ nombre: 'b.jpg', preview: 'blob:b', fase: 'LISTO' });
    expect(deps.liberarPreview).toHaveBeenCalledWith('blob:a');
  });

  test('cerrar el panel / cerrar sesion libera el preview y descarta lo que este en vuelo', async () => {
    const e = diferida();
    const { f, deps } = armar(PROPONE, { enviar: jest.fn(() => e.promesa) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    f.enviar();
    f.reset();
    e.resolver(ok({ documentoId: D(1) }));
    await flush();
    expect(f.snapshot()).toMatchObject({ abierto: false, fase: 'VACIO', preview: null });
    expect(deps.alProponer).not.toHaveBeenCalled();
    expect(deps.liberarPreview).toHaveBeenCalledWith('blob:p1');
  });

  test('no se puede elegir otro archivo mientras se envia', async () => {
    const e = diferida();
    const { f, deps } = armar(PROPONE, { enviar: jest.fn(() => e.promesa) });
    f.abrir('14-0001', false);
    await f.elegir(ARCH());
    f.enviar();
    await f.elegir(ARCH({ name: 'otro.jpg' }));
    expect(deps.preparar).toHaveBeenCalledTimes(1);
    e.resolver(ok({ documentoId: D(1) }));
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Mis propuestas y retiro de la propia propuesta', () => {
  const item = (n, extra) => Object.assign({ documentoId: D(n), wellId: '14-000' + (n % 3), estado: 'PROPUESTO', esVigente: false, puedeRetirar: true, mimeType: 'image/jpeg', bytes: 500000, nombreOriginal: 'itf' + n + '.jpg', timestampUtc: '2026-10-28T15:20:00.000Z', decididoEn: null, retiradaPorMi: false, motivoCodigo: null, motivoTexto: null }, extra || {});

  function armar(permisos, opc) {
    const o = opc || {};
    let n = 0;
    const deps = {
      obtenerContexto: ctxDe(permisos || PROPONE),
      consultar: o.consultar || jest.fn(() => Promise.resolve(ok({ items: [item(1), item(2, { estado: 'RECHAZADO', puedeRetirar: false, motivoCodigo: 'ILEGIBLE', decididoEn: '2026-10-29T10:00:00.000Z' })], siguienteCursor: null, total: 2, incompleta: false }))),
      retirar: o.retirar || jest.fn(() => Promise.resolve(ok({ documentoId: D(1), evento: 'ITF_RETIRADO', reintento: false }))),
      nuevoId: jest.fn(() => { n += 1; return 'retiro-' + String(n).padStart(4, '0'); }),
      onCambio: jest.fn(),
      alRetirar: jest.fn()
    };
    return { m: F.itfFlujos_crearMisPropuestas(deps), deps };
  }

  test.each([['solo perfil', SOLO], ['perfil + validar', VALIDA], ['sin permisos', {}]])('%s: no se pide nada', async (_n, permisos) => {
    const { m, deps } = armar(permisos);
    const r = await m.abrir('14-0001');
    expect(r.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.consultar).not.toHaveBeenCalled();
  });

  test('abrir pide las de ESTE pozo (el filtro lo hace el servidor) y arma las filas con copy humano', async () => {
    const { m, deps } = armar();
    const s = await m.abrir('14-0001');
    expect(deps.consultar).toHaveBeenCalledWith('tok', '14-0001', 20, undefined);
    expect(s.items[0]).toMatchObject({ estado: 'PROPUESTO', textoEstado: 'Pendiente de validación', puedeRetirar: true, nombre: 'itf1.jpg', tamano: '488 KB', enviadaEl: '28/10/2026 12:20', motivo: '' });
    expect(s.items[1]).toMatchObject({ estado: 'RECHAZADO', textoEstado: 'Rechazada', puedeRetirar: false, motivo: 'No se puede leer', decididaEl: '29/10/2026 07:00' });
    expect(JSON.stringify(s)).not.toMatch(/@|storage|sha256|clientRequestId/);
  });

  test('"todos los pozos" pide SIN wellId; cambiar de alcance vuelve a pedir desde cero', async () => {
    const { m, deps } = armar();
    await m.abrir('14-0001');
    await m.cambiarAlcance('TODOS');
    expect(deps.consultar).toHaveBeenLastCalledWith('tok', null, 20, undefined);
    expect(m.snapshot().alcance).toBe('TODOS');
    await m.cambiarAlcance('TODOS');                       // sin cambio: no vuelve a pedir
    expect(deps.consultar).toHaveBeenCalledTimes(2);
    await m.cambiarAlcance('RARO');
    expect(deps.consultar).toHaveBeenCalledTimes(2);
  });

  test('vacia / error / reintento', async () => {
    const consultar = jest.fn().mockResolvedValueOnce(ok({ items: [], siguienteCursor: null, total: 0, incompleta: false })).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok({ items: [item(1)], siguienteCursor: null, total: 1 }));
    const { m } = armar(PROPONE, { consultar });
    expect((await m.abrir('14-0001')).vacia).toBe(true);
    const e = await m.recargar();
    expect(e.error).toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(e.vacia).toBe(false);
    expect((await m.recargar()).items).toHaveLength(1);
  });

  test('"Ver más": sigue desde el cursor y no repite documentos; un error al cargar mas no borra lo ya cargado', async () => {
    const consultar = jest.fn()
      .mockResolvedValueOnce(ok({ items: [item(1), item(2)], siguienteCursor: 's1:5', total: 3 }))
      .mockResolvedValueOnce(err('SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce(ok({ items: [item(2), item(3)], siguienteCursor: null, total: 3 }));
    const { m } = armar(PROPONE, { consultar });
    await m.abrir('14-0001');
    const fallo = await m.verMas();
    expect(fallo.errorMas).toMatch(/No se pudo completar/);
    expect(fallo.items).toHaveLength(2);
    expect(fallo.hayMas).toBe(true);
    const final = await m.verMas();
    expect(consultar).toHaveBeenLastCalledWith('tok', '14-0001', 20, 's1:5');
    expect(final.items.map((i) => i.documentoId)).toEqual([D(1), D(2), D(3)]);
    expect(final.hayMas).toBe(false);
  });

  test('respuesta VIEJA al cambiar de alcance no pisa la nueva', async () => {
    const a = diferida();
    const consultar = jest.fn().mockReturnValueOnce(Promise.resolve(ok({ items: [item(1)], siguienteCursor: null, total: 1 }))).mockReturnValueOnce(a.promesa).mockReturnValueOnce(Promise.resolve(ok({ items: [item(7)], siguienteCursor: null, total: 1 })));
    const { m } = armar(PROPONE, { consultar });
    await m.abrir('14-0001');
    m.cambiarAlcance('TODOS');
    await m.cambiarAlcance('POZO');
    a.resolver(ok({ items: [item(9)], siguienteCursor: null, total: 1 }));
    await flush();
    expect(m.snapshot().items.map((i) => i.documentoId)).toEqual([D(7)]);
  });

  test('retiro: solo de una propuesta que se puede retirar; pide confirmacion con un id de intencion', async () => {
    const { m } = armar();
    await m.abrir('14-0001');
    expect(m.pedirRetiro(D(2))).toBe(false);               // rechazada: no hay accion
    expect(m.pedirRetiro(D(99))).toBe(false);
    expect(m.snapshot().retiro).toBeNull();
    expect(m.pedirRetiro(D(1))).toBe(true);
    expect(m.snapshot().retiro).toEqual({ documentoId: D(1), enviando: false, error: null });
    expect(m.pedirRetiro(D(1))).toBe(false);               // ya hay una confirmacion abierta
    m.cancelarRetiro();
    expect(m.snapshot().retiro).toBeNull();
  });

  test('confirmar el retiro: payload exacto (documentoId + clientRequestId), la lista se VUELVE A PEDIR y el aviso aparece', async () => {
    const consultar = jest.fn()
      .mockResolvedValueOnce(ok({ items: [item(1)], siguienteCursor: null, total: 1 }))
      .mockResolvedValueOnce(ok({ items: [item(1, { estado: 'RETIRADO', puedeRetirar: false, retiradaPorMi: true })], siguienteCursor: null, total: 1 }));
    const { m, deps } = armar(PROPONE, { consultar });
    await m.abrir('14-0001');
    m.pedirRetiro(D(1));
    const s = await m.confirmarRetiro();
    expect(deps.retirar).toHaveBeenCalledTimes(1);
    expect(deps.retirar).toHaveBeenCalledWith('tok', { documentoId: D(1), clientRequestId: 'retiro-0001' });
    expect(consultar).toHaveBeenCalledTimes(2);
    expect(s.retiro).toBeNull();
    expect(s.aviso).toEqual({ texto: 'Propuesta retirada.', error: false });
    expect(s.items[0]).toMatchObject({ estado: 'RETIRADO', puedeRetirar: false, motivo: 'Retirada por vos' });
    expect(deps.alRetirar).toHaveBeenCalledTimes(1);
  });

  test('doble toque en confirmar: un solo retiro; y un fallo transitorio se reintenta con el MISMO id', async () => {
    const e = diferida();
    const retirar = jest.fn().mockReturnValueOnce(e.promesa).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok({ documentoId: D(1) }));
    const { m } = armar(PROPONE, { retirar });
    await m.abrir('14-0001');
    m.pedirRetiro(D(1));
    const a = m.confirmarRetiro();
    const b = m.confirmarRetiro();
    expect(b).toBe(a);
    e.resolver(err('SERVICE_UNAVAILABLE'));
    await a;
    expect(retirar).toHaveBeenCalledTimes(1);
    expect(m.snapshot().retiro).toMatchObject({ enviando: false, error: expect.stringMatching(/No se pudo completar/) });
    await m.confirmarRetiro();
    await m.confirmarRetiro();
    const ids = retirar.mock.calls.map((c) => c[1].clientRequestId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
  });

  test('si la propuesta ya no estaba pendiente (la resolvio otra persona): se cierra la confirmacion y se actualiza la lista', async () => {
    const consultar = jest.fn().mockResolvedValueOnce(ok({ items: [item(1)], siguienteCursor: null, total: 1 })).mockResolvedValue(ok({ items: [item(1, { estado: 'RECHAZADO', puedeRetirar: false })], siguienteCursor: null, total: 1 }));
    const { m } = armar(PROPONE, { consultar, retirar: jest.fn(() => Promise.resolve(err('DOCUMENTO_NO_PROPUESTO'))) });
    await m.abrir('14-0001');
    m.pedirRetiro(D(1));
    const s = await m.confirmarRetiro();
    expect(s.retiro).toBeNull();
    expect(s.aviso.texto).toMatch(/ya no estaba pendiente/);
    expect(consultar).toHaveBeenCalledTimes(2);
  });

  test('permiso revocado al confirmar: no se retira', async () => {
    const { m, deps } = armar();
    await m.abrir('14-0001');
    m.pedirRetiro(D(1));
    deps.obtenerContexto.estado.permisos = { perfil: true };
    await m.confirmarRetiro();
    expect(deps.retirar).not.toHaveBeenCalled();
    expect(m.snapshot().retiro.error).toMatch(/No tenés permiso/);
  });

  test('cerrar sesion (reset): nada queda ni se revive con una respuesta tardia', async () => {
    const a = diferida();
    const { m } = armar(PROPONE, { consultar: jest.fn(() => a.promesa) });
    m.abrir('14-0001');
    m.reset();
    a.resolver(ok({ items: [item(1)], siguienteCursor: null, total: 1 }));
    await flush();
    expect(m.snapshot()).toMatchObject({ abierto: false, items: [], retiro: null });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Cola de ITF pendientes', () => {
  const pend = (n, extra) => Object.assign({ documentoId: D(n), wellId: '14-000' + (n % 5), mimeType: 'image/jpeg', bytes: 700000, nombreOriginal: 'itf' + n + '.jpg', nombreProponente: 'Ana ' + n, timestampUtc: '2026-10-28T15:20:00.000Z', autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, warningMensaje: null }, extra || {});
  const pagina = (items, cursor, total) => ok({ items: items, siguienteCursor: cursor || null, total: total === undefined ? items.length : total, pozosSinDerivar: 0 });

  function armar(permisos, consultar) {
    const deps = { obtenerContexto: ctxDe(permisos || VALIDA), consultar: consultar || jest.fn(() => Promise.resolve(pagina([pend(1), pend(2)]))), onCambio: jest.fn() };
    return { c: F.itfFlujos_crearCola(deps), deps };
  }

  test.each([['solo perfil', SOLO], ['perfil + subir (proponer no es validar)', PROPONE], ['perfil_validar sin perfil', { perfil_validar: true }], ['truthy invalido', { perfil: true, perfil_validar: 'SI' }], ['sin permisos', {}]])('%s: PERMISSION_DENIED y NO se pide nada', async (_n, permisos) => {
    const { c, deps } = armar(permisos);
    const s = await c.abrir();
    expect(s.error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.consultar).not.toHaveBeenCalled();
  });

  test('abrir: primera pagina (20), tarjetas con pozo, archivo, tamano, proponente y fecha; sin email ni ids internos', async () => {
    const { c, deps } = armar();
    const s = await c.abrir();
    expect(deps.consultar).toHaveBeenCalledWith('tok', 20, undefined);
    expect(s.items[0]).toEqual({ documentoId: D(1), wellId: '14-0001', nombreArchivo: 'itf1.jpg', tamano: '684 KB', proponente: 'Ana 1', enviadaEl: '28/10/2026 12:20', propia: false, advertencia: '' });
    expect(JSON.stringify(s)).not.toMatch(/@|storage|sha256|clientRequestId|secuencia/);
    expect(s.total).toBe(2);
  });

  test('warning de "mismo archivo en otro pozo" con el mensaje del servidor, y la propuesta propia se marca sin alarma', async () => {
    const { c } = armar(VALIDA, jest.fn(() => Promise.resolve(pagina([pend(1, { warningDuplicadoOtroPozo: true, warningMensaje: 'Este mismo archivo aparece asociado a otro pozo.' }), pend(2, { autoPropuestaPropia: true })]))));
    const s = await c.abrir();
    expect(s.items[0].advertencia).toBe('Este mismo archivo aparece asociado a otro pozo.');
    expect(s.items[1]).toMatchObject({ propia: true, advertencia: '' });
  });

  test('vacia, error y reintento', async () => {
    const consultar = jest.fn().mockResolvedValueOnce(pagina([])).mockRejectedValueOnce(new Error('red')).mockResolvedValueOnce(pagina([pend(1)]));
    const { c } = armar(VALIDA, consultar);
    expect((await c.abrir()).vacia).toBe(true);
    expect((await c.recargar()).error).toMatchObject({ code: 'RED' });
    expect((await c.recargar()).items).toHaveLength(1);
  });

  test('paginacion: "Ver más" desde el cursor, sin duplicados; un error al cargar mas conserva lo cargado', async () => {
    const consultar = jest.fn()
      .mockResolvedValueOnce(pagina([pend(1), pend(2)], 's1:10', 5))
      .mockResolvedValueOnce(err('SERVICE_UNAVAILABLE'))
      .mockResolvedValueOnce(pagina([pend(2), pend(3), pend(4)], null, 5));
    const { c } = armar(VALIDA, consultar);
    await c.abrir();
    expect((await c.verMas()).errorMas).toBeTruthy();
    const s = await c.verMas();
    expect(consultar).toHaveBeenLastCalledWith('tok', 20, 's1:10');
    expect(s.items.map((i) => i.documentoId)).toEqual([D(1), D(2), D(3), D(4)]);
    expect(s.hayMas).toBe(false);
    await c.verMas();
    expect(consultar).toHaveBeenCalledTimes(3);            // sin mas paginas: no vuelve a pedir
  });

  test('doble "Ver más": una sola pagina en vuelo', async () => {
    const e = diferida();
    const consultar = jest.fn().mockResolvedValueOnce(pagina([pend(1)], 's1:10', 3)).mockReturnValueOnce(e.promesa);
    const { c } = armar(VALIDA, consultar);
    await c.abrir();
    c.verMas();
    c.verMas();
    expect(consultar).toHaveBeenCalledTimes(2);
    e.resolver(pagina([pend(2)], null, 3));
  });

  test('respuesta VIEJA: recargar mientras una carga esta en vuelo; la anterior NO pisa a la nueva', async () => {
    const a = diferida();
    const consultar = jest.fn().mockReturnValueOnce(a.promesa).mockResolvedValueOnce(pagina([pend(7)]));
    const { c } = armar(VALIDA, consultar);
    c.abrir();
    await c.recargar();
    a.resolver(pagina([pend(9)]));
    await flush();
    expect(c.snapshot().items.map((i) => i.documentoId)).toEqual([D(7)]);
  });

  test('recargar parte de CERO: mientras se vuelve a pedir no queda la lista vieja (ni cursor)', async () => {
    const e = diferida();
    const consultar = jest.fn().mockResolvedValueOnce(pagina([pend(1)], 's1:3', 2)).mockReturnValueOnce(e.promesa);
    const { c } = armar(VALIDA, consultar);
    await c.abrir();
    c.recargar();
    expect(c.snapshot()).toMatchObject({ items: [], cargando: true, hayMas: false, total: null });
    e.resolver(pagina([pend(2)]));
  });

  test('despues de una accion: el aviso aparece DESPUES de volver a pedir la lista (nunca se parcha la vieja)', async () => {
    const e = diferida();
    const consultar = jest.fn().mockResolvedValueOnce(pagina([pend(1), pend(2)])).mockReturnValueOnce(e.promesa);
    const { c } = armar(VALIDA, consultar);
    await c.abrir();
    const p = c.recargarConAviso('ITF aprobado. Ya es el ITF vigente del pozo.', false);
    expect(c.snapshot().items).toEqual([]);                // la lista vieja ya no se ve
    e.resolver(pagina([pend(2)]));
    const s = await p;
    expect(s.items.map((i) => i.documentoId)).toEqual([D(2)]);
    expect(s.aviso).toEqual({ texto: 'ITF aprobado. Ya es el ITF vigente del pozo.', error: false });
  });

  test('pozos con historial roto: se informa la cantidad (no se inventa nada)', async () => {
    const { c } = armar(VALIDA, jest.fn(() => Promise.resolve(ok({ items: [], siguienteCursor: null, total: 0, pozosSinDerivar: 2 }))));
    expect((await c.abrir()).sinDerivar).toBe(2);
  });

  test('sesion vencida: flujo global', async () => {
    const ctx = ctxDe(VALIDA);
    const c = F.itfFlujos_crearCola({ obtenerContexto: ctx, consultar: () => Promise.resolve(err('UNAUTHORIZED')), onCambio: () => {} });
    await c.abrir();
    expect(ctx.estado.vencida).toBe(1);
  });

  test('reset (cierre de sesion) con una carga en vuelo: no queda nada ni se revive', async () => {
    const a = diferida();
    const { c } = armar(VALIDA, jest.fn(() => a.promesa));
    c.abrir();
    c.reset();
    a.resolver(pagina([pend(1)]));
    await flush();
    expect(c.snapshot()).toMatchObject({ abierta: false, items: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Visor de un documento y comparacion propuesta / vigente', () => {
  const doc = (id, extra) => Object.assign({ documentoId: id, origen: 'E9', wellId: '14-0001', estado: 'PROPUESTO', implicito: false, mimeType: 'image/jpeg', bytes: 700000, nombreOriginal: 'prop.jpg', nombreProponente: 'Ana', propuestoEn: '2026-10-28T15:20:00.000Z', autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, restaurable: false }, extra || {});
  const resp = (d, vigenteId, extraPozo) => ok({ documento: d, pozo: Object.assign({ wellId: '14-0001', estado: 'VIGENTE', tieneItf: 'SI', vigenteActualDocumentoId: vigenteId === undefined ? 'LEGACY:14-0001' : vigenteId, vigenteIndeterminado: false, advertencias: [] }, extraPozo || {}), imagen: { mimeType: d.mimeType, imagenBase64: 'QUJD' } });
  const LEGACY = { documentoId: 'LEGACY:14-0001', origen: 'LEGACY', wellId: '14-0001', estado: 'VIGENTE', implicito: true, mimeType: 'image/jpeg', bytes: 600000, nombreOriginal: null, nombreProponente: null, propuestoEn: null, autoPropuestaPropia: false };

  function armar(permisos, abrir) {
    const deps = { obtenerContexto: ctxDe(permisos || VALIDA), abrir: abrir || jest.fn((tok, id) => Promise.resolve(id === 'LEGACY:14-0001' ? resp(LEGACY) : resp(doc(id)))), onCambio: jest.fn() };
    return { v: F.itfFlujos_crearVisor(deps), deps };
  }

  test.each([['solo perfil', SOLO], ['perfil + subir', PROPONE]])('%s: no abre ni pide imagenes', async (_n, permisos) => {
    const { v, deps } = armar(permisos);
    expect((await v.abrir(D(1))).error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.abrir).not.toHaveBeenCalled();
  });

  test('abrir: pide SOLO ese documento (una imagen), con metadata segura y la imagen como data URI', async () => {
    const { v, deps } = armar();
    const s = await v.abrir(D(1));
    expect(deps.abrir).toHaveBeenCalledTimes(1);
    expect(deps.abrir).toHaveBeenCalledWith('tok', D(1));
    expect(s.doc).toMatchObject({ documentoId: D(1), wellId: '14-0001', textoEstado: 'Propuesto', nombre: 'prop.jpg', tamano: '684 KB', proponente: 'Ana', esPropuesta: true, esExistente: false });
    expect(s.imagen.dataUri).toBe('data:image/jpeg;base64,QUJD');
    expect(s).toMatchObject({ hayVigente: true, puedeComparar: true, comparando: false, vista: 'PROPUESTA', zoom: 1 });
    expect(JSON.stringify(s)).not.toMatch(/@|storageFileId|sha256/);
  });

  test('comparar: carga el vigente UNA vez (el ITF existente se llama "ITF existente", jamas LEGACY:) y ofrece una vista por vez', async () => {
    const { v, deps } = armar();
    await v.abrir(D(1));
    const s = await v.comparar();
    expect(deps.abrir).toHaveBeenLastCalledWith('tok', 'LEGACY:14-0001');
    expect(s).toMatchObject({ comparando: true, vigente: { fase: 'LISTO', nombre: 'ITF existente', tamano: '586 KB' } });
    expect(s.vigente.imagen.dataUri).toBe('data:image/jpeg;base64,QUJD');
    await v.comparar();
    expect(deps.abrir).toHaveBeenCalledTimes(2);           // no vuelve a bajar la imagen del vigente
    v.verVista('VIGENTE');
    expect(v.snapshot().vista).toBe('VIGENTE');
    v.verVista('RARA');
    expect(v.snapshot().vista).toBe('VIGENTE');
    v.dejarDeComparar();
    expect(v.snapshot()).toMatchObject({ comparando: false, vista: 'PROPUESTA' });
    expect(JSON.stringify(v.snapshot())).not.toMatch(/LEGACY:/);
  });

  test('verVista sin comparar no cambia nada', async () => {
    const { v } = armar();
    await v.abrir(D(1));
    v.verVista('VIGENTE');
    expect(v.snapshot().vista).toBe('PROPUESTA');
  });

  test('sin ITF vigente no hay con que comparar (y se dice); el vigente indeterminado se avisa', async () => {
    const { v } = armar(VALIDA, jest.fn(() => Promise.resolve(resp(doc(D(1)), null, { tieneItf: 'NO' }))));
    const s = await v.abrir(D(1));
    expect(s).toMatchObject({ hayVigente: false, puedeComparar: false });
    const { v: v2 } = armar(VALIDA, jest.fn(() => Promise.resolve(resp(doc(D(1)), null, { tieneItf: 'DESCONOCIDO', vigenteIndeterminado: true }))));
    expect((await v2.abrir(D(1))).vigenteIndeterminado).toBe(true);
  });

  test('el propio vigente no se compara consigo mismo', async () => {
    const { v } = armar(VALIDA, jest.fn(() => Promise.resolve(resp(doc(D(1), { estado: 'VIGENTE' }), D(1)))));
    expect((await v.abrir(D(1))).puedeComparar).toBe(false);
  });

  test('error del vigente al comparar: se muestra en ESE panel y se puede reintentar', async () => {
    const abrir = jest.fn().mockResolvedValueOnce(resp(doc(D(1)))).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(resp(LEGACY));
    const { v } = armar(VALIDA, abrir);
    await v.abrir(D(1));
    const e = await v.comparar();
    expect(e.vigente).toMatchObject({ fase: 'ERROR', error: expect.stringMatching(/No se pudo completar/) });
    expect(e.comparando).toBe(true);
    expect((await v.comparar()).vigente.fase).toBe('LISTO');
  });

  test('zoom: 100 -> 150 -> 200 -> 300 -> 400, con limites y "ajustar"', async () => {
    const { v } = armar();
    await v.abrir(D(1));
    const zs = [];
    for (let i = 0; i < 6; i += 1) { zs.push(v.snapshot().zoom); v.acercar(); }
    expect(zs).toEqual([1, 1.5, 2, 3, 4, 4]);
    expect(v.snapshot()).toMatchObject({ puedeAcercar: false, puedeAlejar: true });
    v.ajustar();
    expect(v.snapshot()).toMatchObject({ zoom: 1, puedeAlejar: false });
    v.alejar();
    expect(v.snapshot().zoom).toBe(1);
  });

  test('error al abrir: mensaje humano y reintento; una imagen invalida tambien es error', async () => {
    const abrir = jest.fn().mockResolvedValueOnce(err('ITF_NOT_FOUND')).mockResolvedValueOnce(ok({ documento: doc(D(1)), pozo: { vigenteActualDocumentoId: null }, imagen: { mimeType: 'text/html', imagenBase64: 'QUJD' } })).mockResolvedValueOnce(resp(doc(D(1))));
    const { v } = armar(VALIDA, abrir);
    expect((await v.abrir(D(1))).error.mensaje).toBe('El documento ya no está disponible.');
    expect((await v.recargar()).error).toBeTruthy();
    expect((await v.recargar()).error).toBeNull();
  });

  test('respuesta VIEJA: abrir A y despues B; A llega tarde y NO pisa a B', async () => {
    const a = diferida();
    const abrir = jest.fn().mockReturnValueOnce(a.promesa).mockResolvedValueOnce(resp(doc(D(2), { nombreOriginal: 'b.jpg' })));
    const { v } = armar(VALIDA, abrir);
    v.abrir(D(1));
    await v.abrir(D(2));
    a.resolver(resp(doc(D(1), { nombreOriginal: 'a.jpg' })));
    await flush();
    expect(v.snapshot().doc.nombre).toBe('b.jpg');
  });

  test('recargar (cambio el vigente): TODO se vuelve a pedir y la comparacion se apaga', async () => {
    const { v, deps } = armar();
    await v.abrir(D(1));
    await v.comparar();
    const s = await v.recargar();
    expect(s).toMatchObject({ comparando: false, vigente: { fase: 'NINGUNO' }, zoom: 1 });
    expect(deps.abrir).toHaveBeenCalledTimes(3);
  });

  test('contextoDeAccion: el documento y el vigente que ESTA persona vio (o null si no habia)', async () => {
    const { v } = armar();
    await v.abrir(D(1));
    expect(v.contextoDeAccion()).toEqual({ documentoId: D(1), wellId: '14-0001', entidad: 'prop.jpg · pozo 14-0001', vigenteEsperadoDocumentoId: 'LEGACY:14-0001' });
    const { v: v2 } = armar(VALIDA, jest.fn(() => Promise.resolve(resp(doc(D(1)), null, { tieneItf: 'NO' }))));
    await v2.abrir(D(1));
    expect(v2.contextoDeAccion().vigenteEsperadoDocumentoId).toBeNull();
  });

  test('un documento historico restaurable se identifica; el visor cerrado no revive con una respuesta tardia', async () => {
    const e = diferida();
    const { v } = armar(VALIDA, jest.fn(() => e.promesa));
    v.abrir(D(3));
    v.cerrar();
    e.resolver(resp(doc(D(3), { estado: 'REEMPLAZADO', restaurable: true })));
    await flush();
    expect(v.snapshot()).toMatchObject({ abierto: false, doc: null });
    const { v: v2 } = armar(VALIDA, jest.fn(() => Promise.resolve(resp(doc(D(3), { estado: 'REEMPLAZADO', restaurable: true })))));
    expect((await v2.abrir(D(3))).doc).toMatchObject({ restaurable: true, esPropuesta: false, textoEstado: 'Reemplazado' });
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Historial de un pozo', () => {
  const dh = (id, extra) => Object.assign({ documentoId: id, origen: 'E9', wellId: '14-0001', estado: 'REEMPLAZADO', mimeType: 'image/jpeg', bytes: 500000, nombreOriginal: id + '.jpg', restaurable: true, vigenteDesde: '2026-09-02T10:00:00.000Z' }, extra || {});
  const HIST = ok({
    wellId: '14-0001',
    pozo: { wellId: '14-0001', vigenteActualDocumentoId: D(5), vigenteIndeterminado: false },
    documentos: [dh(D(5), { estado: 'VIGENTE', restaurable: false }), dh(D(3)), dh(D(4), { estado: 'PROPUESTO', restaurable: false }), { documentoId: 'LEGACY:14-0001', origen: 'LEGACY', estado: 'REEMPLAZADO', restaurable: true, bytes: 1000, vigenteDesde: null }],
    historial: [
      { evento: 'ITF_APROBADO', documentoId: D(5), documentoReemplazadoId: D(3), nombre: 'Vera', timestamp: '2026-10-02T15:00:00.000Z', motivoCodigo: 'MEJOR_CALIDAD', motivoTexto: '', detalle: 'Se aprobo.' },
      { evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', documentoReemplazadoId: '', nombre: 'Sistema', timestamp: '2026-09-02T10:00:00.000Z', motivoCodigo: '', motivoTexto: '', detalle: 'Registro.' },
      { evento: 'ITF_PROPUESTO', documentoId: D(3), documentoReemplazadoId: '', nombre: 'Ana', timestamp: '2026-09-01T10:00:00.000Z', motivoCodigo: '', motivoTexto: '', detalle: 'Se propuso.' }
    ]
  });
  function armar(permisos, consultar) {
    const deps = { obtenerContexto: ctxDe(permisos || VALIDA), consultar: consultar || jest.fn(() => Promise.resolve(HIST)), onCambio: jest.fn() };
    return { h: F.itfFlujos_crearHistorial(deps), deps };
  }

  test.each([['solo perfil', SOLO], ['perfil + subir', PROPONE]])('%s: no se pide nada', async (_n, permisos) => {
    const { h, deps } = armar(permisos);
    expect((await h.abrir('14-0001')).error).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deps.consultar).not.toHaveBeenCalled();
  });

  test('abrir: linea de tiempo (sin el registro interno), vigente y SOLO los documentos historicos restaurables, con el ITF existente como "ITF existente"', async () => {
    const { h, deps } = armar();
    const s = await h.abrir('14-0001');
    expect(deps.consultar).toHaveBeenCalledWith('tok', '14-0001');
    expect(s.filas.map((f) => f.titulo)).toEqual(['Aprobado', 'Propuesto']);
    expect(s.vigente).toMatchObject({ documentoId: D(5), nombre: D(5) + '.jpg' });
    expect(s.vigenteActualDocumentoId).toBe(D(5));
    expect(s.restaurables.map((r) => r.nombre)).toEqual([D(3) + '.jpg', 'ITF existente']);
    expect(s.restaurables[0]).toMatchObject({ estado: 'Reemplazado', tamano: '488 KB', vigenteDesde: '02/09/2026 07:00' });
    // lo que se MUESTRA (los ids y las claves son internos: identifican filas y abren el visor, nunca se pintan)
    const visible = JSON.stringify({ filas: s.filas.map((f) => [f.titulo, f.quien, f.cuando, f.detalle, f.motivo, f.documento]), vigente: s.vigente && s.vigente.nombre, restaurables: s.restaurables.map((r) => [r.nombre, r.estado, r.tamano, r.vigenteDesde]) });
    expect(visible).not.toMatch(/LEGACY|@|sha256|storage|ITF_/);
  });

  test('sin movimientos: vacio; error y reintento', async () => {
    const consultar = jest.fn().mockResolvedValueOnce(ok({ wellId: '14-0001', pozo: { vigenteActualDocumentoId: null }, documentos: [], historial: [] })).mockResolvedValueOnce(err('ITF_STATE_UNKNOWN')).mockResolvedValueOnce(HIST);
    const { h } = armar(VALIDA, consultar);
    const v = await h.abrir('14-0001');
    expect(v).toMatchObject({ vacio: true, hayVigente: false, vigente: null });
    const e = await h.recargar();
    expect(e.error.mensaje).toMatch(/No se puede determinar/);
    expect((await h.recargar()).filas).toHaveLength(2);
  });

  test('una respuesta rara es un error, no una pantalla en blanco; una respuesta vieja no pisa a la nueva', async () => {
    const a = diferida();
    const consultar = jest.fn().mockReturnValueOnce(a.promesa).mockResolvedValueOnce(HIST);
    const { h } = armar(VALIDA, consultar);
    h.abrir('14-0009');
    await h.abrir('14-0001');
    a.resolver(ok({ wellId: '14-0009', pozo: { vigenteActualDocumentoId: null }, documentos: [], historial: [] }));
    await flush();
    expect(h.snapshot().wellId).toBe('14-0001');
    const { h: h2 } = armar(VALIDA, jest.fn(() => Promise.resolve(ok({ cosa: 1 }))));
    expect((await h2.abrir('14-0001')).error).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------
describe('Aprobar / rechazar / retirar / restaurar (dialogo con motivo)', () => {
  const HIST_CON_VIGENTE = (vigente) => ok({ wellId: '14-0001', pozo: { wellId: '14-0001', vigenteActualDocumentoId: vigente }, documentos: vigente === null ? [] : [{ documentoId: vigente, origen: vigente.indexOf('LEGACY:') === 0 ? 'LEGACY' : 'E9', estado: 'VIGENTE', nombreOriginal: 'vig.jpg' }], historial: [] });
  function armar(permisos, opc) {
    const o = opc || {};
    let n = 0;
    const deps = {
      obtenerContexto: ctxDe(permisos || VALIDA),
      cargarContexto: o.cargarContexto || jest.fn(() => Promise.resolve(HIST_CON_VIGENTE('LEGACY:14-0001'))),
      enviar: o.enviar || jest.fn(() => Promise.resolve(ok({ documentoId: D(1), wellId: '14-0001', evento: 'ITF_APROBADO', estado: 'VIGENTE', reintento: false }))),
      nuevoId: jest.fn(() => { n += 1; return 'accion-' + String(n).padStart(4, '0'); }),
      onCambio: jest.fn(),
      alExito: jest.fn(),
      alVigenteCambio: jest.fn(),
      alObsoleto: jest.fn()
    };
    return { a: F.itfFlujos_crearAccion(deps), deps };
  }
  const INFO = (extra) => Object.assign({ documentoId: D(1), wellId: '14-0001', entidad: 'prop.jpg · pozo 14-0001' }, extra || {});

  test.each([['solo perfil', SOLO], ['perfil + subir (proponer no es validar)', PROPONE], ['perfil_validar sin perfil', { perfil_validar: true }], ['truthy', { perfil: true, perfil_validar: 'SI' }]])('%s: ninguna accion se abre', (_n, permisos) => {
    const { a, deps } = armar(permisos);
    ['APROBAR', 'RECHAZAR', 'RETIRAR', 'RESTAURAR'].forEach((t) => expect(a.pedir(t, INFO({ vigenteEsperadoDocumentoId: null }))).toBe(false));
    expect(a.abierta()).toBe(false);
    expect(deps.cargarContexto).not.toHaveBeenCalled();
  });

  test('"retirar propuesta" y acciones desconocidas no pasan por este dialogo', () => {
    const { a } = armar();
    expect(a.pedir('RETIRAR_PROPUESTA', INFO())).toBe(false);
    expect(a.pedir('BORRAR', INFO())).toBe(false);
    expect(a.pedir('APROBAR', INFO({ vigenteEsperadoDocumentoId: null }))).toBe(true);
    expect(a.pedir('RECHAZAR', INFO())).toBe(false);          // ya hay una abierta
  });

  test('APROBAR sin vigente: confirmacion simple, SIN motivo, sin vigenteEsperadoDocumentoId', async () => {
    const { a, deps } = armar();
    a.pedir('APROBAR', INFO({ vigenteEsperadoDocumentoId: null }));
    const s = a.snapshot();
    expect(s).toMatchObject({ titulo: 'Aprobar como ITF vigente', boton: 'Aprobar como ITF vigente', catalogo: null, reemplaza: false, puedeEnviar: true, cargandoContexto: false });
    expect(s.aviso).not.toMatch(/reemplazará/);
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledWith('APROBAR', 'tok', { documentoId: D(1), clientRequestId: 'accion-0001' });
    expect(Object.keys(deps.enviar.mock.calls[0][2])).not.toContain('vigenteEsperadoDocumentoId');
    expect(deps.alExito).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'APROBAR', documentoId: D(1), wellId: '14-0001' }));
  });

  test('APROBAR con vigente: avisa que REEMPLAZA, pide motivo del catalogo y envia el vigente que se vio (vigenteEsperadoDocumentoId)', async () => {
    const { a, deps } = armar();
    a.pedir('APROBAR', INFO({ vigenteEsperadoDocumentoId: 'LEGACY:14-0001' }));
    let s = a.snapshot();
    expect(s).toMatchObject({ reemplaza: true, aviso: 'Esta aprobación reemplazará el ITF vigente actual.', puedeEnviar: false });
    expect(s.catalogo.map((m) => m.codigo)).toEqual(['ACTUALIZACION', 'CORRECCION', 'MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO', 'OTRO']);
    await a.confirmar();                                      // sin motivo: no se envia
    expect(deps.enviar).not.toHaveBeenCalled();
    expect(a.snapshot().error).toMatchObject({ code: 'INVALID_MOTIVO' });
    a.setMotivo('MEJOR_CALIDAD');
    expect(a.snapshot().puedeEnviar).toBe(true);
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledWith('APROBAR', 'tok', { documentoId: D(1), clientRequestId: 'accion-0001', vigenteEsperadoDocumentoId: 'LEGACY:14-0001', motivoCodigo: 'MEJOR_CALIDAD' });
  });

  test('OTRO exige detalle (3 a 300); el detalle viaja como motivoTexto', async () => {
    const { a, deps } = armar();
    a.pedir('APROBAR', INFO({ vigenteEsperadoDocumentoId: D(7) }));
    a.setMotivo('OTRO');
    expect(a.snapshot()).toMatchObject({ pideTexto: true, puedeEnviar: false });
    a.setTexto('ab');
    expect(a.snapshot().puedeEnviar).toBe(false);
    a.setTexto('Documento completo con firma');
    expect(a.snapshot().puedeEnviar).toBe(true);
    await a.confirmar();
    expect(deps.enviar.mock.calls[0][2]).toMatchObject({ motivoCodigo: 'OTRO', motivoTexto: 'Documento completo con firma', vigenteEsperadoDocumentoId: D(7) });
  });

  test('APROBAR desde la cola (el vigente NO se conoce): se pide el contexto SIN imagenes antes de habilitar; mientras tanto no se puede confirmar', async () => {
    const e = diferida();
    const { a, deps } = armar(VALIDA, { cargarContexto: jest.fn(() => e.promesa) });
    a.pedir('APROBAR', INFO());
    expect(a.snapshot()).toMatchObject({ cargandoContexto: true, puedeEnviar: false, aviso: '' });
    await a.confirmar();
    expect(deps.enviar).not.toHaveBeenCalled();
    e.resolver(HIST_CON_VIGENTE(D(9)));
    await flush();
    expect(deps.cargarContexto).toHaveBeenCalledWith('tok', '14-0001');
    expect(a.snapshot()).toMatchObject({ cargandoContexto: false, reemplaza: true });
    a.setMotivo('ACTUALIZACION');
    await a.confirmar();
    expect(deps.enviar.mock.calls[0][2].vigenteEsperadoDocumentoId).toBe(D(9));
  });

  test('si el contexto indica que NO hay vigente, aprobar es simple (sin motivo ni vigenteEsperado)', async () => {
    const { a, deps } = armar(VALIDA, { cargarContexto: jest.fn(() => Promise.resolve(HIST_CON_VIGENTE(null))) });
    a.pedir('APROBAR', INFO());
    await flush();
    expect(a.snapshot()).toMatchObject({ catalogo: null, reemplaza: false, puedeEnviar: true });
    await a.confirmar();
    expect(Object.keys(deps.enviar.mock.calls[0][2]).sort()).toEqual(['clientRequestId', 'documentoId']);
  });

  test('falla el contexto: se avisa, se puede cerrar y NO se puede enviar a ciegas', async () => {
    const { a, deps } = armar(VALIDA, { cargarContexto: jest.fn(() => Promise.resolve(err('SERVICE_UNAVAILABLE'))) });
    a.pedir('APROBAR', INFO());
    await flush();
    const s = a.snapshot();
    expect(s.errorContexto).toMatch(/No se pudo completar/);
    expect(s.puedeEnviar).toBe(false);
    await a.confirmar();
    expect(deps.enviar).not.toHaveBeenCalled();
    a.cancelar();
    expect(a.abierta()).toBe(false);
  });

  test('aprobar el que YA es el vigente no tiene sentido', async () => {
    const { a } = armar(VALIDA, { cargarContexto: jest.fn(() => Promise.resolve(HIST_CON_VIGENTE(D(1)))) });
    a.pedir('APROBAR', INFO());
    await flush();
    expect(a.snapshot().errorContexto).toMatch(/ya no se puede restaurar/);
  });

  test('RECHAZAR: motivo obligatorio del catalogo de rechazo; NUNCA lleva vigenteEsperadoDocumentoId', async () => {
    const { a, deps } = armar();
    a.pedir('RECHAZAR', INFO());
    const s = a.snapshot();
    expect(s.catalogo.map((m) => m.codigo)).toEqual(['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA', 'OTRO']);
    expect(s.puedeEnviar).toBe(false);
    a.setMotivo('ILEGIBLE');
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledWith('RECHAZAR', 'tok', { documentoId: D(1), clientRequestId: 'accion-0001', motivoCodigo: 'ILEGIBLE' });
    expect(deps.cargarContexto).not.toHaveBeenCalled();
  });

  test('RETIRAR el vigente: advertencia exacta, motivo del catalogo de retiro', async () => {
    const { a, deps } = armar();
    a.pedir('RETIRAR', INFO({ documentoId: D(5) }));
    expect(a.snapshot()).toMatchObject({ aviso: 'El pozo quedará sin ITF vigente hasta que se apruebe o restaure otro.', titulo: 'Retirar ITF vigente' });
    expect(a.snapshot().catalogo.map((m) => m.codigo)).toContain('DOCUMENTO_INCORRECTO');
    a.setMotivo('DOCUMENTO_INCORRECTO');
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledWith('RETIRAR', 'tok', { documentoId: D(5), clientRequestId: 'accion-0001', motivoCodigo: 'DOCUMENTO_INCORRECTO' });
  });

  test('RETIRAR desde el Perfil (se desconoce el documento): se lee el vigente actual y se retira ESE; sin vigente, no hay nada que retirar', async () => {
    const { a, deps } = armar(VALIDA, { cargarContexto: jest.fn(() => Promise.resolve(HIST_CON_VIGENTE(D(8)))) });
    a.pedir('RETIRAR', { documentoId: undefined, wellId: '14-0001', entidad: 'ITF vigente · pozo 14-0001' });
    await flush();
    expect(a.snapshot().entidad).toBe('vig.jpg · pozo 14-0001');
    a.setMotivo('OTRO');
    a.setTexto('Era de otro pozo');
    await a.confirmar();
    expect(deps.enviar.mock.calls[0][2]).toMatchObject({ documentoId: D(8), motivoCodigo: 'OTRO', motivoTexto: 'Era de otro pozo' });
    const { a: b, deps: d2 } = armar(VALIDA, { cargarContexto: jest.fn(() => Promise.resolve(HIST_CON_VIGENTE(null))) });
    b.pedir('RETIRAR', { documentoId: undefined, wellId: '14-0001', entidad: 'x' });
    await flush();
    expect(b.snapshot().errorContexto).toBe('No hay un ITF vigente registrado para este pozo.');
    await b.confirmar();
    expect(d2.enviar).not.toHaveBeenCalled();
  });

  test('RESTAURAR: motivo (frase de restauracion), y si hay vigente lo reemplaza y se declara', async () => {
    const { a, deps } = armar();
    a.pedir('RESTAURAR', INFO({ documentoId: D(3), vigenteEsperadoDocumentoId: D(5) }));
    const s = a.snapshot();
    expect(s).toMatchObject({ titulo: 'Restaurar como vigente', reemplaza: true, aviso: 'Esta restauración reemplazará el ITF vigente actual.' });
    expect(s.catalogo).toBe(L.ITF_MOTIVOS_RESTAURACION);
    a.setMotivo('ERROR_DE_APROBACION');
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledWith('RESTAURAR', 'tok', { documentoId: D(3), clientRequestId: 'accion-0001', vigenteEsperadoDocumentoId: D(5), motivoCodigo: 'ERROR_DE_APROBACION' });
  });

  test('RESTAURAR sin vigente (pozo sin ITF): no declara ningun vigente', async () => {
    const { a, deps } = armar();
    a.pedir('RESTAURAR', INFO({ documentoId: D(3), vigenteEsperadoDocumentoId: null }));
    expect(a.snapshot().aviso).toBe('Este documento volverá a ser el ITF vigente del pozo.');
    a.setMotivo('ERROR_DE_APROBACION');
    await a.confirmar();
    expect(Object.keys(deps.enviar.mock.calls[0][2])).not.toContain('vigenteEsperadoDocumentoId');
  });

  test('el payload NUNCA lleva email, actor, wellId, estado ni hash', async () => {
    const { a, deps } = armar();
    a.pedir('RESTAURAR', INFO({ documentoId: D(3), vigenteEsperadoDocumentoId: D(5) }));
    a.setMotivo('OTRO');
    a.setTexto('motivo valido');
    await a.confirmar();
    const campos = Object.keys(deps.enviar.mock.calls[0][2]).sort();
    expect(campos).toEqual(['clientRequestId', 'documentoId', 'motivoCodigo', 'motivoTexto', 'vigenteEsperadoDocumentoId']);
  });

  test('DOBLE TOQUE: un solo envio; un fallo transitorio se reintenta con el MISMO id (la intencion es la misma)', async () => {
    const e = diferida();
    const enviar = jest.fn().mockReturnValueOnce(e.promesa).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok({ documentoId: D(1), wellId: '14-0001' }));
    const { a, deps } = armar(VALIDA, { enviar });
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    const p1 = a.confirmar();
    const p2 = a.confirmar();
    expect(p2).toBe(p1);
    expect(a.snapshot()).toMatchObject({ enviando: true, puedeEnviar: false, boton: 'Rechazando…' });
    e.resolver(err('SERVICE_UNAVAILABLE'));
    await p1;
    expect(enviar).toHaveBeenCalledTimes(1);
    expect(a.snapshot().error.mensaje).toMatch(/No se pudo completar/);
    await a.confirmar();
    await a.confirmar();
    expect(new Set(enviar.mock.calls.map((c) => c[2].clientRequestId)).size).toBe(1);
    expect(deps.alExito).toHaveBeenCalledTimes(1);
  });

  test('una intencion NUEVA (cerrar y volver a abrir) usa un id NUEVO', async () => {
    const { a, deps } = armar();
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    a.cancelar();
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    await a.confirmar();
    expect(deps.enviar.mock.calls[0][2].clientRequestId).toBe('accion-0002');
  });

  test('VIGENTE_CAMBIO: NO se reintenta solo; se cierra el dialogo y se avisa para volver a pedir el contexto', async () => {
    const { a, deps } = armar(VALIDA, { enviar: jest.fn(() => Promise.resolve(err('VIGENTE_CAMBIO'))) });
    a.pedir('APROBAR', INFO({ vigenteEsperadoDocumentoId: 'LEGACY:14-0001' }));
    a.setMotivo('ACTUALIZACION');
    await a.confirmar();
    expect(deps.enviar).toHaveBeenCalledTimes(1);
    expect(a.abierta()).toBe(false);
    expect(deps.alVigenteCambio).toHaveBeenCalledWith({ tipo: 'APROBAR', documentoId: D(1), wellId: '14-0001' });
    expect(deps.alExito).not.toHaveBeenCalled();
    await flush();
    expect(deps.enviar).toHaveBeenCalledTimes(1);                 // jamas un segundo intento automatico
  });

  test.each([['DOCUMENTO_NO_PROPUESTO'], ['DOCUMENTO_NO_RETIRABLE'], ['DESTINO_INVALIDO'], ['ITF_NOT_FOUND']])('%s: lo que se veia ya no vale -> se cierra y se avisa para volver a pedir', async (code) => {
    const { a, deps } = armar(VALIDA, { enviar: jest.fn(() => Promise.resolve(err(code))) });
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    await a.confirmar();
    expect(a.abierta()).toBe(false);
    expect(deps.alObsoleto).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'RECHAZAR', code: code }));
  });

  test.each([['LEGACY_CAMBIO', /no se puede restaurar/], ['ITF_ARCHIVO_NO_DISPONIBLE', /no se puede aprobar/], ['PERMISSION_DENIED', /No tenés permiso/], ['ITF_E9_INACTIVO', /todavía no están habilitadas/]])('%s queda en el dialogo con su mensaje', async (code, texto) => {
    const { a } = armar(VALIDA, { enviar: jest.fn(() => Promise.resolve(err(code))) });
    a.pedir('RESTAURAR', INFO({ documentoId: D(3), vigenteEsperadoDocumentoId: null }));
    a.setMotivo('ERROR_DE_APROBACION');
    await a.confirmar();
    expect(a.abierta()).toBe(true);
    expect(a.snapshot().error.mensaje).toMatch(texto);
  });

  test('sesion vencida: flujo global', async () => {
    const ctx = ctxDe(VALIDA);
    const a = F.itfFlujos_crearAccion({ obtenerContexto: ctx, cargarContexto: () => Promise.resolve(HIST_CON_VIGENTE(null)), enviar: () => Promise.resolve(err('UNAUTHORIZED')), nuevoId: () => 'accion-0001', onCambio: () => {} });
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    await a.confirmar();
    expect(ctx.estado.vencida).toBe(1);
  });

  test('permiso revocado al confirmar: no se envia', async () => {
    const { a, deps } = armar();
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    deps.obtenerContexto.estado.permisos = { perfil: true, perfil_subir: true };
    await a.confirmar();
    expect(deps.enviar).not.toHaveBeenCalled();
    expect(a.snapshot().error.mensaje).toMatch(/No tenés permiso/);
  });

  test('no se puede cambiar el motivo ni cancelar mientras se envia; el contexto viejo de un dialogo cancelado no revive', async () => {
    const e = diferida();
    const { a } = armar(VALIDA, { enviar: jest.fn(() => e.promesa) });
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    a.confirmar();
    a.setMotivo('OTRO');
    a.cancelar();
    expect(a.snapshot()).toMatchObject({ motivoCodigo: 'ILEGIBLE', enviando: true });
    e.resolver(ok({ documentoId: D(1) }));
    await flush();
    const ctxTardio = diferida();
    const { a: b, deps } = armar(VALIDA, { cargarContexto: jest.fn(() => ctxTardio.promesa) });
    b.pedir('APROBAR', INFO());
    b.cancelar();
    ctxTardio.resolver(HIST_CON_VIGENTE(D(9)));
    await flush();
    expect(b.abierta()).toBe(false);
    expect(deps.onCambio).toHaveBeenLastCalledWith(null);
  });

  test('reset (cierre de sesion): se cierra todo y una respuesta tardia no abre nada', async () => {
    const e = diferida();
    const { a, deps } = armar(VALIDA, { enviar: jest.fn(() => e.promesa) });
    a.pedir('RECHAZAR', INFO());
    a.setMotivo('ILEGIBLE');
    a.confirmar();
    a.reset();
    e.resolver(ok({ documentoId: D(1) }));
    await flush();
    expect(a.abierta()).toBe(false);
    expect(deps.alExito).not.toHaveBeenCalled();
  });
});
