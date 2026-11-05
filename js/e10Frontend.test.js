// E10-1 en el frontend: (1) mensaje para EMAIL_NO_VERIFICADO y su camino por el login; (2) el frontend ya NO mantiene una lista de permisos; (3) `mapa` gobierna lo que usa el dataset general.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');

describe('EMAIL_NO_VERIFICADO', () => {
  const ctx = vm.createContext({});
  vm.runInContext(leer('js', 'errorMessages.js'), ctx);

  test('tiene un mensaje en espanol que explica como resolverlo (la UI nunca muestra el message tecnico del backend)', () => {
    const m = vm.runInContext("getErrorMessage('EMAIL_NO_VERIFICADO')", ctx);
    expect(m).toMatch(/correo/i);
    expect(m).toMatch(/verific/i);
    expect(m).not.toMatch(/Ocurrió un error inesperado/);
  });

  test('el login muestra getErrorMessage(code) para todo codigo distinto de USER_DISABLED (por eso no hace falta tocar la logica del login)', () => {
    const app = leer('js', 'app.js');
    const i = app.indexOf('function handleCredentialResponse');
    const bloque = app.slice(i, app.indexOf('function init()', i));
    expect(bloque).toMatch(/result\.code === 'USER_DISABLED'\) \{\s*showScreen\('disabled'\);\s*\} else \{\s*loginErrorEl\.textContent = getErrorMessage\(result\.code\);/);
  });

  test('un codigo desconocido sigue mostrando el mensaje generico', () => {
    expect(vm.runInContext("getErrorMessage('CODIGO_QUE_NO_EXISTE')", ctx)).toMatch(/inesperado/);
  });
});

describe('el frontend no mantiene una lista de permisos', () => {
  test('permisosActuales arranca y se reinicia vacio; no hay ningun objeto literal con permisos en js/', () => {
    const app = leer('js', 'app.js');
    expect(app.match(/permisosActuales = \{\};/g)).toHaveLength(2);
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => {
      const fuente = sinComentarios(leer('js', f));
      expect({ f, lista: /perfil_subir:\s*(true|false)[\s\S]{0,300}observaciones_anular:\s*(true|false)/.test(fuente) }).toEqual({ f, lista: false });
    });
  });

  test('el frontend no usa el catalogo del backend ni lo duplica: ningun js/ nombra PermisosCatalogo', () => {
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => {
      expect({ f, usa: /PermisosCatalogo|permisosCatalogo_/.test(leer('js', f)) }).toEqual({ f, usa: false });
    });
  });

  test('con permisosActuales = {} todo chequeo es falso (fail-closed): las claves ausentes no conceden nada', () => {
    const mapa = vm.createContext({});
    vm.runInContext(leer('js', 'mapaLogic.js').replace(/if \(typeof module[\s\S]*$/, ''), mapa);
    expect(vm.runInContext('mapaLogic_calcularAccesos({}, true)', mapa)).toEqual({ cercaMio: false, mapas: 'ninguno', provincia: false, ne: false, itf: false, reemplazo: false });
  });
});

describe('`mapa` y el dataset general', () => {
  test('lo que usa el dataset (Cerca mio, Provincia, seleccion, Buscar reemplazo) se decide con mapaLogic: sin mapa no se ofrece', () => {
    const ctx = vm.createContext({});
    vm.runInContext(leer('js', 'mapaLogic.js').replace(/if \(typeof module[\s\S]*$/, ''), ctx);
    const a = (p) => vm.runInContext('mapaLogic_calcularAccesos(' + JSON.stringify(p) + ', true)', ctx);
    expect(a({ perfil: true, ubicacion: true, datos: true, ne: true })).toMatchObject({ cercaMio: false, provincia: false, mapas: 'ne' });
    expect(a({ perfil: true, mapa: true })).toMatchObject({ cercaMio: true, provincia: true, mapas: 'provincia' });
    expect(vm.runInContext('mapaLogic_puedeVerProvincia({ perfil: true })', ctx)).toBe(false);
    expect(vm.runInContext('mapaLogic_puedeVerProvincia({ perfil: true, mapa: true })', ctx)).toBe(true);
  });

  test('app.js muestra el boton de Cerca mio solo con accesos.cercaMio y el boton de mapas solo si accesos.mapas no es "ninguno" (ambos derivados de mapaLogic)', () => {
    const app = leer('js', 'app.js');
    expect(app).toMatch(/btn-abrir-cerca-mio'\)\.hidden = !accesos\.cercaMio/);
    expect(app).toMatch(/btn-abrir-mapa'\)\.hidden = accesos\.mapas === 'ninguno'/);
  });

  test('app.js sabe abrir Niveles Estaticos directo cuando mapas = "ne" (ne sin mapa)', () => {
    expect(leer('js', 'app.js')).toMatch(/acceso === 'ne'\) \{\s*abrirMapaNE\(\);/);
  });
});

describe('rol de ubicacion: `ubicacion` es lectura; sugerir exige ubicacion_corregir', () => {
  const ctx = vm.createContext({});
  vm.runInContext(leer('js', 'ubicacionFuenteDecisionesUiLogic.js').replace(/if \(typeof module[\s\S]*$/, ''), ctx);
  const rol = (p) => vm.runInContext('ufdui_rol(' + JSON.stringify(p) + ')', ctx);

  test.each([
    [{ ubicacion: true }, 'CONSULTA'],
    [{ ubicacion: true, ubicacion_corregir: true }, 'LECTOR'],
    [{ ubicacion: true, ubicacion_validar: true }, 'VALIDADOR'],
    [{ ubicacion: true, ubicacion_corregir: true, ubicacion_validar: true }, 'VALIDADOR'],
    [{ ubicacion_corregir: true }, null],
    [{}, null]
  ])('%j -> %s', (permisos, esperado) => {
    expect(rol(permisos)).toBe(esperado);
  });

  test('un CONSULTA no tiene ninguna accion sobre las fuentes', () => {
    const acciones = vm.runInContext("ufdui_accionesPara('SIN_REVISAR', 'CONSULTA')", ctx);
    expect(acciones).toEqual([]);
  });
});
