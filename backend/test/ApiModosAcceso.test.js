// E10-3: MODOS DE ACCESO. Cada accion de doPost declara su modo: 'sesion' (identidad verificada + usuario activo + permisos) o 'publico' (PUBLICO / ANONIMO: sin login, sin fila en Usuarios, sin permisos
// individuales; una politica publica global con su propia whitelist). HOY no hay ninguna accion publica: la capa publica se decide en E10-4 y se construye despues del hardening (E10-5).
//
// ARQUITECTURA: `tipo` (INTERNO | EXTERNO) describe UNICAMENTE a personas autenticadas. PUBLICO / ANONIMO no es un tipo de usuario: no existe en `Usuarios`, no usa getUserAccess ni hasPermission, no escribe en
// Historial / UsuariosEventos / Telegram. La capa publica nunca se deriva de lo que ve un EXTERNO.
//
// El test falla si: aparece una accion nueva SIN modo declarado; una accion de 'sesion' no alcanza ninguna compuerta de sesion; una accion 'publico' alcanza (directa o transitivamente) sesion, permisos,
// usuarios, auditoria de usuarios o Telegram. Es analisis estatico del codigo (grafo de llamadas), no una prueba de comportamiento.
const path = require('path');
const fs = require('fs');
const { auditar, accionesDePost, indexarFunciones, alcanzables, leerFuentesDeBackend, limpiar } = require('./accesoEstatico');

const raiz = path.join(__dirname, '..', '..');
const textoApi = fs.readFileSync(path.join(raiz, 'backend', 'src', 'Api.js'), 'utf8');
const fuentes = leerFuentesDeBackend(raiz);

// MODO DE ACCESO DE CADA ACCION (declaracion explicita: una accion nueva obliga a agregar su linea aca)
const MODO_DE_ACCESO = {
  login: 'sesion',
  checkSession: 'sesion',
  getProfile: 'sesion',
  getWellRecord: 'sesion',
  getMetadata: 'sesion',
  getMonitoringPoint: 'sesion',
  getWellLocation: 'sesion',
  registerWellSearch: 'sesion',
  getMapaPozos: 'sesion',
  getUbicacionesValidadas: 'sesion',
  getDecisionesFuentesDelta: 'sesion',
  getWellSummary: 'sesion',
  getMapaNE: 'sesion',
  getIndiceBusquedaProvincia: 'sesion',
  getItfAvailability: 'sesion',
  registerDescargaItf: 'sesion',
  proponerItf: 'sesion',
  getItfPendientes: 'sesion',
  getItfDocumentoModeracion: 'sesion',
  getHistorialItf: 'sesion',
  getMisPropuestasItf: 'sesion',
  aprobarItf: 'sesion',
  rechazarItf: 'sesion',
  retirarItf: 'sesion',
  revertirItf: 'sesion',
  retirarPropuestaItf: 'sesion',
  getEstadoReemplazo: 'sesion',
  getHistorialReemplazo: 'sesion',
  registrarEvaluacionReemplazo: 'sesion',
  getResumenReemplazoMapa: 'sesion',
  subirFotoReemplazo: 'sesion',
  getFotosReemplazo: 'sesion',
  getFotosReemplazoPozo: 'sesion',
  getFotoReemplazo: 'sesion',
  getFotosPozo: 'sesion',
  getFotoPozo: 'sesion',
  getResumenFotosPozos: 'sesion',
  subirFotoPozo: 'sesion',
  solicitarRetiroFotoPozo: 'sesion',
  retirarFotoPozo: 'sesion',
  resolverRetiroFotoPozo: 'sesion',
  reponerFotoPozo: 'sesion',
  getHistorialFotoPozo: 'sesion',
  getFotosPozosPendientesModeracion: 'sesion',
  getFotosPozosRetiradasModeracion: 'sesion',
  getFotoPozoModeracion: 'sesion',
  proponerCorreccionUbicacion: 'sesion',
  getCorreccionesUbicacionPozo: 'sesion',
  getCorreccionesUbicacionPendientes: 'sesion',
  validarCorreccionUbicacion: 'sesion',
  rechazarCorreccionUbicacion: 'sesion',
  revertirCorreccionUbicacion: 'sesion',
  getDecisionesFuentesPozo: 'sesion',
  decidirFuenteUbicacion: 'sesion',
  sugerirDecisionFuente: 'sesion',
  getSugerenciasFuentesPozo: 'sesion',
  getSugerenciasFuentesPendientes: 'sesion',
  resolverSugerenciaFuente: 'sesion',
  cancelarSugerenciaFuente: 'sesion',
  agregarObservacionPozo: 'sesion',
  anularObservacionPozo: 'sesion',
  getObservacionesPozo: 'sesion',
  adminUsuariosListar: 'sesion',
  adminPermisosCatalogo: 'sesion',
  adminUsuarioObtener: 'sesion',
  adminUsuarioCrear: 'sesion',
  adminUsuarioActualizar: 'sesion',
  adminUsuarioDesactivar: 'sesion',
  adminUsuarioReactivar: 'sesion'
};

describe('modos de acceso del backend real', () => {
  test('TODA accion de doPost tiene su modo declarado y no sobran declaraciones (accion nueva sin modo = falla)', () => {
    const acciones = accionesDePost(textoApi).map((a) => a.accion);
    expect(acciones.length).toBe(69);
    expect(acciones.filter((a) => MODO_DE_ACCESO[a] === undefined)).toEqual([]);
    expect(Object.keys(MODO_DE_ACCESO).filter((a) => acciones.indexOf(a) < 0)).toEqual([]);
  });

  test('los unicos modos validos son sesion y publico', () => {
    Object.keys(MODO_DE_ACCESO).forEach((a) => expect(['sesion', 'publico']).toContain(MODO_DE_ACCESO[a]));
  });

  test('HOY todas las acciones existentes son de sesion (no hay API publica; la capa publica es posterior a E10-5)', () => {
    expect(Object.keys(MODO_DE_ACCESO).filter((a) => MODO_DE_ACCESO[a] !== 'sesion')).toEqual([]);
  });

  test('auditoria completa: cada accion de sesion alcanza una compuerta de sesion y ninguna publica alcanza nada privado', () => {
    expect(auditar(fuentes, textoApi, MODO_DE_ACCESO)).toEqual([]);
  });

  test('doPost es el unico punto de entrada: no existe doGet', () => {
    const nombres = Object.keys(indexarFunciones(fuentes));
    expect(nombres.filter((f) => f === 'doGet')).toEqual([]);
    expect(nombres.filter((f) => f === 'doPost')).toEqual(['doPost']);
  });
});

describe('ningun handler de negocio decide por tipo (tipo solo describe personas autenticadas y solo limita usuarios_admin / autoridad)', () => {
  const NEGOCIO = /^(Api|Itf[A-Za-z]*|Fotos[A-Za-z]*|Observaciones[A-Za-z]*|Ubicacion[A-Za-z]*|Reemplazo[A-Za-z]*|Mapa[A-Za-z]*|Registry[A-Za-z]*|NivelesEstaticos[A-Za-z]*|Profile[A-Za-z]*|Pozo[A-Za-z]*|Notification[A-Za-z]*|Propuesta[A-Za-z]*)\.js$/;
  // para buscar literales se retiran solo los comentarios (limpiar() tambien blanquea las cadenas)
  const sinComentarios = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  test('ni Api.js ni los servicios de negocio comparan tipo con INTERNO o EXTERNO', () => {
    const conTipo = Object.keys(fuentes).filter((f) => NEGOCIO.test(f)).filter((f) => /'(INTERNO|EXTERNO)'|"(INTERNO|EXTERNO)"/.test(sinComentarios(fuentes[f])));
    expect(conTipo).toEqual([]);
  });

  test('PUBLICO / ANONIMO no es un tipo de usuario: el catalogo solo conoce INTERNO y EXTERNO y un tipo "PUBLICO" no se normaliza a nada valido', () => {
    const C = require('../src/PermisosCatalogo');
    const D = require('../src/UsuariosDominio');
    Object.assign(global, C);
    expect(C.PERMISOS_CATALOGO_TIPOS).toEqual(['INTERNO', 'EXTERNO']);
    ['PUBLICO', 'ANONIMO', 'publico', 'anonimo', 'PUBLICO/ANONIMO'].forEach((t) => {
      expect(C.permisosCatalogo_tipoValido(t)).toBe(false);
      expect(D.usuariosDominio_normalizarTipo(t)).toBe('');
    });
  });
});

describe('el analisis estatico detecta lo que tiene que detectar (fuentes sinteticas)', () => {
  const api = (acciones) => 'function doPost(e) {\n  var body = JSON.parse(e.postData.contents);\n' + acciones.map((a, i) => (i === 0 ? '  if' : '  else if') + " (body.action === '" + a[0] + "') {\n    response = " + a[1] + '(body);\n  }').join('\n') + '\n}\n';
  const audit = (src, acciones, modos) => auditar({ 'X.js': src }, api(acciones), modos);

  test('una accion nueva SIN modo declarado falla', () => {
    expect(audit('function h() { return 1; }', [['nueva', 'h']], {})).toEqual(['ACCION_SIN_MODO:nueva']);
  });

  test('una declaracion de una accion que no existe falla', () => {
    expect(audit('function h() { validateSession(1); }\nfunction validateSession() {}', [['a', 'h']], { a: 'sesion', fantasma: 'sesion' })).toEqual(['MODO_DE_ACCION_INEXISTENTE:fantasma']);
  });

  test('una accion de sesion SIN compuerta de sesion falla (no se puede etiquetar "sesion" algo abierto)', () => {
    expect(audit('function h() { return leer(); }\nfunction leer() { return 1; }', [['a', 'h']], { a: 'sesion' })).toEqual(['SESION_SIN_COMPUERTA:a']);
  });

  test.each([
    ['hasPermission directo', 'function h() { return hasPermission("x", "perfil"); }'],
    ['getUserAccess directo', 'function h() { var a = getUserAccess("x"); return a; }'],
    ['logHistoryEvent directo', 'function h() { logHistoryEvent("x", "accion", null, "OK"); }'],
    ['validateSession', 'function h() { return validateSession("t"); }'],
    ['validarPermiso', 'function h() { return validarPermiso(1, 2, 3, "perfil"); }'],
    ['isUserActive', 'function h() { return isUserActive("x"); }'],
    ['Telegram', 'function h() { telegramRepository_sendMessage("x"); }'],
    ['usuarios', 'function h() { return usuariosDominio_normalizarEmail("x"); }'],
    ['la hoja de usuarios', 'function h() { return sheetUserRepository_getUserStatus("x"); }'],
    ['auditoria de usuarios', 'function h() { usuariosEventosRepository_agregar(); }'],
    ['TRANSITIVO (helper -> helper -> permisos)', 'function h() { return a1(); }\nfunction a1() { return a2(); }\nfunction a2() { return hasPermission("x", "y"); }']
  ])('una accion PUBLICA que usa %s falla', (_n, src) => {
    const problemas = audit(src, [['p', 'h']], { p: 'publico' });
    expect(problemas.length).toBeGreaterThan(0);
    expect(problemas.every((x) => x.indexOf('PUBLICA_USA_PRIVADO:p:') === 0)).toBe(true);
  });

  test.each([
    'getUserAccess', 'hasPermission', 'isUserActive', 'validateSession', 'validateSessionAndWellId', 'validarPermiso', 'validarPermisosTodos', 'api_validarPermisosEstrictos', 'api_itfModEntrada',
    'usuariosAdminApi_puerta', 'logHistoryEvent', 'verifySessionToken', 'createSessionToken', 'signPayload', 'handleLogin', 'handleCheckSession', 'handleRegisterWellSearch',
    'authService_invalidarAcceso', 'sheetUserRepository_getUserStatus', 'sheetHistoryRepository_log', 'historyService_log', 'usuariosDominio_esAdminEfectivo', 'usuariosAdmin_crear', 'usuariosAdminLectura_listar',
    'usuariosAdminApi_ejecutar', 'usuariosEventosRepository_leer', 'searchHistoryService_registerSearch', 'sheetSearchHistoryRepository_logSearch', 'notificationService_notifyWellSearch',
    'telegramRepository_sendMessage', 'propuestaNotificacion_notificar'
  ])('CADA dependencia privada esta prohibida en lo publico: %s', (nombre) => {
    const problemas = audit('function h() { return ' + nombre + '(1); }', [['p', 'h']], { p: 'publico' });
    expect(problemas).toEqual(['PUBLICA_USA_PRIVADO:p:' + nombre]);
  });

  test('un nombre parecido que NO es privado no se confunde (p. ej. un helper llamado hasPermissionX)', () => {
    expect(audit('function h() { return hasPermissionX(1) + getUserAccessories(2) + usuariosdeprueba(3); }', [['p', 'h']], { p: 'publico' })).toEqual([]);
  });

  test('una accion publica LIMPIA (whitelist propia, sin sesion ni permisos) pasa', () => {
    const src = 'var PUBLICO_CAMPOS = ["wellId", "departamento"];\nfunction h(b) { return dto(b); }\nfunction dto(b) { var s = {}; PUBLICO_CAMPOS.forEach(function (c) { s[c] = b[c]; }); return s; }';
    expect(audit(src, [['p', 'h']], { p: 'publico' })).toEqual([]);
  });

  test('los nombres en comentarios y cadenas NO cuentan como llamadas (ni se pierde una llamada real por un apostrofe o una regex)', () => {
    const limpio = 'function h() {\n  // hasPermission(x) no se llama\n  var t = "getUserAccess(x)";\n  var r = /[\'"]hasPermission\\(/g;\n  return t.length + r.lastIndex;\n}';
    expect(audit(limpio, [['p', 'h']], { p: 'publico' })).toEqual([]);
    const conLlamada = 'function h() {\n  var r = /[\'"]x/g;\n  return hasPermission("a", "b");\n}';
    expect(audit(conLlamada, [['p', 'h']], { p: 'publico' }).length).toBe(1);
  });

  test('limpiar() conserva la longitud y blanquea comentarios, cadenas y regex', () => {
    const src = "var a = 'x//y'; // c\nvar b = /a\\/b/g; /* z */ f();";
    const l = limpiar(src);
    expect(l.length).toBe(src.length);
    expect(l).toContain('f()');
    expect(l).not.toContain('x//y');
  });

  test('alcanzables sigue el grafo completo, incluso funciones no definidas (APIs de Apps Script)', () => {
    const f = indexarFunciones({ 'X.js': 'function a() { b(); }\nfunction b() { CacheService.getScriptCache(); c(); }\nfunction c() { PropertiesService(); }' });
    expect(Array.from(alcanzables(f, 'a')).sort()).toEqual(['PropertiesService', 'a', 'b', 'c']);
  });
});
