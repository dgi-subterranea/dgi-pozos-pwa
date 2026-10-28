// FotosPozosModeracionService (E8-2): dominio puro de la moderacion de fotos. Baseline legacy (ACTIVA / OCULTA), eventos append-only, estado derivado, solicitudes, retiro directo,
// reposicion, catalogo de motivos, idempotencia, integridad fail-closed, visibilidad central, privacidad y cache a invalidar. Sin hojas, sin red, sin Apps Script.
// NOTA de estilo: los caracteres especiales se arman con String.fromCharCode (no con secuencias de escape en el texto del test).
const M = require('../src/FotosPozosModeracionService');
const { fotosPozosRepository_esVisible } = require('../src/FotosPozosRepository');

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const ch = (...codes) => String.fromCharCode(...codes);
const uuid = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const FOTO = uuid(1);
const FOTO2 = uuid(2);
const FOTO_HEX = 'abcdef01-2345-4abc-8def-0123456789ab';
const ISO = '2026-10-27T15:00:00.000Z';
const WELL = '14-0001';

const base = (extra) => Object.assign({ fotoId: FOTO, estado: 'ACTIVA', estadoVinculo: 'CONFIRMADO', wellId: WELL, monitoringId: '' }, extra || {});
let seq;
beforeEach(() => { seq = 0; });
// evento crudo como lo lee el repositorio
const ev = (evento, extra) => {
  seq += 1;
  const e = Object.assign({
    fila: seq + 1, eventoId: uuid(100 + seq), secuencia: seq, evento: evento, fotoId: FOTO, entidadTipo: 'WELL', entidadId: WELL, solicitudId: '', resolucion: '',
    motivoCodigo: '', motivoTexto: '', email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO, clientRequestId: 'req-' + String(seq).padStart(8, '0')
  }, extra || {});
  if ((evento === 'RETIRO_SOLICITADO' || evento === 'RETIRADA') && !('motivoCodigo' in (extra || {}))) { e.motivoCodigo = 'MALA_CALIDAD'; }
  return e;
};
const solicitud = (extra) => ev('RETIRO_SOLICITADO', extra);
const retirada = (extra) => ev('RETIRADA', extra);
const resuelta = (sol, resolucion, extra) => ev('RETIRO_RESUELTO', Object.assign({ solicitudId: sol.eventoId, resolucion: resolucion }, extra || {}));
const repuesta = (extra) => ev('REPUESTA', extra);
const dto = (eventos, b) => M.fotosPozosModeracion_estadoFoto(b || base(), M.fotosPozosModeracion_derivar(eventos));
const codigos = (eventos, b) => dto(eventos, b).inconsistencias;

describe('catalogo y constantes', () => {
  test('los 7 motivos exactos y los 4 eventos', () => {
    expect(M.FOTOS_MOD_MOTIVOS).toEqual(['NO_CORRESPONDE_POZO', 'DUPLICADA', 'MALA_CALIDAD', 'SIN_CONTENIDO_UTIL', 'PRIVACIDAD', 'DESACTUALIZADA', 'OTRO']);
    expect(M.FOTOS_MOD_EVENTOS).toEqual(['RETIRO_SOLICITADO', 'RETIRADA', 'RETIRO_RESUELTO', 'REPUESTA']);
    expect(M.FOTOS_MOD_RESOLUCIONES).toEqual(['APROBADO', 'RECHAZADO']);
    expect(M.FOTOS_MOD_ESTADOS_FOTO).toEqual({ ACTIVA: 'ACTIVA', RETIRADA: 'RETIRADA' });
    expect(M.FOTOS_MOD_ESTADOS_SOLICITUD).toEqual({ ABIERTA: 'ABIERTA', APROBADA: 'APROBADA', RECHAZADA: 'RECHAZADA' });
    expect(M.FOTOS_MOD_ESTADOS_FOTO).not.toHaveProperty('PENDIENTE');
  });
});

describe('motivos', () => {
  test.each(['NO_CORRESPONDE_POZO', 'DUPLICADA', 'MALA_CALIDAD', 'SIN_CONTENIDO_UTIL', 'PRIVACIDAD', 'DESACTUALIZADA'])('%s: valido sin texto', (c) => {
    expect(M.fotosPozosModeracion_validarMotivo(c, undefined)).toEqual({ ok: true, motivoCodigo: c, motivoTexto: '' });
    expect(M.fotosPozosModeracion_validarMotivo(c, null)).toEqual({ ok: true, motivoCodigo: c, motivoTexto: '' });
    expect(M.fotosPozosModeracion_validarMotivo(c, '')).toEqual({ ok: true, motivoCodigo: c, motivoTexto: '' });
    expect(M.fotosPozosModeracion_validarMotivo(c, 'con texto')).toEqual({ ok: true, motivoCodigo: c, motivoTexto: 'con texto' });
  });

  test.each(['no_corresponde_pozo', 'Duplicada', ' PRIVACIDAD', 'PRIVACIDAD ', 'OTRA', 'NO_CORRESPONDE', '', null, undefined, 5, true, {}, ['OTRO']])('codigo invalido (%j): sin "magia" de mayusculas ni espacios', (c) => {
    expect(M.fotosPozosModeracion_validarMotivo(c, 'texto valido')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO' });
  });

  test('OTRO exige texto: ausente, vacio, solo espacios, solo controles -> error; con texto valido -> ok', () => {
    [undefined, null, '', '   ', TAB + LF, ch(0, 1, 2)].forEach((t) => {
      expect(M.fotosPozosModeracion_validarMotivo('OTRO', t)).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    });
    expect(M.fotosPozosModeracion_validarMotivo('OTRO', 'otra razon')).toMatchObject({ ok: true, motivoTexto: 'otra razon' });
  });

  test('largo 2 / 3 / 300 / 301 (en caracteres unicos, despues de normalizar)', () => {
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'ab')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'abc').ok).toBe(true);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'a'.repeat(300)).ok).toBe(true);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'a'.repeat(301))).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
    expect(M.fotosPozosModeracion_validarMotivo('OTRO', 'ab')).toMatchObject({ ok: false });
  });

  test('un emoji cuenta como 1 caracter; 300 emoji entran y 301 no', () => {
    const emoji = String.fromCodePoint(0x1F4A7);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', emoji.repeat(300)).ok).toBe(true);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', emoji.repeat(301)).ok).toBe(false);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', emoji.repeat(3)).ok).toBe(true);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', emoji.repeat(2)).ok).toBe(false);
  });

  test('el texto se normaliza: recorta, CRLF/CR/NEL/LS/PS pasan a LF, el tab a un espacio; multilinea se conserva', () => {
    const t = '  linea1' + CR + LF + 'linea2' + CR + 'linea3' + ch(0x85) + 'linea4' + ch(0x2028) + 'linea5' + ch(0x2029) + 'a' + TAB + 'b  ';
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', t).motivoTexto).toBe('linea1' + LF + 'linea2' + LF + 'linea3' + LF + 'linea4' + LF + 'linea5' + LF + 'a b');
  });

  test('se eliminan controles C0 / C1, DEL, bidi explicitos y BOM; se conservan ZWJ y marcas LRM/RLM', () => {
    const sucio = 'a' + ch(0, 1, 8, 0xB, 0xC, 0xE, 0x1F, 0x7F, 0x84, 0x86, 0x9F) + 'b' + ch(0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069) + 'c' + ch(0xFEFF) + 'd';
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', sucio).motivoTexto).toBe('abcd');
    const conservado = 'a' + ch(0x200D, 0x200C, 0x200E, 0x200F, 0xFE0F) + 'b';
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', conservado).motivoTexto).toBe(conservado);
  });

  test('surrogates sueltos se eliminan; un par valido se conserva', () => {
    const par = String.fromCodePoint(0x1F4A7);
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'ab' + ch(0xD83D) + 'cd').motivoTexto).toBe('abcd');
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'ab' + ch(0xDCA7) + 'cd').motivoTexto).toBe('abcd');
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'ab' + par + 'cd').motivoTexto).toBe('ab' + par + 'cd');
  });

  test('el texto que queda corto tras normalizar es invalido ("a" + controles + "b" = 2 caracteres)', () => {
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', 'a' + ch(0, 1, 2) + 'b')).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
  });

  test.each([[5], [true], [{}], [['abc']]])('motivoTexto que no es string (%j) -> invalido', (t) => {
    expect(M.fotosPozosModeracion_validarMotivo('DUPLICADA', t)).toMatchObject({ ok: false, code: 'INVALID_MOTIVO_TEXTO' });
  });

  test('un texto que empieza con = + - @ queda como texto (no se interpreta)', () => {
    expect(M.fotosPozosModeracion_validarMotivo('OTRO', '=1+1').motivoTexto).toBe('=1+1');
  });

  test('los errores no repiten el contenido', () => {
    const r = M.fotosPozosModeracion_validarMotivo('OTRO', 'zz');
    expect(JSON.stringify(r)).not.toContain('zz');
  });
});

describe('permisos: exactos, por permiso y nunca por nombre ni autoria', () => {
  test('solicitar = fotos_carga === true; retirar / resolver / reponer = fotos_moderar === true', () => {
    expect(M.fotosPozosModeracion_puede('SOLICITAR_RETIRO', { fotos: true, fotos_carga: true })).toBe(true);
    expect(M.fotosPozosModeracion_puede('SOLICITAR_RETIRO', { fotos: true, fotos_moderar: true })).toBe(false);
    ['RETIRAR', 'RESOLVER_RETIRO', 'REPONER'].forEach((a) => {
      expect(M.fotosPozosModeracion_puede(a, { fotos: true, fotos_moderar: true })).toBe(true);
      expect(M.fotosPozosModeracion_puede(a, { fotos_carga: true, fotos: true })).toBe(false);
    });
  });

  test('E8-3: TODAS las acciones exigen ademas fotos === true (sin ver fotos no se solicita ni se modera)', () => {
    ['SOLICITAR_RETIRO', 'RETIRAR', 'RESOLVER_RETIRO', 'REPONER'].forEach((a) => {
      expect(M.fotosPozosModeracion_puede(a, { fotos_carga: true, fotos_moderar: true })).toBe(false);
      expect(M.fotosPozosModeracion_puede(a, { fotos: false, fotos_carga: true, fotos_moderar: true })).toBe(false);
      expect(M.fotosPozosModeracion_puede(a, { fotos: 'SI', fotos_carga: true, fotos_moderar: true })).toBe(false);
      expect(M.fotosPozosModeracion_puede(a, { fotos: true, fotos_carga: true, fotos_moderar: true })).toBe(true);
    });
  });

  test.each([['SI'], [1], ['true'], [{}], [[]], [2], [null], [undefined], [false], [0]])('valor truthy/invalido (%j) no habilita ninguna accion', (v) => {
    ['SOLICITAR_RETIRO', 'RETIRAR', 'RESOLVER_RETIRO', 'REPONER'].forEach((a) => {
      expect(M.fotosPozosModeracion_puede(a, { fotos_carga: v, fotos_moderar: v, fotos: v })).toBe(false);
    });
  });

  test('permisos ausentes / no objeto / accion desconocida -> false', () => {
    [undefined, null, 'x', 5, []].forEach((p) => { expect(M.fotosPozosModeracion_puede('RETIRAR', p)).toBe(false); });
    expect(M.fotosPozosModeracion_puede('BORRAR', { fotos: true, fotos_moderar: true, fotos_carga: true })).toBe(false);
    expect(M.fotosPozosModeracion_puede(undefined, { fotos: true, fotos_moderar: true })).toBe(false);
  });
});

describe('baseline legacy', () => {
  test('ACTIVA sin eventos -> ACTIVA y visible', () => {
    expect(dto([])).toEqual({
      fotoId: FOTO, estado: 'ACTIVA', visible: true, solicitudAbierta: null, puedeReponerse: false, requiereRevisionBorrado: false, integridad: 'OK', origenRetiro: null, inconsistencias: []
    });
  });

  test('OCULTA sin eventos -> RETIRADA (origen LEGACY_OCULTA), no visible, no reponible', () => {
    expect(dto([], base({ estado: 'OCULTA' }))).toMatchObject({ estado: 'RETIRADA', visible: false, origenRetiro: 'LEGACY_OCULTA', puedeReponerse: false, integridad: 'OK' });
  });

  test('vinculo sin confirmar: no visible aunque este ACTIVA', () => {
    ['POR_REVISAR', '', 'confirmado', 'PENDIENTE'].forEach((v) => {
      expect(dto([], base({ estadoVinculo: v })).visible).toBe(false);
    });
    expect(dto([], base({ estadoVinculo: 'POR_REVISAR' })).estado).toBe('ACTIVA');
  });

  test.each([[''], ['activa'], ['Activa'], ['PENDIENTE'], ['RETIRADA'], [null], [undefined], [5]])('baseline desconocido (%j) -> NO_DERIVABLE y no visible', (e) => {
    expect(dto([], base({ estado: e }))).toMatchObject({ estado: null, visible: false, integridad: 'NO_DERIVABLE', inconsistencias: ['BASELINE_DESCONOCIDO'] });
  });

  test('un espacio alrededor del estado base se tolera (la hoja lo recorta), pero nada mas', () => {
    expect(dto([], base({ estado: ' ACTIVA ' })).visible).toBe(true);
  });

  test('foto sin id valido -> NO_DERIVABLE', () => {
    [undefined, '', 'abc', 5, null].forEach((id) => {
      expect(dto([], base({ fotoId: id }))).toMatchObject({ visible: false, integridad: 'NO_DERIVABLE', inconsistencias: ['FOTO_ID_INVALIDO'] });
    });
  });

  test('un id en mayuscula se compara en minuscula', () => {
    const e = retirada({ fotoId: FOTO_HEX });
    expect(dto([e], base({ fotoId: FOTO_HEX.toUpperCase() }))).toMatchObject({ estado: 'RETIRADA', fotoId: FOTO_HEX });
    expect(dto([retirada({ fotoId: FOTO_HEX.toUpperCase() })], base({ fotoId: FOTO_HEX })).estado).toBe('RETIRADA');
  });

  test('la visibilidad sin eventos coincide con fotosPozosRepository_esVisible para todas las combinaciones de baseline', () => {
    const estados = ['ACTIVA', 'OCULTA', '', 'activa', 'OTRA'];
    const vinculos = ['CONFIRMADO', 'POR_REVISAR', '', 'confirmado'];
    estados.forEach((e) => vinculos.forEach((v) => {
      const b = base({ estado: e, estadoVinculo: v });
      expect(M.fotosPozosModeracion_visible(b, M.fotosPozosModeracion_derivar([]))).toBe(fotosPozosRepository_esVisible(b));
    }));
  });

  test('sin derivacion (null / invalida) la foto NO es visible: fail-closed', () => {
    [null, undefined, {}, { porFoto: null }, 'x', { porFoto: 5 }].forEach((d) => {
      expect(M.fotosPozosModeracion_visible(base(), d)).toBe(false);
      expect(M.fotosPozosModeracion_estadoFoto(base(), d)).toMatchObject({ integridad: 'NO_DERIVABLE', estado: null, inconsistencias: ['DERIVACION_NO_DISPONIBLE'] });
    });
  });
});

describe('solicitudes', () => {
  test('una solicitud abierta NO oculta la foto: sigue ACTIVA y visible, con la solicitud abierta', () => {
    const s = solicitud({ motivoCodigo: 'DUPLICADA' });
    expect(dto([s])).toMatchObject({ estado: 'ACTIVA', visible: true, solicitudAbierta: { solicitudId: s.eventoId, motivoCodigo: 'DUPLICADA' }, integridad: 'OK' });
  });

  test('rechazada: la foto permanece ACTIVA y ya no hay solicitud abierta', () => {
    const s = solicitud();
    expect(dto([s, resuelta(s, 'RECHAZADO')])).toMatchObject({ estado: 'ACTIVA', visible: true, solicitudAbierta: null, integridad: 'OK' });
  });

  test('aprobada: la foto queda RETIRADA y no visible, reponible', () => {
    const s = solicitud();
    expect(dto([s, resuelta(s, 'APROBADO')])).toMatchObject({ estado: 'RETIRADA', visible: false, solicitudAbierta: null, puedeReponerse: true, origenRetiro: 'EVENTO' });
  });

  test('dos solicitudes abiertas a la vez -> NO_DERIVABLE', () => {
    expect(dto([solicitud(), solicitud()])).toMatchObject({ integridad: 'NO_DERIVABLE', visible: false, estado: null, inconsistencias: ['SOLICITUD_ABIERTA_DUPLICADA'] });
  });

  test('solicitud sobre una foto ya retirada -> NO_DERIVABLE', () => {
    expect(codigos([retirada(), solicitud()])).toEqual(['SOLICITUD_SOBRE_FOTO_RETIRADA']);
  });

  test('despues de resolver se puede pedir otra solicitud (ciclo)', () => {
    const s1 = solicitud();
    const r1 = resuelta(s1, 'RECHAZADO');
    const s2 = solicitud();
    expect(dto([s1, r1, s2])).toMatchObject({ integridad: 'OK', solicitudAbierta: { solicitudId: s2.eventoId } });
  });

  test('la solicitud abierta con el baseline OCULTA no cambia la visibilidad (sigue oculta)', () => {
    expect(dto([solicitud()], base({ estado: 'OCULTA' }))).toMatchObject({ visible: false, estado: 'RETIRADA', origenRetiro: 'LEGACY_OCULTA' });
  });
});

describe('retiro directo y PRIVACIDAD', () => {
  test('RETIRADA -> RETIRADA, no visible, reponible, sin solicitud', () => {
    expect(dto([retirada()])).toMatchObject({ estado: 'RETIRADA', visible: false, puedeReponerse: true, origenRetiro: 'EVENTO', requiereRevisionBorrado: false });
  });

  test('doble retiro -> NO_DERIVABLE', () => {
    expect(codigos([retirada(), retirada()])).toEqual(['RETIRO_DOBLE']);
  });

  test('retiro directo con una solicitud abierta -> NO_DERIVABLE (hay que resolverla)', () => {
    expect(codigos([solicitud(), retirada()])).toEqual(['RETIRO_CON_SOLICITUD_ABIERTA']);
  });

  test('PRIVACIDAD (directa o por solicitud aprobada): retirada y requiereRevisionBorrado = true; NO se borra nada', () => {
    expect(dto([retirada({ motivoCodigo: 'PRIVACIDAD' })])).toMatchObject({ estado: 'RETIRADA', visible: false, requiereRevisionBorrado: true });
    const s = solicitud({ motivoCodigo: 'PRIVACIDAD' });
    expect(dto([s, resuelta(s, 'APROBADO')]).requiereRevisionBorrado).toBe(true);
    expect(dto([solicitud({ motivoCodigo: 'PRIVACIDAD' })]).requiereRevisionBorrado).toBe(false);
  });

  test('otros motivos no encienden requiereRevisionBorrado; reponer lo apaga', () => {
    ['DUPLICADA', 'MALA_CALIDAD', 'NO_CORRESPONDE_POZO', 'SIN_CONTENIDO_UTIL', 'DESACTUALIZADA'].forEach((m) => {
      expect(dto([retirada({ motivoCodigo: m })]).requiereRevisionBorrado).toBe(false);
    });
    expect(dto([retirada({ motivoCodigo: 'PRIVACIDAD' }), repuesta()]).requiereRevisionBorrado).toBe(false);
  });

  test('OTRO con texto es valido y retira', () => {
    expect(dto([retirada({ motivoCodigo: 'OTRO', motivoTexto: 'razon' })]).estado).toBe('RETIRADA');
  });
});

describe('reposicion', () => {
  test('retirada por eventos -> REPUESTA -> ACTIVA, visible y otra vez retirable', () => {
    expect(dto([retirada(), repuesta()])).toMatchObject({ estado: 'ACTIVA', visible: true, puedeReponerse: false, origenRetiro: null });
    expect(dto([retirada(), repuesta(), retirada()]).estado).toBe('RETIRADA');
  });

  test('doble reposicion -> NO_DERIVABLE', () => {
    expect(codigos([retirada(), repuesta(), repuesta()])).toEqual(['REPOSICION_INVALIDA']);
  });

  test('reposicion sin retiro -> NO_DERIVABLE', () => {
    expect(codigos([repuesta()])).toEqual(['REPOSICION_INVALIDA']);
  });

  test('OCULTA legacy: NO se repone automaticamente (ni con eventos validos de retiro + reposicion)', () => {
    expect(dto([], base({ estado: 'OCULTA' })).puedeReponerse).toBe(false);
    expect(dto([retirada()], base({ estado: 'OCULTA' }))).toMatchObject({ puedeReponerse: false, origenRetiro: 'LEGACY_OCULTA', visible: false });
    expect(dto([retirada(), repuesta()], base({ estado: 'OCULTA' }))).toMatchObject({ estado: 'RETIRADA', visible: false, origenRetiro: 'LEGACY_OCULTA', puedeReponerse: false });
    expect(dto([repuesta()], base({ estado: 'OCULTA' })).visible).toBe(false);
  });

  test('la foto retirada por solicitud aprobada tambien se repone', () => {
    const s = solicitud();
    expect(dto([s, resuelta(s, 'APROBADO'), repuesta()])).toMatchObject({ estado: 'ACTIVA', visible: true });
  });
});

describe('integridad: fail-closed, sin inventar estado', () => {
  const noDerivable = (eventos, codigo, b) => {
    const d = dto(eventos, b);
    expect(d).toMatchObject({ integridad: 'NO_DERIVABLE', visible: false, estado: null, puedeReponerse: false, solicitudAbierta: null });
    if (codigo) { expect(d.inconsistencias).toContain(codigo); }
  };

  test('secuencia duplicada afecta a las fotos involucradas y a ninguna otra', () => {
    const a = retirada({ secuencia: 7 });
    const b = retirada({ fotoId: FOTO2, secuencia: 7, entidadId: '14-0002' });
    const c = retirada({ fotoId: uuid(3), entidadId: '14-0003' });
    const der = M.fotosPozosModeracion_derivar([a, b, c]);
    expect(M.fotosPozosModeracion_estadoFoto(base(), der)).toMatchObject({ integridad: 'NO_DERIVABLE', inconsistencias: ['SECUENCIA_DUPLICADA'] });
    expect(M.fotosPozosModeracion_estadoFoto(base({ fotoId: FOTO2, wellId: '14-0002' }), der).integridad).toBe('NO_DERIVABLE');
    expect(M.fotosPozosModeracion_estadoFoto(base({ fotoId: uuid(3), wellId: '14-0003' }), der)).toMatchObject({ integridad: 'OK', estado: 'RETIRADA' });
  });

  test.each([[1.5], [0], [-3], ['x'], [''], [null], [undefined], [NaN], [Infinity]])('secuencia invalida (%j) -> NO_DERIVABLE', (s) => {
    noDerivable([retirada({ secuencia: s })], 'SECUENCIA_INVALIDA');
  });

  test('una secuencia como texto de solo digitos se acepta (Sheets puede devolver texto)', () => {
    expect(dto([retirada({ secuencia: '7' })]).estado).toBe('RETIRADA');
  });

  test('resolucion huerfana (solicitud inexistente) -> NO_DERIVABLE', () => {
    noDerivable([ev('RETIRO_RESUELTO', { solicitudId: uuid(999), resolucion: 'APROBADO' })], 'RESOLUCION_HUERFANA');
  });

  test('resolucion de algo que no es una solicitud (apunta a una RETIRADA) -> huerfana', () => {
    const r = retirada();
    noDerivable([r, ev('RETIRO_RESUELTO', { solicitudId: r.eventoId, resolucion: 'APROBADO' })], 'RESOLUCION_HUERFANA');
  });

  test('doble resolucion (iguales o incompatibles) -> NO_DERIVABLE', () => {
    const s = solicitud();
    noDerivable([s, resuelta(s, 'APROBADO'), resuelta(s, 'APROBADO')], 'RESOLUCION_DOBLE');
    noDerivable([solicitud({ eventoId: uuid(500) }), resuelta({ eventoId: uuid(500) }, 'APROBADO'), resuelta({ eventoId: uuid(500) }, 'RECHAZADO')], 'RESOLUCION_DOBLE');
  });

  test('la resolucion de una solicitud de OTRA foto afecta a ambas', () => {
    const s = solicitud({ fotoId: FOTO2, entidadId: '14-0002' });
    const r = ev('RETIRO_RESUELTO', { fotoId: FOTO, solicitudId: s.eventoId, resolucion: 'APROBADO' });
    const der = M.fotosPozosModeracion_derivar([s, r]);
    expect(M.fotosPozosModeracion_estadoFoto(base(), der)).toMatchObject({ integridad: 'NO_DERIVABLE', visible: false });
    expect(M.fotosPozosModeracion_estadoFoto(base({ fotoId: FOTO2, wellId: '14-0002' }), der)).toMatchObject({ integridad: 'NO_DERIVABLE', visible: false });
  });

  test('resolucion con entidad distinta a la de la solicitud -> NO_DERIVABLE', () => {
    const s = solicitud();
    noDerivable([s, resuelta(s, 'APROBADO', { entidadId: '14-0009' })], 'RESOLUCION_OTRA_FOTO');
  });

  test('resolucion anterior (por secuencia) a su solicitud -> NO_DERIVABLE', () => {
    const s = solicitud({ secuencia: 10 });
    noDerivable([s, resuelta(s, 'APROBADO', { secuencia: 3 })], 'RESOLUCION_ANTERIOR_A_SOLICITUD');
  });

  test.each([['borrada'], ['retirada'], ['Retirada'], [''], ['BORRADA'], ['PUBLICAR']])('evento desconocido (%j) con foto valida -> esa foto NO_DERIVABLE', (e) => {
    noDerivable([ev(e || 'X', { evento: e })], 'EVENTO_DESCONOCIDO');
  });

  test('un evento desconocido SIN foto valida no afecta a ninguna foto (solo diagnostico)', () => {
    const der = M.fotosPozosModeracion_derivar([ev('X', { evento: 'BORRADA', fotoId: 'no-es-uuid' })]);
    expect(der.globales).toEqual([{ codigo: 'FOTO_ID_INVALIDO', fila: 2 }]);
    expect(M.fotosPozosModeracion_estadoFoto(base(), der).visible).toBe(true);
  });

  test('eventoId duplicado (aun identico) -> NO_DERIVABLE', () => {
    const a = retirada({ eventoId: uuid(777) });
    const b = retirada({ eventoId: uuid(777) });
    noDerivable([a, b], 'EVENTO_ID_DUPLICADO');
  });

  test('eventoId invalido (no UUID) -> NO_DERIVABLE', () => {
    noDerivable([retirada({ eventoId: 'abc' })], 'ID_INVALIDO');
  });

  test('entidad de los eventos distinta de la de la foto -> NO_DERIVABLE', () => {
    noDerivable([retirada({ entidadId: '14-0099' })], 'ENTIDAD_NO_COINCIDE');
    noDerivable([retirada({ entidadTipo: 'MONITORING', entidadId: 'INA 536' })], 'ENTIDAD_NO_COINCIDE');
  });

  test('eventos de una misma foto con entidades distintas entre si -> NO_DERIVABLE', () => {
    noDerivable([retirada(), repuesta({ entidadId: '14-0002' })], 'ENTIDAD_INCONSISTENTE_EN_EVENTOS');
  });

  test.each([['NADA'], [''], ['well'], [null]])('entidadTipo invalido (%j) -> NO_DERIVABLE', (t) => {
    noDerivable([retirada({ entidadTipo: t })], 'ENTIDAD_INVALIDA');
  });

  test('motivo invalido en un evento guardado (codigo fuera del catalogo, OTRO sin texto, texto corto o largo) -> NO_DERIVABLE', () => {
    noDerivable([retirada({ motivoCodigo: 'cualquiera' })], 'MOTIVO_INVALIDO');
    noDerivable([retirada({ motivoCodigo: '' })], 'MOTIVO_INVALIDO');
    noDerivable([retirada({ motivoCodigo: 'OTRO', motivoTexto: '' })], 'MOTIVO_INVALIDO');
    noDerivable([retirada({ motivoTexto: 'ab' })], 'MOTIVO_INVALIDO');
    noDerivable([retirada({ motivoTexto: 'a'.repeat(301) })], 'MOTIVO_INVALIDO');
  });

  test('campos incoherentes (resolucion en una RETIRADA, motivo en una REPUESTA, resolucion sin valor) -> NO_DERIVABLE', () => {
    noDerivable([retirada({ resolucion: 'APROBADO' })], 'CAMPOS_INCOHERENTES');
    noDerivable([retirada({ solicitudId: uuid(5) })], 'CAMPOS_INCOHERENTES');
    noDerivable([retirada(), repuesta({ motivoCodigo: 'DUPLICADA' })], 'CAMPOS_INCOHERENTES');
    const s = solicitud();
    noDerivable([s, resuelta(s, 'TAL_VEZ')], 'CAMPOS_INCOHERENTES');
    noDerivable([s, resuelta(s, 'APROBADO', { motivoCodigo: 'DUPLICADA' })], 'CAMPOS_INCOHERENTES');
  });

  test('filas rotas (null, no objeto) no afectan a ninguna foto', () => {
    const der = M.fotosPozosModeracion_derivar([null, 5, 'x', retirada()]);
    expect(der.globales.map((g) => g.codigo)).toEqual(['FILA_ROTA', 'FILA_ROTA', 'FILA_ROTA']);
    expect(M.fotosPozosModeracion_estadoFoto(base(), der).estado).toBe('RETIRADA');
  });

  test('el orden de las filas no importa: manda la secuencia', () => {
    const s = solicitud();
    const r = resuelta(s, 'APROBADO');
    expect(dto([r, s]).estado).toBe('RETIRADA');
    expect(dto([repuesta({ secuencia: 3 }), retirada({ secuencia: 2 })]).estado).toBe('ACTIVA');
  });

  test('un historial roto de UNA foto no oculta a otra foto sana', () => {
    const roto = retirada({ eventoId: 'roto' });
    const sano = retirada({ fotoId: FOTO2, entidadId: '14-0002' });
    const der = M.fotosPozosModeracion_derivar([roto, sano]);
    expect(M.fotosPozosModeracion_estadoFoto(base(), der).integridad).toBe('NO_DERIVABLE');
    expect(M.fotosPozosModeracion_estadoFoto(base({ fotoId: FOTO2, wellId: '14-0002' }), der)).toMatchObject({ integridad: 'OK', estado: 'RETIRADA' });
  });

  test('una foto NO derivable jamas figura como visible, ni siquiera sin retiros (corrupcion no muestra la foto)', () => {
    expect(M.fotosPozosModeracion_visible(base(), M.fotosPozosModeracion_derivar([solicitud(), solicitud()]))).toBe(false);
    expect(M.fotosPozosModeracion_visible(base(), M.fotosPozosModeracion_derivar([retirada({ eventoId: 'x' })]))).toBe(false);
  });

  test('foto con baseline OCULTA y eventos corruptos: sigue no visible y NO_DERIVABLE', () => {
    noDerivable([solicitud(), solicitud()], 'SOLICITUD_ABIERTA_DUPLICADA', base({ estado: 'OCULTA' }));
  });
});

describe('monitoreo NE (entidad sin wellId)', () => {
  const punto = (extra) => base(Object.assign({ wellId: '', monitoringId: 'INA 536' }, extra || {}));
  const mon = { entidadTipo: 'MONITORING', entidadId: 'INA 536' };

  test('la identidad canonica es wellId si lo tiene, si no monitoringId', () => {
    expect(M.fotosPozosModeracion_entidadDeBase(base())).toEqual({ tipo: 'WELL', id: WELL });
    expect(M.fotosPozosModeracion_entidadDeBase(punto())).toEqual({ tipo: 'MONITORING', id: 'INA 536' });
    expect(M.fotosPozosModeracion_entidadDeBase(base({ wellId: WELL, monitoringId: 'INA 536' }))).toEqual({ tipo: 'WELL', id: WELL });
    expect(M.fotosPozosModeracion_entidadDeBase(base({ wellId: '', monitoringId: '' }))).toBeNull();
    expect(M.fotosPozosModeracion_entidadDeBase(base({ wellId: 'malo' }))).toBeNull();
  });

  test('retirar una foto de un punto NE', () => {
    expect(dto([retirada(mon)], punto())).toMatchObject({ estado: 'RETIRADA', visible: false });
  });

  test('un evento WELL sobre una foto de punto NE no coincide', () => {
    expect(dto([retirada()], punto()).inconsistencias).toEqual(['ENTIDAD_NO_COINCIDE']);
  });

  test('una foto sin entidad valida con eventos -> no derivable', () => {
    expect(dto([retirada()], base({ wellId: '', monitoringId: '' })).integridad).toBe('NO_DERIVABLE');
  });
});

describe('solicitudes: vista de moderador y cola', () => {
  test('lista blanca: sin email ni secuencia; nombre neutro si parece un email', () => {
    const s = solicitud({ nombre: 'ana@x.com', motivoCodigo: 'OTRO', motivoTexto: 'razon' });
    const r = resuelta(s, 'APROBADO', { nombre: 'Moderador Uno' });
    const lista = M.fotosPozosModeracion_solicitudes(M.fotosPozosModeracion_derivar([s, r]));
    expect(lista).toEqual([{
      solicitudId: s.eventoId, fotoId: FOTO, entidadTipo: 'WELL', entidadId: WELL, estado: 'APROBADA', motivoCodigo: 'OTRO', motivoTexto: 'razon',
      solicitadaPor: 'Usuario', solicitadaEn: ISO, resolucion: 'APROBADO', resueltaPor: 'Moderador Uno', resueltaEn: ISO
    }]);
    expect(JSON.stringify(lista)).not.toContain('@');
  });

  test('soloAbiertas filtra, ordena por secuencia y excluye fotos no derivables', () => {
    const a = solicitud({ fotoId: FOTO, secuencia: 5 });
    const b = solicitud({ fotoId: FOTO2, entidadId: '14-0002', secuencia: 2 });
    const c = solicitud({ fotoId: uuid(3), entidadId: '14-0003', secuencia: 9 });
    const cr = resuelta(c, 'RECHAZADO', { fotoId: uuid(3), entidadId: '14-0003', secuencia: 10 });
    const rota = solicitud({ fotoId: uuid(4), entidadId: '14-0004', secuencia: 11 });
    const rota2 = solicitud({ fotoId: uuid(4), entidadId: '14-0004', secuencia: 12 });
    const der = M.fotosPozosModeracion_derivar([a, b, c, cr, rota, rota2]);
    expect(M.fotosPozosModeracion_solicitudes(der, { soloAbiertas: true }).map((x) => x.solicitudId)).toEqual([b.eventoId, a.eventoId]);
    expect(M.fotosPozosModeracion_solicitudes(der).map((x) => x.estado)).toEqual(['ABIERTA', 'ABIERTA', 'RECHAZADA']);
    expect(M.fotosPozosModeracion_solicitudes(null)).toEqual([]);
  });
});

describe('privacidad del DTO derivado', () => {
  test('el DTO no trae email, nombre, texto del motivo ni secuencias', () => {
    const s = solicitud({ email: 'secreto@dominio.com', nombre: 'Persona Secreta', motivoCodigo: 'OTRO', motivoTexto: 'detalle privado del motivo' });
    const d = dto([s]);
    const texto = JSON.stringify(d);
    ['secreto@dominio.com', 'Persona Secreta', 'detalle privado', 'clientRequestId', 'req-'].forEach((x) => { expect(texto).not.toContain(x); });
    expect(d.solicitudAbierta).toEqual({ solicitudId: s.eventoId, motivoCodigo: 'OTRO' });
    expect(Object.keys(d).sort()).toEqual(['estado', 'fotoId', 'inconsistencias', 'integridad', 'origenRetiro', 'puedeReponerse', 'requiereRevisionBorrado', 'solicitudAbierta', 'visible']);
  });

  test('la derivacion interna tampoco guarda el email', () => {
    const der = M.fotosPozosModeracion_derivar([solicitud({ email: 'secreto@dominio.com' }), retirada({ fotoId: FOTO2, entidadId: '14-0002', email: 'otro@dominio.com' })]);
    expect(JSON.stringify(der)).not.toContain('@dominio.com');
  });

  test('un fallo de integridad nombra codigos, no contenido', () => {
    const d = dto([retirada({ motivoCodigo: 'OTRO', motivoTexto: '' , email: 'secreto@dominio.com' })]);
    expect(JSON.stringify(d)).not.toContain('secreto');
  });
});

describe('cache: claves a invalidar (E8-3 las integra)', () => {
  test('claves de una foto: metadata, miniatura y resumen; la imagen full no se cachea', () => {
    expect(M.fotosPozosModeracion_clavesCacheAInvalidar(FOTO)).toEqual(['fotospozos_m_' + FOTO, 'fotospozos_t_' + FOTO, 'fotospozos_resumen']);
    expect(M.fotosPozosModeracion_clavesCacheAInvalidar(FOTO.toUpperCase())).toEqual(['fotospozos_m_' + FOTO, 'fotospozos_t_' + FOTO, 'fotospozos_resumen']);
    expect(M.fotosPozosModeracion_clavesCacheAInvalidar('basura')).toEqual(['fotospozos_resumen']);
  });

  test('invalidan: RETIRADA, RETIRO_RESUELTO APROBADO y REPUESTA; no invalidan: solicitud ni rechazo', () => {
    expect(M.fotosPozosModeracion_requiereInvalidarCache({ evento: 'RETIRADA' })).toBe(true);
    expect(M.fotosPozosModeracion_requiereInvalidarCache({ evento: 'REPUESTA' })).toBe(true);
    expect(M.fotosPozosModeracion_requiereInvalidarCache({ evento: 'RETIRO_RESUELTO', resolucion: 'APROBADO' })).toBe(true);
    expect(M.fotosPozosModeracion_requiereInvalidarCache({ evento: 'RETIRO_RESUELTO', resolucion: 'RECHAZADO' })).toBe(false);
    expect(M.fotosPozosModeracion_requiereInvalidarCache({ evento: 'RETIRO_SOLICITADO' })).toBe(false);
    expect(M.fotosPozosModeracion_requiereInvalidarCache(null)).toBe(false);
  });
});

// ---------------------------------------------------------------- comandos: validacion, idempotencia y transiciones

// "hoja" en memoria: aplica el plan como lo hara E8-3 (derivar sobre lo que hay, buscar por usuario + clientRequestId, escribir con secuencia max + 1)
function crearHoja(bases, eventosIniciales) {
  const hoja = { eventos: (eventosIniciales || []).slice(), n: 1000 };
  const mapa = {};
  (bases || [base()]).forEach((b) => { mapa[b.fotoId] = b; });
  hoja.bases = mapa;
  hoja.ejecutar = (comando, actor) => {
    const a = actor || {};
    const email = String(a.email === undefined ? 'ana@x.com' : a.email).toLowerCase();
    const coincidencias = hoja.eventos.filter((e) => e.email === email && e.clientRequestId === comando.clientRequestId);
    const plan = M.fotosPozosModeracion_planificar(comando, {
      autorEmail: a.email === undefined ? 'ana@x.com' : a.email,          // el actor ES el autor de la foto: no le da ningun permiso
      email: a.email === undefined ? 'ana@x.com' : a.email,
      nombre: a.nombre === undefined ? 'Ana' : a.nombre,
      permisos: a.permisos || { fotos: true, fotos_carga: true, fotos_moderar: true },
      ahora: new Date(ISO),
      derivacion: M.fotosPozosModeracion_derivar(hoja.eventos),
      obtenerBase: (id) => hoja.bases[id] || null,
      existentes: { total: coincidencias.length, eventos: coincidencias.slice(0, 2) },
      nuevoEventoId: () => uuid(hoja.n++)
    });
    if (plan.ok && plan.accion === 'ESCRIBIR') {
      const mx = hoja.eventos.reduce((m, e) => Math.max(m, e.secuencia), 0);
      hoja.eventos.push(Object.assign({ fila: hoja.eventos.length + 2, secuencia: mx + 1 }, plan.evento));
    }
    return plan;
  };
  hoja.estado = (fotoId) => M.fotosPozosModeracion_estadoFoto(hoja.bases[fotoId || FOTO], M.fotosPozosModeracion_derivar(hoja.eventos));
  return hoja;
}
const MODERADOR = { email: 'mod@x.com', nombre: 'Moderador', permisos: { fotos: true, fotos_moderar: true } };
const CARGA = { email: 'ana@x.com', nombre: 'Ana', permisos: { fotos: true, fotos_carga: true } };
const cmd = (accion, extra) => Object.assign({ accion: accion, fotoId: FOTO, clientRequestId: 'crid-' + Math.random().toString(36).slice(2, 12) + 'xxxx' }, extra || {});
const MOT = { motivoCodigo: 'DUPLICADA' };

describe('validar comando', () => {
  const ok = (d) => M.fotosPozosModeracion_validarComando(d);
  const CRID = 'abcdefgh';

  test('acciones validas y campos de cada una', () => {
    expect(ok({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID })).toEqual({ ok: true, valores: { accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'DUPLICADA', motivoTexto: '', clientRequestId: CRID } });
    expect(ok({ accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'OTRO', motivoTexto: ' texto ', clientRequestId: CRID }).valores.motivoTexto).toBe('texto');
    expect(ok({ accion: 'RESOLVER_RETIRO', solicitudId: uuid(5), resolucion: 'APROBADO', clientRequestId: CRID })).toEqual({ ok: true, valores: { accion: 'RESOLVER_RETIRO', solicitudId: uuid(5), resolucion: 'APROBADO', clientRequestId: CRID } });
    expect(ok({ accion: 'REPONER', fotoId: FOTO, clientRequestId: CRID })).toEqual({ ok: true, valores: { accion: 'REPONER', fotoId: FOTO, clientRequestId: CRID } });
  });

  test.each([[undefined], [null], [''], ['retirar'], ['BORRAR'], [5], ['toString'], ['constructor']])('accion invalida (%j)', (a) => {
    expect(ok({ accion: a, fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID })).toMatchObject({ ok: false, code: 'INVALID_ACCION' });
  });

  test.each([[undefined], [null], [''], ['corto'], ['con espacio 12'], ['a'.repeat(65)], [12345678], ['mala;clave']])('clientRequestId invalido (%j)', (c) => {
    expect(ok({ accion: 'REPONER', fotoId: FOTO, clientRequestId: c })).toMatchObject({ ok: false, code: 'INVALID_CLIENT_REQUEST_ID' });
  });

  test('clientRequestId de 8 y 64 caracteres validos', () => {
    expect(ok({ accion: 'REPONER', fotoId: FOTO, clientRequestId: 'a'.repeat(8) }).ok).toBe(true);
    expect(ok({ accion: 'REPONER', fotoId: FOTO, clientRequestId: 'A_-9'.repeat(16) }).ok).toBe(true);
  });

  test.each([[undefined], [''], ['abc'], [5], [uuid(1).slice(1)]])('fotoId invalido (%j)', (f) => {
    expect(ok({ accion: 'RETIRAR', fotoId: f, motivoCodigo: 'DUPLICADA', clientRequestId: CRID })).toMatchObject({ ok: false, code: 'INVALID_FOTO_ID' });
  });

  test('un fotoId en mayuscula se normaliza a minuscula', () => {
    expect(ok({ accion: 'REPONER', fotoId: FOTO.toUpperCase().replace('0000', '0000'), clientRequestId: CRID }).valores.fotoId).toBe(FOTO);
  });

  test('resolver: solicitudId y resolucion exactos; sin foto ni motivo (la foto sale de la solicitud)', () => {
    expect(ok({ accion: 'RESOLVER_RETIRO', solicitudId: 'x', resolucion: 'APROBADO', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_SOLICITUD_ID' });
    ['aprobado', 'OTRO', '', undefined].forEach((r) => {
      expect(ok({ accion: 'RESOLVER_RETIRO', solicitudId: uuid(5), resolucion: r, clientRequestId: CRID })).toMatchObject({ code: 'INVALID_RESOLUCION' });
    });
    expect(ok({ accion: 'RESOLVER_RETIRO', solicitudId: uuid(5), resolucion: 'APROBADO', fotoId: FOTO, clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(ok({ accion: 'RESOLVER_RETIRO', solicitudId: uuid(5), resolucion: 'RECHAZADO', motivoCodigo: 'DUPLICADA', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  test('campos de otra accion se RECHAZAN (no se ignoran): solicitudId / resolucion en retirar; motivo en reponer', () => {
    expect(ok({ accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'DUPLICADA', resolucion: 'APROBADO', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(ok({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'DUPLICADA', solicitudId: uuid(5), clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(ok({ accion: 'REPONER', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(ok({ accion: 'REPONER', fotoId: FOTO, motivoTexto: 'abc', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_REQUEST' });
  });

  test('retirar / solicitar exigen motivo del catalogo', () => {
    expect(ok({ accion: 'RETIRAR', fotoId: FOTO, clientRequestId: CRID })).toMatchObject({ code: 'INVALID_MOTIVO' });
    expect(ok({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'OTRO', clientRequestId: CRID })).toMatchObject({ code: 'INVALID_MOTIVO_TEXTO' });
  });

  test('datos que no son un objeto -> INVALID_ACCION', () => {
    [null, undefined, 'x', 5].forEach((d) => { expect(ok(d)).toMatchObject({ ok: false, code: 'INVALID_ACCION' }); });
  });
});

describe('planificar: permisos y autoria', () => {
  test('sin permiso: PERMISSION_DENIED y no se escribe nada', () => {
    const h = crearHoja();
    expect(h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), { permisos: { fotos: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.ejecutar(cmd('RETIRAR', MOT), { permisos: { fotos_carga: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.eventos).toHaveLength(0);
  });

  test('el AUTOR de la foto no puede retirarla directo por ser autor (solo solicitar, como cualquiera con fotos_carga)', () => {
    const h = crearHoja([base({ emailUsuarioCarga: 'ana@x.com' })]);
    expect(h.ejecutar(cmd('RETIRAR', MOT), { email: 'ana@x.com', permisos: { fotos: true, fotos_carga: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), { email: 'ana@x.com', permisos: { fotos: true, fotos_carga: true } })).toMatchObject({ ok: true, accion: 'ESCRIBIR' });
  });

  test('ser el autor no habilita ni RETIRAR, ni RESOLVER ni REPONER (solo solicitar)', () => {
    const h = crearHoja();
    const comoAutor = { email: 'ana@x.com', permisos: { fotos: true, fotos_carga: true } };
    h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), comoAutor);
    expect(h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: h.eventos[0].eventoId, resolucion: 'APROBADO', clientRequestId: 'autor-000001' }, comoAutor)).toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(h.ejecutar(cmd('REPONER'), comoAutor)).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('el nombre no autoriza: un nombre "Moderador" sin permiso no puede retirar', () => {
    const h = crearHoja();
    expect(h.ejecutar(cmd('RETIRAR', MOT), { nombre: 'Moderador', permisos: { fotos: true, fotos_moderar: 'SI' } })).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('E8-3: sin fotos === true nadie solicita ni modera, aunque tenga fotos_carga / fotos_moderar', () => {
    const h = crearHoja();
    expect(h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), { permisos: { fotos: false, fotos_carga: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.ejecutar(cmd('RETIRAR', MOT), { permisos: { fotos: false, fotos_moderar: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.ejecutar(cmd('RETIRAR', MOT), { permisos: { fotos_moderar: true } })).toMatchObject({ ok: false, code: 'PERMISSION_DENIED' });
    expect(h.eventos).toHaveLength(0);
  });

  test('un moderador sin fotos_carga no puede solicitar (usa el retiro directo)', () => {
    expect(crearHoja().ejecutar(cmd('SOLICITAR_RETIRO', MOT), MODERADOR)).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('la validacion de la entrada va ANTES que el permiso y que cualquier lectura', () => {
    const h = crearHoja();
    expect(h.ejecutar({ accion: 'RETIRAR', fotoId: FOTO, clientRequestId: 'corto' }, { permisos: {} })).toMatchObject({ code: 'INVALID_CLIENT_REQUEST_ID' });
  });

  test('email de sesion ausente o invalido -> INVALID_REQUEST', () => {
    ['', 'sin-arroba', null].forEach((email) => {
      expect(crearHoja().ejecutar(cmd('RETIRAR', MOT), { email: email, permisos: { fotos: true, fotos_moderar: true } })).toMatchObject({ ok: false, code: 'INVALID_REQUEST' });
    });
  });
});

describe('planificar: solicitar retiro', () => {
  test('escribe RETIRO_SOLICITADO con foto y entidad de la FOTO, actor y timestamp; no invalida cache; no oculta', () => {
    const h = crearHoja();
    const r = h.ejecutar(cmd('SOLICITAR_RETIRO', { motivoCodigo: 'OTRO', motivoTexto: ' razon ' }), CARGA);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', invalidaCache: false });
    expect(r.evento).toMatchObject({
      evento: 'RETIRO_SOLICITADO', fotoId: FOTO, entidadTipo: 'WELL', entidadId: WELL, solicitudId: '', resolucion: '', motivoCodigo: 'OTRO', motivoTexto: 'razon',
      email: 'ana@x.com', nombre: 'Ana', timestampUtc: ISO
    });
    expect(h.estado()).toMatchObject({ estado: 'ACTIVA', visible: true, solicitudAbierta: { motivoCodigo: 'OTRO' } });
  });

  test('segunda solicitud con la solicitud abierta -> SOLICITUD_YA_ABIERTA (otro clientRequestId)', () => {
    const h = crearHoja();
    h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), CARGA);
    expect(h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), { email: 'otro@x.com', permisos: CARGA.permisos })).toMatchObject({ ok: false, code: 'SOLICITUD_YA_ABIERTA' });
    expect(h.eventos).toHaveLength(1);
  });

  test('NO ORACULO: inexistente, oculta (legacy), retirada, no derivable y vinculo sin confirmar dan el MISMO error', () => {
    const ocultas = base({ fotoId: uuid(20), estado: 'OCULTA', wellId: '14-0020' });
    const sinVinculo = base({ fotoId: uuid(21), estadoVinculo: 'POR_REVISAR', wellId: '14-0021' });
    const retiradaB = base({ fotoId: uuid(22), wellId: '14-0022' });
    const rota = base({ fotoId: uuid(23), wellId: '14-0023' });
    const h = crearHoja([ocultas, sinVinculo, retiradaB, rota, base()], [
      retirada({ fotoId: uuid(22), entidadId: '14-0022' }),
      retirada({ fotoId: uuid(23), entidadId: '14-0023', eventoId: 'roto' })
    ]);
    const resultados = [uuid(999), ocultas.fotoId, sinVinculo.fotoId, retiradaB.fotoId, rota.fotoId].map((id) => h.ejecutar(cmd('SOLICITAR_RETIRO', Object.assign({ fotoId: id }, MOT)), CARGA));
    resultados.forEach((r) => { expect(r).toEqual({ ok: false, code: 'FOTO_NOT_FOUND', message: 'no existe la foto' }); });
  });

  test('motivo invalido: no se escribe', () => {
    const h = crearHoja();
    expect(h.ejecutar(cmd('SOLICITAR_RETIRO', { motivoCodigo: 'otro' }), CARGA)).toMatchObject({ code: 'INVALID_MOTIVO' });
    expect(h.eventos).toHaveLength(0);
  });

  test('PRIVACIDAD en una solicitud no oculta nada ni invalida cache', () => {
    const h = crearHoja();
    const r = h.ejecutar(cmd('SOLICITAR_RETIRO', { motivoCodigo: 'PRIVACIDAD' }), CARGA);
    expect(r.invalidaCache).toBe(false);
    expect(h.estado().visible).toBe(true);
  });
});

describe('planificar: retiro directo', () => {
  test('escribe RETIRADA con motivo, actor, timestamp y clientRequestId; invalida cache; la foto sale de la galeria', () => {
    const h = crearHoja();
    const c = cmd('RETIRAR', { motivoCodigo: 'NO_CORRESPONDE_POZO' });
    const r = h.ejecutar(c, MODERADOR);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', invalidaCache: true });
    expect(r.evento).toMatchObject({ evento: 'RETIRADA', fotoId: FOTO, motivoCodigo: 'NO_CORRESPONDE_POZO', email: 'mod@x.com', nombre: 'Moderador', timestampUtc: ISO, clientRequestId: c.clientRequestId });
    expect(h.estado()).toMatchObject({ estado: 'RETIRADA', visible: false });
  });

  test('doble retiro (otro clientRequestId) -> FOTO_YA_RETIRADA', () => {
    const h = crearHoja();
    h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    expect(h.ejecutar(cmd('RETIRAR', MOT), MODERADOR)).toMatchObject({ ok: false, code: 'FOTO_YA_RETIRADA' });
    expect(h.eventos).toHaveLength(1);
  });

  test('retiro + retry exacto: el mismo clientRequestId devuelve el evento original, sin escribir otro', () => {
    const h = crearHoja();
    const c = cmd('RETIRAR', MOT);
    const a = h.ejecutar(c, MODERADOR);
    const b = h.ejecutar(c, MODERADOR);
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO', invalidaCache: false });
    expect(b.evento.eventoId).toBe(a.evento.eventoId);
    expect(h.eventos).toHaveLength(1);
  });

  test('un retiro sobre una foto ya OCULTA (legacy) -> FOTO_YA_RETIRADA', () => {
    const h = crearHoja([base({ estado: 'OCULTA' })]);
    expect(h.ejecutar(cmd('RETIRAR', MOT), MODERADOR)).toMatchObject({ code: 'FOTO_YA_RETIRADA' });
  });

  test('con una solicitud abierta hay que resolverla: SOLICITUD_ABIERTA', () => {
    const h = crearHoja();
    h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), CARGA);
    expect(h.ejecutar(cmd('RETIRAR', MOT), MODERADOR)).toMatchObject({ code: 'SOLICITUD_ABIERTA' });
  });

  test('foto inexistente -> FOTO_NOT_FOUND; historial no derivable -> ESTADO_NO_DERIVABLE (el moderador SI ve la diferencia)', () => {
    const h = crearHoja([base()], [retirada({ eventoId: 'roto' })]);
    expect(h.ejecutar(cmd('RETIRAR', Object.assign({ fotoId: uuid(77) }, MOT)), MODERADOR)).toMatchObject({ code: 'FOTO_NOT_FOUND' });
    expect(h.ejecutar(cmd('RETIRAR', MOT), MODERADOR)).toMatchObject({ code: 'ESTADO_NO_DERIVABLE' });
  });

  test('PRIVACIDAD: se retira y se enciende la senal; el plan no toca el storage', () => {
    const h = crearHoja();
    expect(h.ejecutar(cmd('RETIRAR', { motivoCodigo: 'PRIVACIDAD' }), MODERADOR)).toMatchObject({ ok: true, invalidaCache: true });
    expect(h.estado()).toMatchObject({ visible: false, requiereRevisionBorrado: true });
  });

  test('foto de un punto NE: la entidad del evento es MONITORING', () => {
    const b = base({ wellId: '', monitoringId: 'INA 536' });
    const h = crearHoja([b]);
    const r = h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    expect(r.evento).toMatchObject({ entidadTipo: 'MONITORING', entidadId: 'INA 536' });
    expect(h.estado().estado).toBe('RETIRADA');
  });
});

describe('planificar: resolver solicitud', () => {
  const abierta = () => {
    const h = crearHoja();
    const s = h.ejecutar(cmd('SOLICITAR_RETIRO', { motivoCodigo: 'MALA_CALIDAD' }), CARGA);
    return { h: h, id: s.evento.eventoId };
  };

  test('APROBADO: usa la foto y la entidad de la SOLICITUD (no las del cliente), invalida cache y la foto queda retirada', () => {
    const { h, id } = abierta();
    const r = h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'resolver-0001' }, MODERADOR);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', invalidaCache: true });
    expect(r.evento).toMatchObject({ evento: 'RETIRO_RESUELTO', solicitudId: id, resolucion: 'APROBADO', fotoId: FOTO, entidadTipo: 'WELL', entidadId: WELL, motivoCodigo: '', motivoTexto: '' });
    expect(h.estado()).toMatchObject({ estado: 'RETIRADA', visible: false, solicitudAbierta: null });
  });

  test('RECHAZADO: la foto sigue ACTIVA, no invalida cache', () => {
    const { h, id } = abierta();
    const r = h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'RECHAZADO', clientRequestId: 'resolver-0002' }, MODERADOR);
    expect(r).toMatchObject({ ok: true, invalidaCache: false });
    expect(h.estado()).toMatchObject({ estado: 'ACTIVA', visible: true, solicitudAbierta: null });
  });

  test('resolver otra vez (otro clientRequestId) -> SOLICITUD_YA_RESUELTA; el retry exacto -> REINTENTO', () => {
    const { h, id } = abierta();
    const c = { accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'resolver-0003' };
    h.ejecutar(c, MODERADOR);
    expect(h.ejecutar(Object.assign({}, c, { clientRequestId: 'resolver-0004' }), MODERADOR)).toMatchObject({ code: 'SOLICITUD_YA_RESUELTA' });
    expect(h.ejecutar(c, MODERADOR)).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(h.eventos).toHaveLength(2);
  });

  test('dos moderadores resuelven la misma solicitud: gana uno, el otro recibe SOLICITUD_YA_RESUELTA', () => {
    const { h, id } = abierta();
    const a = h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'mod-a-0001' }, { email: 'm1@x.com', nombre: 'M1', permisos: { fotos: true, fotos_moderar: true } });
    const b = h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'RECHAZADO', clientRequestId: 'mod-b-0001' }, { email: 'm2@x.com', nombre: 'M2', permisos: { fotos: true, fotos_moderar: true } });
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, code: 'SOLICITUD_YA_RESUELTA' });
  });

  test('solicitud inexistente -> SOLICITUD_NOT_FOUND; de una foto no derivable -> ESTADO_NO_DERIVABLE', () => {
    const { h, id } = abierta();
    expect(h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: uuid(4242), resolucion: 'APROBADO', clientRequestId: 'resolver-0005' }, MODERADOR)).toMatchObject({ code: 'SOLICITUD_NOT_FOUND' });
    h.eventos.push(Object.assign({}, h.eventos[0], { eventoId: uuid(3001), secuencia: 50, evento: 'RETIRADA', motivoCodigo: 'DUPLICADA', clientRequestId: 'otro-12345' }));
    expect(h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'resolver-0006' }, MODERADOR)).toMatchObject({ code: 'ESTADO_NO_DERIVABLE' });
  });

  test('solo un moderador resuelve; sin permiso no se escribe', () => {
    const { h, id } = abierta();
    expect(h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'resolver-0007' }, CARGA)).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('la foto de la solicitud ya no existe en FotosPozos -> INCONSISTENT_STATE', () => {
    const { h, id } = abierta();
    delete h.bases[FOTO];
    expect(h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: id, resolucion: 'APROBADO', clientRequestId: 'resolver-0008' }, MODERADOR)).toMatchObject({ code: 'INCONSISTENT_STATE' });
  });
});

describe('planificar: reponer', () => {
  test('retirada por eventos -> REPUESTA, invalida cache, la foto vuelve a la galeria', () => {
    const h = crearHoja();
    h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    const r = h.ejecutar(cmd('REPONER'), MODERADOR);
    expect(r).toMatchObject({ ok: true, accion: 'ESCRIBIR', invalidaCache: true });
    expect(r.evento).toMatchObject({ evento: 'REPUESTA', fotoId: FOTO, motivoCodigo: '', motivoTexto: '', solicitudId: '', resolucion: '' });
    expect(h.estado()).toMatchObject({ estado: 'ACTIVA', visible: true });
  });

  test('OCULTA legacy: REPOSICION_NO_PERMITIDA, no se escribe nada (decision administrativa explicita futura)', () => {
    const h = crearHoja([base({ estado: 'OCULTA' })]);
    expect(h.ejecutar(cmd('REPONER'), MODERADOR)).toMatchObject({ ok: false, code: 'REPOSICION_NO_PERMITIDA' });
    expect(h.eventos).toHaveLength(0);
  });

  test('OCULTA legacy aunque el historial de eventos diga que fue retirada y repuesta: sigue sin reponer', () => {
    const h = crearHoja([base({ estado: 'OCULTA' })], [retirada()]);
    expect(h.ejecutar(cmd('REPONER'), MODERADOR)).toMatchObject({ code: 'REPOSICION_NO_PERMITIDA' });
  });

  test('doble reposicion (otro clientRequestId) -> FOTO_NO_RETIRADA; retry exacto -> REINTENTO', () => {
    const h = crearHoja();
    h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    const c = cmd('REPONER');
    h.ejecutar(c, MODERADOR);
    expect(h.ejecutar(cmd('REPONER'), MODERADOR)).toMatchObject({ code: 'FOTO_NO_RETIRADA' });
    expect(h.ejecutar(c, MODERADOR)).toMatchObject({ ok: true, accion: 'REINTENTO' });
  });

  test('reposicion sin retiro -> FOTO_NO_RETIRADA', () => {
    expect(crearHoja().ejecutar(cmd('REPONER'), MODERADOR)).toMatchObject({ code: 'FOTO_NO_RETIRADA' });
  });

  test('foto inexistente -> FOTO_NOT_FOUND; no derivable -> ESTADO_NO_DERIVABLE', () => {
    const h = crearHoja([base()], [retirada({ eventoId: 'roto' })]);
    expect(h.ejecutar(cmd('REPONER', { fotoId: uuid(88) }), MODERADOR)).toMatchObject({ code: 'FOTO_NOT_FOUND' });
    expect(h.ejecutar(cmd('REPONER'), MODERADOR)).toMatchObject({ code: 'ESTADO_NO_DERIVABLE' });
  });

  test('solo un moderador repone', () => {
    const h = crearHoja();
    h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    expect(h.ejecutar(cmd('REPONER'), CARGA)).toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  test('ciclo completo: solicitar -> aprobar -> reponer -> solicitar -> rechazar', () => {
    const h = crearHoja();
    const s1 = h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), CARGA);
    h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: s1.evento.eventoId, resolucion: 'APROBADO', clientRequestId: 'ciclo-000001' }, MODERADOR);
    expect(h.estado().visible).toBe(false);
    h.ejecutar(cmd('REPONER'), MODERADOR);
    expect(h.estado().visible).toBe(true);
    const s2 = h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), CARGA);
    h.ejecutar({ accion: 'RESOLVER_RETIRO', solicitudId: s2.evento.eventoId, resolucion: 'RECHAZADO', clientRequestId: 'ciclo-000002' }, MODERADOR);
    expect(h.estado()).toMatchObject({ estado: 'ACTIVA', visible: true, integridad: 'OK' });
    expect(h.eventos.map((e) => e.secuencia)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('idempotencia', () => {
  test('retry exacto de una solicitud: devuelve la original, sin segundo evento', () => {
    const h = crearHoja();
    const c = cmd('SOLICITAR_RETIRO', { motivoCodigo: 'OTRO', motivoTexto: 'razon' });
    const a = h.ejecutar(c, CARGA);
    const b = h.ejecutar(c, CARGA);
    expect(b).toMatchObject({ ok: true, accion: 'REINTENTO', invalidaCache: false });
    expect(b.evento.eventoId).toBe(a.evento.eventoId);
    expect(h.eventos).toHaveLength(1);
  });

  test('el retry con el texto sin normalizar (espacios) sigue siendo el mismo pedido', () => {
    const h = crearHoja();
    const c = cmd('SOLICITAR_RETIRO', { motivoCodigo: 'OTRO', motivoTexto: 'razon' });
    h.ejecutar(c, CARGA);
    expect(h.ejecutar(Object.assign({}, c, { motivoTexto: '  razon  ' }), CARGA)).toMatchObject({ accion: 'REINTENTO' });
  });

  test.each([
    ['otro motivo', { motivoCodigo: 'MALA_CALIDAD' }],
    ['otro texto', { motivoCodigo: 'OTRO', motivoTexto: 'distinto' }],
    ['otra foto', { fotoId: FOTO2 }]
  ])('mismo clientRequestId con contenido distinto (%s) -> IDEMPOTENCY_CONFLICT', (_n, cambio) => {
    const h = crearHoja([base(), base({ fotoId: FOTO2, wellId: '14-0002' })]);
    const c = cmd('SOLICITAR_RETIRO', { motivoCodigo: 'OTRO', motivoTexto: 'razon' });
    h.ejecutar(c, CARGA);
    expect(h.ejecutar(Object.assign({}, c, cambio), CARGA)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(h.eventos).toHaveLength(1);
  });

  test('RESOLVER con el mismo clientRequestId y otra resolucion -> IDEMPOTENCY_CONFLICT (misma solicitud, distinto contenido)', () => {
    const h = crearHoja();
    const s = h.ejecutar(cmd('SOLICITAR_RETIRO', MOT), CARGA);
    const c = { accion: 'RESOLVER_RETIRO', solicitudId: s.evento.eventoId, resolucion: 'APROBADO', clientRequestId: 'res-compartida' };
    h.ejecutar(c, MODERADOR);
    expect(h.ejecutar(Object.assign({}, c, { resolucion: 'RECHAZADO' }), MODERADOR)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
    expect(h.ejecutar(Object.assign({}, c, { solicitudId: uuid(4321) }), MODERADOR)).toMatchObject({ ok: false, code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('REPONER con el mismo clientRequestId y otra foto -> IDEMPOTENCY_CONFLICT', () => {
    const h = crearHoja([base(), base({ fotoId: FOTO2, wellId: '14-0002' })]);
    h.ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    const c = { accion: 'REPONER', fotoId: FOTO, clientRequestId: 'rep-compartida' };
    h.ejecutar(c, MODERADOR);
    expect(h.ejecutar(Object.assign({}, c, { fotoId: FOTO2 }), MODERADOR)).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('el mismo clientRequestId usado para OTRO tipo de accion -> IDEMPOTENCY_CONFLICT', () => {
    const h = crearHoja();
    const crid = 'compartido-0001';
    h.ejecutar({ accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: crid }, MODERADOR);
    expect(h.ejecutar({ accion: 'REPONER', fotoId: FOTO, clientRequestId: crid }, MODERADOR)).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  test('usuarios distintos con el MISMO clientRequestId no chocan (namespace por usuario)', () => {
    const h = crearHoja([base(), base({ fotoId: FOTO2, wellId: '14-0002' })]);
    const crid = 'mismo-id-0001';
    const a = h.ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: crid }, CARGA);
    const b = h.ejecutar({ accion: 'SOLICITAR_RETIRO', fotoId: FOTO2, motivoCodigo: 'DUPLICADA', clientRequestId: crid }, { email: 'otro@x.com', nombre: 'Otro', permisos: CARGA.permisos });
    expect(a.accion).toBe('ESCRIBIR');
    expect(b.accion).toBe('ESCRIBIR');
    expect(h.eventos).toHaveLength(2);
  });

  test('el email se compara normalizado (mayusculas)', () => {
    const h = crearHoja();
    const c = cmd('SOLICITAR_RETIRO', MOT);
    h.ejecutar(c, { email: 'ana@x.com', permisos: CARGA.permisos });
    expect(h.ejecutar(c, { email: 'ANA@X.COM', permisos: CARGA.permisos })).toMatchObject({ accion: 'REINTENTO' });
  });

  test('mas de un evento con el mismo (usuario, clientRequestId) -> INCONSISTENT_STATE', () => {
    const r = M.fotosPozosModeracion_atenderExistente({ total: 2, eventos: [{}, {}] }, { accion: 'REPONER', fotoId: FOTO });
    expect(r).toMatchObject({ ok: false, code: 'INCONSISTENT_STATE' });
    expect(M.fotosPozosModeracion_atenderExistente({ total: 1, eventos: [] }, { accion: 'REPONER', fotoId: FOTO })).toMatchObject({ code: 'INCONSISTENT_STATE' });
    expect(M.fotosPozosModeracion_atenderExistente(null, { accion: 'REPONER', fotoId: FOTO })).toMatchObject({ code: 'INCONSISTENT_STATE' });
  });

  test('el reintento va ANTES de las transiciones: se reconoce aunque la foto ya cambio de estado', () => {
    const h = crearHoja();
    const c = cmd('RETIRAR', MOT);
    h.ejecutar(c, MODERADOR);
    h.ejecutar(cmd('REPONER'), MODERADOR);
    expect(h.estado().visible).toBe(true);
    expect(h.ejecutar(c, MODERADOR)).toMatchObject({ ok: true, accion: 'REINTENTO' });
    expect(h.eventos).toHaveLength(2);
  });

  test('el evento del REINTENTO no incluye el email', () => {
    const h = crearHoja();
    const c = cmd('RETIRAR', MOT);
    h.ejecutar(c, MODERADOR);
    expect(JSON.stringify(h.ejecutar(c, MODERADOR))).not.toContain('@');
  });
});

describe('planificar: forma del evento escrito', () => {
  test('eventoId nuevo (UUID), timestamp ISO del reloj inyectado y nombre de presentacion', () => {
    const h = crearHoja();
    const r = h.ejecutar(cmd('RETIRAR', MOT), { email: 'Mod@X.com', nombre: '  Moderadora  Uno ', permisos: { fotos: true, fotos_moderar: true } });
    expect(r.evento.eventoId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.evento.timestampUtc).toBe(ISO);
    expect(r.evento.email).toBe('mod@x.com');
    expect(r.evento.nombre).toBe('Moderadora Uno');
    expect(r.evento).not.toHaveProperty('secuencia');
  });

  test('un nombre que parece un email se guarda neutro; nombre ausente queda vacio', () => {
    expect(crearHoja().ejecutar(cmd('RETIRAR', MOT), { email: 'mod@x.com', nombre: 'mod@x.com', permisos: { fotos: true, fotos_moderar: true } }).evento.nombre).toBe('Usuario');
    expect(crearHoja().ejecutar(cmd('RETIRAR', MOT), { email: 'mod@x.com', nombre: '', permisos: { fotos: true, fotos_moderar: true } }).evento.nombre).toBe('');
  });

  test('solo escribe columnas del esquema: nada de Drive ids, URLs ni imagen', () => {
    const r = crearHoja().ejecutar(cmd('RETIRAR', MOT), MODERADOR);
    expect(Object.keys(r.evento).sort()).toEqual(['clientRequestId', 'email', 'entidadId', 'entidadTipo', 'evento', 'eventoId', 'fotoId', 'motivoCodigo', 'motivoTexto', 'nombre', 'resolucion', 'solicitudId', 'timestampUtc']);
  });

  test('sin reloj o sin generador de ids valido es un error de programacion (lanza), no un evento roto', () => {
    const contexto = { email: 'mod@x.com', permisos: { fotos: true, fotos_moderar: true }, derivacion: M.fotosPozosModeracion_derivar([]), obtenerBase: () => base(), existentes: { total: 0, eventos: [] } };
    const c = { accion: 'RETIRAR', fotoId: FOTO, motivoCodigo: 'DUPLICADA', clientRequestId: 'abcdefgh' };
    expect(() => M.fotosPozosModeracion_planificar(Object.assign({}, c), Object.assign({}, contexto, { ahora: new Date(ISO), nuevoEventoId: () => 'no-es-uuid' }))).toThrow(/nuevoEventoId|ahora/);
    expect(() => M.fotosPozosModeracion_planificar(Object.assign({}, c), Object.assign({}, contexto, { nuevoEventoId: () => uuid(1) }))).toThrow(/nuevoEventoId|ahora/);
  });
});
