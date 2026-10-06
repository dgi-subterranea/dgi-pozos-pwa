// Controlador de la galeria general de fotos de un pozo / punto NE (FotosPozos
// v1): ver las fotos (miniaturas lazy, filtros, visor) y cargar fotos nuevas
// desde el celular (camara o galeria, previsualizacion, cola secuencial, GPS
// opcional). Igual que el resto, no se testea con Jest (DOM/canvas/geolocation):
// toda la logica pura -formatos, fechas, filtros, cola de subida, GPS- vive en
// js/fotosPozosLogic.js, con tests; el pipeline de imagen en js/fotosImagen.js.
//
// API (ver window.fotosPozosController_* al final):
//   _inicializar(obtenerContexto)  obtenerContexto() -> {sessionToken, permisos, onSessionExpired}
//   _abrir(entidad)                entidad = {wellId, monitoringId, etiqueta, esNE}
//   _cerrar() / _reset()           salir de la pantalla / cerrar sesion
//
// PERMISOS (fail-closed; el backend vuelve a validar igual):
//   fotos=SI        -> ve galeria, contador y visor
//   fotos_carga=SI  -> ve "Agregar foto" y puede subir
//   fotos_carga SIN fotos: puede subir, pero no se pide ni se muestra nada de la
//   galeria (ni contador): no se revela si el pozo tiene fotos.
//
// Privacidad: el navegador habla solo con el backend principal (nunca ve URLs ni
// Drive IDs). Las fotos se re-codifican con canvas (sin EXIF ni GPS) y los
// nombres de archivo originales no se envian ni se muestran. La ubicacion del
// dispositivo se pide SOLO si el usuario lo acepta, y nunca bloquea la carga.
// Todo texto que viene de datos se pinta con textContent, nunca como HTML.
(function () {
  var estado = {
    obtenerContexto: null,
    aperturaId: 0,
    entidad: null,
    puedeVer: false,
    puedeCargar: false,
    fotos: [],                  // metadata de la galeria (ordenada)
    filtros: { fuente: '', anio: '', tipo: '' },
    miniaturas: {},             // fotoId -> dataURL
    colaMiniaturas: [],
    miniaturasActivas: 0,
    observador: null,
    items: [],                  // fotos del formulario abierto
    siguienteId: 1,
    form: null,
    gps: { pedido: false, estado: '', lat: null, lon: null, precisionM: null, token: 0 },
    mensajeExito: '',
    visor: { fotos: [], indice: 0, token: 0, toqueX: null }
  };
  var MAX_MINIATURAS_PARALELAS = 3;
  var BYTES_CABECERA = 131072;          // 128 KB alcanzan para el EXIF de cualquier celular

  function $(id) { return document.getElementById(id); }
  var screenEl = $('screen-fotos');
  var entidadEl = $('fotos-entidad');
  var cargandoEl = $('fotos-cargando');
  var errorEl = $('fotos-error');
  var errorTextoEl = $('fotos-error-texto');
  var btnReintentarEl = $('btn-fotos-reintentar');
  var contenidoEl = $('fotos-contenido');
  var contadorEl = $('fotos-contador');
  var btnAgregarEl = $('btn-fotos-agregar');
  var sinVerEl = $('fotos-sin-ver');
  var exitoEl = $('fotos-exito');
  var galeriaEl = $('fotos-galeria');
  var filtrosEl = $('fotos-filtros');
  var selFuenteFiltroEl = $('select-fotos-filtro-fuente');
  var selAnioFiltroEl = $('select-fotos-filtro-anio');
  var selTipoFiltroEl = $('select-fotos-filtro-tipo');
  var btnLimpiarFiltrosEl = $('btn-fotos-limpiar-filtros');
  var vacioEl = $('fotos-vacio');
  var grillaEl = $('fotos-grilla');
  var formEl = $('fotos-form');
  var btnCamaraEl = $('btn-fotos-camara');
  var btnGaleriaEl = $('btn-fotos-galeria');
  var inputCamaraEl = $('input-fotos-camara');
  var inputGaleriaEl = $('input-fotos-galeria');
  var previewsEl = $('fotos-previews');
  var errArchivosEl = $('fotos-err-archivos');
  var inputFechaEl = $('input-fotos-fecha');
  var chkFechaDesconocidaEl = $('chk-fotos-fecha-desconocida');
  var errFechaEl = $('fotos-err-fecha');
  var selTipoEl = $('select-fotos-tipo');
  var grupoFuenteEl = $('fotos-grupo-fuente');
  var selFuenteEl = $('select-fotos-fuente');
  var obsEl = $('fotos-observacion');
  var obsContadorEl = $('fotos-observacion-contador');
  var errObsEl = $('fotos-err-observacion');
  var chkGpsEl = $('chk-fotos-gps');
  var gpsEstadoEl = $('fotos-gps-estado');
  var btnSubirEl = $('btn-fotos-subir');
  var btnCancelarEl = $('btn-fotos-cancelar');
  var subidaEl = $('fotos-subida');
  var subidaTituloEl = $('fotos-subida-titulo');
  var subidaListaEl = $('fotos-subida-lista');

  var visorEl = $('fotos-visor-overlay');
  var visorImgEl = $('fotos-visor-img');
  var visorCargandoEl = $('fotos-visor-cargando');
  var visorErrorEl = $('fotos-visor-error');
  var visorContadorEl = $('fotos-visor-contador');
  var visorFechaEl = $('fotos-visor-fecha');
  var visorDetalleEl = $('fotos-visor-detalle');
  var visorObsEl = $('fotos-visor-obs');
  var btnVisorCerrarEl = $('btn-fotos-visor-cerrar');
  var btnVisorAnteriorEl = $('btn-fotos-visor-anterior');
  var btnVisorSiguienteEl = $('btn-fotos-visor-siguiente');

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  function mostrarTexto(nodo, texto) {
    nodo.textContent = texto || '';
    nodo.hidden = !texto;
  }

  function mostrarSolo(nombre) {
    cargandoEl.hidden = nombre !== 'cargando';
    errorEl.hidden = nombre !== 'error';
    contenidoEl.hidden = nombre !== 'contenido';
  }

  function formularioNuevo() {
    return { fecha: fotosPozosLogic_fechaHoy(), fechaEditada: false, fechaDesconocida: false, tipoFoto: 'OTRA', fuente: 'CAMPO_APP', observacion: '' };
  }

  // =====================================================================
  // Apertura
  // =====================================================================

  function fotosPozosController_abrir(entidad) {
    estado.aperturaId += 1;
    var aperturaId = estado.aperturaId;
    var ctx = contexto();
    estado.entidad = entidad;
    estado.fotos = [];
    estado.filtros = { fuente: '', anio: '', tipo: '' };
    estado.mensajeExito = '';
    cerrarVisor();
    entidadEl.textContent = entidad.etiqueta || fotosPozosLogic_claveEntidad(entidad);

    var permisos = (ctx && ctx.permisos) || {};
    estado.puedeVer = permisos.fotos === true;
    estado.puedeCargar = permisos.fotos_carga === true;
    resetFormulario();
    renderSubida();

    if (!ctx || (!estado.puedeVer && !estado.puedeCargar)) {
      mostrarError('No tenés permiso para ver ni cargar fotos.', false);
      return;
    }
    if (!estado.puedeVer) {
      // Solo carga: NO se pide nada de la galeria ni se muestra contador
      mostrarSolo('contenido');
      renderTodo();
      return;
    }
    cargarGaleria(aperturaId);
  }

  function cargarGaleria(aperturaId) {
    var ctx = contexto();
    mostrarSolo('cargando');
    apiGetFotosPozo(ctx.sessionToken, estado.entidad.wellId || '', estado.entidad.wellId ? '' : (estado.entidad.monitoringId || ''), 'recientes')
      .then(function (r) {
        if (aperturaId !== estado.aperturaId) { return; }
        if (r.status !== 'ok') {
          if (r.code === 'UNAUTHORIZED' || r.code === 'USER_DISABLED') {
            if (ctx.onSessionExpired) { ctx.onSessionExpired(); }
            return;
          }
          mostrarError(r.code === 'PERMISSION_DENIED' ? 'No tenés permiso para ver las fotos.' : 'No se pudieron cargar las fotos. Intentá de nuevo.', r.code !== 'PERMISSION_DENIED');
          return;
        }
        estado.fotos = r.data.fotos || [];
        mostrarSolo('contenido');
        renderTodo();
      })
      .catch(function () {
        if (aperturaId !== estado.aperturaId) { return; }
        mostrarError('No se pudieron cargar las fotos. Revisá tu conexión.', true);
      });
  }

  function mostrarError(texto, conReintento) {
    errorTextoEl.textContent = texto;
    btnReintentarEl.hidden = !conReintento;
    mostrarSolo('error');
  }

  function fotosPozosController_cerrar() {
    estado.aperturaId += 1;
    estado.gps.token += 1;
    cerrarVisor();
  }

  // Cierre de sesion: nada de la galeria ni de la cola sobrevive
  function fotosPozosController_reset() {
    fotosPozosController_cerrar();
    estado.entidad = null;
    estado.fotos = [];
    estado.miniaturas = {};
    estado.items = [];
    estado.colaMiniaturas = [];
    cola.estado.items = [];
    cola.estado.pausada = false;
    estado.gps = { pedido: false, estado: '', lat: null, lon: null, precisionM: null, token: estado.gps.token + 1 };
  }

  // =====================================================================
  // Galeria
  // =====================================================================

  function renderTodo() {
    renderCabecera();
    renderGaleria();
    renderFormulario();
    renderSubida();
  }

  function renderCabecera() {
    // Sin fotos=SI no hay contador ni galeria (no se revela si el pozo tiene fotos)
    contadorEl.hidden = !estado.puedeVer;
    if (estado.puedeVer) {
      contadorEl.textContent = fotosPozosLogic_textoContador(estado.fotos.length);
    }
    btnAgregarEl.hidden = !estado.puedeCargar;
    sinVerEl.hidden = estado.puedeVer;
    mostrarTexto(exitoEl, estado.mensajeExito);
  }

  function poblarFiltro(select, opciones, etiquetaTodos, valorActual) {
    select.innerHTML = '';
    var todos = document.createElement('option');
    todos.value = '';
    todos.textContent = etiquetaTodos;
    select.appendChild(todos);
    opciones.forEach(function (o) {
      var op = document.createElement('option');
      op.value = o.valor;
      op.textContent = o.etiqueta + ' (' + o.cantidad + ')';
      select.appendChild(op);
    });
    select.value = opciones.some(function (o) { return o.valor === valorActual; }) ? valorActual : '';
  }

  function renderGaleria() {
    galeriaEl.hidden = !estado.puedeVer;
    if (!estado.puedeVer) { return; }
    var opciones = fotosPozosLogic_opcionesFiltro(estado.fotos);
    poblarFiltro(selFuenteFiltroEl, opciones.fuentes, 'Todas las fuentes', estado.filtros.fuente);
    poblarFiltro(selAnioFiltroEl, opciones.anios, 'Todos los años', estado.filtros.anio);
    poblarFiltro(selTipoFiltroEl, opciones.tipos, 'Todos los tipos', estado.filtros.tipo);
    estado.filtros.fuente = selFuenteFiltroEl.value;
    estado.filtros.anio = selAnioFiltroEl.value;
    estado.filtros.tipo = selTipoFiltroEl.value;
    // los filtros solo tienen sentido con varias fotos
    filtrosEl.hidden = estado.fotos.length < 2;
    btnLimpiarFiltrosEl.hidden = !fotosPozosLogic_hayFiltros(estado.filtros);

    var visibles = fotosPozosLogic_filtrar(estado.fotos, estado.filtros);
    grillaEl.innerHTML = '';
    if (estado.fotos.length === 0) {
      mostrarTexto(vacioEl, 'Todavía no hay fotos de este ' + (estado.entidad && estado.entidad.wellId ? 'pozo' : 'punto') + '.');
      return;
    }
    if (visibles.length === 0) {
      mostrarTexto(vacioEl, 'Ninguna foto coincide con los filtros.');
      return;
    }
    mostrarTexto(vacioEl, '');
    visibles.forEach(function (f, i) {
      grillaEl.appendChild(construirItem(f, visibles, i));
    });
  }

  function construirItem(f, visibles, indice) {
    var item = el('article', 'fotos-item');
    var btn = el('button', 'fotos-thumb');
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Ver foto del ' + fotosPozosLogic_formatearFecha(f.fechaFotoValor, f.fechaFotoPrecision));
    var img = el('img');
    img.alt = 'Foto de ' + fotosPozosLogic_formatearFecha(f.fechaFotoValor, f.fechaFotoPrecision);
    img.setAttribute('data-foto-id', f.fotoId);
    btn.appendChild(img);
    btn.addEventListener('click', function () { abrirVisor(visibles, indice); });
    item.appendChild(btn);
    item.appendChild(el('p', 'fotos-item-fecha', fotosPozosLogic_formatearFecha(f.fechaFotoValor, f.fechaFotoPrecision)));
    item.appendChild(el('p', 'fotos-item-detalle', fotosPozosLogic_etiquetaFuente(f.fuente) + ' · ' + fotosPozosLogic_etiquetaTipo(f.tipoFoto)));
    if (f.observacion) {
      item.appendChild(el('p', 'fotos-item-obs', f.observacion));
    }
    var obs = observadorMiniaturas();
    if (estado.miniaturas[f.fotoId]) {
      img.src = estado.miniaturas[f.fotoId];
      btn.classList.add('cargada');
    } else if (obs) {
      obs.observe(img);
    } else {
      cargarMiniatura(img);
    }
    return item;
  }

  function pedirMiniatura(fotoId) {
    if (estado.miniaturas[fotoId]) {
      return Promise.resolve(estado.miniaturas[fotoId]);
    }
    return new Promise(function (resolve, reject) {
      estado.colaMiniaturas.push({ fotoId: fotoId, resolve: resolve, reject: reject });
      avanzarMiniaturas();
    });
  }

  function avanzarMiniaturas() {
    while (estado.miniaturasActivas < MAX_MINIATURAS_PARALELAS && estado.colaMiniaturas.length > 0) {
      var tarea = estado.colaMiniaturas.shift();
      estado.miniaturasActivas += 1;
      (function (t) {
        var ctx = contexto();
        var p = ctx && estado.puedeVer ? apiGetFotoPozo(ctx.sessionToken, t.fotoId, 'thumb') : Promise.reject(new Error('SIN_CONTEXTO'));
        p.then(function (r) {
          if (r.status !== 'ok') { throw new Error(r.code || 'ERROR'); }
          var url = 'data:' + r.data.mimeType + ';base64,' + r.data.imagenBase64;
          estado.miniaturas[t.fotoId] = url;
          t.resolve(url);
        }).catch(function (err) {
          t.reject(err);
        }).then(function () {
          estado.miniaturasActivas -= 1;
          avanzarMiniaturas();
        });
      })(tarea);
    }
  }

  function observadorMiniaturas() {
    if (estado.observador || typeof IntersectionObserver !== 'function') {
      return estado.observador;
    }
    estado.observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (e) {
        if (e.isIntersecting) {
          estado.observador.unobserve(e.target);
          cargarMiniatura(e.target);
        }
      });
    }, { rootMargin: '200px' });
    return estado.observador;
  }

  function cargarMiniatura(img) {
    pedirMiniatura(img.getAttribute('data-foto-id')).then(function (url) {
      img.src = url;
      img.parentNode.classList.add('cargada');
    }).catch(function () {
      img.parentNode.classList.add('error');
    });
  }

  // =====================================================================
  // Visor
  // =====================================================================

  function abrirVisor(fotos, indice) {
    estado.visor.fotos = fotos;
    estado.visor.indice = indice;
    visorEl.hidden = false;
    document.body.style.overflow = 'hidden';
    cargarFotoVisor();
  }

  function cerrarVisor() {
    estado.visor.token += 1;
    visorEl.hidden = true;
    visorImgEl.removeAttribute('src');
    document.body.style.overflow = '';
  }

  function cargarFotoVisor() {
    var v = estado.visor;
    v.token += 1;
    var token = v.token;
    var foto = v.fotos[v.indice];
    visorContadorEl.textContent = 'Foto ' + (v.indice + 1) + ' de ' + v.fotos.length;
    visorFechaEl.textContent = fotosPozosLogic_formatearFecha(foto.fechaFotoValor, foto.fechaFotoPrecision);
    visorDetalleEl.textContent = fotosPozosLogic_etiquetaFuente(foto.fuente) + ' · ' + fotosPozosLogic_etiquetaTipo(foto.tipoFoto);
    mostrarTexto(visorObsEl, foto.observacion);
    var hayVarias = v.fotos.length > 1;
    btnVisorAnteriorEl.hidden = !hayVarias;
    btnVisorSiguienteEl.hidden = !hayVarias;
    visorImgEl.hidden = true;
    visorErrorEl.hidden = true;
    visorCargandoEl.hidden = false;
    var ctx = contexto();
    if (!ctx) { return; }
    // La imagen completa se pide SOLO ahora (y al navegar), nunca antes.
    apiGetFotoPozo(ctx.sessionToken, foto.fotoId, 'full').then(function (r) {
      if (token !== estado.visor.token) { return; }
      visorCargandoEl.hidden = true;
      if (r.status !== 'ok') { throw new Error(r.code || 'ERROR'); }
      visorImgEl.src = 'data:' + r.data.mimeType + ';base64,' + r.data.imagenBase64;
      visorImgEl.hidden = false;
    }).catch(function (err) {
      if (token !== estado.visor.token) { return; }
      visorCargandoEl.hidden = true;
      visorErrorEl.textContent = err && err.message === 'PERMISSION_DENIED'
        ? 'No tenés permiso para ver las fotos.'
        : 'No se pudo cargar la foto. Revisá tu conexión.';
      visorErrorEl.hidden = false;
    });
  }

  function navegarVisor(direccion) {
    var v = estado.visor;
    if (v.fotos.length < 2) { return; }
    v.indice = reemplazoFotosLogic_vecino(v.indice, v.fotos.length, direccion);
    cargarFotoVisor();
  }

  // =====================================================================
  // Carga: seleccion + compresion
  // =====================================================================

  function resetFormulario() {
    estado.items = [];
    estado.form = formularioNuevo();
    estado.gps = { pedido: false, estado: '', lat: null, lon: null, precisionM: null, token: estado.gps.token + 1 };
    inputCamaraEl.value = '';
    inputGaleriaEl.value = '';
    formEl.hidden = true;
    mostrarTexto(errArchivosEl, '');
    renderFormulario();
  }

  function renderFormulario() {
    var f = estado.form;
    inputFechaEl.value = f.fecha;
    inputFechaEl.max = fotosPozosLogic_fechaHoy();
    inputFechaEl.disabled = f.fechaDesconocida;
    chkFechaDesconocidaEl.checked = f.fechaDesconocida;
    selTipoEl.value = f.tipoFoto;
    var fuentes = fotosPozosLogic_fuentesDisponibles(estado.entidad);
    selFuenteEl.innerHTML = '';
    fuentes.forEach(function (v) {
      var op = document.createElement('option');
      op.value = v;
      op.textContent = fotosPozosLogic_etiquetaFuente(v);
      selFuenteEl.appendChild(op);
    });
    selFuenteEl.value = fuentes.indexOf(f.fuente) >= 0 ? f.fuente : 'CAMPO_APP';
    grupoFuenteEl.hidden = fuentes.length < 2;
    obsEl.value = f.observacion;
    obsContadorEl.textContent = f.observacion.length + '/' + FOTOS_POZOS_OBSERVACION_MAX;
    chkGpsEl.checked = estado.gps.pedido;
    mostrarTexto(gpsEstadoEl, estado.gps.pedido ? gpsTexto() : '');
    renderPrevisualizaciones();
  }

  function gpsTexto() {
    return estado.gps.estado === 'pidiendo' ? 'Obteniendo ubicación...' : fotosPozosLogic_textoGps(estado.gps.estado, estado.gps.precisionM);
  }

  function agregarArchivos(lista) {
    mostrarTexto(errArchivosEl, '');
    var archivos = Array.prototype.slice.call(lista || []);
    var rechazos = [];
    var pendientes = archivos.length;
    if (pendientes === 0) { return; }
    archivos.forEach(function (archivo) {
      // el formato se decide por CONTENIDO: extension y mime pueden no coincidir
      fotosImagen_leerBytes(archivo, 0, BYTES_CABECERA).then(function (bytes) {
        var formato = fotosPozosLogic_detectarFormato(bytes);
        var v = fotosPozosLogic_validarArchivo(archivo, formato, estado.items.length);
        if (!v.ok) {
          rechazos.push(fotosPozosLogic_mensajeError(v.code));
          return;
        }
        var item = {
          id: estado.siguienteId++, estado: 'procesando', bytesOriginal: archivo.size, bytes: 0, formato: formato,
          base64: null, thumbBase64: null, error: null, fechaExif: formato === 'JPEG' ? fotosPozosLogic_fechaExif(bytes) : null,
          sha1: '', calidad: 0.72, ladoMayor: 1600
        };
        estado.items.push(item);
        renderPrevisualizaciones();
        Promise.all([fotosImagen_comprimir(archivo), fotosImagen_sha1(archivo)]).then(function (res) {
          var r = res[0];
          item.base64 = r.base64;
          item.thumbBase64 = r.thumbBase64;
          item.bytes = r.bytes;
          item.calidad = r.calidad;
          item.ladoMayor = r.ladoMayor;
          item.sha1 = res[1];
          item.estado = 'lista';
        }).catch(function (err) {
          item.estado = 'error';
          item.error = err && err.message === 'COMPRIMIR_GRANDE'
            ? reemplazoFotosLogic_mensajeError('COMPRIMIR_GRANDE')
            : (item.formato === 'HEIC' ? fotosPozosLogic_mensajeError('HEIC_NO_SOPORTADO') : reemplazoFotosLogic_mensajeError('DECODIFICAR'));
        }).then(function () {
          renderPrevisualizaciones();
        });
      }).then(function () {
        pendientes -= 1;
        if (pendientes === 0 && rechazos.length > 0) {
          mostrarTexto(errArchivosEl, rechazos.filter(function (m, i) { return rechazos.indexOf(m) === i; }).join(' '));
        }
        renderPrevisualizaciones();
      });
    });
  }

  function quitarItem(id) {
    estado.items = estado.items.filter(function (it) { return it.id !== id; });
    mostrarTexto(errArchivosEl, '');
    renderPrevisualizaciones();
  }

  function renderPrevisualizaciones() {
    previewsEl.innerHTML = '';
    estado.items.forEach(function (it) {
      var tarjeta = el('div', 'reemplazo-foto-preview reemplazo-foto-' + it.estado);
      var marco = el('div', 'reemplazo-foto-preview-marco');
      if (it.thumbBase64) {
        var img = el('img');
        img.alt = 'Vista previa de la foto ' + it.id;
        img.src = 'data:image/jpeg;base64,' + it.thumbBase64;
        marco.appendChild(img);
      } else if (it.estado === 'procesando') {
        marco.appendChild(el('span', 'spinner'));
      } else {
        marco.appendChild(el('span', 'reemplazo-foto-preview-error-icono', '!'));
      }
      tarjeta.appendChild(marco);
      var info = el('p', 'reemplazo-foto-preview-info');
      if (it.estado === 'procesando') {
        info.textContent = 'Procesando...';
      } else if (it.estado === 'error') {
        info.textContent = it.error;
        info.classList.add('error-message');
      } else {
        var fecha = fotosPozosLogic_resolverFecha(it, estado.form);
        info.textContent = reemplazoFotosLogic_formatearBytes(it.bytesOriginal) + ' → ' + reemplazoFotosLogic_formatearBytes(it.bytes) +
          ' · ' + fotosPozosLogic_formatearFecha(fecha.valor, fecha.precision) + (fecha.fuente === 'EXIF' ? ' (de la imagen)' : '');
      }
      tarjeta.appendChild(info);
      var quitar = el('button', 'reemplazo-foto-quitar', '×');
      quitar.type = 'button';
      quitar.setAttribute('aria-label', 'Quitar foto');
      quitar.addEventListener('click', function () { quitarItem(it.id); });
      tarjeta.appendChild(quitar);
      previewsEl.appendChild(tarjeta);
    });
    var lleno = estado.items.length >= FOTOS_POZOS_MAX_POR_LOTE;
    btnCamaraEl.disabled = lleno;
    btnGaleriaEl.disabled = lleno;
    var listas = reemplazoFotosLogic_listasParaSubir(estado.items).length;
    btnSubirEl.textContent = listas > 1 ? 'Subir ' + listas + ' fotos' : 'Subir foto';
    btnSubirEl.disabled = listas === 0;
  }

  // =====================================================================
  // GPS opcional
  // =====================================================================

  function pedirGps() {
    estado.gps.pedido = true;
    estado.gps.estado = 'pidiendo';
    estado.gps.token += 1;
    var token = estado.gps.token;
    mostrarTexto(gpsEstadoEl, gpsTexto());
    fotosPozosLogic_obtenerGps(typeof navigator !== 'undefined' ? navigator.geolocation : null).then(function (r) {
      if (token !== estado.gps.token) { return; }       // el usuario lo desmarco o cerro la pantalla
      estado.gps.estado = r.estado;
      estado.gps.lat = r.estado === 'ok' ? r.lat : null;
      estado.gps.lon = r.estado === 'ok' ? r.lon : null;
      estado.gps.precisionM = r.estado === 'ok' ? r.precisionM : null;
      mostrarTexto(gpsEstadoEl, gpsTexto());
    });
  }

  function quitarGps() {
    estado.gps = { pedido: false, estado: '', lat: null, lon: null, precisionM: null, token: estado.gps.token + 1 };
    mostrarTexto(gpsEstadoEl, '');
  }

  // =====================================================================
  // Cola de subida (secuencial, una foto por request)
  // =====================================================================

  var cola = fotosPozosCola_crear({
    subir: function (item) {
      var ctx = contexto();
      if (!ctx) { return Promise.resolve({ status: 'error', code: 'UNAUTHORIZED' }); }
      return apiSubirFotoPozo(ctx.sessionToken, item.request);
    },
    onCambio: function () { renderSubida(); },
    onSubida: function (item, data) {
      item.request = null;
      var foto = data && data.foto;
      var ctx = contexto();
      var puedeVer = !!(ctx && ctx.permisos && ctx.permisos.fotos === true);
      if (foto && !data.duplicada) {
        // contador compartido: ya refleja la foto nueva (solo existe con fotos=SI)
        if (puedeVer) { fotosPozosResumenController_incrementar(item.entidadClave, 1); }
      }
      // La galeria abierta ES la de esa entidad: la foto aparece YA (con su miniatura local)
      if (foto && puedeVer && estado.entidad && fotosPozosLogic_claveEntidad(estado.entidad) === item.entidadClave) {
        estado.miniaturas[foto.fotoId] = 'data:image/jpeg;base64,' + item.thumbBase64;
        estado.fotos = fotosPozosLogic_agregarFoto(estado.fotos, foto, 'recientes');
        renderCabecera();
        renderGaleria();
      }
    },
    onSesionExpirada: function () {
      var ctx = contexto();
      if (ctx && ctx.onSessionExpired) { ctx.onSessionExpired(); }
    }
  });

  function renderSubida() {
    var propios = cola.estado.items.filter(function (it) { return estado.entidad && it.entidadClave === fotosPozosLogic_claveEntidad(estado.entidad); });
    if (propios.length === 0) {
      subidaEl.hidden = true;
      return;
    }
    var r = reemplazoFotosLogic_resumenSubida(propios);
    if (r.subidas === r.total) {
      // Todo subido: se avisa y el panel se oculta
      subidaEl.hidden = true;
      var nuevas = propios.filter(function (it) { return !it.duplicada; }).length;
      var repetidas = r.total - nuevas;
      estado.mensajeExito = (nuevas > 0 ? (nuevas === 1 ? 'Foto guardada.' : nuevas + ' fotos guardadas.') : '') +
        (repetidas > 0 ? (nuevas > 0 ? ' ' : '') + (repetidas === 1 ? 'Una foto ya estaba cargada en este ' : repetidas + ' fotos ya estaban cargadas en este ') + (estado.entidad.wellId ? 'pozo.' : 'punto.') : '');
      cola.limpiarSubidas();
      mostrarTexto(exitoEl, estado.mensajeExito);
      return;
    }
    subidaEl.hidden = false;
    subidaTituloEl.textContent = r.enCurso > 0
      ? 'Subiendo fotos: ' + r.subidas + ' de ' + r.total
      : r.subidas + ' de ' + r.total + ' fotos subidas. Reintentá las que fallaron.';
    subidaListaEl.innerHTML = '';
    propios.forEach(function (it, i) {
      var fila = el('div', 'reemplazo-subida-fila reemplazo-subida-' + it.estado);
      var img = el('img', 'reemplazo-subida-mini');
      img.alt = 'Foto ' + (i + 1);
      if (it.thumbBase64) { img.src = 'data:image/jpeg;base64,' + it.thumbBase64; }
      fila.appendChild(img);
      var texto = el('div', 'reemplazo-subida-texto');
      texto.appendChild(el('p', 'reemplazo-subida-nombre', 'Foto ' + (i + 1)));
      var etiquetas = { pendiente: 'En espera', subiendo: 'Subiendo...', subida: 'Subida', fallida: it.error || 'Falló' };
      texto.appendChild(el('p', 'reemplazo-subida-estado' + (it.estado === 'fallida' ? ' error-message' : ''), etiquetas[it.estado]));
      if (it.estado === 'fallida' && it.codigo) {
        texto.appendChild(el('p', 'reemplazo-subida-codigo', reemplazoFotosLogic_textoCodigo(it.codigo)));
      }
      fila.appendChild(texto);
      if (it.estado === 'fallida') {
        var btn = el('button', 'button-secondary reemplazo-subida-reintentar', 'Reintentar');
        btn.type = 'button';
        btn.addEventListener('click', function () { cola.reintentar(it); });
        fila.appendChild(btn);
      }
      subidaListaEl.appendChild(fila);
    });
  }

  function leerFormulario() {
    var f = estado.form;
    f.observacion = obsEl.value;
    f.tipoFoto = selTipoEl.value;
    f.fuente = selFuenteEl.value;
    f.fechaDesconocida = chkFechaDesconocidaEl.checked;
    return f;
  }

  function onSubir(e) {
    e.preventDefault();
    var f = leerFormulario();
    mostrarTexto(errFechaEl, '');
    mostrarTexto(errObsEl, '');
    mostrarTexto(errArchivosEl, '');
    if (estado.items.some(function (it) { return it.estado === 'procesando'; })) {
      mostrarTexto(errArchivosEl, 'Esperá a que terminen de procesarse las fotos.');
      return;
    }
    var v = fotosPozosLogic_validarFormulario(f);
    if (!v.valido) {
      mostrarTexto(errFechaEl, v.errores.fecha);
      mostrarTexto(errObsEl, v.errores.observacion);
      return;
    }
    var listas = reemplazoFotosLogic_listasParaSubir(estado.items);
    if (listas.length === 0) {
      mostrarTexto(errArchivosEl, 'Elegí al menos una foto.');
      return;
    }
    var gps = estado.gps.pedido && estado.gps.estado === 'ok' ? { lat: estado.gps.lat, lon: estado.gps.lon } : null;
    var entidad = estado.entidad;
    var clave = fotosPozosLogic_claveEntidad(entidad);
    var formCongelado = { fecha: f.fecha, fechaEditada: f.fechaEditada, fechaDesconocida: f.fechaDesconocida, tipoFoto: f.tipoFoto, fuente: f.fuente, observacion: f.observacion };
    var nuevos = listas.map(function (it) {
      return {
        id: it.id, entidadClave: clave, thumbBase64: it.thumbBase64, base64: it.base64, error: null,
        request: fotosPozosLogic_armarSubida(it, entidad, formCongelado, gps)
      };
    });
    estado.mensajeExito = '';
    mostrarTexto(exitoEl, '');
    cola.encolar(nuevos);
    resetFormulario();
    renderSubida();
  }

  // =====================================================================
  // Eventos
  // =====================================================================

  btnAgregarEl.addEventListener('click', function () {
    formEl.hidden = !formEl.hidden;
    if (!formEl.hidden) {
      renderFormulario();
      formEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  });
  btnCancelarEl.addEventListener('click', resetFormulario);
  formEl.addEventListener('submit', onSubir);
  btnCamaraEl.addEventListener('click', function () { inputCamaraEl.click(); });
  btnGaleriaEl.addEventListener('click', function () { inputGaleriaEl.click(); });
  [inputCamaraEl, inputGaleriaEl].forEach(function (input) {
    input.addEventListener('change', function () {
      agregarArchivos(input.files);
      input.value = '';     // permite elegir de nuevo la misma foto
    });
  });
  inputFechaEl.addEventListener('input', function () {
    estado.form.fecha = inputFechaEl.value;
    estado.form.fechaEditada = true;
    mostrarTexto(errFechaEl, '');
    renderPrevisualizaciones();
  });
  chkFechaDesconocidaEl.addEventListener('change', function () {
    estado.form.fechaDesconocida = chkFechaDesconocidaEl.checked;
    inputFechaEl.disabled = estado.form.fechaDesconocida;
    renderPrevisualizaciones();
  });
  selTipoEl.addEventListener('change', function () { estado.form.tipoFoto = selTipoEl.value; });
  selFuenteEl.addEventListener('change', function () { estado.form.fuente = selFuenteEl.value; });
  obsEl.addEventListener('input', function () {
    estado.form.observacion = obsEl.value;
    obsContadorEl.textContent = obsEl.value.length + '/' + FOTOS_POZOS_OBSERVACION_MAX;
  });
  chkGpsEl.addEventListener('change', function () {
    if (chkGpsEl.checked) { pedirGps(); } else { quitarGps(); }
  });
  [selFuenteFiltroEl, selAnioFiltroEl, selTipoFiltroEl].forEach(function (select) {
    select.addEventListener('change', function () {
      estado.filtros = { fuente: selFuenteFiltroEl.value, anio: selAnioFiltroEl.value, tipo: selTipoFiltroEl.value };
      renderGaleria();
    });
  });
  btnLimpiarFiltrosEl.addEventListener('click', function () {
    estado.filtros = { fuente: '', anio: '', tipo: '' };
    renderGaleria();
  });
  btnReintentarEl.addEventListener('click', function () {
    if (estado.entidad) { fotosPozosController_abrir(estado.entidad); }
  });

  btnVisorCerrarEl.addEventListener('click', cerrarVisor);
  btnVisorAnteriorEl.addEventListener('click', function () { navegarVisor(-1); });
  btnVisorSiguienteEl.addEventListener('click', function () { navegarVisor(1); });
  visorEl.addEventListener('click', function (e) {
    if (e.target === visorEl) { cerrarVisor(); }
  });
  // swipe simple: deslizar horizontalmente (> 50 px) cambia de foto
  visorEl.addEventListener('touchstart', function (e) {
    estado.visor.toqueX = e.touches && e.touches.length === 1 ? e.touches[0].clientX : null;
  }, { passive: true });
  visorEl.addEventListener('touchend', function (e) {
    var x0 = estado.visor.toqueX;
    estado.visor.toqueX = null;
    if (x0 === null || !e.changedTouches || e.changedTouches.length === 0) { return; }
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) { navegarVisor(dx < 0 ? 1 : -1); }
  }, { passive: true });
  document.addEventListener('keydown', function (e) {
    if (visorEl.hidden) { return; }
    if (e.key === 'Escape') { cerrarVisor(); }
    else if (e.key === 'ArrowLeft') { navegarVisor(-1); }
    else if (e.key === 'ArrowRight') { navegarVisor(1); }
  });

  // Chip "📷 N" para cards/resultados (Buscar reemplazo, Cerca Mio): SOLO si hay
  // fotos=SI, el resumen esta cargado y el pozo tiene al menos una foto. Si no,
  // null (no se revela nada ni se pinta "0 fotos"). onClick abre la galeria.
  function fotosPozosController_crearChip(wellId, onClick) {
    var n = fotosPozosResumenController_cantidadDe(wellId);
    if (!(n > 0) || typeof onClick !== 'function') {
      return null;
    }
    var chip = el('button', 'fotos-chip');
    chip.type = 'button';
    chip.setAttribute('aria-label', fotosPozosLogic_textoContador(n) + ' del pozo ' + wellId);
    chip.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5"/></svg>';
    chip.appendChild(el('span', '', String(n)));
    chip.addEventListener('click', function (ev) {
      ev.stopPropagation();       // dentro de filas expandibles (Cerca Mio) no debe abrir/cerrar la fila
      onClick(wellId);
    });
    return chip;
  }

  window.fotosPozosController_crearChip = fotosPozosController_crearChip;
  window.fotosPozosController_inicializar = function (obtenerContexto) { estado.obtenerContexto = obtenerContexto; };
  window.fotosPozosController_abrir = fotosPozosController_abrir;
  window.fotosPozosController_cerrar = fotosPozosController_cerrar;
  window.fotosPozosController_reset = fotosPozosController_reset;
})();
