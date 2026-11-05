// E10-1 paso 0: diagnostico de SOLO LECTURA (DiagnosticoE10.js). Se prueba con Apps Script falso: nada toca Google. Lo central: no escribe NADA (hojas, propiedades, cache, lock, Telegram, email),
// tolera columnas faltantes, filas invalidas y hojas vacias, mide lo que el login interpreta hoy y no expone datos sensibles.
const fs = require('fs');
const path = require('path');
const { instalarSheetsFalsos } = require('./fakeSheets');

// En Apps Script estas funciones del login son globales (otro archivo del proyecto); el diagnostico las usa para medir EXACTAMENTE lo que el sistema interpreta.
Object.assign(global, require('../src/PermisosCatalogo'));
Object.assign(global, require('../src/UsuariosDominio'));
Object.assign(global, require('../src/SheetUserRepository'));
const D = require('../src/DiagnosticoE10');

const COLS = ['email', 'nombre', 'estado', 'fecha_alta', 'perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ne', 'reemplazo', 'fotos', 'fotos_carga', 'fotos_moderar', 'ubicacion_corregir', 'ubicacion_validar', 'observaciones', 'observaciones_agregar', 'observaciones_anular'];
const fila = (email, nombre, estado, perms) => COLS.map((c) => (c === 'email' ? email : c === 'nombre' ? nombre : c === 'estado' ? estado : c === 'fecha_alta' ? '2026-01-01' : ((perms || []).includes(c) ? 'SI' : 'NO')));
const usuarios = (...filas) => [COLS, ...filas];

const SUG = ['sugerenciaId', 'secuencia', 'evento', 'wellId', 'fuenteTipo', 'x', 'y', 'accionSugerida', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista'];
const sug = (evento, email, ts) => ['s-1', 1, evento, '14-0130', 'PADRON', 1, 2, 'ACEPTAR', 'MOTIVO-SECRETO-123', email, 'N', ts || '2026-10-20T10:00:00.000Z', 'c', 0];
const CORR = ['correccionId', 'wellId', 'lat', 'lon', 'metodo', 'precisionGpsM', 'observacion', 'emailPropone', 'nombrePropone', 'timestamp'];
const corr = (email, ts) => ['c-1', '14-0130', -32.5, -68.5, 'GPS', '', 'OBSERVACION-SECRETA-456', email, 'N', ts || '2026-10-12 03:41:29'];
const CORRLOG = ['correccionId', 'timestamp', 'evento', 'email', 'nombre', 'motivo'];

// deps de lectura con datos en memoria (null = la hoja no existe)
const deps = (hojas, conteos) => ({
  datosHoja: (n) => (Object.prototype.hasOwnProperty.call(hojas, n) ? hojas[n] : null),
  contarFilas: (n) => (conteos && Object.prototype.hasOwnProperty.call(conteos, n) ? conteos[n] : null)
});

// Escenario base: 8 filas utiles. a=admin-like (validador completo), b=validador de ubicacion, c=operativo con corregir, d=solo ubicacion con historial, e=solo ubicacion sin historial,
// f=solo perfil con gmail, g=inactivo, h=mapa/ne.
function escenario() {
  const u = usuarios(
    fila('ana@irrigacion.gov.ar', 'Ana Perez', 'activo', ['perfil', 'perfil_subir', 'perfil_validar', 'datos', 'ubicacion', 'ubicacion_corregir', 'ubicacion_validar', 'fotos', 'fotos_moderar', 'observaciones', 'observaciones_anular', 'ne', 'reemplazo']),
    fila('beto@irrigacion.gov.ar', 'Beto Gomez', 'activo', ['perfil', 'ubicacion', 'ubicacion_validar']),
    fila('carla@irrigacion.gov.ar', 'Carla Diaz', 'activo', ['perfil', 'datos', 'ubicacion', 'ubicacion_corregir']),
    fila('dario@irrigacion.gov.ar', 'Dario Ruiz', 'activo', ['perfil', 'ubicacion']),
    fila('elena@irrigacion.gov.ar', 'Elena Sosa', 'activo', ['perfil', 'ubicacion']),
    fila('fede@gmail.com', 'Fede Lopez', 'activo', ['perfil']),
    fila('gaby@irrigacion.gov.ar', 'Gaby Luna', 'inactivo', ['perfil', 'ubicacion']),
    fila('hugo@irrigacion.gov.ar', 'Hugo Paz', 'Activo ', ['ne'])
  );
  const hojas = {
    Usuarios: u,
    UbicacionFuenteSugerencias: [SUG, sug('PROPUESTA', 'dario@irrigacion.gov.ar'), sug('CANCELADA', 'dario@irrigacion.gov.ar'), sug('APROBADA', 'beto@irrigacion.gov.ar'), sug('PROPUESTA', 'desconocido@otro.com')],
    UbicacionCorrecciones: [CORR, corr('carla@irrigacion.gov.ar'), corr('ana@irrigacion.gov.ar', '2026-10-13 08:00:00')],
    UbicacionCorreccionesLog: [CORRLOG, ['c-1', '2026-10-12 03:41:29', 'PROPUESTA', 'carla@irrigacion.gov.ar', 'N', ''], ['c-1', '2026-10-12 15:01:53', 'VALIDADA', 'beto@irrigacion.gov.ar', 'N', 'MOTIVO-SECRETO-123']],
    UbicacionFuenteDecisiones: [['decisionId', 'secuencia', 'wellId', 'fuenteTipo', 'x', 'y', 'evento', 'motivo', 'email', 'nombre', 'timestampUtc', 'clientRequestId', 'versionVista', 'padronPeriodo'], ['d-1', 1, '14-0130', 'PADRON', 1, 2, 'ACEPTADA', 'm', 'ana@irrigacion.gov.ar', 'N', '2026-10-21T10:00:00.000Z', 'c', 0, 'p']]
  };
  return { hojas, conteos: { Busquedas: 120, Historial: 5400 } };
}
const informe = (e) => D.diagE10_construir(deps(e.hojas, e.conteos));

describe('forma del informe', () => {
  test('tiene exactamente las secciones pedidas y se declara de solo lectura', () => {
    const r = informe(escenario());
    expect(Object.keys(r)).toEqual(['version', 'soloLectura', 'usuarios', 'mapa', 'ubicacion', 'administradores', 'tipo', 'email_verified', 'telegram', 'errores', 'recomendaciones']);
    expect(r.soloLectura).toBe(true);
    expect(r.errores).toEqual([]);
    expect(() => JSON.parse(JSON.stringify(r))).not.toThrow();
  });
});

describe('A. usuarios', () => {
  test('cuenta filas validas, activos, inactivos y normaliza el estado como el login (trim/minuscula)', () => {
    const r = informe(escenario()).usuarios;
    expect(r.filasValidas).toBe(8);
    expect(r.activos).toBe(7);          // "Activo " cuenta como activo, igual que el login
    expect(r.inactivos).toBe(1);
    expect(r.activosEfectivos).toBe(7);
    expect(r.emailsInvalidos.cantidad).toBe(0);
    expect(r.estadosCrudos).toEqual({ activo: 7, inactivo: 1 });
  });

  test('emails duplicados: gana la PRIMERA fila (como el login) y se marca el conflicto de estado', () => {
    const e = escenario();
    e.hojas.Usuarios.push(fila('ANA@irrigacion.gov.ar', 'Ana bis', 'inactivo', []));      // misma persona, otra fila, distinto estado
    e.hojas.Usuarios.push(fila('dario@irrigacion.gov.ar', 'Dario bis', 'activo', ['perfil'])); // repetida sin conflicto
    const r = informe(e).usuarios;
    expect(r.duplicados.grupos).toBe(2);
    expect(r.duplicados.conflictoDeEstado).toBe(1);
    expect(r.usuariosEfectivos).toBe(8);
    expect(r.duplicados.detalle.some((d) => /ESTADOS DISTINTOS/.test(d) && /gana 2/.test(d))).toBe(true);
    expect(JSON.stringify(r.duplicados)).not.toContain('ana@irrigacion.gov.ar');          // enmascarado
  });

  test('filas con email invalido o vacio: se cuentan y se listan por numero de fila, sin exponer el contenido', () => {
    const e = escenario();
    e.hojas.Usuarios.push(fila('sin-arroba', 'X', 'activo', ['perfil']));
    e.hojas.Usuarios.push(fila('', 'Sin email', 'activo', ['perfil']));
    const r = informe(e).usuarios;
    expect(r.emailsInvalidos.cantidad).toBe(2);
    expect(r.emailsInvalidos.filas).toBe('10-11');
    expect(r.filasValidas).toBe(8);
    expect(JSON.stringify(r)).not.toContain('sin-arroba');
  });

  test('columnas: presentes, faltantes, repetidas, desconocidas y propuestas E10 que ya existen / no', () => {
    const e = escenario();
    e.hojas.Usuarios = [COLS.filter((c) => c !== 'ne').concat(['tipo', 'mapa', 'Notas', 'perfil']), ...e.hojas.Usuarios.slice(1).map((f) => f.slice(0, 18))];
    const c = informe(e).usuarios.columnas;
    expect(c.actualesFaltantes).toEqual(['ne']);
    expect(c.repetidas).toEqual(['perfil']);
    expect(c.desconocidas).toEqual(['notas']);
    expect(c.propuestasE10).toEqual({ tipo: true, version: false, actualizado_utc: false, actualizado_por: false, usuarios_admin: false, mapa: true });
    expect(c.detectadas).toContain('tipo');
  });

  test('permisos: cuenta SI de activos / inactivos, celdas vacias y valores invalidos', () => {
    const e = escenario();
    const idx = COLS.indexOf('ne');
    e.hojas.Usuarios[1][idx] = 'true';           // valor invalido: el login lo trata como NO
    e.hojas.Usuarios[2][idx] = '';               // vacio
    const p = informe(e).usuarios.permisos;
    expect(p.perfil).toEqual({ columna: true, vacios: 0, invalidos: 0, activosSI: 6, inactivosSI: 1 });
    expect(p.ne.invalidos).toBe(1);
    expect(p.ne.vacios).toBe(1);
    expect(p.ne.activosSI).toBe(1);              // hugo: el 'true' de ana no es SI
  });
});

describe('mapa', () => {
  test('universo = activos; propuesta = mapa SI a todo activo (por numero de fila); NO al resto; el uso real se declara no medible', () => {
    const r = informe(escenario()).mapa;
    expect(r.universoActivos).toBe(7);
    expect(r.propuesta.recibirianSI).toBe(7);
    expect(r.propuesta.filasSI).toBe('2-7,9');
    expect(r.propuesta.recibirianNO).toBe(1);
    expect(r.propuesta.usuariosActivosQuePerderianAcceso).toBe(0);
    expect(r.usoRealMedible).toBe(false);
    expect(r.usoFrontendHoy).toEqual({ cercaMio: 7, provinciaConPerfilOne: 7, mapaNE: 2, buscarReemplazo: 1, soloCercaMio: 0 });
    expect(r.columnaMapaExiste).toBe(false);
  });

  test('quien no tiene perfil, ne ni reemplazo solo usa "Cerca mio"', () => {
    const e = escenario();
    e.hojas.Usuarios.push(fila('ines@irrigacion.gov.ar', 'Ines', 'activo', ['datos']));
    expect(informe(e).mapa.usoFrontendHoy.soloCercaMio).toBe(1);
  });
});

describe('ubicacion', () => {
  test('mide grupos, intersecciones y las alternativas A, B y C', () => {
    const r = informe(escenario()).ubicacion;
    expect(r.activosConUbicacionSI).toBe(5);        // ana, beto, carla, dario, elena
    expect(r.conUbicacionCorregirSI).toBe(2);       // ana, carla
    expect(r.conUbicacionValidarSI).toBe(2);        // ana, beto
    expect(r.alternativas.B.cantidad).toBe(5);
    // A = con corregir (ana, carla) o autor historico (dario sugirio/cancelo; carla y ana corrigieron): ana, carla, dario
    expect(r.alternativas.A.cantidad).toBe(3);
    expect(r.alternativas.A.filas).toBe('2,4-5');
    // C = A sin validadores sin corregir: beto no estaba en A (no es autor de mutacion: solo valido/aprobo) -> C = A
    expect(r.alternativas.C.cantidad).toBe(3);
    expect(r.diferencias.pierdenSugerirConA.cantidad).toBe(2);                 // beto y elena
    expect(r.diferencias.recibenCorregirNuevoConA.cantidad).toBe(1);           // dario
    expect(r.diferencias.recibenCorregirNuevoConB).toBe(3);                    // beto, dario, elena
    expect(r.intersecciones['ubicacion+corregir+autor']).toBe(2);              // ana y carla
    expect(r.intersecciones['ubicacion+sinCorregir+autor']).toBe(1);           // dario
    expect(r.intersecciones['ubicacion+sinCorregir+sinHistorial']).toBe(2);    // beto, elena
  });

  test('las hojas de historial se resumen: eventos contados, autores sin usuario activo, decisiones de validadores aparte', () => {
    const h = informe(escenario()).ubicacion.historial;
    expect(h.sugerencias).toEqual({ hoja: 'OK', filas: 4, eventos: { sugerencias: 2, cancelaciones: 1 }, autoresDistintos: 2 });
    expect(h.correcciones.eventos).toEqual({ correcciones: 2 });
    expect(h.correccionesLog.eventos).toEqual({ correcciones_log: 1 });
    expect(h.decisionesDeValidadores.autoresDistintos).toBe(1);
    expect(h.autoresDistintos).toEqual({ sugerenciasOCancelaciones: 2, correcciones: 2, cualquierMutacion: 4 });
    expect(h.autoresQueSonUsuariosActivos).toBe(3);
    expect(h.autoresSinUsuarioActivo).toBe(1);                // desconocido@otro.com
    expect(h.validadoresConDecisiones).toBe(1);
  });

  test('un autor que hoy esta inactivo no entra a las alternativas', () => {
    const e = escenario();
    e.hojas.UbicacionFuenteSugerencias.push(sug('PROPUESTA', 'gaby@irrigacion.gov.ar'));
    const r = informe(e).ubicacion;
    expect(r.alternativas.A.cantidad).toBe(3);
    expect(r.historial.autoresSinUsuarioActivo).toBe(2);
  });

  test('variante C: un validador con historial pero sin corregir no necesita sugerir', () => {
    const e = escenario();
    e.hojas.UbicacionFuenteSugerencias.push(sug('PROPUESTA', 'beto@irrigacion.gov.ar'));
    const r = informe(e).ubicacion;
    expect(r.alternativas.A.cantidad).toBe(4);
    expect(r.alternativas.C.cantidad).toBe(3);
    expect(r.diferencias.cConRespectoAA).toBe(1);
  });

  test('anomalias: corregir o validar sin ubicacion', () => {
    const e = escenario();
    e.hojas.Usuarios.push(fila('ines@irrigacion.gov.ar', 'Ines', 'activo', ['ubicacion_corregir', 'ubicacion_validar']));
    expect(informe(e).ubicacion.anomalias).toEqual({ corregirSinUbicacion: 1, validarSinUbicacion: 1 });
  });

  test('sin hojas de historial: todo en 0 y el informe sigue siendo util', () => {
    const e = escenario();
    ['UbicacionFuenteSugerencias', 'UbicacionCorrecciones', 'UbicacionCorreccionesLog', 'UbicacionFuenteDecisiones'].forEach((h) => delete e.hojas[h]);
    const r = informe(e).ubicacion;
    expect(r.historial.sugerencias.hoja).toBe('NO_EXISTE');
    expect(r.alternativas.A.cantidad).toBe(2);    // solo quienes ya tienen corregir
    expect(r.alternativas.B.cantidad).toBe(5);
  });

  test('la lista de quienes perderian "Sugerir" identifica por fila y nombre, con el email enmascarado', () => {
    const p = informe(escenario()).ubicacion.diferencias.pierdenSugerirConA.personas;
    expect(p).toHaveLength(2);
    expect(p[0]).toMatch(/^fila 3 \| Beto Gomez \| b\*\*\*@irrigacion\.gov\.ar/);
  });
});

describe('administradores', () => {
  test('lista candidatos entre activos con autoridad, completos (nombre + email), ordenados por autoridad y sin asignar nada', () => {
    const r = informe(escenario()).administradores;
    expect(r.totalActivos).toBe(7);
    expect(r.columnaUsuariosAdminExiste).toBe(false);
    expect(r.candidatos).toHaveLength(2);             // ana (4 autoridades) y beto (1)
    expect(r.candidatos[0]).toMatch(/^fila 2 \| Ana Perez \| ana@irrigacion\.gov\.ar \| motivo=autoridad \| autoridad=perfil_validar,ubicacion_validar,fotos_moderar,observaciones_anular \| permisos\(13\)=/);
    expect(r.candidatos[1]).toMatch(/^fila 3 \| Beto Gomez \| beto@irrigacion\.gov\.ar \| motivo=autoridad \| autoridad=ubicacion_validar/);
    expect(r.nota).toMatch(/no se asigna nada/);
  });

  test('con menos de 2 candidatos por autoridad agrega los de mas permisos como "amplio"', () => {
    const e = escenario();
    e.hojas.Usuarios = usuarios(fila('uno@x.com', 'Uno', 'activo', ['perfil_validar', 'perfil']), fila('dos@x.com', 'Dos', 'activo', ['perfil', 'datos', 'ne']), fila('tres@x.com', 'Tres', 'activo', ['perfil']));
    const r = informe(e).administradores;
    expect(r.candidatos.map((c) => c.split(' | ')[3])).toEqual(['motivo=autoridad', 'motivo=amplio', 'motivo=amplio']);
    expect(r.candidatos[1]).toMatch(/dos@x\.com/);
  });

  test('sin activos: sin candidatos y lo dice', () => {
    const e = escenario();
    e.hojas.Usuarios = usuarios(fila('uno@x.com', 'Uno', 'inactivo', ['perfil_validar']));
    const r = informe(e).administradores;
    expect(r.candidatos).toEqual([]);
    expect(r.sinCandidatosConAutoridad).toBe(true);
  });

  test('detecta si ya existe la columna usuarios_admin (sin leerla ni asignarla)', () => {
    const e = escenario();
    e.hojas.Usuarios = [COLS.concat(['usuarios_admin']), ...e.hojas.Usuarios.slice(1).map((f) => f.concat(['SI']))];
    expect(informe(e).administradores.columnaUsuariosAdminExiste).toBe(true);
  });
});

describe('tipo', () => {
  test('mide dominios y lista dudosos (correo personal, solo perfil, sin permisos, sin nombre) con el email enmascarado', () => {
    const e = escenario();
    e.hojas.Usuarios.push(fila('sinperm@irrigacion.gov.ar', 'Sin Perm', 'activo', []));
    e.hojas.Usuarios.push(fila('ana2@irrigacion.gov.ar', '', 'activo', ['perfil', 'datos']));
    const r = informe(e).tipo;
    expect(r.totalActivos).toBe(9);
    expect(r.dominios).toEqual({ 'irrigacion.gov.ar': 8, 'gmail.com': 1 });
    expect(r.correoPersonalGratuito).toBe(1);
    expect(r.dudosos.porMotivo).toEqual({ correo_personal: 1, solo_perfil: 1, sin_permisos: 1, sin_nombre: 1 });
    expect(r.dudosos.cantidad).toBe(3);                      // fede (gmail + solo perfil), sinperm, ana2 (sin nombre)
    expect(r.parecenInternos).toBe(6);
    expect(r.sinSenalDeExterno).toBe(false);
    expect(r.dudosos.lista.join('\n')).toMatch(/f\*\*\*@gmail\.com/);
    expect(JSON.stringify(r)).not.toContain('fede@gmail.com');
    expect(r.columnaTipoExiste).toBe(false);
    expect(r.recomendacion).toMatch(/NO se asigna nada/);
  });

  test('sin dudosos: lo dice', () => {
    const e = escenario();
    e.hojas.Usuarios = usuarios(fila('a@irrigacion.gov.ar', 'A', 'activo', ['perfil', 'datos']), fila('b@irrigacion.gov.ar', 'B', 'activo', ['perfil', 'ne']));
    const r = informe(e).tipo;
    expect(r.dudosos.cantidad).toBe(0);
    expect(r.sinSenalDeExterno).toBe(true);
  });
});

describe('email_verified (estatico)', () => {
  test('declara explicitamente que no es medible sin un login real y describe formas seguras de observarlo', () => {
    const r = informe(escenario()).email_verified;
    expect(r.medibleAhora).toBe(false);
    expect(r.motivo).toMatch(/login real/);
    expect(r.loQueSeSabe.documentacionGoogle).toMatch(/cadena/);
    expect(r.formasSegurasDeObservar).toHaveLength(2);
    expect(r.formasSegurasDeObservar[0]).toMatch(/NO copiar/);
  });
});

describe('telegram / telemetria (estatico + conteos)', () => {
  afterEach(() => { delete global.NOTIFY_DEDUPE_SECONDS; delete global.DESCARGA_ITF_NOTIFY_DEDUPE_SECONDS; delete global.SELECCION_LOTE_MAX_WELLIDS; });

  test('quien puede invocar, a cuantos alcanzaria la recomendacion y el volumen teorico', () => {
    global.NOTIFY_DEDUPE_SECONDS = 30;
    global.DESCARGA_ITF_NOTIFY_DEDUPE_SECONDS = 10;
    global.SELECCION_LOTE_MAX_WELLIDS = 500;
    const e = escenario();
    e.hojas.Usuarios.push(fila('sin@x.com', 'Sin', 'activo', ['mapa']));          // 'mapa' no es una columna actual: no concede nada
    const r = informe(e).telegram;
    expect(r.estatico).toBe(true);
    expect(r.usuariosConAcceso.activos).toBe(8);
    expect(r.usuariosConAcceso.conAlgunModuloDeBusqueda).toBe(7);
    expect(r.usuariosConAcceso.sinNingunModuloDeBusqueda).toBe(1);
    expect(r.usuariosConAcceso.conPerfilQueDescargaITF).toBe(6);
    expect(r.quedariaDenegadoConLaRecomendacion).toEqual({ registerWellSearch: 1, registerDescargaItf: 2 });
    expect(r.volumenTeorico.dedupeBusquedaSegundos).toBe(30);
    expect(r.volumenTeorico.dedupeDescargaSegundos).toBe(10);
    expect(r.volumenTeorico.maxWellIdsPorResumen).toBe(500);
    expect(r.volumenTeorico.wellIdsDistintosValidos).toBe(190000);
    expect(r.volumenTeorico.filasMaxTeoricasDeBusquedas).toBe(1111111);
    expect(r.volumenActual).toEqual({ filasBusquedas: 120, filasHistorial: 5400 });
  });

  test('sin constantes del backend cargadas (modo test) informa null en lugar de inventar', () => {
    const r = informe(escenario()).telegram.volumenTeorico;
    expect(r.dedupeBusquedaSegundos).toBeNull();
    expect(r.maxWellIdsPorResumen).toBeNull();
  });

  test('si no se pueden contar las filas de Busquedas / Historial: null, sin romper', () => {
    const e = escenario();
    e.conteos = undefined;
    expect(informe(e).telegram.volumenActual).toEqual({ filasBusquedas: null, filasHistorial: null });
  });
});

describe('recomendaciones', () => {
  test('con los datos base: lista el mapa, la ubicacion, los administradores, el tipo y la telemetria; sin bloqueantes', () => {
    const r = informe(escenario()).recomendaciones;
    expect(r.listoParaMigrar).toBe(true);
    expect(r.bloqueantes).toEqual([]);
    expect(r.recomendaciones.join('\n')).toMatch(/MAPA: escribir mapa = SI a las 7 fila\(s\)/);
    expect(r.recomendaciones.join('\n')).toMatch(/UBICACION: A = 3 vs B = 5/);
    expect(r.recomendaciones.join('\n')).toMatch(/ADMINISTRADORES: elegir al menos 2/);
    expect(r.recomendaciones.join('\n')).toMatch(/EMAIL_VERIFIED: no medible/);
  });

  test.each([
    ['hoja Usuarios inexistente', (e) => { delete e.hojas.Usuarios; }, 'USUARIOS_ILEGIBLE'],
    ['hoja Usuarios vacia', (e) => { e.hojas.Usuarios = []; }, 'USUARIOS_ILEGIBLE'],
    ['sin columna email', (e) => { e.hojas.Usuarios = [COLS.filter((c) => c !== 'email'), ['x', 'activo']]; }, 'FALTA_COLUMNA_EMAIL_O_ESTADO'],
    ['sin columna estado', (e) => { e.hojas.Usuarios = [COLS.filter((c) => c !== 'estado'), ['a@x.com', 'x']]; }, 'FALTA_COLUMNA_EMAIL_O_ESTADO'],
    ['email duplicado con estado distinto', (e) => { e.hojas.Usuarios.push(fila('ana@irrigacion.gov.ar', 'x', 'inactivo', [])); }, 'EMAILS_DUPLICADOS_CON_ESTADO_DISTINTO'],
    ['solo encabezado (nadie activo)', (e) => { e.hojas.Usuarios = [COLS]; }, 'SIN_USUARIOS_ACTIVOS']
  ])('%s -> bloqueante', (_n, rompe, codigo) => {
    const e = escenario();
    rompe(e);
    const r = informe(e).recomendaciones;
    expect(r.listoParaMigrar).toBe(false);
    expect(r.bloqueantes).toContain(codigo);
  });

  test('un valor de permiso invalido es bloqueante y se avisa de estados y emails raros', () => {
    const e = escenario();
    e.hojas.Usuarios[1][COLS.indexOf('datos')] = 'sí';
    e.hojas.Usuarios.push(fila('baja@x.com', 'B', 'baja', []));
    e.hojas.Usuarios.push(fila('malo', 'M', 'activo', []));
    const r = informe(e).recomendaciones;
    expect(r.bloqueantes.some((b) => /PERMISOS_CON_VALORES_INVALIDOS: datos/.test(b))).toBe(true);
    expect(r.avisos.join('\n')).toMatch(/estados distintos de activo\/inactivo: baja/);
    expect(r.avisos.join('\n')).toMatch(/email vacio o invalido/);
  });
});

describe('tolerancia', () => {
  test('columnas de permiso faltantes: nadie tiene nada, no rompe y todo da cero', () => {
    const e = escenario();
    e.hojas.Usuarios = [['email', 'estado'], ['a@x.com', 'activo'], ['b@x.com', 'inactivo']];
    const r = informe(e);
    expect(r.errores).toEqual([]);
    expect(r.usuarios.activosEfectivos).toBe(1);
    expect(r.usuarios.columnas.actualesFaltantes).toContain('perfil');
    expect(r.ubicacion.activosConUbicacionSI).toBe(0);
    expect(r.mapa.usoFrontendHoy.soloCercaMio).toBe(1);
    expect(r.administradores.candidatos).toHaveLength(1);   // "amplio": el unico activo
  });

  test('filas invalidas (numeros, null, fechas, objetos, filas cortas, filas que no son arreglo, filas vacias) no rompen ni se cuentan como usuarios', () => {
    const e = escenario();
    e.hojas.Usuarios.push(
      [42, 7, 3], [null, null], [new Date('2026-01-01'), 'x'], [{}, {}], ['solo@x.com'], 'no-es-fila', null, undefined, [], ['', '', ''],
      ['con espacios @x.com', 'N', 'activo'], ['ok@x.com', { nombre: 'obj' }, 'activo']
    );
    const r = informe(e);
    expect(r.errores).toEqual([]);
    expect(r.usuarios.hoja.filasVacias).toBe(7);  // [null,null] / [{},{}] / [] / ['','',''] / null / undefined / 'no-es-fila' no son filas con datos
    expect(r.usuarios.filasValidas).toBe(10);     // las 8 base + solo@x.com + ok@x.com
    expect(r.usuarios.emailsInvalidos.cantidad).toBe(3);   // [42,7,3], [Date,'x'] y 'con espacios @x.com'
    expect(JSON.stringify(r.usuarios)).not.toContain('con espacios');
  });

  test('hoja vacia o casi vacia: [], [[]], solo encabezado, sin hoja', () => {
    [[], [[]], [COLS], null].forEach((u) => {
      const e = escenario();
      if (u === null) { delete e.hojas.Usuarios; } else { e.hojas.Usuarios = u; }
      let r;
      expect(() => { r = informe(e); }).not.toThrow();
      expect(r.usuarios.activosEfectivos).toBe(0);
      expect(r.mapa.propuesta.recibirianSI).toBe(0);
      expect(r.recomendaciones.listoParaMigrar).toBe(false);
    });
  });

  test('todas las hojas faltan: informe igual, con las hojas de historial marcadas NO_EXISTE', () => {
    const r = D.diagE10_construir(deps({}, {}));
    expect(r.usuarios.hoja.existe).toBe(false);
    expect(r.ubicacion.historial.sugerencias.hoja).toBe('NO_EXISTE');
    expect(r.recomendaciones.bloqueantes).toContain('USUARIOS_ILEGIBLE');
  });

  test('una lectura que falla se informa como codigo (sin emails) y el resto del informe sale', () => {
    const e = escenario();
    const d = deps(e.hojas, e.conteos);
    d.datosHoja = (n) => { if (n === 'UbicacionFuenteSugerencias') { throw new Error('No se pudo leer la hoja de ana@irrigacion.gov.ar'); } return e.hojas[n] || null; };
    d.contarFilas = () => { throw new Error('boom'); };
    const r = D.diagE10_construir(d);
    expect(r.usuarios.activosEfectivos).toBe(7);
    expect(r.ubicacion.historial.sugerencias.hoja).toBe('ERROR_LECTURA');
    expect(r.errores.some((x) => /LECTURA_UbicacionFuenteSugerencias/.test(x))).toBe(true);
    expect(JSON.stringify(r.errores)).not.toContain('ana@irrigacion.gov.ar');
    expect(r.telegram.volumenActual).toEqual({ filasBusquedas: null, filasHistorial: null });
  });

  test('hojas de historial con esquema inesperado o columnas que faltan: ESQUEMA_INESPERADO, sin romper', () => {
    const e = escenario();
    e.hojas.UbicacionFuenteSugerencias = [['a', 'b'], ['x', 'y']];
    e.hojas.UbicacionCorrecciones = [['correccionId'], ['c']];
    e.hojas.UbicacionCorreccionesLog = [];
    const h = informe(e).ubicacion.historial;
    expect(h.sugerencias.hoja).toBe('ESQUEMA_INESPERADO');
    expect(h.correcciones.hoja).toBe('ESQUEMA_INESPERADO');
    expect(h.correccionesLog.hoja).toBe('VACIA');
  });

  test('leerAutores: eventos en cualquier combinacion de mayusculas, emails normalizados, fechas Date o texto, filas basura ignoradas', () => {
    const cfg = D.DIAG_E10_FUENTES_AUTORES.sugerencias;
    const r = D.diagE10_leerAutores([SUG, sug('propuesta', ' Dario@IRRIGACION.gov.ar ', new Date('2026-10-01T12:00:00Z')), sug('PROPUESTA', 'dario@irrigacion.gov.ar', '2026-10-05T00:00:00.000Z'), sug('PROPUESTA', 'no-es-email'), null, 'x', sug('APROBADA', 'beto@irrigacion.gov.ar')], cfg);
    expect(r.estado).toBe('OK');
    expect(r.autores).toEqual({ 'dario@irrigacion.gov.ar': { sugerencias: 2, primera: '2026-10-01', ultima: '2026-10-05' } });
    expect(r.eventos).toEqual({ sugerencias: 2 });
  });
});

describe('utilidades', () => {
  test('rangos compactos de filas', () => {
    expect(D.diagE10_rangos([])).toBe('');
    expect(D.diagE10_rangos([5])).toBe('5');
    expect(D.diagE10_rangos([9, 2, 3, 4, 7, 10])).toBe('2-4,7,9-10');
  });

  test('mascara de email', () => {
    expect(D.diagE10_mascara('fede@gmail.com')).toBe('f***@gmail.com');
    expect(D.diagE10_mascara('a@x.com')).toBe('a***@x.com');
    expect(D.diagE10_mascara('sin-arroba')).toBe('***');
  });

  test('email valido', () => {
    ['a@b.co', 'x.y+z@dom.gov.ar'].forEach((e) => expect(D.diagE10_emailValido(e)).toBe(true));
    ['', 'a', 'a@b', 'a b@c.com', 'a@b.com,c@d.com', null, undefined, 5, {}].forEach((e) => expect(D.diagE10_emailValido(e)).toBe(false));
  });
});

// ---------- SOLO LECTURA: lo central ----------

// Hoja que LANZA ante cualquier metodo que no sea de lectura. Si el diagnostico intentara escribir (setValue, appendRow, insertColumn, clear...), el test falla.
const PERMITIDOS_HOJA = new Set(['getName', 'getLastRow', 'getLastColumn', 'getDataRange', 'getMaxRows', 'getMaxColumns', 'nombre', 'filas', 'formatos', 'congeladas', 'columnasFisicas', 'estricta', 'formatoColumnas']);
function hojaSoloLectura(hoja, registro) {
  return new Proxy(hoja, {
    get(target, prop) {
      if (typeof prop === 'symbol') { return target[prop]; }
      registro.push(String(prop));
      if (PERMITIDOS_HOJA.has(prop)) { return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop]; }
      return () => { throw new Error('ESCRITURA PROHIBIDA: ' + String(prop)); };
    },
    set() { throw new Error('ESCRITURA PROHIBIDA (set)'); }
  });
}
function instalarTodoSoloLectura(hojasDatos) {
  const hojas = instalarSheetsFalsos(hojasDatos);
  const accesos = [];
  const proxies = {};
  Object.keys(hojas).forEach((n) => { proxies[n] = hojaSoloLectura(hojas[n], accesos); });
  global.SpreadsheetApp = {
    openById: () => ({
      getSheetByName: (n) => proxies[n] || null,
      insertSheet: () => { throw new Error('ESCRITURA PROHIBIDA: insertSheet'); }
    }),
    flush: () => { throw new Error('ESCRITURA PROHIBIDA: flush'); }
  };
  const prohibido = (nombre) => new Proxy({}, { get: () => () => { throw new Error('USO PROHIBIDO: ' + nombre); } });
  global.PropertiesService = prohibido('PropertiesService');
  global.CacheService = prohibido('CacheService');
  global.LockService = prohibido('LockService');
  global.UrlFetchApp = prohibido('UrlFetchApp');
  global.MailApp = prohibido('MailApp');
  global.GmailApp = prohibido('GmailApp');
  global.ScriptApp = prohibido('ScriptApp');
  global.DriveApp = prohibido('DriveApp');
  global.Logger = { log: jest.fn() };
  return { hojas, accesos };
}
function limpiarGlobales() {
  ['SpreadsheetApp', 'PropertiesService', 'CacheService', 'LockService', 'UrlFetchApp', 'MailApp', 'GmailApp', 'ScriptApp', 'DriveApp', 'Logger', 'getSpreadsheetId'].forEach((k) => { delete global[k]; });
}

describe('SOLO LECTURA (en ejecucion)', () => {
  afterEach(limpiarGlobales);

  test('la funcion de Apps Script corre completa sobre hojas que lanzan ante cualquier escritura, sin modificar nada y sin tocar propiedades / cache / lock / red / mail / triggers', () => {
    const e = escenario();
    const { hojas, accesos } = instalarTodoSoloLectura({ ...e.hojas, Busquedas: [['timestamp'], [1], [2]], Historial: [['timestamp'], [1]] });
    const antes = JSON.stringify(Object.keys(hojas).map((n) => hojas[n].filas));
    let r;
    expect(() => { r = D.diagnosticoE10UsuariosPermisos(); }).not.toThrow();
    expect(JSON.stringify(Object.keys(hojas).map((n) => hojas[n].filas))).toBe(antes);
    expect(r.errores).toEqual([]);
    expect(r.usuarios.activosEfectivos).toBe(7);
    expect(r.telegram.volumenActual).toEqual({ filasBusquedas: 2, filasHistorial: 1 });
    // solo metodos de lectura: nunca setValue/appendRow/insert*/delete*/clear*...
    const usados = new Set(accesos);
    ['getDataRange', 'getLastRow'].forEach((m) => expect(usados.has(m)).toBe(true));
    expect([...usados].filter((m) => /^(set|append|insert|delete|clear|remove|copy|move|hide|protect|sort|merge)/i.test(m))).toEqual([]);
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(global.Logger.log.mock.calls[0][0]).soloLectura).toBe(true);
  });

  test('si el spreadsheet no se puede abrir, no rompe: devuelve un error acotado y lo registra', () => {
    instalarTodoSoloLectura({});
    global.SpreadsheetApp = { openById: () => { throw new Error('sin acceso a 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789'); } };
    let r;
    expect(() => { r = D.diagnosticoE10UsuariosPermisos(); }).not.toThrow();
    expect(r.error).toMatch(/NO_SE_PUDO_CONSTRUIR_EL_INFORME/);
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
  });

  test('guarda estatica: el archivo no contiene ninguna API de escritura, red, mail, cache, lock, propiedades, triggers ni secretos', () => {
    const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'DiagnosticoE10.js'), 'utf8');
    const metodos = /\.(setValue|setValues|setFormula\w*|setNumberFormat\w*|appendRow|insertColumn\w*|insertRow\w*|insertSheet|deleteRow\w*|deleteColumn\w*|deleteSheet|deleteCell\w*|clear\w*|setProperty|setProperties|deleteProperty|deleteAllProperties|put|putAll|remove|removeAll|waitLock|tryLock|releaseLock|newTrigger|sendEmail|fetch|fetchAll|setFrozenRows|setName|copyTo|moveTo|hideSheet|showSheet|protect|setBackground\w*|setFontWeight|activate|flush)\s*\(/;
    expect(fuente).not.toMatch(metodos);
    const prohibidos = ['UrlFetchApp', 'MailApp', 'GmailApp', 'ScriptApp', 'CacheService', 'LockService', 'PropertiesService', 'DriveApp', 'telegramRepository_', 'notificationService_', 'logHistoryEvent', 'sheetHistoryRepository_', 'sheetSearchHistoryRepository_', 'searchHistoryService_', 'getSessionSecret', 'SESSION_SECRET', 'getTelegram', 'getFotosStorage', 'handleLogin', 'createSessionToken'];
    prohibidos.forEach((t) => expect(fuente.includes(t)).toBe(false));
    // lo unico que toca de Google: abrir el spreadsheet por id y leer
    expect((fuente.match(/SpreadsheetApp\./g) || []).length).toBe(1);
    expect(fuente).toMatch(/SpreadsheetApp\.openById\(getSpreadsheetId\(\)\)/);
    expect(fuente).toMatch(/getDataRange\(\)\.getValues\(\)/);
  });
});

describe('no expone datos sensibles', () => {
  test('el informe no trae emails completos (salvo los candidatos a administrador), ni contenido de pozos, motivos, observaciones, secretos ni ids', () => {
    process.env.SESSION_SECRET = 'SECRETO-NO-DEBE-APARECER';
    const e = escenario();
    e.hojas.UbicacionFuenteSugerencias.push(sug('PROPUESTA', 'elena@irrigacion.gov.ar'));
    const r = informe(e);
    const texto = JSON.stringify(r);
    const candidatos = r.administradores.candidatos.join('\n');
    const sinCandidatos = JSON.parse(texto);
    delete sinCandidatos.administradores.candidatos;
    const textoSinCandidatos = JSON.stringify(sinCandidatos);
    const todos = ['ana@irrigacion.gov.ar', 'beto@irrigacion.gov.ar', 'carla@irrigacion.gov.ar', 'dario@irrigacion.gov.ar', 'elena@irrigacion.gov.ar', 'fede@gmail.com', 'gaby@irrigacion.gov.ar', 'hugo@irrigacion.gov.ar'];
    // en todo el informe, SIN la lista de candidatos, ningun email aparece completo
    todos.forEach((email) => expect(textoSinCandidatos).not.toContain(email));
    // y los candidatos (ana y beto, los unicos con autoridad) si aparecen completos en su lista
    expect(candidatos).toContain('ana@irrigacion.gov.ar');
    expect(candidatos).toContain('beto@irrigacion.gov.ar');
    ['carla', 'dario', 'elena', 'fede', 'gaby', 'hugo'].forEach((p) => expect(candidatos).not.toContain(p));
    expect(texto).not.toContain('desconocido@otro.com');            // autor sin usuario: ni siquiera enmascarado
    ['MOTIVO-SECRETO-123', 'OBSERVACION-SECRETA-456', '14-0130', 'SECRETO-NO-DEBE-APARECER', 'docs.google.com', 'drive.google'].forEach((t) => expect(texto).not.toContain(t));
    expect(texto).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);               // ningun token con forma de JWT
    expect(texto).not.toMatch(/-32\.5|-68\.5/);                      // coordenadas de la hoja de correcciones
    expect(texto).toMatch(/d\*\*\*@irrigacion\.gov\.ar/);          // si hay version enmascarada de los demas
    delete process.env.SESSION_SECRET;
  });

  test('de las hojas de historial solo se leen email, evento y fecha: aunque tengan otras columnas con datos, no salen', () => {
    const e = escenario();
    e.hojas.UbicacionFuenteSugerencias.push(sug('PROPUESTA', 'carla@irrigacion.gov.ar'));
    const texto = JSON.stringify(informe(e));
    expect(texto).not.toMatch(/ACEPTAR|PADRON|MOTIVO/);
  });

  test('un nombre con contenido largo o raro se acota', () => {
    const e = escenario();
    e.hojas.Usuarios[1][1] = 'X'.repeat(500);
    const r = informe(e);
    const cand = r.administradores.candidatos[0];
    expect(cand.split(' | ')[1].length).toBeLessThanOrEqual(40);
  });
});

// ---------- salidas PARCIALES (presentacion: mismo calculo, un JSON corto por ejecucion) ----------

const PARCIALES = [
  ['diagnosticoE10Administradores', 'administradores'],
  ['diagnosticoE10Tipo', 'tipo'],
  ['diagnosticoE10EmailVerified', 'email_verified'],
  ['diagnosticoE10Telegram', 'telegram'],
  ['diagnosticoE10Recomendaciones', 'recomendaciones']
];

// 11 usuarios activos como los reales del piloto (11 con ubicacion y corregir, 3 validadores), con nombres y permisos amplios: el caso que truncaba el registro
function escenarioReal11() {
  const e = escenario();
  const todos = COLS.slice(4);
  const filas = [];
  for (let i = 1; i <= 11; i += 1) {
    filas.push(fila('persona' + i + '@irrigacion.gov.ar', 'Persona Numero ' + i + ' Apellido Largo', 'activo', i <= 3 ? todos : todos.filter((c) => !/_validar|_moderar|_anular/.test(c))));
  }
  e.hojas.Usuarios = usuarios(...filas);
  return e;
}

// usuarios numerosos con nombres largos: fuerza el recorte de las listas
function escenarioGrande(n) {
  const e = escenario();
  const todos = COLS.slice(4);
  const filas = [];
  for (let i = 1; i <= n; i += 1) {
    filas.push(fila('usuario' + i + '@dominio-muy-largo-de-prueba' + (i % 7) + '.gov.ar', 'Nombre Muy Largo Numero ' + i + ' ' + 'X'.repeat(30), 'activo', i % 2 ? todos : ['perfil']));
  }
  e.hojas.Usuarios = usuarios(...filas);
  return e;
}

describe('salidas parciales', () => {
  afterEach(limpiarGlobales);

  const correr = (nombre, e) => {
    const { hojas } = instalarTodoSoloLectura({ ...e.hojas, Busquedas: [['t'], [1]], Historial: [['t'], [1], [2]] });
    const objeto = D[nombre]();
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    return { hojas, objeto, texto: global.Logger.log.mock.calls[0][0] };
  };

  test('existen las 5 funciones de Apps Script y exponen los nombres exactos', () => {
    PARCIALES.forEach(([nombre]) => expect(typeof D[nombre]).toBe('function'));
    expect(PARCIALES.map(([n]) => n)).toEqual(['diagnosticoE10Administradores', 'diagnosticoE10Tipo', 'diagnosticoE10EmailVerified', 'diagnosticoE10Telegram', 'diagnosticoE10Recomendaciones']);
  });

  test.each(PARCIALES)('%s: UN solo registro, JSON valido, de la seccion pedida, con EL MISMO calculo que el diagnostico completo', (nombre, seccion) => {
    const e = escenario();
    e.conteos = { Busquedas: 1, Historial: 2 };        // las filas que cuenta el Apps Script falso de `correr`
    const completo = informe(e);
    const { texto } = correr(nombre, e);
    const salida = JSON.parse(texto);
    expect(salida.seccion).toBe(seccion);
    expect(salida.soloLectura).toBe(true);
    expect(salida.errores).toEqual([]);
    expect(salida[seccion]).toEqual(completo[seccion]);        // mismo calculo, sin recortes en el caso normal
    expect(Object.keys(salida)).toEqual(['version', 'seccion', 'soloLectura', seccion, 'errores']);
  });

  test.each(PARCIALES)('%s: con los 11 usuarios del piloto entra holgado en el tope', (nombre) => {
    const { texto } = correr(nombre, escenarioReal11());
    expect(texto.length).toBeLessThan(D.DIAG_E10_MAX_SALIDA);
    expect(() => JSON.parse(texto)).not.toThrow();
  });

  test('cada seccion por separado es mucho mas corta que el diagnostico completo que se truncaba', () => {
    const e = escenarioReal11();
    const total = JSON.stringify(informe(e), null, 2).length;
    PARCIALES.forEach(([nombre]) => {
      instalarTodoSoloLectura({ ...e.hojas, Busquedas: [['t']], Historial: [['t']] });
      global.Logger.log.mockClear();
      D[nombre]();
      expect(global.Logger.log.mock.calls[0][0].length).toBeLessThan(total / 2);
    });
  });

  test.each(PARCIALES)('%s: con muchos usuarios nunca supera el tope; recorta las listas e informa cuantos omitio', (nombre, seccion) => {
    const { texto, objeto } = correr(nombre, escenarioGrande(300));
    expect(texto.length).toBeLessThanOrEqual(D.DIAG_E10_MAX_SALIDA);
    const salida = JSON.parse(texto);
    expect(salida.seccion).toBe(seccion);
    expect(salida).toEqual(objeto);
    expect(salida.error).toBeUndefined();
  });

  test('administradores con 300 usuarios: se omiten candidatos y queda dicho', () => {
    const { texto } = correr('diagnosticoE10Administradores', escenarioGrande(300));
    const s = JSON.parse(texto);
    expect(s.administradores.candidatos.length).toBeGreaterThan(0);
    expect(s.administradores._omitidos_candidatos).toBeGreaterThan(0);
    expect(s.administradores.candidatos.length + s.administradores._omitidos_candidatos).toBe(15);
  });

  test('ajustarTamano: quita de a uno el ultimo de la lista mas pesada y, si no hay listas que quitar, devuelve un error corto en vez de truncar', () => {
    const r = D.diagE10_ajustarTamano({ seccion: 'x', a: ['1'.repeat(300), '2'.repeat(300), '3'.repeat(300)], b: ['z'] }, 500);
    const o = JSON.parse(r.texto);
    expect(r.texto.length).toBeLessThanOrEqual(500);
    expect(o.a).toEqual(['1'.repeat(300)]);
    expect(o._omitidos_a).toBe(2);
    expect(o.b).toEqual(['z']);
    const sinListas = D.diagE10_ajustarTamano({ seccion: 'x', largo: 'y'.repeat(5000) }, 1000);
    expect(JSON.parse(sinListas.texto)).toEqual({ version: 1, seccion: 'x', soloLectura: true, error: 'SECCION_DEMASIADO_LARGA' });
  });

  test.each(PARCIALES)('%s: SOLO LECTURA: corre sobre hojas, propiedades, cache, lock, red y mail que lanzan ante cualquier escritura, sin modificar nada', (nombre) => {
    const e = escenario();
    const { hojas, accesos } = instalarTodoSoloLectura({ ...e.hojas, Busquedas: [['t'], [1]], Historial: [['t']] });
    const antes = JSON.stringify(Object.keys(hojas).map((n) => hojas[n].filas));
    expect(() => D[nombre]()).not.toThrow();
    expect(JSON.stringify(Object.keys(hojas).map((n) => hojas[n].filas))).toBe(antes);
    expect([...new Set(accesos)].filter((m) => /^(set|append|insert|delete|clear|remove|copy|move|hide|protect|sort|merge)/i.test(m))).toEqual([]);
  });

  test.each(PARCIALES)('%s: tolera hojas y columnas faltantes, hoja vacia y filas invalidas', (nombre, seccion) => {
    [
      {},
      { Usuarios: [] },
      { Usuarios: [[]] },
      { Usuarios: [['email', 'estado'], ['a@x.com', 'activo'], [42, {}, new Date()], [null, null]] },
      { Usuarios: [COLS] }
    ].forEach((hojas) => {
      const { texto } = correr(nombre, { hojas, conteos: {} });
      const s = JSON.parse(texto);
      expect(s.seccion).toBe(seccion);
      expect(s.error).toBeUndefined();
      limpiarGlobales();
    });
  });

  test('si el spreadsheet no se puede abrir: un JSON corto con el error acotado (sin ids), no una excepcion', () => {
    instalarTodoSoloLectura({});
    global.SpreadsheetApp = { openById: () => { throw new Error('sin acceso a 1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789 de ana@irrigacion.gov.ar'); } };
    PARCIALES.forEach(([nombre, seccion]) => {
      global.Logger.log.mockClear();
      let r;
      expect(() => { r = D[nombre](); }).not.toThrow();
      expect(global.Logger.log).toHaveBeenCalledTimes(1);
      expect(r.seccion).toBe(seccion);
      expect(r.error).toMatch(/NO_SE_PUDO_CONSTRUIR_EL_INFORME/);
      expect(global.Logger.log.mock.calls[0][0]).not.toContain('ana@irrigacion.gov.ar');
    });
  });

  test('una lectura fallida se informa como codigo en `errores` de la parcial, sin romper', () => {
    const e = escenario();
    const original = deps(e.hojas, e.conteos);
    const r = D.diagE10_salidaParcial(D.diagE10_construir({ datosHoja: (n) => { if (n === 'UbicacionCorrecciones') { throw new Error('fallo con ana@irrigacion.gov.ar'); } return original.datosHoja(n); }, contarFilas: original.contarFilas }), 'tipo');
    const s = JSON.parse(r.texto);
    expect(s.errores.some((x) => /LECTURA_UbicacionCorrecciones/.test(x))).toBe(true);
    expect(r.texto).not.toContain('ana@irrigacion.gov.ar');
    expect(s.tipo.totalActivos).toBe(7);
  });

  test('privacidad: ninguna parcial muestra un email completo salvo los candidatos a administrador', () => {
    const e = escenario();
    const todos = ['ana@irrigacion.gov.ar', 'beto@irrigacion.gov.ar', 'carla@irrigacion.gov.ar', 'dario@irrigacion.gov.ar', 'elena@irrigacion.gov.ar', 'fede@gmail.com', 'gaby@irrigacion.gov.ar', 'hugo@irrigacion.gov.ar'];
    PARCIALES.forEach(([nombre, seccion]) => {
      const { texto } = correr(nombre, e);
      const completos = todos.filter((m) => texto.includes(m));
      expect(completos).toEqual(seccion === 'administradores' ? ['ana@irrigacion.gov.ar', 'beto@irrigacion.gov.ar'] : []);
      limpiarGlobales();
    });
  });

  test('el diagnostico completo sigue igual: diagnosticoE10UsuariosPermisos() imprime todas las secciones en un solo registro', () => {
    const e = escenario();
    instalarTodoSoloLectura({ ...e.hojas, Busquedas: [['t']], Historial: [['t']] });
    D.diagnosticoE10UsuariosPermisos();
    expect(global.Logger.log).toHaveBeenCalledTimes(1);
    const s = JSON.parse(global.Logger.log.mock.calls[0][0]);
    expect(Object.keys(s)).toEqual(['version', 'soloLectura', 'usuarios', 'mapa', 'ubicacion', 'administradores', 'tipo', 'email_verified', 'telegram', 'errores', 'recomendaciones']);
  });
});
