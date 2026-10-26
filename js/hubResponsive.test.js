// Hub modular: la grilla de tarjetas (E6-4b). A partir de 640 px las tarjetas NO van en una sola fila (grid-auto-flow: column desbordaba con 6 o mas modulos): se reparten en columnas y
// pasan a una segunda fila. En celular la regla de siempre (2 columnas) queda intacta. Los tests miran las reglas por selector, no el orden del archivo.
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '..', 'css', 'styles.css'), 'utf8').replace(/\r\n/g, '\n');

// Cuerpo de un bloque { ... } balanceado que empieza en `indiceApertura` (posicion de la llave de apertura).
function cuerpoDesde(texto, indiceApertura) {
  let nivel = 0;
  for (let i = indiceApertura; i < texto.length; i += 1) {
    if (texto[i] === '{') { nivel += 1; }
    if (texto[i] === '}') { nivel -= 1; if (nivel === 0) { return texto.slice(indiceApertura + 1, i); } }
  }
  throw new Error('bloque sin cerrar');
}

// Todos los bloques @media (min-width: 640px) { ... } del archivo.
function mediasDe640() {
  const salida = [];
  const re = /@media \(min-width: 640px\)\s*\{/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    salida.push(cuerpoDesde(css, m.index + m[0].length - 1));
  }
  return salida;
}

// Declaraciones de la regla cuyo selector (lista completa) contiene exactamente `selector`, dentro de `texto`.
function reglasDe(texto, selector) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(texto)) !== null) {
    const lista = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((s) => s.trim());
    if (lista.indexOf(selector) !== -1) { out.push(m[2]); }
  }
  return out;
}

const medias = mediasDe640();
const mediaHub = medias.find((b) => /\.screen:has\(#hub-area\)/.test(b));
const base = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');           // el CSS sin los @media (de un nivel de anidacion)

describe('hub en escritorio (>= 640 px)', () => {
  test('existe el bloque desktop del hub dentro de un @media (min-width: 640px)', () => {
    expect(mediaHub).toBeDefined();
  });

  test('la grilla ya NO usa el flujo horizontal en una sola fila', () => {
    const reglas = reglasDe(mediaHub, '.hub-grid').concat(reglasDe(mediaHub, '.hub-grid.n1'), reglasDe(mediaHub, '.hub-grid.n3')).join('\n');
    expect(reglas).not.toMatch(/grid-auto-flow:\s*column/);
    expect(reglas).not.toMatch(/grid-auto-columns/);
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/grid-auto-flow:\s*column/);          // en ninguna parte (los comentarios pueden mencionarlo)
  });

  test('es una grilla que reparte en columnas y permite pasar a otra fila (auto-fit con minimo), tambien para n1 y n3', () => {
    ['.hub-grid', '.hub-grid.n1', '.hub-grid.n3'].forEach((selector) => {
      const reglas = reglasDe(mediaHub, selector).join('\n');
      expect(reglas).toMatch(/grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(\d+px,\s*1fr\)\)/);
      expect(reglas).toMatch(/grid-auto-flow:\s*row/);
    });
  });

  test('el minimo por columna es chico (tarjetas legibles) pero no tanto como para apretar: entre 90 y 140 px', () => {
    const minimo = Number(/minmax\((\d+)px/.exec(reglasDe(mediaHub, '.hub-grid').join('\n'))[1]);
    expect(minimo).toBeGreaterThanOrEqual(90);
    expect(minimo).toBeLessThanOrEqual(140);
  });

  test('no se fija ninguna cantidad de tarjetas ni ancho fijo: es fluida', () => {
    const reglas = reglasDe(mediaHub, '.hub-grid').join('\n');
    expect(reglas).not.toMatch(/repeat\(\d+,/);
    expect(reglas).not.toMatch(/\bwidth:\s*\d+px|\bmin-width:\s*\d+px/);
    expect(reglas).not.toMatch(/overflow(-x)?:\s*(auto|scroll)/);
  });

  test('las tarjetas solas o la ultima de un grupo impar no se fuerzan a todo el ancho (grid-column: auto)', () => {
    const reglas = reglasDe(mediaHub, '.hub-grid.n1 .hub-card').concat(reglasDe(mediaHub, '.hub-grid.n3 .hub-card:last-child')).join('\n');
    expect(reglas).toMatch(/grid-column:\s*auto/);
  });

  test('el minimo por columna deja entrar la palabra mas larga ("Observaciones", 118 px a 0.9rem en negrita) con su padding lateral y un 5% de margen; si no cabe, se parte', () => {
    const minimo = Number(/minmax\((\d+)px/.exec(reglasDe(mediaHub, '.hub-grid').join('\n'))[1]);
    const padding = Number(/padding:\s*\d+px (\d+)px/.exec(reglasDe(mediaHub, '#hub-area .hub-card').join('\n'))[1]);
    const fuente = Number(/font-size:\s*([\d.]+)rem/.exec(reglasDe(mediaHub, '#hub-area .hub-card-ct').join('\n'))[1]);
    const necesario = 118 * (fuente / 0.9);
    expect(minimo - 2 * padding).toBeGreaterThanOrEqual(necesario * 1.05);
    expect(reglasDe(mediaHub, '#hub-area .hub-card-ct').join('\n')).toMatch(/overflow-wrap:\s*anywhere/);
  });

  test('el ajuste de tamano es solo del hub de modulos (#hub-area): las tarjetas del selector de mapas no se tocan', () => {
    const generales = reglasDe(mediaHub, '.hub-card').join('\n');
    expect(generales).toMatch(/padding:\s*18px;/);
    expect(reglasDe(mediaHub, '.hub-card-ct')).toEqual([]);
    expect(reglasDe(mediaHub, '#screen-mapa-selector .hub-card')).toEqual([]);
  });

  test('el contenedor del hub sigue limitado a 640 px', () => {
    expect(reglasDe(mediaHub, '.screen:has(#hub-area)').join('\n')).toMatch(/max-width:\s*640px/);
  });
});

describe('hub en celular: la regla de siempre queda intacta', () => {
  test('dos columnas iguales y separacion de 12 px', () => {
    const reglas = reglasDe(base, '.hub-grid').join('\n');
    expect(reglas).toMatch(/display:\s*grid/);
    expect(reglas).toMatch(/grid-template-columns:\s*1fr 1fr/);
    expect(reglas).toMatch(/gap:\s*12px/);
  });

  test('una sola tarjeta, o la ultima de un grupo impar, ocupa todo el ancho', () => {
    const reglas = reglasDe(base, '.hub-grid.n1 .hub-card').concat(reglasDe(base, '.hub-grid.n3 .hub-card:last-child')).join('\n');
    expect(reglas).toMatch(/grid-column:\s*1 \/ -1/);
  });

  test('el cambio de escritorio esta SOLO dentro del @media: la regla base no usa auto-fit ni flujo por columna', () => {
    expect(reglasDe(base, '.hub-grid').join('\n')).not.toMatch(/auto-fit|grid-auto-flow/);
  });
});

describe('no se afecta nada mas', () => {
  test('la pantalla de la linea de tiempo no toca la grilla del hub (ni al reves)', () => {
    const inicio = css.indexOf('/* --- Linea de tiempo del pozo (E6-3, solo lectura) --- */');
    const bloque = css.slice(inicio, css.indexOf('/* --- Observaciones del pozo (E5-4, solo lectura) --- */'));
    expect(inicio).toBeGreaterThan(-1);
    expect(bloque).not.toMatch(/hub-grid|hub-card|auto-fit/);
  });

  test('el selector de mapas (#screen-mapa-selector .hub-grid) conserva su propia regla', () => {
    expect(css).toMatch(/#screen-mapa-selector \.hub-grid/);
  });
});
