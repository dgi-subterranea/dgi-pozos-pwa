// Controlador de las FOTOS de una evaluacion de reemplazo (v2): elegir/
// sacar fotos, comprimirlas en el navegador, cola de subida secuencial,
// miniaturas lazy en el historial y visor. Igual que el resto: nunca lee
// el sessionToken por su cuenta (app.js/reemplazo.js le pasan un
// obtenerContexto) y toda la logica pura vive en js/reemplazoFotosLogic.js.
//
// Privacidad: el navegador habla solo con el backend principal (nunca ve
// URLs ni Drive IDs). Las fotos se re-codifican con canvas a JPEG, lo que
// descarta EXIF/GPS. Los nombres de archivo originales (pueden traer datos
// personales) no se envian ni se muestran.
//
// Flujo transaccional: la evaluacion se guarda PRIMERO (js/reemplazo.js) y
// despues se suben las fotos, una por request. Si una falla, la evaluacion
// y las demas fotos quedan; la fallida se puede reintentar.
(function () {
  var estado = {
    obtenerContexto: null,
    onCambio: null,            // (evaluacionId) => re-pintar el historial
    items: [],                 // fotos del formulario abierto
    siguienteId: 1,
    wellId: null,
    fotosPorEvaluacion: {},    // evaluacionId -> [metadata] (sin email ni driveFileId)
    miniaturas: {},            // fotoId -> dataUrl (cache en memoria)
    colaMiniaturas: [],
    miniaturasActivas: 0,
    subida: { evaluacionId: null, wellId: null, items: [], subiendo: false },
    visor: { fotos: [], indice: 0, token: 0 },
    observador: null
  };

  var MAX_MINIATURAS_PARALELAS = 3;

  var inputCamaraEl = document.getElementById('input-reemplazo-foto-camara');
  var inputGaleriaEl = document.getElementById('input-reemplazo-foto-galeria');
  var btnCamaraEl = document.getElementById('btn-reemplazo-foto-camara');
  var btnGaleriaEl = document.getElementById('btn-reemplazo-foto-galeria');
  var previewsEl = document.getElementById('reemplazo-fotos-previews');
  var errorFotosEl = document.getElementById('reemplazo-err-fotos');
  var subidaEl = document.getElementById('reemplazo-subida');
  var subidaTituloEl = document.getElementById('reemplazo-subida-titulo');
  var subidaListaEl = document.getElementById('reemplazo-subida-lista');

  var visorEl = document.getElementById('reemplazo-visor-overlay');
  var visorImgEl = document.getElementById('reemplazo-visor-img');
  var visorCargandoEl = document.getElementById('reemplazo-visor-cargando');
  var visorErrorEl = document.getElementById('reemplazo-visor-error');
  var visorContadorEl = document.getElementById('reemplazo-visor-contador');
  var btnVisorCerrarEl = document.getElementById('btn-reemplazo-visor-cerrar');
  var btnVisorAnteriorEl = document.getElementById('btn-reemplazo-visor-anterior');
  var btnVisorSiguienteEl = document.getElementById('btn-reemplazo-visor-siguiente');

  function reemplazoFotosController_inicializar(obtenerContexto, onCambio) {
    estado.obtenerContexto = obtenerContexto;
    estado.onCambio = onCambio;
  }

  function contexto() {
    return estado.obtenerContexto ? estado.obtenerContexto() : null;
  }

  function el(tag, clase, texto) {
    var e = document.createElement(tag);
    if (clase) { e.className = clase; }
    if (texto !== undefined && texto !== null) { e.textContent = texto; }
    return e;
  }

  // =====================================================================
  // 1) Seleccion + compresion en el navegador
  // =====================================================================

  // Decodifica respetando la orientacion EXIF (fotos de celular tomadas en
  // vertical). createImageBitmap con 'from-image'; si el navegador no lo
  // soporta, <img> (los navegadores modernos tambien la respetan).
  function decodificarConImg(archivo) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(archivo);
      var img = new Image();
      img.onload = function () {
        resolve({ fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: function () { URL.revokeObjectURL(url); } });
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('DECODIFICAR')); };
      img.src = url;
    });
  }

  function decodificar(archivo) {
    if (typeof createImageBitmap !== 'function') {
      return decodificarConImg(archivo);
    }
    return createImageBitmap(archivo, { imageOrientation: 'from-image' })
      .catch(function () { return createImageBitmap(archivo); })
      .then(function (bmp) {
        return { fuente: bmp, ancho: bmp.width, alto: bmp.height, liberar: function () { if (bmp.close) { bmp.close(); } } };
      })
      .catch(function () { return decodificarConImg(archivo); });
  }

  function dibujarABlob(decodificada, dimMax, calidad) {
    var d = reemplazoFotosLogic_dimensiones(decodificada.ancho, decodificada.alto, dimMax);
    var canvas = document.createElement('canvas');
    canvas.width = d.ancho;
    canvas.height = d.alto;
    var ctx = canvas.getContext('2d');
    // Fondo blanco: un PNG con transparencia no debe salir negro en JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, d.ancho, d.alto);
    ctx.drawImage(decodificada.fuente, 0, 0, d.ancho, d.alto);
    return new Promise(function (resolve, reject) {
      canvas.toBlob(function (blob) {
        canvas.width = 0; canvas.height = 0;
        if (blob) { resolve(blob); } else { reject(new Error('DECODIFICAR')); }
      }, 'image/jpeg', calidad);
    });
  }

  function blobABase64(blob) {
    return new Promise(function (resolve, reject) {
      var lector = new FileReader();
      lector.onload = function () { resolve(reemplazoFotosLogic_base64DeDataUrl(lector.result)); };
      lector.onerror = function () { reject(new Error('DECODIFICAR')); };
      lector.readAsDataURL(blob);
    });
  }

  // Foto completa a 1600 px bajando la calidad solo si hace falta (escalera
  // 0.72 -> 0.62 -> 0.52), mas la miniatura de 256 px. {base64, bytes,
  // thumbBase64, thumbBytes, ancho, alto, calidad}.
  function comprimir(archivo) {
    return decodificar(archivo).then(function (dec) {
      var resultado = {};
      function intentar(calidad) {
        return dibujarABlob(dec, REEMPLAZO_FOTOS_MAX_DIM, calidad).then(function (blob) {
          var siguiente = reemplazoFotosLogic_siguienteCalidad(calidad, blob.size);
          if (siguiente !== null) {
            return intentar(siguiente);
          }
          if (blob.size > REEMPLAZO_FOTOS_OBJETIVO_BYTES) {
            throw new Error('COMPRIMIR_GRANDE');
          }
          resultado.bytes = blob.size;
          resultado.calidad = calidad;
          var d = reemplazoFotosLogic_dimensiones(dec.ancho, dec.alto, REEMPLAZO_FOTOS_MAX_DIM);
          resultado.ancho = d.ancho;
          resultado.alto = d.alto;
          return blobABase64(blob);
        });
      }
      return intentar(REEMPLAZO_FOTOS_CALIDADES[0]).then(function (b64) {
        resultado.base64 = b64;
        return dibujarABlob(dec, REEMPLAZO_FOTOS_THUMB_DIM, 0.6);
      }).then(function (thumb) {
        resultado.thumbBytes = thumb.size;
        return blobABase64(thumb);
      }).then(function (thumbB64) {
        resultado.thumbBase64 = thumbB64;
        dec.liberar();
        return resultado;
      }, function (err) {
        dec.liberar();
        throw err;
      });
    });
  }

  function mostrarErrorFotos(texto) {
    errorFotosEl.textContent = texto || '';
    errorFotosEl.hidden = !texto;
  }

  function agregarArchivos(lista) {
    mostrarErrorFotos('');
    var archivos = Array.prototype.slice.call(lista || []);
    var rechazadas = [];
    archivos.forEach(function (archivo) {
      var v = reemplazoFotosLogic_validarArchivo(archivo, estado.items.length);
      if (!v.ok) {
        rechazadas.push(reemplazoFotosLogic_mensajeError(v.code));
        return;
      }
      var item = {
        id: estado.siguienteId++, estado: 'procesando', bytesOriginal: archivo.size,
        bytes: 0, base64: null, thumbBase64: null, error: null
      };
      estado.items.push(item);
      comprimir(archivo).then(function (r) {
        item.base64 = r.base64;
        item.thumbBase64 = r.thumbBase64;
        item.bytes = r.bytes;
        item.calidad = r.calidad;
        item.estado = 'lista';
        renderPrevisualizaciones();
      }).catch(function (err) {
        item.estado = 'error';
        item.error = reemplazoFotosLogic_mensajeError(err && err.message === 'COMPRIMIR_GRANDE' ? 'COMPRIMIR_GRANDE' : 'DECODIFICAR');
        renderPrevisualizaciones();
      });
    });
    if (rechazadas.length > 0) {
      // un mensaje por tipo de motivo, sin repetirlo por archivo
      mostrarErrorFotos(rechazadas.filter(function (m, i) { return rechazadas.indexOf(m) === i; }).join(' '));
    }
    renderPrevisualizaciones();
  }

  function quitarItem(id) {
    estado.items = estado.items.filter(function (it) { return it.id !== id; });
    mostrarErrorFotos('');
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
        // tamano antes -> despues (medicion visible para el usuario)
        info.textContent = reemplazoFotosLogic_formatearBytes(it.bytesOriginal) + ' → ' + reemplazoFotosLogic_formatearBytes(it.bytes);
      }
      tarjeta.appendChild(info);

      var quitar = el('button', 'reemplazo-foto-quitar', '×');
      quitar.type = 'button';
      quitar.setAttribute('aria-label', 'Quitar foto');
      quitar.addEventListener('click', function () { quitarItem(it.id); });
      tarjeta.appendChild(quitar);
      previewsEl.appendChild(tarjeta);
    });
    var lleno = estado.items.length >= REEMPLAZO_FOTOS_MAX;
    btnCamaraEl.disabled = lleno;
    btnGaleriaEl.disabled = lleno;
  }

  function reemplazoFotosController_resetFormulario() {
    estado.items = [];
    mostrarErrorFotos('');
    inputCamaraEl.value = '';
    inputGaleriaEl.value = '';
    renderPrevisualizaciones();
  }

  function reemplazoFotosController_hayProcesando() {
    return estado.items.some(function (it) { return it.estado === 'procesando'; });
  }

  function reemplazoFotosController_cantidadListas() {
    return reemplazoFotosLogic_listasParaSubir(estado.items).length;
  }

  // =====================================================================
  // 2) Cola de subida secuencial (despues de guardar la evaluacion)
  // =====================================================================

  function renderSubida() {
    var s = estado.subida;
    // el panel es del pozo abierto: si el usuario abrio otro pozo mientras
    // se subia, la cola sigue en segundo plano pero no se muestra aca
    if (s.items.length === 0 || (s.wellId && s.wellId !== estado.wellId)) {
      subidaEl.hidden = true;
      return;
    }
    var r = reemplazoFotosLogic_resumenSubida(s.items);
    // Todo subido: el panel se oculta, las fotos ya estan en el historial.
    if (r.subidas === r.total) {
      subidaEl.hidden = true;
      return;
    }
    subidaEl.hidden = false;
    subidaTituloEl.textContent = r.enCurso > 0
      ? 'Subiendo fotos: ' + r.subidas + ' de ' + r.total
      : r.subidas + ' de ' + r.total + ' fotos subidas. Reintentá las que fallaron.';
    subidaListaEl.innerHTML = '';
    s.items.forEach(function (it, i) {
      var fila = el('div', 'reemplazo-subida-fila reemplazo-subida-' + it.estado);
      var img = el('img', 'reemplazo-subida-mini');
      img.alt = 'Foto ' + (i + 1);
      if (it.thumbBase64) { img.src = 'data:image/jpeg;base64,' + it.thumbBase64; }
      fila.appendChild(img);

      var texto = el('div', 'reemplazo-subida-texto');
      texto.appendChild(el('p', 'reemplazo-subida-nombre', 'Foto ' + (i + 1)));
      var etiquetas = { pendiente: 'En espera', subiendo: 'Subiendo...', subida: 'Subida', fallida: it.error || 'Falló' };
      texto.appendChild(el('p', 'reemplazo-subida-estado' + (it.estado === 'fallida' ? ' error-message' : ''), etiquetas[it.estado]));
      fila.appendChild(texto);

      if (it.estado === 'fallida') {
        var btn = el('button', 'button-secondary reemplazo-subida-reintentar', 'Reintentar');
        btn.type = 'button';
        btn.addEventListener('click', function () { reintentar(it); });
        fila.appendChild(btn);
      }
      subidaListaEl.appendChild(fila);
    });
  }

  function agregarMetadata(foto) {
    var lista = estado.fotosPorEvaluacion[foto.evaluacionId] || [];
    estado.fotosPorEvaluacion[foto.evaluacionId] = lista.concat([foto]);
  }

  function notificarCambio(evaluacionId) {
    if (estado.onCambio) {
      estado.onCambio(evaluacionId);
    }
  }

  // Procesa de a UNA (nunca en paralelo): el siguiente arranca cuando
  // termina el anterior, salga bien o mal.
  function procesarCola() {
    var s = estado.subida;
    if (s.subiendo) {
      return;
    }
    var item = reemplazoFotosLogic_siguienteASubir(s.items);
    if (!item) {
      renderSubida();
      return;
    }
    var ctx = contexto();
    if (!ctx) {
      return;
    }
    s.subiendo = true;
    item.estado = 'subiendo';
    renderSubida();

    // nombre neutro: el original puede traer datos personales
    apiSubirFotoReemplazo(ctx.sessionToken, s.wellId, s.evaluacionId, 'foto.jpg', 'image/jpeg', item.base64, item.thumbBase64)
      .then(function (r) {
        if (r.status === 'ok') {
          item.estado = 'subida';
          item.base64 = null; // libera memoria
          if (estado.wellId === s.wellId) {
            agregarMetadata(r.data.foto);
            notificarCambio(s.evaluacionId);
          }
          return;
        }
        if (r.code === 'UNAUTHORIZED' || r.code === 'USER_DISABLED') {
          item.estado = 'fallida';
          item.error = reemplazoFotosLogic_mensajeError('SERVICE_UNAVAILABLE');
          if (ctx.onSessionExpired) { ctx.onSessionExpired(); }
          return;
        }
        item.estado = 'fallida';
        item.error = reemplazoFotosLogic_mensajeError(r.code);
      })
      .catch(function () {
        item.estado = 'fallida';
        item.error = reemplazoFotosLogic_mensajeError('RED');
      })
      .then(function () {
        s.subiendo = false;
        renderSubida();
        procesarCola();
      });
  }

  function reintentar(item) {
    if (item.estado !== 'fallida') {
      return;
    }
    item.estado = 'pendiente';
    item.error = null;
    renderSubida();
    procesarCola();
  }

  // Llamado por reemplazo.js apenas la evaluacion quedo guardada: toma las
  // fotos listas del formulario y las encola contra esa evaluacion.
  function reemplazoFotosController_subirDeEvaluacion(evaluacion) {
    var listas = reemplazoFotosLogic_listasParaSubir(estado.items);
    if (listas.length === 0) {
      return;
    }
    estado.subida = {
      evaluacionId: evaluacion.evaluacionId,
      wellId: estado.wellId, // el pozo de ESTA evaluacion, aunque el usuario abra otro mientras se sube
      items: listas.map(function (it) {
        return { id: it.id, estado: 'pendiente', base64: it.base64, thumbBase64: it.thumbBase64, error: null };
      }),
      subiendo: false
    };
    estado.items = [];
    renderPrevisualizaciones();
    renderSubida();
    procesarCola();
  }

  // =====================================================================
  // 3) Historial: metadata primero, miniaturas lazy, visor
  // =====================================================================

  // Metadata de todas las fotos del pozo (una llamada). Tolerante: si falla,
  // el historial se ve igual, solo sin fotos.
  function reemplazoFotosController_cargarPozo(wellId) {
    estado.wellId = wellId;
    estado.fotosPorEvaluacion = {};
    // una cola todavia en curso (otro pozo) NO se descarta: termina sola
    if (!reemplazoFotosLogic_hayEnCurso(estado.subida.items)) {
      estado.subida = { evaluacionId: null, wellId: null, items: [], subiendo: false };
    }
    renderSubida();
    var ctx = contexto();
    if (!ctx) {
      return Promise.resolve();
    }
    return apiGetFotosReemplazoPozo(ctx.sessionToken, wellId).then(function (r) {
      if (r.status === 'ok' && estado.wellId === wellId) {
        estado.fotosPorEvaluacion = reemplazoFotosLogic_agruparPorEvaluacion(r.data.fotos);
      }
    }).catch(function () {});
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
        var p = ctx ? apiGetFotoReemplazo(ctx.sessionToken, t.fotoId, 'thumb') : Promise.reject(new Error('SIN_CONTEXTO'));
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
    var fotoId = img.getAttribute('data-foto-id');
    pedirMiniatura(fotoId).then(function (url) {
      img.src = url;
      img.parentNode.classList.add('cargada');
    }).catch(function () {
      img.parentNode.classList.add('error');
    });
  }

  // Bloque "Fotos (N)" de UNA evaluacion (o null si no tiene). Las
  // miniaturas se piden recien cuando entran en pantalla.
  function reemplazoFotosController_construirGaleria(evaluacionId) {
    var fotos = estado.fotosPorEvaluacion[evaluacionId] || [];
    if (fotos.length === 0) {
      return null;
    }
    var bloque = el('div', 'reemplazo-fotos');
    bloque.appendChild(el('p', 'reemplazo-fotos-titulo', 'Fotos (' + fotos.length + ')'));
    var grilla = el('div', 'reemplazo-fotos-grilla');
    fotos.forEach(function (f, i) {
      var btn = el('button', 'reemplazo-foto-thumb');
      btn.type = 'button';
      btn.setAttribute('aria-label', 'Ver foto ' + (i + 1) + ' de ' + fotos.length);
      var img = el('img');
      img.alt = 'Foto ' + (i + 1) + ' de ' + fotos.length;
      img.setAttribute('data-foto-id', f.fotoId);
      btn.appendChild(img);
      btn.addEventListener('click', function () { abrirVisor(fotos, i); });
      grilla.appendChild(btn);
      var obs = observadorMiniaturas();
      if (obs) { obs.observe(img); } else { cargarMiniatura(img); }
    });
    bloque.appendChild(grilla);
    return bloque;
  }

  // ---- Visor ----
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
    var haySiguiente = v.fotos.length > 1;
    btnVisorAnteriorEl.hidden = !haySiguiente;
    btnVisorSiguienteEl.hidden = !haySiguiente;
    visorImgEl.hidden = true;
    visorErrorEl.hidden = true;
    visorCargandoEl.hidden = false;
    var ctx = contexto();
    if (!ctx) { return; }
    // La imagen completa se pide SOLO ahora (y al navegar), nunca antes.
    apiGetFotoReemplazo(ctx.sessionToken, foto.fotoId, 'full').then(function (r) {
      if (token !== estado.visor.token) { return; }
      visorCargandoEl.hidden = true;
      if (r.status !== 'ok') { throw new Error(r.code || 'ERROR'); }
      visorImgEl.src = 'data:' + r.data.mimeType + ';base64,' + r.data.imagenBase64;
      visorImgEl.hidden = false;
    }).catch(function (err) {
      if (token !== estado.visor.token) { return; }
      visorCargandoEl.hidden = true;
      visorErrorEl.textContent = err && err.message === 'PERMISSION_DENIED'
        ? reemplazoFotosLogic_mensajeError('PERMISSION_DENIED')
        : 'No se pudo cargar la foto. Revisá tu conexión.';
      visorErrorEl.hidden = false;
    });
  }

  function navegarVisor(direccion) {
    var v = estado.visor;
    v.indice = reemplazoFotosLogic_vecino(v.indice, v.fotos.length, direccion);
    cargarFotoVisor();
  }

  // =====================================================================
  // Eventos
  // =====================================================================
  btnCamaraEl.addEventListener('click', function () { inputCamaraEl.click(); });
  btnGaleriaEl.addEventListener('click', function () { inputGaleriaEl.click(); });
  [inputCamaraEl, inputGaleriaEl].forEach(function (input) {
    input.addEventListener('change', function () {
      agregarArchivos(input.files);
      input.value = ''; // permite elegir de nuevo la misma foto
    });
  });
  btnVisorCerrarEl.addEventListener('click', cerrarVisor);
  btnVisorAnteriorEl.addEventListener('click', function () { navegarVisor(-1); });
  btnVisorSiguienteEl.addEventListener('click', function () { navegarVisor(1); });
  visorEl.addEventListener('click', function (e) {
    if (e.target === visorEl) { cerrarVisor(); }
  });
  document.addEventListener('keydown', function (e) {
    if (visorEl.hidden) { return; }
    if (e.key === 'Escape') { cerrarVisor(); }
    else if (e.key === 'ArrowLeft') { navegarVisor(-1); }
    else if (e.key === 'ArrowRight') { navegarVisor(1); }
  });

  window.reemplazoFotosController_inicializar = reemplazoFotosController_inicializar;
  window.reemplazoFotosController_resetFormulario = reemplazoFotosController_resetFormulario;
  window.reemplazoFotosController_hayProcesando = reemplazoFotosController_hayProcesando;
  window.reemplazoFotosController_cantidadListas = reemplazoFotosController_cantidadListas;
  window.reemplazoFotosController_subirDeEvaluacion = reemplazoFotosController_subirDeEvaluacion;
  window.reemplazoFotosController_cargarPozo = reemplazoFotosController_cargarPozo;
  window.reemplazoFotosController_construirGaleria = reemplazoFotosController_construirGaleria;
  window.reemplazoFotosController_cerrarVisor = cerrarVisor;
})();
