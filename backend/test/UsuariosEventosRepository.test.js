// E10-1: hoja UsuariosEventos (append-only, esquema fijo). Hojas falsas en memoria: nada toca Google.
const { crearEntornoE10 } = require('./e10Entorno');

let E;
beforeEach(() => { E = crearEntornoE10(); });

const evento = (extra) => Object.assign({ evento: 'USUARIO_CREADO', usuarioObjetivo: 'a@x.com', nombreObjetivo: 'Ana', nombreAnterior: '', ejecutadoPor: 'admin1@x.com', tipoAnterior: '', tipoNuevo: 'INTERNO', estadoAnterior: '', estadoNuevo: 'activo', versionAnterior: 0, versionNueva: 1, permisosAntes: '', permisosDespues: 'perfil', motivo: '', clientRequestId: '', origen: 'APP' }, extra || {});

describe('esquema', () => {
  test('19 columnas con los campos pedidos (+ nombreAnterior, justificado: auditar renombres)', () => {
    const c = E.Eventos.USUARIOS_EVENTOS_COLUMNAS;
    expect(c).toHaveLength(19);
    ['eventoId', 'secuencia', 'evento', 'usuarioObjetivo', 'nombreObjetivo', 'ejecutadoPor', 'timestampUtc', 'tipoAnterior', 'tipoNuevo', 'estadoAnterior', 'estadoNuevo', 'versionAnterior', 'versionNueva', 'permisosAntes', 'permisosDespues', 'motivo', 'clientRequestId', 'origen'].forEach((k) => expect(c).toContain(k));
    expect(c).toContain('nombreAnterior');
    expect(new Set(c).size).toBe(19);
  });

  test('planEsquema: ok; faltante; repetida; encabezado en cualquier orden y con mayusculas', () => {
    const cols = E.Eventos.USUARIOS_EVENTOS_COLUMNAS;
    expect(E.Eventos.usuariosEventosRepository_planEsquema(cols)).toEqual({ ok: true, faltantes: [], repetidas: [] });
    expect(E.Eventos.usuariosEventosRepository_planEsquema(cols.slice().reverse().map((c) => ' ' + c.toUpperCase() + ' ')).ok).toBe(true);
    expect(E.Eventos.usuariosEventosRepository_planEsquema(cols.filter((c) => c !== 'origen'))).toMatchObject({ ok: false, faltantes: ['origen'] });
    expect(E.Eventos.usuariosEventosRepository_planEsquema(cols.concat(['motivo']))).toMatchObject({ ok: false, repetidas: ['motivo'] });
    expect(E.Eventos.usuariosEventosRepository_planEsquema([])).toMatchObject({ ok: false });
    expect(E.Eventos.usuariosEventosRepository_planEsquema(null)).toMatchObject({ ok: false });
  });

  test('la hoja no contiene ninguna columna que parezca un secreto', () => {
    expect(E.Eventos.USUARIOS_EVENTOS_COLUMNAS.join(' ')).not.toMatch(/token|secret|password|clave|idtoken/i);
  });
});

describe('abrir: fail-closed y nunca crea la hoja', () => {
  test('sin hoja -> AUDITORIA_NO_DISPONIBLE y NO se crea', () => {
    const e2 = crearEntornoE10({ eventos: false });
    expect(() => e2.Eventos.usuariosEventosRepository_abrir()).toThrow(/AUDITORIA_NO_DISPONIBLE/);
    expect(e2.hojas.UsuariosEventos).toBeUndefined();
  });

  test('hoja vacia o con esquema inesperado -> AUDITORIA_NO_DISPONIBLE', () => {
    const vacia = crearEntornoE10();
    vacia.hojas.UsuariosEventos.filas = [];
    expect(() => vacia.Eventos.usuariosEventosRepository_abrir()).toThrow(/sin encabezado|AUDITORIA_NO_DISPONIBLE/);
    const rota = crearEntornoE10();
    rota.hojas.UsuariosEventos.filas = [['a', 'b']];
    expect(() => rota.Eventos.usuariosEventosRepository_abrir()).toThrow(/esquema esperado/);
  });
});

describe('agregar (append-only, una sola escritura, secuencia bajo lock)', () => {
  test('escribe eventoId UUID, secuencia correlativa, timestamp ISO UTC y ejecutadoPor', () => {
    const h = E.Eventos.usuariosEventosRepository_abrir();
    const escritos = E.Eventos.usuariosEventosRepository_agregar(h, [evento(), evento({ evento: 'PERMISOS_MODIFICADOS' })], 0, 'admin1@x.com');
    expect(escritos.map((e) => e.secuencia)).toEqual([1, 2]);
    const filas = E.hojas.UsuariosEventos.filas;
    expect(filas).toHaveLength(3);
    const leidos = E.Eventos.usuariosEventosRepository_leer(E.Eventos.usuariosEventosRepository_abrir());
    expect(leidos.map((e) => e.evento)).toEqual(['USUARIO_CREADO', 'PERMISOS_MODIFICADOS']);
    expect(leidos[0].eventoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(leidos[0].timestampUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(leidos[1].secuencia).toBe(2);
    expect(E.Eventos.usuariosEventosRepository_ultimaSecuencia(leidos)).toBe(2);
  });

  test('las filas nuevas SE AGREGAN al final: las existentes nunca se tocan', () => {
    const h = E.Eventos.usuariosEventosRepository_abrir();
    E.Eventos.usuariosEventosRepository_agregar(h, [evento()], 0, 'admin1@x.com');
    const antes = JSON.stringify(E.hojas.UsuariosEventos.filas);
    E.Eventos.usuariosEventosRepository_agregar(E.Eventos.usuariosEventosRepository_abrir(), [evento({ usuarioObjetivo: 'b@x.com' })], 1, 'admin1@x.com');
    const despues = E.hojas.UsuariosEventos.filas;
    expect(JSON.stringify(despues.slice(0, 2))).toBe(antes);
    expect(despues).toHaveLength(3);
  });

  test('UNA sola escritura para todo el grupo (nunca queda un grupo a medias) y un evento invalido aborta ANTES de escribir nada', () => {
    const h = E.Eventos.usuariosEventosRepository_abrir();
    const original = E.hojas.UsuariosEventos.getRange.bind(E.hojas.UsuariosEventos);
    let escrituras = 0;
    E.hojas.UsuariosEventos.getRange = (...a) => { const r = original(...a); const sv = r.setValues; r.setValues = (v) => { escrituras += 1; return sv(v); }; return r; };
    E.Eventos.usuariosEventosRepository_agregar(h, [evento(), evento(), evento()], 0, 'admin1@x.com');
    expect(escrituras).toBe(1);
    escrituras = 0;
    expect(() => E.Eventos.usuariosEventosRepository_agregar(h, [evento(), evento({ evento: 'INVENTADO' })], 3, 'admin1@x.com')).toThrow(/AUDITORIA_EVENTO_INVALIDO/);
    expect(escrituras).toBe(0);
    expect(E.hojas.UsuariosEventos.filas).toHaveLength(4);
  });

  test.each([
    ['evento desconocido', { evento: 'BORRADO' }],
    ['origen invalido', { origen: 'MANUAL' }],
    ['sin usuario objetivo', { usuarioObjetivo: '' }]
  ])('un evento invalido (%s) se rechaza', (_n, extra) => {
    expect(E.Eventos.usuariosEventosRepository_validarEvento(evento(extra)).ok).toBe(false);
    expect(E.Eventos.usuariosEventosRepository_validarEvento(evento()).ok).toBe(true);
  });

  test('un motivo que empieza con "=" se guarda como texto (formato de texto plano), nunca como formula', () => {
    const h = E.Eventos.usuariosEventosRepository_abrir();
    E.Eventos.usuariosEventosRepository_agregar(h, [evento({ motivo: '=1+1' })], 0, 'admin1@x.com');
    const col = h.indices.motivo + 1;
    expect(E.hojas.UsuariosEventos.formatos['2:' + col]).toBe('@');
    expect(E.hojas.UsuariosEventos.formatos['2:' + (h.indices.secuencia + 1)]).toBe('0');
  });

  test('buscarPorClientRequestId devuelve el ultimo evento de ESE usuario con ese id', () => {
    const lista = [{ usuarioObjetivo: 'a@x.com', clientRequestId: 'r1', secuencia: 1 }, { usuarioObjetivo: 'b@x.com', clientRequestId: 'r1', secuencia: 2 }, { usuarioObjetivo: 'a@x.com', clientRequestId: 'r1', secuencia: 3 }];
    expect(E.Eventos.usuariosEventosRepository_buscarPorClientRequestId(lista, 'a@x.com', 'r1').secuencia).toBe(3);
    expect(E.Eventos.usuariosEventosRepository_buscarPorClientRequestId(lista, 'c@x.com', 'r1')).toBeNull();
    expect(E.Eventos.usuariosEventosRepository_buscarPorClientRequestId(lista, 'a@x.com', '')).toBeNull();
  });
});

describe('setupUsuariosEventosSheet (manual, idempotente)', () => {
  test('crea la hoja con el esquema; una segunda corrida no cambia nada', () => {
    const e2 = crearEntornoE10({ eventos: false });
    expect(e2.Eventos.setupUsuariosEventosSheet()).toEqual({ creada: true });
    expect(e2.hojas.UsuariosEventos).toBeDefined();
    const abierta = e2.Eventos.usuariosEventosRepository_abrir();
    expect(e2.Eventos.usuariosEventosRepository_planEsquema(abierta.sheet.filas[0]).ok).toBe(true);
    const antes = JSON.stringify(abierta.sheet.filas);
    expect(e2.Eventos.setupUsuariosEventosSheet()).toEqual({ creada: false, motivo: 'YA_EXISTE' });
    expect(JSON.stringify(e2.Eventos.usuariosEventosRepository_abrir().sheet.filas)).toBe(antes);
  });

  test('una hoja existente vacia o con esquema inesperado no se toca', () => {
    const rota = crearEntornoE10();
    rota.hojas.UsuariosEventos.filas = [['otra', 'cosa'], ['x', 'y']];
    expect(() => rota.Eventos.setupUsuariosEventosSheet()).toThrow(/esquema inesperado/);
    expect(rota.hojas.UsuariosEventos.filas).toEqual([['otra', 'cosa'], ['x', 'y']]);
    const vacia = crearEntornoE10();
    vacia.hojas.UsuariosEventos.filas = [];
    expect(() => vacia.Eventos.setupUsuariosEventosSheet()).toThrow(/vacia/);
  });
});
