// DiagnosticoPermisosE10 (E10-2): herramientas MANUALES (se corren a mano desde el editor de Apps Script; ningun endpoint, trigger ni pantalla las llama) para auditar la COHERENCIA de los permisos.
//
//   diagnosticoPermisosE10()      MATRIZ por usuario: lo que dice la hoja (celda cruda), lo que el sistema normaliza, el acceso EFECTIVO que calcula el backend, el objeto `permisos` que devuelve
//                                 checkSession (con la funcion REAL handleCheckSession y un token firmado en memoria) y lo que hay en el cache de acceso. Marca anomalias por usuario y por hoja.
//                                 Un usuario con "todo" en la hoja que NO recibe todo de forma efectiva queda marcado TODO_DECLARADO_NO_EFECTIVO.
//   diagnosticoGatesAdminE10()    Con E10_ADMIN_USUARIOS_ACTIVO APAGADO, pega por doPost (el camino real del Web App) a los siete endpoints administrativos con la sesion de un administrador, de un
//                                 usuario normal, de un EXTERNO y de un token invalido, y compara cada respuesta con la esperada. Se NIEGA a correr si el flag esta encendido.
//
// SOLO LECTURA, de forma estricta: lee la hoja Usuarios (valores), el cache de acceso (get) y las propiedades de los flags. NO escribe celdas, ni filas, ni columnas, ni hojas, ni Script Properties, NO toma
// el lock, NO crea triggers, NO manda Telegram ni emails y NO llama a Google. Unico efecto posible: el mismo que tiene cualquier checkSession (handleCheckSession -> getUserAccess guarda el acceso POSITIVO
// de un usuario activo en el cache, ~5 min, con el MISMO valor que escribiria su proximo pedido). diagnosticoGatesAdminE10 reemplaza logHistoryEvent y telegramRepository_sendMessage por contadores mientras
// corre (se restauran SIEMPRE) y envia cuerpos VACIOS: aunque el flag cambiara a mitad de la corrida, ningun endpoint tiene con que modificar a un usuario (el cuerpo no pasaria la validacion).
//
// PRIVACIDAD: emails enmascarados (a***@dominio) y cada persona identificada por su NUMERO DE FILA en la hoja Usuarios; nunca se imprime un token, un secreto, un nombre completo ni un id de Drive.
// La logica es PURA (diagPermE10_*, se testea sin Google); las lecturas reales viven en diagPermE10_depsReales().
var DIAG_PERM_E10_VERSION = 1;
var DIAG_PERM_E10_FUNCIONES_SIN_EFECTOS = ['logHistoryEvent', 'telegramRepository_sendMessage'];
var DIAG_PERM_E10_ACCIONES_ADMIN = ['adminUsuariosListar', 'adminPermisosCatalogo', 'adminUsuarioObtener', 'adminUsuarioCrear', 'adminUsuarioActualizar', 'adminUsuarioDesactivar', 'adminUsuarioReactivar'];

function diagPerm_mascara(email) {
  var t = String(email === null || email === undefined ? '' : email).trim();
  var arroba = t.indexOf('@');
  return arroba < 1 ? '***' : t.charAt(0) + '***' + t.substring(arroba);
}

function diagPerm_norm(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

// Categoria de UNA celda de permiso, tal cual esta en la hoja (nunca el valor completo de un texto largo).
//   SI / NO                      exactos
//   SI_NO_EXACTO / NO_NO_EXACTO  el sistema los lee igual que SI / NO (mayusculas o espacios), pero no son el valor canonico
//   VACIA                        cuenta como NO
//   BOOL_TRUE / BOOL_FALSE       casilla de verificacion de Sheets: el sistema lee 'true' (NO es 'si') => NO
//   NUMERO                       cuenta como NO
//   OTRO:"..."                   cualquier otro texto (p. ej. "Sí" con tilde): cuenta como NO
function diagPerm_categoriaCelda(v) {
  if (v === null || v === undefined || (typeof v === 'string' && v === '')) {
    return 'VACIA';
  }
  if (typeof v === 'boolean') {
    return v ? 'BOOL_TRUE' : 'BOOL_FALSE';
  }
  if (typeof v === 'number') {
    return 'NUMERO';
  }
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return 'FECHA';
  }
  var t = String(v);
  if (t === 'SI') {
    return 'SI';
  }
  if (t === 'NO') {
    return 'NO';
  }
  var n = t.trim().toLowerCase();
  if (n === 'si') {
    return 'SI_NO_EXACTO';
  }
  if (n === 'no') {
    return 'NO_NO_EXACTO';
  }
  if (n === '') {
    return 'VACIA';
  }
  return 'OTRO:' + JSON.stringify(t.slice(0, 12));
}

function diagPerm_listaDe(permisos) {
  var p = permisos || {};
  return permisosCatalogo_ids().filter(function (id) { return p[id] === true; });
}

function diagPerm_diferencia(a, b) {
  return a.filter(function (x) { return b.indexOf(x) < 0; });
}

// Analisis de los ENCABEZADOS de la hoja: faltantes, repetidos y desconocidos (un typo como "ubicacion " o "ubicación" aparece como desconocido y la columna real como faltante).
function diagPerm_encabezados(header) {
  var crudos = (header || []).map(function (h) { return String(h === null || h === undefined ? '' : h); });
  var normalizados = crudos.map(function (h) { return h.trim().toLowerCase(); });
  var esperadas = sheetUserRepository_columnas();
  var faltantes = esperadas.filter(function (c) { return normalizados.indexOf(c) < 0; });
  var repetidos = esperadas.filter(function (c) { return normalizados.indexOf(c) >= 0 && normalizados.indexOf(c) !== normalizados.lastIndexOf(c); });
  var noEstrictos = [];
  var desconocidos = [];
  crudos.forEach(function (h, i) {
    if (normalizados[i] !== '' && esperadas.indexOf(normalizados[i]) >= 0 && h !== normalizados[i]) {
      noEstrictos.push(JSON.stringify(h.slice(0, 30)));
    }
    if (esperadas.indexOf(normalizados[i]) < 0) {
      desconocidos.push(JSON.stringify(h.slice(0, 30)));
    }
  });
  return { faltantes: faltantes, repetidos: repetidos, noEstrictosPeroLeidos: noEstrictos, desconocidos: desconocidos };
}

// deps: { tabla() -> {existe, header, filas}, cache(email) -> texto|null, estadoReal(email) -> getUserStatus, checkSession(email) -> respuesta de handleCheckSession, flags() -> {admin, gestionExternos, emailVerified} }
function diagPerm_construir(deps) {
  var salida = { version: DIAG_PERM_E10_VERSION, soloLectura: true, errores: [], flags: null, hoja: null, usuarios: [], resumen: null };
  var catalogo = permisosCatalogo_ids();
  try {
    salida.flags = deps.flags();
  } catch (err) {
    salida.errores.push('FLAGS_NO_LEIDOS');
  }
  var tabla;
  try {
    tabla = deps.tabla();
  } catch (err2) {
    salida.errores.push('HOJA_USUARIOS_NO_LEIDA');
    return salida;
  }
  if (!tabla || tabla.existe !== true) {
    salida.errores.push('HOJA_USUARIOS_INEXISTENTE');
    return salida;
  }
  var indices = sheetUserRepository_indiceColumnas(tabla.header);
  salida.hoja = { filasDeDatos: tabla.filas.length, encabezados: diagPerm_encabezados(tabla.header) };

  // primera fila de cada email (la que gana en getUserStatus) y cuantas veces aparece
  var ganadora = {};
  var apariciones = {};
  tabla.filas.forEach(function (row, i) {
    var e = indices.email >= 0 ? diagPerm_norm(row[indices.email]) : '';
    if (e === '') {
      return;
    }
    apariciones[e] = (apariciones[e] || 0) + 1;
    if (ganadora[e] === undefined) {
      ganadora[e] = i + 2;
    }
  });

  var resumen = { usuarios: 0, activos: 0, conAnomalias: 0, todoDeclarado: 0, todoDeclaradoNoEfectivo: 0, porAnomalia: {} };
  tabla.filas.forEach(function (row, i) {
    var fila = i + 2;
    var emailCrudo = indices.email >= 0 ? row[indices.email] : '';
    var email = diagPerm_norm(emailCrudo);
    if (email === '' && row.every(function (c) { return diagPerm_norm(c) === ''; })) {
      return;
    }
    var anom = [];
    var estadoTxt = diagPerm_norm(sheetUserRepository_celda(row, indices, 'estado'));
    var tipoCrudo = String(sheetUserRepository_celda(row, indices, 'tipo')).trim();
    var tipo = usuariosDominio_normalizarTipo(tipoCrudo);
    var activo = estadoTxt === 'activo';

    // celdas crudas de cada permiso del catalogo
    var celdas = {};
    var declaradosMapa = sheetUserRepository_permisosDeFila(row, indices);
    catalogo.forEach(function (id) {
      var idx = indices[id];
      var cat = idx === undefined || idx < 0 ? 'SIN_COLUMNA' : diagPerm_categoriaCelda(row[idx]);
      if (cat !== 'SI' && cat !== 'NO') {
        celdas[id] = cat;
      }
    });
    var declarados = diagPerm_listaDe(declaradosMapa);
    var efectivosFila = activo ? diagPerm_listaDe(usuariosDominio_permisosEfectivos(declaradosMapa, tipo)) : [];

    if (email === '' || !usuariosDominio_emailValido(email)) {
      anom.push('EMAIL_INVALIDO_O_VACIO');
    }
    if (estadoTxt !== 'activo' && estadoTxt !== 'inactivo') {
      anom.push('ESTADO_RARO');
    }
    if (tipoCrudo === '' || tipo === '') {
      anom.push('TIPO_VACIO_O_INVALIDO');
    }
    Object.keys(celdas).forEach(function (id) {
      var c = celdas[id];
      if (c === 'SIN_COLUMNA') {
        anom.push('SIN_COLUMNA:' + id);
      } else if (c === 'SI_NO_EXACTO' || c === 'NO_NO_EXACTO') {
        anom.push('CELDA_NO_CANONICA:' + id);
      } else if (c === 'VACIA') {
        anom.push('CELDA_VACIA_CUENTA_NO:' + id);
      } else {
        anom.push('CELDA_NO_RECONOCIDA_CUENTA_NO:' + id);
      }
    });
    // dependencias del catalogo (el login NO las aplica, pero un permiso sin su dependencia no es utilizable en la administracion)
    permisosCatalogo_lista().forEach(function (p) {
      if (declaradosMapa[p.id] === true) {
        p.dependeDe.forEach(function (dep) {
          if (declaradosMapa[dep] !== true) {
            anom.push('DEPENDENCIA_FALTANTE:' + p.id + '->' + dep);
          }
        });
      }
    });
    if (declaradosMapa.usuarios_admin === true && tipo !== 'INTERNO') {
      anom.push('ADMIN_DECLARADO_NO_EFECTIVO_POR_TIPO');
    }
    var esGanadora = ganadora[email] === fila;
    if (email !== '' && apariciones[email] > 1) {
      anom.push(esGanadora ? 'EMAIL_DUPLICADO_GANA_ESTA_FILA' : 'EMAIL_DUPLICADO_FILA_IGNORADA');
    }

    // lo que realmente devuelve el sistema para ese email (solo la fila ganadora)
    var real = null;
    var checkSession = null;
    var cache = null;
    if (esGanadora && usuariosDominio_emailValido(email)) {
      try {
        var st = deps.estadoReal(email);
        var acc = usuariosDominio_accesoEfectivo(st);
        real = { activo: acc.active, tipo: acc.tipo, efectivos: diagPerm_listaDe(acc.permisos) };
      } catch (err3) {
        real = { error: 'ESTADO_NO_LEIDO' };
      }
      try {
        var txt = deps.cache(email);
        if (txt === null || txt === undefined) {
          cache = 'SIN_ENTRADA';
        } else {
          var obj = JSON.parse(txt);
          cache = { activo: obj.active === true, efectivos: diagPerm_listaDe(obj.permisos) };
        }
      } catch (err4) {
        cache = 'CACHE_ILEGIBLE';
      }
      try {
        var cs = deps.checkSession(email);
        checkSession = cs && cs.status === 'ok' ? { ok: true, efectivos: diagPerm_listaDe(cs.data && cs.data.permisos), claves: cs.data && cs.data.permisos ? Object.keys(cs.data.permisos).length : 0 } : { ok: false, code: cs && cs.code ? cs.code : 'SIN_CODIGO' };
      } catch (err5) {
        checkSession = { ok: false, code: 'CHECKSESSION_LANZO' };
      }
      if (real && real.efectivos && diagPerm_diferencia(efectivosFila, real.efectivos).concat(diagPerm_diferencia(real.efectivos, efectivosFila)).length > 0) {
        anom.push('EFECTIVOS_FILA_DISTINTOS_DE_GETUSERACCESS');
      }
      if (real && real.efectivos && checkSession && checkSession.ok && diagPerm_diferencia(real.efectivos, checkSession.efectivos).concat(diagPerm_diferencia(checkSession.efectivos, real.efectivos)).length > 0) {
        anom.push('CHECKSESSION_DISTINTO_DE_EFECTIVOS');
      }
      if (real && real.activo === true && checkSession && checkSession.ok !== true) {
        anom.push('CHECKSESSION_RECHAZA_A_UN_ACTIVO:' + checkSession.code);
      }
      if (real && real.efectivos && cache && cache !== 'SIN_ENTRADA' && cache !== 'CACHE_ILEGIBLE' && diagPerm_diferencia(real.efectivos, cache.efectivos).concat(diagPerm_diferencia(cache.efectivos, real.efectivos)).length > 0) {
        anom.push('CACHE_ANTERIOR_DISTINTO_DE_LA_HOJA');
      }
    }

    var todoDeclarado = declarados.length === catalogo.length;
    var efectivosFinales = real && real.efectivos ? real.efectivos : efectivosFila;
    var todoEfectivo = efectivosFinales.length === catalogo.length;
    if (todoDeclarado && activo && !todoEfectivo) {
      anom.push('TODO_DECLARADO_NO_EFECTIVO');
    }
    var declaradosNoEfectivos = diagPerm_diferencia(declarados, efectivosFinales);

    resumen.usuarios += 1;
    if (activo) {
      resumen.activos += 1;
    }
    if (todoDeclarado) {
      resumen.todoDeclarado += 1;
    }
    if (todoDeclarado && activo && !todoEfectivo) {
      resumen.todoDeclaradoNoEfectivo += 1;
    }
    if (anom.length > 0) {
      resumen.conAnomalias += 1;
    }
    anom.forEach(function (a) {
      var clave = a.split(':')[0];
      resumen.porAnomalia[clave] = (resumen.porAnomalia[clave] || 0) + 1;
    });

    salida.usuarios.push({
      fila: fila,
      email: diagPerm_mascara(emailCrudo),
      estado: estadoTxt === '' ? '(vacio)' : estadoTxt,
      tipo: tipo === '' ? '(vacio/invalido)' : tipo,
      declarados: declarados,
      declaradosNoEfectivos: declaradosNoEfectivos,
      efectivos: efectivosFinales,
      noTiene: diagPerm_diferencia(catalogo, efectivosFinales),
      checkSession: checkSession,
      cache: cache,
      celdasNoCanonicas: celdas,
      anomalias: anom
    });
  });
  salida.resumen = resumen;
  return salida;
}

function diagPerm_depsReales() {
  return {
    flags: function () {
      var a = e10Flags_leerPropiedad(E10_PROP_ADMIN_USUARIOS);
      var g = e10Flags_leerPropiedad(E10_PROP_GESTION_EXTERNOS);
      return {
        adminUsuarios: a === 'SI' ? 'ENCENDIDO' : (a === null ? 'AUSENTE (apagado)' : 'APAGADO'),
        gestionExternos: g === 'SI' ? 'ENCENDIDO' : (g === null ? 'AUSENTE (apagado)' : 'APAGADO'),
        emailVerified: e10Flags_emailVerifiedModo().modo
      };
    },
    tabla: function () { return sheetUserRepository_leerTabla(); },
    cache: function (email) { return CacheService.getScriptCache().get(authService_claveCache(USER_ACCESS_CACHE_PREFIJO, email)); },
    estadoReal: function (email) { return sheetUserRepository_getUserStatus(email); },
    checkSession: function (email) { return handleCheckSession(createSessionToken(email)); }
  };
}

function diagnosticoPermisosE10() {
  var informe;
  try {
    informe = diagPerm_construir(diagPerm_depsReales());
  } catch (err) {
    informe = { version: DIAG_PERM_E10_VERSION, soloLectura: true, errores: ['DIAGNOSTICO_FALLO:' + String(err && err.name ? err.name : 'Error').slice(0, 40)] };
  }
  var texto = JSON.stringify(informe);
  Logger.log(texto);
  return informe;
}

// --- gates administrativos con el flag APAGADO ---

function diagPerm_sinEfectos(fn) {
  var global_ = typeof globalThis !== 'undefined' ? globalThis : this;
  var originales = {};
  var contadores = {};
  var instalado = true;
  DIAG_PERM_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) { contadores[nombre] = 0; });
  try {
    DIAG_PERM_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) {
      originales[nombre] = global_[nombre];
      var cuenta = function () {
        contadores[nombre] = contadores[nombre] + 1;
        return nombre === 'telegramRepository_sendMessage' ? { ok: true } : undefined;
      };
      global_[nombre] = cuenta;
      if (global_[nombre] !== cuenta) {
        instalado = false;
      }
    });
    if (instalado) {
      fn();
    }
  } finally {
    DIAG_PERM_E10_FUNCIONES_SIN_EFECTOS.forEach(function (nombre) {
      if (Object.prototype.hasOwnProperty.call(originales, nombre)) {
        global_[nombre] = originales[nombre];
      }
    });
  }
  return { instalado: instalado, contadores: contadores };
}

// Elige los actores de la prueba a partir de la hoja (sin escribirla): administradores efectivos, hasta 2 INTERNO no administradores, los EXTERNO activos y un inactivo si lo hay.
function diagPerm_actores(tabla) {
  var indices = sheetUserRepository_indiceColumnas(tabla.header);
  var vistos = {};
  var actores = [];
  var internosNormales = 0;
  tabla.filas.forEach(function (row, i) {
    var email = indices.email >= 0 ? diagPerm_norm(row[indices.email]) : '';
    if (email === '' || vistos[email] === true || !usuariosDominio_emailValido(email)) {
      return;
    }
    vistos[email] = true;
    var activo = diagPerm_norm(sheetUserRepository_celda(row, indices, 'estado')) === 'activo';
    var tipo = usuariosDominio_normalizarTipo(sheetUserRepository_celda(row, indices, 'tipo'));
    var crudos = sheetUserRepository_permisosDeFila(row, indices);
    var admin = activo && tipo === 'INTERNO' && crudos.usuarios_admin === true;
    var etiqueta = null;
    var esperado = null;
    if (!activo) {
      etiqueta = 'INACTIVO';
      esperado = 'USER_DISABLED';
    } else if (admin) {
      etiqueta = 'ADMIN_REAL';
      esperado = 'E10_ADMIN_INACTIVO';
    } else if (tipo === 'EXTERNO') {
      etiqueta = 'EXTERNO' + (crudos.usuarios_admin === true ? '_CON_USUARIOS_ADMIN_MANIPULADO' : '');
      esperado = 'PERMISSION_DENIED';
    } else if (tipo === 'INTERNO' && internosNormales < 2) {
      internosNormales += 1;
      etiqueta = 'INTERNO_NO_ADMIN';
      esperado = 'PERMISSION_DENIED';
    }
    if (etiqueta !== null) {
      actores.push({ fila: i + 2, email: email, etiqueta: etiqueta, esperado: esperado });
    }
  });
  return actores;
}

// deps: { flagAdmin() -> bool, tabla(), token(email), llamar(token, accion) -> respuesta, sinEfectos(fn) }
function diagPerm_gates(deps) {
  var salida = { version: DIAG_PERM_E10_VERSION, soloEnFlagApagado: true, abortado: null, instaladoSinEfectos: null, resultados: [], faltas: [], ok: false };
  if (deps.flagAdmin() === true) {
    salida.abortado = 'E10_ADMIN_USUARIOS_ACTIVO esta ENCENDIDO: esta prueba solo corre con el flag APAGADO. No se llamo a ningun endpoint.';
    return salida;
  }
  var tabla = deps.tabla();
  if (!tabla || tabla.existe !== true) {
    salida.abortado = 'HOJA_USUARIOS_INEXISTENTE';
    return salida;
  }
  var actores = diagPerm_actores(tabla);
  var p = deps.sinEfectos(function () {
    actores.forEach(function (a) {
      var fila = { fila: a.fila, email: diagPerm_mascara(a.email), actor: a.etiqueta, esperado: a.esperado, respuestas: {} };
      var token = deps.token(a.email);
      DIAG_PERM_E10_ACCIONES_ADMIN.forEach(function (accion) {
        var r = deps.llamar(token, accion);
        var codigo = r && r.status === 'ok' ? 'OK(!)' : (r && r.code ? r.code : 'SIN_CODIGO');
        fila.respuestas[accion] = codigo;
        if (codigo !== a.esperado) {
          salida.faltas.push(a.etiqueta + ' fila ' + a.fila + ' ' + accion + ': esperado ' + a.esperado + ', obtenido ' + codigo);
        }
      });
      salida.resultados.push(fila);
    });
    var invalido = { fila: null, email: '(token invalido)', actor: 'TOKEN_INVALIDO', esperado: 'UNAUTHORIZED', respuestas: {} };
    DIAG_PERM_E10_ACCIONES_ADMIN.forEach(function (accion) {
      var r = deps.llamar('token-invalido', accion);
      var codigo = r && r.status === 'ok' ? 'OK(!)' : (r && r.code ? r.code : 'SIN_CODIGO');
      invalido.respuestas[accion] = codigo;
      if (codigo !== 'UNAUTHORIZED') {
        salida.faltas.push('TOKEN_INVALIDO ' + accion + ': esperado UNAUTHORIZED, obtenido ' + codigo);
      }
    });
    salida.resultados.push(invalido);
  });
  salida.instaladoSinEfectos = p.instalado;
  salida.historialYTelegramSuprimidos = p.contadores;
  if (!p.instalado) {
    salida.abortado = 'EFECTOS_NO_SUPRIMIBLES: no se pudo reemplazar logHistoryEvent / telegramRepository_sendMessage; NO se llamo a ningun endpoint';
    return salida;
  }
  var hayAdmin = salida.resultados.some(function (r) { return r.actor === 'ADMIN_REAL'; });
  var hayNormal = salida.resultados.some(function (r) { return r.actor === 'INTERNO_NO_ADMIN'; });
  salida.cobertura = { adminReal: hayAdmin, internoNoAdmin: hayNormal, externos: salida.resultados.filter(function (r) { return r.actor.indexOf('EXTERNO') === 0; }).length };
  salida.ok = salida.faltas.length === 0 && hayAdmin && hayNormal;
  return salida;
}

function diagPerm_depsGatesReales() {
  return {
    flagAdmin: function () { return e10Flags_adminUsuariosActivo(); },
    tabla: function () { return sheetUserRepository_leerTabla(); },
    token: function (email) { return createSessionToken(email); },
    llamar: function (token, accion) {
      var salida = doPost({ postData: { contents: JSON.stringify({ action: accion, sessionToken: token }) } });
      return JSON.parse(salida.getContent());
    },
    sinEfectos: diagPerm_sinEfectos
  };
}

function diagnosticoGatesAdminE10() {
  var informe;
  try {
    informe = diagPerm_gates(diagPerm_depsGatesReales());
  } catch (err) {
    informe = { version: DIAG_PERM_E10_VERSION, ok: false, abortado: 'DIAGNOSTICO_FALLO:' + String(err && err.name ? err.name : 'Error').slice(0, 40) };
  }
  Logger.log(JSON.stringify(informe));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DIAG_PERM_E10_VERSION,
    DIAG_PERM_E10_ACCIONES_ADMIN,
    DIAG_PERM_E10_FUNCIONES_SIN_EFECTOS,
    diagPerm_categoriaCelda,
    diagPerm_encabezados,
    diagPerm_construir,
    diagPerm_depsReales,
    diagPerm_actores,
    diagPerm_gates,
    diagPerm_depsGatesReales,
    diagPerm_sinEfectos,
    diagnosticoPermisosE10,
    diagnosticoGatesAdminE10
  };
}
