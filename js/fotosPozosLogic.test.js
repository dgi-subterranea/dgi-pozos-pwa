// En el navegador las funciones de reemplazoFotosLogic.js son globales
Object.assign(global, require('./reemplazoFotosLogic'));
const L = require('./fotosPozosLogic');

const HOY = new Date('2026-10-06T15:00:00');

// ---- Helpers de bytes ----
function jpegConExif(fechaExif, little) {
  const le = little !== false;
  const u16 = (n) => (le ? [n & 255, n >> 8] : [n >> 8, n & 255]);
  const u32 = (n) => (le ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >> 24) & 255] : [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
  const texto = Array.from(Buffer.from(fechaExif + '\0', 'latin1'));
  const tiff = [].concat(
    le ? [0x49, 0x49] : [0x4d, 0x4d], u16(42), u32(8),
    u16(1), u16(0x8769), u16(4), u32(1), u32(26), u32(0),             // IFD0 -> Exif IFD
    u16(1), u16(0x9003), u16(2), u32(texto.length), u32(44), u32(0),   // Exif IFD: DateTimeOriginal
    texto
  );
  const app1 = [].concat([0x45, 0x78, 0x69, 0x66, 0, 0], tiff);
  const largo = app1.length + 2;
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, largo >> 8, largo & 255].concat(app1, [0xff, 0xd9]));
}

describe('entidad', () => {
  test('clave: wellId, o monitoringId si no hay', () => {
    expect(L.fotosPozosLogic_claveEntidad({ wellId: '04-0263', monitoringId: '' })).toBe('04-0263');
    expect(L.fotosPozosLogic_claveEntidad({ wellId: '', monitoringId: 'INA 2055' })).toBe('INA 2055');
    expect(L.fotosPozosLogic_claveEntidad(null)).toBe('');
  });

  test('pozo del hub: wellId; esNE si tambien esta en la red NE', () => {
    expect(L.fotosPozosLogic_entidadDePozo({ wellId: '04-0263', ne: { found: true } })).toEqual({ wellId: '04-0263', monitoringId: '', etiqueta: '04-0263', esNE: true });
    expect(L.fotosPozosLogic_entidadDePozo({ wellId: '04-0263', ne: { found: false } }).esNE).toBe(false);
    expect(L.fotosPozosLogic_entidadDePozo(null)).toBeNull();
  });

  test('punto NE con numero de pozo: misma entidad que en Provincia (galeria compartida)', () => {
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: '04-0263', wellId: '04-0263' })).toEqual({ wellId: '04-0263', monitoringId: '', etiqueta: '04-0263', esNE: true });
  });

  test('ficha NE (getMonitoringPoint no trae wellId): un monitoringId DD-PPPP ES el wellId (comparte galeria con Provincia)', () => {
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: '04-0263' })).toEqual({ wellId: '04-0263', monitoringId: '', etiqueta: '04-0263', esNE: true });
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: 'INA 2055' })).toMatchObject({ wellId: '', monitoringId: 'INA 2055' });
  });

  test('punto NE especial: por monitoringId, con su nombre como etiqueta', () => {
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: 'INA 2055', wellId: null, nombreOriginal: 'Jofre Puesto San Vicente' }))
      .toEqual({ wellId: '', monitoringId: 'INA 2055', etiqueta: 'Jofre Puesto San Vicente', esNE: true });
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: 7, wellId: null }).monitoringId).toBe('7');
  });

  test('un wellId mal formado en un punto NE no se usa como wellId', () => {
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: 'X', wellId: 'basura' })).toMatchObject({ wellId: '', monitoringId: 'X' });
    expect(L.fotosPozosLogic_entidadDePuntoNE({ monitoringId: '', wellId: null })).toBeNull();
    expect(L.fotosPozosLogic_entidadDePuntoNE(null)).toBeNull();
  });

  test('origenes que se pueden elegir: Provincia solo carga de campo; NE tambien monitoreo', () => {
    expect(L.fotosPozosLogic_fuentesDisponibles({ esNE: false })).toEqual(['CAMPO_APP']);
    expect(L.fotosPozosLogic_fuentesDisponibles({ esNE: true })).toEqual(['CAMPO_APP', 'MONITOREO_NE']);
    expect(L.fotosPozosLogic_fuentesDisponibles(null)).toEqual(['CAMPO_APP']);
  });
});

describe('texto', () => {
  test('contador', () => {
    expect(L.fotosPozosLogic_textoContador(0)).toBe('0 fotos');
    expect(L.fotosPozosLogic_textoContador(1)).toBe('1 foto');
    expect(L.fotosPozosLogic_textoContador(12)).toBe('12 fotos');
  });

  test('fecha con precision parcial: nunca completa dia ni mes', () => {
    expect(L.fotosPozosLogic_formatearFecha('2025-06-14', 'DIA')).toBe('14/06/2025');
    expect(L.fotosPozosLogic_formatearFecha('2025-06', 'MES')).toBe('06/2025');
    expect(L.fotosPozosLogic_formatearFecha('2025', 'ANIO')).toBe('2025');
    expect(L.fotosPozosLogic_formatearFecha('', 'DESCONOCIDA')).toBe('Sin fecha');
    expect(L.fotosPozosLogic_formatearFecha(null, 'DIA')).toBe('Sin fecha');
    expect(L.fotosPozosLogic_formatearFecha('2025', 'DIA')).toBe('Sin fecha');       // valor incoherente con la precision
  });

  test('etiquetas de fuente y tipo (con respaldo para valores futuros)', () => {
    expect(L.fotosPozosLogic_etiquetaFuente('CAMPO_APP')).toBe('Carga de campo');
    expect(L.fotosPozosLogic_etiquetaFuente('MONITOREO_NE')).toBe('Monitoreo NE');
    expect(L.fotosPozosLogic_etiquetaFuente('RELEVAMIENTO_2018')).toBe('Relevamiento 2018');
    expect(L.fotosPozosLogic_etiquetaFuente('FUTURA')).toBe('Otra fuente');
    expect(L.fotosPozosLogic_etiquetaTipo('PANORAMICA')).toBe('Panorámica');
    expect(L.fotosPozosLogic_etiquetaTipo('XYZ')).toBe('Otra');
  });
});

describe('filtros y orden de la galeria', () => {
  const fotos = [
    { fotoId: '1', fuente: 'MONITOREO_NE', tipoFoto: 'CERCA', fechaFotoValor: '2025', fechaFotoPrecision: 'ANIO' },
    { fotoId: '2', fuente: 'MONITOREO_NE', tipoFoto: 'PANORAMICA', fechaFotoValor: '2025', fechaFotoPrecision: 'ANIO' },
    { fotoId: '3', fuente: 'RELEVAMIENTO_2018', tipoFoto: 'OTRA', fechaFotoValor: '2018-05-22', fechaFotoPrecision: 'DIA' },
    { fotoId: '4', fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA' },
    { fotoId: '5', fuente: 'CAMPO_APP', tipoFoto: 'OTRA', fechaFotoValor: '', fechaFotoPrecision: 'DESCONOCIDA' }
  ];

  test('anio: de la fecha de la foto, "sin_fecha" si se desconoce', () => {
    expect(L.fotosPozosLogic_anioDe(fotos[2])).toBe('2018');
    expect(L.fotosPozosLogic_anioDe(fotos[0])).toBe('2025');
    expect(L.fotosPozosLogic_anioDe(fotos[4])).toBe('sin_fecha');
    expect(L.fotosPozosLogic_anioDe(null)).toBe('sin_fecha');
  });

  test('opciones solo con lo que existe, con cantidad; anios nuevos primero y sin fecha al final', () => {
    const o = L.fotosPozosLogic_opcionesFiltro(fotos);
    expect(o.fuentes).toEqual([
      { valor: 'CAMPO_APP', etiqueta: 'Carga de campo', cantidad: 2 },
      { valor: 'MONITOREO_NE', etiqueta: 'Monitoreo NE', cantidad: 2 },
      { valor: 'RELEVAMIENTO_2018', etiqueta: 'Relevamiento 2018', cantidad: 1 }
    ]);
    expect(o.anios.map((a) => a.valor)).toEqual(['2026', '2025', '2018', 'sin_fecha']);
    expect(o.anios[3].etiqueta).toBe('Sin fecha');
    expect(o.tipos.map((t) => [t.valor, t.cantidad])).toEqual([['CERCA', 2], ['PANORAMICA', 1], ['OTRA', 2]]);
  });

  test('sin fotos: opciones vacias', () => {
    expect(L.fotosPozosLogic_opcionesFiltro([])).toEqual({ fuentes: [], anios: [], tipos: [] });
    expect(L.fotosPozosLogic_opcionesFiltro(null)).toEqual({ fuentes: [], anios: [], tipos: [] });
  });

  test('filtrar por fuente, anio y tipo (AND), "" = todos', () => {
    const ids = (f) => L.fotosPozosLogic_filtrar(fotos, f).map((x) => x.fotoId);
    expect(ids({})).toEqual(['1', '2', '3', '4', '5']);
    expect(ids({ fuente: 'MONITOREO_NE' })).toEqual(['1', '2']);
    expect(ids({ anio: '2025' })).toEqual(['1', '2']);
    expect(ids({ anio: 'sin_fecha' })).toEqual(['5']);
    expect(ids({ tipo: 'CERCA' })).toEqual(['1', '4']);
    expect(ids({ fuente: 'MONITOREO_NE', tipo: 'CERCA' })).toEqual(['1']);
    expect(ids({ fuente: 'CAMPO_APP', anio: '2018' })).toEqual([]);
    expect(ids({ fuente: '', anio: '', tipo: '' })).toEqual(['1', '2', '3', '4', '5']);
  });

  test('hayFiltros', () => {
    expect(L.fotosPozosLogic_hayFiltros({ fuente: '', anio: '', tipo: '' })).toBe(false);
    expect(L.fotosPozosLogic_hayFiltros({ anio: '2025' })).toBe(true);
    expect(L.fotosPozosLogic_hayFiltros(null)).toBe(false);
  });

  test('orden: recientes primero, antiguas opcional, sin fecha siempre al final; estable', () => {
    expect(L.fotosPozosLogic_ordenar(fotos).map((f) => f.fotoId)).toEqual(['4', '1', '2', '3', '5']);
    expect(L.fotosPozosLogic_ordenar(fotos, 'antiguas').map((f) => f.fotoId)).toEqual(['3', '1', '2', '4', '5']);
  });

  test('agregar una foto recien subida: queda primera entre las de igual fecha; no se repite', () => {
    const nueva = { fotoId: 'n', fuente: 'CAMPO_APP', tipoFoto: 'CERCA', fechaFotoValor: '2026-10-05', fechaFotoPrecision: 'DIA' };
    const lista = L.fotosPozosLogic_agregarFoto(fotos, nueva);
    expect(lista.map((f) => f.fotoId)).toEqual(['n', '4', '1', '2', '3', '5']);
    expect(L.fotosPozosLogic_agregarFoto(lista, nueva)).toBe(lista);
    expect(L.fotosPozosLogic_agregarFoto(null, nueva).map((f) => f.fotoId)).toEqual(['n']);
  });
});

describe('formato por CONTENIDO (extension y mime pueden mentir)', () => {
  const d = (l) => Uint8Array.from(l);
  const asc = (s) => Array.from(Buffer.from(s, 'latin1'));

  test('JPEG, PNG, WebP', () => {
    expect(L.fotosPozosLogic_detectarFormato(d([0xff, 0xd8, 0xff, 0xe0, 0, 16]))).toBe('JPEG');
    expect(L.fotosPozosLogic_detectarFormato(d([0x89].concat(asc('PNG'), [13, 10, 26, 10])))).toBe('PNG');
    expect(L.fotosPozosLogic_detectarFormato(d(asc('RIFF').concat([1, 2, 3, 4], asc('WEBP'))))).toBe('WEBP');
  });

  test('HEIC/HEIF por la marca ftyp (iPhone); AVIF aparte', () => {
    ['heic', 'heix', 'mif1', 'heif'].forEach((marca) => {
      expect(L.fotosPozosLogic_detectarFormato(d([0, 0, 0, 24].concat(asc('ftyp'), asc(marca))))).toBe('HEIC');
    });
    expect(L.fotosPozosLogic_detectarFormato(d([0, 0, 0, 24].concat(asc('ftyp'), asc('avif'))))).toBe('AVIF');
  });

  test('lo que no es imagen: null (un .jpg que en realidad es un PDF o texto)', () => {
    expect(L.fotosPozosLogic_detectarFormato(d(asc('%PDF-1.4 ...')))).toBeNull();
    expect(L.fotosPozosLogic_detectarFormato(d(asc('hola, esto no es una foto')))).toBeNull();
    expect(L.fotosPozosLogic_detectarFormato(d([1, 2]))).toBeNull();
    expect(L.fotosPozosLogic_detectarFormato(null)).toBeNull();
  });

  test('un MP4 (ftyp isom/mp42) no se confunde con HEIC', () => {
    expect(L.fotosPozosLogic_detectarFormato(d([0, 0, 0, 24].concat(asc('ftyp'), asc('isom'))))).toBeNull();
  });

  test('validarArchivo: acepta por contenido sin mirar nombre ni mime', () => {
    const archivo = { name: 'IMG_0001', type: '', size: 2000000 };      // sin extension ni mime
    expect(L.fotosPozosLogic_validarArchivo(archivo, 'JPEG', 0)).toEqual({ ok: true, formato: 'JPEG' });
    expect(L.fotosPozosLogic_validarArchivo({ name: 'x.jpg', type: 'image/jpeg', size: 1 }, 'PNG', 0).ok).toBe(true);   // un .jpg que es PNG se procesa igual
    expect(L.fotosPozosLogic_validarArchivo(archivo, 'HEIC', 0).ok).toBe(true);        // se intenta; el navegador decide
  });

  test.each([
    ['formato desconocido', { size: 10 }, null, 0, 'TIPO_NO_SOPORTADO'],
    ['AVIF', { size: 10 }, 'AVIF', 0, 'TIPO_NO_SOPORTADO'],
    ['sin archivo', null, 'JPEG', 0, 'SIN_ARCHIVO'],
    ['vacio', { size: 0 }, 'JPEG', 0, 'ARCHIVO_VACIO'],
    ['mas de 15 MB', { size: 15 * 1024 * 1024 + 1 }, 'JPEG', 0, 'ORIGINAL_MUY_GRANDE'],
    ['lote lleno', { size: 10 }, 'JPEG', 10, 'LIMITE_LOTE']
  ])('rechaza: %s', (n, archivo, formato, cantidad, codigo) => {
    expect(L.fotosPozosLogic_validarArchivo(archivo, formato, cantidad)).toEqual({ ok: false, code: codigo });
  });

  test('exactamente 15 MB se acepta', () => {
    expect(L.fotosPozosLogic_validarArchivo({ size: 15 * 1024 * 1024 }, 'JPEG', 0).ok).toBe(true);
  });
});

describe('fecha de captura EXIF', () => {
  test('lee DateTimeOriginal (little y big endian)', () => {
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2026-09-30 10:11:12'.replace(/-/g, ':'), true), HOY)).toBe('2026-09-30');
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2019:11:21 08:00:00', false), HOY)).toBe('2019-11-21');
  });

  test('EXIF con anio < 2005 (reloj sin configurar, 1980) o futuro: no es confiable', () => {
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('1980:01:01 00:00:00'), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2004:12:31 23:59:59'), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2030:01:01 00:00:00'), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2026:10:07 09:00:00'), HOY)).toBe('2026-10-07');   // un dia de margen
  });

  test('fecha imposible o texto roto: null', () => {
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2026:02:31 10:00:00'), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('hola mundo no es una fecha'), HOY)).toBeNull();
  });

  test('sin EXIF, no JPEG, truncado o vacio: null (nunca revienta)', () => {
    expect(L.fotosPozosLogic_fechaExif(Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 4, 0, 0, 0xff, 0xd9, 0, 0]), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(jpegConExif('2026:09:30 10:11:12').slice(0, 30), HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(null, HOY)).toBeNull();
    expect(L.fotosPozosLogic_fechaExif(new Uint8Array(0), HOY)).toBeNull();
  });
});

describe('fecha del lote', () => {
  const ahora = new Date(2026, 9, 6, 20, 0, 0);       // hora local

  test('hoy en hora local del dispositivo', () => {
    expect(L.fotosPozosLogic_fechaHoy(ahora)).toBe('2026-10-06');
    expect(L.fotosPozosLogic_fechaHoy(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  test('fechaDiaValida: real, >= 2005, no futura', () => {
    expect(L.fotosPozosLogic_fechaDiaValida('2026-10-06', ahora)).toBe(true);
    expect(L.fotosPozosLogic_fechaDiaValida('2024-02-29', ahora)).toBe(true);
    ['2025-02-29', '2026-13-01', '2004-12-31', '2026-10-09', 'ayer', '', null].forEach((v) => expect(L.fotosPozosLogic_fechaDiaValida(v, ahora)).toBe(false));
  });

  test('por defecto cada foto usa la fecha de SU imagen (EXIF) y si no hay, hoy (USUARIO)', () => {
    const form = { fecha: '2026-10-06', fechaEditada: false, fechaDesconocida: false };
    expect(L.fotosPozosLogic_resolverFecha({ fechaExif: '2025-03-14' }, form, ahora)).toEqual({ valor: '2025-03-14', precision: 'DIA', fuente: 'EXIF' });
    expect(L.fotosPozosLogic_resolverFecha({ fechaExif: null }, form, ahora)).toEqual({ valor: '2026-10-06', precision: 'DIA', fuente: 'USUARIO' });
  });

  test('si el usuario edita la fecha, vale para todas (USUARIO), incluso si traen EXIF', () => {
    const form = { fecha: '2026-09-01', fechaEditada: true, fechaDesconocida: false };
    expect(L.fotosPozosLogic_resolverFecha({ fechaExif: '2025-03-14' }, form, ahora)).toEqual({ valor: '2026-09-01', precision: 'DIA', fuente: 'USUARIO' });
  });

  test('una fecha editada invalida no se usa (cae a EXIF u hoy)', () => {
    const form = { fecha: '2099-01-01', fechaEditada: true, fechaDesconocida: false };
    expect(L.fotosPozosLogic_resolverFecha({ fechaExif: '2025-03-14' }, form, ahora).fuente).toBe('EXIF');
  });

  test('"No sé la fecha": desconocida, sin valor; nunca se inventa un dia', () => {
    const form = { fecha: '2026-10-06', fechaEditada: true, fechaDesconocida: true };
    expect(L.fotosPozosLogic_resolverFecha({ fechaExif: '2025-03-14' }, form, ahora)).toEqual({ valor: '', precision: 'DESCONOCIDA', fuente: 'DESCONOCIDA' });
  });

  test('validar formulario: fecha editada invalida y observacion larga', () => {
    expect(L.fotosPozosLogic_validarFormulario({ fecha: '2026-10-06', fechaEditada: true, observacion: 'ok' }, ahora).valido).toBe(true);
    const r = L.fotosPozosLogic_validarFormulario({ fecha: '2099-01-01', fechaEditada: true, observacion: 'a'.repeat(141) }, ahora);
    expect(r.valido).toBe(false);
    expect(Object.keys(r.errores).sort()).toEqual(['fecha', 'observacion']);
    expect(L.fotosPozosLogic_validarFormulario({ fecha: 'x', fechaEditada: true, fechaDesconocida: true }, ahora).valido).toBe(true);   // desconocida: no se mira la fecha
    expect(L.fotosPozosLogic_validarFormulario({ fecha: 'x', fechaEditada: false }, ahora).valido).toBe(true);
    expect(L.fotosPozosLogic_validarFormulario({ observacion: 'a'.repeat(140) }, ahora).valido).toBe(true);
  });
});

describe('cuerpo de la subida', () => {
  const ahora = new Date(2026, 9, 6, 12);
  const item = { base64: 'AAAA', thumbBase64: 'BBBB', sha1: 'a'.repeat(40), bytesOriginal: 4200000, calidad: 0.72, ladoMayor: 1600, fechaExif: '2026-09-30' };
  const form = { fecha: '2026-10-06', fechaEditada: false, fechaDesconocida: false, tipoFoto: 'CERCA', fuente: 'CAMPO_APP', observacion: '  Boca del pozo ' };

  test('pozo Provincia: wellId, sin monitoringId; fecha EXIF; GPS opcional', () => {
    const d = L.fotosPozosLogic_armarSubida(item, { wellId: '04-0263', monitoringId: '', esNE: false }, form, { lat: -33.1, lon: -68.5 }, ahora);
    expect(d).toEqual({
      wellId: '04-0263', monitoringId: '', fuente: 'CAMPO_APP', tipoFoto: 'CERCA',
      fechaFotoValor: '2026-09-30', fechaFotoPrecision: 'DIA', fechaFotoFuente: 'EXIF', observacion: 'Boca del pozo',
      gps: { lat: -33.1, lon: -68.5 }, mimeType: 'image/jpeg', imagenBase64: 'AAAA', thumbBase64: 'BBBB',
      sha1Original: 'a'.repeat(40), procesamiento: 'NAVEGADOR_1600_Q72', tamanoOriginalBytes: 4200000
    });
  });

  test('punto NE especial: monitoringId; sin GPS: gps null', () => {
    const d = L.fotosPozosLogic_armarSubida(item, { wellId: '', monitoringId: 'INA 2055', esNE: true }, form, null, ahora);
    expect(d.wellId).toBe('');
    expect(d.monitoringId).toBe('INA 2055');
    expect(d.gps).toBeNull();
  });

  test('con wellId nunca se manda monitoringId (misma entidad que Provincia)', () => {
    expect(L.fotosPozosLogic_armarSubida(item, { wellId: '04-0263', monitoringId: 'INA 9', esNE: true }, form, null, ahora).monitoringId).toBe('');
  });

  test('fuente MONITOREO_NE solo para entidades NE; en Provincia cae a CAMPO_APP', () => {
    const f = Object.assign({}, form, { fuente: 'MONITOREO_NE' });
    expect(L.fotosPozosLogic_armarSubida(item, { wellId: '04-0263', esNE: true }, f, null, ahora).fuente).toBe('MONITOREO_NE');
    expect(L.fotosPozosLogic_armarSubida(item, { wellId: '04-0263', esNE: false }, f, null, ahora).fuente).toBe('CAMPO_APP');
  });

  test('tipo invalido o ausente: OTRA; sin sha1: vacio', () => {
    const d = L.fotosPozosLogic_armarSubida(Object.assign({}, item, { sha1: '' }), { wellId: '04-0263' }, Object.assign({}, form, { tipoFoto: 'X' }), null, ahora);
    expect(d.tipoFoto).toBe('OTRA');
    expect(d.sha1Original).toBe('');
  });

  test('no incluye identidad, estado, ids de Drive ni origen del GPS: eso lo pone el backend', () => {
    const d = L.fotosPozosLogic_armarSubida(item, { wellId: '04-0263' }, form, { lat: 1, lon: 2 }, ahora);
    ['email', 'estado', 'estadoVinculo', 'driveFileId', 'gpsOrigen', 'fotoId', 'vinculoMetodo', 'loteImportacion'].forEach((k) => expect(d).not.toHaveProperty(k));
  });
});

describe('mensajes de error', () => {
  test('propios, del backend y heredados de Reemplazos', () => {
    expect(L.fotosPozosLogic_mensajeError('HEIC_NO_SOPORTADO')).toMatch(/HEIC/);
    expect(L.fotosPozosLogic_mensajeError('PERMISSION_DENIED')).toBe('No tenés permiso para cargar fotos.');
    expect(L.fotosPozosLogic_mensajeError('ENTIDAD_NOT_FOUND')).toMatch(/ya no existe/);
    expect(L.fotosPozosLogic_mensajeError('STORAGE_UNAVAILABLE')).toMatch(/almacenamiento/);
    expect(L.fotosPozosLogic_mensajeError('RED')).toMatch(/conexión/);
    expect(L.fotosPozosLogic_mensajeError('CODIGO_RARO')).toMatch(/No se pudo subir/);
  });
});

describe('cola de subida secuencial', () => {
  const mk = (id) => ({ id, base64: 'x' + id, thumbBase64: 't', estado: 'lista' });
  const tick = () => new Promise((r) => setImmediate(r));
  async function vaciar() { for (let i = 0; i < 30; i++) { await tick(); } }

  function crear(respuestas) {
    const llamadas = [];
    let enVuelo = 0;
    let maxEnVuelo = 0;
    const eventos = { cambios: 0, subidas: [], sesion: 0 };
    const cola = L.fotosPozosCola_crear({
      subir: (item) => {
        llamadas.push(item.id);
        enVuelo += 1;
        maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
        const r = respuestas(item, llamadas.length);
        return Promise.resolve(r).then((v) => { enVuelo -= 1; return v; }, (e) => { enVuelo -= 1; throw e; });
      },
      onCambio: () => { eventos.cambios += 1; },
      onSubida: (item, data) => { eventos.subidas.push(item.id + ':' + (data && data.duplicada ? 'dup' : 'nueva')); },
      onSesionExpirada: () => { eventos.sesion += 1; }
    });
    return { cola, llamadas, eventos, maxEnVuelo: () => maxEnVuelo };
  }
  const ok = (id) => ({ status: 'ok', data: { foto: { fotoId: 'f' + id }, duplicada: false } });

  test('varias fotos: una por request, en orden, NUNCA en paralelo', async () => {
    const { cola, llamadas, eventos, maxEnVuelo } = crear((it) => new Promise((res) => setTimeout(() => res(ok(it.id)), 5)));
    cola.encolar([mk(1), mk(2), mk(3)]);
    await new Promise((r) => setTimeout(r, 60));
    expect(llamadas).toEqual([1, 2, 3]);
    expect(maxEnVuelo()).toBe(1);
    expect(eventos.subidas).toEqual(['1:nueva', '2:nueva', '3:nueva']);
    expect(cola.resumen()).toMatchObject({ total: 3, subidas: 3, fallidas: 0, enCurso: 0 });
    expect(cola.hayEnCurso()).toBe(false);
  });

  test('una foto que falla NO frena ni pierde a las demas; queda con su codigo real para reintentar', async () => {
    const { cola, llamadas, eventos } = crear((it) => (it.id === 2 ? { status: 'error', code: 'STORAGE_UNAVAILABLE' } : ok(it.id)));
    cola.encolar([mk(1), mk(2), mk(3)]);
    await vaciar();
    expect(llamadas).toEqual([1, 2, 3]);
    const it = cola.estado.items;
    expect(it.map((x) => x.estado)).toEqual(['subida', 'fallida', 'subida']);
    expect(it[1].codigo).toBe('STORAGE_UNAVAILABLE');
    expect(it[1].error).toMatch(/almacenamiento/);
    expect(eventos.subidas).toEqual(['1:nueva', '3:nueva']);
    expect(cola.resumen()).toMatchObject({ subidas: 2, fallidas: 1 });
  });

  test('una fallida no se reintenta sola; reintentar la sube (sin repetir las ya subidas)', async () => {
    let falla = true;
    const { cola, llamadas } = crear((it) => (it.id === 2 && falla ? { status: 'error', code: 'SERVICE_UNAVAILABLE' } : ok(it.id)));
    cola.encolar([mk(1), mk(2)]);
    await vaciar();
    expect(llamadas).toEqual([1, 2]);
    falla = false;
    cola.reintentar(cola.estado.items[1]);
    await vaciar();
    expect(llamadas).toEqual([1, 2, 2]);
    expect(cola.estado.items.map((x) => x.estado)).toEqual(['subida', 'subida']);
  });

  test('reintentar una foto que no esta fallida no hace nada', async () => {
    const { cola, llamadas } = crear((it) => ok(it.id));
    cola.encolar([mk(1)]);
    await vaciar();
    cola.reintentar(cola.estado.items[0]);
    await vaciar();
    expect(llamadas).toEqual([1]);
  });

  test('error de red (fetch rechazado o respuesta que no es JSON): fallida con codigo RED y la cola sigue', async () => {
    const { cola, llamadas } = crear((it) => (it.id === 1 ? Promise.reject(new Error('Failed to fetch')) : ok(it.id)));
    cola.encolar([mk(1), mk(2)]);
    await vaciar();
    expect(llamadas).toEqual([1, 2]);
    expect(cola.estado.items[0]).toMatchObject({ estado: 'fallida', codigo: 'RED' });
    expect(cola.estado.items[0].error).toMatch(/conexión/);
    expect(cola.estado.items[1].estado).toBe('subida');
  });

  test('excepcion sincronica al armar la subida: fallida, no rompe la cola', async () => {
    const { cola } = crear((it) => { if (it.id === 1) { throw new Error('boom'); } return ok(it.id); });
    cola.encolar([mk(1), mk(2)]);
    await vaciar();
    expect(cola.estado.items.map((x) => x.estado)).toEqual(['fallida', 'subida']);
  });

  test('duplicada (el backend ya la tenia): cuenta como subida pero se avisa al callback', async () => {
    const { cola, eventos } = crear(() => ({ status: 'ok', data: { foto: { fotoId: 'previa' }, duplicada: true } }));
    cola.encolar([mk(1)]);
    await vaciar();
    expect(cola.estado.items[0]).toMatchObject({ estado: 'subida', duplicada: true });
    expect(eventos.subidas).toEqual(['1:dup']);
  });

  test('sesion vencida: se pausa (no sigue golpeando al backend) y avisa una vez', async () => {
    const { cola, llamadas, eventos } = crear((it) => (it.id === 1 ? { status: 'error', code: 'UNAUTHORIZED' } : ok(it.id)));
    cola.encolar([mk(1), mk(2), mk(3)]);
    await vaciar();
    expect(llamadas).toEqual([1]);
    expect(eventos.sesion).toBe(1);
    expect(cola.estado.items.map((x) => x.estado)).toEqual(['fallida', 'pendiente', 'pendiente']);
  });

  test('libera el base64 de lo subido y notifica cada cambio para repintar', async () => {
    const { cola, eventos } = crear((it) => ok(it.id));
    cola.encolar([mk(1)]);
    await vaciar();
    expect(cola.estado.items[0].base64).toBeNull();
    expect(eventos.cambios).toBeGreaterThanOrEqual(3);
  });

  test('limpiarSubidas deja solo lo pendiente o fallido', async () => {
    const { cola } = crear((it) => (it.id === 2 ? { status: 'error', code: 'X' } : ok(it.id)));
    cola.encolar([mk(1), mk(2)]);
    await vaciar();
    cola.limpiarSubidas();
    expect(cola.estado.items.map((x) => x.id)).toEqual([2]);
  });

  test('se pueden encolar mas fotos mientras otra esta subiendo', async () => {
    const { cola, llamadas, maxEnVuelo } = crear((it) => new Promise((res) => setTimeout(() => res(ok(it.id)), 5)));
    cola.encolar([mk(1)]);
    cola.encolar([mk(2)]);
    await new Promise((r) => setTimeout(r, 40));
    expect(llamadas).toEqual([1, 2]);
    expect(maxEnVuelo()).toBe(1);
  });
});

describe('gps opcional', () => {
  const pos = (lat, lon, acc) => ({ coords: { latitude: lat, longitude: lon, accuracy: acc === undefined ? 20 : acc } });

  test('posicion -> lat/lon con 6 decimales', () => {
    expect(L.fotosPozosLogic_gpsDePosicion(pos(-33.123456789, -68.5))).toEqual({ lat: -33.123457, lon: -68.5 });
  });
  test.each([[null], [{}], [{ coords: {} }], [pos(NaN, 1)], [pos(91, 0)], [pos(0, 181)], [pos(0, 0)], [{ coords: { latitude: '1', longitude: '2' } }]])('posicion inutilizable %#: null', (p) => {
    expect(L.fotosPozosLogic_gpsDePosicion(p)).toBeNull();
  });

  test('permitido: lat, lon y precision', async () => {
    const geo = { getCurrentPosition: (ok) => ok(pos(-33.1, -68.5, 12.4)) };
    expect(await L.fotosPozosLogic_obtenerGps(geo)).toEqual({ estado: 'ok', lat: -33.1, lon: -68.5, precisionM: 12 });
  });
  test('denegado (code 1): estado denegado, no rechaza', async () => {
    const geo = { getCurrentPosition: (ok, err) => err({ code: 1 }) };
    expect(await L.fotosPozosLogic_obtenerGps(geo)).toEqual({ estado: 'denegado' });
  });
  test.each([[2], [3], [undefined]])('posicion no disponible / timeout / error raro (code %p): estado error', async (code) => {
    const geo = { getCurrentPosition: (ok, err) => err(code === undefined ? undefined : { code }) };
    expect(await L.fotosPozosLogic_obtenerGps(geo)).toEqual({ estado: 'error' });
  });
  test('sin API de geolocalizacion: no_disponible', async () => {
    expect(await L.fotosPozosLogic_obtenerGps(undefined)).toEqual({ estado: 'no_disponible' });
    expect(await L.fotosPozosLogic_obtenerGps({})).toEqual({ estado: 'no_disponible' });
  });
  test('la API lanza una excepcion: error, no rechaza', async () => {
    expect(await L.fotosPozosLogic_obtenerGps({ getCurrentPosition: () => { throw new Error('x'); } })).toEqual({ estado: 'error' });
  });
  test('posicion devuelta pero invalida (0,0): error', async () => {
    expect(await L.fotosPozosLogic_obtenerGps({ getCurrentPosition: (ok) => ok(pos(0, 0)) })).toEqual({ estado: 'error' });
  });
  test('pide alta precision con tope de tiempo', async () => {
    let opciones;
    await L.fotosPozosLogic_obtenerGps({ getCurrentPosition: (ok, err, o) => { opciones = o; ok(pos(-33, -68)); } });
    expect(opciones).toMatchObject({ enableHighAccuracy: true, timeout: 15000 });
  });
  test('textos: la foto se sube igual si falla', () => {
    ['denegado', 'no_disponible', 'error'].forEach((e) => expect(L.fotosPozosLogic_textoGps(e)).toMatch(/igual/));
    expect(L.fotosPozosLogic_textoGps('ok', 25)).toMatch(/± 25 m/);
    expect(L.fotosPozosLogic_textoGps('ok')).toMatch(/Ubicación obtenida/);
    expect(L.fotosPozosLogic_textoGps('otro')).toBe('');
  });
  test('el aviso aclara que no modifica la coordenada oficial', () => {
    expect(L.FOTOS_POZOS_AVISO_GPS).toMatch(/no modifica la coordenada oficial/);
  });
});
