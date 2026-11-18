// E10-2: diagnosticoAdminFlagOnE10 (DiagnosticoAdminFlagOnE10.js): la primera prueba REAL de la administracion con el flag ON, SIN escrituras. Modulos REALES (Auth, Api, UsuariosAdminApi/Lectura/Service, dominio, catalogo,
// flags, repositorios); Google y las hojas, en memoria. Lo central: (1) se niega a correr con el flag de administracion apagado o el de externos encendido; (2) NUNCA escribe, por una GUARDA explicita que cubre todas
// las funciones de escritura del codigo; (3) lecturas, catalogo, detalle, gates y el rechazo de altas de externos dan lo esperado; (4) no expone emails completos, nombres ni tokens.
const fs = require('fs');
const path = require('path');
const { crearEntornoE10, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');

const TODOS = PERMISOS_DE_SIEMPRE.concat(['mapa', 'usuarios_admin']);
const INTERNO = ['perfil', 'datos', 'ubicacion', 'mapa'];
// el caso real: 11 usuarios, 9 INTERNO (2 administradores), 2 EXTERNO
const ONCE = () => [
  { email: 'fede@x.com', nombre: 'Federico Albrieu', permisos: TODOS },
  { email: 'mari@x.com', nombre: 'Mariana Ryan', permisos: TODOS },
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ email: 'user' + n + '@x.com', nombre: 'Usuario Numero' + n, permisos: INTERNO })),
  { email: 'gualde@x.com', nombre: 'Maria Soledad Gualde', tipo: 'EXTERNO', permisos: ['perfil', 'perfil_subir', 'mapa'] },
  { email: 'dietrich@x.com', nombre: 'Sebastian Dietrich', tipo: 'EXTERNO', permisos: ['perfil', 'mapa'] }
];

let E;
let D;
let Api;
function armar(opciones) {
  const o = opciones || {};
  E = crearEntornoE10({ usuarios: o.usuarios || ONCE(), propiedades: o.propiedades === undefined ? { E10_ADMIN_USUARIOS_ACTIVO: 'SI' } : o.propiedades });
  ['UsuariosAdminLectura', 'UsuariosAdminApi'].forEach((m) => Object.assign(global, require('../src/' + m)));
  Api = require('../src/Api');
  global.validateSession = Api.validateSession;
  global.doPost = jest.fn(Api.doPost);
  global.logHistoryEvent = jest.fn();
  global.telegramRepository_sendMessage = jest.fn(() => ({ ok: true }));
  global.ContentService = { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ getContent: () => t, setMimeType() { return this; } }) };
  Object.assign(global, require('../src/DiagnosticoPermisosE10'));      // diagPerm_sinEfectos (en Apps Script comparten el espacio global)
  D = require('../src/DiagnosticoAdminFlagOnE10');
}
const correr = (deps) => D.diagAdm_correr(deps || D.diagAdm_depsReales());
const instantanea = () => JSON.stringify(E.hojas);
const llamadasDoPost = () => global.doPost.mock.calls.length;

beforeEach(() => { armar(); });

describe('se NIEGA a correr si las condiciones de la prueba no se cumplen', () => {
  test.each([[undefined], ['NO'], [''], ['si'], [' SI']])('E10_ADMIN_USUARIOS_ACTIVO = %j: aborta sin llamar a ningun endpoint', (valor) => {
    armar({ propiedades: valor === undefined ? {} : { E10_ADMIN_USUARIOS_ACTIVO: valor } });
    const antes = instantanea();
    const r = correr();
    expect(r.abortado).toMatch(/no es SI/);
    expect(r.ok).toBe(false);
    expect(r.lecturas).toBeNull();
    expect(llamadasDoPost()).toBe(0);
    expect(instantanea()).toBe(antes);
  });

  test('E10_GESTION_EXTERNOS_ACTIVO = SI: aborta sin llamar a ningun endpoint', () => {
    armar({ propiedades: { E10_ADMIN_USUARIOS_ACTIVO: 'SI', E10_GESTION_EXTERNOS_ACTIVO: 'SI' } });
    const r = correr();
    expect(r.abortado).toMatch(/GESTION_EXTERNOS_ACTIVO esta ENCENDIDO/);
    expect(r.flags).toEqual({ adminUsuarios: 'ENCENDIDO', gestionExternos: 'ENCENDIDO' });
    expect(llamadasDoPost()).toBe(0);
  });

  test('sin administrador efectivo en la hoja: aborta', () => {
    armar({ usuarios: ONCE().map((u) => Object.assign({}, u, { permisos: INTERNO })) });
    expect(correr().abortado).toMatch(/NO_HAY_ADMINISTRADOR_EFECTIVO/);
    expect(llamadasDoPost()).toBe(0);
  });
});

describe('con las condiciones correctas y los 11 usuarios esperados: todo verde y sin escrituras', () => {
  test('ok = true, sin faltas; guarda instalada y probada; 0 intentos de escritura; hojas identicas antes y despues', () => {
    const antes = instantanea();
    const r = correr();
    expect(r.faltas).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.abortado).toBeNull();
    expect(r.flags).toEqual({ adminUsuarios: 'ENCENDIDO', gestionExternos: 'APAGADO' });
    expect(r.guardaSinEscrituras).toEqual({ instalada: true, sondaBloqueada: true, funcionesBloqueadas: D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.length, intentosDeEscrituraReales: 0 });
    expect(r.hojasSinCambios.igual).toBe(true);
    expect(instantanea()).toBe(antes);
  });

  test('LISTADO: 11 usuarios, 11 activos, 9 INTERNO, 2 EXTERNO, 2 administradores; una linea por usuario con los campos pedidos', () => {
    const l = correr().lecturas.listado;
    expect(l.cantidades).toEqual({ total: 11, activos: 11, interno: 9, externo: 2, administradoresEfectivos: 2 });
    expect(l.usuarios).toHaveLength(11);
    l.usuarios.forEach((u) => expect(Object.keys(u).sort()).toEqual(['actualizadoUtc', 'admin', 'cantidadPermisos', 'email', 'estado', 'nombre', 'tipo', 'version']));
    expect(l.usuarios.filter((u) => u.admin)).toHaveLength(2);
    expect(l.usuarios.filter((u) => u.tipo === 'EXTERNO').map((u) => u.cantidadPermisos).sort()).toEqual([2, 3]);
    expect(l.usuarios.filter((u) => u.admin).every((u) => u.cantidadPermisos === 17)).toBe(true);
  });

  test('una cantidad distinta de la esperada se informa como FALTA (no se aprueba por defecto)', () => {
    armar({ usuarios: ONCE().slice(0, 9) });
    const r = correr();
    expect(r.ok).toBe(false);
    expect(r.faltas.some((f) => /listado: total esperado 11, obtenido 9/.test(f))).toBe(true);
    expect(r.faltas.some((f) => /listado: externo esperado 2, obtenido 0/.test(f))).toBe(true);
  });

  test('CATALOGO: 17 permisos, ids unicos, metadata completa, orden estrictamente creciente y estable, usuarios_admin no aplicable a EXTERNO', () => {
    const c = correr().lecturas.catalogo;
    expect(c).toMatchObject({ permisos: 17, idsUnicos: true, metadataCompleta: true, ordenEstrictamenteCreciente: true, estableEnDosLlamadas: true, usuariosAdminNoAplicableAExterno: true });
    expect(c.ids).toHaveLength(17);
    expect(c.ids).toContain('usuarios_admin');
  });

  test('DETALLE: cada administrador, un INTERNO no administrador y un EXTERNO, con version, etag, permisos y eventos recientes', () => {
    const d = correr().lecturas.detalles;
    expect(d.map((x) => x.rol)).toEqual(['ADMIN', 'ADMIN', 'INTERNO_NO_ADMIN', 'EXTERNO']);
    d.forEach((x) => {
      expect(typeof x.version).toBe('number');
      expect(x.etag).toMatch(/^[0-9a-f]{16}$/);
      expect(Array.isArray(x.permisos)).toBe(true);
      expect(x.cantidadPermisos).toBe(x.permisos.length);
      expect(x.eventosDisponibles).toBe(true);
    });
    expect(d[0].permisos).toHaveLength(17);
    expect(d.find((x) => x.rol === 'EXTERNO').permisos).not.toContain('usuarios_admin');
  });

  test('DETALLE con eventos reales: los ultimos eventos salen mas nuevo primero, con el ejecutor enmascarado y sin clientRequestId', () => {
    // un evento real (se escribe ANTES de la prueba, con las funciones reales; la guarda solo rige durante la corrida)
    const u = global.sheetUserRepository_leerUsuarios().find((x) => x.email === 'user1@x.com');
    expect(global.usuariosAdmin_actualizar({ email: 'fede@x.com', nombre: 'F' }, { email: 'user1@x.com', versionEsperada: u.version, etag: global.usuariosAdmin_vista(u).etag, nombre: 'Usuario Uno', clientRequestId: 'previo-1' }).ok).toBe(true);
    const r = correr();
    const det = r.lecturas.detalles.find((x) => x.rol === 'INTERNO_NO_ADMIN');
    expect(det.cantidadEventos).toBe(1);
    expect(det.ultimosEventos[0]).toMatchObject({ secuencia: 1, evento: 'USUARIO_ACTUALIZADO', ejecutadoPor: 'f***@x.com', origen: 'APP' });
    expect(JSON.stringify(r)).not.toContain('previo-1');
    expect(r.ok).toBe(true);
  });

  test('GATES: administrador permitido (lecturas OK, escrituras con cuerpo vacio -> INVALID_REQUEST); INTERNO no admin y EXTERNO -> PERMISSION_DENIED; token invalido -> UNAUTHORIZED', () => {
    const g = correr().gates;
    const por = (rol) => g.filter((x) => x.rol === rol);
    expect(por('ADMIN')).toHaveLength(2);
    por('ADMIN').forEach((x) => expect(x.respuestas).toEqual({ adminUsuariosListar: 'OK', adminPermisosCatalogo: 'OK', adminUsuarioObtener: 'OK', adminUsuarioCrear: 'INVALID_REQUEST', adminUsuarioActualizar: 'INVALID_REQUEST', adminUsuarioDesactivar: 'INVALID_REQUEST', adminUsuarioReactivar: 'INVALID_REQUEST' }));
    expect(por('INTERNO_NO_ADMIN')).toHaveLength(2);
    expect(por('EXTERNO')).toHaveLength(2);
    [...por('INTERNO_NO_ADMIN'), ...por('EXTERNO')].forEach((x) => D.DIAG_ADMFLAG_ACCIONES.forEach((a) => expect(x.respuestas[a]).toBe('PERMISSION_DENIED')));
    D.DIAG_ADMFLAG_ACCIONES.forEach((a) => expect(por('TOKEN_INVALIDO')[0].respuestas[a]).toBe('UNAUTHORIZED'));
  });

  test('con el flag ON un EXTERNO con usuarios_admin escrito a mano en la hoja SIGUE recibiendo PERMISSION_DENIED', () => {
    const usuarios = ONCE();
    usuarios[9] = Object.assign({}, usuarios[9], { permisos: ['perfil', 'usuarios_admin', 'mapa'] });
    armar({ usuarios });
    const r = correr();
    const ext = r.gates.filter((x) => x.rol === 'EXTERNO');
    expect(ext).toHaveLength(2);
    ext.forEach((x) => D.DIAG_ADMFLAG_ACCIONES.forEach((a) => expect(x.respuestas[a]).toBe('PERMISSION_DENIED')));
    expect(r.lecturas.listado.cantidades.administradoresEfectivos).toBe(2);
    expect(r.ok).toBe(true);
  });

  test('EXTERNOS con la gestion apagada: crear EXTERNO, convertir INTERNO -> EXTERNO y reactivar EXTERNO (sintetico) -> E10_GESTION_EXTERNOS_INACTIVA, sin tocar a Gualde ni a Dietrich', () => {
    const antes = instantanea();
    const r = correr();
    expect(r.externosConGestionApagada).toEqual({ crearExterno: 'E10_GESTION_EXTERNOS_INACTIVA', convertirInternoAExterno: 'E10_GESTION_EXTERNOS_INACTIVA', reactivarExternoSintetico: 'E10_GESTION_EXTERNOS_INACTIVA' });
    expect(r.guardaSinEscrituras.intentosDeEscrituraReales).toBe(0);
    expect(instantanea()).toBe(antes);
    const todos = global.sheetUserRepository_leerUsuarios();
    expect(todos.find((u) => u.email === 'gualde@x.com')).toMatchObject({ version: 1, tipo: 'EXTERNO' });
    expect(todos.find((u) => u.email === 'user1@x.com').tipo).toBe('INTERNO');
    expect(todos.find((u) => u.email === 'e10-2-diagnostico-sintetico@example.com')).toBeUndefined();
  });

  test('el externo sintetico existe SOLO en memoria durante esa llamada (se restaura la lectura real)', () => {
    const original = global.sheetUserRepository_leerUsuarios;
    correr();
    expect(global.sheetUserRepository_leerUsuarios).toBe(original);
  });
});

describe('CERO ESCRITURAS: la guarda', () => {
  test('mientras corre, TODAS las funciones de escritura estan reemplazadas por funciones que lanzan; despues quedan las originales', () => {
    const originales = D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.map((n) => global[n]);
    D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach((n) => expect(typeof global[n]).toBe('function'));
    let dentro = null;
    const e = D.diagAdm_sinEscrituras(() => {
      dentro = D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.map((n) => { try { global[n]({}, 2, {}); return 'ESCRIBIO'; } catch (err) { return String(err.message); } });
    });
    expect(e).toMatchObject({ instalada: true, sondaBloqueada: true, intentos: 1 * 0 + e.intentos });
    expect(dentro.every((m) => /^GUARDA_SIN_ESCRITURAS: /.test(m))).toBe(true);
    D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach((n, i) => expect(global[n]).toBe(originales[i]));
  });

  test('un endpoint que INTENTARA escribir no escribe: la guarda lanza, el intento se cuenta y el informe lo marca como FALTA', () => {
    const deps = D.diagAdm_depsReales();
    const llamarReal = deps.llamar;
    deps.llamar = (token, accion, resto) => {
      if (accion === 'adminUsuarioCrear') {
        try { global.sheetUserRepository_agregarFila({}, { email: 'x@x.com' }); } catch (err) { return { status: 'error', code: 'SERVICE_UNAVAILABLE' }; }
        return { status: 'ok' };
      }
      return llamarReal(token, accion, resto);
    };
    const antes = instantanea();
    const r = correr(deps);
    expect(r.guardaSinEscrituras.intentosDeEscrituraReales).toBeGreaterThanOrEqual(1);
    expect(r.ok).toBe(false);
    expect(r.faltas.some((f) => /se INTENTO escribir/.test(f))).toBe(true);
    expect(instantanea()).toBe(antes);
  });

  test('se restaura SIEMPRE, tambien ante una excepcion en medio de la corrida', () => {
    const originales = D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.map((n) => global[n]);
    const hist = global.logHistoryEvent;
    const deps = Object.assign(D.diagAdm_depsReales(), { llamar: () => { throw new Error('boom'); } });
    expect(() => correr(deps)).toThrow('boom');
    D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.forEach((n, i) => expect(global[n]).toBe(originales[i]));
    expect(global.logHistoryEvent).toBe(hist);
  });

  test('si la guarda NO se puede instalar o probar, no se llama a ningun endpoint', () => {
    const deps = Object.assign(D.diagAdm_depsReales(), { sinEscrituras: () => ({ instalada: false, sondaBloqueada: false, intentos: 0, funciones: [] }) });
    const r = correr(deps);
    expect(r.abortado).toMatch(/GUARDA_SIN_ESCRITURAS_NO_VERIFICADA/);
    expect(r.ok).toBe(false);
    expect(llamadasDoPost()).toBe(0);
  });

  test('una huella de hojas distinta al final se informa como FALTA', () => {
    let n = 0;
    const deps = Object.assign(D.diagAdm_depsReales(), { huellaHojas: () => 'h' + (n += 1) });
    const r = correr(deps);
    expect(r.hojasSinCambios.igual).toBe(false);
    expect(r.ok).toBe(false);
    expect(r.faltas.some((f) => /CAMBIARON durante la prueba/.test(f))).toBe(true);
  });

  test('Historial y Telegram se reemplazan mientras corre y se restauran; no se escribe ningun Historial', () => {
    const hist = global.logHistoryEvent;
    const tel = global.telegramRepository_sendMessage;
    const r = correr();
    expect(r.historialYTelegramSuprimidos.logHistoryEvent).toBeGreaterThan(0);
    expect(r.historialYTelegramSuprimidos.telegramRepository_sendMessage).toBe(0);
    expect(global.logHistoryEvent).toBe(hist);
    expect(global.telegramRepository_sendMessage).toBe(tel);
    expect(hist).not.toHaveBeenCalled();
  });

  test('COBERTURA DE LA GUARDA (estatico): toda funcion de los repositorios que escribe en una hoja esta en la lista bloqueada, y el codigo administrativo no escribe directo', () => {
    const src = (f) => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
    const ESCRIBE = /\.(setValue|setValues|appendRow|deleteRow|deleteRows|deleteColumn|deleteColumns|insertSheet|insertRow|insertRowAfter|insertRowBefore|insertColumns|insertColumnsAfter|insertColumnAfter|clear|clearContent|setFormula|setNumberFormat|copyTo)\s*\(/;
    const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    ['SheetUserRepository.js', 'UsuariosEventosRepository.js'].forEach((archivo) => {
      const bloques = sinComentarios(src(archivo)).split(/\n(?=function )/);
      bloques.forEach((b) => {
        const nombre = (/^function (\w+)/.exec(b) || [])[1];
        if (nombre && ESCRIBE.test(b)) {
          expect([archivo, nombre, D.DIAG_ADMFLAG_ESCRITURAS_BLOQUEADAS.indexOf(nombre) >= 0]).toEqual([archivo, nombre, true]);
        }
      });
    });
    ['UsuariosAdminService.js', 'UsuariosAdminApi.js', 'UsuariosAdminLectura.js', 'UsuariosDominio.js', 'E10Flags.js'].forEach((archivo) => {
      expect([archivo, ESCRIBE.test(sinComentarios(src(archivo)))]).toEqual([archivo, false]);
    });
    // las propiedades (los flags) nunca se escriben
    expect(sinComentarios(src('DiagnosticoAdminFlagOnE10.js'))).not.toMatch(/setProperty|setProperties|deleteProperty|deleteAllProperties/);
  });

  test('guarda estatica del diagnostico: nada que escriba una hoja, una propiedad o toque Google', () => {
    const t = fs.readFileSync(path.join(__dirname, '..', 'src', 'DiagnosticoAdminFlagOnE10.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(t).not.toMatch(/\.(setValue|setValues|appendRow|deleteRow|deleteColumn|insertSheet|insertRow|clear|clearContent|setProperty|setProperties|deleteProperty|put|remove|removeAll)\s*\(/);
    expect(t).not.toMatch(/UrlFetchApp|MailApp|GmailApp|ScriptApp|SpreadsheetApp|DriveApp|PropertiesService|CacheService/);
  });
});

describe('privacidad', () => {
  test('la salida no lleva emails completos, nombres completos, tokens ni clientRequestId', () => {
    const t = JSON.stringify(correr());
    ['fede@x.com', 'mari@x.com', 'gualde@x.com', 'dietrich@x.com', 'user1@x.com', 'Federico', 'Albrieu', 'Mariana', 'Gualde', 'Dietrich', 'sessionToken'].forEach((s) => expect(t).not.toContain(s));
    expect(t).not.toMatch(/[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/);
    expect(t).toContain('F. A.');
  });

  test('Logger.log recibe UN JSON valido', () => {
    global.Logger.log.mockClear();
    const r = D.diagnosticoAdminFlagOnE10();
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.Logger.log.mock.calls[0][0]).ok).toBe(r.ok);
    expect(r.ok).toBe(true);
  });
});
