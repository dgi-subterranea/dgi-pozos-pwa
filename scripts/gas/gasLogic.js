'use strict';
// Logica PURA del wrapper de clasp (sin filesystem, sin red, sin clasp): clasificar archivos, comparar inventarios local/remoto,
// manifiesto, huella determinista, deteccion de proyectos cruzados, deriva del remoto y validacion de .clasp.json.
// Los conteos de archivos NUNCA se escriben a mano en ningun lado: siempre se derivan del filesystem real que se les pasa.
const crypto = require('crypto');
const path = require('path');

const MANIFIESTO = 'appsscript.json';
const ROOT_DIR_ESPERADO = 'src';
// Un archivo de codigo de Apps Script se sube solo si es "Nombre.js" simple. Todo lo demas dentro de src (tests "*.test.js", subcarpetas,
// .html, .md, etc.) es un extra PROHIBIDO: bloquea.
const RE_ARCHIVO_CODIGO = /^[A-Za-z0-9_]+\.js$/;
const RE_SCRIPT_ID = /^[A-Za-z0-9_-]{20,}$/;
const RE_SCRIPT_ID_PLACEHOLDER = /PEGAR|EJEMPLO|EXAMPLE|SCRIPT_ID|XXXX/i;
// Subcomandos de clasp que este wrapper puede ejecutar. LECTURA: no modifican el remoto. ESCRITURA: solo con {escritura:true} (lo piden
// unicamente gas:push, gas:version y gas:deploy, despues de TODAS sus guardas) y con la forma EXACTA que se valida mas abajo.
// Todo lo demas (create-deployment, delete-*, deploy, run-function, login...) esta prohibido siempre.
const SUBCOMANDOS_LECTURA = ['pull', 'show-file-status', 'show-authorized-user', 'list-deployments', 'list-versions'];
const SUBCOMANDOS_ESCRITURA = ['push', 'create-version', 'update-deployment'];
const SUBCOMANDOS_PERMITIDOS = SUBCOMANDOS_LECTURA;       // nombre historico: la lista de solo lectura
const FLAGS_PROHIBIDOS = ['--force', '-f', '--deleteUnusedFiles', '--watch', '-w'];
const RE_DEPLOYMENT_ID = /^[A-Za-z0-9_-]{20,}$/;
const RE_ID_PLACEHOLDER = /PEGAR|EJEMPLO|EXAMPLE|DEPLOYMENT_ID|XXXX/i;
const DESCRIPCION_MAX = 200;

// Dos proyectos Apps Script independientes (cuentas de Google distintas). "usuario" es el nombre de credencial de clasp (--user).
const PROYECTOS = {
  main: { nombre: 'main', titulo: 'dgi-pozos-backend', carpeta: 'backend', usuario: 'main' },
  storage: { nombre: 'storage', titulo: 'DGI Fotos Storage', carpeta: 'storage', usuario: 'storage' }
};

class ErrorGas extends Error {}

function sha256(texto) {
  return crypto.createHash('sha256').update(texto, 'utf8').digest('hex');
}

// Fin de linea unico (LF) y sin BOM: lo que se compara y se hashea nunca depende de como lo guardo Windows o el editor web.
function normalizarTexto(texto) {
  return String(texto).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

// "Api.gs" (nombre remoto) y "Api.js" (local) son el mismo archivo.
function nombreNormalizado(nombre) {
  const n = String(nombre).replace(/\\/g, '/');
  return n.endsWith('.gs') ? n.slice(0, -3) + '.js' : n;
}

// nombres (rutas relativas a src) -> {codigo: [...], manifiesto: bool, extras: [...]}. Un "extra" es cualquier cosa que NO se subiria
// legitimamente (tests, subcarpetas, otras extensiones): el wrapper se niega a sincronizar mientras haya alguno.
function clasificarLocal(nombres) {
  const r = { codigo: [], manifiesto: false, extras: [] };
  nombres.forEach((n) => {
    if (n === MANIFIESTO) { r.manifiesto = true; } else if (RE_ARCHIVO_CODIGO.test(n)) { r.codigo.push(n); } else { r.extras.push(n); }
  });
  r.codigo.sort();
  r.extras.sort();
  return r;
}

// local / remoto: Map nombre -> sha256 del contenido normalizado.
function compararInventarios(local, remoto) {
  const r = { identicos: [], modificados: [], soloLocal: [], soloRemoto: [] };
  Array.from(local.keys()).sort().forEach((n) => {
    if (!remoto.has(n)) { r.soloLocal.push(n); } else if (remoto.get(n) === local.get(n)) { r.identicos.push(n); } else { r.modificados.push(n); }
  });
  Array.from(remoto.keys()).sort().forEach((n) => { if (!local.has(n)) { r.soloRemoto.push(n); } });
  return r;
}

function ordenarClaves(v) {
  if (Array.isArray(v)) { return v.map(ordenarClaves); }
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach((k) => { o[k] = ordenarClaves(v[k]); });
    return o;
  }
  return v;
}

function parsearManifiesto(texto) {
  try { return { ok: true, valor: JSON.parse(normalizarTexto(texto)) }; } catch (e) { return { ok: false, valor: null }; }
}

// Resumen legible de lo que importa del manifiesto (runtime, acceso de la Web App, alcances OAuth, servicios avanzados).
function resumenManifiesto(texto) {
  if (texto === null || texto === undefined) { return null; }
  const p = parsearManifiesto(texto);
  if (!p.ok || !p.valor || typeof p.valor !== 'object') { return { invalido: true }; }
  const m = p.valor;
  const dep = m.dependencies || {};
  return {
    runtimeVersion: m.runtimeVersion || null,
    timeZone: m.timeZone || null,
    webappAccess: m.webapp ? (m.webapp.access || null) : null,
    webappExecuteAs: m.webapp ? (m.webapp.executeAs || null) : null,
    oauthScopes: Array.isArray(m.oauthScopes) ? m.oauthScopes.slice().sort() : null,
    serviciosAvanzados: Array.isArray(dep.enabledAdvancedServices) ? dep.enabledAdvancedServices.map((s) => s.serviceId || s.userSymbol).sort() : [],
    librerias: Array.isArray(dep.libraries) ? dep.libraries.map((l) => l.libraryId || l.userSymbol).sort() : [],
    exceptionLogging: m.exceptionLogging || null
  };
}

// 'igual' | 'distinto' | 'soloRemoto' | 'soloLocal' | 'ausentes'. Se compara el JSON canonico (da igual el formato / el orden de claves).
function compararManifiestos(textoLocal, textoRemoto) {
  const l = textoLocal !== null && textoLocal !== undefined;
  const r = textoRemoto !== null && textoRemoto !== undefined;
  if (!l && !r) { return 'ausentes'; }
  if (l && !r) { return 'soloLocal'; }
  if (!l && r) { return 'soloRemoto'; }
  const pl = parsearManifiesto(textoLocal);
  const pr = parsearManifiesto(textoRemoto);
  if (pl.ok && pr.ok) { return JSON.stringify(ordenarClaves(pl.valor)) === JSON.stringify(ordenarClaves(pr.valor)) ? 'igual' : 'distinto'; }
  return normalizarTexto(textoLocal) === normalizarTexto(textoRemoto) ? 'igual' : 'distinto';
}

function hashManifiesto(texto) {
  if (texto === null || texto === undefined) { return null; }
  const p = parsearManifiesto(texto);
  return sha256(p.ok ? JSON.stringify(ordenarClaves(p.valor)) : normalizarTexto(texto));
}

// Huella DETERMINISTA del par (local, remoto) de un proyecto: no depende del orden de lectura, de CRLF/LF ni del formato del manifiesto.
// Cualquier cambio de contenido de cualquier archivo, local o remoto, o del manifiesto, la cambia.
function calcularHuella(proyecto, local, remoto, manifiestoLocal, manifiestoRemoto) {
  const nombres = Array.from(new Set(Array.from(local.keys()).concat(Array.from(remoto.keys())))).sort();
  const entradas = nombres.map((n) => [n, local.has(n) ? local.get(n) : '-', remoto.has(n) ? remoto.get(n) : '-']);
  return sha256(JSON.stringify({ v: 1, proyecto: proyecto, archivos: entradas, manifiesto: [hashManifiesto(manifiestoLocal) || '-', hashManifiesto(manifiestoRemoto) || '-'] }));
}

function huellaCoincide(huellaCompleta, ingresada) {
  const h = String(ingresada || '').trim().toLowerCase();
  return /^[0-9a-f]{12,64}$/.test(h) && huellaCompleta.toLowerCase().startsWith(h);
}

// Deteccion de proyectos CRUZADOS (main <-> storage). Todo se deriva de los inventarios reales, no de nombres escritos a mano:
//  - el mismo scriptId en las dos carpetas;
//  - el remoto comparte mas nombres de archivo con el OTRO proyecto que con el propio;
//  - el remoto no comparte ninguno con el propio (no se parece a este proyecto).
function detectarCruce(o) {
  const motivos = [];
  const ids = o.scriptIds || {};
  if (ids.main && ids.storage && ids.main === ids.storage) {
    motivos.push('main y storage tienen el MISMO scriptId en sus .clasp.json');
  }
  const remoto = o.nombresRemotos;
  if (remoto && remoto.size > 0) {
    const enPropios = Array.from(remoto).filter((n) => o.nombresPropios.has(n));
    const enAjenos = Array.from(remoto).filter((n) => o.nombresAjenos.has(n));
    if (enAjenos.length > enPropios.length || (enAjenos.length > 0 && enPropios.length === 0)) {
      motivos.push('el proyecto remoto contiene archivos del OTRO proyecto (' + enAjenos.slice(0, 5).join(', ') + ') y ' + enPropios.length + ' propios: parece estar cruzado');
    } else if (enPropios.length === 0 && o.nombresPropios.size > 0) {
      motivos.push('el proyecto remoto no comparte ningun archivo con el codigo local de este proyecto: scriptId equivocado?');
    }
  }
  return motivos;
}

// Estado adoptado: {remoto:{archivos:{nombre:sha}, manifiestoSha}} vs remoto actual. Detecta ediciones hechas fuera de este flujo
// (p. ej. directamente en el editor web de Apps Script) desde la ultima adopcion.
function evaluarDeriva(adoptado, remotoActual, manifiestoRemotoTexto) {
  if (!adoptado || !adoptado.remoto) { return null; }
  const antes = adoptado.remoto.archivos || {};
  const r = { cambiados: [], nuevos: [], borrados: [], manifiesto: false };
  Array.from(remotoActual.keys()).sort().forEach((n) => {
    if (!(n in antes)) { r.nuevos.push(n); } else if (antes[n] !== remotoActual.get(n)) { r.cambiados.push(n); }
  });
  Object.keys(antes).sort().forEach((n) => { if (!remotoActual.has(n)) { r.borrados.push(n); } });
  r.manifiesto = (adoptado.remoto.manifiestoSha || null) !== hashManifiesto(manifiestoRemotoTexto);
  r.hayDeriva = r.cambiados.length + r.nuevos.length + r.borrados.length > 0 || r.manifiesto;
  return r;
}

function validarClaspJson(obj) {
  const errores = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return { ok: false, errores: ['.clasp.json no es un objeto JSON'] }; }
  if (typeof obj.scriptId !== 'string' || !RE_SCRIPT_ID.test(obj.scriptId) || RE_SCRIPT_ID_PLACEHOLDER.test(obj.scriptId)) {
    errores.push('scriptId ausente, con formato invalido o todavia es el marcador de posicion');
  }
  if (obj.rootDir !== ROOT_DIR_ESPERADO) {
    errores.push('rootDir debe ser exactamente "' + ROOT_DIR_ESPERADO + '" (se encontro ' + JSON.stringify(obj.rootDir) + ')');
  }
  return { ok: errores.length === 0, errores: errores };
}

// Cada comando de clasp pasa por aca ANTES de ejecutarse. Sin {escritura:true} solo se aceptan los de LECTURA; con ese permiso se aceptan,
// ademas, push / create-version / update-deployment, y solo con su forma exacta (nada de --force, ni flags extra, ni create-deployment).
function verificarComandoClasp(args, opciones) {
  const escritura = !!(opciones && opciones.escritura);
  if (!Array.isArray(args) || args.length === 0) { throw new ErrorGas('comando de clasp vacio'); }
  const cmd = args[0];
  const lectura = SUBCOMANDOS_LECTURA.indexOf(cmd) !== -1;
  const esc = SUBCOMANDOS_ESCRITURA.indexOf(cmd) !== -1;
  if (!lectura && !esc) { throw new ErrorGas('subcomando de clasp NO permitido: ' + cmd); }
  if (esc && !escritura) { throw new ErrorGas('subcomando de clasp NO permitido en este contexto (solo lectura): ' + cmd); }
  args.forEach((a) => {
    if (FLAGS_PROHIBIDOS.indexOf(a) !== -1) { throw new ErrorGas('flag de clasp prohibido: ' + a); }
  });
  const iu = args.indexOf('--user');
  if (iu === -1) { throw new ErrorGas('clasp siempre se ejecuta con --user <nombre> (dos cuentas distintas)'); }
  const usuario = args[iu + 1];
  if (iu !== args.length - 2 || typeof usuario !== 'string' || !/^[a-z]+$/.test(usuario)) { throw new ErrorGas('--user debe ser el ultimo argumento y llevar un nombre'); }
  const resto = args.slice(1, iu);
  const forma = (ok, msg) => { if (!ok) { throw new ErrorGas('forma de comando clasp NO permitida (' + cmd + '): ' + msg); } };
  if (cmd === 'push') {
    forma(resto.length === 0, 'push no admite argumentos ni flags');
  } else if (cmd === 'create-version') {
    forma(resto.length === 1 && typeof resto[0] === 'string' && resto[0].trim() !== '' && !resto[0].startsWith('-') && resto[0].length <= DESCRIPCION_MAX, 'exige una descripcion (1 a ' + DESCRIPCION_MAX + ' caracteres)');
  } else if (cmd === 'update-deployment') {
    forma(resto.length >= 3 && RE_DEPLOYMENT_ID.test(String(resto[0])) && resto[1] === '-V' && /^[1-9][0-9]{0,5}$/.test(String(resto[2])), 'exige <deploymentId> -V <version>');
    const extra = resto.slice(3);
    forma(extra.length === 0 || (extra.length === 2 && extra[0] === '-d' && typeof extra[1] === 'string' && extra[1].trim() !== '' && extra[1].length <= DESCRIPCION_MAX), 'solo admite -d "<descripcion>" ademas');
  } else if (cmd === 'pull') {
    forma(resto.length === 0 || (resto.length === 2 && resto[0] === '--versionNumber' && /^[1-9][0-9]{0,5}$/.test(String(resto[1]))), 'solo admite --versionNumber <n>');
  } else if (cmd === 'show-file-status') {
    forma(resto.every((x) => x === '--json'), 'solo admite --json');
  } else {
    forma(resto.length === 0, 'no admite argumentos');
  }
  return true;
}

// Configuracion LOCAL (.gas.local.json, ignorada por git): {version:1, main:{pushHabilitado, deploymentId}, storage:{...}}.
// El deploymentId del storage forma parte de su URL secreta: nunca se versiona ni se imprime completo.
function validarConfigLocal(obj) {
  const errores = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return { ok: false, errores: ['.gas.local.json no es un objeto JSON'] }; }
  Object.keys(PROYECTOS).forEach((n) => {
    const c = obj[n];
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errores.push('falta la seccion "' + n + '"'); return; }
    if (typeof c.pushHabilitado !== 'boolean') { errores.push(n + '.pushHabilitado debe ser true o false'); }
    if (typeof c.deploymentId !== 'string') { errores.push(n + '.deploymentId debe ser texto (vacio hasta completarlo)'); return; }
    const id = c.deploymentId.trim();
    if (id !== '' && (id.toUpperCase() === '@HEAD' || !RE_DEPLOYMENT_ID.test(id) || RE_ID_PLACEHOLDER.test(id))) {
      errores.push(n + '.deploymentId invalido (debe ser el ID del deployment numerado; @HEAD no esta permitido)');
    }
  });
  if (obj.main && obj.storage && obj.main.deploymentId && obj.main.deploymentId === obj.storage.deploymentId) {
    errores.push('main y storage tienen el MISMO deploymentId');
  }
  return { ok: errores.length === 0, errores: errores };
}

// Salida de `clasp list-deployments`: "- <id> @HEAD" / "- <id> @35". Devuelve [{id, head, version, descripcion}].
function parsearDeployments(salida) {
  const r = [];
  String(salida).split(/\r?\n/).forEach((linea) => {
    const m = /^\s*[-*]?\s*(\S{20,})\s+@(HEAD|\d+)\b\s*(?:-\s*(.*?))?\s*$/.exec(linea);
    if (m) { r.push({ id: m[1], head: m[2] === 'HEAD', version: m[2] === 'HEAD' ? null : parseInt(m[2], 10), descripcion: m[3] || '' }); }
  });
  return r;
}

// Salida de `clasp list-versions`: "35 - descripcion". Devuelve [{numero, descripcion}].
function parsearVersiones(salida) {
  const r = [];
  String(salida).split(/\r?\n/).forEach((linea) => {
    const m = /^\s*(\d+)\s+-\s*(.*?)\s*$/.exec(linea);
    if (m) { r.push({ numero: parseInt(m[1], 10), descripcion: m[2] }); }
  });
  return r;
}

function parsearVersionCreada(salida) {
  const m = /created version\s+(\d+)/i.exec(String(salida));
  return m ? parseInt(m[1], 10) : null;
}

function maximaVersion(versiones) {
  return versiones.reduce((m, v) => Math.max(m, v.numero), 0);
}

// Guardas de PUSH, puras. ev = resultado de evaluar(); estado = .gas-state; clasp = contraste con `clasp show-file-status`
// ({reconocido, coincide, faltan, sobran}). Devuelve bloqueantes y el resumen de lo que el push haria.
function evaluarPush(o) {
  const ev = o.ev;
  const estado = o.estado;
  const bloqueantes = [];
  if (!estado || !estado.remoto) { bloqueantes.push('el proyecto NO esta adoptado: correr gas:diff y gas:adopt antes del primer push'); }
  if (o.extras && o.extras.length) { bloqueantes.push('hay archivos NO permitidos dentro de src: ' + o.extras.join(', ')); }
  ev.cruce.forEach((m) => bloqueantes.push('PROYECTOS CRUZADOS: ' + m));
  if (ev.cmp.identicos.length + ev.cmp.modificados.length + ev.cmp.soloRemoto.length === 0) { bloqueantes.push('el remoto no tiene archivos de codigo (pull vacio o proyecto equivocado)'); }
  if (o.cantidadLocal === 0) { bloqueantes.push('no hay archivos de codigo locales para subir'); }
  if (ev.deriva && ev.deriva.hayDeriva) {
    bloqueantes.push('el remoto CAMBIO desde la adopcion (deriva): ' + [].concat(ev.deriva.cambiados, ev.deriva.nuevos, ev.deriva.borrados, ev.deriva.manifiesto ? [MANIFIESTO] : []).join(', ') + ' — revisar con gas:diff y volver a adoptar');
  }
  const aprobados = new Set((estado && estado.descartados) || []);
  const noReconocidos = ev.cmp.soloRemoto.filter((n) => !aprobados.has(n));
  if (noReconocidos.length) { bloqueantes.push('archivo(s) remoto(s) NO reconocido(s) (no aprobados para descarte en .gas-state; el push los borraria): ' + noReconocidos.join(', ')); }
  if (ev.manifiesto === 'soloRemoto' || ev.manifiesto === 'ausentes') { bloqueantes.push('falta ' + MANIFIESTO + ' local: un push sin manifiesto no esta permitido'); }
  if (ev.manifiesto === 'soloLocal') { bloqueantes.push(MANIFIESTO + ' existe local pero el remoto no lo devolvio: estado remoto inconsistente'); }
  if (ev.manifiesto === 'distinto' && !o.permitirManifest) { bloqueantes.push(MANIFIESTO + ' local difiere del remoto (alcances, Web App o runtime cambiarian): usar --permitir-manifest solo si es intencional'); }
  const c = o.clasp;
  if (!c || !c.reconocido) {
    bloqueantes.push('no se pudo verificar con "clasp show-file-status" que el push suba exactamente los archivos esperados (salida no reconocida): correr npm run gas:status y revisar');
  } else if (!c.coincide) {
    bloqueantes.push('lo que clasp subiria NO coincide con el inventario local. Archivos locales que NO se subirian: ' + (c.faltan.join(', ') || '-') + ' | archivos inesperados que SI se subirian: ' + (c.sobran.join(', ') || '-'));
  }
  return { bloqueantes: bloqueantes, agregados: ev.cmp.soloLocal.slice(), modificados: ev.cmp.modificados.slice(), eliminados: ev.cmp.soloRemoto.slice(), identicos: ev.cmp.identicos.slice() };
}

// Despues del push, remoto == local: ni archivos de mas ni de menos ni distintos, y mismo manifiesto.
function verificarPostPush(ev) {
  const problemas = [];
  if (ev.cmp.soloLocal.length) { problemas.push('quedaron sin subir: ' + ev.cmp.soloLocal.join(', ')); }
  if (ev.cmp.soloRemoto.length) { problemas.push('quedaron en el remoto archivos que no estan en el repo: ' + ev.cmp.soloRemoto.join(', ')); }
  if (ev.cmp.modificados.length) { problemas.push('el contenido remoto no coincide con el local: ' + ev.cmp.modificados.join(', ')); }
  if (ev.manifiesto !== 'igual') { problemas.push(MANIFIESTO + ' no coincide (' + ev.manifiesto + ')'); }
  if (!ev.cmp.identicos.length) { problemas.push('el remoto quedo sin archivos de codigo'); }
  return { ok: problemas.length === 0, problemas: problemas };
}

// Destino de una ESCRITURA en Apps Script (push / create-version / update-deployment). Solo se acepta ejecutar clasp con cwd EXACTAMENTE la carpeta
// del proyecto (la que tiene el .clasp.json real): nunca .gas-remote/* (copias de HEAD, posiblemente viejas) ni otra carpeta; y el .clasp.json
// de ese cwd, leido del disco AHORA, debe tener el scriptId esperado (el del inicio del comando) y no el del otro proyecto.
// o: {raiz, cwd, esperado, claspJson (objeto | null), scriptIdEsperado, scriptIdOtro}
function validarDestinoEscritura(o) {
  const errores = [];
  const norm = (x) => { const r = path.resolve(String(x)); return process.platform === 'win32' ? r.toLowerCase() : r; };
  const etiqueta = (x) => { const r = path.relative(o.raiz, path.resolve(String(x))); return r === '' ? '.' : r.split(path.sep).join('/'); };
  if (typeof o.cwd !== 'string' || !o.cwd || !path.isAbsolute(o.cwd)) {
    errores.push('el directorio de trabajo de la escritura no es una ruta absoluta (' + JSON.stringify(o.cwd) + ')');
  } else if (norm(o.cwd) !== norm(o.esperado)) {
    const enRemoto = /(^|[\\/])\.gas-remote([\\/]|$)/.test(path.resolve(o.cwd));
    errores.push('la escritura se ejecutaria desde "' + etiqueta(o.cwd) + '"' + (enRemoto ? ' (una copia de .gas-remote: puede ser un HEAD viejo)' : '') + ' y solo se permite desde "' + etiqueta(o.esperado) + '"');
  }
  if (!o.claspJson) {
    errores.push('no se pudo leer el .clasp.json de la carpeta de escritura');
  } else {
    const v = validarClaspJson(o.claspJson);
    if (!v.ok) {
      errores.push('.clasp.json de la carpeta de escritura: ' + v.errores.join('; '));
    } else {
      if (o.claspJson.scriptId !== o.scriptIdEsperado) { errores.push('el scriptId de .clasp.json (' + ultimos(o.claspJson.scriptId) + ') NO es el esperado (' + ultimos(o.scriptIdEsperado) + '): cambio durante la ejecucion o carpeta equivocada'); }
      if (o.scriptIdOtro && o.claspJson.scriptId === o.scriptIdOtro) { errores.push('el scriptId de .clasp.json es el del OTRO proyecto (' + ultimos(o.scriptIdOtro) + ')'); }
    }
  }
  return errores;
}

// Firma del contenido de HEAD remoto (archivos + manifiesto): dos pulls con distinta firma => HEAD cambio entre ambos.
function firmaDe(entradas, hashManif) {
  return sha256(JSON.stringify({ v: 1, archivos: entradas, manifiesto: hashManif || '-' }));
}

function firmaRemoto(codigo, manifiestoTexto) {
  return firmaDe(Array.from(codigo.keys()).sort().map((n) => [n, codigo.get(n)]), hashManifiesto(manifiestoTexto));
}

// La misma firma, calculada desde el remoto REGISTRADO en .gas-state (archivos {nombre: sha} + manifiestoSha).
function firmaDeEstado(estado) {
  if (!estado || !estado.remoto || !estado.remoto.archivos) { return null; }
  const a = estado.remoto.archivos;
  return firmaDe(Object.keys(a).sort().map((n) => [n, a[n]]), estado.remoto.manifiestoSha);
}

// HEAD remoto vs repo (mismas condiciones que despues de un push) + proyectos cruzados + archivos no permitidos en src.
function evaluarHead(ev, extras) {
  const problemas = verificarPostPush(ev).problemas
    .concat(ev.cruce.map((m) => 'PROYECTOS CRUZADOS: ' + m), extras && extras.length ? ['archivos no permitidos en src: ' + extras.join(', ')] : []);
  return { ok: problemas.length === 0, problemas: problemas };
}

// ¿El remoto actual es el estado ANTERIOR al ultimo push (alguien subio una copia vieja despues)? Se detecta por la huella (remoto + repo) que
// quedo registrada como "huellaPrevia" y, si existe, por la firma del contenido remoto previo (que no depende del repo). Nunca se marca como
// revertido si el remoto actual es justamente lo adoptado (p. ej. un push que no cambio nada).
// o: {estado, huella (del evaluar actual), firma (firmaRemoto del pull actual)}
function detectarRevertido(o) {
  const up = o.estado && o.estado.ultimoPush;
  if (!up) { return { revertido: false }; }
  const adoptada = firmaDeEstado(o.estado);
  if (adoptada && o.firma && adoptada === o.firma) { return { revertido: false }; }
  if (typeof up.remotoPrevio === 'string' && o.firma && up.remotoPrevio === o.firma) { return { revertido: true, por: 'contenido' }; }
  if (typeof up.huellaPrevia === 'string' && o.huella && up.huellaPrevia.toLowerCase() === String(o.huella).toLowerCase() && o.estado.huella !== o.huella) { return { revertido: true, por: 'huella' }; }
  return { revertido: false };
}

// Una linea con las fechas de la ultima operacion de escritura registrada (vacia si no hay ninguna).
function resumenOperaciones(estado) {
  if (!estado) { return ''; }
  const partes = [];
  if (estado.ultimoPush && estado.ultimoPush.en) { partes.push('ultimo push: ' + estado.ultimoPush.en); }
  if (estado.ultimaVersion && estado.ultimaVersion.en) { partes.push('ultima version: ' + estado.ultimaVersion.numero + ' (' + estado.ultimaVersion.en + (estado.ultimaVersion.headConsistente === false ? ', HEAD inconsistente' : '') + ')'); }
  if (estado.ultimoDeploy && estado.ultimoDeploy.en) { partes.push('ultimo deploy: v' + estado.ultimoDeploy.version + ' (' + estado.ultimoDeploy.en + (estado.ultimoDeploy.headConsistente === false ? ', HEAD inconsistente' : '') + ')'); }
  return partes.join(' | ');
}

// Guardas de DEPLOY, puras. despliegues = parsearDeployments(); versiones = parsearVersiones().
function evaluarDeploy(o) {
  const errores = [];
  const d = o.despliegues.find((x) => x.id === o.deploymentId) || null;
  if (!d) { errores.push('el deploymentId configurado NO figura entre los deployments de este proyecto: pertenece a otro proyecto o es incorrecto'); }
  if (o.otroDeploymentId && o.otroDeploymentId === o.deploymentId) { errores.push('el mismo deploymentId esta configurado en main y en storage'); }
  if (d && d.head) { errores.push('el destino es @HEAD (el deployment de pruebas): no es un destino productivo permitido'); }
  if (!o.versiones.some((v) => v.numero === o.version)) { errores.push('la version ' + o.version + ' NO existe (versiones existentes: 1 a ' + maximaVersion(o.versiones) + ')'); }
  const actual = d && !d.head ? d.version : null;
  if (actual !== null && o.version === actual) { errores.push('el deployment ya esta en la version ' + actual + ': nada que hacer'); }
  if (actual !== null && o.version < actual && !o.permitirRetroceso) { errores.push('pasar de la version ' + actual + ' a la ' + o.version + ' es un RETROCESO: usar --permitir-retroceso solo para una reversion deliberada'); }
  return { errores: errores, actual: actual, destino: o.version, head: !!(d && d.head), encontrado: !!d };
}

// Texto que hay que reescribir para confirmar un deploy: version + final del deploymentId (se ve en el plan; no se puede adivinar).
function confirmacionDeploy(version, deploymentId) {
  return 'v' + version + '@' + String(deploymentId).slice(-6);
}

// Extrae nombres de archivo de la salida de `clasp show-file-status` (el formato no esta documentado: se acepta JSON en cualquier forma
// o, si no, una linea por archivo). Devuelve nombres relativos normalizados; vacio si no se reconoce nada.
function extraerArchivosDeStatus(salida) {
  const encontrados = new Set();
  const re = /([A-Za-z0-9_.\-/\\]+\.(?:js|gs|json|html))$/;
  function visitar(v) {
    if (typeof v === 'string') { const m = re.exec(v.trim()); if (m) { encontrados.add(nombreNormalizado(m[1]).replace(/^(\.\/|src\/)/, '')); } } else if (Array.isArray(v)) { v.forEach(visitar); } else if (v && typeof v === 'object') { Object.keys(v).forEach((k) => { visitar(k); visitar(v[k]); }); }
  }
  try { visitar(JSON.parse(salida)); } catch (e) { String(salida).split(/\r?\n/).forEach(visitar); }
  return Array.from(encontrados).sort();
}

function enmascarar(texto, secretos) {
  let t = String(texto === null || texto === undefined ? '' : texto);
  (secretos || []).filter(Boolean).forEach((s) => { t = t.split(s).join('<scriptId>'); });
  return t;
}

function ultimos(id) {
  return id ? '…' + String(id).slice(-6) : '(sin scriptId)';
}

// argv (sin "node" ni el script) -> {comando, proyecto, opciones}. --flag valor | --flag (booleano).
function parsearArgs(argv) {
  const pos = [];
  const opciones = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > -1) { opciones[a.slice(2, eq)] = a.slice(eq + 1); } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { opciones[a.slice(2)] = argv[++i]; } else { opciones[a.slice(2)] = true; }
    } else { pos.push(a); }
  }
  return { comando: pos[0] || null, proyecto: pos[1] || null, opciones: opciones, extras: pos.slice(2) };
}

// Evaluacion completa de un proyecto -> bloqueantes / advertencias / huella. "local" y "remoto": {codigo:Map, manifiesto:texto|null}.
function evaluar(o) {
  const cmp = compararInventarios(o.local.codigo, o.remoto.codigo);
  const manifiesto = compararManifiestos(o.local.manifiesto, o.remoto.manifiesto);
  const cruce = detectarCruce({
    scriptIds: o.scriptIds, nombresRemotos: new Set(o.remoto.codigo.keys()), nombresPropios: new Set(o.local.codigo.keys()), nombresAjenos: o.nombresAjenos
  });
  const deriva = evaluarDeriva(o.estadoAdoptado, o.remoto.codigo, o.remoto.manifiesto);
  const bloqueantes = [];
  const advertencias = [];
  if (o.extras && o.extras.length) { bloqueantes.push('hay archivos NO permitidos dentro de src (se subirian o confundirian): ' + o.extras.join(', ')); }
  cruce.forEach((m) => bloqueantes.push('PROYECTOS CRUZADOS: ' + m));
  if (o.remoto.codigo.size === 0) { bloqueantes.push('el remoto no tiene archivos de codigo (pull vacio o proyecto equivocado)'); }
  if (cmp.soloRemoto.length) { bloqueantes.push('existen ' + cmp.soloRemoto.length + ' archivo(s) SOLO en el remoto que un push BORRARIA: ' + cmp.soloRemoto.join(', ')); }
  if (manifiesto === 'soloRemoto') { bloqueantes.push('falta ' + MANIFIESTO + ' local: copiarlo del remoto (.gas-remote) a src, revisado, antes de sincronizar'); }
  if (manifiesto === 'distinto') { bloqueantes.push(MANIFIESTO + ' local difiere del remoto (alcances, Web App o runtime podrian cambiar)'); }
  if (manifiesto === 'soloLocal') { bloqueantes.push(MANIFIESTO + ' existe local pero el remoto no lo devolvio'); }
  if (manifiesto === 'ausentes') { bloqueantes.push(MANIFIESTO + ' no existe ni local ni en el pull'); }
  if (deriva && deriva.hayDeriva) { bloqueantes.push('el remoto CAMBIO desde la ultima adopcion (editado fuera de este flujo): ' + [].concat(deriva.cambiados, deriva.nuevos, deriva.borrados, deriva.manifiesto ? [MANIFIESTO] : []).join(', ')); }
  const resumenRemoto = resumenManifiesto(o.remoto.manifiesto);
  if (resumenRemoto && !resumenRemoto.invalido && resumenRemoto.runtimeVersion !== 'V8') {
    advertencias.push('el remoto NO declara runtimeVersion V8 (declara ' + JSON.stringify(resumenRemoto.runtimeVersion) + '): el codigo usa Object.assign en UbicacionCorreccionService.js');
  }
  return {
    cmp: cmp, manifiesto: manifiesto, resumenLocal: resumenManifiesto(o.local.manifiesto), resumenRemoto: resumenRemoto, cruce: cruce, deriva: deriva,
    bloqueantes: bloqueantes, advertencias: advertencias,
    huella: calcularHuella(o.proyecto, o.local.codigo, o.remoto.codigo, o.local.manifiesto, o.remoto.manifiesto)
  };
}

// Condiciones para ADOPTAR (registrar localmente el estado remoto revisado). descartar: archivos solo-remotos que el operador reconoce
// que se perderian en un futuro push. Se rechazan extras, cruce, remoto vacio, manifiesto no igual y solo-remotos no reconocidos.
function condicionesAdopcion(ev, extras, descartar) {
  const faltas = [];
  if (extras && extras.length) { faltas.push('hay archivos no permitidos dentro de src: ' + extras.join(', ')); }
  ev.cruce.forEach((m) => faltas.push('PROYECTOS CRUZADOS: ' + m));
  if (ev.cmp.identicos.length + ev.cmp.modificados.length + ev.cmp.soloRemoto.length === 0) { faltas.push('el remoto no tiene archivos de codigo'); }
  if (ev.manifiesto !== 'igual') { faltas.push(MANIFIESTO + ' local debe existir y ser igual al remoto (estado: ' + ev.manifiesto + ')'); }
  const reconocidos = new Set(descartar || []);
  const sinReconocer = ev.cmp.soloRemoto.filter((n) => !reconocidos.has(n));
  if (sinReconocer.length) { faltas.push('archivos solo en el remoto sin reconocer (agregarlos al repo, o listarlos en --descartar si se aceptan perder): ' + sinReconocer.join(', ')); }
  const sobrantes = Array.from(reconocidos).filter((n) => ev.cmp.soloRemoto.indexOf(n) === -1);
  if (sobrantes.length) { faltas.push('--descartar incluye archivos que no estan solo en el remoto: ' + sobrantes.join(', ')); }
  return faltas;
}

module.exports = {
  MANIFIESTO, ROOT_DIR_ESPERADO, RE_ARCHIVO_CODIGO, SUBCOMANDOS_PERMITIDOS, SUBCOMANDOS_LECTURA, SUBCOMANDOS_ESCRITURA, DESCRIPCION_MAX, PROYECTOS, ErrorGas,
  sha256, normalizarTexto, nombreNormalizado, clasificarLocal, compararInventarios, resumenManifiesto, compararManifiestos, hashManifiesto,
  calcularHuella, huellaCoincide, detectarCruce, evaluarDeriva, validarClaspJson, verificarComandoClasp, extraerArchivosDeStatus,
  enmascarar, ultimos, parsearArgs, evaluar, condicionesAdopcion,
  validarConfigLocal, parsearDeployments, parsearVersiones, parsearVersionCreada, maximaVersion, evaluarPush, verificarPostPush, evaluarDeploy, confirmacionDeploy,
  validarDestinoEscritura, firmaRemoto, evaluarHead, detectarRevertido, resumenOperaciones
};
