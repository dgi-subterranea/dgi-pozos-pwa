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

describe('allowlist de comandos de clasp: lectura siempre; escritura solo con permiso explicito', () => {
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

  test('subcomandos de lectura y de escritura (y solo esos)', () => {
    expect(L.SUBCOMANDOS_LECTURA.slice().sort()).toEqual(['list-deployments', 'list-versions', 'pull', 'show-authorized-user', 'show-file-status']);
    expect(L.SUBCOMANDOS_ESCRITURA.slice().sort()).toEqual(['create-version', 'push', 'update-deployment']);
    expect(L.SUBCOMANDOS_PERMITIDOS).toEqual(L.SUBCOMANDOS_LECTURA);
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
      comando: 'adopt', proyecto: 'main', opciones: { 'confirmar-huella': 'abc', descartar: 'A.js,B.js', 'sin-pull': true }, extras: []
    });
    expect(L.parsearArgs([])).toEqual({ comando: null, proyecto: null, opciones: {}, extras: [] });
    expect(L.parsearArgs(['push', 'main', '-f', 'otro']).extras).toEqual(['-f', 'otro']);
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

describe('verificarComandoClasp con escritura: formas EXACTAS', () => {
  const W = { escritura: true };
  const ID = 'AKfycbMainProdDeployment000002';

  test('sin el permiso de escritura, push / create-version / update-deployment se rechazan siempre', () => {
    expect(() => L.verificarComandoClasp(['push', '--user', 'main'])).toThrow(/solo lectura/);
    expect(() => L.verificarComandoClasp(['create-version', 'desc', '--user', 'main'])).toThrow(/solo lectura/);
    expect(() => L.verificarComandoClasp(['update-deployment', ID, '-V', '4', '--user', 'main'])).toThrow(/solo lectura/);
  });

  test('push: solo "push --user <u>" (nada de flags ni argumentos)', () => {
    expect(L.verificarComandoClasp(['push', '--user', 'main'], W)).toBe(true);
    expect(() => L.verificarComandoClasp(['push', '--force', '--user', 'main'], W)).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['push', '-f', '--user', 'main'], W)).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['push', '--watch', '--user', 'main'], W)).toThrow(/prohibido/);
    expect(() => L.verificarComandoClasp(['push', 'extra', '--user', 'main'], W)).toThrow(/forma de comando/);
    expect(() => L.verificarComandoClasp(['push'], W)).toThrow(/--user/);
    expect(() => L.verificarComandoClasp(['push', '--user'], W)).toThrow();
    expect(() => L.verificarComandoClasp(['push', '--user', 'main', 'extra'], W)).toThrow();
  });

  test('create-version: exige una descripcion (1 a 200 caracteres, sin empezar con "-")', () => {
    expect(L.verificarComandoClasp(['create-version', 'Correcciones de ubicacion', '--user', 'main'], W)).toBe(true);
    ['', '   ', '-algo', 'x'.repeat(201)].forEach((d) => expect(() => L.verificarComandoClasp(['create-version', d, '--user', 'main'], W)).toThrow(/descripcion/));
    expect(() => L.verificarComandoClasp(['create-version', '--user', 'main'], W)).toThrow(/forma de comando/);
    expect(() => L.verificarComandoClasp(['create-version', 'a', 'b', '--user', 'main'], W)).toThrow(/forma de comando/);
  });

  test('update-deployment: <deploymentId> -V <n> [-d "desc"]; nunca @HEAD ni sin version', () => {
    expect(L.verificarComandoClasp(['update-deployment', ID, '-V', '4', '--user', 'main'], W)).toBe(true);
    expect(L.verificarComandoClasp(['update-deployment', ID, '-V', '4', '-d', 'Version 4', '--user', 'main'], W)).toBe(true);
    expect(() => L.verificarComandoClasp(['update-deployment', '@HEAD', '-V', '4', '--user', 'main'], W)).toThrow(/<deploymentId>/);
    expect(() => L.verificarComandoClasp(['update-deployment', ID, '--user', 'main'], W)).toThrow(/forma de comando/);
    ['0', 'abc', '-1', '1.5', '1234567'].forEach((v) => expect(() => L.verificarComandoClasp(['update-deployment', ID, '-V', v, '--user', 'main'], W)).toThrow(/forma de comando/));
    expect(() => L.verificarComandoClasp(['update-deployment', ID, '-V', '4', '-d', '', '--user', 'main'], W)).toThrow(/forma de comando/);
    expect(() => L.verificarComandoClasp(['update-deployment', ID, '-V', '4', '--extra', 'x', '--user', 'main'], W)).toThrow(/forma de comando/);
    expect(() => L.verificarComandoClasp(['update-deployment', 'corto', '-V', '4', '--user', 'main'], W)).toThrow(/forma de comando/);
  });

  test.each(['create-deployment', 'delete-deployment', 'delete-script', 'deploy', 'redeploy', 'version', 'run-function', 'create-script', 'clone-script', 'login', 'logout', 'enable-api'])(
    '%s esta prohibido aunque se pida escritura', (cmd) => {
      expect(() => L.verificarComandoClasp([cmd, '--user', 'main'], W)).toThrow(/NO permitido/);
    });

  test('pull admite solo --versionNumber <n>; show-file-status solo --json; list-* sin argumentos', () => {
    expect(L.verificarComandoClasp(['pull', '--versionNumber', '35', '--user', 'main'])).toBe(true);
    expect(() => L.verificarComandoClasp(['pull', '--versionNumber', 'x', '--user', 'main'])).toThrow();
    expect(() => L.verificarComandoClasp(['pull', '--rootDir', 'src', '--user', 'main'])).toThrow(/forma de comando/);
    expect(L.verificarComandoClasp(['show-file-status', '--json', '--user', 'main'])).toBe(true);
    expect(() => L.verificarComandoClasp(['show-file-status', '--otro', '--user', 'main'])).toThrow();
    expect(L.verificarComandoClasp(['list-deployments', '--user', 'storage'])).toBe(true);
    expect(L.verificarComandoClasp(['list-versions', '--user', 'storage'])).toBe(true);
    expect(() => L.verificarComandoClasp(['list-deployments', 'x', '--user', 'storage'])).toThrow();
  });

  test('--user debe ser el ultimo argumento y un nombre en minusculas', () => {
    expect(() => L.verificarComandoClasp(['list-deployments', '--user', 'Main'])).toThrow(/--user/);
    expect(() => L.verificarComandoClasp(['--user', 'main', 'list-deployments'])).toThrow();
  });
});

describe('validarConfigLocal (.gas.local.json)', () => {
  const ok = () => ({ version: 1, main: { pushHabilitado: false, deploymentId: '' }, storage: { pushHabilitado: false, deploymentId: '' } });

  test('la estructura inicial es valida (todo deshabilitado y sin deployment)', () => {
    expect(L.validarConfigLocal(ok())).toEqual({ ok: true, errores: [] });
  });

  test('acepta deployments numerados reales', () => {
    const c = ok();
    c.main = { pushHabilitado: true, deploymentId: 'AKfycbMainProdDeployment000002' };
    c.storage.deploymentId = 'AKfycbStorageProdDeployment0002';
    expect(L.validarConfigLocal(c).ok).toBe(true);
  });

  test.each([
    ['sin seccion main', (c) => { delete c.main; }],
    ['pushHabilitado como texto', (c) => { c.main.pushHabilitado = 'true'; }],
    ['pushHabilitado ausente', (c) => { delete c.storage.pushHabilitado; }],
    ['deploymentId numerico', (c) => { c.main.deploymentId = 123; }],
    ['deploymentId @HEAD', (c) => { c.main.deploymentId = '@HEAD'; }],
    ['deploymentId @head en minusculas', (c) => { c.main.deploymentId = '@head'; }],
    ['deploymentId demasiado corto', (c) => { c.main.deploymentId = 'abc'; }],
    ['deploymentId con marcador de posicion', (c) => { c.storage.deploymentId = 'PEGAR_AQUI_EL_DEPLOYMENT_ID_REAL'; }],
    ['mismo deploymentId en main y storage', (c) => { c.main.deploymentId = c.storage.deploymentId = 'AKfycbMismoDeployment0000001'; }]
  ])('invalida: %s', (n, mutar) => {
    const c = ok();
    mutar(c);
    expect(L.validarConfigLocal(c).ok).toBe(false);
  });

  test('no es un objeto', () => {
    expect(L.validarConfigLocal(null).ok).toBe(false);
    expect(L.validarConfigLocal([]).ok).toBe(false);
  });
});

describe('parsers de la salida de clasp', () => {
  test('list-deployments: HEAD y numerados, ignora el encabezado', () => {
    const r = L.parsearDeployments('Found 2 deployments.\n- AKfycbMainHeadDeployment000001 @HEAD \n- AKfycbMainProdDeployment000002 @35 \n');
    expect(r).toEqual([
      { id: 'AKfycbMainHeadDeployment000001', head: true, version: null, descripcion: '' },
      { id: 'AKfycbMainProdDeployment000002', head: false, version: 35, descripcion: '' }
    ]);
    expect(L.parsearDeployments('Found 0 deployments.')).toEqual([]);
    expect(L.parsearDeployments('- corto @3')).toEqual([]);
  });

  test('list-deployments con descripcion', () => {
    expect(L.parsearDeployments('- AKfycbMainProdDeployment000002 @35 - Produccion')[0]).toMatchObject({ version: 35, descripcion: 'Produccion' });
  });

  test('list-versions y maximaVersion', () => {
    const v = L.parsearVersiones('Found 3 versions.\n1 - No description\n2 - Algo - con guion\n35 - Ultima');
    expect(v).toEqual([{ numero: 1, descripcion: 'No description' }, { numero: 2, descripcion: 'Algo - con guion' }, { numero: 35, descripcion: 'Ultima' }]);
    expect(L.maximaVersion(v)).toBe(35);
    expect(L.maximaVersion([])).toBe(0);
  });

  test('create-version: numero informado', () => {
    expect(L.parsearVersionCreada('Created version 36.')).toBe(36);
    expect(L.parsearVersionCreada('created version 7')).toBe(7);
    expect(L.parsearVersionCreada('otra cosa')).toBeNull();
  });

  test('confirmacion de deploy = vN@ultimos6; no se puede adivinar sin ver el plan', () => {
    expect(L.confirmacionDeploy(36, 'AKfycbMainProdDeployment000002')).toBe('v36@000002');
  });
});

describe('evaluarPush (guardas puras)', () => {
  const man = JSON.stringify({ runtimeVersion: 'V8' });
  const evalBase = (extra) => L.evaluar(Object.assign({
    proyecto: 'main', scriptIds: {}, nombresAjenos: new Set(['StorageApi.js']), extras: [], estadoAdoptado: null,
    local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: man },
    remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: man }
  }, extra || {}));
  const adoptado = (extra) => Object.assign({ remoto: { archivos: { 'Api.js': h('a'), 'Config.js': h('c') }, manifiestoSha: L.hashManifiesto(man) }, descartados: [] }, extra || {});
  const clasp = { reconocido: true, coincide: true, faltan: [], sobran: [] };
  const push = (ev, extra) => L.evaluarPush(Object.assign({ ev: ev, estado: adoptado(), extras: [], cantidadLocal: ev.cmp.identicos.length + ev.cmp.modificados.length + ev.cmp.soloLocal.length, permitirManifest: false, clasp: clasp }, extra || {}));

  test('todo en orden: sin bloqueantes y con el resumen', () => {
    const ev = evalBase({ estadoAdoptado: adoptado(), local: { codigo: mapa({ 'Api.js': h('NUEVO'), 'Config.js': h('c'), 'Nuevo.js': h('n') }), manifiesto: man } });
    const r = push(ev);
    expect(r.bloqueantes).toEqual([]);
    expect(r.agregados).toEqual(['Nuevo.js']);
    expect(r.modificados).toEqual(['Api.js']);
    expect(r.eliminados).toEqual([]);
    expect(r.identicos).toEqual(['Config.js']);
  });

  test('sin adopcion: bloquea', () => {
    expect(push(evalBase(), { estado: null }).bloqueantes.join(' ')).toMatch(/NO esta adoptado/);
  });

  test('deriva remota (cambiado o nuevo) bloquea', () => {
    const cambiado = evalBase({ estadoAdoptado: adoptado(), remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('EDITADO') }), manifiesto: man } });
    expect(push(cambiado).bloqueantes.join(' ')).toMatch(/deriva.*Config\.js/);
    const nuevo = evalBase({ estadoAdoptado: adoptado(), remoto: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c'), 'Intruso.js': h('i') }), manifiesto: man } });
    const r = push(nuevo);
    expect(r.bloqueantes.join(' ')).toMatch(/deriva.*Intruso\.js/);
    expect(r.bloqueantes.join(' ')).toMatch(/NO reconocido.*Intruso\.js/);
  });

  test('solo-remoto: se permite SOLO si esta aprobado en el estado adoptado', () => {
    const remoto = { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c'), 'Vieja.js': h('v') }), manifiesto: man };
    const estadoOk = adoptado({ remoto: { archivos: { 'Api.js': h('a'), 'Config.js': h('c'), 'Vieja.js': h('v') }, manifiestoSha: L.hashManifiesto(man) }, descartados: ['Vieja.js'] });
    const ok = push(evalBase({ estadoAdoptado: estadoOk, remoto: remoto }), { estado: estadoOk });
    expect(ok.bloqueantes).toEqual([]);
    expect(ok.eliminados).toEqual(['Vieja.js']);
    const estadoSin = adoptado({ remoto: estadoOk.remoto, descartados: [] });
    expect(push(evalBase({ estadoAdoptado: estadoSin, remoto: remoto }), { estado: estadoSin }).bloqueantes.join(' ')).toMatch(/NO reconocido.*Vieja\.js/);
    const otro = adoptado({ remoto: estadoOk.remoto, descartados: ['Otra.js'] });
    expect(push(evalBase({ estadoAdoptado: otro, remoto: remoto }), { estado: otro }).bloqueantes.join(' ')).toMatch(/NO reconocido.*Vieja\.js/);
  });

  test('manifiesto distinto bloquea salvo --permitir-manifest; sin manifiesto local bloquea siempre', () => {
    const distinto = evalBase({ estadoAdoptado: adoptado(), local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: JSON.stringify({ runtimeVersion: 'STABLE' }) } });
    expect(push(distinto).bloqueantes.join(' ')).toMatch(/--permitir-manifest/);
    expect(push(distinto, { permitirManifest: true }).bloqueantes).toEqual([]);
    const sinLocal = evalBase({ estadoAdoptado: adoptado(), local: { codigo: mapa({ 'Api.js': h('a'), 'Config.js': h('c') }), manifiesto: null } });
    expect(push(sinLocal, { permitirManifest: true }).bloqueantes.join(' ')).toMatch(/falta appsscript\.json local/);
  });

  test('cruce, extras y local vacio bloquean', () => {
    const cruzado = evalBase({ estadoAdoptado: adoptado(), remoto: { codigo: mapa({ 'StorageApi.js': h('s') }), manifiesto: man } });
    expect(push(cruzado).bloqueantes.join(' ')).toMatch(/PROYECTOS CRUZADOS/);
    expect(push(evalBase({ estadoAdoptado: adoptado() }), { extras: ['Api.test.js'] }).bloqueantes.join(' ')).toMatch(/NO permitidos.*Api\.test\.js/);
    expect(push(evalBase({ estadoAdoptado: adoptado() }), { cantidadLocal: 0 }).bloqueantes.join(' ')).toMatch(/no hay archivos de codigo locales/);
  });

  test('contraste con clasp: no reconocido bloquea; archivos locales sin subir o inesperados bloquean', () => {
    const ev = evalBase({ estadoAdoptado: adoptado() });
    expect(push(ev, { clasp: { reconocido: false, motivo: 'x' } }).bloqueantes.join(' ')).toMatch(/no se pudo verificar/);
    expect(push(ev, { clasp: null }).bloqueantes.join(' ')).toMatch(/no se pudo verificar/);
    const r = push(ev, { clasp: { reconocido: true, coincide: false, faltan: ['Config.js'], sobran: ['Intruso.js'] } });
    expect(r.bloqueantes.join(' ')).toMatch(/NO se subirian: Config\.js.*SI se subirian: Intruso\.js/);
  });
});

describe('verificarPostPush', () => {
  const man = JSON.stringify({ runtimeVersion: 'V8' });
  const ev = (local, remoto, ml, mr) => L.evaluar({ proyecto: 'main', scriptIds: {}, nombresAjenos: new Set(), extras: [], estadoAdoptado: null,
    local: { codigo: mapa(local), manifiesto: ml === undefined ? man : ml }, remoto: { codigo: mapa(remoto), manifiesto: mr === undefined ? man : mr } });

  test('remoto == local: ok', () => {
    expect(L.verificarPostPush(ev({ 'A.js': h('a') }, { 'A.js': h('a') }))).toEqual({ ok: true, problemas: [] });
  });

  test.each([
    ['archivo sin subir', { 'A.js': h('a'), 'B.js': h('b') }, { 'A.js': h('a') }, /sin subir: B\.js/],
    ['archivo remoto de mas', { 'A.js': h('a') }, { 'A.js': h('a'), 'C.js': h('c') }, /no estan en el repo: C\.js/],
    ['contenido distinto', { 'A.js': h('a') }, { 'A.js': h('otro') }, /no coincide con el local: A\.js/]
  ])('detecta: %s', (n, local, remoto, patron) => {
    const r = L.verificarPostPush(ev(local, remoto));
    expect(r.ok).toBe(false);
    expect(r.problemas.join(' ')).toMatch(patron);
  });

  test('manifiesto distinto o remoto vacio', () => {
    expect(L.verificarPostPush(ev({ 'A.js': h('a') }, { 'A.js': h('a') }, man, '{}')).problemas.join(' ')).toMatch(/appsscript\.json no coincide/);
    expect(L.verificarPostPush(ev({ 'A.js': h('a') }, {})).ok).toBe(false);
  });
});

describe('evaluarDeploy (guardas puras)', () => {
  const dep = (id, version) => ({ id: id, head: version === null, version: version, descripcion: '' });
  const MAIN = 'AKfycbMainProdDeployment000002';
  const HEAD = 'AKfycbMainHeadDeployment000001';
  const base = (extra) => Object.assign({
    despliegues: [dep(HEAD, null), dep(MAIN, 35)], versiones: [{ numero: 34 }, { numero: 35 }, { numero: 36 }], deploymentId: MAIN, otroDeploymentId: '', version: 36, permitirRetroceso: false
  }, extra || {});

  test('deploy valido: version actual y destino', () => {
    expect(L.evaluarDeploy(base())).toEqual({ errores: [], actual: 35, destino: 36, head: false, encontrado: true });
  });

  test('deploymentId que no figura en el proyecto (pertenece a otro): bloquea', () => {
    expect(L.evaluarDeploy(base({ deploymentId: 'AKfycbStorageProdDeployment0002' })).errores.join(' ')).toMatch(/NO figura entre los deployments de este proyecto/);
  });

  test('@HEAD no es destino productivo', () => {
    const r = L.evaluarDeploy(base({ deploymentId: HEAD }));
    expect(r.head).toBe(true);
    expect(r.errores.join(' ')).toMatch(/@HEAD.*no es un destino productivo/);
  });

  test('version inexistente', () => {
    expect(L.evaluarDeploy(base({ version: 99 })).errores.join(' ')).toMatch(/version 99 NO existe/);
  });

  test('misma version: nada que hacer; retroceso exige --permitir-retroceso', () => {
    expect(L.evaluarDeploy(base({ version: 35 })).errores.join(' ')).toMatch(/ya esta en la version 35/);
    expect(L.evaluarDeploy(base({ version: 34 })).errores.join(' ')).toMatch(/RETROCESO/);
    expect(L.evaluarDeploy(base({ version: 34, permitirRetroceso: true })).errores).toEqual([]);
  });

  test('el mismo deploymentId configurado en los dos proyectos', () => {
    expect(L.evaluarDeploy(base({ otroDeploymentId: MAIN })).errores.join(' ')).toMatch(/main y en storage/);
  });
});

describe('destino de escritura (cwd + scriptId)', () => {
  const path = require('path');
  const RAIZ = path.resolve('/repo-falso');
  const ESPERADO = path.join(RAIZ, 'backend');
  const ID = '1MainMainMainMainMainMainMain0001';
  const OTRO = '1StorageStorageStorageStorage0002';
  const base = (o) => Object.assign({ raiz: RAIZ, cwd: ESPERADO, esperado: ESPERADO, claspJson: { scriptId: ID, rootDir: 'src' }, scriptIdEsperado: ID, scriptIdOtro: OTRO }, o);

  test('cwd exacto + scriptId esperado: sin errores', () => {
    expect(L.validarDestinoEscritura(base())).toEqual([]);
  });

  test('desde .gas-remote/*: rechazado y explicado (puede ser un HEAD viejo)', () => {
    const e = L.validarDestinoEscritura(base({ cwd: path.join(RAIZ, '.gas-remote', 'main') }));
    expect(e.join(' ')).toMatch(/se ejecutaria desde ".gas-remote\/main".*\.gas-remote.*HEAD viejo.*solo se permite desde "backend"/);
    expect(L.validarDestinoEscritura(base({ cwd: path.join(RAIZ, '.gas-remote', 'main-v36') })).length).toBeGreaterThan(0);
  });

  test('desde cualquier otra carpeta (raiz, storage, src, un padre) tambien', () => {
    [RAIZ, path.join(RAIZ, 'storage'), path.join(ESPERADO, 'src'), path.dirname(RAIZ), path.join(ESPERADO, '..', 'storage')].forEach((c) => {
      expect(L.validarDestinoEscritura(base({ cwd: c })).length).toBeGreaterThan(0);
    });
  });

  test('cwd relativo, vacio o ausente: rechazado (no se resuelve contra el cwd del proceso)', () => {
    ['.', 'backend', '', undefined, null].forEach((c) => {
      expect(L.validarDestinoEscritura(base({ cwd: c })).join(' ')).toMatch(/no es una ruta absoluta/);
    });
  });

  test('con "..": se normaliza, y solo vale si cae exactamente en la carpeta del proyecto', () => {
    expect(L.validarDestinoEscritura(base({ cwd: path.join(ESPERADO, 'src', '..') }))).toEqual([]);
    expect(L.validarDestinoEscritura(base({ cwd: path.join(ESPERADO, '..', '.gas-remote', 'main') })).length).toBeGreaterThan(0);
  });

  test('scriptId distinto del esperado: rechazado (enmascarado, sin imprimirlo)', () => {
    const e = L.validarDestinoEscritura(base({ claspJson: { scriptId: '1OtroOtroOtroOtroOtroOtroOtro0003', rootDir: 'src' } })).join(' ');
    expect(e).toMatch(/scriptId de \.clasp\.json \(…ro0003\) NO es el esperado \(…in0001\)/);
    expect(e).not.toContain('1OtroOtroOtroOtroOtroOtroOtro0003');
    expect(e).not.toContain(ID);
  });

  test('scriptId del OTRO proyecto: rechazado', () => {
    const e = L.validarDestinoEscritura(base({ claspJson: { scriptId: OTRO, rootDir: 'src' } })).join(' ');
    expect(e).toMatch(/OTRO proyecto/);
  });

  test('.clasp.json ausente / ilegible / con rootDir distinto de src / con scriptId de marcador: rechazado', () => {
    expect(L.validarDestinoEscritura(base({ claspJson: null })).join(' ')).toMatch(/no se pudo leer el \.clasp\.json/);
    expect(L.validarDestinoEscritura(base({ claspJson: { scriptId: ID, rootDir: '.' } })).join(' ')).toMatch(/rootDir/);
    expect(L.validarDestinoEscritura(base({ claspJson: { scriptId: 'PEGAR_SCRIPT_ID_AQUI_XXXXXXXXX', rootDir: 'src' } })).length).toBeGreaterThan(0);
  });
});

describe('HEAD remoto: firma, evaluacion y deteccion de revert', () => {
  const codigo = (o) => new Map(Object.entries(o));
  const MANIF = JSON.stringify({ runtimeVersion: 'V8' });

  test('firmaRemoto: depende del contenido y del manifiesto, no del orden ni de CRLF en el manifiesto', () => {
    const a = L.firmaRemoto(codigo({ 'A.js': 'h1', 'B.js': 'h2' }), MANIF);
    expect(L.firmaRemoto(codigo({ 'B.js': 'h2', 'A.js': 'h1' }), MANIF)).toBe(a);
    expect(L.firmaRemoto(codigo({ 'A.js': 'h1', 'B.js': 'hX' }), MANIF)).not.toBe(a);
    expect(L.firmaRemoto(codigo({ 'A.js': 'h1' }), MANIF)).not.toBe(a);
    expect(L.firmaRemoto(codigo({ 'A.js': 'h1', 'B.js': 'h2' }), JSON.stringify({ runtimeVersion: 'STABLE' }))).not.toBe(a);
    expect(L.firmaRemoto(codigo({ 'A.js': 'h1', 'B.js': 'h2' }), '{\r\n  "runtimeVersion": "V8"\r\n}')).toBe(a);
  });

  const evaluarCon = (local, remoto, extra) => L.evaluar(Object.assign({
    proyecto: 'main', local: { codigo: codigo(local), manifiesto: MANIF }, remoto: { codigo: codigo(remoto), manifiesto: MANIF }, extras: [], scriptIds: {}, nombresAjenos: new Set(), estadoAdoptado: null
  }, extra));

  test('evaluarHead: idem repo => ok; archivo de mas, faltante, distinto, cruce y extras => problemas', () => {
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1' }, { 'A.js': '1' }), []).ok).toBe(true);
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1' }, { 'A.js': '1', 'Codigo.js': '9' }), []).problemas.join(' ')).toMatch(/Codigo\.js/);
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1', 'U.js': '2' }, { 'A.js': '1' }), []).problemas.join(' ')).toMatch(/sin subir: U\.js/);
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1' }, { 'A.js': '2' }), []).problemas.join(' ')).toMatch(/no coincide con el local: A\.js/);
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1' }, { 'A.js': '1' }), ['x.txt']).problemas.join(' ')).toMatch(/no permitidos en src: x\.txt/);
    expect(L.evaluarHead(evaluarCon({ 'A.js': '1' }, { 'A.js': '1' }, { scriptIds: { main: 'idrepetidoidrepetidoidrepetido', storage: 'idrepetidoidrepetidoidrepetido' } }), []).ok).toBe(false);
  });

  // estado tras un push: adoptado == remoto NUEVO; ultimoPush recuerda el remoto/huella PREVIOS
  const PREVIO = { 'A.js': 'viejo', 'Codigo.js': 'dup' };
  const NUEVO = { 'A.js': 'nuevo', 'U.js': 'u' };
  const estadoTrasPush = () => ({
    huella: 'h-post-push', remoto: { archivos: NUEVO, manifiestoSha: L.hashManifiesto(MANIF) },
    ultimoPush: { en: '2026-10-12T03:48:57.258Z', huellaPrevia: 'H-PRE-PUSH', remotoPrevio: L.firmaRemoto(codigo(PREVIO), MANIF) }
  });

  test('revertido por huella: la huella actual es la previa al ultimo push', () => {
    expect(L.detectarRevertido({ estado: estadoTrasPush(), huella: 'h-pre-push', firma: 'otra' })).toEqual({ revertido: true, por: 'huella' });
  });

  test('revertido por contenido, aunque el repo haya cambiado (la huella ya no sirve)', () => {
    expect(L.detectarRevertido({ estado: estadoTrasPush(), huella: 'huella-distinta', firma: L.firmaRemoto(codigo(PREVIO), MANIF) })).toEqual({ revertido: true, por: 'contenido' });
  });

  test('sin falsos positivos: el remoto actual es lo adoptado, o es otro estado cualquiera, o no hubo push', () => {
    const e = estadoTrasPush();
    expect(L.detectarRevertido({ estado: e, huella: 'h-post-push', firma: L.firmaRemoto(codigo(NUEVO), MANIF) }).revertido).toBe(false);
    expect(L.detectarRevertido({ estado: e, huella: 'otra', firma: 'otra' }).revertido).toBe(false);
    expect(L.detectarRevertido({ estado: null, huella: 'h-pre-push', firma: 'x' }).revertido).toBe(false);
    expect(L.detectarRevertido({ estado: { huella: 'x', remoto: { archivos: {} } }, huella: 'h-pre-push', firma: 'x' }).revertido).toBe(false);
  });

  test('un push que no cambio nada (remoto previo == adoptado) nunca se marca como revertido', () => {
    const e = estadoTrasPush();
    e.ultimoPush.remotoPrevio = L.firmaRemoto(codigo(NUEVO), MANIF);
    e.ultimoPush.huellaPrevia = e.huella;
    expect(L.detectarRevertido({ estado: e, huella: e.huella, firma: L.firmaRemoto(codigo(NUEVO), MANIF) }).revertido).toBe(false);
  });

  test('resumenOperaciones: fechas de ultimo push / version / deploy, con la marca de HEAD inconsistente', () => {
    expect(L.resumenOperaciones(null)).toBe('');
    expect(L.resumenOperaciones({ adoptadoEn: 'x' })).toBe('');
    const r = L.resumenOperaciones({
      ultimoPush: { en: '2026-10-12T03:48:57.258Z' }, ultimaVersion: { numero: 36, en: '2026-10-12T04:09:06.054Z' },
      ultimoDeploy: { version: 36, en: '2026-10-12T04:27:32.162Z', headConsistente: false }
    });
    expect(r).toBe('ultimo push: 2026-10-12T03:48:57.258Z | ultima version: 36 (2026-10-12T04:09:06.054Z) | ultimo deploy: v36 (2026-10-12T04:27:32.162Z, HEAD inconsistente)');
  });
});
