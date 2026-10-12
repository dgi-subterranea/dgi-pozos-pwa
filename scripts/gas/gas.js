#!/usr/bin/env node
'use strict';
// Wrapper de clasp para los DOS proyectos de Apps Script (main = backend/, storage = storage/).
// LECTURA (no modifican el remoto):
//   pull         trae el proyecto remoto a .gas-remote/<proyecto>/ (JAMAS sobre src)
//   status       inventario local derivado del filesystem + chequeos de seguridad
//   diff         pull + comparacion local/remoto: solo remotos, solo locales, modificados, manifiesto, huella
//   adopt        registra LOCALMENTE (.gas-state/) que se reviso el estado remoto; no escribe nada en Apps Script
//   deployments  lista los deployments y versiones (IDs enmascarados)
// ESCRITURA (cada una detras de TODAS sus guardas; ver gasLogic.verificarComandoClasp: forma exacta, sin --force):
//   push         clasp push (reemplaza el remoto por el repo) con --confirmar-huella, arbol limpio, deriva, cruces, manifiesto...
//   version      clasp create-version (nunca despliega)
//   deploy       clasp update-deployment sobre un deployment EXISTENTE de .gas.local.json (nunca crea uno, nunca @HEAD)
// Ningun scriptId, deploymentId ni token se versiona: .clasp.json, .clasprc.json y .gas.local.json estan en .gitignore.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const L = require('./gasLogic');

const USO = [
  'Uso: node scripts/gas/gas.js <comando> <main|storage> [opciones]   (o: npm run gas:<comando>:<main|storage> -- [opciones])',
  '  pull     trae el remoto a .gas-remote/<proyecto>/ (nunca toca src)',
  '  status   inventario local y chequeos de seguridad',
  '  diff     pull + comparacion local/remoto + huella      [--lineas N] [--max-archivos N] [--sin-pull]',
  '  adopt    registra el estado remoto revisado en .gas-state/   --confirmar-huella <hex> [--descartar a.js,b.js]',
  '  deployments   lista deployments y versiones (IDs enmascarados)   [--mostrar-ids]',
  '  push     sube src al proyecto remoto   --confirmar-huella <sha256 completo> [--simular] [--permitir-sucio] [--permitir-manifest]',
  '  version  crea una version (no despliega)   --descripcion "<texto>" [--permitir-sucio]',
  '  deploy   actualiza un deployment EXISTENTE   --version <n> [--descripcion "<texto>"] [--confirmar-despliegue vN@xxxxxx] [--permitir-retroceso] [--permitir-distinta] [--permitir-head-distinto]'
].join('\n');

function claspPorDefecto(raiz) {
  const bin = path.join(raiz, 'node_modules', '@google', 'clasp', 'build', 'src', 'index.js');
  return function ejecutar(args, o) {
    if (!fs.existsSync(bin)) { throw new L.ErrorGas('clasp no esta instalado: correr "npm install" en la raiz del repo'); }
    const r = cp.spawnSync(process.execPath, [bin].concat(args), { cwd: o.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 180000, windowsHide: true, env: process.env });
    return { codigo: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: (r.stderr || '') + (r.error ? String(r.error.message) : '') };
  };
}

function gitPorDefecto(raiz) {
  return function ejecutar(args) {
    const r = cp.spawnSync('git', args, { cwd: raiz, encoding: 'utf8', windowsHide: true });
    return { codigo: r.status === null ? 1 : r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
}

// Diff unificado "remoto -> local" (lo que un push cambiaria): "-" es el remoto, "+" es lo local. Usa git solo para formatear.
function diffPorDefecto(raiz) {
  return function generar(rutaRemota, rutaLocal) {
    const r = cp.spawnSync('git', ['--no-pager', 'diff', '--no-index', '--no-color', '--ignore-cr-at-eol', '-U2', '--', rutaRemota, rutaLocal], { cwd: raiz, encoding: 'utf8', windowsHide: true });
    return r.stdout || '';
  };
}

function crearCli(opts) {
  const raiz = path.resolve(opts.raiz);
  const out = opts.salida || ((t) => console.log(t));
  const clasp0 = opts.ejecutarClasp || claspPorDefecto(raiz);
  const git = opts.ejecutarGit || gitPorDefecto(raiz);
  const generarDiff = opts.generarDiff || diffPorDefecto(raiz);
  const ahora = opts.ahora || (() => new Date());
  // TODA invocacion a clasp pasa por la allowlist de solo lectura.
  const clasp = (args, o) => { L.verificarComandoClasp(args); return clasp0(args, o); };
  // Unico camino hacia un comando de clasp que ESCRIBE en Apps Script: push / create-version / update-deployment, solo con su forma exacta.
  const claspW = (args, o) => { L.verificarComandoClasp(args, { escritura: true }); return clasp0(args, o); };
  const rel = (p) => path.relative(raiz, p).split(path.sep).join('/');
  const real = (x) => { try { return fs.realpathSync(x); } catch (e) { return x; } };
  const dirRemoto = (nombre) => path.join(raiz, '.gas-remote', nombre);
  const archivoEstado = (nombre) => path.join(raiz, '.gas-state', nombre + '.json');

  // ---------------------------------------------------------------- filesystem
  // Destino de TODA escritura: cwd EXACTO de la carpeta del proyecto (nunca .gas-remote/* ni otra) y .clasp.json con el scriptId esperado,
  // releido del disco en cada escritura (si cambio durante la ejecucion, se rechaza).
  function erroresDestinoEscritura(p, cwd) {
    const esperado = path.join(raiz, p.def.carpeta);
    const destino = cwd === undefined ? esperado : cwd;
    let claspJson = null;
    if (typeof destino === 'string' && path.isAbsolute(destino)) {
      try { claspJson = JSON.parse(fs.readFileSync(path.join(destino, '.clasp.json'), 'utf8')); } catch (e) { claspJson = null; }
    }
    return L.validarDestinoEscritura({
      raiz: raiz, cwd: typeof destino === 'string' && path.isAbsolute(destino) ? real(destino) : destino, esperado: real(esperado), claspJson: claspJson,
      scriptIdEsperado: p.scriptId, scriptIdOtro: idsDeAmbos()[otroProyecto(p.nombre)] || null
    });
  }

  function claspEscritura(p, args, cwd) {
    const destino = cwd === undefined ? path.join(raiz, p.def.carpeta) : cwd;
    const errores = erroresDestinoEscritura(p, destino);
    if (errores.length) { throw new L.ErrorGas('escritura rechazada (' + args[0] + '): ' + errores.join('; ')); }
    return claspW(args, { cwd: destino });
  }

  function listar(dir, conOcultos) {
    const res = [];
    (function rec(d, prefijo) {
      if (!fs.existsSync(d)) { return; }
      fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
        if (e.name === 'node_modules' || (!conOcultos && e.name.startsWith('.'))) { return; }
        const ruta = prefijo ? prefijo + '/' + e.name : e.name;
        if (e.isDirectory()) { rec(path.join(d, e.name), ruta); } else { res.push(ruta); }
      });
    })(dir, '');
    return res.sort();
  }

  function hashDirectorio(dir) {
    return L.sha256(JSON.stringify(listar(dir, true).map((n) => [n, L.sha256(fs.readFileSync(path.join(dir, n)).toString('latin1'))])));
  }

  function leerLocal(src) {
    const cls = L.clasificarLocal(listar(src, false));
    const codigo = new Map();
    cls.codigo.forEach((n) => codigo.set(n, L.sha256(L.normalizarTexto(fs.readFileSync(path.join(src, n), 'utf8')))));
    const manifiesto = cls.manifiesto ? fs.readFileSync(path.join(src, L.MANIFIESTO), 'utf8') : null;
    return { codigo: codigo, manifiesto: manifiesto, extras: cls.extras };
  }

  function leerRemoto(dir) {
    const codigo = new Map();
    const rutas = new Map();
    let manifiesto = null;
    listar(dir, false).forEach((n) => {
      const contenido = fs.readFileSync(path.join(dir, n), 'utf8');
      if (n === L.MANIFIESTO) { manifiesto = contenido; return; }
      const nombre = L.nombreNormalizado(n);
      codigo.set(nombre, L.sha256(L.normalizarTexto(contenido)));
      rutas.set(nombre, path.join(dir, n));
    });
    return { codigo: codigo, manifiesto: manifiesto, rutas: rutas };
  }

  // ---------------------------------------------------------------- proyecto / config
  function leerClaspJson(def, tolerante) {
    const ruta = path.join(raiz, def.carpeta, '.clasp.json');
    if (!fs.existsSync(ruta)) {
      if (tolerante) { return { ruta: ruta, existe: false }; }
      throw new L.ErrorGas('Falta ' + rel(ruta) + '. Copiá ' + def.carpeta + '/.clasp.json.example a ' + def.carpeta + '/.clasp.json y pegá el scriptId real (queda solo en tu PC, esta en .gitignore).');
    }
    let obj;
    try { obj = JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (e) {
      if (tolerante) { return { ruta: ruta, existe: true, errores: ['no es JSON valido'] }; }
      throw new L.ErrorGas(rel(ruta) + ' no es JSON valido');
    }
    const v = L.validarClaspJson(obj);
    if (!v.ok && !tolerante) { throw new L.ErrorGas(rel(ruta) + ': ' + v.errores.join('; ')); }
    return { ruta: ruta, existe: true, errores: v.errores, scriptId: v.ok ? obj.scriptId : null };
  }

  function cargarProyecto(nombre, tolerante) {
    const def = L.PROYECTOS[nombre];
    if (!def) { throw new L.ErrorGas('proyecto desconocido: ' + JSON.stringify(nombre) + ' (usar main o storage)'); }
    const cfg = leerClaspJson(def, tolerante);
    return { nombre: nombre, def: def, src: path.join(raiz, def.carpeta, 'src'), cfg: cfg, scriptId: cfg.scriptId || null, remotoDir: dirRemoto(nombre) };
  }

  function otroProyecto(nombre) {
    return nombre === 'main' ? 'storage' : 'main';
  }

  function idsDeAmbos() {
    const ids = {};
    Object.keys(L.PROYECTOS).forEach((n) => {
      try { ids[n] = leerClaspJson(L.PROYECTOS[n], true).scriptId || null; } catch (e) { ids[n] = null; }
    });
    return ids;
  }

  function nombresAjenos(nombre) {
    const otro = L.PROYECTOS[otroProyecto(nombre)];
    return new Set(leerLocal(path.join(raiz, otro.carpeta, 'src')).codigo.keys());
  }

  // ---------------------------------------------------------------- seguridad de git
  function seguridadGit(p) {
    const errores = [];
    const avisos = [];
    const sensibles = [p.def.carpeta + '/.clasp.json', '.clasprc.json', p.def.carpeta + '/.clasprc.json', 'storage/.clasprc.json', 'backend/.clasprc.json'];
    const versionados = git(['ls-files', '--'].concat(sensibles));
    if (versionados.stdout.trim()) { errores.push('hay archivos con scriptId o credenciales VERSIONADOS en git: ' + versionados.stdout.trim().split(/\r?\n/).join(', ')); }
    [p.def.carpeta + '/.clasp.json', '.clasprc.json', '.gas-remote/x', '.gas-state/x', '.gas.local.json'].forEach((r) => {
      if (git(['check-ignore', '-q', r]).codigo !== 0) { errores.push(r + ' NO esta en .gitignore'); }
    });
    return { errores: errores, avisos: avisos };
  }

  function infoGit(p) {
    const srcRel = p.def.carpeta + '/src';
    const fs0 = new Set(listar(p.src, false));
    const tracked = new Set(git(['ls-files', '--', srcRel]).stdout.split(/\r?\n/).filter(Boolean).map((n) => n.slice(srcRel.length + 1)));
    const sucio = git(['status', '--porcelain', '--', srcRel]).stdout.split(/\r?\n/).filter(Boolean);
    const head = git(['rev-parse', '--short', 'HEAD']).stdout.trim();
    return {
      head: head || null, sucio: sucio, sinVersionar: Array.from(fs0).filter((n) => !tracked.has(n)).sort(),
      versionadosAusentes: Array.from(tracked).filter((n) => !fs0.has(n)).sort(), enFilesystem: fs0.size, versionados: tracked.size
    };
  }

  // ---------------------------------------------------------------- pull
  function prepararRemoto(p) {
    const base = path.join(raiz, '.gas-remote');
    const destino = path.resolve(base, p.nombre);
    if (!L.PROYECTOS[p.nombre] || !destino.startsWith(path.resolve(base) + path.sep)) { throw new L.ErrorGas('ruta de destino del pull invalida'); }
    fs.rmSync(destino, { recursive: true, force: true });
    fs.mkdirSync(destino, { recursive: true });
    return destino;
  }

  function pistaDeError(texto) {
    const t = String(texto).toLowerCase();
    if (/no credentials|not logged in|login|invalid_grant|unauthenticated|401/.test(t)) { return '\nProbá primero:  npx clasp login --user <main|storage>'; }
    if (/apps script api|has not enabled|403|permission/.test(t)) { return '\nRevisá que la Apps Script API este activada en ESA cuenta: https://script.google.com/home/usersettings'; }
    return '';
  }

  function pullProyecto(p) {
    const antes = hashDirectorio(p.src);
    const destino = prepararRemoto(p);
    fs.writeFileSync(path.join(destino, '.clasp.json'), JSON.stringify({ scriptId: p.scriptId }, null, 2) + '\n', 'utf8');
    const r = clasp(['pull', '--user', p.def.usuario], { cwd: destino });
    // Garantia dura: un pull NUNCA puede modificar src. Si cambiara, se corta antes de seguir.
    if (hashDirectorio(p.src) !== antes) { throw new L.ErrorGas('INCONSISTENCIA GRAVE: ' + rel(p.src) + ' cambio durante el pull. Revisá con "git status" y "git diff" antes de seguir.'); }
    if (r.codigo !== 0) {
      throw new L.ErrorGas('clasp pull fallo (codigo ' + r.codigo + '): ' + L.enmascarar((r.stderr || r.stdout).trim(), [p.scriptId]).slice(0, 600) + pistaDeError(r.stderr + r.stdout));
    }
    fs.writeFileSync(path.join(destino, '.gas-meta.json'), JSON.stringify({ proyecto: p.nombre, traidoEn: ahora().toISOString() }, null, 2) + '\n', 'utf8');
    return leerRemoto(destino);
  }

  // ---------------------------------------------------------------- evaluacion
  function leerEstado(p) {
    const ruta = archivoEstado(p.nombre);
    if (!fs.existsSync(ruta)) { return null; }
    try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (e) { throw new L.ErrorGas(rel(ruta) + ' esta corrupto (no es JSON): revisalo o borralo y volvé a adoptar'); }
  }

  function evaluarProyecto(p, remoto) {
    const local = leerLocal(p.src);
    const g = infoGit(p);
    const ev = L.evaluar({
      proyecto: p.nombre, local: local, remoto: remoto, extras: local.extras, scriptIds: idsDeAmbos(), nombresAjenos: nombresAjenos(p.nombre),
      estadoAdoptado: leerEstado(p)
    });
    // Discrepancias de conteo: se IDENTIFICAN y explican (el conteo siempre sale del filesystem, nunca de una constante).
    if (g.sinVersionar.length) { ev.advertencias.push('hay ' + g.sinVersionar.length + ' archivo(s) en ' + rel(p.src) + ' que git NO versiona: ' + g.sinVersionar.join(', ') + ' (el conteo del filesystem supera al de git)'); }
    if (g.versionadosAusentes.length) { ev.advertencias.push('git versiona ' + g.versionadosAusentes.length + ' archivo(s) que NO estan en el filesystem: ' + g.versionadosAusentes.join(', ') + ' (borrados sin commitear?)'); }
    if (g.sucio.length) { ev.advertencias.push(rel(p.src) + ' tiene cambios sin commitear (' + g.sucio.length + '): un push futuro exigira arbol limpio'); }
    return { ev: ev, local: local, remoto: remoto, git: g };
  }

  function marcarCruce(p, ev) {
    if (ev.cruce.length) { fs.writeFileSync(path.join(p.remotoDir, '.CRUZADO'), ev.cruce.join('\n') + '\n', 'utf8'); }
  }

  // Trae HEAD de nuevo (SOLO LECTURA) y lo compara con el repo. firmaReferencia: firma de HEAD antes de la operacion (detecta cambios DURANTE ella).
  function inspeccionarHead(p, firmaReferencia) {
    let r;
    try { r = evaluarProyecto(p, pullProyecto(p)); } catch (e) {
      if (!(e instanceof L.ErrorGas) || /INCONSISTENCIA GRAVE/.test(e.message)) { throw e; }
      return { verificable: false, problemasRepo: [], cambio: false, falla: e.message.replace(/^ERROR: /, ''), firma: null, ev: null, remoto: null };
    }
    marcarCruce(p, r.ev);
    const firma = L.firmaRemoto(r.remoto.codigo, r.remoto.manifiesto);
    return {
      verificable: true, problemasRepo: L.evaluarHead(r.ev, r.local.extras).problemas, cambio: !!firmaReferencia && firma !== firmaReferencia,
      falla: null, firma: firma, ev: r.ev, remoto: r.remoto
    };
  }

  function headOk(h) { return h.verificable && !h.cambio && !h.problemasRepo.length; }

  function describirHead(h) {
    const l = [];
    if (!h.verificable) { l.push('  - no se pudo traer HEAD para verificarlo: ' + h.falla); }
    h.problemasRepo.forEach((m) => l.push('  - ' + m));
    if (h.cambio) { l.push('  - HEAD CAMBIO durante la operacion (su contenido ya no es el que tenia antes)'); }
    return l;
  }

  // Aviso de "remoto revertido": el remoto actual es el estado anterior al ultimo push registrado en .gas-state.
  function avisoRevertido(estado, ev, remoto, fuente) {
    const d = L.detectarRevertido({ estado: estado, huella: ev.huella, firma: L.firmaRemoto(remoto.codigo, remoto.manifiesto) });
    if (!d.revertido) { return []; }
    return [
      'ATENCION: El remoto volvió al estado anterior al último push' + (fuente ? ' (' + fuente + ')' : '') + ' [detectado por ' + (d.por === 'contenido' ? 'el contenido remoto previo' : 'la huella previa') + '].',
      '  Algo subió una copia vieja del proyecto DESPUES del push: tipicamente una pestaña vieja del editor de Apps Script (guardar/ejecutar/desplegar desde ella sube todo su contenido), o un clasp push desde otra carpeta o equipo.',
      '  Las versiones numeradas (lo desplegado en /exec) NO se modifican por esto; HEAD (y @HEAD) si. Cerrá las pestañas del editor, y recién despues repetí gas:diff, gas:adopt y gas:push.'
    ];
  }

  function lineasOperaciones(estado) {
    const r = L.resumenOperaciones(estado);
    return r ? ['Operaciones registradas: ' + r] : [];
  }

  function lista(titulo, nombres, max) {
    if (!nombres.length) { return; }
    out('  ' + titulo + ' (' + nombres.length + '): ' + nombres.slice(0, max || 60).join(', ') + (nombres.length > (max || 60) ? ', …' : ''));
  }

  function imprimirResumenManifiesto(r, etiqueta) {
    if (!r) { out('    ' + etiqueta + ': (no existe)'); return; }
    if (r.invalido) { out('    ' + etiqueta + ': (JSON invalido)'); return; }
    out('    ' + etiqueta + ': runtime=' + r.runtimeVersion + ' | timeZone=' + r.timeZone + ' | webapp=' + (r.webappAccess ? r.webappAccess + '/' + r.webappExecuteAs : 'sin config') +
      ' | alcances=' + (r.oauthScopes ? r.oauthScopes.length : 'automaticos') + ' | servicios avanzados=' + (r.serviciosAvanzados.length ? r.serviciosAvanzados.join(',') : 'ninguno') + ' | librerias=' + (r.librerias.length ? r.librerias.join(',') : 'ninguna'));
  }

  // ---------------------------------------------------------------- comandos
  function cmdPull(nombre) {
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    out('Trayendo "' + p.def.titulo + '" (' + L.ultimos(p.scriptId) + ') a ' + rel(p.remotoDir) + ' con la cuenta clasp "' + p.def.usuario + '" (SOLO LECTURA; ' + rel(p.src) + ' no se toca)…');
    const remoto = pullProyecto(p);
    const local = leerLocal(p.src);
    const cruce = L.detectarCruce({ scriptIds: idsDeAmbos(), nombresRemotos: new Set(remoto.codigo.keys()), nombresPropios: new Set(local.codigo.keys()), nombresAjenos: nombresAjenos(nombre) });
    out('Remoto: ' + remoto.codigo.size + ' archivo(s) de codigo + manifiesto ' + (remoto.manifiesto === null ? 'AUSENTE' : 'presente') + '.');
    if (cruce.length) {
      fs.writeFileSync(path.join(p.remotoDir, '.CRUZADO'), cruce.join('\n') + '\n', 'utf8');
      cruce.forEach((m) => out('ABORTADO — PROYECTOS CRUZADOS: ' + m));
      return 2;
    }
    out('Listo. Siguiente: npm run gas:diff:' + nombre);
    return 0;
  }

  function abortarSiInseguro(p) {
    const s = seguridadGit(p);
    if (s.errores.length) { throw new L.ErrorGas('chequeo de seguridad de git:\n  - ' + s.errores.join('\n  - ')); }
  }

  function cmdStatus(nombre) {
    const p = cargarProyecto(nombre, true);
    const local = leerLocal(p.src);
    const g = infoGit(p);
    const s = seguridadGit(p);
    let codigoSalida = 0;
    out('=== gas:status ' + nombre + ' (' + p.def.titulo + ') ===');
    out('Carpeta: ' + rel(p.src) + ' | usuario clasp: ' + p.def.usuario);
    out('Archivos de codigo a sincronizar (derivados del filesystem): ' + local.codigo.size + ' | manifiesto ' + L.MANIFIESTO + ': ' + (local.manifiesto === null ? 'AUSENTE (se trae del remoto con gas:pull, se revisa y se copia a mano)' : 'presente'));
    out('Archivos versionados en git dentro de ' + rel(p.src) + ': ' + g.versionados + ' | en el filesystem: ' + g.enFilesystem + (g.versionados === g.enFilesystem ? ' (coinciden)' : ' (DIFIEREN: ver abajo)'));
    if (g.sinVersionar.length) { out('  Sin versionar (en filesystem, no en git): ' + g.sinVersionar.join(', ')); }
    if (g.versionadosAusentes.length) { out('  Versionados que faltan en el filesystem: ' + g.versionadosAusentes.join(', ')); }
    if (g.sucio.length) { out('  Cambios sin commitear en ' + rel(p.src) + ': ' + g.sucio.length); }
    if (local.extras.length) { out('BLOQUEANTE: archivos NO permitidos dentro de ' + rel(p.src) + ': ' + local.extras.join(', ')); codigoSalida = 2; }
    if (!p.cfg.existe) {
      out('AVISO: falta ' + def0(p) + '/.clasp.json (copiá el .example y pegá el scriptId). Sin eso no se puede hacer pull.');
    } else if (p.cfg.errores && p.cfg.errores.length) {
      out('BLOQUEANTE: ' + def0(p) + '/.clasp.json: ' + p.cfg.errores.join('; ')); codigoSalida = 2;
    } else {
      out('.clasp.json: scriptId ' + L.ultimos(p.scriptId) + ', rootDir "src" (ok)');
      const r = tryClaspStatus(p, local);
      if (r) { out(r); }
    }
    s.errores.forEach((e) => { out('BLOQUEANTE de seguridad: ' + e); codigoSalida = 2; });
    const ids = idsDeAmbos();
    if (ids.main && ids.storage && ids.main === ids.storage) { out('BLOQUEANTE: main y storage tienen el MISMO scriptId'); codigoSalida = 2; }
    const comunes = Array.from(local.codigo.keys()).filter((n) => nombresAjenos(nombre).has(n));
    if (comunes.length) { out('AVISO: hay nombres de archivo que existen en AMBOS proyectos: ' + comunes.join(', ')); }
    const est = leerEstado(p);
    out('Estado adoptado: ' + (est ? 'si (' + est.adoptadoEn + ', git ' + est.gitHead + (est.ultimoPush ? ', ultimo push ' + est.ultimoPush.en : '') + ')' : 'ninguno todavia'));
    lineasOperaciones(est).forEach((l) => out(l));
    const rv = revertidoSegunUltimoPull(p, est);
    if (rv.length) { rv.forEach((l) => out(l)); }
    out(describirConfigLocal(nombre));
    out(codigoSalida === 0 ? 'OK (sin bloqueantes locales).' : 'Hay bloqueantes.');
    return codigoSalida;
  }

  function def0(p) { return p.def.carpeta; }

  // status no llama a Google: usa el ultimo pull guardado en .gas-remote/<proyecto> (si existe) para avisar si el remoto quedo revertido.
  function revertidoSegunUltimoPull(p, est) {
    if (!est || !est.ultimoPush || !fs.existsSync(p.remotoDir)) { return []; }
    try {
      const remoto = leerRemoto(p.remotoDir);
      if (!remoto.codigo.size) { return []; }
      let cuando = '';
      try { cuando = JSON.parse(fs.readFileSync(path.join(p.remotoDir, '.gas-meta.json'), 'utf8')).traidoEn || ''; } catch (e) { cuando = ''; }
      const r = evaluarProyecto(p, remoto);
      return avisoRevertido(est, r.ev, r.remoto, 'según el último pull' + (cuando ? ' del ' + cuando : '') + '; para confirmarlo: gas:diff');
    } catch (e) {
      return [];
    }
  }

  // Contrasta lo que clasp subiria (show-file-status, solo local) con nuestro inventario: valida la semantica de ignorado de clasp y detecta
  // archivos locales que NO se subirian o archivos inesperados que SI.
  function consultarClaspStatus(p, local) {
    try {
      const r = clasp(['show-file-status', '--json', '--user', p.def.usuario], { cwd: path.join(raiz, p.def.carpeta) });
      if (r.codigo !== 0) { return { reconocido: false, motivo: 'no se pudo consultar (' + L.enmascarar((r.stderr || r.stdout).trim().split(/\r?\n/)[0], [p.scriptId]).slice(0, 160) + ')' }; }
      const deClasp = L.extraerArchivosDeStatus(r.stdout);
      if (!deClasp.length) { return { reconocido: false, motivo: 'formato no reconocido' }; }
      const propios = Array.from(local.codigo.keys()).concat(local.manifiesto === null ? [] : [L.MANIFIESTO]).sort();
      const faltan = propios.filter((n) => deClasp.indexOf(n) === -1);
      const sobran = deClasp.filter((n) => propios.indexOf(n) === -1);
      return { reconocido: true, coincide: !faltan.length && !sobran.length, faltan: faltan, sobran: sobran, total: deClasp.length };
    } catch (e) {
      return { reconocido: false, motivo: e.message };
    }
  }

  function tryClaspStatus(p, local) {
    const c = consultarClaspStatus(p, local);
    if (!c.reconocido) { return 'clasp show-file-status: ' + c.motivo + '; se omite el contraste'; }
    if (c.coincide) { return 'clasp subiria exactamente estos ' + c.total + ' archivo(s): coincide con el inventario local.'; }
    return 'ATENCION: lo que clasp subiria NO coincide con el inventario local. Solo en clasp: ' + (c.sobran.join(', ') || '-') + ' | solo en el inventario: ' + (c.faltan.join(', ') || '-');
  }

  function cmdDiff(nombre, o) {
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    let remoto;
    if (o['sin-pull']) {
      if (!fs.existsSync(p.remotoDir)) { throw new L.ErrorGas('no hay pull previo en ' + rel(p.remotoDir) + ' (correr sin --sin-pull)'); }
      remoto = leerRemoto(p.remotoDir);
      out('(usando el pull existente de ' + rel(p.remotoDir) + ')');
    } else {
      out('Trayendo "' + p.def.titulo + '" (' + L.ultimos(p.scriptId) + ') a ' + rel(p.remotoDir) + ' (SOLO LECTURA)…');
      remoto = pullProyecto(p);
    }
    const r = evaluarProyecto(p, remoto);
    marcarCruce(p, r.ev);
    const ev = r.ev;
    const maxLineas = parseInt(o.lineas, 10) > 0 ? parseInt(o.lineas, 10) : 40;
    const maxArchivos = parseInt(o['max-archivos'], 10) > 0 ? parseInt(o['max-archivos'], 10) : 10;
    out('');
    out('=== gas:diff ' + nombre + ' (' + p.def.titulo + ') ===');
    out('Local  (' + rel(p.src) + '): ' + r.local.codigo.size + ' archivo(s) de codigo | manifiesto ' + (r.local.manifiesto === null ? 'AUSENTE' : 'presente'));
    out('Remoto (' + rel(p.remotoDir) + '): ' + r.remoto.codigo.size + ' archivo(s) de codigo | manifiesto ' + (r.remoto.manifiesto === null ? 'AUSENTE' : 'presente'));
    out('Identicos: ' + ev.cmp.identicos.length + ' | Modificados: ' + ev.cmp.modificados.length + ' | Solo local (se agregarian): ' + ev.cmp.soloLocal.length + ' | Solo remoto (un push los BORRARIA): ' + ev.cmp.soloRemoto.length);
    lista('Solo remoto', ev.cmp.soloRemoto);
    lista('Solo local', ev.cmp.soloLocal);
    lista('Modificados', ev.cmp.modificados);
    out('Manifiesto ' + L.MANIFIESTO + ': ' + ev.manifiesto);
    imprimirResumenManifiesto(ev.resumenLocal, 'local ');
    imprimirResumenManifiesto(ev.resumenRemoto, 'remoto');
    if (ev.deriva) { out('Estado adoptado: ' + (ev.deriva.hayDeriva ? 'el remoto CAMBIO desde la adopcion' : 'el remoto coincide con lo adoptado')); } else { out('Estado adoptado: ninguno todavia (gas:adopt)'); }
    const estadoDiff = leerEstado(p);
    lineasOperaciones(estadoDiff).forEach((l) => out(l));
    avisoRevertido(estadoDiff, ev, r.remoto, '').forEach((l) => out(l));
    out('Git: ' + (r.git.head ? 'HEAD ' + r.git.head : 'sin HEAD') + ' | ' + rel(p.src) + ': ' + (r.git.sucio.length ? r.git.sucio.length + ' cambio(s) sin commitear' : 'limpio'));
    ev.cmp.modificados.slice(0, maxArchivos).forEach((n) => {
      const d = generarDiff(rel(r.remoto.rutas.get(n)), rel(path.join(p.src, n))).split(/\r?\n/);
      out('');
      out('--- ' + n + ' (- remoto / + local)');
      out(d.slice(0, maxLineas).join('\n') + (d.length > maxLineas ? '\n  … (' + (d.length - maxLineas) + ' linea(s) mas; --lineas N para ver mas)' : ''));
    });
    if (ev.cmp.modificados.length > maxArchivos) { out('\n… ' + (ev.cmp.modificados.length - maxArchivos) + ' archivo(s) modificado(s) mas (--max-archivos N)'); }
    out('');
    ev.advertencias.forEach((a) => out('ADVERTENCIA: ' + a));
    ev.bloqueantes.forEach((b) => out('BLOQUEANTE: ' + b));
    out(ev.bloqueantes.length ? 'Resultado: CON BLOQUEANTES (' + ev.bloqueantes.length + ').' : 'Resultado: sin bloqueantes.');
    out('Huella del diff: ' + ev.huella);
    out('Para adoptar este estado remoto revisado (solo registro local):  npm run gas:adopt:' + nombre + ' -- --confirmar-huella ' + ev.huella.slice(0, 16));
    return ev.bloqueantes.length ? 2 : 0;
  }

  function cmdAdopt(nombre, o) {
    if (typeof o['confirmar-huella'] !== 'string') { throw new L.ErrorGas('adopt exige --confirmar-huella <hex> (copiala de la salida de gas:diff:' + nombre + ')'); }
    const descartar = typeof o.descartar === 'string' ? o.descartar.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    out('Trayendo "' + p.def.titulo + '" para verificar la huella (SOLO LECTURA)…');
    const remoto = pullProyecto(p);
    const r = evaluarProyecto(p, remoto);
    marcarCruce(p, r.ev);
    if (!L.huellaCoincide(r.ev.huella, o['confirmar-huella'])) {
      out('ABORTADO: la huella no coincide con el estado actual (cambio el local o el remoto desde el diff). Volvé a correr gas:diff:' + nombre + ' y revisalo.');
      return 2;
    }
    const faltas = L.condicionesAdopcion(r.ev, r.local.extras, descartar);
    if (faltas.length) {
      out('ABORTADO: no se puede adoptar todavia:');
      faltas.forEach((f) => out('  - ' + f));
      return 2;
    }
    const archivos = {};
    Array.from(r.remoto.codigo.keys()).sort().forEach((n) => { archivos[n] = r.remoto.codigo.get(n); });
    const estado = {
      version: 1, proyecto: nombre, adoptadoEn: ahora().toISOString(), huella: r.ev.huella, gitHead: r.git.head, descartados: descartar,
      remoto: { archivos: archivos, manifiestoSha: L.hashManifiesto(r.remoto.manifiesto) }
    };
    fs.mkdirSync(path.join(raiz, '.gas-state'), { recursive: true });
    fs.writeFileSync(archivoEstado(nombre), JSON.stringify(estado, null, 2) + '\n', 'utf8');
    out('Adopcion registrada SOLO localmente en ' + rel(archivoEstado(nombre)) + ' (' + r.remoto.codigo.size + ' archivo(s) remotos + manifiesto). No se escribio nada en Apps Script.');
    if (descartar.length) { out('Archivos solo-remotos reconocidos como descartables en un futuro push: ' + descartar.join(', ')); }
    return 0;
  }

  // ---------------------------------------------------------------- configuracion local (.gas.local.json, ignorada por git)
  const archivoConfigLocal = path.join(raiz, '.gas.local.json');

  function leerConfigLocal() {
    if (!fs.existsSync(archivoConfigLocal)) {
      throw new L.ErrorGas('Falta .gas.local.json. Copiá .gas.local.json.example a .gas.local.json (queda solo en tu PC: esta en .gitignore) y completalo.');
    }
    let obj;
    try { obj = JSON.parse(fs.readFileSync(archivoConfigLocal, 'utf8')); } catch (e) { throw new L.ErrorGas('.gas.local.json no es JSON valido'); }
    const v = L.validarConfigLocal(obj);
    if (!v.ok) { throw new L.ErrorGas('.gas.local.json: ' + v.errores.join('; ')); }
    return obj;
  }

  function describirConfigLocal(nombre) {
    try {
      const c = leerConfigLocal()[nombre];
      return 'Config local (.gas.local.json): pushHabilitado=' + c.pushHabilitado + ' | deploymentId ' + (c.deploymentId.trim() ? 'configurado (' + L.ultimos(c.deploymentId.trim()) + ')' : 'VACIO (hace falta para gas:deploy)');
    } catch (e) {
      return 'Config local (.gas.local.json): ' + e.message.replace(/^ERROR: /, '');
    }
  }

  function escribirEstado(p, estado) {
    fs.mkdirSync(path.join(raiz, '.gas-state'), { recursive: true });
    const destino = archivoEstado(p.nombre);
    fs.writeFileSync(destino + '.tmp', JSON.stringify(estado, null, 2) + '\n', 'utf8');
    fs.renameSync(destino + '.tmp', destino);
  }

  // "Arbol limpio": sin cambios en archivos versionados (en cualquier parte) y sin archivos nuevos dentro de la carpeta del proyecto.
  // Carpetas ajenas sin versionar (por ejemplo Cuencas/) no cuentan: no forman parte de lo que se sube.
  function cambiosSinCommitear(p) {
    const versionados = git(['status', '--porcelain', '--untracked-files=no']).stdout.split(/\r?\n/).filter(Boolean);
    const delProyecto = git(['status', '--porcelain', '--', p.def.carpeta]).stdout.split(/\r?\n/).filter(Boolean);
    return Array.from(new Set(versionados.concat(delProyecto)));
  }

  function exigirArbolLimpio(p, o, accion) {
    const sucios = cambiosSinCommitear(p);
    if (!sucios.length) { return true; }
    if (o['permitir-sucio'] === true) {
      out('ADVERTENCIA: --permitir-sucio: se sigue con cambios sin commitear (' + sucios.length + '); lo que se sube NO queda registrado en un commit.');
      return true;
    }
    out('ABORTADO: el arbol git NO esta limpio (' + sucios.length + ' cambio(s) sin commitear: ' + sucios.slice(0, 5).map((l) => l.trim()).join('; ') + (sucios.length > 5 ? '; …' : '') + ').');
    out('Hacé commit antes de ' + accion + ' (lo que se sube tiene que ser lo versionado). Escape explicito: --permitir-sucio.');
    return false;
  }

  function prepararDestino(nombre, sufijo) {
    const base = path.resolve(raiz, '.gas-remote');
    const destino = path.resolve(base, nombre + sufijo);
    if (!L.PROYECTOS[nombre] || !/^-v[1-9][0-9]{0,5}$/.test(sufijo) || !destino.startsWith(base + path.sep)) { throw new L.ErrorGas('ruta de destino invalida'); }
    fs.rmSync(destino, { recursive: true, force: true });
    fs.mkdirSync(destino, { recursive: true });
    return destino;
  }

  function listarDeployments(p) {
    const r = clasp(['list-deployments', '--user', p.def.usuario], { cwd: path.join(raiz, p.def.carpeta) });
    if (r.codigo !== 0) { throw new L.ErrorGas('clasp list-deployments fallo: ' + L.enmascarar((r.stderr || r.stdout).trim(), [p.scriptId]).slice(0, 300) + pistaDeError(r.stderr + r.stdout)); }
    return L.parsearDeployments(r.stdout);
  }

  function listarVersiones(p) {
    const r = clasp(['list-versions', '--user', p.def.usuario], { cwd: path.join(raiz, p.def.carpeta) });
    if (r.codigo !== 0) { throw new L.ErrorGas('clasp list-versions fallo: ' + L.enmascarar((r.stderr || r.stdout).trim(), [p.scriptId]).slice(0, 300) + pistaDeError(r.stderr + r.stdout)); }
    return L.parsearVersiones(r.stdout);
  }

  function listaNombres(titulo, nombres) {
    lista(titulo, nombres);
  }

  // ---------------------------------------------------------------- push
  function cmdPush(nombre, o) {
    const huella = o['confirmar-huella'];
    if (typeof huella !== 'string' || !/^[0-9a-fA-F]{64}$/.test(huella)) {
      throw new L.ErrorGas('push exige --confirmar-huella <sha256 completo, 64 hex>: copiala de la salida de gas:diff:' + nombre);
    }
    const simular = o.simular === true;
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    const cfg = leerConfigLocal()[nombre];
    if (!simular && cfg.pushHabilitado !== true) {
      throw new L.ErrorGas('el push de "' + nombre + '" esta DESHABILITADO (.gas.local.json: ' + nombre + '.pushHabilitado = false). Revisá gas:diff:' + nombre + ' y gas:status:' + nombre + '; recién entonces ponelo en true. Para ensayar todo sin subir nada: agregar --simular.');
    }
    if (!exigirArbolLimpio(p, o, 'subir')) { return 2; }

    out('Trayendo "' + p.def.titulo + '" (' + L.ultimos(p.scriptId) + ') antes de cualquier escritura (SOLO LECTURA)…');
    const remoto = pullProyecto(p);
    const r = evaluarProyecto(p, remoto);
    marcarCruce(p, r.ev);
    if (r.ev.cruce.length) {
      r.ev.cruce.forEach((m) => out('ABORTADO — PROYECTOS CRUZADOS: ' + m));
      out('No se escribio nada en Apps Script.');
      return 2;
    }
    if (r.ev.huella.toLowerCase() !== huella.toLowerCase()) {
      out('ABORTADO: la huella NO coincide con el estado actual (cambio el repo o el remoto desde el diff). Volvé a correr gas:diff:' + nombre + ', revisalo y usá la huella nueva.');
      return 2;
    }
    const estado = leerEstado(p);
    avisoRevertido(estado, r.ev, r.remoto, '').forEach((l) => out(l));
    const pe = L.evaluarPush({
      ev: r.ev, estado: estado, extras: r.local.extras, cantidadLocal: r.local.codigo.size,
      permitirManifest: o['permitir-manifest'] === true, clasp: consultarClaspStatus(p, r.local)
    });
    out('');
    out('=== gas:push ' + nombre + ' (' + p.def.titulo + ')' + (simular ? ' — SIMULACION' : '') + ' ===');
    out('Se agregarian (' + pe.agregados.length + '), se modificarian (' + pe.modificados.length + '), se ELIMINARIAN del remoto (' + pe.eliminados.length + '); sin cambios: ' + pe.identicos.length + '.');
    listaNombres('Agregados', pe.agregados);
    listaNombres('Modificados', pe.modificados);
    listaNombres('Eliminados (aprobados para descarte)', pe.eliminados);
    if (o['permitir-manifest'] === true && r.ev.manifiesto === 'distinto') { out('ADVERTENCIA: --permitir-manifest: se reemplaza ' + L.MANIFIESTO + ' remoto.'); }
    if (pe.bloqueantes.length) {
      pe.bloqueantes.forEach((b) => out('BLOQUEANTE: ' + b));
      out('ABORTADO: no se escribio nada en Apps Script.');
      return 2;
    }
    if (simular) {
      out('SIMULACION completa: todas las guardas pasaron. No se subio nada. Para subir de verdad: pushHabilitado=true en .gas.local.json y repetir sin --simular.');
      return 0;
    }

    const destinoPush = erroresDestinoEscritura(p);
    if (destinoPush.length) {
      destinoPush.forEach((m) => out('ABORTADO — DESTINO DE ESCRITURA INVALIDO: ' + m));
      out('No se escribio nada en Apps Script.');
      return 2;
    }
    const firmaPrevia = L.firmaRemoto(r.remoto.codigo, r.remoto.manifiesto);
    out('Subiendo con clasp push (reemplaza el contenido remoto por el del repo; sin --force)…');
    const rp = claspEscritura(p, ['push', '--user', p.def.usuario]);
    if (rp.codigo !== 0) {
      out('ERROR: clasp push fallo (codigo ' + rp.codigo + '): ' + L.enmascarar((rp.stderr || rp.stdout).trim(), [p.scriptId]).slice(0, 400) + pistaDeError(rp.stderr + rp.stdout));
      out('El estado remoto es INCIERTO: verificalo con npm run gas:diff:' + nombre + '. El estado adoptado no se actualizo.');
      return 3;
    }

    out('Verificando: trayendo el remoto de nuevo (SOLO LECTURA)…');
    const remoto2 = pullProyecto(p);
    const r2 = evaluarProyecto(p, remoto2);
    const v = L.verificarPostPush(r2.ev);
    if (!v.ok) {
      out('ATENCION: DESPUES del push el remoto NO coincide con el repo:');
      v.problemas.forEach((m) => out('  - ' + m));
      out('El estado adoptado NO se actualizo. Revisá con npm run gas:diff:' + nombre + '.');
      return 3;
    }
    const archivos = {};
    Array.from(r2.remoto.codigo.keys()).sort().forEach((n) => { archivos[n] = r2.remoto.codigo.get(n); });
    escribirEstado(p, {
      version: 1, proyecto: nombre, adoptadoEn: (estado && estado.adoptadoEn) || ahora().toISOString(), sincronizadoEn: ahora().toISOString(), huella: r2.ev.huella,
      gitHead: r2.git.head, descartados: [], remoto: { archivos: archivos, manifiestoSha: L.hashManifiesto(r2.remoto.manifiesto) },
      ultimaVersion: estado && estado.ultimaVersion ? estado.ultimaVersion : undefined,
      ultimoPush: { en: ahora().toISOString(), huellaPrevia: huella.toLowerCase(), remotoPrevio: firmaPrevia, gitHead: r2.git.head, agregados: pe.agregados, modificados: pe.modificados, eliminados: pe.eliminados }
    });
    out('PUSH VERIFICADO: el remoto quedo identico al repo (' + r2.remoto.codigo.size + ' archivo(s) + manifiesto).');
    out('  Agregados (' + pe.agregados.length + '): ' + (pe.agregados.join(', ') || '-'));
    out('  Modificados (' + pe.modificados.length + '): ' + (pe.modificados.join(', ') || '-'));
    out('  Eliminados (' + pe.eliminados.length + '): ' + (pe.eliminados.join(', ') || '-'));
    out('Estado adoptado actualizado en ' + rel(archivoEstado(nombre)) + '. Esto NO cambia lo desplegado. Siguiente: npm run gas:version:' + nombre + ' -- --descripcion "..."');
    return 0;
  }

  // ---------------------------------------------------------------- version
  function cmdVersion(nombre, o) {
    const desc = typeof o.descripcion === 'string' ? o.descripcion.trim() : '';
    if (!desc) { throw new L.ErrorGas('version exige --descripcion "<texto>" (queda registrada en la version)'); }
    if (desc.length > L.DESCRIPCION_MAX || desc.startsWith('-')) { throw new L.ErrorGas('la descripcion debe tener entre 1 y ' + L.DESCRIPCION_MAX + ' caracteres y no empezar con "-"'); }
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    const estado = leerEstado(p);
    if (!estado) { throw new L.ErrorGas('el proyecto no esta adoptado (gas:diff + gas:adopt): no se crean versiones sobre un estado no revisado'); }
    if (!exigirArbolLimpio(p, o, 'crear una version')) { return 2; }

    out('Trayendo "' + p.def.titulo + '" para verificar que el remoto coincide con el repo (SOLO LECTURA)…');
    const r = evaluarProyecto(p, pullProyecto(p));
    marcarCruce(p, r.ev);
    const v = L.verificarPostPush(r.ev);
    const problemas = v.problemas.concat(r.ev.cruce.map((m) => 'PROYECTOS CRUZADOS: ' + m), r.local.extras.length ? ['archivos no permitidos en src: ' + r.local.extras.join(', ')] : []);
    if (problemas.length) {
      out('ABORTADO: no se crea la version: una version congela el HEAD remoto y este NO coincide con el repo:');
      problemas.forEach((m) => out('  - ' + m));
      out('Corré gas:push primero (y revisá gas:diff:' + nombre + ').');
      return 2;
    }
    const firmaAntes = L.firmaRemoto(r.remoto.codigo, r.remoto.manifiesto);     // HEAD verificado == repo justo antes de crear la version
    const destinoVersion = erroresDestinoEscritura(p);
    if (destinoVersion.length) {
      destinoVersion.forEach((m) => out('ABORTADO — DESTINO DE ESCRITURA INVALIDO: ' + m));
      out('No se escribio nada en Apps Script.');
      return 2;
    }
    const antes = L.maximaVersion(listarVersiones(p));
    out('Creando version (sin desplegar nada)…');
    const rc = claspEscritura(p, ['create-version', desc, '--user', p.def.usuario]);
    if (rc.codigo !== 0) {
      out('ERROR: clasp create-version fallo (codigo ' + rc.codigo + '): ' + L.enmascarar((rc.stderr || rc.stdout).trim(), [p.scriptId]).slice(0, 300) + pistaDeError(rc.stderr + rc.stdout));
      return 3;
    }
    const despues = L.maximaVersion(listarVersiones(p));
    const informada = L.parsearVersionCreada(rc.stdout);
    const creada = informada !== null ? informada : despues;
    const numeroOk = despues > antes && creada === despues;
    out('Verificando que HEAD siga igual al repo despues de crear la version (SOLO LECTURA)…');
    const h = inspeccionarHead(p, firmaAntes);
    if (!numeroOk) {
      out('ATENCION: no se pudo confirmar el numero de la version creada (antes ' + antes + ', despues ' + despues + ', informada ' + informada + '). Revisá con npm run gas:deployments:' + nombre + '.');
      if (!headOk(h)) { out('Ademas, HEAD NO esta como se esperaba:'); describirHead(h).forEach((l) => out(l)); }
      return 3;
    }
    const registro = { numero: creada, descripcion: desc, en: ahora().toISOString(), gitHead: r.git.head, headConsistente: headOk(h) };
    if (!headOk(h)) { registro.headProblemas = describirHead(h).map((l) => l.replace(/^ {2}- /, '')); }
    escribirEstado(p, Object.assign({}, estado, { ultimaVersion: registro }));
    if (!headOk(h)) {
      out('VERSION CREADA: ' + creada + ' ("' + desc + '") — pero HEAD quedo INCONSISTENTE.');
      out('  La version ' + creada + ' EXISTE y no se desplego nada. Su contenido no se pudo dar por bueno aqui: gas:deploy la compara contra el repo antes de desplegarla.');
      out('HEAD remoto actual NO coincide con el repo:');
      describirHead(h).forEach((l) => out(l));
      if (h.ev && h.remoto) { avisoRevertido(estado, h.ev, h.remoto, '').forEach((l) => out(l)); }
      out('No hagas push, version ni deploy hasta revisarlo: npm run gas:diff:' + nombre + '. Salida con codigo 3.');
      return 3;
    }
    out('HEAD sigue idéntico al repo.');
    out('VERSION CREADA: ' + creada + ' ("' + desc + '"). No se desplego nada: los deployments siguen en la version que tenian.');
    out('Siguiente: npm run gas:deploy:' + nombre + ' -- --version ' + creada);
    return 0;
  }

  // ---------------------------------------------------------------- deploy
  function pullVersion(p, numero) {
    const destino = prepararDestino(p.nombre, '-v' + numero);
    fs.writeFileSync(path.join(destino, '.clasp.json'), JSON.stringify({ scriptId: p.scriptId }, null, 2) + '\n', 'utf8');
    const r = clasp(['pull', '--versionNumber', String(numero), '--user', p.def.usuario], { cwd: destino });
    if (r.codigo !== 0) { throw new L.ErrorGas('no se pudo traer la version ' + numero + ' para compararla (clasp pull fallo): ' + L.enmascarar((r.stderr || r.stdout).trim(), [p.scriptId]).slice(0, 300)); }
    return leerRemoto(destino);
  }

  function cmdDeploy(nombre, o) {
    if (!/^[1-9][0-9]{0,5}$/.test(String(o.version))) { throw new L.ErrorGas('deploy exige --version <numero de version> (creala antes con gas:version:' + nombre + ')'); }
    const version = parseInt(o.version, 10);
    let descripcion = 'Version ' + version + ' (gas:deploy)';
    if (o.descripcion !== undefined) {
      if (typeof o.descripcion !== 'string' || !o.descripcion.trim() || o.descripcion.trim().length > L.DESCRIPCION_MAX || o.descripcion.trim().startsWith('-')) { throw new L.ErrorGas('--descripcion invalida (1 a ' + L.DESCRIPCION_MAX + ' caracteres, sin empezar con "-")'); }
      descripcion = o.descripcion.trim();
    }
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    const config = leerConfigLocal();
    const deploymentId = config[nombre].deploymentId.trim();
    if (!deploymentId) { throw new L.ErrorGas('falta ' + nombre + '.deploymentId en .gas.local.json: elegi el deployment NUMERADO de produccion con npm run gas:deployments:' + nombre + ' y copiá su ID completo (npx clasp list-deployments --user ' + p.def.usuario + ' lo muestra sin enmascarar).'); }
    const otroId = config[otroProyecto(nombre)].deploymentId.trim();

    const despliegues = listarDeployments(p);
    const versiones = listarVersiones(p);
    const ev = L.evaluarDeploy({ despliegues: despliegues, versiones: versiones, deploymentId: deploymentId, otroDeploymentId: otroId, version: version, permitirRetroceso: o['permitir-retroceso'] === true });
    out('=== gas:deploy ' + nombre + ' (' + p.def.titulo + ') ===');
    out('Deployment ' + L.ultimos(deploymentId) + ': ' + (ev.encontrado ? (ev.head ? '@HEAD (pruebas)' : 'version actual ' + ev.actual) : 'NO figura en este proyecto') + '  ->  pasaria a la version ' + version + '.');
    if (ev.errores.length) {
      ev.errores.forEach((e) => out('BLOQUEANTE: ' + e));
      out('ABORTADO: no se modifico ningun deployment.');
      return 2;
    }
    // La version que se publica tiene que ser lo que esta en el repo (evita desplegar una version vieja o equivocada).
    const local = leerLocal(p.src);
    const rv = pullVersion(p, version);
    const cmp = L.compararInventarios(local.codigo, rv.codigo);
    const manif = L.compararManifiestos(local.manifiesto, rv.manifiesto);
    const igualAlRepo = !cmp.soloLocal.length && !cmp.soloRemoto.length && !cmp.modificados.length && manif === 'igual';
    if (!igualAlRepo) {
      const dif = [].concat(cmp.modificados, cmp.soloLocal.map((n) => n + ' (falta en la version)'), cmp.soloRemoto.map((n) => n + ' (sobra en la version)'), manif === 'igual' ? [] : [L.MANIFIESTO]);
      out('La version ' + version + ' NO coincide con el repo local: ' + dif.slice(0, 8).join(', ') + (dif.length > 8 ? ', …' : ''));
      if (o['permitir-distinta'] !== true) {
        out('ABORTADO: no se modifico ningun deployment. (Si es una reversion deliberada a una version vieja: --permitir-distinta.)');
        return 2;
      }
      out('ADVERTENCIA: --permitir-distinta: se despliega una version que difiere del repo.');
    } else {
      out('La version ' + version + ' coincide exactamente con el repo local.');
    }
    out('Verificando HEAD antes del deploy (SOLO LECTURA)…');
    const hAntes = inspeccionarHead(p);
    const permitirHead = o['permitir-head-distinto'] === true;
    if (headOk(hAntes)) {
      out('HEAD coincide con el repo.');
    } else {
      out('HEAD remoto NO coincide con el repo (antes del deploy):');
      describirHead(hAntes).forEach((l) => out(l));
      if (hAntes.ev && hAntes.remoto) { avisoRevertido(leerEstado(p), hAntes.ev, hAntes.remoto, '').forEach((l) => out(l)); }
      if (!permitirHead) {
        out('ABORTADO: no se modifico ningun deployment. HEAD inconsistente = alguien modifico el proyecto fuera de este flujo: revisá npm run gas:diff:' + nombre + '. (Un deployment versionado no depende de HEAD; si igual queres desplegar: --permitir-head-distinto.)');
        return 3;
      }
      out('ADVERTENCIA: --permitir-head-distinto: se despliega con HEAD distinto del repo.');
    }
    const token = L.confirmacionDeploy(version, deploymentId);
    if (o['confirmar-despliegue'] !== token) {
      out('Para confirmar este cambio en PRODUCCION, repetir el comando agregando:  --confirmar-despliegue ' + token);
      out('(No se modifico nada.)');
      return 2;
    }
    out('Actualizando el deployment (update-deployment; no se crea ninguno nuevo)…');
    const destinoDeploy = erroresDestinoEscritura(p);
    if (destinoDeploy.length) {
      destinoDeploy.forEach((m) => out('ABORTADO — DESTINO DE ESCRITURA INVALIDO: ' + m));
      out('No se modifico ningun deployment.');
      return 2;
    }
    const rd = claspEscritura(p, ['update-deployment', deploymentId, '-V', String(version), '-d', descripcion, '--user', p.def.usuario]);
    if (rd.codigo !== 0) {
      out('ERROR: clasp update-deployment fallo (codigo ' + rd.codigo + '): ' + L.enmascarar((rd.stderr || rd.stdout).trim(), [p.scriptId, deploymentId]).slice(0, 300) + pistaDeError(rd.stderr + rd.stdout));
      out('Verificá el estado con npm run gas:deployments:' + nombre + '.');
      return 3;
    }
    out('Verificando el deployment y HEAD despues del deploy (SOLO LECTURA)…');
    const hDespues = inspeccionarHead(p, hAntes.firma);
    const despues = listarDeployments(p).find((d) => d.id === deploymentId);
    if (!despues || despues.head || despues.version !== version) {
      out('ATENCION: no se pudo confirmar que el deployment quedo en la version ' + version + ' (ahora: ' + (despues ? (despues.head ? '@HEAD' : despues.version) : 'no figura') + '). El deployment PUEDE haber cambiado: verificá con npm run gas:deployments:' + nombre + '.');
      if (!headOk(hDespues)) { out('Ademas, HEAD NO esta como se esperaba:'); describirHead(hDespues).forEach((l) => out(l)); }
      return 3;
    }
    const estado = leerEstado(p);
    const headMalo = !hDespues.verificable || hDespues.cambio || (hDespues.problemasRepo.length > 0 && !permitirHead);
    if (estado) { escribirEstado(p, Object.assign({}, estado, { ultimoDeploy: { version: version, anterior: ev.actual, en: ahora().toISOString(), deployment: L.ultimos(deploymentId), headConsistente: !headMalo && !hDespues.problemasRepo.length } })); }
    if (headMalo) {
      out('DEPLOY APLICADO Y VERIFICADO: el deployment ' + L.ultimos(deploymentId) + ' paso de la version ' + ev.actual + ' a la ' + version + '. La URL /exec no cambia.');
      out('PERO HEAD quedo INCONSISTENTE (esto es aparte del deployment, que SI quedo actualizado):');
      describirHead(hDespues).forEach((l) => out(l));
      if (hDespues.ev && hDespues.remoto) { avisoRevertido(estado, hDespues.ev, hDespues.remoto, '').forEach((l) => out(l)); }
      out('No hagas push ni version hasta revisarlo: npm run gas:diff:' + nombre + '. Salida con codigo 3.');
      return 3;
    }
    out('DEPLOY VERIFICADO: el deployment ' + L.ultimos(deploymentId) + ' paso de la version ' + ev.actual + ' a la ' + version + '. La URL /exec no cambia.');
    if (hDespues.problemasRepo.length) { out('ADVERTENCIA: HEAD sigue distinto del repo (igual que antes del deploy; --permitir-head-distinto).'); } else { out('HEAD sigue idéntico al repo y no cambió durante el deploy.'); }
    return 0;
  }

  // ---------------------------------------------------------------- deployments (solo lectura)
  function cmdDeployments(nombre, o) {
    const p = cargarProyecto(nombre, false);
    abortarSiInseguro(p);
    const despliegues = listarDeployments(p);
    const versiones = listarVersiones(p);
    let configurado = '';
    let aviso = '';
    try { configurado = leerConfigLocal()[nombre].deploymentId.trim(); } catch (e) { aviso = e.message; }
    let enApi = '';
    if (nombre === 'main') {
      try { const m = /macros\/s\/([A-Za-z0-9_-]+)\/exec/.exec(fs.readFileSync(path.join(raiz, 'js', 'api.js'), 'utf8')); enApi = m ? m[1] : ''; } catch (e) { enApi = ''; }
    }
    const mostrar = o['mostrar-ids'] === true;
    out('=== gas:deployments ' + nombre + ' (' + p.def.titulo + ') — SOLO LECTURA ===');
    out('Versiones: ' + versiones.length + ' (la ultima: ' + L.maximaVersion(versiones) + ')');
    despliegues.forEach((d) => {
      const marcas = [];
      if (d.head) { marcas.push('@HEAD = deployment de PRUEBAS (/dev): NO es un destino productivo'); } else { marcas.push('version numerada ' + d.version); }
      if (configurado && configurado === d.id) { marcas.push('configurado en .gas.local.json'); }
      if (enApi && enApi === d.id) { marcas.push('coincide con la URL /exec de js/api.js (PRODUCCION)'); }
      out('  - ' + (mostrar ? d.id : L.ultimos(d.id)) + ' | ' + marcas.join(' | '));
    });
    if (aviso) { out('Config local: ' + aviso); } else if (!configurado) { out('Config local: ' + nombre + '.deploymentId esta VACIO: completalo con el ID del deployment numerado de produccion.'); } else if (!despliegues.some((d) => d.id === configurado)) { out('ATENCION: el deploymentId configurado NO figura entre los deployments de este proyecto.'); }
    if (nombre === 'storage') { out('Nota: el deploymentId del storage forma parte de su URL secreta: no lo pegues en chats ni en git.'); }
    return 0;
  }

  // ---------------------------------------------------------------- opciones
  const OPCIONES = {
    pull: [], status: [], diff: ['lineas', 'max-archivos', 'sin-pull'], adopt: ['confirmar-huella', 'descartar'], deployments: ['mostrar-ids'],
    push: ['confirmar-huella', 'simular', 'permitir-sucio', 'permitir-manifest'], version: ['descripcion', 'permitir-sucio'],
    deploy: ['version', 'descripcion', 'confirmar-despliegue', 'permitir-retroceso', 'permitir-distinta', 'permitir-head-distinto']
  };
  const OPCIONES_BOOLEANAS = ['sin-pull', 'mostrar-ids', 'simular', 'permitir-sucio', 'permitir-manifest', 'permitir-retroceso', 'permitir-distinta', 'permitir-head-distinto'];

  function validarOpciones(a) {
    if (a.opciones.force !== undefined || a.opciones.f !== undefined) { throw new L.ErrorGas('no existe --force: este wrapper nunca fuerza una escritura en Apps Script'); }
    if (a.extras.length) { throw new L.ErrorGas('argumento inesperado: ' + a.extras[0]); }
    Object.keys(a.opciones).forEach((k) => {
      if (OPCIONES[a.comando].indexOf(k) === -1) { throw new L.ErrorGas('opcion desconocida para "' + a.comando + '": --' + k); }
      if (OPCIONES_BOOLEANAS.indexOf(k) !== -1 && a.opciones[k] !== true) { throw new L.ErrorGas('--' + k + ' es un flag sin valor (se uso con "' + a.opciones[k] + '")'); }
    });
  }

  function ejecutar(argv) {
    const a = L.parsearArgs(argv);
    try {
      if (!a.comando || !a.proyecto) { out(USO); return 1; }
      if (!OPCIONES[a.comando]) {
        out('Comando desconocido: ' + a.comando + '\n' + USO);
        return 1;
      }
      validarOpciones(a);
      if (a.comando === 'pull') { return cmdPull(a.proyecto); }
      if (a.comando === 'status') { return cmdStatus(a.proyecto); }
      if (a.comando === 'diff') { return cmdDiff(a.proyecto, a.opciones); }
      if (a.comando === 'adopt') { return cmdAdopt(a.proyecto, a.opciones); }
      if (a.comando === 'deployments') { return cmdDeployments(a.proyecto, a.opciones); }
      if (a.comando === 'push') { return cmdPush(a.proyecto, a.opciones); }
      if (a.comando === 'version') { return cmdVersion(a.proyecto, a.opciones); }
      if (a.comando === 'deploy') { return cmdDeploy(a.proyecto, a.opciones); }
      return 1;
    } catch (e) {
      if (e instanceof L.ErrorGas) { out('ERROR: ' + e.message); return 1; }
      throw e;
    }
  }

  // _escribirParaPruebas: solo para tests (ejercita la guarda de destino con un cwd arbitrario); nunca lo usa la CLI.
  return { ejecutar: ejecutar, _escribirParaPruebas: (nombre, args, cwd) => claspEscritura(cargarProyecto(nombre, false), args, cwd) };
}

if (require.main === module) {
  process.exitCode = crearCli({ raiz: path.resolve(__dirname, '..', '..') }).ejecutar(process.argv.slice(2));
}

module.exports = { crearCli };
