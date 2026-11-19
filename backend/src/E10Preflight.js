// E10Preflight (E10-1): verificacion MANUAL y de SOLO LECTURA del estado de E10-1. Se corre a mano desde el editor de Apps Script; ningun endpoint, trigger ni pantalla la llama.
//
//   preflightE10_1()   Informa en el Logger (y devuelve) UN JSON corto con un checklist de booleanos y contadores:
//                      columnas | catalogo | UsuariosEventos | mapa | admins | flags | tipo | consistencia | ultimo admin | modo de email_verified | Telegram (gates)
//
// SOLO LECTURA: lee la hoja Usuarios y UsuariosEventos (valores) y las Script Properties de los flags; NO escribe nada (ni hojas, ni propiedades, ni cache), NO crea hojas, NO invalida cache, NO crea triggers y NO
// manda Telegram ni email. Nunca imprime emails (solo cantidades), tokens, secretos ni ids de Drive.
//
// `listo` = todos los items del checklist en verde. Las ADVERTENCIAS (por ejemplo un solo administrador, o un interruptor encendido que en E10-1 deberia estar apagado) no tumban el `listo`:
// son avisos para quien decide. El preflight tampoco enciende ni apaga nada.
var PREFLIGHT_E10_PERMISOS_BUSQUEDA = ['perfil', 'datos', 'ubicacion', 'ne'];

// --- evaluacion PURA (testeable sin Google) ---

function preflightE10_norm(v) {
  return v === null || v === undefined ? '' : String(v).trim().toLowerCase();
}

// Usuarios de la tabla {header, filas} segun lo que dice la hoja (columnas buscadas por encabezado como el login). Tolera columnas faltantes y filas basura.
function preflightE10_usuarios(tabla) {
  var header = tabla && Array.isArray(tabla.header) ? tabla.header : [];
  var indices = sheetUserRepository_indiceColumnas(header);
  var ids = permisosCatalogo_ids();
  var usuarios = [];
  var vacias = 0;
  ((tabla && tabla.filas) || []).forEach(function (row) {
    if (!Array.isArray(row) || row.every(function (c) { return preflightE10_norm(c) === ''; })) {
      vacias += 1;
      return;
    }
    function celda(col) { return indices[col] >= 0 ? row[indices[col]] : undefined; }
    var permisos = {};
    var invalidos = 0;
    ids.forEach(function (id) {
      permisos[id] = indices[id] >= 0 && preflightE10_norm(row[indices[id]]) === 'si';
      if (indices[id] >= 0) {
        var v = preflightE10_norm(row[indices[id]]);
        if (v !== '' && v !== 'si' && v !== 'no') { invalidos += 1; }
      }
    });
    var email = usuariosDominio_normalizarEmail(celda('email'));
    usuarios.push({
      email: email,
      emailValido: usuariosDominio_emailValido(email),
      estado: usuariosDominio_normalizarEstado(celda('estado')),
      tipoCrudo: preflightE10_norm(celda('tipo')),
      tipo: usuariosDominio_normalizarTipo(celda('tipo')),
      versionCrudo: preflightE10_norm(celda('version')),
      version: usuariosDominio_normalizarVersion(celda('version')),
      actualizadoUtc: preflightE10_norm(celda('actualizado_utc')),
      actualizadoPor: preflightE10_norm(celda('actualizado_por')),
      permisos: permisos,
      permisosInvalidos: invalidos
    });
  });
  return { usuarios: usuarios, vacias: vacias, indices: indices };
}

// estado = {tabla:{existe, header, filas}, eventos:{existe, esquemaOk, filas}, flags:{adminUsuarios:boolean, gestionExternos:boolean, emailVerified:{modo, origen}}}
// Devuelve {version, soloLectura, listo, items:[{id, ok, detalle}], advertencias:[...], contadores:{...}, flags:{...}}.
function preflightE10_evaluar(estado) {
  var e = estado !== null && typeof estado === 'object' ? estado : {};
  var tablaCruda = e.tabla !== null && typeof e.tabla === 'object' ? e.tabla : {};
  var tabla = { existe: tablaCruda.existe === true, header: Array.isArray(tablaCruda.header) ? tablaCruda.header : [], filas: Array.isArray(tablaCruda.filas) ? tablaCruda.filas : [] };
  var eventos = e.eventos || {};
  var flags = e.flags || {};
  var items = [];
  var advertencias = [];
  function item(id, ok, detalle) { items.push({ id: id, ok: ok === true, detalle: detalle }); }

  // 1. columnas
  var plan = sheetUserRepository_planEsquemaCompleto(tabla.header || []);
  item('usuarios_hoja', tabla.existe === true, tabla.existe === true ? 'hoja Usuarios legible' : 'no se pudo leer la hoja Usuarios');
  item('usuarios_columnas', tabla.existe === true && plan.ok, plan.ok ? 'esquema completo (base, ' + permisosCatalogo_ids().length + ' permisos y control)' : 'faltan: ' + plan.faltantes.join(', ') + (plan.repetidas.length ? '; repetidas: ' + plan.repetidas.join(', ') : ''));

  // 2. catalogo
  var lista = permisosCatalogo_lista();
  var idsCat = lista.map(function (p) { return p.id; });
  var unicos = idsCat.every(function (id, i) { return idsCat.indexOf(id) === i; });
  var dependenciasOk = lista.every(function (p) { return p.dependeDe.every(function (d) { return idsCat.indexOf(d) >= 0; }); });
  var categoriasOk = lista.every(function (p) { return PERMISOS_CATALOGO_CATEGORIAS.indexOf(p.categoria) >= 0; });
  var admin = permisosCatalogo_porId('usuarios_admin');
  var adminOk = admin !== null && admin.aplicableExterno === false && admin.aplicableInterno === true;
  var mapaCat = permisosCatalogo_porId('mapa');
  var catalogoOk = unicos && dependenciasOk && categoriasOk && adminOk && mapaCat !== null && idsCat.indexOf('ubicacion_corregir') >= 0;
  item('catalogo', catalogoOk, catalogoOk ? idsCat.length + ' permisos, ids unicos, dependencias y categorias validas, usuarios_admin no aplicable a EXTERNO' : 'el catalogo es inconsistente (ids repetidos, dependencia o categoria invalida, o usuarios_admin / mapa mal definidos)');

  // 3. UsuariosEventos
  item('usuarios_eventos', eventos.existe === true && eventos.esquemaOk === true,
    eventos.existe !== true ? 'la hoja UsuariosEventos NO existe (setupUsuariosEventosSheet)' : (eventos.esquemaOk === true ? 'existe con el esquema esperado (' + String(eventos.filas) + ' evento(s))' : 'existe pero con un esquema inesperado'));

  var u = preflightE10_usuarios(tabla);
  var activos = u.usuarios.filter(function (x) { return x.estado === 'activo'; });

  // 4. mapa
  var sinMapa = activos.filter(function (x) { return x.permisos.mapa !== true; }).length;
  item('mapa', tabla.existe === true && plan.ok && u.usuarios.length > 0 && sinMapa === 0, sinMapa === 0 ? 'los ' + activos.length + ' usuarios activos tienen mapa = SI (nadie pierde el mapa al exigirlo)' : sinMapa + ' usuario(s) activo(s) SIN mapa: perderian el mapa al desplegar el gate');

  // 5. admins efectivos
  var admins = u.usuarios.filter(function (x) { return usuariosDominio_esAdminEfectivo({ estado: x.estado, tipo: x.tipo, permisos: x.permisos }); });
  var externosConAdmin = u.usuarios.filter(function (x) { return x.tipo === 'EXTERNO' && x.permisos.usuarios_admin === true; }).length;
  item('admins', admins.length >= 1 && externosConAdmin === 0, admins.length + ' administrador(es) efectivo(s) (activo + INTERNO + usuarios_admin)' + (externosConAdmin > 0 ? '; ' + externosConAdmin + ' EXTERNO(s) con usuarios_admin = SI (no son administradores efectivos: corregir la hoja)' : ''));
  if (admins.length === 1) {
    advertencias.push('hay UN solo administrador efectivo: conviene tener al menos dos');
  }

  // 5b. E10-3 (politica de autoridad): un EXTERNO nunca valida, modera, anula lo ajeno ni administra. (a) El catalogo tiene que reservar a INTERNO exactamente la autoridad (categorias moderacion y administracion);
  // (b) ninguna fila que no sea INTERNO puede tener esos permisos en SI en la hoja: si los tiene (edicion manual, dato historico) el runtime los anula (inefectivos) pero hay que verlos y limpiarlos a mano.
  // Solo se cuentan filas (nunca emails ni nombres).
  var autoridadOk = lista.every(function (p) { return (p.categoria === 'moderacion' || p.categoria === 'administracion') === (p.aplicableExterno === false); });
  item('politica_autoridad', autoridadOk, autoridadOk ? 'el catalogo reserva a INTERNO la autoridad: ' + permisosCatalogo_noAplicablesExterno().join(', ') : 'el catalogo NO reserva a INTERNO exactamente los permisos de moderacion y administracion');
  var inefectivosPorFila = u.usuarios.map(function (x) { return usuariosDominio_permisosInefectivos(x.permisos, x.tipo); }).filter(function (ids) { return ids.length > 0; });
  var filasConInefectivos = inefectivosPorFila.length;
  item('externos_sin_autoridad', filasConInefectivos === 0, filasConInefectivos === 0 ? 'ningun usuario que no sea INTERNO tiene permisos de autoridad en SI en la hoja' : filasConInefectivos + ' fila(s) NO INTERNO con ' + inefectivosPorFila.reduce(function (t, ids) { return t + ids.length; }, 0) + ' permiso(s) de autoridad en SI en la hoja: son INEFECTIVOS (no se ejercen) pero conviene quitarlos desde Administracion');
  if (filasConInefectivos > 0) {
    advertencias.push(filasConInefectivos + ' usuario(s) no INTERNO tienen permisos de autoridad asignados en la hoja (inefectivos): la hoja no se limpia sola');
  }

  // 6. flags (se informan; en E10-1 deben estar APAGADOS)
  var f = { E10_ADMIN_USUARIOS_ACTIVO: flags.adminUsuarios === true ? 'ENCENDIDO' : 'APAGADO', E10_GESTION_EXTERNOS_ACTIVO: flags.gestionExternos === true ? 'ENCENDIDO' : 'APAGADO' };
  item('flags', true, 'E10_ADMIN_USUARIOS_ACTIVO ' + f.E10_ADMIN_USUARIOS_ACTIVO + ', E10_GESTION_EXTERNOS_ACTIVO ' + f.E10_GESTION_EXTERNOS_ACTIVO + ' (en E10-1 se espera APAGADO)');
  if (flags.adminUsuarios === true) { advertencias.push('E10_ADMIN_USUARIOS_ACTIVO esta ENCENDIDO: en E10-1 deberia estar apagado'); }
  if (flags.gestionExternos === true) { advertencias.push('E10_GESTION_EXTERNOS_ACTIVO esta ENCENDIDO: en E10-1 deberia estar apagado'); }

  // 7. tipo
  var tipoInvalido = u.usuarios.filter(function (x) { return x.tipo === ''; }).length;
  var internos = u.usuarios.filter(function (x) { return x.tipo === 'INTERNO'; }).length;
  var externos = u.usuarios.filter(function (x) { return x.tipo === 'EXTERNO'; }).length;
  item('tipo', tabla.existe === true && plan.ok && u.usuarios.length > 0 && tipoInvalido === 0, tipoInvalido === 0 ? 'todos los usuarios tienen tipo valido (' + internos + ' INTERNO, ' + externos + ' EXTERNO)' : tipoInvalido + ' usuario(s) con tipo vacio o invalido');

  // 8. consistencia
  var emails = {};
  var duplicados = 0;
  u.usuarios.forEach(function (x) { if (x.emailValido) { if (emails[x.email]) { duplicados += 1; } emails[x.email] = true; } });
  var invalidos = {
    email: u.usuarios.filter(function (x) { return !x.emailValido; }).length,
    estado: u.usuarios.filter(function (x) { return x.estado === ''; }).length,
    version: u.usuarios.filter(function (x) { return !/^[1-9][0-9]*$/.test(x.versionCrudo); }).length,
    actualizado: u.usuarios.filter(function (x) { return x.actualizadoUtc === '' || x.actualizadoPor === ''; }).length,
    permisos: u.usuarios.filter(function (x) { return x.permisosInvalidos > 0; }).length
  };
  var consistente = tabla.existe === true && plan.ok && u.usuarios.length > 0 && duplicados === 0 && Object.keys(invalidos).every(function (k) { return invalidos[k] === 0; });
  item('consistencia', consistente, consistente ? 'sin emails duplicados ni invalidos, estados validos, version >= 1, actualizado_* completos y permisos solo SI/NO' : 'duplicados ' + duplicados + '; invalidos ' + JSON.stringify(invalidos));

  // 9. ultimo admin: la regla se EJERCITA con datos sinteticos (no con los reales): desactivar al unico admin y darle usuarios_admin a un EXTERNO tienen que ser rechazados
  var sintetico = { email: 'a@x.com', nombre: 'A', estado: 'activo', tipo: 'INTERNO', version: 1, permisos: permisosCatalogo_aObjeto(['usuarios_admin']) };
  var r1 = usuariosDominio_validarMutacion(sintetico, Object.assign({}, sintetico, { estado: 'inactivo' }), [sintetico], {});
  var r2 = usuariosDominio_validarMutacion(sintetico, Object.assign({}, sintetico, { tipo: 'EXTERNO' }), [sintetico], {});
  var r3 = usuariosDominio_validarMutacion(null, { email: 'b@x.com', nombre: 'B', estado: 'activo', tipo: 'EXTERNO', permisos: permisosCatalogo_aObjeto(['usuarios_admin']) }, [sintetico], { cambiaPermisos: true });
  var reglaOk = r1.ok === false && r1.codigo === 'ULTIMO_ADMIN' && r2.ok === false && r3.ok === false && r3.codigo === 'TIPO_NO_PERMITE_PERMISO';
  item('ultimo_admin', reglaOk, reglaOk ? 'la regla rechaza desactivar o pasar a EXTERNO al unico administrador y rechaza EXTERNO + usuarios_admin' : 'la regla del ultimo administrador / del techo EXTERNO NO se comporta como se espera');

  // 10. modo de email_verified
  var modo = flags.emailVerified && flags.emailVerified.modo ? flags.emailVerified : { modo: 'OBSERVAR', origen: 'AUSENTE' };
  item('email_verified_modo', modo.modo === 'OBSERVAR' || modo.modo === 'EXIGIR', 'modo ' + modo.modo + ' (' + modo.origen + ')');
  if (modo.origen === 'INVALIDO') { advertencias.push('EMAIL_VERIFIED_MODO tiene un valor invalido: se aplica OBSERVAR (no bloquea logins)'); }

  // 11. gates de telemetria (funciones puras del Api, ejercitadas con permisos sinteticos)
  var vacio = permisosCatalogo_vacios();
  function con(ids) { return permisosCatalogo_aObjeto(ids); }
  var busquedaOk = api_puedeRegistrarBusqueda(vacio) === false && api_puedeRegistrarBusqueda(con(['mapa', 'reemplazo', 'fotos', 'observaciones', 'perfil_subir', 'usuarios_admin'])) === false && PREFLIGHT_E10_PERMISOS_BUSQUEDA.every(function (m) { return api_puedeRegistrarBusqueda(con([m])) === true; });
  var descargaOk = api_puedeRegistrarDescarga(vacio) === false && api_puedeRegistrarDescarga(con(['datos', 'ubicacion', 'ne', 'mapa'])) === false && api_puedeRegistrarDescarga(con(['perfil'])) === true;
  item('telegram_gates', busquedaOk && descargaOk, busquedaOk && descargaOk ? 'registerWellSearch exige perfil, datos, ubicacion o ne; registerDescargaItf exige perfil' : 'los gates de telemetria no se comportan como se espera');

  var listo = items.every(function (i) { return i.ok; });
  return {
    version: 1,
    soloLectura: true,
    listo: listo,
    items: items,
    advertencias: advertencias,
    contadores: { usuarios: u.usuarios.length, activos: activos.length, administradoresEfectivos: admins.length, internos: internos, externos: externos, conMapa: activos.length - sinMapa, filasConPermisosInefectivos: filasConInefectivos },
    flags: f
  };
}

// --- recoleccion (lecturas) ---

// deps inyectables para los tests; por defecto las de Apps Script. Cada lectura va en su propio try: un fallo se informa como "no ok", nunca rompe ni imprime el error crudo.
function preflightE10_recolectar(deps) {
  var d = deps || {};
  var estado = { tabla: { existe: false, header: [], filas: [] }, eventos: { existe: false, esquemaOk: false, filas: 0 }, flags: { adminUsuarios: false, gestionExternos: false, emailVerified: { modo: 'OBSERVAR', origen: 'AUSENTE' } } };
  try {
    estado.tabla = d.leerTabla ? d.leerTabla() : sheetUserRepository_leerTabla();
  } catch (err) {
    // sigue como no existente
  }
  try {
    if (d.estadoEventos) {
      estado.eventos = d.estadoEventos();
    } else {
      var hoja = SpreadsheetApp.openById(getSpreadsheetId()).getSheetByName(USUARIOS_EVENTOS_HOJA);
      if (hoja) {
        estado.eventos.existe = true;
        var ancho = hoja.getLastColumn();
        estado.eventos.esquemaOk = ancho > 0 && usuariosEventosRepository_planEsquema(hoja.getRange(1, 1, 1, ancho).getValues()[0]).ok === true;
        estado.eventos.filas = Math.max(0, hoja.getLastRow() - 1);
      }
    }
  } catch (err) {
    // sigue en false
  }
  try {
    estado.flags = { adminUsuarios: e10Flags_adminUsuariosActivo(), gestionExternos: e10Flags_gestionExternosActivo(), emailVerified: e10Flags_emailVerifiedModo() };
  } catch (err) {
    // sigue apagado
  }
  return estado;
}

// --- entrada de Apps Script (a mano) ---

function preflightE10_1() {
  var informe;
  try {
    informe = preflightE10_evaluar(preflightE10_recolectar());
  } catch (err) {
    informe = { version: 1, soloLectura: true, listo: false, error: 'NO_SE_PUDO_EVALUAR' };
  }
  Logger.log(JSON.stringify(informe, null, 1));
  return informe;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    preflightE10_1,
    preflightE10_evaluar,
    preflightE10_recolectar,
    preflightE10_usuarios
  };
}
