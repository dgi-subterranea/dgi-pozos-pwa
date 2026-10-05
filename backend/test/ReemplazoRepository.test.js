// Solo la logica pura del repositorio (indice de columnas, armado de fila,
// parseo de fila) - lo que abre SpreadsheetApp no se testea unitariamente,
// por convencion del proyecto (ver SheetUserRepository.test.js).
const {
  REEMPLAZO_COLUMNAS,
  reemplazoRepository_indiceColumnas,
  reemplazoRepository_columnasFaltantes,
  reemplazoRepository_filaDesdeEvaluacion,
  reemplazoRepository_evaluacionDesdeFila
} = require('../src/ReemplazoRepository');

describe('schema de la hoja EvaluacionesReemplazo', () => {
  test('encabezado exacto', () => {
    expect(REEMPLAZO_COLUMNAS).toEqual([
      'timestamp', 'evaluacionId', 'wellId', 'email', 'nombre', 'estado', 'motivo', 'observacion', 'puntoNEReferencia'
    ]);
  });

  test('indiceColumnas encuentra las 9 columnas, tolera mayusculas/espacios y reordenamiento', () => {
    const header = [' EstadO', 'timestamp', 'WELLID', 'evaluacionId', 'email', 'nombre', 'motivo', 'observacion', 'puntoNEReferencia'];
    const idx = reemplazoRepository_indiceColumnas(header);
    expect(idx.estado).toBe(0);
    expect(idx.timestamp).toBe(1);
    expect(idx.wellId).toBe(2);
    expect(reemplazoRepository_columnasFaltantes(idx)).toEqual([]);
  });

  test('columnas faltantes se informan (fail-closed: el repositorio lanza error)', () => {
    const idx = reemplazoRepository_indiceColumnas(['timestamp', 'wellId', 'estado']);
    expect(reemplazoRepository_columnasFaltantes(idx)).toEqual(['evaluacionId', 'email', 'nombre', 'motivo', 'observacion', 'puntoNEReferencia']);
  });
});

describe('filaDesdeEvaluacion / evaluacionDesdeFila', () => {
  const evaluacion = {
    timestamp: new Date('2026-05-01T12:00:00Z'), evaluacionId: 'id-1', wellId: '04-0263', email: 'a@x.com', nombre: 'Ana',
    estado: 'NO_APTO', motivo: 'SECO', observacion: '=SUM(1)', puntoNEReferencia: 'INA 2055'
  };

  test('respeta el orden real de las columnas y completa columnas extra con vacio', () => {
    const header = ['extra', ...REEMPLAZO_COLUMNAS];
    const idx = reemplazoRepository_indiceColumnas(header);
    const fila = reemplazoRepository_filaDesdeEvaluacion(evaluacion, idx, header.length);
    expect(fila.length).toBe(10);
    expect(fila[0]).toBe('');
    expect(fila[3]).toBe('04-0263');
    expect(fila[8]).toBe('=SUM(1)');
  });

  test('puntoNEReferencia ausente se escribe como celda vacia', () => {
    const idx = reemplazoRepository_indiceColumnas(REEMPLAZO_COLUMNAS);
    const fila = reemplazoRepository_filaDesdeEvaluacion({ ...evaluacion, puntoNEReferencia: undefined }, idx, 9);
    expect(fila[8]).toBe('');
  });

  test('ida y vuelta: la fila se lee como la misma evaluacion (timestamp en ISO)', () => {
    const idx = reemplazoRepository_indiceColumnas(REEMPLAZO_COLUMNAS);
    const fila = reemplazoRepository_filaDesdeEvaluacion(evaluacion, idx, 9);
    const leida = reemplazoRepository_evaluacionDesdeFila(fila, idx);
    expect(leida).toEqual({ ...evaluacion, timestamp: '2026-05-01T12:00:00.000Z' });
  });

  test('timestamp invalido se lee como null (el Service descarta esa fila)', () => {
    const idx = reemplazoRepository_indiceColumnas(REEMPLAZO_COLUMNAS);
    const fila = reemplazoRepository_filaDesdeEvaluacion({ ...evaluacion, timestamp: 'no es fecha' }, idx, 9);
    expect(reemplazoRepository_evaluacionDesdeFila(fila, idx).timestamp).toBeNull();
  });
});
