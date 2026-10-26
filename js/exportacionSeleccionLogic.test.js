// Modelo de la exportacion de Mi seleccion (js/exportacionSeleccionLogic.js): columnas por permiso (fail-closed), valores tipados, vacios que no inventan datos, hoja Informacion,
// nombre de archivo, privacidad, orden exacto de la tabla y escala. El archivo real lo escribe js/xlsxLogic.js (probado aparte).
const fs = require('fs');
const path = require('path');
const JSZip = require('../vendor/jszip/jszip.min.js');

// dependencias globales del navegador
Object.assign(global, require('./mapaLogic'), require('./reemplazoResumenLogic'), require('./seleccionLogic'), require('./xlsxLogic'));
const E = require('./exportacionSeleccionLogic');

const AHORA = new Date('2026-10-26T14:03:09.456Z');                          // 11:03:09 en Mendoza
const TODOS = { ubicacion: true, perfil: true, ne: true, reemplazo: true };
const BASE = ['wellId', 'departamento', 'cuenca', 'profundidad_m', 'tipo_pozo'];
const claves = (cols) => cols.map((c) => c.clave);

// dataset operativo con la forma de getMapaPozos (+ campos que JAMAS deben salir)
const punto = (wellId, extra) => Object.assign({
  wellId, lat: -33.34765, lon: -69.14545, estado: 'V', cuenca: 'Río Tunuyán Superior', profundidad: 139.5, surgencia: 'SemiSurgente', tramosFiltrantes: [[10, 20]],
  titular: 'PEREZ JUAN', nc16: '0101200022000019', email: 'a@b.com', clientRequestId: 'req-1', sessionToken: 'tok', driveFileId: 'drv', nombreAgente: 'Valeria'
}, extra || {});

const INDICE = {
  '01-0001': punto('01-0001'),
  '14-0001': punto('14-0001', { estado: 'D', lat: -33.1, lon: -69.2, cuenca: 'Valle de Uco', profundidad: 65, surgencia: 'Natural' }),
  '14-0002': punto('14-0002', { estado: 'R', profundidad: undefined, surgencia: 'Profundo' }),
  '14-0003': punto('14-0003', { estado: 'C', lat: undefined, lon: null, cuenca: null, surgencia: undefined })
};
const NE = new Set(['01-0001']);
const ITF = { disponibilidad: { '01-0001': true, '14-0001': false, '14-0002': true, '14-0003': false }, desconocidos: [] };
const RESUMEN = { '01-0001': 'APTO', '14-0001': 'NO_APTO', '14-0002': 'DUDOSO' };

const datos = (extra) => Object.assign({
  wellIds: ['01-0001', '14-0001', '14-0002', '14-0003', '14-0099'],
  totalSeleccion: 5,
  permisos: TODOS,
  indicePozos: INDICE,
  neSet: NE,
  itf: ITF,
  resumenReemplazo: RESUMEN,
  filtros: { texto: '', orden: 'wellId', aptitudActivos: {} },
  periodoPadron: '2026-05',
  ahora: AHORA
}, extra || {});

describe('columnas por permiso', () => {
  test('sin permisos: solo las 5 siempre presentes, en este orden', () => {
    expect(claves(E.exportacionSeleccion_columnasPara({}))).toEqual(BASE);
    expect(claves(E.exportacionSeleccion_columnasPara(undefined))).toEqual(BASE);
    expect(claves(E.exportacionSeleccion_columnasPara(null))).toEqual(BASE);
    expect(claves(E.exportacionSeleccion_columnasPara('ubicacion'))).toEqual(BASE);
    expect(claves(E.exportacionSeleccion_columnasPara(['ubicacion']))).toEqual(BASE);
  });

  test.each([
    ['ubicacion', ['estado_ubicacion', 'latitud', 'longitud']],
    ['perfil', ['tiene_itf']],
    ['ne', ['tiene_ne']],
    ['reemplazo', ['aptitud_reemplazo']]
  ])('solo %s: agrega exactamente sus columnas', (permiso, extra) => {
    expect(claves(E.exportacionSeleccion_columnasPara({ [permiso]: true }))).toEqual(BASE.concat(extra));
  });

  test('todos los permisos: las 11 columnas, en el orden del archivo', () => {
    expect(claves(E.exportacionSeleccion_columnasPara(TODOS))).toEqual(
      ['wellId', 'departamento', 'cuenca', 'profundidad_m', 'tipo_pozo', 'estado_ubicacion', 'latitud', 'longitud', 'tiene_itf', 'tiene_ne', 'aptitud_reemplazo']
    );
  });

  test('combinaciones: ubicacion + ne, perfil + reemplazo', () => {
    expect(claves(E.exportacionSeleccion_columnasPara({ ubicacion: true, ne: true }))).toEqual(BASE.concat(['estado_ubicacion', 'latitud', 'longitud', 'tiene_ne']));
    expect(claves(E.exportacionSeleccion_columnasPara({ perfil: true, reemplazo: true }))).toEqual(BASE.concat(['tiene_itf', 'aptitud_reemplazo']));
  });

  test.each([['SI'], ['true'], [1], [2], [{}], [[]], ['yes'], [new Boolean(true)], [() => true]])('un permiso "truthy" que no es el booleano true (%p) NO habilita nada (fail-closed)', (valor) => {
    const permisos = { ubicacion: valor, perfil: valor, ne: valor, reemplazo: valor };
    expect(claves(E.exportacionSeleccion_columnasPara(permisos))).toEqual(BASE);
  });

  test('false, 0, null y undefined tampoco', () => {
    [false, 0, null, undefined, ''].forEach((v) => {
      expect(claves(E.exportacionSeleccion_columnasPara({ ubicacion: v, perfil: v, ne: v, reemplazo: v }))).toEqual(BASE);
    });
  });

  test('un permiso desconocido ("exportar", "datos") no agrega nada: titular / nc16 no existen en el catalogo', () => {
    expect(claves(E.exportacionSeleccion_columnasPara({ datos: true, exportar: true, titular: true, nc16: true }))).toEqual(BASE);
    const todas = claves(E.EXPORTACION_SELECCION_COLUMNAS).join(',');
    expect(todas).not.toMatch(/titular|nc16|domicilio|email|agente|observacion|token|drive|secuencia/i);
  });

  test('encabezados humanos estables (mapeo clave -> encabezado)', () => {
    const mapa = {};
    E.EXPORTACION_SELECCION_COLUMNAS.forEach((c) => { mapa[c.clave] = c.encabezado; });
    expect(mapa).toEqual({
      wellId: 'Pozo', departamento: 'Departamento', cuenca: 'Cuenca', profundidad_m: 'Profundidad (m)', tipo_pozo: 'Tipo de pozo',
      estado_ubicacion: 'Estado de ubicación', latitud: 'Latitud', longitud: 'Longitud', tiene_itf: 'Tiene ITF', tiene_ne: 'Tiene NE', aptitud_reemplazo: 'Aptitud para reemplazo'
    });
  });

  test('sin permiso la columna NO EXISTE en la hoja: ni encabezado, ni celdas, ni clave en la fila', () => {
    const m = E.exportacionSeleccion_construirLibro(datos({ permisos: { perfil: true } }));
    expect(m.columnas.map((c) => c.encabezado)).toEqual(['Pozo', 'Departamento', 'Cuenca', 'Profundidad (m)', 'Tipo de pozo', 'Tiene ITF']);
    m.filas.forEach((f) => { expect(Object.keys(f)).toEqual(m.columnas.map((c) => c.clave)); });
    const hoja = m.libro.hojas[0];
    hoja.filas.forEach((fila) => { expect(fila).toHaveLength(6); });
    const textoHoja = JSON.stringify(hoja);
    expect(textoHoja).not.toMatch(/Latitud|Longitud|Estado de ubicación|Tiene NE|Aptitud|sin permiso/i);
  });
});

describe('valores de las filas', () => {
  const m = E.exportacionSeleccion_construirLibro(datos());
  const fila = (id) => m.filas.find((f) => f.wellId === id);

  test('pozo completo: texto, numeros reales, coordenadas numericas', () => {
    expect(fila('01-0001')).toEqual({
      wellId: '01-0001', departamento: 'Capital', cuenca: 'Río Tunuyán Superior', profundidad_m: 139.5, tipo_pozo: 'Semisurgente',
      estado_ubicacion: 'Validada en campo', latitud: -33.34765, longitud: -69.14545, tiene_itf: 'Sí', tiene_ne: 'Sí', aptitud_reemplazo: 'Apto'
    });
  });

  test('profundidad, latitud y longitud son numbers (nunca strings con coma ni punto)', () => {
    expect(typeof fila('01-0001').profundidad_m).toBe('number');
    expect(typeof fila('01-0001').latitud).toBe('number');
    expect(typeof fila('01-0001').longitud).toBe('number');
    expect(fila('14-0001').profundidad_m).toBe(65);
  });

  test('etiquetas de tipo de pozo: Profundo / Semisurgente / Surgente (nunca el valor crudo)', () => {
    expect(fila('14-0002').tipo_pozo).toBe('Profundo');
    expect(fila('01-0001').tipo_pozo).toBe('Semisurgente');
    expect(fila('14-0001').tipo_pozo).toBe('Surgente');
    expect(m.filas.map((f) => f.tipo_pozo).join('|')).not.toMatch(/SemiSurgente|Natural/);
  });

  test('estado de ubicacion: etiqueta humana, nunca la letra cruda', () => {
    expect(fila('14-0001').estado_ubicacion).toBe('Disponible');
    expect(fila('14-0002').estado_ubicacion).toBe('Aceptada');
    expect(fila('14-0003').estado_ubicacion).toBe('Coincidente');
    expect(fila('01-0001').estado_ubicacion).toBe('Validada en campo');
  });

  test('pozo que no esta en el dataset cargado: "Sin ubicación operativa", y todo lo demas vacio (no se inventa)', () => {
    expect(fila('14-0099')).toEqual({
      wellId: '14-0099', departamento: mapaLogic_nombreDepartamento('14'), cuenca: '', profundidad_m: null, tipo_pozo: '',
      estado_ubicacion: 'Sin ubicación operativa', latitud: null, longitud: null, tiene_itf: '', tiene_ne: 'No', aptitud_reemplazo: 'Sin evaluar'
    });
  });

  test('datos faltantes: profundidad ausente -> null (celda vacia, no 0), cuenca null -> vacio, lat/lon ausentes -> null', () => {
    expect(fila('14-0002').profundidad_m).toBeNull();
    expect(fila('14-0003').cuenca).toBe('');
    expect(fila('14-0003').latitud).toBeNull();
    expect(fila('14-0003').longitud).toBeNull();
    expect(fila('14-0003').tipo_pozo).toBe('');
  });

  test('profundidad no numerica (texto, NaN, Infinity) -> vacia; 0 es un numero valido', () => {
    const idx = { '14-0001': punto('14-0001', { profundidad: '139,5' }), '14-0002': punto('14-0002', { profundidad: NaN }), '14-0003': punto('14-0003', { profundidad: Infinity }), '14-0004': punto('14-0004', { profundidad: 0 }) };
    const r = E.exportacionSeleccion_construirLibro(datos({ wellIds: ['14-0001', '14-0002', '14-0003', '14-0004'], indicePozos: idx }));
    expect(r.filas.map((f) => f.profundidad_m)).toEqual([null, null, null, 0]);
  });

  test('dataset operativo no cargado (null): estado de ubicacion y datos del dataset vacios, NO "Sin ubicación operativa"', () => {
    const r = E.exportacionSeleccion_construirLibro(datos({ indicePozos: null, wellIds: ['01-0001'] }));
    expect(r.filas[0]).toMatchObject({ cuenca: '', profundidad_m: null, tipo_pozo: '', estado_ubicacion: '', latitud: null, longitud: null, departamento: 'Capital' });
  });

  test('ITF: Sí / No afirmados por el backend; sin datos o pozo desconocido -> vacio, nunca "No"', () => {
    const itf = { disponibilidad: { '01-0001': true, '14-0001': false }, desconocidos: ['14-0002'] };
    const r = E.exportacionSeleccion_construirLibro(datos({ itf, wellIds: ['01-0001', '14-0001', '14-0002', '14-0003'] }));
    expect(r.filas.map((f) => f.tiene_itf)).toEqual(['Sí', 'No', '', '']);          // el 4to no esta en `disponibilidad`: no se sabe
  });

  test('ITF: un lote fallido (pozos desconocidos) queda vacio aunque el cache traiga un valor viejo', () => {
    const itf = { disponibilidad: { '01-0001': true, '14-0001': true }, desconocidos: ['14-0001'] };
    const r = E.exportacionSeleccion_construirLibro(datos({ itf, wellIds: ['01-0001', '14-0001'] }));
    expect(r.filas.map((f) => f.tiene_itf)).toEqual(['Sí', '']);
  });

  test.each([[null], [undefined], [{}], [{ disponibilidad: null, desconocidos: [] }], [{ disponibilidad: { '01-0001': true } }], [{ disponibilidad: { '01-0001': true }, desconocidos: 'x' }]])(
    'ITF sin datos validos (%j): todo vacio', (itf) => {
      const r = E.exportacionSeleccion_construirLibro(datos({ itf, wellIds: ['01-0001', '14-0001'] }));
      expect(r.filas.map((f) => f.tiene_itf)).toEqual(['', '']);
    });

  test('ITF: valores que no son booleanos exactos (1, "true", "SI") no dan "Sí"', () => {
    const itf = { disponibilidad: { '01-0001': 1, '14-0001': 'true', '14-0002': 'SI' }, desconocidos: [] };
    const r = E.exportacionSeleccion_construirLibro(datos({ itf, wellIds: ['01-0001', '14-0001', '14-0002'] }));
    expect(r.filas.map((f) => f.tiene_itf)).toEqual(['', '', '']);
  });

  test('NE: Sí / No con el conjunto; dataset no cargado (null) -> vacio', () => {
    expect(m.filas.map((f) => f.tiene_ne)).toEqual(['Sí', 'No', 'No', 'No', 'No']);
    const r = E.exportacionSeleccion_construirLibro(datos({ neSet: null }));
    expect(r.filas.every((f) => f.tiene_ne === '')).toBe(true);
    const r2 = E.exportacionSeleccion_construirLibro(datos({ neSet: ['01-0001'] }));                  // algo que no es un Set no cuenta
    expect(r2.filas.every((f) => f.tiene_ne === '')).toBe(true);
  });

  test('aptitud: Apto / Dudoso / No apto / Sin evaluar; sin resumen cargado -> vacio (no se afirma "Sin evaluar")', () => {
    expect(m.filas.map((f) => f.aptitud_reemplazo)).toEqual(['Apto', 'No apto', 'Dudoso', 'Sin evaluar', 'Sin evaluar']);
    const r = E.exportacionSeleccion_construirLibro(datos({ resumenReemplazo: null }));
    expect(r.filas.every((f) => f.aptitud_reemplazo === '')).toBe(true);
  });

  test('departamento por codigo del wellId, con el nombre humano', () => {
    expect(fila('01-0001').departamento).toBe('Capital');
    expect(m.filas.map((f) => f.departamento)).toEqual(['01', '14', '14', '14', '14'].map((c) => mapaLogic_nombreDepartamento(c)));
  });
});

describe('orden y filtros: lo que se exporta es lo que la tabla muestra', () => {
  // filas de la tabla con la forma de construirFilasOrdenadasYFiltradas
  const filaTabla = (wellId, extra) => Object.assign({
    wellId, titular: 'T ' + wellId, nc16: '—', departamento: mapaLogic_nombreDepartamento(wellId.substring(0, 2)), cuenca: 'C', profundidadNum: -1
  }, extra || {});
  const filas = [
    filaTabla('14-0003', { cuenca: 'Beta', profundidadNum: 10, titular: 'ZETA' }),
    filaTabla('01-0001', { cuenca: 'Alfa', profundidadNum: 300 }),
    filaTabla('14-0001', { cuenca: 'Alfa', profundidadNum: 50 }),
    filaTabla('14-0002', { cuenca: 'Gamma', profundidadNum: -1 })
  ];
  const exportar = (opciones) => {
    const visibles = seleccionLogic_filtrarYOrdenarFilas(filas, opciones).map((f) => f.wellId);
    return E.exportacionSeleccion_construirLibro(datos({ wellIds: visibles, totalSeleccion: filas.length, filtros: opciones, indicePozos: INDICE })).filas.map((f) => f.wellId);
  };

  test.each([
    ['wellId', ['01-0001', '14-0001', '14-0002', '14-0003']],
    ['departamento', ['01-0001', '14-0001', '14-0002', '14-0003']],
    ['cuenca', ['01-0001', '14-0001', '14-0003', '14-0002']],
    ['profundidad', ['01-0001', '14-0001', '14-0003', '14-0002']]
  ])('orden "%s": el archivo sale en el mismo orden que la tabla', (orden, esperado) => {
    expect(exportar({ texto: '', orden, resumen: null, aptitudActivos: {} })).toEqual(esperado);
  });

  test('la busqueda filtra: solo salen los pozos visibles (no toda la seleccion)', () => {
    expect(exportar({ texto: 'alfa', orden: 'wellId', resumen: null, aptitudActivos: {} })).toEqual(['01-0001', '14-0001']);
    expect(exportar({ texto: '14-000', orden: 'profundidad', resumen: null, aptitudActivos: {} })).toEqual(['14-0001', '14-0003', '14-0002']);
  });

  test('la busqueda tambien mira el titular (igual que la tabla) aunque el titular no se exporte', () => {
    const visibles = seleccionLogic_filtrarYOrdenarFilas(filas, { texto: 'zeta' }).map((f) => f.wellId);
    expect(visibles).toEqual(['14-0003']);
    const m = E.exportacionSeleccion_construirLibro(datos({ wellIds: visibles, totalSeleccion: 4, filtros: { texto: 'zeta' } }));
    expect(JSON.stringify(m)).not.toMatch(/ZETA/);
  });

  test('el filtro de aptitud actua con AND sobre la busqueda y el orden', () => {
    const resumen = { '01-0001': 'APTO', '14-0001': 'APTO', '14-0003': 'DUDOSO' };
    const o = { texto: '', orden: 'profundidad', resumen, aptitudActivos: { APTO: true } };
    expect(exportar(o)).toEqual(['01-0001', '14-0001']);
    expect(exportar(Object.assign({}, o, { aptitudActivos: { APTO: true, DUDOSO: true } }))).toEqual(['01-0001', '14-0001', '14-0003']);
    expect(exportar(Object.assign({}, o, { texto: 'beta' }))).toEqual([]);
  });

  test('el filtro de aptitud sin resumen cargado no filtra (igual que la tabla)', () => {
    expect(exportar({ texto: '', orden: 'wellId', resumen: null, aptitudActivos: { APTO: true } })).toHaveLength(4);
  });

  test('filtrar y ordenar no muta la lista original', () => {
    const copia = filas.map((f) => f.wellId);
    seleccionLogic_filtrarYOrdenarFilas(filas, { texto: 'a', orden: 'profundidad' });
    expect(filas.map((f) => f.wellId)).toEqual(copia);
  });

  test('el modelo NO reordena: respeta el orden recibido aunque no sea alfabetico', () => {
    const r = E.exportacionSeleccion_construirLibro(datos({ wellIds: ['14-0003', '01-0001', '14-0002'], totalSeleccion: 3 }));
    expect(r.filas.map((f) => f.wellId)).toEqual(['14-0003', '01-0001', '14-0002']);
    expect(r.libro.hojas[0].filas.slice(1).map((f) => f[0])).toEqual(['14-0003', '01-0001', '14-0002']);
  });

  test('una tabla filtrada a 0 pozos exporta 0 filas', () => {
    const r = E.exportacionSeleccion_construirLibro(datos({ wellIds: [], totalSeleccion: 4, filtros: { texto: 'nada' } }));
    expect(r.filas).toEqual([]);
    expect(r.libro.hojas[0].filas).toHaveLength(1);                           // solo el encabezado
  });
});

describe('nombre de archivo', () => {
  test('dgi-pozos-seleccion-AAAA-MM-DD.xlsx con la fecha de Mendoza', () => {
    expect(E.exportacionSeleccion_nombreArchivo(AHORA)).toBe('dgi-pozos-seleccion-2026-10-26.xlsx');
  });

  test('cerca de medianoche usa el dia de Mendoza, no el UTC', () => {
    expect(E.exportacionSeleccion_nombreArchivo(new Date('2026-10-26T02:30:00Z'))).toBe('dgi-pozos-seleccion-2026-10-25.xlsx');      // 23:30 del 25 en Mendoza
    expect(E.exportacionSeleccion_nombreArchivo(new Date('2026-10-26T03:00:00Z'))).toBe('dgi-pozos-seleccion-2026-10-26.xlsx');      // 00:00 del 26
    expect(E.exportacionSeleccion_nombreArchivo(new Date('2026-01-01T02:59:59Z'))).toBe('dgi-pozos-seleccion-2025-12-31.xlsx');      // cambio de anio
  });

  test('no incluye cantidades, wellId, usuario ni filtros: depende solo de la fecha', () => {
    const a = E.exportacionSeleccion_construirLibro(datos({ wellIds: ['01-0001'] })).nombreArchivo;
    const b = E.exportacionSeleccion_construirLibro(datos({ filtros: { texto: 'PEREZ', orden: 'cuenca', aptitudActivos: { APTO: true } } })).nombreArchivo;
    expect(a).toBe('dgi-pozos-seleccion-2026-10-26.xlsx');
    expect(b).toBe(a);
    expect(a).toMatch(/^dgi-pozos-seleccion-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  test('una fecha invalida o ausente no rompe: usa el momento actual con el mismo formato', () => {
    expect(E.exportacionSeleccion_nombreArchivo(undefined)).toMatch(/^dgi-pozos-seleccion-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(E.exportacionSeleccion_nombreArchivo(new Date('x'))).toMatch(/^dgi-pozos-seleccion-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe('hoja Informacion', () => {
  const info = (extra) => Object.fromEntries(E.exportacionSeleccion_construirLibro(datos(extra)).informacion);
  const claves = (extra) => E.exportacionSeleccion_construirLibro(datos(extra)).informacion.map((p) => p[0]);

  test('sin filtros: fecha en Mendoza y UTC (texto estable), cantidad, periodo, origen, orden y columnas', () => {
    expect(E.exportacionSeleccion_construirLibro(datos()).informacion).toEqual([
      ['Generado (Mendoza)', '2026-10-26 11:03:09 (Mendoza, UTC-3)'],
      ['Generado (UTC)', '2026-10-26T14:03:09Z'],
      ['Cantidad de pozos', 5],
      ['Período del padrón', 'mayo 2026'],
      ['Origen', 'Mi selección'],
      ['Orden actual', 'Pozo'],
      ['Columnas incluidas', 'Pozo, Departamento, Cuenca, Profundidad (m), Tipo de pozo, Estado de ubicación, Latitud, Longitud, Tiene ITF, Tiene NE, Aptitud para reemplazo']
    ]);
  });

  test('las fechas son texto (no celdas de fecha de Excel) y el reloj es inyectable', () => {
    const otro = Object.fromEntries(E.exportacionSeleccion_construirLibro(datos({ ahora: new Date('2027-02-03T04:05:06Z') })).informacion);
    expect(otro['Generado (UTC)']).toBe('2027-02-03T04:05:06Z');
    expect(otro['Generado (Mendoza)']).toBe('2027-02-03 01:05:06 (Mendoza, UTC-3)');
    expect(typeof info()['Generado (Mendoza)']).toBe('string');
    expect(typeof info()['Generado (UTC)']).toBe('string');
  });

  test('"Búsqueda aplicada" solo si hay texto; se recorta y se limita a 200 caracteres', () => {
    expect(claves()).not.toContain('Búsqueda aplicada');
    expect(claves({ filtros: { texto: '   ', orden: 'wellId' } })).not.toContain('Búsqueda aplicada');
    expect(info({ filtros: { texto: '  Valle  ', orden: 'wellId' } })['Búsqueda aplicada']).toBe('Valle');
    expect(info({ filtros: { texto: 'x'.repeat(500), orden: 'wellId' } })['Búsqueda aplicada']).toHaveLength(E.EXPORTACION_SELECCION_MAX_BUSQUEDA);
  });

  test('"Filtro de aptitud" solo con chips activos y permiso reemplazo === true, en orden canonico', () => {
    expect(claves()).not.toContain('Filtro de aptitud');
    expect(claves({ filtros: { texto: '', orden: 'wellId', aptitudActivos: { APTO: false } } })).not.toContain('Filtro de aptitud');
    expect(info({ filtros: { texto: '', orden: 'wellId', aptitudActivos: { APTO: true } } })['Filtro de aptitud']).toBe('Apto');
    expect(info({ filtros: { texto: '', orden: 'wellId', aptitudActivos: { SIN_EVALUAR: true, APTO: true, NO_APTO: true } } })['Filtro de aptitud']).toBe('Apto, No apto, Sin evaluar');
    expect(claves({ permisos: { ubicacion: true }, filtros: { texto: '', orden: 'wellId', aptitudActivos: { APTO: true } } })).not.toContain('Filtro de aptitud');
    expect(claves({ permisos: { reemplazo: 'SI' }, filtros: { texto: '', orden: 'wellId', aptitudActivos: { APTO: true } } })).not.toContain('Filtro de aptitud');
  });

  test('"Pozos en la selección (sin filtrar)" aparece solo cuando hay busqueda o filtro activos', () => {
    expect(claves()).not.toContain('Pozos en la selección (sin filtrar)');
    const i = info({ wellIds: ['01-0001'], totalSeleccion: 40, filtros: { texto: 'valle', orden: 'wellId' } });
    expect(i['Pozos en la selección (sin filtrar)']).toBe(40);
    expect(i['Cantidad de pozos']).toBe(1);
  });

  test.each([['profundidad', 'Profundidad (mayor a menor)'], ['cuenca', 'Cuenca'], ['departamento', 'Departamento'], ['wellId', 'Pozo'], ['raro', 'Pozo'], [undefined, 'Pozo']])(
    'orden actual %p -> %p', (orden, texto) => {
      expect(info({ filtros: { texto: '', orden } })['Orden actual']).toBe(texto);
    });

  test('"Período del padrón" solo con un periodo AAAA-MM valido', () => {
    expect(info({ periodoPadron: '2025-12' })['Período del padrón']).toBe('diciembre 2025');
    ['', null, undefined, '2026', '2026-13', '2026-00', 'mayo 2026', 202605, '2026-5'].forEach((p) => {
      expect(claves({ periodoPadron: p })).not.toContain('Período del padrón');
    });
  });

  test('"Columnas incluidas" lista los nombres humanos de las columnas que existen', () => {
    expect(info({ permisos: {} })['Columnas incluidas']).toBe('Pozo, Departamento, Cuenca, Profundidad (m), Tipo de pozo');
    expect(info({ permisos: { ne: true } })['Columnas incluidas']).toBe('Pozo, Departamento, Cuenca, Profundidad (m), Tipo de pozo, Tiene NE');
    expect(info({ permisos: TODOS })['Columnas incluidas']).not.toMatch(/\b(ubicacion|perfil|ne|wellId)\b|_/);        // nombres humanos, no de permisos ni claves internas
  });

  test('no incluye usuario, email, token ni ids', () => {
    const texto = JSON.stringify(E.exportacionSeleccion_construirLibro(datos()).informacion);
    expect(texto).not.toMatch(/@|token|sessionToken|clientRequestId|drive|usuario|email|titular|nc16/i);
  });

  test('la hoja Informacion es de dos columnas (Dato / Valor), con encabezado en negrita', () => {
    const hoja = E.exportacionSeleccion_construirLibro(datos()).libro.hojas[1];
    expect(hoja.nombre).toBe('Información');
    expect(hoja.filas[0]).toEqual([{ texto: 'Dato', estilo: XLSX_ESTILOS.encabezado }, { texto: 'Valor', estilo: XLSX_ESTILOS.encabezado }]);
    hoja.filas.forEach((f) => { expect(f).toHaveLength(2); });
    expect(hoja.filas[3]).toEqual(['Cantidad de pozos', 5]);                    // la cantidad es un numero, no texto
  });
});

describe('hoja Pozos', () => {
  const hoja = E.exportacionSeleccion_construirLibro(datos()).libro.hojas[0];

  test('nombre, encabezado en negrita, primera fila congelada, autofiltro y un ancho por columna', () => {
    expect(hoja.nombre).toBe('Pozos');
    expect(hoja.filas[0].every((c) => c.estilo === XLSX_ESTILOS.encabezado)).toBe(true);
    expect(hoja.filas[0].map((c) => c.texto)).toEqual(['Pozo', 'Departamento', 'Cuenca', 'Profundidad (m)', 'Tipo de pozo', 'Estado de ubicación', 'Latitud', 'Longitud', 'Tiene ITF', 'Tiene NE', 'Aptitud para reemplazo']);
    expect(hoja.congelarPrimeraFila).toBe(true);
    expect(hoja.autofiltro).toBe(true);
    expect(hoja.anchos).toHaveLength(11);
    expect(hoja.anchos.every((a) => a > 0)).toBe(true);
  });

  test('latitud y longitud llevan el estilo de 6 decimales; profundidad es numero sin estilo; el resto texto', () => {
    const fila = hoja.filas[1];
    expect(fila[3]).toBe(139.5);
    expect(fila[6]).toEqual({ numero: -33.34765, estilo: XLSX_ESTILOS.coordenada });
    expect(fila[7]).toEqual({ numero: -69.14545, estilo: XLSX_ESTILOS.coordenada });
    expect(fila[0]).toBe('01-0001');
  });

  test('una coordenada ausente queda como celda vacia (null), nunca 0 ni texto', () => {
    const fila = hoja.filas.find((f) => f[0] === '14-0003');
    expect(fila[6]).toBeNull();
    expect(fila[7]).toBeNull();
  });
});

describe('privacidad: nada de titular, NC16, emails ni ids en el modelo ni en el archivo', () => {
  const MARCAS = ['PEREZ JUAN', '0101200022000019', 'a@b.com', 'req-1', 'drv', 'Valeria', 'tok'];

  test('los datasets traen campos prohibidos y NO llegan al modelo', () => {
    const m = E.exportacionSeleccion_construirLibro(datos());
    const texto = JSON.stringify(m);
    MARCAS.forEach((marca) => { expect(texto).not.toContain(marca); });
    m.filas.forEach((f) => { expect(Object.keys(f)).toEqual(m.columnas.map((c) => c.clave)); });
  });

  test('tampoco en el XLSX generado (ninguna parte del paquete)', async () => {
    const m = E.exportacionSeleccion_construirLibro(datos());
    const bytes = await xlsxLogic_generar(m.libro, JSZip);
    const zip = await JSZip.loadAsync(bytes);
    for (const ruta of Object.keys(zip.files).filter((r) => !zip.files[r].dir)) {
      const contenido = await zip.file(ruta).async('string');
      MARCAS.forEach((marca) => { expect(contenido).not.toContain(marca); });
    }
  });

  test('con los permisos de datos activados (titular / nc16) la exportacion sigue sin llevarlos', () => {
    const m = E.exportacionSeleccion_construirLibro(datos({ permisos: Object.assign({ datos: true, titular: true, nc16: true, exportar: true }, TODOS) }));
    expect(m.columnas).toHaveLength(11);
    expect(JSON.stringify(m)).not.toMatch(/titular|nc16|PEREZ|0101200022000019/i);
  });

  test('wellIds con campos extra tipo objeto no se cuelan: la fila solo trae las claves del catalogo', () => {
    const m = E.exportacionSeleccion_construirLibro(datos({ itf: Object.assign({ titular: 'X', token: 'Y' }, ITF), neSet: Object.assign(new Set(['01-0001']), { titular: 'Z' }) }));
    expect(JSON.stringify(m)).not.toMatch(/"X"|"Y"|"Z"/);
  });
});

describe('texto peligroso en los datos: queda literal, nunca formula', () => {
  test('cuenca con =, +, -, @ y saltos de linea viaja como texto en el XLSX', async () => {
    const hostil = ['=1+1', '+SUM(A1)', '-2+3', '@A1', '\t=x', 'linea1\nlinea2', '1/2', '<script>&"', 'x\u0000y'];
    const idx = {};
    const ids = hostil.map((c, i) => { const id = '14-' + String(i + 1).padStart(4, '0'); idx[id] = punto(id, { cuenca: c }); return id; });
    const m = E.exportacionSeleccion_construirLibro(datos({ wellIds: ids, indicePozos: idx, permisos: {} }));
    const bytes = await xlsxLogic_generar(m.libro, JSZip);
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(xml).not.toMatch(/<f[ >]/);
    expect(xml).toContain('<t xml:space="preserve">=1+1</t>');
    expect(xml).toContain('<t xml:space="preserve">+SUM(A1)</t>');
    expect(xml).toContain('<t xml:space="preserve">linea1\nlinea2</t>');
    expect(xml).toContain('&lt;script&gt;&amp;&quot;');
    expect(xml).toContain('<t xml:space="preserve">xy</t>');
  });
});

describe('libro de 0 filas y escala', () => {
  test('0 filas: libro valido con encabezado + hoja Informacion (cantidad 0)', async () => {
    const m = E.exportacionSeleccion_construirLibro(datos({ wellIds: [], totalSeleccion: 0 }));
    expect(m.filas).toEqual([]);
    expect(Object.fromEntries(m.informacion)['Cantidad de pozos']).toBe(0);
    const zip = await JSZip.loadAsync(await xlsxLogic_generar(m.libro, JSZip));
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining(['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(hoja.match(/<row /g)).toHaveLength(1);
    expect(hoja).toContain('<autoFilter ref="A1:K1"/>');
  });

  test('datos ausentes (sin argumentos) no revientan', () => {
    const m = E.exportacionSeleccion_construirLibro(undefined);
    expect(m.filas).toEqual([]);
    expect(m.columnas.map((c) => c.clave)).toEqual(BASE);
  });

  const fabricar = (n) => {
    const idx = {};
    const ids = [];
    const itf = { disponibilidad: {}, desconocidos: [] };
    for (let i = 0; i < n; i += 1) {
      const id = String(1 + (i % 18)).padStart(2, '0') + '-' + String(i).padStart(4, '0');
      ids.push(id);
      idx[id] = punto(id, { lat: -33 - (i % 1000) / 1000, lon: -68 - (i % 1000) / 997, profundidad: i % 5 === 0 ? undefined : i % 400 + 0.5 });
      itf.disponibilidad[id] = i % 3 === 0;
    }
    return { ids, idx, itf };
  };

  test.each([[1], [10], [1000], [5000], [13804]])('%i pozos: el modelo y el XLSX se generan, se vuelven a abrir y con tiempo razonable', async (n) => {
    const { ids, idx, itf } = fabricar(n);
    const t0 = Date.now();
    const m = E.exportacionSeleccion_construirLibro(datos({ wellIds: ids, indicePozos: idx, itf, totalSeleccion: n, resumenReemplazo: {}, neSet: new Set() }));
    const bytes = await xlsxLogic_generar(m.libro, JSZip);
    const ms = Date.now() - t0;
    const zip = await JSZip.loadAsync(bytes);
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(hoja.match(/<row /g)).toHaveLength(n + 1);
    expect(hoja).not.toMatch(/<f[ >]/);
    expect(ms).toBeLessThan(15000);
    if (n >= 5000) { process.stdout.write('   [escala] ' + n + ' pozos: ' + ms + ' ms, ' + Math.round(bytes.length / 1024) + ' KB\n'); }
  }, 60000);
});

describe('el modelo es puro y solo usa el catalogo', () => {
  const fuente = fs.readFileSync(path.join(__dirname, 'exportacionSeleccionLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('no toca DOM, red, almacenamiento ni descargas', () => {
    expect(fuente).not.toMatch(/\bdocument\b|\bwindow\b|\bfetch\b|XMLHttpRequest|localStorage|sessionStorage|\bBlob\b|createObjectURL|\bnavigator\b|apiGet|apiRegister/);
  });

  test('no conoce campos personales ni identificadores internos', () => {
    expect(fuente).not.toMatch(/titular|nc16|domicilio|email|sessionToken|clientRequestId|driveFileId|nombreAgente|secuencia|observacion/i);
  });

  test('no ordena: ninguna llamada a sort / reverse sobre las filas', () => {
    expect(fuente).not.toMatch(/\.sort\(|\.reverse\(/);
  });
});
