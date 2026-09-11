(function () {
  var GOOGLE_CLIENT_ID = '970817103867-q30tnqqqcc9lhtaamqplbs28nglcj7q3.apps.googleusercontent.com';

  var sessionToken = null;
  var currentEmail = null;

  var screens = {
    loading: document.getElementById('screen-loading'),
    login: document.getElementById('screen-login'),
    main: document.getElementById('screen-main'),
    wellRecordTable: document.getElementById('screen-well-record-table'),
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

  // --- Area de resultado (dentro de screen-main, no se pierde el input) ---
  var resultArea = document.getElementById('result-area');

  function renderIdle() {
    var html = '<div class="idle-hint">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    html += '<span>Escribí el número de pozo para empezar</span>';
    html += '</div>';
    resultArea.innerHTML = html;
  }

  function renderSearching(wellId) {
    resultArea.innerHTML = '<p class="status">Buscando ' + wellId + '...</p>';
  }

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

  function renderFound(wellId, mimeType, imageBase64) {
    var dataUri = 'data:' + mimeType + ';base64,' + imageBase64;
    var html = '<p class="status success">Perfil encontrado</p>';
    html += '<img class="profile-image" src="' + dataUri + '" alt="Perfil del pozo ' + wellId + '" />';
    // Mismo texto e icono en todas las plataformas a proposito, aunque el
    // comportamiento real difiera: en iOS dispara el share sheet nativo
    // (ver handleSaveImageIOS), en el resto es una descarga directa.
    var saveIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4M5 21h14"/></svg>';
    if (isIOS()) {
      html += '<button type="button" id="btn-save-image" class="button">' + saveIcon + 'Guardar / Compartir</button>';
    } else {
      html += '<a class="button" href="' + dataUri + '" download="' + wellId + '.jpg">' + saveIcon + 'Guardar / Compartir</a>';
    }
    resultArea.innerHTML = html;

    if (isIOS()) {
      document.getElementById('btn-save-image').addEventListener('click', function () {
        handleSaveImageIOS(wellId, mimeType, imageBase64, dataUri);
      });
    }
  }

  function renderMessage(text) {
    resultArea.innerHTML = '<p class="status error">' + text + '</p>';
  }

  // Mismo caso (PROFILE_NOT_FOUND) que antes, solo cambia el marcado: una
  // tarjeta simple en vez de una linea de texto suelta.
  function renderNotFound(wellId) {
    var html = '<div class="empty-state">';
    html += '<div class="empty-state-icon"><svg viewBox="0 0 24 24" fill="none"><path d="M6 6L18 18M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></div>';
    html += '<p class="empty-state-title">No se encontró información</p>';
    html += '<p class="empty-state-text">para el pozo ' + wellId + '. Revisá el número e intentá de nuevo.</p>';
    html += '</div>';
    resultArea.innerHTML = html;
  }

  // --- Ficha del Pozo (padron/registro tecnico) ---
  // Capa completamente independiente del ITF: vive en #well-record-area,
  // fuera de #result-area, con su propio fetch (apiGetWellRecord) que se
  // dispara en paralelo al del ITF y nunca depende de su resultado ni lo
  // bloquea - ver el submit handler mas abajo.
  var wellRecordArea = document.getElementById('well-record-area');
  var registryMetadataPromise = null;

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

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

  function renderWellRecordIdle() {
    wellRecordArea.innerHTML = '';
  }

  function renderWellRecordNotFound(message) {
    var html = '<div class="ficha-empty-note">';
    html += '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16h.01"/></svg>';
    html += escapeHtml(message || 'Sin información registral cargada para este pozo.');
    html += '</div>';
    wellRecordArea.innerHTML = html;
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

  function renderWellRecordFound(record, metadata) {
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
    wellRecordArea.innerHTML = html;

    document.getElementById('btn-ver-tabla').addEventListener('click', function () {
      showWellRecordTable(record);
    });
  }

  // --- Vista Tecnica completa: pantalla propia (screen-well-record-table),
  // no un panel dentro de la Ficha del Pozo. Se arma a partir del MISMO
  // record ya cargado arriba - nunca dispara un fetch nuevo. Las 8
  // categorias se calculan una sola vez al abrir la vista; cambiar de
  // pestana solo reemplaza el HTML ya generado, no vuelve a construirlo.
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

  document.getElementById('btn-tv-volver').addEventListener('click', function () {
    showScreen('main');
  });

  // --- Login ---
  var loginErrorEl = document.getElementById('login-error');

  function handleCredentialResponse(response) {
    loginErrorEl.hidden = true;
    apiLogin(response.credential).then(function (result) {
      if (result.status === 'ok') {
        sessionToken = result.data.sessionToken;
        currentEmail = result.data.email;
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
    renderIdle();
    renderWellRecordIdle();
    loadRegistryMetadataOnce();
    showScreen('main');
  }

  function logout() {
    localStorage.removeItem('sessionToken');
    sessionToken = null;
    currentEmail = null;
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

    renderSearching(normalized);
    apiGetProfile(sessionToken, normalized).then(function (result) {
      if (result.status === 'ok') {
        renderFound(result.data.wellId, result.data.mimeType, result.data.imageBase64);
      } else if (result.code === 'USER_DISABLED') {
        showScreen('disabled');
      } else if (result.code === 'UNAUTHORIZED') {
        logout();
      } else if (result.code === 'PROFILE_NOT_FOUND') {
        renderNotFound(normalized);
      } else {
        renderMessage(getErrorMessage(result.code));
      }
    }).catch(function () {
      renderMessage(networkAwareMessage());
    });

    // Ficha del Pozo: fetch completamente aparte del ITF de arriba - ni
    // lo espera ni lo bloquea, y un error aca nunca toca resultArea.
    renderWellRecordIdle();
    apiGetWellRecord(sessionToken, normalized).then(function (result) {
      if (result.status === 'ok') {
        loadRegistryMetadataOnce().then(function (metadata) {
          renderWellRecordFound(result.data, metadata);
        });
      } else if (result.code === 'USER_DISABLED') {
        showScreen('disabled');
      } else if (result.code === 'UNAUTHORIZED') {
        logout();
      } else if (result.code === 'WELL_RECORD_NOT_FOUND') {
        renderWellRecordNotFound();
      } else {
        renderWellRecordNotFound('Sin información registral disponible en este momento.');
      }
    }).catch(function () {
      renderWellRecordNotFound('Sin información registral disponible en este momento.');
    });
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
