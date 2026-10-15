// Logica pura de la interfaz de decisiones sobre fuentes registrales (js/ubicacionFuenteDecisionesUiLogic.js): roles, acciones por estado, vinculo con las fuentes de la
// ficha, confirmaciones, pedido (lista blanca), flujo (clientRequestId estable, STALE_STATE, errores) y HTML compartido por tarjeta y popup.
const fs = require('fs');
const path = require('path');
const U = require('./ubicacionFuenteDecisionesUiLogic');
global.ubicacionesConocidasLogic_escapar = (t) => String(t === null || t === undefined ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
Object.assign(global, U);

const W = '14-0001';
const REP = { x: 2486460.782, y: 6310651.228 };
const IRR1 = { x: 2486464, y: 6310654 };
const IRR2 = { x: 2486590, y: 6310541 };
const fuenteLocal = (id, tipo, etiqueta, c) => ({ id, tipo, etiqueta, x: c.x, y: c.y, lat: -33.3, lon: -69.1, invalida: false, esOperativo: false, distanciaOperativoM: null, urlMaps: 'u' });
const modeloBase = () => ({
  wellId: W, validas: 4, sinOperativo: false, operativo: null,
  fuentes: [
    fuenteLocal('REPORTE_POZOS', 'REPORTE_POZOS', 'Reporte Pozos', REP), fuenteLocal('IRRIGACION_1', 'IRRIGACION', 'Irrigación (1)', IRR1),
    fuenteLocal('IRRIGACION_2', 'IRRIGACION', 'Irrigación (2)', IRR2), { id: 'CAMPO_VALIDADA', tipo: 'CAMPO_VALIDADA', etiqueta: 'Validada en campo', x: null, y: null, lat: -33.3, lon: -69.1, invalida: false }
  ]
});
const dec = (tipo, c, estado, extra) => Object.assign({ clave: W + '|' + tipo + '|' + c.x.toFixed(3) + '|' + c.y.toFixed(3), fuenteTipo: tipo, x: c.x, y: c.y, posicion: 1, estado, esAceptadaVigente: estado === 'ACEPTADA', esOperativa: false, ultima: null }, extra || {});
const vista = (estados, extra) => Object.assign({
  wellId: W, version: 5, integro: true, padronPeriodo: '2026-09', obsoletas: [], historial: [], resolucion: { todasDescartadas: false, cambiaRespectoDelOriginal: false },
  fuentes: [dec('REPORTE_POZOS', REP, estados[0] || 'SIN_REVISAR'), dec('IRRIGACION', IRR1, estados[1] || 'SIN_REVISAR'), dec('IRRIGACION', IRR2, estados[2] || 'SIN_REVISAR')]
}, extra || {});
const vinculado = (estados, extra, vigente) => U.ufdui_aplicarDecisiones(modeloBase(), vista(estados, extra), !!vigente);

describe('rol (fail-closed: solo con los permisos exactamente en true)', () => {
  test.each([
    [{ ubicacion: true, ubicacion_validar: true }, 'VALIDADOR'],
    [{ ubicacion: true, ubicacion_validar: false }, 'LECTOR'],
    [{ ubicacion: true }, 'LECTOR'],
    [{ ubicacion: true, ubicacion_corregir: true }, 'LECTOR'],                       // corregir NO concede decidir
    [{ ubicacion: false, ubicacion_validar: true }, null],
    [{ ubicacion_validar: true }, null],
    [{ ubicacion: 'SI', ubicacion_validar: 'SI' }, null],
    [{ ubicacion: 1, ubicacion_validar: 1 }, null],
    [{ ubicacion: true, ubicacion_validar: 'true' }, 'LECTOR'],
    [{}, null], [null, null], [undefined, null]
  ])('%j -> %s', (permisos, esperado) => {
    expect(U.ufdui_rol(permisos)).toBe(esperado);
  });
});

describe('acciones por estado y rol', () => {
  test('VALIDADOR: SIN_REVISAR -> Aceptar, Descartar | ACEPTADA -> Quitar aceptacion, Descartar | DESCARTADA -> Restaurar', () => {
    expect(U.ufdui_accionesPara('SIN_REVISAR', 'VALIDADOR')).toEqual(['ACEPTAR', 'DESCARTAR']);
    expect(U.ufdui_accionesPara('ACEPTADA', 'VALIDADOR')).toEqual(['QUITAR_ACEPTACION', 'DESCARTAR']);
    expect(U.ufdui_accionesPara('DESCARTADA', 'VALIDADOR')).toEqual(['RESTAURAR']);
  });
  test('LECTOR y sin rol: ninguna accion autoritativa en ningun estado', () => {
    ['SIN_REVISAR', 'ACEPTADA', 'DESCARTADA'].forEach((e) => {
      expect(U.ufdui_accionesPara(e, 'LECTOR')).toEqual([]);
      expect(U.ufdui_accionesPara(e, null)).toEqual([]);
    });
  });
  test('un estado desconocido no ofrece nada', () => {
    expect(U.ufdui_accionesPara('SUPERADA', 'VALIDADOR')).toEqual([]);
    expect(U.ufdui_accionesPara(undefined, 'VALIDADOR')).toEqual([]);
  });
  test('"Validada en campo" JAMAS tiene acciones (es de UbicacionCorrecciones), aunque el backend trajera una fuente parecida', () => {
    const m = vinculado([]);
    const campo = m.fuentes.filter((f) => f.tipo === 'CAMPO_VALIDADA')[0];
    expect(campo.decision).toBeNull();
    expect(U.ufdui_accionesDeFuente(campo, m, 'VALIDADOR')).toEqual([]);
    const falso = Object.assign({}, campo, { decision: { estado: 'SIN_REVISAR', fuenteTipo: 'CAMPO_VALIDADA', x: 1, y: 1 } });
    expect(U.ufdui_accionesDeFuente(falso, m, 'VALIDADOR')).toEqual([]);
  });
  test('sin decisiones leidas (o historial inconsistente) no hay acciones', () => {
    const sin = U.ufdui_aplicarDecisiones(modeloBase(), null, false);
    sin.fuentes.forEach((f) => expect(U.ufdui_accionesDeFuente(f, sin, 'VALIDADOR')).toEqual([]));
    const inc = vinculado([], { integro: false });
    inc.fuentes.forEach((f) => expect(U.ufdui_accionesDeFuente(f, inc, 'VALIDADOR')).toEqual([]));
  });
});

describe('vinculo entre las fuentes de la ficha y las del backend', () => {
  test('cada fuente registral recibe su estado por tipo + x + y (3 decimales)', () => {
    const m = vinculado(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(m.fuentes.map((f) => f.decision && f.decision.estado)).toEqual(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA', null]);
    expect(m.decisiones).toMatchObject({ integro: true, version: 5, todasDescartadas: false, cambiaPuntoRegistral: false });
  });
  test('x/y del padron como texto o con mas decimales igual se vinculan (normalizacion a 3 decimales)', () => {
    const m = modeloBase();
    m.fuentes[0].x = '2486460.7820';
    m.fuentes[0].y = 6310651.2280001;
    U.ufdui_aplicarDecisiones(m, vista([]), false);
    expect(m.fuentes[0].decision).not.toBeNull();
  });
  test('una fuente que el backend no conoce queda sin decision (y sin acciones)', () => {
    const m = modeloBase();
    m.fuentes[1].x = 1;
    U.ufdui_aplicarDecisiones(m, vista([]), false);
    expect(m.fuentes[1].decision).toBeNull();
  });
  test('una vista de OTRO pozo, sin fuentes o sin version se ignora por completo', () => {
    [Object.assign(vista([]), { wellId: '01-0012' }), Object.assign(vista([]), { fuentes: null }), Object.assign(vista([]), { version: 'x' }), null, undefined, 'x'].forEach((v) => {
      const m = U.ufdui_aplicarDecisiones(modeloBase(), v, false);
      expect(m.decisiones).toBeNull();
      m.fuentes.forEach((f) => expect(f.decision).toBeNull());
    });
  });
  test('filas identicas del padron (misma identidad) comparten el estado', () => {
    const m = modeloBase();
    m.fuentes.push(fuenteLocal('IRRIGACION_3', 'IRRIGACION', 'Irrigación (3)', IRR1));
    U.ufdui_aplicarDecisiones(m, vista(['SIN_REVISAR', 'DESCARTADA']), false);
    expect(m.fuentes[1].decision.estado).toBe('DESCARTADA');
    expect(m.fuentes[4].decision.estado).toBe('DESCARTADA');
  });
  test('todasDescartadas y cambiaPuntoRegistral solo se informan con historial integro y SIN validada en campo vigente (esa manda)', () => {
    const v = vista(['DESCARTADA', 'DESCARTADA', 'DESCARTADA'], { resolucion: { todasDescartadas: true, cambiaRespectoDelOriginal: true } });
    expect(U.ufdui_aplicarDecisiones(modeloBase(), v, false).decisiones).toMatchObject({ todasDescartadas: true, cambiaPuntoRegistral: true });
    expect(U.ufdui_aplicarDecisiones(modeloBase(), v, true).decisiones).toMatchObject({ todasDescartadas: false, cambiaPuntoRegistral: false });
    expect(U.ufdui_aplicarDecisiones(modeloBase(), Object.assign({}, v, { integro: false }), false).decisiones).toMatchObject({ integro: false, todasDescartadas: false });
  });
});

describe('confirmaciones', () => {
  const f = (estado) => ({ etiqueta: 'Irrigación (2)', decision: { estado } });
  test('ACEPTAR: pregunta exacta, motivo opcional; con validada en campo vigente aclara que lo operativo sigue siendo la validada', () => {
    const c = U.ufdui_confirmacion('ACEPTAR', f('SIN_REVISAR'), {});
    expect(c).toMatchObject({ titulo: '¿Aceptar esta fuente como referencia registral?', motivo: 'opcional', fuente: 'Irrigación (2)' });
    expect(c.parrafos).toEqual([]);
    const cv = U.ufdui_confirmacion('ACEPTAR', f('SIN_REVISAR'), { hayValidadaVigente: true });
    expect(cv.parrafos).toEqual(['Esta fuente quedará aceptada como referencia registral, pero la ubicación operativa seguirá siendo la validada en campo.']);
  });
  test('DESCARTAR: motivo OBLIGATORIO y aclara que la coordenada original no se elimina; si estaba aceptada lo avisa', () => {
    const c = U.ufdui_confirmacion('DESCARTAR', f('SIN_REVISAR'), {});
    expect(c.motivo).toBe('obligatorio');
    expect(c.parrafos).toEqual(['La coordenada original no se eliminará. Quedará conservada y marcada como descartada.']);
    expect(U.ufdui_confirmacion('DESCARTAR', f('ACEPTADA'), {}).parrafos[0]).toMatch(/aceptada.*quita su aceptación/);
  });
  test('QUITAR_ACEPTACION: confirmacion simple (motivo opcional)', () => {
    const c = U.ufdui_confirmacion('QUITAR_ACEPTACION', f('ACEPTADA'), {});
    expect(c).toMatchObject({ motivo: 'opcional', titulo: '¿Quitar la aceptación de esta fuente?' });
  });
  test('RESTAURAR: aclara que vuelve al calculo automatico y NO queda aceptada', () => {
    const c = U.ufdui_confirmacion('RESTAURAR', f('DESCARTADA'), {});
    expect(c.parrafos).toEqual(['La fuente volverá a participar del cálculo automático. No quedará aceptada automáticamente.']);
    expect(c.motivo).toBe('opcional');
  });
  test('una accion desconocida no tiene confirmacion', () => {
    expect(U.ufdui_confirmacion('ELIMINAR', f('SIN_REVISAR'), {})).toBeNull();
    expect(U.ufdui_confirmacion('QUITAR', f('SIN_REVISAR'), {})).toBeNull();          // en el API la accion se llama QUITAR_ACEPTACION
  });
  test('ningun texto habla de "eliminar" la coordenada', () => {
    const todo = JSON.stringify([U.UFDUI_ACCIONES, U.UFDUI_MENSAJES_ERROR]);
    expect(todo).not.toMatch(/eliminar (la |esta )?coordenada|borrar|se eliminar[áa] la fuente/i);
  });
});

describe('motivo', () => {
  test('DESCARTAR sin motivo, en blanco o solo con espacios/saltos: invalido', () => {
    ['', '   ', '\n\t ', undefined, null, 5].forEach((m) => expect(U.ufdui_validarMotivo('DESCARTAR', m)).toMatch(/Indicá el motivo/));
  });
  test('las demas acciones aceptan motivo vacio', () => {
    ['ACEPTAR', 'QUITAR_ACEPTACION', 'RESTAURAR'].forEach((a) => expect(U.ufdui_validarMotivo(a, '')).toBeNull());
  });
  test('maximo 300 caracteres en todas', () => {
    expect(U.ufdui_validarMotivo('DESCARTAR', 'x'.repeat(300))).toBeNull();
    ['DESCARTAR', 'ACEPTAR'].forEach((a) => expect(U.ufdui_validarMotivo(a, 'x'.repeat(301))).toMatch(/300/));
  });
});

describe('pedido: lista blanca exacta y x/y del backend', () => {
  test('exactamente 8 campos; x/y salen de la decision del backend; motivo limpio', () => {
    const d = { fuenteTipo: 'IRRIGACION', x: 2486590, y: 6310541, clave: 'interna', estado: 'SIN_REVISAR', ultima: { nombre: 'X' } };
    const p = U.ufdui_construirPedido(W, d, 'DESCARTAR', '  coordenada\ncorrida  ', 5, 'ufd-abc12345');
    expect(Object.keys(p).sort()).toEqual(['accion', 'clientRequestId', 'fuenteTipo', 'motivo', 'versionVista', 'wellId', 'x', 'y']);
    expect(p).toEqual({ wellId: W, fuenteTipo: 'IRRIGACION', x: 2486590, y: 6310541, accion: 'DESCARTAR', motivo: 'coordenada corrida', versionVista: 5, clientRequestId: 'ufd-abc12345' });
  });
  test('clientRequestId: 8 a 64 caracteres [A-Za-z0-9_-]', () => {
    for (let i = 0; i < 20; i += 1) {
      expect(U.ufdui_nuevoClientRequestId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    }
    expect(U.ufdui_nuevoClientRequestId(() => 0.5)).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('flujo de decision', () => {
  const D = { fuenteTipo: 'REPORTE_POZOS', x: REP.x, y: REP.y, estado: 'SIN_REVISAR' };
  const entrada = (extra) => Object.assign({ wellId: W, decision: D, accion: 'ACEPTAR', motivo: '', versionVista: 5 }, extra || {});
  const okResp = (extra) => ({ status: 'ok', data: Object.assign(vista(['ACEPTADA']), { version: 6, decision: { secuencia: 6, evento: 'ACEPTADA' }, duplicada: false }, extra || {}) });
  function armar(respuestas, lecturas) {
    let ids = 0;
    const enviados = [];
    const cola = respuestas.slice();
    const leer = jest.fn(() => Promise.resolve(lecturas === undefined ? { status: 'ok', data: vista(['SIN_REVISAR'], { version: 9 }) } : lecturas));
    const flujo = U.ufdui_crearFlujo({
      enviar: (p) => { enviados.push(p); const r = cola.length > 1 ? cola.shift() : cola[0]; return r instanceof Error ? Promise.reject(r) : Promise.resolve(r); },
      leer, generarId: () => 'ufd-id-' + (++ids) + '-xxxxxxxx'
    });
    return { flujo, enviados, leer };
  }

  test('exito: devuelve la vista ACTUALIZADA del backend y el mensaje de cada accion', async () => {
    const { flujo, enviados } = armar([okResp()]);
    const r = await flujo.decidir(entrada());
    expect(r).toMatchObject({ tipo: 'ok', accion: 'ACEPTAR', duplicada: false, mensaje: 'Fuente aceptada como referencia registral.' });
    expect(r.vista.version).toBe(6);
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ wellId: W, accion: 'ACEPTAR', versionVista: 5, clientRequestId: 'ufd-id-1-xxxxxxxx' });
  });

  test.each([
    ['ACEPTAR', 'Fuente aceptada como referencia registral.'],
    ['DESCARTAR', 'Fuente descartada. La coordenada original se conserva.'],
    ['QUITAR_ACEPTACION', 'Se quitó la aceptación de la fuente.'],
    ['RESTAURAR', 'Fuente restaurada: vuelve a participar del cálculo automático.']
  ])('mensaje de exito de %s', async (accion, texto) => {
    const { flujo } = armar([okResp()]);
    expect((await flujo.decidir(entrada({ accion, motivo: 'm' }))).mensaje).toBe(texto);
  });

  test('DESCARTAR sin motivo: invalido y NO se envia nada', async () => {
    const { flujo, enviados } = armar([okResp()]);
    expect(await flujo.decidir(entrada({ accion: 'DESCARTAR', motivo: '  ' }))).toMatchObject({ tipo: 'invalido' });
    expect(enviados).toEqual([]);
  });

  test('accion inexistente o sin decision: invalido y no se envia', async () => {
    const { flujo, enviados } = armar([okResp()]);
    expect((await flujo.decidir(entrada({ accion: 'ELIMINAR' }))).tipo).toBe('invalido');
    expect((await flujo.decidir(entrada({ decision: null }))).tipo).toBe('invalido');
    expect(enviados).toEqual([]);
  });

  test('doble toque: mientras hay un envio en curso devuelve LA MISMA promesa y envia una sola vez', async () => {
    const { flujo, enviados } = armar([okResp()]);
    const a = flujo.decidir(entrada());
    const b = flujo.decidir(entrada());
    expect(a).toBe(b);
    await a;
    expect(enviados).toHaveLength(1);
  });

  test('corte de red: tipo red y el REINTENTO del mismo contenido reutiliza el clientRequestId (el backend lo deduplica)', async () => {
    const { flujo, enviados } = armar([new Error('sin red'), okResp({ duplicada: true })]);
    const r1 = await flujo.decidir(entrada());
    expect(r1).toMatchObject({ tipo: 'red' });
    expect(r1.mensaje).toBe(U.UFDUI_TEXTO_RED);
    const r2 = await flujo.decidir(entrada());
    expect(r2).toMatchObject({ tipo: 'ok', duplicada: true });
    expect(enviados[0].clientRequestId).toBe(enviados[1].clientRequestId);
  });

  test('si cambia el contenido (otro motivo, otra version, otra accion) hay otro clientRequestId (si no el backend responderia IDEMPOTENCY_CONFLICT)', async () => {
    const { flujo, enviados } = armar([new Error('sin red')]);
    await flujo.decidir(entrada({ accion: 'DESCARTAR', motivo: 'uno' }));
    await flujo.decidir(entrada({ accion: 'DESCARTAR', motivo: 'dos' }));
    await flujo.decidir(entrada({ accion: 'DESCARTAR', motivo: 'dos', versionVista: 6 }));
    await flujo.decidir(entrada({ accion: 'ACEPTAR' }));
    expect(new Set(enviados.map((p) => p.clientRequestId)).size).toBe(4);
  });

  test('despues de un exito, la proxima decision (aunque sea igual) es otro intento', async () => {
    const { flujo, enviados } = armar([okResp()]);
    await flujo.decidir(entrada());
    await flujo.decidir(entrada());
    expect(enviados[0].clientRequestId).not.toBe(enviados[1].clientRequestId);
  });

  test.each(['STALE_STATE', 'ALREADY_IN_STATE', 'INVALID_TRANSITION', 'SOURCE_NOT_FOUND'])('%s: se RELEE, se informa como desactualizado y NO se repite la decision', async (code) => {
    const { flujo, enviados, leer } = armar([{ status: 'error', code, message: 'x', versionActual: 9 }]);
    const r = await flujo.decidir(entrada());
    expect(r).toMatchObject({ tipo: 'desactualizado', code });
    expect(r.vista.version).toBe(9);
    expect(leer).toHaveBeenCalledWith(W);
    expect(enviados).toHaveLength(1);                         // nada de reenviar solo
    expect(r.mensaje).not.toMatch(code);                      // sin codigo tecnico
  });

  test('STALE_STATE dice exactamente "Esta información cambió mientras la estabas revisando."', async () => {
    const { flujo } = armar([{ status: 'error', code: 'STALE_STATE', versionActual: 9 }]);
    expect((await flujo.decidir(entrada())).mensaje.indexOf('Esta información cambió mientras la estabas revisando.')).toBe(0);
  });

  test('STALE_STATE y la relectura falla: igual informa desactualizado (vista null)', async () => {
    const { flujo } = armar([{ status: 'error', code: 'STALE_STATE' }], { status: 'error', code: 'SERVICE_UNAVAILABLE' });
    expect(await flujo.decidir(entrada())).toMatchObject({ tipo: 'desactualizado', vista: null });
  });

  test('despues de STALE el siguiente intento ya no reutiliza el id viejo', async () => {
    const { flujo, enviados } = armar([{ status: 'error', code: 'STALE_STATE' }, okResp()]);
    await flujo.decidir(entrada());
    await flujo.decidir(entrada({ versionVista: 9 }));
    expect(enviados[0].clientRequestId).not.toBe(enviados[1].clientRequestId);
  });

  test.each([
    ['UNAUTHORIZED', true], ['USER_DISABLED', true], ['PERMISSION_DENIED', false], ['INCONSISTENT_STATE', false], ['SERVICE_UNAVAILABLE', false], ['INVALID_MOTIVO', false], ['IDEMPOTENCY_CONFLICT', false]
  ])('error %s: mensaje en castellano sin el codigo; sesionVencida=%s', async (code, vencida) => {
    const { flujo } = armar([{ status: 'error', code, message: 'detalle tecnico interno' }]);
    const r = await flujo.decidir(entrada());
    expect(r).toMatchObject({ tipo: 'error', code, sesionVencida: vencida });
    expect(r.mensaje).not.toMatch(/detalle tecnico|[A-Z]{3,}_[A-Z_]+/);
    expect(r.mensaje.length).toBeGreaterThan(10);
  });

  test('una respuesta rara (sin status) es un error generico, no revienta', async () => {
    const { flujo } = armar([undefined]);
    expect((await flujo.decidir(entrada())).tipo).toBe('error');
  });
});

describe('HTML compartido por tarjeta y popup', () => {
  test('chip de estado: solo para fuentes con decision, y el texto es el de la UI', () => {
    const m = vinculado(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    expect(m.fuentes.map((f) => U.ufdui_htmlEstado(f).replace(/<[^>]+>/g, ''))).toEqual(['Aceptada', 'Sin revisar', 'Descartada', '']);
  });

  test('botones: los de las acciones permitidas, con data-ufd-accion y data-ufd-fuente', () => {
    const m = vinculado(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    const h = (i) => U.ufdui_htmlAcciones(m.fuentes[i], m, 'VALIDADOR');
    expect(h(0).match(/data-ufd-accion="(\w+)"/g)).toEqual(['data-ufd-accion="QUITAR_ACEPTACION"', 'data-ufd-accion="DESCARTAR"']);
    expect(h(1).match(/data-ufd-accion="(\w+)"/g)).toEqual(['data-ufd-accion="ACEPTAR"', 'data-ufd-accion="DESCARTAR"']);
    expect(h(2).match(/data-ufd-accion="(\w+)"/g)).toEqual(['data-ufd-accion="RESTAURAR"']);
    expect(h(1)).toContain('data-ufd-fuente="IRRIGACION_1"');
    expect(h(1)).toContain('>Aceptar<');
    expect(U.ufdui_htmlAcciones(m.fuentes[3], m, 'VALIDADOR')).toBe('');            // validada en campo
    expect(U.ufdui_htmlAcciones(m.fuentes[1], m, 'LECTOR')).toBe('');
    expect(U.ufdui_htmlAcciones(m.fuentes[1], m, null)).toBe('');
  });

  test('ningun boton dice "Eliminar"', () => {
    const m = vinculado(['ACEPTADA', 'SIN_REVISAR', 'DESCARTADA']);
    m.fuentes.forEach((f) => expect(U.ufdui_htmlAcciones(f, m, 'VALIDADOR')).not.toMatch(/Eliminar|Borrar/i));
  });

  test('historia: quien, cuando y (si es descarte) el motivo; escapa HTML; nada si esta sin revisar', () => {
    const v = vista(['DESCARTADA', 'SIN_REVISAR']);
    v.fuentes[0].ultima = { secuencia: 3, evento: 'DESCARTADA', nombre: 'Ana <b>Pérez</b>', timestampUtc: '2026-10-15T02:30:00.000Z', motivo: 'queda en el río & lejos' };
    const m = U.ufdui_aplicarDecisiones(modeloBase(), v, false);
    const h = U.ufdui_htmlHistoria(m.fuentes[0]);
    expect(h).toContain('Descartada por Ana &lt;b&gt;Pérez&lt;/b&gt; · 14/10/2026 · queda en el río &amp; lejos');     // 02:30 UTC = 23:30 del 14 en Argentina
    expect(U.ufdui_htmlHistoria(m.fuentes[1])).toBe('');
    expect(U.ufdui_htmlHistoria(m.fuentes[3])).toBe('');
  });

  test('historia de una aceptada no muestra motivo (es opcional y no se destaca)', () => {
    const v = vista(['ACEPTADA']);
    v.fuentes[0].ultima = { nombre: 'Ana', timestampUtc: '2026-10-15T15:00:00.000Z', motivo: 'privado' };
    expect(U.ufdui_textoUltima(U.ufdui_aplicarDecisiones(modeloBase(), v, false).fuentes[0])).toBe('Aceptada por Ana · 15/10/2026');
  });

  test('la historia nunca incluye emails ni ids internos', () => {
    const v = vista(['DESCARTADA']);
    v.fuentes[0].ultima = { nombre: 'Ana', timestampUtc: '2026-10-15T15:00:00.000Z', motivo: 'm', email: 'a@x.com', decisionId: 'secreto' };
    const h = U.ufdui_htmlHistoria(U.ufdui_aplicarDecisiones(modeloBase(), v, false).fuentes[0]);
    expect(h).not.toMatch(/@|secreto/);
  });

  test('avisos de la seccion: inconsistente, todas descartadas, sin efecto en mapas y el aviso de la ultima decision', () => {
    const inc = vinculado([], { integro: false });
    expect(U.ufdui_htmlNotasSeccion(inc, null)).toContain('necesita una revisión técnica');
    const todas = U.ufdui_aplicarDecisiones(modeloBase(), vista(['DESCARTADA', 'DESCARTADA', 'DESCARTADA'], { resolucion: { todasDescartadas: true, cambiaRespectoDelOriginal: true } }), false);
    const h = U.ufdui_htmlNotasSeccion(todas, { tipo: 'ok', texto: 'Fuente descartada.' });
    expect(h).toContain('Sin ubicación operativa de Irrigación. Todas las fuentes conocidas fueron descartadas.');
    expect(h).toContain('Las decisiones tomadas todavía no cambian el punto que usan los mapas.');
    expect(h).toContain('ufd-aviso-ok');
    expect(U.ufdui_htmlNotasSeccion(vinculado([]), null)).toBe('');
  });

  test('fecha: hora de Argentina (UTC-3); invalida -> vacio', () => {
    expect(U.ufdui_fechaCorta('2026-01-01T02:59:59.000Z')).toBe('31/12/2025');
    expect(U.ufdui_fechaCorta('2026-01-01T03:00:00.000Z')).toBe('01/01/2026');
    ['', 'no', null, undefined, 5].forEach((x) => expect(U.ufdui_fechaCorta(x)).toBe(''));
  });
});

describe('aislamiento del modulo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionFuenteDecisionesUiLogic.js'), 'utf8');
  const codigo = fuente.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  test('sin DOM, red, almacenamiento ni el dominio del backend (ufd_)', () => {
    expect(codigo).not.toMatch(/document\.|window\.|fetch\(|callBackend|XMLHttpRequest|localStorage|sessionStorage|\bL\.|navigator\.|\bapi[A-Z]\w+\(|\bufd_/);
  });
  test('no conoce el estado R, el mapa, Cerca Mio ni la seleccion', () => {
    expect(codigo).not.toMatch(/mapaDataset|cercaMio|seleccion|reemplazo/i);
  });
});
