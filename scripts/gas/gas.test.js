// Integracion del wrapper (scripts/gas/gas.js) contra un repo TEMPORAL con clasp y git simulados: nada toca Google, el repo real ni
// la red. Verifica que el pull va SOLO a .gas-remote/, que src no cambia, la allowlist de solo lectura, diff, huella, adopt y cruces.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { crearCli } = require('./gas');
const L = require('./gasLogic');

const ID_MAIN = '1MainMainMainMainMainMainMain0001';
const ID_STORAGE = '1StorageStorageStorageStorage0002';
const MANIFIESTO = JSON.stringify({ runtimeVersion: 'V8', timeZone: 'America/Argentina/Mendoza', webapp: { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_DEPLOYING' } });

let raiz;
let llamadasClasp;
let salida;
let remotos;          // scriptId -> {nombre: contenido}
let rutasNoIgnoradas;
let versionados;      // null = todo lo del filesystem; array = lista exacta de nombres versionados en src
let gitSucio;
let hookPull;

const hashArchivos = (dir) => crypto.createHash('sha256').update(JSON.stringify(fs.readdirSync(dir).sort().map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')]))).digest('hex');
const escribir = (rel, contenido) => { fs.mkdirSync(path.dirname(path.join(raiz, rel)), { recursive: true }); fs.writeFileSync(path.join(raiz, rel), contenido); };

function repoBase() {
  escribir('backend/src/Api.js', 'function doPost(e) { return 1; }\n');
  escribir('backend/src/Config.js', 'function getX() { return 2; }\n');
  escribir('backend/src/Servicio.js', 'function s() { return 3; }\n');
  escribir('storage/src/StorageApi.js', 'function doPost(e) { return 4; }\n');
  escribir('storage/src/StorageAuth.js', 'function a() { return 5; }\n');
  escribir('backend/.clasp.json', JSON.stringify({ scriptId: ID_MAIN, rootDir: 'src' }));
  escribir('storage/.clasp.json', JSON.stringify({ scriptId: ID_STORAGE, rootDir: 'src' }));
}

// remoto == local por defecto (mismo contenido, manifiesto presente)
function remotosIguales() {
  remotos = {
    [ID_MAIN]: { 'Api.js': 'function doPost(e) { return 1; }\n', 'Config.js': 'function getX() { return 2; }\n', 'Servicio.js': 'function s() { return 3; }\n', 'appsscript.json': MANIFIESTO },
    [ID_STORAGE]: { 'StorageApi.js': 'function doPost(e) { return 4; }\n', 'StorageAuth.js': 'function a() { return 5; }\n', 'appsscript.json': MANIFIESTO }
  };
}

function ejecutarClasp(args, o) {
  llamadasClasp.push({ args: args.slice(), cwd: o.cwd });
  if (args[0] === 'pull') {
    const cfg = JSON.parse(fs.readFileSync(path.join(o.cwd, '.clasp.json'), 'utf8'));
    const archivos = remotos[cfg.scriptId];
    if (!archivos) { return { codigo: 1, stdout: '', stderr: 'Could not find script ' + cfg.scriptId + ' (login required)' }; }
    Object.keys(archivos).forEach((n) => {
      fs.mkdirSync(path.dirname(path.join(o.cwd, n)), { recursive: true });
      fs.writeFileSync(path.join(o.cwd, n), archivos[n]);
    });
    if (hookPull) { hookPull(o); }
    return { codigo: 0, stdout: 'Cloned ' + Object.keys(archivos).length + ' files.', stderr: '' };
  }
  if (args[0] === 'show-file-status') {
    const proy = path.basename(o.cwd);
    const src = path.join(o.cwd, 'src');
    return { codigo: 0, stdout: JSON.stringify(fs.readdirSync(src).map((n) => 'src/' + n)), stderr: proy };
  }
  return { codigo: 0, stdout: '', stderr: '' };
}

function ejecutarGit(args) {
  const ok = (stdout) => ({ codigo: 0, stdout: stdout || '', stderr: '' });
  if (args[0] === 'ls-files' && args[1] === '--' && /\/src$/.test(args[2] || '')) {
    const dir = args[2];
    const reales = fs.existsSync(path.join(raiz, dir)) ? fs.readdirSync(path.join(raiz, dir)) : [];
    const lista = versionados === null ? reales : versionados;
    return ok(lista.map((n) => dir + '/' + n).join('\n'));
  }
  if (args[0] === 'ls-files') { return ok(''); }                                   // sensibles: nada versionado
  if (args[0] === 'check-ignore') { return { codigo: rutasNoIgnoradas.indexOf(args[2]) === -1 ? 0 : 1, stdout: '', stderr: '' }; }
  if (args[0] === 'status') { return ok(gitSucio ? ' M backend/src/Api.js' : ''); }
  if (args[0] === 'rev-parse') { return ok('abc1234'); }
  return ok('');
}

function cli() {
  return crearCli({ raiz: raiz, salida: (t) => salida.push(String(t)), ejecutarClasp: ejecutarClasp, ejecutarGit: ejecutarGit, generarDiff: (a, b) => '@@ diff ' + a + ' -> ' + b, ahora: () => new Date('2026-10-09T12:00:00Z') });
}
const correr = (...argv) => { salida = []; const c = cli().ejecutar(argv); return { codigo: c, texto: salida.join('\n') }; };
const huellaDe = (texto) => /Huella del diff: ([0-9a-f]{64})/.exec(texto)[1];

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-test-'));
  llamadasClasp = [];
  salida = [];
  rutasNoIgnoradas = [];
  versionados = null;
  gitSucio = false;
  hookPull = null;
  repoBase();
  remotosIguales();
});

afterEach(() => { fs.rmSync(raiz, { recursive: true, force: true }); });

describe('pull', () => {
  test('va SOLO a .gas-remote/<proyecto>/, con --user del proyecto; src queda byte a byte igual', () => {
    const antes = hashArchivos(path.join(raiz, 'backend/src'));
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(0);
    expect(llamadasClasp).toHaveLength(1);
    expect(llamadasClasp[0].args).toEqual(['pull', '--user', 'main']);
    expect(llamadasClasp[0].cwd).toBe(path.join(raiz, '.gas-remote', 'main'));
    expect(fs.readdirSync(path.join(raiz, '.gas-remote', 'main')).sort()).toEqual(['.clasp.json', '.gas-meta.json', 'Api.js', 'Config.js', 'Servicio.js', 'appsscript.json']);
    expect(hashArchivos(path.join(raiz, 'backend/src'))).toBe(antes);
    expect(JSON.parse(fs.readFileSync(path.join(raiz, '.gas-remote/main/.clasp.json'), 'utf8'))).toEqual({ scriptId: ID_MAIN });   // sin rootDir: no apunta a src
    expect(r.texto).toMatch(/Remoto: 3 archivo\(s\) de codigo \+ manifiesto presente/);
  });

  test('storage usa su propia cuenta de clasp y su propia carpeta', () => {
    expect(correr('pull', 'storage').codigo).toBe(0);
    expect(llamadasClasp[0].args).toEqual(['pull', '--user', 'storage']);
    expect(llamadasClasp[0].cwd).toBe(path.join(raiz, '.gas-remote', 'storage'));
    expect(fs.existsSync(path.join(raiz, '.gas-remote', 'main'))).toBe(false);
  });

  test('un pull nuevo reemplaza el anterior (no acumula archivos viejos)', () => {
    correr('pull', 'main');
    delete remotos[ID_MAIN]['Servicio.js'];
    correr('pull', 'main');
    expect(fs.existsSync(path.join(raiz, '.gas-remote/main/Servicio.js'))).toBe(false);
  });

  test('si algo modificara src durante el pull, se corta con INCONSISTENCIA GRAVE', () => {
    hookPull = () => fs.writeFileSync(path.join(raiz, 'backend/src/Api.js'), '// pisado por un clasp descontrolado\n');
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/INCONSISTENCIA GRAVE/);
  });

  test('sin .clasp.json: error con instrucciones y clasp ni se invoca', () => {
    fs.rmSync(path.join(raiz, 'backend/.clasp.json'));
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/Falta backend\/\.clasp\.json.*\.example/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('con el scriptId todavia como marcador de posicion, o rootDir distinto de src: se niega', () => {
    escribir('backend/.clasp.json', JSON.stringify({ scriptId: 'PEGAR_AQUI_EL_SCRIPT_ID_DE_dgi-pozos-backend', rootDir: 'src' }));
    expect(correr('pull', 'main').texto).toMatch(/marcador de posicion/);
    escribir('backend/.clasp.json', JSON.stringify({ scriptId: ID_MAIN, rootDir: '.' }));
    expect(correr('pull', 'main').texto).toMatch(/rootDir debe ser exactamente "src"/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('si clasp falla (sin login) el error NO muestra el scriptId y sugiere el login', () => {
    remotos = {};
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/clasp login --user/);
    expect(r.texto).not.toContain(ID_MAIN);
  });

  test('proyecto desconocido', () => {
    const r = correr('pull', 'otro');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/proyecto desconocido/);
  });
});

describe('seguridad de git y credenciales', () => {
  test('si .clasp.json (o .clasprc.json) estuviera versionado, se aborta antes de llamar a clasp', () => {
    const gitConTracked = (args) => (args[0] === 'ls-files' && args[1] === '--' && !/\/src$/.test(args[2] || '') ? { codigo: 0, stdout: 'backend/.clasp.json\n', stderr: '' } : ejecutarGit(args));
    const c = crearCli({ raiz: raiz, salida: (t) => salida.push(t), ejecutarClasp: ejecutarClasp, ejecutarGit: gitConTracked, generarDiff: () => '' });
    expect(c.ejecutar(['pull', 'main'])).toBe(1);
    expect(salida.join('\n')).toMatch(/VERSIONADOS en git/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test.each(['backend/.clasp.json', '.clasprc.json', '.gas-remote/x', '.gas-state/x'])('si %s no esta en .gitignore, se aborta', (ruta) => {
    rutasNoIgnoradas = [ruta];
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toContain(ruta + ' NO esta en .gitignore');
    expect(llamadasClasp).toHaveLength(0);
  });
});

describe('solo lectura: nada que modifique Apps Script', () => {
  test.each(['push', 'version', 'deploy', 'create-version', 'update-deployment', 'redeploy'])('el comando "%s" no existe en esta fase y no invoca clasp', (cmd) => {
    const r = correr(cmd, 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/no habilitado en esta fase/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('a lo largo de pull, diff, status y adopt, clasp solo recibe subcomandos de lectura', () => {
    correr('pull', 'main');
    correr('diff', 'main', '--sin-pull');
    correr('status', 'main');
    const h = huellaDe(correr('diff', 'main').texto);
    correr('adopt', 'main', '--confirmar-huella', h);
    const usados = Array.from(new Set(llamadasClasp.map((c) => c.args[0]))).sort();
    usados.forEach((u) => expect(L.SUBCOMANDOS_PERMITIDOS).toContain(u));
    llamadasClasp.forEach((c) => expect(c.args).not.toEqual(expect.arrayContaining(['--force'])));
  });

  test('si el codigo intentara mandar un comando de escritura a clasp, la allowlist lo corta ANTES de ejecutarlo', () => {
    const espia = jest.fn();
    expect(() => L.verificarComandoClasp(['push', '--user', 'main'])).toThrow(/NO permitido/);
    expect(espia).not.toHaveBeenCalled();
  });
});

describe('status', () => {
  test('el conteo sale del filesystem (agregar un archivo lo cambia sin tocar el codigo) y no consulta el remoto', () => {
    let r = correr('status', 'main');
    expect(r.texto).toMatch(/Archivos de codigo a sincronizar \(derivados del filesystem\): 3 \|/);
    expect(llamadasClasp.every((c) => c.args[0] === 'show-file-status')).toBe(true);
    escribir('backend/src/Nuevo.js', 'function n() {}\n');
    r = correr('status', 'main');
    expect(r.texto).toMatch(/derivados del filesystem\): 4 \|/);
    escribir('storage/src/Otro.js', 'function o() {}\n');
    expect(correr('status', 'storage').texto).toMatch(/derivados del filesystem\): 3 \|/);
  });

  test('discrepancia filesystem vs git: se IDENTIFICA y explica (sin versionar / versionados ausentes)', () => {
    versionados = ['Api.js', 'Config.js', 'Fantasma.js'];
    const r = correr('status', 'main');
    expect(r.texto).toMatch(/versionados en git dentro de backend\/src: 3 \| en el filesystem: 3 \(coinciden\)|DIFIEREN/);
    expect(r.texto).toMatch(/Sin versionar \(en filesystem, no en git\): Servicio\.js/);
    expect(r.texto).toMatch(/Versionados que faltan en el filesystem: Fantasma\.js/);
  });

  test('un archivo no permitido en src (por ejemplo un test) es bloqueante', () => {
    escribir('backend/src/Api.test.js', 'test("x", () => {});\n');
    const r = correr('status', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/BLOQUEANTE: archivos NO permitidos.*Api\.test\.js/);
  });

  test('sin .clasp.json no falla: avisa que hay que crearlo', () => {
    fs.rmSync(path.join(raiz, 'storage/.clasp.json'));
    const r = correr('status', 'storage');
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/AVISO: falta storage\/\.clasp\.json/);
  });

  test('contrasta con lo que clasp subiria y detecta una diferencia', () => {
    expect(correr('status', 'main').texto).toMatch(/clasp subiria exactamente estos 3 archivo\(s\): coincide/);
    const raro = (args, o) => (args[0] === 'show-file-status' ? { codigo: 0, stdout: JSON.stringify(['src/Api.js', 'src/Config.js', 'src/Sobra.js']), stderr: '' } : ejecutarClasp(args, o));
    const c = crearCli({ raiz: raiz, salida: (t) => salida.push(t), ejecutarClasp: raro, ejecutarGit: ejecutarGit, generarDiff: () => '' });
    salida = [];
    c.ejecutar(['status', 'main']);
    expect(salida.join('\n')).toMatch(/ATENCION: lo que clasp subiria NO coincide.*Sobra\.js/);
  });

  test('mismo scriptId en main y storage es bloqueante', () => {
    escribir('storage/.clasp.json', JSON.stringify({ scriptId: ID_MAIN, rootDir: 'src' }));
    const r = correr('status', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/MISMO scriptId/);
  });
});

describe('diff', () => {
  test('remoto == local con manifiesto igual: sin bloqueantes, exit 0', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/Local {2}\(backend\/src\): 3 archivo\(s\) de codigo \| manifiesto presente/);
    expect(r.texto).toMatch(/Remoto \(\.gas-remote\/main\): 3 archivo\(s\) de codigo \| manifiesto presente/);
    expect(r.texto).toMatch(/Identicos: 3 \| Modificados: 0 \| Solo local \(se agregarian\): 0 \| Solo remoto \(un push los BORRARIA\): 0/);
    expect(r.texto).toMatch(/Resultado: sin bloqueantes/);
  });

  test('solo remotos, solo locales, modificados y manifiesto faltante: se listan y bloquean', () => {
    remotos[ID_MAIN]['Vieja.js'] = 'function vieja() {}\n';
    remotos[ID_MAIN]['Config.js'] = 'function getX() { return 99; }\n';
    delete remotos[ID_MAIN]['Servicio.js'];
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/Identicos: 1 \| Modificados: 1 \| Solo local \(se agregarian\): 1 \| Solo remoto \(un push los BORRARIA\): 1/);
    expect(r.texto).toMatch(/Solo remoto \(1\): Vieja\.js/);
    expect(r.texto).toMatch(/Solo local \(1\): Servicio\.js/);
    expect(r.texto).toMatch(/Modificados \(1\): Config\.js/);
    expect(r.texto).toMatch(/--- Config\.js \(- remoto \/ \+ local\)\n@@ diff \.gas-remote\/main\/Config\.js -> backend\/src\/Config\.js/);
    expect(r.texto).toMatch(/BLOQUEANTE: existen 1 archivo\(s\) SOLO en el remoto que un push BORRARIA: Vieja\.js/);
    expect(r.texto).toMatch(/BLOQUEANTE: falta appsscript\.json local/);
    expect(r.texto).toMatch(/Manifiesto appsscript\.json: soloRemoto/);
    expect(r.texto).toMatch(/remoto: runtime=V8 \| timeZone=America\/Argentina\/Mendoza \| webapp=ANYONE_ANONYMOUS\/USER_DEPLOYING/);
  });

  test('un manifiesto local distinto del remoto bloquea', () => {
    escribir('backend/src/appsscript.json', JSON.stringify({ runtimeVersion: 'STABLE' }));
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/BLOQUEANTE: appsscript\.json local difiere del remoto/);
  });

  test('un archivo remoto "X.gs" se reconoce como el local "X.js"', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    remotos[ID_MAIN]['Api.gs'] = remotos[ID_MAIN]['Api.js'];
    delete remotos[ID_MAIN]['Api.js'];
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/Identicos: 3/);
  });

  test('CRLF en el remoto no cuenta como modificacion', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    remotos[ID_MAIN]['Api.js'] = remotos[ID_MAIN]['Api.js'].replace(/\n/g, '\r\n');
    expect(correr('diff', 'main').texto).toMatch(/Modificados: 0/);
  });

  test('huella: 64 hex, igual en corridas repetidas, distinta si cambia el remoto o el local', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    const a = huellaDe(correr('diff', 'main').texto);
    expect(huellaDe(correr('diff', 'main').texto)).toBe(a);
    expect(huellaDe(correr('diff', 'main', '--sin-pull').texto)).toBe(a);
    remotos[ID_MAIN]['Config.js'] = 'function getX() { return 100; }\n';
    const b = huellaDe(correr('diff', 'main').texto);
    expect(b).not.toBe(a);
    escribir('backend/src/Servicio.js', 'function s() { return 33; }\n');
    expect(huellaDe(correr('diff', 'main').texto)).not.toBe(b);
  });

  test('--sin-pull exige un pull previo y no llama a clasp', () => {
    let r = correr('diff', 'main', '--sin-pull');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/no hay pull previo/);
    correr('pull', 'main');
    llamadasClasp = [];
    correr('diff', 'main', '--sin-pull');
    expect(llamadasClasp).toHaveLength(0);
  });

  test('main y storage: diff independientes, cada uno con su cuenta', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    escribir('storage/src/appsscript.json', MANIFIESTO);
    expect(correr('diff', 'main').codigo).toBe(0);
    expect(correr('diff', 'storage').codigo).toBe(0);
    expect(llamadasClasp.map((c) => c.args[2])).toEqual(['main', 'storage']);
  });

  test('advierte si el repo tiene cambios sin commitear en src y si el conteo difiere de git', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    gitSucio = true;
    versionados = ['Api.js'];
    const r = correr('diff', 'main');
    expect(r.texto).toMatch(/ADVERTENCIA: hay \d+ archivo\(s\) en backend\/src que git NO versiona/);
    expect(r.texto).toMatch(/ADVERTENCIA: backend\/src tiene cambios sin commitear/);
  });

  test('un extra en src (p. ej. un test) bloquea el diff', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    escribir('backend/src/Api.test.js', 'x\n');
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/BLOQUEANTE: hay archivos NO permitidos dentro de src.*Api\.test\.js/);
  });
});

describe('proyectos cruzados', () => {
  test('el scriptId de main apunta al proyecto remoto de storage: pull aborta, marca .CRUZADO y src no cambia', () => {
    remotos[ID_MAIN] = remotos[ID_STORAGE];
    const antes = hashArchivos(path.join(raiz, 'backend/src'));
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/PROYECTOS CRUZADOS/);
    expect(fs.existsSync(path.join(raiz, '.gas-remote/main/.CRUZADO'))).toBe(true);
    expect(hashArchivos(path.join(raiz, 'backend/src'))).toBe(antes);
  });

  test('en diff y en adopt tambien se detecta (y adopt no escribe estado)', () => {
    escribir('backend/src/appsscript.json', MANIFIESTO);
    remotos[ID_MAIN] = remotos[ID_STORAGE];
    const d = correr('diff', 'main');
    expect(d.codigo).toBe(2);
    expect(d.texto).toMatch(/BLOQUEANTE: PROYECTOS CRUZADOS/);
    const a = correr('adopt', 'main', '--confirmar-huella', huellaDe(d.texto));
    expect(a.codigo).toBe(2);
    expect(a.texto).toMatch(/PROYECTOS CRUZADOS/);
    expect(fs.existsSync(path.join(raiz, '.gas-state'))).toBe(false);
  });

  test('el mismo scriptId en las dos carpetas aborta el pull', () => {
    escribir('storage/.clasp.json', JSON.stringify({ scriptId: ID_MAIN, rootDir: 'src' }));
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/MISMO scriptId/);
  });

  test('un scriptId equivocado cuyo remoto no se parece a nada del proyecto local tambien se detecta', () => {
    remotos[ID_MAIN] = { 'Otra.js': 'x\n', 'appsscript.json': MANIFIESTO };
    const r = correr('pull', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/ningun archivo/);
  });
});

describe('adopt (registro local; jamas escribe en Apps Script)', () => {
  beforeEach(() => escribir('backend/src/appsscript.json', MANIFIESTO));

  test('exige --confirmar-huella', () => {
    const r = correr('adopt', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/adopt exige --confirmar-huella/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('con una huella que no corresponde, aborta y no escribe nada', () => {
    const r = correr('adopt', 'main', '--confirmar-huella', 'a'.repeat(16));
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/la huella no coincide/);
    expect(fs.existsSync(path.join(raiz, '.gas-state'))).toBe(false);
  });

  test('con la huella del diff: escribe SOLO .gas-state/main.json con los hashes remotos; clasp solo hace pull', () => {
    const h = huellaDe(correr('diff', 'main').texto);
    llamadasClasp = [];
    const srcAntes = hashArchivos(path.join(raiz, 'backend/src'));
    const r = correr('adopt', 'main', '--confirmar-huella', h.slice(0, 16));
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/SOLO localmente.*\.gas-state\/main\.json.*No se escribio nada en Apps Script/);
    expect(llamadasClasp.map((c) => c.args[0])).toEqual(['pull']);
    const e = JSON.parse(fs.readFileSync(path.join(raiz, '.gas-state/main.json'), 'utf8'));
    expect(e).toMatchObject({ version: 1, proyecto: 'main', huella: h, gitHead: 'abc1234', adoptadoEn: '2026-10-09T12:00:00.000Z', descartados: [] });
    expect(Object.keys(e.remoto.archivos)).toEqual(['Api.js', 'Config.js', 'Servicio.js']);
    expect(e.remoto.manifiestoSha).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.readdirSync(path.join(raiz, '.gas-state'))).toEqual(['main.json']);
    expect(hashArchivos(path.join(raiz, 'backend/src'))).toBe(srcAntes);
  });

  test('con archivos solo-remotos: no se adopta sin reconocerlos; con --descartar si (y quedan registrados)', () => {
    remotos[ID_MAIN]['Vieja.js'] = 'function v() {}\n';
    const h = huellaDe(correr('diff', 'main').texto);
    let r = correr('adopt', 'main', '--confirmar-huella', h);
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/sin reconocer.*Vieja\.js/);
    expect(fs.existsSync(path.join(raiz, '.gas-state'))).toBe(false);
    r = correr('adopt', 'main', '--confirmar-huella', h, '--descartar', 'Vieja.js');
    expect(r.codigo).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(raiz, '.gas-state/main.json'), 'utf8')).descartados).toEqual(['Vieja.js']);
  });

  test('sin manifiesto local igual al remoto no se adopta', () => {
    fs.rmSync(path.join(raiz, 'backend/src/appsscript.json'));
    const h = huellaDe(correr('diff', 'main').texto);
    const r = correr('adopt', 'main', '--confirmar-huella', h);
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/debe existir y ser igual al remoto/);
  });

  test('modificados y solo-local no impiden adoptar (un push futuro los reemplazaria/agregaria)', () => {
    escribir('backend/src/Nueva.js', 'function n() {}\n');
    escribir('backend/src/Api.js', 'function doPost(e) { return 111; }\n');
    const h = huellaDe(correr('diff', 'main').texto);
    expect(correr('adopt', 'main', '--confirmar-huella', h).codigo).toBe(0);
  });

  test('despues de adoptar, un cambio en el remoto (editado a mano en el editor web) bloquea el diff como DERIVA', () => {
    const h = huellaDe(correr('diff', 'main').texto);
    correr('adopt', 'main', '--confirmar-huella', h);
    expect(correr('diff', 'main').codigo).toBe(0);
    remotos[ID_MAIN]['Config.js'] = 'function getX() { return "editado a mano"; }\n';
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/BLOQUEANTE: el remoto CAMBIO desde la ultima adopcion.*Config\.js/);
    expect(r.texto).toMatch(/Estado adoptado: el remoto CAMBIO desde la adopcion/);
  });

  test('un estado adoptado corrupto no se ignora en silencio', () => {
    fs.mkdirSync(path.join(raiz, '.gas-state'));
    fs.writeFileSync(path.join(raiz, '.gas-state/main.json'), '{no es json');
    const r = correr('diff', 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/esta corrupto/);
  });

  test('storage se adopta aparte, con su propio archivo de estado', () => {
    escribir('storage/src/appsscript.json', MANIFIESTO);
    const h = huellaDe(correr('diff', 'storage').texto);
    expect(correr('adopt', 'storage', '--confirmar-huella', h).codigo).toBe(0);
    expect(fs.readdirSync(path.join(raiz, '.gas-state'))).toEqual(['storage.json']);
  });
});

describe('uso', () => {
  test('sin argumentos muestra el uso', () => {
    const r = correr();
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/Uso: node scripts\/gas\/gas\.js/);
  });
});
