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
let remotos;               // scriptId -> {nombre: contenido}   (HEAD remoto)
let versiones;             // scriptId -> [snapshot de remotos]  (version N = indice N-1)
let despliegues;           // scriptId -> [{id, version|null}]   (null = @HEAD)
let rutasNoIgnoradas;
let versionados;           // null = todo lo del filesystem; array = lista exacta de nombres versionados en src
let gitTracked;            // lineas de "git status --porcelain --untracked-files=no"
let gitUntrackedProyecto;  // lineas "?? ..." dentro de la carpeta del proyecto
let hookPull;
let hookPush;
let fallaPush;
let fallaUpdate;
let updateNoCambia;
let statusOverride;

const DEP_MAIN_HEAD = 'AKfycbMainHeadDeployment000001';
const DEP_MAIN = 'AKfycbMainProdDeployment000002';
const DEP_ST_HEAD = 'AKfycbStorageHeadDeployment001';
const DEP_ST = 'AKfycbStorageProdDeployment0002';

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

// remoto == local por defecto (mismo contenido, manifiesto presente) y deployments/versiones de partida
function remotosIguales() {
  remotos = {
    [ID_MAIN]: { 'Api.js': 'function doPost(e) { return 1; }\n', 'Config.js': 'function getX() { return 2; }\n', 'Servicio.js': 'function s() { return 3; }\n', 'appsscript.json': MANIFIESTO },
    [ID_STORAGE]: { 'StorageApi.js': 'function doPost(e) { return 4; }\n', 'StorageAuth.js': 'function a() { return 5; }\n', 'appsscript.json': MANIFIESTO }
  };
  versiones = {
    [ID_MAIN]: [1, 2, 3].map(() => Object.assign({}, remotos[ID_MAIN])),
    [ID_STORAGE]: [1, 2].map(() => Object.assign({}, remotos[ID_STORAGE]))
  };
  despliegues = {
    [ID_MAIN]: [{ id: DEP_MAIN_HEAD, version: null }, { id: DEP_MAIN, version: 3 }],
    [ID_STORAGE]: [{ id: DEP_ST_HEAD, version: null }, { id: DEP_ST, version: 2 }]
  };
}

const scriptIdDe = (cwd) => JSON.parse(fs.readFileSync(path.join(cwd, '.clasp.json'), 'utf8')).scriptId;

function ejecutarClasp(args, o) {
  llamadasClasp.push({ args: args.slice(), cwd: o.cwd });
  const cmd = args[0];
  const ok = (stdout) => ({ codigo: 0, stdout: stdout || '', stderr: '' });
  if (cmd === 'pull') {
    const id = scriptIdDe(o.cwd);
    const iv = args.indexOf('--versionNumber');
    const archivos = iv === -1 ? remotos[id] : (versiones[id] || [])[parseInt(args[iv + 1], 10) - 1];
    if (!archivos) { return { codigo: 1, stdout: '', stderr: 'Could not find script ' + id + ' (login required)' }; }
    Object.keys(archivos).forEach((n) => {
      fs.mkdirSync(path.dirname(path.join(o.cwd, n)), { recursive: true });
      fs.writeFileSync(path.join(o.cwd, n), archivos[n]);
    });
    if (hookPull && iv === -1) { hookPull(o); }
    return ok('Cloned ' + Object.keys(archivos).length + ' files.');
  }
  if (cmd === 'show-file-status') {
    if (statusOverride) { return statusOverride; }
    const src = path.join(o.cwd, 'src');
    return ok(JSON.stringify(fs.readdirSync(src).map((n) => 'src/' + n)));
  }
  if (cmd === 'list-deployments') {
    const lista = despliegues[scriptIdDe(o.cwd)];
    return ok('Found ' + lista.length + ' deployments.\n' + lista.map((d) => '- ' + d.id + ' ' + (d.version === null ? '@HEAD' : '@' + d.version) + ' ').join('\n'));
  }
  if (cmd === 'list-versions') {
    const lista = versiones[scriptIdDe(o.cwd)];
    return ok('Found ' + lista.length + ' versions.\n' + lista.map((v, k) => (k + 1) + ' - No description').join('\n'));
  }
  if (cmd === 'push') {
    if (fallaPush) { return { codigo: 1, stdout: '', stderr: 'Push failed: ' + scriptIdDe(o.cwd) }; }
    const id = scriptIdDe(o.cwd);
    const src = path.join(o.cwd, 'src');
    const nuevos = {};
    fs.readdirSync(src).forEach((n) => { nuevos[n] = fs.readFileSync(path.join(src, n), 'utf8'); });
    remotos[id] = nuevos;                       // el push REEMPLAZA todo el contenido remoto (lo que no esta en src se pierde)
    if (hookPush) { hookPush(id); }
    return ok('Pushed ' + Object.keys(nuevos).length + ' files.');
  }
  if (cmd === 'create-version') {
    const id = scriptIdDe(o.cwd);
    versiones[id].push(Object.assign({}, remotos[id]));
    return ok('Created version ' + versiones[id].length + '.');
  }
  if (cmd === 'update-deployment') {
    if (fallaUpdate) { return { codigo: 1, stdout: '', stderr: 'update failed' }; }
    const d = despliegues[scriptIdDe(o.cwd)].find((x) => x.id === args[1]);
    if (!d) { return { codigo: 1, stdout: '', stderr: 'Deployment not found' }; }
    if (!updateNoCambia) { d.version = parseInt(args[3], 10); }
    return ok('Updated deployment.');
  }
  return ok('');
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
  if (args[0] === 'status') {
    if (args.indexOf('--untracked-files=no') !== -1) { return ok(gitTracked.join('\n')); }
    const dir = args[args.length - 1];
    return ok(gitTracked.concat(gitUntrackedProyecto).filter((l) => l.indexOf(dir) !== -1).join('\n'));
  }
  if (args[0] === 'rev-parse') { return ok('abc1234'); }
  return ok('');
}

function cli() {
  return crearCli({ raiz: raiz, salida: (t) => salida.push(String(t)), ejecutarClasp: ejecutarClasp, ejecutarGit: ejecutarGit, generarDiff: (a, b) => '@@ diff ' + a + ' -> ' + b, ahora: () => new Date('2026-10-09T12:00:00Z') });
}
const correr = (...argv) => { salida = []; const c = cli().ejecutar(argv); return { codigo: c, texto: salida.join('\n') }; };
const huellaDe = (texto) => /Huella del diff: ([0-9a-f]{64})/.exec(texto)[1];

function configurar(c) {
  const base = { version: 1, main: { pushHabilitado: false, deploymentId: '' }, storage: { pushHabilitado: false, deploymentId: '' } };
  escribir('.gas.local.json', JSON.stringify(Object.assign(base, c), null, 2));
}
const estadoDe = (nombre) => JSON.parse(fs.readFileSync(path.join(raiz, '.gas-state', nombre + '.json'), 'utf8'));
const textoEstado = (nombre) => fs.readFileSync(path.join(raiz, '.gas-state', nombre + '.json'), 'utf8');
const huellaProyecto = (nombre) => huellaDe(correr('diff', nombre).texto);

function adoptar(nombre, descartar) {
  escribir((nombre === 'main' ? 'backend' : 'storage') + '/src/appsscript.json', MANIFIESTO);
  const h = huellaProyecto(nombre);
  const args = ['adopt', nombre, '--confirmar-huella', h];
  if (descartar) { args.push('--descartar', descartar); }
  const r = correr.apply(null, args);
  expect(r.codigo).toBe(0);
  llamadasClasp = [];
}
const subcomandos = () => llamadasClasp.map((c) => c.args[0]);

beforeEach(() => {
  raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'gas-test-'));
  llamadasClasp = [];
  salida = [];
  rutasNoIgnoradas = [];
  versionados = null;
  gitTracked = [];
  gitUntrackedProyecto = [];
  hookPull = null;
  hookPush = null;
  fallaPush = false;
  fallaUpdate = false;
  updateNoCambia = false;
  statusOverride = null;
  repoBase();
  remotosIguales();
  configurar({});
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

describe('comandos de clasp que el wrapper nunca expone', () => {
  test.each(['create-version', 'update-deployment', 'create-deployment', 'delete-deployment', 'redeploy', 'deploy-all', 'login'])('el comando "%s" no existe y no invoca clasp', (cmd) => {
    const r = correr(cmd, 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/Comando desconocido/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test.each([['push'], ['version'], ['deploy']])('"%s" sin sus argumentos obligatorios falla ANTES de tocar clasp', (cmd) => {
    const r = correr(cmd, 'main');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/exige/);
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
    gitTracked = [' M backend/src/Api.js'];
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

describe('status: configuracion local', () => {
  test('informa pushHabilitado y si hay deploymentId (enmascarado); sin .gas.local.json lo avisa', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN } });
    expect(correr('status', 'main').texto).toMatch(/Config local \(\.gas\.local\.json\): pushHabilitado=true \| deploymentId configurado \(…000002\)/);
    expect(correr('status', 'main').texto).not.toContain(DEP_MAIN);
    fs.rmSync(path.join(raiz, '.gas.local.json'));
    expect(correr('status', 'main').texto).toMatch(/Falta \.gas\.local\.json/);
  });
});

describe('opciones: validacion estricta', () => {
  test('--force y -f no existen; opciones desconocidas, argumentos sobrantes y flags con valor se rechazan antes de tocar clasp', () => {
    const h = 'a'.repeat(64);
    expect(correr('push', 'main', '--confirmar-huella', h, '--force').texto).toMatch(/nunca fuerza/);
    expect(correr('push', 'main', '--confirmar-huella', h, '-f').texto).toMatch(/argumento inesperado: -f/);
    expect(correr('push', 'main', '--confirmar-huella', h, '--otra').texto).toMatch(/opcion desconocida/);
    expect(correr('push', 'main', '--confirmar-huella', h, '--simular', 'si').texto).toMatch(/flag sin valor/);
    expect(correr('diff', 'main', '--permitir-sucio').texto).toMatch(/opcion desconocida/);
    expect(correr('deploy', 'main', '--version', '4', '--force').texto).toMatch(/nunca fuerza/);
    expect(llamadasClasp).toHaveLength(0);
  });
});

describe('push', () => {
  beforeEach(() => {
    configurar({ main: { pushHabilitado: true, deploymentId: '' } });
    adoptar('main');
  });
  const modificarLocal = () => { escribir('backend/src/Config.js', 'function getX() { return 22; }\n'); escribir('backend/src/Nuevo.js', 'function n() {}\n'); };
  const push = (h, ...extra) => correr.apply(null, ['push', 'main', '--confirmar-huella', h].concat(extra));

  test('push correcto: pull -> contraste -> push (sin --force) -> pull; remoto == local; informa agregados/modificados/eliminados y actualiza el estado', () => {
    modificarLocal();
    const h = huellaProyecto('main');
    llamadasClasp = [];
    const r = push(h);
    expect(r.codigo).toBe(0);
    expect(subcomandos()).toEqual(['pull', 'show-file-status', 'push', 'pull']);
    const llamadaPush = llamadasClasp.find((c) => c.args[0] === 'push');
    expect(llamadaPush.args).toEqual(['push', '--user', 'main']);
    expect(llamadaPush.cwd).toBe(path.join(raiz, 'backend'));
    llamadasClasp.forEach((c) => expect(L.verificarComandoClasp(c.args, { escritura: true })).toBe(true));
    expect(remotos[ID_MAIN]['Config.js']).toBe('function getX() { return 22; }\n');
    expect(remotos[ID_MAIN]['Nuevo.js']).toBe('function n() {}\n');
    expect(r.texto).toMatch(/Se agregarian \(1\), se modificarian \(1\), se ELIMINARIAN del remoto \(0\)/);
    expect(r.texto).toMatch(/PUSH VERIFICADO/);
    expect(r.texto).toMatch(/Agregados \(1\): Nuevo\.js/);
    expect(r.texto).toMatch(/Modificados \(1\): Config\.js/);
    expect(r.texto).toMatch(/Eliminados \(0\): -/);
    const e = estadoDe('main');
    expect(e.ultimoPush).toMatchObject({ agregados: ['Nuevo.js'], modificados: ['Config.js'], eliminados: [], gitHead: 'abc1234' });
    expect(e.descartados).toEqual([]);
    expect(Object.keys(e.remoto.archivos)).toContain('Nuevo.js');
    // y ahora el diff no ve deriva ni diferencias
    const d = correr('diff', 'main');
    expect(d.codigo).toBe(0);
    expect(d.texto).toMatch(/Modificados: 0 \| Solo local \(se agregarian\): 0 \| Solo remoto \(un push los BORRARIA\): 0/);
  });

  test('un segundo push con la huella nueva funciona sin volver a adoptar (el estado se actualizo)', () => {
    modificarLocal();
    expect(push(huellaProyecto('main')).codigo).toBe(0);
    escribir('backend/src/Servicio.js', 'function s() { return 33; }\n');
    expect(push(huellaProyecto('main')).codigo).toBe(0);
    expect(remotos[ID_MAIN]['Servicio.js']).toBe('function s() { return 33; }\n');
  });

  describe('huella', () => {
    test('falta, formato invalido o corta: error ANTES de tocar clasp', () => {
      expect(correr('push', 'main').codigo).toBe(1);
      expect(correr('push', 'main', '--confirmar-huella', 'a'.repeat(16)).texto).toMatch(/sha256 completo/);
      expect(correr('push', 'main', '--confirmar-huella', 'z'.repeat(64)).codigo).toBe(1);
      expect(llamadasClasp).toHaveLength(0);
    });

    test('huella incorrecta: se trae el remoto (lectura) pero NO se sube nada', () => {
      modificarLocal();
      const r = push('0'.repeat(64));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/la huella NO coincide/);
      expect(subcomandos()).toEqual(['pull']);
      expect(remotos[ID_MAIN]['Nuevo.js']).toBeUndefined();
    });

    test('una huella vieja (el repo cambio despues del diff) tambien se rechaza', () => {
      modificarLocal();
      const vieja = huellaProyecto('main');
      escribir('backend/src/Nuevo.js', 'function n() { return "otro"; }\n');
      llamadasClasp = [];
      expect(push(vieja).codigo).toBe(2);
      expect(subcomandos()).not.toContain('push');
    });
  });

  describe('pushHabilitado', () => {
    test('false (el valor inicial): se niega antes de leer nada del remoto', () => {
      configurar({ main: { pushHabilitado: false, deploymentId: '' } });
      modificarLocal();
      const h = huellaProyecto('main');
      llamadasClasp = [];
      const r = push(h);
      expect(r.codigo).toBe(1);
      expect(r.texto).toMatch(/DESHABILITADO.*main\.pushHabilitado = false/);
      expect(llamadasClasp).toHaveLength(0);
    });

    test('--simular ensaya TODAS las guardas sin subir nada y sin exigir pushHabilitado', () => {
      configurar({ main: { pushHabilitado: false, deploymentId: '' } });
      modificarLocal();
      const h = huellaProyecto('main');
      llamadasClasp = [];
      const r = push(h, '--simular');
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/SIMULACION completa.*No se subio nada/);
      expect(subcomandos()).toEqual(['pull', 'show-file-status']);
      expect(remotos[ID_MAIN]['Nuevo.js']).toBeUndefined();
    });

    test('--simular tambien respeta las guardas: con deriva remota aborta', () => {
      remotos[ID_MAIN]['Config.js'] = 'function getX() { return "editado"; }\n';
      const r = push(huellaProyecto('main'), '--simular');
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/BLOQUEANTE: el remoto CAMBIO desde la adopcion/);
    });

    test('sin .gas.local.json se niega', () => {
      fs.rmSync(path.join(raiz, '.gas.local.json'));
      llamadasClasp = [];
      expect(push('a'.repeat(64)).texto).toMatch(/Falta \.gas\.local\.json/);
      expect(llamadasClasp).toHaveLength(0);
    });

    test('un .gas.local.json invalido (pushHabilitado como texto) se rechaza', () => {
      escribir('.gas.local.json', JSON.stringify({ version: 1, main: { pushHabilitado: 'true', deploymentId: '' }, storage: { pushHabilitado: false, deploymentId: '' } }));
      expect(push('a'.repeat(64)).texto).toMatch(/pushHabilitado debe ser true o false/);
    });
  });

  describe('arbol git', () => {
    test('cambios en archivos versionados: aborta antes de tocar clasp', () => {
      modificarLocal();
      const h = huellaProyecto('main');
      gitTracked = [' M backend/src/Config.js'];
      llamadasClasp = [];
      const r = push(h);
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/el arbol git NO esta limpio.*Escape explicito: --permitir-sucio/s);
      expect(llamadasClasp).toHaveLength(0);
    });

    test('archivos nuevos DENTRO de la carpeta del proyecto tambien cuentan; las carpetas ajenas sin versionar (Cuencas/) no', () => {
      modificarLocal();
      const h = huellaProyecto('main');
      gitUntrackedProyecto = ['?? backend/src/Nuevo.js'];
      expect(push(h).codigo).toBe(2);
      gitUntrackedProyecto = ['?? Cuencas/'];
      expect(push(h).codigo).toBe(0);
    });

    test('--permitir-sucio es un escape explicito: sigue, con advertencia', () => {
      modificarLocal();
      const h = huellaProyecto('main');
      gitTracked = [' M backend/src/Config.js'];
      const r = push(h, '--permitir-sucio');
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/ADVERTENCIA: --permitir-sucio/);
      expect(subcomandos()).toContain('push');
    });
  });

  describe('estado remoto', () => {
    test('el remoto cambio desde adopt (editado a mano): aborta y no sube', () => {
      remotos[ID_MAIN]['Config.js'] = 'function getX() { return "editado en el editor web"; }\n';
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/BLOQUEANTE: el remoto CAMBIO desde la adopcion.*Config\.js/);
      expect(subcomandos()).not.toContain('push');
    });

    test('aparece un archivo remoto NUEVO no reconocido: aborta (un push lo borraria)', () => {
      remotos[ID_MAIN]['Intruso.js'] = 'function i() {}\n';
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/NO reconocido.*Intruso\.js/);
      expect(subcomandos()).not.toContain('push');
      expect(remotos[ID_MAIN]['Intruso.js']).toBeDefined();
    });

    test('proyecto sin adoptar: aborta', () => {
      fs.rmSync(path.join(raiz, '.gas-state/main.json'));
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/NO esta adoptado/);
      expect(subcomandos()).not.toContain('push');
    });

    test('proyecto CRUZADO (el scriptId de main apunta al proyecto de storage): aborta', () => {
      remotos[ID_MAIN] = Object.assign({}, remotos[ID_STORAGE]);
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/PROYECTOS CRUZADOS/);
      expect(subcomandos()).not.toContain('push');
      expect(fs.existsSync(path.join(raiz, '.gas-remote/main/.CRUZADO'))).toBe(true);
    });

    test('mismo scriptId en las dos carpetas: aborta', () => {
      escribir('storage/.clasp.json', JSON.stringify({ scriptId: ID_MAIN, rootDir: 'src' }));
      const r = push('a'.repeat(64));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/PROYECTOS CRUZADOS.*MISMO scriptId/s);
      expect(subcomandos()).not.toContain('push');
    });
  });

  describe('manifiesto', () => {
    const cambiarManifiesto = () => escribir('backend/src/appsscript.json', JSON.stringify({ runtimeVersion: 'V8', timeZone: 'America/Argentina/Mendoza' }));

    test('cambiado: aborta salvo --permitir-manifest', () => {
      cambiarManifiesto();
      const h = huellaProyecto('main');
      llamadasClasp = [];
      const r = push(h);
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/difiere del remoto.*--permitir-manifest/);
      expect(subcomandos()).not.toContain('push');
    });

    test('con --permitir-manifest se sube (con advertencia) y queda igual al local', () => {
      cambiarManifiesto();
      const h = huellaProyecto('main');
      const r = push(h, '--permitir-manifest');
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/ADVERTENCIA: --permitir-manifest/);
      expect(JSON.parse(remotos[ID_MAIN]['appsscript.json'])).toEqual({ runtimeVersion: 'V8', timeZone: 'America/Argentina/Mendoza' });
    });

    test('sin appsscript.json local no se sube NUNCA (ni con --permitir-manifest)', () => {
      fs.rmSync(path.join(raiz, 'backend/src/appsscript.json'));
      const h = huellaProyecto('main');
      const r = push(h, '--permitir-manifest');
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/falta appsscript\.json local/);
    });
  });

  describe('archivos solo-remotos aprobados para descarte', () => {
    beforeEach(() => {
      remotos[ID_MAIN]['Vieja.js'] = 'function vieja() {}\n';
      adoptar('main', 'Vieja.js');
    });

    test('un archivo aprobado en .gas-state SI se elimina del remoto; el push lo informa y limpia la lista de descartados', () => {
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(0);
      expect(r.texto).toMatch(/se ELIMINARIAN del remoto \(1\)/);
      expect(r.texto).toMatch(/Eliminados \(1\): Vieja\.js/);
      expect(remotos[ID_MAIN]['Vieja.js']).toBeUndefined();
      expect(estadoDe('main').descartados).toEqual([]);
      expect(estadoDe('main').ultimoPush.eliminados).toEqual(['Vieja.js']);
    });

    test('si el archivo ya no figura como aprobado (estado editado), el push se niega', () => {
      const e = estadoDe('main');
      e.descartados = [];
      fs.writeFileSync(path.join(raiz, '.gas-state/main.json'), JSON.stringify(e, null, 2));
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/NO reconocido.*Vieja\.js/);
      expect(remotos[ID_MAIN]['Vieja.js']).toBeDefined();
    });

    test('aprobar un archivo NO autoriza a borrar otros: uno aprobado y otro nuevo -> aborta', () => {
      remotos[ID_MAIN]['Otro.js'] = 'function otro() {}\n';
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/Otro\.js/);
      expect(remotos[ID_MAIN]['Vieja.js']).toBeDefined();
    });
  });

  describe('verificacion contra lo que clasp subiria', () => {
    test('un archivo local que clasp NO subiria bloquea el push', () => {
      statusOverride = { codigo: 0, stdout: JSON.stringify(['src/Api.js', 'src/Config.js', 'src/appsscript.json']), stderr: '' };   // falta Servicio.js
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/NO se subirian: Servicio\.js/);
      expect(subcomandos()).not.toContain('push');
    });

    test('un archivo inesperado que clasp SI subiria bloquea el push', () => {
      statusOverride = { codigo: 0, stdout: JSON.stringify(['src/Api.js', 'src/Config.js', 'src/Servicio.js', 'src/appsscript.json', 'src/Sobra.js']), stderr: '' };
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/SI se subirian: Sobra\.js/);
    });

    test('salida de clasp que no se reconoce: fail-closed', () => {
      statusOverride = { codigo: 0, stdout: 'nada util', stderr: '' };
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/no se pudo verificar/);
      expect(subcomandos()).not.toContain('push');
    });

    test('un archivo no permitido dentro de src (p. ej. un test) bloquea', () => {
      escribir('backend/src/Api.test.js', 'x\n');
      const r = push(huellaProyecto('main'));
      expect(r.codigo).toBe(2);
      expect(r.texto).toMatch(/NO permitidos.*Api\.test\.js/);
    });
  });

  describe('despues del push', () => {
    test('si el remoto NO coincide con el repo, exit 3, lo informa y NO actualiza el estado adoptado', () => {
      modificarLocal();
      const h = huellaProyecto('main');
      const antes = textoEstado('main');
      hookPush = (id) => { delete remotos[id]['Servicio.js']; };
      const r = push(h);
      expect(r.codigo).toBe(3);
      expect(r.texto).toMatch(/DESPUES del push el remoto NO coincide con el repo/);
      expect(r.texto).toMatch(/quedaron sin subir: Servicio\.js/);
      expect(textoEstado('main')).toBe(antes);
    });

    test('si clasp push falla: exit 3, estado remoto incierto y estado adoptado intacto', () => {
      modificarLocal();
      const h = huellaProyecto('main');
      const antes = textoEstado('main');
      fallaPush = true;
      const r = push(h);
      expect(r.codigo).toBe(3);
      expect(r.texto).toMatch(/clasp push fallo.*INCIERTO/s);
      expect(r.texto).not.toContain(ID_MAIN);
      expect(textoEstado('main')).toBe(antes);
    });
  });

  test('storage se sube aparte, con su propia cuenta y su propio estado', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: '' }, storage: { pushHabilitado: true, deploymentId: '' } });
    adoptar('storage');
    const estadoMain = textoEstado('main');
    escribir('storage/src/StorageAuth.js', 'function a() { return 55; }\n');
    const h = huellaProyecto('storage');
    llamadasClasp = [];
    const r = correr('push', 'storage', '--confirmar-huella', h);
    expect(r.codigo).toBe(0);
    llamadasClasp.forEach((c) => expect(c.args[c.args.length - 1]).toBe('storage'));
    expect(llamadasClasp.find((c) => c.args[0] === 'push').cwd).toBe(path.join(raiz, 'storage'));
    expect(remotos[ID_STORAGE]['StorageAuth.js']).toBe('function a() { return 55; }\n');
    expect(textoEstado('main')).toBe(estadoMain);
  });
});

describe('version', () => {
  beforeEach(() => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN } });
    adoptar('main');
  });
  const version = (...extra) => correr.apply(null, ['version', 'main'].concat(extra));

  test('sin descripcion (o vacia / que empieza con "-"): error ANTES de tocar clasp', () => {
    expect(version().texto).toMatch(/exige --descripcion/);
    expect(version('--descripcion', '   ').codigo).toBe(1);
    expect(version('--descripcion', '-x').codigo).toBe(1);
    expect(version('--descripcion', 'x'.repeat(201)).codigo).toBe(1);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('crea la version (solo create-version, nunca despliega) y devuelve el numero', () => {
    const r = version('--descripcion', 'Correcciones de ubicacion');
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/VERSION CREADA: 4 \("Correcciones de ubicacion"\)\. No se desplego nada/);
    expect(subcomandos()).toEqual(['pull', 'list-versions', 'create-version', 'list-versions']);
    expect(llamadasClasp.find((c) => c.args[0] === 'create-version').args).toEqual(['create-version', 'Correcciones de ubicacion', '--user', 'main']);
    expect(versiones[ID_MAIN]).toHaveLength(4);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(3);        // el deployment NO se movio
    expect(estadoDe('main').ultimaVersion).toMatchObject({ numero: 4, descripcion: 'Correcciones de ubicacion', gitHead: 'abc1234' });
    expect(subcomandos()).not.toContain('update-deployment');
    expect(subcomandos()).not.toContain('push');
  });

  test('si clasp no informa el numero, se toma la mayor version listada (y se verifica que subio)', () => {
    const ejecutarOriginal = ejecutarClasp;
    const c = crearCli({
      raiz: raiz, salida: (t) => salida.push(String(t)), ejecutarGit: ejecutarGit, generarDiff: () => '', ahora: () => new Date('2026-10-09T12:00:00Z'),
      ejecutarClasp: (args, o) => { const r = ejecutarOriginal(args, o); return args[0] === 'create-version' ? { codigo: 0, stdout: 'ok', stderr: '' } : r; }
    });
    salida = [];
    expect(c.ejecutar(['version', 'main', '--descripcion', 'sin numero informado'])).toBe(0);
    expect(salida.join('\n')).toMatch(/VERSION CREADA: 4/);
  });

  test('si el remoto NO coincide con el repo (HEAD roto o sin subir), no crea la version', () => {
    escribir('backend/src/Config.js', 'function getX() { return 22; }\n');
    llamadasClasp = [];
    const r = version('--descripcion', 'x');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/una version congela el HEAD remoto y este NO coincide con el repo/);
    expect(r.texto).toMatch(/Config\.js/);
    expect(subcomandos()).not.toContain('create-version');
  });

  test('un remoto con un archivo de mas (p. ej. un duplicado) tampoco', () => {
    remotos[ID_MAIN]['Codigo.js'] = 'function dup() {}\n';
    const r = version('--descripcion', 'x');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/Codigo\.js/);
    expect(subcomandos()).not.toContain('create-version');
  });

  test('arbol sucio: aborta; sin adoptar: error', () => {
    gitTracked = [' M backend/src/Api.js'];
    expect(version('--descripcion', 'x').codigo).toBe(2);
    gitTracked = [];
    fs.rmSync(path.join(raiz, '.gas-state/main.json'));
    expect(version('--descripcion', 'x').texto).toMatch(/no esta adoptado/);
    expect(subcomandos()).not.toContain('create-version');
  });

  test('si create-version falla: exit 3', () => {
    const ejecutarOriginal = ejecutarClasp;
    const c = crearCli({
      raiz: raiz, salida: (t) => salida.push(String(t)), ejecutarGit: ejecutarGit, generarDiff: () => '',
      ejecutarClasp: (args, o) => (args[0] === 'create-version' ? { codigo: 1, stdout: '', stderr: 'boom' } : ejecutarOriginal(args, o))
    });
    salida = [];
    expect(c.ejecutar(['version', 'main', '--descripcion', 'x'])).toBe(3);
  });
});

describe('deploy', () => {
  beforeEach(() => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN }, storage: { pushHabilitado: true, deploymentId: DEP_ST } });
    adoptar('main');
    versiones[ID_MAIN].push(Object.assign({}, remotos[ID_MAIN]));          // version 4 == repo
  });
  const deploy = (...extra) => correr.apply(null, ['deploy', 'main'].concat(extra));
  const TOKEN = 'v4@' + DEP_MAIN.slice(-6);
  const escrituras = () => llamadasClasp.filter((c) => ['push', 'create-version', 'update-deployment', 'create-deployment'].indexOf(c.args[0]) !== -1);

  test('sin --version o con una version invalida: error antes de tocar clasp', () => {
    expect(deploy().texto).toMatch(/exige --version/);
    expect(deploy('--version', 'abc').codigo).toBe(1);
    expect(deploy('--version', '0').codigo).toBe(1);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('deploymentId ausente en .gas.local.json: error con instrucciones', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: '' } });
    const r = deploy('--version', '4');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/falta main\.deploymentId en \.gas\.local\.json/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('plan sin confirmar: muestra version actual -> destino, pide el token y NO modifica nada; el ID completo no se imprime', () => {
    const r = deploy('--version', '4');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/Deployment …000002: version actual 3 {2}->/);
    expect(r.texto).toMatch(/pasaria a la version 4/);
    expect(r.texto).toMatch(/La version 4 coincide exactamente con el repo local/);
    expect(r.texto).toContain('--confirmar-despliegue ' + TOKEN);
    expect(r.texto).not.toContain(DEP_MAIN);
    expect(escrituras()).toHaveLength(0);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(3);
  });

  test('confirmacion incorrecta: no hace nada', () => {
    const r = deploy('--version', '4', '--confirmar-despliegue', 'v4@000001');
    expect(r.codigo).toBe(2);
    expect(escrituras()).toHaveLength(0);
  });

  test('con la confirmacion correcta: solo update-deployment sobre el deployment configurado; se verifica y se informa', () => {
    const r = deploy('--version', '4', '--confirmar-despliegue', TOKEN);
    expect(r.codigo).toBe(0);
    expect(escrituras().map((c) => c.args)).toEqual([['update-deployment', DEP_MAIN, '-V', '4', '-d', 'Version 4 (gas:deploy)', '--user', 'main']]);
    expect(llamadasClasp.map((c) => c.args[0])).not.toContain('create-deployment');
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(4);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN_HEAD).version).toBeNull();          // @HEAD intacto
    expect(despliegues[ID_MAIN]).toHaveLength(2);                                                 // no se creo ningun deployment
    expect(r.texto).toMatch(/DEPLOY VERIFICADO: el deployment …000002 paso de la version 3 a la 4/);
    expect(r.texto).not.toContain(DEP_MAIN);
    expect(estadoDe('main').ultimoDeploy).toMatchObject({ version: 4, anterior: 3, deployment: '…000002' });
  });

  test('con --descripcion la manda a clasp', () => {
    deploy('--version', '4', '--confirmar-despliegue', TOKEN, '--descripcion', 'Correcciones de ubicacion');
    expect(escrituras()[0].args).toEqual(['update-deployment', DEP_MAIN, '-V', '4', '-d', 'Correcciones de ubicacion', '--user', 'main']);
  });

  test('deployment INCORRECTO (de otro proyecto o inexistente): no figura en este proyecto -> no se toca nada', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_ST }, storage: { pushHabilitado: true, deploymentId: '' } });
    const r = deploy('--version', '4', '--confirmar-despliegue', 'v4@' + DEP_ST.slice(-6));
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/NO figura entre los deployments de este proyecto/);
    expect(escrituras()).toHaveLength(0);
  });

  test('el mismo deploymentId en main y storage: configuracion invalida', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN }, storage: { pushHabilitado: true, deploymentId: DEP_MAIN } });
    const r = deploy('--version', '4');
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/MISMO deploymentId/);
    expect(llamadasClasp).toHaveLength(0);
  });

  test('destino @HEAD: NUNCA (aunque se confirme)', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN_HEAD }, storage: { pushHabilitado: true, deploymentId: '' } });
    const r = deploy('--version', '4', '--confirmar-despliegue', 'v4@' + DEP_MAIN_HEAD.slice(-6));
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/@HEAD.*no es un destino productivo/);
    expect(escrituras()).toHaveLength(0);
  });

  test('version inexistente: no se toca nada', () => {
    const r = deploy('--version', '99', '--confirmar-despliegue', 'v99@000002');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/version 99 NO existe/);
    expect(escrituras()).toHaveLength(0);
  });

  test('misma version que ya tiene: nada que hacer; retroceso solo con --permitir-retroceso', () => {
    expect(deploy('--version', '3', '--confirmar-despliegue', 'v3@000002').texto).toMatch(/ya esta en la version 3/);
    const r = deploy('--version', '2', '--confirmar-despliegue', 'v2@000002');
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/RETROCESO/);
    expect(escrituras()).toHaveLength(0);
    const ok = deploy('--version', '2', '--confirmar-despliegue', 'v2@000002', '--permitir-retroceso');
    expect(ok.codigo).toBe(0);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(2);
  });

  test('una version que NO coincide con el repo local se rechaza (salvo --permitir-distinta)', () => {
    escribir('backend/src/Config.js', 'function getX() { return 99; }\n');             // el repo avanzo despues de crear la version 4
    const r = deploy('--version', '4', '--confirmar-despliegue', TOKEN);
    expect(r.codigo).toBe(2);
    expect(r.texto).toMatch(/La version 4 NO coincide con el repo local: Config\.js/);
    expect(escrituras()).toHaveLength(0);
    const ok = deploy('--version', '4', '--confirmar-despliegue', TOKEN, '--permitir-distinta');
    expect(ok.codigo).toBe(0);
    expect(ok.texto).toMatch(/ADVERTENCIA: --permitir-distinta/);
  });

  test('si update-deployment falla: exit 3 (sin imprimir IDs)', () => {
    fallaUpdate = true;
    const r = deploy('--version', '4', '--confirmar-despliegue', TOKEN);
    expect(r.codigo).toBe(3);
    expect(r.texto).not.toContain(DEP_MAIN);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(3);
  });

  test('si despues del update el deployment no quedo en la version pedida: exit 3', () => {
    updateNoCambia = true;
    const r = deploy('--version', '4', '--confirmar-despliegue', TOKEN);
    expect(r.codigo).toBe(3);
    expect(r.texto).toMatch(/no se pudo confirmar que el deployment quedo en la version 4/);
  });

  test('storage: usa su propio deployment y su propia cuenta', () => {
    configurar({ main: { pushHabilitado: true, deploymentId: DEP_MAIN }, storage: { pushHabilitado: true, deploymentId: DEP_ST } });
    adoptar('storage');
    versiones[ID_STORAGE].push(Object.assign({}, remotos[ID_STORAGE]));    // version 3 == repo
    const r = correr('deploy', 'storage', '--version', '3', '--confirmar-despliegue', 'v3@' + DEP_ST.slice(-6));
    expect(r.codigo).toBe(0);
    expect(escrituras()[0].args).toEqual(['update-deployment', DEP_ST, '-V', '3', '-d', 'Version 3 (gas:deploy)', '--user', 'storage']);
    expect(despliegues[ID_STORAGE].find((d) => d.id === DEP_ST).version).toBe(3);
    expect(despliegues[ID_MAIN].find((d) => d.id === DEP_MAIN).version).toBe(3);        // main intacto
    expect(r.texto).not.toContain(DEP_ST);
  });
});

describe('deployments (solo lectura)', () => {
  test('lista los deployments con IDs enmascarados, marca @HEAD como no productivo y el configurado', () => {
    configurar({ main: { pushHabilitado: false, deploymentId: DEP_MAIN } });
    const r = correr('deployments', 'main');
    expect(r.codigo).toBe(0);
    expect(r.texto).toMatch(/Versiones: 3 \(la ultima: 3\)/);
    expect(r.texto).toMatch(/…000001 \| @HEAD = deployment de PRUEBAS \(\/dev\): NO es un destino productivo/);
    expect(r.texto).toMatch(/…000002 \| version numerada 3 \| configurado en \.gas\.local\.json/);
    expect(r.texto).not.toContain(DEP_MAIN);
    expect(subcomandos()).toEqual(['list-deployments', 'list-versions']);
  });

  test('--mostrar-ids imprime los IDs completos (solo si se pide)', () => {
    expect(correr('deployments', 'main', '--mostrar-ids').texto).toContain(DEP_MAIN);
  });

  test('main: marca el deployment que coincide con la URL /exec de js/api.js', () => {
    escribir('js/api.js', "var APPS_SCRIPT_URL = 'https://script.google.com/macros/s/" + DEP_MAIN + "/exec';\n");
    expect(correr('deployments', 'main').texto).toMatch(/…000002 \| version numerada 3 \| coincide con la URL \/exec de js\/api\.js \(PRODUCCION\)/);
  });

  test('avisa si el deploymentId esta vacio o no figura en el proyecto; el storage recuerda que es secreto', () => {
    expect(correr('deployments', 'main').texto).toMatch(/main\.deploymentId esta VACIO/);
    configurar({ main: { pushHabilitado: false, deploymentId: DEP_ST } });
    expect(correr('deployments', 'main').texto).toMatch(/NO figura entre los deployments de este proyecto/);
    expect(correr('deployments', 'storage').texto).toMatch(/URL secreta/);
  });

  test('no modifica nada: solo list-deployments y list-versions', () => {
    correr('deployments', 'main');
    correr('deployments', 'storage');
    expect(llamadasClasp.every((c) => ['list-deployments', 'list-versions'].indexOf(c.args[0]) !== -1)).toBe(true);
  });
});

describe('uso', () => {
  test('sin argumentos muestra el uso', () => {
    const r = correr();
    expect(r.codigo).toBe(1);
    expect(r.texto).toMatch(/Uso: node scripts\/gas\/gas\.js/);
  });
});
