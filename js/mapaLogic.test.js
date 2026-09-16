const {
  mapaLogic_departamentoDeWellId,
  mapaLogic_nombreDepartamento,
  mapaLogic_estadoLabel,
  mapaLogic_construirOpcionesDepartamento,
  mapaLogic_filtrarPorDepartamento,
  mapaLogic_debeConsultarSummary
} = require('./mapaLogic');

function punto(wellId, estado) {
  return { wellId: wellId, lat: -32.8, lon: -68.8, estado: estado || 'D' };
}

describe('mapaLogic_departamentoDeWellId', () => {
  test('devuelve los primeros 2 caracteres del wellId (codigo de departamento)', () => {
    expect(mapaLogic_departamentoDeWellId('04-0263')).toBe('04');
    expect(mapaLogic_departamentoDeWellId('19-0101')).toBe('19');
  });
});

describe('mapaLogic_nombreDepartamento', () => {
  test('codigo conocido -> nombre real', () => {
    expect(mapaLogic_nombreDepartamento('04')).toBe('Guaymallén');
    expect(mapaLogic_nombreDepartamento('19')).toBe('Malargüe');
  });

  test('codigo desconocido -> devuelve el codigo tal cual, no rompe', () => {
    expect(mapaLogic_nombreDepartamento('99')).toBe('99');
  });
});

describe('mapaLogic_estadoLabel', () => {
  test('C -> Confirmada, D -> Disponible', () => {
    expect(mapaLogic_estadoLabel('C')).toBe('Confirmada');
    expect(mapaLogic_estadoLabel('D')).toBe('Disponible');
  });

  test('estado desconocido -> devuelve el valor tal cual, no rompe', () => {
    expect(mapaLogic_estadoLabel('X')).toBe('X');
  });
});

describe('mapaLogic_construirOpcionesDepartamento', () => {
  test('cuenta puntos por departamento, ordena por nombre', () => {
    const pozos = [
      punto('19-0001'), punto('19-0002'), // Malargüe: 2
      punto('01-0001'),                    // Capital: 1
      punto('04-0001'), punto('04-0002'), punto('04-0003') // Guaymallén: 3
    ];
    const opciones = mapaLogic_construirOpcionesDepartamento(pozos);
    expect(opciones).toEqual([
      { codigo: '01', nombre: 'Capital', cantidad: 1 },
      { codigo: '04', nombre: 'Guaymallén', cantidad: 3 },
      { codigo: '19', nombre: 'Malargüe', cantidad: 2 }
    ]);
  });

  // Caso central: un departamento sin ningun punto en el dataset (ej.
  // "02", que no tiene pozos en el padron actual) nunca aparece como
  // opcion - listar un filtro que siempre da 0 resultados es ruido.
  test('un departamento sin puntos en el dataset no aparece como opcion', () => {
    const opciones = mapaLogic_construirOpcionesDepartamento([punto('01-0001')]);
    expect(opciones.some((o) => o.codigo === '02')).toBe(false);
    expect(opciones).toEqual([{ codigo: '01', nombre: 'Capital', cantidad: 1 }]);
  });

  test('dataset vacio -> lista vacia', () => {
    expect(mapaLogic_construirOpcionesDepartamento([])).toEqual([]);
  });
});

describe('mapaLogic_filtrarPorDepartamento', () => {
  const pozos = [punto('01-0001'), punto('04-0001'), punto('04-0002')];

  test('"todos" devuelve el dataset completo sin tocar', () => {
    expect(mapaLogic_filtrarPorDepartamento(pozos, 'todos')).toEqual(pozos);
  });

  test('codigo vacio/undefined se trata igual que "todos"', () => {
    expect(mapaLogic_filtrarPorDepartamento(pozos, undefined)).toEqual(pozos);
    expect(mapaLogic_filtrarPorDepartamento(pozos, '')).toEqual(pozos);
  });

  test('filtra solo los puntos del departamento pedido', () => {
    const filtrados = mapaLogic_filtrarPorDepartamento(pozos, '04');
    expect(filtrados).toEqual([punto('04-0001'), punto('04-0002')]);
  });

  test('departamento sin puntos -> lista vacia, no rompe', () => {
    expect(mapaLogic_filtrarPorDepartamento(pozos, '19')).toEqual([]);
  });
});

describe('mapaLogic_debeConsultarSummary', () => {
  test('datos=SI -> true', () => {
    expect(mapaLogic_debeConsultarSummary({ datos: true })).toBe(true);
  });

  test('datos=NO -> false', () => {
    expect(mapaLogic_debeConsultarSummary({ datos: false })).toBe(false);
  });

  // Fail-closed: permisos ausente/null/undefined nunca dispara la
  // consulta - mismo criterio que el resto de la app (ver
  // permisosActuales en app.js).
  test('permisos ausente/null -> false, no rompe', () => {
    expect(mapaLogic_debeConsultarSummary(undefined)).toBe(false);
    expect(mapaLogic_debeConsultarSummary(null)).toBe(false);
    expect(mapaLogic_debeConsultarSummary({})).toBe(false);
  });
});
