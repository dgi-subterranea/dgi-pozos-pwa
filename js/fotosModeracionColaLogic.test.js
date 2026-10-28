// Logica pura de "Fotos pendientes" (E8-5): permisos exactos, vistas de las tarjetas (lista blanca, nada tecnico), paginacion con dedupe, respuestas viejas, pestañas independientes, acciones (aprobar /
// rechazar / reponer) con su efecto sobre las listas, mensajes y la cola de miniaturas. El DOM esta en fotosModeracionColaController.test.js.
Object.assign(global, require('./reemplazoLogic'), require('./observacionesPozoLogic'), require('./fotosPozosLogic'), require('./fotosModeracionLogic'));
const C = require('./fotosModeracionColaLogic');

const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const MOD = { fotos: true, fotos_moderar: true };
const flush = async () => { for (let i = 0; i < 8; i += 1) { await new Promise((r) => setImmediate(r)); } };

const itemPend = (n, extra) => Object.assign({
  solicitudId: uuid(100 + n), fotoId: uuid(n), entidadTipo: 'WELL', entidadId: '14-000' + (n % 10), motivoCodigo: 'DUPLICADA', motivoTexto: '', nombre: 'Ana ' + n,
  timestampUtc: '2026-10-2' + (n % 9) + 'T15:00:00.000Z', foto: { tipoFoto: 'CERCA', fuente: 'CAMPO_APP', fechaFotoValor: '2025-06', fechaFotoPrecision: 'MES' }
}, extra || {});
const itemRet = (n, extra) => Object.assign({
  fotoId: uuid(n), entidadTipo: 'WELL', entidadId: '14-000' + (n % 10), origenRetiro: 'EVENTO', motivoCodigo: 'MALA_CALIDAD', motivoTexto: '', nombre: 'Marta', timestampUtc: '2026-10-27T15:00:00.000Z',
  viaSolicitud: false, requiereRevisionBorrado: false, foto: { tipoFoto: 'OTRA', fuente: 'MONITOREO_NE', fechaFotoValor: '2024', fechaFotoPrecision: 'ANIO' }
}, extra || {});
const pagina = (items, extra) => ({ status: 'ok', data: Object.assign({ total: items.length, items: items, hayMas: false, cursor: null }, extra || {}) });

describe('permisos y pestañas', () => {
  test('la pantalla es de fotos + fotos_moderar exactos', () => {
    expect(C.fotosModeracionColaLogic_puedeVer(MOD)).toBe(true);
    [{ fotos: true }, { fotos_moderar: true }, { fotos: true, fotos_carga: true }, { fotos_carga: true, fotos_moderar: true }, { fotos: 'SI', fotos_moderar: 'SI' }, { fotos: true, fotos_moderar: 1 }, {}, null, undefined].forEach((p) => {
      expect(C.fotosModeracionColaLogic_puedeVer(p)).toBe(false);
    });
  });

  test('dos pestañas, en orden', () => {
    expect(C.FOTOS_COLA_PESTANAS).toEqual(['PENDIENTES', 'RETIRADAS']);
    expect(C.FOTOS_COLA_ETIQUETAS_PESTANA).toEqual({ PENDIENTES: 'Pendientes', RETIRADAS: 'Retiradas' });
    expect(C.fotosModeracionColaLogic_esPestana('RETIRADAS')).toBe(true);
    ['x', '', null, undefined, 'pendientes', 'toString'].forEach((p) => expect(C.fotosModeracionColaLogic_esPestana(p)).toBe(false));
  });

  test('teclado de las pestañas (patron WAI-ARIA): flechas, Home y End', () => {
    const k = C.fotosModeracionColaLogic_pestanaPorTecla;
    expect(k('PENDIENTES', 'ArrowRight')).toBe('RETIRADAS');
    expect(k('RETIRADAS', 'ArrowRight')).toBe('PENDIENTES');
    expect(k('PENDIENTES', 'ArrowLeft')).toBe('RETIRADAS');
    expect(k('RETIRADAS', 'ArrowLeft')).toBe('PENDIENTES');
    expect(k('RETIRADAS', 'Home')).toBe('PENDIENTES');
    expect(k('PENDIENTES', 'End')).toBe('RETIRADAS');
    expect(k('PENDIENTES', 'Enter')).toBeNull();
    expect(k('x', 'ArrowRight')).toBeNull();
  });
});

describe('textos fijos', () => {
  test('mensajes pedidos', () => {
    expect(C.FOTOS_COLA_VACIO.PENDIENTES).toBe('No hay solicitudes de retiro pendientes.');
    expect(C.FOTOS_COLA_VACIO.RETIRADAS).toBe('No hay fotos retiradas para revisar.');
    expect(C.FOTOS_COLA_MENSAJE_ERROR).toBe('No se pudo cargar la moderación de fotos.');
    expect(C.FOTOS_COLA_MENSAJE_RESUELTA).toBe('La solicitud ya fue resuelta. Actualizamos la lista.');
    expect(C.FOTOS_COLA_TITULO).toBe('Fotos pendientes');
    expect(C.FOTOS_COLA_SUBTITULO).toBe('Revisá solicitudes de retiro');
    expect(C.FOTOS_COLA_CONFIRMACIONES.APROBAR.texto).toBe('La foto dejará de mostrarse en la galería.');
    expect(C.FOTOS_COLA_CONFIRMACIONES.REPONER.texto).toBe('¿Querés volver a mostrar esta foto en la galería?');
    expect(C.FOTOS_COLA_AVISO_BORRADO_REPONER).toBe('También dejará de quedar marcada para revisión de borrado.');
  });

  test('total: singular y plural segun la pestaña; nada si no hay', () => {
    expect(C.fotosModeracionColaLogic_textoTotal('PENDIENTES', 1)).toBe('1 solicitud pendiente');
    expect(C.fotosModeracionColaLogic_textoTotal('PENDIENTES', 3)).toBe('3 solicitudes pendientes');
    expect(C.fotosModeracionColaLogic_textoTotal('RETIRADAS', 1)).toBe('1 foto retirada');
    expect(C.fotosModeracionColaLogic_textoTotal('RETIRADAS', 12)).toBe('12 fotos retiradas');
    [0, -1, null, undefined, NaN, '3'].forEach((n) => expect(C.fotosModeracionColaLogic_textoTotal('PENDIENTES', n)).toBe(''));
  });

  test('errores de carga: texto fijo (sin codigos tecnicos); solo el permiso tiene su propio texto', () => {
    ['SERVICE_UNAVAILABLE', 'RED', 'STORAGE_UNAVAILABLE', 'CODIGO_RARO', undefined].forEach((c) => expect(C.fotosModeracionColaLogic_mensajeCarga(c)).toBe('No se pudo cargar la moderación de fotos.'));
    expect(C.fotosModeracionColaLogic_mensajeCarga('PERMISSION_DENIED')).toBe('Ya no tenés permiso para realizar esta acción.');
  });

  test('estado cambiado: "ya fue resuelta" solo al resolver; foto inexistente y el resto con su texto', () => {
    const m = C.fotosModeracionColaLogic_mensajeCambioEstado;
    ['SOLICITUD_YA_RESUELTA', 'SOLICITUD_NOT_FOUND', 'INVALID_TRANSITION'].forEach((c) => {
      expect(m('APROBAR', c)).toBe('La solicitud ya fue resuelta. Actualizamos la lista.');
      expect(m('RECHAZAR', c)).toBe('La solicitud ya fue resuelta. Actualizamos la lista.');
      expect(m('REPONER', c)).toBe('El estado de la foto cambió. Actualizamos la lista.');
    });
    ['APROBAR', 'REPONER'].forEach((t) => expect(m(t, 'FOTO_NOT_FOUND')).toBe('La foto ya no está disponible. Actualizamos la lista.'));
    expect(m('REPONER', 'FOTO_NO_RETIRADA')).toBe('El estado de la foto cambió. Actualizamos la lista.');
    expect(m('APROBAR', 'FOTO_YA_RETIRADA')).toBe('El estado de la foto cambió. Actualizamos la lista.');
  });
});

describe('vistas de las tarjetas (lista blanca)', () => {
  test('entidad: pozo o punto NE; cualquier otra cosa no se muestra', () => {
    const e = C.fotosModeracionColaLogic_etiquetaEntidad;
    expect(e('WELL', '14-0001')).toBe('Pozo 14-0001');
    expect(e('MONITORING', 'INA 536')).toBe('Punto NE INA 536');
    ['OTRO', '', null, undefined].forEach((t) => expect(e(t, '14-0001')).toBe(''));
    ['', '  ', null, undefined, 5].forEach((id) => expect(e('WELL', id)).toBe(''));
  });

  test('pendiente: entidad, fecha de solicitud, nombre, motivo humano, detalle y metadata de la foto', () => {
    const v = C.fotosModeracionColaLogic_vistaPendiente(itemPend(3, { motivoCodigo: 'OTRO', motivoTexto: 'se ve una cara' }));
    expect(v).toEqual({
      clave: uuid(103), solicitudId: uuid(103), fotoId: uuid(3), entidad: 'Pozo 14-0003', fecha: '23/10/2026 12:00', nombre: 'Ana 3', motivo: 'Otro', texto: 'se ve una cara',
      foto: { fecha: expect.any(String), fuente: 'Carga de campo', tipo: expect.any(String) }
    });
    expect(v.foto.fecha).toBe('06/2025');
  });

  test('pendiente: NO expone email, secuencia, clientRequestId ni ids de Drive aunque vengan', () => {
    const v = C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { email: 'x@x.com', secuencia: 7, clientRequestId: 'req-1', driveFileId: 'DRIVE_1', driveThumbId: 'DRIVE_2', imagenBase64: 'AAAA' }));
    expect(JSON.stringify(v)).not.toMatch(/x@x\.com|req-1|DRIVE_|AAAA|secuencia|clientRequestId|"email"/);
    expect(Object.keys(v).sort()).toEqual(['clave', 'entidad', 'fecha', 'foto', 'fotoId', 'motivo', 'nombre', 'solicitudId', 'texto']);
  });

  test('pendiente: un item sin solicitud, sin foto, sin entidad valida o que no es objeto se descarta', () => {
    [null, undefined, 'x', 5, itemPend(1, { solicitudId: '' }), itemPend(1, { fotoId: undefined }), itemPend(1, { entidadTipo: 'X' }), itemPend(1, { entidadId: '' })].forEach((r) => {
      expect(C.fotosModeracionColaLogic_vistaPendiente(r)).toBeNull();
    });
  });

  test('pendiente: nombre vacio o con forma de email se muestra neutro; motivo desconocido, con texto fijo; metadata faltante, null', () => {
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { nombre: 'persona@x.com' })).nombre).toBe('Usuario');
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { nombre: '   ' })).nombre).toBe('Usuario');
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { motivoCodigo: 'RARO' })).motivo).toBe('Motivo no reconocido');
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { motivoCodigo: '' })).motivo).toBe('');
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { foto: null })).foto).toBeNull();
  });

  test('pendiente: el texto libre se conserva tal cual (se pinta con textContent)', () => {
    const raro = '<img src=x onerror=alert(1)> & "comillas" \n linea 2 😀';
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { motivoCodigo: 'OTRO', motivoTexto: raro })).texto).toBe(raro);
    expect(C.fotosModeracionColaLogic_vistaPendiente(itemPend(1, { motivoTexto: 5 })).texto).toBe('');
  });

  test('retirada: quien retiro / aprobo, motivo, aviso de borrado SOLO si el backend lo dice con true', () => {
    const directa = C.fotosModeracionColaLogic_vistaRetirada(itemRet(2));
    expect(directa).toMatchObject({ clave: uuid(2), fotoId: uuid(2), entidad: 'Pozo 14-0002', nombre: 'Marta', quien: 'Retirada por Marta', motivo: 'Mala calidad', texto: '', pendienteBorrado: false });
    expect(directa.foto).toEqual({ fecha: '2024', fuente: expect.any(String), tipo: expect.any(String) });
    expect(C.fotosModeracionColaLogic_vistaRetirada(itemRet(2, { viaSolicitud: true })).quien).toBe('Retiro aprobado por Marta');
    expect(C.fotosModeracionColaLogic_vistaRetirada(itemRet(2, { requiereRevisionBorrado: true, motivoCodigo: 'PRIVACIDAD' })).pendienteBorrado).toBe(true);
    ['true', 1, 'SI', {}, null, undefined].forEach((v) => expect(C.fotosModeracionColaLogic_vistaRetirada(itemRet(2, { requiereRevisionBorrado: v })).pendienteBorrado).toBe(false));
    ['true', 1, 'SI'].forEach((v) => expect(C.fotosModeracionColaLogic_vistaRetirada(itemRet(2, { viaSolicitud: v })).quien).toBe('Retirada por Marta'));
  });

  test('retirada: una OCULTA legacy (o cualquier origen que no sea EVENTO) no se muestra como reponible', () => {
    ['LEGACY_OCULTA', '', null, undefined, 'otro'].forEach((o) => expect(C.fotosModeracionColaLogic_vistaRetirada(itemRet(2, { origenRetiro: o }))).toBeNull());
  });

  test('retirada: sin email / secuencia / clientRequestId / ids de Drive y con claves exactas', () => {
    const v = C.fotosModeracionColaLogic_vistaRetirada(itemRet(1, { email: 'x@x.com', secuencia: 3, clientRequestId: 'r', driveFileId: 'D1', url: 'https://x' }));
    expect(JSON.stringify(v)).not.toMatch(/x@x\.com|"r"|D1|https|secuencia|clientRequestId/);
    expect(Object.keys(v).sort()).toEqual(['clave', 'entidad', 'fecha', 'foto', 'fotoId', 'motivo', 'nombre', 'pendienteBorrado', 'quien', 'texto']);
  });

  test('retirada: items mal formados se descartan', () => {
    [null, 'x', itemRet(1, { fotoId: '' }), itemRet(1, { entidadTipo: 'Z' })].forEach((r) => expect(C.fotosModeracionColaLogic_vistaRetirada(r)).toBeNull());
  });
});

describe('vistaPagina: dedupe, removidos, cursor', () => {
  test('descarta repetidos dentro de la pagina y los ya vistos; respeta el orden del backend', () => {
    const vistas = {};
    const p1 = C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', { items: [itemPend(3), itemPend(2), itemPend(3)], total: 5, hayMas: true, cursor: 40 }, vistas, {});
    expect(p1.items.map((i) => i.solicitudId)).toEqual([uuid(103), uuid(102)]);
    const p2 = C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', { items: [itemPend(2), itemPend(1)], total: 5, hayMas: false, cursor: null }, vistas, {});
    expect(p2.items.map((i) => i.solicitudId)).toEqual([uuid(101)]);
  });

  test('un item removido en esta sesion de pantalla no resucita si llega en una pagina en vuelo', () => {
    const p = C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', { items: [itemPend(1), itemPend(2)], hayMas: false, cursor: null }, {}, { [uuid(101)]: true });
    expect(p.items.map((i) => i.clave)).toEqual([uuid(102)]);
  });

  test('retiradas se identifican por fotoId', () => {
    const p = C.fotosModeracionColaLogic_vistaPagina('RETIRADAS', { items: [itemRet(5), itemRet(5), itemRet(6)], total: 2, hayMas: false, cursor: null }, {}, {});
    expect(p.items.map((i) => i.clave)).toEqual([uuid(5), uuid(6)]);
  });

  test('hayMas solo con un cursor entero >= 1; sin cursor valido no se ofrece "Ver mas" (nunca un pedido que no avanza)', () => {
    const v = (extra) => C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', Object.assign({ items: [], total: 0 }, extra), {}, {});
    expect(v({ hayMas: true, cursor: 7 })).toMatchObject({ hayMas: true, cursor: 7 });
    [null, undefined, 0, -1, 1.5, '7', NaN].forEach((c) => expect(v({ hayMas: true, cursor: c })).toMatchObject({ hayMas: false, cursor: null }));
    expect(v({ hayMas: false, cursor: 7 })).toMatchObject({ hayMas: false, cursor: 7 });
    expect(v({ hayMas: 'true', cursor: 7 }).hayMas).toBe(false);
  });

  test('total: el del backend si es un entero >= 0; si no, null', () => {
    const v = (total) => C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', { items: [], total: total }, {}, {}).total;
    expect(v(5)).toBe(5);
    expect(v(0)).toBe(0);
    [-1, '5', null, undefined, NaN, Infinity].forEach((t) => expect(v(t)).toBeNull());
  });

  test('una respuesta sin forma de pagina es null', () => {
    [null, undefined, 'x', {}, { items: 'x' }, { items: null }].forEach((d) => expect(C.fotosModeracionColaLogic_vistaPagina('PENDIENTES', d, {}, {})).toBeNull());
  });
});

describe('cola de miniaturas', () => {
  function armar(max) {
    const pedidos = [];
    const q = C.fotosModeracionColaLogic_crearColaMiniaturas(max, (id) => new Promise((res, rej) => { pedidos.push({ id, res, rej }); }));
    return { q, pedidos };
  }

  test('nunca mas de N pedidos en paralelo; el resto espera en orden', async () => {
    const t = armar(3);
    const ps = ['a', 'b', 'c', 'd', 'e'].map((id) => t.q.pedir(id));
    ps[1].catch(() => {});
    expect(t.pedidos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(t.q.activas()).toBe(3);
    expect(t.q.enEspera()).toBe(2);
    t.pedidos[0].res('url-a');
    await flush();
    expect(t.pedidos.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    t.pedidos[1].rej(new Error('x'));
    await flush();
    expect(t.pedidos.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(t.q.activas()).toBe(3);
    t.pedidos[2].res('url-c'); t.pedidos[3].res('url-d'); t.pedidos[4].res('url-e');
    expect(await ps[0]).toBe('url-a');
    await expect(ps[1]).rejects.toThrow('x');
    expect(await ps[4]).toBe('url-e');
    await flush();
    expect(t.q.activas()).toBe(0);
  });

  test('un fallo no frena la cola ni se guarda: se puede volver a pedir; un exito queda en cache', async () => {
    const t = armar(3);
    const p1 = t.q.pedir('a');
    t.pedidos[0].rej(new Error('falla'));
    await expect(p1).rejects.toThrow('falla');
    const p2 = t.q.pedir('a');
    expect(t.pedidos).toHaveLength(2);
    t.pedidos[1].res('url');
    expect(await p2).toBe('url');
    expect(await t.q.pedir('a')).toBe('url');
    expect(t.pedidos).toHaveLength(2);
  });

  test('el mismo pedido en vuelo no se repite', async () => {
    const t = armar(3);
    const a = t.q.pedir('x');
    const b = t.q.pedir('x');
    expect(t.pedidos).toHaveLength(1);
    t.pedidos[0].res('u');
    expect(await a).toBe('u');
    expect(await b).toBe('u');
  });

  test('reset descarta lo que espera y el cache; lo que estaba en vuelo no se guarda', async () => {
    const t = armar(1);
    const a = t.q.pedir('a');
    const b = t.q.pedir('b');
    t.q.reset();
    await expect(b).rejects.toThrow('DESCARTADA');
    t.pedidos[0].res('url-a');
    await a;
    await flush();
    t.q.pedir('a');
    expect(t.pedidos.filter((p) => p.id === 'a')).toHaveLength(2);        // el cache no sobrevivio
  });

  test('un cargador que lanza de forma sincronica es un rechazo, no una excepcion', async () => {
    const q = C.fotosModeracionColaLogic_crearColaMiniaturas(2, () => { throw new Error('boom'); });
    await expect(q.pedir('a')).rejects.toThrow('boom');
    await expect(q.pedir('b')).rejects.toThrow('boom');
  });
});

describe('la pantalla: carga, pestañas, paginacion', () => {
  function armar(permisos, extra) {
    const ctx = { sessionToken: 'tok', permisos: permisos };
    const consultas = [];
    const pendientes = [];
    const envios = [];
    const pendEnvios = [];
    const e = { cambios: [], sesion: 0, visibilidad: [] };
    let n = 0;
    const c = C.fotosModeracionColaLogic_crear(Object.assign({
      obtenerContexto: () => ctx,
      consultar: (pestana, token, limit, cursor) => { consultas.push({ pestana, token, limit, cursor }); return new Promise((res) => { pendientes.push(res); }); },
      enviar: (tipo, token, datos, id) => { envios.push({ tipo, token, datos: Object.assign({}, datos), id }); return new Promise((res) => { pendEnvios.push(res); }); },
      generarId: (tipo) => 'foto-' + tipo.slice(0, 3).toLowerCase() + '-id' + String(++n).padStart(8, '0'),
      onCambio: (s) => e.cambios.push(s),
      onSesionExpirada: () => { e.sesion += 1; },
      onVisibilidadCambio: (i) => e.visibilidad.push(i)
    }, extra || {}));
    return { c, ctx, consultas, pendientes, envios, pendEnvios, e };
  }

  describe('apertura', () => {
    test('sin fotos + fotos_moderar no se pide NADA y no se abre', async () => {
      for (const p of [{ fotos: true }, { fotos: true, fotos_carga: true }, { fotos_moderar: true }, { fotos: 'SI', fotos_moderar: 'SI' }, {}]) {
        const t = armar(p);
        expect(await t.c.abrir()).toBe(false);
        expect(t.consultas).toHaveLength(0);
        expect(t.c.estado().abierta).toBe(false);
      }
    });

    test('abrir pide SOLO la primera pagina de Pendientes (limit 20, sin cursor); Retiradas no se pide hasta elegir la pestaña', () => {
      const t = armar(MOD);
      t.c.abrir();
      expect(t.consultas).toEqual([{ pestana: 'PENDIENTES', token: 'tok', limit: 20, cursor: undefined }]);
      expect(t.c.estado()).toMatchObject({ abierta: true, pestana: 'PENDIENTES' });
      expect(t.c.estado().pendientes.cargando).toBe(true);
      expect(t.c.estado().retiradas).toMatchObject({ cargando: false, cargada: false });
    });

    test('con datos: items en el orden del backend, total y sin "vacia"', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(3), itemPend(2), itemPend(1)], { total: 3 }));
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.items.map((i) => i.solicitudId)).toEqual([uuid(103), uuid(102), uuid(101)]);
      expect(p).toMatchObject({ total: 3, cargando: false, cargada: true, vacia: false, hayMas: false, error: null });
    });

    test('vacia: sin solicitudes pendientes', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([]));
      await flush();
      expect(t.c.estado().pendientes).toMatchObject({ vacia: true, items: [], cargada: true });
    });

    test('un item mal formado en la respuesta no rompe la lista', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1), null, { x: 1 }, itemPend(2)]));
      await flush();
      expect(t.c.estado().pendientes.items).toHaveLength(2);
    });

    test('1 y 20 solicitudes', async () => {
      const t = armar(MOD);
      t.c.abrir();
      const veinte = [];
      for (let i = 1; i <= 20; i++) { veinte.push(itemPend(i)); }
      t.pendientes[0](pagina(veinte, { total: 20 }));
      await flush();
      expect(t.c.estado().pendientes.items).toHaveLength(20);
      const u = armar(MOD);
      u.c.abrir();
      u.pendientes[0](pagina([itemPend(1)], { total: 1 }));
      await flush();
      expect(u.c.estado().pendientes.items).toHaveLength(1);
    });
  });

  describe('errores', () => {
    test('error de carga: texto fijo (sin codigos) y Reintentar vuelve a pedir la primera pagina', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE', message: 'No existe la hoja FotosPozoEventos' });
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.error).toEqual({ code: 'SERVICE_UNAVAILABLE', mensaje: 'No se pudo cargar la moderación de fotos.' });
      expect(JSON.stringify(t.c.estado())).not.toMatch(/FotosPozoEventos|hoja/);
      expect(p.items).toEqual([]);
      expect(p.vacia).toBe(false);
      t.c.recargar();
      expect(t.consultas).toHaveLength(2);
      t.pendientes[1](pagina([itemPend(1)]));
      await flush();
      expect(t.c.estado().pendientes).toMatchObject({ error: null, cargada: true });
    });

    test('error de red (promesa rechazada): mismo texto fijo', async () => {
      const t = armar(MOD, { consultar: () => Promise.reject(new Error('Failed to fetch')) });
      t.c.abrir();
      await flush();
      expect(t.c.estado().pendientes.error.mensaje).toBe('No se pudo cargar la moderación de fotos.');
    });

    test('una respuesta sin forma de pagina tambien es el error fijo', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0]({ status: 'ok', data: { items: 'x' } });
      await flush();
      expect(t.c.estado().pendientes.error.mensaje).toBe('No se pudo cargar la moderación de fotos.');
    });

    test('una respuesta que hace fallar la lectura de una pagina (item raro) es el error fijo: la lista NUNCA queda "cargando" para siempre', async () => {
      const t = armar(MOD);
      t.c.abrir();
      const malo = { get solicitudId() { throw new Error('boom'); } };
      t.pendientes[0]({ status: 'ok', data: { items: [malo], total: 1, hayMas: false, cursor: null } });
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.cargando).toBe(false);
      expect(p.error.mensaje).toBe('No se pudo cargar la moderación de fotos.');
      t.c.recargar();
      t.pendientes[1](pagina([itemPend(1)]));
      await flush();
      expect(t.c.estado().pendientes.items).toHaveLength(1);
    });

    test('lo mismo al cargar mas: no queda "cargando mas" para siempre y conserva lo cargado', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)], { total: 3, hayMas: true, cursor: 9 }));
      await flush();
      t.c.verMas();
      const malo = { get solicitudId() { throw new Error('boom'); } };
      t.pendientes[1]({ status: 'ok', data: { items: [malo], total: 3, hayMas: false, cursor: null } });
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.cargandoMas).toBe(false);
      expect(p.errorMas).toBe('No se pudieron cargar más. Intentá nuevamente.');
      expect(p.items).toHaveLength(1);
    });

    test('PERMISSION_DENIED del backend: texto del permiso', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0]({ status: 'error', code: 'PERMISSION_DENIED' });
      await flush();
      expect(t.c.estado().pendientes.error.mensaje).toBe('Ya no tenés permiso para realizar esta acción.');
    });

    test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s: cierre de sesion global (una vez) y NO se muestra como error de moderacion', async (code) => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0]({ status: 'error', code: code });
      await flush();
      expect(t.e.sesion).toBe(1);
      expect(t.c.estado().pendientes.error).toBeNull();
    });

    test('si el permiso se pierde, recargar no pide nada y avisa', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.ctx.permisos = { fotos: true };
      await t.c.recargar();
      expect(t.consultas).toHaveLength(1);
      expect(t.c.estado().pendientes.error.code).toBe('PERMISSION_DENIED');
      expect(t.c.estado().pendientes.items).toEqual([]);
    });
  });

  describe('paginacion', () => {
    async function conPagina1() {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(5), itemPend(4)], { total: 5, hayMas: true, cursor: 41 }));
      await flush();
      return t;
    }

    test('"Ver mas" aparece con hayMas y NO se cargan mas paginas solas', async () => {
      const t = await conPagina1();
      expect(t.c.estado().pendientes.hayMas).toBe(true);
      await flush();
      expect(t.consultas).toHaveLength(1);
    });

    test('Ver mas pide la pagina siguiente con el cursor del backend y suma sin repetir', async () => {
      const t = await conPagina1();
      t.c.verMas();
      expect(t.consultas[1]).toEqual({ pestana: 'PENDIENTES', token: 'tok', limit: 20, cursor: 41 });
      expect(t.c.estado().pendientes.cargandoMas).toBe(true);
      t.pendientes[1](pagina([itemPend(4), itemPend(3), itemPend(2)], { total: 5, hayMas: true, cursor: 22 }));
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.items.map((i) => i.solicitudId)).toEqual([uuid(105), uuid(104), uuid(103), uuid(102)]);
      expect(p).toMatchObject({ hayMas: true, cargandoMas: false });
      t.c.verMas();
      expect(t.consultas[2].cursor).toBe(22);
      t.pendientes[2](pagina([itemPend(1)], { total: 5, hayMas: false, cursor: null }));
      await flush();
      expect(t.c.estado().pendientes).toMatchObject({ hayMas: false });
      expect(t.c.estado().pendientes.items).toHaveLength(5);
    });

    test('mientras se carga mas, otro "Ver mas" no manda otro pedido', async () => {
      const t = await conPagina1();
      t.c.verMas();
      t.c.verMas();
      t.c.verMas();
      expect(t.consultas).toHaveLength(2);
    });

    test('sin hayMas, Ver mas no hace nada', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.c.verMas();
      expect(t.consultas).toHaveLength(1);
    });

    test('fallo al cargar mas: conserva lo cargado, avisa y se puede reintentar con el mismo cursor', async () => {
      const t = await conPagina1();
      t.c.verMas();
      t.pendientes[1]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      await flush();
      const p = t.c.estado().pendientes;
      expect(p.items).toHaveLength(2);
      expect(p.errorMas).toBe('No se pudieron cargar más. Intentá nuevamente.');
      expect(p.error).toBeNull();
      expect(p.hayMas).toBe(true);
      t.c.verMas();
      expect(t.consultas[2].cursor).toBe(41);
      expect(t.c.estado().pendientes.errorMas).toBeNull();
    });

    test('sesion vencida al cargar mas: logout global', async () => {
      const t = await conPagina1();
      t.c.verMas();
      t.pendientes[1]({ status: 'error', code: 'UNAUTHORIZED' });
      await flush();
      expect(t.e.sesion).toBe(1);
      expect(t.c.estado().pendientes.errorMas).toBeNull();
    });

    test('Ver mas sin permiso no pide nada', async () => {
      const t = await conPagina1();
      t.ctx.permisos = { fotos: true };
      t.c.verMas();
      expect(t.consultas).toHaveLength(1);
      expect(t.c.estado().pendientes.errorMas).toBe('Ya no tenés permiso para realizar esta acción.');
    });

    test('una recarga a mitad de "Ver mas" descarta esa pagina vieja', async () => {
      const t = await conPagina1();
      t.c.verMas();
      t.c.recargar();
      t.pendientes[1](pagina([itemPend(1)], { total: 1 }));        // la pagina vieja llega tarde
      await flush();
      expect(t.c.estado().pendientes.items).toEqual([]);
      t.pendientes[2](pagina([itemPend(9)], { total: 1 }));
      await flush();
      expect(t.c.estado().pendientes.items.map((i) => i.solicitudId)).toEqual([uuid(109)]);
    });
  });

  describe('respuestas viejas y pestañas independientes', () => {
    test('una respuesta vieja de Pendientes NO pisa Retiradas (listas independientes)', async () => {
      const t = armar(MOD);
      t.c.abrir();                                   // Pendientes en vuelo
      t.c.seleccionarPestana('RETIRADAS');           // Retiradas en vuelo
      expect(t.consultas.map((q) => q.pestana)).toEqual(['PENDIENTES', 'RETIRADAS']);
      t.pendientes[1](pagina([itemRet(7)], { total: 1 }));
      await flush();
      t.pendientes[0](pagina([itemPend(1), itemPend(2)], { total: 2 }));      // llega despues
      await flush();
      const e = t.c.estado();
      expect(e.pestana).toBe('RETIRADAS');
      expect(e.retiradas.items.map((i) => i.fotoId)).toEqual([uuid(7)]);
      expect(e.pendientes.items).toHaveLength(2);
    });

    test('una respuesta vieja de la MISMA pestaña (se recargo antes) se descarta', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.c.recargar();
      t.pendientes[1](pagina([itemPend(2)]));
      await flush();
      t.pendientes[0](pagina([itemPend(1)]));                                 // la primera llega tarde
      await flush();
      expect(t.c.estado().pendientes.items.map((i) => i.clave)).toEqual([uuid(102)]);
    });

    test('una respuesta que llega despues de cerrar la pantalla (o la sesion) no aplica nada', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.c.cerrar();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      expect(t.c.estado()).toMatchObject({ abierta: false });
      expect(t.c.estado().pendientes.items).toEqual([]);
      expect(t.e.sesion).toBe(0);
    });

    test('un error de sesion que llega despues de cerrar no dispara el logout', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.c.cerrar();
      t.pendientes[0]({ status: 'error', code: 'UNAUTHORIZED' });
      await flush();
      expect(t.e.sesion).toBe(0);
    });

    test('abrir de nuevo descarta lo que quedaba en vuelo de la apertura anterior', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      expect(t.c.estado().pendientes.items).toEqual([]);
      t.pendientes[1](pagina([itemPend(2)]));
      await flush();
      expect(t.c.estado().pendientes.items).toHaveLength(1);
    });

    test('elegir Retiradas pide su primera pagina UNA vez; volver a Pendientes no vuelve a pedir; ir y venir no recarga', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas.map((q) => q.pestana)).toEqual(['PENDIENTES', 'RETIRADAS']);
      t.pendientes[1](pagina([itemRet(8)]));
      await flush();
      t.c.seleccionarPestana('PENDIENTES');
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas).toHaveLength(2);
      expect(t.c.estado().pendientes.items).toHaveLength(1);
      expect(t.c.estado().retiradas.items).toHaveLength(1);
    });

    test('una pestaña inexistente o con la pantalla cerrada no cambia nada', async () => {
      const t = armar(MOD);
      await t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas).toHaveLength(0);
      t.c.abrir();
      await t.c.seleccionarPestana('OTRA');
      expect(t.c.estado().pestana).toBe('PENDIENTES');
      expect(t.consultas).toHaveLength(1);
    });

    test('Retiradas pide el listado de retiradas (no la cola) y viceversa', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([]));
      await flush();
      t.c.seleccionarPestana('RETIRADAS');
      t.pendientes[1](pagina([itemRet(1)], { total: 1 }));
      await flush();
      expect(t.c.estado().retiradas.items[0]).toMatchObject({ fotoId: uuid(1), quien: 'Retirada por Marta' });
      expect(t.c.estado().pendientes.items).toEqual([]);
    });

    test('Retiradas vacia y con error: sus propios estados', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.c.seleccionarPestana('RETIRADAS');
      t.pendientes[1]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      await flush();
      expect(t.c.estado().retiradas.error.mensaje).toBe('No se pudo cargar la moderación de fotos.');
      expect(t.c.estado().pendientes.error).toBeNull();
      t.c.recargar();
      expect(t.consultas[2].pestana).toBe('RETIRADAS');
      t.pendientes[2](pagina([]));
      await flush();
      expect(t.c.estado().retiradas).toMatchObject({ vacia: true, error: null });
    });
  });

  describe('acciones sobre las tarjetas', () => {
    async function conPendientes(n) {
      const t = armar(MOD);
      t.c.abrir();
      const items = [];
      for (let i = 1; i <= (n || 2); i++) { items.push(itemPend(i)); }
      t.pendientes[0](pagina(items, { total: items.length }));
      await flush();
      return t;
    }
    async function conRetiradas() {
      const t = await conPendientes(1);
      t.c.seleccionarPestana('RETIRADAS');
      t.pendientes[1](pagina([itemRet(7), itemRet(8, { requiereRevisionBorrado: true, motivoCodigo: 'PRIVACIDAD' })], { total: 2 }));
      await flush();
      return t;
    }

    test('aprobar abre una confirmacion breve; no pide motivo; no manda nada hasta confirmar', async () => {
      const t = await conPendientes();
      expect(t.c.pedirAccion('APROBAR', uuid(101))).toBe(true);
      const a = t.c.estado().accion;
      expect(a).toMatchObject({ tipo: 'APROBAR', titulo: 'Aprobar retiro', texto: 'La foto dejará de mostrarse en la galería.', boton: 'Aprobar retiro', extra: '', entidad: 'Pozo 14-0001', enviando: false, puedeEnviar: true, error: null });
      expect(t.envios).toHaveLength(0);
    });

    test('aprobar: resolverRetiro con APROBADO y id foto-res estable; exito -> sale de Pendientes, baja el total, avisa y marca Retiradas para recargar', async () => {
      const t = await conPendientes(3);
      t.c.pedirAccion('APROBAR', uuid(102));
      t.c.confirmar();
      expect(t.envios).toHaveLength(1);
      expect(t.envios[0]).toMatchObject({ tipo: 'APROBAR', token: 'tok', datos: { fotoId: uuid(2), solicitudId: uuid(102), resolucion: 'APROBADO' } });
      expect(t.envios[0].id).toMatch(/^foto-apr-id/);
      expect(t.c.estado().accion).toMatchObject({ enviando: true, boton: 'Aprobando…', puedeEnviar: false });
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(2), duplicada: false, solicitudId: uuid(102), resolucion: 'APROBADO' } });
      await flush();
      const e = t.c.estado();
      expect(e.accion).toBeNull();
      expect(e.pendientes.items.map((i) => i.solicitudId)).toEqual([uuid(101), uuid(103)]);
      expect(e.pendientes.total).toBe(2);
      expect(e.aviso).toEqual({ texto: 'Retiro aprobado. La foto ya no se muestra en la galería.', error: false });
      expect(t.e.visibilidad).toEqual([{ tipo: 'APROBAR', fotoId: uuid(2) }]);
    });

    test('aprobar -> la foto aparece en Retiradas tras recargar esa pestaña (no se arma en memoria)', async () => {
      const t = await conPendientes(1);
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
      await flush();
      expect(t.c.estado().retiradas.items).toEqual([]);
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas[t.consultas.length - 1].pestana).toBe('RETIRADAS');
      t.pendientes[t.pendientes.length - 1](pagina([itemRet(1, { viaSolicitud: true })]));
      await flush();
      expect(t.c.estado().retiradas.items[0]).toMatchObject({ fotoId: uuid(1), quien: 'Retiro aprobado por Marta' });
    });

    test('aprobar con Retiradas ya cargada: se vuelve a pedir al volver a esa pestaña', async () => {
      const t = await conRetiradas();
      t.c.seleccionarPestana('PENDIENTES');
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
      await flush();
      const antes = t.consultas.length;
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas).toHaveLength(antes + 1);
      expect(t.consultas[antes].pestana).toBe('RETIRADAS');
    });

    test('rechazar: RECHAZADO; sale de Pendientes, la foto queda activa; Retiradas NO se recarga y no cambia la visibilidad de la galeria', async () => {
      const t = await conRetiradas();
      t.c.seleccionarPestana('PENDIENTES');
      t.c.pedirAccion('RECHAZAR', uuid(101));
      expect(t.c.estado().accion).toMatchObject({ tipo: 'RECHAZAR', titulo: 'Rechazar retiro', boton: 'Rechazar', texto: 'La foto seguirá visible en la galería.' });
      t.c.confirmar();
      expect(t.envios[0].datos).toEqual({ fotoId: uuid(1), solicitudId: uuid(101), resolucion: 'RECHAZADO' });
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'RECHAZADO' } });
      await flush();
      expect(t.c.estado().pendientes.items).toEqual([]);
      expect(t.c.estado().aviso).toEqual({ texto: 'Retiro rechazado. La foto sigue visible.', error: false });
      const antes = t.consultas.length;
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas).toHaveLength(antes);          // Retiradas sigue valida
      expect(t.e.visibilidad).toEqual([]);              // rechazar no cambia lo que ve la galeria
    });

    test('aprobar y rechazar solo se piden desde Pendientes; reponer solo desde Retiradas', async () => {
      const t = await conRetiradas();
      expect(t.c.pedirAccion('APROBAR', uuid(7))).toBe(false);
      expect(t.c.pedirAccion('RECHAZAR', uuid(7))).toBe(false);
      expect(t.c.pedirAccion('REPONER', uuid(7))).toBe(true);
      t.c.cancelarAccion();
      t.c.seleccionarPestana('PENDIENTES');
      expect(t.c.pedirAccion('REPONER', uuid(101))).toBe(false);
      expect(t.c.pedirAccion('APROBAR', uuid(7))).toBe(false);          // clave inexistente en esta pestaña
      expect(t.c.pedirAccion('BORRAR', uuid(101))).toBe(false);
      expect(t.c.estado().accion).toBeNull();
    });

    test('reponer: confirmacion con el copy pedido; PRIVACIDAD agrega el aviso de borrado; los demas no', async () => {
      const t = await conRetiradas();
      t.c.pedirAccion('REPONER', uuid(7));
      expect(t.c.estado().accion).toMatchObject({ tipo: 'REPONER', titulo: 'Reponer foto', texto: '¿Querés volver a mostrar esta foto en la galería?', boton: 'Reponer foto', extra: '', entidad: 'Pozo 14-0007' });
      t.c.cancelarAccion();
      t.c.pedirAccion('REPONER', uuid(8));
      expect(t.c.estado().accion.extra).toBe('También dejará de quedar marcada para revisión de borrado.');
    });

    test('reponer: id foto-rep estable en el reintento; exito -> sale de Retiradas, baja el total, avisa y refresca el contador', async () => {
      const t = await conRetiradas();
      t.c.pedirAccion('REPONER', uuid(7));
      t.c.confirmar();
      expect(t.envios[0]).toMatchObject({ tipo: 'REPONER', datos: { fotoId: uuid(7) } });
      t.pendEnvios[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      await flush();
      expect(t.c.estado().accion.error.mensaje).toBe('No se pudo consultar la moderación de fotos. Intentá nuevamente.');
      t.c.confirmar();
      expect(t.envios[1].id).toBe(t.envios[0].id);
      t.pendEnvios[1]({ status: 'ok', data: { fotoId: uuid(7), duplicada: true } });
      await flush();
      const e = t.c.estado();
      expect(e.retiradas.items.map((i) => i.fotoId)).toEqual([uuid(8)]);
      expect(e.retiradas.total).toBe(1);
      expect(e.aviso).toEqual({ texto: 'Foto repuesta en la galería.', error: false });
      expect(t.e.visibilidad).toEqual([{ tipo: 'REPONER', fotoId: uuid(7) }]);
    });

    test('cancelar cierra sin pedir nada; reabrir da un id nuevo', async () => {
      const t = await conPendientes();
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'error', code: 'SERVICE_UNAVAILABLE' });
      await flush();
      expect(t.c.cancelarAccion()).toBe(true);
      expect(t.c.estado().accion).toBeNull();
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      expect(t.envios[1].id).not.toBe(t.envios[0].id);
    });

    test('doble clic en confirmar: un solo pedido y no se puede cancelar mientras se envia', async () => {
      const t = await conPendientes();
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      t.c.confirmar();
      t.c.confirmar();
      expect(t.envios).toHaveLength(1);
      expect(t.c.cancelarAccion()).toBe(false);
      expect(t.c.estado().accion.enviando).toBe(true);
    });

    test('no se abre una segunda confirmacion con una abierta', async () => {
      const t = await conPendientes();
      expect(t.c.pedirAccion('APROBAR', uuid(101))).toBe(true);
      expect(t.c.pedirAccion('RECHAZAR', uuid(102))).toBe(false);
      expect(t.c.estado().accion.tipo).toBe('APROBAR');
    });

    test.each([['SOLICITUD_YA_RESUELTA'], ['INVALID_TRANSITION'], ['SOLICITUD_NOT_FOUND']])('%s (otro moderador ya la resolvio): mensaje fijo, y se actualiza la primera pagina', async (code) => {
      const t = await conPendientes(3);
      t.c.pedirAccion('APROBAR', uuid(102));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'error', code: code, message: 'detalle tecnico' });
      await flush();
      expect(t.c.estado().aviso).toEqual({ texto: 'La solicitud ya fue resuelta. Actualizamos la lista.', error: true });
      expect(t.c.estado().accion).toBeNull();
      expect(t.consultas[t.consultas.length - 1]).toEqual({ pestana: 'PENDIENTES', token: 'tok', limit: 20, cursor: undefined });
      expect(t.c.estado().pendientes.cargando).toBe(true);
      expect(JSON.stringify(t.c.estado())).not.toMatch(/detalle tecnico|INVALID_TRANSITION|SOLICITUD_/);
      t.pendientes[t.pendientes.length - 1](pagina([itemPend(1), itemPend(3)], { total: 2 }));
      await flush();
      expect(t.c.estado().pendientes.items.map((i) => i.solicitudId)).toEqual([uuid(101), uuid(103)]);
    });

    test('FOTO_NOT_FOUND al reponer: "ya no esta disponible" y se actualiza Retiradas', async () => {
      const t = await conRetiradas();
      t.c.pedirAccion('REPONER', uuid(7));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'error', code: 'FOTO_NOT_FOUND' });
      await flush();
      expect(t.c.estado().aviso).toEqual({ texto: 'La foto ya no está disponible. Actualizamos la lista.', error: true });
      expect(t.consultas[t.consultas.length - 1].pestana).toBe('RETIRADAS');
    });

    test('FOTO_NO_RETIRADA al reponer (otro la repuso): "el estado cambio" y se actualiza Retiradas', async () => {
      const t = await conRetiradas();
      t.c.pedirAccion('REPONER', uuid(7));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'error', code: 'FOTO_NO_RETIRADA' });
      await flush();
      expect(t.c.estado().aviso).toEqual({ texto: 'El estado de la foto cambió. Actualizamos la lista.', error: true });
    });

    test.each([['UNAUTHORIZED'], ['USER_DISABLED']])('%s al resolver: logout global', async (code) => {
      const t = await conPendientes();
      t.c.pedirAccion('RECHAZAR', uuid(101));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'error', code: code });
      await flush();
      expect(t.e.sesion).toBe(1);
    });

    test('una respuesta de resolver que llega despues de cerrar la pantalla no toca nada', async () => {
      const t = await conPendientes();
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.confirmar();
      t.c.cerrar();
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(1), duplicada: false, solicitudId: uuid(101), resolucion: 'APROBADO' } });
      await flush();
      expect(t.e.visibilidad).toEqual([]);
      expect(t.c.estado().aviso.texto).toBe('');
    });

    test('quitar el ultimo item con mas paginas: se vuelve a pedir la primera pagina (la lista no queda vacia por error)', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(9)], { total: 3, hayMas: true, cursor: 50 }));
      await flush();
      t.c.pedirAccion('RECHAZAR', uuid(109));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(9), duplicada: false, solicitudId: uuid(109), resolucion: 'RECHAZADO' } });
      await flush();
      expect(t.consultas).toHaveLength(2);
      expect(t.consultas[1].cursor).toBeUndefined();
      expect(t.c.estado().pendientes.cargando).toBe(true);
    });

    test('un item resuelto no resucita si una pagina "Ver mas" estaba en vuelo', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(9), itemPend(8)], { total: 3, hayMas: true, cursor: 50 }));
      await flush();
      t.c.verMas();
      t.c.pedirAccion('RECHAZAR', uuid(109));
      t.c.confirmar();
      t.pendEnvios[0]({ status: 'ok', data: { fotoId: uuid(9), duplicada: false, solicitudId: uuid(109), resolucion: 'RECHAZADO' } });
      await flush();
      t.pendientes[1](pagina([itemPend(9), itemPend(7)], { total: 2 }));          // llega con el item ya resuelto
      await flush();
      expect(t.c.estado().pendientes.items.map((i) => i.solicitudId)).toEqual([uuid(108), uuid(107)]);
    });

    test('sin permiso no se abre ninguna confirmacion', async () => {
      const t = await conPendientes();
      t.ctx.permisos = { fotos: true, fotos_carga: true };
      expect(t.c.pedirAccion('APROBAR', uuid(101))).toBe(false);
      expect(t.c.estado().accion).toBeNull();
    });

    test('actualizarConAviso: deja el aviso y vuelve a pedir la primera pagina de la pestaña actual', async () => {
      const t = await conRetiradas();
      t.c.actualizarConAviso('Foto repuesta en la galería.', false);
      expect(t.c.estado().aviso).toEqual({ texto: 'Foto repuesta en la galería.', error: false });
      expect(t.consultas[t.consultas.length - 1].pestana).toBe('RETIRADAS');
      t.c.actualizarConAviso('X', true);
      expect(t.c.estado().aviso.error).toBe(true);
    });

    test('recargar limpia el aviso anterior', async () => {
      const t = await conRetiradas();
      t.c.actualizarConAviso('algo', false);
      t.c.recargar();
      expect(t.c.estado().aviso.texto).toBe('');
    });
  });

  describe('cierre', () => {
    test('cerrar descarta todo: listas, confirmacion, aviso y pestaña', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.c.pedirAccion('APROBAR', uuid(101));
      t.c.cerrar();
      const e = t.c.estado();
      expect(e).toMatchObject({ abierta: false, pestana: 'PENDIENTES', accion: null, aviso: { texto: '', error: false } });
      expect(e.pendientes.items).toEqual([]);
      expect(e.retiradas.items).toEqual([]);
    });

    test('despues de cerrar no se puede seguir operando', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      t.c.cerrar();
      expect(t.c.pedirAccion('APROBAR', uuid(101))).toBe(false);
      t.c.verMas();
      t.c.recargar();
      t.c.seleccionarPestana('RETIRADAS');
      expect(t.consultas).toHaveLength(1);
    });

    test('el estado informado a la UI es una copia: mutarlo no cambia la pantalla', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      const e = t.c.estado();
      e.pendientes.items.pop();
      expect(t.c.estado().pendientes.items).toHaveLength(1);
    });

    test('item(clave) devuelve la tarjeta de la pestaña actual', async () => {
      const t = armar(MOD);
      t.c.abrir();
      t.pendientes[0](pagina([itemPend(1)]));
      await flush();
      expect(t.c.item(uuid(101)).fotoId).toBe(uuid(1));
      expect(t.c.item('otra')).toBeNull();
    });
  });
});

describe('archivo: sin DOM, sin red, sin datos sensibles', () => {
  const fs = require('fs');
  const codigo = fs.readFileSync(require('path').join(__dirname, 'fotosModeracionColaLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test('no toca el DOM ni la red ni el almacenamiento', () => {
    expect(codigo).not.toMatch(/document\.|window\.|innerHTML|fetch\(|XMLHttpRequest|callBackend|api[A-Z]\w+\(|localStorage|sessionStorage|console\./);
  });
  test('no lee ni muestra el email, la secuencia, el clientRequestId ni ids de Drive', () => {
    expect(codigo).not.toMatch(/\.email\b|\.secuencia\b|\.clientRequestId\b|driveFileId|driveThumbId/);
  });
  test('no decide permisos por su cuenta: usa los de la logica de moderacion', () => {
    expect(codigo).not.toMatch(/fotos_moderar|fotos_carga|=== true && .*fotos/);
    expect(codigo).toMatch(/fotosModeracionLogic_puedeModerar\(permisos\)/);
  });
});
