// E4-2 (frontend): tarjeta y flujo para un pozo SIN ubicacion. Cubre la logica pura (estado del padron, tabla de botones, textos, observacion obligatoria fuera del padron,
// mensajes de exito, aviso del hub), el dominio de la ficha (noEnPadron = sin punto, sin anomalia, sin fuentes inventadas) y la compatibilidad con un backend viejo
// (nunca manda `noEnPadron` ni las marcas primeraUbicacion / candidataPrimeraUbicacion). El controlador del modal ejecutado de verdad se prueba en
// js/ubicacionCorreccionController.test.js (describe "E4-2") y el cableado de app.js en js/ubicacionCorreccionWiring.test.js.
const fs = require('fs');
const path = require('path');

const conv = require('./coordenadasConversion.js');
const uop = require('./ubicacionOperativaLogic.js');
const ufdui = require('./ubicacionFuenteDecisionesUiLogic.js');
Object.assign(global, conv, uop, ufdui);                    // las dependencias son globales en el navegador
const U = require('./ubicacionesConocidasLogic.js');
const L = require('./ubicacionCorreccionLogic.js');

const W = '14-0123';
const SIN = { wellId: W, ubicacionResuelta: { estado: 'sinCoordenadas' } };
const NEP = { wellId: W, ubicacionResuelta: { estado: 'noEnPadron' } };
const CON = { wellId: W, ubicacionResuelta: { estado: 'unica', lat: -33.34765, lon: -69.14545 } };
const REVISAR = { wellId: W, ubicacionResuelta: { estado: 'revisar' } };
const V = { correccionId: '618615f2-3f2b-4a8d-ae3c-1ebd49041190', lat: -33.34745, lon: -69.14545, estado: 'VALIDADA' };

const AMBOS = { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true };
const CORREGIR = { ubicacion: true, ubicacion_corregir: true };
const VALIDAR = { ubicacion: true, ubicacion_validar: true };
const LEER = { ubicacion: true };

const modo = (location, permisos, vigente) => L.ubicacionCorreccionLogic_modoDeIngreso({ location: location, permisos: permisos, vigente: vigente || null });

describe('E4-2: estado del padron', () => {
  test.each([
    [CON, 'unica'], [REVISAR, 'revisar'], [SIN, 'sinCoordenadas'], [NEP, 'noEnPadron'],
    [{ wellId: W }, 'sinCoordenadas'],                                       // una ubicacion sin ubicacionResuelta es como siempre: sin coordenadas
    [{ wellId: W, ubicacionResuelta: {} }, 'sinCoordenadas'],
    [{ wellId: W, ubicacionResuelta: { estado: '' } }, 'sinCoordenadas']
  ])('%j -> %s', (location, esperado) => {
    expect(L.ubicacionCorreccionLogic_estadoPadron(location)).toBe(esperado);
  });

  test('sin ubicacion alguna no se sabe nada (no se inventa un estado)', () => {
    expect(L.ubicacionCorreccionLogic_estadoPadron(null)).toBeNull();
    expect(L.ubicacionCorreccionLogic_estadoPadron(undefined)).toBeNull();
    expect(L.ubicacionCorreccionLogic_estadoPadron('noEnPadron')).toBeNull();
  });

  test('noEnPadron no es una ubicacion oficial: no hay coordenada de Irrigacion ni se calcula distancia (igual que sinCoordenadas)', () => {
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion(NEP)).toBeNull();
    expect(L.ubicacionCorreccionLogic_irrigacionDeUbicacion({ wellId: W, ubicacionResuelta: { estado: 'noEnPadron', lat: -33.3, lon: -69.1 } })).toBeNull();
    expect(L.ubicacionCorreccionLogic_oficialDisponible(NEP)).toBe(false);
  });
});

describe('E4-2: tabla de botones (modoDeIngreso)', () => {
  test.each([
    // [descripcion, location, permisos, textoBoton]
    ['SIN ubicacion · corregir + validar', SIN, AMBOS, 'Agregar ubicación'],
    ['SIN ubicacion · corregir sin validar', SIN, CORREGIR, 'Sugerir ubicación'],
    ['SIN ubicacion · validar sin corregir', SIN, VALIDAR, ''],
    ['SIN ubicacion · solo leer', SIN, LEER, ''],
    ['FUERA del padron · corregir + validar', NEP, AMBOS, 'Agregar ubicación'],
    ['FUERA del padron · corregir sin validar', NEP, CORREGIR, 'Sugerir ubicación'],
    ['FUERA del padron · validar sin corregir', NEP, VALIDAR, ''],
    ['FUERA del padron · solo leer', NEP, LEER, ''],
    ['CON ubicacion · corregir + validar', CON, AMBOS, 'Corregir ubicación'],
    ['CON ubicacion · corregir sin validar', CON, CORREGIR, 'Sugerir corrección'],
    ['CON ubicacion · validar sin corregir', CON, VALIDAR, ''],
    ['CON ubicacion · solo leer', CON, LEER, ''],
    ['fuentes en desacuerdo · corregir + validar', REVISAR, AMBOS, 'Corregir ubicación'],
    ['fuentes en desacuerdo · corregir sin validar', REVISAR, CORREGIR, 'Sugerir corrección']
  ])('%s -> "%s"', (n, location, permisos, texto) => {
    const m = modo(location, permisos);
    expect(m.textoBoton).toBe(texto);
    expect(m.puedeOriginar).toBe(texto !== '');
    expect(m.tituloModal).toBe(texto || 'Corregir ubicación');
  });

  test('sinUbicacion = no hay NINGUN punto: sinCoordenadas o noEnPadron y sin una validada en campo vigente', () => {
    expect(modo(SIN, AMBOS).sinUbicacion).toBe(true);
    expect(modo(NEP, AMBOS).sinUbicacion).toBe(true);
    expect(modo(CON, AMBOS).sinUbicacion).toBe(false);
    expect(modo(REVISAR, AMBOS).sinUbicacion).toBe(false);
    expect(modo(SIN, AMBOS, V).sinUbicacion).toBe(false);                    // una V vigente ES una ubicacion
    expect(modo(NEP, CORREGIR, V).textoBoton).toBe('Sugerir corrección');
    expect(modo(NEP, AMBOS, { lat: 'x', lon: null }).sinUbicacion).toBe(true); // una V sin coordenadas utilizables no cuenta
  });

  test('permisos fail-closed: "SI", 1, ausentes o sin ubicacion no habilitan nada', () => {
    [{ ubicacion: true, ubicacion_corregir: 'SI' }, { ubicacion: true, ubicacion_corregir: 1 }, { ubicacion_corregir: true }, {}, null, undefined].forEach((permisos) => {
      expect(modo(SIN, permisos).textoBoton).toBe('');
      expect(modo(NEP, permisos).puedeOriginar).toBe(false);
    });
    expect(modo(SIN, { ubicacion: true, ubicacion_corregir: true, ubicacion_validar: 'SI' }).textoBoton).toBe('Sugerir ubicación');     // validar no exacto -> solo propone
  });

  test('fueraDelPadron solo para noEnPadron; el estado del padron viaja para el modal', () => {
    expect(modo(NEP, CORREGIR)).toMatchObject({ fueraDelPadron: true, estadoPadron: 'noEnPadron' });
    expect(modo(SIN, CORREGIR)).toMatchObject({ fueraDelPadron: false, estadoPadron: 'sinCoordenadas' });
    expect(modo(CON, CORREGIR)).toMatchObject({ fueraDelPadron: false, estadoPadron: 'unica' });
  });

  test('sin datos no rompe', () => {
    expect(() => L.ubicacionCorreccionLogic_modoDeIngreso()).not.toThrow();
    expect(L.ubicacionCorreccionLogic_modoDeIngreso().textoBoton).toBe('');
  });
});

describe('E4-2: la tarjeta del hub', () => {
  const ofrecer = (o) => L.ubicacionCorreccionLogic_ofrecerModulo(o);

  test('si getWellLocation devolvio ok la tarjeta existe SIEMPRE: con o sin coordenadas, con o sin permiso de corregir', () => {
    [SIN, NEP, CON, REVISAR, { wellId: W }].forEach((location) => {
      expect(ofrecer({ ubicacionFound: true, location: location, permisos: LEER })).toBe(true);
      expect(ofrecer({ ubicacionFound: true, location: location, permisos: AMBOS })).toBe(true);
      expect(ofrecer({ ubicacionFound: true, location: location, permisos: {} })).toBe(true);
    });
  });

  test('sin lectura (sin permiso "ubicacion", WELL_LOCATION_NOT_FOUND u otro error) no hay tarjeta', () => {
    expect(ofrecer({ ubicacionFound: false, location: SIN, permisos: AMBOS })).toBe(false);
    expect(ofrecer({ ubicacionFound: false })).toBe(false);
    expect(ofrecer({})).toBe(false);
    expect(ofrecer(undefined)).toBe(false);
    expect(ofrecer({ ubicacionFound: 'true' })).toBe(false);
  });

  test('SERVICE_UNAVAILABLE con permiso de consulta: aviso coherente; con cualquier otro codigo o sin permiso, nada (WELL_LOCATION_NOT_FOUND sigue como antes)', () => {
    const aviso = L.ubicacionCorreccionLogic_avisoHubUbicacion;
    expect(aviso({ found: false, code: 'SERVICE_UNAVAILABLE' }, LEER)).toBe('No se pudo comprobar la ubicación de este pozo. Intentá de nuevo en unos minutos.');
    expect(aviso({ found: false, code: 'WELL_LOCATION_NOT_FOUND' }, LEER)).toBe('');
    expect(aviso({ found: false, code: 'PERMISSION_DENIED' }, LEER)).toBe('');
    expect(aviso({ found: false, code: 'SERVICE_UNAVAILABLE' }, {})).toBe('');
    expect(aviso({ found: false, code: 'SERVICE_UNAVAILABLE' }, null)).toBe('');
    expect(aviso({ found: true, data: SIN }, LEER)).toBe('');
    expect(aviso(null, LEER)).toBe('');
  });
});

describe('E4-2: textos', () => {
  test('copy exacto de los dos casos sin ubicacion', () => {
    expect(L.UCORR_TEXTO_SIN_UBICACION).toBe('Sin ubicación registrada');
    expect(L.UCORR_DETALLE_SIN_COORDENADAS).toBe('Este pozo figura en el padrón, pero no tiene una coordenada cargada.');
    expect(L.UCORR_DETALLE_NO_EN_PADRON).toBe('Este pozo no figura en el padrón actual.');
    expect(U.UCON_TITULO_SIN_REGISTRADA).toBe('Sin ubicación registrada');
    expect(U.UCON_DETALLE_SIN_OPERATIVO.SIN_COORDENADAS).toBe(L.UCORR_DETALLE_SIN_COORDENADAS);
    expect(U.UCON_DETALLE_SIN_OPERATIVO.NO_EN_PADRON).toBe(L.UCORR_DETALLE_NO_EN_PADRON);
  });

  test('"Sin ubicación operativa de Irrigación" queda reservado para discrepancia / todas descartadas', () => {
    expect(U.UCON_TITULO_SIN_OPERATIVO).toBe('Sin ubicación operativa de Irrigación');
    expect(U.UCON_DETALLE_SIN_OPERATIVO.DISCREPANCIA).toMatch(/no coinciden/);
    expect(U.UCON_DETALLE_SIN_OPERATIVO.TODAS_DESCARTADAS).toMatch(/descartadas/);
  });

  test('texto de Irrigacion del modal por situacion', () => {
    const t = L.ubicacionCorreccionLogic_textoIrrigacionModal;
    expect(t('sinCoordenadas', null)).toBe('Este pozo figura en el padrón, pero no tiene una ubicación de Irrigación para comparar.');
    expect(t('noEnPadron', null)).toBe('Este pozo no figura en el padrón actual.');
    expect(t('revisar', null)).toBe('Este pozo no tiene una ubicación de Irrigación para comparar.');            // fuentes en desacuerdo: no hay "la" coordenada
    expect(t(null, null)).toBe('Este pozo no tiene una ubicación de Irrigación para comparar.');
    expect(t('unica', { lat: -33.34765, lon: -69.14545 })).toBe('Ubicación de Irrigación (no se modifica): -33.34765, -69.14545');
  });

  test('textos del modal que NO deben mezclarse con "Irrigación" cuando no hay punto', () => {
    expect(L.UCORR_TEXTO_VACIO_SIN_UBICACION).not.toMatch(/vigente es la de Irrigación/);
    expect(L.UCORR_TEXTO_IRRIGACION_NO_EN_PADRON).not.toMatch(/operativa/);
    expect(L.UCORR_TEXTO_IRRIGACION_SIN_COORDENADAS).not.toMatch(/operativa/);
  });
});

describe('E4-2: observacion obligatoria fuera del padron', () => {
  const ev = (o) => L.ubicacionCorreccionLogic_evaluarPropuesta(Object.assign({ lat: -33.9, lon: -68.9, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: '', irrigacion: null }, o));
  const TEXTO = 'Indicá por qué se incorpora una ubicación para un pozo que no figura en el padrón actual.';

  test('fueraDelPadron: sin observacion no se puede guardar; el motivo es el texto del padron; sin distancia ni advertencia', () => {
    const r = ev({ fueraDelPadron: true });
    expect(r.ok).toBe(false);
    expect(r.observacionObligatoria).toBe(true);
    expect(r.errores.observacion).toBe(TEXTO);
    expect(r.distanciaM).toBeNull();
    expect(r.advertenciaFuerte).toBe(false);
    expect(ev({ fueraDelPadron: true, observacion: '    ' }).ok).toBe(false);
  });

  test('fueraDelPadron con observacion: ok', () => {
    const r = ev({ fueraDelPadron: true, observacion: ' motivo ' });
    expect(r.ok).toBe(true);
    expect(r.observacion).toBe('motivo');
    expect(r.errores).toEqual({});
  });

  test('sinCoordenadas (y todo lo demas): la observacion sigue opcional', () => {
    [{}, { fueraDelPadron: false }, { fueraDelPadron: undefined }, { fueraDelPadron: 'true' }, { fueraDelPadron: 1 }].forEach((o) => {
      const r = ev(o);
      expect(r.ok).toBe(true);
      expect(r.observacionObligatoria).toBe(false);
    });
  });

  test('con Irrigacion a mas de 250 m sigue exigiendo observacion por la distancia (regla de siempre)', () => {
    const r = ev({ lat: -33.3446, lon: -69.14545, irrigacion: { lat: -33.34765, lon: -69.14545 } });
    expect(r.observacionObligatoria).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.errores.observacion).toMatch(/250 m/);
  });

  test('OBSERVACION_REQUERIDA del backend: sin distancia -> texto del padron; con distancia -> el mensaje de la distancia', () => {
    expect(L.ubicacionCorreccionLogic_mensajeError('OBSERVACION_REQUERIDA')).toBe(TEXTO);
    expect(L.ubicacionCorreccionLogic_mensajeError('OBSERVACION_REQUERIDA', {})).toBe(TEXTO);
    expect(L.ubicacionCorreccionLogic_mensajeError('OBSERVACION_REQUERIDA', { distanciaM: null })).toBe(TEXTO);
    const conDistancia = L.ubicacionCorreccionLogic_mensajeError('OBSERVACION_REQUERIDA', { distanciaM: 333.6 });
    expect(conDistancia).toMatch(/333,6 m de Irrigación/);
    expect(conDistancia).toMatch(/obligatoria a más de 250 m/);
    expect(conDistancia).not.toContain('padrón');
  });

  test('el payload sigue siendo la lista blanca: ni fueraDelPadron ni sinUbicacion viajan', () => {
    const p = L.ubicacionCorreccionLogic_construirPayload(W, { lat: -33.9, lon: -68.9, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: ' x ', irrigacion: null, fueraDelPadron: true, sinUbicacion: true }, 'ucorr-12345678');
    expect(Object.keys(p).sort()).toEqual(['clientRequestId', 'lat', 'lon', 'metodo', 'observacion', 'precisionGpsM', 'wellId']);
  });
});

describe('E4-2: mensajes de exito', () => {
  const m = L.ubicacionCorreccionLogic_mensajeResultado;

  test('primera ubicacion', () => {
    expect(m('pendiente', true)).toBe('Ubicación sugerida. Queda pendiente de validación.');
    expect(m('validada', true)).toBe('Ubicación agregada y validada.');
  });

  test('correccion (o primera sin indicar): los mensajes de siempre', () => {
    expect(m('pendiente')).toBe('Corrección enviada para validación.');
    expect(m('validada')).toBe('Ubicación corregida y validada.');
    expect(m('pendiente', false)).toBe('Corrección enviada para validación.');
    expect(m('validada', 'true')).toBe('Ubicación corregida y validada.');
    expect(m('otro', true)).toBe('Corrección registrada.');
  });

  test('esPrimeraGuardada: manda el backend si informa la marca; con un backend viejo, lo que la pantalla sabia al abrir', () => {
    const p = L.ubicacionCorreccionLogic_esPrimeraGuardada;
    expect(p('validada', { primeraUbicacion: true }, false)).toBe(true);
    expect(p('validada', { primeraUbicacion: false }, true)).toBe(false);
    expect(p('pendiente', { candidataPrimeraUbicacion: true }, false)).toBe(true);
    expect(p('pendiente', { candidataPrimeraUbicacion: false }, true)).toBe(false);
    // la marca que corresponde al resultado: una PENDIENTE no se guia por primeraUbicacion y una VALIDADA no por candidata
    expect(p('pendiente', { primeraUbicacion: true }, false)).toBe(false);
    expect(p('validada', { candidataPrimeraUbicacion: true }, false)).toBe(false);
    // backend viejo (sin marcas)
    expect(p('validada', {}, true)).toBe(true);
    expect(p('pendiente', null, true)).toBe(true);
    expect(p('validada', undefined, false)).toBe(false);
    expect(p('validada', { primeraUbicacion: 'si' }, true)).toBe(true);        // un valor no booleano no es una marca
  });

  test('el flujo de guardado usa lo que la pantalla sabia al abrir (valores.sinUbicacion)', async () => {
    const mk = (estado) => L.ubicacionCorreccionLogic_crearFlujoGuardado({
      enviar: () => Promise.resolve({ status: 'ok', data: { correccion: { estado: estado } } }),
      leer: () => Promise.resolve({ status: 'ok', data: { vigente: null, pendientes: [], historial: [] } }),
      generarId: () => 'ucorr-12345678'
    });
    const base = { lat: -33.9, lon: -68.9, metodo: 'PUNTO_EN_MAPA', precisionGpsM: null, observacion: 'x', irrigacion: null };
    expect((await mk('PROPUESTA').guardar(W, Object.assign({ sinUbicacion: true }, base))).mensaje).toBe('Ubicación sugerida. Queda pendiente de validación.');
    expect((await mk('VALIDADA').guardar(W, Object.assign({ sinUbicacion: true }, base))).mensaje).toBe('Ubicación agregada y validada.');
    expect((await mk('PROPUESTA').guardar(W, base)).mensaje).toBe('Corrección enviada para validación.');
    expect((await mk('VALIDADA').guardar(W, Object.assign({ sinUbicacion: false }, base))).mensaje).toBe('Ubicación corregida y validada.');
  });
});

describe('E4-2: seccion de la ficha (HTML)', () => {
  const html = L.ubicacionCorreccionLogic_htmlSeccion;
  const vacia = { vigente: null, pendientes: [], historial: [] };

  test('sin ubicacion: no dice que la vigente es la de Irrigacion y pone el texto del boton', () => {
    const h = html(vacia, { puedeCorregir: true, textoBoton: 'Agregar ubicación', sinUbicacion: true });
    expect(h).toContain('Todavía no hay una ubicación cargada para este pozo.');
    expect(h).not.toContain('La ubicación vigente es la de Irrigación');
    expect(h).not.toContain('La corrección no reemplaza');
    expect(h).toContain('id="btn-ubic-corr-abrir">Agregar ubicación</button>');
  });

  test('con ubicacion: el copy de siempre', () => {
    const h = html(vacia, { puedeCorregir: true, textoBoton: 'Corregir ubicación' });
    expect(h).toContain('La ubicación vigente es la de Irrigación');
    expect(h).toContain('La corrección no reemplaza ni modifica la ubicación de Irrigación');
    expect(h).toContain('id="btn-ubic-corr-abrir">Corregir ubicación</button>');
  });

  test('sin textoBoton explicito (compatibilidad): "Corregir ubicación" si puede corregir, y nada si no', () => {
    expect(html(vacia, { puedeCorregir: true })).toContain('id="btn-ubic-corr-abrir">Corregir ubicación</button>');
    expect(html(vacia, { puedeCorregir: false })).not.toContain('btn-ubic-corr-abrir');
    expect(html(vacia, {})).not.toContain('btn-ubic-corr-abrir');
  });

  test('un texto de boton vacio no pinta boton', () => {
    expect(html(vacia, { puedeCorregir: true, textoBoton: '' })).not.toContain('btn-ubic-corr-abrir');
  });

  test('el texto del boton se escapa', () => {
    expect(html(vacia, { textoBoton: '<b>x</b>' })).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
});

describe('E4-2: dominio de la ficha — noEnPadron es "sin punto" (no una anomalia) y no inventa fuentes', () => {
  const ficha = (extra) => uop.ubicacionOperativaLogic_resolverFicha(Object.assign({ wellId: W, ubicacionResuelta: { estado: 'noEnPadron' }, vigente: null, decisiones: null }, extra || {}));

  test('sin V: sin punto, motivo NO_EN_PADRON, sin anomalias', () => {
    expect(ficha()).toMatchObject({ operativo: false, lat: null, lon: null, codigo: null, motivoSinPunto: 'NO_EN_PADRON' });
    expect(ficha().anomalias).toEqual([]);
  });

  test('sinCoordenadas sigue con su motivo', () => {
    expect(ficha({ ubicacionResuelta: { estado: 'sinCoordenadas' } })).toMatchObject({ operativo: false, motivoSinPunto: 'SIN_COORDENADAS' });
  });

  test('con una V vigente: el punto es el de campo (Validada en campo), sin tocar nada del padron', () => {
    const f = ficha({ vigente: V });
    expect(f).toMatchObject({ operativo: true, codigo: 'V', lat: V.lat, lon: V.lon });
    expect(f.anomalias).toEqual([]);
  });

  test('discrepancia y todas descartadas no cambian: otro motivo y el titulo "operativa"', () => {
    expect(ficha({ ubicacionResuelta: { estado: 'revisar' } })).toMatchObject({ operativo: false, motivoSinPunto: 'DISCREPANCIA' });
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: REVISAR, vigente: null, decisiones: null });
    expect(m.motivoSinOperativo).toBe('DISCREPANCIA');
    expect(U.ubicacionesConocidasLogic_htmlBloquePrincipal(m, { iconoUbicacion: '', iconoUbicacionWarn: '' })).toContain('Sin ubicación operativa de Irrigación');
  });

  test('modelo y bloque principal: noEnPadron sin V', () => {
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: NEP, vigente: null, decisiones: null });
    expect(m.operativo).toBeNull();
    expect(m.fuentes).toEqual([]);
    expect(m.motivoSinOperativo).toBe('NO_EN_PADRON');
    const h = U.ubicacionesConocidasLogic_htmlBloquePrincipal(m, { iconoUbicacion: '', iconoUbicacionWarn: '' });
    expect(h).toContain('<strong>Sin ubicación registrada</strong>');
    expect(h).toContain('Este pozo no figura en el padrón actual.');
    expect(h).not.toContain('Sin ubicación operativa de Irrigación');
  });

  test('modelo y bloque principal: noEnPadron con una V -> Validada en campo, sin estrella registral ni fuente registral inventada', () => {
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: NEP, vigente: V, decisiones: null });
    expect(m.operativo).toMatchObject({ lat: V.lat, lon: V.lon, codigo: 'V', etiquetaEstado: 'Validada en campo' });
    expect(m.fuentes.map((f) => f.tipo)).toEqual(['CAMPO_VALIDADA']);
    const h = U.ubicacionesConocidasLogic_htmlBloquePrincipal(m, { iconoUbicacion: '', iconoUbicacionWarn: '' });
    expect(h).toContain('Validada en campo');
    expect(h).not.toContain('Sin ubicación registrada');
  });

  test('sin nota tecnica para noEnPadron (no hay fuentes registrales que explicar)', () => {
    const m = U.ubicacionesConocidasLogic_construir({ wellId: W, location: NEP, vigente: null, decisiones: null });
    expect(U.ubicacionesConocidasLogic_notaSinOperativo(m)).toBe('');
  });
});

describe('E4-2: el frontend no depende de que el backend ya mande noEnPadron ni las marcas (publicacion: primero el frontend)', () => {
  test('un backend viejo (solo sinCoordenadas, sin marcas) funciona con la tabla y los mensajes de siempre', () => {
    expect(modo(SIN, AMBOS).textoBoton).toBe('Agregar ubicación');
    expect(L.ubicacionCorreccionLogic_mensajeResultado('validada', L.ubicacionCorreccionLogic_esPrimeraGuardada('validada', { estado: 'VALIDADA' }, modo(SIN, AMBOS).sinUbicacion))).toBe('Ubicación agregada y validada.');
    expect(modo(CON, CORREGIR).textoBoton).toBe('Sugerir corrección');
  });

  test('el codigo no asume noEnPadron, primeraUbicacion ni candidataPrimeraUbicacion como obligatorios', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionCorreccionLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(fuente).not.toMatch(/\.primeraUbicacion\.|\.candidataPrimeraUbicacion\./);
    expect(fuente).toMatch(/typeof c\.primeraUbicacion === 'boolean'/);
    expect(fuente).toMatch(/typeof c\.candidataPrimeraUbicacion === 'boolean'/);
  });

  test('la ficha no pide decisiones ni sugerencias de un pozo fuera del padron (no hay fuentes registrales)', () => {
    const fuente = fs.readFileSync(path.join(__dirname, 'ubicacionesConocidas.js'), 'utf8');
    expect(fuente).toMatch(/function sinFuentesRegistrales\(\) \{\s*var r = estado\.location && estado\.location\.ubicacionResuelta;\s*return !!r && r\.estado === 'noEnPadron';/);
    expect((fuente.match(/sinFuentesRegistrales\(\)/g) || []).length).toBe(3);                       // definicion + decisiones + sugerencias
  });
});
