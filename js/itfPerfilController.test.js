// E9-6: controlador DOM del Perfil con ITF colaborativos (js/itfPerfil.js) ejecutado de verdad con un DOM falso que LANZA ante innerHTML. Cubre la matriz de permisos (que se ve y que NO), el ITF vigente y sus
// estados (cargando / sin ITF / error con reintento), guardar / compartir con el nombre del tipo real, proponer (elegir, preparar, enviar, doble toque, mensajes), Mis propuestas (lista, alcance, retiro propio con
// confirmacion, foco y teclado), texto de datos SIEMPRE como texto, y el cierre de sesion.
const { crearEntorno, flush } = require('./fixtures/domFalsoItf');

const PROPONE = { perfil: true, perfil_subir: true };
const VALIDA = { perfil: true, perfil_validar: true };
const AMBOS = { perfil: true, perfil_subir: true, perfil_validar: true };
const SOLO = { perfil: true };
const D = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ok = (data) => ({ status: 'ok', data: data });
const err = (code) => ({ status: 'error', code: code });
const IMG = { wellId: '14-0001', mimeType: 'image/jpeg', imageBase64: 'QUJD' };
const propuesta = (n, extra) => Object.assign({ documentoId: D(n), wellId: '14-0001', estado: 'PROPUESTO', esVigente: false, puedeRetirar: true, mimeType: 'image/jpeg', bytes: 500000, nombreOriginal: 'itf' + n + '.jpg', timestampUtc: '2026-10-28T15:20:00.000Z', decididoEn: null, retiradaPorMi: false, motivoCodigo: null, motivoTexto: null }, extra || {});

function montar(permisos, opc) {
  const o = opc || {};
  const estado = { permisos: permisos, vencida: 0, alCambio: [] };
  const api = {
    apiGetProfile: jest.fn(o.perfil || (() => Promise.resolve(ok(IMG)))),
    apiProponerItf: jest.fn(o.proponer || (() => Promise.resolve(ok({ documentoId: D(50), wellId: '14-0001', estado: 'PROPUESTO', warnings: [] })))),
    apiGetMisPropuestasItf: jest.fn(o.mis || (() => Promise.resolve(ok({ items: [propuesta(1), propuesta(2, { estado: 'RECHAZADO', puedeRetirar: false, motivoCodigo: 'ILEGIBLE' })], siguienteCursor: null, total: 2, incompleta: false })))),
    apiRetirarPropuestaItf: jest.fn(o.retirar || (() => Promise.resolve(ok({ documentoId: D(1), evento: 'ITF_RETIRADO', reintento: false })))),
    itfImagen_preparar: jest.fn(o.preparar || (() => Promise.resolve({ base64: 'QUJDREVG', bytes: 800000, mimeType: 'image/jpeg', ancho: 2400, alto: 1680, accion: 'REDUCIDA', previewUrl: 'blob:prev' }))),
    itfModeracionController_abrirHistorial: jest.fn(),
    itfModeracionController_pedirRetirarVigente: jest.fn()
  };
  const entorno = crearEntorno(['itfLogic.js', 'itfFlujosLogic.js', 'itfPerfil.js'], api, { navigator: o.navigator });
  entorno.ctx.itfPerfilController_inicializar(() => ({ sessionToken: 'tok', permisos: estado.permisos, onSessionExpired: () => { estado.vencida += 1; } }), { esIOS: () => !!o.ios });
  return Object.assign(entorno, { api, estado, c: entorno.ctx });
}

async function abrir(e, wellId) {
  e.c.itfPerfilController_abrir(wellId || '14-0001');
  await flush();
}

describe('Perfil: lo de siempre para quien solo tiene perfil', () => {
  test('con solo `perfil`: imagen + Guardar / Compartir y NADA colaborativo (sin proponer, sin mis propuestas, sin historial, sin retirar, sin estados internos)', async () => {
    const e = montar(SOLO);
    await abrir(e);
    expect(e.el['perfil-vigente'].hidden).toBe(false);
    expect(e.el['perfil-imagen'].getAttribute('src')).toBe('data:image/jpeg;base64,QUJD');
    expect(e.el['perfil-guardar-a'].hidden).toBe(false);
    expect(e.el['itf-colab'].hidden).toBe(true);
    expect(e.el['perfil-wellid'].textContent).toBe('14-0001');
    expect(e.api.apiGetMisPropuestasItf).not.toHaveBeenCalled();
  });

  test('el vigente se pide AL ABRIR (getProfile), una vez', async () => {
    const e = montar(SOLO);
    expect(e.api.apiGetProfile).not.toHaveBeenCalled();
    await abrir(e);
    expect(e.api.apiGetProfile).toHaveBeenCalledTimes(1);
    expect(e.api.apiGetProfile).toHaveBeenCalledWith('tok', '14-0001');
  });

  test('mientras carga: indicador de carga y nada mas; al terminar se oculta', async () => {
    let resolver;
    const e = montar(SOLO, { perfil: () => new Promise((r) => { resolver = r; }) });
    e.c.itfPerfilController_abrir('14-0001');
    expect(e.el['perfil-cargando'].hidden).toBe(false);
    expect(e.el['perfil-vigente'].hidden).toBe(true);
    resolver(ok(IMG));
    await flush();
    expect(e.el['perfil-cargando'].hidden).toBe(true);
  });

  test('guardar: el archivo se llama como el tipo REAL (un PNG vigente se descarga como .png)', async () => {
    const e = montar(SOLO, { perfil: () => Promise.resolve(ok({ wellId: '14-0001', mimeType: 'image/png', imageBase64: 'QkJC' })) });
    await abrir(e);
    expect(e.el['perfil-guardar-a'].getAttribute('download')).toBe('14-0001.png');
    expect(e.el['perfil-guardar-a'].href).toBe('data:image/png;base64,QkJC');
  });

  test('iOS: boton de compartir en vez del enlace de descarga', async () => {
    const e = montar(SOLO, { ios: true });
    await abrir(e);
    expect(e.el['btn-save-image'].hidden).toBe(false);
    expect(e.el['perfil-guardar-a'].hidden).toBe(true);
  });

  test('iOS: con Web Share de archivos comparte un File del tipo real; sin soporte abre la imagen en una pestana', async () => {
    const compartidos = [];
    const e = montar(SOLO, { ios: true, navigator: { canShare: () => true, share: (d) => { compartidos.push(d); return Promise.resolve(); } } });
    await abrir(e);
    e.el['btn-save-image'].click();
    expect(compartidos).toHaveLength(1);
    expect(compartidos[0].files[0].name).toBe('14-0001.jpg');
    const e2 = montar(SOLO, { ios: true, navigator: {} });
    e2.c.window.open = jest.fn();
    await abrir(e2);
    e2.el['btn-save-image'].click();
    expect(e2.c.window.open).toHaveBeenCalledWith('data:image/jpeg;base64,QUJD', '_blank');
  });

  test('sin ITF vigente: "No hay un ITF vigente registrado para este pozo." (sin imagen, sin descargar, sin reintento)', async () => {
    const e = montar(SOLO, { perfil: () => Promise.resolve(err('PROFILE_NOT_FOUND')) });
    await abrir(e);
    expect(e.el['perfil-aviso'].hidden).toBe(false);
    expect(e.el['perfil-aviso-texto'].textContent).toBe('No hay un ITF vigente registrado para este pozo.');
    expect(e.el['perfil-vigente'].hidden).toBe(true);
    expect(e.el['btn-perfil-reintentar'].hidden).toBe(true);
    expect(e.el['perfil-imagen'].getAttribute('src')).toBeNull();
  });

  test('"no se sabe" NO dice que no hay ITF; error de servicio ofrece reintentar y se recupera', async () => {
    const perfil = jest.fn().mockResolvedValueOnce(err('ITF_STATE_UNKNOWN')).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok(IMG));
    const e = montar(SOLO, { perfil });
    await abrir(e);
    expect(e.el['perfil-aviso-texto'].textContent).not.toMatch(/No hay un ITF vigente/);
    expect(e.el['btn-perfil-reintentar'].hidden).toBe(true);
    e.c.itfPerfilController_abrir('14-0001');
    await flush();
    expect(e.el['btn-perfil-reintentar'].hidden).toBe(false);
    e.el['btn-perfil-reintentar'].click();
    await flush();
    expect(e.el['perfil-vigente'].hidden).toBe(false);
    expect(e.el['perfil-aviso'].hidden).toBe(true);
  });

  test('sesion vencida: flujo global (sin mensaje propio)', async () => {
    const e = montar(SOLO, { perfil: () => Promise.resolve(err('UNAUTHORIZED')) });
    await abrir(e);
    expect(e.estado.vencida).toBe(1);
  });

  test('una imagen con tipo o base64 raro NO llega a src', async () => {
    const e = montar(SOLO, { perfil: () => Promise.resolve(ok({ wellId: '14-0001', mimeType: 'text/html', imageBase64: 'x"onerror=' })) });
    await abrir(e);
    expect(e.el['perfil-imagen'].getAttribute('src')).toBeNull();
    expect(e.el['perfil-vigente'].hidden).toBe(true);
  });
});

describe('matriz de permisos: que se ofrece', () => {
  const casos = [
    // [nombre, permisos, colab, proponer, mis, validador]
    ['solo perfil', SOLO, false, false, false, false],
    ['perfil + perfil_subir', PROPONE, true, true, true, false],
    ['perfil + perfil_validar', VALIDA, true, false, false, true],
    ['los tres', AMBOS, true, true, true, true],
    ['perfil_subir sin perfil', { perfil_subir: true }, false, false, false, false],
    ['perfil_validar sin perfil', { perfil_validar: true }, false, false, false, false],
    ['truthy invalido ("SI")', { perfil: true, perfil_subir: 'SI', perfil_validar: 'SI' }, false, false, false, false],
    ['truthy invalido (1)', { perfil: true, perfil_subir: 1, perfil_validar: 1 }, false, false, false, false],
    ['sin permisos', {}, false, false, false, false]
  ];
  test.each(casos)('%s', async (_n, permisos, colab, proponer, mis, validador) => {
    const e = montar(permisos, { perfil: () => Promise.resolve(ok(IMG)) });
    await abrir(e);
    // sin `perfil` exacto ni siquiera se pide el ITF; con el, siempre llega a LISTO
    expect(e.el['itf-colab'].hidden).toBe(!colab);
    expect(e.el['itf-proponer-bloque'].hidden).toBe(!proponer);
    expect(e.el['itf-mis-bloque'].hidden).toBe(!mis);
    expect(e.el['itf-validador-bloque'].hidden).toBe(!validador);
    expect(e.el['btn-itf-retirar-vigente'].hidden).toBe(!validador);          // con vigente (LISTO)
  });

  test('NO hay vigente: "Proponer ITF"; con vigente: "Proponer nueva versión"; el validador no ve "Retirar ITF vigente" si no hay vigente', async () => {
    const e = montar(AMBOS, { perfil: () => Promise.resolve(err('PROFILE_NOT_FOUND')) });
    await abrir(e);
    expect(e.el['btn-itf-proponer'].textContent).toBe('Proponer ITF');
    expect(e.el['itf-proponer-bloque'].hidden).toBe(false);
    expect(e.el['btn-itf-retirar-vigente'].hidden).toBe(true);
    const e2 = montar(AMBOS);
    await abrir(e2);
    expect(e2.el['btn-itf-proponer'].textContent).toBe('Proponer nueva versión');
    expect(JSON.stringify([e.el['btn-itf-proponer'].textContent, e2.el['btn-itf-proponer'].textContent])).not.toMatch(/definitivo/i);
  });

  test('si no se pudo saber el estado del pozo (error), NO se ofrece proponer', async () => {
    const e = montar(PROPONE, { perfil: () => Promise.resolve(err('ITF_STATE_UNKNOWN')) });
    await abrir(e);
    expect(e.el['itf-proponer-bloque'].hidden).toBe(true);
  });

  test('el permiso se vuelve a mirar al actuar: si se pierde, lo colaborativo desaparece al repintar', async () => {
    const e = montar(PROPONE);
    await abrir(e);
    expect(e.el['itf-colab'].hidden).toBe(false);
    e.estado.permisos = SOLO;
    e.c.itfPerfilController_refrescar();
    await flush();
    expect(e.el['itf-colab'].hidden).toBe(true);
  });
});

describe('Proponer', () => {
  const ARCH = { type: 'image/jpeg', size: 3000000, name: 'ITF escaneado.jpg' };
  async function conPanel(permisos, opc) {
    const e = montar(permisos || PROPONE, opc);
    await abrir(e);
    e.el['btn-itf-proponer'].click();
    return e;
  }
  const elegir = async (e, archivo) => { e.el['itf-archivo-input'].files = [archivo || ARCH]; e.el['itf-archivo-input'].emitir('change'); await flush(); };

  test('abrir el panel: titulo segun haya vigente, aria-expanded y foco en "Elegir imagen"; sin archivo no se puede enviar', async () => {
    const e = await conPanel();
    expect(e.el['itf-proponer-panel'].hidden).toBe(false);
    expect(e.el['btn-itf-proponer'].getAttribute('aria-expanded')).toBe('true');
    expect(e.el['itf-prop-titulo'].textContent).toBe('Proponer nueva versión');
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(true);
    expect(document_activeId(e)).toBe('btn-itf-elegir');
  });
  const document_activeId = (e) => (e.Nodo.enFoco ? e.Nodo.enFoco.id : null);

  test('elegir una imagen: preview, nombre, tamano original, tamano final y resolucion; el boton se habilita', async () => {
    const e = await conPanel();
    await elegir(e);
    expect(e.api.itfImagen_preparar).toHaveBeenCalledWith(ARCH);
    expect(e.el['itf-prop-resumen'].hidden).toBe(false);
    expect(e.el['itf-prop-preview'].getAttribute('src')).toBe('blob:prev');
    expect(e.el['itf-prop-nombre'].textContent).toBe('ITF escaneado.jpg');
    expect(e.el['itf-prop-tam-original'].textContent).toBe('2,9 MB');
    expect(e.el['itf-prop-tam-final'].textContent).toBe('781 KB');
    expect(e.el['itf-prop-dim'].textContent).toBe('2400 × 1680 px');
    expect(e.el['itf-prop-accion-img'].textContent).toMatch(/se redujo/);
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(false);
    expect(e.el['itf-archivo-input'].value).toBe('');
  });

  test('un archivo que no es JPEG/PNG: mensaje de error y NO se prepara ni se envia', async () => {
    const e = await conPanel();
    await elegir(e, { type: 'application/pdf', size: 1000, name: 'a.pdf' });
    expect(e.el['itf-prop-mensaje'].hidden).toBe(false);
    expect(e.el['itf-prop-mensaje'].textContent).toBe('Solo se aceptan imágenes JPEG o PNG.');
    expect(e.el['itf-prop-mensaje'].getAttribute('role')).toBe('alert');
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(true);
    expect(e.api.itfImagen_preparar).not.toHaveBeenCalled();
  });

  test('si aun reducida pasa de 3 MB: se BLOQUEA con el tamano y el boton queda deshabilitado', async () => {
    const e = await conPanel(PROPONE, { preparar: () => Promise.resolve({ base64: 'QUJD', bytes: 4 * 1024 * 1024, mimeType: 'image/jpeg', ancho: 1600, alto: 1100, accion: 'REDUCIDA', previewUrl: 'blob:grande' }) });
    await elegir(e);
    expect(e.el['itf-prop-mensaje'].textContent).toMatch(/4 MB aun reducida/);
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(true);
  });

  test('enviar: payload exacto (sin email ni actor), "Enviando…" y doble toque = UN envio; al exito, "ITF propuesto. Queda pendiente de validación." y el vigente sigue visible', async () => {
    let resolver;
    const e = await conPanel(PROPONE, { proponer: () => new Promise((r) => { resolver = r; }) });
    await elegir(e);
    e.el['btn-itf-prop-enviar'].click();
    e.el['btn-itf-prop-enviar'].emitir('click');
    expect(e.el['btn-itf-prop-enviar'].textContent).toBe('Enviando…');
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(true);
    expect(e.el['btn-itf-elegir'].disabled).toBe(true);
    resolver(ok({ documentoId: D(50), wellId: '14-0001', estado: 'PROPUESTO', warnings: [] }));
    await flush();
    expect(e.api.apiProponerItf).toHaveBeenCalledTimes(1);
    const [token, payload] = e.api.apiProponerItf.mock.calls[0];
    expect(token).toBe('tok');
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'imageBase64', 'mimeType', 'nombreOriginal', 'wellId']);
    expect(e.el['itf-prop-mensaje'].textContent).toBe('ITF propuesto. Queda pendiente de validación.');
    expect(e.el['itf-prop-resumen'].hidden).toBe(true);
    expect(e.el['perfil-vigente'].hidden).toBe(false);                      // el vigente sigue ahi
    expect(e.ctx.URL.revokeObjectURL).toHaveBeenCalledWith('blob:prev');
  });

  test('un fallo se reintenta con el MISMO clientRequestId; "Elegir otra imagen" crea uno nuevo', async () => {
    const proponer = jest.fn().mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(err('RED')).mockResolvedValue(ok({ documentoId: D(50) }));
    const e = await conPanel(PROPONE, { proponer });
    await elegir(e);
    e.el['btn-itf-prop-enviar'].click();
    await flush();
    expect(e.el['btn-itf-prop-enviar'].textContent).toBe('Reintentar envío');
    expect(e.el['btn-itf-prop-enviar'].disabled).toBe(false);
    expect(e.el['itf-prop-mensaje'].getAttribute('role')).toBe('alert');
    e.el['btn-itf-prop-enviar'].click();
    await flush();
    e.el['btn-itf-prop-enviar'].click();
    await flush();
    const ids = proponer.mock.calls.map((c) => c[0] === undefined ? null : c[1].clientRequestId);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(1);
    await elegir(e, { type: 'image/png', size: 2000, name: 'otra.png' });
    e.el['btn-itf-prop-enviar'].click();
    await flush();
    expect(proponer.mock.calls[3][1].clientRequestId).not.toBe(ids[0]);
  });

  test('Cerrar el panel libera el preview y descarta lo elegido', async () => {
    const e = await conPanel();
    await elegir(e);
    e.el['btn-itf-prop-cancelar'].click();
    expect(e.el['itf-proponer-panel'].hidden).toBe(true);
    expect(e.ctx.URL.revokeObjectURL).toHaveBeenCalledWith('blob:prev');
    expect(e.el['itf-prop-preview'].getAttribute('src')).toBeNull();
  });

  test('un nombre de archivo malicioso se muestra como TEXTO', async () => {
    const e = await conPanel();
    await elegir(e, { type: 'image/jpeg', size: 1000, name: '<img src=x onerror=alert(1)>.jpg' });
    expect(e.el['itf-prop-nombre'].textContent).toBe('<img src=x onerror=alert(1)>.jpg');
    expect(e.el['itf-prop-nombre'].children).toHaveLength(0);
  });

  test('despues de proponer, "Mis propuestas" (si esta abierta) se vuelve a pedir', async () => {
    const e = await conPanel();
    e.el['btn-itf-mis-propuestas'].click();
    await flush();
    const antes = e.api.apiGetMisPropuestasItf.mock.calls.length;
    await elegir(e);
    e.el['btn-itf-prop-enviar'].click();
    await flush();
    expect(e.api.apiGetMisPropuestasItf.mock.calls.length).toBe(antes + 1);
  });
});

describe('Mis propuestas y retiro de la propia propuesta', () => {
  async function conMis(permisos, opc) {
    const e = montar(permisos || PROPONE, opc);
    await abrir(e);
    e.el['btn-itf-mis-propuestas'].click();
    await flush();
    return e;
  }

  test('abrir pide las de ESTE pozo; las tarjetas muestran pozo, estado, archivo, tamano y fechas; solo la pendiente ofrece "Retirar propuesta"', async () => {
    const e = await conMis();
    expect(e.api.apiGetMisPropuestasItf).toHaveBeenCalledWith('tok', '14-0001', 20, undefined);
    const lista = e.el['itf-mis-lista'];
    expect(lista.children).toHaveLength(2);
    const texto = lista.textContent;
    expect(texto).toContain('Pendiente de validación');
    expect(texto).toContain('Rechazada');
    expect(texto).toContain('Motivo: No se puede leer');
    expect(lista.children[0].boton('Retirar propuesta')).toBeTruthy();
    expect(lista.children[1].boton('Retirar propuesta')).toBeUndefined();
    expect(texto).not.toMatch(/@|storage|sha256/);
    expect(e.el['btn-itf-mis-pozo'].getAttribute('aria-pressed')).toBe('true');
  });

  test('"De todos los pozos" pide sin wellId; vacia y error con reintento', async () => {
    const mis = jest.fn().mockResolvedValueOnce(ok({ items: [], siguienteCursor: null, total: 0, incompleta: false })).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok({ items: [propuesta(1)], siguienteCursor: null, total: 1 }));
    const e = await conMis(PROPONE, { mis });
    expect(e.el['itf-mis-vacio'].hidden).toBe(false);
    expect(e.el['itf-mis-vacio'].textContent).toBe('No tenés propuestas de ITF para este pozo.');
    e.el['btn-itf-mis-todos'].click();
    await flush();
    expect(mis).toHaveBeenLastCalledWith('tok', null, 20, undefined);
    expect(e.el['itf-mis-error'].hidden).toBe(false);
    expect(e.el['btn-itf-mis-todos'].getAttribute('aria-pressed')).toBe('true');
    e.el['btn-itf-mis-reintentar'].click();
    await flush();
    expect(e.el['itf-mis-error'].hidden).toBe(true);
    expect(e.el['itf-mis-lista'].children).toHaveLength(1);
  });

  test('"Ver más" agrega la siguiente pagina; un propuesta con nombre malicioso es TEXTO (sin elementos creados)', async () => {
    const mis = jest.fn().mockResolvedValueOnce(ok({ items: [propuesta(1, { nombreOriginal: '<script>alert(1)</script>.jpg' })], siguienteCursor: 's1:3', total: 2 })).mockResolvedValueOnce(ok({ items: [propuesta(2)], siguienteCursor: null, total: 2 }));
    const e = await conMis(PROPONE, { mis });
    expect(e.el['btn-itf-mis-mas'].hidden).toBe(false);
    expect(e.el['itf-mis-lista'].textContent).toContain('<script>alert(1)</script>.jpg');
    expect(e.el['itf-mis-lista'].descendientes().filter((d) => d.tag === 'script' || d.tag === 'img')).toHaveLength(0);
    e.el['btn-itf-mis-mas'].click();
    await flush();
    expect(e.el['itf-mis-lista'].children).toHaveLength(2);
    expect(e.el['btn-itf-mis-mas'].hidden).toBe(true);
  });

  test('retirar: confirmacion con foco en Cancelar, payload exacto, lista vuelta a pedir, aviso y foco devuelto', async () => {
    const mis = jest.fn()
      .mockResolvedValueOnce(ok({ items: [propuesta(1)], siguienteCursor: null, total: 1 }))
      .mockResolvedValueOnce(ok({ items: [propuesta(1, { estado: 'RETIRADO', puedeRetirar: false, retiradaPorMi: true })], siguienteCursor: null, total: 1 }));
    const e = await conMis(PROPONE, { mis });
    e.el['itf-mis-lista'].children[0].boton('Retirar propuesta').click();
    expect(e.el['itf-retiro-overlay'].hidden).toBe(false);
    expect(e.el['itf-retiro-entidad'].textContent).toBe('Pozo 14-0001 · itf1.jpg');
    expect(e.Nodo.enFoco.id).toBe('btn-itf-retiro-cancelar');
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(true);
    e.el['btn-itf-retiro-confirmar'].click();
    expect(e.el['btn-itf-retiro-confirmar'].textContent).toBe('Retirando…');
    expect(e.el['btn-itf-retiro-confirmar'].disabled).toBe(true);
    await flush();
    expect(e.api.apiRetirarPropuestaItf).toHaveBeenCalledTimes(1);
    const [token, payload] = e.api.apiRetirarPropuestaItf.mock.calls[0];
    expect(token).toBe('tok');
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'documentoId']);
    expect(payload.documentoId).toBe(D(1));
    expect(e.el['itf-retiro-overlay'].hidden).toBe(true);
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(false);
    expect(mis).toHaveBeenCalledTimes(2);
    expect(e.el['itf-mis-aviso'].textContent).toBe('Propuesta retirada.');
    expect(e.el['itf-mis-lista'].textContent).toContain('Retirada');
    expect(e.el['itf-mis-lista'].children[0].boton('Retirar propuesta')).toBeUndefined();     // ya no se ofrece
  });

  test('Escape cancela el retiro sin enviar; Tab da la vuelta dentro del dialogo; el foco vuelve al boton', async () => {
    const e = await conMis();
    const boton = e.el['itf-mis-lista'].children[0].boton('Retirar propuesta');
    boton.click();
    const tab = (shift) => { const ev = { key: 'Tab', shiftKey: shift, preventDefault: jest.fn() }; e.el['itf-retiro-overlay'].emitir('keydown', ev); return ev; };
    e.Nodo.enFoco = e.el['btn-itf-retiro-confirmar'];
    expect(tab(false).preventDefault).toHaveBeenCalled();
    expect(e.Nodo.enFoco.id).toBe('btn-itf-retiro-cerrar');
    e.Nodo.enFoco = e.el['btn-itf-retiro-cerrar'];
    tab(true);
    expect(e.Nodo.enFoco.id).toBe('btn-itf-retiro-confirmar');
    e.el['itf-retiro-overlay'].emitir('keydown', { key: 'Escape', stopPropagation: jest.fn() });
    expect(e.el['itf-retiro-overlay'].hidden).toBe(true);
    expect(e.api.apiRetirarPropuestaItf).not.toHaveBeenCalled();
    expect(e.Nodo.enFoco).toBe(boton);
  });

  test('retirar una propuesta que ya no esta pendiente: se cierra el dialogo, se avisa y se actualiza la lista', async () => {
    const mis = jest.fn().mockResolvedValueOnce(ok({ items: [propuesta(1)], siguienteCursor: null, total: 1 })).mockResolvedValue(ok({ items: [propuesta(1, { estado: 'APROBADO', puedeRetirar: false })], siguienteCursor: null, total: 1 }));
    const e = await conMis(PROPONE, { mis, retirar: () => Promise.resolve(err('DOCUMENTO_NO_PROPUESTO')) });
    e.el['itf-mis-lista'].children[0].boton('Retirar propuesta').click();
    e.el['btn-itf-retiro-confirmar'].click();
    await flush();
    expect(e.el['itf-retiro-overlay'].hidden).toBe(true);
    expect(e.el['itf-mis-aviso'].textContent).toMatch(/ya no estaba pendiente/);
    expect(e.el['itf-mis-lista'].textContent).toContain('Aprobada');
  });

  test('un fallo transitorio deja el dialogo abierto con el error y se reintenta con el mismo id', async () => {
    const retirar = jest.fn().mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValue(ok({ documentoId: D(1) }));
    const e = await conMis(PROPONE, { retirar });
    e.el['itf-mis-lista'].children[0].boton('Retirar propuesta').click();
    e.el['btn-itf-retiro-confirmar'].click();
    await flush();
    expect(e.el['itf-retiro-overlay'].hidden).toBe(false);
    expect(e.el['itf-retiro-error'].hidden).toBe(false);
    e.el['btn-itf-retiro-confirmar'].click();
    await flush();
    expect(retirar.mock.calls[0][1].clientRequestId).toBe(retirar.mock.calls[1][1].clientRequestId);
  });

  test('sin perfil_subir NO hay "Mis propuestas" ni se pide nada', async () => {
    const e = montar(VALIDA);
    await abrir(e);
    expect(e.el['itf-mis-bloque'].hidden).toBe(true);
    expect(e.api.apiGetMisPropuestasItf).not.toHaveBeenCalled();
  });
});

describe('herramientas del validador en el Perfil', () => {
  test('"Historial de ITF" abre el historial del pozo; "Retirar ITF vigente" pide la confirmacion; ambos avisan al cambiar', async () => {
    const e = montar(VALIDA);
    await abrir(e);
    e.el['btn-itf-historial'].click();
    expect(e.api.itfModeracionController_abrirHistorial).toHaveBeenCalledWith('14-0001', e.el['btn-itf-historial'], expect.objectContaining({ alCambio: expect.any(Function) }));
    e.el['btn-itf-retirar-vigente'].click();
    expect(e.api.itfModeracionController_pedirRetirarVigente).toHaveBeenCalledWith('14-0001', e.el['btn-itf-retirar-vigente'], expect.objectContaining({ alCambio: expect.any(Function) }));
    // despues de la accion: se avisa y el ITF que se ve se vuelve a pedir (nunca queda el anterior)
    const antes = e.api.apiGetProfile.mock.calls.length;
    e.api.itfModeracionController_pedirRetirarVigente.mock.calls[0][2].alCambio('ITF retirado. El pozo quedó sin ITF vigente.');
    await flush();
    expect(e.api.apiGetProfile.mock.calls.length).toBe(antes + 1);
    expect(e.el['itf-colab-aviso'].textContent).toBe('ITF retirado. El pozo quedó sin ITF vigente.');
    expect(e.el['itf-colab-aviso'].hidden).toBe(false);
  });
});

describe('cierre de sesion y cambio de pozo', () => {
  test('logout: no queda imagen, ni propuestas, ni preview, ni dialogo; una respuesta tardia no revive nada', async () => {
    let resolver;
    const e = montar(AMBOS, { mis: () => new Promise((r) => { resolver = r; }) });
    await abrir(e);
    e.el['btn-itf-mis-propuestas'].click();
    e.c.itfPerfilController_reset();
    resolver(ok({ items: [propuesta(1)], siguienteCursor: null, total: 1 }));
    await flush();
    expect(e.el['perfil-vigente'].hidden).toBe(true);
    expect(e.el['perfil-imagen'].getAttribute('src')).toBeNull();
    expect(e.el['perfil-guardar-a'].href).toBeUndefined();
    expect(e.el['itf-colab'].hidden).toBe(true);
    expect(e.el['itf-mis-lista'].children).toHaveLength(0);
    expect(e.el['itf-retiro-overlay'].hidden).toBe(true);
    expect(e.el['perfil-wellid'].textContent).toBe('');
    expect(e.c.itfPerfilController_hayModalAbierto()).toBe(false);
  });

  test('abrir OTRO pozo descarta lo del anterior (panel cerrado, lista vacia, mensajes limpios)', async () => {
    const e = montar(AMBOS);
    await abrir(e, '14-0001');
    e.el['btn-itf-proponer'].click();
    e.el['btn-itf-mis-propuestas'].click();
    await flush();
    await abrir(e, '14-0002');
    expect(e.el['itf-proponer-panel'].hidden).toBe(true);
    expect(e.el['itf-mis-panel'].hidden).toBe(true);
    expect(e.el['perfil-wellid'].textContent).toBe('14-0002');
    expect(e.api.apiGetProfile).toHaveBeenLastCalledWith('tok', '14-0002');
  });
});

describe('todo texto del servidor va como texto (jamas innerHTML)', () => {
  test('el controlador no usa innerHTML / insertAdjacentHTML / document.write / eval', () => {
    const { leer } = require('./fixtures/domFalsoItf');
    const fuente = leer(__dirname, 'itfPerfil.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|\beval\(|outerHTML/);
  });
});
