// E10-2: cableado de Administracion -> Usuarios: la tarjeta del hub (solo con usuarios_admin), la pantalla en index.html, los scripts en el shell del Service Worker, los wrappers de api.js (nunca mandan actor ni
// campos extra), el cierre de sesion y el CSS responsive. Pruebas sobre el texto de los archivos reales (index.html, app.js, api.js, styles.css, sw.js).
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const html = leer('index.html');
const app = leer('js', 'app.js');
const api = leer('js', 'api.js');
const css = leer('css', 'styles.css');
const controlador = leer('js', 'usuariosAdmin.js');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('index.html: pantalla, tarjeta del hub y scripts', () => {
  test('la tarjeta del hub existe, oculta por defecto (solo se muestra con usuarios_admin) y no carga nada', () => {
    const m = /<button[^>]*id="btn-abrir-usuarios-admin"[^>]*>/.exec(html);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/\shidden(\s|>)/);
    expect(html).toContain('Usuarios y permisos');
  });

  test('la pantalla existe, oculta por defecto, con boton Volver, estado "deshabilitada" y estado "sin acceso"', () => {
    const m = /<div id="screen-usuarios-admin"[^>]*>/.exec(html);
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/\shidden(\s|>)/);
    ['btn-uadm-volver', 'uadm-deshabilitada', 'uadm-sin-permiso', 'uadm-contenido', 'uadm-lista', 'uadm-permisos', 'uadm-overlay', 'btn-uadm-nuevo', 'btn-uadm-desactivar', 'btn-uadm-reactivar'].forEach((id) => {
      expect(html).toContain('id="' + id + '"');
    });
    expect(html).toContain('Administración temporalmente deshabilitada');
  });

  test('el estado "deshabilitada" y el contenido son bloques DISTINTOS: el editor, el listado y "Nuevo usuario" viven en uadm-contenido (oculto con el flag apagado)', () => {
    const contenido = html.slice(html.indexOf('id="uadm-contenido"'), html.indexOf('id="uadm-overlay"'));
    ['btn-uadm-nuevo', 'uadm-lista', 'uadm-form', 'btn-uadm-guardar', 'btn-uadm-desactivar'].forEach((id) => expect(contenido).toContain('id="' + id + '"'));
    const deshabilitada = html.slice(html.indexOf('id="uadm-deshabilitada"'), html.indexOf('id="uadm-sin-permiso"'));
    expect(deshabilitada).not.toMatch(/<input|<select|<textarea|btn-uadm-guardar|btn-uadm-nuevo/);
  });

  test('cada id que usa el controlador existe en index.html (el DOM real no puede devolver null)', () => {
    const ids = Array.from(controlador.matchAll(/\$\('([^']+)'\)/g)).map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(40);
    ids.forEach((id) => expect({ id, existe: html.indexOf('id="' + id + '"') >= 0 }).toEqual({ id, existe: true }));
  });

  test('scripts: logica y controlador ANTES de app.js, y la logica antes del controlador', () => {
    const l = html.indexOf('<script src="js/usuariosAdminLogic.js">');
    const c = html.indexOf('<script src="js/usuariosAdmin.js">');
    const a = html.indexOf('<script src="js/app.js">');
    expect(l).toBeGreaterThan(0);
    expect(l).toBeLessThan(c);
    expect(c).toBeLessThan(a);
  });

  test('los scripts forman parte del precache del Service Worker', () => {
    const { SHELL_FILES } = require('../sw');
    expect(SHELL_FILES).toContain('./js/usuariosAdminLogic.js');
    expect(SHELL_FILES).toContain('./js/usuariosAdmin.js');
    expect(SHELL_FILES.indexOf('./js/usuariosAdminLogic.js')).toBeLessThan(SHELL_FILES.indexOf('./js/usuariosAdmin.js'));
    expect(SHELL_FILES.indexOf('./js/usuariosAdmin.js')).toBeLessThan(SHELL_FILES.indexOf('./js/app.js'));
  });

  test('la pantalla no usa HTML inline con datos ni scripts inline nuevos', () => {
    const pantalla = html.slice(html.indexOf('id="screen-usuarios-admin"'), html.indexOf('<!-- Visor de un documento ITF (E9-6)'));
    expect(pantalla).not.toMatch(/<script|onclick=|onchange=|oninput=/i);
  });
});

describe('app.js: navegacion y permisos', () => {
  const codigo = sinComentarios(app);

  test('la pantalla esta en el mapa de pantallas y se abre con showScreen("usuariosAdmin")', () => {
    expect(codigo).toContain("usuariosAdmin: document.getElementById('screen-usuarios-admin')");
    expect(codigo).toContain("showScreen('usuariosAdmin')");
  });

  test('la tarjeta se muestra SOLO segun usuariosAdminLogic_puedeVer(permisosActuales) (usuarios_admin === true), dentro de toggleAccesosUbicacion', () => {
    const toggle = codigo.slice(codigo.indexOf('function toggleAccesosUbicacion()'), codigo.indexOf('function enterMain()'));
    expect(toggle).toContain("document.getElementById('btn-abrir-usuarios-admin').hidden = !usuariosAdminLogic_puedeVer(permisosActuales)");
  });

  test('el clic re-comprueba el permiso (si se perdio, no se abre ni se pide nada) y abre el controlador', () => {
    const i = codigo.indexOf("document.getElementById('btn-abrir-usuarios-admin').addEventListener('click'");
    const bloque = codigo.slice(i, i + 700);
    expect(bloque).toMatch(/if \(!usuariosAdminLogic_puedeVer\(permisosActuales\)\) \{\s*toggleAccesosUbicacion\(\);[^\n]*\n\s*return;/);
    expect(bloque).toContain('usuariosAdminController_abrir()');
    expect(bloque).toContain("showScreen('usuariosAdmin')");
  });

  test('Volver cierra el controlador y regresa a la pantalla de origen', () => {
    const i = codigo.indexOf("document.getElementById('btn-uadm-volver').addEventListener('click'");
    const bloque = codigo.slice(i, i + 250);
    expect(bloque).toContain('usuariosAdminController_cerrar()');
    expect(bloque).toContain('restaurarPantalla(usuariosAdminOrigen)');
  });

  test('el controlador recibe sesion y permisos frescos, y una sesion vencida cierra la sesion', () => {
    const i = codigo.indexOf('usuariosAdminController_inicializar(');
    const bloque = codigo.slice(i, i + 450);
    expect(bloque).toContain('sessionToken: sessionToken');
    expect(bloque).toContain('permisos: permisosActuales');
    expect(bloque).toMatch(/onSessionExpired: function \(\) \{\s*logout\(\);/);
  });

  test('el cierre de sesion resetea la pantalla (listas, detalle, dialogos y lo que este en vuelo)', () => {
    const logout = codigo.slice(codigo.indexOf('function logout()'), codigo.indexOf('function logout()') + 2600);
    expect(logout).toContain('usuariosAdminController_reset()');
  });

  test('app.js solo habla de este modulo por su logica y su controlador: nunca nombra usuarios_admin ni arma pedidos administrativos', () => {
    expect(codigo).not.toMatch(/usuarios_admin/);
    expect(codigo).not.toMatch(/apiAdmin\w+\(/);
  });
});

describe('api.js: wrappers (el cliente nunca manda actor, ejecutor ni campos desconocidos)', () => {
  const bloque = api.slice(api.indexOf('// --- Administracion de usuarios (E10-2)'));
  const codigoApi = sinComentarios(bloque);

  test.each([
    ['apiAdminUsuariosListar', 'adminUsuariosListar'],
    ['apiAdminPermisosCatalogo', 'adminPermisosCatalogo'],
    ['apiAdminUsuarioObtener', 'adminUsuarioObtener'],
    ['apiAdminUsuarioCrear', 'adminUsuarioCrear'],
    ['apiAdminUsuarioActualizar', 'adminUsuarioActualizar'],
    ['apiAdminUsuarioDesactivar', 'adminUsuarioDesactivar'],
    ['apiAdminUsuarioReactivar', 'adminUsuarioReactivar']
  ])('%s llama a la accion %s', (fn, accion) => {
    expect(codigoApi).toContain('function ' + fn + '(');
    expect(codigoApi).toContain("callBackend('" + accion + "'");
  });

  test('exactamente siete wrappers administrativos', () => {
    expect(codigoApi.match(/function apiAdmin\w+\(/g)).toHaveLength(7);
  });

  test('los campos que se copian son SOLO los de la lista blanca del backend (sin actor, ejecutor, estado, version ni fila)', () => {
    const campos = Array.from(codigoApi.matchAll(/\['([^\]]*)'\]\)\)/g)).map((m) => m[1].split("', '"));
    expect(campos.length).toBe(4);
    campos.forEach((lista) => {
      lista.forEach((c) => expect(['email', 'nombre', 'tipo', 'permisos', 'motivo', 'clientRequestId', 'versionEsperada', 'etag']).toContain(c));
    });
    expect(codigoApi).not.toMatch(/actor|ejecutad|nuevoEmail|emailNuevo|estado:|fila/);
  });

  test('el cuerpo de un wrapper descarta cualquier campo que el controlador intente agregar', () => {
    const vm = require('vm');
    const llamadas = [];
    const ctx = vm.createContext({ callBackend: (accion, cuerpo) => { llamadas.push({ accion, cuerpo }); return Promise.resolve({}); } });
    vm.runInContext(bloque, ctx);
    ctx.apiAdminUsuarioActualizar('tok', { email: 'a@x.com', versionEsperada: 1, etag: 'e', nombre: 'N', clientRequestId: 'c', actor: 'otro@x.com', ejecutadoPor: 'x', estado: 'inactivo', nuevoEmail: 'z@x.com' });
    expect(llamadas[0].accion).toBe('adminUsuarioActualizar');
    expect(Object.keys(llamadas[0].cuerpo).sort()).toEqual(['clientRequestId', 'email', 'etag', 'nombre', 'sessionToken', 'versionEsperada']);
    ctx.apiAdminUsuarioObtener('tok', 'a@x.com', 40);
    expect(llamadas[1].cuerpo).toEqual({ sessionToken: 'tok', email: 'a@x.com', limiteEventos: 40 });
    ctx.apiAdminUsuarioObtener('tok', 'a@x.com');
    expect(llamadas[2].cuerpo).toEqual({ sessionToken: 'tok', email: 'a@x.com' });
    ctx.apiAdminUsuariosListar('tok');
    expect(llamadas[3].cuerpo).toEqual({ sessionToken: 'tok' });
  });
});

describe('CSS: responsive y propio', () => {
  const desde = css.indexOf('/* ===== Administracion -> Usuarios (E10-2) =====');
  const hasta = css.indexOf('/* --- ITF colaborativos (E9-6)');
  const bloque = css.slice(desde, hasta);

  test('el bloque existe y todos sus selectores son .uadm-* (mas .button-primary compartido)', () => {
    expect(desde).toBeGreaterThan(0);
    expect(hasta).toBeGreaterThan(desde);
    const selectores = Array.from(bloque.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{/g)).map((m) => m[1].trim()).filter((s) => s && !/^\d+%?$/.test(s) && !/^(from|to)$/.test(s) && !/^media /.test(s));
    selectores.forEach((lista) => {
      lista.split(',').map((s) => s.trim()).forEach((s) => expect(s).toMatch(/^((input|select|textarea)\.uadm|\.uadm|#screen-usuarios-admin|\.button-primary|\.uadm-dlg \.button-secondary|\.uadm \.button-secondary)/));
    });
  });

  test('celular: tarjetas (sin tabla), una columna; pantalla ancha: grilla de dos columnas; sin scroll horizontal', () => {
    expect(bloque).toMatch(/\.uadm-columnas\.uadm-doble\s*\{[^}]*display:\s*grid/);
    expect(bloque).toMatch(/grid-template-columns:\s*minmax\(300px, 400px\) minmax\(0, 1fr\)/);
    expect(bloque).not.toMatch(/<table|white-space:\s*nowrap|min-width:\s*[1-9]\d{3}px/);
    expect(html.slice(html.indexOf('id="screen-usuarios-admin"'), html.indexOf('<!-- Visor de un documento ITF (E9-6)'))).not.toMatch(/<table/);
    expect(bloque).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('objetivos tactiles de al menos 44 px y foco visible', () => {
    expect(bloque).toMatch(/\.uadm-card\s*\{[^}]*min-height:\s*44px/);
    expect(bloque).toMatch(/\.uadm-input\s*\{[^}]*min-height:\s*44px/);
    expect(bloque).toMatch(/:focus-visible/);
    expect(bloque).toMatch(/\.uadm-permiso input\[type="checkbox"\]\s*\{[^}]*width:\s*22px/);
  });

  test('el layout lo decide la clase que pone el controlador (uadm-doble / uadm-simple), con el mismo umbral que la logica', () => {
    expect(controlador).toContain("'uadm-columnas ' + (doble ? 'uadm-doble' : 'uadm-simple')");
    expect(fs.readFileSync(path.join(__dirname, 'usuariosAdminLogic.js'), 'utf8')).toContain('USUARIOS_ADMIN_ANCHO_DOBLE = 900');
  });

  test('los dialogos son hoja inferior en celular y centrados en pantallas grandes', () => {
    expect(bloque).toMatch(/\.uadm-overlay\s*\{[^}]*align-items:\s*flex-end/);
    expect(bloque).toMatch(/@media \(min-width: 640px\)\s*\{\s*\.uadm-overlay\s*\{[^}]*align-items:\s*center/);
  });
});

describe('E10-2 no define politicas nuevas de externos ni de modulos', () => {
  test('los archivos de la pantalla no mencionan modulos funcionales (ITF, mapas, niveles, fotos...) para decidir nada', () => {
    const logica = sinComentarios(leer('js', 'usuariosAdminLogic.js'));
    const ctrl = sinComentarios(controlador);
    [logica, ctrl].forEach((t) => {
      expect(t).not.toMatch(/exportaci|cerca mio|mapaLogic|itfLogic|fotosModeracion/i);
    });
  });
});
