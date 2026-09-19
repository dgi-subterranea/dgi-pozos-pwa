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
  mapaLogic_nombrePuntoNE,
  mapaLogic_setWellIdNE,
  mapaLogic_filtrarPorNE,
  mapaLogic_determinarAccesoMapas,
  mapaLogic_normalizarTexto,
  mapaLogic_indiceBusquedaPorWellId,
  mapaLogic_buscarPozosProvincia,
  mapaLogic_buscarPuntosNE,
  mapaLogic_estadoMonitoreoLabel,
  mapaLogic_construirOpcionesCampoNE,
  mapaLogic_filtrarPorCampoNE,
  mapaLogic_construirConteoEstadoMonitoreo,
  mapaLogic_filtrarPorEstadoMonitoreo,
  mapaLogic_filtrarPorFlagNE,
  mapaLogic_filtrarPorCampoMultipleNE,
  mapaLogic_construirOpcionesCampoCondicionadoNE,
  mapaLogic_valorSigueDisponible
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

describe('mapaLogic_setWellIdNE', () => {
  test('junta los wellId no nulos en un Set', () => {
    const puntos = [
      { monitoringId: '04-0263', wellId: '04-0263' },
      { monitoringId: '01-0035', wellId: '01-0035' },
      { monitoringId: 'INA 2055', wellId: null }
    ];
    const set = mapaLogic_setWellIdNE(puntos);
    expect(set instanceof Set).toBe(true);
    expect(set.size).toBe(2);
    expect(set.has('04-0263')).toBe(true);
    expect(set.has('01-0035')).toBe(true);
  });

  // Requisito explicito: los puntos especiales (sin wellId) nunca pueden
  // "colarse" en el filtro de Pozos Provincia - un Set de wellId no
  // nulos los excluye estructuralmente, no hace falta un filtro aparte.
  test('puntos especiales (wellId null) nunca entran al Set', () => {
    const puntos = [{ monitoringId: 'INA 2055', wellId: null }, { monitoringId: '7', wellId: null }];
    expect(mapaLogic_setWellIdNE(puntos).size).toBe(0);
  });

  test('wellId duplicado entre puntos NE se colapsa a una sola entrada', () => {
    const puntos = [{ monitoringId: 'a', wellId: '04-0263' }, { monitoringId: 'b', wellId: '04-0263' }];
    expect(mapaLogic_setWellIdNE(puntos).size).toBe(1);
  });

  test('lista vacia/ausente -> Set vacio, no rompe', () => {
    expect(mapaLogic_setWellIdNE([]).size).toBe(0);
    expect(mapaLogic_setWellIdNE(undefined).size).toBe(0);
    expect(mapaLogic_setWellIdNE(null).size).toBe(0);
  });
});

describe('mapaLogic_filtrarPorNE', () => {
  const pozos = [
    { wellId: '04-0263', estado: 'C' },
    { wellId: '04-0264', estado: 'D' },
    { wellId: '01-0035', estado: 'C' }
  ];

  test('activo=false -> devuelve el dataset tal cual (comportamiento actual sin cambios)', () => {
    const set = mapaLogic_setWellIdNE([{ wellId: '04-0263' }]);
    expect(mapaLogic_filtrarPorNE(pozos, set, false)).toEqual(pozos);
  });

  test('activo=true -> solo los pozos cuyo wellId esta en el Set NE', () => {
    const set = mapaLogic_setWellIdNE([{ wellId: '04-0263' }, { wellId: '01-0035' }]);
    const filtrados = mapaLogic_filtrarPorNE(pozos, set, true);
    expect(filtrados).toEqual([
      { wellId: '04-0263', estado: 'C' },
      { wellId: '01-0035', estado: 'C' }
    ]);
  });

  // Interseccion Pozos Provincia ∩ NE: un wellId de la red NE que no
  // tiene coordenadas validas (o no existe) en Pozos Provincia
  // simplemente no aparece en el resultado - no es un error, es el
  // cruce real (ver diagnostico: 132 de 371 sin match).
  test('un wellId NE que no existe en Pozos Provincia no aparece (interseccion real, no union)', () => {
    const set = mapaLogic_setWellIdNE([{ wellId: '99-9999' }]);
    expect(mapaLogic_filtrarPorNE(pozos, set, true)).toEqual([]);
  });

  test('activo=true con Set vacio -> lista vacia, no "todos" (fail-closed)', () => {
    expect(mapaLogic_filtrarPorNE(pozos, new Set(), true)).toEqual([]);
  });

  // Defensivo: activo=true sin Set (todavia no cargado - no deberia
  // pasar en la practica, ver mapaController_toggleNE) nunca se
  // interpreta como "sin filtro" - mismo criterio fail-closed.
  test('activo=true sin Set (undefined/null) -> lista vacia, nunca "todos"', () => {
    expect(mapaLogic_filtrarPorNE(pozos, undefined, true)).toEqual([]);
    expect(mapaLogic_filtrarPorNE(pozos, null, true)).toEqual([]);
  });

  test('dataset vacio -> lista vacia con cualquier combinacion', () => {
    expect(mapaLogic_filtrarPorNE([], new Set(['04-0263']), true)).toEqual([]);
  });
});

describe('mapaLogic_determinarAccesoMapas', () => {
  test('ubicacion=SI y ne=SI -> "selector"', () => {
    expect(mapaLogic_determinarAccesoMapas({ ubicacion: true, ne: true })).toBe('selector');
  });

  test('solo ubicacion=SI -> "provincia" (sin selector, sin referencias a NE)', () => {
    expect(mapaLogic_determinarAccesoMapas({ ubicacion: true, ne: false })).toBe('provincia');
    expect(mapaLogic_determinarAccesoMapas({ ubicacion: true })).toBe('provincia');
  });

  // Caso central del pedido: el mapa NE NUNCA depende de "ubicacion" -
  // un usuario sin ubicacion pero con ne=SI entra directo a Niveles
  // Estaticos, nunca se lo bloquea porque le falta el otro permiso.
  test('solo ne=SI -> "ne" (independiente de ubicacion)', () => {
    expect(mapaLogic_determinarAccesoMapas({ ubicacion: false, ne: true })).toBe('ne');
    expect(mapaLogic_determinarAccesoMapas({ ne: true })).toBe('ne');
  });

  test('ninguno de los 2 -> "ninguno"', () => {
    expect(mapaLogic_determinarAccesoMapas({ ubicacion: false, ne: false })).toBe('ninguno');
    expect(mapaLogic_determinarAccesoMapas({})).toBe('ninguno');
  });

  test('permisos ausente/null -> "ninguno", no rompe', () => {
    expect(mapaLogic_determinarAccesoMapas(undefined)).toBe('ninguno');
    expect(mapaLogic_determinarAccesoMapas(null)).toBe('ninguno');
  });
});

describe('mapaLogic_normalizarTexto', () => {
  test('minusculiza, quita tildes y colapsa espacios', () => {
    expect(mapaLogic_normalizarTexto('PÉREZ,   Juan')).toBe('perez, juan');
  });

  test('trim de espacios al principio/final', () => {
    expect(mapaLogic_normalizarTexto('  San Martín  ')).toBe('san martin');
  });

  test('eñe se conserva (no es un acento a quitar)', () => {
    expect(mapaLogic_normalizarTexto('Malargüe')).toBe('malargue');
  });

  test('valor ausente/vacio -> string vacio, no rompe', () => {
    expect(mapaLogic_normalizarTexto(undefined)).toBe('');
    expect(mapaLogic_normalizarTexto(null)).toBe('');
    expect(mapaLogic_normalizarTexto('')).toBe('');
  });
});

describe('mapaLogic_indiceBusquedaPorWellId', () => {
  test('arma el mapa wellId -> {nc16, titular}', () => {
    const indice = [
      { wellId: '04-0263', nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
      { wellId: '05-0001', nc16: null, titular: null }
    ];
    expect(mapaLogic_indiceBusquedaPorWellId(indice)).toEqual({
      '04-0263': { nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
      '05-0001': { nc16: null, titular: null }
    });
  });

  test('lista vacia/ausente -> objeto vacio, no rompe', () => {
    expect(mapaLogic_indiceBusquedaPorWellId([])).toEqual({});
    expect(mapaLogic_indiceBusquedaPorWellId(undefined)).toEqual({});
    expect(mapaLogic_indiceBusquedaPorWellId(null)).toEqual({});
  });
});

describe('mapaLogic_buscarPozosProvincia', () => {
  const pozos = [
    { wellId: '04-0263', lat: -32.8, lon: -68.7, estado: 'C' },
    { wellId: '04-0264', lat: -32.9, lon: -68.8, estado: 'D' },
    { wellId: '05-0001', lat: -33.1, lon: -68.5, estado: 'C' }
  ];
  const indiceBusqueda = {
    '04-0263': { nc16: '0101230020000036', titular: 'PEREZ, JUAN' },
    '04-0264': { nc16: '0101230020000037', titular: 'MUNICIPALIDAD DE LA CAPITAL' },
    '05-0001': { nc16: null, titular: null }
  };

  test('busca por wellId (substring, sin indice de busqueda)', () => {
    const r = mapaLogic_buscarPozosProvincia(pozos, null, '04-026', 6);
    expect(r.map((x) => x.wellId)).toEqual(['04-0263', '04-0264']);
    expect(r[0].titular).toBeNull();
    expect(r[0].nc16).toBeNull();
    expect(r[0].matchNc16).toBe(false);
  });

  test('con indice cargado, tambien busca por titular', () => {
    const r = mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, 'municipalidad', 6);
    expect(r.map((x) => x.wellId)).toEqual(['04-0264']);
    expect(r[0].titular).toBe('MUNICIPALIDAD DE LA CAPITAL');
    expect(r[0].matchTitular).toBe(true);
    expect(r[0].matchNc16).toBe(false);
  });

  // Caso central del pedido (NC16): buscar el numero completo de 16
  // digitos encuentra el pozo, y marca matchNc16 para que la UI sepa
  // mostrar "NC16: ..." en la sugerencia.
  test('busca por NC16 completo (16 digitos) - match exacto', () => {
    const r = mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, '0101230020000036', 6);
    expect(r.map((x) => x.wellId)).toEqual(['04-0263']);
    expect(r[0].nc16).toBe('0101230020000036');
    expect(r[0].matchNc16).toBe(true);
    expect(r[0].matchTitular).toBe(false);
  });

  test('busca por NC16 parcial mientras se escribe', () => {
    const r = mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, '010123002000003', 6);
    expect(r.map((x) => x.wellId).sort()).toEqual(['04-0263', '04-0264']);
    r.forEach((x) => expect(x.matchNc16).toBe(true));
  });

  // Caso central de seguridad: sin el indice cargado (ej. datos=NO, o
  // todavia no se pidio), buscar por NC16 o por un nombre nunca devuelve
  // nada - nunca "cae" a revisar esos campos igual (fail-closed, NC16
  // viaja en el MISMO indice/permiso que titular).
  test('sin indice cargado (null), NC16 y titular nunca matchean aunque existan en el dataset', () => {
    expect(mapaLogic_buscarPozosProvincia(pozos, null, 'municipalidad', 6)).toEqual([]);
    expect(mapaLogic_buscarPozosProvincia(pozos, null, '0101230020000036', 6)).toEqual([]);
  });

  test('normaliza tildes/mayusculas en la busqueda por titular', () => {
    const r = mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, 'PEREZ', 6);
    expect(r.map((x) => x.wellId)).toEqual(['04-0263']);
  });

  test('respeta el limite maximo de resultados', () => {
    const muchos = [];
    for (let i = 0; i < 20; i++) muchos.push({ wellId: '04-' + String(i).padStart(4, '0'), lat: 0, lon: 0, estado: 'C' });
    const r = mapaLogic_buscarPozosProvincia(muchos, null, '04-', 6);
    expect(r.length).toBe(6);
  });

  test('query vacia -> sin resultados, no rompe', () => {
    expect(mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, '', 6)).toEqual([]);
    expect(mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, '   ', 6)).toEqual([]);
  });

  test('sin match -> lista vacia', () => {
    expect(mapaLogic_buscarPozosProvincia(pozos, indiceBusqueda, 'zzzzz', 6)).toEqual([]);
  });

  // NC16 con cero inicial: nunca se pierde en la comparacion (viaja como
  // string en todo momento, jamas se convierte a Number).
  test('encuentra NC16 con cero inicial', () => {
    const indiceConCero = { '06-0714': { nc16: '0604882300420023', titular: null } };
    const pozosConCero = [{ wellId: '06-0714', lat: -33, lon: -68, estado: 'D' }];
    const r = mapaLogic_buscarPozosProvincia(pozosConCero, indiceConCero, '0604882300420023', 6);
    expect(r.length).toBe(1);
    expect(r[0].nc16).toBe('0604882300420023');
  });

  // NC16 duplicada entre varios wellId (real, medido: hasta 24 pozos
  // comparten una misma NC16 - parcela con multiples perforaciones) -
  // la busqueda devuelve TODOS los que matchean, nunca colapsa a uno.
  test('NC16 duplicada entre varios wellId - devuelve todos los que matchean', () => {
    const pozosDup = [
      { wellId: '10-0121', lat: -33, lon: -68, estado: 'D' },
      { wellId: '10-0123', lat: -33, lon: -68, estado: 'D' }
    ];
    const indiceDup = {
      '10-0121': { nc16: '1099001500510800', titular: 'A' },
      '10-0123': { nc16: '1099001500510800', titular: 'B' }
    };
    const r = mapaLogic_buscarPozosProvincia(pozosDup, indiceDup, '1099001500510800', 6);
    expect(r.map((x) => x.wellId)).toEqual(['10-0121', '10-0123']);
  });
});

describe('mapaLogic_buscarPuntosNE', () => {
  const puntos = [
    { monitoringId: '04-0263', wellId: '04-0263', lat: -32.8, lon: -68.7, nombreOriginal: null },
    { monitoringId: 'INA 2055', wellId: null, lat: -32.9, lon: -68.9, nombreOriginal: 'Jofre Puesto San Vicente' },
    { monitoringId: '6 RTR7', wellId: null, lat: -33.0, lon: -69.0, nombreOriginal: 'PASNOA' }
  ];

  test('busca por wellId', () => {
    const r = mapaLogic_buscarPuntosNE(puntos, '04-026', 6);
    expect(r.map((p) => p.monitoringId)).toEqual(['04-0263']);
  });

  test('busca por monitoringId', () => {
    const r = mapaLogic_buscarPuntosNE(puntos, 'ina 20', 6);
    expect(r.map((p) => p.monitoringId)).toEqual(['INA 2055']);
  });

  // Caso central del pedido: encontrar puntos especiales (sin wellId) por
  // su nombreOriginal, igual que un pozo registrado.
  test('busca por nombreOriginal, incluso en puntos especiales sin wellId', () => {
    const r = mapaLogic_buscarPuntosNE(puntos, 'jofre', 6);
    expect(r.map((p) => p.monitoringId)).toEqual(['INA 2055']);
    expect(r[0].wellId).toBeNull();
  });

  test('normaliza tildes/mayusculas', () => {
    const r = mapaLogic_buscarPuntosNE(puntos, 'PASNOA', 6);
    expect(r.map((p) => p.monitoringId)).toEqual(['6 RTR7']);
  });

  test('respeta el limite maximo de resultados', () => {
    const muchos = [];
    for (let i = 0; i < 20; i++) muchos.push({ monitoringId: '04-' + String(i).padStart(4, '0'), wellId: '04-' + String(i).padStart(4, '0'), lat: 0, lon: 0, nombreOriginal: null });
    const r = mapaLogic_buscarPuntosNE(muchos, '04-', 6);
    expect(r.length).toBe(6);
  });

  test('query vacia -> sin resultados, no rompe', () => {
    expect(mapaLogic_buscarPuntosNE(puntos, '', 6)).toEqual([]);
  });

  test('sin match -> lista vacia', () => {
    expect(mapaLogic_buscarPuntosNE(puntos, 'zzzzz', 6)).toEqual([]);
  });
});

// --- Etapa 1B: filtros del mapa Niveles Estaticos ---

function puntoNE(overrides) {
  return Object.assign({
    monitoringId: '04-0263', wellId: '04-0263', lat: -32.8, lon: -68.7, nombreOriginal: null,
    cuenca: 'MI', zona: 'Norte', zonaNormalizada: 'Norte', estadoMonitoreo: 'ACTIVO',
    tieneMedicion2026: true, tieneHistorico: true, esEspecial: false
  }, overrides);
}

describe('mapaLogic_estadoMonitoreoLabel', () => {
  test('ACTIVO -> Activo, INACTIVO -> Inactivo', () => {
    expect(mapaLogic_estadoMonitoreoLabel('ACTIVO')).toBe('Activo');
    expect(mapaLogic_estadoMonitoreoLabel('INACTIVO')).toBe('Inactivo');
  });

  test('null/ausente -> "Sin dato", nunca se inventa un estado', () => {
    expect(mapaLogic_estadoMonitoreoLabel(null)).toBe('Sin dato');
    expect(mapaLogic_estadoMonitoreoLabel(undefined)).toBe('Sin dato');
  });

  test('valor desconocido -> se devuelve tal cual, no rompe', () => {
    expect(mapaLogic_estadoMonitoreoLabel('X')).toBe('X');
  });
});

describe('mapaLogic_construirOpcionesCampoNE', () => {
  test('cuenta puntos por valor de un campo, ordena alfabeticamente', () => {
    const puntos = [
      puntoNE({ monitoringId: 'a', cuenca: 'MI' }),
      puntoNE({ monitoringId: 'b', cuenca: 'MD' }),
      puntoNE({ monitoringId: 'c', cuenca: 'MI' })
    ];
    expect(mapaLogic_construirOpcionesCampoNE(puntos, 'cuenca')).toEqual([
      { valor: 'MD', cantidad: 1 },
      { valor: 'MI', cantidad: 2 }
    ]);
  });

  // Real: 1 punto sin cuenca (null) - nunca aparece como opcion "null"
  // ni cuenta para ninguna opcion existente.
  test('puntos con el campo null/vacio no generan una opcion, ni se cuentan en otra', () => {
    const puntos = [puntoNE({ monitoringId: 'a', cuenca: null }), puntoNE({ monitoringId: 'b', cuenca: 'MI' })];
    expect(mapaLogic_construirOpcionesCampoNE(puntos, 'cuenca')).toEqual([{ valor: 'MI', cantidad: 1 }]);
  });

  test('MD9 queda separado de MD, nunca se fusiona', () => {
    const puntos = [puntoNE({ monitoringId: 'a', cuenca: 'MD' }), puntoNE({ monitoringId: 'b', cuenca: 'MD9' })];
    const opciones = mapaLogic_construirOpcionesCampoNE(puntos, 'cuenca');
    expect(opciones).toEqual([{ valor: 'MD', cantidad: 1 }, { valor: 'MD9', cantidad: 1 }]);
  });

  test('lista vacia/ausente -> lista vacia, no rompe', () => {
    expect(mapaLogic_construirOpcionesCampoNE([], 'cuenca')).toEqual([]);
    expect(mapaLogic_construirOpcionesCampoNE(undefined, 'cuenca')).toEqual([]);
  });
});

describe('mapaLogic_filtrarPorCampoNE', () => {
  const puntos = [
    puntoNE({ monitoringId: 'a', cuenca: 'MI' }),
    puntoNE({ monitoringId: 'b', cuenca: 'MD' }),
    puntoNE({ monitoringId: 'c', cuenca: 'MI' })
  ];

  test('"todos" devuelve el dataset completo sin tocar', () => {
    expect(mapaLogic_filtrarPorCampoNE(puntos, 'cuenca', 'todos')).toEqual(puntos);
  });

  test('valor vacio/ausente se trata igual que "todos"', () => {
    expect(mapaLogic_filtrarPorCampoNE(puntos, 'cuenca', undefined)).toEqual(puntos);
    expect(mapaLogic_filtrarPorCampoNE(puntos, 'cuenca', '')).toEqual(puntos);
  });

  test('filtra solo los puntos con ese valor', () => {
    const r = mapaLogic_filtrarPorCampoNE(puntos, 'cuenca', 'MI');
    expect(r.map((p) => p.monitoringId)).toEqual(['a', 'c']);
  });

  test('valor sin puntos -> lista vacia, no rompe', () => {
    expect(mapaLogic_filtrarPorCampoNE(puntos, 'cuenca', 'Este')).toEqual([]);
  });

  // MD9 y MD son valores DISTINTOS - filtrar por "MD" nunca devuelve los
  // puntos de "MD9".
  test('MD9 y MD nunca se mezclan en el filtro', () => {
    const conMD9 = puntos.concat([puntoNE({ monitoringId: 'd', cuenca: 'MD9' })]);
    expect(mapaLogic_filtrarPorCampoNE(conMD9, 'cuenca', 'MD').map((p) => p.monitoringId)).toEqual(['b']);
    expect(mapaLogic_filtrarPorCampoNE(conMD9, 'cuenca', 'MD9').map((p) => p.monitoringId)).toEqual(['d']);
  });
});

describe('mapaLogic_construirConteoEstadoMonitoreo', () => {
  test('cuenta ACTIVO/INACTIVO/SIN_DATO (null cuenta como SIN_DATO)', () => {
    const puntos = [
      puntoNE({ monitoringId: 'a', estadoMonitoreo: 'ACTIVO' }),
      puntoNE({ monitoringId: 'b', estadoMonitoreo: 'INACTIVO' }),
      puntoNE({ monitoringId: 'c', estadoMonitoreo: null }),
      puntoNE({ monitoringId: 'd', estadoMonitoreo: 'ACTIVO' })
    ];
    expect(mapaLogic_construirConteoEstadoMonitoreo(puntos)).toEqual({ ACTIVO: 2, INACTIVO: 1, SIN_DATO: 1 });
  });

  test('lista vacia/ausente -> todos en 0, no rompe', () => {
    expect(mapaLogic_construirConteoEstadoMonitoreo([])).toEqual({ ACTIVO: 0, INACTIVO: 0, SIN_DATO: 0 });
    expect(mapaLogic_construirConteoEstadoMonitoreo(undefined)).toEqual({ ACTIVO: 0, INACTIVO: 0, SIN_DATO: 0 });
  });
});

describe('mapaLogic_filtrarPorEstadoMonitoreo', () => {
  const puntos = [
    puntoNE({ monitoringId: 'a', estadoMonitoreo: 'ACTIVO' }),
    puntoNE({ monitoringId: 'b', estadoMonitoreo: 'INACTIVO' }),
    puntoNE({ monitoringId: 'c', estadoMonitoreo: null })
  ];

  test('los 3 activos -> dataset completo', () => {
    expect(mapaLogic_filtrarPorEstadoMonitoreo(puntos, { ACTIVO: true, INACTIVO: true, SIN_DATO: true })).toEqual(puntos);
  });

  test('solo Activo', () => {
    const r = mapaLogic_filtrarPorEstadoMonitoreo(puntos, { ACTIVO: true, INACTIVO: false, SIN_DATO: false });
    expect(r.map((p) => p.monitoringId)).toEqual(['a']);
  });

  test('solo Sin dato', () => {
    const r = mapaLogic_filtrarPorEstadoMonitoreo(puntos, { ACTIVO: false, INACTIVO: false, SIN_DATO: true });
    expect(r.map((p) => p.monitoringId)).toEqual(['c']);
  });

  // Mismo criterio que mapaLogic_filtrarPorEstado (Provincia): 0 activos
  // nunca es una lista vacia ambigua, se interpreta como "todos".
  test('los 3 apagados -> se interpreta como "todos", nunca lista vacia', () => {
    expect(mapaLogic_filtrarPorEstadoMonitoreo(puntos, { ACTIVO: false, INACTIVO: false, SIN_DATO: false })).toEqual(puntos);
  });

  test('activos ausente/null -> se interpreta como "todos"', () => {
    expect(mapaLogic_filtrarPorEstadoMonitoreo(puntos, undefined)).toEqual(puntos);
    expect(mapaLogic_filtrarPorEstadoMonitoreo(puntos, null)).toEqual(puntos);
  });
});

describe('mapaLogic_filtrarPorFlagNE', () => {
  const puntos = [
    puntoNE({ monitoringId: 'a', tieneMedicion2026: true }),
    puntoNE({ monitoringId: 'b', tieneMedicion2026: false }),
    puntoNE({ monitoringId: 'c', tieneMedicion2026: true })
  ];

  test('ambos activos -> dataset completo', () => {
    expect(mapaLogic_filtrarPorFlagNE(puntos, 'tieneMedicion2026', true, true)).toEqual(puntos);
  });

  test('solo "con" (mostrarTrue)', () => {
    const r = mapaLogic_filtrarPorFlagNE(puntos, 'tieneMedicion2026', true, false);
    expect(r.map((p) => p.monitoringId)).toEqual(['a', 'c']);
  });

  test('solo "sin" (mostrarFalse)', () => {
    const r = mapaLogic_filtrarPorFlagNE(puntos, 'tieneMedicion2026', false, true);
    expect(r.map((p) => p.monitoringId)).toEqual(['b']);
  });

  test('ambos apagados -> se interpreta como "todos", nunca lista vacia', () => {
    expect(mapaLogic_filtrarPorFlagNE(puntos, 'tieneMedicion2026', false, false)).toEqual(puntos);
  });

  // Reusado para "Tipo" (Pozo registrado/Punto especial) sobre esEspecial.
  test('reusable para el filtro Tipo (esEspecial)', () => {
    const mixto = [
      puntoNE({ monitoringId: 'reg', esEspecial: false }),
      puntoNE({ monitoringId: 'esp', esEspecial: true })
    ];
    const soloEspeciales = mapaLogic_filtrarPorFlagNE(mixto, 'esEspecial', true, false);
    expect(soloEspeciales.map((p) => p.monitoringId)).toEqual(['esp']);
  });
});

describe('mapaLogic_filtrarPorCampoMultipleNE (Etapa 1B.1 - Cuenca multiseleccion)', () => {
  const puntos = [
    puntoNE({ monitoringId: 'a', cuenca: 'MI' }),
    puntoNE({ monitoringId: 'b', cuenca: 'MD' }),
    puntoNE({ monitoringId: 'c', cuenca: 'VdU' }),
    puntoNE({ monitoringId: 'd', cuenca: null })
  ];

  test('una sola cuenca activa -> solo esos puntos', () => {
    const r = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { MI: true, MD: false, VdU: false });
    expect(r.map((p) => p.monitoringId)).toEqual(['a']);
  });

  test('varias cuencas activas -> OR dentro del grupo', () => {
    const r = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { MI: true, MD: true, VdU: false });
    expect(r.map((p) => p.monitoringId)).toEqual(['a', 'b']);
  });

  test('todas activas -> sin filtro, dataset completo (incluye cuenca null)', () => {
    const r = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { MI: true, MD: true, VdU: true });
    expect(r).toEqual(puntos);
  });

  test('ninguna activa -> sin filtro (fail-safe), nunca lista vacia', () => {
    const r = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { MI: false, MD: false, VdU: false });
    expect(r).toEqual(puntos);
  });

  test('con un subconjunto activo, el punto con cuenca null queda afuera', () => {
    const r = mapaLogic_filtrarPorCampoMultipleNE(puntos, 'cuenca', { MI: true, MD: false, VdU: false });
    expect(r.some((p) => p.monitoringId === 'd')).toBe(false);
  });
});

describe('mapaLogic_construirOpcionesCampoCondicionadoNE (Etapa 1B.1 - Zona dependiente de Cuenca)', () => {
  const puntosCompletos = [
    puntoNE({ monitoringId: 'a', cuenca: 'MI', zonaNormalizada: 'Norte' }),
    puntoNE({ monitoringId: 'b', cuenca: 'MI', zonaNormalizada: 'Sur' }),
    puntoNE({ monitoringId: 'c', cuenca: 'MD', zonaNormalizada: 'Este' }),
    puntoNE({ monitoringId: 'd', cuenca: 'VdU', zonaNormalizada: 'Valle de Uco' })
  ];

  test('sin restriccion (universo = dataset completo) -> mismos conteos que la version sin condicionar', () => {
    const opciones = mapaLogic_construirOpcionesCampoCondicionadoNE(puntosCompletos, puntosCompletos, 'zonaNormalizada');
    expect(opciones).toEqual([
      { valor: 'Este', cantidad: 1 },
      { valor: 'Norte', cantidad: 1 },
      { valor: 'Sur', cantidad: 1 },
      { valor: 'Valle de Uco', cantidad: 1 }
    ]);
  });

  test('universo reducido (ej. solo cuenca MI) -> zonas fuera del universo quedan en la lista con cantidad:0', () => {
    const universoMI = puntosCompletos.filter((p) => p.cuenca === 'MI');
    const opciones = mapaLogic_construirOpcionesCampoCondicionadoNE(puntosCompletos, universoMI, 'zonaNormalizada');
    expect(opciones).toEqual([
      { valor: 'Este', cantidad: 0 },
      { valor: 'Norte', cantidad: 1 },
      { valor: 'Sur', cantidad: 1 },
      { valor: 'Valle de Uco', cantidad: 0 }
    ]);
  });

  test('union de 2 cuencas -> conteos combinados, resto en 0', () => {
    const universoMIoMD = puntosCompletos.filter((p) => p.cuenca === 'MI' || p.cuenca === 'MD');
    const opciones = mapaLogic_construirOpcionesCampoCondicionadoNE(puntosCompletos, universoMIoMD, 'zonaNormalizada');
    expect(opciones).toEqual([
      { valor: 'Este', cantidad: 1 },
      { valor: 'Norte', cantidad: 1 },
      { valor: 'Sur', cantidad: 1 },
      { valor: 'Valle de Uco', cantidad: 0 }
    ]);
  });

  test('nunca elimina un valor del DOM: la cantidad de opciones es siempre la del dataset completo', () => {
    const universoVacio = [];
    const opciones = mapaLogic_construirOpcionesCampoCondicionadoNE(puntosCompletos, universoVacio, 'zonaNormalizada');
    expect(opciones).toHaveLength(4);
    expect(opciones.every((o) => o.cantidad === 0)).toBe(true);
  });
});

describe('mapaLogic_valorSigueDisponible (Etapa 1B.1 - punto C)', () => {
  const opciones = [
    { valor: 'Norte', cantidad: 3 },
    { valor: 'Sur', cantidad: 0 }
  ];

  test('"todos" siempre disponible, sin importar el universo', () => {
    expect(mapaLogic_valorSigueDisponible(opciones, 'todos')).toBe(true);
    expect(mapaLogic_valorSigueDisponible([], 'todos')).toBe(true);
  });

  test('valor con cantidad > 0 -> sigue disponible', () => {
    expect(mapaLogic_valorSigueDisponible(opciones, 'Norte')).toBe(true);
  });

  test('valor con cantidad 0 -> ya no esta disponible (hay que deseleccionarlo)', () => {
    expect(mapaLogic_valorSigueDisponible(opciones, 'Sur')).toBe(false);
  });

  test('valor que ni siquiera aparece en las opciones -> no disponible', () => {
    expect(mapaLogic_valorSigueDisponible(opciones, 'Este')).toBe(false);
  });
});
