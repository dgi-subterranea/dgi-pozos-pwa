// Genera un XLSX de exportacion de Mi seleccion con el codigo REAL del frontend (js/exportacionSeleccionLogic.js + js/xlsxLogic.js + JSZip del vendor), para verificarlo desde afuera
// (scripts/test_xlsx_exportacion.py con openpyxl; Excel real a mano). Uso:  node scripts/generar_xlsx_exportacion.js <salida.xlsx> [muestra|N]
//   muestra (default): pozos con texto hostil (=, +, -, @, acentos, emoji, saltos de linea, caracteres de control) y coordenadas negativas, con todos los permisos
//   N: N pozos sinteticos (prueba de escala), con todos los permisos
// Escribe en stdout un JSON con el modelo esperado {columnas, filas, informacion} para comparar.
const fs = require('fs');
const path = require('path');

const js = (f) => require(path.join(__dirname, '..', 'js', f));
Object.assign(global, js('mapaLogic.js'), js('reemplazoResumenLogic.js'), js('seleccionLogic.js'), js('xlsxLogic.js'));
const E = js('exportacionSeleccionLogic.js');
const JSZip = require(path.join(__dirname, '..', 'vendor', 'jszip', 'jszip.min.js'));

const salida = process.argv[2];
const modo = process.argv[3] || 'muestra';
if (!salida) { console.error('falta la ruta de salida'); process.exit(2); }

const TODOS = { ubicacion: true, perfil: true, ne: true, reemplazo: true };
const HOSTILES = ['=1+1', '+1+1', '-1+2', '@SUM(1,2)', '\t=2+2', 'linea1\nlinea2', 'dos\r\nlineas', '1/2', '1-2', '00123', '1e5', '=HYPERLINK("http://x","y")', 'Ñandú, Río & "ñoño" <b> 🚰', 'ctrl\u0000\u0001\u001Fx', '31/12', 'TRUE', '#N/A'];

function fixtureMuestra() {
  const indice = {};
  const ids = [];
  HOSTILES.forEach((cuenca, i) => {
    const id = String((i % 18) + 1).padStart(2, '0') + '-' + String(i + 1).padStart(4, '0');
    ids.push(id);
    indice[id] = { wellId: id, lat: -32.5 - i / 100 + 0.123456789, lon: -68.25 - i / 100 - 0.987654321, estado: ['D', 'C', 'R', 'V'][i % 4], cuenca, profundidad: i % 5 === 0 ? undefined : 10.5 + i, surgencia: ['Profundo', 'SemiSurgente', 'Natural'][i % 3] };
  });
  ids.push('99-9999');                                                            // pozo ausente del dataset
  return { ids, indice };
}

function fixtureEscala(n) {
  const indice = {};
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    const id = String((i % 18) + 1).padStart(2, '0') + '-' + String(i).padStart(4, '0');
    ids.push(id);
    indice[id] = { wellId: id, lat: -33 - (i % 1000) / 1000, lon: -68 - (i % 1000) / 997, estado: ['D', 'C', 'R', 'V'][i % 4], cuenca: 'Cuenca ' + (i % 25), profundidad: i % 7 === 0 ? undefined : (i % 400) + 0.5, surgencia: ['Profundo', 'SemiSurgente', 'Natural'][i % 3] };
  }
  return { ids, indice };
}

const { ids, indice } = /^\d+$/.test(modo) ? fixtureEscala(Number(modo)) : fixtureMuestra();
const itf = { disponibilidad: {}, desconocidos: [] };
const resumen = {};
const ne = new Set();
ids.forEach((id, i) => {
  if (id === '99-9999') { return; }
  if (i % 4 === 3) { itf.desconocidos.push(id); } else { itf.disponibilidad[id] = i % 2 === 0; }
  resumen[id] = ['APTO', 'DUDOSO', 'NO_APTO'][i % 3];
  if (i % 5 === 0) { ne.add(id); }
});
const m = E.exportacionSeleccion_construirLibro({
  wellIds: ids, totalSeleccion: ids.length, permisos: TODOS, indicePozos: indice, neSet: ne, itf, resumenReemplazo: resumen,
  filtros: { texto: '=BUSQUEDA', orden: 'wellId', aptitudActivos: { APTO: true } }, periodoPadron: '2026-05', ahora: new Date('2026-10-26T14:03:09Z')
});

xlsxLogic_generar(m.libro, JSZip, 'nodebuffer').then((buf) => {
  fs.writeFileSync(salida, buf);
  process.stdout.write(JSON.stringify({ nombreArchivo: m.nombreArchivo, columnas: m.columnas.map((c) => ({ clave: c.clave, encabezado: c.encabezado, tipo: c.tipo })), filas: m.filas, informacion: m.informacion, bytes: buf.length }));
});
