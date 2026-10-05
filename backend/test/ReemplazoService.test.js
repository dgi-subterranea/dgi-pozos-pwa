const { installAppsScriptFakes } = require('./appsScriptFakes');

installAppsScriptFakes();

const {
  REEMPLAZO_ESTADOS,
  REEMPLAZO_MOTIVOS,
  reemplazoService_validarEvaluacion,
  reemplazoService_ordenarDescendente,
  reemplazoService_calcularEstado,
  reemplazoService_getEstado,
  reemplazoService_getHistorial,
  reemplazoService_registrar
} = require('../src/ReemplazoService');

function ev(timestamp, estado, extra) {
  return Object.assign({
    timestamp, evaluacionId: 'id-' + timestamp, wellId: '04-0263', email: 'a@x.com', nombre: 'Ana',
    estado, motivo: '', observacion: '', puntoNEReferencia: ''
  }, extra || {});
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('catalogos', () => {
  test('estados y motivos tal como se definieron (SIN_EVALUAR no es un estado escribible)', () => {
    expect(REEMPLAZO_ESTADOS).toEqual(['APTO', 'NO_APTO', 'DUDOSO']);
    expect(REEMPLAZO_MOTIVOS).toEqual([
      'SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'POZO_CEGADO', 'POZO_OBSTRUIDO',
      'INSTALACION_IMPIDE_MEDICION', 'SECO', 'CONDICION_INSEGURA', 'NO_REPRESENTATIVO', 'APTO_SIN_OBSERVACIONES', 'OTRO'
    ]);
  });
});

describe('reemplazoService_validarEvaluacion', () => {
  test('estado invalido (incluido SIN_EVALUAR, minusculas, vacio, no string)', () => {
    ['SIN_EVALUAR', 'apto', '', null, undefined, 5].forEach((e) => {
      const r = reemplazoService_validarEvaluacion(e, 'SECO', '', '');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('INVALID_ESTADO');
    });
  });

  test('motivo fuera del catalogo', () => {
    const r = reemplazoService_validarEvaluacion('NO_APTO', 'INVENTADO', '', '');
    expect(r).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
  });

  test('motivo con tipo invalido', () => {
    expect(reemplazoService_validarEvaluacion('NO_APTO', 5, '', '').code).toBe('INVALID_MOTIVO');
  });

  test('NO_APTO y DUDOSO requieren motivo', () => {
    expect(reemplazoService_validarEvaluacion('NO_APTO', '', '', '').code).toBe('MOTIVO_REQUERIDO');
    expect(reemplazoService_validarEvaluacion('DUDOSO', null, '', '').code).toBe('MOTIVO_REQUERIDO');
  });

  test('OTRO sin observacion (o solo espacios) se rechaza; con observacion se acepta', () => {
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'OTRO', '', '').code).toBe('OBSERVACION_REQUERIDA');
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'OTRO', '   ', '').code).toBe('OBSERVACION_REQUERIDA');
    expect(reemplazoService_validarEvaluacion('APTO', 'OTRO', undefined, '').code).toBe('OBSERVACION_REQUERIDA');
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'OTRO', 'detalle', '').ok).toBe(true);
  });

  test('APTO: sin motivo, con APTO_SIN_OBSERVACIONES u OTRO(+obs) es valido', () => {
    expect(reemplazoService_validarEvaluacion('APTO', '', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('APTO', undefined, undefined, undefined).ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('APTO', 'APTO_SIN_OBSERVACIONES', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('APTO', 'OTRO', 'ok', '').ok).toBe(true);
  });

  test('contradiccion semantica: APTO con motivo negativo; NO_APTO/DUDOSO con APTO_SIN_OBSERVACIONES', () => {
    ['SIN_ACCESO', 'SECO', 'POZO_CEGADO', 'CONDICION_INSEGURA'].forEach((m) => {
      expect(reemplazoService_validarEvaluacion('APTO', m, '', '').code).toBe('ESTADO_MOTIVO_INCOMPATIBLE');
    });
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'APTO_SIN_OBSERVACIONES', '', '').code).toBe('ESTADO_MOTIVO_INCOMPATIBLE');
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'APTO_SIN_OBSERVACIONES', '', '').code).toBe('ESTADO_MOTIVO_INCOMPATIBLE');
  });

  test('DUDOSO rechaza los motivos fisicamente concluyentes (cegado, obstruido, seco, condicion insegura)', () => {
    ['POZO_CEGADO', 'POZO_OBSTRUIDO', 'SECO', 'CONDICION_INSEGURA'].forEach((m) => {
      const r = reemplazoService_validarEvaluacion('DUDOSO', m, '', '');
      expect(r).toMatchObject({ ok: false, code: 'ESTADO_MOTIVO_INCOMPATIBLE' });
    });
  });

  test('DUDOSO acepta los motivos que dejan la duda abierta (OTRO exige observacion)', () => {
    ['SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'INSTALACION_IMPIDE_MEDICION', 'NO_REPRESENTATIVO'].forEach((m) => {
      expect(reemplazoService_validarEvaluacion('DUDOSO', m, '', '').ok).toBe(true);
    });
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'OTRO', 'detalle', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'OTRO', '', '').code).toBe('OBSERVACION_REQUERIDA');
  });

  test('NO_APTO acepta todos los motivos negativos del catalogo (incluidos los concluyentes), con OTRO + observacion', () => {
    REEMPLAZO_MOTIVOS.filter((m) => m !== 'APTO_SIN_OBSERVACIONES' && m !== 'OTRO').forEach((m) => {
      expect(reemplazoService_validarEvaluacion('NO_APTO', m, '', '').ok).toBe(true);
    });
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'POZO_CEGADO', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SIN_ACCESO', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'OTRO', 'x', '').ok).toBe(true);
  });

  test('el estado nunca se infiere del motivo: la tabla estado/motivo decide', () => {
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SIN_ACCESO', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'SIN_ACCESO', '', '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('DUDOSO', 'SECO', '', '').ok).toBe(false);
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SECO', '', '').ok).toBe(true);
  });

  test('observacion: se recorta, tope de 1000 caracteres, tipo invalido', () => {
    const r = reemplazoService_validarEvaluacion('NO_APTO', 'SECO', '  hola  ', '');
    expect(r.valores.observacion).toBe('hola');
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SECO', 'x'.repeat(1001), '').code).toBe('INVALID_OBSERVACION');
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SECO', 'x'.repeat(1000), '').ok).toBe(true);
    expect(reemplazoService_validarEvaluacion('NO_APTO', 'SECO', { a: 1 }, '').code).toBe('INVALID_OBSERVACION');
  });

  test('puntoNEReferencia: opcional; acepta wellId y monitoringId especiales; rechaza basura', () => {
    expect(reemplazoService_validarEvaluacion('APTO', '', '', '').valores.puntoNEReferencia).toBe('');
    expect(reemplazoService_validarEvaluacion('APTO', '', '', null).valores.puntoNEReferencia).toBe('');
    expect(reemplazoService_validarEvaluacion('APTO', '', '', '04-0263').valores.puntoNEReferencia).toBe('04-0263');
    expect(reemplazoService_validarEvaluacion('APTO', '', '', ' INA 2055 ').valores.puntoNEReferencia).toBe('INA 2055');
    expect(reemplazoService_validarEvaluacion('APTO', '', '', '6 RTR7').ok).toBe(true);
    ['=HYPERLINK("x")', '<script>', 'a'.repeat(41), '-04-0263', 5].forEach((p) => {
      expect(reemplazoService_validarEvaluacion('APTO', '', '', p).code).toBe('INVALID_PUNTO_NE');
    });
  });
});

describe('estado actual e historial', () => {
  test('sin evaluaciones -> SIN_EVALUAR implicito, ultimaEvaluacion null', () => {
    expect(reemplazoService_calcularEstado('04-0263', [])).toEqual({ wellId: '04-0263', estado: 'SIN_EVALUAR', ultimaEvaluacion: null });
    expect(reemplazoService_calcularEstado('04-0263', undefined).estado).toBe('SIN_EVALUAR');
  });

  test.each(['APTO', 'NO_APTO', 'DUDOSO'])('una sola evaluacion %s define el estado', (estado) => {
    const r = reemplazoService_calcularEstado('04-0263', [ev('2026-01-01T00:00:00.000Z', estado)]);
    expect(r.estado).toBe(estado);
    expect(r.ultimaEvaluacion.estado).toBe(estado);
  });

  test('la ultima evaluacion cronologica gana, sin importar el orden de las filas', () => {
    const filas = [
      ev('2026-03-01T00:00:00.000Z', 'DUDOSO'),
      ev('2026-05-01T00:00:00.000Z', 'APTO'),
      ev('2026-01-01T00:00:00.000Z', 'NO_APTO')
    ];
    expect(reemplazoService_calcularEstado('04-0263', filas).estado).toBe('APTO');
  });

  test('mismo timestamp: gana la fila escrita despues', () => {
    const filas = [ev('2026-03-01T00:00:00.000Z', 'NO_APTO', { evaluacionId: 'a' }), ev('2026-03-01T00:00:00.000Z', 'APTO', { evaluacionId: 'b' })];
    const r = reemplazoService_calcularEstado('04-0263', filas);
    expect(r.ultimaEvaluacion.evaluacionId).toBe('b');
  });

  test('filas corruptas (estado fuera del catalogo, timestamp invalido) se ignoran', () => {
    const filas = [
      ev('2026-01-01T00:00:00.000Z', 'NO_APTO'),
      ev('2026-09-01T00:00:00.000Z', 'SIN_EVALUAR'),
      ev(null, 'APTO'),
      ev('2026-08-01T00:00:00.000Z', 'basura')
    ];
    expect(reemplazoService_calcularEstado('04-0263', filas).estado).toBe('NO_APTO');
    expect(reemplazoService_ordenarDescendente(filas)).toHaveLength(1);
  });

  test('historial: orden descendente, varias evaluaciones del mismo pozo, sin mutar la entrada', () => {
    const filas = [ev('2026-01-01T00:00:00.000Z', 'NO_APTO'), ev('2026-03-01T00:00:00.000Z', 'DUDOSO'), ev('2026-02-01T00:00:00.000Z', 'APTO')];
    const copia = JSON.parse(JSON.stringify(filas));
    const orden = reemplazoService_ordenarDescendente(filas);
    expect(orden.map((e) => e.estado)).toEqual(['DUDOSO', 'APTO', 'NO_APTO']);
    expect(filas).toEqual(copia);
  });

  test('salida sanitizada: solo campos conocidos, vacios como null', () => {
    const fila = ev('2026-01-01T00:00:00.000Z', 'NO_APTO', { motivo: 'SECO', observacion: '', fila: 17, hoja: 'X' });
    const [s] = reemplazoService_ordenarDescendente([fila]);
    expect(Object.keys(s).sort()).toEqual(['estado', 'evaluacionId', 'motivo', 'nombre', 'observacion', 'puntoNEReferencia', 'timestamp', 'wellId']);
    expect(s.observacion).toBeNull();
    expect(s.puntoNEReferencia).toBeNull();
  });

  test('la respuesta de historial y de estado NO expone el email del evaluador (si el nombre falta: "Usuario")', () => {
    global.reemplazoRepository_listarPorWellId.mockReturnValue([
      ev('2026-01-01T00:00:00.000Z', 'APTO', { email: 'secreto@x.com', nombre: 'Ana' }),
      ev('2026-02-01T00:00:00.000Z', 'NO_APTO', { email: 'otro@x.com', nombre: '', motivo: 'SECO' })
    ]);
    const historial = reemplazoService_getHistorial('04-0263');
    const estado = reemplazoService_getEstado('04-0263');
    expect(JSON.stringify(historial)).not.toMatch(/@x\.com/);
    expect(JSON.stringify(estado)).not.toMatch(/@x\.com/);
    historial.evaluaciones.forEach((e) => expect(e).not.toHaveProperty('email'));
    expect(historial.evaluaciones.map((e) => e.nombre)).toEqual(['Usuario', 'Ana']);
    expect(estado.ultimaEvaluacion.nombre).toBe('Usuario');
  });

  test('getEstado / getHistorial leen del repositorio por wellId', () => {
    global.reemplazoRepository_listarPorWellId.mockReturnValue([ev('2026-01-01T00:00:00.000Z', 'APTO'), ev('2026-02-01T00:00:00.000Z', 'NO_APTO')]);
    expect(reemplazoService_getEstado('04-0263').estado).toBe('NO_APTO');
    expect(global.reemplazoRepository_listarPorWellId).toHaveBeenCalledWith('04-0263');
    expect(reemplazoService_getHistorial('04-0263').evaluaciones).toHaveLength(2);
  });
});

describe('reemplazoService_registrar', () => {
  test('arma la evaluacion con identidad de sesion, id y timestamp del backend, y hace append', () => {
    const r = reemplazoService_registrar('sesion@x.com', 'Nombre Sesion', '04-0263', {
      estado: 'NO_APTO', motivo: 'SECO', observacion: ' sin agua ', puntoNEReferencia: 'INA 2055'
    });
    expect(r.ok).toBe(true);
    expect(global.reemplazoRepository_agregar).toHaveBeenCalledTimes(1);
    const guardada = global.reemplazoRepository_agregar.mock.calls[0][0];
    expect(guardada.email).toBe('sesion@x.com');
    expect(guardada.nombre).toBe('Nombre Sesion');
    expect(guardada.wellId).toBe('04-0263');
    expect(guardada.observacion).toBe('sin agua');
    expect(guardada.timestamp).toBeInstanceOf(Date);
    expect(typeof guardada.evaluacionId).toBe('string');
    expect(guardada.evaluacionId.length).toBeGreaterThan(10);
    expect(r.evaluacion.evaluacionId).toBe(guardada.evaluacionId);
    expect(r.evaluacion.timestamp).toBe(guardada.timestamp.toISOString());
  });

  test('identidad en los datos del cliente se ignora (email/nombre/timestamp/evaluacionId)', () => {
    const r = reemplazoService_registrar('sesion@x.com', 'Real', '04-0263', {
      estado: 'APTO', motivo: '', observacion: '', puntoNEReferencia: '',
      email: 'impostor@x.com', nombre: 'Impostor', timestamp: '1999-01-01', evaluacionId: 'forzado'
    });
    const guardada = global.reemplazoRepository_agregar.mock.calls[0][0];
    expect(guardada.email).toBe('sesion@x.com');
    expect(guardada.nombre).toBe('Real');
    expect(guardada.evaluacionId).not.toBe('forzado');
    expect(guardada.timestamp.getFullYear()).toBeGreaterThan(2000);
    expect(r.evaluacion).not.toHaveProperty('email');
  });

  test('la hoja conserva email y nombre (trazabilidad) aunque la respuesta no exponga el email', () => {
    const r = reemplazoService_registrar('sesion@x.com', 'Ana', '04-0263', { estado: 'APTO' });
    expect(global.reemplazoRepository_agregar.mock.calls[0][0].email).toBe('sesion@x.com');
    expect(JSON.stringify(r)).not.toMatch(/sesion@x\.com/);
  });

  test('ids unicos entre evaluaciones consecutivas (append-only: cada una es una fila nueva)', () => {
    const datos = { estado: 'APTO', motivo: '', observacion: '', puntoNEReferencia: '' };
    const a = reemplazoService_registrar('s@x.com', 'S', '04-0263', datos);
    const b = reemplazoService_registrar('s@x.com', 'S', '04-0263', datos);
    expect(a.evaluacion.evaluacionId).not.toBe(b.evaluacion.evaluacionId);
    expect(global.reemplazoRepository_agregar).toHaveBeenCalledTimes(2);
  });

  test('si la validacion falla no se escribe nada', () => {
    const r = reemplazoService_registrar('s@x.com', 'S', '04-0263', { estado: 'NO_APTO', motivo: 'OTRO', observacion: '' });
    expect(r).toMatchObject({ ok: false, code: 'OBSERVACION_REQUERIDA' });
    expect(global.reemplazoRepository_agregar).not.toHaveBeenCalled();
  });

  test('datos ausentes -> INVALID_ESTADO, sin escribir', () => {
    expect(reemplazoService_registrar('s@x.com', 'S', '04-0263', undefined).code).toBe('INVALID_ESTADO');
    expect(global.reemplazoRepository_agregar).not.toHaveBeenCalled();
  });

  test('nombre ausente en la hoja Usuarios se guarda vacio (no rompe)', () => {
    reemplazoService_registrar('s@x.com', null, '04-0263', { estado: 'APTO' });
    expect(global.reemplazoRepository_agregar.mock.calls[0][0].nombre).toBe('');
  });
});
