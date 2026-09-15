(function () {
  var GOOGLE_CLIENT_ID = '970817103867-q30tnqqqcc9lhtaamqplbs28nglcj7q3.apps.googleusercontent.com';

  var sessionToken = null;
  var currentEmail = null;

  var screens = {
    loading: document.getElementById('screen-loading'),
    login: document.getElementById('screen-login'),
    main: document.getElementById('screen-main'),
    wellRecordTable: document.getElementById('screen-well-record-table'),
    perfil: document.getElementById('screen-perfil'),
    datos: document.getElementById('screen-datos'),
    ubicacion: document.getElementById('screen-ubicacion'),
    ne: document.getElementById('screen-ne'),
    disabled: document.getElementById('screen-disabled'),
    offline: document.getElementById('screen-offline')
  };

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  }

  function networkAwareMessage() {
    return navigator.onLine ? getErrorMessage('SERVICE_UNAVAILABLE') : getErrorMessage('OFFLINE');
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // --- Google Identity Services: init programatico, nunca declarativo ---
  // Se inicializa (y recien ahi puede aparecer el prompt de One Tap) SOLO
  // cuando ya sabemos que hace falta - es decir, despues de intentar
  // recuperar la sesion propia y confirmar que no hay una valida. Asi se
  // evita el prompt de Google apareciendo encima de una sesion ya
  // recuperada con exito.
  var gsiLoaded = false;
  var shouldInitGoogleSignIn = false;

  // El boton de Google tarda en aparecer porque script + estilo + iframe
  // del boton son 3 requests seguidos al dominio de Google (medido: ~250-
  // 650ms en una red rapida; bastante mas en datos moviles o en la
  // primera conexion a ese dominio tras reinstalar la PWA). Mientras
  // tanto se muestra un placeholder en el mismo lugar donde va a aparecer
  // el boton real, para que nunca parezca que no hay forma de entrar.
  var GSI_LOAD_TIMEOUT_MS = 10000;
  var gsiLoadTimer = null;

  function showGsiState(state) {
    document.getElementById('google-signin-loading').hidden = state !== 'loading';
    document.getElementById('google-signin-button').hidden = state !== 'button';
    document.getElementById('google-signin-error').hidden = state !== 'error';
  }

  window.onGsiLoaded = function () {
    clearTimeout(gsiLoadTimer);
    gsiLoaded = true;
    tryInitGoogleSignIn();
  };

  window.onGsiLoadError = function () {
    clearTimeout(gsiLoadTimer);
    showGsiState('error');
  };

  function tryInitGoogleSignIn() {
    if (!gsiLoaded || !shouldInitGoogleSignIn) {
      return;
    }
    google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: true
    });
    google.accounts.id.renderButton(document.getElementById('google-signin-button'), {
      type: 'standard',
      shape: 'pill',
      text: 'continue_with',
      size: 'large'
    });
    google.accounts.id.prompt();
    showGsiState('button');
  }

  function goToLogin() {
    shouldInitGoogleSignIn = true;
    if (!gsiLoaded) {
      showGsiState('loading');
      clearTimeout(gsiLoadTimer);
      gsiLoadTimer = setTimeout(function () {
        showGsiState('error');
      }, GSI_LOAD_TIMEOUT_MS);
    }
    tryInitGoogleSignIn();
    showScreen('login');
  }

  // El <script> original ya fallo (onerror) o nunca cargo (timeout): un
  // tag de script fallido no se puede "reintentar" solo, hace falta
  // crear uno nuevo. El happy path (carga bien la primera vez) no pasa
  // por aca.
  document.getElementById('btn-retry-gsi').addEventListener('click', function () {
    showGsiState('loading');
    clearTimeout(gsiLoadTimer);
    gsiLoadTimer = setTimeout(function () {
      showGsiState('error');
    }, GSI_LOAD_TIMEOUT_MS);

    var oldScript = document.getElementById('gsi-script');
    if (oldScript) {
      oldScript.remove();
    }
    var script = document.createElement('script');
    script.id = 'gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = window.onGsiLoaded;
    script.onerror = window.onGsiLoadError;
    document.body.appendChild(script);
  });

  // --- Hub modular: cabecera compacta + tarjetas de acceso solo a los
  // modulos que existen. pozoActual guarda lo que ya se obtuvo de la
  // ultima busqueda (ITF, Ficha/Ubicacion, NE) - las 4 pantallas de
  // modulo leen de aca, nunca refetchean. Se reemplaza por completo en
  // cada busqueda nueva. ---
  var hubArea = document.getElementById('hub-area');
  var perfilContent = document.getElementById('perfil-content');
  var datosContent = document.getElementById('datos-content');
  var ubicacionContent = document.getElementById('ubicacion-content');
  var neContent = document.getElementById('ne-content');
  var pozoActual = null;

  // Permisos efectivos del usuario (perfil/datos/ubicacion/ne), tal como
  // los devolvio el ultimo login/checkSession - NUNCA viven en el
  // sessionToken (que sigue siendo pura identidad). Fail-closed por
  // defecto: hasta que login/checkSession responda, no se asume ningun
  // permiso. Se usan solo para decidir que fetch conviene ni siquiera
  // disparar - el backend vuelve a validar cada uno igual, esto es una
  // optimizacion de red, no el limite de seguridad real.
  var permisosActuales = { perfil: false, datos: false, ubicacion: false, ne: false };

  var ICON_PERFIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5.5-5.5L11 15l-3-3-4.5 4.5"/></svg>';
  var ICON_DATOS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>';
  var ICON_UBICACION = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>';
  var ICON_UBICACION_WARN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-7.2 7-12a7 7 0 10-14 0c0 4.8 7 12 7 12z"/><path d="M12 7v5M12 15h.01"/></svg>';
  var ICON_NE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 17l5-6 4 3 4-7 5 5"/><path d="M3 21h18" stroke-linecap="round"/></svg>';
  var ICON_MAPS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 20l-5-2V5l5 2 6-2 5 2v13l-5-2-6 2z"/></svg>';
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
  var ICON_CLOSE = '<svg viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

  function renderHubIdle() {
    var html = '<div class="idle-hint">' + ICON_SEARCH + '<span>Escribí el número de pozo para empezar</span></div>';
    hubArea.innerHTML = html;
  }

  function renderHubSearching(wellId) {
    hubArea.innerHTML = '<p class="status">Buscando ' + escapeHtml(wellId) + '...</p>';
  }

  function renderHubNotFound(wellId) {
    var html = '<div class="empty-state">';
    html += '<div class="empty-state-icon">' + ICON_CLOSE + '</div>';
    html += '<p class="empty-state-title">No se encontró información</p>';
    html += '<p class="empty-state-text">para el pozo ' + escapeHtml(wellId) + '. Revisá el número e intentá de nuevo.</p>';
    html += '</div>';
    hubArea.innerHTML = html;
  }

  function renderHubError(mensaje) {
    hubArea.innerHTML = '<p class="status error">' + escapeHtml(mensaje) + '</p>';
  }

  // location es la respuesta plana de getWellLocation ({wellId,
  // coordenadas, coordenadasProvincia, ubicacionResuelta}) - independiente
  // de si hay Ficha del Pozo (datos) o no, y del propio permiso "datos".
  function ubicacionModuloDisponible(location) {
    var resuelta = location && location.ubicacionResuelta;
    return !!resuelta && resuelta.estado !== 'sinCoordenadas';
  }

  function renderHubResultado(pozo) {
    if (!pozo.itf.found && !pozo.registro.found && !pozo.ubicacion.found && !pozo.ne.found) {
      renderHubNotFound(pozo.wellId);
      return;
    }

    // Ver js/hubIdentificacion.js para la regla completa (y sus tests):
    // el titular de la cabecera SOLO sale de Datos, nunca de NE, aunque
    // ne=SI - salvo un punto especial sin wellId, que no tiene otra
    // forma de identificarse.
    var identificacion = resolverIdentificacionHub(pozo);
    var html = '<div class="hub-header"><span class="hub-id mono">' + escapeHtml(identificacion.idPrincipal || '') + '</span>';
    if (pozo.registro.found) {
      var estado = pozo.registro.data.estado || {};
      if (estado.situacion) {
        var chipClass = estado.situacion === 'Baja' ? 'hub-chip baja' : 'hub-chip';
        html += '<span class="' + chipClass + '">' + escapeHtml(estado.situacion) + '</span>';
      }
    }
    html += '</div>';

    if (identificacion.identificacionSecundaria) {
      html += '<p class="hub-titular">' + escapeHtml(identificacion.identificacionSecundaria) + '</p>';
    }

    if (pozo.registro.found) {
      var ident = pozo.registro.data.identificacion || {};
      var sub = [ident.departamento, ident.distrito].filter(Boolean).join(' · ');
      if (sub) {
        html += '<p class="hub-sub">' + escapeHtml(sub) + '</p>';
      }
    }

    // Cada modulo es independiente de los demas - "existe" (found) ya
    // implica "el usuario tiene permiso", porque buscarPozo() ni siquiera
    // dispara el fetch de un modulo sin permiso (ver permisosActuales), y
    // el backend lo rechaza con PERMISSION_DENIED si de todas formas
    // llegara a pedirse. Ubicacion NUNCA depende de pozo.registro (datos)
    // - son permisos y fetches distintos.
    var modulos = [];
    if (pozo.itf.found) {
      modulos.push({ id: 'perfil', titulo: 'Perfil', desc: 'Ver imagen ITF', icono: ICON_PERFIL });
    }
    if (pozo.registro.found) {
      modulos.push({ id: 'datos', titulo: 'Datos', desc: 'Ficha técnica y registral', icono: ICON_DATOS });
    }
    if (pozo.ubicacion.found && ubicacionModuloDisponible(pozo.ubicacion.data)) {
      modulos.push({ id: 'ubicacion', titulo: 'Ubicación', desc: 'Mapa y coordenadas', icono: ICON_UBICACION });
    }
    if (pozo.ne.found) {
      modulos.push({ id: 'ne', titulo: 'Niveles estáticos', desc: 'Histórico y evolución', icono: ICON_NE });
    }

    var gridClass = 'hub-grid';
    if (modulos.length === 1) {
      gridClass += ' n1';
    } else if (modulos.length === 3) {
      gridClass += ' n3';
    }

    html += '<div class="' + gridClass + '">';
    modulos.forEach(function (m) {
      html += '<button type="button" class="hub-card" data-modulo="' + m.id + '">';
      html += '<span class="hub-card-icon">' + m.icono + '</span>';
      html += '<span class="hub-card-ct">' + escapeHtml(m.titulo) + '</span>';
      html += '<span class="hub-card-cd">' + escapeHtml(m.desc) + '</span>';
      html += '</button>';
    });
    html += '</div>';

    hubArea.innerHTML = html;

    Array.prototype.forEach.call(hubArea.querySelectorAll('.hub-card'), function (btn) {
      btn.addEventListener('click', function () {
        abrirModulo(btn.getAttribute('data-modulo'));
      });
    });
  }

  function abrirModulo(id) {
    if (id === 'perfil') {
      renderPerfil(pozoActual.itf.data);
      showScreen('perfil');
    } else if (id === 'datos') {
      loadRegistryMetadataOnce().then(function (metadata) {
        renderDatos(pozoActual.registro.data, metadata);
        showScreen('datos');
      });
    } else if (id === 'ubicacion') {
      renderUbicacion(pozoActual.ubicacion.data);
      showScreen('ubicacion');
    } else if (id === 'ne') {
      renderNE(pozoActual.ne.data);
      showScreen('ne');
    }
  }

  // Los 4 modulos siempre vuelven al hub (screen-main) - nunca a otra
  // pantalla, sin importar como se entro. Vista Tecnica es la unica
  // excepcion (vuelve a Datos, es su pantalla padre - ver btn-tv-volver
  // mas abajo), por eso no lleva esta clase.
  Array.prototype.forEach.call(document.querySelectorAll('.btn-volver-pozo'), function (btn) {
    btn.addEventListener('click', function () {
      showScreen('main');
    });
  });

  // --- Modulo Perfil (ITF) ---------------------------------------------
  function base64ToFile(base64, mimeType, filename) {
    var byteChars = atob(base64);
    var byteNumbers = new Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    return new File([new Uint8Array(byteNumbers)], filename, { type: mimeType });
  }

  // iOS no ofrece <a download> de forma confiable para imagenes: Safari
  // tiende a abrirla en vez de guardarla. En vez de depender solo del
  // gesto de mantener presionado, el boton dispara el share sheet nativo
  // (Web Share API con archivos, soportado desde iOS 15), que incluye
  // "Guardar en Fotos". Si el dispositivo no lo soporta, el fallback es
  // abrir la imagen en una pestana nueva, donde Safari si ofrece su
  // propio boton de compartir/guardar sobre la imagen ya abierta.
  async function handleSaveImageIOS(wellId, mimeType, imageBase64, dataUri) {
    var file = base64ToFile(imageBase64, mimeType, wellId + '.jpg');
    var supportsFileShare = false;
    try {
      supportsFileShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    } catch (err) {
      supportsFileShare = false;
    }

    if (supportsFileShare) {
      try {
        await navigator.share({ files: [file], title: 'Perfil ' + wellId });
      } catch (err) {
        // Cancelado por el usuario u otro error del share sheet: no es
        // un error de la app, no hacemos nada mas.
      }
      return;
    }

    window.open(dataUri, '_blank');
  }

  function renderPerfil(data) {
    var dataUri = 'data:' + data.mimeType + ';base64,' + data.imageBase64;
    var html = '<div class="modulo-id-line"><span class="modulo-id mono">' + escapeHtml(data.wellId) + '</span></div>';
    html += '<p class="modulo-subline">Perfil</p>';
    html += '<img class="profile-image" src="' + dataUri + '" alt="Perfil del pozo ' + escapeHtml(data.wellId) + '" />';
    var saveIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>';
    if (isIOS()) {
      html += '<button type="button" id="btn-save-image" class="button">' + saveIcon + 'Guardar / Compartir</button>';
    } else {
      html += '<a class="button" href="' + dataUri + '" download="' + data.wellId + '.jpg">' + saveIcon + 'Guardar / Compartir</a>';
    }
    perfilContent.innerHTML = html;

    if (isIOS()) {
      document.getElementById('btn-save-image').addEventListener('click', function () {
        handleSaveImageIOS(data.wellId, data.mimeType, data.imageBase64, dataUri);
      });
    }
  }

  // --- Modulo Datos (Ficha del Pozo / padron) ----------------------------
  var registryMetadataPromise = null;

  // Se pide una sola vez (al entrar a screen-main) y se reusa para todas
  // las busquedas de la sesion - metadata.json no cambia salvo que se
  // re-corra el indexador, no tiene sentido pedirlo en cada busqueda.
  function loadRegistryMetadataOnce() {
    if (!registryMetadataPromise) {
      registryMetadataPromise = apiGetRegistryMetadata(sessionToken).then(function (result) {
        return result.status === 'ok' ? result.data : null;
      }).catch(function () {
        return null;
      });
    }
    return registryMetadataPromise;
  }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function formatPeriodo(periodo) {
    if (!periodo) {
      return null;
    }
    var partes = periodo.split('-');
    var mesIndex = parseInt(partes[1], 10) - 1;
    if (!partes[0] || !MESES[mesIndex]) {
      return null;
    }
    return MESES[mesIndex] + ' ' + partes[0];
  }

  // El backend (RegistryService) ya saco las claves en null - aca solo
  // se saltea lo que no vino (undefined). '' y null igual se filtran por
  // si acaso, pero 0/false SI deben poder mostrarse (ej.
  // declaracionJurada:false via rowBool) - por eso no se usa un chequeo
  // "falsy" generico.
  function row(label, value) {
    if (value === undefined || value === null || value === '') {
      return '';
    }
    return '<dt>' + escapeHtml(label) + '</dt><dd>' + escapeHtml(value) + '</dd>';
  }

  function rowSecondary(label, value) {
    if (value === undefined || value === null || value === '') {
      return '';
    }
    return '<dt>' + escapeHtml(label) + '</dt><dd class="secundario">' + escapeHtml(value) + '</dd>';
  }

  function rowBool(label, value) {
    if (value === undefined || value === null) {
      return '';
    }
    return row(label, value ? 'Sí' : 'No');
  }

  function sectionBody(rowsHtml) {
    return rowsHtml ? '<dl class="ficha-rows">' + rowsHtml + '</dl>' : '<p class="ficha-empty">Sin información en esta sección.</p>';
  }

  function buildSection(title, bodyHtml) {
    var html = '<details class="ficha-section"><summary>' + escapeHtml(title) + ' <span class="chev">›</span></summary>';
    html += '<div class="ficha-section-body">' + bodyHtml + '</div>';
    html += '</details>';
    return html;
  }

  function formatCementacion(cem) {
    if (!cem) {
      return undefined;
    }
    var partes = [];
    if (cem.estado) {
      partes.push(cem.estado);
    }
    if (cem.desde !== undefined || cem.hasta !== undefined) {
      var desde = cem.desde !== undefined ? cem.desde : '?';
      var hasta = cem.hasta !== undefined ? cem.hasta : '?';
      partes.push(desde + '–' + hasta + ' m');
    }
    return partes.length ? partes.join(', ') : undefined;
  }

  function formatTramos(tramos) {
    if (!tramos || !tramos.length) {
      return undefined;
    }
    return tramos.map(function (t) {
      var desde = t.desde !== undefined ? t.desde : '?';
      var hasta = t.hasta !== undefined ? t.hasta : '?';
      var diam = t.diametro !== undefined ? ' (⌀' + t.diametro + ')' : '';
      return desde + '–' + hasta + ' m' + diam;
    }).join('; ');
  }

  function buildResumenRows(record) {
    var ident = record.identificacion || {};
    var tit = record.titularidad || {};
    var uso = record.usoConcesion || {};
    var tec = record.tecnicas || {};
    var con = record.construccion || {};

    var rows = '';
    rows += row('Departamento', [ident.departamento, ident.distrito].filter(Boolean).join(' — '));
    rows += row('Titular', tit.titular);
    rows += row('Uso', uso.uso);
    rows += row('Profundidad', tec.profundidadTotal !== undefined ? tec.profundidadTotal + ' m' : undefined);
    rows += row('Construcción', con.fecha ? con.fecha.slice(0, 4) : undefined);
    var superficie = uso.superficieConcesion !== undefined ? uso.superficieConcesion : uso.superficieOrigen;
    rows += row('Superficie', superficie !== undefined ? superficie + ' ha' : undefined);
    return rows;
  }

  // "Datos del pozo": identificacion + titularidad + detalle de estado.
  // domicilioTitular queda en secundario a proposito (domicilioPozo, en
  // Ubicacion, se muestra normal).
  function buildDatosPozoRows(record) {
    var ident = record.identificacion || {};
    var tit = record.titularidad || {};
    var estado = record.estado || {};
    var rows = '';
    rows += row('Nomenclatura', ident.nomenclatura);
    rows += row('Registro de perforación', ident.registroPerforacion);
    rows += row('NIC', ident.nic);
    rows += row('Expediente', tit.expediente);
    rows += rowBool('Declaración jurada', tit.declaracionJurada);
    rows += row('Organismo', tit.organismo);
    rows += row('Familia', tit.familia);
    rows += rowSecondary('Domicilio del titular', tit.domicilioTitular);
    rows += rowSecondary('Domicilio postal', tit.domicilioPostal);
    if (estado.situacion === 'Baja' && estado.baja) {
      rows += row('Fecha de baja', estado.baja.fecha);
      rows += row('Motivo de baja', estado.baja.motivo);
      rows += row('Expediente de baja', estado.baja.expediente);
    }
    rows += row('Estado de la obra', estado.estadoObra);
    rows += row('Cegado', estado.cegado);
    return rows;
  }

  function buildTecnicasRows(record) {
    var t = record.tecnicas || {};
    var rows = '';
    rows += row('Diámetro de entubación', t.diametroEntubacion);
    rows += row('Diámetro de bomba', t.diametroBomba);
    rows += row('Profundidad de bomba', t.profundidadBomba !== undefined ? t.profundidadBomba + ' m' : undefined);
    rows += row('Diámetro de antepozo', t.diametroAntepozo);
    rows += row('Profundidad de antepozo', t.profundidadAntepozo !== undefined ? t.profundidadAntepozo + ' m' : undefined);
    rows += row('Nivel estático', t.nivelEstatico);
    rows += row('Caudal', t.caudal);
    rows += row('Depresión', t.depresion);
    rows += row('Potencia', t.potencia);
    rows += row('Índice promedio', t.indicePromedio);
    rows += row('Surgencia', t.surgencia);
    rows += row('Aptitud', t.aptitud);
    rows += rowBool('Riego superficial', t.riegoSuperficial);
    rows += rowBool('Perfilaje', t.perfilaje);
    return rows;
  }

  function buildConstruccionRows(record) {
    var c = record.construccion || {};
    var rows = '';
    rows += row('Fecha', c.fecha);
    rows += row('Empresa', c.empresa);
    rows += row('Director técnico', c.directorTecnico);
    rows += row('Mecanismo de bomba', c.mecanismoBomba);
    rows += row('Cementación', formatCementacion(c.cementacion));
    rows += row('Filtros', formatTramos(c.filtros));
    rows += row('Reducciones', formatTramos(c.reducciones));
    return rows;
  }

  function buildUbicacionRows(record) {
    var u = record.ubicacion || {};
    var uc = record.usoConcesion || {};
    var rows = '';
    rows += row('Domicilio del pozo', u.domicilioPozo);
    rows += row('Plano DGI', u.planoDgi);
    rows += row('Plano catastro', u.planoCatastro);
    rows += row('Uso secundario', uc.usoSecundario);
    rows += row('Superficie de origen', uc.superficieOrigen !== undefined ? uc.superficieOrigen + ' ha' : undefined);
    rows += row('Hectáreas factibles de riego', uc.hectareasFactibles !== undefined ? uc.hectareasFactibles + ' ha' : undefined);
    rows += row('Resolución de concesión', uc.resolucionConcesion);
    if (uc.enProcesoCaducidad) {
      rows += row('Caducidad', 'En trámite');
    }
    return rows;
  }

  function buildMasInfoRows(record) {
    var com = record.comentarios || {};
    var rows = '';
    rows += row('Comentario', com.comentario);
    rows += row('Documentación faltante', com.documentacionFaltante);
    return rows;
  }

  // Cada analisis de laboratorio se muestra como su propia mini-tarjeta,
  // en el orden que vino del backend - nunca se ordena ni se marca
  // ninguno como "el mas reciente" (el reporte no trae fecha de
  // analisis, ver docs/architecture.md).
  var LAB_FIELD_LABELS = {
    laboratorio: 'Laboratorio',
    nroAnalisis: 'N° de análisis',
    ph: 'PH',
    durezaTotal: 'Dureza total',
    durezaPermanente: 'Dureza permanente',
    durezaTemporal: 'Dureza temporal',
    conductividad: 'Conductividad',
    calcio: 'Calcio',
    magnesio: 'Magnesio',
    sodio: 'Sodio',
    potasio: 'Potasio',
    cloruros: 'Cloruros',
    sulfatos: 'Sulfatos',
    bicarbonatos: 'Bicarbonatos',
    carbonatos: 'Carbonatos',
    residuos: 'Residuos',
    residuoSeco: 'Residuo seco',
    csr: 'C.S.R.',
    diagRiever: 'Diagnóstico de Riever',
    coefAlcalinidad: 'Coeficiente de alcalinidad',
    ras: 'R.A.S.',
    rasp: 'R.A.S.P.',
    indiceKelle: 'Índice de Kelle',
    nitratos: 'Nitratos',
    nitritos: 'Nitritos',
    silice: 'Sílice',
    amoniaco: 'Amoníaco'
  };
  var LAB_FIELD_ORDER = Object.keys(LAB_FIELD_LABELS);

  function buildLaboratorioBody(analisisArray) {
    var html = '<p class="ficha-lab-label">' + analisisArray.length +
      (analisisArray.length === 1 ? ' análisis registrado' : ' análisis registrados') + '</p>';
    analisisArray.forEach(function (analisis) {
      var rows = '';
      LAB_FIELD_ORDER.forEach(function (key) {
        rows += row(LAB_FIELD_LABELS[key], analisis[key]);
      });
      html += '<div class="ficha-lab"><dl class="ficha-rows">' + rows + '</dl></div>';
    });
    return html;
  }

  function renderDatos(record, metadata) {
    var estado = record.estado || {};
    var badgeClass = estado.situacion === 'Baja' ? 'ficha-badge baja' : 'ficha-badge';

    var html = '<div class="ficha-pozo">';
    html += '<div class="ficha-pozo-header"><p class="ficha-eyebrow">Ficha del pozo</p>';
    if (estado.situacion) {
      html += '<span class="' + badgeClass + '">' + escapeHtml(estado.situacion) + '</span>';
    }
    html += '</div>';

    var periodoTexto = formatPeriodo(metadata && metadata.periodo);
    if (periodoTexto) {
      html += '<p class="padron-caption">Padrón: ' + escapeHtml(periodoTexto) + '</p>';
    }

    html += '<dl class="ficha-resumen">' + buildResumenRows(record) + '</dl>';

    html += '<div class="ficha-mas">';
    html += buildSection('Datos del pozo', sectionBody(buildDatosPozoRows(record)));
    html += buildSection('Características técnicas', sectionBody(buildTecnicasRows(record)));
    html += buildSection('Construcción', sectionBody(buildConstruccionRows(record)));
    html += buildSection('Ubicación y concesión', sectionBody(buildUbicacionRows(record)));
    var analisis = (record.laboratorio && record.laboratorio.analisis) || [];
    if (analisis.length > 0) {
      html += buildSection('Laboratorio', buildLaboratorioBody(analisis));
    }
    html += buildSection('Más información', sectionBody(buildMasInfoRows(record)));
    html += '</div>';

    html += '<button type="button" id="btn-ver-tabla" class="tabla-toggle">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>';
    html += 'Ver en formato tabla</button>';

    html += '</div>';
    datosContent.innerHTML = html;

    document.getElementById('btn-ver-tabla').addEventListener('click', function () {
      showWellRecordTable(record);
    });
  }

  // --- Vista Tecnica completa: pantalla propia (screen-well-record-table),
  // no un panel dentro de Datos. Se arma a partir del MISMO record ya
  // cargado - nunca dispara un fetch nuevo. Las 8 categorias se calculan
  // una sola vez al abrir la vista; cambiar de pestana solo reemplaza el
  // HTML ya generado, no vuelve a construirlo.
  var tvTabsEl = document.getElementById('tv-tabs');
  var tvContentEl = document.getElementById('tv-content');
  var tvWellIdEl = document.getElementById('tv-wellid');
  var tvBadgeEl = document.getElementById('tv-badge');
  var tvCategoryContents = [];

  function tvSectionBody(rowsHtml) {
    return rowsHtml ? '<dl class="tv-rows">' + rowsHtml + '</dl>' : '<p class="tv-empty">Sin información registrada.</p>';
  }

  function buildTvPadronRows(record) {
    var ident = record.identificacion || {};
    var ubic = record.ubicacion || {};
    var rows = '';
    rows += row('Departamento', ident.departamento);
    rows += row('Distrito', ident.distrito);
    rows += row('Nomenclatura', ident.nomenclatura);
    rows += row('Registro de perforación', ident.registroPerforacion);
    rows += row('NIC', ident.nic);
    rows += row('Plano DGI', ubic.planoDgi);
    rows += row('Plano catastro', ubic.planoCatastro);
    return rows;
  }

  function buildTvTitularidadRows(record) {
    var tit = record.titularidad || {};
    var rows = '';
    rows += row('Titular', tit.titular);
    rows += rowBool('Declaración jurada', tit.declaracionJurada);
    rows += row('Organismo', tit.organismo);
    rows += row('Familia', tit.familia);
    return rows;
  }

  function buildTvDomiciliosRows(record) {
    var tit = record.titularidad || {};
    var ubic = record.ubicacion || {};
    var rows = '';
    rows += row('Domicilio del titular', tit.domicilioTitular);
    rows += row('Domicilio postal', tit.domicilioPostal);
    rows += row('Domicilio del pozo', ubic.domicilioPozo);
    return rows;
  }

  function buildTvTecnicasRows(record) {
    var t = record.tecnicas || {};
    var rows = '';
    rows += row('Diámetro de entubación', t.diametroEntubacion);
    rows += row('Diámetro de bomba', t.diametroBomba);
    rows += row('Profundidad de bomba', t.profundidadBomba !== undefined ? t.profundidadBomba + ' m' : undefined);
    rows += row('Diámetro de antepozo', t.diametroAntepozo);
    rows += row('Profundidad de antepozo', t.profundidadAntepozo !== undefined ? t.profundidadAntepozo + ' m' : undefined);
    rows += row('Profundidad total', t.profundidadTotal !== undefined ? t.profundidadTotal + ' m' : undefined);
    rows += row('Nivel estático', t.nivelEstatico);
    rows += row('Caudal', t.caudal);
    rows += row('Depresión', t.depresion);
    rows += row('Potencia', t.potencia);
    rows += row('Índice promedio', t.indicePromedio);
    rows += row('Surgencia', t.surgencia);
    rows += row('Aptitud', t.aptitud);
    rows += rowBool('Riego superficial', t.riegoSuperficial);
    rows += rowBool('Perfilaje', t.perfilaje);
    return rows;
  }

  function buildTvConstruccionRows(record) {
    var c = record.construccion || {};
    var rows = '';
    rows += row('Fecha', c.fecha);
    rows += row('Empresa', c.empresa);
    rows += row('Director técnico', c.directorTecnico);
    rows += row('Mecanismo de bomba', c.mecanismoBomba);
    rows += row('Cementación', formatCementacion(c.cementacion));
    rows += row('Filtros', formatTramos(c.filtros));
    rows += row('Reducciones', formatTramos(c.reducciones));
    return rows;
  }

  function buildTvEstadoRows(record) {
    var estado = record.estado || {};
    var uc = record.usoConcesion || {};
    var tit = record.titularidad || {};
    var rows = '';
    rows += row('Estado', estado.situacion);
    if (estado.situacion === 'Baja' && estado.baja) {
      rows += row('Fecha de baja', estado.baja.fecha);
      rows += row('Fecha de baja (ctacte)', estado.baja.fechaContable);
      rows += row('Motivo de baja', estado.baja.motivo);
      rows += row('Expediente de baja', estado.baja.expediente);
    }
    rows += row('Estado de la obra', estado.estadoObra);
    rows += row('Cegado', estado.cegado);
    rows += row('Uso', uc.uso);
    rows += row('Uso secundario', uc.usoSecundario);
    rows += row('Superficie de origen', uc.superficieOrigen !== undefined ? uc.superficieOrigen + ' ha' : undefined);
    rows += row('Superficie de concesión', uc.superficieConcesion !== undefined ? uc.superficieConcesion + ' ha' : undefined);
    rows += row('Hectáreas factibles de riego', uc.hectareasFactibles !== undefined ? uc.hectareasFactibles + ' ha' : undefined);
    rows += row('Resolución de concesión', uc.resolucionConcesion);
    if (uc.enProcesoCaducidad) {
      rows += row('Caducidad', 'En trámite');
    }
    rows += row('Expediente', tit.expediente);
    return rows;
  }

  function buildTvComentariosRows(record) {
    var com = record.comentarios || {};
    var rows = '';
    rows += row('Comentario', com.comentario);
    rows += row('Documentación faltante', com.documentacionFaltante);
    return rows;
  }

  // Datos quimicos: cada analisis es su propia mini-tarjeta, identificada
  // por N° de analisis + laboratorio cuando existen - nunca por "mas
  // reciente" (el reporte no trae fecha de analisis).
  function buildTvQuimicosBody(record) {
    var analisis = (record.laboratorio && record.laboratorio.analisis) || [];
    if (!analisis.length) {
      return '<p class="tv-empty">Sin información registrada.</p>';
    }
    var html = '';
    analisis.forEach(function (a, index) {
      var labelPartes = ['Análisis ' + (a.nroAnalisis || (index + 1))];
      if (a.laboratorio) {
        labelPartes.push(a.laboratorio);
      }
      var rows = '';
      LAB_FIELD_ORDER.forEach(function (key) {
        rows += row(LAB_FIELD_LABELS[key], a[key]);
      });
      html += '<div class="tv-analisis"><p class="tv-analisis-label">' + escapeHtml(labelPartes.join(' — ')) + '</p>';
      html += '<dl class="tv-rows">' + rows + '</dl></div>';
    });
    return html;
  }

  var TV_CATEGORIES = [
    { label: 'Padrón', build: function (r) { return tvSectionBody(buildTvPadronRows(r)); } },
    { label: 'Titularidad', build: function (r) { return tvSectionBody(buildTvTitularidadRows(r)); } },
    { label: 'Domicilios', build: function (r) { return tvSectionBody(buildTvDomiciliosRows(r)); } },
    { label: 'Datos técnicos', build: function (r) { return tvSectionBody(buildTvTecnicasRows(r)); } },
    { label: 'Construcción', build: function (r) { return tvSectionBody(buildTvConstruccionRows(r)); } },
    { label: 'Datos químicos', build: buildTvQuimicosBody },
    { label: 'Estado y concesión', build: function (r) { return tvSectionBody(buildTvEstadoRows(r)); } },
    { label: 'Comentarios', build: function (r) { return tvSectionBody(buildTvComentariosRows(r)); } }
  ];

  function showWellRecordTable(record) {
    tvWellIdEl.textContent = record.wellId || '';

    var estado = record.estado || {};
    if (estado.situacion) {
      tvBadgeEl.textContent = estado.situacion;
      tvBadgeEl.className = estado.situacion === 'Baja' ? 'tv-badge baja' : 'tv-badge';
      tvBadgeEl.hidden = false;
    } else {
      tvBadgeEl.hidden = true;
    }

    tvCategoryContents = TV_CATEGORIES.map(function (cat) { return cat.build(record); });

    var tabsHtml = '';
    TV_CATEGORIES.forEach(function (cat, index) {
      tabsHtml += '<button type="button" class="tv-tab' + (index === 0 ? ' active' : '') + '" data-tv-index="' + index + '">' + escapeHtml(cat.label) + '</button>';
    });
    tvTabsEl.innerHTML = tabsHtml;
    tvContentEl.innerHTML = tvCategoryContents[0];

    showScreen('wellRecordTable');
  }

  tvTabsEl.addEventListener('click', function (event) {
    var btn = event.target.closest ? event.target.closest('.tv-tab') : null;
    if (!btn) {
      return;
    }
    var index = parseInt(btn.getAttribute('data-tv-index'), 10);
    Array.prototype.forEach.call(tvTabsEl.querySelectorAll('.tv-tab'), function (t) {
      t.classList.remove('active');
    });
    btn.classList.add('active');
    tvContentEl.innerHTML = tvCategoryContents[index];
  });

  // Vista Tecnica es hija de Datos (se llega ahi desde adentro de ese
  // modulo), no del hub - por eso vuelve a 'datos', no a 'main' como los
  // 4 modulos principales.
  document.getElementById('btn-tv-volver').addEventListener('click', function () {
    showScreen('datos');
  });

  // --- Modulo Ubicacion --------------------------------------------------
  // Nombres de estado explicitos: una coordenada nunca se llama
  // "confiable" solo por ser la unica disponible (decision explicita del
  // usuario - puede ser la unica y estar mal). "corroborada" es la unica
  // etiqueta que implica 2+ fuentes de acuerdo.
  var UBICACION_ESTADO_LABEL = {
    corroborada: 'Ubicación confirmada',
    unica: 'Ubicación disponible'
  };
  // "Irrigación" (no "Provincia"): la capa coordProvincia sale de un
  // archivo llamado pozos_provincia (cubre pozos de toda la provincia),
  // pero las coordenadas en si son las que releva el Departamento
  // General de Irrigacion - decision explicita del usuario de no llamar
  // "provincia" a la fuente en la UI.
  var FUENTE_LABEL = {
    reportePozos: 'Reporte Pozos',
    coordProvincia: 'Irrigación'
  };

  function formatXY(c) {
    return 'x ' + c.x + ' / y ' + c.y;
  }

  function buildFuentesUbicacion(ubicacion) {
    var fuentes = [];
    if (ubicacion.coordenadas) {
      fuentes.push({ etiqueta: FUENTE_LABEL.reportePozos, c: ubicacion.coordenadas });
    }
    var provincia = ubicacion.coordenadasProvincia || [];
    provincia.forEach(function (c, i) {
      var etiqueta = FUENTE_LABEL.coordProvincia + (provincia.length > 1 ? ' (' + (i + 1) + ')' : '');
      fuentes.push({ etiqueta: etiqueta, c: c });
    });
    return fuentes;
  }

  // location: respuesta plana de getWellLocation - {wellId, coordenadas,
  // coordenadasProvincia, ubicacionResuelta}. Independiente del registro
  // de Datos (puede haber Ubicacion sin permiso "datos").
  function renderUbicacion(location) {
    var resuelta = location.ubicacionResuelta || { estado: 'sinCoordenadas' };

    var html = '<div class="modulo-id-line"><span class="modulo-id mono">' + escapeHtml(location.wellId) + '</span></div>';
    html += '<p class="modulo-subline">Ubicación</p>';

    html += '<div class="ubic-row">';
    if (resuelta.estado === 'corroborada' || resuelta.estado === 'unica') {
      html += '<span class="pin pin-ok">' + ICON_UBICACION + '</span>';
      html += '<div class="ubic-text"><strong>' + UBICACION_ESTADO_LABEL[resuelta.estado] + '</strong>';
      if (resuelta.estado === 'corroborada') {
        html += '2 o más fuentes independientes coinciden a ' + resuelta.distanciaCorroboracion + ' m entre sí.';
      } else {
        html += 'Fuente: ' + escapeHtml(FUENTE_LABEL[resuelta.fuente] || resuelta.fuente) + ' · sin corroborar por otra fuente.';
      }
      html += '<div class="coord-mono">' + resuelta.lat + ', ' + resuelta.lon + '<br>' + formatXY(resuelta) + '</div>';
      html += '<a class="maps-btn" href="https://www.google.com/maps?q=' + resuelta.lat + ',' + resuelta.lon + '" target="_blank" rel="noopener">' + ICON_MAPS + 'Abrir en Google Maps</a>';
      html += '</div>';
    } else {
      html += '<span class="pin pin-warn">' + ICON_UBICACION_WARN + '</span>';
      html += '<div class="ubic-text"><strong>Ubicación a revisar</strong>';
      html += 'Hay coordenadas de distintas fuentes que no coinciden entre sí. Un técnico debe revisarlas antes de habilitar el mapa.';
      html += '</div>';
    }
    html += '</div>';

    var fuentes = buildFuentesUbicacion(location);
    if (fuentes.length > 1) {
      html += '<p class="field-label">Fuentes (detalle técnico)</p><div class="src-list">';
      fuentes.forEach(function (f) {
        html += '<div class="src-item"><div class="src-tag">' + escapeHtml(f.etiqueta) + '</div><div class="src-xy mono">' + formatXY(f.c) + '</div></div>';
      });
      html += '</div>';
    }

    ubicacionContent.innerHTML = html;
  }

  // --- Modulo Niveles Estaticos --------------------------------------------
  function formatMetros(valor) {
    if (valor === null || valor === undefined) {
      return '';
    }
    return (valor > 0 ? '+' : '') + valor + ' m';
  }

  function formatFechaDMY(iso) {
    return iso ? iso.split('-').reverse().join('/') : null;
  }

  function surgenteTag(surgente) {
    return surgente
      ? '<span class="surg-tag surg-si">surgente</span>'
      : '<span class="surg-tag surg-no">bajo superficie</span>';
  }

  // Une historico (anual, hasta 2025) + campana2026 (por visita) en una
  // sola serie cronologica para el grafico - las dos fuentes se guardan
  // separadas en el modelo (son estructuralmente distintas, ver
  // scripts/reindex_niveles_estaticos.py) pero el grafico las muestra
  // como una continuidad. Corta la linea en cada cruce de signo para
  // poder pintar el tramo surgente (arriba de 0) distinto del tramo bajo
  // superficie - ambos son reales y pueden convivir en el mismo pozo a
  // lo largo del tiempo (confirmado con datos reales).
  function buildNivelesChart(historico, campana2026) {
    var puntos = (historico || []).map(function (m) {
      return { anio: m.anio, nivel: m.nivel };
    });
    (campana2026 || []).forEach(function (m) {
      if (m.fecha) {
        puntos.push({ anio: parseInt(m.fecha.slice(0, 4), 10), nivel: m.nivel });
      }
    });
    if (puntos.length < 2) {
      return null;
    }
    puntos.sort(function (a, b) { return a.anio - b.anio; });

    var w = 600, h = 150, padTop = 14, padBottom = 14, padX = 6;
    var anioMin = puntos[0].anio, anioMax = puntos[puntos.length - 1].anio;
    var anioRango = (anioMax - anioMin) || 1;
    var niveles = puntos.map(function (p) { return p.nivel; });
    var vMin = Math.min.apply(null, niveles);
    var vMax = Math.max.apply(null, niveles);
    var vRango = (vMax - vMin) || 1;

    function X(anio) { return padX + (anio - anioMin) / anioRango * (w - 2 * padX); }
    function Y(val) { return padTop + (1 - (val - vMin) / vRango) * (h - padTop - padBottom); }

    var coords = puntos.map(function (p) { return { x: X(p.anio), y: Y(p.nivel), nivel: p.nivel }; });
    var zeroY = (vMin < 0 && vMax > 0) ? Y(0) : null;

    var segmentos = [];
    var actual = [coords[0]];
    var signoActual = coords[0].nivel > 0;
    for (var i = 1; i < coords.length; i++) {
      var signo = coords[i].nivel > 0;
      if (signo !== signoActual) {
        actual.push(coords[i]);
        segmentos.push({ surgente: signoActual, puntos: actual });
        actual = [coords[i]];
        signoActual = signo;
      } else {
        actual.push(coords[i]);
      }
    }
    segmentos.push({ surgente: signoActual, puntos: actual });

    return { segmentos: segmentos, zeroY: zeroY, anioMin: anioMin, anioMax: anioMax, w: w, h: h };
  }

  function renderNivelesChartSvg(chart) {
    var html = '<svg viewBox="0 0 ' + chart.w + ' ' + chart.h + '" width="100%" height="86" preserveAspectRatio="none">';
    if (chart.zeroY !== null) {
      html += '<line x1="6" y1="' + chart.zeroY.toFixed(1) + '" x2="' + (chart.w - 6) + '" y2="' + chart.zeroY.toFixed(1) + '" stroke="#97a5ac" stroke-width="1" stroke-dasharray="3 3"/>';
    }
    chart.segmentos.forEach(function (seg) {
      var color = seg.surgente ? '#b8632f' : '#0b5a7a';
      var pts = seg.puntos.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');
      html += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>';
    });
    html += '</svg>';
    return html;
  }

  function renderNE(punto) {
    var html = '<div class="modulo-id-line"><span class="modulo-id mono">' + escapeHtml(punto.monitoringId) + '</span></div>';
    html += '<p class="modulo-subline">Niveles Estáticos' + (punto.nombreOriginal ? ' · ' + escapeHtml(punto.nombreOriginal) : '') + '</p>';

    if (punto.ultimaMedicion) {
      var um = punto.ultimaMedicion;
      html += '<div class="ne-last">Última medición ';
      var fechaTexto = formatFechaDMY(um.fecha);
      if (fechaTexto) {
        html += '<b>' + escapeHtml(fechaTexto) + '</b> · ';
      }
      html += '<b>' + formatMetros(um.nivel) + '</b>';
      if (um.persona) {
        html += ' · ' + escapeHtml(um.persona);
      }
      html += '</div>';
    }

    var chart = buildNivelesChart(punto.historico, punto.campana2026);
    if (chart) {
      html += '<div class="spark-wrap">' + renderNivelesChartSvg(chart) + '</div>';
      html += '<div class="spark-axis"><span>' + chart.anioMin + '</span><span>nivel del suelo</span><span>' + chart.anioMax + '</span></div>';
    }

    if (punto.estadisticas) {
      var e = punto.estadisticas;
      html += '<div class="stat-grid">';
      html += '<div class="stat"><div class="k">Nivel más profundo</div><div class="v down">' + formatMetros(e.nivelMasProfundo.valor) + ' <span class="v-anio">· ' + e.nivelMasProfundo.anio + '</span></div></div>';
      html += '<div class="stat"><div class="k">Nivel más alto</div><div class="v up">' + formatMetros(e.nivelMasAlto.valor) + ' <span class="v-anio">· ' + e.nivelMasAlto.anio + '</span></div></div>';
      html += '<div class="stat"><div class="k">Media</div><div class="v">' + formatMetros(e.media) + '</div></div>';
      html += '<div class="stat"><div class="k">Mediciones</div><div class="v">' + e.cantidadMediciones + '</div></div>';
      html += '</div>';
    }

    var filas = (punto.historico || []).map(function (m) {
      return '<tr><td>' + m.anio + '</td><td>' + formatMetros(m.nivel) + '</td><td>' + surgenteTag(m.surgente) + '</td></tr>';
    }).join('');
    filas += (punto.campana2026 || []).map(function (m) {
      var fechaTexto = formatFechaDMY(m.fecha) || 'campaña 2026';
      return '<tr><td class="mono" style="font-size:.72rem">' + escapeHtml(fechaTexto) + '</td><td>' + formatMetros(m.nivel) + '</td><td>' + surgenteTag(m.surgente) + '</td></tr>';
    }).join('');
    if (filas) {
      html += '<p class="field-label">Histórico + campaña 2026</p>';
      html += '<div class="ne-table-wrap"><table class="ne-table"><thead><tr><th>Año</th><th>Nivel</th><th></th></tr></thead><tbody>' + filas + '</tbody></table></div>';
    }

    if (punto.coordenadas) {
      html += '<hr class="divider">';
      html += '<p class="field-label">Ubicación del pozo de monitoreo</p>';
      html += '<div class="ubic-row"><span class="pin pin-ok">' + ICON_UBICACION + '</span>';
      html += '<div class="ubic-text"><strong>Ubicación disponible</strong>';
      html += 'Coordenada propia del pozo de monitoreo (independiente de la del padrón), sin corroborar.';
      html += '<div class="coord-mono">' + punto.coordenadas.lat + ', ' + punto.coordenadas.lon + '</div>';
      html += '<a class="maps-btn" href="https://www.google.com/maps?q=' + punto.coordenadas.lat + ',' + punto.coordenadas.lon + '" target="_blank" rel="noopener">' + ICON_MAPS + 'Abrir pozo en Google Maps</a>';
      html += '</div></div>';
    }

    neContent.innerHTML = html;
  }

  // --- Login ---
  var loginErrorEl = document.getElementById('login-error');

  function handleCredentialResponse(response) {
    loginErrorEl.hidden = true;
    apiLogin(response.credential).then(function (result) {
      if (result.status === 'ok') {
        sessionToken = result.data.sessionToken;
        currentEmail = result.data.email;
        permisosActuales = result.data.permisos || permisosActuales;
        localStorage.setItem('sessionToken', sessionToken);
        enterMain();
      } else if (result.code === 'USER_DISABLED') {
        showScreen('disabled');
      } else {
        loginErrorEl.textContent = getErrorMessage(result.code);
        loginErrorEl.hidden = false;
      }
    }).catch(function () {
      loginErrorEl.textContent = networkAwareMessage();
      loginErrorEl.hidden = false;
    });
  }

  function enterMain() {
    document.getElementById('user-email').textContent = currentEmail;
    pozoActual = null;
    renderHubIdle();
    loadRegistryMetadataOnce();
    showScreen('main');
  }

  function logout() {
    localStorage.removeItem('sessionToken');
    sessionToken = null;
    currentEmail = null;
    permisosActuales = { perfil: false, datos: false, ubicacion: false, ne: false };
    if (gsiLoaded) {
      // Sin esto, auto_select podria volver a loguear silenciosamente a
      // la misma cuenta apenas se re-inicialice el boton de Google.
      google.accounts.id.disableAutoSelect();
    }
    goToLogin();
  }

  document.getElementById('btn-logout').addEventListener('click', logout);
  document.getElementById('btn-logout-disabled').addEventListener('click', logout);

  // --- Busqueda ---
  var form = document.getElementById('search-form');
  var input = document.getElementById('input-well-id');
  var inputError = document.getElementById('input-error');
  var btnClear = document.getElementById('btn-clear-well-id');

  function updateClearButtonVisibility() {
    btnClear.hidden = input.value.length === 0;
  }

  // Enmascarado en vivo: solo digitos, guion automatico despues del
  // segundo digito, maximo 6 digitos reales. Preserva la posicion logica
  // del cursor (contando digitos, no caracteres) para que backspace en
  // cualquier punto del valor se sienta natural, no solo al final.
  // El pegado usa la normalizacion completa (acepta guion, espacios,
  // etc.) en vez del enmascarado simple, para que pegar "3-123" funcione.
  input.addEventListener('input', function () {
    var cursorPos = input.selectionStart;
    var digitsBeforeCursor = countDigitsBefore(input.value, cursorPos);
    var formatted = formatWellIdInput(input.value);
    input.value = formatted;
    var newPos = positionAfterNDigits(formatted, digitsBeforeCursor);
    input.setSelectionRange(newPos, newPos);
    updateClearButtonVisibility();
  });

  input.addEventListener('paste', function (event) {
    event.preventDefault();
    var pasted = (event.clipboardData || window.clipboardData).getData('text');
    var normalizado = normalizeWellId(pasted);
    input.value = isValidWellId(normalizado) ? normalizado : formatWellIdInput(pasted);
    updateClearButtonVisibility();
  });

  btnClear.addEventListener('click', function () {
    input.value = '';
    updateClearButtonVisibility();
    inputError.hidden = true;
    input.focus();
  });

  // Cada fetch normaliza sus propios errores de red a una forma
  // consistente con las respuestas del backend, para que Promise.all
  // nunca rechace por una falla de conectividad - un modulo que no se
  // pudo consultar simplemente no aparece, igual que uno que respondio
  // "no encontrado".
  function fetchSinRechazo(promise) {
    return promise.catch(function () {
      return { status: 'error', code: 'SERVICE_UNAVAILABLE' };
    });
  }

  // Si permisosActuales ya dice que el modulo esta vedado, ni se dispara
  // el fetch - resuelve directo a PERMISSION_DENIED (ahorra un viaje a
  // Apps Script). Esto es una optimizacion de red, no el limite de
  // seguridad: si por una condicion de carrera (permiso revocado en
  // Sheets despues del ultimo login/checkSession, dentro de la ventana
  // de cache de 5 min del backend) el permiso local estuviera
  // desactualizado "de mas", el backend igual lo habria rechazado.
  function fetchSiTienePermiso(permitido, promiseFactory) {
    if (!permitido) {
      return Promise.resolve({ status: 'error', code: 'PERMISSION_DENIED' });
    }
    return fetchSinRechazo(promiseFactory());
  }

  function buscarPozo(wellId) {
    pozoActual = {
      wellId: wellId,
      itf: { found: false },
      registro: { found: false },
      ubicacion: { found: false },
      ne: { found: false }
    };
    renderHubSearching(wellId);

    var pItf = fetchSiTienePermiso(permisosActuales.perfil, function () { return apiGetProfile(sessionToken, wellId); });
    var pRegistro = fetchSiTienePermiso(permisosActuales.datos, function () { return apiGetWellRecord(sessionToken, wellId); });
    var pUbicacion = fetchSiTienePermiso(permisosActuales.ubicacion, function () { return apiGetWellLocation(sessionToken, wellId); });
    var pNe = fetchSiTienePermiso(permisosActuales.ne, function () { return apiGetMonitoringPoint(sessionToken, wellId); });

    Promise.all([pItf, pRegistro, pUbicacion, pNe]).then(function (results) {
      // Esta busqueda puede haber quedado obsoleta si el usuario ya
      // disparo otra mientras esta seguia en vuelo.
      if (!pozoActual || pozoActual.wellId !== wellId) {
        return;
      }
      var itfResult = results[0], registroResult = results[1], ubicacionResult = results[2], neResult = results[3];

      if (itfResult.code === 'USER_DISABLED' || registroResult.code === 'USER_DISABLED' || ubicacionResult.code === 'USER_DISABLED' || neResult.code === 'USER_DISABLED') {
        showScreen('disabled');
        return;
      }
      if (itfResult.code === 'UNAUTHORIZED' || registroResult.code === 'UNAUTHORIZED' || ubicacionResult.code === 'UNAUTHORIZED' || neResult.code === 'UNAUTHORIZED') {
        logout();
        return;
      }

      // Cada slot conserva el "code" real ademas de found - un modulo sin
      // permiso se comporta igual que uno inexistente en el hub (no
      // aparece), pero PERMISSION_DENIED y *_NOT_FOUND nunca se
      // colapsan al mismo valor: el code sigue disponible para quien lo
      // necesite mas adelante (diagnostico, futura UX distinta, etc.).
      pozoActual.itf = itfResult.status === 'ok' ? { found: true, data: itfResult.data } : { found: false, code: itfResult.code };
      pozoActual.registro = registroResult.status === 'ok' ? { found: true, data: registroResult.data } : { found: false, code: registroResult.code };
      pozoActual.ubicacion = ubicacionResult.status === 'ok' ? { found: true, data: ubicacionResult.data } : { found: false, code: ubicacionResult.code };
      pozoActual.ne = neResult.status === 'ok' ? { found: true, data: neResult.data } : { found: false, code: neResult.code };

      renderHubResultado(pozoActual);

      // Un solo aviso de Telegram por busqueda, disparado aca (no desde
      // cada fetch individual de arriba). Fire-and-forget: no bloquea el
      // render ya hecho, y un error de red acá no debe mostrarse - el
      // backend ya audita en Historial si Telegram mismo falla.
      apiNotifyWellSearch(sessionToken, wellId, {
        perfil: pozoActual.itf.found,
        datos: pozoActual.registro.found,
        ubicacion: pozoActual.ubicacion.found,
        ne: pozoActual.ne.found
      }).catch(function () {});
    }).catch(function () {
      renderHubError(networkAwareMessage());
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    inputError.hidden = true;

    var normalized = normalizeWellId(input.value);
    var wellIdError = getWellIdError(normalized);
    if (wellIdError) {
      inputError.textContent = getErrorMessage('INVALID_WELL_ID_' + wellIdError);
      inputError.hidden = false;
      return;
    }
    input.value = normalized;

    buscarPozo(normalized);
  });

  // --- Recuperacion de sesion al cargar ---
  // Chequea navigator.onLine ANTES de intentar checkSession o Google: si
  // no hay conexion, no tiene sentido pedirle nada a Apps Script ni a
  // Google, y el usuario debe ver un aviso claro, no un login roto sin
  // explicacion.
  function init() {
    if (!navigator.onLine) {
      showScreen('offline');
      return;
    }

    var stored = localStorage.getItem('sessionToken');
    if (!stored) {
      goToLogin();
      return;
    }

    apiCheckSession(stored).then(function (result) {
      if (result.status === 'ok') {
        // Renovacion rolling/sliding: el backend reemite un sessionToken
        // nuevo en cada checkSession exitoso (otros 30 dias). Se
        // reemplaza el guardado en localStorage sin que el usuario haga
        // nada; si por algun motivo no viniera, se conserva el actual.
        sessionToken = result.data.sessionToken || stored;
        localStorage.setItem('sessionToken', sessionToken);
        currentEmail = result.data.email;
        // checkSession corre en cada apertura de la app (no en cada
        // busqueda) - es el punto donde una sesion ya abierta hace mucho
        // recoge un cambio de permisos hecho en la hoja "Usuarios",
        // ademas del cache de 5 min del lado del backend.
        permisosActuales = result.data.permisos || permisosActuales;
        enterMain();
      } else if (result.code === 'USER_DISABLED') {
        showScreen('disabled');
      } else {
        localStorage.removeItem('sessionToken');
        goToLogin();
      }
    }).catch(function () {
      // checkSession fallo por red (offline real o servicio caido) - se
      // reusa la misma pantalla, con el mensaje que corresponda.
      document.getElementById('offline-message').textContent = networkAwareMessage();
      showScreen('offline');
    });
  }

  document.getElementById('btn-retry-offline').addEventListener('click', init);

  // Si vuelve la conexion mientras se esta mostrando la pantalla de sin
  // conexion, reintenta el arranque solo, sin que el usuario tenga que
  // tocar nada.
  window.addEventListener('online', function () {
    if (!screens.offline.hidden) {
      init();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  init();
})();
