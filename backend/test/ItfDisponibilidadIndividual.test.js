// Regresion del cold start de getItfAvailability (E10-1, incidente v49): con el indice de disponibilidad inexistente o vencido, la busqueda de UN pozo reconstruia el indice GLOBAL recorriendo la
// carpeta THUMB entera de Drive (~128 s medidos). Contrato nuevo:
//   - 1 pozo (un solo wellId distinto) -> lookup directo por nombre en Drive: sin indice y sin recorrer la carpeta (funciona con el cache vacio, inexistente o vencido).
//   - lote (2 o mas pozos distintos)   -> indice; su reconstruccion la hace UN solo reconstructor: el ScriptLock se toma SOLO para reclamarla (milisegundos, revalidando el indice) y se suelta ANTES
//     del recorrido pesado; los demas esperan al indice y NO recorren la carpeta.
// Se prueba para LOS DOS indices (el de E9, 'itf_leg_v2_', y el de siempre, 'itf_idx_'), mas una guarda ARQUITECTONICA (grafo de llamadas) en lugar de un umbral de tiempo.
const fs = require('fs');
const path = require('path');
const { crearEntorno, depsDe } = require('./itfEntorno');
const { crearCacheConTtl } = require('./e10Entorno');

let E;
const archivo = (id, name) => ({ id: id, name: name, bytes: [-1, -40, -1, 1, 2, 3] });
const entorno = (archivos, props) => { E = crearEntorno({ archivos: archivos, props: props || {} }); E.drive.estado.caseInsensitive = true; return E; };
const cache = () => CacheService.getScriptCache();
const hayIndice = () => cache().get('itf_leg_v2_14') !== null || cache().get('itf_idx_14') !== null;

// los dos indices, con la misma interfaz
const VARIANTES = [
  { nombre: 'E9 (itfLegacy_disponibilidad)', prefijo: 'itf_leg_v2_', bandera: 'itf_leg_v2_rebuilding', bucket: '{"u":["0001"],"a":[],"n":[]}', consultar: (ids) => E.mods.legacy.itfLegacy_disponibilidad(ids), si: 'UNICO', no: 'NO' },
  { nombre: 'E9 apagado (itfAvailabilityService_checkDisponibilidad)', prefijo: 'itf_idx_', bandera: 'itf_idx_rebuilding', bucket: '["0001"]', consultar: (ids) => E.mods.disp.itfAvailabilityService_checkDisponibilidad(ids), si: true, no: false }
];
const indiceCompleto = (v) => { for (let d = 1; d <= 19; d += 1) { cache().put(v.prefijo + String(d).padStart(2, '0'), v.bucket, 3600); } };
const LOTE = ['14-0001', '14-0002'];

describe.each(VARIANTES)('CRITICO: consulta de UN pozo con el indice global inexistente o vencido - $nombre', (v) => {
  test('A. pozo con ITF existente: disponible, SIN recorrer la carpeta THUMB ni reconstruir el indice', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0002.jpg')]);
    expect(hayIndice()).toBe(false);
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.si });
    expect(E.drive.calls.getFiles).toBe(0);
    expect(hayIndice()).toBe(false);
    expect(E.drive.calls.getFilesByName + E.drive.calls.searchFiles).toBeGreaterThan(0);
  });

  test('A. la extension en otra capitalizacion (.JPG) tambien es un ITF disponible (misma politica que el indice)', () => {
    entorno([archivo('a', '14-0001.JPG')]);
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.si });
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('B. pozo sin ITF: no disponible, sin recorrer la carpeta', () => {
    entorno([archivo('a', '14-0002.jpg')]);
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.no });
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('B. departamento fuera de 01..19: no disponible sin tocar Drive (igual que el indice)', () => {
    entorno([archivo('a', '25-0001.jpg')]);
    expect(v.consultar(['25-0001'])).toEqual({ '25-0001': v.no });
    expect(E.drive.calls.getFiles + E.drive.calls.getFilesByName + E.drive.calls.searchFiles).toBe(0);
  });

  test('C. con el indice global vacio o con la reconstruccion IMPOSIBLE, la consulta individual funciona igual (es independiente del indice)', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    global.driveProfileRepository_listarArchivosThumb = () => { throw new Error('el recorrido de THUMB no debe ocurrir'); };
    cache().put(v.bandera, '1', 300);                                        // y aunque OTRA ejecucion este reconstruyendo
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.si });
    expect(Utilities.sleep).not.toHaveBeenCalled();                          // no espera a nadie
    expect(E.lock.waitLock).not.toHaveBeenCalled();                          // ni toca el lock
  });

  test('C. un indice VENCIDO u obsoleto no se consulta: la respuesta refleja Drive', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    for (let d = 1; d <= 19; d += 1) { cache().put(v.prefijo + String(d).padStart(2, '0'), v.prefijo === 'itf_leg_v2_' ? '{"u":[],"a":[],"n":[]}' : '[]', 3600); }   // indice viejo que dice "ninguno"
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.si });
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('C. Drive caido en la consulta individual: LANZA (nunca se inventa un "No")', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    E.drive.estado.fallar = 'Drive no responde';
    expect(() => v.consultar(['14-0001'])).toThrow(/Drive/);
  });

  test('un wellId repetido es UN pozo: tambien es lookup directo', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    expect(v.consultar(['14-0001', '14-0001'])).toEqual({ '14-0001': v.si });
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('D. lote (2 o mas pozos distintos): conserva el indice, UNA sola pasada por la carpeta; la segunda consulta sale del cache', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(1);
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(1);
    expect(cache().get(v.bandera)).toBeNull();
  });

  test('PARIDAD: para cada pozo, el resultado individual (directo) es IGUAL al del lote (indice)', () => {
    const carpeta = [archivo('a', '14-0001.jpg'), archivo('b', '14-0002.JPG'), archivo('c', '14-0003.jpg'), archivo('d', '14-0004.jpg'), archivo('e', '14-0004.JPG'), archivo('f', '01-0100.jpg')];
    const ids = ['14-0001', '14-0002', '14-0003', '14-0004', '14-0005', '01-0100', '01-0101', '25-0001'];
    entorno(carpeta);
    const lote = v.consultar(ids);
    ids.forEach((id) => {
      entorno(carpeta);
      expect(v.consultar([id])).toEqual({ [id]: lote[id] });
    });
  });
});

describe.each(VARIANTES)('E/F/G. reconstruccion con UN solo reconstructor - $nombre', (v) => {
  test('E. dos reconstrucciones concurrentes: SOLO una recorre la carpeta; la otra espera y falla con un error reintentable (no recorre)', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const original = global.driveProfileRepository_listarArchivosThumb;
    let recorridos = 0;
    let errorDeB = null;
    global.driveProfileRepository_listarArchivosThumb = () => {
      recorridos += 1;
      // mientras A recorre (la bandera esta puesta y el lock YA esta suelto), llega B
      try { v.consultar(LOTE); } catch (err) { errorDeB = err; }
      return original();
    };
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });   // A
    global.driveProfileRepository_listarArchivosThumb = original;
    expect(recorridos).toBe(1);
    expect(errorDeB).not.toBeNull();
    expect(String(errorDeB.message)).toMatch(/ITF_INDEX_RECONSTRUYENDO/);
    expect(Utilities.sleep).toHaveBeenCalledTimes(E.mods.indice.ITF_INDICE_ESPERA_MAX);
    expect(cache().get(v.bandera)).toBeNull();
  });

  test('E. B que espera y ve aparecer el indice (A termino) responde SIN recorrer', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    cache().put(v.bandera, '1', 300);                                              // A reconstruye
    Utilities.sleep.mockImplementationOnce(() => { indiceCompleto(v); cache().remove(v.bandera); });   // A termina mientras B espera
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('F. segundo proceso: despues de tomar el lock REVALIDA el cache y evita la reconstruccion duplicada', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    // B ve el indice vacio, se pone a esperar el lock y, mientras espera, A termina y escribe el indice
    E.lock.waitLock.mockImplementationOnce(() => { indiceCompleto(v); });
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(0);                                         // no recorrio
    expect(cache().get(v.bandera)).toBeNull();                                      // ni siquiera puso la bandera
    expect(E.lock.releaseLock).toHaveBeenCalledTimes(E.lock.waitLock.mock.calls.length);
  });

  test('G. excepcion durante la reconstruccion: el lock NO queda tomado, la bandera se quita y un reintento reconstruye', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    let tomado = 0;
    E.lock.waitLock.mockImplementation(() => { tomado += 1; });
    E.lock.releaseLock.mockImplementation(() => { tomado -= 1; });
    E.drive.estado.fallar = 'Drive caido';
    expect(() => v.consultar(LOTE)).toThrow(/Drive caido/);
    expect(tomado).toBe(0);
    expect(cache().get(v.bandera)).toBeNull();
    E.drive.estado.fallar = null;
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(tomado).toBe(0);
  });

  test('G. el lock tampoco queda tomado si el cache lanza DENTRO del reclamo', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    let tomado = 0;
    E.lock.waitLock.mockImplementation(() => { tomado += 1; });
    E.lock.releaseLock.mockImplementation(() => { tomado -= 1; });
    const c = cache();
    const get = c.get;
    c.get = (k) => { if (k === v.bandera) { throw new Error('cache caido'); } return get.call(c, k); };
    expect(() => v.consultar(LOTE)).toThrow(/cache caido/);
    c.get = get;
    expect(tomado).toBe(0);
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('si no se puede tomar el lock NUNCA se reconstruye por las dudas: se sondea y, agotado el maximo, se falla', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    E.lock.waitLock.mockImplementation(() => { throw new Error('Lock timeout'); });
    expect(() => v.consultar(LOTE)).toThrow(/ITF_INDEX_RECONSTRUYENDO/);
    expect(E.drive.calls.getFiles).toBe(0);
    expect(E.lock.releaseLock).not.toHaveBeenCalled();                              // nunca lo tuvo
  });

  test('la bandera cubre una reconstruccion lenta (TTL > 160 s) y el recorrido pesado ocurre con el lock SUELTO', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const put = jest.spyOn(cache(), 'put');
    let tomado = 0;
    let durante = null;
    E.lock.waitLock.mockImplementation(() => { tomado += 1; });
    E.lock.releaseLock.mockImplementation(() => { tomado -= 1; });
    const original = global.driveProfileRepository_listarArchivosThumb;
    global.driveProfileRepository_listarArchivosThumb = () => { durante = tomado; return original(); };
    v.consultar(LOTE);
    global.driveProfileRepository_listarArchivosThumb = original;
    expect(durante).toBe(0);
    expect(put.mock.calls.find((c) => c[0] === v.bandera)[2]).toBeGreaterThan(160);
    put.mockRestore();
  });
});

describe.each(VARIANTES)('CRASH del reconstructor: la bandera vence sola, nunca hay un estado bloqueado permanente - $nombre', (v) => {
  // cache con reloj: Utilities.sleep avanza 1 s por llamada (como un sondeo real)
  const conReloj = () => {
    const reloj = crearCacheConTtl();
    global.CacheService = { getScriptCache: () => reloj };
    Utilities.sleep.mockImplementation(() => reloj.avanzar(1));
    return reloj;
  };

  test('un proceso reclama la bandera y MUERE sin reconstruir: mientras la bandera vive NADIE reconstruye; al vencer, otra ejecucion reconstruye', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const reloj = conReloj();
    // A reclama (PROPIO) y muere: no hay finally que valga cuando Apps Script mata la ejecucion
    const ttl = E.mods.indice.ITF_INDICE_BANDERA_SEGUNDOS;
    reloj.put(v.bandera, '1', ttl);
    // B (lote) llega con la bandera viva: espera todo el maximo de sondeos y falla, SIN recorrer la carpeta
    expect(() => v.consultar(LOTE)).toThrow(/ITF_INDEX_RECONSTRUYENDO/);
    expect(E.drive.calls.getFiles).toBe(0);
    expect(reloj.get(v.bandera)).toBe('1');                                        // sigue viva: B no la piso
    // pasa el TTL de la bandera: vence sola
    reloj.avanzar(ttl);
    expect(reloj.get(v.bandera)).toBeNull();
    // C reconstruye y deja todo sano
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(1);
    expect(reloj.get(v.bandera)).toBeNull();
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });      // y la siguiente sale del cache
    expect(E.drive.calls.getFiles).toBe(1);
  });

  test('el reconstructor murio habiendo escrito SOLO una parte del indice: el indice sigue incompleto, la bandera vence y otra ejecucion lo reconstruye entero', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const reloj = conReloj();
    for (let d = 1; d <= 5; d += 1) { reloj.put(v.prefijo + String(d).padStart(2, '0'), v.bucket, 3600); }
    reloj.put(v.bandera, '1', E.mods.indice.ITF_INDICE_BANDERA_SEGUNDOS);
    expect(() => v.consultar(LOTE)).toThrow(/ITF_INDEX_RECONSTRUYENDO/);
    reloj.avanzar(E.mods.indice.ITF_INDICE_BANDERA_SEGUNDOS);
    expect(v.consultar(LOTE)).toEqual({ '14-0001': v.si, '14-0002': v.no });
    expect(E.drive.calls.getFiles).toBe(1);
  });

  test('el lock no queda tomado por el crash: se libera siempre antes de la reconstruccion, asi que no hay lock huerfano', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const reloj = conReloj();
    let tomado = 0;
    E.lock.waitLock.mockImplementation(() => { tomado += 1; });
    E.lock.releaseLock.mockImplementation(() => { tomado -= 1; });
    reloj.put(v.bandera, '1', E.mods.indice.ITF_INDICE_BANDERA_SEGUNDOS);
    expect(() => v.consultar(LOTE)).toThrow();
    expect(tomado).toBe(0);
  });

  test('la consulta individual NO se afecta por una bandera huerfana: sigue siendo lookup directo', () => {
    entorno([archivo('a', '14-0001.jpg')]);
    const reloj = conReloj();
    reloj.put(v.bandera, '1', E.mods.indice.ITF_INDICE_BANDERA_SEGUNDOS);
    expect(v.consultar(['14-0001'])).toEqual({ '14-0001': v.si });
    expect(Utilities.sleep).not.toHaveBeenCalled();
  });
});

describe('H. compatibilidad con E9 y contrato publico (el frontend no cambia)', () => {
  test('E9 encendido: itfService_disponibilidad de 1 pozo: UNICO -> true, NO -> false, AMBIGUO -> se OMITE (no se sabe), sin recorrer la carpeta', () => {
    entorno([archivo('a', '14-0001.jpg'), archivo('b', '14-0003.jpg'), archivo('c', '14-0003.JPG')], { ITF_E9_ACTIVO: 'SI' });
    const s = E.mods.servicio;
    expect(s.itfService_disponibilidad(['14-0001'], depsDe(E))).toEqual({ '14-0001': true });
    expect(s.itfService_disponibilidad(['14-0002'], depsDe(E))).toEqual({ '14-0002': false });
    expect(s.itfService_disponibilidad(['14-0003'], depsDe(E))).toEqual({});
    expect(E.drive.calls.getFiles).toBe(0);
  });

  test('E9 encendido: el lote da lo MISMO que cada pozo por separado', () => {
    const carpeta = [archivo('a', '14-0001.jpg'), archivo('b', '14-0003.jpg'), archivo('c', '14-0003.JPG')];
    const ids = ['14-0001', '14-0002', '14-0003'];
    entorno(carpeta, { ITF_E9_ACTIVO: 'SI' });
    const lote = E.mods.servicio.itfService_disponibilidad(ids, depsDe(E));
    ids.forEach((id) => {
      entorno(carpeta, { ITF_E9_ACTIVO: 'SI' });
      const individual = E.mods.servicio.itfService_disponibilidad([id], depsDe(E));
      expect(individual).toEqual(lote[id] === undefined ? {} : { [id]: lote[id] });
    });
  });

  describe.each([[true], [false]])('handler getItfAvailability con E9 %s: mismo status, code y estructura', (e9) => {
    test('1 pozo y lote devuelven {status:"ok", data:{wellId: boolean}} sin campos nuevos', () => {
      entorno([archivo('a', '14-0001.jpg')], e9 ? { ITF_E9_ACTIVO: 'SI' } : {});
      const Api = require('../src/Api');
      global.verifySessionToken.mockReturnValue({ valid: true, email: 'u@x.com' });
      global.isUserActive.mockReturnValue(true);
      global.hasPermission.mockImplementation((email, modulo) => modulo === 'perfil');
      global.getUserAccess.mockReturnValue({ active: true, permisos: { perfil: true }, nombre: 'U' });
      global.itfService_e9Activo = () => e9;
      global.itfService_disponibilidad = (ids) => E.mods.servicio.itfService_disponibilidad(ids, depsDe(E));
      global.profileService_checkDisponibilidad = (ids) => E.mods.disp.itfAvailabilityService_checkDisponibilidad(ids);
      expect(Api.handleGetItfAvailability('t', ['14-0001'])).toEqual({ status: 'ok', data: { '14-0001': true } });
      expect(Api.handleGetItfAvailability('t', ['14-0002'])).toEqual({ status: 'ok', data: { '14-0002': false } });
      expect(Api.handleGetItfAvailability('t', ['14-0001', '14-0002'])).toEqual({ status: 'ok', data: { '14-0001': true, '14-0002': false } });
    });
  });
});

describe('GUARDA ARQUITECTONICA: la consulta individual no puede llegar al recorrido de THUMB (grafo de llamadas del codigo real)', () => {
  const dir = path.join(__dirname, '..', 'src');
  const cuerpos = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => {
    // sin comentarios ni literales de texto: solo codigo
    const t = fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""').replace(/if \(typeof module[\s\S]*$/, '');
    const re = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    const inicios = [];
    let m;
    while ((m = re.exec(t))) { inicios.push({ nombre: m[1], desde: m.index }); }
    inicios.forEach((x, i) => { cuerpos[x.nombre] = t.slice(x.desde, i + 1 < inicios.length ? inicios[i + 1].desde : t.length); });
  });
  // funciones del codigo real que `nombre` LLAMA o REFERENCIA (tambien como valor: `reconstruir: itfLegacy_reconstruirIndice`)
  const memo = {};
  const referenciasDe = (nombre) => memo[nombre] || (memo[nombre] = Object.keys(cuerpos).filter((otro) => otro !== nombre && new RegExp('(?<![A-Za-z0-9_$.])' + otro + '(?![A-Za-z0-9_$])').test(cuerpos[nombre])));
  const alcanzables = (raices) => {
    const vistos = new Set(raices);
    const pila = raices.slice();
    while (pila.length) { referenciasDe(pila.pop()).forEach((n) => { if (!vistos.has(n)) { vistos.add(n); pila.push(n); } }); }
    return vistos;
  };
  const PROHIBIDAS = ['driveProfileRepository_listarArchivosThumb', 'itfLegacy_reconstruirIndice', 'itfLegacy_asegurarIndice', 'itfAvailabilityService_reconstruirIndice', 'itfAvailabilityService_asegurarIndice', 'itfIndice_asegurar', 'itfIndice_reclamar'];

  test('el grafo se arma bien (las funciones existen y se ven entre si)', () => {
    ['itfLegacy_disponibilidadDirecta', 'itfAvailabilityService_disponibilidadDirecta', 'driveProfileRepository_listarArchivosThumb', 'itfLegacy_buscar'].forEach((n) => expect(cuerpos[n]).toBeDefined());
    expect(referenciasDe('itfLegacy_disponibilidadDirecta')).toContain('itfLegacy_buscar');
    expect(alcanzables(['itfLegacy_reconstruirIndice']).has('driveProfileRepository_listarArchivosThumb')).toBe(true);
  });

  test.each([['itfLegacy_disponibilidadDirecta'], ['itfAvailabilityService_disponibilidadDirecta']])('%s: ninguna funcion alcanzable desde ella recorre THUMB, usa el indice ni lo reconstruye', (raiz) => {
    const alc = alcanzables([raiz]);
    PROHIBIDAS.forEach((n) => expect(alc.has(n)).toBe(false));
    expect(alc.has('driveProfileRepository_buscarCandidatosLegacy') || alc.has('itfLegacy_buscar')).toBe(true);
  });

  test('el recorrido de THUMB solo se alcanza desde las DOS reconstrucciones del indice y estas solo desde itfIndice_asegurar (el camino de lote)', () => {
    const quienReferencia = (objetivo) => Object.keys(cuerpos).filter((n) => referenciasDe(n).indexOf(objetivo) >= 0).sort();
    expect(quienReferencia('driveProfileRepository_listarArchivosThumb')).toEqual(['itfAvailabilityService_reconstruirIndice', 'itfLegacy_reconstruirIndice']);
    expect(quienReferencia('itfLegacy_reconstruirIndice')).toEqual(['itfLegacy_asegurarIndice']);                       // se pasa como valor (reconstruir:), nunca se llama directo
    expect(quienReferencia('itfAvailabilityService_reconstruirIndice')).toEqual(['itfAvailabilityService_asegurarIndice']);
    expect(quienReferencia('itfIndice_asegurar')).toEqual(['itfAvailabilityService_asegurarIndice', 'itfLegacy_asegurarIndice']);
  });

  test.each([['itfLegacy_disponibilidad', 'itfLegacy_disponibilidadDirecta', 'itfLegacy_asegurarIndice'], ['itfAvailabilityService_checkDisponibilidad', 'itfAvailabilityService_disponibilidadDirecta', 'itfAvailabilityService_asegurarIndice']])('%s: el despacho 1 pozo -> directo ocurre ANTES de cualquier acceso al indice', (despacho, directa, asegurar) => {
    const c = cuerpos[despacho];
    expect(c.indexOf(directa + '(')).toBeGreaterThan(-1);
    expect(c.indexOf(directa + '(')).toBeLessThan(c.indexOf(asegurar + '('));
    expect(c).toMatch(/distintos\.length === 1/);
    expect(c.indexOf('distintos.length === 1')).toBeLessThan(c.indexOf(asegurar + '('));
  });

  test('el lock se toma SOLO en el reclamo: el recorrido (reconstruir) no esta dentro de la funcion que toma el lock', () => {
    expect(cuerpos.itfIndice_reclamar).toMatch(/getScriptLock/);
    expect(cuerpos.itfIndice_reclamar).toMatch(/releaseLock/);
    expect(cuerpos.itfIndice_reclamar).not.toMatch(/reconstruir\s*\(/);
    expect(cuerpos.itfIndice_asegurar).not.toMatch(/getScriptLock|waitLock/);
    expect(cuerpos.itfIndice_reclamar).toMatch(/finally/);
    expect(cuerpos.itfIndice_asegurar).toMatch(/finally/);
  });
});
