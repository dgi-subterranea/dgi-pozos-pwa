// Guardas baratas del cableado de "Buscar reemplazo" (el controlador DOM no se
// testea con Jest, igual que mapa.js/cercaMio.js): que todo id que usa el
// controlador exista en index.html y que los scripts se carguen en orden.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'index.html'), 'utf8');
const controlador = fs.readFileSync(path.join(__dirname, 'buscarReemplazo.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

describe('index.html y controlador', () => {
  test('todos los ids que usa el controlador existen en el HTML', () => {
    const ids = new Set();
    controlador.replace(/getElementById\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    controlador.replace(/\bel\('([^']+)'\)/g, (_, id) => { ids.add(id); return ''; });
    expect(ids.size).toBeGreaterThan(30);
    const faltan = [...ids].filter((id) => !new RegExp('id="' + id + '"').test(html));
    expect(faltan).toEqual([]);
  });

  test('los selectores por clase tienen elementos en el HTML', () => {
    ['bre-radio-chip', 'bre-orden-chip'].forEach((clase) => {
      expect(html).toMatch(new RegExp('class="[^"]*' + clase));
    });
  });

  test('la pantalla existe, oculta por defecto, y app.js la registra', () => {
    expect(html).toMatch(/<div id="screen-buscar-reemplazo" class="screen" hidden>/);
    expect(app).toMatch(/buscarReemplazo: document\.getElementById\('screen-buscar-reemplazo'\)/);
  });

  test('scripts en orden: logica despues de cercaMioLogic/reemplazoResumenLogic, controlador antes de app.js', () => {
    const pos = (archivo) => html.indexOf('src="js/' + archivo + '"');
    expect(pos('cercaMioLogic.js')).toBeGreaterThan(-1);
    expect(pos('buscarReemplazoLogic.js')).toBeGreaterThan(pos('cercaMioLogic.js'));
    expect(pos('buscarReemplazoLogic.js')).toBeGreaterThan(pos('reemplazoResumenLogic.js'));
    expect(pos('buscarReemplazo.js')).toBeGreaterThan(pos('buscarReemplazoLogic.js'));
    expect(pos('buscarReemplazo.js')).toBeGreaterThan(pos('mapaNEDataset.js'));
    expect(pos('app.js')).toBeGreaterThan(pos('buscarReemplazo.js'));
  });

  test('app.js expone Volver y entra por el monitoringId (popup NE y ficha NE)', () => {
    expect(app).toMatch(/function abrirBuscarReemplazo\(monitoringId\)/);
    expect(app).toMatch(/\? function \(monitoringId\) \{ abrirBuscarReemplazo\(monitoringId\); \}/);
    expect(app).toMatch(/btn-ne-buscar-reemplazo/);
    expect(app).toMatch(/btn-bre-volver/);
  });

  test('"Evaluar" pasa el punto NE de referencia al modulo de reemplazo', () => {
    expect(app).toMatch(/onEvaluarReemplazo: function \(wellId, puntoNE\)[\s\S]{0,80}puntoNEReferencia: puntoNE/);
  });

  test('Evaluar desde el popup del mapa toma la referencia del contexto vigente (solo si es de una busqueda de reemplazo)', () => {
    expect(app).toMatch(/puntoNEReferencia: buscarReemplazoLogic_puntoNEDeContexto\(seleccionController_obtenerContextoGeografico\(\), wellId\) \|\| ''/);
    // Cerca Mio y Mi seleccion siguen sin referencia: nunca se inventa una
    const cerca = app.slice(app.indexOf('function abrirCercaMio'), app.indexOf("document.getElementById('btn-abrir-cerca-mio')"));
    expect(cerca).not.toMatch(/puntoNEReferencia/);
  });

  test('la exclusion de la red NE usa tambien los miembros sin coordenada que manda getMapaNE', () => {
    expect(controlador).toMatch(/buscarReemplazoLogic_wellIdsRedNE\(rNE\.data\.puntos, rNE\.data\.wellIdsSinCoordenada\)/);
  });

  test('el acceso a Buscar reemplazo exige reemplazo=SI en el popup NE, en la ficha NE y al abrir', () => {
    expect(app).toMatch(/onBuscarReemplazo: buscarReemplazoLogic_puedeBuscar\(permisosActuales\)/);
    expect(app).toMatch(/buscarReemplazoLogic_puedeBuscar\(permisosActuales\) && punto\.coordenadas/);
    expect(app).toMatch(/function abrirBuscarReemplazo\(monitoringId\) \{\s*if \(!buscarReemplazoLogic_puedeBuscar\(permisosActuales\)\)/);
    expect(controlador).toMatch(/if \(!buscarReemplazoLogic_puedeBuscar\(contexto\.permisos\)\)/);
  });

  test('el popup del mapa NE solo muestra "Buscar reemplazo" si el contexto trae la accion', () => {
    const shared = fs.readFileSync(path.join(__dirname, 'mapaShared.js'), 'utf8');
    expect(shared).toMatch(/if \(typeof contexto\.onBuscarReemplazo === 'function'\)/);
  });

  test('el controlador nunca pinta datos como HTML', () => {
    expect(controlador).not.toMatch(/\.innerHTML\s*=\s*[^'"\s]/);
    expect(controlador.match(/innerHTML\s*=\s*([^;]+);/g).every((l) => /=\s*''\s*;/.test(l))).toBe(true);
  });

  test('no manda coordenadas a ningun backend (solo datasets en memoria)', () => {
    const llamadas = controlador.match(/api[A-Z][A-Za-z]+\(/g) || [];
    expect(llamadas).toEqual([]);
  });
});
