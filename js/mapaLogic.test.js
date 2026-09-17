const {
  mapaLogic_departamentoDeWellId,
  mapaLogic_nombreDepartamento,
  mapaLogic_estadoLabel,
  mapaLogic_construirOpcionesDepartamento,
  mapaLogic_filtrarPorDepartamento,
  mapaLogic_filtrarPorEstado,
  mapaLogic_dividirChipsDepartamento,
  mapaLogic_debeConsultarSummary,
  mapaLogic_debeMostrarChipNE,
  mapaLogic_nombrePuntoNE
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

describe('mapaLogic_filtrarPorEstado', () => {
  const pozos = [punto('01-0001', 'C'), punto('04-0001', 'D'), punto('04-0002', 'D'), punto('19-0001', 'C')];

  test('ambos activos -> dataset completo', () => {
    expect(mapaLogic_filtrarPorEstado(pozos, { C: true, D: true })).toEqual(pozos);
  });

  test('solo Confirmada -> solo puntos estado C', () => {
    const r = mapaLogic_filtrarPorEstado(pozos, { C: true, D: false });
    expect(r).toEqual([punto('01-0001', 'C'), punto('19-0001', 'C')]);
  });

  test('solo Disponible -> solo puntos estado D', () => {
    const r = mapaLogic_filtrarPorEstado(pozos, { C: false, D: true });
    expect(r).toEqual([punto('04-0001', 'D'), punto('04-0002', 'D')]);
  });

  // Requisito explicito: nunca un estado ambiguo. La UI de mapa.js ya
  // impide apagar el ultimo chip activo (ver mapaController_toggleEstado),
  // pero esta funcion es correcta por si sola igual: 0 activos se
  // interpreta como "sin filtro", nunca como "nada visible".
  test('ambos apagados -> se interpreta como "todos", nunca lista vacia', () => {
    expect(mapaLogic_filtrarPorEstado(pozos, { C: false, D: false })).toEqual(pozos);
  });

  test('estadosActivos ausente/null -> se interpreta como "todos", no rompe', () => {
    expect(mapaLogic_filtrarPorEstado(pozos, undefined)).toEqual(pozos);
    expect(mapaLogic_filtrarPorEstado(pozos, null)).toEqual(pozos);
  });

  test('dataset vacio -> lista vacia con cualquier combinacion', () => {
    expect(mapaLogic_filtrarPorEstado([], { C: true, D: false })).toEqual([]);
  });
});

describe('mapaLogic_dividirChipsDepartamento', () => {
  const opciones = [
    { codigo: '01', nombre: 'Capital', cantidad: 1 },
    { codigo: '04', nombre: 'Guaymallén', cantidad: 3 },
    { codigo: '06', nombre: 'Luján de Cuyo', cantidad: 2 },
    { codigo: '14', nombre: 'Tupungato', cantidad: 5 },
    { codigo: '17', nombre: 'San Rafael', cantidad: 4 },
    { codigo: '19', nombre: 'Malargüe', cantidad: 1 }
  ];

  test('separa los primeros N en "visibles", el resto en "ocultos"', () => {
    const r = mapaLogic_dividirChipsDepartamento(opciones, 4);
    expect(r.visibles).toEqual(opciones.slice(0, 4));
    expect(r.ocultos).toEqual(opciones.slice(4));
    expect(r.visibles.length).toBe(4);
    expect(r.ocultos.length).toBe(2);
  });

  test('cantidadInicial mayor o igual al total -> todo en "visibles", "ocultos" vacio', () => {
    const r = mapaLogic_dividirChipsDepartamento(opciones, 100);
    expect(r.visibles).toEqual(opciones);
    expect(r.ocultos).toEqual([]);
  });

  test('cantidadInicial 0 o negativa -> nada visible de entrada, no rompe', () => {
    expect(mapaLogic_dividirChipsDepartamento(opciones, 0).visibles).toEqual([]);
    expect(mapaLogic_dividirChipsDepartamento(opciones, -3).visibles).toEqual([]);
  });

  test('lista de opciones vacia -> ambos arrays vacios', () => {
    const r = mapaLogic_dividirChipsDepartamento([], 4);
    expect(r).toEqual({ visibles: [], ocultos: [] });
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

describe('mapaLogic_debeMostrarChipNE', () => {
  test('ne=SI -> true', () => {
    expect(mapaLogic_debeMostrarChipNE({ ne: true })).toBe(true);
  });

  test('ne=NO -> false', () => {
    expect(mapaLogic_debeMostrarChipNE({ ne: false })).toBe(false);
  });

  // Fail-closed, y en particular: tener ubicacion=SI NUNCA alcanza para
  // mostrar el chip - son permisos independientes (requisito central de
  // v2.1.0: no revelar pertenencia a la red NE via otro permiso).
  test('ubicacion=SI pero ne=NO/ausente -> false', () => {
    expect(mapaLogic_debeMostrarChipNE({ ubicacion: true, ne: false })).toBe(false);
    expect(mapaLogic_debeMostrarChipNE({ ubicacion: true })).toBe(false);
  });

  test('permisos ausente/null -> false, no rompe', () => {
    expect(mapaLogic_debeMostrarChipNE(undefined)).toBe(false);
    expect(mapaLogic_debeMostrarChipNE(null)).toBe(false);
    expect(mapaLogic_debeMostrarChipNE({})).toBe(false);
  });
});

describe('mapaLogic_nombrePuntoNE', () => {
  test('con nombreOriginal -> lo devuelve', () => {
    expect(mapaLogic_nombrePuntoNE({ monitoringId: 'INA 2055', nombreOriginal: 'Jofre Puesto San Vicente' })).toBe('Jofre Puesto San Vicente');
  });

  test('sin nombreOriginal -> devuelve monitoringId', () => {
    expect(mapaLogic_nombrePuntoNE({ monitoringId: 'INA 104', nombreOriginal: null })).toBe('INA 104');
  });

  test('punto con wellId (nombreOriginal null tipico) -> devuelve monitoringId', () => {
    expect(mapaLogic_nombrePuntoNE({ monitoringId: '04-0263', wellId: '04-0263', nombreOriginal: null })).toBe('04-0263');
  });

  test('punto ausente/vacio -> string vacio, no rompe', () => {
    expect(mapaLogic_nombrePuntoNE(undefined)).toBe('');
    expect(mapaLogic_nombrePuntoNE(null)).toBe('');
    expect(mapaLogic_nombrePuntoNE({})).toBe('');
  });
});
