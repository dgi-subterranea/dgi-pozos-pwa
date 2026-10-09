'use strict';
// Logica PURA del wrapper de clasp (sin filesystem, sin red, sin clasp): clasificar archivos, comparar inventarios local/remoto,
// manifiesto, huella determinista, deteccion de proyectos cruzados, deriva del remoto y validacion de .clasp.json.
// Los conteos de archivos NUNCA se escriben a mano en ningun lado: siempre se derivan del filesystem real que se les pasa.
const crypto = require('crypto');

const MANIFIESTO = 'appsscript.json';
const ROOT_DIR_ESPERADO = 'src';
// Un archivo de codigo de Apps Script se sube solo si es "Nombre.js" simple. Todo lo demas dentro de src (tests "*.test.js", subcarpetas,
// .html, .md, etc.) es un extra PROHIBIDO: bloquea.
const RE_ARCHIVO_CODIGO = /^[A-Za-z0-9_]+\.js$/;
const RE_SCRIPT_ID = /^[A-Za-z0-9_-]{20,}$/;
const RE_SCRIPT_ID_PLACEHOLDER = /PEGAR|EJEMPLO|EXAMPLE|SCRIPT_ID|XXXX/i;
// Unico conjunto de subcomandos de clasp que este wrapper puede ejecutar en esta fase: TODOS de solo lectura contra el remoto.
const SUBCOMANDOS_PERMITIDOS = ['pull', 'show-file-status', 'show-authorized-user'];
const FLAGS_PROHIBIDOS = ['--force', '-f', '--deleteUnusedFiles', '--watch', '-w'];

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

// El wrapper de esta fase solo puede LEER del remoto. Cualquier otro subcomando, o un flag que fuerce/borre, es un bug y se corta.
function verificarComandoClasp(args) {
  if (!Array.isArray(args) || args.length === 0) { throw new ErrorGas('comando de clasp vacio'); }
  if (SUBCOMANDOS_PERMITIDOS.indexOf(args[0]) === -1) {
    throw new ErrorGas('subcomando de clasp NO permitido en esta fase (solo lectura): ' + args[0]);
  }
  args.forEach((a) => {
    if (FLAGS_PROHIBIDOS.indexOf(a) !== -1) { throw new ErrorGas('flag de clasp prohibido: ' + a); }
  });
  if (args.indexOf('--user') === -1) { throw new ErrorGas('clasp siempre se ejecuta con --user <nombre> (dos cuentas distintas)'); }
  return true;
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
  return { comando: pos[0] || null, proyecto: pos[1] || null, opciones: opciones };
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
  MANIFIESTO, ROOT_DIR_ESPERADO, RE_ARCHIVO_CODIGO, SUBCOMANDOS_PERMITIDOS, PROYECTOS, ErrorGas,
  sha256, normalizarTexto, nombreNormalizado, clasificarLocal, compararInventarios, resumenManifiesto, compararManifiestos, hashManifiesto,
  calcularHuella, huellaCoincide, detectarCruce, evaluarDeriva, validarClaspJson, verificarComandoClasp, extraerArchivosDeStatus,
  enmascarar, ultimos, parsearArgs, evaluar, condicionesAdopcion
};
