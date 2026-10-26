// E7-2 deja la logica de exportacion LISTA pero SIN CABLEAR: ni boton, ni pantalla, ni descarga, ni permisos nuevos, ni backend. Estas guardas fijan ese limite hasta E7-3 (que las reemplaza
// por las de la UI). Tambien: los archivos nuevos son globales ES5 (como el resto del frontend) y el documento de diseno existe.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('E7-2: nada de la exportacion esta cableado todavia', () => {
  test.each([['index.html'], ['sw.js'], [path.join('js', 'app.js')], [path.join('css', 'styles.css')], [path.join('js', 'api.js')]])('%s no menciona la exportacion ni el escritor XLSX', (archivo) => {
    const t = leer(archivo);
    expect(t).not.toMatch(/exportacionSeleccion|xlsxLogic|dgi-pozos-seleccion/);
  });

  test('el backend no conoce la exportacion (sin endpoint nuevo ni permiso nuevo)', () => {
    const api = leer('backend', 'src', 'Api.js');
    expect(api).not.toMatch(/exportar|exportacion|xlsx/i);
    expect(api).not.toMatch(/action === 'getExport/);
  });

  test('ningun controlador existente descarga ni arma un XLSX', () => {
    ['seleccion.js', 'app.js', 'mapa.js', 'cercaMio.js'].forEach((f) => {
      const t = sinComentarios(leer('js', f));
      expect(t).not.toMatch(/xlsx|exportacionSeleccion_/i);
    });
  });

  test('seleccion.js sigue descargando solo lo suyo (ZIP de ITF): ningun nombre de archivo de exportacion', () => {
    expect(sinComentarios(leer('js', 'seleccion.js'))).not.toMatch(/dgi-pozos-seleccion/);
  });
});

describe('E7-2: los archivos nuevos siguen el estilo del frontend (scripts globales ES5)', () => {
  test.each([['xlsxLogic.js'], ['exportacionSeleccionLogic.js']])('js/%s: sin modulos ES, sin arrow functions ni const/let, con guarda de module.exports', (f) => {
    const t = sinComentarios(leer('js', f));
    expect(t).not.toMatch(/^\s*(import|export)\s/m);
    expect(t).not.toMatch(/=>/);
    expect(t).not.toMatch(/^\s*(const|let)\s/m);
    expect(t).not.toMatch(/`/);
    expect(t).toMatch(/typeof module !== 'undefined' && module\.exports/);
  });

  test('los nombres de funciones y constantes globales usan el prefijo del archivo', () => {
    const x = sinComentarios(leer('js', 'xlsxLogic.js'));
    (x.match(/^function (\w+)/gm) || []).forEach((l) => { expect(l).toMatch(/function xlsxLogic_/); });
    const e = sinComentarios(leer('js', 'exportacionSeleccionLogic.js'));
    (e.match(/^function (\w+)/gm) || []).forEach((l) => { expect(l).toMatch(/function exportacionSeleccion_/); });
  });

  test('docs/exportacion-seleccion.md existe y documenta columnas, permisos, filtros, Informacion, privacidad y limites', () => {
    const d = leer('docs', 'exportacion-seleccion.md');
    ['Columnas', 'Permisos', 'Información', 'Privacidad', 'ITF', 'Excel'].forEach((tema) => { expect(d).toContain(tema); });
  });
});
