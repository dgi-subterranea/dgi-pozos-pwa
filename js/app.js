(function () {
  var GOOGLE_CLIENT_ID = '970817103867-q30tnqqqcc9lhtaamqplbs28nglcj7q3.apps.googleusercontent.com';

  var sessionToken = null;
  var currentEmail = null;

  var screens = {
    loading: document.getElementById('screen-loading'),
    login: document.getElementById('screen-login'),
    main: document.getElementById('screen-main'),
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

  window.onGsiLoaded = function () {
    gsiLoaded = true;
    tryInitGoogleSignIn();
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
  }

  function goToLogin() {
    shouldInitGoogleSignIn = true;
    tryInitGoogleSignIn();
    showScreen('login');
  }

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
        sessionToken = stored;
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
