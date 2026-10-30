// E9-6: controlador DOM de la moderacion de ITF (js/itfModeracion.js) con un DOM falso que LANZA ante innerHTML: la cola paginada (sin cargar nada hasta abrirla, sin imagenes), "Ver pozo", el visor con
// comparacion y zoom, aprobar / rechazar con motivo (aprobar un reemplazo declara el vigente que se vio), VIGENTE_CAMBIO sin reintento, historial con "Restaurar", "Retirar ITF vigente", foco y teclado, todo
// texto de datos como texto, y el cierre de sesion.
const { crearEntorno, flush } = require('./fixtures/domFalsoItf');

const VALIDA = { perfil: true, perfil_validar: true };
const D = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const ok = (data) => ({ status: 'ok', data: data });
const err = (code) => ({ status: 'error', code: code });
const pend = (n, extra) => Object.assign({ documentoId: D(n), wellId: '14-000' + n, mimeType: 'image/jpeg', bytes: 700000, nombreOriginal: 'itf' + n + '.jpg', nombreProponente: 'Ana ' + n, timestampUtc: '2026-10-28T15:20:00.000Z', autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, warningMensaje: null }, extra || {});
const cola = (items, cursor, total) => ok({ items: items, siguienteCursor: cursor || null, total: total === undefined ? items.length : total, pozosSinDerivar: 0 });
const docDto = (id, extra) => Object.assign({ documentoId: id, origen: 'E9', wellId: '14-0001', estado: 'PROPUESTO', implicito: false, mimeType: 'image/jpeg', bytes: 700000, nombreOriginal: 'prop.jpg', nombreProponente: 'Ana', propuestoEn: '2026-10-28T15:20:00.000Z', autoPropuestaPropia: false, warningDuplicadoOtroPozo: false, restaurable: false }, extra || {});
const LEGACY = { documentoId: 'LEGACY:14-0001', origen: 'LEGACY', wellId: '14-0001', estado: 'VIGENTE', implicito: true, mimeType: 'image/jpeg', bytes: 600000, nombreOriginal: null, nombreProponente: null, propuestoEn: null, autoPropuestaPropia: false };
const documento = (d, vigenteId, extraPozo) => ok({ documento: d, pozo: Object.assign({ wellId: d.wellId, vigenteActualDocumentoId: vigenteId === undefined ? 'LEGACY:14-0001' : vigenteId, vigenteIndeterminado: false }, extraPozo || {}), imagen: { mimeType: d.mimeType, imagenBase64: d.documentoId === 'LEGACY:14-0001' ? 'VklH' : 'UFJP' } });
const historial = (vigente, extra) => ok(Object.assign({
  wellId: '14-0001',
  pozo: { wellId: '14-0001', vigenteActualDocumentoId: vigente },
  documentos: vigente === null ? [docDto(D(3), { estado: 'REEMPLAZADO', restaurable: true, vigenteDesde: '2026-09-02T10:00:00.000Z' })] : [vigente === 'LEGACY:14-0001' ? LEGACY : docDto(vigente, { estado: 'VIGENTE' }), docDto(D(3), { estado: 'REEMPLAZADO', restaurable: true, vigenteDesde: '2026-09-02T10:00:00.000Z' })],
  historial: [{ evento: 'ITF_APROBADO', documentoId: D(3), documentoReemplazadoId: '', nombre: 'Vera', timestamp: '2026-09-02T10:00:00.000Z', motivoCodigo: 'MEJOR_CALIDAD', motivoTexto: '', detalle: 'Se aprobo.' }, { evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', documentoReemplazadoId: '', nombre: 'Sistema', timestamp: '2026-09-02T10:00:00.000Z', motivoCodigo: '', motivoTexto: '', detalle: 'interno' }]
}, extra || {}));
const escrito = (evento) => ok({ documentoId: D(1), wellId: '14-0001', evento: evento || 'ITF_APROBADO', estado: 'VIGENTE', reintento: false });

function montar(permisos, opc) {
  const o = opc || {};
  const estado = { permisos: permisos || VALIDA, vencida: 0 };
  const hooks = { onVerPozo: jest.fn(), onCambioDeVigente: jest.fn() };
  const api = {
    apiGetItfPendientes: jest.fn(o.pendientes || (() => Promise.resolve(cola([pend(1, { warningDuplicadoOtroPozo: true, warningMensaje: 'Este mismo archivo aparece asociado a otro pozo.' }), pend(2)])))),
    apiGetItfDocumentoModeracion: jest.fn(o.documento || ((tok, id) => Promise.resolve(id === 'LEGACY:14-0001' ? documento(LEGACY) : documento(docDto(id))))),
    apiGetHistorialItf: jest.fn(o.historial || (() => Promise.resolve(historial('LEGACY:14-0001')))),
    apiAprobarItf: jest.fn(o.aprobar || (() => Promise.resolve(escrito('ITF_APROBADO')))),
    apiRechazarItf: jest.fn(o.rechazar || (() => Promise.resolve(escrito('ITF_RECHAZADO')))),
    apiRetirarItf: jest.fn(o.retirar || (() => Promise.resolve(escrito('ITF_RETIRADO')))),
    apiRevertirItf: jest.fn(o.revertir || (() => Promise.resolve(escrito('ITF_REVERTIDO'))))
  };
  const entorno = crearEntorno(['itfLogic.js', 'itfFlujosLogic.js', 'itfModeracion.js'], api);
  entorno.ctx.itfModeracionController_inicializar(() => ({ sessionToken: 'tok', permisos: estado.permisos, onSessionExpired: () => { estado.vencida += 1; } }), hooks);
  return Object.assign(entorno, { api, estado, hooks, c: entorno.ctx });
}

async function abrirCola(e) {
  e.c.itfModeracionController_abrir();
  await flush();
}
const tarjeta = (e, i) => e.el['itf-cola-lista'].children[i || 0];
const elegirMotivo = (e, codigo) => { e.el['itf-accion-motivo'].value = codigo; e.el['itf-accion-motivo'].emitir('change'); };
const escribir = (e, texto) => { e.el['itf-accion-texto'].value = texto; e.el['itf-accion-texto'].emitir('input'); };

describe('la cola', () => {
  test('inicializar NO pide nada; abrir pide la primera pagina (una llamada, sin imagenes)', async () => {
    const e = montar();
    expect(e.api.apiGetItfPendientes).not.toHaveBeenCalled();
    await abrirCola(e);
    expect(e.api.apiGetItfPendientes).toHaveBeenCalledTimes(1);
    expect(e.api.apiGetItfPendientes).toHaveBeenCalledWith('tok', 20, undefined);
    expect(e.api.apiGetItfDocumentoModeracion).not.toHaveBeenCalled();
    expect(e.el['itf-cola-lista'].children).toHaveLength(2);
    expect(e.el['itf-cola-total'].textContent).toBe('2 propuestas pendientes');
  });

  test('cada tarjeta: pozo, archivo, tamano, proponente, fecha, advertencia (si corresponde) y las 5 acciones; ninguna imagen', async () => {
    const e = montar();
    await abrirCola(e);
    const t = tarjeta(e, 0);
    expect(t.textContent).toContain('Pozo 14-0001');
    expect(t.textContent).toContain('itf1.jpg · 684 KB');
    expect(t.textContent).toContain('Propuesto por Ana 1 · 28/10/2026 12:20');
    expect(t.textContent).toContain('Este mismo archivo aparece asociado a otro pozo.');
    expect(t.botones().map((b) => b.textContent)).toEqual(['Ver documento', 'Ver pozo', 'Historial', 'Aprobar', 'Rechazar']);
    expect(t.descendientes().filter((d) => d.tag === 'img')).toHaveLength(0);
    expect(tarjeta(e, 1).textContent).not.toContain('asociado a otro pozo');
    t.botones().forEach((b) => expect(b.getAttribute('aria-label')).toMatch(/14-000/));
    expect(t.textContent).not.toMatch(/@|LEGACY|storage/);
  });

  test.each([['solo perfil', { perfil: true }], ['perfil + perfil_subir', { perfil: true, perfil_subir: true }], ['perfil_validar sin perfil', { perfil_validar: true }], ['truthy', { perfil: true, perfil_validar: 'SI' }]])('%s: PERMISSION_DENIED y no se pide nada', async (_n, permisos) => {
    const e = montar(permisos);
    await abrirCola(e);
    expect(e.api.apiGetItfPendientes).not.toHaveBeenCalled();
    expect(e.el['itf-cola-error'].hidden).toBe(false);
    expect(e.el['itf-cola-error-texto'].textContent).toBe('No tenés permiso para hacer esto.');
  });

  test('vacia: mensaje; error: texto y reintento; pozos con historial roto: se avisa', async () => {
    const pendientes = jest.fn().mockResolvedValueOnce(cola([])).mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValueOnce(ok({ items: [pend(1)], siguienteCursor: null, total: 1, pozosSinDerivar: 2 }));
    const e = montar(VALIDA, { pendientes });
    await abrirCola(e);
    expect(e.el['itf-cola-vacio'].hidden).toBe(false);
    e.el['btn-itf-cola-actualizar'].click();
    await flush();
    expect(e.el['itf-cola-error'].hidden).toBe(false);
    expect(e.el['itf-cola-vacio'].hidden).toBe(true);
    e.el['btn-itf-cola-reintentar'].click();
    await flush();
    expect(e.el['itf-cola-error'].hidden).toBe(true);
    expect(e.el['itf-cola-sin-derivar'].hidden).toBe(false);
    expect(e.el['itf-cola-total'].textContent).toBe('1 propuesta pendiente');
  });

  test('paginacion: "Ver más" desde el cursor, sin repetir; el boton se oculta al final', async () => {
    const pendientes = jest.fn().mockResolvedValueOnce(cola([pend(1), pend(2)], 's1:10', 3)).mockResolvedValueOnce(cola([pend(2), pend(3)], null, 3));
    const e = montar(VALIDA, { pendientes });
    await abrirCola(e);
    expect(e.el['btn-itf-cola-mas'].hidden).toBe(false);
    e.el['btn-itf-cola-mas'].click();
    await flush();
    expect(pendientes).toHaveBeenLastCalledWith('tok', 20, 's1:10');
    expect(e.el['itf-cola-lista'].children).toHaveLength(3);
    expect(e.el['btn-itf-cola-mas'].hidden).toBe(true);
  });

  test('datos del servidor como TEXTO: nombre de archivo y de persona maliciosos no crean elementos', async () => {
    const e = montar(VALIDA, { pendientes: () => Promise.resolve(cola([pend(1, { nombreOriginal: '<img src=x onerror=alert(1)>', nombreProponente: '<b>Ana</b>' })])) });
    await abrirCola(e);
    const t = tarjeta(e, 0);
    expect(t.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(t.textContent).toContain('<b>Ana</b>');
    expect(t.descendientes().filter((d) => d.tag === 'img' || d.tag === 'b')).toHaveLength(0);
  });

  test('"Ver pozo" navega al pozo (callback de la app) sin pedir nada mas', async () => {
    const e = montar();
    await abrirCola(e);
    tarjeta(e, 1).boton('Ver pozo').click();
    expect(e.hooks.onVerPozo).toHaveBeenCalledWith('14-0002');
    expect(e.api.apiGetItfDocumentoModeracion).not.toHaveBeenCalled();
  });

  test('volver desde "Ver pozo" CONSERVA la cola ya cargada (no vuelve a pedir ni pierde la pagina)', async () => {
    const e = montar();
    await abrirCola(e);
    await e.c.itfModeracionController_volver();
    expect(e.api.apiGetItfPendientes).toHaveBeenCalledTimes(1);
    expect(e.el['itf-cola-lista'].children).toHaveLength(2);
  });
});

describe('visor y comparacion', () => {
  async function conVisor(opc) {
    const e = montar(VALIDA, opc);
    await abrirCola(e);
    tarjeta(e, 0).boton('Ver documento').click();
    await flush();
    return e;
  }

  test('"Ver documento": pide SOLO ese documento, muestra la imagen grande y los datos seguros; el foco va al cierre', async () => {
    const e = await conVisor();
    expect(e.api.apiGetItfDocumentoModeracion).toHaveBeenCalledTimes(1);
    expect(e.api.apiGetItfDocumentoModeracion).toHaveBeenCalledWith('tok', D(1));
    expect(e.el['itf-vis-overlay'].hidden).toBe(false);
    expect(e.el['itf-vis-img-prop'].getAttribute('src')).toBe('data:image/jpeg;base64,UFJP');
    expect(e.el['itf-vis-pozo'].textContent).toBe('Pozo 14-0001');
    expect(e.el['itf-vis-nombre'].textContent).toBe('prop.jpg');
    expect(e.el['itf-vis-estado'].textContent).toBe('Propuesto');
    expect(e.el['itf-vis-proponente'].textContent).toBe('Ana · 28/10/2026 12:20');
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(true);
    expect(e.el['btn-itf-vis-aprobar'].hidden).toBe(false);
    expect(e.el['btn-itf-vis-rechazar'].hidden).toBe(false);
    expect(e.el['btn-itf-vis-restaurar'].hidden).toBe(true);
    expect(e.el['btn-itf-vis-comparar'].hidden).toBe(false);
  });

  test('comparar: baja el vigente (una vez), lo muestra como "ITF vigente" y ofrece pestañas; "Dejar de comparar" vuelve', async () => {
    const e = await conVisor();
    e.el['btn-itf-vis-comparar'].click();
    await flush();
    expect(e.api.apiGetItfDocumentoModeracion).toHaveBeenLastCalledWith('tok', 'LEGACY:14-0001');
    expect(e.el['itf-vis-paneles'].getAttribute('data-comparando')).toBe('true');
    expect(e.el['itf-vis-pane-vig'].hidden).toBe(false);
    expect(e.el['itf-vis-img-vig'].getAttribute('src')).toBe('data:image/jpeg;base64,VklH');
    expect(e.el['itf-vis-vistas'].hidden).toBe(false);
    expect(e.el['btn-itf-vis-comparar'].textContent).toBe('Dejar de comparar');
    e.el['btn-itf-vis-ver-vig'].click();
    expect(e.el['itf-vis-paneles'].getAttribute('data-vista')).toBe('VIGENTE');
    expect(e.el['btn-itf-vis-ver-vig'].getAttribute('aria-pressed')).toBe('true');
    expect(e.el['btn-itf-vis-ver-prop'].getAttribute('aria-pressed')).toBe('false');
    expect(JSON.stringify(e.el['itf-vis-overlay'].descendientes().map((d) => d.textContent))).not.toMatch(/LEGACY/);
    e.el['btn-itf-vis-comparar'].click();
    expect(e.el['itf-vis-pane-vig'].hidden).toBe(true);
    expect(e.el['btn-itf-vis-comparar'].textContent).toBe('Comparar con el ITF vigente');
  });

  test('zoom: acercar / alejar / ajustar actualizan el ancho de ambas imagenes y el texto; sin pasar de los limites', async () => {
    const e = await conVisor();
    expect(e.el['itf-vis-zoom-texto'].textContent).toBe('100%');
    e.el['btn-itf-vis-acercar'].click();
    e.el['btn-itf-vis-acercar'].click();
    expect(e.el['itf-vis-zoom-texto'].textContent).toBe('200%');
    expect(e.el['itf-vis-img-prop'].style.width).toBe('200%');
    expect(e.el['itf-vis-img-prop'].style.maxWidth).toBe('none');
    e.el['btn-itf-vis-ajustar'].click();
    expect(e.el['itf-vis-img-prop'].style.width).toBe('100%');
    expect(e.el['btn-itf-vis-alejar'].disabled).toBe(true);
    for (let i = 0; i < 8; i += 1) { e.el['btn-itf-vis-acercar'].click(); }
    expect(e.el['itf-vis-zoom-texto'].textContent).toBe('400%');
    expect(e.el['btn-itf-vis-acercar'].disabled).toBe(true);
  });

  test('un pozo SIN ITF vigente: no hay nada que comparar (y se dice)', async () => {
    const e = await conVisor({ documento: (tok, id) => Promise.resolve(documento(docDto(id), null)) });
    expect(e.el['btn-itf-vis-comparar'].hidden).toBe(true);
    expect(e.el['itf-vis-vigente-nota'].textContent).toBe('No hay un ITF vigente registrado para este pozo.');
  });

  test('error al abrir: mensaje y reintento; cerrar quita las imagenes y devuelve el foco', async () => {
    const documentoFn = jest.fn().mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValue(documento(docDto(D(1))));
    const e = await conVisor({ documento: documentoFn });
    expect(e.el['itf-vis-error'].hidden).toBe(false);
    expect(e.el['itf-vis-datos'].hidden).toBe(true);
    e.el['btn-itf-vis-reintentar'].click();
    await flush();
    expect(e.el['itf-vis-error'].hidden).toBe(true);
    expect(e.el['itf-vis-img-prop'].getAttribute('src')).toBeTruthy();
    const abridor = tarjeta(e, 0).boton('Ver documento');
    e.el['btn-itf-vis-cerrar2'].click();
    expect(e.el['itf-vis-overlay'].hidden).toBe(true);
    expect(e.el['itf-vis-img-prop'].getAttribute('src')).toBeNull();
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(false);
    expect(e.Nodo.enFoco).toBe(abridor);
  });

  test('Escape cierra el visor; Tab da la vuelta entre sus botones visibles', async () => {
    const e = await conVisor();
    const tab = (shift) => { const ev = { key: 'Tab', shiftKey: shift, preventDefault: jest.fn() }; e.el['itf-vis-overlay'].emitir('keydown', ev); return ev; };
    e.Nodo.enFoco = e.el['btn-itf-vis-cerrar2'];
    expect(tab(false).preventDefault).toHaveBeenCalled();
    expect(e.Nodo.enFoco.id).toBe('btn-itf-vis-cerrar');
    e.el['itf-vis-overlay'].emitir('keydown', { key: 'Escape', stopPropagation: jest.fn() });
    expect(e.el['itf-vis-overlay'].hidden).toBe(true);
  });

  test('un nombre malicioso del documento es TEXTO', async () => {
    const e = await conVisor({ documento: (tok, id) => Promise.resolve(documento(docDto(id, { nombreOriginal: '<script>x</script>', nombreProponente: '<i>Ana</i>' }))) });
    expect(e.el['itf-vis-nombre'].textContent).toBe('<script>x</script>');
    expect(e.el['itf-vis-proponente'].textContent).toContain('<i>Ana</i>');
    expect(e.el['itf-vis-nombre'].children).toHaveLength(0);
  });
});

describe('aprobar', () => {
  async function aprobarDesdeVisor(opc) {
    const e = montar(VALIDA, opc);
    await abrirCola(e);
    tarjeta(e, 0).boton('Ver documento').click();
    await flush();
    e.el['btn-itf-vis-aprobar'].click();
    return e;
  }

  test('con ITF vigente: avisa "reemplazará", pide motivo (catalogo de reemplazo) y envia el vigente que se VIO', async () => {
    const e = await aprobarDesdeVisor();
    expect(e.el['itf-accion-overlay'].hidden).toBe(false);
    expect(e.el['itf-accion-titulo'].textContent).toBe('Aprobar como ITF vigente');
    expect(e.el['itf-accion-aviso'].textContent).toBe('Esta aprobación reemplazará el ITF vigente actual.');
    expect(e.el['itf-accion-motivo-grupo'].hidden).toBe(false);
    expect(e.el['itf-accion-motivo'].children.map((o) => o.textContent)).toEqual(['Elegí un motivo…', 'Es una versión más reciente', 'Corrige un error del ITF actual', 'Tiene mejor calidad o se lee mejor', 'Es el documento completo', 'Otro motivo']);
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    expect(e.Nodo.enFoco.id).toBe('itf-accion-motivo');
    elegirMotivo(e, 'ACTUALIZACION');
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(false);
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiAprobarItf).toHaveBeenCalledTimes(1);
    const [token, payload] = e.api.apiAprobarItf.mock.calls[0];
    expect(token).toBe('tok');
    expect(payload).toMatchObject({ documentoId: D(1), vigenteEsperadoDocumentoId: 'LEGACY:14-0001', motivoCodigo: 'ACTUALIZACION' });
    expect(Object.keys(payload).sort()).toEqual(['clientRequestId', 'documentoId', 'motivoCodigo', 'vigenteEsperadoDocumentoId']);
  });

  test('exito: el dialogo y el visor se cierran, la cola se VUELVE A PEDIR con el aviso, el hub se entera y el historial/Perfil se refrescan', async () => {
    const pendientes = jest.fn().mockResolvedValueOnce(cola([pend(1), pend(2)])).mockResolvedValueOnce(cola([pend(2)]));
    const e = await aprobarDesdeVisor({ pendientes });
    elegirMotivo(e, 'MEJOR_CALIDAD');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.el['itf-vis-overlay'].hidden).toBe(true);
    expect(pendientes).toHaveBeenCalledTimes(2);
    expect(e.el['itf-cola-lista'].children).toHaveLength(1);
    expect(e.el['itf-cola-aviso'].textContent).toBe('ITF aprobado. Ya es el ITF vigente del pozo.');
    expect(e.hooks.onCambioDeVigente).toHaveBeenCalledWith('14-0001');
    expect(e.Nodo.enFoco === e.el['itf-cola-aviso'] || e.Nodo.enFoco === e.el['itf-cola-panel']).toBe(true);
  });

  test('doble toque en confirmar: UN solo envio; un fallo transitorio se reintenta con el MISMO id', async () => {
    const aprobar = jest.fn().mockResolvedValueOnce(err('SERVICE_UNAVAILABLE')).mockResolvedValue(escrito());
    const e = await aprobarDesdeVisor({ aprobar });
    elegirMotivo(e, 'ACTUALIZACION');
    e.el['btn-itf-accion-confirmar'].click();
    e.el['btn-itf-accion-confirmar'].emitir('click');
    expect(e.el['btn-itf-accion-confirmar'].textContent).toBe('Aprobando…');
    await flush();
    expect(aprobar).toHaveBeenCalledTimes(1);
    expect(e.el['itf-accion-error'].hidden).toBe(false);
    expect(e.el['itf-accion-overlay'].hidden).toBe(false);
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(aprobar.mock.calls[0][1].clientRequestId).toBe(aprobar.mock.calls[1][1].clientRequestId);
  });

  test('OTRO muestra el detalle (obligatorio, 3 a 300); sin detalle valido el boton sigue deshabilitado', async () => {
    const e = await aprobarDesdeVisor();
    elegirMotivo(e, 'OTRO');
    expect(e.el['itf-accion-texto-grupo'].hidden).toBe(false);
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    escribir(e, 'ab');
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    escribir(e, 'Documento completo con firma');
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(false);
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiAprobarItf.mock.calls[0][1]).toMatchObject({ motivoCodigo: 'OTRO', motivoTexto: 'Documento completo con firma' });
  });

  test('VIGENTE_CAMBIO: mensaje exacto, NO se reintenta, se vuelve a pedir el contexto (visor y cola) y el moderador decide de nuevo', async () => {
    const documentoFn = jest.fn((tok, id) => Promise.resolve(id === 'LEGACY:14-0001' ? documento(LEGACY) : documento(docDto(id), D(9))));
    const e = await aprobarDesdeVisor({ aprobar: () => Promise.resolve(err('VIGENTE_CAMBIO')), documento: documentoFn });
    elegirMotivo(e, 'ACTUALIZACION');
    const antesDoc = e.api.apiGetItfDocumentoModeracion.mock.calls.length;
    const antesCola = e.api.apiGetItfPendientes.mock.calls.length;
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiAprobarItf).toHaveBeenCalledTimes(1);
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.el['itf-vis-aviso'].textContent).toBe('El ITF vigente cambió desde que abriste esta propuesta. Actualizá la información antes de decidir.');
    expect(e.el['itf-vis-aviso'].hidden).toBe(false);
    expect(e.api.apiGetItfDocumentoModeracion.mock.calls.length).toBeGreaterThan(antesDoc);
    expect(e.api.apiGetItfPendientes.mock.calls.length).toBe(antesCola + 1);
    expect(e.el['itf-cola-aviso'].textContent).toMatch(/ITF vigente cambió/);
    await flush();
    expect(e.api.apiAprobarItf).toHaveBeenCalledTimes(1);               // jamas un segundo intento automatico
    e.el['btn-itf-vis-aprobar'].click();                                // la nueva decision declara el vigente NUEVO
    elegirMotivo(e, 'ACTUALIZACION');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiAprobarItf).toHaveBeenCalledTimes(2);
    expect(e.api.apiAprobarItf.mock.calls[1][1].vigenteEsperadoDocumentoId).toBe(D(9));
  });

  test('desde la TARJETA (el vigente no se conoce): se pide el contexto sin imagenes y mientras tanto no se puede confirmar', async () => {
    let resolver;
    const e = montar(VALIDA, { historial: () => new Promise((r) => { resolver = r; }) });
    await abrirCola(e);
    tarjeta(e, 0).boton('Aprobar').click();
    expect(e.el['itf-accion-cargando'].hidden).toBe(false);
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    expect(e.api.apiGetItfDocumentoModeracion).not.toHaveBeenCalled();
    resolver(historial(D(9)));
    await flush();
    expect(e.el['itf-accion-cargando'].hidden).toBe(true);
    expect(e.el['itf-accion-aviso'].textContent).toBe('Esta aprobación reemplazará el ITF vigente actual.');
    elegirMotivo(e, 'CORRECCION');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiAprobarItf.mock.calls[0][1]).toMatchObject({ documentoId: D(1), vigenteEsperadoDocumentoId: D(9), motivoCodigo: 'CORRECCION' });
  });

  test('sin vigente: confirmacion simple, SIN motivo ni vigenteEsperado', async () => {
    const e = montar(VALIDA, { historial: () => Promise.resolve(historial(null)) });
    await abrirCola(e);
    tarjeta(e, 0).boton('Aprobar').click();
    await flush();
    expect(e.el['itf-accion-motivo-grupo'].hidden).toBe(true);
    expect(e.el['itf-accion-aviso'].textContent).toBe('Vas a aprobar esta propuesta como ITF vigente del pozo.');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(Object.keys(e.api.apiAprobarItf.mock.calls[0][1]).sort()).toEqual(['clientRequestId', 'documentoId']);
  });

  test('Escape cierra SOLO el dialogo (el visor sigue abierto) y devuelve el foco al boton que lo abrio; no se envia nada', async () => {
    const e = await aprobarDesdeVisor();
    e.el['itf-accion-overlay'].emitir('keydown', { key: 'Escape', stopPropagation: jest.fn() });
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.el['itf-vis-overlay'].hidden).toBe(false);
    expect(e.api.apiAprobarItf).not.toHaveBeenCalled();
    expect(e.Nodo.enFoco).toBe(e.el['btn-itf-vis-aprobar']);
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(true);
  });

  test('Tab da la vuelta dentro del dialogo (cerrar -> motivo -> cancelar -> confirmar -> cerrar)', async () => {
    const e = await aprobarDesdeVisor();
    elegirMotivo(e, 'ACTUALIZACION');
    const tab = (shift) => { const ev = { key: 'Tab', shiftKey: shift, preventDefault: jest.fn() }; e.el['itf-accion-overlay'].emitir('keydown', ev); return ev; };
    e.Nodo.enFoco = e.el['btn-itf-accion-confirmar'];
    expect(tab(false).preventDefault).toHaveBeenCalled();
    expect(e.Nodo.enFoco.id).toBe('btn-itf-accion-cerrar');
    e.Nodo.enFoco = e.el['btn-itf-accion-cerrar'];
    tab(true);
    expect(e.Nodo.enFoco.id).toBe('btn-itf-accion-confirmar');
  });
});

describe('rechazar, retirar y restaurar', () => {
  test('RECHAZAR desde la tarjeta: motivo obligatorio (catalogo de rechazo, copy humano), payload SIN vigenteEsperado; sale de la cola', async () => {
    const pendientes = jest.fn().mockResolvedValueOnce(cola([pend(1), pend(2)])).mockResolvedValueOnce(cola([pend(2)]));
    const e = montar(VALIDA, { pendientes });
    await abrirCola(e);
    tarjeta(e, 0).boton('Rechazar').click();
    expect(e.el['itf-accion-titulo'].textContent).toBe('Rechazar propuesta');
    expect(e.el['itf-accion-motivo'].children.map((o) => o.textContent)).toEqual(['Elegí un motivo…', 'No corresponde a este pozo', 'Está incompleto', 'No se puede leer', 'Ya existe (duplicado)', 'Es una versión incorrecta', 'Otro motivo']);
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    elegirMotivo(e, 'ILEGIBLE');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiRechazarItf.mock.calls[0][1]).toMatchObject({ documentoId: D(1), motivoCodigo: 'ILEGIBLE' });
    expect(Object.keys(e.api.apiRechazarItf.mock.calls[0][1])).not.toContain('vigenteEsperadoDocumentoId');
    expect(e.api.apiGetHistorialItf).not.toHaveBeenCalled();
    expect(e.el['itf-cola-aviso'].textContent).toBe('Propuesta rechazada.');
    expect(e.el['itf-cola-lista'].children).toHaveLength(1);
  });

  test('una propuesta que otra persona ya resolvio: se avisa y la cola se actualiza', async () => {
    const pendientes = jest.fn().mockResolvedValueOnce(cola([pend(1), pend(2)])).mockResolvedValueOnce(cola([pend(2)]));
    const e = montar(VALIDA, { pendientes, rechazar: () => Promise.resolve(err('DOCUMENTO_NO_PROPUESTO')) });
    await abrirCola(e);
    tarjeta(e, 0).boton('Rechazar').click();
    elegirMotivo(e, 'ILEGIBLE');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.el['itf-cola-aviso'].textContent).toMatch(/ya no estaba pendiente/);
    expect(e.el['itf-cola-lista'].children).toHaveLength(1);
  });

  async function conHistorial(opc) {
    const e = montar(VALIDA, opc);
    await abrirCola(e);
    tarjeta(e, 0).boton('Historial').click();
    await flush();
    return e;
  }

  test('historial: vigente, documentos anteriores (Ver / Restaurar) y linea de tiempo SIN el registro interno; nada de ids ni emails', async () => {
    const e = await conHistorial();
    expect(e.api.apiGetHistorialItf).toHaveBeenCalledWith('tok', '14-0001');
    expect(e.el['itf-hist-overlay'].hidden).toBe(false);
    expect(e.el['itf-hist-pozo'].textContent).toBe('Pozo 14-0001');
    expect(e.el['itf-hist-vigente'].textContent).toBe('ITF existente');
    expect(e.el['itf-hist-anteriores'].children).toHaveLength(1);
    expect(e.el['itf-hist-anteriores'].children[0].botones().map((b) => b.textContent)).toEqual(['Ver', 'Restaurar']);
    expect(e.el['itf-hist-lineas'].children).toHaveLength(1);
    expect(e.el['itf-hist-lineas'].textContent).toContain('Aprobado');
    expect(e.el['itf-hist-lineas'].textContent).not.toMatch(/interno|LEGACY|ITF_/);
    expect(e.el['itf-hist-contenido'].textContent).not.toMatch(/@|LEGACY|sha256|storage/);
    expect(e.el['btn-itf-hist-retirar'].hidden).toBe(false);
    expect(e.el['btn-itf-hist-ver-vigente'].hidden).toBe(false);
  });

  test('restaurar: dialogo con "reemplazará", motivo con frase de restauracion y el vigente que muestra el historial; el exito vuelve a pedir el historial', async () => {
    const hist = jest.fn().mockResolvedValueOnce(historial('LEGACY:14-0001')).mockResolvedValueOnce(historial(D(3)));
    const e = await conHistorial({ historial: hist });
    e.el['itf-hist-anteriores'].children[0].boton('Restaurar').click();
    expect(e.el['itf-accion-titulo'].textContent).toBe('Restaurar como vigente');
    expect(e.el['itf-accion-aviso'].textContent).toBe('Esta restauración reemplazará el ITF vigente actual.');
    expect(e.el['itf-accion-motivo'].children.map((o) => o.textContent)).toContain('El ITF vigente se aprobó por error');
    elegirMotivo(e, 'ERROR_DE_APROBACION');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiRevertirItf.mock.calls[0][1]).toMatchObject({ documentoId: D(3), vigenteEsperadoDocumentoId: 'LEGACY:14-0001', motivoCodigo: 'ERROR_DE_APROBACION' });
    expect(hist).toHaveBeenCalledTimes(2);                               // el historial se vuelve a pedir
    expect(e.el['itf-hist-aviso'].textContent).toBe('ITF restaurado. Ya es el ITF vigente del pozo.');
    expect(e.el['itf-hist-vigente'].textContent).not.toBe('ITF existente');
    expect(e.hooks.onCambioDeVigente).toHaveBeenCalledWith('14-0001');
  });

  test('retirar el vigente desde el historial: advertencia exacta y motivo obligatorio', async () => {
    const e = await conHistorial();
    e.el['btn-itf-hist-retirar'].click();
    expect(e.el['itf-accion-titulo'].textContent).toBe('Retirar ITF vigente');
    expect(e.el['itf-accion-aviso'].textContent).toBe('El pozo quedará sin ITF vigente hasta que se apruebe o restaure otro.');
    expect(e.el['btn-itf-accion-confirmar'].disabled).toBe(true);
    elegirMotivo(e, 'DOCUMENTO_INCORRECTO');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiRetirarItf.mock.calls[0][1]).toMatchObject({ documentoId: 'LEGACY:14-0001', motivoCodigo: 'DOCUMENTO_INCORRECTO' });
  });

  test('"Ver" un documento anterior abre el visor encima y ofrece "Restaurar como vigente"', async () => {
    const e = montar(VALIDA, { historial: () => Promise.resolve(historial('LEGACY:14-0001')), documento: (tok, id) => Promise.resolve(documento(docDto(id, { estado: 'REEMPLAZADO', restaurable: true }))) });
    await abrirCola(e);
    tarjeta(e, 0).boton('Historial').click();
    await flush();
    e.el['itf-hist-anteriores'].children[0].boton('Ver').click();
    await flush();
    expect(e.el['itf-vis-overlay'].hidden).toBe(false);
    expect(e.el['btn-itf-vis-restaurar'].hidden).toBe(false);
    expect(e.el['btn-itf-vis-aprobar'].hidden).toBe(true);
    expect(e.el['itf-vis-estado'].textContent).toBe('Reemplazado');
  });

  test('retirar el vigente DESDE EL PERFIL (documento desconocido): se lee el vigente, se confirma y se avisa al Perfil con el mensaje', async () => {
    const alCambio = jest.fn();
    const e = montar(VALIDA, { historial: () => Promise.resolve(historial(D(8))) });
    e.c.itfModeracionController_pedirRetirarVigente('14-0001', null, { alCambio: alCambio });
    await flush();
    expect(e.el['itf-accion-overlay'].hidden).toBe(false);
    expect(e.api.apiGetHistorialItf).toHaveBeenCalledWith('tok', '14-0001');
    elegirMotivo(e, 'OTRO');
    escribir(e, 'Era de otro pozo');
    e.el['btn-itf-accion-confirmar'].click();
    await flush();
    expect(e.api.apiRetirarItf.mock.calls[0][1]).toMatchObject({ documentoId: D(8), motivoCodigo: 'OTRO', motivoTexto: 'Era de otro pozo' });
    expect(alCambio).toHaveBeenCalledWith('ITF retirado. El pozo quedó sin ITF vigente.');
    expect(e.hooks.onCambioDeVigente).toHaveBeenCalledWith('14-0001');
  });

  test('el historial de un pozo cuyo estado no se puede derivar muestra el error (no una pantalla en blanco) y permite reintentar', async () => {
    const hist = jest.fn().mockResolvedValueOnce(err('ITF_STATE_UNKNOWN')).mockResolvedValueOnce(historial('LEGACY:14-0001'));
    const e = await conHistorial({ historial: hist });
    expect(e.el['itf-hist-error'].hidden).toBe(false);
    expect(e.el['itf-hist-contenido'].hidden).toBe(true);
    e.el['btn-itf-hist-reintentar'].click();
    await flush();
    expect(e.el['itf-hist-error'].hidden).toBe(true);
    expect(e.el['itf-hist-contenido'].hidden).toBe(false);
  });
});

describe('permisos, sesion y limpieza', () => {
  test('sin perfil_validar exacto NINGUN dialogo hace llamadas (el visor, el historial ni las acciones)', async () => {
    const e = montar({ perfil: true, perfil_subir: true });
    e.c.itfModeracionController_abrirHistorial('14-0001', null, null);
    await flush();
    expect(e.api.apiGetHistorialItf).not.toHaveBeenCalled();
    expect(e.el['itf-hist-error-texto'].textContent).toBe('No tenés permiso para hacer esto.');
    e.c.itfModeracionController_pedirRetirarVigente('14-0001', null, null);
    await flush();
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.api.apiRetirarItf).not.toHaveBeenCalled();
  });

  test('sesion vencida en cualquier llamada: flujo global', async () => {
    const e = montar(VALIDA, { pendientes: () => Promise.resolve(err('UNAUTHORIZED')) });
    await abrirCola(e);
    expect(e.estado.vencida).toBe(1);
  });

  test('logout (reset): no queda cola, ni imagenes, ni dialogos abiertos, ni el bloqueo de scroll; las respuestas tardias no reviven nada', async () => {
    let resolver;
    const e = montar(VALIDA, { documento: () => new Promise((r) => { resolver = r; }) });
    await abrirCola(e);
    tarjeta(e, 0).boton('Ver documento').click();
    e.c.itfModeracionController_reset();
    resolver(documento(docDto(D(1))));
    await flush();
    expect(e.el['itf-vis-overlay'].hidden).toBe(true);
    expect(e.el['itf-vis-img-prop'].getAttribute('src')).toBeNull();
    expect(e.el['itf-cola-lista'].children).toHaveLength(0);
    expect(e.el['itf-accion-overlay'].hidden).toBe(true);
    expect(e.el['itf-hist-overlay'].hidden).toBe(true);
    expect(e.bodyClases.has('itf-mod-abierto')).toBe(false);
    expect(e.c.itfModeracionController_hayModalAbierto()).toBe(false);
  });

  test('cerrar la pantalla descarta la cola (la proxima apertura pide de nuevo)', async () => {
    const e = montar();
    await abrirCola(e);
    e.c.itfModeracionController_cerrar();
    expect(e.el['itf-cola-lista'].children).toHaveLength(0);
    await abrirCola(e);
    expect(e.api.apiGetItfPendientes).toHaveBeenCalledTimes(2);
  });

  test('el controlador no usa innerHTML / insertAdjacentHTML / document.write / eval', () => {
    const { leer } = require('./fixtures/domFalsoItf');
    const fuente = leer(__dirname, 'itfModeracion.js').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write|\beval\(|outerHTML/);
  });
});
