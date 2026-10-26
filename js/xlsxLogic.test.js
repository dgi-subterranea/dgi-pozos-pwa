// Escritor XLSX (js/xlsxLogic.js): texto literal (jamas formulas), numeros tipados, XML valido, nombres de hoja, limite de celda y paquete abrible. Usa el JSZip del vendor.
const JSZip = require('../vendor/jszip/jszip.min.js');
const X = require('./xlsxLogic');

const sinMarcas = (s) => s.replace(/<[^>]*>/g, '');                       // texto de un fragmento XML, sin etiquetas
const entidadesValidas = (xml) => !/&(?!amp;|lt;|gt;|quot;|#\d+;)/.test(sinMarcas(xml)) && !/[<>]/.test(sinMarcas(xml));
const celdaTexto = (valor) => X.xlsxLogic_xmlCelda(valor, 0, 0);
const textoDe = (xmlCelda) => /<t xml:space="preserve">([\s\S]*)<\/t>/.exec(xmlCelda)[1];

describe('sanitizar texto', () => {
  test('quita los caracteres de control ilegales en XML y conserva tabulacion y salto de linea', () => {
    const entrada = 'a\u0000b\u0001c\u0008d\u000Be\u000Cf\u000Eg\u001Fh\tj\nk';
    expect(X.xlsxLogic_sanitizarTexto(entrada)).toBe('abcdefgh\tj\nk');
    expect(X.xlsxLogic_sanitizarTexto('x￾y￿z')).toBe('xyz');
  });

  test('CR y CRLF se normalizan a LF (no se pierde el salto, no queda un CR suelto)', () => {
    expect(X.xlsxLogic_sanitizarTexto('a\r\nb\rc\nd')).toBe('a\nb\nc\nd');
    expect(X.xlsxLogic_sanitizarTexto('a\r\n\r\nb')).toBe('a\n\nb');
  });

  test('conserva acentos, enie y emoji (par sustituto valido) y quita los sustitutos sueltos', () => {
    expect(X.xlsxLogic_sanitizarTexto('Ñandú Río ñoño 🚰 ✓')).toBe('Ñandú Río ñoño 🚰 ✓');
    expect(X.xlsxLogic_sanitizarTexto('a\uD83Db')).toBe('ab');                // alto suelto
    expect(X.xlsxLogic_sanitizarTexto('a\uDE80b')).toBe('ab');                // bajo suelto
    expect(X.xlsxLogic_sanitizarTexto('a\uDE80\uD83Db')).toBe('ab');          // al reves: ambos sueltos
  });

  test('limite de Excel: 32.767 caracteres exactos se conservan, uno mas se corta', () => {
    expect(X.xlsxLogic_sanitizarTexto('a'.repeat(32767))).toHaveLength(32767);
    expect(X.xlsxLogic_sanitizarTexto('a'.repeat(32768))).toHaveLength(32767);
    expect(X.xlsxLogic_sanitizarTexto('a'.repeat(100000))).toHaveLength(32767);
  });

  test('el corte nunca parte un par sustituto (emoji) en la frontera', () => {
    const t = X.xlsxLogic_sanitizarTexto('a'.repeat(32766) + '🚰');
    expect(t).toBe('a'.repeat(32766));                                        // el emoji (2 unidades) no entra entero
    const u = X.xlsxLogic_sanitizarTexto('a'.repeat(32765) + '🚰');
    expect(u).toBe('a'.repeat(32765) + '🚰');
    expect(u).toHaveLength(32767);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(t)).toBe(false);
  });

  test('null / undefined -> vacio; numeros y otros se pasan a texto', () => {
    expect(X.xlsxLogic_sanitizarTexto(null)).toBe('');
    expect(X.xlsxLogic_sanitizarTexto(undefined)).toBe('');
    expect(X.xlsxLogic_sanitizarTexto(12)).toBe('12');
  });
});

describe('escape XML', () => {
  test('& < > " se escapan', () => {
    expect(X.xlsxLogic_escaparXml('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e');
  });

  test('el & se escapa primero: no hay doble escape de las otras entidades', () => {
    expect(X.xlsxLogic_escaparXml('<&>')).toBe('&lt;&amp;&gt;');
    expect(X.xlsxLogic_escaparXml('&amp;')).toBe('&amp;amp;');
  });

  test('una celda con texto hostil queda con entidades validas y sin etiquetas sueltas', () => {
    const xml = celdaTexto('</t></is></c><c r="Z9"><f>1+1</f></c> & "x" <b>');
    expect(entidadesValidas(xml)).toBe(true);
    expect(xml).not.toContain('<f>');
    expect(xml.match(/<c /g)).toHaveLength(1);
  });
});

describe('celdas: texto, numero y vacio', () => {
  test('un texto es inlineStr con xml:space="preserve" y nunca una formula', () => {
    const xml = celdaTexto('hola');
    expect(xml).toBe('<c r="A1" t="inlineStr"><is><t xml:space="preserve">hola</t></is></c>');
    expect(xml).not.toMatch(/<f[ >]/);
  });

  test.each(['=1+1', '+1+1', '-1+2', '@SUM(1,2)', '\t=2+2', '=cmd|\' /C calc\'!A0', '1/2', '1-2', '0123', '1e5', '00:30', '=HYPERLINK("http://x","y")'])(
    '"%s" queda como texto literal (inlineStr, sin <f>, sin <v>)', (t) => {
      const xml = celdaTexto(t);
      expect(xml).toContain('t="inlineStr"');
      expect(xml).not.toMatch(/<f[ >]/);
      expect(xml).not.toContain('<v>');
      expect(xml).toContain('<is>');
    });

  test('un numero es celda numerica <v> sin t=', () => {
    expect(celdaTexto(139.5)).toBe('<c r="A1"><v>139.5</v></c>');
    expect(celdaTexto(0)).toBe('<c r="A1"><v>0</v></c>');
    expect(celdaTexto(-32.87677)).toBe('<c r="A1"><v>-32.87677</v></c>');
  });

  test('el numero nunca sale localizado: punto decimal, sin separador de miles ni coma', () => {
    expect(celdaTexto(1234567.891)).toBe('<c r="A1"><v>1234567.891</v></c>');
    expect(celdaTexto(-68.8639)).toContain('<v>-68.8639</v>');
    expect(celdaTexto(-0)).toBe('<c r="A1"><v>0</v></c>');
  });

  test('numero muy chico o muy grande: notacion que XML/Excel entienden (sin coma)', () => {
    expect(celdaTexto(1e-7)).toBe('<c r="A1"><v>1e-7</v></c>');
    expect(celdaTexto(1e21)).toBe('<c r="A1"><v>1e+21</v></c>');
  });

  test('NaN, Infinity, booleanos, objetos y funciones -> celda vacia (no se inventa un texto)', () => {
    [NaN, Infinity, -Infinity, true, false, {}, [], () => 1, null, undefined, ''].forEach((v) => {
      expect(celdaTexto(v)).toBe('');
    });
  });

  test('un texto que queda vacio tras sanitizar (solo caracteres ilegales) -> celda vacia', () => {
    expect(celdaTexto('\u0000\u0001')).toBe('');
  });

  test('un numero en forma de texto sigue siendo texto (no se convierte)', () => {
    const xml = celdaTexto('139.5');
    expect(xml).toContain('t="inlineStr"');
    expect(xml).not.toContain('<v>');
  });

  test('estilos: encabezado (s=1) y coordenada (s=2) en texto y numero; un estilo desconocido se ignora', () => {
    expect(X.xlsxLogic_xmlCelda({ texto: 'Pozo', estilo: X.XLSX_ESTILOS.encabezado }, 0, 0)).toContain(' s="1"');
    expect(X.xlsxLogic_xmlCelda({ numero: -32.5, estilo: X.XLSX_ESTILOS.coordenada }, 0, 0)).toBe('<c r="A1" s="2"><v>-32.5</v></c>');
    expect(X.xlsxLogic_xmlCelda({ numero: 1, estilo: 99 }, 0, 0)).toBe('<c r="A1"><v>1</v></c>');
  });

  test('la referencia respeta fila y columna (incluida la columna AA)', () => {
    expect(X.xlsxLogic_xmlCelda('x', 4, 27)).toContain('r="AB5"');
    expect(X.xlsxLogic_letraColumna(0)).toBe('A');
    expect(X.xlsxLogic_letraColumna(25)).toBe('Z');
    expect(X.xlsxLogic_letraColumna(26)).toBe('AA');
    expect(X.xlsxLogic_letraColumna(701)).toBe('ZZ');
    expect(X.xlsxLogic_letraColumna(702)).toBe('AAA');
  });

  test('una celda con 40.000 caracteres sale cortada a 32.767', () => {
    expect(textoDe(celdaTexto('x'.repeat(40000)))).toHaveLength(32767);
  });
});

describe('nombres de hoja', () => {
  test.each([
    ['Pozos', 'Pozos'],
    ['Información', 'Información'],
    ['a[b]c', 'a b c'],
    ['a:b*c?d/e\\f', 'a b c d e f'],
    ["'entre apostrofes'", 'entre apostrofes'],
    ['', 'Hoja'],
    ['[]', 'Hoja'],
    [null, 'Hoja'],
    ['x'.repeat(40), 'x'.repeat(31)]
  ])('%j -> %j', (entrada, esperado) => {
    expect(X.xlsxLogic_nombreHojaValido(entrada)).toBe(esperado);
  });

  test('nunca supera 31 caracteres ni parte un emoji', () => {
    const n = X.xlsxLogic_nombreHojaValido('a'.repeat(30) + '🚰');
    expect(n.length).toBeLessThanOrEqual(31);
    expect(/[\uD800-\uDBFF]$/.test(n)).toBe(false);
  });

  test('repetidos (sin distinguir mayusculas) llevan sufijo y siguen siendo validos', () => {
    expect(X.xlsxLogic_nombresUnicos(['Pozos', 'pozos', 'POZOS'])).toEqual(['Pozos', 'pozos (2)', 'POZOS (3)']);
    const largos = X.xlsxLogic_nombresUnicos(['x'.repeat(31), 'x'.repeat(31)]);
    expect(largos[1]).toHaveLength(31);
    expect(largos[0]).not.toBe(largos[1]);
  });
});

describe('hoja XML', () => {
  const hoja = {
    nombre: 'Pozos',
    filas: [[{ texto: 'A', estilo: 1 }, { texto: 'B', estilo: 1 }], ['x', 2], ['y', null]],
    anchos: [12, 20],
    congelarPrimeraFila: true,
    autofiltro: true
  };
  const xml = X.xlsxLogic_xmlHoja(hoja);

  test('primera fila congelada, anchos y autofiltro sobre todo el rango; orden de elementos valido para Excel', () => {
    expect(xml).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(xml).toContain('<col min="1" max="1" width="12" customWidth="1"/>');
    expect(xml).toContain('<autoFilter ref="A1:B3"/>');
    expect(xml).toContain('<dimension ref="A1:B3"/>');
    const orden = ['<dimension', '<sheetViews', '<cols', '<sheetData', '<autoFilter'].map((t) => xml.indexOf(t));
    expect(orden.every((v) => v >= 0)).toBe(true);
    expect([...orden].sort((a, b) => a - b)).toEqual(orden);
  });

  test('sin congelar ni autofiltro no aparecen', () => {
    const simple = X.xlsxLogic_xmlHoja({ nombre: 'H', filas: [['a']] });
    expect(simple).not.toContain('<pane');
    expect(simple).not.toContain('<autoFilter');
    expect(simple).not.toContain('<cols>');
  });

  test('una hoja sin filas es valida (dimension A1:A1, sheetData vacio, sin autofiltro)', () => {
    const vacia = X.xlsxLogic_xmlHoja({ nombre: 'H', filas: [], autofiltro: true });
    expect(vacia).toContain('<sheetData></sheetData>');
    expect(vacia).toContain('<dimension ref="A1:A1"/>');
    expect(vacia).not.toContain('<autoFilter');
  });

  test('las celdas vacias no se escriben, pero la fila existe', () => {
    expect(xml).toContain('<row r="3"><c r="A3" t="inlineStr">');
    expect(xml.match(/<row /g)).toHaveLength(3);
    expect(xml).not.toContain('r="B3"');
  });

  test('un ancho invalido cae a un ancho por defecto y uno enorme se limita a 255', () => {
    const x = X.xlsxLogic_xmlHoja({ nombre: 'H', filas: [['a', 'b']], anchos: [NaN, 9999] });
    expect(x).toContain('<col min="1" max="1" width="10" customWidth="1"/>');
    expect(x).toContain('width="255"');
  });
});

describe('paquete completo', () => {
  const libro = { hojas: [{ nombre: 'Pozos', filas: [['Pozo', 'Prof'], ['14-0001', 139.5]] }, { nombre: 'Información', filas: [['k', 'v']] }] };
  const partes = X.xlsxLogic_construirPartes(libro);

  test('tiene todas las partes requeridas', () => {
    expect(Object.keys(partes).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'
    ]);
  });

  test('workbook: nombres de hoja en orden con ids consecutivos; relaciones y tipos de contenido coinciden', () => {
    expect(partes['xl/workbook.xml']).toContain('<sheet name="Pozos" sheetId="1" r:id="rId1"/><sheet name="Información" sheetId="2" r:id="rId2"/>');
    expect(partes['xl/_rels/workbook.xml.rels']).toContain('Target="worksheets/sheet2.xml"');
    expect(partes['xl/_rels/workbook.xml.rels']).toContain('Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    expect(partes['[Content_Types].xml']).toContain('/xl/worksheets/sheet2.xml');
    expect(partes['[Content_Types].xml']).toContain('/xl/styles.xml');
  });

  test('ninguna parte del paquete contiene formulas (<f>) ni cadenas compartidas', () => {
    Object.keys(partes).forEach((ruta) => { expect(partes[ruta]).not.toMatch(/<f[ >\/]/); });
    expect(Object.keys(partes).some((r) => /sharedStrings/.test(r))).toBe(false);
  });

  test('styles: negrita y formato 0.000000 para coordenadas', () => {
    expect(partes['xl/styles.xml']).toContain('formatCode="0.000000"');
    expect(partes['xl/styles.xml']).toContain('<b/>');
    expect(partes['xl/styles.xml']).toContain('<cellXfs count="3">');
  });

  test('un libro sin hojas igual produce un paquete con una hoja vacia valida', () => {
    const p = X.xlsxLogic_construirPartes({ hojas: [] });
    expect(p['xl/workbook.xml']).toContain('<sheet name="Hoja"');
    expect(p['xl/worksheets/sheet1.xml']).toContain('<sheetData></sheetData>');
  });

  test('nombres de hoja repetidos o invalidos se corrigen en el workbook', () => {
    const p = X.xlsxLogic_construirPartes({ hojas: [{ nombre: 'a/b', filas: [] }, { nombre: 'A B', filas: [] }] });
    expect(p['xl/workbook.xml']).toContain('name="a b"');
    expect(p['xl/workbook.xml']).toContain('name="A B (2)"');
  });

  test('los nombres de hoja se escapan en el workbook', () => {
    const p = X.xlsxLogic_construirPartes({ hojas: [{ nombre: 'a&b"c', filas: [] }] });
    expect(p['xl/workbook.xml']).toContain('name="a&amp;b&quot;c"');
  });
});

describe('generar con JSZip', () => {
  const libro = { hojas: [{ nombre: 'Pozos', filas: [['Pozo', 'Prof'], ['=1+1', 139.5], ['Ñandú 🚰', null]] }] };

  test('devuelve un zip que se vuelve a abrir con las partes y el contenido intactos', async () => {
    const bytes = await X.xlsxLogic_generar(libro, JSZip);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4B);                                              // "PK"
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toContain('xl/worksheets/sheet1.xml');
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(hoja).toContain('<t xml:space="preserve">=1+1</t>');
    expect(hoja).toContain('<v>139.5</v>');
    expect(hoja).toContain('Ñandú 🚰');
    expect(hoja).not.toMatch(/<f[ >]/);
  });

  test('con tipo "nodebuffer" y con "blob"/"uint8array" segun lo pedido', async () => {
    const buf = await X.xlsxLogic_generar(libro, JSZip, 'nodebuffer');
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  test('un libro de 0 filas es un xlsx valido (solo el encabezado)', async () => {
    const bytes = await X.xlsxLogic_generar({ hojas: [{ nombre: 'Pozos', filas: [[{ texto: 'Pozo', estilo: 1 }]], congelarPrimeraFila: true, autofiltro: true }] }, JSZip);
    const zip = await JSZip.loadAsync(bytes);
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(hoja).toContain('<autoFilter ref="A1:A1"/>');
  });

  test('sin JSZip rechaza (no hay descarga a medias)', async () => {
    await expect(X.xlsxLogic_generar(libro, undefined)).rejects.toThrow(/JSZip/);
    await expect(X.xlsxLogic_generar(libro, {})).rejects.toThrow(/JSZip/);
  });

  test('el contenido de 5.000 filas con texto hostil se genera y se vuelve a leer completo', async () => {
    const filas = [['Pozo', 'Nota']];
    for (let i = 0; i < 5000; i += 1) { filas.push(['14-' + String(i).padStart(4, '0'), i % 3 === 0 ? '=1+1' : (i % 3 === 1 ? '<&>' : 'x\u0000y')]); }
    const bytes = await X.xlsxLogic_generar({ hojas: [{ nombre: 'Pozos', filas }] }, JSZip);
    const zip = await JSZip.loadAsync(bytes);
    const hoja = await zip.file('xl/worksheets/sheet1.xml').async('string');
    expect(hoja.match(/<row /g)).toHaveLength(5001);
    expect(hoja).not.toMatch(/<f[ >]/);
    expect(hoja).not.toMatch(/\u0000/);
  });
});

describe('el escritor es puro', () => {
  const fs = require('fs');
  const path = require('path');
  const fuente = fs.readFileSync(path.join(__dirname, 'xlsxLogic.js'), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

  test('no toca DOM, red, almacenamiento ni descargas', () => {
    expect(fuente).not.toMatch(/\bdocument\b|\bwindow\b|\bfetch\b|XMLHttpRequest|localStorage|sessionStorage|\bBlob\b|createObjectURL|\bnavigator\b/);
  });

  test('no escribe formulas ni referencias a sharedStrings', () => {
    expect(fuente).not.toMatch(/<f[ >\/]/);
    expect(fuente).not.toMatch(/sharedStrings/);
  });
});
