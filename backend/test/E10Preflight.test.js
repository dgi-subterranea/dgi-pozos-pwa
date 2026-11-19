// E10-1: preflight de SOLO LECTURA. Evaluacion pura + corrida completa sobre hojas / propiedades / cache que lanzan ante cualquier escritura. Escenario: la hoja ya migrada (11 usuarios).
const { crearEntornoE10, COLS_E10, COLS_ACTUALES, PERMISOS_DE_SIEMPRE } = require('./e10Entorno');

const NOMBRES = ['Federico', 'Mariana', 'Perfiles', 'Externo Uno', 'Externo Dos', 'P6', 'P7', 'P8', 'P9', 'P10', 'P11'];
const base = ['perfil', 'datos', 'ubicacion', 'ubicacion_corregir', 'mapa'];
const MIGRADOS = NOMBRES.map((nombre, i) => ({
  email: 'u' + (i + 1) + '@test.local', nombre, tipo: i === 3 || i === 4 ? 'EXTERNO' : 'INTERNO',
  permisos: base.concat(i < 2 ? ['usuarios_admin'] : [])
}));

let E;
let P;
function entorno(extra) {
  E = crearEntornoE10(Object.assign({ usuarios: MIGRADOS, eventos: true }, extra || {}));
  P = require('../src/E10Preflight');
  Object.assign(global, P);
  Object.assign(global, require('../src/Api'));
  return E;
}
const evaluar = (extra) => { entorno(extra); return P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() })); };
const item = (r, id) => r.items.find((i) => i.id === id);

describe('estado migrado y sano: todo en verde', () => {
  test('listo = true, 13 items en verde, contadores correctos', () => {
    const r = evaluar();
    expect(r.listo).toBe(true);
    expect(r.items.map((i) => i.id)).toEqual(['usuarios_hoja', 'usuarios_columnas', 'catalogo', 'usuarios_eventos', 'mapa', 'admins', 'politica_autoridad', 'externos_sin_autoridad', 'flags', 'tipo', 'consistencia', 'ultimo_admin', 'email_verified_modo', 'telegram_gates']);
    expect(r.items.every((i) => i.ok)).toBe(true);
    expect(r.contadores).toEqual({ usuarios: 11, activos: 11, administradoresEfectivos: 2, internos: 9, externos: 2, conMapa: 11, filasConPermisosInefectivos: 0 });
    expect(r.soloLectura).toBe(true);
    expect(r.advertencias).toEqual([]);
  });

  test('flags: ambos APAGADOS (E10-1) y el modo de email_verified resuelto', () => {
    const r = evaluar();
    expect(r.flags).toEqual({ E10_ADMIN_USUARIOS_ACTIVO: 'APAGADO', E10_GESTION_EXTERNOS_ACTIVO: 'APAGADO' });
    expect(item(r, 'email_verified_modo').detalle).toBe('modo OBSERVAR (AUSENTE)');
  });

  test('los detalles son legibles y NO traen emails ni secretos', () => {
    const r = evaluar();
    const texto = JSON.stringify(r);
    MIGRADOS.forEach((u) => expect(texto).not.toContain(u.email));
    expect(texto).not.toMatch(/token|secret|password/i);
  });
});

describe('cada item detecta su falla (y solo ella)', () => {
  const sinFallas = (r, ids) => r.items.filter((i) => !i.ok).map((i) => i.id).sort().join(',') === ids.slice().sort().join(',');

  test('columnas: falta una columna de E10', () => {
    const r = evaluar({ header: COLS_E10.filter((c) => c !== 'version') });
    expect(item(r, 'usuarios_columnas').ok).toBe(false);
    expect(item(r, 'usuarios_columnas').detalle).toMatch(/version/);
    expect(r.listo).toBe(false);
  });

  test('hoja sin migrar (19 columnas): columnas, mapa, tipo y consistencia en rojo', () => {
    const r = evaluar({ header: COLS_ACTUALES });
    expect(r.listo).toBe(false);
    ['usuarios_columnas', 'mapa', 'tipo', 'consistencia'].forEach((id) => expect(item(r, id).ok).toBe(false));
    expect(item(r, 'usuarios_hoja').ok).toBe(true);
  });

  test('UsuariosEventos: hoja inexistente y esquema inesperado', () => {
    const sin = evaluar({ eventos: false });
    expect(item(sin, 'usuarios_eventos')).toMatchObject({ ok: false });
    expect(item(sin, 'usuarios_eventos').detalle).toMatch(/NO existe/);
    expect(sinFallas(sin, ['usuarios_eventos'])).toBe(true);
    entorno();
    E.hojas.UsuariosEventos.filas = [['otra']];
    const rota = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
    expect(item(rota, 'usuarios_eventos').detalle).toMatch(/esquema inesperado/);
  });

  test('mapa: un usuario activo sin mapa = SI se detecta (perderia el mapa al desplegar el gate)', () => {
    const r = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 7 ? Object.assign({}, u, { permisos: u.permisos.filter((p) => p !== 'mapa') }) : u)) });
    expect(item(r, 'mapa').ok).toBe(false);
    expect(item(r, 'mapa').detalle).toMatch(/1 usuario/);
  });

  test('admins: sin ningun administrador efectivo, o un EXTERNO con usuarios_admin', () => {
    const sinAdmin = evaluar({ usuarios: MIGRADOS.map((u) => Object.assign({}, u, { permisos: u.permisos.filter((p) => p !== 'usuarios_admin') })) });
    expect(item(sinAdmin, 'admins')).toMatchObject({ ok: false });
    const externoAdmin = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 3 ? Object.assign({}, u, { permisos: u.permisos.concat(['usuarios_admin']) }) : u)) });
    expect(item(externoAdmin, 'admins').ok).toBe(false);
    expect(item(externoAdmin, 'admins').detalle).toMatch(/1 EXTERNO/);
    expect(externoAdmin.contadores.administradoresEfectivos).toBe(2);              // el externo no cuenta
  });

  // E10-3: politica de autoridad. Un EXTERNO nunca valida, modera, anula lo ajeno ni administra: el catalogo lo reserva y la hoja no deberia tener esos permisos en filas que no son INTERNO.
  test('E10-3: el escenario real (2 externos con los permisos de siempre) esta en verde: ninguna fila NO INTERNO con autoridad', () => {
    const r = evaluar();
    expect(item(r, 'politica_autoridad')).toMatchObject({ ok: true });
    expect(item(r, 'politica_autoridad').detalle).toContain('perfil_validar, ubicacion_validar, fotos_moderar, observaciones_anular, usuarios_admin');
    expect(item(r, 'externos_sin_autoridad').ok).toBe(true);
    expect(r.contadores.filasConPermisosInefectivos).toBe(0);
  });

  test('E10-3: un EXTERNO con permisos de autoridad en la hoja se detecta (rojo + advertencia), se CUENTA sin nombrar a nadie y no afecta a los administradores', () => {
    const conAutoridad = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 3 ? Object.assign({}, u, { permisos: u.permisos.concat(['perfil_validar', 'fotos', 'fotos_moderar', 'observaciones', 'observaciones_anular']) }) : u)) });
    expect(item(conAutoridad, 'externos_sin_autoridad').ok).toBe(false);
    expect(item(conAutoridad, 'externos_sin_autoridad').detalle).toMatch(/1 fila\(s\) NO INTERNO con 3 permiso\(s\) de autoridad/);
    expect(conAutoridad.contadores.filasConPermisosInefectivos).toBe(1);
    expect(conAutoridad.advertencias.join(' ')).toMatch(/1 usuario\(s\) no INTERNO tienen permisos de autoridad/);
    expect(conAutoridad.listo).toBe(false);
    expect(JSON.stringify(conAutoridad)).not.toMatch(/@test\.local/);              // ni emails ni nombres
    expect(conAutoridad.contadores.administradoresEfectivos).toBe(2);
    // los INTERNOS con esos mismos permisos NO son un problema (pueden tenerlos)
    const interno = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 2 ? Object.assign({}, u, { permisos: u.permisos.concat(['perfil_validar']) }) : u)) });
    expect(item(interno, 'externos_sin_autoridad').ok).toBe(true);
  });

  test('E10-3: un usuario con tipo vacio o invalido tambien tendria esos permisos inefectivos y se cuenta', () => {
    const r = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 5 ? Object.assign({}, u, { tipo: '', permisos: u.permisos.concat(['ubicacion_validar']) }) : u)) });
    expect(item(r, 'externos_sin_autoridad').ok).toBe(false);
    expect(r.contadores.filasConPermisosInefectivos).toBe(1);
  });

  test('E10-3: el catalogo se compara contra la politica: si un permiso de moderacion volviera a ser aplicable a EXTERNO, el item se pone en rojo', () => {
    evaluar();
    const original = global.permisosCatalogo_lista;
    global.permisosCatalogo_lista = () => original().map((p) => (p.id === 'fotos_moderar' ? Object.assign({}, p, { aplicableExterno: true }) : p));
    try {
      const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
      expect(item(r, 'politica_autoridad').ok).toBe(false);
    } finally {
      global.permisosCatalogo_lista = original;
    }
  });

  test('un solo administrador efectivo: verde con ADVERTENCIA', () => {
    const r = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 1 ? Object.assign({}, u, { permisos: u.permisos.filter((p) => p !== 'usuarios_admin') }) : u)) });
    expect(item(r, 'admins').ok).toBe(true);
    expect(r.advertencias).toContain('hay UN solo administrador efectivo: conviene tener al menos dos');
    expect(r.listo).toBe(true);
  });

  test('tipo: vacio o invalido', () => {
    const r = evaluar({ usuarios: MIGRADOS.map((u, i) => (i === 5 ? Object.assign({}, u, { tipo: '' }) : (i === 6 ? Object.assign({}, u, { tipo: 'ROOT' }) : u))) });
    expect(item(r, 'tipo').ok).toBe(false);
    expect(item(r, 'tipo').detalle).toMatch(/2 usuario/);
  });

  test.each([
    ['email duplicado', (u) => u.concat([Object.assign({}, u[5], { email: u[5].email.toUpperCase() })])],
    ['email invalido', (u) => u.concat([Object.assign({}, u[5], { email: 'sin-arroba' })])],
    ['version 0', (u) => u.map((x, i) => (i === 2 ? Object.assign({}, x, { version: 0 }) : x))],
    ['version no numerica', (u) => u.map((x, i) => (i === 2 ? Object.assign({}, x, { version: 'x' }) : x))],
    ['actualizado_por vacio', (u) => u.map((x, i) => (i === 2 ? Object.assign({}, x, { actualizado_por: '' }) : x))],
    ['estado invalido', (u) => u.map((x, i) => (i === 2 ? Object.assign({}, x, { estado: 'baja' }) : x))]
  ])('consistencia: %s', (_n, f) => {
    const r = evaluar({ usuarios: f(MIGRADOS) });
    expect(item(r, 'consistencia').ok).toBe(false);
  });

  test('consistencia: un valor de permiso que no es SI / NO se detecta', () => {
    entorno();
    const t = global.sheetUserRepository_leerTabla();
    E.hojas.Usuarios.filas[3][t.header.indexOf('datos')] = 'sí';
    const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
    expect(item(r, 'consistencia').ok).toBe(false);
    expect(item(r, 'consistencia').detalle).toMatch(/"permisos":1/);
  });

  test('flags: encendidos se informan con ADVERTENCIA (en E10-1 se esperan apagados) y no tumban el listo', () => {
    const r = evaluar({ propiedades: { E10_ADMIN_USUARIOS_ACTIVO: 'SI', E10_GESTION_EXTERNOS_ACTIVO: 'SI' } });
    expect(r.flags).toEqual({ E10_ADMIN_USUARIOS_ACTIVO: 'ENCENDIDO', E10_GESTION_EXTERNOS_ACTIVO: 'ENCENDIDO' });
    expect(r.advertencias.join(' ')).toMatch(/E10_ADMIN_USUARIOS_ACTIVO esta ENCENDIDO/);
    expect(r.advertencias.join(' ')).toMatch(/E10_GESTION_EXTERNOS_ACTIVO esta ENCENDIDO/);
    expect(r.listo).toBe(true);
  });

  test.each([['SI', 'ENCENDIDO'], ['si', 'APAGADO'], ['NO', 'APAGADO'], ['', 'APAGADO']])('el flag con %j se informa como %s (mismo criterio que el codigo)', (valor, estado) => {
    const r = evaluar({ propiedades: { E10_ADMIN_USUARIOS_ACTIVO: valor } });
    expect(r.flags.E10_ADMIN_USUARIOS_ACTIVO).toBe(estado);
  });

  test('modo de email_verified: EXIGIR, OBSERVAR y valor invalido (advertencia)', () => {
    expect(item(evaluar({ propiedades: { EMAIL_VERIFIED_MODO: 'EXIGIR' } }), 'email_verified_modo').detalle).toBe('modo EXIGIR (VALIDO)');
    expect(item(evaluar({ propiedades: { EMAIL_VERIFIED_MODO: 'OBSERVAR' } }), 'email_verified_modo').detalle).toBe('modo OBSERVAR (VALIDO)');
    const r = evaluar({ propiedades: { EMAIL_VERIFIED_MODO: 'OBSERBAR' } });
    expect(item(r, 'email_verified_modo').detalle).toBe('modo OBSERVAR (INVALIDO)');
    expect(r.advertencias.join(' ')).toMatch(/EMAIL_VERIFIED_MODO tiene un valor invalido/);
  });
});

describe('ultimo admin y gates: se EJERCITAN las reglas reales (no se mira un texto)', () => {
  test('ultimo_admin ok: la regla rechaza desactivar o pasar a EXTERNO al unico administrador y rechaza EXTERNO + usuarios_admin', () => {
    expect(item(evaluar(), 'ultimo_admin').ok).toBe(true);
  });

  test('si la regla se rompiera, el preflight lo detecta: ultimo_admin en rojo', () => {
    entorno();
    const original = global.usuariosDominio_validarMutacion;
    global.usuariosDominio_validarMutacion = () => ({ ok: true });
    const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
    expect(item(r, 'ultimo_admin').ok).toBe(false);
    global.usuariosDominio_validarMutacion = original;
  });

  test('telegram_gates ok con las funciones reales; en rojo si el gate de busqueda o el de descarga se aflojan', () => {
    expect(item(evaluar(), 'telegram_gates').ok).toBe(true);
    const original = { b: global.api_puedeRegistrarBusqueda, d: global.api_puedeRegistrarDescarga };
    global.api_puedeRegistrarBusqueda = () => true;
    expect(item(P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() })), 'telegram_gates').ok).toBe(false);
    global.api_puedeRegistrarBusqueda = original.b;
    global.api_puedeRegistrarDescarga = () => true;
    expect(item(P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() })), 'telegram_gates').ok).toBe(false);
    global.api_puedeRegistrarDescarga = original.d;
  });

  test('catalogo: en rojo si un catalogo roto (usuarios_admin aplicable a EXTERNO) llegara a existir', () => {
    entorno();
    const original = global.permisosCatalogo_porId;
    global.permisosCatalogo_porId = (id) => { const p = original(id); return id === 'usuarios_admin' ? Object.assign({}, p, { aplicableExterno: true }) : p; };
    const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
    expect(item(r, 'catalogo').ok).toBe(false);
    global.permisosCatalogo_porId = original;
  });
});

describe('tolerancia', () => {
  test.each([[undefined], [null], [{}], ['x'], [5], [{ tabla: null }], [{ tabla: { existe: true, header: 'no', filas: 'no' } }]])('un estado raro (%j) nunca lanza y nunca da listo', (estado) => {
    entorno();
    let r;
    expect(() => { r = P.preflightE10_evaluar(estado); }).not.toThrow();
    expect(r.listo).toBe(false);
  });

  test('sin la hoja Usuarios: usuarios_hoja en rojo y el resto se evalua sin romper', () => {
    entorno();
    delete E.hojas.Usuarios;
    const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => global.sheetUserRepository_leerTabla() }));
    expect(item(r, 'usuarios_hoja').ok).toBe(false);
    expect(r.listo).toBe(false);
  });

  test('una lectura que falla se informa como "no ok", sin lanzar ni imprimir el error', () => {
    entorno();
    const r = P.preflightE10_evaluar(P.preflightE10_recolectar({ leerTabla: () => { throw new Error('Sheets caido con a@x.com'); }, estadoEventos: () => { throw new Error('boom'); } }));
    expect(item(r, 'usuarios_hoja').ok).toBe(false);
    expect(item(r, 'usuarios_eventos').ok).toBe(false);
    expect(JSON.stringify(r)).not.toMatch(/a@x\.com|boom|Sheets caido/);
  });

  test('filas basura (numeros, null, objetos, arreglos vacios) no rompen la lectura de usuarios', () => {
    entorno();
    const t = global.sheetUserRepository_leerTabla();
    t.filas.push([1, 2, 3], null, 'x', [], [{}, {}], [null]);
    expect(() => P.preflightE10_usuarios(t)).not.toThrow();
    expect(P.preflightE10_usuarios(t).usuarios.length).toBe(11 + 2);
  });
});

describe('SOLO LECTURA (corrida completa de Apps Script)', () => {
  const PERMITIDOS = new Set(['getName', 'getLastRow', 'getLastColumn', 'getDataRange', 'getMaxRows', 'getMaxColumns', 'nombre', 'filas', 'formatos', 'congeladas', 'columnasFisicas', 'estricta', 'formatoColumnas']);
  function soloLectura(hoja, registro) {
    return new Proxy(hoja, {
      get(t, prop) {
        if (typeof prop === 'symbol') { return t[prop]; }
        registro.push(String(prop));
        if (prop === 'getRange') {
          // el rango que se devuelve solo permite LEER: cualquier otro metodo (setValues, setNumberFormat...) lanza
          return (...args) => {
            const r = t.getRange(...args);
            return new Proxy(r, { get(rt, rp) { registro.push('range.' + String(rp)); if (rp === 'getValues') { return rt.getValues.bind(rt); } return () => { throw new Error('ESCRITURA PROHIBIDA en rango: ' + String(rp)); }; } });
          };
        }
        if (PERMITIDOS.has(prop)) { return typeof t[prop] === 'function' ? t[prop].bind(t) : t[prop]; }
        return () => { throw new Error('ESCRITURA PROHIBIDA: ' + String(prop)); };
      },
      set() { throw new Error('ESCRITURA PROHIBIDA (set)'); }
    });
  }

  test('preflightE10_1() corre completo sobre hojas, propiedades, cache, lock, red y mail que lanzan ante cualquier escritura, sin modificar nada', () => {
    entorno();
    const accesos = [];
    const proxies = {};
    Object.keys(E.hojas).forEach((n) => { proxies[n] = soloLectura(E.hojas[n], accesos); });
    global.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => proxies[n] || null, insertSheet: () => { throw new Error('ESCRITURA PROHIBIDA: insertSheet'); } }), flush: () => { throw new Error('ESCRITURA PROHIBIDA: flush'); } };
    const prohibido = (nombre) => new Proxy({}, { get: () => () => { throw new Error('USO PROHIBIDO: ' + nombre); } });
    global.CacheService = prohibido('CacheService');
    global.LockService = prohibido('LockService');
    global.UrlFetchApp = prohibido('UrlFetchApp');
    global.MailApp = prohibido('MailApp');
    global.ScriptApp = prohibido('ScriptApp');
    global.DriveApp = prohibido('DriveApp');
    const escrituraPropiedades = jest.fn();
    global.PropertiesService = { getScriptProperties: () => ({ getProperty: () => null, setProperty: escrituraPropiedades, deleteProperty: escrituraPropiedades }) };
    global.Logger = { log: jest.fn() };
    const antes = JSON.stringify(Object.keys(E.hojas).map((n) => E.hojas[n].filas));
    let r;
    expect(() => { r = P.preflightE10_1(); }).not.toThrow();
    expect(JSON.stringify(Object.keys(E.hojas).map((n) => E.hojas[n].filas))).toBe(antes);
    expect(escrituraPropiedades).not.toHaveBeenCalled();
    expect(r.listo).toBe(true);
    expect([...new Set(accesos)].filter((m) => /^(set|append|insert|delete|clear|remove|copy|move|hide|protect|sort|merge)/i.test(m.replace('range.', '')))).toEqual([]);
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.Logger.log.mock.calls[0][0]).soloLectura).toBe(true);
  });

  test('guarda estatica: el archivo no contiene ninguna API de escritura, red, mail, cache, lock, triggers ni propiedades de escritura', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'E10Preflight.js'), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(fuente).not.toMatch(/\.(setValue|setValues|setFormula\w*|setNumberFormat\w*|appendRow|insertColumn\w*|insertRow\w*|insertSheet|deleteRow\w*|deleteColumn\w*|deleteSheet|clear\w*|setProperty|setProperties|deleteProperty|deleteAllProperties|put|putAll|remove|removeAll|waitLock|tryLock|releaseLock|newTrigger|sendEmail|fetch|fetchAll|setFrozenRows|copyTo|moveTo|protect|flush)\s*\(/);
    ['UrlFetchApp', 'MailApp', 'GmailApp', 'ScriptApp', 'CacheService', 'LockService', 'PropertiesService', 'DriveApp', 'telegramRepository_', 'notificationService_', 'logHistoryEvent', 'authService_invalidarAcceso', 'getSessionSecret', 'getTelegram'].forEach((t) => expect(fuente.includes(t)).toBe(false));
  });
});

describe('PERMISOS_DE_SIEMPRE', () => {
  test('el escenario usa los 15 permisos de siempre como referencia', () => {
    expect(PERMISOS_DE_SIEMPRE).toHaveLength(15);
  });
});
