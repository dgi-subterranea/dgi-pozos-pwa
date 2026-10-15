// Limites de la Etapa C (backend de sugerencias): separacion estricta de las decisiones, nada de UI / mapa / Cerca Mio / seleccion / reemplazos, ningun cambio de comportamiento en
// lo ya desplegado, y que los archivos nuevos se pueden subir a Apps Script sin chocar con nada (espacio global compartido, sin dependencias al cargar).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..', '..');
const src = path.join(raiz, 'backend', 'src');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const sinComentarios = (txt) => txt.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const NUEVOS = ['UbicacionFuenteSugerenciasRepository.js', 'UbicacionFuenteSugerenciasService.js', 'UbicacionFuenteSugerenciaNotificacion.js'];

describe('el frontend no sabe nada de las sugerencias (la UI es la etapa D)', () => {
  test('index.html, sw.js y ningun js/ (salvo tests) menciona los endpoints ni el modulo de sugerencias', () => {
    const patron = /sugerirDecisionFuente|getSugerenciasFuentes|resolverSugerenciaFuente|cancelarSugerenciaFuente|UbicacionFuenteSugerencias|apiSugerir|apiResolverSugerencia|ufs_/;
    expect(leer('index.html')).not.toMatch(patron);
    expect(leer('sw.js')).not.toMatch(patron);
    fs.readdirSync(path.join(raiz, 'js')).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js')).forEach((f) => {
      expect(leer('js', f)).not.toMatch(patron);
    });
  });

  test('ni el mapa, Cerca Mio, la seleccion, los reemplazos ni el overlay de ubicaciones conocen decisiones o sugerencias nuevas', () => {
    ['mapa.js', 'mapaDataset.js', 'cercaMio.js', 'seleccion.js', 'reemplazo.js', 'ubicacionOperativaLogic.js', 'ubicacionesConocidas.js', 'ubicacionesConocidasLogic.js'].forEach((f) => {
      if (fs.existsSync(path.join(raiz, 'js', f))) {
        expect(leer('js', f)).not.toMatch(/sugerirDecision|SugerenciasFuente|resolverSugerencia|cancelarSugerencia|UbicacionFuenteSugerencias|ufs_/);
      }
    });
  });

  test('no hay estado R, ni delta de decisiones, ni cambios al dataset del mapa en el backend', () => {
    const api = leer('backend', 'src', 'Api.js');
    expect(api).not.toMatch(/getDecisionesFuentesDelta/);
    NUEVOS.forEach((f) => expect(sinComentarios(leer('backend', 'src', f))).not.toMatch(/mapaService_|mapaNEService|getMapaPozos|estado\s*[:=]\s*'R'/));
  });
});

describe('separacion estricta: una sugerencia no es una decision', () => {
  const servicio = sinComentarios(leer('backend', 'src', 'UbicacionFuenteSugerenciasService.js'));
  const repo = sinComentarios(leer('backend', 'src', 'UbicacionFuenteSugerenciasRepository.js'));

  test('el servicio de sugerencias jamas escribe en la hoja de decisiones por su cuenta: solo a traves del nucleo compartido', () => {
    expect(servicio).not.toMatch(/ubicacionFuenteDecisionesRepository_agregar\(/);
    expect(servicio).toMatch(/ubicacionFuenteDecisionesService_aplicarDecision\(/);
    expect(repo).not.toMatch(/UbicacionFuenteDecisiones['"]|ubicacionFuenteDecisionesRepository_agregar/);
  });

  test('no recalcula el punto operativo ni el resolver: eso es del dominio de decisiones', () => {
    expect(servicio).not.toMatch(/ufd_resolverRegistral|ufd_resolverAutomatico|resolverRegistral/);
  });

  test('no toca las correcciones de campo: solo reutiliza sus utilidades de motivo / email / id', () => {
    [servicio, repo].forEach((c) => {
      expect(c).not.toMatch(/UbicacionCorrecciones|ubicacionCorreccionRepository_|ubicacionCorreccionService_(proponer|validar\b|rechazar|revertir|getPorPozo|getPendientes|leerDerivadas)/);
    });
    const usadas = (servicio.match(/ubicacionCorreccionService_\w+/g) || []).filter((v, i, a) => a.indexOf(v) === i).sort();
    expect(usadas).toEqual(['ubicacionCorreccionService_normalizarEmail', 'ubicacionCorreccionService_validarMotivo']);
  });

  test('QUITAR_ACEPTACION no existe entre las acciones sugeribles; la hoja y el servicio solo conocen ACEPTAR, DESCARTAR y RESTAURAR', () => {
    const S = require('../src/UbicacionFuenteSugerenciasService');
    expect(Object.keys(S.UFS_ACCIONES_SUGERIBLES).sort()).toEqual(['ACEPTAR', 'DESCARTAR', 'RESTAURAR']);
    expect(Object.keys(S.UFS_EVENTOS).sort()).toEqual(['APROBADA', 'CANCELADA', 'OBSOLETA', 'PROPUESTA', 'RECHAZADA']);
    expect(S.UFS_LIMITE_PENDIENTES).toBe(10);
  });

  test('las decisiones directas conservan su contrato: el nucleo extraido no cambio el orden de chequeos ni los codigos', () => {
    const dec = leer('backend', 'src', 'UbicacionFuenteDecisionesService.js');
    expect(dec).toMatch(/return ubicacionFuenteDecisionesService_aplicarDecision\(emailN, nombre, s, filas, padron\);/);
    expect(dec).toMatch(/function ubicacionFuenteDecisionesService_aplicarDecision\(emailN, nombre, s, filas, padron\)/);
    expect(dec).not.toMatch(/ubicacionFuenteSugerenciasRepository_/);                               // no lee ni escribe la hoja de sugerencias
    expect(dec).toMatch(/typeof ubicacionFuenteSugerenciasService_invalidar === 'function'/);          // solo le avisa que cambio el estado (invalidar cache), y solo si el modulo esta
  });

  test('solo los 3 archivos nuevos, Api.js y el servicio de decisiones (invalidacion del cache y nucleo) conocen el modulo; el resto del backend no', () => {
    const permitidos = NUEVOS.concat(['Api.js', 'UbicacionFuenteDecisionesService.js']);
    fs.readdirSync(src).filter((f) => permitidos.indexOf(f) === -1).forEach((f) => {
      expect(leer('backend', 'src', f)).not.toMatch(/ubicacionFuenteSugerencias|UbicacionFuenteSugerencias|UFS_|ufs_/);
    });
  });
});

describe('listos para Apps Script: espacio global compartido', () => {
  const archivos = fs.readdirSync(src).filter((f) => f.endsWith('.js'));

  test('cada archivo carga solo, sin dependencias al cargar (en Apps Script el orden de carga no esta garantizado)', () => {
    archivos.forEach((f) => {
      const ctx = vm.createContext({});
      expect(() => vm.runInContext(leer('backend', 'src', f), ctx, { filename: f })).not.toThrow();
    });
  });

  test('ningun nombre global esta definido en dos archivos (el segundo pisaria al primero en silencio)', () => {
    const vistos = {};
    archivos.forEach((f) => {
      const ctx = vm.createContext({});
      vm.runInContext(leer('backend', 'src', f), ctx, { filename: f });
      Object.getOwnPropertyNames(ctx).forEach((n) => { (vistos[n] = vistos[n] || []).push(f); });
    });
    const duplicados = Object.keys(vistos).filter((n) => vistos[n].length > 1).map((n) => n + ' -> ' + vistos[n].join(', '));
    expect(duplicados).toEqual([]);
  });

  test('los tres archivos nuevos definen sus funciones publicas con el prefijo del modulo', () => {
    NUEVOS.forEach((f) => {
      const ctx = vm.createContext({});
      vm.runInContext(leer('backend', 'src', f), ctx, { filename: f });
      Object.getOwnPropertyNames(ctx).filter((n) => typeof ctx[n] === 'function').forEach((n) => {
        expect(n).toMatch(/^(ubicacionFuenteSugerencias(Repository|Service)_|ubicacionFuenteSugerenciaNotificacion_|ufs_|setupUbicacionFuenteSugerenciasSheet$|diagnosticarUbicacionFuenteSugerencias$)/);
      });
    });
  });

  test('el setup no se ejecuta solo ni se nombra en ningun otro archivo (hay que correrlo a mano, una vez)', () => {
    archivos.filter((f) => f !== 'UbicacionFuenteSugerenciasRepository.js').forEach((f) => {
      expect(leer('backend', 'src', f)).not.toMatch(/setupUbicacionFuenteSugerenciasSheet\s*\(/);
    });
  });

  test('el manifest no cambia: sin scopes ni servicios avanzados nuevos (solo MailApp, que ya usan las correcciones)', () => {
    const usados = (c) => (c.match(/\b(SpreadsheetApp|LockService|CacheService|MailApp|UrlFetchApp|DriveApp|GmailApp|ScriptApp|PropertiesService|Session)\b/g) || []).filter((v, i, a) => a.indexOf(v) === i).sort();
    const todo = NUEVOS.map((f) => sinComentarios(leer('backend', 'src', f))).join('\n');
    expect(usados(todo)).toEqual(['CacheService', 'MailApp', 'SpreadsheetApp']);
  });
});
