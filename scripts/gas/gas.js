#!/usr/bin/env node
'use strict';
// Wrapper de clasp para los DOS proyectos de Apps Script (main = backend/, storage = storage/). FASE DE SOLO LECTURA:
//   pull    trae el proyecto remoto a .gas-remote/<proyecto>/ (JAMAS sobre src)
//   status  inventario local derivado del filesystem + chequeos de seguridad (no consulta el remoto)
//   diff    pull + comparacion local/remoto: solo remotos, solo locales, modificados, manifiesto, huella
//   adopt   registra LOCALMENTE (.gas-state/) que se reviso el estado remoto; no escribe nada en Apps Script
// No existen push / version / deploy: el unico subcomando de clasp que este programa puede ejecutar es de lectura (ver
// gasLogic.verificarComandoClasp). Ningun scriptId ni token se versiona: .clasp.json y .clasprc.json estan en .gitignore.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const L = require('./gasLogic');

const USO = [
  'Uso: node scripts/gas/gas.js <comando> <main|storage> [opciones]   (o: npm run gas:<comando>:<main|storage> -- [opciones])',
  '  pull     trae el remoto a .gas-remote/<proyecto>/ (nunca toca src)',
  '  status   inventario local y chequeos de seguridad',
  '  diff     pull + comparacion local/remoto + huella      [--lineas N] [--max-archivos N] [--sin-pull]',
  '  adopt    registra el estado remoto revisado en .gas-state/   --confirmar-huella <hex> [--descartar a.js,b.js]'
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
  const rel = (p) => path.relative(raiz, p).split(path.sep).join('/');
  const dirRemoto = (nombre) => path.join(raiz, '.gas-remote', nombre);
  const archivoEstado = (nombre) => path.join(raiz, '.gas-state', nombre + '.json');

  // ---------------------------------------------------------------- filesystem
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
    out('Estado adoptado: ' + (est ? 'si (' + est.adoptadoEn + ', git ' + est.gitHead + ')' : 'ninguno todavia'));
    out(codigoSalida === 0 ? 'OK (sin bloqueantes locales).' : 'Hay bloqueantes.');
    return codigoSalida;
  }

  function def0(p) { return p.def.carpeta; }

  // Contrasta lo que clasp subiria (show-file-status, solo local) con nuestro inventario: valida la semantica de ignorado de clasp.
  function tryClaspStatus(p, local) {
    try {
      const r = clasp(['show-file-status', '--json', '--user', p.def.usuario], { cwd: path.join(raiz, p.def.carpeta) });
      if (r.codigo !== 0) { return 'clasp show-file-status no se pudo consultar (' + L.enmascarar((r.stderr || r.stdout).trim().split(/\r?\n/)[0], [p.scriptId]).slice(0, 160) + '): se omite el contraste'; }
      const deClasp = L.extraerArchivosDeStatus(r.stdout);
      if (!deClasp.length) { return 'clasp show-file-status: formato no reconocido, se omite el contraste'; }
      const propios = Array.from(local.codigo.keys()).concat(local.manifiesto === null ? [] : [L.MANIFIESTO]).sort();
      const faltan = propios.filter((n) => deClasp.indexOf(n) === -1);
      const sobran = deClasp.filter((n) => propios.indexOf(n) === -1);
      if (!faltan.length && !sobran.length) { return 'clasp subiria exactamente estos ' + deClasp.length + ' archivo(s): coincide con el inventario local.'; }
      return 'ATENCION: lo que clasp subiria NO coincide con el inventario local. Solo en clasp: ' + (sobran.join(', ') || '-') + ' | solo en el inventario: ' + (faltan.join(', ') || '-');
    } catch (e) {
      return 'no se pudo contrastar con clasp: ' + e.message;
    }
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

  function ejecutar(argv) {
    const a = L.parsearArgs(argv);
    try {
      if (!a.comando || !a.proyecto) { out(USO); return 1; }
      if (a.comando === 'pull') { return cmdPull(a.proyecto); }
      if (a.comando === 'status') { return cmdStatus(a.proyecto); }
      if (a.comando === 'diff') { return cmdDiff(a.proyecto, a.opciones); }
      if (a.comando === 'adopt') { return cmdAdopt(a.proyecto, a.opciones); }
      out('Comando desconocido o no habilitado en esta fase (solo lectura): ' + a.comando + '\n' + USO);
      return 1;
    } catch (e) {
      if (e instanceof L.ErrorGas) { out('ERROR: ' + e.message); return 1; }
      throw e;
    }
  }

  return { ejecutar: ejecutar };
}

if (require.main === module) {
  process.exitCode = crearCli({ raiz: path.resolve(__dirname, '..', '..') }).ejecutar(process.argv.slice(2));
}

module.exports = { crearCli };
