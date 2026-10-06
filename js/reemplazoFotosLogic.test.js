const L = require('./reemplazoFotosLogic');

describe('limites declarados', () => {
  test('5 fotos, 15 MB original, 1600 px, calidades 0.72/0.62/0.52, objetivo 1.5 MB', () => {
    expect(L.REEMPLAZO_FOTOS_MAX).toBe(5);
    expect(L.REEMPLAZO_FOTOS_MAX_ORIGINAL_BYTES).toBe(15 * 1024 * 1024);
    expect(L.REEMPLAZO_FOTOS_MAX_DIM).toBe(1600);
    expect(L.REEMPLAZO_FOTOS_CALIDADES).toEqual([0.72, 0.62, 0.52]);
    expect(L.REEMPLAZO_FOTOS_OBJETIVO_BYTES).toBe(1.5 * 1024 * 1024);
  });
  test('el objetivo del navegador cabe en el tope duro del backend (2 MB)', () => {
    expect(L.REEMPLAZO_FOTOS_OBJETIVO_BYTES).toBeLessThan(2 * 1024 * 1024);
  });
});

describe('reemplazoFotosLogic_dimensiones', () => {
  test('apaisada 4032x3024 (12 MP) -> 1600x1200', () => {
    expect(L.reemplazoFotosLogic_dimensiones(4032, 3024)).toEqual({ ancho: 1600, alto: 1200 });
  });
  test('vertical 3024x4032 -> 1200x1600 (mantiene proporcion)', () => {
    expect(L.reemplazoFotosLogic_dimensiones(3024, 4032)).toEqual({ ancho: 1200, alto: 1600 });
  });
  test('48 MP 8000x6000 -> 1600x1200', () => {
    expect(L.reemplazoFotosLogic_dimensiones(8000, 6000)).toEqual({ ancho: 1600, alto: 1200 });
  });
  test('imagen chica no se agranda', () => {
    expect(L.reemplazoFotosLogic_dimensiones(800, 600)).toEqual({ ancho: 800, alto: 600 });
    expect(L.reemplazoFotosLogic_dimensiones(1600, 1600)).toEqual({ ancho: 1600, alto: 1600 });
  });
  test('miniatura 256', () => {
    expect(L.reemplazoFotosLogic_dimensiones(1600, 1200, 256)).toEqual({ ancho: 256, alto: 192 });
  });
  test('panoramica extrema nunca da 0', () => {
    const d = L.reemplazoFotosLogic_dimensiones(20000, 10, 1600);
    expect(d.ancho).toBe(1600);
    expect(d.alto).toBeGreaterThanOrEqual(1);
  });
  test('dimensiones invalidas -> 0x0', () => {
    expect(L.reemplazoFotosLogic_dimensiones(0, 100)).toEqual({ ancho: 0, alto: 0 });
    expect(L.reemplazoFotosLogic_dimensiones(undefined, 100)).toEqual({ ancho: 0, alto: 0 });
  });
});

describe('escalera de calidad', () => {
  test('cabe en el objetivo: no se baja la calidad', () => {
    expect(L.reemplazoFotosLogic_siguienteCalidad(0.72, 400 * 1024)).toBeNull();
    expect(L.reemplazoFotosLogic_siguienteCalidad(0.72, 1.5 * 1024 * 1024)).toBeNull();
  });
  test('muy pesada: baja 0.72 -> 0.62 -> 0.52 -> se acaba', () => {
    const grande = 3 * 1024 * 1024;
    expect(L.reemplazoFotosLogic_siguienteCalidad(0.72, grande)).toBe(0.62);
    expect(L.reemplazoFotosLogic_siguienteCalidad(0.62, grande)).toBe(0.52);
    expect(L.reemplazoFotosLogic_siguienteCalidad(0.52, grande)).toBeNull();
  });
});

describe('reemplazoFotosLogic_validarArchivo', () => {
  const f = (type, size, name) => ({ type, size, name: name || 'a.jpg' });
  test('JPEG normal: ok', () => {
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 3e6), 0)).toEqual({ ok: true });
  });
  test('png, webp, heic y heif se intentan', () => {
    ['image/png', 'image/webp', 'image/heic', 'image/heif'].forEach((t) => expect(L.reemplazoFotosLogic_validarArchivo(f(t, 1e6), 0).ok).toBe(true));
  });
  test('type vacio con extension de imagen (HEIC en algunos navegadores): se intenta; sin extension valida, no', () => {
    expect(L.reemplazoFotosLogic_validarArchivo(f('', 1e6, 'IMG_1.HEIC'), 0).ok).toBe(true);
    expect(L.reemplazoFotosLogic_validarArchivo(f('', 1e6, 'doc.pdf'), 0)).toEqual({ ok: false, code: 'TIPO_NO_SOPORTADO' });
  });
  test('tipos no imagen rechazados (pdf, video, gif)', () => {
    ['application/pdf', 'video/mp4', 'image/gif'].forEach((t) => expect(L.reemplazoFotosLogic_validarArchivo(f(t, 1e6), 0).code).toBe('TIPO_NO_SOPORTADO'));
  });
  test('original > 15 MB rechazado; justo 15 MB ok; vacio rechazado', () => {
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 15 * 1024 * 1024 + 1), 0).code).toBe('ORIGINAL_MUY_GRANDE');
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 15 * 1024 * 1024), 0).ok).toBe(true);
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 0), 0).code).toBe('ARCHIVO_VACIO');
  });
  test('maximo 5 fotos', () => {
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 1e6), 4).ok).toBe(true);
    expect(L.reemplazoFotosLogic_validarArchivo(f('image/jpeg', 1e6), 5).code).toBe('LIMITE_FOTOS');
  });
  test('sin archivo', () => {
    expect(L.reemplazoFotosLogic_validarArchivo(null, 0).code).toBe('SIN_ARCHIVO');
  });
});

describe('formato y utilidades', () => {
  test('formatearBytes', () => {
    expect(L.reemplazoFotosLogic_formatearBytes(512)).toBe('512 B');
    expect(L.reemplazoFotosLogic_formatearBytes(2048)).toBe('2 KB');
    expect(L.reemplazoFotosLogic_formatearBytes(4.2 * 1024 * 1024)).toBe('4.2 MB');
    expect(L.reemplazoFotosLogic_formatearBytes(undefined)).toBe('—');
  });
  test('base64 de data URL', () => {
    expect(L.reemplazoFotosLogic_base64DeDataUrl('data:image/jpeg;base64,QUJD')).toBe('QUJD');
    expect(L.reemplazoFotosLogic_base64DeDataUrl('nada')).toBe('');
  });
  test('mensajes de error: conocidos y generico', () => {
    expect(L.reemplazoFotosLogic_mensajeError('STORAGE_UNAVAILABLE')).toMatch(/almacenamiento/);
    expect(L.reemplazoFotosLogic_mensajeError('LIMITE_FOTOS')).toMatch(/5/);
    expect(L.reemplazoFotosLogic_mensajeError('???')).toMatch(/Reintentá/);
  });
  test('vecino circular del visor', () => {
    expect(L.reemplazoFotosLogic_vecino(0, 3, 1)).toBe(1);
    expect(L.reemplazoFotosLogic_vecino(2, 3, 1)).toBe(0);
    expect(L.reemplazoFotosLogic_vecino(0, 3, -1)).toBe(2);
    expect(L.reemplazoFotosLogic_vecino(0, 1, 1)).toBe(0);
    expect(L.reemplazoFotosLogic_vecino(0, 0, 1)).toBe(0);
  });
});

describe('cola secuencial y resumen', () => {
  const items = (estados) => estados.map((e, i) => ({ id: i, estado: e }));
  test('siguienteASubir: primero pendiente, de a uno, en orden', () => {
    const it = items(['subida', 'pendiente', 'pendiente']);
    expect(L.reemplazoFotosLogic_siguienteASubir(it).id).toBe(1);
    it[1].estado = 'subiendo';
    expect(L.reemplazoFotosLogic_siguienteASubir(it).id).toBe(2);
  });
  test('una fallida no se reintenta sola', () => {
    expect(L.reemplazoFotosLogic_siguienteASubir(items(['fallida', 'subida']))).toBeNull();
  });
  test('una foto falla y otra no: el resumen las distingue; el reintento la vuelve pendiente y se sube', () => {
    const it = items(['subida', 'fallida', 'subida']);
    expect(L.reemplazoFotosLogic_resumenSubida(it)).toEqual({ total: 3, subidas: 2, fallidas: 1, enCurso: 0 });
    it[1].estado = 'pendiente';
    expect(L.reemplazoFotosLogic_siguienteASubir(it).id).toBe(1);
    expect(L.reemplazoFotosLogic_resumenSubida(it).enCurso).toBe(1);
  });
  test('hayEnCurso', () => {
    expect(L.reemplazoFotosLogic_hayEnCurso(items(['lista', 'error']))).toBe(false);
    expect(L.reemplazoFotosLogic_hayEnCurso(items(['lista', 'procesando']))).toBe(true);
    expect(L.reemplazoFotosLogic_hayEnCurso(items(['subiendo']))).toBe(true);
  });
  test('listasParaSubir: solo las procesadas bien (las con error no se suben)', () => {
    expect(L.reemplazoFotosLogic_listasParaSubir(items(['lista', 'error', 'lista', 'procesando'])).map((i) => i.id)).toEqual([0, 2]);
  });
});

describe('historial: agrupar fotos por evaluacion (0 / 1 / varias, sin mezclar)', () => {
  test('sin fotos: mapa vacio', () => {
    expect(L.reemplazoFotosLogic_agruparPorEvaluacion([])).toEqual({});
    expect(L.reemplazoFotosLogic_agruparPorEvaluacion(undefined)).toEqual({});
  });
  test('cada foto va a SU evaluacion, en orden', () => {
    const m = L.reemplazoFotosLogic_agruparPorEvaluacion([
      { fotoId: 'a', evaluacionId: 'E1' }, { fotoId: 'b', evaluacionId: 'E2' }, { fotoId: 'c', evaluacionId: 'E1' }
    ]);
    expect(m.E1.map((f) => f.fotoId)).toEqual(['a', 'c']);
    expect(m.E2.map((f) => f.fotoId)).toEqual(['b']);
    expect(m.E3).toBeUndefined();
  });
});

describe('reemplazoFotosLogic_textoCodigo: el codigo real de un fallo no se pierde', () => {
  test('muestra el codigo del backend', () => {
    expect(L.reemplazoFotosLogic_textoCodigo('SERVICE_UNAVAILABLE')).toBe('Código: SERVICE_UNAVAILABLE');
    expect(L.reemplazoFotosLogic_textoCodigo('RED')).toBe('Código: RED');
  });
  test('sin codigo: vacio', () => {
    expect(L.reemplazoFotosLogic_textoCodigo(null)).toBe('');
    expect(L.reemplazoFotosLogic_textoCodigo(undefined)).toBe('');
  });
});
