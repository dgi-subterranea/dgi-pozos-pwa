const {
  REEMPLAZO_MOTIVOS_UI,
  reemplazoLogic_etiquetaEstado,
  reemplazoLogic_etiquetaMotivo,
  reemplazoLogic_claseEstado,
  reemplazoLogic_motivosParaEstado,
  reemplazoLogic_motivoRequerido,
  reemplazoLogic_validarFormulario,
  reemplazoLogic_formatearFecha,
  reemplazoLogic_nombreUsuario,
  reemplazoLogic_agregarAlHistorial,
  reemplazoLogic_estadoDesdeHistorial,
  reemplazoLogic_mensajeError
} = require('./reemplazoLogic');

describe('etiquetas y clases', () => {
  test('estados: SIN_EVALUAR implicito se muestra "Sin evaluar"', () => {
    expect(reemplazoLogic_etiquetaEstado('SIN_EVALUAR')).toBe('Sin evaluar');
    expect(reemplazoLogic_etiquetaEstado(undefined)).toBe('Sin evaluar');
    expect(reemplazoLogic_etiquetaEstado('APTO')).toBe('Apto');
    expect(reemplazoLogic_etiquetaEstado('NO_APTO')).toBe('No apto');
    expect(reemplazoLogic_etiquetaEstado('DUDOSO')).toBe('Dudoso');
  });

  test('motivos: etiqueta legible, desconocido tal cual, vacio -> ""', () => {
    expect(reemplazoLogic_etiquetaMotivo('PROPIETARIO_NO_AUTORIZA')).toBe('Propietario no autoriza');
    expect(reemplazoLogic_etiquetaMotivo('NUEVO')).toBe('NUEVO');
    expect(reemplazoLogic_etiquetaMotivo(null)).toBe('');
  });

  test('catalogo de motivos del frontend coincide con el backend (11 valores, mismo orden)', () => {
    expect(REEMPLAZO_MOTIVOS_UI.map((m) => m.valor)).toEqual([
      'SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'POZO_CEGADO', 'POZO_OBSTRUIDO',
      'INSTALACION_IMPIDE_MEDICION', 'SECO', 'CONDICION_INSEGURA', 'NO_REPRESENTATIVO', 'APTO_SIN_OBSERVACIONES', 'OTRO'
    ]);
  });

  test('clase CSS por estado', () => {
    expect(reemplazoLogic_claseEstado('APTO')).toBe('apto');
    expect(reemplazoLogic_claseEstado('NO_APTO')).toBe('no-apto');
    expect(reemplazoLogic_claseEstado('DUDOSO')).toBe('dudoso');
    expect(reemplazoLogic_claseEstado('SIN_EVALUAR')).toBe('sin-evaluar');
  });
});

describe('motivos segun estado', () => {
  test('APTO: solo "Apto sin observaciones" y "Otro"', () => {
    expect(reemplazoLogic_motivosParaEstado('APTO').map((m) => m.valor)).toEqual(['APTO_SIN_OBSERVACIONES', 'OTRO']);
  });
  test('NO_APTO: los 10 motivos negativos, sin "Apto sin observaciones"', () => {
    const valores = reemplazoLogic_motivosParaEstado('NO_APTO').map((m) => m.valor);
    expect(valores).toHaveLength(10);
    expect(valores).not.toContain('APTO_SIN_OBSERVACIONES');
    expect(valores).toEqual(expect.arrayContaining(['POZO_CEGADO', 'POZO_OBSTRUIDO', 'SECO', 'CONDICION_INSEGURA', 'OTRO']));
  });
  test('DUDOSO: solo los motivos que dejan la duda abierta (sin cegado/obstruido/seco/condicion insegura)', () => {
    expect(reemplazoLogic_motivosParaEstado('DUDOSO').map((m) => m.valor)).toEqual([
      'SIN_ACCESO', 'PROPIETARIO_NO_AUTORIZA', 'POZO_NO_LOCALIZADO', 'INSTALACION_IMPIDE_MEDICION', 'NO_REPRESENTATIVO', 'OTRO'
    ]);
  });
  test('sin estado: lista vacia; motivo requerido solo para NO_APTO/DUDOSO', () => {
    expect(reemplazoLogic_motivosParaEstado('')).toEqual([]);
    expect(reemplazoLogic_motivoRequerido('NO_APTO')).toBe(true);
    expect(reemplazoLogic_motivoRequerido('DUDOSO')).toBe(true);
    expect(reemplazoLogic_motivoRequerido('APTO')).toBe(false);
  });
});

describe('reemplazoLogic_validarFormulario (mismas reglas que el backend)', () => {
  test('sin estado: error de estado', () => {
    const r = reemplazoLogic_validarFormulario({});
    expect(r.valido).toBe(false);
    expect(r.errores.estado).toBeDefined();
  });
  test('APTO sin motivo es valido (motivo opcional)', () => {
    const r = reemplazoLogic_validarFormulario({ estado: 'APTO' });
    expect(r.valido).toBe(true);
    expect(r.valores).toEqual({ estado: 'APTO', motivo: '', observacion: '', puntoNEReferencia: '' });
  });
  test('NO_APTO / DUDOSO sin motivo: error de motivo', () => {
    expect(reemplazoLogic_validarFormulario({ estado: 'NO_APTO' }).errores.motivo).toBeDefined();
    expect(reemplazoLogic_validarFormulario({ estado: 'DUDOSO', motivo: '' }).errores.motivo).toBeDefined();
  });
  test('OTRO obliga observacion (espacios no cuentan)', () => {
    expect(reemplazoLogic_validarFormulario({ estado: 'NO_APTO', motivo: 'OTRO', observacion: '   ' }).errores.observacion).toBeDefined();
    expect(reemplazoLogic_validarFormulario({ estado: 'NO_APTO', motivo: 'OTRO', observacion: 'detalle' }).valido).toBe(true);
  });
  test('DUDOSO con motivos concluyentes es invalido; NO_APTO con ellos es valido', () => {
    ['POZO_CEGADO', 'POZO_OBSTRUIDO', 'SECO', 'CONDICION_INSEGURA'].forEach((m) => {
      expect(reemplazoLogic_validarFormulario({ estado: 'DUDOSO', motivo: m }).errores.motivo).toBeDefined();
      expect(reemplazoLogic_validarFormulario({ estado: 'NO_APTO', motivo: m }).valido).toBe(true);
    });
    expect(reemplazoLogic_validarFormulario({ estado: 'DUDOSO', motivo: 'SIN_ACCESO' }).valido).toBe(true);
  });
  test('motivo incompatible con el estado (APTO + SECO, NO_APTO + APTO_SIN_OBSERVACIONES)', () => {
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', motivo: 'SECO' }).errores.motivo).toBeDefined();
    expect(reemplazoLogic_validarFormulario({ estado: 'NO_APTO', motivo: 'APTO_SIN_OBSERVACIONES' }).errores.motivo).toBeDefined();
  });
  test('observacion de mas de 1000 caracteres', () => {
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', observacion: 'x'.repeat(1001) }).errores.observacion).toBeDefined();
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', observacion: 'x'.repeat(1000) }).valido).toBe(true);
  });
  test('punto NE: opcional, wellId y monitoringId especiales validos, formulas/basura invalidas', () => {
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', puntoNE: '' }).valido).toBe(true);
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', puntoNE: '04-0263' }).valido).toBe(true);
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', puntoNE: 'INA 2055' }).valido).toBe(true);
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', puntoNE: '=1+1' }).errores.puntoNE).toBeDefined();
    expect(reemplazoLogic_validarFormulario({ estado: 'APTO', puntoNE: 'a'.repeat(41) }).errores.puntoNE).toBeDefined();
  });
  test('recorta espacios en lo que se envia', () => {
    const r = reemplazoLogic_validarFormulario({ estado: 'NO_APTO', motivo: 'SECO', observacion: '  x  ', puntoNE: ' INA 1 ' });
    expect(r.valores.observacion).toBe('x');
    expect(r.valores.puntoNEReferencia).toBe('INA 1');
  });
});

describe('fecha, usuario, historial', () => {
  test('fecha en hora de Mendoza (UTC-3), formato dd/mm/aaaa hh:mm', () => {
    expect(reemplazoLogic_formatearFecha('2026-05-01T15:30:00.000Z')).toBe('01/05/2026 12:30');
    expect(reemplazoLogic_formatearFecha('2026-05-01T03:00:00.000Z')).toBe('01/05/2026 00:00');
    expect(reemplazoLogic_formatearFecha('2026-05-01T02:59:00.000Z')).toBe('30/04/2026 23:59');
  });
  test('fecha invalida o ausente: "—"', () => {
    expect(reemplazoLogic_formatearFecha(null)).toBe('—');
    expect(reemplazoLogic_formatearFecha('nope')).toBe('—');
  });
  test('usuario: solo el nombre; sin nombre, "Usuario" (nunca el email)', () => {
    expect(reemplazoLogic_nombreUsuario({ nombre: 'Ana', email: 'a@x.com' })).toBe('Ana');
    expect(reemplazoLogic_nombreUsuario({ nombre: null, email: 'a@x.com' })).toBe('Usuario');
    expect(reemplazoLogic_nombreUsuario({})).toBe('Usuario');
    expect(reemplazoLogic_nombreUsuario(null)).toBe('Usuario');
  });
  test('agregarAlHistorial: la nueva queda primera, sin mutar ni duplicar', () => {
    const h = [{ evaluacionId: 'b' }, { evaluacionId: 'a' }];
    const copia = JSON.parse(JSON.stringify(h));
    const r = reemplazoLogic_agregarAlHistorial(h, { evaluacionId: 'c' });
    expect(r.map((e) => e.evaluacionId)).toEqual(['c', 'b', 'a']);
    expect(h).toEqual(copia);
    expect(reemplazoLogic_agregarAlHistorial(r, { evaluacionId: 'c' }).map((e) => e.evaluacionId)).toEqual(['c', 'b', 'a']);
    expect(reemplazoLogic_agregarAlHistorial(undefined, { evaluacionId: 'z' })).toHaveLength(1);
  });
  test('estadoDesdeHistorial: vacio -> SIN_EVALUAR; si no, la primera (mas reciente)', () => {
    expect(reemplazoLogic_estadoDesdeHistorial([])).toEqual({ estado: 'SIN_EVALUAR', ultimaEvaluacion: null });
    const h = [{ evaluacionId: 'b', estado: 'APTO' }, { evaluacionId: 'a', estado: 'NO_APTO' }];
    expect(reemplazoLogic_estadoDesdeHistorial(h)).toEqual({ estado: 'APTO', ultimaEvaluacion: h[0] });
  });
  test('mensajes de error: conocidos, y generico para desconocidos', () => {
    expect(reemplazoLogic_mensajeError('PERMISSION_DENIED')).toMatch(/permiso/);
    expect(reemplazoLogic_mensajeError('OBSERVACION_REQUERIDA')).toMatch(/Otro/);
    expect(reemplazoLogic_mensajeError('???')).toMatch(/inesperado/);
  });
});
