// Logica pura del wrapper de clasp: sin filesystem, sin red, sin clasp.
const L = require('./gasLogic');

const mapa = (obj) => new Map(Object.entries(obj));
const h = (t) => L.sha256(L.normalizarTexto(t));

describe('normalizacion y hash', () => {
  test('CRLF, CR sueltos y BOM no cambian el hash (lo guarde como lo guarde Windows o el editor web)', () => {
    expect(h('a\r\nb\r\n')).toBe(h('a\nb\n'));
    expect(h('a\rb')).toBe(h('a\nb'));
    expect(h('﻿hola')).toBe(h('hola'));
    expect(h('a\n')).not.toBe(h('a'));
  });

  test('"X.gs" remoto y "X.js" local son el mismo archivo; las rutas con barra se conservan', () => {
    expect(L.nombreNormalizado('Api.gs')).toBe('Api.js');
    expect(L.nombreNormalizado('Api.js')).toBe('Api.js');
    expect(L.nombreNormalizado('sub\\Otro.gs')).toBe('sub/Otro.js');
    expect(L.nombreNormalizado('appsscript.json')).toBe('appsscript.json');
  });
});

describe('clasificarLocal: el inventario sale de los nombres reales, nunca de una constante', () => {
  test('codigo, manifiesto y extras prohibidos (tests, subcarpetas, otras extensiones)', () => {
    const r = L.clasificarLocal(['Api.js', 'Config.js', 'appsscript.json', 'Api.test.js', 'sub/X.js', 'notas.md', 'index.html', 'Con-guion.js']);
    expect(r.codigo).toEqual(['Api.js', 'Config.js']);
    expect(r.manifiesto).toBe(true);
    expect(r.extras).toEqual(['Api.test.js', 'Con-guion.js', 'index.html', 'notas.md', 'sub/X.js']);
  });

  test.each([0, 1, 4, 31, 32, 100])('con %i archivos de codigo reporta exactamente %i (no hay conteos fijos)', (n) => {
    const nombres = Array.from({ length: n }, (_, i) => 'Archivo' + i + '.js');
    expect(L.clasificarLocal(nombres).codigo).toHaveLength(n);
  });
});

describe('compararInventarios', () => {
  test('identicos, modificados, solo local y solo remoto (ordenados)', () => {
    const local = mapa({ 'A.js': 'x', 'B.js': 'y', 'C.js': 'z' });
    const remoto = mapa({ 'A.js': 'x', 'B.js': 'OTRO', 'D.js': 'w', 'E.js': 'v' });
    expect(L.compararInventarios(local, remoto)).toEqual({ identicos: ['A.js'], modificados: ['B.js'], soloLocal: ['C.js'], soloRemoto: ['D.js', 'E.js'] });
  });

  test('vacios', () => {
    expect(L.compararInventarios(new Map(), new Map())).toEqual({ identicos: [], modificados: [], soloLocal: [], soloRemoto: [] });
  });
});

describe('manifiesto', () => {
  const m1 = JSON.stringify({ timeZone: 'America/Argentina/Mendoza', runtimeVersion: 'V8', webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' }, oauthScopes: ['b', 'a'] });

  test('compara el JSON canonico: da igual el formato o el orden de claves', () => {
    const reordenado = '{\r\n  "oauthScopes": ["b","a"],\r\n  "runtimeVersion": "V8",\r\n  "webapp": {"executeAs": "USER_DEPLOYING", "access": "ANYONE_ANONYMOUS"},\r\n  "timeZone": "America/Argentina/Mendoza"\r\n}';
    expect(L.compararManifiestos(m1, reordenado)).toBe('igual');
  });

  test('estados: distinto, soloRemoto, soloLocal, ausentes', () => {
    expect(L.compararManifiestos(m1, m1.replace('V8', 'STABLE'))).toBe('distinto');
    expect(L.compararManifiestos(null, m1)).toBe('soloRemoto');
    expect(L.compararManifiestos(m1, null)).toBe('soloLocal');
    expect(L.compararManifiestos(null, null)).toBe('ausentes');
    expect(L.compararManifiestos('no es json', 'no es json')).toBe('igual');
    expect(L.compararManifiestos('no es json', 'otro')).toBe('distinto');
  });

  test('un cambio de alcances OAuth es una diferencia (puede forzar reautorizar la Web App)', () => {
    expect(L.compararManifiestos(m1, m1.replace('["b","a"]', '["a"]').replace('["b", "a"]', '["a"]'))).toBe('distinto');
  });

  test('resumen: runtime, acceso de la Web App, alcances ordenados, servicios avanzados y librerias', () => {
    const t = JSON.stringify({ runtimeVersion: 'V8', timeZone: 'UTC', webapp: { access: 'MYSELF', executeAs: 'USER_ACCESSING' }, oauthScopes: ['z', 'a'],
      dependencies: { enabledAdvancedServices: [{ userSymbol: 'Drive', serviceId: 'drive' }], libraries: [{ libraryId: 'L1', userSymbol: 'Lib' }] }, exceptionLogging: 'STACKDRIVER' });
    expect(L.resumenManifiesto(t)).toEqual({
      runtimeVersion: 'V8', timeZone: 'UTC', webappAccess: 'MYSELF', webappExecuteAs: 'USER_ACCESSING', oauthScopes: ['a', 'z'],
      serviciosAvanzados: ['drive'], librerias: ['L1'], exceptionLogging: 'STACKDRIVER'
    });
    expect(L.resumenManifiesto(null)).toBeNull();
    expect(L.resumenManifiesto('{{')).toEqual({ invalido: true });
    expect(L.resumenManifiesto('{}')).toMatchObject({ runtimeVersion: null, oauthScopes: null, serviciosAvanzados: [], librerias: [] });
  });
});

describe('huella determinista', () => {
  const local = mapa({ 'A.js': h('a'), 'B.js': h('b') });
  const remoto = mapa({ 'A.js': h('a'), 'B.js': h('OTRO'), 'D.js': h('d') });
  const man = '{"runtimeVersion":"V8"}';

  test('64 hex, independiente del orden de insercion y del formato del manifiesto', () => {
    const a = L.calcularHuella('main', local, remoto, man, man);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const local2 = new Map(Array.from(local.entries()).reverse());
    const remoto2 = new Map(Array.from(remoto.entries()).reverse());
    expect(L.calcularHuella('main', local2, remoto2, '{ "runtimeVersion" : "V8" }\r\n', man)).toBe(a);
  });

  test('cambia si cambia CUALQUIER contenido local, remoto, el manifiesto o el proyecto', () => {
    const base = L.calcularHuella('main', local, remoto, man, man);
    expect(L.calcularHuella('main', mapa({ 'A.js': h('a'), 'B.js': h('b2') }), remoto, man, man)).not.toBe(base);
    expect(L.calcularHuella('main', local, mapa({ 'A.js': h('a2'), 'B.js': h('OTRO'), 'D.js': h('d') }), man, man)).not.toBe(base);
    expect(L.calcularHuella('main', local, remoto, '{"runtimeVersion":"STABLE"}', man)).not.toBe(base);
    expect(L.calcularHuella('main', local, remoto, man, null)).not.toBe(base);
    expect(L.calcularHuella('storage', local, remoto, man, man)).not.toBe(base);
    expect(L.calcularHuella('main', local, new Map(), man, man)).not.toBe(base);
  });

  test('huellaCoincide: prefijo de 12 a 64 hex, sin distinguir mayusculas; nada mas corto ni no-hex', () => {
    const a = L.calcularHuella('main', local, remoto, man, man);
    expect(L.huellaCoincide(a, a.slice(0, 12))).toBe(true);
    expect(L.huellaCoincide(a, a.slice(0, 20).toUpperCase())).toBe(true);
    expect(L.huellaCoincide(a, a)).toBe(true);
    expect(L.huellaCoincide(a, a.slice(0, 11))).toBe(false);
    expect(L.huellaCoincide(a, 'zzzzzzzzzzzzzz')).toBe(false);
    expect(L.huellaCoincide(a, '')).toBe(false);
    expect(L.huellaCoincide(a, undefined)).toBe(false);
    expect(L.huellaCoincide(a, '0'.repeat(12))).toBe(false);
  });
});

describe('detectarCruce (main <-> storage), todo derivado de los inventarios', () => {
  const propios = new Set(['Api.js', 'Config.js']);
  const ajenos = new Set(['StorageApi.js', 'StorageAuth.js']);
  const cruce = (remotos, ids) => L.detectarCruce({ scriptIds: ids || {}, nombresRemotos: new Set(remotos), nombresPropios: propios, nombresAjenos: ajenos });

  test('un remoto que se parece al proyecto propio no se marca', () => {
    expect(cruce(['Api.js', 'Config.js', 'Extra.js'])).toEqual([]);
  });

  test('un remoto con los archivos del OTRO proyecto se marca como cruzado', () => {
    expect(cruce(['StorageApi.js', 'StorageAuth.js'])[0]).toMatch(/OTRO proyecto/);
    expect(cruce(['Api.js', 'StorageApi.js', 'StorageAuth.js'])[0]).toMatch(/cruzado/);   // mas ajenos que propios
  });

  test('un solo archivo ajeno y ninguno propio tambien', () => {
    expect(cruce(['StorageApi.js']).length).toBe(1);
  });

  test('un remoto sin ningun archivo en comun con el local propio: scriptId equivocado', () => {
    expect(cruce(['Otra.js', 'Cosa.js'])[0]).toMatch(/ningun archivo/);
  });

  test('mismo scriptId en las dos carpetas', () => {
    expect(cruce(['Api.js'], { main: 'abc', storage: 'abc' })[0]).toMatch(/MISMO scriptId/);
    expect(cruce(['Api.js'], { main: 'abc', storage: 'def' })).toEqual([]);
    expect(cruce(['Api.js'], { main: null, storage: null })).toEqual([]);
  });

  test('remoto vacio: no es "cruzado" (lo informa evaluar como remoto sin codigo)', () => {
    expect(cruce([])).toEqual([]);
  });
});

describe('deriva del remoto desde la ultima adopcion', () => {
  const adoptado = { remoto: { archivos: { 'A.js': 'h1', 'B.js': 'h2' }, manifiestoSha: L.hashManifiesto('{"a":1}') } };

  test('sin adopcion: null', () => {
    expect(L.evaluarDeriva(null, mapa({}), null)).toBeNull();
  });

  test('sin cambios: no hay deriva', () => {
    expect(L.evaluarDeriva(adoptado, mapa({ 'A.js': 'h1', 'B.js': 'h2' }), '{"a":1}').hayDeriva).toBe(false);
  });

  test('archivos cambiados, nuevos, borrados o manifiesto distinto', () => {
    const r = L.evaluarDeriva(adoptado, mapa({ 'A.js': 'CAMBIO', 'C.js': 'nuevo' }), '{"a":2}');
    expect(r).toMatchObject({ cambiados: ['A.js'], nuevos: ['C.js'], borrados: ['B.js'], manifiesto: true, hayDeriva: true });
  });
});

describe('validarClaspJson', () => {
  const ok = { scriptId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', rootDir: 'src' };

  test('valido', () => {
    expect(L.validarClaspJson(ok)).toEqual({ ok: true, errores: [] });
  });

  test.each([
    ['sin scriptId', { rootDir: 'src' }],
    ['marcador de posicion', { scriptId: 'PEGAR_AQUI_EL_SCRIPT_ID_DE_dgi-pozos-backend', rootDir: 'src' }],
    ['demasiado corto', { scriptId: 'abc', rootDir: 'src' }],
    ['caracteres invalidos', { scriptId: 'espacios no valen en un scriptId real', rootDir: 'src' }],
    ['sin rootDir', { scriptId: ok.scriptId }],
    ['rootDir distinto de src', { scriptId: ok.scriptId, rootDir: '.' }],
    ['rootDir fuera', { scriptId: ok.scriptId, rootDir: '../backend' }]
  ])('invalido: %s', (n, obj) => {
    expect(L.validarClaspJson(obj).ok).toBe(false);
  });

  test('no es objeto', () => {
    expect(L.validarClaspJson(null).ok).toBe(false);
    expect(L.validarClaspJson([]).ok).toBe(false);
    expect(L.validarClaspJson('x').ok).toBe(false);
  });
});

describe('allowlist de comandos de clasp: esta fase es SOLO LECTURA', () => {
  test.each([['pull', '--user', 'main'], ['show-file-status', '--json', '--user', 'main'], ['show-authorized-user', '--user', 'storage']])('permite %s', (...args) => {
    expect(L.verificarComandoClasp(args)).toBe(true);
  });

  test.each(['push', 'create-version', 'create-deployment', 'update-deployment', 'delete-deployment', 'delete-script', 'create-script', 'clone-script',
    'run-function', 'login', 'logout', 'open-script', 'enable-api', 'deploy', 'version', 'redeploy'])('rechaza %s', (cmd) => {
    expect(() => L.verificarComandoClasp([cmd, '--user', 'main'])).toThrow(/NO permitido/);
  });

  test('rechaza flags que fuerzan o borran, y la falta de --user', () => {
    expect(() => L.verificarComandoClasp(['pull', '--force', '--user', 'main'])).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['pull', '--deleteUnusedFiles', '--user', 'main'])).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['pull', '-f', '--user', 'main'])).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['pull'])).toThrow(/--user/);
    expect(() => L.verificarComandoClasp([])).toThrow();
  });

  test('los unicos subcomandos habilitados son los de lectura', () => {
    expect(L.SUBCOMANDOS_PERMITIDOS.slice().sort()).toEqual(['pull', 'show-authorized-user', 'show-file-status']);
  });
});

describe('extraerArchivosDeStatus (formato no documentado: se acepta cualquiera razonable)', () => {
  test('JSON con arreglo de rutas o de objetos', () => {
    expect(L.extraerArchivosDeStatus(JSON.stringify(['src/Api.js', 'src/appsscript.json']))).toEqual(['Api.js', 'appsscript.json']);
    expect(L.extraerArchivosDeStatus(JSON.stringify({ filesToPush: [{ name: 'B.js' }, { name: 'src\\A.js' }], untrackedFiles: [] }))).toEqual(['A.js', 'B.js']);
  });

  test('texto plano: una linea por archivo; sin nada reconocible devuelve vacio', () => {
    expect(L.extraerArchivosDeStatus('Files to push:\nsrc/Api.js\nsrc/Config.js\n')).toEqual(['Api.js', 'Config.js']);
    expect(L.extraerArchivosDeStatus('nada util')).toEqual([]);
  });
});

describe('utilidades', () => {
  test('enmascarar quita el scriptId de cualquier mensaje', () => {
    expect(L.enmascarar('error en 1AbCdEf123 y otra vez 1AbCdEf123', ['1AbCdEf123', null])).toBe('error en <scriptId> y otra vez <scriptId>');
  });

  test('ultimos muestra solo el final del id', () => {
    expect(L.ultimos('1AbCdEfGhIjKlMnOp')).toBe('…KlMnOp');
    expect(L.ultimos(null)).toBe('(sin scriptId)');
  });

  test('parsearArgs: comando, proyecto y opciones (valor, =, booleano)', () => {
    expect(L.parsearArgs(['adopt', 'main', '--confirmar-huella', 'abc', '--descartar=A.js,B.js', '--sin-pull'])).toEqual({
      comando: 'adopt', proyecto: 'main', opciones: { 'confirmar-huella': 'abc', descartar: 'A.js,B.js', 'sin-pull': true }
    });
    expect(L.parsearArgs([])).toEqual({ comando: null, proyecto: null, opciones: {} });
  });

  test('dos proyectos con usuarios de clasp distintos', () => {
    expect(Object.keys(L.PROYECTOS).sort()).toEqual(['main', 'storage']);
    expect(L.PROYECTOS.main.usuario).not.toBe(L.PROYECTOS.storage.usuario);
    expect(L.PROYECTOS.main.carpeta).not.toBe(L.PROYECTOS.storage.carpeta);
  });
});

describe('evaluar y condicionesAdopcion', () => {
  const man = JSON.stringify({ runtimeVersion: 'V8' });
  const base = (extra) => Object.assign({
    proyecto: 'main', scriptIds: {}, nombresAjenos: new Set(['StorageApi.js']), extras: [], estadoAdoptado: null,
    local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: man },
    remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: man }
  }, extra || {});

  test('local == remoto: sin bloqueantes ni advertencias', () => {
    const ev = L.evaluar(base());
    expect(ev.bloqueantes).toEqual([]);
    expect(ev.advertencias).toEqual([]);
    expect(ev.cmp.identicos).toEqual(['Api.js', 'Config.js']);
    expect(L.condicionesAdopcion(ev, [], [])).toEqual([]);
  });

  test('solo remoto bloquea; adoptar exige reconocerlos en --descartar (y que realmente sean solo-remotos)', () => {
    const ev = L.evaluar(base({ remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c'), 'Vieja.js': h('v') }), manifiesto: man } }));
    expect(ev.bloqueantes.join(' ')).toMatch(/SOLO en el remoto.*Vieja\.js/);
    expect(L.condicionesAdopcion(ev, [], []).join(' ')).toMatch(/sin reconocer.*Vieja\.js/);
    expect(L.condicionesAdopcion(ev, [], ['Vieja.js'])).toEqual([]);
    expect(L.condicionesAdopcion(ev, [], ['Vieja.js', 'Api.js']).join(' ')).toMatch(/--descartar incluye archivos que no estan solo en el remoto: Api\.js/);
  });

  test('manifiesto: falta local, distinto o ausente bloquea y no se puede adoptar', () => {
    const faltaLocal = L.evaluar(base({ local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: null } }));
    expect(faltaLocal.manifiesto).toBe('soloRemoto');
    expect(faltaLocal.bloqueantes.join(' ')).toMatch(/falta appsscript\.json local/);
    expect(L.condicionesAdopcion(faltaLocal, [], []).join(' ')).toMatch(/debe existir y ser igual/);
    const distinto = L.evaluar(base({ remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: JSON.stringify({ runtimeVersion: 'STABLE' }) } }));
    expect(distinto.bloqueantes.join(' ')).toMatch(/difiere del remoto/);
    expect(L.evaluar(base({ local: { codigo: mapa({ 'Api.js': h('a') }), manifiesto: null }, remoto: { codigo: mapa({ 'Api.js': h('a') }), manifiesto: null } })).bloqueantes.join(' ')).toMatch(/ni local ni en el pull/);
  });

  test('modificados y solo-local NO bloquean (son lo que un push cambiaria) y se pueden adoptar', () => {
    const ev = L.evaluar(base({ local: { codigo: mapa({ 'Api.js': h('NUEVO'), 'Config.js': h('c'), 'Nueva.js': h('n') }), manifiesto: man } }));
    expect(ev.cmp.modificados).toEqual(['Api.js']);
    expect(ev.cmp.soloLocal).toEqual(['Nueva.js']);
    expect(ev.bloqueantes).toEqual([]);
    expect(L.condicionesAdopcion(ev, [], [])).toEqual([]);
  });

  test('extras en src, cruce y remoto vacio bloquean', () => {
    expect(L.evaluar(base({ extras: ['Api.test.js'] })).bloqueantes.join(' ')).toMatch(/NO permitidos.*Api\.test\.js/);
    const cruzado = L.evaluar(base({ remoto: { codigo: mapa({ 'StorageApi.js': h('s') }), manifiesto: man } }));
    expect(cruzado.bloqueantes.join(' ')).toMatch(/PROYECTOS CRUZADOS/);
    expect(L.condicionesAdopcion(cruzado, [], []).join(' ')).toMatch(/PROYECTOS CRUZADOS/);
    const vacio = L.evaluar(base({ remoto: { codigo: new Map(), manifiesto: man } }));
    expect(vacio.bloqueantes.join(' ')).toMatch(/no tiene archivos de codigo/);
  });

  test('deriva desde la adopcion bloquea el diff', () => {
    const adoptado = { remoto: { archivos: { 'Api.js': h('a'), 'Config.js': h('VIEJO') }, manifiestoSha: L.hashManifiesto(man) } };
    const ev = L.evaluar(base({ estadoAdoptado: adoptado }));
    expect(ev.deriva.cambiados).toEqual(['Config.js']);
    expect(ev.bloqueantes.join(' ')).toMatch(/CAMBIO desde la ultima adopcion.*Config\.js/);
  });

  test('advierte si el remoto no declara runtime V8 (el codigo usa Object.assign)', () => {
    const rhino = L.evaluar(base({ local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: '{}' }, remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: '{}' } }));
    expect(rhino.advertencias.join(' ')).toMatch(/NO declara runtimeVersion V8/);
  });
});
