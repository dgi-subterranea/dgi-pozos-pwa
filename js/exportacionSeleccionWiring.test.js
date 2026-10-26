// E7-3: contratos de cableado de "Exportar Excel (N)" en Mi seleccion (frontend-only): scripts cargados y precacheados, boton real dentro de la pantalla existente, sin pantalla nueva,
// sin CSV, sin backend ni permisos nuevos, sin auditoria nueva, y los limites de cada archivo. (Reemplazan a las guardas de E7-2 que exigian "todavia sin cablear".)
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8').replace(/\r\n/g, '\n');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const html = leer('index.html');
const sw = leer('sw.js');
const { SHELL_FILES } = require('../sw');
const css = leer('css', 'styles.css');

const posicion = (t, s) => t.indexOf(s);
const scriptTag = (f) => '<script src="js/' + f + '"></script>';

describe('index.html: scripts de la exportacion', () => {
  test.each([['xlsxLogic.js'], ['exportacionSeleccionLogic.js'], ['exportacionSeleccion.js']])('js/%s se carga una sola vez', (f) => {
    expect(html.split(scriptTag(f)).length - 1).toBe(1);
  });

  test('orden: la logica antes que el controlador de la tabla; el controlador del boton DESPUES de seleccion.js (se engancha a el al cargar)', () => {
    const i = (f) => posicion(html, scriptTag(f));
    expect(i('seleccionLogic.js')).toBeLessThan(i('xlsxLogic.js'));
    expect(i('xlsxLogic.js')).toBeLessThan(i('exportacionSeleccionLogic.js'));
    expect(i('exportacionSeleccionLogic.js')).toBeLessThan(i('seleccion.js'));
    expect(i('seleccion.js')).toBeLessThan(i('exportacionSeleccion.js'));
    expect(i('exportacionSeleccion.js')).toBeLessThan(i('app.js'));
  });

  test('JSZip NO se carga al arrancar: ni como <script> en index.html ni en el shell', () => {
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/jszip/i);
    expect(SHELL_FILES.join('\n')).not.toMatch(/jszip/i);
  });
});

describe('index.html: el boton vive en la pantalla EXISTENTE de Mi seleccion', () => {
  const inicio = html.indexOf('<div id="screen-seleccion-tabla"');
  const fin = html.indexOf('<div id="screen-seleccion-itf"');
  const pantalla = html.slice(inicio, fin);

  test('esta dentro de screen-seleccion-tabla, despues de la barra de busqueda / orden', () => {
    expect(inicio).toBeGreaterThan(-1);
    expect(pantalla).toContain('id="btn-seleccion-exportar"');
    expect(pantalla.indexOf('seleccion-tabla-barra')).toBeLessThan(pantalla.indexOf('btn-seleccion-exportar'));
    expect(pantalla.indexOf('btn-seleccion-exportar')).toBeLessThan(pantalla.indexOf('id="seleccion-tabla-contenido"'));
  });

  test('es un <button type="button"> real, deshabilitado de entrada y con el texto "Exportar Excel (0)"', () => {
    expect(pantalla).toMatch(/<button type="button" id="btn-seleccion-exportar"[^>]*\bdisabled\b[^>]*>Exportar Excel \(0\)<\/button>/);
  });

  test('mensajes accesibles: estado con role="status" aria-live="polite" y error con role="alert"; ambos ocultos de entrada', () => {
    expect(pantalla).toMatch(/<p id="seleccion-exportar-estado"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden>/);
    expect(pantalla).toMatch(/<p id="seleccion-exportar-error"[^>]*role="alert"[^>]*hidden>/);
  });

  test('no hay pantalla, modal, wizard ni selector de formato de exportacion', () => {
    expect((html.match(/<div id="screen-[^"]*"/g) || []).some((x) => /export/i.test(x))).toBe(false);
    expect(html).not.toMatch(/id="[^"]*(modal|dialog|wizard|formato)[^"]*export|id="[^"]*export[^"]*(modal|dialog|wizard|formato)/i);
    expect(html).not.toMatch(/<select[^>]*export/i);
    expect(html.match(/btn-seleccion-exportar/g)).toHaveLength(1);
  });

  test('no existe CSV en ninguna parte de la UI', () => {
    expect(html).not.toMatch(/csv/i);
    expect(pantalla).not.toMatch(/csv/i);
  });
});

describe('service worker', () => {
  test.each([['xlsxLogic.js'], ['exportacionSeleccionLogic.js'], ['exportacionSeleccion.js']])('./js/%s esta en el shell (una vez)', (f) => {
    expect(SHELL_FILES.filter((x) => x === './js/' + f)).toHaveLength(1);
  });

  test('el orden del shell replica el de index.html', () => {
    const i = (f) => SHELL_FILES.indexOf('./js/' + f);
    expect(i('seleccionLogic.js')).toBeLessThan(i('xlsxLogic.js'));
    expect(i('xlsxLogic.js')).toBeLessThan(i('exportacionSeleccionLogic.js'));
    expect(i('exportacionSeleccionLogic.js')).toBeLessThan(i('seleccion.js'));
    expect(i('seleccion.js')).toBeLessThan(i('exportacionSeleccion.js'));
  });

  test('no se precachea ningun XLSX / CSV ni ninguna URL de objeto', () => {
    SHELL_FILES.forEach((f) => { expect(f).not.toMatch(/\.(xlsx|csv)$|^blob:/i); });
    expect(sinComentarios(sw)).not.toMatch(/\.xlsx|\.csv|blob:/i);
  });

  test('la API sigue sin cachearse (el service worker no toca los pedidos al backend)', () => {
    expect(sw).toMatch(/script\.google\.com|googleusercontent|\/exec|origin/i);
  });
});

describe('app.js: solo el cierre de sesion conoce la exportacion', () => {
  const app = sinComentarios(leer('js', 'app.js'));

  test('logout descarta una exportacion en preparacion', () => {
    const logout = app.slice(app.indexOf('function logout()'));
    expect(logout.slice(0, 1800)).toContain('exportacionSeleccionController_reset();');
  });

  test('no arma libros ni descargas: nada de xlsxLogic_ / exportacionSeleccion_ / Blob en app.js', () => {
    expect(app).not.toMatch(/xlsxLogic_|exportacionSeleccion_|new Blob|createObjectURL/);
    expect(app.match(/exportacionSeleccion\w*/g)).toEqual(['exportacionSeleccionController_reset']);
  });
});

describe('seleccion.js: solo entrega datos y cableado minimo', () => {
  const sel = sinComentarios(leer('js', 'seleccion.js'));

  test('expone la foto, la disponibilidad ITF de pozos concretos y el listener del contador', () => {
    ['seleccionController_snapshotExportacion', 'seleccionController_disponibilidadItfDe', 'seleccionController_registrarListenerFilasVisibles'].forEach((n) => {
      expect(sel).toContain('window.' + n + ' = ' + n + ';');
    });
  });

  test('no arma el XLSX ni descarga el Excel (eso es de js/exportacionSeleccion.js)', () => {
    expect(sel).not.toMatch(/xlsxLogic_|exportacionSeleccion_|dgi-pozos-seleccion|spreadsheetml/);
  });

  test('el contador sale de las filas que la tabla dibuja (notificarFilasVisibles(filas.length)), no de estado.seleccion.length', () => {
    expect(sel).toContain('notificarFilasVisibles(filas.length);');
    expect(sel).not.toMatch(/notificarFilasVisibles\(estado\.seleccion\.length\)/);
  });

  test('abrir la tabla no carga JSZip', () => {
    const abrir = sel.slice(sel.indexOf('function seleccionController_abrirTabla()'), sel.indexOf('function snapshotSeleccion()'));
    expect(abrir).not.toMatch(/JSZip/);
  });

  test('la foto usa la MISMA funcion que dibuja la tabla', () => {
    const foto = sel.slice(sel.indexOf('function seleccionController_snapshotExportacion()'));
    expect(foto.slice(0, 900)).toContain('construirFilasOrdenadasYFiltradas(tabla.indicePozos, tabla.indiceBusqueda, tabla.neSet, tabla.permisos)');
  });

  test('UNAUTHORIZED y USER_DISABLED cierran la sesion (flujo global) en la consulta de ITF', () => {
    expect(sel).toMatch(/result\.code === 'UNAUTHORIZED' \|\| result\.code === 'USER_DISABLED'/);
    expect(sel).toContain('manejarSiSesionExpiro(r.valor, contexto)');
  });

  test('la consulta de ITF para exportar exige perfil === true (nunca truthy)', () => {
    const f = sel.slice(sel.indexOf('function seleccionController_disponibilidadItfDe('));
    expect(f.slice(0, 600)).toContain("contexto.permisos.perfil !== true");
  });
});

describe('js/exportacionSeleccion.js: el controlador del boton', () => {
  const crudo = leer('js', 'exportacionSeleccion.js');
  const src = sinComentarios(crudo);

  test('estilo del frontend (script global ES5, sin modulos ni arrow functions ni const/let)', () => {
    expect(src).not.toMatch(/^\s*(import|export)\s/m);
    expect(src).not.toMatch(/=>/);
    expect(src).not.toMatch(/^\s*(const|let)\s/m);
    expect(src).not.toMatch(/\bconst\s|\blet\s/);
  });

  test('JSZip se carga solo dentro de exportar(), nunca al cargar el script', () => {
    expect(src.match(/mapaShared_cargarJSZip\(\)/g)).toHaveLength(1);
    const dentro = src.slice(src.indexOf('function exportar()'), src.indexOf('function exportacionSeleccionController_reset()'));
    expect(dentro).toContain('mapaShared_cargarJSZip()');
  });

  test('toda decision de columnas / formato / permisos esta en la logica E7-2: el controlador no la repite', () => {
    expect(src).not.toMatch(/\.ubicacion|\.ne\b|\.reemplazo|'Tiene ITF'|'Latitud'|'Longitud'|inlineStr|<c r=/);
    expect(src).toContain('exportacionSeleccion_construirLibro(');
    expect(src).toContain('xlsxLogic_generar(');
  });

  test('la descarga es Blob + enlace (sin File System Access API) con el MIME de XLSX y revocacion diferida', () => {
    expect(src).toContain('new Blob([archivo.bytes], { type: XLSX_MIME })');
    expect(src).not.toMatch(/showSaveFilePicker|showOpenFilePicker|FileSystem/);
    expect(src).toMatch(/a\.download = nombreArchivo/);
    expect(src).toMatch(/setTimeout\(function \(\) \{ URL\.revokeObjectURL\(url\); \}, REVOCAR_URL_MS\)/);
    expect(Number(/REVOCAR_URL_MS = (\d+)/.exec(src)[1])).toBeGreaterThanOrEqual(30000);
  });

  test('sin red propia, sin almacenamiento, sin auditoria nueva y sin CSV', () => {
    expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|localStorage|sessionStorage|apiGet|apiRegister|registrarExportacion|callBackend/);
    expect(crudo).not.toMatch(/csv/i);
  });

  test('no conoce datos personales ni identificadores internos', () => {
    expect(src).not.toMatch(/titular|nc16|email|sessionToken|clientRequestId|driveFileId|nombreAgente|secuencia|observacion/i);
  });

  test('los textos de usuario son los acordados', () => {
    expect(src).toContain("'Excel descargado.'");
    expect(src).toContain("'El archivo se exportó, pero no se pudo determinar la disponibilidad de ITF para algunos pozos.'");
    expect(src).toContain("'No se pudo preparar el archivo Excel. Intentá nuevamente.'");
    expect(src).toContain("'Preparando Excel…'");
    expect(src).toContain("'Exportar Excel (' + estado.n + ')'");
  });
});

describe('sin backend, sin permisos y sin pantalla nuevos', () => {
  const api = leer('backend', 'src', 'Api.js');

  test('el backend no conoce la exportacion (sin endpoint ni permiso nuevos)', () => {
    expect(api).not.toMatch(/exportar|exportacion|xlsx/i);
  });

  test('js/api.js no tiene ningun wrapper de exportacion', () => {
    expect(leer('js', 'api.js')).not.toMatch(/export(ar|acion)|xlsx/i);
  });

  test('los permisos del frontend no incluyen "exportar"', () => {
    expect(sinComentarios(leer('js', 'app.js'))).not.toMatch(/exportar\s*:/);
  });
});

describe('CSS del boton (responsive sin desbordar)', () => {
  const regla = (selector) => {
    const m = new RegExp('(?:^|\\n)' + selector.replace(/[.[\]]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(css);
    return m ? m[1] : null;
  };

  test('el contenedor envuelve (flex-wrap) y no fija anchos', () => {
    const r = regla('.seleccion-tabla-exportar');
    expect(r).toMatch(/display:\s*flex/);
    expect(r).toMatch(/flex-wrap:\s*wrap/);
    expect(r).not.toMatch(/\bwidth:\s*\d+px|overflow-x:\s*(auto|scroll)/);
  });

  test('el boton tiene area tactil minima de 44 px y estado deshabilitado visible (no solo por color)', () => {
    expect(regla('.seleccion-exportar-btn')).toMatch(/min-height:\s*44px/);
    expect(regla('.seleccion-exportar-btn:disabled')).toMatch(/cursor:\s*not-allowed/);
    expect(regla('.seleccion-exportar-btn:disabled')).toMatch(/opacity:\s*0\.\d+/);
  });

  test('los mensajes ocupan su propia linea cuando no entran y rompen palabras largas', () => {
    const r = regla('.seleccion-exportar-mensaje');
    expect(r).toMatch(/flex:\s*1 1 \d+px/);
    expect(r).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('en escritorio comparte el padding lateral de la barra de la tabla', () => {
    expect(css).toMatch(/\.seleccion-tabla-barra,\s*\n\s*\.seleccion-tabla-exportar,/);
  });

  test('el error y el aviso se distinguen tambien por el texto, no solo por color', () => {
    expect(regla('.seleccion-exportar-mensaje-error')).toMatch(/color:\s*var\(--color-error\)/);
    expect(regla('.seleccion-exportar-mensaje-aviso')).toMatch(/color:\s*var\(--color-warn\)/);
  });
});

describe('docs/exportacion-seleccion.md documenta el cableado', () => {
  const d = leer('docs', 'exportacion-seleccion.md');
  test.each([['Columnas'], ['Permisos'], ['Información'], ['Privacidad'], ['ITF'], ['Excel'], ['Exportar Excel (N)'], ['Safari']])('menciona %s', (tema) => {
    expect(d).toContain(tema);
  });
});
