// E10Migracion (E10-1): migracion MANUAL, IDEMPOTENTE y con ROLLBACK de la hoja Usuarios al esquema de E10-1. NINGUN endpoint, trigger ni despliegue la ejecuta: se corre a mano desde el editor de Apps Script.
//
//   migracionE10Planificar()   SOLO LECTURA. Valida el esquema y los parametros, e informa EXACTAMENTE que se escribiria (columnas, valores por usuario, conflictos). No escribe nada.
//   migracionE10Ejecutar()     ESCRIBE. Re-planifica (si hay algun bloqueo o conflicto NO escribe nada), hace un RESPALDO de la hoja Usuarios, agrega las 6 columnas nuevas en UNA escritura, completa lo que falte
//                              y registra un evento USUARIO_MIGRADO por usuario en UsuariosEventos. Si algo falla despues de escribir, revierte lo que agrego. Idempotente: una segunda corrida no cambia nada.
//   migracionE10Revertir()     ESCRIBE. Quita las 6 columnas que agrego la migracion (nada mas) y deja un evento USUARIO_MIGRACION_REVERTIDA por usuario. Se NIEGA si ya hubo operaciones administrativas o
//                              si alguien modifico las columnas migradas.
//
// QUE ESCRIBE: SOLO columnas NUEVAS al final de la tabla. Ninguna celda existente se modifica: ningun permiso actual cambia (un test lo comprueba fila por fila).
//   tipo               INTERNO para todos, EXTERNO para los emails de `externos`
//   version            1
//   actualizado_utc    instante de la corrida (UTC, ISO-8601), el mismo para todas las filas
//   actualizado_por    'migracion:E10-1'   (valor institucional de la migracion: no es una persona)
//   usuarios_admin     SI para los emails de `admins`; NO para el resto
//   mapa               SI para las filas con estado activo; NO para las demas (hoy todo usuario activo recibe el dataset: nadie pierde acceso)
// PARAMETROS (sin ningun email en el codigo): Script Property E10_MIGRACION_PARAMETROS, JSON {"admins": ["email", ...], "externos": ["email", ...]}. Los carga a mano quien ejecuta la migracion.
// Reglas: cada email debe existir en la hoja; los admins deben estar ACTIVOS y no ser externos (un EXTERNO nunca puede ser administrador); hay al menos un admin; no se repiten emails.
//
// PRECONDICIONES de Ejecutar: hoja UsuariosEventos creada (setupUsuariosEventosSheet), parametros validos, esquema actual completo (los 15 permisos de siempre), sin emails duplicados ni invalidos, estados
// activo/inactivo. Se toma el script lock durante toda la escritura.
var MIGRACION_E10_PROP_PARAMETROS = 'E10_MIGRACION_PARAMETROS';
var MIGRACION_E10_ACTUALIZADO_POR = 'migracion:E10-1';
var MIGRACION_E10_COLUMNAS = ['tipo', 'version', 'actualizado_utc', 'actualizado_por', 'usuarios_admin', 'mapa'];
var MIGRACION_E10_PERMISOS_NUEVOS = ['usuarios_admin', 'mapa'];
var MIGRACION_E10_LOCK_MS = 30000;

function migracionE10_norm(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

function migracionE10_mascara(email) {
  var i = String(email).indexOf('@');
  return i < 1 ? '***' : String(email).charAt(0) + '***' + String(email).slice(i);
}

function migracionE10_errorSeguro(err) {
  try {
    return String(err && err.message ? err.message : err).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').slice(0, 160);
  } catch (e) {
    return 'error sin detalle';
  }
}

// Parametros (texto JSON o objeto) -> {ok:true, admins:[email], externos:[email]} o {ok:false, motivo}. Emails normalizados, sin repetidos.
function migracionE10_leerParametros(crudo) {
  if (crudo === null || crudo === undefined || String(crudo).trim() === '') {
    return { ok: false, motivo: 'PARAMETROS_AUSENTES' };
  }
  var p;
  try {
    p = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
  } catch (err) {
    return { ok: false, motivo: 'PARAMETROS_JSON_INVALIDO' };
  }
  if (!p || typeof p !== 'object' || !Array.isArray(p.admins) || !Array.isArray(p.externos)) {
    return { ok: false, motivo: 'PARAMETROS_FORMA_INVALIDA' };
  }
  function lista(a) {
    var salida = [];
    a.forEach(function (e) {
      var n = usuariosDominio_normalizarEmail(e);
      if (salida.indexOf(n) < 0) {
        salida.push(n);
      }
    });
    return salida;
  }
  return { ok: true, admins: lista(p.admins), externos: lista(p.externos) };
}

// PLAN (puro, sin Google). tabla = {header, filas} (valores de la hoja sin encabezado en `filas`); params = {admins, externos} ya leidos; ahoraIso = instante de la corrida.
// Devuelve {ok, bloqueos:[{codigo, detalle}], conflictos:[{fila, columna, actual, esperado}], columnasPorAgregar:[...], celdasPorCompletar:[{fila, columna, valor}], usuarios:[...], yaAplicada, resumen}.
// `ok` = sin bloqueos ni conflictos. Nunca incluye una escritura sobre una columna que ya existia con valor.
function migracionE10_planificar(tabla, params, ahoraIso) {
  var bloqueos = [];
  var conflictos = [];
  var header = (tabla && Array.isArray(tabla.header) ? tabla.header : []).map(migracionE10_norm);
  var filas = tabla && Array.isArray(tabla.filas) ? tabla.filas : [];
  function idx(c) { return header.indexOf(c); }
  function bloquear(codigo, detalle) { bloqueos.push({ codigo: codigo, detalle: detalle }); }

  ['email', 'nombre', 'estado'].forEach(function (c) { if (idx(c) < 0) { bloquear('FALTA_COLUMNA', c); } });
  var catalogo = permisosCatalogo_ids();
  var actuales = catalogo.filter(function (id) { return MIGRACION_E10_PERMISOS_NUEVOS.indexOf(id) < 0; });
  actuales.forEach(function (c) { if (idx(c) < 0) { bloquear('ESQUEMA_ACTUAL_INCOMPLETO', c); } });
  catalogo.concat(['email', 'nombre', 'estado', 'fecha_alta'], MIGRACION_E10_COLUMNAS).forEach(function (c) {
    if (idx(c) >= 0 && idx(c) !== header.lastIndexOf(c)) { bloquear('COLUMNA_REPETIDA', c); }
  });
  if (!params || params.ok !== true) {
    bloquear(params && params.motivo ? params.motivo : 'PARAMETROS_AUSENTES', '');
  }

  // usuarios (filas con datos)
  var usuarios = [];
  var vistos = {};
  filas.forEach(function (row, i) {
    if (!Array.isArray(row) || row.every(function (c) { return migracionE10_norm(c) === ''; })) {
      return;
    }
    var email = idx('email') >= 0 ? usuariosDominio_normalizarEmail(row[idx('email')]) : '';
    var estadoCrudo = idx('estado') >= 0 ? migracionE10_norm(row[idx('estado')]) : '';
    var fila = i + 2;
    if (!usuariosDominio_emailValido(email)) {
      bloquear('EMAIL_INVALIDO', 'fila ' + fila);
      return;
    }
    if (vistos[email] !== undefined) {
      bloquear('EMAIL_DUPLICADO', 'filas ' + vistos[email] + ' y ' + fila);
      return;
    }
    vistos[email] = fila;
    if (estadoCrudo !== 'activo' && estadoCrudo !== 'inactivo') {
      bloquear('ESTADO_NO_ESTANDAR', 'fila ' + fila);
    }
    var permisosActuales = [];
    actuales.forEach(function (c) { if (idx(c) >= 0 && migracionE10_norm(row[idx(c)]) === 'si') { permisosActuales.push(c); } });
    usuarios.push({ fila: fila, email: email, nombre: idx('nombre') >= 0 ? String(row[idx('nombre')] === null || row[idx('nombre')] === undefined ? '' : row[idx('nombre')]).trim() : '', activo: estadoCrudo === 'activo', permisosActuales: permisosActuales, _row: row });
  });
  if (usuarios.length === 0) {
    bloquear('SIN_USUARIOS', '');
  }

  // parametros contra la hoja
  var admins = params && params.ok === true ? params.admins : [];
  var externos = params && params.ok === true ? params.externos : [];
  if (params && params.ok === true) {
    if (admins.length < 1) { bloquear('SIN_ADMINISTRADORES', 'admins esta vacio'); }
    admins.concat(externos).forEach(function (e) {
      if (vistos[e] === undefined) { bloquear('EMAIL_DE_PARAMETROS_NO_EXISTE', migracionE10_mascara(e)); }
    });
    admins.forEach(function (e) {
      if (externos.indexOf(e) >= 0) { bloquear('ADMIN_EXTERNO', migracionE10_mascara(e)); }
      var u = usuarios.filter(function (x) { return x.email === e; })[0];
      if (u && !u.activo) { bloquear('ADMIN_INACTIVO', migracionE10_mascara(e)); }
    });
  }

  // valores planificados por usuario
  var planeado = usuarios.map(function (u) {
    var esExterno = externos.indexOf(u.email) >= 0;
    var esAdmin = admins.indexOf(u.email) >= 0;
    return {
      fila: u.fila, email: u.email, nombre: u.nombre, activo: u.activo, permisosActuales: u.permisosActuales,
      tipo: esExterno ? 'EXTERNO' : 'INTERNO', version: 1, actualizado_utc: ahoraIso, actualizado_por: MIGRACION_E10_ACTUALIZADO_POR,
      usuarios_admin: esAdmin ? 'SI' : 'NO', mapa: u.activo ? 'SI' : 'NO', _row: u._row
    };
  });

  // columnas por agregar y celdas por completar / conflictos en columnas que ya existen
  var columnasPorAgregar = MIGRACION_E10_COLUMNAS.filter(function (c) { return idx(c) < 0; });
  var celdasPorCompletar = [];
  MIGRACION_E10_COLUMNAS.forEach(function (c) {
    if (idx(c) < 0) {
      return;
    }
    planeado.forEach(function (u) {
      var actual = migracionE10_norm(u._row[idx(c)]);
      if (actual === '') {
        celdasPorCompletar.push({ fila: u.fila, columna: c, valor: u[c] });
      } else if (c === 'actualizado_utc') {
        // un instante de una corrida parcial anterior: cualquier valor no vacio se respeta
      } else if (actual !== migracionE10_norm(u[c])) {
        conflictos.push({ fila: u.fila, columna: c, actual: actual.slice(0, 30), esperado: String(u[c]) });
      }
    });
  });

  var usuariosPublicos = planeado.map(function (u) {
    return { fila: u.fila, nombre: u.nombre, email: migracionE10_mascara(u.email), estado: u.activo ? 'activo' : 'inactivo', tipo: u.tipo, usuarios_admin: u.usuarios_admin, mapa: u.mapa, permisosActuales: u.permisosActuales.length };
  });
  var ok = bloqueos.length === 0 && conflictos.length === 0;
  return {
    ok: ok,
    bloqueos: bloqueos,
    conflictos: conflictos,
    columnasPorAgregar: columnasPorAgregar,
    celdasPorCompletar: celdasPorCompletar,
    usuarios: usuariosPublicos,
    _planeado: planeado,
    yaAplicada: ok && columnasPorAgregar.length === 0 && celdasPorCompletar.length === 0,
    resumen: {
      usuarios: planeado.length,
      activos: planeado.filter(function (u) { return u.activo; }).length,
      mapaSI: planeado.filter(function (u) { return u.mapa === 'SI'; }).length,
      admins: planeado.filter(function (u) { return u.usuarios_admin === 'SI'; }).length,
      internos: planeado.filter(function (u) { return u.tipo === 'INTERNO'; }).length,
      externos: planeado.filter(function (u) { return u.tipo === 'EXTERNO'; }).length,
      columnasPorAgregar: columnasPorAgregar.length,
      celdasPorCompletar: celdasPorCompletar.length
    }
  };
}

// La matriz [fila de datos][columna nueva] de las columnas por agregar, en el orden de MIGRACION_E10_COLUMNAS (solo las que faltan).
function migracionE10_matrizDeColumnas(plan) {
  return plan._planeado.map(function (u) {
    return plan.columnasPorAgregar.map(function (c) { return u[c]; });
  });
}

// Un evento USUARIO_MIGRADO por usuario: permisos ANTES = los 15 de siempre en SI; DESPUES = esos + usuarios_admin / mapa segun la migracion. `respaldo` = nombre de la hoja de respaldo (queda en `motivo`).
function migracionE10_eventos(plan, respaldo) {
  return plan._planeado.map(function (u) {
    var despues = u.permisosActuales.slice();
    if (u.mapa === 'SI') { despues.push('mapa'); }
    if (u.usuarios_admin === 'SI') { despues.push('usuarios_admin'); }
    var orden = permisosCatalogo_ids();
    return {
      evento: 'USUARIO_MIGRADO',
      usuarioObjetivo: u.email,
      nombreObjetivo: u.nombre,
      nombreAnterior: u.nombre,
      ejecutadoPor: MIGRACION_E10_ACTUALIZADO_POR,
      tipoAnterior: '',
      tipoNuevo: u.tipo,
      estadoAnterior: u.activo ? 'activo' : 'inactivo',
      estadoNuevo: u.activo ? 'activo' : 'inactivo',
      versionAnterior: 0,
      versionNueva: 1,
      permisosAntes: orden.filter(function (id) { return u.permisosActuales.indexOf(id) >= 0; }).join(','),
      permisosDespues: orden.filter(function (id) { return despues.indexOf(id) >= 0; }).join(','),
      motivo: 'respaldo: ' + respaldo,
      clientRequestId: '',
      origen: 'MIGRACION'
    };
  });
}

function migracionE10_nombreRespaldo(ahoraIso) {
  // con milisegundos: dos corridas (p. ej. migrar, revertir y volver a migrar) nunca chocan en el nombre del respaldo
  return 'Usuarios_backup_E10-1_' + String(ahoraIso).replace(/[-:.]/g, '').slice(0, 18) + 'Z';
}

// Crea el respaldo con ese nombre; si ya existe una hoja con el mismo nombre (dos corridas en el mismo instante) agrega un sufijo _2, _3... Nunca pisa un respaldo.
function migracionE10_crearRespaldoUnico(base) {
  for (var i = 0; i < 20; i += 1) {
    var nombre = i === 0 ? base : base + '_' + (i + 1);
    try {
      return sheetUserRepository_crearRespaldo(nombre);
    } catch (err) {
      if (String(err && err.message ? err.message : err).indexOf('RESPALDO_YA_EXISTE') !== 0) {
        throw err;
      }
    }
  }
  throw new Error('RESPALDO_NO_DISPONIBLE: no se pudo elegir un nombre libre');
}

// --- entradas de Apps Script (a mano) ---

function migracionE10_leerPlan() {
  var tabla = sheetUserRepository_leerTabla();
  var ahoraIso = new Date().toISOString();
  if (tabla.existe !== true) {
    return { tabla: tabla, plan: { ok: false, bloqueos: [{ codigo: 'USUARIOS_NO_EXISTE', detalle: '' }], conflictos: [], columnasPorAgregar: [], celdasPorCompletar: [], usuarios: [], _planeado: [], yaAplicada: false, resumen: {} }, ahoraIso: ahoraIso };
  }
  var params = migracionE10_leerParametros(e10Flags_leerPropiedad(MIGRACION_E10_PROP_PARAMETROS));
  return { tabla: tabla, params: params, plan: migracionE10_planificar(tabla, params, ahoraIso), ahoraIso: ahoraIso };
}

function migracionE10_publico(plan, extra) {
  var salida = { ok: plan.ok, yaAplicada: plan.yaAplicada, bloqueos: plan.bloqueos, conflictos: plan.conflictos.slice(0, 20), columnasPorAgregar: plan.columnasPorAgregar, resumen: plan.resumen, usuarios: plan.usuarios };
  if (extra) {
    Object.keys(extra).forEach(function (k) { salida[k] = extra[k]; });
  }
  return salida;
}

function migracionE10Planificar() {
  var salida;
  try {
    var leido = migracionE10_leerPlan();
    salida = migracionE10_publico(leido.plan, { soloLectura: true, actualizado_por: MIGRACION_E10_ACTUALIZADO_POR, parametrosEnPropiedad: MIGRACION_E10_PROP_PARAMETROS });
    if (leido.params && leido.params.ok !== true) {
      salida.plantillaParametros = { admins: ['<email de cada administrador inicial>'], externos: ['<email de cada usuario externo>'] };
      salida.usuariosParaElegir = (leido.tabla.filas || []).filter(function (r) { return Array.isArray(r) && r.some(function (c) { return migracionE10_norm(c) !== ''; }); }).length;
    }
  } catch (err) {
    salida = { ok: false, soloLectura: true, error: 'NO_SE_PUDO_PLANIFICAR: ' + migracionE10_errorSeguro(err) };
  }
  Logger.log(JSON.stringify(salida, null, 1));
  return salida;
}

function migracionE10Ejecutar() {
  var salida;
  var lock = null;
  var agregoColumnas = null;
  var completoCeldas = [];
  try {
    var leido = migracionE10_leerPlan();
    var plan = leido.plan;
    if (!plan.ok) {
      salida = migracionE10_publico(plan, { ejecutada: false, motivo: 'PLAN_NO_OK: no se escribio nada' });
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    if (plan.yaAplicada) {
      salida = migracionE10_publico(plan, { ejecutada: false, motivo: 'YA_APLICADA: no hay nada que escribir' });
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    // la auditoria tiene que existir ANTES de escribir (fail-closed): sin UsuariosEventos no se migra
    var auditoria = usuariosEventosRepository_abrir();
    lock = LockService.getScriptLock();
    lock.waitLock(MIGRACION_E10_LOCK_MS);
    // re-planificar bajo lock (un cambio concurrente invalida el plan)
    var leido2 = migracionE10_leerPlan();
    if (!leido2.plan.ok || JSON.stringify(leido2.plan.celdasPorCompletar) !== JSON.stringify(plan.celdasPorCompletar) || leido2.plan.columnasPorAgregar.join() !== plan.columnasPorAgregar.join()) {
      salida = migracionE10_publico(leido2.plan, { ejecutada: false, motivo: 'LA_HOJA_CAMBIO_DURANTE_LA_MIGRACION: reintentar' });
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    plan = leido2.plan;
    var respaldo = migracionE10_crearRespaldoUnico(migracionE10_nombreRespaldo(leido2.ahoraIso));
    if (plan.columnasPorAgregar.length > 0) {
      sheetUserRepository_agregarColumnas(plan.columnasPorAgregar, migracionE10_matrizDeColumnas(plan));
      agregoColumnas = plan.columnasPorAgregar.slice();
    }
    if (plan.celdasPorCompletar.length > 0) {
      sheetUserRepository_escribirCeldas(plan.celdasPorCompletar);
      completoCeldas = plan.celdasPorCompletar.slice();
    }
    usuariosEventosRepository_agregar(auditoria, migracionE10_eventos(plan, respaldo), usuariosEventosRepository_ultimaSecuencia(usuariosEventosRepository_leer(auditoria)), MIGRACION_E10_ACTUALIZADO_POR);
    salida = migracionE10_publico(plan, { ejecutada: true, respaldo: respaldo, eventos: plan._planeado.length });
  } catch (err) {
    // falla DESPUES de escribir: se revierte lo que agrego esta corrida (columnas nuevas o celdas completadas)
    var revertido = true;
    try {
      if (agregoColumnas) {
        sheetUserRepository_quitarColumnas(agregoColumnas);
      }
      if (completoCeldas.length > 0) {
        sheetUserRepository_escribirCeldas(completoCeldas.map(function (c) { return { fila: c.fila, columna: c.columna, valor: '' }; }));
      }
    } catch (err2) {
      revertido = false;
    }
    salida = { ok: false, ejecutada: false, error: 'MIGRACION_FALLIDA: ' + migracionE10_errorSeguro(err), revertido: revertido, nota: revertido ? 'se revirtio lo escrito; el respaldo (si se creo) queda como hoja' : 'REVISAR la hoja Usuarios a mano y usar el respaldo' };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (e) { /* expira solo */ }
    }
  }
  Logger.log(JSON.stringify(salida, null, 1));
  return salida;
}

// Rollback: quita SOLO las 6 columnas de la migracion. Condiciones (si no se cumplen NO toca nada): UsuariosEventos legible; todos sus eventos son USUARIO_MIGRADO de origen MIGRACION (ninguna operacion
// administrativa posterior: revertir borraria version/tipo que ya se usan); las columnas migradas siguen tal como las dejo la migracion (version 1, actualizado_por institucional).
function migracionE10_planRevertir(tabla, eventos) {
  var header = (tabla.header || []).map(migracionE10_norm);
  var presentes = MIGRACION_E10_COLUMNAS.filter(function (c) { return header.indexOf(c) >= 0; });
  var motivos = [];
  if (presentes.length === 0) {
    return { ok: false, nada: true, motivos: ['NADA_QUE_REVERTIR'], presentes: [] };
  }
  var ajenos = (eventos || []).filter(function (e) { return e.evento !== 'USUARIO_MIGRADO' || e.origen !== 'MIGRACION'; });
  if (ajenos.length > 0) {
    motivos.push('HAY_OPERACIONES_ADMINISTRATIVAS');
  }
  var iVersion = header.indexOf('version');
  var iPor = header.indexOf('actualizado_por');
  (tabla.filas || []).forEach(function (row) {
    if (!Array.isArray(row) || row.every(function (c) { return migracionE10_norm(c) === ''; })) {
      return;
    }
    if ((iVersion >= 0 && migracionE10_norm(row[iVersion]) !== '1') || (iPor >= 0 && migracionE10_norm(row[iPor]) !== migracionE10_norm(MIGRACION_E10_ACTUALIZADO_POR))) {
      if (motivos.indexOf('COLUMNAS_MODIFICADAS_DESPUES_DE_MIGRAR') < 0) {
        motivos.push('COLUMNAS_MODIFICADAS_DESPUES_DE_MIGRAR');
      }
    }
  });
  return { ok: motivos.length === 0, nada: false, motivos: motivos, presentes: presentes };
}

function migracionE10Revertir() {
  var salida;
  var lock = null;
  try {
    var tabla = sheetUserRepository_leerTabla();
    if (tabla.existe !== true) {
      salida = { ok: false, revertida: false, motivo: 'USUARIOS_NO_EXISTE' };
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    var auditoria = usuariosEventosRepository_abrir();
    lock = LockService.getScriptLock();
    lock.waitLock(MIGRACION_E10_LOCK_MS);
    var eventos = usuariosEventosRepository_leer(auditoria);
    var plan = migracionE10_planRevertir(tabla, eventos);
    if (!plan.ok) {
      salida = { ok: false, revertida: false, motivos: plan.motivos, nota: plan.nada ? 'las columnas de E10-1 no estan en la hoja' : 'no se toco nada' };
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    var header = tabla.header.map(migracionE10_norm);
    var usuarios = [];
    tabla.filas.forEach(function (row, i) {
      if (!Array.isArray(row) || row.every(function (c) { return migracionE10_norm(c) === ''; })) {
        return;
      }
      usuarios.push({ email: usuariosDominio_normalizarEmail(row[header.indexOf('email')]), nombre: String(row[header.indexOf('nombre')] === undefined ? '' : row[header.indexOf('nombre')]).trim(), activo: migracionE10_norm(row[header.indexOf('estado')]) === 'activo', tipo: usuariosDominio_normalizarTipo(row[header.indexOf('tipo')]) });
    });
    var quitadas = sheetUserRepository_quitarColumnas(plan.presentes);
    var eventosRev = usuarios.map(function (u) {
      return { evento: 'USUARIO_MIGRACION_REVERTIDA', usuarioObjetivo: u.email, nombreObjetivo: u.nombre, nombreAnterior: u.nombre, ejecutadoPor: MIGRACION_E10_ACTUALIZADO_POR, tipoAnterior: u.tipo, tipoNuevo: '', estadoAnterior: u.activo ? 'activo' : 'inactivo', estadoNuevo: u.activo ? 'activo' : 'inactivo', versionAnterior: 1, versionNueva: 0, permisosAntes: '', permisosDespues: '', motivo: 'rollback de E10-1', clientRequestId: '', origen: 'MIGRACION' };
    });
    try {
      usuariosEventosRepository_agregar(auditoria, eventosRev, usuariosEventosRepository_ultimaSecuencia(eventos), MIGRACION_E10_ACTUALIZADO_POR);
    } catch (err) {
      salida = { ok: true, revertida: true, columnasQuitadas: quitadas, auditoria: 'FALLO: las columnas se quitaron pero el evento no se pudo escribir; dejar constancia a mano' };
      Logger.log(JSON.stringify(salida, null, 1));
      return salida;
    }
    salida = { ok: true, revertida: true, columnasQuitadas: quitadas, eventos: eventosRev.length };
  } catch (err) {
    salida = { ok: false, revertida: false, error: 'REVERSION_FALLIDA: ' + migracionE10_errorSeguro(err) };
  } finally {
    if (lock) {
      try { lock.releaseLock(); } catch (e) { /* expira solo */ }
    }
  }
  Logger.log(JSON.stringify(salida, null, 1));
  return salida;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MIGRACION_E10_PROP_PARAMETROS,
    MIGRACION_E10_ACTUALIZADO_POR,
    MIGRACION_E10_COLUMNAS,
    migracionE10_leerParametros,
    migracionE10_planificar,
    migracionE10_matrizDeColumnas,
    migracionE10_eventos,
    migracionE10_nombreRespaldo,
    migracionE10_crearRespaldoUnico,
    migracionE10_planRevertir,
    migracionE10Planificar,
    migracionE10Ejecutar,
    migracionE10Revertir
  };
}
