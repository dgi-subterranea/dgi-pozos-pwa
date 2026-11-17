// E10-2: diagnostico MANUAL de coherencia de permisos (DiagnosticoPermisosE10.js). Modulos REALES (Auth, Api, UsuariosAdminApi, dominio, catalogo, flags, repositorio); Google y las hojas, en memoria.
// Lo central: (1) mide lo que el sistema INTERPRETA (celda cruda -> normalizado -> efectivo -> checkSession -> cache) y marca cada anomalia que puede dejar a un usuario con menos de lo que dice la hoja;
// (2) los gates administrativos con el flag APAGADO se prueban por doPost; (3) no escribe nada y no expone emails completos ni tokens.
const fs = require('fs');
const path = require('path');
const { crearEntornoE10, ADMIN1, ADMIN2, PERMISOS_DE_SIEMPRE, filaDe } = require('./e10Entorno');

let E;
let Api;
let D;
const TODOS = PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']);

function armar(opciones) {
  E = crearEntornoE10(opciones);
  ['UsuariosAdminLectura', 'UsuariosAdminApi'].forEach((m) => Object.assign(global, require('../src/' + m)));
  Api = require('../src/Api');
  global.validateSession = Api.validateSession;
  global.doPost = jest.fn(Api.doPost);          // en Apps Script doPost es una funcion global del proyecto
  global.logHistoryEvent = jest.fn();
  global.telegramRepository_sendMessage = jest.fn(() => ({ ok: true }));
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  D = require('../src/DiagnosticoPermisosE10');
}
const col = (nombre) => E.hojas.Usuarios.filas[0].indexOf(nombre);
const filaDeEmail = (email) => E.hojas.Usuarios.filas.findIndex((f, i) => i > 0 && String(f[col('email')]).trim().toLowerCase() === email);
const celda = (email, columna, valor) => { E.hojas.Usuarios.filas[filaDeEmail(email)][col(columna)] = valor; };
const informe = () => D.diagPerm_construir(D.diagPerm_depsReales());
const usuarioDe = (r, mascara) => r.usuarios.find((u) => u.email === mascara);

beforeEach(() => { armar(); });

describe('matriz de permisos: una hoja sana', () => {
  test('cada usuario activo: declarado = efectivo = checkSession, sin anomalias; 17 claves en checkSession', () => {
    const r = informe();
    expect(r.errores).toEqual([]);
    expect(r.soloLectura).toBe(true);
    expect(r.resumen).toMatchObject({ usuarios: 5, activos: 4, conAnomalias: 0, todoDeclaradoNoEfectivo: 0 });
    const admin = usuarioDe(r, 'a***@x.com');
    expect(admin.tipo).toBe('INTERNO');
    expect(admin.declarados).toHaveLength(17);
    expect(admin.efectivos).toEqual(admin.declarados);
    expect(admin.checkSession).toMatchObject({ ok: true, claves: 17 });
    expect(admin.checkSession.efectivos).toEqual(admin.efectivos);
    expect(admin.noTiene).toEqual([]);
    const ext = usuarioDe(r, 'e***@x.com');
    expect(ext.tipo).toBe('EXTERNO');
    expect(ext.noTiene).toEqual(expect.arrayContaining(['usuarios_admin']));
  });

  test('el inactivo no tiene nada efectivo y checkSession lo rechaza (no es una anomalia: es lo esperado)', () => {
    const baja = usuarioDe(informe(), 'b***@x.com');
    expect(baja.estado).toBe('inactivo');
    expect(baja.efectivos).toEqual([]);
    expect(baja.checkSession).toMatchObject({ ok: false, code: 'USER_DISABLED' });
    expect(baja.anomalias).toEqual([]);
  });
});

describe('matriz de permisos: cada causa posible de "tiene todo en la hoja pero no lo recibe"', () => {
  test('una celda "Sí" (con tilde) NO es SI: el permiso se pierde y queda a la vista como OTRO', () => {
    celda(ADMIN2, 'ubicacion', 'Sí');
    const u = usuarioDe(informe(), 'a***@x.com');
    const dos = informe().usuarios.filter((x) => x.email === 'a***@x.com')[1];
    expect(dos.celdasNoCanonicas.ubicacion).toBe('OTRO:"Sí"');
    expect(dos.anomalias).toEqual(expect.arrayContaining(['CELDA_NO_RECONOCIDA_CUENTA_NO:ubicacion']));
    expect(dos.declarados).not.toContain('ubicacion');
    expect(dos.efectivos).not.toContain('ubicacion');
    expect(dos.checkSession.efectivos).not.toContain('ubicacion');
    expect(dos.anomalias).toContain('DEPENDENCIA_FALTANTE:ubicacion_corregir->ubicacion');
    expect(u).toBeDefined();
  });

  test('una casilla de verificacion (TRUE booleano) tampoco es SI', () => {
    celda('interno@x.com', 'datos', true);
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.celdasNoCanonicas.datos).toBe('BOOL_TRUE');
    expect(u.efectivos).not.toContain('datos');
  });

  test('"si " / "SI" con mayusculas o espacios SI se leen como SI, pero se marcan como no canonicos', () => {
    celda('interno@x.com', 'perfil', ' si ');
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.celdasNoCanonicas.perfil).toBe('SI_NO_EXACTO');
    expect(u.efectivos).toContain('perfil');
    expect(u.anomalias).toContain('CELDA_NO_CANONICA:perfil');
  });

  test('una celda vacia cuenta como NO y se marca', () => {
    celda('interno@x.com', 'ne', '');
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.anomalias).toContain('CELDA_VACIA_CUENTA_NO:ne');
  });

  test('TODO en la hoja pero tipo EXTERNO: usuarios_admin no es efectivo -> TODO_DECLARADO_NO_EFECTIVO (y ADMIN_DECLARADO_NO_EFECTIVO_POR_TIPO)', () => {
    TODOS.forEach((id) => celda('externo@x.com', id, 'SI'));
    const u = usuarioDe(informe(), 'e***@x.com');
    expect(u.declarados).toHaveLength(17);
    expect(u.efectivos).toHaveLength(16);
    expect(u.declaradosNoEfectivos).toEqual(['usuarios_admin']);
    expect(u.anomalias).toEqual(expect.arrayContaining(['TODO_DECLARADO_NO_EFECTIVO', 'ADMIN_DECLARADO_NO_EFECTIVO_POR_TIPO']));
    expect(informe().resumen.todoDeclaradoNoEfectivo).toBe(1);
  });

  test('TODO en la hoja con tipo VACIO: solo usuarios_admin se pierde, ubicacion y el resto llegan', () => {
    TODOS.forEach((id) => celda('interno@x.com', id, 'SI'));
    celda('interno@x.com', 'tipo', '');
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.tipo).toBe('(vacio/invalido)');
    expect(u.noTiene).toEqual(['usuarios_admin']);
    expect(u.efectivos).toEqual(expect.arrayContaining(['ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'mapa']));
    expect(u.anomalias).toEqual(expect.arrayContaining(['TIPO_VACIO_O_INVALIDO', 'TODO_DECLARADO_NO_EFECTIVO']));
  });

  test('una columna de permiso AUSENTE da NO a todos y se informa; el encabezado mal escrito aparece como desconocido', () => {
    const header = E.hojas.Usuarios.filas[0];
    header[header.indexOf('ubicacion')] = 'ubicación';
    const r = informe();
    expect(r.hoja.encabezados.faltantes).toContain('ubicacion');
    expect(r.hoja.encabezados.desconocidos).toContain('"ubicación"');
    expect(usuarioDe(r, 'i***@x.com').anomalias).toContain('SIN_COLUMNA:ubicacion');
    expect(usuarioDe(r, 'i***@x.com').efectivos).not.toContain('ubicacion');
  });

  test('un encabezado con espacios o mayusculas SI funciona (se normaliza) y se informa como no estricto', () => {
    const header = E.hojas.Usuarios.filas[0];
    header[header.indexOf('ubicacion')] = ' Ubicacion ';
    const r = informe();
    expect(r.hoja.encabezados.faltantes).not.toContain('ubicacion');
    expect(r.hoja.encabezados.noEstrictosPeroLeidos).toContain('" Ubicacion "');
    expect(usuarioDe(r, 'i***@x.com').efectivos).toContain('ubicacion');
  });

  test('un email repetido: GANA LA PRIMERA FILA (la que lee getUserStatus) y la otra queda ignorada, ambas marcadas', () => {
    const filas = E.hojas.Usuarios.filas;
    const vieja = filaDe(E.header, { email: 'Interno@X.com ', nombre: 'Vieja', permisos: ['perfil'] });
    filas.splice(3, 0, vieja);                                       // fila 4, antes de la fila 'real' del mismo email
    const r = informe();
    const dups = r.usuarios.filter((u) => u.email === 'I***@X.com' || u.email === 'i***@x.com');
    const ganadora = dups.find((u) => u.anomalias.includes('EMAIL_DUPLICADO_GANA_ESTA_FILA'));
    const ignorada = dups.find((u) => u.anomalias.includes('EMAIL_DUPLICADO_FILA_IGNORADA'));
    expect(ganadora).toBeDefined();
    expect(ignorada).toBeDefined();
    expect(ganadora.fila).toBeLessThan(ignorada.fila);
    expect(ganadora.efectivos).toEqual(['perfil']);                  // la fila con MENOS permisos es la que manda
    expect(ignorada.checkSession).toBeNull();
  });

  test('un estado raro ("Activo?") deja al usuario sin acceso y se marca', () => {
    celda('interno@x.com', 'estado', 'Activo?');
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.anomalias).toContain('ESTADO_RARO');
    expect(u.efectivos).toEqual([]);
  });

  test('CACHE anterior distinto de la hoja: queda marcado (vale hasta 5 minutos) y checkSession ya refleja la hoja solo cuando vence', () => {
    global.getUserAccess('interno@x.com');                           // cachea el acceso actual
    celda('interno@x.com', 'ubicacion', 'NO');                       // la hoja cambia despues
    const u = usuarioDe(informe(), 'i***@x.com');
    expect(u.cache.efectivos).toContain('ubicacion');
    expect(u.efectivos).not.toContain('ubicacion');
    expect(u.anomalias).toContain('CACHE_ANTERIOR_DISTINTO_DE_LA_HOJA');
    expect(u.checkSession.efectivos).toContain('ubicacion');         // checkSession responde con el cache: el cambio manual tarda hasta 5 min
    expect(u.anomalias).toContain('CHECKSESSION_DISTINTO_DE_EFECTIVOS');
  });

  test('dependencia faltante (ubicacion_corregir sin ubicacion) se informa aunque el login no la aplique', () => {
    celda('interno@x.com', 'ubicacion_corregir', 'SI');
    celda('interno@x.com', 'ubicacion', 'NO');
    expect(usuarioDe(informe(), 'i***@x.com').anomalias).toContain('DEPENDENCIA_FALTANTE:ubicacion_corregir->ubicacion');
  });

  test('categoriaCelda: todos los tipos de valor que puede devolver Sheets', () => {
    const c = D.diagPerm_categoriaCelda;
    expect([c('SI'), c('NO'), c(''), c(null), c(undefined), c(true), c(false), c(1), c(' si'), c('No '), c('X'), c('Sí')]).toEqual(['SI', 'NO', 'VACIA', 'VACIA', 'VACIA', 'BOOL_TRUE', 'BOOL_FALSE', 'NUMERO', 'SI_NO_EXACTO', 'NO_NO_EXACTO', 'OTRO:"X"', 'OTRO:"Sí"']);
    expect(c('x'.repeat(100))).toBe('OTRO:"' + 'x'.repeat(12) + '"');
  });
});

describe('el diagnostico es de SOLO LECTURA y privado', () => {
  test('no cambia ninguna celda de ninguna hoja, ni propiedades; no lanza ante una hoja inexistente o un fallo de lectura', () => {
    const antes = JSON.stringify(E.hojas);
    informe();
    D.diagnosticoPermisosE10();
    expect(JSON.stringify(E.hojas)).toBe(antes);
    expect(global.__propiedades).toEqual({});
    delete E.hojas.Usuarios;
    expect(informe().errores).toEqual(['HOJA_USUARIOS_INEXISTENTE']);
    expect(D.diagPerm_construir(Object.assign(D.diagPerm_depsReales(), { tabla: () => { throw new Error('x'); } })).errores).toEqual(['HOJA_USUARIOS_NO_LEIDA']);
  });

  test('la salida no lleva emails completos, nombres, tokens ni ids; se identifica por NUMERO DE FILA', () => {
    const texto = JSON.stringify(informe());
    ['admin1@x.com', 'admin2@x.com', 'interno@x.com', 'externo@x.com', 'Admin Uno', 'Interno Consulta', 'sessionToken'].forEach((s) => expect(texto).not.toContain(s));
    expect(texto).not.toMatch(/[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/);
    expect(informe().usuarios.map((u) => u.fila)).toEqual([2, 3, 4, 5, 6]);
  });

  test('Logger.log recibe UN JSON valido', () => {
    global.Logger.log.mockClear();
    D.diagnosticoPermisosE10();
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.Logger.log.mock.calls[0][0]).soloLectura).toBe(true);
  });

  test('guarda estatica: el archivo no tiene ninguna llamada que escriba o que toque Google', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'DiagnosticoPermisosE10.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/\.(setValue|setValues|appendRow|deleteRow|deleteColumn|insertSheet|insertRow|insertColumns|clear|clearContent|setProperty|setProperties|deleteProperty|put|remove|removeAll)\s*\(/);
    expect(src).not.toMatch(/LockService|UrlFetchApp|MailApp|GmailApp|ScriptApp|SpreadsheetApp|DriveApp|PropertiesService|CacheService\.(?!getScriptCache)/);
  });
});

describe('gates administrativos con el flag APAGADO (por doPost, camino real del Web App)', () => {
  const correr = () => D.diagPerm_gates(D.diagPerm_depsGatesReales());

  test('administrador -> E10_ADMIN_INACTIVO; usuario normal y EXTERNO -> PERMISSION_DENIED; token invalido -> UNAUTHORIZED, en los 7 endpoints', () => {
    const r = correr();
    expect(r.faltas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.cobertura).toEqual({ adminReal: true, internoNoAdmin: true, externos: 1 });
    const por = {};
    r.resultados.forEach((x) => { por[x.actor] = x.respuestas; });
    D.DIAG_PERM_E10_ACCIONES_ADMIN.forEach((a) => {
      expect(por.ADMIN_REAL[a]).toBe('E10_ADMIN_INACTIVO');
      expect(por.INTERNO_NO_ADMIN[a]).toBe('PERMISSION_DENIED');
      expect(por.EXTERNO[a]).toBe('PERMISSION_DENIED');
      expect(por.TOKEN_INVALIDO[a]).toBe('UNAUTHORIZED');
    });
    expect(r.resultados.filter((x) => x.actor === 'ADMIN_REAL')).toHaveLength(2);
  });

  test('un EXTERNO con usuarios_admin escrito a mano en la hoja SIGUE recibiendo PERMISSION_DENIED (y se rotula como manipulado)', () => {
    celda('externo@x.com', 'usuarios_admin', 'SI');
    const r = correr();
    const ext = r.resultados.find((x) => x.actor === 'EXTERNO_CON_USUARIOS_ADMIN_MANIPULADO');
    expect(ext).toBeDefined();
    D.DIAG_PERM_E10_ACCIONES_ADMIN.forEach((a) => expect(ext.respuestas[a]).toBe('PERMISSION_DENIED'));
    expect(r.ok).toBe(true);
  });

  test('un usuario inactivo recibe USER_DISABLED', () => {
    expect(correr().resultados.find((x) => x.actor === 'INACTIVO').respuestas.adminUsuarioCrear).toBe('USER_DISABLED');
  });

  test('si el flag esta ENCENDIDO la prueba se NIEGA a correr y no llama a ningun endpoint', () => {
    global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO = 'SI';
    const r = correr();
    expect(r.abortado).toMatch(/ENCENDIDO/);
    expect(r.ok).toBe(false);
    expect(r.resultados).toEqual([]);
    expect(global.doPost).not.toHaveBeenCalled();
  });

  test('una respuesta inesperada se informa como falta (no se aprueba por defecto)', () => {
    const deps = Object.assign(D.diagPerm_depsGatesReales(), { llamar: (t, a) => (a === 'adminUsuarioCrear' ? { status: 'ok', data: {} } : { status: 'error', code: 'PERMISSION_DENIED' }) });
    const r = D.diagPerm_gates(deps);
    expect(r.ok).toBe(false);
    expect(r.faltas.some((f) => /adminUsuarioCrear: esperado .*obtenido OK\(!\)/.test(f))).toBe(true);
  });

  test('Historial y Telegram se reemplazan mientras corre y se RESTAURAN siempre; no se escribe ningun Historial', () => {
    const originalHistorial = global.logHistoryEvent;
    const originalTelegram = global.telegramRepository_sendMessage;
    const r = correr();
    expect(r.instaladoSinEfectos).toBe(true);
    expect(r.historialYTelegramSuprimidos.logHistoryEvent).toBeGreaterThan(0);
    expect(r.historialYTelegramSuprimidos.telegramRepository_sendMessage).toBe(0);
    expect(global.logHistoryEvent).toBe(originalHistorial);
    expect(global.telegramRepository_sendMessage).toBe(originalTelegram);
    expect(originalHistorial).not.toHaveBeenCalled();
    // y se restauran aunque una llamada lance
    const deps = Object.assign(D.diagPerm_depsGatesReales(), { llamar: () => { throw new Error('boom'); } });
    expect(() => D.diagPerm_gates(deps)).toThrow('boom');
    expect(global.logHistoryEvent).toBe(originalHistorial);
  });

  test('no modifica ningun usuario ni evento', () => {
    const antes = JSON.stringify(E.hojas);
    correr();
    D.diagnosticoGatesAdminE10();
    expect(JSON.stringify(E.hojas)).toBe(antes);
  });

  test('la salida no lleva emails completos ni tokens', () => {
    const texto = JSON.stringify(correr());
    ['admin1@x.com', 'admin2@x.com', 'interno@x.com', 'externo@x.com', 'sessionToken'].forEach((s) => expect(texto).not.toContain(s));
    expect(texto).not.toMatch(/[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/);
  });
});
