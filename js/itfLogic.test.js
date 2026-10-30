// E9-6: logica PURA de los ITF colaborativos en el navegador (js/itfLogic.js): permisos exactos (matriz), catalogos y motivos, textos de estado / evento / error, formatos, validacion del archivo elegido, plan de
// reduccion de la imagen (JPEG / PNG / tamano / escalera), data: URI segura, foco de dialogos e ids de intencion.
const L = require('./itfLogic');

describe('permisos exactos (=== true): ninguna otra cosa alcanza', () => {
  const MATRIZ = [
    ['sin permisos', {}, { perfil: false, proponer: false, validar: false }],
    ['null', null, { perfil: false, proponer: false, validar: false }],
    ['solo perfil', { perfil: true }, { perfil: true, proponer: false, validar: false }],
    ['perfil + perfil_subir', { perfil: true, perfil_subir: true }, { perfil: true, proponer: true, validar: false }],
    ['perfil + perfil_validar', { perfil: true, perfil_validar: true }, { perfil: true, proponer: false, validar: true }],
    ['los tres', { perfil: true, perfil_subir: true, perfil_validar: true }, { perfil: true, proponer: true, validar: true }],
    ['perfil_subir sin perfil', { perfil_subir: true }, { perfil: false, proponer: false, validar: false }],
    ['perfil_validar sin perfil', { perfil_validar: true }, { perfil: false, proponer: false, validar: false }],
    ['los dos sin perfil', { perfil_subir: true, perfil_validar: true }, { perfil: false, proponer: false, validar: false }],
    ['perfil "SI" (truthy invalido)', { perfil: 'SI', perfil_subir: 'SI', perfil_validar: 'SI' }, { perfil: false, proponer: false, validar: false }],
    ['perfil 1', { perfil: 1, perfil_subir: 1, perfil_validar: 1 }, { perfil: false, proponer: false, validar: false }],
    ['perfil true pero perfil_subir "true"', { perfil: true, perfil_subir: 'true', perfil_validar: 'true' }, { perfil: true, proponer: false, validar: false }],
    ['perfil true pero los otros objetos', { perfil: true, perfil_subir: {}, perfil_validar: [] }, { perfil: true, proponer: false, validar: false }]
  ];
  test.each(MATRIZ)('%s', (_n, permisos, esperado) => {
    expect({ perfil: L.itfLogic_puedeVerPerfil(permisos), proponer: L.itfLogic_puedeProponer(permisos), validar: L.itfLogic_puedeValidar(permisos) }).toEqual(esperado);
  });
});

describe('motivos', () => {
  test('catalogos: los mismos codigos que el backend, y OTRO siempre al final', () => {
    expect(L.ITF_MOTIVOS_REEMPLAZO.map((m) => m.codigo)).toEqual(['ACTUALIZACION', 'CORRECCION', 'MEJOR_CALIDAD', 'DOCUMENTO_COMPLETO', 'OTRO']);
    expect(L.ITF_MOTIVOS_RECHAZO.map((m) => m.codigo)).toEqual(['NO_CORRESPONDE_POZO', 'INCOMPLETO', 'ILEGIBLE', 'DUPLICADO', 'VERSION_INCORRECTA', 'OTRO']);
    expect(L.ITF_MOTIVOS_RETIRO.map((m) => m.codigo).sort()).toEqual(['DESACTUALIZADO', 'DOCUMENTO_INCORRECTO', 'ERROR_DE_APROBACION', 'NO_CORRESPONDE_POZO', 'OTRO']);
    expect(L.ITF_MOTIVOS_RESTAURACION.map((m) => m.codigo).sort()).toEqual(L.ITF_MOTIVOS_RETIRO.map((m) => m.codigo).sort());
    [L.ITF_MOTIVOS_REEMPLAZO, L.ITF_MOTIVOS_RECHAZO, L.ITF_MOTIVOS_RETIRO, L.ITF_MOTIVOS_RESTAURACION].forEach((c) => {
      expect(c[c.length - 1].codigo).toBe('OTRO');
      c.forEach((m) => expect(m.texto).toMatch(/[a-záéíóú]/));        // copy humano, no un codigo crudo
      c.forEach((m) => expect(m.texto).not.toMatch(/_/));
    });
  });

  test('que catalogo pide cada accion: aprobar solo pide motivo si REEMPLAZA un vigente', () => {
    expect(L.itfLogic_catalogoDe('APROBAR', false)).toBeNull();
    expect(L.itfLogic_catalogoDe('APROBAR', true)).toBe(L.ITF_MOTIVOS_REEMPLAZO);
    expect(L.itfLogic_catalogoDe('RECHAZAR', false)).toBe(L.ITF_MOTIVOS_RECHAZO);
    expect(L.itfLogic_catalogoDe('RETIRAR', true)).toBe(L.ITF_MOTIVOS_RETIRO);
    expect(L.itfLogic_catalogoDe('RESTAURAR', false)).toBe(L.ITF_MOTIVOS_RESTAURACION);
    expect(L.itfLogic_catalogoDe('RETIRAR_PROPUESTA', true)).toBeNull();
  });

  test('validarMotivo: sin catalogo no pide nada; con catalogo exige un codigo del catalogo', () => {
    expect(L.itfLogic_validarMotivo(null, '', '')).toEqual({ ok: true, motivoCodigo: undefined, motivoTexto: undefined });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, '', '')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'ACTUALIZACION', '')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'ilegible', '')).toMatchObject({ ok: false });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'ILEGIBLE', '')).toEqual({ ok: true, motivoCodigo: 'ILEGIBLE', motivoTexto: undefined });
  });

  test('OTRO exige detalle de 3 a 300 caracteres (espacios normalizados); otro motivo con detalle tambien lo valida', () => {
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', '')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', '   ')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', 'ab')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', 'x'.repeat(301))).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', '  Pagina   cortada  ')).toEqual({ ok: true, motivoCodigo: 'OTRO', motivoTexto: 'Pagina cortada' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'OTRO', 'x'.repeat(300)).ok).toBe(true);
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'ILEGIBLE', 'ab')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(L.itfLogic_validarMotivo(L.ITF_MOTIVOS_RECHAZO, 'ILEGIBLE', 'borroso del lado derecho')).toMatchObject({ ok: true, motivoTexto: 'borroso del lado derecho' });
  });

  test('textos guardados: nunca un codigo crudo; el reservado del proponente se explica', () => {
    expect(L.itfLogic_textoMotivoGuardado('ILEGIBLE')).toBe('No se puede leer');
    expect(L.itfLogic_textoMotivoGuardado('CANCELADO_POR_PROPONENTE')).toBe('Retirada por quien la propuso');
    expect(L.itfLogic_textoMotivoGuardado('CODIGO_RARO')).toBe('');
    expect(L.itfLogic_textoMotivoGuardado(null)).toBe('');
  });
});

describe('estados, eventos y nombres', () => {
  test('estados de propuesta: los cinco, con copy humano', () => {
    ['PROPUESTO', 'APROBADO', 'RECHAZADO', 'RETIRADO', 'REEMPLAZADO'].forEach((e) => expect(L.itfLogic_textoEstadoPropuesta(e)).not.toBe(''));
    expect(L.itfLogic_textoEstadoPropuesta('PROPUESTO')).toBe('Pendiente de validación');
    expect(L.itfLogic_textoEstadoPropuesta('LEGACY')).toBe('');
    expect(L.itfLogic_textoEstadoPropuesta('toString')).toBe('');         // no hereda de Object.prototype
  });

  test('eventos: ITF_LEGACY_REGISTRADO se OCULTA (contabilidad interna) y un evento desconocido no se muestra crudo', () => {
    expect(L.itfLogic_textoEvento('ITF_PROPUESTO')).toBe('Propuesto');
    expect(L.itfLogic_textoEvento('ITF_REVERTIDO')).toBe('Restaurado');
    expect(L.itfLogic_textoEvento('ITF_LEGACY_REGISTRADO')).toBe('');
    expect(L.itfLogic_textoEvento('ITF_X')).toBe('');
    expect(L.itfLogic_textoEvento('constructor')).toBe('');
  });

  test('el ITF existente (legacy) se ve como "ITF existente": jamas LEGACY:<wellId>', () => {
    expect(L.itfLogic_nombreDocumento({ documentoId: 'LEGACY:14-0001', origen: 'LEGACY' })).toBe('ITF existente');
    expect(L.itfLogic_nombreDocumento({ documentoId: 'LEGACY:14-0001' })).toBe('ITF existente');
    expect(L.itfLogic_nombreDocumento({ documentoId: 'u-1', origen: 'E9', nombreOriginal: 'escaneo.jpg' })).toBe('escaneo.jpg');
    expect(L.itfLogic_nombreDocumento({ documentoId: 'u-1', origen: 'E9', nombreOriginal: '' })).toBe('Documento propuesto');
    expect(L.itfLogic_nombreDocumento(null)).toBe('');
  });

  const HIST = [
    { evento: 'ITF_REVERTIDO', documentoId: 'd2', documentoReemplazadoId: 'd3', email: 'vera@example.com', actor: 'vera@example.com', nombre: 'Vera', timestamp: '2026-10-03T15:00:00.000Z', motivoCodigo: 'ERROR_DE_APROBACION', motivoTexto: '', detalle: 'Se restauro.' },
    { evento: 'ITF_APROBADO', documentoId: 'd3', documentoReemplazadoId: 'LEGACY:14-0001', nombre: 'Vera', timestamp: '2026-10-02T15:00:00.000Z', motivoCodigo: 'OTRO', motivoTexto: 'Es el completo', detalle: 'Se aprobo.' },
    { evento: 'ITF_LEGACY_REGISTRADO', documentoId: 'LEGACY:14-0001', documentoReemplazadoId: '', nombre: 'Sistema', timestamp: '2026-10-02T15:00:00.000Z', motivoCodigo: '', motivoTexto: '', detalle: 'Registro interno.' },
    { evento: 'ITF_PROPUESTO', documentoId: 'd3', documentoReemplazadoId: '', email: 'ana@example.com', secuencia: 7, clientRequestId: 'req-secreto-1', nombre: 'Ana', timestamp: '2026-10-01T15:00:00.000Z', motivoCodigo: '', motivoTexto: '', detalle: 'Se propuso.' }
  ];
  const DOCS = [{ documentoId: 'd3', origen: 'E9', nombreOriginal: 'itf3.jpg' }, { documentoId: 'd2', origen: 'E9', nombreOriginal: 'itf2.jpg' }, { documentoId: 'LEGACY:14-0001', origen: 'LEGACY' }];

  test('filas del historial: el mas nuevo primero, sin el registro interno, con motivo legible y documento por su nombre', () => {
    const filas = L.itfLogic_filasHistorial(HIST, DOCS);
    expect(filas.map((f) => f.titulo)).toEqual(['Restaurado', 'Aprobado', 'Propuesto']);
    expect(filas[0]).toMatchObject({ quien: 'Vera', documento: 'itf2.jpg', motivo: 'Se aprobó por error', cuando: '03/10/2026 12:00' });
    expect(filas[1].motivo).toBe('Es el completo');                    // OTRO muestra solo el detalle
    expect(filas[1].documento).toBe('itf3.jpg');
    // las frases las arma la pantalla (con tildes), no el servidor
    expect(filas.map((f) => f.detalle)).toEqual(['Se restauró como ITF vigente y dejó de serlo el anterior.', 'Se aprobó y reemplazó al ITF vigente anterior.', 'Se propuso un ITF para el pozo.']);
    expect(Object.keys(filas[0]).sort()).toEqual(['clave', 'cuando', 'detalle', 'documento', 'motivo', 'quien', 'titulo']);
    // lo que se MUESTRA (la clave es interna, solo identifica la fila)
    expect(JSON.stringify(filas.map((f) => ({ titulo: f.titulo, quien: f.quien, cuando: f.cuando, detalle: f.detalle, motivo: f.motivo, documento: f.documento })))).not.toMatch(/LEGACY|ITF_|@/);
  });

  test('una aprobacion de quien habia propuesto se dice sin alarma; retirar la propia propuesta no repite el motivo; restaurar sin vigente; retiro y rechazo', () => {
    const d = [{ documentoId: 'a', origen: 'E9', nombreOriginal: 'a.jpg', autoaprobado: true }, { documentoId: 'b', origen: 'E9', nombreOriginal: 'b.jpg', autoaprobado: false }];
    const f = (evento, extra, doc) => L.itfLogic_filasHistorial([Object.assign({ evento: evento, documentoId: doc || 'a', documentoReemplazadoId: '', nombre: 'X', timestamp: '2026-10-01T15:00:00.000Z', motivoCodigo: '', motivoTexto: '' }, extra || {})], d)[0];
    expect(f('ITF_APROBADO').detalle).toBe('Se aprobó como ITF vigente del pozo. Propuesto y aprobado por la misma persona.');
    expect(f('ITF_APROBADO', {}, 'b').detalle).toBe('Se aprobó como ITF vigente del pozo.');
    expect(f('ITF_APROBADO', { documentoReemplazadoId: 'LEGACY:14-0001' }, 'b').detalle).toBe('Se aprobó y reemplazó al ITF vigente anterior.');
    expect(f('ITF_REVERTIDO').detalle).toBe('Se restauró como ITF vigente.');
    expect(f('ITF_RECHAZADO', { motivoCodigo: 'ILEGIBLE' })).toMatchObject({ detalle: 'Se rechazó la propuesta.', motivo: 'No se puede leer' });
    expect(f('ITF_RETIRADO', { motivoCodigo: 'DOCUMENTO_INCORRECTO' })).toMatchObject({ detalle: 'Se retiró el documento.', motivo: 'El documento es incorrecto' });
    expect(f('ITF_RETIRADO', { motivoCodigo: 'CANCELADO_POR_PROPONENTE' })).toMatchObject({ detalle: 'Quien la propuso retiró su propuesta.', motivo: '' });
  });

  test('un evento desconocido o sin lista no rompe ni se muestra', () => {
    expect(L.itfLogic_filasHistorial([{ evento: 'ITF_X', documentoId: 'd', timestamp: 'x' }], [])).toEqual([]);
    expect(L.itfLogic_filasHistorial(null, null)).toEqual([]);
  });

  test('documentos restaurables (reemplazados / retirados que fueron vigentes) y el vigente unico', () => {
    const docs = [{ documentoId: 'a', restaurable: true, estado: 'REEMPLAZADO' }, { documentoId: 'b', restaurable: false, estado: 'PROPUESTO' }, { documentoId: 'c', estado: 'VIGENTE' }, { documentoId: 'd', restaurable: 'true' }];
    expect(L.itfLogic_documentosRestaurables(docs).map((d) => d.documentoId)).toEqual(['a']);
    expect(L.itfLogic_documentoVigente(docs).documentoId).toBe('c');
    expect(L.itfLogic_documentoVigente([{ estado: 'VIGENTE' }, { estado: 'VIGENTE' }])).toBeNull();      // dos vigentes: no se afirma ninguno
    expect(L.itfLogic_documentoVigente([])).toBeNull();
  });
});

describe('mensajes de error', () => {
  test('todo codigo del backend que la UI puede ver tiene un mensaje humano (sin codigos crudos ni "undefined")', () => {
    const codigos = ['PERMISSION_DENIED', 'ITF_E9_INACTIVO', 'INVALID_ARCHIVO', 'FORMATO_NO_RECONOCIDO', 'MIME_NO_PERMITIDO', 'MIME_NO_COINCIDE', 'ARCHIVO_VACIO', 'ARCHIVO_DEMASIADO_GRANDE', 'POZO_NOT_FOUND', 'TOO_MANY_PENDING',
      'DUPLICADO_DOCUMENTO', 'LEGACY_AMBIGUO', 'LEGACY_NOMBRE_NO_CANONICO', 'LEGACY_FORMATO_INVALIDO', 'ITF_STATE_UNKNOWN', 'INCONSISTENT_STATE', 'IDEMPOTENCY_CONFLICT', 'VIGENTE_CAMBIO', 'DOCUMENTO_NO_PROPUESTO',
      'DOCUMENTO_NO_RETIRABLE', 'DESTINO_INVALIDO', 'ITF_NOT_FOUND', 'LEGACY_CAMBIO', 'LEGACY_NO_DISPONIBLE', 'ITF_ARCHIVO_NO_DISPONIBLE', 'ITF_ARCHIVO_NO_COINCIDE', 'INVALID_MOTIVO', 'INVALID_MOTIVO_TEXTO',
      'SERVICE_UNAVAILABLE', 'ITF_STORAGE_NO_CONFIGURADO', 'RED', 'ERROR'];
    codigos.forEach((c) => {
      const m = L.itfLogic_mensajeError(c);
      expect(typeof m).toBe('string');
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/[A-Z]{3,}_[A-Z]{3,}|undefined/);
    });
  });

  test('un codigo desconocido (o heredado de Object.prototype) cae al mensaje generico: nunca se muestra crudo', () => {
    expect(L.itfLogic_mensajeError('CODIGO_NUEVO_RARO')).toBe(L.ITF_MENSAJES_ERROR.ERROR);
    expect(L.itfLogic_mensajeError('toString')).toBe(L.ITF_MENSAJES_ERROR.ERROR);
    expect(L.itfLogic_mensajeError(undefined)).toBe(L.ITF_MENSAJES_ERROR.ERROR);
  });

  test('VIGENTE_CAMBIO dice exactamente lo pedido', () => {
    expect(L.itfLogic_mensajeError('VIGENTE_CAMBIO')).toBe('El ITF vigente cambió desde que abriste esta propuesta. Actualizá la información antes de decidir.');
  });

  test('el Perfil: PROFILE_NOT_FOUND es "no hay ITF vigente"; un estado dudoso JAMAS se presenta como "no hay"', () => {
    expect(L.itfLogic_mensajePerfil('PROFILE_NOT_FOUND')).toBe('No hay un ITF vigente registrado para este pozo.');
    ['ITF_STATE_UNKNOWN', 'SERVICE_UNAVAILABLE', 'RED', 'ERROR'].forEach((c) => expect(L.itfLogic_mensajePerfil(c)).not.toBe(L.ITF_TEXTO_SIN_VIGENTE));
  });

  test('sesion vencida y errores reintentables', () => {
    expect(L.itfLogic_esErrorDeSesion('UNAUTHORIZED')).toBe(true);
    expect(L.itfLogic_esErrorDeSesion('USER_DISABLED')).toBe(true);
    expect(L.itfLogic_esErrorDeSesion('PERMISSION_DENIED')).toBe(false);
    ['SERVICE_UNAVAILABLE', 'RED', 'ERROR', 'ITF_STORAGE_NO_CONFIGURADO'].forEach((c) => expect(L.itfLogic_esReintentable(c)).toBe(true));
    ['PERMISSION_DENIED', 'VIGENTE_CAMBIO', 'DUPLICADO_DOCUMENTO', 'INVALID_ARCHIVO'].forEach((c) => expect(L.itfLogic_esReintentable(c)).toBe(false));
    expect(L.itfLogic_codigoDeRespuesta({ code: 'X' })).toBe('X');
    expect(L.itfLogic_codigoDeRespuesta(null)).toBe('ERROR');
    expect(L.itfLogic_codigoDeRespuesta({ code: '' })).toBe('ERROR');
  });
});

describe('formatos', () => {
  test('bytes', () => {
    expect(L.itfLogic_formatearBytes(0)).toBe('0 B');
    expect(L.itfLogic_formatearBytes(900)).toBe('900 B');
    expect(L.itfLogic_formatearBytes(2048)).toBe('2 KB');
    expect(L.itfLogic_formatearBytes(1024 * 1024 * 2.5)).toBe('2,5 MB');
    expect(L.itfLogic_formatearBytes(3 * 1024 * 1024)).toBe('3 MB');
    expect(L.itfLogic_formatearBytes(-1)).toBe('');
    expect(L.itfLogic_formatearBytes('x')).toBe('');
    expect(L.itfLogic_formatearBytes(NaN)).toBe('');
  });

  test('fecha en hora de Mendoza (UTC-3)', () => {
    expect(L.itfLogic_formatearFecha('2026-10-28T15:20:00.000Z')).toBe('28/10/2026 12:20');
    expect(L.itfLogic_formatearFecha('2026-01-01T02:30:00.000Z')).toBe('31/12/2025 23:30');
    expect(L.itfLogic_formatearFecha('basura')).toBe('');
    expect(L.itfLogic_formatearFecha(null)).toBe('');
  });
});

describe('archivo elegido: tipo aparente y tamano (el servidor sigue siendo la autoridad)', () => {
  const f = (type, size, name) => ({ type: type, size: size, name: name === undefined ? 'itf.jpg' : name });
  test('JPEG y PNG pasan', () => {
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', 1000))).toEqual({ ok: true, mimeType: 'image/jpeg' });
    expect(L.itfLogic_validarArchivoElegido(f('image/png', 1000, 'itf.PNG'))).toEqual({ ok: true, mimeType: 'image/png' });
    expect(L.itfLogic_validarArchivoElegido(f('IMAGE/JPEG', 1000, 'a.JPEG')).ok).toBe(true);
  });
  test('PDF, GIF, WebP, HEIC, texto, sin tipo y extension que no coincide se rechazan con copy claro', () => {
    ['application/pdf', 'image/gif', 'image/webp', 'image/heic', 'text/plain', ''].forEach((t) => {
      const r = L.itfLogic_validarArchivoElegido(f(t, 1000, 'x.bin'));
      expect(r).toMatchObject({ ok: false, code: 'TIPO_NO_PERMITIDO', mensaje: 'Solo se aceptan imágenes JPEG o PNG.' });
    });
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', 1000, 'itf.pdf')).ok).toBe(false);
    expect(L.itfLogic_validarArchivoElegido(f('image/png', 1000, 'itf.gif')).ok).toBe(false);
  });
  test('vacio, sin tamano o enorme', () => {
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', 0))).toMatchObject({ ok: false, code: 'ARCHIVO_VACIO' });
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', NaN))).toMatchObject({ ok: false, code: 'ARCHIVO_VACIO' });
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', L.ITF_IMG_ENTRADA_MAX_BYTES + 1))).toMatchObject({ ok: false, code: 'ARCHIVO_ENORME' });
    expect(L.itfLogic_validarArchivoElegido(f('image/jpeg', L.ITF_IMG_ENTRADA_MAX_BYTES)).ok).toBe(true);
    expect(L.itfLogic_validarArchivoElegido(null)).toMatchObject({ ok: false, code: 'SIN_ARCHIVO' });
  });
});

describe('plan de reduccion de la imagen (un ITF es un documento: la legibilidad pesa mas que el ahorro)', () => {
  const MB = 1024 * 1024;
  test('constantes: objetivo bajo el limite del servidor, lado minimo que mantiene legible el texto, calidades altas', () => {
    expect(L.ITF_IMG_LIMITE_BYTES).toBe(3 * MB);
    expect(L.ITF_IMG_OBJETIVO_BYTES).toBeLessThan(L.ITF_IMG_LIMITE_BYTES);
    expect(L.ITF_IMG_OBJETIVO_BYTES).toBeGreaterThan(2 * MB);
    expect(L.ITF_IMG_LADO_MAX).toBeGreaterThanOrEqual(2000);
    expect(L.ITF_IMG_LADO_MIN).toBeGreaterThanOrEqual(1600);
    expect(L.ITF_IMG_CALIDADES[0]).toBeGreaterThanOrEqual(0.9);
    expect(Math.min.apply(null, L.ITF_IMG_CALIDADES)).toBeGreaterThanOrEqual(0.75);
    expect(L.ITF_IMG_CALIDADES).toEqual(L.ITF_IMG_CALIDADES.slice().sort((a, b) => b - a));
  });

  test('un archivo que ya entra en el objetivo y no es enorme se CONSERVA tal cual (jpeg o png), sin recomprimir', () => {
    expect(L.itfLogic_planificarImagen({ bytes: 800 * 1024, ancho: 2000, alto: 3000, mimeType: 'image/jpeg' })).toMatchObject({ accion: 'CONSERVAR', mimeType: 'image/jpeg' });
    expect(L.itfLogic_planificarImagen({ bytes: 2 * MB, ancho: 2480, alto: 3508, mimeType: 'image/png' })).toMatchObject({ accion: 'CONSERVAR', mimeType: 'image/png' });
    expect(L.itfLogic_planificarImagen({ bytes: L.ITF_IMG_OBJETIVO_BYTES, ancho: 4096, alto: 3000, mimeType: 'image/jpeg' }).accion).toBe('CONSERVAR');
  });

  test('un JPEG que pasa del objetivo se REDUCE a JPEG de alta calidad con el lado acotado', () => {
    const p = L.itfLogic_planificarImagen({ bytes: 6 * MB, ancho: 6000, alto: 4000, mimeType: 'image/jpeg' });
    expect(p).toEqual({ accion: 'REDUCIR', mimeType: 'image/jpeg', lado: L.ITF_IMG_LADO_MAX, calidad: L.ITF_IMG_CALIDADES[0] });
  });

  test('un PNG grande (un escaneo) se CONVIERTE a JPEG; la transparencia se aplana (el pipeline pinta fondo blanco)', () => {
    const p = L.itfLogic_planificarImagen({ bytes: 9 * MB, ancho: 3000, alto: 4000, mimeType: 'image/png' });
    expect(p).toMatchObject({ accion: 'REDUCIR', mimeType: 'image/jpeg' });
  });

  test('un archivo chico pero ENORME en pixeles (> 4096) tambien se reduce; y nunca se agranda una imagen chica', () => {
    expect(L.itfLogic_planificarImagen({ bytes: 1 * MB, ancho: 9000, alto: 6000, mimeType: 'image/jpeg' })).toMatchObject({ accion: 'REDUCIR', lado: L.ITF_IMG_LADO_MAX });
    expect(L.itfLogic_planificarImagen({ bytes: 2.6 * MB, ancho: 1200, alto: 1800, mimeType: 'image/jpeg' })).toMatchObject({ accion: 'REDUCIR', lado: 1800 });   // el lado no sube
  });

  test('dimensiones: proporcional, el lado mayor queda en `lado`, nunca se agranda', () => {
    expect(L.itfLogic_dimensiones(4000, 3000, 2000)).toEqual({ ancho: 2000, alto: 1500 });
    expect(L.itfLogic_dimensiones(3000, 4000, 2000)).toEqual({ ancho: 1500, alto: 2000 });
    expect(L.itfLogic_dimensiones(1000, 800, 2000)).toEqual({ ancho: 1000, alto: 800 });
    expect(L.itfLogic_dimensiones(10000, 1, 100)).toEqual({ ancho: 100, alto: 1 });
  });

  test('escalera: primero baja la calidad, despues el lado (con la calidad alta otra vez), y termina', () => {
    let paso = { lado: L.ITF_IMG_LADO_MAX, calidad: L.ITF_IMG_CALIDADES[0] };
    const visto = [paso];
    for (let i = 0; i < 100 && paso !== null; i += 1) { paso = L.itfLogic_siguientePaso(paso); if (paso) { visto.push(paso); } }
    expect(paso).toBeNull();
    // las primeras N-1 transiciones solo bajan la calidad
    for (let i = 1; i < L.ITF_IMG_CALIDADES.length; i += 1) { expect(visto[i]).toEqual({ lado: L.ITF_IMG_LADO_MAX, calidad: L.ITF_IMG_CALIDADES[i] }); }
    // despues baja el lado y vuelve a la calidad mas alta
    expect(visto[L.ITF_IMG_CALIDADES.length]).toEqual({ lado: L.ITF_IMG_LADO_MAX - L.ITF_IMG_PASO_LADO, calidad: L.ITF_IMG_CALIDADES[0] });
    // jamas por debajo del lado minimo ni de la calidad minima
    visto.forEach((p) => { expect(p.lado).toBeGreaterThanOrEqual(L.ITF_IMG_LADO_MIN); expect(p.calidad).toBeGreaterThanOrEqual(0.75); });
    expect(visto[visto.length - 1].lado).toBe(L.ITF_IMG_LADO_MIN);
  });

  test('una imagen cuyo lado ya es el minimo solo baja la calidad y se agota', () => {
    let paso = { lado: L.ITF_IMG_LADO_MIN, calidad: L.ITF_IMG_CALIDADES[0] };
    let n = 0;
    while (paso !== null && n < 50) { paso = L.itfLogic_siguientePaso(paso); n += 1; }
    expect(n).toBe(L.ITF_IMG_CALIDADES.length);
  });

  test('resultado de tamano: bloquea lo que el servidor rechazaria, con el tamano en el mensaje', () => {
    expect(L.itfLogic_resultadoDeTamano(1)).toEqual({ ok: true });
    expect(L.itfLogic_resultadoDeTamano(L.ITF_IMG_LIMITE_BYTES)).toEqual({ ok: true });
    const r = L.itfLogic_resultadoDeTamano(L.ITF_IMG_LIMITE_BYTES + 1);
    expect(r).toMatchObject({ ok: false, code: 'ARCHIVO_DEMASIADO_GRANDE' });
    expect(r.mensaje).toMatch(/3 MB/);
    expect(L.itfLogic_resultadoDeTamano(0).ok).toBe(false);
    expect(L.itfLogic_resultadoDeTamano(undefined).ok).toBe(false);
  });
});

describe('descarga y data: URI', () => {
  test('el nombre sigue el tipo REAL (un PNG aprobado no se llama .jpg)', () => {
    expect(L.itfLogic_nombreDescarga('14-0001', 'image/png')).toBe('14-0001.png');
    expect(L.itfLogic_nombreDescarga('14-0001', 'image/jpeg')).toBe('14-0001.jpg');
    expect(L.itfLogic_nombreDescarga('14-0001', 'otro')).toBe('14-0001.jpg');
  });
  test('data URI solo con tipo permitido y base64 valido; jamas un valor arbitrario en src', () => {
    expect(L.itfLogic_dataUri('image/jpeg', 'AAAA')).toBe('data:image/jpeg;base64,AAAA');
    expect(L.itfLogic_dataUri('image/png', 'QUJD')).toBe('data:image/png;base64,QUJD');
    expect(L.itfLogic_dataUri('text/html', 'AAAA')).toBeNull();
    expect(L.itfLogic_dataUri('image/svg+xml', 'AAAA')).toBeNull();
    expect(L.itfLogic_dataUri('image/jpeg', 'AAAA" onerror="x')).toBeNull();
    expect(L.itfLogic_dataUri('image/jpeg', '')).toBeNull();
    expect(L.itfLogic_dataUri('image/jpeg', null)).toBeNull();
    expect(L.itfLogic_dataUri('image/jpeg;base64,AAAA#', 'AAAA')).toBeNull();
  });
});

describe('foco de los dialogos', () => {
  test('da la vuelta en los bordes y deja al navegador en el medio', () => {
    expect(L.itfLogic_siguienteFoco(0, -1, false)).toBe(-1);
    expect(L.itfLogic_siguienteFoco(3, -1, false)).toBe(0);
    expect(L.itfLogic_siguienteFoco(3, -1, true)).toBe(2);
    expect(L.itfLogic_siguienteFoco(3, 2, false)).toBe(0);
    expect(L.itfLogic_siguienteFoco(3, 0, true)).toBe(2);
    expect(L.itfLogic_siguienteFoco(3, 1, false)).toBe(-1);
    expect(L.itfLogic_siguienteFoco(3, 1, true)).toBe(-1);
  });
});

describe('ids de intencion', () => {
  test('cumplen la forma que el backend exige (A-Za-z0-9_-, 8 a 64) y no se repiten', () => {
    const ids = new Set();
    for (let i = 0; i < 200; i += 1) {
      const id = L.itfLogic_nuevoId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(200);
  });
  test('sin crypto.randomUUID sigue dando ids validos', () => {
    const original = global.crypto;
    Object.defineProperty(global, 'crypto', { value: undefined, configurable: true });
    try {
      expect(L.itfLogic_nuevoId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    } finally {
      Object.defineProperty(global, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('acciones: textos de cada una', () => {
  test('aprobar dice "Aprobar como ITF vigente" y nunca "Subir ITF definitivo"; cada accion tiene titulo, boton, gerundio y exito', () => {
    expect(L.ITF_ACCIONES_UI.APROBAR.boton).toBe('Aprobar como ITF vigente');
    Object.keys(L.ITF_ACCIONES_UI).forEach((k) => {
      const a = L.ITF_ACCIONES_UI[k];
      ['titulo', 'boton', 'enviando', 'exito'].forEach((c) => expect(a[c].length).toBeGreaterThan(3));
      expect(JSON.stringify(a)).not.toMatch(/definitivo/i);
    });
    expect(L.ITF_TEXTO_REEMPLAZA).toBe('Esta aprobación reemplazará el ITF vigente actual.');
    expect(L.ITF_TEXTO_RETIRAR).toBe('El pozo quedará sin ITF vigente hasta que se apruebe o restaure otro.');
  });
});
