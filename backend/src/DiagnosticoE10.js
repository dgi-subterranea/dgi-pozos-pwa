// DiagnosticoE10 (E10-1, paso 0): herramienta MANUAL de SOLO LECTURA para medir el estado real antes de decidir las migraciones de E10-1. NINGUN endpoint, trigger ni pantalla la llama.
//
//   diagnosticoE10UsuariosPermisos()   Se corre a mano desde el editor de Apps Script. Informa en el Logger (y devuelve) UN JSON con las secciones:
//                                      usuarios | mapa | ubicacion | administradores | tipo | email_verified | telegram | recomendaciones
//                                      (puede superar lo que Apps Script muestra en el registro: para consultar por partes usar las funciones siguientes)
//   diagnosticoE10Administradores()    UNA seccion por ejecucion, con el MISMO calculo y un tope de tamano para que el registro no se trunque:
//   diagnosticoE10Tipo()               administradores | tipo | email_verified | telegram | recomendaciones
//   diagnosticoE10EmailVerified()
//   diagnosticoE10Telegram()
//   diagnosticoE10Recomendaciones()
//
// SOLO LECTURA, de forma estricta: lee las hojas Usuarios, UbicacionFuenteSugerencias, UbicacionCorrecciones, UbicacionCorreccionesLog y UbicacionFuenteDecisiones (valores) y cuenta las filas de
// Busquedas e Historial (sin leer su contenido). NO escribe celdas, NO agrega filas ni columnas, NO crea hojas, NO escribe Script Properties, NO toca el cache ni el lock, NO crea triggers, NO manda
// Telegram ni emails, NO llama a Google (no autentica a nadie) y NO usa ningun secreto. Un test fuerza esto de dos maneras (hojas/propiedades/cache que LANZAN ante cualquier escritura y una guarda
// sobre el texto de este archivo).
//
// PRIVACIDAD de lo que imprime: nunca tokens, secretos, ids de Drive ni contenido de ITF. Los emails salen ENMASCARADOS (f***@gmail.com) y se identifica a cada persona por su NUMERO DE FILA en la hoja
// Usuarios; solo se muestran completos (nombre + email) los candidatos a administrador, que es lo unico que el usuario necesita ver completo para decidir. Se leen solo las columnas necesarias de
// cada hoja (email, evento, fecha), nunca pozos, coordenadas, motivos ni observaciones.
//
// La logica de calculo es PURA (diagE10_*, testeable sin Google); las lecturas viven en diagE10_depsReales(). Cada lectura va en su propio try: un fallo se informa como codigo, nunca como error crudo.
// Los permisos se leen con las MISMAS funciones del login (sheetUserRepository_indiceColumnas / _leerPermiso): el diagnostico mide exactamente lo que el sistema interpreta hoy.
var DIAG_E10_VERSION = 1;
var DIAG_E10_COLUMNAS_PROPUESTAS = ['tipo', 'version', 'actualizado_utc', 'actualizado_por', 'usuarios_admin', 'mapa'];
var DIAG_E10_COLUMNAS_NO_PERMISO = ['email', 'nombre', 'estado', 'fecha_alta'];
var DIAG_E10_MODULOS_BUSQUEDA = ['perfil', 'datos', 'ubicacion', 'ne'];
var DIAG_E10_CORREO_PERSONAL = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.ar', 'outlook.com', 'outlook.com.ar', 'live.com', 'live.com.ar', 'yahoo.com', 'yahoo.com.ar', 'icloud.com', 'me.com', 'msn.com', 'proton.me', 'protonmail.com'];
var DIAG_E10_HOJAS = {
  usuarios: 'Usuarios',
  sugerencias: 'UbicacionFuenteSugerencias',
  correcciones: 'UbicacionCorrecciones',
  correccionesLog: 'UbicacionCorreccionesLog',
  decisiones: 'UbicacionFuenteDecisiones',
  busquedas: 'Busquedas',
  historial: 'Historial'
};
// Como se lee cada hoja de autores: columna del email, columna del evento (si la hay) y que eventos cuentan (evento -> clave). claveUnica = cada fila cuenta como esa clave.
var DIAG_E10_FUENTES_AUTORES = {
  sugerencias: { hoja: 'sugerencias', email: 'email', evento: 'evento', fecha: 'timestampUtc', eventos: { PROPUESTA: 'sugerencias', CANCELADA: 'cancelaciones' } },
  correcciones: { hoja: 'correcciones', email: 'emailPropone', evento: null, fecha: 'timestamp', claveUnica: 'correcciones' },
  correccionesLog: { hoja: 'correccionesLog', email: 'email', evento: 'evento', fecha: 'timestamp', eventos: { PROPUESTA: 'correcciones_log' } },
  decisiones: { hoja: 'decisiones', email: 'email', evento: null, fecha: 'timestampUtc', claveUnica: 'decisiones' }
};
var DIAG_E10_CLAVES_MUTACION = ['sugerencias', 'cancelaciones', 'correcciones', 'correcciones_log'];
var DIAG_E10_MAX_LISTA = 50;
var DIAG_E10_MAX_ADMIN_CANDIDATOS = 15;

// --- utilidades puras ---

// Permisos de MODERACION / validacion del catalogo (E10-1: la lista sale del catalogo canonico, no se repite aca).
function diagE10_autoridad() {
  return permisosCatalogo_lista().filter(function (p) { return p.categoria === 'moderacion'; }).map(function (p) { return p.id; });
}

function diagE10_texto(v) {
  if (v === null || v === undefined) {
    return '';
  }
  if (v instanceof Date) {
    return isNaN(v.getTime()) ? '' : v.toISOString();
  }
  if (typeof v === 'object') {
    return '';
  }
  return String(v);
}

function diagE10_norm(v) {
  return diagE10_texto(v).trim().toLowerCase();
}

function diagE10_emailValido(e) {
  return typeof e === 'string' && e.length > 0 && e.length <= 254 && /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(e);
}

function diagE10_mascara(email) {
  var i = String(email).indexOf('@');
  if (i < 1) {
    return '***';
  }
  return String(email).charAt(0) + '***' + String(email).slice(i);
}

function diagE10_dominio(email) {
  var i = String(email).indexOf('@');
  return i < 0 ? '' : String(email).slice(i + 1);
}

function diagE10_nombre(v) {
  return diagE10_texto(v).trim().replace(/\s+/g, ' ').slice(0, 40);
}

function diagE10_errorSeguro(err) {
  try {
    return String(err && err.message ? err.message : err).replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '<email>').slice(0, 120);
  } catch (e) {
    return 'error sin detalle';
  }
}

// [2,3,4,7,9,10] -> "2-4,7,9-10"
function diagE10_rangos(numeros) {
  var n = (numeros || []).slice().sort(function (a, b) { return a - b; });
  var partes = [];
  var i = 0;
  while (i < n.length) {
    var j = i;
    while (j + 1 < n.length && n[j + 1] === n[j] + 1) {
      j += 1;
    }
    partes.push(j > i ? n[i] + '-' + n[j] : String(n[i]));
    i = j + 1;
  }
  return partes.join(',');
}

function diagE10_fecha(v) {
  var t = diagE10_texto(v);
  var m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1] : '';
}

function diagE10_lista(items) {
  var lista = items || [];
  return lista.length > DIAG_E10_MAX_LISTA ? { items: lista.slice(0, DIAG_E10_MAX_LISTA), truncada: true, total: lista.length } : { items: lista, truncada: false, total: lista.length };
}

function diagE10_persona(u, extra) {
  return 'fila ' + u.fila + ' | ' + (u.nombre || '(sin nombre)') + ' | ' + diagE10_mascara(u.email) + (extra ? ' | ' + extra : '');
}

// --- usuarios (puro) ---

// data = valores de la hoja Usuarios (fila 1 = encabezado) o null si la hoja no existe. Devuelve el analisis con los datos internos (emails completos) que usan las demas secciones; el informe
// publico se arma despues y nunca los expone.
function diagE10_analizarUsuarios(data) {
  var out = { existe: false, legible: false, columnas: null, filasLeidas: 0, filasVacias: 0, filasConDatos: 0, filasValidas: 0, filasEmailInvalido: [], estadosCrudos: {}, duplicados: [], efectivos: [], permisosCols: [], permisosResumen: {}, activosFilas: 0, inactivosFilas: 0 };
  if (data === null || data === undefined) {
    return out;
  }
  out.existe = true;
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    return out;
  }
  out.legible = true;
  var header = data[0];
  var normHeaders = header.map(diagE10_norm);
  var indices = sheetUserRepository_indiceColumnas(header);
  // E10-1: el indice del repositorio incluye ahora las columnas propuestas (mapa, usuarios_admin, tipo...). Este diagnostico sigue midiendo lo ACTUAL: las propuestas se informan aparte.
  var esperadas = Object.keys(indices).filter(function (c) { return DIAG_E10_COLUMNAS_PROPUESTAS.indexOf(c) < 0; });
  var permisosCols = esperadas.filter(function (c) { return DIAG_E10_COLUMNAS_NO_PERMISO.indexOf(c) < 0; });
  out.permisosCols = permisosCols;
  var vistos = {};
  var repetidas = [];
  normHeaders.forEach(function (h) {
    if (h === '') {
      return;
    }
    if (vistos[h] === true && repetidas.indexOf(h) < 0) {
      repetidas.push(h);
    }
    vistos[h] = true;
  });
  var presentes = esperadas.filter(function (c) { return indices[c] >= 0; });
  var propuestas = {};
  DIAG_E10_COLUMNAS_PROPUESTAS.forEach(function (c) { propuestas[c] = normHeaders.indexOf(c) >= 0; });
  out.columnas = {
    detectadas: normHeaders.filter(function (h) { return h !== ''; }).map(function (h) { return h.slice(0, 40); }),
    actualesPresentes: presentes,
    actualesFaltantes: esperadas.filter(function (c) { return indices[c] < 0; }),
    repetidas: repetidas,
    desconocidas: normHeaders.filter(function (h) { return h !== '' && esperadas.indexOf(h) < 0 && DIAG_E10_COLUMNAS_PROPUESTAS.indexOf(h) < 0; }).map(function (h) { return h.slice(0, 40); }),
    propuestasE10: propuestas,
    emailPresente: indices.email >= 0,
    estadoPresente: indices.estado >= 0
  };
  permisosCols.forEach(function (c) { out.permisosResumen[c] = { columna: indices[c] >= 0, vacios: 0, invalidos: 0, activosSI: 0, inactivosSI: 0 }; });

  var primero = {};
  var grupos = {};
  for (var i = 1; i < data.length; i += 1) {
    out.filasLeidas += 1;
    var row = data[i];
    if (!Array.isArray(row) || row.every(function (c) { return diagE10_texto(c).trim() === ''; })) {
      out.filasVacias += 1;
      continue;
    }
    out.filasConDatos += 1;
    var email = indices.email >= 0 ? diagE10_norm(row[indices.email]) : '';
    var estado = indices.estado >= 0 ? diagE10_norm(row[indices.estado]) : '';
    var claveEstado = estado === '' ? '(vacio)' : estado.slice(0, 20);
    if (Object.keys(out.estadosCrudos).length < 12 || out.estadosCrudos[claveEstado] !== undefined) {
      out.estadosCrudos[claveEstado] = (out.estadosCrudos[claveEstado] || 0) + 1;
    } else {
      out.estadosCrudos['(otros)'] = (out.estadosCrudos['(otros)'] || 0) + 1;
    }
    permisosCols.forEach(function (c) {
      if (indices[c] < 0) {
        return;
      }
      var crudo = diagE10_norm(row[indices[c]]);
      if (crudo === '') {
        out.permisosResumen[c].vacios += 1;
      } else if (crudo !== 'si' && crudo !== 'no') {
        out.permisosResumen[c].invalidos += 1;
      }
    });
    if (!diagE10_emailValido(email)) {
      out.filasEmailInvalido.push(i + 1);
      continue;
    }
    out.filasValidas += 1;
    var perm = {};
    permisosCols.forEach(function (c) { perm[c] = sheetUserRepository_leerPermiso(row, indices, c) === true; });
    var u = { fila: i + 1, email: email, nombre: indices.nombre >= 0 ? diagE10_nombre(row[indices.nombre]) : '', activo: estado === 'activo', estadoCrudo: estado, perm: perm };
    if (u.activo) {
      out.activosFilas += 1;
    } else {
      out.inactivosFilas += 1;
    }
    (grupos[email] = grupos[email] || []).push(u);
    if (primero[email] === undefined) {
      primero[email] = u;
      out.efectivos.push(u);
    }
  }
  Object.keys(grupos).forEach(function (email) {
    if (grupos[email].length > 1) {
      var estados = grupos[email].map(function (g) { return g.activo ? 'activo' : 'no-activo'; });
      out.duplicados.push({ email: email, filas: grupos[email].map(function (g) { return g.fila; }), conflictoDeEstado: estados.some(function (e) { return e !== estados[0]; }), gana: grupos[email][0].fila });
    }
  });
  out.efectivos.forEach(function (u) {
    permisosCols.forEach(function (c) {
      if (u.perm[c] === true) {
        out.permisosResumen[c][u.activo ? 'activosSI' : 'inactivosSI'] += 1;
      }
    });
  });
  return out;
}

function diagE10_activos(an) {
  return an.efectivos.filter(function (u) { return u.activo; });
}

function diagE10_informeUsuarios(an) {
  var activos = diagE10_activos(an);
  var inv = diagE10_lista(an.filasEmailInvalido);
  return {
    hoja: { existe: an.existe, legible: an.legible, filasLeidas: an.filasLeidas, filasVacias: an.filasVacias, filasConDatos: an.filasConDatos },
    filasValidas: an.filasValidas,
    activos: an.activosFilas,
    inactivos: an.inactivosFilas,
    usuariosEfectivos: an.efectivos.length,
    activosEfectivos: activos.length,
    inactivosEfectivos: an.efectivos.length - activos.length,
    estadosCrudos: an.estadosCrudos,
    emailsInvalidos: { cantidad: an.filasEmailInvalido.length, filas: diagE10_rangos(inv.items) + (inv.truncada ? ',...' : '') },
    duplicados: {
      grupos: an.duplicados.length,
      conflictoDeEstado: an.duplicados.filter(function (d) { return d.conflictoDeEstado; }).length,
      nota: 'si un email esta repetido, el sistema usa la PRIMERA fila (el login hace first-match)',
      detalle: diagE10_lista(an.duplicados.map(function (d) { return diagE10_mascara(d.email) + ' filas ' + d.filas.join('/') + ' gana ' + d.gana + (d.conflictoDeEstado ? ' (ESTADOS DISTINTOS)' : ''); })).items
    },
    columnas: an.columnas,
    permisos: an.permisosResumen
  };
}

// --- mapa (puro) ---

function diagE10_informeMapa(an) {
  var activos = diagE10_activos(an);
  function n(fn) { return activos.filter(fn).length; }
  var tieneMapa = an.columnas ? an.columnas.propuestasE10.mapa === true : false;
  return {
    universoActivos: activos.length,
    accesoEfectivoHoy: 'backend: getMapaPozos, getUbicacionesValidadas y getDecisionesFuentesDelta responden a TODO usuario activo (sin permiso de modulo); frontend: Cerca mio para todo activo, mapa Provincia con perfil o ne, mapa NE con ne, Buscar reemplazo con reemplazo',
    usoFrontendHoy: {
      cercaMio: activos.length,
      provinciaConPerfilOne: n(function (u) { return u.perm.perfil === true || u.perm.ne === true; }),
      mapaNE: n(function (u) { return u.perm.ne === true; }),
      buscarReemplazo: n(function (u) { return u.perm.reemplazo === true; }),
      soloCercaMio: n(function (u) { return u.perm.perfil !== true && u.perm.ne !== true && u.perm.reemplazo !== true; })
    },
    usoRealMedible: false,
    usoRealNota: 'el uso real NO se puede medir: los tres endpoints de mapa no escriben en Historial (decision de diseno); solo se mide el acceso efectivo',
    columnaMapaExiste: tieneMapa,
    propuesta: {
      criterio: 'mapa = SI para toda fila efectiva con estado activo; NO para el resto',
      recibirianSI: activos.length,
      filasSI: diagE10_rangos(activos.map(function (u) { return u.fila; })),
      recibirianNO: an.efectivos.length - activos.length,
      usuariosActivosQuePerderianAcceso: 0
    }
  };
}

// --- ubicacion (puro) ---

// fuentes = {sugerencias, correcciones, correccionesLog, decisiones}: cada una {estado, filas, eventos:{clave:n}, autores:{email:{clave:n, primera, ultima}}} (ver diagE10_leerAutores)
function diagE10_informeUbicacion(an, fuentes) {
  var activos = diagE10_activos(an);
  var f = fuentes || {};
  var autoresMutacion = {};
  var autoresSug = {};
  var autoresCorr = {};
  var primera = {};
  var ultima = {};
  ['sugerencias', 'correcciones', 'correccionesLog'].forEach(function (k) {
    var fuente = f[k];
    if (!fuente || !fuente.autores) {
      return;
    }
    Object.keys(fuente.autores).forEach(function (email) {
      var reg = fuente.autores[email];
      var cuenta = false;
      DIAG_E10_CLAVES_MUTACION.forEach(function (c) { if (reg[c] > 0) { cuenta = true; } });
      if (!cuenta) {
        return;
      }
      autoresMutacion[email] = true;
      if (reg.sugerencias > 0 || reg.cancelaciones > 0) { autoresSug[email] = true; }
      if (reg.correcciones > 0 || reg.correcciones_log > 0) { autoresCorr[email] = true; }
      if (reg.primera && (!primera[email] || reg.primera < primera[email])) { primera[email] = reg.primera; }
      if (reg.ultima && (!ultima[email] || reg.ultima > ultima[email])) { ultima[email] = reg.ultima; }
    });
  });
  var porEmail = {};
  activos.forEach(function (u) { porEmail[u.email] = u; });
  var autoresActivos = Object.keys(autoresMutacion).filter(function (e) { return porEmail[e] !== undefined; });
  var matriz = {};
  var A = [];
  var B = [];
  var C = [];
  var corregirNuevoConA = [];
  var corregirSinUbicacion = 0;
  var validarSinUbicacion = 0;
  var conCorregir = 0;
  var conValidar = 0;
  var conUbicacion = 0;
  activos.forEach(function (u) {
    var ub = u.perm.ubicacion === true;
    var co = u.perm.ubicacion_corregir === true;
    var va = u.perm.ubicacion_validar === true;
    var au = autoresMutacion[u.email] === true;
    if (ub) { conUbicacion += 1; }
    if (ub && co) { conCorregir += 1; }
    if (ub && va) { conValidar += 1; }
    if (co && !ub) { corregirSinUbicacion += 1; }
    if (va && !ub) { validarSinUbicacion += 1; }
    var clave = (ub ? 'ubicacion' : 'sinUbicacion') + '+' + (co ? 'corregir' : 'sinCorregir') + '+' + (au ? 'autor' : 'sinHistorial');
    matriz[clave] = (matriz[clave] || 0) + 1;
    if (ub) {
      B.push(u);
      if (co || au) {
        A.push(u);
        if (!co) { corregirNuevoConA.push(u); }
        if (!(va && !co)) { C.push(u); }
      }
    }
  });
  var soloB = B.filter(function (u) { return A.indexOf(u) < 0; });
  var difAC = A.filter(function (u) { return C.indexOf(u) < 0; });
  function alt(definicion, lista) { return { definicion: definicion, cantidad: lista.length, filas: diagE10_rangos(lista.map(function (u) { return u.fila; })) }; }
  function resumenFuente(k) {
    var fu = f[k];
    if (!fu) { return { hoja: 'NO_LEIDA' }; }
    return { hoja: fu.estado, filas: fu.filas, eventos: fu.eventos || {}, autoresDistintos: fu.autores ? Object.keys(fu.autores).length : 0 };
  }
  var decisoresActivos = f.decisiones && f.decisiones.autores ? Object.keys(f.decisiones.autores).filter(function (e) { return porEmail[e] !== undefined; }).length : 0;
  return {
    activosConUbicacionSI: conUbicacion,
    conUbicacionCorregirSI: conCorregir,
    conUbicacionValidarSI: conValidar,
    anomalias: { corregirSinUbicacion: corregirSinUbicacion, validarSinUbicacion: validarSinUbicacion },
    historial: {
      sugerencias: resumenFuente('sugerencias'),
      correcciones: resumenFuente('correcciones'),
      correccionesLog: resumenFuente('correccionesLog'),
      decisionesDeValidadores: resumenFuente('decisiones'),
      autoresDistintos: { sugerenciasOCancelaciones: Object.keys(autoresSug).length, correcciones: Object.keys(autoresCorr).length, cualquierMutacion: Object.keys(autoresMutacion).length },
      autoresQueSonUsuariosActivos: autoresActivos.length,
      autoresSinUsuarioActivo: Object.keys(autoresMutacion).length - autoresActivos.length,
      validadoresConDecisiones: decisoresActivos,
      porAutor: diagE10_lista(autoresActivos.map(function (e) {
        var u = porEmail[e];
        return diagE10_persona(u, 'sug/cancel=' + (autoresSug[e] ? 'si' : 'no') + ' corr=' + (autoresCorr[e] ? 'si' : 'no') + ' primera=' + (primera[e] || '?') + ' ultima=' + (ultima[e] || '?') + ' ubicacion=' + (u.perm.ubicacion ? 'SI' : 'NO') + ' corregir=' + (u.perm.ubicacion_corregir ? 'SI' : 'NO') + ' validar=' + (u.perm.ubicacion_validar ? 'SI' : 'NO'));
      })).items
    },
    intersecciones: matriz,
    alternativas: {
      A: alt('ubicacion = SI y (ya tiene ubicacion_corregir o figura como autor historico de sugerencia, cancelacion o correccion)', A),
      B: alt('todos los activos con ubicacion = SI', B),
      C: alt('A sin los validadores que no tienen ubicacion_corregir (deciden directo con decidirFuenteUbicacion: no necesitan sugerir)', C)
    },
    diferencias: {
      pierdenSugerirConA: { cantidad: soloB.length, personas: diagE10_lista(soloB.map(function (u) { return diagE10_persona(u, 'sin ubicacion_corregir y sin historial de mutaciones'); })).items },
      recibenCorregirNuevoConA: { cantidad: corregirNuevoConA.length, nota: 'ubicacion_corregir TAMBIEN habilita proponerCorreccionUbicacion (GPS): estas personas ganarian esa capacidad', personas: diagE10_lista(corregirNuevoConA.map(function (u) { return diagE10_persona(u); })).items },
      cConRespectoAA: difAC.length,
      recibenCorregirNuevoConB: B.filter(function (u) { return u.perm.ubicacion_corregir !== true; }).length
    }
  };
}

// --- administradores (puro) ---

function diagE10_concedidos(u) {
  return Object.keys(u.perm).filter(function (c) { return u.perm[c] === true; });
}

function diagE10_informeAdministradores(an) {
  var activos = diagE10_activos(an);
  var tieneAdmin = an.columnas ? an.columnas.propuestasE10.usuarios_admin === true : false;
  var puntuados = activos.map(function (u) {
    var autoridad = diagE10_autoridad().filter(function (c) { return u.perm[c] === true; });
    return { u: u, autoridad: autoridad, total: diagE10_concedidos(u).length };
  });
  function mejor(a, b) {
    return b.autoridad.length - a.autoridad.length || b.total - a.total || a.u.fila - b.u.fila;
  }
  var porAutoridad = puntuados.filter(function (p) { return p.autoridad.length > 0; }).sort(mejor);
  var elegidos = porAutoridad.map(function (p) { return { p: p, motivo: 'autoridad' }; });
  if (elegidos.length < 2) {
    puntuados.filter(function (p) { return p.autoridad.length === 0; }).sort(mejor).slice(0, 3 - elegidos.length).forEach(function (p) { elegidos.push({ p: p, motivo: 'amplio' }); });
  }
  elegidos = elegidos.slice(0, DIAG_E10_MAX_ADMIN_CANDIDATOS);
  return {
    totalActivos: activos.length,
    criterio: 'activos con al menos uno de ' + diagE10_autoridad().join(', ') + ' (orden: cantidad de esos permisos y luego total de permisos); si hay menos de 2 se agregan los de mas permisos (motivo "amplio")',
    columnaUsuariosAdminExiste: tieneAdmin,
    nota: 'SOLO candidatos para decidir: no se asigna nada. La decision y los emails los define el usuario',
    candidatos: elegidos.map(function (e) {
      return 'fila ' + e.p.u.fila + ' | ' + (e.p.u.nombre || '(sin nombre)') + ' | ' + e.p.u.email + ' | motivo=' + e.motivo + ' | autoridad=' + (e.p.autoridad.join(',') || '-') + ' | permisos(' + e.p.total + ')=' + diagE10_concedidos(e.p.u).join(',');
    }),
    sinCandidatosConAutoridad: porAutoridad.length === 0
  };
}

// --- tipo (puro) ---

function diagE10_informeTipo(an) {
  var activos = diagE10_activos(an);
  var dominios = {};
  var correoPersonal = 0;
  var dudosos = [];
  var motivosCont = { correo_personal: 0, solo_perfil: 0, sin_permisos: 0, sin_nombre: 0 };
  activos.forEach(function (u) {
    var dom = diagE10_dominio(u.email);
    dominios[dom] = (dominios[dom] || 0) + 1;
    var motivos = [];
    var concedidos = diagE10_concedidos(u);
    if (DIAG_E10_CORREO_PERSONAL.indexOf(dom) >= 0) { motivos.push('correo_personal'); correoPersonal += 1; }
    if (concedidos.length === 0) { motivos.push('sin_permisos'); } else if (concedidos.length === 1 && concedidos[0] === 'perfil') { motivos.push('solo_perfil'); }
    if (u.nombre === '') { motivos.push('sin_nombre'); }
    motivos.forEach(function (m) { motivosCont[m] += 1; });
    if (motivos.length > 0) {
      dudosos.push(diagE10_persona(u, 'motivos=' + motivos.join('+') + ' | permisos(' + concedidos.length + ')'));
    }
  });
  var orden = Object.keys(dominios).sort(function (a, b) { return dominios[b] - dominios[a] || (a < b ? -1 : 1); });
  var top = {};
  orden.slice(0, 15).forEach(function (d) { top[d] = dominios[d]; });
  var valores = {};
  if (an.columnas && an.columnas.propuestasE10.tipo === true) {
    valores.nota = 'la columna tipo ya existe: revisar sus valores a mano (este diagnostico no la lee)';
  }
  return {
    columnaTipoExiste: an.columnas ? an.columnas.propuestasE10.tipo === true : false,
    totalActivos: activos.length,
    totalInactivosEfectivos: an.efectivos.length - activos.length,
    dominios: top,
    dominiosDistintos: orden.length,
    correoPersonalGratuito: correoPersonal,
    dudosos: { criterios: 'correo personal (gmail/hotmail/etc.), solo permiso perfil, sin permisos o sin nombre: pueden ser internos legitimos (p. ej. quien usa su gmail) o personas externas', cantidad: dudosos.length, porMotivo: motivosCont, lista: diagE10_lista(dudosos).items },
    parecenInternos: activos.length - dudosos.length,
    sinSenalDeExterno: dudosos.length === 0,
    observacionColumna: valores,
    recomendacion: 'no hay forma automatica de saber si alguien es externo: revisar la lista de dudosos con las personas conocidas. Si se confirma que todas son internas, la migracion escribe tipo = INTERNO a TODAS las filas (activas e inactivas). NO se asigna nada desde este diagnostico'
  };
}

// --- email_verified (estatico) ---

function diagE10_informeEmailVerified() {
  return {
    medibleAhora: false,
    motivo: 'requiere un login real con un idToken de Google; este diagnostico no autentica a nadie ni llama a Google',
    loQueSeSabe: {
      documentacionGoogle: 'tokeninfo devuelve las claims como cadenas: email_verified = "true" (cadena, no booleano)',
      codigoActual: 'el login actual lo lee (=== "true" || === true) y solo lo devuelve en la respuesta como emailVerified; ningun camino lo usa para decidir',
      testsActuales: 'AuthService.test.js usa la cadena "true"'
    },
    formasSegurasDeObservar: [
      'Hoy, sin tocar nada: iniciar sesion en la app productiva con una cuenta propia y mirar en las herramientas del navegador (Red) la RESPUESTA de la accion login: data.emailVerified (booleano ya normalizado). NO copiar ni pegar el cuerpo del PEDIDO, que contiene el idToken.',
      'En E10-1 (paso 5): modo OBSERVAR, que registra en Historial solo una categoria fija (verdadero / falso / ausente / otro) cuando el valor no es verdadero; nunca el token, ni el idToken, ni el valor crudo.'
    ]
  };
}

// --- telegram / telemetria (estatico + conteos) ---

function diagE10_numeroGlobal(nombre) {
  try {
    var v = (typeof globalThis !== 'undefined' ? globalThis : this)[nombre];
    return typeof v === 'number' ? v : null;
  } catch (e) {
    return null;
  }
}

function diagE10_informeTelegram(an, filasBusquedas, filasHistorial) {
  var activos = diagE10_activos(an);
  function n(fn) { return activos.filter(fn).length; }
  var conModulo = n(function (u) { return DIAG_E10_MODULOS_BUSQUEDA.some(function (m) { return u.perm[m] === true; }); });
  var conPerfil = n(function (u) { return u.perm.perfil === true; });
  return {
    estatico: true,
    sinEfectos: 'no se envio Telegram ni se escribio Busquedas: solo conteo de usuarios y lectura de constantes',
    quienPuedeInvocar: {
      registerWellSearch: 'cualquier usuario con sesion valida y ACTIVO, con un wellId de formato DD-PPPP (departamento 01-19, sin verificar que el pozo exista); sin permiso de modulo. Efectos: una fila en Busquedas y un aviso de Telegram',
      registerDescargaItf: 'cualquier usuario con sesion valida y ACTIVO con un resumen de forma valida (hasta 500 wellId, valores numericos declarados por el cliente); sin permiso de modulo. Efecto: un aviso de Telegram'
    },
    usuariosConAcceso: {
      activos: activos.length,
      conAlgunModuloDeBusqueda: conModulo,
      sinNingunModuloDeBusqueda: activos.length - conModulo,
      conPerfilQueDescargaITF: conPerfil,
      sinPerfil: activos.length - conPerfil,
      detalleModulosDeBusqueda: DIAG_E10_MODULOS_BUSQUEDA
    },
    quedariaDenegadoConLaRecomendacion: {
      registerWellSearch: activos.length - conModulo,
      registerDescargaItf: activos.length - conPerfil
    },
    volumenTeorico: {
      dedupeBusquedaSegundos: diagE10_numeroGlobal('NOTIFY_DEDUPE_SECONDS'),
      dedupeBusquedaClave: 'email + wellId (no hay tope por usuario ni global)',
      dedupeDescargaSegundos: diagE10_numeroGlobal('DESCARGA_ITF_NOTIFY_DEDUPE_SECONDS'),
      dedupeDescargaClave: 'email + solicitados + descargados + fallidos + primer wellId (cambiando un numero se evita el dedupe)',
      maxWellIdsPorResumen: diagE10_numeroGlobal('SELECCION_LOTE_MAX_WELLIDS'),
      wellIdsDistintosValidos: 19 * 10000,
      mensajesTelegramPorUsuario: 'sin tope propio: cada wellId distinto genera un mensaje; el limite real lo ponen Apps Script y Telegram',
      filasBusquedasPorLlamada: 1,
      cuotaUrlFetchDiariaPublicada: { cuentaGratuita: 20000, workspace: 100000, nota: 'valores publicados por Google (verificar en la cuenta); se COMPARTE con el login (tokeninfo) y el storage de fotos: un abuso de Telegram puede dejar sin cupo al resto' },
      limiteTelegramOrientativo: 'unos 20 mensajes por minuto por chat de grupo: superado, Telegram responde 429 y el aviso falla (TELEGRAM_ERROR) sin afectar la respuesta',
      techoCeldasDeUnaHojaDeCalculo: 10000000,
      columnasDeBusquedas: 9,
      filasMaxTeoricasDeBusquedas: Math.floor(10000000 / 9)
    },
    volumenActual: { filasBusquedas: filasBusquedas, filasHistorial: filasHistorial },
    nota: 'el techo diario real de una cuenta con token valido es la cuota de UrlFetch (compartida); el Telegram efectivo es menor por el limite del chat'
  };
}

// --- recomendaciones (puro) ---

function diagE10_recomendaciones(inf) {
  var u = inf.usuarios;
  var bloqueantes = [];
  var avisos = [];
  if (!u.hoja.existe || !u.hoja.legible) { bloqueantes.push('USUARIOS_ILEGIBLE'); }
  if (u.hoja.legible && u.columnas && (!u.columnas.emailPresente || !u.columnas.estadoPresente)) { bloqueantes.push('FALTA_COLUMNA_EMAIL_O_ESTADO'); }
  if (u.duplicados.conflictoDeEstado > 0) { bloqueantes.push('EMAILS_DUPLICADOS_CON_ESTADO_DISTINTO'); }
  var invalidosPermiso = Object.keys(u.permisos || {}).filter(function (c) { return u.permisos[c].invalidos > 0; });
  if (invalidosPermiso.length > 0) { bloqueantes.push('PERMISOS_CON_VALORES_INVALIDOS: ' + invalidosPermiso.join(',')); }
  if (u.hoja.legible && u.activosEfectivos === 0) { bloqueantes.push('SIN_USUARIOS_ACTIVOS'); }
  if (u.duplicados.grupos > 0 && u.duplicados.conflictoDeEstado === 0) { avisos.push('hay ' + u.duplicados.grupos + ' email(s) repetido(s) sin conflicto de estado: conviene depurarlos antes de migrar'); }
  if (u.emailsInvalidos.cantidad > 0) { avisos.push('hay ' + u.emailsInvalidos.cantidad + ' fila(s) con email vacio o invalido (filas ' + u.emailsInvalidos.filas + '): no pueden iniciar sesion; revisar o limpiar'); }
  var estadosRaros = Object.keys(u.estadosCrudos || {}).filter(function (e) { return e !== 'activo' && e !== 'inactivo'; });
  if (estadosRaros.length > 0) { avisos.push('estados distintos de activo/inactivo: ' + estadosRaros.join(', ') + ' (el sistema los trata como NO habilitado; la baja de E10 escribira "inactivo")'); }
  var faltantesPermiso = (u.columnas && u.columnas.actualesFaltantes) ? u.columnas.actualesFaltantes : [];
  if (faltantesPermiso.length > 0) { avisos.push('columnas actuales que faltan en la hoja (permiso en NO para todos): ' + faltantesPermiso.join(', ')); }
  var m = inf.mapa;
  var ub = inf.ubicacion;
  var recs = [];
  recs.push('MAPA: escribir mapa = SI a las ' + m.propuesta.recibirianSI + ' fila(s) activas (filas ' + (m.propuesta.filasSI || '-') + ') y NO al resto; nadie pierde acceso (hoy todo activo recibe el dataset). El uso real del mapa no es medible.');
  var A = ub.alternativas.A;
  var B = ub.alternativas.B;
  if (ub.activosConUbicacionSI === 0) {
    recs.push('UBICACION: no hay activos con ubicacion = SI: el cambio de contrato de sugerir/cancelar no afecta a nadie.');
  } else if (B.cantidad === A.cantidad) {
    recs.push('UBICACION: las alternativas A y B coinciden (' + A.cantidad + ' persona(s)): usar A, sin perder ninguna capacidad ni ampliar la de GPS mas de lo necesario.');
  } else {
    recs.push('UBICACION: A = ' + A.cantidad + ' vs B = ' + B.cantidad + '. Con A, ' + ub.diferencias.pierdenSugerirConA.cantidad + ' persona(s) con ubicacion = SI y sin historial dejarian de ver "Sugerir" (nunca lo usaron segun las hojas); con B nadie pierde nada pero ' + ub.diferencias.recibenCorregirNuevoConB + ' persona(s) ganarian la capacidad de proponer correcciones GPS. Recomendada: A.');
  }
  if (ub.diferencias.recibenCorregirNuevoConA.cantidad > 0) {
    recs.push('UBICACION: ' + ub.diferencias.recibenCorregirNuevoConA.cantidad + ' persona(s) recibirian ubicacion_corregir por historial y asi tambien podrian proponer correcciones GPS: confirmar que corresponde.');
  }
  if (ub.diferencias.cConRespectoAA > 0) {
    recs.push('UBICACION: C excluye a ' + ub.diferencias.cConRespectoAA + ' validador(es) con historial que no tienen ubicacion_corregir (ya deciden directo): es la variante de menor privilegio.');
  }
  recs.push('ADMINISTRADORES: elegir al menos 2 entre los ' + inf.administradores.candidatos.length + ' candidato(s) listados; la decision es del usuario.');
  recs.push('TIPO: ' + inf.tipo.dudosos.cantidad + ' caso(s) dudoso(s) de ' + inf.tipo.totalActivos + ' activo(s); confirmar con las personas conocidas antes de escribir tipo = INTERNO a todas las filas.');
  recs.push('EMAIL_VERIFIED: no medible sin un login real; usar el modo OBSERVAR de E10-1 (o mirar la respuesta de login en el navegador) antes de exigirlo.');
  recs.push('TELEGRAM: ' + inf.telegram.quedariaDenegadoConLaRecomendacion.registerWellSearch + ' usuario(s) activo(s) quedarian sin poder llamar a registerWellSearch y ' + inf.telegram.quedariaDenegadoConLaRecomendacion.registerDescargaItf + ' a registerDescargaItf con la recomendacion de exigir modulo / perfil.');
  return { listoParaMigrar: bloqueantes.length === 0, bloqueantes: bloqueantes, avisos: avisos, recomendaciones: recs };
}

// --- lectura de las hojas de autores (puro: recibe los valores) ---

// data = valores de la hoja (fila 1 = encabezado) o null si no existe. Devuelve {estado: 'OK' | 'NO_EXISTE' | 'VACIA' | 'ESQUEMA_INESPERADO', filas, eventos:{clave:n}, autores:{email:{clave:n, primera, ultima}}}. Solo lee email, evento y fecha.
function diagE10_leerAutores(data, cfg) {
  var out = { estado: 'OK', filas: 0, eventos: {}, autores: {} };
  if (data === null || data === undefined) {
    out.estado = 'NO_EXISTE';
    return out;
  }
  if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
    out.estado = 'VACIA';
    return out;
  }
  var h = data[0].map(diagE10_norm);
  var iEmail = h.indexOf(cfg.email.toLowerCase());
  var iEvento = cfg.evento ? h.indexOf(cfg.evento.toLowerCase()) : -1;
  var iFecha = cfg.fecha ? h.indexOf(cfg.fecha.toLowerCase()) : -1;
  if (iEmail < 0 || (cfg.evento && iEvento < 0)) {
    out.estado = 'ESQUEMA_INESPERADO';
    return out;
  }
  for (var i = 1; i < data.length; i += 1) {
    var row = data[i];
    if (!Array.isArray(row)) {
      continue;
    }
    out.filas += 1;
    var clave = cfg.claveUnica;
    if (cfg.eventos) {
      var ev = diagE10_texto(row[iEvento]).trim().toUpperCase();
      clave = Object.prototype.hasOwnProperty.call(cfg.eventos, ev) ? cfg.eventos[ev] : null;
    }
    if (!clave) {
      continue;
    }
    var email = diagE10_norm(row[iEmail]);
    if (!diagE10_emailValido(email)) {
      continue;
    }
    var reg = out.autores[email] = out.autores[email] || {};
    reg[clave] = (reg[clave] || 0) + 1;
    out.eventos[clave] = (out.eventos[clave] || 0) + 1;
    var fecha = iFecha >= 0 ? diagE10_fecha(row[iFecha]) : '';
    if (fecha) {
      if (!reg.primera || fecha < reg.primera) { reg.primera = fecha; }
      if (!reg.ultima || fecha > reg.ultima) { reg.ultima = fecha; }
    }
  }
  return out;
}

// --- construccion del informe (puro + deps de lectura inyectables) ---

// deps = {datosHoja(nombre) -> valores | null, contarFilas(nombre) -> numero | null}. Cada lectura en su propio try: un fallo se informa como codigo, nunca como error crudo.
function diagE10_construir(deps) {
  var errores = [];
  function leer(nombre) {
    try {
      return { ok: true, data: deps.datosHoja(nombre) };
    } catch (err) {
      errores.push('LECTURA_' + nombre + ': ' + diagE10_errorSeguro(err));
      return { ok: false, data: null };
    }
  }
  var lecUsuarios = leer(DIAG_E10_HOJAS.usuarios);
  var an;
  try {
    an = diagE10_analizarUsuarios(lecUsuarios.data);
  } catch (err) {
    errores.push('ANALISIS_USUARIOS: ' + diagE10_errorSeguro(err));
    an = diagE10_analizarUsuarios(null);
  }
  var fuentes = {};
  Object.keys(DIAG_E10_FUENTES_AUTORES).forEach(function (k) {
    var cfg = DIAG_E10_FUENTES_AUTORES[k];
    var lec = leer(DIAG_E10_HOJAS[cfg.hoja]);
    try {
      fuentes[k] = lec.ok ? diagE10_leerAutores(lec.data, cfg) : { estado: 'ERROR_LECTURA', filas: 0, eventos: {}, autores: {} };
    } catch (err) {
      errores.push('ANALISIS_' + k + ': ' + diagE10_errorSeguro(err));
      fuentes[k] = { estado: 'ERROR_LECTURA', filas: 0, eventos: {}, autores: {} };
    }
  });
  function contar(nombre) {
    try {
      var c = deps.contarFilas(nombre);
      return typeof c === 'number' ? c : null;
    } catch (err) {
      errores.push('CONTEO_' + nombre + ': ' + diagE10_errorSeguro(err));
      return null;
    }
  }
  var informe = {
    version: DIAG_E10_VERSION,
    soloLectura: true,
    usuarios: diagE10_informeUsuarios(an),
    mapa: diagE10_informeMapa(an),
    ubicacion: diagE10_informeUbicacion(an, fuentes),
    administradores: diagE10_informeAdministradores(an),
    tipo: diagE10_informeTipo(an),
    email_verified: diagE10_informeEmailVerified(),
    telegram: diagE10_informeTelegram(an, contar(DIAG_E10_HOJAS.busquedas), contar(DIAG_E10_HOJAS.historial)),
    errores: errores
  };
  informe.recomendaciones = diagE10_recomendaciones(informe);
  return informe;
}

// --- lecturas reales (Apps Script) ---

function diagE10_depsReales() {
  var spreadsheet = SpreadsheetApp.openById(getSpreadsheetId());
  return {
    datosHoja: function (nombre) {
      var hoja = spreadsheet.getSheetByName(nombre);
      return hoja ? hoja.getDataRange().getValues() : null;
    },
    contarFilas: function (nombre) {
      var hoja = spreadsheet.getSheetByName(nombre);
      return hoja ? Math.max(0, hoja.getLastRow() - 1) : null;
    }
  };
}

// --- salidas PARCIALES (presentacion, mismo calculo) ---
//
// El registro de Apps Script se trunca cuando es largo: diagnosticoE10UsuariosPermisos() imprime TODO en un solo JSON. Estas funciones usan EXACTAMENTE el mismo calculo (diagE10_construir) pero
// imprimen UNA seccion cada una, y garantizan un tope de tamano (DIAG_E10_MAX_SALIDA caracteres): si una seccion no entra, se van quitando los ultimos elementos de su lista mas larga y se
// informa cuantos se omitieron (_omitidos_<lista>). Mismas garantias de siempre: solo lectura, emails enmascarados (salvo los candidatos a administrador), sin ninguna API de escritura.
var DIAG_E10_MAX_SALIDA = 6000;

function diagE10_arreglos(nodo, salida) {
  if (nodo !== null && typeof nodo === 'object') {
    Object.keys(nodo).forEach(function (k) {
      var v = nodo[k];
      if (Array.isArray(v)) {
        if (v.length > 0) {
          salida.push({ padre: nodo, clave: k });
        }
        v.forEach(function (x) { diagE10_arreglos(x, salida); });
      } else if (v !== null && typeof v === 'object') {
        diagE10_arreglos(v, salida);
      }
    });
  }
  return salida;
}

// Devuelve {texto, objeto}: el JSON (con sangria de 1 espacio) de una copia de `obj` que no supera `max` caracteres, quitando de a un elemento el ultimo de la lista mas pesada.
function diagE10_ajustarTamano(obj, max) {
  var copia = JSON.parse(JSON.stringify(obj));
  for (var i = 0; i < 2000; i += 1) {
    var texto = JSON.stringify(copia, null, 1);
    if (texto.length <= max) {
      return { texto: texto, objeto: copia };
    }
    var candidatas = diagE10_arreglos(copia, []);
    if (candidatas.length === 0) {
      break;
    }
    var peor = candidatas[0];
    var pesoPeor = -1;
    candidatas.forEach(function (c) {
      var peso = JSON.stringify(c.padre[c.clave]).length;
      if (peso > pesoPeor) { pesoPeor = peso; peor = c; }
    });
    peor.padre[peor.clave].pop();
    peor.padre['_omitidos_' + peor.clave] = (peor.padre['_omitidos_' + peor.clave] || 0) + 1;
  }
  var minimo = { version: DIAG_E10_VERSION, seccion: obj && obj.seccion, soloLectura: true, error: 'SECCION_DEMASIADO_LARGA' };
  return { texto: JSON.stringify(minimo, null, 1), objeto: minimo };
}

// Pura: arma la salida de UNA seccion a partir del informe completo. seccion: una clave de informe (administradores, tipo, email_verified, telegram, recomendaciones, ...).
function diagE10_salidaParcial(informe, seccion) {
  var salida = { version: DIAG_E10_VERSION, seccion: seccion, soloLectura: true };
  salida[seccion] = informe ? informe[seccion] : undefined;
  salida.errores = informe && Array.isArray(informe.errores) ? informe.errores : [];
  return diagE10_ajustarTamano(salida, DIAG_E10_MAX_SALIDA);
}

function diagE10_emitirParcial(seccion) {
  var resultado;
  try {
    resultado = diagE10_salidaParcial(diagE10_construir(diagE10_depsReales()), seccion);
  } catch (err) {
    resultado = diagE10_ajustarTamano({ version: DIAG_E10_VERSION, seccion: seccion, soloLectura: true, error: 'NO_SE_PUDO_CONSTRUIR_EL_INFORME: ' + diagE10_errorSeguro(err) }, DIAG_E10_MAX_SALIDA);
  }
  Logger.log(resultado.texto);
  return resultado.objeto;
}

function diagnosticoE10Administradores() {
  return diagE10_emitirParcial('administradores');
}

function diagnosticoE10Tipo() {
  return diagE10_emitirParcial('tipo');
}

function diagnosticoE10EmailVerified() {
  return diagE10_emitirParcial('email_verified');
}

function diagnosticoE10Telegram() {
  return diagE10_emitirParcial('telegram');
}

function diagnosticoE10Recomendaciones() {
  return diagE10_emitirParcial('recomendaciones');
}

// --- entrada de Apps Script (a mano) ---

function diagnosticoE10UsuariosPermisos() {
  var informe;
  try {
    informe = diagE10_construir(diagE10_depsReales());
  } catch (err) {
    informe = { version: DIAG_E10_VERSION, soloLectura: true, error: 'NO_SE_PUDO_CONSTRUIR_EL_INFORME: ' + diagE10_errorSeguro(err) };
  }
  Logger.log(JSON.stringify(informe, null, 2));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    diagnosticoE10UsuariosPermisos,
    diagnosticoE10Administradores,
    diagnosticoE10Tipo,
    diagnosticoE10EmailVerified,
    diagnosticoE10Telegram,
    diagnosticoE10Recomendaciones,
    diagE10_salidaParcial,
    diagE10_ajustarTamano,
    DIAG_E10_MAX_SALIDA,
    diagE10_construir,
    diagE10_depsReales,
    diagE10_analizarUsuarios,
    diagE10_leerAutores,
    diagE10_informeUbicacion,
    diagE10_informeMapa,
    diagE10_informeAdministradores,
    diagE10_informeTipo,
    diagE10_informeEmailVerified,
    diagE10_informeTelegram,
    diagE10_recomendaciones,
    diagE10_rangos,
    diagE10_mascara,
    diagE10_emailValido,
    DIAG_E10_FUENTES_AUTORES,
    DIAG_E10_HOJAS
  };
}
