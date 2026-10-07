// Boton "Fotos" de los popups de mapa: Pozos Provincia y Niveles Estaticos comparten
// helper y semantica de permisos. Se prueba con el contexto REAL (permisos ->
// fotosPozosLogic_accionesMapa), el store real del resumen y un DOM minimo simulado.
const logica = require('./fotosPozosLogic');
const { fotosPozosResumen_crear } = require('./fotosPozosResumen');

Object.assign(global, logica);
const { fotosPopup_crearBoton } = require('./fotosPopup');

function docFalso() {
  return {
    createElement: () => {
      const manejadores = {};
      return { type: '', className: '', textContent: '', addEventListener: (ev, fn) => { manejadores[ev] = fn; }, click: () => manejadores.click() };
    }
  };
}
function markerFalso() {
  const m = { eventos: {}, on(ev, fn) { m.eventos[ev] = fn; }, abrirPopup() { m.eventos.popupopen(); } };
  return m;
}

// Todo el cableado de app.js salvo abrirFotos real: permisos -> contexto -> boton
function armar(permisos, resumenServidor) {
  const apiResumen = jest.fn(() => Promise.resolve({ status: 'ok', data: resumenServidor || { '03-0652': 4, '01-0012': 2 } }));
  const store = fotosPozosResumen_crear({ obtenerContexto: () => ({ sessionToken: 't', permisos }), apiGetResumen: apiResumen, ahora: () => 1 });
  const abiertas = [];
  const contexto = logica.fotosPozosLogic_accionesMapa(permisos, { abrirFotos: (e) => abiertas.push(e), cantidadDe: store.cantidadDe });
  return { store, apiResumen, abiertas, contexto };
}

const POZO = '03-0652';
const crear = (contexto, ref, marker) => fotosPopup_crearBoton(contexto, ref, marker || markerFalso(), docFalso());

describe('popup Provincia (ref = wellId)', () => {
  test('fotos=SI + fotos_carga=SI: "Fotos" y, con resumen cargado, "Fotos (4)"', async () => {
    const t = armar({ fotos: true, fotos_carga: true });
    const marker = markerFalso();
    const btn = crear(t.contexto, POZO, marker);
    expect(btn.textContent).toBe('Fotos');                 // todavia sin resumen
    await t.store.cargar();
    marker.abrirPopup();                                   // al abrir el popup se refresca
    expect(btn.textContent).toBe('Fotos (4)');
  });

  test('solo fotos=SI: mismo boton y contador', async () => {
    const t = armar({ fotos: true });
    const marker = markerFalso();
    const btn = crear(t.contexto, POZO, marker);
    await t.store.cargar();
    marker.abrirPopup();
    expect(btn.textContent).toBe('Fotos (4)');
  });

  test('un pozo sin fotos con el resumen cargado: "Fotos" a secas (no "Fotos (0)")', async () => {
    const t = armar({ fotos: true });
    const marker = markerFalso();
    const btn = crear(t.contexto, '09-0009', marker);
    await t.store.cargar();
    marker.abrirPopup();
    expect(btn.textContent).toBe('Fotos');
  });

  test('solo fotos_carga: boton "Fotos" sin contador y SIN ninguna llamada de lectura, aunque el resumen exista y se abra el popup', async () => {
    const t = armar({ fotos_carga: true });
    const marker = markerFalso();
    const btn = crear(t.contexto, POZO, marker);
    expect(btn).not.toBeNull();
    expect(t.contexto.cantidadFotos).toBeUndefined();
    expect(btn.textContent).toBe('Fotos');
    await t.store.cargar();                                // lo que hace app.js al abrir el mapa
    marker.abrirPopup();
    expect(btn.textContent).toBe('Fotos');
    expect(t.apiResumen).not.toHaveBeenCalled();
    expect(t.store.cantidadDe(POZO)).toBeNull();
    btn.click();
    expect(t.abiertas).toHaveLength(1);                    // entra a "Agregar foto"
    expect(t.apiResumen).not.toHaveBeenCalled();
  });

  test.each([
    ['ninguno', {}],
    ['ambos en false', { fotos: false, fotos_carga: false }],
    ['valores que no son true', { fotos: 'SI', fotos_carga: 1 }]
  ])('%s: no hay boton', (n, permisos) => {
    const t = armar(permisos);
    expect(t.contexto.onVerFotos).toBeUndefined();
    expect(t.contexto.cantidadFotos).toBeUndefined();
    expect(crear(t.contexto, POZO)).toBeNull();
  });

  test('el click abre FotosPozos para ESE wellId, por wellId y nunca por monitoringId', () => {
    const t = armar({ fotos: true, fotos_carga: true });
    crear(t.contexto, POZO).click();
    crear(t.contexto, '01-0012').click();
    expect(t.abiertas).toEqual([
      { wellId: '03-0652', monitoringId: '', etiqueta: '03-0652', esNE: false },
      { wellId: '01-0012', monitoringId: '', etiqueta: '01-0012', esNE: false }
    ]);
  });

  test('un wellId con formato invalido no abre nada (entidad null) ni inventa un monitoringId', () => {
    const t = armar({ fotos: true });
    crear(t.contexto, 'INA 2055').click();
    expect(t.abiertas).toEqual([null]);                    // app.js.abrirFotos ignora entidad null
    expect(t.contexto.cantidadFotos('INA 2055')).toBeNull();
  });
});

describe('misma galeria Provincia / NE para igual wellId', () => {
  const puntoNE = { monitoringId: POZO, wellId: POZO, lat: -33.1, lon: -68.5, nombreOriginal: null };

  test('el boton del popup NE y el del popup Provincia resuelven la misma entidad (misma clave y mismos argumentos de getFotosPozo)', () => {
    const t = armar({ fotos: true, fotos_carga: true });
    crear(t.contexto, POZO).click();
    crear(t.contexto, puntoNE).click();
    const [prov, ne] = t.abiertas;
    expect(logica.fotosPozosLogic_claveEntidad(prov)).toBe(logica.fotosPozosLogic_claveEntidad(ne));
    // argumentos exactos que usa el controlador para pedir la galeria
    const args = (e) => [e.wellId || '', e.wellId ? '' : (e.monitoringId || '')];
    expect(args(prov)).toEqual([POZO, '']);
    expect(args(ne)).toEqual(args(prov));
  });

  test('NE normal sin wellId en el objeto (ficha NE): monitoringId DD-PPPP tambien es el wellId', () => {
    expect(logica.fotosPozosLogic_entidadDePuntoNE({ monitoringId: POZO })).toMatchObject({ wellId: POZO, monitoringId: '' });
  });

  test('NE especial: por monitoringId, sin fabricar wellId', () => {
    const t = armar({ fotos: true });
    crear(t.contexto, { monitoringId: 'INA 2055', wellId: null, nombreOriginal: 'Puesto' }).click();
    expect(t.abiertas[0]).toMatchObject({ wellId: '', monitoringId: 'INA 2055' });
  });

  test('el contador es el mismo para el popup Provincia y el NE del mismo pozo', async () => {
    const t = armar({ fotos: true });
    await t.store.cargar();
    expect(t.contexto.cantidadFotos(POZO)).toBe(4);
    expect(t.contexto.cantidadFotos(puntoNE)).toBe(4);
  });

  test('NE especial: el contador se busca por monitoringId', async () => {
    const t = armar({ fotos: true }, { 'INA 2055': 3 });
    await t.store.cargar();
    expect(t.contexto.cantidadFotos({ monitoringId: 'INA 2055', wellId: null })).toBe(3);
  });

  test('el pozo de Provincia no ofrece MONITOREO_NE (esNE=false); entrar desde NE si', () => {
    expect(logica.fotosPozosLogic_fuentesDisponibles(logica.fotosPozosLogic_entidadDeWellId(POZO))).toEqual(['CAMPO_APP']);
    expect(logica.fotosPozosLogic_fuentesDisponibles(logica.fotosPozosLogic_entidadDePuntoNE(puntoNE))).toEqual(['CAMPO_APP', 'MONITOREO_NE']);
  });
});

describe('acceso de la UI por permisos', () => {
  test.each([
    [{ fotos: true, fotos_carga: true }, { boton: true, contador: true, cargar: true }],
    [{ fotos: true }, { boton: true, contador: true, cargar: false }],
    [{ fotos_carga: true }, { boton: true, contador: false, cargar: true }],
    [{}, { boton: false, contador: false, cargar: false }],
    [null, { boton: false, contador: false, cargar: false }]
  ])('%j', (permisos, esperado) => {
    expect(logica.fotosPozosLogic_accesoUI(permisos)).toEqual(esperado);
  });

  test('etiqueta del boton', () => {
    expect(logica.fotosPozosLogic_textoBoton(4)).toBe('Fotos (4)');
    expect(logica.fotosPozosLogic_textoBoton(0)).toBe('Fotos');
    expect(logica.fotosPozosLogic_textoBoton(null)).toBe('Fotos');
  });
});
