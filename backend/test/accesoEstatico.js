// Analisis ESTATICO del codigo de backend/src para el test de modos de acceso (E10-3). Sin ejecutar nada: lee los fuentes, ignora comentarios y cadenas, arma el grafo de llamadas entre funciones
// globales (en Apps Script todos los archivos comparten espacio global) y calcula que alcanza cada accion de doPost.
const fs = require('fs');
const path = require('path');

// Reemplaza por espacios el contenido de comentarios, cadenas, plantillas y expresiones regulares (conserva saltos de linea y la posicion de todo lo demas).
function limpiar(src) {
  const out = [];
  let i = 0;
  let previoSignificativo = '';
  const n = src.length;
  function blanco(desde, hasta) {
    for (let k = desde; k < hasta; k += 1) { out.push(src[k] === '\n' ? '\n' : ' '); }
  }
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') { j += 1; }
      blanco(i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      blanco(i, j);
      i = j;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== c) { j += src[j] === '\\' ? 2 : 1; }
      j = Math.min(n, j + 1);
      out.push(c);
      blanco(i + 1, j - 1);
      out.push(c);
      i = j;
      previoSignificativo = c;
      continue;
    }
    if (c === '/' && '(,=:[!&|?{};+-*%<>~^'.includes(previoSignificativo) || (c === '/' && previoSignificativo === '' )) {
      // literal de expresion regular
      let j = i + 1;
      let enClase = false;
      while (j < n && (src[j] !== '/' || enClase) && src[j] !== '\n') {
        if (src[j] === '\\') { j += 1; } else if (src[j] === '[') { enClase = true; } else if (src[j] === ']') { enClase = false; }
        j += 1;
      }
      j = Math.min(n, j + 1);
      while (j < n && /[a-z]/.test(src[j])) { j += 1; }
      blanco(i, j);
      i = j;
      previoSignificativo = ')';
      continue;
    }
    out.push(c);
    if (!/\s/.test(c)) { previoSignificativo = c; }
    i += 1;
  }
  return out.join('');
}

// Cuerpo de una funcion: desde la llave que abre hasta su par.
function cuerpoDesde(limpio, desde) {
  let i = limpio.indexOf('{', desde);
  if (i < 0) { return ''; }
  const inicio = i;
  let nivel = 0;
  for (; i < limpio.length; i += 1) {
    if (limpio[i] === '{') { nivel += 1; }
    if (limpio[i] === '}') { nivel -= 1; if (nivel === 0) { return limpio.slice(inicio, i + 1); } }
  }
  return limpio.slice(inicio);
}

// fuentes: {nombreDeArchivo: texto}. Devuelve {funciones: {nombre: {archivo, llamadas:[...]}}}.
function indexarFunciones(fuentes) {
  const funciones = {};
  Object.keys(fuentes).forEach((archivo) => {
    const limpio = limpiar(fuentes[archivo]);
    const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g;
    let m;
    while ((m = re.exec(limpio)) !== null) {
      const cuerpo = cuerpoDesde(limpio, m.index + m[0].length);
      const llamadas = new Set();
      const rc = /(^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g;
      let c;
      while ((c = rc.exec(cuerpo)) !== null) {
        if (c[2] !== 'function' && c[2] !== 'if' && c[2] !== 'for' && c[2] !== 'while' && c[2] !== 'switch' && c[2] !== 'catch' && c[2] !== 'return') { llamadas.add(c[2]); }
      }
      funciones[m[1]] = { archivo: archivo, llamadas: Array.from(llamadas) };
    }
  });
  return funciones;
}

// Todo lo que alcanza `inicio` (incluido), siguiendo llamadas a funciones definidas. Devuelve un Set con TODOS los nombres vistos (tambien los que no estan definidos, p. ej. APIs de Apps Script).
function alcanzables(funciones, inicio) {
  const vistos = new Set();
  const pila = [inicio];
  while (pila.length > 0) {
    const nombre = pila.pop();
    if (vistos.has(nombre)) { continue; }
    vistos.add(nombre);
    if (funciones[nombre]) { funciones[nombre].llamadas.forEach((x) => pila.push(x)); }
  }
  return vistos;
}

// Acciones de doPost: [{accion, handler}] en el orden del archivo. Se lee del texto original (los nombres de accion son cadenas).
function accionesDePost(textoApi) {
  const acciones = [];
  const re = /body\.action === '([A-Za-z0-9_]+)'\) \{[\s\S]*?response = ([A-Za-z0-9_]+)\(/g;
  let m;
  while ((m = re.exec(textoApi)) !== null) {
    acciones.push({ accion: m[1], handler: m[2] });
  }
  return acciones;
}

// Todo lo que una accion PUBLICA / ANONIMA tiene prohibido alcanzar: sesion, permisos, usuarios, auditoria de usuarios y Telegram.
const PROHIBIDO_EN_PUBLICO = /^(getUserAccess|hasPermission|isUserActive|validateSession|validateSessionAndWellId|validarPermiso|validarPermisosTodos|api_validarPermisosEstrictos|api_itfModEntrada|usuariosAdminApi_puerta|logHistoryEvent|verifySessionToken|createSessionToken|signPayload|handleLogin|handleCheckSession|handleRegisterWellSearch)$|^(authService|sheetUserRepository|sheetHistoryRepository|historyService|usuariosDominio|usuariosAdmin|usuariosAdminLectura|usuariosAdminApi|usuariosEventosRepository|searchHistoryService|sheetSearchHistoryRepository|notificationService|telegramRepository|propuestaNotificacion)_/;

// Lo que una accion de SESION tiene que alcanzar para exigir identidad.
const COMPUERTAS_DE_SESION = ['validateSession', 'validateSessionAndWellId', 'verifySessionToken', 'usuariosAdminApi_puerta', 'api_itfModEntrada', 'handleLogin'];

// declarados: {accion: 'sesion'|'publico'}. Devuelve la lista de problemas (vacia = todo en orden).
function auditar(fuentes, textoApi, declarados) {
  const problemas = [];
  const funciones = indexarFunciones(fuentes);
  const acciones = accionesDePost(textoApi);
  const nombres = acciones.map((a) => a.accion);
  acciones.forEach(({ accion, handler }) => {
    const modo = declarados[accion];
    if (modo !== 'sesion' && modo !== 'publico') {
      problemas.push('ACCION_SIN_MODO:' + accion);
      return;
    }
    const alcance = alcanzables(funciones, handler);
    if (modo === 'publico') {
      Array.from(alcance).filter((n) => PROHIBIDO_EN_PUBLICO.test(n)).forEach((n) => problemas.push('PUBLICA_USA_PRIVADO:' + accion + ':' + n));
    } else if (!COMPUERTAS_DE_SESION.some((g) => alcance.has(g))) {
      problemas.push('SESION_SIN_COMPUERTA:' + accion);
    }
  });
  Object.keys(declarados).forEach((a) => { if (nombres.indexOf(a) < 0) { problemas.push('MODO_DE_ACCION_INEXISTENTE:' + a); } });
  return problemas;
}

function leerFuentesDeBackend(raiz) {
  const dir = path.join(raiz, 'backend', 'src');
  const fuentes = {};
  fs.readdirSync(dir).filter((f) => f.endsWith('.js')).forEach((f) => { fuentes[f] = fs.readFileSync(path.join(dir, f), 'utf8'); });
  return fuentes;
}

module.exports = { limpiar, indexarFunciones, alcanzables, accionesDePost, auditar, leerFuentesDeBackend, PROHIBIDO_EN_PUBLICO, COMPUERTAS_DE_SESION };
