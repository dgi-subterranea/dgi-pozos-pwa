// E10-1: migracion MANUAL, idempotente y con rollback de la hoja Usuarios. Escenario de 11 usuarios activos como los reales (2 administradores iniciales, 2 externos, 9 internos), con emails ficticios:
// los emails reales NO estan en el codigo, llegan por la Script Property E10_MIGRACION_PARAMETROS. Hojas en memoria: nada toca Google.
const { crearEntornoE10, filaDe, COLS_ACTUALES, COLS_E10 } = require('./e10Entorno');

const U = [
  { email: 'federico@test.local', nombre: 'Federico Albrieu', permisos: ['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'] },
  { email: 'mariana@test.local', nombre: 'Mariana Ryan', permisos: ['perfil', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'ne', 'fotos', 'observaciones', 'observaciones_agregar'] },
  { email: 'perfiles@test.local', nombre: 'DGI PERFILES', permisos: ['perfil', 'perfil_subir', 'perfil_validar', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar'] },
  { email: 'gualde@test.local', nombre: 'María Soledad Gualde', permisos: ['perfil', 'perfil_subir', 'datos', 'ubicacion', 'ubicacion_corregir', 'ne', 'fotos', 'fotos_carga', 'observaciones', 'observaciones_agregar'] },
  { email: 'dietrich@test.local', nombre: 'Sebastián Dietrich', permisos: ['perfil', 'perfil_subir', 'ubicacion', 'ubicacion_corregir', 'ne', 'reemplazo', 'fotos', 'fotos_carga'] },
  ...[6, 7, 8, 9, 10, 11].map((n) => ({ email: 'persona' + n + '@test.local', nombre: 'Persona ' + n, permisos: ['perfil', 'datos', 'ubicacion', 'ubicacion_corregir'].concat(n % 2 ? ['ne'] : ['fotos']) }))
];
const PARAMS = JSON.stringify({ admins: ['federico@test.local', 'mariana@test.local'], externos: ['gualde@test.local', 'dietrich@test.local'] });

let E;
let M;
function entorno(extra) {
  E = crearEntornoE10(Object.assign({ header: COLS_ACTUALES, usuarios: U, eventos: true, propiedades: { E10_MIGRACION_PARAMETROS: PARAMS } }, extra || {}));
  M = require('../src/E10Migracion');
  Object.assign(global, M);
  return E;
}
const copiaHoja = () => JSON.parse(JSON.stringify(E.hojas.Usuarios.filas));
const eventos = () => global.usuariosEventosRepository_leer(global.usuariosEventosRepository_abrir());
const hojasDeRespaldo = () => Object.keys(E.hojas).filter((n) => /^Usuarios_backup_E10-1_/.test(n));
const tabla = () => global.sheetUserRepository_leerTabla();
const filaDeEmail = (email) => { const t = tabla(); const i = t.header.indexOf('email'); return t.filas.find((f) => f[i] === email); };
const celda = (email, col) => filaDeEmail(email)[tabla().header.indexOf(col)];
const parametros = (o) => M.migracionE10_leerParametros(JSON.stringify(o));
const AHORA = '2026-11-05T15:30:00.000Z';
const planDe = (t, p) => M.migracionE10_planificar(t, p === undefined ? M.migracionE10_leerParametros(PARAMS) : p, AHORA);

beforeEach(() => { entorno(); });

describe('parametros (sin ningun email en el codigo)', () => {
  test('el codigo de la migracion no contiene ningun email ni nombre de usuario real', () => {
    const fuente = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'E10Migracion.js'), 'utf8');
    expect(fuente).not.toMatch(/[A-Za-z0-9._-]+@(gmail|hotmail|outlook|[a-z0-9-]+\.(gov|com|org))/i);
    expect(fuente).not.toMatch(/Albrieu|Ryan|Gualde|Dietrich|PERFILES/);
  });

  test('JSON valido: emails normalizados y sin repetidos', () => {
    expect(parametros({ admins: [' A@X.com ', 'a@x.com'], externos: ['E@x.com'] })).toEqual({ ok: true, admins: ['a@x.com'], externos: ['e@x.com'] });
  });

  test.each([
    [null, 'PARAMETROS_AUSENTES'], [undefined, 'PARAMETROS_AUSENTES'], ['  ', 'PARAMETROS_AUSENTES'],
    ['{no es json', 'PARAMETROS_JSON_INVALIDO'], ['[]', 'PARAMETROS_FORMA_INVALIDA'], ['{"admins":["a@x.com"]}', 'PARAMETROS_FORMA_INVALIDA'], ['{"admins":"a@x.com","externos":[]}', 'PARAMETROS_FORMA_INVALIDA']
  ])('%j -> %s', (crudo, motivo) => {
    expect(M.migracionE10_leerParametros(crudo)).toEqual({ ok: false, motivo });
  });
});

describe('plan (puro): que se escribiria', () => {
  test('11 usuarios: 9 INTERNO, 2 EXTERNO, 2 administradores, mapa = SI para los 11 activos, 6 columnas nuevas', () => {
    const p = planDe(tabla());
    expect(p.ok).toBe(true);
    expect(p.bloqueos).toEqual([]);
    expect(p.conflictos).toEqual([]);
    expect(p.columnasPorAgregar).toEqual(['tipo', 'version', 'actualizado_utc', 'actualizado_por', 'usuarios_admin', 'mapa']);
    expect(p.celdasPorCompletar).toEqual([]);
    expect(p.yaAplicada).toBe(false);
    expect(p.resumen).toMatchObject({ usuarios: 11, activos: 11, mapaSI: 11, admins: 2, internos: 9, externos: 2, columnasPorAgregar: 6 });
  });

  test('los valores por usuario: tipo, version 1, actualizado_por institucional, usuarios_admin solo los parametros', () => {
    const p = planDe(tabla());
    const por = (nombre) => p._planeado.find((u) => u.nombre === nombre);
    expect(por('María Soledad Gualde')).toMatchObject({ tipo: 'EXTERNO', usuarios_admin: 'NO', mapa: 'SI', version: 1, actualizado_por: 'migracion:E10-1', actualizado_utc: AHORA });
    expect(por('Sebastián Dietrich')).toMatchObject({ tipo: 'EXTERNO', usuarios_admin: 'NO' });
    expect(por('Federico Albrieu')).toMatchObject({ tipo: 'INTERNO', usuarios_admin: 'SI' });
    expect(por('Mariana Ryan')).toMatchObject({ tipo: 'INTERNO', usuarios_admin: 'SI' });
    expect(por('DGI PERFILES')).toMatchObject({ tipo: 'INTERNO', usuarios_admin: 'NO' });
    expect(p._planeado.filter((u) => u.usuarios_admin === 'SI')).toHaveLength(2);
  });

  test('la vista publica enmascara los emails (nunca el email completo)', () => {
    const p = planDe(tabla());
    U.forEach((u) => expect(JSON.stringify(p.usuarios)).not.toContain(u.email));
    expect(p.usuarios[0].email).toBe('f***@test.local');
  });

  test('un usuario inactivo recibe mapa = NO (y puede ser interno o externo, nunca administrador)', () => {
    entorno({ usuarios: U.concat([{ email: 'baja@test.local', nombre: 'De Baja', estado: 'inactivo', permisos: ['perfil'] }]) });
    const p = planDe(tabla());
    expect(p._planeado.find((u) => u.nombre === 'De Baja')).toMatchObject({ activo: false, mapa: 'NO', usuarios_admin: 'NO', tipo: 'INTERNO' });
    expect(p.resumen).toMatchObject({ usuarios: 12, activos: 11, mapaSI: 11 });
  });

  test.each([
    ['parametros ausentes', undefined, 'PARAMETROS_AUSENTES', () => M.migracionE10_leerParametros(null)],
    ['sin administradores', undefined, 'SIN_ADMINISTRADORES', () => parametros({ admins: [], externos: ['gualde@test.local'] })],
    ['un email de parametros que no existe en la hoja', undefined, 'EMAIL_DE_PARAMETROS_NO_EXISTE', () => parametros({ admins: ['federico@test.local', 'fantasma@test.local'], externos: [] })],
    ['un administrador que es externo (un EXTERNO nunca puede ser administrador)', undefined, 'ADMIN_EXTERNO', () => parametros({ admins: ['federico@test.local', 'gualde@test.local'], externos: ['gualde@test.local'] })]
  ])('bloqueo: %s -> %s', (_n, _x, codigo, params) => {
    const p = planDe(tabla(), params());
    expect(p.ok).toBe(false);
    expect(p.bloqueos.map((b) => b.codigo)).toContain(codigo);
  });

  test('bloqueo: administrador inactivo', () => {
    entorno({ usuarios: U.map((u) => (u.email === 'mariana@test.local' ? Object.assign({}, u, { estado: 'inactivo' }) : u)) });
    expect(planDe(tabla()).bloqueos.map((b) => b.codigo)).toContain('ADMIN_INACTIVO');
  });

  test.each([
    ['email duplicado', (u) => u.concat([{ email: 'PERSONA6@test.local', nombre: 'Repetido', permisos: [] }]), 'EMAIL_DUPLICADO'],
    ['email invalido', (u) => u.concat([{ email: 'sin-arroba', nombre: 'X', permisos: [] }]), 'EMAIL_INVALIDO'],
    ['estado no estandar', (u) => u.concat([{ email: 'raro@test.local', nombre: 'Raro', estado: 'baja', permisos: [] }]), 'ESTADO_NO_ESTANDAR']
  ])('bloqueo de la hoja: %s -> %s', (_n, f, codigo) => {
    entorno({ usuarios: f(U) });
    expect(planDe(tabla()).bloqueos.map((b) => b.codigo)).toContain(codigo);
  });

  test.each([
    ['falta un permiso de los de siempre (observaciones)', COLS_ACTUALES.filter((c) => c !== 'observaciones'), 'ESQUEMA_ACTUAL_INCOMPLETO'],
    ['falta la columna estado', COLS_ACTUALES.filter((c) => c !== 'estado'), 'FALTA_COLUMNA'],
    ['una columna repetida', COLS_ACTUALES.concat(['perfil']), 'COLUMNA_REPETIDA']
  ])('bloqueo de esquema: %s -> %s', (_n, header, codigo) => {
    entorno({ header });
    expect(planDe(tabla()).bloqueos.map((b) => b.codigo)).toContain(codigo);
  });

  test('hoja sin usuarios: SIN_USUARIOS', () => {
    entorno({ usuarios: [] });
    expect(planDe(tabla()).bloqueos.map((b) => b.codigo)).toContain('SIN_USUARIOS');
  });

  test('el plan NUNCA incluye una escritura sobre una columna existente con valor: solo columnas nuevas y celdas vacias', () => {
    const p = planDe(tabla());
    expect(p.celdasPorCompletar).toEqual([]);
    expect(p.columnasPorAgregar.every((c) => COLS_ACTUALES.indexOf(c) < 0)).toBe(true);
  });
});

describe('migracionE10Planificar (solo lectura)', () => {
  test('informa el plan sin escribir NADA (ni hojas, ni respaldo, ni eventos, ni propiedades)', () => {
    const antes = JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)]);
    const props = JSON.stringify(global.__propiedades);
    const r = global.migracionE10Planificar();
    expect(r).toMatchObject({ ok: true, soloLectura: true, yaAplicada: false, resumen: { usuarios: 11, internos: 9, externos: 2, admins: 2, mapaSI: 11 } });
    expect(JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)])).toBe(antes);
    expect(JSON.stringify(global.__propiedades)).toBe(props);
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
  });

  test('sin parametros: ok=false, bloqueo PARAMETROS_AUSENTES y una plantilla para completar (sin emails)', () => {
    delete global.__propiedades.E10_MIGRACION_PARAMETROS;
    const r = global.migracionE10Planificar();
    expect(r.ok).toBe(false);
    expect(r.bloqueos.map((b) => b.codigo)).toContain('PARAMETROS_AUSENTES');
    expect(r.plantillaParametros).toEqual({ admins: ['<email de cada administrador inicial>'], externos: ['<email de cada usuario externo>'] });
    expect(r.parametrosEnPropiedad).toBe('E10_MIGRACION_PARAMETROS');
    expect(JSON.stringify(r)).not.toMatch(/federico@|gualde@/);
  });

  test('no filtra datos sensibles: ningun email completo en la salida', () => {
    const salida = JSON.stringify(global.migracionE10Planificar());
    expect(salida).not.toMatch(/@test\.local(?!")/);
    U.forEach((u) => expect(salida).not.toContain(u.email));
  });

  test('sin la hoja Usuarios: ok=false sin lanzar', () => {
    delete E.hojas.Usuarios;
    expect(global.migracionE10Planificar()).toMatchObject({ ok: false });
  });
});

describe('migracionE10Ejecutar', () => {
  test('migra: 25 columnas, 11 mapas SI, 2 administradores, 9 INTERNO y 2 EXTERNO, version 1, actualizado_por institucional', () => {
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: true, ejecutada: true, eventos: 11 });
    const t = tabla();
    expect(t.header).toHaveLength(25);
    expect(t.header.slice(19)).toEqual(['tipo', 'version', 'actualizado_utc', 'actualizado_por', 'usuarios_admin', 'mapa']);
    const col = (c) => t.filas.map((f) => f[t.header.indexOf(c)]);
    expect(col('mapa')).toEqual(new Array(11).fill('SI'));
    expect(col('version')).toEqual(new Array(11).fill(1));
    expect(col('actualizado_por')).toEqual(new Array(11).fill('migracion:E10-1'));
    expect(new Set(col('actualizado_utc')).size).toBe(1);
    expect(col('actualizado_utc')[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(col('tipo').filter((x) => x === 'INTERNO')).toHaveLength(9);
    expect(col('tipo').filter((x) => x === 'EXTERNO')).toHaveLength(2);
    expect(col('usuarios_admin').filter((x) => x === 'SI')).toHaveLength(2);
    expect(celda('federico@test.local', 'usuarios_admin')).toBe('SI');
    expect(celda('mariana@test.local', 'usuarios_admin')).toBe('SI');
    expect(celda('perfiles@test.local', 'usuarios_admin')).toBe('NO');
    expect(celda('gualde@test.local', 'tipo')).toBe('EXTERNO');
    expect(celda('dietrich@test.local', 'tipo')).toBe('EXTERNO');
    expect(celda('gualde@test.local', 'usuarios_admin')).toBe('NO');
  });

  test('NINGUN permiso ni dato existente cambia: las 19 columnas originales quedan celda por celda iguales', () => {
    const antes = copiaHoja();
    global.migracionE10Ejecutar();
    const despues = E.hojas.Usuarios.filas;
    antes.forEach((fila, i) => { expect(despues[i].slice(0, 19)).toEqual(fila); });
  });

  test('los 2 externos conservan EXACTAMENTE sus permisos actuales (en la hoja y en el login), y su acceso funcional no cambia', () => {
    const antesGualde = global.sheetUserRepository_getUserStatus('gualde@test.local');
    const antesDietrich = global.sheetUserRepository_getUserStatus('dietrich@test.local');
    global.migracionE10Ejecutar();
    E.cache.estado.store = {};
    ['gualde@test.local', 'dietrich@test.local'].forEach((email, i) => {
      const antes = [antesGualde, antesDietrich][i];
      const despues = global.sheetUserRepository_getUserStatus(email);
      expect(despues.tipo).toBe('EXTERNO');
      expect(despues.active).toBe(true);
      Object.keys(antes.permisos).filter((id) => ['mapa', 'usuarios_admin'].indexOf(id) < 0).forEach((id) => { expect(despues.permisos[id]).toBe(antes.permisos[id]); });          // los 15 permisos que ya existian: identicos (mapa se suma, usuarios_admin sigue en NO)
      const acceso = global.getUserAccess(email);
      expect(acceso.active).toBe(true);
      global.permisosCatalogo_aLista(antes.permisos).forEach((id) => expect(acceso.permisos[id]).toBe(true));
      expect(acceso.permisos.usuarios_admin).toBe(false);
    });
    expect(global.permisosCatalogo_aLista(global.getUserAccess('gualde@test.local').permisos)).toEqual(['perfil', 'perfil_subir', 'datos', 'ubicacion', 'ubicacion_corregir', 'mapa', 'ne', 'fotos', 'fotos_carga', 'observaciones', 'observaciones_agregar'].sort((a, b) => global.permisosCatalogo_ids().indexOf(a) - global.permisosCatalogo_ids().indexOf(b)));
  });

  test('los usuarios que hoy usan el mapa lo conservan: los 11 quedan con mapa efectivo', () => {
    global.migracionE10Ejecutar();
    E.cache.estado.store = {};
    U.forEach((u) => { expect(global.hasPermission(u.email, 'mapa')).toBe(true); });
  });

  test('queda un respaldo con el contenido ORIGINAL de la hoja, con nombre con marca de tiempo', () => {
    const antes = copiaHoja();
    const r = global.migracionE10Ejecutar();
    expect(hojasDeRespaldo()).toEqual([r.respaldo]);
    expect(r.respaldo).toMatch(/^Usuarios_backup_E10-1_\d{8}T\d{9}Z$/);
    expect(E.hojas[r.respaldo].filas).toEqual(antes);
  });

  test('un evento USUARIO_MIGRADO por usuario: version 0 -> 1, tipo nuevo, permisos antes y despues (mapa y usuarios_admin se agregan)', () => {
    global.migracionE10Ejecutar();
    const ev = eventos();
    expect(ev).toHaveLength(11);
    expect(ev.every((e) => e.evento === 'USUARIO_MIGRADO' && e.origen === 'MIGRACION' && e.ejecutadoPor === 'migracion:E10-1' && e.versionAnterior === 0 && e.versionNueva === 1)).toBe(true);
    expect(ev.map((e) => e.secuencia)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const fede = ev.find((e) => e.usuarioObjetivo === 'federico@test.local');
    expect(fede).toMatchObject({ tipoAnterior: '', tipoNuevo: 'INTERNO', estadoAnterior: 'activo', estadoNuevo: 'activo' });
    expect(fede.permisosDespues.split(',')).toEqual(expect.arrayContaining(['mapa', 'usuarios_admin']));
    expect(fede.permisosAntes.split(',')).not.toContain('mapa');
    const gualde = ev.find((e) => e.usuarioObjetivo === 'gualde@test.local');
    expect(gualde.tipoNuevo).toBe('EXTERNO');
    expect(gualde.permisosDespues.split(',').filter((p) => p !== 'mapa').join(',')).toBe(gualde.permisosAntes);        // lo unico que se suma es mapa
    expect(gualde.permisosDespues.split(',')).not.toContain('usuarios_admin');
    expect(gualde.motivo).toMatch(/^respaldo: Usuarios_backup_E10-1_/);
  });

  test('IDEMPOTENTE: una segunda corrida no escribe nada (ni columnas, ni respaldo nuevo, ni eventos)', () => {
    global.migracionE10Ejecutar();
    const hoja = JSON.stringify(E.hojas.Usuarios.filas);
    const hojas = Object.keys(E.hojas).length;
    const evs = E.hojas.UsuariosEventos.filas.length;
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ejecutada: false, yaAplicada: true });
    expect(r.motivo).toMatch(/YA_APLICADA/);
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(hoja);
    expect(Object.keys(E.hojas)).toHaveLength(hojas);
    expect(E.hojas.UsuariosEventos.filas).toHaveLength(evs);
  });

  test('completa una migracion PARCIAL: columnas ya presentes pero con celdas vacias se llenan; las que ya tenian valor correcto no se tocan', () => {
    global.migracionE10Ejecutar();
    const t = tabla();
    const iMapa = t.header.indexOf('mapa');
    E.hojas.Usuarios.filas[3][iMapa] = '';                                     // alguien vacio una celda
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: true, ejecutada: true });
    expect(E.hojas.Usuarios.filas[3][iMapa]).toBe('SI');
    const despues = E.hojas.Usuarios.filas;
    JSON.parse(antes).forEach((f, i) => { if (i !== 3) { expect(despues[i]).toEqual(f); } });
  });

  test('un CONFLICTO (un valor que no coincide con el plan, p. ej. mapa = NO para un activo) corta TODO: no escribe nada', () => {
    global.migracionE10Ejecutar();
    const t = tabla();
    E.hojas.Usuarios.filas[2][t.header.indexOf('mapa')] = 'NO';
    const antes = JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)]);
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: false, ejecutada: false });
    expect(r.conflictos).toEqual([expect.objectContaining({ columna: 'mapa', actual: 'no', esperado: 'SI' })]);
    expect(JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)])).toBe(antes);
  });

  test('con el plan en rojo (parametros ausentes) no escribe NADA: ni respaldo, ni columnas, ni eventos', () => {
    delete global.__propiedades.E10_MIGRACION_PARAMETROS;
    const antes = JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)]);
    expect(global.migracionE10Ejecutar()).toMatchObject({ ok: false, ejecutada: false });
    expect(JSON.stringify([E.hojas.Usuarios.filas, E.hojas.UsuariosEventos.filas, Object.keys(E.hojas)])).toBe(antes);
  });

  test('sin la hoja UsuariosEventos: no migra, no crea respaldo y la hoja queda intacta (la auditoria tiene que existir antes)', () => {
    entorno({ eventos: false });
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: false, ejecutada: false });
    expect(r.error).toMatch(/AUDITORIA_NO_DISPONIBLE/);
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antes);
    expect(hojasDeRespaldo()).toEqual([]);
  });

  test('si falla DESPUES de escribir las columnas (no se puede escribir el evento) se REVIERTE: la hoja vuelve a las 19 columnas originales y el respaldo queda', () => {
    const original = copiaHoja();
    const orig = E.hojas.UsuariosEventos.getRange.bind(E.hojas.UsuariosEventos);
    E.hojas.UsuariosEventos.getRange = (fila, ...r) => { const x = orig(fila, ...r); if (fila > 1) { x.setValues = () => { throw new Error('Sheets caido'); }; } return x; };
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: false, ejecutada: false, revertido: true });
    expect(E.hojas.Usuarios.filas).toEqual(original);
    expect(hojasDeRespaldo()).toHaveLength(1);
    expect(E.hojas.UsuariosEventos.filas).toHaveLength(1);
  });

  test('si falla al agregar las columnas, queda el respaldo y la hoja original intacta', () => {
    const original = copiaHoja();
    const orig = E.hojas.Usuarios.getRange.bind(E.hojas.Usuarios);
    E.hojas.Usuarios.getRange = (fila, col, ...r) => { const x = orig(fila, col, ...r); if (col > 19) { x.setValues = () => { throw new Error('fallo'); }; } return x; };
    const r = global.migracionE10Ejecutar();
    expect(r).toMatchObject({ ok: false, ejecutada: false });
    expect(E.hojas.Usuarios.filas).toEqual(original);
  });

  test('agranda la grilla ANTES de escribir si la hoja no tiene columnas libres (hoja de exactamente 19 columnas)', () => {
    E.hojas.Usuarios.columnasFisicas = 19;
    E.hojas.Usuarios.estricta = true;
    expect(global.migracionE10Ejecutar()).toMatchObject({ ok: true, ejecutada: true });
    expect(tabla().header).toHaveLength(25);
  });

  test('toma el script lock y lo libera; y escribe SOLO el respaldo, las columnas nuevas y los eventos (ni propiedades, ni cache, ni Telegram, ni mail)', () => {
    const lock = { waitLock: jest.fn(), releaseLock: jest.fn() };
    global.LockService = { getScriptLock: () => lock };
    const props = JSON.stringify(global.__propiedades);
    const cache = JSON.stringify(E.cache.estado.store);
    global.MailApp = { sendEmail: jest.fn() };
    global.migracionE10Ejecutar();
    expect(lock.waitLock).toHaveBeenCalledTimes(1);
    expect(lock.releaseLock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(global.__propiedades)).toBe(props);
    expect(JSON.stringify(E.cache.estado.store)).toBe(cache);
    expect(global.MailApp.sendEmail).not.toHaveBeenCalled();
    expect(global.telegramRepository_sendMessage).not.toHaveBeenCalled();
    expect(global.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });

  test('no crea usuarios nuevos, no cambia flags y no activa nada', () => {
    global.migracionE10Ejecutar();
    expect(tabla().filas).toHaveLength(11);
    expect(global.e10Flags_adminUsuariosActivo()).toBe(false);
    expect(global.e10Flags_gestionExternosActivo()).toBe(false);
  });

  test('despues de migrar, los dos administradores iniciales son administradores efectivos y los externos no', () => {
    global.migracionE10Ejecutar();
    E.cache.estado.store = {};
    expect(global.hasPermission('federico@test.local', 'usuarios_admin')).toBe(true);
    expect(global.hasPermission('mariana@test.local', 'usuarios_admin')).toBe(true);
    ['perfiles@test.local', 'gualde@test.local', 'dietrich@test.local', 'persona6@test.local'].forEach((e) => expect(global.hasPermission(e, 'usuarios_admin')).toBe(false));
  });
});

describe('respaldo: nunca pisa otro', () => {
  test('si ya existe una hoja con el nombre elegido, agrega un sufijo (_2, _3...) y conserva la anterior', () => {
    const base = 'Usuarios_backup_E10-1_20261105T153000000Z';
    expect(M.migracionE10_crearRespaldoUnico(base)).toBe(base);
    expect(M.migracionE10_crearRespaldoUnico(base)).toBe(base + '_2');
    expect(M.migracionE10_crearRespaldoUnico(base)).toBe(base + '_3');
    [base, base + '_2', base + '_3'].forEach((n) => expect(E.hojas[n].filas).toEqual(E.hojas.Usuarios.filas));
  });

  test('un error que no es de nombre repetido se propaga (no se reintenta en silencio)', () => {
    delete E.hojas.Usuarios;
    expect(() => M.migracionE10_crearRespaldoUnico('Usuarios_backup_E10-1_x')).toThrow(/USUARIOS_NO_EXISTE/);
  });

  test('migrar, revertir y volver a migrar en el mismo instante no choca con el respaldo anterior', () => {
    const real = Date.prototype.toISOString;
    Date.prototype.toISOString = () => '2026-11-05T15:30:00.000Z';
    try {
      global.migracionE10Ejecutar();
      global.migracionE10Revertir();
      expect(global.migracionE10Ejecutar()).toMatchObject({ ok: true, ejecutada: true });
    } finally {
      Date.prototype.toISOString = real;
    }
    expect(hojasDeRespaldo().length).toBe(2);
  });
});

describe('migracionE10Revertir (rollback)', () => {
  test('quita SOLO las 6 columnas de la migracion: la hoja vuelve exactamente a como estaba', () => {
    const original = copiaHoja();
    global.migracionE10Ejecutar();
    const r = global.migracionE10Revertir();
    expect(r).toMatchObject({ ok: true, revertida: true, columnasQuitadas: 6, eventos: 11 });
    expect(E.hojas.Usuarios.filas).toEqual(original);
  });

  test('deja un evento USUARIO_MIGRACION_REVERTIDA por usuario (el historial no se borra)', () => {
    global.migracionE10Ejecutar();
    global.migracionE10Revertir();
    const ev = eventos();
    expect(ev).toHaveLength(22);
    expect(ev.slice(11).every((e) => e.evento === 'USUARIO_MIGRACION_REVERTIDA' && e.origen === 'MIGRACION')).toBe(true);
    expect(ev.slice(11).map((e) => e.secuencia)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]);
  });

  test('el respaldo permanece', () => {
    const r = global.migracionE10Ejecutar();
    global.migracionE10Revertir();
    expect(E.hojas[r.respaldo]).toBeDefined();
  });

  test('se puede volver a migrar despues de revertir', () => {
    global.migracionE10Ejecutar();
    global.migracionE10Revertir();
    expect(global.migracionE10Ejecutar()).toMatchObject({ ok: true, ejecutada: true });
    expect(tabla().header).toHaveLength(25);
  });

  test('sin las columnas de la migracion: NADA_QUE_REVERTIR (idempotente)', () => {
    const r = global.migracionE10Revertir();
    expect(r).toMatchObject({ ok: false, revertida: false, motivos: ['NADA_QUE_REVERTIR'] });
  });

  test('se NIEGA si ya hubo operaciones administrativas (revertir borraria version/tipo que ya se usan)', () => {
    global.migracionE10Ejecutar();
    global.__propiedades.E10_ADMIN_USUARIOS_ACTIVO = 'SI';
    const r = global.usuariosAdmin_actualizar({ email: 'federico@test.local', nombre: 'F' }, { email: 'persona6@test.local', versionEsperada: 1, nombre: 'Persona Seis' });
    expect(r.ok).toBe(true);
    const antes = JSON.stringify(E.hojas.Usuarios.filas);
    const rev = global.migracionE10Revertir();
    expect(rev).toMatchObject({ ok: false, revertida: false });
    expect(rev.motivos).toContain('HAY_OPERACIONES_ADMINISTRATIVAS');
    expect(JSON.stringify(E.hojas.Usuarios.filas)).toBe(antes);
  });

  test('se NIEGA si alguien modifico las columnas migradas (version distinta de 1 o actualizado_por distinto)', () => {
    global.migracionE10Ejecutar();
    const t = tabla();
    E.hojas.Usuarios.filas[2][t.header.indexOf('version')] = 5;
    expect(global.migracionE10Revertir()).toMatchObject({ ok: false, motivos: ['COLUMNAS_MODIFICADAS_DESPUES_DE_MIGRAR'] });
    expect(tabla().header).toHaveLength(25);
  });

  test('sin la hoja de eventos: no revierte nada', () => {
    global.migracionE10Ejecutar();
    delete E.hojas.UsuariosEventos;
    const r = global.migracionE10Revertir();
    expect(r).toMatchObject({ ok: false, revertida: false });
    expect(tabla().header).toHaveLength(25);
  });
});

describe('compatibilidad de la hoja migrada con el codigo actual (v48 ignora las columnas nuevas)', () => {
  test('el parser de v48 (que no conoce las columnas nuevas) lee exactamente los mismos permisos de siempre en la hoja migrada', () => {
    const antes = U.map((u) => global.sheetUserRepository_getUserStatus(u.email));
    global.migracionE10Ejecutar();
    U.forEach((u, i) => {
      const d = global.sheetUserRepository_getUserStatus(u.email);
      expect(d.active).toBe(antes[i].active);
      Object.keys(antes[i].permisos).filter((id) => ['mapa', 'usuarios_admin'].indexOf(id) < 0).forEach((id) => expect(d.permisos[id]).toBe(antes[i].permisos[id]));
    });
  });

  test('la migracion no escribe ningun permiso con valor distinto de SI / NO (los nuevos son SI o NO explicitos)', () => {
    global.migracionE10Ejecutar();
    const t = tabla();
    ['usuarios_admin', 'mapa'].forEach((c) => t.filas.forEach((f) => { expect(['SI', 'NO']).toContain(f[t.header.indexOf(c)]); }));
  });
});

describe('sin ninguna columna E10 previa y con una hoja de 25 columnas ya completa', () => {
  test('una hoja ya migrada a mano con todos los valores correctos se reconoce como YA_APLICADA', () => {
    entorno({ header: COLS_E10, usuarios: U.map((u) => Object.assign({}, u, { tipo: ['gualde@test.local', 'dietrich@test.local'].indexOf(u.email) >= 0 ? 'EXTERNO' : 'INTERNO', permisos: u.permisos.concat(['mapa']).concat(['federico@test.local', 'mariana@test.local'].indexOf(u.email) >= 0 ? ['usuarios_admin'] : []) })) });
    expect(global.migracionE10Planificar()).toMatchObject({ ok: true, yaAplicada: true });
    expect(global.migracionE10Ejecutar()).toMatchObject({ ejecutada: false, yaAplicada: true });
  });
});
