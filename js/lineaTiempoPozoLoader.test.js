// Cargador de la Linea de tiempo (E6-2): permisos exactos, paralelismo, paginacion de Observaciones (cursor, tope 5 paginas / 500, cortes fail-safe), estados por fuente, fallos parciales,
// completa / parcial, errores de sesion, respuestas viejas, latencia con reloj inyectable y PRIVACIDAD. El modelo de eventos es el REAL (js/lineaTiempoPozoLogic.js); las lecturas del
// backend se simulan (el contrato contra el backend real esta en js/lineaTiempoPozoLoaderContrato.test.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('./lineaTiempoPozoLogic');
const M = require('./lineaTiempoPozoLoader');

const W = '14-0006';
const OTRO = '14-0007';
const TOKEN = 'tok-secreto-xyz-123';
const T1 = '2026-10-20T15:00:00.000Z';
const T2 = '2026-10-21T18:30:00.000Z';
const TODOS = { ubicacion: true, reemplazo: true, observaciones: true };

// --- payloads con la forma real de cada endpoint ---
const pad = (n) => String(n).padStart(4, '0');
const correccion = (n, extra) => Object.assign({
  correccionId: 'corr-' + pad(n), wellId: W, lat: -33.3, lon: -69.1, metodo: 'PUNTO_EN_MAPA', observacion: 'Obs ' + n, nombrePropone: 'Ana', timestamp: T1, estado: 'PROPUESTA', resolucion: null, propia: true
}, extra || {});
const ok = (data) => ({ status: 'ok', data });
const falla = (code) => ({ status: 'error', code, message: 'detalle tecnico que nunca debe salir' });
const pozoUbic = (historial) => ok({ wellId: W, vigente: null, pendientes: [], historial });
const decision = (sec, extra) => Object.assign({ secuencia: sec, evento: 'ACEPTADA', fuenteTipo: 'REPORTE_POZOS', x: 1, y: 2, nombre: 'Valeria', timestampUtc: T1, motivo: null, obsoleta: false }, extra || {});
const pozoDec = (historial, extra) => ok(Object.assign({ wellId: W, version: 1, integro: true, historial }, extra || {}));
const evaluacion = (n, extra) => Object.assign({ evaluacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, timestamp: T1, nombre: 'Marta', estado: 'APTO', motivo: 'APTO_SIN_OBSERVACIONES', observacion: null }, extra || {});
const pozoReemp = (evaluaciones) => ok({ wellId: W, evaluaciones });
const obs = (n, extra) => Object.assign({ observacionId: '00000000-0000-4000-8000-' + String(n).padStart(12, '0'), wellId: W, estado: 'ACTIVA', texto: 'Texto ' + n, categoria: null, nombre: 'Ana', timestamp: T1, puedeAnular: false, anulacion: null }, extra || {});
const obsAnulada = (n, extra) => obs(n, Object.assign({ estado: 'ANULADA', texto: null, anulacion: { nombre: 'Moderadora', timestamp: T2, motivo: 'Cargada por error' } }, extra || {}));
let contador = 0;
const lote = (cantidad) => Array.from({ length: cantidad }, () => { contador += 1; return obs(contador); });
const pag = (items, hayMas, cursor, extra) => ok(Object.assign({ wellId: W, total: items.length, activas: items.length, anuladas: 0, hayMas, cursor: cursor === undefined ? null : cursor, observaciones: items }, extra || {}));

beforeEach(() => { contador = 0; });

// --- entorno con respuestas inmediatas guionadas ---
// guion[fuente]: una respuesta, una funcion (args, n) => respuesta, o un arreglo (la n-esima llamada). 'RED' rechaza la promesa; 'THROW' lanza de forma sincrona.
function auto(guion, opciones) {
  const o = opciones || {};
  const llamadas = { correcciones: [], decisiones: [], reemplazo: [], observaciones: [] };
  const reloj = { t: 0 };
  const api = {};
  Object.keys(llamadas).forEach((k) => {
    api[k] = (...args) => {
      llamadas[k].push(args);
      const n = llamadas[k].length - 1;
      const g = guion[k];
      const r = typeof g === 'function' ? g(args, n) : (Array.isArray(g) ? g[n] : g);
      if (r === 'RED') { return Promise.reject(new Error('red caida')); }
      if (r === 'THROW') { throw new Error('boom'); }
      return Promise.resolve(r);
    };
  });
  const sesion = [];
  const loader = M.lineaTiempoPozoLoader_crear({ api, logica: L, ahora: () => reloj.t, onSesionExpirada: (c) => sesion.push(c) });
  return { loader, llamadas, reloj, sesion, cargar: (permisos, pozo, token) => loader.cargar(token === undefined ? TOKEN : token, pozo || W, permisos === undefined ? TODOS : permisos) };
}

// --- entorno con respuestas controladas a mano (paralelismo, respuestas viejas) ---
function manual() {
  const llamadas = { correcciones: [], decisiones: [], reemplazo: [], observaciones: [] };
  const reloj = { t: 1000 };
  const api = {};
  Object.keys(llamadas).forEach((k) => {
    api[k] = (...args) => new Promise((resolve, reject) => { llamadas[k].push({ args, resolve, reject }); });
  });
  const sesion = [];
  const loader = M.lineaTiempoPozoLoader_crear({ api, logica: L, ahora: () => reloj.t, onSesionExpirada: (c) => sesion.push(c) });
  return { loader, llamadas, reloj, sesion };
}
const flush = async () => { for (let i = 0; i < 10; i += 1) { await new Promise((r) => setImmediate(r)); } };
const copia = (x) => JSON.parse(JSON.stringify(x));

const estados = (r) => ({ u: r.fuentes.ubicacion.estado, r: r.fuentes.reemplazo.estado, o: r.fuentes.observaciones.estado });
const idsDe = (r, fuente) => r.eventos.filter((e) => e.fuente === fuente).map((e) => e.id);

describe('acceso y permisos exactos', () => {
  test('lineaTiempoPozoLogic_puedeVerLineaTiempo: al menos uno === true; el resto del mundo no', () => {
    const f = L.lineaTiempoPozoLogic_puedeVerLineaTiempo;
    expect(f({ ubicacion: true })).toBe(true);
    expect(f({ reemplazo: true })).toBe(true);
    expect(f({ observaciones: true })).toBe(true);
    expect(f({ ubicacion: false, reemplazo: false, observaciones: true })).toBe(true);
    expect(f({ perfil: true, datos: true, ne: true, fotos: true, fotos_carga: true, ubicacion_validar: true, observaciones_agregar: true, observaciones_anular: true })).toBe(false);
    ['SI', 'si', 'true', 1, '1', {}, [], 'x'].forEach((v) => {
      expect(f({ ubicacion: v })).toBe(false);
      expect(f({ reemplazo: v })).toBe(false);
      expect(f({ observaciones: v })).toBe(false);
    });
    [null, undefined, 'x', 5, true, [], {}].forEach((p) => expect(f(p)).toBe(false));
    expect(f({ ubicacion: 'SI', reemplazo: 1, observaciones: 'true' })).toBe(false);
  });

  test('sin NINGUN permiso exacto: resultado controlado, cero requests, puedeVer=false', async () => {
    [{}, null, undefined, { perfil: true, datos: true, ne: true, fotos: true }, { ubicacion: 'SI', reemplazo: 1, observaciones: 'true' }, { ubicacion: false, reemplazo: false, observaciones: false }].forEach(async () => {});
    for (const permisos of [{}, null, { perfil: true, datos: true, ne: true, fotos: true }, { ubicacion: 'SI', reemplazo: 1, observaciones: 'true' }, { ubicacion: false, reemplazo: false, observaciones: false }]) {
      const e = auto({});
      const r = await e.cargar(permisos);
      expect(Object.keys(e.llamadas).map((k) => e.llamadas[k].length)).toEqual([0, 0, 0, 0]);
      expect(r.puedeVer).toBe(false);
      expect(r.auth).toBeNull();
      expect(r.eventos).toEqual([]);
      expect(estados(r)).toEqual({ u: 'SIN_PERMISO', r: 'SIN_PERMISO', o: 'SIN_PERMISO' });
      expect(r.completa).toBe(false);
      expect(r.parcial).toBe(false);
      expect(r.duracionMs).toBe(0);
    }
  });

  test('cada fuente solo con SU permiso exacto: ni se pide la que no corresponde', async () => {
    const casos = [
      [{ ubicacion: true }, [1, 1, 0, 0]],
      [{ reemplazo: true }, [0, 0, 1, 0]],
      [{ observaciones: true }, [0, 0, 0, 1]],
      [{ ubicacion: true, reemplazo: true }, [1, 1, 1, 0]],
      [{ ubicacion: true, observaciones: true }, [1, 1, 0, 1]],
      [{ ubicacion: true, reemplazo: true, observaciones: true }, [1, 1, 1, 1]],
      [{ ubicacion: true, reemplazo: 'SI', observaciones: 1 }, [1, 1, 0, 0]],
      [{ ubicacion: 1, reemplazo: true, observaciones: 'true' }, [0, 0, 1, 0]],
      [{ ubicacion: true, reemplazo: true, observaciones: true, perfil: true, datos: true, ne: true, fotos: true }, [1, 1, 1, 1]]
    ];
    for (const [permisos, esperado] of casos) {
      const e = auto({ correcciones: pozoUbic([]), decisiones: pozoDec([]), reemplazo: pozoReemp([]), observaciones: pag([], false) });
      await e.cargar(permisos);
      expect(Object.keys(e.llamadas).map((k) => e.llamadas[k].length)).toEqual(esperado);
    }
  });

  test('los permisos de otros modulos (perfil, datos, ne, fotos) no habilitan ninguna fuente', async () => {
    const e = auto({ reemplazo: pozoReemp([]) });
    await e.cargar({ reemplazo: true, perfil: true, datos: true, ne: true, fotos: true, fotos_carga: true, ubicacion_validar: true, observaciones_agregar: true, observaciones_anular: true });
    expect(Object.keys(e.llamadas).map((k) => e.llamadas[k].length)).toEqual([0, 0, 1, 0]);
  });

  test('una fuente sin permiso queda SIN_PERMISO, sin duracion, y no impide completa', async () => {
    const e = auto({ reemplazo: pozoReemp([evaluacion(1)]) });
    const r = await e.cargar({ reemplazo: true });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'SIN_PERMISO', cantidadEventos: 0, omitidos: [], duracionMs: 0, motivoParcial: null });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'SIN_PERMISO', cantidadEventos: 0, paginas: 0, cargadas: 0 });
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
  });

  test('parametros invalidos (token o pozo): no se pide nada y las fuentes permitidas quedan en ERROR PARAMETROS_INVALIDOS', async () => {
    for (const [token, pozo] of [['', W], [null, W], [5, W], [TOKEN, 'abc'], [TOKEN, ''], [TOKEN, null], [TOKEN, '14-006']]) {
      const e = auto({});
      const r = await e.loader.cargar(token, pozo, TODOS);
      expect(Object.keys(e.llamadas).map((k) => e.llamadas[k].length)).toEqual([0, 0, 0, 0]);
      expect(estados(r)).toEqual({ u: 'ERROR', r: 'ERROR', o: 'ERROR' });
      expect(r.fuentes.reemplazo.codigoError).toBe('PARAMETROS_INVALIDOS');
      expect(r.completa).toBe(false);
      expect(r.parcial).toBe(false);
      expect(r.auth).toBeNull();
    }
  });

  test('los requests llevan token, pozo y los parametros de paginacion correctos', async () => {
    const e = auto({ correcciones: pozoUbic([]), decisiones: pozoDec([]), reemplazo: pozoReemp([]), observaciones: pag([], false) });
    await e.cargar(TODOS);
    expect(e.llamadas.correcciones).toEqual([[TOKEN, W]]);
    expect(e.llamadas.decisiones).toEqual([[TOKEN, W]]);
    expect(e.llamadas.reemplazo).toEqual([[TOKEN, W]]);
    expect(e.llamadas.observaciones).toEqual([[TOKEN, W, 100, undefined]]);
  });
});

describe('paralelismo y latencia', () => {
  test('las 4 lecturas iniciales arrancan en el mismo instante, sin esperar a ninguna', () => {
    const e = manual();
    e.loader.cargar(TOKEN, W, TODOS);
    expect(e.llamadas.correcciones.length).toBe(1);
    expect(e.llamadas.decisiones.length).toBe(1);
    expect(e.llamadas.reemplazo.length).toBe(1);
    expect(e.llamadas.observaciones.length).toBe(1);                 // todo esto SIN resolver ninguna promesa
    expect(e.llamadas.observaciones[0].args).toEqual([TOKEN, W, 100, undefined]);
  });

  test('una fuente lenta no bloquea a las demas, y observaciones pagina de forma secuencial', async () => {
    const e = manual();
    let resultado = null;
    e.loader.cargar(TOKEN, W, TODOS).then((r) => { resultado = r; });
    e.llamadas.reemplazo[0].resolve(pozoReemp([evaluacion(1)]));
    e.llamadas.observaciones[0].resolve(pag(lote(2), true, 40));
    await flush();
    expect(e.llamadas.observaciones.length).toBe(2);                 // la pagina 2 se pide apenas llega la 1, aunque correcciones y decisiones sigan pendientes
    expect(e.llamadas.observaciones[1].args[3]).toBe(40);
    expect(resultado).toBeNull();                                    // y el resultado espera a las pendientes
    e.llamadas.observaciones[1].resolve(pag(lote(1), false));
    e.llamadas.correcciones[0].resolve(pozoUbic([correccion(1)]));
    await flush();
    expect(resultado).toBeNull();                                    // decisiones sigue sin responder
    e.llamadas.decisiones[0].resolve(pozoDec([decision(1)]));
    await flush();
    expect(resultado).not.toBeNull();
    expect(resultado.eventos.length).toBe(1 + 3 + 1 + 1);
  });

  test('la pagina 2 de observaciones NUNCA se pide antes de recibir la 1 (secuencial por cursor)', async () => {
    const e = manual();
    e.loader.cargar(TOKEN, W, { observaciones: true });
    await flush();
    expect(e.llamadas.observaciones.length).toBe(1);
    e.llamadas.observaciones[0].resolve(pag(lote(1), true, 80));
    await flush();
    expect(e.llamadas.observaciones.length).toBe(2);
    await flush();
    expect(e.llamadas.observaciones.length).toBe(2);
  });

  test('la duracion total es la de la fuente mas lenta, no la suma; cada fuente mide la suya', async () => {
    const e = manual();
    let r = null;
    e.loader.cargar(TOKEN, W, TODOS).then((x) => { r = x; });                    // inicio: t = 1000
    const avanzar = async (t, fn) => { e.reloj.t = t; fn(); await flush(); };
    await avanzar(1050, () => e.llamadas.reemplazo[0].resolve(pozoReemp([evaluacion(1)])));
    await avanzar(1100, () => e.llamadas.correcciones[0].resolve(pozoUbic([correccion(1)])));
    await avanzar(1200, () => e.llamadas.observaciones[0].resolve(pag(lote(1), true, 30)));
    await avanzar(1300, () => e.llamadas.decisiones[0].resolve(pozoDec([decision(1)])));
    await avanzar(1450, () => e.llamadas.observaciones[1].resolve(pag(lote(1), false)));
    expect(r.duracionMs).toBe(450);
    expect(r.fuentes.reemplazo.duracionMs).toBe(50);
    expect(r.fuentes.ubicacion.partes.correcciones.duracionMs).toBe(100);
    expect(r.fuentes.ubicacion.partes.decisiones.duracionMs).toBe(300);
    expect(r.fuentes.ubicacion.duracionMs).toBe(300);
    expect(r.fuentes.observaciones.duracionMs).toBe(450);
    expect(r.duracionMs).toBeLessThan(50 + 100 + 300 + 450);
  });

  test('si todo responde al instante la duracion es 0; un reloj que retrocede nunca da negativos', async () => {
    const e = auto({ correcciones: pozoUbic([]), decisiones: pozoDec([]), reemplazo: pozoReemp([]), observaciones: pag([], false) });
    expect((await e.cargar(TODOS)).duracionMs).toBe(0);
    let t = 5000;
    const reloj = [5000, 4000, 3000, 2000, 1000, 500, 100, 50, 20, 10, 5, 1];
    const loader = M.lineaTiempoPozoLoader_crear({ api: { correcciones: () => Promise.resolve(pozoUbic([])), decisiones: () => Promise.resolve(pozoDec([])), reemplazo: () => Promise.resolve(pozoReemp([])), observaciones: () => Promise.resolve(pag([], false)) }, logica: L, ahora: () => { t = reloj.shift(); return t; } });
    const r = await loader.cargar(TOKEN, W, TODOS);
    expect(r.duracionMs).toBeGreaterThanOrEqual(0);
    expect(r.fuentes.observaciones.duracionMs).toBeGreaterThanOrEqual(0);
  });

  test('las duraciones son enteros (milisegundos redondeados)', async () => {
    const e = manual();
    let r = null;
    e.loader.cargar(TOKEN, W, { reemplazo: true }).then((x) => { r = x; });
    e.reloj.t = 1000.6;
    e.llamadas.reemplazo[0].resolve(pozoReemp([]));
    await flush();
    expect(r.duracionMs).toBe(1);
    expect(Number.isInteger(r.fuentes.reemplazo.duracionMs)).toBe(true);
  });

  test('sin reloj inyectable usa performance.now / Date: la duracion es un numero >= 0', async () => {
    const loader = M.lineaTiempoPozoLoader_crear({ api: { reemplazo: () => Promise.resolve(pozoReemp([])) }, logica: L });
    const r = await loader.cargar(TOKEN, W, { reemplazo: true });
    expect(typeof r.duracionMs).toBe('number');
    expect(r.duracionMs).toBeGreaterThanOrEqual(0);
  });
});

describe('Observaciones: paginacion', () => {
  test('0 observaciones: una pagina vacia -> VACIA', async () => {
    const e = auto({ observaciones: pag([], false) });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'VACIA', cantidadEventos: 0, paginas: 1, cargadas: 0, motivoParcial: null });
    expect(r.completa).toBe(true);
    expect(e.llamadas.observaciones.length).toBe(1);
  });

  test('1 pagina: OK, sin pedir una segunda', async () => {
    const e = auto({ observaciones: pag(lote(3), false) });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', cantidadEventos: 3, paginas: 1, cargadas: 3 });
    expect(e.llamadas.observaciones.length).toBe(1);
    expect(r.completa).toBe(true);
  });

  test('2 paginas: la segunda se pide con antesDeSecuencia = cursor de la primera y limit 100', async () => {
    const e = auto({ observaciones: [pag(lote(100), true, 77), pag(lote(5), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones).toEqual([[TOKEN, W, 100, undefined], [TOKEN, W, 100, 77]]);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', cantidadEventos: 105, paginas: 2, cargadas: 105 });
    expect(r.completa).toBe(true);
  });

  test('5 paginas de 100 con hayMas=false en la ultima (exactamente 500): OK y completa', async () => {
    const e = auto({ observaciones: [pag(lote(100), true, 400), pag(lote(100), true, 300), pag(lote(100), true, 200), pag(lote(100), true, 100), pag(lote(100), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.map((a) => a[3])).toEqual([undefined, 400, 300, 200, 100]);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', paginas: 5, cargadas: 500, cantidadEventos: 500, motivoParcial: null });
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
  });

  test('mas de 500 (hayMas=true en la 5ta): PARCIAL LIMIT_REACHED, conserva lo cargado y NO pide una 6ta pagina', async () => {
    const e = auto({ observaciones: (a, n) => pag(lote(100), true, 1000 - n * 100) });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(5);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'LIMIT_REACHED', paginas: 5, cargadas: 500, cantidadEventos: 500 });
    expect(r.eventos.length).toBe(500);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
  });

  test('el tope de 500 observaciones corta antes de las 5 paginas si las paginas vienen mas grandes', async () => {
    const e = auto({ observaciones: (a, n) => pag(lote(250), true, 900 - n * 250) });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'LIMIT_REACHED', paginas: 2, cargadas: 500 });
  });

  test('exactamente 500 en 2 paginas con hayMas=false: OK (el tope solo importa si todavia hay mas)', async () => {
    const e = auto({ observaciones: [pag(lote(250), true, 600), pag(lote(250), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', cargadas: 500 });
    expect(r.completa).toBe(true);
  });

  test.each([[undefined], [null], [0], [-1], [1.5], ['5'], [NaN], [Infinity], [{}], [true]])('hayMas=true con cursor invalido (%p): PARCIAL CURSOR_INVALIDO, sin pedir mas', async (cursor) => {
    const e = auto({ observaciones: [pag(lote(10), true, cursor), pag(lote(10), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(1);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'CURSOR_INVALIDO', cantidadEventos: 10 });
    expect(r.completa).toBe(false);
  });

  test('cursor repetido (el mismo que ya se pidio): se detiene, PARCIAL CURSOR_REPETIDO, sin bucle infinito', async () => {
    const e = auto({ observaciones: (a, n) => pag(lote(5), true, 50) });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'CURSOR_REPETIDO', paginas: 2, cantidadEventos: 10 });
  });

  test('cursor repetido NO adyacente (50, 40, 50): tambien se detiene', async () => {
    const e = auto({ observaciones: [pag(lote(5), true, 50), pag(lote(5), true, 40), pag(lote(5), true, 50), pag(lote(5), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(3);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'CURSOR_REPETIDO' });
  });

  test('cursor que no avanza hacia atras (mayor que el anterior): se detiene, PARCIAL CURSOR_NO_AVANZA', async () => {
    const e = auto({ observaciones: [pag(lote(5), true, 50), pag(lote(5), true, 60), pag(lote(5), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'CURSOR_NO_AVANZA', cantidadEventos: 10 });
  });

  test('cursores que bajan estrictamente: sigue (no se confunde con los cortes)', async () => {
    const e = auto({ observaciones: [pag(lote(5), true, 50), pag(lote(5), true, 49), pag(lote(5), true, 1), pag(lote(5), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(4);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'OK', cantidadEventos: 20 });
  });

  test('el tope de 5 PAGINAS corta aunque las paginas sean chicas (no se llega a 500)', async () => {
    const e = auto({ observaciones: (a, n) => pag(lote(10), true, 900 - n * 10) });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(5);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'LIMIT_REACHED', paginas: 5, cargadas: 50 });
  });

  test('WELL_NOT_FOUND en la primera pagina de observaciones es un error (solo decisiones lo tolera)', async () => {
    const r = await auto({ observaciones: falla('WELL_NOT_FOUND') }).cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'ERROR', codigoError: 'WELL_NOT_FOUND' });
  });

  test('hayMas=false con un cursor suelto: se ignora el cursor y termina', async () => {
    const e = auto({ observaciones: [pag(lote(5), false, 50), pag(lote(5), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(1);
    expect(r.fuentes.observaciones.estado).toBe('OK');
  });

  test.each([['RED'], [falla('SERVICE_UNAVAILABLE')], [undefined], [null], ['texto'], [{ status: 'ok' }], [{ status: 'ok', data: null }], [ok({ wellId: W, observaciones: 'no', hayMas: false })],
    [ok({ wellId: W, observaciones: [], hayMas: 'true' })], [ok({ wellId: W, observaciones: [] })], [ok({ wellId: OTRO, observaciones: [], hayMas: false })]])('error en la PRIMERA pagina (%p): fuente ERROR, sin eventos', async (respuesta) => {
    const e = auto({ observaciones: respuesta });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones.estado).toBe('ERROR');
    expect(r.fuentes.observaciones.cantidadEventos).toBe(0);
    expect(r.eventos).toEqual([]);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
  });

  test('error en una pagina POSTERIOR (la 2da): PARCIAL ERROR_PAGINA conservando la primera; la 3ra no se pide', async () => {
    const e = auto({ observaciones: [pag(lote(100), true, 90), falla('SERVICE_UNAVAILABLE'), pag(lote(100), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'ERROR_PAGINA', codigoError: 'SERVICE_UNAVAILABLE', cantidadEventos: 100 });
  });

  test('error en la pagina 3 (red): PARCIAL conservando las paginas 1 y 2', async () => {
    const e = auto({ observaciones: [pag(lote(100), true, 90), pag(lote(100), true, 80), 'RED'] });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'ERROR_PAGINA', codigoError: 'RED', cantidadEventos: 200, paginas: 2 });
    expect(r.eventos.length).toBe(200);
  });

  test('pagina posterior mal formada: PARCIAL RESPUESTA_INVALIDA conservando lo cargado', async () => {
    const e = auto({ observaciones: [pag(lote(10), true, 90), ok({ wellId: W, observaciones: null, hayMas: false })] });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'RESPUESTA_INVALIDA', cantidadEventos: 10 });
  });

  test('pagina posterior de OTRO pozo: no se mezcla (PARCIAL RESPUESTA_INVALIDA)', async () => {
    const e = auto({ observaciones: [pag(lote(10), true, 90), ok({ wellId: OTRO, observaciones: [obs(900, { wellId: OTRO })], hayMas: false })] });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'RESPUESTA_INVALIDA', cantidadEventos: 10 });
    expect(r.eventos.every((x) => x.id.indexOf('000000000900') === -1)).toBe(true);
  });

  test('PERMISSION_DENIED en la primera pagina: el backend manda -> SIN_PERMISO (no es un error ni un parcial)', async () => {
    const e = auto({ observaciones: falla('PERMISSION_DENIED') });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones.estado).toBe('SIN_PERMISO');
    expect(r.parcial).toBe(false);
    expect(r.completa).toBe(false);                                  // no quedo ninguna fuente permitida cargada
  });

  test('elementos repetidos entre paginas: se deduplican', async () => {
    const repetidas = lote(3);
    const e = auto({ observaciones: [pag(repetidas.concat(lote(2)), true, 50), pag(repetidas.concat(lote(1)), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(r.fuentes.observaciones.cargadas).toBe(9);
    expect(r.fuentes.observaciones.cantidadEventos).toBe(6);
    expect(new Set(r.eventos.map((x) => x.id)).size).toBe(6);
  });

  test('alta/anulacion concurrente: una ANULADA nunca vuelve a verse ACTIVA, en cualquier orden de paginas y sin su texto', async () => {
    const activa = obs(7, { texto: 'TEXTO-ORIGINAL-QUE-SE-ANULO' });
    const anulada = obsAnulada(7);
    for (const paginas of [[pag([activa], true, 50), pag([anulada], false)], [pag([anulada], true, 50), pag([activa], false)]]) {
      const e = auto({ observaciones: paginas });
      const r = await e.cargar({ observaciones: true });
      const alta = r.eventos.find((x) => x.tipo === 'OBSERVACION_AGREGADA');
      expect(alta).toMatchObject({ estado: 'ANULADA', detalle: null });
      expect(r.eventos.filter((x) => x.tipo === 'OBSERVACION_ANULADA').length).toBe(1);
      expect(JSON.stringify(r)).not.toContain('TEXTO-ORIGINAL-QUE-SE-ANULO');
    }
  });

  test('una anulada que el moderador recibe CON texto no lo deja entrar a la linea de tiempo', async () => {
    const e = auto({ observaciones: pag([obsAnulada(8, { texto: 'LO-QUE-VE-EL-MODERADOR' })], false) });
    const r = await e.cargar({ observaciones: true });
    expect(JSON.stringify(r)).not.toContain('LO-QUE-VE-EL-MODERADOR');
    expect(r.eventos.length).toBe(2);
  });
});

describe('Ubicacion: dos subfuentes independientes', () => {
  const corr = (...n) => pozoUbic(n.map((i) => correccion(i)));
  const dec = (...n) => pozoDec(n.map((i) => decision(i)));
  const cargar = async (guion) => (await auto(guion).cargar({ ubicacion: true }));

  test('correcciones OK + decisiones OK -> OK, con los eventos de las dos y partes OK', async () => {
    const r = await cargar({ correcciones: corr(1, 2), decisiones: dec(1) });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'OK', cantidadEventos: 3, motivoParcial: null });
    expect(r.fuentes.ubicacion.partes.correcciones.estado).toBe('OK');
    expect(r.fuentes.ubicacion.partes.decisiones.estado).toBe('OK');
    expect(r.completa).toBe(true);
  });

  test('una sola parte con eventos y la otra vacia -> OK', async () => {
    expect((await cargar({ correcciones: corr(1), decisiones: dec() })).fuentes.ubicacion.estado).toBe('OK');
    expect((await cargar({ correcciones: corr(), decisiones: dec(1) })).fuentes.ubicacion.estado).toBe('OK');
  });

  test('ambas vacias -> VACIA', async () => {
    const r = await cargar({ correcciones: corr(), decisiones: dec() });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'VACIA', cantidadEventos: 0 });
    expect(r.completa).toBe(true);
  });

  test('WELL_NOT_FOUND en decisiones NO es un fallo: esa subfuente queda VACIA', async () => {
    const vacia = await cargar({ correcciones: corr(), decisiones: falla('WELL_NOT_FOUND') });
    expect(vacia.fuentes.ubicacion).toMatchObject({ estado: 'VACIA', codigoError: null, motivoParcial: null });
    expect(vacia.fuentes.ubicacion.partes.decisiones).toEqual({ estado: 'VACIA', duracionMs: 0, codigoError: null });
    expect(vacia.completa).toBe(true);
    expect(vacia.parcial).toBe(false);
    const conDatos = await cargar({ correcciones: corr(1), decisiones: falla('WELL_NOT_FOUND') });
    expect(conDatos.fuentes.ubicacion.estado).toBe('OK');
    expect(conDatos.completa).toBe(true);
  });

  test('WELL_NOT_FOUND en CORRECCIONES si es un fallo de esa subfuente (solo decisiones lo tolera)', async () => {
    const r = await cargar({ correcciones: falla('WELL_NOT_FOUND'), decisiones: dec(1) });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'SUBFUENTE_CORRECCIONES', codigoError: 'WELL_NOT_FOUND' });
  });

  test('correcciones OK + decisiones ERROR -> PARCIAL SUBFUENTE_DECISIONES, conservando los eventos de correcciones', async () => {
    const r = await cargar({ correcciones: corr(1), decisiones: falla('SERVICE_UNAVAILABLE') });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'SUBFUENTE_DECISIONES', codigoError: 'SERVICE_UNAVAILABLE', cantidadEventos: 1 });
    expect(r.eventos.length).toBe(1);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
  });

  test('decisiones OK + correcciones ERROR (red) -> PARCIAL SUBFUENTE_CORRECCIONES', async () => {
    const r = await cargar({ correcciones: 'RED', decisiones: dec(1, 2) });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'SUBFUENTE_CORRECCIONES', codigoError: 'RED', cantidadEventos: 2 });
  });

  test('correcciones ERROR + decisiones WELL_NOT_FOUND (VACIA) -> PARCIAL: una subfuente fallo', async () => {
    const r = await cargar({ correcciones: 'RED', decisiones: falla('WELL_NOT_FOUND') });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'SUBFUENTE_CORRECCIONES', cantidadEventos: 0 });
  });

  test('ambas ERROR -> ERROR, sin eventos', async () => {
    const r = await cargar({ correcciones: 'RED', decisiones: falla('SERVICE_UNAVAILABLE') });
    expect(r.fuentes.ubicacion).toMatchObject({ estado: 'ERROR', cantidadEventos: 0, motivoParcial: null });
    expect(r.eventos).toEqual([]);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
  });

  test('payload mal formado en una parte: esa parte es ERROR RESPUESTA_INVALIDA y la otra sigue', async () => {
    const r = await cargar({ correcciones: ok({ wellId: W, historial: 'no' }), decisiones: dec(1) });
    expect(r.fuentes.ubicacion.estado).toBe('PARCIAL');
    expect(r.fuentes.ubicacion.partes.correcciones).toMatchObject({ estado: 'ERROR', codigoError: 'RESPUESTA_INVALIDA' });
    expect(r.fuentes.ubicacion.cantidadEventos).toBe(1);
  });

  test('payload de OTRO pozo en una parte: ERROR de esa parte (no se mezclan pozos)', async () => {
    const r = await cargar({ correcciones: ok({ wellId: OTRO, vigente: null, pendientes: [], historial: [correccion(1, { wellId: OTRO })] }), decisiones: dec() });
    expect(r.fuentes.ubicacion.partes.correcciones.estado).toBe('ERROR');
    expect(r.eventos).toEqual([]);
  });

  test('decisiones con log no integro: parte VACIA y el motivo queda como omitido (diagnostico)', async () => {
    const r = await cargar({ correcciones: corr(), decisiones: pozoDec([], { integro: false }) });
    expect(r.fuentes.ubicacion.estado).toBe('VACIA');
    expect(r.fuentes.ubicacion.omitidos).toEqual([{ codigo: 'HISTORIAL_NO_INTEGRO', cantidad: 1 }]);
  });

  test('PERMISSION_DENIED en las dos: la fuente es SIN_PERMISO; en una sola: es un fallo de esa subfuente', async () => {
    const dos = await cargar({ correcciones: falla('PERMISSION_DENIED'), decisiones: falla('PERMISSION_DENIED') });
    expect(dos.fuentes.ubicacion.estado).toBe('SIN_PERMISO');
    expect(dos.parcial).toBe(false);
    const una = await cargar({ correcciones: corr(1), decisiones: falla('PERMISSION_DENIED') });
    expect(una.fuentes.ubicacion.estado).toBe('PARCIAL');
  });

  test('el mismo codigo omitido en las dos partes se suma (no se pisa)', async () => {
    const r = await cargar({ correcciones: pozoUbic([correccion(1, { timestamp: 'mal' }), correccion(2, { timestamp: 'peor' })]), decisiones: pozoDec([decision(1, { timestampUtc: 'nada' })]) });
    expect(r.fuentes.ubicacion.omitidos).toEqual([{ codigo: 'TIMESTAMP_INVALIDO', cantidad: 3 }]);
  });

  test('omitidos de las dos partes se suman en la fuente', async () => {
    const r = await cargar({ correcciones: pozoUbic([correccion(1), correccion(2, { estado: 'INCONSISTENTE' })]), decisiones: pozoDec([decision(1), decision(2, { evento: 'X' })]) });
    expect(r.fuentes.ubicacion.omitidos).toEqual([{ codigo: 'ESTADO_INCONSISTENTE', cantidad: 1 }, { codigo: 'EVENTO_DESCONOCIDO', cantidad: 1 }]);
    expect(r.fuentes.ubicacion.estado).toBe('OK');
  });
});

describe('Reemplazo', () => {
  const cargar = async (guion) => (await auto(guion).cargar({ reemplazo: true }));

  test('con evaluaciones -> OK; sin evaluaciones -> VACIA', async () => {
    const r = await cargar({ reemplazo: pozoReemp([evaluacion(1), evaluacion(2, { estado: 'NO_APTO', motivo: 'SECO' })]) });
    expect(r.fuentes.reemplazo).toMatchObject({ estado: 'OK', cantidadEventos: 2, motivoParcial: null, codigoError: null });
    expect(r.completa).toBe(true);
    const v = await cargar({ reemplazo: pozoReemp([]) });
    expect(v.fuentes.reemplazo).toMatchObject({ estado: 'VACIA', cantidadEventos: 0 });
    expect(v.completa).toBe(true);
  });

  test.each([['RED', 'RED'], [falla('SERVICE_UNAVAILABLE'), 'SERVICE_UNAVAILABLE'], [falla('INVALID_WELL_ID'), 'INVALID_WELL_ID'], ['THROW', 'RED'], [undefined, 'RESPUESTA_INVALIDA'], [{ status: 'raro' }, 'RESPUESTA_INVALIDA'],
    [ok({ wellId: W }), 'RESPUESTA_INVALIDA'], [ok({ wellId: W, evaluaciones: 'x' }), 'RESPUESTA_INVALIDA']])('falla (%p) -> ERROR %s', async (respuesta, codigo) => {
    const r = await cargar({ reemplazo: respuesta });
    expect(r.fuentes.reemplazo).toMatchObject({ estado: 'ERROR', codigoError: codigo, cantidadEventos: 0 });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
  });

  test('WELL_NOT_FOUND en reemplazo es un error (solo decisiones de ubicacion lo tolera)', async () => {
    const r = await cargar({ reemplazo: falla('WELL_NOT_FOUND') });
    expect(r.fuentes.reemplazo).toMatchObject({ estado: 'ERROR', codigoError: 'WELL_NOT_FOUND' });
  });

  test('PERMISSION_DENIED del backend -> SIN_PERMISO', async () => {
    const r = await cargar({ reemplazo: falla('PERMISSION_DENIED') });
    expect(r.fuentes.reemplazo.estado).toBe('SIN_PERMISO');
  });

  test('payload con items validos e invalidos: sigue OK, y los omitidos quedan en el diagnostico', async () => {
    const r = await cargar({ reemplazo: pozoReemp([evaluacion(1), evaluacion(2, { timestamp: 'mal' }), evaluacion(3, { estado: 'SIN_EVALUAR' }), evaluacion(4, { wellId: OTRO })]) });
    expect(r.fuentes.reemplazo).toMatchObject({ estado: 'OK', cantidadEventos: 1 });
    expect(r.fuentes.reemplazo.omitidos).toEqual([{ codigo: 'ESTADO_DESCONOCIDO', cantidad: 1 }, { codigo: 'TIMESTAMP_INVALIDO', cantidad: 1 }, { codigo: 'WELL_ID_DISTINTO', cantidad: 1 }]);
    expect(r.completa).toBe(true);
  });

  test('payload valido pero con TODOS los items omitidos: VACIA (la llamada fue valida) y los omitidos quedan anotados', async () => {
    const r = await cargar({ reemplazo: pozoReemp([evaluacion(1, { timestamp: null }), evaluacion(2, { estado: 'XX' })]) });
    expect(r.fuentes.reemplazo.estado).toBe('VACIA');
    expect(r.fuentes.reemplazo.omitidos.length).toBe(2);
  });

  test('un codigo de error raro se sanea (nunca se copia texto del backend)', async () => {
    const r = await cargar({ reemplazo: { status: 'error', code: '<img src=x onerror=alert(1)>', message: 'detalle tecnico que nunca debe salir' } });
    expect(r.fuentes.reemplazo.codigoError).toBe('ERROR_DESCONOCIDO');
    expect(JSON.stringify(r)).not.toContain('detalle tecnico');
    const nulo = await cargar({ reemplazo: { status: 'error' } });
    expect(nulo.fuentes.reemplazo.codigoError).toBe('ERROR_DESCONOCIDO');
  });
});

describe('estado global: completa / parcial', () => {
  const todoOk = () => ({ correcciones: pozoUbic([correccion(1)]), decisiones: pozoDec([decision(1)]), reemplazo: pozoReemp([evaluacion(1)]), observaciones: pag(lote(2), false) });

  test('todas OK -> completa, no parcial', async () => {
    const r = await auto(todoOk()).cargar();
    expect(estados(r)).toEqual({ u: 'OK', r: 'OK', o: 'OK' });
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
    expect(r.auth).toBeNull();
    expect(r.puedeVer).toBe(true);
    expect(r.eventos.length).toBe(1 + 1 + 1 + 2);
    const ts = r.eventos.map((e) => e.timestamp);
    expect(ts).toEqual(ts.slice().sort().reverse());
  });

  test('mezcla OK y VACIA -> completa', async () => {
    const r = await auto(Object.assign(todoOk(), { reemplazo: pozoReemp([]), observaciones: pag([], false) })).cargar();
    expect(estados(r)).toEqual({ u: 'OK', r: 'VACIA', o: 'VACIA' });
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
  });

  test('una fuente ERROR con las otras utiles -> no completa, parcial, y las demas siguen', async () => {
    const r = await auto(Object.assign(todoOk(), { reemplazo: 'RED' })).cargar();
    expect(estados(r)).toEqual({ u: 'OK', r: 'ERROR', o: 'OK' });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
    expect(r.eventos.length).toBe(4);
  });

  test('una fuente PARCIAL -> no completa, parcial', async () => {
    const r = await auto(Object.assign(todoOk(), { observaciones: [pag(lote(2), true, 9), 'RED'] })).cargar();
    expect(estados(r)).toEqual({ u: 'OK', r: 'OK', o: 'PARCIAL' });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
  });

  test('ERROR + VACIA (sin eventos en ningun lado) sigue siendo parcial: hay una fuente valida', async () => {
    const r = await auto({ reemplazo: 'RED', observaciones: pag([], false) }).cargar({ reemplazo: true, observaciones: true });
    expect(estados(r)).toMatchObject({ r: 'ERROR', o: 'VACIA' });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(true);
  });

  test('todas las fuentes permitidas fallan -> parcial=false y completa=false', async () => {
    const r = await auto({ correcciones: 'RED', decisiones: 'RED', reemplazo: falla('SERVICE_UNAVAILABLE'), observaciones: 'RED' }).cargar();
    expect(estados(r)).toEqual({ u: 'ERROR', r: 'ERROR', o: 'ERROR' });
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
    expect(r.eventos).toEqual([]);
  });

  test('una unica fuente permitida y en ERROR: no parcial; en PARCIAL: parcial', async () => {
    const error = await auto({ observaciones: 'RED' }).cargar({ observaciones: true });
    expect(error.completa).toBe(false);
    expect(error.parcial).toBe(false);
    const parcial = await auto({ observaciones: [pag(lote(2), true, 9), 'RED'] }).cargar({ observaciones: true });
    expect(parcial.completa).toBe(false);
    expect(parcial.parcial).toBe(true);
  });

  test('SIN_PERMISO no impide completa ni cuenta como parcial', async () => {
    const r = await auto({ observaciones: pag(lote(1), false) }).cargar({ observaciones: true });
    expect(r.completa).toBe(true);
    expect(r.parcial).toBe(false);
  });

  test('error de red en una fuente con otras funcionando: la linea de tiempo sigue (cada lectura es independiente)', async () => {
    const r = await auto(Object.assign(todoOk(), { decisiones: 'RED' })).cargar();
    expect(r.fuentes.ubicacion.estado).toBe('PARCIAL');
    expect(r.fuentes.reemplazo.estado).toBe('OK');
    expect(r.fuentes.observaciones.estado).toBe('OK');
    expect(r.eventos.length).toBe(4);                                // correcciones (1) + reemplazo (1) + observaciones (2)
  });

  test('un throw sincrono del wrapper o un wrapper ausente cuentan como error de red de esa fuente, sin romper la carga', async () => {
    const r = await auto(Object.assign(todoOk(), { reemplazo: 'THROW' })).cargar();
    expect(r.fuentes.reemplazo).toMatchObject({ estado: 'ERROR', codigoError: 'RED' });
    const sinApi = M.lineaTiempoPozoLoader_crear({ api: { correcciones: null, decisiones: null, reemplazo: null, observaciones: null }, logica: L, ahora: () => 0 });
    const x = await sinApi.cargar(TOKEN, W, TODOS);
    expect(estados(x)).toEqual({ u: 'ERROR', r: 'ERROR', o: 'ERROR' });
  });

  test('la promesa de cargar nunca se rechaza', async () => {
    const e = auto({ correcciones: 'THROW', decisiones: 'RED', reemplazo: undefined, observaciones: 'THROW' });
    await expect(e.cargar()).resolves.toBeDefined();
  });
});

describe('errores de sesion (auth)', () => {
  test.each([['correcciones'], ['decisiones'], ['reemplazo'], ['observaciones']])('UNAUTHORIZED en %s: senal global, sin eventos, NO es un error de fuente', async (donde) => {
    const guion = { correcciones: pozoUbic([correccion(1)]), decisiones: pozoDec([decision(1)]), reemplazo: pozoReemp([evaluacion(1)]), observaciones: pag(lote(2), false) };
    guion[donde] = falla('UNAUTHORIZED');
    const e = auto(guion);
    const r = await e.cargar();
    expect(r.auth).toBe('UNAUTHORIZED');
    expect(r.eventos).toEqual([]);
    expect(Object.keys(r.fuentes).map((k) => r.fuentes[k].estado)).not.toContain('ERROR');
    expect(Object.keys(r.fuentes).map((k) => r.fuentes[k].estado)).toEqual(['NO_CARGADA', 'NO_CARGADA', 'NO_CARGADA']);
    expect(r.completa).toBe(false);
    expect(r.parcial).toBe(false);
    expect(e.sesion).toEqual(['UNAUTHORIZED']);
  });

  test('USER_DISABLED se propaga como tal, y gana si coexiste con UNAUTHORIZED', async () => {
    const solo = await auto({ reemplazo: falla('USER_DISABLED') }).cargar({ reemplazo: true });
    expect(solo.auth).toBe('USER_DISABLED');
    const e = auto({ correcciones: falla('UNAUTHORIZED'), decisiones: falla('USER_DISABLED'), reemplazo: pozoReemp([]), observaciones: pag([], false) });
    const r = await e.cargar();
    expect(r.auth).toBe('USER_DISABLED');
    expect(e.sesion.length).toBe(1);                                  // el aviso se da una sola vez por carga
  });

  test('auth en la pagina 2 de observaciones: se corta la paginacion y el resultado queda sin eventos', async () => {
    const e = auto({ observaciones: [pag(lote(100), true, 90), falla('UNAUTHORIZED'), pag(lote(100), false)] });
    const r = await e.cargar({ observaciones: true });
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(r.auth).toBe('UNAUTHORIZED');
    expect(r.eventos).toEqual([]);
    expect(r.fuentes.observaciones.estado).toBe('NO_CARGADA');
  });

  test('auth en otra fuente corta la paginacion de observaciones que estaba en curso', async () => {
    const e = manual();
    let r = null;
    e.loader.cargar(TOKEN, W, TODOS).then((x) => { r = x; });
    e.llamadas.correcciones[0].resolve(falla('UNAUTHORIZED'));
    await flush();
    e.llamadas.observaciones[0].resolve(pag(lote(100), true, 90));
    await flush();
    expect(e.llamadas.observaciones.length).toBe(1);                 // no pidio la pagina 2
    e.llamadas.decisiones[0].resolve(pozoDec([]));
    e.llamadas.reemplazo[0].resolve(pozoReemp([]));
    await flush();
    expect(r.auth).toBe('UNAUTHORIZED');
    expect(r.eventos).toEqual([]);
  });

  test('una respuesta que solo SE PARECE a auth (otro codigo) es un error de fuente comun', async () => {
    const r = await auto({ reemplazo: falla('UNAUTHORIZED_X') }).cargar({ reemplazo: true });
    expect(r.auth).toBeNull();
    expect(r.fuentes.reemplazo.estado).toBe('ERROR');
    const r2 = await auto({ reemplazo: { status: 'error', code: 'unauthorized' } }).cargar({ reemplazo: true });
    expect(r2.auth).toBeNull();
  });

  test('una carga desplazada que recibe auth NO dispara el aviso de sesion', async () => {
    const e = manual();
    let primera = null;
    e.loader.cargar(TOKEN, W, { reemplazo: true }).then((r) => { primera = r; });
    e.loader.cargar(TOKEN, OTRO, { reemplazo: true });
    e.llamadas.reemplazo[0].resolve(falla('UNAUTHORIZED'));
    await flush();
    expect(e.sesion).toEqual([]);
    expect(primera.auth).toBe('UNAUTHORIZED');
    expect(e.loader.esVigente(primera)).toBe(false);
  });
});

describe('respuestas viejas', () => {
  test('esVigente: solo el resultado de la ULTIMA carga; cancelar() invalida', async () => {
    const e = auto({ reemplazo: pozoReemp([]) });
    const a = await e.cargar({ reemplazo: true });
    expect(e.loader.esVigente(a)).toBe(true);
    const b = await e.cargar({ reemplazo: true });
    expect(e.loader.esVigente(a)).toBe(false);
    expect(e.loader.esVigente(b)).toBe(true);
    e.loader.cancelar();
    expect(e.loader.esVigente(b)).toBe(false);
    [null, undefined, 'x', 5, {}, { generacion: 'a' }].forEach((x) => expect(e.loader.esVigente(x)).toBe(false));
  });

  test('carga A (pozo X) y despues B (pozo Y): el resultado de A llega tarde y NO es vigente; B si y no se contamina', async () => {
    const e = manual();
    let ra = null;
    let rb = null;
    e.loader.cargar(TOKEN, W, { reemplazo: true }).then((r) => { ra = r; });
    e.loader.cargar(TOKEN, OTRO, { reemplazo: true }).then((r) => { rb = r; });
    e.llamadas.reemplazo[1].resolve(pozoReemp([]) && ok({ wellId: OTRO, evaluaciones: [evaluacion(2, { wellId: OTRO })] }));
    await flush();
    e.llamadas.reemplazo[0].resolve(pozoReemp([evaluacion(1)]));
    await flush();
    expect(ra.wellId).toBe(W);
    expect(rb.wellId).toBe(OTRO);
    expect(e.loader.esVigente(ra)).toBe(false);
    expect(e.loader.esVigente(rb)).toBe(true);
    expect(ra.generacion).not.toBe(rb.generacion);
    expect(rb.eventos.every((x) => x.id.indexOf('0002') !== -1 || x.id.indexOf('000000000002') !== -1)).toBe(true);
    expect(JSON.stringify(rb)).not.toContain('000000000001');
  });

  test('una carga desplazada deja de pedir paginas de observaciones (PARCIAL CANCELADA con lo que ya tenia)', async () => {
    const e = manual();
    let ra = null;
    e.loader.cargar(TOKEN, W, { observaciones: true }).then((r) => { ra = r; });
    e.loader.cargar(TOKEN, OTRO, { reemplazo: true });
    e.llamadas.observaciones[0].resolve(pag(lote(100), true, 90));
    await flush();
    expect(e.llamadas.observaciones.length).toBe(1);                 // no pidio la pagina 2
    expect(ra.fuentes.observaciones).toMatchObject({ estado: 'PARCIAL', motivoParcial: 'CANCELADA', cantidadEventos: 100 });
    expect(e.loader.esVigente(ra)).toBe(false);
  });

  test('cancelar() en medio de la paginacion: se corta y el resultado queda invalido', async () => {
    const e = manual();
    let r = null;
    e.loader.cargar(TOKEN, W, { observaciones: true }).then((x) => { r = x; });
    e.llamadas.observaciones[0].resolve(pag(lote(10), true, 50));
    await flush();
    e.loader.cancelar();
    e.llamadas.observaciones[1].resolve(pag(lote(10), true, 40));
    await flush();
    expect(e.llamadas.observaciones.length).toBe(2);
    expect(e.loader.esVigente(r)).toBe(false);
  });

  test('una carga sin permisos tambien abre generacion nueva (invalida la anterior)', async () => {
    const e = manual();
    let ra = null;
    e.loader.cargar(TOKEN, W, { reemplazo: true }).then((r) => { ra = r; });
    const sin = await e.loader.cargar(TOKEN, W, {});
    e.llamadas.reemplazo[0].resolve(pozoReemp([]));
    await flush();
    expect(e.loader.esVigente(ra)).toBe(false);
    expect(e.loader.esVigente(sin)).toBe(true);
  });
});

describe('privacidad y forma del resultado', () => {
  const SECRETOS = ['secreto@dominio.test', 'req-secreto-123', '987654321', TOKEN, 'TEXTO-OCULTO-ANULADA', 'drive-id-secreto', 'COORD-ORIGINAL-SECRETA', 'detalle tecnico que nunca debe salir'];
  const toxico = () => ({
    correcciones: pozoUbic([correccion(1, { emailPropone: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', sessionToken: TOKEN, coordenadaOriginalTexto: 'COORD-ORIGINAL-SECRETA', secuencia: 987654321 })]),
    decisiones: pozoDec([decision(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', versionVista: 987654321 })], { sessionToken: TOKEN }),
    reemplazo: pozoReemp([evaluacion(1, { email: 'secreto@dominio.test', puntoNEReferencia: 'drive-id-secreto' })]),
    observaciones: [pag([obs(1, { email: 'secreto@dominio.test', clientRequestId: 'req-secreto-123', secuencia: 987654321 }), obsAnulada(2, { texto: 'TEXTO-OCULTO-ANULADA', email: 'secreto@dominio.test' })], true, 987654321, { sessionToken: TOKEN }), falla('SERVICE_UNAVAILABLE')]
  });

  test('ningun secreto aparece en el resultado (emails, clientRequestId, secuencias, sessionToken, texto de anuladas, mensajes tecnicos)', async () => {
    const r = await auto(toxico()).cargar();
    const salida = JSON.stringify(r);
    SECRETOS.forEach((s) => expect(salida).not.toContain(s));
    expect(r.fuentes.observaciones.estado).toBe('PARCIAL');          // la pagina 2 fallo con un mensaje tecnico que tampoco sale
  });

  test('la forma del resultado es la documentada: sin payload crudo ni campos de mas', async () => {
    const r = await auto(toxico()).cargar();
    expect(Object.keys(r).sort()).toEqual(['auth', 'completa', 'duracionMs', 'eventos', 'fuentes', 'generacion', 'parcial', 'puedeVer', 'wellId']);
    expect(Object.keys(r.fuentes)).toEqual(['ubicacion', 'reemplazo', 'observaciones']);
    ['reemplazo', 'observaciones', 'ubicacion'].forEach((k) => {
      const base = ['cantidadEventos', 'codigoError', 'duracionMs', 'estado', 'motivoParcial', 'omitidos'];
      const extra = k === 'ubicacion' ? ['partes'] : (k === 'observaciones' ? ['cargadas', 'paginas'] : []);
      expect(Object.keys(r.fuentes[k]).sort()).toEqual(base.concat(extra).sort());
    });
    expect(Object.keys(r.fuentes.ubicacion.partes)).toEqual(['correcciones', 'decisiones']);
    r.eventos.forEach((e) => expect(L.lineaTiempoPozoLogic_esEventoValido(e)).toBe(true));
  });

  test('el resultado es JSON puro y los casos sin carga tienen la misma forma', async () => {
    const r = await auto(toxico()).cargar();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    const sin = await auto({}).cargar({});
    expect(Object.keys(sin).sort()).toEqual(Object.keys(r).sort());
    expect(Object.keys(sin.fuentes.ubicacion).sort()).toEqual(Object.keys(r.fuentes.ubicacion).sort());
    expect(Object.keys(sin.fuentes.observaciones).sort()).toEqual(Object.keys(r.fuentes.observaciones).sort());
  });

  test('el cargador no muta las respuestas que recibe', async () => {
    const g = toxico();
    const antes = copia(g);
    await auto(g).cargar();
    expect(g).toEqual(antes);
  });

  test('el token se usa solo para pedir: nunca vuelve en el resultado', async () => {
    const r = await auto({ reemplazo: pozoReemp([evaluacion(1)]) }).cargar({ reemplazo: true });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
});

describe('carga estilo navegador (scripts globales, sin deps inyectadas)', () => {
  test('con el modelo y los wrappers de api.js como globales funciona igual que con deps', async () => {
    const ctx = vm.createContext({ Promise, JSON, Math, Object, Array, Number, isFinite, performance: { now: () => 5 } });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoLogic.js'), 'utf8'), ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoLoader.js'), 'utf8'), ctx);
    ctx.apiGetCorreccionesUbicacionPozo = () => Promise.resolve(pozoUbic([correccion(1)]));
    ctx.apiGetDecisionesFuentesPozo = () => Promise.resolve(falla('WELL_NOT_FOUND'));
    ctx.apiGetHistorialReemplazo = () => Promise.resolve(pozoReemp([evaluacion(1)]));
    ctx.apiGetObservacionesPozo = () => Promise.resolve(pag(lote(2), false));
    const r = await vm.runInContext('lineaTiempoPozoLoader_crear().cargar("tok", "14-0006", { ubicacion: true, reemplazo: true, observaciones: true })', ctx);
    expect(r.fuentes.ubicacion.estado).toBe('OK');
    expect(r.completa).toBe(true);
    expect(r.eventos.length).toBe(4);
    expect(r.duracionMs).toBe(0);
  });

  test('sin el modelo cargado falla de forma controlada al crear (no al azar mas adelante)', () => {
    const ctx = vm.createContext({ Promise, JSON, Math, Object, Array, Number, isFinite });
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoLoader.js'), 'utf8'), ctx);
    const loader = vm.runInContext('lineaTiempoPozoLoader_crear({ api: {} })', ctx);
    expect(() => loader.cargar('tok', '14-0006', { reemplazo: true })).toThrow();
  });
});

describe('guardas del codigo fuente', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'lineaTiempoPozoLoader.js'), 'utf8');
  const sinComentarios = fuente.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('sin DOM, almacenamiento, console, analytics ni requires; usa solo el modelo y los wrappers de lectura', () => {
    [/\bdocument\b/, /\bwindow\b/, /localStorage|sessionStorage|indexedDB/, /\bconsole\b/, /\brequire\s*\(/, /\bimport\b/, /\bfetch\s*\(/, /callBackend/, /XMLHttpRequest/, /setTimeout|setInterval/, /\beval\b/, /\bgtag\b|analytics/i, /SpreadsheetApp|Sheet\b/].forEach((re) => {
      expect(sinComentarios).not.toMatch(re);
    });
    expect(sinComentarios).not.toMatch(/\bapi(Login|Subir|Agregar|Anular|Proponer|Validar|Rechazar|Revertir|Decidir|Registrar|Resolver|Sugerir|Cancelar)\w*/);
    expect(sinComentarios).toMatch(/apiGetCorreccionesUbicacionPozo/);
    expect(sinComentarios).toMatch(/apiGetDecisionesFuentesPozo/);
    expect(sinComentarios).toMatch(/apiGetHistorialReemplazo/);
    expect(sinComentarios).toMatch(/apiGetObservacionesPozo/);
    expect(sinComentarios).not.toMatch(/apiGetFotos|apiGetFotoPozo/);
  });

  test('no duplica la logica de eventos: ni tipos, ni titulos, ni nombres de eventos del modelo', () => {
    expect(sinComentarios).not.toMatch(/\b(UBICACION|REEMPLAZO|OBSERVACION|FUENTE)_[A-Z_]+/);
    expect(sinComentarios).not.toMatch(/Ubicación|Observación|Evaluación|'PROPUESTA'|'ANULADA'|'VALIDADA'|'ACEPTADA'/);
    Object.keys(L.LINEA_TIEMPO_TIPOS).forEach((t) => expect(sinComentarios).not.toContain(t));
  });

  test('no usa Date.now / new Date() fuera del reloj por defecto, ni cualquier fecha del dispositivo para ordenar', () => {
    const usos = sinComentarios.match(/new Date\(\)|Date\.now/g) || [];
    expect(usos.length).toBe(1);
    expect(sinComentarios).toMatch(/function lineaTiempoPozoLoader_relojPorDefecto[\s\S]*?new Date\(\)\.getTime\(\)/);
  });

  test('ES5: sin flechas, let/const, plantillas, async/await ni operadores nuevos; sin lookbehind ni invisibles crudos', () => {
    expect(sinComentarios).not.toMatch(/=>|\blet\b|\bconst\b|`|\bclass\b|\basync\b|\bawait\b|\.\.\.|\?\.|\?\?/);
    expect(fuente).not.toMatch(/\(\?<[=!]/);
    const invisibles = fuente.split('').filter((c) => {
      const o = c.charCodeAt(0);
      return (o < 32 && c !== '\n') || (o >= 0x7F && o <= 0x9F) || o === 0x2028 || o === 0x2029 || o === 0xFEFF || (o >= 0x200B && o <= 0x200F) || (o >= 0x202A && o <= 0x202E) || (o >= 0x2060 && o <= 0x2064) || (o >= 0x2066 && o <= 0x2069);
    });
    expect(invisibles).toEqual([]);
  });

  test('los topes son los cerrados: limit 100, 5 paginas, 500 observaciones', () => {
    expect(M.LINEA_TIEMPO_CARGA_LIMITE_PAGINA).toBe(100);
    expect(M.LINEA_TIEMPO_CARGA_MAX_PAGINAS).toBe(5);
    expect(M.LINEA_TIEMPO_CARGA_MAX_OBSERVACIONES).toBe(500);
    expect(M.LINEA_TIEMPO_CARGA_ESTADOS).toEqual({ OK: 'OK', VACIA: 'VACIA', SIN_PERMISO: 'SIN_PERMISO', ERROR: 'ERROR', PARCIAL: 'PARCIAL', NO_CARGADA: 'NO_CARGADA' });
  });

  test('api.js no conoce el cargador y app.js solo cablea la pantalla (nunca nombra al cargador)', () => {
    const raiz = path.join(__dirname, '..');
    expect(fs.readFileSync(path.join(raiz, 'js', 'api.js'), 'utf8')).not.toMatch(/lineaTiempoPozo/);
    expect(fs.readFileSync(path.join(raiz, 'js', 'app.js'), 'utf8')).not.toMatch(/lineaTiempoPozoLoader/);
  });
});

describe('funciones auxiliares exportadas', () => {
  test('clasificar: cada respuesta del backend cae en una sola categoria', () => {
    const c = M.lineaTiempoPozoLoader_clasificar;
    expect(c({ status: 'ok', data: 5 })).toEqual({ tipo: 'OK', data: 5 });
    expect(c({ status: 'error', code: 'UNAUTHORIZED' })).toEqual({ tipo: 'AUTH', code: 'UNAUTHORIZED' });
    expect(c({ status: 'error', code: 'USER_DISABLED' })).toEqual({ tipo: 'AUTH', code: 'USER_DISABLED' });
    expect(c({ status: 'error', code: 'PERMISSION_DENIED' })).toEqual({ tipo: 'SIN_PERMISO' });
    expect(c({ status: 'error', code: 'WELL_NOT_FOUND' })).toEqual({ tipo: 'NO_ENCONTRADO' });
    expect(c({ status: 'error', code: 'SERVICE_UNAVAILABLE' })).toEqual({ tipo: 'ERROR', codigo: 'SERVICE_UNAVAILABLE' });
    expect(c({ status: 'error' })).toEqual({ tipo: 'ERROR', codigo: 'ERROR_DESCONOCIDO' });
    [null, undefined, 'x', 5, [], {}, { status: 5 }, { status: 'raro' }].forEach((x) => expect(c(x)).toEqual({ tipo: 'INVALIDA' }));
  });

  test('cursorValido: entero >= 1', () => {
    const v = M.lineaTiempoPozoLoader_cursorValido;
    [1, 2, 99999].forEach((x) => expect(v(x)).toBe(true));
    [0, -1, 1.5, '5', null, undefined, NaN, Infinity, {}, true].forEach((x) => expect(v(x)).toBe(false));
  });
});
