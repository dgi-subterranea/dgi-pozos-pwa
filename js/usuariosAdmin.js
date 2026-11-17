// Controlador DOM de Administracion -> Usuarios (E10-2). Solo pinta y conecta: toda la logica (filtros, catalogo, dependencias, diferencias, motivo, confirmaciones, mensajes de error por codigo,
// layout) vive en js/usuariosAdminLogic.js, con tests. La defensa REAL es el backend (sesion + usuario activo + INTERNO + usuarios_admin + flag E10_ADMIN_USUARIOS_ACTIVO): esta pantalla solo se ofrece
// a quien tiene usuarios_admin y muestra un estado claro cuando la administracion esta deshabilitada.
//
// Reglas de la pantalla:
//  - Los datos se piden SOLO al abrirla (catalogo de permisos + listado completo). El listado no se pagina: la busqueda y los filtros (texto, activo / inactivo, interno / externo, administrador) son locales.
//  - Un usuario se abre en un DETALLE: las acciones sensibles (desactivar, reactivar) no estan en las filas del listado. El detalle pide al backend el usuario fresco (version + etag) y sus eventos recientes.
//  - Los permisos se agrupan por modulo con la metadata del catalogo (nombre, descripcion, dependencias, criticos); NINGUNA lista literal de permisos en este archivo. Dependencias sin cascadas
//    invisibles: activar con el requerido apagado ofrece activarlo; quitar un permiso del que dependen otros advierte cuales y exige una decision explicita.
//  - Cada mutacion lleva un clientRequestId por INTENCION (el reintento del mismo pedido lo reusa), la version y el etag que se vieron (conflicto optimista) y, si corresponde, el motivo.
//  - El email de un usuario existente es inmutable (campo de solo lectura). Un EXTERNO no puede ser administrador (el catalogo lo marca; el backend lo exige).
//  - Todo texto (nombres, emails, motivos, permisos) se pinta con textContent: jamas innerHTML con datos.
//
// API (window.usuariosAdminController_*):
//   _inicializar(obtenerContexto, opciones)   obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir() / _cerrar() / _reset()           la pantalla se muestra (pide los datos) / se oculta / cierre de sesion
//   _hayModalAbierto()
(function () {
  var obtenerContexto = null;
  var tokenCarga = 0;
  var tokenDetalle = 0;
  var hayEventosMas = false;

  function $(id) { return document.getElementById(id); }

  var el = {
    aviso: $('uadm-aviso'),
    cargando: $('uadm-cargando'),
    error: $('uadm-error'),
    errorTexto: $('uadm-error-texto'),
    btnReintentar: $('btn-uadm-reintentar'),
    deshabilitada: $('uadm-deshabilitada'),
    btnReintentarDeshab: $('btn-uadm-reintentar-deshab'),
    sinPermiso: $('uadm-sin-permiso'),
    contenido: $('uadm-contenido'),
    resumen: $('uadm-resumen'),
    btnActualizar: $('btn-uadm-actualizar'),
    btnNuevo: $('btn-uadm-nuevo'),
    columnas: $('uadm-columnas'),
    panelLista: $('uadm-panel-lista'),
    buscar: $('uadm-buscar'),
    fEstado: $('uadm-f-estado'),
    fTipo: $('uadm-f-tipo'),
    fAdmin: $('uadm-f-admin'),
    btnLimpiar: $('btn-uadm-limpiar-filtros'),
    listaVacia: $('uadm-lista-vacia'),
    lista: $('uadm-lista'),
    panelDetalle: $('uadm-panel-detalle'),
    btnDetalleVolver: $('btn-uadm-detalle-volver'),
    detalleVacio: $('uadm-detalle-vacio'),
    detalleTitulo: $('uadm-detalle-titulo'),
    detalleError: $('uadm-detalle-error'),
    detalleCargando: $('uadm-detalle-cargando'),
    form: $('uadm-form'),
    email: $('uadm-email'),
    emailNota: $('uadm-email-nota'),
    nombre: $('uadm-nombre'),
    tipo: $('uadm-tipo'),
    estadoTexto: $('uadm-estado-texto'),
    metaVersion: $('uadm-meta-version'),
    metaActualizado: $('uadm-meta-actualizado'),
    permisos: $('uadm-permisos'),
    formAviso: $('uadm-form-aviso'),
    btnGuardar: $('btn-uadm-guardar'),
    btnDescartar: $('btn-uadm-descartar'),
    zonaEstado: $('uadm-zona-estado'),
    btnDesactivar: $('btn-uadm-desactivar'),
    btnReactivar: $('btn-uadm-reactivar'),
    eventosBloque: $('uadm-eventos-bloque'),
    eventosNoDisponibles: $('uadm-eventos-no-disponibles'),
    eventosVacio: $('uadm-eventos-vacio'),
    eventos: $('uadm-eventos'),
    btnEventosMas: $('btn-uadm-eventos-mas'),
    overlay: $('uadm-overlay'),
    dlgTitulo: $('uadm-dlg-titulo'),
    dlgLineas: $('uadm-dlg-lineas'),
    dlgMotivoLabel: $('uadm-dlg-motivo-label'),
    dlgMotivo: $('uadm-dlg-motivo'),
    dlgError: $('uadm-dlg-error'),
    btnDlgCancelar: $('btn-uadm-dlg-cancelar'),
    btnDlgConfirmar: $('btn-uadm-dlg-confirmar')
  };

  var estado = null;
  var dialogo = null;

  function nuevoEstado() {
    return {
      fase: 'cerrada',          // cerrada | cargando | listo | deshabilitada | sinPermiso | error
      usuarios: [], catalogo: [], total: 0, activos: 0, admins: 0,
      modo: 'lista',            // lista | detalle | crear
      email: null,              // usuario abierto
      original: null,           // vista del usuario como esta en el backend (version + etag)
      edicion: null,            // {email, nombre, tipo, permisos:[ids]}
      eventos: [], eventosInfo: { disponibles: true, hayMas: false, limite: 20 },
      filtros: { texto: '', estado: 'todos', tipo: 'todos', admin: 'todos' },
      ocupado: false,
      intencion: null           // {firma, id}: clientRequestId de la intencion en curso
    };
  }

  function contexto() { return obtenerContexto ? obtenerContexto() : null; }

  function sesionVencida() {
    var c = contexto();
    if (c && typeof c.onSessionExpired === 'function') { c.onSessionExpired(); }
  }

  // --- utilidades de DOM (texto siempre por textContent) ---

  function limpiar(nodo) { nodo.textContent = ''; }

  function crear(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) { n.className = clase; }
    if (texto !== undefined && texto !== null) { n.textContent = texto; }
    return n;
  }

  function mostrar(nodo, visible) { nodo.hidden = !visible; }

  function ancho() { return typeof window !== 'undefined' && typeof window.innerWidth === 'number' ? window.innerWidth : 0; }

  function layout() { return usuariosAdminLogic_modoLayout(ancho()); }

  function aviso(texto) {
    if (!texto) { mostrar(el.aviso, false); el.aviso.textContent = ''; return; }
    el.aviso.textContent = texto;
    mostrar(el.aviso, true);
  }

  function errorDetalle(texto) {
    if (!texto) { mostrar(el.detalleError, false); el.detalleError.textContent = ''; return; }
    el.detalleError.textContent = texto;
    mostrar(el.detalleError, true);
    if (typeof el.detalleError.focus === 'function') { el.detalleError.focus(); }
  }

  // --- pantalla ---

  function renderFase() {
    var f = estado.fase;
    mostrar(el.cargando, f === 'cargando');
    mostrar(el.error, f === 'error');
    mostrar(el.deshabilitada, f === 'deshabilitada');
    mostrar(el.sinPermiso, f === 'sinPermiso');
    mostrar(el.contenido, f === 'listo');
    if (f !== 'listo') { cerrarDialogoSilencioso(); }
  }

  function renderResumen() {
    var filtrados = usuariosAdminLogic_filtrar(estado.usuarios, estado.filtros).length;
    el.resumen.textContent = usuariosAdminLogic_resumenListado(estado.usuarios.length, filtrados) + ' · ' + estado.activos + ' activos · ' + estado.admins + ' administradores efectivos';
  }

  function renderLayout() {
    var doble = layout() === 'doble';
    var enDetalle = estado.modo !== 'lista';
    el.columnas.className = 'uadm-columnas ' + (doble ? 'uadm-doble' : 'uadm-simple') + (enDetalle ? ' uadm-ver-detalle' : '');
    mostrar(el.panelLista, doble || !enDetalle);
    mostrar(el.panelDetalle, doble || enDetalle);
    mostrar(el.btnDetalleVolver, !doble && enDetalle);
  }

  function badge(texto, clase) { return crear('span', 'uadm-badge ' + clase, texto); }

  function renderLista() {
    limpiar(el.lista);
    var filtrados = usuariosAdminLogic_filtrar(estado.usuarios, estado.filtros);
    mostrar(el.listaVacia, filtrados.length === 0);
    filtrados.forEach(function (u) {
      var t = usuariosAdminLogic_tarjeta(u);
      var li = crear('li', 'uadm-item');
      var b = crear('button', 'uadm-card' + (estado.email === u.email && estado.modo !== 'lista' ? ' uadm-card-activa' : ''));
      b.type = 'button';
      b.setAttribute('data-email', u.email);
      b.appendChild(crear('span', 'uadm-card-nombre', t.nombre));
      b.appendChild(crear('span', 'uadm-card-email', t.email));
      var fila = crear('span', 'uadm-card-badges');
      fila.appendChild(badge(t.estadoTexto, t.activo ? 'uadm-b-activo' : 'uadm-b-inactivo'));
      fila.appendChild(badge(t.tipoTexto, t.externo ? 'uadm-b-externo' : 'uadm-b-interno'));
      if (t.esAdmin) { fila.appendChild(badge('Admin', 'uadm-b-admin')); }
      fila.appendChild(badge(t.permisosTexto, 'uadm-b-permisos'));
      b.appendChild(fila);
      b.appendChild(crear('span', 'uadm-card-actualizado', 'Actualizado: ' + t.actualizado));
      b.addEventListener('click', function () { pedirAbrirDetalle(u.email); });
      li.appendChild(b);
      el.lista.appendChild(li);
    });
    renderResumen();
  }

  // --- detalle / editor ---

  function hayCambios() {
    if (estado.modo === 'crear') {
      return String(estado.edicion.email || '').trim() !== '' || String(estado.edicion.nombre || '').trim() !== '' || estado.edicion.permisos.length > 0 || estado.edicion.tipo !== 'INTERNO';
    }
    if (!estado.original || !estado.edicion) { return false; }
    return usuariosAdminLogic_diferencias(estado.original, estado.edicion).hayCambios;
  }

  function erroresDeEdicion() {
    var e = estado.edicion;
    var errores = usuariosAdminLogic_validarSeleccion(estado.catalogo, e.tipo, e.permisos).errores.map(function (x) { return x.mensaje; });
    if (String(e.nombre || '').trim() === '') { errores.push('Falta el nombre.'); }
    if (estado.modo === 'crear' && !usuariosAdminLogic_esEmailPlausible(e.email)) { errores.push('Ingresá un email válido.'); }
    return errores;
  }

  function renderPermisos() {
    limpiar(el.permisos);
    var tipo = estado.edicion.tipo;
    usuariosAdminLogic_agruparCatalogo(estado.catalogo).forEach(function (g) {
      var set = crear('fieldset', 'uadm-grupo');
      set.appendChild(crear('legend', 'uadm-grupo-titulo', g.modulo));
      g.permisos.forEach(function (p) {
        var marcado = estado.edicion.permisos.indexOf(p.id) >= 0;
        var aplicable = usuariosAdminLogic_aplicable(p, tipo);
        var fila = crear('div', 'uadm-permiso' + (p.critico ? ' uadm-permiso-critico' : '') + (marcado ? ' uadm-permiso-on' : ''));
        var cb = crear('input');
        cb.type = 'checkbox';
        cb.id = 'uadm-perm-' + p.id;
        cb.checked = marcado;
        cb.disabled = estado.ocupado || (!aplicable && !marcado);
        cb.setAttribute('data-permiso', p.id);
        cb.addEventListener('change', function () { alCambiarPermiso(p.id, cb.checked); });
        var etiqueta = crear('label', 'uadm-permiso-texto');
        etiqueta.setAttribute('for', cb.id);
        var nombre = crear('span', 'uadm-permiso-nombre', p.nombre);
        etiqueta.appendChild(nombre);
        if (p.critico) { etiqueta.appendChild(badge('Crítico', 'uadm-b-critico')); }
        etiqueta.appendChild(crear('span', 'uadm-permiso-desc', p.descripcion));
        if ((p.dependeDe || []).length > 0) {
          etiqueta.appendChild(crear('span', 'uadm-permiso-dep', 'Requiere: ' + p.dependeDe.map(function (d) { return usuariosAdminLogic_nombrePermiso(estado.catalogo, d); }).join(', ')));
        }
        if (!aplicable) {
          etiqueta.appendChild(crear('span', 'uadm-permiso-nota', 'No aplicable a usuarios ' + (tipo === 'EXTERNO' ? 'externos' : 'internos') + '.'));
        }
        fila.appendChild(cb);
        fila.appendChild(etiqueta);
        set.appendChild(fila);
      });
      el.permisos.appendChild(set);
    });
  }

  function renderBotonesForm() {
    var errores = estado.edicion ? erroresDeEdicion() : [];
    var cambios = estado.edicion ? hayCambios() : false;
    el.btnGuardar.textContent = estado.modo === 'crear' ? 'Crear usuario' : 'Guardar cambios';
    el.btnGuardar.disabled = estado.ocupado || !cambios || errores.length > 0;
    el.btnDescartar.disabled = estado.ocupado || !cambios;
    el.btnDescartar.textContent = estado.modo === 'crear' ? 'Cancelar' : 'Descartar cambios';
    // los errores de validacion de apoyo se muestran (el backend vuelve a validar)
    if (estado.edicion && cambios && errores.length > 0) {
      el.formAviso.textContent = errores.join(' ');
      mostrar(el.formAviso, true);
    } else {
      el.formAviso.textContent = '';
      mostrar(el.formAviso, false);
    }
  }

  function renderEventos() {
    limpiar(el.eventos);
    var visible = estado.modo === 'detalle';
    mostrar(el.eventosBloque, visible);
    if (!visible) { return; }
    mostrar(el.eventosNoDisponibles, !estado.eventosInfo.disponibles);
    mostrar(el.eventosVacio, estado.eventosInfo.disponibles && estado.eventos.length === 0);
    estado.eventos.forEach(function (e) {
      var li = crear('li', 'uadm-evento');
      var cab = crear('div', 'uadm-evento-cab');
      cab.appendChild(crear('strong', 'uadm-evento-tipo', usuariosAdminLogic_etiquetaEvento(e.evento)));
      cab.appendChild(crear('span', 'uadm-evento-fecha', usuariosAdminLogic_formatearFecha(e.timestampUtc)));
      li.appendChild(cab);
      li.appendChild(crear('div', 'uadm-evento-quien', 'Por: ' + (e.ejecutadoPor || '—')));
      usuariosAdminLogic_resumenEvento(e, estado.catalogo).forEach(function (linea) { li.appendChild(crear('div', 'uadm-evento-linea', linea)); });
      if (e.motivo) { li.appendChild(crear('div', 'uadm-evento-motivo', 'Motivo: ' + e.motivo)); }
      el.eventos.appendChild(li);
    });
    mostrar(el.btnEventosMas, estado.eventosInfo.hayMas === true);
  }

  function renderDetalle() {
    var detalle = estado.modo !== 'lista';
    mostrar(el.detalleVacio, !detalle);
    mostrar(el.form, detalle && estado.edicion !== null);
    if (!detalle || estado.edicion === null) {
      el.detalleTitulo.textContent = '';
      renderLayout();
      return;
    }
    var crearModo = estado.modo === 'crear';
    el.detalleTitulo.textContent = crearModo ? 'Nuevo usuario' : (estado.original.nombre || estado.original.email);
    el.email.value = estado.edicion.email;
    el.email.readOnly = !crearModo;                          // el email de un usuario existente es INMUTABLE
    el.email.disabled = estado.ocupado;
    mostrar(el.emailNota, !crearModo);
    el.nombre.value = estado.edicion.nombre;
    el.nombre.disabled = estado.ocupado;
    el.tipo.value = estado.edicion.tipo;
    el.tipo.disabled = estado.ocupado;
    if (crearModo) {
      el.estadoTexto.textContent = 'Se crea activo';
      el.metaVersion.textContent = '—';
      el.metaActualizado.textContent = '—';
    } else {
      el.estadoTexto.textContent = estado.original.estado === 'activo' ? 'Activo' : 'Inactivo';
      el.metaVersion.textContent = String(estado.original.version);
      el.metaActualizado.textContent = usuariosAdminLogic_formatearFecha(estado.original.actualizadoUtc) + (estado.original.actualizadoPor ? ' · ' + estado.original.actualizadoPor : '');
    }
    mostrar(el.zonaEstado, !crearModo);
    if (!crearModo) {
      mostrar(el.btnDesactivar, estado.original.estado === 'activo');
      mostrar(el.btnReactivar, estado.original.estado !== 'activo');
      el.btnDesactivar.disabled = estado.ocupado;
      el.btnReactivar.disabled = estado.ocupado;
    }
    renderPermisos();
    renderBotonesForm();
    renderEventos();
    renderLayout();
  }

  function renderTodo() {
    renderFase();
    if (estado.fase !== 'listo') { return; }
    mostrar(el.btnNuevo, true);
    el.btnNuevo.disabled = estado.ocupado;
    renderLista();
    renderDetalle();
    renderLayout();
  }

  // --- carga ---

  function cargar() {
    var c = contexto();
    var mio = (tokenCarga += 1);
    estado.fase = 'cargando';
    renderTodo();
    Promise.all([apiAdminPermisosCatalogo(c.sessionToken), apiAdminUsuariosListar(c.sessionToken)]).then(function (res) {
      if (mio !== tokenCarga || estado.fase === 'cerrada') { return; }
      var falla = res[0].status !== 'ok' ? res[0] : (res[1].status !== 'ok' ? res[1] : null);
      if (falla) {
        var destino = usuariosAdminLogic_estadoPorCodigo(falla.code);
        if (destino === 'sesion') { sesionVencida(); return; }
        if (destino === 'error') { el.errorTexto.textContent = usuariosAdminLogic_mensajeError(falla.code); }
        estado.fase = destino;
        renderTodo();
        return;
      }
      estado.catalogo = res[0].data.permisos;
      aplicarListado(res[1].data);
      estado.fase = 'listo';
      renderTodo();
    }).catch(function () {
      if (mio !== tokenCarga || estado.fase === 'cerrada') { return; }
      el.errorTexto.textContent = usuariosAdminLogic_mensajeError('SERVICE_UNAVAILABLE');
      estado.fase = 'error';
      renderTodo();
    });
  }

  function aplicarListado(data) {
    estado.usuarios = data.usuarios;
    estado.total = data.total;
    estado.activos = data.activos;
    estado.admins = data.administradoresEfectivos;
  }

  function recargarListado(luego) {
    var c = contexto();
    apiAdminUsuariosListar(c.sessionToken).then(function (r) {
      if (estado.fase !== 'listo') { return; }
      if (r.status === 'ok') {
        aplicarListado(r.data);
        renderLista();
      } else if (usuariosAdminLogic_estadoPorCodigo(r.code) === 'sesion') {
        sesionVencida();
        return;
      } else if (r.code === 'E10_ADMIN_INACTIVO') {
        estado.fase = 'deshabilitada';
        renderTodo();
        return;
      }
      if (luego) { luego(); }
    }).catch(function () { if (luego) { luego(); } });
  }

  // --- detalle: abrir / refrescar ---

  function copiarEdicionDe(vista) {
    return { email: vista.email, nombre: vista.nombre, tipo: vista.tipo, permisos: vista.permisos.slice() };
  }

  function pedirAbrirDetalle(email) {
    if (estado.ocupado) { return; }
    if (estado.modo !== 'lista' && hayCambios() && email !== estado.email) {
      dialogoDescartar(function () { abrirDetalle(email); });
      return;
    }
    abrirDetalle(email);
  }

  function abrirDetalle(email) {
    var base = estado.usuarios.filter(function (u) { return u.email === email; })[0];
    if (!base) { return; }
    estado.modo = 'detalle';
    estado.email = email;
    estado.original = base;
    estado.edicion = copiarEdicionDe(base);
    estado.eventos = [];
    estado.eventosInfo = { disponibles: true, hayMas: false, limite: 20 };
    estado.intencion = null;
    errorDetalle('');
    aviso('');
    renderLista();
    renderDetalle();
    refrescarDetalle(true);
    if (typeof el.panelDetalle.focus === 'function') { el.panelDetalle.focus(); }
  }

  // pide el usuario FRESCO (version + etag) y sus eventos recientes. `conservarEdicion`: no pisa lo que el administrador ya escribio (la primera carga).
  function refrescarDetalle(conservarEdicion, limite, luego) {
    var c = contexto();
    var email = estado.email;
    var mio = (tokenDetalle += 1);
    mostrar(el.detalleCargando, true);
    apiAdminUsuarioObtener(c.sessionToken, email, limite || estado.eventosInfo.limite).then(function (r) {
      if (mio !== tokenDetalle || estado.email !== email || estado.modo !== 'detalle') { return; }
      mostrar(el.detalleCargando, false);
      if (r.status !== 'ok') {
        var d = usuariosAdminLogic_estadoPorCodigo(r.code);
        if (d === 'sesion') { sesionVencida(); return; }
        if (d === 'deshabilitada') { estado.fase = 'deshabilitada'; renderTodo(); return; }
        errorDetalle(usuariosAdminLogic_mensajeError(r.code));
        return;
      }
      var cambioVersion = !estado.original || r.data.usuario.version !== estado.original.version || r.data.usuario.etag !== estado.original.etag;
      estado.original = r.data.usuario;
      if (!conservarEdicion || !hayCambiosSobre(estado.edicion, r.data.usuario, cambioVersion)) {
        estado.edicion = copiarEdicionDe(r.data.usuario);
      }
      estado.eventos = r.data.eventos;
      estado.eventosInfo = { disponibles: r.data.eventosDisponibles !== false, hayMas: r.data.hayMasEventos === true, limite: r.data.limiteEventos || 20 };
      renderDetalle();
      if (luego) { luego(); }
    }).catch(function () {
      if (mio !== tokenDetalle) { return; }
      mostrar(el.detalleCargando, false);
      errorDetalle(usuariosAdminLogic_mensajeError('SERVICE_UNAVAILABLE'));
    });
  }

  // La primera carga conserva lo que el administrador ya escribio SOLO si el usuario no cambio en el servidor; si cambio, se recarga la edicion (nunca se guarda sobre datos viejos: el backend igual lo rechazaria).
  function hayCambiosSobre(edicion, vista, cambioVersion) {
    if (!edicion) { return false; }
    if (cambioVersion) { return false; }
    return usuariosAdminLogic_diferencias(vista, edicion).hayCambios;
  }

  function volverAlListado() {
    if (estado.ocupado) { return; }
    if (estado.modo !== 'lista' && hayCambios()) {
      dialogoDescartar(function () { irALista(); });
      return;
    }
    irALista();
  }

  function irALista() {
    tokenDetalle += 1;
    estado.modo = 'lista';
    estado.email = null;
    estado.original = null;
    estado.edicion = null;
    estado.intencion = null;
    errorDetalle('');
    mostrar(el.detalleCargando, false);
    renderLista();
    renderDetalle();
  }

  function iniciarCrear() {
    if (estado.ocupado || estado.fase !== 'listo') { return; }
    var seguir = function () {
      tokenDetalle += 1;
      estado.modo = 'crear';
      estado.email = null;
      estado.original = null;
      estado.edicion = { email: '', nombre: '', tipo: 'INTERNO', permisos: [] };
      estado.eventos = [];
      estado.intencion = null;
      errorDetalle('');
      aviso('');
      renderLista();
      renderDetalle();
      if (typeof el.panelDetalle.focus === 'function') { el.panelDetalle.focus(); }
    };
    if (estado.modo !== 'lista' && hayCambios()) { dialogoDescartar(seguir); return; }
    seguir();
  }

  function descartar() {
    if (estado.ocupado) { return; }
    if (estado.modo === 'crear') { irALista(); return; }
    estado.edicion = copiarEdicionDe(estado.original);
    estado.intencion = null;
    errorDetalle('');
    renderDetalle();
  }

  // --- edicion de campos ---

  function alCambiarPermiso(id, marcado) {
    if (estado.ocupado || !estado.edicion) { return; }
    var cat = estado.catalogo;
    var nombre = usuariosAdminLogic_nombrePermiso(cat, id);
    if (marcado) {
      var faltantes = usuariosAdminLogic_alActivar(cat, estado.edicion.permisos, id).faltantes;
      if (faltantes.length > 0) {
        var nombres = faltantes.map(function (f) { return usuariosAdminLogic_nombrePermiso(cat, f); }).join(', ');
        abrirDialogo({
          titulo: 'Este permiso necesita otro',
          lineas: ['«' + nombre + '» requiere: ' + nombres + '.', 'Podés activarlos juntos, o cancelar y dejar «' + nombre + '» apagado.'],
          boton: 'Activar también: ' + nombres, pideMotivo: false, critica: false,
          onConfirmar: function () { estado.edicion.permisos = usuariosAdminLogic_activar(cat, estado.edicion.permisos, id, true); estado.intencion = null; renderDetalle(); },
          onCancelar: function () { renderDetalle(); }
        });
        renderPermisos();                 // mientras se decide, la casilla sigue reflejando el estado REAL (apagada): nada cambia hasta confirmar
        return;
      }
      estado.edicion.permisos = usuariosAdminLogic_activar(cat, estado.edicion.permisos, id, false);
    } else {
      var dependientes = usuariosAdminLogic_alQuitar(cat, estado.edicion.permisos, id).dependientes;
      if (dependientes.length > 0) {
        var nd = dependientes.map(function (f) { return usuariosAdminLogic_nombrePermiso(cat, f); }).join(', ');
        abrirDialogo({
          titulo: 'Quitar este permiso afecta a otros',
          lineas: ['Si quitás «' + nombre + '», estos permisos quedan sin su requisito: ' + nd + '.', 'No se quitan solos: elegí qué hacer.'],
          boton: 'Quitar «' + nombre + '» y ' + nd, pideMotivo: false, critica: true,
          onConfirmar: function () { estado.edicion.permisos = usuariosAdminLogic_quitar(cat, estado.edicion.permisos, id, true); estado.intencion = null; renderDetalle(); },
          onCancelar: function () { renderDetalle(); }
        });
        renderPermisos();                 // idem: sigue marcada hasta que el administrador decida
        return;
      }
      estado.edicion.permisos = usuariosAdminLogic_quitar(cat, estado.edicion.permisos, id, false);
    }
    estado.intencion = null;
    renderDetalle();
  }

  function alCambiarCampos() {
    if (!estado.edicion || estado.ocupado) { return; }
    if (estado.modo === 'crear') { estado.edicion.email = String(el.email.value || ''); }
    estado.edicion.nombre = String(el.nombre.value || '');
    var tipoNuevo = el.tipo.value === 'EXTERNO' ? 'EXTERNO' : 'INTERNO';
    var cambioTipo = tipoNuevo !== estado.edicion.tipo;
    estado.edicion.tipo = tipoNuevo;
    estado.intencion = null;
    if (cambioTipo) { renderDetalle(); } else { renderBotonesForm(); }
  }

  // --- dialogo de confirmacion ---

  function abrirDialogo(cfg) {
    dialogo = cfg;
    el.dlgTitulo.textContent = cfg.titulo;
    limpiar(el.dlgLineas);
    cfg.lineas.forEach(function (l) { el.dlgLineas.appendChild(crear('p', 'uadm-dlg-linea', l)); });
    mostrar(el.dlgMotivoLabel, cfg.pideMotivo === true);
    mostrar(el.dlgMotivo, cfg.pideMotivo === true);
    el.dlgMotivo.value = '';
    el.dlgError.textContent = '';
    mostrar(el.dlgError, false);
    el.btnDlgConfirmar.textContent = cfg.boton;
    el.btnDlgConfirmar.className = cfg.critica ? 'button-primary uadm-peligro' : 'button-primary';
    mostrar(el.overlay, true);
    if (typeof el.btnDlgCancelar.focus === 'function') { el.btnDlgCancelar.focus(); }
  }

  function cerrarDialogoSilencioso() {
    dialogo = null;
    if (el.overlay) { mostrar(el.overlay, false); }
  }

  function cancelarDialogo() {
    var d = dialogo;
    cerrarDialogoSilencioso();
    if (d && typeof d.onCancelar === 'function') { d.onCancelar(); }
  }

  function confirmarDialogo() {
    var d = dialogo;
    if (!d) { return; }
    var motivo = String(el.dlgMotivo.value || '').trim();
    if (d.pideMotivo === true && motivo === '') {
      el.dlgError.textContent = usuariosAdminLogic_mensajeError('MOTIVO_REQUERIDO');
      mostrar(el.dlgError, true);
      if (typeof el.dlgMotivo.focus === 'function') { el.dlgMotivo.focus(); }
      return;
    }
    cerrarDialogoSilencioso();
    d.onConfirmar(motivo);
  }

  function dialogoDescartar(seguir) {
    abrirDialogo({
      titulo: 'Hay cambios sin guardar',
      lineas: ['Tenés cambios sin guardar' + (estado.original ? ' en ' + (estado.original.nombre || estado.original.email) : ' en el usuario nuevo') + '. Si seguís, se descartan.'],
      boton: 'Descartar los cambios', pideMotivo: false, critica: false,
      onConfirmar: seguir
    });
  }

  // --- mutaciones ---

  function clientRequestId(firma) {
    if (!estado.intencion || estado.intencion.firma !== firma) {
      estado.intencion = { firma: firma, id: usuariosAdminLogic_nuevoClientRequestId() };
    }
    return estado.intencion.id;
  }

  function guardar() {
    if (estado.ocupado || !estado.edicion || erroresDeEdicion().length > 0 || !hayCambios()) { return; }
    var accion = estado.modo === 'crear' ? 'CREAR' : 'ACTUALIZAR';
    var conf = usuariosAdminLogic_confirmacion(accion, estado.original, estado.original, estado.edicion, estado.catalogo);
    if (accion === 'CREAR') {
      conf = usuariosAdminLogic_confirmacion('CREAR', null, null, estado.edicion, estado.catalogo);
    }
    if (conf === null) {
      ejecutarGuardado('');
      return;
    }
    abrirDialogo({
      titulo: conf.titulo, lineas: conf.lineas, boton: conf.boton, pideMotivo: conf.pideMotivo, critica: conf.critica,
      onConfirmar: function (motivo) { ejecutarGuardado(motivo); }
    });
  }

  function ejecutarGuardado(motivo) {
    var c = contexto();
    var e = estado.edicion;
    var llamada;
    var etiqueta;
    if (estado.modo === 'crear') {
      var firmaC = ['C', e.email.trim().toLowerCase(), e.nombre.trim(), e.tipo, e.permisos.join(',')].join('|');
      var pedidoC = { email: e.email.trim(), nombre: e.nombre.trim(), tipo: e.tipo, permisos: e.permisos.slice(), clientRequestId: clientRequestId(firmaC) };
      if (motivo) { pedidoC.motivo = motivo; }
      llamada = apiAdminUsuarioCrear(c.sessionToken, pedidoC);
      etiqueta = 'Usuario creado.';
    } else {
      var d = usuariosAdminLogic_diferencias(estado.original, e);
      var firma = ['A', estado.original.email, estado.original.version, estado.original.etag, e.nombre.trim(), e.tipo, e.permisos.join(','), motivo].join('|');
      var pedido = { email: estado.original.email, versionEsperada: estado.original.version, etag: estado.original.etag, clientRequestId: clientRequestId(firma) };
      if (d.nombre) { pedido.nombre = e.nombre.trim(); }
      if (d.tipo) { pedido.tipo = e.tipo; }
      if (d.agregados.length > 0 || d.quitados.length > 0) { pedido.permisos = e.permisos.slice(); }
      if (motivo) { pedido.motivo = motivo; }
      llamada = apiAdminUsuarioActualizar(c.sessionToken, pedido);
      etiqueta = 'Cambios guardados.';
    }
    correrMutacion(llamada, etiqueta);
  }

  function pedirCambioDeEstado(accion) {
    if (estado.ocupado || estado.modo !== 'detalle') { return; }
    var conf = usuariosAdminLogic_confirmacion(accion, estado.original, estado.original, estado.edicion, estado.catalogo);
    abrirDialogo({
      titulo: conf.titulo, lineas: conf.lineas, boton: conf.boton, pideMotivo: true, critica: conf.critica,
      onConfirmar: function (motivo) {
        var c = contexto();
        var o = estado.original;
        var firma = [accion, o.email, o.version, o.etag, motivo].join('|');
        var pedido = { email: o.email, versionEsperada: o.version, etag: o.etag, motivo: motivo, clientRequestId: clientRequestId(firma) };
        var llamada = accion === 'DESACTIVAR' ? apiAdminUsuarioDesactivar(c.sessionToken, pedido) : apiAdminUsuarioReactivar(c.sessionToken, pedido);
        correrMutacion(llamada, accion === 'DESACTIVAR' ? 'Usuario desactivado.' : 'Usuario reactivado.');
      }
    });
  }

  function correrMutacion(llamada, textoOk) {
    estado.ocupado = true;
    errorDetalle('');
    aviso('');
    renderTodo();
    llamada.then(function (r) {
      estado.ocupado = false;
      if (estado.fase === 'cerrada') { return; }
      if (r.status === 'ok') { alExito(r.data, textoOk); return; }
      alError(r);
    }).catch(function () {
      estado.ocupado = false;
      if (estado.fase === 'cerrada') { return; }
      renderTodo();
      errorDetalle(usuariosAdminLogic_mensajeError('SERVICE_UNAVAILABLE') + ' Tu pedido no se duplica si reintentás.');
    });
  }

  function alExito(data, textoOk) {
    estado.intencion = null;
    var u = data.usuario;
    var avisoTexto = textoOk + (data.duplicada ? ' (el pedido ya se había aplicado)' : '') + (data.sinCambios ? ' (no había nada para cambiar)' : '');
    if (estado.modo === 'crear') {
      // el usuario nuevo se abre en su detalle (version + etag + evento de creacion)
      estado.modo = 'detalle';
      estado.email = u.email;
      estado.original = u;
      estado.edicion = copiarEdicionDe(u);
    } else {
      estado.original = u;
      estado.edicion = copiarEdicionDe(u);
    }
    estado.eventos = [];
    renderTodo();
    aviso(avisoTexto);
    recargarListado(function () { renderLista(); });
    refrescarDetalle(false);
  }

  function alError(r) {
    var destino = usuariosAdminLogic_estadoPorCodigo(r.code);
    if (destino === 'sesion') { sesionVencida(); return; }
    if (destino === 'deshabilitada') { estado.fase = 'deshabilitada'; renderTodo(); return; }
    estado.intencion = null;
    renderTodo();
    errorDetalle(usuariosAdminLogic_mensajeError(r.code, r));
    if (usuariosAdminLogic_codigoRecarga(r.code) && estado.modo === 'detalle') {
      refrescarDetalle(false);
      recargarListado(function () { renderLista(); });
    }
  }

  // --- eventos: ver mas ---

  function verMasEventos() {
    if (estado.modo !== 'detalle') { return; }
    refrescarDetalle(true, Math.min(100, (estado.eventosInfo.limite || 20) * 2));
  }

  // --- filtros ---

  function alCambiarFiltros() {
    estado.filtros = {
      texto: String(el.buscar.value || ''),
      estado: el.fEstado.value || 'todos',
      tipo: el.fTipo.value || 'todos',
      admin: el.fAdmin.value || 'todos'
    };
    renderLista();
  }

  function limpiarFiltros() {
    el.buscar.value = '';
    el.fEstado.value = 'todos';
    el.fTipo.value = 'todos';
    el.fAdmin.value = 'todos';
    alCambiarFiltros();
  }

  // --- API publica ---

  function inicializar(fn) {
    obtenerContexto = fn;
    estado = nuevoEstado();
    el.btnReintentar.addEventListener('click', function () { cargar(); });
    el.btnReintentarDeshab.addEventListener('click', function () { cargar(); });
    el.btnActualizar.addEventListener('click', function () { if (!estado.ocupado) { recargarListado(); } });
    el.btnNuevo.addEventListener('click', iniciarCrear);
    el.buscar.addEventListener('input', alCambiarFiltros);
    el.fEstado.addEventListener('change', alCambiarFiltros);
    el.fTipo.addEventListener('change', alCambiarFiltros);
    el.fAdmin.addEventListener('change', alCambiarFiltros);
    el.btnLimpiar.addEventListener('click', limpiarFiltros);
    el.btnDetalleVolver.addEventListener('click', volverAlListado);
    el.nombre.addEventListener('input', alCambiarCampos);
    el.email.addEventListener('input', alCambiarCampos);
    el.tipo.addEventListener('change', alCambiarCampos);
    el.btnGuardar.addEventListener('click', guardar);
    el.btnDescartar.addEventListener('click', descartar);
    el.btnDesactivar.addEventListener('click', function () { pedirCambioDeEstado('DESACTIVAR'); });
    el.btnReactivar.addEventListener('click', function () { pedirCambioDeEstado('REACTIVAR'); });
    el.btnEventosMas.addEventListener('click', verMasEventos);
    el.btnDlgCancelar.addEventListener('click', cancelarDialogo);
    el.btnDlgConfirmar.addEventListener('click', confirmarDialogo);
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('resize', function () { if (estado.fase === 'listo') { renderLayout(); } });
    }
  }

  function abrir() {
    var c = contexto();
    estado = nuevoEstado();
    tokenDetalle += 1;
    aviso('');
    errorDetalle('');
    if (!c || !usuariosAdminLogic_puedeVer(c.permisos)) {
      // el permiso se perdio: la tarjeta se corrige en el hub y no se pide nada
      estado.fase = 'sinPermiso';
      renderFase();
      return;
    }
    cargar();
  }

  function cerrar() {
    tokenCarga += 1;
    tokenDetalle += 1;
    cerrarDialogoSilencioso();
    estado = nuevoEstado();
  }

  function reset() {
    cerrar();
    if (el.lista) { limpiar(el.lista); limpiar(el.permisos); limpiar(el.eventos); }
    aviso('');
    renderFase();
  }

  function hayModalAbierto() { return dialogo !== null; }

  window.usuariosAdminController_inicializar = inicializar;
  window.usuariosAdminController_abrir = abrir;
  window.usuariosAdminController_cerrar = cerrar;
  window.usuariosAdminController_reset = reset;
  window.usuariosAdminController_hayModalAbierto = hayModalAbierto;
})();
