// E3-4: el estado R = ACEPTADA completo en la UI del mapa y los pozos SIN ubicacion operativa. Cubre: nombre humano, color + forma (no solo color) y accesibilidad de R, el chip
// de filtro y su combinacion con D / C / V, los conteos (V con base R cuenta como V), la leyenda, el popup, Cerca Mio, la seleccion (incluido "Sin ubicación operativa"),
// Buscar reemplazo ("Irrigación", R explicado), el "Ver en mapa" de un pozo sin punto y que D / C / V sigan exactamente igual.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const leer = (...p) => fs.readFileSync(path.join(raiz, ...p), 'utf8');
const sinComentarios = (t) => t.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const html = leer('index.html');
const css = leer('css', 'styles.css');

const M = require('./mapaLogic');
const OP = require('./ubicacionOperativaLogic');
const Cerca = require('./cercaMioLogic');
const Sel = require('./seleccionLogic');
const Reemp = require('./buscarReemplazoLogic');
Object.assign(global, Cerca);

const pozo = (wellId, estado, lat, lon) => ({ wellId, estado, lat: lat === undefined ? -33.3 : lat, lon: lon === undefined ? -69.1 : lon, cuenca: 'X', profundidad: 100, tramosFiltrantes: [], surgencia: null });
const dataset = () => [pozo('01-0001', 'D'), pozo('01-0002', 'C'), pozo('01-0003', 'R'), pozo('01-0004', 'V'), pozo('01-0005', 'R'), pozo('01-0006', 'D')];

// --- utilidades de color (WCAG) ---
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const lum = (hex) => { const [r, g, b] = rgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const distanciaColor = (a, b) => Math.sqrt(rgb(a).reduce((s, v, i) => s + Math.pow(v - rgb(b)[i], 2), 0));

describe('R = Aceptada: nombre humano', () => {
  test('el estado R se muestra como "Aceptada"; V sigue "Validada en campo"; D y C no cambian; nunca la letra cruda', () => {
    expect(M.mapaLogic_estadoLabel('R')).toBe('Aceptada');
    expect(M.mapaLogic_estadoLabel('V')).toBe('Validada en campo');
    expect(M.mapaLogic_estadoLabel('C')).toBe('Coincidente');
    expect(M.mapaLogic_estadoLabel('D')).toBe('Disponible');
    expect(M.MAPA_ESTADO_LABEL).toEqual({ C: 'Coincidente', D: 'Disponible', R: 'Aceptada', V: 'Validada en campo' });
    expect(M.mapaLogic_estadoLabel('toString')).toBe('toString');                       // las claves heredadas no se confunden con una etiqueta
  });

  test('R NO es "validada": ningun texto de R habla de campo ni de validacion', () => {
    expect(M.mapaLogic_estadoLabel('R')).not.toMatch(/campo|valid/i);
    expect(M.MAPA_TEXTO_AYUDA_ACEPTADA).not.toMatch(/campo|valid/i);
  });
});

describe('R se distingue de V por color Y por forma del borde (no depende solo del color)', () => {
  const E = M.MAPA_ESTILO_PUNTO;

  test('D, C y V conservan EXACTAMENTE su aspecto de siempre', () => {
    expect(E.D).toEqual({ relleno: '#4fa3c4', borde: '#ffffff', grosor: 1.5, radio: 7, punteado: null });
    expect(E.C).toEqual({ relleno: '#0b5a7a', borde: '#ffffff', grosor: 1.5, radio: 7, punteado: null });
    expect(E.V).toEqual({ relleno: '#43a047', borde: '#14532d', grosor: 2.5, radio: 8, punteado: null });
  });

  test('R: violeta con borde oscuro y PUNTEADO; V: verde con borde CONTINUO', () => {
    expect(E.R).toEqual({ relleno: '#6a3fb5', borde: '#2e1a5c', grosor: 2.5, radio: 8, punteado: '3 2' });
    expect(E.R.relleno).not.toBe(E.V.relleno);
    expect(E.R.borde).not.toBe(E.V.borde);
    expect(E.R.punteado).not.toBeNull();
    expect(E.V.punteado).toBeNull();
  });

  test('el color de R esta lejos de TODOS los otros estados, de la seleccion y de los anillos de reemplazo', () => {
    const otros = ['#4fa3c4', '#0b5a7a', '#43a047', '#e0007a', '#1f9d55', '#e0a100', '#d32f2f'];
    otros.forEach((c) => expect(distanciaColor(E.R.relleno, c)).toBeGreaterThan(0.3));
  });

  test('cada estado tiene una combinacion (relleno, borde, punteado) UNICA; el de R es el unico punteado', () => {
    const firmas = ['D', 'C', 'R', 'V'].map((e) => [E[e].relleno, E[e].borde, E[e].punteado].join('|'));
    expect(new Set(firmas).size).toBe(4);
    expect(['D', 'C', 'R', 'V'].filter((e) => E[e].punteado !== null)).toEqual(['R']);
  });

  test('contraste: blanco sobre el violeta de R >= 4,5:1 (texto del chip activo) y el borde oscuro se ve sobre el relleno', () => {
    expect(contraste('#ffffff', E.R.relleno)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(E.R.borde, E.R.relleno)).toBeGreaterThan(1.8);
  });

  test('estiloPunto: estado desconocido o ausente se pinta como D (como antes); nunca lanza', () => {
    ['X', '', null, undefined, 5, 'constructor', '__proto__', 'N'].forEach((e) => expect(M.mapaLogic_estiloPunto(e)).toBe(E.D));
    expect(M.mapaLogic_estiloPunto('R')).toBe(E.R);
  });

  test('los hex de css y de mapaLogic son los MISMOS (Leaflet no lee variables CSS)', () => {
    const tok = (n) => (css.match(new RegExp('--' + n + ': (#[0-9a-f]{6});')) || [])[1];
    expect(tok('color-mapa-aceptada')).toBe(E.R.relleno);
    expect(tok('color-mapa-aceptada-borde')).toBe(E.R.borde);
    expect(tok('color-mapa-validada')).toBe(E.V.relleno);
    expect(tok('color-mapa-validada-borde')).toBe(E.V.borde);
    expect(tok('color-mapa-confirmada')).toBe(E.C.relleno);
    expect(tok('color-mapa-disponible')).toBe(E.D.relleno);
  });

  test('mapa.js pinta con el estilo central (no repite colores) y conserva la prioridad de seleccion y anillo de reemplazo; el borde de R sigue punteado', () => {
    const mapa = sinComentarios(leer('js', 'mapa.js'));
    expect(mapa).toMatch(/var estilo = mapaLogic_estiloPunto\(punto\.estado\)/);
    expect(mapa).toMatch(/fillColor: estilo\.relleno/);
    expect(mapa).toMatch(/dashArray: estilo\.punteado/);
    expect(mapa).toMatch(/radius: seleccionado \? 9 : \(conAnillo \? 8 : estilo\.radio\)/);
    expect(mapa).toMatch(/color: seleccionado \? MAPA_COLOR_SELECCION : \(conAnillo \? MAPA_COLOR_REEMPLAZO\[estadoR\] : estilo\.borde\)/);
    expect(mapa).not.toMatch(/MAPA_COLOR_(VALIDADA|CONFIRMADA|DISPONIBLE)\b|#43a047|#0b5a7a|#4fa3c4|#6a3fb5/);
  });
});

describe('chip de filtro R y leyenda', () => {
  const chips = html.match(/<button[^>]*class="mapa-estado-chip[^"]*"[^>]*data-estado="[^"]+"[^>]*>[^<]*<\/button>/g) || [];
  const lista = chips.map((c) => ({ estado: c.match(/data-estado="([^"]+)"/)[1], texto: c.replace(/<[^>]+>/g, ''), html: c }));

  test('el chip "Aceptada" existe junto a los demas de estado, en orden Todos, Coincidente, Disponible, Aceptada, Validada en campo', () => {
    expect(lista.map((c) => [c.estado, c.texto])).toEqual([['todos', 'Todos'], ['C', 'Coincidente'], ['D', 'Disponible'], ['R', 'Aceptada'], ['V', 'Validada en campo']]);
  });

  test('el chip es un boton real (teclado) con aria-pressed, clase propia y una explicacion en title', () => {
    const r = lista.find((c) => c.estado === 'R').html;
    expect(r).toMatch(/^<button type="button" class="mapa-estado-chip mapa-estado-chip-aceptada"/);
    expect(r).toContain('aria-pressed="false"');
    expect(r).toContain('title="Fuente registral elegida manualmente como referencia"');
    lista.forEach((c) => expect(c.html).toContain('aria-pressed='));
  });

  test('la leyenda: una linea breve y visible bajo los chips, con el texto central y sin tecnicismos', () => {
    expect(html).toContain('<p id="mapa-estado-ayuda" class="mapa-estado-ayuda">' + M.MAPA_TEXTO_AYUDA_ACEPTADA + '</p>');
    expect(M.MAPA_TEXTO_AYUDA_ACEPTADA).toBe('Aceptada: fuente registral elegida manualmente como referencia.');
    expect(M.MAPA_TEXTO_AYUDA_ACEPTADA).not.toMatch(/decisi|evento|hoja|delta|backend|secuencia/i);
    expect(html.indexOf('mapa-estado-chips')).toBeLessThan(html.indexOf('mapa-estado-ayuda'));
    expect(html.indexOf('mapa-estado-ayuda')).toBeLessThan(html.indexOf('mapa-filtro-grupo', html.indexOf('mapa-estado-ayuda')));
  });

  test('css: el chip R activo usa los tokens de R y su borde es PUNTEADO (tambien inactivo); el contenedor ya hace wrap', () => {
    expect(css).toMatch(/\.mapa-estado-chip-aceptada,\s*\.mapa-estado-chip-aceptada\.active \{\s*border-style: dashed;/);
    expect(css).toMatch(/\.mapa-estado-chip-aceptada\.active \{[^}]*background: var\(--color-mapa-aceptada\)[^}]*border-color: var\(--color-mapa-aceptada-borde\)/);
    expect(css).toMatch(/\.mapa-estado-ayuda \{[^}]*font-size: 0\.72rem/);
    const wrap = (css.match(/\.mapa-chips-wrap \{[^}]*\}/) || [''])[0];
    expect(wrap).toMatch(/flex-wrap: wrap/);
  });

  test('D, C y V conservan sus reglas de chip', () => {
    expect(css).toMatch(/\.mapa-estado-chip-confirmada\.active \{[^}]*background: var\(--color-mapa-confirmada\)/);
    expect(css).toMatch(/\.mapa-estado-chip-disponible\.active \{[^}]*background: var\(--color-mapa-disponible\)/);
    expect(css).toMatch(/\.mapa-estado-chip-validada\.active \{[^}]*background: var\(--color-mapa-validada\)/);
  });

  test('el chip lleva el conteo como los demas (mapa.js lo agrega a cualquier chip con data-estado distinto de "todos")', () => {
    const mapa = sinComentarios(leer('js', 'mapa.js'));
    expect(mapa).toMatch(/if \(valor !== 'todos'\) \{[\s\S]{0,400}mapaEstado\.conteoEstado\[valor\]/);
  });
});

describe('filtro por estado con R', () => {
  const ids = (activos) => M.mapaLogic_filtrarPorEstado(dataset(), activos).map((p) => p.wellId);

  test('R solo: unicamente los R; no pierde ni agrega pozos', () => {
    expect(ids({ R: true })).toEqual(['01-0003', '01-0005']);
  });

  test('combinaciones = UNION; D+C+R+V = todo; ninguno = sin filtro (todo)', () => {
    expect(ids({ D: true, R: true })).toEqual(['01-0001', '01-0003', '01-0005', '01-0006']);
    expect(ids({ C: true, R: true })).toEqual(['01-0002', '01-0003', '01-0005']);
    expect(ids({ R: true, V: true })).toEqual(['01-0003', '01-0004', '01-0005']);
    expect(ids({ C: true, D: true, R: true, V: true })).toHaveLength(6);
    expect(ids({})).toHaveLength(6);
    expect(ids({ R: false, C: false })).toHaveLength(6);
    expect(ids(undefined)).toHaveLength(6);
  });

  test('D, C y V solos filtran como siempre (R ya no se cuela ni desaparece sin querer)', () => {
    expect(ids({ D: true })).toEqual(['01-0001', '01-0006']);
    expect(ids({ C: true })).toEqual(['01-0002']);
    expect(ids({ V: true })).toEqual(['01-0004']);
    expect(ids({ C: true, D: true, V: true })).toEqual(['01-0001', '01-0002', '01-0004', '01-0006']);        // sin el chip R, los R no aparecen: es lo que el usuario pidio
  });

  test('el toggle generico alterna R igual que cualquier chip', () => {
    let a = M.mapaLogic_toggleFiltroMultiple({}, 'R');
    expect(a).toEqual({ R: true });
    a = M.mapaLogic_toggleFiltroMultiple(a, 'V');
    expect(Object.keys(a).sort()).toEqual(['R', 'V']);
    a = M.mapaLogic_toggleFiltroMultiple(a, 'R');
    expect(a).toEqual({ V: true });
  });
});

describe('conteos con R', () => {
  test('R se cuenta aparte y todos los estados suman el total operativo', () => {
    const c = M.mapaLogic_contarPorEstado(dataset());
    expect(c).toEqual({ C: 1, D: 2, R: 2, V: 1 });
    expect(c.C + c.D + c.R + c.V).toBe(dataset().length);
  });

  test('V con base R cuenta SOLO como V (el punto final es V): un pozo, un conteo', () => {
    const final = OP.ubicacionOperativaLogic_aplicarCapas(
      [pozo('01-0001', 'D'), pozo('01-0002', 'D')],
      [{ wellId: '01-0001', estado: 'R', lat: -33.31, lon: -69.11 }, { wellId: '01-0002', estado: 'R', lat: -33.32, lon: -69.12 }],
      [{ wellId: '01-0001', lat: -33.33, lon: -69.13, vts: 'x' }]
    ).pozos;
    expect(final.find((p) => p.wellId === '01-0001').base.estado).toBe('R');
    expect(M.mapaLogic_contarPorEstado(final)).toEqual({ C: 0, D: 0, R: 1, V: 1 });
  });

  test('un pozo sin punto (N sin V) no cuenta en ningun estado', () => {
    const final = OP.ubicacionOperativaLogic_aplicarCapas(dataset(), [{ wellId: '01-0003', estado: 'N' }], []).pozos;
    expect(M.mapaLogic_contarPorEstado(final)).toEqual({ C: 1, D: 2, R: 1, V: 1 });
  });

  test('el conteo es UNA pasada por el universo (sin recorridos extra) y vale para 13.804 puntos en pocos ms', () => {
    const muchos = [];
    for (let i = 0; i < 13804; i += 1) { muchos.push(pozo('01-' + String(i).padStart(4, '0'), 'DCRV'[i % 4])); }
    const t0 = Date.now();
    const c = M.mapaLogic_contarPorEstado(muchos);
    expect(Date.now() - t0).toBeLessThan(200);
    expect(c.C + c.D + c.R + c.V).toBe(13804);
    const fuente = sinComentarios(leer('js', 'mapaLogic.js'));
    expect(fuente.match(/function mapaLogic_contarPorEstado[\s\S]*?\n\}/)[0].match(/forEach/g)).toHaveLength(1);
  });
});

describe('popup y etiquetas', () => {
  test('el popup del mapa escribe el nombre humano del estado (R = Aceptada), no la letra', () => {
    expect(sinComentarios(leer('js', 'mapa.js'))).toMatch(/estadoEl\.textContent = mapaLogic_estadoLabel\(punto\.estado\)/);
  });

  test('ningun lugar del frontend (mapa, Cerca Mio, seleccion, reemplazo) muestra el estado crudo ni compara letras fuera de mapaLogic', () => {
    ['cercaMio.js', 'seleccion.js', 'buscarReemplazo.js'].forEach((f) => {
      const codigo = sinComentarios(leer('js', f));
      expect(codigo).not.toMatch(/estado\s*===\s*'[DCRV]'|textContent\s*=\s*[\w.]*\.estado\b/);
    });
  });
});

describe('Cerca Mio con R', () => {
  test('hereda el pozo R con su estado; no resuelve nada por su cuenta y no muestra la letra', () => {
    const r = Cerca.cercaMioLogic_buscarCercanos(dataset(), -33.3, -69.1, 500, 100);
    expect(r.map((p) => p.estado).sort()).toEqual(['C', 'D', 'D', 'R', 'R', 'V']);
    expect(r.find((p) => p.wellId === '01-0003').estado).toBe('R');
    const cm = sinComentarios(leer('js', 'cercaMio.js'));
    expect(cm).not.toMatch(/ubicacionOperativa|mapaDataset_invalidar|aplicarCapas/);
  });

  test('un pozo sin punto (N) no esta en el dataset y por eso no aparece', () => {
    const final = OP.ubicacionOperativaLogic_aplicarCapas(dataset(), [{ wellId: '01-0003', estado: 'N' }], []).pozos;
    expect(Cerca.cercaMioLogic_buscarCercanos(final, -33.3, -69.1, 500, 100).map((p) => p.wellId)).not.toContain('01-0003');
    expect(Cerca.cercaMioLogic_contarDentroDeRadio(final, -33.3, -69.1, 500)).toBe(5);
  });
});

describe('Seleccion con R y con pozos sin ubicacion operativa', () => {
  test('la lista de texto muestra "Aceptada" para R y el nombre humano de cada estado', () => {
    const por = (w) => dataset().find((p) => p.wellId === w);
    expect(M.mapaLogic_textoEstadoUbicacion(por('01-0003'), true)).toBe('Aceptada');
    expect(M.mapaLogic_textoEstadoUbicacion(por('01-0004'), true)).toBe('Validada en campo');
    expect(M.mapaLogic_textoEstadoUbicacion(por('01-0002'), true)).toBe('Coincidente');
    expect(M.mapaLogic_textoEstadoUbicacion(por('01-0001'), true)).toBe('Disponible');
  });

  test('un pozo que NO esta en el dataset operativo (cargado) dice "Sin ubicación operativa", no "—"', () => {
    expect(M.mapaLogic_textoEstadoUbicacion(undefined, true)).toBe('Sin ubicación operativa');
    expect(M.mapaLogic_textoEstadoUbicacion(null, true)).toBe('Sin ubicación operativa');
    expect(M.MAPA_TEXTO_SIN_UBICACION).toBe('Sin ubicación operativa');
  });

  test('si el dataset NO se pudo cargar no se afirma nada: "—"; un punto sin estado tambien "—"', () => {
    expect(M.mapaLogic_textoEstadoUbicacion(undefined, false)).toBe('—');
    expect(M.mapaLogic_textoEstadoUbicacion(undefined, undefined)).toBe('—');
    expect(M.mapaLogic_textoEstadoUbicacion({ wellId: 'x' }, true)).toBe('—');
    expect(M.mapaLogic_textoEstadoUbicacion({ wellId: 'x', estado: '' }, true)).toBe('—');
  });

  test('seleccion.js usa el helper central y distingue "dataset no cargado" (null) de "pozo ausente"', () => {
    const f = sinComentarios(leer('js', 'seleccion.js'));
    expect(f).toMatch(/mapaLogic_textoEstadoUbicacion\(indicePozos \? indicePozos\[wellId\] : undefined, indicePozos !== null\)/);
    expect(f).toMatch(/pozosResult\.status === 'ok' \? construirIndicePorWellId\(pozosResult\.data\.pozos\) : null/);
    expect(f).not.toMatch(/mapaLogic_estadoLabel/);
  });

  test('poligono / multiseleccion: el pozo R entra por su punto aceptado y el pozo sin punto no participa', () => {
    const base = [pozo('01-0001', 'D', -33.30, -69.10), pozo('01-0002', 'D', -33.40, -69.20)];
    const final = OP.ubicacionOperativaLogic_aplicarCapas(base, [{ wellId: '01-0001', estado: 'R', lat: -33.45, lon: -69.25 }, { wellId: '01-0002', estado: 'N' }], []).pozos;
    const poligono = [{ lat: -33.46, lon: -69.26 }, { lat: -33.46, lon: -69.24 }, { lat: -33.44, lon: -69.24 }, { lat: -33.44, lon: -69.26 }];
    expect(Sel.seleccionLogic_filtrarPorPoligono(base, poligono, 0)).toEqual([]);
    expect(Sel.seleccionLogic_filtrarPorPoligono(final, poligono, 0)).toEqual(['01-0001']);
    expect(Sel.seleccionLogic_filtrarPorWellIds(final, new Set(['01-0001', '01-0002'])).map((p) => p.wellId)).toEqual(['01-0001']);
  });
});

describe('Buscar reemplazo con R', () => {
  const ref = { wellId: null, lat: -33.3, lon: -69.1, profundidad: 100, profundidadValida: 100 };

  test('un candidato R se explica como "Coordenada aceptada"; D / C / V conservan su texto', () => {
    const cand = (estado) => Reemp.buscarReemplazoLogic_buscarCandidatos([pozo('01-0003', estado)], ref, 500, {})[0];
    const texto = (estado) => Reemp.buscarReemplazoLogic_explicar(cand(estado), ref).find((i) => i.clave === 'coordenada').texto;
    expect(texto('R')).toBe('Coordenada aceptada');
    expect(texto('V')).toBe('Coordenada validada en campo');
    expect(texto('C')).toBe('Coordenada coincidente');
    expect(texto('D')).toBe('Coordenada disponible (1 fuente)');
  });

  test('el aviso de discrepancia dice "Irrigación" (una aceptada puede venir del Reporte de Pozos), nunca "padrón de Provincia"', () => {
    const r = Reemp.buscarReemplazoLogic_construirReferencia({ monitoringId: 'a', wellId: '01-0003', lat: -33.31, lon: -69.1, profundidad: 100, nombreOriginal: 'x', cuenca: 'X' }, [pozo('01-0003', 'R', -33.3, -69.1)]);
    const texto = Reemp.buscarReemplazoLogic_textoAdvertenciaCoordenada(r);
    expect(texto).toMatch(/^La coordenada de este pozo en Irrigación está a /);
    expect(texto).not.toMatch(/Provincia/);
    ['buscarReemplazoLogic.js', 'buscarReemplazo.js'].forEach((f) => expect(leer('js', f)).not.toMatch(/padrón de Provincia|padron de Provincia/));
  });

  test('un pozo sin punto (N) no es candidato espacial; el R si', () => {
    const base = [pozo('01-0001', 'D', -33.3001, -69.1), pozo('01-0002', 'D', -33.3002, -69.1)];
    const final = OP.ubicacionOperativaLogic_aplicarCapas(base, [{ wellId: '01-0001', estado: 'N' }, { wellId: '01-0002', estado: 'R', lat: -33.3003, lon: -69.1 }], []).pozos;
    const ids = Reemp.buscarReemplazoLogic_buscarCandidatos(final, ref, 500, {}).map((c) => c.wellId);
    expect(ids).toEqual(['01-0002']);
  });
});

describe('"Ver en mapa" de un pozo sin ubicacion operativa', () => {
  test('el aviso existe en el index, oculto, con el texto central, con role=status y sin ser un error', () => {
    const m = html.match(/<p id="mapa-aviso-sin-punto" class="([^"]+)" role="status" hidden>([^<]+)<\/p>/);
    expect(m).not.toBeNull();
    expect(m[2]).toBe(M.MAPA_TEXTO_SIN_PUNTO_EN_MAPA);
    expect(m[2]).toBe('Este pozo no tiene una ubicación operativa para mostrar en el mapa.');
    expect(m[1].split(' ')).toContain('aviso-ubicaciones');                           // mismo estilo discreto que el aviso de ubicaciones
    expect(m[2]).not.toMatch(/error|fall/i);
  });

  test('mapa.js lo muestra cuando el pozo pedido no esta en el dataset (ni como marker ni como fuera de filtros), lo oculta al enfocar otra cosa y al abrir', () => {
    const f = sinComentarios(leer('js', 'mapa.js'));
    expect(f).toMatch(/function mapaController_aplicarEnfoque\(enfoque\) \{\s*mapaController_ocultarAvisoSinPunto\(\);/);
    expect(f).toMatch(/if \(punto\) \{[\s\S]{0,260}\} else \{\s*mapaController_mostrarAvisoSinPunto\(\);\s*\}/);
    expect(f).toMatch(/contadorEl\.hidden = true;\s*mapaController_ocultarAvisoSinPunto\(\);/);
    expect(f).toMatch(/var avisoSinPuntoEl = document\.getElementById\('mapa-aviso-sin-punto'\)/);
    expect(f).not.toMatch(/mostrarAvisoSinPunto[\s\S]{0,80}throw/);
  });

  test('no se inventa ninguna coordenada: el camino "sin punto" no crea markers ni centra el mapa', () => {
    const f = sinComentarios(leer('js', 'mapa.js'));
    const rama = f.slice(f.indexOf('mapaController_mostrarAvisoSinPunto();'), f.indexOf('mapaController_mostrarAvisoSinPunto();') + 40);
    expect(rama).not.toMatch(/setView|fitBounds|L\.|circleMarker/);
  });

  test('el aviso reutiliza el estilo discreto existente (oculto con [hidden]) y no agrega un modal ni bloquea nada', () => {
    expect(css).toMatch(/\.aviso-ubicaciones\[hidden\] \{\s*display: none;/);
    expect(html).not.toMatch(/mapa-aviso-sin-punto[^>]*(onclick|autofocus)/);
  });
});

describe('responsive y estructura', () => {
  test('los chips de estado viven en el contenedor que ya hace wrap y no tienen anchos fijos que desborden a 375 px', () => {
    const chip = (css.match(/\.mapa-estado-chip \{[^}]*\}/) || [''])[0];
    expect(chip).not.toMatch(/\bwidth:\s*\d|min-width:\s*\d{3,}/);
    expect(chip).toMatch(/min-height: 34px/);
    expect(html).toMatch(/<div id="mapa-estado-chips" class="mapa-chips-wrap">/);
    expect((css.match(/\.mapa-chips-wrap \{[^}]*\}/) || [''])[0]).toMatch(/display: flex/);
  });

  test('la estructura de los demas grupos de filtros no cambia (un unico bloque por grupo y los mismos ids)', () => {
    ['mapa-estado-chips', 'mapa-deptos-chips', 'mapa-cuenca-chips'].forEach((id) => expect((html.match(new RegExp('id="' + id + '"', 'g')) || []).length).toBe(1));
    expect((html.match(/data-estado="R"/g) || []).length).toBe(1);
    expect((html.match(/id="mapa-estado-ayuda"/g) || []).length).toBe(1);
  });

  test('el texto del aviso de ubicaciones sigue siendo UNO (E3-3) y el nuevo aviso es otro elemento, no un segundo banner de degradacion', () => {
    expect((html.match(/class="aviso-ubicaciones"/g) || []).length).toBe(2);
    expect((html.match(/id="mapa-aviso-sin-punto"/g) || []).length).toBe(1);
  });
});

describe('D / C / V siguen exactamente igual', () => {
  test('etiquetas, conteos y filtros de siempre sobre un dataset sin R', () => {
    const sinR = dataset().filter((p) => p.estado !== 'R');
    expect(M.mapaLogic_contarPorEstado(sinR)).toEqual({ C: 1, D: 2, R: 0, V: 1 });
    expect(M.mapaLogic_filtrarPorEstado(sinR, { V: true }).map((p) => p.wellId)).toEqual(['01-0004']);
    expect(M.mapaLogic_filtrarPorEstado(sinR, { C: true, D: true }).map((p) => p.wellId)).toEqual(['01-0001', '01-0002', '01-0006']);
    expect(['D', 'C', 'V'].map(M.mapaLogic_estadoLabel)).toEqual(['Disponible', 'Coincidente', 'Validada en campo']);
  });
});
